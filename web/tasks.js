import {
  getRecord,
  initializeStorage,
  putRecord
} from "./storage.js";

const RECORD_ID = "task-desk";
const ACTIVE_TASK_KEY = "marco-active-task";
let tasks = [];
let activeFilter = "open";
let taskObserverTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  tasks = await loadTasks();
  bindTaskDesk();
  observeResults();
  renderTasks();
  decorateTaskActions();
  restoreInterruptedTask();
});

function bindTaskDesk() {
  const open = document.getElementById("openTasksButton");
  const close = document.getElementById("closeTasksButton");
  const backdrop = document.getElementById("taskDeskBackdrop");
  const input = document.getElementById("taskInput");

  open?.addEventListener("click", openTaskDesk);
  close?.addEventListener("click", closeTaskDesk);
  backdrop?.addEventListener("click", closeTaskDesk);
  document.getElementById("saveTaskButton")?.addEventListener("click", () => captureTask("inbox"));
  document.getElementById("runTaskButton")?.addEventListener("click", () => captureTask("task", true));
  document.getElementById("delegateTaskButton")?.addEventListener("click", () => captureTask("delegate", true));
  document.getElementById("taskList")?.addEventListener("click", handleTaskAction);

  document.querySelectorAll(".task-filter").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.taskFilter || "open";
      document.querySelectorAll(".task-filter").forEach((item) => item.classList.toggle("active", item === button));
      renderTasks();
    });
  });

  input?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      captureTask("inbox");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("taskDesk")?.classList.contains("hidden")) closeTaskDesk();
  });
}

function openTaskDesk() {
  document.getElementById("taskDesk")?.classList.remove("hidden");
  document.getElementById("taskDeskBackdrop")?.classList.remove("hidden");
  document.body.classList.add("task-desk-open");
  setTimeout(() => document.getElementById("taskInput")?.focus(), 40);
}

function closeTaskDesk() {
  document.getElementById("taskDesk")?.classList.add("hidden");
  document.getElementById("taskDeskBackdrop")?.classList.add("hidden");
  document.body.classList.remove("task-desk-open");
}

async function captureTask(mode, execute = false) {
  const input = document.getElementById("taskInput");
  const title = String(input?.value || "").trim();
  if (!title) return showToast("先写下要处理的事。", true);

  const task = createTask(title, mode === "delegate" ? "delegate" : "task");
  tasks.unshift(task);
  await persistTasks();
  if (input) input.value = "";
  renderTasks();

  if (execute) {
    await executeTask(task.id, mode);
  } else {
    showToast("已加入任务台");
  }
}

function createTask(title, preferredRecipe = "task") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: title.slice(0, 1600),
    status: "inbox",
    preferredRecipe,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastRunAt: null
  };
}

async function handleTaskAction(event) {
  const button = event.target.closest("button[data-task-action]");
  if (!button) return;
  const item = button.closest(".task-item");
  const taskId = item?.dataset.taskId;
  const action = button.dataset.taskAction;
  if (!taskId) return;

  if (action === "run") return executeTask(taskId, "task");
  if (action === "delegate") return executeTask(taskId, "delegate");
  if (action === "toggle") return toggleTask(taskId);
  if (action === "delete") return deleteTask(taskId);
}

async function executeTask(taskId, recipe) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;

  const recipePicker = document.getElementById("recipePicker");
  const chatInput = document.getElementById("chatInput");
  const chatForm = document.getElementById("chatForm");
  const sendButton = document.getElementById("sendButton");
  if (!recipePicker || !chatInput || !chatForm || sendButton?.disabled) {
    return showToast("当前任务正在运行，请稍后再试。", true);
  }

  task.status = "running";
  task.preferredRecipe = recipe;
  task.lastRunAt = new Date().toISOString();
  task.updatedAt = task.lastRunAt;
  await persistTasks();
  renderTasks();

  writeActiveTaskMarker({
    id: task.id,
    baselineResults: document.querySelectorAll(".message.assistant .result-actions").length,
    startedAt: task.lastRunAt
  });
  closeTaskDesk();
  document.querySelector(".backToChatButton")?.click();

  recipePicker.value = recipe;
  chatInput.value = recipe === "delegate"
    ? `请把下面任务分工给合适的 Agent 并行处理。每个 Agent 领取清晰子任务并交付结果，最后由总控汇总：\n\n${task.title}`
    : `直接完成下面这件小事，给我可以直接使用的结果：\n\n${task.title}`;
  chatInput.dispatchEvent(new Event("input", { bubbles: true }));
  recipePicker.dispatchEvent(new Event("change", { bubbles: true }));
  setTimeout(() => chatForm.requestSubmit(), 60);
}

async function toggleTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const done = task.status === "done";
  task.status = done ? "inbox" : "done";
  task.completedAt = done ? null : new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  if (readActiveTaskMarker()?.id === taskId) clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
}

async function deleteTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (!window.confirm(`删除任务“${task.title.slice(0, 50)}”？`)) return;
  tasks = tasks.filter((item) => item.id !== taskId);
  if (readActiveTaskMarker()?.id === taskId) clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
}

function renderTasks() {
  const list = document.getElementById("taskList");
  if (!list) return;

  const filtered = tasks.filter((task) => {
    if (activeFilter === "done") return task.status === "done";
    if (activeFilter === "open") return task.status !== "done";
    return true;
  });

  list.innerHTML = filtered.length
    ? filtered.map(renderTaskItem).join("")
    : `<div class="task-empty">${activeFilter === "done" ? "还没有完成的任务。" : "还没有待处理任务。"}</div>`;

  const openCount = tasks.filter((task) => task.status !== "done").length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  setText("openTaskCount", openCount);
  setText("doneTaskCount", doneCount);
  setText("taskInboxCount", openCount);
}

