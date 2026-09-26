import { normalizeMenuEntryPath } from './module-type.js'

/**
 * 「这次请求走哪个 axios 实例」的推导 —— `module-type.ts` 的兄弟能力。
 *
 * ## 为什么需要它
 *
 * Portal 前端**不止一个 axios 实例**（`app/portal/utils/http/*.js` 下 16 个文件、17 个实例——
 * `zhdj-cms.js` 一个文件导出 `http` 与 `httpLay` 两个绑定），而 SDK 原先假设只有一个。
 * 实例不是无关紧要的实现细节：它决定**打哪个 base URL**、**路径补不补 `/admin-api`**、
 * **每页条数参数叫 `pageSize` 还是 `limit`**、**发哪些请求头**。
 * 页面自己 import 的实例不一定是它列表请求用的那个——很多页面 import 了 `sale.js`，
 * 列表却仍走全局默认。上一轮批量生成器抓到的三处错误里有两处根因就在这。
 *
 * ## 事实来源
 *
 * 全部来自 Portal 源码，出处逐条写在 `HTTP_INSTANCES` 的 `source` 与
 * `HTTP_INSTANCE_PAGE_RULES` 的 `source` 上，推导过程见 `src/context/README.md`。
 * 不是照抄前一轮生成器的常量表——`HTTP_INSTANCE_PAGE_RULES` 的推导器覆盖了它漏掉的
 * 两种声明形式（preset 包装、无扩展名 import），条目数从 34 变成 54。
 *
 * ## 算不出实例时的行为与 D34 **刻意不同**
 *
 * `module-type` 算不出就**不发这个头**，因为浏览器在同页面上同样不发——那是与浏览器一致，
 * 是忠实，不是退让（D34 / F19）。
 *
 * 实例算不出的后果完全不同：**走错实例 = 打到错的 URL**，而不是少一个头。
 * 一个打到 `biz-api-test.wodecorp.cn/admin-api/...` 的请求和一个该打到
 * `biz-api-test.wodecorp.cn/admin-shop-api/...` 的请求，失败方式可能只是 404 或
 * 一个字段不同的 200——**静默且难查**。所以这里一律**失败关闭**：
 * 解析不到就不发这次请求，抛 `HttpInstanceResolutionError`。
 *
 * 注意「解析不到」有三种，只有后两种是真算不出：
 *
 * 1. 页面没有任何 http 声明 → 走全局默认 `platform.js`。这是**推导出来的**，不是猜的：
 *    `app/portal/main.js:42-48` 的 `setRenrenConfig({ http })` 把 platform.js 注入成
 *    `common/libs/renren/list.js` 的全局默认，没有声明就等于没覆盖它。
 * 2. 页面声明的实例**认不出来**（例如 `http: someVar` 来自某个 composable）。
 *    → 抛。
 * 3. 解析到的实例**拿不到 base URL**（调用方没配）。→ 抛。
 *    base URL 属于「16 页打到 `VITE_SHOP_ADMIN_API` 同 host 不同前缀要不要支持」那个
 *    未决的范围决策，SDK 不替它做决定，只要求显式给。
 */

// ---------------------------------------------------------------------------
// 实例画像
// ---------------------------------------------------------------------------

/**
 * 请求发出前对 url 字符串的改写规则。原样复刻各实例的请求拦截器。
 */
