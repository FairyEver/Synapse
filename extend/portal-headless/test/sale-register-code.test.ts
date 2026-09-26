import { describe, expect, it } from 'vitest'

import { createCatalog } from '../src/catalog/index.js'
import {
  SALE_REGISTER_CODE_ACTION_PERMISSION,
  SALE_REGISTER_CODE_MODULE_TYPE,
  SALE_REGISTER_CODE_PAGE_PATH,
  SALE_REGISTER_CODE_PERMISSION,
  createSaleRegisterCodeCapability,
  saleRegisterCodeCapabilities,
} from '../src/capabilities/sale-register-code.js'
import type { PortalRequest } from '../src/session/types.js'
import type { PortalRequestConfig } from '../src/http/client.js'

function fixture () {
  const calls: PortalRequestConfig[] = []
  const request: PortalRequest = async <T>(config: PortalRequestConfig) => {
    calls.push(config)
    if (config.url === '/vue/customer/registerCode/list') {
      return {
        list: [{
          id: 'code-1',
          number: '1',
          provinceCode: '11',
          city: '北京',
          area: '朝阳',
          breedingCode: 'B-1',
          farmerName: '养殖场',
          formerBreedingCode: null,
          farmAddress: '地址',
          name: '张三',
        }],
        count: 1,
      } as T
    }
    if (config.url === '/vue/customer/registerCode/import') return '导入国家注册代码成功' as T
    return undefined as T
  }
  return { api: createSaleRegisterCodeCapability(request), calls }
}

describe('sale-register-code 国家代码管理', () => {
  it('能力绑定保留页面、动作权限、module-type和crm实例', () => {
    expect(saleRegisterCodeCapabilities).toHaveLength(5)
    expect(saleRegisterCodeCapabilities.every(item => item.pagePath === SALE_REGISTER_CODE_PAGE_PATH)).toBe(true)
    expect(saleRegisterCodeCapabilities.every(item => item.permission === SALE_REGISTER_CODE_PERMISSION)).toBe(true)
    expect(saleRegisterCodeCapabilities.every(item => item.moduleType === SALE_REGISTER_CODE_MODULE_TYPE)).toBe(true)
    expect(saleRegisterCodeCapabilities.every(item => item.httpInstance === 'crm')).toBe(true)
    expect(SALE_REGISTER_CODE_ACTION_PERMISSION).toBe('customer:registerCode:edit')

    const catalog = createCatalog({ capabilities: saleRegisterCodeCapabilities })
    const described = catalog.describe('sale-register-code-list')
    expect(described.ok).toBe(true)
    if (described.ok) {
      expect(described.howToCall.entryPoints[0]?.httpInstance).toEqual({
        kind: 'resolved',
        id: 'crm',
        matchedBy: 'declared',
        baseUrlEnv: 'VITE_CRM_API',
      })
    }
  })

  it('列表按Portal发送公共排序字段、三个空筛选值、页码和页大小，并把count映射为total', async () => {
    const { api, calls } = fixture()
    await expect(api.list()).resolves.toEqual({
      list: [{
        id: 'code-1',
        number: '1',
        provinceCode: '11',
        city: '北京',
        area: '朝阳',
        breedingCode: 'B-1',
        farmerName: '养殖场',
        formerBreedingCode: null,
        farmAddress: '地址',
        name: '张三',
      }],
      total: 1,
    })
    expect(calls[0]).toMatchObject({
      url: '/vue/customer/registerCode/list',
      method: 'get',
      params: { order: '', orderField: '', breedingCode: '', farmerName: '', name: '', pageNo: 1, pageSize: 20 },
    })
    await expect(api.list({ order: 'asc', orderField: 'name', breedingCode: 'B', farmerName: '场', name: '张', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    expect(calls[1]?.params).toEqual({ order: 'asc', orderField: 'name', breedingCode: 'B', farmerName: '场', name: '张', pageNo: 2, pageSize: 50 })
  })

  it('导入准备只校验文件，支持Portal接受的xls和xlsx；提交使用multipart字段file', async () => {
    const { api, calls } = fixture()
    const base64 = Buffer.from('register-code').toString('base64')
    expect(api.prepareImport({ fileName: '国家代码.xls', base64 })).toEqual({
      fileName: '国家代码.xls',
      contentType: 'application/vnd.ms-excel',
      byteLength: 13,
    })
    expect(calls).toHaveLength(0)

    await expect(api.importFile({ fileName: '国家代码.xlsx', base64 })).resolves.toBe('导入国家注册代码成功')
    const config = calls[0]
    expect(config).toMatchObject({
      url: '/vue/customer/registerCode/import',
      method: 'post',
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const form = config?.data as FormData
    const file = form.get('file') as Blob & { name?: string }
    expect(file).toBeInstanceOf(Blob)
    expect(file.name).toBe('国家代码.xlsx')
    expect(file.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('删除必须经过本地准备确认，按页面发送单条DELETE和表单编码头', async () => {
    const { api, calls } = fixture()
    expect(api.prepareRemove({ id: 'code-1' })).toEqual({ id: 'code-1' })
    expect(calls).toHaveLength(0)
    await expect(api.remove({ id: 'code-1' })).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({
      url: '/vue/customer/registerCode/code-1',
      method: 'delete',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('坏输入和坏分页响应拒绝，不能伪造成功或空列表', async () => {
    const { api } = fixture()
    expect(() => api.prepareImport({ fileName: '国家代码.csv', base64: 'AQID' })).toThrow('.xls或.xlsx')
    expect(() => api.prepareImport({ fileName: '国家代码.xls', base64: 'not base64!' })).toThrow('标准Base64')
    expect(() => api.prepareRemove({ id: '  ' })).toThrow('国家代码ID')
    const badApi = createSaleRegisterCodeCapability(async () => ({ list: [], count: '1' } as never))
    await expect(badApi.list()).rejects.toThrow('有效count')
  })
})
