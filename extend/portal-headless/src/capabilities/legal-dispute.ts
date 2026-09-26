import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 纠纷信息」列表、表单、导出和共享入口。 */
export const LEGAL_DISPUTE_PAGE_PATH = '/dashboard/certificate/legalDisputes/list'
export const LEGAL_DISPUTE_PERMISSION = '/dashboard/certificate/legalDisputes'
export const LEGAL_DISPUTE_MODULE_TYPE = 15
export const LEGAL_DISPUTE_SHARE_TYPE = 4

const ROOT = '/admin-api/hr/legal-dispute'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 10

export type LegalDisputeId = string | number
export type LegalDisputeSolution = '1' | '2' | '3'

export type LegalDisputeQuery = {
  caseReason?: string | null
  caseNumber?: string | null
  prosecutor?: string | null
  defendant?: string | null
  pageNo?: number
  pageSize?: number
}

export type LegalDisputeRow = Record<string, unknown> & {
  id: LegalDisputeId
  organizationId: LegalDisputeId | null
  organizationName: string | null
  caseReason: string | null
  caseNumber: string | null
  prosecutor: string | null
  defendant: string | null
  thirdPerson: string | null
  requestItem: string | null
  amount: number | string | null
  solution: string | null
  result: string | null
  causeLoss: number | string | null
  recoverLoss: number | string | null
  createTime: string | null
  pdfUrl: string | null
  pdfName: string | null
  year: number | null
  disputeType: number | null
  disputeTypeName: string | null
  litigationType: number | null
  litigationTypeName: string | null
  creator: LegalDisputeId | null
  creatorName: string | null
}

export type LegalDisputeForm = {
  id?: LegalDisputeId
  organizationId: LegalDisputeId
  year: string
  disputeType: number
  litigationType: number
  caseReason: string
  caseNumber: string
  prosecutor: string
  defendant: string
  thirdPerson: string
  requestItem: string
  amount: number
  solution: LegalDisputeSolution
  result: string
  causeLoss: number
  recoverLoss: number
  pdfUrl: string[]
  pdfName: string[]
}

export type LegalDisputePreparation = {
  draft: LegalDisputeForm
  previous?: LegalDisputeForm
}

export type LegalDisputeShareMember = {
  id: LegalDisputeId
  name?: string
  managerType?: number
}

export type LegalDisputeShare = {
  organization: LegalDisputeShareMember[]
  post: LegalDisputeShareMember[]
  duty: LegalDisputeShareMember[]
  user: LegalDisputeShareMember[]
}

export type LegalDisputeShareInput = {
  resourceId: LegalDisputeId
  organization?: LegalDisputeShareMember[]
  post?: LegalDisputeShareMember[]
  duty?: LegalDisputeShareMember[]
  user?: LegalDisputeShareMember[]
}

