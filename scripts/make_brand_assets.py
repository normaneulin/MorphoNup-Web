"""Draw the MorphoNup logo and icons and build design/brand-board.html.

The logo is a nucleosome seen from above:
  * the histone core is the author's drawing in design/logo/histone-core.svg: four pieces (the four histone pairs
    visible from above) separated by a gap in the shape of an M. Its paths are used as drawn, only centred and scaled;
  * around it, 147 bp of DNA wrapped 1.65 turns. The ribbon is as wide as the minor groove of a real nucleosomal
    sequence of the DatasetNup_1 H. sapiens benchmark (nucleosomal_sequence_1, DNAshapeR MGW), so its thick and thin
    parts are real DNA shape data. The light dot marks the dyad, the centre of the 147 bp.
Colours follow the H&E stain: eosin (which stains proteins) for the histones, haematoxylin (which stains DNA) for the
DNA. The example result card on the board uses the saved out-of-fold prediction of the same sequence.

Usage (from website/):  python scripts/make_brand_assets.py
Reads:   design/logo/histone-core.svg, ../../data/DatasetNup_1/Homo_sapiens/{sequence,shape}/, ../results/...
Writes:  design/logo/logo.svg, logo-dark.svg, design/icons/*.svg, design/brand-board.html,
         frontend/public/favicon.svg and frontend/src/assets/{logo,logo-dark}.svg when frontend/ exists
"""
import csv
import html
import json
import math
import os
import re
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
WORKSPACE = SITE.parent
DATA = Path(os.environ["MORPHONUP_DATA"]) if os.environ.get("MORPHONUP_DATA") else WORKSPACE.parent / "data"
DATASET = DATA / "DatasetNup_1" / "Homo_sapiens"
RESULTS = WORKSPACE / "results" / "DatasetNup_1" / "Homo_sapiens" / "k5" / "full" / "seed_151000"
CORE_SOURCE = SITE / "design" / "logo" / "histone-core.svg"

INK = "#241C47"        # haematoxylin, deep: text, the DNA ribbon
HAEM = "#4B3D8F"       # haematoxylin: buttons, links
EOSIN = "#D9577F"      # eosin: the histone core
SLIDE = "#FAF8FC"      # glass slide: page
NIGHT = "#17122E"      # dark theme page
NIGHT_INK = "#EEEAF9"  # dark theme DNA
EOSIN_NIGHT = "#E27596"

CORE_RADIUS = 53.0     # histone core radius in the 200 x 200 logo
RIBBON = dict(turns=1.65, r0=63.0, r1=87.0, w_min=3.6, w_span=8.0, sigma=1.6)


# ------------------------------------------------------------------ data
def first_record(path, sep=""):
    """Return the name and the body of the first FASTA-like record in a file, lines joined by sep."""
    name, lines = None, []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith(">"):
                if name is not None:
                    break
                name = line[1:]
            elif line:
                lines.append(line)
    return name, sep.join(lines)


def load_example():
    name, seq = first_record(DATASET / "sequence" / "nucleosomes_vs_linkers_sapiens.fas")
    shape_name, mgw_text = first_record(DATASET / "shape" / "nucleosomes_vs_linkers_sapiens.fas.MGW", sep=",")
    assert name == shape_name and len(seq) == 147, (name, shape_name, len(seq))
    mgw = [None if v == "NA" else float(v) for v in mgw_text.split(",")]
    assert len(mgw) == 147
    prob = None
    for fold in sorted(RESULTS.glob("fold_*/refit/test_predictions.csv")):
        for row in csv.DictReader(open(fold)):
            if row["index"] == "0":
                prob = {k: float(row[k]) for k in ("probability_fwd", "probability_rc", "probability")}
                prob["fold"], prob["label"] = int(row["fold"]), int(row["label"])
    return name, seq, mgw, prob


