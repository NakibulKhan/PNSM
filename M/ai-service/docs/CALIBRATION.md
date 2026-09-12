# Calibration — why 85% raw cosine fails, and what replaces it

This is the most important document in the module. It explains the one change to
the original specification that decides whether the live demo works at all.

---

## 1. The problem

FR-07 and the Person 4 documentation define the check-in decision as:

> confidence = cosine similarity × 100 · approve when confidence ≥ 85

That is a raw cosine of 0.85. **ArcFace does not produce those numbers for real
people.**

DeepFace ships ArcFace with a default cosine **distance** threshold of `0.68`,
which is a cosine **similarity** of `1 − 0.68 = 0.32`. That is the calibrated
operating point of the model the proposal names, and it sits nowhere near 0.85.

What actually happens across a face-recognition backbone of this class:

| Pair type | Typical cosine | `× 100` | Outcome at "≥ 85" |
|---|---|---|---|
| Same person, same session, same light | 0.75 – 0.92 | 75 – 92 | sometimes passes |
| Same person, different day or lighting | 0.42 – 0.72 | 42 – 72 | **falsely rejected** |
| Same person, glasses or mask change | 0.30 – 0.55 | 30 – 55 | **falsely rejected** |
| Different people | 0.00 – 0.28 | 0 – 28 | correctly rejected |

Only near-duplicate frames exceed 0.85. A live demo — different room, different
light, different day from enrolment — lands squarely in the falsely-rejected
band. The separation between genuine and impostor pairs is real and usable; it
simply does not live at 0.85.

---

## 2. The fix

Keep `confidence ≥ 85 ⇒ approved` exactly as FR-07 words it. Change how
`confidence` is *computed*, from a multiplication to a fitted logistic map:

```
confidence(cosine) = 100 / (1 + exp(−a · (cosine − b)))
```

Two parameters, each measured from a different distribution, each answering a
different question:

- **`b` — the decision midpoint.** Taken from the **impostor** distribution at a
  target false-accept rate. *How often does a stranger get in?* Set by security.
- **`a` — the slope.** Taken from the **genuine** distribution so that a chosen
  fraction of legitimate pairs clears the approve band. *How often is a real
  employee wrongly flagged?* Set by usability.

Separating the two is what makes the result explainable rather than a magic
number, and it is what lets the report state both error rates honestly.

With a typical fit of `a ≈ 18`, `b ≈ 0.42`:

