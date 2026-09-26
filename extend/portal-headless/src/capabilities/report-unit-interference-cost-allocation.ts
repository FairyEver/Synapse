import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 单元间人员混用费用分摊表」。 */
export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH = '/dashboard/report/unit-interference-cost-allocation/list'
export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION = '/dashboard/report/unit-interference-cost-allocation'
export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE = 14

export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PROCESS_KEY = 'unit_staff_salary_expense'

const ROOT = '/hr/unit-staff-salary-expense'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const STAFF_PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const
const MAX_AMOUNT = 9_999_999_999.99
const AMOUNT_FIELDS = [
  'salaryAmount',
  'insuranceAmount',
  'welfareAmount',
  'otherAmount',
  'providentFundAmount',
] as const

export type ReportUnitInterferenceCostAllocationId = string | number
export type ReportUnitInterferenceCostAllocationStatus = 0 | 1 | 2 | 3 | 4

export type ReportUnitInterferenceCostAllocationQuery = {
  name?: string | null
  allocateDeptId?: ReportUnitInterferenceCostAllocationId | null
  receiveDeptId?: ReportUnitInterferenceCostAllocationId | null
  useYearMonth?: string | null
  status?: ReportUnitInterferenceCostAllocationStatus | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ReportUnitInterferenceCostAllocationRow = Record<string, unknown> & {
  id?: ReportUnitInterferenceCostAllocationId | null
  allocateDeptId?: ReportUnitInterferenceCostAllocationId | null
  allocateDeptName?: string | null
  useYearMonth?: string | null
  name?: string | null
  staffId?: ReportUnitInterferenceCostAllocationId | null
  receiveDeptId?: ReportUnitInterferenceCostAllocationId | null
  receiveDeptName?: string | null
  salaryAmount?: number | string | null
  insuranceAmount?: number | string | null
  welfareAmount?: number | string | null
  otherAmount?: number | string | null
  providentFundAmount?: number | string | null
  status?: ReportUnitInterferenceCostAllocationStatus | null
  processInstanceId?: string | null
  createTime?: string | null
  updateTime?: string | null
}

export type ReportUnitInterferenceCostAllocationSummary = {
  salaryAmount: string
  insuranceAmount: string
  welfareAmount: string
  otherAmount: string
  providentFundAmount: string
}

export type ReportUnitInterferenceCostAllocationPage = PageResult<ReportUnitInterferenceCostAllocationRow> & {
  summary: ReportUnitInterferenceCostAllocationSummary
}

export type ReportUnitInterferenceCostAllocationOrganizationNode = Record<string, unknown> & {
  id?: ReportUnitInterferenceCostAllocationId | null
  name?: string | null
  isStandardUnit?: boolean
  children?: ReportUnitInterferenceCostAllocationOrganizationNode[]
}

export type ReportUnitInterferenceCostAllocationStaffOption = Record<string, unknown> & {
  id: ReportUnitInterferenceCostAllocationId
  name: string
  staffCode: string | null
  label: string
}

export type ReportUnitInterferenceCostAllocationStaffSearch = {
  keyword: string
  pageNo?: number
  pageSize?: number
}

export type ReportUnitInterferenceCostAllocationCreateForm = Record<string, unknown> & {
  allocateDeptId: ReportUnitInterferenceCostAllocationId
  useYearMonth: string
  staffId: ReportUnitInterferenceCostAllocationId
  name: string
  items: Array<Record<string, unknown> & {
    receiveDeptId: ReportUnitInterferenceCostAllocationId
    salaryAmount?: number | string | null
    insuranceAmount?: number | string | null
    welfareAmount?: number | string | null
    otherAmount?: number | string | null
    providentFundAmount?: number | string | null
  }>
}

export type ReportUnitInterferenceCostAllocationCreateDraft = {
  allocateDeptId: ReportUnitInterferenceCostAllocationId
  useYearMonth: string
  staffId: ReportUnitInterferenceCostAllocationId
  name: string
  onlySave: 0
  items: Array<{
    receiveDeptId: ReportUnitInterferenceCostAllocationId
    salaryAmount: number
    insuranceAmount: number
    welfareAmount: number
    otherAmount: number
    providentFundAmount: number
  }>
}

export type ReportUnitInterferenceCostAllocationRecreateInput = {
  id: ReportUnitInterferenceCostAllocationId
  currentStatus: ReportUnitInterferenceCostAllocationStatus
  processInstanceId: ReportUnitInterferenceCostAllocationId
}

export type ReportUnitInterferenceCostAllocationRecreateDraft = {
  id: ReportUnitInterferenceCostAllocationId
  processInstanceId: ReportUnitInterferenceCostAllocationId
  currentStatus: 3
}

export type ReportUnitInterferenceCostAllocationSubmitDraft = {
  id: ReportUnitInterferenceCostAllocationId
  currentStatus: 0
}

export type ReportUnitInterferenceCostAllocationCancelDraft = {
  id: ReportUnitInterferenceCostAllocationId
  currentStatus: 1
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function idOf (value: unknown, label: string): ReportUnitInterferenceCostAllocationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): ReportUnitInterferenceCostAllocationId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (text === null || text.trim() === '') throw new Error(`${label}不能为空`)
  return text
}

function monthOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function statusOf (value: unknown, label: string): ReportUnitInterferenceCostAllocationStatus | null {
  if (value === undefined || value === null || value === '') return null
  const status = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isSafeInteger(status) || ![0, 1, 2, 3, 4].includes(status)) throw new Error(`${label}只能是0、1、2、3或4`)
  return status as ReportUnitInterferenceCostAllocationStatus
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(number as typeof PAGE_SIZE_OPTIONS[number])) throw new Error('pageSize必须是10、20、50或100')
  return number as number
}

function staffPageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !STAFF_PAGE_SIZE_OPTIONS.includes(number as typeof STAFF_PAGE_SIZE_OPTIONS[number])) throw new Error('员工pageSize必须是20、50、100或200')
  return number as number
}

function decimalOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为数字、数字字符串或null`)
}

function rowOf (value: unknown, index: number): ReportUnitInterferenceCostAllocationRow {
  const row = objectOf(value, `单元间人员混用费用分摊列表[${index}]`)
  const label = `单元间人员混用费用分摊列表[${index}]`
  const normalized: JsonObject = { ...row }
  for (const field of ['id', 'allocateDeptId', 'receiveDeptId', 'staffId'] as const) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = nullableIdOf(row[field], `${label}.${field}`)
  }
  for (const field of ['allocateDeptName', 'useYearMonth', 'name', 'receiveDeptName', 'processInstanceId', 'createTime', 'updateTime'] as const) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = textOf(row[field], `${label}.${field}`)
  }
  for (const field of AMOUNT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = decimalOf(row[field], `${label}.${field}`)
  }
  if (Object.prototype.hasOwnProperty.call(row, 'status')) normalized.status = statusOf(row.status, `${label}.status`)
  return normalized as ReportUnitInterferenceCostAllocationRow
}

function pageOf (value: unknown): PageResult<ReportUnitInterferenceCostAllocationRow> {
  const page = objectOf(payloadOf(value), '单元间人员混用费用分摊分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('单元间人员混用费用分摊分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total }
}

function numberFormat (value: number): string {
  return value.toFixed(2)
}

function summaryOf (rows: ReportUnitInterferenceCostAllocationRow[]): ReportUnitInterferenceCostAllocationSummary {
  return Object.fromEntries(AMOUNT_FIELDS.map(field => [
    field,
    numberFormat(rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)),
  ])) as ReportUnitInterferenceCostAllocationSummary
}

function listParamsOf (query: ReportUnitInterferenceCostAllocationQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: query.name === undefined || query.name === null ? null : textOf(query.name, '姓名'),
    allocateDeptId: nullableIdOf(query.allocateDeptId, '分配部门ID'),
    receiveDeptId: nullableIdOf(query.receiveDeptId, '接收部门ID'),
    useYearMonth: monthOf(query.useYearMonth, '月份'),
    status: statusOf(query.status, '状态'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function amountOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}只能输入不小于0的数字`)
  if (number > MAX_AMOUNT) throw new Error(`${label}整数部分最多10位`)
  const decimal = String(value).split('.')[1]
  if (decimal && decimal.length > 2) throw new Error(`${label}最多保留两位小数`)
  return Number(Number(number).toFixed(2))
}

