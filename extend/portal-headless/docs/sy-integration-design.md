# 阶段③④：接入 SY 后端的设计（路由前缀 / 鉴权 / 能力登记 / 凭据链 / 会话 / 可见性 / 版本）

| 项 | 内容 |
| --- | --- |
| 记录时间 | 2026-09-20 |
| 回答的条目 | `docs/roadmap.json` 阶段④ 的两项待办；阶段③ 的全部形态 |
| Portal 侧依据 | 本仓库 `docs/design.md`（D1–D36、F1–F26、H1–H42）、`docs/conventions.md`、`docs/eval-report.md`、`docs/eval-model-report.md`；代码 `src/**` |
| SY 侧依据 | `/Users/liyang/Documents/code/github/Synapse`（**只读**）：`server/src/**`、`desktop/**`、`docs/agents/**`、`docs/superpowers/specs/**`、`document/open-api/index.md`、`CLAUDE.md` |
| 状态 | 待评审。第 7 节列出**必须由用户拍板**的 10 条；除这 10 条外，本文的其余判断都有落点，可直接派单 |

**标注约定**

- 【读码】有 SY 侧或本仓库的文件行号，可直接核对。
- 【实测】本仓库既有的实测数据（浏览器基准、真实环境冒烟、评测装置产出）。
- 【推断】由代码事实推出，需确认。
- 【待决】本文不单方面定，见第 7 节。

---

## 1. 结论速览

| # | 问题 | 结论 |
| --- | --- | --- |
| ④-1 | 路由与鉴权风格 | **沿用 `/api/open/v1` 的机制**，Portal 挂在 `/api/open/v1/portal/**`；但**一期主通道走 `/api/console/portal/**`（会话鉴权）**，因为一期的调用方是 Synapse 自己的客户端而不是外部 CLI。**不新起 `Plugin/Portal-Headless/`** —— 它不是 HTTP 前缀，是 AI 工具名的风格（§2） |
| ④-2 | 能力登记位置 | **权威在 Portal 侧**（本包的生成物 + 能力定义）。SY 的 `API_KEY_CAPABILITIES` 只新增**一个** scope（`portal.invoke`），**不**逐条登记 1019 个页面；**排除** Portal 的 `openApiRegistry`（那是私人令牌白名单，与 D2 物理不兼容）。防脱节靠"SY 不复制目录 + 本包的漂移门禁 + 三处既有的同批更新规则"（§3） |
| ③-3 | 凭据怎么来 | 桌面客户端发起 → Portal 授权页 → `synapse://` declared protocol route 回调 → 桌面把凭据经会话鉴权的接口交给 SY 服务端 → 服务端只放内存。**一期用 URL 里带 token**（Portal 侧零改动，有先例）；一次性 code 是有代价的改造项。改密不失效、停用最坏 7 天（D17）写进 UX 文案，不做补偿（§4.1） |
| ③-4 | 多用户会话怎么持有 | SY 服务端**目前是单实例**（compose 单服务、nginx 单 upstream、无 replicas），进程内会话缓存与部署形态**一致**，一期不需要共享缓存。但必须显式做三件事：调大 `maxSessions`（默认 64 太小）、把"进程重启 = 防重窗口清零"写成运营事实、把"单实例"写成显式部署约束（§4.2） |
| ③-5 | 能力怎么被 AI 看见 | **目录是数据，不是工具**：新增一个 `portal` MCP domain，只放**固定 7 个**工具（与 `tools/eval/model.mjs` 已验证的 7 工具面同构）。**可见性收敛必须在服务端、在模型看到之前做**（`src/catalog/visibility.ts`，目前尚未接线），因为 Synapse 的 MCP 目录是全局构建、没有按用户过滤（§4.3） |
| ③-6 | 版本一致性 | A7 的字面口径（严格相等 + 人工过滤 UI 变更）**无法落地也不应落地**：包里目前**没有任何 Portal 版本锚点**。改为「产品版本 + 契约版本」两分，契约版本取生成物内容哈希（本包已有这个机制），运行时与 Portal 的 `build.json` 比对，**不匹配时降级只读**（§4.4，【待决】第 1 条） |

---

## 2. 阶段④-1：路由与鉴权风格

### 2.1 SY 现有的那套当时是为谁设计的

【读码】`/api/open/v1` 是真的，但它**不是一棵多域路由树**，今天只有**一个**能力：

| 方法 | 路径 | 文件 |
| --- | --- | --- |
| POST | `/api/open/v1/drive/public-links/downloads` | `Synapse/server/src/open-api/open-api.controller.ts:20,25` |
| POST | `/api/open/v1/drive/share-links/downloads`（兼容别名） | 同上，路径表在 `open-api-contract.ts:11-14` |
| GET | `/api/open/v1/downloads/{grantId}?token=` | `open-api-download.controller.ts:20,29` |
| GET | `/api/open/openapi.json`（契约，免鉴权） | `open-api-contract.controller.ts:10-16` |

它的受众是**写死的**：

- `Synapse/server/src/open-api/open-api-contract.ts:93`：「Synapse 面向**服务端、CLI 和自动化客户端**的开放接口。」
- `Synapse/document/open-api/index.md`：「API 密钥仅用于服务端、CLI 或自动化客户端。开放接口不提供浏览器跨域调用所需的 CORS。」
- `Synapse/docs/superpowers/specs/2026-08-22-open-api-share-link-download-design.md`：「本期不开放生产 CORS；长期 API key 只用于服务端、CLI 和自动化客户端。」

鉴权是 Bearer + API key：`syn_sk_` + 32 字节随机（`api-key-token.ts:3-5`），库里只存 SHA-256（`api-key.service.ts:71-74`），`OpenApiKeyGuard` 解析 `Authorization: Bearer`（`open-api-key.guard.ts:10-19,24`），scope 校验是**命令式**的逐点调用（`open-api.types.ts:38-42` 的 `requireOpenApiScope`），审计落在独立的固定列表 `OpenApiUsageLog`（`open-api-usage-log.service.ts:32,38,75,112`）。

契约是**手写 + Zod 单一来源**：`open-api-contract.ts` 导出的路径常量与 Zod schema 同时被运行时路由和契约文档复用，`module-boundaries.md:106` 明写「新增、弃用或修改开放接口时必须同批更新契约和契约回归测试，**不维护第二份静态 JSON**」。

**它能不能承载 Portal 的形态？**

能承载的是**机制**（Bearer / guard / scope / usage log / 契约同步纪律 / 无 CORS 的服务端定位）——Portal 的消费者正是同一类客户端。

不能承载的是**两件事**：

1. **逐能力登记**。`API_KEY_CAPABILITIES` 是 scope 词表，今天只有 1 条（§3）。1019 个页面塞进去，用户建密钥要勾 1019 个复选框，且每加一页都要发一版 SY。
2. **代理身份**。开放接口的 key **绑定了 `userId`**（`api-key.service.ts:33-37` 的 `OpenApiPrincipal`），所以调用天然"以该用户身份"发生——但这是**SaaS 自己的数据所有权**，不是**代第三方系统里的另一个自然人行事**。【读码】Synapse 全仓**没有** impersonation / delegated identity / "acting on behalf of" 概念：没有任何 header、参数或字段能让一个主体代表另一个主体。Portal 需要的恰恰是后者（会话 token 的持有者才是权限主体）。

### 2.2 结论：沿用机制，但一期主通道不在 `/api/open/v1`

**决定性的一条事实**：一期的调用方**不是外部 CLI，是 Synapse 自己的桌面客户端**（Agent Runtime 在桌面进程内跑，见 `docs/superpowers/specs/2026-08-25-agent-synapse-mcp-tool-router-design.md` §权限与投影）。而桌面客户端对 SY 服务端用的是**会话鉴权**，不是 API key：

【读码】`Synapse/server/src/auth/user-auth.guard.ts:25-50` 的 `UserAuthGuard` 接受 `Authorization: Bearer <access token>` 或 web-session cookie；`desktop/electron/services/account-service.ts` 就是拿这个会话调 `/drive/items`、`/console/webhooks` 等（`account-service.ts:465-554`）。

所以把一期逼到 `/api/open/v1` 上，等于**要求每个用户先去 Console 建一把 API 密钥**——凭空多一步，且与"开开关即用"的 A4 体验矛盾。

**设计：两套入口、一个服务、一份 schema**

```text
PortalModule（NestJS，新增）
├─ PortalSessionService     绑定 / 断开 / 会话缓存 / 可见性收敛
├─ PortalCatalogService     目录下钻转发（薄封装 SDK 的 catalog.*）
├─ PortalCapabilityService  能力调用（invoke）与 -llm（describe）
└─ 两个 Controller 复用它
   ├─ /api/console/portal/**   UserAuthGuard  ← 一期主通道（桌面端、手机端）
   └─ /api/open/v1/portal/**   OpenApiKeyGuard + scope=portal.invoke  ← 外部 CLI / 自动化
```

