import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingReceivingAccountCapability,
  financeSettingReceivingAccountCapabilities,
  FINANCE_SETTING_RECEIVING_ACCOUNT_METHODS,
  FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH,
  type FinanceSettingReceivingAccountRow,
} from '../src/capabilities/finance-setting-receiving-account.js'
import {
  FINANCE_SETTING_RECEIVING_ACCOUNT_AI_CONTRACTS as contracts,
  FINANCE_SETTING_RECEIVING_ACCOUNT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-receiving-account.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSettingReceivingAccountRow = {
  id: '9007199254740993',
  organizationId: '17',
  corporationId: '19',
  tenantName: '企业A',
  orgName: '总部',
  bank: 1,
  bankBranch: '测试支行',
  bankAccount: '001234567890',
  accountType: 2,
  accountBusiness: '1,2',
  accountMinimum: '1000.50',
  isUsed: 1,
  status: 0,
  createTime: '2026-09-22 10:20:30',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingReceivingAccountCapability(request), calls }
}

function captureHttp () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config)
    const data = String(config.url).includes('/getAllLegalPerson')
      ? [{ id: 19, name: '法人A' }]
      : { list: [], total: 0 }
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(<T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>)
  const api = createFinanceSettingReceivingAccountCapability(
    config => call(FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH, config as PortalRequestConfig),
  )
  return { api, calls, http }
}

