import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 报表 → 人工成本计提分配表」。 */
export const REPORT_LABOR_COST_ALLOCATION_PAGE_PATH = '/dashboard/report/labor-cost-allocation/list'
export const REPORT_LABOR_COST_ALLOCATION_PERMISSION = '/dashboard/report/labor-cost-allocation'
export const REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE = 14

export type ReportLaborCostAllocationType = 'salary' | 'socialFund'
export type ReportLaborCostAllocationId = string | number
export type ReportLaborCostAllocationStatus = 0 | 1 | 2

type AllocationConfig = {
  root: string
  fileName: string
  amountFields: readonly string[]
}

const ALLOCATION_CONFIG: Record<ReportLaborCostAllocationType, AllocationConfig> = {
  salary: {
    root: '/hr/salary-cost-accrual-allocation',
    fileName: '工资成本计提分配模板.xlsx',
    amountFields: ['predictedPayableAmount'],
  },
  socialFund: {
    root: '/hr/social-fund-cost-accrual-allocation',
    fileName: '社保公积金计提分配模板.xlsx',
    amountFields: [
      'predictedUnitPension',
      'predictedUnitMedical',
      'predictedUnitUnemployment',
      'predictedUnitCriticalIllness',
      'predictedUnitMaternity',
      'predictedUnitWorkInjury',
      'predictedUnitSocialSecurityTotal',
      'predictedUnitProvidentFundTotal',
    ],
  },
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export type ReportLaborCostAllocationQuery = {
  allocationType?: ReportLaborCostAllocationType | null
  useYearMonth?: string | null
  organizationId?: ReportLaborCostAllocationId | null
  standardUnitId?: ReportLaborCostAllocationId | null
  status?: ReportLaborCostAllocationStatus | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ReportLaborCostAllocationRow = Record<string, unknown> & {
  id?: ReportLaborCostAllocationId | null
  useYearMonth?: string | null
  standardUnitId?: ReportLaborCostAllocationId | null
  standardUnitName?: string | null
  departmentId?: ReportLaborCostAllocationId | null
  departmentName?: string | null
  predictedPayableAmount?: number | string | null
  predictedUnitPension?: number | string | null
  predictedUnitMedical?: number | string | null
  predictedUnitUnemployment?: number | string | null
  predictedUnitCriticalIllness?: number | string | null
  predictedUnitMaternity?: number | string | null
  predictedUnitWorkInjury?: number | string | null
  predictedUnitSocialSecurityTotal?: number | string | null
  predictedUnitProvidentFundTotal?: number | string | null
  status?: ReportLaborCostAllocationStatus | number | null
  statusName?: string | null
}

export type ReportLaborCostAllocationSummary = Record<string, number | string | null>

export type ReportLaborCostAllocationPage = PageResult<ReportLaborCostAllocationRow> & {
  /** Portal工资Tab来自 /sum，社保公积金Tab按当前页计算。 */
  summary: ReportLaborCostAllocationSummary
}

export type ReportLaborCostAllocationCreateForm = Record<string, unknown> & {
  allocationType?: ReportLaborCostAllocationType | null
  useYearMonth: string
  standardUnitId: ReportLaborCostAllocationId
  standardUnitName?: string | null
  departmentId: ReportLaborCostAllocationId
  departmentName?: string | null
  predictedPayableAmount?: number | string | null
  predictedUnitPension?: number | string | null
  predictedUnitMedical?: number | string | null
  predictedUnitUnemployment?: number | string | null
  predictedUnitCriticalIllness?: number | string | null
  predictedUnitMaternity?: number | string | null
  predictedUnitWorkInjury?: number | string | null
  predictedUnitSocialSecurityTotal?: number | string | null
  predictedUnitProvidentFundTotal?: number | string | null
}

export type ReportLaborCostAllocationCreateDraft = Record<string, unknown> & {
  allocationType: ReportLaborCostAllocationType
  useYearMonth: string
  standardUnitId: ReportLaborCostAllocationId
  standardUnitName: string | null
  departmentId: ReportLaborCostAllocationId
  departmentName: string | null
  predictedPayableAmount?: number
  predictedUnitPension?: number
  predictedUnitMedical?: number
  predictedUnitUnemployment?: number
  predictedUnitCriticalIllness?: number
  predictedUnitMaternity?: number
  predictedUnitWorkInjury?: number
  predictedUnitSocialSecurityTotal?: number
  predictedUnitProvidentFundTotal?: number
}

export type ReportLaborCostAllocationUpdateForm = ReportLaborCostAllocationCreateForm & {
  id: ReportLaborCostAllocationId
  status: ReportLaborCostAllocationStatus
}

export type ReportLaborCostAllocationUpdateDraft = ReportLaborCostAllocationCreateDraft & {
  id: ReportLaborCostAllocationId
  status: 0
}

export type ReportLaborCostAllocationRemoveInput = {
  allocationType?: ReportLaborCostAllocationType | null
  id: ReportLaborCostAllocationId
  currentStatus: ReportLaborCostAllocationStatus
}

export type ReportLaborCostAllocationRemoveDraft = {
  allocationType: ReportLaborCostAllocationType
  id: ReportLaborCostAllocationId
  currentStatus: 0
}

export type ReportLaborCostAllocationDownloadInput = {
  allocationType?: ReportLaborCostAllocationType | null
  organizationId: ReportLaborCostAllocationId
  useYearMonth: string
}

export type ReportLaborCostAllocationFileInput = {
  allocationType?: ReportLaborCostAllocationType | null
  fileName: string
  base64: string
  contentType?: string | null
}

export type ReportLaborCostAllocationFilePreview = {
  allocationType: ReportLaborCostAllocationType
  fileName: string
  contentType: string
  byteLength: number
}

export type ReportLaborCostAllocationFile = {
  allocationType: ReportLaborCostAllocationType
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

function allocationTypeOf (value: unknown, label = 'allocationType'): ReportLaborCostAllocationType {
  if (value === undefined || value === null || value === '') return 'salary'
  if (value === 'salary' || value === 'socialFund') return value
  throw new Error(`${label}只能是salary或socialFund`)
}

function configOf (value: unknown, label = 'allocationType'): { type: ReportLaborCostAllocationType; config: AllocationConfig } {
  const type = allocationTypeOf(value, label)
  return { type, config: ALLOCATION_CONFIG[type] }
}

function idOf (value: unknown, label: string): ReportLaborCostAllocationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): ReportLaborCostAllocationId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function monthOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function statusOf (value: unknown, label: string, required = false): ReportLaborCostAllocationStatus | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const status = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isSafeInteger(status) || ![0, 1, 2].includes(status)) throw new Error(`${label}只能是0、1或2`)
  return status as ReportLaborCostAllocationStatus
}

