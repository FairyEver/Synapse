# 自动化 Claude Code 执行器设计

日期：2026-11-05。状态：待用户确认；仅设计，尚未实现。

已完成独立实施可行性审阅，未发现必须补充的产品决策；该审阅不等于真实 CLI 或界面验收。

## 目标与已确认的行为

在自动化中新增独立的「Claude Code」执行器。其行为等效于用户在某个项目旁按住 Command 点击「＋」启动内置 Claude Code，再提交一段提示词，但整个启动过程在后台完成。

用户已确认：

- Claude Code 启动并成功提交提示词后，自动化即完成，不等待模型回复或任务处理结束。
- 终端会话保留，用户可查看过程、接手和继续交互。
- 沿用执行当时默认的供应商、模型和权限模式，不在自动化中单独配置。
- 保持用户当前页面，不抢焦点；用户需要时从运行记录进入关联终端。
- 采用独立执行器，与现有「Agent」并列。

每次独立触发创建一个新会话，不复用前次会话。自动化成功仅表示启动与提示词投递完成，不表示 Claude Code 已完成用户任务。

## 范围与非目标

配置仅包含项目和提示词；复用现有触发器、两步编辑器、触发变量替换、调度和运行记录协议。

不增加供应商、模型、权限、会话复用或任务处理超时配置。不恢复已移除的命令、Shell、HTTP、工作流、JavaScript、Node.js 自动化执行器。不建立 Agent Runtime 对话，不同步 CLI 回复、费用或任务结果到 Agent 对话或自动化历史。不自动审批 CLI 提问、信任或权限请求。

保留会话指自动化结束后不关闭终端，不改变终端既有重启、归档、关闭及历史保留行为；不承诺重启应用后恢复仍在运行的 CLI 进程。

## 方案比较与选择

| 方案 | 收益 | 代价 | 决定 |
| --- | --- | --- | --- |
| 新增独立「Claude Code」执行器 | 配置只有项目与提示词，完成条件和终端入口明确；可复用手动启动路径 | 增加执行器注册、表单和结果视图 | 用户已选择 |
| 现有「Agent」增加终端模式 | 共用部分配置和注册 | 同一执行器内有不同配置、完成条件、结果入口与生命周期 | 不采用 |

首条提示词采用 CLI 原生交互式启动参数传入，沿用统一内置 CLI 启动入口；不用后台 SDK 的单次查询替代交互式终端，也不通过固定延迟后模拟键入与回车投递。

### 启动就绪与首条提示词

2026-11-05 补充核对：仓库当前安装的 SDK 为 `0.3.278`，其内置 Claude Code 为 `2.1.278`。已仅执行该内置二进制的 `--version` 和 `--help`，帮助明确声明 `claude [options] [command] [prompt]`、默认启动交互式会话，`prompt` 为首条提示词；与官方 CLI reference 一致。尚未启动真实交互会话或发送模型请求。

本次无需由 Synapse 先等待终端输入框就绪，再把提示词写入 PTY。启动时将整段提示词作为一个独立 argv 参数交给 CLI，初始化和首条提示词处理的顺序由 Claude Code 自己管理。示意命令为 `claude "提示词"`；实际实现继续使用现有内置可执行文件、settings、模型和权限参数，以 argv 数组启动，不拼 shell 命令。

启动流程为：准备关联与回执观察 → 携带首条提示词启动交互式 CLI → CLI 自行初始化 → 收到对应首条 `UserPromptSubmit` 回执 → 自动化成功，CLI 保持运行。

`SessionStart` 只作为启动阶段的可选诊断，不能把该 Hook 的触发当成完整初始化结束、所有启动 Hook 完成或终端输入框可用的保证；不在收到它后模拟回车或重复发送启动参数里已有的提示词。SDK 的程序化查询与 CLI 的 `--print` / streaming JSON 不作为本次交互终端的输入协议。

首次使用、登录、项目信任确认或用户自定义启动 Hook 可能阻碍 CLI 继续启动；携带初始参数不代表能绕过这些阶段。没有首条提交回执就不得成功，按本设计的确认超时处理并保留终端供接手。

## 配置与注册

建议稳定类型 ID 为 `builtin.claude-code`，显示名称为 `Claude Code`。该 ID 为设计建议，实施前核对不存在冲突。

配置为 `{ projectId, prompt }`。项目使用现有项目选择器，提示词使用现有文本输入和触发变量约定。校验项目、目录可用性，以及变量展开后的提示词非空；不接受配置中额外的凭据、路径或启动参数覆盖。

主进程与 Renderer 注册同一 manifest/schema。MCP 复用现有自动化执行器发现和任务管理工具，发现结果新增该类型；不新增专用 MCP 工具、Workflow Node、Deep Link、System App 或 Dock 入口。

现有自动化旧配置清理按「不是 `builtin.agent`」删除配置，必须同时调整 Worker 筛选、主进程变更监听和仓库写队列复验，统一保留 `builtin.agent` 与新增类型。不能只修改 UI 或只改 Worker。其余已退役类型继续按原流程清理，运行历史不删除；包括无效配置在内的两个受支持类型均保留，以便用户修复。

