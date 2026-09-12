# Person 4 execution blueprint

The plan this module was built from. Preserved in the repository so that when the
four modules merge, the reasoning travels with the code — not just the result.

**Module:** AI Biometrics, Cryptography & Cloud DevOps
**Budget:** BDT 72,000 (~24% of BDT 300,500) · **Window:** Weeks 3–8
**Baseline:** Updated PNSM Project Proposal (v2 — MongoDB Atlas, Cloudflare R2, Docker)
**Deliverable:** `pnsm-ai-svc`

Where the implementation departs from this plan, the departure is recorded in
[`DECISIONS.md`](DECISIONS.md).

> ### ⚠ Superseded in part — read this first
>
> This document was written against the **v2 project proposal**, whose cloud
> layer was Cloudflare R2 for storage and a Render/Koyeb free-tier split for
> hosting. The team subsequently adopted the four-member **master plan**, which
> replaces that entire layer with a single AWS account: ECS Fargate, S3,
> CloudFront and KMS.
>
> It is kept unedited, because it is the record of how this module was reasoned
> about and it contains work — the calibration method, the memory and latency
> budgets, the security model, the week-by-week schedule — that the change of
> cloud provider does not touch.
>
> **What is superseded:** §10 (hosting, keep-alive, quota arithmetic), the R2
> references in §07 and §11, Correction 2 in §00, and the *512 MB* framing
> throughout §09 — the Fargate task requests 1024 MB, so the measured figures in
> that section are still correct and the headroom is larger than it says. See
> [`AWS.md`](AWS.md) for the topology that replaced them and
> [`DECISIONS.md`](DECISIONS.md) D-17 for why the free-tier analysis was retired
> rather than corrected.
>
> **What replaced it as the governing document:**
> [`MASTER_PLAN_ALIGNMENT.md`](MASTER_PLAN_ALIGNMENT.md), which maps every
> Quadrant IV clause of the master plan to where it is implemented.

---

## 00 · Three spec corrections

The source documents are internally consistent and well structured. Three details
in them will not survive contact with a live demo. Each is fixable at near-zero
cost now and catastrophic to discover in Week 8.

### Correction 1 — an 85% raw cosine threshold rejects almost every genuine employee

FR-07 defines confidence as `cosine × 100` and requires `≥ 85`, i.e. raw cosine
≥ 0.85. ArcFace does not produce those numbers for real people. DeepFace's own
calibrated default for ArcFace is a cosine *distance* of 0.68 — a cosine
*similarity* of **0.32**. Genuine same-person pairs shot under different lighting
land between roughly 0.35 and 0.75; only near-duplicate frames exceed 0.85.

The fix keeps the written "85% confidence" contract intact by making confidence a
**calibrated** function of cosine rather than a raw multiplication. Full method in
§04. No other document needs rewording.

### Correction 2 — two always-warm services do not fit one Render free workspace

Render's free tier grants **750 instance-hours per workspace per calendar month**
and spins a service down after 15 minutes idle. Keeping two services warm around
the clock burns ~1,460 hours — the workspace stops serving around day 15. The
keep-alive cron therefore causes the outage it was meant to prevent.

Fix: split providers. The AI service goes to **Koyeb** (one free instance per
organisation, 512 MB, scales to zero only after a full hour idle); Person 3's API
stays on **Render** (~744 h/month for one service, inside the 750 cap). Details
in §10.

### Correction 3 — bcrypt alone does not protect a 4-digit PIN

The spec calls for bcrypt at cost ≥ 10 on a 4–6 digit PIN. bcrypt protects a
*stolen database*; it does nothing against online guessing of a 10,000-value
space. Worse, cost 12 on a throttled 0.1-vCPU instance takes seconds and sits
inside the 3-second check-in budget.

Fix: cost 10 with a measured ceiling, a server-side pepper applied before
hashing, a 6-digit minimum, and per-user lockout. See §06.

### What the spec gets right

Keep unchanged: ONNX Runtime over TensorFlow (the memory argument is correct and
decisive), Cloudflare R2 for zero-egress selfie storage, client-side compression
under 200 KB, Docker for runtime parity, CLAHE plus landmark alignment for
illumination robustness.

---

## 01 · Scope boundary

