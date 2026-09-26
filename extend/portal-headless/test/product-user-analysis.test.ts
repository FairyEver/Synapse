import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createProductUserAnalysisCapability,
  EXPORT_COLUMN_HEADER,
  PRODUCT_USER_ANALYSIS_METHODS,
  PRODUCT_USER_ANALYSIS_PAGE_PATH,
  PRODUCT_USER_ANALYSIS_PERMISSION,
  productUserAnalysisCapabilities,
  type ProductUserAnalysisQuery,
  type ProductUserAnalysisRow,
} from '../src/capabilities/product-user-analysis.js'
import {
  PRODUCT_USER_ANALYSIS_AI_CONTRACTS as contracts,
  PRODUCT_USER_ANALYSIS_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-user-analysis.js'

type RequestConfig = Parameters<PortalRequest>[0]

const query: ProductUserAnalysisQuery = {
  userPermissionList: ['PS', 'CS'],
  isUsed: '0',
  startDate: '2026-09-01',
  endDate: '2026-09-30',
}

const row: ProductUserAnalysisRow = {
  userPermission: '父母代',
  companyName: '公司A',
  userName: '张三',
  userPhone: '13800000000',
  isUsed: '是',
  loginCount: 2,
  appUseCount: 3,
  pcUseCount: 4,
  useDateList: ['2026-09-01', '2026-09-02'],
  useDateStr: '2026-09-01,2026-09-02',
  useFunctionList: ['登录', '日报'],
  useFunctionStr: '登录,日报',
  useRate: '6.67',
  weekUseRate: '50.0',
  sort: 0,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductUserAnalysisCapability(request), calls }
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { fileName: '用户使用情况报表.xls' } },
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
  const api = createProductUserAnalysisCapability(
    config => call(PRODUCT_USER_ANALYSIS_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls, http }
}

