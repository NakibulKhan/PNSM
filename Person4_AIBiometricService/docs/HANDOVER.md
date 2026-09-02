# Person 4 — module handover

**Module:** AI Biometrics, Cryptography & Cloud DevOps
**Allocation:** BDT 72,000 (~24% of BDT 300,500)
**Window:** Weeks 3–8 · **Deliverable:** `pnsm-ai-svc`

---

## 1. Delivered against the budget

| Component | Scope in the proposal | Allocation | Delivered |
|---|---|---|---|
| DevOps & containerisation | Dockerising the API runtime for cross-team consistency | BDT 9,000 | Multi-stage Dockerfile for this service (non-root, weights baked in, HEALTHCHECK) **and `deploy/frontend.Dockerfile` for Persons 1 and 2** (node:24-slim builder → nginx:alpine, size-gated under 50 MB in CI), `docker compose` stack with MinIO and a mock Person 3 API, GitHub Actions CI with lint/type/test/memory/manifest/supply-chain/image jobs and a dependency blocklist |
| AI pipeline integration | DeepFace embedding generation, 1:1 cosine matching, 85% threshold logic | BDT 34,000 | ONNX ArcFace (`w600k_mbf`, 512-d) with memory-tuned sessions, YuNet detection with 5-point landmarks, Umeyama alignment, CLAHE, quality gating, **and a fitted calibration replacing the unusable raw threshold** |
| Cryptographic & OS security | bcrypt PIN hashing, field-level encryption, mock-location detection | BDT 20,000 | AES-256-GCM with AAD binding **over AWS KMS envelope keys**, encryption-context binding enforced in the key policy, static→KMS migration tool, peppered bcrypt with lockout and weak-PIN policy, HMAC service auth, device/staleness/nonce/image-replay guards, log redaction |
| Deployment & cloud setup | AWS S3 + IAM credentials, CloudFront distributions, Atlas strings, in week 1 | BDT 3,000 | S3/MinIO storage layer with presigned transfer, **ECS Fargate task definition, CloudFront distribution with the 403/404→index.html SPA rewrite, response-headers policy, five IAM policy documents, `scripts/provision_aws.py`** to render and apply them, warmup, demo-day protocol |
| Post-launch maintenance | Phase 1 SLA, uptime, security oversight | BDT 3,000 | Runbook, `/metrics`, memory benchmarks, incident procedures, troubleshooting table, **the OWASP A01/A02/A03 audit with eleven findings handed to the other quadrants**, and a supply-chain gate that runs weekly as well as on every push |
| **Total** | | **BDT 72,000** | |

---

## 2. What changed from the original specification

Three findings, all documented with evidence. Each is cheap now and expensive in
Week 8.

**1. The 85% threshold could not have worked.** FR-07 defines confidence as
`cosine × 100` with approval at 85. DeepFace's calibrated default for ArcFace is a
cosine *distance* of 0.68 — a similarity of 0.32. Genuine pairs across different
lighting land between roughly 0.35 and 0.75. As written, nearly every legitimate
check-in would have been flagged. The fix keeps FR-07's wording exactly true by
computing confidence as a fitted logistic function of cosine. Method and evidence:
[`CALIBRATION.md`](CALIBRATION.md).

**2. MongoDB CSFLE cannot deliver the cipher the master plan specifies.** The
plan asks for CSFLE with **AES-256-GCM**. MongoDB's CSFLE encrypts with
AEAD_AES_256_CBC_HMAC_SHA_512 — authenticated, but CBC, and the driver offers no
GCM option. Implementing it as specified would have meant shipping a different
cipher from the one written down. Encryption therefore happens in this service,
which is the only component that holds a plaintext embedding anyway, using
AES-256-GCM over data keys minted and wrapped by AWS KMS. The plan's wording is
satisfied literally and Person 3 needs no key vault: [`AWS.md`](AWS.md), D-12.

*(This supersedes an earlier finding about Render/Koyeb free-tier instance hours,
which the move to AWS retired. It is kept in D-17 because the arithmetic was
correct and because Fargate has no free tier at all — a cost worth stating
before the demo rather than after.)*

**3. bcrypt was carrying weight it cannot carry.** It protects a stolen database,
not against online guessing of a six-digit PIN, and at cost 12 on half a vCPU it
consumes seconds of a three-second budget. It is now one of four layers, with
lockout doing the real work: [`SECURITY.md`](SECURITY.md) §4.

---

## 3. Verification

```
389 tests pass without pytest, FastAPI, boto3 or bcrypt installed
    python scripts/verify_offline.py
pytest adds the two FastAPI-dependent modules and the real bcrypt path
    pytest
```

**What was executed, and what was not.** The module was built in an environment
with no access to PyPI, so the suite was deliberately structured around that:
business logic lives in `app/services/`, testable with no HTTP server, and the
ASGI middleware is raw ASGI, testable against bare Starlette. Everything below
has actually been run.

