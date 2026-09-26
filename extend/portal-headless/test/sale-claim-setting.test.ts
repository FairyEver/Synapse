import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_CLAIM_SETTING_CREATE_PERMISSION,
  SALE_CLAIM_SETTING_DELETE_PERMISSION,
  SALE_CLAIM_SETTING_EDIT_PERMISSION,
  SALE_CLAIM_SETTING_MODULE_TYPE,
  SALE_CLAIM_SETTING_PAGE_PATH,
  SALE_CLAIM_SETTING_PERMISSION,
  SALE_CLAIM_SETTING_REASON_PERMISSION,
  createSaleClaimSettingCapability,
  saleClaimSettingCapabilities,
} from '../src/capabilities/sale-claim-setting.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/admin-api/claim/claim-config/page') return { list: [{ id: 11, claimType: 1, categoryId: '59,66', categoryName: '一类,二类', startDays: 1, endDays: 7 }], total: 1 } as T
    if (config.url === '/admin-api/claim/claim-config/get') return { id: 11, claimType: 1, categoryId: '59,66', categoryName: '一类,二类', startDays: 1, endDays: 7 } as T
    if (config.url === '/admin-api/claim/claim-config/categories') return [{ type: 'category', catId: 59, parentId: 0, catName: '大类', level: 1, label: '大类', value: 59, children: [{ type: 'category', catId: 591, parentId: 59, catName: '子类', level: 2, label: '子类', value: 591, children: [] }] }] as T
    if (config.url === '/admin-api/claim/claim-reason/list') return [{ id: 21, content: '破损' }] as T
    if (config.url === '/admin-api/claim/claim-config/create' || config.url === '/admin-api/claim/claim-config/update' || config.url === '/admin-api/claim/claim-config/delete' || config.url === '/admin-api/claim/claim-reason/save') return true as T
    throw new Error(`未配置请求：${config.method} ${config.url}`)
  }
  return { api: createSaleClaimSettingCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form = {
  id: '',
  claimType: 1,
  categoryId: [59, 66],
  startDays: 1,
  endDays: 7,
}

describe('sale-claim-setting 系统设置/销售设置/理赔配置', () => {
  it('逐页锁定Portal列表、编辑、原因维护、权限和Java路由', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/sale/setting/claim-setting.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/claim-setting/list.vue')
    const detail = read(portalRoot, 'app/portal/views/dashboard/sale/setting/claim-setting/[mode]/[id].vue')
    const reason = read(portalRoot, 'app/portal/views/dashboard/sale/setting/claim-setting/reason/[id].vue')
    const controller = read(join(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/claim'), 'ClaimSettingController.java')
    const reasonController = read(join(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/claim'), 'ClaimReasonController.java')
    expect(menu).toContain(`path: '${SALE_CLAIM_SETTING_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_CLAIM_SETTING_PERMISSION}'`)
    expect(route).toContain(`permission: ${SALE_CLAIM_SETTING_PERMISSION}`)
    for (const fragment of [
      'customLoad: async form =>',
      "http.post(CLAIM_CONFIG_PAGE_URL, form)",
      'getDataListIsPage: true',
      "buttonPermissionFlag('setting:claim-setting:create')",
      "buttonPermissionFlag('setting:claim-setting:edit')",
      "buttonPermissionFlag('setting:claim-setting:reason-maintain')",
      "buttonPermissionFlag('setting:claim-setting:delete')",
      "http.delete(CLAIM_CONFIG_DELETE_URL",
      "router.push(`./reason/${record.id}`)",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'parseCategoryIds',
      'formatCategoryIds',
      "http.get(CLAIM_CATEGORY_URL",
      "url: route.params.mode === 'edit' ? CLAIM_CONFIG_UPDATE_URL : CLAIM_CONFIG_CREATE_URL",
      "method: route.params.mode === 'edit' ? 'PUT' : 'POST'",
      "claimType: [{ required: true, message: '请选择理赔类型' }]",
      '理赔结束时间必须大于理赔开始时间',
    ]) expect(detail).toContain(fragment)
    for (const fragment of [
      "http(CLAIM_CONFIG_GET_URL, { params: { id: route.params.id } })",
      "http.get(CLAIM_REASON_LIST_URL",
      "http.post(CLAIM_REASON_SAVE_URL",
      'reasonList.length >= 20',
      '存在相同的重复原因',
      ':maxlength="50"',
    ]) expect(reason).toContain(fragment)
    for (const fragment of ['@RequestMapping("/claim/claim-config")', '@PostMapping("/page")', '@GetMapping("/get")', '@GetMapping("/categories")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")']) expect(controller).toContain(fragment)
    for (const fragment of ['@RequestMapping("/claim/claim-reason")', '@GetMapping("/list")', '@PostMapping("/save")']) expect(reasonController).toContain(fragment)
  })

  it('能力绑定页面、四个按钮权限、module-type和platform实例', () => {
    expect(saleClaimSettingCapabilities).toHaveLength(12)
    expect(saleClaimSettingCapabilities.map(item => item.id)).toEqual(expect.arrayContaining([
      'sale-claim-setting-list',
      'sale-claim-setting-get',
      'sale-claim-setting-category-list',
      'sale-claim-setting-reason-list',
      'sale-claim-setting-prepare-create',
      'sale-claim-setting-create',
      'sale-claim-setting-prepare-update',
      'sale-claim-setting-update',
      'sale-claim-setting-prepare-remove',
      'sale-claim-setting-remove',
      'sale-claim-setting-prepare-save-reasons',
      'sale-claim-setting-save-reasons',
    ]))
    expect(saleClaimSettingCapabilities.every(item => item.pagePath === SALE_CLAIM_SETTING_PAGE_PATH && item.permission === SALE_CLAIM_SETTING_PERMISSION && item.moduleType === SALE_CLAIM_SETTING_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(SALE_CLAIM_SETTING_CREATE_PERMISSION).toBe('setting:claim-setting:create')
    expect(SALE_CLAIM_SETTING_EDIT_PERMISSION).toBe('setting:claim-setting:edit')
    expect(SALE_CLAIM_SETTING_REASON_PERMISSION).toBe('setting:claim-setting:reason-maintain')
    expect(SALE_CLAIM_SETTING_DELETE_PERMISSION).toBe('setting:claim-setting:delete')
    const catalog = createCatalog({ capabilities: saleClaimSettingCapabilities })
    expect(catalog.describe('sale-claim-setting-list').ok).toBe(true)
  })

  it('列表、详情、按类型品类树和原因列表按Portal请求形状执行', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({ total: 1, list: [{ id: 11, categoryId: '59,66' }] })
    expect(calls[0]).toEqual({ url: '/admin-api/claim/claim-config/page', method: 'post', data: { order: '', orderField: '', pageNo: 1, pageSize: 20 } })
    await expect(api.get({ id: 11 })).resolves.toMatchObject({ id: 11, claimType: 1, categoryId: [59, 66] })
    expect(calls[1]).toEqual({ url: '/admin-api/claim/claim-config/get', method: 'get', params: { id: 11 } })
    await expect(api.categoryList()).resolves.toEqual([])
    expect(calls).toHaveLength(2)
    await expect(api.categoryList({ claimType: 1 })).resolves.toMatchObject([{ catId: 59, key: 59, children: [{ catId: 591, key: 591 }] }])
    expect(calls[2]).toEqual({ url: '/admin-api/claim/claim-config/categories', method: 'get', params: { claimType: 1 } })
    await expect(api.reasonList({ claimType: 1 })).resolves.toEqual([{ id: 21, content: '破损' }])
    expect(calls[3]).toEqual({ url: '/admin-api/claim/claim-reason/list', method: 'get', params: { claimType: 1 } })
  })

  it('prepare→create/update/remove以及原因覆盖保存严格保留表单提交规则', async () => {
    const { api, calls } = fixture()
    const created = api.prepareCreate({ form })
    expect(created).toEqual({ draft: { claimType: 1, categoryId: '59,66', startDays: 1, endDays: 7 } })
    expect(calls).toHaveLength(0)
    await expect(api.create(created)).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/admin-api/claim/claim-config/create', method: 'post', data: created.draft })

    const updated = api.prepareUpdate({ form: { ...form, id: 11, categoryId: [66], startDays: null, endDays: null } })
    expect(updated).toEqual({ draft: { id: 11, claimType: 1, categoryId: '66', startDays: null, endDays: null } })
    await expect(api.update(updated)).resolves.toBe(true)
    expect(calls[1]).toEqual({ url: '/admin-api/claim/claim-config/update', method: 'put', data: updated.draft })

    expect(api.prepareRemove({ id: 11 })).toEqual({ id: 11 })
    await expect(api.remove({ id: 11 })).resolves.toBe(true)
    expect(calls[2]).toEqual({ url: '/admin-api/claim/claim-config/delete', method: 'delete', params: { id: 11 } })

    const reasons = api.prepareSaveReasons({ claimConfigId: 11, claimType: 1, reasons: [{ id: 21, content: '破损' }, { id: null, content: '少件' }] })
    expect(reasons).toEqual({ draft: { claimConfigId: 11, claimType: 1, reasons: [{ id: 21, content: '破损' }, { id: null, content: '少件' }] } })
    await expect(api.saveReasons(reasons)).resolves.toBe(true)
    expect(calls[3]).toEqual({ url: '/admin-api/claim/claim-reason/save', method: 'post', data: reasons.draft })
  })

  it('页面必填、时间范围、原因数量/重复、分页和坏响应在请求前失败', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, claimType: null } })).toThrow('claimType')
    expect(() => api.prepareCreate({ form: { ...form, endDays: 1 } })).toThrow('理赔结束时间必须大于')
    expect(() => api.prepareCreate({ form: { ...form, startDays: 999, endDays: null } })).not.toThrow()
    expect(() => api.prepareCreate({ form: { ...form, endDays: 1000 } })).toThrow('endDays')
    expect(() => api.prepareUpdate({ form: form as never })).toThrow('理赔配置ID')
    expect(() => api.prepareRemove({ id: ' ' })).toThrow('理赔配置ID')
    expect(() => api.prepareSaveReasons({ claimConfigId: 11, claimType: 1, reasons: [{ content: '重复' }, { content: '重复' }] })).toThrow('重复')
    expect(() => api.prepareSaveReasons({ claimConfigId: 11, claimType: 1, reasons: [] })).toThrow('1到20')
    expect(() => api.prepareSaveReasons({ claimConfigId: 11, claimType: 1, reasons: [{ content: '   ' }] })).toThrow('不能为空')
    expect(() => api.prepareSaveReasons({ claimConfigId: 11, claimType: 1, reasons: [{ content: 'x'.repeat(51) }] })).toThrow('50')
    await expect(api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(calls).toHaveLength(0)
    await expect(createSaleClaimSettingCapability(async () => ({ list: [], total: -1 } as never)).list()).rejects.toThrow('有效list或total')
    await expect(createSaleClaimSettingCapability(async () => ({ id: 11, claimType: 1, categoryId: 'abc' } as never)).get({ id: 11 })).rejects.toThrow('categoryId')
    await expect(createSaleClaimSettingCapability(async () => false as never).create({ draft: { claimType: 1, categoryId: '', startDays: null, endDays: null } })).rejects.toThrow('不是true')
  })
})
