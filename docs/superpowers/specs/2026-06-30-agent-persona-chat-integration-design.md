# Agent 对话智能体人格接入设计

> 已被 `2026-07-20-agent-persona-conversation-creation-design.md` 取代。当前产品不再支持同一对话中切换智能体；本文件仅保留为历史设计记录。

日期：2026-06-30

## 背景

`docs/superpowers/specs/2026-06-30-agent-personas-app-design.md` 已经定义了独立系统应用“智能体”，负责管理内置和用户创建的人格配置。该设计明确 V1 不接入 Agent runtime。本设计是下一阶段：把已有 `agent-personas` 能力接入现有 Agent 对话，让用户在同一会话中选择、保持并切换主线程智能体人格。

用户提供的调研资料确认了几个边界：

- Persona 是“怎么做事”的配置，不是记忆容器。
- Project / Conversation / Session 是上下文和历史的归属。
- `agentType` 是运行时类型，不应用来表示人格。
- Persona 应优先映射到 Claude Agent SDK 的 main-thread `agent`，不应做成 subagent。
- Skill 是文件系统能力包，未来 Persona 可引用 Skill，但 Skill 不是 Persona 本体。
- `CLAUDE.md` 是项目长期上下文，不是人格切换本体。

官方 Claude Code 文档确认：

- TypeScript SDK `Options.agent` 是 main thread agent 名称，必须定义在 `agents` option 或 settings 中。
- `AgentDefinition.prompt` 是该 agent 的 system prompt。
- `Query.applyFlagSettings(settings)` 可在 running session 修改 settings。
- Claude Code settings 中 `agent` 会让 main thread 使用指定 agent，并应用其 system prompt、tool restrictions 和 model。
- subagent 是 fresh conversation，不接收 parent conversation history，不适合作为同一会话内的人格切换主体。

## 目标

- 新建 Agent 会话默认保持普通对话，不要求选择智能体。
- 在 Agent 输入框底部提供人格菜单，默认“普通”。
- 用户选择某个智能体后，该选择绑定当前 conversation 并一直保持，直到用户再次切换。
- 切到别的会话再回来时，恢复该会话保存的人格选择。
- 同一个 conversation 内允许切换不同人格，历史和 `sdkSessionId` 连续。
- 使用 Claude SDK main-thread `agent` 实现人格，不拼接 user prompt，不使用 subagent 作为主体。
- 使用 `applyFlagSettings({ agent })` 作为运行中切换主路径；在当前 running query 不认识目标 agent 或定义已变化时，使用 close + resume 作为 fallback。
- 保持现有普通对话、权限模式、模型供应商、快捷输入、独立窗口和导出能力不回退。

## 非目标

- 不做聊天室、群聊、多人参与者、多个智能体同时发言或智能体互相 @。
- 不把未来聊天室建在当前 Agent Conversation 表和状态机上。未来聊天室是独立能力。
- 不做 persona 独立记忆。
- 不把 persona 写入 `agentType`。
- 不做每条消息一次性 persona，选择后应保持。
- 不默认开放 Claude SDK `Agent` tool。
- 不做子代理委派系统。
- 不做 persona skills 自动安装或 plugin 打包。
- 不让 persona 的 providerModel 在切换时隐式更换当前会话供应商。

## 产品行为

普通新会话：

```text
Create conversation
  activeMainThreadPersonaId = null
  queryOptions.agent 不传
  保持普通 Claude Code 对话
```

输入框底部增加人格菜单：

```text
[ 普通 ▾ ]  [权限模式]  [快捷输入]                    [发送]
```

菜单项：

```text
普通
中英翻译
用户创建的人格...
```

选择人格：

```text
用户选择“中英翻译”
  -> 保存到当前 conversation
  -> 当前会话菜单显示“中英翻译”
  -> 后续消息一直使用该人格
```

切回普通：

```text
用户选择“普通”
  -> activeMainThreadPersonaId = null
  -> 后续消息不传 SDK agent
```

切换会话：

```text
Conversation A: activeMainThreadPersonaId = "translator"
Conversation B: activeMainThreadPersonaId = null

选中 A -> 菜单显示“中英翻译”
选中 B -> 菜单显示“普通”
```

正在输出时切换：

```text
当前 turn 继续使用原人格
新选择立即保存到 conversation
下一轮发送前应用新人格
```

## 数据模型

扩展现有 `ConversationEntryV1.agentConfig`：

```ts
agentConfig?: {
  model?: string
  mode?: string
  modelTier?: string
  env?: Record<string, string>
  activeMainThreadPersonaId?: string | null
  activeMainThreadPersonaSnapshot?: {
    id: string
    name: string
    source: "builtin" | "user"
    definitionHash: string
  }
}
```

说明：

- `undefined` 和 `null` 都表示普通对话。
- `activeMainThreadPersonaId` 是持久化权威状态。
- `activeMainThreadPersonaSnapshot` 用于 UI 回显、导出、审计和 persona 被删除后的降级展示。
- 不持久化 SDK agent name 或 definitions hash 的全局集合；它们是运行时派生值。

