# Security

Threat model, controls, and — as important — the limitations this module does not
pretend away.

---

## 1. What is being protected

| Asset | Why it matters | Where it lives |
|---|---|---|
| Face embeddings | Biometric data. Unlike a password, it cannot be reissued. | MongoDB, encrypted; key only in this service |
| 2FA PINs | Second factor for attendance | MongoDB, peppered + bcrypt |
| Selfie images | Personal data; also evidence in a dispute | S3, SSE-KMS, public access blocked, 90-day lifecycle |
| Attendance integrity | The whole point of the system | Enforced by the guards below |

---

## 2. Threat model

| Attacker | Capability | Primary control |
|---|---|---|
| Employee wanting to check in from home | Owns a phone, can install a fake-GPS app | `is_mock_location` → 403 + HR alert |
| Employee sharing credentials with a colleague | Knows another's login and PIN | 1:1 face verification |
| Employee automating check-ins | Can save a selfie and resubmit it | Image-hash replay guard + capture staleness |
| Someone who obtains the database | Read access to MongoDB | AES-256-GCM field encryption; pepper |
| Someone who obtains database *write* access | Can edit documents | AAD binding prevents envelope substitution |
| Someone who finds the service URL | Can send arbitrary HTTP | HMAC service-to-service signature |
| Someone holding a printed photo | Physical presence at the camera | **Partial** — see §7 |

---

## 3. Embedding encryption

**AES-256-GCM**, application layer, key only in this service.

```
envelope = { v, kp, kv, dek?, alg, iv (12 B), ct, tag (16 B), model_version, created_at }
AAD      = f"{user_ref}|{model_version}|{key_id}"
```

| Parameter | Value | Why |
|---|---|---|
| Key source | **AWS KMS envelope encryption** in any deployment; `PNSM_FLE_KEYS` locally and in tests | The master plan requires the keys to live in KMS |
| IV | `os.urandom(12)` per operation | 96 bits is GCM's optimal size; reuse under one key is catastrophic |
| Tag | 128 bit, verified before decryption returns | Full-length authentication |
| AAD | user + model + key version | Prevents cross-employee substitution |
| Failure | fail closed → `DECRYPT_FAILED` + security event | Never degrade to "allow" |

**The AAD binding is the control worth defending in a viva.** Plain AES-GCM
protects confidentiality and integrity of a blob, but nothing stops an attacker
with database write access copying Employee A's encrypted embedding onto Employee
B's document — B would then authenticate as A's face. Binding `user_ref` into the
authenticated data makes that swap fail the tag check. It costs one line and goes
beyond what the source specification asks for.
Proved by `tests/unit/test_fle.py::test_aad_binding_blocks_cross_employee_substitution`.

### 3.1 Envelope encryption, and the encryption context

Under `PNSM_KEY_PROVIDER=kms` the flow is:

1. `GenerateDataKey` returns a **fresh** 256-bit data key per enrolment, plus the
   same key wrapped under the customer master key.
2. The vector is encrypted locally with AES-256-GCM under the plaintext key.
3. The wrapped key rides inside the envelope as `dek`; the plaintext is discarded.
4. Verification asks KMS to unwrap, then opens the vector locally.

The vector never reaches AWS, and the key that could open it never exists outside
this process for longer than one request.

**The encryption context is the second control worth defending in a viva.** Every
KMS call carries `{user_ref, model_version, purpose}`. KMS treats it as
additional authenticated data for its own operation and refuses an unwrap whose
context differs from the wrap — in CloudTrail, before this service sees a key. So
the same substitution the AAD blocks locally is *also* blocked remotely, by a
system the attacker does not control, and every unwrap is attributable to one
employee. The condition is written into both `deploy/iam/ai-svc-task-role-policy.json`
and `deploy/iam/kms-key-policy.json`; a key-policy condition survives somebody
later attaching a broader identity policy.

Proved by `tests/unit/test_keyproviders.py::test_unwrapping_under_a_different_context_is_refused`,
against a stub that models KMS's enforcement rather than ignoring it.

**The DEK cache.** Unwrapped data keys are held for `PNSM_KMS_DEK_CACHE_TTL_S`
(default 300 s) in a bounded, expiring, in-memory map. Without it, every check-in
pays a KMS round trip inside a three-second budget. Plaintext keys in memory are
a deliberate, bounded trade: entries expire, the map is size-capped, nothing
touches disk, and the whole thing dies with the task. Set the TTL to 0 to
eliminate it and pay the round trip.

