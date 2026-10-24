# 能力注册清单

- 2026-10-24：设置新增“Agent 使用的 MCP”，只读配置清单与 SY 独立禁用策略。新增 2 项 UI 专用 IPC：`app.mcp.agent.list`、`app.mcp.agent.set_enabled`；不注册为 capability/MCP tool。340 项全局 capability、336 项 MCP 索引、22 个 System App，以及 Dock、Workflow、Automation、Deep Link 数量均不变。内置 Synapse 路由不可在此关闭；SY 对外 MCP 注册接口不变，系统 Skill 的工具契约不变。详见 `docs/superpowers/specs/2026-10-24-agent-mcp-settings-design.md`。

- Agent OpenUI 是既有 Agent 对话内的展示与交互能力，不新增 System App、Dock、Workflow、Automation、Deep Link 或 MCP 工具；Agent Conversation 仍为 11 项。新增三个 UI 专用 IPC operation：`app.agent.generated_ui.get_state`、`app.agent.generated_ui.save_state`、`app.agent.generated_ui.submit_action`。它们只处理当前桌面对话的状态和用户提交，不提供通用业务工具执行能力。

本文件记录 Synapse 当前运行时代码的真实产品表面。声明文件、目录名、测试夹具或计划文档不能单独作为“已注册”的证据。

## 注册表面与权威入口

| 注册表面 | 决定内容 | 权威入口 |
|---|---|---|
| System App | 应用身份、独立窗口、启动器入口、条件可见性 | `desktop/src/modules/apps/types.ts`、`definitions.ts`、`registry.ts`、`visibility.ts`、`components/system-app-content.tsx` |
| Dock | 默认固定、用户可固定、条件显示、一次性升级迁移 | 各 App 的 `app-definition.ts` 中 `dock` 元数据、`desktop/src/modules/apps/dock.ts` |
| Workflow Node | 节点类型、Renderer manifest、Main executor | `desktop/workflow-nodes/register.renderer.ts`、`register.main.ts` |
| Automation Action | 动作类型、Renderer 配置、Main executor | `desktop/src/action-runtime/builtin-actions.ts`、`desktop/electron/action-runtime/builtin-actions.ts` |
| MCP Capability / Tool | capability catalog、tool 到 action 映射 | `desktop/synapse-capabilities/shared/registry.ts` 及各 domain registry |
| MCP 公开工具表面 | `tools/list` 载荷、`initialize` instructions | `desktop/electron/services/agent-runtime/synapse-tool-router.ts` |
| Deep Link | 桌面端默认 `synapse://app/<app-id>/<action>`；声明式短路由可使用独立 host。iOS 客户端路由独立计数 | 桌面：`desktop/app-capabilities/manifest-registry.ts`、`desktop/electron/bootstrap/app-deep-link.ts`；iOS：`SynapseMobile/SynapseMobile/Features/Root/RootView.swift` |

Portal Link 与 Portal Link Test 分别保留正式和测试环境授权、本机加密凭据和各自私有回调。Connectors 新增两个仅限 MCP 的只读凭据能力：`app.connectors.portal_link.credential.get` / `app_connectors_portal_link_credential_get`、`app.connectors.portal_link_test.credential.get` / `app_connectors_portal_link_test_credential_get`，均注册在 `app` domain，固定读取各自连接器。工具只读本机，经权限和审计返回 Portal API 地址、token、租户和已验证身份摘要；不注册 IPC 或通用 HTTP 凭据入口，不提供网络业务代理。旧 Portal Headless 后台、SDK、扩展凭据工具、`extend` domain 与系统 Skill 指引已删除。内部连接器 ID、回调和存储键保留兼容；System App、Dock、Workflow、Automation 和 Deep Link 数量不变。连接器凭据不属于通用 Secrets MCP 数据。

## `desktop/app-capabilities` 产品表面

账号消息中心是桌面全局壳层面板与 iOS 独立通知页面；iOS 由底栏「通知」进入，不注册为独立 System App、Dock、Workflow、Automation 或 Deep Link。其列表、详情、统计和管理操作注册为账号 MCP 能力。System Notifier 的既有能力是用户已登录且在线时把正式触发内容同步到消息中心，测试通知仍仅本机显示。

桌面通知来源下拉筛选复用既有 `app_account_notification_list` 的可选 `source`，与 `filter` 状态条件取交集并在分页前过滤；账号消息中心仍为 7 个 MCP 工具，各注册数量不变，不新增 capability 或路由。全部已读、清空全部与忽略全部待处理仍按当前账号范围执行，不受列表来源筛选影响。

云盘评论/留言通知由服务端拥有的 `drive-discussion` 来源自动产生，既有 Drive 创建工具负责业务操作，不增加通知发送参数或工具。网页 `/notifications/<notificationId>/open` 与 `GET /api/notifications/:id/drive-target` 是受保护的 UI 定位表面，不是 `synapse://` Deep Link；手机复用 `.message(id)` 和现有网页浏览入口。Drive 仍为 76 个 MCP 工具，账号通知仍为 7 个；下表各项数量及 System Notifier 公开契约不变。

2026-10-13 文档互动通知增加可选只读 `driveDiscussion.snapshot`（完整标题、本次内容、原文及回复对象的当时摘录）。手机长按详情是既有通知读取的 UI 操作，点按继续直达；通知输入 schema、工具数量和 System Notifier 契约不变。

桌面通知列表和详情复制 `synapse:notification:<id>` 作为带类型的 MCP 定位 ID；现有 `app_account_notification_get` 接收完整 `reference`，读取仍受当前账号权限限制。这不是桌面 Deep Link，不增加账号消息中心的 7 个 MCP 工具或路由。站内信复制现有 `synapse://mail-internal/<id>` 路由，`app_mail_internal_message_get` 也可接收完整 `reference`；复制定位功能不增加 Mail MCP 工具或 `open` 路由。两类读取都不因 MCP 调用自动设已读。

“应用页=否”表示不存在 System App 身份、启动器、Dock 或独立应用窗口。数字为注册数量，`—` 表示没有该表面。

下表的 Deep Link 列只统计桌面端路由。iOS 客户端另有 4 条路由：`synapse://recording`、`synapse://terminal?desktop=<id>&session=<id>`、`synapse://mail-internal/<message-id>` 和 `synapse://todos/<id>`。Terminal 路由进入终端列表或会话：不带 `session` 时可省略 `desktop`，携带 `session` 时必须同时指明 `desktop`。会话目标先等待当前账号与连接的电脑状态；已知电脑离线时退回会话列表并清除旧详情选择，在线时还要等待当前连接收到对应电脑的实时摘要，才校验会话是否可打开。已结束会话给出原因并保留当前选择；用户随后主动选择会取消旧待跳转。通知与 Widget 共用此打开判定，旧通知未携带电脑标识时沿当前电脑处理，不放宽 URL 参数校验。mail-internal 路由进入站内信并按当前用户权限读取该信件。Todo 路由严格接受单一 ID，在账号就绪后只读定位，已完成目标进入全部，query / fragment / 编码分隔符无效；新导航和身份变化取消旧目标。四条路由均由 iOS App 本地处理；本次生命周期与回退修复不改变表中的注册数量或 MCP/Skill 表面。

