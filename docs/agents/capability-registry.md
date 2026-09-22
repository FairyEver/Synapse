# 能力注册清单

本文件记录 Synapse 当前运行时代码的真实产品表面。声明文件、目录名、测试夹具或计划文档不能单独作为“已注册”的证据。

## 注册表面与权威入口

| 注册表面 | 决定内容 | 权威入口 |
|---|---|---|
| System App | 应用身份、独立窗口、启动器入口、条件可见性 | `desktop/src/modules/apps/types.ts`、`definitions.ts`、`registry.ts`、`visibility.ts`、`components/system-app-content.tsx` |
| Dock | 默认固定、用户可固定、条件显示 | 各 App 的 `app-definition.ts` 中 `dock` 元数据、`desktop/src/modules/apps/dock.ts` |
| Workflow Node | 节点类型、Renderer manifest、Main executor | `desktop/workflow-nodes/register.renderer.ts`、`register.main.ts` |
| Automation Action | 动作类型、Renderer 配置、Main executor | `desktop/src/action-runtime/builtin-actions.ts`、`desktop/electron/action-runtime/builtin-actions.ts` |
| MCP Capability / Tool | capability catalog、tool 到 action 映射 | `desktop/synapse-capabilities/shared/registry.ts` 及各 domain registry |
| MCP 公开工具表面 | `tools/list` 载荷、`initialize` instructions | `desktop/electron/services/agent-runtime/synapse-tool-router.ts` |
| Deep Link | 默认 `synapse://app/<app-id>/<action>`；声明式短路由可使用独立 host | `desktop/app-capabilities/manifest-registry.ts`、`desktop/electron/bootstrap/app-deep-link.ts` |

Portal Headless Test 在既有 Connectors 应用内增加一个连接器定义和一个声明式私有回调 `synapse://portal-headless-test/callback`。该入口通过 `mainHandlerId` 直接交给可信主进程，不进入公开 ActionRouter。新增公开 capability/MCP 工具数量为 0，System App/Dock/Workflow/Automation 数量不变；只增加 UI retry IPC 与内部状态事件。Portal 不贡献 Agent MCP 或 Skill；正式环境入口尚未注册。连接器凭据不属于 Secrets MCP 数据。

## `desktop/app-capabilities` 产品表面

“应用页=否”表示不存在 System App 身份、启动器、Dock 或独立应用窗口。数字为注册数量，`—` 表示没有该表面。

| 能力包 | 应用页 | 默认 Dock | Workflow | Automation | MCP | Deep Link |
|---|---:|---:|---:|---:|---:|---:|
| Agent Conversation | 是（既有） | 是（既有） | — | — | 11 | `open` |
| Agent Personas | 是 | 否 | — | — | — | — |
| Connectors | 是 | 否 | — | — | — | 1 个私有授权回调 |
| Clipboard | 否 | 否 | 2 | — | — | — |
| Document Template | 否 | 否 | 1 | — | 1 | — |
| File Opener | 否 | 否 | 1 | — | 1 | `open` |
| HTML Generator | 否 | 否 | 2 | — | 2 | — |
| JavaScript Run | 否 | 否 | 1 | 1 | — | — |
| JSON Repair | 否 | 否 | 1 | — | 1 | — |
| Node.js Run | 否 | 否 | 1 | 1 | — | — |
| Problem Feedback | 否 | 否 | — | — | 1 | — |
| Quick Input | 是 | 否 | — | — | — | — |
| Rule Installer | 否 | 否 | — | — | — | — |
| Secrets | 是 | 否 | — | — | 6 | — |
| Skill Installer | 否 | 否 | — | — | — | — |
| Skill Uninstaller | 否 | 否 | — | — | — | — |
| Sound Notifier | 否 | 否 | — | — | 1 | — |
| Synapse Skill | 是 | 否 | — | — | — | — |
| System Notifier | 否 | 否 | 1 | — | 1 | — |
| Terminal | 是 | 是 | — | — | 49 | — |
| Text Extractor | 否 | 否 | 1 | — | 2 | — |
| Text File Writer | 否 | 否 | 1 | — | 1 | — |
| Script Runtime | 否 | 否 | — | — | — | — |
| Screenshot | 否 | 否 | — | — | — | — |

固定例外：

