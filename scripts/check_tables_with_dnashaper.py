"""Independent check of the shape tables against DNAshapeR itself.

The tables were built from the exports the model was trained on; their DNAshapeR version was never recorded. This
script runs DNAshapeR (the R package in ../../envs/dnashape) on synthetic sequences that contain every table entry and
compares its output with the lookup, value by value:
  * one de Bruijn sequence of order 6 (4,101 bases): contains every hexamer once, so every interior step and every
    base-pair pentamer;
  * 1,024 sequences of 15 bases, pentamer i + ACGTA + pentamer 1023 - i: every pentamer at the start and at the end,
    for the "left" and "right" step tables.

Usage (from website/):  python scripts/check_tables_with_dnashaper.py
"""
import os
import subprocess
import sys
import tempfile
from itertools import product
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SITE / "backend"))
from morphonup_web.shape import TRACKS, BP_TRACKS, MISSING, encode, shape_tracks, load_tables  # noqa: E402

RSCRIPT = Path(os.environ.get("DNASHAPE_RSCRIPT", SITE.parents[1] / "envs" / "dnashape" / "bin" / "Rscript"))


def de_bruijn(k, n):
    """Lyndon-word construction of the de Bruijn sequence B(k, n), as a list of digits."""
    a, seq = [0] * k * n, []

    def db(t, p):
        if t > n:
            if n % p == 0:
                seq.extend(a[1:p + 1])
        else:
            a[t] = a[t - p]
            db(t + 1, p)
            for j in range(a[t - p] + 1, k):
                a[t] = j
                db(t + 1, t)
    db(1, 1)
    return seq


def read_variable(path):
    out = {}
    for block in path.read_text().split(">")[1:]:
        head, _, body = block.partition("\n")
        text = ",".join(x.strip().strip(",") for x in body.split("\n") if x.strip())
        vals = np.fromstring(text.replace("NA", "nan"), sep=",", dtype=np.float64)
        out[head.strip()] = np.where(np.isnan(vals), MISSING, np.round(vals * 100)).astype(np.int64)
    return out


def main():
    digits = de_bruijn(4, 6)
    db = "".join("ACGT"[d] for d in digits + digits[:5])           # linear: wrap the first 5 bases
    pents = ["".join(p) for p in product("ACGT", repeat=5)]
    records = {"debruijn": db}
    records.update({f"edge_{i}": pents[i] + "ACGTA" + pents[1023 - i] for i in range(1024)})
    work = Path(tempfile.mkdtemp(prefix="dnashaper_check_"))
    fasta = work / "check.fa"
    fasta.write_text("".join(f">{k}\n{v}\n" for k, v in records.items()))
    shape_types = "c(" + ",".join(f'"{t}"' for t in TRACKS) + ")"
    r = subprocess.run([str(RSCRIPT), "-e", f'suppressMessages(library(DNAshapeR)); '
                        f'invisible(getShape("{fasta}", shapeType={shape_types}, parse=FALSE))'],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit("DNAshapeR failed:\n" + r.stderr[-2000:])
    version = subprocess.run([str(RSCRIPT), "-e", 'cat(as.character(packageVersion("DNAshapeR")))'],
                             capture_output=True, text=True).stdout.strip()
    tables, compared = load_tables(), 0
    for track in TRACKS:
        theirs = read_variable(Path(f"{fasta}.{track}"))
        for name, seq in records.items():
            ours = shape_tracks(encode(seq, length=None), tables)[track][0]
            ours = np.where(np.isnan(ours), MISSING, np.round(ours * 100)).astype(np.int64)
            if ours.shape != theirs[name].shape or (ours != theirs[name]).any():
                j = int(np.argmax(ours != theirs[name])) if ours.shape == theirs[name].shape else -1
                sys.exit(f"FAIL {track} {name} (length {len(seq)}): first difference at {j}")
            compared += int((ours != MISSING).sum())
    print(f"PASS: DNAshapeR {version} agrees with the tables on all 14 tracks "
          f"({compared} values; every pentamer, hexamer and edge entry). Files in {work}")


if __name__ == "__main__":
    main()
