import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 作品管理」列表、表单和共享入口。 */
export const PIECE_PAGE_PATH = '/dashboard/certificate/works/list'
export const PIECE_PERMISSION = '/dashboard/certificate/works'
export const PIECE_MODULE_TYPE = 15
export const PIECE_SHARE_TYPE = 7

const ROOT = '/admin-api/hr/piece'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 5

export type PieceId = string | number
export type PiecePublishStatus = 1 | 2

export type PieceQuery = {
  name?: string | null
  softwareNumber?: string | null
  author?: string | null
  pageNo?: number
  pageSize?: number
}

export type PieceRow = Record<string, unknown> & {
  id: PieceId
  softwareNumber: string | null
  name: string | null
  author: string | null
  type: number | null
  typeStr: string | null
  copyrightOwner: string | null
  completeDate: string | null
  isPublish: number | null
  publishDate: string | null
  signDate: string | null
  organizationId: PieceId | null
  organizationName: string | null
  endTime: string | null
  remindTime: number | null
  remindUser: string | null
  remindUserName: string | null
  pdfUrl: string | null
  pdfName: string | null
  createTime: string | null
  status: number | null
}

export type PieceForm = {
  id?: PieceId
  softwareNumber: string
  name: string
  type: number
  author: string
  copyrightOwner: string
  completeDate: string
  isPublish: PiecePublishStatus
  publishDate: string
  signDate: string
  organizationId: PieceId
  endTime: string
  remindTime: number
  remindUser: PieceId[]
  pdfUrl: string[]
  pdfName: string[]
}

export type PiecePreparation = {
  draft: PieceForm
  previous?: PieceForm
}

export type PieceShareMember = {
  id: PieceId
  name?: string
  managerType?: number
}

export type PieceShare = {
  organization: PieceShareMember[]
  post: PieceShareMember[]
  duty: PieceShareMember[]
  user: PieceShareMember[]
}

export type PieceShareInput = {
  resourceId: PieceId
  organization?: PieceShareMember[]
  post?: PieceShareMember[]
  duty?: PieceShareMember[]
  user?: PieceShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PieceId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): PieceId | null {
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

function integerOf (value: unknown, label: string, required = false): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function publishStatusOf (value: unknown, label: string): PiecePublishStatus {
  if (value === 1 || value === 2) return value
  throw new Error(`${label}只能是1（发表）或2（未发表）`)
}

function idListOf (value: unknown, label: string, required = false): PieceId[] {
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
  if (Array.isArray(value)) return value.map((item, index) => {
    const text = textOf(item, `${label}[${index}]`)
    if (text === null || text.trim() === '') throw new Error(`${label}[${index}]不能为空`)
    return text
  })
  if (typeof value !== 'string') throw new Error(`${label}必须是逗号字符串或字符串数组`)
  return value.split(',').filter(Boolean)
}

function formOf (value: unknown, label: string, requireId = false): PieceForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const remindTime = integerOf(input.remindTime, `${label}.remindTime`, true)!
  if (remindTime < 1 || remindTime > 99999) throw new Error(`${label}.remindTime必须是1至99999的整数`)
  const remindUser = idListOf(input.remindUser, `${label}.remindUser`, true)
  const pdfUrl = csvListOf(input.pdfUrl, `${label}.pdfUrl`)
  const pdfName = csvListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length === 0) throw new Error(`${label}.pdfUrl不能为空；至少上传一个PDF附件`)
  if (pdfUrl.length > MAX_PDF_COUNT || pdfName.length > MAX_PDF_COUNT) throw new Error(`${label}.pdfUrl最多${MAX_PDF_COUNT}项`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return {
    ...(id === undefined ? {} : { id }),
    softwareNumber: boundedTextOf(input.softwareNumber, `${label}.softwareNumber`, 20, true)!,
    name: boundedTextOf(input.name, `${label}.name`, 50, true)!,
    type: integerOf(input.type, `${label}.type`, true)!,
    author: boundedTextOf(input.author, `${label}.author`, 50, true)!,
    copyrightOwner: boundedTextOf(input.copyrightOwner, `${label}.copyrightOwner`, 50, true)!,
    completeDate: dateOf(input.completeDate, `${label}.completeDate`, true)!,
    isPublish: publishStatusOf(input.isPublish, `${label}.isPublish`),
    publishDate: dateOf(input.publishDate, `${label}.publishDate`, true)!,
    signDate: dateOf(input.signDate, `${label}.signDate`, true)!,
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    endTime: dateOf(input.endTime, `${label}.endTime`, true)!,
    remindTime,
    remindUser,
    pdfUrl,
    pdfName,
  }
}

