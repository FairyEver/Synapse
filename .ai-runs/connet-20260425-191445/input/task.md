---
schema_version: 1
task_id: connet
title: "Synapse 全量融合 CC Connect 开发方案"
project_root: /Users/liyang/Documents/code/github/Synapse

mode: unattended
language: zh-CN

git:
  base_branch: "main"
  work_branch: codex/unattended-connet
  commit_policy: commit_per_task
  pre_run_snapshot: require_clean
  push_allowed: false

risk_budget:
  allow_dependency_install: false
  allow_schema_migration: false
  allow_destructive_file_ops: false
  allow_dev_server: false
  allow_gui_smoke_test: false
  allow_network_access: false
  allow_commit: true
  allow_push: false

limits:
  max_task_attempts: 3
  max_audit_rounds: 10
  heartbeat_interval_seconds: 60

gates:
  typecheck: "pnpm desktop:typecheck"
  test: "pnpm desktop:test"
  lint: "pnpm desktop:lint"
  build: "pnpm desktop:build"
---

# 无人值守任务模板

## 1. 背景

当前 Synapse 已具备规则、Skill、Prompt、数据库、IDE、设置等基础模块，但还缺少统一的 Agent 会话运行层、远程连接中枢、自动化调度和 Provider/权限治理闭环。上游 CC Connect 已沉淀出平台连接、Agent 编排、命令、权限、Cron、Heartbeat、Bridge、Webhook、Management API 等用户可见能力，本任务要把这些能力按 Synapse 现有 Electron + React + shadcn + Phase 0 runtime 架构逐步融合进来。

融合方式必须是追加式、分阶段、可验证的重建：保留当前 Synapse 模块和数据边界，不迁移 CC Connect Web UI，不把 CC Connect Go 实现整体嵌入，不破坏现有规则、Skill、Prompt、数据库、IDE、设置、仓库和身份体系。

## 2. 目标


本方案用于指导把 CC Connect 的全部用户可见能力融合进当前 Synapse。融合后的产品目标是：

```text
Synapse = Agent 控制台 + 远程连接中枢 + 自动化调度器 + 规则/技能资产库
```

本方案的覆盖口径：

- 对 `产品设计.md` 第 2 章硬性覆盖范围和第 9 章全功能映射表逐项给出落点。
- 对 `功能覆盖.md` 的侵入性边界逐项遵守：追加式扩展，不替换现有规则、Skill、Prompt、数据库、IDE、设置、仓库、身份体系。
- 对 `架构方案.md` 的核心抽象逐项吸收：平台接口、Agent 接口、统一消息模型、Engine 编排、Provider、多项目多工作区、Bridge、Management API、命令、Skill、权限、Cron、Heartbeat、Relay、Hooks、文件引用、语音、Terminal Observer。
- 对 `约束与风险.md` 的迁移原则逐项落实：先模型后功能、特权逻辑在主进程、UI 只迁移信息架构、每阶段有可验收闭环。

本方案不做代码实现，不启动 dev server，不迁移 CC Connect Web UI，不把 CC Connect Go 代码作为子进程整体嵌入。

完成后 Synapse 的产品结构是：

```text
内容资产层
  Rule / Skill / Prompt / Command

Agent 运行层
  本地会话 / 远程会话 / Agent Runtime / Provider / 权限

连接与自动化层
  平台连接 / Bridge / Webhook / 本地 API / Cron / Heartbeat / Relay / Hooks / Outbox

治理层
  项目 / 工作区 / 安全 / 审计 / Doctor / 日志 / 更新 / Management API
```

工程结构是：

```text
React modules 只负责展示和交互
Typed preload 只暴露窄能力
IpcModule 负责校验和分发
Electron services 负责业务能力
Runtime infrastructure 负责服务、网络、权限、事件、数据、调度
```

这条路线能完整覆盖 CC Connect 的功能，同时保持 Synapse 当前 Electron、React、Tailwind、shadcn、Phase 0 runtime 架构不被破坏。

## 3. 非目标

