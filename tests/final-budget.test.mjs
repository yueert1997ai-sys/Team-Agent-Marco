import assert from "node:assert/strict";
import test from "node:test";
import { runCouncilMeeting } from "../dist/src/runner.js";

const config = {
  title: "预算检查",
  problem: "验证最终仲裁后仍会检查预算",
  moderatorId: "moderator",
  totalBudgetTokens: 500,
  maxRounds: 1,
  minSuccessfulMembers: 1,
  members: [
    { id: "moderator", name: "主持人", role: "仲裁", expertise: ["决策"], instructions: "形成结论" },
    { id: "expert", name: "专家", role: "分析", expertise: ["分析"], instructions: "给出意见" }
  ]
};

const executor = {
  async parallel(tasks) { return Promise.all(tasks.map((task) => task())); },
  async call(_prompt, options) {
    if (options.label.startsWith("首轮")) return { value: { memberId: "expert", position: "支持", reasons: ["原因"], risks: [], questions: [], confidence: 1 }, usage: { totalTokens: 100 } };
    if (options.label.startsWith("主持提炼")) return { value: { consensus: ["支持"], disagreements: [], missingInformation: [], questions: [], needsDiscussion: false }, usage: { totalTokens: 100 } };
    return { value: { summary: "结论", decision: "执行", rationale: ["原因"], acceptedPoints: [], rejectedPoints: [], unresolved: [], nextActions: [], confidence: 1 }, usage: { totalTokens: 300 } };
  }
};

test("checks token budget after final arbitration", async () => {
  await assert.rejects(runCouncilMeeting(config, executor), /budget exhausted after final arbitration: 500\/500/);
});
