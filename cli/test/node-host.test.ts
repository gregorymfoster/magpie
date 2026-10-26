import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_CONTRACT } from "../../core/test/host-contract.ts";
import { nodeHost } from "../src/node-host.ts";
import { WordPiece } from "@magpie/core";

for (const [name, run] of HOST_CONTRACT) test(`node host: ${name}`, () => run(nodeHost(), mkdtempSync(join(tmpdir(), "magpie-host-"))));

test("node host: the sorting model loads from MAGPIE_MODEL and gives one unit vector per text", async () => {
  // A three-number stand-in network (cli/test/fixtures/tiny-model) with BERT's inputs and outputs.
  const host = nodeHost({ MAGPIE_MODEL: join(import.meta.dirname, "fixtures/tiny-model") });
  assert.ok(host.embed);
  const [a, b] = await host.embed(["Hello, worlds", "Unknown words here"]);
  assert.equal(a.length, 3);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-6);
  assert.deepEqual([...a], [...b], "the stand-in only looks at [CLS]");
  assert.equal(nodeHost({ MAGPIE_MODEL: "/nowhere" }).embed, undefined, "no model, no embed: Magpie sorts by rules alone");
});

test("the tokenizer splits words BERT's way", () => {
  const t = WordPiece.fromTokenizerJson(readFileSync(join(import.meta.dirname, "fixtures/tiny-model/tokenizer.json"), "utf8"));
  assert.deepEqual(t.encode("Héllo, WORLDS zebra"), [2, 4, 7, 5, 6, 1, 3]);
  assert.deepEqual(t.encode("hello hello hello", 4), [2, 4, 4, 3]);
});
