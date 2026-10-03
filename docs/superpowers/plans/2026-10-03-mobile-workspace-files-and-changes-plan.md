# iOS 工作区文件与文件变化开发计划

日期：2026-10-03

状态：开始实施。用户已授权按本计划开发、多代理检查、跨端功能与 Apple 界面验收，并在全部工作完成后执行完整发版；此状态不表示开发或验收已通过。

权威规格：[V1 spec](../specs/2026-10-03-mobile-workspace-files-and-changes-spec.md)。截图与现状依据：[原设计分析](../specs/2026-10-03-mobile-workspace-files-and-changes-design.md)。范围、协议、预算与 AC 均以 spec 为准；本文回答改哪里、依赖什么、怎样验证。

## 1. 交付范围与执行约束

交付现有终端里的「工作区文件」：三入口、已修改/所有文件、目录懒加载、提交式文件名搜索、只读文本/Markdown 与 Git 差异、文件/目录引用插入草稿。首期没有原生 Agent 本轮卡片、文件写入、文件级暂存、远程撤销或冲突处理。

- 改动前重新读取根 `AGENTS.md`、`docs/agents/execution-rules.md`、`repository-guide.md`、`mobile-runtime-contracts.md`；按涉及模块补读 API、测试、模块边界与安全规则。
- iOS UI 实施使用 `.agents/skills/apple-design/SKILL.md`，按任务核对 Apple 官方原文；使用系统组件、现有 Theme 和集中语义 token，不复制截图颜色或新建装饰样式。
- 全部特权读取由桌面完成，手机与云端不执行 Git、不持久化源码。每次读取从手机用户操作发起；无后台仓库扫描或新 watcher。
- 不新增依赖，不重构相邻功能；复用路径/解析/受控执行器，不调用会创建临时 index 的高层 Git diff。常量沿用 shared 的 CJS/ESM 单一来源模式。
- 每票通过必要验证后只提交该票代码、测试及同步文档，中文提交信息，不 push；暂存区不得包含其他任务改动。
- 本次用户已授权为整体验收启动所需服务和 App、运行测试，并在全部工作完成后执行生产部署、CI 与 Release。实际执行仍须记录结果；不得用跳过或编译通过冒充运行验收，不执行无关启动或部署。

## 2. 任务、依赖与验收映射

| 任务 | 产物 | 前置依赖 | 主要 spec AC |
| --- | --- | --- | --- |
| P00 | 基线、接点与范围复核 | 无 | AC-23、24 |
| P01 | TS/Swift 线协议、预算、能力协商 fixtures | P00 | AC-12、14、18 |
| P02 | 云端可信路由、结果归属与背压 | P01 | AC-09、13、15、18、22 |
| P03 | 桌面 scope、精确读权限与生命周期 | P01 | AC-02、09、10、11、12、13、14、16、17、23 |
| P04 | 目录、搜索、磁盘文本预览 | P03 | AC-05、06、07、10、12、14 |
| P05 | Git 分层概要、diff 与基线预览 | P03 | AC-03、04、07、11、12、14 |
| P06 | iOS 文件请求客户端、Flow/Store 与缓存 | P01 | AC-12、13、14、16、17、18、22、23 |
| P07 | 三入口、统一面板与内容视图 | P04、P05、P06 | AC-01、05、06、07、19、20、21、22 |
| P08 | 引用 formatter、草稿选区与原子插入 | P03、P06、P07 | AC-08、10、13、21、23 |
| P09 | 网关组装、跨端回归、规则与发布准备 | P02、P04、P05、P07、P08 | 全部 AC，重点 AC-15、18、24 |

P01 冻结后，P02、P03、P06 可并行；P03 后，P04 与 P05 可并行。Swift 协议字段由 P01 维护，P06 只做消费与状态；P04/P05 只实现各自适配器，网关装配在 P09 汇总，避免多人同时修改同一大文件。P07 可以按冻结 fixtures 开发，但联调和完成仍需真实后端。

