# 调用方式与用例

本文所有代码都对着当前导出的真实 API 写（不是设想）。API 清单来自 `dist/index.js` 的实际导出。

SDK 的业务范围以对应 Portal 页面实际可见、可操作的内容为准。页面用于操作的内部ID仍会说明；后端附带而页面不用的兼容扩展字段不属于AI消费契约。页面只显示原值且不标单位时，按原值交付，不自行换算；页面没有的撤销或额外验证能力不会被当作调用前提。

## 0. 两种入口，先选对

| 入口 | 服务几个用户 | 用在哪 |
| --- | --- | --- |
| `createPortalHeadless(config)` | **一个**（凭据绑在实例上） | CLI、脚本、单账号任务、冒烟 |
| `createPortalServer({ baseUrl })` | **多个**（每个用户自己带凭据） | SY 服务端（设计 A2） |

原因见 README：`createPortalHttp` 的凭据是创建时绑定的，没法靠单次请求换人。

---

## 1. 最小可用：读一份会议室列表

```ts
import { createPortalHeadless } from 'portal-headless'

const sdk = createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token: portalToken, tenantId },
})

const page = await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })
// { list: [{ id, name, ... }], total }
```

`list()` 会自动补上 renren 列表页的默认查询参数（`order`/`orderField`/`name`），
所以发出去的请求与浏览器**逐字段一致**——这不是可选的装饰，是 `test/baseline-write.test.ts`
一类测试会挡住的东西。

---

## 2. AI 找路：`recommend` → `describe` → 调用

这是 `-llm` 协议的真实用法（设计 D14）。**注意链路是分层的、逐步收窄的**，
不要把整个目录一次塞给模型。

```ts
// 第一步：用户说人话，拿到候选能力（带可解释的理由）
const rec = sdk.catalog.recommend('帮我订个会议室')
// rec.ok / rec.reason    有没有认出「可调用的能力」；false 时 reason 说清是哪种"没有"
// rec.intent             读写意图（read / write / mixed / unknown）+ 命中的信号词
// rec.capabilities: [
//   { id: 'meeting-room-usage', score: 122.2, reasons: [...] },
//   { id: 'meeting-room-list',  score: 101.8, ... },
//   { id: 'meeting-application-submit', score: 93.7, ... }, ...
// ]
// rec.capabilityGroups   按读写分好的两组（read / write），省得自己按 write 过滤
// rec.next: [{ tool: 'describe', args: { capabilityId: 'meeting-room-usage' }, role: 'next', why: '…' }]

// 第二步：问这个能力「怎么调、要什么参数、拿到数据后下一步去哪」
const usage = sdk.catalog.describe('meeting-room-usage')
// usage.invoke            { capabilityId, sdkPath } —— 这个能力在 SDK 里到底怎么调
// usage.params            参数契约（含参数类型：enum / search / tree / date / number / text）
// usage.returns           返回形状
// usage.consume.keyFields 关键字段，以及「这个字段对应哪个下游能力」
// usage.next              下一步该调哪个 describe；每条都带 role: 'next' | 'detour'
// usage.related.upstream  链上指过来的能力（含长选项参数的候选来源）
// usage.warnings          例如「该页面浏览器也不发 module-type」（D34）

// 第三步：按契约调用（两种入口等价，见 §2.1）
const rooms = await sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
```

### 2.1 怎么把这次调用发出去（G1）

`describe()` 给的不只是契约，还有**执行绑定**：`usage.invoke`。

```ts
const binding = sdk.catalog.describe('meeting-room-usage').invoke
// { capabilityId: 'meeting-room-usage', sdkPath: 'meetingApplication.roomUsage' }
```

两种用法是同一份实现，随你挑：

```ts
// ① 通用入口：不必知道能力属于哪个分组（推荐给 AI / 动态编排）
await sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })

// ② 手写路径：sdkPath 告诉你人应该怎么写
await sdk.meetingApplication.roomUsage('2026-09-22')
```

`invoke(capabilityId, args)` 里 `args` 的键就是 `describe().params[].name`。
能力 ID 不存在（或目录里有、但没接进执行层）时**当场抛 `CapabilityInvokeError`**，
错误里会列出真正能调的能力——不会静默失败。`describe().invoke` 为 `null` 就是"调不到"。

### 2.2 `next` 的边标了性质（G3）

```ts
usage.next
// [ { tool: 'describe', args: { capabilityId: 'meeting-application-prepare' }, role: 'next',   why: '…' },
//   { tool: 'describe', args: { capabilityId: 'meeting-application-definition' }, role: 'detour', why: '…' },
//   … ]
```

`role: 'next'` 是"把这件事做完的下一步"，`detour` 是岔路/可选（同页面的其他能力、
回页面层看看、事后动作等）。岔路一律排在后面，所以 `next[0]` 就是首选边。

判定口径（按语义最短链定的，别按代码分支批量默认）：

| 边 | 性质 |
| --- | --- |
| `usage → prepare`（挑好空闲会议室就进表单） | `next` |
| `prepare → submit` | `next` |
| 必填长选项参数的候选来源（如 `meetingRoomId → meeting-room-list`） | `next`（拿不到它这次调用发不出去） |
| 选填长选项参数的候选来源（如 `startUserSelectAssignees → meeting-user-search`） | `detour`（只在 `tasks` 非空时才用得上） |
| `submit → cancel`（事后动作） | `detour` |
| `usage → definition`（订会议室用不上流程定义） | `detour` |
| 同页面的其他能力、`describePage` / `listPages` | `detour` |

如果模型不知道下一步该去哪，还能按层下钻：

```ts
sdk.catalog.listDomains()                      // 有哪些业务域，各有多少页/能力
sdk.catalog.listDomains({ detail: false })     // 减重版：不逐个域给 next/kinds（G9）
sdk.catalog.listPages('meeting-room')          // 这个域下有哪些页面
sdk.catalog.describePage('/dashboard/meeting-room/list')  // 这个页面上有哪些能力
sdk.catalog.search('工资')                      // 字面检索，命中会告诉你"为什么命中"
```

目录的每一次调用都带 `warnings: string[]`（**永远存在，没问题时是空数组**，G11），
不用写 `?? []`。`describe()` 找不到能力时，`suggestions` 是**按相关度排序**的相近能力
（复用 `search` 的打分器）；`reason` 里始终有已注册能力的全量清单，所以"拼错一个 ID"
时也不会没方向——`suggestions` 为空就真的没有相近的（G6）。

> **`xxx-llm` 的写法也能用**：`describe('meeting-room-usage-llm')` 与
> `describe('meeting-room-usage')` 等价，因为 `describe().llmToolId` 就是前者。

---

## 3. 写操作：prepare（只读）→ submit（真写）→ cancel

写链路刻意拆成两步，因为**第一步只读**。
（走通用入口时也一样：`invoke('meeting-application-prepare', draft)` 与
`invoke('meeting-application-submit', {...draft, requestId})` 是两个能力，
**不会**被合并成一次"准备好就提交"。）

```ts
const draft = {
  meetingName: '周会',
  meetingRoomId: 5,
  startTime: '2026-09-22 14:00:00',   // 分钟只能是 00 或 30
  endTime:   '2026-09-22 15:00:00',
  attendeeCount: 2,
}

// ① 只读：问后端「这次提交需要人工指定哪些审批人」
const { payload, tasks } = await sdk.meetingApplication.prepare(draft)
// 会议室流程实测 tasks = []（审批链只有「发起 → 发起人 → 结束」）

// ② 如果 tasks 非空，就要用户先选人；这里假定为空
const id = await sdk.meetingApplication.submit(draft, {})   // 返回新单据 id
await sdk.meetingApplication.cancelReservation(Number(id))  // 撤销
```

### 写操作要带 `requestId`（短窗口防重，D12）

后端零幂等，而写操作全部放开。超时重发一次 `create` 就是一张重复单据：

```ts
import { createRequestId } from 'portal-headless'

const requestId = createRequestId()          // 生成一次，**自己保管**
const id = await sdk.meetingApplication.submitIdempotent({ ...draft, requestId })
```

**关键在重试**：超时后重试必须**原样传回上一次那个 `requestId`**，
每次重新生成就等于没有防重（而且它不会报错，只是静默失效）。

同键重复调用会**回放第一次的结果**，不再发请求；同键但载荷变了会直接抛错
（`IdempotencyKeyReuseError`）——那说明调用方在复用键，是要修的 bug，不是要放过的情况。

**它不是幂等**：进程重启、多实例部署、TTL（默认 10 分钟）过后都不生效。
做不到什么逐条列在 `src/idempotency/README.md`。

走通用入口时这条规则一样管用——`requestId` 是 `invoke` 的**必填**参数，
缺了当场报错（不会静默地"不防重"）：

```ts
const requestId = createRequestId()
await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })
await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })  // 回放，不再发请求
```

`cancel` 目前不在防重范围内（D12 只包了 submit）：撤销按单据 id 走，重发最多得到一次
"该会议预定已取消"的业务报错，不会产生第二张单据。

