# 频道（Channels）v1 设计文档

日期：2026-11-25  
状态：已确认  
适用范围：`server/`、`dashboard/`、`document/`、`desktop/`（MCP 与系统 Skill）

---

## 1. 背景与设计意图

Synapse 已经提供了「云端数据表（Cloud Tables）」，解决自建网页、AI 和脚本的**持久化结构化数据**存储问题；但云表刻意不做实时订阅，无法承担低延迟的跨端信号通信。

用户希望在 SY 云端补齐一块与云端数据表平行的实时基础能力——**频道（Channels）**，核心解决两类高频真实场景：

1. **手机网页远程控制自有后端服务**：用户自己的后端服务（可能运行在本机、内网、NAS 或其他服务器，无需暴露公网端口或自建网关）与手机打开的静态控制网页都主动连接到 SY 云端；手机点按钮发信号，自有后端实时收到并执行操作，必要时将结果或状态实时回传给网页。
2. **多网页实时联动（如手机遥控器 ↔ 大屏展示页）**：大屏浏览器和手机遥控器页面都接入同一个 SY 频道，手机端触发动作后大屏毫秒级响应，无需为纯静态页面单独搭建 WebSocket 后端。

两类场景的共同要求：
- **运行时免 SY 登录态**：大屏浏览器、外部后端、手机打开的分享网页都通过**凭证**接入，不依赖用户登录 SY，也不读取登录 Cookie。
- **与云端数据表分工清晰**：云表负责持久化数据与查询，频道负责此刻的连接、实时信号流转与即时状态同步。
- **AI 友好**：和云表一样，支持通过开放文档整页复制给 AI，也支持通过桌面 MCP 让 AI 一条龙创建频道、签发最小权限凭证、配合 Drive 网页分享完成交付和验收。

---

## 2. 目标、非目标与反目标

### 2.1 目标（Goals）
- 提供多端实时事件通道：支持长连接双向收发（WebSocket），同时支持无状态 HTTP POST 单向发信号（便于脚本、Webhook、AI 直接触发）。
- 提供轻量在线感知（Presence）：连接方能实时看到当前频道里有哪些客户端/角色在线，上下线自动通知。
- 提供短窗口断线补发：客户端因锁屏、切后台、网络闪断重连时，可按序号补齐最近短窗口内漏掉的广播事件。
- 提供可选的「保留最新状态（Retain）」：发状态类事件时可选择保留该事件名最新 1 条快照（轻量持久化），大屏刷新或晚开时无需依赖另一端在线即可恢复当前状态。
- 提供最小权限的免登录凭证体系：兼顾「个人 API Key」和「单频道分角色专属凭证（仅订阅 / 仅发布 / 双向）」，凭证撤销或权限变更时及时同步到活跃连接。
- 同步交付三大入口：**Dashboard Console「频道」管理页（含实时调试台）**、**可一键复制给 AI 的开放接口文档**、**桌面端 MCP 工具及系统 Skill 指南**。

### 2.2 非目标（Non-Goals）
- **不做持久化消息队列、消息历史库或服务端幂等回执表**：不落库存储事件流水，不提供历史消息搜索、分页回查或离线长时堆积投递，也不在 v1 为 `POST /events` 引入 `Idempotency-Key` 去重存储（保持事件热路径不触库；需要业务去重的调用方可在 `payload` 中自带业务 ID）。
- **不做云表/Workflow/Automation 联动**：v1 不做“云表数据变更自动推频道事件”，也不新增 Workflow 节点或 Automation 触发器/执行器。
- **不新增桌面 System App / Dock / Deep Link / 移动端原生页面**：桌面端仅注册独立 MCP 能力域与系统 Skill，不增加独立应用窗口或导航项。
- **不做多副本分布式集群协调**：v1 延续云端数据表的单实例 NestJS 架构；代码上把内存 Hub 接口抽象清晰，多副本演进时再接入 Redis Pub/Sub。
- **不单独发布 npm / PyPI 客户端 SDK 包**：v1 保持极简标准 WebSocket + JSON 协议，文档中直接提供零依赖原生浏览器与常见后端语言代码片段。

### 2.3 反目标（Anti-Goals，出现即视为设计失败）
- **逼迫用户把账号级主 API Key 写进公开网页**：前端网页必须能使用爆炸半径锁死在单频道、单角色的专属凭证。
- **凭证出现在 URL Query 中**：浏览器或代理日志、Referer、历史记录绝不应记录长效密钥。
- **协议或握手复杂导致 AI 生成客户端频繁出错**：帧格式必须极简、无歧义、错误码可读。
- **单频道异常流量或慢消费者拖垮主服务**：绝不能影响桌面端/移动端现有 `LiveDesktopGateway`、`MobileLiveGateway`、`DriveCollaborationGateway` 或主业务请求。

---

## 3. 备选方案与选型结论

