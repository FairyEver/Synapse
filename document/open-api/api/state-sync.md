# 状态同步

为协同协作、轻量多人游戏、在线白板、表单草稿与分布式实时任务提供免 SY 登录的响应式可变 JSON 状态树。

- **与云端数据表、频道的分工**：
  - **云端数据表**：负责多字段结构化数据持久化存储、复杂条件检索（Filter/Sort）、分页查询与基于用户/协作者的细粒度权限控制，适合业务表单与报表。
  - **频道**：负责低延迟实时事件转发（pub/sub）、定向投递、轻量在线感知（Presence）、短窗口重传与少量 Retain 快照，不保存状态树，适合瞬时无状态通信。
  - **状态同步**：负责分布式可变 JSON 文档树的实时维护与双向同步。支持空间与房间模型（Space -> dynamic Doc）、路径级细粒度读写与订阅、CAS 乐观并发控制（rev）、原子事务（`room.transaction`）、客户端离线清理遗愿动作（`onDisconnect`）与在线感知（Presence）。
- **整页可复制给 AI**：本页包含完整的 WebSocket 线协议、HTTP REST 契约、Close Codes、错误码速查、SDK 快速上手指南与完整可运行场景模板，可直接整页复制给 AI 编写接入代码。

[打开 OpenAPI 契约]({{APP_PUBLIC_URL}}/api/open/openapi.json) 查看当前部署版本的完整 REST Schema。所有 REST 路径均挂载在 `{{APP_PUBLIC_URL}}/api/open/v1` 下。

---

## 桌面端 MCP 快速接入

已登录 Synapse 桌面端的 AI 可通过现有 MCP `search` / `invoke` 查找 `state_sync`（工具前缀 `app_state_sync_*`），直接使用当前桌面登录账号完成发布前检查、创建空间、签发最小权限凭证、查看房间与在线状态，无需向用户索要个人 API 密钥。

---

## 架构模型：Space 与 Doc

- **同步空间（Space）**：作为多房间（Doc）的命名空间与资源配额边界。每个空间拥有专属的一组访问凭证（`sys_...`），并配置默认房间生存时间（`defaultDocTtlSeconds`，默认 86400 秒 / 24 小时）与最大未过期房间数上限（`maxDocs`，默认 100，上限 500）。
- **房间/文档（Doc）**：空间下按需动态创建或指定 ID 创建的 JSON 状态树。每个文档由根级普通对象组成，内部节点支持最多 16 层的路径级读写（如 `/game/board/0`）。文档具备独立的版本序列号（`rev`，初始为 0，单调递增）与独立的生命周期（TTL 到期或显式删除后自动释放）。

---

## 凭证与角色权限

状态同步的运行态接口与 WebSocket **严格忽略 Cookie 和普通 SY 登录态**，仅识别以下两类凭证：

| 凭证类型 | 前缀 | 适用端 | 可用权限 |
|---|---|---|---|
| **空间专属凭证** | `sys_` | 浏览器网页（协同页、游戏客户端）与单业务服务 | 绑定单一同步空间，按角色限定：`read`（仅读房间状态与在线感知，不可写或建房间）、`write`（可读写已存在房间状态、设置 onDisconnect，不可创建房间）、`create_write`（包含 write 全部权限且可在空间下动态创建新房间）。不可执行空间管理操作。 |
| **个人 API 密钥** | `syn_sk_` | 自有后端、CLI 脚本、外部自动化 Agent | 受 `state_sync.manage`、`state_sync.write`、`state_sync.read` 三个 scope 与空间资源范围（指定空间 / 全部自有空间）双重约束。仅 `all_owned + state_sync.manage` 可通过 Open API 创建同步空间。 |

**安全铁律**：
- 浏览器网页一律使用**空间专属凭证**（如访客使用 `read`，参与者使用 `write`，房主/创建者使用 `create_write`），绝不把账号级 `syn_sk_` 个人 API 密钥暴露在前端代码中。
- **严禁将凭证放在 WebSocket URL Query 中**（如 `?token=...` 会直接被服务端拒绝并返回 HTTP `400`）。浏览器建连后必须通过**首帧 `auth` JSON** 认证。

---

## 开放 SDK 快速接入（Zero-NPM & 多运行时）

Synapse 官方提供了轻量开放 SDK，由服务端直接静态托管分发，支持浏览器与 Node.js 22+ 零外部依赖运行。

### 1. 浏览器 `<script>` 全局引入

