import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import {
  estimateCallCount,
  getRecipe,
  normalizeRunMode,
  routeTask,
  selectParticipants
} from "../web/orchestrator.js";
import { detectProvider, inferProviderHintFromKey } from "../web/providers.js";

const execFileAsync = promisify(execFile);
async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("HTML exposes task desk, automatic recipes and workspace controls", async () => {
  const html = await read("web/index.html");
  for (const id of [
    "chatPage",
    "projectPage",
    "projectName",
    "recipePicker",
    "runMode",
    "toggleWorklogButton",
    "processSummary",
    "agentProfileList",
    "conversationSearch",
    "renameConversationButton",
    "deleteConversationButton",
    "conversationCount",
    "openTasksButton",
    "taskDesk",
    "taskInput",
    "taskList",
    "runTaskButton",
    "delegateTaskButton"
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /小事直办/);
  assert.match(html, /智能分工/);
  assert.match(html, /做决策/);
  assert.match(html, /审方案/);
  assert.match(html, /拆执行计划/);
  assert.match(html, /创意发散/);
  assert.match(html, /tasks\.css/);
  assert.match(html, /tasks\.js/);
});

test("automatic router distinguishes quick tasks, delegation and debates", () => {
  const simple = routeTask({
    text: "Docker Desktop 是干嘛的？",
    requestedMode: "auto",
    requestedRecipe: "auto",
    availableAgents: 2
  });
  assert.equal(simple.recipe, "general");
  assert.equal(simple.mode, "quick");

  const quickTask = routeTask({
    text: "帮我把这段话整理成三条要点",
    requestedMode: "auto",
    requestedRecipe: "auto",
    availableAgents: 2
  });
  assert.equal(quickTask.recipe, "task");
  assert.equal(quickTask.mode, "quick");

  const delegate = routeTask({
    text: "把这个项目分工给老D和智谱并行处理",
    requestedMode: "auto",
    requestedRecipe: "auto",
    availableAgents: 2
  });
  assert.equal(delegate.recipe, "delegate");
  assert.equal(delegate.mode, "advisor");

  const decision = routeTask({
    text: "这两个方案哪个更值得优先做？",
    requestedMode: "auto",
    requestedRecipe: "auto",
    availableAgents: 2
  });
  assert.equal(decision.recipe, "decision");
  assert.equal(decision.mode, "advisor");

  const debate = routeTask({
    text: "让老D和智谱深度讨论并互相反驳这个方案",
    requestedMode: "auto",
    requestedRecipe: "auto",
    availableAgents: 2
  });
  assert.equal(debate.mode, "debate");
});

test("task and delegation recipes have purpose-built outputs", () => {
  assert.deepEqual(getRecipe("task").finalSections, ["完成结果", "必要说明"]);
  assert.deepEqual(getRecipe("delegate").finalSections, ["任务目标", "分工与交付", "依赖和交接", "下一步行动"]);
  assert.match(getRecipe("delegate").round1Prompt, /领取一个明确子任务/);
});

test("participant routing uses capability tags rather than connection order", () => {
  const providers = [
    { id: "deepseek" },
    { id: "zhipu" },
    { id: "gemini" }
  ];
  const profiles = {
    deepseek: { capabilities: ["decision"] },
    zhipu: { capabilities: ["writing"] },
    gemini: { capabilities: ["technical", "review"] }
  };
  const selected = selectParticipants({
    providers,
    primaryId: "deepseek",
    agentProfiles: profiles,
    maxAgents: 2,
    recipe: "review"
  });
  assert.deepEqual(selected.map((item) => item.id), ["deepseek", "gemini"]);
  assert.deepEqual(getRecipe("plan").finalSections, ["目标", "执行步骤", "验收标准", "风险与回退"]);
});

test("call budget still matches explicit modes", () => {
  assert.equal(normalizeRunMode("bad"), "auto");
  assert.equal(estimateCallCount({ mode: "quick", participantCount: 2, rounds: 2 }), 1);
  assert.equal(estimateCallCount({ mode: "advisor", participantCount: 2, rounds: 2 }), 2);
  assert.equal(estimateCallCount({ mode: "debate", participantCount: 2, rounds: 2 }), 5);
});

test("safe key inference refuses ambiguous keys without network probes", async () => {
  assert.equal(inferProviderHintFromKey("AIza-example"), "gemini");
  assert.equal(inferProviderHintFromKey("sk-proj-example"), "openai");
  assert.equal(inferProviderHintFromKey("sk-ambiguous-provider-key"), null);

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("should not fetch");
  };
  await assert.rejects(
    () => detectProvider("sk-ambiguous-provider-key", 1000, "auto"),
    /避免把 Key 发送到错误平台/
  );
  assert.equal(fetchCalled, false);
  globalThis.fetch = originalFetch;
});

