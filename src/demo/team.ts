import type { CouncilConfig, CouncilMember } from "../types.js";
import type { RuntimeConfig } from "../config/runtime.js";

export type DemoMode = "mock" | "live";

export interface DemoTeamResult {
  config: CouncilConfig;
  providerIds: string[];
}

export function buildDemoTeam(
  title: string,
  problem: string,
  context: string,
  mode: DemoMode,
  runtime: RuntimeConfig
): DemoTeamResult {
  const available: Array<{ id: "gemini" | "deepseek"; model: string }> = [];
  if (runtime.geminiApiKey) available.push({ id: "gemini", model: runtime.geminiModel });
  if (runtime.deepSeekApiKey) available.push({ id: "deepseek", model: runtime.deepSeekModel });

  if (mode === "live" && available.length === 0) {
    throw new Error("真实 API 模式需要先在程序的“API 设置”页面保存 Gemini 或 DeepSeek Key。");
  }

  const route = (preferred: "gemini" | "deepseek"): string => {
    if (mode === "mock") return "mock/mock";
    const chosen = available.find((item) => item.id === preferred) ?? available[0];
    if (!chosen) return "mock/mock";
    return `${chosen.id}/${chosen.model}`;
  };

  const members: CouncilMember[] = [
    {
      id: "moderator",
      name: "总控主持人",
      role: "主持、提炼分歧与最终仲裁",
      expertise: ["综合判断", "资源配置", "决策"],
      instructions: "优先采用证据充分、风险可控、可以立刻行动的意见，并给出明确结论。",
      model: route("gemini")
    },
    {
      id: "product",
      name: "产品负责人",
      role: "产品与用户价值",
      expertise: ["需求判断", "MVP", "商业价值"],
      instructions: "聚焦用户真正需要什么、最小验证范围和投入产出比。",
      model: route("deepseek")
    },
    {
      id: "technical",
      name: "技术负责人",
      role: "技术架构与实施",
      expertise: ["架构", "开发成本", "稳定性"],
      instructions: "识别实现难点、依赖、维护负担，并提出最小可靠方案。",
      model: route("gemini")
    },
    {
      id: "critic",
      name: "反方评审",
      role: "风险与失败预演",
      expertise: ["质疑假设", "风险识别", "反例"],
      instructions: "主动挑战共识，指出最容易失败、最容易浪费时间或金钱的部分。",
      model: route("deepseek")
    }
  ];

  return {
    providerIds: mode === "mock" ? ["mock"] : available.map((item) => item.id),
    config: {
      title,
      problem,
      ...(context.trim() ? { context: context.trim() } : {}),
      moderatorId: "moderator",
      maxRounds: 2,
      maxOutputTokensPerTurn: runtime.maxOutputTokens,
      totalBudgetTokens: runtime.budgetTokens,
      members
    }
  };
}