**载荷会被本地校验**（`buildMeetingApplicationPayload` + `assertTimeSlot`）：
会议名称必填 ≤30、会议室必填、参会人数必填、参会人 ≤500、
分钟只能是 00/30、秒只能是 00、结束必须晚于开始。**这些规则来自前端 `disabledTime`
与后端 `validateTime`，不是拍脑袋加的**——报错在本地，不用等一次往返。

---

## 4. 多用户：SY 服务端的形态

```ts
import { createPortalServer } from 'portal-headless'

const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })

// 每个请求带的是「这个用户自己的」凭据；permissionContext 是非敏感权限版本/指纹
async function handleUserRequest(syUserId, portalToken, tenantId, permissionContext) {
  const scoped = await server.forSession({
    userId: syUserId,
    credential: { token: portalToken, tenantId },
    permissionContext,
  })

  const page = await scoped.meetingRoom.list({ pageNo: 1, pageSize: 20 })
  return page
}
```

同一 `(用户, credential, 租户, 语言, permissionContext)` 复用同一份会话与基础数据；
省略 `permissionContext` 表示默认权限槽位。凭据轮换会淘汰旧会话；权限上下文应传非敏感
版本/指纹，不要传 token 或权限正文。换租户、语言就是另一份会话。
`server.catalog` 是所有会话共用的（目录是静态的）。

`server` 应作为进程级、长期复用的实例保存；如果每个业务请求都重新调用
`createPortalServer`，会话缓存和 single-flight 无法跨请求生效。凭据更新时传入新的凭据对象
重新调用 `forSession`，不要原地修改旧对象；SDK 会绑定不可变快照并淘汰旧凭据会话。
用户断开连接时调用 `server.sessions.invalidateUser({ userId })`（或更精确的失效方法），
进程收尾时调用 `server.sessions.clear()`。

会话门面上也有等价的通用入口，它绑的是**这份会话**的能力方法（凭据与 module-type
都是这一份的，不会串人）：

```ts
await scoped.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
```

按页面上下文调任意接口（不限于已封装的能力）：

```ts
await scoped.call('/dashboard/analysis/person/list', {
  url: '/some/read',
  method: 'get',
  params: { pageNo: 1 },
})
// 会自动推导并带上该页面的 module-type；算不出时不发这个头（D34）
```

---

## 5. 会话：复用、失效、统计

```ts
// 不加载、不刷 LRU、不返回已过期的
const same = server.sessions.peek({ userId, tenantId })
console.log(same === scoped.session)   // true

// 基础数据是按需加载的，不是 acquire 就全拉
await scoped.session.ensure(['dict-hr'])
scoped.session.has('dict-hr')          // true
scoped.session.failureList()           // 降级过的能力（非 critical 失败不会抛，会记在这）

// 失效：会话级、能力级，以及按身份维度批量失效
scoped.session.invalidate('dict-hr')                                    // 当前会话的某一项
server.sessions.invalidateCapability({ userId, tenantId }, 'dict-hr')   // 精确到会话
server.sessions.invalidateCapabilities({ userId, tenantId }, ['dict-hr', 'dict-platform'])
server.sessions.invalidateUser({ userId })                              // 该用户全部租户
server.sessions.invalidateTenant({ tenantId })                          // 该租户下全部用户
server.sessions.invalidateLanguage({ userId, tenantId, language: 'en-US' })
server.sessions.invalidatePermissionContext({ userId, tenantId, language, permissionContext })
server.sessions.invalidateWhere({ userId, tenantId, language, permissionContext })
server.sessions.invalidate({ userId, tenantId }, 'manual')              // 断开连接

console.log(server.sessions.stats())
// { sessions, pending, created, hits, misses, expired, evicted, invalidated, degraded, loads }
```

TTL 默认 **绝对 30 分钟 + 空闲 30 分钟，取先到者**；容量默认 64 份，超了按 LRU 淘汰。
过期与淘汰都从 `onEvent` 出来，不用轮询。

写能力成功后，服务端应根据写能力 ID 调用 `applyInvalidation(session, target)`，再由
`server.sessions.invalidateCapabilities(session.key, keys)` 执行安全的能力级失效；失败或
未确认成功的写不能触发失效。`applyInvalidation` 返回 `invalidated` / `absent`，可用于记录
结果。身份维度失效 API 只作用于匹配的会话，空筛选器会拒绝；整体清空请显式调用 `clear()`。

---

## 6. 长选项参数：必须先问用户要关键字

这是 D6/H35 的落地。人员候选有几千个，**全量拉取会把模型上下文冲掉**——
Portal 页面自己就是这么干的（`simple-page?pageNo=1..9&pageSize=500`，实测约 4500 人），
**无头不能照抄**。

```ts
// 用户说"李"→ 拿关键字去搜
const { list } = await sdk.meetingApplication.searchUsers({ keyword: '李', pageSize: 20 })

// 用户不知道有什么可以看 → 按部门缩小
await sdk.meetingApplication.searchUsers({ deptId: 100 })

// 下面两种会被本地直接拒掉，不发请求：
await sdk.meetingApplication.searchUsers({})                       // 抛：必须提供 keyword 或 deptId
await sdk.meetingApplication.searchUsers({ keyword: '李', pageSize: -1 })  // 抛：不允许全量拉取
```

参数契约里标了类型（`search` / `tree` / `enum` / `date` …），
`describe()` 返回时会带上"这类参数该怎么消费"的说明。

**候选从哪来也写在契约里**（G2）：登记过候选入口的参数，`lookup` 会告诉你用哪个能力、
拿哪个参数当关键字；`next` 里也会多一条指过去的边（必填参数是 `role: 'next'`，
选填参数是 `detour`，见 §2.2），`related.upstream` 里同样能找到。
没登记的会明确写"入口需要人工确认"，不会假装有。

```ts
const prepare = sdk.catalog.describe('meeting-application-prepare')
// meetingRoomId 这一个参数（用户给不出、必须查）：
//   lookup: { capabilityId: 'meeting-room-list', keywordParam: 'name', hint: '先用 name 作关键字调 meeting-room-list 取候选，再回来填 meetingRoomId' }
//   next[0]: { tool: 'describe', args: { capabilityId: 'meeting-room-list' }, role: 'next', why: '参数 meetingRoomId 的候选来源…' }
//   related.upstream: ['meeting-application-definition', 'meeting-room-usage', 'meeting-room-list']

const candidates = await sdk.capabilities.invoke('meeting-room-list', { name: '第一' })
```

---

## 7. 错误处理：两类错误分开

```ts
import { PortalApiError, PortalCredentialError } from 'portal-headless'

try {
  await sdk.meetingRoom.list({ pageNo: 1 })
} catch (error) {
  if (error instanceof PortalCredentialError) {
    // 凭据不可用（401/10001/1002015001）。无头下没有登录页可跳：
    // 唯一恢复路径是让用户重新走一次授权回调。
    // 注意：改密码不会让已签发的 token 失效，停用用户最坏可用到 JWT 过期（最坏 7 天）。
  } else if (error instanceof PortalApiError) {
    // 业务失败。error.code / error.ret / error.bizData 都在。
    // ⚠️ 后端的区分度很差：业务冲突报 500，令牌类失败统一报 401「账号未登录」。
    //    不要指望靠 code 区分"可重试 / 要换参数 / 必须告诉用户"。
  }
}
```

`error.capabilityId`（如果是从能力里抛出来的）能告诉你**是哪次调用**出的错。

---

## 8. 直接调接口（还没封成能力时）

```ts
await sdk.call('/dashboard/meeting-room/list', {
  url: '/hr/meeting-room/page',
  method: 'get',
  params: { pageNo: 1, pageSize: 20 },
})
```

`call()` 的第一个参数是**页面上下文**，不是接口——它决定这次请求带什么 `module-type`。
`module-type` 只影响后端的**数据范围**，不传会让范围变成该用户全部模块的并集（F19），
所以不要绕开它直接用 `sdk.http`。

---

## 9. 基础数据：部门 / 字典 / 权限清单

这三个**不是页面能力**，是应用外壳级的：Portal 的路由守卫在任何 dashboard 页面刷新时都会打它们，
与用户落在哪一页无关。它们挂在 `sdk.baseData` 上，九个入口**全是只读**（所以都不需要 `requestId`）。

设计取向与页面能力相反：**没有「全量倒出来」的入口**。三个载荷加起来约 1.2 MB
（字典近 1 MB / 885 个 dictType、权限码 2159 条、部门 1551 个节点），
一次给出去就会冲掉调用方的上下文——这是 §6 那条规矩在"整张表"上的同一性问题。
每个入口都有**硬上限**，按 `dictType` / 关键字取片。

### 9.1 字典：先搜名字，再按 dictType 取

