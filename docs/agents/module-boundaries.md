# 模块长期边界

本文件只记录跨入口、跨存储或容易被后续改动破坏的稳定边界。修改某个模块前还必须在 `docs/` 中搜索其设计规格和 ADR。

## App 能力包

### Connectors

- 内置连接器由静态 `BuiltinConnectorDefinition` 注册，类型差异只通过 `integration.kind` 对应的 Driver 实现；Service、IPC、Renderer 和 Agent Runtime 不得按连接器 ID 增加业务分支。
- V1 Driver 只支持无认证的本机 IPv4 回环 Streamable HTTP MCP。启用前必须经过权限与审计，并完成 initialize、initialized、`tools/list` 和必需工具校验；定义、协议版本、超时和用户状态不得混存。
- `app.connectors.state` 只保存版本、启用标志和稳定探测错误码。新 Agent 对话保存连接器 ID 快照，运行时再从当前内置定义生成 MCP 与 Skill contribution；之后启停不得改变已有对话。
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
- 分层叫法固定为：应用是「终端」，文件夹是「终端分组」，文件夹下那一行是「终端标签」（代码里的 workspace），标签内部可分成最多 8 个「分屏」，每个分屏里的那一个才叫「终端会话」（代码里的 session，也就是 `sessionId` 寻址的对象）。界面文案与文档一律按这套叫法，不得再把标签叫成「终端」或把会话叫成「对话」。代码标识符（`TerminalGroup` / `TerminalWorkspace` / `TerminalPaneLeaf` / `TerminalSession`）保持不变。
- UI、IPC、MCP 复用 `desktop/app-capabilities/terminal/main/service.ts` 的分组、活动会话、命令、有界输出和不可变 `sessionId`。
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
- Terminal 底部内置快捷输入由代码定义且只读；用户快捷输入是独立的应用级数据，只允许名称、单行输入内容和是否回车，通过 UI 私有 IPC 管理并加密存入 `app.terminal.toolbar-actions`。两者不得混存，也不得注册 MCP 工具。
- 启动设置只属于 Terminal：全局入口位于 Terminal Header，分组和快捷命令入口位于对应对象；不得在系统设置中增加重复入口。解析顺序固定为安全系统环境、Synapse 内置、全局、分组、快捷命令、一次性覆盖，配置变化只影响新 PTY。
- Agent 原生通知是默认关闭的 Terminal 启动设置，只影响新 PTY。启用后可为 `codex`、`claude` 注入会话级 PATH shim 和官方 Hook；用户别名或函数最终按 PATH 调用这两个命令时必须继续生效，绝对路径、远程 Shell、主动重置 PATH 或 `SYNAPSE_AGENT_NOTIFICATIONS_DISABLED=1` 不承诺接入。
- Agent Hook 只能向随机会话 token 保护的 loopback 端口上报有限事件元数据，不得上报提示词、回答、终端输出或工具参数。通知只显示 Agent 名、session 标题和状态；当前精确 session 聚焦时抑制，子 Agent 完成不得触发。同一批 Hook 事件同时驱动会话 `attention`：只在等待用户输入时写入 `waiting` 及 `approval` / `agent_question` 等 kind，用户提交提示、工具继续、中断、会话结束或用户在终端里手动输入后必须回到 `not_waiting`；该状态只含状态、kind、原因、置信度与水位，不得携带提示词、输出或工具参数。
- Agent 会话档案（`app.terminal.agent-sessions`）的读出口只有一份白名单投影：`state` / `agentKind` / `version` / `lastActivityAt` / `stateChangedAt`，由通知服务自己投影，原始档案类型不越过服务边界，好让泄露在类型层面就写不出来。`transcriptPath` 是指向用户整段对话的指针（提示词、回答、工具调用与被读进上下文的文件内容），交给外部等于把对话内容外包一次查询；`pid` 与 agent 自己的会话 id 是宿主进程细节。三者一律不出进程，审计与日志同样不记。投影块缺席（这里从来没有 agent）与 `state: "ended"`（跑过、已退出）是两件不同的事，不得合并；判变化用 `version`，不得把该块接进 `stateRevision` 或 observe 的唤醒条件。
- 可点击 Agent 通知由 Terminal 业务模块拥有，不得改造成 System Notifier 回调或统一通知中心。除精确 session 位于当前焦点时抑制外，统一使用系统原生通知，不得改用 renderer 应用内通知。点击必须复用不可变 `sessionId` 的 System App 打开请求定位具体 workspace/pane；Codex Hook 信任必须由用户确认，不得绕过。
- 终端字符宽度表以 Claude Code 的宽度库口径（`Bun.stringWidth`，等同 `string-width` / `emoji-regex`：`Emoji` 属性码点算 2 格）为准，渲染端与主进程 headless 仿真器必须共用同一张表；改装宽度表必须同时保证 MCP 读屏与序列化恢复的换行与渲染端一致。
- `TERM_PROGRAM=Synapse` 与 `TERM_PROGRAM_VERSION` 是受保护宿主身份。环境变量明文只进入加密 body；结构化元数据和 MCP 只能记录键、`set/unset`、来源及 revision。
- 终端会话定位是会话级纯导航，只接受不可变 `sessionId`，并复用仅含 `sessionId` 的 System App 打开请求定位 workspace/pane；会话不跨重启（ADR 0215），因此不提供任何 Deep Link，也不得扩展为命令执行或输出读取；标签级寻址由独立的 `workspace.*` 能力承担，不由这个导航入口派生。复制入口属于分屏：pane 顶栏右侧按钮组有一颗「复制引用」，整条顶栏的右键菜单（以及顶部标签菜单）里也有同一项；顶栏标题上右键不弹菜单——那条同时是拖动分屏的把手，菜单会跟拖拽抢同一个手势——双击标题重命名保持不变。产出的是五行纯文本 `key=value`：`workspace_id` 寻址它所在的标签（`workspace.*` 接受），`session_id` 寻址那个会话，两者的 `_title` 是给人认出「这是哪一格」用的（一个标签里分屏出来的几个会话，光看 id 谁也不知道读的是谁），`session_ref` 是由 `sessionId` 派生的本机短校验引用、不可反查、不被任何工具接受。复制入口的文案必须说明该引用只在本机本次运行期间有效。
- 不得新增通用 `shell.exec`、MCP 专属终端、静默输入抢占、隐式停止删除或自动强杀旁路。
- 终端标签（workspace）的置顶只通过 UI 私有 IPC 写入 workspace 记录既有字段：置顶只改变同分组内的排序，不得影响会话生命周期、布局或启动设置。它只活到本次运行结束——会话与 workspace 不跨重启（ADR 0215），刷新后的 workspace 是一张新面孔，因此不得承诺保留，也不得为此引入跨重启的 workspace 身份。侧栏标签列表与顶部标签只显示「需要你动手」的等待输入标记；不得再引入「有新消息」一类由原始输出事件推断的未读标记，它会随每次输出恒亮，反而稀释等待输入标记。
- 生命周期、注意三态、写入租约、输入/尺寸修订和输出水位相互正交。loopback MCP 不要求 Terminal 专属 token，但传输层必须提供稳定 `clientId` 与 `controllerInstanceId` 约束租约、幂等、配额和审计。
- 尺寸归属是独立于写入租约的运行时维度：只有手机自己的 resize 主张它，任何其它 resize（桌面 fit、自动化 resize、创建初始尺寸）都释放它，因此不需要额外的释放调用。归属变化即使格子数没变也必须广播，且不推进 `sizeRevision`。手机 detach 或超过更短的归属空闲阈值即释放；应用重启不恢复归属。同一会话只能有一个归属方，多端并发后写者胜，不做仲裁。完整规格见 `docs/adr/0216-coordinate-terminal-size-ownership-separately-from-leases.md`。
- 手机终端有两种显示模式，属于手机端的呈现选择：优先移动端（手机上报自己的格数，PTY 随之重排，手机 1:1 渲染）与优先还原（PTY 不变，手机按桌面网格整帧缩放，可双指放大）。桌面端在归属为手机时抑制自身 fit，该会话同时整块锁住：内容区、键盘输入、拖入路径、pane 顶栏的文件夹/平分/最大化/关闭按钮、以及底部命令条（含麦克风）全部不可用（只读的「复制引用」与「复制全文」不在其列，它们不改动任何东西），pane 内容区显示「正在被 X 使用」与「转移到电脑」按钮，pane 顶栏不盖蒙层但整体惰性。锁只针对该会话，同 workspace 的其它 pane、会话列表和应用顶栏不受影响。释放按钮只走 UI 私有 IPC，不新增 MCP 工具，也不改变 `app.terminal.session.resize` 的自动化契约。完整规格见 `docs/adr/0219-lock-the-terminal-while-a-phone-holds-the-grid.md`。
- 手机显示密度是设备级偏好，三档存「一个字符格子的宽×高」而不是行列数——行列数由单位尺寸与可用面积推导，所以换机型、换方向时观感密度不变。会话级覆盖只影响该会话且不落盘。密度属于手机设置，不在桌面设置中重复入口。
- 手机端应用内反馈的落点是固定的，不得为同一类消息再开第二条通道：没有归属地且转瞬即逝的确认走底部通知条（`NoticeBar`）；有归属地的失败走引发它的位置——登录失败在表单内、终端操作失败在输入栏上方的常驻行（`TerminalMessageList`）、连接状态在设备行与空状态里。判断依据是该消息「有没有一个屏幕位置本来就在说这件事」。
- 手机端不得为「应用自己发的请求」报错。连接时自动发出的 `sync`、为保持所属终端的重新 `attach`、重申尺寸归属的 `resize` 都不是用户发起的，没有待答的用户操作，也没有哪一块屏幕以「这个请求失败了」为主题——列表与设备行描述的是随后的状态。这些结果只记日志（`quietIntents`），用户没做任何操作就弹一条失败提示，是让应用看起来在随机出错。
- 手机端不得自己编造失败原因：能显示的是桌面端给出的、指名了原因的那句话；桌面端给不出原因时也只说「哪个操作没有完成」，不得回落到一句适用于所有失败的通用文案。桌面端 `describeError` 只做翻译与说明操作，不得再用单一兜底句替代终端错误码自带的含义。
- 手机端通知条与连接状态都不得遮挡返回按钮、标题、输入栏或标签栏。终端页必须用不参与布局的 overlay 而不是 safe area inset：inset 会改变可见行数，而行数上报给桌面会触发 PTY 重排，一条 1 秒的提示会让远端重排两次。
- 手机端提示不使用 `Theme.attention`。按 `Theme` 自己的契约，那个颜色只表示「需要人」，成功与信息类提示用它会让用户以为出了错。
- 手机端连接状态由 `Connectivity` 一处派发。「连不上服务器」与「没有电脑在线」是两个不同的问题、需要用户做两件不同的事，不得合并成同一句话，也不得在 socket 断开时声称电脑离线——此时的电脑列表要么没取到、要么是断线前的旧值。**「正在看的那台电脑不在线」是第三种，同样不得与「没有电脑在线」合并**：前者要用户在屏上换一台，后者要用户去开一台机器；只有账号下确实还有别的电脑在线时才是前者，一台都没有时仍是后者。
- 手机停在哪台电脑上由用户决定并记住，**不得自动换台**。同一个账号可以有多台电脑在线，手机同一时刻只看其中一台；选中的那台掉线时保留选择、清掉它的会话列表、把屏幕说清，由用户从设备行（或设置页同一份列表）换台。`onlineDesktops.first` 一类的兜底只在「用户从未选过」时成立。切换必须对被离开的那台下发 `detach`（它代持着手机在这些终端上的写租约），且这些自发的意图不得弹失败提示。电脑列表的显示名走 `GET /api/mobile/desktops`；`mobile.presence` 只带 id 是既有事实（它广播给账号下所有手机且 payload 有字节预算），不得为显示名扩它。
- 手机端按会话 id 保存的客户端状态都只对签发它的那台电脑成立。切换电脑时必须清掉一切「按下一次解析到的当前电脑」重新生效的东西（待重放写入、待答 attach、待答 history、尺寸主张等），否则会打到一台没听说过这个终端的电脑上。给电脑传的文件同理：附件在创建时记下目标电脑，只投递给那一台。
- 手机端不处理 `mobile.detached`：服务端只把它发给桌面（只有桌面知道该释放哪些写租约），没有回传手机的通路。客户端不得再为它接回调。
- 手机端诊断日志是**纯本地产物**：落在 `Library/Caches/SynapseLogs/`，不进 Documents（那会跟着 iCloud 备份离开设备），不自动上传，不进 `ui.tracking` 遥测通道，也不与桌面日志通道合并。它唯一的出口是用户在「我的」→「诊断日志」里主动导出，走系统分享。终端正文（命令、输出、转写、剪贴板）一个字节都不记，且这条由 `DiagnosticValue` 的类型系统保证——那种值类型里没有能装任意字符串的 case。真实会话/电脑/项目 id 一律换成进程内的本地别名（`s1`/`d1`/`p1`，映射表不落盘、退出登录即清）；改用哈希或改为可跨文件对照的稳定标识都属于改变这条边界。完整规格见 `docs/adr/0220-keep-mobile-diagnostic-logs-on-device-and-de-identify-ids.md`。
- 结构元数据使用已注册 `app.terminal.*` DataRepository；原始输出/检查点只进入专属有界加密块存储，安全存储不可用时不得回退明文。
- 普通备份排除输出、检查点、命令正文、用户快捷输入正文、活动租约、删除意图和短期幂等记录；恢复时必须丢弃所有 Terminal session/workspace 和关联操作，不得重建 PTY 或重投生命周期操作。

