# CC Connect 方案与架构迁移备忘

源码路径：`/Users/liyang/Desktop/code-guide/cc-connect-main`

写作目的：这份文档不是对 CC Connect 的 README 复述，而是把其中对 Synapse 后续迁移有价值的架构、实现思路、模块边界、关键数据模型和可复用机制先整理出来，降低后续 AI 工具继续迁移时的阅读成本。

## 阅读范围

已重点阅读以下部分：

- 根目录说明与配置：`README.md`、`README.zh-CN.md`、`config.example.toml`、`go.mod`
- 启动与命令入口：`cmd/cc-connect/*.go`
- 核心层：`core/*.go`
- 配置层：`config/config.go`
- Agent 适配层：`agent/claudecode`、`agent/codex`、`agent/acp`、`agent/gemini`、`agent/kimi`、`agent/opencode`、`agent/iflow`、`agent/qoder`、`agent/pi`、`agent/devin`、`agent/cursor`
- 平台适配层：`platform/feishu`、`platform/telegram`、`platform/slack`、`platform/discord`、`platform/dingtalk`、`platform/wecom`、`platform/weixin`、`platform/qq`、`platform/qqbot`、`platform/line`、`platform/weibo`
- 外部协议与管理文档：`docs/bridge-protocol.zh-CN.md`、`docs/management-api.zh-CN.md`、各平台接入文档
- Web 管理端：`web/src/App.tsx`、`web/src/api/*`、`web/src/pages/*`

## 一句话定位

CC Connect 是一个“多聊天平台到多 Agent CLI 的桥接器”：它把 Feishu、Telegram、Slack、Discord、微信等平台的消息统一成 `core.Message`，再交给 Claude Code、Codex、Gemini、Kimi、ACP 等 Agent 适配器执行，并把流式事件、权限请求、工具进度、附件、定时任务结果和卡片交互再转回各平台。

对 Synapse 最有价值的不是它的 UI，而是四层能力：

- 统一消息平台抽象
- 统一 Agent 会话抽象
- 会话、权限、命令、定时任务、主动发送等编排层
- Bridge/Management API 这种外部扩展协议

## 总体架构

```text
配置 config.toml
  |
  v
cmd/cc-connect/main.go
  |
  +-- 加载全局 providers、projects、platforms、agent、cron、bridge、management
  |
  v
每个 [[projects]] 创建一个 core.Engine
  |
  +-- Agent adapter: claudecode / codex / acp / gemini / ...
  +-- Platform adapter(s): feishu / telegram / slack / discord / ...
  +-- SessionManager: 会话和历史持久化
  +-- CommandRegistry / SkillRegistry / Alias / Roles
  +-- Cron / Heartbeat / Relay / Hooks
  |
  v
平台收到消息 -> core.Message -> Engine.handleMessage
  |
  +-- 鉴权、限流、敏感词、语音转文字、workspace 绑定、命令路由
  +-- 找到或创建 AgentSession
  +-- AgentSession.Send(prompt, images, files)
  |
  v
Agent 事件流 core.Event
  |
  +-- text / thinking / tool_use / tool_result / permission_request / result / error
  |
  v
Engine 渲染输出
  |
  +-- 普通消息、流式预览、卡片、按钮、语音、文件、图片、TTS
```

## 目录地图

- `cmd/cc-connect/`：CLI 入口、provider/cron/relay/web/send 等子命令、启动编排。
- `config/`：TOML 配置模型、环境变量占位符替换、provider 引用解析、精确 patch 配置文件。
- `core/`：项目级 Engine、消息模型、会话、命令、卡片、流式预览、cron、heartbeat、relay、bridge、management、webhook、hooks、权限、语音、TTS、workspace、run-as-user。
- `agent/`：各种 Agent CLI 或协议适配器，把不同输出格式归一成 `core.Event`。
- `platform/`：各种聊天平台适配器，把平台事件归一成 `core.Message`，把 Engine 输出转成平台 API。
- `web/`：内置管理后台，Vite + React，打包后嵌入 Go 二进制。
- `docs/`：平台接入、Bridge 协议、Management API、使用说明。
- `provider-presets.json`、`skill-presets.json`：Provider 和 Skill 市场/预设数据。

## 核心抽象

### 平台接口

`core.Platform` 是所有聊天平台的最小接口：

```go
type Platform interface {
    Name() string
    Start(handler MessageHandler) error
    Reply(ctx context.Context, replyCtx any, content string) error
    Send(ctx context.Context, replyCtx any, content string) error
    Stop() error
}
```

其中 `Start(handler)` 接收平台消息并调用 `MessageHandler`，`Reply` 用原消息上下文回复，`Send` 用重建出来的上下文主动发送。

平台能力不是堆在大接口里，而是通过可选接口声明：

- `ReplyContextReconstructor`：从 session key 重建主动发送上下文，用于 cron、heartbeat、restart notify。
- `CronReplyTargetResolver`：为 Discord/线程类平台解析 cron 实际目标。
- `TypingIndicator`、`TypingIndicatorDone`：处理中状态和完成提示。
- `ImageSender`、`FileSender`、`AudioSender`：附件和语音发送。
- `MessageUpdater`、`PreviewStarter`、`PreviewCleaner`、`PreviewFinishPreference`：流式预览消息的创建、更新、删除、复用。
- `InlineButtonSender`、`CardSender`、`CardNavigable`、`CardRefresher`：按钮和富卡片。
- `FormattingInstructionProvider`：平台特定格式说明注入 Agent prompt。
- `AsyncRecoverablePlatform`：异步恢复型平台，Start 不代表立即可用，通过生命周期回调通知 Engine。

