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
import {
  addRunStep,
  buildRoundContext,
  createRun,
  estimateCallCount,
  finishRun,
  normalizeRunMode,
  selectParticipants,
  updateRunStep
} from "./orchestrator.js";

let preferences;
let providers = [];
let agentProfiles = {};
let activeConversationId = null;
let activeRunContext = null;
let sending = false;
let persistQueue = Promise.resolve();

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  preferences = await loadPreferences();
  providers = normalizeProviders(await loadProviders());
  agentProfiles = await loadAgentProfiles();
  repairPrimaryProvider();
  bindEvents();
  renderSettings();
  renderPrimaryState();
  renderAgentProfiles();
  await loadConversationList();
  resizeInput(true);
  registerServiceWorker();
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
  $("stopButton").onclick = stopCurrentRun;
  $("exportMarkdownButton").onclick = exportCurrentMarkdown;
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  $("toggleKeyButton").onclick = toggleKeyVisibility;
  $("providerHint").onchange = toggleCustomFields;
  $("detectKeyButton").onclick = detectAndSaveKey;
  $("savePreferencesButton").onclick = persistPreferences;
  $("saveAgentsButton").onclick = persistAgents;
  $("runMode").onchange = renderRunEstimate;
  $("debateRounds").onchange = renderRunEstimate;
  $("maxDebateAgents").onchange = renderRunEstimate;
}

function showPage(page) {
  $("chatPage").classList.toggle("active", page === "chat");
  $("settingsPage").classList.toggle("active", page === "settings");
  $("agentsPage").classList.toggle("active", page === "agents");
  if (page === "agents") renderAgentProfiles();
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text || sending) return;
  const primary = getPrimaryProvider();
  if (!primary) {
    showPage("settings");
    toast("请先连接一个模型。", true);
    return;
  }

  sending = true;
  const conversation = await getOrCreateConversation(text);
  const conversationId = conversation.id;
  const userMessage = createMessage("user", text);
  conversation.messages.push(userMessage);
  conversation.updatedAt = userMessage.createdAt;
  await saveConversation(conversation);

  const mode = normalizeRunMode(preferences.runMode);
  const participants = selectParticipants({ providers, primaryId: primary.id, agentProfiles, maxAgents: preferences.maxDebateAgents });
  const run = createRun({ conversationId, mode, participants });
  conversation.runs.push(run);
  const controller = new AbortController();
  activeRunContext = { conversation, conversationId, run, controller };
  await saveConversation(conversation);

  if (activeConversationId === conversationId) {
    $("welcome")?.classList.add("hidden");
    appendMessage(userMessage);
    $("chatInput").value = "";
    resizeInput(true);
    clearProcess();
  }
  updateRunControls();
  addProcess("input", "收到任务", text, "done");
  addProcess("system", "运行计划", describeRunPlan(mode, participants.length), "done");
  setStatusForConversation(conversationId, `${agentName(primary)} 正在执行 ${modeLabel(mode)}`);
  const thinking = activeConversationId === conversationId ? appendThinking(agentName(primary)) : null;

  try {
    const { internalNotes, consulted } = await executeInternalWorkflow({ mode, primary, participants, messages: conversation.messages, signal: controller.signal });
    assertNotAborted(controller.signal);
    const stepId = addProcess(primary.id, `${agentName(primary)} 最终整合`, internalNotes.length ? "正在阅读完整讨论记录…" : "直接生成回答…", "running");
    const final = await generatePrimary({ provider: primary, messages: conversation.messages, internalNotes, preferences, agent: getAgent(primary.id), signal: controller.signal });
    updateProcess(stepId, final.text, "done", final);

    const assistantMessage = createMessage("assistant", final.text);
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = assistantMessage.createdAt;
    finishRun(run, { status: "completed" });
    await saveConversation(conversation);

    if (activeConversationId === conversationId) {
      thinking?.remove();
      appendMessage(assistantMessage, consulted, run.usage);
      $("conversationTitle").textContent = conversation.title;
      renderWorklog(run);
      setStatus(`${agentName(primary)} 已完成 · ${run.usage.calls} 次调用 · ${run.usage.totalTokens || 0} tokens`);
    }
    await loadConversationList();
  } catch (error) {
    const cancelled = isAbortError(error) || controller.signal.aborted;
    finishRun(run, { status: cancelled ? "cancelled" : "failed", error: cancelled ? null : readError(error) });
    if (cancelled) {
      addProcess("system", "任务已停止", "当前工作流已取消，已完成的步骤仍保存在 WORKLOG。", "done");
    } else {
      addProcess("error", "运行失败", readError(error), "error");
      const failureMessage = createMessage("assistant", `运行失败：${readError(error)}`);
      conversation.messages.push(failureMessage);
      conversation.updatedAt = failureMessage.createdAt;
      if (activeConversationId === conversationId) appendMessage(failureMessage);
    }
    await saveConversation(conversation);
    if (activeConversationId === conversationId) {
      thinking?.remove();
      renderWorklog(run);
      setStatus(cancelled ? "已停止生成" : "发送失败");
    }
  } finally {
    if (activeRunContext?.run.id === run.id) activeRunContext = null;
    sending = false;
    updateRunControls();
    $("chatInput").focus();
  }
}

