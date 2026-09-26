import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 成本中心薪资汇总」。 */
export const REPORT_COST_CENTER_SALARY_PAGE_PATH = '/dashboard/report/cost-center-salary/list'
export const REPORT_COST_CENTER_SALARY_PERMISSION = '/dashboard/report/cost-center-salary'
export const REPORT_COST_CENTER_SALARY_MODULE_TYPE = 14

const LIST_URL = '/salary/report/costCenterSummaryPage'
const EXPORT_URL = '/admin-api/salary/report/exportCostCenterSummary'

export type ReportCostCenterSalaryId = string | number
export type ReportCostCenterSalaryQuery = {
  organizationId?: ReportCostCenterSalaryId | null
  monthPay?: string | null
  costCenterId?: ReportCostCenterSalaryId | null
  ledgerIds?: Array<ReportCostCenterSalaryId> | null
  pageNo?: number
  pageSize?: number
}

export type ReportCostCenterSalaryRow = Record<string, unknown> & {
  monthPay?: string | null
  orgName?: string | null
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
  bonusSalary?: number | string | null
  shouldSalary?: number | string | null
  heatFee?: number | string | null
  heat?: number | string | null
  rentalSubsidy?: number | string | null
  oneChildAllowance?: number | string | null
  otherBenefits?: number | string | null
  benefitsTotal?: number | string | null
}

export type ReportCostCenterSalaryFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}
function idOf (value: unknown, label: string): ReportCostCenterSalaryId {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`); return value }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}
function optionalIdOf (value: unknown, label: string): ReportCostCenterSalaryId | '' { return value === undefined || value === null || value === '' ? '' : idOf(value, label) }
function currentMonth (): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
function monthOf (value: unknown): string { if (value === undefined) return currentMonth(); if (value === null || value === '') return ''; if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('monthPay必须为YYYY-MM'); return value }
function idsOf (value: unknown): ReportCostCenterSalaryId[] { if (value === undefined || value === null) return []; if (!Array.isArray(value)) throw new Error('ledgerIds必须为ID数组'); return value.map((item, index) => idOf(item, `ledgerIds[${index}]`)) }
function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number { const resolved = value ?? fallback; if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`); if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500'); return resolved }
function formOf (query: ReportCostCenterSalaryQuery = {}): JsonObject { return { organizationId: optionalIdOf(query.organizationId, 'organizationId'), monthPay: monthOf(query.monthPay), costCenterId: optionalIdOf(query.costCenterId, 'costCenterId'), ledgerIds: idsOf(query.ledgerIds).join(',') } }
function listParamsOf (query: ReportCostCenterSalaryQuery = {}): JsonObject { return { order: '', orderField: '', ...formOf(query), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize') } }
function pageOf (value: unknown): PageResult<ReportCostCenterSalaryRow> { const page = objectOf(value, '成本中心薪资汇总分页响应'); if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('成本中心薪资汇总分页响应缺少有效list或total'); return { list: page.list.map((item, index) => ({ ...objectOf(item, `成本中心薪资汇总列表[${index}]`) } as ReportCostCenterSalaryRow)), total: page.total } }
function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string { const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']; if (typeof header !== 'string') return fallback; const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]; if (encoded) { try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded } } return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback }
function fileOf (response: AxiosResponse<ArrayBuffer>): ReportCostCenterSalaryFile { const data: unknown = response?.data; const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null; if (!bytes || bytes.byteLength === 0) throw new Error('成本中心薪资汇总导出响应为空文件'); const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']; return { fileName: fileNameOf(response, '成本中心薪资汇总.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength } }

export function createReportCostCenterSalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportCostCenterSalaryQuery = {}): Promise<PageResult<ReportCostCenterSalaryRow>> { return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) })) },
    async export (query: ReportCostCenterSalaryQuery = {}): Promise<ReportCostCenterSalaryFile> { return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' })) },
  }
}
export type ReportCostCenterSalaryCapability = ReturnType<typeof createReportCostCenterSalaryCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [p('organizationId', 'text', false, '角色组织树选中的组织ID'), p('monthPay', 'date', false, '工资月份，格式YYYY-MM；省略使用页面当前月'), p('costCenterId', 'text', false, '成本中心ID'), p('ledgerIds', 'text', false, '账套ID数组；请求前连接为逗号字符串')]
export const REPORT_COST_CENTER_SALARY_METHODS = { 'report-cost-center-salary-list': 'list', 'report-cost-center-salary-export': 'export' } as const
export const reportCostCenterSalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-cost-center-salary-list', title: '查询成本中心薪资汇总', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-cost-center-salary-export', title: '导出成本中心薪资汇总', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_COST_CENTER_SALARY_PAGE_PATH, permission: REPORT_COST_CENTER_SALARY_PERMISSION, moduleType: REPORT_COST_CENTER_SALARY_MODULE_TYPE, httpInstance: 'platform' }))
