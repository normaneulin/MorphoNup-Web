// Downloads with a stall limit, for slow or unreliable (mobile) connections: a request that receives no data for
// `stallMs` is cancelled and tried once more, so a stalled download ends with an error instead of waiting forever.

export class DownloadError extends Error {}

export async function download(url: string, onProgress?: (loaded: number, total: number) => void,
                               { stallMs = 15000, attempts = 2 } = {}): Promise<ArrayBuffer> {
  let reason = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const control = new AbortController();
    let timer = setTimeout(() => control.abort(), stallMs);
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => control.abort(), stallMs);
    };
    try {
      const res = await fetch(url, { signal: control.signal });
      if (!res.ok) {
        reason = `error ${res.status}`;
        if (res.status === 404) break;                 // a missing file does not appear on a second try
        continue;
      }
      const total = Number(res.headers.get("content-length")) || 0;
      if (!res.body) return await res.arrayBuffer();
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        alive();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }
      const out = new Uint8Array(loaded);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out.buffer;
    } catch (e) {
      reason = control.signal.aborted ? "the download stalled" : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DownloadError(`Could not load ${url.split("/data/").pop()} (${reason}).`);
}

export async function downloadJson<T>(url: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await download(url))) as T;
}