```ts
// 885 个 dictType 名字是长选项：名字记不全就先搜（keyword 必填，无关键字直接拒、不发请求）
const { list } = await sdk.baseData.searchDictTypes({ keyword: 'assignment' })
// [{ dictType: 'assignment_type', entryCount: 6 }, …]

const { dictType, entries } = await sdk.baseData.getDict('assignment_type')
// entries: [{ id, value, label }, …] —— 一次只取**一个** dictType 的全部选项

// 只关心「这个码显示成什么」时用 translate：传数字 1 也能命中（比对做了 String() 归一）
await sdk.baseData.translateDict({ dictType: 'assignment_type', value: 1 })
```

三条容易踩的（都来自实测）：

- **`dictType` 写错是报错，不是静默返回 `[]`**：885 个名字猜不得，返回空数组会让"名字写错了"
  看起来像"这个字典是空的"。正确的走法是 `searchDictTypes` 先确认名字。
- **`label` 可能带前导空格**（`assignment_type` 的 `「 图片+文字」` 就是），能力**原样返回、不 trim**。
- **有些 dictType 是全平台共用的**：`status` 装的是交易状态（`WAIT_SELLER_CHECK` 这种），
  不是业务状态。本能力不替调用方解释 dictType 的含义。

`translateDict` 在查不到**值**时返回 `{ label: null, found: false }`，**不抛错**——
查一个不存在的码是正常情况，与 `dictType` 写错不是一回事。

### 9.2 部门：1551 个节点，同样先要关键字

```ts
// keyword 必填；不给（或只有空白）会被本地直接拒，不会发请求
const { list, total, matched } = await sdk.baseData.searchDepartments({ keyword: '财务' })

// 按 id 取一个部门，附带**从根到它的路径**
const one = await sdk.baseData.getDepartment(3)
// { id: 3, name: '财务中心', parentId: 2,
//   path: [ { id: 1, … }, { id: 2, … }, { id: 3, … } ],
//   pathNames: '沃德辰龙/华都峪口/财务中心' }

// 直接下级；传 0 取根节点（实测根的 parentId 是 0，**不是 null**）
await sdk.baseData.listDepartments({ parentId: 0 })
```

`getDepartment(777)` 这种不存在的 id 会报错并告诉你"共 N 个节点"，而不是给一个空壳——
部门 id 同样属于"不允许猜"的参数，先 `searchDepartments` 拿候选。

### 9.3 权限码：只回答「有没有」

```ts
await sdk.baseData.hasPermission('investment:daily:account:export')     // boolean，精确匹配

// 批量：数组或逗号分隔的字符串都收，返回两份
await sdk.baseData.checkPermissions(['a', 'b'])                          // { granted, missing, checked }
await sdk.baseData.checkPermissions('/dashboard/assignment/assignment, x:y')

// 前缀查询就是**传前缀**（不区分大小写的片段匹配）
await sdk.baseData.searchPermissions({ keyword: 'investment:' })
```

两种形态的码都在清单里：页面路径码（`/dashboard/assignment/assignment`）与动作码
（`investment:daily:account:export`）。⚠️ **不在清单里不等于会 403**，
理由与判据见 `docs/base/权限清单.md`。

### 9.4 两种入口是同一份实现（G1）

```ts
const described = sdk.catalog.describe('base-permission-has')
// described.invoke.sdkPath === 'baseData.hasPermission'

await sdk.capabilities.invoke('base-permission-has', { code: 'investment:daily:account:export' })
await sdk.baseData.hasPermission('investment:daily:account:export')      // 同一个方法
```

标量参数（`getDepartment` / `getDict` / `hasPermission`）与收对象的入口在绑定层做了适配，
但校验与语义都在能力自己那一层，两边不会分叉。

多用户门面（§4）上是同一份形状：`scoped.baseData.*` 绑的是**那份会话**的凭据与租户，
`scoped.capabilities.invoke('base-permission-has', …)` 也照常可用。

三个接口**都不发 `module-type` 头**：它们的 `pagePath` 是合成的 `/base-data/*`，
规则表里匹配不到——无头下没有"落地页"，与浏览器在这些接口上的行为一致（conventions 第 2 条）。
部门接口在后端带 `@DataPermission`，需要收窄范围时由接线方在建能力时显式给 `moduleType`，
SDK 不猜。

同一个实例里，**每一片数据只发一次请求**（片级索引 + 单飞）：Portal 自己一次首屏把字典打了 4 遍，
无头不照抄。要强制拿最新时 `sdk.baseData.invalidate()`（可只失效 `'dept' | 'dict' | 'permission'` 一片）。

---

## 10. 上传：把文件直传 OSS 拿到可访问 url

带附件的表单（尤其是流程表单）都要先有一个「可访问的 url」才谈得上提交。这块地基在 `sdk.baseUpload` 上，
复刻的是 Portal 的 `common/utils/oss.js`（全仓 356 处上传组件的唯一收口点）。

### 10.1 凭据在建 SDK 时给（不是每次调用）

```ts
const sdk = createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token: portalToken, tenantId },
  oss: {
    accessKeyId, accessKeySecret,          // 凭据
    bucket, endpoint,                      // 传到哪个桶；endpoint 只写主机名，不带协议
    // region 可选（V1 签名用不到它）
  },
})
```

**SDK 不读、不找、不落盘凭据**：不读环境变量、不读 Portal 前端仓库的 `.env`、不从浏览器抓
（conventions 第 8 条）。凭据也不出现在能力参数里——它不是 AI 每次调用要填的东西。

多用户门面（§4）上是**服务级**的一份配置：`createPortalServer({ baseUrl, oss })`
（`PortalServerOptions` 就是 `PortalHeadlessConfig` 去掉 `credential`），
所有会话共用它——Portal 自己 356 处上传也确实都落到同一个桶（`docs/base/上传.md` §3.1）。

### 10.2 先预演：`prepare` 一个字节都不发

```ts
const prepared = await sdk.baseUpload.prepare({
  path: './invoice.pdf',
  folder: 'Finance/expense',
  fileName: 'invoice.pdf',
})
// { method: 'PUT',
//   url: 'https://<endpoint>/Finance/expense/2026/09/xxxxxxxxxxxxxxxx.pdf',
//   objectKey: 'Finance/expense/2026/09/xxxxxxxxxxxxxxxx.pdf',
//   headers: { 'x-oss-date', 'Content-Type', 'Content-MD5', 'Content-Length', 'Authorization' },
//   canonicalString, publicUrl }
```

它**不发网络**（因此不消耗配额、不产生垃圾对象），所以很适合当"先把 url 备好"的一步：
url 可以提前写进别的表单，出问题时也能拿 `canonicalString` 与 OSS 文档逐行对照。

⚠️ 它与业务写能力的 `prepare()` **不是一回事**：那个要打后端问"这次需要哪些审批人"（§3），
这个是纯本地计算——OSS 没有"上传前先问一次"这种东西。

### 10.3 真写：`upload` 一步做完三步

```ts
const { url, objectKey, size, contentType, acl } = await sdk.baseUpload.upload({
  path: './invoice.pdf',
  folder: 'Finance/expense',
})

if (acl !== 'public-read') {
  // 这个 url 外人打不开，别急着把它提交进业务表单
}
```

三步 = `PutObject`（传字节）→ `PutObjectACL`（设 `public-read`）→ `GetObjectACL`（**读回来复核**）。
第二步**不能省**：桶不是默认公共读，省了会"上传成功但 url 打不开"，而且失败方式是静默的。
`acl` 是**从 OSS 读回来的**，不是我们填的那个字面量（"接口返回成功不算验证"）。

走通用入口是同一个实现（凭据仍来自建 SDK 时那份配置，不在 `args` 里）：

```ts
await sdk.capabilities.invoke('base-upload-file', { path: './invoice.pdf', folder: 'Finance/expense' })
```

几条参数规则：

- `content`（Buffer）与 `path`（本地文件路径）**二选一**，两个都给或都不给都当场报错（不猜优先级）。
  AI 侧一般给 `path`（它拿不到 Buffer）。
- `folder` 是**白名单**（31 个取值，取自 Portal 的 `ossFilePathOptions`，如 `HR/public`、
  `Finance/expense`、`Public/public`），传别的直接拒。选错不会报错、只会让文件散在一个没人找得到的地方。
- `fileName` 含扩展名；扩展名与 content-type 都从它推。**SDK 不做图片压缩/切割/PDF 解析**
  （那些要浏览器 canvas / wasm），要处理过的字节请先处理好。
- `fixedName` 是固定对象名（不含扩展名），⚠️ **同名会直接覆盖**桶里已有的对象。

⚠️ **没有 `cancel`**：写链路的撤销在这里对应 OSS 的 `DeleteObject`，本能力没有实现。
上传成功但业务表单没提交成功时，桶里会留下一个**孤儿对象**，目前只能调用方自己清
（`docs/base/上传.md` §7 记了这笔欠账）。

### 10.4 没配凭据：失败关闭，而且一个请求都不发

