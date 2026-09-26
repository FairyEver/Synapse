import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「薪酬管理 → 薪资核算」。列表、三步核算向导和核算详情共用这个页面权限。 */
export const SALARY_ACCOUNTING_PAGE_PATH = '/dashboard/salary/salary-accounting/list'
export const SALARY_ACCOUNTING_PERMISSION = '/dashboard/salary/salary-accounting'
export const SALARY_ACCOUNTING_MODULE_TYPE = 14

const ROOT = '/salary/document'
const LEDGER_ITEM_PAGE_URL = '/salary/ledgerItem/page'
const DETAIL_TEMPORARY_ROOT = '/salary/salaryDocumentDetailTemporary'
const STAFF_LIST_URL = '/org/staff/getStaffPageByOrgWithEligibility'
const ORGANIZATION_TREE_URL = '/org/organization/getTree'
const HISTORY_USER_URL = '/salary/salaryhistoryuser/getHistoryUser'

export type SalaryAccountingId = string | number
export type SalaryAccountingStatus = 0 | 1
export type SalaryAccountingStep = 1 | 2 | 3 | 4
export type SalaryAccountingGrantStatus = 0 | 1
export type SalaryAccountingMatchType = 1 | 2

export type SalaryAccountingQuery = {
  salaryMonth?: string | null
  status?: SalaryAccountingStatus | null
  operatorId?: SalaryAccountingId | null
  name?: string | null
  ledgerId?: SalaryAccountingId | null
  organizationId?: SalaryAccountingId | null
  personCount?: string | number | null
  creatorName?: string | null
  createDate?: string | null
  operateDate?: string | null
  salaryTaxBand?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type SalaryAccountingDocument = Record<string, unknown> & {
  id?: SalaryAccountingId | null
  name?: string | null
  organizationId?: SalaryAccountingId | null
  ledgerId?: SalaryAccountingId | null
  salaryMonth?: string | null
  costMonth?: string | null
  personCount?: number | null
  unissuedCount?: number | null
  payableTotal?: number | string | null
  deductionTotal?: number | string | null
  actualTotal?: number | string | null
  salaryTaxBand?: string | number | null
  status?: SalaryAccountingStatus | null
  step?: SalaryAccountingStep | null
  creator?: SalaryAccountingId | null
  creatorName?: string | null
  operator?: SalaryAccountingId | null
  operatorName?: string | null
  createTime?: string | null
  operateTime?: string | null
}

export type SalaryAccountingCreateDraft = {
  organizationId: SalaryAccountingId
  ledgerId: SalaryAccountingId
  salaryMonth: string
  costMonth: string
  name?: string | null
}

export type SalaryAccountingStaff = Record<string, unknown> & {
  id?: SalaryAccountingId | null
  name?: string | null
  staffCode: string | number
  status?: number | null
}

export type SalaryAccountingStaffQuery = {
  documentId: SalaryAccountingId
  staffName?: string | null
  staffCode?: string | number | null
  orgId?: SalaryAccountingId | null
  postName?: string | null
  pageNo?: number
  /** Portal 的“全选”分支用 loopFetch 以 pageSize=500、最多100页拉取；SDK单次调用使用同一分页参数。 */
  pageSize?: number
}

export type SalaryAccountingEligibilityResult = {
  processedIds: SalaryAccountingId[]
  processedStaffCodes: Array<string | number>
  processedCount: number
  eligibleStaffIds: SalaryAccountingId[]
  eligibleStaffCodes: Array<string | number>
  excludedStaffList: Record<string, unknown>[]
}

export type SalaryAccountingSelectionDraft = {
  documentId: SalaryAccountingId
  staffList: SalaryAccountingStaff[]
}

export type SalaryAccountingDocumentUserQuery = {
  documentId: SalaryAccountingId
  status?: SalaryAccountingGrantStatus | null
  name?: string | null
  staffCode?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type SalaryAccountingDocumentUser = Record<string, unknown> & {
  id?: SalaryAccountingId | null
  name?: string | null
  staffCode?: string | number | null
  status?: SalaryAccountingGrantStatus | null
  grantTime?: string | null
  costCenter?: string | null
  legalPerson?: string | null
  needPaySalary?: number | string | null
  realPaySalary?: number | string | null
}

export type SalaryAccountingPayInput = {
  documentId: SalaryAccountingId
  idList: SalaryAccountingId[]
  grantTime: string
  documentStatus: SalaryAccountingStatus
  currentStatuses: SalaryAccountingGrantStatus[]
}

export type SalaryAccountingCheckoutInput = {
  ids: SalaryAccountingId[]
  status: SalaryAccountingStatus
  currentStatuses: SalaryAccountingStatus[]
}

export type SalaryAccountingCancelCheckoutInput = {
  ids: SalaryAccountingId[]
  currentStatuses: SalaryAccountingStatus[]
}

export type SalaryAccountingSplitInput = {
  documentIds: SalaryAccountingId[]
  name: string
  staffCodeList: Array<string | number>
  currentStatuses: SalaryAccountingStatus[]
  currentSteps: Array<SalaryAccountingStep | number>
}

export type SalaryAccountingFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type SalaryAccountingFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type SalaryAccountingTemporaryDetail = Record<string, unknown> & {
  id?: SalaryAccountingId | null
  documentId?: SalaryAccountingId | null
  itemId?: SalaryAccountingId | null
  itemName?: string | null
  staffCode?: string | number | null
  staffName?: string | null
  value?: number | string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryAccountingId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryAccountingId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  const text = textOf(value, label)
  if (!text.trim()) throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && text.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return text
}

function monthOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function dateOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function enumOf<T extends number> (value: unknown, values: readonly T[], label: string): T {
  if (!Number.isSafeInteger(value) || !values.includes(value as T)) throw new Error(`${label}必须是${values.join('、')}`)
  return value as T
}

function optionalEnumOf<T extends number> (value: unknown, values: readonly T[], label: string): T | null {
  if (value === undefined || value === null || value === '') return null
  return enumOf(value, values, label)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error(`${label}必须是10、20、50、100、200或500`)
  return resolved
}

function pageOf<T> (value: unknown, label: string): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list as T[], total: page.total }
}

