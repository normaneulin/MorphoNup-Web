// The MorphoNup network at inference, written out for the browser. It follows morphonup/network.py and
// morphonup/layers.py of the MorphoNup repository layer by layer (dropout is off at inference), with the weights
// exported by scripts/export_static.py. tests/check_static_parity.py checks it against the Keras models.
//
// Inputs follow backend/morphonup_web/inputs.py (a copy of the training loader, morphonup/data.py):
//   one-hot sequence (147 x 4) of each strand, 1-4-mer frequencies (340) scaled by the fold's mean and SD,
//   14 shape tracks at base-pair centres (143 x 14) turned into the fold's 9 physical channels.

import { BP_TRACKS, STEP_TRACKS, type ShapeTables, type TrackName, shapeTracks, windowCodes } from "./shape";

const LEN = 147;
const POSITIONS = 143;                                  // base pairs 2 .. 144
const GEOMETRY_BP = BP_TRACKS.filter((n) => n !== "EP");
const ANTISYMMETRIC = new Set<TrackName>(["Buckle", "Shear", "Shift", "Tilt"]);

// ------------------------------------------------------------------ the exported bundle of one dataset

type TensorEntry = [offset: number, shape: number[]];
interface Prep {
  mean: number[]; std: number[]; explicit: number[];
  blocks: { idx: number[]; rotation: number[][]; score_mean: number[]; score_std: number[] }[];
  kmer_mean: number[]; kmer_std: number[];
}
interface FoldFile {
  fold: number;
  tensors: Record<string, TensorEntry>;
  limits: { bounded_correction: number; statistics_correction: number };
  prep: Prep;
}
export interface ModelFile {
  format: number;
  channels: number;
  groups: number[][];
  motifs: [number, number][];
  kmer_dim: number;
  folds: FoldFile[];
}

export interface FoldModel {
  fold: number;
  w: Record<string, Float32Array>;
  limits: FoldFile["limits"];
  prep: Prep;
}
export interface DatasetModel {
  channels: number;
  groups: number[][];
  motifs: [number, number][];
  folds: FoldModel[];
}

export function parseModel(meta: ModelFile, buffer: ArrayBuffer): DatasetModel {
  if (meta.format !== 1) throw new Error("model bundle: unknown format");
  const all = new Float32Array(buffer);
  const folds = meta.folds.map((f) => {
    const w: Record<string, Float32Array> = {};
    for (const [name, [offset, shape]] of Object.entries(f.tensors)) {
      const size = shape.reduce((a, b) => a * b, 1);
      w[name] = all.subarray(offset, offset + size);
    }
    return { fold: f.fold, w, limits: f.limits, prep: f.prep };
  });
  return { channels: meta.channels, groups: meta.groups, motifs: meta.motifs, folds };
}

// ------------------------------------------------------------------ small numeric helpers

/** erf to double precision: 2/sqrt(pi) e^(-x^2) sum 2^n x^(2n+1) / (1*3*...*(2n+1)), a series with positive terms. */
function erf(x: number): number {
  const ax = Math.abs(x);
  if (ax > 6) return x > 0 ? 1 : -1;
  const x2 = ax * ax;
  let term = ax;
  let sum = ax;
  for (let n = 1; n < 400; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  const r = (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
  return x < 0 ? -r : r;
}

/** Keras "gelu" (approximate=False): 0.5 x (1 + erf(x / sqrt 2)). */
const gelu = (x: number) => 0.5 * x * (1 + erf(x / Math.SQRT2));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** y = x W + b for a Keras Dense kernel (in, out), optionally followed by GELU. */
function dense(x: ArrayLike<number>, kernel: Float32Array, bias: Float32Array, activation?: "gelu"): Float64Array {
  const nIn = x.length;
  const nOut = bias.length;
  if (kernel.length !== nIn * nOut) throw new Error("dense: shape mismatch");
  const y = Float64Array.from(bias);
  for (let i = 0; i < nIn; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * nOut;
    for (let o = 0; o < nOut; o++) y[o] += xi * kernel[row + o];
  }
  if (activation === "gelu") for (let o = 0; o < nOut; o++) y[o] = gelu(y[o]);
  return y;
}

const weightCache = new Map<string, Float64Array>();

/** Gaussian bin weights over positions, each column normalised to sum 1 (DyadPool and MotifStatistics). */
function binWeights(length: number, pos: (l: number) => number, centers: number[], sigma: number): Float64Array {
  const key = `${length}|${pos(0)}|${pos(1)}|${centers.join(",")}|${sigma}`;
  const hit = weightCache.get(key);
  if (hit) return hit;
  const p = centers.length;
  const w = new Float64Array(length * p);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let l = 0; l < length; l++) {
      const z = (pos(l) - centers[j]) / sigma;
      w[l * p + j] = Math.exp(-0.5 * z * z);
      s += w[l * p + j];
    }
    for (let l = 0; l < length; l++) w[l * p + j] /= s;
  }
  weightCache.set(key, w);
  return w;
}

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** DyadPool: mean and max over positions, then seven soft bins (centres -1 .. 1, sigma 0.25 on a -1 .. 1 axis). */
function dyadPool(x: Float64Array, length: number, channels: number): Float64Array {
  const w = binWeights(length, (l) => -1 + (2 * l) / (length - 1), linspace(-1, 1, 7), 0.25);
  const out = new Float64Array(9 * channels);
  for (let c = 0; c < channels; c++) {
    let s = 0;
    let m = -Infinity;
    for (let l = 0; l < length; l++) {
      const v = x[l * channels + c];
      s += v;
      if (v > m) m = v;
    }
    out[c] = s / length;
    out[channels + c] = m;
  }
  for (let l = 0; l < length; l++) {
    for (let p = 0; p < 7; p++) {
      const wl = w[l * 7 + p];
      const base = (2 + p) * channels;
      for (let c = 0; c < channels; c++) out[base + c] += x[l * channels + c] * wl;
    }
  }
  return out;
}