describe('财务设置→银行账户页面能力', () => {
  it('静态锁定菜单、路由、权限、列表接口和法人支撑接口', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/receiving-account.vue'), 'utf8')
    const source = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/receiving-account/list.vue'), 'utf8')
    const formSource = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/receiving-account/[mode]/[id].vue'), 'utf8')

    expect(menu).toContain("path: '" + FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH + "'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/receiving-account'")
    expect(route).toContain('permission: /dashboard/finance/setting/receiving-account')
    expect(source).toContain("getDataListURL: '/admin-api/finance/receiving-account-number/page'")
    expect(source).toContain("http.get('/org/corporation/getAllLegalPerson')")
    expect(source).toContain("create: 'finance:setting:receiving-account:create'")
    expect(source).toContain("status: 'finance:setting:receiving-account:status'")
    expect(source).toContain("http.get('/admin-api/finance/receiving-account-number/enableOrStop'")
    expect(formSource).toContain("http.post('/admin-api/finance/receiving-account-number/create'")

    expect(financeSettingReceivingAccountCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_RECEIVING_ACCOUNT_METHODS))
    expect(financeSettingReceivingAccountCapabilities.every(item => item.pagePath === FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH)).toBe(true)
    expect(financeSettingReceivingAccountCapabilities.every(item => item.permission === '/dashboard/finance/setting/receiving-account')).toBe(true)
    expect(financeSettingReceivingAccountCapabilities.every(item => item.httpInstance === 'platform' && item.moduleType === null)).toBe(true)
    expect(financeSettingReceivingAccountCapabilities.find(item => item.id === 'finance-setting-receiving-account-create')?.write).toBe(true)
    expect(financeSettingReceivingAccountCapabilities.find(item => item.id === 'finance-setting-receiving-account-set-status')?.write).toBe(true)
  })

  it('默认列表逐字段复现Portal筛选和styleV2分页参数，并投影页面字段', async () => {
    const f = fixture([{ list: [{ ...row, ignored: 'not a page field', businessType: '销售' }], total: 1 }])

    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/receiving-account-number/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        organizationId: '',
        corporationId: '',
        bank: '',
        bankAccount: '',
        accountType: '',
        tenantName: '',
        status: 0,
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual([
      'order', 'orderField', 'organizationId', 'corporationId', 'bank', 'bankAccount',
      'accountType', 'tenantName', 'status', 'pageNo', 'pageSize',
    ])
  })

  it('筛选和分页保持原始值、状态是绝对值，非法参数不发请求', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await expect(f.api.list({
      organizationId: '17',
      corporationId: 19,
      bank: 3,
      bankAccount: '0012',
      accountType: 2,
      tenantName: '企业',
      status: 1,
      pageNo: 2,
      pageSize: 50,
    })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]?.params).toEqual({
      order: '',
      orderField: '',
      organizationId: '17',
      corporationId: 19,
      bank: 3,
      bankAccount: '0012',
      accountType: 2,
      tenantName: '企业',
      status: 1,
      pageNo: 2,
      pageSize: 50,
    })

    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(f.api.list({ pageNo: 0 })).rejects.toThrow('pageNo')
    await expect(f.api.list({ status: 2 as 0 })).rejects.toThrow('status')
    await expect(f.api.list({ corporationId: '01' })).rejects.toThrow('corporationId')
    expect(f.calls).toHaveLength(1)
  })

  it('字段形状和页面直接split消费的accountBusiness错误时不伪造成空结果', async () => {
    const badPage = fixture([{ list: null, total: 0 }])
    await expect(badPage.api.list()).rejects.toThrow('list或total')

    const badRow = fixture([{ list: [{ ...row, id: 0 }], total: 1 }])
    await expect(badRow.api.list()).rejects.toThrow('银行账户id')

    const badBusiness = fixture([{ list: [{ ...row, accountBusiness: null }], total: 1 }])
    await expect(badBusiness.api.list()).rejects.toThrow('accountBusiness')

    const badTotal = fixture([{ list: [], total: -1 }])
    await expect(badTotal.api.list()).rejects.toThrow('list或total')
  })

  it('法人支撑读取接受Portal允许的数组/data数组形状，并严格投影id和name', async () => {
    const direct = fixture([[{ id: '19', name: '法人A', ignored: 'x' }]])
    await expect(direct.api.corporationOptions()).resolves.toEqual([{ id: '19', name: '法人A' }])
    expect(direct.calls).toEqual([{ url: '/org/corporation/getAllLegalPerson', method: 'get' }])

    const wrapped = fixture([{ data: [{ id: 20, name: '法人B' }] }])
    await expect(wrapped.api.corporationOptions()).resolves.toEqual([{ id: 20, name: '法人B' }])

    const bad = fixture([{ data: [{ id: 20, name: null }] }])
    await expect(bad.api.corporationOptions()).rejects.toThrow('name')
  })

  it('新建草稿逐字段复现Portal默认值、必填和请求载荷', async () => {
    const f = fixture(["9007199254740995"])
    const prepared = f.api.prepareCreate({
      organizationId: '17',
      corporationId: 19,
      bank: 1,
      bankBranch: '测试支行',
      accountType: 1,
      bankAccount: '001234',
      accountBusiness: [1, 2],
      accountMinimum: 1000.5,
    })
    expect(prepared).toEqual({
      draft: {
        organizationId: '17',
        corporationId: 19,
        bank: 1,
        bankBranch: '测试支行',
        accountType: 1,
        bankAccount: '001234',
        accountBusiness: [1, 2],
        accountMinimum: 1000.5,
        isUsed: 1,
      },
    })
    await expect(f.api.create({
      organizationId: '17', corporationId: 19, bank: 1, bankBranch: '测试支行', accountType: 1,
      bankAccount: '001234', accountBusiness: [1, 2],
    })).resolves.toBe('9007199254740995')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/receiving-account-number/create',
      method: 'post',
      data: {
        organizationId: '17', corporationId: 19, bank: 1, bankBranch: '测试支行', accountType: 1,
        bankAccount: '001234', accountBusiness: [1, 2], accountMinimum: '', isUsed: 1,
      },
    })
    expect(() => f.api.prepareCreate({
      organizationId: 17, corporationId: 19, bank: 1, bankBranch: 'x'.repeat(201), accountType: 1,
      bankAccount: '1', accountBusiness: [1],
    })).toThrow('最多200')
    expect(() => f.api.prepareCreate({
      organizationId: 17, corporationId: 19, bank: 1, bankBranch: 'x', accountType: 1,
      bankAccount: '1', accountBusiness: [],
    })).toThrow('accountBusiness')
    expect(() => f.api.prepareCreate({
      organizationId: 17, corporationId: 19, bank: 1, bankBranch: 'x', accountType: 1,
      bankAccount: '1', accountBusiness: [1], accountMinimum: 1.234,
    })).toThrow('accountMinimum')
  })

  it('启停草稿和提交严格使用GET查询参数，支持previous补偿', async () => {
    const f = fixture([null, null])
    const prepared = f.api.prepareSetStatus({ current: row, targetStatus: 1 })
    expect(prepared).toEqual({
      draft: { id: row.id, status: 1 },
      previous: { id: row.id, status: 0 },
    })
    await expect(f.api.setStatus({ draft: prepared.draft })).resolves.toBeNull()
    await expect(f.api.setStatus({ draft: prepared.previous })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/receiving-account-number/enableOrStop', method: 'get', params: { id: row.id, status: 1 } },
      { url: '/admin-api/finance/receiving-account-number/enableOrStop', method: 'get', params: { id: row.id, status: 0 } },
    ])
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 0 })).toThrow('相反')
    await expect(f.api.setStatus({ draft: { id: row.id, status: 2 as 0 } })).rejects.toThrow('status')
  })

  it('启停接口非Portal null回执时失败关闭', async () => {
    const f = fixture([true])
    await expect(f.api.setStatus({ draft: { id: 1, status: 1 } })).rejects.toThrow('不是null')
  })

  it('platform请求保留tenant/token、不发module-type，并逐字带页面空筛选', async () => {
    const { api, calls, http } = captureHttp()
    await api.list()
    await api.corporationOptions()

    const listConfig = calls[0]!
    expect(listConfig.headers.has('module-type')).toBe(false)
    expect(listConfig.headers.get('tenant-id')).toBe('7')
    expect(listConfig.headers.get('token')).toBe('fixture-token')
    expect(http.getUri(listConfig).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      'https://biz-api-test.wodecorp.cn/admin-api/finance/receiving-account-number/page?order=&orderField=&organizationId=&corporationId=&bank=&bankAccount=&accountType=&tenantName=&status=0&pageNo=1&pageSize=20&_t=<ts>',
    )

    const corporationConfig = calls[1]!
    expect(corporationConfig.headers.has('module-type')).toBe(false)
    expect(http.getUri(corporationConfig).replace(/([?&]_t=)\d+/, '$1<ts>')).toBe(
      'https://biz-api-test.wodecorp.cn/admin-api/org/corporation/getAllLegalPerson?_t=<ts>',
    )
  })
})

