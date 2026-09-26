import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 用户查询」及其当前列表可达的编辑表单。 */
export const SETTING_USER_PAGE_PATH = '/dashboard/setting/user/list'
export const SETTING_USER_PERMISSION = '/dashboard/setting/user'
export const SETTING_USER_MODULE_TYPE = null

const ROOT = '/sys/user'
const USE_SYSTEM_LIST_QUERY = '1,2,3,4,5,6'
const USE_SYSTEM_LIST_PAYLOAD = [1, 2, 3, 4, 5, 6]

export type SettingUserId = string | number
export type SettingUserRole = Record<string, unknown>
export type SettingUserTimeRange = readonly [string, string]

export type SettingUserQuery = {
  staffCode?: string | null
  name?: string | null
  mobile?: string | null
  role?: string | number | null
  status?: string | number | null
  time?: readonly string[] | null
  pageNo?: number
  pageSize?: number
}

export type SettingUserRecord = Record<string, unknown> & {
  id: SettingUserId
  username: string | null
  realName: string | null
  headUrl: string | null
  gender: number | null
  email: string | null
  mobile: string | null
  gradeId: SettingUserId | null
  deptId: SettingUserId | null
  status: number | null
  createDate: string | number | null
  creator: SettingUserId | null
  superAdmin: number | null
  roleIdList: SettingUserId[] | null
  gradeName: string | null
  roleList: SettingUserRole[] | null
  organizationCode: SettingUserId | null
  organizationName: string | null
  organizationFullPathName: string | null
  organizationId: SettingUserId | null
  updaterName: string | null
  updateDate: string | number | null
  creatorName: string | null
  type: number | null
  project: number | null
  postId: SettingUserId | null
  tenantId: SettingUserId | null
  tenantAdmin: number | null
  postName: string | null
  staffId: SettingUserId | null
  setPwd: boolean | null
}

export type SettingUserUpdateChanges = {
  username?: string
  realName?: string
  mobile?: string | null
  roleIdList?: SettingUserId[] | null
}

export type SettingUserUpdateDraft = Record<string, unknown> & {
  id: SettingUserId
  username: string
  realName: string
  mobile: string
  roleIdList?: SettingUserId[] | null
}

export type SettingUserPreparedUpdate = {
  draft: SettingUserUpdateDraft
  previous: SettingUserUpdateDraft
}

export type SettingUserSynchronousDraft = {
  action: 'setting-user-synchronous'
}

