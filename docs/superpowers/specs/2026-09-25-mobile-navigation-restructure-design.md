# 手机端导航改版

> 2026-09-25。把底栏从四个槽位收敛为三个，并把「消息」从一个位置降级成主页上的覆盖层。
>
> 设计来源是一次独立的设计会话，产出在 `~/Desktop/UI 重构/`（18 屏纯 CSS 原型 + 现状调查 + 设计方案）。原型已收进本仓：`docs/prototypes/2026-09-25-mobile-navigation-restructure.html`。本文是该设计的实现规格，与原型不一致处一律以本文为准。

## 1. 一句话结论

底栏从 **终端 / 录音 / 消息 / 我的** 收敛为 **主页 / 终端 / 我的** 三个位置，**并且从此不再增加**。新增能力一律进入「主页 → 功能」；通知从底栏移到主页右上角的铃铛，用它自己的覆盖面板承载。

```
旧：终端 │ 录音 │ 消息 │ 我的      ← 4 个槽位，已被单点功能占满
新：主页 │ 终端 │ 我的            ← 3 个槽位，永久固定
```

## 2. 为什么改

1. **底栏槽位被单点功能占死。** iOS 的 `TabView` 最多五个、舒适区三到四个。录音和消息各占一格之后，云盘、自动化、内容库、数据库这些桌面端已经存在的能力就没有位置了 —— 要么挤进「我的」，要么再开一格，两种都只会让底栏继续膨胀。
2. **「消息」占着最贵的位置做中转站的活。** 通知的意义是「带你去某个地方」，它本身不是目的地。用户进这一屏不是为了读消息，是为了点进去处理会话或看转写。现状印证了这一点：入口独立，但里面的「待处理」段读的是**实时会话列表**（`Features/Inbox/InboxView.swift:47`），点进去是为了离开它。
3. **「我的」是平铺的杂物间。** 账号、显示密度、已连接的电脑、诊断四段直接铺在一屏，每加一个设置就长一行。

## 3. 三个位置的固定含义

| 位置 | 含义 | 放什么 |
|---|---|---|
| **主页** | 中枢：所有入口，以及「有没有人需要你」 | 功能清单、待处理卡、通知铃铛与面板 |
| **终端** | 工作现场：控制电脑上的会话 | 电脑切换、会话列表、终端画布 |
| **我的** | 配置：账号与本机行为 | 分类列表，点进去才是具体设置 |

关于「终端固定在左侧」这条原始要求：终端排在第二格，但它**永远在同一位置、永远不被折叠进别的入口、一键直达、进入后占满整屏（隐藏底栏）**——这是「固定」的实质。把主页放在第一格，是为了让通知有一个不属于任何业务的常驻落点。

冷启动落主页；从后台恢复保持上次的 tab（`TabView` 的默认行为，不需要额外逻辑）。

### 3.1 硬规则：底栏不新增槽位

**位置是稀缺资源，功能不是。** 新增能力一律进入「主页 → 功能」清单，底栏永远是三格，不因任何理由增加第四个。

这条要写进 `docs/agents/mobile-adaptive-layout.md`，否则下次又会为一个新功能开一格。功能超过十二项左右时，「功能」页需要加搜索框和「常用」置顶——那个阈值现在不必决定，但它是这条规则的下一站，不是推翻它。

## 4. 关键决策

### 4.1 本规格自行决定、且偏离设计稿的四处

这四处是设计稿没有覆盖或给出反例的地方，写在这里以便审查。

| # | 决定 | 理由 |
|---|---|---|
| A | **「新建会话」和「剪贴板历史」在主页栈里不重写成页面**：新建会话仍弹现有 `NewSessionSheet`，剪贴板历史作为主页栈的一页推入 | 原型把它们画成推入的一屏是**纯 CSS 的妥协**——原型不含一行 JS，做不了 sheet。`NewSessionSheet` 内部是一套 `NavigationStack` 加项目 / 供应商 / 模型三层下钻（`Features/Sessions/NewSessionSheet.swift:89,113-120`），拆掉重搭一层导航买不到任何东西。设计稿自己要求「两处打开同一个界面」，弹同一个 sheet 正是这句话。 |
| B | **通知行的「该去哪」解析要抽成共用函数** | 设计稿说「`NotificationRouter` 的 target 解析逻辑可以直接复用」，但 `NotificationRouter` 只有一条 `pending` 队列（`Core/Push/NotificationRouter.swift:31`）；真正的解析住在 `NotificationDetailView` 里（`Features/Inbox/InboxView.swift:295-310`）。而详情页按本设计要取消。所以必须先抽出「这条通知该去哪」，否则面板行和深链要各写一遍。见 §7.5。 |
| C | **待处理卡有多条待处理会话时，点开通知面板的「待处理」段** | 设计稿的箭头是「待处理卡 → 终端 · 那个会话」。只有一条时照办；有多条时直接进其中一条会把另外几条藏起来，而卡片文案会写「N 个会话在等你」，说了 N 只给一个是不诚实的。两条路读的是同一份 `model.waitingSessions`（`App/SynapseAppModel.swift:1126`），面板「待处理」段就是它的完整列表。 |
| D | **`.liveRecording` 深链落主页时同时把「录音列表」推进主页栈** | 原来「先落到录音 tab」的理由是：录音页是 sheet，若背后是一片无关界面，用户退出 sheet 后不知道自己回到了哪（`Features/Root/RootView.swift:260-263`）。落到主页**根**会把这个理由重新引入。落主页 + 推入录音列表，退出 sheet 后人就在录音列表里。 |