历史记录使用现有 `ConversationHistoryEntryV1.metadata` 扩展：

```ts
metadata?: {
  mainThreadPersona?: {
    id: string
    name: string
    source: "builtin" | "user"
    definitionHash: string
  }
}
```

说明：

- 普通模式不写该 metadata。
- Assistant 结果至少记录当轮人格。
- User 消息也记录发送时人格，便于导出和审计；UI 默认只在 assistant 消息上克制显示。

本期不新增 `actor`、`participant`、`mentions`、`roomId` 等聊天室字段。未来聊天室使用独立表和状态机。

## Persona 到 SDK Agent 的映射

不直接使用用户可变 ID 作为 SDK agent name，统一生成稳定前缀：

```text
persona id      builtin-zh-en-translator
sdk agent name  synapse-persona__builtin-zh-en-translator
```

运行时定义：

```ts
agents[sdkAgentName] = {
  description: persona.description,
  prompt: persona.systemPrompt,
  disallowedTools: ["Agent"],
}
```

`AgentSdkAgentDefinition` 类型补齐官方 `AgentDefinition` 支持字段：

```ts
type AgentSdkAgentDefinition = {
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  mcpServers?: unknown[]
  skills?: string[]
  initialPrompt?: string
  maxTurns?: number
  background?: boolean
  memory?: "user" | "project" | "local"
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number
  permissionMode?: string
  criticalSystemReminder_EXPERIMENTAL?: string
}
```

第一期只由现有 persona 字段生成 `description`、`prompt` 和默认 `disallowedTools: ["Agent"]`。其它字段只是类型兼容，除非后续产品明确开放，不在 UI 中暴露。

`providerModel` 第一版不在会话内切换时自动生效。原因是当前会话的 provider、modelTier 和权限模式已经是独立配置，切人格时隐式切模型供应商会让用户难以判断当前执行环境。后续如果要启用 persona 模型偏好，应通过明确策略设计。

## 运行时解析层

新增运行时解析层，避免 `SessionManager` 直接耦合 app service 细节：

```text
AgentPersonaRuntimeResolver
  listSdkAgents()
  resolveActivePersona(conversation)
  hashDefinitions()
  snapshot(persona)
```

输出：

```ts
type ResolvedMainThreadPersona = {
  personaId: string | null
  sdkAgentName?: string
  snapshot?: {
    id: string
    name: string
    source: "builtin" | "user"
    definitionHash: string
  }
}

type ResolvedPersonaSdkConfig = {
  activeAgentName?: string
  agents: AgentSdkAgentDefinitions
  definitionsHash: string
}
```

`definitionsHash` 覆盖所有传入当前 query 的 persona 定义内容。用户编辑 persona prompt 后，即使 personaId 不变，hash 也会变化。

## ClaudeSDKSession 扩展

扩展 `QueryLike`：

```ts
interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<void>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>
}
```

扩展 `AgentLiveSession`：

```ts
interface AgentLiveSession {
  readonly mainThreadAgentName?: string
  readonly agentDefinitionsHash?: string
  setMainThreadAgent?(agentName: string | null): Promise<void>
}
```

启动 query 时：

```ts
if (options.agent) queryOptions.agent = options.agent
if (options.agents && Object.keys(options.agents).length > 0) {
  queryOptions.agents = options.agents
}
```

运行中切换：

```ts
async setMainThreadAgent(agentName: string | null) {
  if (!this.query.applyFlagSettings) {
    throw new Error("当前会话不支持切换智能体")
  }
  await this.query.applyFlagSettings({ agent: agentName })
  this.mainThreadAgentName = agentName ?? undefined
}
```

切回普通使用 `agent: null`，与官方 `applyFlagSettings()` 清理 override 的模式一致。

## SessionManager 状态机

`RuntimeSessionState` 记录运行态派生值：

```ts
RuntimeSessionState {
  liveSession
  providerId
  modeOverride
  effectiveModel
  sdkSettings
  additionalDirectories
  mainThreadAgentName?: string
  agentDefinitionsHash?: string
}
```

发送前解析 persona SDK config：

```text
resolve persona sdk config
  activeAgentName
  agents
  definitionsHash
```

复用 live session 条件在现有 provider、mode、model、sdkSettings 基础上增加 persona 判断：

```text
definitionsHash 相同
  activeAgentName 相同
    -> 复用
  activeAgentName 不同
    -> applyFlagSettings({ agent })
    -> 复用

definitionsHash 不同
  activeAgentName 为 undefined
    -> 可 applyFlagSettings({ agent: null })，不必为了普通模式重建
  activeAgentName 非 undefined
    -> close + resume，传最新 agents + agent
```

如果 `applyFlagSettings` 失败：

```text
记录结构化 warn
close live session
resume 同一个 sdkSessionId
传最新 agents + agent
```

如果 close + resume 也失败，阻止发送并向 UI 返回“智能体切换失败”。

