# Using Magpie with Claude and other AI tools

Magpie can let an AI assistant on your Mac look through your library and tidy it up. Ask Claude things like "which of my books still need review?", "fix the author on every Discworld book" or "send the three newest books to my Kindle", and it does the work through Magpie.

It works through MCP, the standard way AI apps talk to tools on your computer. The connection stays on your Mac: the assistant talks to a small program that Magpie starts on your machine, and your books aren't uploaded anywhere by Magpie. (Your AI app does send what it reads, such as titles and authors, to its own model, the same as anything else you show it.)

## What it can and can't do

The assistant can search your books, read their details and what Magpie fixed, add books from files or folders, bring in a Calibre library, edit details, look up missing details on Open Library (titles, authors and ISBNs only), accept or turn down suggestions, remove and restore books, and send books to a Kindle or a plugged-in Kobo.

Every change it makes is a normal Magpie change, so it shows up in the window and **⌘Z undoes it**, whoever made it. It cannot empty Removed or change your settings. Send to Kindle only opens a Mail draft; you still press Send.

## Setting it up

You need the `magpie` command. Until the app ships it, run it from a copy of this repository (Node 22.18 or newer):

```sh
git clone https://github.com/gregorymfoster/magpie && cd magpie && npm install
```

The command your AI app should run is then:

```
node /path/to/magpie/cli/src/main.ts mcp
```

**Claude Desktop.** Open Settings › Developer › Edit Config and add Magpie to `claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "magpie": {
      "command": "node",
      "args": ["--disable-warning=ExperimentalWarning", "/path/to/magpie/cli/src/main.ts", "mcp"]
    }
  }
}
```

**Claude Code.**

```sh
claude mcp add magpie -- node --disable-warning=ExperimentalWarning /path/to/magpie/cli/src/main.ts mcp
```

**Anything else that speaks MCP** (Cursor, Zed, Goose and so on): it's a stdio server started with the same command.

By default it uses the Library the Magpie app uses (`~/Books/Magpie`, or wherever you moved it). Add `--library <folder>` to point it somewhere else.

## Using it with the app open

That's fine. Both use the same Library safely. The window picks up changes the next time you click into it.

## For developers

The server is `cli/src/mcp.ts`, a thin layer over `core.call`. Its tests in `cli/test/mcp.test.ts` drive it with a real MCP client. To try it by hand:

```sh
npx @modelcontextprotocol/inspector node cli/src/main.ts mcp --library /tmp/try-magpie
```
