import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 商标管理」列表、表单、续展、导出和共享入口。 */
export const TRADEMARK_PAGE_PATH = '/dashboard/certificate/trademark/list'
export const TRADEMARK_PERMISSION = '/dashboard/certificate/trademark'
export const TRADEMARK_MODULE_TYPE = 15
export const TRADEMARK_SHARE_TYPE = 3

const ROOT = '/admin-api/hr/risk/trademark'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_IMAGE_COUNT = 3
const MAX_PDF_COUNT = 10
const MAX_RENEWAL_ATTACHMENT_COUNT = 10
const MAX_RENEWAL_ATTACHMENT_SIZE = 20 * 1024 * 1024
const RENEWAL_FILE_EXTENSIONS = new Set(['pdf', 'xls', 'xlsx', 'doc', 'docx', 'jpg', 'jpeg', 'png'])

export type TrademarkId = string | number
export type TrademarkScalar = string | number

export type TrademarkQuery = {
  signNumber?: TrademarkScalar | null
  name?: string | null
  category?: TrademarkScalar | null
  type?: TrademarkScalar | null
  organizationId?: TrademarkId | null
  pageNo?: number
  pageSize?: number
}

export type TrademarkRow = Record<string, unknown> & {
  id: TrademarkId
  name: string | null
  signNumber: string | null
  fileUrl: string | null
  category: number | null
  type: number | null
  loginTime: string | null
  endTime: string | null
  remindTime: number | null
  remindUser: string | null
  remindUserName: string | null
  product: string | null
  createTime: string | null
  status: number | null
  pdfUrl: string | null
  pdfName: string | null
  organizationId: TrademarkId | null
  organizationName: string | null
  address: string | null
  validStatus: number | null
  renewalRecordCount: number | null
  renewable: boolean | null
}

export type TrademarkForm = {
  id?: TrademarkId
  validStatus: number
  signNumber: TrademarkScalar
  name: string
  fileUrl: string[]
  category: number
  type: number | null
  loginTime: string
  endTime: string
  remindTime: number
  remindUser: TrademarkId[]
  organizationId: TrademarkId
  address: string
  pdfUrl: string[]
  pdfName: string[]
  product: string | null
}

export type TrademarkPreparation = {
  draft: TrademarkForm
  previous?: TrademarkForm
}

export type TrademarkShareMember = {
  id: TrademarkId
  name?: string
  managerType?: number
}

export type TrademarkShare = {
  organization: TrademarkShareMember[]
  post: TrademarkShareMember[]
  duty: TrademarkShareMember[]
  user: TrademarkShareMember[]
}

export type TrademarkShareInput = {
  resourceId: TrademarkId
  organization?: TrademarkShareMember[]
  post?: TrademarkShareMember[]
  duty?: TrademarkShareMember[]
  user?: TrademarkShareMember[]
}

export type TrademarkFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type TrademarkRenewalAttachment = {
  name: string
  url: string
  size: number
}

export type TrademarkRenewalDraft = {
  trademarkIds: TrademarkId[]
  content: string
  attachments: TrademarkRenewalAttachment[]
}

export type TrademarkRenewalPreparation = { draft: TrademarkRenewalDraft }

export type TrademarkRenewalRecord = {
  renewalTime: string | null
  renewalUserName: string | null
  content: string | null
  attachments: TrademarkRenewalAttachment[]
}