Two modules have **not** been executed — `tests/api/test_routes.py` and
`tests/contract/test_openapi.py`, both of which need FastAPI. The code they
cover (`app/main.py`, `app/deps.py`, `app/routers/*`) is thin adaptation over
services that are tested, and `tests/contract/test_route_inventory.py` verifies
the route table, the exempt list and the admin guards by parsing the source. Run
`pytest` once after installing dependencies to close the gap properly.

| Property proven | Where |
|---|---|
| AES-GCM round-trip; tampered ciphertext/tag/model version all fail closed | `tests/unit/test_fle.py` |
| Employee A's envelope cannot authenticate Employee B | `test_aad_binding_blocks_cross_employee_substitution` |
| 2,000 seals produce 2,000 distinct IVs | `test_every_seal_uses_a_fresh_iv` |
| Key rotation preserves the vector exactly | `test_key_rotation_preserves_the_vector` |
| Confidence is calibrated, not `cosine × 100` | `test_confidence_is_calibrated_not_cosine_times_one_hundred` |
| The fitted map accepts > 90% of genuine pairs where the naive rule accepts < 5% | `test_the_fitted_map_beats_the_naive_rule_on_realistic_data` |
| Umeyama recovers a known similarity transform to 1e-9 | `test_umeyama_recovers_a_known_similarity_transform` |
| Preprocessing is byte-identical across runs | `tests/golden/` |
| Every preprocessing knob moves the fingerprint | `test_fingerprint_changes_when_any_knob_changes` |
| Mock location, emulator, staleness, request replay, image replay all fire | `tests/security/test_guards.py` |
| Lockout stops guessing and does not extend itself | `tests/security/test_lockout.py` |
| Every auth rejection is indistinguishable to the caller | `test_every_rejection_returns_the_same_message` |
| Path traversal in an object key is refused | `tests/unit/test_keys.py` |
| Replay caches are memory-bounded | `tests/security/test_stores.py` |
| Peak RSS stays under 380 MB across 50 verifications | `tests/memory/` |
| The reason-code table matches the published contract | `tests/contract/test_reason_codes.py` |
| The request body survives drain-verify-replay in the middleware | `tests/api/test_middleware.py` |
| A body altered after signing is refused; `/health` stays exempt | `test_a_body_altered_after_signing_is_refused` |
| An oversized body is refused without being buffered | `test_an_oversized_body_is_refused_without_being_buffered` |
| The size ceiling is checked before an object body is read | `tests/unit/test_s3.py::test_size_is_checked_before_the_body_is_read` |
| Presigned PUTs sign the content type and the exact length | `test_presigned_put_signs_the_type_and_the_exact_length` |
| An upstream failure never leaks a botocore exception | `test_a_transport_failure_does_not_leak_a_botocore_exception` |
| The composition root wires a working enrol-then-check-in path | `tests/unit/test_runtime.py` |
| A calibration fitted on another pipeline refuses to start | `test_a_calibration_fitted_on_another_pipeline_is_refused` |
| The route table, exempt list and admin guards match the contract | `tests/contract/test_route_inventory.py` |
| KMS mints a fresh data key per enrolment, never reusing one | `tests/unit/test_keyproviders.py::test_kms_mints_a_fresh_data_key_per_enrolment` |
| A wrapped key stolen for Alice cannot be unwrapped for Bob | `test_unwrapping_under_a_different_context_is_refused` |
| The DEK cache prevents a KMS round trip on every check-in | `test_the_data_key_cache_avoids_a_kms_call_per_check_in` |
| A KMS outage surfaces as a clean error, never as a silent fallback | `test_a_kms_outage_surfaces_as_key_unavailable` |
| Migrating static→KMS preserves every vector exactly | `test_migrating_from_static_keys_to_kms_preserves_the_vector` |
| The rotation tool writes nothing unless every record verifies | `tests/unit/test_rotate_keys.py` |
| The encryption context in the IAM policy matches what the code sends | `tests/deploy/test_manifests.py::test_the_encryption_context_matches_what_the_code_actually_sends` |
| No IAM policy grants `*` on `*`, and `PassRole` is scoped to ECS | `tests/deploy/test_manifests.py` |
| CloudFront rewrites **403 as well as 404** to `index.html` | `test_the_spa_rewrite_covers_403_as_well_as_404` |
| No secret reaches the task through `environment` | `test_no_secret_is_passed_through_the_environment_block` |
| The nginx and CloudFront security policies have not drifted apart | `tests/security/test_headers_parity.py` |
| An audit that could not run fails the build instead of passing | `tests/deploy/test_audit_gate.py` |
| An npm 6 audit document is refused rather than read as clean | `test_the_npm_6_schema_is_refused_rather_than_read_as_clean` |

---

## 4. Before the demo — five things

These need real-world input that code cannot supply.

### 4.1 Fit the calibration on the team's own photographs · **highest value**

`calibration/calibration.json` is currently a **bootstrap** fit from literature
defaults, marked as such in its own `provenance` field. Replace it:

```bash
# 8-10 photos per person, ~10 identities, varied lighting -- see CALIBRATION.md §4.1
make calibrate
```

