// Runs the browser engine (src/engine) in Node on a list of cases, for backend/tests/check_static_parity.py.
//   node engine-cli.mjs cases.json <data dir>   ->   JSON results on stdout
// cases.json: [{ "slug": ..., "n": ..., "sequence": ... }, ...]
import { readFileSync } from "node:fs";
import { DatasetSequences } from "../src/engine/dataset";
import { type ModelFile, parseModel } from "../src/engine/network";
import { encode, runPrediction } from "../src/engine/predict";
import { parseTables } from "../src/engine/shape";

const [casesPath, dataDir] = process.argv.slice(2);
const cases: { slug: string; n: number; sequence: string }[] = JSON.parse(readFileSync(casesPath, "utf8"));
const buffer = (path: string) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const tables = parseTables(JSON.parse(readFileSync(`${dataDir}/shape_tables.json`, "utf8")));
const loaded = new Map<string, { model: ReturnType<typeof parseModel>; data: DatasetSequences }>();
const results = [];
const t0 = performance.now();
for (const c of cases) {
  if (!loaded.has(c.slug)) {
    const meta = JSON.parse(readFileSync(`${dataDir}/${c.slug}/model.json`, "utf8")) as ModelFile;
    loaded.set(c.slug, {
      model: parseModel(meta, buffer(`${dataDir}/${c.slug}/model.bin`)),
      data: new DatasetSequences(buffer(`${dataDir}/${c.slug}/sequences.bin`), c.n),
    });
  }
  const { model, data } = loaded.get(c.slug)!;
  results.push(runPrediction(model, tables, data, encode(c.sequence)));
}
process.stdout.write(JSON.stringify({ seconds: (performance.now() - t0) / 1000, results }));
