import { useMemo } from "react";
import { HISTONE_PATHS, HISTONE_RADIUS } from "../assets/histone";
import logo from "../assets/logo.svg";
import logoDark from "../assets/logo-dark.svg";
import { nucleosomeGeometry, ribbon, type Pt } from "./ChromatinScanner";

// From a cell to one nucleosome, drawn for this site: an H&E-stained cell (pink cytoplasm, violet nucleus), the
// nucleus with its chromosomes, one chromosome made of packed chromatin fibre that unwinds into loose fibre,
// nucleosomes on linker DNA, and one nucleosome seen from above (the MorphoNup logo). Two dashed lines show each zoom.
// Colours are theme variables; randomness is seeded, so the drawing is the same on every load.

const W = 1600;
const H = 460;
const CAPTION_Y = 432;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function smooth(pts: Pt[], closed = false): string {
  const n = pts.length;
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} `
      + `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? d + "Z" : d;
}

// ---------------------------------------------------------------- a metaphase chromosome
// Two sister chromatids side by side, joined at a narrow centromere (y = 0), short arm p above and long arm q below,
// rounded ends, the chromatids splaying apart slightly towards the ends. Local units; y grows downwards.
type ChromoShape = { p: number; q: number; wArm: number; wCen: number; gap: number; splay: number };

function halfWidth(s: ChromoShape, y: number): number {
  const L = y < 0 ? s.p : s.q;
  const u = Math.min(1, Math.abs(y) / (0.32 * L));             // narrow at the centromere, full width along the arm
  const base = s.wCen + (s.wArm - s.wCen) * (u * u * (3 - 2 * u)) - 0.08 * s.wArm * Math.abs(y) / L;
  const d = L - Math.abs(y);                                     // rounded end: a semicircle of radius base
  return d >= base ? base : Math.sqrt(Math.max(0, base * base - (base - d) ** 2));
}
const centreX = (s: ChromoShape, k: -1 | 1, y: number) => k * (s.gap / 2 + s.splay * Math.abs(y));

function chromatidOutline(s: ChromoShape, k: -1 | 1): string {
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= 90; i++) {
    const y = -s.p + ((s.p + s.q) * i) / 90;
    const hw = halfWidth(s, y), cx = centreX(s, k, y);
    left.push([cx - hw, y]);
    right.push([cx + hw, y]);
  }
  return smooth([...left, ...right.reverse()], true);
}

// chromatin fibre packed inside one chromatid: a small looping coil that sweeps from side to side across the chromatid
// while it moves along it, so the fibre fills the whole chromatid evenly (two passes, offset, for density). The pass that
// ends at the bottom finishes at the long arm's tip, where the loose fibre continues.
function packedFibre(s: ChromoShape, k: -1 | 1, phase: number): Pt[] {
  const L = s.p + s.q;
  const pts: Pt[] = [];
  for (const [pass, flip] of [[0, 1], [1, -1]] as const) {
    const n = Math.round(L * 9);
    for (let i = 0; i <= n; i++) {
      const t = pass === 0 ? 1 - i / n : i / n;                   // first pass bottom to top, second top to bottom
      const yAxis = -s.p + 3 + (L - 6) * t;
      const hw = Math.max(1, halfWidth(s, yAxis) - 3.2);
      const sweep = Math.sin(2 * Math.PI * (t * L / 6.5) + phase + pass * 1.7) * flip;
      const th = 2 * Math.PI * t * (L / 2.3) + phase;
      pts.push([centreX(s, k, yAxis) + hw * sweep + 2.4 * Math.cos(th), yAxis + 2.4 * Math.sin(th)]);
    }
  }
  return pts;
}

