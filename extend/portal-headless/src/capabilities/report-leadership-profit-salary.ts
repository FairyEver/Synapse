import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 领导利润工资计提表」。 */
export const REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH = '/dashboard/report/leadership-profit-salary/list'
export const REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION = '/dashboard/report/leadership-profit-salary'
export const REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE = 14

const ROOT = '/hr/leader-profit-salary-provision'
const TEMPLATE_URL = '/sys/oss/download'
const TEMPLATE_FILE_NAME = '领导利润工资计提模板'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const PROVISION_AMOUNT_MIN = 0
const PROVISION_AMOUNT_MAX = 9_999_999_999.99

export type ReportLeadershipProfitSalaryId = string | number
export type ReportLeadershipProfitSalaryStatus = 0 | 1

export type ReportLeadershipProfitSalaryQuery = {
  standardUnitId?: ReportLeadershipProfitSalaryId | null
  useYearMonth?: string | null
  pageNo?: number
  pageSize?: number
}

export type ReportLeadershipProfitSalaryRow = Record<string, unknown> & {
  id?: ReportLeadershipProfitSalaryId | null
  useYearMonth?: string | null
  standardUnitId?: ReportLeadershipProfitSalaryId | null
  standardUnitName?: string | null
  costCenterId?: ReportLeadershipProfitSalaryId | null
  costCenterName?: string | null
  provisionAmount?: number | string | null
  status?: ReportLeadershipProfitSalaryStatus | null
  createTime?: string | null
}

export type ReportLeadershipProfitSalaryCreateForm = Record<string, unknown> & {
  useYearMonth: string
  standardUnitId: ReportLeadershipProfitSalaryId
  standardUnitName?: string | null
  provisionAmount: number | string
}

export type ReportLeadershipProfitSalaryCreateDraft = Record<string, unknown> & {
  useYearMonth: string
  standardUnitId: ReportLeadershipProfitSalaryId
  standardUnitName?: string | null
  provisionAmount: number
}

export type ReportLeadershipProfitSalaryUpdateForm = ReportLeadershipProfitSalaryCreateForm & {
  id: ReportLeadershipProfitSalaryId
  status: ReportLeadershipProfitSalaryStatus
}

export type ReportLeadershipProfitSalaryUpdateDraft = ReportLeadershipProfitSalaryCreateDraft & {
  id: ReportLeadershipProfitSalaryId
  status: 0
}

export type ReportLeadershipProfitSalaryRemoveInput = {
  id: ReportLeadershipProfitSalaryId
  currentStatus: ReportLeadershipProfitSalaryStatus
}

export type ReportLeadershipProfitSalaryRemoveDraft = {
  id: ReportLeadershipProfitSalaryId
  currentStatus: 0
}

export type ReportLeadershipProfitSalaryFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type ReportLeadershipProfitSalaryFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type ReportLeadershipProfitSalaryFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ReportLeadershipProfitSalaryId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): ReportLeadershipProfitSalaryId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function optionalTextOf (value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  return textOf(value, label)
}

function monthOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function statusOf (value: unknown, label: string, required = false): ReportLeadershipProfitSalaryStatus | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const status = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isSafeInteger(status) || ![0, 1].includes(status)) throw new Error(`${label}只能是0或1`)
  return status as ReportLeadershipProfitSalaryStatus
}

function editableStatusOf (value: unknown): 0 {
  if (statusOf(value, '当前状态', true) !== 0) throw new Error('已月结状态无法编辑或删除')
  return 0
}

function amountOf (value: unknown, label: string, required = false): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字`)
  if (number < PROVISION_AMOUNT_MIN) throw new Error(`${label}不能小于${PROVISION_AMOUNT_MIN}`)
  if (number > PROVISION_AMOUNT_MAX) throw new Error(`${label}不能大于${PROVISION_AMOUNT_MAX}`)
  const rounded = Number(number.toFixed(2))
  if (!Number.isFinite(rounded) || rounded < PROVISION_AMOUNT_MIN || rounded > PROVISION_AMOUNT_MAX) throw new Error(`${label}超出页面允许范围`)
  return rounded
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(number as number)) throw new Error('pageSize必须是10、20、50或100')
  return number as number
}

function listParamsOf (query: ReportLeadershipProfitSalaryQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    standardUnitId: nullableIdOf(query.standardUnitId, 'standardUnitId'),
    useYearMonth: monthOf(query.useYearMonth, 'useYearMonth'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function decimalOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为数字、数字字符串或null`)
}

