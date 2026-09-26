import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「薪资管理 → 个税专项扣款 → 扣款费用」。 */
export const SALARY_PERSON_TAX_PAGE_PATH = '/dashboard/salary/person-tax/list'
export const SALARY_PERSON_TAX_PERMISSION = '/dashboard/salary/person-tax'
export const SALARY_PERSON_TAX_MODULE_TYPE = 14

const ROOT = '/salary/salarypersontax'
const STAFF_ELIGIBILITY_URL = '/salary/staff-eligibility/check'

export type SalaryPersonTaxId = string | number
export type SalaryPersonTaxMonthRange = readonly [string | null | undefined, string | null | undefined] | readonly string[]
export type SalaryPersonTaxQuery = {
  name?: string | null
  staffCode?: SalaryPersonTaxId | null
  idCard?: string | null
  archiveStatus?: 1 | 2 | null
  orgId?: SalaryPersonTaxId | null
  costDate?: SalaryPersonTaxMonthRange | null
  pageNo?: number
  pageSize?: number
}

export type SalaryPersonTaxExpenseSpecial = Record<string, unknown> & {
  id?: SalaryPersonTaxId | null
  taxId?: SalaryPersonTaxId | null
  specialType?: string | null
  amount?: number | string | null
  costStart?: string | null
  costEnd?: string | null
  costTime?: string[]
  archiveStatus?: 1 | 2 | null
  isDel?: number | null
  creator?: SalaryPersonTaxId | null
  createTime?: string | number | null
  updater?: SalaryPersonTaxId | null
  updateTime?: string | number | null
}

export type SalaryPersonTaxRow = Record<string, unknown> & {
  id: SalaryPersonTaxId
  staffCode: SalaryPersonTaxId | null
  staffName: string | null
  idCard: string | null
  organizationName: string | null
  postName: string | null
  archiveStatus: 1 | 2 | null
  createTime: string | number | null
  updaterName: string | null
  costDate: string | null
  specialList: SalaryPersonTaxExpenseSpecial[]
}

export type SalaryPersonTaxSummary = Record<string, unknown> & {
  childEducation: number | string | null
  housingRent: number | string | null
  housingLoanInterest: number | string | null
  elderlyCare: number | string | null
  continuingEducation: number | string | null
  infantCare: number | string | null
  sickChildEducation: number | string | null
}

export type SalaryPersonTaxPage = {
  list: SalaryPersonTaxRow[]
  total: number
  summary: SalaryPersonTaxSummary
}

export type SalaryPersonTaxForm = Record<string, unknown> & {
  id: SalaryPersonTaxId
  staffCode: string | number
  staffName: string
  idCard: string
  archiveStatus: 1 | 2
  costDate?: string | null
  specialList: SalaryPersonTaxExpenseSpecial[]
}

export type SalaryPersonTaxExpenseFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type SalaryPersonTaxExpenseFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type SalaryPersonTaxExpenseFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type SalaryPersonTaxExpenseEligibilityResult = {
  processedIds: SalaryPersonTaxId[]
  processedStaffCodes: SalaryPersonTaxId[]
  processedCount: number
  eligibleStaffIds: SalaryPersonTaxId[]
  eligibleStaffCodes: SalaryPersonTaxId[]
  excludedStaffList: Array<Record<string, unknown>>
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryPersonTaxId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryPersonTaxId | null {
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

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM或null`)
  return value
}

function archiveStatusOf (value: unknown, label = 'archiveStatus'): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error(`${label}只能是数值1（未归档）或2（已归档）`)
  return value
}

function nullableArchiveStatusOf (value: unknown, label: string): 1 | 2 | null {
  if (value === undefined || value === null || value === '') return null
  return archiveStatusOf(value, label)
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

function monthRangeOf (value: SalaryPersonTaxMonthRange | null | undefined): [string, string] {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return ['', '']
  if (!Array.isArray(value) || value.length !== 2) throw new Error('costDate必须是两个月份的数组')
  return [monthOf(value[0], 'costDate[0]') ?? '', monthOf(value[1], 'costDate[1]') ?? '']
}

function listParamsOf (query: SalaryPersonTaxQuery = {}): Record<string, unknown> {
  const [costDateStart, costDateEnd] = monthRangeOf(query.costDate)
  const name = query.name === undefined || query.name === null ? '' : textOf(query.name, 'name')
  const staffCode = query.staffCode === undefined || query.staffCode === null || query.staffCode === '' ? '' : idOf(query.staffCode, 'staffCode')
  const idCard = query.idCard === undefined || query.idCard === null ? '' : textOf(query.idCard, 'idCard')
  const orgId = query.orgId === undefined || query.orgId === null || query.orgId === '' ? '' : idOf(query.orgId, 'orgId')
  const archiveStatus = query.archiveStatus ?? 1
  return {
    name,
    staffCode,
    idCard,
    archiveStatus: archiveStatusOf(archiveStatus),
    orgId,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
    costDateStart,
    costDateEnd,
    order: 'desc',
    orderField: 'id',
  }
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

function specialOf (value: unknown, label: string, form = false): SalaryPersonTaxExpenseSpecial {
  const row = objectOf(value, label)
  const costStart = dateOf(row.costStart, `${label}.costStart`)
  const costEnd = dateOf(row.costEnd, `${label}.costEnd`)
  const archiveStatus = nullableArchiveStatusOf(row.archiveStatus, `${label}.archiveStatus`)
  const costTime = form ? (costStart && costEnd ? [costStart, costEnd] : []) : undefined
  const { costStart: _costStart, costEnd: _costEnd, ...formRow } = row
  return {
    ...(form ? formRow : row),
    id: optionalIdOf(row.id, `${label}.id`),
    taxId: optionalIdOf(row.taxId, `${label}.taxId`),
    specialType: nullableTextOf(row.specialType, `${label}.specialType`),
    amount: amountOf(row.amount, `${label}.amount`),
    ...(form ? { costTime } : { costStart, costEnd }),
    archiveStatus,
    isDel: integerOf(row.isDel, `${label}.isDel`),
    creator: optionalIdOf(row.creator, `${label}.creator`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updater: optionalIdOf(row.updater, `${label}.updater`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
  }
}

function specialListOf (value: unknown, label: string, form = false): SalaryPersonTaxExpenseSpecial[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => specialOf(item, `${label}[${index}]`, form))
}

function rowOf (value: unknown, index: number): SalaryPersonTaxRow {
  const row = objectOf(value, `扣款费用列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `扣款费用列表[${index}].id`),
    staffCode: optionalIdOf(row.staffCode, `扣款费用列表[${index}].staffCode`),
    staffName: nullableTextOf(row.staffName, `扣款费用列表[${index}].staffName`),
    idCard: nullableTextOf(row.idCard, `扣款费用列表[${index}].idCard`),
    organizationName: nullableTextOf(row.organizationName, `扣款费用列表[${index}].organizationName`),
    postName: nullableTextOf(row.postName, `扣款费用列表[${index}].postName`),
    archiveStatus: nullableArchiveStatusOf(row.archiveStatus, `扣款费用列表[${index}].archiveStatus`),
    createTime: dateTimeOf(row.createTime, `扣款费用列表[${index}].createTime`),
    updaterName: nullableTextOf(row.updaterName, `扣款费用列表[${index}].updaterName`),
    costDate: monthOf(row.costDate, `扣款费用列表[${index}].costDate`),
    specialList: specialListOf(row.specialList ?? [], `扣款费用列表[${index}].specialList`),
  }
}