def smoothed(values, sigma):
    """Gaussian smoothing over the known values (sigma in bp); keeps the ~10-bp groove wave, drops jitter."""
    out = []
    for i, v in enumerate(values):
        if v is None:
            out.append(None)
            continue
        num = den = 0.0
        for j, u in enumerate(values):
            if u is not None and abs(i - j) <= 4 * sigma:
                w = math.exp(-0.5 * ((i - j) / sigma) ** 2)
                num, den = num + w * u, den + w
        out.append(num / den)
    return out


def normalized(values):
    known = [v for v in values if v is not None]
    lo, hi = min(known), max(known)
    return [None if v is None else (v - lo) / (hi - lo) for v in values]


def interpolate(values, t):
    """Linear interpolation of a list with missing ends (None) at t in [0, 1]; ends take the nearest value."""
    known = [i for i, v in enumerate(values) if v is not None]
    x = min(max(t * (len(values) - 1), known[0]), known[-1])
    i = min(int(x), known[-1] - 1)
    f = x - i
    return values[i] * (1 - f) + values[i + 1] * f


# ------------------------------------------------------------------ logo
def core_paths():
    """The author's histone core paths, centred on (100, 100) and scaled to CORE_RADIUS."""
    raw = re.findall(r'<path d="([^"]+)"', CORE_SOURCE.read_text())
    assert len(raw) == 4, len(raw)
    shapes = [[tuple(map(float, p.split(","))) for p in re.findall(r"-?\d+\.?\d*,-?\d+\.?\d*", d)] for d in raw]
    xs = [x for s in shapes for x, _ in s]
    ys = [y for s in shapes for _, y in s]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    radius = max(math.hypot(x - cx, y - cy) for s in shapes for x, y in s)
    k = CORE_RADIUS / radius
    return ["M" + " L".join(f"{100 + (x - cx) * k:.2f},{100 + (y - cy) * k:.2f}" for x, y in s) + "Z" for s in shapes]


def ribbon_path(curve, width, n=900):
    """Closed path of a ribbon that follows curve(t) with half-width width(t) / 2, t in [0, 1]."""
    left, right = [], []
    for k in range(n + 1):
        t = k / n
        x, y = curve(t)
        x1, y1 = curve(max(t - 1e-4, 0.0))
        x2, y2 = curve(min(t + 1e-4, 1.0))
        dx, dy = x2 - x1, y2 - y1
        d = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / d, dx / d
        h = width(t) / 2
        left.append((x + nx * h, y + ny * h))
        right.append((x - nx * h, y - ny * h))
    pts = left + right[::-1]
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def logo_svg(mgw_n, core=EOSIN, ink=INK, dot=SLIDE, title="MorphoNup"):
    p = RIBBON

    def curve(t):
        a = -math.pi / 2 + (t - 0.5) * p["turns"] * 2 * math.pi
        r = p["r0"] + (p["r1"] - p["r0"]) * t
        return 100 + r * math.cos(a), 100 + r * math.sin(a)

    def width(t):
        return p["w_min"] + p["w_span"] * interpolate(mgw_n, t)

    (x0, y0), (x1, y1), (dx, dy) = curve(0), curve(1), curve(0.5)
    body = "".join(f'<path d="{d}" fill="{core}"/>' for d in core_paths())
    body += (f'<path d="{ribbon_path(curve, width)}" fill="{ink}"/>'
             f'<circle cx="{x0:.2f}" cy="{y0:.2f}" r="{width(0) / 2:.2f}" fill="{ink}"/>'
             f'<circle cx="{x1:.2f}" cy="{y1:.2f}" r="{width(1) / 2:.2f}" fill="{ink}"/>'
             f'<circle cx="{dx:.2f}" cy="{dy:.2f}" r="{max(width(0.5) / 2 - 1.6, 1.6):.2f}" fill="{dot}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" '
            f'aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>{body}</svg>')