- 不启动 dev server，不做浏览器/GUI 预览验证，除非用户之后明确授权。
- 不安装新依赖；确需依赖的阶段先标记 deferred 并写入报告。
- 不做数据库破坏性迁移，不删除或重写现有用户数据。
- 不迁移 CC Connect Web UI，不照搬其视觉风格。
- 不把 CC Connect Go 代码作为子进程整体嵌入。
- 不替换现有规则、Skill、Prompt、数据库、IDE、设置、仓库、身份体系。
- 不直接暴露 `ipcRenderer`、`window.require`、裸 Electron API 或完整 Provider 密钥给 renderer。
- 不绕过 `ServiceRegistry`、`IpcModule`、`DataRepository`、`EventBus`、`PermissionGuard`、`NetworkServiceRegistry` 等既有边界。

## 4. 输入文档


- 上游任务 Markdown: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/开发方案.md`
- SPEC: `null`
- 项目约束: `/Users/liyang/Documents/code/github/Synapse/AGENTS.md`
- 设计规则: `/Users/liyang/Documents/code/github/Synapse/.claude/rules/design.md`
- UI 规则: `/Users/liyang/Documents/code/github/Synapse/.claude/rules/ui-rules.md`
- 其他参考: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/产品设计.md`, `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/功能覆盖.md`, `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/架构方案.md`, `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/约束与风险.md`

## 4.1 上游 Markdown 合并摘要


- 来源: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/开发方案.md`
- 来源标题: Synapse 全量融合 CC Connect 开发方案
- 合并时间: 2026-04-25T19:08:48+08:00
- 合并状态: draft_merge
- 说明: 已根据常见 Markdown 标题试填模板章节；请继续由 Codex 和用户确认目标、范围、验收标准、风险预算和 gates。

## 5. 允许修改范围

- `/Users/liyang/Documents/code/github/Synapse/desktop/src/types/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent-sessions/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent-projects/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/connectors/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/automation/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/settings/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/rules/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/skills/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/prompts/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/editor-scan/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/App.tsx`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/app-shell/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/components/ui/`，仅在缺少官方 shadcn primitive 且必须补齐时修改。
- `/Users/liyang/Documents/code/github/Synapse/desktop/src/types/bridge.ts`
- `/Users/liyang/Documents/code/github/Synapse/desktop/electron/modules/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/electron/services/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/electron/bootstrap/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/electron/preload.ts`
- `/Users/liyang/Documents/code/github/Synapse/desktop/electron/runtime/`，仅限接入既有扩展点所需的最小改动，禁止把业务逻辑放入 runtime。
- `/Users/liyang/Documents/code/github/Synapse/desktop/tests/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/scripts/`，仅限 IPC/codegen/check 脚本必须适配时修改。
- `/Users/liyang/Documents/code/github/Synapse/.ai-runs/` 和本 run 生成的报告、状态、日志文件。

## 6. 禁止修改范围

- `/Users/liyang/Documents/code/github/Synapse/.git/`
- `/Users/liyang/Documents/code/github/Synapse/node_modules/`
- `/Users/liyang/Documents/code/github/Synapse/desktop/node_modules/`
- `/Users/liyang/Documents/code/github/Synapse/pnpm-lock.yaml`，除非用户之后明确允许安装或变更依赖。
- `/Users/liyang/Documents/code/github/Synapse/package.json` 和 `/Users/liyang/Documents/code/github/Synapse/desktop/package.json` 的依赖字段，除非用户之后明确允许新增依赖。
- `/Users/liyang/Documents/code/github/Synapse/website/`
- `/Users/liyang/Documents/code/github/Synapse/design.pen`
- `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/` 下的上游方案文档，默认只读。
- 任何用户数据、密钥、系统目录或仓库外文件。
- 任何未列入允许范围且与本任务阶段无直接关系的代码、文档和配置。

## 7. 任务拆分要求


1. 垂直叠加，不横向替换。
   当前 6 个顶层模块全部保留，只新增“会话 / 项目 / 连接 / 自动化”四个顶层入口，并在既有模块上追加 Agent 运行时能力。

2. 吸收架构，重建服务。
   CC Connect 的 Go Engine 不能逐行翻译成 TypeScript 巨型服务。Synapse 侧按当前 Phase 0 runtime 拆成多个主进程服务，通过 `ServiceRegistry`、`ProjectContainer`、`IpcModule`、`EventBus`、`DataRepository`、`PermissionGuard`、`NetworkServiceRegistry` 组合。

3. 主进程承载特权能力。
   Agent 子进程、Provider 密钥、文件读写、平台 SDK、Bridge/Webhook/Management API、Cron/Heartbeat、run-as-user、STT/TTS 转码全部在 `desktop/electron/`。Renderer 只通过 `window.synapse.*` 的 typed preload API 交互。

