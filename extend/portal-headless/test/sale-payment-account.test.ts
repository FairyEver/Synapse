import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_PAYMENT_ACCOUNT_CREATE_PERMISSION,
  SALE_PAYMENT_ACCOUNT_DELETE_PERMISSION,
  SALE_PAYMENT_ACCOUNT_EDIT_PERMISSION,
  SALE_PAYMENT_ACCOUNT_MODULE_TYPE,
  SALE_PAYMENT_ACCOUNT_PAGE_PATH,
  SALE_PAYMENT_ACCOUNT_PERMISSION,
  createSalePaymentAccountCapability,
  salePaymentAccountCapabilities,
} from '../src/capabilities/sale-payment-account.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/admin-api/sales/ccb-account/page') {
      return {
        list: [{
          id: 7,
          officeId: 101,
          officeName: '一号公司',
          itemName: '鸡蛋',
          itemKind: '10,11',
          bankName: '建设银行',
          receiptAccountName: '一号账户',
          receiptAccountNo: '62220001',
          merchantCode: 'merchant',
          branchName: '一号支行',
          instCode: 'inst',
          branchInstCode: 'branch-inst',
          publicKey: 'key',
          creator: 1,
          createTime: '2026-09-24 10:00:00',
          updater: 2,
          updaterName: '管理员',
          updateTime: '2026-09-24 10:00:01',
          deleted: false,
          tenantId: 99,
        }],
        total: 1,
      } as T
    }
    if (config.url === '/admin-api/sales/organization/tree') {
      return [{
        id: 101,
        name: '一号公司',
        salesType: 1,
        children: [{ id: 102, name: '不可选组织', salesType: 2, children: [] }],
      }] as T
    }
    if (config.url === '/sys/categoryCat/getTree') {
      return [{
        catId: 10,
        catName: '鸡蛋',
        level: '1',
        lv2: [{ catId: 11, catName: '商品蛋', level: '2', lv3: [{ catId: 12, catName: '普通蛋', level: '3' }] }],
        lv3: [],
      }] as T
    }
    if (config.url === '/admin-api/sales/manual-order/get-bank-branch-list') return ['开户行A'] as T
    if (config.url === '/admin-api/sales/manual-order/get-bank-list') return [{ bank: 1, bankName: '建设银行' }] as T
    if (config.url === '/admin-api/sales/manual-order/get-bank-account-list') return ['62220001'] as T
    if (config.url === '/admin-api/sales/ccb-account/get') {
      return {
        id: 7,
        officeId: 101,
        officeName: '一号公司',
        itemName: '鸡蛋',
        itemKind: '10,11',
        bankName: '建设银行',
        receiptAccountName: '一号账户',
        receiptAccountNo: '62220001',
        merchantCode: 'merchant',
        branchName: '一号支行',
        instCode: 'inst',
        branchInstCode: 'branch-inst',
        publicKey: 'key',
        creator: 1,
        createTime: '2026-09-24 10:00:00',
        updater: 2,
        updaterName: '管理员',
        updateTime: '2026-09-24 10:00:01',
        deleted: false,
        tenantId: 99,
      } as T
    }
    if (config.url === '/admin-api/sales/ccb-account/create') return 8 as T
    if (config.url === '/admin-api/sales/ccb-account/update' || config.url === '/admin-api/sales/ccb-account/delete') return true as T
    throw new Error(`未配置请求：${config.method} ${config.url}`)
  }
  return { api: createSalePaymentAccountCapability(request), calls }
}

const form = {
  id: '',
  officeId: 101,
  itemKindCode: [10, '11'],
  merchantCode: 'merchant',
  receiptAccountName: '一号账户',
  bankName: '建设银行',
  receiptAccountNo: '62220001',
  instCode: 'inst',
  branchName: '一号支行',
  branchInstCode: 'branch-inst',
  publicKey: 'key',
  office: { id: 101, name: '一号公司' },
  createDate: 'ignored',
  updateDate: 'ignored',
}

