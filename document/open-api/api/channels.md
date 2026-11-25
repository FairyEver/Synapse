# 频道

为网页之间（如大屏展示页与手机遥控器）、以及外部后端与网页之间提供免 SY 登录的实时信号通信通道。

- **与云端数据表的分工**：云端数据表负责持久化结构化数据与查询；**频道**负责低延迟实时事件转发、轻量在线感知（Presence）、短窗口断线补发，以及可选的 Retain 最新状态快照（每频道最多 20 个事件名）。频道不存储消息历史，不提供历史回查或消息队列持久化。
- **整页可复制给 AI**：本页包含完整的 WebSocket 线协议、HTTP REST 契约、Close Codes 与端到端代码模板，可直接整页复制给 AI 编写接入代码。

[打开 OpenAPI 契约]({{APP_PUBLIC_URL}}/api/open/openapi.json) 查看当前部署版本的完整 REST Schema。所有 REST 路径均挂载在 `{{APP_PUBLIC_URL}}/api/open/v1` 下。

---

## 桌面端 MCP 快速接入

已登录 Synapse 桌面端的 AI 可通过现有 MCP `search` / `invoke` 查找 `channels`（工具前缀 `app_channels_*`），直接使用当前桌面登录账号完成发布前检查、创建频道、签发最小权限凭证、发送测试事件与查询在线/Retain 状态，无需向用户索要个人 API 密钥。

---

## 凭证与角色权限

频道的运行态接口与 WebSocket **严格忽略 Cookie 和普通 SY 登录态**，只识别以下两类凭证：

| 凭证类型 | 前缀 | 适用端 | 可用权限 |
|---|---|---|---|
| **频道专属凭证** | `syc_` | 浏览器网页（大屏、遥控器）与单频道服务 | 绑定单一频道，按角色限定：`subscribe`（仅订阅/读 Presence 与 Retain）、`publish`（仅发布/清 Retain/读 Presence，不收事件与 Retain）、`pubsub`（双向）。不可执行频道管理操作。 |
| **个人 API 密钥** | `syn_sk_` | 自有后端、脚本、CLI、外部 Agent | 受 `channels.manage`、`channels.publish`、`channels.subscribe` 三个 scope 与频道资源范围（指定频道 / 全部自有频道）双重约束。仅 `all_owned + channels.manage` 可通过 Open API 创建频道。 |

**安全铁律**：
- 浏览器网页一律使用**频道专属凭证**（如大屏用 `subscribe`、遥控器用 `publish` 或 `pubsub`），绝不把账号级 `syn_sk_` 个人 API 密钥放进网页源码。
- **严禁将凭证放在 WebSocket URL Query 中**（如 `?token=...` 会直接被服务端拒绝返回 HTTP `400`）。浏览器建连后必须通过**首帧 `auth` JSON** 认证。

---

## WebSocket 实时协议

连接地址（生产环境使用 `wss://`）：

```text
wss://<host>/api/open/v1/channels/<channelId>/ws
```

### 认证方式
1. **浏览器推荐（首帧 `auth`）**：建立连接后 **5 秒内** 发送首帧 `auth` JSON；超时未认证服务端将以 `4001` 关闭连接。
2. **外部后端便捷方式（Upgrade Header）**：建连时携带请求头 `Authorization: Bearer <syc_... 或 syn_sk_...>`，通过后服务端立即下发 `ready`。

### 客户端 → 服务端帧（JSON）

#### 1. `auth`（首帧认证）
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
- `events`：可选，最多 20 项，支持精确事件名或尾部 `.*` 前缀通配（如 `screen.*`）；省略表示全订阅。
- `afterSeq`：可选，断线重连时传入上次收到的最大 `seq`，服务端将补发 5 分钟 / 最近 100 条窗口内漏掉的广播事件（带 `replayed: true`）。

#### 2. `publish`（发布事件，需 `publish` / `pubsub` 或 `channels.publish`）
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
- `event`：`^[a-zA-Z0-9._:-]{1,64}$`；`payload`：任意合法 JSON（含 `null`），UTF-8 序列化 ≤ 64 KiB。
- `retain`：默认 `false`；设为 `true` 时写入/覆盖该事件名最新 1 条持久化快照（每频道上限 20 个不同事件名）。
- `echo`：默认 `false`（不回推给当前连接自身）。
- `targetClientId`：可选；填写时仅在线定向投递给匹配 `clientId` 的订阅端，**不进入断线补发缓冲，且禁止与 `retain: true` 同时使用**。

