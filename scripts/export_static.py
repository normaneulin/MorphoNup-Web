"""Export the model bundle as static files, so the whole site runs in the browser (GitHub Pages, no server).

Reads website/models/ (written by scripts/export_bundle.py) and writes website/frontend/public/data/:
  datasets.json             the 12 datasets grouped by species, exactly what GET /api/datasets returns
  shape_tables.json         the DNA shape lookup tables (backend/morphonup_web/data/shape_tables.json)
  <slug>/model.json         per fold: tensor offsets and shapes in model.bin, the fitted preprocessing, the limits
  <slug>/model.bin          the five fold models' weights, float32 little-endian
  <slug>/sequences.bin      every sequence of the dataset (layout below)

Only weight-only expressions are evaluated here, with the same TensorFlow ops as the layers: the normalised PWMs of
GroupedJointMotifs, its sigmoid bandwidths and strength, the fixed Gabor kernel of MotifSpectrum, BatchNormalization
as scale and shift, and the denominator of the statistics Normalization. Everything that depends on the sequence is
computed by the page (frontend/src/engine), and tests/check_static_parity.py checks it against the Keras models.

sequences.bin, for n sequences in dataset order (index 0 .. n-1):
  bytes 0 .. 4n          uint32  number in the name: <label>_sequence_<number>
  bytes 4n .. 5n         uint8   bit 0 = label (1 nucleosomal), bits 1..4 = the fold whose test part contains it
  bytes 5n .. 42n        37 bytes per sequence, 2 bits per base (A0 C1 G2 T3), base i in byte i // 4, bits 2 (i % 4)

Usage (from website/, with envs/web-api's Python; CPU only):  python scripts/export_static.py
"""
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np  # noqa: E402

SITE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SITE / "backend"))
from morphonup_web import app as webapp  # noqa: E402
from morphonup_web.predictor import Predictor  # noqa: E402
from morphonup_web.shape import TABLES_PATH  # noqa: E402

OUT = SITE / "frontend" / "public" / "data"
NAME = re.compile(r"^(nucleosomal|linker)_sequence_(\d+)$")


class Packer:
    """Concatenates float32 tensors and records their offsets (in floats) and shapes."""

    def __init__(self):
        self.parts, self.offset = [], 0

    def add(self, value):
        a = np.ascontiguousarray(np.asarray(value, dtype=np.float32))
        entry = [self.offset, list(a.shape)]
        self.parts.append(a.ravel())
        self.offset += a.size
        return entry

    def bytes(self):
        return np.concatenate(self.parts).astype("<f4").tobytes()


def fold_tensors(core, pack):
    import tensorflow as tf

    t = {}
    for layer in core.layers:
        if type(layer).__name__ != "GroupedJointMotifs":
            continue
        k = layer.k
        motif = tf.math.l2_normalize(tf.nn.softmax(layer.motif_logits, axis=-1), axis=-1)
        t[f"motifs_{k}.motif"] = pack.add(motif)                                          # (count, k, 4)
        t[f"motifs_{k}.centers"] = pack.add(layer.physical_centers)                       # (count, 3, C)
        t[f"motifs_{k}.widths"] = pack.add(0.5 + 3.5 * tf.sigmoid(layer.bandwidth_logits))  # (groups,)
        t[f"motifs_{k}.strength"] = pack.add(tf.reshape(tf.sigmoid(layer.strength_logit), [1]))
    dense = lambda m, name: (pack.add(m.get_layer(name).kernel), pack.add(m.get_layer(name).bias))  # noqa: E731
    t["composition.kernel"], t["composition.bias"] = dense(core, "composition_embedding")
    bn = core.get_layer("feature_normalization")
    scale = bn.gamma * tf.math.rsqrt(bn.moving_variance + bn.epsilon)
    t["bn.scale"], t["bn.shift"] = pack.add(scale), pack.add(bn.beta - bn.moving_mean * scale)
    t["joint_embedding.kernel"], t["joint_embedding.bias"] = dense(core, "joint_embedding")
    t["joint_logit.kernel"], t["joint_logit.bias"] = dense(core, "joint_logit")

    adapter = core.get_layer("physical_adapter")
    j = 0
    while f"local_group_{j}" in [la.name for la in adapter.layers]:
        t[f"local_group_{j}.kernel"], t[f"local_group_{j}.bias"] = dense(adapter, f"local_group_{j}")  # (5, g, 4)
        j += 1
    gabor = adapter.get_layer("physical_gabor")                     # the kernel lines of MotifSpectrum.call
    period, width = gabor.parameters()
    tt = tf.range(-30, 31, dtype=tf.float32)[:, None]
    envelope = tf.exp(-.5 * (tt / width[None, :]) ** 2)
    angle = 2 * np.pi * tt / period[None, :]
    kernel = tf.stack([envelope * tf.cos(angle), envelope * tf.sin(angle)], axis=-1)
    kernel -= tf.reduce_mean(kernel, axis=0, keepdims=True)
    kernel /= tf.sqrt(tf.reduce_sum(kernel ** 2, axis=[0, 2], keepdims=True) + 1e-8)
    t["gabor.kernel"] = pack.add(tf.reshape(kernel, [61, 8]))     # column = 2 * filter + (cos, sin)
    t["context_embedding.kernel"], t["context_embedding.bias"] = dense(adapter, "context_embedding")
    t["zero_output.kernel"], t["zero_output.bias"] = dense(adapter, "zero_output")
    bounded = adapter.get_layer("bounded_correction")
    t["bounded_correction.gate"] = pack.add(tf.reshape(bounded.gate, [1]))

    norm = core.get_layer("statistics_normalization")
    import keras
    t["statistics.mean"] = pack.add(tf.reshape(norm.mean, [-1]))
    t["statistics.denominator"] = pack.add(tf.maximum(tf.sqrt(tf.reshape(norm.variance, [-1])), keras.backend.epsilon()))
    t["shared_statistic_encoder.kernel"], t["shared_statistic_encoder.bias"] = dense(core, "shared_statistic_encoder")
    t["statistics_readout.kernel"], t["statistics_readout.bias"] = dense(core, "statistics_readout")
    statistics = core.get_layer("statistics_correction")
    t["statistics_correction.gate"] = pack.add(tf.reshape(statistics.gate, [1]))
    limits = dict(bounded_correction=bounded.limit, statistics_correction=statistics.limit)
    return t, limits


