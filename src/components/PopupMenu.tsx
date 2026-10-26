import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "react-router";

/**
 * Accessible menu button + popup (WAI-ARIA menu button pattern).
 * - button carries aria-haspopup / aria-expanded / aria-controls
 * - opens with click, Enter/Space or ArrowDown; first item is focused
 * - Arrow keys / Home / End move between items; Escape closes and returns focus
 * - closes on outside pointer-down, on Tab out, on item activation and on route change
 * Items are any elements with role="menuitem" rendered inside `children`.
 */
export function PopupMenu({ label, button, buttonClassName = "", panelClassName = "", align = "end", header, active = false, children }: {
  /** accessible name of the menu */
  label: string;
  /** visible content of the trigger button */
  button: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  align?: "start" | "end";
  /** non-interactive content shown above the items (e.g. the signed-in person) */
  header?: ReactNode;
  /** marks the trigger as holding the current page */
  active?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();

  // close on route change
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);

  // close on outside pointer-down
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // focus the first item when opened
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  function items(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onPanelKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape": e.preventDefault(); close(true); break;
      case "ArrowDown": e.preventDefault(); list[(i + 1) % list.length]?.focus(); break;
      case "ArrowUp": e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); break;
      case "Home": e.preventDefault(); list[0]?.focus(); break;
      case "End": e.preventDefault(); list[list.length - 1]?.focus(); break;
      case "Tab": setOpen(false); break;
    }
  }

  return (
    <div className={`popup${open ? " is-open" : ""}`} ref={rootRef}>
      <button ref={buttonRef} type="button" className={`${buttonClassName}${active ? " is-active" : ""}`}
        aria-haspopup="true" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)} onKeyDown={onButtonKey}>
        {button}
      </button>
      <div id={id} className={`popup__panel popup__panel--${align} ${panelClassName}`} hidden={!open} onKeyDown={onPanelKey}
        onClick={(e) => { if ((e.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false); }}>
        {header}
        <div role="menu" aria-label={label} ref={listRef} className="popup__list">
          {children}
        </div>
      </div>
    </div>
  );
}
