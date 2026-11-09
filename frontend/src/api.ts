// Typed calls to the MorphoNup API (backend/morphonup_web/app.py). In development Vite forwards /api to :8000.

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
  saved_probability: number;
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
  in_dataset: null | { name: string; label: Label; strand: string; saved_probability: number; copies: number };
  shape: Record<string, (number | null)[]>;
}

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("The MorphoNup server cannot be reached. Check that it is running, then try again.");
  }
  if (!res.ok) {
    let detail = `The server answered with error ${res.status}.`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  datasets: () => request<SpeciesGroup[]>("/api/datasets"),
  sequences: (slug: string, params: { label: Label | "all"; q: string; page: number; size: number }) =>
    request<SequencePage>(
      `/api/datasets/${slug}/sequences?` +
        new URLSearchParams({ label: params.label, q: params.q, page: String(params.page), size: String(params.size) }),
    ),
  random: (slug: string, label: Label) => request<SequenceItem>(`/api/datasets/${slug}/random?label=${label}`),
  predict: (slug: string, sequence: string) =>
    request<Prediction>("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataset: slug, sequence }),
    }),
};

// Same cleaning and messages as the server (shape.py), so mistakes show while typing.
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
