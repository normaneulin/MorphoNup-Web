"""Copy the species silhouettes (design/species/*.svg, see CREDITS.md) into the page code, and add anatomical detail.

Every file is a plain silhouette. Only the viewBox, a group transform (PhyloPic files), the path data and the fill
rule are kept; styles, metadata and any other markup are dropped, so nothing from the files runs in the page. The page
fills the shapes with the theme's text colour; with the even-odd fill rule, cut-outs (the fly's wings and eye) show the
page colour. For the roundworm and the yeast, anatomical details are computed from the silhouette's own geometry and
drawn in the page colour (like the fly's cut-outs), kept light: C. elegans gets a faint gut line and the pharynx bulb
along a centreline found from the outline; the yeast gets its cell wall, nucleus and nucleolus, vacuole, granules and
bud scars, placed from its largest inscribed circles.
Output: frontend/src/assets/species.ts.   Usage (from website/, with envs/web-api):  python scripts/import_species.py
"""
import json
import math
import re
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import polylabel, unary_union
from svgpathtools import parse_path

SITE = Path(__file__).resolve().parents[1]
FILES = {"Homo sapiens": "homo-sapiens", "Caenorhabditis elegans": "c-elegans",
         "Drosophila melanogaster": "d-melanogaster", "Saccharomyces cerevisiae": "s-cerevisiae"}
PATH_DATA = re.compile(r"[MmLlHhVvCcSsQqTtAaZzEe0-9.,\s-]+")
TRANSFORM = re.compile(r"[a-z0-9().,\s-]*")


def attr(tag, name):
    m = re.search(rf'\s{name}="([^"]*)"', tag)
    return m.group(1) if m else ""


# ---------------------------------------------------------------- geometry of a silhouette
def polygon(d, transform):
    """The filled shape of path data d, in viewBox units (applies a 'translate(a,b) scale(c,d)' transform)."""
    tx = ty = 0.0
    sx = sy = 1.0
    m = re.search(r"translate\(([-\d.]+)[ ,]+([-\d.]+)\)", transform)
    if m:
        tx, ty = float(m.group(1)), float(m.group(2))
    m = re.search(r"scale\(([-\d.]+)[ ,]+([-\d.]+)\)", transform)
    if m:
        sx, sy = float(m.group(1)), float(m.group(2))
    parts = []
    for sub in parse_path(d).continuous_subpaths():
        if len(sub) == 0 or sub.length() == 0:
            continue
        n = max(30, int(sub.length() / 8))
        pts = [(tx + sx * sub.point(i / n).real, ty + sy * sub.point(i / n).imag) for i in range(n + 1)]
        poly = Polygon(pts).buffer(0)
        if poly.area > 1:
            parts.append(poly)
    shape = unary_union(parts)
    return max(getattr(shape, "geoms", [shape]), key=lambda g: g.area)


