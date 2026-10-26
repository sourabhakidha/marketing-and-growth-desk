import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** A small non-modal panel under a button (filters, options). Closes on Escape and outside click. */
export function Popover({ button, buttonClassName = "button", children, align = "start", label }: {
  button: ReactNode; buttonClassName?: string; children: ReactNode; align?: "start" | "end"; label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="popover" ref={root}>
      <button type="button" className={buttonClassName} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{button}</button>
      {open && <div id={id} className={`popover__panel popover__panel--${align}`} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}
