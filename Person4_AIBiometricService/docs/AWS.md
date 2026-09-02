# AWS topology

What Person 4 provisions, why it is shaped this way, and how to build it from
nothing in about half an hour.

The master plan replaces the legacy Vercel / Render / Cloudflare R2 split with a
single AWS account:

> Ensures complete data sovereignty via Virtual Private Clouds (VPC). Utilizes
> AWS ECS for containerized API execution, S3 for immutable image persistence,
> and CloudFront for edge-cached CDN delivery.

Everything below is committed as a template under `deploy/`. Nothing is created
by hand, and nothing in this document is a value you have to remember —
`scripts/provision_aws.py` fills every placeholder from one small set of inputs.

---

## The map

```
                                      ┌──────────────────────────┐
  Mobile (P1, Capacitor) ─────────────┤  CloudFront              │
  HR dashboard (P2, Vite) ────────────┤  · SPA from S3           │
                                      │  · 403/404 → index.html  │
                                      │  · TLS 1.2+, ACM         │
                                      └────────────┬─────────────┘
                                                   │  OAC (bucket stays private)
                                      ┌────────────┴─────────────┐
                                      │  S3  pnsm-web            │
                                      └──────────────────────────┘

  Mobile ──── HTTPS ────► ALB ────► ECS Fargate: pnsm-api  (Person 3, Express 5)
                                          │
                                          │ HMAC-signed, private subnet
                                          ▼
                                    ECS Fargate: pnsm-ai-svc  (Person 4)
                                          │
                          ┌───────────────┼────────────────┐
                          ▼               ▼                ▼
                    KMS (CMK)       S3 pnsm-selfies   MongoDB Atlas
                    wraps DEKs      SSE-KMS, 90 d     FaceEmbeddings
                                    presigned only    (P3 writes the
                                    NOT behind CDN     opaque envelope)
```

Two things on that diagram are decisions rather than defaults, and both are
argued below: the selfie bucket is **not** behind CloudFront (D-14), and the
embeddings live in their own collection that this service never connects to
(D-13).

---

## Region

`ap-southeast-1` (Singapore) for everything: ECS, S3, KMS and the Atlas cluster.

Not a preference. A cross-region hop costs 150–250 ms, and the check-in budget
is three seconds end to end for a mobile client on a field-site cellular link.
Singapore is the closest AWS region to Dhaka with the full service set.

The single exception is the ACM certificate for CloudFront, which **must** be
issued in `us-east-1` regardless — CloudFront reads certificates from that
region only. This is the most common provisioning failure on this topology and
it is called out in `deploy/cloudfront-distribution.json`.

---

## Compute — ECS Fargate

`deploy/ecs-task-definition.json`, 0.5 vCPU / 1024 MB.

Fargate rather than EC2 because there is no host to patch, and patching a host
is the kind of work that does not happen during a course project. Sizing comes
from measurement, not from a round number: two ONNX sessions plus the Python
runtime sit around 300 MB resident (`tests/memory/test_memory_ceiling.py`
enforces the ceiling), and 1024 MB is the smallest Fargate memory value that
pairs with 512 CPU units while leaving headroom so the kernel never OOM-kills a
task mid-inference.

Hardening applied at the task level, each of which is asserted in
`tests/deploy/test_manifests.py`:

| Setting | Why |
|---|---|
| `readonlyRootFilesystem: true` | The service writes nothing at runtime, so a file dropped by an exploit has nowhere to land |
| `host: {}` volume at `/tmp` | Python's `tempfile` and ONNX Runtime need it. Fargate rejects `linuxParameters.tmpfs`, which is EC2-only — this is the legal equivalent, and it dies with the task |
| `user: "10001"` | Restates the image's `USER` so a rebuilt image that lost the directive cannot start as root |
| `capabilities.drop: ["ALL"]` | Nothing this process does needs one |
| `startPeriod: 60` | Covers interpreter start, two ONNX sessions and a warm-up inference. Too short a period kills a task that was about to be healthy |

Single task, single worker. The ONNX sessions and the replay caches are
process-local by design; a second worker doubles the memory and buys nothing on
half a core. When check-in volume outgrows one task, the change is
`desiredCount` plus moving the replay cache behind the Redis implementation that
already sits behind the same protocol (D-04) — not a bigger container.

---

## Keys — KMS

The master plan:

> the biometric arrays remain mathematically indecipherable without the distinct
> encryption keys held securely within the AWS Key Management Service.

Implemented as envelope encryption in `app/crypto/keyproviders.py`:

1. Enrolment calls `GenerateDataKey` and gets a fresh 256-bit data key, plus the
   same key wrapped under the CMK.