function arrayOf<T> (value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value as T[]
}

function statusOf (value: unknown, label: string): SalaryAccountingStatus {
  return enumOf(value, [0, 1] as const, label)
}

function idListOf (value: unknown, label: string): SalaryAccountingId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function staffCodeOf (value: unknown, label: string, required = false): string | number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为员工工号文本或非负整数`)
    return value
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为员工工号文本或非负整数`)
  return value
}

function listParamsOf (query: SalaryAccountingQuery = {}): JsonObject {
  const status = optionalEnumOf(query.status, [0, 1] as const, 'status')
  return {
    order: '',
    orderField: '',
    salaryMonth: monthOf(query.salaryMonth, 'salaryMonth') ?? '',
    status: status ?? '',
    operatorId: optionalIdOf(query.operatorId, 'operatorId') ?? '',
    name: textOf(query.name, 'name'),
    ledgerId: optionalIdOf(query.ledgerId, 'ledgerId') ?? '',
    organizationId: optionalIdOf(query.organizationId, 'organizationId') ?? '',
    personCount: query.personCount === undefined || query.personCount === null ? '' : String(query.personCount),
    creatorName: textOf(query.creatorName, 'creatorName'),
    createDate: dateOf(query.createDate, 'createDate') ?? '',
    operateDate: dateOf(query.operateDate, 'operateDate') ?? '',
    salaryTaxBand: query.salaryTaxBand === undefined || query.salaryTaxBand === null ? '' : String(query.salaryTaxBand),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createPayload (input: SalaryAccountingCreateDraft): JsonObject {
  const value = objectOf(input, '薪资核算第一步表单')
  return {
    organizationId: idOf(value.organizationId, 'organizationId'),
    ledgerId: idOf(value.ledgerId, 'ledgerId'),
    salaryMonth: monthOf(value.salaryMonth, 'salaryMonth', true),
    costMonth: monthOf(value.costMonth, 'costMonth', true),
    name: textOf(value.name, 'name'),
  }
}

function staffListOf (value: unknown): SalaryAccountingStaff[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('staffList必须为非空数组')
  const seen = new Set<string>()
  return value.map((item, index) => {
    const row = objectOf(item, `staffList[${index}]`)
    const staffCode = staffCodeOf(row.staffCode, `staffList[${index}].staffCode`, true)!
    const key = String(staffCode)
    if (seen.has(key)) throw new Error('staffList不能包含重复staffCode')
    seen.add(key)
    const result: SalaryAccountingStaff = { ...row, staffCode }
    if (row.id !== undefined && row.id !== null && row.id !== '') result.id = idOf(row.id, `staffList[${index}].id`)
    if (row.name !== undefined && row.name !== null) result.name = textOf(row.name, `staffList[${index}].name`)
    if (row.status !== undefined && row.status !== null && row.status !== '') result.status = Number(row.status)
    return result
  })
}

function selectionPayloadOf (input: SalaryAccountingSelectionDraft): { documentId: SalaryAccountingId; staffList: JsonObject[] } {
  const value = objectOf(input, '薪资核算人员名单')
  const documentId = idOf(value.documentId, 'documentId')
  const staffList = staffListOf(value.staffList).map(item => {
    const row: JsonObject = { staffCode: item.staffCode }
    if (item.id !== undefined && item.id !== null) row.id = item.id
    if (item.name !== undefined && item.name !== null) row.name = item.name
    if (item.status !== undefined && item.status !== null) row.status = item.status
    return row
  })
  return { documentId, staffList }
}

function documentUserParamsOf (query: SalaryAccountingDocumentUserQuery): JsonObject {
  const value = objectOf(query, '单据员工明细查询')
  return {
    order: '',
    orderField: '',
    documentId: idOf(value.documentId, 'documentId'),
    status: optionalEnumOf(value.status, [0, 1] as const, 'status') ?? '',
    name: textOf(value.name, 'name'),
    staffCode: staffCodeOf(value.staffCode, 'staffCode') ?? '',
    pageNo: pageNumberOf(value.pageNo as number | undefined, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize as number | undefined, 20, 'pageSize'),
  }
}

function staffParamsOf (query: SalaryAccountingStaffQuery): JsonObject {
  const value = objectOf(query, '薪资核算员工查询')
  return {
    documentId: idOf(value.documentId, 'documentId'),
    staffName: textOf(value.staffName, 'staffName'),
    staffCode: staffCodeOf(value.staffCode, 'staffCode'),
    orgId: optionalIdOf(value.orgId, 'orgId'),
    postName: textOf(value.postName, 'postName'),
    pageNo: pageNumberOf(value.pageNo as number | undefined, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize as number | undefined, 20, 'pageSize'),
  }
}

function fileBytesOf (input: SalaryAccountingFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '薪资核算导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType
    ? value.contentType
    : fileName.toLowerCase().endsWith('.xls')
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: SalaryAccountingFileInput): Pick<SalaryAccountingFile, 'fileName' | 'contentType' | 'byteLength'> {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): SalaryAccountingFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('薪资核算文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function eligibilityResultOf (value: unknown): SalaryAccountingEligibilityResult {
  const result = objectOf(value, '薪资核算资格结果')
  const ids = (name: string) => arrayOf<unknown>(result[name], `薪资核算资格结果.${name}`)
  const idArray = (name: string) => ids(name).map((item, index) => idOf(item, `${name}[${index}]`))
  const staffCodes = (name: string) => ids(name).map((item, index) => staffCodeOf(item, `${name}[${index}]`, true)!)
  const processedCount = result.processedCount
  if (!Number.isSafeInteger(processedCount) || Number(processedCount) < 0) throw new Error('薪资核算资格结果.processedCount无效')
  return {
    processedIds: idArray('processedIds'),
    processedStaffCodes: staffCodes('processedStaffCodes'),
    processedCount: processedCount as number,
    eligibleStaffIds: idArray('eligibleStaffIds'),
    eligibleStaffCodes: staffCodes('eligibleStaffCodes'),
    excludedStaffList: ids('excludedStaffList').map((item, index) => objectOf(item, `excludedStaffList[${index}]`)),
  }
}

function validateSelectionState (ids: SalaryAccountingId[], currentStatuses: unknown, expected: SalaryAccountingStatus, label: string): void {
  if (!Array.isArray(currentStatuses) || currentStatuses.length !== ids.length) throw new Error(`${label}.currentStatuses必须与ids等长`)
  currentStatuses.forEach((status, index) => {
    if (statusOf(status, `${label}.currentStatuses[${index}]`) !== expected) throw new Error(`${label}只能处理状态为${expected}的单据`)
  })
}

function splitPayloadOf (input: SalaryAccountingSplitInput): JsonObject {
  const value = objectOf(input, '拆分薪资单据')
  const documentIds = idListOf(value.documentIds, 'documentIds')
  const staffCodeList = arrayOf<unknown>(value.staffCodeList, 'staffCodeList').map((item, index) => staffCodeOf(item, `staffCodeList[${index}]`, true)!)
  if (staffCodeList.length === 0 || new Set(staffCodeList.map(String)).size !== staffCodeList.length) throw new Error('staffCodeList必须非空且不能重复')
  validateSelectionState(documentIds, value.currentStatuses, 0, '拆分薪资单据')
  if (!Array.isArray(value.currentSteps) || value.currentSteps.length !== documentIds.length) throw new Error('拆分薪资单据.currentSteps必须与documentIds等长')
  if (value.currentSteps.some((step, index) => enumOf(step, [1, 2, 3, 4] as const, `拆分薪资单据.currentSteps[${index}]`) !== 4)) throw new Error('拆分薪资单据只能处理已完成核算（step=4）的单据')
  return { ids: documentIds, name: requiredTextOf(value.name, 'name', 30), staffCodeList }
}

export function createSalaryAccountingCapability (request: PortalRequest) {
  return {
    async list (query: SalaryAccountingQuery = {}): Promise<PageResult<SalaryAccountingDocument>> {
      return pageOf<SalaryAccountingDocument>(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }), '薪资核算单据分页响应')
    },
    async get (input: { id: SalaryAccountingId }): Promise<SalaryAccountingDocument | SalaryAccountingDocument[]> {
      return await request({ url: `${ROOT}/${idOf(input?.id, 'id')}`, method: 'get' }) as SalaryAccountingDocument | SalaryAccountingDocument[]
    },
    async stepInfo (input: { id: SalaryAccountingId; step?: SalaryAccountingStep }): Promise<JsonObject> {
      const id = idOf(input?.id, 'id')
      const step = input?.step === undefined ? undefined : enumOf(input.step, [1, 2, 3, 4] as const, 'step')
      return objectOf(await request({ url: `${ROOT}/stepInfo`, method: 'get', params: { id, ...(step === undefined ? {} : { step }) } }), '薪资核算步骤信息')
    },
    async ledgerItemList (input: { ledgerId: SalaryAccountingId; name?: string | null; attribute?: number | null; pageNo?: number; pageSize?: number }): Promise<PageResult<Record<string, unknown>>> {
      const attribute = input?.attribute === undefined || input.attribute === null ? '' : enumOf(input.attribute, [1, 2, 3, 4] as const, 'attribute')
      return pageOf<Record<string, unknown>>(await request({ url: LEDGER_ITEM_PAGE_URL, method: 'get', params: { order: '', orderField: '', name: textOf(input.name, 'name'), attribute, ledgerId: idOf(input.ledgerId, 'ledgerId'), pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input.pageSize, 20, 'pageSize') } }), '薪资项目分页响应')
    },
    prepareCreate (draft: SalaryAccountingCreateDraft): { draft: JsonObject } {
      return { draft: createPayload(draft) }
    },
    async create (draft: SalaryAccountingCreateDraft): Promise<SalaryAccountingId> {
      return idOf(await request({ url: `${ROOT}/saveFirstType`, method: 'post', data: createPayload(draft) }), '创建薪资单据返回ID')
    },
    prepareSaveStaff (input: SalaryAccountingSelectionDraft): { draft: { documentId: SalaryAccountingId; staffList: JsonObject[] } } {
      return { draft: selectionPayloadOf(input) }
    },
    async saveStaff (input: SalaryAccountingSelectionDraft): Promise<SalaryAccountingEligibilityResult> {
      const payload = selectionPayloadOf(input)
      return eligibilityResultOf(await request({ url: `${ROOT}/saveSecondType/${payload.documentId}`, method: 'post', data: payload.staffList }))
    },
    prepareCalculate (input: { documentId: SalaryAccountingId; currentStatus?: SalaryAccountingStatus | null }): { documentId: SalaryAccountingId } {
      const documentId = idOf(input?.documentId, 'documentId')
      if (input?.currentStatus !== undefined && input.currentStatus !== null && statusOf(input.currentStatus, 'currentStatus') !== 0) throw new Error('薪资核算只能处理未结账单据')
      return { documentId }
    },
    async calculate (input: { documentId: SalaryAccountingId }): Promise<SalaryAccountingEligibilityResult> {
      const documentId = idOf(input?.documentId, 'documentId')
      return eligibilityResultOf(await request({ url: `${ROOT}/calculate/${documentId}`, method: 'post' }))
    },
    prepareRemove (input: { ids: SalaryAccountingId[]; currentStatuses: SalaryAccountingStatus[] }): { ids: SalaryAccountingId[] } {
      const ids = idListOf(input?.ids, 'ids')
      validateSelectionState(ids, input?.currentStatuses, 0, '删除薪资单据')
      return { ids }
    },
    async remove (input: { ids: SalaryAccountingId[]; currentStatuses: SalaryAccountingStatus[] }): Promise<boolean> {
      const payload = this.prepareRemove(input)
      await request({ url: ROOT, method: 'delete', data: payload.ids })
      return true
    },
    prepareCheckout (input: SalaryAccountingCheckoutInput): { ids: SalaryAccountingId[]; status: SalaryAccountingStatus } {
      const ids = idListOf(input?.ids, 'ids')
      const status = statusOf(input?.status, 'status')
      validateSelectionState(ids, input?.currentStatuses, status === 1 ? 0 : 1, status === 1 ? '结账' : '取消结账')
      return { ids, status }
    },
    async checkout (input: SalaryAccountingCheckoutInput): Promise<string | null> {
      const payload = this.prepareCheckout(input)
      const result = await request({ url: `${ROOT}/documentCheckout`, method: 'post', data: payload })
      return result === undefined || result === null || result === '' ? null : textOf(result, '结账响应')
    },
    async cancelCheckout (input: SalaryAccountingCancelCheckoutInput): Promise<string | null> {
      return this.checkout({ ...input, status: 0 })
    },
    async documentUsers (input: { documentIds: SalaryAccountingId[] }): Promise<Record<string, unknown>[]> {
      return arrayOf(await request({ url: `${ROOT}/getDocumentUsers`, method: 'post', data: idListOf(input?.documentIds, 'documentIds') }), '单据员工列表') as Record<string, unknown>[]
    },
    async historyUsers (): Promise<Record<string, unknown>[]> {
      return arrayOf(await request({ url: HISTORY_USER_URL, method: 'get' }), '历史核算人员列表') as Record<string, unknown>[]
    },
    async organizationTree (): Promise<Record<string, unknown>[]> {
      return arrayOf(await request({ url: ORGANIZATION_TREE_URL, method: 'get' }), '组织树') as Record<string, unknown>[]
    },
    async staffList (query: SalaryAccountingStaffQuery): Promise<{ staffPage: PageResult<Record<string, unknown>>; eligibilityResult: SalaryAccountingEligibilityResult }> {
      const result = objectOf(await request({ url: STAFF_LIST_URL, method: 'post', data: staffParamsOf(query) }), '薪资员工分页响应')
      return {
        staffPage: pageOf<Record<string, unknown>>(result.staffPage, '薪资员工分页响应.staffPage'),
        eligibilityResult: eligibilityResultOf(result.eligibilityResult),
      }
    },
    async lastStaff (input: { documentId: SalaryAccountingId }): Promise<{ staffList: Record<string, unknown>[]; eligibilityResult: SalaryAccountingEligibilityResult }> {
      const result = objectOf(await request({ url: `${ROOT}/lastTimeStaffWithEligibility`, method: 'get', params: { documentId: idOf(input?.documentId, 'documentId') } }), '上次核算人员响应')
      return { staffList: arrayOf(result.staffList, '上次核算人员响应.staffList') as Record<string, unknown>[], eligibilityResult: eligibilityResultOf(result.eligibilityResult) }
    },
    prepareStaffImport (input: SalaryAccountingFileInput): Pick<SalaryAccountingFile, 'fileName' | 'contentType' | 'byteLength'> {
      return filePreviewOf(input)
    },
    async staffImport (input: SalaryAccountingFileInput & { documentId: SalaryAccountingId; orgId?: SalaryAccountingId | null }): Promise<{ staffList: Record<string, unknown>[]; eligibilityResult: SalaryAccountingEligibilityResult }> {
      const file = fileBytesOf(input)
      const data = new FormData()
      data.append('documentId', String(idOf(input.documentId, 'documentId')))
      data.append('orgId', String(optionalIdOf(input.orgId, 'orgId') ?? ''))
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = objectOf(await request({ url: `${ROOT}/secondImportWithEligibility`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }), '第二步导入人员响应')
      return { staffList: arrayOf(result.staffList, '第二步导入人员响应.staffList') as Record<string, unknown>[], eligibilityResult: eligibilityResultOf(result.eligibilityResult) }
    },
    async secondTemplate (): Promise<SalaryAccountingFile> {
      const url = textOf(await request({ url: `${ROOT}/secondDownload`, method: 'get' }), '第二步模板URL')
      if (!url) throw new Error('第二步模板URL为空')
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url, method: 'get', responseType: 'arraybuffer' }), '第二步导入模板.xlsx')
    },
    async externalItems (input: { documentId: SalaryAccountingId }): Promise<Record<string, unknown>[]> {
      return arrayOf(await request({ url: `${ROOT.replace('/document', '/ledgerItem')}/getAllExternalDataSalaryItem`, method: 'get', params: { documentId: idOf(input?.documentId, 'documentId') } }), '外部薪资项目列表') as Record<string, unknown>[]
    },
    async existingExternalItems (input: { documentId: SalaryAccountingId; type: SalaryAccountingMatchType }): Promise<string[]> {
      const documentId = idOf(input?.documentId, 'documentId')
      const type = enumOf(input?.type, [1, 2] as const, 'type')
      const data = new FormData()
      data.append('documentId', String(documentId))
      data.append('type', String(type))
      return arrayOf(await request({ url: `${ROOT}/accountResult`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }), '已有外部薪资项目列表').map((item, index) => textOf(item, `已有外部薪资项目列表[${index}]`))
    },
    prepareExternalImport (input: SalaryAccountingFileInput): Pick<SalaryAccountingFile, 'fileName' | 'contentType' | 'byteLength'> {
      return filePreviewOf(input)
    },
    async externalAccountResult (input: SalaryAccountingFileInput & { documentId: SalaryAccountingId; type: SalaryAccountingMatchType }): Promise<string[]> {
      const file = fileBytesOf(input)
      const data = new FormData()
      data.append('documentId', String(idOf(input.documentId, 'documentId')))
      data.append('type', String(enumOf(input.type, [1, 2] as const, 'type')))
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      return arrayOf(await request({ url: `${ROOT}/accountResult`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }), '外部薪资项目导入结果').map((item, index) => textOf(item, `外部薪资项目导入结果[${index}]`))
    },
    async importExternalResult (input: { documentId: SalaryAccountingId }): Promise<SalaryAccountingEligibilityResult> {
      return eligibilityResultOf(await request({ url: `${ROOT}/importResult/${idOf(input?.documentId, 'documentId')}`, method: 'post' }))
    },
    async externalTemplate (input: { documentId: SalaryAccountingId; type: SalaryAccountingMatchType }): Promise<SalaryAccountingFile> {
      const documentId = idOf(input?.documentId, 'documentId')
      const type = enumOf(input?.type, [1, 2] as const, 'type')
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/download`, method: 'get', params: { documentId, type }, responseType: 'arraybuffer' }), '薪资外部数据导入模板.xlsx')
    },
    async detail (input: { id: SalaryAccountingId }): Promise<JsonObject> {
      return objectOf(await request({ url: `${ROOT}/${idOf(input?.id, 'id')}`, method: 'get' }), '薪资核算详情')
    },
    async detailUsers (query: SalaryAccountingDocumentUserQuery): Promise<{ summary: JsonObject; pageData: PageResult<SalaryAccountingDocumentUser> }> {
      const result = objectOf(await request({ url: `${ROOT}/documentUserPage`, method: 'post', data: documentUserParamsOf(query) }), '单据员工明细响应')
      return { summary: objectOf(result.summary, '单据员工明细响应.summary'), pageData: pageOf<SalaryAccountingDocumentUser>(result.pageData, '单据员工明细响应.pageData') }
    },
    async detailExport (query: SalaryAccountingDocumentUserQuery): Promise<SalaryAccountingFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/documentUserPageExport`, method: 'post', data: documentUserParamsOf(query), responseType: 'arraybuffer' }), '单据员工明细表.xlsx')
    },
    preparePay (input: SalaryAccountingPayInput): { documentId: SalaryAccountingId; idList: SalaryAccountingId[]; grantTime: string } {
      const documentId = idOf(input?.documentId, 'documentId')
      const idList = idListOf(input?.idList, 'idList')
      const grantTime = dateOf(input?.grantTime, 'grantTime', true)!
      if (statusOf(input?.documentStatus, 'documentStatus') !== 1) throw new Error('工资发放只允许已结账单据')
      validateSelectionState(idList, input?.currentStatuses, 0, '工资发放')
      return { documentId, idList, grantTime }
    },
    async pay (input: SalaryAccountingPayInput): Promise<boolean> {
      await request({ url: `${ROOT}/paySalary`, method: 'post', data: this.preparePay(input) })
      return true
    },
    prepareRename (input: { id: SalaryAccountingId; name: string }): { id: SalaryAccountingId; name: string } {
      return { id: idOf(input?.id, 'id'), name: requiredTextOf(input?.name, 'name') }
    },
    async rename (input: { id: SalaryAccountingId; name: string }): Promise<boolean> {
      const payload = this.prepareRename(input)
      await request({ url: `${ROOT}/${payload.id}`, method: 'put', data: { name: payload.name } })
      return true
    },
    cancelRename (): { cancelled: true } {
      return { cancelled: true }
    },
    prepareSplit (input: SalaryAccountingSplitInput): { ids: SalaryAccountingId[]; name: string; staffCodeList: Array<string | number> } {
      const payload = splitPayloadOf(input)
      return { ids: payload.ids as SalaryAccountingId[], name: payload.name as string, staffCodeList: payload.staffCodeList as Array<string | number> }
    },
    async split (input: SalaryAccountingSplitInput): Promise<boolean> {
      await request({ url: `${ROOT}/splitDocument`, method: 'post', data: splitPayloadOf(input) })
      return true
    },
    async temporaryDetailList (input: { documentId: SalaryAccountingId; itemId: SalaryAccountingId; staffName?: string | null; pageNo?: number; pageSize?: number }): Promise<PageResult<SalaryAccountingTemporaryDetail>> {
      return pageOf<SalaryAccountingTemporaryDetail>(await request({ url: `${DETAIL_TEMPORARY_ROOT}/page`, method: 'get', params: { order: '', orderField: '', documentId: idOf(input?.documentId, 'documentId'), itemId: idOf(input?.itemId, 'itemId'), staffName: input?.staffName === undefined || input.staffName === null ? null : textOf(input.staffName, 'staffName'), pageNo: pageNumberOf(input?.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input?.pageSize, 20, 'pageSize') } }), '临时核算明细分页响应')
    },
    prepareTemporaryDetailUpdate (input: { updates: Array<{ id: SalaryAccountingId; value: number | string | null }> }): { updates: JsonObject[] } {
      if (!Array.isArray(input?.updates) || input.updates.length === 0) throw new Error('updates必须为非空数组')
      return { updates: input.updates.map((item, index) => ({ id: idOf(item?.id, `updates[${index}].id`), value: item.value })) }
    },
    async temporaryDetailUpdate (input: { updates: Array<{ id: SalaryAccountingId; value: number | string | null }> }): Promise<boolean> {
      await request({ url: `${DETAIL_TEMPORARY_ROOT}/batchUpdate`, method: 'post', data: this.prepareTemporaryDetailUpdate(input).updates })
      return true
    },
  }
}

