import { useEffect, useState } from "react";

const MS = 320;

// Opens and closes its content by animating the height (CSS grid rows 0fr <-> 1fr). On closing, the content stays
// until the animation ends and is then removed, so closed content is entirely gone, not just hidden.
export function Collapse({ open, id, children }: { open: boolean; id?: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(r);
    }
    setExpanded(false);
    const t = window.setTimeout(() => setMounted(false), MS + 40);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div id={id} className={`collapse${expanded ? " is-open" : ""}`} aria-hidden={!expanded}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}
