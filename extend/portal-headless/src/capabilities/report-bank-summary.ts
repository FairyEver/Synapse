import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 银行汇总」。 */
export const REPORT_BANK_SUMMARY_PAGE_PATH = '/dashboard/report/bank-summary/list'
export const REPORT_BANK_SUMMARY_PERMISSION = '/dashboard/report/bank-summary'
export const REPORT_BANK_SUMMARY_MODULE_TYPE = 14

const LIST_URL = '/salary/report/getBankSummaryPage'
const EXPORT_URL = '/salary/report/exportBankSummary'

export type ReportBankSummaryId = string | number
export type ReportBankSummaryQuery = {
  organization?: ReportBankSummaryId | null
  cardIssuingBank?: string | null
  salaryMonth?: string | null
  ledgerIds?: Array<ReportBankSummaryId> | null
  pageNo?: number
  pageSize?: number
}

export type ReportBankSummaryRow = Record<string, unknown> & {
  cardIssuingBank?: string | null
  number?: number | string | null
  salaryMonth?: string | null
  realPaySalary?: number | string | null
}

export type ReportBankSummaryFile = {
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

function idOf (value: unknown, label: string): ReportBankSummaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportBankSummaryId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function currentMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown): string {
  if (value === undefined) return currentMonth()
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('salaryMonth必须为YYYY-MM')
  return value
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function ledgerIdsOf (value: unknown): ReportBankSummaryId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('ledgerIds必须为ID数组')
  return value.map((item, index) => idOf(item, `ledgerIds[${index}]`))
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function formOf (query: ReportBankSummaryQuery = {}): JsonObject {
  return {
    organization: optionalIdOf(query.organization, 'organization'),
    cardIssuingBank: textOf(query.cardIssuingBank, 'cardIssuingBank'),
    salaryMonth: monthOf(query.salaryMonth),
    ledgerIds: ledgerIdsOf(query.ledgerIds).join(','),
  }
}

function listParamsOf (query: ReportBankSummaryQuery = {}): JsonObject {
  return { order: '', orderField: '', ...formOf(query), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize') }
}

function pageOf (value: unknown): PageResult<ReportBankSummaryRow> {
  const page = objectOf(value, '银行汇总分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('银行汇总分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `银行汇总列表[${index}]`) } as ReportBankSummaryRow)), total: page.total }
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportBankSummaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('银行汇总导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: fileNameOf(response, '银行汇总.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

export function createReportBankSummaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportBankSummaryQuery = {}): Promise<PageResult<ReportBankSummaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportBankSummaryQuery = {}): Promise<ReportBankSummaryFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportBankSummaryCapability = ReturnType<typeof createReportBankSummaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('organization', 'text', false, '角色组织树选中的组织ID'),
  p('cardIssuingBank', 'text', false, '银行名称模糊筛选'),
  p('salaryMonth', 'date', false, '发放月份，格式YYYY-MM；省略使用页面当前月'),
  p('ledgerIds', 'text', false, '账套ID数组；请求前按页面规则连接为逗号字符串'),
]

export const REPORT_BANK_SUMMARY_METHODS = {
  'report-bank-summary-list': 'list',
  'report-bank-summary-export': 'export',
} as const

export const reportBankSummaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-bank-summary-list', title: '查询银行汇总', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-bank-summary-export', title: '导出银行汇总', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_BANK_SUMMARY_PAGE_PATH, permission: REPORT_BANK_SUMMARY_PERMISSION, moduleType: REPORT_BANK_SUMMARY_MODULE_TYPE, httpInstance: 'platform' }))
