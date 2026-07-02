import {
  createHanakoCouncilExecutor,
  runCouncilMeeting,
  type CouncilConfig,
  type HanakoWorkflowHostApi
} from "../src/index.js";

export async function runExample(host: HanakoWorkflowHostApi) {
  const config: CouncilConfig = {
    title: "是否上线新的海外内容方向",
    problem: "评估一个新的中东游戏内容栏目是否值得进入制作阶段。",
    context: "目标平台为 TikTok，团队资源有限，需要一周内得到验证信号。",
    moderatorId: "moderator",
    maxRounds: 2,
    totalBudgetTokens: 8000,
    maxOutputTokensPerTurn: 500,
    members: [
      {
        id: "moderator",
        name: "总控",
        role: "主持与仲裁",
        expertise: ["综合决策", "资源配置"],
        instructions: "在用户价值、证据、成本和风险之间做明确取舍",
        model: "openai/gpt-5.5"
      },
      {
        id: "market",
        name: "市场负责人",
        role: "市场与本地化",
        expertise: ["中东市场", "内容本地化"],
        instructions: "重点判断当地用户兴趣、文化风险和传播语境",
        model: "deepseek/deepseek-chat"
      },
      {
        id: "creative",
        name: "视觉负责人",
        role: "创意与画面",
        expertise: ["短视频创意", "多模态"],
        instructions: "重点判断画面表现、可生产性和视觉差异化",
        model: "gemini/gemini-flash"
      },
      {
        id: "critic",
        name: "反方评审",
        role: "风险审查",
        expertise: ["失败预演", "资源风险"],
        instructions: "主动寻找被忽略的假设和最可能失败的环节"
      }
    ]
  };

  return runCouncilMeeting(config, createHanakoCouncilExecutor(host));
}
