import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

// A turning circle that says "loading". `label` is read by screen readers (the circle itself is hidden from them).
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <>
      <LoaderCircle className="spinner" size={size} strokeWidth={2.4} aria-hidden="true" />
      {label && <span className="visually-hidden">{label}</span>}
    </>
  );
}

// A quiet button that shows a spinner on its right while `busy`. It keeps the width it had when clicked, so the
// buttons next to it do not move: the label is shortened with an ellipsis to make room ("A nucleosomal exa… ◌").
export function BusyButton({ busy, busyLabel, disabled, onClick, children }: {
  busy: boolean;
  busyLabel: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="btn-quiet busy-btn"
      disabled={disabled}
      aria-busy={busy || undefined}
      style={busy && width ? { width } : undefined}
      onClick={() => {
        setWidth(ref.current?.getBoundingClientRect().width ?? null);
        onClick();
      }}
    >
      <span className="btn-label">{children}</span>
      {busy && <Spinner size={15} label={busyLabel} />}
    </button>
  );
}