| Person 4 owns outright | Supplies to others | Explicitly not Person 4 |
|---|---|---|
| ArcFace ONNX inference, preprocessing, scoring, calibration | A callable `/v1/verify` plus a typed client for Person 3 | MongoDB schema, indexes, queries (P3) |
| AES-256-GCM encryption of embedding vectors | An opaque ciphertext envelope for P3 to persist verbatim | Geofence maths, `$geoWithin`/`$centerSphere` (P3) |
| PIN hashing, pepper, lockout policy | `/v1/security/pin/*` and the lockout rules | JWT issuance, RBAC middleware (P3) |
| Cloudflare R2 bucket, CORS, lifecycle, presigning | Presigned PUT to P1, presigned GET to P2 | Camera capture, blink liveness, compression (P1) |
| Mock-location / replay / staleness enforcement | Reason codes P1 and P2 render to users | Dashboard charts, WebSocket client, map wizard (P2) |
| Dockerfiles, CI, deploy configs, keep-alive, health probes | A working `docker compose up` for the whole team | Socket.IO broadcast and Redis pub/sub (P3) |

**Design principle.** The encryption boundary lives entirely inside Person 4's
service. Person 3 never sees a plaintext embedding — only an opaque envelope it
writes to and reads from MongoDB. A mistake in Person 3's code cannot leak
biometric data, the AES key never leaves one container, and the §2.7 "biometric
data stored unencrypted alongside PII" limitation in the v2 proposal is closed
rather than deferred.

---

## 02 · Architecture — a standalone service

`pnsm-ai-svc` is an independent Python 3.11 / FastAPI service, containerised and
deployed separately, whose only client is Person 3's backend. Not a library
inside Person 3's repository.

**Why standalone**

- **Language independence.** ArcFace inference is Python; Person 3 may choose
  Node. A separate service makes that choice irrelevant instead of forcing it.
- **Memory isolation.** The AI process is the one that can OOM at 512 MB. Sharing
  a container with the API means an inference spike kills check-ins, geofencing
  and WebSockets at once. Isolated, an AI crash degrades to a flagged check-in.
- **Zero blocking on Person 3.** Build, test, containerise and deploy from Week 3
  without a line of Person 3's code existing. A mocked client covers the reverse.
- **Dependency hygiene.** `onnxruntime`, `opencv-python-headless` and `numpy` stay
  out of the API image.

**Accepted trade-off.** One extra network hop (~20–60 ms same region) and a
second container to keep warm. Both priced into §11 and §10.

---

## 03 · API contracts — freeze in Week 3

Publish the OpenAPI schema on day one of Week 3 so Persons 1–3 can code against
stubs.

**Service-to-service authentication.** Every request carries
`X-PNSM-Timestamp` and `X-PNSM-Signature: v1=<hex HMAC-SHA256(secret,
"timestamp.body")>`, ±300 s window. The AI endpoint cannot be called by a phone,
a browser, or a classmate who finds the URL.

**Endpoints**

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness. Cheap, no model call — a cron pings it every few minutes |
| `GET /ready` | Model, calibration, storage, warmup state |
| `POST /v1/embed` | Onboarding (FR-01). Returns the embedding **already encrypted** |
| `POST /v1/verify` | Check-in (FR-05, FR-07). The hot path |
| `POST /v1/security/pin/hash` · `/verify` | PIN hashing and checking with lockout |
| `POST /v1/storage/presign-put` · `presign-get` | Direct-to-bucket transfer |
| `POST /v1/admin/recalibrate` | Hot-reload the calibration during a demo |
| `GET /metrics` | Counters, latency, resident memory |

**Reason codes.** A closed set of 21, each with an HTTP status, a retryable flag
and an end-user message. Person 1 and Person 2 localise from this table and
nothing else. Freezing it in Week 3 is what lets FR-11's "see why a check-in
failed" ship without a scramble in Week 8. Full table in [`API.md`](API.md).

**Quality metrics on enrolment.** A bad reference photo poisons every future
check-in for that employee. Returning `det_score`, `blur_var`,
`face_area_ratio`, `brightness` and `faces_found` lets Person 2's onboarding form
reject a poor upload at capture time, while it can still be retaken.

---

## 04 · Threshold calibration

Replaces `confidence = cosine × 100`. The highest-value hour of work in the
module.

```
confidence = 100 / (1 + exp(-a · (cosine - b)))
```