4. 统一模型先于功能。
   先定义 `SessionKey`、`AgentSessionId`、`ConversationId`、`WorkspaceId`、`ProviderProfile`、`ConnectorCapability`、`AgentEvent`，再做 Codex、Claude、平台、Cron、Relay 等功能。

5. 每阶段必须闭环。
   每个阶段都要能从 UI 或 IPC 发起操作、进入主进程服务、持久化状态、返回事件、可测试验证。禁止只铺接口不打通端到端。

6. UI 使用 Synapse 当前基线。
   继续使用 `desktop/components.json` 的 `radix-nova`、neutral、CSS variables、Radix/shadcn。禁止照搬 CC Connect Web UI、自定义色、渐变、营销文案、卡片套卡片。

目标：

- 固定所有核心类型、namespace、service id、IPC namespace。
- 给第 9 章功能映射表补 `phase`、`service`、`UI`、`test` 四列。

改动范围：

- `desktop/src/types/agent-runtime.ts`
- `desktop/src/types/agent-projects.ts`
- `desktop/src/types/providers.ts`
- `desktop/src/types/connectors.ts`
- `desktop/src/types/scheduler.ts`
- `desktop/electron/services/*/types.ts`

验收：

- 类型可以通过 `pnpm desktop:typecheck`。
- 不新增 UI 功能，不影响现有模块。

目标：

- fake Agent runtime。
- Codex runtime 最小 Send/resume/stop。
- 会话页最小 UI：新建、发送、事件流、停止。
- AgentEvent 持久化。

主进程：

- `agent-runtime`
- `agent-sessions`
- `agent-projects` 最小项目模型。

Renderer：

- `agent-sessions` 模块。
- 顶层“会话”入口。

验收：

- 用户能在 Synapse 创建一个本地 Codex 会话。
- 能看到流式文本、result、error。
- 能停止当前 turn。
- fake runtime 单测覆盖事件流。

测试：

- session manager。
- event normalization。
- busy queue。
- `pnpm desktop:typecheck`。

目标：

- 全局 Provider CRUD。
- cc-switch 导入。
- provider presets。
- 项目 provider refs。
- Codex provider config。
- 模型切换和 active provider 持久化。

主进程：

- `providers`
- `agent-projects`
- provider resolve。

Renderer：

- 设置 -> Provider。
- 项目 -> Provider tab。
- 会话新建表单选择 Provider/模型。

验收：

- 能导入 cc-switch provider。
- 能绑定到项目。
- 新建 Codex 会话时使用 resolved provider。
- renderer 不接触完整 API key。

测试：

- provider resolve。
- provider 删除引用处理。
- cc-switch import parser。
- masked secret response。

目标：

- named sessions。
- `/new /list /switch /name /current /history /delete /stop`。
- busy lock 和队列。
- permission_request 和 AskUserQuestion。
- 基础命令面板。

主进程：

- `session-orchestrator`
- `commands`
- `audit`

Renderer：

- 会话列表、检查器、权限面板、命令面板。

验收：

- 连续发送消息按队列处理。
- Agent 权限请求在 UI 可见且可回写。
- 会话可新建/切换/命名/删除/停止。

测试：

- fake permission request。
- AskUserQuestion。
- queue 上限。
- audit 记录。

目标：

- 项目页。
- 多 workspace。
- channel/workspace binding 数据模型。
- `/dir /show /search /diff /memory`。
- context indicator、reply footer、auto compress 元数据。

主进程：

- `agent-projects`
- `references`
- `agent-sessions` 工作区作用域。

Renderer：

- 项目模块。
- 会话文件面板。

验收：

- 用户能把本地路径配置成 Agent project。
- workspace 独立保存会话。
- Agent 输出路径可点击预览。
- `/show /search /diff` 可返回结构化结果。

测试：

- workspace binding。
- reference parser。
- `/show` 文件/目录边界。
- diff parser。

目标：

- 规则安装到 Agent 项目。
- Skill `SKILL.md` frontmatter、skill dirs、presets。
- Prompt 作为会话模板、命令模板、Cron/Heartbeat prompt。
- custom prompt command、alias。
- shell command 保持关闭或强确认。

主进程：

- `skill-runtime`
- `commands`
- 与现有 content services 集成。

Renderer：

- 现有规则/Skill/Prompt 模块追加运行时引用状态。
- 会话输入框命令面板。

