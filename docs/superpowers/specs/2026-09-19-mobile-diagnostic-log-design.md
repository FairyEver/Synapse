# 手机端诊断日志设计（2026-09-19）

## 为什么做

一位朋友的 iPhone（iOS 18.6.2）报告「终端不能上下滚动」。查证过程里暴露的是**更普遍的问题**：手机端全 App 只有 12 处 `os.Logger` 调用，没有落盘、没有导出、没有诊断界面。他复现完之后，我们手上什么都没有 —— 既不能确认是哪一种成因，也不能排除环境因素。

同类问题不止这一个：终端连不上、画面空白、语音识别失败、闪退。它们共同的特征是**只能靠用户复述**，而复述丢掉的恰好是判断所需的那部分。

因此这套机制按**通用诊断**做，终端滚动只是第一个要回答的问题。

## 硬约束（用户拍板）

| 决策 | 取值 | 理由 |
|---|---|---|
| 终端正文 | **默认开、但可关、每秒至多一条、三重限长、先脱敏** | 2026-09-20 改：用户要求导出包能自查，于是把"一个字都不记"换成了"记，但收窄到可控"。脱敏只认 `key=value` 与已知 token 前缀，**密码提示符下敲进去的密码认得出来才怪** —— 这是明确接受过的代价，用导出时的二次确认与包内的明示来抵 |
| 默认开关 | **默认常开** | 用户复现一次不容易，"忘了先打开开关"是最没必要的浪费 |
| 崩溃捕获 | 未捕获异常 + 崩溃前日志，**不装 signal handler** | 信号处理里能用的 API 极少，日志模块自己出错违背"不得卡死 App" |
| 身份字段 | 记**设备名**与**会话标题**，**邮箱用占位符** | 前两者回答"哪台手机、哪个终端"；邮箱对定位问题毫无用处 |

## 结构

`SynapseMobile/SynapseMobile/Core/Diagnostics/`：

| 文件 | 职责 | 纯度 |
|---|---|---|
| `DiagnosticValue.swift` | 字段值类型、标签与占位符 | 纯 |
| `DiagnosticEvent.swift` | 事件目录、字段名、记录 | 纯 |
| `DiagnosticRedactor.swift` | 脱敏规则 + 标识符别名表 | 纯 |
| `DiagnosticBuffer.swift` | 环形缓冲、采样、令牌桶、相邻合并 | 纯（时钟可注入） |
| `DiagnosticRotation.swift` | 轮转/删除决策、记录渲染成单行 | 纯（不 import FileManager） |
| `DiagnosticLog.swift` | 门面与开关 | 薄壳 |
| `DiagnosticFileSink.swift` | 串行队列、每个域一份 fd、批量落盘、导出、删除 | 薄壳 |
| `DiagnosticCrashHandler.swift` | 未捕获异常处理器 | 薄壳 |
| `DiagnosticEnvironment.swift` | 设备与环境快照、`manifest.json` | `@MainActor` |
| `DiagnosticZip.swift` | ZIP 容器（手写，零依赖） | 纯，只 import Foundation + Compression |
| `DiagnosticCRC32.swift` | ZIP 每条记录的校验和 | 纯 |

`DiagnosticZip` 刻意不 import FileManager、不认识日志、不认识域 —— 只认
`Entry(name:data:modified:)` 数组、返回 `Data`。正因为边界这么窄，它能被 `swiftc`
单独编译出来，在 macOS 上用真正的 `unzip -t`、Python `zipfile.testzip()` 与 `ditto -x -k`
交叉验一遍。见 `DiagnosticZipTests` 里记的那套命令。

UI：`Features/Settings/DiagnosticLogView.swift`，入口在 `SettingsView` 的「诊断」一节。

`Core/AppLog.swift` 保持不变 —— 它服务 Console.app，新机制是第二个 sink，不回填那 12 处调用。

## 关键决定

### 正文的防线：从「编译不过」换成「只有一个入口 + 一条源码守卫」

