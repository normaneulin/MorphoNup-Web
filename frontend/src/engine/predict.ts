// One prediction, as Predictor.predict in backend/morphonup_web/predictor.py:
//   a sequence of the dataset (either strand) is predicted by the fold model whose test part contained it, the
//   out-of-fold prediction behind the reported accuracy; any other sequence gets the mean of the fold models.
// Each model reads both strands; the prediction is their mean, nucleosomal from 0.5.
// The page finds the dataset row (findRow, main thread, which holds the dataset's sequences) and the Web Worker
// computes the scores (score). runPrediction joins the two; the parity test runs it.

import { type DatasetSequences, type Label } from "./dataset";
import { type DatasetModel, predictCodes } from "./network";
import { type ShapeTables } from "./shape";

export const THRESHOLD = 0.5;

export interface RowMatch {
  fold: number | null;
  in_dataset: null | { name: string; label: Label; strand: string; copies: number };
}

export interface Scores {
  probability: number;
  probability_forward: number;
  probability_reverse: number;
  label: Label;
  shape: Record<string, (number | null)[]>;
}

export type EngineResult = Scores & RowMatch;

export function encode(sequence: string): Uint8Array {
  const codes = new Uint8Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) {
    const c = "ACGT".indexOf(sequence[i]);
    if (c < 0) throw new Error(`Position ${i + 1} is "${sequence[i]}". Use only A, C, G and T.`);
    codes[i] = c;
  }
  return codes;
}

/** The dataset row of a sequence: the same strand preferred, else its reverse complement; null fold if absent. */
export function findRow(data: DatasetSequences, codes: Uint8Array): RowMatch {
  const { rows, same } = data.lookup(codes);
  if (!rows.length) return { fold: null, in_dataset: null };
  const row = data.row(same.length ? same[0] : rows[0]);
  return {
    fold: row.fold,
    in_dataset: { name: row.name, label: row.label, strand: same.length ? "same" : "reverse complement", copies: rows.length },
  };
}

/** Scores under the fold model `fold`, or the mean of all fold models when fold is 0. */
export function score(model: DatasetModel, tables: ShapeTables, codes: Uint8Array, fold: number): Scores {
  const r = predictCodes(model, tables, codes, fold);
  const shape: Scores["shape"] = {};
  for (const [name, values] of Object.entries(r.raw)) {
    shape[name] = Array.from(values, (v) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100));
  }
  return {
    probability: r.p,
    probability_forward: r.p_fwd,
    probability_reverse: r.p_rc,
    label: r.p >= THRESHOLD ? "nucleosomal" : "linker",
    shape,
  };
}

export function runPrediction(model: DatasetModel, tables: ShapeTables, data: DatasetSequences,
                              codes: Uint8Array): EngineResult {
  const match = findRow(data, codes);
  return { ...score(model, tables, codes, match.fold ?? 0), ...match };
}
