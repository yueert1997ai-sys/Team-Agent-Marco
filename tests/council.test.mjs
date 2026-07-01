import assert from "node:assert/strict";
import test from "node:test";
import { runCouncilMeeting } from "../dist/src/runner.js";
import { normalizeCouncilConfig } from "../dist/src/validation.js";

const baseConfig = {
  title: "产品方向评审",
  problem: "是否应该先做多模型圆桌会议 MVP？",
  context: "个人自用，优先降低开发量。",
  moderatorId: "moderator",
  maxRounds: 2,
  maxOutputTokensPerTurn: 400,
  minSuccessfulMembers: 2,
  members: [
    {
      id: "moderator",
      name: "主持人",
      role: "最终仲裁",
      expertise: ["综合判断"],
      instructions: "压缩分歧并给出明确决策",
      model: "openai/gpt-5.5"
    },
    {
      id: "product",
      name: "产品负责人",
      role: "产品设计",
      expertise: ["用户价值", "MVP"],
      instructions: "优先考虑用户价值和验证速度",
      model: "deepseek/deepseek-chat"
    },
    {
      id: "tech",
      name: "技术负责人",
      role: "技术架构",
      expertise: ["架构", "成本"],
      instructions: "评估实现风险和维护成本",
      model: "gemini/gemini-flash"
    }
  ]
};

class ScriptedExecutor {
  calls = [];
  first = 0;
  second = 0;

  constructor(needsDiscussion = true, failFirstMember) {
    this.needsDiscussion = needsDiscussion;
    this.failFirstMember = failFirstMember;
  }

  async call(prompt, options) {
    this.calls.push({ prompt, options });
    const label = options.label;
    if (label.startsWith("首轮")) {
      const memberId = prompt.includes("返回 memberId 时必须填写：product") ? "product" : "tech";
      if (this.failFirstMember === memberId) throw new Error("simulated failure");
      this.first += 1;
      return {
        value: {
          memberId,
          position: `${memberId} position`,
          reasons: ["reason"],
          risks: ["risk"],
          questions: ["question"],
          confidence: 0.8
        },
        usage: { totalTokens: 100 }
      };
    }
    if (label.startsWith("主持提炼")) {
      return {
        value: {
          consensus: ["先做 MVP"],
          disagreements: this.needsDiscussion ? ["范围大小"] : [],
          missingInformation: [],
          questions: this.needsDiscussion
            ? [{ id: "q1", question: "范围如何控制？", targetMemberIds: ["tech"], relevantMemberIds: ["product"] }]
            : [],
          needsDiscussion: this.needsDiscussion
        },
        usage: { totalTokens: 80 }
      };
    }
    if (label.startsWith("回应")) {
      this.second += 1;
      return {
        value: {
          memberId: "tech",
          response: "限制在后端圆桌流程",
          revisedPosition: "支持小范围 MVP",
          agreements: ["先验证"],
          objections: ["不要先做全套 UI"],
          confidence: 0.9
        },
        usage: { totalTokens: 70 }
      };
    }
    return {
      value: {
        summary: "先完成后端圆桌 MVP",
        decision: "批准",
        rationale: ["开发量可控"],
        acceptedPoints: [{ memberId: "tech", point: "控制范围" }],
        rejectedPoints: [],
        unresolved: [],
        nextActions: [{ owner: "developer", action: "接入 Hanako workflow", priority: "high" }],
        confidence: 0.9
      },
      usage: { totalTokens: 120 }
    };
  }

  async parallel(tasks) {
    return Promise.all(tasks.map(async (task) => {
      try { return await task(); } catch { return null; }
    }));
  }

  stats() { return { first: this.first, second: this.second }; }
}

test("runs independent first round, targeted discussion, and final arbitration", async () => {
  const executor = new ScriptedExecutor(true);
  const events = [];
  const result = await runCouncilMeeting(baseConfig, executor, {
    now: () => 123,
    randomId: () => "fixed",
    onEvent: (event) => events.push(event.type)
  });

  assert.equal(result.meetingId, "council-123-fixed");
  assert.equal(result.firstRound.length, 2);
  assert.equal(result.secondRound.length, 1);
  assert.equal(result.secondRound[0]?.memberId, "tech");
  assert.equal(result.finalDecision.decision, "批准");
  assert.equal(result.estimatedUsageTokens, 470);
  assert.deepEqual(executor.stats(), { first: 2, second: 1 });
  assert.equal(executor.calls.filter((call) => call.options.access === "read").length, 5);
  assert.ok(events.includes("meeting_completed"));
});

