/**
 * 第三批基础能力·其一（企业与租户上下文）的回归测试。
 *
 * 与前三批同样的取向：**刻意不走 `createPortalHeadless`**。本文件同批不动
 * `src/capabilities/index.ts` 与两个门面（接线由派单方统一做），所以测试直接注入请求函数——
 * 这样测的正好是能力自己的契约，不夹带门面的接线。
 *
 * 四条最要紧的断言（也是"改坏了会红"的那几条）：
 *
 * 1. **`identityNumber` / `identityImg` / `contactMobile` 绝不出现在返回值里**（列表与详情两个出口各一条）。
 *    这是唯一一条"错了也**不会**有别的症状"的断言——所以被刻意拆成两条，而不是合成一条。
 * 2. **翻页上限真的生效**：5 页写满时只发 5 次请求、`truncated` 为 true。
 *    写错的话会变成"静默只取前 200 家"，而返回值看起来完全正常。
 * 3. **`total` 取服务端的那个字段，不是 `tenants.length`** —— 实测 `pageSize=-1` 会把 `total` 归零，
 *    两者不是一回事。
 * 4. **缓存切片键不并进 `limit` / `keyword`**：`limit=1` 与 `limit=3` 只能打一次网络请求。
 *    并进去的话行为仍"对"，只是每次换 limit 都重新拉一遍——那正是要被钉住的浪费。
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_TENANT_CACHE_TTL_MS,
  BASE_TENANT_CONTEXT_ROOT,
  BASE_TENANT_DETAIL_PATH,
  BASE_TENANT_LIST_PATH,
  BaseTenantShapeError,
  baseTenantCapabilities,
  createBaseTenant,
  parseUseSystem,
  TENANT_DETAIL_URL,
  TENANT_FETCH_MAX_PAGES,
  TENANT_LIMIT_DEFAULT,
  TENANT_LIMIT_MAX,
  TENANT_LIST_URL,
  TENANT_PAGE_SIZE,
  type BaseTenantOptions,
} from '../src/capabilities/base-tenant.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { DEFAULT_ABSOLUTE_TTL_MS } from '../src/session/store.js'

// ---------------------------------------------------------------------------
// 夹具：形状取自真机（`smoke/read-base-tenant.mjs` 实测），**值全部是编的**
// ---------------------------------------------------------------------------

type RecordedCall = { url: string; method: string; params?: unknown; moduleType?: number }

/**
 * 企业列表的一条。**逐字段照抄真机的 21 个字段**——包括那三个绝不能外流的。
 *
 * ⚠️ `identityNumber` 的值是**假的**（真机那份是真实身份证号，本仓库不留）。
 * 形状（18 位数字串）与真机一致。
 */
const TENANT_RAW = {
  id: 1,
  name: '某某辰龙',
  code: 'ZH202400001',
  contactName: '某某辰龙',
  contactMobile: '',
  nickname: null,
  headImg: null,
  shortName: '某某辰龙',
  contactUserId: null,
  isChinaResident: true,
  identityNumber: '110226199001011234',
  identityImg: '',
  useSystem: '1,2,3,4,5,6,10',
  packageId: 1,
  status: 0,
  creator: 1,
  createTime: '2024-04-19 16:07:48',
  updater: 18243,
  updateTime: '2026-06-25 18:34:24',
  deleted: false,
  tenantAdmin: 0,
}

const TENANT_RAW_SECOND = {
  ...TENANT_RAW,
  id: 7,
  name: '某某博创',
  shortName: '某某博创',
  code: 'ZH202400007',
  // 真机上 6 家里只有 1 家带证件号 —— 这条夹具**带值**，用来确认"带值的那家也被裁了"
  identityNumber: '110226198001019999',
  contactMobile: '13800000000',
  useSystem: '1,2',
  tenantAdmin: 1,
}

const TENANT_PAGE = {
  list: [TENANT_RAW, TENANT_RAW_SECOND],
  total: 6,
  summary: null,
  summaryRows: null,
}

