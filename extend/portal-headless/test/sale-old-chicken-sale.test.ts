import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_OLD_CHICKEN_SALE_CREATE_APPLICATION_PERMISSION,
  SALE_OLD_CHICKEN_SALE_DETAIL_PERMISSION,
  SALE_OLD_CHICKEN_SALE_MODULE_TYPE,
  SALE_OLD_CHICKEN_SALE_PAGE_PATH,
  SALE_OLD_CHICKEN_SALE_PERMISSION,
  SALE_OLD_CHICKEN_SALE_SET_PRICE_RANGE_PERMISSION,
  createSaleOldChickenSaleCapability,
  saleOldChickenSaleCapabilities,
} from '../src/capabilities/sale-old-chicken-sale.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/admin-api/sales/eliminated-chicken-sales-apply/page') return {
      list: [{ id: 11, salesCustomerCompanyName: '绿源组织', salesCategoryName: '老母鸡', salesVarietyName: '土鸡', salesCustomerName: '绿源农场', expectedSalesQuantity: 100, expectedSalesNum: 20, eliminatedAge: 500, maleAvgWeight: 2.1, femaleAvgWeight: 1.8, maleQuotePrice: 12.3, femaleQuotePrice: 11.2, applicantName: '张三', applyTime: '2026-09-24 10:00:00', statusName: '未提交', processInstanceId: null }],
      total: 1,
    } as T
    if (config.url === '/admin-api/sales/customer/page') return {
      list: [{ id: 7, salesCustomerCompanyId: 'org-7', salesCustomerCompanyName: '绿源组织', farmName: '绿源农场', customerId: 'customer-7', mobilePhone: '13800000000' }],
      total: 1,
    } as T
    if (config.url === '/org/organization/getRoleOrganizationTree') return [{ id: 8, name: '绿源工厂', isStandardUnit: 1, children: [] }] as T
    if (config.url === '/admin-api/sales/eliminated-chicken-sales-apply/control-config/get') return { salesQuantity: 0, malePriceMin: 0, malePriceMax: 0, femalePriceMin: 0, femalePriceMax: 0, expectedSaleDateMaxRange: 30 } as T
    if (config.url === '/admin-api/sales/eliminated-chicken-sales-apply/get') return {
      id: 11,
      applicantId: 1,
      applicantName: '张三',
      salesCustomerCompanyId: 'org-7',
      salesCustomerCompanyName: '绿源组织',
      factoryId: 8,
      salesVariety: 'native',
      salesCustomer: 'customer-7',
      salesCustomerName: '绿源农场',
      expectedSalesQuantity: 100,
      expectedSalesNum: 20,
      expectedSaleStartDate: '2026-10-01',
      expectedSaleEndDate: '2026-10-10',
      eliminatedAge: 500,
      maleAvgWeight: 2.1,
      femaleAvgWeight: 1.8,
      maleQuotePrice: 12.3,
      femaleQuotePrice: 11.2,
      applyReason: '',
      attachments: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }],
      processInstanceId: null,
    } as T
    if (config.url === '/admin-api/sales/eliminated-chicken-sales-apply/create') return 99 as T
    if (config.url === '/admin-api/sales/eliminated-chicken-sales-apply/control-config/save' || config.url === '/admin-api/sales/eliminated-chicken-sales-apply/delete') return true as T
    throw new Error(`未配置请求：${config.method} ${config.url}`)
  }
  return { api: createSaleOldChickenSaleCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const config = {
  salesQuantity: 100,
  malePriceMin: 0.01,
  malePriceMax: 1.25,
  femalePriceMin: null,
  femalePriceMax: null,
  expectedSaleDateMaxRange: 30,
}

const form = {
  applicantId: 1,
  applicantName: '张三',
  salesCustomerCompanyId: 'org-7',
  salesCustomerCompanyName: '绿源组织',
  factoryId: 8,
  salesVariety: 'native',
  salesCustomer: 'customer-7',
  salesCustomerName: '绿源农场',
  expectedSalesQuantity: 100,
  expectedSalesNum: 20,
  eliminatedAge: 500,
  maleAvgWeight: 2.1,
  femaleAvgWeight: 1.8,
  maleQuotePrice: 12.3,
  femaleQuotePrice: 11.2,
  expectedSaleDateRange: ['2026-10-01', '2026-10-10'] as [string, string],
  applyReason: '',
  attachments: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }],
}

