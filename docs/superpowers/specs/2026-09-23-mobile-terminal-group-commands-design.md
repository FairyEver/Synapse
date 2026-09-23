# 手机端终端 · 分组快捷命令 · 产品设计文档

> 状态：**待评审。**
> 上游文档：`docs/superpowers/specs/2026-09-17-mobile-claude-code-conversation-design.md` —— 它的 §7
> 把本功能显式列为「这次不做、将来一并收口」，理由是「协议里已有 `launchCommand`，但手机端既没有
> 界面也拿不到命令列表，一直是死路」。本文档就是去收这条死路。
> 界面原型：本轮**未做** HTML 原型。交互只有「一层分组列表 + 一层命令子列表」，形态以 §3.1 的
> ASCII 草图为准。
> 界面代码：`SynapseMobile/SynapseMobile/Features/Sessions/NewSessionSheet.swift`

---

## 1. 背景

### 1.1 桌面端早就有「分组快捷命令」

终端分组可以保存若干条启动命令，每条一个名字 + 一段命令正文，属于终端能力自己的数据：

- 形状：`terminalGroupSchema.settings.commands`（`desktop/app-capabilities/terminal/shared/schema.ts:161-206`），
  名字上限 80、正文上限 64 KiB，**没有条数上限**，顺序就是用户创建的顺序。
- 正文单独存：`terminalCommandBodyRecordSchema.body`（`shared/contract-schema.ts:214-221`），落在加密库
  `app.terminal.command-bodies`；命令还可以挂自己的环境变量。
- 桌面自己的界面：分组行上的「以命令启动」下拉，每条命令一行、只显示名字，下面是「管理命令」
  （`desktop/app-capabilities/terminal/renderer/index.tsx:1483-1507`）。
- 启动：`terminal.launchGroupCommand({groupId, commandId})`（`main/service.ts:2099-2130`），建一个该分组的终端
  并把命令逐行写进 PTY。

### 1.2 手机上是一条铺好却没人走的死路

协议侧早就通到底了：

| 环节 | 位置 | 状态 |
|---|---|---|
| 意图 `launchCommand` | `shared/src/mobile-live.ts:956`、校验 1444-1445 | 已有 |
| 出站字段 `groupId` / `commandId` | Swift `Core/Protocol/LiveProtocol.swift:845-846` | 已有 |
| 手机端可调用的封装 | `App/SynapseAppModel.swift:1579-1588` | 已有，**但全仓库零个调用点** |
| 桌面端执行 | `desktop/electron/services/mobile-gateway/intent-executor.ts:612-620` | 已有，含权限点 `terminal.command.launch` |
| **命令列表下发** | —— | **缺这一环** |

所以缺的只有一件事：**手机拿不到命令列表**。手机对分组唯一的认知是 `MobileSummaryGroup { id, name }`
（`shared/src/mobile-live.ts:464`、Swift `LiveProtocol.swift:142`）。

### 1.3 界面现状

`NewSessionSheet.swift:334-368` 的「终端分组」段：点一行 → `Haptics.commit()` → `dismiss()` →
`onCreated(group.id)` → `App/SynapseAppModel.swift:1500` 的 `createSession`。**点一下就建终端，没有第二步**，
这是上一轮 §3.5 明确保留的行为。

---

## 2. 约束：摘要装不下

第一版方案是把命令并进 `mobile.summary`（照上游文档 §5.2 的先例）。**算过之后否掉了。**

- `maxSummaryBytes` = 248 KiB = 253,952 字节（`shared/src/mobile-live-constants.cjs`），它是个**正确性常量**
  而不是调参旋钮：它自己的注释写明「an oversized one is not a truncated view but a dead socket」——摘要
  是手机无法重组的那条消息，超限时 `ws` 层关连接，用户看到的是「电脑离线」。
- 「最宽可行的摘要」（256 会话 + 128 分组 + 32 项目 + 12 供应商，`shared/src/mobile-live.test.ts:513` 那条
  边界测试钉住的那个）实测 **250,999 字节 = 245.1 KiB**。
- **余量 = 2,888 字节 ≈ 2.88 KiB**。一条命令行（id 48 + name 80 + JSON 开销）约 152 字节 —— 全账号只
  放得下约 **19 条**命令，多到没有意义。
