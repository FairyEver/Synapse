import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 标准管理」列表、表单和共享入口。 */
export const STANDARD_DOCUMENT_PAGE_PATH = '/dashboard/certificate/standard-document/list'
export const STANDARD_DOCUMENT_PERMISSION = '/dashboard/certificate/standard-document'
export const STANDARD_DOCUMENT_MODULE_TYPE = 15
export const STANDARD_DOCUMENT_SHARE_TYPE = 9

const ROOT = '/admin-api/hr/standard-document'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 5

export type StandardDocumentId = string | number
export type StandardDocumentFlag = 0 | 1

export type StandardDocumentQuery = {
  name?: string | null
  code?: string | null
  type?: number | null
  standardStatus?: number | null
  organizationId?: StandardDocumentId | null
  pageNo?: number
  pageSize?: number
}

export type StandardDocumentRow = Record<string, unknown> & {
  id: StandardDocumentId
  name: string | null
  scope: string | null
  code: string | null
  type: number | null
  initiationDate: string | null
  releaseDate: string | null
  implementationDate: string | null
  publishingUnit: string | null
  leadUnit: string | null
  participatingUnit: string | null
  drafter: string | null
  version: string | null
  pdfUrl: string | null
  pdfName: string | null
  createTime: string | null
  isForever: StandardDocumentFlag | null
  remindUser: string | null
  organizationId: StandardDocumentId | null
  organizationName: string | null
  endTime: string | null
  remindTime: number | null
  status: number | null
  remindUserName: string | null
  standardStatus: number | null
}

export type StandardDocumentForm = {
  id?: StandardDocumentId
  organizationId: StandardDocumentId
  isForever: StandardDocumentFlag
  endTime?: string | null
  remindTime?: number | null
  remindUser: StandardDocumentId[]
  name: string
  scope: string | null
  type: number
  code: string
  initiationDate: string
  releaseDate: string
  implementationDate: string
  publishingUnit: string
  leadUnit: string
  participatingUnit: string
  drafter: string
  standardStatus: number
  version: string
  pdfUrl: string[]
  pdfName: string[]
}

export type StandardDocumentPreparation = {
  draft: StandardDocumentForm
  previous?: StandardDocumentForm
}

export type StandardDocumentShareMember = {
  id: StandardDocumentId
  name?: string
  managerType?: number
}

export type StandardDocumentShare = {
  organization: StandardDocumentShareMember[]
  post: StandardDocumentShareMember[]
  duty: StandardDocumentShareMember[]
  user: StandardDocumentShareMember[]
}