迁移价值：Synapse 可以采用“最小接口 + 可选能力接口”的平台插件模型，避免为所有平台设计一个臃肿总接口。

### Agent 接口

`core.Agent` 和 `core.AgentSession` 统一了各种 CLI/协议：

```go
type Agent interface {
    Name() string
    StartSession(ctx context.Context, sessionID string) (AgentSession, error)
    ListSessions(ctx context.Context) ([]AgentSessionInfo, error)
    Stop() error
}

type AgentSession interface {
    Send(prompt string, images []ImageAttachment, files []FileAttachment) error
    RespondPermission(requestID string, result PermissionResult) error
    Events() <-chan Event
    CurrentSessionID() string
    Alive() bool
    Close() error
}
```

额外能力也用可选接口：

- `ProviderSwitcher`：多 provider 切换。
- `ToolAuthorizer`：动态允许工具。
- `HistoryProvider`：读取 Agent 后端历史。
- `MemoryFileProvider`：读写 `CLAUDE.md`、`AGENTS.md`、`GEMINI.md` 等记忆文件。
- `ReasoningEffortProvider`、`PermissionModeProvider`、`UsageReporter`、`SessionDeleter` 等：把不同 Agent 的高级能力抽象出来。
- `SessionEnvInjector`：给 Agent 注入 `CC_PROJECT`、`CC_SESSION_KEY` 等环境变量。
- `PlatformPromptInjector`：注入平台格式说明。
- `SystemPromptSupporter`：声明是否原生支持追加系统提示。

迁移价值：Synapse 现在已经有 IDE/Agent 适配概念，CC Connect 的接口边界可以作为“外部 Agent 会话层”的参考。

### 统一消息模型

`core.Message` 把平台差异压成一个结构：

- `SessionKey`：唯一会话键，通常是 `{platform}:{chat/channel}:{user}`。
- `Platform`、`MessageID`、`UserID`、`UserName`、`ChatName`
- `Content`
- `Images`、`Files`、`Audio`、`Location`
- `ExtraContent`：平台补充内容，如引用消息、位置说明。
- `ChannelKey`：workspace 绑定用的频道标识。
- `ReplyCtx`：平台不透明回复上下文。
- `FromVoice`：是否来自语音转写。
- `ModeOverride`：本条消息临时覆盖 Agent 权限模式。

附件模型：

- `ImageAttachment`：`MimeType`、`Data`、`FileName`
- `FileAttachment`：`MimeType`、`Data`、`FileName`
- `AudioAttachment`：`MimeType`、`Data`、`Format`、`Duration`
- `LocationAttachment`：经纬度、精度、live period、heading 等

文件附件会保存到 `workDir/.cc-connect/attachments/`，然后把本地路径拼进 prompt，让 Agent 用本地工具读取。

## Engine 编排层

`core.Engine` 是 CC Connect 最重要的类，一个 project 对应一个 Engine。它做的事情包括：

- 平台消息入口：`ReceiveMessage` / `handleMessage`
- 项目级 Agent 和平台列表管理
- 会话管理和 JSON 持久化
- 多 workspace 下的 Agent/SessionManager 池化
- 语音转文字、TTS
- slash 命令、别名、自定义命令、skills
- 用户角色、管理员权限、限流、敏感词
- AgentSession 启动、恢复、关闭和事件消费
- 流式预览、工具进度、thinking、权限请求、最终回复
- cron、heartbeat、relay、webhook、local API、management API 的执行入口
- hook 生命周期事件
- restart 通知、web setup、upgrade 等系统命令

关键流程：

```text
handleMessage
  -> resolveAlias
  -> banned words / allow_from / role / rate limit
  -> voice STT
  -> workspace binding/init
  -> pending permission / pending provider add
  -> slash command
  -> session = sessions.GetOrCreateActive(sessionKey)
  -> busy 检查，忙则排队
  -> processInteractiveMessageWith
      -> getOrCreateInteractiveState
      -> start/resume AgentSession
      -> AgentSession.Send
      -> processInteractiveEvents
```

忙碌会话有一个很实用的策略：

- 同一个 session 正在处理时，普通新消息进入队列。
- 队列上限是 5 条，防止内存无限增长。
- `/btw` 可以在当前 turn 中注入补充内容。
- Agent 完成后自动 drain 队列继续处理。

迁移价值：这套“每个用户/频道一个交互状态 + 忙时排队 + 事件消费循环”的模型，适合迁移到 Synapse 的长期任务/聊天控制台里。

## 会话系统

`core.SessionManager` 管理平台 session key 到多个命名会话的映射：

- 每个 `SessionKey` 可以有多个 named sessions。
- `activeSession` 记录当前活跃会话。
- `Session` 持有 `AgentSessionID`、`AgentType`、`PastAgentSessionIDs`、历史、创建/更新时间。
- 持久化为 JSON snapshot。
- 兼容旧数据，支持 `legacyData` 标记。
- `ContinueSession = "__continue__"` 是只在启动时使用的哨兵，不会持久化。
- `NewSideSession` 用于 cron `new_per_run`，不会切换用户当前活跃会话。
- `UserMeta` 保存用户名和群名，便于管理端展示。

命令层围绕会话提供：

- `/new` 新建会话
- `/list` 列出会话
- `/switch` 切换会话
- `/name` 命名会话
- `/current` 查看当前会话
- `/history` 查看历史
- `/delete` 删除 Agent/session
- `/stop` 停止当前运行

## 多项目与多工作区

### 多项目

一个进程支持多个 `[[projects]]`。每个 project 包含：

- 项目名
- 一个 Agent 配置
- 多个平台配置
- heartbeat、auto_compress、reset_on_idle、run_as_user 等项目级选项
- disabled commands、admin_from、users roles

