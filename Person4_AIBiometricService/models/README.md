# Models

Two ONNX files live here. Neither is committed — 16 MB of binary does not belong
in git, and a checksum-verified download is auditable in a way a committed blob
is not.

```bash
python scripts/fetch_models.py          # download and record checksums
python scripts/fetch_models.py --verify-only
```

They **are** baked into the container image at build time, so a cold start never
depends on an external host being reachable. A Hugging Face outage must not
become a failed check-in.

| File | Size | Role |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | ~233 KB | YuNet detector: bounding box + 5 landmarks |
| `w600k_mbf.onnx` | ~13.6 MB | ArcFace MobileFaceNet backbone, 512-d output |

`checksums.txt` is written by `scripts/fetch_models.py` on the first successful
download and **must then be committed** — `.gitignore` un-ignores it for exactly
that reason, and it is on the pre-demo checklist in
[`HANDOVER.md`](../docs/HANDOVER.md) §4. Until somebody runs the fetch and
commits the result, nothing in this repository pins the upstream artifacts, so
this is a supply-chain control that is *wired up* rather than *in force*.

Once it is committed, a mismatch on a later run means the upstream
artifact changed — which invalidates the calibration fitted against it, because a
different model produces a different score distribution. Do not shrug that off;
re-fit or restore the original weights.

---

## Why these two

**YuNet over SCRFD.** The blueprint named SCRFD-500M. YuNet ships inside OpenCV,
emits the same five landmarks natively, and does anchor decoding and NMS in
tested C++ — removing roughly 120 lines of the most bug-prone code in the
pipeline. It is also a tenth of the size. Full reasoning in
[`../docs/DECISIONS.md`](../docs/DECISIONS.md) D-01.

**`w600k_mbf` over `w600k_r50`.** The MobileFaceNet backbone is 13.6 MB against
roughly 166 MB for the ResNet-50 variant, and it runs comfortably on half a vCPU.
Accuracy is lower, but the calibration measures the actual operating point rather
than assuming one — so the trade-off is quantified rather than hoped over. If the
project later moves to paid compute, swapping in `w600k_r50` means changing
`PNSM_REC_MODEL_FILE`, re-fitting the calibration, and re-enrolling everyone
(`MODEL_VERSION_MISMATCH` will tell you).

---

## Testing without weights

```bash
PNSM_ALLOW_STUB_MODELS=true
```

Substitutes a deterministic stub detector and embedder. The same chip always
yields the same vector; different chips yield near-orthogonal ones. Every code
path around the model runs, and **results are meaningless for real faces** — the
service logs a loud warning at boot when this is set. CI uses it; nothing else
should.