```html
<script src="{{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.global.min.js"></script>
<script>
  const { createClient } = window.SynapseStateSync;

  const client = createClient({
    baseUrl: "{{APP_PUBLIC_URL}}",
    spaceId: "SPACE_ID",
    token: "sys_TOKEN",
  });
</script>
```

### 2. 浏览器原生 ESM 引入

```html
<script type="module">
  import { createClient } from "{{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.esm.min.js";

  const client = createClient({
    baseUrl: "{{APP_PUBLIC_URL}}",
    spaceId: "SPACE_ID",
    token: "sys_TOKEN",
  });
</script>
```

### 3. Node.js 22+ 零安装（Zero-npm）

无需 `npm install` 或配置 `package.json`，直接通过 `curl` 下载单文件产物：

```bash
curl -fsSL {{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.esm.min.js -o ./synapse-state-sync.mjs
```

在 Node.js（22 及以上版本内置全局 `WebSocket` 与 `fetch`）中直接导入：

```javascript
import { createClient } from "./synapse-state-sync.mjs";

const client = createClient({
  baseUrl: process.env.SYNAPSE_BASE_URL || "{{APP_PUBLIC_URL}}",
  spaceId: process.env.SYNAPSE_SPACE_ID,
  token: process.env.SYNAPSE_SPACE_TOKEN,
});
```

CommonJS 方式：
```bash
curl -fsSL {{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.cjs -o ./synapse-state-sync.cjs
```
```javascript
const { createClient } = require("./synapse-state-sync.cjs");
```

---

## 核心操作模式

### 1. 房间创建与加入

```javascript
// 创建新房间并自动连入（需要 create_write 凭证或 state_sync.write 权限）
const { docId, room } = await client.createRoom({
  initialData: { score: 0, status: "idle" },
  ttlSeconds: 3600, // 1 小时后自动过期
  clientId: "player-1",
  clientName: "玩家 1",
  paths: ["/"],     // 订阅根节点
});

// 加入已有房间（首参数必须为 docId 字符串）
const joinedRoom = await client.join(docId, {
  clientId: "player-2",
  clientName: "玩家 2",
  paths: ["/"],
});
```

**房间 ID 分配与权限规则**：
- **空间专属凭证（`sys_...`）**：角色为 `create_write` 时可调用 `client.createRoom()` 动态建房，但**不支持传入自定义 `docId`**（若传入将返回 `403 FORBIDDEN_ROLE`）；服务端会自动分配以 `ssd_` 为前缀的全局唯一随机房间 ID。
- **自定义 `docId`**：属于管理特权，仅限控制台（Console）、MCP 工具或持有 `state_sync.manage` 作用域的个人 API 密钥（`syn_sk_...`）调用。普通客户端使用空间凭证加入房间时，只需通过 `client.join(docId, ...)` 传入预分配或动态生成的房间 ID 即可。

### 2. HTTP 快照直读（免建立长连接）

```javascript
// 无需建立 WebSocket 连接，直接发起轻量 HTTP 请求读取指定路径快照
const snapshot = await client.getSnapshot(docId, "/score");
console.log("快照版本:", snapshot.rev, "值:", snapshot.value, "节点存在:", snapshot.exists);
```

### 3. 状态读取与响应式订阅

```javascript
// 本地无网络延迟直读当前镜像
const currentScore = room.get("/score");

// 监听细粒度路径变化
const unsubscribe = room.on("/score", (newScore, meta) => {
  console.log("分数更新:", newScore, "版本:", meta.rev);
});

// 取消监听
unsubscribe();
```

### 4. 基础状态变更（Set / Patch / Delete）

```javascript
// 覆盖路径的值
await room.set("/score", 100);

// 合并对象属性
await room.patch("/player/info", { level: 2, ready: true });

// 删除路径节点（禁止删除根路径 /）
await room.delete("/player/temp");
```

### 5. 原子事务（`room.transaction`）

在多人并发读写的场景（如抢购、下棋、计数、状态转移）下，直接 `set` 容易产生写覆盖。`room.transaction` 提供了基于乐观并发版本（CAS）的原子更新机制：

```javascript
const result = await room.transaction("/score", (current, { abort, remove }) => {
  const currentVal = typeof current === "number" ? current : 0;
  if (currentVal >= 100) {
    // 中止事务：不向服务端发送写入，返回 committed: false
    return abort();
  }
  // 返回新值以原子提交
  return currentVal + 1;
});

if (result.committed) {
  console.log("递增成功，新版本:", result.rev, "新值:", result.value);
} else {
  console.log("事务中止，当前值保持:", result.value);
}
```

