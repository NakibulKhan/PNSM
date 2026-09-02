# Integration guide — read this before merging

This document is the merge contract for the PNSM project. It says exactly what
Person 4's module owns, what it expects from Persons 1–3, and how to wire the
four modules together. If something is not described here, ask before assuming.

**Owner:** Person 4 (AI, Security & DevOps)
**Service:** `pnsm-ai-svc`, deployed separately from Person 3's API

---

## 1. Ownership map

| Concern | Owner | Where it lives |
|---|---|---|
| ArcFace inference, preprocessing, scoring, calibration | **P4** | `app/ai/` |
| AES-256-GCM encryption of embeddings | **P4** | `app/crypto/fle.py` |
| PIN hashing, pepper, lockout policy | **P4** | `app/crypto/pin.py`, `app/security/lockout.py` |
| S3 bucket, CORS, lifecycle, presigning | **P4** | `app/storage/s3.py` |
| AWS KMS envelope encryption of the data keys | **P4** | `app/crypto/keyproviders.py` |
| Mock-location / replay / staleness enforcement | **P4** | `app/security/guards.py` |
| Dockerfiles (both services and both frontends), CI, health probes | **P4** | repo root, `deploy/`, `.github/` |
| AWS topology: ECS, S3, CloudFront, KMS, IAM | **P4** | `deploy/`, `scripts/provision_aws.py` |
| OWASP audit and the supply-chain gate | **P4** | `docs/OWASP.md`, `scripts/audit_deps.py` |
| MongoDB schema, indexes, queries | P3 | Person 3's repo |
| Geofence maths (`$geoWithin` / `$centerSphere`) | P3 | Person 3's repo |
| JWT issuance, RBAC middleware | P3 | Person 3's repo |
| Redis pub/sub, Socket.IO broadcast | P3 | Person 3's repo |
| Camera capture, blink liveness, image compression | P1 | Mobile app |
| Dashboard, charts, map wizard, WebSocket client | P2 | Web app |

**The encryption boundary is inside this service.** Person 3 never sees a
plaintext embedding — only an opaque envelope written to and read from MongoDB.
This means a mistake in Person 3's code cannot leak biometric data, and it closes
the "biometric data stored unencrypted alongside PII" limitation the v2 proposal
records in §2.7 rather than deferring it.

---

## 2. Person 3 — wiring the backend

### 2.1 Use the supplied client

Do not hand-roll the HMAC signing; the payload format is exact and a mismatch
returns 401 with no diagnostic (deliberately — telling a caller which check
failed hands an attacker an oracle).

- **Node/Express:** copy [`clients/node/pnsmAiClient.js`](../clients/node/pnsmAiClient.js). Zero dependencies, Node 18+.
- **Python/FastAPI:** copy [`clients/python/pnsm_ai_client.py`](../clients/python/pnsm_ai_client.py). Needs `httpx`.

If you must sign manually, the payload is:

```
HMAC-SHA256(secret, f"{unix_timestamp}.{raw_request_body}")
```

sent as `X-PNSM-Signature: v1=<hex>` alongside `X-PNSM-Timestamp: <unix seconds>`.
Sign the **exact bytes you transmit** — re-serialising the JSON changes them.
The freshness window is ±300 s.

### 2.2 Environment

```bash
PNSM_AI_URL=https://ai.<your-domain>        # the AI service's ALB or private DNS name
PNSM_HMAC_SECRET=<base64 32 bytes>       # from Person 4, do not commit
PNSM_ADMIN_TOKEN=<string>                # only if you call /metrics
```

### 2.3 MongoDB schema additions

**The embedding does not go on the `Users` document.** The master plan is
explicit about this:

> The embeddings must be excised from the Users object and placed in an
> isolated, highly restricted `FaceEmbeddings` collection. Mingling Personally
> Identifiable Information (PII) with biometric telemetry severely violates
> modern data-protection compliance architectures.

So `/v1/embed` tells you where its output belongs, in the response body, rather
than leaving it as a line in a document somebody has to remember:

```json
"storage_target": { "collection": "FaceEmbeddings", "link_field": "user_id" }
```

Two collections, then.

