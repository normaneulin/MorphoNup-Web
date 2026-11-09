import { useEffect, useState } from "react";
import type { Label, SequencePage } from "../api";
import { api, ApiError, cleanSequence, sequenceProblem } from "../api";

export function SequenceInput({
  text,
  onText,
  showLengthError,
}: {
  text: string;
  onText: (t: string) => void;
  showLengthError: boolean;
}) {
  const seq = cleanSequence(text);
  const problem = seq ? sequenceProblem(seq) : null;
  const visible = problem && (problem.position !== undefined || showLengthError) ? problem : null;
  return (
    <div className="seq-input">
      <label htmlFor="sequence" className="visually-hidden">
        DNA sequence, 147 bases
      </label>
      <textarea
        id="sequence"
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={5}
        spellCheck={false}
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="Paste a 147-bp sequence (A, C, G, T), or pick one from the dataset below."
        aria-invalid={visible ? true : undefined}
        aria-describedby="sequence-status"
      />
      <div id="sequence-status" className="seq-status">
        <span className={seq.length === 147 && !problem ? "count ok" : "count"}>{seq.length} / 147</span>
        {visible && <span className="problem">{visible.message}</span>}
      </div>
    </div>
  );
}

const PAGE_SIZE = 8;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers or a page that is not served over https or localhost
    const area = Object.assign(document.createElement("textarea"), { value: text });
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function CopyIcon({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      {done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>)}
    </svg>
  );
}

export function DatasetBrowser({ slug, onUse }: { slug: string; onUse: (sequence: string) => void }) {
  const [label, setLabel] = useState<Label | "all">("all");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SequencePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [slug, label]);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .sequences(slug, { label, q, page, size: PAGE_SIZE })
      .then((d) => live && setData(d))
      .catch((e: ApiError) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [slug, label, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <div className="browser">
      <div className="browser-tools">
        <div className="segmented" role="group" aria-label="Show">
          {(["all", "nucleosomal", "linker"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={label === l} onClick={() => setLabel(l)}>
              {l === "all" ? "All" : l === "nucleosomal" ? "Nucleosomal" : "Linker"}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name or a piece of sequence"
          aria-label="Search the dataset"
        />
      </div>
      {error && <p className="problem">{error}</p>}
      {data && data.items.length === 0 && <p className="muted">No sequence matches this search.</p>}
      <ul className="browser-list">
        {data?.items.map((item) => (
          <li key={item.index}>
            <div className="browser-meta">
              <span className="small muted">{item.name.replace(/_/g, " ")}</span>
              <span className={`chip ${item.label}`}>{item.label}</span>
            </div>
            <span className="mono seq-preview" aria-hidden="true">
              {item.sequence.slice(0, 30)}…
            </span>
            <div className="row-actions">
              <button type="button" className="btn-quiet icon-btn" aria-label={`Copy ${item.name.replace(/_/g, " ")}`}
                title="Copy the sequence" onClick={async () => { if (await copyText(item.sequence)) setCopied(item.index); }}>
                <CopyIcon done={copied === item.index} />
                <span className="small">{copied === item.index ? "Copied" : "Copy"}</span>
              </button>
              <button type="button" className="btn-quiet" onClick={() => onUse(item.sequence)}>
                Use
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data && data.total > 0 && (
        <div className="pager">
          <button type="button" className="btn-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="small muted">
            Page {page} of {pages.toLocaleString()} ({data.total.toLocaleString()} sequences)
          </span>
          <button type="button" className="btn-quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