**Key custody.** Under KMS there is no key to lose — and no key to back up, since
KMS key material has no export. What must be protected instead is the key's
*existence*: `ScheduleKeyDeletion` destroys every enrolment in the system, so the
key policy denies it without MFA, and the 7–30 day pending window is the only net
after that. Rotation is annual and automatic; AWS retains old key material, so
envelopes sealed last year keep opening.

Under the static provider, generate once with `scripts/gen_keys.py` and store in
two places outside the deployment platform. Lose it and every embedding sealed
under it is permanently unreadable — those employees must re-enrol.

**Migrating static → KMS.** `scripts/rotate_keys.py --to kms` re-wraps exported
envelopes without a single employee re-enrolling. It verifies every result by
opening it again, writes nothing unless all records succeed, and never mutates
its input — the export is the rollback. Keep the old FLE keys until it reports
zero `kp=static` envelopes; they are what opens anything the import missed.

Rotation within the static provider:
`gen_keys.py --rotate`, deploy with both keys, re-wrap on read with
`fle.rewrap`, retire the old key.

---

## 4. PIN protection

A six-digit PIN is a 10⁶ space. bcrypt is one of four layers, and not the one
doing most of the work.

| Layer | Setting | What it defeats |
|---|---|---|
| Server-side pepper | `bcrypt(b64(HMAC-SHA256(pepper, pin)), cost)` | A database dump alone is useless |
| bcrypt | cost 10, **benchmarked** | Offline cracking |
| Threadpool execution | sync `def` handlers, which FastAPI runs on its anyio threadpool | bcrypt is CPU-bound; inline it stalls every other request |
| Six-digit minimum | enforced at onboarding | 100× the space of four digits |
| Weak-PIN rejection | blocklist, repeats, sequences | The PINs tried first in any attack |
| **Per-user lockout** | 5 attempts → 15 min | **Online guessing — the real defence** |
| Rate limit | 12 verifications/min | Automated probing |
| Log redaction | root-logger filter | PINs in logs, traces, error payloads |

Two details that matter:

- **The peppered material is 44 bytes.** bcrypt silently truncates above 72; a
  hex encoding would be 64 and a longer scheme would cross the line. Asserted by
  `test_the_peppered_material_fits_inside_bcrypts_input_limit`.
- **No comparison is performed while locked.** Doing the bcrypt work anyway would
  let an attacker keep probing through the lockout window.

**Benchmark the cost on the deployed container**, not on a laptop:

```bash
python scripts/bench_bcrypt.py --budget-ms 200
```

The Fargate task's half vCPU is several times slower than a development
machine, and PIN verification sits inside the three-second check-in budget, so
the cost that is comfortable on a laptop may not be. Benchmark it there, not
here.

> **Record the measured number here before the demo:**
> `PNSM_BCRYPT_COST=___`, measured `___ ms` on `___` (date).

---

## 5. Service-to-service authentication

```
X-PNSM-Timestamp: <unix seconds>
X-PNSM-Signature: v1=<hex HMAC-SHA256(secret, f"{timestamp}.{body}")>
```

The timestamp is inside the signature, so a captured signature cannot be replayed
with a fresh one. Window ±300 s. Only `/health`, `/ready` and the documentation
are exempt.

Every rejection returns the same status, code and message. The `detail` that
differentiates them exists only in our logs — telling a caller which check failed
turns the endpoint into an oracle.

`PNSM_AUTH_REQUIRED=false` exists for local development and logs a loud warning
at boot. It must never be set anywhere else.

---

## 6. Device integrity and replay

| Control | Trigger | Response |
|---|---|---|
| Mock location | `is_mock_location` | 403 + security event + HR alert |
| Emulator | `is_emulator` | 403 + security event |
| Rooted device | `is_rooted` | logged, **not blocked** |
| Capture staleness | \|skew\| > 120 s | 409 `STALE_CAPTURE` |
| Request replay | `request_id` reused within 10 min | 409 `REPLAY_DETECTED` |
| Image replay | SHA-256 seen in last 30 for this employee | 409 `REPLAY_DETECTED` |
| Rate limit | > 12 verifications/min | 429 |

**Why rooted devices are not blocked.** Rooting is legal and common. Blocking it
locks out honest employees for a signal a real attacker would simply suppress —
it costs usability and buys nothing.

**Why the image-hash guard matters.** It catches the attack that GPS, PIN and
face match all pass cleanly: saving one selfie and resubmitting it every morning.
History is per employee, so a shared office backdrop is not an attack.