开发完成顺序与生产上线顺序是两件事。生产上线必须 **服务端 → 桌面端 → iOS**；服务端/桌面能力门控缺失时，新手机不得试发未知 kind。

## 3. P00：开工基线与接点

- [ ] 核对工作区、分支与未提交改动；确定本任务文件边界。
- [ ] 重读 spec，逐条检查 `workspaceFiles`、能力门控、owner、各操作与 AC；后续变更先同步 spec，再修改实现。
- [ ] 确认当前 cwd 探测已存在，不重做旧计划里的 OSC 7 注入与进程探测。
- [ ] 核对两处现有性能陷阱：桌面文件树打开即 watcher/整目录枚举；executor 的全局 256 条结果缓存先命中再执行，不能装文件正文。
- [ ] 保存 capability registry 当前表格/数量作为比较基线，不抄历史 Terminal MCP 数量；本功能不增加公开 MCP、System App、Workflow 或 Deep Link。
- [ ] 跑 shared typecheck、desktop hard constraints 基线；发现既有失败记录原因，不能为本任务放宽断言。

真实接点：`shared/src/mobile-live.ts`；`desktop/electron/services/mobile-gateway-service.ts`；`desktop/electron/services/mobile-gateway/intent-executor.ts`；`desktop/app-capabilities/terminal/main/service.ts`；`SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`；`Features/Terminal/TerminalScreen.swift`。

完成：接点、基线及环境限制有记录，不启动应用、不创建仓库登记项。

## 4. P01：协议与兼容契约

修改范围：

- `shared/src/mobile-live.ts`、`mobile-live-constants.cjs`、`live.ts`、`index.ts`。
- `shared/src/mobile-live.test.ts`、`live.test.ts`、`package-entrypoint.test.ts`。
- `SynapseMobile/SynapseMobile/Core/Protocol/LiveProtocol.swift`；拟新增 Files 协议解码专项测试与 TS/Swift 对照 fixtures。

工作：

1. 实现 spec 的 `kind=workspaceFiles` 与 operation 联合、`filesVersion=1`、严格输入/结果校验；保留 `v=1`、`intentId` 与已有结果 envelope。
2. 定义 welcome 的云端能力与 summary 的桌面能力两个可选字段，缺席为不支持；冻结新文件回执携带的桌面上下文，不能假设旧回执已有 desktop。
3. 定义 scope/entry/change/cursor、before/after 预览目标、版本回显、取消/关闭状态及稳定错误；不接受根路径、revision/OID、任意命令或任意 env。
4. 分开定义集合、统计、正文完整性；未知计数为 null，不得用 0 或空页表示未计算/截断。
5. 将 spec 的硬预算集中到 `mobile-live-constants.cjs` 并由 TS 重导出，补 CJS/ESM 一致性与最终 UTF-8 信封预算测试，不改旧终端帧预算。
6. fixtures 覆盖旧字段缺席、合法各操作、互斥目标、额外越权字段、中文/转义字符边界、超限、不认识的 filesVersion。

完成：TS 与 Swift 使用同一套语义；协议字段与 AC-12/14/18 能被测试逐条检验，尚未发布桌面可用能力。

验证：shared 专项 test/typecheck；Swift `build-for-testing`。运行 Swift 测试条件见 §13。

## 5. P02：云端可信路由与两跳中的手机侧背压

修改范围：`server/src/mobile-live/mobile-live.gateway.ts`、`mobile-live-relay.service.ts`、`mobile-live.controller.ts`、`mobile-live.types.ts`；`server/src/live/live-desktop.gateway.ts`；对应四个现有 `.spec.ts`。

工作：