# ------------------------------------------------------------------ icons (24 x 24, 1.75 stroke)
ICON_ATTR = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'


def chrom(x, top, cen, bottom, w=2.6):
    h = w / 2
    return (f'<rect x="{x - h:.2f}" y="{top}" width="{w}" height="{cen - top - 0.7:.2f}" rx="{h:.2f}"/>'
            f'<rect x="{x - h:.2f}" y="{cen + 0.7:.2f}" width="{w}" height="{bottom - cen - 0.7:.2f}" rx="{h:.2f}"/>')


KARYOTYPE = (chrom(4.5, 3, 7, 11.5) + chrom(9.5, 3.5, 6.5, 11.5) + chrom(14.5, 4.5, 7, 11.5) + chrom(19.5, 5.5, 7.5, 11.5)
             + chrom(4.5, 13.5, 16, 21) + chrom(9.5, 14, 16.5, 21) + chrom(14.5, 15, 17, 21) + chrom(19.5, 16, 17.5, 21))
ICONS = {
    # species
    "homo-sapiens": '<circle cx="12" cy="6.5" r="3.2"/><path d="M5.5 21v-2.2a6.5 6.5 0 0 1 13 0V21"/>',
    "c-elegans": '<path d="M2.8 14.2c2-4.2 4.6-4.2 6.6 0s4.6 4.2 6.6 0c1-2.1 2.2-3.1 3.6-3.1" stroke-width="2.6"/>'
                 '<circle cx="20.6" cy="11.1" r="0.6" fill="currentColor"/>',
    "d-melanogaster": '<ellipse cx="12" cy="14" rx="2.4" ry="5.2"/><circle cx="12" cy="6.6" r="2"/>'
                      '<path d="M10.2 11.2C6.4 9.6 3.6 11 3.4 13.6c2.6 1 5.4.2 6.8-1.4"/>'
                      '<path d="M13.8 11.2c3.8-1.6 6.6-.2 6.8 2.4-2.6 1-5.4.2-6.8-1.4"/>'
                      '<path d="M10.6 5.2 9 3.4M13.4 5.2 15 3.4"/>',
    "s-cerevisiae": '<circle cx="10" cy="13.6" r="6.6"/><circle cx="17.7" cy="7.2" r="3.2"/>'
                    '<path d="M8 12.2c.6-.9 1.6-1.3 2.6-1.1"/>',
    # dataset types
    "balanced-benchmark": '<path d="M12 4v15.5M7.5 19.5h9M4.5 7.5h15"/><path d="M4.5 7.5 2.4 13h4.2zM19.5 7.5 17.4 13h4.2z"/>'
                          '<path d="M2.4 13a2.1 2.1 0 0 0 4.2 0M17.4 13a2.1 2.1 0 0 0 4.2 0"/>',
    "genome-wide": KARYOTYPE,
    "largest-chromosome": chrom(9, 2.5, 9, 21.5, 4.2) + '<path d="M16 2.5h2.5v19H16M18.5 12h2.2"/>',
    "promoter": '<path d="M2.5 17.5h19"/><path d="M8 17.5v-7h8.5"/><path d="M14 8l2.5 2.5L14 13"/>',
    "five-prime-utr": '<circle cx="4.2" cy="12" r="1.8"/><path d="M6 12h2"/><path d="M8 12h6" stroke-width="3.6"/>'
                      '<rect x="14.5" y="9.5" width="7" height="5" rx="1"/>',
    "whole-genome": KARYOTYPE,
}


def icon_svg(name, size=24):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="{size}" height="{size}" {ICON_ATTR} '
            f'aria-hidden="true">{ICONS[name]}</svg>')


# ------------------------------------------------------------------ board
BASE_COLOURS = {"A": "#1E8A57", "C": "#2462B3", "G": "#B07800", "T": "#C2362C"}


