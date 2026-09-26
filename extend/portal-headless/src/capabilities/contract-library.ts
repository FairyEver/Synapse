import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 风控管理 → 合同库」列表、详情及其可达操作。 */
export const CONTRACT_LIBRARY_PAGE_PATH = '/dashboard/contract/library/list'
export const CONTRACT_LIBRARY_PERMISSION = '/dashboard/contract/library'
export const CONTRACT_LIBRARY_MODULE_TYPE = 15

const ROOT = '/admin-api/hr/contract'
const DEFAULT_PAGE_SIZE = 20

export const CONTRACT_STATUS = {
  DRAFT: 1,
  PENDING_REVIEW: 2,
  REVIEW_REJECTED: 3,
  PENDING_SIGN: 4,
  SIGNED_COMPLETED: 5,
  ESTABLISHED_INACTIVE: 6,
  ESTABLISHED_ACTIVE: 7,
  NORMAL_PERFORMANCE: 8,
  PARTIAL_PERFORMANCE: 9,
  PERFORMANCE_DISPUTE: 10,
  MODIFIED_PERFORMANCE: 11,
  NORMAL_TERMINATION: 12,
  AGREEMENT_TERMINATION: 13,
  UNILATERAL_TERMINATION: 14,
  OTHER_TERMINATION: 15,
  INVALID: 16,
} as const

export type ContractId = string | number
export type ContractStatus = (typeof CONTRACT_STATUS)[keyof typeof CONTRACT_STATUS]

export type ContractQuery = {
  name?: string | null
  typeId?: ContractId | null
  signDate?: string | null
  startDate?: string | null
  endDate?: string | null
  status?: ContractStatus | null
  pageNo?: number
  pageSize?: number
}

export type ContractData = {
  contractKey: string
  contractValue: string | null
}

export type ContractRow = Record<string, unknown> & {
  id: ContractId
  name: string | null
  templateId: ContractId | null
  typeId: ContractId | null
  typeName: string | null
  code: string | null
  startDate: string | null
  endDate: string | null
  signDate: string | null
  organizationId: ContractId | null
  organizationName: string | null
  updateName: string | null
  creatorName: string | null
  createTime: string | null
  updateTime: string | null
  status: number | null
  isReplenishment: number | null
  isSignCertificate: number | null
  isVoid: number | null
  useSystem: number | null
  content: string | null
  dataList: ContractData[]
  contractVersionId: ContractId | null
  variableApi: string | null
  variableApiData: string | null
  callbackApi: string | null
  callbackApiData: string | null
  callbackApiForSignAfterApi: string | null
  callbackApiForSignAfterApiData: string | null
}

export type ContractRecord = Record<string, unknown> & {
  id: ContractId
  operateTime: string | null
  contractId: ContractId
  operateType: number | null
  preUrl: string | null
  nextUrl: string | null
  preUrlName: string | null
  nextUrlName: string | null
  preImg: string | null
  nextImg: string | null
  preImgName: string | null
  nextImgName: string | null
  operator: ContractId | null
  operatorName: string | null
}

export type ContractFile = { url: string; name: string }

export type ContractReplenishment = {
  url: string | null
  name: string | null
}

export type ContractReplenishmentDraft = {
  contractId: ContractId
  nextUrl: string
  nextUrlName: string
}

export type ContractReplenishmentPreparation = {
  draft: ContractReplenishmentDraft
  previous: ContractFile[]
}

export type ContractSignCertificate = {
  signDate: string | null
  startDate: string | null
  endDate: string | null
  imgUrl: string | null
  imgName: string | null
}

export type ContractSignCertificateDraft = {
  contractId: ContractId
  nextImg: string
  nextImgName: string
  signDate: string
  startDate: string
  endDate: string
}

export type ContractSignCertificatePreparation = {
  draft: ContractSignCertificateDraft
  previous: ContractFile[]
}

