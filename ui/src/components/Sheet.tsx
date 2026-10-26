import { useEffect, useRef, type ReactNode } from "react";

/**
 * A Mac sheet: Esc closes it, Return presses its default (primary) button,
 * and a stray click outside never closes it.
 */
export function Sheet({ wide, children, onClose, label }: { wide?: boolean; children: ReactNode; onClose?: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The key that opened the sheet (Return on a book) can still be on its way to window; it isn't for us.
    const opened = performance.now();
    const k = (e: KeyboardEvent) => {
      if (e.timeStamp < opened) return;
      if (e.key === "Escape" && onClose) onClose();
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
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim">
      <div ref={ref} className={"sheet" + (wide ? " wide" : "")} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
