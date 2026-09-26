import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SALE_PRICE_CONTROL_MODULE_TYPE,
  SALE_PRICE_CONTROL_PAGE_PATH,
  SALE_PRICE_CONTROL_PERMISSION,
  createSalePriceControlCapability,
  salePriceControlCapabilities,
} from '../src/capabilities/sale-price-control.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const standardRow = {
  id: 101,
  orgId: 'org-1',
  officeName: '一厂',
  controlPeriod: '2099-01-01~2099-01-10',
  categoryId: 11,
  catName: '鸡类',
  itemId: 21,
  itemName: '商品A',
  skuId: 31,
  specInfo: '规格A',
  controlType: '按指导价',
  guidePrice: '3.60',
  updateTime: '2026-09-24 10:00:00',
  status: 1,
  applyId: 401,
  statusName: '生效',
  statusValue: 2,
  processInstanceId: null,
}

const applicationRow = {
  id: 401,
  orgId: 'org-1',
  orgFullName: '一厂',
  controlPeriod: '2099-01-01~2099-01-10',
  categoryId: 11,
  categoryFullName: '鸡类/商品A',
  createTime: '2026-09-24 10:00:00',
  approveTime: null,
  status: 1,
  statusName: '审批中',
  processInstanceId: null,
}

const detail = {
  id: 401,
  orgId: 'org-1',
  orgFullName: '一厂',
  controlStartDate: '2099-01-01',
  controlEndDate: '2099-01-10',
  controlPeriod: '2099-01-01~2099-01-10',
  categoryId: 11,
  parentCategoryId: 10,
  parentCategoryName: '鸡类',
  categoryName: '商品A',
  categoryFullName: '鸡类/商品A',
  controlType: 1,
  approvalTag: 'chick',
  applicantId: 1,
  applicantName: '张三',
  reason: '价格调整',
  attachments: [{ id: 7, name: '说明.pdf', url: 'https://oss.test/a.pdf', size: 0 }],
  processInstanceId: null,
  status: 1,
  statusName: '审批中',
  createTime: '2026-09-24 10:00:00',
  approveTime: null,
  voidTime: null,
  items: [{ id: 501, itemId: 21, skuId: 31, guidePrice: 3.6, unit: '只', itemName: '商品A', specInfo: '规格A' }],
}

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/admin-api/sales/price-control-config/categoryList') return [{ catId: 11, catName: '鸡类' }] as T
    if (config.url === '/admin-api/sales/price-control-config/list') return { list: [standardRow], total: 1 } as T
    if (config.url === 'admin-api/priceControlApply/categoryTree') return [{ catId: 10, parentId: 0, catName: '鸡类', level: '1', isLeaf: 0, children: [{ catId: 11, parentId: 10, catName: '商品A', level: '2', isLeaf: 1, children: [] }] }] as T
    if (config.url === '/admin-api/priceControlApply/page') return { list: [applicationRow], total: 1 } as T
    if (config.url === 'admin-api/priceControlApply/itemList') return [{ itemId: 21, itemName: '商品A', unit: '只', unit2: null, graySign: null }] as T
    if (config.url === 'admin-api/priceControlApply/skuList') return [{ skuId: 31, specInfo: '规格A' }] as T
    if (config.url === 'admin-api/priceControlApply/get') return detail as T
    if (config.url === 'admin-api/priceControlApply/create') return 401 as T
    if (config.url === 'admin-api/priceControlApply/cancel') return true as T
    if (config.url === '/admin-api/priceControlApply/void') return true as T
    if (config.url === '/admin-api/sales/price-control-standards/create') return 102 as T
    if (config.url === '/admin-api/sales/price-control-standards/update') return true as T
    if (config.url === '/admin-api/sales/price-control-standards/enableOrStop') return true as T
    if (config.url === '/admin-api/sales/price-control-standards/approval-status?id=101') return null as T
    if (config.url === '/admin-api/sales/price-control-standards/delete?id=101') return true as T
    if (config.url === '/sales/third-party-payment/setting' && config.method === 'get') return false as T
    if (config.url === '/sales/third-party-payment/setting' && config.method === 'put') return true as T
    throw new Error(`未配置请求：${config.method} ${config.url}`)
  }
  return { api: createSalePriceControlCapability(request), calls }
}