- 抬预算也抬不动：摘要 248 KiB，而桌面 hop 的套接字 `maxPayload` 只有 256 KiB
  （`server/src/live/live-desktop.gateway.ts`），中间剩 4 KiB 给信封；那个常量自己写着「the desktop hop is
  the binding one，要抬先抬它」。抬它就变成一次**按顺序部署的套接字常量变更**。

结论：摘要不是这条数据的载体，**别把它塞进一条每条手机每秒都要收一遍的消息里**。

---

## 3. 决策

### 3.1 形态

**分组行**

| 分组 | 行右侧 | 点击 |
|---|---|---|
| 有命令 | `chevron.forward` | push 进命令列表 |
| 没有 | 无箭头 | **与今天逐像素一致**：`Haptics.commit()` → 关面板 → 建终端 |

箭头只在有命令的行上，和 `SessionListView.swift:263` 那条「the chevron and the tap target appear exactly
when they mean」是同一条口径：箭头的含义是「后面还有东西」，没有东西就不画。

**命令列表**（同一个 `NavigationStack` 里 push）

```
‹ 项目:Syntax
─────────────────────
Claude
Codex
小慧日报
─────────────────────
直接新建终端
```

- 标题用**分组名**，不用「命令」：这一屏要回答的是「建在哪个分组里」，标题丢了这条信息就会有人建错地方。
- 命令段：每条命令一行，**只有名字**（§3.7），顺序照电脑上的顺序（电脑上就是创建顺序，没有排序字段）。
- 底部单独一段一行 **「直接新建终端」**：不带 `commandId`，走的就是今天那条 `create` 路径。
- 不加搜索框（命令是几条量级），不加「管理命令」（手机只读）。
- 两处点击都是 `Haptics.commit()` → 关面板 → 回调；命令列表不是确认页，点了就走。

### 3.2 载体：独立消息族，照 `mobile.toolbar`

仓库里已经有三个同一形状的先例：`mobile.toolbar`、`mobile.quickPhrases`、`mobile.clipboard` —— 都是
「电脑提供给手机的一份列表」，各有自己的消息类型、自己的字节预算、自己的校验。分组命令和工具栏按钮
**本来就是同一类东西**，走同一条路：

- `mobileToolbar` 的 payload 就是「电脑的启动命令列表」，它自己的注释（`mobile-gateway/transport.ts:79-84`）
  写明了独立成消息的理由：「the two come from two different desktop apps and change on two different events,
  and — the part that matters to a phone — "this computer has no phrases" and "this computer has never heard of
  phrases" have to stay tellable apart. A list riding on the toolbar could only ever say the first.」
  分组命令的理由一模一样。
- 好处：**摘要预算不动、套接字 `maxPayload` 不动**（那两个是跨端按顺序部署的东西），刷新又是一秒内的。
- 代价：新消息族该有的全套管线（§3.3–§3.6），比「加一个可选字段」大一档。这是明知而为。

**被否掉的方案**：并进 `mobile.summary`（§2 的算术）。**另一个被否掉的**：新增一条手机主动拉取的意图
（手机上出现加载态、失败态，而数据本来就在电脑手里）。

### 3.3 协议

新增消息族 `mobile.groupCommands`（`shared/src/live.ts` 的 `LIVE_MESSAGE_TYPES`，在 `mobileToolbar` 附近）。

```ts
/** 一个分组保存的启动命令，手机只用来画一行、并把 commandId 发回去。 */
export interface MobileGroupCommand {
  readonly id: string
  readonly name: string
}

/** 一台电脑上、有命令的那些分组。没有命令的分组不在列表里。 */
export interface MobileGroupCommandsEntry {
  readonly groupId: string
  readonly commands: readonly MobileGroupCommand[]
}

export interface MobileGroupCommandsPayload {
  readonly desktopClientInstanceId: string
  readonly revision: number
  readonly groups: readonly MobileGroupCommandsEntry[]
}
```

**只列有命令的分组**：一个分组没有命令就是不在列表里，手机对「不在列表里」和「列表是空的」表现相同
（都不画箭头），所以不需要第三种说法。

**常量**（`shared/src/mobile-live-constants.cjs`，与工具栏/短语并排）：

| 常量 | 值 | 出处 |
|---|---|---|
| `maxGroupCommandGroups` | 128 | 与 `maxSummaryGroups` 同值（同一批分组） |
| `maxGroupCommandsPerGroup` | 64 | 与 `maxToolbarButtons` 同值（同类东西） |
| `maxGroupCommandNameLength` | 80 | 与终端 schema 的命令名上限、`maxSummaryGroupNameLength` 同值 |
| `maxGroupCommandsBytes` | 64 KiB | 与 `maxToolbarBytes` / `maxQuickPhrasesBytes` 同值 |

