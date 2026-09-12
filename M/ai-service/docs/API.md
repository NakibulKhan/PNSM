# API reference

Base URL (local): `http://localhost:8000` · Interactive docs: `/docs`
Machine-readable contract: `docs/openapi.json`. It is **generated, not
committed by the author of this repository** — run `make openapi` once after
installing dependencies and commit the result. CI fails until you do, on
purpose: a stale contract is how Persons 1, 2 and 3 all break at once.

---

## Authentication

Every route except `/health`, `/ready` and the documentation requires two headers:

```
X-PNSM-Timestamp: 1787059200
X-PNSM-Signature: v1=<hex HMAC-SHA256>
```

The signature covers `f"{timestamp}.{raw_body}"`. The timestamp is *inside* the
signature so a captured signature cannot be replayed with a fresh time. The
freshness window is ±300 s. Sign the exact bytes you transmit — re-serialising
the JSON changes them.

`/metrics` and `/v1/admin/*` need `X-PNSM-Admin` as well.

Every failure returns the same status, the same code and the same message.
Telling a caller *which* check failed would hand an attacker a free oracle.

Reference implementations: [`clients/node/pnsmAiClient.js`](../clients/node/pnsmAiClient.js),
[`clients/python/pnsm_ai_client.py`](../clients/python/pnsm_ai_client.py).

---

## Error envelope

One shape for every failure, on every endpoint.

```json
{
  "error": {
    "code": "MOCK_LOCATION",
    "message": "Turn off mock location apps to check in.",
    "retryable": false,
    "request_id": "8f14e45fceea167a5a36dedd4bea2543"
  }
}
```

`message` is written for an end user and is always safe to display. `retryable`
says whether retrying the identical request could succeed. Internal detail is
logged, never returned.

---

## Reason codes

Person 1 and Person 2 localise from this table and nothing else. Adding,
renaming or removing a member is a **breaking change** — announce it, and update
`tests/contract/test_reason_codes.py`, which fails the build on drift.

| Code | HTTP | Decision | Shown to the employee |
|---|---|---|---|
| `OK_MATCH` | 200 | approved | Checked in. |
| `LOW_CONFIDENCE` | 200 | flagged | Sent to HR for review. You are checked in pending approval. |
| `NO_MATCH` | 200 | rejected | We could not match your face. Try again in better light. |
| `NO_FACE_DETECTED` | 422 | rejected | No face in frame. Centre your face and retry. |
| `MULTIPLE_FACES` | 422 | rejected | More than one face detected. Check in alone. |
| `IMAGE_TOO_BLURRY` | 422 | rejected | Hold the phone steady and retry. |
| `IMAGE_TOO_DARK` | 422 | rejected | Move somewhere brighter and retry. |
| `FACE_TOO_SMALL` | 422 | rejected | Move closer to the camera. |
| `MOCK_LOCATION` | 403 | rejected | Turn off mock location apps to check in. |
| `EMULATOR_DETECTED` | 403 | rejected | Check in from a physical device. |
| `REPLAY_DETECTED` | 409 | rejected | This photo was already used. Take a new one. |
| `STALE_CAPTURE` | 409 | rejected | Photo expired. Retake and submit. |
| `NO_REFERENCE_EMBEDDING` | 409 | rejected | Profile incomplete. Contact HR. |
| `MODEL_VERSION_MISMATCH` | 409 | rejected | Profile needs re-enrolment. Contact HR. |
| `DECRYPT_FAILED` | 500 | rejected | Something went wrong. Contact HR. |
| `PAYLOAD_TOO_LARGE` | 413 | rejected | Photo too large. Retry. |
| `RATE_LIMITED` | 429 | rejected | Too many attempts. Wait a moment. |
| `UPSTREAM_STORAGE_ERROR` | 502 | rejected | Network issue. Retry. |
| `INTERNAL` | 500 | rejected | Something went wrong. Retry. |
| `UNAUTHORIZED` | 401 | — | Request rejected. |
| `BAD_REQUEST` | 400 | — | Request could not be understood. |