**（2026-09-20 修正。**原先这里写的是「`DiagnosticValue` 里没有能装任意字符串的 case，所以把终端正文当普通字段记下来编译不过」。用户后来要求导出包能自查，正文于是进了日志，那道防线让了出去。）

现在是 `case captured(CapturedText)` 一格，配三样东西：

1. **唯一入口**：`DiagnosticLog.captureScreen` / `captureInput`。参数是**复数行**（或一个闭包），`CapturedText(redacting: row.text)` 写不出来 —— `row.text` 是个 `String`。
2. **一条源码级的守卫测试**（`DiagnosticContentCaptureTests.capturedTextIsOnlyConstructedInTwoPlaces`）：它遍历 App target，任何新出现的 `CapturedText(` 都会让它红。这是替代「编译不过」的东西，比评审可靠 —— 评审会漏，它不会。
3. **开关 + 调用点采样闸**：关着的时候连那些行都不会被拼出来（闭包没被调用）；开着也每秒至多一条。

诚实的边界：`DeviceName` / `SessionTitle` / `RedactedMessage` 仍接受裸字符串（后者先跑脱敏），而脱敏规则只认 `key=value` 形状与已知 token 前缀。**在密码提示符下敲进去的密码、`cat ~/.ssh/id_rsa` 的输出，都会原样进包。** 导出时会再问一句、包里会写明本次含不含，那是用户还能表示同意的最后一个地方。

### 并发：采样前置 + 锁 + 独立串行队列落盘

调用点路径 = 采样判定（不取锁）→ `os_unfair_lock` → 追加 + 分配序号 → 解锁。百纳秒级，主线程零阻塞、零 `Task` 分配。

不用 `actor`：调用点全是同步上下文（`@MainActor` 同步方法、UIKit 手势回调），`await` 会强迫每处包 `Task {}`，每次日志一次堆分配、还会丢顺序；崩溃时 actor 的 mailbox 也捞不出来。

落盘在串行队列上按 **1 秒 / 积压 100 条** 触发，锁内 swap、锁外渲染写盘。

工程默认 `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`，所以相关类型显式 `nonisolated`。

### 崩溃：三段拼接

`NSSetUncaughtExceptionHandler` **只覆盖 ObjC `NSException`**。抓不到 Swift 运行时陷阱（`fatalError`、强解包、越界）、信号类崩溃、OOM jetsam、看门狗。因此：

1. **处理器**：用缓存的 fd 直接 `write(2)`；取锁用 `trylock`，失败整段跳过；不开文件、不轮转、不编码 JSON。
2. **每秒落盘**（真正的兜底）：无论怎么死，文件里都有死之前 ≤1 秒。
3. **会话标记**：启动写 `app.sessionOpen`，收尾写 `app.sessionClose`；下次启动若上个会话没有 close，写一条 `app.crashSuspected` —— 这是 jetsam 与看门狗唯一的间接证据。

### 文件与轮转

目录 `Library/Caches/SynapseLogs/`。**不进 Documents**：那会跟着 iCloud 备份离开设备，而一份带会话标题的文件不该在用户没点"分享"时先走一步。保护等级 `completeUntilFirstUserAuthentication`（冷启动未解锁也要能写）。代价：长期闲置可能被系统回收。

单文件 1 MiB、保留 10 个、总封顶 10 MiB、单条 2 KiB（栈 8 KiB）。每进程一个文件，便于判断"上个会话有没有收尾"。**活动文件永不进删除候选。**

### 防爆炸（四道闸，全在写盘之前）

1. 采样：`term.scrollTick` 10 Hz（`scrollViewDidScroll` 可达 120 Hz）、`term.rows` 20 Hz；状态迁移类不采样。
2. 合并：相邻同键折叠带 `repeatCount`/`spanMs`。**易变字段不参与键**，且合并自己写进去的字段也必须在易变集里，否则合并一次之后键就变了，下一轮合不动。
3. 令牌桶：200 条/秒、64 KiB/秒；超限只发一条 `log.dropped`。`error` 绕过令牌桶。
4. 环形上限 1000 条，覆盖时累加 `overwritten`，在导出头部报告。

