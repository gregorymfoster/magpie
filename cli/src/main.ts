#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// magpie: the core from a terminal. Every command the app's UI uses is
// reachable here as `magpie call <command> '<json>'`, which is how agents and
// scripts check behaviour without a window.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCore, fix, fixAndAccept, newPlan, Book, COMMANDS, type Core } from "@magpie/core";
import { nodeHost } from "./node-host.ts";
import { serve } from "./serve.ts";

const USAGE = `magpie: fix and manage ebooks

  magpie fix <book.epub> [out.epub] [--accept]
      Fix one file. Prints what changed and any suggested details;
      --accept also writes the suggestions.
  magpie import <file-or-folder>... [--library <dir>]
      Bring books into a Library (default ~/Books/Magpie) and wait.
  magpie call <command> ['<json args>'] [--library <dir>]
      Run any core command and print its JSON result. \`magpie commands\` lists them.
  magpie serve [--port 4319] [--library <dir>] [--ui <dist dir>]
      The core over HTTP, for the UI in a browser and for Playwright.`;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const has = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) argv.splice(i, 1);
  return i >= 0;
};

async function withCore<T>(run: (core: Core) => Promise<T>): Promise<T> {
  const core = createCore(nodeHost());
  const library = flag("library");
  if (library) await core.call("library.use", { path: resolve(library) });
  else await core.call("app.state");
  try {
    return await run(core);
  } finally {
    await core.idle();
    await core.close();
  }
}

async function main() {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "fix": {
      const accept = has("accept");
      const [input, output = input?.replace(/\.epub$/i, "") + ".fixed.epub"] = rest;
      if (!input) return usage();
      const bytes = readFileSync(input);
      const r = accept ? fixAndAccept(bytes) : fix(bytes, newPlan(new Book().stamp));
      for (const c of r.report.changes) console.log(`- ${c.message}`);
      for (const s of r.report.suggestions)
        console.log(`? Suggest ${s.field === "authors" ? "author" : s.field} "${s.value}" (from ${s.source}). Use --accept to write it.`);
      for (const e of r.report.errors) console.error(`! ${e.fixer} failed: ${e.error}`);
      if (!r.report.changes.length && !r.report.suggestions.length) console.log("Nothing to fix.");
      writeFileSync(output, r.bytes);
      console.log(`Wrote ${output}`);
      return;
    }
    case "import": {
      const library = flag("library");
      if (!rest.length) return usage();
      if (library) argv.push("--library", library);
      await withCore(async (core) => {
        const job = await core.call("books.import", { paths: rest.map((p) => resolve(p)) });
        await core.idle();
        const done = (await core.call("app.state")).jobs.find((j) => j.id === job.id) ?? job;
        for (const r of done.results) console.log(`${r.outcome.padEnd(10)} ${r.label}${r.message ? ` (${r.message})` : ""}`);
      });
      return;
    }
    case "call": {
      const library = flag("library");
      const [name, json] = rest;
      if (!name) return usage();
      if (library) argv.push("--library", library);
      const out = await withCore(async (core) => {
        const result = await (core.call as (c: string, a?: unknown) => Promise<unknown>)(name, json ? JSON.parse(json) : undefined);
        await core.idle();
        return result;
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    case "commands":
      console.log(COMMANDS.join("\n"));
      return;
    case "serve": {
      const port = Number(flag("port") ?? 4319);
      const library = flag("library");
      const ui = flag("ui");
      await serve({ port, library: library && resolve(library), ui: ui && resolve(ui) });
      return;
    }
    default:
      return usage();
  }
}

function usage() {
  console.log(USAGE);
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
