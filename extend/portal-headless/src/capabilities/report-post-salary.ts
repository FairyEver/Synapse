import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 岗位工资统计」。 */
export const REPORT_POST_SALARY_PAGE_PATH = '/dashboard/report/post-salary/list'
export const REPORT_POST_SALARY_PERMISSION = '/dashboard/report/post-salary'
export const REPORT_POST_SALARY_MODULE_TYPE = 14

const LIST_URL = '/salary/report/getPostSalaryStatistics'
const EXPORT_URL = '/salary/report/exportPostSalaryStatistics'

export type ReportPostSalaryId = string | number
export type ReportPostSalaryQuery = {
  name?: string | null
  year?: string | null
  /** Portal字段名为organizationName，但实际传的是角色组织树节点ID。 */
  organizationId?: ReportPostSalaryId | null
  ledgerIds?: ReportPostSalaryId[] | null
  pageNo?: number
  pageSize?: number
}

export type ReportPostSalaryRow = Record<string, unknown> & {
  sort?: string | null
  name?: string | null
  year?: string | null
  organizationName?: string | null
  fullPath?: string | null
  staffCode?: string | null
  idCard?: string | null
  basicSalary1?: number | string | null
  assessmentSalary1?: number | string | null
  departmentAssessmentSalary1?: number | string | null
  profitAssessmentSalary1?: number | string | null
  basicSalary2?: number | string | null
  assessmentSalary2?: number | string | null
  departmentAssessmentSalary2?: number | string | null
  profitAssessmentSalary2?: number | string | null
  basicSalary3?: number | string | null
  assessmentSalary3?: number | string | null
  departmentAssessmentSalary3?: number | string | null
  profitAssessmentSalary3?: number | string | null
  basicSalary4?: number | string | null
  assessmentSalary4?: number | string | null
  departmentAssessmentSalary4?: number | string | null
  profitAssessmentSalary4?: number | string | null
  basicSalary5?: number | string | null
  assessmentSalary5?: number | string | null
  departmentAssessmentSalary5?: number | string | null
  profitAssessmentSalary5?: number | string | null
  basicSalary6?: number | string | null
  assessmentSalary6?: number | string | null
  departmentAssessmentSalary6?: number | string | null
  profitAssessmentSalary6?: number | string | null
  basicSalary7?: number | string | null
  assessmentSalary7?: number | string | null
  departmentAssessmentSalary7?: number | string | null
  profitAssessmentSalary7?: number | string | null
  basicSalary8?: number | string | null
  assessmentSalary8?: number | string | null
  departmentAssessmentSalary8?: number | string | null
  profitAssessmentSalary8?: number | string | null
  basicSalary9?: number | string | null
  assessmentSalary9?: number | string | null
  departmentAssessmentSalary9?: number | string | null
  profitAssessmentSalary9?: number | string | null
  basicSalary10?: number | string | null
  assessmentSalary10?: number | string | null
  departmentAssessmentSalary10?: number | string | null
  profitAssessmentSalary10?: number | string | null
  basicSalary11?: number | string | null
  assessmentSalary11?: number | string | null
  departmentAssessmentSalary11?: number | string | null
  profitAssessmentSalary11?: number | string | null
  basicSalary12?: number | string | null
  assessmentSalary12?: number | string | null
  departmentAssessmentSalary12?: number | string | null
  profitAssessmentSalary12?: number | string | null
}

export type ReportPostSalaryFile = {
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

function idOf (value: unknown, label: string): ReportPostSalaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportPostSalaryId | '' {
  return value === undefined || value === null || value === '' ? '' : idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function currentYear (): string {
  return String(new Date().getFullYear())
}

function yearOf (value: unknown): string {
  if (value === undefined) return currentYear()
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new Error('year必须为YYYY')
  if (value > currentYear()) throw new Error('year不能晚于当前年份')
  return value
}

function idsOf (value: unknown): ReportPostSalaryId[] {
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

function formOf (query: ReportPostSalaryQuery = {}): JsonObject {
  return {
    name: textOf(query.name, 'name'),
    year: yearOf(query.year),
    // Portal/Java沿用organizationName字段，但值是组织ID，不是名称。
    organizationName: optionalIdOf(query.organizationId, 'organizationId'),
    ledgerIds: idsOf(query.ledgerIds).join(','),
  }
}

function listParamsOf (query: ReportPostSalaryQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportPostSalaryRow> {
  const page = objectOf(value, '岗位工资统计分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('岗位工资统计分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => ({ ...objectOf(item, `岗位工资统计列表[${index}]`) } as ReportPostSalaryRow)),
    total: page.total,
  }
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

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportPostSalaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('岗位工资统计导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '岗位工资统计.xlsx'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createReportPostSalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportPostSalaryQuery = {}): Promise<PageResult<ReportPostSalaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportPostSalaryQuery = {}): Promise<ReportPostSalaryFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportPostSalaryCapability = ReturnType<typeof createReportPostSalaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('name', 'text', false, '员工姓名模糊查询；省略发送空字符串'),
  p('year', 'date', false, '工资年份，格式YYYY；省略使用页面当前年份，不能晚于当前年份'),
  p('organizationId', 'tree', false, '角色组织树选中的组织ID；Portal请求键名为organizationName'),
  p('ledgerIds', 'text', false, '薪资账套ID数组；请求时按选中顺序连接为逗号字符串'),
]

export const REPORT_POST_SALARY_METHODS = {
  'report-post-salary-list': 'list',
  'report-post-salary-export': 'export',
} as const

export const reportPostSalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-post-salary-list', title: '查询岗位工资统计', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-post-salary-export', title: '导出岗位工资统计', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_POST_SALARY_PAGE_PATH, permission: REPORT_POST_SALARY_PERMISSION, moduleType: REPORT_POST_SALARY_MODULE_TYPE, httpInstance: 'platform' }))
