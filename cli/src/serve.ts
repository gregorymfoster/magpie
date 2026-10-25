// `magpie serve`: the core over HTTP for the UI running in a browser. This is
// the dev loop and what Playwright drives. The app itself runs the same UI
// with the core in a Web Worker instead; only ui/src/transport differs.
//
//   POST /api/call          {command, args} -> {result} or {error}
//   GET  /api/events        server-sent events, one CoreEvent per message
//   GET  /api/file?path=    a file inside the Library (covers)
//   POST /api/upload?name=  raw bytes -> {path}, for files dropped in a browser
//   GET  /*                 the built UI, when --ui is given

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { createCore, type CoreEvent } from "@magpie/core";
import { nodeHost } from "./node-host.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export async function serve(opts: { port: number; library?: string; ui?: string }) {
  const host = nodeHost();
  const core = createCore(host);
  if (opts.library) await core.call("library.use", { path: opts.library });
  const clients = new Set<ServerResponse>();
  core.on((e: CoreEvent) => {
    for (const c of clients) c.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/health") return json(res, 200, { ok: true });
      if (url.pathname === "/api/call" && req.method === "POST") {
        const { command, args } = JSON.parse((await body(req)).toString("utf8"));
        try {
          const result = await (core.call as (c: string, a?: unknown) => Promise<unknown>)(command, args);
          return json(res, 200, { result: result ?? null });
        } catch (e) {
          return json(res, 200, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": hello\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (url.pathname === "/api/file") {
        const path = normalize(url.searchParams.get("path") ?? "");
        const state = await core.call("app.state");
        if (!path.startsWith(state.library.path + "/") || !existsSync(path)) return json(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
        return res.end(await readFile(path));
      }
      if (url.pathname === "/api/upload" && req.method === "POST") {
        const name = (url.searchParams.get("name") ?? "book.epub").replace(/[/\\]/g, "_");
        const dir = join(host.env.temp, "uploads", randomUUID());
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, name), await body(req));
        return json(res, 200, { path: join(dir, name) });
      }
      if (opts.ui) {
        let file = join(opts.ui, normalize(url.pathname).replace(/^\/+/, ""));
        if (!file.startsWith(opts.ui) || !existsSync(file) || url.pathname === "/") file = join(opts.ui, "index.html");
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        return res.end(await readFile(file));
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  await new Promise<void>((ok) => server.listen(opts.port, "127.0.0.1", ok));
  console.log(`magpie serve: http://127.0.0.1:${opts.port}`);
  return server;
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
