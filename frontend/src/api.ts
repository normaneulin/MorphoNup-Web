// The data of the site. Everything runs in the browser: the datasets, their sequences and the trained models are
// static files under data/ (written by scripts/export_static.py), and predictions run in a Web Worker
// (engine/worker.ts). The answers are the same as the server's API (backend/morphonup_web/app.py), which is kept
// for reference and tests (backend/tests/check_static_parity.py).

import { DatasetSequences } from "./engine/dataset";
import { download, downloadJson } from "./engine/download";
import { encode, findRow, type Scores } from "./engine/predict";
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
const OFFLINE = "The data of this page could not be loaded. Check the internet connection, then try again.";

/** Downloads with the stall limit of engine/download.ts; any failure becomes one plain message. */
async function fetchData<T>(url: string, kind: "json" | "buffer"): Promise<T> {
  try {
    return (kind === "json" ? await downloadJson<T>(url) : await download(url)) as T;
  } catch {
    throw new ApiError(OFFLINE);
  }
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

const groups = cached((_: "all") => fetchData<SpeciesGroup[]>(`${DATA}datasets.json`, "json"));

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

// The sequences of a dataset are downloaded once, here on the page: the browser, the examples and the check whether an
// entered sequence belongs to the dataset all use this copy (the worker only needs the models).
const sequenceFile = cached(async (slug: string) => {
  const d = await datasetItem(slug);
  return new DatasetSequences(await fetchData<ArrayBuffer>(`${DATA}${slug}/sequences.bin`, "buffer"), d.n ?? 0);
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

export interface Progress { slug: string; loaded: number; total: number }
const progressListeners = new Set<(p: Progress) => void>();

const SILENCE_MS = 40000;    // a worker that sends nothing (no progress, no answer) for this long is restarted
let worker: Worker | null = null;
let nextId = 1;
let lastHeard = 0;
let watchdog = 0;
const pending = new Map<number, { resolve: (r: Scores | null) => void; reject: (e: Error) => void }>();

function stopWorker(message: string) {
  for (const job of pending.values()) job.reject(new ApiError(message));
  pending.clear();
  worker?.terminate();
  worker = null;
  window.clearInterval(watchdog);
  watchdog = 0;
}

function engine(request: Omit<WorkerRequest, "id">): Promise<Scores | null> {
  if (!worker) {
    worker = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id?: number; ok?: boolean; result?: Scores | null; message?: string;
                                          progress?: Progress }>) => {
      lastHeard = Date.now();
      if (e.data.progress) {
        progressListeners.forEach((f) => f(e.data.progress!));
        return;
      }
      const job = pending.get(e.data.id!);
      pending.delete(e.data.id!);
      if (!job) return;
      if (e.data.ok) job.resolve(e.data.result ?? null);
      else job.reject(new ApiError(e.data.message?.startsWith("Could not load") ? OFFLINE : e.data.message));
    };
    worker.onerror = () => stopWorker("The prediction could not start. Reload the page, then try again.");
  }
  if (!watchdog) {
    watchdog = window.setInterval(() => {
      if (pending.size && Date.now() - lastHeard > SILENCE_MS) {
        stopWorker("The prediction is taking too long, probably because of a slow connection. Try again.");
      }
    }, 2000);
  }
  if (!pending.size) lastHeard = Date.now();
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

  /** Starts loading a dataset's sequences (here) and models (in the worker) before the first prediction. */
  prepare: async (slug: string) => {
    await datasetItem(slug);
    await Promise.all([
      sequenceFile(slug).then((data) => { window.setTimeout(() => data.lookup(new Uint8Array(147)), 0); }),   // builds the index
      engine({ slug }),
    ]);
  },

  /** Download progress of a dataset's models, for the scanner caption. Returns the function that stops listening. */
  onProgress: (listener: (p: Progress) => void) => {
    progressListeners.add(listener);
    return () => { progressListeners.delete(listener); };
  },

  predict: async (slug: string, text: string): Promise<Prediction> => {
    const d = await datasetItem(slug);
    const sequence = cleanSequence(text);
    const problem = sequenceProblem(sequence);
    if (problem) throw new ApiError(problem.message);
    engine({ slug }).catch(() => undefined);                 // the models download while the sequences do
    const match = findRow(await sequenceFile(slug), encode(sequence));
    const scores = (await engine({ slug, sequence, fold: match.fold ?? 0 }))!;
    return {
      dataset: d.id, sequence, length: sequence.length,
      probability: scores.probability, probability_forward: scores.probability_forward,
      probability_reverse: scores.probability_reverse, label: scores.label, threshold: 0.5,
      model: {
        kind: match.in_dataset ? "held-out fold model" : "mean of the five fold models",
        fold: match.fold, k: d.k ?? 5, seed: d.seed ?? 0, stage: d.stage ?? "",
      },
      in_dataset: match.in_dataset,
      shape: scores.shape,
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