1. welcome 声明云端支持版本；WS 与 HTTP fallback 使用同一新操作校验及页预算。
2. WS 请求的 mobile 身份必须等于握手绑定连接；HTTP 使用可验证的认证手机归属，不信任 body 自称 user/mobile。按登录账号校验目标 desktop。
3. 文件 pending/回执按可信账号、手机、桌面与 intentId 关联，校验回执来源是当前桌面连接；保留原有 intent 行为和终端回归。
4. 新文件结果只送请求手机，不广播；正文不进入 summary 缓存、数据库、COS 或日志。
5. server → phone 对最终消息检查 bufferedAmount 加 payload bytes；执行 spec 的队列/缓冲/超时预算。超载返回可重试状态或使该次待答明确超时，不能漏页仍报告成功。
6. 取消/关闭可越过读取队列，不排在被取消请求后；断线与退出释放该 owner 的 pending。

测试：同 intentId 不同 owner/desktop、冒用 mobile、错源回执、重复/晚到回执、HTTP 与 WS 归属一致、慢手机、中文超限、旧手机/旧桌面仍可连接、日志假 canary 不含源码。

完成：模拟桌面/手机的服务级测试证明认证路由、预算、隔离和旧端兼容；不需要起真实服务验证这些条件。

## 6. P03：桌面只读 scope、权限与取消

修改范围：`desktop/electron/services/mobile-gateway/controller.ts`、`mobile-gateway-service.ts`、`mobile-gateway/intent-executor.ts`、`mobile-gateway/transport.ts`、`live-connection-service.ts`、`git-client/git-command-runner.ts`；拟新增 mobile 文件 scope/service 及专项测试。ServiceRegistry 组装最终由 P09 接入 `bootstrap/descriptors.ts` 与 `registry.ts`。

工作：

1. 从可信已认证连接注入 account/desktop/mobile/session owner；不把 `user:renderer` 或 Electron sender.id 用于手机。
2. 将安全 Git discover 与受控执行器的只读隔离最小扩展放在本票：限定 argv/env 名称和值，复用 abortSignal/timeout/maxBuffer，核对强制终止保障，不暴露通用命令/env。`currentDirectory` 以实时 cwd 建根；`repository` 通过该隔离路径发现实际 worktree root 并单独授权；两个 tab 同根，子树计数只含根内路径。P05 复用此底座。
3. 注册精确 scope 的只读权限策略；不将整盘 `fs.read.outside-userdata` 加入无条件 allowlist。Git 派生读取另外绑定并授权安全发现的精确 gitDir/commonDir 元数据资源，兼容 cwd 子目录与 worktree 根外元数据；返回路径/blob 仍限当前 scope，alternate 对象目录不得绕过授权。所有读取/引用准备经 PermissionGuard、AuditSink。
4. 词法与 realpath 双边界、祖先/叶节点身份、特殊对象与跨根 symlink、Windows ADS/设备命名空间/重解析点、UNC 既有网络授权均执行 fail-closed。
5. 实现 spec 的 scope 状态、refresh、各版本及句柄/游标绑定；cwd/root 变化不得 silently retarget，变根重新 open。
6. 独立文件路由绕开原 executor 的正文缓存与读取后 requestSummary；不因文件读取重算常驻 Git 摘要。
7. cancel/close 幂等，复用 AbortSignal；清理账号/电脑/session/scope 对应读取、游标、缓存。open 尚未返回 scopeId 时按可信 owner/session/targetIntentId 取消；用有界任务记录和 tombstone 处理迟到创建 scope 与重复关闭。清理不依赖已失效的读 context，控制操作不占读取并发；释放失败及竞态如实返回。
8. 独立字节/TTL 缓存与全局资源配额，缓存命中仍验证 owner/scope/version；失效不得重放旧正文。

测试：权限拒绝、跨 owner、伪造句柄、cwd 改变、父目录替换、scope 到期、opening 取消、重复关闭、会话结束后清理、迟到创建 scope、缓存回放及配额耗尽。用 canary 证明发现阶段不运行 Git 扩展，明确验证零新增 watcher、零 PTY 写入/租约/resize。

完成：scope/security 独立测试可绿；adapter 尚未接入时不广播 filesV1 可用能力，不用假成功占位。

## 7. P04：目录、搜索与磁盘预览