**Why capture staleness matters.** Without it, a selfie taken inside the geofence
at 09:00 can be submitted from home at noon. A device clock far *ahead* is
rejected too — it is as suspect as one far behind.

---

## 7. Limitations — stated, not hidden

### 7.1 Device flags are self-reported

Everything in §6's device column is asserted by the client. A rooted phone can
strip `is_mock_location` before the request leaves. These controls raise the cost
of casual cheating; they do not stop a determined attacker.

*Production path:* Google Play Integrity API (Android) and DeviceCheck / App
Attest (iOS), which produce a server-verifiable attestation the client cannot
forge.

### 7.2 No presentation-attack detection

1:1 ArcFace matching compares faces; it does not know whether it is looking at a
person or a photograph of one. A printed photo or a phone screen can pass. The
blink prompt is a deterrent, not a defence.

*Production path:* MiniFASNet (Silent-Face-Anti-Spoofing), ~1.9 MB ONNX, ~15 ms,
fits the memory budget. Tracked as a stretch goal.

### 7.3 Single-instance state

Replay caches, lockout counters and rate limits are in-process. Correct for one
worker — which is the deployed topology and is what the memory budget assumes —
but they do not survive a restart or span instances.

*Production path:* `RedisTTLStore` in `app/security/stores.py` implements the same
protocol. `SET key 1 NX EX ttl` is atomic, so the check-and-insert cannot race
between instances. Nothing above that module changes.

### 7.4 No mutual TLS

Transport security is whatever the platform terminates. The HMAC signature
authenticates the *caller*, not the channel.

### 7.5 Selfies are retained for 90 days

An S3 lifecycle rule deletes check-in selfies after 90 days; reference photos are
deleted on offboarding. Together these satisfy the requirement that biometric
data be "deletable on employee offboarding, in line with data-protection best
practice" — a line that is otherwise easy to leave as an aspiration.

Two details make this real rather than aspirational. The **lifecycle rule** does
the deleting, not the application, so the AI service is granted no
`s3:DeleteObject` at all and a compromised container cannot erase the selfie that
recorded a fraudulent check-in. And selfies are deliberately **not** served
through CloudFront (D-14) — a CDN invalidation is a cache eviction, not an
erasure, and would have made the 90-day guarantee approximate.

Verify the rule is actually on the bucket; it is one policy and easy to forget.
`/ready` reports the measured encryption and public-access posture for the same
reason.

---

## 8. What the tests prove

| Property | Test |
|---|---|
| Tampered ciphertext, tag or model version fails closed | `test_fle.py` |
| Another employee's envelope cannot authenticate | `test_aad_binding_blocks_cross_employee_substitution` |
| Every IV is unique across 2,000 seals | `test_every_seal_uses_a_fresh_iv` |
| Key rotation preserves the vector | `test_key_rotation_preserves_the_vector` |
| A pepper change invalidates every stored hash | `test_the_pepper_makes_a_stolen_database_useless` |
| Peppered material stays inside bcrypt's 72-byte limit | `test_the_peppered_material_fits_inside_bcrypts_input_limit` |
| A corrupt hash returns false rather than raising | `test_a_corrupt_stored_hash_returns_false_rather_than_raising` |
| Lockout stops guessing and does not extend itself | `test_lockout.py` |
| Signature covers both body and timestamp | `test_hmac.py` |
| Every auth rejection looks identical to the caller | `test_every_rejection_returns_the_same_message` |
| Mock location, emulator, staleness, replay all fire | `test_guards.py`, `test_routes.py` |
| Path traversal in an object key is refused | `test_keys.py` |
| Internal detail never reaches the wire | `test_internal_detail_never_reaches_the_wire` |
| Replay caches are memory-bounded | `test_stores.py`, `test_memory_ceiling.py` |

---

## 9. Incident response

**Suspected key compromise.** Rotate immediately (`gen_keys.py --rotate`), deploy
with both keys, re-wrap every envelope, retire the old key. Embeddings stay valid
throughout — no re-enrolment needed.

**`DECRYPT_FAILED` appearing in logs.** Not routine. It means tampering, a wrong
key, or an envelope copied between employees. Check which `user_ref`, check
whether the key version changed, check the MongoDB audit log.

**A burst of `MOCK_LOCATION`.** Either a genuine spoofing attempt or Person 1
shipped a build that sets the flag incorrectly. Check the `app_version` in the
security events before accusing anyone.

**Suspected PIN brute force.** Lockout has already fired. Confirm in `/metrics`
(`pin.mismatch` count), then reset the PIN through the normal flow.