export type SalaryAccountingCapability = ReturnType<typeof createSalaryAccountingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const statusOptions = [{ value: 0, label: '未结账/未发放' }, { value: 1, label: '已结账/已发放' }]
const matchOptions = [{ value: 1, label: '身份证号' }, { value: 2, label: '员工号' }]
const fileParams = [p('fileName', 'text', true, '上传文件名，支持.xlsx/.xls'), p('base64', 'text', true, '文件内容Base64'), p('contentType', 'text', false, '文件MIME类型')]
const documentId = p('documentId', 'number', true, '薪资单据ID')

export const SALARY_ACCOUNTING_METHODS = {
  'salary-accounting-list': 'list',
  'salary-accounting-get': 'get',
  'salary-accounting-step-info': 'stepInfo',
  'salary-accounting-ledger-item-list': 'ledgerItemList',
  'salary-accounting-prepare-create': 'prepareCreate',
  'salary-accounting-create': 'create',
  'salary-accounting-prepare-save-staff': 'prepareSaveStaff',
  'salary-accounting-save-staff': 'saveStaff',
  'salary-accounting-prepare-calculate': 'prepareCalculate',
  'salary-accounting-calculate': 'calculate',
  'salary-accounting-prepare-remove': 'prepareRemove',
  'salary-accounting-remove': 'remove',
  'salary-accounting-prepare-checkout': 'prepareCheckout',
  'salary-accounting-checkout': 'checkout',
  'salary-accounting-cancel-checkout': 'cancelCheckout',
  'salary-accounting-document-users': 'documentUsers',
  'salary-accounting-history-users': 'historyUsers',
  'salary-accounting-organization-tree': 'organizationTree',
  'salary-accounting-staff-list': 'staffList',
  'salary-accounting-last-staff': 'lastStaff',
  'salary-accounting-prepare-staff-import': 'prepareStaffImport',
  'salary-accounting-staff-import': 'staffImport',
  'salary-accounting-second-template': 'secondTemplate',
  'salary-accounting-external-items': 'externalItems',
  'salary-accounting-existing-external-items': 'existingExternalItems',
  'salary-accounting-prepare-external-import': 'prepareExternalImport',
  'salary-accounting-external-account-result': 'externalAccountResult',
  'salary-accounting-import-result': 'importExternalResult',
  'salary-accounting-external-template': 'externalTemplate',
  'salary-accounting-detail': 'detail',
  'salary-accounting-detail-users': 'detailUsers',
  'salary-accounting-detail-export': 'detailExport',
  'salary-accounting-prepare-pay': 'preparePay',
  'salary-accounting-pay': 'pay',
  'salary-accounting-prepare-rename': 'prepareRename',
  'salary-accounting-rename': 'rename',
  'salary-accounting-cancel-rename': 'cancelRename',
  'salary-accounting-prepare-split': 'prepareSplit',
  'salary-accounting-split': 'split',
  'salary-accounting-temporary-detail-list': 'temporaryDetailList',
  'salary-accounting-prepare-temporary-detail-update': 'prepareTemporaryDetailUpdate',
  'salary-accounting-temporary-detail-update': 'temporaryDetailUpdate',
} as const

