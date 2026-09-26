import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 薪资成本汇总」。 */
export const REPORT_SALARY_COST_PAGE_PATH = '/dashboard/report/salary-cost/list'
export const REPORT_SALARY_COST_PERMISSION = '/dashboard/report/salary-cost'
export const REPORT_SALARY_COST_MODULE_TYPE = 14

const LIST_URL = '/admin-api/salary/report/salaryCostSummaryPage'
const EXPORT_URL = '/admin-api/salary/report/exportSalaryCostSummary'

export type ReportSalaryCostId = string | number
export type ReportSalaryCostQuery = {
  orgId?: ReportSalaryCostId | null
  monthPay?: string | null
  /** 页面输入框为空时保持空字符串；Java DTO按Integer接收。 */
  level?: number | '' | null
  ledgerIds?: Array<ReportSalaryCostId> | null
  pageNo?: number
  pageSize?: number
}

export type ReportSalaryCostRow = Record<string, unknown> & {
  index?: number | null
  orgName?: string | null
  deptPath?: string | null
  monthPay?: string | null
  level?: number | null
  staffNum?: number | string | null
  baseSalary?: number | string | null
  evaluateWages?: number | string | null
  overtimeWages?: number | string | null
  educationalSubsidy?: number | string | null
  seniorityAllowance?: number | string | null
  communicationsSubsidy?: number | string | null
  closureFee?: number | string | null
  laborCosts?: number | string | null
  dutyPay?: number | string | null
  otherWages?: number | string | null
  heatFee?: number | string | null
  heat?: number | string | null
  rentalSubsidy?: number | string | null
  oneChildAllowance?: number | string | null
  otherBenefits?: number | string | null
  bonusSalary?: number | string | null
  shouldPay?: number | string | null
  pension?: number | string | null
  jobLess?: number | string | null
  medical?: number | string | null
  seriousIllness?: number | string | null
  personalSocialSecurity?: number | string | null
  personalProvidentFund?: number | string | null
  taxableWages?: number | string | null
  incomeTax?: number | string | null
  otherChargebacks?: number | string | null
  healthDeduction?: number | string | null
  totalDeductions?: number | string | null
  netSalary?: number | string | null
}

export type ReportSalaryCostFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportSalaryCostId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportSalaryCostId | '' {
  return value === undefined || value === null || value === '' ? '' : idOf(value, label)
}

function currentMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown): string {
  if (value === undefined) return currentMonth()
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('monthPay必须为YYYY-MM')
  return value
}

function levelOf (value: unknown): number | '' {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('level必须为正整数')
  return value
}

function idsOf (value: unknown): ReportSalaryCostId[] {
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

function formOf (query: ReportSalaryCostQuery = {}): JsonObject {
  return {
    orgId: optionalIdOf(query.orgId, 'orgId'),
    monthPay: monthOf(query.monthPay),
    level: levelOf(query.level),
    ledgerIds: idsOf(query.ledgerIds).join(','),
  }
}

function listParamsOf (query: ReportSalaryCostQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportSalaryCostRow> {
  const page = objectOf(value, '薪资成本汇总分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('薪资成本汇总分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `薪资成本汇总列表[${index}]`) } as ReportSalaryCostRow)), total: page.total }
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const raw = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1] ?? /filename="?([^";]+)"?/i.exec(header)?.[1]
  if (!raw) return fallback
  try { return decodeURIComponent(raw.replace(/^"|"$/g, '')) } catch { return raw }
}

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportSalaryCostFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('薪资成本汇总导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: fileNameOf(response, '薪资成本汇总表.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

export function createReportSalaryCostCapability (request: PortalRequest) {
  return {
    async list (query: ReportSalaryCostQuery = {}): Promise<PageResult<ReportSalaryCostRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportSalaryCostQuery = {}): Promise<ReportSalaryCostFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportSalaryCostCapability = ReturnType<typeof createReportSalaryCostCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('orgId', 'tree', false, '角色组织树选中的组织ID；服务端展开为后代组织范围'),
  p('monthPay', 'date', false, '工资月份，格式YYYY-MM；省略使用页面当前月，清空发送空字符串'),
  p('level', 'number', false, '组织层级上限；只能是正整数，省略或清空发送空字符串'),
  p('ledgerIds', 'text', false, '薪资账套ID数组；请求时按选中顺序连接为逗号字符串'),
]

export const REPORT_SALARY_COST_METHODS = {
  'report-salary-cost-list': 'list',
  'report-salary-cost-export': 'export',
} as const

export const reportSalaryCostCapabilities: CapabilityDefinition[] = [
  { id: 'report-salary-cost-list', title: '查询薪资成本汇总', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-salary-cost-export', title: '导出薪资成本汇总', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_SALARY_COST_PAGE_PATH, permission: REPORT_SALARY_COST_PERMISSION, moduleType: REPORT_SALARY_COST_MODULE_TYPE, httpInstance: 'platform' }))
