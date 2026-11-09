import { useEffect, useRef, useState } from "react";
import type { SpeciesGroup } from "../api";
import { Silhouette, SPECIES_NOTE } from "./SpeciesFigures";

function Chevron({ left }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

const COPIES = 3;           // the four species are laid out three times; the row slides, then re-centres unseen
const MOVE_MS = 420;

// The selected species is the one in the centre. Arrows, a swipe or drag, the arrow keys or a tap on a side figure
// turn the carousel. All figures move together in one row, so none ever jumps across to the other side.
export function SpeciesCarousel({
  groups,
  value,
  onChange,
}: {
  groups: SpeciesGroup[];
  value: string;
  onChange: (species: string) => void;
}) {
  const n = groups.length;
  const index = Math.max(0, groups.findIndex((g) => g.species === value));
  const [pos, setPos] = useState(n + index);           // position in the repeated row; the middle copy is n..2n-1
  const [animate, setAnimate] = useState(true);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const settle = useRef<number>();

  // follow a change made elsewhere (first load, a link)
  useEffect(() => {
    if (((pos % n) + n) % n !== index) {
      setAnimate(false);
      setPos(n + index);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, n]);

  useEffect(() => {
    if (animate) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  const go = (step: number) => {
    const next = pos + step;
    setAnimate(true);
    setPos(next);
    onChange(groups[((next % n) + n) % n].species);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      // back to the same species in the middle copy, without animation
      if (next < n || next >= 2 * n) {
        setAnimate(false);
        setPos(n + (((next % n) + n) % n));
      }
    }, MOVE_MS + 30);
  };

  const current = groups[index];
  const slots = Array.from({ length: n * COPIES }, (_, j) => j);
  return (
    <div className="carousel" role="group" aria-roledescription="carousel" aria-label="Species">
      <div
        className="car-stage"
        tabIndex={0}
        aria-label={`Species: ${current.species}. Use the left and right arrow keys to change.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
          if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, moved: false }; }}
        onPointerMove={(e) => { if (drag.current && Math.abs(e.clientX - drag.current.x) > 8) drag.current.moved = true; }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d && Math.abs(e.clientX - d.x) > 40) go(e.clientX < d.x ? 1 : -1);
          window.setTimeout(() => { drag.current = null; }, 0);
        }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <button type="button" className="car-arrow car-prev" aria-label="Previous species" onClick={() => go(-1)}>
          <Chevron left />
        </button>
        <div className={`car-track${animate ? "" : " no-anim"}`}>
          {slots.map((j) => {
            const g = groups[j % n];
            const offset = j - pos;
            const near = Math.abs(offset) <= 1;
            return (
              <button
                key={j}
                type="button"
                className={`car-item${offset === 0 ? " is-centre" : ""}${near ? "" : " is-far"}`}
                style={{ "--offset": offset } as React.CSSProperties}
                aria-label={offset === 0 ? `${g.species}, selected` : `Choose ${g.species}`}
                aria-hidden={near ? undefined : true}
                tabIndex={near && offset !== 0 ? 0 : -1}
                onClick={() => {
                  if (drag.current?.moved || offset === 0 || !near) return;
                  go(offset);
                }}
              >
                <Silhouette species={g.species} />
              </button>
            );
          })}
        </div>
        <button type="button" className="car-arrow car-next" aria-label="Next species" onClick={() => go(1)}>
          <Chevron />
        </button>
      </div>
      <div className="car-details" key={current.species} aria-live="polite">
        <em>{current.species}</em>
        <span className="muted">{SPECIES_NOTE[current.species] ?? current.common_name}</span>
      </div>
    </div>
  );
}