function rowOf (value: unknown, index: number): ReportLeadershipProfitSalaryRow {
  const row = objectOf(value, `领导利润工资计提列表[${index}]`)
  const label = `领导利润工资计提列表[${index}]`
  const normalized: JsonObject = { ...row }
  for (const field of ['id', 'standardUnitId', 'costCenterId'] as const) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = nullableIdOf(row[field], `${label}.${field}`)
  }
  for (const field of ['useYearMonth', 'standardUnitName', 'costCenterName', 'createTime'] as const) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = textOf(row[field], `${label}.${field}`)
  }
  if (Object.prototype.hasOwnProperty.call(row, 'provisionAmount')) normalized.provisionAmount = decimalOf(row.provisionAmount, `${label}.provisionAmount`)
  if (Object.prototype.hasOwnProperty.call(row, 'status')) normalized.status = statusOf(row.status, `${label}.status`)
  return normalized as ReportLeadershipProfitSalaryRow
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): PageResult<ReportLeadershipProfitSalaryRow> {
  const page = objectOf(payloadOf(value), '领导利润工资计提分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('领导利润工资计提分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => rowOf(item, index)),
    total: page.total,
  }
}

function formPayloadOf (value: unknown, withId: boolean): JsonObject {
  const form = objectOf(value, '领导利润工资计提表单')
  const payload: JsonObject = {
    useYearMonth: monthOf(form.useYearMonth, '月份', true),
    standardUnitId: idOf(form.standardUnitId, '组织ID'),
    provisionAmount: amountOf(form.provisionAmount, '利润计提金额', true),
  }
  if (Object.prototype.hasOwnProperty.call(form, 'standardUnitName')) payload.standardUnitName = optionalTextOf(form.standardUnitName, '组织名称')
  if (withId) payload.id = idOf(form.id, '领导利润工资计提ID')
  return payload
}

function createDraftOf (value: unknown): ReportLeadershipProfitSalaryCreateDraft {
  return formPayloadOf(value, false) as ReportLeadershipProfitSalaryCreateDraft
}

function updateDraftOf (value: unknown): ReportLeadershipProfitSalaryUpdateDraft {
  const form = objectOf(value, '领导利润工资计提编辑表单')
  const status = editableStatusOf(form.status)
  return { ...formPayloadOf(form, true), status } as ReportLeadershipProfitSalaryUpdateDraft
}

function removeDraftOf (value: unknown): ReportLeadershipProfitSalaryRemoveDraft {
  const input = objectOf(value, '领导利润工资计提删除确认')
  return { id: idOf(input.id, '领导利润工资计提ID'), currentStatus: editableStatusOf(input.currentStatus) }
}

function fileBytesOf (input: ReportLeadershipProfitSalaryFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '领导利润工资计提导入文件')
  if (typeof value.fileName !== 'string' || value.fileName.trim() === '') throw new Error('fileName不能为空')
  if (!/\.(xml|xlsx|xls)$/i.test(value.fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  if (typeof value.base64 !== 'string' || value.base64.trim() === '') throw new Error('base64不能为空')
  const base64 = value.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType
    ? value.contentType
    : value.fileName.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName: value.fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: ReportLeadershipProfitSalaryFileInput): ReportLeadershipProfitSalaryFilePreview {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportLeadershipProfitSalaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('领导利润工资计提模板响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentDisposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof contentDisposition === 'string' ? contentDisposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = `${TEMPLATE_FILE_NAME}.xlsx`
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fileName
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function idResultOf (value: unknown): ReportLeadershipProfitSalaryId {
  return idOf(payloadOf(value), '领导利润工资计提新建返回ID')
}

function trueResultOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createReportLeadershipProfitSalaryCapability (request: PortalRequest) {
  return {
    async list (query: ReportLeadershipProfitSalaryQuery = {}): Promise<PageResult<ReportLeadershipProfitSalaryRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },

    prepareCreate (form: ReportLeadershipProfitSalaryCreateForm): { draft: ReportLeadershipProfitSalaryCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ReportLeadershipProfitSalaryCreateDraft }): Promise<ReportLeadershipProfitSalaryId> {
      return idResultOf(await request({ url: `${ROOT}/create`, method: 'post', data: formPayloadOf(input?.draft, false) }))
    },

    prepareUpdate (form: ReportLeadershipProfitSalaryUpdateForm): { draft: ReportLeadershipProfitSalaryUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ReportLeadershipProfitSalaryUpdateDraft }): Promise<true> {
      const draft = updateDraftOf(input?.draft)
      return trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: formPayloadOf(draft, true) }), '领导利润工资计提编辑')
    },

    prepareRemove (input: ReportLeadershipProfitSalaryRemoveInput): ReportLeadershipProfitSalaryRemoveDraft {
      return removeDraftOf(input)
    },

    async remove (input: ReportLeadershipProfitSalaryRemoveDraft): Promise<true> {
      const draft = removeDraftOf(input)
      return trueResultOf(await request({ url: `${ROOT}/delete/${draft.id}`, method: 'delete' }), '领导利润工资计提删除')
    },

    async downloadTemplate (): Promise<ReportLeadershipProfitSalaryFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: TEMPLATE_URL, method: 'get', params: { fileName: TEMPLATE_FILE_NAME }, responseType: 'arraybuffer' }))
    },

    prepareImport (input: ReportLeadershipProfitSalaryFileInput): ReportLeadershipProfitSalaryFilePreview {
      return filePreviewOf(input)
    },

    async importExcel (input: ReportLeadershipProfitSalaryFileInput): Promise<string | null> {
      const file = fileBytesOf(input)
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      const data = new FormData()
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      if (result === undefined || result === null || result === '') return null
      if (typeof result !== 'string') throw new Error('领导利润工资计提导入响应必须为字符串或空值')
      return result
    },
  }
}

