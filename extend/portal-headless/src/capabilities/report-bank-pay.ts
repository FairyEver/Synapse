import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 银行代发」；页面源码与 Java ReportSalaryController 对齐。 */
export const REPORT_BANK_PAY_PAGE_PATH = '/dashboard/report/bank-pay/list'
export const REPORT_BANK_PAY_PERMISSION = '/dashboard/report/bank-pay'
export const REPORT_BANK_PAY_MODULE_TYPE = 14

const LIST_URL = '/admin-api/salary/report/bankDropshippingPage'
const EXPORT_URL = '/admin-api/salary/report/exportBankDropshipping'
const EXPORT_BY_BANK_URL = '/admin-api/salary/report/exportByBank'

export type ReportBankPayId = string | number
export type ReportBankPayMode = 2 | 3

export type ReportBankPayQuery = {
  orgId?: ReportBankPayId | null
  salaryMonth?: string | null
  ledgerIds?: Array<ReportBankPayId> | null
  pageNo?: number
  pageSize?: number
}

export type ReportBankPayRow = Record<string, unknown> & {
  salaryMonth?: string | null
  name?: string | null
  fullPath?: string | null
  idCard?: string | null
  cardIssuingBank?: string | null
  bankAccount?: string | null
  realPaySalary?: number | string | null
}

export type ReportBankPayFile = {
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

function idOf (value: unknown, label: string): ReportBankPayId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportBankPayId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function monthOf (value: unknown, label: string): string {
  if (value === undefined) return currentMonth()
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function currentMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function ledgerIdsOf (value: unknown): ReportBankPayId[] {
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

function formOf (query: ReportBankPayQuery = {}): JsonObject {
  return {
    orgId: optionalIdOf(query.orgId, 'orgId'),
    salaryMonth: monthOf(query.salaryMonth, 'salaryMonth'),
    ledgerIds: ledgerIdsOf(query.ledgerIds).join(','),
  }
}

function listParamsOf (query: ReportBankPayQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ReportBankPayRow {
  return { ...objectOf(value, `银行代发列表[${index}]`) } as ReportBankPayRow
}

function pageOf (value: unknown): PageResult<ReportBankPayRow> {
  const page = objectOf(value, '银行代发分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('银行代发分页响应缺少有效list或total')
  return { list: page.list.map(rowOf), total: page.total }
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

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ReportBankPayFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('银行代发导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, fallback),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function bankOf (value: unknown): { code: ReportBankPayMode; name: string; fileName: string } {
  if (value === 2) return { code: 2, name: '农业', fileName: '中国农业银行代发表.xlsx' }
  if (value === 3) return { code: 3, name: '建设', fileName: '中国建设银行代发表.xlsx' }
  throw new Error('mode必须为2（农业）或3（建设）')
}

export function createReportBankPayCapability (request: PortalRequest) {
  return {
    async list (query: ReportBankPayQuery = {}): Promise<PageResult<ReportBankPayRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportBankPayQuery = {}): Promise<ReportBankPayFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }), '银行代发表.xlsx')
    },
    async exportByBank (input: ReportBankPayQuery & { mode: ReportBankPayMode }): Promise<ReportBankPayFile> {
      const bank = bankOf(input?.mode)
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_BY_BANK_URL, method: 'get', params: { ...formOf(input), cardIssuingBank: bank.name }, responseType: 'arraybuffer' }), bank.fileName)
    },
  }
}

export type ReportBankPayCapability = ReturnType<typeof createReportBankPayCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const queryParams: ParamSpec[] = [
  p('orgId', 'text', false, '角色组织树选中的组织ID'),
  p('salaryMonth', 'date', false, '工资月份，格式YYYY-MM；省略使用页面当前月'),
  p('ledgerIds', 'text', false, '账套ID数组；请求前按页面规则连接为逗号字符串'),
]

export const REPORT_BANK_PAY_METHODS = {
  'report-bank-pay-list': 'list',
  'report-bank-pay-export': 'export',
  'report-bank-pay-export-by-bank': 'exportByBank',
} as const

export const reportBankPayCapabilities: CapabilityDefinition[] = [
  { id: 'report-bank-pay-list', title: '查询银行代发', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-bank-pay-export', title: '导出银行代发', write: false, params: queryParams },
  { id: 'report-bank-pay-export-by-bank', title: '按银行导出代发', write: false, params: [p('mode', 'enum', true, '导出银行类型', [{ value: 2, label: '农业' }, { value: 3, label: '建设' }]), ...queryParams] },
].map(definition => ({ ...definition, pagePath: REPORT_BANK_PAY_PAGE_PATH, permission: REPORT_BANK_PAY_PERMISSION, moduleType: REPORT_BANK_PAY_MODULE_TYPE, httpInstance: 'platform' }))
