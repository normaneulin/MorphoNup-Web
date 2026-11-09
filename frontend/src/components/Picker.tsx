import { useEffect, useState } from "react";
import type { DatasetItem } from "../api";
import { percent } from "../api";
import { REGION_INFO } from "../datasetInfo";
import { Icon, REGION_ICON } from "./Brand";
import { Collapse } from "./Collapse";

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={`chev${up ? " up" : ""}`}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// The datasets of one species. The selected one shows what the dataset is, right under it; the explanation can be
// collapsed, and choosing another dataset closes it and opens the new one (only one is ever open).
export function DatasetSlides({
  datasets,
  value,
  onChange,
}: {
  datasets: DatasetItem[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(true);
  useEffect(() => setInfoOpen(true), [value]);

  return (
    <div className="slides" role="radiogroup" aria-label="Dataset">
      {datasets.map((d) => {
        const selected = value === d.slug;
        const info = REGION_INFO[d.region];
        const infoId = `info-${d.slug}`;
        return (
          <div key={d.slug} className={`slide-item${selected ? " is-selected" : ""}`}>
            <div className="slide">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!d.available}
                className="slide-main"
                onClick={() => d.available && onChange(d.slug)}
                title={d.available ? undefined : d.message}
              >
                <span className="frost">
                  <Icon name={REGION_ICON[d.region]} size={26} />
                </span>
                <span className="glass">
                  <b>{d.name}</b>
                  <span className="muted small">
                    {d.collection}
                    {d.n ? `, ${d.n.toLocaleString()} sequences` : ""}
                  </span>
                  {d.available ? (
                    <span className="small">Accuracy {percent(d.benchmark?.accuracy ?? d.served_accuracy ?? 0)}</span>
                  ) : (
                    <span className="chip waiting">Still training</span>
                  )}
                </span>
              </button>
              {selected && info && (
                <button type="button" className="slide-toggle" aria-expanded={infoOpen} aria-controls={infoId}
                  onClick={() => setInfoOpen(!infoOpen)}>
                  <span>{infoOpen ? "Hide" : "What is this?"}</span>
                  <Chevron up={infoOpen} />
                </button>
              )}
            </div>
            {info && (
              <Collapse open={selected && infoOpen} id={infoId}>
                <div className="slide-info">
                  <p>{info.what}</p>
                  <p className="small muted">
                    {info.source}.{" "}
                    {d.n && d.positive !== undefined
                      ? `${d.n.toLocaleString()} sequences, ${percent(d.positive / d.n, 0)} of them nucleosomal.`
                      : ""}
                  </p>
                </div>
              </Collapse>
            )}
          </div>
        );
      })}
    </div>
  );
}