- **返回值语义**：
  - 返回普通新值（对象、数组、字符串、数字、布尔）：原子提交更新该值；
  - 返回 `null`：向服务端提交写入 JSON `null`；
  - 返回 `undefined` 或 `abort()`：**语义完全相同**，主动取消本次事务，不向服务端发送网络请求，方法解析为 `{ committed: false, rev, value }`；
  - 返回 `remove()`：向服务端发送 delete 操作删除该目标节点。
- **并发冲突自动重试**：当有其他客户端先一步修改了数据时，服务端返回 `REV_CONFLICT`，SDK 将自动根据最新的数据镜像重新运行 updater 函数并重试提交（默认最多重试 5 次）。重试耗尽将抛出 `StateSyncError`（`code: "REV_CONFLICT"`）。
- **约束要求**：事务操作的路径**必须属于当前客户端的订阅集合**（即建连时或订阅列表中包含该路径或其父级路径），否则会抛出 `StateSyncError`（`code: "PATH_NOT_SUBSCRIBED"`）。

### 6. 离线遗愿清理（`onDisconnect`）与连接关闭

在协同与游戏中，如果客户端遭遇异常掉线（如关闭标签页、网络波动、进程崩溃），容易在文档中残留“在线”孤儿状态。通过 `onDisconnect`，客户端可在服务端注册“掉线动作”：

```javascript
// 注册当连接中断时由服务端原子执行的动作（单连接最多 8 项）
await room.onDisconnect([
  { op: "set", path: `/players/${myId}/online`, value: false },
  { op: "delete", path: `/locks/${myId}` },
]);

// 主动清除已注册的遗愿动作
await room.clearOnDisconnect();

// 关闭连接：
// 注意：room.close() 以 1000 ("正常关闭") 断开连接。在当前服务协议下，1000 关闭仍会触发执行已注册的 onDisconnect 动作。
// 若希望主动离开且不触发遗愿动作，须在 room.close() 前显式调用 await room.clearOnDisconnect()。
await room.clearOnDisconnect();
room.close();
```

### 7. 在线感知与连接状态（`onPresence` / `updatePresence` / `onStatus`）

```javascript
// 监听房间在线成员列表（首回调立即下发当前所有成员快照）
const unsubPresence = room.onPresence((members) => {
  console.log("在线成员更新:", members.map((m) => m.clientName || m.clientId));
});

// 更新当前连接在房间中的昵称与自定义元数据（广播给房间内所有在线成员）
room.updatePresence({
  clientName: "新昵称",
  meta: { cursor: { x: 100, y: 200 } },
});

// 监听底层 WebSocket 连接状态变化 ("connecting" | "connected" | "reconnecting" | "closed")
const unsubStatus = room.onStatus((status) => {
  console.log("连接状态变更:", status);
});
```

---

## WebSocket 实时协议

连接地址（生产环境必须使用 `wss://`）：

```text
wss://<host>/api/open/v1/state-sync/spaces/<spaceId>/docs/<docId>/ws
```

### 认证方式
1. **浏览器方式（首帧 `auth`）**：建立连接后 **5 秒内** 发送首帧 `auth` JSON；超时未认证服务端将以 `4001` 关闭连接。
2. **外部后端方式（Upgrade Header）**：建连时携带请求头 `Authorization: Bearer <sys_... 或 syn_sk_...>`，通过后服务端立即下发 `ready`。

### 客户端 → 服务端帧（JSON）

#### 1. `auth`（首帧认证）
```json
{
  "type": "auth",
  "token": "sys_...",
  "clientId": "player-1",
  "clientName": "玩家 1",
  "meta": { "role": "player" },
  "paths": ["/game", "/players"],
  "sinceRev": 15
}
```
- `paths`：可选，最多 32 个路径；默认若省略则全量订阅根路径 `/`。
- `sinceRev`：可选，断线重连时传入客户端当前持有版本，服务端将在 100 条及 5 分钟的内存重放缓冲内补发增量 mutation；若已超出重放缓冲，服务端下发 `ready` 携带 `replayTruncated: true` 与当前全量快照。

#### 2. `subscribe` / `unsubscribe`（动态增减订阅）
```json
{ "type": "subscribe", "id": "req-1", "paths": ["/chat"] }
{ "type": "unsubscribe", "id": "req-2", "paths": ["/chat"] }
```