验收：

- Skill 可扫描、可调用、可在会话中形成标准 prompt。
- Prompt 可作为命令模板调用。
- shell command 不会默认暴露给远程或普通角色。

测试：

- skill discovery。
- prompt template expansion。
- command source 和 alias。

目标：

- Cron。
- Heartbeat。
- Webhook。
- 本地 API / CLI send。
- Outbox。

主进程：

- `scheduler`
- `connectors/webhook`
- `connectors/local-api`
- `outbox`

Renderer：

- 自动化 -> Cron、Heartbeat、Outbox。
- 连接 -> Webhook、本地 API。

验收：

- app 运行期间 Cron 可触发 Agent。
- Heartbeat 可读取 `HEARTBEAT.md` 或默认 prompt。
- Webhook 可投递到指定项目/session。
- 所有主动发送进入 Outbox。

测试：

- scheduler job state。
- timeout/mute/silent/new_per_run。
- webhook token/scope。
- outbox retry。

目标：

- Bridge WebSocket server。
- register + capabilities。
- message -> session。
- reply/error/ping/pong。
- adapters 管理 UI。

主进程：

- `connectors/bridge`
- `NetworkServiceRegistry`
- `PermissionGuard`

Renderer：

- 连接 -> Bridge。
- 会话远程来源展示。

验收：

- 外部 adapter 可注册。
- adapter 发 text message 后 Synapse 产生远程会话。
- Agent 回复可发回 adapter。
- token 鉴权失败被拒绝并审计。

测试：

- fake WebSocket adapter。
- capability snapshot。
- reconstruct_reply false 降级。

目标：

- 选择 Telegram 或 Slack 做第一原生平台。
- 增加附件、typing、preview、buttons 的 capability。
- 再接 Feishu/Lark 扫码和富卡片。
- 再接 Discord。

主进程：

- `connectors/platforms/<platform>`
- platform message normalizer。
- platform renderer/fallback。

Renderer：

- 连接 -> 平台连接向导。
- 能力矩阵。
- 远程会话镜像和接管。

验收：

- 远程用户发消息后 Synapse 会话中心可见。
- 权限请求在本地和平台端都可处理或降级展示。
- 结果可回发平台。

测试：

- fake platform adapter。
- message length/format fallback。
- preview freeze on permission。

目标：

- Relay bindings。
- Hooks HTTP。
- command hooks 延后启用。
- Management API 默认关闭。
- Dashboard/Doctor。

验收：

- 多 Agent Relay 可在同一群/频道转发问题和回复。
- Hook HTTP 可接收 lifecycle event。
- Management API 通过 token 管理项目/会话/provider/cron/bridge。
- Doctor 可诊断 Agent CLI、Provider、平台、Bridge/Webhook、ffmpeg、run_as_user。

测试：

- relay routing。
- hook timeout/async。
- management API auth。
- doctor checks。

目标：

- 补齐 DingTalk、WeCom、Weixin、QQ、QQBot、Line、Weibo。
- STT/TTS。
- Terminal Observer。
- run_as_user。
- Auto compress 完整化。
- Upgrade/Restart 桌面化。

验收：

- 11 个平台均有连接入口、capability、降级策略。
- 11 个 Agent 均有 runtime 或协议型适配入口。
- 语音入站可转文字，TTS 可按 voice_only/always 发送。
- Terminal Observer 可镜像本地 Claude Code JSONL。
- run_as_user preflight、doctor、audit 完整。

测试：

- 平台能力矩阵快照。
- ffmpeg 缺失降级。
- run_as_user preflight。
- observer skip 自身会话。

每个阶段开工前：

- 是否只改该阶段必要文件。
- 是否已有类型和数据版本。
- 是否明确主进程/renderer/preload 边界。
- 是否复用 `ServiceRegistry`、`IpcModule`、`DataRepository`、`EventBus`、`PermissionGuard`。
- 是否没有新增平行架构。
- 是否没有直接 `ipcMain.handle/on`、`webContents.send`、裸 `http/net/https.createServer`、业务 `fs.writeFile`。
- 是否避免新增依赖，若必须新增，是否有阶段理由和替代评估。
- UI 是否已遵守 `.claude/rules/design.md` 和 `.claude/rules/ui-rules.md`。

每个阶段完成前：

