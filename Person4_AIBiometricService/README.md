# pnsm-ai-svc

**AI biometrics, cryptography and cloud DevOps for the PNSM Workforce Attendance & Management System.**
CSE482L · Group 8 · North South University · Person 4 module.

This service is the only component that ever holds a plaintext face embedding or
the field-encryption key. Person 3's backend calls it over HTTP and stores the
opaque envelope it returns.

---

## Quick start

```bash
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
python scripts/gen_keys.py >> .env      # generates the four secrets
python scripts/fetch_models.py          # ~14 MB of ONNX weights
python scripts/export_openapi.py        # writes docs/openapi.json -- commit it
pytest                                  # everything should be green
uvicorn app.main:app --reload           # http://localhost:8000/docs
```

`docs/openapi.json` and `requirements.lock` are generated, not committed by the
author of this repository — run `make openapi` and `make lock` once after
installing, and commit both. **CI's `test` job fails until `docs/openapi.json`
exists**, deliberately: after that first commit the same check catches an API
that changed without the contract being re-exported, which is the failure that
breaks Persons 1, 2 and 3 simultaneously. The Dockerfile installs from the lock
when it is present and warns when it is not.

Or the whole backend at once — AI service, a mock of Person 3's API, and MinIO
standing in for S3:

```bash
docker compose up
```

No pytest, FastAPI, boto3 or bcrypt available? Almost everything still verifies:

```bash
python scripts/verify_offline.py   # 389 tests on numpy, OpenCV, cryptography, starlette
```

That runner covers the crypto, the KMS envelope path, the inference pipeline, the
calibration fit, every guard, the storage layer, the ASGI middleware, the
composition root, the route table, the AWS deployment manifests and the
supply-chain gate. Only `tests/api/test_routes.py` and
`tests/contract/test_openapi.py` need FastAPI and are skipped there — `pytest`
runs those too.

---

## Corrections this module makes to the specifications

Built to the four-member master plan, with [`docs/PLAN.md`](docs/PLAN.md) as the
detailed blueprint for this quadrant and
[`docs/MASTER_PLAN_ALIGNMENT.md`](docs/MASTER_PLAN_ALIGNMENT.md) as the
clause-by-clause record of how each requirement is met. Three findings changed
the design; a fourth was retired when the cloud provider changed, and is kept as
D-17 because the arithmetic in it was right.

### 1. An 85% raw cosine threshold rejects almost every real employee

FR-07 defines confidence as `cosine_similarity × 100` and approves at 85 — a raw
cosine of 0.85. ArcFace does not produce those numbers for real people. DeepFace's
own calibrated default for ArcFace is a cosine **distance** of 0.68, which is a
cosine **similarity** of 0.32. Genuine same-person pairs shot under different
lighting land between roughly 0.35 and 0.75; only near-duplicate frames exceed 0.85.

The fix keeps FR-07's wording exactly true by making confidence a *fitted*
logistic function of cosine rather than a multiplication:

```
confidence = 100 / (1 + exp(-a · (cosine − b)))
```