const form = {
  orgId: 1,
  controlDate: ['2099-01-01', '2099-01-10'] as [string, string],
  controlType: 1,
  categoryId: 11,
  goodsList: [{ uid: 'row-1', itemId: 21, skuId: 31, guidePrice: 3.6, unit: '只', itemName: '会被剔除', skuOptions: [{ value: 31 }] }],
  approvalTag: 'chick',
  reason: '价格调整',
  attachments: [{ name: '说明.pdf', url: 'https://oss.test/a.pdf', size: 0 }],
}

describe('sale-price-control 系统设置/销售设置/价格管控', () => {
  it('逐页锁定菜单、列表、005表单、权限、Java校验和可达边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/price-control/list.vue')
    const standardFormPage = read(portalRoot, 'app/portal/views/dashboard/sale/setting/price-control/[mode]/[id].vue')
    const formPage = read(portalRoot, 'app/portal/views/simple/sales/form/005/page/pc/edit/index.vue')
    const controller = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolapply/PriceControlApplyController.java')
    const saveVo = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolapply/vo/PriceControlApplySaveReqVO.java')
    const itemVo = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolapply/vo/PriceControlApplyItemVO.java')
    const service = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/service/lowprice/pricecontrolapply/PriceControlApplyServiceImpl.java')
    const standardController = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolstandards/PriceControlStandardsController.java')
    const standardSaveVo = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolstandards/vo/PriceControlStandardsSaveReqVO.java')
    expect(menu).toContain(`path: '${SALE_PRICE_CONTROL_PAGE_PATH}'`)
    expect(menu).toContain(`permission:'${SALE_PRICE_CONTROL_PERMISSION}'`)
    for (const fragment of [
      "http('/admin-api/sales/price-control-config/categoryList')",
      "http.get('/admin-api/sales/price-control-config/list'",
      "http.get('/admin-api/priceControlApply/page'",
      "http.delete('admin-api/priceControlApply/cancel'",
      "http.put('/admin-api/priceControlApply/void'",
      "http.put('/admin-api/sales/price-control-standards/enableOrStop'",
      'setting:price-control:guide-apply:withdraw',
      'setting:price-control:guide-apply:resubmit',
      'setting:price-control:guide-apply:void',
      "http.get('/sales/third-party-payment/setting')",
      "http.put('/sales/third-party-payment/setting'",
      "path: 'simple/sales/form/005'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      '/admin-api/sales/price-control-standards/create',
      '/admin-api/sales/price-control-standards/update',
      "method: route.params.mode === 'edit' ? 'PUT' : 'POST'",
      'controlType: 1',
      "omit(form, ['controlDate', 'controlPeriod'])",
      'controlStartDate',
      'controlEndDate',
    ]) expect(standardFormPage).toContain(fragment)
    for (const fragment of [
      'endDay.isBefore(startDay, \'day\')',
      'endDay.isAfter(dayjs(), \'day\')',
      'goodsList.map(({',
      'uid, skuOptions, itemId, skuId, guidePrice, unit,',
      'controlStartDate: startStr || null',
      'controlEndDate: endStr || null',
      'reason: formState.value.reason || null',
      "bpmProcessDefineKey: 'guide_price_apply'",
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ['@RequestMapping("/priceControlApply")', '@PostMapping("/create")', '@DeleteMapping("/cancel")', '@PutMapping("/void")', '@GetMapping("/page")', '@GetMapping("/categoryTree")']) expect(controller).toContain(fragment)
    for (const fragment of ['@NotEmpty', 'controlStartDate', 'controlEndDate', 'categoryId', 'approvalTag', '@Size(max = 500', 'List<PriceControlApplyItemVO> items']) expect(saveVo).toContain(fragment)
    for (const fragment of ['@NotNull', 'itemId', 'skuId', 'guidePrice']) expect(itemVo).toContain(fragment)
    for (const fragment of ['仅审批中的申请允许撤销', '只有申请人可以撤销申请', 'guide_price_apply', 'validateSkuConflict', 'createProcessInstance']) expect(service).toContain(fragment)
    for (const fragment of ['@RequestMapping("/sales/price-control-standards")', '@PostMapping("/create")', '@PutMapping("/update")']) expect(standardController).toContain(fragment)
    for (const fragment of ['private String orgId', 'private LocalDate controlStartDate', 'private LocalDate controlEndDate', 'private Integer categoryId', 'private Integer itemId', 'private Integer skuId', 'private Integer controlType', 'private BigDecimal guidePrice']) expect(standardSaveVo).toContain(fragment)
  })

  it('能力绑定价格管控页面、权限、销售module-type和platform实例', async () => {
    const { createCatalog } = await import('../src/catalog/index.js')
    const { SALE_PRICE_CONTROL_AI_CONTRACTS } = await import('../src/catalog/contracts-sale-price-control.js')
    expect(salePriceControlCapabilities).toHaveLength(Object.keys(SALE_PRICE_CONTROL_AI_CONTRACTS).length)
    expect(salePriceControlCapabilities.every(item => item.pagePath === SALE_PRICE_CONTROL_PAGE_PATH && item.permission === SALE_PRICE_CONTROL_PERMISSION && item.moduleType === SALE_PRICE_CONTROL_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(createCatalog({ capabilities: salePriceControlCapabilities }).describe('sale-price-control-application-list').ok).toBe(true)
  })

  it('列表、候选、详情和第三方开关严格保留Portal请求形状', async () => {
    const { api, calls } = fixture()
    await expect(api.categoryList()).resolves.toEqual([{ catId: 11, catName: '鸡类' }])
    expect(calls[0]).toEqual({ url: '/admin-api/sales/price-control-config/categoryList', method: 'get' })
    await expect(api.standardList({ pageNo: 2, pageSize: 50, categoryId: 11, itemName: '商品', officeIds: ['10', 11] })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]).toEqual({ url: '/admin-api/sales/price-control-config/list', method: 'get', params: { pageNo: 2, pageSize: 50, categoryId: 11, itemName: '商品', officeId: '10,11' } })
    await expect(api.applicationList({ pageNo: 3, pageSize: 10, categoryId: 11, officeIds: [1, 2], controlPeriod: ['2026-09-01', '2026-09-20'], status: 1 })).resolves.toMatchObject({ list: [{ id: 401 }] })
    expect(calls[2]).toEqual({ url: '/admin-api/priceControlApply/page', method: 'get', params: { pageNo: 3, pageSize: 10, categoryId: 11, orgIds: '1,2', status: 1, controlPeriodStart: '2026-09-01', controlPeriodEnd: '2026-09-20' } })
    await expect(api.applicationCategoryTree()).resolves.toMatchObject([{ disabled: true, parentId: 0, children: [{ disabled: false, catId: 11 }] }])
    await expect(api.applicationItemList({ categoryId: 11 })).resolves.toEqual([{ itemId: 21, itemName: '商品A', unit: '只', unit2: null, graySign: null }])
    await expect(api.applicationSkuList({ itemId: 21 })).resolves.toEqual([{ skuId: 31, specInfo: '规格A' }])
    await expect(api.applicationGet({ id: 401 })).resolves.toMatchObject({ id: 401, items: [{ id: 501, itemName: '商品A' }] })
    expect(calls[3]).toEqual({ url: 'admin-api/priceControlApply/categoryTree', method: 'get' })
    expect(calls[4]).toEqual({ url: 'admin-api/priceControlApply/itemList', method: 'get', params: { categoryId: 11 } })
    expect(calls[5]).toEqual({ url: 'admin-api/priceControlApply/skuList', method: 'get', params: { itemId: 21 } })
    expect(calls[6]).toEqual({ url: 'admin-api/priceControlApply/get', method: 'get', params: { id: 401 } })
    await expect(api.getThirdPartySetting()).resolves.toBe(false)
    await expect(api.setThirdPartySetting({ enabled: true })).resolves.toBe(true)
    expect(calls.at(-1)).toEqual({ url: '/sales/third-party-payment/setting', method: 'put', data: { enabled: true } })
  })

  it('指导价申请严格保留PC提交字段，并覆盖prepare→submit→cancel/void', async () => {
    const { api, calls } = fixture()
    const preparation = api.prepareCreate({ form })
    expect(preparation).toEqual({ draft: {
      orgId: '1',
      controlStartDate: '2099-01-01',
      controlEndDate: '2099-01-10',
      categoryId: 11,
      controlType: 1,
      approvalTag: 'chick',
      reason: '价格调整',
      attachments: [{ name: '说明.pdf', url: 'https://oss.test/a.pdf', size: 0 }],
      items: [{ itemId: 21, skuId: 31, guidePrice: 3.6, unit: '只' }],
    } })
    await expect(api.create(preparation)).resolves.toBe(401)
    expect(calls[0]).toEqual({ url: 'admin-api/priceControlApply/create', method: 'post', data: preparation.draft })
    expect(api.prepareWithdraw({ id: 401, status: 1 })).toEqual({ id: 401, status: 1 })
    await expect(api.withdraw({ id: 401, status: 1 })).resolves.toBe(true)
    expect(calls[1]).toEqual({ url: 'admin-api/priceControlApply/cancel', method: 'delete', params: { id: 401 } })
    expect(api.prepareVoid({ id: 401, status: 2 })).toEqual({ id: 401, status: 2 })
    await expect(api.void({ id: 401, status: 2 })).resolves.toBe(true)
    expect(calls[2]).toEqual({ url: '/admin-api/priceControlApply/void', method: 'put', data: null, params: { id: 401 } })
  })

  it('隐藏价格管控标准表单严格按prepare→submit保留字段，并按模式选择POST/PUT', async () => {
    const { api, calls } = fixture()
    const createForm = {
      orgId: 'org-1',
      controlDate: ['2099-01-01', '2099-01-10'] as [string, string],
      categoryId: 11,
      itemId: 21,
      skuId: 31,
      controlType: 1,
      guidePrice: 3.6,
      controlPeriod: '被Portal omit',
      extra: '按Portal spread保留',
    }
    const create = api.prepareStandardCreate({ form: createForm })
    expect(create).toEqual({ draft: {
      orgId: 'org-1', categoryId: 11, itemId: 21, skuId: 31, controlType: 1, guidePrice: 3.6,
      extra: '按Portal spread保留', id: null, status: 1,
      controlStartDate: '2099-01-01', controlEndDate: '2099-01-10',
    } })
    expect(calls).toHaveLength(0)
    await expect(api.standardCreate(create)).resolves.toBe(102)
    const updateForm = { ...createForm, id: 101, status: 1 }
    const update = api.prepareStandardUpdate({ form: updateForm })
    expect(update.draft).toMatchObject({ id: 101, status: 1, controlStartDate: '2099-01-01', controlEndDate: '2099-01-10' })
    await expect(api.standardUpdate(update)).resolves.toBe(true)
    expect(calls).toEqual([
      { url: '/admin-api/sales/price-control-standards/create', method: 'post', data: create.draft },
      { url: '/admin-api/sales/price-control-standards/update', method: 'put', data: update.draft },
    ])
    expect(api.cancelStandardCreate()).toEqual({ cancelled: true })
    expect(api.cancelStandardUpdate()).toEqual({ cancelled: true })
  })

  it('标准停用、删除审批校验和删除严格保留Portal动作条件与请求体', async () => {
    const { api, calls } = fixture()
    const stop = api.prepareStop({ record: standardRow })
    expect(stop).toEqual({ record: standardRow })
    await expect(api.stop(stop)).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/admin-api/sales/price-control-standards/enableOrStop', method: 'put', data: { ...standardRow, controlType: 1, status: 0, controlStartDate: '2099-01-01', controlEndDate: '2099-01-10' } })
    await expect(api.standardApprovalStatus({ id: 101 })).resolves.toBeNull()
    expect(calls[1]).toEqual({ url: '/admin-api/sales/price-control-standards/approval-status?id=101', method: 'get' })
    await expect(api.prepareRemove({ id: 101 })).resolves.toEqual({ id: 101 })
    expect(calls[2]).toEqual({ url: '/admin-api/sales/price-control-standards/approval-status?id=101', method: 'get' })
    await expect(api.remove({ id: 101 })).resolves.toBe(true)
    expect(calls[3]).toEqual({ url: '/admin-api/sales/price-control-standards/delete?id=101', method: 'delete' })
  })

  it('表单、按钮状态、分页和坏响应在请求前失败', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, orgId: null } })).toThrow('orgId')
    expect(() => api.prepareCreate({ form: { ...form, controlDate: ['2099-01-10', '2099-01-01'] } as never })).toThrow('不能早于')
    expect(() => api.prepareCreate({ form: { ...form, controlDate: ['2000-01-01', '2000-01-10'] } as never })).toThrow('未来日期')
    expect(() => api.prepareCreate({ form: { ...form, controlType: 3 } })).toThrow('controlType')
    expect(() => api.prepareCreate({ form: { ...form, goodsList: [] } })).toThrow('goodsList')
    expect(() => api.prepareCreate({ form: { ...form, goodsList: [{ itemId: 21, skuId: 31, guidePrice: 1.001, unit: '只' }] } })).toThrow('2位')
    expect(() => api.prepareCreate({ form: { ...form, reason: 'x'.repeat(501) } })).toThrow('500')
    expect(() => api.prepareWithdraw({ id: 401, status: 2 })).toThrow('审批中')
    expect(() => api.prepareVoid({ id: 401, status: 1 })).toThrow('审批通过')
    expect(() => api.prepareStop({ record: { ...standardRow, statusValue: 1 } })).toThrow('已生效')
    expect(() => api.prepareStandardCreate({ form: { orgId: 'org-1', controlDate: [], categoryId: 11, itemId: 21, skuId: 31, controlType: 1, guidePrice: 3.6 } })).toThrow('controlDate')
    expect(() => api.prepareStandardUpdate({ form: { orgId: 'org-1', controlDate: ['2099-01-01', '2099-01-10'], categoryId: 11, itemId: 21, skuId: 31, controlType: 1, guidePrice: 3.6 } as never })).toThrow('ID')
    await expect(api.standardList({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(calls).toHaveLength(0)
    await expect(createSalePriceControlCapability(async () => ({ list: [], total: -1 } as never)).standardList()).rejects.toThrow('有效list或total')
    await expect(createSalePriceControlCapability(async () => false as never).remove({ id: 101 })).rejects.toThrow('不是true')
  })

  it('AI说明契约覆盖全部能力且结构引用可验证', async () => {
    const { SALE_PRICE_CONTROL_AI_CONTRACTS } = await import('../src/catalog/contracts-sale-price-control.js')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(SALE_PRICE_CONTROL_AI_CONTRACTS, { definitions: salePriceControlCapabilities, contracts: SALE_PRICE_CONTROL_AI_CONTRACTS })).toEqual([])
  })
})
