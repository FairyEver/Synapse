# 模块长期边界

本文件只记录跨入口、跨存储或容易被后续改动破坏的稳定边界。修改某个模块前还必须在 `docs/` 中搜索其设计规格和 ADR。

## 待办事项

- 待办属于当前登录账号，由服务端 PostgreSQL 保存；桌面、iOS 与 AI 共用六条账号 API。客户端只保存内存视图，不得将正文、草稿或离线写入队列持久化到本机。退出或切换账号必须清空视图并使迟到请求失效。
- 标题按 Unicode 码点计数，时间使用带偏移的分钟精度瞬时值；字段缺省表示保留，null 清除可选值。版本比较与幂等收据同事务提交；创建请求键长期随条目保留，删除墓碑保留 90 天。不存在、已删除与非本人目标统一返回不可用。
- 日志只包含请求、事项 ID、版本等元数据，不记录标题、备注、查询内容或完整请求。提醒、通知定位与跨端行为见 [云端待办事项设计](../superpowers/specs/2026-10-11-cloud-todos-design.md)。
- 云端提醒每 30 秒扫描最多 100 项，与完成、删除共享行锁；仅补偿 24 小时内仍待触发的提醒。账号通知、已触发代际与投递 outbox 同事务提交，网络只在提交后投递；重试复用通知 ID，已读、删除或超过原提醒时间 24 小时后停止外部投递。来源 `todo-reminder` 归服务端，桌面发送 API 不得冒充；生产 APNs 网关保持不变。
- outbox 每项投递前复验并续期仍属于本 worker 的有效租约，投递期间每 20 秒续租；租约失效、续租失败或到达 24 小时截止时取消在途请求并停止后续设备投递。批次内的过期判定与失败退避使用实际经过时间，且在数据库等待结束后复验，不能沿用批次开始时刻。APNs 单次连接最多等待 10 秒，超时销毁连接并保留 token，允许 outbox 后续重试。
- 桌面默认未完成，未完成 / 全部共用一张 `Card`；iOS 从主页进入现有导航栈的原生单列列表，四个底栏不变。账号状态、网络请求和导航目标分别由既有认证客户端、Todo store / hooks 和目标处理器持有，界面不能另建持久化或鉴权逻辑。
- `synapse://todos/<id>` 仅以严格单一 ID 只读定位，不接受 query / fragment / 编码分隔符。目标不在第一页时按 ID 读取，已完成切全部；未登录目标等登录，新导航或身份变化取消旧目标。通知先读取本人可见记录并标记已读，再依据服务器来源与目标打开；桌面原生横幅没有新增点击回调。
- 写入失败保留草稿、原版本和重试 UUID；冲突重读后不得自动覆盖或重放。完成撤销使用成功回执版本；恢复不重发已经发送或已经过期的提醒；删除不支持恢复。
- 写入回执只用于确认结果及撤销版本，列表由成功的服务器读取更新；刷新失败保留已有视图，不把旧回执插回已完成、删除或不在当前页的条目。桌面更多菜单与完成控件共用完成／恢复操作。

## 站内信

- 管理员会话可通过后台只读接口查看所有已发送 `MailMessage`，包括平台公告、回复、转发和用户已软删除的历史消息；管理员读取正文与会话必须写入审计日志。该入口只返回发送时地址快照和附件元数据，不展开组织成员、不提供附件下载，也不改变普通用户站内信的读取、已读和删除边界。
- 一封信只在发件人所属的一个团队中投递；To/Cc 可混选具体用户与该团队组织。组织含下级成员，实际收件人在发送事务中按最新成员关系展开并去重，To 优先于 Cc，排除发件人；人数不设 50 人上限。组织失效则拒绝发送。历史信件保存所选地址快照，只展示组织名和单独选取的个人；实际收件记录只用于投递与访问控制。信件正文与每人的已读、删除状态归站内信存储，通知只包含发件人等安全摘要。
- 平台公告是唯一跨团队例外：仅管理员会话可通过 `/api/admin/mail-internal/broadcasts` 发送，发送时固定全站活跃账号，系统发件人显示「Synapse」，收件地址只显示「所有用户」而不泄露名单。每人可独立设已读和软删除，不可回复或转发；同一请求标识必须去重且内容不一致时拒绝。发信与审计在同一事务写入，仍经站内信通知 outbox 提醒。普通用户站内信的团队边界不变。
- 回复与转发在预览和发送时再次校验原信读取权及原团队；回复继承往来，转发开启新往来。不提供回复全部。引用由服务端保存直接来源信的不可变快照；新收件人不会因此得到原信的读取权限。关联往来只列出当前账号仍可见的信件。
- 附件只由本机文件直接上传到站内信专属存储，不从云盘选择或复制；分享云盘文件时将分享链接放入正文。未被信件占用、且不再被有效预览引用的附件满七天后进入持久删除队列；删除对象失败须保留队列以便重试。新信提醒记录与信件在同一事务写入待投递表；投递失败由定时任务重试，通知的 `sourceKey` 保证重复尝试不会生成第二条提醒。
- AI 发送走 Skill → MCP → 服务端，不唤起写信页面。用户已授权发送，且收件人、内容和附件都明确、没有疑惑或确需用户检查的内容时，检查服务端预览后直接发送；存在歧义、不确定、超出授权范围或用户要求先审阅时，才取得用户明确答复。起草或查看不构成发送授权；回复、转发、内容改动和预览过期后同样按此规则判断，不因生成内容或重新预览本身强制确认。`confirmed: true` 是调用者已核对发送授权与预览、无待解决问题的声明，不能证明用户在对话中确认了对应预览，不得描述为服务端强制验证的用户确认。
- 发布组织收件人功能时，先应用组织关系和地址快照数据库迁移，再发布新版服务端，最后发布桌面与 iOS 客户端。旧版个人收件请求继续由服务端接受。
- 站内信计数、未读筛选、全部已读、按 ID 批量删除和按信箱清空均以当前登录用户的可见副本为边界；清空信箱不受当前搜索或分页限制，删除仍为软删除。AI 对信件内容作筛选判断，MCP 不内置“无用信件”规则。
- 桌面信箱侧栏按完整可见历史汇总人员：收件箱按发件人聚合并显示各自未读数，平台公告独立显示 Synapse；已发送按发送时 To/Cc 中明确选择的个人与组织聚合，组织不展开成员，仅没有地址快照的旧信回退到个人投递记录。按账号或组织 ID 去重，按最近相关信件时间倒序、同时间按稳定 key 排序；已读变化不影响顺序。查找人员不受正文搜索、未读或已加载页影响。
- `GET /api/mail-internal/contacts` 与 `app.mail_internal.contact.list` 返回指定信箱的历史人员；`message.list` 的可选 `contactKey` 与正文搜索、未读及可见副本条件在分页前取交集，换筛选必须重置 cursor。选中人员后桌面隐藏全部已读、清空信箱，仍可按明确 ID 批量删除；删除最后一封保留人员筛选与空态。切换人员清除详情和批选，保留搜索与未读；切换信箱及通知/深链定位清除筛选。窄窗口使用可搜索选择器。MCP 全箱操作始终作用于完整信箱，不自动继承人员条件。
- 人员筛选需要先部署支持 contacts 与 `contactKey` 的服务端，再更新桌面客户端；无需数据库迁移。服务端在筛选列表响应中回传 `contactKey`，桌面拒绝未回传匹配值的响应，避免旧服务端忽略条件后误展示全箱。旧客户端不传该字段时行为不变；iOS 本次不增加人员筛选入口。
- 桌面站内信复制 `synapse://mail-internal/<id>`，通知复制 `synapse:notification:<id>`；前者复用既有站内信路由，后者只是带类型的 MCP 定位 ID，不注册桌面 Deep Link。两类 `get` MCP 工具接收原始 ID 或完整复制标识，必须二选一；服务端仍按当前账号校验读取权，复制标识不构成授权。

## App 能力包

### Connectors