### 4.2 用户 2026-09-25 拍板的四项

| 决定 | 内容 |
|---|---|
| 交付范围 | 「我的」七分类**全部落地**，但**不做开源许可**；**版本号同时留在两处** —— 「关于」页新增一行，同时**终端顶栏第二行（`TerminalScreen.swift:1131-1137`）一个字不动** |
| 通知面板形态 | `.sheet` 覆盖面板（不是推入一屏） |
| 底栏未读角标 | **沿用系统 `.badge`（系统红）**，不做琥珀小圆点。见下 |
| 剪贴板历史 | 从终端挪进主页「功能」 |

**关于角标颜色这条要记清楚，因为它推翻设计稿的一个主张。** 设计稿要的是琥珀小圆点，理由是「全应用只有一个『有人需要你』的颜色」。SwiftUI 的 `TabView` 没有自定义 tab 角标颜色或叠加小圆点的 API；要改色只能桥接 `UITabBarItem` 外观，而那只在 iPhone 底栏生效，iPadOS 侧边栏的角标仍走系统色——两端会不一致。用户选择接受现状：底栏走系统 `.badge(未读数)`。

于是未读数在本改版后有**两种呈现、同一个红**：

- 主页内的**铃铛角标**：自绘，`Color(uiColor: .systemRed)` 配白字
- 底栏**主页 tab 上的未读数**：系统 `.badge`，系统红

**2026-09-25 复看真机截图后改判：铃铛角标也用系统红，不再用琥珀。** 底栏那一格的颜色是系统画的、改不了，而两处读的是同一个数字——一个红一个琥珀会被读成两套计数。改正之后，「未读」在本应用里只有一种颜色：系统红。

`Theme.attention`（琥珀）的契约（`DesignSystem/Theme.swift:31-42`）因此收窄回它本来的那一个含义：**有人在等你回话**。会话行的「等待输入」徽章、主页的待处理卡继续用它，它们说的都是这件事，与「有未读」无关。

### 4.3 其余沿用设计稿的决策

- **通知详情页取消。** 正文进到行里显示（`NotificationRow` 已经在做），通知的价值在「带你去哪」。`NotificationDetailView` 删除。
- **通知面板的行点击 = 标记已读 + 关闭面板 + 去往目标**，比「消息 tab → 列表 → 详情 → 再跳转」少两步。
- **常驻性由三处承担**：主页右上角常驻铃铛、底栏主页 tab 上的未读数、已有的系统推送与 App 图标角标。注意终端会话页会隐藏底栏（`TerminalScreen.swift:600`），所以终端里看不见底栏角标——这与现状一致，会话行上的琥珀「等待输入」徽章承担那里的提示。
- **「我的」外层只放分类，值放二级页。** 例外只有两行：账号（显示邮箱）、电脑（显示当前电脑名 + 在线圆点）。这两个值是「你现在处在什么状态」，不是「一个可以调的设置」。
  - **注意：设计稿原型的「昵称」在代码里不存在。** `SynapseAppModel` 只有 `email`（`App/SynapseAppModel.swift:20`），没有昵称字段。账号行右侧显示邮箱。
- **功能是目录，终端页上保留同一件事的快捷方式。** 「新建会话」既列在功能里，也保留终端列表右上角原有的 ＋；剪贴板历史则**只**保留功能里那一处（挪走就是挪走）。
- **主页的待处理卡只在真有会话卡住时出现**，没有内容就不占位置。它与终端会话行上的琥珀徽章是同一份数据（`waitingSessions`），不引入第二套状态。

## 5. 新结构全图