路由形状**固定 6 条**，与 1019 个页面解耦：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/portal/session` | 当前绑定的 Portal 身份（租户、连接状态、契约版本、可见性来源） |
| `POST` | `/portal/session/bindings` | 发起一次绑定，返回授权 URL + state |
| `DELETE` | `/portal/session` | 断开 |
| `POST` | `/portal/catalog` | 目录下钻，body 带 `{ op: 'domains'\|'pages'\|'page'\|'search'\|'recommend', ... }` |
| `POST` | `/portal/capabilities/{capabilityId}/describe` | `-llm`：怎么调 / 参数 / 返回 / 下一步去哪 |
| `POST` | `/portal/capabilities/{capabilityId}/invoke` | 真调 |

**为什么不给每个页面造一条路由**（A6 的 `{页面名}-list` 字面形态）：

- 【实测】目录有 **1,019** 个页面（`generated/page-catalog.json` 的 `total`），A6 的两层接口 × 页面数 = 上千端点，其中绝大多数今天还没有能力定义。
- D14 已经把 `-llm` 的语义定死为"**这个数据域怎么消费 + 下一步去哪**"，并且明说它与真实页面/路由**解耦**；D8 说目录是**服务端下发的动态数据**。两条合起来，逐页路由是把已经解耦的东西又绑回去。
- D2 选了"全部页面"，而覆盖是渐进的（roadmap：批量生成的能力**尚未接线**，且阻塞于"是否支持第二个前缀"与"auto 的能力必须抽样做基准"）。固定路由形状让"新增一个页面"是**数据变更**而不是**接口变更**——这是能让覆盖数从 7 涨到 1000 的唯一形状。

**为什么 `Plugin/Portal-Headless/` 不进路由**：

【实测】Portal 前端全仓搜不到 `Plugin/`（H18）；它的 URL 字面量前缀只有 `/admin-api`、`/adminmanage-api`、`/app-api` 三种。`Plugin/Portal-Headless/{页面名}-list` 与 `{页面名}-list-llm` 的形态是**AI 工具名 + 后缀**，不是一个 HTTP 命名空间。

**两者的正确分工**：

- **HTTP 路由**用 SY 既有风格：`/api/{console|open/v1}/portal/...`。生态兼容，能直接进 `open-api-contract.ts` 与 `document/open-api/`。
- **`-llm` 的语义保留，但换成工具名**：`describe().llmToolId`（`src/catalog/describe.ts:429` 的 `${id}-llm`）在 SY 侧映射成 `app_portal_capability_describe` 的一个入参，而**不是** 1019 个独立工具名。理由见 §4.3（Synapse MCP 的 `search` 每次最多回 5 个工具的完整 schema）。

**一期暂不做的事**：`/api/open/v1/portal/**` 同批注册、同批进契约、同批写契约回归测试（因为 `module-boundaries.md:106` 要求"同批"），但**不在文档里承诺对外可用**——它的可用性取决于【待决】第 5、6 条（限流与契约形态）。

---

## 3. 阶段④-2：能力登记位置

### 3.1 三个候选各自是什么

**候选甲：SY 的 `API_KEY_CAPABILITIES`**

【读码】`Synapse/server/src/api-keys/api-key-capabilities.ts:6-13` 全文只有**一条**：

```ts
export const PUBLIC_LINK_DOWNLOAD_SCOPE = "drive.public_link.download"
export const LEGACY_SHARE_LINK_DOWNLOAD_SCOPE = "drive.share_link.download"
export const API_KEY_CAPABILITIES = [
  { scope: PUBLIC_LINK_DOWNLOAD_SCOPE, name: "获取公共链接文件",
    description: "允许通过开放接口下载 Drive 分享、Drive Site 和公开素材。",
    documentationPath: "/open-api/api/share-link-download" },
] as const
```

形状是 `{ scope, name, description, documentationPath }`。消费方只有三处：API key 创建/更新时的 Zod 枚举 `z.enum(API_KEY_SCOPES)`（`api-key.controller.ts:7,12,20,45`）、契约的 `x-required-scope`（`open-api-contract.ts:2,54`）、下载授权的逐点判定 `hasPublicLinkDownloadScope`（`api-key-capabilities.ts:36-39`，唯一生产调用点在 `open-api-download-grant.service.ts:151`）。**它不由桌面端消费**，与 MCP 桥是两套机制。

→ 它是**scope 词表**，不是能力目录。把 1019 个页面写进去，等于把"这把密钥能调哪些接口"变成"这个用户能看哪些页面"，而后者是 Portal 侧 `permissions` 的职责（F18/F22/H9 已经明确是精确匹配的权限码，且 `/sys/menu/nav` 现成）。

**候选乙：Portal 的 `openApiRegistry`**

【实测 F6】它是**私人令牌的白名单**：`PersonalTokenApiImpl.authenticate` 展开 `scopeGroups` 后，还要拿"请求路径 + HTTP 方法"去 `system_open_api` 表查登记，未登记一律 401，与该用户的角色权限无关。

D1 已经选了会话 token，**恰恰因为**这张表与 D2「全部页面」物理不兼容（F6 的结论：「你选会话 token 是唯一能支撑"全部页面"的选择」）。用它登记 = 把 D2 退回分叉甲。

→ **排除。**

**候选丙：本包的生成物**

D18 已经把权威判给"完全借助 Portal 前端代码推导"；`generated/page-catalog.json` 是 1,019 行、`generated/openapi.json` 是它的能力面投影，两者都有漂移门禁（`tools/generate/drift-check.mjs`）。

→ **选它。**

### 3.2 结论与防脱节机制

**权威在 Portal 侧（本包）。SY 侧只登记一个 scope。**

```text
能力"是什么"     ── 权威：portal-headless 的 generated/* + src/capabilities/**（本包，有漂移门禁）
能力"能不能调"   ── 权威：Portal 自己的 /sys/menu/nav 可见面（运行时，按用户，见 §4.3）
密钥"能调什么"   ── 权威：SY 的 API_KEY_CAPABILITIES，只加一条 portal.invoke
```

**两点之间如何不脱节**（这是这个问题的第二问，必须能落地）：

1. **SY 服务端不复制目录。** `server` 直接依赖 `portal-headless` 包，装上 `createPortalServer()`，`PortalCatalogService` 只是转发 `catalog.*`。任何时刻**只有一份**目录；SY 侧不存在"需要跟着更新"的第二份。这一条同时消灭了 H8/H36 说的"两套数据源靠约定对齐"那类腐烂。
2. **漂移由包自己的门禁兜住，不新建机制。** `pnpm docs:drift` 按**内容哈希**比对生成物与 HEAD，并归一化掉 `generatedAt`（`conventions.md` 第 23 条：这个坑踩过两次）。pre-commit 钩子会自动跑。
3. **两边的接缝只有三处，且都已经被 Synapse 自己的规则强制"同批更新"**：

| 接缝 | 文件 | 被哪条规则强制 |
| --- | --- | --- |
| 新增 scope `portal.invoke` | `Synapse/server/src/api-keys/api-key-capabilities.ts` | `module-boundaries.md:106`（改开放接口必须同批改契约与回归测试） |
| 契约与回归测试 | `Synapse/server/src/open-api/open-api-contract.ts` + `open-api-contract.spec.ts` | 同上 |
| 能力表面表格与计数 | `Synapse/docs/agents/capability-registry.md` | `Synapse/CLAUDE.md`（改注册表面必须同批更新表格、数量、例外说明） |

4. **反向不会脱节**：scope 只在 SY 侧，本包不读它，也不该读（读了就产生依赖方向反转）。

**唯一真正会脱节的地方**：Portal 发版改了页面/接口，而本包没有重建。这条**不是登记位置问题**，是版本一致性问题，由 §4.4 处理。

> ⚠️ **顺带发现（只报告，未改）**：`Synapse/docs/agents/capability-registry.md` 的计数已经过期。文里写 `app` 域 78 能力 / 74 工具、合计 242 / 238（`:108`、`:117`），而代码侧不变式测试断言的是 247 / 83 / 79 / 243（`desktop/tests/unit/api-mcp-capability-surface.test.ts:114-117,129,130`）。`922ba21da`（Terminal 44→49）只改了 Terminal 行，没动 `app` 行与合计行。**这属于别的任务的改动面，本文不代改**——但阶段③ 落地时要改同一张表，届时一并修正最合适。

---

## 4. 阶段③：接入的完整形态

### 4.1 凭据怎么来（A4 落地）

#### 4.1.1 链路

```text
① 用户开开关（桌面客户端）
   Connectors / 新 System App 的「Portal 连接」
   → 桌面生成 state（一次性、绑 userId、5 分钟、存 DataRepository）
   → 打开浏览器：<Portal 网页 origin>/...?state=&callback=synapse://portal-headless/callback
                 &sdkContractVersion=<本包契约版本>&clientVersion=<客户端版本>

② Portal 授权页（Portal 侧新增一个路由）
   → 读自己部署产物的 build.json，与 sdkContractVersion 比对（A7）
   → 展示同意页：即将连接的 Portal 账号 + 租户 + 权限范围（H17/Q45）
   → 用户点确认 → 302 到 callback

③ 回调落在桌面
   synapse://portal-headless/callback?token=<会话 token>&tenant=<租户 id>&state=<state>
   → 走 SY 已有的 declared protocol route（H19）：
     desktop/electron/bootstrap/app-deep-link.ts 的 parseDeclaredAppDeepLink +
     manifest-registry 的 resolveDeclaredProtocolRoute(hostname) + paramsSchema 校验
     → dispatchAppAction(capabilityId, params)
   → 桌面校验 state（一次性 + 绑当前 userId + 未过期），失败即丢弃

④ 桌面把凭据交给 SY 服务端
   POST /api/console/portal/session/bindings（会话鉴权）
   { credential: { token, tenantId }, state }
   → 服务端校验 state 归属 → 建立会话（内存）→ 返回 { tenantId, contractVersion, visibility }

⑤ 桌面本地保存
   app.secrets.items（DataRepository，backend: encrypted-json）里存
   { portalToken, tenantId, portalWebUrl }，名字用 ^[A-Za-z0-9_]+$（secrets schema 约定）

⑥ 之后每次调用
   桌面从 secrets 取出 → 作为请求的一部分交给服务端 → 服务端只在内存会话里持有
```

**几个必须写死的点**：

- **state 是必须的**，且必须一次性 + 绑 userId + 短 TTL。依据 H17：A4 的临时密钥只防"别人拿我的连接器 URL 来访问"，**不防**"用户被诱导去连接一个别人的 Portal 账号"（回调把攻击者的 token 塞进无辜用户的客户端）。补法就是第 ② 步的同意页 + 第 ④ 步的 state 归属校验，两条缺一不可。
- **回调 host 必须新开**。H19 已核实 `synapse://auth/desktop/callback` 是按 hostname `auth` + pathname `/desktop/callback` **精确匹配**的（`desktop/electron/bootstrap/protocol-router.ts:44-58`），Portal 的回调不能挂在 `auth` 下面，要新增一条 declared protocol route（例如 hostname `portal-headless`）。
- **一期 URL 里带 token，不是一次性 code。** 依据：F7 已核实会话 token 本来就支持走 query 参数（`TokenAuthenticationFilter.java:169-174`），且产品里"token 出现在 URL"是既有先例（`shareLogin()` 生成的分享链接、移动端 `/simple/*?token=…&tenant=…` 入口、Flutter 端 `c=<token>`）。**但一次性 code 更安全**：回调 URL 会进系统日志、浏览器历史、崩溃报告，暴露面与页面内跳转不同（H19/Q50）。改成 code 需要 Portal 侧新增一个兑换端点 —— **这是 Portal 侧的改造项**，列进 H31 的工作清单，一期不做。**【待决】第 10 条。**
- **凭据不进会话键。** 【读码】`SessionStore.acquire` 在凭据身份变化时会**自动**把旧会话按 `credential-rotated` 丢弃（`src/session/store.ts:197-200`），所以"重新授权"不需要调用方额外做失效动作。设计里不要画蛇添足再加一层手动失效。

#### 4.1.2 token 存在哪

**桌面 `secrets`（`app.secrets.items` 命名空间）+ 服务端只在内存**。

依据：

1. **A1 明写"不依赖任何数据库存储"**。服务端持久化 Portal 凭据是这条红线的直接反面。
2. 【读码】桌面已有现成的凭据设施：`desktop/app-capabilities/secrets/`，6 个规范能力 id，DataRepository 命名空间 `app.secrets.items` / `app.secrets.settings`，两者在 `desktop/electron/runtime/data-repo/schemas/secrets.ts:20-31` 声明为 `backend: "encrypted-json"`（后端种类定义在 `runtime/data-repo/types.ts:10`，分派在 `factory.ts:57-61`）。**不需要自定义文件格式**（H14 的补充正是这条）。
3. 与 D17 的现状自洽：token 无法即时吊销，所以"把它长期放在服务端"的收益很小、暴露面很大。
4. 与 Q37/Q39 的建议一致：客户端存、服务端内存持有；服务端重启**不需要**用户重新授权（凭据在客户端，下一次调用会重建会话）。

**这条的代价要写清楚**：手机端与外部编辑器如果要在**没有桌面**的情况下调用 Portal 能力，服务端就没有凭据可用了。**这是【待决】第 3 条** —— 本文不单方面决定是否支持"无桌面的调用方"。可以确定的是：**如果支持，服务端就必须有一个持久化的凭据存储，那是对 A1 的修改，必须显式决策，不能顺手做。**

#### 4.1.3 过期与失效

- 过期（JWT 到期、token 不存在）：SDK 抛 `PortalCredentialError`（`src/http/errors.ts`），服务端转成一个可操作的结构化错误：「Portal 连接已失效，请重新连接」。**无头下没有登录页可跳**。
- 改密码**不会**撤销已签发 token；用户被停用后最坏仍可用到 JWT 过期（**7 天**，`HrJwtUtils.java:40-45`）。这是已接受现状（D17）。【读码】`docs/conventions.md:30-31` 已把它写成硬约束。
  → **UX 与文案必须诚实**：断开连接器是**单方面的**，不能承诺"断开后别人立刻用不了"。这句话要出现在连接器的界面说明与 Skill 指南里，不是只写在设计文档里。
- 恢复路径**只有一条**：让用户重走一次 ② ③ ④。所以 ①–④ 这条链要设计成可重复执行，且失败时给出具体原因（state 过期 / 版本不匹配 / 用户取消 / 后端拒绝），不能只有一句"连接失败"。

---

### 4.2 多用户会话在 SY 服务端怎么持有

#### 4.2.1 现状（核实过的）

| 事实 | 落点 |
| --- | --- |
| `createPortalServer` 是**进程内**的多用户门面：`SessionStore` + 服务级一份 `IdempotencyStore` | 【读码】`src/server.ts:101-172` |
| 会话键 `(userId, tenantId, language)`；TTL 绝对 30 分钟 + 空闲 30 分钟取先到；容量 **64**；LRU 淘汰 | 【读码】`src/session/store.ts:46,55,65,143-145` |
| 防重**不是幂等**：进程重启、多实例、TTL（默认 10 分钟）过后都不生效 | 【读码】`src/idempotency/README.md` 首表逐条列出 |
| SY 服务端**单实例**：`server/compose.yml` 只有一个 `server` 服务，无 `replicas`、无 `deploy:`；`deploy.sh:532,544` 是 `docker compose up -d --no-build`，无 `--scale`；`server/nginx.conf` 只有一个 `server { listen 3000; proxy_pass http://127.0.0.1:3001; }`，没有 `upstream` | 【读码】 |
| 既有进程内状态也按单实例设计（`live-desktop.gateway.ts:130,137`、`mobile-live.gateway.ts:56`、`drive-collaboration.gateway.ts:54` 都是 socket/presence Map） | 【读码】+【推断】 |

#### 4.2.2 结论

**一期用进程内会话，与当前部署形态一致，不引入共享缓存。** 但必须显式做三件事，否则会在真实用户量下静默劣化：

**（1）必须调大 `maxSessions`。** 默认 64 是库的默认值，不是产品值。超过 64 个活跃会话就按 LRU 淘汰——【实测 F4】淘汰一次意味着下一次调用要重新发**十几到二十几个**基础数据请求（4 步串行 + 10 并发 + `fetchUserInfo` 内部再拆 2 个）。定量：按「同时在线使用 AI 的用户数 × 平均租户数」估，并接 `SessionStoreEvent` 的 `onEvent`（`src/session/types.ts:150-157` 已定义 `expired` / `evicted` / `degraded` / `invalidated`）把这几类事件打进服务端日志。**没有这个日志，容量问题在线上不可观察。**

**（2）把"进程重启 = 防重窗口清零"写成运营事实。** 会话清零只是体验问题（凭据在客户端，下一次调用重建）；**防重清零是真风险**：AI 一次超时重试恰好跨过一次部署，就会重复写一张单据（`src/idempotency/README.md` 第 1、2 行）。

- **不要在 SDK 之外再造一层落盘去重**：README 已经论证过代价（状态文件、清理策略、并发写），收益只覆盖本进程存活期，且会引入一个"服务端能落盘的业务状态"——与 A1 冲突。
- 正确的收敛方向是 D12/Q112 已经定的：**推动 Portal 后端按 BPM 的 `client_request_id` 范式补真正的幂等（唯一索引，不能是"先查后插"）**。SDK 侧的键已经刻意做成同一套语言（`src/idempotency/README.md` 的对照表），不需要换概念。
- 过渡期的运营动作：**发版窗口内避免长事务型写链路**（这条要写进部署 checklist，不是代码）。

**（3）把"单实例"写成显式部署约束。** 一旦多实例（k8s 扩副本、蓝绿切换），三个假设同时失效：会话 ×N、防重窗口 ×N、**同一用户的两次调用可能落到不同实例**（第二次会话为空 → 重新走 F4 那十几次请求，且可见性视图不同步）。

- 【待决】第 4 条：是"把单实例写成硬约束"，还是"引入共享缓存"。注意 A1 的措辞是"不依赖任何数据库存储"，**Redis 算不算破例需要用户确认**（H16/Q44 问的就是这个）。
- 如果走共享缓存，落点是 `SessionStore` 的存储后端（现在是一个内存 `Map` + LRU），而不是 `createPortalServer` 的接口——接口已经足够抽象。

**（4）会话并发不用额外串行化。** H28/Q73 问"多个 Agent 会话同时用同一 Portal 用户要不要串行化"。结论：**一期不串行化**。依据：Portal 前端本来就是单标签页语义，浏览器并没有做跨标签页串行化；SDK 的服务端形态与"用户开两个标签页"等价。真正要防的是**并发写同一条记录**，那由 Portal 后端的业务校验兜（F16 的会议室时段冲突、F15 的审批人校验都是服务端强校验），不是 SDK 该做的。

---

### 4.3 能力怎么被 AI 看见

#### 4.3.1 Synapse 侧的约束（核实过的，直接决定形态）

| 事实 | 落点 |
| --- | --- |
| 公开工具面**恒为 2 个**：`search` + `invoke` | 【读码】`desktop/electron/services/agent-runtime/synapse-tool-router.ts:141-150,466-502`；`docs/agents/capability-registry.md:121` |
| 但**工具目录本身是全局的、模块加载时构建**：243 个工具全部进 catalog | 【读码】`synapse-tool-router.ts:279-307`（缺失即 throw），`registry.ts:76-88` |
| **没有按用户/账号的可见性**。身份只有固定的 transport actor：`{kind:"user", id:"mcp-client:synapse-mcp/http"}` | 【读码】`shared/types.ts:22-26`、`mcp-server.ts:38` |
| 有的只是**调用时**的 per-persona 拦截，`search` 结果里该工具仍然出现 | 【读码】`desktop/electron/services/agent-runtime/claude-sdk-session.ts:654-678,680-697,777-785` |
| 搜索硬上限：每次最多 **5** 个工具的完整 schema；索引模式上限 200、每行 150 字符；说明文本预算"远低于 2 KB 截断线" | 【读码】`synapse-tool-router.ts:121-136,180-182,401-408` |
| 新增一个 MCP domain 要改 **5 处硬编码**，且**没有** capability provider 的扩展点 | 【读码】`registry.ts:46,64,76`、`action-router.ts:29-48`；`bootstrap/extensions.ts:37-41` 只定义了 `content.types` / `editors` / `editor-scan.providers` 三个点 |

【实测】本包自己的载荷：`describe()` 单个能力 2,426–3,443 字节，四个能力合计 11.5 KB（完全放得进上下文）；`listDomains()` **17,776 字节**（比它要引出的 `describe()` 还重，G9）；原始 `catalog.index` **452,605 字节**。

#### 4.3.2 结论

**（1）绝不把 1019 个页面（或其 `-llm` 变体）注册成 MCP 工具。**

依据是三件事叠加：目录全局构建（不按用户） + 每次 `search` 只回 5 个完整 schema + 没有任何 per-user 可见性机制。硬塞的结果一定是「模型看得到用户没有的页面」和「用户有的页面模型搜不出来」同时发生。

**（2）新增一个 `portal` MCP domain，只放固定 7 个工具。**

工具面与 `tools/eval/model.mjs` 里**已经被真实模型跑过的那 7 个**逐一同构（`docs/eval-model-report.md` §2.2）：

| SDK 方法 | MCP 工具（示意，最终以 `naming.ts` 的 `app.<ns>.<sub>.<action>` 语法为准） |
| --- | --- |
| `catalog.listDomains()` | `app.portal.catalog.domains` |
| `catalog.listPages(domain)` | `app.portal.catalog.pages` |
| `catalog.describePage(pageId)` | `app.portal.catalog.page` |
| `catalog.search(keyword)` | `app.portal.catalog.search` |
| `catalog.recommend(text)` | `app.portal.catalog.recommend` |
| `catalog.describe(capabilityId)` | `app.portal.capability.describe` |
| `capabilities.invoke(id, args)` | `app.portal.capability.invoke` |

依据：这个面**已经被黑盒评测验证过**——真实模型能把它用起来（决策层是通的），并且那轮评测测出的三条缺口（G2 的长选项候选入口、G3 的 `next` 岔路、G5 的显式否定）已经修掉。换成别的形状等于丢掉那轮的结论重来。

> `-llm` 的语义落在 `app.portal.capability.describe` 的**入参**上，不再是一个工具名后缀。`describe().llmToolId`（`${id}-llm`）保留在返回值里做兼容与自解释，不作工具名用。

**（3）目录是数据，不是工具；下钻顺序照搬 SDK 已经验证过的分层。**

```text
listDomains({detail:false})   →  域（减重版，G9）
   └─ listPages(domain)       →  页面
        └─ describePage(page) →  该页面的能力
             └─ describe(id)  →  -llm：怎么调 / 参数契约 / 返回 / 下一步去哪
                  └─ invoke(id, args)
```

服务端转发时**默认走减重版** `{detail: false}`（G9 已实现），避免把 17.8 KB 的 `listDomains()` 直接灌给模型。

**（4）可见性收敛必须在服务端、在模型看到之前做。** 这是本节的**关键判断**。

【读码】`src/catalog/visibility.ts` 已经实现并测过：消费 `GET /admin-api/sys/menu/nav?project=` 的响应，按「目录 `permission` ↔ 菜单 `permissions`」连接（实测事实 1/2/3 写在文件头），归一化 `platform-v2 → platform`、去 query、去结尾 `/list`，输出一份 `VisibilityReport`（含 `counts` / `explain()` / `summary`）。**它尚未接线**（`docs/usage.md` 末尾明写）。

为什么必须先做：Synapse 的 MCP 目录全局且不按用户过滤（§4.3.1），所以**如果服务端不收敛，模型就会看到用户自己没有的页面**，撞上 conv #15 说的两种坏结果之一。收敛做在服务端，模型看到的就已经是该用户的子集。

三条纪律：

- **菜单树只是"下发面收敛"，不是权限裁决。** conv #15 的实测：某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，但该能力是可调的。**不能拿菜单树预判 403**，否则会把能用的能力藏起来。
- **`capability-only` 页面默认保留**（流程表单不在菜单树里是设计如此，D9），**iframe 叶子保留但标 `callable: false`**（D3 排除了外部系统）。这两个开关已经做进 `filterCatalog` 的 `FilterOptions`。
- **算不出 `module-type` 与可见性无关**（F19/D34），不要因为 `moduleType.resolvable === false` 就过滤掉页面——那是浏览器同样会发生的行为。

**（5）这条会改变 SDK 现在的一个形状，必须点出来。**

【读码】`src/server.ts:108` 建的 `catalog` 是**服务级共享一份**（`:78` 注释：「能力目录与检索；所有会话共用一份（它是静态的）」）。接上可见性之后，**目录不再对所有会话相同**：

- 静态的**索引**仍然可以共享（`buildIndex()` 的结果，一份）；
- **可见面**必须按会话算（用该会话的凭据拉 `/sys/menu/nav`，再跑 `filterCatalog`）。

落地形状：`createPortalServer` 保持共享索引，新增一个按会话提供"可见目录视图"的入口（或让 `forSession` 返回的 `SessionScopedPortal` 上带一个收敛过的 catalog 门面）。**这是阶段③ 唯一需要动 `src/` 的改动**，而且是行为变更（不是纯新增），必须在 `docs/usage.md` 与测试里同步。

**（6）Skill 是壳，目录是数据。** D8 的原话口径：Skill 从本机加载，能力目录从服务器下发、实时更新，"怎么向服务器渐进索要"写在本机 Skill 里。落点：

- `Synapse/desktop/app-capabilities/synapse-skill/skill-package/` 下新增 `portal/index.md` + `portal/api-reference.md`，内容只写**怎么向服务端渐进索要**（7 个工具的用法、`-llm` 的消费方式、长选项参数要先要关键字、写操作必带 `requestId`）。
  - 注意：该包有不变式测试要求路由文档**恰好 22 份**、且每份都带 "publishes only two tools" 的横幅（`desktop/tests/unit/api-mcp-capability-surface.test.ts:212-239`）。新增域会改这两个计数，**同批更新**。
- 目录的**内容**一个字都不进 Skill 包（否则就是 H36 说的"靠约定对齐的第二份数据源"）。

**（7）`call(pagePath, ...)` 绝不能出现在服务端接口上。** 见 §6 的风险条 3。

---

### 4.4 版本一致性（A7 落地）

#### 4.4.1 现状：A7 的硬约束今天**一条都没有落地**

【读码】核实的：

| 应有 | 实际 |
| --- | --- |
| SDK 版本与 Portal 网页版本严格相等 | 本包 `package.json` 是 `0.0.1`；生成物里**没有任何** Portal 版本锚点 |
| 记录构建依据 | `generated/page-catalog.json` 只记 `portalRepo`（**本机绝对路径**，如 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`）与 `generatedAt`（时间戳）——**路径不是版本锚点**，见 `docs/conventions.md` 第 32 条 |
| 契约版本 | `generated/openapi.json` 的 `info.version` 是硬编码 `'0.0.1'`（`tools/generate/openapi.mjs:156`） |
| 任何一处 git 版本 | 生成器里唯一的 `git rev-parse` 在 `tools/generate/report.mjs:110`，读的是**本包自己的 HEAD**，与 Portal 无关 |
| 连接时校验版本 | 不存在；`PortalHeadlessConfig`（`src/config.ts:14-32`）只有 `baseUrl` / `credential` / `userId` / `language` / `timeoutMs` / `moduleTypeFallback` |

Portal 侧**有**可机器比对的锚点：`dist/build.json` 是 `{unix, buildId}`，且 Portal 前端自己有 10 秒轮询的 build-version guard（H7）。【实测】

#### 4.4.2 结论：A7 的字面口径要改，改成"产品版本 + 契约版本"

A7 的三个问题（H7 已论证，此处只做落地设计）：

1. **"人工过滤纯 UI 变更"没有机器依据**，判断会漂。
2. **"严格相等"会断链**：Portal 每次发版到本包跟上之间有不可用窗口，而 Portal 发版不慢（当前分支号已到 `4.6.3.22`）。
3. **它把两件事混在一起**：产品版本（给人看）和**契约版本**（决定 SDK 能不能用）。改一个按钮颜色不该让连接器失效。

**落地设计**：

**（1）两个版本分开。**

| 版本 | 来源 | 谁看 | 变化频率 |
| --- | --- | --- | --- |
| 产品版本 | Portal 分支/发布号（如 `4.6.3.22`） | 人 | 每次发版 |
| **契约版本** | 本包生成物的**内容哈希**（归一化掉 `generatedAt`） | 机器 | 只有目录/能力/参数契约真变了才变 |

**（2）契约版本用"本包已有一套的机制"，不新造。**

`tools/generate/drift-check.mjs` 就是按内容哈希比对生成物、并且**专门归一化 `generatedAt`**（`conventions.md` 第 23 条：这个坑踩过两次——漂移门禁与别名推导器各一次）。把同一段逻辑产出一个 `contractVersion` 字段，写进 `generated/openapi.json` 的 `info.version` 与包导出。

**为什么不用 Portal 的 commit hash**：D23 说环境由 `baseUrl` 决定，dev/test/prod 各自部署不同版本（H37 实测仓库里有 **6 种构建模式、5 个后端域名**），构建时也拿不到生产环境的 commit。"内容哈希"回答的是"我这份契约长什么样"，与环境无关，正好是需要的语义。

**（3）运行时比对需要一个新参数 `portalWebUrl`，并且要定它在哪一侧。**

Portal 网页 origin（`webtest01.wodecorp.cn`）与 API origin（`biz-api-test.wodecorp.cn`）**不是同一个 host**（【实测】`docs/design.md` §1c 的测试环境地址一节），而 SDK 今天只知道 `baseUrl`（API）。所以版本探针要去**网页 origin**取 `build.json`。

两种实现，代价不同：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| 甲：运行期比对 | 新增配置 `portalWebUrl`，运行时 `GET <portalWebUrl>/build.json` 拿 `buildId`，与构建时烘入的基准 `buildId` 比 | 破 D23 的"SDK 无环境概念"一条（但和 `baseUrl` 一样是调用方传的，性质相同）；多一次网络请求，要缓存与超时处理 |
| 乙：构建期烘入 | 生成器在构建时读一次目标环境的 `build.json`，把 `buildId` 烘进产物，运行时只比 SDK 侧记录 | 生成器现在是**零依赖纯 Node、只读本地仓库**（conventions #20），构建期联网是对它的性质修改；而且"构建时读的是哪套环境的 build.json"又变成一个新的配置 |

→ **【待决】第 6、7 条。** 本文不单方面定。

**（4）不匹配时的表现：降级只读 + 明确告知。**

- 落点：`describe()` 的 `warnings: string[]` 里加一条。目录已有"warnings 永远存在、没问题时是空数组"的约定（`docs/usage.md` §2 的 G11），**不需要新造字段**。
- **写能力在 `invoke` 时拒绝**（`write: true` 的能力直接返回结构化错误），读能力照常。
  依据：契约不匹配意味着"这次写可能带着错的字段或错的业务规则"，而 D4 下写操作**没有人工闸门**（不设回执、不分级），读还能靠用户自己看数据、写没有回头路（H23：Portal 全仓没有通用软删除/恢复）。
- **这是对 A7 字面含义的修改（严格相等 → 不匹配降级），【待决】第 1 条。**

**（5）多环境。** H37/Q126 问支持哪几个环境，本文的建议不变（只 test + prod；dev 可能跑未发布代码，用它做基准会得出错误契约）。定下来的表现是：**版本校验的目标环境由调用方传的 `portalWebUrl` 决定**，SDK 自己不维护"支持哪几个环境"的清单——与 D23 一致。

---

## 5. 与 Synapse 硬约束的冲突点与处理

> 先说一条容易误判的事实：`Synapse/desktop/scripts/checks/check-hard-constraints.mjs` **只走 `desktop/` 的目录**（roots 是 `electron`、`electron/runtime`、`electron/bootstrap`、`src/runtime`），**完全不检查 `server/`**。而且它只查 6 条规则，**不检查** `DataRepository` / `PermissionGuard` / `AuditSink` / `ExtensionPoint`（这四者在脚本里零命中，只是文档约定与运行时接口）。所以下面按"会被 CI 拦住"和"只会被评审拦住"分开列。

### 5.1 会被 `check-hard-constraints` 拦住的

| 冲突 | 规则原文 | 本设计的处理 |
| --- | --- | --- |
| 连接器开关 / 绑定状态的 IPC | 「只有 `runtime/ipc/` 可以裸用 `ipcMain.handle/on`」，roots `electron` + `src/runtime`，只允许 `electron/ipc/validated-ipc.ts` | 新增的 Portal IPC **一律走既有的 IPC 注册面**（与其它 capability package 的 `main/` 里注册 IPC 的方式一致），service 里不出现 `ipcMain`。【读码】`desktop/electron/ipc/validated-ipc.ts` 是唯一的白名单文件 |
| 新的 Portal 服务单例 | 「新代码不得在 `runtime/` 或 `bootstrap/` 导出服务单例；通过 `ServiceRegistry` 组装」 | 新服务按 descriptor 组装（参照 `coreSecretsDescriptor` 的形式，`desktop/electron/bootstrap/descriptors.ts:657-677`） |
| 回调处理里的异常 | 「禁止空 `catch {}`」（roots 含 `electron/bootstrap`，而协议路由就在 `bootstrap/`） | 回调的每一条失败路径（state 过期 / state 不属于本用户 / 参数校验失败 / 兑换失败）都要显式处理并结构化记录 |
| 出网 | 「只有 `runtime/network/` 可以绑定端口」——这是**绑定端口**，不是发起出网请求 | 出网请求不受这条限制（既有的 `account-service.ts`、`update-service.ts:240` 都在 main 里直接 `fetch`）。**但**如果为了接收 Portal 回调而起一个本地 HTTP 端口，就撞上这条——所以回调**必须**走 `synapse://` 协议路由，不起端口 |
| 业务状态落盘 | 「业务数据不得裸用 `fs.writeFile`，走 `DataRepository`」（roots 含 `electron/bootstrap`、`src/runtime`） | Portal 连接状态（enabled / tenantId / lastProbe / contractVersion）与凭据都走 DataRepository。**注意：这条脚本不查**，靠评审——但脚本查 `fs.writeFile`，所以在 `bootstrap/` 里手写文件一定会红 |

### 5.2 只会被评审拦住的（Synapse 文档规则）

| 冲突 | 规则出处 | 处理 |
| --- | --- | --- |
| **敏感操作必须过 `PermissionGuard` + `AuditSink`** | Synapse `CLAUDE.md` Phase 0 第 10 条；实现是 `desktop/electron/runtime/security/permission-guard.ts:91,230`，接缝是 `desktop/electron/capabilities/permission-audit.ts` | Portal 凭据的读/写、对 Portal 的出网调用、以及"发起连接"这个动作，**全部**要过。现成范式：connectors 的 driver 注册时就注入了 `{permissionGuard, auditSink}`（`desktop/electron/bootstrap/descriptors.ts:640-652`） |
| **新增硬编码枚举需要明确批准** | Synapse `CLAUDE.md` Phase 0 第 11 条 | 新增一个 MCP domain 要改 5 处硬编码（§4.3.1），而且 `ExtensionPoint` **没有** capability provider 这个点。【读码】`bootstrap/extensions.ts:37-41` 只定义了 3 个点 → **需要明确批准，且要发桌面端版本** |
| **改注册表面必须同步 `docs/agents/capability-registry.md`** | Synapse 根 `CLAUDE.md`；该文档 `:140-145` 的同步硬规则 | 新增 `portal` domain / System App 要改表格、计数、例外说明与默认 Dock 顺序。**顺带修正该文档已过期的 `app` 行与合计行**（§3.2 的发现） |
| **连接器 V1 的四条非目标** | `Synapse/docs/superpowers/specs/2026-09-03-builtin-mcp-skill-connectors-design.md`：「本阶段不建设云端 Connector Catalog，也不支持 OAuth、Token、多账号、多环境、远程 MCP」；「新增或修改连接器仍需发布 Synapse 客户端」；endpoint 只接受 `http://127.0.0.1:<port>/<path>` | **Portal Headless 四条全踩。** 而且方向相反：Connectors 是"Synapse 去消费别人的 MCP"（`connectors/main/driver-registry.ts` 的 `ConnectorDriver = { probe, createAgentContribution }`），Portal Headless 是"Synapse 把 Portal 能力提供给自己的模型"。【读码】`connectors/main/types.ts:4-8` 的 `McpStreamableHttpIntegration` 只有 `kind: "mcp-streamable-http"` 一种，且 `bootstrap/descriptors.ts:640-652` 只注册了一个 driver。→ **不该塞进 Connectors 概念**，应是「一个新的 MCP domain + 一个新的 System App」。【待决】第 2 条（H15/Q40/Q41 原本就是问这个） |
| **开放接口的契约同步** | `Synapse/docs/agents/module-boundaries.md:106`：「必须同批更新契约和契约回归测试，**不维护第二份静态 JSON**」；`:102` 的 scope 声明 | 前两条照做（新增 scope + 契约 + spec 同批）。**第三条冲突**：Portal 的逐能力契约有 1,019 条、只能由生成物提供（`generated/openapi.json`），不可能手写进 `open-api-contract.ts`。→ 设计成**第二个契约文档**：`/api/open/portal/openapi.json`（生成物），与手写的 `/api/open/openapi.json`（少数固定 operation）覆盖面**不相交**。这是对那条规则的**显式例外**，必须写进 `module-boundaries.md`。【待决】第 5 条 |
| **开放接口不做限流** | `module-boundaries.md:106`：「POST/GET 显式跳过全局 Throttler，不增加密钥、IP、次数或频率限制」；`open-api.controller.ts:27` 的 `@SkipThrottle()` | **冲突**。【实测 F4】SDK 一次会话要发十几到二十几个基础数据请求；【实测 F25】Portal 侧也没有业务接口的全局限流。→ 必须给 `portal.*` 单独加一层限流（这是对既有"不加限制"口径的**例外**，要拍板）。【待决】第 5 条 |

### 5.3 服务端侧不受桌面端硬约束影响的部分

- `server/` 是 NestJS，**不跑** `check:hard-constraints`。Portal 的服务端模块按 NestJS 既有结构组织即可（参照 `meeting.module.ts` 的形态）。
- 但**「进程内状态」这件事在服务端有等价物**：`server/src/live/`、`mobile-live/`、`drive/drive-collaboration.gateway.ts` 都是进程内 Map，它们与 §4.2 的单实例结论是同一个假设，**没有新的风险面**。
- 平台级第三方凭据的现成范式是**服务端 env**：`server/src/meeting/meeting.config.ts:5-13` 的注释写明"腾讯云的密钥是**平台级**的，只在服务端"。**Portal 的凭据不是这一类**（它是用户级的），不要照抄这个范式，否则会把用户凭据降级成平台密钥的管控口径。

---

## 6. 不可逆处与风险清单

按"出事后能不能挽回"排序。

**1. 凭据不可吊销（D17），且断开是单方面的。**
改密码不撤销已签发 token；被停用最坏仍可用到 JWT 过期（7 天）；登出对 JWT 持有者是空操作。**没有任何机制能让一份泄漏的会话 token 立刻失效。**
→ 处理：① UX 与文案如实说明，不承诺"断开即刻生效"；② token 只放桌面 secrets（encrypted-json）与服务端内存；③ 一旦发现泄漏，唯一的止血是**让用户在 Portal 侧改密码**——但那也不撤销已签发 token，所以实际止血手段是**停用账号并等 JWT 过期**。【读码 F21】这条要在上线前的运维文档里写清楚，因为它违反直觉。

**2. 写操作全部放开（D4）+ Portal 没有回收站（H23）+ Portal 侧不留痕（H12）。**
【实测】写请求调用点约 1,900，去重后 **1,374** 条写接口路径，覆盖工资实发、社保公积金、凭证生成、年度结转、坏账核销、期初过账、权限与租户变更；`Modal.confirm` 165 处、`a-popconfirm` 50 处——**这些都是浏览器里的闸门，无头下全部不存在**。
→ 处理（一期能做的）：
  - **服务端对每一次 Portal 写调用记一条审计**，用现成的 `Synapse/server/src/common/audit-log.service.ts:102`（`record()` / `recordWithClient()`），字段 = 发起人 SY userId + capabilityId + 目标 + **载荷指纹**。
  - **审计与用量日志禁止记录正文**——照抄 `OpenApiUsageLog` 的既有纪律（`module-boundaries.md:106`：禁止 URL、密码、token、文件名、路径、storage key、manifest、文件内容）。
  - **这条账是 SY 自己的账**：Portal 侧仍然无法回答"这条是谁做的"。H12/Q31 提议加来源标识头，但【读码 F12/§10】Portal 的 `web-operation-log` 只在**错误路径**写入，所以加头也换不来 Portal 侧的审计——**这条要如实说明，不要承诺**。

**3. `module-type` 的放大效应：开放接口不能暴露 `call()`。**
【实测 F19】不传/传错 `module-type`，后端取该用户**全部模块数据权限的并集**——**这是放大，不是缩小**。而 `call(pagePath, ...)` 让调用方自己挑页面上下文（`docs/usage.md` §8）。
→ 处理：**服务端接口只暴露 `capabilities.invoke(id, args)`，其中 `id` 必须在服务端注册表里，页面上下文由能力定义携带。** 绝不接受调用方传 `pagePath` 或原始 URL。这条是安全边界，不是 API 设计偏好。

**4. 无限流 + 全权限凭据 + 十几次基础数据请求。**
见 §5.2 的最后一行。【实测 F25】Portal 侧业务接口没有全局限流；【实测 F4】一次会话初始化就是 4 步串行 + 10 并发。
→ 处理：给 `portal.*` 加每用户 QPS 限流 + 会话初始化本身要有单飞保护（SDK 已有两层单飞：会话级 + 能力级，`src/session/single-flight.ts`）。

**5. Portal 能力目录是"渐进覆盖"的，而 `invoke` 是通用入口。**
今天只有 7 个能力（会议室列表、会议室占用、会议室预定表单的 prepare/submit/cancel、人员搜索、流程定义）。D2 的目标是 1,019 个页面。
→ 处理：**一期只暴露已做过四件套的能力**，`invoke` 对未实现的 `capabilityId` 返回"目录里有但尚未接线"（SDK 已有这个语义：`CapabilityInvokeError` 会列出真正能调的能力，`describe().invoke` 为 `null` 就是"调不到"）。依据：roadmap 里"把批量生成的能力接线进 SDK"是 todo，且带两个明确阻塞（16 页打到 `VITE_SHOP_ADMIN_API` 要不要支持第二个前缀；auto 的能力必须抽样做浏览器基准，因为**静态推导一定会错**）。**更充分的界划是：`invoke` 只接受 `describe().invoke !== null` 的能力**，这条能自动跟随覆盖进度。【待决】第 9 条。

**6. 目录的可见性收敛依赖一个尚未接线的模块。**
`src/catalog/visibility.ts` 已实现、已测、未接线（`docs/usage.md` 末尾）。**接线是阶段③ 的前置条件**，否则模型看到的是全量 1,019 行。
→ 处理：把接线列为阶段③ 的第一个动作；它同时也是唯一需要动 `src/` 的改动（§4.3.2 第 5 点）。

**7. 数据边界（D7 已接受，但仍然要复述）。**
【实测】Portal 里装着薪酬、绩效、财务凭证、合同、身份证；D7 选了"不做限制，全部可读"。这些数据会进对话历史、手机端实时中继、以及第三方模型。
→ 一期不再讨论边界，但**上线前必须有人签字**（H24/Q61-63 的实质是合规确认，不是技术问题）。

**8. 跨团队事项只有一条是硬阻塞。**
【实测】唯一**必须 Portal 后端改造**的是短信闸门（F20：后端目前**根本不校验**短信码，`templateId` 参数被接收但从未使用）。D16 已决定"SDK 复刻浏览器逻辑"，定位是**用户知情同意闸门**而不是安全边界——这个定位是诚实的，但**不能对外宣传成安全机制**。
另外需要 Portal 侧配合的：① 授权回调路由（新增）；② 可机器比对的版本标识（`build.json` 现成，要在授权页读）；③ 可能的风控白名单（F25 实测目前没有 IP 白名单/WAF/`limit_req`，所以不是阻塞）。这三条归 H31，需要确认排期与验收人。

---

## 7. 需要用户拍板的决定

每条都说明"为什么文档不能单方面定"。

| # | 决定 | 为什么必须你定 |
| --- | --- | --- |
| 1 | **A7 的口径改写**：严格相等 → 「产品版本 + 契约版本」两分，不匹配时**降级只读**（写能力拒绝、读能力保留、`warnings` 告知） | 这是对已记录决策 A7 的字面推翻。H7 已经论证原口径三个问题，但"不匹配时降级而不是拒绝"是一个**产品取舍**（降级意味着用户在版本错配期仍能用 AI 读薪酬数据），不是工程判断 |
| 2 | **连接器概念是否为 Portal Headless 重开四条非目标**（云端 Catalog / OAuth·Token / 多账号 / 远程 MCP） | 我在 §5.2 给了依据（Connectors 是"消费别人的 MCP"，方向相反）与建议（不塞进 Connectors，另起 MCP domain + System App），但 H15 的四个问题是产品边界问题；而且**四条的答案不必须一致**（例如可以只开"多账号"而不开"云端 Catalog"） |
| 3 | **Portal 凭据能不能落在 SY 服务端**（= 要不要支持"没有桌面的调用方"，如手机端、外部编辑器） | 这是 A1（"不依赖任何数据库存储"）的红线判定。技术上都做得到，但你才能决定"让服务端持有全权限的 Portal 凭据"这件事的门槛。**注：本文已确认一期的实际调用方是桌面客户端，所以一期不需要它**；这条决定的是二期形态 |
| 4 | **单实例锁死 vs 引入共享缓存**；若引入，**Redis 算不算 A1 说的"数据库"** | H16/Q43-44 原始问题。§4.2 已证明**当前部署是单实例**，所以这不是一期阻塞；定的是"扩副本时怎么办"的预案与红线 |
| 5 | **两条对既有规则的例外**：① Portal 的目录契约走生成物（`/api/open/portal/openapi.json`，第二份契约文档）；② `portal.*` 要单独加限流（与开放接口"不加限制"的既有口径相反） | 两条都是 `module-boundaries.md` 里写死的规则，破例必须显式，不能由设计文档默默绕过 |
| 6 | **版本探针的实现**：生成期联网烘入 `buildId`，还是运行期 `GET build.json` 比对 | 生成器现在是**零依赖、只读本地仓库**的纯 Node 脚本（conventions #20）；联网是对它性质的修改。两条路的代价在 §4.4.2 的表里 |
| 7 | **`portalWebUrl` 这个新配置放在哪一侧**（SDK 参数 / SY 服务端配置） | 它决定 D23 的"SDK 无环境概念"要不要破例。放在 SDK 与 `baseUrl` 性质相同；放在 SY 侧则 SDK 完全不知道环境 |
| 8 | **"API key 的主人 ≠ Portal token 的主人"是否允许** | 企业里最常见的诉求是"助理帮领导订会议室"（H27/Q70-72）。在开放接口这条通道上，这表现为一把密钥配上另一个人的 Portal token。**技术上完全可行，产品上是一个新的授权模型**，只有你能定 |
| 9 | **一期开放的能力面** | 我的建议是"只开放 `describe().invoke !== null` 的能力"（今天 7 个），理由是批量生成的 255 页里只有 136 完全自动、且"静态推导一定会错，必须抽样做浏览器基准"（roadmap 的阻塞）。但"一期给用户多少能力"是范围决策 |
| 10 | **一期的回调用 URL 带 token 还是改成一次性 code** | 前者 Portal 侧零改动（有先例），后者更安全但需要 Portal 新增兑换端点。H19/Q50 原始问题，代价在 §4.1.1 |

---

## 8. 实施顺序（可直接派单）

按"能不能独立验证"与"是否阻塞别人"排，不按重要性排。

| 序 | 动作 | 归属 | 前置 | 可验证方式 |
| --- | --- | --- | --- | --- |
| 1 | 接线 `src/catalog/visibility.ts`：`createPortalServer` 支持按会话的可见目录视图（静态索引共享、可见面按会话算） | 本包 `src/**` | 无 | 单测（可见面随 `menu-tree` 变化）+ 反证（去掉过滤即变红）+ `docs/usage.md` 同步 |
| 2 | 产出 `contractVersion`（生成物内容哈希，归一化 `generatedAt`）并写进 `openapi.json` 的 `info.version` 与包导出 | 本包 `tools/generate/**`、`src/index.ts` | 无 | 漂移门禁不红；改一个能力定义后 `contractVersion` 必须变 |
| 3 | 服务端 `PortalModule`：`PortalSessionService` / `PortalCatalogService` / `PortalCapabilityService`，先只挂 `/api/console/portal/**` | Synapse `server/src/portal/**` | 1、2 | NestJS 单测 + `open-api-contract.spec.ts` 模式 |
| 4 | `portal.invoke` scope + `/api/open/v1/portal/**` + 契约 + 契约回归测试（**同批**） | Synapse `server/src/api-keys/**`、`server/src/open-api/**` | 3 | `module-boundaries.md:106` 要求的"同批"；契约 lint |
| 5 | 桌面端连接器/System App：开关、state 生成、授权 URL、declared protocol route 回调、凭据写 `app.secrets.items`、状态写 DataRepository | Synapse `desktop/app-capabilities/<新包>/**`、`desktop/electron/bootstrap/**` | 4 | `check:hard-constraints`、`check:ipc-codegen`、capability surface 不变式测试 |
| 6 | Portal 侧的授权回调路由 + 同意页（展示账号/租户/范围） | Portal 仓库（跨团队） | —— | 跨团队验收，**这是最长的一条链，应最早启动** |
| 7 | `portal` MCP domain 的 7 个工具 + Skill 包 `portal/index.md`、`api-reference.md` | Synapse `desktop/synapse-capabilities/**`、`desktop/app-capabilities/synapse-skill/skill-package/**` | 5 | `api-mcp-capability-surface.test.ts`（含 22 份路由文档的计数）、`docs/agents/capability-registry.md` 同批更新 |
| 8 | 限流 + 审计接线（每次 Portal 写调用一条 `AuditLogService` 记录，不含正文） | Synapse `server/src/portal/**`、`server/src/common/audit-log.service.ts` | 3 | 审计行的字段白名单测试 |
| 9 | 端到端验收：一个真实用户在真实环境，从开开关到"帮我订个会议室"跑通 | 全部 | 1–8 | 沿用 D20 的判据（与浏览器逐字段一致）+ 写链路的独立证实（占用查询里真出现那条记录） |

**第 1、2 项完全在本包内、不依赖 Synapse、也不依赖跨团队**，可以立刻派。

---

## 9. 取证清单：哪些是核实过的、哪些是推断

### 9.1 直接读码核实的（Synapse 侧）

- `/api/open/v1` 的真实形状、只有 1 个能力、路径常量与控制器：`server/src/open-api/open-api-contract.ts:4-14`、`open-api.controller.ts:20,25`、`open-api-download.controller.ts:20,29`、`open-api-contract.controller.ts:10-16`。受众声明：`open-api-contract.ts:93`、`document/open-api/index.md`。
- API key 的形状、存储、校验、scope 判定、无 impersonation：`api-key-token.ts:3-5,13-19`、`api-key.service.ts:33-37,71-74,89,184-202`、`open-api-key.guard.ts:10-19,24`、`open-api.types.ts:38-42`。
- `API_KEY_CAPABILITIES` 只有 1 条、形状、消费方：`api-key-capabilities.ts:6-13,17,19-34,36-39`、`api-key.controller.ts:7,12,20,45`、`open-api-contract.ts:2,54`、`open-api-download-grant.service.ts:151`。
- 会话鉴权的存在与范围：`auth/user-auth.guard.ts:25-50`；桌面端的会话调用：`desktop/electron/services/account-service.ts:465-554`。
- 单实例部署：`server/compose.yml`、`server/nginx.conf`、`deploy.sh:532,544`；进程内状态：`live/live-desktop.gateway.ts:130,137`、`mobile-live/mobile-live.gateway.ts:56`、`drive/drive-collaboration.gateway.ts:54`。
- 审计设施：`server/src/common/audit-log.service.ts:102,114,149`；用量日志的固定列纪律：`server/src/open-api/open-api-usage-log.service.ts:32,38,75,112`、`docs/agents/module-boundaries.md:106`。
- 开放接口的契约同步硬规则：`docs/agents/module-boundaries.md:98-106`。
- MCP 表面：公开工具恒为 2（`synapse-tool-router.ts:141-150,466-502`）；目录全局且模块加载时构建（`:279-307`）；无 per-user 可见性、只有 persona 的调用时拦截（`claude-sdk-session.ts:654-678,680-697,777-785`）；搜索上限（`synapse-tool-router.ts:121-136,180-182,401-408`）；HTTP 体 1 MB（`database/mcp-server.ts:20`）。
- 新增 MCP domain 的 5 处硬编码与扩展点现状：`synapse-capabilities/shared/registry.ts:46,64,76-88`、`electron/capabilities/action-router.ts:29-48`、`runtime/extension/registry.ts:11-21`、`bootstrap/extensions.ts:37-41`。
- Connectors 的方向与 V1 边界：`docs/superpowers/specs/2026-09-03-builtin-mcp-skill-connectors-design.md`、`desktop/app-capabilities/connectors/main/driver-registry.ts`、`connectors/main/types.ts:4-8,48`、`bootstrap/descriptors.ts:640-652`。
- secrets 设施：`desktop/app-capabilities/secrets/shared/capability.ts`、`shared/schema.ts`、`runtime/data-repo/schemas/secrets.ts:20-31`、`runtime/data-repo/types.ts:10`、`factory.ts:57-61`。
- 硬约束脚本的精确规则与作用域：`desktop/scripts/checks/check-hard-constraints.mjs:22-67`（6 条，roots 只含 `desktop/`；**不查** DataRepository / PermissionGuard / AuditSink / ExtensionPoint）。
- 协议路由与回调落点：`desktop/electron/bootstrap/protocol-router.ts:44-58`、`bootstrap/app-deep-link.ts`、`electron/generated/deployment-config.generated.ts:7`。
- 远程调用型能力的现成范式：`desktop/app-capabilities/account/main/dispatcher.ts`、`bootstrap/descriptors.ts:679-691` 的 `fetchAuthenticated` 注入缝。
- Skill 包结构与不变式测试：`desktop/app-capabilities/synapse-skill/skill-package/`（12 个域目录 + `SKILL.md`，25 个 md，351,460 字节）、`desktop/tests/unit/api-mcp-capability-surface.test.ts:114-117,129-130,148-155,157-188,212-239`。
- **能力登记表已过期**：`docs/agents/capability-registry.md:108,117` 写 78/74 与 242/238，测试断言 83/79 与 247/243；`922ba21da` 只改了 Terminal 行。

### 9.2 直接读码核实的（本包侧）

- `createPortalServer` 的形态与"目录服务级共享一份"：`src/server.ts:78,108`。
- 会话默认值与凭据轮换的自动失效：`src/session/store.ts:46,55,65,143-145,197-200`。
- 防重的边界：`src/idempotency/README.md`（首表 6 行做不到什么）。
- 目录的载荷：`generated/page-catalog.json`（`total: 1019`，元数据只有 `generatedAt` + `portalRepo`）、`generated/openapi.json`（`info.version: '0.0.1'`、路径是占位的 `/portal-headless/{id}`）、`docs/eval-report.md` §6。
- **无 Portal 版本锚点**：`tools/generate/generate.mjs:290,298`（只写路径）、`tools/generate/openapi.mjs:156`（硬编码版本）、`tools/generate/report.mjs:110`（`git rev-parse` 读的是本包 HEAD）、`package.json` `version: "0.0.1"`。
- `call()` 是公开导出：`src/index.ts:40`；能力调用绑定与"调不到"的语义：`src/capabilities/invoke.ts`、`docs/usage.md` §2.1。
- 可见性模块已实现未接线：`src/catalog/visibility.ts`、`docs/usage.md` 末节。

### 9.3 来自既有实测数据（不是这次读的）

- F4（会话 = 十几到二十几个基础数据请求）、F18/F19（`module-type` 只影响数据范围、不传会放大）、F21（凭据不可即时吊销）、F25（Portal 无全局限流）、F26（租户必须显式传）、conv #15（菜单树不是权限裁决）——出处见 `docs/design.md` §2b 与 `docs/conventions.md`。
- `describe()` 2,426–3,443 字节、`listDomains()` 17,776 字节、`index` 452,605 字节——`docs/eval-report.md` §6。
- 真实模型能用起 7 工具面、以及那轮的三条协议缺口——`docs/eval-model-report.md` §0/§2.2。

### 9.4 推断（需确认）

- 既有进程内的 WebSocket/presence Map 意味着"单实例"是一个**部署约束**而不只是当前状态。依据是 compose/nginx/deploy 的静态证据 + 这类 Map 的语义，我没有跑过任何部署。
- 会话容量 64 在真实用户量下会成为问题：这是由"默认值 64"与"公司规模"推出的，**没有实测**（本包没有任何压测数据）。
- 把 Portal 的能力做成"独立 MCP domain + System App"而不是塞进 Connectors，是基于 Connectors 的方向（消费别人的 MCP）与 Portal Headless 的方向（提供自己的能力）相反推出的；H15 的原始问题没有给出答案。
- 桌面端用会话鉴权而不是 API key 调服务端：`account-service.ts` 的证据是"桌面确实用会话"；"Portal 的调用必须也走会话"是**我的设计决定**，不是读出来的事实。

### 9.5 明确没查的（本文不作断言）

- **手机端（SynapseMobile）如何调用 SY 服务端**：没有读它的网络层，所以"手机端能不能用 Portal 能力、凭据从哪来"我没有结论，只把它列进【待决】第 3 条。
- **Synapse 服务端有没有灰度/开关设施**（H32/Q85-87 的"一键关闭 AI 的写能力"）：没有查。
- **Portal 侧的授权回调路由要新增在哪个模块**：属于 Portal 仓库，本文只给了它必须满足的契约（读 `build.json` 比对、展示同意页、回跳带 state）。
- **`/api/open/v1/portal` 的限流具体参数**（QPS 值、按用户还是按密钥）：需要与 Portal 侧的承载能力一起定（Q64/Q66 要问后端）。

---

## 10. 可直接回填 `docs/roadmap.json` 的条目

阶段④ 的两项（原文照抄的是问题，下面是结论）：

```json
[
{
  "项": "路由与鉴权风格（沿用 /api/open/v1 + Bearer + scope，还是另起）",
  "status": "done",
  "evidence": "docs/sy-integration-design.md §2：沿用 open API 的机制（Bearer syn_sk_ + OpenApiKeyGuard + scope + OpenApiUsageLog + 契约同批更新），Portal 挂在 /api/open/v1/portal/**；但一期主通道走 /api/console/portal/**（UserAuthGuard 会话鉴权），因为一期调用方是 Synapse 自己的客户端（desktop/electron/services/account-service.ts 用会话调 /drive/items 等），把用户逼去 Console 建 API 密钥与 A4 的\"开开关即用\"矛盾。路由形状固定 6 条，与 1019 页解耦。不新起 Plugin/Portal-Headless/——Portal 前端全仓没有 Plugin/（H18），那是 AI 工具名的风格不是路由风格"
},
{
  "项": "能力登记位置（复用 SY 的 API_KEY_CAPABILITIES，还是 Portal 侧的 openApiRegistry）",
  "status": "done",
  "evidence": "docs/sy-integration-design.md §3：权威在 Portal 侧（本包的生成物 + 能力定义，有 pnpm docs:drift 内容哈希门禁）。SY 的 API_KEY_CAPABILITIES 只新增一个 scope（portal.invoke），不逐条登记 1019 个页面——它是 scope 词表（今天只有 1 条 drive.public_link.download，server/src/api-keys/api-key-capabilities.ts:6-13），不是能力目录。排除 openApiRegistry（F6：私人令牌白名单，与 D2 物理不兼容）。防脱节：SY 服务端不复制目录（运行时读包），接缝只有三处且都已被 Synapse 自己的规则强制同批更新"
}
]
```

阶段③ 的 `环节` 数组（原文是空数组，建议填入）：

```json
{ "环节": [
  { "项": "目录可见性接线（模型只能看到用户可见的面）", "status": "todo",
    "evidence": null, "阻塞": "src/catalog/visibility.ts 已实现已测未接线；Synapse 的 MCP 目录是全局构建、不按用户过滤，所以这一步是阶段③ 的前置条件。同时它是唯一需要动 src/ 的改动（catalog 不再对所有会话相同）" },
  { "项": "契约版本（生成物内容哈希）", "status": "todo",
    "evidence": null, "阻塞": "包里现在没有任何 Portal 版本锚点：page-catalog.json 只记本机路径与时间戳，openapi.json 的 info.version 硬编码 0.0.1，生成器里的 git rev-parse 读的是本包 HEAD" },
  { "项": "SY 服务端 PortalModule（会话 / 目录 / 能力）", "status": "todo", "evidence": null },
  { "项": "portal.invoke scope + /api/open/v1/portal/** + 契约同批", "status": "todo", "evidence": null },
  { "项": "桌面端连接器（开关 / state / 回调 / 凭据进 secrets）", "status": "todo", "evidence": null },
  { "项": "Portal 侧授权回调路由 + 同意页", "status": "todo",
    "evidence": null, "阻塞": "跨团队，链最长，应最早启动（H31）" },
  { "项": "portal MCP domain（7 个工具）+ Skill 包 portal 域指南", "status": "todo", "evidence": null },
  { "项": "限流 + 每次写的审计记录", "status": "todo", "evidence": null }
] }
```