Codes marked as **security events** — `MOCK_LOCATION`, `EMULATOR_DETECTED`,
`REPLAY_DETECTED`, `STALE_CAPTURE`, `DECRYPT_FAILED`, `UNAUTHORIZED` — are logged
at warning level and counted separately. Person 3 should raise an HR alert on
each.

---

## `GET /health`

Liveness. No signature required, no model call, no network. Under 5 ms, because
the ECS health check hits it every 30 seconds and an uptime monitor every few
minutes.

```json
{ "status": "ok", "version": "1.0.0", "uptime_s": 41273.4 }
```

## `GET /ready`

Readiness. Run this before a demo.

```json
{
  "status": "ready",
  "model_version": "arcface_w600k_mbf_v1",
  "calibration_version": "cal-2026-09-14",
  "preprocess_fingerprint": "79c66c37458b41d6",
  "storage": "ok",
  "warm": true,
  "thresholds": {
    "calibration_version": "cal-2026-09-14",
    "logistic": { "a": 18.2, "b": 0.4187 },
    "bands": { "approve": 85.0, "flag": 60.0 },
    "approve_at_cosine": 0.5152,
    "flag_at_cosine": 0.4410,
    "measured": { "far": 0.0093, "frr": 0.041, "auc": 0.9962 }
  },
  "warnings": [],
  "security": {
    "key_provider": "kms",
    "kms_key_id": "arn:aws:kms:ap-southeast-1:000000000000:key/pnsm-biometrics",
    "decision_bands": "two",
    "auth_required": true,
    "headers": {
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age=31536000; includeSubDomains"
    }
  },
  "aws": {
    "region": "ap-southeast-1",
    "bucket": "pnsm-selfies",
    "endpoint": "aws-default",
    "posture": {
      "checked": true,
      "encryption": { "encrypted": true, "algorithm": "aws:kms",
                      "kms_key": "arn:aws:kms:...", "bucket_key_enabled": true },
      "public_access": { "blocked": true, "config": { "BlockPublicAcls": true } }
    }
  }
}
```

`security` and `aws` are the pre-demo checklist in machine-readable form.
`key_provider` must read `kms` in any deployment, and `aws.posture` is
**measured**, not asserted: a bucket-encryption rule that was quietly removed
looks identical to one that is in place until somebody reads the objects. Under
the static key provider `kms_key_id` is `null`.

`posture.checked` is `false` only when the store cannot report at all. When the
bucket is reachable but the call fails — against MinIO, which does not implement
these APIs, or when the task role is missing the three read-only permissions —
`checked` stays `true` and the failure appears as `encrypted: false` /
`blocked: false` with an `error` string beside it. Read those two booleans, not
`checked`.

`warm: false` means the first real check-in pays first-call cost. `approve_at_cosine`
answers "what does 85% actually mean today?" — if it is outside roughly 0.30–0.80,
the calibration needs refitting.

---

## `POST /v1/embed` — enrolment (FR-01)

**Request**

```json
{
  "user_ref": "6710a2f5c9e14b0012a4d331",
  "image": { "kind": "s3_key", "value": "refs/6710a2.../01JB7Z.webp" },
  "request_id": "01JB7ZQ2K8N4V0X6M3PYE9TSRA"
}
```

`image.kind` is `s3_key` (normal) or `base64` (development, same size ceiling).
`r2_key` is the pre-AWS spelling of `s3_key` and is still accepted, so a client
that has not been updated keeps working through the migration.

**Response**

```json
{
  "ok": true,
  "envelope": {
    "v": 2,
    "kp": "kms",
    "kv": "arn:aws:kms:ap-southeast-1:000000000000:key/pnsm-biometrics",
    "dek": "<base64 KMS-wrapped data key>",
    "alg": "AES-256-GCM",
    "iv": "8Zt1Qf3nR0aB2cDe",
    "ct": "<~2.7 KB base64>",
    "tag": "9pLmN4rTvXqZ1aBc2dEf3g==",
    "model_version": "arcface_w600k_mbf_v1",
    "created_at": "2026-09-14T04:12:07Z"
  },
  "storage_target": { "collection": "FaceEmbeddings", "link_field": "user_id" },
  "quality": {
    "det_score": 0.94, "blur_var": 187.4,
    "face_area_ratio": 0.31, "brightness": 128.6, "faces_found": 1
  },
  "warnings": [],
  "model_version": "arcface_w600k_mbf_v1",
  "timings_ms": { "decode": 12.1, "detect": 54.8, "preprocess": 16.2, "infer": 87.4 }
}
```

