# 剪切板同步 · 实施计划

> 配套文档（都在 `~/Desktop/剪切板同步/`）：`产品设计文档.md`（口径与验收基线，**冲突时以它为准**）、`原型.html`（可点）
> 目标：电脑上复制一段文本，手机上能取到，可以逐条复制进手机剪切板。
> **一次性做完**，但每个阶段结束都要能独立验证，不要攒到最后一起测。

---

## 总览

| 阶段 | 内容 | 动到的包 | 是否可单独砍掉 |
|---|---|---|---|
| 0 | 开工前核对，含两个最高风险探针 | — | 否 |
| 1 | 电脑侧采集（无界面、无协议，可单测） | desktop | 否 |
| 2 | 协议 + 云端转发 | shared + server | 否 |
| 3 | 电脑侧推送（接进 `sync` 补推点） | desktop + server/test | 否 |
| 4 | 手机端数据层（无界面，可单测） | SynapseMobile | 否 |
| 5 | 手机端两个入口与列表 | SynapseMobile | 否 |
| 6 | 文案、发布说明与收尾 | docs + 根目录 | 否 |

**发版顺序是硬的：服务端 → 桌面端 → 手机端。** 云端用一个 type 白名单校验消息（`shared/src/live.ts` 的 `isLiveDesktopClientMessage` / `isLiveMobileClientMessage`），旧云端收到不认识的类型会**断开 socket**，用户看到的是「电脑离线」这种和真因毫无关系的现象。`docs/superpowers/specs/2026-09-17-terminal-shortcut-sync-design.md` §6 已经为同族改动写过这条约束，照办。

---

## 阶段 0：开工前的核对

### 0.1 读文档

按仓库 `CLAUDE.md` 的必读路由，本任务至少要读：

- `docs/agents/repository-guide.md`（仓库结构、命令、打包）
- `docs/agents/execution-rules.md`（设计文档发现与验证方式）
- `docs/agents/capability-registry.md`（判断本任务是否要登记；按设计预期**不需要**，因为没有新增 capability）
- `产品设计文档.md` §2 的现状表
- `SynapseMobile/README.md`（手机端链路与 UI 测试怎么跑）
- `docs/adr/0211-*.md`、`docs/adr/0072-*.md`（剪贴板正文的留存口径）

### 0.2 核对现状

逐条对照 `产品设计文档.md` §2 的表格确认，**不要凭印象**。特别确认这几条，它们都会因为「多了一行代码」而失效：

- `SessionListView.swift` 的 `deviceSection` 到底包了哪些元素（阶段 5 要拆它）。
- `TerminalShortcutPanel.swift` 的 `shown` 与分段器可见性判断（现在写死两段）。
- `mobile-gateway-service.ts` 里三个指纹字段各自独立（`lastSummaryContent` / `lastToolbarContent` / `lastQuickPhrasesContent`），不要复用一个。
- `mobile-gateway/controller.ts` 的三张策略表：确认本任务**确实不需要**往里面加东西（设计文档 6.10 的理由）。

### 0.3 探针一：macOS concealed 标记（**已跑完，结论如下**）

2026-09-21 在 macOS 26 / Electron 41.2.1 上实测完毕。**结论：可行，但检测方法不是直觉的那一个。**

- **用 `clipboard.readBuffer(uti).length > 0` 判断，不要用 `availableFormats()` 或 `has()`。** 后两者对自定义 UTI 一律说谎（`availableFormats()` 只回 `["text/plain"]`，`has()` 回 `false`），只有 `readBuffer()` 会把格式名原样透传给 `NSPasteboard`。
- 两个名字都要查：`org.nspasteboard.ConcealedType`、`application/x-nspasteboard-concealed-type`（Qt 系工具在 macOS 上看到的是后者）。
- **探针本身有两个坑，都会给出假的「做不到」**：① 拿 `availableFormats()` 当判据；② 探针冷启动太慢，等它读的时候标记已经被别的剪切板管理器抹掉了。要让读取发生在「夹具刚设好」的窗口内（常驻进程 + 信号触发），并且**用外部工具（原生 `pb.types`）核对夹具真的设上了**——否则「夹具没生效」会被读成「读不到」。

**还差一步真机确认**：上面的结论出自合成夹具（按 nspasteboard.org 的定义写入 `org.nspasteboard.ConcealedType`）。实施时要请用户用**真实的密码管理器**复制一次密码，确认真实路径上也读得到。这一条不做完，不要把决策五当成已经落地。