- `b` — decision midpoint, fitted so FAR ≤ 1% on the impostor set. Set by security.
- `a` — slope, fitted so a chosen fraction of genuine pairs clears the approve band. Set by usability.

With a typical fit (`a ≈ 18`, `b ≈ 0.42`): cosine 0.62 → **97**, cosine 0.45 →
**63** (flagged), an impostor at 0.20 → **2**. The employee-facing number behaves
the way the wireframes already show it, and the decision is anchored on measured
error rates.

**Three-band decision**

| Band | Decision | Behaviour | Spec |
|---|---|---|---|
| `C ≥ 85` | approved | Attendance log, WebSocket push | FR-07, FR-08, FR-09 |
| `60 ≤ C < 85` | flagged | Log as `flagged`, HR alert | FR-07 "otherwise flagged" |
| `C < 60` | rejected | No log; employee retries | FR-11 |

**Building it.** Collect 8–10 photos each from four members plus 4–6 volunteers
(~10 identities, ≥ 80 images), generate all pairs, compute the ROC, pick `b` at
FAR ≤ 1%, fit `a`, freeze `calibration.json`, and put the ROC curve in the report.
The service refuses to start without the file — no silent defaults.

**Stated honestly.** 1:1 ArcFace without a presentation-attack model can be
defeated by a printed photo or a screen replay. The blink prompt is a deterrent,
not a defence. MiniFASNet (~1.9 MB ONNX, ~15 ms) closes it properly and is the
strongest optional upgrade — a stretch goal, not a commitment.

---

## 05 · Inference pipeline

Both models baked into the image at build time. Nothing downloaded at runtime — a
cold start must never depend on an external host being up.

| Stage | Implementation | Cost |
|---|---|---|
| Fetch | R2 GET by key, ≤ 200 KB, 3 s timeout | ~215 ms |
| Decode | `cv2.imdecode`, reject non-image bytes | ~12 ms |
| Detect | YuNet ONNX, 5-point landmarks *(plan said SCRFD — see D-01)* | ~55 ms |
| Quality gate | Laplacian variance, brightness, face-area ratio, face count | ~4 ms |
| Align | Umeyama similarity transform onto the ArcFace template, 112×112 | ~7 ms |
| CLAHE | `clipLimit=2.0`, `tileGridSize=(8,8)` *(after alignment — see D-02)* | ~9 ms |
| Normalise | BGR→RGB, `(px − 127.5)/127.5`, NCHW float32 | ~2 ms |
| Embed | ArcFace `w600k_mbf` → 512-d | ~87 ms |
| L2 normalise | so cosine reduces to a dot product | < 1 ms |
| Score | decrypt, dot product, logistic map, band | ~3 ms |

**One shared `preprocess()`.** Enrolment and verification call the same function.
A mismatch between the two paths silently shifts every score. Guarded by a single
entry point, a fingerprint in the calibration, and a golden-vector test.

**Memory-critical ONNX configuration.** One global session per model created at
startup; `intra_op_num_threads=1`, `inter_op_num_threads=1`,
`enable_cpu_mem_arena=False`. Creating a session per request is the classic way
to OOM this service.

---

## 06 · Cryptography

**Field encryption.** AES-256-GCM, key never leaving the service, versioned
self-describing envelope.

| Parameter | Value | Rationale |
|---|---|---|
| Key source | `PNSM_FLE_KEYS` version→key map | Rotation without downtime |
| IV | `os.urandom(12)` per operation | 96-bit is GCM's optimal size; reuse is catastrophic |
| Tag | 128 bit, verified before decryption returns | Full-length authentication |
| **AAD** | `user_ref\|model_version\|key_version` | **Prevents cross-employee ciphertext substitution** |
| Stored size | ~2.9 KB | Trivial against Atlas M0's 512 MB |
| Failure | fail closed | Reject + security event + HR alert |

The AAD binding is the part worth defending in a viva: without it, an attacker
with database write access could copy Employee A's encrypted embedding onto
Employee B's document. It costs one line and goes beyond what the spec asks.

**PIN protection.** Four layers, of which bcrypt is not the most important:
pepper before hash, benchmarked bcrypt cost, six-digit minimum with weak-PIN
rejection, and per-user lockout — which is what actually stops guessing.

---