```
主页
 ├─ 待处理卡（仅当 model.waitingSessions 非空）
 ├─ 右上角铃铛（带未读数）──────────→ 通知面板（sheet）
 │                                       待处理 / 未读 / 全部 + 全部已读
 └─ 功能
     ├─ 录音 ──────────────────────→ 推入 录音列表 → 录音详情
     ├─ 新建会话 ───────────────────→ 弹出 NewSessionSheet
     └─ 剪贴板历史 ─────────────────→ 推入 剪贴板历史

终端
 └─ 当前电脑 → 会话列表 → 终端画布（进入后隐藏底栏）

我的（分类列表 → 二级页 → 三级页）
 ├─ 账号 │ 电脑
 ├─ 终端 │ 录音 │ 通知
 └─ 诊断 → 诊断日志
     │ 关于
```

## 6. 逐屏规格

### 6.1 主页

结构自下而上：

1. **大标题「主页」**。只出现一次，放在内容顶部（原型第 2 号 bug 的结论：纯 CSS 做不到「滚动时大标题收进导航栏」，所以只画一次；SwiftUI 用系统 `.navigationTitle` 就有真行为，不需要照抄这个妥协）。
2. **待处理卡**（`model.waitingSessions` 非空时）。琥珀底色（`Theme.attentionFill`）、标题「N 个会话在等你」、副标题「终端有输出，需要你回复」、右侧箭头。点击行为见 §4.1 C。
3. **「功能」分组**，三行：

| 行 | 副标题 | 右侧值 | 点击 | 可用性 |
|---|---|---|---|---|
| 录音 | 会议录音、转写与回听 | 录音条数（`model.meetings.meetings.count`，为 0 时不显示值） | 推入录音列表 | 恒可用 |
| 新建会话 | 在当前电脑上开一个终端 | — | 弹出 `NewSessionSheet` | 与终端页 ＋ 同一判据：`selectedDesktopClientInstanceId == nil \|\| viewedDesktopIsOffline` 时置灰（`Features/Sessions/SessionListView.swift:79-89`） |
| 剪贴板历史 | 这台电脑上复制过的内容 | — | 推入剪贴板历史 | 恒可用 |

**不做「即将支持」分组。** 原型里那组（云盘 / 自动化 / 内容库 / 数据库）是为了展示结构在功能变多后长什么样，不是假装已经能用。真实实现时这一组不存在，直到对应能力上线。

功能清单**暂不分组**（记录 / 工具 / 数据…）——现在只有三项可放，过早分组是空的。

### 6.2 通知面板

`.sheet` 承载，形态照现有 `InboxView` 的内容：

- 顶部分段：**待处理 / 未读 / 全部**，默认落「待处理」（与现状一致，`InboxView.swift:18`）。
- 右上角「全部已读」，未读为 0 时置灰。
- 行：标题、正文（最多两行）、时间、未读点。正文进到行里，这是取消详情页的代价与收获。
- 行点击：`readNotification(id)` → `dismiss()` → 按 §7.5 解析出的 target 路由。target 无法解析（普通通知、无 `targetId`、或只有一条外部 HTTPS 链接）→ 不 dismiss，留给用户自己读。
- 左滑删除，系统红（`InboxView.swift:139` 的既有做法）。
- 「加载更多」按钮与分页照旧。
- sheet 里**必须再挂一次 `.noticeOverlay(model)`**：`noticeOverlay` 是显式传 model 的修饰符（`Features/Root/NoticeBar.swift:193`），每个屏幕各自挂一条，sheet 会盖住底层那条。现有剪贴板 sheet 就是这么做的（`SessionListView.swift:331`）。
- 呈现 detents：`.medium` 与 `.large`。

### 6.3 主页导航栈

`NavigationStack(path: $homePath)`，`HomeRoute` 两个落点：

```swift
enum HomeRoute: Hashable { case recordings, clipboard }
```

| 落点 | 内容 | iPadOS 宽窗行为 |
|---|---|---|
| `.recordings` | `AdaptiveFeatureNavigation(selection: $meetingSelection)`，sidebar 是 `MeetingListView(selection:)`，detail 是 `MeetingDetailView(meetingId:onDeleted:)` | 推入后列表与详情并排（`AdaptiveFeatureNavigation` 自带 `NavigationSplitView`） |
| `.clipboard` | `ClipboardList(entries:title:onCopy:onClear:)`，`title` 传 `nil` 让它把 toolbar 并进调用方导航栏，外层设 `.navigationTitle("剪贴板历史")` | 单栏页 |

复用关系：