def sequence_grid(seq):
    """The 147 bases as 7 rows of 21 (21 bp is about two helical turns); the dyad base 74 is marked."""
    rows = []
    for r in range(7):
        cells = []
        for c in range(21):
            i = r * 21 + c
            cls = ' class="dyad"' if i == 73 else ""
            cells.append(f'<span{cls} style="color:{BASE_COLOURS[seq[i]]}" title="position {i + 1}">{seq[i]}</span>')
        rows.append(f'<div class="seqrow"><span class="pos">{r * 21 + 1}</span>{"".join(cells)}</div>')
    return "".join(rows)


def main():
    name, seq, mgw, prob = load_example()
    mgw_n = normalized(smoothed(mgw, RIBBON["sigma"]))
    light = logo_svg(mgw_n)
    dark = logo_svg(mgw_n, core=EOSIN_NIGHT, ink=NIGHT_INK, dot=NIGHT)
    (SITE / "design" / "logo" / "logo.svg").write_text(light)
    (SITE / "design" / "logo" / "logo-dark.svg").write_text(dark)
    (SITE / "design" / "icons").mkdir(parents=True, exist_ok=True)
    for k in ICONS:
        (SITE / "design" / "icons" / f"{k}.svg").write_text(icon_svg(k))
    frontend = SITE / "frontend"
    if frontend.is_dir():
        (frontend / "public").mkdir(exist_ok=True)
        (frontend / "src" / "assets").mkdir(parents=True, exist_ok=True)
        (frontend / "public" / "favicon.svg").write_text(light)
        (frontend / "src" / "assets" / "logo.svg").write_text(light)
        (frontend / "src" / "assets" / "logo-dark.svg").write_text(dark)
        icons_ts = ["// Generated by scripts/make_brand_assets.py: inner SVG of each 24 x 24 line icon.",
                    "export const ICONS: Record<string, string> = {"]
        icons_ts += [f"  {json.dumps(k)}: {json.dumps(v)}," for k, v in ICONS.items()]
        icons_ts.append("};")
        (frontend / "src" / "assets" / "icons.ts").write_text("\n".join(icons_ts) + "\n")
        histone_ts = ["// Generated by scripts/make_brand_assets.py: the author's histone core (design/logo/histone-core.svg),",
                      f"// centred on (100, 100) with radius {CORE_RADIUS:g}, for drawing nucleosomes in the page.",
                      f"export const HISTONE_RADIUS = {CORE_RADIUS:g};",
                      "export const HISTONE_PATHS: string[] = ["]
        histone_ts += [f"  {json.dumps(d)}," for d in core_paths()]
        histone_ts.append("];")
        (frontend / "src" / "assets" / "histone.ts").write_text("\n".join(histone_ts) + "\n")

    template = (SITE / "design" / "brand-board.template.html").read_text()
    fills = {
        "LOGO": light, "LOGO_DARK": dark,
        "SEQ_GRID": sequence_grid(seq), "SEQ_NAME": html.escape(name),
        "P": f'{prob["probability"]:.2f}', "P_FWD": f'{prob["probability_fwd"]:.2f}',
        "P_RC": f'{prob["probability_rc"]:.2f}', "P_PCT": f'{prob["probability"] * 100:.1f}',
        "FOLD": str(prob["fold"]),
        "VERDICT": "Nucleosomal" if prob["probability"] >= 0.5 else "Linker",
        "TRUTH": "nucleosomal" if prob["label"] == 1 else "linker",
    }
    for k in ICONS:
        fills["ICON_" + k.upper().replace("-", "_")] = icon_svg(k, 28)
    for k, v in fills.items():
        template = template.replace("{{" + k + "}}", v)
    assert "{{" not in template, template[template.index("{{"):template.index("{{") + 40]
    (SITE / "design" / "brand-board.html").write_text(template)
    print("wrote design/logo/logo.svg, logo-dark.svg,", len(ICONS), "icons and design/brand-board.html")


if __name__ == "__main__":
    main()
