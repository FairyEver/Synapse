import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createHrOrganizationPropertyCapability,
  HR_ORGANIZATION_PROPERTY_METHODS,
  HR_ORGANIZATION_PROPERTY_PAGE_PATH,
  hrOrganizationPropertyCapabilities,
} from '../src/capabilities/hr-organization-property.js'
import {
  HR_ORGANIZATION_PROPERTY_AI_CONTRACTS as contracts,
  HR_ORGANIZATION_PROPERTY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-hr-organization-property.js'
import { resolveModuleType } from '../src/context/module-type.js'

const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
const { validateAiContracts } = await import(validatorUrl)

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig): Promise<T> => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createHrOrganizationPropertyCapability(request), calls }
}

const row = {
  id: '179',
  name: '临时属性',
  code: 'TMP01',
  remark: '临时记录',
  status: 1,
  useNumber: 0,
  creator: 7,
}

describe('组织属性当前 PC 可达动作', () => {
  it('列表逐字段保留 renren 默认值并只返回页面字段', async () => {
    const { api, calls } = setup({ list: [row], total: 1 })
    expect(await api.list()).toEqual({
      list: [{ id: '179', name: '临时属性', code: 'TMP01', remark: '临时记录', status: 1, useNumber: 0 }],
      total: 1,
    })
    expect(calls).toEqual([{
      url: '/hr/org/organizationProperty/page',
      method: 'get',
      params: { order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 },
    }])
  })

  it('名称筛选和分页按页面协议发送，备注缺失归一为 null', async () => {
    const { api, calls } = setup({ list: [{ ...row, remark: undefined, status: 0, useNumber: 3 }], total: 7 })
    expect(await api.list({ name: '属性', pageNo: 2, pageSize: 50, order: 'asc', orderField: 'name' })).toEqual({
      list: [{ id: '179', name: '临时属性', code: 'TMP01', remark: null, status: 0, useNumber: 3 }],
      total: 7,
    })
    expect(calls[0]?.params).toEqual({ order: 'asc', orderField: 'name', name: '属性', pageNo: 2, pageSize: 50 })
  })

  it('新建只提交 PC 表单的 name/remark/code，成功不伪造 ID', async () => {
    const { api, calls } = setup(undefined, undefined)
    await expect(api.create({ name: '临时属性', code: 'TMP01', remark: '说明', id: 8, status: 0 } as never)).resolves.toBeUndefined()
    await expect(api.create({ name: '无备注', code: 'TMP02' })).resolves.toBeUndefined()
    expect(calls[0]).toEqual({
      url: '/hr/org/organizationProperty/save',
      method: 'post',
      data: { name: '临时属性', remark: '说明', code: 'TMP01' },
    })
    expect(Object.keys(calls[0]?.data as object)).toEqual(['name', 'remark', 'code'])
    expect(calls[1]?.data).toEqual({ name: '无备注', remark: '', code: 'TMP02' })
  })

  it('作废与启用只发送后端需要的绝对状态', async () => {
    const { api, calls } = setup(undefined, undefined)
    await expect(api.deactivate({ id: 179, currentStatus: 1, useNumber: 0 })).resolves.toBeUndefined()
    await expect(api.enable({ id: '179', currentStatus: 0 })).resolves.toBeUndefined()
    expect(calls).toEqual([
      { url: '/hr/org/organizationProperty/updateStatus', method: 'post', data: { id: 179, status: 0 } },
      { url: '/hr/org/organizationProperty/updateStatus', method: 'post', data: { id: '179', status: 1 } },
    ])
  })

  it('复现 PC 按钮条件，过期/错误行值在写请求前拒绝', async () => {
    const { api, calls } = setup()
    await expect(api.deactivate({ id: 179, currentStatus: 0, useNumber: 0 })).rejects.toThrow('状态为 1')
    await expect(api.deactivate({ id: 179, currentStatus: 1, useNumber: 2 })).rejects.toThrow('useNumber')
    await expect(api.enable({ id: 179, currentStatus: 1 })).rejects.toThrow('状态为 0')
    await expect(api.enable({ id: '00179', currentStatus: 0 })).rejects.toThrow('ID')
    expect(calls).toEqual([])
  })

  it('表单、分页及响应语义错误不会被当成成功或空结果', async () => {
    const { api, calls } = setup()
    for (const change of [
      { name: '' },
      { name: '  ' },
      { name: '中'.repeat(21) },
      { code: '' },
      { code: ' ' },
      { code: 'A'.repeat(11) },
      { remark: ' ' },
      { remark: '中'.repeat(51) },
    ]) {
      await expect(api.create({ name: '属性', code: 'CODE', ...change })).rejects.toThrow()
    }
    for (const query of [{ pageNo: 0 }, { pageSize: 0 }, { pageSize: 501 }]) {
      await expect(api.list(query)).rejects.toThrow()
    }
    expect(calls).toEqual([])

    const bad = setup({ list: [{ ...row, status: 2 }], total: 1 })
    await expect(bad.api.list()).rejects.toThrow('status')
    const backend = setup(new Error('名称重复,请重新输入'))
    await expect(backend.api.create({ name: '属性', code: 'CODE' })).rejects.toThrow('名称重复')
  })

  it('浏览器基准与实现锁定列表、新建、作废、启用及 module-type 11', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/hr-organization-property.browser.json', import.meta.url), 'utf8')) as {
      headers: { 'module-type': string }
      requests: Array<{ action: string; method: string; url: string; body?: unknown; bodyShape?: string[] }>
      cleanup: { publishedCapability: boolean }
    }
    expect(resolveModuleType(HR_ORGANIZATION_PROPERTY_PAGE_PATH).moduleType).toBe(11)
    expect(baseline.headers['module-type']).toBe('11')
    expect(baseline.requests.map(request => [request.action, request.method, request.url])).toEqual([
      ['list', 'GET', '/admin-api/hr/org/organizationProperty/page?order=&orderField=&name=&pageNo=1&pageSize=20'],
      ['create', 'POST', '/admin-api/hr/org/organizationProperty/save'],
      ['deactivate', 'POST', '/admin-api/hr/org/organizationProperty/updateStatus'],
      ['enable', 'POST', '/admin-api/hr/org/organizationProperty/updateStatus'],
    ])
    expect(baseline.requests[1]?.bodyShape).toEqual(['name', 'remark', 'code'])
    expect(baseline.requests[2]?.body).toEqual({ id: 179, status: 0 })
    expect(baseline.requests[3]?.body).toEqual({ id: 179, status: 1 })
    expect(baseline.cleanup.publishedCapability).toBe(false)
  })
})