export type StandardDocumentShareInput = {
  resourceId: StandardDocumentId
  organization?: StandardDocumentShareMember[]
  post?: StandardDocumentShareMember[]
  duty?: StandardDocumentShareMember[]
  user?: StandardDocumentShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): StandardDocumentId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): StandardDocumentId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function boundedTextOf (value: unknown, label: string, max: number, required = false): string | null {
  const text = textOf(value, label)
  if (required && (text === null || text.trim() === '')) throw new Error(`${label}不能为空或全为空格`)
  if (text !== null && text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
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

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function flagOf (value: unknown, label: string): StandardDocumentFlag {
  if (value === true || value === 1 || value === '1') return 1
  if (value === false || value === 0 || value === '0') return 0
  throw new Error(`${label}只能是0、1、true或false`)
}

function idListOf (value: unknown, label: string, required = false): StandardDocumentId[] {
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

function formOf (value: unknown, label: string, requireId = false): StandardDocumentForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const organizationId = idOf(input.organizationId, `${label}.organizationId`)
  const isForever = flagOf(input.isForever, `${label}.isForever`)
  const endTime = dateOf(input.endTime, `${label}.endTime`)
  const remindTime = integerOf(input.remindTime, `${label}.remindTime`)
  if (isForever === 0) {
    if (!endTime) throw new Error(`${label}.endTime不能为空；非长期标准必须填写到期时间`)
    if (remindTime === null || remindTime < 1 || remindTime > 99999) throw new Error(`${label}.remindTime必须是1至99999的整数`)
    if (idListOf(input.remindUser, `${label}.remindUser`).length === 0) throw new Error(`${label}.remindUser不能为空；非长期标准必须选择到期提醒人`)
  } else if (remindTime !== null && (remindTime < 1 || remindTime > 99999)) {
    throw new Error(`${label}.remindTime必须是1至99999的整数`)
  }
  const remindUser = idListOf(input.remindUser, `${label}.remindUser`)
  const pdfUrl = csvListOf(input.pdfUrl, `${label}.pdfUrl`)
  const pdfName = csvListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length === 0) throw new Error(`${label}.pdfUrl不能为空；至少上传一个PDF附件`)
  if (pdfUrl.length > MAX_PDF_COUNT || pdfName.length > MAX_PDF_COUNT) throw new Error(`${label}.pdfUrl最多${MAX_PDF_COUNT}项`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return {
    ...(id === undefined ? {} : { id }),
    organizationId,
    isForever,
    endTime,
    remindTime,
    remindUser,
    name: boundedTextOf(input.name, `${label}.name`, 50, true)!,
    scope: textOf(input.scope, `${label}.scope`),
    type: requiredIntegerOf(input.type, `${label}.type`),
    code: boundedTextOf(input.code, `${label}.code`, 50, true)!,
    initiationDate: dateOf(input.initiationDate, `${label}.initiationDate`, true)!,
    releaseDate: dateOf(input.releaseDate, `${label}.releaseDate`, true)!,
    implementationDate: dateOf(input.implementationDate, `${label}.implementationDate`, true)!,
    publishingUnit: boundedTextOf(input.publishingUnit, `${label}.publishingUnit`, 1000, true)!,
    leadUnit: boundedTextOf(input.leadUnit, `${label}.leadUnit`, 1000, true)!,
    participatingUnit: boundedTextOf(input.participatingUnit, `${label}.participatingUnit`, 1000, true)!,
    drafter: boundedTextOf(input.drafter, `${label}.drafter`, 500, true)!,
    standardStatus: requiredIntegerOf(input.standardStatus, `${label}.standardStatus`),
    version: boundedTextOf(input.version, `${label}.version`, 50, true)!,
    pdfUrl,
    pdfName,
  }
}

function rowOf (value: unknown, label = '标准管理'): StandardDocumentRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    scope: textOf(row.scope, `${label}.scope`),
    code: textOf(row.code, `${label}.code`),
    type: integerOf(row.type, `${label}.type`),
    initiationDate: textOf(row.initiationDate, `${label}.initiationDate`),
    releaseDate: textOf(row.releaseDate, `${label}.releaseDate`),
    implementationDate: textOf(row.implementationDate, `${label}.implementationDate`),
    publishingUnit: textOf(row.publishingUnit, `${label}.publishingUnit`),
    leadUnit: textOf(row.leadUnit, `${label}.leadUnit`),
    participatingUnit: textOf(row.participatingUnit, `${label}.participatingUnit`),
    drafter: textOf(row.drafter, `${label}.drafter`),
    version: textOf(row.version, `${label}.version`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    isForever: row.isForever === undefined || row.isForever === null ? null : flagOf(row.isForever, `${label}.isForever`),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    remindTime: integerOf(row.remindTime, `${label}.remindTime`),
    status: integerOf(row.status, `${label}.status`),
    remindUserName: textOf(row.remindUserName, `${label}.remindUserName`),
    standardStatus: integerOf(row.standardStatus, `${label}.standardStatus`),
  }
}

function pageOf (value: unknown): PageResult<StandardDocumentRow> {
  const page = objectOf(value, '标准管理分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('标准管理分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `标准管理分页[${index}]`)), total: page.total as number }
}

function formFromDetail (detail: StandardDocumentRow): StandardDocumentForm {
  return formOf({
    ...detail,
    endTime: dateOf(detail.endTime, 'current.endTime'),
    initiationDate: dateOf(detail.initiationDate, 'current.initiationDate'),
    releaseDate: dateOf(detail.releaseDate, 'current.releaseDate'),
    implementationDate: dateOf(detail.implementationDate, 'current.implementationDate'),
    remindUser: csvListOf(detail.remindUser, 'current.remindUser'),
    pdfUrl: csvListOf(detail.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(detail.pdfName, 'current.pdfName'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    organizationId: form.organizationId,
    isForever: form.isForever,
    endTime: form.endTime || null,
    remindTime: form.remindTime,
    remindUser: form.remindUser ? form.remindUser.join(',') : null,
    name: form.name,
    scope: form.scope,
    type: form.type,
    code: form.code,
    initiationDate: form.initiationDate,
    releaseDate: form.releaseDate,
    implementationDate: form.implementationDate,
    publishingUnit: form.publishingUnit,
    leadUnit: form.leadUnit,
    participatingUnit: form.participatingUnit,
    drafter: form.drafter,
    standardStatus: form.standardStatus,
    version: form.version,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): StandardDocumentShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: integerOf(row.managerType, `${label}.managerType`) ?? 0 }),
  }
}