### 脱敏

逐条对齐 `desktop/electron/services/log-store.ts` 的 `redactLogText`，**输出同为 `[redacted]` / `[key]`**。

> 与 ADR 0114 的 `<secret>` / `<token>` 固定占位符集**不是同一套**，这是刻意的：ADR 0114 管的是问题反馈（一个更严、有损的通道），而这里要对齐的是**日志**那一侧，否则跨端语料测试永远对不上。`RedactionPlaceholder` 里那套 `<...>` 只用作**语义标注**（"这个字段是个 token"），不参与正则替换。

会话标题 → `<redacted>`；设备名 → 保留（用户已同意）；邮箱 → `<user>`；真实标识符 → 本地别名 `s1`/`d1`/`p1`（不用哈希：id 空间小，哈希等于一份可字典反推的密文，还会给人"已经匿名了"的错觉）。

## 事件目录（节选：终端那组）

| 事件 | 关键字段 | 它回答什么 |
|---|---|---|
| `term.enter` | 显示模式、密度、格数、行数、贴底、内容高/面板高 | 基线 |
| `term.rows` | `contentSizeHeight` vs `boundsHeight`、`atHistoryFloor` | 手上**有没有可滚的行** |
| `term.scrollTick` | offset、离底距离、贴底、拖动中/减速中、滚动开关、缩放 | 底噪："手指在动而 offset 不动" |
| `term.followGrab` | `trigger`、`offsetBefore/After` | 把**用户拖的**和**我们拽回去的**分开 |
| `term.zoomChanged` | 缩放前后、`isScrollEnabled` 前后、两个 pan 的开关 | 放大后滚动被关掉 |
| `term.selection` | 阶段、锚点、`isScrollEnabled` | 长按进入选字 |
| `term.gesture.outcome` | `didMoveScrollOffset` | 一次拖动**到底有没有让内容移动** |

## 分域落盘

`Library/Caches/SynapseLogs/<lane>/`，`lane ∈ {app, term, net, env, crash, log}`。
域**由事件名的前缀派生**（`DiagnosticEvent.lane`），不是给每个事件手写一个属性 ——
手写允许两个 `net.*` 被分到两路而没有任何机制报错，派生没有这个失败模式，
配一条测试盯住前缀表闭合。

每路一份配额，**总量由各配额之和保证**（≈9.5 MiB），不做跨域驱逐：跨域要从"哪些域
可以让出空间"里选，那既破坏 `plan` 的纯函数性质，又让"哪一路丢了数据"变得不确定。
顺带的收益是 crash 路有自己的额度，不会被输出洪峰轮转掉。

`previousSessionTail()` 只读 app 路 —— 分域之后 net 路几乎总比 app 路新，按修改时间取
全局最新文件会永远看不到 `app.sessionClose`，于是每次正常退出都被记成疑似崩溃。
分域之前留在根目录的旧日志在 `init` 里同步收编进 `app/`（放在 `start()` 之后的话，
升级后第一次启动反而读不到上一次会话）。

## 导出

一个 ZIP：`README.txt` + `manifest.json` + 六个域目录，包内再套一层同名目录。
裁剪**在压缩之前**按原始字节做（单路 512 KiB、合计 2.5 MiB）—— 反过来产物大小就依赖
可压缩性，同一份日志在不同内容下裁掉的量完全不同。有 STORED 兜底与 deflate 的上界，
包的大小是可证的。

`export()` 是 `async` 的：压缩是 CPU 活，从前那版在主线程上 `queue.sync` 拼文件。

## 接口日志