export type HttpUrlRewrite =
  /** 不改写（绝大多数实例） */
  | { kind: 'none' }
  /**
   * 补绝对前缀。`platform.js:18-20` 独有：
   * `if (config.url.startsWith('/') && !startsWith(任一 passthrough)) url = '/admin-api' + url`
   * 注意三个条件——**必须以前导 `/` 开头**（漏写前导斜杠的相对路径原样发出，
   * 于是被 axios 当成相对路径拼到 baseURL 后面，落到 `/{漏写的那段}` 而不是 `/admin-api/...`）、
   * **命中 passthrough 就不补**。
   *
   * ## passthrough 不是「同 host 的网关白名单」，别往里加
   *
   * 那三项的判据是**页面自己会不会把这段前缀写进路径**：`/adminmanage-api`（157 处）、
   * `/mall-manage-api`（153 处）在页面里真的会写成 `getDataListURL: '/mall-manage-api/...'`，
   * 靠透传送到同一 host 上的另一段前缀；而 `/admin-shop-api`（`sale.js`）、
   * `/admin-crm-api`（`crm.js`）、`/mall-api`（`mall-app.js`）在前端**作为路径字面量出现 0 次**
   * ——它们是**另外三个实例各自的 baseURL**（`VITE_SHOP_ADMIN_API` / `VITE_CRM_API` /
   * `VITE_MALL_APP_API`），路径里不带前缀。
   *
   * 所以「同 host 不同前缀」在 SDK 里的通路是**换实例 + 在 `httpBaseUrls` 里配它的 baseURL**
   * （`src/call.ts`，没配就拒绝发请求），不是往这张表里加项。加了 = 不复刻 `platform.js`：
   * `test/http-instance-prefix.test.ts` 会红。
   * （2026-09-20 有一份只读调查报告主张「这里漏了 shop/crm 两个前缀」，复核后不成立 ——
   * 数出来的差集是 3 个不是 2 个、受影响的能力是 0 条不是 5 条，证据与实测见
   * `src/context/README.md` §5。）
   */
  | { kind: 'prepend-absolute'; add: string; passthrough: readonly string[] }
  /**
   * 追加后缀。`zhdj-admin.js:15-17` 的 `.lay`（挂了请求级 flag `isLay`）、
   * `zhdj-cms.js:20-25` 的 `.lay`（建实例时的 `lay` 参数，见 `zhdj-cms-lay`）、
   * `zhdj-app-lay.js:11-14` 的 `.lay`（无条件）。
   * `whenFlag: null` 表示无条件追加。
   */
  | { kind: 'append-suffix'; suffix: string; whenFlag: string | null }

/** 请求头的生成方式。差异不只是名字，是**发几个头、发哪些**。 */
export type HttpHeaderMode =
  /**
   * `generateHttpHeaders()`（`app/portal/utils/system.js:813-836`）：
   * `tenant-id` / `token` / `module-type` / `Accept-Language`。
   * platform.js 额外把请求级的 `config.moduleType` 当成覆盖值传进去（`platform.js:25`）。
   */
  | 'generate-http-headers'
  /** 手写：只有 `Accept-Language` + `token`。**没有 tenant-id，也没有 module-type** */
  | 'minimal'
  /** zhdj-* 自己的写法（有的还要把 token 塞进 params） */
  | 'custom'

/**
 * 响应包络的处理方式。**每个实例一条自己的规则，不是"标准 vs 其他"两档。**
 *
 * 全部逐字复刻各实例响应拦截器的原文（出处见下面每一档的括号）。
 * SDK 侧的实现在 `src/http/client.ts` 的 `applyEnvelope()`，测试是
 * `test/http-envelope.test.ts`。
 *
 * | 档 | 实例 | 判据 | 出处 |
 * | --- | --- | --- | --- |
 * | `portal-standard` | 当前归入该档的 13 个实例 | `ret !== 'SUCCESS'` 即失败 | `platform.js` 响应拦截器 |
 * | `smart-layer` | `smart-layer-admin` / `smart-layer-app` | **不看 `ret`**；`code === undefined` 原样放行、`code !== 200` 失败 | `smart-layer-admin.js:49-81` |
 * | `zhdj-sms` | `zhdj-sms` | 先看 `ret`，再看 `code`（**两段，顺序不能换**） | `zhdj-sms.js:34-70` |
 * | `mall-app` | `mall-app` | `Number(code) !== 0` 即失败 | `mall-app.js:15-24` |
 *
 * ## 为什么原来写成"其余一律拒绝"
 *
 * 早先只有 `portal-standard` 一种实现，其余统称 `not-replicated` 并**明确抛错**。
 * 那个拒绝是对的（套错判据会把「后端失败了」读成「成功，data 是 undefined」，静默且难查），
 * 但它把"没做"和"做不了"混成了一句话。用户 2026-09-21 要求**按各实例自己的规则复刻**，
 * 于是这一档拆开成上面四条 —— 判据一律以**页面上真实发生的行为**为准。
 *
 * 三条容易写错的细节，都写在 `applyEnvelope()` 的注释里：
 * 1. `smart-layer` 那两档**完全不看 `ret`**（它们用 `code`）。
 * 2. `zhdj-sms` 的 `ret` 分支里，`code === 200` 时**不抛**，会继续往下走。
 * 3. `smart-layer` 返回的是 `data ? data : pages` —— **`pages` 是第二选择**，
 *    不是"没有 data 就返回 undefined"。
 */