- 跑 `pnpm desktop:typecheck`。
- 涉及 runtime 硬约束时跑 `pnpm desktop:check:hard-constraints`。
- 涉及 IPC 时跑 `pnpm desktop:generate:ipc` 和 `pnpm desktop:check:ipc-codegen`。
- 涉及服务行为时补单元测试。
- 涉及端到端编排时用 fake Agent/fake connector 做集成测试。
- 不启动 dev server，不打开浏览器，除非用户明确要求。

## 8. 验收标准


全量融合完成时必须满足：

1. 用户能在 Synapse 中直接创建 Codex、Claude Code、Cursor 等本地 Agent 会话。
2. 用户能导入 cc-switch Provider，并绑定到项目。
3. Rule、Skill、Prompt 能作为 Agent 运行时资产使用。
4. 会话中心能统一展示本地、远程、定时、Relay、Webhook 会话。
5. 远程平台消息能创建或恢复 session。
6. Synapse 能观察和接管远程会话。
7. 权限请求不会丢失，能在本地 UI 和支持的平台端处理。
8. Cron、Heartbeat、Webhook、本地 API 都复用同一套会话和权限模型。
9. Bridge adapter 能用 capabilities 接入，并按能力降级。
10. 11 个平台和 11 个 Agent 都有明确入口、状态、错误和降级策略。
11. 附件、语音、文件引用、diff、流式预览、卡片按钮都有统一模型。
12. 所有高危操作都有权限、审计、错误摘要。
13. Provider 密钥不进入 renderer 长期状态，日志和导出默认脱敏。
14. `pnpm desktop:typecheck`、`pnpm desktop:check:hard-constraints`、相关单元/集成测试通过。
15. UI 不出现 CC Connect Web 风格、自定义色、渐变、卡片套卡片、界面废话。

每个阶段开工前：

- 是否只改该阶段必要文件。
- 是否已有类型和数据版本。
- 是否明确主进程/renderer/preload 边界。
- 是否复用 `ServiceRegistry`、`IpcModule`、`DataRepository`、`EventBus`、`PermissionGuard`。
- 是否没有新增平行架构。
- 是否没有直接 `ipcMain.handle/on`、`webContents.send`、裸 `http/net/https.createServer`、业务 `fs.writeFile`。
- 是否避免新增依赖，若必须新增，是否有阶段理由和替代评估。
- UI 是否已遵守 `.claude/rules/design.md` 和 `.claude/rules/ui-rules.md`。

每个阶段完成前：

- 跑 `pnpm desktop:typecheck`。
- 涉及 runtime 硬约束时跑 `pnpm desktop:check:hard-constraints`。
- 涉及 IPC 时跑 `pnpm desktop:generate:ipc` 和 `pnpm desktop:check:ipc-codegen`。
- 涉及服务行为时补单元测试。
- 涉及端到端编排时用 fake Agent/fake connector 做集成测试。
- 不启动 dev server，不打开浏览器，除非用户明确要求。

## 9. 风险点


| 风险 | 控制 |
| --- | --- |
| TypeScript 巨型 Engine | 按服务拆分，Agent、Session、Provider、Connector、Scheduler 分离 |
| 会话 ID 混淆 | 阶段 0 固定 SessionKey、ConversationId、AgentSessionId |
| 权限请求丢失 | AgentEvent 必须包含 permission_request，UI 和平台都订阅 pending state |
| 子进程泄漏 | AgentRuntime 统一持有 AbortController、进程句柄、stop/cancel |
| Provider 密钥泄露 | 密钥只在主进程，renderer 只显示 masked 状态 |
| 平台依赖膨胀 | 先 Bridge，再一个原生平台，SDK 分阶段引入 |
| 定时任务误解 | 第一版明确只保证 app 运行期间，后续再做系统级后台策略 |
| 远程 shell 失控 | shell command 默认关闭，role/admin/PermissionGuard/audit 四层控制 |
| UI 失控 | 使用 shadcn 组件和 token，不迁移 CC Connect Web UI |
| 旧数据污染 | 新 namespace 与现有 config/data-store 正交，迁移脚本可重复 |

## 10. Blocked 策略

单任务失败 3 次后标记 blocked，写入报告，继续后续任务。需要被禁用能力支持的任务应 deferred，不要硬做。

## 11. 最终产物

- `reports/COMPLETION-REPORT.md`
- `reports/SELF-AUDIT.md`
- `reports/FOLLOW-UP-PLAN.md`
- `state/PROGRESS.md`
