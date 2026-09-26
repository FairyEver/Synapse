import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import { createPageCall } from '../src/call.js'
import {
  buildFinanceLedgerAccountPayload,
  createFinanceLedgerAccountsCapability,
  financeLedgerAccountsCapabilities,
  FINANCE_LEDGER_ACCOUNTS_METHODS,
  FINANCE_LEDGER_ACCOUNTS_PAGE_PATH,
} from '../src/capabilities/finance-ledger-accounts.js'
import {
  FINANCE_LEDGER_ACCOUNTS_AI_CONTRACTS as contracts,
  FINANCE_LEDGER_ACCOUNTS_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-ledger-accounts.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceLedgerAccountsCapability(request), calls }
}

const xlsx = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    if (config.responseType === 'arraybuffer') {
      return {
        data: xlsx.buffer,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        config,
      }
    }
    const data = config.url?.includes('/page?') ? [] : config.url?.includes('/import-excel') ? true : null
    return { data: { ret: 'SUCCESS', code: 0, data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  return {
    api: createFinanceLedgerAccountsCapability(config => call(FINANCE_LEDGER_ACCOUNTS_PAGE_PATH, config)),
    calls,
    http,
  }
}

function normalized (url: string): string {
  return url.replace(/([?&]_t=)\d+/, '$1<ts>')
}

const child = {
  id: '9007199254740993',
  tenantName: '测试企业',
  name: '银行存款子项',
  subjectLevel: 2,
  code: '100201',
  type: 1,
  subjectFormat: 2,
  useSystemList: [1, '2'],
  parentId: 11,
  pid: 11,
  parentName: '银行存款',
  ancillaryAccountings: ['supplierId'],
  balanceDirection: 1,
  status: 0,
  accountingStandardsApply: 1,
  createTime: '2026-09-22 12:00:00',
  children: [],
  hidden: 'not exposed',
}

describe('会计科目PC页面动作', () => {
  it('默认树查询逐字段对齐浏览器基准，无分页参数且不发module-type', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/finance-ledger-accounts.browser.json', import.meta.url), 'utf8')) as {
      requests: Array<{ method: string; url: string }>
      absentHeaders: string[]
    }
    const { api, calls, http } = captureHttp()
    await expect(api.list()).resolves.toEqual([])
    const config = calls[0]!
    expect(config.method?.toUpperCase()).toBe(baseline.requests[0]?.method)
    expect(normalized(String(config.url))).toBe(baseline.requests[0]?.url)
    expect(normalized(http.getUri(config))).toBe(`https://biz-api-test.wodecorp.cn${baseline.requests[0]?.url}`)
    expect(config.params).not.toHaveProperty('pageNo')
    expect(config.params).not.toHaveProperty('pageSize')
    for (const name of baseline.absentHeaders) expect(config.headers.get(name)).toBeUndefined()
  })

  it('所有页面筛选和科目类型页签按真实键发送', async () => {
    const f = fixture([[]])
    await f.api.list({
      name: '现金', subjectLevel: 2, accountingStandardsApply: 2, tenantName: '企业',
      organizationId: '9007199254740993', code: '1001', status: 1, ledgerType: 5,
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/ledger-accounts/page', method: 'get', params: {
        order: '', orderField: '', name: '现金', accountingStandardsApply: 2,
        organizationId: '9007199254740993', tenantName: '企业', ledgerType: 5,
        subjectLevel: 2, type: '', code: '1001', status: 1,
      },
    })
  })

  it('树节点递归投影PC字段，详情只消费选中列表快照', async () => {
    const f = fixture([[{
      ...child,
      id: 11,
      name: '银行存款',
      code: 1002,
      subjectLevel: 1,
      parentId: 0,
      pid: '0',
      parentName: null,
      children: [child],
    }]])
    const result = await f.api.list()
    expect(result[0]?.parentId).toBeNull()
    expect(result[0]?.pid).toBeNull()
    expect(result[0]?.children[0]).toEqual({
      id: '9007199254740993', tenantName: '测试企业', name: '银行存款子项', subjectLevel: 2,
      code: '100201', type: 1, subjectFormat: 2, useSystemList: [1, '2'], parentId: 11, pid: 11,
      parentName: '银行存款', ancillaryAccountings: ['supplierId'], balanceDirection: 1, status: 0,
      accountingStandardsApply: 1, createTime: '2026-09-22 12:00:00', children: [],
    })
    expect(result[0]?.children[0]).not.toHaveProperty('hidden')
    const detail = f.api.detail(result[0]!.children[0]!)
    expect(detail).toEqual({
      id: '9007199254740993', name: '银行存款子项', code: '100201', type: 1, subjectFormat: 2,
      useSystemList: [1, '2'], parentId: 11, pid: 11, parentName: '银行存款',
      ancillaryAccountings: ['supplierId'], balanceDirection: 1, accountingStandardsApply: 1,
    })
    expect(f.calls).toHaveLength(1)
  })

  it('组织弹窗必须带关键字，角色树本地返回限额候选和路径', async () => {
    const f = fixture([[
      { id: 1, name: '财务集团', pid: 0, children: [
        { id: 2, name: '财务中心', pid: 1, children: [] },
        { id: 3, name: '财务共享', pid: 1, children: [] },
      ] },
    ]])
    await expect(f.api.searchOrganizations({ keyword: '财务', limit: 3 })).resolves.toEqual({
      list: [
        { id: 1, name: '财务集团', pid: null, pathNames: '财务集团' },
        { id: 2, name: '财务中心', pid: 1, pathNames: '财务集团/财务中心' },
        { id: 3, name: '财务共享', pid: 1, pathNames: '财务集团/财务共享' },
      ],
    })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/org/organization/getRoleOrganizationTreeNew', method: 'get', params: { excludePost: false },
    })
    await expect(f.api.searchOrganizations({ keyword: ' ' })).rejects.toThrow('非空')
    await expect(f.api.searchOrganizations({ keyword: '财务', limit: 51 })).rejects.toThrow('50')
    expect(f.calls).toHaveLength(1)
  })

  it('顶级创建预览复刻固定组织和页面默认值', () => {
    expect(buildFinanceLedgerAccountPayload({ name: ' 库存现金 ', code: '1001' })).toEqual({
      organizationId: 34,
      name: '库存现金',
      accountingStandardsApply: 1,
      balanceDirection: 1,
      ancillaryAccountings: [],
      pid: '',
      parentName: '',
      type: 1,
      code: '1001',
      subjectFormat: '',
      useSystem: '',
    })
  })

  it('添加下级拼接父编码，继承方向并发送真实POST载荷', async () => {
    const draft = {
      name: '子科目', code: '01', pid: '9007199254740993', parentName: '银行存款', parentCode: '1002',
      balanceDirection: 2, type: 3, subjectFormat: 2, useSystem: [1, 4],
      ancillaryAccountings: ['supplierId'], accountingStandardsApply: 2,
    }
    const f = fixture(['9007199254740994'])
    expect(f.api.prepareCreate(draft).draft.code).toBe('100201')
    await expect(f.api.create(draft)).resolves.toBe('9007199254740994')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/ledger-accounts/create', method: 'post', data: {
        organizationId: 34, name: '子科目', accountingStandardsApply: 2, balanceDirection: 2,
        ancillaryAccountings: ['supplierId'], pid: '9007199254740993', parentName: '银行存款',
        type: 3, code: '100201', subjectFormat: 2, useSystem: '1,4',
      },
    })
    expect(() => buildFinanceLedgerAccountPayload({ name: 'x', code: '01', pid: 3 })).toThrow('同时提供')
    expect(() => buildFinanceLedgerAccountPayload({ name: 'x', code: 'a' })).toThrow('十进制')
  })

  it('启停发送绝对目标状态，0不会被空值吞掉', async () => {
    const f = fixture([null, null])
    await expect(f.api.setStatus({ id: 7, status: 1 })).resolves.toBeNull()
    await expect(f.api.setStatus({ id: '8', status: 0 })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/ledger-accounts/enableOrStop', method: 'get', params: { id: 7, status: 1 } },
      { url: '/admin-api/finance/ledger-accounts/enableOrStop', method: 'get', params: { id: '8', status: 0 } },
    ])
    await expect(f.api.setStatus({ id: 7, status: true as never })).rejects.toThrow('0（启用）')
  })

  it('导出与模板通过同一platform请求返回可保存xlsx', async () => {
    const { api, calls } = captureHttp()
    const exported = await api.export({ name: '现金', ledgerType: 1 })
    const template = await api.downloadTemplate()
    expect(exported).toEqual({
      fileName: '会计科目.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from(xlsx).toString('base64'), byteLength: xlsx.byteLength,
    })
    expect(template.fileName).toBe('会计科目模板.xlsx')
    expect(calls[0]?.url).toMatch(/^\/admin-api\/finance\/ledger-accounts\/export-excel\?/)
    expect(calls[0]?.responseType).toBe('arraybuffer')
    expect(calls[0]?.url).not.toContain('order=')
    expect(calls[1]?.url).toMatch(/^\/admin-api\/finance\/ledger-accounts\/down-excel\?_t=/)
    expect(calls[1]?.headers.get('module-type')).toBeUndefined()
  })

  it('导入先校验文件预览，再以multipart字段file提交并严格接受true', async () => {
    const input = { fileName: '会计科目.xlsx', base64: Buffer.from(xlsx).toString('base64') }
    const f = fixture([true, false])
    expect(f.api.prepareImport(input)).toEqual({
      fileName: '会计科目.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteLength: xlsx.byteLength,
    })
    await expect(f.api.importFile(input)).resolves.toBe(true)
    const form = f.calls[0]?.data as FormData
    const file = form.get('file') as File
    expect(file.name).toBe('会计科目.xlsx')
    expect(file.size).toBe(xlsx.byteLength)
    expect(f.calls[0]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    await expect(f.api.importFile(input)).rejects.toThrow('不是true')
    expect(() => f.api.prepareImport({ ...input, fileName: 'bad.csv' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ ...input, base64: '@@@' })).toThrow('Base64')
  })

  it('坏响应与后端错误保持失败，不伪装为空树或成功', async () => {
    const badXlsx = { data: Uint8Array.from([1, 2, 3, 4]).buffer, headers: {} } as AxiosResponse<ArrayBuffer>
    const f = fixture([{ list: [], total: 0 }, badXlsx, new Error('科目编码或科目名称重复，请修改！')])
    await expect(f.api.list()).rejects.toThrow('树数组')
    await expect(f.api.export()).rejects.toThrow('xlsx')
    await expect(f.api.create({ name: '重复', code: '1001' })).rejects.toThrow('重复')
  })
})

