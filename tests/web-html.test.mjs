import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildRoundContext,
  estimateCallCount,
  normalizeRunMode,
  selectParticipants
} from "../web/orchestrator.js";
import { detectProvider, inferProviderHintFromKey } from "../web/providers.js";

const execFileAsync = promisify(execFile);
async function read(path) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

test("HTML exposes safe provider selection, run modes and stop control", async () => {
  const html = await read("web/index.html");
  for (const id of ["chatPage", "processPanel", "processList", "agentsPage", "agentProfileList", "universalApiKey", "providerHint", "runMode", "debateRounds", "maxDebateAgents", "stopButton", "exportMarkdownButton"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /系统不会再拿一个 Key 轮流试探多个平台/);
  assert.match(html, /快速模式/);
  assert.match(html, /参谋模式/);
  assert.match(html, /深度碰撞/);
});

test("safe key inference refuses ambiguous sk keys", async () => {
  assert.equal(inferProviderHintFromKey("AIza-example"), "gemini");
  assert.equal(inferProviderHintFromKey("sk-proj-example"), "openai");
  assert.equal(inferProviderHintFromKey("sk-ambiguous-provider-key"), null);
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("should not fetch"); };
  await assert.rejects(() => detectProvider("sk-ambiguous-provider-key", 1000, "auto"), /避免把 Key 发送到错误平台/);
  assert.equal(fetchCalled, false);
  globalThis.fetch = originalFetch;
});

test("orchestrator limits participants and preserves own first-round note", () => {
  const providers = [{ id: "deepseek" }, { id: "zhipu" }, { id: "gemini" }];
  const selected = selectParticipants({ providers, primaryId: "deepseek", agentProfiles: { gemini: { participatesInDebate: false } }, maxAgents: 2 });
  assert.deepEqual(selected.map((item) => item.id), ["deepseek", "zhipu"]);
  const previousNotes = [
    { providerId: "deepseek", name: "老D", text: "A" },
    { providerId: "zhipu", name: "智谱参谋", text: "B" }
  ];
  const context = buildRoundContext({ providerId: "deepseek", previousNotes });
  assert.equal(context.ownNote.text, "A");
  assert.deepEqual(context.peerNotes.map((item) => item.text), ["B"]);
});

test("call budget matches quick, advisor and debate modes", () => {
  assert.equal(normalizeRunMode("unknown"), "debate");
  assert.equal(estimateCallCount({ mode: "quick", participantCount: 2, rounds: 2 }), 1);
  assert.equal(estimateCallCount({ mode: "advisor", participantCount: 2, rounds: 2 }), 2);
  assert.equal(estimateCallCount({ mode: "debate", participantCount: 2, rounds: 2 }), 5);
});

test("app persists messages and worklog, supports abort, and avoids fixed overlay composer", async () => {
  const app = await read("web/app.js");
  const css = await read("web/styles.css");
  assert.match(app, /await saveConversation\(conversation\);[\s\S]*createRun/);
  assert.match(app, /AbortController/);
  assert.match(app, /activeConversationId === conversationId/);
  assert.match(app, /conversation\.runs/);
  assert.match(app, /exportCurrentMarkdown/);
  assert.match(css, /grid-template-rows:70px minmax\(0,1fr\) auto/);
  assert.doesNotMatch(css, /\.composer-wrap\{[^}]*position:absolute/);
});

test("service worker does not cache failed responses", async () => {
  const source = await read("web/sw.js");
  assert.match(source, /if \(response\.ok\)/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /orchestrator\.js/);
});

test("all web JavaScript files pass syntax checks", async () => {
  for (const path of ["web/app.js", "web/providers.js", "web/storage.js", "web/orchestrator.js", "web/sw.js"]) {
    const { stderr } = await execFileAsync(process.execPath, ["--check", path], { cwd: new URL("..", import.meta.url) });
    assert.equal(stderr, "");
  }
});
