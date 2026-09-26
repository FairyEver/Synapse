import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 部门工资发放明细」；岗位筛选的 wire 字段是 postName。 */
export const REPORT_DEPARTMENT_SALARY_DETAIL_PAGE_PATH = '/dashboard/report/department-salary-detail/list'
export const REPORT_DEPARTMENT_SALARY_DETAIL_PERMISSION = '/dashboard/report/department-salary-detail'
export const REPORT_DEPARTMENT_SALARY_DETAIL_MODULE_TYPE = 14

const LIST_URL = '/salary/report/getDeptSalaryPage'
const EXPORT_URL = '/salary/report/exportDeptSalary'

export type ReportDepartmentSalaryDetailId = string | number
export type ReportDepartmentSalaryDetailQuery = {
  belongAccount?: ReportDepartmentSalaryDetailId | null
  monthPay?: string | null
  fullPath?: ReportDepartmentSalaryDetailId | null
  payrollUnit?: string | null
  postId?: ReportDepartmentSalaryDetailId | null
  name?: string | null
  staffCode?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportDepartmentSalaryDetailRow = Record<string, unknown> & {
  name?: string | null
  belongAccount?: string | null
  monthPay?: string | null
  staffCode?: string | null
  postName?: string | null
  fullPath?: string | null
  payrollUnit?: string | null
  basicSalary?: number | string | null
  assessmentSalary?: number | string | null
  orgAssessmentSalary?: number | string | null
  orgProfitSalarySalary?: number | string | null
  overWorkSalary?: number | string | null
  educationSalary?: number | string | null
  workYearSalary?: number | string | null
  communicationSalary?: number | string | null
  labourSalary?: number | string | null
  closureSalary?: number | string | null
  dutySalary?: number | string | null
  otherSalary?: number | string | null
  heatstrokePreventionSalary?: number | string | null
  heatingSalary?: number | string | null
  tenancyPerkSalary?: number | string | null
  singleChildSalary?: number | string | null
  otherWelfareSalary?: number | string | null
  bonusSalary?: number | string | null
  shouldSalary?: number | string | null
  oldAgeSalary?: number | string | null
  unemploymentSalary?: number | string | null
  medicalSalary?: number | string | null
  largeMedicalSalary?: number | string | null
  personalSocialSecuritySalary?: number | string | null
  personalProvidentFundSalary?: number | string | null
  taxableSalary?: number | string | null
  personalTaxSalary?: number | string | null
  housePurchaseDeductionSalary?: number | string | null
  otherDeductionSalary?: number | string | null
  healthDeductionSalary?: number | string | null
  deductionSalary?: number | string | null
  actualSalary?: number | string | null
}

export type ReportDepartmentSalaryDetailFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`); return value as JsonObject }
function idOf (value: unknown, label: string): ReportDepartmentSalaryDetailId { if (typeof value === 'number') { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`); return value }; if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value; throw new Error(`${label}必须为正整数ID`) }
function optionalIdOf (value: unknown, label: string): ReportDepartmentSalaryDetailId | '' { return value === undefined || value === null || value === '' ? '' : idOf(value, label) }
function textOf (value: unknown, label: string): string { if (value === undefined || value === null) return ''; if (typeof value !== 'string') throw new Error(`${label}必须为字符串`); return value }
function currentMonth (): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
function monthOf (value: unknown): string { if (value === undefined) return currentMonth(); if (value === null || value === '') return ''; if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('monthPay必须为YYYY-MM'); return value }
function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number { const resolved = value ?? fallback; if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`); if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500'); return resolved }

function formOf (query: ReportDepartmentSalaryDetailQuery = {}): JsonObject {
  return {
    belongAccount: optionalIdOf(query.belongAccount, 'belongAccount'),
    monthPay: monthOf(query.monthPay),
    fullPath: optionalIdOf(query.fullPath, 'fullPath'),
    payrollUnit: textOf(query.payrollUnit, 'payrollUnit'),
    postName: optionalIdOf(query.postId, 'postId'),
    sort: '',
    name: textOf(query.name, 'name'),
    staffCode: textOf(query.staffCode, 'staffCode'),
  }
}
function listParamsOf (query: ReportDepartmentSalaryDetailQuery = {}): JsonObject { return { order: '', orderField: '', ...formOf(query), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize') } }
function pageOf (value: unknown): PageResult<ReportDepartmentSalaryDetailRow> { const page = objectOf(value, '部门工资发放明细分页响应'); if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('部门工资发放明细分页响应缺少有效list或total'); return { list: page.list.map((item, index) => ({ ...objectOf(item, `部门工资发放明细列表[${index}]`) } as ReportDepartmentSalaryDetailRow)), total: page.total } }
function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string { const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']; if (typeof header !== 'string') return fallback; const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]; if (encoded) { try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded } }; return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback }
function fileOf (response: AxiosResponse<ArrayBuffer>): ReportDepartmentSalaryDetailFile { const data: unknown = response?.data; const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null; if (!bytes || bytes.byteLength === 0) throw new Error('部门工资发放明细导出响应为空文件'); const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }; const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']; return { fileName: fileNameOf(response, '部门工资明细表.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength } }

export function createReportDepartmentSalaryDetailCapability (request: PortalRequest) {
  return {
    async list (query: ReportDepartmentSalaryDetailQuery = {}): Promise<PageResult<ReportDepartmentSalaryDetailRow>> { return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) })) },
    async export (query: ReportDepartmentSalaryDetailQuery = {}): Promise<ReportDepartmentSalaryDetailFile> { return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' })) },
  }
}
export type ReportDepartmentSalaryDetailCapability = ReturnType<typeof createReportDepartmentSalaryDetailCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [p('belongAccount', 'text', false, '账套ID'), p('monthPay', 'date', false, '工资月份，格式YYYY-MM；省略使用页面当前月'), p('fullPath', 'text', false, '角色组织树选中的部门ID'), p('payrollUnit', 'text'), p('postId', 'text', false, '岗位组件返回的岗位ID；请求字段映射为postName'), p('name', 'text'), p('staffCode', 'text')]
export const REPORT_DEPARTMENT_SALARY_DETAIL_METHODS = { 'report-department-salary-detail-list': 'list', 'report-department-salary-detail-export': 'export' } as const
export const reportDepartmentSalaryDetailCapabilities: CapabilityDefinition[] = [
  { id: 'report-department-salary-detail-list', title: '查询部门工资发放明细', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-department-salary-detail-export', title: '导出部门工资发放明细', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_DEPARTMENT_SALARY_DETAIL_PAGE_PATH, permission: REPORT_DEPARTMENT_SALARY_DETAIL_PERMISSION, moduleType: REPORT_DEPARTMENT_SALARY_DETAIL_MODULE_TYPE, httpInstance: 'platform' }))
