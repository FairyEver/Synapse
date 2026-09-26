import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 社保缴纳汇总表」及其可达的社保缴纳单表单。 */
export const REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH = '/dashboard/report/insurance-payment-summary/list'
export const REPORT_INSURANCE_PAYMENT_SUMMARY_PERMISSION = '/dashboard/report/insurance-payment-summary'
export const REPORT_INSURANCE_PAYMENT_SUMMARY_MODULE_TYPE = 14
export const SOCIAL_SECURITY_PAYMENT_PROCESS_KEY = 'social_security_payment'

const SUMMARY_LIST_URL = '/salary/salaryinsurancecosts/paymentSummaryPage'
const SUMMARY_DETAIL_URL = '/salary/salaryinsurancecosts/paymentSummaryDetailPage'
const PAYMENT_REQUIRED_TASKS_URL = '/hr/social-fund-payment/getRequiredStartUserSelectTasks'
const PAYMENT_CREATE_URL = '/hr/social-fund-payment/create'
const PAYMENT_DETAIL_URL = '/hr/social-fund-payment/get'
const PAYMENT_CANCEL_URL = '/hr/social-fund-payment/cancel'

export type ReportInsurancePaymentSummaryId = string | number
export type ReportInsurancePaymentSummaryMonthRange = readonly [string | null | undefined, string | null | undefined]
export type ReportInsurancePaymentSummaryQuery = {
  orgIds?: ReportInsurancePaymentSummaryId[] | null
  costDateRange?: ReportInsurancePaymentSummaryMonthRange | null
  pageNo?: number
  pageSize?: number
}

export type ReportInsurancePaymentSummaryRow = Record<string, unknown> & {
  id?: ReportInsurancePaymentSummaryId | null
  socialFundSummaryIds?: ReportInsurancePaymentSummaryId[] | null
  depositUnitIds?: ReportInsurancePaymentSummaryId[] | null
  depositUnitNames?: string[] | null
  organizationId?: ReportInsurancePaymentSummaryId | null
  organizationName?: string | null
  staffCount?: number | string | null
  useYearMonth?: string | null
  pensionCompany?: number | string | null
  pensionPersonal?: number | string | null
  unemploymentCompany?: number | string | null
  unemploymentPersonal?: number | string | null
  injuryCompany?: number | string | null
  injuryPersonal?: number | string | null
  medicalCompany?: number | string | null
  medicalPersonal?: number | string | null
  majorMedicalPersonal?: number | string | null
  totalCompany?: number | string | null
  totalPersonal?: number | string | null
  totalAmount?: number | string | null
  status?: number | null
}

