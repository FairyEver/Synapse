# 频道场景实战指南（大屏+手机遥控器 / 网页控制自有后端）

示例请求：
- 「帮我做一个大屏展示页和配套的手机遥控器网页，手机点按钮大屏实时切换。」
- 「我有一个本地/内网的 Node.js 服务，帮我做一个手机网页，按按钮能实时控制我的服务并把执行结果回显到手机上。」

## 1. 发布前检查（必须先做）

调用 `app_channels_publish_preflight_get`（参数 `{}`），核对 `accountId`、`publicAppUrl`、`audience` 和 `capabilities`：

| `audience` | 处理方式 |
|---|---|
| `local_only` | 当前环境仅限本机访问，生成的网页链接与 `ws://` 地址不能给手机外网使用；需向用户如实说明。 |
| `public` | 已配置公网地址；确认 `publicAppUrl` 为 `https://` 后使用 `wss://<origin>/api/open/v1/channels/{channelId}/ws`（若非 HTTPS 需先提醒用户并停下）。 |
| `environment_mismatch` | 桌面端配置地址与当前登录服务端公网地址不一致，先向用户说明地址问题并停下，不继续建频道或发布网页。 |

## 2. 场景 A：大屏展示页 + 手机遥控器

1. **创建频道**：调用 `app_channels_channel_create`，记录返回的 `channelId`。
2. **按最小权限签发两把角色凭证**：
   - 大屏页：`app_channels_token_create`（`role: "subscribe"`），得到 `screenToken`。
   - 手机遥控页：`app_channels_token_create`（`role: "publish"`，若遥控页也需要看大屏当前页码则用 `"pubsub"`），得到 `remoteToken`。
3. **初始化状态（可选）**：如需大屏首次打开即显示初始画面，调用 `app_channels_event_publish` 发送一条 `retain: true` 的初始状态事件（如 `slide.state`）。
4. **编写两个自包含页面**（或同一站点目录下的 `screen.html` + `remote.html` + `index.html`）：
   - 连接 `wss://<publicOrigin>/api/open/v1/channels/<channelId>/ws`，在 `ws.onopen` 发送首帧 `auth`（严禁把 token 拼到 URL query 里）：
     ```json
     {"type":"auth","token":"<token>","clientId":"screen-1","clientName":"客厅大屏","afterSeq":0,"includeRetained":true}
     ```
   - 大屏页监听 `ready`、`event` 更新画面并维护 `lastSeq`，断线后做指数退避重连并在 `auth` 中传 `afterSeq: lastSeq`。
   - 手机遥控页发送 `{"type":"publish","id":"req-1","event":"slide.state","payload":{"index":2},"retain":true}`（或调用 `POST /api/open/v1/channels/<channelId>/events` 附带 `Authorization: Bearer <remoteToken>`）。
   - 如果页面面向公网分享，不要直接把长期写权限明文暴露给陌生人；可采用页面打开时通过 URL hash（`#token=...`，不会发往服务器日志）或输入框读取凭证，并按需随时用 `app_channels_token_revoke` 轮换。
5. **发布网页**：在云盘中建子文件夹上传页面并用**网页分享**发布（`app_drive_folder_upload` + `app_drive_site_create`），把 `/sites/<siteId>/` 链接单独成行返回给用户。**不要使用单文件分享**（单文件 HTML 分享预览会展示源码）。
6. **实测验收**：用 `app_channels_state_get` 核对 Retain 状态与在线成员，并用 `app_channels_event_publish` 验证实时事件投递。

## 3. 场景 B：手机网页实时控制自有后端服务

1. **创建频道并签发两把凭证**：
   - 自有后端服务：`role: "pubsub"`（接收指令并定向回传结果）。
   - 手机控制网页：`role: "pubsub"`（发送指令并接收后端回传结果；若只发不看回执则用 `"publish"`）。
2. **自有后端主动外连 Synapse（无需暴露公网端口）**：
   - 使用 `ws` 连接 `wss://<publicOrigin>/api/open/v1/channels/<channelId>/ws`。如果手机网页需要按固定 `targetClientId: "worker-1"` 定向投递，后端应在连接建立后通过首帧 `auth` 认证并显式传入 `"clientId": "worker-1"`（使用 Upgrade Header `Authorization: Bearer <SY_CHANNEL_TOKEN>` 认证时，服务端会分配随机 `clientId`，此时手机端需通过 Presence 发现后端的 `clientId`）。
   - 收到 `type === "event"` 且 `event === "command.run"` 时执行对应本地操作，并通过 `targetClientId: msg.sender.clientId` 定向回传 `command.result`（**不要**对定向回复设置 `retain: true`）。
3. **手机网页**：
   - 首帧 `auth` 指定唯一 `clientId`（例如 `phone-xxxx`），点击按钮时发送 `event: "command.run"` 并指定 `targetClientId: "worker-1"`，监听 `command.result` 渲染结果。
   - 通过 `presence`（`ready.presence` / `presence.join` / `presence.leave`）实时显示后端服务是否在线。
4. **交付清单**：返回频道 ID、网页站点链接、自有后端接入代码与环境变量说明（提示把 `SY_CHANNEL_TOKEN` 放在环境变量中，不硬编码进仓库）。
