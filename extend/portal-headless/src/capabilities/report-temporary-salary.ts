import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 临时工工资发放表」。 */
export const REPORT_TEMPORARY_SALARY_PAGE_PATH = '/dashboard/report/temporary-salary/list'
export const REPORT_TEMPORARY_SALARY_PERMISSION = '/dashboard/report/temporary-salary'
export const REPORT_TEMPORARY_SALARY_MODULE_TYPE = 14

const ROOT = '/hr/temporary-worker-salary'
const SUMMARY_CREATE_URL = '/hr/temporary-worker-salary-summary/create'
const TEMPLATE_URL = '/sys/oss/download'
const AMOUNT_FIELDS = [
  'attendanceDays',
  'dailyValue',
  'attendanceSalary',
  'otherSalary',
  'grossSalary',
  'individualIncomeTax',
  'netSalary',
] as const

export type ReportTemporarySalaryId = string | number
export type ReportTemporarySalaryStatus = 0 | 1

export type ReportTemporarySalaryQuery = {
  name?: string | null
  idCard?: string | null
  organizationId?: ReportTemporarySalaryId | null
  useYearMonth?: string | null
  status?: ReportTemporarySalaryStatus | null
  pageNo?: number
  pageSize?: number
}

export type ReportTemporarySalaryRow = Record<string, unknown> & {
  id?: ReportTemporarySalaryId | null
  useYearMonth?: string | null
  name?: string | null
  idCard?: string | null
  organizationId?: ReportTemporarySalaryId | null
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
  status?: ReportTemporarySalaryStatus | number | null
  createTime?: string | null
}

export type ReportTemporarySalaryDraft = {
  useYearMonth: string
  name: string
  idCard: string
  organizationId: ReportTemporarySalaryId
  organizationName: string
  entryDate?: string | null
  bankAccount: string
  openingBank: string
  attendanceDays?: number | string | null
  dailyValue?: number | string | null
  attendanceSalary: number | string
  otherSalary: number | string
  grossSalary: number | string
  individualIncomeTax: number | string
  netSalary: number | string
  status?: ReportTemporarySalaryStatus | null
}

export type ReportTemporarySalaryUpdate = ReportTemporarySalaryDraft & { id: ReportTemporarySalaryId; status: 0 }
export type ReportTemporarySalaryFileInput = { fileName: string; base64: string; contentType?: string }
export type ReportTemporarySalaryFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
export type ReportTemporarySalarySummaryDraft = {
  organizationId: ReportTemporarySalaryId
  organizationName: string
  useYearMonth: string
  staffIdList: ReportTemporarySalaryId[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportTemporarySalaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idOrEmptyOf (value: unknown, label: string): ReportTemporarySalaryId | '' {
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

function requiredAlphaNumberOf (value: unknown, label: string, maxLength: number): string {
  const text = requiredTextOf(value, label)
  if (!/^[A-Za-z0-9]+$/.test(text)) throw new Error(`${label}只能输入数字和字母`)
  if (text.length > maxLength) throw new Error(`${label}最多${maxLength}位`)
  return text
}

function requiredMaxLengthOf (value: unknown, label: string, maxLength: number): string {
  const text = requiredTextOf(value, label)
  if (text.length > maxLength) throw new Error(`${label}最多${maxLength}个字`)
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

function dateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function statusOf (value: unknown, label: string): ReportTemporarySalaryStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || ![0, 1].includes(value as number)) throw new Error(`${label}必须为0或1`)
  return value as ReportTemporarySalaryStatus
}

function numericOf (value: unknown, label: string, required: boolean, maxDigits: number): number | string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text)) throw new Error(`${label}只能输入数字`)
  const [, fraction = ''] = text.split('.')
  if (fraction.length > 2) throw new Error(`${label}最多2位小数`)
  if (text.replace('.', '').length > maxDigits) throw new Error(`${label}最多${maxDigits}位`)
  return value as number | string
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: ReportTemporarySalaryQuery = {}): JsonObject {
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

function pageOf (value: unknown): PageResult<ReportTemporarySalaryRow> {
  const page = objectOf(value, '临时工工资发放分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('临时工工资发放分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => ({ ...objectOf(item, `临时工工资发放列表[${index}]`) } as ReportTemporarySalaryRow)), total: page.total }
}

