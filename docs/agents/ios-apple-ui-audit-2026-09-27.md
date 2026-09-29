# iOS 界面与交互检查（2026-09-27）

## 依据与范围

按 Apple 的 [布局](https://developer.apple.com/design/human-interface-guidelines/layout)、[分栏](https://developer.apple.com/design/human-interface-guidelines/split-views)、[标签栏](https://developer.apple.com/design/human-interface-guidelines/tab-bars)、[分段控件](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、[按钮](https://developer.apple.com/design/human-interface-guidelines/buttons)、[弹窗](https://developer.apple.com/design/human-interface-guidelines/sheets)、[辅助功能](https://developer.apple.com/design/human-interface-guidelines/accessibility)与[加载状态](https://developer.apple.com/design/human-interface-guidelines/loading)检查 `SynapseMobile/SynapseMobile/Features/`。覆盖根导航、录音、终端、云盘、通知、设置及登录的页面和面板；对可疑布局与交互逐处阅读实现及本仓移动端专题规格。

这是源码检查。仓库规则要求未经用户明确要求不启动 App 或浏览器调试，因此触点、动态字体、旋转和宽窗列显示还需在真机或模拟器做视觉与 VoiceOver 验收。

## 已确认并修复

| 位置 | 缺陷及处理 | 依据 |
|---|---|---|
| 录音、终端、设置的宽窗导航 | 分栏初始可能只显示空详情；显式请求双列，并使用平衡分栏样式。 | [NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)、[分栏](https://developer.apple.com/design/human-interface-guidelines/split-views) |
| 录音、通知、关于设置 | 分类后还要点一次只有一行的中转页；分类现在直接显示内容。 | [导航](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search)、本仓移动端导航规格 |
| 剪贴板、快捷输入行 | 依赖点击手势执行主要操作，读屏与键盘激活缺少标准按钮语义；改为操作与预览两个独立按钮，各有至少 44pt 点击区。 | [触控目标](https://developer.apple.com/design/tips/)、[辅助功能](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 通知、云盘简介、分享详情、会话资源面板 | 纯查看面板用“完成”作为确认操作；改为前缘“关闭”。分享创建结果仍保留“完成”。 | [弹窗](https://developer.apple.com/design/human-interface-guidelines/sheets) |
| 录音内容、终端快捷面板 | 分段控件标题为空，读屏缺少上下文；补充名称。 | [分段控件](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、[辅助功能](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 录音中的面板 | 固定纵向布局在短窗口或大字号下可能挤掉底部操作；正文允许滚动，操作固定于安全区底部，字号随动态字体缩放。 | [布局](https://developer.apple.com/design/human-interface-guidelines/layout)、[ScaledMetric](https://developer.apple.com/documentation/swiftui/scaledmetric) |
| 问题反馈、诊断日志导出、麦克风与通知权限 | 异步操作缺少进行中或失败反馈；补充进度、防重复和错误提示。 | [加载状态](https://developer.apple.com/design/human-interface-guidelines/loading)、[提醒](https://developer.apple.com/design/human-interface-guidelines/alerts) |
| 登录、录音设置、录音详情加载 | 删除重复登录说明和不准确的“录音在服务端处理”说明；录音详情首次载入只发一次请求。 | 本仓产品文案规则、[加载状态](https://developer.apple.com/design/human-interface-guidelines/loading) |

## 尚需验收

- 终端键盘翻页圆点当时约 22×22pt。Apple 的[触控目标指南](https://developer.apple.com/design/tips/)建议至少 44×44pt；当时的 346pt 面板高度是旧界面稿的取舍。后续调整须按 [apple-design](../../.agents/skills/apple-design/SKILL.md) 重新阅读官方原文并验证当前实现。
- 在 iPad 宽窗、半窗、紧凑窗以及大字号下，核对分栏切换、录音面板滚动与页脚。使用 VoiceOver 核对剪贴板、快捷输入及两个分段控件；这些需要运行应用，当前仅完成编译与源码检查。
