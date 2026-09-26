import type { PortalRequest } from '../session/types.js'
import { assertContractContent, type ContractData, type ContractId } from './contract-library.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 风控管理 → 合同管理 → 合同创建」及其实际可达的预览提交流程。 */
export const CONTRACT_CREATE_PAGE_PATH = '/dashboard/contract/create/list'
export const CONTRACT_CREATE_PERMISSION = '/dashboard/contract/create'
export const CONTRACT_CREATE_MODULE_TYPE = 15

const TEMPLATE_ROOT = '/hr/contract-template'
const CONTRACT_ROOT = '/hr/contract'

export type ContractCreateVariable = {
  name: string
  value: string | null
}

export type ContractCreateTemplate = Record<string, unknown> & {
  id: ContractId
  typeId: ContractId | null
  typeName: string | null
  name: string | null
  fileUrl: string | null
  fileName: string | null
  processInstanceId: string | null
  status: number | null
  content: string | null
  versionId: ContractId | null
  version: number | null
  useSystem: number | null
}

export type ContractCreateDraft = {
  name: string
  templateId: ContractId
  typeId: ContractId
  code: null
  startDate?: string | null
  endDate?: string | null
  organizationId: ContractId
  dataList: ContractData[]
  content: string
  businessId: ContractId | null
  featureId: ContractId | null
  useSystem: number | null
  onlySave: 0 | 1
  variableApi: string
  variableApiData: string
  callbackApi: string
  callbackApiData: string
  callbackApiForSignAfterApi: string
  callbackApiForSignAfterApiData: string
}

export type ContractCreateReceipt = Record<string, unknown> & {
  id: ContractId
  code: string | null
  contractVersionId: ContractId | null
  onlySave: number | null
}

export type ContractCreateInput = {
  name: string
  typeId: ContractId
  organizationId: ContractId
  contractTemplateId: ContractId
  content: string
  variables?: ContractCreateVariable[]
  startDate?: string | null
  endDate?: string | null
  businessId?: ContractId | null
  featureId?: ContractId | null
  useSystem?: number | null
  onlySave: 0 | 1
  variableApi?: string | null
  variableApiData?: string | null
  callbackApi?: string | null
  callbackApiData?: string | null
  callbackApiForSignAfterApi?: string | null
  callbackApiForSignAfterApiData?: string | null
}

export type ContractCreateCapability = {
  templateOptions: (input: { typeId: ContractId; useSystem?: number | null }) => Promise<ContractCreateTemplate[]>
  template: (input: { id: ContractId }) => Promise<ContractCreateTemplate>
  variables: (input: { variableApi?: string | null; variableApiData?: string | null }) => Promise<ContractCreateVariable[]>
  prepare: (input: ContractCreateInput) => { draft: ContractCreateDraft }
  create: (input: { draft: ContractCreateDraft }) => Promise<ContractCreateReceipt>
  callback: (input: { receipt: ContractCreateReceipt; onlySave: 0 | 1; callbackApi?: string | null; callbackApiData?: string | null }) => Promise<true>
}