- 内置连接器由静态 `BuiltinConnectorDefinition` 注册，类型差异只通过 `integration.kind` 对应的 Driver 实现；Service、IPC、Renderer 和 Agent Runtime 不得按连接器 ID 增加业务分支。
- MCP Driver 支持无认证的本机 IPv4 回环 Streamable HTTP MCP。启用前必须经过权限与审计，并完成 initialize、initialized、`tools/list` 和必需工具校验；定义、协议版本、超时和用户状态不得混存。
- `app.connectors.state` 的 singleton 保存 MCP 启用标志和探测状态；Portal 的独立 collection 记录按 owner/environment/connector 保存凭据引用与白名单身份摘要。Portal token 仅在 `app.connectors.credentials` 的 encrypted-json 中成对绑定 tenantId；不得使用通用 Secrets 工具可读条目。
- Portal 连接器仅由用户在现有 UI 授权，`portal-session` Driver 在主进程验证真实身份和企业成员关系；state 一次性、五分钟、绑定 SY 登录用户与环境。开关打开不等于已连接；账号切换、断开和重新连接必须使旧结果失效，重启重新验证。网络失败不视为凭据失效；没有自动刷新或 Portal token 吊销承诺。
- Portal Link Test（`portal-headless-test`）与 Portal Link（`portal-headless`）分别连接测试和正式环境，地址来自可信定义，凭据按 owner/environment/connector 隔离。Portal 不进入 Agent 连接器快照；两个纯凭据工具 `app_connectors_portal_link_credential_get`、`app_connectors_portal_link_test_credential_get` 分别固定读取正式、测试连接器，只允许 MCP 来源，并经过 secret.read 权限与审计；不接受环境、账号、地址覆盖，不跨环境回退。返回 Portal API 地址、会话 token、租户和已验证身份摘要；不申请 SY 扩展授权，不调用网络或业务 SDK。内部凭据接口不直接暴露给 Renderer 或通用 HTTP。读取期间账号、连接代次变化时拒绝旧结果。连接器内部 ID、回调、存储键保持兼容，系统 Skill 不包含 Portal 使用指引。授权契约见 `docs/integrations/portal-headless-test.md` 与 `docs/integrations/portal-headless.md`。
- 企业微信连接器使用 `integration.kind: "wecom"`，由主进程以固定平台二进制启动 `@wecom/cli`，不经过 shell 拼接。扫码凭据只存在于 `userData/connectors/wecom-mail` 下由 CLI 管理的加密文件；Synapse 只保存连接状态和本地时间，不上传凭据。连接器只负责机器人连接和信息展示，不承载业务 UI。`core.wecom` 是唯一的凭据使用边界：`app_wecom_connection_get` 只报告连接元数据，`app_wecom_cli_run` 接受官方 Skill 的规范参数数组并调用固定二进制；它不接受 shell 字符串，只允许已声明的企业微信业务服务和 `schema`，拒绝 `auth`、`cache` 与任意凭据。所有命令在按登录账号和可信 controller/client 隔离的临时工作目录中执行，用户文件必须先暂存到该目录；Renderer、模型和任意 CLI 均不能取得 token。机器人授权和企业业务权限分开判断，业务权限不足只在具体 MCP 调用中返回可操作错误，不改变连接器状态。所有 CLI 执行经过 `ControlledProcessRunner` 的 `shell.exec` 权限与审计，账号切换或断开必须取消旧授权和进行中的操作。
- 企业微信 Skill 长期只保留 2 个：`wecomcli-shared`、`wecomcli-message`。永久排除 `wecomcli-disk`、`wecomcli-todo`、`wecomcli-meeting`、`wecomcli-calendar`、`wecomcli-pptx`、`wecomcli-smartpage`、`wecomcli-doc`、`wecomcli-contact`、`wecomcli-media`、`wecomcli-email`、`wecomcli-doc-manage`、`wecomcli-sheet`、`wecomcli-smartsheet`；升级 CLI、更新或重新导入官方 Skill 时不得恢复其目录、路由或专属依赖，也不得整包覆盖上游 `skills/`。命令入口仅允许 `message`、`media`、`identity`、`schema`；`media` 仅允许消息发送所需的 `upload`，最小上传指引内聚在消息 Skill，拒绝下载及其他媒体命令。邮件、通讯录、文档搜索与名称/权限管理、在线表格和智能表格命令均不再开放；CLI、连接器、身份检查与消息共用的上传能力继续保留。固定来源和更新约束见系统 Skill 包 `wecom/UPSTREAM.md`，同步后必须通过两项 Skill 精确清单与命令拒绝回归测试。
- 企业微信中“给某人/某群发消息”“发给我”默认通过已连接的智能机器人执行；仅明确指定或任务已绑定时使用 Webhook，不因缺少会话或发送失败自动换渠道。本人取 `identity whoami` 的授权真人身份，其他对象只从本次可发送会话列表按类型和名称或明确指代匹配；历史 ID 只用于核验新列表中的同一对象。Skill 引用相对当前正式安装入口解析，不读取 `.synapse-install-dir-*` 暂存副本；常规消息直接使用 Skill 给出的 MCP 参数，不先探测裸 `schema`。会话返回时间不充当本次发送回执，只有明确成功才报告已发送，未知结果不自动重发。
- 新 Agent 对话仅保存有 Agent contribution 的连接器 ID 快照，运行时再从当前内置定义生成 MCP 与 Skill contribution；之后启停不得改变已有对话。
- 会话启动时连接器 MCP 不可用只记录诊断并降级该工具，不得阻断用户 Prompt 或普通对话。
- 内置 Skill 只保存使用说明，开发和正式包路径由 Agent Runtime 按 `skillPackageId` 统一解析；不得从网络下载 Skill 或让 Skill 建立 MCP 连接。

### Text Extractor

- app id `text-extractor`，namespace `text_extractor`。
- 只读：`app.text_extractor.document.extract` / `app_text_extractor_document_extract` / Workflow `text_extract`。
- 直接保存：`app.text_extractor.document.extract_to_file` / `app_text_extractor_document_extract_to_file`。必须在主进程组合提取与 Text File Writer，正文不得经过 MCP 响应或第二次请求。
- PDF、DOCX、App、MCP、Workflow 复用同一格式中立服务、限制和错误契约。主进程完成权限、审计、安全打开和身份校验；Worker 只接收已验证字节，不重新打开路径。正文、片段和未脱敏完整路径不进入日志/审计。

### Text File Writer

- app id `text-file-writer`，namespace `text_file_writer`，capability `app.text_file_writer.file.write`，tool/node `app_text_file_writer_file_write`，无 Deep Link。
- 所有入口复用能力包 `main/service.ts`：绝对真实目标、默认拒绝覆盖、原子写入、`fs.write.outside-userdata` 权限与审计。
- Writer 不限制扩展名，支持 `utf8/utf16le`；`format` 返回小写末尾扩展名或空字符串。组合调用方仍保留自身扩展名契约：Text Extractor `.txt/.md/.csv`，HTML Generator `.html/.htm`。
- 不设正文长度上限，不记录正文，不在入口复制校验/写入逻辑。

### HTML Generator

- app id `html-generator`，namespace `html_generator`。
- 字符串能力 `app.html_generator.ejs.generate`，文件能力 `app.html_generator.ejs_file.generate`，对应 tool/node 使用下划线形式。
- EJS 模板是受信任可执行配置；Workflow 只允许上游绑定严格 JSON 对象数据，不动态替换模板。
- 所有入口复用单例渲染核心，在一次性 Worker 固定 EJS 版本/options、禁用 include，并执行输入输出限制、超时、终止、调度、`shell.exec` 权限、脱敏错误和审计。
- Worker 不是安全沙箱。生成器不预览、打开、清洗或验证 HTML；文件能力组合 Text File Writer 以 UTF-8 写入绝对 `.html/.htm` 路径。

### File Opener

- app id `file-opener`，namespace `file_opener`，capability `app.file_opener.file.open`，tool/node `app_file_opener_file_open`，Deep Link action `open`。
- 所有入口复用 `FileOpenerService.open()`，参数统一为 `path`；只接受一个已有绝对本地普通文件，拒绝 URL、目录和符号链接。
- 成功只表示操作系统接受请求，不承诺外部应用启动、聚焦或完成加载。

### Terminal