| 能力包 | 应用页 | 默认 Dock | Workflow | Automation | MCP | Deep Link |
|---|---:|---:|---:|---:|---:|---:|
| Agent Conversation | 是（既有） | 是（既有） | — | — | 11 | `open` |
| Agent Personas | 是 | 否 | — | — | — | — |
| Account Message Center | 否 | 否 | — | — | 7 | — |
| Connectors | 是 | 否 | — | — | 2 | 2 个私有授权回调 |
| Clipboard | 否 | 否 | 2 | — | — | — |
| Desktop Update / Restart | 否 | 否 | — | — | 4 | — |
| Document Template | 否 | 否 | 1 | — | 1 | — |
| File Opener | 否 | 否 | 1 | — | 1 | `open` |
| HTML Generator | 否 | 否 | 2 | — | 2 | — |
| JavaScript Run | 否 | 否 | 1 | 1 | — | — |
| JSON Repair | 否 | 否 | 1 | — | 1 | — |
| Mail（邮箱） | 是（含 800×640 独立写信窗口、地址弹层预填收件人写信、草稿批选删除及实时进度、真实同步状态和索引进度、已发送只读状态和 Sent 副本核验；账号切换统一在顶栏左侧，刷新与写邮件在右侧，刷新/索引进度与刷新按钮原位互斥，列表工具栏常驻；写信统一输入组、字段错误就近提示及紧凑分组格式栏；设置集中左下角；写信仅收件人/抄送，关闭使用系统窗口按钮） | 是（紧邻「应用」左侧，升级一次性加入） | — | — | 44 | `synapse://mail/em_<uuid>` |
| Mail Internal | 是（含复制全文，独立黑色 PNG 图标） | 是（紧邻邮箱左侧，升级一次性加入） | — | — | 17 | `synapse://mail-internal/<id>` |
| Todos | 是（内置 PNG 图标） | 否（可手动固定） | — | — | 6 | `synapse://todos/<id>` |
| Node.js Run | 否 | 否 | 1 | 1 | — | — |
| Problem Feedback | 否 | 否 | — | — | 1 | — |
| Quick Input | 是 | 否 | — | — | — | — |
| Rule Installer | 否 | 否 | — | — | — | — |
| Secrets | 是 | 否 | — | — | 6 | — |
| Skill Installer | 否 | 否 | — | — | — | — |
| Skill Uninstaller | 否 | 否 | — | — | — | — |
| Synapse Skill | 是 | 否 | — | — | — | — |
| System Notifier | 否 | 否 | 1 | — | 1 | — |
| Terminal | 是 | 是 | — | — | 49 | — |
| Text Extractor | 否 | 否 | 1 | — | 2 | — |
| Text File Writer | 否 | 否 | 1 | — | 1 | — |
| Script Runtime | 否 | 否 | — | — | — | — |
| Screenshot | 否 | 否 | — | — | — | — |
| WeCom | 否 | 否 | — | — | 2 | — |

固定例外：

- 邮箱私有存储保护扩展到受管 stdio MCP、CLI/PTY、脚本、Workflow/Automation shell、EJS 子进程及公开文件参数。Terminal capabilities 新增 `privateStorageProtection` 状态；`executionIsolation=none` 仍指无通用工作区沙箱。Mail 44、Terminal 49、HTML Generator 2 及全局 340 capability / 336 MCP 索引、22 个 System App 和其他注册数量不变；不新增工具、输入字段或权限开关。系统 Skill 与安全规范同步。

- Mail 复合提示词发现区分“回复/转发刚才的邮件并创建草稿”和“打开/编辑已有草稿”；前者优先 draft.create，后者保持 draft.get。仅调整 search 预路由并同步系统 Skill，不改变44项 Mail 工具、schema、权限或其他注册数量；仅预览不授权发送。
- Mail 的 AI 路由将普通邮件请求固定到 mail，仅显式站内信或其类型引用进入 mail_internal；单一邮箱直接选用。既有 message.list/count/search.start 增加发件人、收件人、主题、附件、独立收件时间过滤，摘要增加 receivedAt；旧数据在既有同步批次内补齐。系统 Skill 新增41条场景配方，API 参考随 schema 生成。不新增公开动作、IPC、权限、System App、Dock、Workflow、Automation 或 Deep Link；Mail 仍为44项、站内信17项，全局340 capability / 336 MCP 索引及22个 System App 不变。
- Mail 写信窗口使用独立尺寸：默认 800×640，最小 640×480，保留原生缩放；阅读窗口和其他 System App 继续使用通用尺寸。邮箱仍为 44 个公开动作，System App、Dock、Workflow、Automation、Deep Link 数量及 MCP schema、系统 Skill 指南均不变。
- Mail 的 sync.get 支持 jobId / accountId 二选一；按账号只读当前运行时任务，无任务返回 null，不隐式启动或恢复同步。UI 复用 message.count 的账号级 indexed / serverReported 展示进度，运行中在顶栏以短进度条替换刷新按钮，失败保留完成批次进度。邮箱仍为 44 项公开动作，全局 340 capability / 336 MCP 索引、22 个 System App 及其他注册数量不变；不新增 IPC、工具或权限，系统 Skill 与输入 schema 同步更新。
- Mail 设置只在左下角提供入口，顶栏保留刷新和写邮件；内容区窄于 33rem、侧栏隐藏时，设置入口改在列表底部显示。沿用现有设置操作，注册数量、MCP schema 与系统 Skill 指南不变。
- Mail 账号切换统一放在应用顶栏左侧，独立窗口、Dock 与启动台内嵌共用现有壳层插槽；侧栏与窄窗口内容区不重复显示账号选择，右侧仍为刷新和写邮件。只调整 UI 入口，邮箱 44 项公开动作、全局 340 capability / 336 MCP 索引、22 个 System App 及其余注册数量不变，MCP schema 与系统 Skill 契约不变。
- Mail 普通文件夹在侧栏右键提供重命名和确认删除，新建保留在设置；沿用 `folder.rename/delete`，主进程继续保护系统文件夹并仅允许删除没有邮件和子文件夹的普通文件夹。删除当前文件夹后返回全部邮件。邮箱仍为 44 项公开动作、全局 340 capability / 336 MCP 索引、22 个 System App，不新增 IPC、权限或注册项；MCP schema、系统 Skill 的文件夹操作契约不变。
- Mail 在 SMTP accepted / partial 且副本未确认时提供 Sent 核验，复用已有 `operation.get` 的有界只读对账；核验期间禁止重复点击，不重发 SMTP。consumed 草稿继续保留只读快照并明确标记已发送。刷新文件夹时将当前 folderId 交给既有 `sync.start`，优先同步所见文件夹。邮箱仍为 44 项公开动作，全局 340 capability / 336 MCP 索引、22 个 System App 及其它注册数量不变；公开动作和运行时参数契约不变。
- Mail 的 `message.get`、`draft.create`、`attachment.list/get/download_file` MCP 发现 schema 使用顶层对象汇总候选字段，避免客户端拒绝顶层组合器；工具描述和系统 Skill 明确互斥输入，核心共享 schema 继续严格验证原分支。44 个邮箱动作及全局注册数量不变，不新增别名、IPC 或权限。
- Mail 写信表单的 InputGroup、字段错误关联及格式工具栏间距，以及设置错误固定可见、链接弹窗错误独立清理，属于已有动作的 UI 反馈调整；账号表单复用共享 schema 提前校验，主进程校验保留。44 个邮箱动作及全局注册数量不变，MCP 描述/schema 和系统 Skill 的收发契约不变。
- Mail 的手动刷新请求、列表加载和索引进度统一在顶栏替换刷新按钮，两者互斥；完成后恢复刷新按钮，暂停或异常也在顶栏展示。列表工具栏始终保留搜索、选择和批量操作，不再做悬停/焦点保护切换；仅调整既有状态的展示，不改变 sync.get / message.count、44 个邮箱动作、MCP / Skill 契约或全局注册数量。
- Mail 自动校对在首次或手动同步完成后保留 completed，手动刷新和真实失败后的重试仍报告状态；当前 coverage 通过 message.count / message.list 读取。IDLE 等待独立于普通请求超时，取消与真实断线仍释放资源；同步更新 sync.get 描述和系统 Skill，不新增 schema 字段、IPC 或权限，邮箱 44 项及上表数量不变。
- Mail 列表主操作固定在右侧，搜索覆盖范围入口留在列表，同步状态移至顶栏；写信关闭确认默认聚焦取消并在取消后恢复编辑焦点。均属于现有工具栏与弹窗的 UI 调整，44 个邮箱动作及 MCP / Skill 契约、全局注册数量不变。

