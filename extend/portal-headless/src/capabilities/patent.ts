import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 专利管理」列表、表单和共享入口。 */
export const PATENT_PAGE_PATH = '/dashboard/certificate/patent/list'
export const PATENT_PERMISSION = '/dashboard/certificate/patent'
export const PATENT_MODULE_TYPE = 15
export const PATENT_SHARE_TYPE = 6

const ROOT = '/admin-api/hr/patent'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 5

export type PatentId = string | number
export type PatentQuery = {
  name?: string | null
  patentNumber?: string | null
  inventor?: string | null
  pageNo?: number
  pageSize?: number
}

export type PatentRow = Record<string, unknown> & {
  id: PatentId
  certificateNumber: string | null
  name: string | null
  inventor: string | null
  patentNumber: string | null
  applyDate: string | null
  patentee: string | null
  address: string | null
  announcementDate: string | null
  announcementNumber: string | null
  organizationId: PatentId | null
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

export type PatentForm = {
  id?: PatentId
  certificateNumber: string
  name: string
  inventor: string
  patentNumber: string
  applyDate: string | null
  patentee: string | null
  address: string | null
  announcementDate: string | null
  announcementNumber: string | null
  organizationId: PatentId
  endTime: string
  remindTime: number
  remindUser: PatentId[]
  pdfUrl: string[]
  pdfName: string[]
}

export type PatentPreparation = {
  draft: PatentForm
  previous?: PatentForm
}

export type PatentShareMember = {
  id: PatentId
  name?: string
  managerType?: number
}

export type PatentShare = {
  organization: PatentShareMember[]
  post: PatentShareMember[]
  duty: PatentShareMember[]
  user: PatentShareMember[]
}

export type PatentShareInput = {
  resourceId: PatentId
  organization?: PatentShareMember[]
  post?: PatentShareMember[]
  duty?: PatentShareMember[]
  user?: PatentShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PatentId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): PatentId | null {
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
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function idListOf (value: unknown, label: string, required = false): PatentId[] {
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

function urlListOf (value: unknown, label: string, required = false): string[] {
  const list = csvListOf(value, label)
  if (list.length > MAX_PDF_COUNT) throw new Error(`${label}最多${MAX_PDF_COUNT}项`)
  if (required && list.length === 0) throw new Error(`${label}不能为空；至少上传一个PDF附件`)
  return list
}

function formOf (value: unknown, label: string, requireId = false): PatentForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const remindTime = input.remindTime
  if (!Number.isSafeInteger(remindTime) || (remindTime as number) < 1 || String(remindTime).length > 5) throw new Error(`${label}.remindTime必须是1至99999的整数`)
  const remindUser = idListOf(input.remindUser, `${label}.remindUser`, true)
  const pdfUrl = urlListOf(input.pdfUrl, `${label}.pdfUrl`, true)
  const pdfName = urlListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return {
    ...(id === undefined ? {} : { id }),
    certificateNumber: boundedTextOf(input.certificateNumber, `${label}.certificateNumber`, 20, true)!,
    name: boundedTextOf(input.name, `${label}.name`, 50, true)!,
    inventor: boundedTextOf(input.inventor, `${label}.inventor`, 50, true)!,
    patentNumber: boundedTextOf(input.patentNumber, `${label}.patentNumber`, 20, true)!,
    applyDate: dateOf(input.applyDate, `${label}.applyDate`),
    patentee: boundedTextOf(input.patentee, `${label}.patentee`, 50),
    address: boundedTextOf(input.address, `${label}.address`, 50),
    announcementDate: dateOf(input.announcementDate, `${label}.announcementDate`),
    announcementNumber: boundedTextOf(input.announcementNumber, `${label}.announcementNumber`, 20),
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    endTime: dateOf(input.endTime, `${label}.endTime`, true)!,
    remindTime: remindTime as number,
    remindUser,
    pdfUrl,
    pdfName,
  }
}

function rowOf (value: unknown, label = '专利'): PatentRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    certificateNumber: textOf(row.certificateNumber, `${label}.certificateNumber`),
    name: textOf(row.name, `${label}.name`),
    inventor: textOf(row.inventor, `${label}.inventor`),
    patentNumber: textOf(row.patentNumber, `${label}.patentNumber`),
    applyDate: textOf(row.applyDate, `${label}.applyDate`),
    patentee: textOf(row.patentee, `${label}.patentee`),
    address: textOf(row.address, `${label}.address`),
    announcementDate: textOf(row.announcementDate, `${label}.announcementDate`),
    announcementNumber: textOf(row.announcementNumber, `${label}.announcementNumber`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    remindTime: row.remindTime === undefined || row.remindTime === null ? null : (Number.isSafeInteger(row.remindTime) ? row.remindTime as number : (() => { throw new Error(`${label}.remindTime必须为整数或null`) })()),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    remindUserName: textOf(row.remindUserName, `${label}.remindUserName`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    status: row.status === undefined || row.status === null ? null : (Number.isSafeInteger(row.status) ? row.status as number : (() => { throw new Error(`${label}.status必须为整数或null`) })()),
  }
}

function pageOf (value: unknown): PageResult<PatentRow> {
  const page = objectOf(value, '专利分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('专利分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `专利分页[${index}]`)), total: page.total as number }
}

