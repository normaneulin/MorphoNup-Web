// One prediction, as Predictor.predict in backend/morphonup_web/predictor.py:
//   a sequence of the dataset (either strand) is predicted by the fold model whose test part contained it, the
//   out-of-fold prediction behind the reported accuracy; any other sequence gets the mean of the fold models.
// Each model reads both strands; the prediction is their mean, nucleosomal from 0.5.

import { type DatasetSequences, type Label } from "./dataset";
import { type DatasetModel, predictCodes } from "./network";
import { type ShapeTables } from "./shape";

export const THRESHOLD = 0.5;

export interface EngineResult {
  probability: number;
  probability_forward: number;
  probability_reverse: number;
  label: Label;
  fold: number | null;
  in_dataset: null | { name: string; label: Label; strand: string; copies: number };
  shape: Record<string, (number | null)[]>;
}

export function encode(sequence: string): Uint8Array {
  const codes = new Uint8Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) {
    const c = "ACGT".indexOf(sequence[i]);
    if (c < 0) throw new Error(`Position ${i + 1} is "${sequence[i]}". Use only A, C, G and T.`);
    codes[i] = c;
  }
  return codes;
}

export function runPrediction(model: DatasetModel, tables: ShapeTables, data: DatasetSequences,
                              codes: Uint8Array): EngineResult {
  const { rows, same } = data.lookup(codes);
  const index = rows.length ? (same.length ? same[0] : rows[0]) : null;
  const row = index === null ? null : data.row(index);
  const r = predictCodes(model, tables, codes, row ? row.fold : 0);
  const shape: EngineResult["shape"] = {};
  for (const [name, values] of Object.entries(r.raw)) {
    shape[name] = Array.from(values, (v) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100));
  }
  return {
    probability: r.p,
    probability_forward: r.p_fwd,
    probability_reverse: r.p_rc,
    label: r.p >= THRESHOLD ? "nucleosomal" : "linker",
    fold: row ? row.fold : null,
    in_dataset: row
      ? { name: row.name, label: row.label, strand: same.length ? "same" : "reverse complement", copies: rows.length }
      : null,
    shape,
  };
}
