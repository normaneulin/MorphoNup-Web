import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Label } from "../api";
import { HISTONE_PATHS, HISTONE_RADIUS } from "../assets/histone";

// A strip of chromatin (nucleosome, linker, nucleosome, linker...) slides under a lens while MorphoNup predicts.
// When the answer arrives the strip decelerates smoothly and lands with a nucleosome or a linker in the lens.

const U = 260;            // one repeat: a nucleosome and the linker after it
const H = 170;
const CY = H / 2 + 4;
const CORE_R = 31;
const RX = 40;            // wrap ellipse, before tilt
const RY = 20;
const ADVANCE = 13;       // shift of the second gyre along the fibre
const TILT = (-32 * Math.PI) / 180;
const TURNS = 1.65;
const VARIANTS = 4;       // four different linkers; the strip repeats every 4 units
const SPEED = 400;        // drawing units per second while scanning (about 1.5 nucleosomes a second on every screen)
const MIN_SCAN_MS = 1100; // scan at least this long, so the motion reads
const LENS = 132;
const UNITS = [-2, 9];    // units drawn: the strip position stays in 0.5 U .. 5 U (+ landing), half a panel each side
const PERIOD = VARIANTS * U;
const WRAP_AT = 5 * U;    // past this the position jumps back one period, which looks identical
const X0 = UNITS[0] * U;
const STRIP_W = (UNITS[1] - UNITS[0] + 1) * U;
// On a narrow panel the drawing is scaled down (to 0.66 at 370 px), so a phone shows the same scene as a desktop.
const scaleFor = (width: number) => Math.min(1, Math.max(0.66, width / 560));

export type Pt = [number, number];

function rng(seed: number) {
  let s = (seed * 2654435761) % 4294967296;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function wrapPoint(theta: number): { p: Pt; front: boolean } {
  const t0 = Math.PI;
  const x = RX * Math.cos(theta) + ADVANCE * ((theta - t0) / (2 * Math.PI) - TURNS / 2);
  const y = RY * Math.sin(theta);
  return {
    p: [x * Math.cos(TILT) - y * Math.sin(TILT), x * Math.sin(TILT) + y * Math.cos(TILT)],
    front: Math.sin(theta) > 0,
  };
}

export function ribbon(points: Pt[], widths: number[]): string {
  const left: Pt[] = [];
  const right: Pt[] = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const h = widths[i] / 2;
    left.push([p[0] + nx * h, p[1] + ny * h]);
    right.push([p[0] - nx * h, p[1] - ny * h]);
  });
  const all = [...left, ...right.reverse()];
  return "M" + all.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function nucleosomeGeometry() {
  const t0 = Math.PI;
  const t1 = t0 + TURNS * 2 * Math.PI;
  const n = 260;
  const back: string[] = [];
  const front: string[] = [];
  let seg: Pt[] = [];
  let ws: number[] = [];
  let side: boolean | null = null;
  for (let i = 0; i <= n; i++) {
    const theta = t0 + ((t1 - t0) * i) / n;
    const { p, front: f } = wrapPoint(theta);
    const w = 6.6 + 1.6 * Math.sin(theta * 3.4);
    if (side !== null && f !== side) {
      seg.push(p);
      ws.push(w);
      (side ? front : back).push(ribbon(seg, ws));
      seg = [seg[seg.length - 2], p];
      ws = [ws[ws.length - 2], w];
    } else {
      seg.push(p);
      ws.push(w);
    }
    side = f;
  }
  (side ? front : back).push(ribbon(seg, ws));
  return { back, front, entry: wrapPoint(t0).p, exit: wrapPoint(t1).p };
}