export type SettingUserSynchronousPreparation = {
  draft: SettingUserSynchronousDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingUserId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SettingUserId | null {
  if (value === undefined || value === null) return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function textOrEmptyOf (value: unknown, label: string): string {
  return textOf(value, label) ?? ''
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空或全为空格`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function booleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function idListOf (value: unknown, label: string): SettingUserId[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组或null`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function roleListOf (value: unknown, label: string): SettingUserRole[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new Error(`${label}必须为对象数组或null`)
  return value.map((item, index) => objectOf(item, `${label}[${index}]`))
}

function scalarOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function dateOnlyOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为YYYY-MM-DD日期字符串`)
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) throw new Error(`${label}必须为YYYY-MM-DD日期字符串`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error(`${label}不是有效日期`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

function plusOneDay (dateText: string): string {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function timeParamsOf (value: unknown): { startTime: string; endTime: string } {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return { startTime: '', endTime: '' }
  if (!Array.isArray(value) || value.length !== 2) throw new Error('time必须为空数组或包含起止日期的两项数组')
  const start = dateOnlyOf(value[0], 'time[0]')
  const end = dateOnlyOf(value[1], 'time[1]')
  if (end < start) throw new Error('time结束日期不能早于开始日期')
  return { startTime: `${start} 00:00:00`, endTime: `${plusOneDay(end)} 00:00:00` }
}

function queryOf (query: SettingUserQuery = {}): JsonObject {
  const time = timeParamsOf(query.time)
  return {
    order: '',
    orderField: '',
    staffCode: textOrEmptyOf(query.staffCode, 'staffCode'),
    name: textOrEmptyOf(query.name, 'name'),
    mobile: textOrEmptyOf(query.mobile, 'mobile'),
    role: scalarOf(query.role, 'role'),
    status: scalarOf(query.status, 'status'),
    useSystemList: USE_SYSTEM_LIST_QUERY,
    startTime: time.startTime,
    endTime: time.endTime,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function safeObjectOf (value: unknown, label: string): JsonObject {
  const result = { ...objectOf(value, label) }
  delete result.password
  delete result.password2
  delete result.salt
  return result
}

function userOf (value: unknown, label: string): SettingUserRecord {
  const row = safeObjectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    username: textOf(row.username, `${label}.username`),
    realName: textOf(row.realName, `${label}.realName`),
    headUrl: textOf(row.headUrl, `${label}.headUrl`),
    gender: integerOf(row.gender, `${label}.gender`),
    email: textOf(row.email, `${label}.email`),
    mobile: textOf(row.mobile, `${label}.mobile`),
    gradeId: nullableIdOf(row.gradeId, `${label}.gradeId`),
    deptId: nullableIdOf(row.deptId, `${label}.deptId`),
    status: integerOf(row.status, `${label}.status`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    superAdmin: integerOf(row.superAdmin, `${label}.superAdmin`),
    roleIdList: idListOf(row.roleIdList, `${label}.roleIdList`),
    gradeName: textOf(row.gradeName, `${label}.gradeName`),
    roleList: roleListOf(row.roleList, `${label}.roleList`),
    organizationCode: nullableIdOf(row.organizationCode, `${label}.organizationCode`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    organizationFullPathName: textOf(row.organizationFullPathName, `${label}.organizationFullPathName`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    updaterName: textOf(row.updaterName, `${label}.updaterName`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
    creatorName: textOf(row.creatorName, `${label}.creatorName`),
    type: integerOf(row.type, `${label}.type`),
    project: integerOf(row.project, `${label}.project`),
    postId: nullableIdOf(row.postId, `${label}.postId`),
    tenantId: nullableIdOf(row.tenantId, `${label}.tenantId`),
    tenantAdmin: integerOf(row.tenantAdmin, `${label}.tenantAdmin`),
    postName: textOf(row.postName, `${label}.postName`),
    staffId: nullableIdOf(row.staffId, `${label}.staffId`),
    setPwd: booleanOf(row.setPwd, `${label}.setPwd`),
  }
}

function pageOf (value: unknown): PageResult<SettingUserRecord> {
  const page = objectOf(value, '用户分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('用户分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => userOf(item, `用户列表行[${index}]`)), total: page.total as number }
}

function phoneOf (value: unknown): string {
  const phone = textOrEmptyOf(value, 'phone')
  if (phone !== '' && !/^1[3456789]\d{9}$/.test(phone)) throw new Error('请输入正确的手机号码')
  return phone
}

function updatePayloadOf (value: unknown, label: string): SettingUserUpdateDraft {
  const payload = safeObjectOf(value, label)
  const id = idOf(payload.id, `${label}.id`)
  const username = requiredTextOf(payload.username, `${label}.username`)
  const realName = requiredTextOf(payload.realName, `${label}.realName`)
  const mobile = phoneOf(payload.mobile)
  const roleIdList = idListOf(payload.roleIdList, `${label}.roleIdList`)
  return {
    ...payload,
    id,
    username,
    realName,
    mobile,
    ...(roleIdList === null ? {} : { roleIdList }),
    useSystemList: [...USE_SYSTEM_LIST_PAYLOAD],
  }
}

function preparedUpdateOf (input: { current: unknown; changes?: SettingUserUpdateChanges | null }): SettingUserPreparedUpdate {
  const current = safeObjectOf(input?.current, '用户编辑当前值')
  const changes = input?.changes === undefined || input.changes === null ? {} : objectOf(input.changes, '用户编辑变更')
  const allowed = new Set(['username', 'realName', 'mobile', 'roleIdList'])
  for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`用户编辑变更不支持字段${key}`)
  const previous = updatePayloadOf(current, '用户编辑当前值')
  const draft = updatePayloadOf({ ...current, ...changes }, '用户编辑草稿')
  return { draft, previous }
}

function synchronousDraftOf (value: unknown, label: string): SettingUserSynchronousDraft {
  const draft = objectOf(value, label)
  if (draft.action !== 'setting-user-synchronous') throw new Error(`${label}不是用户同步准备草稿`)
  return { action: 'setting-user-synchronous' }
}

function synchronousPreparationOf (input: { draft: unknown }): SettingUserSynchronousPreparation {
  return { draft: synchronousDraftOf(input?.draft, '用户同步准备草稿') }
}

/** The injected request must be bound to SETTING_USER_PAGE_PATH. */
export function createSettingUserCapability (request: PortalRequest) {
  return {
    async list (query: SettingUserQuery = {}): Promise<PageResult<SettingUserRecord>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },
    async getInfo (input: { id: SettingUserId }): Promise<SettingUserRecord> {
      const id = idOf(input?.id, '用户ID')
      return userOf(await request({ url: `${ROOT}/getInfo`, method: 'get', params: { id, useSystemList: USE_SYSTEM_LIST_QUERY } }), '用户详情')
    },
    async phoneIsExist (input: { phone: string }): Promise<number> {
      const phone = phoneOf(input?.phone)
      if (phone === '') return 0
      const result = await request<unknown>({ url: `${ROOT}/phoneIsExist`, method: 'get', params: { phone } })
      if (!Number.isSafeInteger(result) || (result as number) < 0) throw new Error('手机号占用检查响应必须为非负整数')
      return result as number
    },
    prepareUpdate (input: { current: SettingUserRecord | Record<string, unknown>; changes?: SettingUserUpdateChanges | null }): SettingUserPreparedUpdate {
      return preparedUpdateOf(input)
    },
    async update (input: { draft: SettingUserUpdateDraft }): Promise<void> {
      await request({ url: ROOT, method: 'put', data: updatePayloadOf(input?.draft, '用户编辑草稿') })
    },
    prepareSynchronous (): SettingUserSynchronousPreparation {
      return { draft: { action: 'setting-user-synchronous' } }
    },
    async submitSynchronous (input: { draft: SettingUserSynchronousDraft }): Promise<void> {
      synchronousPreparationOf(input)
      await request({ url: `${ROOT}/synchronous`, method: 'post' })
    },
    cancelSynchronous (input: { draft: SettingUserSynchronousDraft }): { cancelled: true } {
      synchronousPreparationOf(input)
      return { cancelled: true }
    },
  }
}

export type SettingUserCapability = ReturnType<typeof createSettingUserCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [
  p('staffCode', 'text', false, '用户名/工号筛选；默认空字符串'),
  p('name', 'text', false, '姓名筛选；默认空字符串'),
  p('mobile', 'text', false, '手机号筛选；默认空字符串'),
  p('role', 'text', false, '角色 ID；默认空字符串'),
  p('status', 'text', false, '状态字典值；默认空字符串'),
  p('time', 'date', false, '创建日期区间两项；SDK按Portal规则生成startTime/endTime，省略表示不筛选'),
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'),
]

export const SETTING_USER_METHODS = {
  'setting-user-list': 'list',
  'setting-user-get-info': 'getInfo',
  'setting-user-phone-is-exist': 'phoneIsExist',
  'setting-user-prepare-update': 'prepareUpdate',
  'setting-user-update': 'update',
  'setting-user-prepare-synchronous': 'prepareSynchronous',
  'setting-user-synchronous': 'submitSynchronous',
  'setting-user-cancel-synchronous': 'cancelSynchronous',
} as const

export const settingUserCapabilities: CapabilityDefinition[] = [
  { id: 'setting-user-list', title: '查询用户分页', write: false, params: queryParams },
  { id: 'setting-user-get-info', title: '读取用户编辑表单', write: false, params: [p('id', 'text', true, '用户ID')] },
  { id: 'setting-user-phone-is-exist', title: '检查手机号是否已占用', write: false, params: [p('phone', 'text', true, '手机号；空字符串按Portal规则本地返回0')] },
  { id: 'setting-user-prepare-update', title: '准备编辑用户', write: false, params: [p('current', 'text', true, '来自最新getInfo的完整用户对象'), p('changes', 'text', false, '仅允许username、realName、mobile、roleIdList')] },
  { id: 'setting-user-update', title: '保存用户编辑', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整用户表单草稿')] },
  { id: 'setting-user-prepare-synchronous', title: '准备同步用户', write: false, params: [] },
  { id: 'setting-user-synchronous', title: '同步用户', write: true, params: [p('draft', 'text', true, 'prepareSynchronous返回的用户同步草稿；提交不带请求体')] },
  { id: 'setting-user-cancel-synchronous', title: '取消同步用户', write: false, params: [p('draft', 'text', true, 'prepareSynchronous返回的用户同步草稿')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_USER_PAGE_PATH,
  permission: SETTING_USER_PERMISSION,
  moduleType: SETTING_USER_MODULE_TYPE,
  httpInstance: 'platform',
}))