export type ReportLeadershipProfitSalaryCapability = ReturnType<typeof createReportLeadershipProfitSalaryCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })
const listParams: ParamSpec[] = [
  p('standardUnitId', 'tree', false, '组织筛选ID；来自Portal角色组织树，省略时发送null'),
  p('useYearMonth', 'date', false, '月份筛选，格式YYYY-MM；清空时发送null'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'),
]
const formParam = p('form', 'text', true, 'Portal表单；月份、组织和利润计提金额均必填，金额范围0至9999999999.99且按两位小数提交')
const updateFormParam = p('form', 'text', true, 'Portal编辑表单与当前列表行；必须包含id和status=0，月份、组织和利润计提金额均必填')
const draftParam = p('draft', 'text', true, 'prepareCreate或prepareUpdate返回的完整草稿；确认后原样提交')
const statusParam = p('currentStatus', 'enum', true, '当前列表行状态；只有0待月结允许删除', [{ value: 0, label: '待月结' }, { value: 1, label: '已月结' }])
const fileParams: ParamSpec[] = [
  p('fileName', 'text', true, '上传文件名，支持.xml、.xlsx、.xls'),
  p('base64', 'text', true, '文件内容Base64'),
  p('contentType', 'text', false, '文件MIME类型；省略时按扩展名推断'),
]

export const REPORT_LEADERSHIP_PROFIT_SALARY_METHODS = {
  'report-leadership-profit-salary-list': 'list',
  'report-leadership-profit-salary-prepare-create': 'prepareCreate',
  'report-leadership-profit-salary-create': 'create',
  'report-leadership-profit-salary-prepare-update': 'prepareUpdate',
  'report-leadership-profit-salary-update': 'update',
  'report-leadership-profit-salary-prepare-remove': 'prepareRemove',
  'report-leadership-profit-salary-remove': 'remove',
  'report-leadership-profit-salary-download-template': 'downloadTemplate',
  'report-leadership-profit-salary-prepare-import': 'prepareImport',
  'report-leadership-profit-salary-import': 'importExcel',
} as const

export const reportLeadershipProfitSalaryCapabilities: CapabilityDefinition[] = [
  { id: 'report-leadership-profit-salary-list', title: '查询领导利润工资计提表', write: false, params: listParams },
  { id: 'report-leadership-profit-salary-prepare-create', title: '准备新建领导利润工资计提', write: false, params: [formParam] },
  { id: 'report-leadership-profit-salary-create', title: '新建领导利润工资计提', write: true, params: [draftParam] },
  { id: 'report-leadership-profit-salary-prepare-update', title: '准备编辑领导利润工资计提', write: false, params: [updateFormParam] },
  { id: 'report-leadership-profit-salary-update', title: '编辑领导利润工资计提', write: true, params: [draftParam] },
  { id: 'report-leadership-profit-salary-prepare-remove', title: '准备删除领导利润工资计提', write: false, params: [p('id', 'text', true, '当前列表行的领导利润工资计提ID'), statusParam] },
  { id: 'report-leadership-profit-salary-remove', title: '删除领导利润工资计提', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID'), statusParam] },
  { id: 'report-leadership-profit-salary-download-template', title: '下载领导利润工资计提模板', write: false, params: [] },
  { id: 'report-leadership-profit-salary-prepare-import', title: '准备导入领导利润工资计提文件', write: false, params: fileParams },
  { id: 'report-leadership-profit-salary-import', title: '导入领导利润工资计提文件', write: true, params: fileParams },
].map(definition => ({
  ...definition,
  pagePath: REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH,
  permission: REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION,
  moduleType: REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE,
  httpInstance: 'platform',
}))
