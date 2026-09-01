# 客户端与网页云盘埋点设计

## 目标

在不上传用户内容的前提下统计桌面客户端及网页云盘的生命周期、导航、交互、操作结果、错误和耗时。网页端严格限定普通用户 Drive 控制台、文件浏览器与分享页。统计只面向平台管理员，并支持总体与单用户筛选。

## 数据边界

远程事件固定字段为：

`eventId, category, eventKey, component, action, outcome?, durationMs?, moduleId?, windowType, clientInstanceId, sessionId, appVersion, platform, occurredAt`

- `eventKey` 必须是代码提供的稳定标识；没有稳定标识时使用通用的 `组件.动作`。
- 不上传输入值、显示标题、正文、URL、路径、文件名、错误消息、堆栈、仓库/资源 ID、任意 metadata 或 IP。
- 桌面端 `clientInstanceId` 是加密保存在本机的稳定客户端实例标识，`sessionId` 每次应用进程重新生成。网页云盘使用浏览器本地存储中的随机实例标识和会话存储中的随机会话标识；存储不可用时仅在当前页面内保留随机值。
- 请求体永远没有 `userId`。服务端以桌面 Bearer Token 或普通用户 Web 会话 Cookie 的验证结果写入用户关联；没有认证时 `userId` 为空。

## 桌面端投递

- Renderer 继续调用现有 `track()`，通过 `ui.tracking` 日志和日志 IPC 抵达主进程。
- 共享组件直接接收代码中的稳定 `data-track`；未提供稳定标识的原生控件降级为固定 `native-组件.动作`，不得读取显示文案、输入值或运行时 ID 生成事件名。异步通知操作必须显式提供稳定 `trackingName`；异步业务处理器使用 `startTrackedOperation()` 或 `runTrackedOperation()` 记录成功、失败、取消与耗时。
- 语义事件统一使用 `{domain}.{entity}.{action}`。桌面主窗口、Workflow 编辑器与 Runner、Automation 编辑器、知识库来源管理器及独立 System App 使用准确的稳定 `moduleId` 和 `windowType`。
- 覆盖范围包括 17 个能力 Renderer，以及 Git、Drive、更新与深链入口、Workflow、Automation、Agent、Launcher/Dock、安装、Content、Knowledge Base、Database、Settings、Usage Analysis 和模型价格。搜索、筛选、排序、分页、视图模式等只记录固定动作或固定枚举，不上传自由输入。
- 静态覆盖检查按具体 JSX/TypeScript 处理器校验桌面 Renderer 与 `desktop/app-capabilities/*/renderer` 的共享组件、原生交互、显式 `eventKey`、异步完成和稳定语义键；白名单只允许纯关闭、焦点恢复、事件传播和非用户触发加载。
- 主进程只投影白名单字段到 `telemetry.outbox`，本地队列最多 5,000 条并保留 7 天，普通配置备份不包含该 namespace。
- 20 条待发送或 15 秒触发刷新，服务端单批最多 50 条；失败从 5 秒指数退避至 15 分钟。
- 队列记录采集时账户。登录事件只允许同一账户的认证请求发送，退出或切换账户后保留等待，不得匿名补发。
- `eventId` 用于服务端幂等。埋点是单向 best-effort 副作用：Renderer 日志 IPC、队列读取/写入/删除、身份初始化和网络发送失败全部在埋点边界内隔离，不弹错误、不递归写日志、不抛回业务回调。身份切换刷新最多等待 250ms，退出刷新最多等待 2 秒。

## 网页云盘投递

- 只有 `dashboard/src/features/drive-browser/` 与 `dashboard/src/features/drive-console/` 可以发送网页埋点。管理员 Drive 存储统计、管理员公开素材管理及其它 Dashboard 页面不得发送。
- Drive 页面根边界统一捕获点击、键盘选择、输入变更、提交、拖放、聚焦、失焦和滚动；Drive 弹窗、下拉菜单和侧边面板的 Portal 根节点显式加入同一捕获范围。关键导航、视图、上传、分享权限与解锁、文件操作、评论、版本、代码与 Markdown 保存、图片导入、协作连接、预览渲染器、公开素材、回收站和站点使用代码中的 `web.drive.*` 稳定事件键，其余交互降级为固定 `web.drive.ui.<action>`。
- 网页静态检查解析 TypeScript AST，校验 Portal 标记、稳定事件键、Drive API 包装、用户触发异步处理器的完成事件和窄白名单。
- Drive、Drive Browser、评论与版本 API 由 Drive 专用包装层记录所有异步请求的成功、失败和耗时，不上传请求参数、返回值、错误文本、文件名、分享 ID、资源 ID 或内容。
- 网页队列仅保存在内存，最多 500 条；20 条或 5 秒发送，单批最多 50 条。队列记录采集时的 Web 会话，发送前身份不一致的事件直接丢弃，登录事件不得降级为匿名事件。滚动和输入变更每秒最多记录一次最终事件，页面隐藏时使用同源 Beacon 尝试刷新。
- 发送使用 Cookie 同源请求。有效普通用户 Web 会话由服务端关联用户；无会话的分享访问按匿名事件保存；过期或无效 Cookie 返回 401，当前批次直接丢弃，不向用户显示错误。
- 发送、存储、定时器、Beacon 与网络异常全部在埋点边界中隔离；不调用应用通知或日志，不递归产生新埋点，不改变业务 Promise 的返回值、异常或回调执行。

## 服务端与统计

- `POST /api/client-telemetry/events` 接受匿名请求、桌面 Bearer Token 或普通用户 Web 会话 Cookie，请求严格拒绝未知字段和客户端提供的用户身份。
- `ClientTelemetryEvent` 原始事件保留 180 天，每日分批清理；用户删除时级联删除关联事件。
- `GET /api/admin/telemetry/stats` 仅受平台管理员会话保护并记录审计，只返回聚合指标、趋势、分布与洞察；所有筛选同时作用于洞察，最大查询跨度为 180 天。
- 失败率为失败操作数除以成功与失败操作总数；P95 只计算已完成且包含耗时的操作。
- 登录身份使用 `userId`，匿名身份使用 `clientInstanceId`，会话使用 `sessionId`。活跃洞察按查询结束前 1/7/30 天计算 DAU/WAU/MAU，粘性为 DAU 除以 MAU；会话深度返回平均与 P95 时长；身份洞察区分新身份和回访身份。
- 固定采用率覆盖 Drive 上传、分享、编辑与同步，以及 Git、Workflow、Agent、Automation、Terminal、Secrets 和安装器。固定漏斗在同一身份、同一会话内按发生顺序聚合 Drive 上传/分享/编辑/同步、Git 发布、Workflow 运行和 Agent 响应。留存按 cohort 日期返回 D1/D7/D30，观察窗口未成熟时返回 `null`。
- 管理页面不提供原始事件表格、明细导出或用户排行。
