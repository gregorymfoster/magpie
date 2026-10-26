// `magpie mcp` as an AI client sees it: a real MCP client talking to the
// server over an in-memory transport, against a real Library in a temp folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCore } from "@magpie/core";
import { nodeHost } from "../src/node-host.ts";
import { mcpServer } from "../src/mcp.ts";
import { epub } from "../../core/test/fixtures.ts";

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "magpie-mcp-"));
  mkdirSync(join(home, "Volumes"));
  const opened = join(home, "opened.txt");
  const core = createCore(nodeHost({ MAGPIE_HOME: home, MAGPIE_VOLUMES: join(home, "Volumes"), MAGPIE_OPENED: opened }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcpServer(core, "test").connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const t = r.content[0].text;
    let data: unknown = t;
    try {
      data = JSON.parse(t);
    } catch {}
    return { data: data as any, isError: Boolean(r.isError), text: t };
  };
  const file = (name: string, bytes: Uint8Array) => {
    mkdirSync(join(home, "Downloads"), { recursive: true });
    writeFileSync(join(home, "Downloads", name), bytes);
    return join(home, "Downloads", name);
  };
  return { client, call, file, opened, core };
}

const unknownAuthor = () =>
  epub({ opfMeta: '<dc:identifier id="id">urn:uuid:7</dc:identifier><dc:title>Emma</dc:title><dc:creator>Unknown</dc:creator><dc:language>en</dc:language>' });

test("lists its tools, with no way to empty Removed", async () => {
  const { client } = await setup();
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of [
    "search_books",
    "get_book",
    "import_books",
    "edit_book",
    "review_suggestions",
    "remove_books",
    "undo",
    "send_to_kindle",
    "send_to_kobo",
    "list_shelves",
    "tag_books",
    "sort_library",
  ])
    assert.ok(names.includes(n), n);
  assert.ok(!names.some((n) => /purge|empty|delete/.test(n)));
});

test("import, review a suggestion, edit, then undo, the way an assistant would", async () => {
  const { call, file } = await setup();
  const imported = await call("import_books", { paths: [file("emma.epub", unknownAuthor())] });
  assert.equal(imported.data.state, "done");
  assert.equal(imported.data.results[0].outcome, "added");

  const { data: found } = await call("search_books", { state: "review" });
  assert.equal(found.total, 1);
  const id = found.books[0].id;
  const { data: book } = await call("get_book", { id });
  assert.equal(book.suggestions[0].field, "authors");
  assert.ok(!("file" in book) && !("plan" in book), "no Library internals");

  const { data: reviewed } = await call("review_suggestions", { decisions: [{ id, accept: ["authors"] }] });
  assert.deepEqual(reviewed[0].authors, ["Jane Austen"]);

  const { data: edited } = await call("edit_book", { id, series: "Austen Novels", seriesIndex: 4 });
  assert.equal(edited.series, "Austen Novels");
  assert.match((await call("undo")).text, /^Undid/);
  assert.equal((await call("get_book", { id })).data.series, undefined);
});

test("remove is reversible; send_to_kindle only opens a draft", async () => {
  const { call, file, opened } = await setup();
  await call("import_books", { paths: [file("emma.epub", epub())] });
  const id = (await call("search_books")).data.books[0].id;

  const noAddress = await call("send_to_kindle", { ids: [id] });
  assert.ok(noAddress.isError);
  assert.match(noAddress.text, /Kindle/);

  await call("remove_books", { ids: [id] });
  assert.equal((await call("search_books")).data.total, 0);
  assert.equal((await call("search_books", { removed: true })).data.total, 1);
  await call("restore_books", { ids: [id] });
  assert.equal((await call("library_overview")).data.books.all, 1);
});

test("a Kindle draft is opened, never sent", async () => {
  const { call, file, opened, core } = await setup();
  await call("import_books", { paths: [file("emma.epub", epub())] });
  await core.call("settings.set", { kindleAddress: "reader@kindle.com" });
  const id = (await call("search_books")).data.books[0].id;
  const r = await call("send_to_kindle", { ids: [id] });
  assert.ok(!r.isError);
  assert.match(r.text, /press Send/);
  assert.match(readFileSync(opened, "utf8"), /^mail .*reader@kindle\.com.*\.epub/);
});

test("the CLI speaks MCP on stdio", () => {
  const home = mkdtempSync(join(tmpdir(), "magpie-mcp-cli-"));
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "library_overview", arguments: {} } },
  ];
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(import.meta.dirname, "../src/main.ts"), "mcp"], {
    input: msgs.map((m) => JSON.stringify(m)).join("\n") + "\n",
    env: { ...process.env, MAGPIE_HOME: home },
    encoding: "utf8",
    timeout: 20000,
  });
  const lines = r.stdout
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, "magpie");
  const overview = JSON.parse(lines[1].result.content[0].text);
  assert.equal(overview.library.path, join(home, "Books/Magpie"));
});