export type HttpResponseEnvelope =
  | 'portal-standard'
  | 'smart-layer'
  | 'zhdj-sms'
  | 'mall-app'

export type HttpInstanceProfile = {
  /** 稳定 ID。同时是能力定义里 `entryPoints[].httpInstance` 的取值 */
  id: string
  /** Portal 源码里的定义位置（file:line），复核的唯一依据 */
  source: string
  /**
   * baseURL 的取值来源。
   * `none` 表示该实例没有 baseURL——url 里自己拼（zhdj-app-lay）或本来就不需要（build-version）。
   */
  baseUrl: { kind: 'env'; env: string } | { kind: 'none' }
  urlRewrite: HttpUrlRewrite
  /**
   * 请求拦截器把「每页条数」参数改成的名字。`null` = 不改名。
   *
   * 全局默认参数名是 `pageSize`（`app/portal/main.js:48` 覆写了
   * `common/libs/renren/config.js:11` 的 `limit`），所以**只有 sale.js 会改成 `limit`**
   * （`sale.js:38-41` 改 params、`48-51` 改 data）。
   */
  pageSizeParamAlias: string | null
  headerMode: HttpHeaderMode
  /** 除 `generateHttpHeaders` 之外固定追加的头（`product.js:21` 的 `devicetype: 'PC'`） */
  extraHeaders: Readonly<Record<string, string>>
  /**
   * GET 参数序列化方式。
   * `qs-in-interceptor` = 拦截器自己用 qs 把 params 拼进 url（**只有 platform.js**，
   * `platform.js:53-84`）；其余实例交给 axios 的默认序列化器，两者对
   * `null` / 数组 / 嵌套对象的结果**不一样**。
   */
  querySerialization: 'qs-in-interceptor' | 'axios-default'
  /**
   * 浏览器侧 `withCredentials`（决定发不发 cookie）。
   * **只记录、不生效**：无头下 Node 没有 cookie jar，`src/http/client.ts` 刻意不转发它。
   */
  withCredentials: boolean
  responseEnvelope: HttpResponseEnvelope
  /** GET params 里是否也塞一份 token（smart-layer-* 与 zhdj-* 独有） */
  tokenInParams: boolean
}

/**
 * Portal 前端的全部 http 实例，按源码 `app/portal/utils/http/*.js` 逐个落下来。
 *
 * **为什么是一个手写表而不是运行时扫源码**：SDK 是发给别人用的包，运行时没有
 * Portal 仓库可扫。表本身由 `test/http-instances.test.ts` 在有源码时**重新推导并逐字段比对**
 * （`PORTAL_REPO` 指向的仓库存在时），所以它不是"写死的常量"，而是"被源码钉住的快照"。
 */
