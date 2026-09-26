/**
 * **第三批基础能力 · 其一：企业与租户上下文**（`base-tenant-*`）。
 *
 * Portal 刷新时 `runLegacyFullInitTasks`（`app/portal/utils/router/session.js:35-59`）的**串行 4 步**里
 * 有 2 步是这一族（`docs/base-capabilities.md` §2.1 的 #4 / #5）：
 *
 * | # | 接口 | 用途 | SDK 现状 |
 * | --- | --- | --- | --- |
 * | 4 | GET `/admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=1&pageSize=200` | 用户可见企业列表 | **完全没有能力入口** |
 * | 5 | GET `/admin-api/system/tenant/get?id={tenantId}` | 本企业开通了哪些系统 | **完全没有能力入口** |
 *
 * 为什么第三批挑它，按派单给的三条标准逐条对：
 *
 * 1. **别的能力依赖它** —— `tenant-system` 的 `useSystem` 决定「这个账号能用哪些模块」；
 *    它同时是会话基础数据里两个 `critical: true` 项之一
 *    （`src/session/base-data.ts`：`tenant-context` 是 critical，且 `tenant-system` `deps` 它）。
 *    也就是说：**SDK 早就要求每个会话先把这份数据拉下来，却从没让 AI 看到过它。**
 * 2. **是刷新时必打的「外壳」接口** —— 见上表，串行 4 步里的第 1、2 步（`[源码]`）。
 *    实测（2026-09-20，测试环境，租户 1，`smoke/read-base-tenant.mjs`）：企业列表
 *    **6 家 / 3,784 B / 405 ms**；单企业详情 **263 B / 195 ms**。
 * 3. **契约清晰、能只读验证** —— 两条都是纯 GET、无参数歧义（列表只有分页、详情只有一个 id），
 *    本文件的每个数字都是实测。
 *
 * 它属于「**已经有了数据、只差一个能力入口**」那一类，与第二批的 `base-user-info` 同形
 * （那个也是把会话里已有的 `user-basic` 读出来）。省下来的不是请求次数，是**接线方要不要自己写一遍归一化**。
 *
 * ---------------------------------------------------------------------------------------
 * 一、敏感字段：`identityNumber` / `identityImg` / `contactMobile` 必须在出口处丢掉
 * ---------------------------------------------------------------------------------------
 *
 * `getUserTenantsByPage` 的原始对象实测有 **21 个字段**，其中这三个是实名/联系信息
 * （下面的"非空几条"是本轮 6 家企业上的实测分布，`smoke/read-base-tenant.mjs` 每次都会重新打印）：
 *
 * | 字段 | 实测分布 | 是什么 |
 * | --- | --- | --- |
 * | `identityNumber` | 6 条上都有这个键，**非空 1 条**（18 位） | **身份证号** |
 * | `identityImg` | 6 条上都有，**非空 5 条**（约 185 字符） | 证件照 URL（`a:2:{…}` 序列化串） |
 * | `contactMobile` | 6 条上都有，**非空 5 条**（11 位） | 联系人手机号 |
 *
 * ⚠️ 一条**自我纠错**：本节初稿只看了列表里第一条，写下"本账号 6 家里 1 家带值"。
 * 实测分布出来后才知道那个说法只对 `identityNumber` 成立——`identityImg` 与 `contactMobile`
 * 是 **5/6 非空**。数字以本轮实测为准，脚本每跑一次都会重打一遍分布。
 *
 * 这与第二批 `sys/user/info` 带 `password2` / `salt` 是同一类问题（`docs/base-capabilities.md` §4.4），
 * 处理方式也照抄第二批：**白名单**，不是黑名单。
 *
 * | 视图 | 白名单字段 | 裁掉的（点名） |
 * | --- | --- | --- |
 * | `TenantSummary` | 9 个（见类型） | `identityNumber`、`identityImg`、`contactMobile`、`nickname`、`headImg`、`contactUserId`、`isChinaResident`、`packageId`、`creator`、`updater`、`updateTime`、`deleted` |
 * | `TenantDetail` | 9 个（见类型） | `contactMobile`、`contactName` |
 *
 * `TenantSummary` 的 9 个是从**原始 21 个**里挑的，其中两个**改了名**（`useSystem` → `systems`、
 * `createTime` → `createDate`）——所以按"原始键名"数只会数到 7 个，那不是漏字段。
 *
 * **为什么白名单而不是黑名单**：后端将来往这个对象里加一个敏感字段时，黑名单要求"每次记得来加一条"，
 * 漏一次就是一次外流，且**不会有任何测试变红**；白名单的失败方向相反——最多暂时取不到，看得见、可修。
 * `test/base-tenant.test.ts` 里拿带 `identityNumber` / `contactMobile` 的真机形状夹具各锁了一条。
 *
 * ⚠️ 一个如实说明：本文件裁掉的是**企业联系人/实名的联系方式**，不是登录凭据。
 * 保留 `contactName`（实测租户 1 的值就是企业名「沃德辰龙」，不是人名）。
 *
 * ---------------------------------------------------------------------------------------
 * 二、缓存：实例内 TTL + 单飞（**不挂会话键**，并且这里有个反直觉的理由）
 * ---------------------------------------------------------------------------------------
 *
 * 直觉上该复用会话里的 `tenant-context`（它装的就是这个接口的返回）。**本文件刻意不复用**，
 * 理由是那个会话项**不是全量**：`src/session/base-data.ts` 的 `tenant-context.load` 是
 * 「**命中即停**」——找到当前租户就 `return`，不再翻后面的页（注释写着"命中即停，不必翻完 100 页"）。
 * 拿它当「我属于哪些企业」会**静默少报几家**：当前租户排在第 1 页第 3 条时，第 4 条以后就不会出现，
 * 而返回值看起来完全正常。这正是本仓库最怕的那种失败形态，所以宁可多打一次 3.8 KB 的 GET。
 *
 * 缓存键与切片：只有 `tenant-list` 一个（列表，最多 `TENANT_FETCH_MAX_PAGES` 页）。
 * 切片**不并进 `limit`**——`limit` 是出口裁剪，不影响拉什么；并进去会让 `limit=5` 与 `limit=20`
 * 各打一遍同一个请求。`keyword` 同理（本地过滤，不是服务端参数）。
 *
 * ⚠️ **`getTenant`（详情）刻意不缓存**：它按 id 查、263 B / 195 ms，为它多开一族
 * `tenant-detail:<id>` 切片键换不来什么，却让"这家企业的账号数变了没有"多一层陈旧窗口。
 * 列表缓存是因为它是**翻页 + 每次调用都可能重问**的那一份。这个不对称是有意的，测试里钉了。
 *
 * TTL 取 `BASE_TENANT_CACHE_TTL_MS`（30 分钟），与 `BASE_SHELL_CACHE_TTL_MS` /
 * `DEFAULT_ABSOLUTE_TTL_MS` 同值；测试里钉死了这个等式。
 *
 * ---------------------------------------------------------------------------------------
 * 三、体积：每个入口都有硬上限，不提供 `listAll`
 * ---------------------------------------------------------------------------------------
 *
 * 本账号只有 **6 家**企业（`total: 6`），但**不能按这个数字设计上限**：
 * 后端这个接口本身就是给"跨企业切换"用的，一个集团账号可能有很多家。
 * 所以：内部按 `TENANT_PAGE_SIZE = 200`（与 `src/session/base-data.ts` 的 `TENANT_LIST_PAGE_SIZE`
 * 和 `system.js:600-606` 的 loopFetch 配置同值）翻页，**最多 `TENANT_FETCH_MAX_PAGES = 5` 页**
 * （= 最多 1000 家），出口再按 `limit` 切（默认 20 / 上限 100）。
 *
 * ⚠️ **实测到的一个坑，写进参数描述**：这个接口的 `pageSize=-1` **不是**"全量拉取"，
 * 它返回 `list` 照旧（6 条）但把 **`total` 归零**（实测 `pageSize=-1` → `total: 0`，
 * 而 `pageSize=200` → `total: 6`）。也就是说不光没省事，还**把总数弄丢**了。
 * 本能力不暴露 `pageSize`，所以调用方碰不到它；这条记在这里是为了别有人"顺手加个 pageSize 参数"。
 *
 * ---------------------------------------------------------------------------------------
 * 四、module-type：一律不发（默认）
 * ---------------------------------------------------------------------------------------
 *
 * 两个页面路径都是合成的 `/base-data/*`。规则表里 88 条 prefix + 186 条 paths **全部**以
 * `/dashboard/` 开头，所以 `resolveModuleType()` 对它们一律返回 `null` → 不发这个头
 * （conventions 第 2 条：算不出就不发）。测试里钉死了 `resolveModuleType(两个 path) === null`。
 *
 * **是否真的不敏感，本文件给的是实测结论**：`smoke/read-base-tenant.mjs` 对两个接口各做了
 * **交错四次**的对照（不带 → 带 11 → 不带 → 带 11；判据与理由同 `read-base-shell.mjs` 的
 * `moduleTypeControl`：先确认基线自己稳不稳，再比带/不带）。**实测结果：两条都是
 * "基线稳 + 带/不带 data 完全相同"**（企业列表两次都是 3,784 B，企业详情两次都是 263 B）。
 * 脚本每次跑都会重打这个对照，数字以脚本输出为准。
 *
 * ⚠️ 口径要说清楚：这是"**本账号实测**不敏感"，不是"后端不读这个头"。
 * 需要收窄时由接线方通过 `BaseTenantOptions.moduleType` 显式给——SDK 不猜。
 *
 * ---------------------------------------------------------------------------------------
 * 五、`useSystem` 的数字语义：本能力**只给数字，不贴标签**
 * ---------------------------------------------------------------------------------------
 *
 * `useSystem` 是逗号串（实测租户 1 是 `"1,2,3,4,5,6,10"`）。Portal 的加工只有
 * `split(',').filter().map(Number)`（`app/portal/utils/system.js:678-683`），**它自己也不贴标签**。
 *
 * 前端源码里能查到的映射只有两处，都是当查询参数用的：
 * `components/portal/finance/**` 写死 `useSystem=2`（财务）、
 * `components/portal/supply/**` 写死 `useSystem=5`（供应链）。
 * **其余数字（含 10）与中文名的对应，本单没有找到权威出处**，所以：
 * 返回值里是 `systems: number[]`，本能力**不提供中文标签**——贴错标签比不贴更糟
 * （那是一个看起来完全正常的错值）。要标签的调用方自己去核对。
 *
 * 四件套的其它三件：`docs/base/租户与企业.md`；真实环境只读冒烟 `smoke/read-base-tenant.mjs`；
 * 回归测试 `test/base-tenant.test.ts`。**接线（注册进 `src/capabilities/index.ts` 与两个门面）
 * 由派单方统一做**，本文件不碰任何索引文件。
 */