This produces the ROC curve, the score histogram and the measured FAR/FRR — the
most credible figure the group can put in front of the faculty. It is roughly an
hour of work and it is the single most valuable hour left in the module.

### 4.2 Benchmark bcrypt on the deployed container

```bash
python scripts/bench_bcrypt.py --budget-ms 200
```

On the Fargate task, not a laptop. Record the number in `SECURITY.md` §4.

### 4.3 Generate the OpenAPI contract

```bash
make openapi   # writes docs/openapi.json
```

Run this once after installing dependencies, commit the result, and send it to
Persons 1–3. CI checks it stays current.

### 4.4 Commit the model checksums

```bash
make models    # downloads the weights and writes models/checksums.txt
```

Commit `models/checksums.txt`. `.gitignore` un-ignores it deliberately: until it
is in the repository, the SHA-256 pinning detects a *changed* upstream artifact
but not a *wrong first* download, which is half of the A03 control described in
[`OWASP.md`](OWASP.md).

### 4.5 Lock the dependencies

```bash
make lock      # writes requirements.lock with hashes
```

Commit it. The Dockerfile installs from the lock when present, which makes the
deployed image reproducible.

---

## 5. Known limitations, stated deliberately

Naming these is the point. A limitation the team raises reads as rigour; the same
limitation raised by an examiner reads as an oversight.

| Limitation | Consequence | Production path |
|---|---|---|
| No presentation-attack detection | A printed photo or phone screen can pass | MiniFASNet, ~1.9 MB ONNX, ~15 ms — fits the budget |
| Device flags are self-reported | A rooted phone can strip `is_mock_location` | Play Integrity API / DeviceCheck |
| Single-instance state | Replay caches and lockout do not survive a restart | `RedisTTLStore` already implements the protocol |
| Cold start after a task replacement | 30–60 s on the first request after a deploy | Rolling deployment with a warm second task before the old one drains |
| Fargate has no free tier | The always-on tasks are the dominant monthly cost | Scale to zero outside working hours, or consolidate the four secrets |
| The DEK cache holds plaintext keys in memory | A memory dump during the TTL window exposes data keys | Set `PNSM_KMS_DEK_CACHE_TTL_S=0` and pay a KMS round trip per check-in |
| `--apply` provisioning is not idempotent end to end | A re-run creates a second CMK | Terraform or CDK, once the topology stops changing |
| No mutual TLS | HMAC authenticates the caller, not the channel | mTLS between services |

---

## 6. Repository map

| Path | What it is |
|---|---|
| `app/` | The service. `runtime.py` is the composition root; `services/` holds the use cases |
| `calibration/build_calibration.py` | The ROC fit. Read `CALIBRATION.md` before running it |
| `clients/` | Ready-to-copy clients for Person 3 — Node (zero deps) and Python (httpx) |
| `deploy/` | ECS task definition, CloudFront, nginx template, the frontend image, five IAM documents |
| `scripts/` | Keys, models, AWS provisioning, key rotation, dependency audit, benchmarks, smoke test, offline verifier, mock backend |
| `tests/` | 389 offline plus the two FastAPI modules, across unit, security, contract, api, deploy, golden and memory |
| `docs/PLAN.md` | The blueprint this was built from |
| `docs/INTEGRATION.md` | **The merge contract.** Start here when the modules come together |
| `docs/AWS.md` | The AWS topology and the reasoning behind each piece |
| `docs/OWASP.md` | The A01/A02/A03 audit and its eleven handoffs |
| `docs/MASTER_PLAN_ALIGNMENT.md` | Every Quadrant IV clause, and where it is implemented |
| `docs/DECISIONS.md` | Every departure from the plan, with reasoning |

---

## 7. For the final report

Material worth lifting directly:

- **The threshold finding** (`CALIBRATION.md` §1–2) with the DeepFace ArcFace
  citation. It demonstrates that the specification was tested against reality
  rather than implemented literally.
- **The ROC curve and score histogram** from `make calibrate`, with measured FAR,
  FRR and AUC.
- **The memory budget table** (`PLAN.md` §09), read against the 1024 MB the
  Fargate task now requests rather than the 512 MB free-tier figure it was
  written for, with the measured number from `make bench-memory`. The measured
  ceiling did not move; the headroom did.
- **The latency budget** (`PLAN.md` §11) showing the warm path clears the
  three-second NFR with 40% headroom and the cold path misses it thirty-fold —
  which is what justifies keeping a task always running.
- **The CSFLE cipher finding** (`DECISIONS.md` D-12). It is a specific,
  checkable claim about a named product's cryptography, and it shows the
  specification was read closely enough to notice that two of its requirements
  could not both be met the obvious way.
- **The OWASP audit** (`OWASP.md`), including the eleven findings handed to other
  quadrants. An audit that only reports what the auditor already fixed is not
  an audit, and the handoff table is the evidence of that distinction.
- **The AAD binding** (`SECURITY.md` §3) as a control that goes beyond the
  specification and costs one line.
- **The limitations table** in §5 above, with its upgrade paths.
