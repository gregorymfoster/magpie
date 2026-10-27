import { test } from "node:test";
import assert from "node:assert/strict";
import { latestJson } from "./latest-json.ts";

const base = {
  version: "0.2.0",
  tag: "v0.2.0",
  bundle: "Magpie_0.2.0_aarch64.app.tar.gz",
  signature: "c2lnbmF0dXJl\n",
  platforms: ["darwin-aarch64"],
  pubDate: new Date("2026-10-27T03:00:00.123Z"),
};

test("points each platform at the release's update bundle with a trimmed signature", () => {
  assert.deepEqual(latestJson(base), {
    version: "0.2.0",
    notes: "",
    pub_date: "2026-10-27T03:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: "c2lnbmF0dXJl",
        url: "https://github.com/gregorymfoster/magpie/releases/download/v0.2.0/Magpie_0.2.0_aarch64.app.tar.gz",
      },
    },
  });
});

test("a universal build serves Apple silicon and Intel from one bundle", () => {
  const j = latestJson({ ...base, bundle: "Magpie_0.2.0_universal.app.tar.gz", platforms: ["darwin-aarch64", "darwin-x86_64"] });
  assert.deepEqual(Object.keys(j.platforms), ["darwin-aarch64", "darwin-x86_64"]);
  assert.equal(j.platforms["darwin-x86_64"].url, j.platforms["darwin-aarch64"].url);
});

test("rejects a version the updater can't compare", () => {
  assert.throws(() => latestJson({ ...base, version: "v0.2.0" }), /semver/);
});

test("rejects an empty signature", () => {
  assert.throws(() => latestJson({ ...base, signature: " \n" }), /signature/);
});