/** 详情：真机只有 11 个字段 */
const TENANT_DETAIL_RAW = {
  id: 1,
  name: '某某辰龙',
  contactName: '某某辰龙',
  contactMobile: '13900000000',
  status: 0,
  website: null,
  packageId: 1,
  expireTime: '2030-01-01 00:00:00',
  accountCount: 900,
  createTime: '2024-04-19 16:07:48',
  useSystem: '1,2,3,4,5,6,10',
}

/** 列表视图应该**恰好**是这 9 个键 —— 多一个就说明白名单被放开了 */
const TENANT_SUMMARY_KEYS = [
  'id', 'name', 'shortName', 'code', 'status', 'systems', 'contactName', 'tenantAdmin', 'createDate',
]

const TENANT_DETAIL_KEYS = [
  'id', 'name', 'status', 'website', 'packageId', 'expireDate', 'accountCount', 'createDate', 'systems',
]

// ---------------------------------------------------------------------------
// 测试桩（与 test/base-shell.test.ts 同形）
// ---------------------------------------------------------------------------

type Routes = Record<string, unknown> | ((config: RecordedCall) => unknown)

function makeTenant (options: {
  routes?: Routes
  cacheTtlMs?: number
  now?: () => number
  moduleType?: number
} = {}) {
  const calls: RecordedCall[] = []
  const routes: Routes = options.routes ?? {}

  const request = <T>(config: RecordedCall): Promise<T> => {
    calls.push(config)
    const route = typeof routes === 'function' ? routes(config) : routes[config.url]
    if (route === undefined) {
      return Promise.reject(new Error(`测试桩没有配 ${config.url} 这条路由`))
    }
    const value = typeof route === 'function' ? (route as () => unknown)() : route
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as T)
  }

  const tenant = createBaseTenant({
    request: request as unknown as BaseTenantOptions['request'],
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.moduleType === undefined ? {} : { moduleType: options.moduleType }),
  })

  return { tenant, calls }
}

function defaultRoutes (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [TENANT_LIST_URL]: TENANT_PAGE,
    [TENANT_DETAIL_URL]: TENANT_DETAIL_RAW,
    ...overrides,
  }
}

const callsOf = (calls: RecordedCall[], url: string) => calls.filter((call) => call.url === url)

// ---------------------------------------------------------------------------

