import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
async function read(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("HTML version uses Marco Lab workbench with visible agent process", async () => {
  const html = await read("web/index.html");
  for (const id of ["chatPage", "processPanel", "processList", "agentsPage", "agentProfileList", "universalApiKey", "providerHint", "exportMarkdownButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /MARCO LAB/);
  assert.match(html, /Agent 定制/);
  assert.match(html, /右侧显示全过程/);
  assert.match(html, /导出 Markdown/);
  assert.doesNotMatch(html, /召开会议|圆桌会议|geminiApiKey|deepSeekApiKey/);
});

test("browser provider layer forwards custom agent prompts into model calls", async () => {
  const source = await read("web/providers.js");
  assert.match(source, /buildSystemPrompt/);
  assert.match(source, /displayName/);
  assert.match(source, /personality/);
  assert.match(source, /systemPrompt/);
  assert.match(source, /open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(source, /generatePrimary/);
});

test("browser storage has avatars and corrected default profiles for connected agents", async () => {
  const source = await read("web/storage.js");
  assert.match(source, /DEFAULT_AGENT_PROFILES/);
  assert.match(source, /老D/);
  assert.match(source, /智谱参谋/);
  assert.match(source, /displayName:\s*"Gemini"/);
  assert.doesNotMatch(source, /Gemi"/);
  assert.match(source, /avatar/);
  assert.match(source, /AES-GCM/);
});

test("agent UI only renders connected providers and supports avatars", async () => {
  const source = await read("web/app.js");
  assert.match(source, /if \(!providers\.length\)/);
  assert.match(source, /providers\.map\(\(provider\)/);
  assert.match(source, /data-field=\"avatar\"/);
  assert.match(source, /agentAvatar/);
  assert.match(source, /Math\.min\(input\.scrollHeight, maxHeight\)/);
  assert.match(source, /exportCurrentMarkdown/);
});

test("composer is large enough for long prompts and keeps manual resize usable", async () => {
  const css = await read("web/styles.css");
  const app = await read("web/app.js");
  assert.match(css, /min-height:96px/);
  assert.match(css, /max-height:360px/);
  assert.match(css, /resize:vertical/);
  assert.match(app, /currentHeight > targetHeight/);
});

test("all web JavaScript files pass syntax checks", async () => {
  for (const path of ["web/app.js", "web/providers.js", "web/storage.js", "web/sw.js"]) {
    const { stderr } = await execFileAsync(process.execPath, ["--check", path]);
    assert.equal(stderr, "");
  }
});
