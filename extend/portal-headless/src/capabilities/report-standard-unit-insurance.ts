import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 薪资报表 → 五险一金汇总表（标准化单元维度）」能力。 */
export const REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH = '/dashboard/report/insurance-summary/list'
export const REPORT_STANDARD_UNIT_INSURANCE_PERMISSION = '/dashboard/report/insurance-summary'
export const REPORT_STANDARD_UNIT_INSURANCE_MODULE_TYPE = 14

const LIST_URL = '/salary/report/standardUnitCostsPage'

export type ReportStandardUnitInsuranceId = string | number
export type ReportStandardUnitInsuranceQuery = {
  standardUnitId?: ReportStandardUnitInsuranceId | null
  costMonth?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportStandardUnitInsuranceRow = Record<string, unknown> & {
  costCenterName?: string | null
  costCenterId?: ReportStandardUnitInsuranceId | null
  standardUnitName?: string | null
  standardUnitId?: ReportStandardUnitInsuranceId | null
  costMonth?: string | null
  fiveInsurancePersonNum?: number | string | null
  providentFundPersonNum?: number | string | null
  pensionUnitCost?: number | string | null
  unemploymentUnitCost?: number | string | null
  workInjuryUnitCost?: number | string | null
  maternityUnitCost?: number | string | null
  medicalUnitCost?: number | string | null
  fiveInsuranceUnitCostTotal?: number | string | null
  providentFundUnitCost?: number | string | null
  pensionPersonalCost?: number | string | null
  unemploymentPersonalCost?: number | string | null
  medicalPersonalCost?: number | string | null
  majorMedicalPersonalCost?: number | string | null
  fiveInsurancePersonalCostTotal?: number | string | null
  providentFundPersonalCost?: number | string | null
  companyBase?: number | string | null
  individualBase?: number | string | null
  companyRatio?: number | string | null
  individualRatio?: number | string | null
  month?: number | null
  staffCode?: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportStandardUnitInsuranceId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportStandardUnitInsuranceId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function currentMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown): string | null {
  if (value === undefined) return currentMonth()
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('costMonth必须为YYYY-MM')
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: ReportStandardUnitInsuranceQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    standardUnitId: optionalIdOf(query.standardUnitId, 'standardUnitId'),
    costMonth: monthOf(query.costMonth),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportStandardUnitInsuranceRow> {
  const page = objectOf(value, '标准化单元五险一金汇总分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('标准化单元五险一金汇总分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => ({ ...objectOf(item, `标准化单元五险一金汇总列表[${index}]`) } as ReportStandardUnitInsuranceRow)),
    total: page.total,
  }
}

export function createReportStandardUnitInsuranceCapability (request: PortalRequest) {
  return {
    async list (query: ReportStandardUnitInsuranceQuery = {}): Promise<PageResult<ReportStandardUnitInsuranceRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
  }
}

export type ReportStandardUnitInsuranceCapability = ReturnType<typeof createReportStandardUnitInsuranceCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [p('standardUnitId', 'text', false, '角色组织树选中的标准化经营单元ID；未选择时发送null'), p('costMonth', 'date', false, '费用归属月份，格式YYYY-MM；省略时按Portal默认当前月份')]

export const REPORT_STANDARD_UNIT_INSURANCE_METHODS = {
  'report-standard-unit-insurance-list': 'list',
} as const

export const reportStandardUnitInsuranceCapabilities: CapabilityDefinition[] = [
  { id: 'report-standard-unit-insurance-list', title: '查询标准化单元五险一金汇总', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
].map(definition => ({ ...definition, pagePath: REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH, permission: REPORT_STANDARD_UNIT_INSURANCE_PERMISSION, moduleType: REPORT_STANDARD_UNIT_INSURANCE_MODULE_TYPE, httpInstance: 'platform' }))
