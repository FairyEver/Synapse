# 云端待办验收记录

实施分支 `codex/cloud-todos`，设计为 [云端待办](../specs/2026-10-11-cloud-todos-design.md)，计划为 [七阶段实施](../plans/2026-10-11-cloud-todos.md)。本轮按已批准边界运行源码测试、独立 PostgreSQL 事务验证与构建，不启动 Synapse、开发服务器、浏览器或原生测试宿主。下表区分自动化证据与仍待实际运行的项目。

## 已有自动化证据

| 范围 | 证据 | 状态 |
| --- | --- | --- |
| shared DTO / Unicode / 日期 / reference | Shared 专项及全量测试 | 已运行，通过；最终数量在 Task 7 记录 |
| 服务端账号隔离、版本和 UUID 幂等 | HTTP、repository、service 专项测试 | 已运行，通过 |
| 提醒触发 / 完成 / 删除互斥，提交与重试 | 独立回环测试 PostgreSQL 真实行锁、回滚、generation、outbox 租约测试 | 已运行，通过；没有访问生产库 |
| 桌面认证、同号重登、错误与日志边界 | 六能力、bridge、401、权限和日志回归 | 已运行，通过 |
| 桌面完成 / 全部恢复、失败草稿、撤销冲突与目标 | 组件、hooks、System App / 窗口和通知测试 | 已运行，通过；不代表三宿主外观验收 |
| iOS 请求与状态 | URLProtocol 的六方法、401 同 UUID、null / absent、身份与筛选交错、撤销及时间测试 | 测试包已构建；未执行原生断言 |
| iOS 路由与编辑 | TodoNavigation / TodoDraft、既有通知 destination / deep-link 回归 | 测试包已构建；未执行原生断言 |
| 最低系统与架构 | `xcodebuild build-for-testing`，generic iOS Simulator，iOS 18.0 | arm64 / x86_64 构建通过；不启动模拟器 |

原服务器全量基线有两项既有管理员认证测试失败（`request.get is not a function`）；待办专项不包含这两项，没有修改它们。

## 原生界面与跨端矩阵

| 场景 | 验收标准 | 本轮结果 |
| --- | --- | --- |
| PC 启动台内嵌 / Dock / 独立窗口 | 单顶栏，两标签，一张白色列表卡；行不套卡片 | 待实际界面验收 |
| iPhone 竖屏 / 横屏 / 键盘 | 系统单列列表，完成与编辑点击独立；短表单可滚动，不遮挡保存 | 待设备或模拟器验收 |
| iPadOS 全窗 / 半窗 / 窄窗及连续缩放 | 单一账号状态和草稿；无额外侧栏或双导航栏，表单按系统 sheet 适配 | 待实际窗口验收 |
| 动态字体，包括最大辅助字号 | 标题、时间和状态可读，行随内容增长，按钮可操作 | 待验收 |
| VoiceOver | 完成 / 恢复、编辑、更多操作分别有名称；完成状态不只靠颜色 | 待验收 |
| 深色 / 浅色 / 提高对比度 | 系统语义文字与 SF Symbols；PC 图标深色对比 | 待验收 |
| 硬件键盘 / 指针 / 减弱动态效果 | 系统导航与日期选择可操作；取消和保存键盘快捷键有效 | 待验收 |
| 表单失败 / 冲突 / 缩放 / 刷新 | 草稿与原版本保留，重试 UUID 不变；显式重新读取才换成服务器内容 | 业务测试已构建，运行与界面待验收 |
| 冷启动、未登录的通知 / 深链 | 等登录后读取服务器通知与目标，已完成切全部；新导航或换账号取消旧目标 | 业务测试已构建，实际入口待验收 |
| 桌面 → AI → iOS 同账号 | 新建、查询、修改、完成与恢复共享同一版本；另一账号不可见 | 分层 API / 事务 / bridge 已验证；实际三端链路待验收 |
| 电脑关闭时云端提醒 | 通知提交一次、手机收到生产 APNs；完成 / 删除取消未触发提醒 | Worker / outbox 自动化通过；TestFlight / App Store 真实推送待验收 |

真实推送必须用生产签名包和正常系统权限验证，保持 `APNS_USE_SANDBOX=false`。构建成功、DOM 类名、网页原型或模拟响应均不能将上述原生与生产推送项目标记为已验收。

## Apple 依据及本次选择

本轮重新读取 Apple 官方页面的文档数据和平台说明，未使用网页截图推断原生组件。

| 决策 | 官方依据与落实 |
| --- | --- |
| iPhone / iPadOS 自适应 | [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)、[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)、[Layout](https://developer.apple.com/design/human-interface-guidelines/layout)：使用系统布局、字号和安全区域，草稿由 AppModel 保留；实际窗口仍待验证 |
| 文字事项的单列列表 | [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[List](https://developer.apple.com/documentation/swiftui/list)：正文为系统 List 行，提供编辑和状态操作；不复制 PC 卡片。单列且无侧栏是用户确认的产品要求 |
| 两种相关视图切换 | [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、[SegmentedPickerStyle](https://developer.apple.com/documentation/swiftui/segmentedpickerstyle)：同一事项集合的未完成 / 全部，用等宽文字段；不新增顶层 tab |
| 主页进出与返回 | [NavigationStack](https://developer.apple.com/documentation/swiftui/navigationstack)：待办作为现有主页 path 的一层，保留系统返回行为；没有第二个主导航栈 |
| 短表单编辑 | [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)、[Form](https://developer.apple.com/documentation/swiftui/form)：编辑 sheet 内系统 Form；取消在前，添加 / 保存在后。内容使用 large detent，iPad 采用系统默认自适应；未保存修改的划退触发放弃确认，提交中禁止关闭 |
| 日期与提醒输入 | [Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers)、[DatePicker](https://developer.apple.com/documentation/swiftui/datepicker)：日期与时间由原生控件选择，提醒及提前量用系统菜单式 Picker；不手写夏令时偏移 |
| 无障碍与命中范围 | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)：系统字体、语义颜色、SF Symbols，复用项目 44 pt 最小操作范围；提供状态和动作名称，未以颜色单独表达完成 |

Apple API 资料核对：List / Form / DatePicker / segmented Picker 从 iOS 13 可用，NavigationStack 从 iOS 16 可用；本工程最低 iOS 18 保持不变。构建校验可用性，动态字体与辅助输入体验仍需实际验收。