- Connectors 的「企业微信」连接器只负责扫码绑定机器人、保存本地凭据、连接状态和连接信息弹窗，Connectors 的 2 个 MCP 仅用于 Portal 凭据，企业微信凭据不通过它们交付。它使用 `@wecom/cli`，凭据不上传 Synapse 服务端，也不向 Renderer 或 MCP 暴露。企业微信 CLI 不提供完整业务权限清单查询，因此连接信息弹窗只展示连接时间、最近检查时间及企业微信权限管理入口，不展示推测的逐项权限。WeCom 能力通过主进程 `core.wecom` 服务使用凭据，注册 2 个 MCP 工具：`app_wecom_connection_get` 只返回连接状态和时间；`app_wecom_cli_run` 接受官方 Skill 的规范参数数组并执行消息、消息所需的媒体上传、身份和 schema 命令。它不使用 shell 字符串，不允许 `auth`、`cache`，所有文件都限制在账号和 controller/client 隔离的临时工作目录。企业业务权限不足时不影响连接器状态，MCP 返回 `WECOM_PERMISSION_REQUIRED`、中文权限名和官方申请链接。筛选后的官方 2 个 Skill（`wecomcli-shared`、`wecomcli-message`）固定在 `synapse-skill/skill-package/wecom/`，同步关闭安装 CLI、登录和任意终端执行路径。永久排除原有 7 项及本次移除的通讯录、媒体、邮件、文档管理、在线表格和智能表格 Skill，共 13 项；相关参考、模板、Python 脚本和业务命令一并移除。`media upload` 作为消息发送的共用依赖保留，上传指引并入消息 Skill，`media download` 和所有 `mail`、`contact`、`doc`、`sheet`、`smartsheet` 命令拒绝执行。完整保留与排除清单见 `module-boundaries.md` 和 `wecom/UPSTREAM.md`。Connectors 的 2 条私有授权回调不变，System App、Dock、Workflow、Automation 和 Deep Link 数量不变。

- 云盘文件搜索扩展既有 `app.drive.item_tree.list`（MCP 索引名 `app_drive_item_tree_list`），增加名称、类型、更新时间、有效分享和排序条件；桌面通过同一 operation 的 `drive.itemTree.list` IPC 调用。服务端在自有普通云盘递归结果上先筛选、统计再分页，返回真实路径与祖先；不新增 capability、MCP 工具、System App、Dock 或 Deep Link，Drive 仍为 76 项。
- AI 文件查找在既有工具发现词表中区分查找文件、浏览目录、分享链接、回收站和历史版本；明确查找本地或第三方存储时排除错误的 Drive 领域候选，精确工具名与领域限制继续有效；不新增工具。`app.drive.item_tree.list` 的 MCP 搜索默认每页 20 条，返回实际搜索条件、结果编号和需登录的本人预览链接，供现有对话续查/选择；普通目录树、桌面 IPC 和服务端查询默认保持不变。仅匹配名称及元数据，不创建分享、不读取正文、不新增全文或语义索引；Drive 仍为 76 项。
- 云盘同步的 `app.drive_sync.remote_items.get` 是 UI 私有批量读取 IPC，返回自有条目、完整父链和当前版本；HTTP `/api/drive/items/batch`、`/api/drive/changes/batch` 只供既有账号客户端合并读取。同步根继续保留独立游标、分页及错误，不新增公开 MCP、System App、Dock、Workflow、Automation 或 Deep Link；Drive 仍为 76 个 MCP 工具。

- Mail 的桌面详情与列表右键菜单提供“复制全文”：以标题、空行、完整 Markdown 正文写入剪贴板，不包含附件；列表摘要不足时复用既有信件读取接口，复制不改变已读状态。此操作仅为桌面 UI 交互，Mail 仍为 17 个 MCP 工具，System App、Dock、Workflow、Automation 和 Deep Link 注册数量不变。

- Todos 的中文 MCP 检索覆盖「待办」「事项」「完成」及六类常用操作；仅补齐既有检索词表，仍为 6 个 capability / MCP 索引，公开工具保持 `search` 与 `invoke`，参数、系统 Skill 指南和其它注册表面不变。

- Todos 的启动台与 Dock 共用内置 PNG 图标，深浅外观均保持原图配色，不再对图标反色。此资源替换不改变 System App、Dock、Workflow、Automation、MCP 或 Deep Link 注册数量；Todos 仍提供 6 个 MCP 能力，参数与系统 Skill 指南不变。

- Agent 顶部的「在 Claude Code 中继续」及转交后历史末尾的「打开 Claude Code」复用 UI 专用 `app.agent.operation.resume_claude_code_terminal` IPC 接续原生会话。转交后原对话永久只读，MCP inspect 返回 `controllable=false`，消息及其它控制请求拒绝；CLI 新消息不回流。终端内部新增 PTY 启动前保存关联的回调，不新增公开 capability。Agent 保持 11 个 MCP 工具，Terminal 保持 49 个；System App、Dock、Workflow、Automation 和 Deep Link 数量均不变。

- System Notifier 的注册表面不变（1 个 MCP 工具、1 个 Workflow 节点），它是「通知用户」这一个能力：一次触发只把消息写进账号消息中心（桌面端入口是 `POST /api/notifications/desktop`），服务端再投递给该账号所有在线桌面（包括发起的那台）并随 APNs 推到用户手机。走桌面登录态，不需要用户新建 API 密钥，也不经过开放 API。System Notifier 同时负责这台电脑的原生呈现：实时连接收到账号消息后交给它，按 `localEnabled` / `silent` 两颗开关决定弹不弹、静不静音；`sendEnabled` 是发送总闸，关掉则完全不发。未登录或离线时发不出去，那就什么都不发生，本机也不另弹一条，但会留下 `notification_sync` 固定诊断。测试通知仅本机显示且永不发送，成功响应仍不承诺送达或显示。

- System Notifier 的触发工具 2026-10-15 起除通知本身外还可携带一条可选 `https` 链接与一个可选分组标签（`url` / `group`）：通知里点开直接打开该地址，标签显示在标题旁。二者与 `title` / `body` 同为单行文本，链接只接受 `https` 且不得携带凭据，长度上限分别按 2048 / 64 个 UTF-16 码元计算。**MCP 工具数不变（仍 1）**，Workflow 节点仍为 1，Automation Action 与 Deep Link 无新增，三张表的注册数量都不动。

- System Notifier 的 `title` 上限同步按 64 个 UTF-16 码元执行，超限在桌面接受前明确拒绝，避免 emoji 标题被服务端拒收而调用方仍获成功。`body` 仍为 256 Unicode 码点（最多 512 码元，与服务端兼容）。直接 MCP 调用与 Workflow 插值后共用同一校验；上表仍为 1 个 MCP 工具、1 个 Workflow 节点，其余注册数量不变。

- System Notifier 的触发工具 2026-10-15 起增加可选 `copyOnTap`（布尔，缺省 false）：为真时用户在手机上点这条通知即把正文复制到剪贴板。桌面端另在消息中心详情提供「复制正文」，iOS 端在通知详情提供同一入口，两者对任何通知都可用、不读这个开关。开放 API 的两个请求体形状接受同名布尔，路径式用 `?copyOnTap=1`（只认字面量 `1`）。**MCP 工具数不变（仍 1）**，Workflow 节点仍为 1，Automation Action 与 Deep Link 无新增，三张表的注册数量都不动；能力版本仍为 `1.0.0`。

- Mail 是独立 System App，不默认固定 Dock；桌面与 iOS 都可人工收发、处理附件和批量整理信箱。桌面 IPC 按 `app.mail_internal.<resource>.<action>` 分开并在 preload 中按资源嵌套；本机文件附件另有不注册 MCP 的 UI 专用操作。17 个 MCP 工具包含组织搜索及成员分页、完整历史信箱的人员列表、当前账号可见往来、精确统计、全部已读和批量整理。Synapse Skill 引导 AI 搜索同团队个人或组织、分别确定收件人与抄送人、固定并检查完整预览；用户已授权发送且无疑惑、不确定或确需检查的内容时直接后台发送，仅有待解决问题或用户要求先审阅时取得明确答复。回复与转发遵循同一规则，组织成员在发送时按最新名单展开。当前 `confirmed: true` 是调用者已核对发送授权与预览、无待解决问题的声明，不构成服务端可验证的对话确认凭证。上述发送授权规则不增加 MCP 工具或路由。附件不从云盘复制；转发原信附件由站内信存储自行复制，云盘文件仍以分享链接放入正文。信件查看与下载只允许发件人或该信收件人。唯一跨团队入口是管理员保护的全站平台公告 API，公告进入活跃用户收件箱且只读，不新增 Mail MCP 工具或普通用户发送权限。桌面 `synapse://mail-internal/<message-id>` 与手机同形路由只定位信件，不放宽服务端鉴权。