```javascript
// FaceEmbeddings -- one document per enrolled employee. No name, no email.
{
  _id: ObjectId("6710a2f5c9e14b0012a4d340"),
  user_id: ObjectId("6710a2f5c9e14b0012a4d331"),   // the link_field

  // The `envelope` from POST /v1/embed. ~3.2 KB. Store verbatim, parse nothing.
  envelope: {
    v: 2, kp: "kms",
    kv: "arn:aws:kms:ap-southeast-1:...:key/...",
    dek: "<base64 KMS-wrapped data key>",
    alg: "AES-256-GCM",
    iv: "<base64 12 bytes>",
    ct: "<base64 2048 bytes>",
    tag: "<base64 16 bytes>",
    model_version: "arcface_w600k_mbf_v1",
    created_at: "2026-09-14T04:12:07Z"
  },
  enrolled_at: ISODate("2026-09-14T04:12:07Z")
}

// Users -- PIN fields only. Still opaque; still stored verbatim.
{
  _id: ObjectId("6710a2f5c9e14b0012a4d331"),
  name: "Rafiq Hasan",
  email: "rafiq@example.com",

  pin_hash: "$2b$10$...",
  pin_algo: "bcrypt-hmac-sha256-pepper",
  pin_cost: 10,
  pin_pepper_version: "p1"
}
```

Recommended index: `{ user_id: 1 }`, unique. One reference embedding per
employee, and the uniqueness constraint is what stops a second enrolment
silently shadowing the first.

Restrict this collection at the database-user level as well — the compliance
argument is about *isolation*, and a collection that every role can read is
isolated only in the file layout.

An envelope is ~3.2 KB, so a thousand employees is under 4 MB — storage is
nowhere near the binding constraint on the Atlas cluster. Selfie images are not
in MongoDB at all; they live in S3 and the log carries the object key.

**Envelope versions.** `v: 1` envelopes have no `kp` or `dek` and were sealed
under a static key. They still open. `v: 2` adds both. Store whatever you are
given; do not validate the shape yourself, because it will change again.

### 2.4 The check-in sequence

Run the steps in this order. It is not arbitrary: each step is cheaper than the
one after it, so a bad request is refused before anything expensive happens.

```
1. Verify the JWT and RBAC                       (P3)
2. POST /v1/security/pin/verify                  (P4)  →  match? attempts_left?
3. $geoWithin / $centerSphere geofence query     (P3)
4. POST /v1/verify                               (P4)  →  decision + confidence
5. Write the AttendanceLog                       (P3)
6. Redis publish → Socket.IO broadcast           (P3)
```

Send a **fresh ULID** as `request_id` for each genuine attempt. It is both the
idempotency key and the replay guard, so reuse it only when retrying the
identical request after a network failure — that is exactly what makes the retry
safe rather than duplicating an attendance record.

### 2.5 Mapping decisions onto AttendanceLog.status

```javascript
const result = await ai.verify({ ... });

switch (result.decision) {
  case 'approved':                                  // confidence >= 85
    await AttendanceLog.create({ ...base, status: 'approved',
                                 face_match_score: result.confidence });
    broadcast(log);
    break;

  case 'flagged':          // ONLY under PNSM_DECISION_BANDS=three (FR-07)
    // Not reachable on the default two-band policy. Keep the branch anyway:
    // the setting is a business decision and may be switched without a code
    // change on your side.
    await AttendanceLog.create({ ...base, status: 'flagged',
                                 face_match_score: result.confidence });
    broadcast(log);                                 // HR sees it and decides
    break;

  case 'rejected':                                  // confidence < 85 by default
    // No attendance record. The employee retries.
    return res.status(200).json({
      ok: false,
      reason: result.reason_code,                   // NO_MATCH
      message: 'We could not match your face. Try again in better light.'
    });
}
```

Store `result.confidence` as `face_match_score` — that is the FR-07 number and
the one the wireframes show ("96% match"). **Never show `raw_cosine` to an
employee.** It is the audit trail; a raw 0.62 next to "96% match" is confusing
and reveals the operating point.

### 2.6 Errors

Everything that is not a completed comparison throws. Branch on `err.code`:

```javascript
try {
  const result = await ai.verify({ ... });
} catch (err) {
  switch (err.code) {
    case 'MOCK_LOCATION':
    case 'EMULATOR_DETECTED':
      await SecurityEvent.create({ user_id, code: err.code });
      broadcastSecurityAlert(user_id, err.code);       // FR: HR spoofing alert
      return res.status(403).json({ error: err.message });

    case 'REPLAY_DETECTED':
    case 'STALE_CAPTURE':
      return res.status(409).json({ error: err.message });

    case 'MODEL_VERSION_MISMATCH':
    case 'NO_REFERENCE_EMBEDDING':
      return res.status(409).json({ error: 'Profile needs attention. Contact HR.' });

    case 'DECRYPT_FAILED':
      // Tampering, a wrong key, or an envelope copied between employees.
      // Always a security event, never a routine failure.
      await SecurityEvent.create({ user_id, code: err.code, severity: 'high' });
      return res.status(500).json({ error: err.message });

    default:
      if (err.retryable) return retryOnce();
      return res.status(err.status || 502).json({ error: err.message });
  }
}
```

`err.message` is always safe to show an end user. `err.retryable` says whether
retrying the identical request could succeed.

---

## 3. Person 1 — the mobile app

### 3.1 Upload path

Do **not** send image bytes through Person 3's API. Ask for a presigned URL and
PUT straight to the bucket: it removes image traffic from both containers, which
matters when the whole task has 1 GB.

```
1. Compress the selfie to WebP, under 200 KB.
2. Ask P3 for an upload URL, sending the EXACT compressed byte count.
3. PUT the bytes to `upload_url` with the returned headers, unchanged.
4. Send `object_key` to P3 as part of the check-in.
```

`Content-Type` and `Content-Length` are signed into the URL, so the bucket itself
rejects a mismatch. Send the real size, not an estimate.

### 3.2 Device fields — the FR-05 contract

These must be forwarded exactly. A field you forget to send is a check the
service cannot make.

| Field | Android | iOS |
|---|---|---|
| `is_mock_location` | `Location.isFromMockProvider()` | `CLLocation.isSimulated` |
| `is_emulator` | `Build.FINGERPRINT` heuristics | simulator detection |
| `is_rooted` | root check | jailbreak check |
| `platform` | `"android"` | `"ios"` |
| `os_version`, `app_version` | for the audit log | for the audit log |

`is_mock_location` or `is_emulator` true returns **403** and raises an HR alert.
`is_rooted` is logged but does not block: rooting is legal and common, and
blocking it would lock out honest employees for a signal a real attacker would
simply suppress.

### 3.3 `captured_at`

Send the device time at the moment of capture, RFC 3339 with a timezone. Skew
beyond ±120 s returns `STALE_CAPTURE` — that is what stops a selfie taken inside
the geofence at 09:00 being submitted from home at noon. A device clock far
*ahead* is rejected too.

### 3.4 Error messages

Render the message from `reason_code`, never from the raw string, so the strings can be
localised. The full table with the intended wording is in [`API.md`](API.md).

Every rejection tells the employee what to do next — "Move somewhere brighter",
"Hold the phone steady", "Move closer to the camera" — which is what FR-11's
"see why a check-in failed so that I can retry correctly" asks for.

---

## 4. Person 2 — the dashboard

### 4.1 Onboarding

The reference photo is uploaded with a presigned URL (`purpose: "reference"`),
then `POST /v1/embed` returns quality metrics **before** the profile is saved.
Use them to reject a bad photo while it can still be retaken — a poor reference
photo degrades every future check-in for that employee.

| Metric | Enrolment floor | Meaning |
|---|---|---|
| `det_score` | ≥ 0.90 | detector confidence |
| `blur_var` | ≥ 120 | Laplacian variance; higher is sharper |
| `face_area_ratio` | ≥ 0.04 | face size relative to the frame |
| `brightness` | 45–215 | mean luma |
| `faces_found` | exactly 1 | more than one face is refused |

`warnings[]` carries non-fatal advice worth showing as a hint: *"Reference photo
is soft. A sharper photo improves match reliability."*

