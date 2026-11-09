"""Golden test of the shape engine: the lookup must give exactly the DNAshapeR export of every sequence.

For every valid 147-bp A/C/G/T sequence of the 12 datasets and all 14 tracks, morphonup_web.shape.shape_tracks must
return the exported value (to the hundredth, the precision of the exports) and NaN exactly where the export has NA.
Pass or fail; no tolerance.

Usage (from website/):   python backend/tests/check_shape_golden.py
Needs the MorphoNup data folder (../../data or $MORPHONUP_DATA); skipped with a message when it is absent.
"""
import sys
import time
from pathlib import Path

import numpy as np

SITE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SITE / "backend"))
sys.path.insert(0, str(SITE / "scripts"))
from morphonup_web.shape import BP_TRACKS, STEP_TRACKS, MISSING, shape_tracks, load_tables  # noqa: E402
import build_shape_tables as B  # noqa: E402  (same export readers as the table builder)


def main():
    if not B.DATA.is_dir():
        print(f"SKIP: no data folder at {B.DATA}")
        return
    t0, tables, total = time.time(), load_tables(), 0
    for folder in B.datasets():
        fasta = next((folder / "sequence").glob("*.fas"))
        names, seqs = B.read_fasta(fasta)
        keep = np.array([len(s) == 147 and set(s) <= set("ACGT") for s in seqs])
        enc = np.array([["ACGT".index(c) for c in s] for s, k in zip(seqs, keep) if k], dtype=np.int64)
        for track in BP_TRACKS + STEP_TRACKS:
            width = 147 if track in BP_TRACKS else 146
            _, expected = B.read_track(folder / "shape" / f"{fasta.name}.{track}", width)
            expected = expected[keep]
            for start in range(0, len(enc), 20000):
                got = shape_tracks(enc[start:start + 20000], tables)[track]
                got_h = np.where(np.isnan(got), MISSING, np.round(got * 100)).astype(np.int64)
                bad = np.argwhere(got_h != expected[start:start + 20000])
                if bad.size:
                    i, j = bad[0]
                    sys.exit(f"FAIL {folder.relative_to(B.DATA)} {track}: sequence {start + i}, position {j}: "
                             f"{got_h[i, j]} vs export {expected[start + i, j]} ({len(bad)} mismatches in chunk)")
        total += len(enc)
        print(f"ok  {folder.relative_to(B.DATA)}: {len(enc)} sequences x 14 tracks ({time.time() - t0:.0f} s)",
              flush=True)
    print(f"PASS: {total} sequences, 14 tracks each, identical to the DNAshapeR exports")


if __name__ == "__main__":
    main()