讨论阶段直接排除了引入外部独立消息中间件（如 EMQX、Centrifugo、独立 Redis Cluster）的做法，原因是 SY 当前坚持单机轻部署、零新增运维组件，现有单实例 NestJS + PostgreSQL + `ws` 底座完全能承载目标规模。

在此前提下对比了三种落地方案：

| 方案 | 核心思路 | 主要优点 | 主要代价 / 取舍 |
|---|---|---|---|
| **方案一：原生 WebSocket 主通道 + HTTP POST 无状态发事件（已选定）** | 在单实例 NestJS 中新增独立 `ws` Gateway 承载双向实时流转，复用现有 HTTP Upgrade 按路径分发模式；另提供普通 HTTP POST 发事件接口；元数据/凭证/Retain 落 PostgreSQL，活跃连接/Presence/短窗口缓冲放内存 Hub。 | 双向低延迟最顺滑；浏览器原生 `new WebSocket()` 与各语言后端零门槛；Presence 秒级准确；完全复用 SY 现有 3 个 `ws` 网关与 Nginx 配置模式；给 AI 的接入路径单一明确。 | 极少数禁 WebSocket Upgrade 的严苛企业代理可能连不上；单实例内存路由在未来多副本时需补 Redis Pub/Sub。 |
| **方案二：纯 HTTP（SSE 下行流 + HTTP POST 发事件）** | 订阅走 `GET .../stream`（SSE + `Last-Event-ID`），发送全走 `POST .../events`。 | 纯 HTTP 穿透性最好；不需要维护 WS 帧协议。 | 每次操作都要发独立 HTTP POST，高频双向控制偏重；原生 `EventSource` 同样不支持自定义 Header；只发不收的控制端没有长连接，Presence 无法感知控制端在线状态。 |
| **方案三：WS + SSE + HTTP POST 双协议并行** | 同一内存 Hub 同时挂 WS（双向）和只读 SSE（降级）。 | 兼顾性能与弱网只读降级。 | v1 维护两套传输层、鉴权路径与测试，且给 AI 暴露两种连接模式容易导致生成代码混用和不稳定。 |

**选型结论**：用户选定 **方案一**。未来若确有严苛代理的只读监听需求，由于内存 Hub 与传输层解耦，可作为纯增量能力外挂 SSE 端点，无需返工。

---

## 4. 核心领域模型与数据边界

### 4.1 持久化数据（PostgreSQL / Prisma）

1. **`Channel`（频道）**
   - `id`: `String @id`（建议格式 `ch_<cuid>`，设计者拍板）
   - `ownerId`: `String`（关联 `User.id`，级联删除或随账号清理）
   - `name`: `String @db.VarChar(100)`（显示名称，必填）
   - `description`: `String @default("") @db.VarChar(500)`（可选用途说明）
   - `createdAt` / `updatedAt`: `DateTime`
   - **设计者拍板**：v1 删除频道采用**直接删除**（立即以 `4003` 断开该频道全部连接、级联删除其凭证与 Retain 快照），不做 30 天回收站 UI。

2. **`ChannelToken`（频道专属凭证）**
   - `id`: `String @id`（`cht_<cuid>`）
   - `channelId`: `String`（外键关联 `Channel`，`onDelete: Cascade`）
   - `name`: `String @db.VarChar(80)`（用途备注，如“客厅大屏只读”、“手机遥控器”）
   - `role`: `String @db.VarChar(16)`，枚举仅三值：
     - `subscribe`：仅可建立 WS 监听事件、读取 Presence 与 Retain、更新自身 Presence 元数据；**禁止**发布事件或清除 Retain。
     - `publish`：可通过 WS 或 HTTP POST 发布事件、管理 Retain、查看当前 Presence；**不接收**频道事件广播与 Retain 快照（可收到 `ack`、自身错误帧及 Presence 变化以确认目标端是否在线）。
     - `pubsub`：同时具备订阅与发布权限（适用于双向控制页和自有后端服务）。
   - `tokenHash`: `String @unique @db.VarChar(64)`（SHA-256 哈希；明文仅创建时返回一次，服务端永不落盘明文）
   - `tokenPrefix`: `String @db.VarChar(24)`（如 `syc_xxxxxxxx`，用于列表辨识）
   - `lastUsedAt`: `DateTime?`（按节流周期异步刷新，不阻塞热路径）
   - `revokedAt`: `DateTime?`
   - `createdAt`: `DateTime`
   - **设计者拍板**：默认每频道最多 20 个有效凭证；凭证一经撤销，内存 Hub 立即以 `4003` 断开所有使用该 `tokenId` 鉴权的活跃 WebSocket 连接。

