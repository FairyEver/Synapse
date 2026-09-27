# iPhone 与 iPadOS 自适应界面规则

本规则适用于 `SynapseMobile/SynapseMobile/` 的新页面和现有页面修改。最低系统版本见 Xcode 工程配置。历史移动端专题设计中的「iPad 不在本次范围」只描述当时的交付，不覆盖本规则；业务协议、权限、终端尺寸归属、录音和诊断隐私等原有不变量继续有效。

## 导航结构

- 顶层「主页 / 终端 / 我的」使用系统 `TabView` 的自适应呈现：iPhone 为底部标签，iPadOS 可显示顶部标签或侧边栏。不要自行画一套与系统并行的全局导航。
- **底栏永远三格，不因任何理由增加第四个。** 新增能力一律进「主页 → 功能」清单：位置是稀缺资源，功能不是。功能超过十二项左右时给「功能」加搜索与「常用」置顶，而不是开新槽位。
- 有「列表 → 详情」的功能以 `Features/Root/AdaptiveFeatureNavigation.swift` 为入口，使用同一份选中 ID 驱动宽窗口并排详情和紧凑窗口下钻。列表用 `List(selection:)` 与 `NavigationLink(value:)`，右侧详情只显示当前选中对象。宽窗不推走列表，窄窗必须有明确返回路径。
- 自带 `AdaptiveFeatureNavigation` 的功能页（当前是主页里的录音与云盘）是**它所在那一格的一页**，不推入任何 `NavigationStack`：分栏自己带一条导航栏，推进栈里屏幕上会出现两条栏——上面那条只剩系统的返回键，标题和操作落在下面那条，中间空出一条标题带，宽窗的并排详情也一并消失（iPhone 与 iPadOS 都是这个形状）。返回上一级由该页自己的一枚返回键承担，落在列表那一条栏上，和它的操作同一行。**云盘那一屏的顶栏前缘则永远只有一枚返回键**（2026-09-27 定）：根层是这一屏自己那枚（回主页，形状取 `chevron.left`、文案「主页」，与录音页那一枚逐字相同），往里下钻之后换成系统那枚（回上一个文件夹），自己那枚同时消失 —— 两枚并肩时它们都叫「往回走」而一个回上一层、一个把整屏掀掉，从图标上分不出哪个是哪个（改动前正是「根层一枚 `house`；深层 `chevron` + `house` 两枚」）。**「快速回主页」归底栏那一格「主页」**，它任何一层都在，不再由顶栏承担。验收驱动 `DriveAcceptanceUITests.test14` 钉的就是这条。云盘那一屏自己带一条 `NavigationStack`（文件夹逐层下钻；文件不在这一屏里画，站内预览交给 App 内 WebKit 浏览器打开），同样整格摆出来；它的下钻、回收站、公开素材与分享管理都在它自己那条栈上，与主页的栈无关。**这一屏 2026-09-26 起不再有分栏** —— 详情那一栏随「文件预览改走独立浏览器页面」一起去掉，原来那条「宽窗下要把列显式摆成 `.doubleColumn`，否则 `.automatic` 会把浏览列收起来、只剩详情列那块占位」随之作废。**列里读到的 `horizontalSizeClass` 是列自己的、不是窗口的**（iPad 全屏下全屏宽度仍是 `compact`），判窗口宽窄要用窗口那一层的值往下传。宽窗下**云盘那四条**列表 **不许挂 `.refreshable`**（浏览层、回收站、公开素材、分享管理，代码上走 `refreshableIfCompact`）；它们 2026-09-26 起不再住在分栏的列里（这一屏没有分栏了），这条门禁**照旧保留** —— 触发条件当初就没定死，「换了个容器就不会崩」是一条没量过的形状。要撤它，先照 `DriveAcceptanceUITests` 那一趟在 iPad 全屏下实测「从云盘换回主页」。同一个坑本身是：整格换页时那条下拉刷新的拆解会和辅助功能对导航栏的查询撞在一起，`AttributeGraph` 断言失败、App 直接 `SIGABRT`（堆栈落在 `ListRepresentable.dismantleViewProvider` → `UIScrollView _setRefreshControl:` → `UINavigationBar layoutSubviews` → `_UIHostingView.accessibilityElementCount`）。2026-09-25 在 iPad Pro 13 英寸全屏宽度下实测：只在辅助功能正查控件树时出现（XCUITest 与 VoiceOver 都算）；**触发条件没有定死** —— 给换页配 `.transition`（6 种组合 6/6 崩）、完全不给动画（2/2 崩）、把换页推迟一帧（3/3 崩）都排除在外，而形状一样的「从回收站那一屏退回主页」（那一条 `List` 也挂着下拉刷新）没崩，所以四条列表按同一条规则办，不赌哪几条安全。逐种改法的记录在 `SynapseMobile/SynapseMobileUITests/DriveAcceptanceUITests.swift` 的头注释里，守卫本身在 `Features/Drive/DriveBrowserList.swift`。**同形状的还有两条列表，本轮没有动它们**（本任务范围只有云盘那一屏）：`Features/Meeting/MeetingListView.swift`（录音列表）与 `Features/Sessions/SessionListView.swift`（会话列表）都在分栏列里、都挂着裸 `.refreshable`；2026-09-25 在同一台 iPad Pro 13 英寸全屏下照同一趟实测「从录音退回主页」三趟，一次没崩（`AttributeGraph` / `SIGABRT` 计数为 0，也没有新的崩溃报告），而云盘那四条在同样环境下是稳定崩 —— 形状本身不是判据，这就是「触发条件没有定死」的意思。要动这两条列表，先照这一趟实测，别按形状推断（那一趟的驱动方式：主页那行 `home-feature-录音` → 系统侧栏开关 → 页内那枚 `recordings-back-home`，来回三趟，盯 `AttributeGraph` 断言与 `SIGABRT`）。**云盘那四屏的列表是一整块 `List`：**大标题下面那行「N 项 · 按名称升序」与面包屑跟列表在同一个滚动视图里，**外面不许再套 `VStack` 把列表往下推**——套了的话那行字不跟列表滚、收起大标题时还会和标题叠在一起。**2026-09-27 起这四屏（浏览 / 回收站 / 公开素材 / 分享管理）不再用 `.insetGrouped`，改走 `Features/Drive/DriveBrowserList.swift` 里的 `driveListSurface()`：`.plain` + `.scrollContentBackground(.hidden)` + 系统背景色。** 这是系统「文件」App 的摆法 —— 内容直接落在容器的底上，中间没有那张白卡；行另有 `driveListRow()`（左右 16、上下 6），分隔线由系统对齐到文字那一列（2026-09-27 在 iPhone 17 上按像素量过：四屏的分隔线都起在 `x = 62pt`、收在 `385.7pt`，屏宽 402pt），四屏因此是同一套间距。底色与导航栏同色（浅色下都是白、深色下都是黑），2026-09-26 那次「列表上方那一条带子落回白底」的现象不再出现，但**不套 `VStack` 这条照旧**（理由回到滚动与标题）。同一屏的网格一格也不再只有一枚图标与一行名字：`subheadline` 的名字（两行）、`footnote` 的修改时间与大小逐行居中，与「文件」App 那一格同一套排法；尺寸在 `DriveGridMetrics`，图标是 `DriveFileIcon`（一页浅灰的纸 + 折角 + 按种类着色的字形 + 扩展名，同一份图标也用在回收站与公开素材的行首）。
- `AdaptiveFeatureNavigation` 为录音、终端、我的三页统一指定宽窗初始显示列表与详情（`columnVisibility = .doubleColumn`、`.balanced`），紧凑窗仍按选中项下钻。此前 iPad 全屏进入录音时，自动列可见性会只显示「选择录音」占位，列表与页内返回键都不可见（2026-09-25 实测）；改动后需在 iPad 宽窗、半窗及宽度转场中核对列表可见性和选中项保持。
- **宽度转场只测过两种设备方向。** iPhone 竖 ↔ 横、iPadOS 全屏竖 ↔ 横都实测过；**iPadOS 半窗与三分之一窗没有实测** —— `simctl` 没有改窗口尺寸的接口，Stage Manager 不能从命令行开关，XCUITest 也改不了宿主窗口大小，所以 `regular → compact` 的运行时转场至今没有证据（云盘那两个实测缺陷都是宽度转场类的，这一格因此是已知缺口，不是「大概没问题」）。验收用例里 `assertSingleNavigationBar` 那条 700pt 的宽度线落在 iPad 半窗以下，本该在那种窗口里生效，但同样没人跑过。（2026-09-26：那条线已撤 —— 云盘只剩一列，这条判据现在恒为 1，与窗口宽窄无关。）
- 功能间切换保留各自选中项。再次点当前功能回到该功能列表。通知、Widget 与其他深链要设置功能、电脑和条目三层目标；不得仅修改某个 `NavigationStack` 的 path，造成 iPad 右栏不更新。
- 同一功能的列表行、数据源、操作和详情在 iPhone 与 iPadOS 共用。只允许呈现容器随空间变化，不维护两套业务逻辑或网络状态。
- 登录退出清除场景选择。被删除、结束或不再属于当前电脑的对象应清除选择并回到列表；网络暂时未返回列表时不得误判终端已结束。