- app id `terminal`，capability 使用 `app.terminal.<subdomain>.<action>`，tool 名严格点转下划线。
- 桌面终端的全局主题通过现有 `config.update` 保存到 `core.config` 的 `global.terminalTheme`，未配置或无效值使用当前默认配色。外观页用草稿实时预览，取消／放弃恢复已保存主题；保存后由 EventBus 的 `system` 域 `config.terminal-theme.changed` 事件同步所有桌面窗口。预览组件仅绘制本地样例，不创建 PTY。切换主题不得重建会话、写入终端或触发网格 resize。手机端配色与帧协议不受影响。
- 分屏顶栏与底部命令条的背景以当前终端主题的 background 为基底叠加 5% 黑色，普通文字和图标复用 foreground；语音与待执行条共享相同局部 token，随主题草稿预览、保存、取消和跨窗口同步更新，不改变应用侧栏、Dock 或弹层的主题。
- 分层叫法固定为：应用是「终端」，文件夹是「终端分组」，文件夹下那一行是「终端标签」（代码里的 workspace），标签内部可分成最多 8 个「分屏」，每个分屏里的那一个才叫「终端会话」（代码里的 session，也就是 `sessionId` 寻址的对象）。界面文案与文档一律按这套叫法，不得再把标签叫成「终端」或把会话叫成「对话」。代码标识符（`TerminalGroup` / `TerminalWorkspace` / `TerminalPaneLeaf` / `TerminalSession`）保持不变。
- UI、IPC、MCP 复用 `desktop/app-capabilities/terminal/main/service.ts` 的分组、活动会话、命令、有界输出和不可变 `sessionId`。
- 终端输入及其注意状态、租约失效只通过已有 runtime 增量队列合并保存对应会话，不得在逐键路径触发全会话画面序列化或历史输出全量扫描；输入 revision、租约接管与状态事件仍同步生效，操作收据、幂等结果和结构变更保持完整持久化。
- UI 中一个侧边栏标签对应一个持久化 workspace；workspace 使用递归二叉布局树组织 pane，每个叶子 pane 独占一个 session。分屏不增加侧边栏行；拖动 pane 顶栏只能投放到另一 pane 的四个边缘并重组布局树，不合并 session、也不在 pane 内新增标签层。关闭侧边栏标签必须删除整个 workspace、全部叶子 session 及其数据；关闭单个 pane 只删除对应 session，最后一个 pane 等同关闭 workspace。
- session 进入 `ended`、`failed` 或 `lost` 后必须立即移除对应 pane，并删除会话标识、输出、检查点、操作和短期幂等数据；最后一个 pane 移除后 workspace 不得继续出现在侧边栏。终止态仅可用于唤醒已在等待的观察请求，之后按原 `sessionId` 查询必须返回 `not_found`。
- Synapse 退出时必须终止并销毁所有 Terminal session，只保留全局设置、分组、快捷命令和工具栏操作。启动时必须清理任何旧版或异常遗留的 session/workspace 及关联数据，不恢复 PTY，不将旧记录转成 `lost`，不重放生命周期操作。
- workspace 与 pane 是 UI/IPC 聚合。MCP 按不可变 `sessionId` 管理底层会话，并把标签（workspace）补成可寻址对象：只读的 `workspace.list` / `workspace.get`（各标签持有的 `sessionIds`，按布局先序给出读序），以及写入的 `workspace_pane.create` / `workspace.rename` / `workspace.delete`。此外 `session.list` / `session_summary.get` / `session_state.get` / `.list` 各带一个只读 `workspaceId` 报出会话归属。
- 标签寻址不引入第二套标识：pane 与 session 是 1:1，要切哪一格就用它承载的 `sessionId` 指明，`workspace_pane.create` 负责按当前布局把它解析成 pane。布局树与 pane id 一律不出现在任何请求或返回值里——调用方只能请求这三类改变，不能假定或直接改写 Renderer 的布局结构。
- `workspace.delete` 只走正常终止：它不提供 `force`，也不替调用方补一个（ADR 0049），会话仍在停止中时如实报告剩余项而不是等待。标签级写入与手机持格（ADR 0219）的关系同会话级：被手机持格的那个会话所在标签不得由 MCP 写入。
- pane 顶栏最大化只属于 Renderer 临时视图状态：沿目标 pane 的布局祖先路径将每个兄弟分支固定为 100px，进入前记录当前实时布局；切换到其它 pane、切换 workspace 或修改布局时必须还原。最大化状态和临时比例不得持久化，也不得新增 IPC/MCP 能力。
- pane 顶栏平分操作以目标 pane 的直接父级方向为准，向上合并连续同方向 split，并将该组中的并列区段等宽或等高分配；正交方向子树视为一个区段且保持内部比例。平分结果必须作为一次原子 workspace 布局修订持久化；最大化期间触发时先退出最大化。该操作只属于 UI IPC，不新增 MCP 工具。
- 分屏快捷键固定为：macOS `Cmd+D` 向右、`Cmd+Shift+D` 向下、`Option+Cmd+方向键` 切换、`Cmd+W` 关闭当前 pane、`Cmd+R` 重命名当前会话；Windows `Alt+Shift++` 向右、`Alt+Shift+-` 向下、`Alt+方向键` 切换、`Ctrl+Shift+W` 关闭当前 pane、`Ctrl+Shift+R` 重命名当前会话（`Ctrl+R` 归命令行的历史搜索）。`Cmd+R` 可用是因为应用菜单里没有「重新加载」：整页重载会丢掉未持久化的活动应用，界面回落成默认应用。
- Terminal 粘贴必须保持文本优先；仅图片剪贴板通过 UI 私有 IPC 转为用户数据目录下的私有临时 PNG，再把 shell 转义后的路径交给 PTY。单张 PNG 上限 10 MB，超过 24 小时的同类临时文件在后续图片粘贴时清理；该链路不得注册 MCP 工具。
- Terminal pane 文件树允许按系统平台使用 `Cmd/Ctrl` 切换选择、`Shift` 连续选择，并把全部选中路径拖入当前 session；路径必须由文件树 scope 在主进程解析，按现有终端路径规则转义后写入，不得伪造成外部文件或新增 MCP 工具。
- Terminal pane 的 Git 状态与同步始终按该 session 的实时工作目录执行，不能借用「代码仓库」登记信息；状态只给界面分支、未提交文件数与增删行数及上游差异，同步沿用现有 Terminal Git 的快进规则，不在界面实现另一套 Git 命令。
- Terminal 底部内置快捷命令由代码定义且只读；用户快捷命令是独立的应用级数据，只允许名称、单行输入内容和是否回车，通过 UI 私有 IPC 管理并加密存入 `app.terminal.toolbar-actions`。两者不得混存，也不得注册 MCP 工具。
- 启动设置只属于 Terminal：全局入口位于 Terminal Header，分组和快捷命令入口位于对应对象；不得在系统设置中增加重复入口。解析顺序固定为安全系统环境、Synapse 内置、全局、分组、快捷命令、一次性覆盖，配置变化只影响新 PTY。
- Terminal 启动时会为 `zsh` / `bash` / `fish` 注入一段 shell 集成，让 shell 每次画提示符前上报当前目录（OSC 7），**这部分不受任何开关门控**；只影响新 PTY，用户自己的启动文件照旧被 source。Claude Code 原生通知的会话级 PATH shim 与官方 Hook 仍是默认关闭的设置，启用后才注入；用户别名或函数最终按 PATH 调用 `claude` 时必须继续生效，`codex` 不再注入 Hook 或通知，旧 Codex shim 启动时清理。Synapse 自己拉起的 Claude Code（新建对话、项目分组按住 ⌘ 点击、手机端）走的是内置 runtime 的绝对路径，不经 PATH shim，改由启动器把**同一份** hooks 写进它自己生成的 settings；两条路写出的 hooks 必须逐字一致，也同受总闸门控，拿不到通知服务时按不带 hooks 启动、不得因此起不来。该设置有两颗开关：总闸 `enabled` 是注入边界，`notify` 只决定弹不弹系统通知 —— 关掉后者时注入、会话档案与等待输入标记一律不变，注入边界不随它移动；拆分前落盘的记录按 `notify: true` 升级，与「开关打开就会弹」的既有行为一致。绝对路径、远程 Shell、主动重置 PATH 或 `SYNAPSE_AGENT_NOTIFICATIONS_DISABLED=1` 不承诺接入 shell 集成，这些情况由按需探测 PTY 前台进程 cwd 的兜底接住。
- Claude Code Hook 只能向随机会话 token 保护的 loopback 端口上报有限事件元数据与 `background_tasks` / `session_crons` 的数量，不得上报任务命令、描述、提示词、回答、终端输出或工具参数。只有两组字段都存在且为空时，`Stop` 才可通知“本轮回复结束”；任一非空时档案仍为工作中且抑制 `idle_prompt`，字段缺失时不推断结束。OSC 9/99/777 不再作为 Agent 通知兜底，因为它们无法识别 Agent 和后台任务。通知只显示 Agent 名、session 标题和状态；当前精确 session 聚焦时抑制，子 Agent 完成不得触发。同一批 Hook 事件同时驱动会话 `attention`：只在等待用户输入时写入 `waiting` 及 `approval` / `agent_question` 等 kind，用户提交提示、工具继续、中断、会话结束或用户在终端里手动输入后必须回到 `not_waiting`；该状态只含状态、kind、原因、置信度与水位，不得携带提示词、输出或工具参数。
- Agent 会话档案（`app.terminal.agent-sessions`）的读出口只有一份白名单投影：`state` / `agentKind` / `version` / `lastActivityAt` / `stateChangedAt`，由通知服务自己投影，原始档案类型不越过服务边界，好让泄露在类型层面就写不出来。`transcriptPath` 是指向用户整段对话的指针（提示词、回答、工具调用与被读进上下文的文件内容），交给外部等于把对话内容外包一次查询；`pid` 与 agent 自己的会话 id 是宿主进程细节。三者一律不出进程，审计与日志同样不记。投影块缺席（这里从来没有 agent）与 `state: "ended"`（跑过、已退出）是两件不同的事，不得合并；判变化用 `version`，不得把该块接进 `stateRevision` 或 observe 的唤醒条件。
- 可点击 Claude Code 通知由 Terminal 业务模块拥有，不得改造成 System Notifier 回调。账号消息中心只收纳安全的 session 标识、标题和状态，不保存提示词、输出或工具参数；终端业务仍决定是否需要操作。精确 session 位于当前焦点时抑制本机原生横幅。点击必须复用不可变 `sessionId` 的 System App 打开请求定位具体 workspace/pane。
- 终端字符宽度表以 Claude Code 的宽度库口径（`Bun.stringWidth`，等同 `string-width` / `emoji-regex`：`Emoji` 属性码点算 2 格）为准，渲染端与主进程 headless 仿真器必须共用同一张表；改装宽度表必须同时保证 MCP 读屏与序列化恢复的换行与渲染端一致。
- `TERM_PROGRAM=Synapse` 与 `TERM_PROGRAM_VERSION` 是受保护宿主身份。环境变量明文只进入加密 body；结构化元数据和 MCP 只能记录键、`set/unset`、来源及 revision。
- 终端会话定位是会话级纯导航，只接受不可变 `sessionId`，并复用仅含 `sessionId` 的 System App 打开请求定位 workspace/pane；会话不跨重启（ADR 0215），因此不提供任何 Deep Link，也不得扩展为命令执行或输出读取；标签级寻址由独立的 `workspace.*` 能力承担，不由这个导航入口派生。复制入口属于分屏：pane 顶栏右侧按钮组有一颗「复制引用」，整条顶栏的右键菜单（以及顶部标签菜单）里也有同一项；顶栏标题上右键不弹菜单——那条同时是拖动分屏的把手，菜单会跟拖拽抢同一个手势——双击标题重命名保持不变。产出的是五行纯文本 `key=value`：`workspace_id` 寻址它所在的标签（`workspace.*` 接受），`session_id` 寻址那个会话，两者的 `_title` 是给人认出「这是哪一格」用的（一个标签里分屏出来的几个会话，光看 id 谁也不知道读的是谁），`session_ref` 是由 `sessionId` 派生的本机短校验引用、不可反查、不被任何工具接受。复制入口的文案必须说明该引用只在本机本次运行期间有效。
- 手机端的 Git 操作只接受**枚举动作**（`status` / `branches` / `checkout` / `createBranch` / `commit` / `push` / `sync` / `merge`），不接受任意命令字符串，分支名与提交信息各走各的字段，因此不构成下一条所禁止的通用 `shell.exec` 旁路。命令在电脑后台按终端当前目录执行，**一个字都不写进终端**（终端前台可能是 Agent 的全屏界面），也**不接「代码仓库」注册表**：不调用 `app.git.repositories.add_local`、不产生 `repositories.json` 条目、不要求用户先添加仓库，复用 `git-client` 的只有命令封装与解析器（它们本来就只吃路径）。丢弃改动走 `checkout -f` 的语义，**不加 `clean`**，未跟踪的新文件必须留着；合并冲突一律在电脑侧自动 `merge --abort` 回退并回一段可复制的文本，手机端不得出现「继续合并」「标记已解决」「重试」这类入口；同步走快进式，永不为它写冲突处理。该链路不得注册 MCP capability/tool、System App、Dock、Workflow Node、Automation Action 或 Deep Link。
- 手机端复制引用分两种只读 intent（均走 `terminal.state.read` 权限与审计）：`sessionReference` 按具体会话，`workspaceReference` 按标签及可选的手机当前/最近查看会话，未选过时由电脑取标签布局首格。电脑校验会话仍属该标签，复用 PC 格式化函数生成五行文本，返回 `workspaceId`、`sessionId` 与 `referenceText`；手机只复制原文。标签标题与分屏会话行有各自系统长按菜单，终端更多菜单按目标区分两项。最近选择是手机本次运行的视图状态，移出/关闭分屏时清理，切换电脑时清空。复制不 attach、不取租约、不读输出、不改变 PTY；失败和过期结果不改剪贴板。无新增 IPC、MCP capability/tool 或 Deep Link，引用仍仅在目标电脑本次运行有效。设计见 `docs/superpowers/specs/2026-10-01-mobile-terminal-session-reference-design.md`。
- 不得新增通用 `shell.exec`、MCP 专属终端、静默输入抢占、隐式停止删除或自动强杀旁路。
- 终端标签（workspace）的置顶只通过 UI 私有 IPC 写入 workspace 记录既有字段：置顶只改变同分组内的排序，不得影响会话生命周期、布局或启动设置。它只活到本次运行结束——会话与 workspace 不跨重启（ADR 0215），刷新后的 workspace 是一张新面孔，因此不得承诺保留，也不得为此引入跨重启的 workspace 身份。侧栏标签列表与顶部标签不显示运行、停止、结束、失联、失败或等待输入等会话状态指示器，也不得引入由原始输出事件推断的未读标记；置顶图钉与关闭操作保留。会话生命周期与 attention 状态仍供通知和自动化使用，不因移除列表指示器而改变。
- 生命周期、注意三态、写入租约、输入/尺寸修订和输出水位相互正交。loopback MCP 不要求 Terminal 专属 token，但传输层必须提供稳定 `clientId` 与 `controllerInstanceId` 约束租约、幂等、配额和审计。
- 尺寸归属是独立于写入租约的运行时维度：只有手机自己的 resize 主张它，任何其它 resize（桌面 fit、自动化 resize、创建初始尺寸）都释放它，因此不需要额外的释放调用。归属变化即使格子数没变也必须广播，且不推进 `sizeRevision`。手机 detach 或超过更短的归属空闲阈值即释放；应用重启不恢复归属。同一会话只能有一个归属方，多端并发后写者胜，不做仲裁。完整规格见 `docs/adr/0216-coordinate-terminal-size-ownership-separately-from-leases.md`。
- 手机终端有两种显示模式，属于手机端的呈现选择：优先移动端（手机上报自己的格数，PTY 随之重排，手机 1:1 渲染）与优先还原（PTY 不变，手机按桌面网格整帧缩放，可双指放大）。桌面端在归属为手机时抑制自身 fit，该会话同时整块锁住：内容区、键盘输入、拖入路径、pane 顶栏的文件夹/平分/最大化/关闭按钮、以及底部命令条（含麦克风）全部不可用（只读的「复制引用」与「复制全文」不在其列，它们不改动任何东西），pane 内容区显示「正在被 X 使用」与「转移到电脑」按钮，pane 顶栏不盖蒙层但整体惰性。锁只针对该会话，同 workspace 的其它 pane、会话列表和应用顶栏不受影响。释放按钮只走 UI 私有 IPC，不新增 MCP 工具，也不改变 `app.terminal.session.resize` 的自动化契约。完整规格见 `docs/adr/0219-lock-the-terminal-while-a-phone-holds-the-grid.md`。
- 手机显示密度是设备级偏好，三档存「一个字符格子的宽×高」而不是行列数——行列数由单位尺寸与可用面积推导，所以换机型、换方向时观感密度不变。会话级覆盖只影响该会话且不落盘。密度属于手机设置，不在桌面设置中重复入口。
- 手机端不得从终端画面收集链接或推断其边界：终端程序自行插入的换行没有可靠的边界信息，「凑出来」的完整地址可能只对了一半。链接只以结构化字段到达手机——账号通知可携带一条可选 `https` `url`，手机按该字段打开，不猜测、不补全、不呈现候选。
- 手机端应用内反馈的落点是固定的，不得为同一类消息再开第二条通道：没有归属地且转瞬即逝的确认走底部通知条（`NoticeBar`）；有归属地的失败走引发它的位置——登录失败在表单内、终端操作失败在输入栏上方的常驻行（`TerminalMessageList`）、连接状态在设备行与空状态里。判断依据是该消息「有没有一个屏幕位置本来就在说这件事」。
- 手机端不得为「应用自己发的请求」报错。连接时自动发出的 `sync`、为保持所属终端的重新 `attach`、重申尺寸归属的 `resize` 都不是用户发起的，没有待答的用户操作，也没有哪一块屏幕以「这个请求失败了」为主题——列表与设备行描述的是随后的状态。这些结果只记日志（`quietIntents`），用户没做任何操作就弹一条失败提示，是让应用看起来在随机出错。
- 手机端不得自己编造失败原因：能显示的是桌面端给出的、指名了原因的那句话；桌面端给不出原因时也只说「哪个操作没有完成」，不得回落到一句适用于所有失败的通用文案。桌面端 `describeError` 只做翻译与说明操作，不得再用单一兜底句替代终端错误码自带的含义。
- 手机端通知条与连接状态都不得遮挡返回按钮、标题、输入栏或标签栏。终端页必须用不参与布局的 overlay 而不是 safe area inset：inset 会改变可见行数，而行数上报给桌面会触发 PTY 重排，一条 1 秒的提示会让远端重排两次。
- 手机端提示不使用 `Theme.attention`。按 `Theme` 自己的契约，那个颜色只表示「需要人」，成功与信息类提示用它会让用户以为出了错。
- 手机端连接状态由 `Connectivity` 一处派发。「连不上服务器」与「没有电脑在线」是两个不同的问题、需要用户做两件不同的事，不得合并成同一句话，也不得在 socket 断开时声称电脑离线——此时的电脑列表要么没取到、要么是断线前的旧值。**「正在看的那台电脑不在线」是第三种，同样不得与「没有电脑在线」合并**：前者要用户在屏上换一台，后者要用户去开一台机器；只有账号下确实还有别的电脑在线时才是前者，一台都没有时仍是后者。
- 手机停在哪台电脑上由用户决定并记住，**不得自动换台**。同一个账号可以有多台电脑在线，手机同一时刻只看其中一台；选中的那台掉线时保留选择、清掉它的会话列表、把屏幕说清，由用户从设备行（或设置页同一份列表）换台。`onlineDesktops.first` 一类的兜底只在「用户从未选过」时成立。切换必须对被离开的那台下发 `detach`（它代持着手机在这些终端上的写租约），且这些自发的意图不得弹失败提示。电脑列表的显示名走 `GET /api/mobile/desktops`；`mobile.presence` 只带 id 是既有事实（它广播给账号下所有手机且 payload 有字节预算），不得为显示名扩它。
- 手机端按会话 id 保存的客户端状态都只对签发它的那台电脑成立。切换电脑时必须清掉一切「按下一次解析到的当前电脑」重新生效的东西（待重放写入、待答 attach、待答 history、尺寸主张等），否则会打到一台没听说过这个终端的电脑上。给电脑传的文件同理：附件在创建时记下目标电脑，只投递给那一台。
- 手机端终端文件接力的待清理云端副本按账号隔离。退出登录时取消上传并清掉本地接力队列，在凭据失效前尝试删除尚未交付的云端副本；删除失败的新记录只在原账号重新登录后重试。旧版无账号归属的记录仍可尝试清理，服务端按文件所有者校验，不能跨账号删除。
- 手机端不处理 `mobile.detached`：服务端只把它发给桌面（只有桌面知道该释放哪些写租约），没有回传手机的通路。客户端不得再为它接回调。
- 手机工作区文件使用独立 `workspaceFiles` 只读 scope 服务，文件结果不得进入旧 executor 的通用结果缓存或触发常驻 Git 摘要。scope 绑定可信 account/desktop/mobile/session；Git 只通过严格隔离的低层命令适配器读取，不能复用写临时 index/对象的高层 diff。引用只插入手机草稿，不写 PTY；正文不进入 summary、云盘、数据库或日志。资源、取消、版本与权限边界见 `2026-10-03-mobile-workspace-files-and-changes-spec.md`。
- 手机Git内置转换只读取精确授权的桌面标准global/local配置，普通Git命令继续禁global/system隐式加载；配置路径不由手机提供，不跟随include或执行扩展。不能安全确定且会影响比较的系统语义返回受限，不以猜测规则产生差异；不得扩为全盘读权限。
- 手机端诊断日志是**纯本地产物**：落在 `Library/Caches/SynapseLogs/`，不进 Documents（那会跟着 iCloud 备份离开设备），不自动上传，不进 `ui.tracking` 遥测通道，也不与桌面日志通道合并。它唯一的出口是用户在「我的」→「诊断日志」里主动导出，走系统分享。终端正文默认**不记**，用户可以在「我的」→「诊断日志」里单独打开「记录终端屏幕内容」（默认开，见下）：打开后每秒至多记一条屏幕内容与发给电脑的命令，三重限长（12 行 × 每行 256 B × 总 2 KiB）并先跑脱敏，导出时二次确认并在包里写明本次是否包含。真实会话/电脑/项目 id 一律换成进程内的本地别名（`s1`/`d1`/`p1`，映射表不落盘、退出登录即清）；改用哈希或改为可跨文件对照的稳定标识都属于改变这条边界。完整规格见 `docs/adr/0220-keep-mobile-diagnostic-logs-on-device-and-de-identify-ids.md`。
- 结构元数据使用已注册 `app.terminal.*` DataRepository；原始输出/检查点只进入专属有界加密块存储，安全存储不可用时不得回退明文。
- 普通备份排除输出、检查点、命令正文、用户快捷命令正文、活动租约、删除意图和短期幂等记录；恢复时必须丢弃所有 Terminal session/workspace 和关联操作，不得重建 PTY 或重投生命周期操作。