describe('能力定义：两个入口齐全、全部只读' as string, () => {
  it('两个能力 id 齐全且唯一', () => {
    expect(baseTenantCapabilities.map((item) => item.id)).toEqual([
      'base-tenant-list',
      'base-tenant-get',
    ])
  })

  it('全部 write: false —— 本族一个写操作都没有', () => {
    expect(baseTenantCapabilities.every((item) => item.write === false)).toBe(true)
  })

  it('合成页面路径挂在 /base-data 根下', () => {
    expect(baseTenantCapabilities.map((item) => item.pagePath)).toEqual([
      BASE_TENANT_LIST_PATH,
      BASE_TENANT_DETAIL_PATH,
    ])
    expect(BASE_TENANT_LIST_PATH.startsWith(`${BASE_TENANT_CONTEXT_ROOT}/`)).toBe(true)
    expect(BASE_TENANT_DETAIL_PATH.startsWith(`${BASE_TENANT_CONTEXT_ROOT}/`)).toBe(true)
  })

  it('合成页面路径推不出 module-type（conventions 第 2 条：算不出就不发）', () => {
    for (const path of [BASE_TENANT_LIST_PATH, BASE_TENANT_DETAIL_PATH]) {
      const resolution = resolveModuleType(path)
      expect(resolution.moduleType, `${path} 竟然解析出了 module-type：${resolution.label}`).toBeNull()
      expect(resolution.matchedBy).toBe('none')
    }
  })

  it('base-tenant-get 的 id 是必填的 search，且 lookup 指向 base-tenant-list 里真实存在的 keyword', () => {
    const list = baseTenantCapabilities.find((item) => item.id === 'base-tenant-list')
    const detail = baseTenantCapabilities.find((item) => item.id === 'base-tenant-get')

    const detailId = detail?.params.find((param) => param.name === 'id')
    expect(detailId?.required).toBe(true)
    expect(detailId?.kind).toBe('search')
    expect(detailId?.lookup).toEqual({ capabilityId: 'base-tenant-list', keywordParam: 'keyword' })

    // lookup 指向的那个参数**必须真的存在**，否则 `describe()` 给出的候选入口是空的
    const target = list?.params.find((param) => param.name === detailId?.lookup?.keywordParam)
    expect(target).toBeDefined()
  })

  it('缓存 TTL 与 DEFAULT_ABSOLUTE_TTL_MS 同值（挂不挂会话行为一致）', () => {
    expect(BASE_TENANT_CACHE_TTL_MS).toBe(DEFAULT_ABSOLUTE_TTL_MS)
  })

  /**
   * ⚠️ 这一条是**反证时补出来的**。
   *
   * 原来的用例把期望值写成常量本身（`pageSize: TENANT_PAGE_SIZE`），于是
   * "把 `TENANT_PAGE_SIZE` 从 200 改成 100"这个变异**不会让任何测试变红** ——
   * 一个典型的等价变异：测试跟着实现一起改，等于没测。
   *
   * 这几个数字是**有外部依据**的，必须钉死：
   * - `TENANT_PAGE_SIZE = 200`：与 `src/session/base-data.ts` 的 `TENANT_LIST_PAGE_SIZE`、
   *   `app/portal/utils/system.js:600-606` 的 loopFetch 配置**同值**；
   * - `TENANT_FETCH_MAX_PAGES = 5`：200 × 5 = 最多 1000 家，是本能力自己的硬上限；
   * - `limit` 20 / 100：出口裁剪的默认与上限。
   */
  it('四个上限常量是刻意选的，不是随手写的数（改了必须有人负责）', () => {
    expect(TENANT_PAGE_SIZE).toBe(200)
    expect(TENANT_FETCH_MAX_PAGES).toBe(5)
    expect(TENANT_LIMIT_DEFAULT).toBe(20)
    expect(TENANT_LIMIT_MAX).toBe(100)
  })
})

// ---------------------------------------------------------------------------

describe('敏感字段：白名单出口（本文件最要紧的两条）' as string, () => {
  it('列表：identityNumber / identityImg / contactMobile 一个都不在返回值里', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const { tenants } = await tenant.listTenants()

    const withIdentity = tenants.find((item) => item.id === '7')
    expect(withIdentity).toBeDefined()

    // 逐条点名（不是"检查某个键不存在"那么弱）：三个字段在**带值的那家**上也不许出现
    for (const item of tenants) {
      expect(item).not.toHaveProperty('identityNumber')
      expect(item).not.toHaveProperty('identityImg')
      expect(item).not.toHaveProperty('contactMobile')
      expect(item).not.toHaveProperty('updater')
      expect(item).not.toHaveProperty('deleted')
    }
    // 键集**恰好**是白名单那 9 个 —— 多一个就说明白名单被放开了
    expect(Object.keys(tenants[0]!).sort()).toEqual([...TENANT_SUMMARY_KEYS].sort())
  })

  it('详情：contactMobile 不在返回值里，键集恰好是白名单那 9 个', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const detail = await tenant.getTenant({ id: 1 })

    expect(detail).not.toHaveProperty('contactMobile')
    expect(detail).not.toHaveProperty('contactName')
    expect(Object.keys(detail).sort()).toEqual([...TENANT_DETAIL_KEYS].sort())
  })

  it('白名单是**反向**的：夹具里加一个新字段也不会漏出去', async () => {
    // 这条锁的是"后端将来加字段"的场景：黑名单会漏，白名单不会
    const { tenant } = makeTenant({
      routes: defaultRoutes({
        [TENANT_LIST_URL]: {
          list: [{ ...TENANT_RAW, brandNewSecretField: 'secret', anotherOne: 'x' }],
          total: 1,
        },
      }),
    })
    const { tenants } = await tenant.listTenants()
    expect(tenants[0]).not.toHaveProperty('brandNewSecretField')
    expect(tenants[0]).not.toHaveProperty('anotherOne')
  })
})

// ---------------------------------------------------------------------------

