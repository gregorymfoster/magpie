import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
// The sorting model (`just model` downloads it) and ONNX Runtime's WebAssembly ship inside the app,
// so sorting works offline and nothing is fetched from the internet. Without the model the app sorts by rules alone.
const MODEL = "models/bge-small-en-v1.5";
const ASSETS: Record<string, string> = {
  "ort/ort-wasm-simd-threaded.wasm": join(ROOT, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"),
  "ort/ort-wasm-simd-threaded.mjs": join(ROOT, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs"),
  [`${MODEL}/onnx/model_quantized.onnx`]: join(ROOT, MODEL, "onnx/model_quantized.onnx"),
  [`${MODEL}/tokenizer.json`]: join(ROOT, MODEL, "tokenizer.json"),
};
const hasModel = Object.values(ASSETS).every((p) => existsSync(p));

function modelAssets(): Plugin {
  return {
    name: "magpie-model",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = ASSETS[(req.url ?? "").replace(/^\//, "").split("?")[0]];
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (!hasModel) return this.warn("No sorting model in models/ (run `just model`); this build sorts books by rules alone.");
      for (const [fileName, file] of Object.entries(ASSETS)) this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
    },
  };
}

// In a browser the UI talks to `magpie serve` on 4319 (see cli/src/serve.ts);
// in the app it runs the core in a Web Worker instead.
export default defineConfig({
  plugins: [react(), modelAssets()],
  clearScreen: false,
  define: { __MAGPIE_MODEL__: JSON.stringify(hasModel) },
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:4319" } },
  // ONNX Runtime fetches its WebAssembly glue next to itself; the dep optimizer would move it away.
  optimizeDeps: { exclude: ["onnxruntime-web", "onnxruntime-web/wasm"] },
  worker: { format: "es" },
  build: { target: "safari17", outDir: "dist", emptyOutDir: true },
});