### Notifier

- 账号消息中心的存储、投递、保留期和隐私边界见 `docs/superpowers/specs/2026-09-23-account-notification-center-design.md`。业务模块只提供安全摘要与目标 ID，消息中心负责历史与跨端状态。
- 账号通知的 MCP 只管理当前登录用户已有的通知，复用列表、详情、精确未读数、标记已读与软删除接口；待处理通知被删除不解除终端的待处理状态。发送新通知仍由 System Notifier 承担。
- 通知列表的可选 `source` 与 `all` / `unread` / `pending` 状态筛选取交集，服务端先筛选再分页，改变条件重置游标。来源分类只读既有 `source`；`terminal-attention` 解除待处理后仍保留该分类，`pending` 另要求 `resolvedAt` 为空，搭配其他来源返回空列表。来源筛选不改变当前账号的精确未读数、全部已读、清空全部或忽略全部待处理的范围。
- System Notifier 是「通知用户」的能力，一次触发只有一个动作：把消息写进账号消息中心（桌面端走 `POST /api/notifications/desktop`，它只吃桌面登录态与桌面自有 source，`/internal` 只为已发布构建保留），由服务端投递给该账号所有在线桌面（含发起的那台）与手机。它同时拥有这台电脑的原生呈现，是账号消息构造 Electron `Notification` 的唯一位置：实时连接不得自己 new，只把收到的标题与正文交给它。设置里 `sendEnabled` 是发送总闸，`localEnabled` / `silent` 描述本机呈现，两组互不门控；发不出去就什么都不发生，不得为未登录或离线补一条本机通知，但每一次没发出去都要留下固定诊断（`notification_sync`），否则「AI 说通知了我却没收到」无从查起。消息走桌面登录态，不得改用用户的开放 API 密钥，也不得为其新增开放接口。
- System Notifier 的完整权威规格是 `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md`。修改前必须完整阅读，不得以本摘要代替。