id 复用既有的 `maxSummaryIdLength`（48）。

**校验**（`shared/src/mobile-live.ts`，照 `isMobileToolbarPayload` 写）：严格 —— 三个字段缺一不可，
`groups` 与每组的 `commands` 都过 `boundedArray`，每条命令的两个字段都过 `boundedString`。

**裁剪**：生产端按 `maxGroupCommandsBytes` 减信封余量（照 `TOOLBAR_ENVELOPE_ALLOWANCE_BYTES = 1_024`，
同文件 89 行）**从尾部整条丢**，绝不发半条。这条规则照抄 `fitToolbarToBudget`（`mobile-gateway-service.ts:899-920`）
那句理由：「half a command is a command the phone would run differently from the computer」。一个分组被丢空就连
它一起去掉。按上面的上限，这个裁剪在真实账号里不可达（64 KiB ≈ 430 条命令行），存在的意义是
「宁可少几条命令，不可丢连接」。

两个条数上限同理，是给线上留的硬边，不是产品限制：**有命令的分组超过 128 个时只发前 128 个**
（超出部分只是没有箭头，不是错误），**单个分组超过 64 条时只发前 64 条**。真实账号都远不到。

### 3.4 桌面端生产

- **纯投影函数**：新文件 `desktop/app-capabilities/terminal/main/mobile-group-commands.ts`，形状照
  `main/mobile-toolbar.ts`（纯函数、不持有状态、可单测）。输入是 `listGroups()` 的结果，输出
  `MobileGroupCommandsEntry[]`，只保留 `settings.commands` 非空的分组。
- **发送**：`mobile-gateway-service.ts` 加 `flushGroupCommands()` / `resendGroupCommands()`，指纹比对
  （`JSON.stringify` 内容，不含 revision）、变了才发，和 `flushToolbar`（同文件 868-897）逐行同构。
- **时机**：挂在 `flushSummary()` 里 `this.flushToolbar()` 那一行的旁边（同文件 928）。那里的注释已经
  写明了为什么不给终端事件加监听：「the terminal event emitter is at Node's default limit of ten listeners
  and this list is not allowed to grow」。
  **这给了本功能一个额外好处**：tick 是 `SUMMARY_INTERVAL_MS = 1_000`（同文件 61），所以**电脑上改了
  命令，手机约一秒内就看到**。工具栏那段注释担心的空窗（「用户编辑命令时手机正闲着」）在这里不存在，
  因为这个 tick 一直在跑，而新建面板正是「差异会被看见」的那一屏。
- **`sync`**：`intent-executor.ts:216-217` 那两行 `sendToolbar()` / `sendQuickPhrases()` 旁边加一行
  `sendGroupCommands()` —— 刚连上的手机什么都还没收到，指纹必须清掉再推一次。
- 复用同一次 `listGroups()`：它在 `flushSummary` 里已经为摘要调过一次（`summaryGroups()`，同文件 1055），
  两者共用同一份快照，不要为它再取一次。

### 3.5 服务端

`mobile-live-relay.service.ts` 加 `handleGroupCommands`，**照 `handleToolbar`（同文件 252-255）：fanout，
不缓存**。不缓存的理由那段注释已经写全了：「a phone that connects mid-session is answered by the desktop when
its `sync` intent arrives rather than by anything held here. A cache would only ever serve a phone whose computer
has since gone.」同时 `live-desktop.gateway.ts` 的 `LiveMobileRelayHandler` 接口加一个方法。

### 3.6 手机端

