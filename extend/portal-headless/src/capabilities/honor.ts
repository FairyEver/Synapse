import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「风险防控 → 荣誉管理」列表、表单和共享入口。 */
export const HONOR_PAGE_PATH = '/dashboard/certificate/honors/list'
export const HONOR_PERMISSION = '/dashboard/certificate/honors'
export const HONOR_MODULE_TYPE = 15
export const HONOR_SHARE_TYPE = 10

const ROOT = '/admin-api/hr/honor'
const SHARE_ROOT = '/admin-api/system/share-user'
const DEFAULT_PAGE_SIZE = 20
const MAX_PDF_COUNT = 5

export type HonorId = string | number
export type HonorFlag = 0 | 1

export type HonorQuery = {
  name?: string | null
  organizationId?: HonorId | null
  issuingAuthority?: string | null
  manageOrganizationId?: HonorId | null
  pageNo?: number
  pageSize?: number
}

export type HonorRow = Record<string, unknown> & {
  id: HonorId
  name: string | null
  awardedDate: string | null
  issuingAuthority: string | null
  reportOrganizationId: HonorId | null
  reportOrganizationName: string | null
  manageOrganizationId: HonorId | null
  manageOrganizationName: string | null
  depositAddress: string | null
  pdfUrl: string | null
  pdfName: string | null
  isForever: HonorFlag | null
  remindUser: string | null
  organizationId: HonorId | null
  endTime: string | null
  remindTime: number | null
  status: number | null
  organizationName: string | null
  remindUserName: string | null
}

export type HonorForm = {
  id?: HonorId
  organizationId: HonorId
  isForever: HonorFlag
  endTime?: string | null
  remindTime?: number | null
  remindUser: HonorId[]
  name: string
  awardedDate: string
  issuingAuthority: string
  reportOrganizationId: HonorId
  manageOrganizationId: HonorId
  depositAddress: string
  pdfUrl: string[]
  pdfName: string[]
}

export type HonorPreparation = {
  draft: HonorForm
  previous?: HonorForm
}

export type HonorShareMember = {
  id: HonorId
  name?: string
  managerType?: number
}

export type HonorShare = {
  organization: HonorShareMember[]
  post: HonorShareMember[]
  duty: HonorShareMember[]
  user: HonorShareMember[]
}

export type HonorShareInput = {
  resourceId: HonorId
  organization?: HonorShareMember[]
  post?: HonorShareMember[]
  duty?: HonorShareMember[]
  user?: HonorShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function has (value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function idOf (value: unknown, label: string): HonorId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): HonorId | null {
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

function flagOf (value: unknown, label: string): HonorFlag {
  if (value === true || value === 1 || value === '1') return 1
  if (value === false || value === 0 || value === '0') return 0
  throw new Error(`${label}只能是0、1、true或false`)
}

function finiteNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为有限数字或null`)
  return value
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

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function idListOf (value: unknown, label: string): HonorId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function csvListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') throw new Error(`${label}[${index}]必须为非空字符串`)
      return item
    })
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是逗号字符串或字符串数组`)
  return value.split(',').filter(Boolean)
}

function urlListOf (value: unknown, label: string): string[] {
  const list = csvListOf(value, label)
  if (list.length > MAX_PDF_COUNT) throw new Error(`${label}最多${MAX_PDF_COUNT}项`)
  return list
}