- Agent Conversation inspect 的既有 `beforeIndex` 现在支持任意有效记录边界，默认 50 条、最多 100 条及既有字节限制不变；超大单轮分多页返回，`toolUseId` 跨页保留，不新增工具，Agent Conversation 仍为 11 项。调用方按返回的 `nextBeforeIndex` 翻页，不再假定用户轮次边界。
- Agent SDK 原生 compact 与私有文件检查点是既有执行器内部行为，不新增 capability、MCP、Workflow、Automation 或 Deep Link；compact 后继续使用同一 conversation/turn，Provider 或 SDK 异常沿用普通失败投影，公开 Agent Conversation 工具仍为 11 个。

- Agent Conversation 能力包扩展既有 Agent System App，注册 11 个 capability/MCP tool（含供应商模型查询、分组查询与可指定模型的新建对话）；唯一 Deep Link action `open` 只注册 `synapse://threads/<thread-id>`，不注册旧 `synapse://app/agent/open` 入口，也不重复注册应用页、Dock 项或 Workflow/Automation 节点。路径 id 是本机短校验 `conversationRef` 的主体，由主进程跨项目解析唯一目标；复制链接对点号、下划线和连字符做百分号编码，解析只兼容这三个字符的 Markdown 转义，仍校验完整格式与校验和；MCP 首次读取可把完整链接交给主进程解析，后续读取和控制使用返回的 `projectId + conversationRef`，并继续经过权限、来源、回合与请求校验。
- JavaScript Run、Node.js Run 是能力包，不是隐藏的 System App；它们只注册 Workflow Node 和 Automation Action。它们的 capability ID 进入 catalog，但不映射为 MCP tool。
- Script Runtime 是两者共用的内部执行基础设施，不注册用户产品表面。
- Screenshot 当前是空目录占位。
- `figma-skill` 是随桌面端打包的 Agent SDK Skill 插件，不注册独立 System App、MCP domain 或 MCP tool；由 Figma 内置连接器定义声明，并仅在该连接器启用后创建的新对话中按会话快照加载。
- Workflow/Automation 的 `discovery: "visible" | "hidden"` 只控制创建选择器；`hidden` 不注销类型，已有配置仍可加载和执行。
- System App 的 `visibility` 控制启动器和 Dock 条件入口。未注册 System App 的能力包不得进入 `SYSTEM_APP_IDS`、definitions/registry、内容宿主或应用窗口 IPC。
- Terminal 的 49 个 MCP 工具包含 `global_launch.get/update`；环境变量值只存在于加密 body，MCP 只返回键、动作、来源和 revision。
- Terminal 只向 UI 和 MCP 暴露 `running` / `stopping` 会话；`ended` / `failed` / `lost` 只用于完成已在等待的观察，随后自动删除 session、pane/workspace 和所有会话数据。现有 `session.delete` 仅保留兼容性，MCP 工具数量保持 49。
- Terminal 不注册任何 Deep Link：会话不跨重启（ADR 0215），带会话的链接在下一次启动时必然失效，所以没有可交付的链接形态。会话定位由 `app.terminal.session.open` 承担，只接受不可变 `sessionId` 并复用既有 System App 打开请求定位 workspace/pane；界面里的「复制引用」只产出纯文本的五行 `key=value`——`workspace_id` / `workspace_title` / `session_id` / `session_title` / `session_ref`，其中两个 title 是给人认出「这是哪一格」用的，不注册协议路由、不读取输出，也不新增应用页、Dock、Workflow 或 Automation 表面。
- Agent 已配置项目可通过现有 Terminal UI IPC 在项目目录新建会话，并以仅含 `sessionId` 的 System App 请求打开或聚焦 Terminal；该入口不新增 MCP capability、tool 或 Deep Link。
- 手机端可通过 mobile gateway 新增的 `createAgentConversation` 意图，让电脑在自己的某个项目目录里启动内置 Claude Code，并把它作为普通终端会话回给手机；供应商凭据仍只在主进程读取与使用，手机不接触任何密钥。`mobile.summary` 随之多出两个可选区块——项目目录与供应商摘要（只含 id、名称、是否电脑默认、档位与四个档位解析后的模型名，不含 `baseUrl` 或任何凭据字段）——它们复用 `app.agent.group.list` 背后的同一份项目列表，不新增选项目录。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。
- Terminal 标签（workspace）作为可寻址对象补了 5 个 MCP 工具，44 → 49 的来源就是这一组：只读的 `workspace.list` / `workspace.get`（各标签持有的 `sessionIds`，按布局先序），写入的 `workspace_pane.create`（创建一格分屏）/ `workspace.rename` / `workspace.delete`（关掉整个标签）。寻址沿用不可变 `sessionId`——pane 与 session 是 1:1，要切哪一格就用它承载的会话指明，这一层负责按当前布局解析成 pane；布局树与 pane id 不出现在任何请求或返回值里。`workspace.delete` 只走正常终止、不提供 `force`。权限族为 `terminal.workspace.manage`（分屏与改名）与 `terminal.workspace.delete`（关标签），两者不得互相推导。
- Terminal 分屏的**比例调整、平分与拖拽重排**仍只属于现有 System App 的 UI IPC：它们改变既有 pane 的排列而不增减会话，不注册 MCP capability、tool 或 Deep Link。
- Agent 对话与 Terminal pane 的工作目录文件树只通过受权限与审计保护的 UI 私有 IPC 读取、监听并解析拖拽选中项；Agent 使用项目目录，Terminal 优先使用 OSC 7 报告的实时目录；shell 报不出目录时（自定义 shell、pwsh / cmd）按需探测一次该 PTY 前台进程的 cwd（走 `process.cwd_probe` 这个窄动作，权限与审计由受控执行器一并完成，不做定时轮询），仍拿不到才回退到会话启动目录。文件树路径拖拽只写入 Agent 草稿或当前 Terminal session，不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 图片剪贴板落盘仅属于现有 System App 的 UI 私有 IPC，用于把临时 PNG 路径交给当前 PTY；不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 用户快捷命令的增删改查仅属于现有 System App 的 UI 私有 IPC；执行仍复用当前 session 输入，不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- 手机端终端快捷栏是上述同一批按钮的**只读投影**：主进程用终端服务自己的 `listMobileToolbarButtons()` 把内置注册表（在 `desktop/app-capabilities/terminal/shared/toolbar-actions.ts`）与用户的快捷命令投影成 `mobile.toolbar` 下行消息，手机不新增、不修改、不删除任何按钮，也不回写桌面配置。投影源是主进程内部方法而非 IPC 或 capability；手机按键一律走既有 `keys` / `command` 意图，不新增 intent。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。
- Terminal 底部命令条上的「快捷输入」入口读取「快捷输入」System App 的 `app.quick-input.items`，只走现有渲染进程 UI，不新增存储、IPC 通道或协议。选中后只填入终端、由用户按回车执行，不显示重复内容或待执行提示条。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link，Terminal MCP 工具数量保持 49；手机端既有的 `mobile.quickPhrases` 与此无关，未作改动。
- Terminal Agent 原生通知的设置、活动 session 上报与点击后的精确会话定位仅属于现有 System App 的 UI 私有 IPC；通知 Hook 入口是会话级 loopback 内部端口，不注册 MCP capability、tool、Workflow Node 或 Deep Link，Terminal MCP 工具数量保持 49。同一 Hook 事件还把"是否等待用户输入"写入会话既有 `attention`（`waiting` + `approval` / `agent_question` 等 kind，恢复时回到 `not_waiting`），仅在 Terminal 侧栏与顶部标签显示标记，并随既有 `state.get` / `observe` 暴露给 MCP 调用方；不新增存储字段、capability、tool 或审计对象。
- Terminal 会话状态响应（`session_state.get` / `.list` / `session.observe` / `session_output.observe`）以及 `session.list` / `session_summary.get` 另外带三样只读内容：会话所在终端标签的 `workspaceId`（会话不在任何标签里时为 `null`。标签与分屏只活在 Renderer 的聚合层；这一项只报归属，标签本身另由 `workspace.list` / `.get` 提供，两者都不返回布局树），会话自己的 PTY 设备名 `tty`（调用方据此 `ps -t` 认领跑在里面的进程，是「粘贴一段引用去找到对家 Claude Code」那一步的接点，不依赖 Agent 原生通知，Windows 无此设备时缺席），以及 `app.terminal.agent-sessions` 五态档案的投影块 `agent`（只含 `state` / `agentKind` / `version` / `lastActivityAt` / `stateChangedAt`；`transcriptPath` 指向用户整段对话、`pid` 与 agent 自己的会话 id 是宿主进程细节，一律不出进程，投影在通知服务内部完成，原始档案类型不越过服务边界）。`agent` 缺席（这里从来没有 agent，或 Agent 原生通知未开启）与 `state: "ended"`（跑过、已退出）是两件不同的事，不得合并。该投影不新增 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 分组拖拽排序仅属于现有 System App 的 UI 私有 IPC：顺序写入分组既有 `sortOrder` 字段，不注册 MCP capability、tool、Workflow Node 或 Deep Link，不新增 Terminal MCP 工具。
- Terminal 标签（workspace）的置顶仅属于现有 System App 的 UI 私有 IPC：写入 workspace 记录既有字段，只改变同分组内排序；它随 workspace 一起只活到本次运行结束（ADR 0215），不注册 MCP capability、tool、Workflow Node 或 Deep Link，Terminal MCP 工具数量保持 49。
- Agent 侧栏项目分组顺序存放在全局配置 `global.agentProjectOrder`，只影响侧栏展示顺序，不重排 `config.global.projects`，不注册 MCP capability、tool 或 Deep Link，Agent Conversation 工具数量不变。
- 手机端的 Git 操作走一个新的 `git` intent（`action` 是枚举：`status` / `branches` / `checkout` / `createBranch` / `commit` / `push` / `sync` / `merge`，不接受任意命令字符串），状态经 `mobile.gitStatus` 下行消息按会话推送，写操作的权限族是 `terminal.git.manage`（读走既有的 `terminal.state.read`）。它执行在**终端当前所在的目录**上：目录来自 shell 上报的 OSC 7 与 `process.cwd_probe` 兜底，**只认路径**，不接「代码仓库」注册表、不产生 `repositories.json` 条目，与 `app.git.*` 那套既有的 Git 应用没有产品关系（共享的只有底层命令封装与解析器）。冲突一律在电脑侧自动 `merge --abort` 回退、只回一段可复制的文本，手机端不解决冲突。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。