test("skips second round when moderator finds no meaningful disagreement", async () => {
  const executor = new ScriptedExecutor(false);
  const result = await runCouncilMeeting(baseConfig, executor, {
    now: () => 1,
    randomId: () => "x"
  });

  assert.equal(result.secondRound.length, 0);
  assert.deepEqual(executor.stats(), { first: 2, second: 0 });
  assert.equal(result.estimatedUsageTokens, 400);
});

test("continues when one member fails and minimum success threshold is met", async () => {
  const executor = new ScriptedExecutor(false, "product");
  const result = await runCouncilMeeting({ ...baseConfig, minSuccessfulMembers: 1 }, executor, {
    now: () => 1,
    randomId: () => "x"
  });

  assert.equal(result.firstRound.length, 1);
  assert.equal(result.failedMembers.length, 1);
  assert.equal(result.failedMembers[0]?.memberId, "product");
});

test("rejects duplicate member ids", () => {
  const duplicated = {
    ...baseConfig,
    members: [...baseConfig.members, { ...baseConfig.members[1], name: "duplicate" }]
  };
  assert.throws(() => normalizeCouncilConfig(duplicated), /Duplicate council member id/);
});

test("rejects a moderator that is disabled", () => {
  const disabledModerator = {
    ...baseConfig,
    members: baseConfig.members.map((member) => member.id === "moderator" ? { ...member, enabled: false } : member)
  };
  assert.throws(() => normalizeCouncilConfig(disabledModerator), /Moderator/);
});

test("two-member council defaults to one required first-round participant", () => {
  const twoMembers = { ...baseConfig, minSuccessfulMembers: undefined, members: baseConfig.members.slice(0, 2) };
  const normalized = normalizeCouncilConfig(twoMembers);
  assert.equal(normalized.minSuccessfulMembers, 1);
});

test("rejects a first-round response that impersonates another member", async () => {
  class WrongIdExecutor extends ScriptedExecutor {
    async call(prompt, options) {
      const result = await super.call(prompt, options);
      if (options.label.startsWith("首轮")) result.value.memberId = "someone-else";
      return result;
    }
  }
  await assert.rejects(
    runCouncilMeeting({ ...baseConfig, minSuccessfulMembers: 2 }, new WrongIdExecutor(false)),
    /Only 0 first-round members succeeded/
  );
});

test("enforces total token budget when executor reports usage", async () => {
  class ExpensiveExecutor extends ScriptedExecutor {
    async call(prompt, options) {
      const result = await super.call(prompt, options);
      result.usage = { totalTokens: 300 };
      return result;
    }
  }
  await assert.rejects(
    runCouncilMeeting({ ...baseConfig, totalBudgetTokens: 500 }, new ExpensiveExecutor(false)),
    /budget exhausted after first round: 600\/500/
  );
});

test("Hanako adapter forwards model, agent type, access and schema", async () => {
  const { createHanakoCouncilExecutor } = await import("../dist/src/hanako-adapter.js");
  const calls = [];
  const host = {
    async agent(prompt, options) { calls.push({ prompt, options }); return { ok: true }; },
    async parallel(tasks) { return Promise.all(tasks.map((task) => task())); }
  };
  const executor = createHanakoCouncilExecutor(host);
  const schema = { type: "object" };
  const result = await executor.call("hello", {
    label: "test",
    model: "deepseek/chat",
    agentType: "critic",
    access: "read",
    schema,
    maxOutputTokens: 300
  });
  assert.deepEqual(result.value, { ok: true });
  assert.deepEqual(calls[0], {
    prompt: "hello",
    options: { label: "test", model: "deepseek/chat", agentType: "critic", access: "read", schema }
  });
});