function editableStatusOf (value: unknown): 0 {
  const status = statusOf(value, '当前状态', true)
  if (status !== 0) throw new Error('财务已计提/已封账无法编辑/删除')
  return 0
}

function numberOf (value: unknown, label: string, required = false): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字`)
  return number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(number as number)) throw new Error('pageSize必须是10、20、50或100')
  return number as number
}

function queryOf (query: ReportLaborCostAllocationQuery = {}): { type: ReportLaborCostAllocationType; params: JsonObject } {
  const { type } = configOf(query.allocationType)
  return {
    type,
    params: {
      order: '',
      orderField: '',
      useYearMonth: monthOf(query.useYearMonth, '月份'),
      organizationId: nullableIdOf(query.organizationId, '组织ID'),
      standardUnitId: nullableIdOf(query.standardUnitId, '标准化单元ID'),
      status: statusOf(query.status, '状态'),
      pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
      pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
    },
  }
}

function decimalValueOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为数字或null`)
}

function rowOf (value: unknown, index: number): ReportLaborCostAllocationRow {
  const row = objectOf(value, `人工成本计提分配列表[${index}]`)
  const label = `人工成本计提分配列表[${index}]`
  const normalized: JsonObject = { ...row }
  const ids = ['id', 'standardUnitId', 'departmentId'] as const
  for (const field of ids) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = nullableIdOf(row[field], `${label}.${field}`)
  }
  const texts = ['useYearMonth', 'standardUnitName', 'departmentName', 'statusName'] as const
  for (const field of texts) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = nullableTextOf(row[field], `${label}.${field}`)
  }
  const amounts = [
    'predictedPayableAmount',
    'predictedUnitPension',
    'predictedUnitMedical',
    'predictedUnitUnemployment',
    'predictedUnitCriticalIllness',
    'predictedUnitMaternity',
    'predictedUnitWorkInjury',
    'predictedUnitSocialSecurityTotal',
    'predictedUnitProvidentFundTotal',
  ] as const
  for (const field of amounts) {
    if (Object.prototype.hasOwnProperty.call(row, field)) normalized[field] = decimalValueOf(row[field], `${label}.${field}`)
  }
  if (Object.prototype.hasOwnProperty.call(row, 'status')) normalized.status = statusOf(row.status, `${label}.status`)
  return normalized as ReportLaborCostAllocationRow
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): PageResult<ReportLaborCostAllocationRow> {
  const payload = payloadOf(value)
  const page = objectOf(payload, '人工成本计提分配分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('人工成本计提分配分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total }
}

