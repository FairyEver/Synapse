# Claude Agent SDK 使用规则

涉及 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk` / `claude_agent_sdk`）的开发时，必须先查阅本地文档再编码。

## 文档路径

`docs/claude/sdk/` 下包含完整的 SDK 文档（29 篇），覆盖：

- API 参考：`typescript.md`、`python.md`
- 核心概念：`agent-loop.md`、`sessions.md`、`streaming-vs-single-mode.md`
- 工具扩展：`custom-tools.md`、`mcp.md`、`subagents.md`、`tool-search.md`
- 权限与控制：`permissions.md`、`hooks.md`、`file-checkpointing.md`
- 输入输出：`user-input.md`、`streaming-output.md`、`structured-outputs.md`
- 部署：`hosting.md`、`secure-deployment.md`

## 规则

1. 使用 SDK API 前，先 Read 对应文档确认函数签名、参数和返回值
2. 不凭记忆猜测 API——SDK 更新频繁，文档是唯一可信来源
3. 涉及 options/config 字段时，查阅 `typescript.md` 或 `python.md` 中的类型定义
4. 遇到不确定的行为（权限模式、hook 时机、流式消息类型），查阅对应专题文档
