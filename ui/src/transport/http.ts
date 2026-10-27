import type { CoreEvent } from "@magpie/core";
import type { Transport } from "./index.ts";

export function httpTransport(): Transport {
  const listeners = new Set<(e: CoreEvent) => void>();
  const source = new EventSource("/api/events");
  source.onmessage = (m) => {
    const e = JSON.parse(m.data) as CoreEvent;
    for (const l of listeners) l(e);
  };
  const stage = async (files: File[]) => {
    const out: string[] = [];
    for (const f of files) {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      out.push((await r.json()).path);
    }
    return out;
  };
  return {
    kind: "browser",
    async call(command, args) {
      const r = await fetch("/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, args }) });
      const body = await r.json();
      if (body.error) throw new Error(body.error);
      return body.result;
    },
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fileUrl: (path) => `/api/file?path=${encodeURIComponent(path)}`,
    stage,
    pickBooks: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".epub,application/epub+zip";
        input.onchange = async () => resolve(input.files?.length ? await stage([...input.files]) : null);
        input.click();
      }),
    pickImage: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png";
        input.onchange = async () => resolve(input.files?.length ? (await stage([input.files[0]]))[0] : null);
        input.click();
      }),
    pickFolder: async (title) => window.prompt(`${title} (a folder path on the machine running magpie serve)`),
    onFileDrop: () => () => {},
    copyText: (t) => navigator.clipboard.writeText(t),
  };
}
