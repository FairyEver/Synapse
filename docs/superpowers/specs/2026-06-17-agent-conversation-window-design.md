# Agent 对话独立窗口设计

## 背景

Agent 对话页当前由 `desktop/src/modules/agent/index.tsx` 同时承担侧栏、会话选择、红框内对话工作区和发送/权限/导出等操作。用户希望在导出按钮右侧增加“新窗口打开”入口：点击后打开一个固定当前会话的新窗口，用于同时操作多个对话。

已打开到新窗口的会话在主界面再次被选中时，右侧区域不再渲染具体对话内容，只显示“已经在新窗口打开”和“显示窗口”按钮。关闭新窗口后，主界面恢复显示该会话内容。

## 目标

- 将截图红框内区域抽成可复用的 `AgentConversationWorkspace`，主界面和新窗口共用同一个组件。
- 新窗口只承载当前对话工作区，不带左侧会话列表。
- 一条会话同一时间最多有一个独立窗口；重复打开时聚焦已有窗口。
- 主窗口对被独立窗口接管的会话显示占位提示，避免同一会话在两个窗口同时编辑。
- 主窗口删除某条会话成功后，若该会话已有独立窗口，必须自动关闭对应窗口并清理接管状态。
- 保留现有 Agent 运行链路：timeline、权限、发送、取消、导出、引用打开继续使用现有 IPC 和事件。

## 非目标

- 不重做 Agent 左侧会话列表、分组、筛选、创建、删除或重命名交互。
- 不新增多标签窗口、窗口内切换会话或窗口内侧栏。
- 不通过新 IPC 同步 timeline 内容；对话内容仍由现有 `agent.onEvent`、`getTimeline`、`send` 等链路驱动。
- 不改变普通 Agent、Knowledge Base Agent、Scheduler/Workflow 会话的运行语义。

## 现有代码依据

- `AgentModule` 已经在 `desktop/src/modules/agent/index.tsx` 中组合了标题栏、`AgentTimeline`、`AgentComposer`、复制、导出、权限定位、知识库资料管理和待发送队列。
- `AgentTimeline` 和 `AgentComposer` 已是清晰的底层展示/输入组件，适合作为 `AgentConversationWorkspace` 内部零件。
- `useAgentChat` / `useChatConnection` 已提供会话列表、timeline、发送、权限、取消和事件同步能力。
- 内容窗口、系统应用窗口和用量分析对话窗口已经使用 `synapseWindow` 或 `window` 查询参数加载独立 renderer 页面，可复用同类窗口服务模式。

## 核心组件

新增 `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`。

`AgentConversationWorkspace` 负责红框内全部工作区：

- 顶栏：会话标题、模型文本、实时上下文占用、待回答/权限按钮、资料管理、复制、导出、新窗口入口。
- 内容：错误提示、空状态、`AgentTimeline`。
- 输入：`AgentComposer`、权限模式切换、取消/强制停止、快捷片段、知识库动作。
- 局部 UI 状态：draft、待发送队列、滚动 pin、导出 loading、idle rollover timer。

它不负责：

- 左侧会话列表。
- 会话分组、筛选、创建列表入口、删除、重命名。
- 独立窗口生命周期管理。

设计类型：

```ts
type AgentConversationTarget = {
  projectId: string
  conversationId: string
  sessionKey: string
}

type AgentConversationWorkspaceProps = {
  session: SynapseAgentSessionSummary
  project?: SynapseProjectConfig
  target: AgentConversationTarget
  chat: AgentConversationWorkspaceController
  quickInputs: readonly SynapseQuickInput[]
  commands: readonly SynapseAgentPublishedCommand[]
  providers: SynapseAgentProviderState | null
  currentConversationModel?: string
  displayProfile: SynapseAgentDisplayProfile
  agentIcon?: string
  mode: "embedded" | "window"
  onOpenDetached?: (target: AgentConversationTarget) => void
}

type AgentConversationWorkspaceController = {
  timeline: readonly SynapseAgentTimelineItem[]
  pendingPermissions: readonly SynapseAgentPendingPermission[]
  sending: boolean
  sendingConversationIds: ReadonlySet<string>
  cancelPhase: "idle" | "cancel_pending" | "cancelled"
  error: string | null
  sendMessage(
    content: string,
    target: AgentConversationTarget,
    options?: SendMessageOptions,
  ): Promise<boolean>
  createSession(
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
  ): Promise<void>
  setPermissionMode(
    mode: SynapseAgentPermissionMode,
    target?: AgentConversationTarget,
  ): Promise<void>
  respondPermission(
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ): Promise<void>
  cancelTurn(target?: AgentConversationTarget): Promise<void>
  forceKillTurn(target?: AgentConversationTarget): Promise<void>
  refresh(): Promise<void>
}
```

`target` 必须由 `session.projectId + session.id + session.sessionKey` 派生。发送、复制、导出、取消和权限模式切换都使用显式 target，避免工作区依赖“当前页面选中态”。

## 主界面集成

`AgentModule` 保留侧栏和当前选择状态。选中会话后：

- 若当前会话未被独立窗口接管，渲染 `AgentConversationWorkspace mode="embedded"`。
- 若当前会话已被独立窗口接管，渲染一个居中占位：标题“已经在新窗口打开”和按钮“显示窗口”。
- 点击“显示窗口”调用 `agent.focusConversationWindow(target)`。
- `AgentConversationWorkspace mode="embedded"` 的顶栏在导出按钮右侧显示新窗口按钮。