import { SingleFlight } from '../session/single-flight.js'
import type { BaseDataRequest } from './base-dept-dict-permission.js'
import type { CapabilityDefinition } from './types.js'

// ---------------------------------------------------------------------------
// 合成页面上下文（与第一、二批同一个根，理由见 base-dept-dict-permission.ts）
// ---------------------------------------------------------------------------

/**
 * ⚠️ 下面这几个常量**必须写成单引号字符串字面量**，不能拼模板串——
 * `tools/generate/derive-aliases.mjs:183` 的正则 `const\s+(\w+)\s*=\s*'([^']*)'` 只认单引号。
 * 拼出来的话这些路径解析为 null，能力定义会被**静默跳过**，于是「目录扫到的」与
 * 「应用真正加载的」分叉——那正是 `test/aliases-derived.test.ts` 卡的事。
 */
export const BASE_TENANT_CONTEXT_ROOT = '/base-data'
export const BASE_TENANT_LIST_PATH = '/base-data/tenant-list'
export const BASE_TENANT_DETAIL_PATH = '/base-data/tenant-detail'

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

/** #4：用户可见企业列表（`app/portal/utils/system.js:606-626` `fetchTenantList`） */
export const TENANT_LIST_URL = '/admin-api/hr/system-tenant/getUserTenantsByPage'
/** #5：本企业开通了哪些系统（`app/portal/utils/system.js:673` `fetchTenantSystem`） */
export const TENANT_DETAIL_URL = '/admin-api/system/tenant/get'

