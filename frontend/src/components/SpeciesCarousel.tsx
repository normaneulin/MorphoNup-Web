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
const FLICK_MS = 160;       // a flick carries on as far as its speed would go in this time

/** Position, size and opacity of a figure `e` steps from the centre (e may be fractional while dragging). */
function layout(e: number) {
  const a = Math.min(Math.abs(e), 2);
  const scale = a >= 1 ? 0.58 : 1 - 0.42 * a;
  const opacity = a <= 1 ? 1 - 0.7 * a : 0.3 * (2 - a);      // 1 in the centre, 0.3 beside it, 0 two steps away
  return { transform: `translateX(calc(${e.toFixed(4)} * var(--car-step))) scale(${scale.toFixed(4)})`, opacity };
}

// The selected species is the one in the centre. Arrows, the arrow keys, a tap on a side figure, or a swipe or drag
// turn the carousel. While dragging, the row follows the finger; on release it glides on to the next figure once the
// drag passed 35 % of a step, else back (a quick flick counts its speed, so it can go further). All figures move together in one row, so none ever jumps across to the other side.
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
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ x: number; id: number; step: number; moved: boolean; dragging: boolean;
    samples: { x: number; t: number }[] } | null>(null);
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

  /** Writes the figures' places straight to the page (while dragging, and to snap back without a state change). */
  const place = (shift: number) => {
    items.current.forEach((el, j) => {
      if (!el) return;
      const { transform, opacity } = layout(j - pos + shift);
      el.style.transform = transform;
      el.style.setProperty("--o", String(opacity));
    });
  };

  const go = (step: number) => {
    const next = Math.min(COPIES * n - 1, Math.max(0, pos + step));
    if (next === pos) {
      place(0);
      return;
    }
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

  const endDrag = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d) return;
    window.setTimeout(() => { drag.current = null; }, 0);      // after the click that may follow
    if (!d.dragging) return;
    delete track.current?.dataset.dragging;                   // transitions back on: the release glides
    const dx = e.clientX - d.x;
    if (cancelled) return place(0);
    const recent = d.samples.filter((s) => e.timeStamp - s.t < 100);
    const first = recent[0] ?? d.samples[d.samples.length - 1];
    const velocity = first && e.timeStamp > first.t ? (e.clientX - first.x) / (e.timeStamp - first.t) : 0;   // px per ms
    const travel = -(dx + velocity * FLICK_MS) / d.step;     // in steps; past 35 % of a step turns to the next figure
    const steps = Math.sign(travel) * Math.floor(Math.abs(travel) + 0.65);
    go(Math.max(-(n - 1), Math.min(n - 1, steps)));
  };

  const current = groups[index];
  const slots = Array.from({ length: n * COPIES }, (_, j) => j);
  return (
    <div className="carousel" role="group" aria-roledescription="carousel" aria-label="Species">
      <div
        className="car-stage"
        ref={stage}
        tabIndex={0}
        aria-label={`Species: ${current.species}. Use the left and right arrow keys to change.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
          if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (pos < n || pos >= 2 * n) {                       // a move is still settling: re-centre now
            window.clearTimeout(settle.current);
            setAnimate(false);
            setPos(n + (((pos % n) + n) % n));
          }
          const step = parseFloat(getComputedStyle(stage.current!).getPropertyValue("--car-step")) || 175;
          drag.current = { x: e.clientX, id: e.pointerId, step, moved: false, dragging: false,
            samples: [{ x: e.clientX, t: e.timeStamp }] };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.id) return;
          const dx = e.clientX - d.x;
          if (!d.dragging) {
            if (Math.abs(dx) < 6) return;
            d.dragging = d.moved = true;
            track.current!.dataset.dragging = "";              // figures follow the finger without delay
            stage.current?.setPointerCapture(e.pointerId);
          }
          d.samples.push({ x: e.clientX, t: e.timeStamp });
          if (d.samples.length > 8) d.samples.shift();
          place(Math.max(-(n - 1), Math.min(n - 1, dx / d.step)));
        }}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        <button type="button" className="car-arrow car-prev" aria-label="Previous species" onClick={() => go(-1)}>
          <Chevron left />
        </button>
        <div className={`car-track${animate ? "" : " no-anim"}`} ref={track}>
          {slots.map((j) => {
            const g = groups[j % n];
            const offset = j - pos;
            const near = Math.abs(offset) <= 1;
            const { transform, opacity } = layout(offset);
            return (
              <button
                key={j}
                ref={(el) => { items.current[j] = el; }}
                type="button"
                className={`car-item${offset === 0 ? " is-centre" : ""}${near ? "" : " is-far"}`}
                style={{ transform, "--o": opacity } as React.CSSProperties}
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
