import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("HTML version uses a minimal light chat interface", async () => {
  const html = await read("web/index.html");
  for (const id of ["chatPage", "chatForm", "chatInput", "settingsPage", "universalApiKey", "providerHint", "providerList"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /theme-color" content="#ffffff"/);
  assert.match(html, /DeepSeek 将作为当前总控/);
  assert.match(html, /智谱 GLM/);
  assert.match(html, /其他 OpenAI 兼容接口/);
  assert.doesNotMatch(html, /召开会议|圆桌会议|geminiApiKey|deepSeekApiKey/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
});

test("browser provider layer supports DeepSeek, GLM, OpenAI, Gemini and custom compatible APIs", async () => {
  const source = await read("web/providers.js");
  assert.match(source, /api\.deepseek\.com/);
  assert.match(source, /open\.bigmodel\.cn\/api\/paas\/v4/);
  assert.match(source, /glm-5\.2/);
  assert.match(source, /api\.openai\.com/);
  assert.match(source, /generativelanguage\.googleapis\.com/);
  assert.match(source, /custom-\$\{crypto\.randomUUID\(\)\}/);
  assert.match(source, /generatePrimary/);
});

test("DeepSeek is the default primary provider preference", async () => {
  const source = await read("web/storage.js");
  assert.match(source, /primaryProviderId:\s*["']deepseek["']/);
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /AES-GCM/);
  assert.match(source, /saveConversation/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^)]*key/i);
});

test("all web JavaScript files pass syntax checks", async () => {
  for (const path of ["web/app.js", "web/providers.js", "web/storage.js", "web/sw.js"]) {
    const { stderr } = await execFileAsync(process.execPath, ["--check", path]);
    assert.equal(stderr, "");
  }
});