/** 与 `src/session/base-data.ts` 的 `TENANT_LIST_PAGE_SIZE`、`system.js:600-606` 的 loopFetch 同值 */
export const TENANT_PAGE_SIZE = 200
/** 最多翻几页。5 × 200 = 最多 1000 家企业，超出部分**如实置 truncated**，不静默吞掉 */
export const TENANT_FETCH_MAX_PAGES = 5

export const TENANT_LIMIT_DEFAULT = 20
export const TENANT_LIMIT_MAX = 100

/** 未挂会话时，实例内缓存的存活时间。与 `DEFAULT_ABSOLUTE_TTL_MS` 同值，测试里钉死 */
export const BASE_TENANT_CACHE_TTL_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------
// 归一化后的形状
// ---------------------------------------------------------------------------

/**
 * 企业列表的一条（**白名单视图**，见文件头第一节）。
 *
 * 没有出现在这个类型里的字段**一定不会被返回**——包括 `identityNumber` 与 `contactMobile`。
 */
export type TenantSummary = {
  id: string
  name: string | null
  /** 简称（实测租户 1 与 name 同值） */
  shortName: string | null
  /** 企业编码，形如 `ZH202400001` */
  code: string | null
  status: number | null
  /** 开通的系统码。原始值是逗号串，这里按 `system.js:678-683` 的规则拆成数字数组（**不贴标签**，见文件头第五节） */
  systems: number[]
  /** 联系人名。实测租户 1 的值是企业名「沃德辰龙」，不是人名 */
  contactName: string | null
  /** 实测是 0/1，这里归一成布尔：它是「这家企业的管理员是不是我」的判据 */
  tenantAdmin: boolean
  createDate: string | null
}

