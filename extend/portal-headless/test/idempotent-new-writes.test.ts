import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import {
  CapabilityInvokeError,
  createPortalHeadless,
  createPortalServer,
  createRequestId,
} from '../src/index.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequestFactory } from '../src/session/index.js'

const supplierDraft = {
  name: '幂等测试客商',
  code: 'IDEMPOTENT001',
  autoAssignCode: false,
  companyId: '1001',
  originalCompanyUpdate: false,
  supplyChainFinance: false,
  status: 0 as const,
  bankAccounts: [],
}

const roleDraft = {
  id: '',
  useSystem: 0,
  roleIdentifier: null,
  name: '幂等测试角色',
  menuIdList: [],
  remark: null,
  dataScope: 2 as const,
  roleModuleDataScopeRelList: [],
}

const contractDraft = {
  name: '幂等测试合同',
  templateId: 56,
  typeId: 21,
  code: null,
  organizationId: 34,
  dataList: [],
  content: JSON.stringify({ version: '1.1.0', blocks: [{ id: 'b1', name: 'Custom/Text', data: {} }] }),
  businessId: null,
  featureId: null,
  useSystem: null,
  onlySave: 1 as const,
  variableApi: '',
  variableApiData: '',
  callbackApi: '',
  callbackApiData: '',
  callbackApiForSignAfterApi: '',
  callbackApiForSignAfterApiData: '',
}

function headlessFixture () {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-idempotent', tenantId: 7 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    const data = String(config.url).includes('/finance/party/create')
      ? 9001
      : String(config.url).includes('/hr/contract/createContractByCommon')
        ? { id: 7001, code: null, contractVersionId: 7002, onlySave: 1 }
        : undefined
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { sdk, calls }
}

function bodyOf (config: InternalAxiosRequestConfig | undefined): Record<string, unknown> {
  return JSON.parse(String(config?.data ?? '{}')) as Record<string, unknown>
}

function serverFactory (calls: Array<{ token: string; request: PortalRequestConfig }>): PortalRequestFactory {
  return ({ credential }) => <T>(request: PortalRequestConfig): Promise<T> => {
    calls.push({ token: credential.token, request })
    if (String(request.url).includes('/finance/party/create')) return Promise.resolve(9001 as T)
    if (String(request.url).includes('/hr/contract/createContractByCommon')) return Promise.resolve({ id: 7001, code: null, contractVersionId: 7002, onlySave: 1 } as T)
    return Promise.resolve(undefined as T)
  }
}

describe('新增写能力的独立幂等接线', () => {
  it('供应商和角色 invoke 都要求 requestId、复用同键且不把 requestId 发到 Portal body', async () => {
    const { sdk, calls } = headlessFixture()
    const supplierRequestId = createRequestId()
    const roleRequestId = createRequestId()

    await expect(sdk.capabilities.invoke('finance-setting-opening-supplier-create', { draft: supplierDraft })).rejects.toBeInstanceOf(CapabilityInvokeError)
    await expect(sdk.capabilities.invoke('setting-role-create', { draft: roleDraft })).rejects.toBeInstanceOf(CapabilityInvokeError)
    expect(calls).toHaveLength(0)

    await sdk.capabilities.invoke('finance-setting-opening-supplier-create', { draft: supplierDraft, requestId: supplierRequestId })
    await sdk.capabilities.invoke('finance-setting-opening-supplier-create', { draft: supplierDraft, requestId: supplierRequestId })
    await sdk.capabilities.invoke('setting-role-create', { draft: roleDraft, requestId: roleRequestId })
    await sdk.capabilities.invoke('setting-role-create', { draft: roleDraft, requestId: roleRequestId })

    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[0]?.data)).not.toContain(supplierRequestId)
    expect(JSON.stringify(calls[1]?.data)).not.toContain(roleRequestId)
    expect(bodyOf(calls[0])).toMatchObject({ name: supplierDraft.name, code: supplierDraft.code, companyId: supplierDraft.companyId })
    expect(bodyOf(calls[1])).toMatchObject({ name: roleDraft.name, dataScope: 2 })
  })

  it('合同创建 invoke 使用同一个本地幂等入口，冲突草稿和requestId都不会进入Portal', async () => {
    const { sdk, calls } = headlessFixture()
    const requestId = createRequestId()
    await expect(sdk.capabilities.invoke('contract-create', { draft: contractDraft })).rejects.toBeInstanceOf(CapabilityInvokeError)
    await sdk.capabilities.invoke('contract-create', { draft: contractDraft, requestId })
    await sdk.capabilities.invoke('contract-create', { draft: contractDraft, requestId })
    await expect(sdk.capabilities.invoke('contract-create', { draft: { ...contractDraft, name: '另一份合同' }, requestId })).rejects.toThrow(/requestId/)
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0])).toEqual(contractDraft)
    expect(JSON.stringify(calls[0]?.data)).not.toContain(requestId)
  })

  it('多用户同租户撞同一个 requestId 时各自只发送一次，回执不串用户', async () => {
    const calls: Array<{ token: string; request: PortalRequestConfig }> = []
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: { createRequest: serverFactory(calls) },
    })
    const first = await server.forSession({ userId: 'u1', credential: { token: 'tk-u1', tenantId: 7 }, capabilities: [] })
    const second = await server.forSession({ userId: 'u2', credential: { token: 'tk-u2', tenantId: 7 }, capabilities: [] })
    const requestId = createRequestId()

    await first.financeSettingOpeningSupplier.createIdempotent({ draft: supplierDraft, requestId })
    await first.financeSettingOpeningSupplier.createIdempotent({ draft: supplierDraft, requestId })
    await second.financeSettingOpeningSupplier.createIdempotent({ draft: supplierDraft, requestId })
    await second.settingRole.createIdempotent({ draft: roleDraft, requestId })

    expect(calls.map(item => item.token)).toEqual(['tk-u1', 'tk-u2', 'tk-u2'])
    expect(calls.every(item => !JSON.stringify(item.request.data).includes(requestId))).toBe(true)
  })

  it('合同创建的幂等键按用户隔离', async () => {
    const calls: Array<{ token: string; request: PortalRequestConfig }> = []
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: { createRequest: serverFactory(calls) },
    })
    const first = await server.forSession({ userId: 'u1', credential: { token: 'tk-u1', tenantId: 7 }, capabilities: [] })
    const second = await server.forSession({ userId: 'u2', credential: { token: 'tk-u2', tenantId: 7 }, capabilities: [] })
    const requestId = createRequestId()
    await first.contractCreate.createIdempotent({ draft: contractDraft, requestId })
    await first.contractCreate.createIdempotent({ draft: contractDraft, requestId })
    await second.contractCreate.createIdempotent({ draft: contractDraft, requestId })
    expect(calls.map(item => item.token)).toEqual(['tk-u1', 'tk-u2'])
  })
})
