import { useEffect, useRef, useState } from "react";

// The 14 DNAshapeR tracks. MorphoNup uses MGW, Roll and EP as they are, combines seven into six PLS components, and
// leaves out the four that change sign between the two strands (paper, Section 3.3).
export const TRACKS: { key: string; name: string; unit: string; use: "direct" | "pls" | "unused" }[] = [
  { key: "MGW", name: "Minor groove width", unit: "Å", use: "direct" },
  { key: "Roll", name: "Roll", unit: "°", use: "direct" },
  { key: "EP", name: "Electrostatic potential", unit: "kT/e", use: "direct" },
  { key: "ProT", name: "Propeller twist", unit: "°", use: "pls" },
  { key: "HelT", name: "Helix twist", unit: "°", use: "pls" },
  { key: "Opening", name: "Opening", unit: "°", use: "pls" },
  { key: "Stagger", name: "Stagger", unit: "Å", use: "pls" },
  { key: "Stretch", name: "Stretch", unit: "Å", use: "pls" },
  { key: "Rise", name: "Rise", unit: "Å", use: "pls" },
  { key: "Slide", name: "Slide", unit: "Å", use: "pls" },
  { key: "Buckle", name: "Buckle", unit: "°", use: "unused" },
  { key: "Shear", name: "Shear", unit: "Å", use: "unused" },
  { key: "Shift", name: "Shift", unit: "Å", use: "unused" },
  { key: "Tilt", name: "Tilt", unit: "°", use: "unused" },
];
const USE_NOTE = { direct: "used as it is", pls: "combined by PLS", unused: "not used (changes sign between strands)" };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Position along the 147 bp: base-pair value i sits on base i + 1; step value j sits between bases j + 1 and j + 2.
const positionOf = (values: (number | null)[], i: number) => (values.length === 147 ? i + 1 : i + 1.5);
const where = (pos: number) => (Number.isInteger(pos) ? `position ${pos}` : `between ${pos - 0.5} and ${pos + 0.5}`);

function Chart({
  track,
  values,
  hover,
  onHover,
}: {
  track: (typeof TRACKS)[number];
  values: (number | null)[];
  hover: number | null;
  onHover: (pos: number | null) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 96;
  const pad = { l: 8, r: 8, t: 8, b: 18 };
  const known = values.filter((v): v is number => v !== null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = hi - lo || 1;
  const x = (pos: number) => pad.l + ((pos - 1) / 146) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (height - pad.t - pad.b);
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${d === "" || values[i - 1] === null ? "M" : "L"}${x(positionOf(values, i)).toFixed(1)},${y(v).toFixed(1)}`;
  });
  // value under the pointer: nearest defined index to the hovered position
  let hoverIndex: number | null = null;
  if (hover !== null) {
    let best = Infinity;
    values.forEach((v, i) => {
      const dist = Math.abs(positionOf(values, i) - hover);
      if (v !== null && dist < best) [best, hoverIndex] = [dist, i];
    });
  }
  const hv = hoverIndex !== null ? values[hoverIndex] : null;
  return (
    <figure className="chart">
      <figcaption>
        <span>
          <b>{track.name}</b> <span className="muted small">({track.unit}, {USE_NOTE[track.use]})</span>
        </span>
        <span className="small chart-readout" aria-live="off">
          {hv !== null && hoverIndex !== null
            ? `${where(positionOf(values, hoverIndex))}: ${hv.toFixed(2)}`
            : `${lo.toFixed(2)} to ${hi.toFixed(2)}`}
        </span>
      </figcaption>
      <div ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${track.name} along the sequence, from ${lo.toFixed(2)} to ${hi.toFixed(2)} ${track.unit}`}
          onPointerMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const pos = 1 + ((e.clientX - rect.left - pad.l) / (width - pad.l - pad.r)) * 146;
            onHover(Math.min(147, Math.max(1, pos)));
          }}
          onPointerLeave={() => onHover(null)}
        >
          <line className="chart-dyad" x1={x(74)} x2={x(74)} y1={pad.t} y2={height - pad.b} />
          <path className="chart-line" d={d} />
          {hv !== null && hoverIndex !== null && (
            <g className="chart-hover">
              <line x1={x(positionOf(values, hoverIndex))} x2={x(positionOf(values, hoverIndex))} y1={pad.t} y2={height - pad.b} />
              <circle cx={x(positionOf(values, hoverIndex))} cy={y(hv)} r={4} />
            </g>
          )}
          {[1, 37, 74, 111, 147].map((p) => (
            <text key={p} className="chart-tick" x={x(p)} y={height - 4} textAnchor={p === 1 ? "start" : p === 147 ? "end" : "middle"}>
              {p === 74 ? "74, dyad" : p}
            </text>
          ))}
        </svg>
      </div>
    </figure>
  );
}

export function ShapeCharts({ shape, sequence }: { shape: Record<string, (number | null)[]>; sequence: string }) {
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const shown = TRACKS.filter((t) => all || t.use === "direct");
  const download = () => {
    const header = ["position", "base", ...TRACKS.map((t) => `${t.key} (${t.unit})`)];
    const rows = [header.join(",")];
    for (let i = 0; i < 147; i++) {
      // step tracks are listed on the first base of their step
      const cells = TRACKS.map((t) => {
        const v = shape[t.key][i];
        return v === null || v === undefined ? "" : String(v);
      });
      rows.push([i + 1, sequence[i], ...cells].join(","));
    }
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "morphonup_dna_shape.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="charts">
      <p className="muted small">
        Predicted by the same lookup tables as DNAshapeR 1.18.0. The dashed line is the dyad, the centre of the 147 bp.
        Point at a chart to read a value.
      </p>
      {shown.map((t) => (
        <Chart key={t.key} track={t} values={shape[t.key]} hover={hover} onHover={setHover} />
      ))}
      <div className="charts-actions">
        <button type="button" className="btn-quiet" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show the 3 tracks MorphoNup uses directly" : "Show all 14 tracks"}
        </button>
        <button type="button" className="btn-quiet" onClick={download}>
          Download the 14 tracks (CSV)
        </button>
      </div>
    </div>
  );
}
