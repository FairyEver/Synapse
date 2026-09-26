/**
 * 第三批基础能力·其二（销售域基础数据）的回归测试。
 *
 * 与前几批同样的取向：**刻意不走 `createPortalHeadless`**（接线由派单方统一做），
 * 所以直接注入 `saleRequest` 桩——测的是能力自己的契约。
 *
 * 五条最要紧的断言（也是"改坏了会红"的那几条）：
 *
 * 1. **`shopuserIdentity` / `shopuserIdentityImg*` / `mobile` 绝不出现在返回值里**。
 *    真机那份 `shopuserIdentity` 是 18 位身份证号。这是唯一一条"错了也不会有别的症状"的断言。
 * 2. **`shopArea` 的逗号串 id 真的能喂给 `describeAreas`**（本族唯一一处能力依赖能力，
 *    不验一遍等于没接上）。
 * 3. **地区节点的名称字段是 `value` 不是 `name`** —— 照部门那套写会静默拿到 undefined。
 * 4. **没接线时抛 `SaleNotWiredError`，而不是退回默认 baseURL**（conventions 第 27 条：
 *    范围决策 SDK 不替调用方做；静默打错地址的失败方式只是个 404）。
 * 5. **长选项参数必填关键字**：三个"全量"接口无关键字时拒绝，且**一个请求都不发**。
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_SALE_AREA_PATH,
  BASE_SALE_BRAND_PATH,
  BASE_SALE_CACHE_TTL_MS,
  BASE_SALE_CONTEXT_ROOT,
  BASE_SALE_HOME_TIP_PATH,
  BASE_SALE_MANUFACTURER_PATH,
  BASE_SALE_SHOP_PATH,
  BaseSaleShapeError,
  baseSaleCapabilities,
  createBaseSale,
  indexAreaTree,
  parseAreaIds,
  SALE_AREA_LIMIT_DEFAULT,
  SALE_AREA_LIMIT_MAX,
  SALE_AREA_MAX_DEPTH_GUARD,
  SALE_AREA_URL,
  SALE_BRAND_LIMIT_DEFAULT,
  SALE_BRAND_LIMIT_MAX,
  SALE_BRAND_URL,
  SALE_MANUFACTURER_LIMIT_DEFAULT,
  SALE_MANUFACTURER_LIMIT_MAX,
  SALE_MANUFACTURER_URL,
  SALE_SHOP_URL,
  SALE_TRADE_TIP_URL,
  SaleNotWiredError,
  type BaseSaleOptions,
} from '../src/capabilities/base-sale.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { DEFAULT_ABSOLUTE_TTL_MS } from '../src/session/store.js'

// ---------------------------------------------------------------------------
// 夹具：形状逐字段取自真机（`smoke/read-base-sale.mjs` 实测），**值全部是编的**
// ---------------------------------------------------------------------------

type RecordedCall = { url: string; method: string; params?: unknown; moduleType?: number }

const SHOP_RAW = {
  shopId: 2,
  shopName: '某某旗舰店',
  shopType: 'store',
  sellerId: 6,
  status: 'active',
  openTime: 1571726601,
  closeTime: null,
  closeReason: null,
  shopLogo: 'https://example.invalid/logo.png',
  shopuserName: '张三',
  qq: '',
  servicesTel: '01000000000',
  wangwang: '',
  email: '',
  // ⚠️ 真机这两组是**真实身份证号与证件照 URL**，这里用假值占位（形状一致：18 位数字串）
  mobile: '13800000000',
  shopuserIdentity: '110226199001011234',
  shopuserIdentityImg: 'a:2:{s:1:"f";s:20:"https://example.invalid/f.png";}',
  shopuserIdentityImgZ: 'https://example.invalid/z.png',
  shopuserIdentityImgF: 'https://example.invalid/f.png',
  shopArea: '110000,110100,110117',
  bulletin: null,
  zzts: 'yukou',
  isShowShopName: 1,
  isShowShopLogo: 1,
  isShowShopBackground: 1,
  isShowShopDescript: 1,
  isShopDecorated: '1',
  undecoratedItem: '0',
  isShopPcDecorated: '1',
  pcUndecoratedItem: '0',
  openType: 'supplier',
  isIntegrateSap: 1,
  isOpenSynchro: 1,
  shopDescript: 'x',
  shopAddr: '北京市某某区某某路 1 号',
  isOpenRechargePayment: 0,
  shopTypeName: '自营店',
  typeSuffix: '',
  shopAllName: '某某旗舰店（全称）',
  shopInfo: null,
  shopRate: '0',
  imPlugin: null,
  isImportDelivery: 0,
}

/** 店铺视图应该**恰好**是这 18 个键 —— 多一个就说明白名单被放开了 */
const SHOP_KEYS = [
  'shopId', 'shopName', 'shopAllName', 'shopType', 'shopTypeName', 'status', 'sellerId',
  'shopuserName', 'servicesTel', 'email', 'shopLogo', 'shopAddr', 'shopArea', 'bulletin',
  'openTime', 'closeTime', 'closeReason', 'openType',
]