```ts
const sdk = createPortalHeadless({ baseUrl, credential })   // 没有 oss 这一段

try {
  await sdk.baseUpload.upload({ path: './a.pdf', folder: 'Finance/expense' })
} catch (error) {
  // OssCredentialError：文案里逐条列出缺哪几个字段
  // （accessKeyId, accessKeySecret, bucket, endpoint），并且明说 SDK 不会自己去找凭据。
  // 这个类定义在 src/capabilities/base-upload.ts；文档这里按 `error.name` 判，
  // 免得依赖包的转出清单。error.fields 是缺/错的字段名数组，便于程序化处理。
}
```

**没配 `oss` 也能建 SDK**（上传是可选能力，创建时就校验会让每一个不配 OSS 的调用方连 SDK 都建不起来），
但 `upload` / `getAcl` / `putAcl` 三个方法**都在发出任何网络请求之前**抛同一个错，
**一个都没漏**——漏掉任何一个都等于给"悄悄用空凭据去试一下"开口子。
凭据校验还排在参数校验与读本地文件**之前**：文件路径也不对时报的是凭据，那才是拦路虎。

排查用 `sdk.baseUpload.describeConfig()`：它返回**抹过的**配置画像
（secret 全抹成 `<redacted>`、AK 只留前 4 位），而且**没配凭据时也能调、也不抛**——
它正是用来回答"到底配上了没有"的。任何要输出配置的地方都不要直接 `JSON.stringify`。

### 10.5 回读与补设 ACL

```ts
await sdk.baseUpload.getAcl(objectKey)              // 'public-read' / 'private' / undefined（读不到）
await sdk.baseUpload.putAcl(objectKey, 'public-read')  // upload 第 2 步失败时补跑，不必重传字节
```

`upload()` 走到第 2 步失败（网络抖一下之类）时对象已经在桶里了，只剩 ACL 没设——这时用 `putAcl`
补一次即可。除此之外不要用它去改别人的对象。

---

## 11. 流程表单：通用审批 / 请假 / 用车 / 差旅费

Portal 里「发起流程」那一类表单（入口都是 `/dashboard/flow/form/edit`）本 SDK 做了四条线，
形态同族：`prepare`（只读）→ `submit`（真写）→ `detail` / `myInstances` → `cancel`，
外加只读的 `definition` 与候选查询。四条线的字段与审批人**拿不到接口定义**
（`process-definition/get` 的 `formFields` 恒为 `null`），
是从前端源码 + 真实页面推出来的，逐字段依据在 `docs/pages/<页面>.md`。

| 门面 | 流程 key | 表单 | 审批人从哪来 | 这条线特有的形态 |
| --- | --- | --- | --- | --- |
| `sdk.generalApproval` | `hr_general_approval` | `/simple/hr/form/035` | **1 个自选节点**（调用方选人，依次审批） | 抄送人 / 附件（有扩展名白名单） |
| `sdk.leaveApplication` | `qingjia` | `/simple/hr/form/005` | **BPMN 里写死的 3 个用户 id**（选不了） | 只读联动：年假余额 / 时长（§11.4） |
| `sdk.vehicleApplication` | `vehicle_usage_application` | `/simple/hr/form/031` | **3 个自选节点**，每个恰好 1 人 | 申请人按组织**分页**查；**没有附件控件** |
| `sdk.travelExpense` | `internal_transportation_expense_request_form` | `/simple/finance/form/003` | 由 `orgId` **派生**（选不了） | **明细行数组** + 审批链预览（§11.4） |

四条线的 `pagePath` 都不在菜单树里（流程表单走「发起流程」到达），所以
**一个都不发 `module-type` 头**——浏览器在表单页上同样不发（conventions 第 2 条）。

### 11.1 写链路：prepare（只读）→ submit（真写）→ cancel

以通用审批为样板（下面每一行都由 `test/usage-examples.test.ts` 用例 11 跑过）：

```ts
const draft = {
  applicationItem: 'SDK-TEST-流程表单',
  applicationContent: 'SDK-TEST-流程表单正文',
}

// ① prepare：只读。它回答的是「这次提交要人工指定哪些审批人」——不写任何东西
const { payload, tasks } = await sdk.generalApproval.prepare(draft)
// payload 就是 create 会发的业务字段（先看一眼）
// tasks: [{ id: 'Activity_1o1sabd', name: '发起人自选2', minSelectCount: 1,
//           maxSelectCount: null, selectionOrderRequired: true }]
//   —— 本流程实测 1 个节点；请假恒为 []；用车恒为 3 个，每个 min = max = 1

// ② submit：走通用入口时 requestId 是**必填**，缺了当场抛 CapabilityInvokeError，一个请求都不发
await sdk.capabilities.invoke('general-approval-submit', draft)   // 抛：invoke 必须带 requestId

// ③ 正常提交：requestId 自己生成、自己保管；节点 id 来自 prepare
const requestId = createRequestId()
const id = await sdk.capabilities.invoke('general-approval-submit', {
  ...draft,
  requestId,
  startUserSelectAssignees: { Activity_1o1sabd: [197832] },   // 用户 id，不是姓名
})
// id 是**业务单据 id**

// ④ cancel：撤销要的是**流程实例 id**，不是单据 id —— 给 businessKey 时 SDK 自己换
await sdk.generalApproval.cancel({ businessKey: Number(id), reason: 'SDK-TEST-撤销' })
// 也可以直接给流程实例 id（少翻一次列表）
await sdk.generalApproval.cancel({ processInstanceId: 'inst-1', reason: 'SDK-TEST-撤销' })
```

两个在四条线上都成立的细节：

- **`prepare` 与 `submit` 是两次调用，不是一次**。走 `invoke` 也是两个能力
  （`general-approval-prepare` / `general-approval-submit`），不会被合并——调用方因此总有机会
  在真提交之前把 `payload` 与 `tasks` 给上层看。
- **`reason` 必填**（后端 `BpmProcessInstanceCancelReqVO.reason` 是 `@NotEmpty`）。
  页面允许空串提交、然后被后端拒；SDK 不照抄那个必然失败的输入，空串本地就拒。

⚠️ **`submit` 会真的发起流程、给真人推待办。** 测试时的三条自我约束（写在各自能力与
`smoke/*.mjs` 里）：标题/事由带 `SDK-TEST-` 前缀；把审批人**选成别人**；
测完立刻 `cancel`。**审批人绝对不要选发起人本人**——后端有一条
「流程发起人与审批人相同，自动审核通过」，那个节点会当场越过真人审批；
用车有 3 个自选节点，**三个全中时整条流程在 `create` 返回之前就走完，`cancel` 撤不掉**，
会永久留下一条撤不掉的单据。差旅费的审批人不是调用方选的（由 `orgId` 派生），
它的 `prepare()` 会把审批链问出来并对本人**自审拦截**（§11.4）。

### 11.2 防重：同一次意图重试必须复用同一个 `requestId`（D12）

流程表单比普通 CRUD 更该防重：后端零幂等，重发一次 `create` 就是**第二条流程实例
+ 第二串真人待办**。所以四条线的 `submit` 都配了 `submitIdempotent`（§3 的机制在这里同样适用）：

```ts
const requestId = createRequestId()
const params = { ...draft, requestId, startUserSelectAssignees: { Activity_1o1sabd: [197832] } }

await sdk.generalApproval.submitIdempotent(params)   // 真发请求
await sdk.generalApproval.submitIdempotent(params)   // 回放上次的结果，**一个请求都没再发**

// 换 requestId = 新的写意图 → 真的会再发一次（这就是「每次重试都新生成」为什么等于没防重：
// 它不会报错，只会静默失效）
await sdk.generalApproval.submitIdempotent({ ...params, requestId: createRequestId() })

// 同一个 requestId 配了不同的载荷：不发、不覆盖、不回放，直接抛 IdempotencyKeyReuseError
await sdk.generalApproval.submitIdempotent({ ...params, applicationItem: '另一次意图' })
```

顺手记一条**容易踩空**的：参与指纹的是 `payload`，不是 `submitIdempotent` 的全部参数。
通用审批的 `startUserSelectAssignees` 不在 `payload` 里（它由 `create` 的最后一步拼上），
所以「同 requestId 只换了审批人」**不会**触发复用错误——那正是要避免的：同一次意图就该连审批人一起原样重试。

### 11.3 长选项参数：候选查询必须先要关键字

审批人 / 出差人这类候选**页面自己是不带关键字全量拉的**（实测 4225~4500 人，`pageSize=500` 翻 9 页），
无头照抄会冲掉调用方上下文（§6 的规矩）。流程线的候选查询因此一律本地拦截，**不发请求**：

