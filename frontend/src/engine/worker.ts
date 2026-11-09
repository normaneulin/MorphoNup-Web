// Runs predictions off the main thread, so the page and its animation stay smooth.
// Loads the shape tables once and each dataset's models the first time that dataset is used, and reports download
// progress, so the page can say what it is waiting for. The page finds the dataset row and sends the fold to use.

import { download, downloadJson } from "./download";
import { type DatasetModel, type ModelFile, parseModel } from "./network";
import { encode, score } from "./predict";
import { parseTables, type ShapeTables } from "./shape";

const DATA = `${import.meta.env.BASE_URL}data/`;

let tables: Promise<ShapeTables> | null = null;
const models = new Map<string, Promise<DatasetModel>>();

function loadTables() {
  tables ??= downloadJson<Parameters<typeof parseTables>[0]>(`${DATA}shape_tables.json`).then(parseTables);
  return tables;
}

function loadModel(slug: string) {
  if (!models.has(slug)) {
    const progress = (loaded: number, total: number) => self.postMessage({ progress: { slug, loaded, total } });
    models.set(slug, Promise.all([downloadJson<ModelFile>(`${DATA}${slug}/model.json`), download(`${DATA}${slug}/model.bin`, progress)])
      .then(([meta, buffer]) => parseModel(meta, buffer)));
  }
  return models.get(slug)!;
}

export interface WorkerRequest {
  id: number;
  slug: string;
  sequence?: string;          // absent: only load the dataset's models ahead of time
  fold?: number;              // the held-out fold model of a dataset sequence; 0 = the mean of all fold models
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, slug, sequence, fold = 0 } = event.data;
  try {
    const [t, model] = await Promise.all([loadTables(), loadModel(slug)]);
    const result = sequence === undefined ? null : score(model, t, encode(sequence), fold);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    models.delete(slug);       // a failed download is tried again next time
    tables = null;
    self.postMessage({ id, ok: false, message: e instanceof Error ? e.message : String(e) });
  }
};