- Desktop Update / Restart 的 4 个 App MCP 能力为 `app.update.state.get`、`app.update.check.execute`、`app.update.install.execute`、`app.desktop.restart.execute`。后三者的规范 MCP 名称特例缩短为 `app_update_check`、`app_update_run`、`app_desktop_restart`，不是旧工具别名。它们复用桌面更新器与正常退出链路；远程重启保留未同步推送而不弹本机确认框。该入口不注册 System App、Dock、Workflow、Automation 或 Deep Link；与要求短时凭证的公开更新深链互不替代。

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
- 桌面 Terminal 与 Agent 对话的语音 Enter 在识别收尾后直接执行／发送，对勾仍只填入；完成后恢复焦点，终端不再显示重复的待执行条。仅调整桌面录音交互与提交互斥，复用既有终端输入和 Agent 发送链路；Terminal 仍为 49、Agent 仍为 11 个 MCP 工具，System App、Dock、Workflow、Automation、Deep Link 数量和 MCP schema／系统 Skill 操作契约均不变。
- Terminal 只向 UI 和 MCP 暴露 `running` / `stopping` 会话；`ended` / `failed` / `lost` 只用于完成已在等待的观察，随后自动删除 session、pane/workspace 和所有会话数据。现有 `session.delete` 仅保留兼容性，MCP 工具数量保持 49。
- 桌面 Terminal 的全局主题选择、预览与保存是既有设置页的 UI 表面，共 9 款内置主题（含默认主题）；新增浅色主题复用相同设置表面。终端顶栏与底栏通过局部 shadcn token 复用主题的 background／foreground，栏背景额外叠加 5% 黑色，与画布同步预览和恢复，不新增用户操作或主题配置字段。主题偏好复用 `config.get` / `config.update`；`config.onTerminalThemeChanged` 只订阅 EventBus，用于桌面多窗口同步，不注册新 IPC operation、MCP capability/tool、Workflow、Automation 或 Deep Link。上表 Terminal 仍为 49 个 MCP 工具，所有注册数量保持不变。社区颜色只作为集中管理的终端主题数据；手机端不跟随此次主题设置。
- 桌面端 Terminal 不注册任何 Deep Link：会话不跨重启（ADR 0215），带会话的链接在下一次启动时必然失效，所以没有可交付的桌面端链接形态。会话定位由 `app.terminal.session.open` 承担，只接受不可变 `sessionId` 并复用既有 System App 打开请求定位 workspace/pane；界面里的「复制引用」只产出纯文本的五行 `key=value`——`workspace_id` / `workspace_title` / `session_id` / `session_title` / `session_ref`，其中两个 title 是给人认出「这是哪一格」用的，不注册桌面端协议路由、不读取输出，也不新增应用页、Dock、Workflow 或 Automation 表面。iOS 主屏幕组件的本地跳转见上方客户端路由说明。
- Agent 已配置项目可通过现有 Terminal UI IPC 在项目目录新建会话，并以仅含 `sessionId` 的 System App 请求打开或聚焦 Terminal；该入口不新增 MCP capability、tool 或 Deep Link。
- Terminal 项目分组的加号在按住 ⌘（Windows/Linux 为 Ctrl）时反过来复用 Agent 的 UI IPC，在项目目录里启动内置 Claude Code；它与 Agent 侧栏项目行上的同一个手势共用同一份渲染进程启动代码与默认模型解析，普通分组和普通点击不受影响。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。
- 手机端可通过 mobile gateway 新增的 `createAgentConversation` 意图，让电脑在自己的某个项目目录里启动内置 Claude Code，并把它作为普通终端会话回给手机；供应商凭据仍只在主进程读取与使用，手机不接触任何密钥。`mobile.summary` 随之多出两个可选区块——项目目录与供应商摘要（只含 id、名称、是否电脑默认、档位与四个档位解析后的模型名，不含 `baseUrl` 或任何凭据字段）——它们复用 `app.agent.group.list` 背后的同一份项目列表，不新增选项目录。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。
- Terminal 标签（workspace）作为可寻址对象补了 5 个 MCP 工具，44 → 49 的来源就是这一组：只读的 `workspace.list` / `workspace.get`（各标签持有的 `sessionIds`，按布局先序），写入的 `workspace_pane.create`（创建一格分屏）/ `workspace.rename` / `workspace.delete`（关掉整个标签）。寻址沿用不可变 `sessionId`——pane 与 session 是 1:1，要切哪一格就用它承载的会话指明，这一层负责按当前布局解析成 pane；布局树与 pane id 不出现在任何请求或返回值里。`workspace.delete` 只走正常终止、不提供 `force`。权限族为 `terminal.workspace.manage`（分屏与改名）与 `terminal.workspace.delete`（关标签），两者不得互相推导。
- Terminal 分屏的**比例调整、平分与拖拽重排**仍只属于现有 System App 的 UI IPC：它们改变既有 pane 的排列而不增减会话，不注册 MCP capability、tool 或 Deep Link。
- Agent 对话与 Terminal pane 的工作目录文件树只通过受权限与审计保护的 UI 私有 IPC 读取、监听并解析拖拽选中项；Agent 使用项目目录，Terminal 优先使用 OSC 7 报告的实时目录；shell 报不出目录时（自定义 shell、pwsh / cmd）按需探测一次该 PTY 前台进程的 cwd（走 `process.cwd_probe` 这个窄动作，权限与审计由受控执行器一并完成，不做定时轮询），仍拿不到才回退到会话启动目录。文件树路径拖拽只写入 Agent 草稿或当前 Terminal session，不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 分屏标题栏的 Git 分支、未提交文件数与同步按钮使用同一实时工作目录探测和现有按路径执行的 Terminal Git 服务；同步仅允许目录未变化时执行，遵守既有未提交改动、上游和快进限制。该入口只属于 UI 私有 IPC，不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 图片剪贴板落盘仅属于现有 System App 的 UI 私有 IPC，用于把临时 PNG 路径交给当前 PTY；不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 用户快捷命令的增删改查仅属于现有 System App 的 UI 私有 IPC；执行仍复用当前 session 输入，不注册 MCP capability、tool 或 Deep Link，Terminal MCP 工具数量保持 49。
- 手机端终端快捷栏分两段，各自定义：**前段**是手机自己的固定键（方向键、`Tab`、回车、`Ctrl+C`、`/exit`、`/clear`），写在 `SynapseMobile` 自己的 `TerminalToolbarState.frontRow` 里；**后段**是用户的快捷命令，由主进程用终端服务自己的 `listMobileToolbarButtons()` 投影成 `mobile.toolbar` 下行消息。电脑的内置注册表（在 `desktop/app-capabilities/terminal/shared/toolbar-actions.ts`）只供电脑自己的工具栏使用，**不再下发给手机**；`mobile.toolbar` 的 `buttons` 从此只装用户写的条目，协议本身不变。手机不新增、不修改、不删除任何按钮，也不回写桌面配置。投影源是主进程内部方法而非 IPC 或 capability；手机按键一律走既有 `keys` / `command` 意图，不新增 intent。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。
- 手机端终端分组的启动命令同样是终端能力那份列表的**只读投影**：主进程用终端服务自己的 `listMobileGroupCommands()` 把用户在每个分组上配好的启动命令投影成 `mobile.groupCommands` 下行消息（只带 `groupId`、命令 `id` 与 `name`，不含命令正文、环境变量、cwd 与 shell —— 桌面自己那个「以命令启动」下拉也只写名字），手机据此决定分组行上画不画箭头；选中一条走的是既有 `launchCommand` 意图，不新增 intent。投影源是主进程内部方法而非 IPC 或 capability；该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量（49）均不变。
- Terminal 底部命令条上的「快捷输入」入口读取「快捷输入」System App 的 `app.quick-input.items`，只走现有渲染进程 UI，不新增存储、IPC 通道或协议。选中后只填入终端、由用户按回车执行，不显示重复内容或待执行提示条。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link，Terminal MCP 工具数量保持 49；手机端既有的 `mobile.quickPhrases` 与此无关，未作改动。
- Terminal Claude Code 原生通知的设置、活动 session 上报与点击后的精确会话定位仅属于现有 System App 的 UI 私有 IPC；Codex 不接入。通知 Hook 入口是会话级 loopback 内部端口，不注册 MCP capability、tool、Workflow Node 或 Deep Link，Terminal MCP 工具数量保持 49。同一 Hook 事件还把"是否等待用户输入"写入会话既有 `attention`（`waiting` + `approval` / `agent_question` 等 kind，恢复时回到 `not_waiting`），仅在 Terminal 侧栏与顶部标签显示标记，并随既有 `state.get` / `observe` 暴露给 MCP 调用方；不新增存储字段、capability、tool 或审计对象。
- Terminal 会话状态响应（`session_state.get` / `.list` / `session.observe` / `session_output.observe`）以及 `session.list` / `session_summary.get` 另外带三样只读内容：会话所在终端标签的 `workspaceId`（会话不在任何标签里时为 `null`。标签与分屏只活在 Renderer 的聚合层；这一项只报归属，标签本身另由 `workspace.list` / `.get` 提供，两者都不返回布局树），会话自己的 PTY 设备名 `tty`（调用方据此 `ps -t` 认领跑在里面的进程，是「粘贴一段引用去找到对家 Claude Code」那一步的接点，不依赖 Agent 原生通知，Windows 无此设备时缺席），以及 `app.terminal.agent-sessions` 五态档案的投影块 `agent`（只含 `state` / `agentKind` / `version` / `lastActivityAt` / `stateChangedAt`；`transcriptPath` 指向用户整段对话、`pid` 与 agent 自己的会话 id 是宿主进程细节，一律不出进程，投影在通知服务内部完成，原始档案类型不越过服务边界）。`agent` 缺席（这里从来没有 agent，或 Agent 原生通知未开启）与 `state: "ended"`（跑过、已退出）是两件不同的事，不得合并。该投影不新增 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link，Terminal MCP 工具数量保持 49。
- Terminal 分组拖拽排序仅属于现有 System App 的 UI 私有 IPC：顺序写入分组既有 `sortOrder` 字段，不注册 MCP capability、tool、Workflow Node 或 Deep Link，不新增 Terminal MCP 工具。
- Terminal 标签（workspace）的置顶仅属于现有 System App 的 UI 私有 IPC：写入 workspace 记录既有字段，只改变同分组内排序；它随 workspace 一起只活到本次运行结束（ADR 0215），不注册 MCP capability、tool、Workflow Node 或 Deep Link，Terminal MCP 工具数量保持 49。
- Agent 侧栏项目分组顺序存放在全局配置 `global.agentProjectOrder`，只影响侧栏展示顺序，不重排 `config.global.projects`，不注册 MCP capability、tool 或 Deep Link，Agent Conversation 工具数量不变。
- 手机端的 Git 操作走一个新的 `git` intent（`action` 是枚举：`status` / `branches` / `checkout` / `createBranch` / `commit` / `push` / `sync` / `merge`，不接受任意命令字符串），状态经 `mobile.gitStatus` 下行消息按会话推送，写操作的权限族是 `terminal.git.manage`（读走既有的 `terminal.state.read`）。它执行在**终端当前所在的目录**上：目录来自 shell 上报的 OSC 7 与 `process.cwd_probe` 兜底，**只认路径**，不接「代码仓库」注册表、不产生 `repositories.json` 条目，与 `app.git.*` 那套既有的 Git 应用没有产品关系（共享的只有底层命令封装与解析器）。冲突一律在电脑侧自动 `merge --abort` 回退、只回一段可复制的文本，手机端不解决冲突。该入口不注册 System App、Dock、Workflow Node、Automation Action、MCP capability/tool 或 Deep Link：`app` domain 与 Terminal 的 MCP 工具数量均不变。

