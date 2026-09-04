# Agent 文件检查点、撤销与工作区辅助面板设计

日期：2026-08-26
状态：已实施，自动化验证通过；真实 Provider 冒烟待发布验收

实施兼容说明：SDK 0.3.245 禁止 `enableFileCheckpointing` 与 `sessionStore` 同时使用。Synapse 不再为 AI title 安装 transcript sessionStore，新会话标题由既有首条用户消息回退生成，以保证首轮文件检查点可用。

## 1. 决策摘要

本设计同时交付两个边界清晰的能力：

1. `Workspace Auxiliary Panel`，工作区辅助面板。它是可复用布局基础设施，位于 Agent 工作区内部，不属于单条消息，也不提升到全局应用壳。
2. `Agent File Checkpoint`，Agent 文件检查点。它按用户轮次记录 SDK 可恢复的文件变化，在最终回复之后显示摘要，点击文件后在辅助面板中审查历史 Diff。

关键决策如下：

- 保留现有左侧会话导航和 `SidebarContentLayout`，在 `AgentConversationWorkspace` 内部增加第二层横向布局。
- 宽屏显示“会话 + 辅助面板”，窄屏打开辅助面板时进入独立详情视图，不继续压缩会话和 composer。
- 文件 Diff 是辅助面板的首个注册项，工作区壳不写 `if (fileDiff)` 之类的专用分支。
- Claude Agent SDK 的 `rewindFiles` 负责真实恢复，Synapse 的 sidecar 负责 Diff、路径身份、文件指纹、并发校验和产品状态。
- V1 的“撤销”只允许最后一个尚未被后续用户轮次取代的检查点。旧检查点仍可审查，但不提供伪装成单轮撤销的操作。
- 撤销只恢复文件，不删除对话，不回退模型上下文。界面统一使用“撤销文件修改”。
- 当前 Git Diff viewer 已经是仓库自研实现，不再依赖历史上的 `@git-diff-view/react`。实施时把现有 viewer 抽成共享组件，不重新引入该组件。
- V1 适用于本地交互式 Agent 会话。该能力运行在本地 Agent SDK/CLI 层，不以 Anthropic 自家模型为门槛，DeepSeek 官方和百炼 Anthropic 兼容 Provider 使用同一路径。

## 2. 背景与问题

用户当前只能从工具调用和最终回复中推断 Agent 改过哪些文件，缺少三个连续动作：

1. 一轮完成后看见明确的文件变化摘要。
2. 点击某个文件，在不离开对话的情况下审查该轮 Diff。
3. 在文件没有被再次修改时，安全撤销该轮受支持的文件修改。

参考产品将审查区放在会话右侧。Synapse 现有 Agent 页面已经有左侧会话导航和右侧会话内容，旧设计文档又把会话内容称作 `right panel`。本设计统一术语：

- `Session Sidebar`：现有左侧项目和会话导航。
- `Conversation Pane`：现有 Agent 会话、时间线和 composer。
- `Workspace Auxiliary Panel`：新增的工作区辅助面板。
- `Agent File Checkpoint`：某个 Agent 用户轮次开始时的 SDK 文件恢复锚点及其轮末变化投影。

Agent 文件检查点不是 Drive Markdown Checkpoint、Git commit、Git stash 或 Workflow 运行快照。

## 3. 目标与非目标

### 3.1 目标

- 最终回复之后显示“已修改 N 个文件”、总增删行数、文件预览和审核/撤销入口。
- 点击文件后，在同一 Agent 工作区打开该文件的历史 Diff。
- 嵌入式 Agent 页面和独立会话窗口使用同一套面板能力。
- 非 Git 目录也能审查和撤销 SDK 支持的写入。
- 撤销前检测外部编辑、路径替换、链接变化、会话变化和权限变化。
- 会话重开后仍能查看已保存 Diff，并在 SDK 文件历史仍有效时撤销最新检查点。

### 3.2 非目标