修改范围：拟新增 desktop mobile 文件读取适配器；最小复用 `workspace-file-tree-service.ts`、`workspace-file-tree-schema.ts` 中纯路径/目录规则。不得直接用现有 Electron owner 与 watcher 模式。

工作：

- 一次只枚举一层；目录优先、名称排序；候选总量与耗时按 spec 限制，稳定游标绑定版本，不先加载整树。
- 搜索是用户提交后在冻结 scope 子树中查文件名/路径；采用有界分批遍历，明确继续游标、搜索完成或截断，不把局部无命中当全集为空。
- `node_modules` 可见但不预读；沿用 `.git` 等排除规则，不跟随链接或特殊文件。
- 磁盘预览先验证普通文件身份、类型/大小，以有界分块读取 UTF-8；完整行与多字节边界分页，超长行/文件、无效编码、二进制分别返回状态。
- 页读取前后校验版本；内容变动拒绝拼接。Markdown 传有界文本，移动端使用已有安全渲染，不启动网页执行环境。
- 每页同时约束 item 数、显示字节与最终 JSON 信封；后台处理与取消，不扩大 spec 预算来掩盖超限。

测试：10,000+ 条目目录、依赖目录、跨层命中、有限扫描无命中、中文/emoji/控制字符名、CRLF/无末尾换行、8 KiB 长行、2 MiB 文件边界、扫描中删除/改名、页间变化及超时取消。

完成：AC-05/06/07 的纯文件路径可通过假 owner 的服务级 tests 验证；无持久源码、递归 watcher 或主进程全量同步读取。

## 8. P05：Git 概要、差异与比较侧预览

修改范围：`desktop/electron/services/git-command.ts`、`git-client/git-command-runner.ts`、`git-status-parser.ts`、`terminal-git/terminal-git-status.ts`；拟新增 mobile 专用 Git 只读适配器与真实临时 Git 仓库专项测试。

工作：

1. 复用 P03 的受控 Git runner 与安全 discover，补齐比较/对象读取所需的窄隔离选项；保持 argv/env 受限及终止保障，不暴露通用命令/env 执行入口。
2. status/numstat/diff/cat-file 全链路执行只读隔离。预检外部 clean/process 属性与配置；不等到 diff 才发现可执行扩展。缺本地对象不 lazy-fetch；能力不足返回 unsupported。
3. 不调用现有 `getDiff`/`withGitChangeProjection`；不写临时 index、对象或工作区，不跑 hook、external diff、textconv、filter。
4. 明确未暂存 index→disk，已暂存 HEAD→index；无 HEAD 使用只读空基线语义。新文件空基线、删除 before、暂存后再修改、rename、gitlink、冲突与二进制分别处理。
5. rename 两端同根才返回完整比较；一端越界投影为根内新增/删除，不泄露或读根外 blob。
6. 首屏只传文件 metadata；增删统计完整性按 spec 实现，未知为 null，不为所有未跟踪文件读全文计数。
7. 点文件取结构化 hunks/lines；preview 接 changeId + before/after，由服务绑定 HEAD/index/disk 和对象身份，手机无 revision/OID 自由度。
8. 记录 HEAD/index/工作树版本、页间一致性、输出/CPU/并发预算，不因一个巨型 Git 仓库阻塞终端输入。

测试：真实临时 repo/worktree/submodule、unborn HEAD、staged-only、两层同时改、删除、rename 跨根、类型替换、二进制、冲突、CRLF、缺对象。外部 hook/filter/textconv 使用假 canary 验证**没有执行**；前后目录/index/object 状态验证只读，不只 mock 返回值。

完成：AC-03/04/07/11/12；命令隔离、统计与正文分页有独立证据，不用桌面 Git UI 冒烟替代。

## 9. P06：iOS 请求客户端与 FilesFlow/Store

修改范围：`SynapseMobile/SynapseMobile/Core/Realtime/RealtimeClient.swift`、`Core/Networking/APIClient.swift`、`App/SynapseAppModel.swift`；拟新增 `Features/Terminal/Files/` 客户端、Flow/Store、后台解析 actor 与测试。