export type TrademarkRenewalRecords = {
  trademark: {
    id: TrademarkId
    name: string | null
    signNumber: string | null
    category: number | null
    endTime: string | null
  }
  records: TrademarkRenewalRecord[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): TrademarkId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): TrademarkId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function scalarOf (value: unknown, label: string): TrademarkScalar | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function boundedTextOf (value: unknown, label: string, max: number, required = false): string | null {
  const text = textOf(value, label)
  if (required && (text === null || text.trim() === '')) throw new Error(`${label}不能为空或全为空格`)
  if (text !== null && text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function signNumberOf (value: unknown, label: string): TrademarkScalar {
  const result = scalarOf(value, label)
  if (result === null) throw new Error(`${label}不能为空`)
  if (typeof result === 'number' && (!Number.isSafeInteger(result) || result < 0)) throw new Error(`${label}必须为非负整数`)
  if (typeof result === 'string' && !/^\d+$/.test(result)) throw new Error(`${label}必须为非负整数`)
  if (String(result).length > 10) throw new Error(`${label}最多10个字符`)
  return result
}

function dateOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function requiredIntegerOf (value: unknown, label: string): number {
  const result = integerOf(value, label)
  if (result === null) throw new Error(`${label}不能为空`)
  return result
}

function optionIntegerOf (value: unknown, label: string, options: readonly number[]): number | null {
  const result = integerOf(value, label)
  if (result !== null && !options.includes(result)) throw new Error(`${label}必须是${options.join('、')}`)
  return result
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function idListOf (value: unknown, label: string, required = false): TrademarkId[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`)
    return []
  }
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  const list = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (required && list.length === 0) throw new Error(`${label}不能为空`)
  return list
}

function csvListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const text = textOf(item, `${label}[${index}]`)
      if (text === null || text.trim() === '') throw new Error(`${label}[${index}]不能为空`)
      return text
    })
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是逗号字符串或字符串数组`)
  return value.split(',').filter(Boolean)
}

function formOf (value: unknown, label: string, requireId = false): TrademarkForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const validStatus = requiredIntegerOf(input.validStatus, `${label}.validStatus`)
  if (![1, 2].includes(validStatus)) throw new Error(`${label}.validStatus必须是1或2`)
  const category = requiredIntegerOf(input.category, `${label}.category`)
  const type = optionIntegerOf(input.type, `${label}.type`, [1, 2])
  const loginTime = dateOf(input.loginTime, `${label}.loginTime`, true)!
  const endTime = dateOf(input.endTime, `${label}.endTime`, true)!
  if (endTime <= loginTime) throw new Error(`${label}.endTime必须晚于loginTime`)
  const remindTime = requiredIntegerOf(input.remindTime, `${label}.remindTime`)
  if (remindTime < 1) throw new Error(`${label}.remindTime必须为大于等于1的整数`)
  const remindUser = idListOf(input.remindUser, `${label}.remindUser`, true)
  const fileUrl = csvListOf(input.fileUrl, `${label}.fileUrl`)
  if (fileUrl.length > MAX_IMAGE_COUNT) throw new Error(`${label}.fileUrl最多${MAX_IMAGE_COUNT}项`)
  const pdfUrl = csvListOf(input.pdfUrl, `${label}.pdfUrl`)
  const pdfName = csvListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length === 0) throw new Error(`${label}.pdfUrl不能为空；至少上传一个PDF附件`)
  if (pdfUrl.length > MAX_PDF_COUNT || pdfName.length > MAX_PDF_COUNT) throw new Error(`${label}.pdfUrl最多${MAX_PDF_COUNT}项`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return {
    ...(id === undefined ? {} : { id }),
    validStatus,
    signNumber: signNumberOf(input.signNumber, `${label}.signNumber`),
    name: boundedTextOf(input.name, `${label}.name`, 10, true)!,
    fileUrl,
    category,
    type,
    loginTime,
    endTime,
    remindTime,
    remindUser,
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    address: boundedTextOf(input.address, `${label}.address`, Number.MAX_SAFE_INTEGER, true)!,
    pdfUrl,
    pdfName,
    product: boundedTextOf(input.product, `${label}.product`, 500),
  }
}

function rowOf (value: unknown, label = '商标'): TrademarkRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    signNumber: textOf(row.signNumber, `${label}.signNumber`),
    fileUrl: textOf(row.fileUrl, `${label}.fileUrl`),
    category: integerOf(row.category, `${label}.category`),
    type: integerOf(row.type, `${label}.type`),
    loginTime: textOf(row.loginTime, `${label}.loginTime`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    remindTime: integerOf(row.remindTime, `${label}.remindTime`),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    remindUserName: textOf(row.remindUserName, `${label}.remindUserName`),
    product: textOf(row.product, `${label}.product`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    status: integerOf(row.status, `${label}.status`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    address: textOf(row.address, `${label}.address`),
    validStatus: integerOf(row.validStatus, `${label}.validStatus`),
    renewalRecordCount: integerOf(row.renewalRecordCount, `${label}.renewalRecordCount`),
    renewable: row.renewable === undefined || row.renewable === null ? null : Boolean(row.renewable),
  }
}

function pageOf (value: unknown): PageResult<TrademarkRow> {
  const page = objectOf(value, '商标分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('商标分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `商标分页[${index}]`)), total: page.total as number }
}

function formFromRow (row: TrademarkRow): TrademarkForm {
  return formOf({
    ...row,
    fileUrl: csvListOf(row.fileUrl, 'current.fileUrl'),
    pdfUrl: csvListOf(row.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(row.pdfName, 'current.pdfName'),
    remindUser: csvListOf(row.remindUser, 'current.remindUser'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    validStatus: form.validStatus,
    signNumber: form.signNumber,
    name: form.name,
    fileUrl: form.fileUrl.join(',') || null,
    category: form.category,
    type: form.type,
    loginTime: form.loginTime,
    endTime: form.endTime,
    remindTime: form.remindTime,
    remindUser: form.remindUser.join(',') || null,
    organizationId: form.organizationId,
    address: form.address,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
    product: form.product,
  }
}

function shareMemberOf (value: unknown, label: string): TrademarkShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: typeof row.managerType === 'number' && Number.isFinite(row.managerType) ? row.managerType : (() => { throw new Error(`${label}.managerType必须为数字`) })() }),
  }
}