Store `envelope` verbatim in the collection `storage_target` names. Do not
reformat it, and do not attempt to read it — the key never leaves this service,
and under the KMS provider the data key that could open it is unwrapped only
inside this process.

`storage_target` is in the response rather than only in a document because the
master plan requires embeddings to be kept out of the `Users` object. A
requirement that travels in the payload is one the storing code cannot overlook.
See [`INTEGRATION.md`](INTEGRATION.md) §2.3 and D-13.

**Envelope fields you may see.** `v: 1` envelopes have no `kp` and no `dek`;
they were sealed under a static key and still open. `v: 2` adds both. Treat the
whole object as opaque and store whatever arrives — the shape will change again
and readers that validate it will break.

Enrolment holds a stricter quality bar than verification, because a poor
reference photo degrades every future check-in for that employee.

---

## `POST /v1/verify` — check-in (FR-05, FR-07)

**Request**

```json
{
  "user_ref": "6710a2f5c9e14b0012a4d331",
  "image": { "kind": "s3_key", "value": "checkins/2026/09/14/6710a2.../01JB80.webp" },
  "envelope": { "...the object stored at onboarding, unchanged..." },
  "request_id": "01JB80X4M2R7T9K1WQZ5NCVHDB",
  "captured_at": "2026-09-14T09:02:41Z",
  "device": {
    "platform": "android", "os_version": "14", "app_version": "1.0.3",
    "is_mock_location": false, "is_emulator": false, "is_rooted": false
  }
}
```

**Response** — a decision, not an exception

```json
{
  "decision": "approved",
  "confidence": 91.4,
  "raw_cosine": 0.6231,
  "threshold": {
    "approve": 85.0,
    "bands": "two",
    "calibration_version": "cal-2026-09-14",
    "approve_at_cosine": 0.5152
  },
  "reason_code": "OK_MATCH",
  "hr_alert": false,
  "quality": { "det_score": 0.91, "blur_var": 142.0, "face_area_ratio": 0.28,
               "brightness": 131.2, "faces_found": 1 },
  "model_version": "arcface_w600k_mbf_v1",
  "image_hash": "3b1f...c9",
  "capture_skew_s": 4.2,
  "latency_ms": { "decrypt": 0.4, "fetch": 214.0, "decode": 11.8,
                  "detect": 55.1, "preprocess": 16.0, "infer": 87.2,
                  "score": 0.3, "total": 385.1 }
}
```

`confidence` is the master plan's "similarity score" as a percentage, and it is
**calibrated**, not `cosine × 100` — see [`CALIBRATION.md`](CALIBRATION.md).
`raw_cosine` is the audit trail; never show it to an employee. `image_hash` is
worth recording on the attendance log: it is what lets a later investigation
prove two check-ins used the same photograph.

`hr_alert` is `true` for anything that is not a clean approval. It is the signal
for the master plan's "instant WebSocket alert routed to the HR dashboard for
manual auditing" — read this field rather than comparing `decision` strings, so
the alerting keeps working if the band policy changes.

**`threshold.bands` tells you which policy produced this decision**, and the
object's shape follows it. The example above is the default, `two` — the master
plan's rule: at or above `approve`, approve; below it, reject and raise an HR
alert. `decision` is then only ever `approved` or `rejected`.

Setting `PNSM_DECISION_BANDS=three` enables FR-07's intermediate band. `decision`
can then also be `flagged`, and two more keys appear:

```json
"threshold": {
  "approve": 85.0, "flag": 60.0, "bands": "three",
  "calibration_version": "cal-2026-09-14",
  "approve_at_cosine": 0.5152, "flag_at_cosine": 0.4410
}
```

Both policies approve at exactly the same score. `flag` is absent under `two`
rather than sent as `null`, because publishing a threshold the service never
applies would tell HR something untrue. See D-15 and
[`CALIBRATION.md`](CALIBRATION.md) §3.

