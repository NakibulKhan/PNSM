# Decision log

Where the implementation departs from the blueprint in [`PLAN.md`](PLAN.md), and
why. A plan that survives contact with code unchanged usually means the code was
not examined closely enough; a plan whose departures are undocumented means the
next person cannot tell a decision from an accident.

---

## D-01 · YuNet instead of SCRFD for face detection

**Plan:** SCRFD-500M ONNX (`det_500m.onnx`, 2.52 MB) with hand-written anchor
decoding and NMS.
**Built:** OpenCV's bundled **YuNet** (`face_detection_yunet_2023mar.onnx`,
~233 KB) via `cv2.FaceDetectorYN`.

**Why.** Three reasons, in order of weight:

1. **Roughly 120 lines of the most bug-prone code in the pipeline do not exist.**
   Anchor decoding and NMS are exactly where a subtle indexing error produces
   landmarks that are *nearly* right — which shifts alignment, which shifts every
   embedding, which silently degrades matching without raising anything. OpenCV
   does that work in tested C++.
2. **It emits the five landmarks ArcFace alignment needs, natively**, in the same
   eye/nose/mouth ordering.
3. **It is a tenth of the size**, which matters when the weights are baked
   into the image and the image has a size gate.

**Trade-off.** SCRFD is marginally stronger on small, heavily rotated or occluded
faces. Irrelevant here: check-in faces are cooperative, near-frontal and fill a
good share of the frame, and the quality gate rejects anything else before the
detector's edge cases could matter.

**Reversible?** Yes. `FaceDetector` is a protocol; an `ScrfdDetector` implementing
`detect() -> list[Detection]` drops in. Doing so changes the preprocessing
fingerprint, so re-fit the calibration.

---

## D-02 · CLAHE after alignment, not before

**Plan:** "CLAHE runs before alignment, on the detected crop."
**Built:** align → CLAHE on the 112×112 chip → normalise.

**Why.** Equalising after the warp means CLAHE sees exactly the pixels the model
will, not a loose bounding box that includes background. On a full frame or a
generous crop, a bright window dominates the histogram and washes the face out —
which is the failure CLAHE was added to prevent.

The two operations are independent — one geometric, one photometric — so the
order does not change what alignment produces. What matters, and is enforced, is
that enrolment and verification use the identical path.

**Trade-off.** Warping resamples, and CLAHE afterwards can marginally amplify
interpolation artefacts. Negligible at 112×112 with linear interpolation, and
absorbed by the calibration in any case.

---

## D-03 · Calibrated logistic confidence instead of `cosine × 100`

**Plan:** identified the problem and specified the fix.
**Built:** exactly that, plus a structural guard the plan did not call for.

The addition is the **preprocessing fingerprint**: a hash of every knob that can
move a score, written into `calibration.json` and re-checked at boot. The plan
protected against pipeline drift with a golden-vector test, which catches a
change in CI. The fingerprint also catches a calibration that was *fitted*
against a different pipeline — a stale `calibration.json` copied forward, or a
deploy that reverted a preprocessing change. The service refuses to start rather
than serving decisions from a mapping that no longer describes it.

See [`CALIBRATION.md`](CALIBRATION.md).

---

## D-04 · In-memory stores by default; Redis behind the same protocol

**Plan:** "`request_id` nonce cached in Redis/in-memory TTL 10 min."
**Built:** in-memory as the default and the deployed configuration, with
`RedisTTLStore` implementing the same protocol for later.

**Why.** The service runs a single uvicorn worker, so in-process state is
*correct*, not merely convenient — there is no second worker to fall out of sync
with. Adding Redis to the free-tier footprint would mean another container to
keep warm, another failure mode, and another dependency, in exchange for
consistency that a one-instance deployment already has.

Every store is bounded (`max_entries`, `max_keys`) because an unbounded replay
cache is itself a denial-of-service vector inside a fixed memory limit. `tests/security/test_stores.py`
asserts those bounds.