export type ContractUpdateDraft = {
  id: ContractId
  name: string
  templateId: ContractId
  typeId: ContractId
  startDate: string | null
  endDate: string | null
  organizationId: ContractId
  dataList: ContractData[]
  content: string
  businessId: ContractId | null
  featureId: ContractId | null
  useSystem: number | null
  variableApi: string | null
  variableApiData: string | null
  callbackApi: string | null
  callbackApiData: string | null
  callbackApiForSignAfterApi: string | null
  callbackApiForSignAfterApiData: string | null
}

export type ContractUpdatePreparation = {
  draft: ContractUpdateDraft
  previous: ContractUpdateDraft
}

/** `updateContractByCommon` 只返回写入回执，不返回完整合同详情。 */
export type ContractUpdateReceipt = {
  id: ContractId
  code: string | null
  contractVersionId: ContractId | null
  onlySave: number | null
}

export type ContractVoidDraft = {
  id: ContractId
  status: ContractStatus
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): ContractId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
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

function dateOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function integerOrNullOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function statusOf (value: unknown): ContractStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 16) throw new Error('合同status必须是1至16的整数')
  return value as ContractStatus
}

function contractDataListOf (value: unknown, label: string): ContractData[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  const keys = new Set<string>()
  return value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    const key = requiredTextOf(row.contractKey, `${label}[${index}].contractKey`)
    const normalizedKey = key.trim()
    if (keys.has(normalizedKey)) throw new Error(`${label}存在重复contractKey：${normalizedKey}`)
    keys.add(normalizedKey)
    const contractValue = nullableTextOf(row.contractValue, `${label}[${index}].contractValue`)
    return { contractKey: key, contractValue }
  })
}

/**
 * 合同预览页提交前的共同内容校验。
 *
 * Portal 的 `validateTemplateConfig` 还会校验每一种可视组件的深层字段；这些组件规则由
 * Portal 与 Java `ContractContentValidator` 共同维护，SDK 不复制一份会漂移的渲染器。
 * 这里锁定两边都无条件要求的根结构、组件身份、唯一性和结构组件位置，剩余错误如实交给后端。
 */
export function assertContractContent (value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('合同content必须是非空JSON字符串')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('合同content必须是合法JSON字符串')
  }
  const root = objectOf(parsed, '合同content根节点')
  if (typeof root.version !== 'string' || root.version.trim() === '') throw new Error('合同content.version必须是非空字符串')
  if (!Array.isArray(root.blocks)) throw new Error('合同content.blocks必须是数组')
  const ids = new Set<string>()
  let coverIndex = -1
  let directoryIndex = -1
  root.blocks.forEach((item, index) => {
    const block = objectOf(item, `合同content.blocks[${index}]`)
    const id = requiredTextOf(block.id, `合同content.blocks[${index}].id`).trim()
    if (ids.has(id)) throw new Error(`合同content存在重复block id：${id}`)
    ids.add(id)
    const name = requiredTextOf(block.name, `合同content.blocks[${index}].name`)
    objectOf(block.data, `合同content.blocks[${index}].data`)
    if (name === 'Contract/Cover') {
      if (coverIndex >= 0) throw new Error('合同content仅允许一个合同封面')
      coverIndex = index
    }
    if (name === 'Contract/AutoDirectory') {
      if (directoryIndex >= 0) throw new Error('合同content仅允许一个自动目录')
      directoryIndex = index
    }
    if (['Contract/Cover', 'Contract/AutoDirectory', 'Contract/SigningInfo'].includes(name) && root.version !== '1.1.0') {
      throw new Error(`${name}仅支持合同content.version=1.1.0`)
    }
  })
  if (coverIndex > 0) throw new Error('合同封面必须位于合同content.blocks首位')
  const expectedDirectoryIndex = coverIndex === 0 ? 1 : 0
  if (directoryIndex >= 0 && directoryIndex !== expectedDirectoryIndex) throw new Error('自动目录必须位于合同封面之后或blocks首位')
}

function dataListPayloadOf (value: unknown, label: string): ContractData[] {
  return contractDataListOf(value, label).map(item => ({ contractKey: item.contractKey, contractValue: item.contractValue }))
}

