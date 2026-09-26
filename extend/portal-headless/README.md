# portal-headless

Portal 前端（`CodeReview_Projects_Js` 的 `app/portal`）的**服务端无头 SDK**：让 AI 能像用户本人在浏览器里一样驱动 Portal。

设计文档：`~/Desktop/portal headless/portal-无头化-设计.md`（含全部决策记录与实测数据）。

## 当前状态

阶段① 的骨架。已经跑通的：

- 从 Portal 前端源码生成 SDK 需要的静态资产（`pnpm generate`）
- 复刻 Portal 前端的请求层：`/admin-api` 前缀补齐、四个请求头、GET 的 `_t` 与 qs 序列化、`{ret, code, msg, data}` 包络与错误抛出
- 页面上下文驱动的 `module-type` 推导（含"算不出就不发"的行为，与浏览器一致）
- 第一条业务线：会议室列表（读）
- 第二条业务线：会议室预定表单（读 + 写），见 `docs/pages/会议室预定.md`
- **对真实测试环境的冒烟已跑通**（读到 8 条会议室）
- **逐字段基准回归**：`baseline/` 里存着浏览器真实发出的请求，测试断言 SDK 发出的必须与它逐字段一致
- **长选项参数保护**：`searchUsers()` 强制要求关键字，拒绝全量拉取
- **写能力（会议室预定）已在测试环境端到端验证过**：`prepare()`（只读，算需要哪些审批人）→ `submit()`（真写）→ `cancelReservation()`（撤销）。验证记录见 `baseline/meeting-application-write.verified.json`，另有浏览器侧的逐字段基准 `baseline/meeting-application-write.browser.json`
- **能力目录与检索**：分层下钻（域 → 页面 → 能力）、检索、路由推荐、`-llm` 协议
- **会话与基础数据缓存**：会话键 `(用户, 租户, 语言)`、绝对+空闲 TTL、单飞、按需加载 + 依赖、LRU、主动失效
- **多用户门面** `createPortalServer`：一个进程服务多个 Portal 用户与租户

## 命令

```bash
pnpm install
pnpm generate      # 从 Portal 源码生成 generated/*.json
pnpm docs          # 全链路：build → generate → openapi → lint → html → report → 漂移门禁
pnpm typecheck
pnpm test
pnpm build
```

冒烟（对真实环境读一次会议室列表，只读不写）：

```bash
pnpm build
PORTAL_BASE_URL=https://biz-api-test.wodecorp.cn \
PORTAL_TOKEN=<Portal 会话 token> \
PORTAL_TENANT_ID=<租户 id> \
pnpm smoke:meeting-room
```

冒烟（提交前准备，同样只读——不创建单据、不触发流程）：

```bash
PORTAL_BASE_URL=https://biz-api-test.wodecorp.cn \
PORTAL_TOKEN=<Portal 会话 token> \
PORTAL_TENANT_ID=<租户 id> \
pnpm smoke:prepare
```

冒烟（**写操作**，真的提交一张测试单，末尾自动撤销；设 `PORTAL_SMOKE_KEEP=1` 可保留）：

```bash
PORTAL_BASE_URL=https://biz-api-test.wodecorp.cn \
PORTAL_TOKEN=<Portal 会话 token> \
PORTAL_TENANT_ID=<租户 id> \
pnpm smoke:submit
```

参考来源固定为两个检出（口径见 `docs/conventions.md` 第 32 条，**用之前先 `git pull` 拉到最新**）：

| 角色 | 路径 | 固定分支 |
| --- | --- | --- |
| Portal 前端 | `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js` | `test/portal/main` |
| 后端 | `/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java` | `test/test` |

Portal 仓库路径可用 `PORTAL_REPO` 环境变量或 `pnpm generate <路径>` 覆盖。

## 用法

```ts
import { createPortalHeadless } from 'portal-headless'

const sdk = createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token, tenantId },
})

// 以「页面上下文」为单位调用：SDK 自动带上该页面正确的 module-type
await sdk.call('/dashboard/analysis/person/list', {
  url: '/some/read',
  method: 'get',
})

// 能力目录：检索与下钻
sdk.catalog.recommend('帮我订个会议室')       // 话术 → 候选能力（带可解释的理由）
sdk.catalog.describe('meeting-room-usage')   // 即 -llm：怎么调 / 参数契约 / 返回 / 下一步去哪

// 具体能力
await sdk.meetingRoom.list({ pageNo: 1, pageSize: 10 })

// 会议室预定：只读的准备 → 真写 → 撤销
const { tasks } = await sdk.meetingApplication.prepare({
  meetingName: '周会',
  meetingRoomId: 5,
  startTime: '2026-09-22 14:00:00',
  endTime: '2026-09-22 15:00:00',
  attendeeCount: 2,
})
const createdId = await sdk.meetingApplication.submit(draft, {})
await sdk.meetingApplication.cancelReservation(Number(createdId))
```

