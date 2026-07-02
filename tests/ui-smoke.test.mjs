import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop UI contains meeting, settings, agents and history pages", async () => {
  const html = await readFile(new URL("../dist/src/ui/index.html", import.meta.url), "utf8");
  for (const id of ["page-meeting", "page-agents", "page-settings", "page-history", "geminiApiKey", "deepSeekApiKey"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("renderer uses the preload bridge instead of Node integration", async () => {
  const script = await readFile(new URL("../dist/src/ui/app.js", import.meta.url), "utf8");
  assert.match(script, /window\.teamAgent/);
  assert.doesNotMatch(script, /require\s*\(/);
});
