import { readProviderSecret } from "./storage.js";

export const PROVIDER_DEFAULTS = {
  deepseek: { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", protocol: "openai-chat" },
  zhipu: { id: "zhipu", label: "智谱 GLM", model: "glm-5.2", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat" },
  openai: { id: "openai", label: "OpenAI", model: "gpt-5.5", baseUrl: "https://api.openai.com/v1", protocol: "openai-responses" },
  gemini: { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", protocol: "gemini" }
};

export function inferProviderHintFromKey(key) {
  const value = String(key || "").trim();
  if (value.startsWith("AIza")) return "gemini";
  if (/^sk-(proj|svcacct)-/i.test(value)) return "openai";
  return null;
}

export async function detectProvider(key, timeoutMs, hint = "auto", custom = {}, signal) {
  const apiKey = String(key || "").trim();
  if (!apiKey) throw new Error("请先粘贴 API Key。");

  if (hint === "auto") {
    const inferred = inferProviderHintFromKey(apiKey);
    if (!inferred) {
      throw new Error("为了避免把 Key 发送到错误平台，请先在“平台提示”中选择对应平台。自动识别只处理特征明确的 Gemini 或 OpenAI Key。");
    }
    hint = inferred;
  }

  if (hint === "custom") {
    const provider = {
      id: `custom-${crypto.randomUUID()}`,
      label: custom.label?.trim() || "自定义模型",
      model: custom.model?.trim(),
      baseUrl: validateBaseUrl(custom.baseUrl),
      protocol: "openai-chat"
    };
    if (!provider.model) throw new Error("自定义接口需要填写模型名。");
    await verifyProvider(provider, apiKey, timeoutMs, signal);
    return provider;
  }

  const defaults = PROVIDER_DEFAULTS[hint];
  if (!defaults) throw new Error("不支持的平台提示。");
  const provider = structuredClone(defaults);
  await verifyProvider(provider, apiKey, timeoutMs, signal);
  return provider;
}

export async function generatePrimary({ provider, messages, internalNotes, preferences, agent, signal }) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, "final", { internalNotes });
  return invokeProvider({ provider, apiKey, systemPrompt, messages, timeoutMs: preferences.timeoutMs, maxTokens: preferences.maxOutputTokens, reasoningEffort: preferences.reasoningEffort || "low", signal });
}

export async function consultProvider({ provider, messages, timeoutMs, agent, signal }) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, "consult", {});
  const recent = formatRecentMessages(messages);
  return invokeProvider({
    provider,
    apiKey,
    systemPrompt,
    messages: [{ role: "user", content: `最近对话：\n\n${recent}\n\n请输出独立工作意见：\n1. 核心判断\n2. 关键风险\n3. 建议总控如何回答` }],
    timeoutMs,
    maxTokens: 900,
    reasoningEffort: "low",
    signal
  });
}

export async function debateProvider({ provider, messages, timeoutMs, agent, round, ownNote, peerNotes, signal }) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const mode = round === 1 ? "debate-round1" : "debate-round2";
  const systemPrompt = buildSystemPrompt(provider, agent, mode, {});
  const recent = formatRecentMessages(messages);
  const prompt = round === 1
    ? `最近对话：\n\n${recent}\n\n请独立判断用户问题。输出：\n1. 核心判断\n2. 关键问题\n3. 下一步建议\n4. 最大风险`
    : `最近对话：\n\n${recent}\n\n你上一轮的初判：\n${ownNote?.text || "上一轮未成功返回"}\n\n其他 Agent 的初判：\n${peerNotes.length ? peerNotes.map((note) => `${note.name}：${note.text}`).join("\n\n") : "没有其他有效发言"}\n\n请进行碰撞式修正。输出：\n1. 你保留的观点\n2. 你同意对方哪一点\n3. 你反对或补充哪一点\n4. 修正后的建议`;
  return invokeProvider({ provider, apiKey, systemPrompt, messages: [{ role: "user", content: prompt }], timeoutMs, maxTokens: 900, reasoningEffort: "low", signal });
}