3. **`ChannelRetainedEvent`（频道最新状态快照）**
   - `channelId`: `String`（外键关联 `Channel`，`onDelete: Cascade`）
   - `event`: `String @db.VarChar(64)`
   - `payload`: `Json`（UTF-8 JSON，上限 64 KiB）
   - `seq`: `BigInt`（发布该快照时的频道事件序号）
   - `senderClientId`: `String? @db.VarChar(64)`
   - `senderName`: `String? @db.VarChar(64)`
   - `updatedAt`: `DateTime`
   - 复合唯一键：`@@id([channelId, event])`
   - **设计者拍板**：每频道最多保留 **20 个**不同的 Retain 事件名（超限时拒绝新的不同事件名并返回 `RETAIN_LIMIT_EXCEEDED`，覆盖已有事件名不占新名额）；服务重启后，大屏重连或调用 `GET .../retained` 仍可恢复最近保存的状态。

4. **`UserApiKey` 扩展（复用现有个人 API 密钥表）**
   - 新增 3 个 Scope（注册在 `server/src/api-keys/api-key-capabilities.ts`）：
     - `channels.manage`：管理频道与频道专属凭证。
     - `channels.publish`：向频道发布事件、更新或清除 Retain 快照。
     - `channels.subscribe`：订阅频道事件、读取 Presence 与 Retain 快照。
   - 新增资源边界字段（完全对齐现有 `tableAccessMode` / `tableIds`）：
     - `channelAccessMode`: `String @default("selected") @db.VarChar(16)`（`"selected"` | `"all_owned"`）
     - `channelIds`: `String[] @default([])`
   - 安全不变量：已有 API Key 默认无任何 `channels.*` scope、`channelAccessMode = "selected"`、`channelIds = []`，绝不隐式扩权；仅同时拥有 `all_owned` 与 `channels.manage` 的 API Key 允许通过 Open API 创建新频道（与云表规则一致）。

### 4.2 内存运行时态（单实例 `ChannelHub`）

- **活跃连接表**：`Map<channelId, Map<connectionId, LiveChannelConnection>>`。记录连接身份（`credentialType: "channel_token" | "api_key" | "console_ticket"`、`credentialId`、`ownerId`、`role`、`isObserver`、`clientId`、`clientName`、`meta`、`eventsFilter`、`connectedAt`、`lastPongAt`）。
- **Presence 在线列表**：当前频道内所有**非观察者**（`isObserver === false`）已认证活跃连接的投影（每条连接包含 `connectionId`、`clientId`、`clientName`、`role`、`meta`、`connectedAt`）。**设计者拍板**：
  - 同一 `clientId` 可多端/多标签页同时在线，以服务端分配的 `connectionId` 区分每条物理连接，互不静默顶号；
  - Console 实时调试台连接（`console_ticket`）固定作为**隐身观察者（`isObserver: true`）**：不进入对外 `presence` 列表、不触发 `presence.join`/`leave` 广播、不计入 `onlineCount` 与每频道 100 连接生产配额（单频道独立限制最多 5 个并发调试台连接），从而保证开发者随时打开 Console 排查满载频道，也不会污染大屏或遥控器上的在线人数展示。调试台主动发测试事件时，`sender` 固定标识为 `{ connectionId: null, clientId: "console-debugger", clientName: "Console 调试台" }`。
- **短窗口事件环形缓冲**：每个活跃频道维护最近 **100 条广播事件**（且仅保留 **5 分钟**内，取两者较严格约束）的内存缓冲，配合单调递增序号 `seq`。
  - **设计者拍板（定向事件不进缓冲）**：带 `targetClientId` 的定向事件属于**仅在线实时投递（live-delivery-only）**，**不写入**频道共享环形缓冲，防止自声明 `clientId` 的其他订阅端借重连回放窥探定向回执，也防止高频定向流量挤占广播缓冲。
  - **设计者拍板（`replayTruncated` 精确判定）**：缓冲同时记录 `evictedUpToSeq`（因超出 100 条或超过 5 分钟而真正淘汰掉的最高广播 `seq`，服务重启后初始化为启动前的基准序号）。重连携带 `afterSeq` 时，仅当 `afterSeq < evictedUpToSeq`（或超过当前 `latestSeq`）时返回 `replayTruncated: true`，不会因为定向事件占用了序号而被误判截断。服务重启后 `seq` 保持单调不回退，且客户端携带重启前 `afterSeq` 会收到 `replayTruncated: true` 与完整 `retained` 快照。

---

## 5. 鉴权、安全与隔离模型

### 5.1 身份与通道隔离
- **Open API（`/api/open/v1/channels/...`）与 Open WebSocket（`/api/open/v1/channels/:channelId/ws`）**：
  - **严格忽略 Cookie 和普通 SY 登录 JWT**，只认「频道专属凭证（`syc_...`）」、「个人 API Key（现有 `syk_...` 格式）」或「Console 一次性调试票据」。
  - 这样即使网页托管在同源的 SY Drive Site（`/sites/<siteId>/`），也绝不会发生 Cookie 隐式提权。
- **Console API（`/api/console/channels/...`）**：
  - 使用现有 SY 登录态（`UserAuthGuard`），服务于 Dashboard Console 和桌面 MCP（当前登录账号）。
  - **仅频道所有者可管理**（v1 不做跨 SY 账号的频道协作者 ACL，所有协作端统一通过频道专属凭证接入——**设计者拍板**）。
