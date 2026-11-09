import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Prediction, SpeciesGroup } from "../api";
import { api, ApiError, cleanSequence, sequenceProblem } from "../api";
import { ChromatinScanner, type ScanPhase } from "../components/ChromatinScanner";
import { Collapse } from "../components/Collapse";
import { Modal } from "../components/Modal";
import { DatasetSlides } from "../components/Picker";
import { Result } from "../components/Result";
import { DatasetBrowser, SequenceInput } from "../components/SequencePanel";
import { SpeciesCarousel } from "../components/SpeciesCarousel";

export default function Predict() {
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState<SpeciesGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [species, setSpecies] = useState("");
  const [text, setText] = useState(params.get("seq") ?? "");
  const [tried, setTried] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [pending, setPending] = useState<Prediction | null>(null);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [example, setExample] = useState<"nucleosomal" | "linker" | null>(null);   // an example is being loaded
  const [download, setDownload] = useState<string | null>(null);                   // model download, for the scanner
  const pendingRef = useRef<Prediction | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const autoRun = useRef(Boolean(params.get("dataset") && params.get("seq")));
  const slug = params.get("dataset") ?? "";

  useEffect(() => {
    api.datasets().then(setGroups).catch((e: ApiError) => setLoadError(e.message));
  }, []);

  const all = useMemo(() => groups?.flatMap((g) => g.datasets.map((d) => ({ ...d, species: g.species }))) ?? [], [groups]);
  const dataset = all.find((d) => d.slug === slug && d.available);

  // first visit: the human benchmark, the dataset of the paper's analyses
  useEffect(() => {
    if (!groups) return;
    if (dataset) setSpecies(dataset.species);
    else {
      const first = all.find((d) => d.available);
      if (first) {
        setSpecies(first.species);
        setParams((p) => ({ ...Object.fromEntries(p), dataset: first.slug }), { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  // load the chosen dataset's models and sequences in the background, so the first prediction is quick
  useEffect(() => {
    if (dataset) api.prepare(dataset.slug).catch(() => undefined);   // a failure shows when predicting
  }, [dataset?.slug]);

  // while the models download, the scanner says so (on a slow connection this is what the prediction waits for)
  useEffect(() => api.onProgress(({ slug: s, loaded, total }) => {
    if (s !== slug) return;
    const mb = (x: number) => (x / 1e6).toFixed(1);
    setDownload(total && loaded < total ? `Downloading the models of this dataset (${mb(loaded)} of ${mb(total)} MB)` : null);
  }), [slug]);

  const reset = () => {
    setPhase("idle");
    setPending(null);
    pendingRef.current = null;
    setResult(null);
    setError(null);
  };
  const chooseDataset = (s: string) => {
    reset();
    setParams((p) => {
      const next = Object.fromEntries(p);
      if (s) next.dataset = s;
      else delete next.dataset;
      return next;
    }, { replace: true });
  };
  const chooseSpecies = (s: string) => {
    setSpecies(s);
    const first = all.find((d) => d.species === s && d.available);
    chooseDataset(first ? first.slug : "");
  };

  const predict = async (sequenceText = text) => {
    setTried(true);
    setError(null);
    const seq = cleanSequence(sequenceText);
    if (!dataset) return setError("Choose a dataset first.");
    if (!seq) return setError("Paste a sequence, or pick one of the sequences from this dataset.");
    const problem = sequenceProblem(seq);
    if (problem) return setError(problem.message);
    setResult(null);
    setPending(null);
    pendingRef.current = null;
    setEditing(false);
    setPhase("scanning");
    if (window.matchMedia("(max-width: 1023px)").matches) {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try {
      const r = await api.predict(dataset.slug, seq);
      pendingRef.current = r;
      setPending(r);                                          // the scanner now knows where to land
    } catch (e) {
      setPhase("idle");
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const landed = () => {
    setResult(pendingRef.current);
    setPhase("done");
  };

  useEffect(() => {
    if (autoRun.current && dataset) {
      autoRun.current = false;
      predict(params.get("seq") ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  const use = (sequence: string) => {
    setText(sequence);
    setTried(false);
    reset();
  };
  const newSequence = () => {
    use("");
    setEditing(false);
    window.setTimeout(() => document.getElementById("sequence")?.focus(), 360);
  };
  const random = async (label: "nucleosomal" | "linker") => {
    if (!dataset || example) return;
    setExample(label);
    setError(null);
    try {
      use((await api.random(dataset.slug, label)).sequence);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setExample(null);
    }
  };

  if (loadError)
    return (
      <div className="wrap page-head">
        <h1>Predict a sequence</h1>
        <p className="problem">{loadError}</p>
      </div>
    );

  const current = groups?.find((g) => g.species === species);
  const inputOpen = phase === "idle" || editing;
  const cleaned = cleanSequence(text);
  const summary = cleaned.length > 40 ? `${cleaned.slice(0, 28)}…${cleaned.slice(-8)}` : cleaned;
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Predict a sequence</h1>
        <p className="muted">
          MorphoNup reads a 147-bp DNA sequence and its predicted shape, and says whether the sequence is likely to wrap
          around a histone (nucleosomal) or to lie between nucleosomes (linker).
        </p>
      </div>
      <div className="predict-grid">
        <section className="choose" aria-label="Species and dataset">
          <div className="choose-block">
            <h2>Species</h2>
            {groups && species ? (
              <SpeciesCarousel groups={groups} value={species} onChange={chooseSpecies} />
            ) : (
              <p className="muted">Loading…</p>
            )}
          </div>
          {current && (
            <div className="choose-block">
              <h2>Dataset</h2>
              <DatasetSlides datasets={current.datasets} value={slug} onChange={chooseDataset} />
              {!current.datasets.some((d) => d.available) && (
                <p className="muted small">
                  The {current.common_name} datasets are still training. Their models will be added when the 5-fold runs
                  finish; choose another species to try MorphoNup now.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="predict-col">
          <section className="predictor" ref={panelRef} aria-label="MorphoNup predictor">
            <ChromatinScanner phase={phase} target={pending ? pending.label : null} onLanded={landed} note={download} />
            <div className="predictor-body">
              {/* after Predict, the input folds into one line so the result is in view */}
              <Collapse open={!inputOpen}>
                <div className="predictor-summary">
                  <div className="summary-text">
                    <span className="small muted">Sequence{dataset ? `, ${dataset.name} (${dataset.collection})` : ""}</span>
                    <span className="mono summary-seq">{summary}</span>
                  </div>
                  <div className="summary-actions">
                    <button type="button" className="btn-quiet" disabled={phase === "scanning"} onClick={() => setEditing(true)}>
                      Edit sequence
                    </button>
                    <button type="button" className="btn btn-small" disabled={phase === "scanning"} onClick={newSequence}>
                      New sequence
                    </button>
                  </div>
                </div>
              </Collapse>
              <Collapse open={inputOpen}>
                <div className="predictor-input">
                  <div className="predictor-head">
                    <h2>Sequence</h2>
                    {dataset && <span className="small muted">{dataset.name}, {dataset.collection}</span>}
                  </div>
                  <SequenceInput text={text} onText={(t) => { setText(t); reset(); }} showLengthError={tried} />
                  <div className="seq-actions">
                    <button type="button" className="btn-quiet" disabled={!dataset || example !== null} onClick={() => random("nucleosomal")}>
                      {example === "nucleosomal" ? "Loading the dataset…" : "A nucleosomal example"}
                    </button>
                    <button type="button" className="btn-quiet" disabled={!dataset || example !== null} onClick={() => random("linker")}>
                      {example === "linker" ? "Loading the dataset…" : "A linker example"}
                    </button>
                    <button type="button" className="btn-quiet" disabled={!dataset} onClick={() => setBrowser(true)}>
                      Browse the dataset
                    </button>
                    {text && (
                      <button type="button" className="btn-quiet" onClick={() => use("")}>
                        Clear
                      </button>
                    )}
                  </div>
                  <button type="button" className="btn btn-predict" onClick={() => predict()} disabled={phase === "scanning" || !dataset}>
                    Predict
                  </button>
                </div>
              </Collapse>
              {error && <p className="problem" role="alert">{error}</p>}
            </div>
          </section>
          <section aria-live="polite" aria-label="Result">
            {result && dataset && (
              <div className="reveal" key={result.sequence + result.dataset}>
                <Result result={result} dataset={dataset} />
              </div>
            )}
          </section>
        </div>
      </div>

      {dataset && (
        <Modal open={browser} onClose={() => setBrowser(false)}
          title={<>Sequences of {dataset.name} <span className="muted">({dataset.collection})</span></>}>
          <DatasetBrowser slug={dataset.slug} onUse={(s) => { use(s); setBrowser(false); }} />
        </Modal>
      )}
    </div>
  );
}
