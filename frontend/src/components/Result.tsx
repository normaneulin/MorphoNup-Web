import { useState } from "react";
import type { DatasetItem, Prediction } from "../api";
import { percent } from "../api";
import { ShapeCharts } from "./ShapeCharts";

export function SequenceGrid({ sequence }: { sequence: string }) {
  const rows = Array.from({ length: 7 }, (_, r) => sequence.slice(r * 21, r * 21 + 21));
  return (
    <div className="seqgrid" aria-label="The sequence in 7 rows of 21 bases">
      {rows.map((row, r) => (
        <div className="seqrow" key={r}>
          <span className="pos">{r * 21 + 1}</span>
          {row.split("").map((b, c) => {
            const i = r * 21 + c;
            return (
              <span key={c} className={`base base-${b}${i === 73 ? " dyad" : ""}`} title={`position ${i + 1}${i === 73 ? ", dyad" : ""}`}>
                {b}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Result({ result, dataset }: { result: Prediction; dataset: DatasetItem }) {
  const [tab, setTab] = useState<"sequence" | "shape">("sequence");
  const p = result.probability;
  const truth = result.in_dataset;
  const correct = truth ? truth.label === result.label : null;
  const bench = dataset.benchmark;
  return (
    <div className="result">
      <div className="verdict">
        <div className="muted">MorphoNup says</div>
        <div className={`verdict-word ${result.label}`}>{result.label === "nucleosomal" ? "Nucleosomal" : "Linker"}</div>
        <div className="bar" role="img" aria-label={`Probability ${p.toFixed(3)} of being nucleosomal; threshold 0.5`}>
          <div className={`bar-fill ${result.label}`} style={{ width: `${p * 100}%` }} />
          <div className="bar-cut" />
        </div>
        <div className="bar-labels small muted">
          <span>0, linker</span>
          <span>0.5</span>
          <span>1, nucleosomal</span>
        </div>
        <p>
          Probability of being nucleosomal: <b>{p.toFixed(3)}</b>
        </p>
        <div className="strands">
          <div>
            <b>{result.probability_forward.toFixed(3)}</b>
            <span className="small muted">reading the strand you gave</span>
          </div>
          <div>
            <b>{result.probability_reverse.toFixed(3)}</b>
            <span className="small muted">reading the other strand</span>
          </div>
        </div>
        <dl className="facts small">
          <div>
            <dt>Dataset label</dt>
            <dd>
              {truth ? (
                <>
                  <span className={`chip ${truth.label}`}>{truth.label}</span> {truth.name.replace(/_/g, " ")}
                  {truth.strand !== "same" ? ", entered as its reverse complement" : ""}
                </>
              ) : (
                "not in this dataset"
              )}
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>
              {truth
                ? `fold ${result.model.fold} of the ${result.model.k}-fold cross-validation (out-of-fold prediction)`
                : `mean of the ${result.model.k} cross-validation models`}
            </dd>
          </div>
          {truth && (
            <div>
              <dt>Outcome</dt>
              <dd>{correct ? "matches the label" : "does not match the label"}</dd>
            </div>
          )}
          {bench && (
            <div>
              <dt>Accuracy on this dataset</dt>
              <dd>
                {percent(bench.accuracy)} in {result.model.k}-fold cross-validation (MCC {bench.mcc.toFixed(2)}, ROC AUC{" "}
                {bench.roc_auc.toFixed(3)}{bench.seeds > 1 ? `, mean of ${bench.seeds} seeds` : ""})
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="tabs" role="tablist" aria-label="Details">
        <button type="button" role="tab" aria-selected={tab === "sequence"} onClick={() => setTab("sequence")}>
          Sequence
        </button>
        <button type="button" role="tab" aria-selected={tab === "shape"} onClick={() => setTab("shape")}>
          DNA shape
        </button>
      </div>
      <div role="tabpanel">
        {tab === "sequence" ? (
          <div className="tab-sequence">
            <SequenceGrid sequence={result.sequence} />
            <p className="muted small">
              7 rows of 21 bases, because 21 bp is about two turns of the double helix. The underlined base is the dyad,
              the centre of the nucleosome.
            </p>
          </div>
        ) : (
          <ShapeCharts shape={result.shape} sequence={result.sequence} />
        )}
      </div>
    </div>
  );
}
