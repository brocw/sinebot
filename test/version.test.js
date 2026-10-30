import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { VERSION, versionString } from "../src/version.js";

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test("versionString includes the commit when known", () => {
  assert.equal(versionString("1.2.3", "abc1234"), "v1.2.3 (abc1234)");
});

test("versionString omits the commit when unknown", () => {
  assert.equal(versionString("1.2.3", null), "v1.2.3");
});
