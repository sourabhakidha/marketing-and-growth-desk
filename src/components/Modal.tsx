import { useEffect, useRef, type ReactNode } from "react";

/** Accessible modal dialog using the native <dialog> element. */
export function Modal({ title, open, onClose, children, wide = false }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal${wide ? " modal--wide" : ""}`} onClose={onClose} onCancel={onClose}>
      <header className="modal__header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
      </header>
      {open && <div className="modal__body">{children}</div>}
    </dialog>
  );
}
