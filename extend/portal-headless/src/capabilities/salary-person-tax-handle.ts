import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「薪资管理 → 个税专项扣款 → 扣款办理」。 */
export const SALARY_PERSON_TAX_HANDLE_PAGE_PATH = '/dashboard/salary/person-tax-handle/list'
export const SALARY_PERSON_TAX_HANDLE_PERMISSION = '/dashboard/salary/person-tax-handle'
export const SALARY_PERSON_TAX_HANDLE_MODULE_TYPE = 14

const ROOT = '/salary/salarypersontaxForecast'
const STAFF_ELIGIBILITY_URL = '/salary/staff-eligibility/check'

export type SalaryPersonTaxHandleId = string | number
export type SalaryPersonTaxHandleDateRange = readonly [string | null | undefined, string | null | undefined] | readonly string[]
export type SalaryPersonTaxHandleQuery = {
  name?: string | null
  staffCode?: SalaryPersonTaxHandleId | null
  idCard?: string | null
  pageNo?: number
  pageSize?: number
  order?: string | null
  orderField?: string | null
}

export type SalaryPersonTaxHandleSpecial = Record<string, unknown> & {
  id?: SalaryPersonTaxHandleId | null
  taxId?: SalaryPersonTaxHandleId | null
  specialType?: string | null
  amount?: number | string | null
  costStart?: string | null
  costEnd?: string | null
  costTime?: string[]
  isDel?: number | null
  creator?: SalaryPersonTaxHandleId | null
  createTime?: string | number | null
  updater?: SalaryPersonTaxHandleId | null
  updateTime?: string | number | null
}

export type SalaryPersonTaxHandleRow = Record<string, unknown> & {
  id: SalaryPersonTaxHandleId
  staffCode: SalaryPersonTaxHandleId | null
  staffName: string | null
  idCard: string | null
  organizationName: string | null
  postName: string | null
  status: 0 | 1 | null
  isDel: number | null
  creator: SalaryPersonTaxHandleId | null
  createTime: string | number | null
  updater: SalaryPersonTaxHandleId | null
  updaterName: string | null
  updateTime: string | number | null
  specialList: SalaryPersonTaxHandleSpecial[]
}

export type SalaryPersonTaxHandleForm = Record<string, unknown> & {
  id?: SalaryPersonTaxHandleId | null
  staffCode: string | number
  staffName: string
  idCard: string
  status: 0 | 1
  specialList: SalaryPersonTaxHandleSpecial[]
}

export type SalaryPersonTaxHandleFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type SalaryPersonTaxHandleFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type SalaryPersonTaxHandleFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type SalaryPersonTaxHandleEligibilityResult = {
  processedIds: SalaryPersonTaxHandleId[]
  processedStaffCodes: SalaryPersonTaxHandleId[]
  processedCount: number
  eligibleStaffIds: SalaryPersonTaxHandleId[]
  eligibleStaffCodes: SalaryPersonTaxHandleId[]
  excludedStaffList: Array<Record<string, unknown>>
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryPersonTaxHandleId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryPersonTaxHandleId | null {
  return value === undefined || value === null || value === '' ? null : idOf(value, label)
}

function textOf (value: unknown, label: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function amountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function amountInputOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return value === '' ? '' : null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100) throw new Error(`${label}必须为非负且最多两位小数的金额`)
    return value
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return value
  throw new Error(`${label}必须为非负且最多两位小数的金额`)
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function dateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD或null`)
  return value
}

function statusOf (value: unknown, label = 'status'): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（已失效）或1（生效中）`)
  return value
}

function nullableStatusOf (value: unknown, label: string): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  return statusOf(value, label)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数或null`)
  return value as number
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function dateRangeOf (value: unknown, label: string): [string | null, string | null] {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return [null, null]
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是两个日期的数组`)
  return [dateOf(value[0], `${label}[0]`), dateOf(value[1], `${label}[1]`)]
}

function monthStartOf (value: string): string {
  return `${value.slice(0, 7)}-01`
}