function shareOf (value: unknown): TrademarkShare {
  const row = objectOf(value, '商标共享响应')
  const members = (key: string): TrademarkShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '商标共享参数') as TrademarkShareInput
  return {
    type: TRADEMARK_SHARE_TYPE,
    resourceId: idOf(input.resourceId, 'resourceId'),
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function listValueOf (value: unknown, label: string): string | number {
  const result = scalarOf(value, label)
  return result === null ? '' : result
}

function listParamsOf (query: TrademarkQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    signNumber: listValueOf(query.signNumber, 'signNumber'),
    name: listValueOf(query.name, 'name'),
    category: listValueOf(query.category, 'category'),
    type: listValueOf(query.type, 'type'),
    organizationId: listValueOf(query.organizationId, 'organizationId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
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

function fileOf (response: AxiosResponse<ArrayBuffer>): TrademarkFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('商标导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '商标管理.xls'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function renewalAttachmentOf (value: unknown, label: string): TrademarkRenewalAttachment {
  const row = objectOf(value, label)
  const name = boundedTextOf(row.name, `${label}.name`, 255, true)!
  const url = boundedTextOf(row.url, `${label}.url`, 1000, true)!
  const size = requiredIntegerOf(row.size, `${label}.size`)
  if (size <= 0 || size > MAX_RENEWAL_ATTACHMENT_SIZE) throw new Error(`${label}.size必须大于0且不超过20MB`)
  const extension = name.split('.').pop()?.toLowerCase() || ''
  if (!RENEWAL_FILE_EXTENSIONS.has(extension)) throw new Error(`${label}.name格式不支持`)
  return { name, url, size }
}

function renewalDraftOf (value: unknown, label = '续展'): TrademarkRenewalDraft {
  const input = objectOf(value, label)
  const trademarkIds = idListOf(input.trademarkIds, `${label}.trademarkIds`, true)
  if (new Set(trademarkIds.map(String)).size !== trademarkIds.length) throw new Error(`${label}.trademarkIds不能重复`)
  const content = boundedTextOf(input.content, `${label}.content`, 500, true)!
  if (!Array.isArray(input.attachments) || input.attachments.length === 0) throw new Error(`${label}.attachments不能为空`)
  if (input.attachments.length > MAX_RENEWAL_ATTACHMENT_COUNT) throw new Error(`${label}.attachments最多${MAX_RENEWAL_ATTACHMENT_COUNT}项`)
  return { trademarkIds, content: content.trim(), attachments: input.attachments.map((item, index) => renewalAttachmentOf(item, `${label}.attachments[${index}]`)) }
}

function renewalRecordsOf (value: unknown): TrademarkRenewalRecords {
  const input = objectOf(value, '商标续展记录响应')
  const trademark = objectOf(input.trademark, '商标续展记录响应.trademark')
  if (!Array.isArray(input.records)) throw new Error('商标续展记录响应.records必须是数组')
  return {
    trademark: {
      id: idOf(trademark.id, '商标续展记录响应.trademark.id'),
      name: textOf(trademark.name, '商标续展记录响应.trademark.name'),
      signNumber: textOf(trademark.signNumber, '商标续展记录响应.trademark.signNumber'),
      category: integerOf(trademark.category, '商标续展记录响应.trademark.category'),
      endTime: textOf(trademark.endTime, '商标续展记录响应.trademark.endTime'),
    },
    records: input.records.map((item, index) => {
      const record = objectOf(item, `商标续展记录[${index}]`)
      if (!Array.isArray(record.attachments)) throw new Error(`商标续展记录[${index}].attachments必须是数组`)
      return {
        renewalTime: textOf(record.renewalTime, `商标续展记录[${index}].renewalTime`),
        renewalUserName: textOf(record.renewalUserName, `商标续展记录[${index}].renewalUserName`),
        content: textOf(record.content, `商标续展记录[${index}].content`),
        attachments: record.attachments.map((attachment, attachmentIndex) => renewalAttachmentOf(attachment, `商标续展记录[${index}].attachments[${attachmentIndex}]`)),
      }
    }),
  }
}

export function createTrademarkCapability (request: PortalRequest) {
  return {
    async list (query: TrademarkQuery = {}): Promise<PageResult<TrademarkRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: TrademarkId }): Promise<TrademarkRow> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '商标ID') } }), '商标详情')
    },
    prepareCreate (input: TrademarkForm): TrademarkPreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: TrademarkForm }): Promise<TrademarkId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建商标响应')
    },
    prepareUpdate (input: { current: TrademarkRow; changes?: Partial<TrademarkForm> | null }): TrademarkPreparation {
      const current = formFromRow(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: TrademarkForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新商标')
    },
    async remove (input: { id: TrademarkId }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '商标ID') } }), '删除商标')
    },
    async export (query: TrademarkQuery = {}): Promise<TrademarkFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: listParamsOf({ ...query, pageNo: undefined, pageSize: undefined }), responseType: 'arraybuffer' }))
    },
    async getShare (input: { resourceId: TrademarkId }): Promise<TrademarkShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: TRADEMARK_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: TrademarkShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存商标共享')
    },
    async getRenewalRecords (input: { trademarkId: TrademarkId }): Promise<TrademarkRenewalRecords> {
      const trademarkId = idOf(input?.trademarkId, 'trademarkId')
      return renewalRecordsOf(await request({ url: `${ROOT}/renewal/records`, method: 'get', params: { trademarkId } }))
    },
    prepareRenewal (input: TrademarkRenewalDraft): TrademarkRenewalPreparation {
      return { draft: renewalDraftOf(input) }
    },
    async renewal (input: { draft: TrademarkRenewalDraft }): Promise<TrademarkId> {
      return idOf(await request({ url: `${ROOT}/renewal/batch`, method: 'post', data: renewalDraftOf(input?.draft, 'draft') }), '商标续展响应')
    },
  }
}

