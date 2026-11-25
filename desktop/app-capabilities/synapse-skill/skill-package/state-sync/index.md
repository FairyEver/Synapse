# Synapse 状态同步（State Sync）

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

Use this guide for **状态同步（State Sync）** — zero-SY-login realtime mutable JSON state trees (类似野狗 / Firebase Realtime Database) for multiplayer web games, collaborative boards, shared room state, and live synced JSON documents. This is the server-backed `state_sync` MCP domain.

完整的一句话实战流程（零后端多人联机小游戏 / 协同网页生成与发布）请阅读 [多人联机小游戏实战指南](multiplayer-game.md)。

## 三大能力选型边界（Cloud Tables vs Channels vs State Sync）

| 能力 | 适用场景 | 数据模型 |
|---|---|---|
| **云端数据表（Cloud Tables）** | 活动报名页、问卷、匿名表单收集、结构化多字段筛选/分页/报表 | 持久化行记录表（Schema + Filter/Sort/Pagination） |
| **频道（Channels）** | 大屏与手机遥控器联动、网页按钮实时控制自有后端服务、瞬时指令转发 | 实时发布/订阅事件流 + 定向投递 + 少量 Retain 快照，不维护 JSON 状态树 |
| **状态同步（State Sync）** | 多人联机小游戏、开房间对战、在线协同白板、实时共享 JSON 状态树 | Space（同步空间）→ 动态 Doc（房间 JSON 树）+ 路径级订阅 + CAS 事务（`transaction`）+ 掉线自动清理（`onDisconnect`）+ 在线成员（Presence） |

## 身份、凭证与安全边界

- Management operations through MCP use the currently signed-in Synapse desktop account. **Never ask the user for a personal API key to run MCP tools.**
- Discover with `search({ domain: "state_sync" })`, then search for the exact tool name before calling `invoke`.
- If a tool returns `STATE_SYNC_ACCOUNT_REQUIRED`, ask the user to sign into Synapse Desktop and check its connection. If it returns `STATE_SYNC_ACCOUNT_CHANGED`, stop and rediscover targets under the new identity.
- Runtime external clients connect to `/api/open/v1/state-sync/spaces/{spaceId}/docs/{docId}/ws` (WebSocket) or `/api/open/v1/state-sync/...` (Open HTTP REST) using **space tokens (`sys_...`)** or personal `UserApiKey` (`syn_sk_...`) with `state_sync.*` scopes.
- Runtime endpoints **strictly ignore Synapse login cookies and never accept URL query tokens**: WebSocket `?token=...` returns HTTP `400`; Open HTTP endpoints require `Authorization: Bearer <token>` and return HTTP `401` when missing.
- Browser WebSocket clients authenticate via the **first WebSocket frame** (`{"type":"auth","token":"sys_...","paths":["/"]}`) within 5 seconds (handled automatically by the official SDK). Never embed personal `syn_sk_...` API keys in browser code.
- Always issue **minimal-privilege space tokens (`sys_...`)** per client role:
  - `read`: read-only spectators (cannot mutate or create rooms).
  - `write`: participants in pre-created rooms (can read/mutate/register `onDisconnect`, cannot create rooms).
  - `create_write`: browser hosts/players who need to open new rooms dynamically via `client.createRoom()`.
- **Space `create_write` vs custom `docId` rule**:
  - A space token (`sys_...`) with role `create_write` can call `client.createRoom()` to create rooms dynamically, **but MUST NOT pass a custom `docId`** (passing `docId` with a space token returns `403 FORBIDDEN_ROLE`; omit `docId` so the server generates a random `ssd_...` ID).
  - Passing a custom `docId` (3-64 chars `[a-zA-Z0-9._:-]`) is a management privilege reserved for Console, MCP `app_state_sync_doc_create`, or personal API keys (`syn_sk_...`) with `state_sync.manage`.
- Do not quote or log plaintext `sys_...` secrets in user-facing logs or commit them to public repositories.

## 工具清单（14 个）

| 工具名 | 用途 |
|---|---|
| `app_state_sync_publish_preflight_get` | 检查当前桌面登录账号、公网 HTTP/WS 地址（`local_only` / `public` / `environment_mismatch`）、`/sdk/manifest.json`、最新 SDK 版本与直引 URL |
| `app_state_sync_space_list` | 列出本人名下的同步空间（含 `docCount`、`onlineCount`、`tokenCount`、`defaultDocTtlSeconds`、`maxDocs`） |
| `app_state_sync_space_get` | 读取单个同步空间详情 |
| `app_state_sync_space_create` | 创建新同步空间（可配默认房间 TTL 与最大房间数），返回 `id` |
| `app_state_sync_space_update` | 修改同步空间名称、说明、默认房间 TTL 或最大房间数 |
| `app_state_sync_space_delete` | 永久删除同步空间（无回收站），立即以 `4003` 踢断在线连接并销毁所有凭证与房间 |
| `app_state_sync_token_list` | 列出同步空间当前有效凭证（仅前缀与角色，不返回明文） |
| `app_state_sync_token_create` | 签发空间角色凭证（`read` / `write` / `create_write`，单空间最多 20 个），明文 `sys_...` 仅返回一次 |
| `app_state_sync_token_revoke` | 撤销空间凭证并立即以 `4003` 踢断使用该凭证的在线连接 |
| `app_state_sync_doc_list` | 列出同步空间下未过期房间（支持 `limit` 1-200 与 `cursor` 分页，含 `rev`、`onlineCount`、`expiresAt`） |
| `app_state_sync_doc_create` | 在同步空间内创建房间（管理权限支持可选自定义 `docId`、`initialData` 与 `ttlSeconds`） |
| `app_state_sync_doc_get` | 读取房间根路径或指定子路径（`path`，默认 `/`）的 JSON 快照、`rev` 与 `exists` |
| `app_state_sync_doc_mutate` | 对房间指定路径执行原子 `set` / `patch` / `delete`（支持 `expectedRev` CAS 乐观锁），并实时广播给在线连接 |
| `app_state_sync_doc_delete` | 永久删除房间并立即以 `4003` 踢断该房间内所有在线连接 |

