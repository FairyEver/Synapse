import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 退休人员工资发放表」。 */
export const REPORT_RETIREMENT_SALARY_PAGE_PATH = '/dashboard/report/retirement-salary/list'
export const REPORT_RETIREMENT_SALARY_PERMISSION = '/dashboard/report/retirement-salary'
export const REPORT_RETIREMENT_SALARY_MODULE_TYPE = 14

const ROOT = '/hr/retire-staff-salary'
const SUMMARY_CREATE_URL = '/hr/retire-staff-salary-summary/create'
const TEMPLATE_URL = '/sys/oss/download'
const AMOUNT_FIELDS = [
  'enterpriseSalary',
  'heatingFee',
  'holidayAllowance',
  'additionalInsurance',
  'subsidy',
  'transportFee',
  'bookFee',
  'laborFee',
  'laundryFee',
  'medicineFee',
  'otherFee',
  'actualAmount',
] as const

export type ReportRetirementSalaryId = string | number
export type ReportRetirementSalaryStatus = 0 | 1

export type ReportRetirementSalaryQuery = {
  name?: string | null
  idCard?: string | null
  organizationId?: ReportRetirementSalaryId | null
  useYearMonth?: string | null
  status?: ReportRetirementSalaryStatus | null
  pageNo?: number
  pageSize?: number
}

export type ReportRetirementSalaryRow = Record<string, unknown> & {
  id?: ReportRetirementSalaryId | null
  useYearMonth?: string | null
  name?: string | null
  idCard?: string | null
  organizationId?: ReportRetirementSalaryId | null
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
  remark?: string | null
}

export type ReportRetirementSalaryDraft = {
  useYearMonth: string
  name: string
  idCard: string
  organizationId: ReportRetirementSalaryId
  organizationName: string
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
  status?: ReportRetirementSalaryStatus | null
  remark?: string | null
}

export type ReportRetirementSalaryUpdate = ReportRetirementSalaryDraft & { id: ReportRetirementSalaryId }
export type ReportRetirementSalaryFileInput = { fileName: string; base64: string; contentType?: string }
export type ReportRetirementSalaryFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
export type ReportRetirementSalarySummaryDraft = {
  organizationId: ReportRetirementSalaryId
  organizationName: string
  useYearMonth: string
  staffIdList: ReportRetirementSalaryId[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportRetirementSalaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idOrEmptyOf (value: unknown, label: string): ReportRetirementSalaryId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (!text.length) throw new Error(`${label}不能为空`)
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

function statusOf (value: unknown, label: string): ReportRetirementSalaryStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || ![0, 1].includes(value as number)) throw new Error(`${label}必须为0或1`)
  return value as ReportRetirementSalaryStatus
}

function nullableAmountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: ReportRetirementSalaryQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name'),
    idCard: textOf(query.idCard, 'idCard'),
    organizationId: idOrEmptyOf(query.organizationId, 'organizationId'),
    useYearMonth: monthOf(query.useYearMonth, 'useYearMonth'),
    status: statusOf(query.status, 'status'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<ReportRetirementSalaryRow> {
  const page = objectOf(value, '退休人员工资发放分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('退休人员工资发放分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `退休人员工资发放列表[${index}]`) } as ReportRetirementSalaryRow)), total: page.total }
}

function rowOf (value: unknown): ReportRetirementSalaryRow {
  return { ...objectOf(value, '退休人员工资发放详情') } as ReportRetirementSalaryRow
}

function payloadOf (input: ReportRetirementSalaryDraft | ReportRetirementSalaryUpdate, withId: boolean): JsonObject {
  const value = objectOf(input, '退休人员工资发放表单')
  const payload: JsonObject = {
    useYearMonth: monthOf(value.useYearMonth, 'useYearMonth', true),
    name: requiredTextOf(value.name, 'name'),
    idCard: requiredTextOf(value.idCard, 'idCard'),
    organizationId: idOf(value.organizationId, 'organizationId'),
    organizationName: requiredTextOf(value.organizationName, 'organizationName'),
  }
  for (const field of AMOUNT_FIELDS) payload[field] = nullableAmountOf(value[field], field)
  if (Object.prototype.hasOwnProperty.call(value, 'status')) payload.status = statusOf(value.status, 'status')
  if (Object.prototype.hasOwnProperty.call(value, 'remark')) payload.remark = value.remark === null || value.remark === undefined ? null : textOf(value.remark, 'remark')
  if (withId) payload.id = idOf(value.id, 'id')
  return payload
}

