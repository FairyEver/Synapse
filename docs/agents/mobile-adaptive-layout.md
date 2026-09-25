# iPhone 与 iPadOS 自适应界面规则

本规则适用于 `SynapseMobile/SynapseMobile/` 的新页面和现有页面修改。最低系统版本见 Xcode 工程配置。历史移动端专题设计中的「iPad 不在本次范围」只描述当时的交付，不覆盖本规则；业务协议、权限、终端尺寸归属、录音和诊断隐私等原有不变量继续有效。

## 导航结构

- 顶层「主页 / 终端 / 我的」使用系统 `TabView` 的自适应呈现：iPhone 为底部标签，iPadOS 可显示顶部标签或侧边栏。不要自行画一套与系统并行的全局导航。
- **底栏永远三格，不因任何理由增加第四个。** 新增能力一律进「主页 → 功能」清单：位置是稀缺资源，功能不是。功能超过十二项左右时给「功能」加搜索与「常用」置顶，而不是开新槽位。
- 有「列表 → 详情」的功能以 `Features/Root/AdaptiveFeatureNavigation.swift` 为入口，使用同一份选中 ID 驱动宽窗口并排详情和紧凑窗口下钻。列表用 `List(selection:)` 与 `NavigationLink(value:)`，右侧详情只显示当前选中对象。宽窗不推走列表，窄窗必须有明确返回路径。
- 自带 `AdaptiveFeatureNavigation` 的功能页（当前是主页里的录音）是**它所在那一格的一页**，不推入任何 `NavigationStack`：分栏自己带一条导航栏，推进栈里屏幕上会出现两条栏——上面那条只剩系统的返回键，标题和操作落在下面那条，中间空出一条标题带，宽窗的并排详情也一并消失（iPhone 与 iPadOS 都是这个形状）。返回上一级由该页自己的一枚返回键承担，落在列表那一条栏上，和它的操作同一行。
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

## 新功能开发与验收

1. 先判定功能是列表详情、单任务表单、编辑器还是沉浸工作区；列表详情默认接入 `AdaptiveFeatureNavigation`。若不用它，在设计文档中说明为何系统分栏不适用及紧凑窗口的返回路径。
2. 在设计和代码审查中列出 iPhone 竖 / 横屏、iPadOS 全屏横 / 竖屏、半窗和最窄窗口的结构与操作入口；检查大字号、深色外观、VoiceOver、键盘和指针。
3. 对深链、选择保持、窗口宽度变化、删除当前项、断线、录音进行中和终端尺寸上报补适当的行为验证。若新功能包含自定义坐标 / 拖动，必须测量目标视图实际尺寸。
4. 修改移动端适配框架或新功能的分栏行为时，同时检查本文件、`AGENTS.md`、相关移动端专题规格、`SynapseMobile/README.md` 和用户可感知的待发布说明。

Apple 依据：[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)、[Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)、[Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)、[NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)、[SidebarAdaptableTabViewStyle](https://developer.apple.com/documentation/swiftui/sidebaradaptabletabviewstyle)。
