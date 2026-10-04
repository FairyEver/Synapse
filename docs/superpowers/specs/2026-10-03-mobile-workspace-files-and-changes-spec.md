# iOS 工作区文件与 Git 差异审查 V1 Spec

日期：2026-10-03

状态：V1 实现与验收中，尚未发版。本文定义产品行为与验收契约；私有协议已进入实现，运行证据及平台缺口见[验收记录](../plans/2026-10-03-mobile-workspace-files-and-changes-acceptance.md)。

设计来源：[截图分析及产品设计](2026-10-03-mobile-workspace-files-and-changes-design.md)

开发计划：[实施计划](../plans/2026-10-03-mobile-workspace-files-and-changes-plan.md)

## 1. 目标、范围与规则衔接

V1 在当前手机终端内提供一个「工作区文件」面板，包含「已修改 / 所有文件」。用户能浏览桌面会话的目录、查看文本及 Git 差异、把文件或目录引用加入现有输入草稿。所有读取均由 iOS 用户操作发起，经云中继交给当前选中电脑；手机等待桌面响应。桌面负责会话上下文、文件、Git 与权限事实，云端只瞬时转发，手机只负责呈现和草稿。

当前手机「创建对话」启动桌面 Claude Code 终端，尚无原生 Agent 消息时间线。截图中回复后的「14 个文件、+600 / −28」与面板内「未暂存、+10349 / −435」属于不同统计范围。V1 只提供当前 scope 的 Git 审查，不能标为「本轮修改」，不能从终端输出推测 turn/checkpoint。

本规格在**实施完成并同步规则后**取代旧 [手机终端 Git 设计](2026-09-21-mobile-terminal-git-design.md) §3 决策六、§6 非目标、§7 第 6 项及验收第 40 项中「不下发文件清单或 diff」的阶段限制。取代范围仅是本文的按需只读接口。现有全量提交、默认不推送、不做文件级暂存、不登记仓库等边界继续有效；本次文档整理不表示运行时已放开限制。

### 1.1 V1 包含

- 三个现有终端上下文入口，共用文件面板与状态。
- 当前目录或当前实际 Git worktree 根的有限 scope，两个视图始终同根。
- 按层目录读取、文件名/相对路径搜索、UTF-8 文本和有界 Markdown 预览。
- 未暂存、已暂存分开审查，文件概要、unified diff 与正确的 before/after 内容。
- 桌面校验并格式化引用，手机只追加输入草稿。
- 版本校验、取消、分页、资源预算、两跳背压和旧端兼容。

### 1.2 Non-Goals

不新增原生 Agent 消息卡片、远程 rewind、文件编辑/删除、文件级 stage/unstage、历史提交或任意分支比较、冲突解决、正文搜索、仓库镜像、下载整棵树、持续 watcher、后台仓库扫描、源码主动推送或云端源码存储。不新增公开 MCP 工具、System App、Workflow/Automation Action、Deep Link、依赖或新的底部栏目。

现有手机文件上传、终端 Git 写操作与终端输入沿用各自协议；本功能不借这些接口绕过只读约束，也不改变它们的权限。

## 2. 已核实的代码落点

以下路径已经存在；表后的新增类型与模块均属于实施要求。

| 现有代码 | V1 复用点与限制 |
| --- | --- |
| `SynapseMobile/SynapseMobile/Features/Terminal/TerminalScreen.swift` | 更多菜单、输入栏、presentation 与现有草稿；只接入口和插入回调，不承担读取/解析 |
| `SynapseMobile/SynapseMobile/Features/Terminal/Git/TerminalGitPanel.swift`、`TerminalGitFlow.swift` | 「改动」行跳转；现有 Git 状态不是文件列表或分层计数 |
| `SynapseMobile/SynapseMobile/App/SynapseAppModel.swift` | 账号、选电脑、会话与统一 intent 漏斗；补文件待答取消及目标校验 |
| `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`、`Core/Realtime/RealtimeClient.swift` | Swift DTO、WS/HTTP fallback；大内容处理不能留在 MainActor |
| `shared/src/mobile-live.ts`、`shared/src/live.ts` | 既有信封、共享校验、握手；新增有界文件契约与能力字段 |
| `desktop/electron/services/mobile-gateway/intent-executor.ts`、`transport.ts`、`controller.ts` | 网关注入、actor、待答与结果发送；现有执行前结果缓存不能直接缓存文件正文 |
| `desktop/electron/services/workspace-file-tree-service.ts` | 复用可抽离的路径规则；Electron `ownerId`、全量 `readdir` 和打开即 watcher 不能用于远端 scope |
| `desktop/app-capabilities/terminal/main/workspace-tree-ipc.ts` | 按 `sessionId` 探测真实 cwd 的既有方式 |
| `desktop/electron/services/terminal-git/`、`desktop/electron/services/git-client/` | 复用受控 runner、路径校验和解析 helper；不能直接调用有临时 index/对象写入行为的高层 `getDiff` |
| `server/src/mobile-live/mobile-live.gateway.ts`、`mobile-live-relay.service.ts`、`server/src/live/live-desktop.gateway.ts` | 已认证点对点 relay、HTTP 回退与 desktop 入站预算；补手机实例绑定、两跳背压与新结果校验 |

## 3. 入口、范围与导航

### 3.1 三个入口

| 入口 | scopeMode | 默认视图 | 行为 |
| --- | --- | --- | --- |
| 终端详情「⋯ → 工作区文件」 | `currentDirectory` | 所有文件 | 浏览当前会话真实 cwd 的子树，非 Git 目录也可用 |
| Git 面板「改动」行 | `repository` | 已修改 | 标签/无障碍动作明确「查看仓库更改」，对应仓库级摘要 |
| 输入栏「＋ → 工作区文件」 | `currentDirectory` | 所有文件 | 浏览与选择引用；仍能切已修改 |

「＋ → 文件」继续上传手机文件。「工作区文件」不取代手机文件选择，不复用会话资源 URL inspector。顶栏第二行继续只读。

Git 面板跳转先关闭 Git，再由终端统一 presentation route 打开文件面板。记住来源以返回 Git；禁止 sheet 叠 sheet。文件预览属于同一面板内部导航或展开。入口在电脑离线/版本不支持时解释原因，不排队读取。

### 3.2 Scope 根与生命期

桌面按存活的不可变 `sessionId` 调用既有 cwd 探测能力，不依赖 mobile summary 的显示用 cwd，不接受客户端根路径。

- `currentDirectory`：冻结当次会话真实 cwd；已修改和所有文件均限制其后代。cwd 位于仓库子目录时，Git 变化也只覆盖此子树。
- `repository`：从该 session 的真实 cwd 解析**实际 worktree top-level**，为精确根建立新的只读授权。不能替换为项目配置或主仓库路径，不调用 `add_local`，不写 repositories 注册表。
- 面板的同一目录上下文显示根名及「当前目录 / 仓库」，范围菜单与独立根目录引用动作邻接；无障碍名称和值完整说明范围和根名。scope 建立后终端 `cd` 不静默换根。界面组织按[2026-10-04 重做说明](2026-10-04-mobile-workspace-files-ui-redesign.md)。
- 所有后续读取、刷新、根范围切换与引用准备都重查会话上下文；实际 cwd 或解析根变化时旧 scope 过期，要求用户重新打开。`repository` scope 即使仍处同一仓库，只要 cwd 已变也按同一规则过期，避免两种 scope 的失效口径分叉。旧结果不能接到新目录。
- 刷新只允许原根与原 cwd 上更新版本；根或 cwd 改变必须 close 旧 scope，再由用户重新 open。切换 scopeMode 同样 close 后 open，不能修改旧句柄的根。
- 普通非 Git scope 的所有文件可用；已修改显示非 Git 状态。`repository` 打开失败返回 `not_git_repository`，不猜一个根。
- Git条目中的gitlink仅展示指针变化，不递归子仓库。普通文件树可按父scope的同一路径边界逐层浏览子模块目录；这不把其内容当父仓库diff。只有当前session真实cwd已进入该子模块后，由用户重新open才能建立其自己的Git scope，不允许客户端指定任意子目录改根或沿用父仓库blob。
- scope 关闭、退出账号、切电脑/会话、确认 session 结束/删除、桌面重启时失效。网络断开不等于 session 结束。10 分钟空闲 TTL 兜底回收。