test("app includes project memory, feedback, one-click actions and collapsed worklog", async () => {
  const app = await read("web/app.js");
  const css = await read("web/styles.css");
  const storage = await read("web/storage.js");
  assert.match(app, /loadProjectMemory/);
  assert.match(app, /routeTask/);
  assert.match(app, /data-result-action="codex"/);
  assert.match(app, /data-feedback="useful"/);
  assert.match(app, /saveFeedback/);
  assert.match(app, /setWorklogVisible/);
  assert.match(app, /capabilities/);
  assert.match(storage, /saveProjectMemory/);
  assert.match(storage, /runMode:\s*migratedMode/);
  assert.match(css, /\.worklog-open \.process-panel/);
  assert.match(css, /\.result-actions/);
});

test("workspace UX previews routing and closes the result-to-project loop", async () => {
  const ux = await read("web/ux.js");
  const uxCss = await read("web/ux.css");
  assert.match(ux, /refreshRoutePreview/);
  assert.match(ux, /estimateCallCount/);
  assert.match(ux, /renameActiveConversation/);
  assert.match(ux, /deleteActiveConversation/);
  assert.match(ux, /saveMessageAsDecision/);
  assert.match(ux, /decorateCodeBlocks/);
  assert.match(ux, /removeRecord\("conversations"/);
  assert.match(uxCss, /\.conversation-tools/);
  assert.match(uxCss, /\.code-copy-button/);
  assert.match(uxCss, /route-preview-ready/);
});

test("task desk now tracks a full execution lifecycle", async () => {
  const tasks = await read("web/tasks.js");
  const css = await read("web/tasks.css");
  assert.match(tasks, /RECORD_ID = "task-desk"/);
  assert.match(tasks, /migrateTask/);
  assert.match(tasks, /priority/);
  assert.match(tasks, /schedule/);
  assert.match(tasks, /conversationId/);
  assert.match(tasks, /resultSummary/);
  assert.match(tasks, /openTaskResult/);
  assert.match(tasks, /editTask/);
  assert.match(tasks, /cyclePriority/);
  assert.match(tasks, /toggleSchedule/);
  assert.match(tasks, /document\.getElementById\("newChatButton"\)\?\.click/);
  assert.match(tasks, /任务完成，结果已关联到任务卡/);
  assert.match(tasks, /data-task-filter = "today"|dataset\.taskFilter = "today"/);
  assert.match(tasks, /extractNextSteps/);
  assert.match(tasks, /data-task-result-action="extract"/);
  assert.match(tasks, /putRecord\("settings"/);
  assert.match(css, /\.task-meta-controls/);
  assert.match(css, /\.task-result-preview/);
  assert.match(css, /priority-high/);
  assert.match(css, /\.task-item\.running/);
});

test("provider final prompt is structured and receives project memory", async () => {
  const source = await read("web/providers.js");
  assert.match(source, /formatProjectMemory/);
  assert.match(source, /最终回答必须优先给结果/);
  assert.match(source, /finalSections/);
  assert.match(source, /项目记忆（视为长期有效背景）/);
});

test("service worker caches only successful responses and all task assets", async () => {
  const source = await read("web/sw.js");
  assert.match(source, /response\.ok/);
  assert.match(source, /orchestrator\.js/);
  assert.match(source, /ux\.js/);
  assert.match(source, /tasks\.js/);
  assert.match(source, /tasks\.css/);
  assert.match(source, /web-v12/);
});

test("all web JavaScript files pass syntax checks", async () => {
  for (const path of [
    "web/app.js",
    "web/ux.js",
    "web/tasks.js",
    "web/providers.js",
    "web/storage.js",
    "web/orchestrator.js",
    "web/sw.js"
  ]) {
    const { stderr } = await execFileAsync(process.execPath, ["--check", path]);
    assert.equal(stderr, "");
  }
});
