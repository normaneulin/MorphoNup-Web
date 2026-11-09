"""Export the model bundle of the web application from the MorphoNup workspace (CPU, no TensorFlow needed).

For every dataset whose k = 5, seed 151000 run is finished it writes, under website/models/ (not in git):
  <slug>/fold_<f>.weights.h5   the trained weights of fold f (refit stage when all 5 refits exist, else base)
  <slug>/fold_<f>.prep.npz     that fold's fitted shape preprocessing (the saved preprocessor.npz) plus the k-mer
                               mean and SD of its training rows (recomputed exactly as morphonup.preprocess.kmer_views)
  sequences.sqlite             every sequence of every exported dataset: name, sequence, canonical form, label,
                               the fold whose test part contains it, and its saved out-of-fold probabilities
  manifest.json                what was exported, from which run, with file hashes, and the dataset's metrics: the
                               benchmark table row, or, until the dataset has one, the metrics of this run's saved
                               out-of-fold predictions (single_run = true)

Usage (from website/, with the training environment's Python):  python scripts/export_bundle.py [--datasets ...]
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

SITE = Path(__file__).resolve().parents[1]
WORKSPACE = SITE.parent
sys.path.insert(0, str(WORKSPACE))
from morphonup import config  # noqa: E402
from morphonup.data import Dataset, make_splits  # noqa: E402
sys.path.insert(0, str(SITE / "backend"))
from morphonup_web.catalog import DATASETS, slug  # noqa: E402

K, SEED = 5, 151000
OUT = SITE / "models"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def finished_stage(run):
    for stage in ("refit", "base"):
        if all((run / f"fold_{f:02d}" / stage / "fold_summary.json").exists() for f in range(1, K + 1)):
            return stage
    return None


def outer_parts(ds):
    """Same as morphonup.cv.outer_parts (without importing TensorFlow)."""
    for p in make_splits(ds, k=K, seed=config.SPLIT_SEED):
        yield dict(fold=p["fold"], fit=np.sort(np.array(p["train"] + p["calibration"])),
                   tune=np.array(p["tune"]), test=np.array(p["test"]))


def kmer_stats(ds, fit):
    """Exactly morphonup.preprocess.kmer_views: fit rows of both strands pooled, float32 as in training."""
    raw = [ds.arrays["kmers"][s] for s in (0, 1)]
    pool = np.concatenate([raw[0][fit], raw[1][fit]])
    return pool.mean(0), np.maximum(pool.std(0), 1e-6)


def benchmark_row(dataset_id):
    """Cross-validation metrics of the dataset as reported (results/benchmark/benchmark_table.csv, k = 5, refit)."""
    path = config.RESULTS_ROOT / "benchmark" / "benchmark_table.csv"
    if not path.exists():
        return None
    table = pd.read_csv(path)
    row = table[(table["dataset"] == dataset_id) & (table["k"] == K)]
    if row.empty:
        return None
    r = row.iloc[0]
    out = {m: float(r[f"{m}_mean"]) for m in ("accuracy", "balanced_accuracy", "mcc", "roc_auc", "pr_auc")}
    out["seeds"] = int(r["n_seeds"])
    out["accuracy_sd"] = None if pd.isna(r["accuracy_sd"]) else float(r["accuracy_sd"])
    return out


def oof_metrics(oof):
    """Metrics of the saved out-of-fold predictions of this one run (seed 151000), for a dataset that has no row in the
    benchmark table yet (its refit or its other seeds are still training). Same definitions as the benchmark table."""
    from sklearn.metrics import accuracy_score, average_precision_score, balanced_accuracy_score, matthews_corrcoef, roc_auc_score
    y, p = oof["label"].to_numpy(), oof["probability"].to_numpy()
    pred = (p >= 0.5).astype(int)
    return dict(accuracy=float(accuracy_score(y, pred)), balanced_accuracy=float(balanced_accuracy_score(y, pred)),
                mcc=float(matthews_corrcoef(y, pred)), roc_auc=float(roc_auc_score(y, p)),
                pr_auc=float(average_precision_score(y, p)), seeds=1, accuracy_sd=None, single_run=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", nargs="*", help="dataset ids (default: all finished)")
    args = ap.parse_args()
    t0 = time.time()
    OUT.mkdir(exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(datasets={})
    db = sqlite3.connect(OUT / "sequences.sqlite")
    db.execute("""CREATE TABLE IF NOT EXISTS sequences (dataset TEXT, idx INTEGER, name TEXT, sequence TEXT,
                  canon TEXT, label INTEGER, fold INTEGER, p REAL, p_fwd REAL, p_rc REAL,
                  PRIMARY KEY (dataset, idx))""")
    for dataset_id, species, region in DATASETS:
        if args.datasets and dataset_id not in args.datasets:
            continue
        run = config.RESULTS_ROOT / dataset_id / f"k{K}" / "full" / f"seed_{SEED}"
        stage = finished_stage(run)
        if stage is None:
            print(f"skip {dataset_id}: k = {K}, seed {SEED} not finished", flush=True)
            continue
        ds = Dataset(config.dataset_folder(dataset_id))
        seqs = ["".join("ACGT"[i] for i in row) for row in ds.arrays["sequence"][0].argmax(-1)]
        folder = OUT / slug(dataset_id)
        folder.mkdir(exist_ok=True)
        folds, oof = [], []
        for part in outer_parts(ds):
            f = part["fold"]
            src = run / f"fold_{f:02d}" / stage
            saved = pd.read_csv(src / "test_predictions.csv")
            assert np.array_equal(saved["index"].to_numpy(), part["test"]), f"{dataset_id} fold {f}: split mismatch"
            fit = part["fit"] if stage == "base" else np.sort(np.concatenate([part["fit"], part["tune"]]))
            summary = json.loads((src / "fold_summary.json").read_text())
            assert len(fit) == summary["n_fit"], (dataset_id, f, len(fit), summary["n_fit"])
            mu, sd = kmer_stats(ds, fit)
            prep = dict(np.load(src / "preprocessor.npz", allow_pickle=False))
            np.savez(folder / f"fold_{f}.prep.npz", **prep, kmer_mean=mu, kmer_std=sd)
            shutil.copyfile(src / "best.weights.h5", folder / f"fold_{f}.weights.h5")
            folds.append(dict(fold=f, weights=f"{slug(dataset_id)}/fold_{f}.weights.h5",
                              prep=f"{slug(dataset_id)}/fold_{f}.prep.npz",
                              weights_sha256=sha256(folder / f"fold_{f}.weights.h5"),
                              test_correct=summary["test_correct"], n_test=summary["n_test"],
                              source=str(src.relative_to(WORKSPACE))))
            oof.append(saved)
        oof = pd.concat(oof).sort_values("index")
        assert np.array_equal(oof["index"].to_numpy(), np.arange(len(seqs)))
        assert np.array_equal(oof["label"].to_numpy(), ds.y)
        db.execute("DELETE FROM sequences WHERE dataset = ?", (dataset_id,))
        db.executemany("INSERT INTO sequences VALUES (?,?,?,?,?,?,?,?,?,?)",
                       [(dataset_id, int(i), str(ds.ids[i]), seqs[i], str(ds.canon[i]), int(ds.y[i]), int(r.fold),
                         float(r.probability), float(r.probability_fwd), float(r.probability_rc))
                        for i, r in zip(oof["index"], oof.itertuples())])
        db.commit()
        manifest["datasets"][dataset_id] = dict(slug=slug(dataset_id), species=species, region=region, k=K, seed=SEED,
                                                stage=stage, n=len(seqs), positive=int(ds.y.sum()), folds=folds,
                                                benchmark=benchmark_row(dataset_id) or oof_metrics(oof))
        print(f"{dataset_id}: {stage}, {len(seqs)} sequences ({time.time() - t0:.0f} s)", flush=True)
    db.execute("CREATE INDEX IF NOT EXISTS by_canon ON sequences (dataset, canon)")
    db.execute("CREATE INDEX IF NOT EXISTS by_label ON sequences (dataset, label, idx)")
    db.commit()
    db.close()
    manifest.update(format=1, built=time.strftime("%Y-%m-%d %H:%M"), network_parameters=134442)
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(f"bundle in {OUT}: {len(manifest['datasets'])} datasets")


if __name__ == "__main__":
    main()