function shareOf (value: unknown): StandardDocumentShare {
  const row = objectOf(value, '标准管理共享响应')
  const members = (key: string): StandardDocumentShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '标准管理共享参数') as StandardDocumentShareInput
  return {
    type: STANDARD_DOCUMENT_SHARE_TYPE,
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

function listParamsOf (query: StandardDocumentQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name'),
    code: textOf(query.code, 'code'),
    type: query.type === undefined ? null : integerOf(query.type, 'type'),
    standardStatus: query.standardStatus === undefined ? null : integerOf(query.standardStatus, 'standardStatus'),
    organizationId: nullableIdOf(query.organizationId, 'organizationId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

export function createStandardDocumentCapability (request: PortalRequest) {
  return {
    async list (query: StandardDocumentQuery = {}): Promise<PageResult<StandardDocumentRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: StandardDocumentId }): Promise<StandardDocumentRow> {
      const id = idOf(input?.id, '标准管理ID')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '标准管理详情')
    },
    prepareCreate (input: StandardDocumentForm): StandardDocumentPreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: StandardDocumentForm }): Promise<StandardDocumentId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建标准管理响应')
    },
    prepareUpdate (input: { current: StandardDocumentRow; changes?: Partial<StandardDocumentForm> | null }): StandardDocumentPreparation {
      const current = formFromDetail(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: StandardDocumentForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新标准管理')
    },
    async remove (input: { id: StandardDocumentId }): Promise<true> {
      const id = idOf(input?.id, '标准管理ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除标准管理')
    },
    async getShare (input: { resourceId: StandardDocumentId }): Promise<StandardDocumentShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: STANDARD_DOCUMENT_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: StandardDocumentShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存标准管理共享')
    },
  }
}

export type StandardDocumentCapability = ReturnType<typeof createStandardDocumentCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const STANDARD_DOCUMENT_METHODS = {
  'standard-document-list': 'list',
  'standard-document-get': 'get',
  'standard-document-prepare-create': 'prepareCreate',
  'standard-document-create': 'create',
  'standard-document-prepare-update': 'prepareUpdate',
  'standard-document-update': 'update',
  'standard-document-remove': 'remove',
  'standard-document-get-share': 'getShare',
  'standard-document-save-share': 'saveShare',
} as const

export const standardDocumentCapabilities: CapabilityDefinition[] = [
  { id: 'standard-document-list', title: '查询标准管理列表', write: false, params: [p('name', 'text', false, '标准名称筛选；默认null'), p('code', 'text', false, '标准编码筛选；默认null'), p('type', 'number', false, '标准类型字典值；默认null'), p('standardStatus', 'number', false, '标准状态字典值；默认null'), p('organizationId', 'tree', false, '所属组织ID；默认null'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'standard-document-get', title: '读取标准管理详情', write: false, params: [p('id', 'number', true, '标准管理ID')] },
  { id: 'standard-document-prepare-create', title: '准备新建标准管理', write: false, params: [p('form', 'text', true, 'Portal 标准类文档表单')] },
  { id: 'standard-document-create', title: '新建标准管理', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'standard-document-prepare-update', title: '准备编辑标准管理', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'standard-document-update', title: '保存标准管理', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'standard-document-remove', title: '删除标准管理', write: true, params: [p('id', 'number', true, '标准管理ID')] },
  { id: 'standard-document-get-share', title: '读取标准管理共享设置', write: false, params: [p('resourceId', 'number', true, '标准管理ID')] },
  { id: 'standard-document-save-share', title: '保存标准管理共享设置', write: true, params: [p('resourceId', 'number', true, '标准管理ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: STANDARD_DOCUMENT_PAGE_PATH, permission: STANDARD_DOCUMENT_PERMISSION, moduleType: STANDARD_DOCUMENT_MODULE_TYPE, httpInstance: 'platform' }))
