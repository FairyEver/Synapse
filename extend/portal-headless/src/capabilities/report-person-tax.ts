import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 个人所得税代扣代缴明细」。 */
export const REPORT_PERSON_TAX_PAGE_PATH = '/dashboard/report/person-tax/list'
export const REPORT_PERSON_TAX_PERMISSION = '/dashboard/report/person-tax'
export const REPORT_PERSON_TAX_MODULE_TYPE = 14

const LIST_URL = '/salary/report/personTaxDetailsPage'
const EXPORT_URL = '/salary/report/exportPersonTaxDetails'

export type ReportPersonTaxId = string | number
export type ReportPersonTaxMonthRange = readonly [string | null | undefined, string | null | undefined]
export type ReportPersonTaxQuery = {
  monthPayRange?: ReportPersonTaxMonthRange | null
  orgId?: ReportPersonTaxId | null
  ledgerIds?: ReportPersonTaxId[] | null
  pageNo?: number
  pageSize?: number
}

export type ReportPersonTaxRow = Record<string, unknown> & {
  index?: number | null
  deptPath?: string | null
  post?: string | null
  monthPay?: string | null
  name?: string | null
  idCard?: string | null
  ledgerName?: string | null
  baseSalary?: number | string | null
  evaluateWages?: number | string | null
  overtimeWages?: number | string | null
  overtimePay?: number | string | null
  educationalSubsidy?: number | string | null
  seniorityAllowance?: number | string | null
  communicationsSubsidy?: number | string | null
  laborCosts?: number | string | null
  closureFee?: number | string | null
  dutyPay?: number | string | null
  otherWages?: number | string | null
  heatFee?: number | string | null
  heat?: number | string | null
  rentalSubsidy?: number | string | null
  oneChildAllowance?: number | string | null
  otherBenefits?: number | string | null
  shouldPay?: number | string | null
  pension?: number | string | null
  jobLess?: number | string | null
  medical?: number | string | null
  personalProvidentFund?: number | string | null
  taxableWages?: number | string | null
  incomeTax?: number | string | null
  purchaseHouse?: number | string | null
  purchaseCar?: number | string | null
  otherChargebacks?: number | string | null
  healthDeduction?: number | string | null
  totalDeductions?: number | string | null
  houseInterestPrice?: number | string | null
  houseRentPrice?: number | string | null
  childEducationPrice?: number | string | null
  infantCarePrice?: number | string | null
  supportOldPrice?: number | string | null
  adultEducationPrice?: number | string | null
  seriousIllness?: number | string | null
  bigMedical?: number | string | null
  totalAdultEducationPrice?: number | string | null
  totalSupportOldPrice?: number | string | null
  totalHouseInterestPrice?: number | string | null
  totalHouseRentPrice?: number | string | null
  totalChildEducationPrice?: number | string | null
  totalInfantCarePrice?: number | string | null
  totalAdditionalPrice?: number | string | null
  totalPayableTax?: number | string | null
  totalPaidTax?: number | string | null
  netSalary?: number | string | null
}

export type ReportPersonTaxFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportPersonTaxId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportPersonTaxId | '' {
  return value === undefined || value === null || value === '' ? '' : idOf(value, label)
}

function monthAtOffset (offset: number): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function monthRangeOf (value: unknown): [string, string] {
  if (value === undefined) return [monthAtOffset(-1), monthAtOffset(0)]
  if (value === null || value === '') return ['', '']
  if (!Array.isArray(value)) throw new Error('monthPayRange必须为年月区间数组')
  return [monthOf(value[0], 'monthPayRange[0]'), monthOf(value[1], 'monthPayRange[1]')]
}

function idsOf (value: unknown, label: string): ReportPersonTaxId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function formOf (query: ReportPersonTaxQuery = {}): JsonObject {
  const [monthPay, endmonthPay] = monthRangeOf(query.monthPayRange)
  return {
    orgId: optionalIdOf(query.orgId, 'orgId'),
    monthPay,
    endmonthPay,
    ledgerIds: idsOf(query.ledgerIds, 'ledgerIds').join(','),
  }
}

function listParamsOf (query: ReportPersonTaxQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportPersonTaxRow> {
  const page = objectOf(value, '个人所得税代扣代缴明细分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('个人所得税代扣代缴明细分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => ({ ...objectOf(item, `个人所得税代扣代缴明细列表[${index}]`) } as ReportPersonTaxRow)),
    total: page.total,
  }
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

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportPersonTaxFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('个人所得税代扣代缴明细导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '个人所得税代扣代缴明细.xlsx'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createReportPersonTaxCapability (request: PortalRequest) {
  return {
    async list (query: ReportPersonTaxQuery = {}): Promise<PageResult<ReportPersonTaxRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportPersonTaxQuery = {}): Promise<ReportPersonTaxFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportPersonTaxCapability = ReturnType<typeof createReportPersonTaxCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('monthPayRange', 'date', false, '工资年月区间；按Portal转换为monthPay和endmonthPay，省略时为上月到本月'),
  p('orgId', 'tree', false, '角色组织树选中的组织ID；未选择时发送空字符串'),
  p('ledgerIds', 'text', false, '薪资账套ID数组；请求时按选中顺序连接为逗号字符串'),
]

export const REPORT_PERSON_TAX_METHODS = {
  'report-person-tax-list': 'list',
  'report-person-tax-export': 'export',
} as const

export const reportPersonTaxCapabilities: CapabilityDefinition[] = [
  { id: 'report-person-tax-list', title: '查询个人所得税代扣代缴明细', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-person-tax-export', title: '导出个人所得税代扣代缴明细', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_PERSON_TAX_PAGE_PATH, permission: REPORT_PERSON_TAX_PERMISSION, moduleType: REPORT_PERSON_TAX_MODULE_TYPE, httpInstance: 'platform' }))