export type ReportInsurancePaymentSummaryPersonQuery = {
  summaryId?: ReportInsurancePaymentSummaryId | null
  summaryIds?: ReportInsurancePaymentSummaryId[] | null
  depositUnitIds?: ReportInsurancePaymentSummaryId[] | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportInsurancePaymentSummaryPersonRow = Record<string, unknown> & {
  name?: string | null
  useYearMonth?: string | null
  pensionCompany?: number | string | null
  pensionPersonal?: number | string | null
  unemploymentCompany?: number | string | null
  unemploymentPersonal?: number | string | null
  injuryCompany?: number | string | null
  injuryPersonal?: number | string | null
  medicalCompany?: number | string | null
  medicalPersonal?: number | string | null
  majorMedicalPersonal?: number | string | null
  totalCompany?: number | string | null
  totalPersonal?: number | string | null
  status?: number | null
}

export type ReportInsurancePaymentSummaryPersonDetail = {
  title: string | null
  page: PageResult<ReportInsurancePaymentSummaryPersonRow>
}

export type ReportInsurancePaymentSummaryPaymentRow = Record<string, unknown> & {
  socialFundSummaryId?: ReportInsurancePaymentSummaryId | null
  socialFundSummaryIds?: ReportInsurancePaymentSummaryId[] | null
  organizationId?: ReportInsurancePaymentSummaryId | null
  organizationName?: string | null
  costCenterName?: string | null
  staffCount?: number | string | null
  socialFundPaymentId?: ReportInsurancePaymentSummaryId | null
  amount?: number | string | null
  totalPersonal?: number | string | null
  totalCompany?: number | string | null
}

export type ReportInsurancePaymentSummaryPaymentSummary = {
  socialFundSummaryId?: ReportInsurancePaymentSummaryId | null
  socialFundSummaryIds?: ReportInsurancePaymentSummaryId[] | null
  organizationId?: ReportInsurancePaymentSummaryId | null
  organizationName?: string | null
  costCenterName?: string | null
  staffCount?: number | string | null
  socialFundPaymentId?: ReportInsurancePaymentSummaryId | null
  amount?: number | string | null
  totalPersonal?: number | string | null
  totalCompany?: number | string | null
  pensionCompany?: number | string | null
  pensionPersonal?: number | string | null
  unemploymentCompany?: number | string | null
  unemploymentPersonal?: number | string | null
  injuryCompany?: number | string | null
  injuryPersonal?: number | string | null
  medicalCompany?: number | string | null
  medicalPersonal?: number | string | null
  majorMedicalPersonal?: number | string | null
}

export type ReportInsurancePaymentSummaryBudgetAllocation = {
  budgetDetailNo?: string | null
  budgetDetailId: ReportInsurancePaymentSummaryId
}

export type ReportInsurancePaymentSummaryPaymentDraft = {
  useYearMonth: string
  paymentDate: string
  name?: string | null
  organizationId: ReportInsurancePaymentSummaryId
  organizationName: string
  depositUnitIds?: ReportInsurancePaymentSummaryId[] | null
  socialFundSummaryVOList: ReportInsurancePaymentSummaryPaymentSummary[]
  budgetAllocations?: ReportInsurancePaymentSummaryBudgetAllocation[] | null
  budgetAllocationsNo?: string | null
  businessContent?: string | null
}

export type ReportInsurancePaymentSummaryStartUserSelectTask = Record<string, unknown> & { id: string }
export type ReportInsurancePaymentSummaryStartUserSelectAssignees = Record<string, Array<string | number>>
export type ReportInsurancePaymentSummaryPaymentDetail = Record<string, unknown> & {
  id?: ReportInsurancePaymentSummaryId | null
  processInstanceId?: string | null
  useYearMonth?: string | null
  paymentDate?: string | null
  name?: string | null
  organizationId?: ReportInsurancePaymentSummaryId | null
  organizationName?: string | null
  depositUnitIds?: ReportInsurancePaymentSummaryId[] | null
  depositUnitNames?: string[] | null
  totalAmount?: number | string | null
  type?: number | null
  status?: number | null
  socialFundSummaryVOList?: ReportInsurancePaymentSummaryPaymentRow[] | null
  budgetNo?: string | null
  budgetIds?: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportInsurancePaymentSummaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idsOf (value: unknown, label: string, allowEmpty = true): ReportInsurancePaymentSummaryId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  if (!allowEmpty && value.length === 0) throw new Error(`${label}不能为空`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function optionalIdOf (value: unknown, label: string): ReportInsurancePaymentSummaryId | '' {
  return value === undefined || value === null || value === '' ? '' : idOf(value, label)
}

function monthOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  return value
}

function monthRangeValueOf (value: unknown, index: 0 | 1, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (!Array.isArray(value)) throw new Error(`${label}必须为年月区间数组`)
  const month = value[index] === undefined || value[index] === null || value[index] === '' ? null : monthOf(value[index], `${label}[${index}]`)
  if (!month) return null
  return `${month}-01`
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function amountOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(amount)) throw new Error(`${label}必须为数字或十进制字符串`)
  return amount
}

function roundAmount (value: number): number {
  return Number(value.toFixed(2))
}

function listParamsOf (query: ReportInsurancePaymentSummaryQuery = {}): JsonObject {
  const range = query.costDateRange
  return {
    order: '',
    orderField: '',
    costDateStart: monthRangeValueOf(range, 0, 'costDateRange'),
    costDateEnd: monthRangeValueOf(range, 1, 'costDateRange'),
    orgIds: idsOf(query.orgIds, 'orgIds').join(','),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function personDetailParamsOf (query: ReportInsurancePaymentSummaryPersonQuery): JsonObject {
  const summaryIds = idsOf(query.summaryIds, 'summaryIds')
  const summaryId = optionalIdOf(query.summaryId, 'summaryId')
  if (summaryIds.length === 0 && summaryId === '') throw new Error('summaryId或summaryIds至少提供一个')
  if (summaryIds.length > 0 && summaryId !== '') throw new Error('summaryId与summaryIds不能同时提供')
  const summaryParam = summaryIds.length > 1
    ? { summaryIds: summaryIds.join(',') }
    : { summaryId: summaryIds[0] ?? summaryId }
  return {
    order: '',
    orderField: '',
    ...summaryParam,
    ...(idsOf(query.depositUnitIds, 'depositUnitIds').length > 0 ? { depositUnitIds: idsOf(query.depositUnitIds, 'depositUnitIds').join(',') } : {}),
    name: query.name ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf<T> (value: unknown, label: string, rowOf: (value: unknown, index: number) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map(rowOf), total: page.total }
}

function summaryRowOf (value: unknown, index: number): ReportInsurancePaymentSummaryRow {
  return { ...objectOf(value, `社保缴纳汇总列表[${index}]`) } as ReportInsurancePaymentSummaryRow
}

function personRowOf (value: unknown, index: number): ReportInsurancePaymentSummaryPersonRow {
  return { ...objectOf(value, `社保缴纳汇总人员明细[${index}]`) } as ReportInsurancePaymentSummaryPersonRow
}

function personDetailOf (value: unknown): ReportInsurancePaymentSummaryPersonDetail {
  const result = objectOf(value, '社保缴纳汇总人员明细响应')
  const page = pageOf(result.page, '社保缴纳汇总人员明细分页响应', personRowOf)
  return { title: result.title === undefined || result.title === null ? null : String(result.title), page }
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value
}

function optionalTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function buildPaymentPayload (draft: ReportInsurancePaymentSummaryPaymentDraft): JsonObject {
  const input = objectOf(draft, '社保缴纳单草稿')
  const useYearMonth = monthOf(input.useYearMonth, 'useYearMonth')
  const paymentDate = dateOf(input.paymentDate, 'paymentDate')
  const organizationId = idOf(input.organizationId, 'organizationId')
  const organizationName = requiredTextOf(input.organizationName, 'organizationName')
  const depositUnitIds = idsOf(input.depositUnitIds, 'depositUnitIds')
  const summaries = input.socialFundSummaryVOList
  if (!Array.isArray(summaries) || summaries.length === 0) throw new Error('socialFundSummaryVOList不能为空')
  const budgetAllocations = input.budgetAllocations ?? []
  if (!Array.isArray(budgetAllocations)) throw new Error('budgetAllocations必须为数组')
  const aggregateByDepositUnit = depositUnitIds.length > 0
  const socialFundSummaryVOList = summaries.map((item, index) => {
    const source = objectOf(item, `socialFundSummaryVOList[${index}]`)
    const socialFundSummaryIds = idsOf(source.socialFundSummaryIds, `socialFundSummaryVOList[${index}].socialFundSummaryIds`)
    const socialFundSummaryId = optionalIdOf(source.socialFundSummaryId, `socialFundSummaryVOList[${index}].socialFundSummaryId`)
    if (aggregateByDepositUnit ? socialFundSummaryIds.length === 0 : socialFundSummaryId === '') throw new Error('请选择金额明细中的部门')
    const amount = roundAmount(
      amountOf(source.amount, `socialFundSummaryVOList[${index}].amount`) ||
      amountOf(source.totalAmount, `socialFundSummaryVOList[${index}].totalAmount`) ||
      amountOf(source.totalPersonal, `socialFundSummaryVOList[${index}].totalPersonal`) +
      amountOf(source.totalCompany, `socialFundSummaryVOList[${index}].totalCompany`),
    )
    const result: JsonObject = { ...source, amount }
    delete result.depositUnitIds
    delete result.depositUnitNames
    if (aggregateByDepositUnit) delete result.socialFundSummaryId
    else delete result.socialFundSummaryIds
    return result
  })
  return {
    useYearMonth,
    name: optionalTextOf(input.name, 'name'),
    organizationId,
    organizationName,
    ...(aggregateByDepositUnit ? { depositUnitIds } : {}),
    paymentDate,
    type: 1,
    totalAmount: roundAmount(socialFundSummaryVOList.reduce((sum, item) => sum + amountOf(item.amount, 'amount'), 0)),
    socialFundSummaryVOList,
    budgetAllocationsNo: input.budgetAllocationsNo === undefined || input.budgetAllocationsNo === null ? '' : optionalTextOf(input.budgetAllocationsNo, 'budgetAllocationsNo'),
    businessContent: input.businessContent === undefined ? null : input.businessContent,
    budgetAllocations: budgetAllocations.map((item, index) => {
      const allocation = objectOf(item, `budgetAllocations[${index}]`)
      return {
        budgetDetailNo: allocation.budgetDetailNo === undefined || allocation.budgetDetailNo === null ? null : optionalTextOf(allocation.budgetDetailNo, `budgetAllocations[${index}].budgetDetailNo`),
        budgetDetailId: idOf(allocation.budgetDetailId, `budgetAllocations[${index}].budgetDetailId`),
      }
    }),
  }
}

function tasksOf (value: unknown): ReportInsurancePaymentSummaryStartUserSelectTask[] {
  if (!Array.isArray(value)) throw new Error('社保缴纳单审批节点响应必须是数组')
  return value.map((item, index) => {
    const task = objectOf(item, `社保缴纳单审批节点[${index}]`)
    return { ...task, id: requiredTextOf(task.id, `社保缴纳单审批节点[${index}].id`) }
  }) as ReportInsurancePaymentSummaryStartUserSelectTask[]
}

function normalizeAssignees (tasks: ReportInsurancePaymentSummaryStartUserSelectTask[], value: unknown): JsonObject {
  const assignees = objectOf(value, 'startUserSelectAssignees')
  const taskIds = new Set(tasks.map(task => task.id))
  for (const task of tasks) {
    const selected = assignees[task.id]
    if (!Array.isArray(selected) || selected.length === 0) throw new Error(`startUserSelectAssignees[${task.id}]不能为空`)
  }
  for (const [taskId, selected] of Object.entries(assignees)) {
    if (!taskIds.has(taskId)) throw new Error(`startUserSelectAssignees包含未知节点${taskId}`)
    if (!Array.isArray(selected) || selected.length === 0) throw new Error(`startUserSelectAssignees[${taskId}]不能为空`)
    selected.forEach((id, index) => { if (id === null || id === undefined || String(id).trim() === '' || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error(`startUserSelectAssignees[${taskId}][${index}]必须为正整数用户ID`) })
  }
  return Object.fromEntries(Object.entries(assignees).map(([taskId, selected]) => [taskId, (selected as Array<string | number>).map(id => Number(id))]))
}

export function createReportInsurancePaymentSummaryCapability (request: PortalRequest) {
  const requiredTasks = async (payload: JsonObject): Promise<ReportInsurancePaymentSummaryStartUserSelectTask[]> => tasksOf(await request<unknown>({ url: PAYMENT_REQUIRED_TASKS_URL, method: 'post', data: payload }))
  return {
    async list (query: ReportInsurancePaymentSummaryQuery = {}): Promise<PageResult<ReportInsurancePaymentSummaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: SUMMARY_LIST_URL, method: 'get', params: listParamsOf(query) }), '社保缴纳汇总分页响应', summaryRowOf)
    },
    async personDetail (query: ReportInsurancePaymentSummaryPersonQuery): Promise<ReportInsurancePaymentSummaryPersonDetail> {
      return personDetailOf(await request<unknown>({ url: SUMMARY_DETAIL_URL, method: 'get', params: personDetailParamsOf(query) }))
    },
    async prepare (draft: ReportInsurancePaymentSummaryPaymentDraft): Promise<{ payload: JsonObject; tasks: ReportInsurancePaymentSummaryStartUserSelectTask[] }> {
      const payload = buildPaymentPayload(draft)
      return { payload, tasks: await requiredTasks(payload) }
    },
    async submit (draft: ReportInsurancePaymentSummaryPaymentDraft, startUserSelectAssignees: ReportInsurancePaymentSummaryStartUserSelectAssignees = {}): Promise<ReportInsurancePaymentSummaryId> {
      const payload = buildPaymentPayload(draft)
      const tasks = await requiredTasks(payload)
      const normalized = normalizeAssignees(tasks, startUserSelectAssignees)
      return idOf(await request<unknown>({ url: PAYMENT_CREATE_URL, method: 'post', data: { ...payload, startUserSelectAssignees: normalized } }), '社保缴纳单返回ID')
    },
    async paymentDetail (id: ReportInsurancePaymentSummaryId): Promise<ReportInsurancePaymentSummaryPaymentDetail | null> {
      const result = await request<unknown>({ url: PAYMENT_DETAIL_URL, method: 'get', params: { id: idOf(id, 'id') } })
      return result === null || result === undefined ? null : objectOf(result, '社保缴纳单详情') as ReportInsurancePaymentSummaryPaymentDetail
    },
    async cancel (id: ReportInsurancePaymentSummaryId): Promise<boolean> {
      return Boolean(await request<unknown>({ url: PAYMENT_CANCEL_URL, method: 'post', params: { id: idOf(id, 'id') } }))
    },
  }
}

export type ReportInsurancePaymentSummaryCapability = ReturnType<typeof createReportInsurancePaymentSummaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const listParams: ParamSpec[] = [p('orgIds', 'tree', false, '角色组织树选中的部门ID数组；请求时连接为逗号字符串'), p('costDateRange', 'date', false, '年月区间，按Portal转换成YYYY-MM-01的起止日期')]
const personParams: ParamSpec[] = [p('summaryId', 'text', false, '单个社保汇总单ID；与summaryIds二选一'), p('summaryIds', 'text', false, '多个社保汇总单ID；与summaryId二选一'), p('depositUnitIds', 'text', false, '缴存单位ID数组；请求时连接为逗号字符串'), p('name', 'text', false, '员工姓名')]
const paymentParams: ParamSpec[] = [p('draft', 'text', true, '按Portal社保缴纳单字段契约填写的草稿'), p('startUserSelectAssignees', 'text', false, 'prepare返回节点ID到用户ID数组的映射')]

export const REPORT_INSURANCE_PAYMENT_SUMMARY_METHODS = {
  'report-insurance-payment-summary-list': 'list',
  'report-insurance-payment-summary-person-detail': 'personDetail',
  'report-insurance-payment-summary-prepare': 'prepare',
  'report-insurance-payment-summary-submit': 'submit',
  'report-insurance-payment-summary-payment-detail': 'paymentDetail',
  'report-insurance-payment-summary-cancel': 'cancel',
} as const

export const reportInsurancePaymentSummaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-insurance-payment-summary-list', title: '查询社保缴纳汇总表', write: false, params: [...listParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-insurance-payment-summary-person-detail', title: '查询社保缴纳汇总人员明细', write: false, params: [...personParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-insurance-payment-summary-prepare', title: '准备社保缴纳单提交', write: false, params: [paymentParams[0]!] },
  { id: 'report-insurance-payment-summary-submit', title: '提交社保缴纳单审批', write: true, params: paymentParams },
  { id: 'report-insurance-payment-summary-payment-detail', title: '查询社保缴纳单详情', write: false, params: [p('id', 'text', true, '社保缴纳单业务ID')] },
  { id: 'report-insurance-payment-summary-cancel', title: '撤销社保缴纳单', write: true, params: [p('id', 'text', true, '社保缴纳单业务ID')] },
].map(definition => ({ ...definition, pagePath: REPORT_INSURANCE_PAYMENT_SUMMARY_PAGE_PATH, permission: REPORT_INSURANCE_PAYMENT_SUMMARY_PERMISSION, moduleType: REPORT_INSURANCE_PAYMENT_SUMMARY_MODULE_TYPE, httpInstance: 'platform' }))