### Notifier

- Sound Notifier 是声音能力包，不是 System App。
- System Notifier 的完整权威规格是 `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md`。修改前必须完整阅读，不得以本摘要代替。

## MCP

- 系统设置的 MCP 分类是全局 MCP Server 状态、URL 和外部客户端注册信息的唯一 UI 入口；MCP 不注册为 System App，Database 不得重复承载该视图。
- Renderer 只通过顶层 `window.synapse.mcp` bridge 访问 MCP 专属 IPC；不得在 `database` bridge 中恢复兼容别名。
- MCP 设置分类只管理产品入口与客户端注册，不新增 MCP capability/tool，也不改变 loopback HTTP transport、端口、自动注册、ActionRouter 或运行生命周期。底层服务继续聚合全部已注册 capability domain。

## Console 用户 API 秘钥

- 用户 API 秘钥只通过受登录保护的 `/api/console/api-keys` 管理；创建响应只展示一次完整秘钥，数据库只保存 SHA-256 摘要和可识别前缀，列表不得返回摘要或明文。
- 查询、创建、重命名、权限更新和撤销必须绑定当前 `userId`；撤销保留记录并使其失效，审计不得包含完整秘钥、摘要或可还原材料。
- 密钥创建时必须显式选择非空开放 API scopes；已有未撤销密钥可以原地重命名、增删或清空 scopes，但不得通过该接口轮换密钥。首个 canonical scope `drive.public_link.download` 仅授权 `/api/open/v1/drive/public-links/downloads`，不能访问 Console、内部 Drive 或其它业务 API。旧 `drive.share_link.download` 与 `/api/open/v1/drive/share-links/downloads` 只作为已发布集成的兼容入口，不再用于新密钥或新文档。
- 开放 API 使用独立 `OpenApiKeyGuard`；临时下载地址使用十分钟数据库 grant 和仅存摘要的 bearer token。创建下载地址的请求体只接收完整分享 URL，受密码保护时密码保留在 URL query 中。grant 固定 POST 时的不可变文件版本或 Site deployment，源分享/API key/当前 scope/用户失效会阻止新的下载。
- `/api/open/openapi.json` 是开放 API 的权威 OpenAPI 3.1 机器契约发现入口。运行时路由和 strict 请求校验必须复用契约模块导出的路径与 Zod schema；新增、弃用或修改开放接口时必须同批更新契约和契约回归测试，不维护第二份静态 JSON。
- 开放 API 的应用地址使用 `APP_PUBLIC_URL`，文档地址使用 `DOCUMENT_PUBLIC_URL`；生产未配置文档地址时从应用根地址派生 `/document`，DEV 必须显式指向独立的本地文档服务。API capability 和 OpenAPI `externalDocs` 由服务端输出绝对文档地址，契约 `servers` 继续保持版本化相对路径。
- 开放 API 数据面只写固定列 `OpenApiUsageLog`，禁止 URL、密码、token、文件名、路径、storage key、manifest 和文件内容。POST/GET 显式跳过全局 Throttler，不增加密钥、IP、次数或频率限制。

