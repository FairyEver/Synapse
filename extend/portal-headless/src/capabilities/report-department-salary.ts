import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 部门工资统计」。 */
export const REPORT_DEPARTMENT_SALARY_PAGE_PATH = '/dashboard/report/department-salary/list'
export const REPORT_DEPARTMENT_SALARY_PERMISSION = '/dashboard/report/department-salary'
export const REPORT_DEPARTMENT_SALARY_MODULE_TYPE = 14

const LIST_URL = '/salary/report/deptSalarySummaryPage'
const EXPORT_URL = '/salary/report/exportDeptSalarySummary'

export type ReportDepartmentSalaryId = string | number
export type ReportDepartmentSalaryQuery = {
  monthPay?: string | null
  orgId?: ReportDepartmentSalaryId | null
  postId?: ReportDepartmentSalaryId | null
  ledgerIds?: Array<ReportDepartmentSalaryId> | null
  pageNo?: number
  pageSize?: number
}

export type ReportDepartmentSalaryRow = Record<string, unknown> & {
  monthPay?: string | null
  deptPath?: string | null
  postName?: string | null
  staffNum?: number | string | null
  baseSalary?: number | string | null
  evaluateWages?: number | string | null
  orgAssessmentSalary?: number | string | null
  orgProfitSalarySalary?: number | string | null
  overtimeWages?: number | string | null
  educationalSubsidy?: number | string | null
  seniorityAllowance?: number | string | null
  communicationsSubsidy?: number | string | null
  laborCosts?: number | string | null
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
  otherChargebacks?: number | string | null
  healthDeduction?: number | string | null
  totalDeductions?: number | string | null
  netSalary?: number | string | null
  bigMedical?: number | string | null
  bonusSalary?: number | string | null
  closureSalary?: number | string | null
}

export type ReportDepartmentSalaryFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`); return value as JsonObject }
function idOf (value: unknown, label: string): ReportDepartmentSalaryId { if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`); return value }; if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value; throw new Error(`${label}必须为正整数ID`) }
function optionalIdOf (value: unknown, label: string): ReportDepartmentSalaryId | '' { return value === undefined || value === null || value === '' ? '' : idOf(value, label) }
function currentMonth (): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
function monthOf (value: unknown): string { if (value === undefined) return currentMonth(); if (value === null || value === '') return ''; if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('monthPay必须为YYYY-MM'); return value }
function idsOf (value: unknown): ReportDepartmentSalaryId[] { if (value === undefined || value === null) return []; if (!Array.isArray(value)) throw new Error('ledgerIds必须为ID数组'); return value.map((item, index) => idOf(item, `ledgerIds[${index}]`)) }
function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number { const resolved = value ?? fallback; if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`); if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500'); return resolved }
function formOf (query: ReportDepartmentSalaryQuery = {}): JsonObject { return { monthPay: monthOf(query.monthPay), orgId: optionalIdOf(query.orgId, 'orgId'), postId: optionalIdOf(query.postId, 'postId'), ledgerIds: idsOf(query.ledgerIds).join(',') } }
function listParamsOf (query: ReportDepartmentSalaryQuery = {}): JsonObject { return { order: '', orderField: '', ...formOf(query), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize') } }
function pageOf (value: unknown): PageResult<ReportDepartmentSalaryRow> { const page = objectOf(value, '部门工资统计分页响应'); if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('部门工资统计分页响应缺少有效list或total'); return { list: page.list.map((item, index) => ({ ...objectOf(item, `部门工资统计列表[${index}]`) } as ReportDepartmentSalaryRow)), total: page.total } }
function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string { const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']; if (typeof header !== 'string') return fallback; const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]; if (encoded) { try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded } }; return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback }
function fileOf (response: AxiosResponse<ArrayBuffer>): ReportDepartmentSalaryFile { const data: unknown = response?.data; const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null; if (!bytes || bytes.byteLength === 0) throw new Error('部门工资统计导出响应为空文件'); const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']; return { fileName: fileNameOf(response, '部门工资统计.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength } }

export function createReportDepartmentSalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportDepartmentSalaryQuery = {}): Promise<PageResult<ReportDepartmentSalaryRow>> { return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) })) },
    async export (query: ReportDepartmentSalaryQuery = {}): Promise<ReportDepartmentSalaryFile> { return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' })) },
  }
}
export type ReportDepartmentSalaryCapability = ReturnType<typeof createReportDepartmentSalaryCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [p('monthPay', 'date', false, '工资月份，格式YYYY-MM；省略使用页面当前月'), p('orgId', 'text', false, '角色组织树选中的部门ID'), p('postId', 'text', false, '岗位组件返回的岗位ID'), p('ledgerIds', 'text', false, '账套ID数组；请求前连接为逗号字符串')]
export const REPORT_DEPARTMENT_SALARY_METHODS = { 'report-department-salary-list': 'list', 'report-department-salary-export': 'export' } as const
export const reportDepartmentSalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-department-salary-list', title: '查询部门工资统计', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-department-salary-export', title: '导出部门工资统计', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_DEPARTMENT_SALARY_PAGE_PATH, permission: REPORT_DEPARTMENT_SALARY_PERMISSION, moduleType: REPORT_DEPARTMENT_SALARY_MODULE_TYPE, httpInstance: 'platform' }))