工作：

- 复用统一 intent 发送漏斗，新增窄文件请求 facade；不在视图散落网络请求，不把文件状态全部塞入 AppModel。
- 保留并校验回执的可信 desktop/mobile/context，pending 不仅按 intentId 盲匹配；TS/Swift fixtures 按 P01 对齐。
- 两端能力均支持才发新 kind；切电脑/账号清旧能力，缺席是 unsupported，禁止未知 kind 探测与自动 HTTP 绕过。
- 明确 loading/loaded/empty/error/stale/offline 状态、用户刷新、cancel/close、scope generation 与迟到结果丢弃；离线保留旧快照，不重放操作/自动切电脑。
- 符合 spec 的读取并发、缓存字节/TTL/LRU、版本失效；正文与 patch 不持久化、不进入诊断输入捕获。
- RealtimeClient 仍是 MainActor 边界；大数据解码/解析在后台，主线程只接有界展示模型。

测试：假 transport 验证能力门控、同 ID 错桌面、错版本、重复/乱序页、scope 关闭、取消、超时、切账号/电脑/session、返回前后台、缓存驱逐、未计算统计与错误文案归属。

完成：Flow/Store 可用冻结 fixtures 与假 transport 验证，不依赖真实桌面或服务器；hosted Swift 测试仍遵守 §13 的运行条件。

## 10. P07：统一面板、入口与内容

修改范围：`Features/Terminal/TerminalScreen.swift`、`Git/TerminalGitPanel.swift`、必要的 `TerminalGitFlow.swift` / `TerminalGitPresentation.swift`；拟新增 `Features/Terminal/Files/` 呈现与内容视图；复用 `DesignSystem/Theme.swift`、`MarkdownContent.swift`、NoticeBar。

工作：

1. 接「⋯ → 工作区文件」「Git 改动行 → 查看仓库更改」「＋ → 工作区文件」；保持手机上传的「＋ → 文件」行为及底栏不变。
2. 统一 presentation route；Git sheet 先退出再开文件，记住来源；文件内容在同面板内导航/展开，不叠 sheet。
3. 范围行说明当前目录/仓库根；两个 tab 同根，Git 两层范围可选；非 Git、加载、空、失败/过期状态按 spec 显示。
4. 所有文件按展开加载；搜索提交、续查及定位；已修改按文件展开 hunks，目录消歧义、数字对齐，正文与统计完整性清楚。
5. iPhone 有效 detent、横屏 compact-height 自适应；iPad 宽窗口列表/详情、窄窗口折叠；保持同一 AppModel/选择/草稿，覆盖面板不改变底层终端网格。
6. 等宽 Dynamic Type、换行与行号、VoiceOver 增删语义与焦点、44pt 触控目标、键盘/指针、减弱动态效果；系统语义 token，无自定义颜色/嵌套卡片。
7. 首期先用有界 SwiftUI 行；只有性能证据要求时才补 UIKit 虚拟化，不能直接用 ANSI 终端渲染 diff。

测试：入口路由/presentation 纯状态测试、视图模型 tests、已有 TerminalGit/Resources/Relay 回归；Swift 编译。运行 UI 的验收另按 §13 授权条件执行。

完成：AC-01/19/20/21/22 的源码与状态验证完成；iPad 实际窄窗和无障碍运行证据未取得前保持待验收。

## 11. P08：桌面引用与手机草稿插入

修改范围：`desktop/app-capabilities/terminal/renderer/terminal-workspace-view.tsx` 的路径 formatter；拟提取 terminal shared 纯 helper（具体命名实现时确认）；P03 文件 service 的 reference；`TerminalScreen.swift`、`TerminalExpandedInputSheet.swift` 与拟新增 Files 草稿插入纯模型。

工作：

