import { useState } from "react";
import type { InfoPatch } from "@magpie/core";
import { useAction, useCall } from "../api.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useToast } from "../components/Toasts.tsx";

/** Get Info (⌘I): a person's own edits. Written into the book like accepted suggestions, and undoable. */
export function EditSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: d } = useCall("books.get", { id });
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string> | null>(null);
  if (!d) return null;
  const v = f ?? {
    title: d.title,
    authors: d.authors.join(" & "),
    series: d.series ?? "",
    seriesIndex: d.seriesIndex ? String(d.seriesIndex) : "",
    year: d.year ? String(d.year) : "",
    publisher: d.publisher ?? "",
    language: d.language,
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...v, [k]: e.target.value });
  const save = async () => {
    const patch: InfoPatch = {};
    if (v.title.trim() !== d.title) patch.title = v.title.trim();
    const au = v.authors
      .split(/\s*&\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (au.join("&") !== d.authors.join("&")) patch.authors = au;
    if (v.series.trim() !== (d.series ?? "")) patch.series = v.series.trim();
    if (Number(v.seriesIndex || 0) !== (d.seriesIndex ?? 0)) patch.seriesIndex = Number(v.seriesIndex) || undefined;
    if (Number(v.year || 0) !== (d.year ?? 0) && Number(v.year)) patch.year = Number(v.year);
    if (v.publisher.trim() !== (d.publisher ?? "")) patch.publisher = v.publisher.trim();
    if (v.language.trim() !== d.language) patch.language = v.language.trim();
    if (Object.keys(patch).length) {
      await act("books.edit", { id, patch });
      toast({ message: "Details saved", undo: () => void act("history.undo") });
    }
    onClose();
  };
  const F = (k: keyof typeof v, label: string, hint?: string) => (
    <>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} className="field wide" value={v[k]} onChange={set(k)} placeholder={hint} />
    </>
  );
  return (
    <Sheet label="Edit details" onClose={onClose}>
      <div className="sh-h">
        <h2>Edit details</h2>
        <p>Changes are written into the book, so every reader shows them. The original stays as it was.</p>
      </div>
      <div className="sh-b">
        <form
          className="edit-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {F("title", "Title")}
          {F("authors", "Author", "Separate several with &")}
          {F("series", "Series")}
          {F("seriesIndex", "Number", "1")}
          {F("year", "Published", "1969")}
          {F("publisher", "Publisher")}
          {F("language", "Language", "en")}
          <button type="submit" hidden />
        </form>
      </div>
      <div className="sh-f">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn pri" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