## 4. 文件与 Git 行为

### 4.1 所有文件

打开只读取根一层。展开目录再发请求；折叠只变本地展开状态。目录优先、名称排序，由桌面形成受预算限制的稳定页。保留现有 `.git` 管理目录等排除规则；`node_modules` 等目录可见但默认折叠。不得在打开时递归、装 watcher 或把全树下发手机。

普通文件轻点打开只读预览；目录轻点展开。搜索结果含相对父路径并能定位回树。树、搜索和预览共享 entry 句柄，不用文件名作唯一 ID。symlink 和特殊对象可显示类型，V1 不跟随、不读取、不允许引用；可显示不代表可操作。

搜索只匹配文件名/相对路径，不读正文；范围始终是 scope 根的全部层级，与哪些目录已展开无关。用户按系统「搜索」提交后才遍历；修改查询取消旧请求。每次有界遍历耗时最多 2 秒、访问最多 20,000 个节点；命中、分页、扫描是否完成分开表达。有可恢复游标时允许用户继续；达到不可继续的总量限制时显示截断并允许缩小查询。未扫描完的空页不能宣称无命中。

### 4.2 Git 范围与内容版本

| changeRange | 比较 | before | after |
| --- | --- | --- | --- |
| `unstaged` | index → 工作树；未跟踪文件单独标新文件 | 受校验 index blob；未跟踪为空 | 受校验磁盘内容；删除为空 |
| `staged` | HEAD → index；无 HEAD 用 cached diff 的空基线语义 | 受校验 HEAD blob；新增/无 HEAD 为空 | 受校验 index blob；删除为空 |

默认未暂存。首次打开时只有两层集合计数均完整、unstaged为0且staged大于0才自动选择staged；未知或部分统计保持默认。桌面首个changes响应提供两层概要。用户选择过后不自动切换。同一路径可同时出现在两层，分别生成changeId和版本，不合成一个diff。原`mobile.gitStatus.changeCount`为两层去重文件数，不能作为当前范围或cwd子树的总数。

文件概要包含相对路径、状态、可内联/预览状态及统计完整性。完整文件计数与总量只有确已计算才填数值；未知为 `null`，不能写 0。hunk 计数只统计本片段。正文分页与截断不改变统计范围。未跟踪文件的精确行数只按需补算，打开列表不批量读取全部新文件。

完整性分别表达：collectionComplete 表示桌面已完整发现所声明范围的文件/目录集合（即使尚有后续传输页）；statsComplete 表示该范围的统计完整；contentComplete 表示从第0页沿同版本cursor链到本页，对应文件 side/差异内容已全部可获得。三者不能互推。未知总文件数、增删行数均用 null；部分统计明确覆盖范围，不能当总体统计。正文分页尚未到末页时 contentComplete=false，不因已获得完整numstat就设true。搜索还单独返回scanComplete，已扫描子树的分页完成不等于整个scope扫描完成。

rename 两端均在 scope 内才返回旧/新路径及完整比较；仅一端在内按范围内新增/删除展示，不泄露范围外路径或读取范围外 blob。删除可预览 before；staged-only 可预览 index；不存在的 side 返回 `absent`，不能偷换成当前磁盘文件。

冲突只显示状态与说明，不做自动选择或解决。无 HEAD、重命名、删除、新文件、二进制、编码不支持、gitlink、类型替换、外部 filter 与 diff 过大各有具体状态。gitlink 返回旧/新引用元数据，不递归仓库；非文本不伪造文本差异。

### 4.3 Diff 与预览

changes 首次仅拉文件概要。展开一个文件才请求 diff，默认只展开当前一个文件；收起保留滚动位置。文件全文是独立预览动作。

每侧预览以桌面回传的canPreviewBefore/After为准。受比较的tracked side任一含NUL时整条为binary、双方不可预览；某侧超过2MiB时diff受限，另一有界普通文本侧仍可按桌面flags预览，手机不能凭limit_exceeded一律禁用双方。

unified diff 返回有界结构化 hunk/line：稳定片段 ID、旧/新起始行与数量、行 kind（context/addition/deletion/meta）、旧/新行号或 `null`、文本、长行截断标记。每页带连续页位置；分页可在完整行边界切割一个 hunk，下一页明确携带同 hunk ID 与续接位置。不得把半个 JSON 结构或字节碎片交给 UI 自行猜。手机按版本与页位置接页，缺页/重页不能重复追加。

源码和 diff 使用独立纯展示模型；UTF-8 预览分页，Markdown 复用 `MarkdownContent` 并受相同预算。其他编码/二进制显示元数据和原因。不得用 WebView 执行源文件、HTML/脚本，或启动桌面编辑器/程序来预览。

文本等宽、支持 Dynamic Type，默认换行；视觉换行共享原始代码行号。用户可切不换行并水平滚动。增删文字保留语义文字色，标记通过现有 Theme 集中使用系统语义色，并提供 `+ / −` 与 VoiceOver 描述。无自定义色、卡片层级或 ANSI 终端网格。大 patch/Markdown 数据准备放后台，有界 SwiftUI 行模型先行；只有实测不满足预算才使用 UIKit 内容虚拟化。

### 4.4 插入引用

文件/目录长按菜单和文件详情工具栏提供「插入到输入框」。当前scope根使用直接系统按钮「插入当前目录」或「插入仓库根目录」，无需为单个动作再开菜单；已有范围label保留根显示名。scope 的 rootEntryId 用于该根目录引用。操作只对可读取、在根内的普通文件/目录开放。

1. 手机发 reference 请求，携带桌面下发的 scope/entry 句柄与 expectedContextVersion。
2. 桌面重新校验 owner、session/cwd/root、节点和权限，使用当前平台 formatter 生成精确绝对目标路径引用。手机不拼绝对路径、不做 shell 转义。
3. 手机核对账号、电脑、session、scope generation 与等待时的 draft generation，追加到**原草稿当前插入位置**，保留已有文字，关闭面板并显示文字模式。
4. 不调用 PTY input/paste/key、回车或 command，不自动发送，不自动弹键盘，不改变持久语音偏好，不额外 attach、申请租约或 resize。

草稿等待中已编辑、切目标或 scope 过期时放弃插入并就地提示重新选择，不覆盖草稿、不写剪贴板。引用不是公网 URL/上传副本，也不声称 Agent 已读取。后续发送仍遵守既有输入权限与租约。

当前输入栏TextField与`TerminalExpandedInputSheet`只绑定文本，未共享selection。V1必须补齐两者共享的最小草稿选区状态，不能假定已有光标接口。开始reference请求时捕获draft generation、有效UTF-16选区和文本；结果匹配后在MainActor原子插入。折叠选区取光标位置，非空选区在选区末端插入并保留选中文字；无有效选区在末尾插入。不得切开Unicode字符（包含中文、emoji和组合字符），非法边界按无有效选区处理。用户改变正文或选区会推进generation；打开面板造成的失焦不应伪造编辑或重置选区。引用与左右非空白文本各用一个空格分隔；已有Unicode空白边界不重复加空格。插入后选区折叠到新增内容末端，不自动唤起键盘。