function summaryNumberOf (value: unknown, label: string): number | string | null {
  return decimalValueOf(value, label)
}

function summaryOf (value: unknown, fields: readonly string[]): ReportLaborCostAllocationSummary {
  const payload = payloadOf(value)
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const object = payload as JsonObject
    const nested = object.summary ?? object.total ?? object.data
    if (nested !== undefined && nested !== payload) {
      if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) return summaryOf(nested, fields)
      return { [fields[0]!]: summaryNumberOf(nested, `合计.${fields[0]}`) }
    }
    return Object.fromEntries(fields.map(field => [field, summaryNumberOf(object[field], `合计.${field}`)]))
  }
  return { [fields[0]!]: summaryNumberOf(payload, `合计.${fields[0]}`) }
}

function summaryFromRows (rows: ReportLaborCostAllocationRow[], fields: readonly string[]): ReportLaborCostAllocationSummary {
  return Object.fromEntries(fields.map(field => [
    field,
    rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0),
  ]))
}

function requiredFormNumberOf (value: unknown, label: string): number {
  return numberOf(value, label, true)!
}

function formPayloadOf (value: unknown, withId: boolean): { type: ReportLaborCostAllocationType; payload: JsonObject } {
  const form = objectOf(value, '人工成本计提分配表单')
  const { type, config } = configOf(form.allocationType)
  const payload: JsonObject = {
    useYearMonth: monthOf(form.useYearMonth, '月份', true),
    standardUnitId: idOf(form.standardUnitId, '标准化单元ID'),
    standardUnitName: nullableTextOf(form.standardUnitName, '标准化单元名称'),
    departmentId: idOf(form.departmentId, '部门ID'),
    departmentName: nullableTextOf(form.departmentName, '部门名称'),
  }
  for (const field of config.amountFields) payload[field] = requiredFormNumberOf(form[field], field)
  if (withId) payload.id = idOf(form.id, '人工成本计提分配ID')
  return { type, payload }
}

function createDraftOf (value: unknown): ReportLaborCostAllocationCreateDraft {
  const prepared = formPayloadOf(value, false)
  return { allocationType: prepared.type, ...prepared.payload } as ReportLaborCostAllocationCreateDraft
}

function createPayloadOf (value: unknown): { type: ReportLaborCostAllocationType; payload: JsonObject } {
  return formPayloadOf(value, false)
}

function updateDraftOf (value: unknown): ReportLaborCostAllocationUpdateDraft {
  const form = objectOf(value, '人工成本计提分配编辑表单')
  const status = editableStatusOf(form.status)
  const prepared = formPayloadOf(value, true)
  return { allocationType: prepared.type, ...prepared.payload, id: prepared.payload.id as ReportLaborCostAllocationId, status } as ReportLaborCostAllocationUpdateDraft
}

function updatePayloadOf (value: unknown): { type: ReportLaborCostAllocationType; payload: JsonObject } {
  const draft = objectOf(value, '人工成本计提分配编辑草稿')
  editableStatusOf(draft.status)
  return formPayloadOf(draft, true)
}

function removeDraftOf (value: unknown): ReportLaborCostAllocationRemoveDraft {
  const input = objectOf(value, '人工成本计提分配删除确认')
  const { type } = configOf(input.allocationType)
  const currentStatus = editableStatusOf(input.currentStatus)
  return { allocationType: type, id: idOf(input.id, '人工成本计提分配ID'), currentStatus }
}

