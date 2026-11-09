"""MorphoNup predictions for the web application.

Rule (see docs/PLAN.md section 5 and section 3.12 of the paper):
  * a sequence that belongs to the chosen dataset is predicted by the one fold model whose test part contained it, so
    the answer is the out-of-fold prediction behind the reported accuracy (the model never saw that sequence);
  * any other valid 147-bp sequence gets the mean of the five fold models.
Each model reads both strands and averages them; 0.5 or more means nucleosomal.

The network code is the `morphonup` package of the MorphoNup repository (build_core, build_model, config.settings),
so the graph is the one that was trained. Set MORPHONUP_PACKAGE to the folder that contains `morphonup/` when the
package is not installed; inside the MorphoNup workspace it is found automatically.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
from pathlib import Path

import numpy as np

from .inputs import FoldPreprocessor, raw_views
from .shape import clean, encode, load_tables

SITE = Path(__file__).resolve().parents[2]
BUNDLE = Path(os.environ.get("MORPHONUP_BUNDLE", SITE / "models"))
_package = os.environ.get("MORPHONUP_PACKAGE", str(SITE.parent))
if (Path(_package) / "morphonup" / "network.py").exists() and _package not in sys.path:
    sys.path.insert(0, _package)

COMPLEMENT = str.maketrans("ACGT", "TGCA")
THRESHOLD = 0.5


def reverse_complement(seq: str) -> str:
    return seq.translate(COMPLEMENT)[::-1]


class Predictor:
    def __init__(self, bundle: Path | str = BUNDLE, batch_size: int = 512):
        self.bundle = Path(bundle)
        self.manifest = json.loads((self.bundle / "manifest.json").read_text())
        self.db_path = self.bundle / "sequences.sqlite"
        self.batch_size = batch_size
        self.tables = load_tables()
        self._models: dict[str, list] = {}
        self._lock = threading.Lock()
        self._local = threading.local()

    # ------------------------------------------------------------------ data
    @property
    def datasets(self) -> dict:
        return self.manifest["datasets"]

    def _db(self) -> sqlite3.Connection:
        if getattr(self._local, "db", None) is None:
            self._local.db = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True, check_same_thread=False)
            self._local.db.row_factory = sqlite3.Row
        return self._local.db

    def lookup(self, dataset_id: str, seq: str) -> dict | None:
        """The dataset row of a sequence (same strand preferred, else its reverse complement), or None."""
        canon = min(seq, reverse_complement(seq))
        rows = self._db().execute("SELECT * FROM sequences WHERE dataset = ? AND canon = ? ORDER BY idx",
                                  (dataset_id, canon)).fetchall()
        if not rows:
            return None
        same = [r for r in rows if r["sequence"] == seq]
        row = dict((same or rows)[0])
        row["strand"] = "same" if same else "reverse complement"
        row["copies"] = len(rows)
        return row

    # ------------------------------------------------------------------ models
    def models(self, dataset_id: str) -> list:
        """The five (fold, model, preprocessor) of a dataset, built once and kept."""
        if dataset_id not in self.datasets:
            raise KeyError(f"Unknown dataset: {dataset_id}")
        with self._lock:
            if dataset_id not in self._models:
                import tensorflow as tf  # noqa: F401  (imported here so the shape engine works without TensorFlow)
                from morphonup import config
                from morphonup.network import build_core
                from morphonup.training import build_model
                cfg = config.settings()
                loaded = []
                for f in self.datasets[dataset_id]["folds"]:
                    prep = FoldPreprocessor(self.bundle / f["prep"])
                    core = build_core(cfg, prep.channels, prep.groups())
                    model = build_model(cfg, core)
                    model.load_weights(self.bundle / f["weights"])
                    assert core.count_params() == self.manifest["network_parameters"]
                    loaded.append((f["fold"], model, prep))
                self._models[dataset_id] = loaded
        return self._models[dataset_id]

    def _run(self, model, view: dict) -> np.ndarray:
        n = len(view["sequence"])
        out = []
        for start in range(0, n, self.batch_size):
            batch = {k: v[start:start + self.batch_size] for k, v in view.items()}
            out.append(np.asarray(model(batch, training=False), dtype=np.float64).ravel())
        return np.concatenate(out)

    def probabilities(self, dataset_id: str, enc: np.ndarray, folds: np.ndarray | None = None) -> dict:
        """p_fwd, p_rc and p for encoded sequences (n, 147). folds[i] = fold model for sequence i, or 0 for the
        mean of all five. Returns arrays of length n."""
        enc = np.atleast_2d(enc)
        folds = np.zeros(len(enc), dtype=int) if folds is None else np.asarray(folds, dtype=int)
        raw = raw_views(enc, self.tables)
        p_fwd, p_rc = np.zeros(len(enc)), np.zeros(len(enc))
        for fold, model, prep in self.models(dataset_id):
            own, mean = folds == fold, folds == 0
            use = own | mean
            if not use.any():
                continue
            sub = {k: (v[0][use], v[1][use]) for k, v in raw.items() if k != "raw"}
            a, b = prep.views(sub)
            pa, pb = self._run(model, a), self._run(model, b)
            weight = np.where(own[use], 1.0, 1.0 / len(self.datasets[dataset_id]["folds"]))
            p_fwd[use] += weight * pa
            p_rc[use] += weight * pb
        return dict(p_fwd=p_fwd, p_rc=p_rc, p=0.5 * (p_fwd + p_rc), shape=raw["raw"])

    # ------------------------------------------------------------------ one request
    def predict(self, dataset_id: str, text: str) -> dict:
        """Prediction for one entered sequence. Raises shape.SequenceError with a plain message for bad input."""
        seq = clean(text)
        enc = encode(seq)
        row = self.lookup(dataset_id, seq)
        fold = row["fold"] if row else 0
        r = self.probabilities(dataset_id, enc[None, :], np.array([fold]))
        info = self.datasets[dataset_id]
        p = float(r["p"][0])
        return dict(
            dataset=dataset_id, sequence=seq, length=len(seq),
            probability=p, probability_forward=float(r["p_fwd"][0]), probability_reverse=float(r["p_rc"][0]),
            label="nucleosomal" if p >= THRESHOLD else "linker", threshold=THRESHOLD,
            model=dict(kind="held-out fold model" if row else "mean of the five fold models",
                       fold=int(fold) if row else None, k=info["k"], seed=info["seed"], stage=info["stage"]),
            in_dataset=None if row is None else dict(
                name=row["name"], label="nucleosomal" if row["label"] == 1 else "linker",
                strand=row["strand"], saved_probability=row["p"], copies=row["copies"]),
            shape={name: [None if np.isnan(v) else round(float(v), 2) for v in values[0]]
                   for name, values in r["shape"].items()},
        )
