#!/usr/bin/env python3
"""Fit the cosine-to-confidence mapping on a real dataset.

This script is the answer to blueprint correction 1.  FR-07 says a check-in is
approved at 85% confidence.  ArcFace does not put genuine pairs above 0.85 raw
cosine -- DeepFace's own calibrated default for ArcFace is a cosine *distance*
of 0.68, i.e. a similarity of 0.32 -- so ``confidence = cosine * 100`` would
reject nearly every real employee.

The fix keeps FR-07's wording exactly true by making confidence a fitted
logistic function of cosine::

    confidence = 100 / (1 + exp(-a * (cosine - b)))

* ``b`` is the decision midpoint, taken from the **impostor** distribution at a
  target false-accept rate. It controls how often a stranger gets in.
* ``a`` is the slope, taken from the **genuine** distribution so that a chosen
  fraction of legitimate pairs clears the approve band. It controls how often
  an employee is wrongly flagged.

Separating the two is what makes the result explainable: one number is set by
security, the other by usability, and both are measured rather than guessed.

Dataset layout -- one directory per person::

    calibration/dataset/
      nakibul/  img01.jpg img02.jpg ...   (8-10 photos: indoor, outdoor,
      sanjida/  ...                        morning, evening, glasses on/off,
      mohim/    ...                        one slightly off-angle)
      mehnaz/   ...

Aim for at least 8 identities and 80 images. Photographs are personal data:
collect them with consent, keep ``calibration/dataset/`` out of git (it already
is), and delete it when the project is marked.

Usage::

    python calibration/build_calibration.py --dataset calibration/dataset
    python calibration/build_calibration.py --dataset ... --target-far 0.005
    python calibration/build_calibration.py --dataset ... --dry-run
"""

from __future__ import annotations

import argparse
import datetime as _dt
import itertools
import json
import math
import sys
from collections.abc import Sequence
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from app.ai.detect import YuNetDetector  # noqa: E402
from app.ai.preprocess import DEFAULT_PREPROCESS, preprocess_face  # noqa: E402
from app.ai.score import l2_normalise  # noqa: E402
from app.ai.session import OnnxEmbedder  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