- V1 不回退对话历史、模型上下文、工具结果或 token/cost 记录。
- V1 不恢复 Bash、普通 subagent、MCP 或外部进程直接写入的文件。
- V1 不恢复目录创建、目录移动、目录删除、远程文件或网络文件。
- V1 不支持任意旧卡片的“只撤销这一轮”。SDK 对旧锚点执行的是从该锚点开始的累计文件恢复。
- V1 不做可编辑 Diff、行级接受/拒绝、暂存区、提交或代码审查评论。
- V1 不把辅助面板做成全局 App 级 Dock，也不对外暴露 MCP、Workflow、Deep Link 或 System App 能力。

## 4. 现状审计

### 4.1 页面布局

- `AgentModule` 使用 `SidebarContentLayout` 管理左侧会话栏和右侧内容区。
- `AgentConversationWorkspace` 当前是单列 flex，依次包含 header、告警、`AgentTimeline` 和 `AgentComposer`。
- `AgentConversationWindowPage` 直接渲染同一个 `AgentConversationWorkspace`，因此在该组件外的全局布局改造无法自然覆盖独立窗口。
- `SidebarContentLayout` 被多个模块复用，语义是“左导航 + 内容”。把 Agent 第三栏加进它会污染其它调用方，也会把 Agent 面板状态错误提升到全局。

结论：新增布局的最低正确公共祖先是 `AgentConversationWorkspace`，而不是消息组件、`AgentTimeline`、`SidebarContentLayout` 或全局 App shell。

### 4.2 时间线

时间线使用严格判别联合和 exhaustive switch。历史数据来自 `ConversationEntryV1.history`，`agent.events` 主要用于诊断事件。当前显示算法会把一轮的最终 assistant 消息移动到流程事件之后。

文件检查点必须成为显式 `fileCheckpoint` 时间线项，并被定义为 `turn postlude`。显示算法应先输出最终 assistant，再输出检查点卡片。若只把 after-turn 事件追加到数组，它会被折叠进“已处理”流程组或出现在最终回复之前。

`fileCheckpoint` 及其状态更新只更新时间线，不得重新激活已经终止的会话运行状态。

### 4.3 Diff

`desktop/src/modules/git/components/git-diff-viewer.tsx` 当前支持：

- unified / split；
- 自动换行；
- 行号与简单行内变化；
- binary、truncated 和 raw fallback；
- 2 MiB Git Diff 预览上限。

仓库历史曾使用 `@git-diff-view/react@0.1.7`，后续已经移除并换成当前自研 viewer。Agent 不得导入 Git 模块内部组件。

建议抽取为：

```text
desktop/src/components/diff/diff-viewer.tsx
desktop/src/lib/diff/unified-diff.ts
desktop/src/modules/git/components/git-diff-viewer.tsx   # Git 语义包装器
```

Agent 面板消费共享 `DiffViewer`。Git 保留状态标签、模式切换和现有行为。

### 4.4 SDK 0.3.245

安装版本公开：

- `Options.enableFileCheckpointing?: boolean`
- `Query.rewindFiles(userMessageId, { dryRun? })`
- `RewindFilesResult.filesChanged/insertions/deletions/skippedLinks`

Synapse 当前没有启用 `enableFileCheckpointing` 和 `replay-user-messages`，`QueryLike`、`SynapseToolRouterQuery` 和 `AgentLiveSession` 也没有暴露 rewind。

SDK 的 `rewindFiles` 不返回 patch。官方文件检查点只覆盖 Write、Edit、NotebookEdit 等受支持内置工具；Bash 写文件、普通 subagent、目录操作和远程文件不在恢复范围。真实恢复还可能因符号链接、硬链接、非普通文件、父目录解析变化或备份读取失败而跳过文件。

## 5. 工作区辅助面板

### 5.1 分层

```text
App Shell
└── AgentModule
    └── SidebarContentLayout
        ├── Session Sidebar
        └── AgentWorkspaceShell
            ├── WorkspaceAuxiliaryPanelLayout
            │   ├── Conversation Pane
            │   │   └── AgentConversationWorkspace 现有内容
            │   └── Workspace Detail Panel（可选）
            │       └── 注册的面板内容
            └── Workspace Navigation Overlay（可选）
                └── 当前项目文件树
```