/** 单个企业的详情（**白名单视图**）。字段比列表少：这个接口只回 11 个 */
export type TenantDetail = {
  id: string
  name: string | null
  status: number | null
  website: string | null
  packageId: number | null
  /**
   * 到期时间（字符串，原样保留；本能力**不**判"有没有过期"，那时区/口径没核实）。
   * ⚠️ 实测本账号（租户 1）这个字段是 **null**，`accountCount` 也是 null——别把 null 读成"已过期"
   */
  expireDate: string | null
  accountCount: number | null
  createDate: string | null
  systems: number[]
}

/** 形状不认识时抛它：这是**数据/接线**问题，不是"没有数据" */
export class BaseTenantShapeError extends Error {
  override readonly name = 'BaseTenantShapeError'
  constructor (message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const TENANT_LOOKUP = { capabilityId: 'base-tenant-list', keywordParam: 'keyword' } as const

export const baseTenantCapabilities: CapabilityDefinition[] = [
  {
    id: 'base-tenant-list',
    title: '我属于哪些企业 / 每家开通了哪些系统（基础能力，白名单字段）',
    pagePath: BASE_TENANT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: false,
        description:
          '企业名 / 简称 / 编码的关键字（不区分大小写）。本能力**不强制**关键字：' +
          '实测本账号只有 6 家（total=6），规模有界；但内部仍按 200/页最多翻 5 页，' +
          '超过 1000 家的账号会被 `truncated: true` 如实标出',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description:
          `最多返回几家，默认 ${TENANT_LIMIT_DEFAULT}，上限 ${TENANT_LIMIT_MAX}。` +
          `本能力**内部固定按 pageSize=${TENANT_PAGE_SIZE} 翻页**（最多 ${TENANT_FETCH_MAX_PAGES} 页 = 1000 家），` +
          '不把分页参数暴露给调用方——所以也碰不到这个接口的一个坑：' +
          '实测 `pageSize=-1` 并不会变成全量，它返回的 `list` 照旧，却把 `total` **归零**（1 家企业都不会少，但总数丢了）',
      },
    ],
  },
  {
    id: 'base-tenant-get',
    title: '按 id 取一个企业：开通了哪些系统 / 到期时间（基础能力，白名单字段）',
    pagePath: BASE_TENANT_DETAIL_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'search',
        required: true,
        description:
          '企业 id。⚠️ **必须是数字 id**（实测租户 1 的 id 就是 `1`）：这个接口的 `id` 走的是' +
          '「按主键查」，传企业名会查不到。候选走 base-tenant-list',
        lookup: TENANT_LOOKUP,
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type BaseTenantOptions = {
  request: BaseDataRequest
  /**
   * 这个头默认**不发**（见文件头第四节）。需要把企业上下文收窄到某个模块口径时由接线方显式给。
   */
  moduleType?: number
  /** 实例内缓存的 TTL。默认 `BASE_TENANT_CACHE_TTL_MS`（30 分钟） */
  cacheTtlMs?: number
  /** 注入时钟，测试用（conventions 第 22 条：TTL 不用真实 sleep 测） */
  now?: () => number
}

function clampLimit (value: number | undefined, fallback: number, max: number): number {
  const raw = value === undefined || value === null ? fallback : Math.trunc(Number(value))
  if (!Number.isFinite(raw)) return fallback
  return Math.min(Math.max(1, raw), max)
}

const asString = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value)

const asNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 0/1 的通路归一成布尔。只认 `1` / `true` / `'1'` 三种真值，其余一律 false ——
 * 不做 `Boolean(value)`（那样 `'0'` 与 `'false'` 都会变成 true，是典型的静默反向错误）。
 * 与 `base-shell.ts` 的 `asFlag` 同一实现（两份文件各自持有，是为了不让第三批反过来依赖第二批）。
 */
const asFlag = (value: unknown): boolean => value === 1 || value === true || value === '1'

/**
 * `useSystem` 逗号串 → 数字数组。
 *
 * 前四步**逐条复刻 `app/portal/utils/router/session.js` 下游的
 * `app/portal/utils/system.js:677-683`**：`split(',')` → `filter(e => e !== '')`
 * → `map(e => e.trim())` → `map(Number)`。
 *
 * 第五步 `.filter(Number.isFinite)` 是 **SDK 侧多的一层**（`src/session/base-data.ts` 的
 * `tenant-system` 也是这么写的），它只丢掉 `NaN` —— 也就是 `"1,abc,2"` 这种脏值。
 * 实测真机是 `"1,2,3,4,5,6,10"`，两者结果相同。
 * ⚠️ 注意它**不会**丢掉 0：`Number('')` 是有限值，所以 `"1, ,2"` 在 SDK 与 Portal 两侧
 * 都会得到 `[1, 0, 2]`。这条是如实记录，不是本能力引入的行为。
 */
export function parseUseSystem (value: unknown): number[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .filter((item) => item !== '')
    .map((item) => item.trim())
    .map(Number)
    .filter((system) => Number.isFinite(system))
}

/** 列表的一条 → 白名单视图（见文件头第一节）。这里 `identityNumber` / `contactMobile` 被丢掉 */
function normalizeTenantSummary (raw: unknown): TenantSummary {
  const row = (raw ?? {}) as Record<string, unknown>
  if (row.id === undefined || row.id === null) {
    throw new BaseTenantShapeError(`${TENANT_LIST_URL} 的 list[] 里有一条没有 id`)
  }
  return {
    id: String(row.id),
    name: asString(row.name),
    shortName: asString(row.shortName),
    code: asString(row.code),
    status: asNumber(row.status),
    systems: parseUseSystem(row.useSystem),
    contactName: asString(row.contactName),
    tenantAdmin: asFlag(row.tenantAdmin),
    createDate: asString(row.createTime),
  }
}

function normalizeTenantPage (payload: unknown): { list: TenantSummary[]; total: number } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BaseTenantShapeError(
      `${TENANT_LIST_URL} 期望返回一个对象（含 list / total），收到 ` +
        `${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}`,
    )
  }
  const data = payload as { list?: unknown; total?: unknown }
  const rawList = Array.isArray(data.list) ? data.list : []
  return { list: rawList.map(normalizeTenantSummary), total: asNumber(data.total) ?? rawList.length }
}