桌面拖入路径的纯 formatter 复用/抽离，主进程不导入 renderer。空格、引号、`$`、反引号与 shell 特殊字符必须正确处理；NUL、CR/LF、控制字符拒绝。无法可靠格式化的平台返回 `unsupported_platform`，不能把 POSIX 转义当成 PowerShell/CMD 转义。

## 5. 新增私有协议契约

### 5.1 既有信封与新增部分

现有 `MobileIntentEnvelope` 使用 `v: 1`、`intentId`、`kind`；`MobileIntentPayload` 包含 `desktopClientInstanceId`、`mobileClientInstanceId`、`intent`。`MobileIntentResult` 已有 `intentId`、`outcome: accepted | rejected | no_op`、可选 code/message/sessionId，`MobileIntentResultPayload` 按 mobile 实例定向。V1 沿用，**不再造等价 requestId**。

新增 `kind: "workspaceFiles"`，字段 `filesVersion: 1`、`sessionId`、`operation`；operation 的字段组互斥，不能附任意根路径、命令、ref、OID、Git 表达式、offset 或预览 side 的替代值。shared/Swift/server/desktop 同步维护操作判别与有界验证。

新增 `MobileIntentResult.workspaceFiles`，包含 `filesVersion`、`operation`、sessionId、适用时的 scopeId/contextVersion、readAt、操作数据。它不复用现有 `referenceText`（会话复制引用）或 `git`（既有 Git 操作）字段。读取结果走单个有界 `mobile.intentResult`；不塞入 summary/frame/gitStatus，不广播。

现有result payload只有mobileClientInstanceId+result，没有desktop；RealtimeClient现有回调只交result，server pendingIntents仅按intentId关联。V1对workspaceFiles新增可选`MobileIntentResultPayload.desktopClientInstanceId`，文件回执必填。server将它与**发送回执的已认证desktop连接**核对并标记来源；relay自身失败回执以已认证pending目标填入。手机接收时保留这个typed context，并和当前账号/连接世代、desktop/mobile实例、session与pending参数核对，不能仅按intentId接受。server文件pending的索引键为账号+desktop+mobile+intentId；记录的完整请求指纹绑定session与参数，接收时另核对session、operation与scope。不同session复用同一intentId返回request_conflict，另一账号/电脑的同名intent不能完成本请求；保留旧intent的兼容行为。账号不新增可伪造的payload字段，仍取可信连接上下文。

### 5.2 操作字段

下表均为新定义。所有操作都携带 sessionId；读取/刷新/引用/close 另携带 scopeId，cancel 按下述目标规则携带 scopeId。读取/刷新/引用的 `expectedContextVersion` 必须与手机当前 scope 一致，控制清理不要求旧读取版本仍有效。所有句柄由桌面生成。

句柄与版本为有界不透明字符串；页位置、行号、数量为非负安全整数，未知统计显式为 `null`。readAt/expiresAt 沿用线上时刻的字符串表示，固定 UTC ISO 8601、最多 48 字符；桌面使用自己的单调时钟执行 TTL，不能依赖手机时钟决定授权或有效期。

| operation | 必需输入 / 可选输入 | 成功数据 |
| --- | --- | --- |
| `open` | scopeMode=`currentDirectory`/`repository` | scopeId、rootEntryId、scopeMode、rootDisplayName、contextVersion、expiresAt、gitAvailable；只建上下文，不递归。Git 不可读时可携带 gitUnavailableReason |
| `refresh` | scopeId、expectedContextVersion | 根未变时返回新的 contextVersion 与 scope 描述，作废原目录/change/content版本与游标；根变返回 scope_stale |
| `directory` | expectedContextVersion、directoryEntryId；可选 cursor | directoryVersion、entries、nextCursor、pageIndex、completion |
| `search` | expectedContextVersion、query；可选 cursor | searchVersion、命中 entries、nextCursor、pageIndex、completion、scanComplete、scannedEntries |
| `changes` | expectedContextVersion、changeRange；可选 cursor | changeSetVersion、两层概要、当前层文件 entries、统计完整性、nextCursor/pageIndex/completion |
| `diff` | expectedContextVersion、changeSetVersion、changeId；可选 cursor | contentVersion、file/hunk/line、文件统计、nextCursor/pageIndex/completion，或不可内联原因 |
| `preview` | expectedContextVersion、target；可选 cursor | contentVersion、source/side、元数据、文本页、nextCursor/pageIndex/completion，或不可预览原因 |
| `reference` | expectedContextVersion、entryId | 桌面格式化 referenceText、contextVersion；不产生输入副作用 |
| `cancel` | targetIntentId；目标不是open时必需scopeId | cancelled / alreadyCompleted / notFound；取消同owner/session的open或同owner/scope的其他pending |
| `close` | scopeId | closed / alreadyClosed、pendingCancellationCount；使scope立即不可访问并释放句柄/游标/缓存，所属任务按可终止硬超时完成清理 |

preview.target 为互斥联合：`{ source: "disk", entryId }` 或 `{ source: "change", changeId, changeSetVersion, side: "before" | "after" }`。分页时还必须带首个响应的 expectedContentVersion。diff 分页同样要求 expectedContentVersion。手机不能指定读 HEAD/index/disk 的自由组合；桌面通过 changeRange 与 changeId 绑定上述基线。

directory/search/changes 初次不传 page 版本；后续 cursor 已绑定首个版本与所有参数。entries 的显示路径均为 scope 内相对路径；普通 entry 给 entryId/name/relativePath/kind/metadata/可操作状态，change entry 给 changeId/状态/范围内路径/统计/支持状态。所有用户可见路径必须对应真实完整名称；超出字段预算时明确不可处理，不能截短路径后仍作为目标。

cancel/close不占读取槽或排在被取消读取之后，重复请求幂等。取消pending open时尚无scopeId，按可信owner/session/targetIntentId处理，不能要求一个尚未产生的句柄。控制请求先到且尚无目标记录时如实返回notFound，但在同owner下保留有界取消tombstone，阻止随后到达的该open创建scope。open成功创建scope前检查取消tombstone；若成功与取消交错，按记录在scope中的creatorIntentId定位并关闭该open创建的scope，cancel如实返回alreadyCompleted和closedScopeId，不遗留占用配额的scope。该关联不依赖正文结果缓存是否已被驱逐。

其他cancel只有确认任务已停止才返回cancelled；原读取已完成返回alreadyCompleted，找不到同owner任务返回notFound，不能谎报取消。close的closed表示scope立即不可再读取，不等于所有子进程已退出；pendingCancellationCount明确尚待终止的任务，桌面在§7硬超时内终止。控制操作校验可信owner、目标任务/scope记录或完成tombstone，不要求scope仍可读取、session仍存活或cwd仍与原根一致，故过期/结束后的清理和重复close仍可完成；跨owner始终拒绝。手机关闭先增加generation并解除pending/展示状态，再尽力发送控制请求；任意已完成/迟到结果均不能再改变内容或草稿。

### 5.3 Owner、版本、游标与页完整性

`gitAvailable=false` 不能等同于非仓库。可选 `gitUnavailableReason` 只在该值为 false 时出现，限定为 `not_git_repository`、`git_unavailable`、`external_filter_required`、`permission_denied`、`unsafe_path`、`limit_exceeded`。手机分别显示对应必要状态；旧回复缺少原因时显示通用的“无法查看 Git 更改”，不得伪称非仓库。Git 受限不阻断已经授权的所有文件浏览。