#### 3. `retained.clear`（静默清除 Retain 快照）
```json
{ "type": "retained.clear", "id": "req-2", "event": "scene.current" }
```
仅删除持久化快照，不广播业务事件帧；提供 `id` 时回传 `{ "type": "ack", "id": "req-2", "deleted": true }`。

#### 4. `presence.update` / `ping`
```json
{ "type": "presence.update", "clientName": "大屏-第3页", "meta": { "page": 3 } }
```
```json
{ "type": "ping" }
```

### 服务端 → 客户端帧（JSON）
- **`ready`**：`{ type: "ready", channelId, connectionId, clientId, role, latestSeq, replayTruncated, presence, retained? }`（`publish` 角色不含 `retained`）。
- **`event`**：`{ type: "event", seq, event, payload, retain, replayed, targeted, sender: { connectionId, clientId, clientName }, sentAt }`。
- **`ack`**：响应 `publish` 返回 `{ type: "ack", id, seq, deliveredCount, retained }`；响应 `retained.clear` 返回 `{ type: "ack", id, deleted }`。
- **`presence.join` / `presence.leave` / `presence.update`**：`{ type, member: { connectionId, clientId, clientName, role, meta, connectedAt } }`。
- **`pong`**：`{ type: "pong", serverTime }`。
- **`error`**：`{ type: "error", id?, code, message }`。

### WebSocket Close Codes
| Code | 含义 | 客户端建议动作 |
|---|---|---|
| `1000` | 正常关闭 | 不重连 |
| `1001` | 服务端重启或维护 | 指数退避重连，携带最新 `afterSeq` |
| `4001` | 认证超时或凭证无效 | 停止盲目重连，检查凭证或频道 ID |
| `4003` | 凭证被撤销、移出频道、账号停用或频道已删除 | **停止重连**，提示更换凭证 |
| `4004` | API Key 权限/角色已变更（仍有权访问该频道） | 重连一次以协商新角色 |
| `4008` | 心跳超时或慢消费者发送队列超限 | 退避重连并刷新状态 |
| `4029` | 连接数超限或持续触发限流 | 退避并降低重连/发送频率 |

---

## HTTP Open REST API

所有请求均须携带 `Authorization: Bearer <token>`，开放路径启用无凭据 CORS（`Access-Control-Allow-Origin: *`，允许 `Authorization, Content-Type`），单请求体上限 128 KiB。

| operationId | 方法 | 路径 | 所需凭证/权限 | 说明 |
|---|---|---|---|---|
| `publishChannelEvent` | `POST` | `/channels/{channelId}/events` | `publish`/`pubsub` 凭证或 `channels.publish` 密钥 | 无状态发布实时事件（可选 `retain` / `targetClientId`） |
| `getChannelPresence` | `GET` | `/channels/{channelId}/presence` | 任意有效频道凭证或 `channels.publish`/`subscribe` 密钥 | 查询当前在线成员 |
| `listChannelRetained` | `GET` | `/channels/{channelId}/retained` | `subscribe`/`pubsub` 凭证或 `channels.subscribe` 密钥 | 读取全部 Retain 快照 |
| `clearChannelRetained` | `DELETE` | `/channels/{channelId}/retained/{event}` | `publish`/`pubsub` 凭证或 `channels.publish` 密钥 | 静默删除指定 Retain 快照 |
| `listChannels` | `GET` | `/channels` | 个人 API 密钥（任一 `channels.*` scope） | 列出可见频道 |
| `createChannel` | `POST` | `/channels` | 个人 API 密钥（`channels.manage` + 全部自有频道） | 创建频道 |
| `getChannel` / `updateChannel` / `deleteChannel` | `GET`/`PATCH`/`DELETE` | `/channels/{channelId}` | 个人 API 密钥（写删需 `channels.manage`） | 查看、修改、删除频道 |
| `listChannelTokens` / `createChannelToken` / `revokeChannelToken` | `GET`/`POST`/`DELETE` | `/channels/{channelId}/tokens[/{tokenId}]` | 个人 API 密钥（`channels.manage`） | 管理频道专属凭证 |