export type LegalDisputeFile = {
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

function idOf (value: unknown, label: string): LegalDisputeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): LegalDisputeId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, max?: number): string {
  const text = textOf(value, label)
  if (text === null || text.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (max !== undefined && text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function optionalTextOf (value: unknown, label: string, max?: number): string {
  const text = textOf(value, label) ?? ''
  if (max !== undefined && text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function finiteNumberOf (value: unknown, label: string, required = false): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label}必须为非负有限数字`)
  if (String(value).length > 20) throw new Error(`${label}最多20个字符`)
  const decimal = String(value).split('.')[1]
  if (decimal && decimal.length > 2) throw new Error(`${label}最多保留2位小数`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function yearOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return ''
  }
  const year = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof year !== 'string' || !/^\d{4}$/.test(year)) throw new Error(`${label}必须为YYYY`)
  return year
}

function solutionOf (value: unknown, label: string): LegalDisputeSolution {
  const solution = typeof value === 'number' ? String(value) : value
  if (solution !== '1' && solution !== '2' && solution !== '3') throw new Error(`${label}必须为1、2或3`)
  return solution
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function listParamsOf (query: LegalDisputeQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    caseReason: optionalTextOf(query.caseReason, 'caseReason'),
    caseNumber: optionalTextOf(query.caseNumber, 'caseNumber'),
    prosecutor: optionalTextOf(query.prosecutor, 'prosecutor'),
    defendant: optionalTextOf(query.defendant, 'defendant'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

function rowOf (value: unknown, label = '法律纠纷'): LegalDisputeRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    caseReason: textOf(row.caseReason, `${label}.caseReason`),
    caseNumber: textOf(row.caseNumber, `${label}.caseNumber`),
    prosecutor: textOf(row.prosecutor, `${label}.prosecutor`),
    defendant: textOf(row.defendant, `${label}.defendant`),
    thirdPerson: textOf(row.thirdPerson, `${label}.thirdPerson`),
    requestItem: textOf(row.requestItem, `${label}.requestItem`),
    amount: row.amount === undefined || row.amount === null ? null : (typeof row.amount === 'number' || typeof row.amount === 'string' ? row.amount : (() => { throw new Error(`${label}.amount必须为数字、数字字符串或null`) })()),
    solution: textOf(row.solution, `${label}.solution`),
    result: textOf(row.result, `${label}.result`),
    causeLoss: row.causeLoss === undefined || row.causeLoss === null ? null : (typeof row.causeLoss === 'number' || typeof row.causeLoss === 'string' ? row.causeLoss : (() => { throw new Error(`${label}.causeLoss必须为数字、数字字符串或null`) })()),
    recoverLoss: row.recoverLoss === undefined || row.recoverLoss === null ? null : (typeof row.recoverLoss === 'number' || typeof row.recoverLoss === 'string' ? row.recoverLoss : (() => { throw new Error(`${label}.recoverLoss必须为数字、数字字符串或null`) })()),
    createTime: textOf(row.createTime, `${label}.createTime`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    year: integerOf(row.year, `${label}.year`),
    disputeType: integerOf(row.disputeType, `${label}.disputeType`),
    disputeTypeName: textOf(row.disputeTypeName, `${label}.disputeTypeName`),
    litigationType: integerOf(row.litigationType, `${label}.litigationType`),
    litigationTypeName: textOf(row.litigationTypeName, `${label}.litigationTypeName`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    creatorName: textOf(row.creatorName, `${label}.creatorName`),
  }
}

function pageOf (value: unknown): PageResult<LegalDisputeRow> {
  const page = objectOf(value, '法律纠纷分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('法律纠纷分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `法律纠纷分页[${index}]`)), total: page.total as number }
}

function csvListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value.map((item, index) => requiredTextOf(item, `${label}[${index}]`))
  if (typeof value !== 'string') throw new Error(`${label}必须为逗号字符串或字符串数组`)
  return value.split(',').filter(item => item !== '')
}

function fileListOf (value: unknown, label: string): string[] {
  const list = csvListOf(value, label)
  if (list.length > MAX_PDF_COUNT) throw new Error(`${label}最多${MAX_PDF_COUNT}项`)
  return list
}

function formOf (value: unknown, label: string, requireId = false): LegalDisputeForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const form: LegalDisputeForm = {
    ...(id === undefined ? {} : { id }),
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    year: yearOf(input.year, `${label}.year`, true),
    disputeType: integerOf(input.disputeType, `${label}.disputeType`) ?? (() => { throw new Error(`${label}.disputeType不能为空`) })(),
    litigationType: integerOf(input.litigationType, `${label}.litigationType`) ?? (() => { throw new Error(`${label}.litigationType不能为空`) })(),
    caseReason: requiredTextOf(input.caseReason, `${label}.caseReason`, 20),
    caseNumber: requiredTextOf(input.caseNumber, `${label}.caseNumber`, 50),
    prosecutor: requiredTextOf(input.prosecutor, `${label}.prosecutor`, 100),
    defendant: requiredTextOf(input.defendant, `${label}.defendant`, 100),
    thirdPerson: optionalTextOf(input.thirdPerson, `${label}.thirdPerson`, 500),
    requestItem: requiredTextOf(input.requestItem, `${label}.requestItem`, 5000),
    amount: finiteNumberOf(input.amount, `${label}.amount`, true)!,
    solution: solutionOf(input.solution, `${label}.solution`),
    result: requiredTextOf(input.result, `${label}.result`, 5000),
    causeLoss: finiteNumberOf(input.causeLoss, `${label}.causeLoss`, true)!,
    recoverLoss: finiteNumberOf(input.recoverLoss, `${label}.recoverLoss`, true)!,
    pdfUrl: fileListOf(input.pdfUrl, `${label}.pdfUrl`),
    pdfName: fileListOf(input.pdfName, `${label}.pdfName`),
  }
  if (form.pdfUrl.length !== form.pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return form
}

function formFromRow (row: LegalDisputeRow): LegalDisputeForm {
  return formOf({
    ...row,
    year: row.year === null ? null : String(row.year),
    pdfUrl: csvListOf(row.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(row.pdfName, 'current.pdfName'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    organizationId: form.organizationId,
    year: form.year,
    disputeType: form.disputeType,
    litigationType: form.litigationType,
    caseReason: form.caseReason,
    caseNumber: form.caseNumber,
    prosecutor: form.prosecutor,
    defendant: form.defendant,
    thirdPerson: form.thirdPerson,
    requestItem: form.requestItem,
    amount: form.amount,
    solution: form.solution,
    result: form.result,
    causeLoss: form.causeLoss,
    recoverLoss: form.recoverLoss,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): LegalDisputeShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: finiteNumberOf(row.managerType, `${label}.managerType`) ?? 1 }),
  }
}

function shareOf (value: unknown): LegalDisputeShare {
  const row = objectOf(value, '法律纠纷共享响应')
  const members = (key: string): LegalDisputeShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '法律纠纷共享参数') as LegalDisputeShareInput
  return {
    type: LEGAL_DISPUTE_SHARE_TYPE,
    resourceId: idOf(input.resourceId, 'resourceId'),
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

function fileOf (response: AxiosResponse<ArrayBuffer>): LegalDisputeFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('法律纠纷导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: '法律纠纷.xlsx', contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createLegalDisputeCapability (request: PortalRequest) {
  return {
    async list (query: LegalDisputeQuery = {}): Promise<PageResult<LegalDisputeRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: LegalDisputeId }): Promise<LegalDisputeRow> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '法律纠纷ID') } }), '法律纠纷详情')
    },
    async export (query: LegalDisputeQuery = {}): Promise<LegalDisputeFile> {
      const params = {
        caseReason: optionalTextOf(query.caseReason, 'caseReason'),
        caseNumber: optionalTextOf(query.caseNumber, 'caseNumber'),
        prosecutor: optionalTextOf(query.prosecutor, 'prosecutor'),
        defendant: optionalTextOf(query.defendant, 'defendant'),
      }
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params, responseType: 'arraybuffer' }))
    },
    prepareCreate (input: LegalDisputeForm): LegalDisputePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: LegalDisputeForm }): Promise<LegalDisputeId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建法律纠纷响应')
    },
    prepareUpdate (input: { current: LegalDisputeRow; changes?: Partial<LegalDisputeForm> | null }): LegalDisputePreparation {
      const current = formFromRow(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: LegalDisputeForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新法律纠纷')
    },
    async remove (input: { id: LegalDisputeId }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '法律纠纷ID') } }), '删除法律纠纷')
    },
    async getShare (input: { resourceId: LegalDisputeId }): Promise<LegalDisputeShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: LEGAL_DISPUTE_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: LegalDisputeShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存法律纠纷共享')
    },
  }
}

export type LegalDisputeCapability = ReturnType<typeof createLegalDisputeCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const LEGAL_DISPUTE_METHODS = {
  'legal-dispute-list': 'list',
  'legal-dispute-get': 'get',
  'legal-dispute-export': 'export',
  'legal-dispute-prepare-create': 'prepareCreate',
  'legal-dispute-create': 'create',
  'legal-dispute-prepare-update': 'prepareUpdate',
  'legal-dispute-update': 'update',
  'legal-dispute-remove': 'remove',
  'legal-dispute-get-share': 'getShare',
  'legal-dispute-save-share': 'saveShare',
} as const

export const legalDisputeCapabilities: CapabilityDefinition[] = [
  { id: 'legal-dispute-list', title: '查询纠纷信息列表', write: false, params: [p('caseReason', 'text', false, '案由筛选；默认空字符串'), p('caseNumber', 'text', false, '案号筛选；默认空字符串'), p('prosecutor', 'text', false, '原告筛选；默认空字符串'), p('defendant', 'text', false, '被告筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'legal-dispute-get', title: '读取纠纷信息详情', write: false, params: [p('id', 'number', true, '法律纠纷ID')] },
  { id: 'legal-dispute-export', title: '导出纠纷信息Excel', write: false, params: [p('caseReason', 'text', false, '案由筛选'), p('caseNumber', 'text', false, '案号筛选'), p('prosecutor', 'text', false, '原告筛选'), p('defendant', 'text', false, '被告筛选')] },
  { id: 'legal-dispute-prepare-create', title: '准备新建纠纷信息', write: false, params: [p('form', 'text', true, 'Portal 法律纠纷表单')] },
  { id: 'legal-dispute-create', title: '新建纠纷信息', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'legal-dispute-prepare-update', title: '准备编辑纠纷信息', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'legal-dispute-update', title: '保存纠纷信息', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'legal-dispute-remove', title: '删除纠纷信息', write: true, params: [p('id', 'number', true, '法律纠纷ID')] },
  { id: 'legal-dispute-get-share', title: '读取纠纷信息共享设置', write: false, params: [p('resourceId', 'number', true, '法律纠纷ID')] },
  { id: 'legal-dispute-save-share', title: '保存纠纷信息共享设置', write: true, params: [p('resourceId', 'number', true, '法律纠纷ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: LEGAL_DISPUTE_PAGE_PATH, permission: LEGAL_DISPUTE_PERMISSION, moduleType: LEGAL_DISPUTE_MODULE_TYPE, httpInstance: 'platform' }))