- 内部 owner=`认证账号 + desktop实例 + mobile实例 + sessionId`。账号取已认证连接/桌面登录上下文；desktop 由账号路由确认；mobile 实例须等于握手注册实例。请求不能自报 userId 或 Electron sender.id。HTTP fallback 做等价认证与实例归属检查。
- contextVersion 为不透明上下文 token，绑定 scope 根、真实 cwd、实际 worktree/session 身份和桌面运行世代。directoryVersion、searchVersion、changeSetVersion、contentVersion 分别绑定对应读取事实；Git 版本覆盖实际 HEAD/index 状态、目标文件身份和所选层。不得向手机导出对象表达式作为下一次读取输入。
- 每次读取/刷新/引用及对应内容缓存命中都重查owner/授权/有效期/目标版本，控制清理按§5.2的owner/任务/tombstone例外处理。读取前后验证身份和版本，变化则`content_stale`/`scope_stale`，不发布混合快照。跨进程检查并非原子事务，不宣称消除所有OS竞态。
- cursor 是随机/不透明、owner/scope/operation/参数/版本绑定的短期句柄，最多 60 秒 idle TTL；不是权限。伪造、过期、跨查询、跨目录、跨 range 的游标拒绝。丢失游标允许明确刷新/重新搜索，不从未知 offset 继续。
- nextCursor 非空表示仍可继续；completion=`complete | partial | truncated`，并按§4.2分别给collectionComplete/statsComplete/contentComplete（不适用的字段不传）。partial 必须可继续，truncated 必须提供原因且不能伪装 complete。目录超候选预算不能把未完成排序结果当全局完整排序；给 limit 状态并让用户缩小范围。
- 每页 pageIndex 从 0 连续递增；iOS 只接同版本预期下一页。相同页幂等替换，跳页拒绝；不能沿用 frame 的后缀替换/可丢帧语义。
- scope/entry/change/cursor 全是短期句柄，不是授予磁盘权限的凭据。旧版本被刷新或失效后，句柄及对应结果缓存一起失效。

### 5.4 结果与错误

成功返回 outcome=accepted 与匹配 operation 的 workspaceFiles 数据；重复 close/cancel 可返回 no_op。认证、形状、版本、授权、预算或读取失败返回 rejected + code。只要已识别请求就携带适用的 operation/context；relay 在桌面响应前失败可只给既有 intentId/code，手机按 pending 上下文就地显示。

| code / 内容状态 | 手机处理 |
| --- | --- |
| `invalid_request`、`invalid_scope`、`invalid_cursor`、`request_conflict` | 终止本次请求，不按空结果处理 |
| `permission_denied`、`unsafe_path`、`special_file` | 显示桌面给出的受限状态，不重试不同根 |
| `not_git_repository`、`git_unavailable` | 所有文件仍按合法 scope 使用；Git 视图说明原因 |
| `scope_stale`、`content_stale`、`cursor_expired` | 保留旧内容并标过期，用户刷新或重开，不混页 |
| `session_ended` | 清此 session 的 scope 与 pending |
| `binary`、`unsupported_encoding`、`external_filter_required`、`unsupported_platform`、`absent`、`gitlink` | 元数据/文件行内显示原因或空 side；不冒充普通 not_found |
| `limit_exceeded`、`truncated` | 保留已声明有效的部分并显示完整性，允许缩小范围 |
| `busy`、`transport_backpressure`、`deadline_exceeded`、`desktop_offline`、`relay_failed` | 结束加载、可手动重试，禁止自动重放 |
| `unsupported_version` | 显示需更新服务端/电脑端，不尝试未知操作 |

特殊内容状态可作为 accepted 的元数据结果而不含文本；跨端 fixture 必须固定其形状。code 与可读说明由桌面/relay 真实判断产生，手机不能把所有失败改写为同一个原因。

## 6. Hard Rules：权限、路径与 Git 只读

目录、搜索、Git 派生内容、正文和引用准备均经 PermissionGuard 与 AuditSink。actor 保持 `agent:mobile-gateway`。在可信 owner/session 根解析后建立**精确 scope 资源**的只读策略；不能把 `fs.read.outside-userdata` 无条件放入现有 allowlist，不能用 `user:renderer` 命中用户自动允许，不取得额外 shell/写/网络权限。

Git派生读取需显式绑定桌面安全发现的精确gitDir/commonDir元数据资源（worktree可能把它们放在显示根外），并通过既有PermissionGuard/AuditSink；这只授权HEAD/index/本地对象等必要元数据，所有返回路径及可预览blob仍限当前scope。不能借此扩大可浏览工作树根或读取范围外blob；未获元数据资源授权时Git受限，合法目录浏览仍可用。外部对象目录/alternate不能绕过资源授权或触发隐式网络。

objects/info/alternates与http-alternates只允许缺失或空文件；不能只在scope发现时检查。后续原生Git读取前后均用已授权、有界的安全FD路径复验，覆盖概要/指纹、blob各阶段与子模块HEAD；打开后创建、填充、替换或取消时拒绝/中止，结果不得先返回。此软件门控不等同于操作系统级进程文件系统沙箱，测试须明确并发插入的实际检查边界，不宣称覆盖所有系统级竞态。

