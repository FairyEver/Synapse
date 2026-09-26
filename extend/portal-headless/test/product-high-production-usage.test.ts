import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductHighProductionUsageCapability,
  productHighProductionUsageCapabilities,
  PRODUCT_HIGH_PRODUCTION_USAGE_METHODS,
  PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH,
  PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION,
  type ProductHighProductionUsageQuery,
  type ProductHighProductionUsageRow,
} from '../src/capabilities/product-high-production-usage.js'
import {
  PRODUCT_HIGH_PRODUCTION_USAGE_AI_CONTRACTS as contracts,
  PRODUCT_HIGH_PRODUCTION_USAGE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-high-production-usage.js'

type RequestConfig = Parameters<PortalRequest>[0]

const query: ProductHighProductionUsageQuery = {
  buildingList: ['building-1', '9007199254740993'],
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  timeGroup: '1',
  orgGroup: '3',
}

const row: ProductHighProductionUsageRow = {
  officeName: '公司A',
  farmName: '场区A',
  buildingName: '栋舍1',
  dateStr: '2026-09-01',
  flockCount: 2,
  openingQty: '1000',
  programCount: 1,
  dailyRecord: '12',
  weightRecord: '8',
  tibiaRecord: '3',
  inChickenCount: 1,
  transferCount: 0,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductHighProductionUsageCapability(request), calls }
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://fmtest.zhihuidanji.com/flockSimu' } },
  )
  const api = createProductHighProductionUsageCapability(
    config => call(PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls, http }
}

