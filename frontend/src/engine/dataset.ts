// The sequences of one dataset, read from <slug>/sequences.bin (layout in scripts/export_static.py):
//   uint32 name number x n | uint8 label (bit 0) and fold (bits 1..4) x n | 37 bytes per sequence, 2 bits per base.

export type Label = "nucleosomal" | "linker";

export interface Row {
  index: number;
  name: string;
  label: Label;
  fold: number;
}

const BASES = "ACGT";
const PACKED = 37;

export class DatasetSequences {
  readonly n: number;
  private numbers: Uint32Array;
  private meta: Uint8Array;
  private packed: Uint8Array;
  private canonIndex: Map<string, number[]> | null = null;
  private joined: string | null = null;

  constructor(buffer: ArrayBuffer, n: number) {
    if (buffer.byteLength !== 42 * n) throw new Error("sequences.bin: unexpected size");
    this.n = n;
    this.numbers = new Uint32Array(buffer, 0, n);
    this.meta = new Uint8Array(buffer, 4 * n, n);
    this.packed = new Uint8Array(buffer, 5 * n, PACKED * n);
  }

  label(i: number): Label {
    return this.meta[i] & 1 ? "nucleosomal" : "linker";
  }

  row(i: number): Row {
    const label = this.label(i);
    return { index: i, name: `${label}_sequence_${this.numbers[i]}`, label, fold: this.meta[i] >> 1 };
  }

  codes(i: number): Uint8Array {
    const out = new Uint8Array(147);
    const base = i * PACKED;
    for (let b = 0; b < 147; b++) out[b] = (this.packed[base + (b >> 2)] >> (2 * (b & 3))) & 3;
    return out;
  }

  sequence(i: number): string {
    let s = "";
    for (const c of this.codes(i)) s += BASES[c];
    return s;
  }

  /** Dataset rows of a sequence, matched on the strand that comes first alphabetically (as `canon` in the server). */
  lookup(codes: Uint8Array): { rows: number[]; same: number[] } {
    const index = this.buildIndex();
    const rows = index.get(canonKey(codes)) ?? [];
    const key = packKey(codes);
    return { rows, same: rows.filter((i) => packKey(this.codes(i)) === key) };
  }

  /** Indices in dataset order matching a label and a search text: a piece of sequence, or words of the name. */
  search(label: Label | "all", q: string): number[] {
    const out: number[] = [];
    const text = q.trim();
    const bySequence = text.length > 0 && /^[ACGTacgt]+$/.test(text);
    const needle = bySequence ? text.toUpperCase() : "";
    const words = bySequence ? [] : text.toLowerCase().split(/[_\s]+/).filter(Boolean);   // every word must appear
    let positions: Set<number> | null = null;
    if (bySequence) {
      const joined = this.joinedSequences();
      positions = new Set<number>();
      for (let at = joined.indexOf(needle); at >= 0; at = joined.indexOf(needle, at + 1)) positions.add(Math.floor(at / 148));
    }
    for (let i = 0; i < this.n; i++) {
      if (label !== "all" && this.label(i) !== label) continue;
      if (positions && !positions.has(i)) continue;
      if (words.length) {
        const name = `${this.label(i)} sequence ${this.numbers[i]}`;
        if (!words.every((w) => name.includes(w))) continue;
      }
      out.push(i);
    }
    return out;
  }

  private buildIndex(): Map<string, number[]> {
    if (this.canonIndex) return this.canonIndex;
    const index = new Map<string, number[]>();
    for (let i = 0; i < this.n; i++) {
      const key = canonKey(this.codes(i));
      const list = index.get(key);
      if (list) list.push(i);
      else index.set(key, [i]);
    }
    this.canonIndex = index;
    return index;
  }

  private joinedSequences(): string {
    if (this.joined === null) {
      const parts: string[] = [];
      for (let i = 0; i < this.n; i++) parts.push(this.sequence(i));
      this.joined = parts.join("|");             // 147 bases + a separator: sequence i starts at 148 i
    }
    return this.joined;
  }
}

export function reverseComplement(codes: Uint8Array): Uint8Array {
  const rc = new Uint8Array(codes.length);
  for (let i = 0; i < codes.length; i++) rc[i] = 3 - codes[codes.length - 1 - i];
  return rc;
}

/** A compact string key of a sequence (2 bits per base). */
function packKey(codes: Uint8Array): string {
  let s = "";
  for (let b = 0; b < codes.length; b += 4) {
    let v = 0;
    for (let j = 0; j < 4 && b + j < codes.length; j++) v |= codes[b + j] << (2 * j);
    s += String.fromCharCode(v);
  }
  return s;
}

/** Key of the alphabetically smaller of the sequence and its reverse complement (A < C < G < T = code order). */
function canonKey(codes: Uint8Array): string {
  const rc = reverseComplement(codes);
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] !== rc[i]) return packKey(codes[i] < rc[i] ? codes : rc);
  }
  return packKey(codes);
}