占位文案保持克制，不添加解释段落。

## 新窗口页面

新增 `AgentConversationWindowPage`，通过 URL 固定目标：

```txt
?synapseWindow=agent-conversation
&projectId=...
&conversationId=...
&sessionKey=...
```

页面行为：

- 解析 URL，缺少任一必要字段则显示错误状态。
- 使用目标项目范围加载 `useAgentChat`。
- 自动选择并锁定 URL 指向的 session。
- 渲染 `AgentConversationWorkspace mode="window"`。
- 不显示左侧会话列表，不提供切换会话入口。
- `mode="window"` 下不显示新窗口按钮。

## 窗口服务与接管状态

新增主进程 `agent-conversation-window-service`，以 `projectId:conversationId` 为 key 管理窗口。

暴露 IPC：

```ts
agent.openConversationWindow(target): Promise<{ opened: true }>
agent.focusConversationWindow(target): Promise<{ focused: boolean }>
agent.listDetachedConversationWindows(): Promise<AgentDetachedConversation[]>
agent.onDetachedConversationWindowsChanged(listener): () => void
```

主进程窗口服务另提供内部方法 `closeConversationWindow(target): { closed: boolean }`，供删除会话 IPC 成功后关闭对应独立窗口；该方法不暴露给 renderer 直接调用。

接管状态：

```ts
type AgentDetachedConversation = {
  projectId: string
  conversationId: string
  sessionKey: string
  title: string
  windowId: number
  openedAt: string
}
```

规则：

- 打开同一会话时，若窗口存在且未销毁，只聚焦已有窗口。
- 新窗口 ready 后加入接管列表并广播。
- 窗口关闭时从接管列表移除并广播。
- 会话删除成功后，主进程按 `projectId + conversationId` 主动关闭对应独立窗口，并立即从接管列表移除。
- 主窗口订阅接管列表变化，用于决定渲染工作区还是占位。

## 数据流

打开新窗口：

1. 主窗口 `AgentConversationWorkspace` 点击新窗口按钮。
2. 调用 `agent.openConversationWindow(target)`。
3. 主进程创建或聚焦独立窗口。
4. 主进程广播接管列表。
5. 主窗口选中该会话时切换为占位。

新窗口运行：

1. `AgentConversationWindowPage` 加载目标会话。
2. `AgentConversationWorkspace` 使用显式 target 发送消息和执行操作。
3. timeline 和权限更新继续通过现有 Agent domain event 刷新。

关闭新窗口：

1. 主进程删除接管记录。
2. 广播接管列表。
3. 主窗口恢复渲染 `AgentConversationWorkspace`。

删除已在新窗口打开的会话：

1. 主窗口删除会话。
2. Agent runtime 删除会话数据并关闭该会话运行状态。
3. 主进程关闭同一 `projectId + conversationId` 的独立窗口。
4. 主进程广播接管列表。

## 错误处理

- 打开窗口失败：主界面 toast “打开失败”，结构化日志记录 projectId、conversationId、sessionKey，不记录消息正文。
- 目标会话不存在：新窗口显示“对话不存在或已删除”；如果目标会话是从主窗口删除成功而消失，窗口应由主进程主动关闭，不停留在该错误态。
- 聚焦窗口失败或不存在：主窗口可以重新调用打开窗口；若仍失败显示“打开失败”。
- 发送、权限、取消、导出错误沿用现有错误处理和脱敏规则。

## UI 约束

- 使用现有 shadcn/Radix 组件和 Tailwind token。
- 新窗口按钮使用 lucide 图标按钮和 Tooltip，放在导出按钮右侧。
- 不写自定义颜色、内联样式或营销式说明。
- 主窗口占位只保留必要标题和操作按钮。

## 测试计划

- `AgentConversationWorkspace`：
  - 渲染标题、模型、复制、导出、新窗口按钮、timeline 和 composer。
  - `mode="window"` 不显示新窗口按钮。
  - 发送消息调用 `sendMessage(content, target)`。
  - 取消和强制停止调用带 target 的 controller 方法。

- 主窗口接管占位：
  - selected session 在 detached 列表中时不渲染 workspace。
  - 点击“显示窗口”调用 focus IPC。
  - detached 列表移除后恢复 workspace。

- URL parser：
  - `agent-conversation` 参数 round trip。
  - 缺少 `projectId`、`conversationId` 或 `sessionKey` 时返回 null。

- Electron 窗口服务：
  - 同一会话重复打开只聚焦。
  - 关闭窗口后广播状态。
  - `focusConversationWindow` 聚焦已有窗口。
  - `closeConversationWindow` 关闭目标窗口并广播状态。
  - 删除会话 IPC 成功后调用 `closeConversationWindow`；删除失败或返回 false 时不关闭窗口。

- `useChatConnection`：
  - `setPermissionMode(mode, target)` 使用目标会话。
  - `cancelTurn(target)` 和 `forceKillTurn(target)` 使用目标会话。
  - 旧调用不传 target 时保持当前主窗口行为。

## 发布说明

实现完成后需要更新 `RELEASE_NOTES_PENDING.md`，说明 Agent 对话支持独立窗口操作，主界面会提示已在新窗口打开并可一键显示窗口。
