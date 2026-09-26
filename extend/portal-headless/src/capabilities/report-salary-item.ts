import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 工资项目统计」。 */
export const REPORT_SALARY_ITEM_PAGE_PATH = '/dashboard/report/salary-item/list'
export const REPORT_SALARY_ITEM_PERMISSION = '/dashboard/report/salary-item'
export const REPORT_SALARY_ITEM_MODULE_TYPE = 14

const LIST_URL = '/salary/report/staffSalaryItemPage'
const EXPORT_URL = '/admin-api/salary/report/exportStaffSalaryItem'

export type ReportSalaryItemId = string | number
export type ReportSalaryItemMonthRange = readonly [string | null | undefined, string | null | undefined]
export type ReportSalaryItemQuery = {
  /** Portal月份范围；省略使用上月到本月，列表显式清空时按页面required规则失败。 */
  yearMonth?: ReportSalaryItemMonthRange | null
  organizationId?: ReportSalaryItemId | null
  name?: string | null
  staffCode?: string | number | null
  ledgerIds?: Array<ReportSalaryItemId> | null
  pageNo?: number
  pageSize?: number
}

export const REPORT_SALARY_ITEM_AMOUNT_FIELDS = [
  ['basicSalaryTotal', '基本工资(汇总)'],
  ['assessmentSalaryTotal', '考核工资(汇总)'],
  ['orgAssessmentSalaryTotal', '部门考核工资(汇总)'],
  ['orgProfitSalarySalaryTotal', '利润考核工资(汇总)'],
  ['overWorkSalaryTotal', '加班工资(汇总)'],
  ['educationSalaryTotal', '学历补贴(汇总)'],
  ['workYearSalaryTotal', '工龄补贴(汇总)'],
  ['communicationSalaryTotal', '通讯补贴(汇总)'],
  ['labourSalaryTotal', '劳动费(汇总)'],
  ['closureSalaryTotal', '封场费(汇总)'],
  ['dutySalaryTotal', '值班费(汇总)'],
  ['otherSalaryTotal', '其他工资(汇总)'],
  ['heatstrokePreventionSalaryTotal', '防暑费(汇总)'],
  ['heatingSalaryTotal', '取暖费(汇总)'],
  ['tenancyPerkSalaryTotal', '租房补贴(汇总)'],
  ['singleChildSalaryTotal', '独生子女补贴(汇总)'],
  ['otherWelfareSalaryTotal', '其他福利(汇总)'],
  ['bonusSalaryTotal', '奖金(汇总)'],
  ['fullAttendanceSalaryTotal', '全勤奖(汇总)'],
  ['highProductivitySalaryTotal', '高产奖金(汇总)'],
  ['stableProductivitySalaryTotal', '稳产奖金(汇总)'],
  ['projectSalaryTotal', '项目奖金(汇总)'],
  ['trainingSalaryTotal', '培训奖金(汇总)'],
  ['articleSalaryTotal', '稿费(汇总)'],
  ['benefitSalaryTotal', '效益奖(汇总)'],
  ['shouldSalaryTotal', '应发工资(汇总)'],
  ['oldAgeSalaryTotal', '养老(汇总)'],
  ['unemploymentSalaryTotal', '失业(汇总)'],
  ['medicalSalaryTotal', '医疗(汇总)'],
  ['largeMedicalSalaryTotal', '大额医疗(汇总)'],
  ['personalSocialSecuritySalaryTotal', '个人社保(汇总)'],
  ['personalProvidentFundSalaryTotal', '个人公积金(汇总)'],
  ['taxableSalaryTotal', '应税工资(汇总)'],
  ['personalTaxSalaryTotal', '个税(汇总)'],
  ['housePurchaseDeductionSalaryTotal', '购房扣款(汇总)'],
  ['otherDeductionSalaryTotal', '其他扣款(汇总)'],
  ['healthDeductionSalaryTotal', '安康扣款(汇总)'],
  ['deductionSalaryTotal', '扣款合计(汇总)'],
  ['actualSalaryTotal', '实发工资(汇总)'],
] as const

