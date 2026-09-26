# 基础能力（Base Capabilities）调查报告

> **状态**：只读调查，2026-09-20。**没有写任何 src/ 代码，没有改动任何既有文件。**
> **范围**：回答「Portal 首屏刷新到底打了哪些接口」，并给出可执行的建能力清单。
> **本文的每条结论都标了来源**：`[实测]` = 我在测试环境真实观察/调用过；`[源码]` = 从 Portal 前端源码直读；
> `[推断]` = 我的推理，**未经证实**。三者不要互相当证据用。

> ⚠️ **勘误（2026-09-20 深夜，派单方加的）**：本文摘要里的**第 1 条「跨网关前缀」结论已被推翻**，
> 不要去照着修。独立复核（`src/context/http-instance.ts` + 新增的 `test/http-instance-prefix.test.ts`）的结论是：
> - 同 host 不同前缀的实例是 4 个（+ platform = 5），透传表 3 项，差集 **3 个不是 2 个**（本文漏了 `/mall-api`）；
> - 但透传表的判据**不是**「同 host 白名单」，而是「页面真的会把这段前缀当路径字面量写」——
>   全仓 6397 个前端文件里，`/admin-api` 出现 2779 次、`/adminmanage-api` 157、
>   `/mall-manage-api` 153，而 `/admin-shop-api`、`/admin-crm-api`、`/mall-api` **各 0 次**
>   （它们只作为 `sale.js` / `crm.js` / `mall-app.js` 的 baseURL 存在）。**判据与透传表一一对应，没有漏。**
> - 「影响 5 条能力」也不成立：**今天一条这样的能力都不存在**（那 5 条是本文 §7 的建能力提案）。
> 因此那次复核**没有产生任何行为改动**，只补了注释、测试与 `src/context/README.md` 的 §5。
> 教训记在这：**本文里 `[推断]` 的条目验伪成本很高，动手前先证伪一遍再说。**
> 除这一条之外，本文其余结论（上传链路、字典/部门/权限的实测体积与条数、首屏两层结构）经复核后采用。

## 0. 结论摘要

1. **首屏分两层，别混为一谈。**
   - **应用外壳（shell）**：约 **21 个后端接口**，与用户落在哪个页面无关，**每次刷新都打**。这一层是「基础能力」的正主。
   - **首页工作台卡片**：数量由 `GET /admin-api/homePage/get` 返回的用户配置决定。本次实测该用户一人拉出了 **101 个不同 URL**（两个抓取窗口合计）。
2. **菜单不请求后端。** Portal 的侧边栏菜单是**前端的静态常量** `all_menus`，用权限码在内存里过滤。后端只提供**权限码清单**。
3. **权限码清单 = `GET /admin-api/sys/menu/permissionsNotBySystem`**。这就是用户说的「Not by Permission 那个接口」——
   注意**源码里没有 "Not by Permission" 这个字符串**，实际标识符是 `permissionsNotBySystem`。
4. **字典是一个接口打四遍。** 四个独立 store 各查各的 `ready`，没有跨 store 的 in-flight 去重，所以并发 4 发同一个
   `/admin-api/system/dict-data/grouped-list`。这是浏览器里的浪费，SDK 不该照抄。
5. **上传链路无签名接口。** AK/SK 是**构建期注入前端产物的长期密钥**，`ali-oss` 在浏览器内本地算签名。
   全仓 grep `sts` / `signature` / `presigned` / `assumeRole` **零命中**。
   → **无头下走得通**（纯 HTTP + Node 内置 `crypto` 的 HMAC-SHA1，零新依赖），**卡点不是协议而是「凭据从哪来」**，
   以及**「本仓库不引入新运行时依赖」这条硬约束要求自己实现签名**。详见 §5。
6. **SDK 现状**：外壳这 21 个里，**已有 6 个**（都在 `src/session/base-data.ts` 的 `BASE_DATA_REGISTRY` 里）、
   **部分覆盖 2 个**（人员、组织，都是**页面级**的 search 能力）、**完全没有 13 个**。详见 §3。

---

## 1. 方法与来源