describe('sale-payment-account 系统设置/销售设置/收款账号', () => {
  it('能力绑定页面、按钮权限、module-type和Portal实例', () => {
    expect(salePaymentAccountCapabilities).toHaveLength(13)
    expect(salePaymentAccountCapabilities.every(item => item.pagePath === SALE_PAYMENT_ACCOUNT_PAGE_PATH)).toBe(true)
    expect(salePaymentAccountCapabilities.every(item => item.permission === SALE_PAYMENT_ACCOUNT_PERMISSION)).toBe(true)
    expect(salePaymentAccountCapabilities.every(item => item.moduleType === SALE_PAYMENT_ACCOUNT_MODULE_TYPE)).toBe(true)
    expect(SALE_PAYMENT_ACCOUNT_CREATE_PERMISSION).toBe('sale:order:payment-account:create')
    expect(SALE_PAYMENT_ACCOUNT_EDIT_PERMISSION).toBe('sale:order:payment-account:edit')
    expect(SALE_PAYMENT_ACCOUNT_DELETE_PERMISSION).toBe('sale:order:payment-account:delete')
    expect(salePaymentAccountCapabilities.find(item => item.id === 'sale-payment-account-category-tree')?.httpInstance).toBe('platform-mall-admin')
    expect(salePaymentAccountCapabilities.filter(item => item.id !== 'sale-payment-account-category-tree').every(item => item.httpInstance === 'platform')).toBe(true)

    const catalog = createCatalog({ capabilities: salePaymentAccountCapabilities })
    const platform = catalog.describe('sale-payment-account-list')
    const mallAdmin = catalog.describe('sale-payment-account-category-tree')
    expect(platform.ok).toBe(true)
    expect(mallAdmin.ok).toBe(true)
    if (platform.ok && mallAdmin.ok) {
      expect(platform.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'platform', baseUrlEnv: 'VITE_ZHDJ_PLATFORM_API' })
      expect(mallAdmin.howToCall.entryPoints[0]?.httpInstance).toMatchObject({ id: 'platform-mall-admin', baseUrlEnv: 'VITE_MALL_ADMIN_API' })
    }
  })

  it('列表发送Portal公共空排序字段和受控分页，并保留total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toMatchObject({ total: 1, list: [{ id: 7, itemKind: '10,11' }] })
    expect(calls[0]).toEqual({
      url: '/admin-api/sales/ccb-account/page',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, pageSize: 20 },
      httpInstance: 'platform',
    })
    await expect(api.list({ pageNo: 2, pageSize: 100 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ order: '', orderField: '', pageNo: 2, pageSize: 100 })
  })

  it('组织树、品类树逐字段复刻Portal的请求实例和可选规则', async () => {
    const { api, calls } = fixture()
    await expect(api.organizationTree()).resolves.toEqual([
      expect.objectContaining({ id: 101, name: '一号公司', salesType: 1, disabled: false }),
    ])
    expect(calls[0]).toEqual({ url: '/admin-api/sales/organization/tree', method: 'get', params: { salesTypeMax: '1' }, httpInstance: 'platform' })
    const organization = (await api.organizationTree())[0]
    expect(organization?.children[0]).toEqual(expect.objectContaining({ id: 102, disabled: true }))

    await expect(api.categoryTree()).resolves.toMatchObject([{ catId: 10, catName: '鸡蛋', lv2: [{ catId: 11, lv3: [{ catId: 12 }] }] }])
    expect(calls[2]).toEqual({ url: '/sys/categoryCat/getTree', method: 'get', httpInstance: 'platform-mall-admin' })
  })

  it('银行级联按Portal前置条件请求，缺值时短路且不伪造请求', async () => {
    const { api, calls } = fixture()
    await expect(api.bankBranchList()).resolves.toEqual([])
    expect(calls).toHaveLength(0)
    await expect(api.bankBranchList({ organizationId: 101 })).resolves.toEqual(['开户行A'])
    expect(calls[0]).toEqual({ url: '/admin-api/sales/manual-order/get-bank-branch-list', method: 'get', params: { organizationId: 101 }, httpInstance: 'platform' })
    await expect(api.bankList({ organizationId: 101, bankBranch: '开户行A' })).resolves.toEqual([{ bank: 1, bankName: '建设银行' }])
    expect(calls[1]).toEqual({ url: '/admin-api/sales/manual-order/get-bank-list', method: 'get', params: { organizationId: 101, bankBranch: '开户行A' }, httpInstance: 'platform' })
    await expect(api.bankAccountList({ organizationId: 101, bank: 1, bankBranch: '开户行A' })).resolves.toEqual(['62220001'])
    expect(calls[2]).toEqual({ url: '/admin-api/sales/manual-order/get-bank-account-list', method: 'get', params: { organizationId: 101, bank: 1, bankBranch: '开户行A' }, httpInstance: 'platform' })
    await expect(api.bankList({ organizationId: 101 })).resolves.toEqual([])
    await expect(api.bankAccountList({ organizationId: 101, bank: 1 })).resolves.toEqual([])
    expect(calls).toHaveLength(3)
  })

  it('详情按itemKind逗号规则回显itemKindCode，并使用platform', async () => {
    const { api, calls } = fixture()
    await expect(api.get({ id: 7 })).resolves.toMatchObject({ id: 7, itemKind: '10,11', itemKindCode: ['10', '11'] })
    expect(calls[0]).toEqual({ url: '/admin-api/sales/ccb-account/get', method: 'get', params: { id: 7 }, httpInstance: 'platform' })
  })

  it('prepare→create/update按页面提交规则转换表单，准备阶段不发请求', async () => {
    const { api, calls } = fixture()
    const prepared = api.prepareCreate({ form })
    expect(prepared).toEqual({ draft: {
      officeId: 101,
      itemKind: '10,11',
      merchantCode: 'merchant',
      receiptAccountName: '一号账户',
      bankName: '建设银行',
      receiptAccountNo: '62220001',
      instCode: 'inst',
      branchName: '一号支行',
      branchInstCode: 'branch-inst',
      publicKey: 'key',
    } })
    expect(calls).toHaveLength(0)
    await expect(api.create({ draft: prepared.draft })).resolves.toBe(8)
    expect(calls[0]).toEqual({ url: '/admin-api/sales/ccb-account/create', method: 'post', data: prepared.draft, httpInstance: 'platform' })

    const updated = api.prepareUpdate({ form: { ...form, id: 7, itemKindCode: ['10'] } })
    expect(updated.draft).toMatchObject({ id: 7, itemKind: '10' })
    await expect(api.update({ draft: updated.draft })).resolves.toBeUndefined()
    expect(calls[1]).toEqual({ url: '/admin-api/sales/ccb-account/update', method: 'put', data: updated.draft, httpInstance: 'platform' })
  })

  it('删除准备阶段无副作用，提交使用选中的id并校验true回执', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 7 })).toEqual({ id: 7 })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 7 })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({ url: '/admin-api/sales/ccb-account/delete', method: 'delete', params: { id: 7 }, httpInstance: 'platform' })
  })

  it('坏参数在请求前失败，坏回执不能被当成成功', async () => {
    const { api, calls } = fixture()
    expect(() => api.prepareCreate({ form: { ...form, officeId: '' } })).toThrow('officeId')
    expect(() => api.prepareCreate({ form: { ...form, itemKindCode: [] } })).toThrow('itemKindCode')
    expect(() => api.prepareCreate({ form: { ...form, receiptAccountNo: '' } })).toThrow('receiptAccountNo')
    expect(api.prepareCreate({ form: { ...form, id: 7 } }).draft).not.toHaveProperty('id')
    expect(() => api.prepareUpdate({ form })).toThrow('收款账号ID')
    expect(() => api.prepareRemove({ id: ' ' })).toThrow('收款账号ID')
    await expect(api.list({ pageSize: 200 })).rejects.toThrow('pageSize')
    expect(calls).toHaveLength(0)

    const badCreate = createSalePaymentAccountCapability(async () => null as never)
    await expect(badCreate.create({ draft: { ...form, itemKind: '10', id: 7 } as never })).rejects.toThrow('新建收款账号不能带已有id')
    await expect(badCreate.create({ draft: {
      officeId: 101,
      itemKind: '10',
      merchantCode: '',
      receiptAccountName: '账户',
      bankName: '银行',
      receiptAccountNo: '账号',
      instCode: '',
      branchName: '',
      branchInstCode: '',
      publicKey: '',
    } })).rejects.toThrow('id')
    const badUpdate = createSalePaymentAccountCapability(async () => false as never)
    await expect(badUpdate.update({ draft: {
      id: 7,
      officeId: 101,
      itemKind: '10',
      merchantCode: '',
      receiptAccountName: '账户',
      bankName: '银行',
      receiptAccountNo: '账号',
      instCode: '',
      branchName: '',
      branchInstCode: '',
      publicKey: '',
    } })).rejects.toThrow('不是true')
  })
})