function summaryPayloadOf (input: ReportRetirementSalarySummaryDraft): JsonObject {
  const value = objectOf(input, '退休人员工资汇总表单')
  const ids = idsOf(value.staffIdList, 'staffIdList', false)
  return {
    organizationId: idOf(value.organizationId, 'organizationId'),
    organizationName: requiredTextOf(value.organizationName, 'organizationName'),
    useYearMonth: monthOf(value.useYearMonth, 'useYearMonth', true),
    staffIdList: ids,
  }
}

function idsOf (value: unknown, label: string, required = true): ReportRetirementSalaryId[] {
  if (!Array.isArray(value) || (required && value.length === 0)) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function fileBytesOf (input: ReportRetirementSalaryFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xml|xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType ? value.contentType : fileName.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: ReportRetirementSalaryFileInput) {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ReportRetirementSalaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('退休人员工资文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentDisposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof contentDisposition === 'string' ? contentDisposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName, contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

function removePayloadOf (input: { id: ReportRetirementSalaryId; currentStatus: ReportRetirementSalaryStatus }): { id: ReportRetirementSalaryId } {
  const status = statusOf(input?.currentStatus, 'currentStatus')
  if (status === null) throw new Error('currentStatus不能为空；删除必须基于列表最新状态')
  if (status === 1) throw new Error('status为1的退休人员工资记录已使用，Portal不允许删除')
  return { id: idOf(input?.id, 'id') }
}

export function createReportRetirementSalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportRetirementSalaryQuery = {}): Promise<PageResult<ReportRetirementSalaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: ReportRetirementSalaryId }): Promise<ReportRetirementSalaryRow> {
      return rowOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, 'id') } }))
    },
    prepareCreate (draft: ReportRetirementSalaryDraft): { draft: JsonObject } {
      return { draft: payloadOf(draft, false) }
    },
    async create (draft: ReportRetirementSalaryDraft): Promise<ReportRetirementSalaryId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: payloadOf(draft, false) })
      return idOf(result, '创建退休人员工资返回ID')
    },
    prepareUpdate (draft: ReportRetirementSalaryUpdate): { draft: JsonObject } {
      return { draft: payloadOf(draft, true) }
    },
    async update (draft: ReportRetirementSalaryUpdate): Promise<boolean> {
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payloadOf(draft, true) })
      if (result !== true) throw new Error('更新退休人员工资响应不是true')
      return true
    },
    prepareRemove (input: { id: ReportRetirementSalaryId; currentStatus: ReportRetirementSalaryStatus }): { id: ReportRetirementSalaryId } {
      return { id: removePayloadOf(input).id }
    },
    async remove (input: { id: ReportRetirementSalaryId; currentStatus: ReportRetirementSalaryStatus }): Promise<boolean> {
      const prepared = removePayloadOf(input)
      const result = await request<unknown>({ url: `${ROOT}/delete/${prepared.id}`, method: 'delete' })
      if (result !== true) throw new Error('删除退休人员工资响应不是true')
      return true
    },
    async downloadTemplate (): Promise<ReportRetirementSalaryFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: TEMPLATE_URL, method: 'get', params: { fileName: '退休人员工资模板' }, responseType: 'arraybuffer' }), '退休人员工资模板')
    },
    prepareImport (input: ReportRetirementSalaryFileInput) {
      return filePreviewOf(input)
    },
    async importExcel (input: ReportRetirementSalaryFileInput): Promise<string | null> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (result === undefined || result === null || result === '') return null
      return requiredTextOf(result, '导入响应')
    },
    prepareCreateSummary (draft: ReportRetirementSalarySummaryDraft): { draft: JsonObject } {
      return { draft: summaryPayloadOf(draft) }
    },
    async createSummary (draft: ReportRetirementSalarySummaryDraft): Promise<ReportRetirementSalaryId> {
      const result = await request<unknown>({ url: SUMMARY_CREATE_URL, method: 'post', data: summaryPayloadOf(draft) })
      return idOf(result, '创建退休人员工资汇总返回ID')
    },
  }
}