| 来源 | 做法 | 覆盖 |
| --- | --- | --- |
| **实测（网络）** | `bsk` 打开 `https://webtest01.wodecorp.cn/portal.html#/`，用 CDP 层的 `bsk network` 抓缓冲；刷新两次（一次抓初始化窗口，一次抓完整窗口） | 全量首屏请求 |
| **实测（只读调用）** | `./smoke/with-portal-token.sh node -e '...'` 对 12 个端点发 **GET**，记录 status / 字节数 / 耗时 / 条数 | 关键端点的**真实返回结构与体量** |
| **源码（静态）** | 只读扫描 Portal 前端仓库（`app/portal/**`、`common/**`、`build/env/**`）。**当时的路径**是 `/Users/liyang/Documents/code/wdbc/Projects_Js`；2026-09-22 起来的参考来源是 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`（`test/portal/main`），见 `docs/conventions.md` 第 32 条 | 调用链、请求头、缓存语义、上传实现 |
| **SDK 现状** | 读 `/Users/liyang/Documents/code/wdbc/portal-headless/src/**`、`test/**` | 已有能力盘点 |

**没有做的事**：没有写操作；没有提取或落盘任何凭据/token/cookie；没有碰生产环境；没有跑 `pnpm docs` / `pnpm build`。

**SDK 侧的关键既有地基**（读这三个就知道接到哪）：
- `src/session/base-data.ts` —— 6 个会话级基础数据能力（复刻 Portal 的 `BASE_DATA_REGISTRY`）
- `src/session/session.ts` —— `session.ensure([...])` / `session.baseData`
- `src/context/http-instance.ts` —— 19 个 http 实例表（复刻 Portal 的多 axios 实例）

---

## 2. 首屏请求清单

### 2.0 网关前缀（先理清，否则路径会读错）

`app/portal/utils/http/platform.js:9` 的 `baseURL = VITE_ZHDJ_PLATFORM_API`，并且**只有这一个 client** 有补前缀拦截器
（`platform.js:18-20`）：路径以 `/` 开头且不以 `/admin-api`、`/adminmanage-api`、`/mall-manage-api` 开头时，自动补 `/admin-api`。
`[源码]`

测试环境各 base（`build/env/.env.build.test:11-75`）`[源码]`：

| 实例 | 测试环境 base | 与 platform 同 host？ |
| --- | --- | --- |
| `platform` | `https://biz-api-test.wodecorp.cn` | — |
| `platform-mall-admin` | `https://biz-api-test.wodecorp.cn/mall-manage-api` | **是** |
| `sale` | `https://biz-api-test.wodecorp.cn/admin-shop-api` | **是** |
| `crm` | `https://biz-api-test.wodecorp.cn/admin-crm-api` | **是** |
| `product` | `https://fmtest.zhihuidanji.com/flockSimu` | 否 |
| `zhdj-app` | `https://smarterlayerapptest.zhihuidanji.com` | 否 |

> **这条对 SDK 很重要**：首屏用到的 5 个网关里，**4 个在同一个 host**，只是路径前缀不同
> （`/admin-api`、`/adminmanage-api`、`/mall-manage-api`、`/admin-shop-api`、`/admin-crm-api`）。
> SDK 现在只有**单一 `baseUrl`**（`src/config.ts:16`），且 `platform` 实例的 passthrough 白名单是
> `['/admin-api','/adminmanage-api','/mall-manage-api']`（`src/context/http-instance.ts:151`）——
> **不含 `/admin-shop-api` 与 `/admin-crm-api`**。所以那两条线上的能力现在「调得到地址、但会被补错前缀」。见 §7 的 P0-0。

### 2.1 A 层 —— 路由守卫里的全量初始化（`runLegacyFullInitTasks`）

调用点：`app/portal/utils/router/session.js:35-59`（守卫链 `router/index.js:14-21` → `router/auth.js:29` → `session.js:62`）。`[源码]`
**先串行 4 步，再并发 10 个。** 触发时机：**任何 dashboard 页面刷新都打**。

| # | 方法 | 路径（补全后） | 用途 | 调用点 |
| --- | --- | --- | --- | --- |
| 1 | GET | `/admin-api/sys/user/info` | 用户基础信息 | `utils/system.js:458` `fetchSimpleUserBasic` |
| 2 | GET | `{FM}/getUser` | 产品侧用户信息 | `utils/system.js:480` `fetchProductUserInfo`（失败被吞） |
| 3 | GET | `{CRM}/vue/getUserInfo` | 销售侧用户信息 | `utils/system.js:1002` `getSalesUserInfo` |
| 4 | GET | `/admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=1&pageSize=200` | 用户可见企业列表（`loopFetch` 最多 100 页） | `utils/system.js:606-626` `fetchTenantList`（失败即登出） |
| 5 | GET | `/admin-api/system/tenant/get?id={tenantId}` | 本企业开通了哪些系统（`useSystem` 逗号串） | `utils/system.js:673` `fetchTenantSystem` |
| 6 | GET | `/admin-api/sys/menu/permissionsNotBySystem` | **权限码清单** | `utils/system.js:697` `fetchPermissions` |
| 7 | GET | `/admin-api/org/sensitive/info` | 手机号脱敏配置 | `utils/system.js:916/923` `fetchSensitive` |
| 8 | GET | `/admin-api/system/dict-data/grouped-list` | 全量字典 | `utils/system.js:315` `fetchAllDicts` |
| 9 | GET | `/admin-api/system/dict-data/grouped-list` | 同上（platform store）**重复** | `utils/system.js:196` `fetchAllPlatformDicts` |
| 10 | GET | `/admin-api/system/dict-data/grouped-list` | 同上（sale store）**重复** | `utils/system.js:938` `fetchAllSaleDicts` |
| 11 | GET | `/admin-api/system/dict-data/grouped-list` | 同上（mall-admin store）**重复** | `utils/system.js:1345` `fetchMallAdminAllDicts` |
| 12 | GET | `/adminmanage-api/adminmanage/platform-config/list` | 平台/安全配置 | `utils/system.js:135` `fetchSecurityConfigs` |
| 13 | GET | `/admin-api/org/organization/getRoleOrganizationTree` | 组织树 | `utils/system.js:847` `fetchOrganization` |
| 14 | GET | `{SHOP}/admin/shop/getInfo` | 销售店铺 | `utils/system.js:1126` `fetchShopInfo` |
| 15 | GET | `{SHOP}/admin/area/allArea` | 销售地区 | `utils/system.js:1142` `fetchAreaInfo` |
| 16 | GET | `{SHOP}/admin/categoryManufacturer/manufacturerInfoList` | 厂商 | `utils/system.js:1158` `fetchManufacturerInfo` |
| 17 | GET | `{SHOP}/admin/categoryBrand/brandAllList` | 品牌 | `utils/system.js:1174` `fetchBrandInfo` |
| 18 | GET | `/adminmanage-api/system/dict-data/list-all-simple` | mall-admin 销售字典（**走 platform client**） | `utils/system.js:1309` `fetchMallAdminSaleDicts` |
| 19 | GET | `{MALL_ADMIN}/sys/crm/area/list?id=` | mall-admin 地区 | `utils/system.js:860` `fetchMallAdminAreaInfo` |

`[源码]` 以上 19 条；`[实测]` 我在刷新窗口里逐条看到了它们（除 #2/#14~#17 因外层 `Promise.all` 顺序略有出入，最终都出现了）。

### 2.2 B 层 —— 仅首页触发的守卫请求

| # | 方法 | 路径 | 用途 | 调用点 |
| --- | --- | --- | --- | --- |
| 20 | GET | `{SHOP}/admin/trade/adjustTradeProcessTip` | 首页待处理订单提示 | `utils/router/sale.js:29,32`（仅 `to.path === '/dashboard/home'`） |

### 2.3 C 层 —— 布局组件挂载（`app/portal/components/portal/layout/index.vue`）

| # | 方法 | 路径 | 用途 | 触发时机 |
| --- | --- | --- | --- | --- |
| 21 | GET | `/admin-api/performance/basedata/kpimessageremind/getUnreadcount` | 未读消息数 | setup 顶层，进任何 dashboard 页都打 |
| 22 | GET | `/admin-api/bpm/task/list-by-category?finished=1&pageNo=1&pageSize=10` | 待办角标 | 首屏 + **每次路由变化** |
| 23 | GET | `/admin-api/finance/expense-review/pending-count` | 费用审核待办角标 | `onMounted`，**仅当侧边栏存在该菜单** |
| 24 | GET | `{CMS_APP}/device/check.json?deviceCode=…` | 常用设备校验 | `onMounted` + **`setInterval` 每 5s** |

### 2.4 D 层 —— 首页工作台（`views/dashboard/common/home/index.vue`）

| # | 方法 | 路径 | 用途 | 触发时机 |
| --- | --- | --- | --- | --- |
| 25 | GET | `/admin-api/homePage/get` | 拉用户的工作台卡片布局 | setup 顶层，首屏必打 |
| 26 | POST | `/admin-api/homePage/save` | 布局为空时回写默认卡片 | **仅当 #25 返回空/被清理**（**写操作**，SDK 若要覆盖需按写能力处理） |
| 27 | 各自 | 每张卡片自己的统计接口 | 见 §2.6 | 卡片渲染后并发，**第二波** |

### 2.5 E 层 —— 应用级（静态资源，非后端接口）

| # | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 28 | GET | `build.json?t=…` | 版本守卫，**静态文件**；仅 `PROD`，每 10s |
| 29 | GET | `/scripts/common/o-spy/…/index.min.js` | 埋点脚本，**静态资源** |

### 2.6 首页卡片（数量不定）

**实测**：两个抓取窗口合计 **101 个不同 URL**（含上面全部）。除外壳外，其余都是卡片接口，按域聚类：
`hr/homepage/*`（13 个）、`finance/home-card/*`（14 个）、`sales/homepage/*`（8 个）、
`inventory/asset*/report/*`（9 个）、`supply/home-card/*` + `supply/organization/*`（12 个）、
`performance/statistics/homepage/*`（2 个）、`org/organization/getRoleOrganizationTree*`（6 个变体）、
`fmtest…/flockSimu/*`（12 个）。
**卡片集合由 #25 返回的配置决定，因人而异**，这里不做穷举。

> **注意 `org/organization/*` 一次首屏发了 9 个变体**：`getRoleOrganizationTree` ×3、
> `getRoleOrganizationTreeNew?excludePost=false` ×2、`getRoleOrganizationTreeFinanceModule?adjustRootLevel=true&moduleType=21|22|24|26` ×4。
> `[实测]`。这条是 §4.5 的关键伏笔：**同一个用户在不同 module-type 下拿到的组织树不一样**。
> （`src/invalidation/rules.ts:695` 早先也观察到了同一现象。）

---

## 3. SDK 现状逐条标注

判定口径：**已有** = 有独立能力/基础数据项且口径已验证；**部分** = 有，但是页面级、或不是通用形态；**完全没有** = 无。

| # | 接口 | SDK 现状 | 落在哪 / 缺什么 |
| --- | --- | --- | --- |
| 1 | `/admin-api/sys/user/info` | **已有** | `src/session/base-data.ts` → `user-basic`（`critical`） |
| 2 | `{FM}/getUser` | **完全没有** | 需新 http 实例接线（`product`，异地 host） |
| 3 | `{CRM}/vue/getUserInfo` | **完全没有** | 同上（`crm` 实例；同 host 不同前缀，需先解决 §7 P0-0） |
| 4 | `/admin-api/hr/system-tenant/getUserTenantsByPage` | **已有** | `base-data.ts` → `tenant-context`（`critical`） |
| 5 | `/admin-api/system/tenant/get` | **已有** | `base-data.ts` → `tenant-system`（`deps: tenant-context`） |
| 6 | `/admin-api/sys/menu/permissionsNotBySystem` | **完全没有** | **最高优先级缺口**，见 §4.3 |
| 7 | `/admin-api/org/sensitive/info` | **完全没有** | 见 §4.6 |
| 8-11 | `/admin-api/system/dict-data/grouped-list` | **已有（会话级）** | `base-data.ts` → `dict-hr` + `dict-platform`（两者同源）。但**不是可调用的能力**，见 §4.1 |
| 12 | `/adminmanage-api/adminmanage/platform-config/list` | **已有** | `base-data.ts` → `security-config` |
| 13 | `/admin-api/org/organization/getRoleOrganizationTree` | **部分** | 只有页面级的 `attendance-org-search`（走的是**另一个**接口，见 §4.5） |
| 14-17 | `{SHOP}/admin/{shop,area,categoryManufacturer,categoryBrand}/*` | **完全没有** | 销售基础数据，sale 实例 |
| 18 | `/adminmanage-api/system/dict-data/list-all-simple` | **完全没有** | 与 #8-11 内容重叠（954KB），可能不必单独建 |
| 19 | `{MALL_ADMIN}/sys/crm/area/list` | **完全没有** | mall-admin 地区 |
| 20 | `{SHOP}/admin/trade/adjustTradeProcessTip` | **完全没有** | 首页待办提示 |
| 21 | `/admin-api/performance/…/getUnreadcount` | **部分** | 能读，但无独立能力（`backlog-task-examine` 是流程审核，不是这个） |
| 22 | `/admin-api/bpm/task/list-by-category` | **完全没有** | 待办列表。**它其实是流程能力的一部分**，值得单独建 |
| 23 | `/admin-api/finance/expense-review/pending-count` | **完全没有** | 财务待办角标 |
| 24 | `{CMS_APP}/device/check.json` | **不需要** | 设备指纹校验，**无头场景无意义**（设计 Q64 已确认不被挡） |
| 25 | `/admin-api/homePage/get` | **完全没有** | 工作台配置 |
| 26 | `/admin-api/homePage/save` | **完全没有** | **写操作**，谨慎 |

**统计：应用外壳 21 个后端接口中，已有 6 / 部分 3 / 完全没有 12。**
（另有 2 个静态资源请求不需要能力化。）

**已有人力/组织 search 能力的实际形态**（这是「部分覆盖」的具体含义）`[源码]`：

| 能力 id | SDK 路径 | 接口 | 形态 |
| --- | --- | --- | --- |
| `meeting-user-search` | `meetingApplication.searchUsers` | `GET /admin-api/system/user/simple-page` | `pageNo/pageSize/nickname`，分页，**强制要关键字** |
| `attendance-org-search` | `attendanceArchive.searchOrganizations` | `GET /admin-api/org/organization/getAllOrganizationByType?type=N` | 只传 `type`，**取回整份再在前端 `includes` 过滤** |

两者都是**页面级**的（挂在会议室申请 / 考勤档案上），不是「谁都能调的基础能力」。

---

## 4. 五个重点（用户点名）

### 4.1 字典

- **接口**：`GET /admin-api/system/dict-data/grouped-list` `[实测]`
- **返回**：`{code,ret,data:[{dictType, dataList:[{id,dictType,value,label,colorType,cssClass,sort,remark,tenantId,platform}]}]}`
- **体量**：**996 KB / 885 个 dictType / 664 ms** `[实测]`（2026-09-20，租户 1）
- **分页**：**没有**。一次性全量。
- **参数**：**没有**。
- **另有一个扁平版**：`GET /adminmanage-api/system/dict-data/list-all-simple` → `data:[{id,dictType,value,label,…}]`，
  **954 KB / 5983 条 / 699 ms** `[实测]`。内容与 grouped-list 高度重叠，SDK **不建议**再建一条。
- **缓存价值**：**最高**。1 MB 的静态查表数据，且变更频率极低。`src/session/base-data.ts` 已实现
  `loadGroupedDicts`（归一化成 `{dictType: [{label,value,id}]}`）。
- **SDK 缺口**：现在只有**会话级 base-data**，AI 调用时**拿不到它**——没有能力 id、没有参数契约、
  不在 `ALL_CAPABILITY_DEFINITIONS` 里。逐页能力只好把枚举**硬编码**进 `options`
  （`assignment.ts:127`、`base-image.ts:280` 等都是这么干的），代价是字典一变就要重生成。
- **建议能力**：`base-dict-list`（`kind: 'enum'` 的候选来源）。参数 `dictType`（必填）。
  与逐页能力的关系：`ParamSpec.options` 可以改成「优先从 `base-dict-list` 取，取不到再退回静态快照」。
- ⚠️ **已知坑**（`assignment.ts:313`、`base-image.ts:163`）：`status` 是**全平台共用**的 dictType，
  装的是交易状态，不是业务状态。基础能力**不要**替调用方猜 dictType 的含义。

### 4.2 菜单

- **结论：Portal 的侧边栏菜单不请求后端。** `all_menus` 是 `app/portal/menus/index.js:101` 的**静态常量数组**
  （由 `hr.js`/`finance.js`/`supply.js`/`sale.js`/… 汇总）。`[源码]` 全 `menus/` 目录 grep **零 `http.` 调用**。
- **过滤方式**：`permissionFilter(all_menus)`（`utils/system.js:728-735`）按 `item.permission` 是否在
  `permissionStore.state` 里做树过滤。渲染在 `layout/index.vue:212`。
- **对 SDK 的含义**：**「菜单」不是一个要建的接口能力**，而是「静态菜单树 + 权限清单」的一次本地求交。
  SDK 已经有 `generated/page-catalog.json`（含每个页面的 `permission`），
  **只差权限清单**（§4.3）就能复刻这个求交。
- **但「菜单维护」是另一回事**（用户可能指的是这个）：那是后台 CRUD 页
  `app/portal/views/dashboard/hr/setting/menu/list.vue`，接口是
  `GET /admin-api/sys/menu/menuListNotBySystem`（树，**59 个根节点**）、`POST /admin-api/sys/menu`、
  `DELETE /admin-api/sys/menu`。`[源码]+[实测]`
  返回节点 `{id,pid,children,name,url,menuType,project,icon,permissions,sort,createDate,parentName,useSystem}`。
  → 这一族属于**后台管理页**（跟 §4.3 的权限清单不是一回事），优先级低于平台侧基础能力。

### 4.3 权限列表（「Not by Permission 那个接口」）★ 最高优先级

- **接口**：`GET /admin-api/sys/menu/permissionsNotBySystem` `[实测]`
- **唯一调用点**：`app/portal/utils/system.js:697` `fetchPermissions()` `[源码]`——**全仓只有这一处**。
- **返回**：`data` 是**纯字符串数组**，**2159 条**（本用户/本租户，2026-09-20 `[实测]`）。
  里面**混着两类**：页面路径码（`/dashboard/finance/value-added/calculation/fixed-asset-detailed-report`）
  与动作码（`investment:daily:account:export`、`supply:supplier:admittance:disable`）。
- **体量**：**87 KB / 954 ms** `[实测]`。
- **分页**：**没有**。
- **缓存**：Portal 用 `usePermissionStore` + 模块级 `ready` 布尔（`system.js:692-698`）；只有 `logout()` 清。
- **缓存价值**：**高**——87 KB、单请求近 1 秒，且它是「这个用户能干什么」的唯一权威来源。
- **SDK 现状**：**完全没有**。（`src/invalidation/rules.ts:721-727` 已记录：它不在 `BASE_DATA_REGISTRY` 六个 key 里。）
- **为什么它是最高优先级**：SDK 现在每个能力都带一个 `permission` 字段（如 `BASE_IMAGE_PERMISSION = '/dashboard/base/image'`），
  但**从来没校验过**——那个字段是生成器从 `page-catalog.json` 抄来的静态值。
  有了这个能力，SDK 才能回答「**这个用户到底能不能干这件事**」，而不只是「这个页面理论上要什么权限」。
- **建议能力**：`base-permission-list`，返回 `{ permissions: string[], has(code): boolean }`。
  建议作为会话基础数据项（`critical: false`，失败降级）+ 一个可调用的能力两件套。

### 4.4 用户信息

- **不是 1 个接口，是 5 个来源** `[源码]`：

| 数据 | 接口 | SDK |
| --- | --- | --- |
| id / realName / mobile / headUrl / 组织 | `GET /admin-api/sys/user/info` | **已有**（`user-basic`） |
| userName / systemTypeList / post | `GET {FM}/getUser` | 无 |
| 销售侧用户 | `GET {CRM}/vue/getUserInfo` | 无 |
| 部门 / 机构 | `GET /admin-api/org/organization/getRoleOrganizationTree` | 部分（§4.5） |
| 权限码 | `GET /admin-api/sys/menu/permissionsNotBySystem` | 无（§4.3） |

- **`sys/user/info` 实测返回**（831 B / 196 ms）`[实测]`：单个对象，
  `{id, username, password2, salt, realName, headUrl, gender, email, mobile, gradeId, deptId, status,
  createDate, creator, superAdmin, roleIdList, gradeName, roleList, organizationCode,
  organizationName, organizationFullPathName, organizationId, updaterName, updateDate, creatorName}`。
  - ⚠️ **它会把 `password2`（bcrypt 哈希）与 `salt` 一起吐回来**。SDK 归一化时**必须显式丢掉这两个字段**，
    不要让它们进缓存、日志或 AI 上下文。
  - `superAdmin` 是 0/1，值得单独暴露——它是「这个用户是不是超管」的判据。
- **分页**：无。**缓存价值**：高（但体量小，196ms）。
- **建议**：把 `user-basic` 从「会话内部数据」提升为**可调用能力** `base-user-info`，
  并**在归一化时白名单字段**（而不是黑名单丢 `password2`）。

### 4.5 人员与组织

**人员** `[实测]+[源码]`：

- 接口：`GET /admin-api/system/user/simple-page`
- 参数：`pageNo`、`pageSize`、`nickname`（**关键字**）
- 返回：`{list:[{id,nickname,deptId,code,deptName,staffDuties,realName,staffCode}], total, summary, summaryRows}`
- **实测**：`nickname=张` → `total: 436`，带分页，3 条/页正常返回。
- **SDK 现状**：`meeting-user-search`（`meetingApplication.searchUsers`）。
  **已经强制要关键字**（`meeting-application.ts:282-290`：无 `keyword` 且无 `deptId` 直接抛错）——符合 D6。
- **缺口**：它是**页面级**的。建议提升为 `base-user-search`，让所有需要人员候选的能力共用同一个 lookup。

**组织** `[源码]+[实测]`：

- **三个不同的组织接口，形状和体量差很远**：

| 接口 | 体量（实测） | 参数 | 形状 | SDK |
| --- | --- | --- | --- | --- |
| `/admin-api/org/organization/getRoleOrganizationTree` | **501 KB** / 415 ms | **无** | 树，节点约 60 字段 | 无 |
| `/admin-api/org/organization/getAllOrganizationByType?type=N` | type=1 → 17 节点 | `type` | 树，字段更精简 | `attendance-org-search` |
| `/admin-api/system/dept/list-all-simple` | **63 KB / 1551 节点 / 277 ms** | **无** | **扁平** `{id,name,parentId}` | 无 |

- **⭐ 关键建议**：`system/dept/list-all-simple` 是**最被低估的一个**——
  1551 个节点只要 **63 KB**，是 `getRoleOrganizationTree`（501 KB）的 **1/8**，
  而且返回的是最容易缓存的扁平 `{id,name,parentId}` 三元组（树可以在 SDK 侧现拼）。
  对于「AI 需要知道部门名 → id」这个最常见的用途，**它比 500KB 的 org tree 合适得多**。
- **⚠️ 组织树的 module-type 陷阱** `[源码]`（`src/invalidation/rules.ts:669-700` 已详述）：
  控制器把 `module-type` 请求头写进 `LoginUser`，权限组织集按它算
  （`HrOrganizationServiceImpl.java:5315-5331`）→ **同一用户在不同 module-type 下拿到的组织树不一样**。
  `[实测]` 佐证：首屏一次发了 9 个组织树变体。
  → **要缓存组织树，缓存键必须并进 module-type**，不能照抄六个 key 的 `(user, tenant, lang)`。
- **`attendance-org-search` 的实现弱点**：它只传 `type`，把整份列表拉回来后在 JS 里
  `list.filter(item => item.name.includes(keyword))`（`attendance-archive-sheet.ts:275-280`）。
  这**忠实复刻了页面**，但作为基础能力，它意味着**每次搜索都拉全量**。
  **后端是否有按关键字过滤的参数，我没有查**（见 §8）。

---

## 5. 上传链路 ★ 最要紧

### 5.1 Portal 是怎么做的 `[源码]`

**主链路：浏览器用 `ali-oss` SDK 直传阿里云 OSS。**

组件收口在 `common/utils/oss.js`（全仓**唯一** `import OSS from 'ali-oss'` 的地方）：

```
用户选文件 → 组件 beforeUpload 校验（类型/宽高比/大小）
  → antd customRequest → ossPut({file, folder, silent, fixedName, index})   [oss.js:139]
      · 路径 = `${folder}/${YYYY}/${MM}/${随机名}.${ext}`                     [oss.js:171]
      · new OSS({accessKeyId, accessKeySecret, region, bucket, cname, endpoint})  [oss.js:160]
      · client.put(path, file)                                              [oss.js:172]
      · client.getACL(path) + client.putACL(path, 'public-read')            [oss.js:176-177]
      · 返回完整 URL                                                         [oss.js:182]
  → 组件把 URL 写回 v-model / emit('done', {url, fileName, size})
  → 用户保存表单，业务接口收到的是**完整 URL 字符串**
```

- **上传组件族**：`common/components/common/upload/{file,image,dragger,image-multiple,file-plus,image-multiple-name}/`。
  Portal 里的使用次数：`common-upload-image` 91、`common-upload-dragger` 86、`common-upload-file` 67、
  `common-upload-file-plus` 63、`common-upload-image-multiple` 15。`[源码]`
- **folder 白名单**：`ossFilePathOptions`（`oss.js:42-95`）——`Public/public`、`HR/*`、`Finance/*`、
  `Material/*`、`Production/public`、`Procurement/*`、`CRM/*`、`Portal/public`、`Research/public`。`[源码]`
- **图片没有单独链路**：`common-upload-image` 调的是**同一个 `ossPut`**，只是多一层图片校验。`[源码]`
- **大文件**：`ossMultipartUpload`（`oss.js:197-235`），分片上传；>300MB 时清空 `cname`/`endpoint` 回落路径式寻址。

### 5.2 有没有「取签名 / 取上传凭证」接口？

**没有。这是本次调查最明确的结论。** `[源码]`

- 全仓（排除 `node_modules`/`dist`）grep `getSts` / `assumeRole` / `stsToken` / `securityToken` /
  `getSignature` / `signatureUrl` / `presigned` → **零命中**。
- 凭据是**构建期注入前端产物**的：`ossConfigV2`（`oss.js:33-40`）读
  `VITE_OSS_V2_ACCESS_KEY_ID` / `_SECRET` / `_REGION` / `_BUCKET` / `_ENDPOINT`，
  值写在 `build/env/.env.build.*` 里（测试环境见 `build/env/.env.build.test:102-106`）。
- 签名由 `ali-oss` **在浏览器内本地算**（HMAC-SHA1/256），**没有任何换取临时凭据的请求**。
- 依赖：`package.json:45` `"ali-oss": "^6.17.1"`，**运行时必需**（不是「只用于取签名后的 PUT」——因为根本没有取签名那一步）。

> **⚠️ 这是一条安全发现**：OSS 的**长期 AK/SK 以明文提交在版本库里**（`build/env/.env.build.test`、
> `.env.build.test02`、`.env.build` 三处，值相同），并打进公网可访问的前端产物。
> 本文**不复制这些值**。任何基于它的 SDK 实现都必须让**调用方自带凭据**，不能把密钥内置进本仓库。

### 5.3 关键问题：这条链能不能在无头（Node）里走通？

**能走通，但要做三件事，且有一个硬约束要拍板。**

**协议层：完全可行，且零新依赖。** `client.put()` 本质就是一次带签名的 HTTPS PUT：
`PUT https://{endpoint}/{objectKey}`，`Authorization: OSS {accessKeyId}:{signature}`，
签名 = `HMAC-SHA1`（OSS V1）或 `OSS4-HMAC-SHA256`（V4）。Node 内置 `crypto` + `fetch` 就能算能做。
`getACL`/`putACL` 同理（`GET ?acl` 与 `PUT ?acl` + `x-oss-object-acl: public-read` 头）。

**要做的三件事：**

1. **凭据从哪来**——必须由调用方通过 SDK 配置传入
   （建议 `createPortalHeadless({ baseUrl, credential, oss: { accessKeyId, accessKeySecret, region, bucket, endpoint } })`），
   **绝不允许把 AK/SK 写进本仓库**。这是 §5.2 那条安全发现决定的设计。
2. **自己实现 OSS 签名**——因为**不能引入 `ali-oss` 依赖**（硬约束）。
   需要覆盖三个操作：`PutObject`、`GetObjectACL`、`PutObjectACL`。全都是 `crypto.createHmac('sha1', sk)`。
3. **objectKey 生成规则要复刻**——`${folder}/${YYYY}/${MM}/${随机名}.${ext}`，
   随机名规则在 `oss.js:101-131` `renameRandom`（`dayjs().format('HH-mm-ss')` + `id8()` 或 `nanoid()`）。

**卡在哪一步：**

| 环节 | 无头可行性 | 说明 |
| --- | --- | --- |
| 选文件后校验（类型/尺寸/宽高比） | ⚠️ 部分 | 宽高比校验用 `new Image()` + `URL.createObjectURL`——**Node 里没有**。需要调用方自己保证，或引入图片解析（**不允许**）。 |
| `File` / `Blob` 对象 | ⚠️ | 主链路把 `File` 交给 `client.put`。Node 侧改成 **`Buffer`/`Readable`** 即可，协议层无差别。 |
| OSS PUT + 签名 | ✅ **可** | 纯 HTTP + `crypto`。**本次未实测**（属写操作，本单禁止）。 |
| `getACL` / `putACL` | ✅ **可** | 同上。**注意**：这两步**不能省**，桶不是默认公共读——省了的话 URL 上传成功但**读不出来**。 |
| 拿回 URL | ✅ **可** | `https://{endpoint}/{objectKey}`（cname 模式）。⚠️ 参照实现：`ossPut` 实际返回的是 **`http://`**（ali-oss 的 `secure` 默认 `false`），Portal 靠 91 处 `fixHttpsUrl` 兜底。**SDK 要直接给 `https://`。** |
| 富文本图片切割/压缩 | ❌ **不可** | 依赖 `canvas` / `OffscreenCanvas` / `Worker`（`common/libs/image-cut/share.js`）。无头下**不做**，由调用方给已处理好的字节。 |
| PDF 页数 / 视频信息 | ❌ **不可** | 依赖 `pdfjs-dist` / `mediainfo.js` + wasm。无头下**不做**。 |

**结论**：**「上传一个字节流、拿回一个公开可读的 URL」这条核心链在无头下走得通，零新依赖。**
浏览器独有的那些（图片切割、PDF 页数、宽高比探测）是**边角加工**，不是地基，应当明确**不做**。

### 5.4 另有一条次要链路（后端代理上传）

少数页面不走 OSS，走**后端 multipart**：`POST /sys/uploadFile/upload`（`FormData{file,type}`，
`ModalUploadContent.vue:102-110`）、`POST {MALL_ADMIN}/sys/local/uploadFile/upload`
（遗留，仅 3 个页面在用）、以及一批 `import-excel` 导入接口。
`[源码]` 这些是**业务导入**，返回的是导入结果/路径 id，**不是**通用的「拿 URL」能力——
**建议不并入上传基础能力**，留在各自页面能力里。

---

## 6. 依赖关系

```
                       ┌─────────────────────────────┐
                       │  凭据（token + tenant-id）    │  ← 已有：src/config.ts + session
                       └──────────────┬──────────────┘
                                      │
        ┌─────────────────────────────┼──────────────────────────┐
        │                             │                          │
   ┌────▼─────┐              ┌────────▼────────┐        ┌────────▼────────┐
   │ 用户信息  │              │  租户上下文      │        │  权限清单        │
   │ user-info│              │ tenant-context  │        │ permissions     │
   │  [已有]  │              │    [已有]       │        │  [P0 缺]        │
   └────┬─────┘              └────────┬────────┘        └────────┬────────┘
        │                             │                          │
        │                    ┌────────▼────────┐        ┌────────▼────────┐
        │                    │  企业开通系统    │        │  菜单（静态树）  │
        │                    │ tenant-system   │        │  × 本地求交     │
        │                    │    [已有]       │        │  → 可见菜单      │
        │                    └─────────────────┘        └─────────────────┘
        │
        │        ┌───────────────┬───────────────┬────────────────┐
        │        │               │               │                │
   ┌────▼────┐ ┌─▼─────┐  ┌──────▼──────┐ ┌──────▼──────┐ ┌───────▼───────┐
   │ 字典     │ │ 组织   │  │  人员候选    │ │  上传        │ │  安全配置      │
   │ dict    │ │ dept   │  │ user-search │ │  upload      │ │  [已有]       │
   │ [会话级] │ │ [P1]   │  │  [部分]     │ │  [P0 缺]     │ └───────────────┘
   └────┬────┘ └───┬────┘  └──────┬──────┘ └──────┬───────┘
        │          │              │               │
        └──────────┴──────────────┴───────────────┘
                          │
              ┌───────────▼────────────────────────────────────┐
              │            页面能力 / 流程表单                    │
              │  会议申请（需要 人员 + 会议室 + 上传? ）           │
              │  作业管理 / 图库（需要 上传 拿 url）               │
              │  考勤档案（需要 组织 + 人员）                      │
              │  合同模板（需要 分类字典）                         │
              │  所有写能力（需要 权限 做前置检查）                 │
              └────────────────────────────────────────────────┘
```

**被依赖次数最多的三个（按依赖方数量排序）：**

1. **上传** ← 所有带附件的流程表单 / CRUD 表单（Portal 里 `common-upload-*` 被用了 322 次）。
   **这是地基里的地基**，也是当前 SDK 唯一一处**明确写在代码里的能力缺口**
   （`src/capabilities/base-image.ts:43`：`SDK 不覆盖上传，url 必须由调用方提供`）。
2. **字典** ← 所有 `kind: 'enum'` 的参数。现在靠逐页硬编码快照，字典一变就得重生成。
3. **权限** ← 所有写能力的前置检查（现在完全没有）。
4. **人员 / 组织** ← 所有 `kind: 'search'/'tree'` 的长选项参数（D6 明确要求先要关键字）。

**一个具体的依赖闭环例子（图库管理，`base-image.ts`）**：
`base-image-create` 要求 `url: string`，注释写着「SDK 不覆盖上传，由调用方给」。
→ **调用方拿不到 url，这个能力就是半残的**：AI 只能让用户手动去页面上传。
这正是「上传是地基」的最直接证据。

---

## 7. 可执行的建能力清单

按依赖顺序排。**P0 是其它一切的前提**。

### P0-0｜先修「跨网关前缀」这条路（**不是能力，是接线**）

- **问题**：SDK 单一 `baseUrl` + `platform` 实例的 passthrough 白名单
  （`src/context/http-instance.ts:151`）**不含 `/admin-shop-api` 与 `/admin-crm-api`**。
  而 §2.0 显示测试环境这 4 个网关**同 host**。不修的话，A 层 #3、#14~#17 这 5 条能力会被补成
  `/admin-api/admin-shop-api/...`，**静默打到错 URL**。
- **产出**：把 `admin-shop-api`、`admin-crm-api` 加进 passthrough；或改用 `httpInstance` 的 `baseUrl` 解析。
- **验收**：一条真实请求打到 `https://biz-api-test.wodecorp.cn/admin-shop-api/admin/shop/getInfo` 且 200。
- **注意**：这**改的是 `src/context/http-instance.ts`**，它被 `test/http-instances.test.ts` 逐字段比对
  Portal 源码。**改之前先看清那条测试锁的是什么**——`admin-shop-api` 在 Portal 里是**另一个 base**
  （`VITE_SHOP_ADMIN_API`），不是 platform 的 passthrough 项。所以正确的修法是**让 `sale` 实例能解析到自己的
  base**，而不是往 platform 的白名单里塞。

### P0-1｜`base-upload`（上传）★ 最要紧

- **接口**：**不是后端接口**，是 OSS `PutObject` + `PutObjectACL`。
- **参数契约**：
  - `content`（必填，`Buffer`/字节）或 `path`（本地文件路径）
  - `folder`（必填，**枚举**，取值来自 `ossFilePathOptions` 白名单，`kind: 'enum'`）
  - `fileName`（可选，不给则按 `renameRandom` 规则生成）
  - `contentType`（可选）
- **返回**：`{ url: string, objectKey: string }`（`url` 用 **https**，不要复刻 `ossPut` 的 `http://` 缺陷）
- **配置**：`oss: { accessKeyId, accessKeySecret, region, bucket, endpoint }` —— **调用方传入，仓库不留密钥**。
- **依赖**：无（但它被大量页面能力依赖）。
- **不做**：图片切割/压缩、PDF 页数、宽高比探测（需浏览器，见 §5.3）。
- **四件套要求**：**这是写能力**，按 CLAUDE.md 必须有 `prepare → submit → cancel` 的完整记录，
  且写完要在**同一轮里撤销**（OSS 侧 `DeleteObject`，`ossDeleteMulti` 的对应实现）。
- **反证**：故意传错 AK/SK，确认报错而不是静默成功；故意省掉 `putACL`，确认 URL 读不出来。
- **⚠️ 本单未实测**：属写操作，本次调查全程只读。**这条链的可行性是协议层推演 + 源码直读，不是实测。**

### P0-2｜`base-permission-list`（权限清单）

- **接口**：`GET /admin-api/sys/menu/permissionsNotBySystem`
- **参数**：无。
- **返回**：`{ permissions: string[], has(code: string): boolean }`（原始 `data` 是 2159 条字符串 `[实测]`）
- **分页**：无。**体量**：87 KB / 954 ms `[实测]`。
- **建议**：同时做成**会话基础数据项**（`critical: false`，失败降级）+ 可调用能力。
- **验收**：用 `has('/dashboard/base/image')` 判断本用户能否进图库页。
- **反证**：拿一个明显不属于该用户的权限码，确认 `has()` 为 `false`。

### P0-3｜`base-dict-list`（字典）

- **接口**：`GET /admin-api/system/dict-data/grouped-list`
- **参数**：`dictType`（必填，`kind: 'enum'`——886 个候选太多，实际应先由调用方给，或做成两步）
- **返回**：`[{label, value, id}]`
- **分页**：无。**体量**：996 KB / 885 dictType `[实测]`。**强烈建议会话级缓存**。
- **建议**：`src/session/base-data.ts` 的 `loadGroupedDicts` **已经实现好了**，缺的只是把它暴露成能力。
- **验收**：取一个逐页能力里硬编码过的枚举（如 `assignment_type` 的 6 个值），确认与 `assignment.ts:127` 的快照一致。

### P1-1｜`base-dept-list`（轻量组织）★ 性价比最高

- **接口**：`GET /admin-api/system/dept/list-all-simple`
- **参数**：无。**返回**：扁平 `[{id, name, parentId}]`，**1551 节点 / 63 KB / 277 ms** `[实测]`
- **为什么用它而不是 org tree**：体量是 `getRoleOrganizationTree` 的 **1/8**，且扁平结构最好缓存、最好拼树。
- **⚠️ module-type**：这个接口**是否也按 module-type 过滤，我没有验证**（见 §8）。若会，缓存键必须并进 module-type。

### P1-2｜`base-user-search`（人员候选，从页面级提升）

- **接口**：`GET /admin-api/system/user/simple-page`
- **参数**：`keyword`（必填，映射到 `nickname`）、`pageNo`、`pageSize`
- **返回**：`{list:[{id,nickname,deptId,code,deptName,…}], total}`
- **现状**：`meetingApplication.searchUsers` 已实现且**已强制要关键字**（符合 D6），只是挂在会议室页上。
- **动作**：**不是新建，是提升**——让 `lookup.capabilityId` 能指向一个跨页面共用的 id。

### P1-3｜`base-org-search`（组织候选，同上）

- **接口**：`GET /admin-api/org/organization/getAllOrganizationByType?type=N`
- **现状**：`attendanceArchive.searchOrganizations` 已实现，但**每次搜索拉全量再前端过滤**。
- **缺口**：**后端是否有服务端关键字过滤参数，我没查**。若有，应改用它；若无，保持现状但在描述里写明代价。

### P2｜销售/商城基础数据（A 层 #2、#3、#14~#17、#19、#20）

- `{CRM}/vue/getUserInfo`、`{SHOP}/admin/{shop/getInfo, area/allArea, categoryManufacturer/manufacturerInfoList, categoryBrand/brandAllList}`、
  `{MALL_ADMIN}/sys/crm/area/list`、`{SHOP}/admin/trade/adjustTradeProcessTip`、`{FM}/getUser`
- **共同前提**：**先做完 P0-0**，否则打不到。
- **共同特征**：都是「无参数全量拉取 + 强缓存价值」的字典类数据，可套用同一个模板。
- **优先级判断**：这些只服务销售/商城域。**除非有页面能力要用，否则先不做**——
  按 CLAUDE.md 的队列规则，逐页推进时自然会遇到。

### P2-5｜`base-todo-list`（待办 / 角标）

- `GET /admin-api/bpm/task/list-by-category?finished=1|2&pageNo=1&pageSize=10` → `{total, list}`
- `GET /admin-api/performance/basedata/kpimessageremind/getUnreadcount`
- `GET /admin-api/finance/expense-review/pending-count`
- **注意**：`bpm/task/list-by-category` 本质是**流程能力**的一部分，建的时候要和「发起流程」那条线对齐。

### 不建议做

| 项 | 理由 |
| --- | --- |
| `{CMS_APP}/device/check.json` | 设备指纹校验，无头场景无意义（设计 Q64 已确认不被挡） |
| `GET /adminmanage-api/system/dict-data/list-all-simple` | 954 KB，与 `grouped-list` 高度重叠，**多建一条纯浪费** |
| `POST /admin-api/homePage/save` | 写操作，改的是用户个人工作台布局；SDK 去写它属越界 |
| 图片切割 / 压缩、PDF 页数、视频信息 | 需浏览器 canvas/wasm，见 §5.3 |
| 后端 multipart 导入接口（`import-excel` 一族） | 是业务导入，不是通用「拿 URL」能力 |

---

## 8. 实测 / 推断 / 没查到

### 我实测到的（可复现）

**网络（`bsk` + CDP `bsk network`，`https://webtest01.wodecorp.cn/portal.html#/`，2026-09-20）**
1. 首屏刷新确实打出 A/B/C/D/E 五层请求，**顺序与 `session.js:35-59` 的串行 4 步 + 并发 10 个完全吻合**。
2. `grouped-list` **确实一次首屏发了 4 遍**（`[实测]` 4 条同 URL 记录）。
3. 组织树一次首屏发了 **9 个变体**（`getRoleOrganizationTree` ×3、`New` ×2、`FinanceModule` ×4）。
4. 两个抓取窗口合计 **101 个不同 URL**。
5. **`homePage/save` 确实被 POST 了 5 次**（首页布局为空时的回写）。

**只读调用（`./smoke/with-portal-token.sh` + `fetch`，全部 GET，2026-09-20，租户 1）**

| 接口 | status | 字节 | 耗时 | 条数 |
| --- | --- | --- | --- | --- |
| `permissionsNotBySystem` | 200 | 87,103 | 954 ms | 2159 条字符串 |
| `dict-data/grouped-list` | 200 | 996,052 | 664 ms | 885 dictType |
| `dict-data/list-all-simple` | 200 | 953,703 | 699 ms | 5983 条 |
| `sys/user/info` | 200 | 831 | 196 ms | 单对象 33 字段 |
| `getRoleOrganizationTree` | 200 | 501,069 | 415 ms | 树（根 1 个） |
| `platform-config/list` | 200 | 12,295 | 149 ms | 8 个分组 |
| `system/dept/list-all-simple` | 200 | 63,062 | 277 ms | 1551 条扁平 |
| `category-dict/getChildNodeTree?code=contract_type` | 200 | 520 | 208 ms | 树 |
| `sys/menu/menuListNotBySystem` | 200 | — | — | 59 个根节点 |
| `system/user/simple-page?nickname=张` | 200 | — | — | `total: 436` |
| `getAllOrganizationByType?type=1` | 200 | — | — | 17 个节点 |
| `org/sensitive/info` | 200 | — | — | 单对象 |

**源码直读（Portal 前端仓库，只读；当时的路径是 `/Users/liyang/Documents/code/wdbc/Projects_Js`，
2026-09-22 起换成 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`）**
- 全量初始化链 `app/portal/utils/router/session.js:35-59`。
- 菜单**零后端请求**：`app/portal/menus/index.js:101` 的静态 `all_menus`。
- `permissionsNotBySystem` 唯一调用点 `app/portal/utils/system.js:697`。
- 上传：`common/utils/oss.js` 全程；`ali-oss` 唯一 import 在 `oss.js:2`；
  **无 STS/签名接口**（grep 零命中）；AK/SK 来自构建期 env（`build/env/.env.build.test:102-106`）。
- SDK 现状 48 个能力 id、6 个 base-data key、19 个 http 实例。

### 我只是推断的（未经证实）

1. **「4 次 grouped-list 是浪费」** —— 4 个 store 各查各的 `ready`、无 in-flight 去重，这是从代码结构推的，
   我没有做时序验证（比如它们是否真的并发）。
2. **「首屏 21 个后端接口」** —— 是把 A/B/C/E 层去重后的计数。**#23 是否总发**取决于该用户侧边栏有没有那个菜单，
   本次这个用户有，所以发了。**换个用户数字会变。**
3. **「组织树缓存键必须并进 module-type」** —— `rules.ts:669-700` 从后端源码推的（`HrOrganizationServiceImpl.java:5315-5331`），
   我没有在测试环境用两个不同 module-type 实测对比过两次返回是否真不同。
4. **「`system/dept/list-all-simple` 不受 module-type 影响」** —— **纯属未验证**。我只是没在它的调用点看到 module-type 相关代码。
5. **「无头 OSS 上传走得通」** —— 协议层推演 + 源码直读。**没有实测**（写操作，本单禁止）。
   `getACL`/`putACL` 是否真的必需，也**没有实测**——是从 `oss.js:176-177` 的存在逆推的。
6. **「#18 `list-all-simple` 与 grouped-list 内容重叠」** —— 我看了两者的 dictType 分布有交集，
   但**没有做逐条 diff**（各 6000/885 条）。「不建议单独建」这条建议建立在这个未验证的重叠判断上。
7. **「销售域那 6 个接口优先级低」** —— 是**判断**，不是数据。取决于后续页面能力的需求。

### 我没查到的

1. **后端 `/sys/uploadFile/upload`、`/sys/local/uploadFile/upload` 的服务端实现**（两个仓库都不含）——
   它们返回的 `{localPath, ossUrl}` 说明后端**可能**曾做「落盘 + 转存 OSS」，**无法证实**。
2. **组织接口有没有服务端关键字过滤参数** —— `getAllOrganizationByType` 与 `getRoleOrganizationTree`
   我只验证了不带别名的参数，**没有翻后端 Controller 的完整签名**。
3. **`system/dept/list-all-simple` 是否受 module-type 影响**（见上）。
4. **权限码 2159 条里「页面码」与「动作码」的精确比例** —— 我只看了前几条的形态，没有分类统计。
5. **`bpm/task/list-by-category` 的 `finished` 参数语义** —— 实测看到 `finished=1` 与 `finished=2` 两组，
   但没确认哪个是「待办」哪个是「已办」。
6. **`homePage/get` 返回的卡片配置结构** —— 没有拉它的响应体（首页卡片的接口清单因此是不完整的，
   §2.6 的聚合是**从实际发出的请求反推**的，不是从配置推的）。
7. **门户其它 17 个 host 的环境**（除 `webtest01` / `biz-api-test` 之外）—— 按授权范围**没有碰**。
8. **`ali-oss` 6.x 在无头下用 V1 还是 V4 签名** —— 源码没有显式指定 `signatureVersion`，
   我没有去读 `node_modules/ali-oss` 的默认值。**实现 P0-1 时必须先确认这一点。**