- **录音列表 / 详情一行不改**，直接用现有 `MeetingListView` / `MeetingDetailView`（`Features/Meeting/MeetingListView.swift:7-9`、`MeetingDetailView.swift:9-12`）。`MeetingListView` 自带右上角 ＋（`model.isRecordingPresented = true`）和它自己的录音 sheet，照样工作。
- **剪贴板历史**用现有 `ClipboardList`，数据走现有的 `model.activeClipboardEntries` / `copyClipboardEntry` / `clearClipboardHistory(for:)`（`App/SynapseAppModel.swift:1482,1487,1497`）。它内部自己弹出预览 sheet（`ClipboardList.swift:81-85`），不用动。
  - **入口条件放宽了**：终端页那个剪贴板按钮只在有电脑在线时才存在（它挂在设备行上，`SessionListView.swift:314`）；主页功能里这一行**恒在**。无电脑或离线时照常进入，列表显示既有空态「还没有可粘贴的内容」。剪贴板历史是本机落盘的，离线读得到（`Features/Terminal/ClipboardHistoryStore.swift:28-33`），不新增离线专用文案。
  - **它仍然按电脑分桶**，切电脑就是切列表。这一页不显示电脑选择器，所以列表头上要有当前电脑的名字——它是读者唯一能看出「现在读的是哪一台的」的地方。为此给 `ClipboardList` 加一个可选的 `desktopName`，非空时渲染成 `Section` 的表头；终端快捷面板那一份传 `nil`（面板本来就在某台电脑的一个会话里），渲染不变。
  - **不给页面加解释性文案。** 不写「按电脑分开保存」这类说明实现的话——切换电脑时列表跟着换，这件事本身已经说了它属于哪一台。
- 嵌套深度：`主页 → 录音列表 → 录音详情` 三层，与 `docs/agents/mobile-adaptive-layout.md` 的三层目标一致。

**iPadOS 上不要为此再叠一个 `NavigationSplitView`。** 主页栈里推入的 `AdaptiveFeatureNavigation` 已经是 `NavigationSplitView`；外层再套一个会让系统侧边栏、列表、详情变成三列而详情挤没。

> 待验证：`NavigationSplitView` 嵌在 `NavigationStack` 的推入目标里，在 iPadOS 宽窗下的分栏行为需要真机 / 模拟器实测（见 §10）。若分栏不成立，回退方案是让主页栈在 regular 宽度下用一个只做推入的 `NavigationStack`，把并排交给上层的系统侧边栏——即牺牲「录音列表与详情并排」，见 §10.3。

### 6.4 终端

**除以下两点外全部不动：**

1. `Tab` 枚举里它从第一格变成第二格，默认选中值从 `.terminals` 改 `.home`。
2. 剪贴板按钮从设备行上移除（`SessionListView.swift:365-381` 的 `clipboardButton` 及 `:317-332` 的 sheet 一并删除）。设备行回到「设备名 + 状态 + 切换菜单」。

**终端画布、键盘、语音输入、网格上报、`moreMenu`、会话页隐藏底栏的逻辑一律不碰。** 顶栏第二行的版本号也**保留不动**（用户明确要求，见 §4.2）。

### 6.5 我的

七个分类，外层是分类列表（图标 + 名称 + 右侧值 + 箭头），点进去才是二级页；诊断下面还有第三层日志页。

| 分类 | 图标 | 外层右侧值 | 二级页内容 |
|---|---|---|---|
| 账号 | `person.crop.circle` | 邮箱 | 邮箱（只读）；退出登录（破坏性，二次确认） |
| 电脑 | `desktopcomputer` | 当前电脑名 + 在线圆点 | 已连接的电脑列表（单选当前、在线 / 离线），点一行切电脑 |
| 终端 | `terminal` | — | 显示密度（紧凑 / 正常 / 稀疏，分段选择器） |
| 录音 | `waveform` | 麦克风权限状态 | 麦克风权限行；未请求时点击触发 `MeetingPermission.requestMicrophone()`，已拒绝时点击跳系统设置；一段说明「录音与转写都在服务端处理，不依赖任何一台电脑」 |
| 通知 | `bell` | 「N 条未读」（无未读时不显示值） | 系统通知权限行（同上模式）；「通知中心」行 → 打开 §6.2 的面板；「图标角标」开关 |
| 诊断 | `waveform.path.ecg` | — | 记录诊断日志开关 → 诊断日志页（记录终端屏幕内容、时间范围、占用、导出、删除全部） |
| 关于 | `info.circle` | 版本号 | 版本与构建号（`AppVersion.label`）；问题反馈 → 三级页 |

**iPhone 也要变成分类列表 → 下钻。** 这是本改版对「我的」的实质改动：现在 iPhone 走的是 `AdaptiveSettingsView` 的 compact 分支，直接把**全部设置段平铺**在一屏（`Features/Settings/AdaptiveSettingsView.swift:33-36`）；新结构下 iPhone 与 iPadOS 走同一条路径。