1. 抽离现有 formatter，主进程与 renderer 复用；保留原拖入多路径、PowerShell/CMD 回归，不让 main import renderer。
2. 桌面 reference 再验证 target/owner/scope 与普通文件/目录，返回桌面生成的绝对引用文本；控制字符拒绝，不可安全转义的平台返回 unsupported。
3. 现有 TextField/TextEditor **没有共享 selection**：补最小草稿 generation、选区、编辑位置与快照机制，不假定已存在光标 API。小输入和大输入继续共用草稿。
4. 发送 reference 时捕获账号/电脑/session/scope、draft generation/选区 ticket；结果与 ticket 原子比较成功后才插入。期间编辑/关闭/切目标拒绝旧结果。
5. 依 spec 的选区与分隔空白规则插入；中文/emoji 选区不切断字符，无有效光标按规定落到末尾，保留所有原草稿正文。显示文字输入模式而不改持久语音偏好、不弹键盘。
6. 插入只改变本地草稿，关闭面板；不调用 input/key/paste/回车、云盘上传或桌面默认应用打开。

测试：文件/目录、空草稿/有选区/末尾、多字节与组合字符、引用前后空白、特殊 shell 路径、平台 unsupported、等待中编辑/切电脑/关闭、文件被删/换链接。对 transport/PTY spy 断言零写入。

完成：AC-08，以及现有上传入口/终端路径拖入行为无回归；formatter/helper 不新增公开能力。

## 12. P09：跨端组装、回归与文档收尾

修改范围：`desktop/electron/bootstrap/descriptors.ts`、`registry.ts`、mobile 网关/transport 的最终组装；`desktop/electron/services/live-connection-service.ts` 的文件可靠发送；相关 TS/Swift 专项测试及规则文档。

工作：

- ServiceRegistry 注入 scope、文件/Git/reference adapter；只有完整实现并通过契约验证后才声明桌面 filesV1。
- desktop → server 与 server → phone 两跳统一执行 spec 背压，最终字节进入判定；终端交互优先、有界排队，失败/超时可重试，无文件漏页假成功。
- 验证旧端缺能力不发新 kind、新服务端接受旧客户端、兼容错误不造成设备随机离线；WS 与 HTTP fallback 的身份、超时和清理一致。
- 建专用只读 Files 夹具/测试：不要复用会 checkout/discard 的 Git UI 真仓库用例做自动普通测试。不在用户仓库里造 destructive 场景。
- 基准覆盖千/万级目录、依赖目录、巨型 Git 输出、慢链路、超限、多 scope 与并发；记录峰值字节/队列、超时、终端响应与主线程工作，调整预算需同步 spec 与边界 tests，不能直接扩大上限。
- 更新旧 Git design 的决策六、§6、§7 第6项及验收40；旧 plan 的不下发约束与相关代码注释同步。新 spec 只接续只读文件范围。
- 同步 `docs/agents/mobile-runtime-contracts.md`、`module-boundaries.md`、`capability-registry.md` 的私有移动例外、`SynapseMobile/README.md`；核对 MCP schema/系统 Skill/Agent 指南，计数与公共表面保持真实。
- 用户可感知功能在实现任务中更新 `RELEASE_NOTES_PENDING.md`；本次文档规划不虚记已经上线。
- 新 worker、运行资源或打包边界若确需变化，补 `check:packaged-asar` 和正式产物检查；没有这些变化不扩展打包任务。
- 对 AC-01～24 填入验证结果/证据；未跑 hosted/UI/真机窗口验收明确留待验收，不勾选全部完成。

完成：所有自动源码/协议/服务级检查通过，运行验收得到对应授权与证据，规则及发布说明一致。发版/部署只有后续明确请求才执行，上线顺序不得倒置。

## 13. 验证命令与运行边界

以下是实现阶段已核实的现有命令，均从仓库根执行；**本次文档转换不运行这些构建或测试**。新增测试文件应加入相应专项列表，名称以实际落地文件为准。

### 13.1 无需启动应用的 TypeScript 验证