建议新增两个层次：

1. `WorkspaceAuxiliaryPanelLayout` 放在共享组件目录，只处理布局、resizer、宽窄模式和面板容器，不知道 Agent、checkpoint 或 Diff。
2. `AgentWorkspaceShell` 放在 Agent 模块，管理面板注册、活动实例、payload、焦点、会话切换和宿主模式。

这样未来其它模块可以复用布局 primitive，但不会共享 Agent 私有状态。

### 5.2 面板注册模型

V1 只允许一个活动详情面板实例。左侧工作区文件树属于独立的覆盖式导航面板，不进入详情面板注册表，可与右侧详情面板同时打开。注册项至少包含：

文件树选择行为与 VS Code Explorer 对齐：普通点击单选，macOS 使用 `Cmd`、Windows/Linux 使用 `Ctrl` 切换单项，`Shift` 选择锚点到目标之间的可见项，`Cmd/Ctrl+A` 选择全部可见项。拖动已选项时携带全部选中项，拖动未选项时只携带该项。

```ts
type AgentWorkspacePanelRegistration<Payload> = {
  id: string
  title: (payload: Payload) => string
  render: (payload: Payload) => ReactNode
  isSameTarget: (left: Payload, right: Payload) => boolean
}
```

首个注册项：

```ts
type FileDiffPanelPayload = {
  projectId: string
  conversationId: string
  checkpointId: string
  fileId: string
}
```

Renderer 不接收绝对路径。消息卡片只发出 `openPanel({ panelId: "agent.file-diff", payload })` 意图。

V1 不显示空的加号、标签栏或插件入口。未来新增第二个真实消费者时，再在注册表之上增加 tab UI。

### 5.3 尺寸与响应式

推荐初始约束：

| 项目 | 建议值 |
|---|---:|
| Conversation Pane 最小宽度 | 560px |
| Navigation Panel 最小/默认/最大宽度 | 220px / 280px / 480px |
| Auxiliary Panel 最小宽度 | 400px |
| Auxiliary Panel 默认宽度 | 480px |
| Auxiliary Panel 最大宽度 | 720px 或容器 55% |
| 宽屏分栏阈值 | 可用宽度约 1040px |

行为：

- 左侧工作区导航始终覆盖在会话之上，不参与会话与右侧详情面板的空间分配；窄窗口中最多占用减去 160px 后的可用宽度，保证会话始终可见。
- 点击左侧工作区导航之外的区域时关闭文件树；文件树内部操作和文件树入口按钮不触发外部关闭。
- 文件树项目拖入对话区域时显示“松开插入路径”反馈；松开后由主进程按当前文件树 scope 解析路径，以空格连接并插入草稿当前光标，不进入附件流程。
- 右侧详情面板沿用 `ResizablePanelGroup`：宽度足够时与会话并排，宽度不足时进入详情模式。
- embedded 和 window 分别持久化像素宽度，使用现有侧栏宽度存储模式的通用化 helper。
- 面板打开状态、当前 checkpoint 和 fileId 不跨会话持久化。切换会话立即关闭，防止显示上一会话的敏感内容。
- 面板不自动打开。Agent 完成修改后只追加摘要卡片。

### 5.4 焦点与可访问性

- 文件行使用 button 语义，支持 Enter/Space。
- 打开面板后焦点进入面板标题或选中文件标题。
- 关闭/返回后焦点回到触发文件行或“审核文件”按钮。
- resizer 继续使用现有 Radix/shadcn 组件的键盘能力。
- Diff 和会话拥有独立滚动容器，打开面板不改变会话滚动锚点。
- 状态不能只靠红绿颜色，增删数保留 `+`/`-` 符号和文本标签。

## 6. 时间线交互

### 6.1 检查点卡片

卡片位于最终 assistant 回复之后，默认展示前三个文件：

```text
┌──────────────────────────────────────────────┐
│ 已修改 4 个文件                 撤销文件修改  审核文件 │
│ +32 -8                                      │
├──────────────────────────────────────────────┤
│ src/a.ts                               +8 -2 │
│ src/b.ts                              +24 -6 │
│ README.md                                  +1 │
│ 再显示 1 个文件                              │
└──────────────────────────────────────────────┘
```

