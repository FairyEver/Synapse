import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 退休人员工资发放汇总表」。 */
export const REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH = '/dashboard/report/retirement-salary-summary/list'
export const REPORT_RETIREMENT_SALARY_SUMMARY_PERMISSION = '/dashboard/report/retirement-salary-summary'
export const REPORT_RETIREMENT_SALARY_SUMMARY_MODULE_TYPE = 14

const LIST_URL = '/hr/retire-staff-salary-summary/page'
const DETAIL_URL = '/hr/retire-staff-salary-summary/retireStaffByPage'

export type ReportRetirementSalarySummaryId = string | number
export type ReportRetirementSalarySummaryStatus = 0 | 1 | 2 | 3 | 4

export type ReportRetirementSalarySummaryQuery = {
  organizationId?: ReportRetirementSalarySummaryId | null
  useYearMonth?: string | null
  status?: ReportRetirementSalarySummaryStatus | null
  pageNo?: number
  pageSize?: number
}

export type ReportRetirementSalarySummaryRow = Record<string, unknown> & {
  id?: ReportRetirementSalarySummaryId | null
  organizationId?: ReportRetirementSalarySummaryId | null
  organizationName?: string | null
  staffCount?: number | string | null
  useYearMonth?: string | null
  enterpriseSalary?: number | string | null
  heatingFee?: number | string | null
  holidayAllowance?: number | string | null
  additionalInsurance?: number | string | null
  subsidy?: number | string | null
  transportFee?: number | string | null
  bookFee?: number | string | null
  laborFee?: number | string | null
  laundryFee?: number | string | null
  medicineFee?: number | string | null
  otherFee?: number | string | null
  actualAmount?: number | string | null
  status?: number | null
}

export type ReportRetirementSalarySummaryDetailQuery = {
  summaryId: ReportRetirementSalarySummaryId
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportRetirementSalaryDetailRow = Record<string, unknown> & {
  id?: ReportRetirementSalarySummaryId | null
  useYearMonth?: string | null
  name?: string | null
  idCard?: string | null
  organizationName?: string | null
  enterpriseSalary?: number | string | null
  heatingFee?: number | string | null
  holidayAllowance?: number | string | null
  additionalInsurance?: number | string | null
  subsidy?: number | string | null
  transportFee?: number | string | null
  bookFee?: number | string | null
  laborFee?: number | string | null
  laundryFee?: number | string | null
  medicineFee?: number | string | null
  otherFee?: number | string | null
  actualAmount?: number | string | null
  status?: number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportRetirementSalarySummaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportRetirementSalarySummaryId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
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

function statusOf (value: unknown, label: string): ReportRetirementSalarySummaryStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || ![0, 1, 2, 3, 4].includes(value as number)) throw new Error(`${label}必须为0、1、2、3或4`)
  return value as ReportRetirementSalarySummaryStatus
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: ReportRetirementSalarySummaryQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    organizationId: optionalIdOf(query.organizationId, 'organizationId'),
    useYearMonth: monthOf(query.useYearMonth, 'useYearMonth'),
    status: statusOf(query.status, 'status'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function detailParamsOf (query: ReportRetirementSalarySummaryDetailQuery): JsonObject {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('退休人员工资明细查询必须是对象')
  return {
    order: '',
    orderField: '',
    retireStaffSalarySummaryId: idOf(query.summaryId, 'summaryId'),
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

export function createReportRetirementSalarySummaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportRetirementSalarySummaryQuery = {}): Promise<PageResult<ReportRetirementSalarySummaryRow>> {
      return pageOf<ReportRetirementSalarySummaryRow>(
        await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }),
        '退休人员工资发放汇总分页响应',
        '退休人员工资发放汇总列表',
      )
    },
    async detail (query: ReportRetirementSalarySummaryDetailQuery): Promise<PageResult<ReportRetirementSalaryDetailRow>> {
      return pageOf<ReportRetirementSalaryDetailRow>(
        await request<PageResult<unknown>>({ url: DETAIL_URL, method: 'get', params: detailParamsOf(query) }),
        '退休人员工资发放汇总明细分页响应',
        '退休人员工资发放明细列表',
      )
    },
  }
}

export type ReportRetirementSalarySummaryCapability = ReturnType<typeof createReportRetirementSalarySummaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const queryParams: ParamSpec[] = [
  p('organizationId', 'tree', false, '角色组织树选中的组织ID；省略或null表示不按组织筛选'),
  p('useYearMonth', 'date', false, '工资月份，格式YYYY-MM；省略或null表示不按月份筛选'),
  p('status', 'enum', false, '汇总状态：0待提交、1审批中、2审批通过、3已驳回、4已取消', [
    { value: 0, label: '待提交（草稿）' },
    { value: 1, label: '已提交-审批中' },
    { value: 2, label: '已审批-审批通过' },
    { value: 3, label: '已驳回' },
    { value: 4, label: '已取消' },
  ]),
]

export const REPORT_RETIREMENT_SALARY_SUMMARY_METHODS = {
  'report-retirement-salary-summary-list': 'list',
  'report-retirement-salary-summary-detail': 'detail',
} as const

export const reportRetirementSalarySummaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-retirement-salary-summary-list', title: '查询退休人员工资发放汇总表', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-retirement-salary-summary-detail', title: '查询退休人员工资发放汇总明细', write: false, params: [p('summaryId', 'number', true, '汇总表行ID'), p('name', 'text', false, '详情弹窗的姓名筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
].map(definition => ({
  ...definition,
  pagePath: REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH,
  permission: REPORT_RETIREMENT_SALARY_SUMMARY_PERMISSION,
  moduleType: REPORT_RETIREMENT_SALARY_SUMMARY_MODULE_TYPE,
  httpInstance: 'platform',
}))