const definitions = [
  { id: 'salary-accounting-list', title: '查询薪资核算单据', write: false, params: [p('salaryMonth', 'date'), p('status', 'enum', false, '单据状态：0未结账、1已结账', statusOptions), p('operatorId', 'search'), p('name', 'text'), p('ledgerId', 'search'), p('organizationId', 'tree'), p('personCount', 'text'), p('creatorName', 'text'), p('createDate', 'date'), p('operateDate', 'date'), p('salaryTaxBand', 'search'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-get', title: '读取薪资核算单据', write: false, params: [p('id', 'number', true, '薪资单据ID')] },
  { id: 'salary-accounting-step-info', title: '读取薪资核算步骤数据', write: false, params: [p('id', 'number', true), p('step', 'enum', false, '步骤1、2、3或4', [{ value: 1, label: '账套和月份' }, { value: 2, label: '核算人员' }, { value: 3, label: '外部数据' }, { value: 4, label: '结果详情' }])] },
  { id: 'salary-accounting-ledger-item-list', title: '查询账套薪资项目', write: false, params: [p('ledgerId', 'search', true), p('name', 'text'), p('attribute', 'enum', false, '薪资项目属性', [{ value: 1, label: '固定项' }, { value: 2, label: '计算项' }, { value: 3, label: '外部数据' }, { value: 4, label: '系统参数' }]), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-prepare-create', title: '准备创建薪资核算单据', write: false, params: [p('organizationId', 'tree', true), p('ledgerId', 'search', true), p('salaryMonth', 'date', true), p('costMonth', 'date', true), p('name', 'text')] },
  { id: 'salary-accounting-create', title: '创建薪资核算单据第一步', write: true, params: [p('organizationId', 'tree', true), p('ledgerId', 'search', true), p('salaryMonth', 'date', true), p('costMonth', 'date', true), p('name', 'text')] },
  { id: 'salary-accounting-prepare-save-staff', title: '准备保存薪资核算人员名单', write: false, params: [documentId, p('staffList', 'text', true, '当前页面去重后的员工对象数组')] },
  { id: 'salary-accounting-save-staff', title: '保存薪资核算人员名单', write: true, params: [documentId, p('staffList', 'text', true)] },
  { id: 'salary-accounting-prepare-calculate', title: '准备执行薪资核算', write: false, params: [documentId, p('currentStatus', 'enum', false, '重新核算时使用，必须为未结账', statusOptions)] },
  { id: 'salary-accounting-calculate', title: '执行薪资核算', write: true, params: [documentId] },
  { id: 'salary-accounting-prepare-remove', title: '检查删除薪资核算单据条件', write: false, params: [p('ids', 'text', true), p('currentStatuses', 'text', true, '必须与ids等长且全部为0')] },
  { id: 'salary-accounting-remove', title: '删除薪资核算单据', write: true, params: [p('ids', 'text', true), p('currentStatuses', 'text', true)] },
  { id: 'salary-accounting-prepare-checkout', title: '准备薪资单据结账或取消结账', write: false, params: [p('ids', 'text', true), p('status', 'enum', true, '1结账、0取消结账', statusOptions), p('currentStatuses', 'text', true)] },
  { id: 'salary-accounting-checkout', title: '结账薪资单据', write: true, params: [p('ids', 'text', true), p('status', 'enum', true, '必须为1', statusOptions), p('currentStatuses', 'text', true)] },
  { id: 'salary-accounting-cancel-checkout', title: '取消薪资单据结账', write: true, params: [p('ids', 'text', true), p('currentStatuses', 'text', true)] },
  { id: 'salary-accounting-document-users', title: '读取拆分候选员工', write: false, params: [p('documentIds', 'text', true)] },
  { id: 'salary-accounting-history-users', title: '读取历史核算人员', write: false, params: [] },
  { id: 'salary-accounting-organization-tree', title: '读取员工选择组织树', write: false, params: [] },
  { id: 'salary-accounting-staff-list', title: '分页查询可选核算员工及资格结果', write: false, params: [documentId, p('staffName', 'text'), p('staffCode', 'text'), p('orgId', 'tree'), p('postName', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-last-staff', title: '读取上次核算人员及资格结果', write: false, params: [documentId] },
  { id: 'salary-accounting-prepare-staff-import', title: '准备导入核算人员文件', write: false, params: fileParams },
  { id: 'salary-accounting-staff-import', title: '导入核算人员文件', write: false, params: [documentId, p('orgId', 'tree'), ...fileParams] },
  { id: 'salary-accounting-second-template', title: '下载第二步核算人员模板', write: false, params: [] },
  { id: 'salary-accounting-external-items', title: '读取账套外部薪资项目', write: false, params: [documentId] },
  { id: 'salary-accounting-existing-external-items', title: '读取已有外部薪资项目匹配结果', write: false, params: [documentId, p('type', 'enum', true, '1身份证号、2员工号', matchOptions)] },
  { id: 'salary-accounting-prepare-external-import', title: '准备导入外部薪资项目文件', write: false, params: fileParams },
  { id: 'salary-accounting-external-account-result', title: '上传并校验外部薪资项目文件', write: true, params: [documentId, p('type', 'enum', true, '1身份证号、2员工号', matchOptions), ...fileParams] },
  { id: 'salary-accounting-import-result', title: '提交外部薪资项目临时结果并继续核算', write: true, params: [documentId] },
  { id: 'salary-accounting-external-template', title: '下载外部薪资项目模板', write: false, params: [documentId, p('type', 'enum', true, '1身份证号、2员工号', matchOptions)] },
  { id: 'salary-accounting-detail', title: '读取薪资核算结果单据', write: false, params: [p('id', 'number', true)] },
  { id: 'salary-accounting-detail-users', title: '查询薪资核算员工明细', write: false, params: [documentId, p('status', 'enum', false, '0未发放、1已发放', statusOptions), p('name', 'text'), p('staffCode', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-detail-export', title: '导出薪资核算员工明细', write: false, params: [documentId, p('status', 'enum', false, '0未发放、1已发放', statusOptions), p('name', 'text'), p('staffCode', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-prepare-pay', title: '准备发放薪资', write: false, params: [documentId, p('idList', 'text', true), p('grantTime', 'date', true), p('documentStatus', 'enum', true, '必须为1已结账', statusOptions), p('currentStatuses', 'text', true, '必须与idList等长且全部为0')] },
  { id: 'salary-accounting-pay', title: '发放选中员工工资', write: true, params: [documentId, p('idList', 'text', true), p('grantTime', 'date', true), p('documentStatus', 'enum', true, '必须为1已结账', statusOptions), p('currentStatuses', 'text', true)] },
  { id: 'salary-accounting-prepare-rename', title: '准备修改薪资单据名称', write: false, params: [p('id', 'number', true), p('name', 'text', true)] },
  { id: 'salary-accounting-rename', title: '修改薪资单据名称', write: true, params: [p('id', 'number', true), p('name', 'text', true)] },
  { id: 'salary-accounting-cancel-rename', title: '取消修改薪资单据名称', write: false, params: [] },
  { id: 'salary-accounting-prepare-split', title: '准备拆分薪资单据', write: false, params: [p('documentIds', 'text', true), p('name', 'text', true), p('staffCodeList', 'text', true), p('currentStatuses', 'text', true, '与documentIds等长且全部为0'), p('currentSteps', 'text', true, '与documentIds等长且全部为4')] },
  { id: 'salary-accounting-split', title: '拆分薪资单据', write: true, params: [p('documentIds', 'text', true), p('name', 'text', true), p('staffCodeList', 'text', true), p('currentStatuses', 'text', true), p('currentSteps', 'text', true)] },
  { id: 'salary-accounting-temporary-detail-list', title: '查询外部薪资项目临时明细', write: false, params: [documentId, p('itemId', 'number', true), p('staffName', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'salary-accounting-prepare-temporary-detail-update', title: '准备保存外部薪资项目临时明细', write: false, params: [p('updates', 'text', true)] },
  { id: 'salary-accounting-temporary-detail-update', title: '保存外部薪资项目临时明细', write: true, params: [p('updates', 'text', true)] },
]

export const salaryAccountingCapabilities: CapabilityDefinition[] = definitions.map(definition => ({
  ...definition,
  pagePath: SALARY_ACCOUNTING_PAGE_PATH,
  permission: SALARY_ACCOUNTING_PERMISSION,
  moduleType: SALARY_ACCOUNTING_MODULE_TYPE,
  httpInstance: 'platform',
}))