describe('产品运营→用户使用分析页面能力', () => {
  it('逐页锁定菜单、权限、Portal请求、导出表头和Java字段', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/product/operation.js'), 'utf8')
    const source = readFileSync(join(portalRoot, 'app/portal/views/dashboard/product/operation/business/user-analysis/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/op/UseStatisticsController.java'), 'utf8')
    const exportController = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/UseStatisticsExcelController.java'), 'utf8')
    const vo = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/vo/op/UserLogSearchVO.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/statistics/op/UserLogReport2DTO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/statistics/impl/ApiStatisticsServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${PRODUCT_USER_ANALYSIS_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_USER_ANALYSIS_PERMISSION}'`)
    expect(source).toContain("http.post('/use/statistics/userLogReport2', form)")
    expect(source).toContain("apiUrl: '/use/statistics/userLogReport2/export'")
    expect(source).toContain("menuName: '用户使用分析'")
    expect(source).toContain("if (col.field === 'useDateList') return { ...col, field: 'useDateStr' }")
    expect(source).toContain("if (col.field === 'useFunctionList') return { ...col, field: 'useFunctionStr' }")
    for (const field of ['userPermission', 'companyName', 'userPhone', 'userName', 'isUsed', 'loginCount', 'appUseCount', 'pcUseCount', 'useDateList', 'useDateStr', 'useFunctionList', 'useFunctionStr', 'useRate', 'weekUseRate']) {
      expect(dto).toContain(`private ${field === 'loginCount' || field === 'appUseCount' || field === 'pcUseCount' || field === 'sort' ? 'Integer' : field.endsWith('List') ? field === 'useDateList' ? 'HashSet<LocalDate>' : 'HashSet<String>' : 'String'} ${field};`)
    }
    for (const field of ['userPermissionList', 'startDate', 'endDate', 'isUsed']) expect(vo).toContain(field)
    expect(controller).toContain('@PostMapping(value = "userLogReport2")')
    expect(controller).toContain('apiStatisticsService.userLogReport2(userLogSearchVO)')
    expect(exportController).toContain('@PostMapping(value = "/userLogReport2/export")')
    expect(exportController).toContain('userLogSearchVO.setMenuName("用户使用情况报表")')
    expect(exportController).toContain('putData("fileName", fileName)')
    expect(service).toContain('PageHelperUtil.checkReportRange(1')
    expect(service).toContain('PageHelperUtil.checkResultSize')

    expect(productUserAnalysisCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_USER_ANALYSIS_METHODS))
    expect(productUserAnalysisCapabilities.every(item => item.pagePath === PRODUCT_USER_ANALYSIS_PAGE_PATH)).toBe(true)
    expect(productUserAnalysisCapabilities.every(item => item.permission === PRODUCT_USER_ANALYSIS_PERMISSION)).toBe(true)
    expect(productUserAnalysisCapabilities.every(item => item.httpInstance === 'product' && item.moduleType === null && !item.write)).toBe(true)
  })

  it('列表请求逐字段复刻convertFetchForm并保留完整Java行字段', async () => {
    const f = fixture([[row]])
    await expect(f.api.list(query)).resolves.toEqual([row])
    expect(f.calls).toEqual([{
      url: '/use/statistics/userLogReport2',
      method: 'post',
      data: {
        userPermissionList: ['PS', 'CS'],
        isUsed: '0',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        scope: 1,
        menuName: '用户使用分析',
      },
    }])
  })

  it('导出请求复刻Portal公共导出钩子：表头字段替换为useDateStr/useFunctionStr', async () => {
    const f = fixture(['用户使用情况报表.xls'])
    await expect(f.api.export(query)).resolves.toBe('用户使用情况报表.xls')
    expect(f.calls).toEqual([{
      url: '/use/statistics/userLogReport2/export',
      method: 'post',
      data: {
        userPermissionList: ['PS', 'CS'],
        isUsed: '0',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        scope: 1,
        menuName: '用户使用分析',
        columnHeader: EXPORT_COLUMN_HEADER,
      },
    }])
    expect(EXPORT_COLUMN_HEADER).toBe('userPermission,用户群体;companyName,公司;userPhone,手机号;userName,用户名;isUsed,是否使用;loginCount,登录次数;appUseCount,app使用次数;pcUseCount,pc使用次数;useDateStr,使用日期;useFunctionStr,使用功能;useRate,日使用率;weekUseRate,周使用率')
  })

  it('省略筛选时复刻页面默认值，并按Java的1000天边界阻断请求', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T12:00:00+08:00'))
    const f = fixture([[]])
    await expect(f.api.list()).resolves.toEqual([])
    expect(f.calls[0]?.data).toEqual({
      userPermissionList: [],
      isUsed: '1',
      startDate: '2026-08-25',
      endDate: '2026-09-24',
      scope: 1,
      menuName: '用户使用分析',
    })
    await expect(f.api.list({ startDate: '2023-12-01', endDate: '2026-09-24' })).rejects.toThrow('1000天')
    expect(f.calls).toHaveLength(1)
    vi.useRealTimers()
  })

  it('拒绝Portal选项外的用户群体、状态、日期和坏响应', async () => {
    const f = fixture([[]])
    await expect(f.api.list({ ...query, userPermissionList: ['NOPE' as 'PS'] })).rejects.toThrow('userPermissionList')
    await expect(f.api.list({ ...query, isUsed: '2' as '1' })).rejects.toThrow('isUsed')
    await expect(f.api.list({ ...query, endDate: '2026-08-31' })).rejects.toThrow('endDate')
    await expect(f.api.list({ ...query, startDate: '2026-09-31' })).rejects.toThrow('startDate')
    await expect(f.api.list({ ...query, startDate: '2026-09-01', endDate: '2026-09-30' })).resolves.toEqual([])

    const badRows = fixture([{ list: [] }])
    await expect(badRows.api.list(query)).rejects.toThrow('必须是数组')
    const badRow = fixture([[{ ...row, useDateList: ['2026-09-01', 1] }]])
    await expect(badRow.api.list(query)).rejects.toThrow('useDateList')
    const emptyExport = fixture([''])
    await expect(emptyExport.api.export(query)).rejects.toThrow('fileName')
  })

  it('通过product实例发送PC头、保持路径原样且不发送module-type', async () => {
    const f = captureProduct()
    await expect(f.api.export(query)).resolves.toBe('用户使用情况报表.xls')
    const config = f.calls[0]
    expect(config?.baseURL).toBe('https://fmtest.zhihuidanji.com/flockSimu')
    expect((config as InternalAxiosRequestConfig & { httpInstance?: string })?.httpInstance).toBe('product')
    expect(String(config?.url)).toBe('/use/statistics/userLogReport2/export')
    expect(config?.headers?.devicetype).toBe('PC')
    expect(config?.headers?.['module-type']).toBeUndefined()
    expect(JSON.parse(String(config?.data))).toEqual({
      userPermissionList: ['PS', 'CS'],
      isUsed: '0',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      scope: 1,
      menuName: '用户使用分析',
      columnHeader: EXPORT_COLUMN_HEADER,
    })
  })

  it('AI契约覆盖列表和导出，并锁定导出返回是服务端文件名而非伪造二进制', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(PRODUCT_USER_ANALYSIS_METHODS))
    expect(contracts['product-user-analysis-list']?.output.shape).toBe('object[]')
    expect(contracts['product-user-analysis-export']?.output.shape).toBe('string')
    expect(contracts['product-user-analysis-export']?.output.fields.some(field => field.path === '$' && field.type === 'string')).toBe(true)
    expect(methodContracts['productUserAnalysis.list']?.boundaries.join('\n')).toContain('productUserAnalysis.list')
    expect(methodContracts['productUserAnalysis.export']?.boundaries.join('\n')).toContain('productUserAnalysis.export')
  })
})