- **Console 实时调试台建连**：
  - Console 页面调用 `POST /api/console/channels/:channelId/debug-ticket` 获取一个 **60 秒有效、仅限单次使用、绑定该频道的临时调试票据**（内存签发，用完即销，标记 `isObserver: true`、`role: "pubsub"`），再用它通过与外部客户端一致的 `/api/open/v1/channels/:channelId/ws` 建连。

### 5.2 凭证变更与即时生效（设计者拍板）
- **频道专属凭证撤销 / 频道删除**：立即以 `4003` 关闭对应活跃 WS 连接。
- **个人 API Key 变更同步**（通过进程内解耦事件/回调从 `ApiKeyService` 及用户停用逻辑通知 `ChannelHub`，避免模块循环依赖）：
  - API Key 被撤销、当前频道从 `channelIds` 移除、`channelAccessMode` 收缩导致失去该频道权限、或所属用户被停用 → 立即以 **`4003`** 断开受影响连接（提示客户端停止重连）。
  - API Key 仍拥有该频道访问权，但 `channels.publish` / `channels.subscribe` scope 发生变更（如从 `pubsub` 降级为 `subscribe`）→ 立即以 **`4004`** 断开受影响连接（提示客户端重新连接一次以协商最新角色，而不会永久停连）。

### 5.3 WebSocket 凭证传递规范
- **严禁通过 URL Query 传递长效凭证**（如 `?token=...` 一律拒绝/忽略并要求走首帧握手，防止密钥落入代理日志和浏览器历史）。
- **浏览器端（标准路径）**：
  1. 建立连接：`new WebSocket("wss://<host>/api/open/v1/channels/<channelId>/ws")`
  2. 连接打开后 **5 秒内** 发送首帧 `auth` JSON，携带 `token`、可选 `clientId`、`clientName`、`meta`、`events`（事件名白名单过滤，省略即全订阅）、`afterSeq`（断线补发游标）、`includeRetained`（默认 `true`）。
- **外部后端（便捷增强）**：
  - 除首帧 `auth` 外，也允许在 HTTP Upgrade 请求头携带 `Authorization: Bearer <token>`（支持 `syc_...` 或 `syk_...`）。
  - **设计者拍板**：若 Upgrade 头已通过认证，连接打开后服务端立即回 `ready`（使用默认随机 `clientId`、全订阅、包含 Retain）；外部后端若需要自定义 `clientName` / `meta` / `afterSeq`，可改用首帧 `auth` 或在 `ready` 后发 `presence.update`。

### 5.4 CORS 规则
- `/api/open/v1/channels/...` 的 HTTP 端点返回：
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Credentials: false`
  - `Access-Control-Allow-Headers: Authorization, Content-Type`
  - `Access-Control-Expose-Headers: X-Request-Id, Retry-After`
  - `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
- WebSocket Upgrade 不校验 `Origin` 白名单（大屏/遥控器可能来自 Drive Site、本机 `localhost`、静态托管页或原生后端，安全边界由强凭证 + 角色权限保障）。

---

## 6. 线协议与开放接口契约

### 6.1 公共字段约束
- **事件名 `event`**：`^[a-zA-Z0-9._:-]{1,64}$`（禁止空白和控制字符；建议语义化命名如 `slide.next`、`scene.current`、`command.run`）。
- **载荷 `payload`**：任意合法 JSON 值（对象、数组、基础类型或 `null`），序列化后 UTF-8 字节数不超过 **64 KiB**。
- **客户端标识**：
  - `clientId`：可选字符串（1~64 字符，`^[a-zA-Z0-9._:-]+$`），未传时由服务端自动生成随机标识。
  - `clientName`：可选显示名（最长 64 字符，如 `"客厅大屏"`、`"MacMini-Worker"`）。
  - `meta`：可选扁平/浅层 JSON 对象，序列化不超过 **2 KiB**（用于携带设备类型、版本号等 Presence 展示信息）。

### 6.2 WebSocket JSON 帧协议

所有应用层帧均为 UTF-8 JSON 对象，顶层必须有 `type` 字段。

#### 客户端 → 服务端
1. **`auth`**（未通过 Upgrade Header 认证时必须作为首帧在 5s 内发送）
   ```json
   {
     "type": "auth",
     "token": "syc_...",
     "clientId": "remote-phone-1",
     "clientName": "我的手机遥控器",
     "meta": { "kind": "remote" },
     "events": ["screen.*", "command.result"],
     "afterSeq": 120,
     "includeRetained": true
   }
   ```
   - `events` 支持精确事件名或尾部前缀通配（如 `screen.*`，最多 20 条）；省略表示订阅全部事件。
