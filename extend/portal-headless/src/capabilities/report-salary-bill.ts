import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 工资单查询」。 */
export const REPORT_SALARY_BILL_PAGE_PATH = '/dashboard/report/salary-bill/list'
export const REPORT_SALARY_BILL_PERMISSION = '/dashboard/report/salary-bill'
export const REPORT_SALARY_BILL_MODULE_TYPE = 14

const LIST_URL = '/salary/report/selectPayrollPage'
const EXPORT_URL = '/admin-api/salary/report/exportPayrollPage'

export type ReportSalaryBillId = string | number
export type ReportSalaryBillQuery = {
  /** Portal月份控件值；省略使用当前月，显式null/空串按页面规则发送空year/month。 */
  yearMonth?: string | null
  name?: string | null
  staffCode?: string | number | null
  costCenterId?: ReportSalaryBillId | null
  legalPersonId?: ReportSalaryBillId | null
  payrollUnitId?: ReportSalaryBillId | null
  /** 岗位组件选择后实际提交的岗位ID。 */
  postId?: ReportSalaryBillId | null
  organizationId?: ReportSalaryBillId | null
  documentName?: string | null
  ledgerId?: ReportSalaryBillId | null
  pageNo?: number
  pageSize?: number
}

export const REPORT_SALARY_BILL_PAYROLL_FIELDS = [
  ['basicSalary', '基本工资'],
  ['attendanceSalary', '出勤工资'],
  ['sickLeaveSalary', '病假工资'],
  ['injurySalary', '工伤工资'],
  ['examineSalary', '考核工资'],
  ['orgAssessmentSalary', '部门考核工资'],
  ['orgProfitSalary', '利润考核工资'],
  ['overWorkSalary', '加班工资'],
  ['weekdayOvertime', '工作日加班'],
  ['weekendOvertime', '双休日加班'],
  ['statutoryHolidayOvertime', '法定节假日加班'],
  ['closureFee', '封场费'],
  ['laborFee', '劳动费'],
  ['dutyFee', '值班费'],
  ['welfareSalary', '福利性补贴'],
  ['educationAllowance', '学历补贴'],
  ['seniorityAllowance', '工龄补贴'],
  ['communicationAllowance', '通讯补贴'],
  ['heatstrokePreventionFee', '防暑费'],
  ['heatingFee', '取暖费'],
  ['tenancyPerk', '租房补贴'],
  ['onlyChildrenPerk', '独生子女补贴'],
  ['otherPerk', '其他福利'],
  ['bonus', '奖金'],
  ['fullAttendanceBonus', '全勤奖'],
  ['benefitBonus', '效益奖'],
  ['highProductivitySalary', '高产奖金'],
  ['stableProductivitySalary', '稳产奖金'],
  ['projectSalary', '项目奖金'],
  ['trainingSalary', '培训奖金'],
  ['contributionFeeSalary', '稿费'],
  ['otherSalary', '其他工资'],
  ['grossSalary', '应发工资'],
  ['pensionInsuranceSalary', '养老'],
  ['unemploymentInsuranceSalary', '失业'],
  ['medicalInsuranceSalary', '医疗'],
  ['bigMedicalSalary', '大额医疗'],
  ['personalSocialSecuritySalary', '个人社保'],
  ['personalProvidentFundSalary', '个人公积金'],
  ['incomeTaxSalary', '个税'],
  ['housePurchaseDeductionSalary', '购房扣款'],
  ['otherDeductionsSalary', '其他扣款'],
  ['healthInsuranceDeductionSalary', '安康扣款'],
  ['totalDeductionsSalary', '扣款合计'],
  ['totalAdditionalPriceSalary', '累计专项附加扣除'],
  ['totalSupportOldPriceSalary', '累计赡养老人扣除'],
  ['totalTaxSalary', '累计应缴纳个税'],
  ['totalHouseInterestPriceSalary', '累计住房贷款利息扣除'],
  ['totalHouseRentPriceSalary', '累计住房租金扣除'],
  ['totalChildEducationPriceSalary', '累计子女教育扣除'],
  ['totalInfantCarePriceSalary', '累计婴幼儿照护扣除'],
  ['totalAdultEducationPriceSalary', '累计继续教育扣除'],
  ['totalPaidTaxSalary', '累计已缴纳个税'],
  ['realPaySalary', '实发工资'],
  ['preTaxSalary', '税前工资'],
  ['taxableSalary', '应税工资'],
  ['totalAdditionalSalary', '专项附加扣除'],
  ['adultEducationSalary', '继续教育'],
  ['supportOldSalary', '赡养老人'],
  ['houseInterestSalary', '住房贷款利息'],
  ['houseRentSalary', '住房租金'],
  ['childEducationSalary', '子女教育'],
  ['infantCareSalary', '婴幼儿照护'],
  ['seriousIllnessSalary', '大病医疗'],
  ['totalSpecialDeductionSalary', '往期专项扣款合计'],
  ['totalTaxPointSalary', '累计起征点'],
  ['totalPreTaxSalary', '往期税前工资合计'],
] as const

