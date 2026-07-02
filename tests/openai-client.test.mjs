import assert from "node:assert/strict";
import test from "node:test";
import { generateOpenAI } from "../dist/src/chat/provider-clients.js";

function runtime() {
  return {
    openAIApiKey: "test-key",
    openAIModel: "something-else",
    openAIBaseUrl: "https://api.openai.com/v1",
    geminiApiKey: "",
    geminiModel: "gemini-3.5-flash",
    geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    deepSeekApiKey: "",
    deepSeekModel: "deepseek-chat",
    deepSeekBaseUrl: "https://api.deepseek.com",
    providerRuntime: { timeoutMs: 5000, maxRetries: 0, retryBaseDelayMs: 100 },
    budgetTokens: 24000,
    maxOutputTokens: 4000,
    meetingOutputDir: "conversations",
    consultExperts: true
  };
}

test("OpenAI chat client always sends the final request to gpt-5.5", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ output_text: "最终回答", usage: { total_tokens: 12 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const result = await generateOpenAI(runtime(), [{ id: "1", role: "user", content: "你好", createdAt: "now" }], ["内部建议"]);
    assert.equal(body.model, "gpt-5.5");
    assert.match(body.instructions, /内部建议/);
    assert.equal(body.input[0].role, "user");
    assert.equal(result.text, "最终回答");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