function contractRowOf (value: unknown, label = '合同'): ContractRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: nullableTextOf(row.name, `${label}.name`),
    templateId: nullableIdOf(row.templateId, `${label}.templateId`),
    typeId: nullableIdOf(row.typeId, `${label}.typeId`),
    typeName: nullableTextOf(row.typeName, `${label}.typeName`),
    code: nullableTextOf(row.code, `${label}.code`),
    startDate: dateOf(row.startDate, `${label}.startDate`),
    endDate: dateOf(row.endDate, `${label}.endDate`),
    signDate: dateOf(row.signDate, `${label}.signDate`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    updateName: nullableTextOf(row.updateName, `${label}.updateName`),
    creatorName: nullableTextOf(row.creatorName, `${label}.creatorName`),
    createTime: nullableTextOf(row.createTime, `${label}.createTime`),
    updateTime: nullableTextOf(row.updateTime, `${label}.updateTime`),
    status: integerOrNullOf(row.status, `${label}.status`),
    isReplenishment: integerOrNullOf(row.isReplenishment, `${label}.isReplenishment`),
    isSignCertificate: integerOrNullOf(row.isSignCertificate, `${label}.isSignCertificate`),
    isVoid: integerOrNullOf(row.isVoid, `${label}.isVoid`),
    useSystem: integerOrNullOf(row.useSystem, `${label}.useSystem`),
    content: nullableTextOf(row.content, `${label}.content`),
    dataList: contractDataListOf(row.dataList, `${label}.dataList`),
    contractVersionId: nullableIdOf(row.contractVersionId, `${label}.contractVersionId`),
    variableApi: nullableTextOf(row.variableApi, `${label}.variableApi`),
    variableApiData: nullableTextOf(row.variableApiData, `${label}.variableApiData`),
    callbackApi: nullableTextOf(row.callbackApi, `${label}.callbackApi`),
    callbackApiData: nullableTextOf(row.callbackApiData, `${label}.callbackApiData`),
    callbackApiForSignAfterApi: nullableTextOf(row.callbackApiForSignAfterApi, `${label}.callbackApiForSignAfterApi`),
    callbackApiForSignAfterApiData: nullableTextOf(row.callbackApiForSignAfterApiData, `${label}.callbackApiForSignAfterApiData`),
  }
}

function pageOf<T> (value: unknown, label: string, rowOf: (item: unknown, itemLabel: string) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}[${index}]`)), total: page.total as number }
}

function csvOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') throw new Error(`${label}必须为逗号字符串或空值`)
  return value.split(',').filter(item => item !== '')
}

function filesOf (url: unknown, name: unknown, label: string): ContractFile[] {
  const urls = csvOf(url, `${label}.url`)
  const names = csvOf(name, `${label}.name`)
  return urls.map((item, index) => ({ url: item, name: names[index] ?? '' }))
}

function fileInputOf (value: unknown, label: string, required = false): ContractFile[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`)
    return []
  }
  if (!Array.isArray(value)) throw new Error(`${label}必须是文件数组`)
  const files = value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    return {
      url: requiredTextOf(row.url, `${label}[${index}].url`),
      name: requiredTextOf(row.name, `${label}[${index}].name`),
    }
  })
  if (required && files.length === 0) throw new Error(`${label}不能为空`)
  return files
}

function replenishmentOf (value: unknown): ContractReplenishment {
  const row = objectOf(value, '补充协议响应')
  return {
    url: nullableTextOf(row.url, '补充协议.url'),
    name: nullableTextOf(row.name, '补充协议.name'),
  }
}

function signCertificateOf (value: unknown): ContractSignCertificate {
  const row = objectOf(value, '签订证明响应')
  return {
    signDate: dateOf(row.signDate, '签订证明.signDate'),
    startDate: dateOf(row.startDate, '签订证明.startDate'),
    endDate: dateOf(row.endDate, '签订证明.endDate'),
    imgUrl: nullableTextOf(row.imgUrl, '签订证明.imgUrl'),
    imgName: nullableTextOf(row.imgName, '签订证明.imgName'),
  }
}