`net.*` 那一组：每一帧下行（kind/from/行数/字节/truncated）、进出站信封、连接生命周期、
重连的**原因**、一次 REST 请求↔响应（路由家族 / 方法 / 状态码 / 时延 / 响应字节）、
以及 intent 与回执的配对。最后那一对的往返时延就是两条相邻记录的时间戳之差，
不必再维护一张"什么时候发的"表。

**REST 只记路由家族，不记原始 path** —— `/mobile/devices/<id>`、`/meetings/<id>/audio-url`
里都嵌着真实标识符。

**请求体一个字节都不进日志**，连长度都不记：`/auth/login` 的体是 `email + password`，
长度就是密码的长度。这句话写在 `APIClient.perform` 里，因为那正是下一个人会顺手加
`.bytes` 的地方。

## 「滚不动」判读表

拿到日志后照这张表读：

| 成因 | 决定性组合 | 修法方向 |
|---|---|---|
| ① 读者挪一两行被拽回 | `followGrab{trigger=contentGrew}` 且 `offsetAfter > offsetBefore`，紧邻 `pinChanged` | **已修**（2026-09-20）：40 点那条余量原本同时量着「内容自己长高」和「读者的手」，现在只有 `isDragging \|\| isDecelerating` 走紧的那一档（`TerminalCollectionView.pinAfterScroll`）。旧构建的日志里这一条仍然是它 |
| ② 放大后滚动被关 | `zoomChanged{isScrollEnabled=F}` → `scrollTick{isScrollEnabled=F}` → `gesture.outcome{didMoveScrollOffset=F}` | 放大态下允许滚动，或让 pan 与滚动共存 |
| ③ 手上没有可滚的行 | `rows{contentSizeHeight<=boundsHeight}`，且 `history.request` 没有配对成 `historyRows>0` 的 `response` | 有配对的空 `response` 就是电脑侧说"没有更早的"；只有请求没有回应才查电脑侧 `history` 意图 |
| ④ 长按进了选字 | `selection{phase=began, isScrollEnabled=F}` → `gesture.outcome{didMoveScrollOffset=F}` | 调整长按阈值/漂移容忍 |

## 测试

| 文件 | 钉住的不变量 |
|---|---|
| `DiagnosticRedactionTests` | 逐条规则 + **canary 回归**（整条记录渲染后不含 canary）+ 别名稳定性 |
| `DiagnosticBufferTests` | 环形上限丢最旧、序号递增、采样、限流、**合并自己写进去的字段不破坏键** |
| `DiagnosticRotationTests` | 恰好到上限/超一字节/空文件/总封顶/活动文件永不删 |
| `DiagnosticFileSinkTests` | **真的落盘真的读回**：记录到达文件、canary 不进文件、轮转保留两侧、删除后仍能继续记、关开关不删已有、崩溃标记、导出可读 |
| `TerminalDiagnosticTests` | **埋点真的被调用到**：驱动 `TerminalCollectionView` 后文件里有 `term.rows`/`term.scrollTick`/`gesture.outcome`/`followGrab` |

最后两套是这套机制的核心保障：前者证明机制能用，后者证明它接上了。

## 已知边界与不做

- **崩溃覆盖不全**（见上），代价已接受。
- **Caches 可能被系统清理**。要留存就当场导出。
- **`PrivacyInfo.xcprivacy` 目前缺失**。加了文件读写与 UserDefaults 之后，App Store 的 required-reason API 声明可能被要求补。**不在本次范围**，发版前单独处理。
- **跨端共享脱敏语料未做**：目前两边是"同规则双实现"，靠 `DiagnosticRedactionTests` 的用例与 `log-store.ts` 对齐。安全规则要求的"共享语料 + 漂移即红"尚未落地，列为后续。
- **不改** `Core/AppLog.swift` 的 12 处调用，不做全局日志重构。
- **不改** `docs/agents/capability-registry.md`：本功能不注册 MCP tool / System App / Dock / Workflow Node / Automation Action / Deep Link，不改 mobile gateway 的 intent 集合，数量不变。