function rowOf (value: unknown, label = '作品'): PieceRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    softwareNumber: textOf(row.softwareNumber, `${label}.softwareNumber`),
    name: textOf(row.name, `${label}.name`),
    author: textOf(row.author, `${label}.author`),
    type: integerOf(row.type, `${label}.type`),
    typeStr: textOf(row.typeStr, `${label}.typeStr`),
    copyrightOwner: textOf(row.copyrightOwner, `${label}.copyrightOwner`),
    completeDate: textOf(row.completeDate, `${label}.completeDate`),
    isPublish: integerOf(row.isPublish, `${label}.isPublish`),
    publishDate: textOf(row.publishDate, `${label}.publishDate`),
    signDate: textOf(row.signDate, `${label}.signDate`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    remindTime: integerOf(row.remindTime, `${label}.remindTime`),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    remindUserName: textOf(row.remindUserName, `${label}.remindUserName`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    status: integerOf(row.status, `${label}.status`),
  }
}

function pageOf (value: unknown): PageResult<PieceRow> {
  const page = objectOf(value, '作品分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('作品分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `作品分页[${index}]`)), total: page.total as number }
}

function formFromRow (row: PieceRow): PieceForm {
  return formOf({
    ...row,
    completeDate: dateOf(row.completeDate, 'current.completeDate'),
    publishDate: dateOf(row.publishDate, 'current.publishDate'),
    signDate: dateOf(row.signDate, 'current.signDate'),
    endTime: dateOf(row.endTime, 'current.endTime'),
    remindUser: csvListOf(row.remindUser, 'current.remindUser'),
    pdfUrl: csvListOf(row.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(row.pdfName, 'current.pdfName'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    softwareNumber: form.softwareNumber,
    name: form.name,
    type: form.type,
    author: form.author,
    copyrightOwner: form.copyrightOwner,
    completeDate: form.completeDate,
    isPublish: form.isPublish,
    publishDate: form.publishDate,
    signDate: form.signDate,
    organizationId: form.organizationId,
    endTime: form.endTime,
    remindTime: form.remindTime,
    remindUser: form.remindUser.join(',') || null,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): PieceShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: integerOf(row.managerType, `${label}.managerType`) ?? 1 }),
  }
}

function shareOf (value: unknown): PieceShare {
  const row = objectOf(value, '作品共享响应')
  const members = (key: string): PieceShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '作品共享参数') as PieceShareInput
  return {
    type: PIECE_SHARE_TYPE,
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

function listParamsOf (query: PieceQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name') ?? '',
    softwareNumber: textOf(query.softwareNumber, 'softwareNumber') ?? '',
    author: textOf(query.author, 'author') ?? '',
    status: '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

export function createPieceCapability (request: PortalRequest) {
  return {
    async list (query: PieceQuery = {}): Promise<PageResult<PieceRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: PieceId }): Promise<PieceRow> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '作品ID') } }), '作品详情')
    },
    prepareCreate (input: PieceForm): PiecePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: PieceForm }): Promise<PieceId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建作品响应')
    },
    prepareUpdate (input: { current: PieceRow; changes?: Partial<PieceForm> | null }): PiecePreparation {
      const current = formFromRow(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: PieceForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新作品')
    },
    async remove (input: { id: PieceId }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '作品ID') } }), '删除作品')
    },
    async getShare (input: { resourceId: PieceId }): Promise<PieceShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: PIECE_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: PieceShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存作品共享')
    },
  }
}

export type PieceCapability = ReturnType<typeof createPieceCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PIECE_METHODS = {
  'piece-list': 'list',
  'piece-get': 'get',
  'piece-prepare-create': 'prepareCreate',
  'piece-create': 'create',
  'piece-prepare-update': 'prepareUpdate',
  'piece-update': 'update',
  'piece-remove': 'remove',
  'piece-get-share': 'getShare',
  'piece-save-share': 'saveShare',
} as const

export const pieceCapabilities: CapabilityDefinition[] = [
  { id: 'piece-list', title: '查询作品管理列表', write: false, params: [p('name', 'text', false, '作品名称筛选；默认空字符串'), p('softwareNumber', 'text', false, '证书号筛选；默认空字符串'), p('author', 'text', false, '作者筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'piece-get', title: '读取作品详情', write: false, params: [p('id', 'number', true, '作品ID')] },
  { id: 'piece-prepare-create', title: '准备新建作品', write: false, params: [p('form', 'text', true, 'Portal 作品表单')] },
  { id: 'piece-create', title: '新建作品', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'piece-prepare-update', title: '准备编辑作品', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'piece-update', title: '保存作品', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'piece-remove', title: '删除作品', write: true, params: [p('id', 'number', true, '作品ID')] },
  { id: 'piece-get-share', title: '读取作品共享设置', write: false, params: [p('resourceId', 'number', true, '作品ID')] },
  { id: 'piece-save-share', title: '保存作品共享设置', write: true, params: [p('resourceId', 'number', true, '作品ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: PIECE_PAGE_PATH, permission: PIECE_PERMISSION, moduleType: PIECE_MODULE_TYPE, httpInstance: 'platform' }))
