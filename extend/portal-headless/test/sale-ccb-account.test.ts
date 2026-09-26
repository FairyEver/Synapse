import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_CCB_ACCOUNT_CREATE_PERMISSION,
  SALE_CCB_ACCOUNT_MODULE_TYPE,
  SALE_CCB_ACCOUNT_PAGE_PATH,
  SALE_CCB_ACCOUNT_PERMISSION,
  SALE_CCB_ACCOUNT_ROW_ACTION_PERMISSION,
  createSaleCcbAccountCapability,
  saleCcbAccountCapabilities,
} from '../src/capabilities/sale-ccb-account.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/vue/order/ccbAccount/list') {
      return {
        list: [{
          id: 'row-1',
          office: { id: 'sales-1', name: '一号公司' },
          itemKind: '雏鸡,蛋鸡',
          branchCode: 'branch',
          merchantCode: 'merchant',
          ccbpayAccount: 'ccb-account',
          counterCode: 'counter',
          receiptAccountName: '账户名称',
          receiptAccountNo: 'receipt-account',
          bankName: '银行',
          branchName: '支行',
          instCode: 'inst',
          branchInstCode: 'branch-inst',
          publicKey: 'key',
          createDate: '2026-09-24 10:00:00',
          updateDate: '2026-09-24 10:00:01',
          remarks: '备注',
        }],
        count: 1,
      } as T
    }
    if (config.url === '/admin-api/sales/organization/tree') {
      return [{ salesId: 'sales-1', name: '一号公司', salesParentId: '', children: [] }] as T
    }
    return '操作成功' as T
  }
  return { api: createSaleCcbAccountCapability(request), calls }
}

const form = {
  id: '',
  companyId: '',
  office: { id: 'sales-1', name: '一号公司' },
  officeId: 'sales-1',
  itemKindCode: ['1001', '1011'],
  publicKey: 'key',
  branchCode: 'branch',
  merchantCode: 'merchant',
  ccbpayAccount: 'ccb-account',
  counterCode: 'counter',
  receiptAccountName: '账户名称',
  receiptAccountNo: 'receipt-account',
  bankName: '银行',
  branchName: '支行',
  instCode: 'inst',
  branchInstCode: 'branch-inst',
}

describe('sale-ccb-account SAP-收款账号', () => {
  it('能力绑定页面、module-type、按钮权限和两个Portal实例', () => {
    expect(saleCcbAccountCapabilities).toHaveLength(8)
    expect(saleCcbAccountCapabilities.every(item => item.pagePath === SALE_CCB_ACCOUNT_PAGE_PATH)).toBe(true)
    expect(saleCcbAccountCapabilities.every(item => item.permission === SALE_CCB_ACCOUNT_PERMISSION)).toBe(true)
    expect(saleCcbAccountCapabilities.every(item => item.moduleType === SALE_CCB_ACCOUNT_MODULE_TYPE)).toBe(true)
    expect(saleCcbAccountCapabilities.find(item => item.id === 'sale-ccb-account-list')?.httpInstance).toBe('crm')
    expect(saleCcbAccountCapabilities.find(item => item.id === 'sale-ccb-account-organization-tree')?.httpInstance).toBe('platform')
    expect(SALE_CCB_ACCOUNT_CREATE_PERMISSION).toBe('order:ccbAccount:edit')
    expect(SALE_CCB_ACCOUNT_ROW_ACTION_PERMISSION).toBe('order:tradeStoreroom:edit')

    const catalog = createCatalog({ capabilities: saleCcbAccountCapabilities })
    const crm = catalog.describe('sale-ccb-account-list')
    const platform = catalog.describe('sale-ccb-account-organization-tree')
    expect(crm.ok).toBe(true)
    expect(platform.ok).toBe(true)
    if (crm.ok && platform.ok) {
      expect(crm.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'crm', baseUrlEnv: 'VITE_CRM_API' })
      expect(platform.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'platform', baseUrlEnv: 'VITE_ZHDJ_PLATFORM_API' })
    }
  })

  it('列表只发送Portal customLoad保留的pageNo/pageSize，并把count映射为total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({
      total: 1,
      list: [{ id: 'row-1', office: { id: 'sales-1', name: '一号公司' }, itemKind: '雏鸡,蛋鸡' }],
    })
    expect(calls[0]).toEqual({
      url: '/vue/order/ccbAccount/list',
      method: 'get',
      params: { pageNo: 1, pageSize: 20 },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    await expect(api.list({ pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ pageNo: 2, pageSize: 50 })
  })

  it('组织树保留platform实例和salesTypeMax=1字符串参数', async () => {
    const { api, calls } = fixture()
    await expect(api.organizationTree()).resolves.toEqual([{ salesId: 'sales-1', name: '一号公司', salesParentId: '', children: [] }])
    expect(calls[0]).toEqual({
      url: '/admin-api/sales/organization/tree',
      method: 'get',
      params: { salesTypeMax: '1' },
      httpInstance: 'platform',
    })
  })

  it('新建和编辑按Portal完整表单转换itemKind并使用CRM save', async () => {
    const { api, calls } = fixture()
    const prepared = api.prepareCreate({ form })
    expect(prepared.draft).toEqual({
      id: '',
      companyId: '',
      office: { id: 'sales-1', name: '一号公司' },
      officeId: 'sales-1',
      itemKind: "['1001','1011']",
      publicKey: 'key',
      branchCode: 'branch',
      merchantCode: 'merchant',
      ccbpayAccount: 'ccb-account',
      counterCode: 'counter',
      receiptAccountName: '账户名称',
      receiptAccountNo: 'receipt-account',
      bankName: '银行',
      branchName: '支行',
      instCode: 'inst',
      branchInstCode: 'branch-inst',
    })
    expect(calls).toHaveLength(0)
    await expect(api.create({ draft: prepared.draft })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/vue/order/ccbAccount/save',
      method: 'post',
      data: prepared.draft,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const updateForm = { ...form, id: 'row-1', itemKindCode: ['1001'] }
    const updated = api.prepareUpdate({ form: updateForm })
    expect(updated.draft.id).toBe('row-1')
    expect(updated.draft.itemKind).toBe("['1001']")
    await expect(api.update({ draft: updated.draft })).resolves.toBeUndefined()
    expect(calls[1]).toMatchObject({ url: '/vue/order/ccbAccount/save', method: 'post', data: updated.draft, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('删除使用表单编码头，且准备阶段不发送请求', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 'row-1' })).toEqual({ id: 'row-1' })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 'row-1' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/vue/order/ccbAccount/row-1',
      method: 'delete',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('页面必填项、ID、分页和错误响应拒绝', async () => {
    const { api } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, officeId: '' } })).toThrow('officeId')
    expect(() => api.prepareCreate({ form: { ...form, itemKindCode: [] } })).toThrow('itemKindCode')
    expect(() => api.prepareCreate({ form: { ...form, bankName: '' } })).toThrow('bankName')
    expect(() => api.prepareUpdate({ form: form as never })).toThrow('SAP收款账号ID')
    expect(() => api.prepareRemove({ id: ' ' })).toThrow('SAP收款账号ID')
    await expect(api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(api.list({ pageSize: 200 })).rejects.toThrow('pageSize')
    const badApi = createSaleCcbAccountCapability(async () => ({ list: [], count: '1' } as never))
    await expect(badApi.list()).rejects.toThrow('有效count')
    const badTreeApi = createSaleCcbAccountCapability(async () => [{ name: '无salesId', children: [] }] as never)
    await expect(badTreeApi.organizationTree()).rejects.toThrow('salesId')
  })
})
