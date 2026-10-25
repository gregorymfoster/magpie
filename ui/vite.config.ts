import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In a browser the UI talks to `magpie serve` on 4319 (see cli/src/serve.ts);
// in the app it runs the core in a Web Worker instead.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true, proxy: { "/api": "http://127.0.0.1:4319" } },
  worker: { format: "es" },
  build: { target: "safari17", outDir: "dist", emptyOutDir: true },
});