`b` comes from the impostor distribution at a target false-accept rate; `a` comes
from the genuine distribution so a chosen fraction of legitimate pairs clears the
approve band. One number is set by security, the other by usability, and both are
measured. See [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

### 2. MongoDB CSFLE cannot provide the cipher the master plan specifies

The master plan asks for "Client-Side Field Level Encryption (CSFLE) utilizing an
**AES-256-GCM** cipher", with the keys "held securely within the AWS Key
Management Service". MongoDB's CSFLE feature encrypts with
**AEAD_AES_256_CBC_HMAC_SHA_512** — a sound authenticated cipher, but CBC, not
GCM, and the driver offers no GCM option. Using it would mean shipping a
different cipher from the one specified.

So the encryption happens here, in the only component that ever holds a plaintext
embedding: AES-256-GCM with a 96-bit nonce, a full 128-bit tag, and AAD binding
the envelope to one employee — over data keys minted and wrapped by **AWS KMS**.
The plan is satisfied literally, and Person 3 stores an opaque document with no
key vault and no `mongocryptd` sidecar. See D-12 and [`docs/AWS.md`](docs/AWS.md).

*(This took the place of an earlier finding about free-tier instance hours on
Render and Koyeb — the retired fourth. Its reasoning is kept in D-17, because it
was correct, and because Fargate has its own cost story: no free tier at all.)*

### 3. bcrypt alone does not protect a four-digit PIN

bcrypt protects a *stolen database*. It does nothing against online guessing of a
10,000-value space, and at cost 12 on the task's half vCPU it eats
seconds out of the three-second check-in budget. It is one of four layers here:
a server-side pepper, a benchmarked cost, a six-digit minimum with weak-PIN
rejection, and per-user lockout — which is the layer that actually stops guessing.
See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## What this service does

| | |
|---|---|
| **Enrolment** (FR-01) | Reference photo → 512-d ArcFace embedding → returned **already encrypted** |
| **Verification** (FR-05, FR-07) | Live selfie → detect, align, equalise, embed → calibrated decision, with an HR alert flag |
| **Cryptography** | AES-256-GCM field encryption over AWS KMS envelope keys, with AAD binding; peppered bcrypt PINs with lockout |
| **Device integrity** | Mock-location, emulator, capture staleness, request replay, image replay |
| **Storage** | Presigned direct-to-S3 upload and download; SSE-KMS at rest, verified at readiness |
| **Operations** | Docker for all four services, ECS/S3/CloudFront/KMS/IAM manifests, CI with a supply-chain gate, health and readiness probes, warmup, metrics |
| **Security audit** | OWASP A01/A02/A03 across the infrastructure, with eleven handoffs named ([`docs/OWASP.md`](docs/OWASP.md)) |

What it deliberately does **not** do: MongoDB schema and queries, geofence maths,
JWT and RBAC, WebSocket broadcast, camera capture, dashboard UI. Those belong to
Persons 1–3. The boundary is in [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

---

## Architecture

```
Mobile (P1) ─┐                                     ┌── S3 pnsm-selfies (SSE-KMS)
             ├─→ PNSM API (P3) ──HMAC-signed──→ pnsm-ai-svc (P4)
Dashboard(P2)┘        │                             │   the only holder of a
                      ↓                             │   plaintext embedding
              MongoDB Atlas                         └── KMS: wraps every data key
              FaceEmbeddings
              (ciphertext only)
```

Both services run as ECS Fargate tasks; the dashboard bundle is served from S3
through CloudFront. The full topology, and why each piece is shaped that way, is
in [`docs/AWS.md`](docs/AWS.md).

A standalone service rather than a library inside Person 3's repository, because:

- **Language independence.** Inference is Python; Person 3 may choose Node.
- **Memory isolation.** The AI process is the one that can exhaust its task's
  memory. Shared with the API, an inference spike kills check-ins, geofencing and
  WebSockets at once. Isolated, a crash degrades to a rejected check-in with an
  HR alert.
- **Nobody blocks.** This service builds, tests, containerises and deploys without
  a line of Person 3's code existing.

The cost is one extra network hop (~20–60 ms same region) and a second container
to keep warm. Both are budgeted in [`docs/PLAN.md`](docs/PLAN.md) §11 and §10.

---

## Layout

```
app/
  main.py            FastAPI factory, middleware, one exception handler
  runtime.py         composition root -- everything is built here, once
  config.py          settings; refuses to start on a missing key or calibration
  errors.py          the reason-code table (a contract with P1 and P2)
  schemas.py         request/response models
  middleware.py      request id, body limit, HMAC verification
  ai/                detect, preprocess, embed, score, calibration
  crypto/            AES-256-GCM field encryption, peppered bcrypt, HMAC
  security/          device guards, replay stores, lockout
  storage/           object keys, presigning, S3/MinIO
  services/          use cases -- testable without an HTTP server
  routers/           thin adapters over services

calibration/         the fitting script and the committed fit
clients/             ready-to-copy clients for Person 3 (Python and Node)
deploy/              ECS task definition, CloudFront, nginx, frontend image, IAM
scripts/             keys, models, AWS provisioning, key rotation, dependency
                     audit, benchmarks, smoke test, mock backend
tests/               unit, security, contract, api, deploy, golden, memory
docs/                API, AWS, OWASP, SECURITY, CALIBRATION, RUNBOOK,
                     INTEGRATION, DECISIONS, PLAN
```

The `services/` layer exists so that the decisions live somewhere an HTTP server
is not required to test. That is why the suite still means something when FastAPI
is not installed.

---

## Common tasks

```bash
make help            # every target
make test            # full pytest suite
make verify          # dependency-light runner
make deps            # dependency blocklist: no tensorflow, torch, deepface
make audit           # supply-chain gate: fail on a high or critical advisory
make manifests       # every AWS manifest renders with no placeholder left
make frontend-size   # build P1/P2's image and check it against the 50 MB ceiling
make openapi         # re-export docs/openapi.json after an API change
make calibrate       # fit the threshold on calibration/dataset
make bench-memory    # resident memory with real ONNX sessions
make bench-bcrypt    # pick a bcrypt cost that fits the latency budget
make up              # docker compose: ai-svc + mock API + MinIO
make smoke           # end-to-end against a running service
```

On Windows without `make`, run the command each target prints — every one is a
single `python` or `docker` invocation.

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | The full execution blueprint this module was built from |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | **Read this before merging.** Who owns what, exact contracts, wiring |
| [`docs/API.md`](docs/API.md) | Every endpoint, every reason code, worked examples |
| [`docs/CALIBRATION.md`](docs/CALIBRATION.md) | Why 85% raw cosine fails, and the method that replaces it |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, controls, trust boundaries, named limitations |
| [`docs/AWS.md`](docs/AWS.md) | The AWS topology: ECS, S3, CloudFront, KMS, IAM, and the cost of it |
| [`docs/OWASP.md`](docs/OWASP.md) | The A01/A02/A03 audit, with eleven findings handed to other quadrants |
| [`docs/MASTER_PLAN_ALIGNMENT.md`](docs/MASTER_PLAN_ALIGNMENT.md) | Every Quadrant IV clause of the master plan, and where it is implemented |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deploy, rotate keys, recalibrate, monitor, demo-day protocol |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Where the implementation departs from the plan, and why |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Module report mapped to the BDT 72,000 allocation |

---

## Status

Weeks 3–8 of the module are implemented. What is left needs input this
repository cannot supply. The five build-and-commit steps are in
[`docs/HANDOVER.md`](docs/HANDOVER.md) §4; the three that matter most are:

1. **`calibration/calibration.json` is a bootstrap fit**, not a measured one. Run
   `make calibrate` on the team's own photographs — this is the single most
   valuable hour left in the module, and the resulting ROC curve is the most
   credible figure the group can put in front of the faculty.
2. **`PNSM_BCRYPT_COST` needs benchmarking** on the deployed Fargate task with
   `make bench-bcrypt`, not on a laptop.
3. **The AWS account has to exist.** `python scripts/provision_aws.py --check`
   passes against any account id; `--apply` needs real credentials. Everything
   else in this repository is verified without them.