## 窗口和布局

- 依据 `NavigationSplitView` 的系统折叠、horizontal / vertical size class 和当前容器实际尺寸布局；不得以 `UIDevice.userInterfaceIdiom`、`UIScreen.main.bounds` 或固定 iPad 型号作分栏、拖动或触点坐标依据。
- 宽窗保留列表与详情，详情优先获得可读 / 可操作宽度；空间不够时先收全局侧边栏，再折叠功能列表。折叠与展开不能重置选择、列表滚动、输入草稿、播放、录音或终端连接。
- 详情中的长文字、播放器、登录表单和录音控制限制内容阅读宽度并居中；终端画布使用剩余空间。栏宽偏好可以给系统，但不能把窗口锁死为固定尺寸。
- 与终端当前会话关联的资源列表优先用系统 `inspector`：宽窗停靠在画布旁，窄窗自动作为 sheet 呈现；不得为两种宽度维护两套资源状态。
- 所有栏尊重安全区、系统导航栏、窗口控制和键盘占用。iPadOS 全屏、竖屏、半窗、三分之一宽与浮窗均应可达全部主要操作；空间判断以可用窗口而非设备屏幕为准。
- 不新增硬编码品牌色或自绘系统控件；使用现有 `Theme` 的语义色、SwiftUI 系统表面、原生 `List`、`NavigationSplitView`、`Menu`、`sheet`、`popover` 和 toolbar。触摸命中区、动态字体、VoiceOver、完整键盘访问、指针和减弱动态效果需一起检查。

