# Team Agent Marco

一个可直接通过 GitHub Pages 使用的多模型 HTML 聊天助手。

## 当前网页版本

- 白色、黑灰文字的极简聊天界面
- DeepSeek 默认担任总控并生成最终回答
- 支持 DeepSeek、智谱 GLM、OpenAI、Google Gemini
- 支持任意 OpenAI `chat/completions` 兼容接口
- 一个通用 API Key 输入框，支持自动识别或手动指定平台
- 其他已连接模型可以在后台为总控提供参考
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

浏览器端无法达到服务端密钥管理的安全等级。API Key 不写入仓库或对话记录，但网页运行时可以在当前设备中解密它。正式产品应改用自己的后端代理和用户鉴权。