### 0.3b 一个已知会让过滤失效的场景

实测时发现：开发机上的 PastePal **会在约 1 秒内改写剪切板并抹掉 concealed 标记**（changeCount +1、typeCount 3→2）。标记没了，任何检测手段都看不见——不是读得不对，是标记真的不在。

这不是本设计能解决的问题（不可能枚举并适配所有剪切板管理器），但有两件事要照做：轮询间隔不宜再拉长（间隔越长越容易落在抹除之后）；以及**不要在文档或界面上承诺「密码永远不会被同步」**，承诺的只能是「带标记的会跳过」。

### 0.4 探针二：轮询的代价（**已量完**）

每次轮询 = `readText()` + `sha256`，实测（同一天、Electron 41.2.1）：

| 剪切板大小 | 每次轮询 |
|---|---|
| 空 | 2.8 µs |
| 1 KB | 23 µs |
| 50 KB | 116 µs |
| 5 MB | 10.8 ms |

按单条 128KB 的上限算，稳态开销在 **0.3 ms/秒**以下——1 秒的间隔完全站得住。哈希是大文本那一档的主要成本，但它也正是上限为什么定在 128KB 的理由；真有人长期复制 5MB 的东西，也只是约 1% 的一个核，接受。

**这条数字要写进服务实现的注释里**，否则后来的人看到「每秒读一次剪切板」会以为这是个昂贵的决定而想当然地去优化它。

---

## 阶段 1：电脑侧采集

不碰协议、不碰手机，纯桌面端。做完之后可以单独用单测证明「电脑上复制的每一段文本都被正确采集、去重、淘汰、过滤」。

### 新增文件

| 文件 | 职责 |
|---|---|
| `desktop/electron/services/clipboard-sync-service.ts` | 轮询剪切板，维护**内存环形缓冲**（最近 20 条），内容哈希去重，`changed` 事件 |
| `desktop/electron/services/__tests__/clipboard-sync-service.test.ts` | 单测，注入的手动定时器驱动 |

服务对外只暴露三样：`start()` / `stop()` / `snapshot(): ClipboardEntry[]`，加一个 `events.on("changed", …)`。

**实现要点，逐条都有先例可循：**

- **定时器用 `setTimeout` 自递归，不用 `setInterval`。** 本仓库没有任何 service 注入过 `setInterval`（那些裸用的都没法单测），而 `mobile-gateway-service.ts:153-154 / 238-239 / 697-703` 已经把「注入 `setTimeout`/`clearTimeout` + 回调第一句先清 handle + 最后重排」这套写成了定型范式。照抄它，测试才能用 `ManualTimers` 驱动。
- **环形缓冲用普通数组，不进 DataRepository。** 四种 backend 全是持久化的，没有「仅内存」这一档；而且设计文档 6.9 已经确认落盘才会落进 ADR 0211 想避免的那一类。20 条就写成一个数组 + `unshift` + 截断。
- **条目身份是内容哈希。** `sha256(text)` 同时当 id 用——手机侧靠它去重、也靠它实现「重复复制提到最前」。哈希碰撞在这里不是威胁模型，不必加盐。
- **每条都更新 `lastHash`，包括被丢弃的。** 超长（> 128KB）、concealed、空文本这三种情况都要更新，否则轮询会每秒重新读一遍同一个大字符串、或者每秒重放同一次拒绝。
- **`snapshot()` 返回的是快照数组的副本**，不是内部那个数组的引用。

### 改动的文件

**`desktop/electron/bootstrap/descriptors.ts`** —— 新增 `coreClipboardSyncDescriptor`，照 `coreClipboardDescriptor`（`:853-871`）的形状写：

- `criticality: "degraded"`。轮询失败不该拖垮整个应用（`fatal` 会 abort 整个 registry 启动，用户看到「部分功能不可用」弹窗）。
- `startAfter: ["core.audit-sink"]`，**不写 `dependsOn`**——审计不可用不该让采集起不来。
- `start(service) { return service.start() }` / `stop(service) { return service.stop() }`，照 `coreClientTelemetryDescriptor`（`:2109-2131`）。
- 剪切板对象直接注入（`descriptors.ts` 里已经从 electron 顶层 import 了 `clipboard`）。

**`desktop/electron/bootstrap/registry.ts`** —— import + `registry.register(...)`。