## 客户端埋点

- 桌面端埋点复用 `ui.tracking` renderer 日志与既有日志 IPC，不新增 renderer analytics client、preload API 或并行跨进程通道。
- 网页端只允许在普通用户 Drive 控制台、文件浏览器和分享页采集 `web.drive.*`；平台管理员后台及其它网页领域不得接入。网页 Drive 通过统一边界覆盖交互，通过受控 API 包装记录所有 Drive 请求的成功、失败和耗时。
- 远程事件只允许固定分类、稳定事件键、组件、动作、结果、耗时、内置模块、窗口类型、客户端实例、会话、版本、平台和时间。桌面系统信息按采集时事件保存在独立本地 sidecar，发送时通过固定请求头传递；失去事件引用的 sidecar 由后台 DataRepository 维护 Worker 分批清理。网页浏览器信息由服务端从请求头归一化。服务端只持久化规范化浏览器/操作系统字段，不保存原始请求头。输入内容、显示文案、URL、路径、文件名、错误文本、堆栈、仓库/资源 ID 与任意 metadata 不得进入远程事件。
- 请求体不得包含 `userId`。服务端只根据有效桌面 Bearer Token 或普通用户 Web 会话 Cookie 关联登录用户；无认证为匿名事件，有但无效的认证信息必须拒绝。登录事件不得降级为匿名发送。
- 埋点投递必须是不可感知的单向副作用：日志 IPC、队列和网络失败不得弹错、递归记录、阻断业务回调或无限等待身份切换。稳定事件键只能来自代码；异步操作必须使用显式稳定操作名并记录结果与耗时，处理器级静态检查负责阻止遗漏回归。
- 原始事件保留 180 天，只能通过平台管理员保护的聚合统计接口查看；统计可提供活跃身份、会话时长、功能采用率、固定顺序漏斗和 D1/D7/D30 cohort 留存，但不得提供普通用户读取、原始事件列表、明细导出、用户排行或单个用户行为轨迹。完整设计见 `docs/superpowers/specs/2026-09-01-client-telemetry-design.md`。

