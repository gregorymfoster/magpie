// What every Host must do, as one suite. Run against the Node host here
// (cli/test/node-host.test.ts) and against the Tauri host in the app's
// self-test (Magpie › Run Self-Test in a dev build), so the two can't drift.

import assert from "node:assert/strict";
import type { Host } from "../src/host.ts";

export type Check = [name: string, run: (host: Host, dir: string) => Promise<void>];

export const HOST_CONTRACT: Check[] = [
  [
    "write then read returns the same bytes, creating folders",
    async (h, d) => {
      const bytes = new Uint8Array([0, 1, 2, 255]);
      await h.fs.write(`${d}/a/b/c.bin`, bytes);
      assert.deepEqual(await h.fs.read(`${d}/a/b/c.bin`), bytes);
    },
  ],
  [
    "write replaces a file whole",
    async (h, d) => {
      await h.fs.write(`${d}/f`, new Uint8Array([1, 2, 3]));
      await h.fs.write(`${d}/f`, new Uint8Array([9]));
      assert.deepEqual(await h.fs.read(`${d}/f`), new Uint8Array([9]));
    },
  ],
  [
    "exists, list, copy, move and remove",
    async (h, d) => {
      assert.equal(await h.fs.exists(`${d}/nope`), false);
      await h.fs.write(`${d}/x/one.txt`, new Uint8Array([1]));
      await h.fs.mkdir(`${d}/x/sub`);
      const names = (await h.fs.list(`${d}/x`)).sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(names, [
        { name: "one.txt", dir: false },
        { name: "sub", dir: true },
      ]);
      assert.deepEqual(await h.fs.list(`${d}/missing`), []);
      await h.fs.copy(`${d}/x/one.txt`, `${d}/y/two.txt`);
      await h.fs.move(`${d}/y/two.txt`, `${d}/z/three.txt`);
      assert.equal(await h.fs.exists(`${d}/y/two.txt`), false);
      assert.deepEqual(await h.fs.read(`${d}/z/three.txt`), new Uint8Array([1]));
      await h.fs.remove(`${d}/x`);
      await h.fs.remove(`${d}/x`);
      assert.equal(await h.fs.exists(`${d}/x`), false);
    },
  ],
  [
    "free space is a number or null",
    async (h, d) => {
      const f = await h.fs.free(d);
      assert.ok(f === null || f > 0);
    },
  ],
  [
    "sqlite: run, all, batch rolls back on error, blobs and nulls round-trip",
    async (h, d) => {
      const db = await h.sqlite.open(`${d}/t.db`);
      await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT, b BLOB, n REAL)");
      const r = await db.run("INSERT INTO t (s, b, n) VALUES (?, ?, ?)", ["héllo", new Uint8Array([7, 8]), null]);
      assert.equal(r.lastId, 1);
      assert.equal(r.changes, 1);
      const [row] = await db.all<{ s: string; b: Uint8Array; n: null }>("SELECT * FROM t");
      assert.equal(row.s, "héllo");
      assert.deepEqual(new Uint8Array(row.b), new Uint8Array([7, 8]));
      assert.equal(row.n, null);
      await assert.rejects(db.batch([{ sql: "INSERT INTO t (s) VALUES ('a')" }, { sql: "INSERT INTO nope VALUES (1)" }]));
      assert.equal((await db.all("SELECT * FROM t")).length, 1);
      await db.close();
      const ro = await h.sqlite.open(`${d}/t.db`, { readonly: true });
      await assert.rejects(ro.run("INSERT INTO t (s) VALUES ('x')"));
      await ro.close();
    },
  ],
  [
    "env names absolute folders",
    async (h) => {
      for (const k of ["home", "config", "temp", "volumes"] as const) assert.ok(h.env[k].startsWith("/"), k);
      assert.match(h.env.version, /^\d+\.\d+\.\d+/);
    },
  ],
];
