# 手机终端复制会话引用

## 行为

手机会话列表的每个会话行（包括分屏标签下的会话）长按菜单提供「复制引用」；终端视图的既有更多菜单也提供同一项，紧邻「复制全部输出」。两个入口都使用具体 `sessionId`，不使用标签的活动分屏猜测目标。

复制成功使用全 App 的 `Clipboard.copy` 写入手机剪贴板并反馈「引用已复制，仅电脑本次运行有效」。失败保留原剪贴板，终端内失败落在终端消息区，列表内失败走通知条。请求过程中切换电脑、退出账号、会话结束或任务取消时丢弃迟到结果。

## 数据与权限

- 手机发送 `sessionReference` intent，参数仅 `sessionId`，复用既有 `mobile.intent` / `mobile.intentResult` 链路。
- 桌面主进程通过 `terminal.state.read` 权限与审计后读取实时会话及 `getWorkspaceForSession`。复用 `buildTerminalSessionReferenceText` 和 `terminalSessionReference`，返回 `sessionId` 与可选 `referenceText`。
- 结果逐行固定为 `workspace_id`、`workspace_title`、`session_id`、`session_title`、`session_ref`，顺序、格式、名称与 PC 复制完全相同。手机不解析重建、不增加设备字段、不生成摘要或短引用。
- 云端只转发给发起请求的手机；不广播、不缓存引用正文。`referenceText` 只允许出现在 accepted 且带 `sessionId` 的结果中，沿用回执文本长度预算。
- 复制不 attach、不取控制租约、不读终端输出、不改变尺寸，也不访问电脑剪贴板。不新增公开 capability、MCP tool、IPC operation、Workflow、Automation 或 Deep Link。
- 引用仍仅在生成它的电脑本次 Synapse 运行、会话仍存在期间有效。手机复制并不让引用变成远程通用标识，Agent 仍须连接对应电脑的 MCP。

## Apple 界面依据

查阅日期：2026-10-01。项目最低部署版本为 iOS 18，iPhone 与 iPadOS 使用同一会话数据及动作。

- [Menus](https://developer.apple.com/design/human-interface-guidelines/menus)：用与对象相关的菜单承载次要操作，使用简短动作标签；同组菜单项的图标处理保持一致。因此列表使用系统 context menu 的 `Label`，终端既有更多菜单保持文字项。
- [contextMenu(menuItems:)](https://developer.apple.com/documentation/swiftui/view/contextmenu(menuitems:))：系统支持 iOS/iPadOS 长按与指针菜单，iOS 13 起可用。行菜单不改变列表选择或导航；系统负责呈现、字号和无障碍语义。
- [Menu](https://developer.apple.com/documentation/swiftui/menu)：系统菜单承载操作，iOS/iPadOS 14 起可用。沿用终端更多菜单，不新增影响终端画布尺寸的工具栏或弹层。
- [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios) 与 [Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)：减少常驻控制、保留次要操作可发现性并适应不同输入和窗口形态。沿用系统菜单，无新布局、颜色、字体或动画；窄屏、可缩放窗口、动态字体、深浅外观和 VoiceOver 共用同一操作语义。

## 兼容与验证

新增 intent 需要按服务端 → 桌面端 → 手机端升级；旧校验器不认识它。协议版本保持 1，旧结果不含 `referenceText` 仍可解码；超时、拒绝或缺少正文时手机不自行拼接引用、不重放其他动作。

验证覆盖分屏目标和五行内容、权限拒绝、已删除会话与缺失 workspace、云端点对点原文转发、结果预算、手机原文复制、旧结果解码、失败不覆盖剪贴板与迟到结果丢弃。UI 验收时分别检查 iPhone 与 iPadOS 上长按/指针菜单和终端更多菜单，不以编译通过代替实机验收。