## 业务边界

- 终端的列 / 行从可见画布的真实几何量出。分栏伸缩、软 / 硬件键盘、顶部录音状态和临时提示不得产生过渡网格风暴；沿用现有防抖、尺寸归属和手机驱动 / 桌面驱动两种模式。不能因为 iPad 同屏展示多个区域而同时控制多个终端或电脑。
- 当前只支持一个用户明确选中的电脑；掉线不自动切换。切换电脑时继续执行旧电脑 detach 和按电脑隔离的会话状态清理。
- 录音页可收起而录音继续；自适应导航不能把录音会话生命周期绑在单个栏的出现 / 消失上。录音详情保持「语音 / 文字」平级切换，不增加纪要、发言人等已取消的产品层级。
- 通知是主页右上角铃铛打开的覆盖面板，不是顶层功能。面板里点一条直接去往目标并关闭；「待处理」段读的是实时会话列表，打开终端时跳到终端功能并选中对应会话。
- 主页右上角在铃铛左边常驻电脑切换，它是终端页设备行那件事的快捷方式：两处共用同一份 `DesktopIdentityLabel` 词汇、同一套判据和同一个 `selectDesktop`，只有真别处可去时它才是控件。从主页切换必须先清掉终端那一格按会话 id 记住的选择（会话 id 只对签发它的那台电脑成立），否则切过去会落进上一台电脑的终端页。
- 「我的」在 iPhone 与 iPadOS 都是分类列表加下钻二级页，走同一条 `AdaptiveFeatureNavigation` 路径；宽窗列表与设置内容并排，紧凑窗单列。外层只放分类名，只有账号与电脑两行显示状态值。电脑选择与终端页使用同一份 `SynapseAppModel` 状态。
- 不为 iPad 新建第二个 `SynapseAppModel` 或网络连接。多窗口需要先明确每个 scene 的导航 / 终端尺寸归属，以及全局录音和账号数据如何共享，不能仅打开第二个 `WindowGroup` 窗口。