落地方式：`AdaptiveSettingsView` 去掉 compact 特判，两种情况都用 `AdaptiveFeatureNavigation` —— 它在紧凑窗口自动折叠成单列下钻，在宽窗并排。分类列表需要自定义行（因为要显示值），不能再用 `List(SettingsCategory.allCases, selection:)` 配 `NavigationLink` 的默认 Label 行。

**顺序**：`account, desktops, terminal, recording, notifications, diagnostics, about`（枚举顺序即显示顺序）。设计稿的外层分三张卡片（账号·电脑 / 终端·录音·通知 / 诊断·关于），在 iPhone 用 `List` 的 `Section` 表达；在 iPadOS 侧边栏是一列平铺，分组不表达。

新增的三个分类各有代价与用处：终端与录音眼下各只有一项设置。这是分类结构的代价，也是它的用处——这两个分类将来会长出东西，现在先把位置留好。若觉得「显示密度」不值得多点一次，把它提回外层一行即可，其余分类不受影响。

#### 6.5.1 两个权限行的形态

两行同构：左侧名称、右侧状态文字（已允许 / 已拒绝 / 未请求），点按的行为按状态分：

- `.undetermined` → 触发请求，系统弹框
- `.denied` → `UIApplication.openSettingsURLString` 跳系统设置（既有先例：`Features/Terminal/TerminalMessageList.swift:52`）
- `.granted` → 无动作

系统通知权限来自 `UNUserNotificationCenter.current().notificationSettings()`；麦克风权限来自 `MeetingPermission.microphone`（`Features/Meeting/MeetingPermission.swift`）。应用从后台回到前台要重新读一次（用户可能在系统设置里改过）。

#### 6.5.2 图标角标开关

新增一个持久化偏好，默认开（`@AppStorage`）。关闭时把 App 图标角标置 0 并停止跟随未读数。

现状是 `RootView` 直接跟随 `model.notifications.unreadCount` 写角标（`Features/Root/RootView.swift:106-115`）。改为读该偏好决定写未读数还是 0，并在偏好变化时立即生效。

不新增「通知中心」的第三条通道：这个开关**只**管 App 图标角标，不管底栏未读数、不管 `Theme.attention` 的自绘角标。

#### 6.5.3 关于 → 问题反馈

三级页，一个多行输入框 + 提交按钮。

- **接口**：`POST /api/problem-feedback`，请求体 `{ "content": string }`，**无鉴权**、按 IP 限流（桶容量 3 / 10 分钟，全局 30 / 60 秒）。相对 `AppConfiguration.apiBaseURL` 的路径是 `/problem-feedback`。`APIClient` 的 `send(path:method:body:authenticated:)` 已支持 `authenticated: false`（`Core/Networking/APIClient.swift:672-686`）。
- **不做客户端隐私预校验。** 桌面端在提交前会本地跑一遍 `validateProblemFeedbackInput`（`@synapse/shared` 里的 TypeScript，约 100 行正则，覆盖密钥、绝对路径、身份信息、用户内容、不安全 URL、时间戳六类，`shared/src/problem-feedback.ts`）。把它逐条移植到 Swift 等于手抄一百行正则，两边必然漂移，而服务端**本来就会再校验一次**。所以移动端只做「提交 → 按服务端返回的 code 显示文案」。
- **提交前 trim 首尾空白。** 服务端要求 `content === content.trim()`（`shared/src/problem-feedback.ts:153-155`），而从多行输入框取出的文本很容易带一个尾随换行。不 trim 就会把用户拒在一个他看不出问题的错误上。trim 后为空则本地直接置灰提交按钮。
- **文案照抄桌面端**，不另写一套（`desktop/app-capabilities/problem-feedback/main/dispatcher.ts:10-16`）：

| 情况 | 文案 |
|---|---|
| 成功 | 问题反馈已提交 |
| 400 `INVALID_INPUT` | 问题反馈内容不符合提交要求。 |
| 422 `PRIVACY_RISK` | 问题反馈包含不允许提交的隐私风险。 |
| 429 `RATE_LIMITED` | 问题反馈提交过于频繁。 |
| 503 `SUBMISSION_FAILED` | 问题反馈未提交。 |
| 连接中断 / 超时 / 响应无法解析 | 问题反馈提交结果未知，内容可能已经提交。 |

- **`PRIVACY_RISK` 的类别名不能直接给用户看。** 服务端返回的 `data.category` 是六个英文枚举之一（`authentication_secret` / `local_path` / `identity` / `user_content` / `unsafe_url` / `correlation_identifier`）。按桌面端 Skill 约定的「只说明稳定风险类别，不复述命中内容」，映射成一句中文说明；未知类别回落成上表那句通用文案。
- 成功文案**不承诺查看、回复或处理**（照 `desktop/app-capabilities/synapse-skill/skill-package/app/index.md:219`）。

## 7. 技术落地

