import { readProviderSecret } from "./storage.js";
import { getRecipe } from "./orchestrator.js";

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
      throw new Error("为了避免把 Key 发送到错误平台，请先选择对应平台。自动识别只处理特征明确的 Gemini 或 OpenAI Key。");
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
  if (!defaults) throw new Error("不支持的平台。");
  const provider = structuredClone(defaults);
  await verifyProvider(provider, apiKey, timeoutMs, signal);
  return provider;
}

export async function generatePrimary({
  provider,
  messages,
  internalNotes,
  preferences,
  agent,
  recipe,
  projectMemory,
  signal
}) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const systemPrompt = buildSystemPrompt(provider, agent, "final", {
    internalNotes,
    recipe,
    projectMemory
  });
  return invokeProvider({
    provider,
    apiKey,
    systemPrompt,
    messages,
    timeoutMs: preferences.timeoutMs,
    maxTokens: preferences.maxOutputTokens,
    reasoningEffort: preferences.reasoningEffort || "low",
    signal
  });
}

export async function consultProvider({
  provider,
  messages,
  timeoutMs,
  agent,
  recipe,
  projectMemory,
  signal
}) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const recipeSpec = getRecipe(recipe);
  const systemPrompt = buildSystemPrompt(provider, agent, "consult", { recipe, projectMemory });
  const recent = formatRecentMessages(messages);
  return invokeProvider({
    provider,
    apiKey,
    systemPrompt,
    messages: [{
      role: "user",
      content: `最近对话：\n\n${recent}\n\n你的参谋任务：\n${recipeSpec.round1Prompt}\n\n只输出有增量的审查意见，不要重复用户已经知道的背景。`
    }],
    timeoutMs,
    maxTokens: 800,
    reasoningEffort: "low",
    signal
  });
}

export async function debateProvider({
  provider,
  messages,
  timeoutMs,
  agent,
  round,
  ownNote,
  peerNotes,
  recipe,
  projectMemory,
  signal
}) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const recipeSpec = getRecipe(recipe);
  const mode = round === 1 ? "debate-round1" : "debate-round2";
  const systemPrompt = buildSystemPrompt(provider, agent, mode, { recipe, projectMemory });
  const recent = formatRecentMessages(messages);
  const prompt = round === 1
    ? `最近对话：\n\n${recent}\n\n本轮任务：\n${recipeSpec.round1Prompt}\n\n输出最有价值的判断、依据、风险和建议。`
    : `最近对话：\n\n${recent}\n\n你上一轮的初判：\n${ownNote?.text || "上一轮未成功返回"}\n\n其他 Agent 的初判：\n${peerNotes.length ? peerNotes.map((note) => `${note.name}：${note.text}`).join("\n\n") : "没有其他有效发言"}\n\n本轮任务：\n${recipeSpec.round2Prompt}\n\n明确哪些观点保留、哪些被修正，并给出更好的版本。`;

  return invokeProvider({
    provider,
    apiKey,
    systemPrompt,
    messages: [{ role: "user", content: prompt }],
    timeoutMs,
    maxTokens: 850,
    reasoningEffort: "low",
    signal
  });
}

function buildSystemPrompt(provider, agent = {}, mode, context = {}) {
  const recipeSpec = getRecipe(context.recipe);
  const name = agent.displayName || provider.label;
  const role = agent.role || (mode === "final" ? "总控" : "后台顾问");
  const personality = agent.personality || "直接、清晰、可执行。";
  const custom = agent.systemPrompt || "";
  const instructions = {
    consult: "你是后台参谋。只输出能改变总控判断的增量信息，观点要具体。",
    "debate-round1": "你正在参加 Agent 工作讨论。第一轮独立判断，不迎合其他 Agent。只展示结论、依据、风险和建议，不输出隐藏思维链。",
    "debate-round2": "你正在参加 Agent 工作讨论。阅读自己和其他 Agent 的初判，明确保留、反对、补充和修正。只展示工作发言，不输出隐藏思维链。",
    final: `你是当前总控。阅读讨论记录后自行裁决，不要机械复述讨论。最终回答必须优先给结果，并按以下标题组织：${recipeSpec.finalSections.map((item) => `“${item}”`).join("、")}。`
  }[mode] || "你是 Team Agent Marco 的一个 Agent。";

  const notes = context.internalNotes?.length
    ? `Agent 讨论记录：\n\n${context.internalNotes.join("\n\n")}`
    : "";
  const project = formatProjectMemory(context.projectMemory);

  return [
    `你是 ${name}。底层模型：${provider.label} / ${provider.model}。`,
    `角色：${role}。`,
    `表达性格：${personality}。`,
    `当前任务类型：${recipeSpec.label}。`,
    project,
    custom,
    instructions,
    notes
  ].filter(Boolean).join("\n\n");
}