视觉规则：

- 一个外边界，不加阴影，不做卡片套卡片。
- 数字右对齐，路径单行截断并提供完整 title。
- 文件行 hover/selected 使用现有 token。
- “审核文件”打开第一个文件；点击具体文件打开该文件。
- `available` 状态显示撤销；`superseded` 只保留审核；`rewound` 显示“已撤销”；`partial` 显示“部分撤销，需检查”。

### 6.2 状态事件

`ConversationEntryV1.history` 保持 append-only 语义：

- 创建检查点时追加 `fileCheckpoint` 事件。
- 被下一用户轮次取代、成功撤销或部分失败时，再追加相同 `checkpointId` 的状态事件。
- Renderer 在 `timelineDisplayEntries` 中按 `checkpointId` 合并状态，把更新投影到原卡片并隐藏后续状态记录。

这比重写旧历史项更符合现有事件模型，也便于导出和诊断。

### 6.3 撤销确认

点击“撤销文件修改”先执行只读 prepare。成功后打开确认 Dialog：

- 标题：`撤销这轮文件修改？`
- 正文：`将恢复 4 个文件。对话内容不会回退。`
- 如果本轮出现 Bash 或普通 subagent，追加：`终端或子智能体产生的修改可能不在此次撤销范围内。`
- 取消：`取消`
- 确认：`撤销文件修改`

确认按钮不使用模糊的“确定”。

## 7. 检查点数据模型

建议新增 `agent.file-checkpoints` SQLite DataRepository namespace：

```ts
type AgentFileCheckpointEntryV1 = {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  providerId: string
  sdkSessionId: string
  sdkUserMessageId: string
  status: "available" | "superseded" | "rewound" | "partial" | "unavailable"
  workspace: {
    rootPath: string
    rootRealPath: string
  }
  files: AgentFileCheckpointFileV1[]
  fileCount: number
  insertions: number
  deletions: number
  coverageWarnings: ("bash-observed" | "subagent-observed" | "baseline-missing")[]
  diffBytes: number
  diffTruncated: boolean
  createdAt: string
  updatedAt: string
  rewoundAt?: string
}
```

单文件记录：

```ts
type AgentFileCheckpointFileV1 = {
  id: string
  pathRef: {
    rootKind: "workspace" | "additional-directory"
    canonicalRootPath: string
    relativePath: string
    parentRealPath: string
  }
  displayPath: string
  changeKind: "added" | "modified" | "deleted" | "renamed"
  before: FileFingerprint
  after: FileFingerprint
  additions?: number
  deletions?: number
  binary: boolean
  diffText?: string
  diffTruncated: boolean
  diffUnavailableReason?: "binary" | "too-large" | "baseline-missing" | "encoding"
}
```

V1 实际只从 SDK 支持工具产生 `added` 和 `modified`；保留另外两个值用于未来更完整的受控文件操作，不代表当前支持恢复目录或 Bash 删除。

`FileFingerprint` 至少包含 `kind`、SHA-256、byteSize、mode、父目录真实路径和普通文件身份。缺失文件使用稳定 sentinel，不跟随符号链接。

### 7.1 大小与保留

- PreToolUse 内存基线：单文件最多 2 MiB，单轮最多 8 MiB。超过后仍计算流式 SHA-256，但不保存文本基线。
- 持久化 patch：单文件最多 128 KiB，单检查点最多 512 KiB。
- 文件元数据硬上限：每检查点 1000 个文件。超过时检查点标为 `unavailable`，不允许撤销超出安全校验能力的集合。
- 会话删除时删除对应检查点记录。
- 达到全局空间配额时，仅按 LRU 清理 `superseded/rewound` 的旧 diffText，保留摘要和状态；当前 `available` 检查点的安全指纹不得被清理。
- 对话调试包默认导出摘要和状态，不自动导出源码 patch。若未来需要导出，必须增加单独确认和敏感数据说明。

