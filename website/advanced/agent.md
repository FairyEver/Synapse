# Agent

<!-- Sources: desktop/src/modules/agent/index.tsx; desktop/src/modules/agent/hooks/use-agent-chat.ts; desktop/src/modules/agent/components/agent-session-sidebar.tsx; desktop/src/modules/agent/components/agent-permission-panel.tsx; desktop/src/modules/agent/components/agent-timeline.tsx; desktop/src/modules/agent/live-sync.ts; desktop/src/modules/agent/project-resolution.ts; desktop/electron/modules/agent/ipc.ts -->

## 能做什么

Agent 页面提供按项目范围运行的对话入口。页面会根据当前激活的仓库和全局项目配置选择可用项目；如果当前仓库路径匹配某个项目路径，会优先使用该项目。

你可以在同一页面中管理会话、查看对话时间线、发送消息、使用命令面板、复制当前会话 transcript，并查看当前 Agent 的 CLI 标签、活跃 provider 和模型。时间线支持消息、thinking、tool call、tool result、permission request、error 和 result 等记录。

当 Agent 请求权限时，页面会显示工具名称和输入内容，并提供允许或拒绝操作。会话侧栏会显示会话更新时间和未读数。

## 怎么使用

进入 Agent 页面后，在底部输入框输入消息。按 Enter 发送，Shift + Enter 换行；输入框为空或当前没有可用项目时不能发送。

点击侧栏的新建按钮创建会话，点击会话项切换会话，点击刷新重新读取会话、权限、provider 和命令列表。删除会话前会弹出确认框；确认后会话记录会被删除。

点击“命令”打开命令面板，可以搜索并发送已发布命令。选择命令后，页面会把 `/<命令名>` 作为消息发送给 Agent。

点击“复制”会读取当前会话时间线并复制格式化后的 transcript。只有存在可用项目且当前时间线不为空时，复制按钮才可用。

## 注意事项

Agent 发送、会话读取、权限响应和命令列表都依赖 Electron bridge 暴露的 `agent` 能力。运行状态页会检查 CLI 是否安装、provider 是否配置、是否选择模型，并把缺失项标记为 `cli-not-installed`、`provider-not-configured` 或 `model-not-selected`。

“跟随飞书”打开后，只有当输入框没有未发送内容，并且收到的平台是 `feishu` 的其他会话更新时，页面才会自动跟随该会话；否则只会增加对应会话的未读数。

打开本地引用会先解析路径，路径必须位于项目工作区内，并且会经过读取权限检查。权限被拒绝时不会打开该路径。
