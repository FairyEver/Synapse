# 桌面客户端埋点设计

## 目标

在不上传用户内容的前提下统计桌面客户端的生命周期、导航、交互、操作结果、错误和耗时。统计只面向平台管理员，并支持总体与单用户筛选。

## 数据边界

远程事件固定字段为：

`eventId, category, eventKey, component, action, outcome?, durationMs?, moduleId?, windowType, clientInstanceId, sessionId, appVersion, platform, occurredAt`

- `eventKey` 必须是代码提供的稳定标识；没有稳定标识时使用通用的 `组件.动作`。
- 不上传输入值、显示标题、正文、URL、路径、文件名、错误消息、堆栈、仓库/资源 ID、任意 metadata 或 IP。
- `clientInstanceId` 是加密保存在本机的稳定客户端实例标识；`sessionId` 每次应用进程重新生成。
- 请求体永远没有 `userId`。服务端以 Bearer Token 验证结果写入用户关联；没有 Token 时 `userId` 为空。

## 桌面端投递

- Renderer 继续调用现有 `track()`，通过 `ui.tracking` 日志和日志 IPC 抵达主进程。
- 共享组件直接接收代码中的稳定 `data-track`；未提供稳定标识的原生控件降级为固定 `native-组件.动作`，不得读取显示文案、输入值或运行时 ID 生成事件名。异步通知操作必须显式提供稳定 `trackingName`，Workflow、登录和 Drive 等关键流程直接记录成功、失败、取消与耗时。
- 静态覆盖检查按具体 JSX 处理器校验共享组件、原生交互、显式 `eventKey` 和异步 `trackingName`，只允许纯事件传播等明确非业务处理器免除。
- 主进程只投影白名单字段到 `telemetry.outbox`，本地队列最多 5,000 条并保留 7 天，普通配置备份不包含该 namespace。
- 20 条待发送或 15 秒触发刷新，服务端单批最多 50 条；失败从 5 秒指数退避至 15 分钟。
- 队列记录采集时账户。登录事件只允许同一账户的认证请求发送，退出或切换账户后保留等待，不得匿名补发。
- `eventId` 用于服务端幂等。埋点是单向 best-effort 副作用：Renderer 日志 IPC、队列读取/写入/删除、身份初始化和网络发送失败全部在埋点边界内隔离，不弹错误、不递归写日志、不抛回业务回调。身份切换刷新最多等待 250ms，退出刷新最多等待 2 秒。

## 服务端与统计

- `POST /api/client-telemetry/events` 接受匿名或桌面 Bearer Token，请求严格拒绝未知字段和客户端提供的用户身份。
- `ClientTelemetryEvent` 原始事件保留 180 天，每日分批清理；用户删除时级联删除关联事件。
- `GET /api/admin/telemetry/stats` 仅受平台管理员会话保护并记录审计，只返回聚合指标、趋势和分布。
- 失败率为失败操作数除以成功与失败操作总数；P95 只计算已完成且包含耗时的操作。
- 管理页面不提供原始事件表格、明细导出或用户排行。
