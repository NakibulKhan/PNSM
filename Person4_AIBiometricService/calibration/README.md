# Calibration

The fitted mapping from cosine similarity to the confidence number FR-07 talks
about. **Read [`../docs/CALIBRATION.md`](../docs/CALIBRATION.md) before touching
anything here** — it explains why `cosine × 100` cannot work and what replaces it.

```
calibration.json          the committed fit -- the service will not start without it
build_calibration.py      the fitting script
calibration.png           generated: distributions, ROC, cosine-to-confidence
dataset/                  gitignored: the team's photographs
```

---

## Status of the committed fit

`calibration.json` is currently a **bootstrap**: literature defaults, not a
measurement. It carries its own warning:

```json
"provenance": "BOOTSTRAP - literature defaults, NOT measured. Replace before the demo."
```

It exists so the service starts and the tests run. Replace it with a real fit.

```bash
make calibrate
```

---

## The dataset

```
dataset/
  nakibul/  img01.jpg ... img09.jpg
  sanjida/  ...
  mohim/    ...
  mehnaz/   ...
  volunteer1/ ...
```

Per person, 8–10 photographs: indoor, outdoor, morning, evening, with and without
glasses, one slightly off-angle. Aim for ~10 identities and 80+ images.

Why the variation matters: a set shot in one sitting produces a genuine
distribution far tighter than reality. The fit comes out over-confident, and the
demo — different room, different day — falls outside it.

> **Consent and deletion.** These are biometric photographs of real people.
> Collect them with explicit permission, keep this directory out of git (it
> already is), and delete it once the project is marked. The same principle the
> system claims to uphold applies to the team's own data.

---

## Reading a fit

```
Fit (anchored): a = 18.2143, b = 0.4187
  approve at confidence 85.0 == cosine 0.5152
  measured FAR at approve : 0.9300%
  measured FRR at approve : 4.1000%
  AUC                     : 0.9962
```

Before trusting it:

- **AUC ≥ 0.98** — lower means poor photos or a mislabelled identity
- **`approve_at_cosine` between 0.30 and 0.80** — outside that, something is wrong
- **impostor median near 0.05** — a high median suggests alignment is failing
- **genuine minimum above the impostor maximum** — overlap means the anchored fit
  is impossible; the script says so and falls back to maximum likelihood

---

## The fingerprint

`measured.preprocess_fingerprint` records the preprocessing configuration the fit
was measured against. The service compares it at boot and **refuses to start** on
a mismatch, because a calibration fitted on a different pipeline describes a
different system.

If you change preprocessing: re-fit here, *then* run
`python scripts/update_golden.py`. Regenerating the golden to silence a red build,
without re-fitting, turns the guard into a liability.
