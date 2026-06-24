# Agent

<!-- Sources: desktop/src/modules/agent/index.tsx; desktop/src/modules/agent/hooks/use-agent-chat.ts; desktop/src/modules/agent/components/agent-session-sidebar.tsx; desktop/src/modules/agent/components/agent-permission-panel.tsx; desktop/src/modules/agent/components/agent-timeline.tsx; desktop/src/modules/agent/live-sync.ts; desktop/src/modules/agent/project-resolution.ts; desktop/electron/modules/agent/ipc.ts -->

## 功能范围

Agent 是本地运行时入口，适用于已配置 CLI、provider、模型和项目的会话。会话必须绑定 `agentType`，运行时状态按 conversation 隔离。

页面可管理本地 Agent 会话、查看运行 timeline、发送输入、复制 transcript，并查看当前 Agent 的 CLI 标签、provider 和模型。timeline 支持 message、thinking、tool call、tool result、permission request、error 和 result 等记录。

Agent 请求权限时，页面显示工具名称和输入摘要，并提供允许或拒绝操作。会话侧栏显示会话更新时间和未读数。

## 使用方式

进入 Agent 页面后，在底部输入框输入消息。按 Enter 发送，Shift + Enter 换行；输入框为空或当前无可用项目时不可发送。

选择侧栏的新建按钮创建会话，选择会话项切换会话，选择刷新可重新读取会话、权限、provider 和命令列表。删除会话前将显示确认框；确认后删除会话记录。

slash menu 和命令菜单只负责插入命令文本，例如 `/<name>`。是否发送由用户在 composer 中确认。

选择复制后，页面读取当前会话 timeline 并复制格式化后的 transcript。仅存在可用项目且当前 timeline 不为空时，复制按钮可用。

## Knowledge Base

Knowledge Base 会话会解析到托管 backing directory，并加载知识库 runtime。普通项目不会加载 Knowledge Base plugin、skill、hook、prompt 或快捷动作。

Native slash passthrough 只记录命令名，不记录参数正文、路径列表或其他用户输入内容。

## 注意事项

Agent 发送、会话读取、权限响应和命令列表均依赖 Electron bridge 暴露的 `agent` 能力。运行状态页检查 CLI 是否安装、provider 是否配置、是否选择模型，并将缺失项标记为 `cli-not-installed`、`provider-not-configured` 或 `model-not-selected`。

打开本地引用时，系统先解析路径。路径必须位于项目工作区内，并通过读取权限检查；权限被拒绝时不会打开该路径。
