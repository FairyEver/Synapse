# 写操作短窗口防重（设计 D12）

写能力必带 `requestId`，SDK 在 TTL 窗口内去重。给 AI 看的说明在
`src/catalog/describe.ts` 的 `howToCall.idempotency`，这里写的是**边界**。

## 一句话

同一个键在窗口内重复调用时返回第一次的结果、不再发请求；并发同键只发一次。

## ⚠️ 这不是幂等

它防的是「同一进程、同一窗口内、同一个 `requestId` 的重复调用」。
下面这些它**做不到**，且都不是待修的 bug：

| 做不到的事 | 后果 | 为什么不做 |
| --- | --- | --- |
| SDK 进程重启 | 表在内存里，重启即空，同 key 重试会真的再发一次 | 落盘要引入状态文件、清理策略和并发写文件的问题，收益只覆盖「本进程存活期」 |
| 多实例部署 | 两个进程各发一次 | 跨进程只有后端认幂等键才能解决——**那正是本模块想推动的事** |
| TTL 过后（默认 10 分钟） | 同 key 会重新发出去 | 窗口只约束同一个 key；新的写意图本来就该换新 key |
| 用户在 Portal 页面上手工写过的单据 | SDK 一无所知，照样会再写一次 | 只认识「本进程这个窗口内调用过」 |
| 写成功但响应丢了，且窗口已过 | 重试会再写一次 | 同上 |
| AI 每次重试都新生成 `requestId` | 完全失效，且不报错 | 只能靠在工具描述里写清「重试复用同一个值」 |

**结论**：它把「AI 自动重试导致的重复单据」这个最高频的成因摁住了，
但没有解决后端零幂等。真正的幂等只能在服务端做，而且必须带唯一索引——不能是"先查后插"。

## 与后端 BPM 的既有范式对齐

BPM 已经在用客户端幂等键（`erp-module-bpm`），SDK 侧刻意做成同一套语言，
将来推动后端补幂等时不用换概念：

| BPM（唯一索引） | 这里（键的分段） |
| --- | --- |
| `tenant_id` | `namespace \| tenantId` |
| `creator` / `sender_user_id` | `userId` |
| `process_instance_id` | `capabilityId` + `target` |
| `client_request_id` | `requestId` |

- 键：`（租户, 业务对象, 用户, 客户端请求编号）`，见 `key.ts`
- 重复怎么处理：返回**第一次那条记录的 id**，不报错
  （`BpmProcessFollowUpServiceImpl.createProcessFollowUp`）
- 并发怎么处理：靠唯一索引兜底，捕获唯一键冲突后回查，返回赢家的 id
- 失败怎么释放：只有**确知没写**才允许重试——
  `BpmProcessSmsRemindMapper.releaseDailyLimits`（"同步全失败时置空允许重试"）

一条**有意的差异**：BPM 后端不看载荷，同 key 不同内容时回放第一次的记录；
SDK 侧会比对载荷指纹，不同就抛 `IdempotencyKeyReuseError`。
理由见 `key.ts` 顶部——后端那边载荷只是一个 `content` 文本域，这边是整张单据，
回放旧结果等于告诉 AI「你新填的这场会已经订好了」，而它根本没订。

## 失败之后能不能重试

分界线是**知不知道后端写没写**，不是失败严不严重：

| 失败 | 判据 | 处理 | 理由 |
| --- | --- | --- | --- |
| 业务失败 | 后端答复 `ret !== 'SUCCESS'` | **释放键**，可立刻重试 | 后端收到并拒绝了 = 没写 |
| 凭据被拒 | 401/403/1002015001 | **释放键** | 同上 |
| 本地校验失败 | `NotDispatchedError` 标记 | **释放键** | 请求根本没发出去 |
| 超时 / 断连 / 5xx / 未知异常 | 其余一律 | **保留键**，窗口内拒绝重发 | **不知道**写没写；释放 = 允许自动重试 = 重复单据 |

保留不是因为我们知道它写了，而是因为我们**不知道**。此时唯一安全的动作是把不确定性交还
调用方：先确认（查该时段的占用 / 单据列表）上一次到底生效没有，再决定是复用这个
`requestId`（确认没生效）还是作罢。SDK 没有资格替用户赌。

## 接线形状

`withIdempotency(...)` 产出一个「多一个 `requestId` 参数」的写函数，
不改 `src/capabilities/`：

```ts
const submitMeetingApplication = withIdempotency({
  store,
  capabilityId: 'meeting-application-submit',
  identity: () => ({ tenantId, userId }),        // 从会话现取
  payload: (params) => buildMeetingApplicationPayload(params),  // 本地校验放这里
  send: (params, { payload }) => capability.submit(payload, params.startUserSelectAssignees),
})

await submitMeetingApplication({ ...draft, requestId })
```

`requestId` 只留在本地，**不进请求体也不加请求头**：后端目前没有幂等入口，
加了会破坏与浏览器逐字段比对的基线（D20）。将来后端支持了，加在 `send` 的第二个参数上。

`identity` 在多用户门面（`createPortalServer`）里是**这份会话**给的
`{ userId, tenantId }`。**别把 `userId` 拿掉**：`requestId` 由 AI 会话自己编，
两个用户撞上同一个值完全可能，少了它就串成「用户 B 的写调用拿到用户 A 的回执」——
既是错，也是越权（`key.ts` 顶部第 1 条）。这条保障钉在
`test/server-multi-user-identity.test.ts`：同一租户的两个用户、同一个 `requestId`，
必须各发各的请求、各拿各的回执。该用例靠 `sessionOptions.createRequest`
（`src/server.ts` 的接缝）把请求层换成桩才可能——`createPortalServer`
一份会话造一个 axios 实例，实例本身不对外暴露。
