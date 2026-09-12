# Master plan alignment — Quadrant IV

Every requirement the four-member master plan places on Person 4 ("Biometric
Inference, Cloud Security, and DevOps"), what was built for it, and where to
look. Written so an examiner can check a claim in under a minute rather than
taking the summary on trust.

Six clauses could not be implemented exactly as written. Every one is marked
**adapted**, with the conflict stated, the resolution given, and the reasoning
recorded in `DECISIONS.md`. They are collected in §7. Nothing is quietly
reinterpreted, and nothing is claimed as met that is not.

Legend: **Met** — implemented as specified · **Adapted** — the requirement is
satisfied, by a route the plan did not name, for a reason given · **Handoff** —
belongs to another quadrant, recorded so it is not lost.

---

## 1. Biometric inference engine (1:1 facial matching)

| # | Master plan clause | Status | Where |
|---|---|---|---|
| 1.1 | "routes the raw binary image data to the AI inference engine" | Met | `POST /v1/verify`, `app/routers/biometrics.py` |
| 1.2 | "implement a convolutional neural network architecture (e.g. the open-source DeepFace library via a Python FastAPI microservice, or the managed AWS Rekognition `CompareFaces` API)" | Adapted | ONNX ArcFace (`w600k_mbf`, 512-d) in a Python FastAPI microservice, `app/ai/session.py` |
| 1.3 | "isolating facial landmarks" | Met | YuNet, five-point landmarks, `app/ai/detect.py` |
| 1.4 | "projects these geometric features into a highly dimensional mathematical array... an embedding vector" | Met | 512-d unit-normalised float32, `app/ai/engine.py` |
| 1.5 | "retrieves the employee's baseline reference embedding from the MongoDB database" | Met | Person 3 sends the stored envelope on the request; this service decrypts it. It holds no database connection — see 4.2 |
| 1.6 | "executes a Cosine Similarity calculation... the angle between the two highly dimensional vectors" | Met | `app/ai/score.py: cosine_similarity` |
| 1.7 | "If the resultant geometric similarity score evaluates to **85% or higher**... the check-in is programmatically approved" | Met | `approve_threshold = 85.0`, on the calibrated similarity scale |
| 1.8 | "If the score falls below the threshold... the status is set to rejected, and an instant WebSocket alert is routed to the HR dashboard" | Met | Two-band default; `hr_alert` in the `/v1/verify` response is the alert signal |

### 1.2 — why not DeepFace or Rekognition

The plan offers both as examples ("e.g."), not as a mandate, and both were
rejected on measurable grounds:

- **DeepFace** pulls TensorFlow or PyTorch: 1.2–2.5 GB resident on import,
  against a 1 GB task. It would be OOM-killed before the first check-in.
  `scripts/check_deps.py` fails the build if anyone adds it, because a warning in
  a README is not a control (D-11).
- **AWS Rekognition `CompareFaces`** sends the employee's face to a third-party
  API on every check-in and returns a similarity number the project cannot
  calibrate, inspect, or reproduce offline. It also conflicts with the plan's own
  "data sovereignty via VPC" and with the CSFLE requirement, since the plaintext
  face leaves the boundary.

ArcFace is the same architecture DeepFace wraps — the weights are the ones
DeepFace itself would download. Running them through ONNX Runtime keeps the model
and drops the framework: ~300 MB resident instead of ~2 GB, and inference is
deterministic and offline. `tests/golden/` pins the preprocessing byte-for-byte.

### 1.7 — the 85% is real, and is not `cosine × 100`

This deserves stating precisely, because it is the one place where a reader might
suspect the requirement was quietly relaxed.

The plan says the *similarity score* must evaluate to 85% or higher. It does not
say the score is the raw cosine multiplied by 100 — and it cannot be, because
ArcFace does not put genuine pairs there. DeepFace's own calibrated default for
ArcFace is a cosine **distance** of 0.68, i.e. a similarity of **0.32**. Genuine
same-person pairs across different lighting land roughly between 0.35 and 0.75.
A literal `cosine × 100 ≥ 85` rule would reject nearly every real employee.

So `confidence` is a fitted logistic function of cosine:

```
confidence = 100 / (1 + exp(-a · (cosine − b)))
```

`b` is set from the impostor distribution at a target false-accept rate; `a` from
the genuine distribution at a target coverage. One parameter is chosen by
security, the other by usability, and both are measured rather than assumed.
`confidence` is a similarity score expressed as a percentage, the threshold is
85, and the plan's sentence is true as written. `docs/CALIBRATION.md` has the
method; `tests/unit/test_score.py` asserts the naive rule would reject a pair the
fitted map approves.

---

## 2. AWS multi-stage Dockerization and edge routing

| # | Master plan clause | Status | Where |
|---|---|---|---|
| 2.1 | "containerized deployment strategy utilizing Docker and AWS Elastic Container Service (ECS) with Fargate compute clusters" | Met | `deploy/ecs-task-definition.json`, `requiresCompatibilities: ["FARGATE"]` |
| 2.2 | "Stage 1... a minimal Node.js image (e.g. `node:24-slim`)" | Met | `deploy/frontend.Dockerfile` |
| 2.3 | "The slim variant is prioritized over Alpine Linux, as Alpine relies on musl libc" | Met | Asserted in `test_the_builder_uses_node_24_slim_not_alpine` |
| 2.4 | "executes `npm ci` for deterministic package resolution" | Met | `test_dependencies_are_installed_deterministically` |
| 2.5 | "Stage 2... a microscopic, high-performance web server image (e.g. `nginx:alpine`)" | Met | `deploy/frontend.Dockerfile` stage 2 |
| 2.6 | "`COPY --from=builder` extracts purely the compiled HTML, CSS, and JS artifacts... discarding the heavy Node.js runtime entirely" | Met | `test_the_runtime_stage_discards_the_node_runtime` |
| 2.7 | "compresses the final container size to **under 50 megabytes**" | Met, and measured | CI job `frontend-image` builds the real Dockerfile and fails over 50 MB |
| 2.8 | "S3 for immutable image persistence" | Met | `app/storage/s3.py`, versioning on, no `s3:DeleteObject` for the task role |
| 2.9 | "CloudFront for edge-cached CDN delivery" | Adapted | `deploy/cloudfront-distribution.json` — SPA only, not selfies (D-14) |
| 2.10 | "complete data sovereignty via Virtual Private Clouds (VPC)" | Met | Tasks in private subnets; the AI service is not internet-reachable, only the ALB is |

**2.7 is a claim, so it is measured, not asserted.** `tests/fixtures/frontend-smoke`
is a zero-dependency stand-in shaped like a Vite project, because Person 1's and
Person 2's source lives in other repositories. CI builds the real Dockerfile
against it, gates the size, then starts the container and checks that a deep link
returns 200 with the SPA shell, that the CSP carries the injected origins, and
that nginx is not running as root.

**2.9 — the adaptation.** CloudFront fronts the SPA bundle: static, immutable,
read by everyone. It does not front the selfie bucket. Selfies are private
personal data with a 90-day retention, read a handful of times by HR; caching
them at 400+ edge locations would contradict the same plan's data-sovereignty
requirement, and an invalidation is not a deletion. `PNSM_CLOUDFRONT_DOMAIN`
exists and ships empty, so this is a configuration choice rather than a
hard-coded assumption (D-14).

---

## 3. Cloud security and OWASP compliance

| # | Master plan clause | Status | Where |
|---|---|---|---|
| 3.1 | "auditing the entire infrastructure against the OWASP top vulnerabilities" | Met | `docs/OWASP.md`, with eleven findings handed to other quadrants |
| 3.2 | A01: "never rely on client-side routing guards" | Met | HMAC middleware outside the routing layer; `docs/OWASP.md` §A01 |
| 3.3 | A01: "aggressively enforce the principle of least privilege" | Met | Split task/execution roles, no `kms:Encrypt`, no `s3:DeleteObject`, scoped `PassRole` |
| 3.4 | A01: "Every single API route must be shielded by the JWT verification middleware" | Adapted | HMAC-SHA256 service auth on every non-public route. JWT is Person 3's layer — see below |
| 3.5 | A02: "integrate the `helmet` package to inject robust security headers" | Adapted | `helmet` is Express middleware; the equivalent is implemented in all three non-Express servers (D-16) |
| 3.6 | A02: "Strict `Content-Security-Policy: default-src 'self'` and `X-Frame-Options: DENY`" | Met | Both, in all three places, with parity enforced by a test |
| 3.7 | A02: "all transit data... encrypted utilizing TLS 1.2+ certificates provisioned via AWS Certificate Manager" | Met | CloudFront `TLSv1.2_2021` + ACM; S3 denies `TlsVersion < 1.2`; the task role denies non-TLS |
| 3.8 | A03: "halt deployments if the `npm audit` command detects deep-tree vulnerabilities" | Met | `scripts/audit_deps.py`, exit 1 on high+, exit 2 if it could not run |
| 3.9 | A03: "strictly utilize `npm ci` paired with locked `package-lock.json` manifests" | Met | Enforced in the Dockerfile and refused by the audit script when the lock is absent |

**3.4 — HMAC rather than JWT, at this boundary.** The caller here is Person 3's
backend, not a browser: there is no user session to carry, no refresh cookie, and
no audience for an asymmetric signature. A shared-secret HMAC over
`"{timestamp}.{body}"` authenticates the *service* and the *exact bytes*, which
is the property that matters when the body is a biometric payload. JWT still
guards every route in the system: Person 3 verifies the employee's token, then
signs the onward call. Two layers answering two different questions — "which
employee is this?" and "is this really our backend?" — and neither substitutes
for the other. The plan's requirement is that no route is unshielded, and none is.

**3.5 — `helmet` three times over.** `helmet` is Express middleware and belongs
to Person 3's service. PNSM emits HTTP responses from three other places: this
FastAPI service, nginx in front of a containerised frontend, and CloudFront in
front of the S3-hosted SPA. A header set on only one of them is a header an
attacker routes around, so all three are hardened, and
`tests/security/test_headers_parity.py` fails when the two frontend policies
drift. The API's policy is deliberately *stricter* — `default-src 'none'`,
because it returns only JSON — and the test asserts that difference rather than
demanding uniformity (D-16).

---

## 4. Data privacy and client-side field level encryption

| # | Master plan clause | Status | Where |
|---|---|---|---|
| 4.1 | "A recognized vulnerability... storing raw biometric embeddings directly within the Users document profile" | Met | Named as a finding, fixed by 4.2 |
| 4.2 | "The embeddings must be excised from the Users object and placed in an isolated, highly restricted `FaceEmbeddings` collection" | Met | `storage_target` in the `/v1/embed` response; `docs/INTEGRATION.md` §2.3 (D-13) |
| 4.3 | "execute Client-Side Field Level Encryption (CSFLE) utilizing an **AES-256-GCM** cipher on the embedding vector array" | Adapted | Application-layer AES-256-GCM in `app/crypto/fle.py` — see below (D-12) |
| 4.4 | "before the data is transmitted to the MongoDB Atlas cluster" | Met | The envelope is sealed here; Person 3 only ever receives ciphertext |
| 4.5 | "the biometric arrays remain mathematically indecipherable without the distinct encryption keys" | Met | AES-256-GCM, 96-bit nonce, 128-bit tag, AAD binding `user_ref\|model_version\|key_id` |
| 4.6 | "keys held securely within the **AWS Key Management Service**" | Met | `app/crypto/keyproviders.py: AwsKmsKeyProvider`, envelope encryption |

**4.3 — the one requirement that cannot be met as literally written.** MongoDB's
CSFLE feature encrypts fields with **AEAD_AES_256_CBC_HMAC_SHA_512**. That is a
sound authenticated cipher, but it is AES in CBC mode, not GCM, and the driver
exposes no GCM option. The plan asks for CSFLE *and* for AES-256-GCM; the
MongoDB feature can supply the first or a different cipher, never both.

Resolving it in favour of the named cipher, and doing the encryption in the one
component that ever holds a plaintext embedding, satisfies the plan's actual
security goal more completely than CSFLE would:

- **GCM, as specified**, with a full-length tag.
- **The plaintext never crosses a process boundary.** With CSFLE the vector
  would be plaintext inside Person 3's Node process first.
- **The AAD binds an envelope to one employee**, so Employee A's stored envelope
  cannot authenticate Employee B — a property CSFLE does not offer in either
  deterministic or randomised mode. `tests/unit/test_fle.py` proves it.
- **Person 3 needs no key vault, no `AutoEncryptionOpts`, no `mongocryptd`.**

What is given up is queryability on the encrypted field, which is irrelevant: a
512-float vector is never a query predicate. It is fetched by `user_id` and
compared here.

**4.6 — how the KMS requirement is actually satisfied.** Envelope encryption. A
fresh data key per enrolment from `GenerateDataKey`; the vector encrypted locally
under it; the KMS-wrapped copy stored beside the ciphertext; the plaintext copy
discarded. The vector never reaches AWS, and the key that could open it never
exists outside this process for longer than one request.

The encryption context — `{user_ref, model_version, purpose}` — is what makes it
more than storage. KMS refuses an unwrap whose context differs from the wrap, in
CloudTrail, before this service sees a key. So a stolen wrapped key cannot be
redeemed for another employee, and every unwrap is attributable to one. The
condition is written into both the task role and the key policy, and
`tests/unit/test_keyproviders.py` stubs KMS with a client that enforces it, so
the property is tested rather than asserted.

---

## 5. Inter-quadrant integration and CI/CD cadence

| # | Master plan clause | Status | Where |
|---|---|---|---|
| 5.1 | "Person 4 must provision the AWS S3 IAM credentials, the AWS CloudFront distributions, and the MongoDB Atlas connection strings **within the first week**" | Met | `scripts/provision_aws.py` does it in one command |
| 5.2 | "distributing these cryptographic secrets to the team via secured environment variable files (.env)" | Adapted | `.env.example` locally; AWS Secrets Manager in every deployment — see below |
| 5.3 | "Code branches must be evaluated via automated security linting and merged... daily" | Met | `.github/workflows/ci.yml`: ruff, mypy, blocklist, supply-chain audit, manifests |
| 5.4 | "triggering automated Multi-Stage Docker builds and deployments to the AWS ECS staging clusters" | Met | The `image` and `frontend-image` jobs build both; OIDC deploy role in `deploy/iam/` |
| 5.5 | "immutable API JSON contracts" defined by Person 3 | Met | `docs/API.md` + `docs/openapi.json`, checked current in CI |

**5.2 — secrets do not travel in `.env` files in a deployment.** A `.env` handed
around a team is fine for local development and is exactly what `.env.example`
supports. In AWS the same values live in Secrets Manager and are resolved by the
ECS agent at task start through the task definition's `secrets` block — never
through `environment`, which is readable by anyone holding
`ecs:DescribeTaskDefinition`. The plan's intent is that the team is not blocked
waiting for credentials; the mechanism is upgraded because the plan's own A01
requirement points here.

**5.1 — the deadline is the point.** Three other people are blocked until the
bucket, the CloudFront distribution and the IAM credentials exist. That is why
provisioning is a script rather than a runbook: a script runs in one command,
identically, twice. `--check` refuses to render until every placeholder has a
value, because `<REGION>` in a log group name is accepted by the AWS API and
produces a log group literally called `<REGION>`.

---

## 6. Handoffs

Requirements the master plan places on Quadrant IV that can only be completed by
another quadrant. Recorded here so they are not lost between repositories; the
full list with reasoning is in `docs/OWASP.md`.

Ids match `docs/OWASP.md` exactly, so the two lists cannot drift into being
two different sets of eleven.

| # | What | Owner |
|---|---|---|
| A01-H1 | Route-level RBAC — an employee must not `PUT` a geofence | Person 3 |
| A01-H2 | Dashboard routing guards treated as usability, never as access control | Person 2 |
| A01-H3 | Atlas network access as an IP allow-list, not `0.0.0.0/0` | Person 3 |
| A01-H4 | `FaceEmbeddings` indexed unique on `user_id` and restricted at the database-user level | Person 3 |
| A01-H5 | WebSocket alert wired to the `hr_alert` field, not to a decision string | Person 3 |
| A02-H1 | `helmet` on the Express API, with `x-powered-by` disabled | Person 3 |
| A02-H2 | Atlas TLS required; database user scoped to the PNSM database, no `atlasAdmin` | Person 3 |
| A02-H3 | `usesCleartextTraffic="false"` on Android; empty ATS exception list on iOS | Person 1 |
| A03-H1 | `scripts/audit_deps.py --npm .` added to the mobile, web and API workflows | Persons 1, 2, 3 |
| A03-H2 | `package-lock.json` committed and `npm ci` used in all three Node repositories | Persons 1, 2, 3 |
| A03-H3 | Dependabot or Renovate enabled on the organisation — the gate catches a vulnerable dependency, it does not upgrade one | Whoever owns the org |

---

## 7. Summary

| Section | Clauses | Met | Adapted | Handoff |
|---|---|---|---|---|
| 1 Biometric inference | 8 | 7 | 1 | — |
| 2 Docker, ECS, edge | 10 | 9 | 1 | — |
| 3 OWASP | 9 | 7 | 2 | — |
| 4 CSFLE and KMS | 6 | 5 | 1 | — |
| 5 Integration and CI/CD | 5 | 4 | 1 | — |
| 6 Cross-quadrant | 11 | — | — | 11 |

Six adaptations, each with a stated conflict and a recorded decision:

| Clause | Conflict | Resolution | Record |
|---|---|---|---|
| 1.2 DeepFace / Rekognition | Memory ceiling; third-party data egress | ONNX ArcFace — the same weights, without the framework | D-11 |
| 2.9 CloudFront for delivery | Caching biometrics contradicts data sovereignty | CDN for the SPA; presigned S3 for selfies | D-14 |
| 3.4 JWT on every route | The caller is a service, not a browser | HMAC here; JWT at Person 3's boundary | `OWASP.md` §A01 |
| 3.5 `helmet` | Express-only, and there are three other servers | Equivalent headers in all three, parity tested | D-16 |
| 4.3 CSFLE with AES-256-GCM | MongoDB CSFLE is CBC, not GCM | Application-layer GCM where the plaintext already is | D-12 |
| 5.2 Secrets via `.env` | A `.env` in a deployment fails the plan's own A01 | `.env` locally; Secrets Manager in AWS | `AWS.md` |

One requirement is met in a way that is worth reading twice rather than
adapted — clause 1.7, the 85% threshold, which is satisfied literally on a
calibrated similarity scale. §1.7 above explains why the naive reading of it
would have rejected almost every genuine employee.

## Checking any of this

```bash
python scripts/verify_offline.py     # 389 tests, no pytest or FastAPI needed
pytest                               # adds the two FastAPI modules and real bcrypt
make manifests                       # every AWS document renders and holds its invariants
make audit                           # the supply-chain gate
make frontend-size                   # the 50 MB claim, measured
```