export const HTTP_INSTANCES: readonly HttpInstanceProfile[] = [
  {
    id: 'platform',
    source: 'app/portal/utils/http/platform.js:8-12',
    baseUrl: { kind: 'env', env: 'VITE_ZHDJ_PLATFORM_API' },
    urlRewrite: {
      kind: 'prepend-absolute',
      add: '/admin-api',
      // 逐字复刻 `platform.js:18-20` 的三个否定项。**别加** `/admin-shop-api` /
      // `/admin-crm-api` / `/mall-api`：它们不是路径，是同 host 另三个实例的 baseURL
      // （理由与实测见上面的类型文档，以及 `test/http-instance-prefix.test.ts`）。
      passthrough: ['/admin-api', '/adminmanage-api', '/mall-manage-api'],
    },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'qs-in-interceptor',
    withCredentials: true,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'sale',
    source: 'app/portal/utils/http/sale.js:8-12',
    baseUrl: { kind: 'env', env: 'VITE_SHOP_ADMIN_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: 'limit',
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: true,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'product',
    source: 'app/portal/utils/http/product.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_FM_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: { devicetype: 'PC' },
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'product-no-token',
    source: 'app/portal/utils/http/product-no-token.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_FM_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'crm',
    source: 'app/portal/utils/http/crm.js:8-12',
    baseUrl: { kind: 'env', env: 'VITE_CRM_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'platform-mall-admin',
    source: 'app/portal/utils/http/platform-mall-admin.js:10-14',
    baseUrl: { kind: 'env', env: 'VITE_MALL_ADMIN_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: true,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'platform-mall-mes',
    source: 'app/portal/utils/http/platform-mall-mes.js:6-9',
    baseUrl: { kind: 'env', env: 'VITE_MES_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'minimal',
    extraHeaders: { 'Content-Type': 'application/json;charset=utf-8' },
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'mall-app',
    source: 'app/portal/utils/http/mall-app.js:8-11',
    baseUrl: { kind: 'env', env: 'VITE_MALL_APP_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'generate-http-headers',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'mall-app',
    tokenInParams: false,
  },
  {
    id: 'smart-layer-admin',
    source: 'app/portal/utils/http/smart-layer-admin.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_SMART_LAYER_ADMIN_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'minimal',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'smart-layer',
    tokenInParams: true,
  },
  {
    id: 'smart-layer-app',
    source: 'app/portal/utils/http/smart-layer-app.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_SMART_LAYER_APP_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'minimal',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'smart-layer',
    tokenInParams: true,
  },
  {
    id: 'zhdj-admin',
    source: 'app/portal/utils/http/zhdj-admin.js:9-12,15-17',
    baseUrl: { kind: 'env', env: 'VITE_SMART_LAYER_ADMIN_API' },
    urlRewrite: { kind: 'append-suffix', suffix: '.lay', whenFlag: 'isLay' },
    pageSizeParamAlias: null,
    headerMode: 'minimal',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: true,
  },
  {
    id: 'zhdj-app',
    source: 'app/portal/utils/http/zhdj-app.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_ZHDJ_CMS_APP_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'custom',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
  {
    id: 'zhdj-app-lay',
    source: 'app/portal/utils/http/zhdj-app-lay.js:11-22',
    baseUrl: { kind: 'none' },
    // 建实例时就把 Content-Type 定成表单式（zhdj-app-lay.js:19-21）
    urlRewrite: { kind: 'append-suffix', suffix: '.lay', whenFlag: null },
    pageSizeParamAlias: null,
    headerMode: 'custom',
    extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: true,
  },
  {
    id: 'zhdj-cms',
    source: 'app/portal/utils/http/zhdj-cms.js:11-18,107',
    baseUrl: { kind: 'env', env: 'VITE_SMART_LAYER_ADMIN_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'custom',
    extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: true,
  },
  {
    // 同一个文件里的第二个实例：`createHttp({ lay: true })`，导出名是 `httpLay`（zhdj-cms.js:106）。
    // 「一个实例」的单位是**导出的绑定**，不是文件——按文件建表会把它和 `http` 混成一个。
    id: 'zhdj-cms-lay',
    source: 'app/portal/utils/http/zhdj-cms.js:11-18,106',
    baseUrl: { kind: 'env', env: 'VITE_SMART_LAYER_ADMIN_API' },
    urlRewrite: { kind: 'append-suffix', suffix: '.lay', whenFlag: null },
    pageSizeParamAlias: null,
    headerMode: 'custom',
    extraHeaders: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: true,
  },
  {
    id: 'zhdj-sms',
    source: 'app/portal/utils/http/zhdj-sms.js:9-12',
    baseUrl: { kind: 'env', env: 'VITE_ZHDJ_CMS_API' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'minimal',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'zhdj-sms',
    tokenInParams: true,
  },
  {
    id: 'build-version',
    source: 'app/portal/utils/http/build-version.js:3-5',
    baseUrl: { kind: 'none' },
    urlRewrite: { kind: 'none' },
    pageSizeParamAlias: null,
    headerMode: 'custom',
    extraHeaders: {},
    querySerialization: 'axios-default',
    withCredentials: false,
    responseEnvelope: 'portal-standard',
    tokenInParams: false,
  },
]

/**
 * 没声明实例的页面走哪个实例。
 * `app/portal/main.js:42-48`：`setRenrenConfig({ http, ... })` 注入的就是 platform.js 的实例。
 */
export const DEFAULT_HTTP_INSTANCE_ID = 'platform'

let cachedById: Map<string, HttpInstanceProfile> | null = null

function instanceMap (): Map<string, HttpInstanceProfile> {
  if (!cachedById) {
    cachedById = new Map(HTTP_INSTANCES.map((profile) => [profile.id, profile]))
  }
  return cachedById
}

export function getHttpInstance (id: string): HttpInstanceProfile | null {
  return instanceMap().get(id) ?? null
}

// ---------------------------------------------------------------------------
// 页面 → 实例
// ---------------------------------------------------------------------------

/**
 * 一条页面规则。
 *
 * `instance: null` 表示**页面确实声明了实例，但静态推导认不出来**
 * ——例如 `http: someVar`，而 `someVar` 来自某个 composable 的返回值。
 * 这种页面必须由调用方显式指定实例，解析器会拒绝猜。
 *
 * 今天这条表里**没有** `null` 条目：73 处显式声明全都能追到 `utils/http/*.js`
 * 或 `presets/<x>/list.js`。但机制是真的——**而且测试是先证红再钉住的**：
 * 把推导器里 `null` 那条分支并回 `platform` 那条 `continue`，固件用例立刻变红，
 * 合成仓库里那两个页面会**整条从推导结果里消失**。Portal 加一个新写法时，推导器一旦
 * 认不出来就会落到这里，而不是静默退回默认实例。
 *
 * （这条注释曾经写着「有测试钉住」，而写下那一刻那句话是假的——推导器当时根本产不出
 * `null` 条目。2026-09-20 才真正分开这两种情况。留此一行，免得它再变回一句空话。）
 */
export type HttpInstancePageRule = {
  /** 页面路径，与 `module-type` 用的是同一套（menuPath） */
  pagePath: string
  instance: string | null
  /** 推导依据：声明所在的源码位置 */
  source: string
  /** 认不出来时的原因 */
  reason?: string
}

/**
 * 列表请求**不**走全局默认的页面，逐条从源码推导。
 *
 * 表里刻意**不收**显式传 `platform.js` 的页面（共 8 处页面级声明）：
 * 显式传默认实例与不传，线上字节完全一样，收进来只会制造"这条规则有意义"的错觉。
 *
 * 也不收 sub-view / 弹窗组件（如 `.../components/selectItem-only.vue`）：它们不是页面，
 * SDK 的寻址单位是页面路径，收进来永远匹配不上。它们的存在说明**同一次页面操作里
 * 可能有多个实例**，所以实例必须是"逐请求"的输入，不能只当页面属性——见 `src/call.ts`。
 */
export const HTTP_INSTANCE_PAGE_RULES: readonly HttpInstancePageRule[] = [
  { pagePath: '/dashboard/platform/market/market/todo/list', instance: 'crm', source: 'app/portal/views/dashboard/platform/market/market/todo/list.vue:52' },
  { pagePath: '/dashboard/platform/market/user-log/list', instance: 'platform-mall-mes', source: 'app/portal/views/dashboard/platform/market/user-log/list.vue:70' },
  { pagePath: '/dashboard/sale/customer-service/after-sale/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/customer-service/after-sale/list.vue:67' },
  { pagePath: '/dashboard/sale/customer-service/after-sale-evaluation/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/customer-service/after-sale-evaluation/list.vue:58' },
  { pagePath: '/dashboard/sale/customer-service/appeal/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/customer-service/appeal/list.vue:87' },
  { pagePath: '/dashboard/sale/customer-service/evaluation/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/customer-service/evaluation/list.vue:104' },
  { pagePath: '/dashboard/sale/customer-service/evaluation-overview/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/customer-service/evaluation-overview/list.vue:44' },
  { pagePath: '/dashboard/sale/goods/additional-service/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/additional-service/list.vue:49' },
  { pagePath: '/dashboard/sale/goods/classification/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/classification/list.vue:70' },
  { pagePath: '/dashboard/sale/goods/distribution/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/distribution/list.vue:69' },
  { pagePath: '/dashboard/sale/goods/image/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/image/list.vue:122' },
  { pagePath: '/dashboard/sale/goods/manage/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/manage/list.vue:221' },
  { pagePath: '/dashboard/sale/goods/market-list/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/market-list/list.vue:44' },
  { pagePath: '/dashboard/sale/goods/purchase-permission/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/purchase-permission/list.vue:80' },
  { pagePath: '/dashboard/sale/goods/sales-area/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/goods/sales-area/list.vue:90' },
  { pagePath: '/dashboard/sale/job/schedule-job/list', instance: 'crm', source: 'app/portal/views/dashboard/sale/job/schedule-job/list.vue:110' },
  { pagePath: '/dashboard/sale/job/schedule-job-log/list', instance: 'crm', source: 'app/portal/views/dashboard/sale/job/schedule-job-log/list.vue:83' },
  { pagePath: '/dashboard/sale/marketing/activity/gift/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/marketing/activity/gift/list.vue:102' },
  { pagePath: '/dashboard/sale/marketing/charm/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/marketing/charm/list.vue:108' },
  { pagePath: '/dashboard/sale/marketing/coupon/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/marketing/coupon/list.vue:141' },
  { pagePath: '/dashboard/sale/setting/dict/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/setting/dict/list.vue:66' },
  { pagePath: '/dashboard/sale/setting/log/error/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/setting/log/error/list.vue:44' },
  { pagePath: '/dashboard/sale/setting/log/login/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/setting/log/login/list.vue:58' },
  { pagePath: '/dashboard/sale/setting/log/operation/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/setting/log/operation/list.vue:63' },
  { pagePath: '/dashboard/sale/settlement/detail/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/settlement/detail/list.vue:47' },
  { pagePath: '/dashboard/sale/settlement/summary/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/settlement/summary/list.vue:47' },
  { pagePath: '/dashboard/sale/shop/apply-cat/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/shop/apply-cat/list.vue:45' },
  { pagePath: '/dashboard/sale/shop/enter-store/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/shop/enter-store/list.vue:34' },
  { pagePath: '/dashboard/sale/shop/message/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/shop/message/list.vue:227' },
  { pagePath: '/dashboard/sale/shop/qualification/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/shop/qualification/list.vue:100' },
  { pagePath: '/dashboard/sale/shop/rule/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/shop/rule/list.vue:41' },
  { pagePath: '/dashboard/sale/sys/dict/list', instance: 'crm', source: 'app/portal/views/dashboard/sale/sys/dict/list.vue:104' },
  { pagePath: '/dashboard/sale/trade/aftersales-refund/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/trade/aftersales-refund/list.vue:89' },
  { pagePath: '/dashboard/sale/trade/logistic-template/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/trade/logistic-template/list.vue:60' },
  { pagePath: '/dashboard/sale/trade/logistics-company/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/trade/logistics-company/list.vue:29' },
  { pagePath: '/dashboard/sale/trade/order-cancel/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/trade/order-cancel/list.vue:65' },
  { pagePath: '/dashboard/sale/trade/user-deposit-log/list', instance: 'sale', source: 'app/portal/views/dashboard/sale/trade/user-deposit-log/list.vue:99' },
  // product 系：调用点**看不到任何 http**，实例被 preset 包装写死在
  // common/libs/renren/presets/product/list.js:3 里。前一轮生成器的正则漏掉了这一整类。
]

let cachedRules: Map<string, HttpInstancePageRule> | null = null

function rules (): Map<string, HttpInstancePageRule> {
  if (!cachedRules) {
    cachedRules = new Map(HTTP_INSTANCE_PAGE_RULES.map((rule) => [rule.pagePath, rule]))
  }
  return cachedRules
}

/** 仅测试用：注入规则表（用来验"声明认不出来"这条路径）。传 null 恢复内置表。 */
export function __setHttpInstancePageRulesForTest (
  rules: readonly HttpInstancePageRule[] | null,
): void {
  cachedRules = new Map((rules ?? HTTP_INSTANCE_PAGE_RULES).map((rule) => [rule.pagePath, rule]))
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export type HttpInstanceResolution =
  | {
      kind: 'resolved'
      instance: HttpInstanceProfile
      matchedBy: 'declared' | 'page-rule' | 'global-default'
    }
  | {
      kind: 'unresolved'
      pagePath: string | null
      reason: 'unknown-instance-id' | 'page-declares-unresolvable-instance'
      detail: string
    }

/**
 * 解析「这次请求走哪个实例」。
 *
 * 优先级：请求级显式声明 → 页面规则 → 全局默认。
 * 页面路径按 `normalizeMenuEntryPath` 归并后再查表，与 module-type 用同一套口径
 * （详情页归回它所属的列表页）。
 */
export function resolveHttpInstance (input: {
  pagePath?: string | null
  declared?: string | null
}): HttpInstanceResolution {
  const declared = input.declared
  if (declared) {
    const profile = getHttpInstance(declared)
    if (profile) {
      return { kind: 'resolved', instance: profile, matchedBy: 'declared' }
    }
    return {
      kind: 'unresolved',
      pagePath: input.pagePath ?? null,
      reason: 'unknown-instance-id',
      detail: `未知的 http 实例 id：${declared}（已知：${HTTP_INSTANCES.map((p) => p.id).join(' / ')}）`,
    }
  }

  const pagePath = input.pagePath
  if (pagePath) {
    const key = normalizeMenuEntryPath(pagePath)
    const table = rules()
    const rule = table.get(key) ?? table.get(pagePath)
    if (rule) {
      if (rule.instance === null) {
        return {
          kind: 'unresolved',
          pagePath: key,
          reason: 'page-declares-unresolvable-instance',
          detail:
            `${rule.source} 声明了列表请求的 http 实例，但静态推导认不出来` +
            `${rule.reason ? `（${rule.reason}）` : ''}。` +
            '这个页面必须由调用方显式指定 httpInstance——猜错的后果是打到错的 URL，不是少一个头。',
        }
      }
      const profile = getHttpInstance(rule.instance)
      if (!profile) {
        return {
          kind: 'unresolved',
          pagePath: key,
          reason: 'page-declares-unresolvable-instance',
          detail: `${rule.source} 指向了表里没有的实例 id：${rule.instance}`,
        }
      }
      return { kind: 'resolved', instance: profile, matchedBy: 'page-rule' }
    }
  }

  const fallback = getHttpInstance(DEFAULT_HTTP_INSTANCE_ID)
  /* istanbul ignore next —— 默认实例一定在表里；这是给表被改坏时留的硬失败 */
  if (!fallback) {
    return {
      kind: 'unresolved',
      pagePath: pagePath ?? null,
      reason: 'unknown-instance-id',
      detail: `默认实例 ${DEFAULT_HTTP_INSTANCE_ID} 不在实例表里`,
    }
  }
  return { kind: 'resolved', instance: fallback, matchedBy: 'global-default' }
}

/** 解析不到时抛出。**失败关闭**：宁可拒绝发请求，也不打到错的 URL。 */
export class HttpInstanceResolutionError extends Error {
  readonly pagePath: string | null
  readonly reason: 'unknown-instance-id' | 'page-declares-unresolvable-instance' | 'missing-base-url'

  constructor (init: {
    pagePath: string | null
    reason: HttpInstanceResolutionError['reason']
    detail: string
  }) {
    super(init.detail)
    this.name = 'HttpInstanceResolutionError'
    this.pagePath = init.pagePath
    this.reason = init.reason
  }
}

/**
 * 请求级规则的应用。**纯函数**，不碰 axios，便于单独测。
 *
 * `flags` 是请求级的开关（对应前端写在 axios config 上的 `isLay` 之类）。
 * 无头下调用方用 `PortalRequestConfig.httpFlags` 给。
 */
export function applyUrlRewrite (
  rewrite: HttpUrlRewrite,
  url: string,
  flags?: Readonly<Record<string, boolean>> | undefined,
): string {
  switch (rewrite.kind) {
    case 'none':
      return url
    case 'prepend-absolute': {
      if (!url.startsWith('/')) return url
      if (rewrite.passthrough.some((prefix) => url.startsWith(prefix))) return url
      return `${rewrite.add}${url}`
    }
    case 'append-suffix': {
      if (rewrite.whenFlag && flags?.[rewrite.whenFlag] !== true) return url
      if (url.endsWith(rewrite.suffix)) return url
      return `${url}${rewrite.suffix}`
    }
  }
}

/**
 * 把「每页条数」参数改成实例要求的名字。
 *
 * 复刻 `sale.js:38-41`（params）与 `48-51`（data）：只在**原名存在且不是 undefined**
 * 时才改名，改完删掉原名（含 `data` 的分支）。
 */
export function applyPageSizeAlias<T extends Record<string, unknown>> (
  alias: string | null,
  container: T,
): T {
  if (!alias) return container
  if (container.pageSize === undefined) return container
  const next = { ...container, [alias]: container.pageSize } as T & Record<string, unknown>
  delete next.pageSize
  return next as T
}
