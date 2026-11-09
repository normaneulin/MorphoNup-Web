"""Parity of the browser engine (frontend/src/engine, run in Node) with the Keras models of the server.

For every dataset in frontend/public/data it takes 40 sequences of the dataset (every other one entered as its
reverse complement, so the lookup of either strand is tested) and 40 random sequences, and compares:
  the probability of each strand and their mean, the predicted class, which fold model answered, the dataset row found
  (name, label, strand, copies) and the 14 shape tracks.
The Keras side is Predictor of morphonup_web (the server code, itself checked against the morphonup package).

Run (from website/backend, envs/web-api's Python; CPU only):  python tests/check_static_parity.py
Needs Node (envs/web) and the frontend's node_modules (esbuild bundles the engine for Node).
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
SITE = BACKEND.parent
FRONTEND = SITE / "frontend"
DATA = FRONTEND / "public" / "data"
NODE_BIN = SITE.parents[1] / "envs" / "web" / "bin"
sys.path.insert(0, str(BACKEND))
from morphonup_web.predictor import Predictor, reverse_complement  # noqa: E402
from morphonup_web.shape import encode  # noqa: E402

PER_DATASET = 40
TOLERANCE = 1e-4


def cases_for(predictor, did, info, rng):
    rows = predictor._db().execute("SELECT idx, sequence FROM sequences WHERE dataset = ? ORDER BY idx", (did,)).fetchall()
    picks = rng.choice(len(rows), PER_DATASET, replace=False)
    seqs = [rows[i]["sequence"] if j % 2 == 0 else reverse_complement(rows[i]["sequence"]) for j, i in enumerate(picks)]
    seqs += ["".join(rng.choice(list("ACGT"), 147)) for _ in range(PER_DATASET)]
    return [dict(slug=info["slug"], n=info["n"], sequence=s) for s in seqs]


def expected(predictor, did, seqs):
    found = [predictor.lookup(did, s) for s in seqs]
    folds = np.array([r["fold"] if r else 0 for r in found])
    r = predictor.probabilities(did, np.stack([encode(s) for s in seqs]), folds)
    return found, folds, r


def main():
    predictor = Predictor()
    rng = np.random.default_rng(20261109)
    built = set(p.name for p in DATA.iterdir() if (p / "model.json").exists())
    cases, spans = [], []
    for did, info in predictor.datasets.items():
        assert info["slug"] in built, f"{info['slug']} is in the bundle but not in {DATA}: run scripts/export_static.py"
        c = cases_for(predictor, did, info, rng)
        spans.append((did, len(cases), len(cases) + len(c)))
        cases += c

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        env = {**os.environ, "PATH": f"{NODE_BIN}:{os.environ['PATH']}"}
        subprocess.run([str(FRONTEND / "node_modules" / ".bin" / "esbuild"), str(FRONTEND / "scripts" / "engine-cli.ts"),
                        "--bundle", "--platform=node", "--format=esm", "--log-level=warning",
                        f"--outfile={tmp / 'engine-cli.mjs'}"], check=True, env=env)
        (tmp / "cases.json").write_text(json.dumps(cases))
        out = subprocess.run([str(NODE_BIN / "node"), str(tmp / "engine-cli.mjs"), str(tmp / "cases.json"), str(DATA)],
                             check=True, capture_output=True, text=True, env=env)
    js = json.loads(out.stdout)
    print(f"engine: {len(cases)} sequences in {js['seconds']:.1f} s ({1000 * js['seconds'] / len(cases):.0f} ms each)")

    worst, flips, failures = 0.0, 0, []
    for did, a, b in spans:
        seqs = [c["sequence"] for c in cases[a:b]]
        found, folds, r = expected(predictor, did, seqs)
        diffs = []
        for i, res in enumerate(js["results"][a:b]):
            d = max(abs(res["probability_forward"] - r["p_fwd"][i]), abs(res["probability_reverse"] - r["p_rc"][i]),
                    abs(res["probability"] - r["p"][i]))
            diffs.append(d)
            if (res["probability"] >= 0.5) != (r["p"][i] >= 0.5):
                flips += 1
            row = found[i]
            want = None if row is None else dict(name=row["name"], label="nucleosomal" if row["label"] == 1 else "linker",
                                                  strand=row["strand"], copies=row["copies"])
            if res["in_dataset"] != want or (res["fold"] or 0) != folds[i]:
                failures.append(f"{did} case {i}: dataset row {res['in_dataset']} fold {res['fold']}, expected {want} fold {folds[i]}")
            for name, values in r["shape"].items():
                ours = np.array([np.nan if v is None else v for v in res["shape"][name]])
                if not np.allclose(ours, values[i], atol=1e-9, equal_nan=True):
                    failures.append(f"{did} case {i}: shape track {name} differs")
        n_in = int((folds > 0).sum())
        print(f"{did}: max |difference| {max(diffs):.2e} (dataset sequences {max(diffs[:PER_DATASET]):.2e}, "
              f"new {max(diffs[PER_DATASET:]):.2e}); {n_in} found in the dataset")
        worst = max(worst, max(diffs))
    print(f"largest difference {worst:.2e}; class changes {flips}; other failures {len(failures)}")
    for f in failures[:20]:
        print("  ", f)
    ok = worst < TOLERANCE and flips == 0 and not failures
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