2. The vector is encrypted locally with AES-256-GCM under the plaintext data key.
3. The wrapped key travels inside the envelope; the plaintext copy is discarded.
4. Verification asks KMS to unwrap, then opens the vector locally.

**The vector never reaches AWS**, and the key that could open it never exists
outside the process in plaintext for longer than one request.

### The encryption context is the part that matters

Every KMS call carries `{user_ref, model_version, purpose: pnsm-face-embedding}`.
KMS treats it as additional authenticated data for its own operation: an unwrap
whose context differs from the wrap is refused *by KMS*, in CloudTrail, before
this service sees a key. So a stolen wrapped data key cannot be redeemed for a
different employee, and every unwrap is attributable to one.

The same condition is written into both the task role
(`deploy/iam/ai-svc-task-role-policy.json`) and the key policy
(`deploy/iam/kms-key-policy.json`). Twice, because a key-policy condition holds
even if somebody later attaches a broader identity policy.

`tests/unit/test_keyproviders.py` stubs KMS with a client that actually enforces
the context, so the property is tested rather than assumed.

### Cost, and the cache

An unwrap per check-in is a network round trip inside a three-second budget and
a per-request KMS charge. Unwrapped data keys are cached for
`PNSM_KMS_DEK_CACHE_TTL_S` (default 300 s) in a bounded, expiring, in-memory map
keyed by `sha256(wrapped ‖ sorted context)`. Plaintext keys in memory are a
deliberate, bounded trade: entries expire, the map is size-capped, nothing
touches disk, and the whole process dies with the task.

### Rotation and migration

- `aws kms enable-key-rotation` is part of the provisioning plan. AWS keeps old
  key material, so envelopes sealed last year keep opening with no migration.
- Envelopes written before the AWS move carry `kp: "static"`.
  `scripts/rotate_keys.py --to kms` re-wraps them without a single employee
  re-enrolling: decrypt and re-encrypt happen in one process's memory, every
  result is verified by opening it again, and nothing is written unless every
  record succeeds.
- Opening an envelope whose `kp` differs from the running provider fails loudly
  with "re-wrap before switching providers", rather than silently.

**Scheduling this key for deletion destroys every enrolment in the system.** KMS
key material has no backup by design. The key policy therefore denies
`ScheduleKeyDeletion` without MFA, and the 7–30 day pending window is the only
net after that.

---

## Storage — S3

`pnsm-selfies` holds two prefixes: `refs/` (enrolment photographs) and
`checkins/` (one selfie per check-in). Both are built server-side by
`app/storage/keys.py` and never accepted verbatim from a client.

Provisioned state, in the order it is applied — Block Public Access goes on
*before* any object exists:

| Control | Value |
|---|---|
| Block Public Access | all four switches |
| Default encryption | SSE-KMS with the project CMK, bucket key enabled |
| Versioning | on — a deleted selfie is recoverable during an investigation |
| Lifecycle | `checkins/` expires at 90 days; incomplete multipart uploads at 1 day |
| Bucket policy | five explicit denies (`deploy/iam/selfie-bucket-policy.json`) |

The bucket policy grants nothing. Identity policies grant; the resource policy
exists so that certain mistakes are impossible regardless of what an identity
policy says — and an explicit deny cannot be overridden by an allow somebody
adds later in a hurry.

The bucket key matters more than it looks: without it, S3 calls KMS once per
object operation. With it, repeated reads of the same prefix share a key and KMS
request cost drops by roughly two orders of magnitude.

### Uploads never pass through this service

The mobile client compresses to under 200 KB and `PUT`s straight to S3 with a
presigned URL, then sends only the object key. Routing a few hundred kilobytes
through a half-core container per check-in would be the first thing to break the
latency budget, and it would put the image in a second place it does not need to
be.

A presigned PUT signs `Content-Length` as well as the key and content type
(D-07), so the ceiling is enforced by S3 before a byte of body is read.

---

## Edge — CloudFront

In front of `pnsm-web` only: the SPA bundle. Immutable, fingerprinted, read by
every visitor — exactly what an edge cache is for.

Origin Access Control, not a website endpoint. The bucket stays fully private
with Block Public Access on, and only the distribution can read it via
SigV4-signed origin requests. A website endpoint would require a public bucket,
which is precisely the misconfiguration A02 is about.

### The SPA rewrite

React Router owns paths like `/dashboard/geofences`. No such object exists in the
bucket, so both `403` and `404` are rewritten to `/index.html` with a `200`.

**403 is listed first on purpose.** With Block Public Access and an OAC-only
bucket policy, 403 is what S3 actually returns — `ListBucket` is not granted, so
it will not confirm whether the key exists. A configuration that handles only
404 reviews perfectly and fails in production, on every deep link and every
browser refresh.