## 启动与完成协议

1. 自动化创建运行记录，校验配置、展开提示词，并经既有 PermissionGuard/AuditSink 授权。
2. 通过现有 `createClaudeCodeTerminalSession` 统一入口解析项目、默认供应商与模型、默认权限模式及内置 runtime；不复制这些默认选择逻辑。
3. 创建项目分组下的新终端及关联标签，在 PTY 启动前建立运行与终端的关联。
4. 以原生交互式 CLI 携带首条提示词启动。保留临时 settings、Provider 环境优先级、原生配置和现有通知 Hook 组合规则。
5. 在有界等待内收到与本次启动匹配的首条 `UserPromptSubmit` 回执，记为 `success`，保存终端定位信息，释放本次等待资源。进程后续继续运行。

“已提交”的精确定义为：CLI 已接收首条提示词，并触发原生 `UserPromptSubmit` 生命周期；不等待模型请求、回复或工具执行。该事件发生在模型处理之前，不保证其他用户 Hook 放行或模型服务可用。这些后续情况由 CLI 自身呈现，自动化结果不随之改变。

不能以创建记录、PTY spawn 成功、写入 PTY 成功或固定等待时间代替提示词提交回执。也不能等 Claude Code 进程退出才结束自动化。

## 独立提交回执（工程建议，待随设计确认）

现有 Agent 原生通知 Hook 受通知总开关、运行时和 ingress 就绪状态控制，且是可选能力。自动化的提交回执必须独立于这些开关，不得为了自动化强制开启用户通知。

建议在本次启动已有的临时 settings 目录中放置受控的一次性 Hook 与回执文件，通过 `UserPromptSubmit` Hook 写入最小回执，主进程有界观察并确认。无需另开端口或读取 Claude Code transcript。具体文件名、观察实现及跨平台 Hook 启动封装由实施者沿用现有工具确定，但必须满足：

- 主进程在启动前准备本次回执观察，避免首条提交先于监听。
- 随机启动标识绑定本次 run/session，仅匹配预期的首条提示词；可以在内存中使用提示词摘要，禁止记录或持久化提示词摘要。
- 回执只包含本次标识和事件等最小元数据，不包含提示词、Provider 凭据、环境变量或 transcript 路径。
- Hook 保留用户和现有 Synapse Hook，不增加阻断、自动审批或提示词改写；不把本次业务回执依赖到通知服务的开启状态。
- Hook 文件只要仍被会话 settings 引用，就保留到会话结束；一次性确认完成后，后续输入执行该 Hook 应无害返回，不再影响已结束的自动化，也不能因文件提前清理而向用户报错。
- Hook 输入限长、有超时；不将 stdin、命令、临时路径或原始错误正文写入诊断日志。
- 完成或失败后关闭观察与等待；可清理一次性回执材料，但不能提前删除仍由 CLI 使用的 settings。临时启动目录继续沿用会话结束后的清理及遗留目录回收机制。
- 需要新增打包 runtime 文件时，同步执行正式包结构检查；不能依赖源码目录、系统安装的 Node/Claude 或开发机特有的命令。

启动确认预算建议固定为 60 秒，不在 UI 增加配置；它只限制启动与提交确认，不限制 CLI 后续任务时间。该时长是工程建议。

## 失败、取消与重复执行

- 项目失效、目录不存在、没有可用默认模型、runtime 缺失、授权拒绝或启动明确失败，记为失败并提供可操作的错误说明。
- 等待回执超时使用既有 `timeout` 状态，明确表示「未确认提示词提交」，不能声称提示词肯定没执行。
- 提交确认前取消使用既有 `cancelled` 状态。已创建的终端关联仍保存，供用户进入核实；不自动重发提示词、不创建替代会话，也不强行关闭状态不确定的终端进程。
- 确认回执后，释放自动化对 CLI 的取消控制。关闭、停用或删除自动化不结束已启动的终端，自动化的停止操作不作为后续 CLI 的停止入口。
- 终态只能提交一次。超时、取消、进程退出与迟到回执竞争时，不能改写已经结束的运行记录；迟到回执不触发重试。
- 既有调度及同一自动化的运行互斥维持原协议。启动阶段完成后，下一次独立触发可以创建另一终端，即便上次 CLI 仍在处理；用户可同时拥有多个会话。
- 不增加启动失败后的自动重试或退出后的自动重启。既有调度补跑仍按原规则作为独立触发执行；不能把同一条运行的不确定提交当作补跑重发。

## 运行记录与终端定位

运行结果保存 `projectId`、`sessionId` 和可用的 `workspaceId`，用于现有终端导航；有终端关联的失败、超时或取消记录也可提供入口。不保存提示词正文的额外副本、凭据、settings 路径、进程环境或回复内容。执行耗时仅为启动与投递耗时，不显示 CLI 后续费用或完成耗时。

结果摘要使用「已启动 Claude Code 并提交提示词」。提供标准尺寸的「打开终端」按钮，仅用户主动点击时复用主窗口导航定位准确会话和分屏。