// ------------------------------------------------------------------ inputs

export interface StrandInput {
  codes: Uint8Array;            // 147 bases, A0 C1 G2 T3
  kmersRaw: Float64Array;       // 340 frequencies
  tracks14: Float64Array;       // 143 x 14
}

function kmerFeatures(codes: Uint8Array): Float64Array {
  const out = new Float64Array(340);
  let offset = 0;
  for (let k = 1; k <= 4; k++) {
    const w = windowCodes(codes, k);
    for (let i = 0; i < w.length; i++) out[offset + w[i]] += 1;
    for (let i = 0; i < 4 ** k; i++) out[offset + i] /= w.length;
    offset += 4 ** k;
  }
  return out;
}

function tracks14(native: Record<TrackName, Float64Array>): Float64Array {
  const out = new Float64Array(POSITIONS * 14);
  for (let i = 0; i < POSITIONS; i++) {
    const r = i * 14;
    GEOMETRY_BP.forEach((name, c) => { out[r + c] = native[name][i + 2]; });
    STEP_TRACKS.forEach((name, c) => { out[r + 7 + c] = 0.5 * (native[name][i + 1] + native[name][i + 2]); });
    out[r + 13] = native.EP[i + 2];
  }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) throw new Error("shape tracks: missing value");
  return out;
}

/** Unscaled inputs of the forward strand and its reverse complement, plus the raw tracks (export layout). */
export function rawViews(codes: Uint8Array, tables: ShapeTables) {
  if (codes.length !== LEN) throw new Error("rawViews: a sequence of 147 bases is needed");
  const rc = new Uint8Array(LEN);
  for (let i = 0; i < LEN; i++) rc[i] = 3 - codes[LEN - 1 - i];
  const raw = shapeTracks(codes, tables);
  const nativeRc = {} as Record<TrackName, Float64Array>;
  for (const name of [...BP_TRACKS, ...STEP_TRACKS]) {
    const a = raw[name];
    const sign = ANTISYMMETRIC.has(name) ? -1 : 1;
    nativeRc[name] = Float64Array.from({ length: a.length }, (_, i) => sign * a[a.length - 1 - i]);
  }
  const forward: StrandInput = { codes, kmersRaw: kmerFeatures(codes), tracks14: tracks14(raw) };
  const reverse: StrandInput = { codes: rc, kmersRaw: kmerFeatures(rc), tracks14: tracks14(nativeRc) };
  return { forward, reverse, raw };
}