**When to revisit.** The moment a second instance is deployed. The swap is one
line in `SecurityGuards`; nothing above it changes.

---

## D-05 · An extra `services/` layer between routers and domain code

**Not in the plan.** The plan's repository layout put use-case logic in the
routers.

**Why it was added.** It makes roughly 85% of the module testable without an HTTP
server, which turned out to matter more than expected: `tests/unit/test_services.py`
exercises the whole enrol-then-verify story — including every guard, the
encryption boundary and the banding — with no FastAPI in the process. That is
also what lets `scripts/verify_offline.py` verify the core on a machine where
FastAPI, boto3, bcrypt and pytest are not installed.

**Cost.** One more layer to read through. Worth it.

---

## D-06 · No `python-ulid` dependency

**Plan:** listed ULID handling as a dependency.
**Built:** a 40-character regex.

Person 1 *generates* ULIDs; this service only ever validates the shape of one it
was handed. Crockford base32, 26 characters, `I`/`L`/`O`/`U` excluded — that is a
regex, not a package. One fewer dependency in a container measured in megabytes.

The clients in `clients/` do generate ULIDs, in about ten lines each, so Person 3
needs no dependency either.

---

## D-07 · Presigned PUT with a signed `Content-Length`

**Plan:** "≤ 200 KB signed into the URL."
**Built:** the caller declares the exact byte count and it is signed into the URL.

**Why.** A presigned PUT signs headers; it does not express a range. A presigned
**POST** policy can express `content-length-range`, but it is a multipart form
flow rather than a single `PUT`, which is materially more code on the Capacitor
side and one more thing to get wrong on a phone. Signing the exact length is
simpler, strictly tighter — a range permits anything inside it, an exact length
permits one value — and the mobile client already knows the size, because it has
just finished compressing the image to fit under 200 KB.

*(This decision predates the move to AWS. It was originally argued partly on
Cloudflare R2's thinner POST-policy support; that premise is gone, and the
reasoning above is what still holds on S3.)*

**Cost.** The client must send the real size, not an estimate. Documented in
[`INTEGRATION.md`](INTEGRATION.md) §3.1 and enforced by the bucket, which is a
better place for it than trust.

---

## D-08 · Response models document, they do not filter

**Not in the plan.**

FastAPI's `response_model=` silently *drops* fields not declared on the model. A
silently truncated response is worse than a loud mismatch: Person 2's dashboard
would simply stop receiving `image_hash` one day with nothing in any log.

So response models are attached via `responses={200: {"model": X}}`, which
documents without filtering, and `tests/contract/test_openapi.py` validates real
responses against the generated schema with `jsonschema`. Drift is caught in both
directions, and nothing is dropped in production.

---

## D-09 · Request models forbid unknown fields

**Not in the plan.**

`extra="forbid"` on every request body. A typo'd field name that is silently
ignored is exactly how a security flag like `is_mock_location` ends up never being
read — the request looks fine, the response looks fine, and the check never runs.
Rejecting the request makes the typo a five-second fix instead of a silent hole.

---

## D-10 · Requirement ranges plus a lock file, not hashes in `requirements.txt`

**Plan:** "`requirements.txt` is pinned with hashes."
**Built:** ranges in `requirements.txt`, hashes in `requirements.lock` generated
by `make lock`, and a Dockerfile that prefers the lock when present.

**Why.** Hash pinning requires resolving against a package index, which is a
build-time operation, not something to hand-write. Keeping the human-edited file
readable and generating the machine-verified one preserves both properties. The
Dockerfile installs with `--require-hashes` when the lock exists and prints a
warning when it does not.

**Action for the team:** run `make lock` and commit `requirements.lock` before the
Week 8 deploy, so the deployed image is reproducible.

---

## D-11 · A dependency blocklist enforced in CI

**Not in the plan**, though the plan named the risk.

`scripts/check_deps.py` fails the build on `tensorflow`, `torch`, `keras`,
`deepface` or `insightface` — declared, installed, or imported. The plan warned
that installing `deepface` would blow the memory ceiling. A warning in a document
is not a control; a red build is.

