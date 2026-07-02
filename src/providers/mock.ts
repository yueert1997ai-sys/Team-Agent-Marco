import type { AgentCallResult } from "../types.js";
import type { CouncilProvider, ProviderRequest } from "./types.js";

export class MockProvider implements CouncilProvider {
  readonly id = "mock";

  async generate<T>(request: ProviderRequest): Promise<AgentCallResult<T>> {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return {
      value: createMockValue(request) as T,
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 }
    };
  }
}

function createMockValue(request: ProviderRequest): unknown {
  const label = request.options.label;
  if (label.startsWith("首轮")) {
    const memberId = extractMemberId(request.prompt);
    return {
      memberId,
      position: `${label}建议先做小范围验证，并用真实会议质量决定是否继续投入。`,
      reasons: ["开发边界清晰", "可以在接 UI 前验证多模型协作价值"],
      risks: ["模型输出可能不稳定", "讨论轮次过多会增加成本"],
      questions: ["怎样定义一次会议是否真正有价值？"],
      confidence: 0.78
    };
  }
  if (label.startsWith("主持提炼")) {
    const ids = [...new Set([...request.prompt.matchAll(/"memberId":\s*"([^"]+)"/g)].map((match) => match[1]))];
    const target = ids.at(-1) ?? "expert";
    return {
      consensus: ["先验证后端会议流程", "先限制成员数和会议轮次"],
      disagreements: ["第一版应该投入多少真实 API 成本"],
      missingInformation: ["真实模型会议的 Token 消耗和输出质量"],
      questions: [{
        id: "mock-q1",
        question: "怎样以最低成本完成第一次真实验证？",
        targetMemberIds: [target],
        relevantMemberIds: ids.filter((id) => id !== target)
      }],
      needsDiscussion: true
    };
  }
  if (label.startsWith("回应")) {
    const memberId = extractMemberId(request.prompt);
    return {
      memberId,
      response: "先使用一个免费或低价模型搭配一个主模型，限制在两轮内，并记录 Token 和失败率。",
      revisedPosition: "支持继续，但第一版只保留必要 Provider 和命令行入口。",
      agreements: ["先验证会议质量", "暂缓完整桌面 UI"],
      objections: ["不建议一开始接入太多模型"],
      confidence: 0.86
    };
  }
  return {
    summary: "完成可运行的多模型圆桌 Demo，再决定是否合入完整 Hanako 桌面端。",
    decision: "批准进入真实 API 验证阶段。",
    rationale: ["后端核心已通过测试", "命令行 Demo 足以验证协作质量和成本"],
    acceptedPoints: [{ memberId: "team", point: "限制两轮、保存记录、优先低成本模型" }],
    rejectedPoints: [{ memberId: "team", point: "立即开发完整 UI", reason: "尚未验证真实会议价值" }],
    unresolved: ["真实 API 单场成本和稳定性"],
    nextActions: [
      { owner: "Marco", action: "填写 Gemini 或 DeepSeek API Key 并运行首次真实会议", priority: "high" },
      { owner: "Developer", action: "根据真实会议结果调整提示词和角色配置", priority: "medium" }
    ],
    confidence: 0.88
  };
}

function extractMemberId(prompt: string): string {
  return prompt.match(/返回 memberId 时必须填写：([^\n]+)/)?.[1]?.trim() ?? "member";
}