describe('归一化：useSystem 逗号串与 0/1 布尔' as string, () => {
  it('parseUseSystem 拆数字（真机是 "1,2,3,4,5,6,10"）', () => {
    expect(parseUseSystem('1,2,3,4,5,6,10')).toEqual([1, 2, 3, 4, 5, 6, 10])
  })

  it('parseUseSystem 对空串 / 非字符串给空数组（不抛）', () => {
    expect(parseUseSystem('')).toEqual([])
    expect(parseUseSystem(null)).toEqual([])
    expect(parseUseSystem(undefined)).toEqual([])
    expect(parseUseSystem(['1', '2'])).toEqual([])
  })

  it('parseUseSystem 丢掉 NaN，但**不丢 0**（Number("") 是有限值 —— 如实记录，不是本能力引入的）', () => {
    expect(parseUseSystem('1,abc,2')).toEqual([1, 2])
    expect(parseUseSystem('1, ,2')).toEqual([1, 0, 2])
  })

  it('tenantAdmin 由 0/1 归一成布尔，且只有 1 是真', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const { tenants } = await tenant.listTenants()
    expect(tenants[0]!.tenantAdmin).toBe(false)
    expect(tenants[1]!.tenantAdmin).toBe(true)
  })

  it('tenantAdmin 收到字符串 "0" 时是 false（不做 Boolean(value) 那种静默反向）', async () => {
    const { tenant } = makeTenant({
      routes: defaultRoutes({
        [TENANT_LIST_URL]: { list: [{ ...TENANT_RAW, tenantAdmin: '0' }], total: 1 },
      }),
    })
    const { tenants } = await tenant.listTenants()
    expect(tenants[0]!.tenantAdmin).toBe(false)
  })

  it('详情把 expireTime 映射到 expireDate（不改名会静默拿到 undefined）', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const detail = await tenant.getTenant({ id: '1' })
    expect(detail.expireDate).toBe('2030-01-01 00:00:00')
    expect(detail.accountCount).toBe(900)
    expect(detail.systems).toEqual([1, 2, 3, 4, 5, 6, 10])
  })
})

// ---------------------------------------------------------------------------