### 7.1 Tab 枚举与底栏

`Features/Root/RootView.swift`：

```swift
private enum Tab: Hashable { case home, terminals, settings }
```

- `selectedTab` 初值 `.terminals` → `.home`（`RootView.swift:10`）。
- 三个 `.tag`：`.home` / `.terminals` / `.settings`（`RootView.swift:183,195,213,219` 收敛成三条）。
- 底栏三格：主页 / 终端 / 我的。终端与我的的 `.tabItem` 原样保留；主页是新的。
- `.badge(model.notifications.unreadCount)` 从「消息」那一格挪到「主页」那一格（`RootView.swift:212`）。
- `.tabViewStyle(.sidebarAdaptable)` 不变（`RootView.swift:221`）。

`Tab` 是 `RootView` 的私有枚举，全部引用都在这一个文件里，没有外部消费者。

### 7.2 主页导航栈

新增 `Features/Home/` 模块，放主页本身与剪贴板历史页。`RootView` 持有 `homePath: [HomeRoute]` 与既有的 `meetingSelection`，把 `meetingSelection` 交给主页栈（它原本属于录音 tab）。

`popToRoot(.home)`：清空 `homePath` 与 `meetingSelection`。

### 7.3 深链路由

`handleRoute`（`RootView.swift:225-274`）与 `popToRoot`（`:156-167`）整体改写。旧 → 新对照：

| 深链 | 旧落点 | 新落点 |
|---|---|---|
| `.terminal(sessionId, desktopId)` | `selectedTab = .terminals` + `requestTerminal` | **不变**（只是不再有 `.inbox` 兜底） |
| `.meeting(meetingId)` | `selectedTab = .meetings`；`meetingSelection = id` | `selectedTab = .home`；`homePath = [.recordings]`；`meetingSelection = id` |
| `.message(id)` | `selectedTab = .inbox`；`reloadNotifications()` 后 `inboxSelection = id` | `reloadNotifications()` → 按 §7.5 解析该条的 target → 有 target 走该 target 的落点；无 target 打开通知面板。两种都先 `readNotification(id)` |
| `.newRecording` | `selectedTab = .meetings`；`meetingSelection = nil`；浮出录音页 | `selectedTab = .home`；`homePath = [.recordings]`；`meetingSelection = nil`；浮出录音页 |
| `.liveRecording` | `selectedTab = .meetings`；`meetingSelection = nil`；在录时浮出录音页 | `selectedTab = .home`；`homePath = [.recordings]`；在录时浮出录音页（见 §4.1 D） |
| Widget `synapse://terminal?…` | `selectedTab = .terminals` + 判据 | **不变** |
| `synapse://recording` | `.liveRecording` | 经 `.liveRecording`，落点同上 |

`.message(id)` 的分支要注意异步：`reloadNotifications()` 之后才知道那条通知有没有 target，而用户可能已经自己走开了。照现有写法保留「先落位置、再异步填内容」的次序（`RootView.swift:248-253` 就是这么做的）。

`docs/agents/mobile-adaptive-layout.md:9`「通知、Widget 与其他深链要设置功能、电脑和条目三层目标」继续有效，只是「功能」的含义从底栏 tab 变成主页栈里的位置。

### 7.4 登录退出

`RootView.swift:81-93` 的清理加两项：`homePath = []`，以及关闭通知面板与录音页。`selectedTab` 回到 `.home`（原为 `.terminals`）。

### 7.5 通知 target 解析的抽取

把 `NotificationDetailView` 里那段判断（`Features/Inbox/InboxView.swift:295-310`）抽成一个纯函数，输入一条 `SynapseNotification`，输出 `NotificationRouter.Destination?`：

| 条件 | 结果 |
|---|---|
| `source` 是 `terminal-attention` / `terminal-complete`，且有 `targetId` | `.terminal(sessionId: targetId, desktopClientInstanceId: deviceId ?? "")` |
| `source` 是 `meeting-transcription`，且有 `targetId` | `.meeting(meetingId: targetId)` |
| 有 `url` 且 scheme 是 `https` | 外部链接，**不是** `Destination`——面板行直接 `openURL`，不走路由 |
| 其余 | `nil`（普通通知） |

三个消费者共用它：通知面板的行、`.message(id)` 深链、以及将来任何新入口。

### 7.6 通知面板对 `InboxView` 的改造

`InboxView` 从「分栏里的列表」改为「sheet 里的面板」，改动集中在三处：