function bytesOf (value: unknown): { type: ReportLaborCostAllocationType; fileName: string; contentType: string; bytes: Uint8Array } {
  const input = objectOf(value, '人工成本计提分配导入文件')
  const { type } = configOf(input.allocationType)
  if (typeof input.fileName !== 'string' || input.fileName.trim() === '') throw new Error('fileName不能为空')
  if (!/\.(xml|xlsx|xls)$/i.test(input.fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  if (typeof input.base64 !== 'string' || input.base64.trim() === '') throw new Error('base64不能为空')
  const base64 = input.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof input.contentType === 'string' && input.contentType
    ? input.contentType
    : input.fileName.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { type, fileName: input.fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (value: unknown): ReportLaborCostAllocationFilePreview {
  const file = bytesOf(value)
  return { allocationType: file.type, fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, type: ReportLaborCostAllocationType, fallback: string): ReportLaborCostAllocationFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('人工成本计提分配模板响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    allocationType: type,
    fileName: fallback,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function idResultOf (value: unknown, label: string): ReportLaborCostAllocationId {
  const payload = payloadOf(value)
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) return idOf((payload as JsonObject).id, label)
  return idOf(payload, label)
}

function trueResultOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createReportLaborCostAllocationCapability (request: PortalRequest) {
  return {
    async list (query: ReportLaborCostAllocationQuery = {}): Promise<ReportLaborCostAllocationPage> {
      const { type, params } = queryOf(query)
      const config = ALLOCATION_CONFIG[type]
      const pageRequest = request({ url: `${config.root}/page`, method: 'get', params })
      if (type === 'salary') {
        const [pageResult, sumResult] = await Promise.all([
          pageRequest,
          request({ url: `${config.root}/sum`, method: 'get', params: { ...params } }),
        ])
        const page = pageOf(await pageResult)
        return { ...page, summary: summaryOf(await sumResult, config.amountFields) }
      }
      const page = pageOf(await pageRequest)
      return { ...page, summary: summaryFromRows(page.list, config.amountFields) }
    },

    prepareCreate (form: ReportLaborCostAllocationCreateForm): { draft: ReportLaborCostAllocationCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ReportLaborCostAllocationCreateDraft }): Promise<ReportLaborCostAllocationId> {
      const prepared = createPayloadOf(input?.draft)
      const result = await request({ url: `${ALLOCATION_CONFIG[prepared.type].root}/create`, method: 'post', data: prepared.payload })
      return idResultOf(result, '人工成本计提分配新建返回ID')
    },

    prepareUpdate (form: ReportLaborCostAllocationUpdateForm): { draft: ReportLaborCostAllocationUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ReportLaborCostAllocationUpdateDraft }): Promise<true> {
      const prepared = updatePayloadOf(input?.draft)
      const result = await request({ url: `${ALLOCATION_CONFIG[prepared.type].root}/update`, method: 'put', data: prepared.payload })
      return trueResultOf(result, '人工成本计提分配编辑')
    },

    prepareRemove (input: ReportLaborCostAllocationRemoveInput): ReportLaborCostAllocationRemoveDraft {
      return removeDraftOf(input)
    },

    async remove (input: ReportLaborCostAllocationRemoveDraft): Promise<true> {
      const prepared = removeDraftOf(input)
      const result = await request({ url: `${ALLOCATION_CONFIG[prepared.allocationType].root}/delete/${prepared.id}`, method: 'delete' })
      return trueResultOf(result, '人工成本计提分配删除')
    },

    async downloadTemplate (input: ReportLaborCostAllocationDownloadInput = { organizationId: '', useYearMonth: '' } as ReportLaborCostAllocationDownloadInput): Promise<ReportLaborCostAllocationFile> {
      const { type, config } = configOf(input?.allocationType)
      const response = await request<AxiosResponse<ArrayBuffer>>({
        url: `${config.root}/download-template`,
        method: 'get',
        params: {
          organizationId: idOf(input?.organizationId, '组织ID'),
          useYearMonth: monthOf(input?.useYearMonth, '月份', true),
        },
        responseType: 'arraybuffer',
      })
      return fileOf(response, type, config.fileName)
    },

    prepareImport (input: ReportLaborCostAllocationFileInput): ReportLaborCostAllocationFilePreview {
      return filePreviewOf(input)
    },

    async importExcel (input: ReportLaborCostAllocationFileInput): Promise<string | null> {
      const file = bytesOf(input)
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      const data = new FormData()
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({
        url: `${ALLOCATION_CONFIG[file.type].root}/import`,
        method: 'post',
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (result === undefined || result === null || result === '') return null
      if (typeof result !== 'string') throw new Error('人工成本计提分配导入响应必须为字符串或空值')
      return result
    },
  }
}

export type ReportLaborCostAllocationCapability = ReturnType<typeof createReportLaborCostAllocationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const allocationParam = p('allocationType', 'enum', false, 'Tab类型：salary工资成本，socialFund社保公积金；默认salary')
const listParams: ParamSpec[] = [
  allocationParam,
  p('useYearMonth', 'date', false, '月份，格式YYYY-MM；默认空值'),
  p('organizationId', 'tree', false, '组织筛选ID；默认空值'),
  p('standardUnitId', 'tree', false, '标准化单元筛选ID；默认空值'),
  p('status', 'enum', false, '状态：0待计提、1待月结、2已月结；默认空值'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'),
]
const formParam = p('form', 'text', true, 'Portal人工成本计提分配表单；按allocationType填写月份、组织、部门和当前Tab金额字段')
const fileParams: ParamSpec[] = [
  allocationParam,
  p('fileName', 'text', true, '上传文件名，支持.xml、.xlsx、.xls'),
  p('base64', 'text', true, '文件内容Base64'),
  p('contentType', 'text', false, '文件MIME类型'),
]

export const REPORT_LABOR_COST_ALLOCATION_METHODS = {
  'report-labor-cost-allocation-list': 'list',
  'report-labor-cost-allocation-prepare-create': 'prepareCreate',
  'report-labor-cost-allocation-create': 'create',
  'report-labor-cost-allocation-prepare-update': 'prepareUpdate',
  'report-labor-cost-allocation-update': 'update',
  'report-labor-cost-allocation-prepare-remove': 'prepareRemove',
  'report-labor-cost-allocation-remove': 'remove',
  'report-labor-cost-allocation-download-template': 'downloadTemplate',
  'report-labor-cost-allocation-prepare-import': 'prepareImport',
  'report-labor-cost-allocation-import': 'importExcel',
} as const

export const reportLaborCostAllocationCapabilities: CapabilityDefinition[] = [
  { id: 'report-labor-cost-allocation-list', title: '查询人工成本计提分配表', write: false, params: listParams },
  { id: 'report-labor-cost-allocation-prepare-create', title: '准备新建人工成本计提分配', write: false, params: [formParam] },
  { id: 'report-labor-cost-allocation-create', title: '新建人工成本计提分配', write: true, params: [allocationParam, p('draft', 'text', true, 'prepareCreate返回的当前Tab保存草稿')] },
  { id: 'report-labor-cost-allocation-prepare-update', title: '准备编辑人工成本计提分配', write: false, params: [formParam] },
  { id: 'report-labor-cost-allocation-update', title: '编辑人工成本计提分配', write: true, params: [allocationParam, p('draft', 'text', true, 'prepareUpdate返回的当前Tab保存草稿')] },
  { id: 'report-labor-cost-allocation-prepare-remove', title: '准备删除人工成本计提分配', write: false, params: [allocationParam, p('id', 'number', true, '当前列表行ID'), p('currentStatus', 'enum', true, '当前列表行状态；只有0待计提允许删除')] },
  { id: 'report-labor-cost-allocation-remove', title: '删除人工成本计提分配', write: true, params: [allocationParam, p('id', 'number', true, 'prepareRemove返回的ID'), p('currentStatus', 'enum', true, 'prepareRemove确认的当前状态；必须为0')] },
  { id: 'report-labor-cost-allocation-download-template', title: '下载人工成本计提分配模板', write: false, params: [allocationParam, p('organizationId', 'tree', true, '下载模板的组织ID'), p('useYearMonth', 'date', true, '模板月份，格式YYYY-MM')] },
  { id: 'report-labor-cost-allocation-prepare-import', title: '准备导入人工成本计提分配文件', write: false, params: fileParams },
  { id: 'report-labor-cost-allocation-import', title: '导入人工成本计提分配文件', write: true, params: fileParams },
].map(definition => ({
  ...definition,
  pagePath: REPORT_LABOR_COST_ALLOCATION_PAGE_PATH,
  permission: REPORT_LABOR_COST_ALLOCATION_PERMISSION,
  moduleType: REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE,
  httpInstance: 'platform',
}))