## 07 · Anti-spoofing and request integrity

FR-05 covers mock GPS. Three attacks it does not cover are cheap to close and are
exactly what a sharp examiner asks about:

| Control | What it stops |
|---|---|
| Mock location / emulator → 403 | Fake-GPS apps and simulators (FR-05) |
| Capture staleness, ±120 s | A selfie taken in the office at 09:00, submitted from home at noon |
| Request-id nonce, 10 min | Replay; also makes `/v1/verify` idempotent under network retries |
| Image hash, last 30 per employee | The same saved photo every morning — an attack GPS, PIN and face match all pass |

**Trust boundary, stated plainly.** Every device signal is self-reported. A rooted
phone can strip `is_mock_location`. These controls raise the cost of casual
cheating; they do not stop a determined attacker. The honest production path is
Play Integrity (Android) and DeviceCheck / App Attest (iOS). Naming the
limitation is stronger than pretending it away.

---

## 08 · Object storage

One S3-compatible interface, two backends: MinIO locally, Cloudflare R2 in the
cloud. `boto3` takes an `endpoint_url`, so switching is one environment variable
and zero lines of code.

| Concern | Setting |
|---|---|
| Reference key | `refs/{user_ref}/{ulid}.webp` |
| Check-in key | `checkins/{yyyy}/{mm}/{dd}/{user_ref}/{ulid}.webp` |
| Presign TTL | 300 s upload, 120 s download |
| Size ceiling | 204,800 bytes, signed into the URL |
| Content types | `image/webp`, `image/jpeg` |
| Lifecycle | check-in selfies deleted after 90 days; reference photos on offboarding |
| Public access | blocked — every read goes through a presigned GET |

The lifecycle rule and offboarding deletion together satisfy the NFR that
biometric data be "deletable on employee offboarding" — a line otherwise easy to
leave as an unimplemented aspiration. It costs one bucket policy.

Direct presigned upload also removes image bytes from both API containers. On a
512 MB instance, concurrent multipart uploads are a real memory risk.

---

## 09 · Container and memory budget

| Component | Resident |
|---|---|
| Python 3.11 + FastAPI + uvicorn | ~55 MB |
| NumPy + OpenCV headless | ~70 MB |
| ONNX Runtime library | ~45 MB |
| ArcFace `w600k_mbf` session (13.6 MB weights) | ~35 MB |
| YuNet session (233 KB weights) | ~10 MB |
| boto3 + cryptography + bcrypt | ~30 MB |
| **Steady state** | **~245 MB** |
| Peak, one in-flight request | ~300 MB |
| **Headroom against 512 MB** | **~212 MB** — CI gate fails above 380 MB |

**The single most likely way this module fails:** installing `deepface` or
`insightface` from PyPI pulls TensorFlow or PyTorch and immediately blows the
ceiling. The rule is encoded in the build (`scripts/check_deps.py` in CI), not in
a teammate's memory.

---

## 10 · Deployment and keep-alive

Per Correction 2. Each provider's single free slot is used exactly once.

| Service | Provider | Free-tier facts | Ping cadence |
|---|---|---|---|
| `pnsm-ai-svc` (P4) | Koyeb | 0.1 vCPU, 512 MB, one free instance per org, scales to zero after **1 h** idle | every 30 min |
| `pnsm-api` (P3) | Render | 512 MB, spins down after **15 min**, ~1 min cold start, **750 h/workspace/month** | every 7 min, windowed |
| `pnsm-dashboard` (P2) | Vercel | hobby tier, no spin-down | none |

**Quota arithmetic.** 744 hours is a 31-day month; one always-warm Render service
consumes essentially the whole 750-hour allowance, leaving six hours of margin.
Window the keep-alive to 06:00–02:00 Dhaka (20 h/day ≈ 620 h/month) and lift to
24/7 only during demo week.

Also: two independent cron providers so one outage does not put the demo to
sleep; region pinning (Singapore) across Koyeb, Render and Atlas; a warmup
inference at boot; and a written demo-day protocol.

---

## 11 · Latency budget against the 3-second NFR