这种设计让同一个 cc-connect 进程可以同时运行 Claude、Codex、Gemini 等多个 bot，并分别绑定不同平台或同一个群内不同机器人。

### 多工作区

项目可以进入 `mode = "multi-workspace"`，配置 `base_dir` 后，一个 Engine 内按频道绑定不同工作目录：

- `WorkspaceBindingManager` 持久化 channel -> workspace。
- 顶层 key 是 `project:<name>`，也支持 `shared` 路由层。
- `WorkspaceBinding` 保存 `ChannelName`、`Workspace`、`BoundAt`。
- `workspacePool` 按 workspace path 保存 runtime state：独立 `Agent`、独立 `SessionManager`、活跃 turn 计数、lastActivity。
- idle reaper 会清理长时间未使用且没有 active turn 的 workspace state。
- 路径会用 `filepath.EvalSymlinks` 规范化，避免同一目录因软链/尾斜杠造成多份 state。

相关命令：

- `/workspace`
- `/dir`
- `/bind`

迁移价值：这和 Synapse 的“工作区/项目/IDE 配置”天然相关。建议把“聊天频道绑定工作区”和“工作区拥有独立 Agent 会话池”作为迁移重点。

## 配置体系

配置源是 TOML，核心文件是 `config/config.go`。

全局配置包含：

- `data_dir`
- `attachment_send`
- 全局 `[[providers]]`
- `provider_presets_url`
- `[[projects]]`
- 全局 `[[commands]]`
- 全局 `[[aliases]]`
- `banned_words`
- `log`
- `language`
- `speech`
- `tts`
- `display`
- `stream_preview`
- `rate_limit`
- `outgoing_rate_limit`
- `relay`
- `cron`
- `webhook`
- `bridge`
- `management`
- `[[hooks]]`
- `idle_timeout_mins`

Project 配置包含：

- `name`
- `mode`、`base_dir`
- `[projects.agent]`
- `[[projects.platforms]]`
- `heartbeat`
- `auto_compress`
- `reset_on_idle_mins`
- `run_as_user`、`run_as_env`
- `show_context_indicator`
- `reply_footer`
- `inject_sender`
- `disabled_commands`
- `admin_from`
- `users`
- `quiet`
- `observe`
- `references`
- `filter_external_sessions`

配置实现中有几个值得迁移的点：

- 支持 `${ENV_VAR}` 占位符替换。
- `ResolveProviderRefs` 把全局 provider 引用合并到项目 agent provider 列表。
- provider 可限制 `agent_types`，也可为不同 agent 配 `endpoints`、`agent_models`、`agent_model_lists`。
- 对配置文件做“精确 patch”，例如保存 active provider、model、display、TTS mode、项目设置，而不是重写整个 TOML。
- `SaveProjectSettings` 在 agent type 变更时会过滤不兼容 provider refs，并清理无效 active provider。
- Feishu/Weixin setup 有专门的凭据写入逻辑，支持通过 Web 管理端扫码配置。

迁移价值：Synapse 如果需要导入/管理 Agent provider，建议借鉴“全局 provider + 项目引用 + agent-specific overrides”的结构。

## Provider 体系

Provider 结构在 core/config 双侧都有映射，核心字段：

- `name`
- `api_key`
- `base_url`
- `model`
- `models`：可选模型列表和 alias。
- `thinking`：对 Claude Code 2.x 等 provider 兼容性处理。
- `env`：额外环境变量。
- `agent_types`：限制该 provider 适用的 Agent。
- `endpoints`：不同 Agent 类型的 base URL。
- `agent_models`：不同 Agent 类型默认模型。
- `agent_model_lists`：不同 Agent 类型模型列表。
- `codex`：Codex 专属 `wire_api`、`http_headers`、`env_key`。

`ProviderProxy` 很有参考价值：它本地启动一个 127.0.0.1 随机端口反向代理，专门重写 Anthropic `/messages` 请求里不兼容的 `thinking.type = "adaptive"`，例如改成 `disabled` 并删除 `budget_tokens`。这比侵入 Agent CLI 更稳。

迁移建议：Synapse 做 provider 兼容时，优先考虑“本地代理/请求适配层”，不要把所有 provider 差异散落进 UI 和 Agent 调用处。

## Agent 适配体系

### Claude Code

目录：`agent/claudecode`

价值点：

- 用 Claude Code 的 stream-json 输出，解析 text、thinking、tool use、tool result、permission request、usage。
- 支持 `--append-system-prompt` 注入 CC Connect 能力说明。
- 支持 provider 环境变量、代理和模型切换。
- 支持 skill dirs 和 command dirs。
- 支持 permission prompt loop：Agent 发起权限请求，Engine 转成平台按钮/文本，用户回复后 `RespondPermission` 写回。
- 支持 `run_as_user`：通过 sudo 包裹 Agent 进程，隔离用户 HOME、配置和文件权限。

### Codex

目录：`agent/codex`

价值点：

- 支持两种后端：`codex exec` CLI 和 app-server backend。
- 首次 Send 用 `codex exec`，后续用 `codex exec resume <threadID>` 保持连续性。
- 支持 provider config 写入 Codex 自己的 `config.toml`。
- 支持 reasoning effort、模型、上下文/usage 抽取。
- 支持图片、文件、patch/result 事件解析。
- app-server session 能从 rollout/app server 里读上下文使用情况。

这部分和 Synapse 最相关，因为 Synapse 本身已有 Codex/IDE 集成。后续迁移优先读 `agent/codex/session.go`、`agent/codex/appserver_session.go`、`agent/codex/provider_config.go`。