export type ReportSalaryItemRow = Record<string, unknown> & {
  orgName?: string | null
  name?: string | null
  staffCode?: number | string | null
  startYearMonth?: string | null
  endYearMonth?: string | null
  basicSalaryTotal?: number | string | null
  assessmentSalaryTotal?: number | string | null
  orgAssessmentSalaryTotal?: number | string | null
  orgProfitSalarySalaryTotal?: number | string | null
  overWorkSalaryTotal?: number | string | null
  educationSalaryTotal?: number | string | null
  workYearSalaryTotal?: number | string | null
  communicationSalaryTotal?: number | string | null
  labourSalaryTotal?: number | string | null
  closureSalaryTotal?: number | string | null
  dutySalaryTotal?: number | string | null
  otherSalaryTotal?: number | string | null
  heatstrokePreventionSalaryTotal?: number | string | null
  heatingSalaryTotal?: number | string | null
  tenancyPerkSalaryTotal?: number | string | null
  singleChildSalaryTotal?: number | string | null
  otherWelfareSalaryTotal?: number | string | null
  bonusSalaryTotal?: number | string | null
  fullAttendanceSalaryTotal?: number | string | null
  highProductivitySalaryTotal?: number | string | null
  stableProductivitySalaryTotal?: number | string | null
  projectSalaryTotal?: number | string | null
  trainingSalaryTotal?: number | string | null
  articleSalaryTotal?: number | string | null
  benefitSalaryTotal?: number | string | null
  shouldSalaryTotal?: number | string | null
  oldAgeSalaryTotal?: number | string | null
  unemploymentSalaryTotal?: number | string | null
  medicalSalaryTotal?: number | string | null
  largeMedicalSalaryTotal?: number | string | null
  personalSocialSecuritySalaryTotal?: number | string | null
  personalProvidentFundSalaryTotal?: number | string | null
  taxableSalaryTotal?: number | string | null
  personalTaxSalaryTotal?: number | string | null
  housePurchaseDeductionSalaryTotal?: number | string | null
  otherDeductionSalaryTotal?: number | string | null
  healthDeductionSalaryTotal?: number | string | null
  deductionSalaryTotal?: number | string | null
  actualSalaryTotal?: number | string | null
}

export type ReportSalaryItemFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportSalaryItemId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportSalaryItemId | '' {
  return value === undefined || value === null || value === '' ? '' : idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function staffCodeOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('staffCode必须为非负整数')
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  throw new Error('staffCode必须为数字员工号')
}

function monthAtOffset (offset: number): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function monthRangeOf (value: unknown, required: boolean): [string, string] {
  if (value === undefined) return [monthAtOffset(-1), monthAtOffset(0)]
  if (value === null || value === '') {
    if (required) throw new Error('yearMonth必填（页面rules.yearMonth是required）')
    return ['', '']
  }
  if (!Array.isArray(value)) throw new Error('yearMonth必须为年月区间数组')
  const range = [monthOf(value[0], 'yearMonth[0]'), monthOf(value[1], 'yearMonth[1]')] as [string, string]
  if (required && (!range[0] || !range[1])) throw new Error('yearMonth必填（页面rules.yearMonth是required）')
  return range
}

function idsOf (value: unknown): ReportSalaryItemId[] {
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

function formOf (query: ReportSalaryItemQuery = {}, requiredRange = false): JsonObject {
  const [startYearMonth, endYearMonth] = monthRangeOf(query.yearMonth, requiredRange)
  return {
    organizationId: optionalIdOf(query.organizationId, 'organizationId'),
    name: textOf(query.name, 'name'),
    staffCode: staffCodeOf(query.staffCode),
    startYearMonth,
    endYearMonth,
    ledgerIds: idsOf(query.ledgerIds).join(','),
  }
}

function listParamsOf (query: ReportSalaryItemQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query, true),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportSalaryItemRow> {
  const page = objectOf(value, '工资项目统计分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('工资项目统计分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `工资项目统计列表[${index}]`) } as ReportSalaryItemRow)), total: page.total }
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

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportSalaryItemFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('工资项目统计导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: fileNameOf(response, '工资项目统计.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

export function createReportSalaryItemCapability (request: PortalRequest) {
  return {
    async list (query: ReportSalaryItemQuery = {}): Promise<PageResult<ReportSalaryItemRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportSalaryItemQuery = {}): Promise<ReportSalaryItemFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportSalaryItemCapability = ReturnType<typeof createReportSalaryItemCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('organizationId', 'tree', false, '角色组织树选中的部门ID；服务端展开为后代组织范围'),
  p('name', 'text', false, '员工姓名模糊查询'),
  p('staffCode', 'text', false, '员工号；页面输入为文本，后端按Long接收'),
  p('yearMonth', 'date', false, '开始到结束的年月区间；省略使用上月到本月，列表显式清空违反页面required规则'),
  p('ledgerIds', 'text', false, '薪资账套ID数组；请求时按选中顺序连接为逗号字符串'),
]

export const REPORT_SALARY_ITEM_METHODS = {
  'report-salary-item-list': 'list',
  'report-salary-item-export': 'export',
} as const

export const reportSalaryItemCapabilities: CapabilityDefinition[] = [
  { id: 'report-salary-item-list', title: '查询工资项目统计', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-salary-item-export', title: '导出工资项目统计', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_SALARY_ITEM_PAGE_PATH, permission: REPORT_SALARY_ITEM_PERMISSION, moduleType: REPORT_SALARY_ITEM_MODULE_TYPE, httpInstance: 'platform' }))
