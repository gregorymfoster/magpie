// The Node host: the Host interface over node:fs and node:sqlite. Runs the
// CLI, the bench, every test and `magpie serve`, in the cloud with no Mac.
//
// Test switches, all optional:
//   MAGPIE_HOME      stands in for ~ (config, ~/Books/Magpie, ~/Calibre Library)
//   MAGPIE_VOLUMES   stands in for /Volumes, so a test can plug in a fake Kobo
//   MAGPIE_OPENED    a file that `open` and `mail` append to instead of launching apps

import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Db, Host, SqlValue } from "@magpie/core";

const VERSION = "0.1.1";

/** Keep in step with MAIL_SCRIPT in app/src-tauri/src/main.rs. Values arrive as arguments, never spliced into the script. */
const MAIL_SCRIPT = `on run argv
  tell application "Mail"
    set m to make new outgoing message with properties {subject:item 2 of argv, content:(item 3 of argv) & return & return, visible:true}
    tell m to make new to recipient at end of to recipients with properties {address:item 1 of argv}
    repeat with i from 4 to count of argv
      tell content of m to make new attachment with properties {file name:(POSIX file (item i of argv))} at after the last paragraph
    end repeat
    activate
  end tell
end run`;

export function nodeHost(env: NodeJS.ProcessEnv = process.env): Host {
  const home = env.MAGPIE_HOME ?? homedir();
  return {
    fs: {
      read: async (p) => new Uint8Array(await readFile(p)),
      async write(p, data) {
        await mkdir(dirname(p), { recursive: true });
        const tmp = `${p}.magpie-${process.pid}-${Math.random().toString(36).slice(2)}`;
        await writeFile(tmp, data);
        await rename(tmp, p);
      },
      async copy(from, to) {
        await mkdir(dirname(to), { recursive: true });
        await copyFile(from, to);
      },
      exists: async (p) => existsSync(p),
      async list(dir) {
        try {
          return (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, dir: d.isDirectory() }));
        } catch {
          return [];
        }
      },
      mkdir: async (p) => void (await mkdir(p, { recursive: true })),
      remove: (p) => rm(p, { recursive: true, force: true }),
      async move(from, to) {
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
      },
      async free(p) {
        try {
          let at = p;
          while (!existsSync(at)) at = dirname(at);
          const s = await statfs(at);
          return s.bavail * s.bsize;
        } catch {
          return null;
        }
      },
    },
    sqlite: {
      async open(path, opts) {
        if (!opts?.readonly) await mkdir(dirname(path), { recursive: true });
        const db = new DatabaseSync(path, { readOnly: !!opts?.readonly });
        // The app and `magpie mcp` can have the same Library open; wait for each other's writes instead of failing.
        db.exec("PRAGMA busy_timeout = 5000");
        return sqliteDb(db);
      },
    },
    async open(path) {
      if (env.MAGPIE_OPENED) return appendFile(env.MAGPIE_OPENED, path + "\n");
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [path], { detached: true, stdio: "ignore" }).unref();
    },
    async mail(draft) {
      if (env.MAGPIE_OPENED) return appendFile(env.MAGPIE_OPENED, `mail ${JSON.stringify(draft)}\n`);
      const { to, subject, body, attachments } = draft;
      const [cmd, args] =
        process.platform === "darwin"
          ? ["osascript", ["-e", MAIL_SCRIPT, to, subject, body, ...attachments]]
          : ["xdg-email", ["--subject", subject, "--body", body, ...attachments.flatMap((a) => ["--attach", a]), to]];
      await new Promise<void>((resolve, reject) =>
        spawn(cmd, args, { stdio: "ignore" })
          .on("error", reject)
          .on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)))),
      );
    },
    env: {
      home,
      config: env.MAGPIE_CONFIG ?? join(home, process.platform === "darwin" ? "Library/Application Support/Magpie" : ".config/magpie"),
      temp: join(tmpdir(), "magpie"),
      volumes: env.MAGPIE_VOLUMES ?? "/Volumes",
      version: VERSION,
    },
  };
}

function sqliteDb(db: DatabaseSync): Db {
  const bind = (params: SqlValue[] = []) => params as SQLInputValue[];
  return {
    all: async <T>(sql: string, params?: SqlValue[]) => db.prepare(sql).all(...bind(params)) as T[],
    async run(sql, params) {
      const r = db.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const s of statements) db.prepare(s.sql).run(...bind(s.params));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql) => db.exec(sql),
    close: async () => db.close(),
  };
}