## 8. 捕获与 Diff 生成

### 8.1 轮次开始

在主进程生成 `sdkUserMessageId`，不要由 Renderer 提供。发送给 SDK 的 `SDKUserMessage` 带该 UUID，并同时启用：

```ts
enableFileCheckpointing: true
extraArgs: { "replay-user-messages": null }
```

桥接层识别 `SDKUserMessageReplay.isReplay === true`，校验回放 UUID 与当前轮次 UUID一致。该事件只用于控制面，不重复显示用户消息。

### 8.2 写入前捕获

在现有 `buildHooks()` 中组合新的 `PreToolUse` matcher，不能覆盖 TodoWrite、Persona 和 subagent hooks。

匹配 Write、Edit、MultiEdit、NotebookEdit：

1. 从受支持 input 字段提取路径。
2. 以 cwd 或明确 additional directory 为根解析路径。
3. 拒绝 `..` 逃逸、后代符号链接和非普通文件；不跟随链接。
4. 同一轮同一路径只捕获第一次修改前状态。
5. 计算 before 指纹，并在大小预算内保存文本基线。

被拒绝或失败的工具可以留下临时基线，但轮末若最终指纹未变化则不进入检查点。

### 8.3 轮次结束

收到 terminal result 后，在 Query 仍可用时执行：

```ts
rewindFiles(sdkUserMessageId, { dryRun: true })
```

处理顺序：

1. SDK dry-run 的 `filesChanged` 是可恢复文件集合权威。
2. Synapse 读取这些文件的 after 指纹。
3. 与本轮 PreToolUse 基线匹配，生成逐文件 patch 和计数。
4. SDK 返回的 aggregate insertions/deletions 是卡片总计权威。
5. dry-run 中存在但没有基线的文件仍进入摘要，Diff 标记 `baseline-missing`，例如受支持的前台 fork skill 修改。
6. 捕获过但不在 SDK 集合中的路径不进入“可撤销文件”卡片。

若 SDK dry-run 不可用，本轮不显示可撤销卡片。可以记录受限诊断，但不能用工具输入推测成一个可撤销检查点。

### 8.4 patch 生成依赖

共享 viewer 只解析 patch，不生成 patch。已确认把锁文件中已有的 `diff@8.0.4` 声明为 `@synapse/desktop` 直接生产依赖，用 `createTwoFilesPatch` 生成统一 Diff。这样避免再实现一套 Myers 算法。

## 9. 安全撤销协议

### 9.1 为什么只允许最新检查点

SDK 的锚点位于用户消息开始处。对旧锚点调用 rewind 会恢复该消息之后的累计受支持文件变化，不是只撤销该卡片显示的一轮。

V1 规则：

- 新用户轮次开始时，把上一个 `available` 检查点追加状态 `superseded`。
- 只有当前会话最后一个 `available` 检查点可以进入 prepare。
- 旧卡片可继续查看历史 Diff。

未来如支持旧锚点，产品动作必须改名为“恢复到这里”，并单独展示会被累计恢复的全部后续检查点。

### 9.2 Prepare

新增只读接口 `prepareFileCheckpointRewind`。主进程必须完成：

1. 检查 checkpoint 属于 request 中的 project/conversation。
2. 检查状态为 `available`，且没有正在执行的 Agent turn 或 checkpoint operation。
3. 解析当前 workspace 和 provider，确认同一 `sdkSessionId` 仍可恢复。
4. 为每个文件调用 `PermissionGuard` 检查精确写入目标。
5. 重新校验根路径、父目录真实路径、普通文件/缺失状态和 after 指纹。
6. 用当前或按同一 provider 配置恢复的 Query 再做一次 SDK dry-run。
7. 要求 dry-run 文件集合与数据库记录完全一致。不能忽略额外路径后继续。
8. 返回五分钟有效的一次性 `operationId`、文件数、总增删数和覆盖警告。

任一检查失败时不写文件。

### 9.3 Confirm

`rewindFileCheckpoint({ operationId })` 执行：