async function executeInternalWorkflow({ mode, primary, participants, messages, signal }) {
  if (mode === "quick" || participants.length < 2) {
    if (participants.length < 2 && mode !== "quick") addProcess("system", "单模型降级", "只有一个可用 Agent，本次直接由总控回答。", "done");
    return { internalNotes: [], consulted: [] };
  }
  if (mode === "advisor") return runAdvisor(primary, participants, messages, signal);
  return runDebate(participants, messages, signal);
}

async function runAdvisor(primary, participants, messages, signal) {
  const experts = participants.filter((provider) => provider.id !== primary.id);
  const notes = [];
  await Promise.all(experts.map(async (provider) => {
    const stepId = addProcess(provider.id, `${agentName(provider)} 参谋意见`, "等待接口返回…", "running");
    try {
      const result = await consultProvider({ provider, messages, timeoutMs: preferences.timeoutMs, agent: getAgent(provider.id), signal });
      updateProcess(stepId, result.text, "done", result);
      notes.push({ providerId: provider.id, name: agentName(provider), text: result.text, round: 1 });
    } catch (error) {
      updateProcess(stepId, readError(error), isAbortError(error) ? "cancelled" : "error");
      if (isAbortError(error)) throw error;
    }
  }));
  return { internalNotes: notes.map(formatDebateNote), consulted: notes.map((note) => note.name) };
}

async function runDebate(participants, messages, signal) {
  setStatusForCurrentRun("Round 1：独立初判");
  const round1 = await runDebateRound(participants, messages, 1, [], signal);
  const allNotes = [...round1];
  if (Number(preferences.debateRounds) >= 2 && round1.length) {
    setStatusForCurrentRun("Round 2：互相反驳和修正");
    const round2 = await runDebateRound(participants, messages, 2, round1, signal);
    allNotes.push(...round2);
  }
  return {
    internalNotes: allNotes.map(formatDebateNote),
    consulted: Array.from(new Set(allNotes.map((note) => note.name)))
  };
}

async function runDebateRound(participants, messages, round, previousNotes, signal) {
  const results = await Promise.all(participants.map(async (provider) => {
    const title = round === 1 ? `${agentName(provider)} 初判` : `${agentName(provider)} 反驳 / 修正`;
    const stepId = addProcess(provider.id, title, "等待接口返回…", "running");
    const { ownNote, peerNotes } = buildRoundContext({ providerId: provider.id, previousNotes });
    try {
      const result = await debateProvider({ provider, messages, timeoutMs: preferences.timeoutMs, agent: getAgent(provider.id), round, ownNote, peerNotes, signal });
      updateProcess(stepId, result.text, "done", result);
      return { providerId: provider.id, name: agentName(provider), round, text: result.text, usage: result.usage, elapsedMs: result.elapsedMs };
    } catch (error) {
      updateProcess(stepId, readError(error), isAbortError(error) ? "cancelled" : "error");
      if (isAbortError(error)) throw error;
      return null;
    }
  }));
  return results.filter(Boolean);
}