describe('sale-old-chicken-sale 系统设置/销售设置/老母鸡销售', () => {
  it('逐页锁定Portal列表、价格管控、008申请表单、候选依赖、权限和Java路由', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/old-chicken-sale/list.vue')
    const configPage = read(portalRoot, 'app/portal/views/dashboard/sale/setting/old-chicken-sale/[mode]/[id].vue')
    const formPage = read(portalRoot, 'app/portal/views/simple/sales/form/008/page/pc/edit/index.vue')
    const mobilePage = read(portalRoot, 'app/portal/views/simple/sales/form/008/page/mobile/edit/index.vue')
    const customer = read(portalRoot, 'app/portal/views/dashboard/sale/visit/visit-list/components/ModalCustomerList.vue')
    const controller = read(join(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/eliminatedchickensales'), 'EliminatedChickenSalesApplyController.java')
    const createDto = read(join(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/eliminatedchickensales/vo'), 'EliminatedChickenSalesApplyCreateReqVO.java')
    const configDto = read(join(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/eliminatedchickensales/vo'), 'EliminatedChickenControlConfigSaveReqVO.java')
    expect(menu).toContain(`path: '${SALE_OLD_CHICKEN_SALE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_OLD_CHICKEN_SALE_PERMISSION}'`)
    for (const fragment of [
      'customLoad: async params =>',
      "http.get('/admin-api/sales/eliminated-chicken-sales-apply/page'",
      'query.applyTimeStart = params.applyTimeRange[0]',
      'delete query.applyTimeRange',
      `buttonPermissionFlag('${SALE_OLD_CHICKEN_SALE_SET_PRICE_RANGE_PERMISSION}')`,
      `buttonPermissionFlag('${SALE_OLD_CHICKEN_SALE_CREATE_APPLICATION_PERMISSION}')`,
      `buttonPermissionFlag('${SALE_OLD_CHICKEN_SALE_DETAIL_PERMISSION}')`,
      "http.delete('/admin-api/sales/eliminated-chicken-sales-apply/delete'",
      "path: 'simple/sales/form/008'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.get('/admin-api/sales/eliminated-chicken-sales-apply/control-config/get')",
      "http.post('/admin-api/sales/eliminated-chicken-sales-apply/control-config/save'",
      'salesQuantity: 0',
      'expectedSaleDateMaxRange: 30',
      "salesQuantity: [\n      { required: true",
    ]) expect(configPage).toContain(fragment)
    for (const fragment of [
      "bpmProcessDefineKey: 'eliminated_chicken_sales_apply'",
      'expectedSaleStartDate: formState.value.expectedSaleDateRange[0]',
      'expectedSaleEndDate: formState.value.expectedSaleDateRange[1]',
      "http.post('/admin-api/sales/eliminated-chicken-sales-apply/create'",
      "http('/admin-api/sales/eliminated-chicken-sales-apply/get'",
      'customerId, farmName, salesCustomerCompanyName, salesCustomerCompanyId',
      'expectedSalesQuantity: 1',
      'expectedSalesNum: null',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of [':maxlength="200"', 'expectedSaleStartDate', 'expectedSaleEndDate', 'attachments']) expect(mobilePage).toContain(fragment)
    for (const fragment of [
      'isOldChickenApply',
      "'/admin-api/sales/customer/page'",
      'customerId',
    ]) expect(customer).toContain(fragment)
    for (const fragment of ['@RequestMapping("/sales/eliminated-chicken-sales-apply")', '@PostMapping("/create")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping("/control-config/get")', '@PostMapping("/control-config/save")']) expect(controller).toContain(fragment)
    for (const fragment of ['@NotNull', 'applicantId', 'factoryId', 'expectedSalesQuantity', 'expectedSalesNum', 'expectedSaleStartDate', 'expectedSaleEndDate']) expect(createDto).toContain(fragment)
    for (const fragment of ['salesQuantity', 'malePriceMin', 'malePriceMax', 'femalePriceMin', 'femalePriceMax', 'expectedSaleDateMaxRange']) expect(configDto).toContain(fragment)
  })

  it('能力绑定列表页、页面权限、销售module-type和platform实例', () => {
    expect(saleOldChickenSaleCapabilities).toHaveLength(11)
    expect(saleOldChickenSaleCapabilities.map(item => item.id)).toEqual(expect.arrayContaining([
      'sale-old-chicken-sale-list',
      'sale-old-chicken-sale-customer-search',
      'sale-old-chicken-sale-organization-tree',
      'sale-old-chicken-sale-get-control-config',
      'sale-old-chicken-sale-prepare-control-config',
      'sale-old-chicken-sale-save-control-config',
      'sale-old-chicken-sale-get',
      'sale-old-chicken-sale-prepare-create',
      'sale-old-chicken-sale-create',
      'sale-old-chicken-sale-prepare-remove',
      'sale-old-chicken-sale-remove',
    ]))
    expect(saleOldChickenSaleCapabilities.every(item => item.pagePath === SALE_OLD_CHICKEN_SALE_PAGE_PATH && item.permission === SALE_OLD_CHICKEN_SALE_PERMISSION && item.moduleType === SALE_OLD_CHICKEN_SALE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(SALE_OLD_CHICKEN_SALE_SET_PRICE_RANGE_PERMISSION).toBe('setting:old-chicken-sale:set-price-range')
    expect(SALE_OLD_CHICKEN_SALE_CREATE_APPLICATION_PERMISSION).toBe('setting:old-chicken-sale:create-sales-apply')
    expect(SALE_OLD_CHICKEN_SALE_DETAIL_PERMISSION).toBe('setting:old-chicken-sale:detail-sales-apply')
    const catalog = createCatalog({ capabilities: saleOldChickenSaleCapabilities })
    expect(catalog.describe('sale-old-chicken-sale-list').ok).toBe(true)
  })

  it('列表、客户候选、组织树、详情和价格配置按Portal请求形状执行', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({ total: 1, list: [{ id: 11, salesCustomerCompanyName: '绿源组织' }] })
    expect(calls[0]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/page', method: 'get', params: { order: '', orderField: '', pageNo: 1, pageSize: 20, salesVariety: null, orgId: null, applicantName: null } })
    await expect(api.customerSearch({ farmName: '绿源' })).resolves.toMatchObject({ total: 1, list: [{ customerId: 'customer-7', farmName: '绿源农场' }] })
    expect(calls[1]).toEqual({ url: '/admin-api/sales/customer/page', method: 'get', params: { pageNo: 1, pageSize: 20, farmName: '绿源' }, moduleType: 60 })
    await expect(api.organizationTree()).resolves.toEqual([{ id: 8, name: '绿源工厂', isStandardUnit: 1, children: [] }])
    expect(calls[2]).toEqual({ url: '/org/organization/getRoleOrganizationTree', method: 'get', params: {} })
    await expect(api.getControlConfig()).resolves.toEqual({ salesQuantity: 0, malePriceMin: 0, malePriceMax: 0, femalePriceMin: 0, femalePriceMax: 0, expectedSaleDateMaxRange: 30 })
    expect(calls[3]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/control-config/get', method: 'get' })
    await expect(api.get({ id: 11 })).resolves.toMatchObject({ id: 11, salesCustomer: 'customer-7', attachments: [{ name: 'a.pdf' }] })
    expect(calls[4]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/get', method: 'get', params: { id: 11 } })
  })

  it('价格管控和008申请严格保留Portal字段转换与prepare→submit→cancel路径', async () => {
    const { api, calls } = fixture()
    const configPreparation = api.prepareControlConfig({ form: config })
    expect(configPreparation).toEqual({ draft: config })
    await expect(api.saveControlConfig(configPreparation)).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/control-config/save', method: 'post', data: config })

    const applicationPreparation = api.prepareCreate({ form })
    expect(applicationPreparation).toEqual({ draft: {
      applicantId: 1,
      applicantName: '张三',
      salesCustomerCompanyId: 'org-7',
      salesCustomerCompanyName: '绿源组织',
      factoryId: 8,
      salesVariety: 'native',
      salesCustomer: 'customer-7',
      salesCustomerName: '绿源农场',
      expectedSalesQuantity: 100,
      expectedSalesNum: 20,
      eliminatedAge: 500,
      maleAvgWeight: 2.1,
      femaleAvgWeight: 1.8,
      maleQuotePrice: 12.3,
      femaleQuotePrice: 11.2,
      expectedSaleStartDate: '2026-10-01',
      expectedSaleEndDate: '2026-10-10',
      applyReason: '',
      attachments: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }],
    } })
    const created = await api.create(applicationPreparation)
    expect(created).toBe(99)
    expect(calls[1]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/create', method: 'post', data: applicationPreparation.draft })

    expect(api.prepareRemove({ id: 11 })).toEqual({ id: 11 })
    await expect(api.remove({ id: 11 })).resolves.toBe(true)
    expect(calls[2]).toEqual({ url: '/admin-api/sales/eliminated-chicken-sales-apply/delete', method: 'delete', params: { id: 11 } })
  })

  it('页面必填、后端边界、客户长选项、日期、分页和坏响应在请求前失败', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareControlConfig({ form: { ...config, malePriceMax: 0 } })).toThrow('必须为空')
    expect(() => api.prepareControlConfig({ form: { ...config, malePriceMax: 0.005 } })).toThrow('2位')
    expect(() => api.prepareControlConfig({ form: { ...config, malePriceMax: 0.5, malePriceMin: 1 } })).toThrow('不能小于')
    expect(() => api.prepareControlConfig({ form: { ...config, expectedSaleDateMaxRange: 0 } })).toThrow('不能小于')
    expect(() => api.prepareCreate({ form: { ...form, expectedSalesNum: null } as never })).toThrow('expectedSalesNum')
    expect(() => api.prepareCreate({ form: { ...form, expectedSaleStartDate: '2026-10-01', expectedSaleEndDate: '2026-09-01', expectedSaleDateRange: undefined } as never })).toThrow('不能早于')
    expect(() => api.prepareCreate({ form: { ...form, applyReason: 'x'.repeat(201) } })).toThrow('200')
    expect(() => api.prepareCreate({ form: { ...form, maleAvgWeight: 1.001 } })).toThrow('2位')
    expect(() => api.prepareRemove({ id: ' ' })).toThrow('申请ID')
    await expect(api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(api.customerSearch()).rejects.toThrow('至少需要')
    expect(calls).toHaveLength(0)
    await expect(createSaleOldChickenSaleCapability(async () => ({ list: [], total: -1 } as never)).list()).rejects.toThrow('有效list或total')
    await expect(createSaleOldChickenSaleCapability(async () => ({ salesQuantity: 0, malePriceMin: 'bad' } as never)).getControlConfig()).rejects.toThrow('malePriceMin')
    await expect(createSaleOldChickenSaleCapability(async () => false as never).remove({ id: 11 })).rejects.toThrow('不是true')
  })
})