function rowOf (value: unknown): ReportTemporarySalaryRow {
  return { ...objectOf(value, '临时工工资发放详情') } as ReportTemporarySalaryRow
}

function payloadOf (input: ReportTemporarySalaryDraft | ReportTemporarySalaryUpdate, withId: boolean): JsonObject {
  const value = objectOf(input, '临时工工资发放表单')
  const payload: JsonObject = {
    useYearMonth: monthOf(value.useYearMonth, 'useYearMonth', true),
    name: requiredMaxLengthOf(value.name, 'name', 10),
    idCard: requiredAlphaNumberOf(value.idCard, 'idCard', 18),
    organizationId: idOf(value.organizationId, 'organizationId'),
    organizationName: requiredTextOf(value.organizationName, 'organizationName'),
    entryDate: dateOf(value.entryDate, 'entryDate'),
    bankAccount: requiredAlphaNumberOf(value.bankAccount, 'bankAccount', 30),
    openingBank: requiredMaxLengthOf(value.openingBank, 'openingBank', 20),
    attendanceDays: numericOf(value.attendanceDays, 'attendanceDays', false, 4),
    dailyValue: numericOf(value.dailyValue, 'dailyValue', false, 10),
    attendanceSalary: numericOf(value.attendanceSalary, 'attendanceSalary', true, 10),
    otherSalary: numericOf(value.otherSalary, 'otherSalary', true, 10),
    grossSalary: numericOf(value.grossSalary, 'grossSalary', true, 10),
    individualIncomeTax: numericOf(value.individualIncomeTax, 'individualIncomeTax', true, 10),
    netSalary: numericOf(value.netSalary, 'netSalary', true, 10),
  }
  if (Object.prototype.hasOwnProperty.call(value, 'status')) {
    const status = statusOf(value.status, 'status')
    if (withId && status !== 0) throw new Error('status为1的临时工工资记录已使用，Portal不允许编辑')
    payload.status = status
  }
  if (withId) payload.id = idOf(value.id, 'id')
  return payload
}

function idsOf (value: unknown, label: string): ReportTemporarySalaryId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function summaryPayloadOf (input: ReportTemporarySalarySummaryDraft): JsonObject {
  const value = objectOf(input, '临时工工资汇总表单')
  return {
    organizationId: idOf(value.organizationId, 'organizationId'),
    organizationName: requiredTextOf(value.organizationName, 'organizationName'),
    useYearMonth: monthOf(value.useYearMonth, 'useYearMonth', true),
    staffIdList: idsOf(value.staffIdList, 'staffIdList'),
  }
}