describe('会计科目AI契约与共享接线要求', () => {
  it('十项页面与弹窗能力、方法和AI结构一一对应', async () => {
    expect(financeLedgerAccountsCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_LEDGER_ACCOUNTS_METHODS))
    expect(Object.keys(contracts)).toEqual(financeLedgerAccountsCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_LEDGER_ACCOUNTS_METHODS).map(method => `financeLedgerAccounts.${method}`))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: financeLedgerAccountsCapabilities, contracts })).toEqual([])
    expect((validateAiContracts(contracts, {
      profile: 'complete', definitions: financeLedgerAccountsCapabilities, contracts,
    }) as Array<{ capabilityId: string; code: string }>).filter(item => item.capabilityId.startsWith('finance-ledger-account-')).map(item => item.code)).toEqual(Array(10).fill('incomplete-evidence'))
  })

  it('锁定树非分页、详情本地、添加下级映射与绝对状态语义', () => {
    const list = contracts['finance-ledger-account-list']!
    expect(list.boundaries.join('\n')).toContain('PC没有分页器')
    expect(list.output.fields.find(item => item.path === '[].children')?.meaning).toContain('递归')
    expect(list.steps.find(item => item.capabilityId === 'finance-ledger-account-prepare-create')?.mapping).toEqual({
      pid: 'result.[].id', parentName: 'result.[].name', parentCode: 'result.[].code', balanceDirection: 'result.[].balanceDirection',
    })
    expect(contracts['finance-ledger-account-detail']?.effect).toBe('local')
    const setStatus = contracts['finance-ledger-account-set-status']!
    expect(setStatus.inputs.status?.options).toEqual([{ value: 0, label: '启用' }, { value: 1, label: '停用' }])
    expect(setStatus.steps[0]?.mapping).toEqual({ status: 'args.status' })
  })

  it('锁定固定组织34、文件消费、防重与不可清理写验证缺口', () => {
    const prepared = contracts['finance-ledger-account-prepare-create']!
    expect(prepared.output.fields.find(item => item.path === 'draft.organizationId')?.meaning).toContain('34')
    expect(contracts['finance-ledger-account-export']?.output.fields.find(item => item.path === 'base64')?.meaning).toContain('解码')
    expect(contracts['finance-ledger-account-create']?.idempotency).toContain('createIdempotent')
    expect(contracts['finance-ledger-account-import']?.idempotency).toContain('importIdempotent')
    for (const contract of Object.values(contracts)) {
      expect(contract.boundaries.join('\n')).toContain('没有编辑、删除')
      expect(contract.gaps?.join('\n')).toContain('无法从本页清理')
    }
  })
})