export type ReportRetirementSalaryCapability = ReturnType<typeof createReportRetirementSalaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const listParams: ParamSpec[] = [
  p('name', 'text', false, '姓名模糊筛选'),
  p('idCard', 'text', false, '身份证号精确筛选；页面表单状态保留该字段'),
  p('organizationId', 'tree', false, '角色组织树选中的组织ID'),
  p('useYearMonth', 'date', false, '工资月份，格式YYYY-MM'),
  p('status', 'enum', false, '明细状态：0未使用、1已使用', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }]),
]
const fieldsParams: ParamSpec[] = [
  p('useYearMonth', 'date', true, '工资月份，格式YYYY-MM'),
  p('name', 'text', true, '退休人员姓名'),
  p('idCard', 'text', true, '身份证号'),
  p('organizationId', 'tree', true, '角色组织树组织ID'),
  p('organizationName', 'text', true, '角色组织树返回的组织全路径快照'),
]
const amountParams: ParamSpec[] = AMOUNT_FIELDS.map(name => p(name, 'number', false, `${name}金额；页面允许留空`))
const salaryPayloadParams: ParamSpec[] = [
  ...fieldsParams,
  ...amountParams,
  p('status', 'enum', false, '编辑详情回显的明细状态；通常原样透传，不要手工改写', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }]),
  p('remark', 'text', false, '编辑详情回显的备注；页面表单不单独编辑'),
]
const fileParams: ParamSpec[] = [p('fileName', 'text', true, '上传文件名，支持.xml/.xlsx/.xls'), p('base64', 'text', true, '文件内容Base64'), p('contentType', 'text', false, '文件MIME类型')]

export const REPORT_RETIREMENT_SALARY_METHODS = {
  'report-retirement-salary-list': 'list',
  'report-retirement-salary-get': 'get',
  'report-retirement-salary-prepare-create': 'prepareCreate',
  'report-retirement-salary-create': 'create',
  'report-retirement-salary-prepare-update': 'prepareUpdate',
  'report-retirement-salary-update': 'update',
  'report-retirement-salary-prepare-remove': 'prepareRemove',
  'report-retirement-salary-remove': 'remove',
  'report-retirement-salary-download-template': 'downloadTemplate',
  'report-retirement-salary-prepare-import': 'prepareImport',
  'report-retirement-salary-import': 'importExcel',
  'report-retirement-salary-prepare-create-summary': 'prepareCreateSummary',
  'report-retirement-salary-create-summary': 'createSummary',
} as const

export const reportRetirementSalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-retirement-salary-list', title: '查询退休人员工资发放表', write: false, params: [...listParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-retirement-salary-get', title: '读取退休人员工资发放编辑详情', write: false, params: [p('id', 'number', true, '退休人员工资记录ID')] },
  { id: 'report-retirement-salary-prepare-create', title: '准备新建退休人员工资发放', write: false, params: salaryPayloadParams },
  { id: 'report-retirement-salary-create', title: '新建退休人员工资发放', write: true, params: salaryPayloadParams },
  { id: 'report-retirement-salary-prepare-update', title: '准备编辑退休人员工资发放', write: false, params: [p('id', 'number', true, '记录ID'), ...salaryPayloadParams] },
  { id: 'report-retirement-salary-update', title: '编辑退休人员工资发放', write: true, params: [p('id', 'number', true, '记录ID'), ...salaryPayloadParams] },
  { id: 'report-retirement-salary-prepare-remove', title: '检查退休人员工资删除条件', write: false, params: [p('id', 'number', true, '记录ID'), p('currentStatus', 'enum', true, '列表行最新状态；1已使用不可删除', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }])] },
  { id: 'report-retirement-salary-remove', title: '删除退休人员工资发放', write: true, params: [p('id', 'number', true, '记录ID'), p('currentStatus', 'enum', true, '列表行最新状态；必须为0', [{ value: 0, label: '未使用' }])] },
  { id: 'report-retirement-salary-download-template', title: '下载退休人员工资模板', write: false, params: [] },
  { id: 'report-retirement-salary-prepare-import', title: '准备导入退休人员工资文件', write: false, params: fileParams },
  { id: 'report-retirement-salary-import', title: '导入退休人员工资文件', write: true, params: fileParams },
  { id: 'report-retirement-salary-prepare-create-summary', title: '准备创建退休人员工资汇总表', write: false, params: [p('organizationId', 'tree', true, '组织ID'), p('organizationName', 'text', true, '组织全路径快照'), p('useYearMonth', 'date', true, '工资月份YYYY-MM'), p('staffIdList', 'text', true, '选中的未使用退休人员ID数组')] },
  { id: 'report-retirement-salary-create-summary', title: '创建退休人员工资汇总表', write: true, params: [p('organizationId', 'tree', true, '组织ID'), p('organizationName', 'text', true, '组织全路径快照'), p('useYearMonth', 'date', true, '工资月份YYYY-MM'), p('staffIdList', 'text', true, '选中的未使用退休人员ID数组')] },
].map(definition => ({
  ...definition,
  pagePath: REPORT_RETIREMENT_SALARY_PAGE_PATH,
  permission: REPORT_RETIREMENT_SALARY_PERMISSION,
  moduleType: REPORT_RETIREMENT_SALARY_MODULE_TYPE,
  httpInstance: 'platform',
}))