### ACP

目录：`agent/acp`

ACP 是“Agent Client Protocol”通用适配器，价值很高：

- 用 JSON-RPC 风格连接外部 Agent。
- 支持 session/new、session/prompt、session/set_mode、session/load 等。
- 把协议事件映射成 `core.Event`。
- `devin` 适配器基本是基于 ACP 包装。

迁移建议：如果 Synapse 未来要支持更多 Agent，不要为每个 Agent 都只写 CLI 解析器，应该把 ACP/协议型适配作为长期方向。

### 其他 CLI Agent

Gemini、Kimi、OpenCode、Qoder、Pi、IFlow、Cursor 的模式基本是：

- 每次 Send 启动一次 CLI 或 PTY。
- 通过 `--output-format stream-json`、JSONL、PTY transcript 或 stdout 解析输出。
- 从不同 CLI 的事件格式中提取 text、tool use、error、session id。
- 用 resume/session id 维持连续性。

迁移价值：这些适配器提供了“非标准 CLI 如何包成标准事件流”的样板，尤其适合以后支持第三方本地 Agent。

## 平台适配体系

平台适配器负责三件事：

- 启动连接或 webhook/long polling/WebSocket。
- 把平台事件转换成 `core.Message`。
- 把 Engine 输出转换成平台消息、卡片、预览、附件、语音、按钮。

### Session key 约定

常见格式：

```text
{platform}:{chat_or_channel}:{user}
```

有的平台支持频道共享会话，例如 Discord/Slack/Telegram 群聊可配置 channel shared mode；有的平台支持 thread isolation，例如 Feishu/Discord 会把线程 id 纳入 session key。

迁移建议：Synapse 需要提早定义统一 session key 规范，否则后续平台接入和历史迁移会混乱。

### Feishu / Lark

价值点：

- 同时支持普通消息和 interactive card。
- 支持 rich progress card、卡片导航、选择器、删除模式、模型切换。
- 支持 `UpdateMessage`，可做流式预览。
- 支持 message reply/thread isolation。
- 支持 typing/done reaction。
- 对 token 失效、瞬时错误有重试。
- Web setup 支持 device code/扫码写入 app credentials。

### Telegram

价值点：

- 支持 text、image、file、audio、location。
- 支持 inline keyboard 权限按钮。
- 支持 HTML/Markdown 格式转换。
- 支持 preview start/update。
- 支持 typing action。
- 对 message length 做分片。

### Slack

价值点：

- Socket Mode 接入。
- 支持 channel/thread context。
- 用 reaction 表示 typing/processing。
- 实现 `ObserverTarget`，可把本地 Claude Code JSONL terminal session 观察结果转发到 Slack。

### Discord

价值点：

- 支持 thread isolation。
- 支持 progress embed/card。
- 支持 preview update/delete。
- 支持 command/button interaction。
- cron 主动发送时可解析或创建线程目标。

### Weixin / WeCom

价值点：

- Weixin 基于 ilink 长轮询/接口，维护 sync buffer、context token、typing ticket。
- 支持语音、图片、文件入站和部分出站转换。
- `ReconstructReplyCtx` 可从 session key 主动发消息。
- WeCom 有 WebSocket/aibot 适配，对 req_id 和主动 send 做了区分。

### QQ / QQBot / DingTalk / Line / Weibo

价值点：

- 提供更多平台 session key 和 reply context 设计样本。
- DingTalk 使用 stream client。
- Line/QQ/QQBot/Weibo 对平台事件解析和主动发送做了最小实现，可作为轻量平台模板。

## Bridge WebSocket 协议

Bridge 是 CC Connect 的重要扩展机制：外部平台适配器可以用任意语言通过 WebSocket 动态接入，不需要改 Go 代码或重编译。

配置：

```toml
[bridge]
enabled = true
port = 9810
path = "/bridge/ws"
token = "your-secret"
```

连接流程：

```text
adapter -> cc-connect: WebSocket connect + token
adapter -> cc-connect: register(platform, capabilities, metadata)
cc-connect -> adapter: register_ack
adapter -> cc-connect: message / card_action / preview_ack / ping
cc-connect -> adapter: reply / reply_stream / preview_start / update_message / card / buttons / typing / audio / error
```

能力声明包括：

- `text`
- `image`
- `file`
- `audio`
- `card`
- `buttons`
- `typing`
- `update_message`
- `preview`
- `delete_message`
- `reconstruct_reply`

Bridge 还有 capabilities snapshot：

- host id、hostname、cc-connect version、commit、build time
- 每个 project 可暴露的 builtin/custom commands

迁移价值：Synapse 未来如果要支持外部平台/外部 UI/自动化工具，Bridge 协议比直接内嵌所有平台更可持续。建议将其演化成 Synapse 的“外部连接器协议”。

## Management API 与 Web 管理端

Management API 是 HTTP REST API，默认 `/api/v1`，Bearer token 鉴权，也支持 query token。统一响应：

```json
{"ok": true, "data": {}}
{"ok": false, "error": "message"}
```

核心端点：

- `GET /status`
- `POST /restart`
- `POST /reload`
- `GET /config`
- `GET/PATCH /settings`
- `GET /agents`
- `GET/POST /projects`
- `GET/PATCH/DELETE /projects/{name}`
- `GET/POST /projects/{name}/sessions`
- `GET/DELETE /projects/{name}/sessions/{id}`
- `POST /projects/{name}/sessions/switch`
- `POST /projects/{name}/send`
- `GET/POST /projects/{name}/providers`
- `DELETE/POST /projects/{name}/providers/{provider}`
- `GET/PUT /projects/{name}/provider-refs`
- `GET /projects/{name}/models`
- `POST /projects/{name}/model`
- `GET/POST /projects/{name}/heartbeat/...`
- `GET/POST/PATCH/DELETE /cron`
- `POST /setup/feishu/*`
- `POST /setup/weixin/*`
- `GET/POST/PUT/DELETE /providers`
- `GET /providers/presets`
- `GET/POST /providers/cc-switch`
- `GET /skills`
- `GET /skills/presets`
- `GET /bridge/adapters`