- 手机终端分别通过只读 `sessionReference` / `workspaceReference` intent 复制指定分屏/标签；标签可点名手机当前或最近查看分屏，未点名时由电脑取布局首格，并校验会话归属。主进程复用 PC 的五行格式化逻辑，完整文本随既有 `mobile.intentResult` 的 `referenceText` 返回，另带 `workspaceId` 与 `sessionId` 校验目标。权限与审计复用 `terminal.state.read`，无需 attach 或租约；手机只写本机剪贴板。无新增 System App、Dock、Workflow Node、Automation Action、IPC operation、MCP capability/tool 或 Deep Link，上表数量不变，Terminal MCP 工具仍为 49。

- 手机终端的 `workspaceFiles` 是 UI 私有、只读 scope 协议：按需浏览目录、搜索文件、查看文本与 staged/unstaged diff，并准备插入本机草稿的 shell 引用。可信连接归属由云 relay 与桌面校验，读取由桌面 PermissionGuard/AuditSink 执行；内置Git转换仅另读精确授权的标准global/local配置，不形成通用配置读取能力；云端不持久化源码。它不注册 System App、Dock、Workflow Node、Automation Action、IPC operation、MCP capability/tool 或 Deep Link，上表数量不变，Terminal MCP 工具保持 49。

## 普通业务模块 System App

| System App | 应用页 | 默认 Dock | 关联 MCP domain |
|---|---:|---:|---|
| Agent | 是 | 是 | `app` |
| Workflow | 条件显示 | 条件显示 | `workflow` |
| Drive | 是 | 是 | `drive` |
| Automation | 是 | 是 | `automation` |
| Launcher | 自身即应用页 | 是且不可移除 | — |
| Settings（含设备命名） | 是 | 是 | `repository` |
| Resource Repository | 是 | 否 | `content`、`skill_repository` |
| Git | 是 | 否 | — |
| Database | 是 | 否 | `database` |
| Editor Scan | 是 | 否 | — |
| Usage Monitor | 是 | 否 | — |
| Model Price | 是 | 否 | `model_price` |
| Connectors | 是 | 否 | — |
| Mail Internal | 是 | 是（邮箱左侧） | `mail_internal` |
| Todos | 是 | 否 | `todos` |
| Meeting | 是 | 否 | — |

Settings 的基础设置增加设备名称，通过 `app.live.device.get_settings` / `app.live.device.set_name` 两个 UI 私有 IPC 读写。机器绑定在 Live 主进程与握手中处理，名称不参与身份判断。System App、Dock 与上表 MCP 数量不变，新增公开 capability/tool、Workflow、Automation、Deep Link 数量均为 0。

Settings 已移除空置的“实验功能”分类及占位内容。此调整仅涉及设置导航，System App、Dock、Workflow、Automation、MCP 与 Deep Link 注册数量和接口均不变，MCP schema 与系统 Skill 指南无需变更。

默认 Dock 从 app definition 的 `dock.pinnedByDefault` 与 `dock.order` 派生，共 9 项，顺序为：`agent`、`drive`、`automation`、`workflow`、`terminal`、`settings`、`mail-internal`、`mail`、`launcher`。Workflow 由统一 System App `visibility` 与 `workflowEntryVisible` 控制。

