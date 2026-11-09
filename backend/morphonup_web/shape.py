"""DNA shape of a sequence by table lookup, reproducing the DNAshapeR exports that MorphoNup was trained on.

DNAshapeR does not simulate each new sequence. Its values come from query tables of short windows:

* base-pair tracks (MGW, ProT, EP, Buckle, Opening, Shear, Stagger, Stretch): the value at base i is fixed by the
  5-base window i-2 .. i+2 (a pentamer). The first and last two bases have no value.
* base-step tracks (HelT, Rise, Roll, Shift, Slide, Tilt): the step j joins bases j and j+1. Inside the sequence its
  value is fixed by the 6-base window j-2 .. j+3 (a hexamer). The second step and the second-to-last step only have
  one 5-base window (bases 0..4 and L-5..L-1) and use their own tables. The first and last steps have no value.

The tables (website/backend/morphonup_web/data/shape_tables.json) are built by scripts/build_shape_tables.py from the
DNAshapeR exports of the 12 benchmark datasets and stored as integers in hundredths, the precision of the exports, so
the lookup reproduces the exports exactly. Output layout is the one of the export files: a base-pair track has L
values and a step track L - 1 values, with NaN where DNAshapeR writes NA.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

BP_TRACKS = ["Buckle", "EP", "MGW", "Opening", "ProT", "Shear", "Stagger", "Stretch"]
STEP_TRACKS = ["HelT", "Rise", "Roll", "Shift", "Slide", "Tilt"]
TRACKS = BP_TRACKS + STEP_TRACKS
BASES = "ACGT"
TABLES_PATH = Path(__file__).resolve().parent / "data" / "shape_tables.json"
MISSING = -32768  # marks a table entry that the exports never contained


class SequenceError(ValueError):
    """A sequence that cannot be used, with a message for the person who entered it."""


def clean(text: str) -> str:
    """Remove a FASTA header, white space and digits; upper-case the rest."""
    lines = [ln for ln in text.strip().splitlines() if not ln.lstrip().startswith(">")]
    return "".join(ch for ch in "".join(lines) if not ch.isspace() and not ch.isdigit()).upper()


def encode(seq: str, length: int | None = 147) -> np.ndarray:
    """A/C/G/T to 0..3. Raises SequenceError with a plain message for a wrong length or letter."""
    if length is not None and len(seq) != length:
        raise SequenceError(f"This sequence has {len(seq)} bases. MorphoNup needs exactly {length}.")
    for i, ch in enumerate(seq):
        if ch not in BASES:
            raise SequenceError(f'Position {i + 1} is "{ch}". Use only A, C, G and T.')
    if len(seq) < 6:
        raise SequenceError("A sequence needs at least 6 bases for its DNA shape.")
    return _LUT[np.frombuffer(seq.encode("ascii"), dtype=np.uint8)]


_LUT = np.full(256, -1, dtype=np.int64)
for _i, _b in enumerate(BASES):
    _LUT[ord(_b)] = _i


def window_codes(enc: np.ndarray, k: int) -> np.ndarray:
    """Codes of all k-base windows: enc (n, L) -> (n, L - k + 1); the first base is the most significant digit."""
    enc = np.atleast_2d(enc)
    width = enc.shape[1] - k + 1
    out = np.zeros((enc.shape[0], width), dtype=np.int64)
    for offset in range(k):
        out = 4 * out + enc[:, offset:offset + width]
    return out


@lru_cache(maxsize=1)
def load_tables(path: str | None = None) -> dict:
    data = json.loads(Path(path or TABLES_PATH).read_text())
    tables = {}
    for name in BP_TRACKS:
        tables[name] = {"pentamer": np.asarray(data["tracks"][name]["pentamer"], dtype=np.int32)}
    for name in STEP_TRACKS:
        t = data["tracks"][name]
        tables[name] = {key: np.asarray(t[key], dtype=np.int32) for key in ("hexamer", "left", "right")}
    tables["_meta"] = {k: v for k, v in data.items() if k != "tracks"}
    return tables


def _values(table: np.ndarray, codes: np.ndarray, name: str) -> np.ndarray:
    hundredths = table[codes]
    if (hundredths == MISSING).any():
        raise LookupError(f"{name}: a window of this sequence is missing from the shape tables")
    return hundredths.astype(np.float64) / 100.0


def shape_tracks(enc: np.ndarray, tables: dict | None = None) -> dict[str, np.ndarray]:
    """The 14 DNAshapeR tracks of one sequence (L,) or a batch (n, L), in the layout of the export files."""
    tables = tables or load_tables()
    enc = np.atleast_2d(np.asarray(enc, dtype=np.int64))
    n, length = enc.shape
    p5, p6 = window_codes(enc, 5), window_codes(enc, 6)
    out = {}
    for name in BP_TRACKS:
        arr = np.full((n, length), np.nan)
        arr[:, 2:length - 2] = _values(tables[name]["pentamer"], p5, name)
        out[name] = arr
    for name in STEP_TRACKS:
        arr = np.full((n, length - 1), np.nan)
        arr[:, 1] = _values(tables[name]["left"], p5[:, 0], name)
        arr[:, length - 3] = _values(tables[name]["right"], p5[:, -1], name)
        arr[:, 2:length - 3] = _values(tables[name]["hexamer"], p6[:, :length - 5], name)
        out[name] = arr
    return out
