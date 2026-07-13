# Team Agent Marco

Marco Lab 是一个通过 GitHub Pages 运行的多模型 Agent 工作台原型。

## v0.5 重点

- 输入问题时实时预览：任务 Recipe、运行模式、预计调用次数、参与 Agent 和项目记忆状态
- 对话管理：搜索、重命名当前对话、删除当前对话；`Ctrl / Cmd + K` 快速聚焦搜索
- 最终回答可以一键保存为项目的“已确认决定”，形成结果到长期记忆的闭环
- 代码块增加独立复制按钮
- 工作区功能独立在 `web/ux.js` 和 `web/ux.css`，避免继续把所有交互堆进 `app.js`

## v0.4 基础能力

- 默认使用自动模式：普通问题快速回答，决策/审查/计划自动调用参谋，明确要求碰撞时才跑深度模式
- 四个任务 Recipe：做决策、审方案、拆执行计划、创意发散
- Agent 按能力标签参与任务，不再单纯按 API 接入顺序组队
- 项目记忆：项目目标、固定背景、硬约束和已确认决定会进入提示词
- 最终回答优先展示结论、原因和行动；完整 WORKLOG 默认折叠
- 回答后支持复制、更简洁、更深入、继续拆解、生成 Codex Prompt
- 每次 Run 可记录“有用 / 一般 / 没用”反馈
- 深度碰撞、停止生成、对话持久化、调用统计和安全 Key 识别继续保留

## API Key 安全边界

- 自动识别只用于特征明确的 Gemini / OpenAI Key
- DeepSeek、智谱及其他平台需要手动选择
- 自定义 Base URL 必须使用 HTTPS，本机 localhost 调试除外
- Key 可以保存在当前设备，但网页运行时仍可解密读取
- 正式产品仍需要后端代理、鉴权、限流和服务端密钥管理

## 测试

```powershell
node --test tests/web-html.test.mjs
node --check web/app.js
node --check web/ux.js
node --check web/providers.js
node --check web/storage.js
node --check web/orchestrator.js
node --check web/sw.js
```

## 部署

`.github/workflows/pages.yml` 只监听 `main`，测试通过后发布 GitHub Pages。