```bash
pnpm --filter @synapse/shared run test src/mobile-live.test.ts src/live.test.ts src/package-entrypoint.test.ts
pnpm --filter @synapse/shared run typecheck

pnpm --filter @synapse/server run test src/mobile-live/mobile-live-relay.service.spec.ts src/mobile-live/mobile-live.gateway.spec.ts src/mobile-live/mobile-live.controller.spec.ts src/live/live-desktop.gateway.spec.ts
pnpm --filter @synapse/server run typecheck

pnpm --filter @synapse/desktop run test electron/services/__tests__/mobile-gateway-service.test.ts electron/services/__tests__/mobile-gateway-permissions.test.ts electron/services/__tests__/live-connection-service.test.ts electron/services/__tests__/workspace-file-tree-service.test.ts electron/services/__tests__/git-command.test.ts electron/services/git-client/__tests__/git-command-runner.test.ts electron/services/git-client/__tests__/git-status-parser.test.ts electron/services/terminal-git/__tests__/terminal-git-service.test.ts electron/bootstrap/__tests__/descriptors.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

路径 formatter 提取涉及 renderer 时，把 `app-capabilities/terminal/renderer/__tests__/terminal-module.test.tsx` 与新增 helper 专项测试单独运行，遵守主进程与 renderer tests 分开执行。typecheck 会生成配置/注册表文件，提交前确认 diff 没有夹带无关生成结果。

### 13.2 Swift 静态编译

```bash
xcodebuild build-for-testing \
  -project SynapseMobile/SynapseMobile.xcodeproj \
  -scheme SynapseMobile \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/synapse-mobile-workspace-files-build \
  CODE_SIGNING_ALLOWED=NO
```

此命令编译 App 与测试目标，不安装或运行 App。编译通过只证明编译，不证明单测/交互通过。

### 13.3 需要启动授权的 Swift/跨端验收

现有 `SynapseMobileTests` 为 hosted tests，`xcodebuild test` 会运行模拟器和宿主 App。只有用户明确要求此类运行后，才执行以下命令；先核对本机可用 destination，`iPhone 17 Pro` 是现有 README 示例，不假定一定安装。

```bash
xcodebuild test \
  -project SynapseMobile/SynapseMobile.xcodeproj \
  -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests/TerminalGitStatusTests \
  -only-testing:SynapseMobileTests/TerminalGitFlowTests \
  -only-testing:SynapseMobileTests/TerminalGitPresentationTests \
  -parallel-testing-enabled NO
```

新增 Files/draft 专项 suite 加入实际 `-only-testing` 列表；UI tests 分开执行，不把有 `XCTSkip` 或环境闸门的测试计为通过。需要真实服务时，按范围使用根 `pnpm dev:server` / `pnpm dev:desktop`，不猜内部启动脚本；不启动无关文档站。

运行矩阵需记录 iPhone 竖横屏、iPad 宽窗/半窗/窄窗转场、iOS 18/26、深浅色、大字体、VoiceOver、键盘/指针与减弱动态效果。现有 Simulator/XCUITest 不能证明 iPadOS 实际缩放窗口的 regular→compact 转场，需对应真实窗口证据。

## 14. 最终交付检查

- [ ] 三入口、同根浏览、两层 Git、预览、搜索、引用与所有异常状态满足 spec，未加入非目标。
- [ ] 新文件协议、云/桌面双能力门控、可信 owner/回执、两跳背压完整，旧终端行为回归通过。
- [ ] 只读路径无 watcher/外部 Git 扩展/对象或 index 写入；跨根路径与跨身份拒绝。
- [ ] 正文、候选、游标、缓存、队列均执行 spec 数量/字节/时间上限，过期页不可重放。
- [ ] 草稿按 ticket 插入，无 PTY/回车副作用，无目标切换污染；终端尺寸和连接不受浏览影响。
- [ ] 自动验证与获授权的运行验收分别记录，全部 AC 有可核查结果。
- [ ] 规则、旧阶段范围、注册例外与发布说明同步；聚焦 diff 通过检查并完成本地 Git 提交。
