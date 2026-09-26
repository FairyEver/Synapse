import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 临时工工资发放汇总表」。 */
export const REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH = '/dashboard/report/temporary-salary-summary/list'
export const REPORT_TEMPORARY_SALARY_SUMMARY_PERMISSION = '/dashboard/report/temporary-salary-summary'
export const REPORT_TEMPORARY_SALARY_SUMMARY_MODULE_TYPE = 14

const LIST_URL = '/hr/temporary-worker-salary-summary/page'
const DETAIL_URL = '/hr/temporary-worker-salary/temporaryWorkerStaffByPage'

export type ReportTemporarySalarySummaryId = string | number
export type ReportTemporarySalarySummaryStatus = 0 | 1 | 2 | 3 | 4

export type ReportTemporarySalarySummaryQuery = {
  organizationIdList?: ReportTemporarySalarySummaryId[] | null
  useYearMonth?: string | null
  status?: ReportTemporarySalarySummaryStatus | null
  pageNo?: number
  pageSize?: number
}

export type ReportTemporarySalarySummaryRow = Record<string, unknown> & {
  id?: ReportTemporarySalarySummaryId | null
  useYearMonth?: string | null
  staffCount?: number | string | null
  organizationId?: ReportTemporarySalarySummaryId | null
  organizationName?: string | null
  grossSalaryTotal?: number | string | null
  individualIncomeTaxTotal?: number | string | null
  netSalaryTotal?: number | string | null
  paymentDate?: string | null
  status?: ReportTemporarySalarySummaryStatus | number | null
}

export type ReportTemporarySalarySummaryDetailQuery = {
  summaryId: ReportTemporarySalarySummaryId
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportTemporarySalaryDetailRow = Record<string, unknown> & {
  id?: ReportTemporarySalarySummaryId | null
  useYearMonth?: string | null
  name?: string | null
  idCard?: string | null
  organizationId?: ReportTemporarySalarySummaryId | null
  organizationName?: string | null
  entryDate?: string | null
  bankAccount?: string | null
  openingBank?: string | null
  attendanceDays?: number | string | null
  dailyValue?: number | string | null
  attendanceSalary?: number | string | null
  otherSalary?: number | string | null
  grossSalary?: number | string | null
  individualIncomeTax?: number | string | null
  netSalary?: number | string | null
  status?: number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportTemporarySalarySummaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idsOf (value: unknown, label: string): ReportTemporarySalarySummaryId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function statusOf (value: unknown, label: string): ReportTemporarySalarySummaryStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || ![0, 1, 2, 3, 4].includes(value as number)) throw new Error(`${label}必须为0、1、2、3或4`)
  return value as ReportTemporarySalarySummaryStatus
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: ReportTemporarySalarySummaryQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    organizationIdList: idsOf(query.organizationIdList, 'organizationIdList'),
    useYearMonth: monthOf(query.useYearMonth, 'useYearMonth'),
    status: statusOf(query.status, 'status'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function detailParamsOf (query: ReportTemporarySalarySummaryDetailQuery): JsonObject {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('临时工工资发放汇总明细查询必须是对象')
  return {
    order: '',
    orderField: '',
    temporaryWorkerSalarySummaryId: idOf(query.summaryId, 'summaryId'),
    name: textOf(query.name, 'name'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf<T extends Record<string, unknown>> (value: unknown, label: string, index: number): T {
  return { ...objectOf(value, `${label}[${index}]`) } as T
}

function pageOf<T extends Record<string, unknown>> (value: unknown, label: string, rowLabel: string): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error(`${label}缺少有效list或total`)
  return {
    list: page.list.map((item, index) => rowOf<T>(item, rowLabel, index)),
    total: page.total,
  }
}

export function createReportTemporarySalarySummaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportTemporarySalarySummaryQuery = {}): Promise<PageResult<ReportTemporarySalarySummaryRow>> {
      return pageOf<ReportTemporarySalarySummaryRow>(
        await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }),
        '临时工工资发放汇总分页响应',
        '临时工工资发放汇总列表',
      )
    },
    async detail (query: ReportTemporarySalarySummaryDetailQuery): Promise<PageResult<ReportTemporarySalaryDetailRow>> {
      return pageOf<ReportTemporarySalaryDetailRow>(
        await request<PageResult<unknown>>({ url: DETAIL_URL, method: 'get', params: detailParamsOf(query) }),
        '临时工工资发放明细分页响应',
        '临时工工资发放明细列表',
      )
    },
  }
}

export type ReportTemporarySalarySummaryCapability = ReturnType<typeof createReportTemporarySalarySummaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const queryParams: ParamSpec[] = [
  p('organizationIdList', 'tree', false, '角色组织树多选的组织ID数组；省略或空数组表示不增加额外组织筛选，但不会绕过服务端组织权限'),
  p('useYearMonth', 'date', false, '工资月份，格式YYYY-MM；省略或null表示不按月份筛选'),
  p('status', 'enum', false, '汇总状态：0待提交、1待审核、2待付款、3已驳回、4已付款', [
    { value: 0, label: '待提交' },
    { value: 1, label: '待审核' },
    { value: 2, label: '待付款' },
    { value: 3, label: '已驳回' },
    { value: 4, label: '已付款' },
  ]),
]

export const REPORT_TEMPORARY_SALARY_SUMMARY_METHODS = {
  'report-temporary-salary-summary-list': 'list',
  'report-temporary-salary-summary-detail': 'detail',
} as const

export const reportTemporarySalarySummaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-temporary-salary-summary-list', title: '查询临时工工资发放汇总表', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-temporary-salary-summary-detail', title: '查询临时工工资发放汇总明细', write: false, params: [p('summaryId', 'number', true, '汇总表行ID'), p('name', 'text', false, '详情弹窗的姓名筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
].map(definition => ({
  ...definition,
  pagePath: REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH,
  permission: REPORT_TEMPORARY_SALARY_SUMMARY_PERMISSION,
  moduleType: REPORT_TEMPORARY_SALARY_SUMMARY_MODULE_TYPE,
  httpInstance: 'platform',
}))