function recordOf (value: unknown, label: string): ContractRecord {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    operateTime: nullableTextOf(row.operateTime, `${label}.operateTime`),
    contractId: idOf(row.contractId, `${label}.contractId`),
    operateType: integerOrNullOf(row.operateType, `${label}.operateType`),
    preUrl: nullableTextOf(row.preUrl, `${label}.preUrl`),
    nextUrl: nullableTextOf(row.nextUrl, `${label}.nextUrl`),
    preUrlName: nullableTextOf(row.preUrlName, `${label}.preUrlName`),
    nextUrlName: nullableTextOf(row.nextUrlName, `${label}.nextUrlName`),
    preImg: nullableTextOf(row.preImg, `${label}.preImg`),
    nextImg: nullableTextOf(row.nextImg, `${label}.nextImg`),
    preImgName: nullableTextOf(row.preImgName, `${label}.preImgName`),
    nextImgName: nullableTextOf(row.nextImgName, `${label}.nextImgName`),
    operator: nullableIdOf(row.operator, `${label}.operator`),
    operatorName: nullableTextOf(row.operatorName, `${label}.operatorName`),
  }
}

function listParamsOf (query: ContractQuery = {}) {
  return {
    order: '',
    orderField: '',
    name: nullableTextOf(query.name, 'name'),
    typeId: nullableIdOf(query.typeId, 'typeId'),
    startDate: dateOf(query.startDate, 'startDate'),
    endDate: dateOf(query.endDate, 'endDate'),
    signDate: dateOf(query.signDate, 'signDate'),
    status: statusOf(query.status),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

function updateDraftOf (value: unknown, label: string, requireId = true): ContractUpdateDraft {
  const input = objectOf(value, label)
  const id = nullableIdOf(input.id, `${label}.id`)
  if (requireId && id === null) throw new Error(`${label}.id不能为空`)
  const templateId = idOf(input.templateId, `${label}.templateId`)
  const typeId = idOf(input.typeId, `${label}.typeId`)
  const organizationId = idOf(input.organizationId, `${label}.organizationId`)
  const content = input.content
  assertContractContent(content)
  return {
    id: id!,
    name: requiredTextOf(input.name, `${label}.name`),
    templateId,
    typeId,
    startDate: dateOf(input.startDate, `${label}.startDate`),
    endDate: dateOf(input.endDate, `${label}.endDate`),
    organizationId,
    dataList: dataListPayloadOf(input.dataList, `${label}.dataList`),
    content,
    businessId: nullableIdOf(input.businessId, `${label}.businessId`),
    featureId: nullableIdOf(input.featureId, `${label}.featureId`),
    useSystem: integerOrNullOf(input.useSystem, `${label}.useSystem`),
    variableApi: nullableTextOf(input.variableApi, `${label}.variableApi`),
    variableApiData: nullableTextOf(input.variableApiData, `${label}.variableApiData`),
    callbackApi: nullableTextOf(input.callbackApi, `${label}.callbackApi`),
    callbackApiData: nullableTextOf(input.callbackApiData, `${label}.callbackApiData`),
    callbackApiForSignAfterApi: nullableTextOf(input.callbackApiForSignAfterApi, `${label}.callbackApiForSignAfterApi`),
    callbackApiForSignAfterApiData: nullableTextOf(input.callbackApiForSignAfterApiData, `${label}.callbackApiForSignAfterApiData`),
  }
}

function updatePayloadOf (value: unknown): Record<string, unknown> {
  const draft = updateDraftOf(value, 'draft')
  return {
    id: draft.id,
    name: draft.name,
    templateId: draft.templateId,
    typeId: draft.typeId,
    code: null,
    startDate: draft.startDate,
    endDate: draft.endDate,
    organizationId: draft.organizationId,
    dataList: draft.dataList,
    content: draft.content,
    businessId: draft.businessId,
    featureId: draft.featureId,
    useSystem: draft.useSystem,
    onlySave: 0,
    variableApi: draft.variableApi,
    variableApiData: draft.variableApiData,
    callbackApi: draft.callbackApi,
    callbackApiData: draft.callbackApiData,
    callbackApiForSignAfterApi: draft.callbackApiForSignAfterApi,
    callbackApiForSignAfterApiData: draft.callbackApiForSignAfterApiData,
  }
}

function updateReceiptOf (value: unknown): ContractUpdateReceipt {
  const row = objectOf(value, '修改合同回执')
  return {
    id: idOf(row.id, '修改合同回执.id'),
    code: nullableTextOf(row.code, '修改合同回执.code'),
    contractVersionId: nullableIdOf(row.contractVersionId, '修改合同回执.contractVersionId'),
    onlySave: integerOrNullOf(row.onlySave, '修改合同回执.onlySave'),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function filesPayloadOf (value: unknown, label: string, allowEmpty = true): { urls: string; names: string; files: ContractFile[] } {
  const files = fileInputOf(value, label, !allowEmpty)
  return { urls: files.map(item => item.url).join(','), names: files.map(item => item.name).join(','), files }
}

export function createContractLibraryCapability (request: PortalRequest) {
  const get = async (id: ContractId): Promise<ContractRow> => contractRowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(id, '合同ID') } }), '合同详情')
  return {
    async list (query: ContractQuery = {}): Promise<PageResult<ContractRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }), '合同分页响应', contractRowOf)
    },
    get (input: { id: ContractId }): Promise<ContractRow> {
      return get(idOf(input?.id, '合同ID'))
    },
    async download (input: { id: ContractId }) {
      const row = await get(idOf(input?.id, '合同ID'))
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        isSignCertificate: row.isSignCertificate,
        content: row.content,
        dataList: row.dataList,
      }
    },
    async records (input: { contractId: ContractId; pageNo?: number; pageSize?: number }): Promise<PageResult<ContractRecord>> {
      const contractId = idOf(input?.contractId, '合同ID')
      return pageOf(await request({
        url: `${ROOT}/getContractOperate`,
        method: 'get',
        params: { contractId, pageNo: pageNumberOf(input?.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input?.pageSize, DEFAULT_PAGE_SIZE, 'pageSize') },
      }), '合同操作记录分页响应', recordOf)
    },
    async getReplenishment (input: { id: ContractId }): Promise<ContractReplenishment> {
      return replenishmentOf(await request({ url: `${ROOT}/replenishmentInfo`, method: 'get', params: { id: idOf(input?.id, '合同ID') } }))
    },
    prepareReplenishment (input: { contractId: ContractId; current?: ContractReplenishment | null; files: ContractFile[]; isSignCertificate?: boolean }): ContractReplenishmentPreparation {
      const contractId = idOf(input?.contractId, '合同ID')
      const previous = filesOf(input?.current?.url, input?.current?.name, '当前补充协议')
      const next = filesPayloadOf(input?.files, '补充协议文件', true)
      if (input?.isSignCertificate && previous.some(file => !next.files.some(nextFile => nextFile.url === file.url))) {
        throw new Error('已签订合同的既有补充协议不可删除')
      }
      return { draft: { contractId, nextUrl: next.urls, nextUrlName: next.names }, previous }
    },
    async saveReplenishment (input: { draft: ContractReplenishmentDraft }): Promise<true> {
      const draft = objectOf(input?.draft, '补充协议draft')
      const contractId = idOf(draft.contractId, '补充协议draft.contractId')
      const nextUrl = nullableTextOf(draft.nextUrl, '补充协议draft.nextUrl') ?? ''
      const nextUrlName = nullableTextOf(draft.nextUrlName, '补充协议draft.nextUrlName') ?? ''
      return trueOf(await request({ url: `${ROOT}/saveReplenishment`, method: 'post', data: { contractId, nextUrl, nextUrlName } }), '保存补充协议')
    },
    async getSignCertificate (input: { id: ContractId }): Promise<ContractSignCertificate> {
      return signCertificateOf(await request({ url: `${ROOT}/signCertificateInfo`, method: 'get', params: { id: idOf(input?.id, '合同ID') } }))
    },
    prepareSignCertificate (input: { contractId: ContractId; current?: ContractSignCertificate | null; files: ContractFile[]; signDate: string; startDate: string; endDate: string; isSignCertificate?: boolean }): ContractSignCertificatePreparation {
      const contractId = idOf(input?.contractId, '合同ID')
      if (input?.isSignCertificate) throw new Error('Portal 已有签订证明时表单只读，不能再次提交')
      const files = filesPayloadOf(input?.files, '签订证明文件', false)
      const previous = filesOf(input?.current?.imgUrl, input?.current?.imgName, '当前签订证明')
      return {
        draft: {
          contractId,
          nextImg: files.urls,
          nextImgName: files.names,
          signDate: dateOf(input?.signDate, '签订证明.signDate', true)!,
          startDate: dateOf(input?.startDate, '签订证明.startDate', true)!,
          endDate: dateOf(input?.endDate, '签订证明.endDate', true)!,
        },
        previous,
      }
    },
    async saveSignCertificate (input: { draft: ContractSignCertificateDraft }): Promise<true> {
      const draft = objectOf(input?.draft, '签订证明draft')
      const contractId = idOf(draft.contractId, '签订证明draft.contractId')
      const nextImg = requiredTextOf(draft.nextImg, '签订证明draft.nextImg')
      const nextImgName = requiredTextOf(draft.nextImgName, '签订证明draft.nextImgName')
      const signDate = dateOf(draft.signDate, '签订证明draft.signDate', true)!
      const startDate = dateOf(draft.startDate, '签订证明draft.startDate', true)!
      const endDate = dateOf(draft.endDate, '签订证明draft.endDate', true)!
      return trueOf(await request({ url: `${ROOT}/saveSignCertificate`, method: 'post', data: { contractId, nextImg, nextImgName, signDate, startDate, endDate } }), '保存签订证明')
    },
    prepareUpdate (input: { current: ContractRow; changes?: Partial<ContractUpdateDraft> & { contractTemplateId?: ContractId | null } | null }): ContractUpdatePreparation {
      const current = contractRowOf(input?.current, 'current合同')
      const changes = { ...(input?.changes ?? {}) } as Record<string, unknown>
      const templateId = changes.contractTemplateId !== undefined ? changes.contractTemplateId : changes.templateId ?? current.templateId
      delete changes.contractTemplateId
      const previous = updateDraftOf({ ...current, id: current.id, templateId: current.templateId }, 'previous合同')
      const draft = updateDraftOf({ ...previous, ...changes, id: current.id, templateId }, 'draft合同')
      return { draft, previous }
    },
    async update (input: { draft: ContractUpdateDraft }): Promise<ContractUpdateReceipt> {
      const result = await request({ url: `${ROOT}/updateContractByCommon`, method: 'post', data: updatePayloadOf(input?.draft) })
      return updateReceiptOf(result)
    },
    prepareVoid (input: { id: ContractId; status: number }): { draft: ContractVoidDraft } {
      const id = idOf(input?.id, '合同ID')
      const status = statusOf(input?.status)
      if (status === null) throw new Error('作废前必须提供当前合同status')
      if (status === CONTRACT_STATUS.DRAFT || status === CONTRACT_STATUS.REVIEW_REJECTED) throw new Error('Portal 当前状态不显示作废动作')
      return { draft: { id, status } }
    },
    async void (input: { draft: ContractVoidDraft }): Promise<true> {
      const draft = objectOf(input?.draft, '作废draft')
      const id = idOf(draft.id, '作废draft.id')
      const status = statusOf(draft.status)
      if (status === CONTRACT_STATUS.DRAFT || status === CONTRACT_STATUS.REVIEW_REJECTED) throw new Error('Portal 当前状态不允许作废')
      if (status === null) throw new Error('作废draft.status不能为空')
      return trueOf(await request({ url: `${ROOT}/voidContract/${id}`, method: 'post', data: { params: { id } } }), '作废合同')
    },
  }
}

