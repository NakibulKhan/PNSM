# Runbook

Operating `pnsm-ai-svc`: deploy, keep it warm, rotate keys, recalibrate, and get
through demo day.

---

## 1. First deploy

### 1.1 What you are creating

Everything lives in one AWS account, in one region. `docs/AWS.md` explains the
shape and the reasoning; this section is the sequence.

| Component | Where | Owner |
|---|---|---|
| `pnsm-ai-svc` | ECS Fargate, 0.5 vCPU / 1024 MB, `desiredCount: 1` | P4 |
| `pnsm-api` | ECS Fargate, behind the ALB | P3 |
| SPA bundle | S3 `pnsm-web` + CloudFront, private via OAC | P4 provisions, P1/P2 publish |
| Selfies | S3 `pnsm-selfies`, SSE-KMS, 90-day lifecycle, **not** behind the CDN | P4 |
| Biometric CMK | KMS, annual rotation, MFA required to delete | P4 |
| `FaceEmbeddings` | MongoDB Atlas M10+ | P3 |

There is no idle-stop and no keep-alive on Fargate — a task with
`desiredCount: 1` is always running, and always billed. That is the trade against
the previous free-tier topology; see D-17 and the cost table in `docs/AWS.md`.

### 1.2 Region

ECS, S3, KMS and the Atlas cluster all in **`ap-southeast-1`** (Singapore),
closest to Dhaka with the full service set. A cross-region hop costs 150–250 ms
against a three-second check-in budget.

**One exception:** the ACM certificate for CloudFront must be issued in
**`us-east-1`**, whatever region everything else uses. CloudFront reads
certificates from that region only. This is the most common failure on this
topology.

### 1.3 Steps

```bash
# 1. Secrets, once. Back up PNSM_FLE_KEYS outside AWS.
python scripts/gen_keys.py > secrets.txt

# 2. Check the templates resolve before anything is created.
export PNSM_AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export PNSM_AWS_REGION=ap-southeast-1
export PNSM_GITHUB_ORG=<org>
python scripts/provision_aws.py --check

# 3. Create the CMK and the two buckets, then read the printed plan.
python scripts/provision_aws.py --apply

# 4. Store the secrets. They never appear in a task definition.
for name in hmac-secret pin-pepper admin-token fle-keys; do
  aws secretsmanager create-secret --name "pnsm/$name" --secret-string "<value>"
done

# 5. Build and push.
aws ecr get-login-password | docker login --username AWS --password-stdin \
  "$PNSM_AWS_ACCOUNT_ID.dkr.ecr.$PNSM_AWS_REGION.amazonaws.com"
docker build -t pnsm-ai-svc:$(git rev-parse --short HEAD) .
docker tag  pnsm-ai-svc:$(git rev-parse --short HEAD) \
  "$PNSM_AWS_ACCOUNT_ID.dkr.ecr.$PNSM_AWS_REGION.amazonaws.com/pnsm-ai-svc:$(git rev-parse --short HEAD)"
docker push "$PNSM_AWS_ACCOUNT_ID.dkr.ecr.$PNSM_AWS_REGION.amazonaws.com/pnsm-ai-svc:$(git rev-parse --short HEAD)"

# 6. Register the task definition and create the service.
#    Run the rest of the plan printed by step 3 -- it is ordered so that every
#    resource exists before the one that references it.
aws ecs register-task-definition \
  --cli-input-json file://deploy/rendered/ecs-task-definition.json

# 7. Verify.
curl https://<service>/health
curl -s https://<service>/ready | jq '.security, .aws'
PNSM_BASE_URL=https://<service> python scripts/smoke.py
```

Never tag an image `:latest`. The ECR repositories are created with
`imageTagMutability=IMMUTABLE` precisely so a tag cannot be repointed under a
running service; a commit SHA is the tag.

### 1.4 Post-deploy checklist

