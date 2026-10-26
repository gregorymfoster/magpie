// The sorting model in the app, run inside the core's worker. Its own module
// so a browser test can load it the same way (ui/e2e/model.spec.ts).

import { MODEL, WordPiece, bertEmbedder, ortRun, type Host } from "@magpie/core";

declare const __MAGPIE_MODEL__: boolean;

/**
 * The sorting model, bundled in the app (see vite.config.ts) and run here in
 * the worker with ONNX Runtime's WebAssembly build: one thread, no network.
 * Loaded the first time a book is sorted.
 */
export function modelEmbed(): Host["embed"] {
  if (!__MAGPIE_MODEL__) return undefined;
  let ready: Promise<(texts: string[]) => Promise<Float32Array[]>> | null = null;
  const load = async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.numThreads = 1;
    // Its glue (.mjs) and the WebAssembly sit in /ort/, copied there by vite.config.ts.
    ort.env.wasm.wasmPaths = new URL("/ort/", self.location.href).href;
    const file = (f: string) => fetch(new URL(`/models/${MODEL.name}/${f}`, self.location.href));
    const session = await ort.InferenceSession.create(new Uint8Array(await (await file("onnx/model_quantized.onnx")).arrayBuffer()));
    const tokenizer = WordPiece.fromTokenizerJson(await (await file("tokenizer.json")).text());
    return bertEmbedder(tokenizer, ortRun(session, ort.Tensor));
  };
  return async (texts) => (await (ready ??= load()))(texts);
}
