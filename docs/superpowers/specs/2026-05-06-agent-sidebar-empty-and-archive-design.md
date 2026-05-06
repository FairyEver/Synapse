# Agent 侧边栏：空状态引导 + 已归档分组

## 背景

Agent 模块的对话基于项目组织，侧边栏按项目分组显示对话列表。当前存在两个体验缺陷：

1. 用户未配置项目时，侧边栏完全空白，无任何引导
2. 用户在设置中删除项目后，该项目下的对话变成孤儿数据，无法访问

## 改动范围

三个独立改进点：

1. 空项目状态引导
2. 删除项目时的提示
3. "已归档"分组（收纳孤儿对话）

---

## 一、空项目状态引导

### 触发条件

`projects.length === 0` 且无已归档对话。

### UI

使用 app 已有的 `Empty` 组件（`@/components/ui/empty`）：

- `EmptyMedia`：`FolderOpen` 图标，`variant="icon"`
- `EmptyTitle`："尚未配置项目"
- `EmptyDescription`："添加项目后即可开始 Agent 对话"
- `EmptyContent`：`<Button variant="outline" size="sm">` "前往设置"

### 行为

点击"前往设置"跳转到设置页的项目配置区域（复用现有路由跳转逻辑）。

### 边界情况

- 如果没有项目但存在已归档对话：不显示空状态，只显示已归档分组
- Composer 保持 disabled（现有逻辑 `disabled={!chat.activeProjectId}` 已覆盖）

---

## 二、删除项目时的提示

### 触发位置

`desktop/src/modules/settings/components/project-list-editor.tsx` 的删除按钮。

### 流程

1. 用户点击删除按钮
2. 调用 `bridge.agent.listSessions(project.id)` 获取该项目下的对话数量
3. 如果 count > 0：弹出 AlertDialog
4. 如果 count === 0：直接执行删除（保持现有行为）

### AlertDialog 内容

- 标题："删除项目"
- 描述："「{projectName}」下有 {count} 条 Agent 对话，删除项目后这些对话将移入「已归档」分组，不会被删除。"
- 取消按钮："取消"
- 确认按钮："删除项目"（destructive variant）

### 实现细节

- `listSessions` 已有 IPC 通道，无需新增接口
- AlertDialog 使用 shadcn AlertDialog 组件，与 app 其他确认弹窗风格一致

---

## 三、"已归档"分组

### 数据获取

新增 IPC 方法：

```typescript
// bridge 类型
'synapse:agent:list-all-sessions': () => Promise<SynapseAgentSessionSummary[]>
```

`use-agent-chat.ts` 的 session 加载逻辑改为：

1. 按现有逻辑加载各项目的 sessions
2. 额外调用 `listAllSessions()` 获取全量 sessions
3. 过滤出 `projectId` 不在当前 `projectIds` 中的 sessions，作为已归档对话

### 侧边栏渲染

位置：项目列表最底部，与正常项目组之间无分隔线。

```tsx
{archivedSessions.length > 0 && (
  <ArchivedGroup
    sessions={archivedSessions}
    onSelectSession={onSelectSession}
    onDeleteSession={onDeleteSession}
    onRenameSession={onRenameSession}
    selectedSessionId={selectedSessionId}
  />
)}
```

### ArchivedGroup 组件

复用 `ProjectGroup` 的结构，差异点：

| 属性 | ProjectGroup | ArchivedGroup |
|------|-------------|---------------|
| 图标 | `FolderOpen` | `Archive` |
| 标题 | 项目名称 | "已归档" |
| 默认展开 | `defaultOpen={true}` | `defaultOpen={false}` |
| 新建按钮 | 有（AgentPickerPopover） | 无 |
| 对话交互 | 全部 | 可点击、可删除、可重命名，不可新建 |

### 继续对话

点击已归档对话时：

1. 调用 `bridge.agent.switchSession(sessionKey)` — 后端根据 session 记录的 projectId 创建临时 runtime
2. 正常加载 timeline、发送消息
3. 后端 `AgentRuntimeService` 需支持为非当前配置中的 projectId 创建 runtime 实例（使用 session 中存储的路径信息）

### 边界情况

- 已归档对话的项目路径已不存在（目录被删）：对话可查看历史，发送新消息时报错提示"项目目录不存在"
- 用户重新添加了同 id 的项目：对话自动回归到正常项目分组（因为 projectId 重新匹配）

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | 空状态 + 已归档分组渲染 |
| `desktop/src/modules/agent/components/archived-group.tsx` | 新建：已归档分组组件 |
| `desktop/src/modules/agent/hooks/use-agent-chat.ts` | 加载孤儿 sessions 逻辑 |
| `desktop/src/modules/settings/components/project-list-editor.tsx` | 删除前查询对话数 + AlertDialog |
| `desktop/electron/modules/agent/ipc.ts` | 新增 `list-all-sessions` handler |
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | 支持孤儿 session 的 runtime 创建 |
| `desktop/src/types/bridge.ts` | 新增 bridge 类型 |
| `desktop/electron/preload.ts` | 暴露新 IPC 方法 |