/**
 * 地区树：**照抄真机的结构**（省 → 市 → 区，最大深度 3；叶子 `children` 是 `null`，
 * 名称字段叫 `value`）。
 */
const AREA_TREE = [
  {
    id: 110000,
    parentId: 0,
    value: '北京市',
    children: [
      {
        id: 110100,
        parentId: 110000,
        value: '北京市',
        children: [
          { id: 110101, parentId: 110100, value: '东城区', children: null },
          { id: 110105, parentId: 110100, value: '朝阳区', children: null },
          // 真机的 shopArea 第三个 id 就是 110117（平谷区），这里补上，好让 shopArea 能原样喂进来
          { id: 110117, parentId: 110100, value: '平谷区', children: null },
        ],
      },
    ],
  },
  {
    id: 130000,
    parentId: 0,
    value: '河北省',
    children: [
      {
        id: 130100,
        parentId: 130000,
        value: '石家庄市',
        children: [{ id: 130102, parentId: 130100, value: '长安区', children: null }],
      },
    ],
  },
]

const MANUFACTURERS = [
  { manufacturerId: 2, manufacturerName: '北京市某某峪口禽业有限责任公司', brandList: null },
  { manufacturerId: 3, manufacturerName: '某某牧业有限公司', brandList: null },
]

const BRANDS = [
  { manufacturerId: 2, brandId: 1, brandName: '峪口禽业' },
  { manufacturerId: 3, brandId: 2, brandName: '某某牧业' },
]

// ---------------------------------------------------------------------------
// 测试桩（与前几批同形）
// ---------------------------------------------------------------------------

type Routes = Record<string, unknown> | ((config: RecordedCall) => unknown)

function makeSale (options: {
  saleRequest?: BaseSaleOptions['saleRequest']
  routes?: Routes
  cacheTtlMs?: number
  now?: () => number
  moduleType?: number
} = {}) {
  const calls: RecordedCall[] = []
  const routes: Routes = options.routes ?? {}

  const saleRequest = <T>(config: RecordedCall): Promise<T> => {
    calls.push(config)
    const route = typeof routes === 'function' ? routes(config) : routes[config.url]
    if (route === undefined) {
      return Promise.reject(new Error(`测试桩没有配 ${config.url} 这条路由`))
    }
    const value = typeof route === 'function' ? (route as () => unknown)() : route
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as T)
  }

  const sale = createBaseSale({
    ...(options.saleRequest === undefined
      ? { saleRequest: saleRequest as unknown as NonNullable<BaseSaleOptions['saleRequest']> }
      : { saleRequest: options.saleRequest }),
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.moduleType === undefined ? {} : { moduleType: options.moduleType }),
  })

  return { sale, calls }
}

function defaultRoutes (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [SALE_SHOP_URL]: SHOP_RAW,
    [SALE_AREA_URL]: AREA_TREE,
    [SALE_MANUFACTURER_URL]: MANUFACTURERS,
    [SALE_BRAND_URL]: BRANDS,
    [SALE_TRADE_TIP_URL]: { unpaidTip: false, waitShipTip: false },
    ...overrides,
  }
}

const callsOf = (calls: RecordedCall[], url: string) => calls.filter((call) => call.url === url)

// ---------------------------------------------------------------------------

