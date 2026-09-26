import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 软著管理」列表、表单和共享入口。 */
export const SOFTWARE_PAGE_PATH = '/dashboard/certificate/softwork/list'
export const SOFTWARE_PERMISSION = '/dashboard/certificate/softwork'
export const SOFTWARE_MODULE_TYPE = 15
export const SOFTWARE_SHARE_TYPE = 8

const ROOT = '/admin-api/hr/software'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 5

export type SoftwareId = string | number
export type SoftwareWay = 1 | 2

export type SoftwareQuery = {
  name?: string | null
  softwareNumber?: string | null
  inventor?: string | null
  pageNo?: number
  pageSize?: number
}

export type SoftwareRow = Record<string, unknown> & {
  id: SoftwareId
  softwareNumber: string | null
  name: string | null
  inventor: string | null
  developDate: string | null
  firstPublishDate: string | null
  way: number | null
  wayStr: string | null
  radius: string | null
  signNumber: string | null
  organizationId: SoftwareId | null
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

export type SoftwareForm = {
  id?: SoftwareId
  softwareNumber: string
  name: string
  inventor: string
  developDate: string | null
  firstPublishDate: string | null
  way: SoftwareWay
  radius: string
  signNumber: string
  organizationId: SoftwareId
  endTime: string
  remindTime: number
  remindUser: SoftwareId[]
  pdfUrl: string[]
  pdfName: string[]
}

export type SoftwarePreparation = {
  draft: SoftwareForm
  previous?: SoftwareForm
}

export type SoftwareShareMember = {
  id: SoftwareId
  name?: string
  managerType?: number
}

export type SoftwareShare = {
  organization: SoftwareShareMember[]
  post: SoftwareShareMember[]
  duty: SoftwareShareMember[]
  user: SoftwareShareMember[]
}

export type SoftwareShareInput = {
  resourceId: SoftwareId
  organization?: SoftwareShareMember[]
  post?: SoftwareShareMember[]
  duty?: SoftwareShareMember[]
  user?: SoftwareShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SoftwareId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SoftwareId | null {
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
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function wayOf (value: unknown, label: string): SoftwareWay {
  if (value === 1 || value === 2) return value
  throw new Error(`${label}只能是1（原始取得）或2（继受取得）`)
}

function idListOf (value: unknown, label: string, required = false): SoftwareId[] {
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

function formOf (value: unknown, label: string, requireId = false): SoftwareForm {
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
    inventor: boundedTextOf(input.inventor, `${label}.inventor`, 50, true)!,
    developDate: dateOf(input.developDate, `${label}.developDate`),
    firstPublishDate: dateOf(input.firstPublishDate, `${label}.firstPublishDate`),
    way: wayOf(input.way, `${label}.way`),
    radius: boundedTextOf(input.radius, `${label}.radius`, 100, true)!,
    signNumber: boundedTextOf(input.signNumber, `${label}.signNumber`, 20, true)!,
    organizationId: idOf(input.organizationId, `${label}.organizationId`),
    endTime: dateOf(input.endTime, `${label}.endTime`, true)!,
    remindTime,
    remindUser,
    pdfUrl,
    pdfName,
  }
}

function rowOf (value: unknown, label = '软著'): SoftwareRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    softwareNumber: textOf(row.softwareNumber, `${label}.softwareNumber`),
    name: textOf(row.name, `${label}.name`),
    inventor: textOf(row.inventor, `${label}.inventor`),
    developDate: textOf(row.developDate, `${label}.developDate`),
    firstPublishDate: textOf(row.firstPublishDate, `${label}.firstPublishDate`),
    way: integerOf(row.way, `${label}.way`),
    wayStr: textOf(row.wayStr, `${label}.wayStr`),
    radius: textOf(row.radius, `${label}.radius`),
    signNumber: textOf(row.signNumber, `${label}.signNumber`),
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

function pageOf (value: unknown): PageResult<SoftwareRow> {
  const page = objectOf(value, '软著分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('软著分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `软著分页[${index}]`)), total: page.total as number }
}

function formFromDetail (detail: SoftwareRow): SoftwareForm {
  return formOf({
    ...detail,
    developDate: dateOf(detail.developDate, 'current.developDate'),
    firstPublishDate: dateOf(detail.firstPublishDate, 'current.firstPublishDate'),
    endTime: dateOf(detail.endTime, 'current.endTime'),
    remindUser: csvListOf(detail.remindUser, 'current.remindUser'),
    pdfUrl: csvListOf(detail.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(detail.pdfName, 'current.pdfName'),
  }, 'current', true)
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(form.id === undefined ? {} : { id: form.id }),
    softwareNumber: form.softwareNumber,
    name: form.name,
    inventor: form.inventor,
    developDate: form.developDate,
    firstPublishDate: form.firstPublishDate,
    way: form.way,
    radius: form.radius,
    signNumber: form.signNumber,
    organizationId: form.organizationId,
    endTime: form.endTime,
    remindTime: form.remindTime,
    remindUser: form.remindUser.join(',') || null,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): SoftwareShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: integerOf(row.managerType, `${label}.managerType`) ?? 0 }),
  }
}