500-class errors are deliberately *not* rewritten. Turning an origin failure
into a 200 page of HTML hides an outage from every monitor that watches status
codes.

### Selfies are not behind the CDN

Recorded as D-14. Private personal data with a 90-day retention, read a handful
of times by HR and never by the public. Caching them at 400+ edge locations
would spread biometric images across the world to save a latency nobody is
waiting on, and a CloudFront invalidation is not a deletion. They stay in S3
behind short-lived presigned URLs.

---

## Frontend containers

`deploy/frontend.Dockerfile` builds Person 1's and Person 2's Vite trees. They
do not have to write a Dockerfile; they point this one at their directory.

The master plan is specific, and each point is honoured for the stated reason:

- **`node:24-slim`, not Alpine.** Alpine links musl libc; any dependency with a
  native addon either falls back to a slower path or fails to compile, silently,
  until runtime. slim keeps glibc.
- **`npm ci`, not `npm install`.** Deterministic resolution from the lockfile,
  and A03: `npm install` is free to pull a patch nobody reviewed.
- **`nginx:alpine` runtime.** Alpine is fine *here* — nothing is compiled, only
  static files are served, and the base image is ~8 MB.
- **Under 50 MB final.** The Node runtime, `node_modules` and every build tool
  stay in stage 1.

That last number is a claim, so CI measures it. `tests/fixtures/frontend-smoke`
is a zero-dependency stand-in shaped like a Vite project, and the
`frontend-image` job builds the real Dockerfile against it, gates the size at 50
MB, starts the container, and asserts that a deep link returns 200 with the SPA
shell, that the CSP is present with the injected origins substituted, and that
nginx is not running as root.

---

## Secrets

Four values, all in Secrets Manager, all resolved by the ECS agent at task start
through the `secrets` block — never through `environment`, which is readable by
anyone holding `ecs:DescribeTaskDefinition`.

| Secret | Who else has it |
|---|---|
| `pnsm/hmac-secret` | Person 3 only — it is the service-to-service credential |
| `pnsm/pin-pepper` | Nobody. Rotating it invalidates every stored PIN hash |
| `pnsm/admin-token` | Person 4 only |
| `pnsm/fle-keys` | Nobody. Kept only until `rotate_keys.py` reports zero `kp=static` envelopes |

The execution role's `GetSecretValue` is enumerated one ARN at a time rather
than `pnsm/*`, so storing a fifth secret under the same prefix — the Atlas
connection string, say — does not silently widen the grant to a service that has
no business reading it.

---

## Building it

```bash
export PNSM_AWS_ACCOUNT_ID=<12 digits>     # aws sts get-caller-identity
export PNSM_AWS_REGION=ap-southeast-1
export PNSM_GITHUB_ORG=<org>

python scripts/provision_aws.py --check              # every placeholder resolves?
python scripts/provision_aws.py --render --print-commands
```

Read `deploy/rendered/` and the printed plan. Then either run the plan by hand,
or:

```bash
python scripts/provision_aws.py --apply
```

`--apply` creates only the CMK and the two buckets — the resources everything
else depends on, and the ones whose creation is idempotent enough to be safe
from a script. The distribution and the ECS service are left to the printed
plan on purpose: each takes minutes to converge, each is awkward to roll back,
and a half-applied CloudFront distribution is worse than none.

Order is not cosmetic. The CMK must exist before the bucket policy that names
it; the bucket before the lifecycle rule; the response headers policy before the
distribution that references it. The plan is emitted in that order.

## Verifying it

```bash
curl -s https://<service>/ready | jq '.security, .aws'
```

`aws.posture` reports the **measured** bucket encryption and public-access
state, not the intended one — a default-encryption rule that was quietly removed
looks identical to one that is in place, right up until somebody reads the
objects.

## What this costs

Rough monthly figures at project scale (roughly 50 employees, two check-ins a
day), in `ap-southeast-1`:

| Service | Driver | Order of magnitude |
|---|---|---|
| Fargate | 2 tasks × 0.5 vCPU / 1 GB, always on | the dominant line, tens of dollars |
| KMS | 1 CMK + requests, heavily reduced by the DEK cache and the S3 bucket key | ~$1 plus cents |
| S3 | ~3,000 objects/month at <200 KB, 90-day retention | cents |
| CloudFront | a few MB of bundle, cached | cents |
| Secrets Manager | 4 secrets | ~$1.60 |

There is no free tier for this shape of deployment, which is worth knowing
before the demo rather than after. The two obvious levers are scaling the tasks
to zero outside working hours (they cold-start in about 45 s) and consolidating
the four secrets into one JSON document.
