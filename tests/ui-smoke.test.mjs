import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop UI is a normal chat interface with one universal API field", async () => {
  const html = await readFile(new URL("../dist/src/ui/index.html", import.meta.url), "utf8");
  for (const id of ["chatPage", "chatForm", "chatInput", "settingsPage", "universalApiKey", "providerList"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /GPT-5\.5 固定负责最终回答/);
  assert.doesNotMatch(html, /召开会议|圆桌会议|meetingTopic|geminiApiKey|deepSeekApiKey/);
});

test("renderer uses the preload bridge instead of Node integration", async () => {
  const script = await readFile(new URL("../dist/src/ui/app.js", import.meta.url), "utf8");
  assert.match(script, /window\.teamAgent/);
  assert.match(script, /detectAndSaveApiKey/);
  assert.doesNotMatch(script, /require\s*\(/);
});