1. 消费一次性 operation。
2. 重复关键身份、权限、文件集合和 after 指纹校验。
3. 调用真实 `rewindFiles(sdkUserMessageId)`。
4. 逐文件读取并验证 before 指纹。
5. 记录每个路径的 `AuditSink` outcome，不记录文件正文。
6. 成功时追加 `rewound` 状态事件并关闭当前 live session。
7. 任一文件未恢复、`skippedLinks > 0` 或指纹不匹配时追加 `partial`，不声称成功。

SDK 多文件 rewind 不是事务。Synapse 能做到执行前零写入拒绝和执行后逐文件验证，不能承诺中途失败时自动恢复到 after 状态。部分失败界面必须打开该检查点审查，并提示用户在外部工具中处理。

### 9.4 会话语义

撤销后：

- 对话和模型上下文保留。
- 检查点卡片变成“已撤销”。
- 下一轮恢复同一对话时，模型可能仍记得已被撤销的修改。
- 不向 SDK 私自插入伪造用户消息。需要时由产品后续设计显式的“从这里分叉对话”。

## 10. 主进程与 IPC 边界

建议新增 Agent 私有服务：

```text
AgentFileCheckpointTracker   # 单个 live SDK session 内的轮次捕获
AgentFileCheckpointService   # 持久化、详情、prepare、confirm、清理
ClaudeSDKRewindClient        # 当前 Query 与同 session resume 的统一适配
```

需要扩展：

- `QueryLike.rewindFiles`
- `LazyQuery.rewindFiles`
- `SynapseToolRouterQuery.rewindFiles`
- `AgentLiveSession` 的 checkpoint begin/finalize/control 边界
- `sdk-event-bridge` 的 user replay UUID 控制事件
- `ConversationRouter` 的 turn postlude 持久化

Renderer 只获得四个窄接口：

```ts
getFileCheckpoint({ projectId, conversationId, checkpointId })
getFileCheckpointDiff({ projectId, conversationId, checkpointId, fileId })
prepareFileCheckpointRewind({ projectId, conversationId, checkpointId })
rewindFileCheckpoint({ projectId, conversationId, checkpointId, operationId })
```

接口不接受绝对路径、任意 patch 或目标文件列表。所有 request/response 进入 Zod schema、generated IPC channels、preload bridge 和 `desktop/src/types/bridge.ts`。

该能力保持在 Agent Runtime 私有 IPC，不扩张 File Opener、Git Capability、MCP、Workflow 或 Deep Link。

## 11. Diff 面板

### 11.1 结构

```text
Panel header: 文件更改 | 关闭
Checkpoint toolbar: 文件选择、上一项、下一项、+N -N
Diff toolbar: 统一/分栏、换行
Diff content: shared DiffViewer
```

点击时间线具体文件后直接选中该文件；点击“审核文件”选中第一项。面板按需加载 checkpoint 详情和单文件 patch，不把整个检查点所有 patch 放进 timeline IPC。

加载和错误状态：

- 首次加载使用与内容结构一致的 skeleton。
- diff 已清理：`差异内容已清理。`
- binary：`二进制文件已变更。`
- too large：`差异过大，仅保留变更摘要。`
- baseline missing：`该文件可撤销，但没有可显示的修改前内容。`
- checkpoint missing：关闭面板并提示 `文件检查点不可用。`

### 11.2 审查与撤销解耦

- Diff 面板永远是只读审查面。
- 撤销动作仍从卡片或面板工具栏进入同一个 prepare/confirm 服务。
- Diff 是否被截断不影响 SDK rewind，但缺少安全指纹会禁用撤销。
- 已撤销或 superseded 的历史 Diff 仍可查看，除非被配额清理。

## 12. 边界场景