def prep_json(prep):
    return dict(mean=prep.mean.tolist(), std=prep.std.tolist(), explicit=prep.explicit.tolist(),
                blocks=[dict(idx=b["idx"].tolist(), rotation=b["rotation"].tolist(), score_mean=b["score_mean"].tolist(),
                             score_std=b["score_std"].tolist()) for b in prep.blocks],
                kmer_mean=np.asarray(prep.kmer_mean, np.float64).tolist(),
                kmer_std=np.asarray(prep.kmer_std, np.float64).tolist())


def export_model(predictor, did, folder):
    from morphonup import config
    cfg = config.settings()
    pack, folds = Packer(), []
    for fold, model, prep in predictor.models(did):
        tensors, limits = fold_tensors(model.core, pack)
        folds.append(dict(fold=fold, tensors=tensors, limits=limits, prep=prep_json(prep)))
    groups = predictor.models(did)[0][2].groups()
    meta = dict(format=1, dataset=did, channels=predictor.models(did)[0][2].channels, groups=groups,
                motifs=cfg["motifs"], kmer_dim=cfg["kmer_dim"], dtype="float32", folds=folds)
    (folder / "model.bin").write_bytes(pack.bytes())
    (folder / "model.json").write_text(json.dumps(meta, separators=(",", ":")))
    return pack.offset


def export_sequences(predictor, did, folder):
    rows = predictor._db().execute("SELECT idx, name, sequence, label, fold FROM sequences WHERE dataset = ? ORDER BY idx",
                                   (did,)).fetchall()
    n = len(rows)
    assert [r["idx"] for r in rows] == list(range(n)), f"{did}: indices are not 0..n-1"
    numbers = np.zeros(n, "<u4")
    meta = np.zeros(n, np.uint8)
    codes = np.zeros((n, 148), np.uint8)                       # padded to 37 * 4 bases
    lut = {b: i for i, b in enumerate("ACGT")}
    for i, r in enumerate(rows):
        m = NAME.match(r["name"])
        assert m and (m.group(1) == "nucleosomal") == (r["label"] == 1), f"{did}: unexpected name {r['name']!r}"
        assert 1 <= r["fold"] <= 15 and len(r["sequence"]) == 147
        numbers[i] = int(m.group(2))
        meta[i] = r["label"] | (r["fold"] << 1)
        codes[i, :147] = [lut[c] for c in r["sequence"]]
    q = codes.reshape(n, 37, 4)
    packed = (q[:, :, 0] | (q[:, :, 1] << 2) | (q[:, :, 2] << 4) | (q[:, :, 3] << 6)).astype(np.uint8)
    (folder / "sequences.bin").write_bytes(numbers.tobytes() + meta.tobytes() + packed.tobytes())
    return n


def main():
    t0 = time.time()
    predictor = webapp.predictor()
    OUT.mkdir(parents=True, exist_ok=True)
    groups = webapp.datasets()
    (OUT / "datasets.json").write_text(json.dumps(groups, separators=(",", ":")))
    tables = json.loads(Path(TABLES_PATH).read_text())
    (OUT / "shape_tables.json").write_text(json.dumps(tables, separators=(",", ":")))
    for did, info in predictor.datasets.items():
        folder = OUT / info["slug"]
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir()
        floats = export_model(predictor, did, folder)
        n = export_sequences(predictor, did, folder)
        print(f"{did}: {len(info['folds'])} folds, {floats:,} floats, {n:,} sequences ({time.time() - t0:.0f} s)", flush=True)
    current = {i["slug"] for i in predictor.datasets.values()}
    stale = [p.name for p in OUT.iterdir() if p.is_dir() and (p / "model.json").exists() and p.name not in current]
    for name in stale:
        shutil.rmtree(OUT / name)
    print(f"static data in {OUT}: {len(predictor.datasets)} datasets; removed stale {stale}")


if __name__ == "__main__":
    main()