| Step | Owner | Warm | Cold |
|---|---|---|---|
| Capture, compress to WebP < 200 KB | P1 | 300 ms | 300 ms |
| Direct upload to R2 | P1 | 800 ms | 800 ms |
| API receives, JWT, RBAC | P3 | 50 ms | 60,000 ms |
| Geofence `$geoWithin` | P3 | 30 ms | 30 ms |
| PIN verify (bcrypt cost 10, threadpool) | P4 | 90 ms | 90 ms |
| Hop to AI service, HMAC verify | P4 | 40 ms | 30,000 ms |
| R2 GET selfie | P4 | 215 ms | 215 ms |
| Decode, detect, CLAHE, align | P4 | 87 ms | 87 ms |
| ArcFace inference | P4 | 87 ms | 87 ms |
| Decrypt, score, band | P4 | 3 ms | 3 ms |
| Mongo write + Redis publish + WS push | P3 | 60 ms | 60 ms |
| **End to end** | | **≈ 1.76 s** | **≈ 92 s** |
| **Margin against NFR** | | **1.24 s** | **fails** |

The warm path clears the requirement with 40% headroom; the cold path misses it
by a factor of thirty. That gap is the entire justification for the keep-alive
work, and why the ping configuration is an acceptance criterion rather than a
finishing touch.

---

## 12 · Test strategy

| Layer | What it proves |
|---|---|
| Crypto unit | Round-trip; tampered `ct`/`tag`/`iv`/`user_ref` all raise; unique IVs |
| Golden vectors | A committed input always produces the same tensor — catches silent drift |
| Calibration regression | Fit maths against synthetic distributions with known answers |
| Contract | Real responses validate against the generated OpenAPI schema; every reason code reachable |
| Security | Replay → 409; mock flag → 403; oversize → 413; bad HMAC → 401; 6th PIN attempt → locked |
| Memory gate | 50 sequential verifies; peak RSS under 380 MB |
| Load | 20 concurrent verifies; service-side p95 under 1.5 s |
| Integration | `docker compose up` → enrol → check-in → approved, against MinIO |
| Adversarial | Printed photo, screen replay, wrong person — tabulated honestly in the report |

**Golden vectors are the highest-leverage test here.** The failure most likely to
ship is a preprocessing change that shifts every score by a few points. Nothing
crashes; matches simply get worse. A committed reference turns that silent
regression into a red build.

---

## 13 · Week-by-week schedule

Mapped onto the milestones in the Person 4 documentation, with one addition:
**Week 5 is not idle.** The source plan leaves Person 4 unallocated there, but
calibration data collection depends on other people's time and cannot start in
Week 6 without risking the whole threshold exercise.

| Week | Focus | Deliverables |
|---|---|---|
| **3** | Contracts and local environment | Repo, CI, `/health`, `/ready`, HMAC middleware, **published OpenAPI + reason-code table**, `docker compose` with MinIO and a mock API |
| **4** | Storage, container, pipeline | R2 bucket + CORS + lifecycle, presign endpoints (**P1 and P2 unblocked**), multi-stage Dockerfile under 450 MB, CI image build, Koyeb hello-world deploy |
| **5** *(added)* | Calibration dataset and harness | Consent, 8–10 photos per person, ONNX weights + checksums, `build_calibration.py`, first fit and histogram, `bench_bcrypt.py` on a deployed container |
| **6** | AI engine | ONNX sessions with the memory configuration, detection/landmarks/CLAHE/alignment, `/v1/embed` and `/v1/verify` live, calibration loaded, golden test committed |
| **7** | Security | AES-256-GCM with AAD, rotation tested, pepper + bcrypt + weak-PIN + lockout, all device guards, security suite green, log redaction. *Stretch:* MiniFASNet |
| **8** | Ship | Deploy to Koyeb, keep-alive on two providers, cross-module integration, adversarial session, load test, ROC in the report, demo rehearsal, key backup |

---

## 14 · Cross-team dependencies

**Owed to the team**

| Deliverable | To | By | Blocks |
|---|---|---|---|
| OpenAPI schema + reason-code table | P1, P2, P3 | End W3 | All UI error handling |
| `docker compose up` with mock API | P1, P2, P3 | End W3 | Local development for everyone |
| Presigned upload + R2 credentials | P1, P2 | Mid W4 | Selfie capture, onboarding upload |
| HMAC secret + typed client | P3 | Mid W4 | P3's verification call path |
| Envelope shape for MongoDB | P3 | End W4 | P3's Users document schema |
| Live `/v1/verify` | P3 | End W6 | End-to-end check-in |
| PIN endpoints | P3 | Mid W7 | FR-06 |
| Deployed URL + env checklist | All | Start W8 | Integration testing |

