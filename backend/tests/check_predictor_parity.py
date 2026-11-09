"""Parity of the web predictor with the saved MorphoNup runs (CPU only).

1. Same inputs, same numbers: on DatasetNup_1/Homo_sapiens (k = 5, seed 151000) the predictor's probabilities,
   computed from the sequence text alone (shape lookup, rebuilt inputs, exported preprocessing), must equal the
   package's own CPU predictions in ../tests/reference_cpu_predictions.npz within 1e-5.
2. Every exported dataset, every sequence: routed to its held-out fold model, the probability must match the saved
   out-of-fold prediction (made on the GPU, whose TF32 arithmetic differs by about 1e-4) within 1e-3, and no
   predicted class may change unless the saved probability lies within 1e-3 of the 0.5 threshold.

Usage (from website/):  CUDA_VISIBLE_DEVICES= python backend/tests/check_predictor_parity.py [--datasets ...]
"""
import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
SITE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SITE / "backend"))

import numpy as np  # noqa: E402

from morphonup_web.predictor import Predictor  # noqa: E402

ACGT = {c: i for i, c in enumerate("ACGT")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", nargs="*")
    args = ap.parse_args()
    import tensorflow as tf
    assert not tf.config.list_physical_devices("GPU"), "run on CPU: CUDA_VISIBLE_DEVICES="
    pred, ok, t0 = Predictor(), True, time.time()
    db = sqlite3.connect(pred.db_path)

    # 1. exact replication against the package's CPU reference (HS, seed 151000, refit)
    ref_path = SITE.parent / "tests" / "reference_cpu_predictions.npz"
    hs = "DatasetNup_1/Homo_sapiens"
    if ref_path.exists() and hs in pred.datasets and pred.datasets[hs]["stage"] == "refit":
        ref = np.load(ref_path)
        worst = 0.0
        for fold in range(1, 6):
            rows = db.execute("SELECT idx, sequence FROM sequences WHERE dataset=? AND fold=? ORDER BY idx",
                              (hs, fold)).fetchall()
            enc = np.array([[ACGT[c] for c in s] for _, s in rows])
            r = pred.probabilities(hs, enc, np.full(len(enc), fold))
            worst = max(worst, float(np.abs(np.stack([r["p_fwd"], r["p_rc"], r["p"]]) - ref[f"151000_{fold}_refit"]).max()))
        passed = worst <= 1e-5
        ok &= passed
        print(f"{'ok  ' if passed else 'FAIL'} same-device check vs package CPU reference (HS): max |diff| {worst:.2e}")

    # 2. every sequence of every exported dataset vs the saved out-of-fold predictions
    for dataset_id in pred.datasets:
        if args.datasets and dataset_id not in args.datasets:
            continue
        rows = db.execute("SELECT sequence, fold, p FROM sequences WHERE dataset=? ORDER BY idx", (dataset_id,)).fetchall()
        enc = np.array([[ACGT[c] for c in s] for s, _, _ in rows])
        folds = np.array([f for _, f, _ in rows])
        saved = np.array([p for _, _, p in rows])
        p = pred.probabilities(dataset_id, enc, folds)["p"]
        diff = np.abs(p - saved)
        flips = (p >= 0.5) != (saved >= 0.5)
        bad_flips = flips & (np.abs(saved - 0.5) > 1e-3)
        passed = diff.max() <= 1e-3 and not bad_flips.any()
        ok &= passed
        print(f"{'ok  ' if passed else 'FAIL'} {dataset_id}: {len(rows)} sequences, max |diff| {diff.max():.2e}, "
              f"class changes {int(flips.sum())} (outside the 1e-3 band: {int(bad_flips.sum())}) "
              f"({time.time() - t0:.0f} s)", flush=True)
    print("PARITY", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