## MCP

- 系统设置的 MCP 分类是全局 MCP Server 状态、URL 和外部客户端注册信息的唯一 UI 入口；MCP 不注册为 System App，Database 不得重复承载该视图。
- Renderer 只通过顶层 `window.synapse.mcp` bridge 访问 MCP 专属 IPC；不得在 `database` bridge 中恢复兼容别名。
- MCP 设置分类只管理产品入口与客户端注册，不新增 MCP capability/tool，也不改变 loopback HTTP transport、端口、自动注册、ActionRouter 或运行生命周期。底层服务继续聚合全部已注册 capability domain。

## Console 用户 API 秘钥

- 用户 API 秘钥只通过受登录保护的 `/api/console/api-keys` 管理；创建响应只展示一次完整秘钥，数据库只保存 SHA-256 摘要和可识别前缀，列表不得返回摘要或明文。
- `notification.send` 是独立于 Drive 下载的权限，只允许通过 `/api/open/v1/notifications` 的三种请求形状向密钥所属账号发消息：`POST /notifications`（密钥在请求体 `key`）、`POST /notifications/{key}`（密钥在路径段，消息在 JSON 或表单请求体）、`GET /notifications/{key}/{title}/{body}`（密钥和标题正文都在路径段）。密钥随请求携带，三种形状都不接受 `Authorization` 头，也不读取 cookie。
- 三种形状共用同一份消息校验：标题 1–64 字符、正文 1–512 字符、分组 1–64 字符、`url` 仅 HTTPS 且不超过 2048 字符、`level` 只认 `active`/`passive`/`timeSensitive`，以及可选的 `copyOnTap`（传法与例外见下）。请求体 `.strict()`，出现未列出的字段返回 400；密钥格式与权限校验在 guard 里完成，401 与 403 先于 400 返回。
- 三种形状共用一个限流桶，每分钟 60 次。`ThrottlerGuard` 默认把 handler 名算进键里，会让三个路由各占一份额度，因此这三个路由显式传入去掉 handler 名的 `generateKey`；新增第四种形状时必须沿用同一个 `notificationThrottle`。
- 路径式只接受 `GET`。`@Get` 注册的路由会被 Express 用来处理 `HEAD`，而链接预览、爬虫和邮件安全网关正是用 `HEAD` 探测地址，所以这条形状显式拒绝 `HEAD` 并返回 405，避免探测动作真的发出一条推送。`server/nginx.conf` 的对应 location 保持原样放行，方法判断只在应用层做一处。
- 密钥和消息内容都不得进入访问日志，这需要两处同时生效：应用侧 `app.module.ts` 的 `autoLogging` 跳过该前缀，`server/nginx.conf` 对应 location 设置 `access_log off`。只改一处等于把密钥和正文写进磁盘。`deploy-config.spec.ts` 会锁住这两处。
- 访问日志之外还有兜底：`common/audit-error.ts` 的脱敏必须认得出 Synapse 密钥本身，因为路径式把密钥放进 URL 段，它会出现在 `req.url`、堆栈和错误消息里，且那个位置不符合 `Bearer …`、`key=…` 或带 scheme 的 URL 任何一种既有模式。密钥字符集复用 `api-key-token.ts` 的同一定义（`apiKeySecretInlinePatternSource`），`audit-error.spec.ts` 用真实生成的密钥做回归，格式一变就会失败。
- 该接口 2026-10-15 起支持「点按复制正文」这一项复制能力：两个请求体形状接受可选 `copyOnTap: boolean`，路径式用 `?copyOnTap=1`（只认字面量 `1`，缺省或任何其它值按关处理且不报错）。**这个开关只在 JSON 请求体里能表达**：表单编码下所有值都是字符串（`express.urlencoded` 在 `registerHttpBodyParsers` 里全局注册，两条 POST 都经它解析），`z.boolean()` 会因此 400 掉整条通知，所以 `application/x-www-form-urlencoded` 发不出这个开关——这是本轮有意留下的边界，仓库既有姿态就是严格布尔，不为它放宽类型校验。
- 除上面这一项外，该接口仍不支持图片、铃声、重要警告、持续响铃、自动复制、复制标题、复制到指定位置、推送加密、自定义 TTL、多服务器、逗号分隔的多密钥和通知更新。
- 查询、创建、重命名、权限更新和撤销必须绑定当前 `userId`；撤销保留记录并使其失效，审计不得包含完整秘钥、摘要或可还原材料。
- 密钥创建时必须显式选择非空开放 API scopes；已有未撤销密钥可以原地重命名、增删或清空 scopes，但不得通过该接口轮换密钥。首个 canonical scope `drive.public_link.download` 仅授权 `/api/open/v1/drive/public-links/downloads`，不能访问 Console、内部 Drive 或其它业务 API。旧 `drive.share_link.download` 与 `/api/open/v1/drive/share-links/downloads` 只作为已发布集成的兼容入口，不再用于新密钥或新文档。
- `drive.public_link.message.create` 只授权 `POST /api/open/v1/drive/public-links/messages` 新建 Markdown 文末留言，密钥所属用户是作者，不附带读取、下载、编辑或删除权限。`url` 与公开 `shareId` 至少传一个；都传时分别解析并核对分享与最终文件，不得忽略冲突字段。`shareId` 单独定位分享根目标，文件夹分享中的文章须使用具体文件链接。分享链接解析只接受根目标、`items/<itemId>` 以及可选的 `reader` / `render` / `download` 后缀；缺失目标、空路径段、点路径（含编码形式）、反斜杠和未知后缀必须在 URL 归一化前后拒绝，不能回退到根目标。query 和 fragment 不参与路径校验。留言接口将无效路径映射为 `422 UNSUPPORTED_LINK`。留言去重键的运行时校验与机器契约复用同一 schema。复用 Drive 分享访问和留言服务，不允许密钥进入内部 Drive 或 Console 接口。
- 开放 API 使用独立 `OpenApiKeyGuard`；临时下载地址使用十分钟数据库 grant 和仅存摘要的 bearer token。创建下载地址的请求体只接收完整分享 URL，受密码保护时密码保留在 URL query 中。grant 固定 POST 时的不可变文件版本或 Site deployment，源分享/API key/当前 scope/用户失效会阻止新的下载。
- `/api/open/openapi.json` 是开放 API 的权威 OpenAPI 3.1 机器契约发现入口。运行时路由和 strict 请求校验必须复用契约模块导出的路径与 Zod schema；新增、弃用或修改开放接口时必须同批更新契约和契约回归测试，不维护第二份静态 JSON。
- 开放 API 的应用地址使用 `APP_PUBLIC_URL`，文档地址使用 `DOCUMENT_PUBLIC_URL`；生产未配置文档地址时从应用根地址派生 `/document`，DEV 必须显式指向独立的本地文档服务。API capability 和 OpenAPI `externalDocs` 由服务端输出绝对文档地址，契约 `servers` 继续保持版本化相对路径。
- 开放 API 用量记录只写 `OpenApiUsageLog` 的固定列，禁止 URL、密码、token、留言内容、文件名、路径、storage key、manifest 和文件内容。下载与留言接口显式跳过全局 Throttler，不增加密钥、IP、次数或频率限制。