**Needed from others**

| Need | From | By | If it slips |
|---|---|---|---|
| `user_ref` format | P3 | W3 | Assume 24-char hex; opaque to P4 either way |
| Device payload exactly as specified | P1 | W4 | Guards default to reject-unknown |
| Mobile and dashboard origins for CORS | P1, P2 | W4 | Wildcard locally, tightened before deploy |
| **Calibration photos, 8–10 each** | All | **W5 — chase early** | Fall back to a public benchmark subset; weaker but sufficient |
| Deployed API base URL and region | P3 | W8 | Region mismatch costs ~200 ms |

---

## 15 · Risk register

| Risk | Likelihood | Mitigation built in | Fallback |
|---|---|---|---|
| 85% raw threshold rejects everyone | near certain | Calibrated logistic confidence (§04) | `/v1/admin/recalibrate` + env overrides, adjustable mid-demo |
| OOM at 512 MB | medium | ONNX only, arena off, single session, single worker, CI memory gate | Smaller detector, or laptop + tunnel for the demo |
| Render hours exhausted mid-month | medium | Provider split + windowed keep-alive (§10) | Disable keep-alive outside demo week |
| Cold start during the presentation | medium | Redundant cron providers, boot warmup, written protocol | Local `docker compose` + ngrok, rehearsed in W8 |
| Person 3's API is late | medium | Standalone service + mock API in compose | Demo the AI service through its own OpenAPI page |
| Teammates don't supply photos | medium | W5 start with an explicit chase date | Public benchmark subset; document the weaker provenance |
| FLE master key lost | low | Two offline backups, documented custody | Re-enrol everyone — recoverable at demo scale |
| Preprocessing drift invalidates calibration | low | Golden test + fingerprint guard + one shared function | Re-fit from the stored dataset, ~20 minutes |
| Photo/screen spoof succeeds in the viva | medium | Named as a known limitation with a concrete path (§07) | Answer with the MiniFASNet and Play Integrity roadmap |

---

## 16 · Definition of done

- [ ] A live check-in returns `approved` end to end in under 3 seconds warm
- [ ] `calibration.json` fitted on ≥ 8 identities, TAR ≥ 0.90 at FAR ≤ 0.01
- [ ] Every reason code reachable and covered by a test
- [ ] A stored embedding is unreadable without the key — demonstrated on the raw document
- [ ] Employee A's envelope on Employee B's document yields `DECRYPT_FAILED`, not a false match
- [ ] Mock-location returns 403 and raises an HR alert
- [ ] A re-submitted selfie returns 409
- [ ] Six wrong PINs lock the account; PINs appear in no log line
- [ ] Peak RSS under 380 MB across 50 sequential verifications, asserted in CI
- [ ] Image under 450 MB, non-root, weights baked in, no runtime downloads
- [ ] Keep-alive on two providers; `/health` uptime over 99% across 72 h
- [ ] Render instance-hour projection under 750, arithmetic shown
- [ ] CI green: lint, types, unit, contract, security, golden, memory, blocklist
- [ ] `docker compose up` works from a clean clone on a teammate's machine
- [ ] FLE master key backed up in two locations outside the platform
- [ ] Adversarial results — print, screen, wrong person — tabulated honestly
- [ ] All documents written; demo rehearsed against the written protocol

---

## 17 · Handover package

| Artifact | Audience | Contents |
|---|---|---|
| `pnsm-ai-svc` repository | Team, faculty | Source, tests, CI, Docker, deploy config |
| `docs/API.md` + `openapi.json` | P1, P2, P3 | Every endpoint, schema and reason code |
| `docs/CALIBRATION.md` | Faculty | Method, ROC, histogram, operating point, measured FAR/FRR |
| `docs/SECURITY.md` | Faculty | Threat model, controls, trust boundaries, named limitations |
| `docs/RUNBOOK.md` | Team | Deploy, rotate, recalibrate, demo-day protocol |
| `docs/INTEGRATION.md` | Team | The merge contract |
| `docs/HANDOVER.md` | Faculty | Module report mapped to the BDT 72,000 allocation |
