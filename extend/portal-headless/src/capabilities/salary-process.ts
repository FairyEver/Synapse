import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「薪酬管理 → 薪资办理」。 */
export const SALARY_PROCESS_PAGE_PATH = '/dashboard/salary/process/list'
export const SALARY_PROCESS_PERMISSION = '/dashboard/salary/process'
export const SALARY_PROCESS_MODULE_TYPE = 14

const ROOT = '/salary/salarytransact'
const EXPORT_URL = '/admin-api/salary/salarytransact/export'
const LEDGER_OPTIONS_URL = '/salary/ledger/getWebLedgerList'
const LEGAL_PERSON_OPTIONS_URL = '/org/corporation/getAllLegalPerson'
const COST_CENTER_OPTIONS_URL = '/salary/costcenter/list'
const SALARY_LEVEL_OPTIONS_URL = '/org/hrsalarylevel/getAllSalaryLevel'

export type SalaryProcessId = string | number
export type SalaryProcessStatus = -1 | 0 | 1

export type SalaryProcessQuery = {
  orgIds?: SalaryProcessId[] | string | null
  staffCode?: string | number | null
  staffStatus?: number | '' | null
  status?: SalaryProcessStatus | '' | null
  staffName?: string | null
  businessDate?: string | null
  pageNo?: number
  pageSize?: number
}

export type SalaryProcessRow = Record<string, unknown> & {
  id?: SalaryProcessId | null
  transactTime?: string | null
  staffId?: SalaryProcessId | null
  staffCode?: string | number | null
  staffName?: string | null
  idCard?: string | null
  organization?: SalaryProcessId | null
  organizationName?: string | null
  startOrganizationName?: string | null
  postName?: string | null
  employmentType?: number | null
  ledgerId?: SalaryProcessId | null
  salaryLevel?: SalaryProcessId | null
  salaryLevelName?: string | null
  salaryLevelStandard?: number | string | null
  ledgerName?: string | null
  cardIssuingBank?: string | null
  bankAccount?: string | null
  status?: SalaryProcessStatus | null
  legalPersonId?: SalaryProcessId | null
  legalPersonName?: string | null
  costCenterId?: SalaryProcessId | null
  costCenterName?: string | null
  staffStatus?: number | null
  entryTime?: string | null
  salaryCategory?: string | number | null
  wage?: number | string | null
  description?: string | null
  isDel?: number | null
  creator?: SalaryProcessId | null
  createTime?: string | null
  updater?: SalaryProcessId | null
  updateTime?: string | null
  updaterName?: string | null
  stopTime?: string | null
  stopDescription?: string | null
  emptyDate?: string | null
}

export type SalaryProcessForm = Record<string, unknown> & {
  id?: SalaryProcessId | null
  transactTime?: string | null
  staffCode?: string | number | null
  organization?: SalaryProcessId | null
  ledgerId?: SalaryProcessId | null
  status?: SalaryProcessStatus | null
  legalPersonId?: SalaryProcessId | null
  costCenterId?: SalaryProcessId | null
  salaryCategory?: string | number | null
  wage?: number | string | null
  salaryLevel?: SalaryProcessId | null
  description?: string | null
  isDel?: number | null
  creator?: SalaryProcessId | null
  createTime?: string | null
  updater?: SalaryProcessId | null
  updateTime?: string | null
  stopTime?: string | null
  stopDescription?: string | null
  emptyDate?: string | null
}

export type SalaryProcessUpdate = SalaryProcessForm & { id: SalaryProcessId; status: 1 }
export type SalaryProcessStopInput = { id: SalaryProcessId; stopTime?: string | null; stopDescription: string }
export type SalaryProcessActiveSelection = { idList: SalaryProcessId[]; currentStatuses: number[] }
export type SalaryProcessEditLegalPersonInput = SalaryProcessActiveSelection & { legalPersonId: SalaryProcessId }
export type SalaryProcessEditCostCenterInput = SalaryProcessActiveSelection & { costCenterId: SalaryProcessId }
export type SalaryProcessClearTaxDateInput = SalaryProcessActiveSelection & { emptyDate: string }
export type SalaryProcessExportInput = SalaryProcessQuery & { selectedStaffCodes?: Array<string | number> | null }
export type SalaryProcessFileInput = { fileName: string; base64: string; contentType?: string }
export type SalaryProcessFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }

export type SalaryProcessOption = Record<string, unknown> & {
  id: SalaryProcessId
  name: string
}

export type SalaryProcessExcludedStaff = Record<string, unknown> & {
  staffId?: SalaryProcessId | null
  staffCode?: string | number | null
  staffName?: string | null
  status?: number | null
  downtimePay?: string | null
  businessDate?: string | null
  reasonCode?: string | null
  reason?: string | null
}

export type SalaryProcessEligibilityResult = {
  processedIds: SalaryProcessId[]
  processedStaffCodes: Array<string | number>
  processedCount: number
  eligibleStaffIds: SalaryProcessId[]
  eligibleStaffCodes: Array<string | number>
  excludedStaffList: SalaryProcessExcludedStaff[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryProcessId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryProcessId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}最多${maxLength}个字`)
  return value
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

function monthOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function dayOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return today()
  return dateOf(value, label, true)!
}

function today (): string {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function statusOf (value: unknown, label: string, allowEmpty = true): SalaryProcessStatus | null {
  if (value === undefined || value === null || value === '') {
    if (!allowEmpty) throw new Error(`${label}不能为空`)
    return null
  }
  if (!Number.isSafeInteger(value) || ![-1, 0, 1].includes(value as number)) throw new Error(`${label}必须为-1、0或1`)
  return value as SalaryProcessStatus
}

function staffStatusOf (value: unknown, label: string): number | '' {
  if (value === undefined || value === null || value === '') return ''
  if (!Number.isSafeInteger(value) || ![1, 2, 3, 4, 5].includes(value as number)) throw new Error(`${label}必须为1至5的在职状态字典值`)
  return value as number
}

function numberLikeOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error(`${label}必须是10、20、50、100、200或500`)
  return resolved
}

function idsOf (value: unknown, label: string): SalaryProcessId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function commaIdsOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : null
  if (!values) throw new Error('orgIds必须为ID数组、逗号分隔字符串或空值')
  if (values.length === 0) return ''
  return idsOf(values, 'orgIds').join(',')
}

function queryFieldsOf (query: SalaryProcessQuery = {}): JsonObject {
  const staffCode = staffCodeOf(query.staffCode, 'staffCode')
  const staffName = textOf(query.staffName, 'staffName')
  const staffStatus = staffStatusOf(query.staffStatus, 'staffStatus')
  const status = statusOf(query.status, 'status')
  return {
    orgIds: commaIdsOf(query.orgIds),
    staffCode: staffCode ?? '',
    staffStatus,
    status: status ?? '',
    staffName: staffName ?? '',
    businessDate: dayOf(query.businessDate, 'businessDate'),
  }
}

function listParamsOf (query: SalaryProcessQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...queryFieldsOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportParamsOf (input: SalaryProcessExportInput = {}): JsonObject {
  const selected = input.selectedStaffCodes
  if (selected !== undefined && selected !== null && !Array.isArray(selected)) throw new Error('selectedStaffCodes必须为数组或空值')
  if (Array.isArray(selected) && selected.length > 0) {
    const staffCodeList = selected.map((item, index) => staffCodeOf(item, `selectedStaffCodes[${index}]`, true)!)
    return { staffCodeList: [...new Map(staffCodeList.map(item => [String(item), item])).values()], businessDate: dayOf(input.businessDate, 'businessDate') }
  }
  return queryFieldsOf(input)
}

const FORM_FIELDS = [
  'id', 'transactTime', 'staffCode', 'organization', 'ledgerId', 'status', 'legalPersonId', 'costCenterId',
  'salaryCategory', 'wage', 'salaryLevel', 'description', 'isDel', 'creator', 'createTime', 'updater', 'updateTime',
  'stopTime', 'stopDescription', 'emptyDate',
] as const

function formPayloadOf (input: SalaryProcessForm, mode: 'start' | 'update'): JsonObject {
  const value = objectOf(input, '薪资办理表单')
  const payload: JsonObject = {}
  for (const field of FORM_FIELDS) if (Object.prototype.hasOwnProperty.call(value, field)) payload[field] = value[field]

  if (mode === 'update') payload.id = idOf(value.id, 'id')
  else if (Object.prototype.hasOwnProperty.call(value, 'id')) payload.id = optionalIdOf(value.id, 'id')

  payload.transactTime = dateOf(value.transactTime, 'transactTime', true)
  if (mode === 'start') payload.staffCode = staffCodeOf(value.staffCode, 'staffCode', true)
  else if (Object.prototype.hasOwnProperty.call(value, 'staffCode')) payload.staffCode = staffCodeOf(value.staffCode, 'staffCode')
  payload.ledgerId = idOf(value.ledgerId, 'ledgerId')
  payload.legalPersonId = idOf(value.legalPersonId, 'legalPersonId')
  payload.costCenterId = idOf(value.costCenterId, 'costCenterId')
  payload.description = requiredTextOf(value.description, 'description', 200)

  if (Object.prototype.hasOwnProperty.call(value, 'organization')) payload.organization = optionalIdOf(value.organization, 'organization')
  if (Object.prototype.hasOwnProperty.call(value, 'status')) {
    const status = statusOf(value.status, 'status')
    if (mode === 'update' && status !== 1) throw new Error('只有status=1的已起薪记录允许编辑')
    if (mode === 'start' && status === 1) throw new Error('status=1的记录必须先通过起薪校验；不能重复起薪')
    payload.status = status
  }
  if (Object.prototype.hasOwnProperty.call(value, 'salaryCategory')) {
    const category = value.salaryCategory
    if (category !== null && category !== undefined && typeof category !== 'string' && typeof category !== 'number') throw new Error('salaryCategory必须为字符串、数字或null')
    payload.salaryCategory = category ?? null
  }
  if (Object.prototype.hasOwnProperty.call(value, 'salaryLevel')) payload.salaryLevel = optionalIdOf(value.salaryLevel, 'salaryLevel')
  if (Object.prototype.hasOwnProperty.call(value, 'wage')) payload.wage = numberLikeOf(value.wage, 'wage')
  if (Object.prototype.hasOwnProperty.call(value, 'stopTime')) payload.stopTime = dateOf(value.stopTime, 'stopTime')
  if (Object.prototype.hasOwnProperty.call(value, 'stopDescription')) payload.stopDescription = textOf(value.stopDescription, 'stopDescription')
  if (Object.prototype.hasOwnProperty.call(value, 'emptyDate')) payload.emptyDate = textOf(value.emptyDate, 'emptyDate')
  return payload
}

function stopPayloadOf (input: SalaryProcessStopInput): JsonObject {
  const value = objectOf(input, '停薪表单')
  return {
    idList: [idOf(value.id, 'id')],
    stopTime: dateOf(value.stopTime ?? today(), 'stopTime', true),
    stopDescription: requiredTextOf(value.stopDescription, 'stopDescription'),
  }
}

function activeSelectionOf (input: SalaryProcessActiveSelection, label: string): { idList: SalaryProcessId[]; currentStatuses: number[] } {
  const value = objectOf(input, label)
  const idList = idsOf(value.idList, `${label}.idList`)
  if (!Array.isArray(value.currentStatuses) || value.currentStatuses.length !== idList.length) throw new Error(`${label}.currentStatuses必须与idList等长`)
  if (value.currentStatuses.some(status => status !== 1)) throw new Error('存在未起薪或已停薪的人员；Portal只允许对status=1批量调整')
  return { idList, currentStatuses: value.currentStatuses as number[] }
}

function batchLegalPersonPayloadOf (input: SalaryProcessEditLegalPersonInput): JsonObject {
  const selection = activeSelectionOf(input, '纳税单位调整')
  return { legalPersonId: idOf(input.legalPersonId, 'legalPersonId'), idList: selection.idList }
}

function batchCostCenterPayloadOf (input: SalaryProcessEditCostCenterInput): JsonObject {
  const selection = activeSelectionOf(input, '成本中心调整')
  return { costCenterId: idOf(input.costCenterId, 'costCenterId'), idList: selection.idList }
}

function clearTaxDatePayloadOf (input: SalaryProcessClearTaxDateInput): JsonObject {
  const selection = activeSelectionOf(input, '清纳税开始时间')
  return { emptyDate: monthOf(input.emptyDate, 'emptyDate', true), ids: selection.idList }
}

function fileBytesOf (input: SalaryProcessFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '薪资办理导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType
    ? value.contentType
    : fileName.toLowerCase().endsWith('.xls') ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: SalaryProcessFileInput): { fileName: string; contentType: string; byteLength: number } {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileNameFromUrl (value: string): string {
  const path = value.split(/[?#]/, 1)[0] || ''
  const raw = path.split('/').pop() || ''
  if (!raw) return ''
  try { return decodeURIComponent(raw) } catch { return raw }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): SalaryProcessFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('薪资办理文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentDisposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof contentDisposition === 'string' ? contentDisposition : ''
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

function pageOf (value: unknown): PageResult<SalaryProcessRow> {
  const page = objectOf(value, '薪资办理分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('薪资办理分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `薪资办理列表[${index}]`) } as SalaryProcessRow)), total: page.total as number }
}

function optionListOf (value: unknown, label: string): SalaryProcessOption[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    return { ...row, id: idOf(row.id, `${label}[${index}].id`), name: requiredTextOf(row.name, `${label}[${index}].name`) }
  }) as SalaryProcessOption[]
}

function eligibilityResultOf (value: unknown): SalaryProcessEligibilityResult {
  const result = objectOf(value, '批量起薪结果')
  const arrayOrEmpty = (name: string): unknown[] => result[name] === undefined || result[name] === null ? [] : Array.isArray(result[name]) ? result[name] as unknown[] : (() => { throw new Error(`批量起薪结果.${name}必须为数组`) })()
  const processedIds = arrayOrEmpty('processedIds').map((item, index) => idOf(item, `processedIds[${index}]`))
  const processedStaffCodes = arrayOrEmpty('processedStaffCodes').map((item, index) => staffCodeOf(item, `processedStaffCodes[${index}]`, true)!)
  const eligibleStaffIds = arrayOrEmpty('eligibleStaffIds').map((item, index) => idOf(item, `eligibleStaffIds[${index}]`))
  const eligibleStaffCodes = arrayOrEmpty('eligibleStaffCodes').map((item, index) => staffCodeOf(item, `eligibleStaffCodes[${index}]`, true)!)
  const excludedStaffList = arrayOrEmpty('excludedStaffList').map((item, index) => ({ ...objectOf(item, `excludedStaffList[${index}]`) } as SalaryProcessExcludedStaff))
  const processedCount = result.processedCount === undefined || result.processedCount === null ? 0 : result.processedCount
  if (!Number.isSafeInteger(processedCount) || Number(processedCount) < 0) throw new Error('批量起薪结果.processedCount必须为非负整数')
  return { processedIds, processedStaffCodes, processedCount: processedCount as number, eligibleStaffIds, eligibleStaffCodes, excludedStaffList }
}

async function downloadFromUrl (request: PortalRequest, endpoint: string, fallback: string): Promise<SalaryProcessFile> {
  const url = requiredTextOf(await request<unknown>({ url: endpoint, method: 'get' }), '模板下载URL')
  const response = await request<AxiosResponse<ArrayBuffer>>({ url, method: 'get', responseType: 'arraybuffer' })
  return fileOf(response, fileNameFromUrl(url) || fallback)
}

export function createSalaryProcessCapability (request: PortalRequest) {
  return {
    async list (query: SalaryProcessQuery = {}): Promise<PageResult<SalaryProcessRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id?: SalaryProcessId | null; staffCode?: string | number | null }): Promise<SalaryProcessRow> {
      const value = objectOf(input, '薪资办理详情查询')
      const id = optionalIdOf(value.id, 'id')
      const params = id !== null
        ? { id }
        : { staffCode: staffCodeOf(value.staffCode, 'staffCode', true) }
      return { ...objectOf(await request<unknown>({ url: `${ROOT}/info`, method: 'get', params }), '薪资办理详情') } as SalaryProcessRow
    },
    async ledgerOptions (): Promise<SalaryProcessOption[]> {
      return optionListOf(await request<unknown>({ url: LEDGER_OPTIONS_URL, method: 'get' }), '薪资账套候选')
    },
    async legalPersonOptions (): Promise<SalaryProcessOption[]> {
      return optionListOf(await request<unknown>({ url: LEGAL_PERSON_OPTIONS_URL, method: 'get' }), '纳税单位候选')
    },
    async costCenterOptions (): Promise<SalaryProcessOption[]> {
      return optionListOf(await request<unknown>({ url: COST_CENTER_OPTIONS_URL, method: 'get' }), '成本中心候选')
    },
    async salaryLevelOptions (): Promise<SalaryProcessOption[]> {
      return optionListOf(await request<unknown>({ url: SALARY_LEVEL_OPTIONS_URL, method: 'get' }), '薪资等级候选')
    },
    async checkStart (input: { id?: SalaryProcessId | null } = {}): Promise<0 | 1 | 2> {
      const id = optionalIdOf(input.id, 'id')
      const result = await request<unknown>({ url: `${ROOT}/check`, method: 'get', ...(id === null ? {} : { params: { id } }) })
      if (!Number.isSafeInteger(result) || ![0, 1, 2].includes(result as number)) throw new Error('起薪校验响应必须为0、1或2')
      return result as 0 | 1 | 2
    },
    prepareStart (draft: SalaryProcessForm): { draft: JsonObject } {
      return { draft: formPayloadOf(draft, 'start') }
    },
    async start (draft: SalaryProcessForm): Promise<void> {
      await request({ url: ROOT, method: 'post', data: formPayloadOf(draft, 'start') })
    },
    prepareUpdate (draft: SalaryProcessUpdate): { draft: JsonObject } {
      return { draft: formPayloadOf(draft, 'update') }
    },
    async update (draft: SalaryProcessUpdate): Promise<void> {
      await request({ url: ROOT, method: 'put', data: formPayloadOf(draft, 'update') })
    },
    prepareStop (input: SalaryProcessStopInput): { draft: JsonObject } {
      return { draft: stopPayloadOf(input) }
    },
    async stop (input: SalaryProcessStopInput): Promise<void> {
      await request({ url: `${ROOT}/stop`, method: 'put', data: stopPayloadOf(input) })
    },
    prepareEditLegalPerson (input: SalaryProcessEditLegalPersonInput): { draft: JsonObject } {
      return { draft: batchLegalPersonPayloadOf(input) }
    },
    async editLegalPerson (input: SalaryProcessEditLegalPersonInput): Promise<void> {
      await request({ url: `${ROOT}/editLegalPersonId`, method: 'put', data: batchLegalPersonPayloadOf(input) })
    },
    prepareEditCostCenter (input: SalaryProcessEditCostCenterInput): { draft: JsonObject } {
      return { draft: batchCostCenterPayloadOf(input) }
    },
    async editCostCenter (input: SalaryProcessEditCostCenterInput): Promise<void> {
      await request({ url: `${ROOT}/editCostCenterId`, method: 'put', data: batchCostCenterPayloadOf(input) })
    },
    prepareClearTaxDate (input: SalaryProcessClearTaxDateInput): { draft: JsonObject } {
      return { draft: clearTaxDatePayloadOf(input) }
    },
    async clearTaxDate (input: SalaryProcessClearTaxDateInput): Promise<string | null> {
      const result = await request<unknown>({ url: `${ROOT}/batchEmptyTaxDate`, method: 'post', data: clearTaxDatePayloadOf(input) })
      if (result === undefined || result === null) return null
      return textOf(result, '清纳税开始时间响应')
    },
    async export (input: SalaryProcessExportInput = {}): Promise<SalaryProcessFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: exportParamsOf(input), responseType: 'arraybuffer' }), '薪资办理.xls')
    },
    async downloadBatchStartTemplate (): Promise<SalaryProcessFile> {
      return downloadFromUrl(request, `${ROOT}/download`, '批量起薪模板.xlsx')
    },
    prepareBatchStart (input: SalaryProcessFileInput): { fileName: string; contentType: string; byteLength: number } {
      return filePreviewOf(input)
    },
    async batchStart (input: SalaryProcessFileInput): Promise<SalaryProcessEligibilityResult> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/importExcel`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      return eligibilityResultOf(result)
    },
    async downloadBatchStopTemplate (): Promise<SalaryProcessFile> {
      return downloadFromUrl(request, `${ROOT}/stopdownload`, '批量停薪模板.xlsx')
    },
    prepareBatchStop (input: SalaryProcessFileInput): { fileName: string; contentType: string; byteLength: number } {
      return filePreviewOf(input)
    },
    async batchStop (input: SalaryProcessFileInput): Promise<string | null> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/stopBatch`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (result === undefined || result === null || result === '') return null
      return textOf(result, '批量停薪响应')
    },
  }
}

export type SalaryProcessCapability = ReturnType<typeof createSalaryProcessCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const statusOptions = [{ label: '已停薪', value: -1 }, { label: '未起薪', value: 0 }, { label: '已起薪', value: 1 }]
const staffStatusOptions = [1, 2, 3, 4, 5].map(value => ({ label: String(value), value }))
const salaryCategoryOptions = [{ label: '时薪', value: '1' }, { label: '日薪', value: '2' }, { label: '月薪', value: '3' }, { label: '年薪', value: '4' }]
const queryParams: ParamSpec[] = [
  p('orgIds', 'tree', false, '角色组织树多选ID；SDK按Portal转换为逗号字符串'),
  p('staffCode', 'text', false, '工号；Portal输入框原样提交'),
  p('staffStatus', 'enum', false, '在职状态字典值；空值不过滤', staffStatusOptions),
  p('status', 'enum', false, '薪资状态：-1已停薪、0未起薪、1已起薪；空值不过滤', statusOptions),
  p('staffName', 'text', false, '姓名'),
  p('businessDate', 'date', false, '业务日期；省略时使用当天'),
  p('pageNo', 'number'),
  p('pageSize', 'number'),
]
const formParams: ParamSpec[] = [
  p('id', 'text', false, '记录ID；起薪时可为空，编辑时必须来自详情'),
  p('transactTime', 'date', true, '起薪日期；Portal未设置required但Java服务端强制非空'),
  p('staffCode', 'text', true, '员工工号；起薪必填，来自列表/详情'),
  p('organization', 'text', false, '起薪组织ID；服务端会按员工当前组织重算'),
  p('ledgerId', 'text', true, '薪资账套ID'),
  p('status', 'enum', false, '回显状态；起薪不能是1，编辑必须是1', statusOptions),
  p('legalPersonId', 'text', true, '纳税单位ID'),
  p('costCenterId', 'text', true, '成本中心ID'),
  p('salaryCategory', 'enum', false, '薪制类别；可清空', salaryCategoryOptions),
  p('wage', 'number', false, '基本工资标准；页面字段当前隐藏，保留详情回显值'),
  p('salaryLevel', 'text', false, '薪资等级ID；可清空'),
  p('description', 'text', true, '起薪情况说明；最多200字'),
  p('isDel', 'number', false, '逻辑删除标记；详情回显字段'),
  p('creator', 'text', false, '创建人ID；详情回显字段'),
  p('createTime', 'text', false, '创建时间；详情回显字段'),
  p('updater', 'text', false, '修改人ID；详情回显字段'),
  p('updateTime', 'text', false, '修改时间；详情回显字段'),
  p('stopTime', 'date', false, '停薪日期；详情回显字段'),
  p('stopDescription', 'text', false, '停薪说明；详情回显字段'),
  p('emptyDate', 'text', false, '清纳税开始时间；详情回显字段'),
]
const updateFormParams: ParamSpec[] = formParams.map(parameter => {
  if (parameter.name === 'id') return { ...parameter, required: true, description: '已起薪记录ID；必须来自详情' }
  if (parameter.name === 'status') return { ...parameter, required: true, description: '必须为1（已起薪）' }
  if (parameter.name === 'staffCode') return { ...parameter, required: false, description: '详情回显员工工号；服务端编辑时不允许修改' }
  return parameter
})
const activeSelectionParams: ParamSpec[] = [p('idList', 'text', true, '当前选中行ID数组；不能重复'), p('currentStatuses', 'text', true, '与idList等长的最新状态数组；必须全部为1')]
const fileParams: ParamSpec[] = [p('fileName', 'text', true, '支持.xlsx或.xls'), p('base64', 'text', true, '非空标准Base64文件内容'), p('contentType', 'text', false, '文件MIME类型')]

export const SALARY_PROCESS_METHODS = {
  'salary-process-list': 'list',
  'salary-process-get': 'get',
  'salary-process-ledger-options': 'ledgerOptions',
  'salary-process-legal-person-options': 'legalPersonOptions',
  'salary-process-cost-center-options': 'costCenterOptions',
  'salary-process-salary-level-options': 'salaryLevelOptions',
  'salary-process-check-start': 'checkStart',
  'salary-process-prepare-start': 'prepareStart',
  'salary-process-start': 'start',
  'salary-process-prepare-update': 'prepareUpdate',
  'salary-process-update': 'update',
  'salary-process-prepare-stop': 'prepareStop',
  'salary-process-stop': 'stop',
  'salary-process-prepare-edit-legal-person': 'prepareEditLegalPerson',
  'salary-process-edit-legal-person': 'editLegalPerson',
  'salary-process-prepare-edit-cost-center': 'prepareEditCostCenter',
  'salary-process-edit-cost-center': 'editCostCenter',
  'salary-process-prepare-clear-tax-date': 'prepareClearTaxDate',
  'salary-process-clear-tax-date': 'clearTaxDate',
  'salary-process-export': 'export',
  'salary-process-download-batch-start-template': 'downloadBatchStartTemplate',
  'salary-process-prepare-batch-start': 'prepareBatchStart',
  'salary-process-batch-start': 'batchStart',
  'salary-process-download-batch-stop-template': 'downloadBatchStopTemplate',
  'salary-process-prepare-batch-stop': 'prepareBatchStop',
  'salary-process-batch-stop': 'batchStop',
} as const

const withPage = (definition: Pick<CapabilityDefinition, 'id' | 'title' | 'write' | 'params'>): CapabilityDefinition => ({
  ...definition,
  pagePath: SALARY_PROCESS_PAGE_PATH,
  permission: SALARY_PROCESS_PERMISSION,
  moduleType: SALARY_PROCESS_MODULE_TYPE,
  httpInstance: 'platform',
})

export const salaryProcessCapabilities: CapabilityDefinition[] = [
  { id: 'salary-process-list', title: '查询薪资办理', write: false, params: queryParams },
  { id: 'salary-process-get', title: '读取薪资办理详情', write: false, params: [p('id', 'text', false, '记录ID；与staffCode二选一'), p('staffCode', 'text', false, '员工工号；id为空时使用')] },
  { id: 'salary-process-ledger-options', title: '查询薪资办理账套候选', write: false, params: [] },
  { id: 'salary-process-legal-person-options', title: '查询薪资办理纳税单位候选', write: false, params: [] },
  { id: 'salary-process-cost-center-options', title: '查询薪资办理成本中心候选', write: false, params: [] },
  { id: 'salary-process-salary-level-options', title: '查询薪资办理薪资等级候选', write: false, params: [] },
  { id: 'salary-process-check-start', title: '校验薪资办理起薪条件', write: false, params: [p('id', 'text', false, '记录ID；未起薪新员工可省略')] },
  { id: 'salary-process-prepare-start', title: '准备薪资办理起薪', write: false, params: formParams },
  { id: 'salary-process-start', title: '起薪', write: true, params: formParams },
  { id: 'salary-process-prepare-update', title: '准备编辑薪资办理', write: false, params: updateFormParams },
  { id: 'salary-process-update', title: '编辑薪资办理', write: true, params: updateFormParams },
  { id: 'salary-process-prepare-stop', title: '准备停薪', write: false, params: [p('id', 'text', true, '已起薪记录ID'), p('stopTime', 'date', false, '停薪日期；省略时为当天'), p('stopDescription', 'text', true, '停薪说明')] },
  { id: 'salary-process-stop', title: '停薪', write: true, params: [p('id', 'text', true, '已起薪记录ID'), p('stopTime', 'date', false, '停薪日期；省略时为当天'), p('stopDescription', 'text', true, '停薪说明')] },
  { id: 'salary-process-prepare-edit-legal-person', title: '准备批量调整纳税单位', write: false, params: [...activeSelectionParams, p('legalPersonId', 'text', true, '纳税单位ID')] },
  { id: 'salary-process-edit-legal-person', title: '批量调整纳税单位', write: true, params: [...activeSelectionParams, p('legalPersonId', 'text', true, '纳税单位ID')] },
  { id: 'salary-process-prepare-edit-cost-center', title: '准备批量调整成本中心', write: false, params: [...activeSelectionParams, p('costCenterId', 'text', true, '成本中心ID')] },
  { id: 'salary-process-edit-cost-center', title: '批量调整成本中心', write: true, params: [...activeSelectionParams, p('costCenterId', 'text', true, '成本中心ID')] },
  { id: 'salary-process-prepare-clear-tax-date', title: '准备清空纳税开始时间', write: false, params: [...activeSelectionParams, p('emptyDate', 'date', true, '月份YYYY-MM')] },
  { id: 'salary-process-clear-tax-date', title: '清空纳税开始时间', write: true, params: [...activeSelectionParams, p('emptyDate', 'date', true, '月份YYYY-MM')] },
  { id: 'salary-process-export', title: '导出薪资办理', write: false, params: [...queryParams.filter(item => !['pageNo', 'pageSize'].includes(item.name)), p('selectedStaffCodes', 'text', false, '跨页选中的员工工号数组；非空时覆盖筛选条件')] },
  { id: 'salary-process-download-batch-start-template', title: '下载批量起薪模板', write: false, params: [] },
  { id: 'salary-process-prepare-batch-start', title: '准备批量起薪文件', write: false, params: fileParams },
  { id: 'salary-process-batch-start', title: '批量起薪', write: true, params: fileParams },
  { id: 'salary-process-download-batch-stop-template', title: '下载批量停薪模板', write: false, params: [] },
  { id: 'salary-process-prepare-batch-stop', title: '准备批量停薪文件', write: false, params: fileParams },
  { id: 'salary-process-batch-stop', title: '批量停薪', write: true, params: fileParams },
].map(withPage)