#### 3. `mutate`（提交状态变更）
```json
{
  "type": "mutate",
  "id": "req-3",
  "op": "set",
  "path": "/game/round",
  "value": 2,
  "expectedRev": 15,
  "echo": false
}
```
- `op`：`"set"`、`"patch"` 或 `"delete"`。
- `expectedRev`：可选乐观并发版本号。若与服务端当前 `rev` 不一致，服务端返回 `error` 帧（`code: "REV_CONFLICT"`, `currentRev: <最新版本>`）。
- `echo`：默认 `false`（不回推给当前连接自身）。

#### 4. `onDisconnect.set` / `onDisconnect.clear`
```json
{
  "type": "onDisconnect.set",
  "id": "req-4",
  "actions": [
    { "op": "set", "path": "/players/p1/online", "value": false }
  ]
}
```
```json
{
  "type": "onDisconnect.clear",
  "id": "req-5"
}
```

#### 5. `presence.update` / `ping`
```json
{ "type": "presence.update", "clientName": "改名为玩家2", "meta": { "cursor": { "x": 100, "y": 200 } } }
{ "type": "ping" }
```

### 服务端 → 客户端帧（JSON）
- **`ready`**：`{ type: "ready", spaceId, docId, connectionId, clientId, role, rev, expiresAt, replayTruncated, presence, snapshots }`。
- **`mutation`**：`{ type: "mutation", rev, op, path, value, replayed, actor: { connectionId, clientId, clientName }, ts }`。
- **`snapshot`**：`{ type: "snapshot", rev, path, exists, value }`。
- **`ack`**：`{ type: "ack", id, rev?, changed? }`。
- **`presence.join` / `presence.leave` / `presence.update`**：`{ type, member: { connectionId, clientId, clientName, role, meta, connectedAt } }`。
- **`pong`**：`{ type: "pong", serverTime }`。
- **`error`**：`{ type: "error", id?, code, message, currentRev? }`。

### WebSocket Close Codes
| Code | 含义 | 客户端建议动作 |
|---|---|---|
| `1000` | 正常关闭（主动断开连接） | 服务端仍会执行已注册的 `onDisconnect` 动作；若不想触发须在断开前 `clearOnDisconnect`。通常不重连。 |
| `1001` | 服务端重启或更新维护 | 采用指数退避重连，携带持有的最新 `sinceRev`。服务端不执行 onDisconnect。 |
| `4001` | 认证超时（5 秒未发首帧）或凭证无效 | 停止盲目重连，检查 Token 与空间/房间 ID。 |
| `4003` | 空间凭证被撤销、房间被删除、空间被删除 | **停止重连**，提示更换凭证。服务端废弃 onDisconnect。 |
| `4004` | 凭证角色已发生变更（如写入权限降级） | 重新连接协商新权限。服务端废弃 onDisconnect。 |
| `4008` | 心跳超时或慢连接队列积压 | 退避重连并重置本地状态镜像。服务端执行已生效的 onDisconnect。 |
| `4029` | 连接数超限或单连接高频超限 | 退避重连，降低发帧速率。 |

---

## HTTP 与 WebSocket 错误码速查

下表列出状态同步 REST API 与 WebSocket 交互中所有核心错误码及应对策略：

