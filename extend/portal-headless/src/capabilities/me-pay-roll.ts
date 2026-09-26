import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「个人中心 → 我的工资」；Portal 3622e02147、Java c3348150f42。 */
export const ME_PAY_ROLL_PAGE_PATH = '/dashboard/me/pay-roll/list'

const LIST_URL = '/salary/report/selectPersonPayrollPage'
const WAGES_CHART_URL = '/hr/homepage/wagesLineData'
const INSURANCES_CHART_URL = '/hr/homepage/fiveInsurancesLinenData'

export type MePayRollValue = number | string | null

/**
 * The list endpoint returns DocumentUserInfoDTO. These are the columns that
 * the Portal page actually renders; the raw row is retained as well so a
 * server-side field added later is not silently discarded by the SDK.
 */
export type MePayRollRow = {
  [key: string]: unknown
  name: string | null
  month: string | null
  basicSalary: MePayRollValue
  attendanceSalary: MePayRollValue
  sickLeaveSalary: MePayRollValue
  injurySalary: MePayRollValue
  orgAssessmentSalary: MePayRollValue
  orgProfitSalary: MePayRollValue
  examineSalary: MePayRollValue
  needPaySalary: MePayRollValue
  preTaxSalary: MePayRollValue
  taxableSalary: MePayRollValue
  personalTaxSalaryTotal: MePayRollValue
  actualSalaryTotal: MePayRollValue
  personalSocialSecuritySalaryTotal: MePayRollValue
  personalProvidentFundSalaryTotal: MePayRollValue
  zykkhj: MePayRollValue
  ksqzd: MePayRollValue
  housePurchaseDeductionSalary: MePayRollValue
  otherDeductionSalary: MePayRollValue
  totalDeductionsSalary: MePayRollValue
  bonus: MePayRollValue
  welfareSalary: MePayRollValue
  tenancyPerkSalary: MePayRollValue
  educationalSubsidy: MePayRollValue
  taxSerious: MePayRollValue
  zxsYYEHH: MePayRollValue
  zxsJXJY: MePayRollValue
  zxsSYLR: MePayRollValue
  zxsZFDKLX: MePayRollValue
  zxsZFGJJ: MePayRollValue
  zxsZNJY: MePayRollValue
  pensionGJJ: MePayRollValue
  unitGJJ: MePayRollValue
  pensionDEYL: MePayRollValue
  unitDGYL: MePayRollValue
  medical: MePayRollValue
  unitZBYL: MePayRollValue
  jobLess: MePayRollValue
  unitSY: MePayRollValue
  pensionYL: MePayRollValue
  unitYL: MePayRollValue
}

export type MePayRollQuery = {
  /** Undefined follows the Portal default: the current local calendar month. */
  startYearMonth?: string | null
  endYearMonth?: string | null
  pageNo?: number
  pageSize?: number
}

export type MePayRollChartSeries = {
  name: string
  data: MePayRollValue[]
  [key: string]: unknown
}

export type MePayRollChart = {
  title: string
  xAxis: string[]
  series: MePayRollChartSeries[]
  [key: string]: unknown
}

const DISPLAY_FIELDS = [
  'basicSalary', 'attendanceSalary', 'sickLeaveSalary', 'injurySalary',
  'orgAssessmentSalary', 'orgProfitSalary', 'examineSalary', 'needPaySalary',
  'preTaxSalary', 'taxableSalary', 'personalTaxSalaryTotal', 'actualSalaryTotal',
  'personalSocialSecuritySalaryTotal', 'personalProvidentFundSalaryTotal', 'zykkhj',
  'ksqzd', 'housePurchaseDeductionSalary', 'otherDeductionSalary',
  'totalDeductionsSalary', 'bonus', 'welfareSalary', 'tenancyPerkSalary',
  'educationalSubsidy', 'taxSerious', 'zxsYYEHH', 'zxsJXJY', 'zxsSYLR',
  'zxsZFDKLX', 'zxsZFGJJ', 'zxsZNJY', 'pensionGJJ', 'unitGJJ', 'pensionDEYL',
  'unitDGYL', 'medical', 'unitZBYL', 'jobLess', 'unitSY', 'pensionYL', 'unitYL',
] as const

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function currentMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown, label: string, fallback?: string): string | null {
  if (value === undefined) return fallback ?? null
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`${label}必须是YYYY-MM格式的月份或null`)
  }
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function numberOrTextOf (value: unknown, label: string): MePayRollValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label}必须为有限数字、数字文本或null`)
    return value
  }
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为有限数字、数字文本或null`)
}