describe('能力定义：七个入口齐全、全部只读' as string, () => {
  it('七个能力 id 齐全且唯一', () => {
    expect(baseSaleCapabilities.map((item) => item.id)).toEqual([
      'base-sale-shop-info',
      'base-sale-area-search',
      'base-sale-area-children',
      'base-sale-area-describe',
      'base-sale-manufacturer-search',
      'base-sale-brand-search',
      'base-sale-home-tip',
    ])
  })

  it('全部 write: false —— 本族一个写操作都没有', () => {
    expect(baseSaleCapabilities.every((item) => item.write === false)).toBe(true)
  })

  it('合成页面路径挂在 /base-data 根下', () => {
    for (const path of baseSaleCapabilities.map((item) => item.pagePath)) {
      expect(path.startsWith(`${BASE_SALE_CONTEXT_ROOT}/`)).toBe(true)
    }
    expect(baseSaleCapabilities.map((item) => item.pagePath)).toContain(BASE_SALE_SHOP_PATH)
    expect(baseSaleCapabilities.map((item) => item.pagePath)).toContain(BASE_SALE_AREA_PATH)
    expect(baseSaleCapabilities.map((item) => item.pagePath)).toContain(BASE_SALE_MANUFACTURER_PATH)
    expect(baseSaleCapabilities.map((item) => item.pagePath)).toContain(BASE_SALE_BRAND_PATH)
    expect(baseSaleCapabilities.map((item) => item.pagePath)).toContain(BASE_SALE_HOME_TIP_PATH)
  })

  it('五个合成页面路径都推不出 module-type（算不出就不发）', () => {
    for (const path of baseSaleCapabilities.map((item) => item.pagePath)) {
      const resolution = resolveModuleType(path)
      expect(resolution.moduleType, `${path} 竟然解析出了 module-type：${resolution.label}`).toBeNull()
      expect(resolution.matchedBy).toBe('none')
    }
  })

  it('三个"全量"接口的 keyword 都是必填的（conventions 第 11 条）', () => {
    for (const id of ['base-sale-area-search', 'base-sale-manufacturer-search', 'base-sale-brand-search']) {
      const def = baseSaleCapabilities.find((item) => item.id === id)
      const keyword = def?.params.find((param) => param.name === 'keyword')
      expect(keyword?.required, `${id} 的 keyword 应该必填`).toBe(true)
      expect(keyword?.kind).toBe('search')
    }
  })

  it('base-sale-area-children 的 parentId lookup 指向真实存在的 keyword 参数', () => {
    const children = baseSaleCapabilities.find((item) => item.id === 'base-sale-area-children')
    const parentId = children?.params.find((param) => param.name === 'parentId')
    expect(parentId?.required).toBe(true)
    expect(parentId?.lookup).toEqual({ capabilityId: 'base-sale-area-search', keywordParam: 'keyword' })

    const target = baseSaleCapabilities
      .find((item) => item.id === 'base-sale-area-search')
      ?.params.find((param) => param.name === 'keyword')
    expect(target).toBeDefined()
  })

  it('缓存 TTL 与 DEFAULT_ABSOLUTE_TTL_MS 同值', () => {
    expect(BASE_SALE_CACHE_TTL_MS).toBe(DEFAULT_ABSOLUTE_TTL_MS)
  })

  /**
   * ⚠️ 与 `test/base-tenant.test.ts` 里那条同源（那边是反证时补出来的）。
   *
   * 只断言"返回条数 ≤ 常量"是不够的：把常量改大，期望值跟着变大，测试**照样绿**——
   * 那是等价变异。这几个数字是**能力对外的硬承诺**（"一次调用最多给你多少条"），
   * 所以按字面钉死。
   */
  it('六个上限常量是刻意选的，不是随手写的数（改了必须有人负责）', () => {
    expect(SALE_AREA_LIMIT_DEFAULT).toBe(50)
    expect(SALE_AREA_LIMIT_MAX).toBe(200)
    expect(SALE_MANUFACTURER_LIMIT_DEFAULT).toBe(20)
    expect(SALE_MANUFACTURER_LIMIT_MAX).toBe(100)
    expect(SALE_BRAND_LIMIT_DEFAULT).toBe(20)
    expect(SALE_BRAND_LIMIT_MAX).toBe(100)
    // 树的遍历保护：真机最大深度是 3，20 已经是很宽的安全垫
    expect(SALE_AREA_MAX_DEPTH_GUARD).toBe(20)
  })
})