function monthEndOf (value: string): string {
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${value.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

function costDatesOf (value: unknown, label: string): [string | null, string | null] {
  const range = dateRangeOf(value, label)
  return range[0] && range[1] ? [monthStartOf(range[0]), monthEndOf(range[1])] : [null, null]
}

function listParamsOf (query: SalaryPersonTaxHandleQuery = {}): Record<string, unknown> {
  const name = query.name === undefined || query.name === null ? '' : textOf(query.name, 'name')
  const staffCode = query.staffCode === undefined || query.staffCode === null || query.staffCode === '' ? '' : idOf(query.staffCode, 'staffCode')
  const idCard = query.idCard === undefined || query.idCard === null ? '' : textOf(query.idCard, 'idCard')
  return {
    order: query.order === undefined || query.order === null ? '' : textOf(query.order, 'order'),
    orderField: query.orderField === undefined || query.orderField === null ? '' : textOf(query.orderField, 'orderField'),
    name,
    staffCode,
    idCard,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function specialRowOf (value: unknown, label: string, form = false): SalaryPersonTaxHandleSpecial {
  const row = objectOf(value, label)
  const costStart = dateOf(row.costStart, `${label}.costStart`)
  const costEnd = dateOf(row.costEnd, `${label}.costEnd`)
  const costTime = form ? (costStart && costEnd ? [costStart, costEnd] as [string, string] : []) : undefined
  const { costStart: _costStart, costEnd: _costEnd, ...formRow } = row
  return {
    ...(form ? formRow : row),
    id: optionalIdOf(row.id, `${label}.id`),
    taxId: optionalIdOf(row.taxId, `${label}.taxId`),
    specialType: nullableTextOf(row.specialType, `${label}.specialType`),
    amount: amountOf(row.amount, `${label}.amount`),
    ...(form ? { costTime } : { costStart, costEnd }),
    isDel: integerOf(row.isDel, `${label}.isDel`),
    creator: optionalIdOf(row.creator, `${label}.creator`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updater: optionalIdOf(row.updater, `${label}.updater`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
  }
}

function specialListOf (value: unknown, label: string, form = false): SalaryPersonTaxHandleSpecial[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => specialRowOf(item, `${label}[${index}]`, form))
}

function rowOf (value: unknown, index: number): SalaryPersonTaxHandleRow {
  const row = objectOf(value, `扣款办理列表[${index}]`)
  const status = nullableStatusOf(row.status, `扣款办理列表[${index}].status`)
  return {
    ...row,
    id: idOf(row.id, `扣款办理列表[${index}].id`),
    staffCode: optionalIdOf(row.staffCode, `扣款办理列表[${index}].staffCode`),
    staffName: nullableTextOf(row.staffName, `扣款办理列表[${index}].staffName`),
    idCard: nullableTextOf(row.idCard, `扣款办理列表[${index}].idCard`),
    organizationName: nullableTextOf(row.organizationName, `扣款办理列表[${index}].organizationName`),
    postName: nullableTextOf(row.postName, `扣款办理列表[${index}].postName`),
    status,
    isDel: integerOf(row.isDel, `扣款办理列表[${index}].isDel`),
    creator: optionalIdOf(row.creator, `扣款办理列表[${index}].creator`),
    createTime: dateTimeOf(row.createTime, `扣款办理列表[${index}].createTime`),
    updater: optionalIdOf(row.updater, `扣款办理列表[${index}].updater`),
    updaterName: nullableTextOf(row.updaterName, `扣款办理列表[${index}].updaterName`),
    updateTime: dateTimeOf(row.updateTime, `扣款办理列表[${index}].updateTime`),
    specialList: specialListOf(row.specialList ?? [], `扣款办理列表[${index}].specialList`),
  }
}

function pageOf (value: unknown): PageResult<SalaryPersonTaxHandleRow> {
  const page = objectOf(value, '扣款办理分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('扣款办理分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total }
}

function formOf (input: unknown, mode: 'create' | 'update'): SalaryPersonTaxHandleForm & JsonObject {
  const value = objectOf(input, '扣款办理表单')
  const id = value.id === undefined || value.id === null || value.id === '' ? null : idOf(value.id, 'id')
  if (mode === 'update' && id === null) throw new Error('编辑扣款办理必须提供id')
  if (mode === 'create' && id !== null) throw new Error('新建扣款办理不应提供id')
  const staffCode = idOf(value.staffCode, 'staffCode')
  const status = statusOf(value.status)
  const specialList = specialListOf(value.specialList, 'specialList', false)
  if (specialList.length !== 7) throw new Error('specialList必须包含Portal表单的7个专项类型')
  const rawSpecialList = value.specialList
  if (!Array.isArray(rawSpecialList)) throw new Error('specialList必须为数组')
  const seen = new Set<string>()
  const payloadSpecialList = specialList.map((row, index) => {
    const specialType = row.specialType
    if (!specialType || !['1', '2', '3', '4', '5', '6', '7'].includes(specialType) || seen.has(specialType)) throw new Error(`specialList[${index}].specialType必须为不重复的1至7`)
    seen.add(specialType)
    const source = objectOf(rawSpecialList[index], `specialList[${index}]`)
    const [costStart, costEnd] = costDatesOf(source.costTime, `specialList[${index}].costTime`)
    const { costTime: _costTime, costStart: _costStart, costEnd: _costEnd, ...rest } = source
    return {
      ...rest,
      specialType,
      amount: amountInputOf(source.amount, `specialList[${index}].amount`),
      costStart,
      costEnd,
    }
  })
  const payload: JsonObject = {
    ...value,
    staffCode,
    staffName: textOf(value.staffName, 'staffName'),
    idCard: textOf(value.idCard, 'idCard'),
    status,
    specialList: payloadSpecialList,
  }
  if (mode === 'create') delete payload.id
  return payload as SalaryPersonTaxHandleForm & JsonObject
}

function formResponseOf (value: unknown): SalaryPersonTaxHandleForm {
  const row = objectOf(value, '扣款办理详情')
  const staffCode = idOf(row.staffCode, 'staffCode')
  const status = statusOf(row.status)
  return {
    ...row,
    staffCode: String(staffCode),
    staffName: textOf(row.staffName, 'staffName'),
    idCard: textOf(row.idCard, 'idCard'),
    status,
    specialList: specialListOf(row.specialList, 'specialList', true),
  } as SalaryPersonTaxHandleForm
}

function idsOf (value: unknown, label: string): SalaryPersonTaxHandleId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}不能为空数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function fileBytesOf (input: SalaryPersonTaxHandleFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '扣款办理导入文件')
  const fileName = textOf(value.fileName, 'fileName')
  if (!fileName.trim() || !/\.xlsx$/i.test(fileName)) throw new Error('fileName必须以.xlsx结尾')
  const contentType = value.contentType === undefined || value.contentType === null || value.contentType === ''
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : textOf(value.contentType, 'contentType')
  if (contentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') throw new Error('contentType必须是标准xlsx MIME')
  const base64 = textOf(value.base64, 'base64')
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) throw new Error('base64必须是非空标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('文件内容不能为空')
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: SalaryPersonTaxHandleFileInput): SalaryPersonTaxHandleFilePreview {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ''))
    } catch {
      return encoded
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): SalaryPersonTaxHandleFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('扣款办理导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, fallback),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function eligibilityResultOf (value: unknown): SalaryPersonTaxHandleEligibilityResult {
  const result = objectOf(value, '员工薪资业务资格回执')
  const listOf = (name: string): unknown[] => {
    const list = result[name]
    if (list === undefined || list === null) return []
    if (!Array.isArray(list)) throw new Error(`员工薪资业务资格回执.${name}必须为数组`)
    return list
  }
  const ids = (name: string): SalaryPersonTaxHandleId[] => listOf(name).map((item, index) => idOf(item, `${name}[${index}]`))
  const processedCount = result.processedCount === undefined || result.processedCount === null ? 0 : result.processedCount
  if (typeof processedCount !== 'number' || !Number.isSafeInteger(processedCount) || processedCount < 0) throw new Error('员工薪资业务资格回执.processedCount必须为非负整数')
  return {
    processedIds: ids('processedIds'),
    processedStaffCodes: ids('processedStaffCodes'),
    processedCount,
    eligibleStaffIds: ids('eligibleStaffIds'),
    eligibleStaffCodes: ids('eligibleStaffCodes'),
    excludedStaffList: listOf('excludedStaffList').map((item, index) => ({ ...objectOf(item, `excludedStaffList[${index}]`) })),
  }
}

export function createSalaryPersonTaxHandleCapability (request: PortalRequest) {
  return {
    async list (query: SalaryPersonTaxHandleQuery = {}): Promise<PageResult<SalaryPersonTaxHandleRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: SalaryPersonTaxHandleId }): Promise<SalaryPersonTaxHandleForm> {
      return formResponseOf(await request<unknown>({ url: `${ROOT}/${idOf(input?.id, 'id')}`, method: 'get' }))
    },
    prepareCreate (input: SalaryPersonTaxHandleForm): { draft: JsonObject } {
      return { draft: formOf(input, 'create') }
    },
    async create (input: SalaryPersonTaxHandleForm): Promise<void> {
      await request({ url: ROOT, method: 'post', data: formOf(input, 'create') })
    },
    prepareUpdate (input: SalaryPersonTaxHandleForm): { draft: JsonObject } {
      return { draft: formOf(input, 'update') }
    },
    async update (input: SalaryPersonTaxHandleForm): Promise<void> {
      await request({ url: ROOT, method: 'put', data: formOf(input, 'update') })
    },
    prepareRemove (input: { ids: SalaryPersonTaxHandleId[] }): { draft: SalaryPersonTaxHandleId[] } {
      return { draft: idsOf(input?.ids, 'ids') }
    },
    async remove (input: { ids: SalaryPersonTaxHandleId[] }): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: idsOf(input?.ids, 'ids') })
    },
    prepareImport (input: SalaryPersonTaxHandleFileInput): SalaryPersonTaxHandleFilePreview {
      return filePreviewOf(input)
    },
    async importExcel (input: SalaryPersonTaxHandleFileInput): Promise<string | null> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (result === undefined || result === null || result === '') return null
      if (typeof result !== 'string') throw new Error('扣款办理导入响应必须是字符串或null')
      return result
    },
    async downloadTemplate (): Promise<SalaryPersonTaxHandleFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/download`, method: 'get', params: { fileName: '个税专项扣款导入模板' }, responseType: 'arraybuffer' }), '个税专项扣款导入模板.xlsx')
    },
    async export (input: { ids?: SalaryPersonTaxHandleId[] | null } = {}): Promise<SalaryPersonTaxHandleFile> {
      const ids = input.ids === undefined || input.ids === null ? [] : Array.isArray(input.ids) ? input.ids.map((item, index) => idOf(item, `ids[${index}]`)) : (() => { throw new Error('ids必须为ID数组') })()
      if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复ID')
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: { idList: ids.join(',') }, responseType: 'arraybuffer' }), '个税专项扣款.xls')
    },
    async eligibilityCheck (input: { staffCodes: SalaryPersonTaxHandleId[]; businessDate: string }): Promise<SalaryPersonTaxHandleEligibilityResult> {
      const staffCodes = idsOf(input?.staffCodes, 'staffCodes')
      const businessDate = dateOf(input?.businessDate, 'businessDate')
      if (!businessDate) throw new Error('businessDate不能为空')
      return eligibilityResultOf(await request<unknown>({ url: STAFF_ELIGIBILITY_URL, method: 'post', data: { staffCodes, businessDate } }))
    },
  }
}

export type SalaryPersonTaxHandleCapability = ReturnType<typeof createSalaryPersonTaxHandleCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const pageParams: ParamSpec[] = [p('name', 'text', false, '姓名模糊筛选'), p('staffCode', 'text', false, '工号模糊筛选'), p('idCard', 'text', false, '身份证号模糊筛选'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')]
const formParams: ParamSpec[] = [p('staffCode', 'text', true, '员工工号；候选应来自已核实的员工结果'), p('staffName', 'text', false, 'Portal表单提交的姓名快照'), p('idCard', 'text', false, 'Portal表单提交的身份证号快照'), p('status', 'enum', true, '0已失效、1生效中'), p('specialList', 'text', true, '固定7个专项类型及金额、月份区间；提交时转换为costStart/costEnd')]
const idsParams: ParamSpec[] = [p('ids', 'text', true, '非空记录ID数组')]
const fileParams: ParamSpec[] = [p('fileName', 'text', true, 'xlsx文件名'), p('base64', 'text', true, 'xlsx文件内容Base64'), p('contentType', 'text', false, '必须为标准xlsx MIME')]

export const SALARY_PERSON_TAX_HANDLE_METHODS = {
  'salary-person-tax-handle-list': 'list',
  'salary-person-tax-handle-get': 'get',
  'salary-person-tax-handle-prepare-create': 'prepareCreate',
  'salary-person-tax-handle-create': 'create',
  'salary-person-tax-handle-prepare-update': 'prepareUpdate',
  'salary-person-tax-handle-update': 'update',
  'salary-person-tax-handle-prepare-remove': 'prepareRemove',
  'salary-person-tax-handle-remove': 'remove',
  'salary-person-tax-handle-prepare-import': 'prepareImport',
  'salary-person-tax-handle-import': 'importExcel',
  'salary-person-tax-handle-download-template': 'downloadTemplate',
  'salary-person-tax-handle-export': 'export',
  'salary-person-tax-handle-eligibility-check': 'eligibilityCheck',
} as const

export const salaryPersonTaxHandleCapabilities: CapabilityDefinition[] = [
  { id: 'salary-person-tax-handle-list', title: '查询扣款办理', write: false, params: pageParams },
  { id: 'salary-person-tax-handle-get', title: '读取扣款办理详情', write: false, params: [p('id', 'text', true, '扣款办理主记录ID')] },
  { id: 'salary-person-tax-handle-prepare-create', title: '准备新建扣款办理', write: false, params: formParams },
  { id: 'salary-person-tax-handle-create', title: '新建扣款办理', write: true, params: formParams },
  { id: 'salary-person-tax-handle-prepare-update', title: '准备修改扣款办理', write: false, params: [p('id', 'text', true, '扣款办理主记录ID'), ...formParams] },
  { id: 'salary-person-tax-handle-update', title: '修改扣款办理', write: true, params: [p('id', 'text', true, '扣款办理主记录ID'), ...formParams] },
  { id: 'salary-person-tax-handle-prepare-remove', title: '准备删除扣款办理', write: false, params: idsParams },
  { id: 'salary-person-tax-handle-remove', title: '删除扣款办理', write: true, params: idsParams },
  { id: 'salary-person-tax-handle-prepare-import', title: '准备导入扣款办理', write: false, params: fileParams },
  { id: 'salary-person-tax-handle-import', title: '导入扣款办理', write: true, params: fileParams },
  { id: 'salary-person-tax-handle-download-template', title: '下载扣款办理导入模板', write: false, params: [] },
  { id: 'salary-person-tax-handle-export', title: '导出扣款办理', write: false, params: [p('ids', 'text', false, '选中的记录ID数组；为空时Portal请求导出授权范围')] },
  { id: 'salary-person-tax-handle-eligibility-check', title: '检查扣款办理员工资格', write: false, params: [p('staffCodes', 'text', true, '已核实的员工工号数组'), p('businessDate', 'date', true, '资格检查业务日期')] },
].map(definition => ({
  ...definition,
  pagePath: SALARY_PERSON_TAX_HANDLE_PAGE_PATH,
  permission: SALARY_PERSON_TAX_HANDLE_PERMISSION,
  moduleType: SALARY_PERSON_TAX_HANDLE_MODULE_TYPE,
  httpInstance: 'platform',
}))