function buildSystemPrompt(provider, agent = {}, mode, context = {}) {
  const name = agent.displayName || provider.label;
  const role = agent.role || (mode === "final" ? "总控" : "后台顾问");
  const personality = agent.personality || "直接、清晰、可执行。";
  const custom = agent.systemPrompt || "";
  const instructions = {
    consult: "你是后台参谋。只输出可展示的工作意见，观点要具体。",
    "debate-round1": "你正在参加 Agent 碰撞。第一轮独立判断，不迎合其他 Agent。只展示结论、依据、风险和建议，不输出隐藏思维链。",
    "debate-round2": "你正在参加 Agent 碰撞。阅读自己和其他 Agent 的初判，明确保留、反对、补充和修正。只展示工作发言，不输出隐藏思维链。",
    final: "你是当前总控。阅读讨论记录后自行裁决，给用户明确结论、关键分歧和下一步动作。不要机械复述讨论。"
  }[mode] || "你是 Team Agent Marco 的一个 Agent。";
  const notes = context.internalNotes?.length ? `Agent 讨论记录：\n\n${context.internalNotes.join("\n\n")}` : "";
  return [`你是 ${name}。底层模型：${provider.label} / ${provider.model}。`, `角色：${role}。`, `表达性格：${personality}。`, custom, instructions, notes].filter(Boolean).join("\n\n");
}

async function verifyProvider(provider, apiKey, timeoutMs, signal) {
  if (provider.protocol === "gemini") {
    const response = await fetchWithTimeout(`${provider.baseUrl}/models?key=${encodeURIComponent(apiKey)}`, { method: "GET" }, timeoutMs, signal);
    if (!response.ok) throw await responseError(response, provider.label);
    const data = await response.json();
    const names = (data.models || []).map((item) => String(item.name || "").replace("models/", ""));
    provider.model = names.find((name) => /flash/i.test(name)) || provider.model;
    return provider;
  }

  let modelsError = null;
  try {
    const modelsResponse = await fetchWithTimeout(`${provider.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    }, timeoutMs, signal);
    if (modelsResponse.ok) return provider;
    modelsError = await responseError(modelsResponse, provider.label);
  } catch (error) {
    modelsError = error;
  }

  if (provider.id === "zhipu" || provider.id.startsWith("custom-")) {
    const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: "只回复 OK" }], max_tokens: 2, stream: false })
    }, timeoutMs, signal);
    if (response.ok) return provider;
    throw await responseError(response, provider.label);
  }
  throw modelsError || new Error(`${provider.label} 连接失败。`);
}

async function invokeProvider({ provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, reasoningEffort, signal }) {
  const startedAt = performance.now();
  let result;
  if (provider.protocol === "gemini") result = await callGemini(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal);
  else if (provider.protocol === "openai-responses") result = await callOpenAIResponses(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, reasoningEffort, signal);
  else result = await callOpenAICompatible(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal);
  return { ...result, elapsedMs: Math.round(performance.now() - startedAt) };
}

async function callOpenAICompatible(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal) {
  const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: provider.model, messages: [{ role: "system", content: systemPrompt }, ...messages.map(({ role, content }) => ({ role, content }))], max_tokens: maxTokens, stream: false })
  }, timeoutMs, signal);
  const data = await parseResponse(response, provider.label);
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usage?.total_tokens || 0 };
}

async function callOpenAIResponses(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, reasoningEffort, signal) {
  const response = await fetchWithTimeout(`${provider.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: provider.model, instructions: systemPrompt, input: messages.map(({ role, content }) => ({ role, content })), reasoning: { effort: reasoningEffort || "low" }, max_output_tokens: maxTokens })
  }, timeoutMs, signal);
  const data = await parseResponse(response, provider.label);
  const text = data.output_text?.trim() || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("").trim();
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usage?.total_tokens || 0 };
}

async function callGemini(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal) {
  const contents = messages.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  const response = await fetchWithTimeout(`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } })
  }, timeoutMs, signal);
  const data = await parseResponse(response, provider.label);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usageMetadata?.totalTokenCount || 0 };
}

async function fetchWithTimeout(url, init, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason || new DOMException("Aborted", "AbortError"));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "AbortError")), timeoutMs || 120000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) throw new DOMException("用户已停止生成。", "AbortError");
      throw new Error("请求超时。");
    }
    if (error instanceof TypeError) throw new Error("浏览器无法连接该接口，可能是网络或跨域限制。");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function parseResponse(response, label) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${label} 请求失败（HTTP ${response.status}）：${data.error?.message || data.message || text.slice(0, 240)}`);
  return data;
}

async function responseError(response, label) {
  const text = await response.text();
  let message = text.slice(0, 180);
  try { const data = JSON.parse(text); message = data.error?.message || data.message || message; } catch {}
  return new Error(`${label} HTTP ${response.status}${message ? `：${message}` : ""}`);
}

function formatRecentMessages(messages) {
  return messages.slice(-10).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
}

function validateBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("Base URL 格式不正确。"); }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("自定义接口必须使用 HTTPS；本机 localhost 调试可使用 HTTP。");
  if (url.username || url.password) throw new Error("Base URL 不能包含用户名或密码。");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}
