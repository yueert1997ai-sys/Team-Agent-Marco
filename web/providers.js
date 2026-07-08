import { readProviderSecret } from "./storage.js";

export const PROVIDER_DEFAULTS = {
  deepseek: { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", protocol: "openai-chat" },
  zhipu: { id: "zhipu", label: "智谱 GLM", model: "glm-5.2", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat" },
  openai: { id: "openai", label: "OpenAI", model: "gpt-5.5", baseUrl: "https://api.openai.com/v1", protocol: "openai-responses" },
  gemini: { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", protocol: "gemini" }
};

export async function detectProvider(key, timeoutMs, hint = "auto", custom = {}) {
  const apiKey = key.trim();
  if (!apiKey) throw new Error("请先粘贴 API Key。");
  if (hint === "custom") {
    const label = custom.label?.trim() || "自定义模型";
    const baseUrl = normalizeUrl(custom.baseUrl);
    const model = custom.model?.trim();
    if (!baseUrl || !model) throw new Error("自定义接口需要填写 Base URL 和模型名。");
    const provider = { id: `custom-${crypto.randomUUID()}`, label, model, baseUrl, protocol: "openai-chat" };
    await verifyProvider(provider, apiKey, timeoutMs);
    return provider;
  }
  if (hint !== "auto") {
    const provider = structuredClone(PROVIDER_DEFAULTS[hint]);
    if (!provider) throw new Error("不支持的平台提示。");
    return verifyProvider(provider, apiKey, timeoutMs);
  }
  const order = apiKey.startsWith("AIza") ? ["gemini", "deepseek", "zhipu", "openai"] : ["deepseek", "zhipu", "openai", "gemini"];
  const errors = [];
  for (const id of order) {
    try { return await verifyProvider(structuredClone(PROVIDER_DEFAULTS[id]), apiKey, timeoutMs, true); }
    catch (error) { errors.push(`${PROVIDER_DEFAULTS[id].label}: ${shortError(error)}`); }
  }
  throw new Error(`自动识别失败。可在“平台提示”里直接选择平台后重试。\n${errors.join("\n")}`);
}

export async function generatePrimary({ provider, messages, internalNotes, preferences, agent }) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, "final", { internalNotes });
  if (provider.protocol === "gemini") return callGemini(provider, apiKey, systemPrompt, messages, preferences.timeoutMs, preferences.maxOutputTokens);
  if (provider.protocol === "openai-responses") return callOpenAIResponses(provider, apiKey, systemPrompt, messages, preferences);
  return callOpenAICompatible(provider, apiKey, systemPrompt, messages, preferences.timeoutMs, preferences.maxOutputTokens);
}

export async function consultProvider(provider, messages, timeoutMs, agent) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, "consult", {});
  const recent = messages.slice(-10).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
  const consultantMessages = [{ role: "user", content: `最近对话：\n\n${recent}\n\n请输出你的独立判断，包含：1. 核心看法 2. 风险 3. 你建议总控怎么回。` }];
  if (provider.protocol === "gemini") return callGemini(provider, apiKey, systemPrompt, consultantMessages, timeoutMs, 1600);
  if (provider.protocol === "openai-responses") return callOpenAIResponses(provider, apiKey, systemPrompt, consultantMessages, { timeoutMs, maxOutputTokens: 1600, reasoningEffort: "low" });
  return callOpenAICompatible(provider, apiKey, systemPrompt, consultantMessages, timeoutMs, 1600);
}

export async function debateProvider({ provider, messages, timeoutMs, agent, round, peerNotes }) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, round === 1 ? "debate-round1" : "debate-round2", { peerNotes });
  const recent = messages.slice(-10).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
  const prompt = round === 1
    ? `最近对话：\n\n${recent}\n\n请先独立判断用户问题。输出格式：\n1. 核心判断\n2. 关键问题\n3. 下一步建议\n4. 最大风险`
    : `最近对话：\n\n${recent}\n\n其他 Agent 的初判：\n\n${peerNotes.join("\n\n")}\n\n请进行碰撞式回应。输出格式：\n1. 你同意哪一点\n2. 你反对哪一点\n3. 对方遗漏了什么\n4. 你修正后的建议`;
  const debateMessages = [{ role: "user", content: prompt }];
  if (provider.protocol === "gemini") return callGemini(provider, apiKey, systemPrompt, debateMessages, timeoutMs, 1200);
  if (provider.protocol === "openai-responses") return callOpenAIResponses(provider, apiKey, systemPrompt, debateMessages, { timeoutMs, maxOutputTokens: 1200, reasoningEffort: "low" });
  return callOpenAICompatible(provider, apiKey, systemPrompt, debateMessages, timeoutMs, 1200);
}