export type ReportSalaryBillRow = Record<string, unknown> & {
  name?: string | null
  staffCode?: number | string | null
  idCard?: string | null
  costCenterName?: string | null
  legalPersonName?: string | null
  payrollUnit?: string | null
  postName?: string | null
  orgName?: string | null
  documentName?: string | null
  ledgerName?: string | null
  salaryYearMonth?: string | null
  bankAccount?: string | null
  bankName?: string | null
  shouldAttendanceDays?: number | null
  actualAttendanceDays?: number | null
  preTaxSalary?: number | string | null
  month?: number | null
}

export type ReportSalaryBillFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportSalaryBillId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportSalaryBillId | '' {
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

function currentYearMonth (): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function yearMonthOf (value: unknown): string {
  if (value === undefined) return currentYearMonth()
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('yearMonth必须为YYYY-MM')
  return value
}

function splitYearMonth (value: unknown): { year: string; month: string } {
  const normalized = yearMonthOf(value)
  return normalized ? { year: normalized.slice(0, 4), month: normalized.slice(5, 7) } : { year: '', month: '' }
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function formParamsOf (query: ReportSalaryBillQuery = {}): JsonObject {
  const { year, month } = splitYearMonth(query.yearMonth)
  return {
    name: textOf(query.name, 'name'),
    staffCode: staffCodeOf(query.staffCode),
    costCenterId: optionalIdOf(query.costCenterId, 'costCenterId'),
    legalPersonId: optionalIdOf(query.legalPersonId, 'legalPersonId'),
    payrollUnitId: optionalIdOf(query.payrollUnitId, 'payrollUnitId'),
    postId: optionalIdOf(query.postId, 'postId'),
    organizationId: optionalIdOf(query.organizationId, 'organizationId'),
    documentName: textOf(query.documentName, 'documentName'),
    ledgerId: optionalIdOf(query.ledgerId, 'ledgerId'),
    year,
    month,
  }
}

function listParamsOf (query: ReportSalaryBillQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formParamsOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportSalaryBillRow> {
  const page = objectOf(value, '工资单查询分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('工资单查询分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `工资单查询列表[${index}]`) } as ReportSalaryBillRow)), total: page.total }
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

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportSalaryBillFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('工资单查询导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: fileNameOf(response, '工资单查询.xlsx'), contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

export function createReportSalaryBillCapability (request: PortalRequest) {
  return {
    async list (query: ReportSalaryBillQuery = {}): Promise<PageResult<ReportSalaryBillRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async export (query: ReportSalaryBillQuery = {}): Promise<ReportSalaryBillFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: formParamsOf(query), responseType: 'arraybuffer' }))
    },
  }
}

export type ReportSalaryBillCapability = ReturnType<typeof createReportSalaryBillCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('yearMonth', 'date', false, '工资年月，格式YYYY-MM；省略使用当前月，清空发送空year/month'),
  p('name', 'text', false, '姓名模糊查询'),
  p('staffCode', 'text', false, '员工号；页面输入为文本，后端按Long接收'),
  p('costCenterId', 'number', false, '成本单位ID；页面状态保留但当前页面没有可见控件'),
  p('legalPersonId', 'number', false, '纳税单位ID'),
  p('payrollUnitId', 'tree', false, '发薪单位组织ID'),
  p('postId', 'tree', false, '岗位组件选中的岗位ID，最终请求字段为postId'),
  p('organizationId', 'tree', false, '部门组织ID；服务端展开为可见组织范围'),
  p('documentName', 'text', false, '单据名称模糊查询'),
  p('ledgerId', 'number', false, '所属账套ID；省略时服务端使用当前网页可见账套集合'),
]

export const REPORT_SALARY_BILL_METHODS = {
  'report-salary-bill-list': 'list',
  'report-salary-bill-export': 'export',
} as const

export const reportSalaryBillCapabilities: CapabilityDefinition[] = [
  { id: 'report-salary-bill-list', title: '查询工资单', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-salary-bill-export', title: '导出工资单', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: REPORT_SALARY_BILL_PAGE_PATH, permission: REPORT_SALARY_BILL_PERMISSION, moduleType: REPORT_SALARY_BILL_MODULE_TYPE, httpInstance: 'platform' }))
