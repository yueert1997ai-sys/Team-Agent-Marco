import {
  initializeStorage,
  getConversation,
  listConversations,
  loadAgentProfiles,
  loadPreferences,
  loadProjectMemory,
  loadProviders,
  removeProviderSecret,
  saveAgentProfiles,
  saveConversation,
  savePreferences,
  saveProjectMemory,
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
  getRecipe,
  modeLabel,
  normalizeRecipe,
  normalizeRunMode,
  routeTask,
  selectParticipants,
  updateRunStep
} from "./orchestrator.js";

let preferences;
let providers = [];
let agentProfiles = {};
let projectMemory = {};
let activeConversationId = null;
let activeRunContext = null;
let sending = false;
let persistQueue = Promise.resolve();
let worklogVisible = false;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[char]);

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  preferences = await loadPreferences();
  providers = normalizeProviders(await loadProviders());
  agentProfiles = await loadAgentProfiles();
  projectMemory = await loadProjectMemory();
  repairPrimaryProvider();
  bindEvents();
  renderSettings();
  renderProjectMemory();
  renderPrimaryState();
  renderAgentProfiles();
  renderProjectSummary();
  await loadConversationList();
  resizeInput(true);
  setWorklogVisible(false);
  registerServiceWorker();
});

function bindEvents() {
  $("mobileMenuButton").onclick = toggleMobileSidebar;
  $("newChatButton").onclick = () => { closeMobileSidebar(); newChat(); };
  $("openProjectButton").onclick = () => { closeMobileSidebar(); showPage("project"); };
  $("openSettingsButton").onclick = () => { closeMobileSidebar(); showPage("settings"); };
  $("openAgentsButton").onclick = () => { closeMobileSidebar(); showPage("agents"); };
  document.querySelectorAll(".backToChatButton").forEach((button) => {
    button.onclick = () => showPage("chat");
  });
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
  $("toggleWorklogButton").onclick = () => setWorklogVisible(!worklogVisible);
  $("closeWorklogButton").onclick = () => setWorklogVisible(false);
  $("recipePicker").onchange = renderRouteHint;
  document.querySelectorAll(".recipe-card").forEach((button) => {
    button.onclick = () => chooseRecipe(button.dataset.recipe, button.dataset.prompt);
  });
  $("toggleKeyButton").onclick = toggleKeyVisibility;
  $("providerHint").onchange = toggleCustomFields;
  $("detectKeyButton").onclick = detectAndSaveKey;
  $("savePreferencesButton").onclick = persistPreferences;
  $("saveAgentsButton").onclick = persistAgents;
  $("saveProjectButton").onclick = persistProjectMemory;
  $("runMode").onchange = renderRunEstimate;
  $("debateRounds").onchange = renderRunEstimate;
  $("maxDebateAgents").onchange = renderRunEstimate;
}

function showPage(page) {
  $("chatPage").classList.toggle("active", page === "chat");
  $("projectPage").classList.toggle("active", page === "project");
  $("settingsPage").classList.toggle("active", page === "settings");
  $("agentsPage").classList.toggle("active", page === "agents");
  if (page === "agents") renderAgentProfiles();
  if (page === "project") renderProjectMemory();
}