function itemOf (value: unknown, index: number): ReportUnitInterferenceCostAllocationCreateDraft['items'][number] {
  const item = objectOf(value, `第${index + 1}个接收部门`)
  const result = {
    receiveDeptId: idOf(item.receiveDeptId, `第${index + 1}个接收部门ID`),
    salaryAmount: amountOf(item.salaryAmount, `第${index + 1}行工资金额`),
    insuranceAmount: amountOf(item.insuranceAmount, `第${index + 1}行保险金额`),
    welfareAmount: amountOf(item.welfareAmount, `第${index + 1}行福利费金额`),
    otherAmount: amountOf(item.otherAmount, `第${index + 1}行其他金额`),
    providentFundAmount: amountOf(item.providentFundAmount, `第${index + 1}行公积金金额`),
  }
  return result
}

function createDraftOf (value: unknown): ReportUnitInterferenceCostAllocationCreateDraft {
  const form = objectOf(value, '单元间人员混用费用分摊表单') as ReportUnitInterferenceCostAllocationCreateForm
  const allocateDeptId = idOf(form.allocateDeptId, '分配部门ID')
  const useYearMonth = monthOf(form.useYearMonth, '年月', true)!
  const staffId = idOf(form.staffId, '员工ID')
  const name = requiredTextOf(form.name, '员工姓名')
  if (!Array.isArray(form.items) || form.items.length === 0) throw new Error('请添加接收部门')
  const items = form.items.map(itemOf)
  const seen = new Set<string>()
  for (const item of items) {
    const receiveDeptId = String(item.receiveDeptId)
    if (receiveDeptId === String(allocateDeptId)) throw new Error('接收部门不能与分配部门相同')
    if (seen.has(receiveDeptId)) throw new Error('接收部门不能重复')
    seen.add(receiveDeptId)
  }
  return { allocateDeptId, useYearMonth, staffId, name, onlySave: 0, items }
}

function draftOf (value: unknown): ReportUnitInterferenceCostAllocationCreateDraft {
  return createDraftOf(value)
}

function resultIdOf (value: unknown): ReportUnitInterferenceCostAllocationId {
  return idOf(payloadOf(value), '单元间人员混用费用分摊新建返回ID')
}

function actionDraftOf<TStatus extends 0 | 1> (value: unknown, label: string, expectedStatus: TStatus): { id: ReportUnitInterferenceCostAllocationId; currentStatus: TStatus } {
  const input = objectOf(value, `${label}参数`)
  const currentStatus = statusOf(input.currentStatus, `${label}当前状态`)
  if (currentStatus !== expectedStatus) throw new Error(`${label}只允许当前状态为${expectedStatus}`)
  return { id: idOf(input.id, `${label}记录ID`), currentStatus: expectedStatus }
}

function trueResultOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function treePayloadOf (value: unknown): unknown[] {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return payload
  const object = objectOf(payload, '角色组织树响应')
  if (Array.isArray(object.list)) return object.list
  if (Array.isArray(object.data)) return object.data
  throw new Error('角色组织树响应不是数组')
}

function treeNodeOf (value: unknown, index: number): ReportUnitInterferenceCostAllocationOrganizationNode {
  const node = objectOf(value, `角色组织树[${index}]`)
  const normalized: JsonObject = { ...node }
  if (Object.prototype.hasOwnProperty.call(node, 'id')) normalized.id = nullableIdOf(node.id, `角色组织树[${index}].id`)
  if (Object.prototype.hasOwnProperty.call(node, 'name')) normalized.name = textOf(node.name, `角色组织树[${index}].name`)
  if (Object.prototype.hasOwnProperty.call(node, 'isStandardUnit')) normalized.isStandardUnit = node.isStandardUnit === true || Number(node.isStandardUnit) === 1
  if (Object.prototype.hasOwnProperty.call(node, 'children')) {
    if (!Array.isArray(node.children)) throw new Error(`角色组织树[${index}].children必须是数组`)
    normalized.children = node.children.map((child, childIndex) => treeNodeOf(child, childIndex))
  }
  return normalized as ReportUnitInterferenceCostAllocationOrganizationNode
}

function staffPageOf (value: unknown): { list: ReportUnitInterferenceCostAllocationStaffOption[]; total: number } {
  const page = objectOf(payloadOf(value), '员工候选分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('员工候选分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => {
      const option = objectOf(item, `员工候选[${index}]`)
      const id = idOf(option.id, `员工候选[${index}].id`)
      const name = requiredTextOf(option.name, `员工候选[${index}].name`)
      const staffCode = option.staffCode === undefined || option.staffCode === null || option.staffCode === ''
        ? null
        : String(option.staffCode)
      return { ...option, id, name, staffCode, label: staffCode ? `${name}(${staffCode})` : name }
    }),
    total: page.total,
  }
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('员工keyword不能为空')
  return value.trim()
}

