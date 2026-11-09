"""Build the DNA shape lookup tables of the web application from the DNAshapeR exports of the 12 datasets.

For every track it collects (window, value) pairs from every valid 147-bp A/C/G/T sequence of every dataset:
pentamer -> value for the 8 base-pair tracks; hexamer -> value for the interior steps of the 6 step tracks, and
pentamer -> value for their second step ("left") and second-to-last step ("right"). It then checks that
  * every value has at most two decimals (the precision of the exports), so integers in hundredths are exact;
  * no window ever has two different values, within or across datasets (else the exports come from different
    DNAshapeR versions and the site could not reproduce all of them);
  * how many of the 1,024 pentamers and 4,096 hexamers occur (missing entries are reported, never invented).

Usage (from website/):   python scripts/build_shape_tables.py
Reads:   ../../data/<DatasetNup_*>/.../{sequence/*.fas, shape/*.fas.<Track>}   (or $MORPHONUP_DATA)
Writes:  backend/morphonup_web/data/shape_tables.json  and  backend/morphonup_web/data/shape_tables_report.json
"""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SITE / "backend"))
from morphonup_web.shape import BP_TRACKS, STEP_TRACKS, MISSING, window_codes  # noqa: E402

DATA = Path(os.environ["MORPHONUP_DATA"]) if os.environ.get("MORPHONUP_DATA") else SITE.parents[1] / "data"
OUT = SITE / "backend" / "morphonup_web" / "data"
SIZES = {"pentamer": 1024, "hexamer": 4096, "left": 1024, "right": 1024}


def datasets():
    """Every folder under DATA that has sequence/ and shape/ (the 12 benchmark datasets)."""
    found = sorted(p.parent for p in DATA.rglob("sequence") if p.is_dir() and (p.parent / "shape").is_dir())
    return [f for f in found if list((f / "sequence").glob("*.fas"))]


def read_fasta(path):
    names, seqs = [], []
    for block in path.read_text().split(">")[1:]:
        head, _, body = block.partition("\n")
        names.append(head.strip())
        seqs.append("".join(body.split()).upper())
    return names, seqs


def read_track(path, width):
    """Return names and an (n, width) array in hundredths (MISSING for NA) of one DNAshapeR export file."""
    names, rows = [], []
    for block in path.read_text().split(">")[1:]:
        head, _, body = block.partition("\n")
        names.append(head.strip())
        rows.append(",".join(x.strip().strip(",") for x in body.split("\n") if x.strip()))
    flat = np.fromstring(",".join(rows).replace("NA", "nan"), sep=",", dtype=np.float64)
    assert flat.size == len(names) * width, (path.name, flat.size, len(names), width)
    arr = flat.reshape(len(names), width)
    finite = np.isfinite(arr)
    hundredths = np.round(arr[finite] * 100)
    assert np.abs(arr[finite] * 100 - hundredths).max() < 1e-6, f"{path.name}: more than two decimals"
    out = np.full(arr.shape, MISSING, dtype=np.int64)
    out[finite] = hundredths.astype(np.int64)
    return names, out


def pairs(codes, values):
    """Unique (code, value) pairs packed in one int64."""
    return np.unique(codes.ravel() * 65536 + (values.ravel() + 32768))


def main():
    t0 = time.time()
    folders = datasets()
    assert len(folders) == 12, [str(f) for f in folders]
    collected = {(t, k): np.zeros(0, dtype=np.int64) for t in BP_TRACKS for k in ["pentamer"]}
    collected.update({(t, k): np.zeros(0, dtype=np.int64) for t in STEP_TRACKS for k in ["hexamer", "left", "right"]})
    per_dataset, report = {}, {"datasets": []}
    for folder in folders:
        fasta = next((folder / "sequence").glob("*.fas"))
        names, seqs = read_fasta(fasta)
        keep = np.array([len(s) == 147 and set(s) <= set("ACGT") for s in seqs])
        enc = np.array([["ACGT".index(c) for c in s] for s, k in zip(seqs, keep) if k], dtype=np.int64)
        p5, p6 = window_codes(enc, 5), window_codes(enc, 6)
        did = str(folder.relative_to(DATA))
        report["datasets"].append(dict(id=did, sequences=int(keep.sum()), excluded=int((~keep).sum()),
                                       fasta_sha256=hashlib.sha256(fasta.read_bytes()).hexdigest()))
        for track in BP_TRACKS + STEP_TRACKS:
            width = 147 if track in BP_TRACKS else 146
            tnames, vals = read_track(folder / "shape" / f"{fasta.name}.{track}", width)
            assert tnames == names, f"{did} {track}: names differ from the FASTA"
            vals = vals[keep]
            if track in BP_TRACKS:
                assert (vals[:, [0, 1, 145, 146]] == MISSING).all() and (vals[:, 2:145] != MISSING).all(), (did, track)
                parts = {"pentamer": (p5, vals[:, 2:145])}
            else:
                assert (vals[:, [0, 145]] == MISSING).all() and (vals[:, 1:145] != MISSING).all(), (did, track)
                parts = {"hexamer": (p6, vals[:, 2:144]), "left": (p5[:, 0], vals[:, 1]),
                         "right": (p5[:, -1], vals[:, 144])}
            for key, (codes, v) in parts.items():
                u = pairs(codes, v)
                per_dataset[(did, track, key)] = u
                collected[(track, key)] = np.union1d(collected[(track, key)], u)
        print(f"{did}: {keep.sum()} sequences ({time.time() - t0:.0f} s)", flush=True)

    tables, conflicts, coverage = {}, {}, {}
    for (track, key), u in collected.items():
        codes, vals = u // 65536, u % 65536 - 32768
        uniq, counts = np.unique(codes, return_counts=True)
        bad = uniq[counts > 1]
        if bad.size:
            where = {}
            for (did, t, k), du in per_dataset.items():
                if t == track and k == key:
                    dc = du // 65536
                    where[did] = int(np.isin(dc, bad).sum())
            conflicts[f"{track}.{key}"] = dict(windows=int(bad.size), datasets_with_those_windows=where)
        table = np.full(SIZES[key], MISSING, dtype=np.int64)
        table[codes] = vals            # with a conflict the last value wins; the conflict is reported and fails below
        tables.setdefault(track, {})[key] = table.tolist()
        coverage[f"{track}.{key}"] = f"{int((table != MISSING).sum())}/{SIZES[key]}"

    report.update(coverage=coverage, conflicts=conflicts, seconds=round(time.time() - t0, 1))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "shape_tables_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({"coverage": coverage, "conflicts": conflicts}, indent=1))
    if conflicts:
        sys.exit("CONFLICTS: the exports disagree on some windows; tables not written.")
    meta = dict(format=1, scale=100, missing=MISSING,
                source="DNAshapeR exports of the 12 MorphoNup benchmark datasets (valid 147-bp A/C/G/T sequences)",
                built=time.strftime("%Y-%m-%d"), datasets=report["datasets"])
    (OUT / "shape_tables.json").write_text(json.dumps(dict(meta, tracks=tables), separators=(",", ":")))
    print(f"wrote {OUT / 'shape_tables.json'} ({(OUT / 'shape_tables.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
