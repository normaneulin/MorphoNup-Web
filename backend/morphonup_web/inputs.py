"""Model inputs of MorphoNup for any sequence, built exactly like the training loader (morphonup/data.py).

The training loader reads DNAshapeR export files; here the 14 tracks come from the lookup engine (shape.py), which
reproduces those files exactly. Everything after that copies data.py and preprocess.py step by step:

  one-hot (147, 4) and its reverse complement (positions reversed, channels complemented);
  base-pair tracks at positions 2..144 (143 values), step tracks at steps 1..144 (144 values);
  reverse strand = the same tracks reversed, with the sign of Buckle, Shear, Shift and Tilt flipped;
  tracks14 = 7 geometric base-pair tracks, the 6 steps averaged onto base-pair centres, EP   (143, 14);
  1-4-mer frequencies (340) of each strand.

Fold-specific scaling (z-scores, PLS rotation, k-mer mean and SD of that fold's training rows) is applied by
`FoldPreprocessor`, loaded from the model bundle written by scripts/export_bundle.py.
"""
from __future__ import annotations

import numpy as np

from .shape import BP_TRACKS, STEP_TRACKS, shape_tracks, window_codes

GEOMETRY_BP = [n for n in BP_TRACKS if n != "EP"]
SIGN = {n: (-1.0 if n in {"Buckle", "Shear", "Shift", "Tilt"} else 1.0) for n in BP_TRACKS + STEP_TRACKS}
NAMES14 = ["Buckle", "MGW", "Opening", "ProT", "Shear", "Stagger", "Stretch",
           "HelT", "Rise", "Roll", "Shift", "Slide", "Tilt", "EP"]


def kmer_features(enc: np.ndarray) -> np.ndarray:
    """(n, 147) -> (n, 340): frequencies of all 1-, 2-, 3- and 4-mers, as in data.py."""
    feats = []
    for k in range(1, 5):
        codes = window_codes(enc, k)
        feats.append(np.stack([np.bincount(row, minlength=4 ** k) / len(row) for row in codes]).astype(np.float32))
    return np.concatenate(feats, axis=1)


def raw_views(enc: np.ndarray, tables: dict | None = None) -> dict:
    """Unscaled inputs of both strands for a batch of encoded sequences (n, 147).

    Returns dict(sequence=(X, Xrc), kmers=(K, Krc), tracks14=(H, Hrc), raw=tracks) with float32 arrays."""
    enc = np.atleast_2d(np.asarray(enc, dtype=np.int64))
    assert enc.shape[1] == 147, enc.shape
    X = np.eye(4, dtype=np.float32)[enc]
    Xrc = X[:, ::-1, ::-1].copy()
    enc_rc = 3 - enc[:, ::-1]
    raw = shape_tracks(enc, tables)
    native_rc = {n: raw[n][:, ::-1] * SIGN[n] for n in raw}

    def tracks14(native):
        G = np.stack([native[n][:, 2:145] for n in GEOMETRY_BP], axis=-1)              # (n, 143, 7)
        T = np.stack([native[n][:, 1:145] for n in STEP_TRACKS], axis=-1)              # (n, 144, 6)
        E = native["EP"][:, 2:145, None]                                                # (n, 143, 1)
        return np.concatenate([G, 0.5 * (T[:, :-1] + T[:, 1:]), E], axis=-1).astype(np.float32)

    H, Hrc = tracks14(raw), tracks14(native_rc)
    assert np.isfinite(H).all() and np.isfinite(Hrc).all()
    return dict(sequence=(X, Xrc), kmers=(kmer_features(enc), kmer_features(enc_rc)), tracks14=(H, Hrc), raw=raw)


class FoldPreprocessor:
    """The fitted preprocessing of one fold: shape z-scores, PLS block, score standardization and k-mer scaling."""

    def __init__(self, npz):
        d = dict(np.load(npz, allow_pickle=False))
        self.mean, self.std = d["mean"].astype(np.float64), d["std"].astype(np.float64)
        self.explicit = d["explicit"].astype(int)
        self.channel_names = [str(c) for c in d["channel_names"]]
        self.blocks = []
        j = 0
        while f"block{j}_idx" in d:
            self.blocks.append(dict(idx=d[f"block{j}_idx"].astype(int), rotation=d[f"block{j}_rotation"].astype(np.float64),
                                    score_mean=d[f"block{j}_score_mean"].astype(np.float64),
                                    score_std=d[f"block{j}_score_std"].astype(np.float64)))
            j += 1
        self.kmer_mean, self.kmer_std = d["kmer_mean"], d["kmer_std"]
        self.channels = len(self.explicit) + sum(b["rotation"].shape[1] for b in self.blocks)

    def groups(self):
        """Prototype groups, as PhysicalReducer.groups(): one per explicit channel, one per block."""
        groups = [[j] for j in range(len(self.explicit))]
        start = len(self.explicit)
        for b in self.blocks:
            k = b["rotation"].shape[1]
            groups.append(list(range(start, start + k)))
            start += k
        return groups

    def physics(self, x: np.ndarray) -> np.ndarray:
        """PhysicalReducer.transform: (n, 143, 14) -> (n, 143, channels)."""
        n, length, _ = x.shape
        z = (x.reshape(-1, 14).astype(np.float64) - self.mean) / self.std
        out = [z[:, self.explicit]]
        for b in self.blocks:
            out.append((z[:, b["idx"]] @ b["rotation"] - b["score_mean"]) / b["score_std"])
        return np.concatenate(out, axis=1).reshape(n, length, self.channels).astype(np.float32)

    def views(self, raw: dict) -> tuple[dict, dict]:
        """Model input dicts of the forward and reverse strand."""
        return tuple({"sequence": raw["sequence"][s],
                      "kmers": ((raw["kmers"][s] - self.kmer_mean) / self.kmer_std).astype(np.float32),
                      "physics": self.physics(raw["tracks14"][s])} for s in (0, 1))