function summaryOf (value: unknown): SalaryPersonTaxSummary {
  const summary = objectOf(value, '扣款费用合计')
  return {
    ...summary,
    childEducation: amountOf(summary.childEducation, '扣款费用合计.childEducation'),
    housingRent: amountOf(summary.housingRent, '扣款费用合计.housingRent'),
    housingLoanInterest: amountOf(summary.housingLoanInterest, '扣款费用合计.housingLoanInterest'),
    elderlyCare: amountOf(summary.elderlyCare, '扣款费用合计.elderlyCare'),
    continuingEducation: amountOf(summary.continuingEducation, '扣款费用合计.continuingEducation'),
    infantCare: amountOf(summary.infantCare, '扣款费用合计.infantCare'),
    sickChildEducation: amountOf(summary.sickChildEducation, '扣款费用合计.sickChildEducation'),
  }
}

function pageOf (value: unknown): SalaryPersonTaxPage {
  const page = objectOf(value, '扣款费用分页响应')
  const listPage = objectOf(page.list, '扣款费用分页响应.list')
  if (!Array.isArray(listPage.list) || typeof listPage.total !== 'number' || !Number.isSafeInteger(listPage.total) || listPage.total < 0) throw new Error('扣款费用分页响应缺少有效list或total')
  return { list: listPage.list.map((item, index) => rowOf(item, index)), total: listPage.total, summary: summaryOf(page.total) }
}

function formOf (input: unknown): SalaryPersonTaxForm & JsonObject {
  const value = objectOf(input, '扣款费用表单')
  const id = idOf(value.id, 'id')
  const staffCode = idOf(value.staffCode, 'staffCode')
  const archiveStatus = archiveStatusOf(value.archiveStatus)
  const rawSpecialList = value.specialList
  const specialList = specialListOf(rawSpecialList, 'specialList', false)
  if (specialList.length !== 7) throw new Error('specialList必须包含Portal表单的7个专项类型')
  if (!Array.isArray(rawSpecialList)) throw new Error('specialList必须为数组')
  const seen = new Set<string>()
  const payloadSpecialList = specialList.map((row, index) => {
    const specialType = row.specialType
    if (!specialType || !['1', '2', '3', '4', '5', '6', '7'].includes(specialType) || seen.has(specialType)) throw new Error(`specialList[${index}].specialType必须为不重复的1至7`)
    seen.add(specialType)
    const source = objectOf(rawSpecialList[index], `specialList[${index}]`)
    const [costStart, costEnd] = costDatesOf(source.costTime, `specialList[${index}].costTime`)
    const { costTime: _costTime, costStart: _sourceCostStart, costEnd: _sourceCostEnd, ...rest } = source
    return {
      ...rest,
      specialType,
      amount: amountInputOf(source.amount, `specialList[${index}].amount`),
      costStart,
      costEnd,
    }
  })
  return {
    ...value,
    id,
    staffCode,
    staffName: textOf(value.staffName, 'staffName'),
    idCard: textOf(value.idCard, 'idCard'),
    archiveStatus,
    specialList: payloadSpecialList,
  } as SalaryPersonTaxForm & JsonObject
}

function formResponseOf (value: unknown): SalaryPersonTaxForm {
  const row = objectOf(value, '扣款费用详情')
  return {
    ...row,
    id: idOf(row.id, 'id'),
    staffCode: String(idOf(row.staffCode, 'staffCode')),
    staffName: textOf(row.staffName, 'staffName'),
    idCard: textOf(row.idCard, 'idCard'),
    archiveStatus: archiveStatusOf(row.archiveStatus),
    costDate: monthOf(row.costDate, 'costDate'),
    specialList: specialListOf(row.specialList, 'specialList', true),
  } as SalaryPersonTaxForm
}

function idsOf (value: unknown, label: string): SalaryPersonTaxId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}不能为空数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function fileBytesOf (input: SalaryPersonTaxExpenseFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '扣款费用导入文件')
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

