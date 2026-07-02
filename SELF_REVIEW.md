# Self-review · v0.4.0

## 用户需求落实

1. API 设置改为单一通用输入框，自动识别 OpenAI、Gemini、DeepSeek。
2. GPT-5.5 固定为唯一总控和最终回答模型。
3. 主界面改为普通聊天框，移除圆桌会议式交互。
4. Gemini、DeepSeek 只在后台提供可选内部意见。
5. 对话自动保存，支持从侧边栏继续历史对话。

## 技术检查

- TypeScript strict：通过
- 自动测试：32 项通过，0 项失败
- API 自动识别：覆盖 OpenAI、Gemini、无效 Key
- GPT-5.5 强制路由：覆盖测试
- 普通聊天持久化：覆盖测试
- 辅助模型内部咨询：覆盖测试
- UI 冒烟：确认只有单一 Key 输入框，且不存在会议页面
- Preload 安全桥接：通过

## 重要边界

- 独立桌面程序无法直接消耗 ChatGPT Plus/Pro 的当前对话额度。
- 真实 GPT-5.5 回复需要 OpenAI API Key，并按 API Token 单独计费。
- Key 自动识别需要联网调用各平台的模型列表接口，但不会产生文本生成 Token。
- 当前回复为整段返回，尚未加入逐字流式显示。
