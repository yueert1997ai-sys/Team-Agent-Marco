# Team Agent Marco

Marco Lab 是一个通过 GitHub Pages 运行的多模型 Agent 工作台原型。

## 当前网页能力

- 支持 DeepSeek、智谱 GLM、OpenAI、Google Gemini 和 OpenAI 兼容接口
- DeepSeek 默认 Agent 为“老D”，智谱默认 Agent 为“智谱参谋”
- 三种运行模式：快速、参谋、深度碰撞
- 深度碰撞支持两轮：独立初判 → 阅读自己与对方观点后修正 → 总控整合
- 每次任务限制参与 Agent 数，并在设置中显示预计调用次数
- WORKLOG 按会话保存，重新打开对话仍可查看
- 显示每一步耗时和 Token，用于判断速度与成本
- 支持停止生成，模型请求会通过 AbortController 取消
- 用户消息发送后立即保存，失败或刷新时不容易丢失
- 切换对话不会把旧任务结果追加到新对话
- Agent 可自定义头像、名字、定位、性格、提示词和是否参与多 Agent 任务
- 可导出完整聊天记录和 WORKLOG 为 Markdown

## API Key 安全边界

- 自动识别只用于特征明确的 Gemini / OpenAI Key
- DeepSeek、智谱及其他平台需要手动选择，避免一个 Key 被轮流发送到多个平台
- 自定义 Base URL 必须使用 HTTPS，本机 localhost 调试除外
- Key 可以保存在当前设备，但网页运行时仍可解密读取
- 正式产品需要后端代理、用户鉴权、限流和服务端密钥管理

## 网页测试

```powershell
node --test tests/web-html.test.mjs
node --check web/app.js
node --check web/providers.js
node --check web/storage.js
node --check web/orchestrator.js
node --check web/sw.js
```

## 部署

`.github/workflows/pages.yml` 只监听 `main`，先运行网页测试，测试通过后再发布 GitHub Pages。