## Drive

- `公开素材`使用稳定、匿名、不过期 `/files/<assetId>`。允许 JPG/JPEG/PNG/WebP/GIF/AVIF/ICO 和 PDF/DOCX/XLSX/PPTX/TXT/MD/CSV；禁止 SVG、主动网页内容、压缩包、可执行、旧 Office 和宏格式。
- 图片 inline，文档 attachment；替换只允许同一大类。需要密码、有效期或敏感控制时使用普通 Drive 分享，不得绕过。
- 浏览器 Markdown/MDX 在线编辑中粘贴、拖入或选择的图片使用平台托管 `/object/<objectId>`，不属于任何用户、不进入用户公开素材列表且不计用户云盘配额。`/object` 不限定未来对象类型；当前仅允许 PNG/JPG/JPEG/GIF/WebP/AVIF/ICO，单图 20 MB。临时对象 24 小时未随原文档保存激活则清理，激活后不因移除引用或删除文档自动删除。既有相对图片、`/files/` 与外部 URL 不迁移、不改写，也不提供迁移操作。
- 本地 Markdown/文件夹上传仍将引用图片作为普通用户 Drive 文件并保留相对路径；HTML 及其依赖仍走 Drive 文件或 Site；用户明确要求图床、直链或公开素材时仍创建计入其配额的 `/files/<assetId>`。平台托管文档图片不注册 MCP 上传、列表或管理工具。
- 独立 HTML 在用户未明确发布整个文件夹时默认 `/share/...`；多文件站点或明确发布文件夹时使用 `/sites/...`。文件夹即使只有 `index.html` 也可发布为 Site；仅指定上传目标文件夹或泛称网站不等于发布整个文件夹。
- 单文件 HTML 分享预览保留 `allow-same-origin`，允许分享页面使用 `localStorage` / `sessionStorage`；因此它与 Synapse 主站同源，不是账号会话隔离边界，只应分享可信 HTML。
- Markdown 源文本是协同与版本历史的权威数据。Yjs 更新先进入协同日志，只有检查点进入 `DriveFileVersion`；上传覆盖、历史恢复与 MDXEditor 整文保存必须经过同一 item 级协调器并切换协同代际。
- Markdown 评论锚点独立于讨论串和评论删除状态，服务端投影与解析结果是权威。证据不足只能进入未定位状态，不得由 Renderer 自行搜索并猜测重挂。
- Anchor V2 首次上线会一次性清理旧版评论，不转换 UTF-16 旧坐标；文档、分享标识和历史版本不得随评论清理发生变化。上线后的新评论同时保留 V2 权威锚点与回滚兼容投影。
- Markdown 实时协同仅属于浏览器 Monaco/阅读界面；Drive MCP 内容写入继续走版本化服务，不加入协同房间。分享评论支持文件名以 `.md` 结尾或 MIME 为 `text/markdown`、`text/x-markdown` 的 Markdown 文件，并只能通过 `app.drive.link.annotation.*` 能力读取和管理；不得扩展为 presence、协同房间控制或分享正文编辑旁路。

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
- Agent 的每个项目在终端里有一个同名分组（`TerminalGroup.projectId` 指向项目，名字为「项目:」+ 项目名）。这条同步是**单向的一次性对账**：项目列表变化时补齐、改名、删除对应分组，除此之外两边互不干涉。项目分组不得改名或删除（菜单不提供），因为名字与存亡都由项目决定；用户自己建的分组不受同步影响。项目来源的会话落进该项目分组，**没有指明归属的会话只落进用户自己的分组**（`ensureDefaultGroup` 跳过项目分组），不得再按「列表第一个分组」落位。项目分组的 `settings.defaultCwd` 与名字一样由项目决定：始终等于项目工作目录（托管知识库取运行目录，由调用方解析；解析不到就清空该槽位回落到全局），分组设置里只读，其余启动设置（shell、环境变量、命令）仍归用户。它不注册 MCP capability、tool、Workflow Node、Automation Action 或 Deep Link，Terminal MCP 工具数量不变；`TerminalGroup.projectId` 只是既有分组记录的字段。
- Agent 项目文件树拖入对话时只把主进程解析后的选中路径以空格连接并插入草稿当前光标，不创建附件、不立即发送，也不扩展为公开 Capability、MCP 或 Deep Link。
- 工作区辅助面板属于 Agent 工作区壳，不属于消息组件、全局 App shell 或 `SidebarContentLayout`。宽屏使用会话与辅助面板分栏，窄屏切换为详情视图；面板状态按会话隔离，文件 Diff 只是首个面板描述符。
- 共享只读 Diff renderer 位于 `desktop/src/components/diff/`，Git 通过模块内 adapter 消费，Agent 不得跨模块导入 Git 内部实现。patch 生成与解析复用 desktop 直接生产依赖 `diff`。
- Agent 文件检查点摘要是 turn postlude 与 append-only history 事件；完整 sidecar 存在项目级 `agent.file-checkpoints` DataRepository。四个详情/撤销 IPC 仅供 Agent UI 使用，不扩张公开 Capability、MCP、Workflow、Deep Link、File Opener 或 Git 边界。
- 文件撤销只面向 SDK 支持的当前会话最新检查点，并采用两阶段校验；不等同于 Git discard、Drive Checkpoint、对话回退或模型上下文回退。安全细则见 `docs/agents/agent-runtime-security.md`。
- 其它 Knowledge Base 规则见 `docs/agents/knowledge-base.md`。

## Workflow 与 Automation

- Workflow 保持外层 DAG；MCP/agent 写操作走 get → mutate → validate → save，校验失败不得保存，不得删除 end 节点。
- 文件/文件夹参数用 `allowMultiple` 明确单选/多选。多选是有序、非空、最多 100 项且不重复的资源引用数组；两者不得自动转换。子工作流直接绑定时资源类型与 `allowMultiple` 必须一致。
- loop 退出由子图真实节点和 Loop Output 的 continue/break 出口表达，不得退回隐藏配置表达式。
- Scheduler 子进程环境经过 allowlist；`PATH` 按用户配置和 login shell 合并；运行诊断必须保留并用于失败排查。

## Rule、Skill、Content 与 Secrets

- 写入编辑器目录、覆盖、替换、备份失败等敏感路径必须确认、权限检查和审计；备份失败阻断替换。安装与复制文案不得混用。
- 资源仓库非只读 Skill 采用协作编辑：有写权限且完成仓库身份配置的用户可更新，原 `createdBy` 不变并记录修改者；删除、恢复、永久删除仅创建者。该规则不改变云 Skill Repository owner 模型，不扩展到 Rule/Prompt。
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
