import { useEffect, useRef, type ReactNode } from "react";

/**
 * A Mac sheet: Esc closes it, Return presses its default (primary) button,
 * and a stray click outside never closes it.
 */
export function Sheet({ wide, children, onClose, label }: { wide?: boolean; children: ReactNode; onClose?: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus moves into the sheet (its first field, or the sheet itself) and goes back where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea");
    (first ?? ref.current)?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    // The key that opened the sheet (Return on a book) can still be on its way to window; it isn't for us.
    const opened = performance.now();
    const k = (e: KeyboardEvent) => {
      if (e.timeStamp < opened) return;
      if (e.key === "Escape" && onClose) onClose();
      if (e.key === "Tab") trap(e);
      if (e.key !== "Enter" || e.isComposing || e.metaKey || e.shiftKey) return;
      // A button focused in the sheet, or a text area, keeps Return for itself.
      const at = document.activeElement;
      if (at instanceof HTMLTextAreaElement || at instanceof HTMLSelectElement) return;
      if (at instanceof HTMLButtonElement && ref.current?.contains(at)) return;
      const primary = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button.pri") ?? [])].filter((b) => !b.disabled).pop();
      if (!primary) return;
      e.preventDefault();
      primary.click();
    };
    // Tab stays inside the sheet, as it does in a Mac sheet.
    const trap = (e: KeyboardEvent) => {
      const all = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, textarea, a[href], [tabindex='0']") ?? [])];
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + all.length) % all.length;
      if (at !== -1 && next !== 0 && next !== all.length - 1) return;
      e.preventDefault();
      all[next].focus();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim">
      <div ref={ref} className={"sheet" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