| 位置 | 改动 |
|---|---|
| `Core/Protocol/LiveProtocol.swift:24` 附近 | 加 `LiveMessageType.mobileGroupCommands = "mobile.groupCommands"` |
| `Core/Realtime/RealtimeClient.swift:387` / `:455` | 加进订阅列表与分发 switch |
| 新文件 `Features/Terminal/TerminalGroupCommandState.swift` | 单槽、按电脑、登出清空 —— 形状照 `TerminalToolbarState.swift`，它的注释已经解决了「这台电脑没发过」与「没有命令」的区分 |
| `App/SynapseAppModel.swift` | 加槽位（照 29 行的 `toolbar`）、登录/登出时 `reset()`（照 479 行）、收发处 `adopt(payload)`（照 801 行）、读法照 1312-1322 的 `toolbar.buttons(forSelected:)` |
| `Features/Sessions/NewSessionSheet.swift` | 面板按 `groupId` join 出命令列表决定箭头；`AgentRowRoute` 加 `case groupCommands(groupId:)`（**它的 doc 注释要改**：它不再只是对话段的路由）；新增命令列表子页 |
| `Features/Sessions/SessionListView.swift:88-104` | `NewSessionSheet` 加 `onCommandLaunched: (String, String) -> Void` → `model.launchCommand(groupId:commandId:)` → `openNewlyCreated` |

**`App/SynapseAppModel.swift:1579` 的 `launchCommand` 一行不改**，`intent-executor.ts:612-620` 也不改 ——
这两个环节本来就是为这条线写好的。

**一个实现上的坑**：`@Environment(\.dismiss)` 在被 push 的子页里调用，可能变成「弹出这一屏」而不是
「关掉面板」。所以命令行的点击只发出动作，**dismiss 统一由面板根视图收口**（沿用今天 `terminalRows`
在同层调 `dismiss()` 的做法），并用 UI 测试钉住（§8.2）。

### 3.7 只显示命令名，不显示命令正文

桌面自己那个下拉菜单就只显示名字。正文不进这条线：正文在电脑上是加密存储的，还可以挂环境变量，而
「手机上要跑什么」不是这一屏要回答的问题。名字起得像的两条命令，回电脑上改名。

**说清楚一件事**：这**不是**一条「正文不许过这条线」的安全边界 —— 同一条线上，工具栏自定义按钮的正文
（`MobileToolbarButton.action.text`）、快捷输入的正文、剪切板正文本来就在传。不上正文是**产品口径**
（与桌面列表一致、这一屏不需要），不是安全结论。

### 3.8 「直接新建终端」不等于「不跑任何东西」

分组还有一个 `settings.startupCommand`，它在**任何**会话建进这个分组时都会跑，与本次改动无关、也不受
它影响。所以底部那行准确的读法是「不额外指定命令」，而不是「什么都不跑」。写在这里免得以后被当成 bug。

---

## 4. 失败与离线

| 情况 | 表现 |
|---|---|
| 电脑不在线 | 与今天一样：建不出来，banner 说原因 |
| 命令被电脑拒绝（权限、命令已删、启动失败） | 面板已关，banner 用电脑自己的话说明；不产生半成品会话 |
| 电脑上删掉了正在看的那个命令 | 一秒内从手机上消失；若正好按下，电脑按「找不到这条命令」拒绝 |
| 电脑端版本太旧（不认识这条消息） | 手机收不到任何命令列表 → 所有分组都没箭头 → 行为与今天完全一致 |
| 手机端版本太旧 | 不订阅这条消息，行为与今天完全一致 |
| 服务端版本太旧 | 见 §5：消息被静默丢掉，同样退化成「没箭头」 |

---

## 5. 升级顺序（硬约束）

`shared/src/live.ts:200-218` 的 `isLiveDesktopClientMessage` 是一个 `if` 链，**未知类型返回 `false`** ——
老服务端拿到 `mobile.groupCommands` 会把它**静默丢掉**，不报错、不回执。这和上游文档 §5.1 里
`createAgentConversation` 那条「新 kind 会被静默丢在边缘」是同一个机制。

因此必须按 **服务端 → 桌面端 → 手机端** 的顺序部署：

- 服务端先升：否则电脑发了也到不了手机。
- 桌面端再升：否则没有这份列表可发。
- 手机端最后：它读的就是前两端提供的东西。

反过来的两个组合都不会崩，只是**退化成今天的样子**（没箭头、点一下建终端），这一点要在真机上验一遍（§8.3）。

---

## 6. 安全

- 这条消息只带 **`groupId`、命令 `id`、命令 `name`**。不带正文、不带环境变量、不带 `cwd`、不带 shell。
- 手机做的仍然是**瘦客户端**：命令在电脑上执行，手机只发 `launchCommand{groupId, commandId}`。
- 启动路径的权限点是既有的 `terminal.command.launch`（`mobile-gateway/intent-executor.ts:613`），且带
  资源名 `terminal.group:<groupId>`；本次不新增、不放松任何权限点。
- 读这条列表不新增权限：分组名本来就在摘要里，命令名是同一批数据里更小的一份。