function queryOf (query: MePayRollQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  return {
    order: '',
    orderField: '',
    startYearMonth: monthOf(source.startYearMonth, 'startYearMonth', currentMonth()),
    endYearMonth: monthOf(source.endYearMonth, 'endYearMonth', currentMonth()),
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 10, 'pageSize'),
  }
}

function rowOf (value: unknown): MePayRollRow {
  const row = objectOf(value, '我的工资列表行')
  const normalized: Record<string, unknown> = { ...row }
  normalized.name = textOf(row.name, 'name')
  normalized.month = textOf(row.month, 'month')
  for (const field of DISPLAY_FIELDS) normalized[field] = numberOrTextOf(row[field], field)
  return normalized as MePayRollRow
}

function chartValueOf (value: unknown, label: string): MePayRollValue {
  return numberOrTextOf(value, label)
}

function chartOf (value: unknown, title: string): MePayRollChart {
  const chart = objectOf(value, `${title}图表响应`)
  if (!Array.isArray(chart.xAxis) || chart.xAxis.some(item => typeof item !== 'string')) {
    throw new Error(`${title}图表响应缺少字符串xAxis数组`)
  }
  if (!Array.isArray(chart.series)) throw new Error(`${title}图表响应缺少series数组`)
  const series = chart.series.map((raw, index) => {
    const item = objectOf(raw, `${title}图表series[${index}]`)
    if (typeof item.name !== 'string') throw new Error(`${title}图表series[${index}].name必须为字符串`)
    if (!Array.isArray(item.data)) throw new Error(`${title}图表series[${index}].data必须为数组`)
    return {
      ...item,
      name: item.name,
      data: item.data.map((entry, dataIndex) => chartValueOf(entry, `${title}图表series[${index}].data[${dataIndex}]`)),
    }
  })
  return { ...chart, title, xAxis: [...chart.xAxis], series }
}

/** The injected request must be bound to ME_PAY_ROLL_PAGE_PATH. */
export function createMePayRollCapability (request: PortalRequest) {
  return {
    async list (query: MePayRollQuery = {}): Promise<PageResult<MePayRollRow>> {
      const result = await request<PageResult<unknown>>({
        url: LIST_URL,
        method: 'get',
        params: queryOf(query),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('我的工资分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    async wagesChart (): Promise<MePayRollChart> {
      const result = await request<unknown>({ url: WAGES_CHART_URL, method: 'get' })
      return chartOf(result, '应发工资')
    },

    async fiveInsurancesChart (): Promise<MePayRollChart> {
      const result = await request<unknown>({ url: INSURANCES_CHART_URL, method: 'get' })
      return chartOf(result, '五险一金')
    },
  }
}

export type MePayRollCapability = ReturnType<typeof createMePayRollCapability>

const p = (name: string, kind: ParamSpec['kind'], description: string): ParamSpec => ({
  name, kind, required: false, description,
})

export const ME_PAY_ROLL_METHODS = {
  'me-pay-roll-list': 'list',
  'me-pay-roll-wages-chart': 'wagesChart',
  'me-pay-roll-five-insurances-chart': 'fiveInsurancesChart',
} as const

export const mePayRollCapabilities: CapabilityDefinition[] = [
  {
    id: 'me-pay-roll-list',
    title: '查询我的工资明细',
    write: false,
    params: [
      p('startYearMonth', 'date', '开始月份，YYYY-MM；省略时使用当前月份，传null表示清空开始月份'),
      p('endYearMonth', 'date', '结束月份，YYYY-MM；省略时使用当前月份，传null表示清空结束月份'),
      p('pageNo', 'number', '页码，默认1'),
      p('pageSize', 'number', '每页条数，页面支持10、20、50、100，默认10'),
    ],
  },
  { id: 'me-pay-roll-wages-chart', title: '查询应发工资趋势', write: false, params: [] },
  { id: 'me-pay-roll-five-insurances-chart', title: '查询五险一金趋势', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: ME_PAY_ROLL_PAGE_PATH,
  permission: '/dashboard/me/pay-roll',
  httpInstance: 'platform',
  moduleType: 14,
}))