function linkerPath(variant: number, start: Pt, end: Pt): string {
  const r = rng(variant + 7);
  const a1 = 14 + 18 * r();
  const a2 = 6 + 10 * r();
  const ph1 = r() * Math.PI * 2;
  const ph2 = r() * Math.PI * 2;
  const k1 = 1 + Math.floor(r() * 2);
  const k2 = 3 + Math.floor(r() * 3);
  const pts: Pt[] = [];
  const ws: number[] = [];
  const n = 70;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const env = Math.sin(Math.PI * u);
    pts.push([
      start[0] + (end[0] - start[0]) * u,
      start[1] + (end[1] - start[1]) * u + env * (a1 * Math.sin(k1 * Math.PI * u + ph1) + a2 * Math.sin(k2 * Math.PI * u + ph2)),
    ]);
    ws.push(3.4 + 3.2 * (0.5 + 0.5 * Math.sin(9 * u + variant)) * (0.6 + 0.4 * r()));
  }
  return ribbon(pts, ws);
}

export type ScanPhase = "idle" | "scanning" | "done";

// phase "idle": the strip rests (or glides to a stop). "scanning": it speeds up and keeps moving until `target`
// (the prediction) is known, then decelerates and lands on that kind of DNA and calls onLanded. "done": it stays there.
export function ChromatinScanner({ phase, target, onLanded, note }: {
  phase: ScanPhase; target: Label | null; onLanded: () => void; note?: string | null;   // note: shown while scanning
}) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [landed, setLanded] = useState<Label | null>(null);
  const widthRef = useRef(width);
  const scale = scaleFor(width);
  const phaseRef = useRef(phase);
  const targetRef = useRef(target);
  const landedRef = useRef(onLanded);
  const anim = useRef({ x: U * 0.5, v: 0, start: 0, last: 0,
    landing: null as null | { x0: number; x1: number; v0: number; t: number; ms: number; label: Label } });
  phaseRef.current = phase;
  targetRef.current = target;
  landedRef.current = onLanded;
  widthRef.current = width;

  const geo = useMemo(() => {
    const nuc = nucleosomeGeometry();
    const linkers = Array.from({ length: VARIANTS }, (_, v) =>
      linkerPath(v, [U / 2 + nuc.exit[0], CY + nuc.exit[1]], [U + U / 2 + nuc.entry[0], CY + nuc.entry[1]]),
    );
    return { ...nuc, linkers };
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // a new prediction: forget the last landing and start scanning from where the strip is
  useEffect(() => {
    if (phase === "scanning") {
      anim.current.start = performance.now();
      anim.current.landing = null;
      setLanded(null);
    }
    if (phase === "idle") setLanded(null);
  }, [phase]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = anim.current;
    s.last = performance.now();
    let raf = 0;
    // The strip is one HTML layer moved with a CSS transform: the browser slides the drawn picture on the GPU instead
    // of redrawing every DNA and histone path in each frame (that redraw made the scan stutter on phones).
    const place = () => {
      const w = widthRef.current;
      const px = w / 2 - (s.x - X0) * scaleFor(w);
      if (strip.current) strip.current.style.transform = `translate3d(${px.toFixed(2)}px,0,0)`;
    };
    const wrap = () => {
      if (s.x <= WRAP_AT) return;
      s.x -= PERIOD;
      if (s.landing) { s.landing.x0 -= PERIOD; s.landing.x1 -= PERIOD; }
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const scanning = phaseRef.current === "scanning";
      const t = targetRef.current;
      if (s.landing) {
        // ease out from the scanning speed to zero exactly on the target centre
        const L = s.landing;
        const u = Math.min(1, (now - L.t) / L.ms);
        s.x = L.x0 + (L.x1 - L.x0) * (1 - (1 - u) * (1 - u));
        if (u >= 1) {
          s.landing = null;
          s.v = 0;
          if (scanning) {
            setLanded(L.label);
            landedRef.current();
          }
        }
      } else {
        // With the "reduce motion" setting of the phone or computer the scan still plays, slower:
        // it is the sign that the prediction runs, so it is calmed rather than removed (about 1 nucleosome a second).
        const top = reduced ? SPEED * 0.7 : SPEED;
        const goal = scanning ? top : 0;
        s.v += (goal - s.v) * Math.min(1, dt * 3.5);          // smooth start and smooth stop
        if (Math.abs(s.v) < 0.5 && goal === 0) s.v = 0;
        s.x += s.v * dt;
        if (scanning && t && now - s.start >= MIN_SCAN_MS && s.v > top * 0.85) {
          const offset = t === "nucleosomal" ? U / 2 : 0;
          const room = (reduced ? 0.35 : 0.6) * U;                          // the slower strip needs less room to stop
          const x1 = Math.ceil((s.x + room - offset) / U) * U + offset;      // next centre with room to slow down
          s.landing = { x0: s.x, x1, v0: s.v, t: now, ms: ((2 * (x1 - s.x)) / s.v) * 1000, label: t };
        }
      }
      wrap();
      place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const k = CORE_R / HISTONE_RADIUS;
  const units = [];
  for (let u = UNITS[0]; u <= UNITS[1]; u++) {
    const v = ((u % VARIANTS) + VARIANTS) % VARIANTS;
    units.push(
      <g key={u} transform={`translate(${u * U},0)`}>
        <path d={geo.linkers[v]} className="scan-linker" />
        <g transform={`translate(${U / 2},${CY})`}>
          {geo.back.map((d, i) => <path key={`b${i}`} d={d} className="scan-dna-back" />)}
          <g transform={`rotate(-12) translate(${-100 * k},${-100 * k}) scale(${k})`}>
            {HISTONE_PATHS.map((d, i) => <path key={i} d={d} className="scan-core" />)}
          </g>
          {geo.front.map((d, i) => <path key={`f${i}`} d={d} className="scan-dna" />)}
        </g>
      </g>,
    );
  }
  const lens = LENS * scale;
  const h = H * scale;
  const lensX = width / 2 - lens / 2;
  const caption = landed
    ? landed === "nucleosomal" ? "Landed on a nucleosome" : "Landed on linker DNA"
    : phase === "scanning" ? note ?? "Reading the sequence and its shape" : "Ready";
  return (
    <div className={`scanner is-${landed ? "landed" : phase}`} ref={box}>
      <div className="scan-view" style={{ height: h }} role="img" aria-label={caption}>
        <div className="scan-strip" ref={strip}>
          <svg width={STRIP_W * scale} height={h} viewBox={`${X0} 0 ${STRIP_W} ${H}`} aria-hidden="true">{units}</svg>
        </div>
        <svg className="scan-overlay" width={width} height={h} aria-hidden="true">
          <rect x={0} y={0} width={Math.max(0, lensX)} height={h} className="scan-shade" />
          <rect x={lensX + lens} y={0} width={Math.max(0, width - lensX - lens)} height={h} className="scan-shade" />
          <rect x={lensX} y={10 * scale} width={lens} height={h - 20 * scale} rx={16 * scale} className="scan-lens" />
        </svg>
        <div className="scan-line" style={{ left: lensX, top: 14 * scale, height: h - 28 * scale,
          "--lens": `${lens - 3}px` } as React.CSSProperties} />
      </div>
      <div className="scan-caption" aria-live="polite">{caption}</div>
      <div className="scan-legend">
        <span>
          <svg viewBox="45 45 110 110" width="16" height="16" className="legend-core" aria-hidden="true">
            {HISTONE_PATHS.map((d, i) => <path key={i} d={d} />)}
          </svg>
          Histone core
        </span>
        <span>
          <svg viewBox="0 0 24 12" width="24" height="12" aria-hidden="true">
            <path d="M2,6 C5,0 8,12 12,6 S19,0 22,6" className="legend-dna" />
          </svg>
          DNA
        </span>
        <Link to="/#nucleosome" className="scan-help">What am I seeing?</Link>
      </div>
    </div>
  );
}
