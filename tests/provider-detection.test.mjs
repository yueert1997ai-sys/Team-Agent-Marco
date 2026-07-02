import assert from "node:assert/strict";
import test from "node:test";
import { detectProvider } from "../dist/src/app/provider-detection.js";

test("auto-detects OpenAI key by probing model endpoints", async () => {
  const fetchImpl = async (url) => new Response("{}", { status: String(url).startsWith("https://api.openai.com/") ? 200 : 401 });
  const result = await detectProvider("sk-test-openai", { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.provider, "openai");
  assert.equal(result.defaultModel, "gpt-5.5");
});

test("auto-detects Gemini key without a provider selector", async () => {
  const fetchImpl = async (url) => new Response("{}", { status: String(url).includes("generativelanguage.googleapis.com") ? 200 : 401 });
  const result = await detectProvider("AIza-test", { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.provider, "gemini");
});

test("rejects an unrecognized key", async () => {
  const fetchImpl = async () => new Response("unauthorized", { status: 401 });
  await assert.rejects(detectProvider("bad-key", { fetchImpl, timeoutMs: 1000 }), /无法识别/);
});