These floors are the defaults, and every one is an environment variable
(`PNSM_ENROL_MIN_DET_SCORE`, `PNSM_ENROL_MIN_BLUR_VAR`,
`PNSM_ENROL_MIN_FACE_AREA_RATIO`, and the `PNSM_MIN_*` pair for check-in — see
`.env.example`). So do not hard-code these numbers in a capture UI: read them
from `GET /ready` if the hint has to be exact, or treat them as approximate and
let the response's `warnings[]` and `reason_code` be the authority. If Person 4
retunes a floor after the calibration is fitted, a hard-coded copy is the thing
that silently goes wrong.

### 4.2 Displaying scores

- Show `confidence` as the match percentage — it is the FR-07 number.
- Colour by band. On the default two-band policy that is simply ≥ 85
  approved, below it rejected; under `three` the middle band 60–84 is flagged.
  `result.threshold.bands` says which policy produced the number, so the
  dashboard does not have to be told out of band.
- Put `raw_cosine` in an audit or debug view only, never on the employee-facing
  timeline.
- `GET /ready` exposes `thresholds.approve_at_cosine`, which is useful on an
  admin settings page: it answers "what does 85% actually mean today?"

### 4.3 Viewing a selfie

Ask Person 3 for a presigned GET (120 s TTL). The bucket blocks public access, so
there is no permanent URL to cache and none to leak.

---

## 5. Merge checklist

Work through this in order when the four modules come together.

**Before merging**

- [ ] Person 4 shares `PNSM_HMAC_SECRET` with Person 3 only, over a private channel
- [ ] Person 3 copies the client from `clients/` rather than hand-rolling signing
- [ ] Person 3 creates the `FaceEmbeddings` collection (unique index on `user_id`) and adds the `pin_*` fields to the Users schema
- [ ] Person 1 confirms the device payload matches §3.2 field for field
- [ ] Person 1 confirms compression lands under 200 KB and reports the exact size
- [ ] Person 2 wires the enrolment quality gate before saving a profile
- [ ] All four agree `user_ref` is the Mongo `_id` as a string

**Wiring**

- [ ] `docker compose up` runs the AI service, the mock backend and MinIO
- [ ] Person 3's local backend reaches `/health` and `/ready`
- [ ] One enrolment succeeds end to end and the envelope lands in MongoDB
- [ ] One check-in returns `approved` end to end
- [ ] A deliberately wrong face returns `rejected`
- [ ] A mock-location request returns 403 and the dashboard shows the alert
- [ ] A replayed `request_id` returns 409 and creates no duplicate log

**Before the demo**

- [ ] `make calibrate` has been run on the team's own photographs
- [ ] `make bench-bcrypt` has been run on the deployed container
- [ ] Both ECS services and the Atlas cluster are in `ap-southeast-1`
- [ ] `/ready` reports `security.key_provider: "kms"` — not `static`
- [ ] `/ready` reports the bucket as SSE-KMS encrypted with public access blocked
- [ ] Embeddings are written to `FaceEmbeddings`, not to `Users`
- [ ] `python scripts/audit_deps.py --npm .` passes in all four repositories
- [ ] `python scripts/smoke.py --base-url <deployed>` passes end to end
- [ ] The FLE keys are backed up in two places outside AWS

---

## 6. Frequently asked, in advance

**Can Person 3 decrypt the envelope to inspect a vector?**
No, and that is the point. The key never leaves this service. If a debugging need
is genuine, `POST /v1/verify` returns `raw_cosine`, which is the diagnostic that
actually helps.

**What if we re-fit the calibration mid-project?**
Nothing stored changes. The calibration maps cosine to confidence at read time;
embeddings are untouched. `POST /v1/admin/recalibrate` swaps it in without a
restart.

**What if we change the model?**
Every stored embedding becomes unusable — `MODEL_VERSION_MISMATCH` on next
check-in, and everyone must re-enrol. Do not change models after Week 6.

**Can two employees share a device?**
Yes. Guards are per `user_ref`, so one employee's replay history and rate limit
never affect another's.

**What happens if the AI service is down?**
Person 3 gets a connection error surfaced as `UPSTREAM_STORAGE_ERROR` with
`retryable: true`. Decide deliberately whether to queue check-ins or refuse them;
silently approving without a face match would defeat the system.

**Why is `/health` unauthenticated?**
The ECS health check and an external uptime monitor both hit it. It returns
only status, version and uptime — nothing worth protecting, and nothing that
touches the model.
