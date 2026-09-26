import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_TRADE_STOREROOM_ACTION_PERMISSION,
  SALE_TRADE_STOREROOM_MODULE_TYPE,
  SALE_TRADE_STOREROOM_PAGE_PATH,
  SALE_TRADE_STOREROOM_PERMISSION,
  createSaleTradeStoreroomCapability,
  saleTradeStoreroomCapabilities,
} from '../src/capabilities/sale-trade-storeroom.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/vue/order/tradeStoreroom/list') {
      return {
        list: [{
          id: 'room-1',
          parentId: '',
          name: '一号基地',
          type: '0',
          code: 'BASE1',
          shopId: 9,
          factoryKind: '10',
          belongFactory: null,
          shopName: '一号供应商',
          companyOfficeId: null,
          companyName: null,
          companyCode: null,
          companyValid: 0,
          createDate: '2026-09-24 10:00:00',
          updateDate: '2026-09-24 10:00:01',
        }],
        count: 1,
      } as T
    }
    if (config.url === '/vue/order/tradeStoreroom/getSupplier') return [{ shopId: 9, shopName: '一号供应商' }] as T
    if (config.url === '/vue/order/tradeStoreroom/companyList') return [{ id: 'company-1', name: '一号公司', code: 'C1', type: '1', valid: 1 }] as T
    if (config.url === '/vue/order/tradeStoreroom/findFactory') return [{ id: 'factory-1', name: '一号工厂' }] as T
    if (config.url === '/vue/order/tradeStoreroom/findBase') return [{ id: 'base-1', name: '一号基地', code: 'B1' }] as T
    if (config.url === '/admin-api/sales/organization/tree') return [{ id: 101, name: '一号基地组织', children: [{ id: 102, name: '二号基地组织', children: [] }] }] as T
    if (config.url === '/vue/order/tradeStoreroom/selectShippingBaseList') return [{ id: 1, hrOrgId: 101, hrOrgName: '一号基地组织' }] as T
    if (config.url === '/vue/order/tradeStoreroom/save' || config.url === '/vue/order/tradeStoreroom/delete' || config.url === '/vue/order/tradeStoreroom/saveShippingBaseList') return '操作成功' as T
    throw new Error(`未配置请求：${config.method} ${config.url}`)
  }
  return { api: createSaleTradeStoreroomCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form = {
  id: null,
  shopId: 9,
  code: 'BASE1',
  factoryKind: '10',
  name: '一号基地',
  type: '0',
  parentId: '',
  companyOfficeId: null,
  createDate: 'ignored',
  updateDate: 'ignored',
  companyName: 'ignored',
}

describe('sale-trade-storeroom 系统设置/销售设置/工厂管理', () => {
  it('逐页锁定Portal页面、权限、表单规则和后端旧接口', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/order/trade-storeroom/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/sale/order/trade-storeroom/ModalFormContent.vue')
    const base = read(portalRoot, 'app/portal/views/dashboard/sale/order/trade-storeroom/ModalBaseContent.vue')
    const controller = read(join(javaRoot, 'erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/crm/modules/order/controller'), 'TradeStoreroomVueController.java')
    expect(menu).toContain(`path: '${SALE_TRADE_STOREROOM_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_TRADE_STOREROOM_PERMISSION}'`)
    for (const fragment of [
      "getDataListIsPage: true",
      "httpCrm.get('/vue/order/tradeStoreroom/list'",
      "type: '0'",
      "permissionCheck('order:tradeStoreroom:edit')",
      "httpCrm.post('/vue/order/tradeStoreroom/save'",
      "httpCrm.delete('/vue/order/tradeStoreroom/delete'",
      "httpCrm.post('/vue/order/tradeStoreroom/saveShippingBaseList'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "shopId: props.raw.shopId || null",
      "factoryKind: props.raw.factoryKind || null",
      "{ required: true, message: '必填', trigger: 'change' }",
      "form.type === '1'",
      "pattern: /^[a-zA-Z0-9]{0,30}$/",
      "httpCrm.get('/vue/order/tradeStoreroom/findFactory'",
      "httpCrm.get('/vue/order/tradeStoreroom/findBase'",
      "httpCrm.get('/vue/order/tradeStoreroom/companyList'",
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      "http('/admin-api/sales/organization/tree'",
      'isAll: true',
      'isSalesTree: false',
      "httpCrm.get('/vue/order/tradeStoreroom/selectShippingBaseList'",
      "modelData.value = selectedBase.map(item => item.hrOrgId)",
    ]) expect(base).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "${vuePath}/order/tradeStoreroom")',
      '@GetMapping("list")',
      '@GetMapping("getSupplier")',
      '@GetMapping("findFactory")',
      '@GetMapping("findBase")',
      '@PostMapping(value = "save")',
      '@DeleteMapping("delete")',
      '@PostMapping(value = "saveShippingBaseList")',
    ]) expect(controller).toContain(fragment)
  })

  it('能力绑定页面、唯一按钮权限、module-type和CRM/platform实例', () => {
    expect(saleTradeStoreroomCapabilities).toHaveLength(15)
    expect(saleTradeStoreroomCapabilities.every(item => item.pagePath === SALE_TRADE_STOREROOM_PAGE_PATH)).toBe(true)
    expect(saleTradeStoreroomCapabilities.every(item => item.permission === SALE_TRADE_STOREROOM_PERMISSION)).toBe(true)
    expect(saleTradeStoreroomCapabilities.every(item => item.moduleType === SALE_TRADE_STOREROOM_MODULE_TYPE)).toBe(true)
    expect(SALE_TRADE_STOREROOM_ACTION_PERMISSION).toBe('order:tradeStoreroom:edit')
    expect(saleTradeStoreroomCapabilities.find(item => item.id === 'sale-trade-storeroom-organization-tree')?.httpInstance).toBe('platform')
    expect(saleTradeStoreroomCapabilities.filter(item => item.id !== 'sale-trade-storeroom-organization-tree').every(item => item.httpInstance === 'crm')).toBe(true)
    const catalog = createCatalog({ capabilities: saleTradeStoreroomCapabilities })
    const crm = catalog.describe('sale-trade-storeroom-list')
    const platform = catalog.describe('sale-trade-storeroom-organization-tree')
    expect(crm.ok).toBe(true)
    expect(platform.ok).toBe(true)
    if (crm.ok && platform.ok) {
      expect(crm.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'crm', baseUrlEnv: 'VITE_CRM_API' })
      expect(platform.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'platform', baseUrlEnv: 'VITE_ZHDJ_PLATFORM_API' })
    }
  })

  it('列表保留Portal默认type和四个筛选字段，count映射为total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({ total: 1, list: [{ id: 'room-1', companyValid: false }] })
    expect(calls[0]).toEqual({
      url: '/vue/order/tradeStoreroom/list',
      method: 'get',
      params: { pageNo: 1, pageSize: 20, type: '0', name: '', shopName: '', factoryKind: '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    await expect(api.list({ type: '1', name: '工厂', shopName: '供应商', factoryKind: '10', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ pageNo: 2, pageSize: 50, type: '1', name: '工厂', shopName: '供应商', factoryKind: '10' })
  })

  it('加载供应商、公司、工厂和基地候选，并在级联前置值缺失时短路', async () => {
    const { api, calls } = fixture()
    await expect(api.supplierList()).resolves.toEqual([{ shopId: 9, shopName: '一号供应商' }])
    expect(calls[0]).toEqual({ url: '/vue/order/tradeStoreroom/getSupplier', method: 'get', params: { type: 1 }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    await expect(api.companyList()).resolves.toEqual([{ id: 'company-1', name: '一号公司', code: 'C1', type: '1', valid: 1 }])
    expect(calls[1]).toEqual({ url: '/vue/order/tradeStoreroom/companyList', method: 'get', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    await expect(api.factoryList()).resolves.toEqual([])
    expect(calls).toHaveLength(2)
    await expect(api.factoryList({ factoryKind: '10', supplier: 9 })).resolves.toEqual([{ id: 'factory-1', name: '一号工厂' }])
    expect(calls[2]).toEqual({ url: '/vue/order/tradeStoreroom/findFactory', method: 'get', params: { factoryKind: '10', supplier: 9 }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    await expect(api.baseList({ factoryKind: '10', supplier: 9 })).resolves.toEqual([{ id: 'base-1', name: '一号基地', code: 'B1' }])
    expect(calls[3]).toEqual({ url: '/vue/order/tradeStoreroom/findBase', method: 'get', params: { factoryKind: '10', supplier: 9 }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('同步基地读取platform组织树和CRM已同步列表，保留hrOrgId语义', async () => {
    const { api, calls } = fixture()
    await expect(api.organizationTree()).resolves.toEqual([{ id: 101, name: '一号基地组织', children: [{ id: 102, name: '二号基地组织', children: [] }] }])
    expect(calls[0]).toEqual({ url: '/admin-api/sales/organization/tree', method: 'get', httpInstance: 'platform' })
    await expect(api.selectedBaseList()).resolves.toEqual([{ id: 1, hrOrgId: 101, hrOrgName: '一号基地组织' }])
    expect(calls[1]).toEqual({ url: '/vue/order/tradeStoreroom/selectShippingBaseList', method: 'get', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('prepare→create/update严格按弹窗字段保存，准备阶段不发请求', async () => {
    const { api, calls } = fixture()
    const prepared = api.prepareCreate({ form })
    expect(prepared).toEqual({ draft: { id: '', shopId: 9, code: 'BASE1', factoryKind: '10', name: '一号基地', type: '0', parentId: '', companyOfficeId: '' } })
    expect(calls).toHaveLength(0)
    await expect(api.create({ draft: prepared.draft })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/vue/order/tradeStoreroom/save', method: 'post', data: prepared.draft, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const updateForm = { ...form, id: 'room-1', type: '1', name: '一号工厂', parentId: 'base-1', companyOfficeId: 'company-1' }
    const updated = api.prepareUpdate({ form: updateForm })
    expect(updated.draft).toEqual({ id: 'room-1', shopId: 9, code: 'BASE1', factoryKind: '10', name: '一号工厂', type: '1', parentId: 'base-1', companyOfficeId: 'company-1' })
    await expect(api.update({ draft: updated.draft })).resolves.toBeUndefined()
    expect(calls[1]).toEqual({ url: '/vue/order/tradeStoreroom/save', method: 'post', data: updated.draft, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('删除同时提交id和type，准备同步基地把组织ID转成Portal逗号字符串', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 'room-1', type: '0' })).toEqual({ id: 'room-1', type: '0' })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 'room-1', type: '0' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/vue/order/tradeStoreroom/delete', method: 'delete', params: { id: 'room-1', type: '0' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const sync = api.prepareSyncBase({ ids: [101, 102] })
    expect(sync).toEqual({ draft: { list: '101,102' } })
    await expect(api.syncBase(sync)).resolves.toBeUndefined()
    expect(calls[1]).toEqual({ url: '/vue/order/tradeStoreroom/saveShippingBaseList', method: 'post', data: { list: '101,102' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('页面必填、条件校验、分页和坏响应在请求前失败', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, shopId: null } })).toThrow('shopId')
    expect(() => api.prepareCreate({ form: { ...form, code: '' } })).toThrow('code')
    expect(() => api.prepareCreate({ form: { ...form, type: '0', code: '含中文' } })).toThrow('code')
    expect(() => api.prepareCreate({ form: { ...form, type: '1', companyOfficeId: null } })).toThrow('companyOfficeId')
    expect(() => api.prepareUpdate({ form: form as never })).toThrow('工厂管理ID')
    expect(() => api.prepareRemove({ id: 'room-1', type: '' })).toThrow('type')
    await expect(api.list({ pageSize: 200 })).rejects.toThrow('pageSize')
    expect(calls).toHaveLength(0)
    const badList = createSaleTradeStoreroomCapability(async () => ({ list: [], count: '1' } as never))
    await expect(badList.list()).rejects.toThrow('有效count')
    const badOrg = createSaleTradeStoreroomCapability(async () => [{ name: '缺少id', children: [] }] as never)
    await expect(badOrg.organizationTree()).rejects.toThrow('id')
  })
})