**不要动 `desktop/app-capabilities/clipboard/`。** 那是 Workflow 的能力契约（`CONTEXT.md:66` 明文声明了它的边界：只纯文本，不碰其它格式），本服务是移动端通道自己的采集器，走直接注入，不进那层。这样 `adapter.ts` / `adapter.test.ts` / `service.test.ts` 一行都不用改。

### 测试

`desktop/electron/services/__tests__/clipboard-sync-service.test.ts`。**测试必须在坏的时候会红**，至少覆盖：

- 复制 A → B → A：`snapshot()` 是 `[A, B]`，且 A 的时间被刷新（不是 `[B, A]`，也不是 `[A, B, A]`）。
- 连续复制 25 条：`snapshot()` 恰好 20 条，丢的是最旧的。
- 内容不变重排定时器：不 emit `changed`。
- concealed 标记出现：不采集、不 emit，且**后续正常内容照样采得到**（不能一次拒绝就再也不工作）。
- 超长文本（> 128KB）：不入环、不 emit，且不会每秒重复读它。
- 空字符串 / 只有空白：不采集。
- `stop()` 之后 `advance` 不再 emit；`start()` 两次不会跑出两个定时器。

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

---

## 阶段 2：协议与云端转发

### 新增消息类型

`mobile.clipboard`（电脑 → 手机）。

**`shared/src/mobile-live.ts`**：

- 新增 payload 类型与校验器（放 `:989` 那一带），照 `mobile.quickPhrases`（`:697` / `:1055`）走**严格**路线——剪切板条目和短语一样只有字符串，解不出就是消息坏了，不该宽松放过。
- `MOBILE_FRAME_LIMITS`（`:34`）新增 `maxClipboardBytes`，值取 **256KB**。参照 `maxSummaryBytes: 248KB` 这个已经在用的量级，不要凭感觉定一个新数量级。
- 载荷形状：`{ desktopClientInstanceId, revision, entries: [{ id, text, copiedAt }] }`，`entries` 最新在前、最多 20 条。

**`shared/src/live.ts`**：

- `LIVE_MESSAGE_TYPES`（`:15-32`）加常量。
- `LiveDesktopClientMessage`（桌面发，`:95-104`）与 `LiveMobileServerMessage`（手机收，`:127-136`）各加进联合。
- 对应的校验分支（`:177-215` / `:146-160`）各加一处。

### 改动的文件

**`server/src/live/live-desktop.gateway.ts`** —— `LiveMobileRelayHandler` 接口（`:61-96`）加一个方法，并在 `handleMobileRelayMessage()`（`:641-684`）加分支。**这一处漏了会被静默丢弃**，`672-675` 的 else 分支只会 warn 一句。

**`server/src/mobile-live/mobile-live-relay.service.ts`** —— 新增 `handleClipboard()`，**扇形广播、不缓存**，照 `handleQuickPhrases()`（`:224-229`）。理由和工具栏、短语一致（`:208-223` 那段注释）：缓存只会服务一台已经不在的电脑，而那时内容是错的。

### 验证

```bash
pnpm --filter @synapse/shared build
pnpm --filter @synapse/shared test
pnpm --filter @synapse/server test
```

`@synapse/shared` 是**编译产物**（`package.json` 指向 `dist/`），桌面主进程懒加载它——改完不 build，两端就会各说各话。`shared/src/mobile-live.test.ts:103-147` 有一条专门的「手机消息必须过桌面白名单」的兜底测试，新类型进不了白名单它会红。

---

## 阶段 3：电脑侧推送

### 改动的文件

**`desktop/electron/services/mobile-gateway/transport.ts`** —— 接口加 `sendClipboard(draft)`，draft 类型从 payload `Omit` 掉 `desktopClientInstanceId`（照 `:27` 的 `MobileQuickPhrasesDraft`）。

**`desktop/electron/services/live-connection-service.ts`** —— 加 `sendMobileClipboard(draft)`，照 `sendMobileQuickPhrases`（`:415-423`）：拿不到 `clientInstanceId` 就丢弃，socket 非 OPEN 就静默丢弃（`461-468`）。

**`desktop/electron/services/mobile-gateway-service.ts`**：

