import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
async function read(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("HTML exposes Marco Lab workbench and debate settings", async () => {
  const html = await read("web/index.html");
  for (const id of ["chatPage", "processPanel", "processList", "agentsPage", "agentProfileList", "universalApiKey", "providerHint", "debateMode", "debateRounds", "exportMarkdownButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /MARCO LAB/);
  assert.match(html, /Agent 碰撞模式/);
  assert.match(html, /2 轮：初判 \+ 反驳修正/);
  assert.doesNotMatch(html, /召开会议|圆桌会议|geminiApiKey|deepSeekApiKey/);
});

test("provider layer supports debate rounds and visible work statements", async () => {
  const source = await read("web/providers.js");
  assert.match(source, /debateProvider/);
  assert.match(source, /debate-round1/);
  assert.match(source, /debate-round2/);
  assert.match(source, /可展示的工作发言/);
  assert.match(source, /open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(source, /generatePrimary/);
});

test("storage defaults include debate mode and corrected profiles", async () => {
  const source = await read("web/storage.js");
  assert.match(source, /debateMode:\s*true/);
  assert.match(source, /debateRounds:\s*2/);
  assert.match(source, /老D/);
  assert.match(source, /智谱参谋/);
  assert.match(source, /displayName:\s*"Gemini"/);
  assert.doesNotMatch(source, /Gemi"/);
  assert.match(source, /AES-GCM/);
});

test("app orchestrates parallel debate and gracefully falls back to single model", async () => {
  const source = await read("web/app.js");
  assert.match(source, /runDebate/);
  assert.match(source, /runDebateRound/);
  assert.match(source, /Promise\.all\(participants\.map/);
  assert.match(source, /未启用碰撞/);
  assert.match(source, /只有一个已接入模型/);
  assert.match(source, /exportCurrentMarkdown/);
  assert.match(source, /Math\.min\(input\.scrollHeight, maxHeight\)/);
});

test("all web JavaScript files pass syntax checks", async () => {
  for (const path of ["web/app.js", "web/providers.js", "web/storage.js", "web/sw.js"]) {
    const { stderr } = await execFileAsync(process.execPath, ["--check", path]);
    assert.equal(stderr, "");
  }
});