| 场景 | V1 行为 |
|---|---|
| 新文件 | 显示 added；撤销时 SDK 删除文件；可能保留空父目录 |
| 普通文本修改 | 显示 unified/split Diff；可撤销 |
| NotebookEdit | 按 `.ipynb` 文本 Diff 展示；可撤销 |
| 二进制 | 显示变更摘要；不显示正文；SDK 可恢复时仍可撤销 |
| 文件超过基线预算 | 显示摘要/too-large；有 before/after 指纹时可撤销 |
| 文件被用户再次编辑 | prepare 因 after 指纹变化拒绝，零写入 |
| 文件被替换成链接/硬链接 | prepare 拒绝，零写入 |
| 父目录真实路径变化 | prepare 拒绝，零写入 |
| Bash 写文件 | 不纳入可撤销集合；本轮显示覆盖警告 |
| 普通 subagent 写文件 | 不纳入；本轮显示覆盖警告 |
| 前台 fork skill 写文件 | SDK 可能纳入；没有 sidecar 基线时 Diff 不可用 |
| provider 被删除 | Diff 可看；撤销不可用 |
| SDK session/file history 被清理 | Diff 可看；撤销转 `unavailable` |
| 会话有运行中 turn | 撤销禁用 |
| 真实 rewind 跳过文件 | 状态 `partial`，不显示成功 |
| 会话切换 | 关闭辅助面板，不跨会话保留 fileId |
| 独立窗口 | 使用相同 AgentWorkspaceShell；宽度单独持久化 |

## 13. 安全、隐私与日志

- Renderer 只使用 opaque `checkpointId/fileId` 和 displayPath。
- 绝对路径、canonical root、指纹和 SDK user UUID 只在主进程。
- 所有 workspace 外写入继续经过 `PermissionGuard` 和 `AuditSink`。
- 审计记录 action、checkpointId、相对显示路径、结果和失败种类，不记录 patch、文件正文或 provider secret。
- structured logger 不记录完整 tool input、Diff、用户正文或绝对路径。
- Diff 与历史导出遵守 Agent Runtime 现有脱敏和附件路径投影规则。
- Provider 环境继续同时写 `Options.env` 和 `Options.settings.env` 的 `ANTHROPIC_*` 覆盖；恢复 helper 不得退回用户机器上的其它 provider 配置。
- DeepSeek 和百炼只要能通过现有 Anthropic 兼容接口正常运行内置写工具，就不需要额外模型分支。

## 14. 测试与验收

### 14.1 单元测试

- SDK options 启用 checkpoint/replay，provider env 隔离保持不变。
- outbound/replay UUID 关联，错误 UUID 不建立检查点。
- Write/Edit/NotebookEdit 首次基线、重复编辑、失败/no-op、大小预算。
- SDK dry-run 集合与 sidecar 交集、aggregate totals、baseline missing。
- 文本/binary/CRLF/no-final-newline/大文件 patch。
- `fileCheckpoint` history 恢复、状态折叠、turn postlude 顺序。
- latest-only supersede 规则。
- prepare operation TTL、单次消费和二次确认重校验。
- 文件、父目录、链接、hardlink、missing sentinel 指纹变化拒绝。
- `skippedLinks`、部分恢复和逐文件验证。
- conversation 删除和 quota 清理。

### 14.2 Renderer 测试

- 卡片前三项、展开、总计、状态和键盘操作。
- 点击文件/审核打开正确 panel payload。
- 宽屏 resizable、窄屏详情模式、切会话关闭、关闭后焦点恢复。
- 面板 loading/error/binary/truncated/cleared 状态。
- Git 包装器和 Agent viewer 在抽取后保持现有 Diff 行为。

### 14.3 集成和打包验收

必须使用打包内 SDK 0.3.245 做真实文件测试：

1. DeepSeek 官方 Provider，Write/Edit 后 dry-run、重启应用、resume、rewind。
2. 百炼 Anthropic 兼容 Provider，同一组用例。
3. 新文件、普通修改、NotebookEdit、二进制、大文件。
4. 修改完成后外部再次编辑，确认撤销被拒绝且文件不变。
5. symlink、hardlink、父目录替换，确认 prepare 阶段拒绝。
6. 多文件真实 rewind 中的失败注入，确认 `partial` 和审计。
7. 独立窗口与嵌入式窗口的面板尺寸、焦点和会话切换。