2. **`publish`**（需要 `publish` 或 `pubsub` 角色，或具备 `channels.publish` 的 API Key）
   ```json
   {
     "type": "publish",
     "id": "req-1",
     "event": "slide.next",
     "payload": { "step": 1 },
     "retain": false,
     "echo": false,
     "targetClientId": "big-screen-1"
   }
   ```
   - `id`：可选客户端请求 ID，提供时服务端回传对应 `ack` 帧。
   - `retain`：默认 `false`；为 `true` 时写入/覆盖该事件名 Retain 快照（`payload` 可为任意合法 JSON，包括 `null`）。**`publish` 仅负责发布与写入 Retain，不承担删除快照职责**。
   - `echo`：默认 `false`（不回推给发送本条事件的同一条 `connectionId`，同一频道里的其他匹配连接仍会收到）；设为 `true` 时同时回推给自身。
   - `targetClientId`：可选；填写时仅在线投递给当前频道中 `clientId` 匹配的订阅连接（不进环形缓冲），且**不允许与 `retain: true` 同时使用**。
3. **`retained.clear`**（需要 `publish` 或 `pubsub` 角色，或具备 `channels.publish` 的 API Key；**设计者拍板**）
   ```json
   { "type": "retained.clear", "id": "req-2", "event": "scene.current" }
   ```
   - 仅静默删除持久化的 Retain 快照，**不伪造广播事件帧、不推进 `seq`、不写入环形缓冲**；提供 `id` 时回传 `{ "type": "ack", "id": "req-2", "deleted": true }`。若希望在线大屏立刻切换画面，业务方应显式发布一条重置事件。
4. **`presence.update`**（动态更新自身 `clientName` / `meta`；观察者连接调用直接返回错误或忽略）
   ```json
   { "type": "presence.update", "clientName": "大屏-第3页", "meta": { "page": 3 } }
   ```
5. **`ping`**（应用层心跳，兼容浏览器侧无法直接发 WS 控制帧 ping 的情况）
   ```json
   { "type": "ping" }
   ```

#### 服务端 → 客户端
1. **`ready`**（认证成功立即下发）
   ```json
   {
     "type": "ready",
     "channelId": "ch_...",
     "connectionId": "conn_...",
     "clientId": "remote-phone-1",
     "role": "pubsub",
     "latestSeq": 125,
     "replayTruncated": false,
     "presence": [
       { "connectionId": "conn_...", "clientId": "big-screen-1", "clientName": "客厅大屏", "role": "subscribe", "meta": {}, "connectedAt": "..." }
     ],
     "retained": [
       { "event": "scene.current", "payload": { "scene": "dashboard" }, "seq": 118, "updatedAt": "..." }
     ]
   }
   ```
   - 若客户端传了 `afterSeq` 且有缺口广播事件，服务端在 `ready` 之后紧接着按 `seq` 升序推送补发 `event` 帧（带 `"replayed": true`）。
   - 对 `publish` 角色，仅下发 `presence`（方便遥控器看到大屏或后端在不在线），不推送频道 `event` 流，也不下发 `retained`（避免只发凭证越权读取状态——**设计者拍板**）。
2. **`event`**（实时事件或补发事件）
   ```json
   {
     "type": "event",
     "seq": 126,
     "event": "slide.next",
     "payload": { "step": 1 },
     "retain": false,
     "replayed": false,
     "targeted": false,
     "sender": { "connectionId": "conn_...", "clientId": "remote-phone-1", "clientName": "我的手机遥控器" },
     "sentAt": "2026-11-25T08:00:00.000Z"
   }
   ```
3. **`ack`**（响应带 `id` 的 `publish` 或 `retained.clear`）
   - 响应 `publish`：`{ "type": "ack", "id": "req-1", "seq": 126, "deliveredCount": 2, "retained": false }`
   - 响应 `retained.clear`：`{ "type": "ack", "id": "req-2", "deleted": true }`
4. **`presence.join` / `presence.leave` / `presence.update`**
   ```json
   { "type": "presence.join", "member": { "connectionId": "...", "clientId": "...", "clientName": "...", "role": "subscribe", "meta": {}, "connectedAt": "..." } }
   ```
5. **`pong`**
   ```json
   { "type": "pong", "serverTime": "2026-11-25T08:00:00.000Z" }
   ```
6. **`error`**
   ```json
   { "type": "error", "id": "req-1", "code": "FORBIDDEN_ROLE", "message": "当前凭证仅允许订阅，不能发布事件。" }
   ```

#### 规范 WebSocket Close Codes
- `1000`：正常关闭
- `1001`：服务端重启/维护关闭（客户端应退避重连）
- `4001`：认证超时或认证失败（凭证无效/频道不存在）
- `4003`：凭证被撤销、频道访问权被移除、账号停用或频道已删除（客户端应停止盲目重连）
- `4004`：API Key 角色/scope 变更（仍可访问该频道，客户端应重连一次以协商新角色）
- `4008`：心跳超时或慢消费者发送队列堆积超限（可重连）
- `4029`：连接数超限或持续触发限流

### 6.3 Open HTTP REST API（`/api/open/v1/channels`）