Split into two severities: memory-killers are fatal anywhere, bloat (`pandas`,
`scipy`, non-headless OpenCV) is fatal only when declared as a runtime dependency,
so a developer's shared interpreter does not produce false failures.

---

## D-12 · Application-layer AES-256-GCM with KMS envelope encryption, not MongoDB CSFLE

**Master plan:** "the application must execute Client-Side Field Level
Encryption (CSFLE) utilizing an **AES-256-GCM** cipher on the embedding vector
array... the distinct encryption keys held securely within the **AWS Key
Management Service**."

**Built:** application-layer AES-256-GCM in `app/crypto/fle.py`, with data keys
minted and wrapped by AWS KMS (`app/crypto/keyproviders.py`).

**Why.** The plan names two things that MongoDB's CSFLE feature cannot both
provide. MongoDB CSFLE encrypts fields with **AEAD_AES_256_CBC_HMAC_SHA_512** —
AES-256 in CBC mode with an HMAC-SHA-512 tag. That is a sound authenticated
cipher, but it is not AES-256-GCM, and the driver does not offer GCM as an
option. Using CSFLE would mean either quietly shipping a different cipher from
the one specified, or claiming GCM in a document while CBC ran in production.

Encrypting in this service instead satisfies the plan literally and is a better
fit besides:

- **GCM, as specified**, with a 96-bit nonce and a full 128-bit tag.
- **The vector is already here.** This is the only component that ever holds a
  plaintext embedding. Encrypting where the plaintext lives means it never
  crosses a process boundary unprotected; CSFLE would put the plaintext in
  Person 3's Node process first.
- **AAD binds the envelope to an employee.** `user_ref|model_version|key_id` is
  authenticated, so Employee A's stored envelope cannot be replayed to
  authenticate Employee B. CSFLE's deterministic mode gives equality search but
  no such binding, and randomised mode gives neither.
- **Person 3 stores an opaque document** and needs no CSFLE key vault, no
  `AutoEncryptionOpts`, and no `mongocryptd` sidecar in the API container.

**What is given up.** No queryability on the encrypted field. Irrelevant: a
512-float vector is never a query predicate, it is fetched by `user_id` and
compared in this service.

**Reversible?** The envelope is versioned and the key provider is pluggable, so
a move to CSFLE would be a re-wrap pass, not a re-enrolment. It would still
change the cipher, which is why it is not the default.

---

## D-13 · Embeddings live in `FaceEmbeddings`, which this service never connects to

**Master plan:** "The embeddings must be excised from the Users object and
placed in an isolated, highly restricted `FaceEmbeddings` collection."

**Built:** `/v1/embed` returns `storage_target: {collection: "FaceEmbeddings",
link_field: "user_id"}` alongside the envelope, and this service holds no
MongoDB connection at all.

**Why.** The plan's requirement is about *where the data lives*, and the
collection belongs to Person 3's data layer. Two components writing the same
collection is how a schema drifts and how a migration becomes a negotiation.

But leaving the requirement as prose in an integration document is how it gets
missed under deadline: the path of least resistance is `db.users.updateOne({},
{$set: {embedding: env}})`, which is exactly the anti-pattern the plan calls
out. So the requirement travels **in the response body**, where Person 3's code
reads it, and `tests/unit/test_services.py` asserts the field is present and
correct.

**Cost.** One extra field on every enrolment response, and a convention rather
than an enforcement. Enforcement lives on Person 3's side; the handoff is
recorded in `docs/INTEGRATION.md`.

---

## D-14 · Selfies are not served through CloudFront

**Master plan:** "CloudFront for edge-cached CDN delivery."

**Built:** CloudFront in front of the SPA bundle only. Selfies stay in S3 behind
presigned URLs with a 120-second lifetime.

**Why.** A CDN caches public, static, frequently-read content at hundreds of
edge locations. Selfies are private personal data, retained 90 days, read a
handful of times by an HR reviewer and never by the public. Putting them behind
CloudFront would:

- copy biometric images to 400+ edge locations worldwide, which is the opposite
  of the "data sovereignty via VPC" the same plan asks for;
- save a latency nobody is waiting on — an HR dashboard opening one image is not
  latency-sensitive;
- make deletion approximate. A CloudFront invalidation is a cache eviction, not
  an erasure, and the 90-day lifecycle rule would no longer be the whole story.

`PNSM_CLOUDFRONT_DOMAIN` exists and is wired through, so the decision is a
configuration value rather than a hard-coded assumption. It ships empty.

**Reversible?** Yes, and if it is reversed the distribution needs signed URLs or
signed cookies — never public read. `tests/deploy/test_manifests.py` asserts the
selfie bucket is not an origin on the committed distribution.

---

## D-15 · Two decision bands by default, three available

**Master plan:** "If the resultant geometric similarity score evaluates to 85%
or higher... the check-in is programmatically approved... If the score falls
below the threshold, the anomaly is flagged, the status is set to **rejected**,
and an instant WebSocket alert is routed to the HR dashboard."

**Original spec (FR-07):** "otherwise it is **flagged** for HR review."

**Built:** both, selected by `PNSM_DECISION_BANDS`, defaulting to the master
plan's two-band rule.

**Why.** The two documents describe genuinely different policies for the same
score, and picking one silently would misrepresent whichever was dropped. They
approve at exactly the same number; they differ only in what happens below it —
reject-and-alert, or flag-and-review. That is a business decision about whether
a borderline employee waits at the door or is checked in pending review, not a
modelling one, so it is a setting.

The default is the master plan's, because a service that flags where the plan
says reject would let a borderline stranger through. `hr_alert` is true under
both models for anything short of a clean approval, so Person 3's WebSocket
alert is wired the same way either way.

`tests/unit/test_score.py` asserts the approve threshold is identical across
both models, and that the flag threshold is published in `/v1/verify`'s
`threshold` object only when the three-band model is actually in use —
advertising a threshold the service never applies would mislead HR.

---

## D-16 · Security headers implemented three times, tested for parity

**Master plan:** "integrate the helmet package into the Node.js runtime to
inject robust security headers."

**Built:** `app/security/headers.py` for this service, `deploy/nginx.conf.template`
for a containerised frontend, and
`deploy/cloudfront-response-headers-policy.json` for the SPA served from S3.

**Why.** `helmet` is Express middleware and belongs to Person 3's service. The
PNSM system emits HTTP responses from three other places, and a header set on
only one of them is a header an attacker simply routes around. There is no
single place to put this.

Three copies drift, quietly and asymmetrically, so
`tests/security/test_headers_parity.py` compares the two frontend policies
directive by directive and fails on divergence. The API's policy is deliberately
*different* — `default-src 'none'`, because it returns only JSON and can afford
the strictest policy there is — and the test asserts that difference rather than
demanding uniformity.

The headers middleware is raw ASGI and added last, making it outermost, so it
wraps the 401 the HMAC layer produces. That response is the one an attacker sees
most often and would otherwise be the one response with no headers at all.

---

## D-17 · The free-tier hosting analysis is retired, not corrected

**Superseded.** Correction 2 in `PLAN.md` argued that two always-warm services
do not fit one Render free workspace (750 instance-hours against ~1,460 needed),
and split the deployment between Koyeb and Render accordingly.

The master plan replaces that entire topology with AWS ECS Fargate, where tasks
do not idle-stop and there are no instance-hours to run out of. `koyeb.yaml` and
`scripts/keepalive.md` have been deleted rather than updated: a keep-alive cron
for a platform the project no longer uses is worse than no document, because
somebody will eventually follow it.

The reasoning is kept here because it was correct, and because the replacement
has its own cost story — Fargate has no free tier at all. `docs/AWS.md` carries
the numbers, and the two levers if they matter: scale to zero outside working
hours (about a 45-second cold start), or consolidate the four secrets into one.