最小工程验证：

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run check:packaged-asar
```

## 15. 实施拆票顺序

### Ticket 1：共享 Diff renderer

- 抽取现有 Git viewer/parser。
- 保持 Git 变更页和历史页行为及测试。
- 将锁文件已有的 `diff@8.0.4` 声明为 desktop 直接生产依赖。

### Ticket 2：工作区辅助面板基础能力

- 新增共享布局 primitive 和 AgentWorkspaceShell。
- 实现宽屏 resizable、窄屏详情、宽度持久化、焦点恢复。
- 为 embedded/window 增加布局测试。

### Ticket 3：SDK 检查点捕获与持久化

- 扩展 Query wrapper 和 SDK options。
- 实现 UUID、PreToolUse tracker、dry-run finalize。
- 新增 `agent.file-checkpoints` schema/service 和 cleanup。
- 暂不提供真实 rewind UI。

### Ticket 4：时间线卡片与 Diff 面板

- 新增 event/timeline/schema/history 投影。
- 实现 postlude 排序和状态折叠。
- 接入 panel registry、checkpoint detail 和单文件 Diff IPC。

### Ticket 5：两阶段撤销

- 实现 prepare/operation token/confirm。
- 接入 PermissionGuard、AuditSink、fingerprint recheck 和 verify-after-rewind。
- 实现 success/partial/unavailable 状态事件。

### Ticket 6：兼容性与发布硬化

- DeepSeek/百炼真实 Provider 冒烟。
- SDK session resume、应用重启、打包边界和配额清理。
- 更新 Agent Runtime 安全规则、模块边界、API 文档、测试说明和 `RELEASE_NOTES_PENDING.md`。

## 16. 已确认的产品选择

2026-08-26，用户确认按以下方案实施：

1. V1 只允许撤销最新检查点，旧检查点只审查。
2. 宽度不足时使用详情模式，不使用覆盖式 Sheet，也不把 conversation 压到 560px 以下。
3. 抽取当前 Git viewer；允许把锁文件已有的 `diff@8.0.4` 声明为 desktop 直接生产依赖，用于可靠生成 patch。
4. Diff payload 每检查点最多 512 KiB，旧 diff 可因全局配额被清理。

四项均已确认，不再作为实施阻塞项。其中第 3 项是唯一依赖变更，实施时应同步更新 desktop 包清单与锁文件声明，并验证打包产物。

## 17. 被否决的方案

### 修改全局 App shell

影响所有模块，无法自然覆盖独立 Agent 窗口，并把 Agent 私有面板状态提升到错误层级。

### 修改 `SidebarContentLayout` 为通用三栏

该组件语义是左导航和内容；其它模块会被迫理解 Agent 第三栏，形成隐式全局协议。

### 把 Diff 放进消息卡片或 Drawer

消息内部空间不足，长 Diff 会破坏时间线和 composer。覆盖 Drawer 也不符合宽屏参考交互，且遮挡会话上下文。

### 使用 Git worktree 作为检查点

无法覆盖非 Git 目录，会混入用户原有工作区变化，也不能证明哪些修改来自本轮 Agent。

### 只依赖 SDK dry-run 展示 Diff

SDK 不返回 patch，只有文件集合和总计，无法满足逐文件审查。

### 由 Synapse 自己恢复 sidecar 快照

要保存全部原始文件字节并重新实现安全恢复、链接和目录语义，存储与风险显著扩大。V1 使用 SDK 文件历史作为恢复权威更合适。

### 对任意旧卡片显示“撤销”

SDK 会累计恢复旧锚点之后的变化，按钮语义不真实，可能删除后续轮次的有效修改。

## 18. 参考

- Anthropic Agent SDK 文件检查点：<https://code.claude.com/docs/en/agent-sdk/file-checkpointing>
- 当前安装类型：`@anthropic-ai/claude-agent-sdk@0.3.245`
- ADR-0035：并发文本覆盖必须在提交前复核目标状态。
- ADR-0101：Agent 本地引用动作不扩张 File Opener 公共能力。
- `docs/agents/agent-runtime-security.md`
- `docs/agents/ui-and-product.md`
- `docs/superpowers/specs/2026-04-28-agent-right-panel-lightweight-design.md`
