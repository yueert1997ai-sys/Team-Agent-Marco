# Team Agent Marco

一个可直接通过 GitHub Pages 使用的多模型 HTML 聊天工作台。当前形态是 Marco Lab / Team Agent Marco 的私人 AI 控制台原型，先把 HTML 版做到可用、好用、可继续迭代。

## 当前网页版本

- Marco Lab 黑白工作台 UI：左侧导航和最近对话，中间聊天，右侧 WORKLOG
- 输入框默认更高，支持长 prompt、手动拖拽，高度上限 360px
- Enter 发送，Shift + Enter 换行
- DeepSeek 默认担任总控，默认 Agent 名称为“老D”
- 智谱 GLM 默认 Agent 名称为“智谱参谋”
- 支持 DeepSeek、智谱 GLM、OpenAI、Google Gemini
- 支持任意 OpenAI `chat/completions` 兼容接口
- 右侧 WORKLOG 显示 Agent 发言、失败、整合过程，并展示 Agent 头像 / 代号
- Agent 定制页只显示已接入 API 的模型
- 每个 Agent 支持自定义头像、名字、定位、性格和系统提示词
- 支持把当前对话一键导出为 Markdown
- 对话和加密后的 Key 保存在当前浏览器 IndexedDB

智谱 GLM 默认配置：

```text
Base URL: https://open.bigmodel.cn/api/paas/v4
Model: glm-5.2
```

DeepSeek 默认配置：

```text
Base URL: https://api.deepseek.com
Model: deepseek-chat
```

网页目录：`web/`

测试：

```powershell
npm install
npm run check
```

如果只检查当前 HTML 版，可运行：

```powershell
node --test tests/web-html.test.mjs
node --check web/app.js
node --check web/providers.js
node --check web/storage.js
node --check web/sw.js
```

部署由 `.github/workflows/pages.yml` 自动完成。GitHub Pages 若没有自动触发，可进入 Actions，选择 `Deploy HTML web app`，手动 Run workflow 到 `main`。

## 飞书接入方案

### 简单版

网页或一个轻量后端把 Agent 最终结论推送到飞书群。HTML 静态页可以调用自己后端的接口，后端再调用飞书机器人 Webhook。

适合：先验证“网页里跑完 Agent，一键推到群里”的工作流。

### 完整版

- 飞书自建应用 + 机器人 + 事件订阅
- 用户在飞书群或私聊里发消息
- 飞书把事件推给后端
- 后端读取会话、调用老D、智谱参谋等 Agent
- 后端用飞书消息 API 回发结果

完整闭环必须有后端，原因是飞书事件订阅、签名校验、Access Token、机器人消息 API、API Key 管理、日志和权限都不能放在纯静态网页里。

### 最小可行版本

1. 保留当前 GitHub Pages 前端。
2. 增加一个轻量后端代理：`/api/chat`、`/api/push-feishu`。
3. 前端只保存用户配置和会话，不直接保存生产 API Key。
4. 后端统一管理模型 Key、飞书 Webhook 或应用凭证。
5. 先做“导出 Markdown / 推送飞书群”，再做飞书内对话机器人。

## 产品化缺口

优先级从高到低：

1. 后端代理：避免浏览器暴露 API Key，支持统一鉴权和限流。
2. 流式输出：降低等待感，WORKLOG 可逐步刷新。
3. Agent 模板库：产品、技术、发行、内容、自媒体、Codex Handoff 等模板。
4. 导出链路：Markdown、飞书文档、GitHub Issue、Codex Prompt。
5. 飞书机器人：从“网页推送群”升级成“飞书里直接发起任务”。
6. 会话同步：多设备使用需要账号体系和服务端存储。

## 安全边界

浏览器端无法达到服务端密钥管理的安全等级。API Key 不写入仓库或对话记录，但网页运行时可以在当前设备中解密它。正式产品应改用自己的后端代理、用户鉴权、限流和日志审计。