| 错误码 (code) | 交互协议 | HTTP 响应 / WS 帧 | 说明与客户端处理指引 |
|---|---|---|---|
| `REV_CONFLICT` | HTTP / WS | `409` / `error` | CAS 乐观锁版本冲突。响应体或帧携带 `currentRev`（服务端当前最新版本）。SDK `room.transaction()` 会自动根据最新版本重试；直接调用者需按 `currentRev` 刷新后重新计算。 |
| `PATH_NOT_SUBSCRIBED` | SDK 本地 | 本地异常 | 尝试对未被当前连接订阅的路径执行 `transaction`。建连时须在 `paths` 中包含该路径或其祖先路径（如 `/`）。 |
| `PATH_CONFLICT` | HTTP / WS | `409` / `error` | 路径中间节点或目标不是普通 JSON 对象（如遇到数字/字符串/数组），拒绝静默覆写。 |
| `INVALID_REQUEST` / `INVALID_INPUT` | HTTP / WS | `400` / `error` | 请求参数或路径格式无效（如路径未以 `/` 开头、包含非法字符/空段/安全敏感段，或路径深度超过 16 层）。 |
| `DOC_NOT_FOUND` | HTTP / WS | `404` / `4003` Close | 房间不存在或已被销毁。检查空间 ID 与房间 ID 是否匹配，确认房间是否由房主预先创建。 |
| `DOC_ALREADY_EXISTS` | HTTP | `409` | 使用自定义 `docId` 创建房间时，该 ID 在当前空间下已被占用。 |
| `DOC_LIMIT_EXCEEDED` | HTTP | `422` | 空间内未过期房间数已达上限（默认 100，硬上限 500）。请清理过期房间或缩短房间 TTL。 |
| `TTL_POLICY_VIOLATION` | HTTP | `403` | 房间生存时间违反策略（例如非管理密钥尝试将 TTL 设为 `null` 永久保留，或超出空间默认范围）。 |
| `DOC_TOO_LARGE` | HTTP / WS | `413` / `error` | 更新后文档序列化体积超过单文档 256 KiB 上限。请拆分状态树或清理历史数据。 |
| `PAYLOAD_TOO_LARGE` | HTTP / WS | `413` / `error` | 单次写入载荷（value）超过 64 KiB 上限。 |
| `REQUEST_TOO_LARGE` | HTTP | `413` | HTTP 单次请求体或建房 `initialData` 超过 256 KiB 上限。 |
| `FORBIDDEN_ROLE` | HTTP / WS | `403` / `error` | 凭证角色权限不足（例如使用 `read` 只读凭证执行写入或设置 onDisconnect，使用 `write` 凭证尝试创建新房间，或空间专属凭证传递自定义房间 ID）。 |
| `RATE_LIMITED` | HTTP / WS | `429` / `error` | 写入或建房频率超限。HTTP 响应头携带 `Retry-After` 秒数；WS 客户端请指数退避降低写入频率。 |

---

## HTTP Open REST API

所有请求均须携带 `Authorization: Bearer <token>`，开放路径启用无凭据 CORS（`Access-Control-Allow-Origin: *`，允许 `Authorization, Content-Type`，暴露 `X-Request-Id, Retry-After`），单请求体上限 256 KiB。

| operationId | 方法 | 路径 | 所需凭证/权限 | 说明 |
|---|---|---|---|---|
| `createStateSyncDoc` | `POST` | `/state-sync/spaces/{spaceId}/docs` | `create_write` 空间凭证或 `state_sync.write` | 动态创建房间（可附带初始数据与 TTL） |
| `getStateSyncDoc` | `GET` | `/state-sync/spaces/{spaceId}/docs/{docId}` | 任意有效凭证或 `state_sync.read` | 读取指定路径状态快照（支持 `?path=` 参数） |
| `mutateStateSyncDoc` | `PATCH` | `/state-sync/spaces/{spaceId}/docs/{docId}` | `write`/`create_write` 或 `state_sync.write` | CAS 原子更新（支持 expectedRev，冲突返 409） |
| `getStateSyncPresence` | `GET` | `/state-sync/spaces/{spaceId}/docs/{docId}/presence` | 任意有效空间凭证或运行态密钥 | 查询当前房间在线成员列表 |
| `deleteStateSyncDoc` | `DELETE` | `/state-sync/spaces/{spaceId}/docs/{docId}` | 个人 API 密钥（`state_sync.manage`） | 强制删除房间并踢断连接 |
| `listStateSyncDocs` | `GET` | `/state-sync/spaces/{spaceId}/docs` | 个人 API 密钥（`state_sync.manage`） | 列出空间下未过期房间（limit 最大 200） |
| `listStateSyncSpaces` | `GET` | `/state-sync/spaces` | 个人 API 密钥（`state_sync.manage`） | 列出可见的同步空间 |
| `createStateSyncSpace` | `POST` | `/state-sync/spaces` | 个人 API 密钥（`state_sync.manage` + 全部自有空间） | 创建新的同步空间 |
| `getStateSyncSpace` / `updateStateSyncSpace` / `deleteStateSyncSpace` | `GET`/`PATCH`/`DELETE` | `/state-sync/spaces/{spaceId}` | 个人 API 密钥（均需 `state_sync.manage`） | 读取、修改、删除同步空间 |
| `listStateSyncTokens` / `createStateSyncToken` / `revokeStateSyncToken` | `GET`/`POST`/`DELETE` | `/state-sync/spaces/{spaceId}/tokens[/{tokenId}]` | 个人 API 密钥（`state_sync.manage`） | 管理空间专属凭证 |