Web 管理端功能：

- 登录页：保存 token。
- Dashboard：状态、项目数、平台连接、Bridge adapter。
- Projects：项目列表、项目详情、平台配置、Feishu/Weixin setup。
- Providers：全局 provider CRUD、preset、cc-switch 导入。
- Skills：按项目展示 skill dirs 和已发现 skills。
- Chat：项目 session 列表、会话详情、发送消息、命令面板。
- Cron：定时任务 CRUD。
- System：配置查看、全局设置、reload/restart。

注意：Web 管理端的实现思路有价值，但 UI 样式不建议照搬到 Synapse。Synapse 当前是 Electron + React + Tailwind + shadcn/ui，且有严格的 UI 纪律，应只迁移功能结构和 API，不迁移它的自定义组件/样式体系。

## Unix Socket API、Webhook 与主动发送

CC Connect 除平台消息入口外，还有多种主动触达入口：

- 本地 Unix socket API：给 `cc-connect send`、`cron`、`relay` 等 CLI 子命令调用。
- Webhook HTTP：外部系统可通过 token 调用项目/session。
- Management API：Web/TUI/GUI 管理。
- Bridge REST：Bridge server 也暴露 session 管理端点。
- Cron/Heartbeat：内部定时触发。

这种“聊天入口 + 主动 API + 定时任务 + 外部扩展”的组合，是 CC Connect 比普通 bot 更有价值的地方。

迁移建议：Synapse 不要只迁移聊天消息通道，还要保留“外部工具主动往某个 session 发消息/附件”的能力。

## 命令系统

内置命令非常丰富，按功能可分为：

- 会话：`/new`、`/list`、`/switch`、`/name`、`/current`、`/history`、`/delete`、`/stop`
- 状态：`/status`、`/usage`、`/whoami`、`/doctor`、`/version`
- Agent 控制：`/model`、`/reasoning`、`/mode`、`/allow`、`/provider`
- 显示/语言：`/lang`、`/quiet`、`/config`
- 记忆：`/memory`
- 自动化：`/cron`、`/heartbeat`、`/compress`
- 自定义：`/commands`、`/skills`、aliases
- 文件/工作目录：`/dir`、`/show`、`/search`、`/shell`、`/diff`
- 平台/系统：`/web`、`/upgrade`、`/restart`
- Relay/Workspace：`/bind`、`/workspace`
- 语音：`/tts`

`CommandRegistry` 支持两类自定义命令：

- config 中的命令：prompt template 或 shell exec。
- Agent command dirs 中的 `*.md` 文件。

Prompt template 支持：

- `{{1}}`
- `{{1:default}}`
- `{{2*}}`
- `{{2*:default}}`
- `{{args}}`
- `{{args:default}}`

没有 placeholder 时，会把 args 追加到 prompt 后面。

迁移价值：Synapse 可以把“命令注册表 + builtin/custom/source + 参数模板”做成统一命令层，用在聊天、命令面板、快捷操作中。

## Skill 系统

`core.SkillRegistry` 会扫描配置目录中的 `SKILL.md`：

- skill 名称来自目录名。
- frontmatter 支持 `name` 和 `description`。
- body 是技能 prompt。
- hyphen 和 underscore 等价，方便 Telegram 等平台命令名兼容。
- 递归扫描目录，也支持目录 symlink，避免循环。
- 结果缓存，可 invalidate。

执行时不会简单展开 prompt，而是构造：

```text
The user is asking you to execute the following skill.
## Skill
## Description
## Skill Instructions
## User Arguments
Please follow the skill instructions above to complete the task.
```

迁移价值：Synapse 已经有 skills/rules 概念，这部分可以直接成为“技能发现和调用 prompt”的参考。

## 权限、安全与用户角色

### allow_from 与 admin_from

平台层通常有 `allow_from`，空值或 `*` 表示允许所有用户。启动时如果未配置会告警。

项目层有 `admin_from`，用于限制高危命令：

- restart
- upgrade
- shell
- config reload
- provider 管理
- delete 等

### UserRoleManager

项目可配置 users/roles：

- 每个 role 有 `user_ids`
- 可禁用命令 `disabled_commands`
- 可设置 role-specific rate limit
- 支持 default role
- 支持 `*` wildcard role
- 校验重复 user、多个 wildcard、default role 不存在等错误

命令禁用支持别名解析和 `*` 通配。

### 权限请求

Agent 发出 `EventPermissionRequest` 后，Engine 会：

- 冻结流式预览，避免用户错过权限提示。
- 根据平台能力发送按钮或纯文本提示。
- 支持 allow、deny、approve all。
- `AskUserQuestion` 会转成结构化问题，支持选项匹配。
- 用户回复后通过 `AgentSession.RespondPermission` 送回 Agent。

### run_as_user

CC Connect 支持项目级 `run_as_user`，用 Unix `sudo -n -iu <target-user> -- command` 启动 Agent。关键设计：