Dock 升级迁移按 `DOCK_MIGRATIONS` 的稳定 ID 顺序执行，完成记录保存在 `global.dockMigrationIds`，与 `global.dockAppIds` 一次原子写入。历史 `dock.mail-introduction.v1` 中的 `mail` 仍表示站内信；改名迁移先将其归入 `mail-internal`。新增 `dock.mail-apps-introduction.v1`，将末尾一次性排为 `mail-internal` → `mail` → `launcher`（「应用」），已有图标只移动且不重复，其它应用相对顺序不变，即使此前移除过站内信也会执行这次独立迁移。新安装默认包含两款邮件应用并预先记录当前迁移；用户之后移除任一邮件图标、排序或恢复默认不会重跑已完成迁移。备份同时携带布局和完成记录；缺少记录的历史备份视为待迁移配置。System App、MCP、Workflow、Automation 与 Deep Link 的注册数量均不变。

Git 仍是普通 System App，不新增 MCP domain。其带恢复 journal 的原子 clone、仓库注册、状态与差异预览、主进程选择令牌、精确提交与按文件丢弃、同步、空仓库初始化与远端默认分支接入、缓存远程分支发现与 tracking 检出、SSH 主机密钥、操作状态与取消能力只通过窄类型化 Git IPC bridge 暴露；仓库目录定位复用受权限与审计保护的 Shell IPC，设为项目复用系统设置的全局项目配置与添加流程。Agent 项目与 Git 仓库根路径精确匹配时，composer 可复用同一 Git IPC 执行确认后的全部改动提交及常用远端操作，并可定向打开对应 Git 工作台；该入口不经过 Agent、MCP 或通用命令执行。这不改变上表的 capability 或 MCP 数量。远程分支、空仓库初始化与文件丢弃能力不注册任意 Git 命令入口，也不扩展为 Workflow、Automation、MCP 或 Deep Link 表面。

MCP 不是 System App，不进入启动器、Dock 或独立应用窗口。系统设置中的 MCP 分类是全局 MCP Server 与外部客户端注册信息的唯一 UI 入口；它聚合当前全部已注册 domain，但不新增 capability 或 MCP tool。Connectors 是独立的 System App；客户端内置定义通过 `integration.kind` 选择 Driver，状态写入版本化的 Synapse DataRepository，并在内置 Claude SDK 会话创建时临时注入 MCP 和对应 Skill，不写入外部 Claude 配置。V1 仅支持无认证的 `http://127.0.0.1:<port>/<path>` Streamable HTTP MCP；探测必须完成 MCP 初始化、initialized 通知、`tools/list` 和必需工具校验，失败或超时不得启用。当前 Figma 定义使用 `http://127.0.0.1:3845/mcp` 和内置 `figma-skill`，Skill 不声明 Figma 写入能力。新对话把已启用的连接器 ID 固化到会话快照，并从同一份 Agent Contribution 加载 MCP 与 Skill；已有对话不会因之后启停而动态变化，最终 Query 缺少或连不上预期 MCP 时只降级该工具，不阻断普通对话。

Meeting 是普通 System App（界面上的名字是「录音」），不新增 MCP domain：录音与转写文字只通过桌面端与手机端的用户界面读写，没有注册 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link。它注册 12 个 UI 私有 IPC operation（`app.meeting.*`），用于录音起止、分片上报、录音读写与删除、转写重试、回放地址与波形，以及音频本机缓存；分片是裸字节，经主进程代理写入平台媒体对象存储，不进用户云盘。发言人与纪要在两端的界面上都已去掉，对应的写入 IPC 与 HTTP 接口一并下线；服务端 DTO 仍照常返回 `speakers` / `minutes` 等字段，手机端才不会因旧版本解码失败。异常退出留下的未完成录音由主进程在启动时静默收尾，不占用任何 IPC——但**只收本机录的那一条**（判据是本机暂存目录还在不在）：手机端上线后两端录的是同一批数据，无条件收尾会把对方正在录的那条强行结束掉。服务端的 `GET /meetings/recordings/pending` 因此多了可选参数 `?all=1`，无参数时的行为不变，旧版桌面端照常可用。转写完成后服务端经既有 `broadcastToUser` 通知桌面端，并经 `MobilePushService` 的 `MEETING_TRANSCRIPTION` category 通知手机——两者都不改变上表的 capability 或 MCP 数量。转写进度：详情 DTO 多返回一个可选的 `transcription`（阶段 / 服务端此刻的已用时长 / 按音频时长估的预期耗时），两端据此画一条会往前走的进度条（封顶 95%），秒表由客户端在两次刷新之间接着走；这只是既有 `app.meeting.entry.get` 的一个字段，没有新增 operation。转写失败的重试只覆盖**投递阶段**的抖动，识别引擎判定音频不可识别属终局、一次收尾不再重投。新增的第 12 个 operation 是 `app.meeting.audio.ensure`（`{ meetingId }` → `ready` / `downloading` / `unavailable`）：音频在本机留一份，听过的再听不走网络，没网也能听听过的那些。**缓存是纯客户端行为，服务端零改动**——失效判断用的 `recording.status` 与 `recording.size` 详情接口本来就在返回。缓存只有这一个 operation，没有配套的清理入口：清理是主进程自己的事。桌面端缓存目录是 `userData/meeting-audio-cache/`，手机端沿用录音落盘目录，两端都不进 `DataRepository`（派生产物，禁止把大文件字节写进去）；两端各自的命中判据、2 GB 上限与清理时机必须一致。界面上不出现缓存的任何痕迹——没有「已下载」「已缓存」「离线」「本地」任何一个词，列表行也不加标记。手机端的录音实时活动另有一条**只属于手机**的深链 `synapse://recording`：锁屏和灵动岛上那张卡片点一下落在录音界面，而不是把这一条结束掉——卡片是「带我去看」，那两个按钮才是「替我做」。它由 iOS App 自己注册与解析（`CFBundleURLTypes` + `onOpenURL`），不经桌面端协议路由：桌面端的 `synapse://` 路由对它照常按未知路由处理（一条 warn 日志加聚焦主窗口），不新增 System App、Dock、Workflow Node、Automation Action 或 MCP capability/tool。手机端因此成为第一个注册 Deep Link 的客户端；「卡片点开落在录音界面且不起新录音」与「按钮在 App 进程里执行」两条同时成立，见 `docs/superpowers/specs/2026-09-19-mobile-recording-design.md` 的补记。

2026-10-16 站内信人员筛选新增 `app.mail_internal.contact.list`（MCP `app_mail_internal_contact_list`），并给 `app.mail_internal.message.list` 增加可选 `contactKey`。名单仅从当前账号完整可见信箱聚合；收件箱是发件人，已发送是 To/Cc 地址快照中的个人与组织，不展开组织成员。该只读能力沿用 Mail 权限与审计；Mail 增至 17 项，当前全局 capability 293 项、MCP 索引 289 项。System App、Dock、Workflow、Automation 和 Deep Link 无增量，公开 MCP 仍为 `search`、`invoke` 两个。桌面新增侧栏和窄窗口选择器，iOS 入口不变。

## MCP capability domain

| Domain | Capability 数 | MCP Tool 数 |
|---|---:|---:|
| `app` | 95 | 91 |
| `database` | 30 | 30 |
| `model_price` | 11 | 11 |
| `repository` | 1 | 1 |
| `skill_repository` | 9 | 9 |
| `automation` | 14 | 14 |
| `workflow` | 19 | 19 |
| `content` | 16 | 16 |
| `drive` | 76 | 76 |
| `mail_internal` | 17 | 17 |
| `mail` | 44 | 44 |
| `todos` | 6 | 6 |
| `wecom` | 2 | 2 |
| 合计 | 340 | 336 |

企业微信的 2 项 capability / MCP 索引保持不变。消息工具描述和系统 Skill 指向当前正式安装源，提供直接参数示例，区分本人、单聊、群聊和上下文指代；默认走已连接机器人，仅显式指定或任务已绑定时走 Webhook，不自动回退渠道。此次只调整使用指引，不新增 System App、Dock、Workflow、Automation Action 或 Deep Link，公开 MCP 仍为 `search`、`invoke` 两个。

