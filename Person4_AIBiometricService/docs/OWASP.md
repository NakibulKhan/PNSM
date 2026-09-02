# OWASP audit — PNSM Workforce Attendance & Management System

Person 4, Quadrant IV. Audited against the master plan's requirement:

> The DevOps engineer is responsible for auditing the entire infrastructure
> against the OWASP top vulnerabilities.

**A note on the numbering.** The master plan labels its three categories "OWASP
2026". The categories it lists — A01 Broken Access Control, A02 Security
Misconfiguration, A03 Software Supply Chain Failures — are the **OWASP Top
10:2025** ordering. (In the 2021 list, A02 was Cryptographic Failures and supply
chain sat at A06 as "Vulnerable and Outdated Components"; 2025 promoted supply
chain to A03 and moved misconfiguration up to A02.) This document uses the
plan's letters so the two read side by side, and states the list year where it
matters. Nothing about the required work changes.

Scope note: this document covers what Person 4 owns — the AI service, the AWS
topology, the container images, and the CI pipeline. Findings that belong to
another quadrant are recorded as **handoffs** with the owner named, because an
audit that quietly ignores what it cannot fix is not an audit.

---

## A01 · Broken Access Control

> Application security must never rely on client-side routing guards. The
> backend must aggressively enforce the principle of least privilege. Every
> single API route must be shielded by the JWT verification middleware.

### What this service does

Every route except `/health`, `/ready` and the documentation requires an
HMAC-SHA256 signature over `"{timestamp}.{body}"` with a ±300 s window
(`app/middleware.py`). This is service-to-service authentication, deliberately
*not* JWT: the caller is Person 3's backend, not a browser, and there is no user
session to carry. Person 3 verifies the employee's JWT and then signs the
call to this service. Two layers, two different questions — "which employee is
this?" and "is this really our backend?" — and neither substitutes for the other.

The middleware is raw ASGI and is installed *outside* the routing layer, so a
request cannot reach a handler unsigned. Its 401 is also wrapped by the security
headers middleware, which matters because that response is the one an attacker
sees most often.

Enforcement details that are easy to get wrong and are tested:

| Control | Where | Test |
|---|---|---|
| Signature compared in constant time | `app/crypto/hmac_auth.py` | `tests/unit/test_hmac.py` |
| Timestamp window rejects replay outside ±300 s | `app/middleware.py` | `tests/api/test_middleware.py` |
| Request-id nonce rejects replay *inside* the window | `app/security/guards.py` | `tests/security/test_guards.py` |
| Body is drained and replayed, so signing cannot be skipped by streaming | `app/middleware.py` | `tests/api/test_middleware.py` |
| Exempt paths are an explicit allow-list, not a prefix match | `app/main.py` | `tests/contract/test_route_inventory.py` |
| Admin routes need a separate `X-PNSM-Admin` token | `app/routers/admin.py` | `tests/api/test_routes.py` |

### Least privilege at the infrastructure layer

Access control is not only an application concern, and the master plan's
"principle of least privilege" is enforced where a compromise would otherwise be
unbounded:

- **Two ECS roles, not one.** `taskRoleArn` is what the application code gets:
  KMS (wrap/unwrap, bounded by encryption context) and S3 object access on two
  prefixes. `executionRoleArn` is what the ECS agent gets: pull the image, read
  the secrets, write logs. A remote code execution in this service therefore
  cannot read Secrets Manager, because the container never holds that permission.
- **No `s3:DeleteObject`.** Retention is a bucket lifecycle rule. A compromised
  container cannot erase the selfie that recorded a fraudulent check-in.
- **No `kms:Encrypt`.** Under envelope encryption the CMK only ever wraps data
  keys, which `GenerateDataKey` already does. An unused permission is a
  primitive waiting to be found.
- **`iam:PassRole` is scoped** to three named roles and conditioned on
  `iam:PassedToService = ecs-tasks.amazonaws.com`. Unscoped, it silently makes
  the CI deploy role an administrator.
- **The CI role holds no long-lived credentials.** GitHub OIDC, with both the
  audience and the repository/branch subject pinned
  (`deploy/iam/github-actions-deploy-role.json`).

`tests/deploy/test_manifests.py` asserts each of these against the committed
policy documents, so a widened grant fails a build rather than passing a review.

### Handoffs

| # | Finding | Owner |
|---|---|---|
| A01-H1 | Route-level role checks (an employee must not `PUT` a geofence) live in Person 3's Express middleware. This service has no notion of employee roles and must not acquire one. | Person 3 |
| A01-H2 | The HR dashboard must not rely on hiding UI components. Person 2's routing guards are usability, not security. | Person 2 |
| A01-H3 | MongoDB Atlas network access must be an IP allow-list of the ECS NAT gateway, not `0.0.0.0/0`. | Person 3 |
| A01-H4 | The `FaceEmbeddings` collection needs a unique index on `user_id` and a database user scoped to it. The master plan's word is "isolated"; a collection every role can read is isolated only in the file layout. | Person 3 |
| A01-H5 | The HR WebSocket alert must be driven by the `hr_alert` field, not by comparing `decision` strings, so it survives a change of band policy. | Person 3 |

