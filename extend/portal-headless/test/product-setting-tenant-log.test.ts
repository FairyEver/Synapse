import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingTenantLogCapability,
  PRODUCT_SETTING_TENANT_LOG_METHODS,
  PRODUCT_SETTING_TENANT_LOG_MODULE_TYPE,
  PRODUCT_SETTING_TENANT_LOG_PAGE_PATH,
  PRODUCT_SETTING_TENANT_LOG_PERMISSION,
  productSettingTenantLogCapabilities,
} from '../src/capabilities/product-setting-tenant-log.js'
import { PRODUCT_SETTING_TENANT_LOG_AI_CONTRACTS as contracts, PRODUCT_SETTING_TENANT_LOG_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-tenant-log.js'

type RequestConfig = Parameters<PortalRequest>[0]

const company = { id: 'company-1', name: '测试企业', useSystem: '4' }
const functionItem = { module1: '模块A', module2: '模块B', module3: '功能C' }
const functionTree = [{ id: 'root', name: '运营管理', childList: [{ id: 'module', name: '模块A', childList: [{ id: 'function', name: '模块B', childList: [{ id: 'leaf', name: '功能C', childList: [] }] }] }] }]
const user = { id: 'user-1', name: '测试用户', office: { id: 'company-1', name: '测试企业' } }
const row = {
  module1: '模块A',
  module2: '模块B',
  module3: '功能C',
  moduleName: '模块A',
  functionName: '模块B::功能C',
  recordCount: 2,
  searchCount: 3,
  totalCount: 5,
  userId: 'user-1',
  officeName: '测试企业',
  userName: '测试用户',
  phone: '13800000000',
  date: '2026-09-24',
  createDate: '2026-09-24 10:00:00',
  requestType: 1,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingTenantLogCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [company] } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingTenantLogCapability(
    config => call(PRODUCT_SETTING_TENANT_LOG_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 业务管理 → 企业使用情况页面能力', () => {
  it('逐页锁定菜单、权限、表单规则、详情规则和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/tenant-log.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/tenant-log/list.vue')
    const moduleDetail = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/tenant-log/module-details.vue')
    const functionDetail = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/tenant-log/function-details.vue')
    const userDetail = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/tenant-log/user-details.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/op/UseStatisticsController.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/statistics/vo/op/UserReportV1VO.java')
    const officeController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/OfficeController.java')
    const leafController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/LeafController.java')
    const userController = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/sys/UserController.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_TENANT_LOG_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_TENANT_LOG_PERMISSION}'`)
    expect(route).toContain('title: 企业使用情况')
    expect(route).toContain(PRODUCT_SETTING_TENANT_LOG_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      "query: ''",
      "submit: ''",
      "const pageType = ref('1')",
      "companyId: ''",
      "functionList: []",
      "userIdList: []",
      "deviceType: ''",
      'dayjs().subtract(30, \'day\')',
      "companyId: params.companyId",
      "startDate: params.dateRange?.[0] || ''",
      "endDate: params.dateRange?.[1] || ''",
      "deviceType: params.deviceType || ''",
      'searchData.functionList = functionListSelected.value',
      'searchData.userIdList = params.userIdList || []',
      "url: apiMap[pageType.value]",
      "method: 'POST'",
      'getDataListIsPage: false',
      "url: '/sys/office/getTenantCompanyList'",
      "params: { id: 0 }",
      "url: '/config/leaf/getTree'",
      "params: { code: 'functionUrl' }",
      "url: '/sys/user'",
      'pageSize: 99999',
      "'office.id': rrList.formState.companyId",
      'parts.length === 3',
      'module1: parts[0]',
      'module2: parts[1]',
      'module3: parts[2]',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "url: '/use/statistics/companyModuleUseSituationDetail'",
      'module: props.searchData.moduleName',
      "method: 'POST'",
      "url: '/use/statistics/companyFunctionUseSituationDetail'",
      'module1: props.searchData.module1',
      'module2: props.searchData.module2',
      'module3: props.searchData.module3',
      'return { list: res || [] }',
    ]) expect(`${moduleDetail}\n${functionDetail}`).toContain(fragment)
    for (const fragment of [
      "url: '/use/statistics/companyUserUseSituationDetail'",
      'userIdList: props.searchData.userIdList',
      'functionList: props.searchData.functionList',
      "keyId: 'createDate'",
    ]) expect(userDetail).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/use/statistics")',
      '@PostMapping(value = "companyModuleUseSituation")',
      '@PostMapping(value = "companyModuleUseSituationDetail")',
      '@PostMapping(value = "companyFunctionUseSituation")',
      '@PostMapping(value = "companyFunctionUseSituationDetail")',
      '@PostMapping(value = "companyUserUseSituation")',
      '@PostMapping(value = "companyUserUseSituationDetail")',
      '请选择公司',
      '请选择功能',
      '请选择用户',
      'putData("list", new ArrayList<>())',
    ]) expect(controller).toContain(fragment)
    for (const field of ['companyId', 'deviceType', 'startDate', 'endDate', 'module1', 'module2', 'module3', 'functionList', 'userIdList']) expect(vo).toContain(field)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/sys/office")',
      '@GetMapping(value = "/getTenantCompanyList")',
      'useSystemList.contains("4")',
    ]) expect(officeController).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/leaf")',
      '@GetMapping("getTree")',
      'getByCode(code, null)',
      'genNativeTree',
    ]) expect(leafController).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/sys/user")',
      '@GetMapping',
      'defaultValue = "1"',
      'defaultValue = "10"',
      'user.setTenantId(HRUserUtils.getUser().getTenantId())',
      'putData("page", page)',
    ]) expect(userController).toContain(fragment)

    expect(productSettingTenantLogCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_TENANT_LOG_METHODS))
    expect(productSettingTenantLogCapabilities.every(item => item.pagePath === PRODUCT_SETTING_TENANT_LOG_PAGE_PATH && item.permission === PRODUCT_SETTING_TENANT_LOG_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_TENANT_LOG_MODULE_TYPE)).toBe(true)
  })

  it('企业、功能树、用户、三种统计和三种明细逐请求对齐Portal', async () => {
    const f = fixture([
      [company],
      functionTree,
      { page: { list: [user], total: 1 } },
      [row],
      [row],
      [row],
      [row],
      [row],
      [row],
    ])
    await expect(f.api.companyList()).resolves.toEqual([company])
    await expect(f.api.functionTree()).resolves.toMatchObject([{ fullName: '运营管理', childList: [{ fullName: '运营管理-模块A', childList: [{ fullName: '运营管理-模块A-模块B', childList: [{ fullName: '运营管理-模块A-模块B-功能C' }] }] }] }])
    await expect(f.api.userList({ companyId: company.id })).resolves.toEqual([user])
    await expect(f.api.list({ pageType: '1', companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    await expect(f.api.list({ pageType: '2', companyId: company.id, functionList: [functionItem], deviceType: 'PC', startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    await expect(f.api.list({ pageType: '3', companyId: company.id, functionList: [functionItem], userIdList: [user.id], deviceType: 'APP', startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    await expect(f.api.moduleDetail({ companyId: company.id, module: '模块A', startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    await expect(f.api.functionDetail({ companyId: company.id, module: '模块A', module1: '模块A', module2: '模块B', module3: '功能C', startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    await expect(f.api.userDetail({ companyId: company.id, functionList: [functionItem], userIdList: [user.id], startDate: '2026-09-01', endDate: '2026-09-24' })).resolves.toEqual([row])
    expect(f.calls).toEqual([
      { url: '/sys/office/getTenantCompanyList', method: 'get', params: { id: 0 } },
      { url: '/config/leaf/getTree', method: 'get', params: { code: 'functionUrl' } },
      { url: '/sys/user', method: 'get', params: { pageSize: 99999, pageNo: 1, 'office.id': company.id } },
      { url: '/use/statistics/companyModuleUseSituation', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: '' } },
      { url: '/use/statistics/companyFunctionUseSituation', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: 'PC', functionList: [functionItem] } },
      { url: '/use/statistics/companyUserUseSituation', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: 'APP', functionList: [functionItem], userIdList: [user.id] } },
      { url: '/use/statistics/companyModuleUseSituationDetail', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: '', module: '模块A' } },
      { url: '/use/statistics/companyFunctionUseSituationDetail', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: '', module: '模块A', module1: '模块A', module2: '模块B', module3: '功能C' } },
      { url: '/use/statistics/companyUserUseSituationDetail', method: 'post', data: { companyId: company.id, startDate: '2026-09-01', endDate: '2026-09-24', deviceType: '', userIdList: [user.id], functionList: [functionItem] } },
    ])
  })

  it('表单条件、层级函数、用户数组、日期和坏响应在请求边界锁住', async () => {
    const f = fixture([])
    await expect(f.api.list({ companyId: '' })).rejects.toThrow('companyId')
    await expect(f.api.list({ companyId: company.id, pageType: '2' })).rejects.toThrow('functionList')
    await expect(f.api.list({ companyId: company.id, pageType: '3', functionList: [functionItem] })).rejects.toThrow('userIdList')
    await expect(f.api.list({ companyId: company.id, functionList: [functionItem], deviceType: 'WEB' as never })).rejects.toThrow('deviceType')
    await expect(f.api.list({ companyId: company.id, startDate: '2026-09-25', endDate: '2026-09-24' })).rejects.toThrow('endDate')
    await expect(f.api.moduleDetail({ companyId: company.id, module: '' })).rejects.toThrow('module')
    await expect(f.api.functionDetail({ companyId: company.id, module: '模块A', module1: '模块A', module2: '', module3: '功能C' })).rejects.toThrow('module2')
    await expect(f.api.userDetail({ companyId: company.id, functionList: [], userIdList: [] })).rejects.toThrow('userIdList')
    expect(f.calls).toEqual([])

    await expect(fixture([[{ id: 'c1' }]]).api.companyList()).rejects.toThrow('name')
    await expect(fixture([[{ id: 'root', name: '根', childList: [{ id: 'leaf', name: '', childList: [] }] }]]).api.functionTree()).rejects.toThrow('name')
    await expect(fixture([{ page: { list: [{ id: 'u1' }], total: 1 } }]).api.userList({ companyId: 'c1' })).rejects.toThrow('name')
    await expect(fixture([[{ ...row, totalCount: '5' }]]).api.list({ companyId: company.id })).rejects.toThrow('totalCount')
    await expect(fixture([new Error('无权限')]).api.list({ companyId: company.id })).rejects.toThrow('无权限')
  })

  it('product实例补devicetype且本页不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.companyList()).resolves.toEqual([company])
    expect(captured.calls[0]?.url).toBe('/sys/office/getTenantCompanyList')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖全部公开方法并通过结构校验', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_TENANT_LOG_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_TENANT_LOG_METHODS).map(method => `productSettingTenantLog.${method}`).sort())
    expect(contracts['product-setting-tenant-log-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['[].moduleName', '[].functionName', '[].totalCount']))
    expect(contracts['product-setting-tenant-log-list']?.boundaries.join('\n')).toContain('pageType=1')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingTenantLogCapabilities, contracts })).toEqual([])
  })
})