describe('翻页与硬上限' as string, () => {
  it('本账号 6 家：只打 1 页，pages=1，total 取服务端的 6（不是 list.length）', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    const result = await tenant.listTenants()

    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
    expect(result.pages).toBe(1)
    expect(result.total).toBe(6)
    expect(result.matched).toBe(2)
    expect(result.truncated).toBe(false)
    expect(callsOf(calls, TENANT_LIST_URL)[0]!.params).toEqual({ pageNo: 1, pageSize: TENANT_PAGE_SIZE })
  })

  it('服务端 total 与 list.length 不是一回事：total 原样透传', async () => {
    const { tenant } = makeTenant({
      routes: defaultRoutes({ [TENANT_LIST_URL]: { list: [TENANT_RAW], total: 0 } }),
    })
    const result = await tenant.listTenants()
    expect(result.total).toBe(0)
    expect(result.matched).toBe(1)
  })

  it('写满一页就自动翻下一页（不是只看第一页）', async () => {
    const fullPage = Array.from({ length: TENANT_PAGE_SIZE }, (_, index) => ({
      ...TENANT_RAW,
      id: index + 1,
    }))
    const { tenant, calls } = makeTenant({
      routes: (config) => {
        if (config.url !== TENANT_LIST_URL) return undefined
        const pageNo = (config.params as { pageNo: number }).pageNo
        if (pageNo === 1) return { list: fullPage, total: TENANT_PAGE_SIZE + 1 }
        return { list: [{ ...TENANT_RAW, id: 999 }], total: TENANT_PAGE_SIZE + 1 }
      },
    })
    const result = await tenant.listTenants({ limit: TENANT_LIMIT_MAX })

    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(2)
    expect(result.pages).toBe(2)
    // 201 = 200（满页）+ 1（末页）—— 这个数字才证明"第二页真的被翻了"。
    // truncated 这里必然是 true，但那是 **limit=100 切出来的**，不是翻页被夹住；
    // 两者的区别由 pages 与 matched 分辨（下一组用例才是翻页上限本身）
    expect(result.matched).toBe(TENANT_PAGE_SIZE + 1)
    expect(result.truncated).toBe(true)
  })

  it('页数用尽时**只发 MAX_PAGES 次**，并如实置 truncated（不静默少报）', async () => {
    const fullPage = Array.from({ length: TENANT_PAGE_SIZE }, (_, index) => ({
      ...TENANT_RAW,
      id: index + 1,
    }))
    const { tenant, calls } = makeTenant({
      routes: (config) => {
        if (config.url !== TENANT_LIST_URL) return undefined
        // 永远返回满页 —— 模拟"企业多到翻不完"
        return { list: fullPage, total: 10_000 }
      },
    })
    const result = await tenant.listTenants({ limit: TENANT_LIMIT_MAX })

    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(TENANT_FETCH_MAX_PAGES)
    expect(result.pages).toBe(TENANT_FETCH_MAX_PAGES)
    // 这两个数字才真正证明"翻页被夹住了"：服务端说 10000，
    // 实际只拿到 5 × 200 = 1000（否则 truncated: true 可能只是 limit 造成的，证不到翻页上限）
    expect(result.total).toBe(10_000)
    expect(result.matched).toBe(TENANT_PAGE_SIZE * TENANT_FETCH_MAX_PAGES)
    expect(result.truncated).toBe(true)
  })

  it('出口按 limit 截断并置 truncated', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const result = await tenant.listTenants({ limit: 1 })
    expect(result.tenants).toHaveLength(1)
    expect(result.matched).toBe(2)
    expect(result.truncated).toBe(true)
  })

  it('limit / pageSize 之外的入参被夹到合法区间', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    expect((await tenant.listTenants({ limit: 10_000 })).tenants.length).toBeLessThanOrEqual(TENANT_LIMIT_MAX)
    expect((await tenant.listTenants({ limit: 0 })).tenants).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('关键字过滤（本地过滤，不是服务端参数）' as string, () => {
  it('关键字只发一次请求 —— 它**不并进切片键**', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants({ keyword: '辰龙' })
    await tenant.listTenants({ keyword: '博创' })
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
  })

  it('关键字命中 name / shortName / code 三者之一即可', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    expect((await tenant.listTenants({ keyword: '辰龙' })).matched).toBe(1)
    expect((await tenant.listTenants({ keyword: 'ZH202400007' })).matched).toBe(1)
    expect((await tenant.listTenants({ keyword: 'zh202400007' })).matched).toBe(1)
    expect((await tenant.listTenants({ keyword: '不存在的东西' })).matched).toBe(0)
  })

  it('请求参数里**没有 keyword**：过滤是 SDK 侧做的，不是服务端', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants({ keyword: '辰龙' })
    expect(callsOf(calls, TENANT_LIST_URL)[0]!.params).toEqual({ pageNo: 1, pageSize: TENANT_PAGE_SIZE })
  })
})

// ---------------------------------------------------------------------------

describe('缓存与并发去重' as string, () => {
  it('两次调用只打一次网络（缓存命中）', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants()
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
  })

  it('listTenants 与 getTenant 用的是两个切片，互不干扰', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants()
    await tenant.getTenant({ id: 1 })
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
    expect(callsOf(calls, TENANT_DETAIL_URL)).toHaveLength(1)
  })

  it('invalidate() 清掉全部切片', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants()
    tenant.invalidate()
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(2)
  })

  it('invalidate("tenant-list") 只清列表', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants()
    tenant.invalidate('tenant-list')
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(2)
  })

  it('详情**不缓存**：两次 getTenant 就是两次请求（263 B / 195 ms，不值得为它多一个切片键）', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.getTenant({ id: 1 })
    await tenant.getTenant({ id: 1 })
    expect(callsOf(calls, TENANT_DETAIL_URL)).toHaveLength(2)
  })

  it('TTL 到期后重新拉（注入时钟，不 sleep）', async () => {
    let clock = 1_000_000
    const { tenant, calls } = makeTenant({
      routes: defaultRoutes(),
      cacheTtlMs: 60_000,
      now: () => clock,
    })
    await tenant.listTenants()
    clock += 59_999
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
    clock += 2
    await tenant.listTenants()
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(2)
  })

  it('并发调用被单飞合并成一次请求', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await Promise.all([
      tenant.listTenants(),
      tenant.listTenants(),
      tenant.listTenants(),
    ])
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(1)
  })

  it('缓存里那份不会被调用方改坏：改返回值的对象/数组，下一次调用仍是干净的', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes() })
    const first = await tenant.listTenants()
    first.tenants.length = 0
    first.tenants[0]?.systems.push(999) // 上一行已清空，这里只是防御性的
    expect((await tenant.listTenants()).tenants).toHaveLength(2)

    // 真正要卡的一条：改**对象里的字段**与 `systems` 数组，缓存不能跟着变
    const second = await tenant.listTenants()
    second.tenants[0]!.name = '被改坏了'
    second.tenants[0]!.systems.push(999)
    const third = await tenant.listTenants()
    expect(third.tenants[0]!.name).toBe('某某辰龙')
    expect(third.tenants[0]!.systems).toEqual([1, 2, 3, 4, 5, 6, 10])
  })
})