## 开放 SDK 清单与精确 API 签名

调用 `app_state_sync_publish_preflight_get` 即可获得当前部署的 `sdkManifestUrl`（`<publicAppUrl>/sdk/manifest.json`）、`stateSyncSdkManifestUrl`（`<publicAppUrl>/sdk/state-sync/manifest.json`）、`latestStateSyncSdkVersion` 以及四个免安装静态直引地址：
- 浏览器全局变量（`window.SynapseStateSync`）：`<publicAppUrl>/sdk/state-sync/v1/state-sync.global.min.js`
- 浏览器 / Node 22+ 原生 ESM：`<publicAppUrl>/sdk/state-sync/v1/state-sync.esm.min.js`
- Node CommonJS：`<publicAppUrl>/sdk/state-sync/v1/state-sync.cjs`
- TypeScript 类型声明：`<publicAppUrl>/sdk/state-sync/v1/index.d.ts`

所有 SDK 方法均零外部依赖，真实签名如下（以 `sdk/src/state-sync/index.ts` 为准）：

```javascript
// 1. 创建客户端（浏览器全局为 window.SynapseStateSync.createClient）
const client = createClient({
  baseUrl: "<publicAppUrl>",
  spaceId: "<spaceId>",
  token: "sys_...",
  // 可选：WebSocket, fetch, heartbeatIntervalMs, reconnectBaseDelayMs, reconnectMaxDelayMs
});

// 2. 创建房间（默认自动连入并返回 { docId, rev, expiresAt, wsPath, room }；
//    传 connect: false 时仅建房不连 WS，返回 { docId, rev, expiresAt, wsPath }）
//    注意：使用空间凭证（create_write）时不要传 docId，由服务端生成随机 ssd_ ID
const { docId, room } = await client.createRoom({
  initialData: { board: [], turn: "X" },
  ttlSeconds: 3600,
  clientId: "player-1",
  clientName: "玩家 1",
  meta: { seat: "X" },
  paths: ["/"],
});

// 3. 加入已有房间（首参数为 docId 字符串，返回 StateSyncRoom）
const joinedRoom = await client.join(docId, {
  clientId: "player-2",
  clientName: "玩家 2",
  meta: { seat: "O" },
  paths: ["/"],
});

// 4. 免建 WS 长连接的轻量 HTTP 快照读取
const snap = await client.getSnapshot(docId, "/turn");

// 5. 房间读写与路径监听（on 会立即用当前镜像回调一次，返回取消订阅函数）
const val = room.get("/turn");
const off = room.on("/board", (value, meta) => {
  // meta: { rev, path, exists }
});
await room.set("/turn", "O", { expectedRev: room.rev, echo: false });
await room.patch("/players/p1", { ready: true });
await room.delete("/players/p1");

// 6. CAS 乐观锁事务（遇 REV_CONFLICT 自动等待新 rev 并重试，默认 maxRetries: 5）
const tx = await room.transaction("/seats/X", (current, { abort, remove }) => {
  if (current) return abort();    // 中止提交，返回 { committed: false, rev, value }
  // return remove();             // 删除该路径，返回 { committed: true, rev, value: undefined }
  return { clientId: "player-1", joinedAt: Date.now() };
});

// 7. 掉线自动清理遗愿动作（最多 8 条，断线重连后 SDK 会自动重新注册）
await room.onDisconnect([
  { op: "delete", path: "/players/player-1" },
  { op: "patch", path: "/meta", value: { lastLeft: "player-1" } },
]);
await room.clearOnDisconnect();

// 8. 在线感知与连接状态
const offPresence = room.onPresence((members) => { /* StateSyncPresenceMember[] */ });
room.updatePresence({ clientName: "新昵称", meta: { ready: true } });
const offStatus = room.onStatus((status) => { /* connecting | connected | reconnecting | closed */ });

// 9. 主动离开房间并关闭连接
room.close();
```

## 核心限额

- 单文档（房间）上限 `256 KiB`，单次写入载荷上限 `64 KiB`，单帧 WS / HTTP Body 上限 `128 KiB`（WS）/ `256 KiB`（HTTP），Presence `meta` 上限 `2 KiB`。
- 路径深度最多 `16` 层，单连接最多订阅 `32` 条路径，单连接最多注册 `8` 条 `onDisconnect` 动作。
- 单空间默认最多 `100` 个未过期房间（最高可配 `500`）、最多 `20` 个有效凭证；单房间最多 `50` 个并发连接；房间 TTL 范围 `60` 秒至 `2592000` 秒（30 天），默认 `86400` 秒（24 小时）。