export type ContractLibraryCapability = ReturnType<typeof createContractLibraryCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const CONTRACT_LIBRARY_METHODS = {
  'contract-library-list': 'list',
  'contract-library-get': 'get',
  'contract-library-download': 'download',
  'contract-library-records': 'records',
  'contract-library-get-replenishment': 'getReplenishment',
  'contract-library-prepare-replenishment': 'prepareReplenishment',
  'contract-library-save-replenishment': 'saveReplenishment',
  'contract-library-get-sign-certificate': 'getSignCertificate',
  'contract-library-prepare-sign-certificate': 'prepareSignCertificate',
  'contract-library-save-sign-certificate': 'saveSignCertificate',
  'contract-library-prepare-update': 'prepareUpdate',
  'contract-library-update': 'update',
  'contract-library-prepare-void': 'prepareVoid',
  'contract-library-void': 'void',
} as const

export const contractLibraryCapabilities: CapabilityDefinition[] = [
  { id: 'contract-library-list', title: '查询合同库列表', write: false, params: [p('name', 'text', false, '合同名称筛选；默认null'), p('typeId', 'tree', false, '合同类型分类节点ID；默认null'), p('signDate', 'date', false, '签订日期YYYY-MM-DD；默认null'), p('startDate', 'date', false, '生效日期YYYY-MM-DD；默认null'), p('endDate', 'date', false, '终止日期YYYY-MM-DD；默认null'), p('status', 'enum', false, '合同状态1至16；默认null'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'contract-library-get', title: '读取合同详情', write: false, params: [p('id', 'number', true, '合同ID')] },
  { id: 'contract-library-download', title: '准备合同下载数据', write: false, params: [p('id', 'number', true, '合同ID')] },
  { id: 'contract-library-records', title: '查询合同操作记录', write: false, params: [p('contractId', 'number', true, '合同ID'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'contract-library-get-replenishment', title: '读取合同补充协议', write: false, params: [p('id', 'number', true, '合同ID')] },
  { id: 'contract-library-prepare-replenishment', title: '准备合同补充协议', write: false, params: [p('contractId', 'number', true, '合同ID'), p('current', 'text', false, 'getReplenishment返回的当前协议'), p('files', 'text', true, '最终保留的PDF文件数组'), p('isSignCertificate', 'boolean', false, '是否已有签订证明；已有协议不可删除')] },
  { id: 'contract-library-save-replenishment', title: '保存合同补充协议', write: true, params: [p('draft', 'text', true, 'prepareReplenishment返回的完整草稿')] },
  { id: 'contract-library-get-sign-certificate', title: '读取合同签订证明', write: false, params: [p('id', 'number', true, '合同ID')] },
  { id: 'contract-library-prepare-sign-certificate', title: '准备合同签订证明', write: false, params: [p('contractId', 'number', true, '合同ID'), p('files', 'text', true, '至少一个已上传文件'), p('signDate', 'date', true, '签订日期YYYY-MM-DD'), p('startDate', 'date', true, '生效日期YYYY-MM-DD'), p('endDate', 'date', true, '终止日期YYYY-MM-DD'), p('isSignCertificate', 'boolean', false, '已有证明时页面只读')] },
  { id: 'contract-library-save-sign-certificate', title: '保存合同签订证明', write: true, params: [p('draft', 'text', true, 'prepareSignCertificate返回的完整草稿')] },
  { id: 'contract-library-prepare-update', title: '准备模拟修改合同', write: false, params: [p('current', 'text', true, 'get返回的最新合同详情'), p('changes', 'text', false, '用户明确修改的合同表单与内容')] },
  { id: 'contract-library-update', title: '模拟修改合同', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整草稿；onlySave固定为0')] },
  { id: 'contract-library-prepare-void', title: '准备作废合同', write: false, params: [p('id', 'number', true, '合同ID'), p('status', 'number', true, '当前列表状态；1草稿和3审核驳回不显示作废')] },
  { id: 'contract-library-void', title: '作废合同', write: true, params: [p('draft', 'text', true, 'prepareVoid返回的确认草稿')] },
].map(definition => ({ ...definition, pagePath: CONTRACT_LIBRARY_PAGE_PATH, permission: CONTRACT_LIBRARY_PERMISSION, moduleType: CONTRACT_LIBRARY_MODULE_TYPE, httpInstance: 'platform' }))
