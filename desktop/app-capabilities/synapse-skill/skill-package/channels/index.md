# Synapse 频道（Channels）

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

Use this guide for **频道（Channels）** — lightweight realtime WebSocket + HTTP signaling between webpages, mobile controllers, and user-owned backend services (大屏与手机遥控器联动、网页按钮实时控制自有后端服务). This is the server-backed `channels` MCP domain.

完整的一句话实战流程（大屏 + 手机遥控器、网页控制自有后端）请阅读 [频道场景实战指南](remote-screen.md)。

## 身份、凭证与安全边界

- Management operations through MCP use the currently signed-in Synapse desktop account. Never ask the user for a personal API key to run MCP tools.
- Discover with `search({ domain: "channels" })`, then search for the exact tool name before calling `invoke`.
- If the tool returns `CHANNEL_ACCOUNT_REQUIRED`, ask the user to sign into Synapse Desktop and check its connection. If the tool returns `CHANNEL_ACCOUNT_CHANGED`, stop and rediscover targets under the new identity.
- Runtime external clients connect to `/api/open/v1/channels/{channelId}/ws` (WebSocket) or `/api/open/v1/channels/{channelId}/events` (HTTP POST) using **channel tokens (`syc_...`)** or personal `UserApiKey` with channel scopes. Runtime endpoints **ignore Synapse login cookies and reject URL query tokens** (`?token=...` returns HTTP `400`).
- Browser WebSocket clients must authenticate via the **first WebSocket frame** (`{"type":"auth","token":"syc_..."}`) within 5 seconds. Node.js / Python / Go services may use either the `Authorization: Bearer <token>` Upgrade header or the first-frame `auth`.
- Always issue **minimal-privilege** channel tokens per client role:
  - `subscribe`: read-only subscribers (e.g., big screen display page).
  - `publish`: write-only publishers (e.g., phone remote controller webpage).
  - `pubsub`: bidirectional clients (e.g., user-owned backend worker receiving commands and sending targeted replies).
- Do not quote or log plaintext `syc_...` secrets in user-facing logs or commit them to public repositories.

## 工具清单（12 个）

| 工具名 | 用途 |
|---|---|
| `app_channels_publish_preflight_get` | 检查当前桌面登录账号、公网地址（`local_only` / `external_verification_required` / `environment_mismatch`）与频道能力 |
| `app_channels_channel_list` | 列出本人名下的频道（含 `onlineCount` 与 `tokenCount`） |
| `app_channels_channel_get` | 读取单个频道详情 |
| `app_channels_channel_create` | 创建新频道，返回 `id` |
| `app_channels_channel_update` | 修改频道名称或用途说明 |
| `app_channels_channel_delete` | 永久删除频道（无回收站），立即以 `4003` 踢断在线连接并销毁凭证与 Retain 状态 |
| `app_channels_token_list` | 列出频道当前有效凭证（仅前缀与角色，不返回明文） |
| `app_channels_token_create` | 签发角色凭证（`subscribe` / `publish` / `pubsub`，单频道最多 20 个），明文 `secret` 仅返回一次 |
| `app_channels_token_revoke` | 撤销凭证并立即以 `4003` 踢断该凭证对应的在线连接 |
| `app_channels_event_publish` | 向频道发布事件（默认广播，支持 `retain: true` 或 `targetClientId` 定向投递，二者互斥） |
| `app_channels_state_get` | 查看频道当前 `latestSeq`、在线成员（Presence）与已保存的 Retain 状态快照 |
| `app_channels_retained_clear` | 静默删除某个精确事件名的 Retain 快照（不推送新事件） |

## 核心语义与硬限额

- **广播与定向**：默认广播给频道内所有订阅者；指定 `targetClientId` 时仅实时投递给匹配 `clientId` 的在线连接（不进补发缓冲、不可与 `retain: true` 组合）。
- **Retain 状态快照**：事件携带 `retain: true` 时在服务端按事件名覆盖保存最新一帧（单频道最多 20 个不同事件名），新订阅者连接且 `includeRetained: true` 时自动收到。清空需调用 `app_channels_retained_clear`（或 WS `retained.clear` / Open HTTP `DELETE /retained/{event}`）。
- **断线补发**：广播事件保留最近 100 条 / 5 分钟内存环形缓冲；客户端重连在 `auth` 帧携带 `afterSeq` 可补发遗漏事件，超出窗口时 `ready.replayTruncated = true`。
- **硬限额**：`payload <= 64 KiB`、`meta <= 2 KiB`、单帧/HTTP Body `<= 128 KiB`、单频道最多 100 业务连接。频道只做实时信令与最新状态，不做持久化消息队列或历史消息归档。
