// `magpie mcp`: the Library for AI tools, as a local MCP server over stdio.
// Claude Desktop, Claude Code and other MCP clients start it themselves; see
// docs/ai.md. It is a thin layer over core.call, like the window, so anything
// it can do the window can show, and every change it makes is one ⌘Z away.
//
// Deliberately missing: emptying Removed and changing settings. Those stay
// in the window, where a person sees them happen.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { patchFor, type BookDetail, type BookSummary, type Core, type Job } from "@magpie/core";

const details = {
  title: z.string().optional(),
  authors: z.array(z.string()).optional().describe("Every author, in order, as people would write them: Jane Austen"),
  series: z.string().optional(),
  seriesIndex: z.number().optional(),
  publisher: z.string().optional(),
  year: z.number().int().optional(),
  isbn: z.string().optional(),
  language: z.string().optional().describe("BCP 47 code: en, fr, pt-BR"),
  description: z.string().optional(),
};
const ids = z.array(z.number().int()).min(1).describe("Book ids from search_books");

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

/** What an AI needs about a book, without paths into the Library or the plan internals. */
const summary = (b: BookSummary) => ({
  id: b.id,
  title: b.title,
  authors: b.authors,
  ...(b.series && { series: b.series, seriesIndex: b.seriesIndex }),
  ...(b.year && { year: b.year }),
  language: b.language,
  state: b.state,
  ...(b.tags.length && { tags: b.tags.map((t) => t.name) }),
  added: b.addedAt.slice(0, 10),
  ...(b.removedAt && { removed: b.removedAt.slice(0, 10) }),
});

const detail = (b: BookDetail) => ({
  ...summary(b),
  ...(b.publisher && { publisher: b.publisher }),
  ...(b.isbn && { isbn: b.isbn }),
  ...(b.description && { description: b.description }),
  addedFrom: b.originName,
  fixed: b.report.changes.map((c) => c.message),
  suggestions: b.report.suggestions.map((s) => ({ field: s.field, current: s.current, suggested: s.value, source: s.source, confidence: s.confidence })),
});

const jobSummary = (j: Job) => ({
  state: j.state,
  done: j.done,
  total: j.total,
  results: j.results.map(({ bookId, undo: _, ...r }) => ({ ...r, ...(bookId && { id: bookId }) })),
});