内置换行/文件模式比较还需考虑桌面用户的标准全局配置。只允许从桌面可信 homedir 和 XDG 配置位置确定 `~/.gitconfig`、`$XDG_CONFIG_HOME/git/config`（缺省为 `~/.config/git/config`），按 XDG→home→local 优先级提取 `core.autocrlf`、`core.filemode`；移动端不提供配置路径，任意 `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 覆盖不成为读取入口。每个精确配置文件在检查/读取前单独授权并审计，校验祖先、普通文件和前后身份，使用不跟随链接的有界描述符读取，最多64KiB。固定字节只交给 `config --file - --no-includes` 的专用受控解析入口；include/includeIf及外部转换器使Git受限，不跟随或执行。配置正文和其他键不进入普通Git环境、回执、日志或审计。所有普通Git命令继续关闭global/system加载；配置缺失/存在、身份、内容与有效内置值绑定版本并在缓存命中前复查。V1不猜测系统配置安装路径；不能从已授权配置或显式属性确定语义，且未知系统规则会影响当前比较时返回`git_unavailable`，普通文件浏览仍可用，不能假定默认值并给出错误差异。

仅启用 `extensions.worktreeConfig` 不属于 Git 不可用原因。V1 允许当前工作树 `gitDir/config.worktree` 缺失或零字节；原生发现前和后续每次原生 Git 读取前后，复用精确授权、64KiB 上限、不跟随链接的安全描述符门控。非零字节（包括 BOM、空白和注释）、特殊文件、链接或撤权仍使 Git 受限，即使标志为 false 也保守拒绝；本次不扩展完整独立工作树配置解析。linked worktree 检查自己的 `gitDir/config.worktree`，不读取主工作树的 `commonDir/config.worktree`。scope 已打开后创建或填充此文件不得返回旧 Git 内容缓存；这些前后检查继续受上述软件门控的并发边界限制。路径和加载语义依据 [Git config](https://git-scm.com/docs/git-config/2.50.0) 与 [Git worktree](https://git-scm.com/docs/git-worktree#_configuration_file)。

V1只实现受控的内置换行比较，不实现`ident`或`working-tree-encoding`转换。preflight同时检查工作树与cached属性；范围内存在生效的上述转换时返回`git_unavailable`，不对未归一化的磁盘字节宣称精确Git变化。scope打开后属性新增/变更仍须在后续读取和缓存版本复验中检查。此限制保留普通文件浏览；不调用clean/filter、写index/对象或临时实现转码。

桌面存在生效的非标准 `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`、`GIT_CONFIG_PARAMETERS` 或非零 `GIT_CONFIG_COUNT` 等覆盖时，V1直接标Git受限，不读取这些自定义路径，也不默默忽略后宣称差异与原生Git一致。

所有目标双重校验词法与真实路径边界，按路径段判断后代，检查叶节点和祖先身份；禁止 `..`、绝对路径、NUL、跨根 symlink、symlink 祖先替换、Windows ADS/设备命名空间/重解析逃逸。V1 不跟随 symlink，不读 FIFO、socket、设备节点等特殊对象。若沿用网络/UNC 路径，必须同时满足既有网络授权和可终止硬超时，不能绕开网络策略。

Git 用受控 runner 与 argv，不运行客户端字符串。scope 内路径绑定字面 pathspec；允许对象由桌面限定 HEAD/index 并校验类型/大小。严格只读要求：

- 使用 `--no-optional-locks`、`--literal-pathspecs`，关闭 `core.fsmonitor`；diff 明确 `--no-ext-diff --no-textconv`。
- 固定 `GIT_ATTR_NOSYSTEM=1`，关闭未经精确授权的system gitattributes隐式读取；全局attributesFile受限，不将任意全局属性文件接入scope。
- 不写工作区/index、临时 index、对象、refs 或注册表，不跑 hook、shell、PTY，不联网或隐式 lazy-fetch。缺本地对象返回不可读取。
- 工作树比较可能触发 clean/process filter。先用不执行filter的受控属性/配置读取检查范围；需要外部 filter 的文件只给可安全计算的摘要/受限状态，不能执行 filter。该规则覆盖Git发现、status、numstat和diff，不能先跑可能执行filter的概要命令再报受限。隔离Git发现自身的fsmonitor/扩展/隐式网络，并提供使用既有runner的最小受控Git隔离选项，禁止新增任意环境变量或通用shell API。
- blob 比较只读本地受控对象，不用 `cat-file --filters/--textconv/--follow-symlinks`。无 HEAD 用不指定 commit 的 cached diff 空基线语义，不写树对象、不硬编码 SHA-1 空树 OID。
- 高层 `getDiff` 的临时 index 投影、filter 或对象写入不能接到远端只读通道。只抽离复用 runner/路径/解析纯 helper，不复制另一套通用 Git 服务。
- 每个子进程硬超时可终止，并限制 stdout/stderr/候选与后台解析量。Git 版本缺必要隔离能力时拒绝该操作，禁止以扩大权限、执行扩展或联网降级。

依据沿用原设计核对的 [Git options](https://git-scm.com/docs/git/2.45.0)、[status](https://git-scm.com/docs/git-status)、[diff](https://git-scm.com/docs/git-diff)、[attributes](https://git-scm.com/docs/gitattributes)、[cat-file](https://git-scm.com/docs/git-cat-file.html)，全局配置优先级及禁include依据[Git config](https://git-scm.com/docs/git-config/2.45.0)；实现时须验证 runner 能落实这些不变量。

## 7. 资源预算、背压与结果缓存

以下是 V1 初始**硬上限**，不是现有系统数值或吞吐承诺。调整需同步 TS/Swift/服务端边界测试与本文；不能以提高 socket 上限代替有界产生。

| 资源 | V1 上限 / 超限行为 |
| --- | --- |
| 目录/搜索/changes 页 | 最多 100 项、显示数据 64 KiB；最终完整 JSON 信封 UTF-8 最多 128 KiB，超限按完整项减页 |
| 请求/标识字段 | scope/entry/change/版本标识最多120个UTF-16 code unit，cursor最多256；搜索query最多256个UTF-16 code unit且UTF-8最多1KiB；相对显示路径UTF-8最多4KiB、referenceText最多8KiB；TS/Swift按同一计量，超限拒绝/明确受限，不截短目标 |
| 文本/diff 页 | 显示数据最多 64 KiB；最终信封 128 KiB；完整行/结构边界分割 |
| 单文件内联读取/比较 | 每个内容 side 最多 2 MiB；先校验尺寸，有界读取，不全读后裁剪；超限仅摘要/受限状态 |
| 单显示行 | UTF-8 最多 8 KiB，保留长行截断标志 |
| 搜索一个请求 | 2 秒或 20,000 节点先到即停，允许明确游标续查；不跟随 symlink、不读正文 |
| 同一搜索总量 | 全游标链最多100,000个已访问节点、10,000条命中、2MiB保留遍历状态；任一预算到达后truncated、无继续cursor，允许用户缩小查询 |
| 单目录候选 | 20,000 项或候选元数据 2 MiB、2 秒枚举预算先到即停；不能完成稳定排序时返回 limit/truncated |
| Git 子进程 | 单次 5 秒可终止硬超时，stdout 最多 4 MiB、stderr 最多 64 KiB；超限终止，不形成巨型内存字符串 |
| Diff 解析模型 | 最多 20,000 个显示行、序列化模型 4 MiB；生成前检查行数，生成中累计字节，任一超限返回 limit_exceeded。预览只扫描当前页，不构造全文件行数组 |
| 同一手机读取 | 最多 2 个在执行；最多 4 个待执行、排队等待最多 5 秒；前台 preview/diff 优先于 search |
| 桌面全局读取 | 最多 8 个在执行、32 个待执行；控制类 cancel/close 不等在读取队列后 |
| scope 与句柄 | 每手机最多 1 个活动 scope、桌面最多 32；每scope最多20,000 entry/change句柄、32 cursor，全局最多100,000句柄、256 cursor；scope 元数据最多 4 MiB、全局最多 16 MiB，任一上限先到即LRU回收对应 cursor/entry；旧cursor返回cursor_expired，旧entry/change返回content_stale，不按路径猜测恢复 |
| scope / cursor / 请求 | scope 空闲 10 分钟、cursor 空闲 60 秒；手机待答 15 秒结束 loading，取消仍需桌面 TTL/timeout 兜底 |
| iOS 临时缓存 | 当前电脑最多 4 MiB LRU，只内存，含正文/解析模型按预算管理；不落磁盘、不进入 iCloud |
| 桌面文件结果缓存 | 每手机最多64条/2MiB、全局最多256条/16MiB、30秒TTL；包含元数据/正文序列化数据，不进入既有仅条数限制缓存 |
| 控制/取消tombstone | 每手机最多128条、全局最多512条、全局最多1MiB、30秒TTL；只存owner/关联ID/状态，不存路径正文；配额先到优先清已完成过期记录，不能丢在执行open的取消保护，不能保留保护记录时拒绝接纳新open |
| 两跳发送容量 | desktop→server 沿用现有 512 KiB bufferedAmount 边界；server→phone 文件发送采用 512 KiB 边界；发送前必须计入最终完整消息字节 |
| 两跳文件待发队列 | 各连接最多 2 页或 256 KiB，队列存活最多 5 秒；满/过期返回 backpressure，无法发送时手机明确待答超时 |

已核实 desktop→server 入站上限为 256 KiB，phone→server 为 2 MiB；文件下行由前者约束。每一跳都再次计算最终序列化 UTF-8 字节，中文、转义、元数据和 envelope 都计入。128 KiB 页面不能只用原文本长度证明。终端帧与文件页共链路，终端交互与控制优先；文件容量不足不得静默丢页后接后页。WS 与 HTTP fallback 都执行相同数据上限和有界待答，fallback 不把任务转成无限 HTTP 响应。

目录枚举、排序、Git 收集、diff 解析、未跟踪数行受后台预算约束，分页不是先生成完整仓库后切片。相同文件连续点击合并 pending；查询改变取消旧搜索，不无界累积。

Git 元数据安全扫描、工作树指纹与改动收集最多预取 8 条独立路径元数据，每条仍完整检查所有祖先；结果按原顺序处理，不缓存祖先信任、不并行 Git 子进程或文件正文读取。目录枚举前重新完整校验预取身份与祖先，变化时拒绝；子模块 HEAD 读取作为批次末项，完成后才捕获后续路径，避免缓存复验使用等待前的身份。完整 Git 元数据 roots 与节点、字节、2 秒扫描预算保持原样，不将对象检查缩窄到单个目标 OID。改动收集的工作树扫描 2 秒计时仅扣除严格串行基线 Git 读取的实际耗时；磁盘正文、归一化和哈希仍计入该扫描预算。基线读取自身的完整元数据安全扫描 2 秒、原生 Git 子进程 5 秒、文件任务 15 秒总超时与取消仍独立生效；搜索和目录预算不变。

接纳open/读取前预留控制关联记录，不能预留时返回busy；cancel/close原地推进该记录，不分配无界新记录。配额回收不能移除仍执行任务的取消保护，终止失败须如实返回并继续受硬超时约束。

### 7.1 幂等与缓存检查顺序

既有 MobileIntentExecutor 先按 mobile+intentId 命中结果，全网关条数最多 256；workspaceFiles 必须在该路径之前进入独立文件路由与专用检查，正文不原样落入它，也不触发普通executor执行后的requestSummary或重算常驻Git摘要。

1. 从可信连接确认owner、操作形状及请求参数指纹；同owner/intentId不同操作/参数返回request_conflict。指纹按JSON语义计算：对象键递归排序，数组顺序保留，不能把顶层或target字段顺序变化当作参数变化。游标指纹同样遵守此规则，仍绑定原操作、scope/context与目标。
2. 读取/刷新/引用检查session、scope、根/权限和读取版本，即使有正文缓存也不跳过。cancel/close依§5.2验证owner与任务/scope/tombstone而非active读取有效性，使失效后的清理和幂等close可执行。
3. 同 intentId 正在执行时合并到同一任务；同 fingerprint 的缓存页满足有效版本/TTL时重发，否则返回过期状态，由用户使用新 intentId 重试。
4. 完成结果按**字节、TTL和数量**有界记录；close/refresh/版本变化/owner失效立即清相应页。cancel/close可保留不含路径正文的短期完成记录以保证重试 no_op。

请求结果缓存与 iOS 阅读缓存用途不同。手机可以展示已读快照并标过期；桌面不能因结果曾返回过就重放未经当前授权校验的源码。

## 8. 状态机与代码组织

### 8.1 面板及 scope

| 状态 | 事件 | 结果 |
| --- | --- | --- |
| closed | 在线且双端能力支持的用户入口 | opening，创建本地 generation，发送 open |
| opening | 匹配目标/generation 的 open 成功 | ready，保存 scope，再发送默认视图第一页 |
| opening | 拒绝/超时/取消 | failed/closed，明确反馈；迟到 open 仅释放 scope |
| ready | 用户展开/搜索/预览/分页/引用 | 相应局部 loading，保留已有视图与位置 |
| ready/loading | 参数或内容版本变化 | 取消相关任务、增加本地 generation；旧结果不追加 |
| ready/loading | 根或内容过期 | stale，保留旧快照；用户刷新或重新打开 |
| ready/loading | 断线 | offlineSnapshot，保留已看到内容；禁止新读取/引用 |
| offlineSnapshot | 重连 | 保留快照待用户刷新；不自动扫描/重放，不换电脑 |
| 任意非 closed | 关闭、退出、切目标、确认 session 结束 | closing→closed，取消本地任务、发送 cancel/close并清状态；失联由桌面 TTL回收 |

每个局部请求是 idle→loading→ready/empty/partial/unavailable/failed/stale。empty 仅在 complete 且无结果时成立。directory/search/changes 各自保留匹配版本的展开/选择/滚动；只切 tab 不丢草稿或终端连接。引用另有 idle→validating→inserted/rejected 状态，waiting draft generation 不匹配即 rejected，不补偿执行输入。

### 8.2 实施组织约束

- iOS 在现有 `Features/Terminal/` 内建立 Files 模块，按面板、目录/搜索、变更、diff/预览、FilesFlow/Store、纯展示模型拆职责。名称可按工程约定调整，不能宣称文件已存在。
- TerminalScreen 只持 presentation route/来源、当前草稿与插入回调。FilesFlow 管 pending、scope、generation、导航与局部状态。SynapseAppModel 继续唯一身份/目标/intent入口，iPhone/iPad不另建一个 model。
- 后台 actor/任务负责重内容解码后的解析、缓存和展示模型生成；MainActor只更新UI与有界状态。不得在RealtimeClient主线程同步解析大patch，亦不得复制另一套网络客户端。
- 桌面由 ServiceRegistry 注入 mobile 专用只读 adapter、上下文解析与纯 helper。runtime不导入业务；bootstrap仅组装，不导出新单例。复用 IpcRegistry/EventBus/NetworkServiceRegistry，禁止裸 ipcMain/webContents.send/绑定端口。
- 读取服务不持久化业务文件；若有确需持久化的配置仍走 DataRepository。错误显式返回/带上下文抛出，使用结构化 logger，禁止空 catch 和 console.log。

## 9. 自适应呈现、无障碍与反馈

本节固化原设计已核实的 Apple 官方依据，属于 SY 的产品选择，不能据截图断言 Codex 的内部实现。最低 iOS 18，iPhone/iPadOS共用状态。实施时重新核对部署版本和对应 API 可用性。

2026-10-04 用户要求完整重做面板内部 UI。下列组织与颜色规定同步修订，历史验收只代表当时实现；新版设计及35项审查见[重做说明](2026-10-04-mobile-workspace-files-ui-redesign.md)，新界面仍需独立运行验收。

| 场景 | V1 规定与依据 |
| --- | --- |
| 面板 | 系统 sheet，带关闭/刷新、必要 scope label；使用 [.medium,.large] 的有效档位与抓手。上下文内有限任务依据 [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[presentationDetents](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:selection:)) |
| iPhone | 竖屏概要初始 medium；搜索、预览、展开代码进入 large。横屏垂直紧凑按系统适配，只有多个有效档位才显示切档动作；依据 [medium](https://developer.apple.com/documentation/swiftui/presentationdetent/medium)、[presentationCompactAdaptation](https://developer.apple.com/documentation/swiftui/view/presentationcompactadaptation(_:)) |
| 两视图与行 | 普通字号用系统 segmented Picker 直接切换「所有文件 / 已修改」；无障碍字号用可换行的原生Menu内Picker，范围与视图分别成为可滚动的独立行。常规目录上下文紧凑显示根名、范围和独立引用动作。iOS18与26共用原生UITableViewDiffableDataSource；文件和目录共用UIListContentConfiguration，目录保留小展开符号与独立44pt系统菜单按钮，加载/分页、控件与Git行继续UIHostingConfiguration，hosted垂直margin为0避免重复留白。稳定ID及展开态参与快照重配，保留完整名称/路径、懒加载、分页、主操作与朗读；菜单创建及执行校验owner/视图/行与当前权限。regular窗口按当前文件ID保留系统选择背景，compact导航继续短暂选择。依据 [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[Menu](https://developer.apple.com/documentation/swiftui/menu)、[UIListContentConfiguration](https://developer.apple.com/documentation/uikit/uilistcontentconfiguration-swift.struct)、[UIHostingConfiguration](https://developer.apple.com/documentation/swiftui/uihostingconfiguration)。这是依据Apple原则的项目布局，非Apple对具体排列的强制规定。 |
| 搜索与引用 | 列表视口上方使用UISearchTextField及系统搜索图标，清除采用原生UIButton rightView的真实44pt区域，提交使用键盘Search或plain Button；不再外置放大镜和大型bordered搜索按钮。无障碍字号自然增高，提交动作纵排。只在明确提交时执行有界远端搜索，编辑取消及清除/范围/视图重置继续同一Flow；不自动聚焦。根引用保持独立可见动作，目录另有独立菜单。依据 [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields)、[UISearchTextField](https://developer.apple.com/documentation/uikit/uisearchtextfield)、[rightView](https://developer.apple.com/documentation/uikit/uitextfield/rightview)、[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)。完整辅助功能与窗口实测仍是发布验收条件。 |
| iPadOS | 系统 page/form sheet自适应，实际内容空间足够时内部NavigationSplitView列表+详情，窄窗折叠导航栈；按可用空间，不按机型强制两栏。依据 [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)、[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview) |
| 内容与辅助功能 | 等宽字体、Dynamic Type、稳定焦点、键盘/指针、减弱动态；VoiceOver读状态、增删、旧新行号、展开与页完整性。依据 [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)、[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover) |

文件、目录与搜索行使用系统字体、UIListContentConfiguration及默认background configuration的真实状态更新，正文.label、副文.secondaryLabel、图标沿用系统tint；不把.label当背景或.systemBackground当文字。此前反色选中配置在本次用户要求按Apple规范完整重做后被取代，依据[Color](https://developer.apple.com/design/human-interface-guidelines/color)对语义色用途的要求。保留自动字体、无限行、trait外观更新、原生焦点与选中反馈、复用以及唯一主操作；目录主操作及菜单是两个独立辅助功能节点，搜索目录读「在目录中显示」而非展开状态，选中文件朗读.selected。深目录依据当前cell可用宽度调整视觉缩进，完整深度和路径仍保留。不得固定字号、自造颜色或过滤审计；小字至少4.5:1、大字至少3:1继续按[Apple Sufficient Contrast](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria/)验收。过去反色方案的实物证据只代表旧实现，新实现需要独立深浅/触选/焦点/外观切换验收，不能由token或编译成功替代。

新文件面板的columnVisibility初始为.all，打开即显示浏览入口，不沿用系统先前隐藏侧栏的automatic结果；compact折叠栈由系统忽略列可见性偏好。用户之后仍可手动隐藏侧栏。

“在目录中显示”必须恢复实际目录可见性：compact折叠栈使用`preferredCompactColumn = .sidebar`，regular侧栏由独立`columnVisibility`绑定请求显示全部列。不能把清空详情或改变compact偏好视为已显示被用户隐藏的regular侧栏；两种状态使用系统[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)组合初始化器。仍须目标真实表格已进入窗口视口后才消费定位回执，隐藏表格不得先确认。

用户点选文件或更改行时，应激活详情导航，即使返回列表后再次选择同一条缓存内容。不能只依赖selected值变化触发导航；相同selection的缓存复用不等于取消用户的打开意图。导航仍留在Browser/Panel，由当前可读scope中的用户动作发起，不增加第二条UITableView业务主操作，也不能让迟到读取响应把用户已返回的列表强行推回详情。

旋转、窗口伸缩、切tab和文件面板不改变底层终端画布尺寸归属，不新attach/租约/resize，不丢输入草稿、录音、播放和有效选择。既有Drive宽窗refreshable限制不机械复制或撤销；新列表按实际窗口单独验证，不能声称未跑的iPad半窗/窄窗已覆盖。不新增多scene业务实例。

浏览表格按稳定真实行ID保留有限的树/搜索/更改阅读位置，scope context版本改变时清理，更改范围改变时重置更改位置。业务Flow、草稿和导航保留在UIKit行外，hosted body内建立观察依赖；字号由UIKit系统trait向cell及UIHostingConfiguration传递，不以额外的SwiftUI状态重复覆盖。Hosted行的语言、布局方向、外观和禁用环境显式传播；原生文件行遵循UIKit系统字体、外观与方向，并在主操作和菜单各边界校验禁用状态，依据[UIKit系统trait与SwiftUI桥接](https://developer.apple.com/videos/play/wwdc2023/10057/)。系统自动行高配合非零估算，不全量测高或操纵估算中的contentOffset/contentSize，依据[estimatedRowHeight](https://developer.apple.com/documentation/uikit/uitableview/estimatedrowheight)。新搜索结果回起点，清搜索回树保留树身份；定位事件绑定scope/context/generation，由ID解析当前indexPath后[scrollToRow](https://developer.apple.com/documentation/uikit/uitableview/scrolltorow(at:at:animated:))，目标真实行进入视口后一次消费；程序调用不保证scrollViewDidScroll回调，不能只依赖该回调确认。主动选择或离开该定位上下文即失效。inline搜索位于实际表格视口上方，不让文件行被覆盖后仍暴露为可操作内容。字号/角色/窗口转换须实际验证，不能仅凭原生API认定通过。

只采集UIKit已呈现行的真实高度，exact缓存最多512条；普通文件与搜索文件分别取最多7个近期实测样本，供当前字号恢复使用。普通原生文件默认由系统估算；仅在一个明确定位意图中，可一次冻结当前角色的两类有限median。捕获前核当前scope/context、像素宽度、SwiftUI字号、native category、语言、方向与字体可读性均匹配采样布局，且SwiftUI与UIKit字号类别相互一致。按owner/角色/定位generation去重；定位回执不撤销该意图，同一意图不得滚动更新median。估算delegate纯读取冻结值，失配、未捕获或该类别无实测样本时返回automaticDimension，不刷新布局、写缓存、测量cell或操作contentOffset/contentSize。实际布局键变化撤销冻结值；公开[trait-change注册接口](https://developer.apple.com/documentation/uikit/uitraitchangeobservable-67e94/registerfortraitchanges(_:handler:))在每次字号trait变化即撤销冻结与待捕获状态，保留该意图标记，返回旧字号不能使旧估算复活。新意图重新核对当前布局；清理Coordinator时释放全部采样与冻结值。目录、加载、分页和其他动态控件继续采用系统估算。布局回调只采集可见cells，快照同步门槛由update/apply生命周期维护，不在每次滚动复制全部行ID。依据[估计高度delegate](https://developer.apple.com/documentation/uikit/uitableviewdelegate/tableview(_:estimatedheightforrowat:))；冻结median仍是近似估算，不是全表精确高度或cold snapshot稳定证明，不替代实际定位、连续字号和内存验收。此修订接续iPad真实定位后重排及持续更新median引发的字号回归，必须在最终源码重新验证四设备。

字号过渡的采样必须核实际当前布局，不能把旧native bounds归入新字号。Hosted行用[onGeometryChange](https://developer.apple.com/documentation/swiftui/view/ongeometrychange(for:of:action:))传递稳定ID、布局revision、实际字号和本地尺寸，最多保留512份；普通原生文件配置启用系统自动字体调整，独立核当前行/revision及cell/table trait一致，不伪造Hosted DTO或宣称实测了内部字体metric。两者都仅对已显示cell使用有缓存的[systemLayoutSizeFitting](https://developer.apple.com/documentation/uikit/uiview/systemlayoutsizefitting(_:withhorizontalfittingpriority:verticalfittingpriority:))计算完整原生cell尺寸，并与同一cell的实际bounds比较，不把contentView拟合与cell高度混用或加固定补偿。它只证明该cell当前拟合相符，不代表全表后续self-sizing已结束。被动layout只初始化尚无阅读身份的角色，已有身份由真实拖动、显式定位或角色切换更新。字号变化前保留上一有效阅读身份，每epoch最多一次原生位置恢复；普通文件anchor还须当前角色对应类别的新字号实测估算已就绪，不能仅凭动态控件的布局提前恢复。新scope、视图、查询/范围重置、显式定位或用户拖动取消旧恢复。超高行没有完整可见行时，采用实际相交的行身份，不能沿用无关旧文件。此门槛须通过实际连续字号和大集合定位验收，不能仅凭一次布局或完成回调认定稳定。

系统控件自行采用iOS18/26外观，不能为了模仿磨砂自造Liquid Glass或渐变。文案只有标题、必要label/动作和空/错/加载状态。

Files由原生sheet负责模态呈现，保留每个子控件的独立操作和朗读；终端背景仅在Files展示时[accessibilityHidden](https://developer.apple.com/documentation/swiftui/view/accessibilityhidden(_:))，关闭后恢复。采用系统[模态辅助导航语义](https://developer.apple.com/documentation/swiftui/accessibilitytraits/ismodal)，不额外将整页包装成Alert。不能将Files内容隐藏或合并成单个不可操作节点；完整XCUI树仍包含背景或背景不可点按，均不能代替实际VoiceOver焦点验收。

文件请求和引用失败在文件/列表内容就地显示；成功引用以关闭面板和更新草稿完成反馈。文件回执由同一Flow承接，不重复转入NoticeBar；打开面板前的能力/离线拒绝以及其他既有终端反馈沿用原NoticeBar，不为Files另挂overlay或新增第三条通知通道，不遮挡返回/关闭/输入。source/patch/完整路径不进入普通日志、诊断正文、遥测或审计正文；审计记录既有资源身份、授权和结果。云端结果不入summary缓存、数据库、COS或广播。用户以后主动发送的引用仍遵守既有终端诊断脱敏开关，本功能不新建捕获通道。

## 10. 兼容、上线与验收

### 10.1 能力门控与上线顺序

新增可选 `LiveDesktopWelcomePayload.mobileCapabilities.workspaceFilesVersion`（手机握手使用同一welcome形状，服务端提供）和 `MobileSummaryPayload.workspaceFilesVersion`（桌面提供）。V1支持值均为1，缺席/未知值视为不支持。它们只表达能力版本，不携带目录、文件或源码；补充summary预算边界测试。

手机必须同时看到**服务端和当前选中电脑**支持1才发送workspaceFiles kind。旧服务端可能因未知kind关闭连接、旧电脑可能不回答，不能靠HTTP fallback绕过。缺server能力显示「需要更新服务端」，缺desktop能力显示「需要更新电脑端」，已有终端仍可用。字段加法保持旧客户端可忽略；没有版本能力不做探测性文件请求。

上线顺序为服务端→桌面→iOS；WS/HTTP两路共同覆盖。新手机配旧server、旧desktop，旧手机配新server/desktop都必须保留已有终端。性能背压改动不得让常规frame/summary/intent兼容退化。

### 10.2 可验收条件

编号是开发计划与测试映射的稳定标识；每条必须由行为测试、静态约束或标明实际运行环境的验收记录支持。

| AC | 场景与通过条件 |
| --- | --- |
| AC-01 | 三入口按§3.1打开同面板；手机上传不变；Git→文件不叠sheet，可返回Git；不新增底栏/资源URL入口 |
| AC-02 | cwd子目录、普通目录、实际worktree与子模块；两tab始终同根，仓库入口明确scope；cd后不静默换根，刷新报stale；不写仓库注册表 |
| AC-03 | 同路径两层修改、staged-only、无HEAD、未跟踪；选择范围和before/after符合§4.2；两层分开计数，已选范围不自动切换 |
| AC-04 | rename跨scope、删除、冲突、gitlink、类型替换、二进制、大diff；无越界路径，具体受限原因；未知统计非0，file/hunk/页计数不混用 |
| AC-05 | 打开只读一层，展开才读下一层；折叠不扫描；依赖目录可见且折叠；无watcher、全树读取或后台扫描 |
| AC-06 | 文件名/相对路径搜索覆盖scope深层；只提交时遍历，编辑取消；不读正文；2秒/20,000节点到预算停，可继续/截断/完成可区分，未完成空页不称无结果 |
| AC-07 | 删除before、staged index、unstaged disk、空side正确；UTF-8/Markdown有界预览，不执行网页/桌面程序；每页支持状态来自桌面 |
| AC-08 | 文件/目录/root引用；空格、中文、emoji、引号、$、反引号路径；小/大输入共享UTF-16选区，非空选区保留原文、无选区末尾、分隔空白正确；等待中编辑/移动选区/切目标不覆盖；无PTY input/key/回车、自动发送/键盘/租约副作用 |
| AC-09 | 跨账号/desktop/mobile/session/scope伪造与HTTPfallback；握手mobile实例不匹配拒绝；精确根授权，mobile actor及审计有效；不扩大fs.read全盘权限 |
| AC-10 | 路径穿越、前缀同名目录、跨根symlink、祖先替换、FIFO/socket、Windows ADS/设备/重解析；读取和引用都拒绝，网络路径不绕过权限/超时 |
| AC-11 | Git外部diff/textconv/filter/fsmonitor、缺对象、无HEAD、超时；外部程序/联网/工作树或index/对象写入均未发生，不调用高层getDiff投影，无自由命令/ref参数 |
| AC-12 | 目录变动、HEAD/index/文件变动、scope刷新与游标过期；旧页stale，跨参数cursor拒绝，同页幂等，缺页不接后页，统计完整性不虚报 |
| AC-13 | 快速切tab/查询/文件，重复intentId及参数冲突，关闭/取消；取消不误称成功，迟到结果不污染UI/草稿/剪贴板，控制请求不等在读取队列后 |
| AC-14 | 千/万级目录、超大文件、minified长行、JSON转义/多字节边界；产生、解析、候选、进程与序列化全受§7预算，不先全读再裁剪 |
| AC-15 | desktop→server与server→phone慢链路同时测试；bufferedAmount加最终字节、队列/等待有界；文件页完整或明确失败，不静默丢；终端输入/控制优先且不中断 |
| AC-16 | workspaceFiles绕开旧执行前条数缓存；TTL/字节驱逐、owner/权限/版本变化后缓存不可重放，close/refresh清页；iOS仅4MiB内存LRU、不持久化源码 |
| AC-17 | 断网保留带过期状态旧快照、不发读取/引用；重连用户刷新、不自动重放/换电脑；切目标/退出/确认结束清scope，暂缺summary不误判结束，桌面重启/TTL回收 |
| AC-18 | 新手机配旧服务端/桌面、旧手机配新端，WS/HTTP两路；双能力缺席不发送新kind，明确升级状态，终端照常；上线server→desktop→iOS |
| AC-19 | iPhone竖屏medium概要、内容large、横屏系统适配，iOS18/26；关闭/刷新/有效切档动作可用，原终端尺寸/连接/草稿不变化 |
| AC-20 | iPad宽窗/半窗/窄窗及运行时伸缩旋转；按实际空间切列表详情/导航，选项/草稿/连接保持，不第二model，不机械套Drive崩溃结论 |
| AC-21 | 深浅外观、最大Dynamic Type、VoiceOver、键盘/指针、减弱动态；增删/行号/状态/展开/截断可读且焦点稳定，颜色非唯一信息，无新自定义视觉依赖 |
| AC-22 | 就地错误及NoticeBar无第三通道、不遮控件；源码/patch/完整路径不进普通日志/诊断/遥测/审计正文，不进云缓存/数据库/COS/广播 |
| AC-23 | FilesFlow/Store与UI、网络、后台解析分离；统一intent/API；ServiceRegistry注入、runtime业务隔离、窄bridge、结构化错误；不新增依赖或单例，hard constraints通过 |
| AC-24 | 实施完成同步旧Git阶段限制、mobile-runtime-contracts、capability-registry私有例外、MCP/系统Skill/Agent指南核对及用户发布说明；不虚增公开能力数量；专项测试/类型检查通过 |

### 10.3 完成标准

实施按开发计划的依赖顺序：P00基线→P01共享契约；P02云relay、P03安全scope与安全Git发现、P06手机Flow可并行；P03后P04文件读取与P05Git审查可并行；依赖齐备后完成P07界面、P08引用/选区、P09最终组装与跨端验收。P03需要的Git发现隔离必须先落实，不能等到依赖P03的P05才保护根发现。每阶段提供AC映射证据；不可访问真实窗口或平台时记录缺口，不以静态检查冒充运行验收。

必要检查覆盖shared/server/desktop专项测试、desktop typecheck与`check:hard-constraints`、Swift单元测试及上线前必要真机/模拟器验收。本次用户已授权开发、运行验收和验收完成后的完整发版；实际结果必须写入验收记录，不将授权等同于已通过。V1 产品变化同步到 `RELEASE_NOTES_PENDING.md`。