function formatProjectMemory(memory = {}) {
  const parts = [
    memory.name ? `项目：${memory.name}` : "",
    memory.goal ? `项目目标：${memory.goal}` : "",
    memory.context ? `固定背景：${memory.context}` : "",
    memory.constraints ? `硬约束：${memory.constraints}` : "",
    memory.decisions ? `已确认决定：${memory.decisions}` : ""
  ].filter(Boolean);
  return parts.length ? `项目记忆（视为长期有效背景）：\n${parts.join("\n")}` : "";
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
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "只回复 OK" }],
        max_tokens: 2,
        stream: false
      })
    }, timeoutMs, signal);
    if (response.ok) return provider;
    throw await responseError(response, provider.label);
  }
  throw modelsError || new Error(`${provider.label} 连接失败。`);
}

async function invokeProvider({
  provider,
  apiKey,
  systemPrompt,
  messages,
  timeoutMs,
  maxTokens,
  reasoningEffort,
  signal
}) {
  const startedAt = performance.now();
  let result;
  if (provider.protocol === "gemini") {
    result = await callGemini(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal);
  } else if (provider.protocol === "openai-responses") {
    result = await callOpenAIResponses(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, reasoningEffort, signal);
  } else {
    result = await callOpenAICompatible(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal);
  }
  return { ...result, elapsedMs: Math.round(performance.now() - startedAt) };
}

async function callOpenAICompatible(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal) {
  const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map(({ role, content }) => ({ role, content }))
      ],
      max_tokens: maxTokens,
      stream: false
    })
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
    body: JSON.stringify({
      model: provider.model,
      instructions: systemPrompt,
      input: messages.map(({ role, content }) => ({ role, content })),
      reasoning: { effort: reasoningEffort || "low" },
      max_output_tokens: maxTokens
    })
  }, timeoutMs, signal);
  const data = await parseResponse(response, provider.label);
  const text = data.output_text?.trim()
    || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("").trim();
  if (!text) throw new Error(`${provider.label} 没有返回可显示的内容。`);
  return { text, usage: data.usage?.total_tokens || 0 };
}

async function callGemini(provider, apiKey, systemPrompt, messages, timeoutMs, maxTokens, signal) {
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const response = await fetchWithTimeout(
    `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
      })
    },
    timeoutMs,
    signal
  );
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
  if (!response.ok) {
    throw new Error(`${label} 请求失败（HTTP ${response.status}）：${data.error?.message || data.message || text.slice(0, 240)}`);
  }
  return data;
}

async function responseError(response, label) {
  const text = await response.text();
  let message = text.slice(0, 180);
  try {
    const data = JSON.parse(text);
    message = data.error?.message || data.message || message;
  } catch {}
  return new Error(`${label} HTTP ${response.status}${message ? `：${message}` : ""}`);
}

function formatRecentMessages(messages) {
  return messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n\n");
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Base URL 格式不正确。");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("Base URL 必须使用 HTTPS；本机 localhost 调试除外。");
  if (url.username || url.password) throw new Error("Base URL 不能包含用户名或密码。");
  return url.toString().replace(/\/+$/, "");
}
