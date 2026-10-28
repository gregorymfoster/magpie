// Look Up Details: one button for the whole Library. Says plainly what leaves
// the Mac before anything does, then runs as a job; what's found waits in
// Needs Review.

import { Globe } from "lucide-react";
import type { Job } from "@magpie/core";
import { useAction, useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useToast } from "../components/Toasts.tsx";
import { plural } from "../format.ts";

export function LookupSheet({ onClose, onJob }: { onClose: () => void; onJob: (j: Job) => void }) {
  const { data } = useCall("books.lookupCount");
  const act = useAction();
  const toast = useToast();
  if (!data) return null;
  const n = data.count;
  const minutes = Math.max(1, Math.round((n * 2) / 60));
  const start = async () => {
    try {
      const job = await act("books.lookup", {});
      if (job) onJob(job);
      else onClose();
    } catch (e) {
      toast({ message: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet label="Look up details" onClose={onClose}>
      <div className="sh-h">
        <h2>{n ? `Look up details for ${plural(n, "book")}?` : "Nothing to look up"}</h2>
        <p>
          {n
            ? "Magpie asks Open Library for what your books are missing (the year, publisher, language, description, or an author it couldn’t read) and how its readers rate them. Details wait in Needs Review, and nothing changes until you accept them."
            : "Every book has been looked up already."}
        </p>
      </div>
      {n > 0 && (
        <div className="sh-b">
          <p className="lookup-note">
            <Globe size={13} />
            <span>
              Only each book’s title, author and ISBN are sent, to openlibrary.org. The books themselves never leave this Mac. Covers it finds come back as
              pictures for you to check. Asking politely takes about {plural(minutes, "minute")}; you can keep working, and adding books isn’t held up.
            </span>
          </p>
        </div>
      )}
      <div className="sh-f">
        {n > 0 && (
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        )}
        <button className="btn pri" onClick={n ? start : onClose}>
          {n ? "Look Up" : "OK"}
        </button>
      </div>
    </Sheet>
  );
}