- [ ] `/ready` returns `warm: true`
- [ ] `security.key_provider` is `kms`, **not** `static`
- [ ] `aws.posture.encryption.algorithm` is `aws:kms` and `kms_key` is the project CMK
- [ ] `aws.posture.public_access.blocked` is `true`
- [ ] `thresholds.approve_at_cosine` is between 0.30 and 0.80
- [ ] `calibration_version` is a real fit, not `bootstrap-*`
- [ ] `warnings` is empty (no stub models, no disabled auth, no static keys)
- [ ] `scripts/smoke.py` passes every check
- [ ] `PNSM_BCRYPT_COST` was benchmarked **on the Fargate task**, not a laptop
- [ ] `aws kms get-key-rotation-status` reports rotation enabled
- [ ] A deep link on the SPA returns 200, not 404 — test one, do not assume
- [ ] The FLE keys are backed up in two places outside AWS

---

## 2. Staying warm

Fargate does not scale to zero, so there is no keep-alive cron. What replaces it
is monitoring: the task can still die, and the failure mode is now "ECS restarts
it and nobody notices" rather than "it went to sleep".

| Check | Where | Threshold |
|---|---|---|
| ALB target health | ECS service | any unhealthy target for > 2 min |
| Task restarts | CloudWatch, `ServiceDeployment` events | more than one in an hour |
| p95 `/v1/verify` latency | application logs | > 2 s sustained |
| `security.*` reason codes | log metric filter | any `REPLAY_DETECTED` or `MOCK_LOCATION` spike |
| KMS `Decrypt` errors | CloudTrail | any `AccessDenied` — usually an encryption-context mismatch |

An external HTTP monitor on `/health` at five-minute intervals is still worth
having: it is independent of AWS's own view, and it doubles as the uptime
evidence for the report. 99%+ over 72 hours before the demo is a claim worth
being able to back up.

**Why `/health` and not `/ready`.** `/health` is a dictionary lookup — no model,
no network, no lock. `/ready` checks the model, the calibration and the bucket
posture, which means an S3 call. A monitor hitting `/ready` every few minutes
spends CPU and API quota to answer a question that has not changed.

---

## 3. Demo day

**T-30 minutes**

```bash
curl -s https://<ai-svc>/ready | jq '.warm, .warnings'
curl https://<api>/health         # Person 3's API
PNSM_BASE_URL=https://<ai-svc> python scripts/smoke.py
```

Then: one real enrolment and one real check-in through the actual mobile app.
Not a curl — the app, on the phone that will be used, on the network that will be
used.

**T-10 minutes**

- Confirm the ECS service shows one running task and a healthy ALB target.
- Open `/ready` in a browser tab; leave it there. If the demo misbehaves, that
  tab answers "is it cold, or is it wrong?" in one glance.
- Have the admin token to hand in case a threshold needs nudging live.

**If the face match fails on stage**

1. Check `/ready` → `thresholds.approve_at_cosine`. If it is above 0.8, the
   calibration is wrong, not the person.
2. Look at `raw_cosine` in the response. Above 0.45 with a rejection (or a
   `flagged` decision, under the three-band policy) means the threshold is too
   tight for the room's lighting, not that the person is a stranger.
3. Lower it live, without a redeploy:
   ```bash
   # set PNSM_APPROVE_THRESHOLD=75 in the platform, then:
   curl -X POST https://<ai-svc>/v1/admin/recalibrate -H "X-PNSM-Admin: $TOKEN" ...
   ```
4. Say what you did and why. A calibrated system whose operating point you can
   explain and adjust on the spot is a stronger demonstration than one that
   happened to work.

**Fallback if the platform is down**

```bash
docker compose up          # the whole stack on a laptop
ngrok http 8000            # or demo entirely on localhost
```

Rehearse this in Week 8. A fallback discovered on stage is not a fallback.

---

## 4. Routine operations

### Recalibrate without a restart