## 客户端埋点

- 桌面端埋点复用 `ui.tracking` renderer 日志与既有日志 IPC，不新增 renderer analytics client、preload API 或并行跨进程通道。
- 网页端只允许在普通用户 Drive 控制台、文件浏览器和分享页采集 `web.drive.*`；平台管理员后台及其它网页领域不得接入。网页 Drive 通过统一边界覆盖交互，通过受控 API 包装记录所有 Drive 请求的成功、失败和耗时。
- 远程事件只允许固定分类、稳定事件键、组件、动作、结果、耗时、内置模块、窗口类型、客户端实例、会话、版本、平台和时间。桌面系统信息按采集时事件保存在独立本地 sidecar，发送时通过固定请求头传递；失去事件引用的 sidecar 由后台 DataRepository 维护 Worker 分批清理。网页浏览器信息由服务端从请求头归一化。服务端只持久化规范化浏览器/操作系统字段，不保存原始请求头。输入内容、显示文案、URL、路径、文件名、错误文本、堆栈、仓库/资源 ID 与任意 metadata 不得进入远程事件。
- 请求体不得包含 `userId`。服务端只根据有效桌面 Bearer Token 或普通用户 Web 会话 Cookie 关联登录用户；无认证为匿名事件，有但无效的认证信息必须拒绝。登录事件不得降级为匿名发送。
- 埋点投递必须是不可感知的单向副作用：日志 IPC、队列和网络失败不得弹错、递归记录、阻断业务回调或无限等待身份切换。稳定事件键只能来自代码；异步操作必须使用显式稳定操作名并记录结果与耗时，处理器级静态检查负责阻止遗漏回归。
- 原始事件保留 180 天，只能通过平台管理员保护的聚合统计接口查看；统计可提供活跃身份、会话时长、功能采用率、固定顺序漏斗和 D1/D7/D30 cohort 留存，但不得提供普通用户读取、原始事件列表、明细导出、用户排行或单个用户行为轨迹。完整设计见 `docs/superpowers/specs/2026-09-01-client-telemetry-design.md`。

## Drive

- 文件搜索复用自有普通云盘的递归元数据接口；名称/扩展名做 NFKC、大小写归一化，多词共同匹配，不读正文、不匹配路径。范围为全盘或指定目录后代；回收站、公开素材及其上传中间态不可进入结果。类型、更新时间、有效分享筛选与排序必须先于统计和分页，无搜索字段时保留原树顺序。
- AI 查找将自然语言中的文件名线索与目录、类型、修改时间、当前有效分享条件分开；目录先解析到真实 ID。无结果只可有限尝试非精确名称的拆词/常用简称，必须保留用户明确条件并说明实际查询，不能遍历下载或读正文模拟全文/语义搜索。搜索结果编号只用于当前展示列表的 ID 映射，打开或修改前按 ID 复验；本人预览链接不创建分享，不新增持久检索会话或跨账号缓存。
- 搜索结果按服务端真实祖先计算同步关系，不能继承当前浏览目录。定位按 ID 重读当前父链，并加载到目标所在目录批次；返回搜索保留条件和已加载结果。迟到响应、退出搜索及账号切换必须隔离，搜索历史仅留在当前账号的内存会话。

- 同步后台批量读取自有条目、完整父链和独立增量页，不能跨账号或把缺失/异常响应当成删除。每个同步根保留独立游标、分页、过期恢复和错误；元数据快照仅限当前读取阶段，覆盖/删除前的新鲜检查、写入版本前置条件和逐文件哈希校验不得被批量快照替代。

- 显式「上传新版本」允许将同扩展名的独立本地成品替换指定自有文件，必须经过目标身份、版本、本地哈希及本机有效同步关系的预览复验；不得伪造原文编辑的版本来源，也不得静默覆盖未同步本地修改。云端完成和各端同步完成分别报告。
- 同步暂停保留关系；解除默认保留两端，选择删除时先持久解除并停止工作，再可恢复清理纳入范围的内容。排除项、未管理内容和重试期间变化的内容不得连带删除；每端结果与失败重试状态必须保留。重新映射不承诺文件级回滚。
- Site 列表的 `needsRepublish` 为可空状态：真表示源文件变化，空表示无法确认，不能视为已发布；来源不可用不改变现有公开部署。普通目录上传保持合并，不隐式删除云端独有内容。

- Markdown 新评论、新留言及新回复由服务端自动生成 `drive-discussion` 账号通知；编辑、删除、解决、重新打开不生成，历史创建不补发。新讨论/留言通知所有者，回复通知所有者、发起人及直接被回复者，按账号去重并排除操作者与失效账号。
- 内容、通知、定位目标和 outbox 必须同事务提交；创建与删除共用 item 行锁，写入前复验当前账号、原分享、包含关系与密码，分享及祖先目录保持读取锁直到提交，已回滚的锁冲突最多重试三次；提交后复用 NotificationService 投递，30 秒扫描、100 条一批、60 秒租约每 20 秒续租、1–15 分钟重试，24 小时终止，已读/删除停止外部投递。通知保留 90 天。
- 非所有者的定位只使用其原参与记录保存的内部分享来源，复验原分享启停、期限、根与文件包含关系；没有来源的旧参与记录仍收到新回复通知，但链接不可用，不寻找替代分享。网页 `/notifications/<id>/open` 先验证本人通知，再走原 owner/share 阅读器及密码验证，不放宽业务权限。列表/系统提醒第一行摘要最多 120 个 Unicode code point，上下文第二行最多 60；通知目标保存当时的纯文本快照（本次内容 500、原文与被回复内容各 200），通知 DTO 只投影可选展示字段。图片只保存说明，不保存资源 URL。快照不随编辑、删除或改名更新，旧通知不补填；原分享来源上下文不进入公开 DTO 或日志。

- `公开素材`使用稳定、匿名、不过期 `/files/<assetId>`。允许 JPG/JPEG/PNG/WebP/GIF/AVIF/ICO 和 PDF/DOCX/XLSX/PPTX/TXT/MD/CSV；禁止 SVG、主动网页内容、压缩包、可执行、旧 Office 和宏格式。
- 图片 inline，文档 attachment；替换只允许同一大类。需要密码、有效期或敏感控制时使用普通 Drive 分享，不得绕过。
- 浏览器 Markdown/MDX 在线编辑中粘贴、拖入或选择的图片使用平台托管 `/object/<objectId>`，不属于任何用户、不进入用户公开素材列表且不计用户云盘配额。`/object` 不限定未来对象类型；当前仅允许 PNG/JPG/JPEG/GIF/WebP/AVIF/ICO，单图 20 MB。正文图片上传要求实时编辑权限；文末留言与回复的图片上传要求登录且具有同一文档的留言权限，不能用于写入正文。临时对象 24 小时未随原文档正文或留言/回复保存激活则清理，激活后不因移除引用、删除留言或删除文档自动删除。既有相对图片、`/files/` 与外部 URL 不迁移、不改写，也不提供迁移操作。
- 本地 Markdown/文件夹上传仍将引用图片作为普通用户 Drive 文件并保留相对路径；HTML 及其依赖仍走 Drive 文件或 Site；用户明确要求图床、直链或公开素材时仍创建计入其配额的 `/files/<assetId>`。平台托管文档图片不注册 MCP 上传、列表或管理工具。
- 独立 HTML 在用户未明确发布整个文件夹时默认 `/share/...`；多文件站点或明确发布文件夹时使用 `/sites/...`。文件夹即使只有 `index.html` 也可发布为 Site；仅指定上传目标文件夹或泛称网站不等于发布整个文件夹。
- 单文件 HTML 分享预览保留 `allow-same-origin`，允许分享页面使用 `localStorage` / `sessionStorage`；因此它与 Synapse 主站同源，不是账号会话隔离边界，只应分享可信 HTML。
- Markdown 源文本是协同与版本历史的权威数据。Yjs 更新先进入协同日志，只有检查点进入 `DriveFileVersion`；上传覆盖、历史恢复与 MDXEditor 整文保存必须经过同一 item 级协调器并切换协同代际。
- Markdown 评论讨论状态为 `open` / `resolved`，新旧评论默认未解决；只有讨论创建人可解决或重新打开，回复作者、文件所有者和正文编辑权限不能代替讨论创建人身份。已解决讨论保留原位和所有回复，回复、正文修改或锚点失效不改变状态，状态更新复用审计及评论变更事件。
- Markdown 评论锚点独立于讨论串、讨论解决状态和评论删除状态，服务端投影与解析结果是权威。证据不足只能进入未定位状态，不得由 Renderer 自行搜索并猜测重挂。
- 评论解析缓存仅复用权限无关的正文投影、差异映射及锚点计算；每次仍复验访问并读取当前讨论和权限。缓存按正文/投影内容、解析算法、版本、代际、selectors、当前 CRDT 区间和源码证据强度失效，不能仅用检查点版本判断实时正文未变化。非实时正文每次核对当前有效持久投影摘要，同版本重建块标识也必须失效，且结果只能按实际加载的摘要保存。实时未检查点的投影不得持久化到历史检查点版本；同修订并发任务可合并，失败必须释放并允许重试。
- Anchor V2 首次上线会一次性清理旧版评论，不转换 UTF-16 旧坐标；文档、分享标识和历史版本不得随评论清理发生变化。上线后的新评论同时保留 V2 权威锚点与回滚兼容投影。
- Markdown 实时协同仅属于浏览器 Monaco/阅读界面；Drive MCP 内容写入继续走版本化服务，不加入协同房间。分享评论支持文件名以 `.md` 结尾或 MIME 为 `text/markdown`、`text/x-markdown` 的 Markdown 文件，并只能通过 `app.drive.link.annotation.*` 能力读取和管理；不得扩展为 presence、协同房间控制或分享正文编辑旁路。
- Markdown 文末留言独立于正文锚点评论与文件版本，阅读器和 MDXEditor 在正文后展示。留言与回复的新旧正文统一按 Markdown 渲染，原始 `body` 限 4000 字符，DTO 的 `bodyHtml` 由服务端安全生成且不落库；划词评论仍为纯文本。浏览器复用紧凑 MDXEditor，支持粘贴、拖入和选择平台托管图片，图片激活与留言/回复新建或编辑处于同一权限复验事务。`app.drive.message.*` 可按自有 itemId 或当前 `/share/...` 链接访问；分享可读者能查看，已登录可读者能发布。作者可编辑和删除自己的留言或回复；文件所有者仅可额外删除他人的内容。删除目标时连同全部后代回复移除，MCP 不修改正文或协同状态。