`synapse-tool-router` 的 `search`、`invoke` 是所有 MCP 客户端的**唯一**公开工具表面：`/mcp` 的 `tools/list` 只返回这两个工具，`initialize` 返回说明两段式调用流程的 instructions。内置 Agent 会话通过 SDK 注入进程内 server（名字前缀 `synapse-tool-router`），外部客户端通过 `/mcp` 看到的是 `synapse-mcp` 的 `search`、`invoke`，两者共用同一实现、同一 instructions 与同一 action router。

上表 336 个工具仍注册在 capability catalog 与 `MCP_TOOL_ACTIONS` 中，作为 `search` 的索引和 `invoke` 的 action 映射，但不再出现在 `tools/list` 里。它们计入 MCP Tool 数，不计入公开工具数——公开工具数恒为 2。

`app` domain 中不映射 MCP tool 的四个 capability 固定为：

- `app.javascript.script.execute`
- `app.nodejs.script.execute`
- `app.clipboard.text.write`
- `app.clipboard.text.read`

Drive 的 `app.drive.share.create` 与 `app.drive.site.create` 在未传访问设置时均创建公开、永久的新分享；网页分享创建工具只要求来源文件夹与名称。该契约调整不改变 `drive` domain 的 capability 或 MCP tool 数量。

Drive 分享详情卡片的“打开”按钮复用已有分享 URL 和外链打开能力，优先使用含密码的链接；分享过期或源文件删除时禁用。这是 UI 私有操作，不新增 System App、Dock、Workflow、Automation、Deep Link、capability 或 MCP tool；Drive 仍为 76 项，MCP schema 与系统 Skill 契约不变。

Drive 本地同步通过 10 个 `app.drive.sync.*` capability 暴露给 MCP：快照、预检、创建、暂停、恢复、解除预览、解除、排除规则、完整扫描和冲突处理。它们复用桌面端 `core.drive-sync`，不新增同步引擎。预检/创建支持 `authority`、`confirmationToken` 和 `replaceBindingId`。解除默认保留两端，删除选项必须先预览，执行时复验并持久解除关系，再按端可恢复清理；排除项与未管理内容保留，部分失败可按同一关系重试。桌面紧凑列表、详情 Popover、直接重新映射入口及选择器属 UI 私有表面，不增加 System App、Dock、Workflow、Automation 或 Deep Link。

2026-10-16 新增 `app.drive.file.replace.preview/apply` 两个 capability / MCP 工具，支持将同扩展名本地成品上传为指定文件的新版本，保留身份、名称、分享与历史。它们复用 `core.drive-sync` 的版本化上传、同步基线检查、工作取消及权限审计；预览令牌绑定目标、版本、本地内容与本机同步配置。保留原文本编辑上传的版本依据保护。Drive 现在总计 76 个 capability / MCP 索引工具（原 73，加文件替换 2、解除预览 1）；公开 MCP 仍只有 search/invoke。网页端的上传版本预检与 Site 未发布变更标记是既有 HTTP/UI 行为，不新增 MCP。

Drive 分享评论通过 7 个 `app.drive.link.annotation.*` capability 暴露给 MCP：线程列表、新建线程、回复、编辑评论、删除评论、删除线程和讨论状态更新。仅讨论创建人可通过 `app.drive.link.annotation.thread.status.update` 设置 `open`（未解决）或 `resolved`（已解决）；列表与变更结果返回 `status` 和 `permissions.canChangeStatus`。状态独立于定位与删除，解决后保留原位及所有回复，回复不自动重新打开，同状态重试不产生额外变化。文字评论直接提交 quote；整图评论先通过 `app_drive_link_read_text` 取得 `imageId`，再创建线程。图片或文字目标失效后保留为未定位线程，不提供手动重关联。删除评论会连带删除其全部后代回复，删除首评会移除整条讨论。它们只接受当前 Synapse `/share/...` 下文件名以 `.md` 结尾或 MIME 为 `text/markdown`、`text/x-markdown` 的 Markdown 文档，复用现有分享访问、评论权限和审计；不开放文档编辑、presence 或协同房间控制。

Drive 文末留言通过 7 个 `app.drive.message.*` capability 暴露给 MCP：列表、留言新建/编辑/删除、回复新建/编辑/删除。目标明确为自己的 Markdown 文件 `itemId` 或当前 Synapse `/share/...` URL；分享目标可提供密码、子文件 ID 或相对路径。留言不带正文锚点，不进入 Markdown 内容或版本历史。作者仅能编辑自己写的内容；作者与文档所有者可删除，删除时连带全部后代回复。分享返回的作者邮箱被隐藏。 留言和回复 `body` 支持 Markdown（上限 4000 字符），返回服务端安全渲染的 `bodyHtml`。浏览器专用图片上传复用平台托管对象，不新增 MCP 工具，以上 7 个 capability 的数量不变。

Drive 已保存文本通过 `app.drive.file_content.inspect` 获取固定版本和字节数，通过 `app.drive.file_content.read_chunk` 有界读取源码，通过 `app.drive.file_content.patch` 在指定版本上做局部编辑。三个能力只处理 owner 自己云盘里已存在的 Markdown、纯文本和 HTML 源文件；补丁复用浏览器在线编辑器的并发校验、版本历史、配额与协同代际。旧 `app.drive.file_content.read/write` MCP 能力已删除；浏览器整篇编辑 HTTP 接口仍保留。对应的文本上传覆盖路径（`app.drive.file_upload`）仍要求基线版本。分享场景、文件夹上传与二进制文件不在补丁契约内。

浏览器 Markdown/MDX 正文编辑器及文末留言/回复编辑器的平台托管图片属于现有 Drive Web UI 私有能力，使用 `/object/<objectId>`，不注册 System App、MCP capability/tool、Automation Action 或 Deep Link。`/object` 是平台托管对象的公共命名空间，不限定未来对象类型。Agent 处理本地 Markdown、HTML 与明确的图床/直链请求时仍使用既有 Drive 文件、Site 和 `app.drive.direct_link.*` 能力。

## 同步硬规则

- 新增、删除、重命名或改变任意 System App、默认 Dock、Workflow Node、Automation Action、MCP capability/tool、Deep Link 或 `desktop/app-capabilities/<id>` 能力包时，同一次改动必须更新本文件的表格、数量、例外和默认 Dock 顺序。
- 修改启动器可见性、Workflow 条件入口、`systemApp`、`discovery`、`openable`、`pinnableToDock`、`defaultDock` 或任何改变产品表面的过滤逻辑时，也必须同步。
- 即使改动不在 `desktop/app-capabilities/`，只要影响普通 System App 或 MCP domain，就必须更新本文件。
- 只修改能力内部实现且注册表面不变时可以不改数字，但必须主动核对本清单仍与运行时装配一致。

云端待办能力层注册六个 todos action，复用账号认证与 network.connect 权限，IPC 和 MCP 共用 dispatcher。onChanged/onReset 仅 UI 订阅，不计索引；身份重登清空内存，普通 token 刷新不清空。内容不进入请求/审计日志。待办为第 21 个 System App，默认 Dock 顺序不变，可手动固定；主窗口/启动器嵌入与独立窗口使用同一内容。新增一条严格 synapse://todos/<id> 桌面路由和 UI-only apps.onTodoOpenRequest 事件，不新增 MCP；消息中心查看待办先已读再只读定位，原生横幅无新 click 能力。

2026-10-12 审核修复：桌面更多菜单的完成／恢复复用既有 completion 操作；iOS 待办通知统一按通知 ID 重取、标记已读并解析本次服务器记录。旧回执隔离与服务端投递租约、过期、APNs 超时修复均为内部行为修正；仍为 21 个 System App、6 个 todos capability / MCP 索引，桌面与 iOS 各一条 Todo 路由，Workflow、Automation 和默认 Dock 无增量，MCP schema 与系统 Skill 指南无需新增动作。

