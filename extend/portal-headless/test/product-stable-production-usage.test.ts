import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductStableProductionUsageCapability,
  productStableProductionUsageCapabilities,
  PRODUCT_STABLE_PRODUCTION_USAGE_METHODS,
  PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH,
  PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION,
  type ProductStableProductionUsageQuery,
  type ProductStableProductionUsageRow,
} from '../src/capabilities/product-stable-production-usage.js'
import {
  PRODUCT_STABLE_PRODUCTION_USAGE_AI_CONTRACTS as contracts,
  PRODUCT_STABLE_PRODUCTION_USAGE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-stable-production-usage.js'

type RequestConfig = Parameters<PortalRequest>[0]

const query: ProductStableProductionUsageQuery = {
  buildingList: ['building-2'],
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  timeGroup: '1',
  orgGroup: '2',
}

const row: ProductStableProductionUsageRow = {
  officeName: '公司A',
  farmName: '场区A',
  buildingName: '栋舍2',
  dateStr: '2026-09-01',
  flockCount: 1,
  openingQty: 900,
  programCount: 2,
  dailyRecord: '11',
  weightRecord: '7',
  tibiaRecord: '2',
  inChickenCount: 1,
  transferCount: 1,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductStableProductionUsageCapability(request), calls }
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
  const api = createProductStableProductionUsageCapability(
    config => call(PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('产品运营→稳产用户使用分析页面能力', () => {
  it('逐页锁定稳产菜单、权限、请求端点和共享Java字段/边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/product/operation.js'), 'utf8')
    const source = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/operation/business/usage-layer/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/op/UseStatisticsController.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/statistics/op/ProductionRecordSituationDTO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/statistics/impl/UseStatisticsServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION}'`)
    expect(source).toContain("http.post('/use/statistics/stableProductionRecordSituation', form)")
    expect(source).toContain("params: { types: '2' }")
    expect(source).toContain('scope: 1')
    expect(source).toContain("menuName: '用户使用情况报表'")
    expect(source).toContain("const isLeaf = !e.child || e.child.length === 0")
    expect(source).toContain('const isBuildingNode = e.type === 4')
    for (const field of ['officeName', 'farmName', 'buildingName', 'dateStr', 'flockCount', 'openingQty', 'programCount', 'dailyRecord', 'weightRecord', 'tibiaRecord', 'inChickenCount', 'transferCount']) {
      expect(source).toContain(`field: '${field}'`)
      expect(dto).toContain(`${field};`)
    }
    expect(controller).toContain('@PostMapping(value = "stableProductionRecordSituation")')
    expect(controller).toContain('getStableProductionRecordSituation(preventionUseVO)')
    expect(service).toContain('getStableProductionRecordSituation')
    expect(service).toContain('MAX_EXPECTED_STATISTICS_COUNT')
    expect(service).toContain('MAX_DATE_SPAN_DAYS')
    expect(service).toContain('MAX_BUILDING_COUNT')

    expect(productStableProductionUsageCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_STABLE_PRODUCTION_USAGE_METHODS))
    expect(productStableProductionUsageCapabilities.every(item => item.pagePath === PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH)).toBe(true)
    expect(productStableProductionUsageCapabilities.every(item => item.permission === PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION)).toBe(true)
    expect(productStableProductionUsageCapabilities.every(item => item.httpInstance === 'product' && item.moduleType === null && !item.write)).toBe(true)
  })

  it('组织树固定types=2，统计固定稳产端点和公共表单字段', async () => {
    const f = fixture([[{ id: 'building-2', name: '栋舍2', type: 4, child: [] }], [row]])
    await expect(f.api.tree()).resolves.toEqual([{ id: 'building-2', name: '栋舍2', type: 4, child: [] }])
    await expect(f.api.list(query)).resolves.toEqual([row])
    expect(f.calls).toEqual([
      { url: '/config/farm/getOfficeFarmBuildingTreeByTag', method: 'get', params: { types: '2' } },
      {
        url: '/use/statistics/stableProductionRecordSituation',
        method: 'post',
        data: {
          buildingList: ['building-2'],
          startDate: '2026-09-01',
          endDate: '2026-09-03',
          timeGroup: '1',
          orgGroup: '2',
          scope: 1,
          menuName: '用户使用情况报表',
        },
      },
    ])
  })

  it('共享Java边界和响应形状在稳产页同样生效', async () => {
    const f = fixture([[]])
    await expect(f.api.list({ ...query, buildingList: Array.from({ length: 101 }, (_, index) => `building-${index}`) })).rejects.toThrow('100个栋舍')
    await expect(f.api.list({ ...query, endDate: '2027-09-02' })).rejects.toThrow('366天')
    await expect(fixture([{ list: [] }]).api.list(query)).rejects.toThrow('数组')
    await expect(fixture([{}]).api.tree()).rejects.toThrow('tree数组')
    expect(f.calls).toHaveLength(0)
  })

  it('稳产页走product实例，带PC设备头且不发module-type', async () => {
    const { api, calls } = captureProduct()
    await expect(api.tree()).resolves.toEqual([])
    const config = calls[0]!
    expect(config.baseURL).toBe('https://fmtest.zhihuidanji.com/flockSimu')
    expect(config.url).toBe('/config/farm/getOfficeFarmBuildingTreeByTag')
    expect(config.params).toMatchObject({ types: '2' })
    expect(config.headers?.get('devicetype')).toBe('PC')
    expect(config.headers?.has('module-type')).toBe(false)
  })
})

describe('稳产用户使用分析AI契约与反证', () => {
  it('能力定义、公开方法映射和契约结构一一对应', async () => {
    expect(Object.keys(contracts)).toEqual(productStableProductionUsageCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'productStableProductionUsage.tree',
      'productStableProductionUsage.list',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: productStableProductionUsageCapabilities,
      contracts,
    })).toEqual([])
    const complete = validateAiContracts(contracts, {
      profile: 'complete',
      definitions: productStableProductionUsageCapabilities,
      contracts,
    }) as Array<{ code: string }>
    expect(complete.map(issue => issue.code)).toEqual(['incomplete-evidence', 'incomplete-evidence'])
  })

  it('反证：删除稳产组织树ID字段会被跨能力映射检查发现', async () => {
    const broken = {
      ...contracts,
      'product-stable-production-usage-tree': {
        ...contracts['product-stable-production-usage-tree']!,
        output: {
          ...contracts['product-stable-production-usage-tree']!.output,
          fields: contracts['product-stable-production-usage-tree']!.output.fields.filter(item => item.path !== '[].id'),
        },
      },
    }
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(broken, {
      definitions: productStableProductionUsageCapabilities,
      contracts: broken,
    }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
  })
})