## Agent 与 Knowledge Base

- Agent Conversation MCP 新建默认进入“本地对话”，也可指定项目 ID、唯一精确分组名称或已有对话所属分组；分组查询只返回可创建的项目标识和名称，不返回路径或归档分组。创建通过现有 Agent Runtime，未指定模型时复用快捷创建默认模型，也支持成对指定 providerId/modelTier；显式模型不可用时失败且不回退。供应商模型查询复用 ProviderService 与自定义创建选择规则，只返回未归档供应商名称、标识与可选档位模型，不返回密钥或连接配置。创建复用默认权限模式，固定普通智能体和本地来源；不复制旧对话内容/身份、不自动发送、不打开窗口，成功后通过 EventBus 刷新会话列表。

- Agent 会话基于内置“本地对话”工作区或已配置项目，新会话绑定 `agentType`；运行状态按 conversation 隔离，同项目多会话不得共享队列、busy 或 live session。
- Agent 大型文本工具结果属于会话私有 artifact：正文只写入主进程受控目录和 `agent.artifacts` 元数据，SDK 仅可读，Renderer、普通对话导出、MCP、Workflow 与公开 capability 均不得获得正文读取入口；删除会话时同步清理。
- Agent 对话深度链接只通过既有 Agent System App 的导航能力定位本机 DataRepository 中的对话，唯一格式为 `synapse://threads/<thread-id>`。路径只包含从项目与内部对话 ID 确定性派生的短校验定位符主体；主进程通过有界摘要扫描跨项目解析唯一目标。不得注册或解析旧 `synapse://app/agent/open?projectId=...&conversationId=...` 入口。链接不得包含标题、session key、消息正文、密钥或授权。MCP 首次调用必须允许把完整 `deepLink` 交给 Synapse 解析，后续使用返回的 `projectId + conversationRef`，不得要求 Agent 拆解或重写内部 ID。
- Agent Conversation MCP 的读取与协作控制集中在独立主进程服务，不得通过数据库旁路驱动 Agent Runtime。所有来源可读，只有 `local` / `local-renderer` 用户对话可控制；发送异步接纳，steer/停止/强停/权限响应使用精确回合与请求校验，且继续经过 `PermissionGuard` 与无正文审计。该能力不得新增第二个 System App、Dock、Workflow/Automation 节点或 Deep Link action。
- persona 是 conversation 级固定身份，只能在新建对话时选择，创建后不得在 composer、IPC 或 live session 切换。
- 普通/未绑定模型 persona 使用新建对话选择的模型；绑定模型 persona 固定使用其当前绑定并保存为基础模型。
- conversation 保存 persona ID 和创建时 snapshot，每轮使用当前可访问的最新配置；配置变化关闭并重建 live session。persona 不存在、无权访问或缓存缺失时不得降级普通对话：保留历史查看/复制/导出，禁用发送并引导新建。
- slash menu 只插入，不立即发送，也不是通用命令面板。
- Quick Input 是独立 System App。Agent 只消费其文本；composer 菜单固定向上展开，选择后追加到当前草稿末尾并保留输入焦点，不直接发送。不得恢复“直接发送”开关或塞回 slash menu。
- Agent 项目路径与 Git System App 已登记仓库根路径精确匹配时，可在 composer 复用窄类型化 Git IPC；该入口不得经过 Agent 消息、slash command、MCP 或任意 Git 命令，提交仍必须使用仓库绑定的选择令牌。
- Agent 已配置项目可通过窄类型化 Terminal IPC 以项目目录新建 UI 终端会话，再通过仅含 `sessionId` 的 System App 打开请求定位该会话；虚拟本地对话工作区不提供该入口，也不扩展为 MCP 或 Deep Link。
- Agent 的每个项目在终端里有一个同名分组（`TerminalGroup.projectId` 指向项目，名字为「项目:」+ 项目名）。这条同步是**单向的一次性对账**：项目列表变化时补齐、改名、删除对应分组，除此之外两边互不干涉。项目分组不得改名或删除（菜单不提供），因为名字与存亡都由项目决定；用户自己建的分组不受同步影响。项目来源的会话落进该项目分组，**没有指明归属的会话只落进用户自己的分组**（`ensureDefaultGroup` 跳过项目分组），不得再按「列表第一个分组」落位。项目分组的 `settings.defaultCwd` 与名字一样由项目决定：始终等于项目工作目录（托管知识库取运行目录，由调用方解析；解析不到就清空该槽位回落到全局），分组设置里只读，其余启动设置（shell、环境变量、命令）仍归用户。项目分组的加号在按住 ⌘（Windows/Linux 为 Ctrl）时启动内置 Claude Code：用「设置 → Agent 默认模型」的同一套解析结果，在该项目目录里起一条终端会话并落进这个分组，与 Agent 侧栏项目行上同一个手势是同一件事，共用同一份启动代码；解析不出可用模型时只说明缺什么，不建任何东西，也不退化成普通标签。普通分组的加号和普通点击不受影响。它不注册 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link，Terminal MCP 工具数量不变；`TerminalGroup.projectId` 只是既有分组记录的字段。
- Agent 项目文件树拖入对话时只把主进程解析后的选中路径以空格连接并插入草稿当前光标，不创建附件、不立即发送，也不扩展为公开 Capability、MCP 或 Deep Link。
- 工作区辅助面板属于 Agent 工作区壳，不属于消息组件、全局 App shell 或 `SidebarContentLayout`。宽屏使用会话与辅助面板分栏，窄屏切换为详情视图；面板状态按会话隔离，文件 Diff 只是首个面板描述符。
- 共享只读 Diff renderer 位于 `desktop/src/components/diff/`，Git 通过模块内 adapter 消费，Agent 不得跨模块导入 Git 内部实现。patch 生成与解析复用 desktop 直接生产依赖 `diff`。
- Agent 文件检查点摘要是 turn postlude 与 append-only history 事件；完整 sidecar 存在项目级 `agent.file-checkpoints` DataRepository。四个详情/撤销 IPC 仅供 Agent UI 使用，不扩张公开 Capability、MCP、Workflow、Deep Link、File Opener 或 Git 边界。
- 文件撤销只面向 SDK 支持的当前会话最新检查点，并采用两阶段校验；不等同于 Git discard、Drive Checkpoint、对话回退或模型上下文回退。安全细则见 `docs/agents/agent-runtime-security.md`。
- 其它 Knowledge Base 规则见 `docs/agents/knowledge-base.md`。

## Workflow 与 Automation

- Automation 的 Cron、固定间隔可在 `trigger.config.timeRange` 设置单个当天范围 `{ start, end }`（`HH:mm`，结束允许 `24:00`），必须完整填写且开始早于结束；缺省表示全天，不迁移或要求重存旧任务。活跃日与时间范围先于自动触发规则生效，采用开始包含、结束不包含；Cron 沿用配置时区，其余使用本机时区。正常触发、休眠延迟触发和启动补跑都要复验，范围外跳过并重新调度；手动运行不受限，已开始任务不因越过范围而中止。间隔过滤保留原有起算节奏；新范围最多向后搜索五年，无匹配返回空计划，不得返回范围外候选。

- Workflow 保持外层 DAG；MCP/agent 写操作走 get → mutate → validate → save，校验失败不得保存，不得删除 end 节点。
- 文件/文件夹参数用 `allowMultiple` 明确单选/多选。多选是有序、非空、最多 100 项且不重复的资源引用数组；两者不得自动转换。子工作流直接绑定时资源类型与 `allowMultiple` 必须一致。
- loop 退出由子图真实节点和 Loop Output 的 continue/break 出口表达，不得退回隐藏配置表达式。
- Scheduler 子进程环境经过 allowlist；`PATH` 按用户配置和 login shell 合并；运行诊断必须保留并用于失败排查。

## Rule、Skill、Content 与 Secrets