2026-10-11 集成核对：从实际 `CAPABILITY_DOMAINS` 累加 289 项、`MCP_TOOL_ACTIONS` 与 `buildAllMcpTools()` 各 285 项；`todos` 均为 6。System App 注册测试列出 21 个应用。相对实施前增量为 1 个 System App、6 个 capability / MCP 索引、1 条桌面 Todo 路由及 1 条 iOS Todo 路由；Workflow / Automation 增量均为 0，默认 Dock 无增量，公开 MCP 工具仍为 2。iOS 入口为主页现有导航栈，不注册桌面 System App 或额外底栏。

2026-10-23 Automation 的 `builtin.cron` 与 `builtin.interval` 配置新增可选 `timeRange: { start, end }`，由既有触发器发现工具返回 schema，创建和更新沿用通用 trigger config。活跃日和每日范围共同限制自动触发与启动补跑，缺省全天；手动运行不受限。Automation 仍为 14 个 capability / MCP 索引，System App、Dock、Workflow、Automation Action 和 Deep Link 数量不变。

2026-10-23：站内信桌面 App ID 为 `mail-internal`，公开 capability namespace 为 `mail_internal`，深链为 `synapse://mail-internal/<id>`；17 个工具整体改名且无别名，数量不变。旧 App 配置在校验前按一次性标记完成改名，改名本身保留取消固定状态和布局；随后独立的双邮件入口迁移按上述新顺序固定两个图标。历史 introduction 条目保留原样。服务端和手机入口必须同批完成切换后再发布。

2026-10-23 邮箱核心接入：新增 `mail` domain 的 44 个 capability / MCP 索引工具，实际全局 capability 340 项、MCP 索引和工具定义各 336 项。公开 MCP 仍只有 search/invoke。新增严格桌面路由 `synapse://mail/em_<uuid>`，站内信 `mail-internal` / `mail_internal` 独立保留 17 项且无别名。私有密码配置、图片资源和本机文件对话框只走 IPC，不进公开目录；core.mail 在窗口建立后后台恢复，不调用云端消息中心。该核心阶段未增加应用；随后阅读界面阶段已注册为下述第 22 个 System App。

2026-10-23 邮箱阅读界面注册为第 22 个 System App：App ID / namespace 均为 `mail`，与 `mail-internal` 并列，启动器可打开；后续 Dock 调整已改为默认固定在站内信右侧、「应用」左侧，并对旧配置执行一次性迁移。内嵌和独立窗口复用单顶栏；私有 `app.apps.operation.mail_open_request` 只传定位信息。44 个邮箱 MCP 工具、340 个全局 capability、336 个索引工具保持不变，不新增 Workflow 或 Automation Action。

2026-10-23 邮箱接入与写信面板：配置向导、账号设置、富文本草稿、附件与发送均复用 44 项核心动作；私有 `app.mail.draft.image_asset` 只返回当前草稿已关联的受控图片，不进入 MCP / HTTP 目录。邮箱仍是第 22 个 System App，44 个邮箱 MCP，340 个全局 capability / 336 个索引工具，默认 Dock 无变化。

2026-10-23 邮箱与站内信分别使用各自模块 `assets/icon.png` 中的用户指定蓝色/黑色图标，启动器与 Dock 共用 manifest 资源。仅替换图标，22 个 System App、340 个 capability、336 个 MCP 索引及各自深链均不变，MCP schema 和系统 Skill 无需调整。

2026-10-23 邮箱体验调整：独立写信使用同一 `mail` System App 的私有 `MailOpenRequest.compose`，不新增 App、Dock、Workflow、Automation 或 Deep Link。新增 UI 专用 `app.mail.draft.prepare`、`app.mail.draft.commit`、`app.mail.compose.image_asset`、`app.mail.compose.retain_assets` 四条 IPC；前两者区分未保存编辑与首次显式保存，后两者在不保存草稿的情况下显示和保留编辑图片/附件。已有草稿创建及首次保存的 UI IPC 将草稿 ID 绑定到当前写信窗口，避免重复打开。公开邮箱能力仍 44 项，全局 340 capability / 336 MCP、桌面 System App 22 个不变；这些私有 IPC 不向 Agent 暴露。

2026-10-23 邮箱阅读区保留固定回复工具栏，其下邮件信息、附件和正文一起滚动，移除头部重复链接区，原文链接复用既有受控打开能力；用户批准仅为正文测量与点击接管开启 sandbox 同源读取，脚本仍禁止。上表 Mail 的各注册项不变，邮箱仍为 44 项公开动作、桌面 System App 22 个；MCP schema、系统 Skill 的读信契约不变。

2026-10-23 草稿箱提供与收件箱一致的多选、全选和计数，最多 100 封，确认后逐项调用已有 `draft.delete` 并校验各自 revision。删除按钮显示加载状态，弹窗实时显示剩余待处理数量，每项成功或失败后更新，全部处理后显示列表刷新状态；进度仅在 Renderer 内传递。删除失败保留草稿及选择，刷新仅重读已加载的草稿页；不新增批量 IPC 或公开动作。邮箱仍为 44 项公开动作，全局 340 capability / 336 MCP 索引、22 个 System App 及 Dock、Workflow、Automation、Deep Link 数量均不变；MCP schema 保持逐封删除，系统 Skill 的逐封删除契约不变。

2026-10-23 写信窗口移除密送入口与顶栏关闭按钮，仅保留收件人/抄送和原生关闭；窗口显式保存或发送会清空已有草稿的密送地址。共享 MCP schema、系统 Skill 的 Bcc 契约保留兼容，不新增注册表面，邮箱 44 项公开动作、全局 340 capability / 336 MCP 索引和 22 个 System App 均不变。

2026-10-24 邮箱远程图片兼容系统 DNS 的 IPv4 Fake-IP：经受控 HTTPS DNS 重新解析并固定真实公网 IP，保留逐跳私网拦截；阅读区逐张加载、保留成功项和报告失败数量。沿用私有图片 IPC，44 个邮箱公开动作、340 个全局 capability / 336 个 MCP 索引及 22 个 System App 数量不变；Dock、Workflow、Automation 和 Deep Link 无增量，公开 MCP schema 无变化。

2026-10-24 邮箱同步任务新增可选 syncProgress 返回字段，区分索引与状态校对并上报已确认批次进度；sync.get 描述与系统 Skill 同步。44 个邮箱 MCP、340 个全局 capability / 336 个索引工具、22 个 System App 及既有 IPC、Dock、Workflow、Automation、Deep Link 数量均不变。


个人联系邮箱：`app_mail_internal_recipient_list` 的候选 DTO 新增可空 `contactEmail`，供外部邮箱按姓名查地址；仍仅可查询共同团队的活跃成员，不返回登录邮箱，不扩大站内信投递权限。现有工具与路由数量不变，旧桌面透传响应即可读取新字段；本机 Skill 需同步新查询流程，其他客户端随内置 Skill 更新生效。

2026-10-24 外部邮箱地址显示修复：既有 message.get 输出增加可选 headers.sender，补充原始名称与代发说明；不新增动作、IPC、权限或注册入口，邮箱仍为 44 项。

2026-10-24 邮箱身份隔离加固：account.list 描述与系统 Skill 明确账号只能来自当前登录身份，工具不可用时不得读取私有数据库或缓存兜底；Agent Runtime 的 SDK 文件工具预检与强制 Bash 沙箱保护私有存储。不新增动作、IPC、权限或注册入口，邮箱仍为 44 项，能力表及总数不变。

2026-10-24：邮箱写信新增按部门选择实际 To/Cc，复用 `app_mail_internal_organization_list` / `app_mail_internal_organization_members_list`（成员返回可空 contactEmail）作外部邮件只读地址解析。无新增工具、App、深链或注册项，mail 44 / mail_internal 17 数量不变。缺失联系邮箱必须提示并由用户明确排除，组织 ID 不进入外部发送 payload。

2026-10-24：邮箱地址弹层新增「写邮件」，通过私有 `MailOpenRequest.compose.recipient` 预填新信收件人，并按账号及收件地址复用窗口。复用现有 draft.prepare/commit，无新增公开工具、App、Dock、Workflow、Automation 或 Deep Link；mail 44 项公开动作及全局数量不变，MCP schema 和系统 Skill 的新信创建契约不变。