所有响应遵循现有 Open API 规范（返回 `X-Request-Id`、`Cache-Control: no-store`，错误形状 `{ requestId, error: { code, message } }`），均通过 `Authorization: Bearer <token>` 认证：

- **运行态接口（接受个人 API Key 或频道专属凭证）**：
  - `POST /api/open/v1/channels/:channelId/events`（需 `publish`/`pubsub` 凭证或 `channels.publish` API Key）
    - 请求体：`{ event, payload, retain?, targetClientId?, senderClientId?, senderName? }`
    - 响应 `200`：`{ seq, deliveredCount, retained, sentAt }`
  - `GET /api/open/v1/channels/:channelId/presence`（需任意有效频道凭证或 `channels.subscribe`/`channels.publish` API Key）
    - 响应 `200`：`{ channelId, count, members: [...] }`
  - `GET /api/open/v1/channels/:channelId/retained`（需 `subscribe`/`pubsub` 凭证或 `channels.subscribe` API Key）
    - 响应 `200`：`{ channelId, items: [...] }`
  - `DELETE /api/open/v1/channels/:channelId/retained/:event`（需 `publish`/`pubsub` 凭证或 `channels.publish` API Key）
    - 静默删除指定 Retain 快照（不广播事件、不推进 `seq`）；响应 `200`：`{ deleted: boolean }`
- **管理态接口（仅接受带 `channels.manage` 的个人 API Key，拒绝频道专属凭证）**：
  - `GET /api/open/v1/channels`（列出当前密钥可见频道，含实时 `onlineCount` 与 `tokenCount`）
  - `POST /api/open/v1/channels`（仅 `all_owned + channels.manage` 可建）
  - `GET / PATCH / DELETE /api/open/v1/channels/:channelId`
  - `GET / POST /api/open/v1/channels/:channelId/tokens`、`DELETE /api/open/v1/channels/:channelId/tokens/:tokenId`（撤销）

---

## 7. 资源治理、限额与部署边界

### 7.1 限额默认值（设计者拍板，集中配置化）
- 单条事件 payload：最大 **64 KiB**；WS 单帧最大 **128 KiB**；HTTP POST 请求体最大 **128 KiB**。
- 并发连接数：单频道最多 **100** 条生产连接（另留最多 **5** 条 Console 调试台观察者连接）、单账号总计最多 **300** 条、全局最多 **2000** 条。
- 速率限制：单连接默认持续 **10 次/秒**（突发桶 **30**）；HTTP POST 发布默认按频道 **30 次/秒**（突发 **60**）；超限返回 `RATE_LIMITED` / HTTP `429` + `Retry-After`，WS 持续违规直接断连（`4029`）。
- 慢消费者保护：向某连接写帧前检查 `ws.bufferedAmount > 512 KiB`，超限直接以 `4008` 断开，不阻塞其他订阅者。
- 心跳保活：服务端每 **25 秒** 发原生 WS `ping`，连续错过 **2 次**（约 50~60s 无响应）断开清理；同时响应客户端应用层 `ping` 帧。
- 优雅停机：在 `server/src/main.ts` 注册关闭钩子，停机时向所有活跃频道连接发送 `1001` 关闭帧，不阻塞 HTTP 优雅退出期限。

### 7.2 服务端集成与 Nginx 配置
- `server/src/main.ts`：
  - 将 `ChannelGateway`（位于 `server/src/channels/`）挂载到同一个 HTTP Server（与 `LiveDesktopGateway`、`DriveCollaborationGateway`、`MobileLiveGateway` 共享 `upgrade` 事件，严格按 pathname 匹配 `/api/open/v1/channels/:channelId/ws` 认领）。
  - 注册 `channelCors` 与请求体大小/JSON 错误处理（对齐 `cloud-table-http.ts` 模式）。
- `server/nginx.conf`（同步补充 `server/src/deploy-config.spec.ts` 回归测试）：
  - 新增 WS 专属块 `location ~* ^/api/open/v1/channels/[^/]+/ws/?$`：`access_log off`、`proxy_set_header Upgrade $http_upgrade`、`proxy_set_header Connection $connection_upgrade`、`proxy_read_timeout 3600s`、`proxy_send_timeout 3600s`、`proxy_buffering off`。
  - 新增 HTTP 专属块 `location ~* ^/api/(?:open/v1|console)/channels(?:/|$)`：`access_log off`、`client_max_body_size 256k`、`proxy_set_header Upgrade ""`、`proxy_set_header Connection ""`。

---

## 8. 三大产品入口设计