# ------------------------------------------------------------------ embedding
def load_identities(dataset: Path) -> dict[str, list[Path]]:
    if not dataset.exists():
        raise SystemExit(
            f"No dataset at {dataset}.\n"
            "Create one directory per person, each holding 8-10 photographs:\n"
            f"  {dataset}/nakibul/img01.jpg ...\n"
            "See the module docstring for what makes a good set."
        )
    identities: dict[str, list[Path]] = {}
    for child in sorted(dataset.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        images = sorted(p for p in child.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
        if len(images) >= 2:
            identities[child.name] = images
        elif images:
            print(f"  skipping {child.name}: only {len(images)} image, need at least 2")
    if len(identities) < 2:
        raise SystemExit(
            f"Found {len(identities)} usable identities in {dataset}; at least 2 are required "
            "and at least 8 are recommended for a stable fit."
        )
    return identities


def embed_dataset(
    identities: dict[str, list[Path]], model_dir: Path, model_version: str
) -> dict[str, list[np.ndarray]]:
    """Run every photograph through the *production* pipeline.

    Using the same ``preprocess_face`` the service uses is the whole point: a
    calibration fitted on a different pipeline describes a different system.
    """
    import cv2

    detector = YuNetDetector(model_dir / "face_detection_yunet_2023mar.onnx")
    embedder = OnnxEmbedder(model_dir / "w600k_mbf.onnx", model_version)

    vectors: dict[str, list[np.ndarray]] = {}
    skipped = 0
    for identity, paths in identities.items():
        collected: list[np.ndarray] = []
        for path in paths:
            frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if frame is None:
                print(f"  skip {path}: unreadable")
                skipped += 1
                continue
            detections = detector.detect(frame)
            if len(detections) != 1:
                print(f"  skip {path}: {len(detections)} faces detected, need exactly 1")
                skipped += 1
                continue
            tensor, _ = preprocess_face(frame, detections[0].landmarks, DEFAULT_PREPROCESS)
            collected.append(l2_normalise(embedder.embed(tensor)))
        if len(collected) >= 2:
            vectors[identity] = collected
            print(f"  {identity}: {len(collected)} embeddings")
        else:
            print(f"  dropping {identity}: fewer than 2 usable images")
    if skipped:
        print(f"  ({skipped} images skipped)")
    return vectors


# --------------------------------------------------------------------- pairs
def build_pairs(vectors: dict[str, list[np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """All within-identity pairs (genuine) and across-identity pairs (impostor)."""
    genuine: list[float] = []
    impostor: list[float] = []

    for group in vectors.values():
        for left, right in itertools.combinations(group, 2):
            genuine.append(float(np.dot(left, right)))

    for (_, left_group), (_, right_group) in itertools.combinations(vectors.items(), 2):
        for left in left_group:
            for right in right_group:
                impostor.append(float(np.dot(left, right)))

    return np.array(genuine, dtype=np.float64), np.array(impostor, dtype=np.float64)


def roc(genuine: np.ndarray, impostor: np.ndarray, steps: int = 2001) -> dict[str, np.ndarray]:
    """Sweep a cosine threshold and record the two error rates at each point."""
    thresholds = np.linspace(-1.0, 1.0, steps)
    tar = np.array([(genuine >= t).mean() for t in thresholds])
    far = np.array([(impostor >= t).mean() for t in thresholds])
    return {"threshold": thresholds, "tar": tar, "far": far}


def auc_score(genuine: np.ndarray, impostor: np.ndarray) -> float:
    """Area under the ROC curve, via the Mann-Whitney U identity.

    Equivalent to the probability that a random genuine pair outscores a random
    impostor pair, which is the interpretation worth putting in the report.
    """
    combined = np.concatenate([genuine, impostor])
    order = combined.argsort()
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(combined) + 1)
    # Average ranks within ties so the statistic stays unbiased.
    _, inverse, counts = np.unique(combined, return_inverse=True, return_counts=True)
    sums = np.zeros(len(counts))
    np.add.at(sums, inverse, ranks)
    ranks = (sums / counts)[inverse]

    n_gen = len(genuine)
    rank_sum = ranks[:n_gen].sum()
    return float((rank_sum - n_gen * (n_gen + 1) / 2) / (n_gen * len(impostor)))


# ----------------------------------------------------------------------- fit
def midpoint_at_far(impostor: np.ndarray, target_far: float) -> float:
    """Lowest cosine whose false-accept rate is at or below ``target_far``."""
    if len(impostor) == 0:
        raise SystemExit("no impostor pairs; add more identities")
    # The (1 - target) quantile of the impostor scores is exactly the threshold
    # at which that fraction of impostors would be accepted.
    return float(np.quantile(impostor, 1.0 - target_far))


def slope_anchored(genuine: np.ndarray, midpoint: float, approve: float, coverage: float) -> float:
    """Slope such that ``coverage`` of genuine pairs reach the approve band."""
    anchor = float(np.quantile(genuine, 1.0 - coverage))
    gap = anchor - midpoint
    logit = math.log(approve / (100.0 - approve))
    if gap <= 1e-6:
        # The genuine and impostor distributions overlap badly: no slope puts
        # the requested coverage above the requested FAR. Fall back to MLE and
        # say so loudly rather than emitting a nonsensical fit.
        return float("nan")
    return logit / gap


def slope_mle(
    genuine: np.ndarray, impostor: np.ndarray, midpoint: float, iterations: int = 200
) -> float:
    """Maximum-likelihood slope with the midpoint held fixed.

    One-dimensional Newton on the logistic log-likelihood. Plain numpy: this
    script deliberately avoids a scipy or sklearn dependency so it runs
    anywhere the service runs.
    """
    scores = np.concatenate([genuine, impostor]) - midpoint
    labels = np.concatenate([np.ones(len(genuine)), np.zeros(len(impostor))])
    a = 10.0
    for _ in range(iterations):
        z = np.clip(a * scores, -500, 500)
        p = 1.0 / (1.0 + np.exp(-z))
        gradient = float(np.sum((labels - p) * scores))
        hessian = float(-np.sum(p * (1.0 - p) * scores**2))
        if abs(hessian) < 1e-12:
            break
        step = gradient / hessian
        a_next = a - step
        if not math.isfinite(a_next) or a_next <= 0:
            a_next = max(a / 2.0, 1e-3)
        if abs(a_next - a) < 1e-9:
            a = a_next
            break
        a = a_next
    return float(a)


def confidence(cosine: np.ndarray | float, a: float, b: float) -> np.ndarray | float:
    z = np.clip(-a * (np.asarray(cosine, dtype=np.float64) - b), -500, 500)
    return 100.0 / (1.0 + np.exp(z))


# -------------------------------------------------------------------- report
def plot(
    genuine: np.ndarray,
    impostor: np.ndarray,
    curve: dict[str, np.ndarray],
    a: float,
    b: float,
    approve: float,
    output: Path,
) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("  matplotlib not installed; skipping the plot")
        return

    figure, axes = plt.subplots(1, 3, figsize=(16, 4.6))

    axes[0].hist(impostor, bins=60, alpha=0.65, label="impostor", color="#9E2A22", density=True)
    axes[0].hist(genuine, bins=60, alpha=0.65, label="genuine", color="#0A6B74", density=True)
    approve_cosine = b + math.log(approve / (100 - approve)) / a
    axes[0].axvline(approve_cosine, color="#111", linestyle="--", label=f"approve @ cos {approve_cosine:.3f}")
    axes[0].set_title("Score distributions")
    axes[0].set_xlabel("cosine similarity")
    axes[0].legend(fontsize=8)

    axes[1].plot(curve["far"], curve["tar"], color="#0A6B74")
    axes[1].set_xscale("symlog", linthresh=1e-4)
    axes[1].set_title(f"ROC (AUC = {auc_score(genuine, impostor):.4f})")
    axes[1].set_xlabel("false accept rate")
    axes[1].set_ylabel("true accept rate")
    axes[1].grid(alpha=0.3)

    grid = np.linspace(-0.2, 1.0, 400)
    axes[2].plot(grid, confidence(grid, a, b), color="#0A6B74", label="calibrated")
    axes[2].plot(grid, grid * 100, color="#9E2A22", linestyle=":", label="naive cosine x 100")
    axes[2].axhline(approve, color="#111", linestyle="--", linewidth=0.8)
    axes[2].set_ylim(-2, 102)
    axes[2].set_title("Cosine to confidence")
    axes[2].set_xlabel("cosine similarity")
    axes[2].set_ylabel("confidence")
    axes[2].legend(fontsize=8)

    figure.tight_layout()
    figure.savefig(output, dpi=140)
    print(f"  wrote {output}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, default=REPO_ROOT / "calibration" / "dataset")
    parser.add_argument("--model-dir", type=Path, default=REPO_ROOT / "models")
    parser.add_argument("--model-version", default="arcface_w600k_mbf_v1")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "calibration" / "calibration.json")
    parser.add_argument("--plot", type=Path, default=REPO_ROOT / "calibration" / "calibration.png")
    parser.add_argument("--target-far", type=float, default=0.01, help="false-accept rate at the midpoint")
    parser.add_argument("--coverage", type=float, default=0.95, help="fraction of genuine pairs to clear approve")
    parser.add_argument("--approve", type=float, default=85.0)
    parser.add_argument("--flag", type=float, default=60.0)
    parser.add_argument("--fit", choices=("anchored", "mle"), default="anchored")
    parser.add_argument("--dry-run", action="store_true", help="report but do not write calibration.json")
    args = parser.parse_args(argv)

    print(f"Loading dataset from {args.dataset}")
    identities = load_identities(args.dataset)
    print(f"Embedding {sum(len(v) for v in identities.values())} images from {len(identities)} identities")
    vectors = embed_dataset(identities, args.model_dir, args.model_version)

    genuine, impostor = build_pairs(vectors)
    print(f"\nPairs: {len(genuine)} genuine, {len(impostor)} impostor")
    if len(genuine) < 20 or len(impostor) < 50:
        print("  WARNING: this is a small sample. The fit will be unstable; collect more photos.")

    print(
        f"  genuine  cosine: min {genuine.min():.3f}  median {np.median(genuine):.3f}  max {genuine.max():.3f}"
    )
    print(
        f"  impostor cosine: min {impostor.min():.3f}  median {np.median(impostor):.3f}  max {impostor.max():.3f}"
    )

    b = midpoint_at_far(impostor, args.target_far)
    a = slope_anchored(genuine, b, args.approve, args.coverage)
    method = args.fit
    if args.fit == "mle" or not math.isfinite(a):
        if not math.isfinite(a):
            print(
                "\n  The anchored fit is impossible: the requested genuine coverage sits below "
                "the requested false-accept rate, so the two distributions overlap too much. "
                "Falling back to maximum likelihood, and you should improve the dataset."
            )
        a = slope_mle(genuine, impostor, b)
        method = "mle"

    approve_cosine = b + math.log(args.approve / (100 - args.approve)) / a
    flag_cosine = b + math.log(args.flag / (100 - args.flag)) / a
    far = float((impostor >= approve_cosine).mean())
    frr = float((genuine < approve_cosine).mean())
    flagged_rate = float(((genuine >= flag_cosine) & (genuine < approve_cosine)).mean())
    auc = auc_score(genuine, impostor)

    print(f"\nFit ({method}): a = {a:.4f}, b = {b:.4f}")
    print(f"  approve at confidence {args.approve} == cosine {approve_cosine:.4f}")
    print(f"  flag    at confidence {args.flag} == cosine {flag_cosine:.4f}")
    print(f"  measured FAR at approve : {far:.4%}")
    print(f"  measured FRR at approve : {frr:.4%}  (of which {flagged_rate:.2%} are flagged, not rejected)")
    print(f"  AUC                     : {auc:.4f}")
    if auc < 0.95:
        print("  WARNING: AUC below 0.95 suggests poor photo quality or mislabelled identities.")

    curve = roc(genuine, impostor)
    plot(genuine, impostor, curve, a, b, args.approve, args.plot)

    payload = {
        "calibration_version": f"cal-{_dt.date.today().isoformat()}",
        "model_version": args.model_version,
        "logistic": {"a": round(a, 6), "b": round(b, 6)},
        "bands": {"approve": args.approve, "flag": args.flag},
        "measured": {
            "identities": len(vectors),
            "images": sum(len(v) for v in vectors.values()),
            "genuine_pairs": len(genuine),
            "impostor_pairs": len(impostor),
            "far": round(far, 6),
            "frr": round(frr, 6),
            "flagged_rate": round(flagged_rate, 6),
            "auc": round(auc, 6),
            "tar_at_far_1pct": round(float((genuine >= midpoint_at_far(impostor, 0.01)).mean()), 6),
            "approve_at_cosine": round(approve_cosine, 6),
            "flag_at_cosine": round(flag_cosine, 6),
            "fit_method": method,
            "target_far": args.target_far,
            "coverage": args.coverage,
            "preprocess_fingerprint": DEFAULT_PREPROCESS.fingerprint(),
            "preprocess": DEFAULT_PREPROCESS.as_dict(),
        },
        "fitted_at": _dt.datetime.now(_dt.UTC).isoformat().replace("+00:00", "Z"),
    }

    if args.dry_run:
        print("\n--dry-run: not writing. Result would be:")
        print(json.dumps(payload, indent=2))
        return 0

    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {args.output}")
    print("Restart the service, or POST /v1/admin/recalibrate to load it without a restart.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
