import { describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { AiModelApplyPartialWriteError, installAiModelCompatibility, normalizeAiModelRequest, withAiModelCompatibility } from '../src/capabilities/ai-model-compat.js'

function fixture () {
  const client = {
    listApplyRecords: vi.fn(async (_query?: { status?: number }) => ({ list: [{ id: 8, status: 4 }], total: 1 })),
    handleApply: vi.fn(async (_apply: { id: number | string }, _status: number, _options?: { rejectReason?: string }): Promise<unknown> => true),
    saveQuotaRule: vi.fn(async (_draft: object): Promise<unknown> => 901),
    saveFlowRule: vi.fn(async (_draft: object): Promise<unknown> => 902),
    searchUsers: vi.fn(async () => ({ list: [{ phone: '13800138000', userName: '申请人', tradeStr: 'HR同步' }], total: 1 })),
  }
  return { client, sdk: withAiModelCompatibility(client) }
}
const apply = { id: 8, modelId: 7, status: 0, userId: 99, userPhone: '13800138000', userName: '申请人', expectedMonthlyQuota: 2000, expectedMaxToken: 1000 }
const quotaForm = { resetCycle: 3, shortageStrategy: 1, startTime: '2026-09-22 00:00:00' }

describe('AI model compatibility without importing the optional capability implementation', () => {
  it('preserves created rule evidence when status receipt is false, null or missing', async () => {
    for (const receipt of [false, null, undefined]) {
      const { client, sdk } = fixture()
      client.handleApply.mockResolvedValueOnce(receipt)
      await expect(sdk.fillApplyWithQuotaRule({ apply, form: quotaForm })).rejects.toMatchObject({ code: 'AI_MODEL_APPLY_PARTIAL_WRITE', createdRuleId: 901, applyId: 8 })
      expect(client.saveQuotaRule).toHaveBeenCalledTimes(1)
    }
  })

  it('fills personal tenant zero only on the exact flow create/update request and preserves all other fields', () => {
    const input = { url: '/admin-api/ai-token/flow-rule/create', method: 'POST', data: { ruleScope: 3, targetUserPhone: '13800138000' }, timeout: 4000 }
    const normalized = normalizeAiModelRequest(input)
    expect(normalized.data).toEqual({ ruleScope: 3, targetUserPhone: '13800138000', targetTenantId: 0 })
    expect(normalized.timeout).toBe(4000)
    expect(input.data).not.toHaveProperty('targetTenantId')
    expect(normalizeAiModelRequest({ ...input, url: '/admin-api/ai-token/flow-rule/update', method: 'put', data: { ...input.data, targetTenantId: null } }).data.targetTenantId).toBe(0)
    for (const patch of [
      { url: 'https://example.invalid/admin-api/ai-token/flow-rule/create' },
      { url: '/admin-api/ai-token/flow-rule/create?tenant=0' },
      { method: 'get' },
      { url: '/admin-api/ai-token/flow-rule/update', method: 'post' },
      { url: '/admin-api/ai-token/quota-rule/create' },
      { data: { ruleScope: 3, targetUserId: 99 } },
      { data: { ruleScope: 3, targetUserPhone: '  ' } },
      { data: { ruleScope: 2, targetUserPhone: '13800138000' } },
      { data: { ruleScope: 3, targetUserPhone: '13800138000', targetTenantId: 16 } },
    ]) {
      const other = { ...input, ...patch }
      expect(normalizeAiModelRequest(other)).toBe(other)
    }
  })

  it('validates Java integer fields and JS precision before creating either rule', async () => {
    const { client, sdk } = fixture()
    for (const totalQuota of [0.5, 9007199254740992, '9007199254740993', '9007199254740991.1', '1e3']) {
      await expect(sdk.fillApplyWithQuotaRule({ apply, form: { ...quotaForm, totalQuota } })).rejects.toThrow('安全正整数')
    }
    const form = { tokenLimitPerMinute: 5000, exceedStrategy: 1, startTime: quotaForm.startTime }
    await expect(sdk.fillApplyWithFlowRule({ apply, form: { ...form, maxTokenPerRequest: 2147483648 } })).rejects.toThrow('2147483647')
    await expect(sdk.fillApplyWithFlowRule({ apply, form: { ...form, tokenLimitPerMinute: '9007199254740993' } })).rejects.toThrow('安全正整数')
    expect(client.saveQuotaRule).not.toHaveBeenCalled()
    expect(client.saveFlowRule).not.toHaveBeenCalled()
    await sdk.fillApplyWithQuotaRule({ apply, form: { ...quotaForm, totalQuota: String(Number.MAX_SAFE_INTEGER) } })
    expect(client.saveQuotaRule).toHaveBeenCalledWith(expect.objectContaining({ totalQuota: Number.MAX_SAFE_INTEGER }))
  })

  it('replaces legacy fill signatures with phone-aware typed methods', async () => {
    const legacy = {
      ...fixture().client,
      fillApplyWithQuotaRule: async (_input: { apply: { id: number }; form?: { startTime?: string } }) => ({ createdRuleId: 0, applyHandled: false, warnings: [] }),
    }
    const sdk = withAiModelCompatibility(legacy)
    // A typed call, without any/casts: the old method type must not hide the new form field.
    const result = await sdk.fillApplyWithQuotaRule({ apply: { ...apply, userPhone: undefined }, form: { ...quotaForm, targetUserPhone: '13800138000' } })
    expect(result.createdRuleId).toBe(901)
    expect(legacy.saveQuotaRule).toHaveBeenCalledWith(expect.objectContaining({ targetUserPhone: '13800138000' }))
  })
  it('installs once in place and tolerates HEAD without the optional facade', async () => {
    expect(() => installAiModelCompatibility({})).not.toThrow()
    expect(() => installAiModelCompatibility({ aiModel: {} })).not.toThrow()
    const { client } = fixture()
    const host = { aiModel: client }
    const original = client.handleApply
    installAiModelCompatibility(host)
    const wrapped = host.aiModel.handleApply
    installAiModelCompatibility(host)
    expect(host.aiModel).toBe(client)
    expect(host.aiModel.handleApply).toBe(wrapped)
    expect(wrapped).not.toBe(original)
    await host.aiModel.handleApply({ id: 8 }, 4)
    expect(original).toHaveBeenCalledTimes(1)
    await expect(host.aiModel.handleApply({ id: 8 }, 2)).rejects.toThrow('没有可靠映射')
    expect(original).toHaveBeenCalledTimes(1)
  })
  it('matches Java validated query/write 0/3/4 and explains the visible Portal ignore conflict', async () => {
    const { client, sdk } = fixture()
    for (const status of [1, 2, -1, 5, NaN, '4']) {
      expect(() => sdk.prepareHandleApply(apply, status as number)).toThrow('没有可靠映射')
      await expect(sdk.handleApply(apply, status as number)).rejects.toThrow('没有可靠映射')
      expect(() => sdk.listApplyRecords({ status: status as number })).toThrow('没有可靠映射')
    }
    expect(() => sdk.prepareHandleApply(apply, 1)).toThrow('Portal 忽略发送 1')
    expect(() => sdk.listApplyRecords({status:1})).toThrow('当前 Java 查询和写入均拒绝')
    expect(client.handleApply).not.toHaveBeenCalled()
    expect(client.listApplyRecords).not.toHaveBeenCalled()
    for (const status of [0, 3, 4]) {
      expect(sdk.prepareHandleApply(apply, status).payload).toEqual({ id: 8, status, statisticsDimension: 3 })
      await sdk.handleApply(apply, status)
      await sdk.listApplyRecords({ status })
    }
    await sdk.cancelHandledApply(8, 0)
    expect(client.handleApply).toHaveBeenLastCalledWith({ id: 8 }, 0, {})
    expect(sdk.searchUsers).toBe(client.searchUsers)
  })

  it('personal quota targets the application phone and marks handled=4 only after rule creation', async () => {
    const { client, sdk } = fixture()
    const receipt = await sdk.fillApplyWithQuotaRule({ apply, form: quotaForm })
    expect(receipt).toEqual({ createdRuleId: 901, applyHandled: true, warnings: [] })
    expect(client.saveQuotaRule).toHaveBeenCalledWith(expect.objectContaining({ ruleScope: 3, targetUserPhone: apply.userPhone, totalQuota: 2000 }))
    expect(client.saveQuotaRule.mock.calls[0]![0]).not.toHaveProperty('targetUserId')
    expect(client.saveQuotaRule.mock.calls[0]![0]).not.toHaveProperty('id')
    expect(client.handleApply).toHaveBeenCalledWith({ id: 8 }, 4, {})
    expect(client.saveQuotaRule.mock.invocationCallOrder[0]!).toBeLessThan(client.handleApply.mock.invocationCallOrder[0]!)
  })

  it('missing or conflicting phone stops before writes; explicit candidate phone restores the supported path', async () => {
    const { client, sdk } = fixture()
    const missing = { ...apply, userPhone: undefined }
    await expect(sdk.fillApplyWithQuotaRule({ apply: missing, form: quotaForm })).rejects.toThrow('ai-model-search-user')
    await expect(sdk.fillApplyWithQuotaRule({ apply, form: { ...quotaForm, targetUserPhone: '13900139000' } })).rejects.toThrow('不一致')
    expect(client.saveQuotaRule).not.toHaveBeenCalled()
    const candidate = (await sdk.searchUsers()).list[0]!
    await sdk.fillApplyWithQuotaRule({ apply: missing, form: { ...quotaForm, targetUserPhone: candidate.phone, targetUserName: candidate.userName, targetUserTypeName: candidate.tradeStr } })
    expect(client.saveQuotaRule).toHaveBeenLastCalledWith(expect.objectContaining({ targetUserPhone: candidate.phone, targetUserTypeName: candidate.tradeStr }))
  })

  it('tenant targeting and zero-tenant personal targeting remain distinct; skip does not call handle', async () => {
    const { client, sdk } = fixture()
    const form = { tokenLimitPerMinute: 5000, exceedStrategy: 1, startTime: quotaForm.startTime }
    const result = await sdk.fillApplyWithFlowRule({ apply: { ...apply, tenantId: 16, tenantName: '目标企业', userPhone: undefined }, form, skipApplyStatus: true })
    expect(result).toEqual({ createdRuleId: 902, applyHandled: null, warnings: [] })
    expect(client.handleApply).not.toHaveBeenCalled()
    expect(client.saveFlowRule).toHaveBeenLastCalledWith(expect.objectContaining({ ruleScope: 2, targetTenantId: 16, targetTenantName: '目标企业', maxTokenPerRequest: 1000 }))
    expect(client.saveFlowRule.mock.calls[0]![0]).not.toHaveProperty('targetUserPhone')
    await sdk.fillApplyWithFlowRule({ apply: { ...apply, tenantId: '0' }, form })
    expect(client.saveFlowRule).toHaveBeenLastCalledWith(expect.objectContaining({ ruleScope: 3, targetUserPhone: apply.userPhone }))
  })

  it('second-write failure retains the created rule and cause; never retries either write or deletes automatically', async () => {
    const { client, sdk } = fixture()
    const cause = new Error('socket closed after sending')
    client.handleApply.mockRejectedValueOnce(cause)
    let caught: unknown
    try { await sdk.fillApplyWithQuotaRule({ apply, form: quotaForm }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(AiModelApplyPartialWriteError)
    expect(caught).toMatchObject({ code: 'AI_MODEL_APPLY_PARTIAL_WRITE', createdRuleId: 901, applyId: 8, ruleKind: 'quota', previousStatus: 0, stage: 'handleApply', cause })
    expect(client.saveQuotaRule).toHaveBeenCalledTimes(1)
    expect(client.handleApply).toHaveBeenCalledTimes(1)
    // Recovery deliberately handles only the existing application, not the whole fill again.
    await sdk.handleApply({ id: 8 }, 4)
    expect(client.saveQuotaRule).toHaveBeenCalledTimes(1)
  })

  it('preserves an old or absent apply.status as an unvalidated recovery snapshot, without defaulting to zero', async () => {
    for (const previousStatus of [1, undefined]) {
      const { client, sdk } = fixture()
      client.handleApply.mockRejectedValueOnce(new Error('uncertain status write'))
      await expect(sdk.fillApplyWithQuotaRule({ apply: { ...apply, status: previousStatus }, form: quotaForm })).rejects.toMatchObject({ createdRuleId: 901, previousStatus })
      expect(client.handleApply).toHaveBeenCalledWith({ id: 8 }, 4, {})
    }
  })

  it('validates required rule values before writing and stops on an unusable create receipt', async () => {
    const { client, sdk } = fixture()
    await expect(sdk.fillApplyWithQuotaRule({ apply, form: { ...quotaForm, resetCycle: undefined } })).rejects.toThrow('resetCycle')
    expect(client.saveQuotaRule).not.toHaveBeenCalled()
    client.saveQuotaRule.mockResolvedValueOnce(null)
    await expect(sdk.fillApplyWithQuotaRule({ apply, form: quotaForm })).rejects.toThrow('写入结果不确定')
    expect(client.handleApply).not.toHaveBeenCalled()
  })
})

// The independent committed checkout can run the six tests above without ai-model.ts.
describe.skipIf(!existsSync(new URL('../src/capabilities/ai-model.ts', import.meta.url)))('compatibility over the actual SDK executor', () => {
  it('emits phone-based rule payload and status=4 through the existing request methods', async () => {
    const modulePath = '../src/capabilities/ai-model.js'
    const { createAiModelCapability } = await import(modulePath)
    const calls: Array<{ url: string; method?: string; data?: Record<string, unknown> }> = []
    const request = async (config: (typeof calls)[number]) => { calls.push(config); return config.url.includes('quota-rule/create') ? 903 : true }
    const host = { aiModel: createAiModelCapability(request, request, request, request) }
    installAiModelCompatibility(host)
    const sdk = host.aiModel
    await sdk.fillApplyWithQuotaRule({ apply, form: quotaForm })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.data).toMatchObject({ ruleScope: 3, targetUserPhone: apply.userPhone, quotaCheckEnabled: true, enabled: true })
    expect(calls[0]?.data).not.toHaveProperty('targetUserId')
    expect(calls[1]?.data).toEqual({ id: 8, status: 4, statisticsDimension: 3 })
    const count = calls.length
    await expect(sdk.handleApply({ id: 8 }, 2)).rejects.toThrow('没有可靠映射')
    expect(calls).toHaveLength(count)
  })
})