function chooseRecipe(recipe, prompt) {
  $("recipePicker").value = normalizeRecipe(recipe);
  $("chatInput").value = prompt || "";
  renderRouteHint();
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
    toast("请先连接一个模型。", true);
    return;
  }

  sending = true;
  const conversation = await getOrCreateConversation(text);
  const conversationId = conversation.id;
  const inheritedRecipe = getInheritedRecipe(conversation, text);
  const plan = routeTask({
    text,
    requestedMode: preferences.runMode,
    requestedRecipe: inheritedRecipe,
    availableAgents: providers.length
  });
  const selectedParticipants = selectParticipants({
    providers,
    primaryId: primary.id,
    agentProfiles,
    maxAgents: preferences.maxDebateAgents,
    recipe: plan.recipe
  });
  const participants = plan.mode === "quick" ? [primary] : selectedParticipants;

  const userMessage = createMessage("user", text, { recipe: plan.recipe });
  conversation.messages.push(userMessage);
  conversation.updatedAt = userMessage.createdAt;
  await saveConversation(conversation);

  const run = createRun({
    conversationId,
    mode: plan.mode,
    recipe: plan.recipe,
    routeReason: plan.reason,
    participants
  });
  conversation.runs.push(run);
  const controller = new AbortController();
  activeRunContext = { conversation, conversationId, run, controller };
  await saveConversation(conversation);

  if (activeConversationId === conversationId) {
    $("welcome")?.classList.add("hidden");
    appendMessage(userMessage, { conversation });
    $("chatInput").value = "";
    $("recipePicker").value = "auto";
    renderRouteHint();
    resizeInput(true);
    clearProcess();
  }

  updateRunControls();
  addProcess("input", "收到任务", text, "done");
  addProcess("system", "自动路由", describeRunPlan(plan, participants), "done");
  setStatusForConversation(conversationId, `${agentName(primary)} 正在执行 ${getRecipe(plan.recipe).label}`);
  const thinking = activeConversationId === conversationId ? appendThinking(agentName(primary)) : null;

  try {
    const { internalNotes, consulted } = await executeInternalWorkflow({
      mode: plan.mode,
      recipe: plan.recipe,
      primary,
      participants,
      messages: conversation.messages,
      projectMemory,
      signal: controller.signal
    });
    assertNotAborted(controller.signal);

    const stepId = addProcess(
      primary.id,
      `${agentName(primary)} 最终整合`,
      internalNotes.length ? "正在吸收有效分歧并生成最终结果…" : "正在直接生成结果…",
      "running"
    );
    const final = await generatePrimary({
      provider: primary,
      messages: conversation.messages,
      internalNotes,
      preferences,
      agent: getAgent(primary.id),
      recipe: plan.recipe,
      projectMemory,
      signal: controller.signal
    });
    updateProcess(stepId, final.text, "done", final);

    const assistantMessage = createMessage("assistant", final.text, {
      runId: run.id,
      recipe: plan.recipe
    });
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = assistantMessage.createdAt;
    finishRun(run, { status: "completed" });
    await saveConversation(conversation);

    if (activeConversationId === conversationId) {
      thinking?.remove();
      appendMessage(assistantMessage, { conversation, run, consulted });
      $("conversationTitle").textContent = conversation.title;
      renderWorklog(run);
      setStatus(`${agentName(primary)} 已完成 · ${getRecipe(plan.recipe).label} · ${run.usage.calls} 次调用`);
    }
    await loadConversationList();
  } catch (error) {
    const cancelled = isAbortError(error) || controller.signal.aborted;
    if (cancelled) {
      addProcess("system", "任务已停止", "当前工作流已取消，已完成的步骤仍保存在 WORKLOG。", "done");
    } else {
      addProcess("error", "运行失败", readError(error), "error");
      const failureMessage = createMessage("assistant", `运行失败：${readError(error)}`, { failed: true });
      conversation.messages.push(failureMessage);
      conversation.updatedAt = failureMessage.createdAt;
      if (activeConversationId === conversationId) appendMessage(failureMessage, { conversation });
    }
    finishRun(run, {
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? null : readError(error)
    });
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

function getInheritedRecipe(conversation, text) {
  const selected = normalizeRecipe($("recipePicker").value);
  if (selected !== "auto") return selected;
  const previous = conversation.runs.at(-1)?.recipe;
  if (previous && text.length < 60 && /^(继续|再|那|然后|改成|细化|展开|为什么|怎么)/.test(text)) return previous;
  return "auto";
}

async function executeInternalWorkflow({
  mode,
  recipe,
  primary,
  participants,
  messages,
  projectMemory: memory,
  signal
}) {
  if (mode === "quick" || participants.length < 2) {
    if (participants.length < 2 && mode !== "quick") {
      addProcess("system", "单模型降级", "只有一个可用 Agent，本次直接由总控回答。", "done");
    }
    return { internalNotes: [], consulted: [] };
  }
  if (mode === "advisor") {
    return runAdvisor(primary, participants, messages, recipe, memory, signal);
  }
  return runDebate(participants, messages, recipe, memory, signal);
}

async function runAdvisor(primary, participants, messages, recipe, memory, signal) {
  const experts = participants.filter((provider) => provider.id !== primary.id);
  const notes = [];
  await Promise.all(experts.map(async (provider) => {
    const stepId = addProcess(provider.id, `${agentName(provider)} 独立审查`, "等待接口返回…", "running");
    try {
      const result = await consultProvider({
        provider,
        messages,
        timeoutMs: preferences.timeoutMs,
        agent: getAgent(provider.id),
        recipe,
        projectMemory: memory,
        signal
      });
      updateProcess(stepId, result.text, "done", result);
      notes.push({
        providerId: provider.id,
        name: agentName(provider),
        text: result.text,
        round: 1
      });
    } catch (error) {
      updateProcess(stepId, readError(error), isAbortError(error) ? "cancelled" : "error");
      if (isAbortError(error)) throw error;
    }
  }));
  return {
    internalNotes: notes.map(formatDebateNote),
    consulted: notes.map((note) => note.name)
  };
}

async function runDebate(participants, messages, recipe, memory, signal) {
  setStatusForCurrentRun("Round 1：独立判断");
  const round1 = await runDebateRound(participants, messages, recipe, memory, 1, [], signal);
  const allNotes = [...round1];

  if (Number(preferences.debateRounds) >= 2 && round1.length) {
    setStatusForCurrentRun("Round 2：互相修正");
    const round2 = await runDebateRound(participants, messages, recipe, memory, 2, round1, signal);
    allNotes.push(...round2);
  }

  return {
    internalNotes: allNotes.map(formatDebateNote),
    consulted: Array.from(new Set(allNotes.map((note) => note.name)))
  };
}

async function runDebateRound(participants, messages, recipe, memory, round, previousNotes, signal) {
  const results = await Promise.all(participants.map(async (provider) => {
    const title = round === 1 ? `${agentName(provider)} 初判` : `${agentName(provider)} 修正`;
    const stepId = addProcess(provider.id, title, "等待接口返回…", "running");
    const { ownNote, peerNotes } = buildRoundContext({
      providerId: provider.id,
      previousNotes
    });
    try {
      const result = await debateProvider({
        provider,
        messages,
        timeoutMs: preferences.timeoutMs,
        agent: getAgent(provider.id),
        round,
        ownNote,
        peerNotes,
        recipe,
        projectMemory: memory,
        signal
      });
      updateProcess(stepId, result.text, "done", result);
      return {
        providerId: provider.id,
        name: agentName(provider),
        round,
        text: result.text,
        usage: result.usage,
        elapsedMs: result.elapsedMs
      };
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
  const step = addRunStep(activeRunContext.run, {
    providerId,
    title,
    content,
    state,
    usage: result.usage || 0,
    elapsedMs: result.elapsedMs || 0
  });
  queueConversationSave(activeRunContext.conversation);
  if (activeConversationId === activeRunContext.conversationId && preferences.showProcess) {
    renderProcessStep(step);
  }
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
  if (step && activeConversationId === activeRunContext.conversationId && preferences.showProcess) {
    updateProcessNode(step);
    renderProcessSummary(activeRunContext.run);
  }
}

function queueConversationSave(conversation) {
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(() => saveConversation(conversation));
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
  const custom = {
    label: $("customLabel").value,
    baseUrl: $("customBaseUrl").value,
    model: $("customModel").value
  };
  const button = $("detectKeyButton");
  button.disabled = true;
  button.textContent = "连接中…";
  try {
    const detected = await detectProvider(key, preferences.timeoutMs, hint, custom);
    await saveProviderSecret(detected.id, key, $("rememberKey").checked);
    providers = [...providers.filter((provider) => provider.id !== detected.id), detected];
    if (!agentProfiles[detected.id]) agentProfiles[detected.id] = defaultAgentFor(detected);
    if (detected.id === "deepseek" || !getPrimaryProvider()) preferences.primaryProviderId = detected.id;
    await Promise.all([
      saveProviders(providers),
      savePreferences(preferences),
      saveAgentProfiles(agentProfiles)
    ]);
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
  if (!preferences.showProcess) setWorklogVisible(false);
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
      capabilities: parseCapabilities(card.querySelector('[data-field="capabilities"]').value),
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

async function persistProjectMemory() {
  projectMemory = {
    id: "project-memory",
    name: $("projectName").value.trim(),
    goal: $("projectGoal").value.trim(),
    context: $("projectContext").value.trim(),
    constraints: $("projectConstraints").value.trim(),
    decisions: $("projectDecisions").value.trim()
  };
  await saveProjectMemory(projectMemory);
  projectMemory = await loadProjectMemory();
  renderProjectSummary();
  toast("项目记忆已保存");
}

function renderSettings() {
  $("runMode").value = normalizeRunMode(preferences.runMode);
  $("debateRounds").value = String(clampInteger(preferences.debateRounds, 1, 2, 2));
  $("maxDebateAgents").value = String(clampInteger(preferences.maxDebateAgents, 1, 6, 2));
  $("showProcess").checked = preferences.showProcess;
  $("maxOutputTokens").value = preferences.maxOutputTokens;
  $("timeoutMs").value = preferences.timeoutMs;
  toggleCustomFields();
  renderProviders();
  renderPrimaryState();
  renderRunEstimate();
}

function renderProjectMemory() {
  $("projectName").value = projectMemory.name || "";
  $("projectGoal").value = projectMemory.goal || "";
  $("projectContext").value = projectMemory.context || "";
  $("projectConstraints").value = projectMemory.constraints || "";
  $("projectDecisions").value = projectMemory.decisions || "";
}

function renderProjectSummary() {
  $("projectSummary").textContent = projectMemory.name
    ? `项目：${projectMemory.name}`
    : "未设置项目记忆";
}

function renderProviders() {
  const box = $("providerList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message">还没有连接模型。添加时请先明确选择平台，避免 Key 被发往错误域名。</div>`;
    return;
  }
  box.innerHTML = providers.map((provider) => {
    const isPrimary = provider.id === preferences.primaryProviderId;
    return `<div class="provider-row">
      <div class="provider-title">
        <div class="agent-inline">
          <span class="avatar">${escapeHtml(agentAvatar(provider.id))}</span>
          <div>
            <strong>${escapeHtml(agentName(provider))}${isPrimary ? '<span class="primary-tag">总控</span>' : ""}</strong>
            <small>${escapeHtml(provider.label)} · ${escapeHtml(provider.baseUrl)}</small>
          </div>
        </div>
      </div>
      <input class="provider-model" data-provider="${escapeHtml(provider.id)}" value="${escapeHtml(provider.model)}" aria-label="模型名称">
      ${isPrimary ? "<span></span>" : `<button class="set-primary" data-provider="${escapeHtml(provider.id)}">设为总控</button>`}
      <button class="danger remove-provider" data-provider="${escapeHtml(provider.id)}">移除</button>
    </div>`;
  }).join("");

  box.querySelectorAll(".provider-model").forEach((input) => {
    input.onchange = async () => {
      providers = providers.map((provider) => provider.id === input.dataset.provider
        ? { ...provider, model: input.value.trim() || provider.model }
        : provider);
      await saveProviders(providers);
      renderPrimaryState();
      toast("模型名已更新");
    };
  });

  box.querySelectorAll(".set-primary").forEach((button) => {
    button.onclick = async () => {
      preferences.primaryProviderId = button.dataset.provider;
      await savePreferences(preferences);
      renderProviders();
      renderPrimaryState();
      renderRunEstimate();
      toast("总控已切换");
    };
  });

  box.querySelectorAll(".remove-provider").forEach((button) => {
    button.onclick = async () => {
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
    };
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
    return `<article class="agent-card" data-agent="${escapeHtml(provider.id)}">
      <div class="agent-card-head">
        <div class="agent-inline">
          <span class="avatar">${escapeHtml(agentAvatar(provider.id))}</span>
          <strong>${escapeHtml(agent.displayName || provider.label)}</strong>
        </div>
        <small>底层模型：${escapeHtml(provider.label)} · ${escapeHtml(provider.model)}</small>
      </div>
      <label class="switch-row compact">
        <span><strong>参与多 Agent 任务</strong><small>自动路由会结合能力标签选择</small></span>
        <input data-field="participatesInDebate" type="checkbox" ${agent.participatesInDebate !== false ? "checked" : ""}>
      </label>
      <label>头像 / 代号<input data-field="avatar" maxlength="4" value="${escapeHtml(agent.avatar || "")}" placeholder="D"></label>
      <label>名字<input data-field="displayName" value="${escapeHtml(agent.displayName || "")}"></label>
      <label>定位<input data-field="role" value="${escapeHtml(agent.role || "")}"></label>
      <label>能力标签<input data-field="capabilities" value="${escapeHtml((agent.capabilities || []).join(", "))}" placeholder="decision, review, planning"></label>
      <label>性格<textarea data-field="personality" rows="2">${escapeHtml(agent.personality || "")}</textarea></label>
      <label>自定义提示词<textarea data-field="systemPrompt" rows="4">${escapeHtml(agent.systemPrompt || "")}</textarea></label>
    </article>`;
  }).join("");
}

function renderPrimaryState() {
  const primary = getPrimaryProvider();
  const mode = normalizeRunMode(preferences.runMode);
  $("primaryModelBadge").textContent = primary ? agentName(primary) : "未连接";
  $("connectionSummary").textContent = primary
    ? `总控：${agentName(primary)} · ${modeLabel(mode)}`
    : "等待添加模型";

  if (!activeRunContext || activeRunContext.conversationId !== activeConversationId) {
    $("chatStatus").textContent = primary
      ? `${agentName(primary)} · ${modeLabel(mode)}`
      : "请先在设置中添加模型";
  }

  const subtitle = $("welcomeSubtitle");
  if (subtitle) {
    subtitle.textContent = primary
      ? `${agentName(primary)} 负责最终回答；系统会自动选择任务流程。`
      : "添加模型后即可开始。";
  }
}

function renderRunEstimate() {
  const mode = normalizeRunMode($("runMode")?.value || preferences.runMode);
  if (mode === "auto") {
    $("runEstimate").textContent = "自动模式：普通问题 1 次调用；决策、审查和计划通常 2 次；明确要求碰撞时最多 5 次。";
    return;
  }
  const primary = getPrimaryProvider();
  const participants = selectParticipants({
    providers,
    primaryId: primary?.id,
    agentProfiles,
    maxAgents: $("maxDebateAgents")?.value || preferences.maxDebateAgents,
    recipe: "general"
  });
  const calls = estimateCallCount({
    mode,
    participantCount: participants.length,
    rounds: $("debateRounds")?.value || preferences.debateRounds
  });
  const names = participants.map(agentName).join("、") || "暂无模型";
  $("runEstimate").textContent = `预计 ${calls} 次模型调用；参与：${names}`;
}

function renderRouteHint() {
  const recipe = normalizeRecipe($("recipePicker").value);
  $("routeHint").textContent = recipe === "auto"
    ? "自动识别任务，并选择快速、参谋或碰撞流程"
    : `${getRecipe(recipe).label}：系统会优先选择匹配能力的 Agent`;
}

function renderWorklog(run) {
  clearProcess();
  renderProcessSummary(run);
  if (!run?.steps?.length) return;
  run.steps.forEach(renderProcessStep);
}

function renderProcessSummary(run) {
  if (!run) {
    $("processSummary").textContent = "等待任务。";
    return;
  }
  const recipe = getRecipe(run.recipe);
  const completed = run.steps?.filter((step) => step.state === "done").length || 0;
  const liveUsage = (run.steps || []).reduce((summary, step) => {
    summary.tokens += Number(step.usage) || 0;
    if (!["system", "input"].includes(step.providerId) && step.state !== "pending") summary.calls += 1;
    return summary;
  }, { calls: 0, tokens: 0 });
  $("processSummary").innerHTML = `
    <strong>${escapeHtml(recipe.label)} · ${escapeHtml(modeLabel(run.mode))}</strong>
    <span>${escapeHtml(run.routeReason || "手动选择流程")}</span>
    <small>${completed}/${run.steps?.length || 0} 步 · ${liveUsage.calls} 次调用 · ${liveUsage.tokens} tokens</small>
  `;
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
  const meta = [
    step.elapsedMs ? `${(step.elapsedMs / 1000).toFixed(1)}s` : "",
    step.usage ? `${step.usage} tokens` : ""
  ].filter(Boolean).join(" · ");
  const open = step.state === "running" || step.state === "error" ? "open" : "";
  return `<details ${open}>
    <summary>
      <span class="process-name">
        <span class="process-avatar">${escapeHtml(agentAvatar(step.providerId))}</span>
        <span>${escapeHtml(step.title)}</span>
      </span>
      <em>${escapeHtml(stateLabel(step.state))}</em>
    </summary>
    <pre>${escapeHtml(step.content)}</pre>
    ${meta ? `<div class="process-meta">${escapeHtml(meta)}</div>` : ""}
  </details>`;
}

function setWorklogVisible(visible) {
  worklogVisible = Boolean(visible && preferences.showProcess);
  $("appShell").classList.toggle("worklog-open", worklogVisible);
  $("toggleWorklogButton").classList.toggle("active", worklogVisible);
}

function updateRunControls() {
  const runningHere = Boolean(
    activeRunContext
    && activeRunContext.conversationId === activeConversationId
    && !activeRunContext.controller.signal.aborted
  );
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
  conversation.messages.forEach((message) => {
    const run = message.runId
      ? conversation.runs.find((item) => item.id === message.runId)
      : null;
    appendMessage(message, { conversation, run });
  });
  renderWorklog(conversation.runs.at(-1));
  showPage("chat");
  updateRunControls();
  await loadConversationList();
}

function newChat() {
  activeConversationId = null;
  $("conversationTitle").textContent = "新对话";
  clearProcess();
  renderProcessSummary(null);
  const primary = getPrimaryProvider();
  $("messages").innerHTML = `<div id="welcome" class="welcome">
    <div class="lab-stamp">MARCO / AGENT DESK</div>
    <h2>说目标，系统自己组队。</h2>
    <p id="welcomeSubtitle">${primary ? `${escapeHtml(agentName(primary))} 负责最终回答；系统会自动选择任务流程。` : "添加模型后即可开始。"}</p>
    <div class="recipe-grid">
      <button class="recipe-card" data-recipe="decision" data-prompt="帮我判断这件事该不该做，给明确结论和下一步。"><strong>做决策</strong><small>方案、取舍、优先级</small></button>
      <button class="recipe-card" data-recipe="review" data-prompt="帮我审查这个方案，重点找漏洞、风险和遗漏。"><strong>审方案</strong><small>Review、挑错、补缺口</small></button>
      <button class="recipe-card" data-recipe="plan" data-prompt="把这件事拆成可以直接执行的步骤和 To-do。"><strong>拆计划</strong><small>步骤、里程碑、Codex 任务</small></button>
      <button class="recipe-card" data-recipe="creative" data-prompt="围绕这个方向发散几个够有差异的创意，再筛出最值得做的。"><strong>创意发散</strong><small>选题、剧情、产品点子</small></button>
    </div>
  </div>`;
  document.querySelectorAll(".recipe-card").forEach((button) => {
    button.onclick = () => chooseRecipe(button.dataset.recipe, button.dataset.prompt);
  });
  $("recipePicker").value = "auto";
  renderRouteHint();
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
  const conversation = {
    id: crypto.randomUUID(),
    title: firstText.replace(/\s+/g, " ").slice(0, 32),
    createdAt: now,
    updatedAt: now,
    messages: [],
    runs: []
  };
  activeConversationId = conversation.id;
  return conversation;
}

async function loadConversationList() {
  const items = await listConversations();
  const box = $("conversationList");
  box.innerHTML = items.length
    ? items.map((item) => `<button class="conversation-item${item.id === activeConversationId ? " active" : ""}" data-id="${item.id}">${escapeHtml(item.title || "新对话")}</button>`).join("")
    : `<small>还没有对话</small>`;
  box.querySelectorAll(".conversation-item").forEach((button) => {
    button.onclick = () => openConversation(button.dataset.id);
  });
}

function appendMessage(message, { conversation = null, run = null, consulted = [] } = {}) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.dataset.messageId = message.id;

  const runMeta = run
    ? `${getRecipe(run.recipe).label} · ${run.usage?.calls || 0} 次调用 · ${run.usage?.totalTokens || 0} tokens`
    : "";
  const meta = message.role === "assistant" && (consulted.length || runMeta)
    ? `<div class="message-meta">${consulted.length ? `参考：${escapeHtml(consulted.join("、"))}` : ""}${consulted.length && runMeta ? " · " : ""}${escapeHtml(runMeta)}</div>`
    : "";
  const actions = message.role === "assistant" && run?.status === "completed"
    ? resultActionsHtml(run)
    : "";

  node.innerHTML = `<div class="message-body">
    <div class="bubble">${renderMessageContent(message.content)}</div>
    ${meta}
    ${actions}
  </div>`;
  $("messages").append(node);
  bindResultActions(node, message, conversation, run);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

function resultActionsHtml(run) {
  const rating = run.feedback?.rating || "";
  return `<div class="result-actions">
    <div class="action-row">
      <button data-result-action="copy">复制</button>
      <button data-result-action="simplify">更简洁</button>
      <button data-result-action="deepen">更深入</button>
      <button data-result-action="plan">继续拆解</button>
      <button data-result-action="codex">生成 Codex Prompt</button>
    </div>
    <div class="feedback-row">
      <span>这次结果：</span>
      <button data-feedback="useful" class="${rating === "useful" ? "selected" : ""}">有用</button>
      <button data-feedback="average" class="${rating === "average" ? "selected" : ""}">一般</button>
      <button data-feedback="poor" class="${rating === "poor" ? "selected" : ""}">没用</button>
    </div>
  </div>`;
}

function bindResultActions(node, message, conversation, run) {
  if (!run || !conversation) return;
  node.querySelectorAll("[data-result-action]").forEach((button) => {
    button.onclick = () => handleResultAction(button.dataset.resultAction, message.content);
  });
  node.querySelectorAll("[data-feedback]").forEach((button) => {
    button.onclick = () => saveFeedback(conversation.id, run.id, button.dataset.feedback, node);
  });
}

async function handleResultAction(action, content) {
  if (action === "copy") {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const area = document.createElement("textarea");
      area.value = content;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("已复制");
    return;
  }
  const prompts = {
    simplify: "把你上一条回答压缩成更简洁的版本，只保留明确结论、关键原因和下一步行动。",
    deepen: "基于你上一条回答继续深入，补充最容易被忽略的风险、关键假设和验证方法。",
    plan: "把你上一条回答继续拆成可执行 To-do，写清顺序、依赖和验收标准。",
    codex: "把你上一条回答转换成可以直接交给 Codex 执行的完整 Prompt，包含背景、目标、文件范围、限制、执行步骤和验收标准。"
  };
  const recipes = {
    simplify: "general",
    deepen: "review",
    plan: "plan",
    codex: "plan"
  };
  $("recipePicker").value = recipes[action] || "auto";
  $("chatInput").value = prompts[action] || "";
  renderRouteHint();
  resizeInput(false);
  $("chatForm").requestSubmit();
}

async function saveFeedback(conversationId, runId, rating, node) {
  const conversation = activeRunContext?.conversationId === conversationId
    ? activeRunContext.conversation
    : await getConversation(conversationId);
  const run = conversation?.runs.find((item) => item.id === runId);
  if (!run) return;
  run.feedback = {
    rating,
    createdAt: new Date().toISOString()
  };
  await saveConversation(conversation);
  node.querySelectorAll("[data-feedback]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.feedback === rating);
  });
  toast("反馈已记录");
}

function renderMessageContent(content) {
  const lines = String(content || "").split("\n");
  const html = [];
  let inCode = false;
  let code = [];

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        html.push(`<pre class="code-block"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (/^###\s+/.test(line)) html.push(`<h4>${escapeHtml(line.replace(/^###\s+/, ""))}</h4>`);
    else if (/^##\s+/.test(line)) html.push(`<h3>${escapeHtml(line.replace(/^##\s+/, ""))}</h3>`);
    else if (/^[-*]\s+/.test(line)) html.push(`<div class="bullet">• ${escapeHtml(line.replace(/^[-*]\s+/, ""))}</div>`);
    else if (/^\d+[.、]\s*/.test(line)) html.push(`<div class="numbered">${escapeHtml(line)}</div>`);
    else if (!line.trim()) html.push(`<div class="spacer"></div>`);
    else html.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (code.length) html.push(`<pre class="code-block"><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("");
}

async function exportCurrentMarkdown() {
  const conversation = activeConversationId ? await getConversation(activeConversationId) : null;
  if (!conversation?.messages?.length) {
    return toast("当前对话还没有可导出的内容。", true);
  }

  const lines = [
    `# ${conversation.title || "Team Agent Marco Conversation"}`,
    "",
    `- Created: ${conversation.createdAt}`,
    `- Updated: ${conversation.updatedAt}`,
    projectMemory.name ? `- Project: ${projectMemory.name}` : "",
    ""
  ].filter((line) => line !== undefined);

  conversation.messages.forEach((message) => {
    lines.push(`## ${message.role === "user" ? "User" : "Agent"}`, "", message.content, "");
  });

  conversation.runs.forEach((run, index) => {
    lines.push(
      `## WORKLOG ${index + 1}`,
      "",
      `- Recipe: ${getRecipe(run.recipe).label}`,
      `- Mode: ${modeLabel(run.mode)}`,
      `- Route: ${run.routeReason || ""}`,
      `- Status: ${run.status}`,
      `- Calls: ${run.usage?.calls || 0}`,
      `- Tokens: ${run.usage?.totalTokens || 0}`,
      `- Feedback: ${run.feedback?.rating || "none"}`,
      ""
    );
    run.steps.forEach((step) => {
      lines.push(`### ${step.title}`, "", step.content, "");
    });
  });

  const blob = new Blob([lines.join("\n")], {
    type: "text/markdown;charset=utf-8"
  });
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
  preferences.primaryProviderId = providers.find((provider) => provider.id === "deepseek")?.id
    || providers[0]?.id
    || "deepseek";
}

function getPrimaryProvider() {
  return providers.find((provider) => provider.id === preferences.primaryProviderId)
    || providers[0]
    || null;
}

function normalizeProviders(items) {
  return items.map((provider) => PROVIDER_DEFAULTS[provider.id]
    ? { ...PROVIDER_DEFAULTS[provider.id], ...provider }
    : { protocol: "openai-chat", ...provider });
}

function getAgent(id, provider = null) {
  return {
    ...defaultAgentFor(provider || providers.find((item) => item.id === id) || { id, label: id }),
    ...(agentProfiles[id] || {})
  };
}

function defaultAgentFor(provider) {
  return DEFAULT_AGENT_PROFILES[provider.id] || {
    avatar: (provider.label || provider.id).slice(0, 2),
    displayName: provider.label || provider.id,
    role: "自定义 Agent",
    personality: "直接、清晰、给可执行建议。",
    systemPrompt: `你是 ${provider.label || provider.id}，请作为 Team Agent Marco 的一个 Agent 发言。`,
    capabilities: ["review", "planning"],
    participatesInDebate: true
  };
}

function agentName(provider) {
  return getAgent(provider.id, provider).displayName || provider.label;
}

function agentAvatar(id) {
  if (id === "input") return "你";
  if (id === "error") return "!";
  if (id === "system") return "SYS";
  const agent = getAgent(id);
  return (agent.avatar || agent.displayName || id).slice(0, 4);
}

function createMessage(role, content, metadata = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...metadata
  };
}

function appendThinking(label) {
  return appendMessage(createMessage("assistant", `${label} 正在处理…`));
}

function clearProcess() {
  $("processList").innerHTML = `<div class="process-empty">暂无过程。</div>`;
}

function processNodeId(stepId) {
  return `process-${stepId}`;
}

function formatDebateNote(note) {
  return `Round ${note.round} · ${note.name}\n${note.text}`;
}

function describeRunPlan(plan, participants) {
  return `${getRecipe(plan.recipe).label}；${modeLabel(plan.mode)}；参与 ${participants.map(agentName).join("、")}；${plan.reason}；预计 ${estimateCallCount({
    mode: plan.mode,
    participantCount: participants.length,
    rounds: preferences.debateRounds
  })} 次模型调用。`;
}

function stateLabel(state) {
  return ({
    running: "进行中",
    error: "失败",
    cancelled: "已停止",
    done: "完成",
    pending: "等待"
  })[state] || state;
}

function parseCapabilities(value) {
  return String(value || "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setStatus(text) {
  $("chatStatus").textContent = text;
}

function setStatusForConversation(id, text) {
  if (activeConversationId === id) setStatus(text);
}

function setStatusForCurrentRun(text) {
  if (activeRunContext) setStatusForConversation(activeRunContext.conversationId, text);
}

function showDetectMessage(text, error = false) {
  const box = $("detectMessage");
  box.textContent = text;
  box.className = `inline-message${error ? " error" : ""}`;
  box.classList.remove("hidden");
}

function toggleCustomFields() {
  const visible = $("providerHint").value === "custom";
  document.querySelectorAll(".custom-field").forEach((field) => {
    field.classList.toggle("hidden", !visible);
  });
}

function toggleKeyVisibility() {
  const input = $("universalApiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("toggleKeyButton").textContent = input.type === "password" ? "显示 Key" : "隐藏 Key";
}

function resizeInput(force = false) {
  const input = $("chatInput");
  if (!input) return;
  const minHeight = 96;
  const maxHeight = 360;
  if (!input.value || force) {
    input.style.height = `${minHeight}px`;
    return;
  }
  const currentHeight = input.offsetHeight || minHeight;
  const targetHeight = Math.max(minHeight, Math.min(input.scrollHeight, maxHeight));
  if (currentHeight > targetHeight && currentHeight <= maxHeight) return;
  input.style.height = `${targetHeight}px`;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readError(error) {
  return error?.message || String(error);
}

function isAbortError(error) {
  return error?.name === "AbortError" || /停止|abort/i.test(readError(error));
}

function assertNotAborted(signal) {
  if (signal.aborted) throw new DOMException("用户已停止生成。", "AbortError");
}

function safeFileName(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "team-agent-marco";
}

function toast(text, error = false) {
  const box = $("toast");
  box.textContent = text;
  box.className = `toast${error ? " error" : ""}`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 3200);
}

function toggleMobileSidebar() {
  document.querySelector(".sidebar")?.classList.toggle("mobile-open");
}

function closeMobileSidebar() {
  document.querySelector(".sidebar")?.classList.remove("mobile-open");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  }
}