/** 创建合同的 SDK 本地短窗口防重入口；requestId 不进入 Portal 请求体。 */
export type ContractCreateCapabilityWithIdempotency = ContractCreateCapability & {
  createIdempotent: (input: { draft: ContractCreateDraft; requestId: string }) => Promise<ContractCreateReceipt>
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function arrayOf (value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value
}

function idOf (value: unknown, label: string): ContractId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): ContractId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function integerOrNullOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function dateOf (value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD或null`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function endpointOf (value: unknown, label: string, allowEmpty = true): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  if (!allowEmpty && value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function safeEndpointOf (value: unknown, label: string): string {
  const endpoint = endpointOf(value, label)
  if (!endpoint) return endpoint

  let decoded = endpoint
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      throw new Error(`${label}必须为站内根相对路径`)
    }
    if (next === decoded) break
    decoded = next
    if (attempt === 4) throw new Error(`${label}必须为站内根相对路径`)
  }

  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    throw new Error(`${label}必须为站内根相对路径`)
  }
  return endpoint
}

function parseParamsOf (value: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // Portal catches malformed variableApiData and continues with an empty params object.
  }
  return {}
}

function variableOf (value: unknown, index: number): ContractCreateVariable {
  const row = objectOf(value, `变量响应[${index}]`)
  const name = requiredTextOf(row.name, `变量响应[${index}].name`)
  const variableValue = nullableTextOf(row.value, `变量响应[${index}].value`)
  return { name, value: variableValue }
}

function variablesOf (value: unknown): ContractCreateVariable[] {
  return arrayOf(value, '变量响应').map((item, index) => variableOf(item, index))
}

function dataListOf (value: unknown): ContractData[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('variables必须是数组')
  const seen = new Set<string>()
  return value.map((item, index) => {
    const row = objectOf(item, `variables[${index}]`)
    const contractKey = requiredTextOf(row.name, `variables[${index}].name`)
    const normalizedKey = contractKey.trim()
    if (seen.has(normalizedKey)) throw new Error(`variables存在重复name：${normalizedKey}`)
    seen.add(normalizedKey)
    return { contractKey, contractValue: nullableTextOf(row.value, `variables[${index}].value`) }
  })
}

function templateOf (value: unknown, label: string): ContractCreateTemplate {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    typeId: nullableIdOf(row.typeId, `${label}.typeId`),
    typeName: nullableTextOf(row.typeName, `${label}.typeName`),
    name: nullableTextOf(row.name, `${label}.name`),
    fileUrl: nullableTextOf(row.fileUrl, `${label}.fileUrl`),
    fileName: nullableTextOf(row.fileName, `${label}.fileName`),
    processInstanceId: nullableTextOf(row.processInstanceId, `${label}.processInstanceId`),
    status: integerOrNullOf(row.status, `${label}.status`),
    content: nullableTextOf(row.content, `${label}.content`),
    versionId: nullableIdOf(row.versionId, `${label}.versionId`),
    version: integerOrNullOf(row.version, `${label}.version`),
    useSystem: integerOrNullOf(row.useSystem, `${label}.useSystem`),
  }
}

function receiptOf (value: unknown): ContractCreateReceipt {
  const row = objectOf(value, '创建合同回执')
  return {
    ...row,
    id: idOf(row.id, '创建合同回执.id'),
    code: nullableTextOf(row.code, '创建合同回执.code'),
    contractVersionId: nullableIdOf(row.contractVersionId, '创建合同回执.contractVersionId'),
    onlySave: integerOrNullOf(row.onlySave, '创建合同回执.onlySave'),
  }
}

function prepareOf (input: ContractCreateInput): { draft: ContractCreateDraft } {
  const source = input as Partial<ContractCreateInput> | null | undefined
  const name = requiredTextOf(source?.name, 'name')
  const templateId = idOf(source?.contractTemplateId, 'contractTemplateId')
  const typeId = idOf(source?.typeId, 'typeId')
  const organizationId = idOf(source?.organizationId, 'organizationId')
  const content = requiredTextOf(source?.content, 'content')
  assertContractContent(content)
  const onlySave = source?.onlySave
  if (onlySave !== 0 && onlySave !== 1) throw new Error('onlySave必须是0或1')
  const variables = dataListOf(source?.variables)
  const startDate = dateOf(source?.startDate, 'startDate')
  const endDate = dateOf(source?.endDate, 'endDate')
  const draft: ContractCreateDraft = {
    name,
    templateId,
    typeId,
    code: null,
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    organizationId,
    dataList: variables,
    content,
    businessId: nullableIdOf(source?.businessId, 'businessId'),
    featureId: nullableIdOf(source?.featureId, 'featureId'),
    useSystem: integerOrNullOf(source?.useSystem, 'useSystem'),
    onlySave,
    variableApi: safeEndpointOf(source?.variableApi, 'variableApi'),
    variableApiData: endpointOf(source?.variableApiData, 'variableApiData'),
    callbackApi: safeEndpointOf(source?.callbackApi, 'callbackApi'),
    callbackApiData: endpointOf(source?.callbackApiData, 'callbackApiData'),
    callbackApiForSignAfterApi: endpointOf(source?.callbackApiForSignAfterApi, 'callbackApiForSignAfterApi'),
    callbackApiForSignAfterApiData: endpointOf(source?.callbackApiForSignAfterApiData, 'callbackApiForSignAfterApiData'),
  }
  return { draft }
}

function draftDataListOf (value: unknown): ContractData[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('draft.dataList必须是数组')
  const seen = new Set<string>()
  return value.map((item, index) => {
    const row = objectOf(item, `draft.dataList[${index}]`)
    const contractKey = requiredTextOf(row.contractKey, `draft.dataList[${index}].contractKey`)
    const normalizedKey = contractKey.trim()
    if (seen.has(normalizedKey)) throw new Error(`draft.dataList存在重复contractKey：${normalizedKey}`)
    seen.add(normalizedKey)
    return { contractKey, contractValue: nullableTextOf(row.contractValue, `draft.dataList[${index}].contractValue`) }
  })
}

export function normalizeContractCreateDraft (value: unknown): ContractCreateDraft {
  const source = objectOf(value, 'draft')
  const name = requiredTextOf(source.name, 'draft.name')
  const templateId = idOf(source.templateId, 'draft.templateId')
  const typeId = idOf(source.typeId, 'draft.typeId')
  const organizationId = idOf(source.organizationId, 'draft.organizationId')
  const content = requiredTextOf(source.content, 'draft.content')
  assertContractContent(content)
  if (source.code !== null) throw new Error('draft.code必须为null')
  const onlySave = source.onlySave
  if (onlySave !== 0 && onlySave !== 1) throw new Error('draft.onlySave必须是0或1')
  const startDate = dateOf(source.startDate, 'draft.startDate')
  const endDate = dateOf(source.endDate, 'draft.endDate')
  return {
    name,
    templateId,
    typeId,
    code: null,
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    organizationId,
    dataList: draftDataListOf(source.dataList),
    content,
    businessId: nullableIdOf(source.businessId, 'draft.businessId'),
    featureId: nullableIdOf(source.featureId, 'draft.featureId'),
    useSystem: integerOrNullOf(source.useSystem, 'draft.useSystem'),
    onlySave,
    variableApi: safeEndpointOf(source.variableApi, 'draft.variableApi'),
    variableApiData: endpointOf(source.variableApiData, 'draft.variableApiData'),
    callbackApi: safeEndpointOf(source.callbackApi, 'draft.callbackApi'),
    callbackApiData: endpointOf(source.callbackApiData, 'draft.callbackApiData'),
    callbackApiForSignAfterApi: endpointOf(source.callbackApiForSignAfterApi, 'draft.callbackApiForSignAfterApi'),
    callbackApiForSignAfterApiData: endpointOf(source.callbackApiForSignAfterApiData, 'draft.callbackApiForSignAfterApiData'),
  }
}

function callbackDataOf (value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function createContractCreateCapability (request: PortalRequest): ContractCreateCapability {
  return {
    async templateOptions (input) {
      const typeId = idOf(input?.typeId, 'typeId')
      const useSystem = integerOrNullOf(input?.useSystem, 'useSystem')
      return arrayOf(await request({ url: `${TEMPLATE_ROOT}/getEnableContractTemplate`, method: 'get', params: { typeId, useSystem } }), '合同模板候选').map((item, index) => templateOf(item, `合同模板候选[${index}]`))
    },
    async template (input) {
      const id = idOf(input?.id, '合同模板ID')
      return templateOf(await request({ url: `${TEMPLATE_ROOT}/get`, method: 'get', params: { id } }), '合同模板详情')
    },
    async variables (input) {
      const variableApi = safeEndpointOf(input?.variableApi, 'variableApi')
      if (!variableApi) return []
      const variableApiData = endpointOf(input?.variableApiData, 'variableApiData')
      return variablesOf(await request({ url: variableApi, method: 'get', params: parseParamsOf(variableApiData) }))
    },
    prepare: prepareOf,
    async create (input) {
      return receiptOf(await request({ url: `${CONTRACT_ROOT}/createContractByCommon`, method: 'post', data: normalizeContractCreateDraft(input?.draft) }))
    },
    async callback (input) {
      const callbackApi = safeEndpointOf(input?.callbackApi, 'callbackApi')
      if (!callbackApi) return true
      const onlySave = input?.onlySave
      if (onlySave !== 0 && onlySave !== 1) throw new Error('onlySave必须是0或1')
      const receipt = receiptOf(input?.receipt)
      await request({ url: callbackApi, method: 'post', data: { ...callbackDataOf(input?.callbackApiData), ...receipt, onlySave } })
      return true
    },
  }
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const draftParams: ParamSpec[] = [
  p('name', 'text', true, '合同名称；Portal表单必填，保留用户原输入'),
  p('typeId', 'search', true, '合同类型分类树叶子ID；先选定候选，不要传名称或父节点'),
  p('organizationId', 'search', true, '所属组织ID；来自当前module-type=15可见组织候选'),
  p('contractTemplateId', 'search', true, '合同模板ID；必须先按typeId和useSystem读取启用模板候选'),
  p('content', 'text', true, '预览编辑后的合同content JSON字符串；需符合Portal/Java共同内容结构'),
  p('variables', 'text', false, '预览中用户填写的变量数组，每项name/value；提交时映射为contractKey/contractValue'),
  p('onlySave', 'enum', true, '1=仅保存草稿，0=创建并下载；Portal按钮明确传入，不可省略',),
  p('startDate', 'date', false, '合同生效日期；页面默认未设置时不发送'),
  p('endDate', 'date', false, '合同结束日期；页面默认未设置时不发送'),
  p('businessId', 'search', false, '业务来源ID；直接菜单创建默认为null'),
  p('featureId', 'search', false, '业务功能ID；直接菜单创建默认为null'),
  p('useSystem', 'number', false, '所属系统代码；直接菜单创建默认为null'),
  p('variableApi', 'text', false, 'Portal bridge传入的站内根相对变量接口；为空时不请求，禁止绝对地址、协议相对地址、反斜杠和编码绕过'),
  p('variableApiData', 'text', false, '变量接口JSON参数；非法JSON按Portal降级为空对象'),
  p('callbackApi', 'text', false, '创建后的站内根相对回调接口；省略或空字符串时跳过，禁止绝对地址、协议相对地址、反斜杠和编码绕过，直接菜单入口需显式传入'),
  p('callbackApiData', 'text', false, '创建后回调JSON参数；非法JSON按Portal降级为空对象'),
  p('callbackApiForSignAfterApi', 'text', false, '签署后回调接口配置原值'),
  p('callbackApiForSignAfterApiData', 'text', false, '签署后回调JSON参数配置原值'),
]

export const CONTRACT_CREATE_METHODS = {
  'contract-create-template-options': 'templateOptions',
  'contract-create-template': 'template',
  'contract-create-variables': 'variables',
  'contract-create-prepare': 'prepare',
  'contract-create': 'create',
  'contract-create-callback': 'callback',
} as const

export const contractCreateCapabilities: CapabilityDefinition[] = [
  { id: 'contract-create-template-options', title: '查询可用合同模板候选', write: false, params: [p('typeId', 'search', true, '已选合同类型叶子ID'), p('useSystem', 'number', false, '合同所属系统；Portal默认null表示不按系统过滤')] },
  { id: 'contract-create-template', title: '读取合同模板内容', write: false, params: [p('id', 'search', true, '已选合同模板ID')] },
  { id: 'contract-create-variables', title: '读取合同创建变量', write: false, params: [p('variableApi', 'text', false, 'Portal bridge传入的站内根相对变量接口；为空时页面不请求并返回空数组，禁止绝对地址、协议相对地址、反斜杠和编码绕过'), p('variableApiData', 'text', false, '变量接口JSON查询参数；非法JSON按Portal降级为空对象')] },
  { id: 'contract-create-prepare', title: '准备创建合同', write: false, params: draftParams },
  { id: 'contract-create', title: '提交创建合同', write: true, params: [p('draft', 'text', true, 'contract-create-prepare返回的完整草稿；不能手工删掉code、onlySave或回调配置')] },
  { id: 'contract-create-callback', title: '发送合同创建回调', write: true, params: [p('receipt', 'text', true, 'contract-create返回的创建回执'), p('onlySave', 'enum', true, '与创建请求相同的0/1保存模式'), p('callbackApi', 'text', false, 'Portal bridge传入的站内根相对回调接口；省略或空值跳过，禁止绝对地址、协议相对地址、反斜杠和编码绕过，直接菜单入口需显式传入'), p('callbackApiData', 'text', false, 'Portal bridge回调JSON对象；非法JSON按页面降级为空对象')] },
].map(definition => ({
  ...definition,
  pagePath: CONTRACT_CREATE_PAGE_PATH,
  permission: CONTRACT_CREATE_PERMISSION,
  moduleType: CONTRACT_CREATE_MODULE_TYPE,
  httpInstance: 'platform',
}))