function buildSystemPrompt(provider, agent = {}, mode, context = {}) {
  const name = agent.displayName || provider.label;
  const role = agent.role || (mode === "final" ? "总控" : "后台顾问");
  const personality = agent.personality || "直接、清晰、可执行。";
  const custom = agent.systemPrompt || "";
  const modePrompt = {
    consult: "你是后台 Agent，只输出给总控看的独立意见。可以尖锐、可以反对，但要具体。",
    "debate-round1": "你正在参加 Agent 碰撞。第一轮只做独立初判，不要迎合其他人。输出的是可展示的工作发言，不要输出隐藏思维链。",
    "debate-round2": "你正在参加 Agent 碰撞。第二轮需要阅读其他 Agent 的观点，做反驳、补充、修正。输出的是可展示的工作发言，不要输出隐藏思维链。",
    final: "你是当前总控，负责给用户最终回答。阅读所有 Agent 的发言后，给明确结论、关键分歧和下一步动作。不要机械复述每个 Agent。"
  }[mode] || "你是 Team Agent Marco 的一个 Agent。";
  const notes = context.internalNotes?.length ? `Agent 讨论记录：\n\n${context.internalNotes.join("\n\n")}` : "";
  return [`你是 ${name}。底层模型是 ${provider.label} / ${provider.model}。`, `你的角色：${role}。`, `你的表达性格：${personality}。`, custom, modePrompt, notes].filter(Boolean).join("\n\n");
}

async function verifyProvider(provider, apiKey, timeoutMs, quiet = false) {
  try {
    if (provider.protocol === "gemini") {
      const response = await fetchWithTimeout(`${provider.baseUrl}/models?key=${encodeURIComponent(apiKey)}`, { method: "GET" }, timeoutMs);
      if (!response.ok) throw await responseError(response, provider.label);
      const data = await response.json();
      const names = (data.models || []).map((item) => String(item.name || "").replace("models/", ""));
      provider.model = names.find((name) => /flash/i.test(name)) || provider.model;
      return provider;
    }
    let modelsError = null;
    try {
      const modelsResponse = await fetchWithTimeout(`${provider.baseUrl}/models`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, timeoutMs);
      if (modelsResponse.ok) return provider;
      modelsError = await responseError(modelsResponse, provider.label);
    } catch (error) { modelsError = error; }
    if (provider.id === "zhipu" || provider.id.startsWith("custom-")) {
      const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "只回复 OK" }], max_tokens: 2, stream: false }) }, timeoutMs);
      if (response.ok) return provider;
      throw await responseError(response, provider.label);
    }
    throw modelsError || new Error(`${provider.label} 连接失败。`);
  } catch (error) {
    if (quiet) throw error;
    throw new Error(`${provider.label} 连接失败：${shortError(error)}`);
  }
}

async function callOpenAICompatible(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens) {
  const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: provider.model, messages: [{ role: "system", content: systemPrompt }, ...messages.map(({ role, content }) => ({ role, content }))], max_tokens: maxTokens, stream: false }) }, timeoutMs);
  const data = await parseResponse(response, provider.label);
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usage?.total_tokens || 0 };
}

async function callOpenAIResponses(provider, apiKey, systemPrompt, messages, preferences) {
  const response = await fetchWithTimeout(`${provider.baseUrl}/responses`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: provider.model, instructions: systemPrompt, input: messages.map(({ role, content }) => ({ role, content })), reasoning: { effort: preferences.reasoningEffort || "low" }, max_output_tokens: preferences.maxOutputTokens }) }, preferences.timeoutMs);
  const data = await parseResponse(response, provider.label);
  const text = data.output_text?.trim() || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("").trim();
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usage?.total_tokens || 0 };
}

async function callGemini(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens) {
  const transcript = messages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
  const response = await fetchWithTimeout(`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${transcript}` }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }) }, timeoutMs);
  const data = await parseResponse(response, provider.label);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usageMetadata?.totalTokenCount || 0 };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (error?.name === "AbortError") throw new Error("请求超时。"); if (error instanceof TypeError) throw new Error("浏览器无法连接该接口，可能是网络或跨域限制。"); throw error; }
  finally { clearTimeout(timer); }
}
async function parseResponse(response, label) { const text = await response.text(); let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; } if (!response.ok) throw new Error(`${label} 请求失败（HTTP ${response.status}）：${data.error?.message || data.message || text.slice(0, 300)}`); return data; }
async function responseError(response, label) { const text = await response.text(); let message = text.slice(0, 200); try { const data = JSON.parse(text); message = data.error?.message || data.message || message; } catch {} return new Error(`${label} HTTP ${response.status}${message ? `：${message}` : ""}`); }
function normalizeUrl(value) { return value?.trim().replace(/\/+$/, "") || ""; }
function shortError(error) { return String(error?.message || error).replace(/\s+/g, " ").slice(0, 180); }
