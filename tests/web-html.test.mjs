import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("HTML version is a normal chat interface with one universal Key field", async () => {
  const html = await read("web/index.html");
  for (const id of ["chatPage", "chatForm", "chatInput", "settingsPage", "universalApiKey", "providerList"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /GPT-5\.5 固定负责最终回答/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /召开会议|圆桌会议|geminiApiKey|deepSeekApiKey/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
});

test("browser provider layer forces GPT-5.5 and restricts network targets", async () => {
  const source = await read("web/providers.js");
  assert.match(source, /OPENAI_MODEL\s*=\s*["']gpt-5\.5["']/);
  assert.match(source, /model:\s*OPENAI_MODEL/);
  assert.match(source, /api\.openai\.com/);
  assert.match(source, /api\.deepseek\.com/);
  assert.match(source, /generativelanguage\.googleapis\.com/);
});

test("browser storage encrypts remembered Keys and persists conversations locally", async () => {
  const source = await read("web/storage.js");
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