### Order of checks

Deliberate, and load-bearing — each step is cheaper than the next, so a spoofed
request never reaches the model:

1. `user_ref` shape
2. rate limit
3. device flags → `MOCK_LOCATION` / `EMULATOR_DETECTED`
4. capture freshness → `STALE_CAPTURE`
5. `request_id` single use → `REPLAY_DETECTED`
6. **decrypt the reference** → `DECRYPT_FAILED` / `MODEL_VERSION_MISMATCH`
7. fetch the selfie → `UPSTREAM_STORAGE_ERROR`
8. image reuse → `REPLAY_DETECTED`
9. detect, gate, preprocess, embed → quality codes
10. score and band

Decryption sits before the object fetch on purpose: a wrong key or a stale model
version costs microseconds there and 200+ ms if deferred.

---

## `POST /v1/security/pin/hash`

```json
{ "user_ref": "6710a2...", "pin": "418362" }
```
```json
{ "pin_hash": "$2b$10$...", "algo": "bcrypt-hmac-sha256-pepper",
  "cost": 10, "pepper_version": "p1" }
```

Policy violations return `400` with a message written for the HR user setting the
PIN: too short, too common, a repeated pattern, or a sequential run.

## `POST /v1/security/pin/verify`

```json
{ "user_ref": "6710a2...", "pin": "418362", "pin_hash": "$2b$10$..." }
```
```json
{ "match": true, "locked": false, "attempts_left": 5, "retry_after_s": 0 }
```

A wrong PIN is a normal `200` with `match: false` and a decremented budget. Once
the budget is spent the account locks and further attempts return `429` **without
performing a comparison** — doing the bcrypt work anyway would let an attacker
keep probing through the lockout.

---

## `POST /v1/storage/presign-put`

```json
{ "user_ref": "6710a2...", "purpose": "checkin",
  "object_id": "01JB80X4M2R7T9K1WQZ5NCVHDB",
  "content_type": "image/webp", "content_length": 152340 }
```
```json
{ "upload_url": "https://pnsm-selfies.s3.ap-southeast-1.amazonaws.com/...",
  "method": "PUT",
  "headers": { "Content-Type": "image/webp", "Content-Length": "152340" },
  "object_key": "checkins/2026/09/14/6710a2.../01JB80X4M2R7T9K1WQZ5NCVHDB.webp",
  "expires_at": "2026-09-14T09:07:41Z", "max_bytes": 152340 }
```

The key is built server-side from validated components; a client-supplied key is
never accepted, because it would be a path-traversal and object-overwrite
primitive. `Content-Type` and the exact `Content-Length` are signed into the URL,
so the bucket rejects a mismatched or oversized upload — the ceiling is enforced
by infrastructure, not by client goodwill. Send the real compressed size.

## `POST /v1/storage/presign-get`

```json
{ "object_key": "checkins/2026/09/14/6710a2.../01JB80.webp" }
```

120-second read URL for the HR audit view. Keys outside a managed prefix are
refused.

---

## `POST /v1/admin/recalibrate` · `POST /v1/admin/warmup` · `GET /metrics`

Operator-only; require `X-PNSM-Admin` on top of the signature.

`recalibrate` re-reads `calibration.json` and swaps it in atomically, so a
threshold can be corrected during a demo without a redeploy and another cold
start. The preprocessing fingerprint is re-checked: a calibration fitted on a
different pipeline is refused rather than silently accepted.

`/metrics` returns counters, a latency summary and resident memory — the last of
which is what the CI memory gate asserts against.

---

## Limits

| | |
|---|---|
| Image payload | 200 KB (`PNSM_MAX_UPLOAD_BYTES`) |
| Request body | ~330 KB (200 KB inflated by base64, plus headroom) |
| Verify rate limit | 12 per employee per minute |
| PIN attempts | 5, then a 15-minute lock |
| Capture skew | ±120 s |
| `request_id` replay window | 10 minutes |
| Image replay history | last 30 selfies per employee |
| Presign TTL | 300 s upload, 120 s download |
| Signature skew | ±300 s |