- 写入编辑器目录、覆盖、替换、备份失败等敏感路径必须确认、权限检查和审计；备份失败阻断替换。安装与复制文案不得混用。
- 资源仓库非只读 Skill 采用协作编辑：有写权限且完成仓库身份配置的用户可更新、删除、恢复和永久删除，判断依据只有仓库可写，不判断 `createdBy`；更新保留原 `createdBy` 不变并记录修改者。该规则不改变云 Skill Repository owner 模型，也不扩展到 Rule/Prompt——Rule 与 Prompt 的更新和删除（含恢复、永久删除）仍仅限创建者。
- 云 Skill Repository 的 owner 删除为永久删除，删除后立即释放同一 owner 下的名称；管理员对公开仓库的下架仍保留可恢复记录并继续占用原名称。两种删除语义不得混用。
- Skill 卸载统一使用 `skill-uninstaller`：无路径只扫已注册 Agent 全局 Skill 根，有路径则受限递归；单个 `SKILL.md` 最大 1 MiB，超限标记不完整并继续下级；执行前重验名称、真实路径和符号链接，确认后只移入系统废纸篓。IDE 管理不得另写删除逻辑。
- 可持续配置在根 `.env.example` 声明，安装器生成/合并本地 `.env`；每个 Skill 最多 100 个变量。不得把真实 `.env` 写入资源仓库，也不得把持续同步值替换进 `SKILL.md`。
- 密钥名称与 `.env` key 构成关联，创建后不可改名；Secrets update 至少包含 `value` 或 `description`。值变化只扫描可信编辑器 Skill 目录，经用户确认进入内存串行队列，不保存安装实例、不静默改写。
- Skill `.env` 扫描、重装合并和队列更新上限 1 MiB。macOS/Linux 新文件默认 owner-only；重装不放宽权限。Windows 可扫描但队列写入逐项失败并提示手动处理，不降级非原子写。
- 发布统一排除 `.env`、`.env.*`（根 `.env.example` 除外）、`.synapse.json`、`.synapse.repository.json`、其它隐藏项和符号链接。`.synapse.json` 只存资源仓库身份，云身份只存 `.synapse.repository.json`。
- 云上传读取身份时拒绝符号链接/非普通文件，校验路径在 Skill 目录内且读取前后身份未变化，并经过本地文件读取权限和审计；失败必须在远端更新前阻断。
- 发布不得基于正文中 token/Authorization/URL 参数模式或 `id_rsa`、`.pem`、`.key` 文件名做硬阻断；仍必须执行路径、容量、符号链接、运行时 `.env` 排除和权限规则。
- 发布保存区分本地提交与远端同步。只有预检快照、保存后内容和身份文件并发复查一致时更新关联；仓库已保存但关联失败时不得重复提交，提供重试关联入口。

## 扫描与发布

- 扫描详情“发布到仓库”不得静默落库；覆盖路径只预填本地版本并进入内容详情编辑态，用户保存后才写入。
- 修改编辑器 Rule/Skill/Prompt 安装、扫描、复制或兼容策略前，阅读 `docs/reference/editor-integration-matrix.md`。

## Live 设备身份与名称

- macOS 使用 IOPlatformUUID、Windows 使用 SMBIOS UUID，经受控进程、权限和审计读取；仅保存和传输带 Synapse 域前缀的 SHA-256 摘要，不记录或上传原始硬件码。
- `core.live-client` 的随机设备 ID、机器绑定和设备名称通过同一进程内存储实例与写队列维护；迁移到不同机器时更换设备 ID，读取失败保留 ID 与已保存绑定，不把旧机器摘要冒充当前机器上报。
- 设备名称仅为显示元数据，设置入口位于基础设置；改名不得改变设备 ID、OS 主机名或本地用户身份。Live hello 与 mobile summary 使用同一名称。服务端只按不同机器摘要判定顶号，不再用名称推断机器身份。
- 设备设置只有两个 UI 私有 IPC，无公开 MCP/Workflow/Automation/Deep Link。硬件摘要不能作为认证凭证；缺少摘要或克隆硬件 UUID 相同时无法保证自动区分。协议与旧客户端升级边界见 Live Client Connections 设计。

2026-10-23：站内信桌面 App ID 为 `mail-internal`，公开 capability namespace 为 `mail_internal`，深链为 `synapse://mail-internal/<id>`；17 个工具整体改名且无别名，数量不变。旧 App 配置在校验前按一次性标记完成改名，改名本身保留取消固定状态和布局；随后独立的双邮件入口迁移将末尾排为「站内信 → 邮箱 → 应用」，此前移除过站内信也执行一次。两款应用均默认固定，迁移后用户的移除和排序不会被重置；历史 introduction 条目保留原样。服务端和手机入口必须同批完成切换后再发布。

## 外部邮箱（桌面）

- `mail` 是桌面邮箱客户端，站内信 `mail-internal` / `mail_internal` 独立保留；两类 ID、payload、API 和深链不兼容。外部链接严格为 `synapse://mail/em_<uuid>`，不支持手机端外部邮箱。
- 账号、加密凭据、元数据索引、正文和附件仅归当前电脑，按已登录 SY 服务端用户 ID 分区，不进入云备份、移动端实时数据或账号消息中心。公开 MCP 不接受凭据，`account.open` 只打开本机配置界面，`account.configure` 仅私有 IPC。
- 主进程 `core.mail` 是 UI、MCP 和深链的共同能力边界；44 个公开动作必须使用共享 schema。后台初始化在主窗口建立后执行；账号切换、退出、暂停和移除取消旧上下文及连接。关闭邮箱面板继续收信，进程退出或休眠不收信。
- 邮箱同步状态读取既有 sync.get，jobId / accountId 必须二选一；按账号只读当前运行时任务，无任务为 null，读取不启动或恢复同步。界面只有 running 才转圈，暂停、认证失败、网络失败、取消和状态读取失败保持静态；同步完成后收起工具栏中的状态入口及数量，不保留占位，再次同步或异常时重新显示。message.count 的账号级 indexed / serverReported 展示进度，总数未知不推算百分比。失败保留已完成批次的 coverage，重试实际开始才回到 running；停止或旧进程留下的 running 记录不能充当活动任务。
- 同步只持久化元数据，正文和附件按需缓存；草稿和未知发送占用资产必须保留。删除本机账号不删除服务器邮件；本机未发草稿与 unknown 操作须明确确认影响后移除。
- 邮件为不可信外部数据。MCP 成功结果在 `{externalData:true,value}` 中返回 DTO；读取不自动已读。HTML 完整拼接后先进入 inert template，再原位清洗，不能把带远程资源的原文直接交给 DOMParser；随后使用仅含 `allow-same-origin` 的 sandbox，禁止脚本、表单和顶层导航。2026-10-23 用户明确批准应用读取清洗后正文的高度与链接点击，以支持整页滚动；不得增加 `allow-scripts`。远程图片只由用户明确加载并经过主进程固定解析 IP 的网络限制。
- 新信通知只在当前电脑呈现，不同步云端消息中心；历史 baseline 不提醒。发送固定预览、稳定请求 ID 和草稿修订，SMTP 接受不等于送达；unknown 只能核验，不得自动重发；阿里 Sent 由服务器保存。

- 写信（新建/回复/全部回复/转发）使用独立窗口，按当前 owner/generation 与意图复用；首次保存后也按草稿 ID 复用。取消自动保存和导航隐式保存；首次显式保存或发送前才持久化。关闭时仅在内容相对打开或最近保存时确有变化，且仍有收件人、抄送、非空主题、正文、附件或内嵌图片时提供保存/放弃/取消；编辑器初始化、空白格式、清空全部内容或撤销还原不触发提示。保存失败保留窗口；放弃不改动已保存版本。准备未完成可关闭，迟到结果不得创建草稿或恢复窗口。
- 写信窗口仅提供收件人和抄送，不提供密送或重复的顶栏关闭按钮。已有草稿中的密送地址在窗口显式保存、另存或发送前清空，单纯打开或放弃编辑不改写已保存版本；共享邮箱协议和 MCP 的 Bcc 字段继续兼容。
- 草稿箱复用邮件列表的逐项选择、全选和计数，每次最多选择 100 封。确认删除后按所选草稿各自的 revision 调用既有 `draft.delete`，只删除明确关联副本；删除期间按钮加载并实时显示剩余待处理数量，每项成功或失败后递减，全部处理后显示刷新状态；逐项失败保留草稿并提示，不自动覆盖版本冲突。账号或 SY 身份变化使剩余删除失效。
- 未保存附件使用窗口生命周期内存租约保护，缓存清理和过期维护跳过正在编辑的资产，窗口销毁或身份变化释放；未保存导入沿既有过期回收，不新增持久草稿。首次保存不改变编辑会话身份，进行中的导入不得被静默丢弃。
- 隔离正文容器允许应用插入带 CSP nonce 的唯一可信基础排版样式；邮件来源 style、脚本及事件仍剥离，CSP 保持默认拒绝资源。回复工具栏固定在阅读区顶部，其下邮件信息、附件和正文按自然顺序一起滚动，不再将邮件信息与正文分区滚动；应用测量正文实际高度并清理 observer 与监听。外链仅在原文位置显示，清洗后生成本地片段与受控索引，点击交给父页面的既有链接打开能力，不在头部重复列出，不允许 iframe 自行打开外部 URL。
- 永久删除逐项要求来源是已映射的回收站且服务端支持 UIDPLUS。正文扫描每批为下一封预留完整正文上限，不能把批次截断当成已完成。缓存附件的公开下载仍核对原邮件有效性；已固定的草稿和发送字节不因此清除。
- SMTP 适配器持有 Nodemailer 的实际连接，取消/超时关闭连接并禁止继续认证或 DATA；prepared 发送恢复以持久快照为唯一 MIME、Message-ID 与 Sent 对账依据。