---

## 7. 非目标

- **不在手机上管理命令**。增删改（含「管理命令」入口）全部留在电脑。
- **不显示命令正文**（§3.7）。
- **不做命令排序**。顺序就是电脑上的顺序。
- **不动桌面端任何行为**。桌面下拉、命令管理、`launchGroupCommand` 全部不变。
- **不新增 intent**。`launchCommand` 已经存在且已在执行侧实现。
- **不改 `mobile.summary`**。这条是本次最重要的非目标，理由见 §2。
- **不动「项目」段**（Claude Code 对话那条线）。
- **不给分组命令加搜索**。

---

## 8. 验收基线

1. 有命令的分组：行右有箭头，点进命令列表，点一条命令 → 手机直接进入那个终端，命令已跑起来。
2. 没有命令的分组：**一次点击建终端**，没有箭头、没有第二屏，与今天逐像素一致。
3. 命令列表底部永远有「直接新建终端」，它建出来的会话不带任何命令。
4. 搜索框照旧只筛分组，箭头跟着行走；命令列表里没有搜索框。
5. 电脑上新增/改名/删除一条命令：手机在约一秒内看到变化（新增后出现箭头，删空后箭头消失）。
6. 电脑端版本太旧：所有分组都没有箭头，行为与今天完全一致，不崩、不出现空列表。
7. 手机上任何地方都不出现命令正文。
8. 命令被电脑拒绝时：面板已关，banner 说清原因，不产生半成品会话。
9. 摘要的字节预算与套接字 `maxPayload` 都没被这次改动动过（`mobile-live.test.ts:513` 那条边界测试原样通过）。

### 8.1 自动化测试

- **shared**：新消息的校验（合法/缺字段/超条数/超名长）、边界（`groups` 与 `commands` 都到上限）、
  以及「未知类型被 `isLiveDesktopClientMessage` 拒绝」这条 §5 的机制不变。
- **桌面端**：投影函数单测（有命令/无命令/空分组不出现/超预算丢尾丢整组）；`flushGroupCommands` 的
  指纹（内容不变不发、变了发一次）；`sync` 会推（`resendGroupCommands`）。
- **服务端**：`handleGroupCommands` fanout；以及一条**透传测试**：一条带新字段的消息经 relay 后手机侧
  仍能解出同样的内容。
- **手机端**：Swift 单测 —— 解码（合法/畸形/空列表）、`TerminalGroupCommandState` 的「发过一份空列表」
  与「从没收到过」两种情形、以及面板的分流（有命令 → 进子页；没有 → 直接建）。

### 8.2 需要真机/真电脑端的部分

UI 测试必须有**真电脑端**：`server/test/mock-desktop.mjs` 的头部注释写明它不实现 `create`、
`createAgentConversation` 和 `launchCommand`（「the New Terminal panel... which the real-desktop suite
exercises against a real computer anyway」）。所以端到端那条用例照 `AgentConversationUITests.swift` 的写法，
用 `SYNAPSE_TEST_EMAIL` / `SYNAPSE_TEST_PASSWORD` / `SYNAPSE_TEST_BASE_URL` 做 `XCTSkipIf`。

### 8.3 真机手工验收

- §5 的三个版本组合各走一遍（新电脑 + 老手机、新电脑 + 老服务端、新手机 + 老电脑）。
- 电脑上改命令，手机面板开着看它有没有跟上。

---

## 9. 开放项

| # | 事项 | 现状 |
|---|---|---|
| 1 | 分组多到什么程度要加搜索 | 命令列表本轮不加搜索；分组数上限既是 128，超过再评估 |
| 2 | 是否复用 `mobile.toolbar` 的自定义按钮那条线 | 否。两者来源、变更事件、手机落点都不同；`transport.ts:79-84` 已经写明这种「两条消息各自的语义」的理由 |
| 3 | `capability-registry.md` | 本次**不新增 capability**（走 mobile gateway，不是 `app.*`），但读取了终端能力的分组命令列表，落地时按 CLAUDE.md 核对一遍注册表与文档 |
| 4 | `RELEASE_NOTES_PENDING.md` | 需要更新（用户可感知的新功能） |
| 5 | `docs/agents/` 是否有需要同步的模块边界说明 | 落地时用「终端分组」「快捷命令」搜一遍 `docs/`，重点看 `docs/agents/module-boundaries.md` |