function addProcess(providerId, title, content, state = "pending", result = {}) {
  if (!activeRunContext) return null;
  const step = addRunStep(activeRunContext.run, { providerId, title, content, state, usage: result.usage || 0, elapsedMs: result.elapsedMs || 0 });
  queueConversationSave(activeRunContext.conversation);
  if (activeConversationId === activeRunContext.conversationId && preferences.showProcess) renderProcessStep(step);
  return step.id;
}

function updateProcess(stepId, content, state = "done", result = {}) {
  if (!activeRunContext || !stepId) return;
  const step = updateRunStep(activeRunContext.run, stepId, {
    content,
    state,
    usage: result.usage || 0,
    elapsedMs: result.elapsedMs || 0,
    completedAt: new Date().toISOString()
  });
  queueConversationSave(activeRunContext.conversation);
  if (step && activeConversationId === activeRunContext.conversationId && preferences.showProcess) updateProcessNode(step);
}

function queueConversationSave(conversation) {
  persistQueue = persistQueue.catch(() => undefined).then(() => saveConversation(conversation));
  return persistQueue;
}

function stopCurrentRun() {
  if (!activeRunContext || activeRunContext.controller.signal.aborted) return;
  activeRunContext.controller.abort();
  $("stopButton").disabled = true;
  setStatusForCurrentRun("正在停止…");
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
    renderRunEstimate();
    toast(`${detected.label} 已连接`);
  } catch (error) {
    showDetectMessage(readError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "测试并连接";
  }
}

async function persistPreferences() {
  preferences = {
    ...preferences,
    runMode: normalizeRunMode($("runMode").value),
    debateRounds: clampInteger($("debateRounds").value, 1, 2, 2),
    maxDebateAgents: clampInteger($("maxDebateAgents").value, 1, 6, 2),
    showProcess: $("showProcess").checked,
    maxOutputTokens: clampInteger($("maxOutputTokens").value, 100, 128000, 4000),
    timeoutMs: clampInteger($("timeoutMs").value, 5000, 600000, 120000)
  };
  await savePreferences(preferences);
  $("processPanel").classList.toggle("hidden", !preferences.showProcess);
  renderPrimaryState();
  renderRunEstimate();
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
      systemPrompt: card.querySelector('[data-field="systemPrompt"]').value.trim(),
      participatesInDebate: card.querySelector('[data-field="participatesInDebate"]').checked
    };
  });
  agentProfiles = next;
  await saveAgentProfiles(agentProfiles);
  renderProviders();
  renderPrimaryState();
  renderAgentProfiles();
  renderRunEstimate();
  toast("Agent 配置已保存");
}

function renderSettings() {
  $("runMode").value = normalizeRunMode(preferences.runMode);
  $("debateRounds").value = String(clampInteger(preferences.debateRounds, 1, 2, 2));
  $("maxDebateAgents").value = String(clampInteger(preferences.maxDebateAgents, 1, 6, 2));
  $("showProcess").checked = preferences.showProcess;
  $("maxOutputTokens").value = preferences.maxOutputTokens;
  $("timeoutMs").value = preferences.timeoutMs;
  $("processPanel").classList.toggle("hidden", !preferences.showProcess);
  toggleCustomFields();
  renderProviders();
  renderPrimaryState();
  renderRunEstimate();
}