```ts
// 通用审批 / 用车的审批人候选打的是同一个接口（`/system/user/simple-page`）
await sdk.generalApproval.searchUsers({ keyword: '李', pageSize: 20 })
await sdk.vehicleApplication.approverSearch({ deptId: 100 })   // 不给关键字时按部门收窄

// 差旅费的出差人候选走另一个接口（`/sys/user/getUserBasicInfoPage`），判据是同一条
await sdk.travelExpense.travelers({ keyword: '胡' })

// 下面四条都会被本地拒掉，一个请求都不发：
await sdk.generalApproval.searchUsers({})                              // 抛：长选项参数…
await sdk.generalApproval.searchUsers({ keyword: '李', pageSize: -1 }) // 抛：不允许全量拉取
await sdk.vehicleApplication.approverSearch({})                        // 抛：长选项参数…
await sdk.travelExpense.travelers({ keyword: '  ' })                   // 抛：必须先给关键字…
```

⚠️ 唯一的例外是**用车申请人的选择器**：它的第一入口是组织范围、接口本身是分页的
（后端 `@Max(100)`），一次拉 4500 人在接口形状上就不可能发生，所以它不强制关键字、
**强制分页**（§11.4）。哪一类算长选项要看接口，不能套模板（`docs/pages/用车申请.md` §3.4）。

### 11.4 四条线各自的形态差异

**请假：三个只读联动，一个由后端决定的流程变量。** 这几项在页面上是自动带出来的展示块，
SDK 把它们做成了独立能力，`submit` 又会按页面的顺序**自己再打一遍**：

```ts
const draft = {
  type: 6,                                     // 探亲假（3/4/7/8/9 这几类**必须带附件**）
  reason: 'SDK-TEST-探亲假',
  startDate: '2026-09-21', startType: 1,        // 开始时间与「上午/下午」是**同一个控件**的两个产物
  endDate: '2026-09-25', endType: 2,
}

// 时长是后端算的（扣法定节假日）；本地那个 calculateLeaveDays() 不扣，两个不是一回事
await sdk.leaveApplication.duration({ startDate: '2026-09-21', startType: 1, endDate: '2026-09-25', endType: 2 })
await sdk.leaveApplication.yearRest()       // 不给 userId 就是当前登录用户（页面只会查自己）
await sdk.leaveApplication.types()          // 假别字典，页面每次挂载现读
await sdk.leaveApplication.prepare(draft)   // 本流程的 tasks 实测恒为 []（审批人写死在 BPMN 里）

// submit 一次打 4 个接口，顺序与页面一致（info → getRestDuration → 节点 → create）：
//   · 发起人四项（userId/userName/staffCode/fullPath）来自 profile()，**不接受调用方传**
//   · restDay 现算 —— 它进流程变量，决定 BPMN 走哪条分支（>=3 天才多一个「领导审核」）
//   · 本流程没有自选节点，第二个参数传 {} 就是对的
const id = await sdk.leaveApplication.submit(draft, {})

// 年休假（type = 13）余额不够：本地就拒，不发 create（页面同样 message.error 后 return）
await sdk.leaveApplication.submit({ ...draft, type: 13 }, {})   // 抛：年假剩余不足
```

**用车：申请人是分页查出来的员工，审批人是 3 个同名节点。** 这条线有两个 id 空间，
混用会选到错的人——申请人用 **staffId**（员工 id，如 `1163`），审批人用 **userId**（如 `18243`）：

```ts
const { organizationIds } = await sdk.vehicleApplication.applicantScope()   // 实测 10 个根组织
const page = await sdk.vehicleApplication.applicantPicker({ keyword: '姚', pageSize: 100 })
// page.list[0].staffId === '1163' —— 载荷里的 staffId 是**字符串**，键名也不是 applicantId
await sdk.vehicleApplication.applicantPicker({ pageSize: 101 })   // 抛：pageSize 上限 100（后端 @Max）

const { tasks } = await sdk.vehicleApplication.prepare(draft)
// 三个节点的 name **一模一样**（都叫「发起人自选」），只有 id 不同 —— 只能按 id 选人
await sdk.vehicleApplication.submit(draft, {
  Activity_0yx86ms: [197832], Activity_0q8l1yc: [197832], Activity_0viq4cx: [197832],
})
// 每个节点 maxSelectCount = 1 ⇒ 塞两个人本地就拦（通用审批那个节点是 null，不会拦）
```

**差旅费：明细行数组，金额由 SDK 算。** 页面上「差旅信息1 / 2 / …」可以加行删行，
每一行在提交前还会被改写过一次，SDK 逐字段复刻了那次改写：

```ts
const draft = {
  orgId: '1558',
  projectExpense: false,
  travelerIds: [14626],                        // 出差人的候选要先按关键字查（§11.3）
  reasons: 'SDK-TEST-差旅费',
  feePurpose: 'SDK-TEST-费用用途',
  paymentDate: '2026-10-15',
  travelEntryList: [{                          // ← 明细行数组：可以有多行
    startEndDate: ['2026-10-01', '2026-10-03'],
    startRegion: ['110000', '110100', '110101'], startAddress: '北京市东城区某路 1 号',
    endRegion: ['110000', '110100', '110101'], endAddress: '北京市东城区某路 2 号',
    tripMode: 2, trafficAmount: 100.5, foodAmount: 20, housingAmount: 30, inputTaxAmount: 5,
  }],
}

const prepared = await sdk.travelExpense.prepare(draft)
prepared.amount          // 155.5：金额总计，由 SDK 算（页面上这一格只读，**不接受调用方传**）
prepared.approvers       // 这条单子会打扰到的真人（去重后）
prepared.approvalChain   // 审批链预览
prepared.previewComplete // false = 这次预览不完整（项目费用时后端会补一个客户端拿不到的变量）

const row = prepared.payload.travelEntryList[0]
row.startProvince        // '110000' —— 省/市/区三级数组**按位置展开**
row.startRegion          // ['110000','110100','110101'] —— 原数组**仍然留着**（页面就是这么发的）
row.travelTotalAmount    // 150.5：交通+餐食+住宿+其他，**不含**进项税（amount 那一层才含）
// 'fundSource' 在非项目费用时是 undefined ⇒ **序列化后这个键整个消失**（不是 null）
await sdk.travelExpense.submit(draft)   // 一条请求
```

差旅费也是四条线里唯一**没有 `startUserSelectAssignees` 参数**的：它的审批人由 `orgId` 派生，
调用方选不了；`prepare()` 于是改成打一次 `POST /bpm/process-instance/preview` 把审批链问出来，
**发现当前登录用户在链上就拒绝构造提交**（后端那条「发起人与审批人相同自动通过」会
让流程当场走完、撤不掉）。要换审批人，换的是 `orgId`，不是人。

---

## 12. 待办办理：审批侧（`sdk.taskAction.*`）

§11 那几条线做的都是**发起侧**：提交一条单据、把待办推给别人。**别人提交给我们的单据，
SDK 一条都办不了** —— 于是那些线只有半条闭环。这一节补的是另一半（用例 17~19 跑过）。

它**横切**：与流程无关，只与 Flowable 的 **task** 有关，入口是 `/bpm/task/**` 与
`/bpm/process-instance/**`，**对 82 个流程一视同仁**。所以契约里**一个流程字段都没有** ——
参数只有 `taskId` / 审批意见 / 附件 / 抄送人 / 接收人。

| 能力 | 读写 | 接口 | 页面 |
| --- | --- | --- | --- |
| `task-action-instance` | 读 | `GET /bpm/process-instance/get?id=` | 流程详情（办理） |
| `task-action-workflow-path` | 读 | `GET /bpm/process-instance/getWorkflowPath?processInstanceId=` | 流程详情（办理） |
| `task-action-return-options` | 读 | `GET /bpm/task/list-by-return?id=` | 流程详情（办理） |
| `task-action-approve` | **写** | `PUT /bpm/task/approve` | 流程详情（办理） |
| `task-action-reject` | **写** | `PUT /bpm/task/reject` | 流程详情（办理） |
| `task-action-transfer` | **写** | `PUT /bpm/task/transfer` | 流程详情（办理） |
| `task-action-delegate` | **写** | `PUT /bpm/task/delegate` | 流程详情（办理） |
| `task-action-return` | **写** | `PUT /bpm/task/return` | 流程详情（办理） |
| `task-action-batch-approve` | **写** | `PUT /bpm/task/batchApprove` | 批量办理 |
| `task-action-batch-reject` | **写** | `PUT /bpm/task/batchReject` | 批量办理 |

门面是 `sdk.taskAction.*`，也可以用通用入口 `sdk.capabilities.invoke('<能力 id>', {...})`
——**同一份实现**（G1，`describe('task-action-approve').invoke.sdkPath` 就是 `taskAction.approve`）。
两条页面路径（`/dashboard/flow/form/detail`、`/dashboard/backlog/task-examine/batch-process`）
在 module-type 规则表里都匹配不到，所以**一个 `module-type` 头都不发**（conventions 第 2 条）。

### 12.1 先看清「该我办的是哪条」，再办

三个 id 不要混——混了会得到 404 或「任务不存在」，而不会有人告诉你拿错了：