export type TrademarkCapability = ReturnType<typeof createTrademarkCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const listParams: ParamSpec[] = [
  p('signNumber', 'text', false, '申请号/注册号筛选；默认空字符串'),
  p('name', 'text', false, '商标名称筛选；默认空字符串'),
  p('category', 'search', false, 'trademark_category 字典值筛选；默认空字符串'),
  p('type', 'enum', false, '商标类型；1驰名商标、2著名商标；默认空字符串',),
  p('organizationId', 'tree', false, '注册人角色组织ID；默认空字符串'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`),
]

export const TRADEMARK_METHODS = {
  'trademark-list': 'list',
  'trademark-get': 'get',
  'trademark-prepare-create': 'prepareCreate',
  'trademark-create': 'create',
  'trademark-prepare-update': 'prepareUpdate',
  'trademark-update': 'update',
  'trademark-remove': 'remove',
  'trademark-export': 'export',
  'trademark-get-share': 'getShare',
  'trademark-save-share': 'saveShare',
  'trademark-renewal-records': 'getRenewalRecords',
  'trademark-prepare-renewal': 'prepareRenewal',
  'trademark-renewal': 'renewal',
} as const

export const trademarkCapabilities: CapabilityDefinition[] = [
  { id: 'trademark-list', title: '查询商标列表', write: false, params: listParams },
  { id: 'trademark-get', title: '读取商标详情', write: false, params: [p('id', 'number', true, '商标ID')] },
  { id: 'trademark-prepare-create', title: '准备新建商标', write: false, params: [p('form', 'text', true, 'Portal 商标表单')] },
  { id: 'trademark-create', title: '新建商标', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'trademark-prepare-update', title: '准备编辑商标', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'trademark-update', title: '保存商标', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'trademark-remove', title: '删除商标', write: true, params: [p('id', 'number', true, '商标ID')] },
  { id: 'trademark-export', title: '导出商标管理Excel', write: false, params: listParams.slice(0, 5) },
  { id: 'trademark-get-share', title: '读取商标共享设置', write: false, params: [p('resourceId', 'number', true, '商标ID')] },
  { id: 'trademark-save-share', title: '保存商标共享设置', write: true, params: [p('resourceId', 'number', true, '商标ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
  { id: 'trademark-renewal-records', title: '查询商标续展记录', write: false, params: [p('trademarkId', 'number', true, '商标ID')] },
  { id: 'trademark-prepare-renewal', title: '准备批量续展商标', write: false, params: [p('trademarkIds', 'text', true, '可续展商标ID数组'), p('content', 'text', true, '续展内容，最多500字符'), p('attachments', 'text', true, '续展附件，1至10个')] },
  { id: 'trademark-renewal', title: '提交批量续展商标', write: true, params: [p('draft', 'text', true, 'prepareRenewal 返回的完整草稿')] },
].map(definition => ({ ...definition, pagePath: TRADEMARK_PAGE_PATH, permission: TRADEMARK_PERMISSION, moduleType: TRADEMARK_MODULE_TYPE, httpInstance: 'platform' }))