export function mcpServer(core: Core, version: string) {
  const FIELDS = ["title", "authors", "year", "publisher", "language", "description"] as const;
  const server = new McpServer(
    { name: "magpie", title: "Magpie", version },
    {
      instructions:
        "Magpie is the user's ebook library on this Mac. Search before acting, refer to books by title when talking to the user, and tell them that any change can be undone with undo or ⌘Z in Magpie. Never claim a book was sent to a Kindle: send_to_kindle only opens a Mail draft the user sends. Books in state \"locked\" have DRM from the store that sold them: Magpie lists them but can't edit, fix or send them.",
    },
  );
  // Long work runs as a job; wait for it so the AI gets the outcome, not a job id.
  const finish = async (job: Job) => {
    await core.idle();
    return jobSummary(await core.call("jobs.get", { id: job.id }));
  };
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    "library_overview",
    {
      title: "Library overview",
      description: "Where the Library is, how many books it has, how many need review, and what undo would undo.",
      annotations: read,
    },
    async () => {
      const s = await core.call("app.state");
      return text({
        library: s.library,
        books: s.counts,
        undo: s.undo ?? null,
        running: s.jobs.filter((j) => j.state === "running").map((j) => j.label),
      });
    },
  );

  server.registerTool(
    "search_books",
    {
      title: "Search books",
      description:
        "Find books by title, author or series. With no search, lists the Library. state 'review' finds books with suggested details waiting; 'fixed' finds books Magpie repaired.",
      inputSchema: {
        search: z.string().optional(),
        state: z.enum(["ready", "fixed", "review", "locked"]).optional(),
        tag: z.string().optional().describe("A shelf (Fiction, Nonfiction), genre, vibe or tag, exactly as list_shelves names it"),
        author: z.string().optional(),
        series: z.string().optional(),
        removed: z.boolean().optional().describe("Search Removed instead of the Library"),
        sort: z.enum(["added", "title", "author"]).optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      annotations: read,
    },
    async ({ limit, ...q }) => {
      const books = await core.call("books.list", q);
      return text({ total: books.length, books: books.slice(0, limit).map(summary) });
    },
  );

  server.registerTool(
    "get_book",
    {
      title: "Get book",
      description: "Everything about one book: details, what Magpie fixed, and any suggestions waiting for review.",
      inputSchema: { id: z.number().int() },
      annotations: read,
    },
    async ({ id }) => text(detail(await core.call("books.get", { id }))),
  );

  server.registerTool(
    "import_books",
    {
      title: "Add books",
      description: "Copy EPUB files, or every EPUB in folders, into the Library and fix them. The files themselves are left where they are.",
      inputSchema: { paths: z.array(z.string()).min(1).describe("Absolute paths to .epub files or folders") },
      annotations: write,
    },
    async ({ paths }) => text(await finish(await core.call("books.import", { paths }))),
  );

  server.registerTool(
    "look_up_details",
    {
      title: "Look up details online",
      description:
        "Ask Open Library for details these books are missing (year, publisher, language, description, a missing author). Sends only titles, authors and ISBNs, never the books. Nothing is written: what's found waits as suggestions for review_suggestions. Paced at about one request a second, so keep it to a handful of books; the user can look up the whole Library from Magpie's toolbar.",
      inputSchema: { ids: z.array(z.number().int()).min(1).max(50) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ ids }) => {
      const job = await core.call("books.lookup", { ids, again: true });
      return text(job ? await finish(job) : "Nothing to look up.");
    },
  );

  server.registerTool(
    "edit_book",
    {
      title: "Edit details",
      description: "Change a book's details. Only the fields given change. Undoable.",
      inputSchema: { id: z.number().int(), ...details },
      annotations: write,
    },
    async ({ id, ...patch }) => {
      await core.call("books.edit", { id, patch });
      return text(summary(await core.call("books.get", { id })));
    },
  );

  server.registerTool(
    "review_suggestions",
    {
      title: "Review suggestions",
      description:
        "Accept or turn down suggested details (title, author, and from look_up_details year, publisher, language, description) on books that need review (see get_book). Undoable.",
      inputSchema: {
        decisions: z
          .array(
            z.object({
              id: z.number().int(),
              accept: z.array(z.enum(FIELDS)).default([]),
              dismiss: z.array(z.enum(FIELDS)).default([]),
            }),
          )
          .min(1),
      },
      annotations: write,
    },
    async ({ decisions }) => {
      const out = await Promise.all(
        decisions.map(async (d) => {
          const book = await core.call("books.get", { id: d.id });
          return { id: d.id, accept: patchFor(book.report.suggestions.filter((s) => d.accept.includes(s.field))), dismiss: d.dismiss };
        }),
      );
      await core.call("books.review", { decisions: out });
      return text(await Promise.all(out.map(async (d) => summary(await core.call("books.get", { id: d.id })))));
    },
  );

  server.registerTool(
    "remove_books",
    {
      title: "Remove books",
      description: "Move books to Removed. They can be restored for 30 days, and undo brings them straight back.",
      inputSchema: { ids },
      annotations: write,
    },
    async ({ ids }) => {
      await core.call("books.remove", { ids });
      return text(`Moved ${ids.length} to Removed.`);
    },
  );

  server.registerTool(
    "restore_books",
    { title: "Restore books", description: "Bring books back from Removed.", inputSchema: { ids }, annotations: write },
    async ({ ids }) => {
      await core.call("books.restore", { ids });
      return text(`Restored ${ids.length}.`);
    },
  );

  server.registerTool(
    "list_shelves",
    {
      title: "List shelves",
      description:
        "How the Library is sorted: Fiction and Nonfiction with their genres, vibes, other tags, and authors and series with two or more books, each with a count.",
      annotations: read,
    },
    async () => text(await core.call("library.groups")),
  );

  server.registerTool(
    "tag_books",
    {
      title: "Tag books",
      description:
        "Put tags on books, or take them off. Tags can be a genre or vibe from list_shelves or any word the user likes. A tag taken off stays off when Magpie sorts again.",
      inputSchema: { ids, add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
      annotations: write,
    },
    async ({ ids, add, remove }) => {
      await core.call("books.tag", { ids, add, remove });
      return text(`Tagged ${ids.length}.`);
    },
  );

  server.registerTool(
    "sort_library",
    {
      title: "Sort onto shelves",
      description:
        "Sort books into Fiction or Nonfiction, a genre and a vibe, from their own subjects first and Magpie's local model second. Never touches tags the user added. Without ids, sorts books not sorted yet; again: true re-sorts everything.",
      inputSchema: { ids: ids.optional(), again: z.boolean().optional() },
      annotations: write,
    },
    async (a) => {
      const job = await core.call("library.organize", a);
      return job ? text(await finish(job)) : text("Every book is already sorted.");
    },
  );

  server.registerTool("undo", { title: "Undo", description: "Undo the most recent change to the Library, whoever made it.", annotations: write }, async () => {
    const { undone } = await core.call("history.undo");
    return text(undone ? `Undid: ${undone}` : "Nothing to undo.");
  });

  server.registerTool(
    "find_calibre",
    { title: "Find Calibre library", description: "Look for a Calibre library on this Mac and count its EPUBs.", annotations: read },
    async () => text((await core.call("calibre.find")) ?? "No Calibre library found."),
  );

  server.registerTool(
    "import_calibre",
    {
      title: "Bring in a Calibre library",
      description: "Copy every EPUB from a Calibre library, with Calibre's details. Calibre's own files are never changed.",
      inputSchema: { path: z.string().optional().describe("The Calibre library folder. Leave out to use the one find_calibre finds.") },
      annotations: write,
    },
    async ({ path }) => {
      const where = path ?? (await core.call("calibre.find"))?.path;
      if (!where) return { ...text("No Calibre library found. Ask the user where it is."), isError: true };
      return text(await finish(await core.call("calibre.import", { path: where })));
    },
  );

  server.registerTool(
    "list_devices",
    { title: "List readers", description: "Kobo readers plugged in now, and whether a Send to Kindle address is set.", annotations: read },
    async () => text({ kobos: await core.call("devices.list"), kindle: Boolean((await core.call("settings.get")).kindleAddress) }),
  );

  server.registerTool(
    "send_to_kindle",
    {
      title: "Send to Kindle",
      description: "Open a Mail draft to the user's Send to Kindle address with these books attached. The user reviews and sends it.",
      inputSchema: { ids },
      annotations: { ...write, openWorldHint: true },
    },
    async ({ ids }) => {
      await core.call("send.kindle", { ids });
      return text("A Mail draft is open with the books attached. The user needs to press Send.");
    },
  );

  server.registerTool(
    "send_to_kobo",
    {
      title: "Send to Kobo",
      description: "Convert books to KEPUB and copy them to a plugged-in Kobo (device path from list_devices).",
      inputSchema: { ids, device: z.string() },
      annotations: write,
    },
    async ({ ids, device }) => text(await finish(await core.call("send.kobo", { ids, device }))),
  );

  return server;
}

/** Serve over stdio until the client hangs up. Nothing may be written to stdout but protocol messages. */
export async function mcp(core: Core, version: string) {
  const server = mcpServer(core, version);
  await server.connect(new StdioServerTransport());
  await new Promise<void>((done) => (server.server.onclose = done));
}