| id | 从哪来 | 谁要它 |
| --- | --- | --- |
| **业务单据 id** | 流程表单线 `submit` 的返回值 | 那条线的 `detail` / `cancel` |
| **流程实例 id** | 待办列表行的 `processInstance.id`、「我的流程」行的 `id` | `instance()` / `workflowPath()` / `cancel` |
| **任务 id** | **待办列表那一行的 `id`**（`backlog-task-examine-list`） | **所有办理动作的 `taskId`** |

```ts
// ① 流程实例：办理页挂载时打的第一个读（流程名 / 发起人 / 业务单号）
const instance = await sdk.taskAction.instance(processInstanceId)
// ⚠️ 这个响应里**没有表单字段**：formFields 恒为 null（要看单据内容得回各自的业务接口）

// ② 审批链路：这个流程**有哪些节点**、每个节点归谁（树 → 展平，加签产生的 children 也在里面）
const tasks = await sdk.taskAction.workflowPath(processInstanceId)
// [{ id: 'Task_1o1sabd', name: '发起人自选2', status: 1, assigneeUser: { id: 18243, nickname: '姚淼鑫' } }, …]

// ③ **该我办的是哪条** —— 页面 loadRunningTask() 的三条判据，逐条复刻在 myRunningTasks() 里
const mine = await sdk.taskAction.myRunningTasks(processInstanceId, myUserId)
// 判据：status ∈ {1 审批中, 6 委派中} 且 assigneeUser.id == 我，**递归 children**
//   顶层 status === 4（已取消）的节点在 ② 就被丢掉了
```

三条判据里最容易读错的是第一条：**`0` 是「待审批」，不是「审批中」**（只出现在加签产生的、
还没轮到的任务上），页面把它排除在外。第二条是**归谁**：`assigneeUser.id`（不是 `startUser.id`、
也不是任务的 `taskDefinitionKey`）。第三条：**加签产生的子任务同样可能在等我**，所以要递归。

`myRunningTasks()` 自己就是调 `workflowPath()` 再筛 —— 它是**一次读**（不是从 ② 那份结果里筛），
调用方自己决定这两步是各打一次还是一次就够。`myUserId` 必须由调用方给：
页面上它来自 pinia 的 `userStore.state.id`，**没有任何接口返回「我是谁」**。
SDK 侧有个推断入口 `sdk.taskAction.currentUserId()`（翻「我的流程」，最近一条的发起人就是我），
**账号一条流程都没发起过时返回 `undefined`** —— 那时不要拿它去比 `assigneeUser.id`，会一条都筛不出来。

```ts
// ④ 办它：`taskId` 就是上面那行的 `id`
const requestId = createRequestId()
await sdk.capabilities.invoke('task-action-approve', { taskId: mine[0].id, requestId })
// 也可以 sdk.taskAction.approve({ taskId, reason }) 或 sdk.taskAction.approveIdempotent({ … , requestId })
```

`approve` 的请求体是页面 `handleAudit()` 的五个键，**键顺序也是契约**（D20）：

```ts
{ id: '<taskId>', reason: '', attachmentUrl: '', attachmentName: '', copyUserIds: [] }
```

⚠️ **两个附件键没传时页面发的是空串，不是省略这个键**（`auditForms` 的初值就是空串），SDK 照抄。
通过时 `reason` 可以是空串（后端替换成「无」），驳回时必填（§12.3）。

⚠️ 后端只让你办**分配给你的**任务（`BpmTaskServiceImpl.validateTask()`：`task.assignee != 我` 就抛
`TASK_OPERATE_FAIL_ASSIGN_NOT_SELF`）。这不是 SDK 的限制 —— **SDK 没有办法办别人的待办**，
与页面完全一致。

### 12.2 七个写能力**全都**带防重（D12）

理由比 §11.2 更硬：`/bpm/task/**` **全部零幂等**，而且失败形态最坏 —— 第一次其实成功了、
超时重发第二次会拿到「流程任务不存在」（任务已不再是 running），**调用方会把「成功」读成「失败」
然后继续重试**。所以这个文件里**每一个写操作**都配一个 `*Idempotent` 变体
（比流程线「只包 submit」更宽），`target` 取 `taskId`：

```ts
await sdk.taskAction.approveIdempotent({ taskId, requestId })            // 真发
await sdk.taskAction.approveIdempotent({ taskId, requestId })            // 回放上次的结果，**一个请求都没再发**
await sdk.taskAction.approveIdempotent({ taskId, requestId: createRequestId() })   // 新的写意图 → 真的再发
await sdk.taskAction.approveIdempotent({ taskId, requestId, reason: '改过的意见' }) // 抛 IdempotencyKeyReuseError
```

七个变体：`approveIdempotent` / `rejectIdempotent` / `transferIdempotent` / `delegateIdempotent` /
`returnIdempotent` / `batchApproveIdempotent` / `batchRejectIdempotent`。
通用入口 `invoke()` 绑的**就是**它们（不是没防重的那一份）。

⚠️ 一处与 §11.2 **形态不同**、值得单独记的地方：任务这条线的指纹是**全部参数**
（`task-action-*` 没有另外的载荷构建器），所以「同 requestId 只多带了一个附件」也算换了意图、也会抛；
而通用审批那条线上换 `startUserSelectAssignees` 是**静默回放**的（它不在 payload 里）。
规则不变：同一次意图重试就**原样传回同一个 requestId**。

### 12.3 驳回要理由；回退前先读 `returnOptions`

```ts
// 驳回：审批意见**必填**（页面 message.error，后端 BpmTaskRejectReqVO.reason 是 @NotNull）
await sdk.taskAction.reject({ taskId, reason: '资料不全' })     // 空串 / 纯空格 / 整个不给 → 本地就拒，不发请求

// 回退：**先读**能退到哪些节点，再拿返回值里的 taskDefinitionKey 去回退
const options = await sdk.taskAction.returnOptions(taskId)
// [{ name: '发起人', taskDefinitionKey: 'Activity_1o1sabd' }]   ← 后端把 UserTask 的 id 放在这个字段里
await sdk.taskAction.returnTask({
  taskId, targetTaskDefinitionKey: options[0].taskDefinitionKey, reason: '退回补充',
})
```

`targetTaskDefinitionKey` 的取值**只能来自 `returnOptions()`** —— 页面上它是一个下拉，给不出别的。
返回**空数组**时页面提示「当前没有可回退的节点」并且**不开弹窗**；SDK 不做这个判断，把数组如实给你
（没有可退节点时不要硬给）。`taskId` 与 `reason` 都是必填，空的一律本地拒。

转办 / 委派是另外两个动作，形状一样（`{ id, <目标>, reason }`，三者都必填），语义不同：

```ts
await sdk.taskAction.transfer({ taskId, assigneeUserId: 197833, reason: '我不熟这块' })   // 这活儿归他了
await sdk.taskAction.delegate({ taskId, delegateUserId: 197833, reason: '先帮我看一眼' })  // 看完**还会回到我这里**
```

⚠️ 这两处的**人选**是长选项参数：必须先按关键字查（§6 / D6），能力是 `general-approval-user-search`
（`/system/user/simple-page`），SDK 侧的入口是 `sdk.taskAction.searchUsers({ keyword })`。
**这是本能力唯一一处刻意偏离浏览器的地方** —— 页面在这三处自己都是无关键字拉全量（实测 4000+ 人）。

批量办理（页面在 `/dashboard/backlog/task-examine/batch-process`）的载荷有两处与单个办理不同：
附件是**两个逗号拼接的字符串**（不是 `[{url, name}]`），`type: 0` 与 `variables: {}` 是页面写死的
（`batchReject` 比 `batchApprove` 少一个 `variables`）；抄送人上限 **10 人**，本地先拦。

```ts
await sdk.taskAction.batchApprove({ taskIds: ['Task_a', 'Task_b'], attachments: [{ url, name }] })
await sdk.taskAction.batchReject({ taskIds: ['Task_a'], reason: '批量不通过必须给意见' })
```

### 12.4 ⚠️ 一个必须知道的真实限制：单账号下**办不了自己的单子**

后端有一条规则：**「流程发起人与审批人相同，自动审核通过」**
（`BpmTaskServiceImpl.tryAutoApproveWhenStartUserIsAssignee()`，`BpmTaskEventListener.taskCreated()`
的两条分支都会走到它）。所以「自己提交、审批人填自己」的任务**当场就被自动办完**，流程进终态，
`cancel-by-start-user` 从此必然报「流程取消失败，流程不处于运行中」—— **那条单据永远撤不掉**
（测试环境里已经因此留了 3 条）。

由此得到两条结论（**本轮实测 + 源码双向确认**，详见 `docs/pages/待办办理.md` §4）：

- **单账号造不出一条「留给自己办」的待办**，也就没法用它端到端验证办理链路；
- 唯一的逃生口是流程变量 `BPM_SKIP_AUTO_APPROVE_TASK_DEFINITION_KEY`，
  但几个流程的 `startBpmProcess()` 都不吃调用方给的 map ⇒ **客户端注入不了流程变量**；
