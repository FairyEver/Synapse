import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_LOW_PRICE_MODULE_TYPE,
  SALE_LOW_PRICE_PAGE_PATH,
  SALE_LOW_PRICE_PERMISSION,
  createSaleLowPriceCapability,
  saleLowPriceCapabilities,
} from '../src/capabilities/sale-low-price.js'
import { SALE_LOW_PRICE_AI_CONTRACTS } from '../src/catalog/contracts-sale-low-price.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const config = {
  id: 701,
  parentCategoryId: 100,
  parentCategoryName: '鸡类',
  categoryId: 1165,
  categoryName: '肉鸡',
  categoryFullName: '鸡类>>肉鸡',
  skuSpecsText: '规格A',
  skus: [{ id: 801, itemId: 26542, skuId: 14634, itemName: '商品A', specInfo: '规格A' }],
  rules: [{ id: 901, sortNo: 1, qtyLowerOp: '>=', qtyLowerValue: 1000, qtyUpperOp: '<', qtyUpperValue: 10000, priceLowerOp: '>', priceLowerValue: 0.2, priceUpperOp: '<', priceUpperValue: 0.3, approvalTag: 'chick_1' }],
  updaterId: 1,
  updaterName: '张三',
  updateTime: '2026-09-24 10:00:00',
  createTime: '2026-09-23 10:00:00',
}

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(requestConfig: PortalRequestConfig) => {
    calls.push(requestConfig)
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/categoryOptions') return [{ parentCategoryId: 100, parentCategoryName: '鸡类', categoryId: 1165, categoryName: '肉鸡', categoryFullName: '鸡类>>肉鸡' }] as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/page') return { list: [config], total: 1 } as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/skuTree/categories') return [{ parentCategoryId: 100, categoryId: 1165, categoryName: '肉鸡', disabled: false }] as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/skuTree/skus') return [{ nodeType: 'SKU', parentCategoryId: 100, categoryId: 1165, itemId: 26542, itemName: '商品A', skuId: 14634, specInfo: '规格A', disabled: false }] as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/get') return config as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/create') return 702 as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/update') return true as T
    if (requestConfig.url === 'admin-api/priceControlStandardConfig/delete') return true as T
    throw new Error(`未配置请求：${requestConfig.method} ${requestConfig.url}`)
  }
  return { api: createSaleLowPriceCapability(request), calls }
}

const standard = {
  qtyLowerOp: '>=',
  qtyLowerValue: 1000,
  qtyUpperOp: '<',
  qtyUpperValue: 10000,
  priceLowerOp: '>',
  priceLowerValue: 0.2,
  priceUpperOp: '<',
  priceUpperValue: 0.3,
  approvalTag: 'chick_1',
  uid: 'local-row-only',
  sortNo: 1,
}

const form = {
  parentCategoryId: 100,
  controlCategoryId: 1165,
  skus: [{ itemId: 26542, itemName: '商品A', skuId: 14634, specInfo: '规格A' }],
  standards: [standard],
}

