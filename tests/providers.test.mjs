import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GeminiProvider } from "../dist/src/providers/gemini.js";
import { DeepSeekProvider } from "../dist/src/providers/deepseek.js";
import { parseAndValidateStructured } from "../dist/src/providers/structured.js";
import { parseModelRoute } from "../dist/src/providers/multi-provider-executor.js";
import { saveMeetingResult } from "../dist/src/storage/meeting-store.js";

const runtime = { timeoutMs: 5_000, maxRetries: 1, retryBaseDelayMs: 1 };
const schema = { type: "object", additionalProperties: false, required: ["name", "score"], properties: { name: { type: "string" }, score: { type: "number", minimum: 0, maximum: 1 } } };

test("Gemini provider sends structured-output request shape", async () => {
  const originalFetch = globalThis.fetch; let captured;
  globalThis.fetch = async (url, init) => { captured = { url: String(url), body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"name\":\"gemini\",\"score\":0.9}" }] } }], usageMetadata: { totalTokenCount: 15 } }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const provider = new GeminiProvider({ apiKey: "placeholder", runtime });
    const result = await provider.generate({ prompt: "Return JSON", model: "gemini-3.5-flash", options: { label: "test", access: "read", schema, maxOutputTokens: 300 } });
    assert.deepEqual(result.value, { name: "gemini", score: 0.9 });
    assert.equal(result.usage.totalTokens, 15);
    assert.match(captured.url, /gemini-3\.5-flash:generateContent$/);
    assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  } finally { globalThis.fetch = originalFetch; }
});

test("DeepSeek provider uses chat model and JSON mode", async () => {
  const originalFetch = globalThis.fetch; let captured;
  globalThis.fetch = async (url, init) => { captured = { url: String(url), body: JSON.parse(String(init.body)) }; return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"name\":\"deepseek\",\"score\":0.8}" } }], usage: { total_tokens: 18 } }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const provider = new DeepSeekProvider({ apiKey: "placeholder", runtime });
    const result = await provider.generate({ prompt: "Return JSON", model: "deepseek-chat", options: { label: "test", access: "read", schema, maxOutputTokens: 350 } });
    assert.deepEqual(result.value, { name: "deepseek", score: 0.8 });
    assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
    assert.deepEqual(captured.body.response_format, { type: "json_object" });
    assert.equal(captured.body.max_tokens, 350);
  } finally { globalThis.fetch = originalFetch; }
});

test("HTTP layer retries a transient provider failure", async () => {
  const originalFetch = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts += 1; if (attempts === 1) return new Response("busy", { status: 503 }); return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"name\":\"ok\",\"score\":1}" } }], usage: { total_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    const provider = new DeepSeekProvider({ apiKey: "placeholder", runtime });
    const result = await provider.generate({ prompt: "Return JSON", model: "deepseek-chat", options: { label: "test", access: "read", schema } });
    assert.equal(attempts, 2); assert.equal(result.value.name, "ok");
  } finally { globalThis.fetch = originalFetch; }
});

test("structured parser rejects invalid schema output", () => { assert.throws(() => parseAndValidateStructured("test", "{\"name\":\"x\",\"score\":3}", schema), /failed validation/); });

test("model routing supports provider prefixes and defaults", () => {
  assert.deepEqual(parseModelRoute("gemini/gemini-3.5-flash", "mock"), { providerId: "gemini", model: "gemini-3.5-flash" });
  assert.deepEqual(parseModelRoute("custom-model", "deepseek"), { providerId: "deepseek", model: "custom-model" });
});

test("meeting store writes JSON and Markdown records", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-agent-meeting-"));
  const result = { meetingId: "m1", title: "测试会议", firstRound: [], digest: { consensus: [], disagreements: [], missingInformation: [], questions: [], needsDiscussion: false }, secondRound: [], finalDecision: { summary: "summary", decision: "decision", rationale: ["reason"], acceptedPoints: [], rejectedPoints: [], unresolved: [], nextActions: [{ owner: "Marco", action: "test", priority: "high" }], confidence: 1 }, failedMembers: [], estimatedUsageTokens: 10 };
  try { const paths = await saveMeetingResult(result, dir, { mode: "mock" }); assert.match(await readFile(paths.markdownPath, "utf8"), /测试会议/); assert.equal(JSON.parse(await readFile(paths.jsonPath, "utf8")).result.meetingId, "m1"); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("provider retries invalid structured output", async () => {
  const originalFetch = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts += 1; const content = attempts === 1 ? "{\"name\":\"broken\",\"score\":9}" : "{\"name\":\"fixed\",\"score\":0.7}"; return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage: { total_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  try { const provider = new DeepSeekProvider({ apiKey: "placeholder", runtime }); const result = await provider.generate({ prompt: "Return JSON", model: "deepseek-chat", options: { label: "test", access: "read", schema } }); assert.equal(attempts, 2); assert.equal(result.value.name, "fixed"); } finally { globalThis.fetch = originalFetch; }
});
