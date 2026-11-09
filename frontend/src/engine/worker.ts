// Runs predictions off the main thread, so the page and its animation stay smooth.
// Loads the shape tables once, and each dataset's models and sequences the first time that dataset is used.

import { DatasetSequences } from "./dataset";
import { type DatasetModel, type ModelFile, parseModel } from "./network";
import { encode, runPrediction } from "./predict";
import { parseTables, type ShapeTables } from "./shape";

const DATA = `${import.meta.env.BASE_URL}data/`;

let tables: Promise<ShapeTables> | null = null;
const models = new Map<string, Promise<DatasetModel>>();
const sequences = new Map<string, Promise<DatasetSequences>>();

async function get(url: string, kind: "json" | "buffer") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (error ${res.status}).`);
  return kind === "json" ? res.json() : res.arrayBuffer();
}

function loadTables() {
  tables ??= get(`${DATA}shape_tables.json`, "json").then(parseTables);
  return tables;
}

function loadModel(slug: string) {
  if (!models.has(slug)) {
    models.set(slug, Promise.all([get(`${DATA}${slug}/model.json`, "json"), get(`${DATA}${slug}/model.bin`, "buffer")])
      .then(([meta, buffer]) => parseModel(meta as ModelFile, buffer as ArrayBuffer)));
  }
  return models.get(slug)!;
}

function loadSequences(slug: string, n: number) {
  if (!sequences.has(slug)) {
    sequences.set(slug, get(`${DATA}${slug}/sequences.bin`, "buffer").then((b) => new DatasetSequences(b as ArrayBuffer, n)));
  }
  return sequences.get(slug)!;
}

export interface WorkerRequest {
  id: number;
  slug: string;
  n: number;
  sequence?: string;          // absent: only load the dataset ahead of time
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, slug, n, sequence } = event.data;
  try {
    const [t, model, data] = await Promise.all([loadTables(), loadModel(slug), loadSequences(slug, n)]);
    if (sequence === undefined) {
      self.postMessage({ id, ok: true, result: null });
      return;
    }
    const result = runPrediction(model, t, data, encode(sequence));
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    models.delete(slug);       // a failed download is tried again next time
    sequences.delete(slug);
    tables = null;
    self.postMessage({ id, ok: false, message: e instanceof Error ? e.message : String(e) });
  }
};
