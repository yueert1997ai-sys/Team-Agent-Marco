import {
  initializeStorage,
  getConversation,
  listConversations,
  loadAgentProfiles,
  loadPreferences,
  loadProviders,
  removeProviderSecret,
  saveAgentProfiles,
  saveConversation,
  savePreferences,
  saveProviderSecret,
  saveProviders,
  DEFAULT_AGENT_PROFILES
} from "./storage.js";
import {
  PROVIDER_DEFAULTS,
  consultProvider,
  debateProvider,
  detectProvider,
  generatePrimary
} from "./providers.js";

let preferences;
let providers = [];
let agentProfiles = {};
let activeConversationId = null;
let sending = false;
let processCounter = 0;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  preferences = await loadPreferences();
  providers = normalizeProviders(await loadProviders());
  agentProfiles = await loadAgentProfiles();
  if (providers.some((provider) => provider.id === "deepseek") && !providers.some((provider) => provider.id === preferences.primaryProviderId)) {
    preferences.primaryProviderId = "deepseek";
    await savePreferences(preferences);
  }
  bindEvents();
  renderSettings();
  renderPrimaryState();
  renderAgentProfiles();
  await loadConversationList();
  resizeInput(true);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined);
});

function bindEvents() {
  $("newChatButton").onclick = newChat;
  $("openSettingsButton").onclick = () => showPage("settings");
  $("openAgentsButton").onclick = () => showPage("agents");
  document.querySelectorAll(".backToChatButton").forEach((button) => button.onclick = () => showPage("chat"));
  $("chatForm").onsubmit = sendMessage;
  $("chatInput").oninput = () => resizeInput(false);
  $("chatInput").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      $("chatForm").requestSubmit();
    }
  };
  $("exportMarkdownButton")?.addEventListener("click", exportCurrentMarkdown);
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  $("toggleKeyButton").onclick = toggleKeyVisibility;
  $("providerHint").onchange = toggleCustomFields;
  $("detectKeyButton").onclick = detectAndSaveKey;
  $("savePreferencesButton").onclick = persistPreferences;
  $("saveAgentsButton").onclick = persistAgents;
}

function showPage(page) {
  $("chatPage").classList.toggle("active", page === "chat");
  $("settingsPage").classList.toggle("active", page === "settings");
  $("agentsPage").classList.toggle("active", page === "agents");
  if (page === "agents") renderAgentProfiles();
}

function fillSuggestion(text) {
  $("chatInput").value = text;
  resizeInput(false);
  $("chatInput").focus();
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text || sending) return;
  const primary = getPrimaryProvider();
  if (!primary) {
    showPage("settings");
    toast("请先连接一个模型。DeepSeek 会优先成为总控。", true);
    return;
  }

  sending = true;
  $("sendButton").disabled = true;
  $("welcome")?.classList.add("hidden");
  clearProcess();
  const conversation = await getOrCreateConversation(text);
  const userMessage = createMessage("user", text);
  conversation.messages.push(userMessage);
  conversation.updatedAt = userMessage.createdAt;
  appendMessage(userMessage);
  $("chatInput").value = "";
  resizeInput(true);
  addProcess("input", "收到任务", text, "done");
  setStatus(`${agentName(primary)} 正在拆题`);
  const thinking = appendThinking(agentName(primary));

  try {
    const { internalNotes, consulted } = await buildInternalNotes(primary, conversation.messages);
    const primaryStep = addProcess(primary.id, `${agentName(primary)} 最终整合`, internalNotes.length ? "正在阅读 Agent 碰撞记录…" : "无辅助 Agent，直接生成回答…", "running");
    setStatus(`${agentName(primary)} 正在组织最终回复`);
    const final = await generatePrimary({ provider: primary, messages: conversation.messages, internalNotes, preferences, agent: getAgent(primary.id) });
    updateProcess(primaryStep, final.text, "done");
    const assistantMessage = createMessage("assistant", final.text);
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = assistantMessage.createdAt;
    await saveConversation(conversation);
    thinking.remove();
    appendMessage(assistantMessage, consulted, final.usage);
    $("conversationTitle").textContent = conversation.title;
    setStatus(consulted.length ? `${agentName(primary)} 已参考 ${consulted.join("、")}` : `${agentName(primary)} 已回答`);
    await loadConversationList();
  } catch (error) {
    thinking.remove();
    addProcess("error", "运行失败", readError(error), "error");
    appendMessage(createMessage("assistant", `运行失败：${readError(error)}`));
    setStatus("发送失败");
  } finally {
    sending = false;
    $("sendButton").disabled = false;
    $("chatInput").focus();
  }
}

