// DNA shape by table lookup, the same as backend/morphonup_web/shape.py (which reproduces the DNAshapeR exports).
//   base-pair tracks: the value at base i comes from the pentamer i-2 .. i+2; the first and last two bases have none;
//   step tracks: step j (bases j, j+1) comes from the hexamer j-2 .. j+3; step 1 and step L-3 use their own pentamer
//   tables ("left", "right"); the first and last steps have none.
// Tables hold hundredths (the precision of the exports). Layout = the export files: L values per base-pair track,
// L - 1 per step track, NaN where DNAshapeR writes NA.

export const BP_TRACKS = ["Buckle", "EP", "MGW", "Opening", "ProT", "Shear", "Stagger", "Stretch"] as const;
export const STEP_TRACKS = ["HelT", "Rise", "Roll", "Shift", "Slide", "Tilt"] as const;
export type TrackName = (typeof BP_TRACKS)[number] | (typeof STEP_TRACKS)[number];

const MISSING = -32768;

export interface ShapeTables {
  pentamer: Record<string, Int32Array>;
  hexamer: Record<string, Int32Array>;
  left: Record<string, Int32Array>;
  right: Record<string, Int32Array>;
}

interface TablesFile {
  scale: number;
  tracks: Record<string, Record<string, number[]>>;
}

export function parseTables(file: TablesFile): ShapeTables {
  if (file.scale !== 100) throw new Error("shape tables: unexpected scale");
  const t: ShapeTables = { pentamer: {}, hexamer: {}, left: {}, right: {} };
  for (const name of BP_TRACKS) t.pentamer[name] = Int32Array.from(file.tracks[name].pentamer);
  for (const name of STEP_TRACKS) {
    t.hexamer[name] = Int32Array.from(file.tracks[name].hexamer);
    t.left[name] = Int32Array.from(file.tracks[name].left);
    t.right[name] = Int32Array.from(file.tracks[name].right);
  }
  return t;
}

/** Codes of all k-base windows; the first base is the most significant digit (as window_codes in shape.py). */
export function windowCodes(codes: ArrayLike<number>, k: number): Int32Array {
  const width = codes.length - k + 1;
  const out = new Int32Array(width);
  for (let i = 0; i < width; i++) {
    let c = 0;
    for (let o = 0; o < k; o++) c = 4 * c + codes[i + o];
    out[i] = c;
  }
  return out;
}

function value(table: Int32Array, code: number): number {
  const h = table[code];
  if (h === MISSING) throw new Error("A window of this sequence is missing from the shape tables.");
  return h / 100;
}

/** The 14 DNAshapeR tracks of one encoded sequence (A0 C1 G2 T3). */
export function shapeTracks(codes: ArrayLike<number>, tables: ShapeTables): Record<TrackName, Float64Array> {
  const L = codes.length;
  const p5 = windowCodes(codes, 5);
  const p6 = windowCodes(codes, 6);
  const out = {} as Record<TrackName, Float64Array>;
  for (const name of BP_TRACKS) {
    const arr = new Float64Array(L).fill(NaN);
    for (let i = 2; i < L - 2; i++) arr[i] = value(tables.pentamer[name], p5[i - 2]);
    out[name] = arr;
  }
  for (const name of STEP_TRACKS) {
    const arr = new Float64Array(L - 1).fill(NaN);
    arr[1] = value(tables.left[name], p5[0]);
    arr[L - 3] = value(tables.right[name], p5[p5.length - 1]);
    for (let j = 2; j < L - 3; j++) arr[j] = value(tables.hexamer[name], p6[j - 2]);
    out[name] = arr;
  }
  return out;
}