### 8.1 Dashboard Console 管理页（`dashboard/src/features/channels/`）
- **产品名称与路由**：导航项与页面主标题统一命名为 **「频道」**，路由为 `/_authenticated/channels/`，严格遵循 `dashboard/CLAUDE.md` 与 `dashboard/DESIGN.md`（HeroUI v3、共享 Header/Main、ServerDataTable、无自定义字面色与卡片套卡片，桌面与窄屏均验收）。
- **页面结构**：
  - 频道目录列表（名称、频道 ID 一键复制、当前在线数、有效凭证数、创建时间、新建/删除）。
  - 频道详情页签：
    1. **实时调试台（默认页签）**：点击「连接调试」通过一次性调试票据连入真实 WS（隐身观察者，不干扰生产 Presence），展示实时连接状态、当前在线成员列表（含 `clientName`/`role`/`meta`）、滚动事件日志流（支持暂停滚动、按事件名过滤、清空本地视图、查看 JSON 载荷），以及快捷发送面板（事件名、JSON 载荷、是否 Retain、可选目标 `clientId`、发送按钮）。
    2. **接入凭证**：按角色（仅订阅 / 仅发布 / 双向）创建凭证，明文弹窗仅创建时展示一次并提供一键复制；列表展示名称、角色、前缀、最近使用时间及「撤销」确认操作（撤销即提示将断开使用该凭证的在线连接）。
    3. **Retain 状态**：查看当前频道保存的全部 Retain 事件名、最新载荷与更新时间，支持单条静默清除。
    4. **接入示例**：自动填好当前服务地址与 `channelId`，给出浏览器 WebSocket（含自动重连与 `afterSeq` 补发）、Node/Python 后端、以及 `curl` HTTP POST 示例，支持一键复制。
    5. **设置**：修改名称与说明、删除频道（二次确认）。
- **API Key 设置页联动**：在现有个人 API Key 创建/编辑弹窗中，复用云表资源选择器的交互模式，新增「频道」分组下的 3 个 `channels.*` scope 及频道范围选择（指定频道 / 全部自有频道）。

### 8.2 开放接口文档（`document/open-api/api/channels.md`）
- 将 Open HTTP API 纳入 `server/src/open-api/open-api-contract.ts`（`/api/open/openapi.json` 自动包含频道 REST 端点）。
- 在文档站新增 `document/open-api/api/channels.md`（页面标题为「频道」，并挂入开放文档侧栏导航），支持整页复制为 Markdown 给 AI 使用，内容覆盖：
  - 概念及与云端数据表的分工；
  - 凭证类型与角色权限矩阵（强调浏览器端使用频道凭证 + 首帧 `auth`，禁止进 URL）；
  - 完整 WS 帧格式、断线重连 + `afterSeq` 补发范式、Close Codes（含 `4003` 停连与 `4004` 重连刷新角色）；
  - HTTP REST 端点与错误码；
  - 两个可直接套用的端到端场景模板：① 大屏展示页 + 手机遥控器页；② 外部 Node/Python 服务 + 手机控制页。

### 8.3 桌面端 MCP 工具与系统 Skill
- 新增独立能力域 `channels`（参考 `desktop/app-capabilities/cloud-tables/` 结构，目录为 `desktop/app-capabilities/channels/`），不注册 System App、Dock、Workflow Node、Automation Action 或 Deep Link，仅通过现有 MCP `search` / `invoke` 路由暴露。
- 认证方式与云端数据表一致：使用当前桌面登录账号（`AccountService.fetchAuthenticated`）访问 `/api/console/channels/...`，全部网络/写操作经过 `PermissionGuard` 和 `AuditSink`，绝不向用户索要个人 API Key。
- **规划工具清单（共 12 项 capability / MCP 索引）**：
  1. `app_channels_publish_preflight_get`：返回当前登录账号、公网 HTTP/WS 基址与频道能力就绪状态，供 AI 生成可直连网页。
  2. `app_channels_channel_list`：列出当前账号频道及在线数/凭证数摘要。
  3. `app_channels_channel_get`：查看单个频道详情。
  4. `app_channels_channel_create`：创建频道。
  5. `app_channels_channel_update`：修改频道名称/说明。
  6. `app_channels_channel_delete`：删除频道并断开所有连接。
  7. `app_channels_token_list`：查看频道凭证列表（不含明文）。
  8. `app_channels_token_create`：为指定角色（`subscribe`/`publish`/`pubsub`）签发频道凭证，返回一次性明文供 AI 写入生成的网页或服务配置。
  9. `app_channels_token_revoke`：撤销频道凭证并踢断对应连接。
  10. `app_channels_event_publish`：向频道发一条实时事件（可选 `retain` / `targetClientId`），用于 AI 验收或触发操作。
  11. `app_channels_state_get`：一次性读取频道当前在线 Presence 列表与 Retain 快照，方便 AI 排查大屏/后端是否在线及当前状态。
  12. `app_channels_retained_clear`：静默清除指定事件名的 Retain 快照。
