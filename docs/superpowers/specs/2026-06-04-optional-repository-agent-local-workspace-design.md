# Optional Repository Agent Local Workspace Design

## 背景

Synapse 当前把“本地仓库”当成进入主界面的前置条件。用户首次启动必须选择或创建仓库；如果设置中删除最后一个仓库，主窗口会回到全屏选仓库状态。这个约束来自 renderer 启动门禁和 Agent 项目模型，而不是配置层：默认配置已经允许 `activeRepoUuid: null`、`repositories: []` 和 `global.projects: []`。

产品方向调整为：仓库继续服务规则、技能、提示词等内容管理；Agent 对话不再依赖用户先配置仓库或项目。没有仓库时，用户应直接进入主界面的“对话”页，并可在内置本地对话分组中创建和继续 Agent 会话。

## 目标

- 没有仓库或当前仓库缺失时，主应用仍可打开，不再全屏阻塞到选仓库页。
- Agent 模块始终提供一个不可删除的默认分组，UI 名称为“本地对话”。
- “本地对话”使用内置项目 ID `builtin:default-agent-workspace`。
- “本地对话”的 Agent 工作目录由 Synapse 管理，路径为 `<userData>/agent-workspaces/default/`。
- 内置项目不写入 `config.global.projects`，不出现在设置的项目列表里。
- 内容、同步、变量、仓库维护等仓库能力在无仓库时显示局部空态或禁用操作，不报错、不阻断其它模块。
- 添加真实项目、知识库、仓库时保持现有流程和行为。

## 非目标

- 不把内容管理改成无仓库可写。
- 不迁移、删除或重写已有 Agent 会话。
- 不把内置本地对话暴露成可编辑、可删除的普通项目。
- 不改变 Knowledge Base 的托管项目边界。
- 不重构整个 Agent runtime 或 DataRepository 项目隔离模型。

## 当前关键约束

- `desktop/src/App.tsx` 在无仓库或 active repository missing 时直接渲染 `EmptyRepositoryState`，导致主应用不可进入。
- `desktop/src/modules/agent/project-resolution.ts` 只从 `config.global.projects` 生成 Agent 项目范围。
- `useAgentChat` 在项目列表为空时 reset 并跳过会话刷新。
- `resolveProjectAgent` 只解析 repository uuid 或 `global.projects` id，找不到则抛“找不到当前项目”。
- Agent runtime 真正需要的是可访问的 `workspacePath`/`workDir`；会话数据库、事件 scope 和权限日志仍依赖稳定 `projectId`。

## 设计

### 1. 内置本地对话项目

新增一个共享定义，集中描述内置 Agent 工作区：

- `id`: `builtin:default-agent-workspace`
- `name`: `本地对话`
- `workspace directory`: `<userData>/agent-workspaces/default/`
- `managed`: true
- `visible in settings`: false

Renderer 和 Electron 主进程都应从同一套语义获取 ID 和展示名，避免魔法字符串散落。主进程负责确保工作目录存在，失败时只影响本地对话的 Agent 启动，不影响应用进入主界面。

### 2. App 启动门禁降级

`App.tsx` 不再因为无仓库直接 return `EmptyRepositoryState`。

推荐行为：

- `repositories.length === 0` 时默认 active tab 为 `agent`。
- 当前 active repository 缺失时仍进入主界面；内容相关模块显示局部空态。
- 保留定期 repository state 检查，但没有 active repository 时不轮询。

`EmptyRepositoryState` 可以保留给仓库设置页或未来局部入口使用，但不再是主应用启动门。

### 3. Agent 项目范围

`resolveAgentProjectScope` 在真实项目列表为空时也返回内置本地对话项目。真实项目存在时，仍显示内置本地对话，并继续显示所有 `config.global.projects`。

推荐排序：

1. 本地对话
2. 配置项目
3. 知识库项目
4. 已归档会话

默认项目解析：

- 有当前选中会话时沿用选中会话。
- 没有选中会话时默认 `builtin:default-agent-workspace`。
- 如果从外部打开某个真实项目会话，按 payload 切到对应分组。

### 4. Agent 侧边栏交互

侧边栏不再出现“尚未配置项目，添加项目后即可开始 Agent 对话”的全阻塞空态。即使没有任何用户配置项目，也渲染“本地对话”分组和新建按钮。

“本地对话”分组：

- 不提供删除或编辑项目入口。
- 允许创建 Agent 会话。
- 使用现有会话列表、未读、发送状态、归档逻辑。
- 不显示路径文案，避免暴露内部 userData 路径。

### 5. 主进程项目解析

`resolveProjectAgent` 增加对内置 ID 的解析：