## 通知数量显示

- **所有显示通知未读数的地方，最多显示到 99：99 条以内照实写，超过写「99+」。** 角标只有那么一点地方，位数越多它越往左长，先压到铃铛身上，再长就会被 iOS 26 的工具栏内容框切掉一角；而多出来的位数并不增加信息 —— 「99+」和「1234」说的是同一件事。现有的四处都照此办理：主页铃铛角标、底栏主页那一格的系统角标、设置里的「N 条未读」、App 图标角标（它只收数字、写不出「+」，所以封在 99 —— `setBadgeCount` 的入参是整数）。**新增任何显示未读数的地方同样适用**，写法取 `NotificationText.badgeCount`，上限取 `NotificationBadgePreference.badgeLimit`（全应用只此一处）。没有未读时不画角标：底栏那枚传 `nil`，字符串版角标不认 0。
- 无障碍标签仍读实际条数（主页铃铛那句「通知，N 条未读」）。读屏没有宽度限制，精确数字对听的人有用，而它说的是同一件事，不构成第二套数字。

## 新功能开发与验收

1. 先判定功能是列表详情、单任务表单、编辑器还是沉浸工作区；列表详情默认接入 `AdaptiveFeatureNavigation`。若不用它，在设计文档中说明为何系统分栏不适用及紧凑窗口的返回路径。
2. 在设计和代码审查中列出 iPhone 竖 / 横屏、iPadOS 全屏横 / 竖屏、半窗和最窄窗口的结构与操作入口；检查大字号、深色外观、VoiceOver、键盘和指针。
3. 对深链、选择保持、窗口宽度变化、删除当前项、断线、录音进行中和终端尺寸上报补适当的行为验证。若新功能包含自定义坐标 / 拖动，必须测量目标视图实际尺寸。
4. 修改移动端适配框架或新功能的分栏行为时，同时检查本文件、`AGENTS.md`、相关移动端专题规格、`SynapseMobile/README.md` 和用户可感知的待发布说明。

Apple 依据：[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)、[Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)、[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)、[SidebarAdaptableTabViewStyle](https://developer.apple.com/documentation/swiftui/sidebaradaptabletabviewstyle)。

## 站内网页预览与登录

- iOS 云盘与会话资源共用链接浏览入口。仅与当前配置的 Synapse API 源站同协议、主机和端口的链接使用 App 内 `WKWebView`；站外链接仍使用系统浏览器。公开分享和公开资源无需网页账号登录。
- 受保护的站内链接在加载前用 WebKit Cookie 单独查询 Console 会话，不能把原生 Bearer 带入这项检查。网页身份与当前 Remote 身份相同时直接进入；缺失或不同则展示系统弹窗，用户确认后才签发网页会话。
- 服务端用当前原生 Bearer 和仍有效的 refresh token 双重校验，签发普通用户 Web 会话，并将它关联到原生会话。App 把会话写入 WebKit 的 HttpOnly Cookie（`/api`、`/drive`），不放入 URL 或 JavaScript。原生退出时服务端撤销关联的 Web 会话，App 清理本机 Cookie。
- iPhone 使用底部确认面板；iPadOS 可缩放窗口使用系统自适应面板。加载、失败、取消和关闭都要有明确出口，动态字体与 VoiceOver 使用系统控件语义。