function formOf (value: unknown, label: string, requireId = false): HonorForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const organizationId = idOf(input.organizationId, `${label}.organizationId`)
  const isForever = flagOf(input.isForever, `${label}.isForever`)
  const endTime = dateOf(input.endTime, `${label}.endTime`)
  const remindTime = finiteNumberOf(input.remindTime, `${label}.remindTime`)
  if (remindTime !== null && (!Number.isSafeInteger(remindTime) || remindTime < 1 || String(remindTime).length > 5)) throw new Error(`${label}.remindTime必须是1至99999的整数`)
  const remindUser = idListOf(input.remindUser, `${label}.remindUser`)
  if (isForever === 0) {
    if (!endTime) throw new Error(`${label}.endTime不能为空；非长期荣誉必须填写到期日期`)
    if (remindTime === null) throw new Error(`${label}.remindTime不能为空；非长期荣誉必须填写到期提醒时间`)
    if (remindUser.length === 0) throw new Error(`${label}.remindUser不能为空；非长期荣誉必须选择到期提醒人`)
  }
  const name = boundedTextOf(input.name, `${label}.name`, 50, true)!
  const awardedDate = dateOf(input.awardedDate, `${label}.awardedDate`, true)!
  const issuingAuthority = boundedTextOf(input.issuingAuthority, `${label}.issuingAuthority`, 1000, true)!
  const reportOrganizationId = idOf(input.reportOrganizationId, `${label}.reportOrganizationId`)
  const manageOrganizationId = idOf(input.manageOrganizationId, `${label}.manageOrganizationId`)
  const depositAddress = boundedTextOf(input.depositAddress, `${label}.depositAddress`, 1000, true)!
  const pdfUrl = urlListOf(input.pdfUrl, `${label}.pdfUrl`)
  const pdfName = urlListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length === 0) throw new Error(`${label}.pdfUrl不能为空；至少上传一个PDF附件`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  return {
    ...(id === undefined ? {} : { id }),
    organizationId,
    isForever,
    endTime,
    remindTime,
    remindUser,
    name,
    awardedDate,
    issuingAuthority,
    reportOrganizationId,
    manageOrganizationId,
    depositAddress,
    pdfUrl,
    pdfName,
  }
}

function rowOf (value: unknown, label: string): HonorRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    awardedDate: textOf(row.awardedDate, `${label}.awardedDate`),
    issuingAuthority: textOf(row.issuingAuthority, `${label}.issuingAuthority`),
    reportOrganizationId: nullableIdOf(row.reportOrganizationId, `${label}.reportOrganizationId`),
    reportOrganizationName: textOf(row.reportOrganizationName, `${label}.reportOrganizationName`),
    manageOrganizationId: nullableIdOf(row.manageOrganizationId, `${label}.manageOrganizationId`),
    manageOrganizationName: textOf(row.manageOrganizationName, `${label}.manageOrganizationName`),
    depositAddress: textOf(row.depositAddress, `${label}.depositAddress`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    isForever: row.isForever === undefined || row.isForever === null ? null : flagOf(row.isForever, `${label}.isForever`),
    remindUser: textOf(row.remindUser, `${label}.remindUser`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    endTime: textOf(row.endTime, `${label}.endTime`),
    remindTime: finiteNumberOf(row.remindTime, `${label}.remindTime`),
    status: finiteNumberOf(row.status, `${label}.status`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    remindUserName: textOf(row.remindUserName, `${label}.remindUserName`),
  }
}

function pageOf (value: unknown): PageResult<HonorRow> {
  const page = objectOf(value, '荣誉分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('荣誉分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `荣誉分页[${index}]`)), total: page.total as number }
}

function detailOf (value: unknown): HonorRow {
  return rowOf(value, '荣誉详情')
}

function formFromDetail (detail: HonorRow): HonorForm {
  return formOf({
    ...detail,
    endTime: dateOf(detail.endTime, 'current.endTime'),
    awardedDate: dateOf(detail.awardedDate, 'current.awardedDate'),
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
    endTime: form.endTime ? form.endTime : null,
    remindTime: form.remindTime,
    remindUser: form.remindUser ? form.remindUser.join(',') : null,
    name: form.name,
    awardedDate: form.awardedDate,
    issuingAuthority: form.issuingAuthority,
    reportOrganizationId: form.reportOrganizationId,
    manageOrganizationId: form.manageOrganizationId,
    depositAddress: form.depositAddress,
    pdfUrl: form.pdfUrl.join(',') || null,
    pdfName: form.pdfName.join(',') || null,
  }
}

function shareMemberOf (value: unknown, label: string): HonorShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: finiteNumberOf(row.managerType, `${label}.managerType`) ?? 1 }),
  }
}