注意：会议室占用查询在 `meetingApplication` 下（路径属于 `/hr/meeting-application/`），
不在 `meetingRoom` 下。

### 服务多个用户（SY 服务端要用的形态）

```ts
import { createPortalServer } from 'portal-headless'

const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })

// 每个请求带的是「这个用户自己的」凭据
const scoped = await server.forSession({
  userId: syUserId,
  credential: { token: portalToken, tenantId },
})

await scoped.meetingRoom.list({ pageNo: 1, pageSize: 20 })
await scoped.call('/dashboard/meeting-room/list', { url: '/some/read', method: 'get' })
```

同一 `(用户, 租户, 语言)` 复用同一份会话与基础数据；换租户就是另一份会话（设计 F4）。

**为什么是两个入口**：`createPortalHttp(config)` 的凭据与语言是**创建时绑定**的，
拦截器闭包读的就是那份 config，没法靠单次请求传参换人。所以单用户门面把凭据绑在实例上，
多用户门面**一份会话一份请求函数**。这是有意的取舍：一份凭据一个实例，请求头天然不会串用户。

## 目录

```
src/
  config.ts                 初始化参数（baseUrl / 凭据）
  http/
    client.ts               复刻 platform.js 的请求与响应行为
    headers.ts              复刻 generateHttpHeaders()
    errors.ts               PortalApiError / PortalCredentialError
  context/
    module-type.ts          页面路径 -> module-type（规则的执行者）
  call.ts                   按页面上下文发请求（单用户/多用户共用，避免分叉）
  server.ts                 多用户门面 createPortalServer
  capabilities/
    types.ts                能力与参数契约的类型
    meeting-room.ts         第一条业务线：会议室列表
    meeting-application.ts  第二条业务线：会议室预定表单
  catalog/                  能力目录：分层下钻 / 检索 / 推荐 / -llm 协议 / 可见性过滤
    aliases.ts              人工维护：话术别名、同义词、域标签
    links.ts                人工维护：能力→下游域的链路（D14 的「哪一项对应哪个下游 ID」）
  session/                  会话与基础数据缓存
    portal-http.ts          与 src/http 的接线点（含为何一份会话一个实例）
  invalidation/             写操作 → 该失效哪些基础数据（23 条规则，每条带 file:line 证据）
baseline/                   浏览器真实请求的基准（逐字段回归用，勿手改）
docs/usage.md               调用方式与用例（每个用例都有测试钉住，见 test/usage-examples.test.ts）
docs/pages/                 每个页面的四件套记录
tools/generate/
  generate.mjs              从 Portal 源码生成页面清单与 module-type 规则
  derive-aliases.mjs        推导别名候选（覆盖 93.3% 菜单页，人工表优先）
  openapi.mjs               从能力目录生成 OpenAPI 规格
  report.mjs                覆盖与进度报告
  drift-check.mjs           生成物漂移门禁
generated/                  生成物，构建时烘入（勿手改）
smoke/
  read-meeting-rooms.mjs           只读：读会议室列表
  prepare-meeting-application.mjs  只读：提交前准备
  submit-meeting-application.mjs   写入：真提交（末尾自动撤销）
```

## 几条硬约束（来自设计文档）

- **环境不是 SDK 的概念**：连哪个环境完全由 `baseUrl` 决定（决策 D23）。测试用例自己传测试环境的地址。
- **`module-type` 必须按页面推导**：它只影响后端的数据范围，不传会让数据范围变成该用户全部模块的并集（F19）。算不出时保持与浏览器一致——不发这个头（决策 D34）。
- **`tenant-id` 必须显式传**：后端在部分路径会静默选错租户（F26）。
- **凭据失效无法即时生效**：改密码不撤销已签发 token，停用用户最坏可继续用到 JWT 过期（F21）。已接受现状（决策 D17）。
- **业务失败的信号很弱**：业务冲突报 `500`，令牌类失败统一报 `401 账号未登录`（F8/F16）。错误分类是待办，不要假设能靠 code 区分。
- **列表页默认会带空值查询参数**：浏览器发的是 `order=&orderField=&name=&pageNo=…&pageSize=…`，`order`/`orderField` 来自 renren 列表页默认。要做逐字段一致就不能省（`LIST_DEFAULTS`，见 `meeting-room.ts`）。

