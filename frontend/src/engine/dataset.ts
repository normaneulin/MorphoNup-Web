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

  /** Dataset rows equal to the sequence or to its reverse complement (the server matches the same pairs through the
   *  alphabetically first strand, `canon`), and those equal to the sequence itself. A direct scan of the packed bytes:
   *  a few milliseconds even for 157,448 sequences, with no index to build. */
  lookup(codes: Uint8Array): { rows: number[]; same: number[] } {
    const fwd = pack(codes);
    const rc = pack(reverseComplement(codes));
    const rows: number[] = [];
    const same: number[] = [];
    const data = this.packed;
    for (let i = 0, base = 0; i < this.n; i++, base += PACKED) {
      let isFwd = true;
      let isRc = true;
      for (let b = 0; b < PACKED && (isFwd || isRc); b++) {
        const v = data[base + b];
        if (v !== fwd[b]) isFwd = false;
        if (v !== rc[b]) isRc = false;
      }
      if (isFwd || isRc) rows.push(i);
      if (isFwd) same.push(i);
    }
    return { rows, same };
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

  private joinedSequences(): string {
    if (this.joined === null) {
      // every packed byte is 4 bases: decode through a 256-entry table into one ASCII buffer, then one string
      const out = new Uint8Array(this.n * 148);
      const letters = [65, 67, 71, 84];              // A C G T
      const table = new Uint8Array(256 * 4);
      for (let v = 0; v < 256; v++) for (let j = 0; j < 4; j++) table[v * 4 + j] = letters[(v >> (2 * j)) & 3];
      for (let i = 0; i < this.n; i++) {
        const src = i * PACKED;
        const dst = i * 148;
        for (let b = 0; b < PACKED; b++) {
          const t = this.packed[src + b] * 4;
          const at = dst + b * 4;
          out[at] = table[t];
          if (b * 4 + 1 < 147) out[at + 1] = table[t + 1];
          if (b * 4 + 2 < 147) out[at + 2] = table[t + 2];
          if (b * 4 + 3 < 147) out[at + 3] = table[t + 3];
        }
        out[dst + 147] = 124;                         // "|": sequence i starts at 148 i
      }
      this.joined = new TextDecoder("latin1").decode(out);
    }
    return this.joined;
  }
}

export function reverseComplement(codes: Uint8Array): Uint8Array {
  const rc = new Uint8Array(codes.length);
  for (let i = 0; i < codes.length; i++) rc[i] = 3 - codes[codes.length - 1 - i];
  return rc;
}

/** 2 bits per base, as in sequences.bin (base i in byte i / 4, bits 2 (i % 4)); 147 bases -> 37 bytes. */
function pack(codes: Uint8Array): Uint8Array {
  const out = new Uint8Array(PACKED);
  for (let b = 0; b < codes.length; b++) out[b >> 2] |= codes[b] << (2 * (b & 3));
  return out;
}