describe('组织属性 AI 契约', () => {
  it('只发布四个当前可达动作，结构与完整证据检查均通过', () => {
    expect(hrOrganizationPropertyCapabilities.map(item => item.id)).toEqual([
      'hr-organization-property-list',
      'hr-organization-property-create',
      'hr-organization-property-deactivate',
      'hr-organization-property-enable',
    ])
    expect(hrOrganizationPropertyCapabilities.every(item => item.pagePath === HR_ORGANIZATION_PROPERTY_PAGE_PATH)).toBe(true)
    expect(hrOrganizationPropertyCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    expect(validateAiContracts(contracts, { definitions: hrOrganizationPropertyCapabilities, contracts })).toEqual([])
    expect(validateAiContracts(contracts, { profile: 'complete', definitions: hrOrganizationPropertyCapabilities, contracts })).toEqual([])
    expect(Object.values(contracts).every(contract => contract.gaps?.length === 0)).toBe(true)
  })

  it('列表字段语义、PC 按钮条件和后续参数映射不能退化', () => {
    const list = contracts['hr-organization-property-list']!
    expect(list.output.fields.map(item => item.path)).toEqual([
      '$', 'list', 'list[]', 'list[].id', 'list[].name', 'list[].code', 'list[].remark', 'list[].status', 'list[].useNumber', 'total',
    ])
    expect(list.output.fields.find(item => item.path === 'list[].status')?.values).toEqual({
      '0': '已作废，PC 显示“启用”',
      '1': '启用；且 useNumber=0 时 PC 显示“作废”',
    })
    expect(list.steps.map(step => [step.capabilityId, step.mapping])).toEqual([
      ['hr-organization-property-deactivate', { id: 'result.list[].id', currentStatus: 'result.list[].status', useNumber: 'result.list[].useNumber' }],
      ['hr-organization-property-enable', { id: 'result.list[].id', currentStatus: 'result.list[].status' }],
    ])
    expect(contracts['hr-organization-property-deactivate']?.inputs.useNumber?.meaning).toContain('严格为数值 0')
    expect(contracts['hr-organization-property-enable']?.steps[0]?.capabilityId).toBe('hr-organization-property-list')
  })

  it('创建无返回 ID，状态写无删除承诺，所有公开方法都有完整说明', () => {
    expect(contracts['hr-organization-property-create']?.output.shape).toBe('undefined')
    expect(contracts['hr-organization-property-create']?.steps[0]?.mapping).toEqual({ name: 'args.name' })
    expect(contracts['hr-organization-property-deactivate']?.consume.join(' ')).toContain('不会删除记录')
    expect(JSON.stringify(contracts)).not.toContain('hr-organization-property-remove')
    expect(Object.keys(methodContracts)).toEqual([
      'hrOrganizationProperty.list',
      'hrOrganizationProperty.create',
      'hrOrganizationProperty.deactivate',
      'hrOrganizationProperty.enable',
    ])
    for (const [capabilityId, method] of Object.entries(HR_ORGANIZATION_PROPERTY_METHODS)) {
      expect(contracts[capabilityId]).toBeDefined()
      expect(methodContracts[`hrOrganizationProperty.${method}`]).toBeDefined()
    }
  })
})