// ---------------------------------------------------------------------------

describe('敏感字段：店铺白名单出口（本文件最要紧的一条）' as string, () => {
  it('身份证号 / 证件照 URL / 个人手机号一个都不在返回值里', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const shop = await sale.getShopInfo()

    expect(shop).not.toHaveProperty('shopuserIdentity')
    expect(shop).not.toHaveProperty('shopuserIdentityImg')
    expect(shop).not.toHaveProperty('shopuserIdentityImgZ')
    expect(shop).not.toHaveProperty('shopuserIdentityImgF')
    expect(shop).not.toHaveProperty('mobile')
    expect(shop).not.toHaveProperty('qq')
    expect(shop).not.toHaveProperty('wangwang')
    // 键集**恰好**是白名单那 18 个 —— 多一个就说明白名单被放开了
    expect(Object.keys(shop).sort()).toEqual([...SHOP_KEYS].sort())
  })

  it('白名单是**反向**的：夹具里加一个新字段也不会漏出去', async () => {
    const { sale } = makeSale({
      routes: defaultRoutes({ [SALE_SHOP_URL]: { ...SHOP_RAW, brandNewSecretField: 'secret' } }),
    })
    expect(await sale.getShopInfo()).not.toHaveProperty('brandNewSecretField')
  })

  it('店铺信息的形状是真的被读了：名字/状态/地区串都在', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const shop = await sale.getShopInfo()
    expect(shop.shopId).toBe('2')
    expect(shop.shopName).toBe('某某旗舰店')
    expect(shop.status).toBe('active')
    expect(shop.shopArea).toBe('110000,110100,110117')
  })

  it('没有 shopId 的返回 → BaseSaleShapeError（不是给一份全 null 的"成功"）', async () => {
    const { sale } = makeSale({ routes: defaultRoutes({ [SALE_SHOP_URL]: { shopName: 'x' } }) })
    await expect(sale.getShopInfo()).rejects.toBeInstanceOf(BaseSaleShapeError)
  })
})

// ---------------------------------------------------------------------------