- 命中 `builtin:default-agent-workspace` 时，打开 project container。
- container metadata 使用 `name: "本地对话"` 和 `<userData>/agent-workspaces/default/`。
- 该工作区不标记为 Knowledge Base，不加载知识库 runtime、plugin、skill、hook 或 native slash allowlist。
- `CustomCommandRegistry` 和 `SkillRegistry` 仍可加载用户 home 下全局 commands/skills；本地工作区内的 `.codex`、`.claude`、`.agents` 目录如果存在，则按现有 registry 逻辑读取。

### 6. 会话与归档

已有会话不迁移。

- 内置本地对话的新会话写入 `projectId: "builtin:default-agent-workspace"`。
- 被删除的真实项目下的旧会话继续进入“已归档”分组。
- 如果历史数据里已经存在无法解析 projectId 的会话，仍按现有 `listAllSessions` orphan 逻辑归档。
- 删除归档会话继续使用已有 fallback：项目缺失时可直接从全局 conversation namespace 删除。

### 7. 内容和仓库模块

内容模块、变量、同步、维护仍依赖 active repository。无仓库时应表现为局部空态。

要求：

- 不抛出导致 ErrorBoundary 或全局阻断的错误。
- 不自动创建仓库。
- 不隐藏“设置”里的添加仓库、添加项目、创建知识库入口。
- 内容创建、安装、导出遇到无 active repository 时沿用明确错误，但入口应尽量在 UI 层禁用或显示空态。

### 8. 工作流后续收敛

当前 Workflow 设计文档曾描述无项目 fallback 到 home，但实际 `sendToAgent` 要求 projectId 存在。此次改造应优先保证 renderer Agent 对话；如果实现范围包含工作流，则 workflow prompt 节点在缺少 projectId 时可改为使用 `builtin:default-agent-workspace`。

如果不纳入首期实现，需在测试和 release note 中明确：无仓库可以 Agent 对话，但工作流 prompt 节点仍需选择项目。

## 数据流

1. 用户无仓库启动应用。
2. `App.tsx` 进入主布局，默认 tab 为 `agent`。
3. Agent renderer project scope 注入“本地对话”项目。
4. 用户点击“本地对话”分组的新建按钮。
5. Renderer 调用 `agent.createSession({ projectId: "builtin:default-agent-workspace", ... })`。
6. 主进程解析内置项目，确保 `<userData>/agent-workspaces/default/` 存在并打开 project container。
7. Agent runtime 使用该目录作为 `cwd` 启动 Claude Code SDK。
8. 会话、timeline、permission、usage 继续按 project-scoped DataRepository 保存。

## 错误处理

- 内置工作目录创建失败：Agent 创建或发送失败，显示“创建失败”或“发送失败”，日志记录错误类型和长度，不暴露 secret。
- 内置工作目录被删除：下次解析时重新创建。
- 内置工作目录路径被文件占用：报工作区不可用，提示用户稍后重试或检查本地数据目录。
- 无 active repository 的内容写操作：保持现有明确错误，但 UI 不应主动触发。
- 当前仓库缺失：不退出主界面；仓库相关工具栏和内容页显示不可用状态。

## 测试计划

### Renderer

- `App` 在 `repositories: []` 时渲染主 shell，并默认展示 Agent tab。
- `App` 在 active repository missing 时不渲染全屏 `EmptyRepositoryState`。
- Agent sidebar 在 `config.global.projects: []` 时显示“本地对话”分组和创建入口。
- 创建会话时使用 `builtin:default-agent-workspace`。
- 内容模块无 active repository 时显示局部空态，不抛 ErrorBoundary。

### Electron

- `resolveProjectAgent` 可解析内置项目，并传入 app-managed workspacePath。
- 内置 workspace 不加载 Knowledge Base runtime。
- `createSession`、`listSessions`、`send`、`getTimeline` 支持内置 projectId。
- 删除不存在项目的归档会话仍可 fallback 删除。

### Integration

- 空配置首次启动：可进入对话、新建会话、发送消息。
- 删除最后一个仓库：仍停留主界面，可继续使用“本地对话”。
- 添加真实项目后：侧边栏同时显示“本地对话”和真实项目。
- 创建知识库后：知识库分组仍按托管知识库能力显示资料管理和 native slash。
- 无仓库下进入内容页：显示局部空态，不报错。

## Release Note Draft

用户不再需要先选择本地仓库才能进入 Synapse。没有仓库时，应用会直接打开到“对话”，并提供一个内置的“本地对话”空间用于 Agent 聊天；仓库相关的内容管理能力仍可在需要时单独添加本地目录。