- 要真实办理，只差一样东西：**第二个测试账号**（用它发起、审批人填本账号）。

**这不是 SDK 的缺陷，是后端的规则** —— 写在这里免得调用方以为是自己用错了参数。
真去办别人的（真实）待办时，请按真人办件的标准来：`reason` 写清楚、抄送人留空、
测试单据的事由带 `SDK-TEST-` 前缀。

### 12.5 还没做的（如实列出，不要读成「已完成」）

- **加签 / 减签**（`PUT /bpm/task/create-sign`、`DELETE /bpm/task/delete-sign`）没做：后端有，
  但**前端一个调用点都没有**（全仓 grep 命中 0），页面上用户到不了这两个入口。
- **KPI 协议族（category 2..7）的办理**没做：「待办事项」页那个办理弹窗打的是
  `POST /bpm/hr/task/approve`，`type != null` 时它做的是 KPI 协议族专属的事（回写协议状态、
  插薪资基础数据、给签订人发消息）。把 `type` 开成参数等于把**某个具体流程族**的枚举写进一条
  声称通用的能力里，而且误用的代价比通用审批大得多 —— 所以只做通用那一条。
- **写链路没有端到端跑过**（原因见 §12.4）：这一节里的写请求形状**全部来自前端源码**
  （两处行号记在能力文件里），没有一次真实请求佐证。**不要把「形状对」读成「已验证」**；
  `smoke/with-portal-token.sh node smoke/task-action.mjs --probe-write` 那一轮只证明了
  「路由存在、HTTP 方法正确、**体字段名被后端读到了**」
  （判据是错误类型：拿到的是任务级「流程任务不存在」，不是参数级「任务编号不能为空」）。

---

## 13. 加班审批（`sdk.overtimeApplication.*`，表单 `/simple/hr/form/042`）

流程表单这一类的又一条线。字段与审批人同样**拿不到接口定义**（`process-definition/get` 的
`formFields` 恒为 `null`），是从前端源码 + 真实页面推出来的，逐字段依据在 `docs/pages/加班申请.md`。
用例 20~21 跑过下面每一条。

| 能力 | 读写 | 接口 |
| --- | --- | --- |
| `overtime-application-definition` | 读 | `GET /bpm/process-definition/get?key=` |
| `overtime-application-current-user` | 读 | `GET /sys/user/info`（**白名单收敛**，见 §13.4） |
| `overtime-application-approval-chain` | 读 | `POST /bpm/process-instance/preview` |
| `overtime-application-prepare` | 读 | `POST /hr/overtime-application/getRequiredStartUserSelectTasks` |
| `overtime-application-submit` | **写** | `POST /hr/overtime-application/create` |
| `overtime-application-detail` | 读 | `GET /hr/overtime-application/get?id=` |
| `overtime-application-my-instances` | 读 | `GET /bpm/process-instance/my-page` |
| `overtime-application-cancel` | **写** | `DELETE /bpm/process-instance/cancel-by-start-user` |

三条页面路径（`/simple/hr/form/042`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`）
都不在规则表里 ⇒ **一个 `module-type` 头都不发**，与浏览器一致（conventions 第 2 条）。

### 13.1 写链路：prepare（只读）→ submit（真写）→ cancel

```ts
// 草稿只有 6 个字段是调用方给的；另外 6 个（申请人 / 申请时间 / 申请部门 / 加班时长）由 SDK 算
const draft = {
  reason: 'SDK-TEST-加班审批',
  overtimeType: 0,   // 0 工作日加班 / 1 法定节假日加班 / 2 休息日加班
  subsidyType: 0,    // 0 转调休 / 1 转补贴 / 2 后期自行统计
  startTime: '2026-09-22 18:00:00',
  endTime: '2026-09-22 21:00:00',
  breakHours: 0.5,
}

const { payload, tasks, derived } = await sdk.overtimeApplication.prepare(draft)
derived.overtimeHours   // 2.5 = 3.0 − 0.5，**由 SDK 按页面算法算**（页面上这一格是 disabled 的）
tasks                   // []  ← 本流程一个「发起人自选」节点都没有（§13.2）