describe('地区：名称字段叫 value、路径要带全（照部门那套写会静默拿到 undefined）' as string, () => {
  it('searchAreas 返回 value / pathIds / pathNames / hasChildren', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const { areas, total, matched, truncated } = await sale.searchAreas({ keyword: '东城' })

    expect(total).toBe(8) // 8 个节点（含中间层）
    expect(matched).toBe(1)
    expect(truncated).toBe(false)
    expect(areas[0]).toEqual({
      id: 110101,
      parentId: 110100,
      value: '东城区',
      pathIds: [110000, 110100, 110101],
      pathNames: ['北京市', '北京市', '东城区'],
      hasChildren: false,
    })
    // 这条是钉子：字段叫 value（真机如此），**不是** name
    expect(areas[0]).not.toHaveProperty('name')
  })

  it('同名节点靠路径区分（"北京市"在真机里出现两次）', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const { areas } = await sale.searchAreas({ keyword: '北京市' })
    expect(areas).toHaveLength(2)
    expect(areas[0]!.id).toBe(110000)
    expect(areas[1]!.id).toBe(110100)
    expect(areas[1]!.pathNames).toEqual(['北京市', '北京市'])
  })

  it('listAreaChildren({ parentId: 0 }) 给根（真机是 34 个省）', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const result = await sale.listAreaChildren({ parentId: 0 })
    expect(result.children.map((entry) => entry.value)).toEqual(['北京市', '河北省'])
    expect(result.children.every((entry) => entry.hasChildren)).toBe(true)
    expect(result.parentFound).toBe(true)
  })

  it('listAreaChildren 的叶子没有下级，且 parentFound 能区分"没这个 id"', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    expect((await sale.listAreaChildren({ parentId: 110101 })).children).toHaveLength(0)
    expect((await sale.listAreaChildren({ parentId: 110101 })).parentFound).toBe(true)
    // 不存在的 id：matched=0 但 parentFound=false —— "它没有下级"与"没这个 id"是两件事
    const missing = await sale.listAreaChildren({ parentId: 999999 })
    expect(missing.matched).toBe(0)
    expect(missing.parentFound).toBe(false)
  })

  it('⭐ describeAreas 真的吃得下 shopArea 的逗号串（本族唯一一处能力依赖能力）', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const shop = await sale.getShopInfo()
    const described = await sale.describeAreas({ ids: shop.shopArea! })

    expect(described.unknown).toEqual([])
    expect(described.areas.map((entry) => entry.value)).toEqual(['北京市', '北京市', '平谷区'])
    expect(described.path).toBe('北京市/北京市/平谷区')
  })

  it('describeAreas 接受数组与单个数字，形状不同结果相同', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    expect((await sale.describeAreas({ ids: [110000, 130000] })).areas).toHaveLength(2)
    expect((await sale.describeAreas({ ids: 110000 })).areas).toHaveLength(1)
  })

  it('describeAreas 对未知 id **不静默丢掉**：列进 unknown，其余照常翻出来', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const result = await sale.describeAreas({ ids: '110000,999999' })
    expect(result.unknown).toEqual([999999])
    expect(result.areas).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('地区索引：id 重复 / 深度越界要报错，不能静默' as string, () => {
  it('id 重复 → BaseSaleShapeError（Map.set 会静默丢掉后一条）', () => {
    expect(() =>
      indexAreaTree([
        { id: 1, parentId: 0, value: 'a', children: null },
        { id: 1, parentId: 0, value: 'b', children: null },
      ]),
    ).toThrow(BaseSaleShapeError)
  })

  it('非数组 → BaseSaleShapeError', () => {
    expect(() => indexAreaTree({ id: 1 })).toThrow(BaseSaleShapeError)
    expect(() => indexAreaTree(null)).toThrow(BaseSaleShapeError)
  })

  it('节点没有数字 id → BaseSaleShapeError', () => {
    expect(() => indexAreaTree([{ parentId: 0, value: 'a', children: null }])).toThrow(BaseSaleShapeError)
  })

  it('树里有环（深度越界）→ BaseSaleShapeError，不是栈溢出', () => {
    const deep: { id: number; parentId: number; value: string; children: unknown[] } = {
      id: 1, parentId: 0, value: 'a', children: [],
    }
    let cursor = deep
    for (let level = 2; level <= 30; level += 1) {
      const next = { id: level, parentId: level - 1, value: `n${level}`, children: [] as unknown[] }
      cursor.children.push(next)
      cursor = next
    }
    expect(() => indexAreaTree([deep])).toThrow(/深度/)
  })

  it('parseAreaIds 拒绝非数字（不是静默过滤）', () => {
    expect(parseAreaIds('110000,110100')).toEqual([110000, 110100])
    expect(parseAreaIds([110000])).toEqual([110000])
    expect(() => parseAreaIds('110000,abc')).toThrow(BaseSaleShapeError)
    expect(() => parseAreaIds('')).toThrow(BaseSaleShapeError)
    expect(() => parseAreaIds(' , ')).toThrow(BaseSaleShapeError)
  })
})

// ---------------------------------------------------------------------------

describe('厂商 / 品牌：长选项参数必填关键字' as string, () => {
  it('无关键字时拒绝，且**一个请求都不发**', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await expect(sale.searchManufacturers({ keyword: '' })).rejects.toThrow(/keyword 必填/)
    await expect(sale.searchManufacturers({ keyword: '   ' })).rejects.toThrow(/keyword 必填/)
    await expect(sale.searchBrands({ keyword: '' })).rejects.toThrow(/keyword 必填/)
    await expect(sale.searchAreas({ keyword: '' })).rejects.toThrow(/keyword 必填/)
    expect(calls).toHaveLength(0)
  })

  it('搜厂商：命中名称片段，不区分大小写', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const result = await sale.searchManufacturers({ keyword: '峪口' })
    expect(result.matched).toBe(1)
    expect(result.total).toBe(2)
    expect(result.manufacturers[0]!.manufacturerId).toBe(2)
  })

  it('搜品牌：可按 manufacturerId 再收窄', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    expect((await sale.searchBrands({ keyword: '业' })).matched).toBe(2)
    expect((await sale.searchBrands({ keyword: '业', manufacturerId: 3 })).matched).toBe(1)
    expect((await sale.searchBrands({ keyword: '业', manufacturerId: 3 })).brands[0]!.brandName).toBe('某某牧业')
  })

  it('关键字是 **SDK 本地过滤**：请求参数里没有 keyword', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.searchManufacturers({ keyword: '峪口' })
    expect(callsOf(calls, SALE_MANUFACTURER_URL)[0]!.params).toBeUndefined()
  })

  it('出口按 limit 截断并置 truncated', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const result = await sale.searchAreas({ keyword: '市', limit: 1 })
    expect(result.areas).toHaveLength(1)
    expect(result.matched).toBeGreaterThan(1)
    expect(result.truncated).toBe(true)
  })

  it('limit 夹到上限', async () => {
    const many = Array.from({ length: 500 }, (_, index) => ({ id: index + 1, parentId: 0, value: `市${index}`, children: null }))
    const { sale } = makeSale({ routes: defaultRoutes({ [SALE_AREA_URL]: many }) })
    expect((await sale.searchAreas({ keyword: '市', limit: 10_000 })).areas.length).toBe(SALE_AREA_LIMIT_MAX)
  })
})