/** 详情 → 白名单视图。这里只有 `contactMobile` 被丢掉 */
export function normalizeTenantDetail (payload: unknown): TenantDetail {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BaseTenantShapeError(
      `${TENANT_DETAIL_URL} 期望返回一个对象，收到 ` +
        `${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}`,
    )
  }
  const row = payload as Record<string, unknown>
  if (row.id === undefined || row.id === null) {
    throw new BaseTenantShapeError(`${TENANT_DETAIL_URL} 的返回里没有 id —— 多半是 id 传错了（它按主键查）`)
  }
  return {
    id: String(row.id),
    name: asString(row.name),
    status: asNumber(row.status),
    website: asString(row.website),
    packageId: asNumber(row.packageId),
    expireDate: asString(row.expireTime),
    accountCount: asNumber(row.accountCount),
    createDate: asString(row.createTime),
    systems: parseUseSystem(row.useSystem),
  }
}

/**
 * 造这批企业/租户能力的实现。
 *
 * 接线方按门面形态注入请求函数（单用户传 `(config) => call(PATH, config)`，
 * 多用户传这一份会话的 `call`）。本能力**不需要** session：见文件头第二节的说明。
 */
export function createBaseTenant (options: BaseTenantOptions) {
  const { request } = options
  const ttlMs = options.cacheTtlMs ?? BASE_TENANT_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const moduleType = options.moduleType

  const slices = new Map<string, { source: unknown; index: unknown; at: number }>()
  const flight = new SingleFlight<unknown>()
  let cacheGeneration = 0

  /** 统一把 moduleType 注入请求（默认不发；只有接线方显式给了才带） */
  const send = <T>(config: { url: string; method: 'get'; params?: unknown }): Promise<T> =>
    request<T>(moduleType === undefined ? config : { ...config, moduleType })

  /**
   * 取一份带缓存的载荷。命中未过期缓存时**一次请求都不发**；并发由单飞合并。
   * `source` 引用相同就复用已建好的归一化结果。
   */
  async function loadSlice<T> (
    sliceKey: string,
    fetchPayload: () => Promise<unknown>,
    build: (payload: unknown) => T,
  ): Promise<T> {
    const hit = slices.get(sliceKey)
    if (hit && now() - hit.at < ttlMs) {
      return hit.index as T
    }
    const generation = cacheGeneration
    const source = await flight.run(sliceKey, fetchPayload)
    if (hit && hit.source === source) {
      hit.at = now()
      return hit.index as T
    }
    const index = build(source)
    if (generation === cacheGeneration) {
      slices.set(sliceKey, { source, index, at: now() })
    }
    return index
  }

  type TenantIndex = {
    tenants: TenantSummary[]
    /** 服务端第一页给的 total。⚠️ 不要拿 `tenants.length` 当 total（见文件头第三节的 pageSize=-1 坑） */
    total: number
    pages: number
    /** 页数用尽且最后一页是满的 —— 服务端还有没取到的企业 */
    fetchTruncated: boolean
  }

  /**
   * 翻页取企业列表（最多 `TENANT_FETCH_MAX_PAGES` 页）。**与出口的 `limit` / `keyword` 无关**，
   * 所以切片键不带它们（见文件头第二节）。
   */
  const loadTenants = (): Promise<TenantIndex> =>
    loadSlice(
      'tenant-list',
      async () => {
        const tenants: TenantSummary[] = []
        let total = 0
        let pages = 0
        let lastPageFull = false

        for (let pageNo = 1; pageNo <= TENANT_FETCH_MAX_PAGES; pageNo += 1) {
          // pageSize 固定成 200（复刻 loopFetch 配置）：本能力不暴露它，
          // 于是调用方碰不到那个会把 total 归零的 pageSize=-1（见文件头第三节）
          const payload = await send<unknown>({
            url: TENANT_LIST_URL,
            method: 'get',
            params: { pageNo, pageSize: TENANT_PAGE_SIZE },
          })
          const page = normalizeTenantPage(payload)
          pages = pageNo
          if (pageNo === 1) total = page.total
          tenants.push(...page.list)
          lastPageFull = page.list.length >= TENANT_PAGE_SIZE
          if (!lastPageFull) break
        }

        return { tenants, total, pages, fetchTruncated: lastPageFull }
      },
      (payload) => payload as TenantIndex,
    )

  return {
    /** 丢掉实例内缓存。企业信息变了、或要强制拿最新时用 */
    invalidate (slice?: 'tenant-list'): void {
      cacheGeneration += 1
      if (slice === undefined) {
        slices.clear()
        flight.clear()
        return
      }
      slices.delete(slice)
      flight.forget(slice)
    },

    /**
     * 我属于哪些企业。**只读**。按名称/简称/编码过滤（**本地**过滤，不是服务端参数）。
     *
     * 返回的是白名单视图（`TenantSummary`）：原始响应里的 `identityNumber`（身份证号）、
     * `identityImg`（证件照 URL）与 `contactMobile` **一定不在返回值里**。
     */
    async listTenants (query?: { keyword?: string; limit?: number }): Promise<{
      tenants: TenantSummary[]
      total: number
      matched: number
      pages: number
      truncated: boolean
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      const limit = clampLimit(query?.limit, TENANT_LIMIT_DEFAULT, TENANT_LIMIT_MAX)

      const index = await loadTenants()
      const hit = keyword === ''
        ? index.tenants
        : index.tenants.filter(
            (tenant) =>
              (tenant.name ?? '').toLowerCase().includes(keyword) ||
              (tenant.shortName ?? '').toLowerCase().includes(keyword) ||
              (tenant.code ?? '').toLowerCase().includes(keyword),
          )

      return {
        // **出口必须交出新建的对象**：直接给缓存里那一份的话，调用方随手改一个 `tenant.name`
        // 就把缓存污染了，下一个调用方会拿到改过的数据 —— 那种错查起来极其费劲。
        // `systems` 是数组，也要拷（浅拷对象会让两个调用方共享同一个数组）。
        tenants: hit.slice(0, limit).map((tenant) => ({ ...tenant, systems: [...tenant.systems] })),
        total: index.total,
        matched: hit.length,
        pages: index.pages,
        // 两种"被截断"都算：服务端还有没翻到的页，或本地按 limit 切掉了。
        // 合成一个信号是刻意的——调用方要判断的只有"这份列表全不全"。
        truncated: index.fetchTruncated || hit.length > limit,
      }
    },

    /**
     * 按 id 取一个企业：开通了哪些系统、到期时间、账号数。**只读**。
     *
     * ⚠️ 这个接口**按主键查**，`id` 必须是数字 id；传企业名查不到。
     * 候选从 `listTenants()` 拿（能力定义里的 `lookup` 指的就是它）。
     */
    async getTenant (query: { id: number | string }): Promise<TenantDetail> {
      const raw = query?.id
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return Promise.reject(
          new Error(
            'getTenant 的 id 必填。⚠️ 这个接口按主键查，传企业名查不到；' +
              '先用 listTenants() 拿 id（实测本账号 6 家，租户 1 的 id 就是 1）。',
          ),
        )
      }
      const id = String(raw).trim()
      const payload = await send<unknown>({
        url: TENANT_DETAIL_URL,
        method: 'get',
        params: { id },
      })
      return normalizeTenantDetail(payload)
    },
  }
}

export type BaseTenantCapability = ReturnType<typeof createBaseTenant>