1. **去掉选中与详情导航**。`@Binding var selection` 与 `NavigationLink(value: item.id)`（`InboxView.swift:16,122`）删掉。列表行变 `Button`，行为见 §6.2。
2. **删掉 `NotificationDetailView`**，以及 `RootView` 里它作为 detail 的那处装配（`RootView.swift:208-210`）。
3. **`.navigationTitle("消息")` 去掉**（`InboxView.swift:81`）——面板有自己的标题，不叫「消息」。`NotificationDetailView` 那处 `.navigationTitle("消息")`（`:320`）随文件一起消失。

`onOpenTerminal` 回调的语义变了：原来是「切到终端 tab 并打开会话」，现在是「关闭面板、切到终端、打开会话」——多一点是 dismiss。它仍要经过 `requestTerminal` 那道闸门（待处理行取自列表，可能在画行与落指之间结束掉，`RootView.swift:203-207` 的原有理由成立）。

### 7.7 iPadOS

- `TabView(.sidebarAdaptable)` 不变，三个 tab 在侧边栏就是三项。
- 「我的」宽窗用分类列表 + 右侧内容，即 `AdaptiveFeatureNavigation` 的既有形态；本改版把它从「只有宽窗用」推广到两种情况都用（§6.5）。
- 主页栈里推入的 `AdaptiveFeatureNavigation` 提供录音的并排分栏（§6.3），不要再叠分栏。
- 除「我的」以外，不因为改成三个 tab 而调整任何栏宽或折叠顺序。

### 7.8 角标

底栏用系统 `.badge`，颜色不改（§4.2）。App 图标角标受 §6.5.2 的开关控制。自绘的角标只出现在主页铃铛上，与底栏同色（系统红 + 白字）。

它挑在铃铛框的右上角外面，所以那一层**不能被裁剪**：`HomeView` 的 `bell` 及其外层的工具栏按钮都不要加 `clipShape`。

## 8. 明确不做

- 不改终端的画布、键盘、语音输入与网格上报逻辑。
- 不改录音的会话生命周期，也不增加纪要、发言人等已取消的产品层级。
- 不改主机名、权限模型与任何服务端协议。
- **不改终端顶栏第二行的版本号显示**（用户明确要求保留）。
- 不做「即将支持」那一组，也不做「功能」清单的分组。
- 不做开源许可页。
- 不做底栏的琥珀小圆点，不桥接 `UITabBarItem` 外观。
- 不新增任何 iOS 深链路由（`docs/agents/capability-registry.md` 的 iOS 路由计数保持 2）。
- 不新增多窗口 / 第二个 `WindowGroup`。

## 9. 需要同步更新的文档

| 文件 | 改什么 |
|---|---|
| `docs/agents/mobile-adaptive-layout.md:7` | 「顶层『终端 / 录音 / 消息 / 我的』」→ 三格；并补 §3.1 的硬规则 |
| `docs/agents/mobile-adaptive-layout.md:28` | 「『我的』在 iPhone 保持现有分组列表」→ iPhone 也是分类列表下钻 |
| `docs/agents/capability-registry.md:22` | 「iOS『消息』Tab」→ 主页的铃铛与通知面板 |
| `docs/superpowers/specs/2026-09-23-account-notification-center-design.md:5,13` | 「iOS『消息』Tab」→ 通知面板；「普通点按先按消息 ID 打开详情」→ 直接去往 target |
| `SynapseMobile/README.md:5` | 顶层导航那句话；并补一小节写清三个位置与「不再增加」 |
| `AGENTS.md:70` | 「录音、消息和终端的现有业务状态」→ 通知取代消息 |
| `RELEASE_NOTES_PENDING.md` | 底栏结构变化属用户可感知变化，必须记录 |
| `docs/prototypes/2026-09-25-mobile-navigation-restructure.html` | 新增，从 `~/Desktop/UI 重构/原型.html` 收入 |

`capability-registry.md:26` 的 iOS 两条路由说明**不改**（没有新增路由）。

## 10. 测试与验收

### 10.1 必须修的既有测试

`SynapseMobileUITests` 里没有断言 tab 数量，但**有一批按索引点 tab 的写法**，三格之后索引全错，而且错得无声无息（`boundBy: 0` 从「终端」变成「主页」）：

| 位置 | 现在点的 | 三格后实际点的 |
|---|---|---|
| `SynapseMobileUITests/TerminalFlowUITests.swift:71` | 索引 2 = 消息 | 我的 |
| `SynapseMobileUITests/TerminalFlowUITests.swift:79` | 索引 0 = 终端 | 主页 |
| `SynapseMobileUITests/TerminalFlowUITests.swift:198` | 索引 3 = 我的 | 越界 |
| `SynapseMobileUITests/TerminalGitUITests.swift:357` | 索引 0 = 终端 | 主页 |