// ---------------------------------------------------------------------------

describe('module-type：默认不发，显式给了才带' as string, () => {
  it('默认不带 moduleType 字段', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.listTenants()
    expect(calls[0]!.moduleType).toBeUndefined()
  })

  it('接线方给了就带上（收窄口径用）', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes(), moduleType: 11 })
    await tenant.listTenants()
    expect(calls[0]!.moduleType).toBe(11)
  })
})

// ---------------------------------------------------------------------------

describe('失败要看得见' as string, () => {
  it('getTenant 没有 id 时拒绝，且**一个请求都不发**', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await expect(tenant.getTenant({ id: '' })).rejects.toThrow(/id 必填/)
    await expect(tenant.getTenant({ id: '  ' })).rejects.toThrow(/id 必填/)
    expect(calls).toHaveLength(0)
  })

  it('getTenant 接受数字与字符串两种 id（都折成字符串发出去）', async () => {
    const { tenant, calls } = makeTenant({ routes: defaultRoutes() })
    await tenant.getTenant({ id: 1 })
    expect(callsOf(calls, TENANT_DETAIL_URL)[0]!.params).toEqual({ id: '1' })
  })

  it('列表返回不是对象 → BaseTenantShapeError', async () => {
    const { tenant } = makeTenant({ routes: defaultRoutes({ [TENANT_LIST_URL]: [1, 2, 3] }) })
    await expect(tenant.listTenants()).rejects.toBeInstanceOf(BaseTenantShapeError)
  })

  it('列表里有一条没有 id → BaseTenantShapeError（不是静默跳过）', async () => {
    const { tenant } = makeTenant({
      routes: defaultRoutes({ [TENANT_LIST_URL]: { list: [{ name: '没有 id' }], total: 1 } }),
    })
    await expect(tenant.listTenants()).rejects.toBeInstanceOf(BaseTenantShapeError)
  })

  it('详情返回 null / 没有 id → BaseTenantShapeError', async () => {
    const nullCase = makeTenant({ routes: defaultRoutes({ [TENANT_DETAIL_URL]: null }) })
    await expect(nullCase.tenant.getTenant({ id: 1 })).rejects.toBeInstanceOf(BaseTenantShapeError)

    const noId = makeTenant({ routes: defaultRoutes({ [TENANT_DETAIL_URL]: { name: '无 id' } }) })
    await expect(noId.tenant.getTenant({ id: 1 })).rejects.toBeInstanceOf(BaseTenantShapeError)
  })

  it('请求失败会如实抛出去（不被缓存吞掉）', async () => {
    const { tenant, calls } = makeTenant({
      routes: defaultRoutes({ [TENANT_LIST_URL]: new Error('boom') }),
    })
    await expect(tenant.listTenants()).rejects.toThrow('boom')
    // 失败不进缓存 —— 下一次还会真的再试
    await expect(tenant.listTenants()).rejects.toThrow('boom')
    expect(callsOf(calls, TENANT_LIST_URL)).toHaveLength(2)
  })
})