- `-n`：非交互，避免挂住。
- `-i`：使用目标用户登录环境，隔离 HOME、配置、profile。
- `-u`：限定目标用户。
- 不转发 supervisor 环境，只保留最小 allowlist：`LANG`、`LC_*`、`TERM`。
- 每次 spawn 前做 cheap preflight：
  - supervisor 必须能 passwordless sudo 到目标用户。
  - 目标用户不能 passwordless sudo 回 root/高权限。
- positive check 缓存 30 秒。
- `runas_check`、`runas_audit` 有更重的启动前检查和 doctor 能力。

迁移价值：如果 Synapse 要让 Agent 操作真实文件系统，run-as-user 的隔离思路非常有价值。Electron 主进程里也应避免把所有 Agent 都跑在同一个高权限用户环境下。

## 限流、输出节流与敏感词

入站限流：

- 全局 `rate_limit.max_messages/window_secs`
- role-specific rate limit
- per-session/user 限制

出站限流：

- `OutgoingRateLimiter`
- 全局 messages per second / burst
- per-platform override

敏感词：

- `banned_words`
- 命中后直接阻断消息。

迁移价值：聊天入口一定要有入站限流和出站节流，否则接入微信/企业微信/Slack 这类平台时容易触发风控或 API 限制。

## 流式预览与进度展示

`core/streaming.go` 管理流式预览：

- 累积 `EventText`。
- 按 `interval_ms` 和 `min_delta_chars` 节流。
- `max_chars` 只限制中间预览，最终回复尽量完整更新。
- 平台必须支持 `MessageUpdater`。
- 如果支持 `PreviewStarter`，先创建 preview message，再 update。
- 如果支持 `PreviewCleaner`，最终可删除预览并发新消息。
- 权限提示或工具打断时可以 freeze/discard。
- 如果平台编辑消息不触发通知，可用 done reaction 补一个完成提示。

`core/progress_compact.go` 和平台 card/embed 实现负责把 thinking、tool use、tool result 压缩成平台可读的进度卡片。

迁移价值：Synapse 的 UI 有自己的 renderer，但远端平台需要这套“流式更新降级策略”。建议把 preview 独立成一个状态机，而不是写散在平台适配器里。

## Cron 与 Heartbeat

### Cron

`CronJob` 字段：

- `id`
- `project`
- `session_key`
- `cron_expr`
- `prompt`
- `exec`
- `work_dir`
- `description`
- `enabled`
- `silent`
- `mute`
- `session_mode`
- `mode`
- `timeout_mins`
- `created_at`
- `last_run`
- `last_error`

重要行为：

- 用 `robfig/cron/v3`。
- jobs 持久化到 `dataDir/crons/jobs.json`。
- `prompt` 和 `exec` 互斥。
- `silent` 只隐藏开始通知。
- `mute` 隐藏所有消息，用 `mutePlatform` 包装平台。
- `session_mode = new_per_run` 每次任务新建 side session，不影响用户当前会话。
- `mode` 可覆盖权限模式，例如 plan、auto、dontAsk。
- `timeout_mins = nil` 默认 30 分钟，0 表示无限。
- 支持字段级 Update 并必要时 reschedule。
- `CronExprToHuman` 支持中英繁日西多语言人类可读展示。

### Heartbeat

Heartbeat 是项目级周期检查：

- 配置 interval、only_when_idle、session_key、prompt、silent、timeout。
- prompt 为空时读取项目 `HEARTBEAT.md` 或 `heartbeat.md`。
- 再为空使用默认 prompt。
- only_when_idle 时如果 session busy 就跳过并计数。
- 可 pause/resume/set interval/trigger now。
- 状态持久化 `heartbeat_state.json`，只保存 pause 和 interval override。

迁移价值：Cron 更像“用户创建的定时任务”，Heartbeat 更像“项目巡检/保活”。Synapse 迁移时建议分成两个概念，不要混成一个提醒系统。

## Relay：Bot-to-Bot 协作

`RelayManager` 允许同一群聊内多个 project/bot 互相转发问题：

- `RegisterEngine(project, engine)`
- `Bind(platform, chatID, bots)`
- `AddToBind`
- `RemoveFromBind`
- `Send(ctx, RelayRequest)`

绑定持久化到 `relay_bindings.json`。请求包含：

- `from`
- `to`
- `session_key`
- `message`

流程：

```text
源 bot 使用 cc-connect relay send --to target "message"
  -> RelayManager 根据 session_key 解析 platform/chatID
  -> 校验目标 bot 是否在该 chat 绑定
  -> 在群里发送 [from -> to] 可见消息
  -> targetEngine.HandleRelay
  -> 等待目标 Agent 回复
  -> 在群里发送 [target] response
```

`AgentSystemPrompt()` 会告诉 Agent 可用 `cc-connect relay send --to <target_project>` 与其他 bot 通信。

迁移价值：Synapse 可把它升级成“多 Agent 协作任务”能力。关键是 Relay 不直接共享 Agent 状态，而是通过群聊/会话边界传消息。

## Hooks

Hook 事件：

- `message.received`
- `message.sent`
- `session.started`
- `session.ended`
- `cron.triggered`
- `permission.requested`
- `error`

Handler 类型：

- `command`：执行 shell command，事件字段作为 `CC_HOOK_*` 环境变量。
- `http`：POST JSON 到外部 URL。

支持：

- `event = "*"`
- timeout
- async 默认 true

迁移价值：Synapse 后续可以把 hooks 做成自动化集成层，先支持 HTTP，再考虑 shell command。

## Webhook

Webhook 是另一个外部入口，定位比 Management API 更轻：外部系统直接把消息投递到某个 project/session，让 Engine 执行。它适合 CI、监控、自动化脚本触发 Agent。

迁移建议：Synapse 如果实现 webhook，不要直接绕过权限和会话层，应该复用同一套 `SendToSessionWithAttachments`/session 编排逻辑。