async function buildInternalNotes(primary, messages) {
  if (!preferences.consultExperts) return { internalNotes: [], consulted: [] };
  if (preferences.debateMode) return runDebate(primary, messages);
  return runOneShotConsult(primary, messages);
}

async function runOneShotConsult(primary, messages) {
  const internalNotes = [];
  const consulted = [];
  const experts = providers.filter((provider) => provider.id !== primary.id);
  if (!experts.length) return { internalNotes, consulted };
  setStatus("辅助 Agent 并行分析中");
  await Promise.all(experts.map(async (provider) => {
    const step = addProcess(provider.id, `${agentName(provider)} 发言`, "等待接口返回…", "running");
    try {
      const result = await consultProvider(provider, messages, preferences.timeoutMs, getAgent(provider.id));
      updateProcess(step, result.text || "没有有效内容", "done");
      if (result?.text) {
        internalNotes.push(`${agentName(provider)}（${getAgent(provider.id).role || provider.label}）：${result.text}`);
        consulted.push(agentName(provider));
      }
    } catch (error) {
      updateProcess(step, readError(error), "error");
    }
  }));
  return { internalNotes, consulted };
}

async function runDebate(primary, messages) {
  const participants = orderParticipants(primary);
  const internalNotes = [];
  const consulted = [];
  if (participants.length < 2) {
    addProcess("system", "未启用碰撞", "只有一个已接入模型，自动退化为单 Agent 直接回答。", "done");
    return { internalNotes, consulted };
  }

  setStatus("Agent 碰撞 Round 1：独立初判");
  const round1 = await runDebateRound(participants, messages, 1, []);
  internalNotes.push(...round1.map(formatDebateNote));
  round1.forEach((note) => consulted.push(note.name));

  const rounds = clampInteger(preferences.debateRounds, 1, 2, 2);
  if (rounds >= 2 && round1.length) {
    setStatus("Agent 碰撞 Round 2：互相反驳和修正");
    const round2 = await runDebateRound(participants, messages, 2, round1);
    internalNotes.push(...round2.map(formatDebateNote));
    round2.forEach((note) => consulted.push(note.name));
  }

  return { internalNotes, consulted: Array.from(new Set(consulted)) };
}

async function runDebateRound(participants, messages, round, previousNotes) {
  const notes = [];
  await Promise.all(participants.map(async (provider) => {
    const title = round === 1 ? `${agentName(provider)} 初判` : `${agentName(provider)} 反驳 / 修正`;
    const step = addProcess(provider.id, title, "等待接口返回…", "running");
    try {
      const peerNotes = previousNotes
        .filter((note) => note.providerId !== provider.id)
        .map((note) => `${note.name}：${note.text}`);
      const result = await debateProvider({ provider, messages, timeoutMs: preferences.timeoutMs, agent: getAgent(provider.id), round, peerNotes });
      updateProcess(step, result.text || "没有有效内容", "done");
      if (result?.text) notes.push({ providerId: provider.id, name: agentName(provider), round, text: result.text });
    } catch (error) {
      updateProcess(step, readError(error), "error");
    }
  }));
  return participants
    .map((provider) => notes.find((note) => note.providerId === provider.id))
    .filter(Boolean);
}

function orderParticipants(primary) {
  return [primary, ...providers.filter((provider) => provider.id !== primary.id)];
}

function formatDebateNote(note) {
  return `Round ${note.round} · ${note.name}\n${note.text}`;
}