- **一个 axios 实例 = 一个用户的一个租户**：凭据与语言在 `createPortalHttp(config)` 创建时绑定，
  拦截器闭包读的就是那份 config。多用户要靠 `createPortalServer` 的「一份会话一份请求函数」，
  而不是给单次请求传凭据。

## 文档与 API 工具

一条命令跑完整条链：

```bash
pnpm docs
```

它依次做：`build` → `generate`（页面清单）→ `openapi`（规格）→ `docs:lint`（Redocly 严格规则）
→ `docs:html`（静态文档）→ `report`（覆盖与进度）→ `docs:drift`（漂移门禁）。

单独跑其中一步：

```bash
pnpm generate && pnpm report   # 只要覆盖与进度报告
pnpm docs:lint                 # 只校验规格
pnpm docs:drift                # 只查漂移（CI 里用 --strict 连报告一起比）
```

两条路线，服务两个不同的读者：

| 路线 | 给谁看 | 命令 | 产物 |
| --- | --- | --- | --- |
| **能力目录 → OpenAPI 3.1** | 调用方 / AI / Postman / Swagger UI | `pnpm openapi` | `generated/openapi.json`（规格）+ `generated/api-docs.html`（自包含静态文档，双击即开） |
| **覆盖与进度报告** | 你 / 团队 / AI | `pnpm report` | `generated/coverage.md` + `generated/coverage.html`（分布条形图 + 路线图） |
| **TypeScript 参考** | 写代码的人 | `pnpm dlx typedoc --entryPoints src/index.ts --out docs/api` | 静态 HTML 参考站 |

**OpenAPI 那条是本项目的主推**：SDK 的 API 面不在 TypeScript 类型上（只有十几个导出），
而在**能力目录**里——而能力定义本来就带参数契约（`name` / `kind` / `required` / `description`），
天然能映射成 OpenAPI。所以这份规格是**自动生成**的，不是手写的。
阶段 ④ 要给 SY 后端设计路由前缀时，它就是那个契约的草稿。

规格里除了常规字段，还带了几个项目特有的扩展：

- `x-portal-page` —— 这个能力绑定的页面上下文（决定 module-type）
- `x-write` —— 是否写操作
- `x-llm-tool` —— 对应的 `-llm` 工具 ID（D14 的下钻协议）
- `x-param-kind` —— 参数类型（`search`/`tree` 是长选项，必须先要关键字，见 D6）
- `x-next-steps` —— 拿到结果之后可以往哪走

凭据模型也写进了规格的 `securitySchemes`，不是只为了让 lint 过——它把 D1 选的凭据形态
（会话 token 而非私人令牌、`tenant-id` 必须显式传）固化进了契约。

**规则在 `redocly.yaml`**：在 recommended 之上收紧了 operationId / description / 4xx / security 等
与「能生成 SDK、能被人读懂」直接相关的几条。当前规格通过这些规则（`pnpm docs:lint`）。

**漂移门禁**（`pnpm docs:drift`）：生成物与 HEAD 不一致就失败，防止文档与代码悄悄分叉。
比对时会归一化掉 `generatedAt` 这类每次生成都变的字段——不这么做门禁永远红，等于没有。
（这个缺陷是门禁第一次运行时被它自己抓出来的。）

## 进度与分布看哪里

`generated/coverage.html` —— 双击即开，包含：

- **总览**：页面总数、已实现能力数、能推出 module-type 的比例
- **方法与进度（路线图）**：这条链上每个环节建成了没有，以及没建成的卡在哪。
  来源是手工维护的 `docs/roadmap.json`——「有哪些环节已经建成」只有人能判断，
  而页面覆盖数是自动统计的，两者是两回事
- **分布**：按业务域、按页面形态、按 module-type

口径提醒：页面覆盖率低是**符合阶段预期的**（阶段① 是验证方法 + 跑通一条业务线，不是铺量），
真正说明进度的是路线图那一节。

## 基准回归怎么加一个新页面

详细手册见 `tools/baseline/README.md`（含 antd 日期选择器等难点的可复用配方）。

1. 用 `bsk` 打开该页面，在页面里注入请求捕获钩子（**脱敏在页面内做，token 不出浏览器**）
2. 触发一次真实请求，把捕获结果写进 `baseline/<能力>.browser.json`
3. 写一条测试，断言 SDK 发出的 URL/method/header 与基准一致（参考 `test/baseline.test.ts`）
4. 用"把实现改坏"确认这条测试真的会红