const id = await sdk.overtimeApplication.submit(draft)   // 写；守卫内置（§13.3）
await sdk.overtimeApplication.cancel({ businessKey: Number(id), reason: 'SDK-TEST-撤销' })
```

`prepare` 一次打两条请求（`/sys/user/info` → 自选节点接口），`submit` 是四条，顺序与页面一致
（**只有最后一条是写**）：

```
① GET  /sys/user/info                                      申请人的 5 个只读字段
② POST /hr/overtime-application/getRequiredStartUserSelectTasks   ← **要收完整载荷**
③ POST /bpm/process-instance/preview                        ★ SDK 加的守卫（§13.3）
④ POST /hr/overtime-application/create                      写
```

两处与 §11 那几条线不同的细节：

- **② 那个接口要收完整载荷**（`@Valid @RequestBody`）：传 `{}` 会被后端打回「结束加班时间不能为空」，
  所以 `prepare()` 的 `payload` 不是"顺手带上的"，是**必需的**；
- **`cancel` 要的是流程实例 id，而 `create` 返回的是业务单据 id**，且**详情接口的响应里没有
  `processInstanceId`**（`OvertimeApplicationRespVO` 只到 `status`/`statusName`）——
  唯一通路是按 `businessKey` 去「我的流程」换（给 `businessKey` 时 SDK 自己换）。

```ts
await sdk.overtimeApplication.cancel({ businessKey: 36, reason: 'SDK-TEST-撤销' })   // 先翻「我的流程」再撤
await sdk.overtimeApplication.cancel({ processInstanceId: 'inst-9', reason: 'SDK-TEST-撤销' })  // 少翻一次列表
```

`reason` 必填（后端 `@NotEmpty`），两个 id 至少给一个 —— 两者都缺或 `reason` 是空串，**本地就拒、不发请求**。
⚠️ `businessKey` 是**各业务表自己的主键**（「加班申请 36」与「会议室预定 36」会撞成同一个字符串），
所以 SDK 换实例时还会按 `processDefinitionKey` 再筛一道。

防重与 §11.2 一样，但这里更要紧：后端零幂等，重发一次就是**第二条流程实例 + 第二串真人待办**，
而且审批人是系统算出来的直属上级 —— 发重了，打扰的是同一个人两次。

```ts
const requestId = createRequestId()
await sdk.overtimeApplication.submitIdempotent({ ...draft, requestId })   // 真发（4 条请求）
await sdk.overtimeApplication.submitIdempotent({ ...draft, requestId })   // 回放，**一个请求都没再发**
```

走通用入口 `invoke('overtime-application-submit', { …draft, requestId })` 时 `requestId` 是**必填**：
缺了当场抛 `CapabilityInvokeError`、一个请求都不发；给了之后走的就是上面那条防重的路。

### 13.2 ★ 它没有「发起人自选」节点：审批人由后端按直属上级算

实测 `POST /hr/overtime-application/getRequiredStartUserSelectTasks`（带完整载荷）**恒返回 `[]`** ——
本流程**一个自选节点都没有**，所以 `startUserSelectAssignees` 传 `{}` 就是正确答案
（给了非空值会被本地拒：节点都没返回，那个 id 一定不是本次的节点）。

审批人从哪来？`GET /bpm/process-definition/get` 的 `bpmnXml` 里：

```xml
<userTask id="Activity_158exxp" name="直属上级审批" flowable:candidateStrategy="23" .../>
```

`23 = BpmTaskCandidateStrategyEnum.DIRECT_LEADER（直属上级）` —— 审批人是后端按**发起人所在组织
算出来**的，发起人既不知道、也选不了。想知道会打扰谁，只能问预览：

```ts
const preview = await sdk.overtimeApplication.approvalChain(payload)   // 页面上是「查看审批流程」按钮
preview.nodes.map((node) => node.type)        // ['START_EVENT', 'USER_TASK', 'END_EVENT']
preview.nodes[1].candidateStrategyName        // '直属上级'
preview.nodes[1].candidateUsers[0].nickname   // '乔娜'（实测）
```

### 13.3 ★★ 提交前的硬守卫：审批链里不能有发起人本人（比前几条线强）

**为什么必须有**：后端那条「发起人与审批人相同自动通过」命中时，流程**当场走完**、单据**永远撤不掉**
（§12.4 同一条规则）。前几条线的做法是「别把审批人选成自己」—— 可那**只对自选节点有效**，
而本流程压根没有自选节点，调用方**根本不知道审批人会是谁**，那条守卫在这里是死的。

所以本能力的判据换成**真实审批链**：`submit()` 在 `create` **之前**打一次
`POST /bpm/process-instance/preview`，逐个看 `nodes[].type === 'USER_TASK'` 的 `candidateUsers[]`，
**命中发起人本人就抛错**，一个写请求都不发（判据覆盖**所有** USER_TASK 节点：直属上级 /
部门负责人 / 岗位 / 用户组…，不只是自选节点）。

```ts
await sdk.overtimeApplication.submit(draft)
// 抛：★ 审批链里出现了发起人本人（userId=18243）：节点「直属上级审批」…这次提交绝对不能发…
```

守卫**只看 `USER_TASK`**：`START_EVENT` / `END_EVENT` 上没有「候选人」这回事，拿它们去比只是噪音。
逃生口只有一个 —— `submit(draft, { skipSelfApprovalGuard: true })`，**只在预览接口本身不可用时才该用**
（默认关着）。理由与流程线的 `assertAssigneesForTasks` 一样：宁可让调用方显式承认"我在冒险"，
也不要静默放过去。

⚠️ **两条如实记下的边界**：① 这条守卫**不能证明**审批人最终一定是预览里那个人 —— 预览是"按当前数据
算一遍"，真实办理时后端会拿**当时**的组织数据再算一次，组织架构刚变过时两者可能不一致；
SDK 能保证的是「预览时命中自己就一定拒绝」。② `skipSelfApprovalGuard` **一次都没在真实环境用过**。

### 13.4 只读联动与白名单

- **加班时长**：`max(0, 结束 − 开始 − 中途休息)`，保留 1 位小数（`toFixed(1)` 后再 `parseFloat`，
  与页面逐行一致）。**后端不重算**（只校验 `endTime > startTime` 与 `breakHours >= 0`），
  所以前端算错就**错着入库** —— 这也是 SDK 必须照抄算法、并且**不接受调用方传 `overtimeHours`** 的原因。
- **时间关系**：`endTime` 必须**严格晚于** `startTime`；休息时长越界会让加班时长算成 0，
  被页面那条「加班时长不能为 0」拦下 —— 这几条都在**发请求之前**校完，一个请求都不发。
- **`applyDate` 是「今天」**（`dayjs().format('YYYY-MM-DD')`），而且是**门户时区**的今天，
  不是加班那一天、也不是进程所在时区的今天（SDK 固定按 `Asia/Shanghai` 算）。
- **`/sys/user/info` 必须白名单收敛**：它的原响应里含 `password2`（bcrypt 串）与 `salt`。
  `currentUser()` **逐字段白名单**，那两个字段**连返回值里都不会出现**（有测试钉住）。
  顺带记一条：`GET /system/user/profile/get` 在这个 token 上报 500，所以 `/sys/user/info`
  是唯一可用的「我是谁」接口。

### 13.5 还没做的（如实列出，不要读成「已完成」）

- **「重新发起」（reapply）**：《我的流程》里对已驳回单据的重新发起是从原实例抄字段再提交的
  **另一条写链路**，需要单独验证。
- **改动 / 删除单据**：`PUT /hr/overtime-application/update` 与 `DELETE .../delete/{id}` 在
  **后端源码里整个被注释掉了**，页面上也没有入口 ⇒ **接口不存在**，谈不上"没做"。
- **打印**、以及 `/hr/overtime-application/record/*`（考勤管理下的「加班记录」**另一个页面**）没做。
- **「预览里的审批人 = 最终实际审批人」没有独立证实**：实测只证实了"提交后流程 `status=1`、
  撤销后 `status=4`"（两轮，各 2.5~3.3 秒，打扰了直属上级 1 条待办），**没有**去读那位同事的待办列表。

---

## 还没接线、暂时用不了的两块

这两块已经实现并测过，但**没有接进 `src/index.ts`**，所以上面拿不到：

| 模块 | 作用 | 状态 |
| --- | --- | --- |
| `src/invalidation/` | 「哪个写操作该失效哪些基础数据」（23 条规则，10 确定 + 13 推测） | 已实现，待接线 |
| `src/catalog/visibility.ts` | 按用户可见菜单收敛下发的目录面 | 已实现，待接线 |

接线时会一起补上：写操作成功后调一次 `applyInvalidation(session, {...})`，
以及用 `filterCatalog()` 收敛目录。

## AI 从描述到业务完成

只读元数据入口不访问 Portal：

```ts
const page = sdk.catalog.describePage('/dashboard/meeting-room/list')
const description = sdk.catalog.describe('meeting-room-list') // 也接受 meeting-room-list-llm
if (description.ok && description.ai) {
  // ai.whenToUse/boundaries/effect 区分用途、范围、准备与写入。
  // params[].contract 与 ai.inputs 给出来源、条件必填、枚举和嵌套输入。
  // ai.output / returns.fields 描述 SDK 最终数据，不是后端 ret/code/data 包络。
  // 按 ai.consume 消费；按 ai.steps 的条件、映射和角色继续；ai.completion 判断结束。
  // gaps 非空意味着仍有具体缺口，不能将该分支宣称为已经验证可完成。
}
const methods = sdk.catalog.listMethods()
const direct = sdk.catalog.describeMethod('meetingRoom.get')
// 未注册的公开业务方法按 direct.sdkPath 直接调用，不能把路径当 capabilityId。
```

页面能力清单返回用途、场景、效果和边界，与 `describe()` 使用同一份契约。`effect=prepare` 可能只在本地构造载荷，也可能读取当前记录或执行一次 AI 审核；具体副作用见边界。得到准备结果不等于写入。`steps` 中 `required`、`optional`、`recovery`、`cancel` 分别表示必须步骤、可选后续、失败恢复和用户需要时的撤销；撤销不是每次成功后都执行。

映射键是下游参数，值中的 `result` 来自本次返回、`args` 来自本次输入、`context` 是按操作说明保存的前序查询/原值、`user` 是用户明确给出的目标；`result.$` 表示整个结果，`literal:<JSON>` 表示常量。数组选择、逗号拼接和日期转换要遵循同一步的 `instruction`，不能把整个候选列表直接提交。

动态结构使用 `ai.output.dynamic.sdkPath` 及参数读取真实结构；它不意味着允许猜字段。写入异常或超时先使用描述指定的核实入口，是否复用 `requestId` 由该能力的 `idempotency` 决定。SDK 低层 `call/http` 是传输通道，不自动使尚未注册的批量生成页面成为可调用业务能力。

完整能力/直接方法/生成物盘点：运行 `pnpm build && node tools/audit-ai-contracts.mjs`，产出 `docs/ai-contract-audit/current.json` 和 `docs/pages/ai-contract-reference.generated.md`。这些文档由 SDK 描述生成，不另建手写权威来源。运行 `pnpm ai:check` 核对结构、绑定与映射；`pnpm ai:check:complete` 还会拒绝声明了真实缺口的条目。检查通过仍不能替代业务语义测试与真实证据。

### 结构下钻与补齐候选（2026-09-22）

`catalog.describeSchema('contract-template-content')` 是只读元数据入口，直接返回可序列化的模板根字段、13种可新建组件、历史组件边界、默认配置、变量、表格和跨字段约束。未知 schema ID 返回 `ok:false`；返回值为独立副本，调用方改写它不会污染下一次说明。`content` 仍为 JSON 字符串，仅保存模板，不启动审批。

```ts
const structure = sdk.catalog.describeSchema('contract-template-content')
if (structure.ok) {
  const allowedBlocks = structure.schema.blocks
  // 按每个组件的dataFields/defaultData/constraints组装；保留已有组件的本地id。
}
const candidates = sdk.catalog.describe('contract-support-contract-type-search')
// 按其invoke真实调用，选择list[].id作为模板typeId，而不是分类code。
```

人员/岗位/职务/角色与组织 ID 不通用。新的 `contract-support-*` 候选由各自源页面上下文请求，长选项必须先给 keyword；后端树接口没有关键词参数时，SDK 明示本地筛选和 truncated，不能把结果当全量。月度他人协议用新版角色组织树，年度协议及薪资筛选用原角色组织树。智慧蛋鸡课程必须配置 `smart-layer-app` 的 base URL，缺配置时拒绝，不回退平台实例。

差旅项目费用的 prepare 现在读取项目负责人，将员工 ID 转为字符串补入预览变量；成功不表示稍后提交一定成功。预算 applyAmount 为本行四类费用加进项税；法人选择先查候选，再调用 `contract-support-corporation-payee-get` 获取同一法人的开户信息，更换法人须清除旧账户，不照抄另一法人资料。

模型申请状态以固定 Java 实现支持的 0待处理/3驳回/4已处理为准，旧1/2拒绝且不猜映射。个人规则使用手机号；公共 SDK 流速请求显式补个人租户0。`fillApplyWithQuotaRule/FlowRule` 第二步异常抛 `AiModelApplyPartialWriteError`，从错误保存 createdRuleId/applyId/ruleKind/previousStatus，先核实再单独处理申请，不能重跑整个创建链。Token值须为安全正整数，单次上限另不超过2147483647。

本节对应 `test/contract-template-schema.test.ts`、`test/contract-support.test.ts`、`test/ai-contract-support-links.test.ts`、`test/ai-model-compat.test.ts`。所有新验证为离线，实际部署和跨账号权限效果未验证。
