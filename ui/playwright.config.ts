import { defineConfig } from "@playwright/test";

// Headless UI tests: the built UI against `magpie serve` on a throwaway home
// folder (Library, config, fake /Volumes). Run with `just e2e`.
const home = `/tmp/magpie-e2e-${process.pid}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4319", viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `rm -rf ${home} && mkdir -p ${home}/Volumes && node --disable-warning=ExperimentalWarning ../cli/src/main.ts serve --ui ${process.cwd()}/ui/dist --port 4319`,
    cwd: "./",
    url: "http://127.0.0.1:4319/api/health",
    reuseExistingServer: false,
    env: { MAGPIE_HOME: home, MAGPIE_VOLUMES: `${home}/Volumes`, MAGPIE_OPENED: `${home}/opened.txt` },
  },
  metadata: { home },
});