export function createReportUnitInterferenceCostAllocationCapability (request: PortalRequest) {
  return {
    async list (query: ReportUnitInterferenceCostAllocationQuery = {}): Promise<ReportUnitInterferenceCostAllocationPage> {
      const page = pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
      return { ...page, summary: summaryOf(page.list) }
    },

    async detail (input: { id: ReportUnitInterferenceCostAllocationId }): Promise<ReportUnitInterferenceCostAllocationRow | null> {
      const args = objectOf(input, '单元间人员混用费用分摊详情参数')
      const id = idOf(args.id, '单元间人员混用费用分摊ID')
      const result = payloadOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id } }))
      return result === null || result === undefined ? null : rowOf(result, 0)
    },

    async organizationTree (): Promise<ReportUnitInterferenceCostAllocationOrganizationNode[]> {
      const result = await request<unknown>({ url: '/org/organization/getRoleOrganizationTree', method: 'get' })
      return treePayloadOf(result).map((node, index) => treeNodeOf(node, index))
    },

    async staffSearch (query: ReportUnitInterferenceCostAllocationStaffSearch): Promise<{ list: ReportUnitInterferenceCostAllocationStaffOption[]; total: number }> {
      const input = objectOf(query, '员工候选查询参数')
      const keyword = keywordOf(input.keyword)
      const pageNo = staffPageNumberOf(input.pageNo, 1, 'pageNo')
      const pageSize = staffPageNumberOf(input.pageSize, 20, 'pageSize')
      return staffPageOf(await request<unknown>({ url: '/org/staff/staffByPage', method: 'get', params: { name: keyword, pageNo, pageSize } }))
    },

    prepareCreate (form: ReportUnitInterferenceCostAllocationCreateForm): { draft: ReportUnitInterferenceCostAllocationCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ReportUnitInterferenceCostAllocationCreateDraft }): Promise<ReportUnitInterferenceCostAllocationId> {
      const draft = draftOf(input?.draft)
      return resultIdOf(await request({ url: `${ROOT}/create`, method: 'post', data: draft }))
    },

    prepareSubmit (input: { id: ReportUnitInterferenceCostAllocationId; currentStatus: ReportUnitInterferenceCostAllocationStatus }): ReportUnitInterferenceCostAllocationSubmitDraft {
      return actionDraftOf(input, '提交单元间人员混用费用分摊单', 0)
    },

    async submit (input: ReportUnitInterferenceCostAllocationSubmitDraft): Promise<true> {
      const draft = actionDraftOf(input, '提交单元间人员混用费用分摊单', 0)
      const result = await request({ url: `${ROOT}/submit/${draft.id}`, method: 'post' })
      return trueResultOf(result, '提交单元间人员混用费用分摊单')
    },

    prepareCancel (input: { id: ReportUnitInterferenceCostAllocationId; currentStatus: ReportUnitInterferenceCostAllocationStatus }): ReportUnitInterferenceCostAllocationCancelDraft {
      return actionDraftOf(input, '撤销单元间人员混用费用分摊单', 1)
    },

    async cancel (input: ReportUnitInterferenceCostAllocationCancelDraft): Promise<true> {
      const draft = actionDraftOf(input, '撤销单元间人员混用费用分摊单', 1)
      const result = await request({ url: `${ROOT}/cancel/${draft.id}`, method: 'post' })
      return trueResultOf(result, '撤销单元间人员混用费用分摊单')
    },

    prepareRecreate (input: ReportUnitInterferenceCostAllocationRecreateInput): ReportUnitInterferenceCostAllocationRecreateDraft {
      const args = objectOf(input, '单元间人员混用费用分摊重新发起参数')
      const currentStatus = statusOf(args.currentStatus, '当前状态')
      if (currentStatus !== 3) throw new Error('只有已驳回记录允许重新发起')
      return {
        id: idOf(args.id, '单元间人员混用费用分摊ID'),
        processInstanceId: idOf(args.processInstanceId, '流程实例ID'),
        currentStatus: 3,
      }
    },
  }
}

export type ReportUnitInterferenceCostAllocationCapability = ReturnType<typeof createReportUnitInterferenceCostAllocationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })
const statusOptions = [
  { value: 0, label: '待提交' },
  { value: 1, label: '审批中' },
  { value: 2, label: '审批通过' },
  { value: 3, label: '已驳回' },
  { value: 4, label: '已取消' },
]