function shareOf (value: unknown): SoftwareShare {
  const row = objectOf(value, '软著共享响应')
  const members = (key: string): SoftwareShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: members('organization'), post: members('post'), duty: members('duty'), user: members('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '软著共享参数') as SoftwareShareInput
  return {
    type: SOFTWARE_SHARE_TYPE,
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

function listParamsOf (query: SoftwareQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name') ?? '',
    softwareNumber: textOf(query.softwareNumber, 'softwareNumber') ?? '',
    inventor: textOf(query.inventor, 'inventor') ?? '',
    status: '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

export function createSoftwareCapability (request: PortalRequest) {
  return {
    async list (query: SoftwareQuery = {}): Promise<PageResult<SoftwareRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: SoftwareId }): Promise<SoftwareRow> {
      const id = idOf(input?.id, '软著ID')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '软著详情')
    },
    prepareCreate (input: SoftwareForm): SoftwarePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: SoftwareForm }): Promise<SoftwareId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建软著响应')
    },
    prepareUpdate (input: { current: SoftwareRow; changes?: Partial<SoftwareForm> | null }): SoftwarePreparation {
      const current = formFromDetail(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: SoftwareForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新软著')
    },
    async remove (input: { id: SoftwareId }): Promise<true> {
      const id = idOf(input?.id, '软著ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除软著')
    },
    async getShare (input: { resourceId: SoftwareId }): Promise<SoftwareShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: SOFTWARE_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: SoftwareShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存软著共享')
    },
  }
}

export type SoftwareCapability = ReturnType<typeof createSoftwareCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SOFTWARE_METHODS = {
  'software-list': 'list',
  'software-get': 'get',
  'software-prepare-create': 'prepareCreate',
  'software-create': 'create',
  'software-prepare-update': 'prepareUpdate',
  'software-update': 'update',
  'software-remove': 'remove',
  'software-get-share': 'getShare',
  'software-save-share': 'saveShare',
} as const

export const softwareCapabilities: CapabilityDefinition[] = [
  { id: 'software-list', title: '查询软著列表', write: false, params: [p('name', 'text', false, '软件名称筛选；默认空字符串'), p('softwareNumber', 'text', false, '证书号筛选；默认空字符串'), p('inventor', 'text', false, '著作权人筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'software-get', title: '读取软著详情', write: false, params: [p('id', 'number', true, '软著ID')] },
  { id: 'software-prepare-create', title: '准备新建软著', write: false, params: [p('form', 'text', true, 'Portal 软著表单')] },
  { id: 'software-create', title: '新建软著', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'software-prepare-update', title: '准备编辑软著', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'software-update', title: '保存软著', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'software-remove', title: '删除软著', write: true, params: [p('id', 'number', true, '软著ID')] },
  { id: 'software-get-share', title: '读取软著共享设置', write: false, params: [p('resourceId', 'number', true, '软著ID')] },
  { id: 'software-save-share', title: '保存软著共享设置', write: true, params: [p('resourceId', 'number', true, '软著ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: SOFTWARE_PAGE_PATH, permission: SOFTWARE_PERMISSION, moduleType: SOFTWARE_MODULE_TYPE, httpInstance: 'platform' }))