正在输出时不调用 `applyFlagSettings`，只保存 conversation 状态。下一次 send 进入 `getOrCreateSession()` 时再应用。

## IPC 与服务

新增 Agent IPC：

```ts
agent.updateSessionPersona({
  projectId: string
  conversationId: string
  personaId: string | null
}): Promise<SynapseAgentSessionSummary>
```

服务行为：

- `personaId === null`：切回普通。
- `personaId !== null`：必须存在于 `AgentPersonaService.list()` 返回结果。
- 更新当前 conversation 的 `agentConfig.activeMainThreadPersonaId` 和 snapshot。
- 如果当前 conversation 是选中会话，renderer 立即更新菜单状态。
- 如果当前 live session 空闲，可尝试立即应用；如果正在运行，只保存状态。

`SynapseAgentSessionSummary` 增加：

```ts
readonly activeMainThreadPersonaId?: string | null
readonly activeMainThreadPersonaName?: string
readonly activeMainThreadPersonaSource?: "builtin" | "user"
```

返回 snapshot 对象；UI 只使用 id/name/source。

## Renderer 设计

`AgentComposer` 增加 persona 菜单 props：

```ts
personaItems: readonly SynapseAgentPersona[]
activePersonaId?: string | null
onPersonaChange(personaId: string | null): void | Promise<void>
```

`AgentModule` 或 `useAgentChat` 负责加载 `bridge.agentPersonas.list()`，监听 `agentPersonas.onChanged`。

交互：

```text
默认显示 普通
点击打开菜单
选择 persona -> 调 updateSessionPersona
选择 普通 -> 调 updateSessionPersona(..., null)
```

删除 persona 后：

```text
当前会话 activeMainThreadPersonaId 指向已删除 persona
  -> UI 使用 snapshot 显示名称但标记不可用
  -> 发送前后端拒绝并要求切回普通
```

第一期不在 persona changed 时自动把不可用会话回落普通，避免静默修改大量历史会话。只在当前会话切换或发送时处理不可用 persona。

UI 文案保持克制：

- 菜单默认：`普通`
- 不可用提示：`智能体不可用`
- 切换失败：`智能体切换失败`

不添加功能介绍段落、欢迎横幅或营销文案。

## 历史与导出

保存 assistant 结果时合并当轮 persona snapshot 到 history metadata。

导出 transcript 显示短标记：

```text
[中英翻译]
assistant response...
```

普通模式不显示标记。

## 错误处理

- Persona 不存在：保存失败，toast `智能体不存在`。
- Persona 被删除后发送：阻止发送，提示 `智能体不可用`。
- `applyFlagSettings` 不可用：走 close + resume fallback。
- `applyFlagSettings` 失败：结构化 warn 后走 fallback。
- fallback 失败：阻止发送，显示 `智能体切换失败`。
- Persona prompt 为空：由 `AgentPersonaService` 现有校验保证，不在 runtime 接收无效定义。

## 测试

后端单测：

- 普通会话不传 `queryOptions.agent`。
- 选中 persona 时传 `queryOptions.agents` 和 `queryOptions.agent`。
- `definitionsHash` 相同且 agent 不同时调用 `setMainThreadAgent()`，不 close。
- `definitionsHash` 不同且目标非普通时 close + resume。
- 切回普通调用 `applyFlagSettings({ agent: null })`。
- 正在运行时 `updateSessionPersona()` 只保存 conversation，不打断当前 turn。
- Persona 被删除后发送失败并提示不可用。
- `applyFlagSettings` 失败后 fallback 到 close + resume。

IPC 测试：

- 注册 `agent.updateSessionPersona`。
- `personaId === null` 成功切回普通。
- 存在 persona 成功保存并返回 session summary。
- 不存在 persona 报错且不修改 conversation。

Renderer 测试：

- 默认显示 `普通`。
- 选择 persona 后调用 `updateSessionPersona`。
- 切换会话后显示各自保存的人格。
- Persona 列表变化后菜单刷新。
- 当前 persona 不可用时显示错误状态或提示。

回归测试：

- 普通新建会话。
- 普通发送消息。
- 权限模式切换。
- 快捷输入发送。
- Agent 独立窗口。
- Conversation 导出。
- Knowledge Base native slash passthrough 不受 persona 菜单影响。

## 发布说明

这是用户可感知能力，完成实现后需要更新根目录 `RELEASE_NOTES_PENDING.md`：

```text
Agent 对话现在可以在输入框选择智能体人格，并在同一会话中保持或切换；普通对话仍是默认模式。
```

## 实施顺序建议

1. 扩展 schema、session summary、repository 保存方法和 IPC。
2. 增加 persona runtime resolver。
3. 扩展 `ClaudeSDKSession` 支持 `agent` 和 `applyFlagSettings`。
4. 扩展 `SessionManager` persona 复用与 fallback 状态机。
5. 接入 renderer persona 菜单。
6. 补历史 metadata、导出显示和测试。