// ---------------------------------------------------------------------------

describe('首页待处理提示' as string, () => {
  it('两个布尔原样透传', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    expect(await sale.getHomeTip()).toEqual({ unpaidTip: false, waitShipTip: false })
  })

  it('0/1 也归一成布尔，且 "0" 是 false（不做 Boolean(value) 那种静默反向）', async () => {
    const { sale } = makeSale({
      routes: defaultRoutes({ [SALE_TRADE_TIP_URL]: { unpaidTip: 1, waitShipTip: '0' } }),
    })
    expect(await sale.getHomeTip()).toEqual({ unpaidTip: true, waitShipTip: false })
  })

  it('返回不是对象 → BaseSaleShapeError', async () => {
    const { sale } = makeSale({ routes: defaultRoutes({ [SALE_TRADE_TIP_URL]: [] }) })
    await expect(sale.getHomeTip()).rejects.toBeInstanceOf(BaseSaleShapeError)
  })
})

// ---------------------------------------------------------------------------

describe('sale 实例的接线：没接就报错，绝不退回默认 baseURL' as string, () => {
  it('没传 saleRequest 时每个方法都抛 SaleNotWiredError，并写明该怎么接', async () => {
    const { sale } = makeSale({ saleRequest: null, routes: defaultRoutes() })

    for (const run of [
      () => sale.getShopInfo(),
      () => sale.searchAreas({ keyword: '东城' }),
      () => sale.listAreaChildren({ parentId: 0 }),
      () => sale.describeAreas({ ids: '110000' }),
      () => sale.searchManufacturers({ keyword: '峪口' }),
      () => sale.searchBrands({ keyword: '峪口' }),
      () => sale.getHomeTip(),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(SaleNotWiredError)
    }
  })

  it('错误消息里带实例 id 与环境变量名（接线方照着就能配）', async () => {
    const { sale } = makeSale({ saleRequest: null, routes: defaultRoutes() })
    await expect(sale.getShopInfo()).rejects.toThrow(/sale/)
    await expect(sale.getShopInfo()).rejects.toThrow(/VITE_SHOP_ADMIN_API/)
    await expect(sale.getShopInfo()).rejects.toThrow(/admin-shop-api/)
  })

  it('接线正常时五个接口都真的打到 sale 的请求函数上', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.getShopInfo()
    await sale.searchAreas({ keyword: '东城' })
    await sale.listAreaChildren({ parentId: 0 })
    await sale.searchManufacturers({ keyword: '峪口' })
    await sale.searchBrands({ keyword: '峪口' })
    await sale.getHomeTip()
    // 五个接口 → 五条请求，一条不多。`listAreaChildren` 走的是 searchAreas 已经拉好的那份索引，
    // 所以 SALE_AREA_URL **只出现一次** —— 那正是"地区索引共用"这条设计的证据
    expect(calls.map((call) => call.url).sort()).toEqual([
      SALE_AREA_URL, SALE_BRAND_URL, SALE_MANUFACTURER_URL, SALE_SHOP_URL, SALE_TRADE_TIP_URL,
    ].sort())
    expect(calls.every((call) => call.method === 'get')).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('缓存与并发去重' as string, () => {
  it('地区树只拉一次：searchAreas / listAreaChildren / describeAreas 共用同一份索引', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.searchAreas({ keyword: '东城' })
    await sale.listAreaChildren({ parentId: 0 })
    await sale.describeAreas({ ids: '110000' })
    expect(callsOf(calls, SALE_AREA_URL)).toHaveLength(1)
  })

  it('厂商 / 品牌各拉一次，互不干扰', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.searchManufacturers({ keyword: '峪口' })
    await sale.searchBrands({ keyword: '峪口' })
    await sale.searchManufacturers({ keyword: '牧业' })
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(1)
    expect(callsOf(calls, SALE_BRAND_URL)).toHaveLength(1)
  })

  it('店铺**不缓存**：两次调用打两次（它是会变的业务状态，不是静态字典）', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.getShopInfo()
    await sale.getShopInfo()
    expect(callsOf(calls, SALE_SHOP_URL)).toHaveLength(2)
  })

  it('TTL 到期后重新拉（注入时钟，不 sleep）', async () => {
    let clock = 1_000_000
    const { sale, calls } = makeSale({ routes: defaultRoutes(), cacheTtlMs: 60_000, now: () => clock })
    await sale.searchManufacturers({ keyword: '峪口' })
    clock += 59_999
    await sale.searchManufacturers({ keyword: '峪口' })
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(1)
    clock += 2
    await sale.searchManufacturers({ keyword: '峪口' })
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(2)
  })

  it('invalidate() 清全部；invalidate("sale-area") 只清地区', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.searchAreas({ keyword: '东城' })
    await sale.searchManufacturers({ keyword: '峪口' })

    sale.invalidate('sale-area')
    await sale.searchAreas({ keyword: '东城' })
    await sale.searchManufacturers({ keyword: '峪口' })
    expect(callsOf(calls, SALE_AREA_URL)).toHaveLength(2)
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(1)

    sale.invalidate()
    await sale.searchAreas({ keyword: '东城' })
    await sale.searchManufacturers({ keyword: '峪口' })
    expect(callsOf(calls, SALE_AREA_URL)).toHaveLength(3)
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(2)
  })

  it('并发调用被单飞合并成一次', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await Promise.all([
      sale.searchAreas({ keyword: '东城' }),
      sale.listAreaChildren({ parentId: 0 }),
      sale.describeAreas({ ids: '110000' }),
    ])
    expect(callsOf(calls, SALE_AREA_URL)).toHaveLength(1)
  })

  it('缓存里那份不会被调用方改坏：改 pathNames 数组也不影响下一次', async () => {
    const { sale } = makeSale({ routes: defaultRoutes() })
    const first = await sale.describeAreas({ ids: '110101' })
    first.areas[0]!.pathNames.push('被改坏了')
    const second = await sale.describeAreas({ ids: '110101' })
    expect(second.areas[0]!.pathNames).toEqual(['北京市', '北京市', '东城区'])
  })

  it('请求失败会如实抛出去，且**失败不进缓存**（下一次真的再试）', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes({ [SALE_MANUFACTURER_URL]: new Error('boom') }) })
    await expect(sale.searchManufacturers({ keyword: '峪口' })).rejects.toThrow('boom')
    await expect(sale.searchManufacturers({ keyword: '峪口' })).rejects.toThrow('boom')
    expect(callsOf(calls, SALE_MANUFACTURER_URL)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------

describe('module-type：默认不发，显式给了才带' as string, () => {
  it('默认不带 moduleType 字段', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes() })
    await sale.getShopInfo()
    expect(calls[0]!.moduleType).toBeUndefined()
  })

  it('接线方给了就带上', async () => {
    const { sale, calls } = makeSale({ routes: defaultRoutes(), moduleType: 11 })
    await sale.getShopInfo()
    expect(calls[0]!.moduleType).toBe(11)
  })
})
