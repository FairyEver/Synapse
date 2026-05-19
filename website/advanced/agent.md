# Agent（智能体）

<!-- Sources: desktop/src/modules/agent/index.tsx; desktop/src/modules/agent/hooks/use-agent-chat.ts; desktop/src/modules/agent/components/agent-session-sidebar.tsx; desktop/src/modules/agent/components/agent-permission-panel.tsx; desktop/src/modules/agent/components/agent-timeline.tsx; desktop/src/modules/agent/live-sync.ts; desktop/src/modules/agent/project-resolution.ts; desktop/electron/modules/agent/ipc.ts -->

## 功能范围

Agent 是高级本地运行时入口，适用于已配置 CLI、provider 和项目范围的工作流；常规内容管理流程仍以 Rule / Skill 的维护、安装和分享为主。页面根据当前激活仓库和全局项目配置选择可用项目；若当前仓库路径匹配某个项目路径，则优先使用该项目。

用户可在同一页面中管理本地 Agent 会话、查看运行时间线、向已配置的运行时发送输入、使用命令面板、复制当前会话 transcript，并查看当前 Agent 的 CLI 标签、活跃 provider 和模型。时间线支持消息、thinking、tool call、tool result、permission request、error 和 result 等记录。

Agent 请求权限时，页面显示工具名称和输入内容，并提供允许或拒绝操作。会话侧栏显示会话更新时间和未读数。

## 使用方式

进入 Agent 页面后，在底部输入框输入消息。按 Enter 发送，Shift + Enter 换行；输入框为空或当前无可用项目时不可发送。

选择侧栏的新建按钮创建会话，选择会话项切换会话，选择刷新可重新读取会话、权限、provider 和命令列表。删除会话前将显示确认框；确认后删除会话记录。

选择“命令”打开命令面板，可搜索并发送已发布命令。选择命令后，页面将 `/<命令名>` 作为消息发送给 Agent。

选择“复制”后，页面读取当前会话时间线并复制格式化后的 transcript。仅存在可用项目且当前时间线不为空时，复制按钮可用。

## 注意事项

Agent 发送、会话读取、权限响应和命令列表均依赖 Electron bridge 暴露的 `agent` 能力。运行状态页检查 CLI 是否安装、provider 是否配置、是否选择模型，并将缺失项标记为 `cli-not-installed`、`provider-not-configured` 或 `model-not-selected`。

打开本地引用时，系统先解析路径。路径必须位于项目工作区内，并通过读取权限检查；权限被拒绝时不会打开该路径。