function formFromRow (row: PatentRow): PatentForm {
  return formOf({
    ...row,
    pdfUrl: csvListOf(row.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(row.pdfName, 'current.pdfName'),
    remindUser: csvListOf(row.remindUser, 'current.remindUser'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    certificateNumber: form.certificateNumber,
    name: form.name,
    inventor: form.inventor,
    patentNumber: form.patentNumber,
    applyDate: form.applyDate,
    patentee: form.patentee,
    address: form.address,
    announcementDate: form.announcementDate,
    announcementNumber: form.announcementNumber,
    organizationId: form.organizationId,
    endTime: form.endTime,
    remindTime: form.remindTime,
    remindUser: form.remindUser.join(',') || null,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): PatentShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: typeof row.managerType === 'number' && Number.isFinite(row.managerType) ? row.managerType : (() => { throw new Error(`${label}.managerType必须为数字`) })() }),
  }
}

function shareOf (value: unknown): PatentShare {
  const row = objectOf(value, '专利共享响应')
  const members = (key: string): PatentShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '专利共享参数') as PatentShareInput
  return {
    type: PATENT_SHARE_TYPE,
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

function listParamsOf (query: PatentQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name') ?? '',
    patentNumber: textOf(query.patentNumber, 'patentNumber') ?? '',
    inventor: textOf(query.inventor, 'inventor') ?? '',
    status: '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

export function createPatentCapability (request: PortalRequest) {
  return {
    async list (query: PatentQuery = {}): Promise<PageResult<PatentRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: PatentId }): Promise<PatentRow> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '专利ID') } }), '专利详情')
    },
    prepareCreate (input: PatentForm): PatentPreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: PatentForm }): Promise<PatentId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建专利响应')
    },
    prepareUpdate (input: { current: PatentRow; changes?: Partial<PatentForm> | null }): PatentPreparation {
      const current = formFromRow(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: PatentForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新专利')
    },
    async remove (input: { id: PatentId }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '专利ID') } }), '删除专利')
    },
    async getShare (input: { resourceId: PatentId }): Promise<PatentShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: PATENT_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: PatentShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存专利共享')
    },
  }
}

export type PatentCapability = ReturnType<typeof createPatentCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PATENT_METHODS = {
  'patent-list': 'list',
  'patent-get': 'get',
  'patent-prepare-create': 'prepareCreate',
  'patent-create': 'create',
  'patent-prepare-update': 'prepareUpdate',
  'patent-update': 'update',
  'patent-remove': 'remove',
  'patent-get-share': 'getShare',
  'patent-save-share': 'saveShare',
} as const

export const patentCapabilities: CapabilityDefinition[] = [
  { id: 'patent-list', title: '查询专利列表', write: false, params: [p('name', 'text', false, '发明名称筛选；默认空字符串'), p('patentNumber', 'text', false, '专利号筛选；默认空字符串'), p('inventor', 'text', false, '发明人筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'patent-get', title: '读取专利详情', write: false, params: [p('id', 'number', true, '专利ID')] },
  { id: 'patent-prepare-create', title: '准备新建专利', write: false, params: [p('form', 'text', true, 'Portal 专利表单')] },
  { id: 'patent-create', title: '新建专利', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'patent-prepare-update', title: '准备编辑专利', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'patent-update', title: '保存专利', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'patent-remove', title: '删除专利', write: true, params: [p('id', 'number', true, '专利ID')] },
  { id: 'patent-get-share', title: '读取专利共享设置', write: false, params: [p('resourceId', 'number', true, '专利ID')] },
  { id: 'patent-save-share', title: '保存专利共享设置', write: true, params: [p('resourceId', 'number', true, '专利ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: PATENT_PAGE_PATH, permission: PATENT_PERMISSION, moduleType: PATENT_MODULE_TYPE, httpInstance: 'platform' }))