describe('银行账户AI契约与反证', () => {
  it('能力定义、公开方法映射和契约结构一一对应', async () => {
    expect(Object.keys(contracts)).toEqual(financeSettingReceivingAccountCapabilities.map(item => item.id))
    expect(Object.keys(methodContracts)).toEqual([
      'financeSettingReceivingAccount.list',
      'financeSettingReceivingAccount.corporationOptions',
      'financeSettingReceivingAccount.prepareCreate',
      'financeSettingReceivingAccount.create',
      'financeSettingReceivingAccount.prepareSetStatus',
      'financeSettingReceivingAccount.setStatus',
    ])
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, {
      definitions: financeSettingReceivingAccountCapabilities,
      contracts,
    })).toEqual([])
    const complete = validateAiContracts(contracts, {
      profile: 'complete',
      definitions: financeSettingReceivingAccountCapabilities,
      contracts,
    }) as Array<{ code: string }>
    expect(complete.map(issue => issue.code)).toEqual(Array.from({ length: 6 }, () => 'incomplete-evidence'))
  })

  it('契约锁定只读边界、筛选默认、法人映射和moduleType证据', () => {
    const list = contracts['finance-setting-receiving-account-list']!
    expect(list.boundaries.join('\\n')).toContain('新建和列表页启停')
    expect(list.boundaries.join('\\n')).toContain('moduleType=null')
    expect(list.inputs.status?.options).toEqual([{ value: 0, label: '启用' }, { value: 1, label: '停用' }])
    expect(list.output.fields.find(item => item.path === 'list[].accountBusiness')?.meaning).toContain('逗号分隔')
    expect(list.steps[0]?.mapping).toEqual({})
    expect(list.steps[0]?.capabilityId).toBe('finance-setting-receiving-account-corporation-options')
    expect(contracts['finance-setting-receiving-account-corporation-options']?.output.fields.find(item => item.path === '[].id')?.meaning).toContain('法人库主键')
    expect(list.gaps?.join('\\n')).toContain('未启动浏览器')
    expect(list.gaps?.join('\\n')).toContain('未验证真实返回字段类型')
    expect(contracts['finance-setting-receiving-account-create']?.effect).toBe('write')
    expect(contracts['finance-setting-receiving-account-set-status']?.output.shape).toBe('null')
  })

  it('反证：删除关键返回字段或错误映射会被契约测试发现', async () => {
    const broken = {
      ...contracts,
      'finance-setting-receiving-account-list': {
        ...contracts['finance-setting-receiving-account-list']!,
        output: {
          ...contracts['finance-setting-receiving-account-list']!.output,
          fields: contracts['finance-setting-receiving-account-list']!.output.fields.filter(item => item.path !== 'list[].corporationId'),
        },
      },
    }
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(broken, {
      definitions: financeSettingReceivingAccountCapabilities,
      contracts: broken,
    }).map((issue: { code: string }) => issue.code)).toContain('unknown-source-field')
  })
})