function fileBytesOf (input: ReportTemporarySalaryFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
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

function filePreviewOf (input: ReportTemporarySalaryFileInput) {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ReportTemporarySalaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('临时工工资模板响应为空文件')
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

function removePayloadOf (input: { id: ReportTemporarySalaryId; currentStatus: ReportTemporarySalaryStatus }): { id: ReportTemporarySalaryId } {
  const status = statusOf(input?.currentStatus, 'currentStatus')
  if (status === null) throw new Error('currentStatus不能为空；删除必须基于列表最新状态')
  if (status === 1) throw new Error('status为1的临时工工资记录已使用，Portal不允许删除')
  return { id: idOf(input?.id, 'id') }
}

function idListOf (value: unknown): ReportTemporarySalaryId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('创建临时工工资汇总返回ID列表为空')
  return value.map((item, index) => idOf(item, `创建临时工工资汇总返回ID[${index}]`))
}

export function createReportTemporarySalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportTemporarySalaryQuery = {}): Promise<PageResult<ReportTemporarySalaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: ReportTemporarySalaryId }): Promise<ReportTemporarySalaryRow> {
      return rowOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, 'id') } }))
    },
    prepareCreate (draft: ReportTemporarySalaryDraft): { draft: JsonObject } {
      return { draft: payloadOf(draft, false) }
    },
    async create (draft: ReportTemporarySalaryDraft): Promise<ReportTemporarySalaryId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: payloadOf(draft, false) })
      return idOf(result, '创建临时工工资返回ID')
    },
    prepareUpdate (draft: ReportTemporarySalaryUpdate): { draft: JsonObject } {
      return { draft: payloadOf(draft, true) }
    },
    async update (draft: ReportTemporarySalaryUpdate): Promise<boolean> {
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payloadOf(draft, true) })
      if (result !== true) throw new Error('更新临时工工资响应不是true')
      return true
    },
    prepareRemove (input: { id: ReportTemporarySalaryId; currentStatus: ReportTemporarySalaryStatus }): { id: ReportTemporarySalaryId } {
      return { id: removePayloadOf(input).id }
    },
    async remove (input: { id: ReportTemporarySalaryId; currentStatus: ReportTemporarySalaryStatus }): Promise<boolean> {
      const prepared = removePayloadOf(input)
      const result = await request<unknown>({ url: `${ROOT}/delete/${prepared.id}`, method: 'delete' })
      if (result !== true) throw new Error('删除临时工工资响应不是true')
      return true
    },
    async downloadTemplate (): Promise<ReportTemporarySalaryFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: TEMPLATE_URL, method: 'get', params: { fileName: '临时工工资模板' }, responseType: 'arraybuffer' }), '临时工工资模板')
    },
    prepareImport (input: ReportTemporarySalaryFileInput) {
      return filePreviewOf(input)
    },
    async importExcel (input: ReportTemporarySalaryFileInput): Promise<string | null> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (result === undefined || result === null || result === '') return null
      return requiredTextOf(result, '导入响应')
    },
    prepareCreateSummary (draft: ReportTemporarySalarySummaryDraft): { draft: JsonObject } {
      return { draft: summaryPayloadOf(draft) }
    },
    async createSummary (draft: ReportTemporarySalarySummaryDraft): Promise<ReportTemporarySalaryId[]> {
      const result = await request<unknown>({ url: SUMMARY_CREATE_URL, method: 'post', data: summaryPayloadOf(draft) })
      return idListOf(result)
    },
  }
}

export type ReportTemporarySalaryCapability = ReturnType<typeof createReportTemporarySalaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const listParams: ParamSpec[] = [
  p('name', 'text', false, '姓名模糊筛选'),
  p('idCard', 'text', false, '身份证号精确筛选；页面表单状态保留该字段'),
  p('organizationId', 'tree', false, '角色组织树选中的末级组织ID'),
  p('useYearMonth', 'date', false, '工资月份，格式YYYY-MM'),
  p('status', 'enum', false, '明细状态：0未使用、1已使用', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }]),
]
const fieldsParams: ParamSpec[] = [
  p('useYearMonth', 'date', true, '工资月份，格式YYYY-MM'),
  p('name', 'text', true, '临时工姓名，最多10个字'),
  p('idCard', 'text', true, '身份证号，只能数字和字母，最多18位'),
  p('organizationId', 'tree', true, '角色组织树选择的末级组织ID'),
  p('organizationName', 'text', true, '组织全路径名称快照；由Portal组织树计算'),
  p('entryDate', 'date', false, '入场日期，格式YYYY-MM-DD'),
  p('bankAccount', 'text', true, '银行账号，只能数字和字母，最多30位'),
  p('openingBank', 'text', true, '开户行，最多20个字'),
]
const amountParams: ParamSpec[] = [
  p('attendanceDays', 'number', false, '出勤天数；页面可留空，最多4位数字且最多2位小数'),
  p('dailyValue', 'number', false, '日值；页面可留空，最多10位数字且最多2位小数'),
  ...['attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary'].map(name => p(name, 'number', true, `${name}；必填，最多10位数字且最多2位小数`)),
]
const salaryCreateParams: ParamSpec[] = [...fieldsParams, ...amountParams, p('status', 'enum', false, '编辑回显状态；新建时服务端强制设为0', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }])]
const salaryUpdateParams: ParamSpec[] = [...fieldsParams, ...amountParams, p('status', 'enum', true, '必须来自编辑前最新记录且为0；已使用记录页面不允许编辑', [{ value: 0, label: '未使用' }])]
const fileParams: ParamSpec[] = [p('fileName', 'text', true, '上传文件名，支持.xml/.xlsx/.xls'), p('base64', 'text', true, '文件内容Base64'), p('contentType', 'text', false, '文件MIME类型')]
const summaryParams: ParamSpec[] = [p('organizationId', 'tree', true, '选择的末级组织ID'), p('organizationName', 'text', true, '组织名称'), p('useYearMonth', 'date', true, '汇总工资月份YYYY-MM'), p('staffIdList', 'text', true, '选中的未使用临时工明细ID数组')]