## 普通业务模块 System App

| System App | 应用页 | 默认 Dock | 关联 MCP domain |
|---|---:|---:|---|
| Agent | 是 | 是 | `app` |
| Workflow | 条件显示 | 条件显示 | `workflow` |
| Drive | 是 | 是 | `drive` |
| Automation | 是 | 是 | `automation` |
| Launcher | 自身即应用页 | 是且不可移除 | — |
| Settings | 是 | 是 | `repository` |
| Resource Repository | 是 | 否 | `content`、`skill_repository` |
| Git | 是 | 否 | — |
| Database | 是 | 否 | `database` |
| Editor Scan | 是 | 否 | — |
| Usage Monitor | 是 | 否 | — |
| Model Price | 是 | 否 | `model_price` |
| Connectors | 是 | 否 | — |
| Meeting | 是 | 否 | — |

默认 Dock 从 app definition 的 `dock.pinnedByDefault` 与 `dock.order` 派生，顺序为：`agent`、`drive`、`automation`、`workflow`、`terminal`、`settings`、`launcher`。Workflow 由统一 System App `visibility` 与 `workflowEntryVisible` 控制。

Git 仍是普通 System App，不新增 MCP domain。其带恢复 journal 的原子 clone、仓库注册、状态与差异预览、主进程选择令牌、精确提交与按文件丢弃、同步、空仓库初始化与远端默认分支接入、缓存远程分支发现与 tracking 检出、SSH 主机密钥、操作状态与取消能力只通过窄类型化 Git IPC bridge 暴露；仓库目录定位复用受权限与审计保护的 Shell IPC，设为项目复用系统设置的全局项目配置与添加流程。Agent 项目与 Git 仓库根路径精确匹配时，composer 可复用同一 Git IPC 执行确认后的全部改动提交及常用远端操作，并可定向打开对应 Git 工作台；该入口不经过 Agent、MCP 或通用命令执行。这不改变上表的 capability 或 MCP 数量。远程分支、空仓库初始化与文件丢弃能力不注册任意 Git 命令入口，也不扩展为 Workflow、Automation、MCP 或 Deep Link 表面。

