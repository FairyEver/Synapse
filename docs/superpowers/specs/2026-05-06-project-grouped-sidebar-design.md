# Agent 侧边栏项目分组改造

## 概述

将 Agent 模块的会话侧边栏从扁平列表改为以项目为主导的可折叠分组结构。每个项目是一个可折叠的分组，项目行内提供新建按钮，点击后弹出 Popover 让用户选择 Agent 类型来创建对话。

## 组件结构

### AgentSessionSidebar（改造）

文件：`desktop/src/modules/agent/components/agent-session-sidebar.tsx`

- 顶部工具栏：标题"项目" + 刷新按钮 + 跟随飞书开关
- 内容区：按 `projectId` 分组渲染 `ProjectGroup`
- 分组逻辑：sessions 按 projectId 聚合，项目名从 props 传入的 projects 列表获取
- 无会话的项目也显示（空分组，方便用户新建）

Props 变更：
- 新增 `projects: ProjectOption[]`（项目列表，用于渲染分组头部和确定顺序）
- 新增 `availableAgents: SynapseAgentAvailability[]`（可用 Agent 列表）
- 移除 `onCreate`（不再需要全局新建按钮）
- 新增 `onCreateSession: (projectId: string, agentType: string) => void`

### ProjectGroup（新建）

文件：`desktop/src/modules/agent/components/project-group.tsx`

基于 `Collapsible` 组件封装：
- Header：`CollapsibleTrigger` 包含文件夹图标 + 项目名 + 新建按钮
- Content：`CollapsibleContent` 包含该项目下的对话列表
- 默认展开（`defaultOpen={true}`）
- 新建按钮点击弹出 `AgentPickerPopover`

Props：
```typescript
type ProjectGroupProps = {
  project: ProjectOption
  sessions: SynapseAgentSessionSummary[]
  availableAgents: SynapseAgentAvailability[]
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  onCreateSession: (agentType: string) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
}
```

### AgentPickerPopover（新建）

文件：`desktop/src/modules/agent/components/agent-picker-popover.tsx`

- 触发器：`+` 图标按钮（作为 children 传入或内置）
- 内容：Popover 内显示可用 Agent 列表
- 每项：Agent 图标 + Agent 名称
- 点击某项 → 调用 `onSelect(agentType)` → 关闭 Popover

Props：
```typescript
type AgentPickerPopoverProps = {
  agents: SynapseAgentAvailability[]
  onSelect: (agentType: string) => void
  children: ReactNode // trigger
}
```

## 数据流

1. `AgentModule` 持有 `config.global.projects`（项目列表）和 `availableAgents`
2. `AgentModule` 将 projects 和 availableAgents 传给 `AgentSessionSidebar`
3. `AgentSessionSidebar` 按 projectId 分组 sessions，为每个项目渲染 `ProjectGroup`
4. `ProjectGroup` 内的新建按钮触发 `AgentPickerPopover`
5. 用户选择 Agent 后，调用 `onCreateSession(projectId, agentType)` 回到 `AgentModule`
6. `AgentModule` 调用 `chat.createSession(projectId, agentType)`

## 对话条目渲染

复用 `ModuleSidebarItem`：
- 左侧：Agent 图标（小尺寸）+ 对话名称（truncate）
- 右侧 trailing：未读 badge + 相对时间 + 删除按钮
- 选中态：`active` prop

## 折叠行为

- 所有项目默认展开
- 用户可手动折叠/展开
- 折叠状态为组件 local state，不持久化

## 删除内容

- `CreateSessionDialog` 组件不再使用（从 AgentModule 中移除引用）
- 侧边栏顶部全局 `+` 新建按钮移除

## 不变内容

- `useAgentChat` hook 接口不变
- 对话选中、删除、未读计数逻辑不变
- 右侧内容区（Timeline + Composer + PermissionPanel）不动
- `SynapseAgentSessionSummary` 类型不变

## availableAgents 加载时机

改为 `AgentModule` 初始化时加载一次（而非打开 Dialog 时加载），因为 Popover 需要即时显示。在 `AgentModule` 的 useEffect 中调用 `bridge.agent.getAvailableAgents()`。

## 排序

- 项目顺序：按 `config.global.projects` 数组顺序
- 对话顺序：按 `updatedAt` 降序（最近活跃的在上面），保持现有排序逻辑