def resample(points, n):
    pts = np.asarray(points, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    t = np.concatenate([[0], np.cumsum(seg)])
    u = np.linspace(0, t[-1], n)
    return np.column_stack([np.interp(u, t, pts[:, 0]), np.interp(u, t, pts[:, 1])])


def fmt(pts, close=False):
    return "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + ("Z" if close else "")


def ellipse(c, rx, ry, angle, n=40):
    ca, sa = math.cos(angle), math.sin(angle)
    return [(c[0] + rx * math.cos(t) * ca - ry * math.sin(t) * sa, c[1] + rx * math.cos(t) * sa + ry * math.sin(t) * ca)
            for t in np.linspace(0, 2 * math.pi, n, endpoint=False)]


def worm_details(poly):
    """A faint gut line and the pharynx bulb along the worm's centreline."""
    ring = resample(list(poly.exterior.coords), 1200)[:-1]
    n = len(ring)
    # the two tips are where the outline turns back on itself: smallest angle between the directions to the points
    # a few percent of the outline before and after (a wide window also catches the blunt head)
    kk = int(0.045 * n)
    va = ring[(np.arange(n) - kk) % n] - ring
    vb = ring[(np.arange(n) + kk) % n] - ring
    cosang = (va * vb).sum(1) / (np.hypot(*va.T) * np.hypot(*vb.T))
    sharp = cosang                                                         # near 1 = folded back (a tip)
    i1 = int(np.argmax(sharp))
    dist = np.minimum(np.abs(np.arange(n) - i1), n - np.abs(np.arange(n) - i1))
    i2 = int(np.argmax(np.where(dist > 0.3 * n, sharp, -9)))
    a, b = sorted((i1, i2))
    side1 = resample(ring[a:b + 1], 240)
    side2 = resample(np.vstack([ring[b:], ring[:a + 1]])[::-1], 240)
    centre = (side1 + side2) / 2
    width = np.hypot(*(side1 - side2).T)
    k = np.ones(9) / 9
    centre = np.column_stack([np.convolve(np.pad(centre[:, i], 4, mode="edge"), k, "valid") for i in (0, 1)])
    width = np.convolve(np.pad(width, 4, mode="edge"), k, "valid")
    if width[12:36].mean() < width[-36:-12].mean():                     # the tail tapers: put the head at t = 0
        centre, width = centre[::-1], width[::-1]
    tang = np.gradient(centre, axis=0)
    tang /= np.hypot(*tang.T)[:, None]
    norm = np.column_stack([-tang[:, 1], tang[:, 0]])
    w = float(np.median(width))
    at = lambda t: int(round(t * (len(centre) - 1)))
    out = []
    gut = [centre[at(t)] for t in np.linspace(0.015, 0.88, 120)]          # pharynx and intestine: one faint line
    out.append({"d": fmt(gut), "kind": "faint", "w": round(0.07 * w, 2)})
    i = at(0.15)                                                          # the terminal bulb of the pharynx
    out.append({"d": fmt(ellipse(centre[i], 0.36 * width[i], 0.27 * width[i], math.atan2(tang[i, 1], tang[i, 0])), True),
                "kind": "faint", "w": round(0.06 * w, 2)})
    return out


def yeast_details(poly):
    """Cell wall, nucleus with nucleolus, vacuole with granules, bud vacuole and bud scars."""
    pm = polylabel(poly, tolerance=0.5)
    rm = poly.exterior.distance(pm)
    rest = poly.difference(pm.buffer(rm * 1.04))
    bud = max(getattr(rest, "geoms", [rest]), key=lambda g: g.area)
    pb = polylabel(bud, tolerance=0.5)
    rb = bud.exterior.distance(pb)
    cm, cb = np.array(pm.coords[0]), np.array(pb.coords[0])
    u = (cb - cm) / np.hypot(*(cb - cm))
    v = np.array([-u[1], u[0]])
    out = []
    wall = poly.buffer(-0.07 * rm)
    wall = max(getattr(wall, "geoms", [wall]), key=lambda g: g.area)
    out.append({"d": fmt(list(wall.exterior.coords), True), "kind": "line", "w": round(0.025 * rm, 2)})
    nucleus = cm + u * 0.22 * rm + v * 0.2 * rm
    out.append({"d": fmt(ellipse(nucleus, 0.27 * rm, 0.25 * rm, 0.4), True), "kind": "line", "w": round(0.04 * rm, 2)})
    out.append({"d": fmt(ellipse(nucleus - u * 0.1 * rm + v * 0.08 * rm, 0.1 * rm, 0.07 * rm, 0.9), True), "kind": "fill"})
    vac = cm - u * 0.22 * rm - v * 0.24 * rm
    out.append({"d": fmt(ellipse(vac, 0.34 * rm, 0.31 * rm, -0.3), True), "kind": "line", "w": round(0.035 * rm, 2)})
    for dx, dy, r in ((0.08, -0.05, 0.035), (-0.1, 0.09, 0.028), (0.02, 0.14, 0.024)):
        out.append({"d": fmt(ellipse(vac + u * dx * rm + v * dy * rm, r * rm, r * rm, 0), True), "kind": "fill"})
    out.append({"d": fmt(ellipse(cb - u * 0.05 * rb, 0.4 * rb, 0.36 * rb, 0.2), True), "kind": "line", "w": round(0.03 * rm, 2)})
    base = math.atan2(u[1], u[0])
    for ang in (2.5, 3.05, 3.6):                                           # bud scars, away from the bud
        p = cm + np.array([math.cos(base + ang), math.sin(base + ang)]) * 0.8 * rm
        out.append({"d": fmt(ellipse(p, 0.065 * rm, 0.05 * rm, base + ang), True), "kind": "line", "w": round(0.022 * rm, 2)})
    rnd = np.random.default_rng(5)
    placed = 0
    while placed < 16:                                                     # cytoplasm granules
        p = cm + (rnd.random(2) - 0.5) * 1.5 * rm
        if not wall.contains(Point(p)) or np.hypot(*(p - nucleus)) < 0.34 * rm or np.hypot(*(p - vac)) < 0.42 * rm:
            continue
        out.append({"d": fmt(ellipse(p, 0.018 * rm, 0.018 * rm, 0, 12), True), "kind": "fill"})
        placed += 1
    return out


def main():
    out = {}
    for species, name in FILES.items():
        s = (SITE / "design" / "species" / f"{name}.svg").read_text()
        s = re.sub(r"<defs.*?</defs>|<style.*?</style>|<metadata.*?</metadata>", "", s, flags=re.S)
        svg_tag = re.search(r"<svg[^>]*>", s, re.S).group(0)
        view_box = attr(svg_tag, "viewBox") or f"0 0 {attr(svg_tag, 'width')} {attr(svg_tag, 'height')}"
        group = re.search(r"<g[^>]*\stransform=\"([^\"]+)\"", s, re.S)
        transform = group.group(1) if group else ""
        paths = []
        for tag in re.findall(r"<path\b[^>]*>", s, re.S):
            d = " ".join(attr(tag, "d").split())
            rule = attr(tag, "fill-rule")
            assert d and PATH_DATA.fullmatch(d) and rule in ("", "evenodd", "nonzero"), name
            paths.append({"d": d, "rule": rule} if rule else {"d": d})
        assert re.fullmatch(r"[0-9.\s-]+", view_box) and TRANSFORM.fullmatch(transform), name
        details = []
        if name in ("c-elegans", "s-cerevisiae"):
            shape = polygon(paths[0]["d"], transform)
            details = worm_details(shape) if name == "c-elegans" else yeast_details(shape)
        out[species] = dict(viewBox=view_box, transform=transform, paths=paths, details=details)
    lines = ["// Generated by scripts/import_species.py from design/species/*.svg (sources: design/species/CREDITS.md).",
             "export const SPECIES_SILHOUETTE: Record<string, { viewBox: string; transform: string; paths: { d: string; rule?: string }[]; "
             "details: { d: string; kind: string; w?: number }[] }> = "
             + json.dumps(out, indent=1) + ";", ""]
    target = SITE / "frontend" / "src" / "assets" / "species.ts"
    target.write_text("\n".join(lines))
    print(f"wrote {target.relative_to(SITE)} ({target.stat().st_size // 1024} KB)", {k: (len(v["paths"]), len(v["details"])) for k, v in out.items()})


if __name__ == "__main__":
    main()
