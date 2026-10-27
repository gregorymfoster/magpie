import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Check, AlertCircle } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void;
  /** A button other than Undo, like Restart. */
  action?: { label: string; run: () => void };
  /** Stays until its button is pressed. */
  sticky?: boolean;
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

let next = 1;

/** At most three at a time, so holding ⌘Z can't stack a hundred. */
export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next++;
    setList((l) => [...l.slice(-2), { ...t, id }]);
    if (!t.sticky) setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.error ? 7000 : 4200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {list.map((t) => (
          <div key={t.id} className="toast">
            {t.error ? <AlertCircle size={13} /> : <Check size={13} />}
            {t.message}
            {t.undo && (
              <button
                onClick={() => {
                  t.undo!();
                  setList((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                Undo
              </button>
            )}
            {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
