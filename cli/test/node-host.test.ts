import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_CONTRACT } from "../../core/test/host-contract.ts";
import { nodeHost } from "../src/node-host.ts";

for (const [name, run] of HOST_CONTRACT) test(`node host: ${name}`, () => run(nodeHost(), mkdtempSync(join(tmpdir(), "magpie-host-"))));