```bash
python calibration/build_calibration.py --dataset calibration/dataset
# commit calibration.json, redeploy — or, live:
curl -X POST https://<service>/v1/admin/recalibrate \
     -H "X-PNSM-Admin: $PNSM_ADMIN_TOKEN" \
     -H "X-PNSM-Timestamp: $TS" -H "X-PNSM-Signature: v1=$SIG"
```

The preprocessing fingerprint is re-checked on reload: a calibration fitted on a
different pipeline is refused, not silently accepted.

### Rotate the encryption key

```bash
python scripts/gen_keys.py --rotate --existing "$PNSM_FLE_KEYS"
# 1. deploy with BOTH keys present, the new one active
# 2. new enrolments seal under k2; old envelopes still open under k1
# 3. re-wrap old envelopes with app.crypto.fle.rewrap as they are read
# 4. once none remain, remove k1 and redeploy
```

No downtime, no bulk migration, no re-enrolment.

### Check memory

```bash
curl -H "X-PNSM-Admin: $TOKEN" ... https://<service>/metrics | jq .rss_mb
```

Steady state should sit near 250 MB with both ONNX sessions loaded. Above 380 MB,
something is wrong — check for a heavy import or a session being built per
request.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Service will not start, `ConfigError` | A missing secret or calibration file | Read the message; it names the variable |
| `CalibrationError: fingerprint mismatch` | Preprocessing changed since the fit | Re-fit; do **not** regenerate the golden to silence it |
| Every check-in rejected | Calibration too tight, or a bad reference photo | Check `approve_at_cosine` and the enrolment `quality` |
| Every check-in approved, including strangers | Threshold far too loose | Check `approve_at_cosine` is not below 0.3 |
| First check-in after a deploy takes 60 s | Cold start after a task replacement | Expected once per deploy. If it recurs, the task is being killed and restarted -- check CloudWatch for OOM |
| `MODEL_VERSION_MISMATCH` for everyone | The model changed | Re-enrol everyone, or restore the previous weights |
| `DECRYPT_FAILED` for one employee | Envelope corrupted or copied between users | Security event — investigate, then re-enrol |
| 401 on every call from Person 3 | Wrong secret, clock skew, or body re-serialised | Compare secrets; check clocks; sign the exact bytes sent |
| Task killed and restarted, exit 137 | OOM -- a heavy dependency crept in | `python scripts/check_deps.py`; `make bench-memory` |
| Uploads rejected by the bucket | `content_length` did not match the bytes sent | Send the exact compressed size |
| `KeyUnavailableError: KMS Decrypt failed` | Encryption-context mismatch, or the task role lost its grant | Check CloudTrail for the `AccessDenied`; the context must be `{user_ref, model_version, purpose}` |
| Every SPA deep link 404s | CloudFront rewrites 404 but not 403 | Both codes must map to `/index.html`; see `docs/AWS.md` |
| `AccessDenied` on every selfie upload | Bucket policy rejects non-SSE-KMS uploads | The presign must not request `AES256`; check `PNSM_S3_SSE_KMS_KEY_ID` |

---

## 6. What to watch

| Signal | Where | Healthy |
|---|---|---|
| `rss_mb` | `/metrics` | < 300 steady, < 380 peak |
| `verify.approved` / `verify.rejected` | `/metrics` | rejection rate stable day to day |
| `latency_ms.verify.p95` | `/metrics` | < 1500 ms service-side |
| `security.*` counters | `/metrics` | near zero; a spike is worth reading |
| `/health` uptime | external HTTP monitor | > 99% over the preceding 72 h |
| Running task count | ECS service | exactly 1, with no restarts in the last hour |
| KMS `AccessDenied` | CloudTrail | zero -- every one is a real failed unwrap |
| Monthly spend | Cost Explorer, tagged `Project=PNSM` | Fargate dominates; see `docs/AWS.md` |

A rejection rate that climbs over a week usually means reference photos are
ageing, not that the system is breaking. Re-enrol the affected employees.
