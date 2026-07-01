# Hanako Council MVP

这是一个可嵌入 HanaAgent/OpenHanako 的多模型圆桌会议后端 MVP。它不重新实现模型 Provider，而是复用 HanaAgent 现有 workflow host API：`agent()`、`parallel()`、结构化输出和 UsageLedger budget。

## 已完成

- 多成员首轮独立发言，避免互相锚定
- 主持人压缩共识、分歧和缺失信息
- 按问题定向邀请成员参加第二轮，不让所有模型重复读完整历史
- 主持人最终仲裁，记录采纳、否决、未解决项和下一步行动
- 每名成员可绑定独立 `model` / `agentType`
- 默认只读权限
- 单个成员失败时可降级继续
- 会议事件回调，供 UI 展示进度
- 结构化输出 schema
- 输入校验与成员 ID 防串线
- Token usage 汇总接口；实际硬预算继续由 HanaAgent Workflow UsageLedger 执行

## 当前边界

- 这是后端核心模块，还没有 React 页面和持久化表。
- 需要将 `src/` 合入 OpenHanako 后，在 Council 页面调用 `runCouncilMeeting()`。
- `maxOutputTokens` 已保留在抽象层，但 OpenHanako 当前 workflow `agent()` 尚未暴露该字段；第一版由提示词和总 budget 控制输出长度。
- API Key 不进入本模块，继续由 OpenHanako Provider 配置和安全存储负责。

## 自检

```bash
npm run check
```

测试覆盖：完整两轮会议、无分歧提前结束、成员失败降级、重复 ID、禁用主持人。

## 推荐合入位置

```text
lib/council/
  types.ts
  schemas.ts
  validation.ts
  prompts.ts
  runner.ts
  hanako-adapter.ts
  index.ts

tests/
  council.test.ts
```