describe('产品运营→高产用户使用分析页面能力', () => {
  it('逐页锁定菜单、权限、Portal请求和Java统计边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/product/operation.js'), 'utf8')
    const source = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/operation/business/usage-chicken/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/op/UseStatisticsController.java'), 'utf8')
    const vo = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/vo/op/PreventionUseVO.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/statistics/op/ProductionRecordSituationDTO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/statistics/impl/UseStatisticsServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION}'`)
    expect(source).toContain("http.post('/use/statistics/highProductionRecordSituation', form)")
    expect(source).toContain("http.get('/config/farm/getOfficeFarmBuildingTreeByTag'")
    expect(source).toContain("params: { types: '1' }")
    expect(source).toContain('scope: 1')
    expect(source).toContain("menuName: '用户使用情况报表'")
    expect(source).toContain("const isLeaf = !e.child || e.child.length === 0")
    expect(source).toContain('const isBuildingNode = e.type === 4')
    for (const field of ['officeName', 'farmName', 'buildingName', 'dateStr', 'flockCount', 'openingQty', 'programCount', 'dailyRecord', 'weightRecord', 'tibiaRecord', 'inChickenCount', 'transferCount']) {
      expect(source).toContain(`field: '${field}'`)
      expect(dto).toMatch(new RegExp(`private\\s+\\w+\\s+${field};`))
    }
    expect(controller).toContain('@PostMapping(value = "highProductionRecordSituation")')
    expect(controller).toContain('getHighProductionRecordSituation(preventionUseVO)')
    expect(vo).toContain('private List<String> buildingList')
    expect(vo).toContain('private Integer timeGroup')
    expect(vo).toContain('private Integer orgGroup')
    expect(service).toContain('MAX_EXPECTED_STATISTICS_COUNT')
    expect(service).toContain('MAX_DATE_SPAN_DAYS')
    expect(service).toContain('MAX_BUILDING_COUNT')

    expect(productHighProductionUsageCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_HIGH_PRODUCTION_USAGE_METHODS))
    expect(productHighProductionUsageCapabilities.every(item => item.pagePath === PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH)).toBe(true)
    expect(productHighProductionUsageCapabilities.every(item => item.permission === PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION)).toBe(true)
    expect(productHighProductionUsageCapabilities.every(item => item.httpInstance === 'product' && item.moduleType === null && !item.write)).toBe(true)
  })

  it('组织树复刻Portal的types=1和tree/数组兼容形状', async () => {
    const response = {
      tree: [{
        id: 'office-1',
        name: '公司A',
        type: 1,
        child: [{
          id: 2,
          name: '场区A',
          type: '2',
          child: [{ id: 'building-1', name: '栋舍1', type: 4, child: [] }],
        }],
      }],
    }
    const f = fixture([response])
    await expect(f.api.tree()).resolves.toEqual(response.tree)
    expect(f.calls).toEqual([{ url: '/config/farm/getOfficeFarmBuildingTreeByTag', method: 'get', params: { types: '1' } }])

    const direct = fixture([[{ id: 'building-2', child: [] }]])
    await expect(direct.api.tree()).resolves.toEqual([{ id: 'building-2', name: null, type: null, child: [] }])
  })

  it('高产统计请求体逐字段复刻convertFetchForm，保留服务端结果且不添加随机UI id', async () => {
    const f = fixture([[row]])
    await expect(f.api.list(query)).resolves.toEqual([row])
    expect(f.calls).toEqual([{
      url: '/use/statistics/highProductionRecordSituation',
      method: 'post',
      data: {
        buildingList: ['building-1', '9007199254740993'],
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        timeGroup: '1',
        orgGroup: '3',
        scope: 1,
        menuName: '用户使用情况报表',
      },
    }])
    expect(f.calls[0]?.data).not.toHaveProperty('id')

    const numericGroups = fixture([[]])
    await expect(numericGroups.api.list({ ...query, timeGroup: 2, orgGroup: 1 })).resolves.toEqual([])
    expect(numericGroups.calls[0]?.data).toMatchObject({ timeGroup: '2', orgGroup: '1' })
  })

  it('按Java边界在发请求前拒绝非法日期、分组、栋舍和预计统计量', async () => {
    const f = fixture([[]])
    await expect(f.api.list({ ...query, buildingList: [] })).rejects.toThrow('buildingList')
    await expect(f.api.list({ ...query, startDate: '2026-09-04' })).rejects.toThrow('endDate')
    await expect(f.api.list({ ...query, timeGroup: '4' as '1' })).rejects.toThrow('timeGroup')
    await expect(f.api.list({ ...query, orgGroup: '0' as '1' })).rejects.toThrow('orgGroup')
    await expect(f.api.list({ ...query, endDate: '2027-09-03' })).rejects.toThrow('366天')
    await expect(f.api.list({ ...query, buildingList: Array.from({ length: 101 }, (_, index) => `building-${index}`) })).rejects.toThrow('100个栋舍')
    await expect(f.api.list({
      ...query,
      buildingList: Array.from({ length: 100 }, (_, index) => `building-${index}`),
      endDate: '2026-12-10',
    })).rejects.toThrow('10000')
    expect(f.calls).toHaveLength(0)
  })

  it('错误响应不被伪造成空数组，空响应才按Portal的result||[]归一', async () => {
    await expect(fixture([{ list: [] }]).api.list(query)).rejects.toThrow('数组')
    await expect(fixture([null]).api.list(query)).resolves.toEqual([])
    await expect(fixture([[{ ...row, openingQty: {} }]]).api.list(query)).rejects.toThrow('openingQty')
    await expect(fixture([{ tree: [{ id: '1', child: [{ id: '', child: [] }] }] }]).api.tree()).rejects.toThrow('id')
    await expect(fixture([{}]).api.tree()).rejects.toThrow('tree数组')
    await expect(fixture([[{ id: '1', type: {}, child: [] }]]).api.tree()).rejects.toThrow('type')
  })

  it('product请求实例带PC设备头、不补admin-api且不发送module-type', async () => {
    const { api, calls, http } = captureProduct()
    await expect(api.tree()).resolves.toEqual([])
    const config = calls[0]!
    expect(config.baseURL).toBe('https://fmtest.zhihuidanji.com/flockSimu')
    expect(config.url).toBe('/config/farm/getOfficeFarmBuildingTreeByTag')
    expect(config.params).toMatchObject({ types: '1' })
    expect(config.url).not.toContain('/admin-api')
    expect(config.headers?.get('devicetype')).toBe('PC')
    expect(config.headers?.has('module-type')).toBe(false)
    expect(http.getUri(config).replace(/([?&]_t=)\d+/, '$1<ts>')).toContain('/config/farm/getOfficeFarmBuildingTreeByTag')
  })
})

describe('高产用户使用分析AI契约与反证', () => {
  it('能力定义、公开方法映射和契约结构一一对应', async () => {
    expect(Object.keys(contracts)).toEqual(productHighProductionUsageCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'productHighProductionUsage.tree',
      'productHighProductionUsage.list',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: productHighProductionUsageCapabilities,
      contracts,
    })).toEqual([])
    const complete = validateAiContracts(contracts, {
      profile: 'complete',
      definitions: productHighProductionUsageCapabilities,
      contracts,
    }) as Array<{ code: string }>
    expect(complete.map(issue => issue.code)).toEqual(['incomplete-evidence', 'incomplete-evidence'])
  })

  it('反证：删除组织树ID字段会被跨能力映射检查发现', async () => {
    const broken = {
      ...contracts,
      'product-high-production-usage-tree': {
        ...contracts['product-high-production-usage-tree']!,
        output: {
          ...contracts['product-high-production-usage-tree']!.output,
          fields: contracts['product-high-production-usage-tree']!.output.fields.filter(item => item.path !== '[].id'),
        },
      },
    }
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(broken, {
      definitions: productHighProductionUsageCapabilities,
      contracts: broken,
    }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
    expect(broken['product-high-production-usage-tree']!.output.fields.some(item => item.path === '[].id')).toBe(false)
  })
})