- 新增**第四个**独立指纹：`lastClipboardContent` + `clipboardRevision`（**不要复用** summary / toolbar / quickPhrases 那三个，`:221-229` 的注释已经解释过为什么每个变更场合各要一份）。
- `flushClipboard()`：读 `listClipboard()` → 指纹比对 → 不等才发。`resendClipboard()` 用「清空比对基准」强制重发（照 `:1122-1125` 的写法，不要加 `force` 参数）。
- 数据来源走注入：`listClipboard: () => ctx.registry.get<ClipboardSyncService>("core.clipboard-sync").snapshot()`，照 `:576` 的 `listQuickPhrases`。**gateway 不持有第二份数据。**
- `dependsOn` 里加上 `"core.clipboard-sync"`（照 `:538` 加 `"core.quick-input"` 的那一处）。
- `stop()` 里清空 `lastClipboardContent`（`:307` 同族）。

**`desktop/electron/bootstrap/app-ready.ts`** —— 订阅 `clipboardSync.events.on("changed", () => void mobileGateway.flushClipboard())`，照 `:177-197` 的 quick-input 那段：用 `WeakSet` 防重复挂载（服务可能被 reload 重建，布尔量不行），并单独包一层 `try/catch`（采集不可用不能连带毁掉网关的其它能力）。

**`desktop/electron/services/mobile-gateway/intent-executor.ts`** —— 在 `case "sync"`（`:181-195`）里加 `deps.sendClipboard()`，与 `sendToolbar` / `sendQuickPhrases` 并列，并在 `IntentExecutorDeps` 里声明。

**只挂 `sync`，不挂 `attach`。** 理由写进代码注释，因为它看起来像个疏漏：`attach` 是「打开某个终端」的时刻，而剪切板与终端无关——每打开一个终端就推一次剪切板内容是白推。`sync` 覆盖了全部真正需要的时刻：手机刚连上、重连、切换电脑（`selectDesktop` → `refreshDesktops` → `requestSync`），这三条路都汇到 `sync`。这条改动**同时让手机端零新增 intent**——它本来就在这些时刻发 `sync`。`intent-executor.ts:71-81` 那句「这两个是仅有的、已知手机确实在看这台电脑的时刻」的注释要跟着改，否则注释说谎。

**`server/test/mock-desktop.mjs`** —— 补剪切板夹具：一个数组 + `sendClipboard()`，挂在「连上 / `sync` / （若需要）`attach`」三个调用点，并加一条控制路由（照 `/desktop/toolbar`），让 UI 测试能中途换掉这一包。**没有这个夹具，阶段 5 的 UI 测试写不了。**

### 测试

`desktop/electron/services/__tests__/mobile-gateway-service.test.ts` 加用例，沿用文件里已有的 `ManualTimers`：

- 采集 emit 一次 → 恰好推一次 `sendClipboard`。
- 指纹没变（列表相同）→ 一个字节都不发。
- `sync` 到达 → 强制重推一次（即使指纹没变）。
- 推的内容与 `snapshot()` 一致，且**不含任何被 concealed 过滤掉的条目**。

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

---

## 阶段 4：手机端数据层

不出界面。做完之后能单测证明「按电脑分桶、归并、封顶、清空水位、登出清空」全部正确。

### 新增文件

| 文件 | 职责 |
|---|---|
| `SynapseMobile/SynapseMobile/Features/Terminal/ClipboardHistoryStore.swift` | `@MainActor @Observable final class`，`[String: [ClipboardEntry]]` 按 `desktopClientInstanceId` 分桶，JSON 编码进可注入的 `UserDefaults` |
| `SynapseMobile/SynapseMobileTests/ClipboardHistoryTests.swift` | 单测 |

**形状照 `TerminalDisplaySettings`**（`:17-29` 全局标量 + `[String: T]` 分桶 JSON + 可注入 `UserDefaults` + `prune`），这是仓库里唯一一个「按 id 分桶且持久化」的现成范本。

**四条必须写进实现的规则：**

1. **归并，不是替换。** 收到快照时按 id 逐条并入本地那一桶，按 `copiedAt` 倒序，封顶 **50**。电脑内存只有 20 条，整包替换会让手机那份凭空缩到 20（设计文档 5.3）。
2. **清空留水位。** 每桶存一个「不早于此刻的才收」，归并时丢掉早于它的条目；否则清空之后电脑下次推快照会把刚清掉的内容顶回来（设计文档 5.3）。
3. **桶的 key 用 `clientInstanceId`**，它不跨账号复用（`ViewedDesktopPreference.forget()` 的注释已经写明这条），但整体仍**必须在 `signOut()` 清空**——剪切板是手机端第一个「内容属于账号、文件落在机器上」的持久化数据，不清就会让下一个登录的账号看到上一个账号的剪切板内容。挂载点照 `MeetingAudioCache.clearAll()`（`SynapseAppModel.swift:474`）。
4. **切换电脑不清任何数据。** 桶是按 id 分的，视图按 `selectedDesktopClientInstanceId` 挑桶就行——这正是「分桶」相对 `toolbar`/`quickPhrases` 那种「单槽 + 归属过滤」的价值所在。不要往 `selectDesktop` 里加清理。

