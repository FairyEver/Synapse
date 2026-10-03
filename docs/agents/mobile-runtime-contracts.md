# 移动端运行时约束

本文只记录 `SynapseMobile/` 的业务状态、安全和已验证的稳定性边界。界面组件、视觉和页面组织以 [apple-design](../../.agents/skills/apple-design/SKILL.md) 引导阅读的 Apple 官方原文为依据。

## 身份、选择与深链

- 同一账号当前只操作用户明确选中的一台电脑；掉线不自动切换。切换电脑要 detach 旧电脑，并清除只对旧电脑有效的会话选择。主页与终端的电脑切换共用 `SynapseAppModel` 的 `selectDesktop`。
- iPhone 与 iPadOS 共用业务数据、网络连接和操作状态，不为 iPad 新建第二个 `SynapseAppModel`。多窗口须先明确 scene 的导航与终端尺寸归属，以及全局录音和账号数据的共享方式。
- 功能切换、旋转和窗口尺寸变化不得丢失有效的选中项、输入草稿、录音、播放或终端连接。通知、Widget 和其他深链需要定位功能、电脑和条目；不能只改一个导航栈的 path 而让详情仍指向旧条目。
- 登录或退出时清除场景选择。对象被删除、结束或不再属于当前电脑时清除相应选择；网络列表暂未返回时不得把终端误判为结束。

## 终端与录音

- 终端列、行由当前可见画布的实际几何计算。分栏伸缩、键盘和临时提示不得反复上报过渡网格；保留现有防抖、尺寸归属以及手机驱动 / 桌面驱动模式。不能同时控制多个终端或电脑。
- 收起录音界面不结束录音，也不丢失会话；真正完成并提交后才进入转写列表。页面或栏位出现、消失不得决定录音生命周期。
- 桌面与手机共用的业务状态、录音和终端尺寸协议继续遵守现有代码、测试及相关非界面设计约束。

## 已验证的稳定性边界

- 云盘浏览、回收站、公开素材、分享管理四条列表在宽窗口不挂 `.refreshable`，继续使用 `Features/Drive/DriveBrowserList.swift` 的 `refreshableIfCompact`。iPad 全屏下整格切换与辅助功能查询曾触发 `AttributeGraph` 断言和 `SIGABRT`；要撤销此守卫，先按 `SynapseMobileUITests/DriveAcceptanceUITests.swift` 中记录的场景实测。
- 不把上述崩溃推断为所有同形状列表的必然结果。录音与会话列表当时未复现；修改它们时按同一场景单独验证。iPadOS 半窗、三分之一窗的运行时转场尚无完整实测证据，验收时不能声称已覆盖。

## 通知、剪贴板与分享

- 通知未读数的现有产品上限为 99：文字展示超过 99 时用「99+」，App 图标角标最多传 99；没有未读时不显示角标。统一使用 `NotificationText.badgeCount` 和 `NotificationBadgePreference.badgeLimit`，无障碍标签仍读真实条数。
- 通知项打开对应目标后关闭面板；「待处理」数据来自实时会话列表，终端目标须选中对应会话。界面呈现方式由 `apple-design` 决定。
- 剪贴板历史与快捷输入保留现有动作边界：点正文执行复制或填入，独立的全文操作只打开只读预览。系统分享复用 `DesignSystem/SystemShare.swift`，剪贴板写入复用 `DesignSystem/Clipboard.swift`，不在新入口复制实现。
- 手机终端分别提供「复制标签引用」和「复制会话引用」：前者走 `workspaceReference` intent，按 `workspaceId` 和可选的手机当前/最近查看 `sessionId` 请求；未查看过时由电脑取布局首个会话。后者走 `sessionReference` intent，点名具体会话。桌面主进程校验会话归属并复用 PC 格式化函数生成完整五行文本，手机不得根据摘要重建字段或生成短引用。标签标题和会话行的系统长按菜单分别承载两种操作，终端更多菜单也提供两项（单会话标签内容相同，保留一个会话复制入口）。复制无需 attach、租约或尺寸修改；失败和切换电脑、账号、目标结束后的迟到结果不改剪贴板。最近分屏选择只存本次手机运行内，关闭/移出标签时清理，切换电脑时清空。上线顺序为服务端 → 桌面端 → 手机端。

## 工作区文件与差异

- `workspaceFiles` 是独立、只读、用户按需请求的终端通道。云端 welcome 与选中桌面 summary 都声明版本 1 才启用入口；旧端不试发未知 kind。云端只做有界瞬时转发，不存源码、diff 或路径正文，也不写入 summary、日志或云盘。
- 桌面按真实运行中 session 的当前目录创建冻结 scope，并绑定可信 account/desktop/mobile/session。权限只覆盖此 scope 与安全发现的精确 Git 元数据；句柄、分页与缓存每次都复验归属、上下文及内容版本。桌面在关面板、owner断线、切换账号/电脑、会话结束或权限撤销时清理对应scope、请求与结果缓存；取消/关闭不等待读取队列。手机断线只取消pending并禁止新读取/引用，保留已读内存快照，不把离线当作会话结束；重连后等待用户刷新或重开，不自动重放。手机关闭面板、切换目标/账号、确认会话结束或撤权时清理对应阅读状态。
- Git 阅读复用严格只读受控适配器，不调用写临时 index/对象的高层 diff。外部过滤器、缺失本地对象、不支持的 Git 或路径类型返回限制状态；跨 scope rename 只投影范围内一侧。手机不执行 Git、写文件或解决冲突。
- 内置换行/文件模式仅从精确授权的标准桌面 global/local 配置提取；64KiB有界读取、不跟随include/链接、普通Git仍隔离global/system，版本变化使旧内容失效。V1不猜系统配置路径；无法确定且会影响当前比较时Git受限，目录浏览仍可用，不虚报差异。
- 文件/目录引用由桌面沿用 shell formatter 生成，手机在同一草稿的 UTF-16 选区末端原子插入。迟到结果、草稿 generation 或目标改变时拒绝插入；不写 PTY、不回车、不索取租约、不改网格。大输入页与主输入页共用草稿。
- 资源与失败语义以 [工作区文件 V1 spec](../superpowers/specs/2026-10-03-mobile-workspace-files-and-changes-spec.md) 为准。上线按服务端 → 桌面端 → iOS 顺序执行；Apple 外观与 iPad 窗口验收不能用业务单测代替。

## 站内网页身份

- 云盘、会话资源与通知的站内链接共用浏览入口。仅与当前 Synapse API 源站同协议、主机和端口的链接使用 App 内 `WKWebView`；站外链接使用系统浏览器。公开分享和公开资源无需网页账号登录。
- 受保护链接加载前用 WebKit Cookie 查询 Console 会话，不用原生 Bearer 代替。网页身份缺失或与当前 Remote 身份不同时，经用户确认再签发网页会话。服务端用原生 Bearer 和有效 refresh token 双重校验；App 以 HttpOnly Cookie 保存 Web 会话，不放入 URL 或 JavaScript。原生退出时撤销关联会话并清理本机 Cookie。
- 分享站内网页时使用 `WKWebView.url` 的当前地址；单页应用的同文档导航不能依赖 `WKNavigationDelegate` 获取。回归见 `LinkBrowserWebViewTests`。
