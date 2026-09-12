# Model weights — required, and not in git

The AI verification service loads two ONNX models at startup. **Both are
gitignored** (`.gitignore`: `models/*.onnx`), so a fresh `git clone` will not
contain them and the service will fail at model load.

This is deliberate — they are 13.8 MB of binary weights that would bloat every
clone and every fetch — but it means **getting them is a required deployment
step, not an optional one**.

## What's needed

| File | Size | SHA-256 |
|---|---|---|
| `w600k_mbf.onnx` | 13,616,099 B | `9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f` |
| `face_detection_yunet_2023mar.onnx` | 232,589 B | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |

They belong in `../../M/ai-service/models/`.

## Fetching them

```bash
cd ../../M/ai-service
python scripts/fetch_models.py
```

## Verifying them — do this before every deploy

```bash
cd ../../M/ai-service/models
sha256sum -c checksums.txt
```

A mismatch is not a warning to click through. The decision thresholds in the
service were fitted by ROC calibration **against these exact weights** — a
different artifact silently invalidates that calibration, meaning the
auto-approve threshold no longer means what it was measured to mean. If the
hashes don't match, stop and escalate to N2 rather than deploying.

> Note: on Windows, `sha256sum -c checksums.txt` may report "No such file or
> directory" for both entries. That is a CRLF line-ending artifact in
> `checksums.txt`, not corruption — compare `sha256sum *.onnx` output against
> the table above directly to confirm.