function filePreviewOf (input: SalaryPersonTaxExpenseFileInput): SalaryPersonTaxExpenseFilePreview {
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

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): SalaryPersonTaxExpenseFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('扣款费用导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, fallback),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function eligibilityResultOf (value: unknown): SalaryPersonTaxExpenseEligibilityResult {
  const result = objectOf(value, '员工薪资业务资格回执')
  const listOf = (name: string): unknown[] => {
    const list = result[name]
    if (list === undefined || list === null) return []
    if (!Array.isArray(list)) throw new Error(`员工薪资业务资格回执.${name}必须为数组`)
    return list
  }
  const ids = (name: string): SalaryPersonTaxId[] => listOf(name).map((item, index) => idOf(item, `${name}[${index}]`))
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

export function createSalaryPersonTaxCapability (request: PortalRequest) {
  return {
    async list (query: SalaryPersonTaxQuery = {}): Promise<SalaryPersonTaxPage> {
      return pageOf(await request<unknown>({ url: `${ROOT}/pageNew`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: SalaryPersonTaxId }): Promise<SalaryPersonTaxForm> {
      return formResponseOf(await request<unknown>({ url: `${ROOT}/${idOf(input?.id, 'id')}`, method: 'get' }))
    },
    prepareUpdate (input: SalaryPersonTaxForm): { draft: JsonObject } {
      return { draft: formOf(input) }
    },
    async update (input: SalaryPersonTaxForm): Promise<void> {
      await request({ url: ROOT, method: 'put', data: formOf(input) })
    },
    prepareRemove (input: { ids: SalaryPersonTaxId[] }): { draft: SalaryPersonTaxId[] } {
      return { draft: idsOf(input?.ids, 'ids') }
    },
    async remove (input: { ids: SalaryPersonTaxId[] }): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: idsOf(input?.ids, 'ids') })
    },
    prepareImport (input: SalaryPersonTaxExpenseFileInput): SalaryPersonTaxExpenseFilePreview {
      return filePreviewOf(input)
    },
    async importExcel (input: SalaryPersonTaxExpenseFileInput): Promise<SalaryPersonTaxExpenseEligibilityResult> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      return eligibilityResultOf(await request<unknown>({ url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }))
    },
    async downloadTemplate (): Promise<SalaryPersonTaxExpenseFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/download`, method: 'get', params: { fileName: '个税专项扣款归档导入模板' }, responseType: 'arraybuffer' }), '个税专项扣款归档导入模板.xlsx')
    },
    async export (input: { ids?: SalaryPersonTaxId[] | null } = {}): Promise<SalaryPersonTaxExpenseFile> {
      const ids = input.ids === undefined || input.ids === null ? [] : Array.isArray(input.ids) ? input.ids.map((item, index) => idOf(item, `ids[${index}]`)) : (() => { throw new Error('ids必须为ID数组') })()
      if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复ID')
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: { idList: ids.join(',') }, responseType: 'arraybuffer' }), '个税专项扣款.xls')
    },
    prepareArchive (input: { ids: SalaryPersonTaxId[] }): { draft: { ids: SalaryPersonTaxId[]; status: 2 } } {
      return { draft: { ids: idsOf(input?.ids, 'ids'), status: 2 } }
    },
    async archive (input: { ids: SalaryPersonTaxId[] }): Promise<SalaryPersonTaxExpenseEligibilityResult> {
      const ids = idsOf(input?.ids, 'ids')
      return eligibilityResultOf(await request<unknown>({ url: `${ROOT}/updateArchive`, method: 'post', data: { ids, status: 2 } }))
    },
    async eligibilityCheck (input: { staffCodes: SalaryPersonTaxId[]; businessDate: string }): Promise<SalaryPersonTaxExpenseEligibilityResult> {
      const staffCodes = idsOf(input?.staffCodes, 'staffCodes')
      const businessDate = dateOf(input?.businessDate, 'businessDate')
      if (!businessDate) throw new Error('businessDate不能为空')
      return eligibilityResultOf(await request<unknown>({ url: STAFF_ELIGIBILITY_URL, method: 'post', data: { staffCodes, businessDate } }))
    },
  }
}

export type SalaryPersonTaxCapability = ReturnType<typeof createSalaryPersonTaxCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const pageParams: ParamSpec[] = [p('name', 'text', false, '姓名模糊筛选'), p('staffCode', 'text', false, '工号模糊筛选'), p('idCard', 'text', false, '身份证号模糊筛选'), p('archiveStatus', 'enum', false, '1未归档、2已归档；默认1'), p('orgId', 'text', false, '角色组织树节点ID'), p('costDate', 'date', false, '月份范围YYYY-MM'), p('pageNo', 'number'), p('pageSize', 'number')]
const formParams: ParamSpec[] = [p('id', 'text', true, '扣款主记录ID'), p('staffCode', 'text', true, '员工工号'), p('staffName', 'text', false, '员工姓名快照'), p('idCard', 'text', false, '员工身份证号快照'), p('archiveStatus', 'enum', true, '1未归档、2已归档'), p('specialList', 'text', true, '固定7个专项类型及金额、月份区间；提交时转换为costStart/costEnd')]
const idsParams: ParamSpec[] = [p('ids', 'text', true, '非空且不重复记录ID数组')]
const fileParams: ParamSpec[] = [p('fileName', 'text', true, 'xlsx文件名'), p('base64', 'text', true, 'xlsx文件内容Base64'), p('contentType', 'text', false, '必须为标准xlsx MIME')]

export const SALARY_PERSON_TAX_METHODS = {
  'salary-person-tax-list': 'list',
  'salary-person-tax-get': 'get',
  'salary-person-tax-prepare-update': 'prepareUpdate',
  'salary-person-tax-update': 'update',
  'salary-person-tax-prepare-remove': 'prepareRemove',
  'salary-person-tax-remove': 'remove',
  'salary-person-tax-prepare-import': 'prepareImport',
  'salary-person-tax-import': 'importExcel',
  'salary-person-tax-download-template': 'downloadTemplate',
  'salary-person-tax-export': 'export',
  'salary-person-tax-prepare-archive': 'prepareArchive',
  'salary-person-tax-archive': 'archive',
  'salary-person-tax-eligibility-check': 'eligibilityCheck',
} as const

export const salaryPersonTaxCapabilities: CapabilityDefinition[] = [
  { id: 'salary-person-tax-list', title: '查询扣款费用', write: false, params: pageParams },
  { id: 'salary-person-tax-get', title: '读取扣款费用详情', write: false, params: [p('id', 'text', true, '扣款主记录ID')] },
  { id: 'salary-person-tax-prepare-update', title: '准备修改扣款费用', write: false, params: formParams },
  { id: 'salary-person-tax-update', title: '修改扣款费用', write: true, params: formParams },
  { id: 'salary-person-tax-prepare-remove', title: '准备删除扣款费用', write: false, params: idsParams },
  { id: 'salary-person-tax-remove', title: '删除扣款费用', write: true, params: idsParams },
  { id: 'salary-person-tax-prepare-import', title: '准备导入扣款费用', write: false, params: fileParams },
  { id: 'salary-person-tax-import', title: '导入扣款费用', write: true, params: fileParams },
  { id: 'salary-person-tax-download-template', title: '下载扣款费用导入模板', write: false, params: [] },
  { id: 'salary-person-tax-export', title: '导出扣款费用', write: false, params: [p('ids', 'text', false, '选中的记录ID数组；为空时Portal请求导出未归档授权范围')] },
  { id: 'salary-person-tax-prepare-archive', title: '准备归档扣款费用', write: false, params: idsParams },
  { id: 'salary-person-tax-archive', title: '归档扣款费用', write: true, params: idsParams },
  { id: 'salary-person-tax-eligibility-check', title: '检查扣款费用员工资格', write: false, params: [p('staffCodes', 'text', true, '已核实的员工工号数组'), p('businessDate', 'date', true, '资格检查业务日期')] },
].map(definition => ({
  ...definition,
  pagePath: SALARY_PERSON_TAX_PAGE_PATH,
  permission: SALARY_PERSON_TAX_PERMISSION,
  moduleType: SALARY_PERSON_TAX_MODULE_TYPE,
  httpInstance: 'platform',
}))