function renderProviders() {
  const box = $("providerList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message">还没有连接模型。添加时请先明确选择平台，避免 Key 被发往错误域名。</div>`;
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
    renderRunEstimate();
    toast("总控已切换");
  });
  box.querySelectorAll(".remove-provider").forEach((button) => button.onclick = async () => {
    const removedId = button.dataset.provider;
    await removeProviderSecret(removedId);
    providers = providers.filter((provider) => provider.id !== removedId);
    repairPrimaryProvider();
    await Promise.all([saveProviders(providers), savePreferences(preferences)]);
    renderProviders();
    renderPrimaryState();
    renderAgentProfiles();
    renderRunEstimate();
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
    return `<article class="agent-card" data-agent="${escapeHtml(provider.id)}"><div class="agent-card-head"><div class="agent-inline"><span class="avatar">${escapeHtml(agentAvatar(provider.id))}</span><strong>${escapeHtml(agent.displayName || provider.label)}</strong></div><small>${escapeHtml(provider.label)} · ${escapeHtml(provider.model)}</small></div><label class="switch-row compact"><span><strong>参与多 Agent 任务</strong><small>关闭后仅在它被设为总控时调用</small></span><input data-field="participatesInDebate" type="checkbox" ${agent.participatesInDebate !== false ? "checked" : ""}></label><label>头像 / 代号<input data-field="avatar" maxlength="4" value="${escapeHtml(agent.avatar || "")}" placeholder="D"></label><label>名字<input data-field="displayName" value="${escapeHtml(agent.displayName || "")}"></label><label>定位<input data-field="role" value="${escapeHtml(agent.role || "")}"></label><label>性格<textarea data-field="personality" rows="2">${escapeHtml(agent.personality || "")}</textarea></label><label>自定义提示词<textarea data-field="systemPrompt" rows="4">${escapeHtml(agent.systemPrompt || "")}</textarea></label></article>`;
  }).join("");
}

function renderPrimaryState() {
  const primary = getPrimaryProvider();
  const mode = normalizeRunMode(preferences.runMode);
  $("primaryModelBadge").textContent = primary ? agentName(primary) : "未连接";
  $("connectionSummary").textContent = primary ? `总控：${agentName(primary)} · ${modeLabel(mode)}` : "等待添加模型";
  if (!activeRunContext || activeRunContext.conversationId !== activeConversationId) {
    $("chatStatus").textContent = primary ? `${agentName(primary)} · ${modeLabel(mode)}` : "请先在设置中添加模型";
  }
  const subtitle = $("welcomeSubtitle");
  if (subtitle) subtitle.textContent = primary ? `${agentName(primary)} 负责最终回答；当前模式：${modeLabel(mode)}。` : "添加模型后即可开始。";
}

function renderRunEstimate() {
  const mode = normalizeRunMode($("runMode")?.value || preferences.runMode);
  const primary = getPrimaryProvider();
  const participants = selectParticipants({ providers, primaryId: primary?.id, agentProfiles, maxAgents: $("maxDebateAgents")?.value || preferences.maxDebateAgents });
  const calls = estimateCallCount({ mode, participantCount: participants.length, rounds: $("debateRounds")?.value || preferences.debateRounds });
  const names = participants.map(agentName).join("、") || "暂无模型";
  $("runEstimate").textContent = `预计 ${calls} 次模型调用；参与：${names}`;
}

function renderWorklog(run) {
  clearProcess();
  if (!run?.steps?.length) return;
  run.steps.forEach(renderProcessStep);
}

function renderProcessStep(step) {
  const list = $("processList");
  list.querySelector(".process-empty")?.remove();
  const node = document.createElement("article");
  node.id = processNodeId(step.id);
  node.className = `process-item ${step.state}`;
  node.innerHTML = processStepHtml(step);
  list.append(node);
  list.scrollTop = list.scrollHeight;
}

function updateProcessNode(step) {
  const node = $(processNodeId(step.id));
  if (!node) return renderProcessStep(step);
  node.className = `process-item ${step.state}`;
  node.innerHTML = processStepHtml(step);
  $("processList").scrollTop = $("processList").scrollHeight;
}

function processStepHtml(step) {
  const meta = [step.elapsedMs ? `${(step.elapsedMs / 1000).toFixed(1)}s` : "", step.usage ? `${step.usage} tokens` : ""].filter(Boolean).join(" · ");
  return `<div class="process-title"><span class="process-name"><span class="process-avatar">${escapeHtml(agentAvatar(step.providerId))}</span><span>${escapeHtml(step.title)}</span></span><em>${escapeHtml(stateLabel(step.state))}</em></div><pre>${escapeHtml(step.content)}</pre>${meta ? `<div class="process-meta">${escapeHtml(meta)}</div>` : ""}`;
}

function updateRunControls() {
  const runningHere = Boolean(activeRunContext && activeRunContext.conversationId === activeConversationId && !activeRunContext.controller.signal.aborted);
  $("stopButton").classList.toggle("hidden", !runningHere);
  $("stopButton").disabled = !runningHere;
  $("sendButton").disabled = sending;
}

async function openConversation(id) {
  const conversation = activeRunContext?.conversationId === id
    ? activeRunContext.conversation
    : await getConversation(id);
  if (!conversation) return;
  activeConversationId = id;
  $("conversationTitle").textContent = conversation.title;
  $("messages").replaceChildren();
  conversation.messages.forEach((message) => appendMessage(message));
  renderWorklog(conversation.runs.at(-1));
  showPage("chat");
  updateRunControls();
  await loadConversationList();
}

function newChat() {
  activeConversationId = null;
  $("conversationTitle").textContent = "新对话";
  clearProcess();
  const primary = getPrimaryProvider();
  $("messages").innerHTML = `<div id="welcome" class="welcome"><div class="lab-stamp">MARCO / AGENT DESK</div><h2>直接说事。</h2><p id="welcomeSubtitle">${primary ? `${escapeHtml(agentName(primary))} 负责最终回答；当前模式：${escapeHtml(modeLabel(preferences.runMode))}。` : "添加模型后即可开始。"}</p><div class="suggestions"><button>让老D和智谱参谋碰撞后给结论</button><button>快速判断这个项目下一步</button><button>让参谋先审查，再由总控回答</button></div></div>`;
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  renderPrimaryState();
  showPage("chat");
  updateRunControls();
  loadConversationList();
  resizeInput(true);
}

async function getOrCreateConversation(firstText) {
  if (activeConversationId) {
    const existing = await getConversation(activeConversationId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const conversation = { id: crypto.randomUUID(), title: firstText.replace(/\s+/g, " ").slice(0, 32), createdAt: now, updatedAt: now, messages: [], runs: [] };
  activeConversationId = conversation.id;
  return conversation;
}

async function loadConversationList() {
  const items = await listConversations();
  const box = $("conversationList");
  box.innerHTML = items.length ? items.map((item) => `<button class="conversation-item${item.id === activeConversationId ? " active" : ""}" data-id="${item.id}">${escapeHtml(item.title || "新对话")}</button>`).join("") : `<small>还没有对话</small>`;
  box.querySelectorAll(".conversation-item").forEach((button) => button.onclick = () => openConversation(button.dataset.id));
}

function appendMessage(message, consulted = [], usage = null) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const runMeta = usage ? `${usage.calls || 0} 次调用 · ${usage.totalTokens || 0} tokens` : "";
  const meta = message.role === "assistant" && (consulted.length || runMeta) ? `<div class="message-meta">${consulted.length ? `参考：${escapeHtml(consulted.join("、"))}` : ""}${consulted.length && runMeta ? " · " : ""}${escapeHtml(runMeta)}</div>` : "";
  node.innerHTML = `<div class="message-body"><div class="bubble">${escapeHtml(message.content)}</div>${meta}</div>`;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

async function exportCurrentMarkdown() {
  const conversation = activeConversationId ? await getConversation(activeConversationId) : null;
  if (!conversation?.messages?.length) return toast("当前对话还没有可导出的内容。", true);
  const lines = [`# ${conversation.title || "Team Agent Marco Conversation"}`, "", `- Created: ${conversation.createdAt}`, `- Updated: ${conversation.updatedAt}`, ""];
  conversation.messages.forEach((message) => lines.push(`## ${message.role === "user" ? "User" : "Agent"}`, "", message.content, ""));
  conversation.runs.forEach((run, index) => {
    lines.push(`## WORKLOG ${index + 1}`, "", `- Mode: ${run.mode}`, `- Status: ${run.status}`, `- Calls: ${run.usage?.calls || 0}`, `- Tokens: ${run.usage?.totalTokens || 0}`, "");
    run.steps.forEach((step) => lines.push(`### ${step.title}`, "", step.content, ""));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(conversation.title || "team-agent-marco")}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("已导出完整对话和 WORKLOG");
}

function repairPrimaryProvider() {
  if (providers.some((provider) => provider.id === preferences.primaryProviderId)) return;
  preferences.primaryProviderId = providers.find((provider) => provider.id === "deepseek")?.id || providers[0]?.id || "deepseek";
}
function getPrimaryProvider() { return providers.find((provider) => provider.id === preferences.primaryProviderId) || providers[0] || null; }
function normalizeProviders(items) { return items.map((provider) => PROVIDER_DEFAULTS[provider.id] ? { ...PROVIDER_DEFAULTS[provider.id], ...provider } : { protocol: "openai-chat", ...provider }); }
function getAgent(id, provider = null) { return { ...defaultAgentFor(provider || providers.find((item) => item.id === id) || { id, label: id }), ...(agentProfiles[id] || {}) }; }
function defaultAgentFor(provider) { return DEFAULT_AGENT_PROFILES[provider.id] || { avatar: (provider.label || provider.id).slice(0, 2), displayName: provider.label || provider.id, role: "自定义 Agent", personality: "直接、清晰、给可执行建议。", systemPrompt: `你是 ${provider.label || provider.id}，请作为 Team Agent Marco 的一个 Agent 发言。`, participatesInDebate: true }; }
function agentName(provider) { return getAgent(provider.id, provider).displayName || provider.label; }
function agentAvatar(id) { if (id === "input") return "你"; if (id === "error") return "!"; if (id === "system") return "SYS"; return (getAgent(id).avatar || getAgent(id).displayName || id).slice(0, 4); }
function createMessage(role, content) { return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }; }
function appendThinking(label) { return appendMessage(createMessage("assistant", `${label} 正在思考…`)); }
function clearProcess() { $("processList").innerHTML = `<div class="process-empty">等待 Agent 发言。</div>`; }
function processNodeId(stepId) { return `process-${stepId}`; }
function formatDebateNote(note) { return `Round ${note.round} · ${note.name}\n${note.text}`; }
function modeLabel(mode) { return ({ quick: "快速模式", advisor: "参谋模式", debate: "深度碰撞" })[normalizeRunMode(mode)]; }
function describeRunPlan(mode, participantCount) { return `${modeLabel(mode)}；${participantCount} 个 Agent；预计 ${estimateCallCount({ mode, participantCount, rounds: preferences.debateRounds })} 次模型调用。`; }
function stateLabel(state) { return ({ running: "进行中", error: "失败", cancelled: "已停止", done: "完成", pending: "等待" })[state] || state; }
function setStatus(text) { $("chatStatus").textContent = text; }
function setStatusForConversation(id, text) { if (activeConversationId === id) setStatus(text); }
function setStatusForCurrentRun(text) { if (activeRunContext) setStatusForConversation(activeRunContext.conversationId, text); }
function showDetectMessage(text, error = false) { const box = $("detectMessage"); box.textContent = text; box.className = `inline-message${error ? " error" : ""}`; box.classList.remove("hidden"); }
function toggleCustomFields() { const visible = $("providerHint").value === "custom"; document.querySelectorAll(".custom-field").forEach((field) => field.classList.toggle("hidden", !visible)); }
function toggleKeyVisibility() { const input = $("universalApiKey"); input.type = input.type === "password" ? "text" : "password"; $("toggleKeyButton").textContent = input.type === "password" ? "显示 Key" : "隐藏 Key"; }
function fillSuggestion(text) { $("chatInput").value = text; resizeInput(false); $("chatInput").focus(); }
function resizeInput(force = false) { const input = $("chatInput"); if (!input) return; const minHeight = 96; const maxHeight = 360; if (!input.value || force) { input.style.height = `${minHeight}px`; return; } const currentHeight = input.offsetHeight || minHeight; const targetHeight = Math.max(minHeight, Math.min(input.scrollHeight, maxHeight)); if (currentHeight > targetHeight && currentHeight <= maxHeight) return; input.style.height = `${targetHeight}px`; }
function clampInteger(value, min, max, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function readError(error) { return error?.message || String(error); }
function isAbortError(error) { return error?.name === "AbortError" || /停止|abort/i.test(readError(error)); }
function assertNotAborted(signal) { if (signal.aborted) throw new DOMException("用户已停止生成。", "AbortError"); }
function safeFileName(value) { return String(value).trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "team-agent-marco"; }
function toast(text, error = false) { const box = $("toast"); box.textContent = text; box.className = `toast${error ? " error" : ""}`; box.classList.remove("hidden"); setTimeout(() => box.classList.add("hidden"), 3200); }
function registerServiceWorker() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined); }