export const REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS = {
  'report-unit-interference-cost-allocation-list': 'list',
  'report-unit-interference-cost-allocation-detail': 'detail',
  'report-unit-interference-cost-allocation-organization-tree': 'organizationTree',
  'report-unit-interference-cost-allocation-staff-search': 'staffSearch',
  'report-unit-interference-cost-allocation-prepare-create': 'prepareCreate',
  'report-unit-interference-cost-allocation-create': 'create',
  'report-unit-interference-cost-allocation-prepare-submit': 'prepareSubmit',
  'report-unit-interference-cost-allocation-submit': 'submit',
  'report-unit-interference-cost-allocation-prepare-cancel': 'prepareCancel',
  'report-unit-interference-cost-allocation-cancel': 'cancel',
  'report-unit-interference-cost-allocation-prepare-recreate': 'prepareRecreate',
} as const

export const reportUnitInterferenceCostAllocationCapabilities: CapabilityDefinition[] = [
  { id: 'report-unit-interference-cost-allocation-list', title: '查询单元间人员混用费用分摊表', write: false, params: [p('name', 'text', false, '员工姓名模糊筛选；省略或传null表示不筛选'), p('allocateDeptId', 'tree', false, '分配部门ID'), p('receiveDeptId', 'tree', false, '接收部门ID'), p('useYearMonth', 'date', false, '月份筛选，格式YYYY-MM'), p('status', 'enum', false, '审批状态', statusOptions), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，仅支持10、20、50、100，默认20')] },
  { id: 'report-unit-interference-cost-allocation-detail', title: '查看单元间人员混用费用分摊详情', write: false, params: [p('id', 'text', true, '列表行记录ID')] },
  { id: 'report-unit-interference-cost-allocation-organization-tree', title: '查询单元间人员混用费用分摊组织树', write: false, params: [] },
  { id: 'report-unit-interference-cost-allocation-staff-search', title: '按关键字查询单元间人员混用费用分摊员工', write: false, params: [p('keyword', 'search', true, '员工姓名关键字；SDK要求先提供关键字，避免Portal组件默认全量拉取数千人员'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，仅支持20、50、100、200，默认20')] },
  { id: 'report-unit-interference-cost-allocation-prepare-create', title: '准备新建单元间人员混用费用分摊单', write: false, params: [p('form', 'text', true, 'Portal分摊单表单：分配部门、年月、员工姓名/ID和至少一个接收部门及金额')] },
  { id: 'report-unit-interference-cost-allocation-create', title: '提交单元间人员混用费用分摊单', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整提交草稿；确认后原样提交')] },
  { id: 'report-unit-interference-cost-allocation-prepare-submit', title: '准备提交单元间人员混用费用分摊单', write: false, params: [p('id', 'text', true, '列表行记录ID'), p('currentStatus', 'enum', true, '当前状态；必须为待提交0', [{ value: 0, label: '待提交' }])] },
  { id: 'report-unit-interference-cost-allocation-submit', title: '提交已保存的单元间人员混用费用分摊单', write: true, params: [p('draft', 'text', true, 'prepareSubmit返回的提交草稿')] },
  { id: 'report-unit-interference-cost-allocation-prepare-cancel', title: '准备撤销单元间人员混用费用分摊单', write: false, params: [p('id', 'text', true, '列表行记录ID'), p('currentStatus', 'enum', true, '当前状态；必须为审批中1', [{ value: 1, label: '审批中' }])] },
  { id: 'report-unit-interference-cost-allocation-cancel', title: '撤销单元间人员混用费用分摊单', write: true, params: [p('draft', 'text', true, 'prepareCancel返回的撤销草稿')] },
  { id: 'report-unit-interference-cost-allocation-prepare-recreate', title: '准备重新发起被驳回的单元间人员混用费用分摊单', write: false, params: [p('id', 'text', true, '列表行记录ID'), p('currentStatus', 'enum', true, '当前列表行状态；必须为已驳回3', [{ value: 3, label: '已驳回' }]), p('processInstanceId', 'text', true, '列表行流程实例ID，用于Portal重新发起前置校验')] },
].map(definition => ({
  ...definition,
  pagePath: REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH,
  permission: REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION,
  moduleType: REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE,
  httpInstance: 'platform',
}))