导航前按会话 ID 校验当前可用状态和归属，不以项目首个标签或当前标签代替目标。会话仍可查看但进程已结束时按终端现有能力打开；已删除或重启后不可用时显示「终端会话已不可用」，不自动创建新终端、恢复 CLI 或再次提交提示词。

后台启动不得调用聚焦、窗口显示或导航接口。无论用户当前在其他应用还是 Terminal，都保持当前应用、标签、分屏与输入焦点。现有手动启动的跳转行为保持不变。

## 权限、存储与规则同步

新增执行器沿用 `agent.spawn` 的 PermissionGuard 与 AuditSink；受控 PTY、临时 Hook 运行和文件操作遵守现有基础设施的安全边界，不绕过现有工具审批，也不改写用户全局配置。

共用启动入口须支持调用来源传递，使自动化审计正确归因到 automation/run，不能把自动触发伪装成 Renderer 手动点击；现有手动与手机入口的归因保持原约定。

凭据由主进程构造，沿用临时 Provider 环境与 settings 覆盖，不向 Renderer/MCP 返回或写入终端持久化记录。业务配置和运行结果走原 DataRepository；一次性启动回执属于临时进程通信材料，不形成第二套业务存储。

实施时同步更新 `docs/agents/module-boundaries.md` 的“仅 Agent”边界、`docs/agents/capability-registry.md` 的 Automation Action 清单与数量、系统 Skill 包及相关 Agent 指南，并更新 `RELEASE_NOTES_PENDING.md`。新设计替代旧设计中“只保留 `builtin.agent`”的数量限制，其余退役执行器约束继续有效。公开 Automation/MCP 工具数量预计保持 14，须以实际注册检查为准。

## 验收范围

- 两端注册与 MCP 发现包含 Agent 和 Claude Code；新类型可创建、编辑和恢复，旧退役类型仍拒绝。
- 两种受支持类型在清理、恢复、写入及并发复验中保留，旧类型继续清理；历史不被删除。
- 每次读取当前默认选择；原生启动参数正确处理多行、中文、引号和以连字符开头的提示词，不进行 shell 字符串拼接；不持久化凭据。
- 只在匹配首条提交回执后成功，不等待 CLI 结束；通知总开关关闭时仍可确认；错配、重复和迟到回执不误报成功。
- 覆盖失败、确认超时、取消、早退与终态竞争；不自动重发；存在会话时保留定位入口。
- 连续触发创建不同会话；自动化成功或停用后已有 CLI 继续运行。
- 用户在其他应用或正在操作另一个终端时都不被切页、切标签或抢焦点；从记录主动打开时定位准确，目标失效不重建。
- 保持手动 Command 点击「＋」及手机启动路径原有行为。

实施后运行相关单测、desktop typecheck、`check:hard-constraints`，涉及新增打包资源时运行 `check:packaged-asar`。真实 CLI 的多行首条提示词、提交回执与焦点保持需单独验收；仅 mock 测试不得宣称完成了实机验收。应用或浏览器的启动遵循仓库授权规则。

## 依据与当前代码定位

- 手动入口：`desktop/src/modules/agent/components/project-group.tsx`、`desktop/src/modules/agent/hooks/use-agent-project-terminal-actions.ts`。
- 统一启动：`desktop/electron/modules/agent/claude-code-terminal.ts`；终端创建：`desktop/app-capabilities/terminal/main/service.ts`。
- 现有可选 Hook：`desktop/app-capabilities/terminal/main/agent-notification-service.ts`。
- 注册：`desktop/electron/action-runtime/builtin-actions.ts`、`desktop/src/action-runtime/builtin-actions.ts`；执行器包：`desktop/action-packages/builtin/agent/`。
- 运行记录：`desktop/src/modules/automation/components/automation-runs-dialog.tsx`。结果渲染必须按运行保存的执行器类型选择，不能因当前配置换了执行器而丢失旧记录的终端入口。
- 清理：`desktop/electron/services/automation/retired-executor-cleanup.ts`、`retired-executor-cleanup-worker.ts`、`item-repository.ts`。
- 现行边界：`docs/superpowers/specs/2026-11-05-automation-agent-only-design.md` 与 `docs/agents/module-boundaries.md`。
- [Claude Code 官方 CLI reference](https://code.claude.com/docs/en/cli-reference)：交互式启动可携带初始提示词，与一次性查询后退出模式不同。
- [Claude Code 官方 Hooks reference](https://code.claude.com/docs/en/hooks#userpromptsubmit)：`UserPromptSubmit` 在模型处理前触发，可观察提交生命周期；不代表模型处理成功或其他 Hook 不阻断。
- [Claude Agent SDK 官方 overview](https://code.claude.com/docs/en/agent-sdk/overview)：SDK 面向程序化嵌入；CLI 提供终端交互界面。本次复用交互式 CLI 启动参数，不新增 SDK 查询。

以上 CLI 能力已对照官方说明；实现前仍须核对仓库内置版本的实际能力，不能默认最新版文档中的新增字段已被内置版本支持。
