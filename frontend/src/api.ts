// The data of the site. Everything runs in the browser: the datasets, their sequences and the trained models are
// static files under data/ (written by scripts/export_static.py), and predictions run in a Web Worker
// (engine/worker.ts). The answers are the same as the server's API (backend/morphonup_web/app.py), which is kept
// for reference and tests (backend/tests/check_static_parity.py).

import { DatasetSequences } from "./engine/dataset";
import type { EngineResult } from "./engine/predict";
import type { WorkerRequest } from "./engine/worker";

export type Label = "nucleosomal" | "linker";

export interface Benchmark {
  accuracy: number;
  balanced_accuracy: number;
  mcc: number;
  roc_auc: number;
  pr_auc: number;
  seeds: number;
  accuracy_sd: number | null;
}

export interface DatasetItem {
  slug: string;
  id: string;
  region: string;
  name: string;
  collection: string;
  n: number | null;
  available: boolean;
  positive?: number;
  stage?: string;
  k?: number;
  seed?: number;
  served_accuracy?: number;
  benchmark?: Benchmark | null;
  message?: string;
}

export interface SpeciesGroup {
  species: string;
  common_name: string;
  datasets: DatasetItem[];
}

export interface SequenceItem {
  index: number;
  name: string;
  sequence: string;
  label: Label;
}

export interface SequencePage {
  total: number;
  page: number;
  size: number;
  items: SequenceItem[];
}

export interface Prediction {
  dataset: string;
  sequence: string;
  length: number;
  probability: number;
  probability_forward: number;
  probability_reverse: number;
  label: Label;
  threshold: number;
  model: { kind: string; fold: number | null; k: number; seed: number; stage: string };
  in_dataset: null | { name: string; label: Label; strand: string; copies: number };
  shape: Record<string, (number | null)[]>;
}

export class ApiError extends Error {}

const DATA = `${import.meta.env.BASE_URL}data/`;
const OFFLINE = "The data of this page could not be loaded. Check the internet connection, then reload the page.";

async function fetchData(url: string, kind: "json" | "buffer") {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError(OFFLINE);
  }
  if (!res.ok) throw new ApiError(`${OFFLINE} (Error ${res.status} for ${url.slice(DATA.length)}.)`);
  return kind === "json" ? res.json() : res.arrayBuffer();
}

/** Keeps a promise unless it fails, so a failed download is tried again on the next call. */
function cached<K, V>(make: (key: K) => Promise<V>) {
  const store = new Map<K, Promise<V>>();
  return (key: K) => {
    if (!store.has(key)) {
      const p = make(key);
      store.set(key, p);
      p.catch(() => store.delete(key));
    }
    return store.get(key)!;
  };
}

const groups = cached((_: "all") => fetchData(`${DATA}datasets.json`, "json") as Promise<SpeciesGroup[]>);

async function datasetItem(slug: string): Promise<DatasetItem> {
  for (const g of await groups("all")) {
    const d = g.datasets.find((x) => x.slug === slug);
    if (d) {
      if (!d.available) throw new ApiError(d.message ?? "This dataset is still training.");
      return d;
    }
  }
  throw new ApiError(`No dataset called ${slug}.`);
}

const sequenceFile = cached(async (slug: string) => {
  const d = await datasetItem(slug);
  return new DatasetSequences((await fetchData(`${DATA}${slug}/sequences.bin`, "buffer")) as ArrayBuffer, d.n ?? 0);
});

let lastSearch: { key: string; indices: number[] } | null = null;

async function search(slug: string, label: Label | "all", q: string) {
  const key = `${slug}|${label}|${q}`;
  if (lastSearch?.key !== key) lastSearch = { key, indices: (await sequenceFile(slug)).search(label, q) };
  return lastSearch.indices;
}

function item(data: DatasetSequences, index: number): SequenceItem {
  const row = data.row(index);
  return { index, name: row.name, sequence: data.sequence(index), label: row.label };
}

// ------------------------------------------------------------------ the prediction worker

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EngineResult | null) => void; reject: (e: Error) => void }>();

function engine(request: Omit<WorkerRequest, "id">): Promise<EngineResult | null> {
  if (!worker) {
    worker = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: EngineResult | null; message?: string }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (!job) return;
      if (e.data.ok) job.resolve(e.data.result ?? null);
      else job.reject(new ApiError(e.data.message?.startsWith("Could not load") ? OFFLINE : e.data.message));
    };
    worker.onerror = () => {
      for (const job of pending.values()) job.reject(new ApiError("The prediction could not run in this browser."));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, ...request });
  });
}

export const api = {
  datasets: () => groups("all"),

  sequences: async (slug: string, params: { label: Label | "all"; q: string; page: number; size: number }) => {
    const data = await sequenceFile(slug);
    const indices = await search(slug, params.label, params.q);
    const start = (params.page - 1) * params.size;
    return {
      total: indices.length, page: params.page, size: params.size,
      items: indices.slice(start, start + params.size).map((i) => item(data, i)),
    } satisfies SequencePage;
  },

  random: async (slug: string, label: Label) => {
    const data = await sequenceFile(slug);
    const indices = await search(slug, label, "");
    return item(data, indices[Math.floor(Math.random() * indices.length)]);
  },

  /** Loads a dataset's models and sequences ahead of the first prediction. */
  prepare: async (slug: string) => {
    const d = await datasetItem(slug);
    await engine({ slug, n: d.n ?? 0 });
  },

  predict: async (slug: string, text: string): Promise<Prediction> => {
    const d = await datasetItem(slug);
    const sequence = cleanSequence(text);
    const problem = sequenceProblem(sequence);
    if (problem) throw new ApiError(problem.message);
    const r = (await engine({ slug, n: d.n ?? 0, sequence }))!;
    return {
      dataset: d.id, sequence, length: sequence.length,
      probability: r.probability, probability_forward: r.probability_forward, probability_reverse: r.probability_reverse,
      label: r.label, threshold: 0.5,
      model: {
        kind: r.in_dataset ? "held-out fold model" : "mean of the five fold models",
        fold: r.fold, k: d.k ?? 5, seed: d.seed ?? 0, stage: d.stage ?? "",
      },
      in_dataset: r.in_dataset,
      shape: r.shape,
    };
  },
};

// Same cleaning and messages as shape.py of the server, so mistakes show while typing.
export function cleanSequence(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("")
    .replace(/[\s\d]/g, "")
    .toUpperCase();
}

export function sequenceProblem(seq: string): { message: string; position?: number } | null {
  for (let i = 0; i < seq.length; i++) {
    if (!"ACGT".includes(seq[i])) return { message: `Position ${i + 1} is "${seq[i]}". Use only A, C, G and T.`, position: i };
  }
  if (seq.length !== 147) return { message: `This sequence has ${seq.length} bases. MorphoNup needs exactly 147.` };
  return null;
}

export const percent = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