## 引用渲染与 `/show`

CC Connect 对 Agent 输出里的本地路径做了专门处理。

解析支持：

- Markdown link：`[name](path)`
- `file://`
- 绝对路径
- 相对路径
- basename 文件名
- `:line`
- `:line:col`
- `:line-line`
- `#Lline`
- `#LlineCcol`

渲染配置：

- `normalize_agents`：例如 codex、claudecode。
- `render_platforms`：例如 feishu、weixin。
- `display_path`：absolute、relative、basename、dirname_basename、smart。
- `marker_style`：emoji、ascii、none。
- `enclosure_style`：code、bracket、angle、fullwidth。

实现细节：

- 跳过 fenced code block。
- 保护 inline code、Web URL。
- 根据 workspaceDir 计算相对路径。
- 同名 basename 多次出现时 smart 模式升为 dirname_basename 或 relative。

`/show` 可以读取文件头部、指定行上下文、行范围或目录列表，并用 code fence 返回。

迁移价值：这对 Synapse 很关键。Agent 经常输出本地路径，UI/聊天平台需要能把路径变成可点击、可预览、可定位的对象。

## 语音、TTS 与音频转换

STT：

- `OpenAIWhisper`：OpenAI-compatible multipart `/audio/transcriptions`
- `QwenASR`：DashScope OpenAI-compatible chat completions，audio base64 data URI
- `GeminiSTT`：Google generateContent inline_data

音频转换：

- `ConvertAudioToMP3`
- `ConvertAudioToOpus`
- `ConvertAudioToAMR`
- `ConvertMP3ToOGG`
- `ConvertMP3ToAMR`
- 用 ffmpeg stdin/stdout 管道。
- 不支持 Whisper 的格式会先转 MP3。

TTS：

- `QwenTTS`
- `OpenAITTS`
- `MiniMaxTTS`：解析 SSE，hex audio chunks。
- `EspeakTTS`
- `PicoTTS`
- `EdgeTTS`

TTS 配置：

- `tts_mode = voice_only | always`
- `voice`
- `max_text_len`
- 平台需要实现 `AudioSender` 才能发送语音。

迁移价值：语音不是优先级最高，但 CC Connect 的 provider 封装和 ffmpeg 转换函数可作为以后迁移参考。

## 卡片系统

`core.Card` 是平台无关的富交互结构，支持：

- header/title/color
- markdown element
- divider
- actions/buttons
- list item
- select
- note

平台能力不足时会降级成纯文本 `RenderText()`。

使用场景：

- help 分组
- model/reasoning/mode 选择
- session list/current/history
- provider 管理
- cron/heartbeat
- delete mode
- doctor/version/upgrade

迁移建议：Synapse renderer 不需要照搬这套卡片视觉，但“平台无关 card schema + 平台渲染器 + 文本 fallback”的思路值得保留。

## Auto Compress 与上下文显示

项目可配置：

- `auto_compress.enabled`
- `max_tokens`
- `min_gap_mins`

Engine 会根据 usage/context 估算，在合适时触发 `/compress`，并消费压缩事件。项目还可配置：

- `show_context_indicator`
- `reply_footer`
- `filter_external_sessions`

Codex/Claude 等 Agent 会补充 usage/context 信息，Engine 在平台回复底部追加模型、reasoning、usage、workdir 等 footer。

迁移价值：Synapse 未来做长会话管理时，需要类似“上下文占用、压缩、隐藏外部 session”的能力。

## Terminal Observer

`core/observer.go` 可以观察本地 Claude Code JSONL session log：

- 扫描 `~/.claude/projects/{projectKey}/*.jsonl`
- 初始 seek 到 EOF，避免重放历史。
- 每 2 秒 poll 新行。
- 解析 user/assistant text，跳过 `entrypoint = sdk-cli` 的 cc-connect 自身会话。
- 转发到实现 `ObserverTarget` 的平台，目前主要是 Slack。

迁移价值：Synapse 可以把它作为“外部 CLI 会话观察/镜像”能力参考，而不是只管理 Synapse 自己启动的 Agent。

## Daemon 与升级

`daemon/` 支持 systemd、launchd、logrotate。`core/updater.go` 和 `/upgrade` 命令提供自升级流程，`/restart` 可优雅退出并 exec 自身。restart 通知通过 `dataDir/run/restart_notify` 跨进程保存。

迁移建议：Synapse 是 Electron app，自升级机制不应直接照搬，但“操作完成后重启并通知原 session”的用户体验值得保留。

## 对 Synapse 的迁移价值排序

### P0：优先迁移/吸收

1. `core.Platform` / `core.Agent` / `core.AgentSession` 的接口边界。
2. `core.Message` / `core.Event` 的统一数据模型。
3. Engine 的会话编排、忙时排队、权限请求、事件消费循环。
4. 多 project + 多 workspace + channel binding。
5. Provider 体系：全局 provider、项目引用、agent-specific overrides。
6. Codex 适配器：尤其 provider config、resume、usage/context、app-server backend。
7. Bridge 协议：外部平台/连接器扩展。
8. Management API 的资源模型和端点划分。

### P1：很值得迁移

1. Cron/Heartbeat 主动任务体系。
2. CommandRegistry 和 SkillRegistry。
3. 流式预览状态机和平台降级策略。
4. 权限按钮/AskUserQuestion 交互。
5. run-as-user 隔离设计。
6. 本地文件引用解析、渲染和 `/show`。
7. Relay 多 Agent 协作。
8. Hooks/Webhook。

### P2：按需求迁移