| cosine | confidence | decision |
|---|---|---|
| 0.20 (impostor) | 1.9 | rejected |
| 0.32 (DeepFace's ArcFace default) | 14.2 | rejected |
| 0.42 (midpoint) | 50.0 | rejected |
| 0.47 | 72.4 | rejected (`two`) · **flagged** (`three`) |
| 0.55 | 91.2 | approved |
| 0.62 | 97.3 | approved |
| 0.75 | 99.7 | approved |

The employee-facing number behaves the way the wireframes already show it — "96%
match", "93% match" — and the underlying decision is anchored on measured error
rates instead of a guess. **No other document needs rewording.**

---

## 3. The bands

Two documents describe what happens **below** the threshold, and they do not
agree. Both are implemented; `PNSM_DECISION_BANDS` selects which is in force,
and they approve at exactly the same score.

### `two` — the master plan's rule (default)

> If the resultant geometric similarity score evaluates to 85% or higher... the
> check-in is programmatically approved and recorded. If the score falls below
> the threshold, the anomaly is flagged, the status is set to **rejected**, and
> an instant WebSocket alert is routed to the HR dashboard for manual auditing.

| Band | Decision | System behaviour |
|---|---|---|
| `confidence ≥ 85` | approved | Attendance log written |
| `confidence < 85` | rejected | No attendance log; `hr_alert: true`, WebSocket push for manual audit; employee sees `NO_MATCH` and retries |

### `three` — FR-07's rule

> ...otherwise it is **flagged** for HR review.

| Band | Decision | System behaviour |
|---|---|---|
| `confidence ≥ 85` | approved | Attendance log written |
| `60 ≤ confidence < 85` | flagged | Log written as `flagged`, `hr_alert: true`, HR approves or rejects manually |
| `confidence < 60` | rejected | No attendance log; employee sees `NO_MATCH` and retries |

### Which to run

The default is the master plan's, because a service that flags where the plan
says reject would let a borderline stranger through the door. The difference is
whether a borderline employee waits at the door or is checked in pending review —
a business decision, not a modelling one, which is why it is a setting rather
than a constant (D-15).

`hr_alert` is `true` for anything short of a clean approval under **both** rules,
so Person 3 wires the WebSocket alert once and it keeps working either way. Read
that field rather than comparing `decision` strings.

`threshold.flag` and `threshold.flag_at_cosine` appear in the `/v1/verify`
response **only** under the three-band rule. Publishing a threshold the service
never applies would tell HR something untrue.

All three values are environment-overridable (`PNSM_APPROVE_THRESHOLD`,
`PNSM_FLAG_THRESHOLD`, `PNSM_DECISION_BANDS`) so they can be nudged live during
a demo. The service refuses to start if the flag threshold is not below the
approve threshold.

---

## 4. Building the fit

### 4.1 Collect the dataset

**Start this in Week 5, not Week 6.** It depends on other people's time, and that
is the dependency most likely to slip.

```
calibration/dataset/
  nakibul/  img01.jpg ... img09.jpg
  sanjida/  ...
  mohim/    ...
  mehnaz/   ...
  volunteer1/ ...
```

Per person, 8–10 photographs: indoor, outdoor, morning, evening, with and
without glasses, one slightly off-angle. Recruit 4–6 volunteers beyond the team
to reach roughly 10 identities and 80+ images.

Why the variation matters: a set shot in one sitting produces a genuine
distribution far tighter than reality, the fit comes out over-confident, and the
demo — shot in a different room on a different day — falls outside it.

> **Consent and deletion.** These are biometric photographs of real people.
> Collect them with explicit permission, keep `calibration/dataset/` out of git
> (it already is, via `.gitignore`), and delete the directory once the project is
> marked. The same principle the system claims to uphold applies to the team's
> own data.

### 4.2 Run the fit

```bash
make calibrate
# or:
python calibration/build_calibration.py --dataset calibration/dataset \
    --target-far 0.01 --coverage 0.95
```

What it does:

1. Runs every photograph through the **production** `preprocess_face` — the same
   function the service uses. A calibration fitted on a different pipeline
   describes a different system.
2. Builds all within-identity pairs (genuine) and all across-identity pairs
   (impostor).
3. Picks `b` at the target false-accept rate from the impostor distribution.
4. Picks `a` so the requested fraction of genuine pairs clears the approve band.
5. Measures FAR, FRR, flagged rate and AUC at the resulting operating point.
   (The flagged rate is reported under both band rules; under `two` it is the
   share of genuine pairs that would be rejected rather than merely reviewed,
   which is the number worth looking at before choosing a policy.)
6. Writes `calibration.json` and a three-panel plot.

### 4.3 Read the output

```
Pairs: 412 genuine, 3238 impostor
  genuine  cosine: min 0.318  median 0.612  max 0.894
  impostor cosine: min -0.104 median 0.048  max 0.301

Fit (anchored): a = 18.2143, b = 0.4187
  approve at confidence 85.0 == cosine 0.5152
  flag    at confidence 60.0 == cosine 0.4410
  measured FAR at approve : 0.9300%
  measured FRR at approve : 4.1000%  (of which 2.91% are flagged, not rejected)
  AUC                     : 0.9962
```

Sanity checks before trusting a fit:

- **AUC ≥ 0.98.** Lower means poor photo quality or a mislabelled identity —
  check for a photo filed under the wrong person.
- **`approve_at_cosine` between 0.30 and 0.80.** Outside that, something is wrong
  with the dataset or the pipeline. The smoke test asserts this against a live
  deployment.
- **Impostor median near 0.05.** A high impostor median suggests alignment is
  failing and every embedding is drifting toward a common mean.
- **Genuine minimum well above the impostor maximum.** Overlap means the
  anchored fit is impossible; the script says so and falls back to maximum
  likelihood rather than emitting a plausible-looking wrong number.

### 4.4 Deploy it

```bash
# with a restart
git add calibration/calibration.json && git commit && deploy

# or live, no cold start
curl -X POST https://<service>/v1/admin/recalibrate \
     -H "X-PNSM-Admin: $PNSM_ADMIN_TOKEN" \
     -H "X-PNSM-Timestamp: ..." -H "X-PNSM-Signature: ..."
```

---

## 5. The fingerprint guard

The failure this module is most likely to ship is not a crash. It is a
preprocessing tweak — a CLAHE tile size, a resize interpolation flag, a channel
order — that shifts every score by a few points without raising anything. Nothing
breaks; matches simply get worse, and the fitted mapping quietly stops describing
reality.

Three structural guards, not one:

1. **A single entry point.** `preprocess_face` is the only path, called by both
   enrolment and verification. They cannot diverge because there is only one.
2. **A fingerprint in the calibration.** `PreprocessConfig.fingerprint()` is a
   hash of every knob that can move a score, recorded in `calibration.json` under
   `measured.preprocess_fingerprint`. On boot the service compares it against the
   running configuration and **refuses to start** on a mismatch.
3. **A golden-vector test.** `tests/golden/` pins the exact bytes the pipeline
   produces for a fixed input, so a silent behaviour change — an OpenCV upgrade,
   a flag edit — is a red build rather than a slow degradation.

If the fingerprint changes, re-fit before deploying. Regenerating the golden to
make a build pass, without re-fitting, is the one thing that turns this guard
into a liability.

---

## 6. Where CLAHE sits, and why

CLAHE runs **after** alignment, on the 112×112 chip, not on the full frame and
not before the warp.

- On a full photograph a bright window dominates the histogram and washes the
  face out. On the chip, the histogram is the face.
- Running after the warp means CLAHE sees exactly the pixels the model will.

CLAHE does shift the input distribution away from what ArcFace was trained on.
That is harmless here for two reasons: it is applied identically at enrolment and
at verification, so the comparison stays self-consistent; and the calibration is
fitted on this exact pipeline, so any shift is absorbed by the fit. This is
precisely why the fingerprint guard exists — the fit and the pipeline are one
unit.

It can be disabled (`PreprocessConfig(clahe=False)`) for an A/B during
calibration. Changing it changes the fingerprint, which forces a re-fit. That is
the intended behaviour.

---

## 7. Honest limitations

**1:1 matching is not presentation-attack detection.** ArcFace compares faces; it
does not know whether it is looking at a person or a photograph of one. A printed
photo or a phone screen held to the camera can pass. The blink prompt Person 1
implements is a deterrent, not a defence.

The proper fix is a PAD model. **MiniFASNet** (Silent-Face-Anti-Spoofing) is
~1.9 MB of ONNX and runs in about 15 ms in the same session — it fits the memory
budget and is the strongest optional upgrade available to this module. It is a
stretch goal, not a commitment.

**Say this in the viva.** A stated limitation with a concrete upgrade path reads
as rigour; the same limitation discovered by an examiner holding up a phone reads
as an oversight.

**The bootstrap fit is not a measurement.** The `calibration.json` currently in
the repository carries `provenance: "BOOTSTRAP — literature defaults, NOT
measured"`. It is there so the service starts and the tests run. Replace it with
a real fit before the demo, and put the ROC curve in the report — it is the most
credible figure the group can produce.