### `curl` 无状态发信号示例
```bash
curl --fail-with-body -X POST "{{APP_PUBLIC_URL}}/api/open/v1/channels/$CHANNEL_ID/events" \
  -H "Authorization: Bearer $CHANNEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"slide.next","payload":{"step":1},"retain":false}'
```

---

## 端到端场景模板

### 模板一：大屏展示页 + 手机遥控器（浏览器原生 WebSocket）

大屏页面使用 `subscribe` 只读凭证，自动重连并同步 `scene.current` Retain 状态：

```js
const WS_URL = "wss://YOUR_HOST/api/open/v1/channels/CHANNEL_ID/ws";
const SCREEN_TOKEN = "syc_SUBSCRIBE_TOKEN";
let lastSeq = 0;

function connectScreen() {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "auth",
      token: SCREEN_TOKEN,
      clientId: "living-room-screen",
      clientName: "客厅大屏",
      meta: { kind: "screen" },
      afterSeq: lastSeq || undefined,
      includeRetained: true,
    }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "ready") {
      lastSeq = msg.latestSeq;
      const current = (msg.retained || []).find((r) => r.event === "scene.current");
      if (current) renderScene(current.payload);
    } else if (msg.type === "event") {
      lastSeq = Math.max(lastSeq, msg.seq);
      if (msg.event === "scene.current") renderScene(msg.payload);
      if (msg.event === "slide.next") nextSlide(msg.payload);
    }
  };
  ws.onclose = (ev) => {
    if (ev.code === 4001 || ev.code === 4003) return;
    setTimeout(connectScreen, 2000);
  };
}
connectScreen();
```

手机遥控器使用 `publish` 凭证，通过 `presence` 显示大屏在线状态并发送控制信号：

```js
const ws = new WebSocket("wss://YOUR_HOST/api/open/v1/channels/CHANNEL_ID/ws");
ws.onopen = () => ws.send(JSON.stringify({
  type: "auth",
  token: "syc_PUBLISH_TOKEN",
  clientId: "phone-remote",
  clientName: "手机遥控器",
}));
function switchScene(scene) {
  ws.send(JSON.stringify({
    type: "publish",
    id: crypto.randomUUID(),
    event: "scene.current",
    payload: { scene },
    retain: true,
  }));
}
```

### 模板二：自有 Node.js 后端 + 手机控制网页（双向定向回执）

自有后端无需暴露公网端口，主动连入 SY 频道接收指令，并通过 `targetClientId` 把结果定向回传给发起操作的手机网页：

```js
import WebSocket from "ws";

const ws = new WebSocket("wss://YOUR_HOST/api/open/v1/channels/CHANNEL_ID/ws");
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "auth",
    token: process.env.SY_CHANNEL_TOKEN, // pubsub 角色凭证
    clientId: "home-worker",
    clientName: "我的后台服务",
    meta: { kind: "backend" },
  }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString("utf8"));
  if (msg.type !== "event" || msg.event !== "command.run") return;
  const result = { ok: true, action: msg.payload?.action, at: new Date().toISOString() };
  ws.send(JSON.stringify({
    type: "publish",
    id: `reply-${msg.seq}`,
    event: "command.result",
    payload: result,
    targetClientId: msg.sender?.clientId || undefined,
  }));
});
```

---

## 默认限额

- 单事件载荷：64 KiB UTF-8；单 WS 帧与 HTTP POST 请求体：128 KiB；`meta`：2 KiB UTF-8。
- 单频道上限：100 个在线连接、20 个有效凭证、20 个 Retain 事件名；单账号 300 连接；全局 2000 连接。
- 频率限制：单 WS 连接持续 10 次/秒（突发 30）；HTTP POST 按频道持续 30 次/秒（突发 60）。
- 心跳：服务端每 25 秒发送 WS Ping，连续错过 2 次断开（`4008`）；断线补发窗口：最近 100 条广播事件或 5 分钟内存缓冲。