- **同步文档与路由更新**：
  - 在 `desktop/app-capabilities/synapse-skill/skill-package/` 新增 `channels/index.md` 及场景配方（如「一句话做大屏+手机遥控器」「网页控制本机/自有后端」），更新 `SKILL.md` 路由表；
  - 更新 `desktop/electron/services/agent-runtime/synapse-tool-router` 关键词，让“频道”“实时控制”“遥控器”“大屏联动”“网页和后端实时通信”等自然语言精准命中 `channels`（需要发布静态网页时自动串联 Drive 网页分享工具）；
  - 更新 `docs/agents/capability-registry.md` 的能力数量与域表格，并按规范记录 `RELEASE_NOTES_PENDING.md`。

---

## 9. 验收标准与测试策略

- **服务端单测与集成测试（隔离本地 PostgreSQL）**：
  - 凭证与权限矩阵：`subscribe` 不能发事件/清 Retain、`publish` 不收到事件广播与 Retain、Cookie 不在 Open API/WS 提权、`UserApiKey` 的 `selected`/`all_owned` 与已有密钥不扩权、撤销频道凭证或 API Key / 移除频道访问权立即 `4003` 踢断活跃 WS、API Key scope 降级立即 `4004` 促重连；
  - 实时流转：多客户端广播、`echo` 开关、`targetClientId` 定向在线投递（不入缓冲且拒绝 `retain: true`）、事件名通配过滤、HTTP POST 触发后 WS 实时收到且返回准确 `deliveredCount`；
  - Presence 与补发：上下线通知、`presence.update`、Console 调试台隐身观察者不进入 Presence 且不受生产连接上限阻塞、断线携带 `afterSeq` 补发（不受定向事件序号干扰）、超窗口返回 `replayTruncated: true`、Retain 写入/覆盖/静默清除/超 20 项拒绝/重启后可恢复；
  - 资源治理：5 秒认证超时断连、URL query 传 token 拒绝、超 payload 拒绝、单连接/单频道/全局限额、限流、慢消费者断开、优雅停机发送 `1001`；
  - 部署与契约：`deploy-config.spec.ts` 覆盖 `nginx.conf` 新增规则、`open-api-contract.spec.ts` 覆盖新 REST 契约。
- **Dashboard UI 测试**：组件单测 + 桌面/窄屏自动化浏览验收（含下拉菜单、弹窗展开状态与实时调试台交互）。
- **Desktop MCP 测试**：dispatcher 权限/审计/账号隔离单测、`synapse-tool-router` 发现单测、`check:hard-constraints`、`synapse-skill` 包完整性测试。

---

## 10. 留给实现者决定的事项（What's Left to the Builder）

以下细节无需回访产品决策，实现者按仓库既有约定自行决定：
- Prisma 表/索引的精确物理命名与 migration SQL 拆法（频道 DB 读写低频，仅在建连鉴权、管理与 Retain 写入时触库，可直接复用主 Prisma 并对 `lastUsedAt` 做内存节流批更新）。
- 频道 `seq` 在进程重启后保持单调不回退的具体实现（例如在 `Channel` 持久化 `seqEpoch` 或基于启动时间基线与 `max(retained.seq)` 计算）。
- 进程内 `ApiKeyService` → `ChannelHub` 权限变更通知的具体解耦写法（如轻量事件总线或回调注册器）。
- Console 调试台的本地日志条数上限（如浏览器内存保留最近 200 条）与 JSON 格式化组件复用。
- 文档站侧边栏排序与多语言示例（Node / Python / 原生浏览器 HTML）的具体代码组织。

---

## 11. 设计者拍板项汇总（供审阅时重点核对）

1. **Retain 持久化与清除语义**：Retain 最新状态轻量落 PostgreSQL（每频道最多 20 个事件名），服务重启后大屏刷新仍可恢复；清除快照走独立操作（`DELETE /retained/:event`、WS `retained.clear`、Console/MCP），只静默删快照、不伪造业务事件帧。
2. **频道生命周期**：v1 删除频道直接断开全部连接、作废凭证并删除，不做 30 天回收站 UI。
3. **无跨账号频道协作者 ACL**：频道管理仅归所有者；所有外部协作端统一通过频道专属凭证接入。
4. **`publish` 角色边界**：仅发布凭证可查看 Presence（确认大屏/后端是否在线），但不下发频道事件流和 Retain 快照。
5. **定向投递 `targetClientId`**：允许事件只在线投递给指定 `clientId`（禁止 `retain: true`，不写入共享环形缓冲），方便自有后端把执行结果单独回传给发起操作的网页，同时避免被重放或挤占广播缓冲。
6. **Console 调试台隐身观察者**：Console 调试台通过一次性票据连真实 WS，但不计入对外 Presence、不触发上下线通知、不占生产 100 连接配额（单频道另设 5 个调试台上限）。
7. **API Key 权限实时联动**：撤权/移出频道立即 `4003` 断开（停连），仅 scope 变更立即 `4004` 断开（重连刷新角色）；v1 不做服务端 `Idempotency-Key` 幂等回执表。
8. **默认资源上限**：单事件 64 KiB、单频道 100 生产连接 / 20 凭证 / 20 Retain 键、单账号 300 连接、全局 2000 连接、认证超时 5 秒、心跳 25 秒。