MCP 不是 System App，不进入启动器、Dock 或独立应用窗口。系统设置中的 MCP 分类是全局 MCP Server 与外部客户端注册信息的唯一 UI 入口；它聚合当前全部已注册 domain，但不新增 capability 或 MCP tool。Connectors 是独立的 System App；客户端内置定义通过 `integration.kind` 选择 Driver，状态写入版本化的 Synapse DataRepository，并在内置 Claude SDK 会话创建时临时注入 MCP 和对应 Skill，不写入外部 Claude 配置。V1 仅支持无认证的 `http://127.0.0.1:<port>/<path>` Streamable HTTP MCP；探测必须完成 MCP 初始化、initialized 通知、`tools/list` 和必需工具校验，失败或超时不得启用。当前 Figma 定义使用 `http://127.0.0.1:3845/mcp` 和内置 `figma-skill`，Skill 不声明 Figma 写入能力。新对话把已启用的连接器 ID 固化到会话快照，并从同一份 Agent Contribution 加载 MCP 与 Skill；已有对话不会因之后启停而动态变化，最终 Query 缺少或连不上预期 MCP 时只降级该工具，不阻断普通对话。

Meeting 是普通 System App（界面上的名字是「录音」），不新增 MCP domain：录音与转写文字只通过桌面端与手机端的用户界面读写，没有注册 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link。它注册 12 个 UI 私有 IPC operation（`app.meeting.*`），用于录音起止、分片上报、录音读写与删除、转写重试、回放地址与波形，以及音频本机缓存；分片是裸字节，经主进程代理写入平台媒体对象存储，不进用户云盘。发言人与纪要在两端的界面上都已去掉，对应的写入 IPC 与 HTTP 接口一并下线；服务端 DTO 仍照常返回 `speakers` / `minutes` 等字段，手机端才不会因旧版本解码失败。异常退出留下的未完成录音由主进程在启动时静默收尾，不占用任何 IPC——但**只收本机录的那一条**（判据是本机暂存目录还在不在）：手机端上线后两端录的是同一批数据，无条件收尾会把对方正在录的那条强行结束掉。服务端的 `GET /meetings/recordings/pending` 因此多了可选参数 `?all=1`，无参数时的行为不变，旧版桌面端照常可用。转写完成后服务端经既有 `broadcastToUser` 通知桌面端，并经 `MobilePushService` 的 `MEETING_TRANSCRIPTION` category 通知手机——两者都不改变上表的 capability 或 MCP 数量。转写进度：详情 DTO 多返回一个可选的 `transcription`（阶段 / 服务端此刻的已用时长 / 按音频时长估的预期耗时），两端据此画一条会往前走的进度条（封顶 95%），秒表由客户端在两次刷新之间接着走；这只是既有 `app.meeting.entry.get` 的一个字段，没有新增 operation。转写失败的重试只覆盖**投递阶段**的抖动，识别引擎判定音频不可识别属终局、一次收尾不再重投。新增的第 12 个 operation 是 `app.meeting.audio.ensure`（`{ meetingId }` → `ready` / `downloading` / `unavailable`）：音频在本机留一份，听过的再听不走网络，没网也能听听过的那些。**缓存是纯客户端行为，服务端零改动**——失效判断用的 `recording.status` 与 `recording.size` 详情接口本来就在返回。缓存只有这一个 operation，没有配套的清理入口：清理是主进程自己的事。桌面端缓存目录是 `userData/meeting-audio-cache/`，手机端沿用录音落盘目录，两端都不进 `DataRepository`（派生产物，禁止把大文件字节写进去）；两端各自的命中判据、2 GB 上限与清理时机必须一致。界面上不出现缓存的任何痕迹——没有「已下载」「已缓存」「离线」「本地」任何一个词，列表行也不加标记。手机端的录音实时活动另有一条**只属于手机**的深链 `synapse://recording`：锁屏和灵动岛上那张卡片点一下落在录音界面，而不是把这一条结束掉——卡片是「带我去看」，那两个按钮才是「替我做」。它由 iOS App 自己注册与解析（`CFBundleURLTypes` + `onOpenURL`），不经桌面端协议路由：桌面端的 `synapse://` 路由对它照常按未知路由处理（一条 warn 日志加聚焦主窗口），不新增 System App、Dock、Workflow Node、Automation Action 或 MCP capability/tool。手机端因此成为第一个注册 Deep Link 的客户端；「卡片点开落在录音界面且不起新录音」与「按钮在 App 进程里执行」两条同时成立，见 `docs/superpowers/specs/2026-09-19-mobile-recording-design.md` 的补记。

