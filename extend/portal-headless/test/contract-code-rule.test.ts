import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import { createPortalHeadless } from '../src/index.js'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import {
  CONTRACT_CODE_RULE_MODULE_TYPE,
  CONTRACT_CODE_RULE_PAGE_PATH,
  CONTRACT_CODE_RULE_METHODS,
  contractCodeRuleCapabilities,
  createContractCodeRuleCapability,
} from '../src/capabilities/contract-code-rule.js'

function harness (responses: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return { calls, api: createContractCodeRuleCapability(request) }
}

const draft = {
  id: null,
  fixedPrefix: 'HT',
  dateStyle: 2 as const,
  serialLength: 4 as const,
  description: '合同规则',
}

describe('合同编码规则页面能力', () => {
  it('锁定页面入口、权限、实例和方法映射', () => {
    expect(contractCodeRuleCapabilities).toHaveLength(6)
    expect(contractCodeRuleCapabilities.every(definition =>
      definition.pagePath === '/dashboard/contract/code-rule/list' &&
      definition.permission === '/dashboard/contract/code-rule' &&
      definition.moduleType === CONTRACT_CODE_RULE_MODULE_TYPE &&
      definition.httpInstance === 'platform')).toBe(true)
    expect(new Set(Object.keys(CONTRACT_CODE_RULE_METHODS)).size).toBe(6)
  })

  it('读取当前规则并保留未配置时的null', async () => {
    const { api, calls } = harness([null])
    await expect(api.get()).resolves.toBeNull()
    expect(calls).toEqual([{ url: '/hr/contract-code-rule/getContractCodeRule', method: 'get' }])
  })

  it('AI说明标记sent=true，且实际请求发送module-type=15；错误声明会被反证抓出', async () => {
    const described = createCatalog({ capabilities: ALL_CAPABILITY_DEFINITIONS }).describe('contract-code-rule-get')
    expect(described.ok).toBe(true)
    if (!described.ok) return
    expect(described.howToCall.entryPoints[0]?.moduleType).toEqual({ value: 15, label: '风险防控', sent: true })
    expect(described.howToCall.entryPoints[0]?.moduleType).not.toEqual({ value: null, label: null, sent: false })
    expect(described.ai?.boundaries.join('\n')).toContain('实际发送module-type=15')

    const calls: InternalAxiosRequestConfig[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config)
      return { data: { ret: 'SUCCESS', code: 0, msg: '', data: null }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const api = createContractCodeRuleCapability(config => sdk.call(CONTRACT_CODE_RULE_PAGE_PATH, config))
    await expect(api.get()).resolves.toBeNull()
    expect(calls[0]?.headers.get('module-type')).toBe('15')
  })

  it('按Portal表单规则准备创建、预览并提交完整草稿', async () => {
    const { api, calls } = harness([901])
    expect(api.prepareCreate(draft)).toEqual(draft)
    expect(api.preview({ draft, date: '2026-09-25', serial: 'AB12' })).toBe('HT202609AB12')
    await expect(api.create({ draft })).resolves.toBe(901)
    expect(calls[0]).toEqual({
      url: '/hr/contract-code-rule/create',
      method: 'post',
      data: draft,
    })
  })

  it('更新必须保留id并只接受true回执', async () => {
    const current = { ...draft, id: '17' }
    const { api, calls } = harness([true])
    expect(api.prepareUpdate({ draft: current })).toEqual(current)
    await expect(api.update({ draft: current })).resolves.toBe(true)
    expect(calls).toEqual([{
      url: '/hr/contract-code-rule/update',
      method: 'put',
      data: current,
    }])
  })

  it('非法表单和非true更新回执在请求前/回执处失败', async () => {
    const { api, calls } = harness([false])
    expect(() => api.prepareCreate({ ...draft, fixedPrefix: '' })).toThrow('不能为空')
    expect(() => api.prepareCreate({ ...draft, fixedPrefix: '1234567' })).toThrow('最多6')
    expect(() => api.prepareCreate({ ...draft, dateStyle: 4 })).toThrow('1/2/3')
    expect(() => api.prepareCreate({ ...draft, serialLength: 5 })).toThrow('4/6/8')
    await expect(api.update({ draft: { ...draft, id: 17 } })).rejects.toThrow('不是true')
    expect(calls).toHaveLength(1)
  })
})