/** PhysicalReducer.transform of the fold: z-scores, explicit channels, then each PLS block (143 x channels). */
function physics(tracks: Float64Array, prep: Prep, channels: number): Float64Array {
  const out = new Float64Array(POSITIONS * channels);
  const z = new Float64Array(14);
  for (let i = 0; i < POSITIONS; i++) {
    for (let c = 0; c < 14; c++) z[c] = (tracks[i * 14 + c] - prep.mean[c]) / prep.std[c];
    let o = i * channels;
    for (const e of prep.explicit) out[o++] = z[e];
    for (const b of prep.blocks) {
      const k = b.rotation[0].length;
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let r = 0; r < b.idx.length; r++) s += z[b.idx[r]] * b.rotation[r][j];
        out[o++] = (s - b.score_mean[j]) / b.score_std[j];
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ the layers

/** GroupedJointMotifs: PWM match exp(0.7 (score - k)) attenuated by RBF distance to 3-bp shape prototypes. */
function jointMotifs(f: FoldModel, k: number, count: number, codes: Uint8Array, phys: Float64Array, C: number,
                     groups: number[][]): Float64Array {
  const motif = f.w[`motifs_${k}.motif`];
  const centers = f.w[`motifs_${k}.centers`];
  const widths = f.w[`motifs_${k}.widths`];
  const strength = f.w[`motifs_${k}.strength`][0];
  const L = 148 - k;
  const crop = Math.floor(k / 2) - 3;
  const out = new Float64Array(L * count);
  const inv = groups.map((g, i) => 1 / (3 * g.length * widths[i] * widths[i]));
  for (let l = 0; l < L; l++) {
    for (let m = 0; m < count; m++) {
      let score = 0;
      for (let t = 0; t < k; t++) score += motif[(m * k + t) * 4 + codes[l + t]];
      let total = 0;
      for (let g = 0; g < groups.length; g++) {
        let d = 0;
        for (let t = 0; t < 3; t++) {
          const row = (crop + l + t) * C;
          const crow = (m * 3 + t) * C;
          for (const c of groups[g]) {
            const diff = phys[row + c] - centers[crow + c];
            d += diff * diff;
          }
        }
        total += Math.max(d, 0) * inv[g];
      }
      out[l * count + m] = Math.exp(0.7 * (score - k)) * Math.exp((-strength * total) / groups.length);
    }
  }
  return out;
}

/** The physical adapter: a bounded correction of the anchor logit from local shape, moments and Gabor energies. */
function adapter(f: FoldModel, phys: Float64Array, C: number, groups: number[][], anchor: number,
                 embedding: Float64Array): number {
  const local = new Float64Array(POSITIONS * 4 * groups.length);
  const width = 4 * groups.length;
  groups.forEach((idx, j) => {
    const kernel = f.w[`local_group_${j}.kernel`];   // (5, g, 4)
    const bias = f.w[`local_group_${j}.bias`];
    const g = idx.length;
    for (let l = 0; l < POSITIONS; l++) {
      for (let o = 0; o < 4; o++) {
        let s = bias[o];
        for (let t = 0; t < 5; t++) {
          const p = l + t - 2;                          // "same" padding with zeros
          if (p < 0 || p >= POSITIONS) continue;
          for (let ci = 0; ci < g; ci++) s += phys[p * C + idx[ci]] * kernel[(t * g + ci) * 4 + o];
        }
        local[l * width + 4 * j + o] = gelu(s);
      }
    }
  });
  const pooled = dyadPool(local, POSITIONS, width);

  const moments = new Float64Array(2 * C);              // mean and population SD of each channel
  for (let c = 0; c < C; c++) {
    let s = 0;
    for (let l = 0; l < POSITIONS; l++) s += phys[l * C + c];
    const mean = s / POSITIONS;
    let v = 0;
    for (let l = 0; l < POSITIONS; l++) v += (phys[l * C + c] - mean) ** 2;
    moments[c] = mean;
    moments[C + c] = Math.sqrt(v / POSITIONS);
  }

  const kernel = f.w["gabor.kernel"];                   // (61, 8): column 2 * filter + (cos, sin)
  const gabor = new Float64Array(8 * C);
  const reflect = (i: number) => (i < 0 ? -i : i >= POSITIONS ? 2 * (POSITIONS - 1) - i : i);
  for (let c = 0; c < C; c++) {
    const mean = new Float64Array(4);
    const max = new Float64Array(4).fill(-Infinity);
    for (let l = 0; l < POSITIONS; l++) {
      const r = new Float64Array(8);
      for (let t = 0; t < 61; t++) {
        const v = phys[reflect(l + t - 30) * C + c];
        for (let q = 0; q < 8; q++) r[q] += v * kernel[t * 8 + q];
      }
      for (let q = 0; q < 4; q++) {
        const e = Math.log1p(r[2 * q] * r[2 * q] + r[2 * q + 1] * r[2 * q + 1]);
        mean[q] += e / POSITIONS;
        if (e > max[q]) max[q] = e;
      }
    }
    for (let q = 0; q < 4; q++) {
      gabor[c * 8 + q] = mean[q];
      gabor[c * 8 + 4 + q] = max[q];
    }
  }

  const context = dense(concat([pooled, moments, gabor]), f.w["context_embedding.kernel"], f.w["context_embedding.bias"], "gelu");
  const delta = dense(concat([context, embedding]), f.w["zero_output.kernel"], f.w["zero_output.bias"])[0];
  const limit = f.limits.bounded_correction;
  return anchor + f.w["bounded_correction.gate"][0] * limit * Math.tanh(delta / limit);
}

/** MotifStatistics + Normalization + StatisticsByWord + shared Dense(4) + readout: a bounded logit correction. */
function statisticsDelta(f: FoldModel, codes: Uint8Array): number {
  const stats = new Float64Array(800);
  let offset = 0;
  for (const k of [2, 3]) {
    const words = 4 ** k;
    const L = 148 - k;
    const w = windowCodes(codes, k);
    const bins = binWeights(L, (l) => l + (k - 1) / 2 - 73, linspace(-63, 63, 7), 12);
    for (let l = 0; l < L; l++) for (let j = 0; j < 7; j++) stats[offset + j * words + w[l]] += bins[l * 7 + j];
    offset += 7 * words;
    for (const period of [10, 11, 12]) {
      for (const multiple of [1, 2, 3, 4]) {
        const lag = period * multiple;
        const n = L - lag;
        const ca = new Float64Array(words);
        const cb = new Float64Array(words);
        const cab = new Float64Array(words);
        for (let l = 0; l < n; l++) {
          ca[w[l]] += 1;
          cb[w[l + lag]] += 1;
          if (w[l] === w[l + lag]) cab[w[l]] += 1;
        }
        for (let c = 0; c < words; c++) {
          const ma = ca[c] / n;
          const mb = cb[c] / n;
          const cov = cab[c] / n - ma * mb;
          const variance = ma * (1 - ma) * mb * (1 - mb);
          stats[offset + c] += cov / Math.sqrt(variance + 1e-6) / 4;
        }
      }
      offset += words;
    }
  }
  const mean = f.w["statistics.mean"];
  const denom = f.w["statistics.denominator"];
  for (let i = 0; i < 800; i++) stats[i] = (stats[i] - mean[i]) / denom[i];

  const kernel = f.w["shared_statistic_encoder.kernel"];   // (10, 4)
  const bias = f.w["shared_statistic_encoder.bias"];
  const encoded = new Float64Array(320);
  let word = 0;
  let start = 0;
  for (const count of [16, 64]) {
    for (let c = 0; c < count; c++, word++) {
      for (let u = 0; u < 4; u++) {
        let s = bias[u];
        for (let d = 0; d < 10; d++) s += stats[start + d * count + c] * kernel[d * 4 + u];
        encoded[word * 4 + u] = gelu(s);
      }
    }
    start += 10 * count;
  }
  return dense(encoded, f.w["statistics_readout.kernel"], f.w["statistics_readout.bias"])[0];
}

function concat(parts: Float64Array[]): Float64Array {
  const out = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Probability (sigmoid of the corrected logit) of one strand under one fold model. */
export function foldProbability(model: DatasetModel, f: FoldModel, input: StrandInput): number {
  const { channels: C, groups } = model;
  const phys = physics(input.tracks14, f.prep, C);
  const pools: Float64Array[] = [];
  for (const [k, count] of model.motifs) {
    pools.push(dyadPool(jointMotifs(f, k, count, input.codes, phys, C, groups), 148 - k, count));
  }
  const kmers = new Float64Array(340);
  for (let i = 0; i < 340; i++) kmers[i] = (input.kmersRaw[i] - f.prep.kmer_mean[i]) / f.prep.kmer_std[i];
  pools.push(dense(kmers, f.w["composition.kernel"], f.w["composition.bias"], "gelu"));
  const h = concat(pools);
  const scale = f.w["bn.scale"];
  const shift = f.w["bn.shift"];
  for (let i = 0; i < h.length; i++) h[i] = h[i] * scale[i] + shift[i];
  const embedding = dense(h, f.w["joint_embedding.kernel"], f.w["joint_embedding.bias"], "gelu");
  const anchor = dense(embedding, f.w["joint_logit.kernel"], f.w["joint_logit.bias"])[0];
  const corrected = adapter(f, phys, C, groups, anchor, embedding);
  const limit = f.limits.statistics_correction;
  const delta = statisticsDelta(f, input.codes);
  return sigmoid(corrected + f.w["statistics_correction.gate"][0] * limit * Math.tanh(delta / limit));
}

/** p_fwd, p_rc for one sequence: the held-out fold model (fold > 0) or the mean of all fold models (fold = 0). */
export function predictCodes(model: DatasetModel, tables: ShapeTables, codes: Uint8Array, fold: number) {
  const { forward, reverse, raw } = rawViews(codes, tables);
  const use = fold > 0 ? model.folds.filter((f) => f.fold === fold) : model.folds;
  if (!use.length) throw new Error(`fold ${fold} is not in the bundle`);
  let pf = 0;
  let pr = 0;
  for (const f of use) {
    pf += foldProbability(model, f, forward) / use.length;
    pr += foldProbability(model, f, reverse) / use.length;
  }
  return { p_fwd: pf, p_rc: pr, p: 0.5 * (pf + pr), raw };
}