describe('sale-low-price 系统设置/销售设置/价格管控/低价设置', () => {
  it('逐页锁定菜单、页面请求、表单权限和Java校验', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/price-control/low-price/list.vue')
    const formPage = read(portalRoot, 'app/portal/views/dashboard/sale/setting/price-control/low-price/[mode]/[id].vue')
    const controller = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolstandardconfig/PriceControlStandardConfigController.java')
    const saveVo = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolstandardconfig/vo/PriceControlStandardConfigSaveReqVO.java')
    const ruleVo = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/lowprice/pricecontrolstandardconfig/vo/PriceControlStandardConfigRuleVO.java')
    const service = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/service/lowprice/pricecontrolstandardconfig/PriceControlStandardConfigServiceImpl.java')
    expect(menu).toContain(`path: '${SALE_LOW_PRICE_PAGE_PATH}'`)
    expect(menu).toContain(`permission:'/dashboard/sale/setting/price-control/low-price'`)
    for (const fragment of [
      "http.get('admin-api/priceControlStandardConfig/categoryOptions')",
      "http.get('admin-api/priceControlStandardConfig/page'",
      "http.delete('admin-api/priceControlStandardConfig/delete'",
      'setting:price-control:low-price:create',
      'setting:price-control:low-price:edit',
      'setting:price-control:low-price:delete',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.get('admin-api/priceControlStandardConfig/skuTree/categories'",
      "http.get('admin-api/priceControlStandardConfig/skuTree/skus'",
      "http.get('admin-api/priceControlStandardConfig/get'",
      "http.put('admin-api/priceControlStandardConfig/update'",
      "http.post('admin-api/priceControlStandardConfig/create'",
      'getQtyRangeOrderError',
      'getPriceRangeOrderError',
      '至少完整填写下限或上限一侧',
      'delete item.sortNo',
      'itemName: sku.itemName',
      'specInfo: sku.specInfo',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ['@RequestMapping("/priceControlStandardConfig")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/skuTree/categories")', '@GetMapping("/skuTree/skus")']) expect(controller).toContain(fragment)
    for (const fragment of ['@NotNull', '@NotEmpty', 'parentCategoryId', 'categoryId', 'List<PriceControlStandardConfigSkuVO>', 'List<PriceControlStandardConfigRuleVO>']) expect(saveVo).toContain(fragment)
    for (const fragment of ['@Pattern', 'qtyLowerOp', 'qtyUpperOp', 'priceLowerOp', 'priceUpperOp', 'approvalTag']) expect(ruleVo).toContain(fragment)
    for (const fragment of ['管控商品列表中存在重复的规格', '的低于指导价须至少录入一侧', '范围不能重叠', 'selectUsedSkuIds', 'syncRules', 'validateDeletableByTradeLowPriceRefs']) expect(service).toContain(fragment)
  })

  it('能力绑定页面、销售module-type、权限和platform实例', () => {
    expect(saleLowPriceCapabilities).toHaveLength(Object.keys(SALE_LOW_PRICE_AI_CONTRACTS).length)
    expect(saleLowPriceCapabilities.every(item => item.pagePath === SALE_LOW_PRICE_PAGE_PATH && item.permission === SALE_LOW_PRICE_PERMISSION && item.moduleType === SALE_LOW_PRICE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(createCatalog({ capabilities: saleLowPriceCapabilities }).describe('sale-low-price-list').ok).toBe(true)
  })

  it('列表、候选和详情严格保留Portal请求形状', async () => {
    const { api, calls } = fixture()
    await expect(api.categoryOptions()).resolves.toMatchObject([{ categoryId: 1165, categoryFullName: '鸡类>>肉鸡' }])
    expect(calls[0]).toEqual({ url: 'admin-api/priceControlStandardConfig/categoryOptions', method: 'get' })
    await expect(api.list({ pageNo: 2, pageSize: 50, categoryId: 1165, operatorKeyword: '张', updateTimeRange: ['2026-09-01', '2026-09-24'] })).resolves.toMatchObject({ total: 1, list: [{ id: 701, rules: [{ id: 901 }] }] })
    expect(calls[1]).toEqual({ url: 'admin-api/priceControlStandardConfig/page', method: 'get', params: { order: '', orderField: '', pageNo: 2, pageSize: 50, categoryId: 1165, operatorKeyword: '张', updateTimeStart: '2026-09-01', updateTimeEnd: '2026-09-24' } })
    await expect(api.skuTreeCategories()).resolves.toEqual([{ parentCategoryId: 100, categoryId: 1165, categoryName: '肉鸡', disabled: false }])
    await expect(api.skuTreeSkus({ categoryId: 1165, excludeConfigId: 701 })).resolves.toMatchObject([{ itemId: 26542, skuId: 14634, disabled: false }])
    await expect(api.get({ id: 701 })).resolves.toMatchObject({ id: 701, skus: [{ skuId: 14634 }], rules: [{ priceLowerValue: 0.2 }] })
    expect(calls[2]).toEqual({ url: 'admin-api/priceControlStandardConfig/skuTree/categories', method: 'get', params: {} })
    expect(calls[3]).toEqual({ url: 'admin-api/priceControlStandardConfig/skuTree/skus', method: 'get', params: { categoryId: 1165, excludeConfigId: 701 } })
    expect(calls[4]).toEqual({ url: 'admin-api/priceControlStandardConfig/get', method: 'get', params: { id: 701 } })
  })

  it('新增和编辑严格生成页面净提交体，并覆盖prepare→submit→回查路径', async () => {
    const { api, calls } = fixture()
    const createPreparation = api.prepareCreate({ form })
    expect(createPreparation).toEqual({ draft: {
      parentCategoryId: 100,
      categoryId: 1165,
      skus: [{ itemId: 26542, itemName: '商品A', skuId: 14634, specInfo: '规格A' }],
      rules: [{ qtyLowerOp: '>=', qtyLowerValue: 1000, qtyUpperOp: '<', qtyUpperValue: 10000, priceLowerOp: '>', priceLowerValue: 0.2, priceUpperOp: '<', priceUpperValue: 0.3, approvalTag: 'chick_1' }],
    } })
    await expect(api.create(createPreparation)).resolves.toBe(702)
    expect(calls[0]).toEqual({ url: 'admin-api/priceControlStandardConfig/create', method: 'post', data: createPreparation.draft })
    const updatePreparation = api.prepareUpdate({ form: { ...form, id: 701, standards: [{ ...standard, id: 901 }] } })
    expect(updatePreparation.draft).toMatchObject({ id: 701, rules: [{ id: 901 }] })
    expect(updatePreparation.draft.rules[0]).not.toHaveProperty('uid')
    expect(updatePreparation.draft.rules[0]).not.toHaveProperty('sortNo')
    await expect(api.update(updatePreparation)).resolves.toBe(true)
    expect(calls[1]).toEqual({ url: 'admin-api/priceControlStandardConfig/update', method: 'put', data: updatePreparation.draft })
  })

  it('删除确认与页面/Java规则在请求前失败', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 701 })).toEqual({ id: 701 })
    await expect(api.remove({ id: 701 })).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: 'admin-api/priceControlStandardConfig/delete', method: 'delete', params: { id: 701 } })
    expect(() => api.prepareCreate({ form: { ...form, skus: [] } })).toThrow('管控商品')
    expect(() => api.prepareCreate({ form: { ...form, standards: [{ ...standard, priceLowerOp: null, priceLowerValue: null, priceUpperOp: null, priceUpperValue: null }] } })).toThrow('至少录入一侧')
    expect(() => api.prepareCreate({ form: { ...form, standards: [{ ...standard, qtyLowerOp: '>=', qtyLowerValue: null }] } })).toThrow('qtyLower')
    expect(() => api.prepareCreate({ form: { ...form, standards: [{ ...standard, priceLowerValue: 1.001 }] } })).toThrow('2位')
    expect(() => api.prepareCreate({ form: { ...form, standards: [{ ...standard, qtyLowerValue: 100, qtyUpperValue: 10 }] } })).toThrow('数量下限')
    expect(() => api.prepareCreate({ form: { ...form, skus: [{ ...form.skus[0]! }, { ...form.skus[0]! }] } })).toThrow('重复')
    expect(calls).toHaveLength(1)
    await expect(createSaleLowPriceCapability(async () => ({ list: [], total: -1 } as never)).list()).rejects.toThrow('有效list或total')
    await expect(createSaleLowPriceCapability(async () => false as never).remove({ id: 701 })).rejects.toThrow('不是true')
  })

  it('AI说明契约覆盖全部能力且结构引用可验证', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(SALE_LOW_PRICE_AI_CONTRACTS, { definitions: saleLowPriceCapabilities, contracts: SALE_LOW_PRICE_AI_CONTRACTS })).toEqual([])
  })
})