async function detectAndSaveKey() {
  const key = $("universalApiKey").value.trim();
  if (!key) return showDetectMessage("请先粘贴 API Key。", true);
  const hint = $("providerHint").value;
  const custom = { label: $("customLabel").value, baseUrl: $("customBaseUrl").value, model: $("customModel").value };
  const button = $("detectKeyButton");
  button.disabled = true;
  button.textContent = "连接中…";
  try {
    const detected = await detectProvider(key, preferences.timeoutMs, hint, custom);
    await saveProviderSecret(detected.id, key, $("rememberKey").checked);
    providers = [...providers.filter((provider) => provider.id !== detected.id), detected];
    if (!agentProfiles[detected.id]) agentProfiles[detected.id] = defaultAgentFor(detected);
    if (detected.id === "deepseek" || !getPrimaryProvider()) preferences.primaryProviderId = detected.id;
    await Promise.all([saveProviders(providers), savePreferences(preferences), saveAgentProfiles(agentProfiles)]);
    $("universalApiKey").value = "";
    showDetectMessage(`已连接 ${detected.label} · ${detected.model}`);
    renderProviders();
    renderPrimaryState();
    renderAgentProfiles();
    toast(`${detected.label} 已连接`);
  } catch (error) {
    showDetectMessage(readError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "连接";
  }
}

async function persistPreferences() {
  preferences = {
    ...preferences,
    consultExperts: $("consultExperts").checked,
    debateMode: $("debateMode").checked,
    debateRounds: clampInteger($("debateRounds").value, 1, 2, 2),
    showProcess: $("showProcess").checked,
    maxOutputTokens: clampInteger($("maxOutputTokens").value, 100, 128000, 4000),
    timeoutMs: clampInteger($("timeoutMs").value, 5000, 600000, 120000)
  };
  await savePreferences(preferences);
  $("processPanel").classList.toggle("hidden", !preferences.showProcess);
  toast("已保存");
}

async function persistAgents() {
  const next = { ...agentProfiles };
  document.querySelectorAll(".agent-card").forEach((card) => {
    const id = card.dataset.agent;
    next[id] = {
      avatar: card.querySelector('[data-field="avatar"]').value.trim(),
      displayName: card.querySelector('[data-field="displayName"]').value.trim(),
      role: card.querySelector('[data-field="role"]').value.trim(),
      personality: card.querySelector('[data-field="personality"]').value.trim(),
      systemPrompt: card.querySelector('[data-field="systemPrompt"]').value.trim()
    };
  });
  agentProfiles = next;
  await saveAgentProfiles(agentProfiles);
  renderProviders();
  renderPrimaryState();
  renderAgentProfiles();
  toast("Agent 配置已保存");
}

function renderSettings() {
  $("consultExperts").checked = preferences.consultExperts;
  $("debateMode").checked = preferences.debateMode;
  $("debateRounds").value = String(clampInteger(preferences.debateRounds, 1, 2, 2));
  $("showProcess").checked = preferences.showProcess;
  $("maxOutputTokens").value = preferences.maxOutputTokens;
  $("timeoutMs").value = preferences.timeoutMs;
  $("processPanel").classList.toggle("hidden", !preferences.showProcess);
  toggleCustomFields();
  renderProviders();
  renderPrimaryState();
}

function renderProviders() {
  const box = $("providerList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message">还没有连接模型。你可以先添加 DeepSeek 或智谱 GLM。</div>`;
    return;
  }
  box.innerHTML = providers.map((provider) => {
    const isPrimary = provider.id === preferences.primaryProviderId;
    return `<div class="provider-row"><div class="provider-title"><div class="agent-inline"><span class="avatar">${escapeHtml(agentAvatar(provider.id))}</span><div><strong>${escapeHtml(agentName(provider))}${isPrimary ? '<span class="primary-tag">总控</span>' : ""}</strong><small>${escapeHtml(provider.label)} · ${escapeHtml(provider.baseUrl)}</small></div></div></div><input class="provider-model" data-provider="${escapeHtml(provider.id)}" value="${escapeHtml(provider.model)}" aria-label="模型名称">${isPrimary ? "<span></span>" : `<button class="set-primary" data-provider="${escapeHtml(provider.id)}">设为总控</button>`}<button class="danger remove-provider" data-provider="${escapeHtml(provider.id)}">移除</button></div>`;
  }).join("");
  box.querySelectorAll(".provider-model").forEach((input) => input.onchange = async () => {
    providers = providers.map((provider) => provider.id === input.dataset.provider ? { ...provider, model: input.value.trim() || provider.model } : provider);
    await saveProviders(providers);
    renderPrimaryState();
    toast("模型名已更新");
  });
  box.querySelectorAll(".set-primary").forEach((button) => button.onclick = async () => {
    preferences.primaryProviderId = button.dataset.provider;
    await savePreferences(preferences);
    renderProviders();
    renderPrimaryState();
    toast("总控已切换");
  });
  box.querySelectorAll(".remove-provider").forEach((button) => button.onclick = async () => {
    const removedId = button.dataset.provider;
    await removeProviderSecret(removedId);
    providers = providers.filter((provider) => provider.id !== removedId);
    if (preferences.primaryProviderId === removedId) {
      preferences.primaryProviderId = providers.find((provider) => provider.id === "deepseek")?.id || providers[0]?.id || "deepseek";
      await savePreferences(preferences);
    }
    await saveProviders(providers);
    renderProviders();
    renderPrimaryState();
    renderAgentProfiles();
    toast("已移除模型");
  });
}

function renderAgentProfiles() {
  const box = $("agentProfileList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message">先去“模型接入”添加 API。这里只显示已经接入的模型。</div>`;
    return;
  }
  box.innerHTML = providers.map((provider) => {
    const agent = getAgent(provider.id, provider);
    return `<article class="agent-card" data-agent="${escapeHtml(provider.id)}"><div class="agent-card-head"><div class="agent-inline"><span class="avatar">${escapeHtml(agentAvatar(provider.id))}</span><strong>${escapeHtml(agent.displayName || provider.label)}</strong></div><small>${escapeHtml(provider.label)} · ${escapeHtml(provider.model)}</small></div><label>头像 / 代号<input data-field="avatar" maxlength="4" value="${escapeHtml(agent.avatar || "")}" placeholder="D"></label><label>名字<input data-field="displayName" value="${escapeHtml(agent.displayName || "")}"></label><label>定位<input data-field="role" value="${escapeHtml(agent.role || "")}"></label><label>性格<textarea data-field="personality" rows="2">${escapeHtml(agent.personality || "")}</textarea></label><label>自定义提示词<textarea data-field="systemPrompt" rows="4">${escapeHtml(agent.systemPrompt || "")}</textarea></label></article>`;
  }).join("");
}

function renderPrimaryState() {
  const primary = getPrimaryProvider();
  const label = primary ? `${agentName(primary)} · ${primary.model}` : "未连接";
  $("primaryModelBadge").textContent = primary ? agentName(primary) : "未连接";
  $("connectionSummary").textContent = primary ? `总控：${label}` : "等待添加模型";
  $("chatStatus").textContent = primary ? `${agentName(primary)} 将作为当前总控` : "请先在设置中添加模型";
  const subtitle = $("welcomeSubtitle");
  if (subtitle) subtitle.textContent = primary ? `${agentName(primary)} 负责最终回答，碰撞模式会在右侧显示每轮发言。` : "添加 DeepSeek、智谱 GLM 或其他模型后即可开始。";
}

function getPrimaryProvider() { return providers.find((provider) => provider.id === preferences?.primaryProviderId) || providers.find((provider) => provider.id === "deepseek") || providers[0] || null; }
function normalizeProviders(items) { return items.map((provider) => { const defaults = PROVIDER_DEFAULTS[provider.id]; return defaults ? { ...defaults, ...provider } : { protocol: "openai-chat", ...provider }; }); }
function getAgent(id, provider = null) { return { ...defaultAgentFor(provider || providers.find((item) => item.id === id) || { id, label: id }), ...(agentProfiles[id] || {}) }; }
function agentName(provider) { return getAgent(provider.id, provider).displayName || provider.label; }
function agentAvatar(id) { if (id === "input") return "你"; if (id === "error") return "!"; if (id === "system") return "SYS"; const agent = getAgent(id); return (agent.avatar || agent.displayName || id).slice(0, 4); }
function defaultAgentFor(provider) { return DEFAULT_AGENT_PROFILES[provider.id] || { avatar: (provider.label || provider.id).slice(0, 2), displayName: provider.label || provider.id, role: "自定义 Agent", personality: "直接、清晰、给可执行建议。", systemPrompt: `你是 ${provider.label || provider.id}，请作为 Team Agent Marco 的一个 Agent 发言。` }; }
function toggleCustomFields() { const visible = $("providerHint").value === "custom"; document.querySelectorAll(".custom-field").forEach((field) => field.classList.toggle("hidden", !visible)); }
function toggleKeyVisibility() { const input = $("universalApiKey"); input.type = input.type === "password" ? "text" : "password"; $("toggleKeyButton").textContent = input.type === "password" ? "显示 Key" : "隐藏 Key"; }

async function getOrCreateConversation(firstText) {
  if (activeConversationId) {
    const existing = await getConversation(activeConversationId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const conversation = { id: crypto.randomUUID(), title: firstText.replace(/\s+/g, " ").slice(0, 32), createdAt: now, updatedAt: now, messages: [] };
  activeConversationId = conversation.id;
  return conversation;
}
function createMessage(role, content) { return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }; }
async function loadConversationList() {
  const items = await listConversations();
  const box = $("conversationList");
  box.innerHTML = items.length ? items.map((item) => `<button class="conversation-item${item.id === activeConversationId ? " active" : ""}" data-id="${item.id}">${escapeHtml(item.title || "新对话")}</button>`).join("") : `<small>还没有对话</small>`;
  box.querySelectorAll(".conversation-item").forEach((button) => button.onclick = () => openConversation(button.dataset.id));
}
async function openConversation(id) {
  const conversation = await getConversation(id);
  if (!conversation) return;
  activeConversationId = id;
  $("conversationTitle").textContent = conversation.title;
  $("messages").replaceChildren();
  clearProcess();
  conversation.messages.forEach((message) => appendMessage(message));
  showPage("chat");
  await loadConversationList();
}
function newChat() {
  activeConversationId = null;
  $("conversationTitle").textContent = "新对话";
  const primary = getPrimaryProvider();
  clearProcess();
  $("messages").innerHTML = `<div id="welcome" class="welcome"><div class="lab-stamp">MARCO / AGENT DESK</div><h2>直接说事。</h2><p id="welcomeSubtitle">${primary ? `${escapeHtml(agentName(primary))} 负责最终回答，碰撞模式会在右侧显示每轮发言。` : "添加模型后即可开始。"}</p><div class="suggestions"><button>让老D和智谱参谋进行两轮碰撞后给结论</button><button>把我的想法拆成产品计划和风险清单</button><button>让所有 Agent 先互相反驳再给我结果</button></div></div>`;
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  renderPrimaryState();
  showPage("chat");
  loadConversationList();
  resizeInput(true);
}
function appendMessage(message, consulted = [], usage = 0) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const meta = message.role === "assistant" && (consulted.length || usage) ? `<div class="message-meta">${consulted.length ? `参考：${escapeHtml(consulted.join("、"))}` : ""}${consulted.length && usage ? " · " : ""}${usage ? `${usage} tokens` : ""}</div>` : "";
  node.innerHTML = `<div class="message-body"><div class="bubble">${escapeHtml(message.content)}</div>${meta}</div>`;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}
function appendThinking(label) { return appendMessage(createMessage("assistant", `${label} 正在思考…`)); }
function clearProcess() { processCounter = 0; $("processList").innerHTML = `<div class="process-empty">等待 Agent 发言。</div>`; }
function addProcess(agentId, title, content, state = "pending") {
  if (!preferences?.showProcess) return null;
  const list = $("processList");
  list.querySelector(".process-empty")?.remove();
  const id = `process-${++processCounter}`;
  const node = document.createElement("article");
  node.id = id;
  node.className = `process-item ${state}`;
  node.innerHTML = `<div class="process-title"><span class="process-name"><span class="process-avatar">${escapeHtml(agentAvatar(agentId))}</span><span>${escapeHtml(title)}</span></span><em>${stateLabel(state)}</em></div><pre>${escapeHtml(content)}</pre>`;
  list.append(node);
  list.scrollTop = list.scrollHeight;
  return id;
}
function updateProcess(id, content, state = "done") {
  if (!id) return;
  const node = $(id);
  if (!node) return;
  node.className = `process-item ${state}`;
  node.querySelector("em").textContent = stateLabel(state);
  node.querySelector("pre").textContent = content;
  $("processList").scrollTop = $("processList").scrollHeight;
}
function stateLabel(state) { return state === "running" ? "进行中" : state === "error" ? "失败" : state === "done" ? "完成" : "等待"; }
function setStatus(text) { $("chatStatus").textContent = text; }
function showDetectMessage(text, error = false) { const box = $("detectMessage"); box.textContent = text; box.className = `inline-message${error ? " error" : ""}`; box.classList.remove("hidden"); }
function resizeInput(force = false) {
  const input = $("chatInput");
  if (!input) return;
  const minHeight = 96;
  const maxHeight = 360;
  const currentHeight = input.offsetHeight || minHeight;
  if (!input.value || force) { input.style.height = `${minHeight}px`; return; }
  const targetHeight = Math.max(minHeight, Math.min(input.scrollHeight, maxHeight));
  if (currentHeight > targetHeight && currentHeight <= maxHeight) return;
  input.style.height = `${targetHeight}px`;
}
function clampInteger(value, min, max, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function readError(error) { return error?.message || String(error); }
function toast(text, error = false) { const box = $("toast"); box.textContent = text; box.className = `toast${error ? " error" : ""}`; box.classList.remove("hidden"); setTimeout(() => box.classList.add("hidden"), 3200); }

async function exportCurrentMarkdown() {
  const conversation = activeConversationId ? await getConversation(activeConversationId) : null;
  if (!conversation?.messages?.length) { toast("当前对话还没有可导出的内容。", true); return; }
  const lines = [`# ${conversation.title || "Team Agent Marco Conversation"}`, "", `- Created: ${conversation.createdAt}`, `- Updated: ${conversation.updatedAt}`, "", ...conversation.messages.flatMap((message) => [`## ${message.role === "user" ? "User" : "Agent"}`, "", message.content, ""])]
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(conversation.title || "team-agent-marco")}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("已导出 Markdown");
}
function safeFileName(value) { return String(value).trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "team-agent-marco"; }
