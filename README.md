# Team Agent Marco

一个由 **GPT-5.5 固定担任总控**的 Windows 桌面聊天助手。

## 当前形态

主界面是普通聊天框。用户不需要创建会议、选择议题模板或观看圆桌流程，直接输入任何内容即可继续对话。

- GPT-5.5：固定负责理解上下文和生成最终回答
- Gemini：可选后台顾问，偏资料、多模态和技术分析
- DeepSeek：可选后台顾问，偏中文产品、逻辑审查和反方分析
- 辅助模型的输出只作为 GPT-5.5 的内部参考，不直接显示为多人会议

## 模型设置

设置页只有一个 API Key 输入框：

1. 粘贴 Key
2. 点击“识别并保存”
3. 程序通过模型列表接口自动识别 OpenAI、Google Gemini 或 DeepSeek
4. Key 使用 Electron `safeStorage` 在本机加密保存

OpenAI 与 DeepSeek 的 Key 都可能以 `sk-` 开头，因此程序不会只靠前缀猜测，而是进行无 Token 消耗的连接探测。

## GPT-5.5

真实聊天必须配置 OpenAI API Key。代码层会把最终回答模型固定为：

```text
gpt-5.5
```

OpenAI 模型栏在界面中不可修改。Gemini 和 DeepSeek 可以不配置，也可以在已连接列表中调整模型名称。

## ChatGPT 订阅额度

ChatGPT Plus/Pro 与 OpenAI API 独立计费。独立桌面程序无法直接使用当前 ChatGPT 对话的订阅额度，因此 GPT-5.5 总控需要 OpenAI API Key。

## 本地记录

每段对话保存为独立 JSON 文件，默认目录：

```text
文档/Team Agent Marco/conversations
```

侧边栏会显示最近对话，可以继续此前上下文。

## 开发与测试

```powershell
npm install
npm run check
npm run desktop
```

Windows 便携版：

```powershell
npm run package:win
```

## 安全设置

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Renderer 不能读取明文 Key
- Key 不写入源码、GitHub 或对话记录
- OpenAI、Gemini、DeepSeek 请求均由 Electron 主进程发起