1. 语音 STT/TTS。
2. Feishu/Telegram/Slack/Discord 等平台完整接入。
3. Daemon/systemd/launchd。
4. Web 管理端页面结构。
5. Auto compress、reply footer、context indicator。

## 可直接复用的设计模式

- 最小核心接口 + optional capabilities。
- Project-scoped Engine，不让所有状态堆在全局单例。
- Agent 事件统一成 `core.Event`，平台输出统一由 Engine 消费。
- SessionKey 作为平台会话主键，AgentSessionID 作为 Agent 后端会话主键，两者分离。
- 配置层使用全局 provider + project provider_refs。
- 外部扩展用 Bridge 协议，不把所有平台都编进主进程。
- 定时任务通过同一个 Engine/session 通路执行，不走旁路。
- 流式预览做成独立状态机，并内置降级。
- 权限请求通过事件流上抛，平台层只负责交互呈现。
- 文件/图片/语音统一附件模型，文件落盘后给 Agent 读。
- 主动发送依赖 `ReplyContextReconstructor`，不假设所有平台都能从 session key 发送。
- 高危命令统一走 admin/role 策略。

## 不建议照搬的地方

- 不要照搬 Web 管理端的自定义 UI 组件和样式。Synapse 应继续使用 shadcn/ui 和现有 Tailwind token。
- 不要把 Engine 的所有命令逻辑集中到一个超大文件。`core/engine.go` 很强，但已经过大；迁移到 Synapse 时应按模块拆分。
- 不要把平台特定文案/卡片直接搬到 renderer UI。Synapse UI 文案要更克制。
- 不要把 Go 的 Unix socket/daemon 设计原样搬进 Electron。Electron 应通过主进程服务和 typed preload API 暴露能力。
- 不要一次性迁移所有平台。先迁移抽象和 Codex/Claude 类 Agent，再逐个平台补。
- 不要把 provider 兼容逻辑写进页面组件。应该放主进程服务或 agent/provider 层。

## 建议的后续迁移拆分

### 阶段 1：建立 Synapse 内部模型

- 定义 Synapse 版 `AgentSession`、`AgentEvent`、`PlatformMessage` 或等价类型。
- 明确 `sessionKey`、`agentSessionId`、`workspaceId` 的关系。
- 把 CC Connect 的 `core.Message`、`core.Event` 字段映射到 Synapse 现有类型。

### 阶段 2：Codex/Claude 会话适配

- 优先读并迁移 `agent/codex` 中的 resume、provider config、usage/context。
- 再评估 `agent/claudecode` 的 permission 和 system prompt 注入。
- 把 provider 选择、model/reasoning/mode 做成主进程服务，不直接写进 React。

### 阶段 3：会话编排与权限

- 实现每 session 的 busy lock、消息队列、stop、permission pending state。
- 支持权限请求在 Synapse UI 内显示，并能回写 Agent。
- 实现 AskUserQuestion 的结构化交互。

### 阶段 4：Workspace 绑定

- 迁移 workspace binding 思路，建立 channel/workspace/session 的持久映射。
- 如果 Synapse 后续接聊天平台，这层会直接复用。

### 阶段 5：命令与技能

- 抽象 builtin commands、custom commands、skill invocation。
- 把命令暴露给 Synapse 命令面板/聊天输入。
- 支持 prompt template 占位符。

### 阶段 6：主动任务

- 实现 cron-like scheduled job。
- 实现 heartbeat/project check。
- 再接 webhook/hook。

### 阶段 7：外部连接协议

- 基于 Bridge 设计 Synapse connector protocol。
- 先支持 text/reply/session 管理，再补 card/buttons/preview/audio。

### 阶段 8：平台接入

- 优先迁移最相关的平台或 Bridge 外接平台。
- 平台能力按 optional capabilities 增量实现。
- 所有平台先保证 text + reconstruct reply，再补文件、图片、按钮、流式预览。

## 迁移时的推荐源码入口

如果后续 AI 工具要继续读源码，建议按下面顺序，不要从全仓库随机扫：

1. `core/interfaces.go`
2. `core/message.go`
3. `core/session.go`
4. `core/engine.go` 的 struct、`handleMessage`、`processInteractiveMessageWith`、`processInteractiveEvents`
5. `config/config.go` 的 Config structs、`Load`、`ResolveProviderRefs`、保存/patch 函数
6. `agent/codex/codex.go`
7. `agent/codex/session.go`
8. `agent/codex/appserver_session.go`
9. `agent/codex/provider_config.go`
10. `agent/claudecode/claudecode.go`
11. `agent/claudecode/session.go`
12. `agent/acp/agent.go`
13. `agent/acp/session.go`
14. `core/command.go`
15. `core/skill.go`
16. `core/streaming.go`
17. `core/cron.go`
18. `core/heartbeat.go`
19. `core/bridge.go`
20. `core/management.go`
21. `platform/telegram/telegram.go` 或 `platform/feishu/feishu.go` 作为平台样板

## 结论

CC Connect 的核心价值是一个成熟的“远端消息平台到本地/远端 Agent 会话”的编排内核。它的 UI 和具体平台实现可以分阶段迁移，但抽象层、会话层、权限层、provider 层、Bridge 协议和主动任务体系应该优先吸收。

对 Synapse 来说，最合理的迁移路线不是复制 CC Connect，而是把它拆成几个可进入现有 Electron 架构的服务：

- Agent runtime service
- Session orchestration service
- Provider service
- Command/Skill service
- Scheduler service
- Connector/Bridge service
- Renderer-side management UI

这样既能保留 CC Connect 的工程价值，又不会破坏 Synapse 当前的 shadcn/Tailwind UI 基线和主进程/渲染进程边界。
