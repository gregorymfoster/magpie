// The core, inside a Web Worker in the Mac app. Its Host forwards every call
// to the window (tauri.ts), which forwards it to Rust.

import * as Comlink from "comlink";
import { createCore, paced, MODEL, WordPiece, bertEmbedder, ortRun, type Core, type CoreEvent, type Db, type Host, type HostEnv } from "@magpie/core";
import type { TauriHost } from "./tauri.ts";

let core: Core | null = null;

declare const __MAGPIE_MODEL__: boolean;

/**
 * The sorting model, bundled in the app (see vite.config.ts) and run here in
 * the worker with ONNX Runtime's WebAssembly build: one thread, no network.
 * Loaded the first time a book is sorted.
 */
function modelEmbed(): Host["embed"] {
  if (!__MAGPIE_MODEL__) return undefined;
  let ready: Promise<(texts: string[]) => Promise<Float32Array[]>> | null = null;
  const load = async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", self.location.href).href };
    const file = (f: string) => fetch(new URL(`/models/${MODEL.name}/${f}`, self.location.href));
    const session = await ort.InferenceSession.create(new Uint8Array(await (await file("onnx/model_quantized.onnx")).arrayBuffer()));
    const tokenizer = WordPiece.fromTokenizerJson(await (await file("tokenizer.json")).text());
    return bertEmbedder(tokenizer, ortRun(session, ort.Tensor));
  };
  return async (texts) => (await (ready ??= load()))(texts);
}

function workerHost(r: Comlink.Remote<TauriHost>, env: HostEnv): Host {
  const db = (h: number): Db => ({
    all: (sql, params) => r.dbAll(h, sql, params) as never,
    run: (sql, params) => r.dbRun(h, sql, params),
    batch: (s) => r.dbBatch(h, s),
    exec: (sql) => r.dbExec(h, sql),
    close: () => r.dbClose(h),
  });
  return {
    fs: {
      read: (p) => r.fsRead(p),
      write: (p, d) => r.fsWrite(p, d),
      copy: (a, b) => r.fsCopy(a, b),
      exists: (p) => r.fsExists(p),
      list: (d) => r.fsList(d),
      mkdir: (p) => r.fsMkdir(p),
      remove: (p) => r.fsRemove(p),
      move: (a, b) => r.fsMove(a, b),
      free: (p) => r.fsFree(p),
    },
    sqlite: { open: async (p, o) => db(await r.dbOpen(p, !!o?.readonly)) },
    open: (p) => r.open(p),
    mail: (d) => r.mail(d),
    // Straight from the worker: only openlibrary.org is allowed out (connect-src in tauri.conf.json).
    web: {
      getJson: paced(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} from ${url}`);
        return res.json();
      }),
    },
    embed: modelEmbed(),
    env,
  };
}

const api = {
  init(remote: TauriHost, env: HostEnv) {
    core = createCore(workerHost(remote as unknown as Comlink.Remote<TauriHost>, env));
  },
  call(command: string, args: unknown) {
    return (core!.call as (c: string, a: unknown) => Promise<unknown>)(command, args);
  },
  subscribe(cb: (e: CoreEvent) => void) {
    core!.on((e) => cb(e));
  },
};
export type WorkerApi = typeof api;
Comlink.expose(api);