## MCP capability domain

| Domain | Capability 数 | MCP Tool 数 |
|---|---:|---:|
| `app` | 83 | 79 |
| `database` | 30 | 30 |
| `model_price` | 11 | 11 |
| `repository` | 1 | 1 |
| `skill_repository` | 9 | 9 |
| `automation` | 14 | 14 |
| `workflow` | 19 | 19 |
| `content` | 16 | 16 |
| `drive` | 64 | 64 |
| 合计 | 247 | 243 |

`synapse-tool-router` 的 `search`、`invoke` 是所有 MCP 客户端的**唯一**公开工具表面：`/mcp` 的 `tools/list` 只返回这两个工具，`initialize` 返回说明两段式调用流程的 instructions。内置 Agent 会话通过 SDK 注入进程内 server（名字前缀 `synapse-tool-router`），外部客户端通过 `/mcp` 看到的是 `synapse-mcp` 的 `search`、`invoke`，两者共用同一实现、同一 instructions 与同一 action router。

上表 243 个 `app_*` 工具仍注册在 capability catalog 与 `MCP_TOOL_ACTIONS` 中，作为 `search` 的索引和 `invoke` 的 action 映射，但不再出现在 `tools/list` 里。它们计入 MCP Tool 数，不计入公开工具数——公开工具数恒为 2。