### 改动的文件

**`SynapseMobile/.../Core/Protocol/LiveProtocol.swift`**（手抄 `shared/` 的镜像）：

- `LiveMessageType`（`:9-30`）加 `mobileClipboard`。
- 新增 `MobileClipboardEntry`（`id` / `text` / `copiedAt`）与 `MobileClipboardPayload`，严格解码，照 `MobileQuickPhrasesPayload`（`:621-646`）。

**`SynapseMobile/.../Core/Realtime/RealtimeClient.swift`** —— 只有三处：

- `:112-113` 同族加 `var onClipboard: ((MobileClipboardPayload) -> Void)?`
- `knownMessageTypes`（`:369-379`）加进去。**不加就被静默丢弃**，而且不算「连接健康」的证词。
- `handle(_:)` 的 switch（`:442-449`）加分支。

**`SynapseMobile/.../App/SynapseAppModel.swift`**：

- 持有 `clipboard = ClipboardHistoryStore()`（照 `:29` 的 `toolbar` / `:33` 的 `quickPhrases`）。
- `wireRealtime()` 里接线（`:749-754` 同族）。
- `signOut()` 里清空（`:439-490`）。
- 对外读取口：`var activeClipboardEntries: [ClipboardEntry]`（照 `:1264-1266` 的 `activeQuickPhrases`）。

### 测试

`SynapseMobileTests/ClipboardHistoryTests.swift`，形状照 `TerminalQuickPhrasesTests.swift`（私有 `decode(_:)` 辅助 + 三值语义 + 换电脑那几条）。**必须在坏的时候会红**：

- 收到 20 条快照，本地已有 40 条旧的 → 归并后是 50 条，**旧的没被冲掉**（这条专门反证「整包替换」）。
- 同一段内容第二次到 → 条数不变，它跑到最前，时间被刷新。
- 超过 50 条 → 丢最旧的。
- 清空后水位生效：清空前的条目再来一次不进；清空后新复制的进。
- 两台电脑各自成桶，互不污染。
- 解码失败（缺字段 / 类型错）→ 整条消息拒绝，且**不破坏已有那一桶**。
- `signOut()` 之后桶为空。

```bash
cd SynapseMobile
xcodebuild test -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileTests -parallel-testing-enabled NO
```

---

## 阶段 5：手机端两个入口

### 5.1 入口 A：设备行

**`SynapseMobile/.../Features/Sessions/SessionListView.swift`** —— 拆 `deviceSection` / `deviceRow`（`:224-274`）：

现在多电脑时**整行**被 `Menu` 包住。把 `Menu` 的包裹范围收窄到左边的「绿点 + 名字 + 切换箭头」，让剪切板图标和状态标签留在 `Menu` 外面各自接手势。改完必须确认 `accessibilityIdentifier("switch-computer")` 与 `switch-computer-option-\(clientInstanceId)` 都还在，且点行仍然切电脑——包括这个能力存在的那个理由：手机停在一台已经走掉的电脑上时，另一台是唯一的出路。

图标：SF Symbol `doc.on.clipboard`，`accessibilityLabel("剪切板")`，标识符 `device-clipboard`。没有电脑时设备行本来就不画，图标跟着一起消失，不需要额外判断。

### 5.2 入口 B：快捷面板第三段

**`SynapseMobile/.../Features/Terminal/TerminalShortcutPanel.swift`**：

- `ShortcutPanelSegment`（`:4-16`）加 `case clipboard`，`label` 为「剪切板」，顺序**最左**。
- 分段器可见性判断（`:77-87`）现在写死 `phrases != nil`。**必须放宽成「剪切板可用 或 短语可用」**，否则一台没配快捷短语的电脑会让整个分段器消失，连剪切板段也一起没了。
- `shown`（`:71-73`）现在是二选一，要改成「记住的段不可用 → 退到第一个可用的段」。
- 剪切板段**不接受 `isRunning` 门控**：它的三个动作（复制到手机剪切板、看全文、清空）没有一个与电脑上那个终端进程有关。整段跟着置灰等于把手机本地的功能误绑到电脑状态上（设计文档 6.7）。
- 空态 `shortcut-clipboard-empty`，文案见设计文档 5.6。

