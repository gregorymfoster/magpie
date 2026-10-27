import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Check, AlertCircle } from "lucide-react";
import stampArt from "../img/stamp-magpie.png";

interface Toast {
  id: number;
  message: string;
  error?: boolean;
  undo?: () => void;
  /** A button other than Undo, like Restart. */
  action?: { label: string; run: () => void };
  /** Stays until its button is pressed. */
  sticky?: boolean;
  /** A rare moment worth marking (a Library milestone): the magpie stamp presses in, with a line under the message. */
  stamp?: { detail: string };
}

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(Ctx);

let next = 1;

/**
 * At most three at a time, so holding ⌘Z can't stack a hundred. A thin line
 * along the bottom shortens over the toast's life and dismisses it when it
 * runs out; the pointer resting on the toast pauses it.
 */
export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next++;
    setList((l) => [...l.slice(-2), { ...t, id }]);
  }, []);
  const drop = (id: number) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {list.map((t) => (
          <div key={t.id} className={"toast" + (t.stamp ? " stamped" : "")}>
            {t.stamp ? (
              <>
                <span className="stamp">
                  <img src={stampArt} alt="" draggable={false} />
                </span>
                <span>
                  <b>{t.message}</b>
                  <span>{t.stamp.detail}</span>
                </span>
              </>
            ) : (
              <>
                {t.error ? <AlertCircle size={13} /> : <Check size={13} />}
                {t.message}
              </>
            )}
            {t.undo && (
              <button
                onClick={() => {
                  t.undo!();
                  drop(t.id);
                }}
              >
                Undo
              </button>
            )}
            {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
            {!t.sticky && <i className="life" style={{ animationDuration: t.error || t.stamp ? "7s" : "4.2s" }} onAnimationEnd={() => drop(t.id)} />}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