### `curl` HTTP 快速读写示例

```bash
# 1. 创建一个房间
curl --fail-with-body -X POST "{{APP_PUBLIC_URL}}/api/open/v1/state-sync/spaces/$SPACE_ID/docs" \
  -H "Authorization: Bearer $SPACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"initialData":{"counter":0,"title":"演示任务"},"ttlSeconds":86400}'

# 2. 读取指定路径快照
curl --fail-with-body "{{APP_PUBLIC_URL}}/api/open/v1/state-sync/spaces/$SPACE_ID/docs/$DOC_ID?path=/counter" \
  -H "Authorization: Bearer $SPACE_TOKEN"

# 3. 基于 CAS 版本号乐观更新状态
curl --fail-with-body -X PATCH "{{APP_PUBLIC_URL}}/api/open/v1/state-sync/spaces/$SPACE_ID/docs/$DOC_ID" \
  -H "Authorization: Bearer $SPACE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"op":"set","path":"/counter","value":1,"expectedRev":0}'
```

---

## 端到端场景模板

### 模板一：纯静态双人井字棋游戏（HTML + SDK 全局引入）

保存为纯静态 HTML 页面即可在浏览器中直接双人联机对战。
- **房主（黑方 X）**：直接打开页面，调用 `client.createRoom()` 创建新房间，页面自动在 URL 中追加 `?room=<docId>` 并生成对战邀请链接。
- **对战玩家（白方 O）**：打开带有 `?room=<docId>` 的链接，调用 `client.join(docId, ...)` 直接加入已有房间。
- **走棋与防冲突**：利用 `room.transaction('/', ...)` 防止并发重子；通过 `room.onDisconnect([...])` 注册离线状态清理。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Synapse 状态同步 - 双人井字棋</title>
  <style>
    body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 24px; }
    .board { display: grid; grid-template-columns: repeat(3, 80px); gap: 8px; margin: 20px 0; }
    .cell { width: 80px; height: 80px; font-size: 32px; font-weight: bold; background: #f3f4f6; border: 2px solid #d1d5db; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .cell:hover { background: #e5e7eb; }
    .info { margin-bottom: 12px; font-size: 16px; }
    .share-link { margin-top: 10px; font-size: 14px; background: #f9fafb; padding: 8px 12px; border-radius: 6px; word-break: break-all; max-width: 480px; }
  </style>
  <script src="{{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.global.min.js"></script>
</head>
<body>
  <h2>双人井字棋 (State Sync)</h2>
  <div class="info" id="status">正在连接...</div>
  <div class="board" id="board"></div>
  <button id="reset-btn" onclick="resetGame()" style="display:none; padding: 8px 16px;">重新开始</button>
  <div class="share-link" id="share-link" style="display:none;"></div>

  <script>
    const { createClient } = window.SynapseStateSync;

    const BASE_URL = "{{APP_PUBLIC_URL}}";
    const SPACE_ID = "YOUR_SPACE_ID";
    // 房主需具备 create_write 权限以创建房间；若通过后端预先建房，白方仅需 write 权限
    const TOKEN = "sys_YOUR_CREATE_WRITE_TOKEN";

    const urlParams = new URLSearchParams(location.search);
    const existingDocId = urlParams.get("room");
    const isPlayerA = !existingDocId;
    const myPlayer = isPlayerA ? "X" : "O";

    let room;
    let docId = existingDocId;

    async function init() {
      const client = createClient({ baseUrl: BASE_URL, spaceId: SPACE_ID, token: TOKEN });

      if (isPlayerA) {
        // 黑方（房主）：创建新房间并附带初始棋盘数据
        const created = await client.createRoom({
          initialData: {
            board: Array(9).fill(null),
            turn: "X",
            winner: null,
          },
          ttlSeconds: 3600,
          clientId: "player-X",
          clientName: "黑方 (X)",
          paths: ["/"],
        });
        docId = created.docId;
        room = created.room;

        // 在 URL 中追加 ?room=<docId>，方便直接复制链接分享给白方
        const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(docId)}`;
        history.replaceState(null, "", shareUrl);
        const shareEl = document.getElementById("share-link");
        shareEl.style.display = "block";
        shareEl.innerHTML = `对战邀请链接已生成，分享给白方对战：<br><a href="${shareUrl}">${shareUrl}</a>`;
      } else {
        // 白方（挑战者）：首参数传入 docId 直接加入已有房间
        room = await client.join(docId, {
          clientId: "player-O",
          clientName: "白方 (O)",
          paths: ["/"],
        });
      }

      // 注册离线遗愿清理动作
      await room.onDisconnect([
        { op: "set", path: "/players/" + myPlayer + "/online", value: false },
      ]);

      // 响应式监听棋盘变更
      room.on("/board", render);
      room.on("/turn", render);
      room.on("/winner", render);
      render();
    }

    function render() {
      const board = room.get("/board") || Array(9).fill(null);
      const turn = room.get("/turn") || "X";
      const winner = room.get("/winner");

      const statusEl = document.getElementById("status");
      if (winner) {
        statusEl.textContent = winner === "draw" ? "平局！" : "获胜者: " + winner + "！";
        document.getElementById("reset-btn").style.display = "block";
      } else {
        statusEl.textContent = "当前执棋: " + turn + " | 你是: " + (myPlayer === "X" ? "黑方 (X)" : "白方 (O)") + (turn === myPlayer ? " (轮到你)" : "");
        document.getElementById("reset-btn").style.display = "none";
      }

      const boardEl = document.getElementById("board");
      boardEl.innerHTML = "";
      board.forEach((val, idx) => {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.textContent = val || "";
        cell.onclick = () => makeMove(idx);
        boardEl.appendChild(cell);
      });
    }

    async function makeMove(index) {
      if (room.get("/winner") || room.get("/turn") !== myPlayer) return;

      // 使用原子事务更新棋盘，防止并发下重子
      await room.transaction("/", (curr, { abort }) => {
        if (!curr || curr.winner || curr.turn !== myPlayer || curr.board[index]) {
          return abort();
        }
        const nextBoard = [...curr.board];
        nextBoard[index] = myPlayer;
        const winner = checkWinner(nextBoard);
        return {
          ...curr,
          board: nextBoard,
          turn: myPlayer === "X" ? "O" : "X",
          winner: winner || (nextBoard.every(Boolean) ? "draw" : null),
        };
      });
    }

    function checkWinner(b) {
      const lines = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
      ];
      for (const [x,y,z] of lines) {
        if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
      }
      return null;
    }

    async function resetGame() {
      await room.set("/", {
        board: Array(9).fill(null),
        turn: "X",
        winner: null,
      });
    }

    init().catch((err) => {
      document.getElementById("status").textContent = "初始化失败: " + err.message;
      console.error(err);
    });
  </script>
</body>
</html>
```

### 模板二：Node.js 后台监控服务 + Web 实时状态监控看板

#### 1. Node.js Worker 监控上报（零 npm 依赖）

```javascript
// worker.mjs - 运行: node worker.mjs
import os from "node:os";
import { createClient } from "./synapse-state-sync.mjs";

const client = createClient({
  baseUrl: process.env.SYNAPSE_BASE_URL || "{{APP_PUBLIC_URL}}",
  spaceId: process.env.SYNAPSE_SPACE_ID,
  token: process.env.SYNAPSE_SPACE_TOKEN, // write 或 create_write 凭证
});

async function run() {
  const targetDocId = process.env.SYNAPSE_DOC_ID;
  const workerId = "worker-" + os.hostname();

  let room;
  let docId;

  if (targetDocId) {
    // 环境变量指定了房间 ID（通过控制台、MCP 或管理 API 密钥预先创建的固定房间），直接加入
    console.log(`加入已有监控房间: ${targetDocId}`);
    room = await client.join(targetDocId, {
      clientId: workerId,
      clientName: "节点 " + os.hostname(),
      paths: ["/nodes"],
    });
    docId = targetDocId;
  } else {
    // 空间专属凭证（create_write）建房不能传自定义 docId，由服务端动态分配随机 ssd_... 房间 ID
    console.log("未指定 SYNAPSE_DOC_ID，使用 create_write 凭证动态创建监控房间...");
    const created = await client.createRoom({
      initialData: { nodes: {} },
      ttlSeconds: 3600,
      clientId: workerId,
      clientName: "节点 " + os.hostname(),
      paths: ["/nodes"],
    });
    room = created.room;
    docId = created.docId;
    console.log(`监控房间已动态创建: ${docId}`);
    console.log(`Web 看板访问地址: http://localhost:8080/dashboard.html?room=${encodeURIComponent(docId)}`);
  }

  // 掉线时服务端自动设置 offline 标志并记录离线时间
  await room.onDisconnect([
    {
      op: "patch",
      path: "/nodes/" + workerId,
      value: {
        online: false,
        disconnectedAt: new Date().toISOString(),
      },
    },
  ]);

  console.log(`监控节点 ${workerId} 已就绪，正在定期同步状态至房间 ${docId}...`);

  // 定时每 5 秒上报一次节点健康与负载状态
  setInterval(async () => {
    try {
      await room.set("/nodes/" + workerId, {
        online: true,
        hostname: os.hostname(),
        loadavg: os.loadavg()[0],
        freeMemMB: Math.round(os.freemem() / 1024 / 1024),
        uptimeSec: os.uptime(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("状态上报失败:", err.message);
    }
  }, 5000);
}

run().catch(console.error);
```

#### 2. Web 实时看板网页

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>集群健康实时看板</title>
  <style>
    body { font-family: monospace; background: #0f172a; color: #e2e8f0; padding: 24px; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .online { color: #22c55e; font-weight: bold; }
    .offline { color: #ef4444; font-weight: bold; }
  </style>
  <script src="{{APP_PUBLIC_URL}}/sdk/state-sync/v1/state-sync.global.min.js"></script>
</head>
<body>
  <h1>集群节点实时监控</h1>
  <div id="nodes">加载中...</div>

  <script>
    const { createClient } = window.SynapseStateSync;
    const client = createClient({
      baseUrl: "{{APP_PUBLIC_URL}}",
      spaceId: "SPACE_ID",
      token: "sys_READ_TOKEN", // 看板只需要 read 只读凭证
    });

    // 从 URL 参数获取房间 ID（例如 ?room=ssd_xxx），若未指定则回退默认预置房间
    const urlParams = new URLSearchParams(location.search);
    const DOC_ID = urlParams.get("room") || "cluster-live-status";

    async function init() {
      // 首参数传入 docId 加入房间（匹配 URL 参数 ?room=<docId> 或预置房间 ID），只订阅 /nodes 状态树
      const room = await client.join(DOC_ID, {
        clientId: "dashboard-viewer",
        clientName: "Web 看板端",
        paths: ["/nodes"],
      });

      function render() {
        const nodes = room.get("/nodes") || {};
        const container = document.getElementById("nodes");
        container.innerHTML = Object.entries(nodes).map(([id, info]) => `
          <div class="card">
            <h3>${id} - <span class="${info.online ? 'online' : 'offline'}">${info.online ? 'ONLINE' : 'OFFLINE'}</span></h3>
            <p>负载 (1m): ${info.loadavg?.toFixed(2) || 'N/A'}</p>
            <p>空闲内存: ${info.freeMemMB || 0} MB</p>
            <p>最后上报: ${info.updatedAt || 'N/A'}</p>
          </div>
        `).join("") || "暂无在线节点";
      }

      room.on("/nodes", render);
      render();
    }

    init().catch(console.error);
  </script>
</body>
</html>
```

---

## 默认限额与安全规格

- **文档大小限制**：单文档最大 256 KiB UTF-8；单次写入（set / patch）载荷最大 64 KiB UTF-8；`meta` 最大 2 KiB。
- **结构与深度**：路径最多 16 层深度；JSON 嵌套最多 32 层；单房间最多订阅 32 条路径；单连接最多 8 项 onDisconnect 动作。
- **空间配额**：单空间默认最多保留 100 个有效房间（硬上限 500 个）；单空间最多保留 20 个专属凭证。
- **生存时间（TTL）**：房间 TTL 最短 60 秒，最长 30 天，默认 86400 秒（24 小时）；无管理权限的凭证不能突破空间默认 TTL 规则。
- **频率限制（严格对齐服务配置）**：
  - 单 WebSocket 连接写入：持续 20 次/秒（突发 60 次/秒）；
  - 单文档总写入：持续 60 次/秒（突发 120 次/秒）；
  - 单空间房间创建：持续 10 次/分（突发 30 次/分）；
  - 超频将触发 HTTP `429 RATE_LIMITED`（响应头含 `Retry-After` 秒数）或 WebSocket `error` 帧（`code: "RATE_LIMITED"`）。
- **心跳保活**：服务端每 25 秒下发 Ping，客户端连续错过 2 次将以 `4008` 断开；增量重放缓冲提供最近 100 条变更或 5 分钟窗口。