`app` domain 中不映射 MCP tool 的四个 capability 固定为：

- `app.javascript.script.execute`
- `app.nodejs.script.execute`
- `app.clipboard.text.write`
- `app.clipboard.text.read`

Drive 的 `app.drive.share.create` 与 `app.drive.site.create` 在未传访问设置时均创建公开、永久的新分享；网页分享创建工具只要求来源文件夹与名称。该契约调整不改变 `drive` domain 的 capability 或 MCP tool 数量。

Drive 本地同步通过 9 个 `app.drive.sync.*` capability 暴露给 MCP：快照、预检、创建、暂停、恢复、停止、排除规则、完整扫描和冲突处理。它们复用桌面端 `core.drive-sync`，不新增独立同步引擎或 Web 端能力。

Drive 分享评论通过 6 个 `app.drive.link.annotation.*` capability 暴露给 MCP：线程列表、新建线程、回复、编辑评论、删除评论和删除线程。文字评论直接提交 quote；整图评论先通过 `app_drive_link_read_text` 取得 `imageId`，再创建线程。图片或文字目标失效后保留为未定位线程，不提供手动重关联。删除评论会连带删除其全部后代回复，删除首评会移除整条讨论。它们只接受当前 Synapse `/share/...` 下文件名以 `.md` 结尾或 MIME 为 `text/markdown`、`text/x-markdown` 的 Markdown 文档，复用现有分享访问、评论权限和审计；不开放文档编辑、presence 或协同房间控制。

Drive 文档正文改写通过 `app.drive.file_content.write` 暴露给 MCP，只处理 owner 自己云盘里已存在的 Markdown、纯文本和 HTML 源文件，必须带 `baseVersionId`，复用浏览器在线编辑器的并发校验（版本不匹配返回 `DRIVE_FILE_CONTENT_STALE`）与版本历史。对应的文本上传覆盖路径（`app.drive.file_upload`）在覆盖这类文件时要求同样的基线声明。分享场景、文件夹上传与二进制文件不在此契约内。

浏览器 Markdown/MDX 编辑器的平台托管图片属于现有 Drive Web UI 私有能力，使用 `/object/<objectId>`，不注册 System App、MCP capability/tool、Automation Action 或 Deep Link。`/object` 是平台托管对象的公共命名空间，不限定未来对象类型。Agent 处理本地 Markdown、HTML 与明确的图床/直链请求时仍使用既有 Drive 文件、Site 和 `app.drive.direct_link.*` 能力。

## 同步硬规则

- 新增、删除、重命名或改变任意 System App、默认 Dock、Workflow Node、Automation Action、MCP capability/tool、Deep Link 或 `desktop/app-capabilities/<id>` 能力包时，同一次改动必须更新本文件的表格、数量、例外和默认 Dock 顺序。
- 修改启动器可见性、Workflow 条件入口、`systemApp`、`discovery`、`openable`、`pinnableToDock`、`defaultDock` 或任何改变产品表面的过滤逻辑时，也必须同步。
- 即使改动不在 `desktop/app-capabilities/`，只要影响普通 System App 或 MCP domain，就必须更新本文件。
- 只修改能力内部实现且注册表面不变时可以不改数字，但必须主动核对本清单仍与运行时装配一致。
