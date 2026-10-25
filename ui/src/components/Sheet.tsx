import { useEffect, type ReactNode } from "react";

/** A Mac sheet: Esc closes it, a stray click outside never does. */
export function Sheet({ wide, children, onClose, label }: { wide?: boolean; children: ReactNode; onClose?: () => void; label: string }) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim">
      <div className={"sheet" + (wide ? " wide" : "")} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