---

## A02 · Security Misconfiguration

> Default Express installations leak highly identifiable framework telemetry.
> The engineer must integrate the helmet package... Strict
> `Content-Security-Policy: default-src 'self'` and `X-Frame-Options: DENY`
> directives must be enforced... all transit data must be heavily encrypted
> utilizing TLS 1.2+ certificates provisioned via AWS Certificate Manager.

### Response headers, in all three places that emit responses

`helmet` is Express middleware, so it is Person 3's tool for Person 3's service.
The equivalent for this stack is implemented three times because there are three
servers, and a header set on only one of them is a header an attacker routes
around:

| Server | Implementation | Policy |
|---|---|---|
| This FastAPI service | `app/security/headers.py` | `default-src 'none'` — it returns only JSON, so it can afford the strictest policy there is |
| A frontend as an ECS task | `deploy/nginx.conf.template` | `default-src 'self'` plus the specific origins the SPA calls |
| The SPA from S3 + CloudFront | `deploy/cloudfront-response-headers-policy.json` | identical to the nginx policy |

`tests/security/test_headers_parity.py` compares the two frontend policies
directive by directive and fails when they drift.

Headers applied, and why each one is there rather than copied from a list:

- **`Content-Security-Policy`** — the master plan's directive. `frame-ancestors
  'none'` accompanies `X-Frame-Options` because modern browsers honour the
  former and older ones the latter.
- **`X-Frame-Options: DENY`** — clickjacking. Nothing in PNSM is meant to be
  framed.
- **`X-Content-Type-Options: nosniff`** — MIME sniffing, named in the plan.
- **`Referrer-Policy: strict-origin-when-cross-origin`** — an employee reference
  in a URL must not leak to a third-party host through the `Referer` header.
- **`Permissions-Policy`** — the API denies every sensor. The frontends grant
  `camera=(self)` and `geolocation=(self)`, because the check-in flow is the
  product, and deny the rest so a compromised third-party script cannot reach a
  sensor the app never uses.
- **`Strict-Transport-Security`** — emitted only when the request scheme is
  HTTPS (honouring `x-forwarded-proto` behind the ALB). Sending HSTS over plain
  HTTP is meaningless and confuses scanners.
- **`Cache-Control: no-store`** on API responses — a verification result must
  not sit in an intermediary cache.
- **`Server` is stripped** — the plan's "framework telemetry" point. `nginx`
  also runs with `server_tokens off`.

### Transport

- CloudFront: `MinimumProtocolVersion: TLSv1.2_2021`, `ViewerProtocolPolicy:
  redirect-to-https`, certificate from ACM.
  **The certificate must be issued in `us-east-1`** whatever region the rest of
  the stack uses — CloudFront reads certificates from that region only. This is
  the single most common provisioning failure and is called out in the template.
- S3: the bucket policy **denies** `aws:SecureTransport = false` *and* denies
  `s3:TlsVersion < 1.2`. The first alone is satisfied by TLS 1.0, so on its own
  it does not implement "TLS 1.2+".
- The task role carries the same `SecureTransport` deny, so a future endpoint
  override cannot put biometric data on the wire in plaintext.

### Storage posture

Misconfiguration is mostly a story about defaults, so the ones that matter are
set explicitly and then **measured**:

- Block Public Access, all four switches, before any object exists.
- Default encryption SSE-KMS with a bucket key.
- A bucket policy that denies any upload that is not SSE-KMS under the project's
  own CMK — SSE-S3 is real encryption but is not attributable in CloudTrail and
  cannot be revoked by disabling a key.
- Versioning on, plus a 90-day lifecycle expiry on check-in selfies.
- `readonlyRootFilesystem: true`, `capabilities: drop ALL`, non-root uid on the
  container.

`/ready` reports the *measured* encryption and public-access state
(`app/runtime.py: storage_posture`), not the intended one. A default-encryption
rule that was quietly removed looks identical to one that is in place, right up
until somebody reads the objects.

### Handoffs

| # | Finding | Owner |
|---|---|---|
| A02-H1 | `helmet` on the Express API, with `contentSecurityPolicy` configured rather than left at its default, and `x-powered-by` disabled. | Person 3 |
| A02-H2 | MongoDB Atlas: TLS required, database user scoped to the PNSM database only, no `atlasAdmin`. | Person 3 |
| A02-H3 | CapacitorJS: `android:usesCleartextTraffic="false"` and an ATS exception list that is empty on iOS. | Person 1 |

---

## A03 · Software Supply Chain Failures

> The CI/CD pipeline must be configured to halt deployments if the `npm audit`
> command detects deep-tree vulnerabilities. The deployment environments must
> strictly utilize `npm ci` paired with locked `package-lock.json` manifests.

### The gate

`scripts/audit_deps.py` runs `pip-audit` over this service's requirements and
`npm audit --omit=dev` over any Node checkout it is pointed at, normalises the
two tools' different severity vocabularies, and exits non-zero on a finding at
or above `high`. CI runs it on every push and weekly on a schedule — a
repository nobody has pushed to for a week is exactly the one with an unnoticed
advisory.

Two properties are worth stating because they are what make the gate real
rather than decorative:

1. **An audit that could not run exits 2, not 0.** "We found nothing because we
   could not look" is not the same as "we looked and it is clean", and a
   pipeline that conflates them goes green during an advisory-database outage.
2. **An unrecognised output schema raises.** npm 6 and npm 7+ emit completely
   different JSON. A parser that returns `[]` on an unfamiliar document reports
   a clean tree forever after a toolchain change. `tests/deploy/test_audit_gate.py`
   asserts the npm 6 shape is refused rather than read as empty.

### Deterministic resolution

- **Python:** ranges in `requirements.txt`, hashes in `requirements.lock`
  generated by `make lock`; the Dockerfile installs with `--require-hashes` when
  the lock is present (D-10).
- **Node:** `deploy/frontend.Dockerfile` runs `npm ci`, never `npm install`, and
  `scripts/audit_deps.py` refuses to audit a project with no
  `package-lock.json` — without the lock there is no deterministic tree to
  audit, and `npm ci` would refuse to run anyway.
- **Images:** ECR repositories are created with `imageTagMutability=IMMUTABLE`
  and `scanOnPush=true`, so `:latest` cannot be repointed under a running
  service.

### Model weights are supply chain too

The two ONNX files are third-party binaries that this service loads and
executes. `scripts/fetch_models.py` records the SHA-256 of every download in
`models/checksums.txt` and refuses a later download that does not match, so a
changed upstream artifact fails the fetch rather than silently altering every
embedding the system produces. The weights are then baked into the image at
build time, so a cold start never depends on Hugging Face being reachable.

**Open item, stated rather than glossed:** `models/checksums.txt` is generated
on first download and is not yet in the repository. Until it is committed —
`.gitignore` un-ignores it, and it is on the pre-demo checklist — the pinning is
per-machine rather than per-project: it detects a *changed* upstream, not a
*wrong first* download. Whoever runs `make models` first must commit the file.

### The blocklist

`scripts/check_deps.py` fails the build on `tensorflow`, `torch`, `keras`,
`deepface` and `insightface`. This is a supply-chain control in the narrow sense
— it constrains what may enter the dependency tree — and an availability control
in the practical sense, since any of them OOM-kills the container. The master
plan names DeepFace as an implementation option; this service uses ONNX Runtime
against exported ArcFace weights instead, for exactly this reason (D-11).

### Handoffs

| # | Finding | Owner |
|---|---|---|
| A03-H1 | Add `python scripts/audit_deps.py --npm .` to the mobile and web CI workflows. It is written to be called from outside this repository. | Persons 1, 2, 3 |
| A03-H2 | Commit `package-lock.json` in all three Node repositories and use `npm ci` in every workflow. | Persons 1, 2, 3 |
| A03-H3 | Enable Dependabot or Renovate on the organisation. The gate catches a vulnerable dependency; it does not upgrade one. | Whoever owns the org |

---

## Audit summary

| Category | Status in Person 4's scope | Enforced by |
|---|---|---|
| A01 Broken Access Control | Met | `tests/api/test_middleware.py`, `tests/security/test_guards.py`, `tests/deploy/test_manifests.py` |
| A02 Security Misconfiguration | Met | `tests/security/test_headers_parity.py`, `tests/deploy/test_manifests.py`, `/ready` posture check |
| A03 Software Supply Chain Failures | Met | `scripts/audit_deps.py` in CI, `tests/deploy/test_audit_gate.py`, `scripts/check_deps.py` |

Eleven findings are handed off to other quadrants. They are listed above rather
than omitted because the master plan asks for an audit of "the entire
infrastructure", and the honest result of auditing infrastructure you do not own
is a list with an owner against each line.

## Re-running this audit

```bash
make audit          # supply chain, this service
make audit-all      # ... plus the three Node checkouts, if they sit alongside
make manifests      # every AWS policy renders and holds its invariants
pytest tests/deploy tests/security -q
curl -s https://<service>/ready | jq '.security, .aws'
```