function renderTaskItem(task) {
  const statusLabel = task.status === "done" ? "已完成" : task.status === "running" ? "处理中" : "待处理";
  const recipeLabel = task.preferredRecipe === "delegate" ? "分工" : "直办";
  return `<article class="task-item ${escapeHtml(task.status)}" data-task-id="${escapeHtml(task.id)}">
    <div class="task-item-head"><span class="task-status">${statusLabel}</span><small>${recipeLabel}</small></div>
    <p>${escapeHtml(task.title)}</p>
    <div class="task-item-actions">
      ${task.status === "done" ? "" : '<button type="button" data-task-action="run">直办</button><button type="button" data-task-action="delegate">分工</button>'}
      <button type="button" data-task-action="toggle">${task.status === "done" ? "重新打开" : "完成"}</button>
      <button type="button" data-task-action="delete" class="task-delete">删除</button>
    </div>
  </article>`;
}

function observeResults() {
  const messages = document.getElementById("messages");
  if (!messages) return;
  const observer = new MutationObserver(() => {
    clearTimeout(taskObserverTimer);
    taskObserverTimer = setTimeout(async () => {
      decorateTaskActions();
      await completeActiveTaskFromResult();
    }, 50);
  });
  observer.observe(messages, { childList: true, subtree: true });
}

function decorateTaskActions() {
  document.querySelectorAll(".message.assistant .result-actions").forEach((actions) => {
    if (actions.querySelector('[data-task-result-action="extract"]')) return;
    const row = actions.querySelector(".action-row");
    if (!row) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.taskResultAction = "extract";
    button.textContent = "加入任务台";
    button.addEventListener("click", () => addNextStepsFromMessage(actions.closest(".message"), button));
    row.append(button);
  });
}

async function addNextStepsFromMessage(messageNode, button) {
  const content = messageNode?.querySelector(".bubble")?.innerText?.trim();
  if (!content) return showToast("没有可提取的任务。", true);
  const nextSteps = extractNextSteps(content);
  if (!nextSteps.length) return showToast("没有识别到明确的下一步。", true);

  const existing = new Set(tasks.map((task) => normalizeTaskText(task.title)));
  const additions = nextSteps
    .filter((title) => !existing.has(normalizeTaskText(title)))
    .map((title) => createTask(title, "task"));

  if (!additions.length) return showToast("这些下一步已经在任务台里。", true);
  tasks.unshift(...additions);
  await persistTasks();
  renderTasks();
  button.textContent = `已加入 ${additions.length} 项`;
  button.disabled = true;
  showToast(`已加入 ${additions.length} 个任务`);
}

function extractNextSteps(content) {
  const normalized = String(content || "").replace(/\r/g, "");
  const section = normalized.match(/(?:^|\n)(?:下一步行动|下一步|执行步骤|修复顺序|下一步验证|分工与交付)\s*[：:]?\s*\n([\s\S]*?)(?=\n(?:仍有争议|风险|风险与回退|必要说明|关键原因|代价与风险|依赖和交接|验收标准)\s*[：:]?|$)/i)?.[1] || "";
  const source = section || normalized;
  const lines = source
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim())
    .filter((line) => line.length >= 4 && line.length <= 240)
    .filter((line) => !/^(结论|关键原因|必要说明|总体判断|风险)/.test(line));
  return Array.from(new Set(lines)).slice(0, 8);
}

async function completeActiveTaskFromResult() {
  const marker = readActiveTaskMarker();
  if (!marker) return;
  if (!document.getElementById("stopButton")?.classList.contains("hidden")) return;

  const statusText = document.getElementById("chatStatus")?.textContent || "";
  if (/(发送失败|已停止)/.test(statusText)) {
    await reopenActiveTask(marker.id);
    return;
  }

  const resultCount = document.querySelectorAll(".message.assistant .result-actions").length;
  if (resultCount <= Number(marker.baselineResults || 0)) return;

  const task = tasks.find((item) => item.id === marker.id);
  if (!task || task.status !== "running") {
    clearActiveTaskMarker();
    return;
  }
  task.status = "done";
  task.completedAt = new Date().toISOString();
  task.updatedAt = task.completedAt;
  clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
  showToast("任务已完成并归档");
}

async function reopenActiveTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (task?.status === "running") {
    task.status = "inbox";
    task.updatedAt = new Date().toISOString();
    await persistTasks();
    renderTasks();
  }
  clearActiveTaskMarker();
}

async function restoreInterruptedTask() {
  const marker = readActiveTaskMarker();
  if (!marker) return;
  await reopenActiveTask(marker.id);
}

function writeActiveTaskMarker(marker) {
  sessionStorage.setItem(ACTIVE_TASK_KEY, JSON.stringify(marker));
}

function readActiveTaskMarker() {
  const raw = sessionStorage.getItem(ACTIVE_TASK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return { id: raw, baselineResults: 0 };
  }
}

function clearActiveTaskMarker() {
  sessionStorage.removeItem(ACTIVE_TASK_KEY);
}

async function loadTasks() {
  const record = await getRecord("settings", RECORD_ID);
  return Array.isArray(record?.items) ? record.items : [];
}

async function persistTasks() {
  await putRecord("settings", { id: RECORD_ID, items: tasks });
}

function normalizeTaskText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(text, error = false) {
  const box = document.getElementById("toast");
  if (!box) return;
  box.textContent = text;
  box.className = `toast${error ? " error" : ""}`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 2800);
}