function shareOf (value: unknown): HonorShare {
  const row = objectOf(value, '荣誉共享响应')
  const list = (key: string): HonorShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: list('organization'), post: list('post'), duty: list('duty'), user: list('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '荣誉共享参数') as HonorShareInput
  return {
    type: HONOR_SHARE_TYPE,
    resourceId: idOf(input.resourceId, 'resourceId'),
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

function textParamOf (value: unknown, label: string): string | null {
  return textOf(value, label)
}

function listParamsOf (query: HonorQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textParamOf(query.name, 'name'),
    organizationId: nullableIdOf(query.organizationId, 'organizationId'),
    issuingAuthority: textParamOf(query.issuingAuthority, 'issuingAuthority'),
    manageOrganizationId: nullableIdOf(query.manageOrganizationId, 'manageOrganizationId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createHonorCapability (request: PortalRequest) {
  return {
    async list (query: HonorQuery = {}): Promise<PageResult<HonorRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: HonorId }): Promise<HonorRow> {
      const id = idOf(input?.id, '荣誉ID')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },
    prepareCreate (input: HonorForm): HonorPreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: HonorForm }): Promise<HonorId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '新建荣誉响应')
    },
    prepareUpdate (input: { current: HonorRow; changes?: Partial<HonorForm> | null }): HonorPreparation {
      const current = formFromDetail(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: HonorForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新荣誉')
    },
    async remove (input: { id: HonorId }): Promise<true> {
      const id = idOf(input?.id, '荣誉ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除荣誉')
    },
    async getShare (input: { resourceId: HonorId }): Promise<HonorShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: HONOR_SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: HonorShareInput): Promise<true> {
      return trueOf(await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) }), '保存荣誉共享')
    },
  }
}

export type HonorCapability = ReturnType<typeof createHonorCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const HONOR_METHODS = {
  'honor-list': 'list',
  'honor-get': 'get',
  'honor-prepare-create': 'prepareCreate',
  'honor-create': 'create',
  'honor-prepare-update': 'prepareUpdate',
  'honor-update': 'update',
  'honor-remove': 'remove',
  'honor-get-share': 'getShare',
  'honor-save-share': 'saveShare',
} as const

export const honorCapabilities: CapabilityDefinition[] = [
  { id: 'honor-list', title: '查询荣誉管理列表', write: false, params: [p('name', 'text', false, '荣誉名称模糊筛选'), p('organizationId', 'tree', false, '所属组织ID'), p('issuingAuthority', 'text', false, '颁发机构模糊筛选'), p('manageOrganizationId', 'tree', false, '管理部门ID'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'honor-get', title: '读取荣誉详情', write: false, params: [p('id', 'number', true, '荣誉ID')] },
  { id: 'honor-prepare-create', title: '准备新建荣誉', write: false, params: [p('form', 'text', true, 'Portal 荣誉表单')] },
  { id: 'honor-create', title: '新建荣誉', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'honor-prepare-update', title: '准备编辑荣誉', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'honor-update', title: '保存荣誉', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'honor-remove', title: '删除荣誉', write: true, params: [p('id', 'number', true, '荣誉ID')] },
  { id: 'honor-get-share', title: '读取荣誉共享设置', write: false, params: [p('resourceId', 'number', true, '荣誉ID')] },
  { id: 'honor-save-share', title: '保存荣誉共享设置', write: true, params: [p('resourceId', 'number', true, '荣誉ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
].map(definition => ({ ...definition, pagePath: HONOR_PAGE_PATH, permission: HONOR_PERMISSION, moduleType: HONOR_MODULE_TYPE, httpInstance: 'platform' }))