const polyline = (pts: Pt[]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");

export function NucleosomeJourney() {
  const big: ChromoShape = { p: 92, q: 146, wArm: 27, wCen: 11, gap: 36, splay: 0.07 };
  const small: ChromoShape = { p: 13, q: 21, wArm: 5.2, wCen: 2.4, gap: 7, splay: 0.07 };
  const BIG_C: Pt = [745, 222];

  const art = useMemo(() => {
    const r = rng(7);
    const cell: Pt[] = [];
    for (let i = 0; i < 18; i++) {
      const t = (i / 18) * Math.PI * 2;
      const rad = 112 * (1 + 0.06 * Math.sin(3 * t + 0.5) + 0.04 * Math.sin(5 * t + 1.3));
      cell.push([140 + rad * Math.cos(t), 232 + rad * 0.9 * Math.sin(t)]);
    }
    const organelles = Array.from({ length: 7 }, () => {
      const t = r() * Math.PI * 2, d = 70 + r() * 22;
      return { x: 140 + d * Math.cos(t), y: 232 + d * 0.85 * Math.sin(t), a: r() * 180 };
    }).filter((o) => Math.hypot(o.x - 152, o.y - 226) > 62);
    const speckles = Array.from({ length: 60 }, () => {
      const t = r() * Math.PI * 2, d = Math.sqrt(r()) * 40;
      return [152 + d * Math.cos(t), 226 + d * Math.sin(t)] as Pt;
    });
    // the big chromosome: packed fibre in each chromatid; the right one ends at the tip of its long arm
    const left = packedFibre(big, -1, 0.4);
    const right = packedFibre(big, 1, 1.9);
    const tipLocal: Pt = [centreX(big, 1, big.q - 3), big.q - 3];
    right.push(tipLocal);
    // loose fibre from that tip: a coil that opens up, with nucleosomes getting further apart
    const start: Pt = [BIG_C[0] + tipLocal[0], BIG_C[1] + tipLocal[1]];
    const fibre: Pt[] = [start];
    const beads: Pt[] = [];
    for (let i = 1; i <= 160; i++) {
      const t = i / 160;
      const x = start[0] + 18 * Math.sin(Math.PI * t * 0.5) + 250 * t;
      const yBase = start[1] - 110 * t + 22 * Math.sin(Math.PI * t);
      const amp = 15 * (1 - t) + 3;
      const freq = 9 - 5 * t;
      fibre.push([x, yBase + amp * Math.sin(freq * Math.PI * 2 * t)]);
      if (i % (4 + Math.floor(t * 9)) === 0 && t < 0.9) beads.push(fibre[fibre.length - 1]);
    }
    return { cell, organelles, speckles, left, right, fibre, beads };
  }, []);

  const inNucleus = [
    { c: [392, 176] as Pt, rot: -25, tone: "a" },
    { c: [478, 170] as Pt, rot: 30, tone: "b" },
    { c: [368, 262] as Pt, rot: 60, tone: "b" },
    { c: [455, 285] as Pt, rot: -10, tone: "target" },
    { c: [528, 240] as Pt, rot: 80, tone: "a" },
    { c: [415, 336] as Pt, rot: 15, tone: "a" },
    { c: [500, 330] as Pt, rot: -50, tone: "b" },
  ];

  const nuc = useMemo(() => nucleosomeGeometry(), []);
  const k = 31 / HISTONE_RADIUS;
  const string = [
    { x: 1135, y: 214, s: 0.55 },
    { x: 1215, y: 186, s: 0.7 },
    { x: 1305, y: 226, s: 0.85 },
  ];
  const at = (p: Pt, n: { x: number; y: number; s: number }): Pt => [n.x + p[0] * n.s, n.y + p[1] * n.s];
  const fibreEnd = art.fibre[art.fibre.length - 1];
  const linkerPts = (a: Pt, b: Pt, bend: number) => {
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + bend];
    return Array.from({ length: 31 }, (_, j) => {
      const t = j / 30;
      return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1]] as Pt;
    });
  };
  const linkers = [
    linkerPts(fibreEnd, at(nuc.entry, string[0]), 12),
    linkerPts(at(nuc.exit, string[0]), at(nuc.entry, string[1]), 24),
    linkerPts(at(nuc.exit, string[1]), at(nuc.entry, string[2]), -22),
    linkerPts(at(nuc.exit, string[2]), [1384, 206], 16),
  ].map((pts) => ribbon(pts, pts.map(() => 4.5)));

  const nucleus = { x: 440, y: 248, r: 132 };
  const pores = Array.from({ length: 18 }, (_, i) => (i / 18) * 360);
  const bigOutline = [chromatidOutline(big, -1), chromatidOutline(big, 1)];
  const smallOutline = [chromatidOutline(small, -1), chromatidOutline(small, 1)];

  const caption = (x: number, text: string, sub?: string) => (
    <g>
      <text x={x} y={CAPTION_Y} textAnchor="middle" className="j-label">{text}</text>
      {sub && <text x={x} y={CAPTION_Y + 20} textAnchor="middle" className="j-sub">{sub}</text>}
    </g>
  );

  return (
    <figure className="journey">
      <div className="journey-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="From a cell to a nucleosome: a cell with its nucleus; the nucleus with chromosomes; one chromosome made of packed chromatin fibre, unwinding; the fibre as nucleosomes on linker DNA; one nucleosome seen from above.">
          <defs>
            <clipPath id="j-big-clip">
              {bigOutline.map((d, i) => <path key={i} d={d} transform={`translate(${BIG_C[0]} ${BIG_C[1]})`} />)}
            </clipPath>
          </defs>

          {/* zoom lines: two dashed lines from each part to its close-up (behind everything) */}
          <path d="M152,180 L440,116 M152,272 L440,380" className="j-zoom-line" />
          <path d="M466,262 L695,80 M466,312 L695,374" className="j-zoom-line" />
          <path d="M1305,196 L1480,108 M1305,252 L1480,318" className="j-zoom-line" />

          {/* 1. cell: H&E colours, pink cytoplasm and violet nucleus */}
          <path d={smooth(art.cell, true)} className="j-cell" />
          {art.organelles.map((o, i) => (
            <ellipse key={i} cx={o.x} cy={o.y} rx={9} ry={4.5} transform={`rotate(${o.a} ${o.x} ${o.y})`} className="j-organelle" />
          ))}
          <circle cx={152} cy={226} r={46} className="j-nucleus-small" />
          {art.speckles.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.6} className="j-chromatin-dot" />)}
          <circle cx={162} cy={220} r={9} className="j-nucleolus" />

          {/* 2. nucleus with chromosomes (same outline as the big one, banded) */}
          <circle cx={nucleus.x} cy={nucleus.y} r={nucleus.r} className="j-nucleus" />
          <circle cx={nucleus.x - 30} cy={nucleus.y + 6} r={18} className="j-nucleolus-big" />
          {inNucleus.map((c, i) => (
            <g key={i} transform={`translate(${c.c[0]} ${c.c[1]}) rotate(${c.rot})`} className={`j-chromo j-chromo-${c.tone}`}>
              {smallOutline.map((d, j) => <path key={j} d={d} />)}
              {[-7, 6, 13].map((y) => <line key={y} x1={-9} x2={9} y1={y} y2={y} className="j-band" />)}
            </g>
          ))}
          <circle cx={nucleus.x} cy={nucleus.y} r={nucleus.r} className="j-envelope" />
          {pores.map((a) => (
            <rect key={a} x={nucleus.x + nucleus.r - 4} y={nucleus.y - 3} width={8} height={6} rx={2} className="j-pore"
              transform={`rotate(${a} ${nucleus.x} ${nucleus.y})`} />
          ))}
          <circle cx={455} cy={285} r={30} className="j-focus" />

          {/* 3. one chromosome made of packed chromatin fibre; the fibre unwinds from the tip of one arm */}
          <g transform={`translate(${BIG_C[0]} ${BIG_C[1]})`}>
            {bigOutline.map((d, i) => <path key={i} d={d} className="j-chromatid" />)}
          </g>
          <g clipPath="url(#j-big-clip)">
            <g transform={`translate(${BIG_C[0]} ${BIG_C[1]})`}>
              <path d={polyline(art.left)} className="j-packed" />
              <path d={polyline(art.right)} className="j-packed" />
              {art.left.filter((_, i) => i % 16 === 0).map(([x, y], i) => <circle key={`l${i}`} cx={x} cy={y} r={2.3} className="j-bead-small" />)}
              {art.right.filter((_, i) => i % 16 === 0).map(([x, y], i) => <circle key={`r${i}`} cx={x} cy={y} r={2.3} className="j-bead-small" />)}
            </g>
          </g>
          <path d={smooth(art.fibre)} className="j-fibre" />
          {art.beads.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5} className="j-bead" />)}

          {/* 4. nucleosomes on linker DNA */}
          {linkers.map((d, i) => <path key={i} d={d} className="j-linker" />)}
          {string.map((n, i) => (
            <g key={i} transform={`translate(${n.x},${n.y}) scale(${n.s})`}>
              {nuc.back.map((d, j) => <path key={`b${j}`} d={d} className="j-wrap-back" />)}
              <g transform={`rotate(-12) translate(${-100 * k},${-100 * k}) scale(${k})`}>
                {HISTONE_PATHS.map((d, j) => <path key={j} d={d} className="j-core" />)}
              </g>
              {nuc.front.map((d, j) => <path key={`f${j}`} d={d} className="j-wrap" />)}
            </g>
          ))}

          {/* 5. one nucleosome seen from above: the MorphoNup logo */}
          <circle cx={1480} cy={213} r={104} className="j-logo-frame" />
          <image href={logo} x={1385} y={118} width={190} height={190} className="only-light" />
          <image href={logoDark} x={1385} y={118} width={190} height={190} className="only-dark" />

          {caption(140, "Cell", "nucleus in violet")}
          {caption(440, "Nucleus", "chromosomes inside")}
          {caption(760, "Chromosome", "packed chromatin fibre")}
          {caption(1000, "Chromatin fibre", "unwinding")}
          {caption(1230, "Nucleosomes", "joined by linker DNA")}
          {caption(1480, "One nucleosome", "147 bp around a histone core")}
        </svg>
      </div>
      <figcaption className="small muted">
        Inside the nucleus, DNA is packed into chromosomes, which are made of tightly folded chromatin fibre. Unwound,
        the fibre is a string of nucleosomes: 147 bp of DNA wrapped around a histone core, joined by linker DNA.
        MorphoNup reads one 147-bp stretch and predicts which of the two it is.
      </figcaption>
    </figure>
  );
}