export const REPORT_TEMPORARY_SALARY_METHODS = {
  'report-temporary-salary-list': 'list',
  'report-temporary-salary-get': 'get',
  'report-temporary-salary-prepare-create': 'prepareCreate',
  'report-temporary-salary-create': 'create',
  'report-temporary-salary-prepare-update': 'prepareUpdate',
  'report-temporary-salary-update': 'update',
  'report-temporary-salary-prepare-remove': 'prepareRemove',
  'report-temporary-salary-remove': 'remove',
  'report-temporary-salary-download-template': 'downloadTemplate',
  'report-temporary-salary-prepare-import': 'prepareImport',
  'report-temporary-salary-import': 'importExcel',
  'report-temporary-salary-prepare-create-summary': 'prepareCreateSummary',
  'report-temporary-salary-create-summary': 'createSummary',
} as const

export const reportTemporarySalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-temporary-salary-list', title: '查询临时工工资发放表', write: false, params: [...listParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'report-temporary-salary-get', title: '读取临时工工资发放编辑详情', write: false, params: [p('id', 'number', true, '临时工工资记录ID')] },
  { id: 'report-temporary-salary-prepare-create', title: '准备新建临时工工资发放', write: false, params: salaryCreateParams },
  { id: 'report-temporary-salary-create', title: '新建临时工工资发放', write: true, params: salaryCreateParams },
  { id: 'report-temporary-salary-prepare-update', title: '准备编辑临时工工资发放', write: false, params: [p('id', 'number', true, '记录ID'), ...salaryUpdateParams] },
  { id: 'report-temporary-salary-update', title: '编辑临时工工资发放', write: true, params: [p('id', 'number', true, '记录ID'), ...salaryUpdateParams] },
  { id: 'report-temporary-salary-prepare-remove', title: '检查临时工工资删除条件', write: false, params: [p('id', 'number', true, '记录ID'), p('currentStatus', 'enum', true, '列表行最新状态；1已使用不可删除', [{ value: 0, label: '未使用' }, { value: 1, label: '已使用' }])] },
  { id: 'report-temporary-salary-remove', title: '删除临时工工资发放', write: true, params: [p('id', 'number', true, '记录ID'), p('currentStatus', 'enum', true, '列表行最新状态；必须为0', [{ value: 0, label: '未使用' }])] },
  { id: 'report-temporary-salary-download-template', title: '下载临时工工资模板', write: false, params: [] },
  { id: 'report-temporary-salary-prepare-import', title: '准备导入临时工工资文件', write: false, params: fileParams },
  { id: 'report-temporary-salary-import', title: '导入临时工工资文件', write: true, params: fileParams },
  { id: 'report-temporary-salary-prepare-create-summary', title: '准备创建临时工工资汇总表', write: false, params: summaryParams },
  { id: 'report-temporary-salary-create-summary', title: '创建临时工工资汇总表', write: true, params: summaryParams },
].map(definition => ({
  ...definition,
  pagePath: REPORT_TEMPORARY_SALARY_PAGE_PATH,
  permission: REPORT_TEMPORARY_SALARY_PERMISSION,
  moduleType: REPORT_TEMPORARY_SALARY_MODULE_TYPE,
  httpInstance: 'platform',
}))