**`SynapseMobile/.../Features/Terminal/TerminalScreen.swift`** —— 把 `model.activeClipboardEntries` 传进面板（`:727-751` 那一处）。

### 5.3 列表、详情、清空

- 行：正文两行截断 + 相对时间 + 行尾眼睛。**直接复用 `row(_:)`（`:209-246`）的成品写法**——那里已经有「文本 + 独立 eye Button + 整行 `onTapGesture`」这套手势处理，包括「button 在 row 里、谁接得到点击」那个坑的答案。
- 点行：`UIPasteboard.general.string = text` → `Haptics.success()` → `model.notice("已复制", tone: .success, id: "clipboard.copied")`。**id 必须自带**：不带 id 会按文案去重，而两条不同内容各自排队是错的；`"terminal.copied"` 就是为同样的理由存在的。面板**不关**。成功的 buzz 由 call site 发，`notice` 自己只在失败时发（`Haptics.swift:27-33`「One outcome, one buzz」）。
- 点眼睛：第二个 sheet，形态照 `PhrasePreviewSheet`（`:257-280`），detents `[.fraction(0.32), .medium, .large]`，`.textSelection(.enabled)`。**不放「复制」按钮**——背后那行已经管这事了。
- 清空：确认弹窗 → 清当前这一桶 + 写水位。列表为空时置灰而不是隐藏。

### 标识符

新增，**一个已有的都不许改**（`docs/superpowers/plans/2026-09-18-mobile-terminal-toolbar.md` 阶段 4 的硬约束）：

`device-clipboard` / `shortcut-clipboard-empty` / `clipboard-row-\(entry.id)` / `clipboard-preview-\(entry.id)` / `clipboard-preview-text` / `clipboard-clear`。
分段器继续用已存在的 `shortcut-panel-segment`。

### UI 测试

照 `TerminalFlowUITests` 里短语段那三条的形状写：`testThePhraseSegmentFillsTheFieldWithoutSending`、`testTheEyeShowsTheWholeSentenceWithoutUsingIt`、`testAnOldComputerGetsNoPhraseSegment`。再加两条本功能独有的：

- **点行复制不关面板**（连点两条都成功）。
- **切电脑后列表换了一份**（照 `ComputerSwitchUITests` 的双 mock 写法，断言的是电脑名而不是内容）。

```bash
cd SynapseMobile
xcodebuild test-without-building -xctestrun <…>.xctestrun \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/TerminalFlowUITests -parallel-testing-enabled NO
```

### 完成标准

**装到李杨的 iPhone 上**：`pnpm mobile:install`（不要手拼 `xcodebuild` + `devicectl`，不要硬编码设备 id）。装上去的是开发包，代价是收不到推送——这是已知且接受的，不要为此去动推送网关。

---

## 阶段 6：文案与收尾

- **`RELEASE_NOTES_PENDING.md`** —— 「新增功能」下写一条面向用户的：手机端能取到电脑剪切板最近复制的内容，点一条就进手机剪切板。不写代码路径、不写实现。
- **`CONTEXT.md`** —— 只有当实现真的扩了 clipboard 能力的公开边界时才改。按本计划（采集走独立服务、不进 `app-capabilities/clipboard`）**不需要改**；如果实施过程中改了那个包，就必须同步改 `CONTEXT.md:66` 那段边界声明。
- **`docs/agents/capability-registry.md`** —— 本任务没有新增 System App / Dock / Workflow Node / Automation Action / MCP tool / Deep Link，预期不需要动。但新增了一个 service descriptor，如果该文档有 service 清单，按实际情况补。
- **`docs/superpowers/`** —— 把 `产品设计文档.md` 与 `实施计划.md` 按仓库命名落到 `specs/2026-09-21-mobile-clipboard-sync-design.md` 与 `plans/2026-09-21-mobile-clipboard-sync.md`。

### 最后一遍验收

按 `产品设计文档.md` §9 的 10 条逐条走，**在真机上**。其中第 6 条（密码管理器复制的内容不上手机）和第 3 条（离线期间复制的内容在恢复后能补上）必须在真实设备与真实网络上走一次，模拟器上走不出这两个。
