# Team Agent Marco

一个可直接通过 GitHub Pages 使用的多模型 HTML 聊天工作台。

## 当前网页版本

- Marco Lab 黑白工作台 UI
- 输入框默认更高，支持长 prompt，且可手动拖拽调整
- DeepSeek 默认担任总控，默认 Agent 名称为“老D”
- 支持 DeepSeek、智谱 GLM、OpenAI、Google Gemini
- 支持任意 OpenAI `chat/completions` 兼容接口
- 右侧 WORKLOG 显示 Agent 发言、失败、整合过程
- Agent 定制页只显示已接入 API 的模型
- 每个 Agent 支持自定义头像、名字、定位、性格和系统提示词
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

部署由 `.github/workflows/pages.yml` 自动完成。

## 安全边界

浏览器端无法达到服务端密钥管理的安全等级。API Key 不写入仓库或对话记录，但网页运行时可以在当前设备中解密它。正式产品应改用自己的后端代理、用户鉴权和日志审计。