**修正索引，但不要改成按标签查找。** `TerminalFlowUITests.swift:63-69` 那条注释写明了这里为什么用索引：「a badge rewrites the accessibility label of the tab it sits on」——底栏主页那一格从此就带着未读数角标，用 `buttons["主页"]` 去找会随未读数变化而时灵时不灵。索引留着，数字改正，并抽成有名字的常量（`home = 0` / `terminals = 1` / `settings = 2`），免得下一次移动 tab 又要逐个改数字。那段过时的顺序注释同时改正。

### 10.2 要补的行为验证

1. **深链五条各走一遍**：`.terminal` / `.meeting` / `.message`（有 target 与无 target 两种）/ `.newRecording` / `.liveRecording`。`.message` 是改动最大的一条。
2. **待处理卡两种条数**：1 条直接进会话；多条落面板「待处理」段。
3. **通知面板**：行点击后确实 dismiss 且落到了目标；「全部已读」后底栏角标与铃铛角标同时消失；左滑删除。
4. **主页栈三层**：主页 → 录音列表 → 录音详情 → 逐级返回，`meetingSelection` 在返回时清空。
5. **重按主页 tab** 回到主页根，并清掉 `homePath` 与 `meetingSelection`。
6. **登录退出**：清空后落主页，且主页栈、通知面板、录音页都不残留。
7. **我的七分类**：iPhone 与 iPadOS 都能进每个二级页；权限行三种状态各试一次；图标角标开关关闭后重启 App 角标仍为 0。
8. **新建会话置灰**：无电脑、以及选了离线电脑时，主页那一行与终端 ＋ 同时置灰。
9. **剪贴板历史**：无电脑时能进入并看到空态；切电脑后列表跟着换。
10. **窗口自适应**：iPhone 竖 / 横、iPadOS 全屏横 / 竖、半窗、最窄窗口都要走一遍，确认 `AdaptiveFeatureNavigation` 的折叠与选择保持没有被 `NavigationStack` 嵌套破坏。

### 10.3 必须实测、可能推翻设计的一处

**`NavigationSplitView` 嵌在 `NavigationStack` 的推入目标里，在 iPadOS 宽窗下会不会给出正确的并排分栏。** 这是 §6.3 唯一没有把握的地方。

- 成立 → 照 §6.3 实现。
- 不成立 → 回退：主页栈在 regular 宽度下推入 `MeetingListView` 与 `MeetingDetailView` 的**推入式**组合（不用 `AdaptiveFeatureNavigation`），牺牲录音的并排分栏，换取不出现三列挤压。
- 判定要在模拟器上量实际列宽，不接受「看起来还行」。

另外两处同样只在真渲染下才暴露，一并实测：

- 通知面板 sheet 在 `.medium` detent 下的分段控件与列表滚动行为。
- 「我的」在 iPhone 从平铺改为下钻后，`AdaptiveFeatureNavigation` 的返回手势与导航栏标题是否正常。

### 10.4 环境

- 生产代码禁止 `console.log` 对应的 Swift 侧纪律不变：不新增裸 `print`。
- 验证用模拟器构建与既有 UI 测试命令（`SynapseMobile/README.md` 的「开发」与「端到端测试」两节），**不启动用户正在用的桌面应用**。

## 11. 风险

| 风险 | 说明 | 应对 |
|---|---|---|
| iPadOS 三层嵌套分栏 | §10.3 | 实测，不成立就回退 |
| 用户肌肉记忆 | 底栏第一格从「终端」变成「主页」，且终端页不再默认落点 | 冷启动落主页是设计选择；`RELEASE_NOTES_PENDING.md` 要说清楚 |
| 通知常驻性变弱 | 底栏角标虽在，但终端页隐藏底栏 | 主页铃铛 + 系统推送 + 图标角标三处兜住；会话行琥珀徽章在终端内继续工作 |
| 首次登录的落点 | 现在登录后落终端，改版后落主页 | 登录成功后的行为照 `selectedTab` 初值，即主页 |
| 「我的」七分类里两项只有一行设置 | 终端（显示密度）、录音（麦克风权限） | 设计稿已论证这是给将来留位置；若用户不认，把「显示密度」提回外层即可 |

## 12. 设计来源与原型

- 原型（18 屏，纯 CSS，无 JS）：`docs/prototypes/2026-09-25-mobile-navigation-restructure.html`
- 设计会话的完整产出（现状调查、设计方案、原型生成器、18 张截图）留在 `~/Desktop/UI 重构/`，不进本仓。
- 原型的「说明」页 ≈ 设计方案的正文；本文吸收了它，并补上原型页里没有的测试记录与本次的四项拍板。
- 原型本身的两个已知坑（纯 CSS 导航的同优先级 `display` 覆盖、`inline-flex` 容器里 `.val` 的 `max-width` 塌陷）只对生成器有意义，与 Swift 实现无关，不在此展开。
