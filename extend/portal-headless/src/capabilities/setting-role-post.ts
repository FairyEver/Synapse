import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 岗位角色」及其可达的人员查看、角色分配动作。 */
export const SETTING_ROLE_POST_PAGE_PATH = '/dashboard/setting/role-post/list'
export const SETTING_ROLE_POST_PERMISSION = '/dashboard/setting/role-post'
export const SETTING_ROLE_POST_MODULE_TYPE = null

const ROOT = '/admin-api/org/post/role'
const ROLE_ROOT = '/admin-api/sys/role'

export type SettingRolePostId = string | number

export type SettingRolePostQuery = {
  postName?: string | null
  roleId?: SettingRolePostId | null
  pageNo?: number
  /** Portal 全局列表配置使用 limit，而不是 pageSize。 */
  limit?: number
}

export type SettingRolePostRow = Record<string, unknown> & {
  id?: SettingRolePostId
  postId: SettingRolePostId
  postName: string | null
  roleNameList: string[]
  roles?: SettingRolePostRole[]
}

export type SettingRolePostRole = Record<string, unknown> & {
  id: SettingRolePostId
  name: string | null
  useSystem: number | null
}

export type SettingRolePostRoleTreeNode = Record<string, unknown> & {
  id: SettingRolePostId
  name: string
  children: SettingRolePostRoleTreeNode[]
}

export type SettingRolePostUser = Record<string, unknown> & {
  id: SettingRolePostId
  realName: string | null
  sourceType: number | null
  orgfullpath: string | null
  organization: SettingRolePostId | null
  organizationName: string | null
  postName: string | null
}

export type SettingRolePostUserQuery = {
  postId: SettingRolePostId
  realName?: string | null
  organizationId?: SettingRolePostId | null
  pageNo?: number
  limit?: number
}

export type SettingRolePostReplaceInput = {
  postId: SettingRolePostId
  roleIdList: SettingRolePostId[]
}

export type SettingRolePostDraft = {
  postId: SettingRolePostId
  roleIdList: SettingRolePostId[]
}

export type SettingRolePostPreparation = {
  draft: SettingRolePostDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingRolePostId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SettingRolePostId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'limit'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'limit' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('limit必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableQueryTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function pageOf<T> (value: unknown, label: string, rowOf: (item: unknown, itemLabel: string) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return {
    list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)),
    total: page.total as number,
  }
}

function roleOf (value: unknown, label: string): SettingRolePostRole {
  const role = objectOf(value, label)
  return {
    ...role,
    id: idOf(role.id, `${label}.id`),
    name: textOf(role.name, `${label}.name`),
    useSystem: integerOf(role.useSystem, `${label}.useSystem`),
  }
}

function roleTreeOf (value: unknown, label: string): SettingRolePostRoleTreeNode {
  const role = objectOf(value, label)
  if (typeof role.name !== 'string') throw new Error(`${label}.name必须为字符串`)
  const children = role.children === undefined || role.children === null ? [] : role.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组或缺省`)
  return {
    ...role,
    id: idOf(role.id, `${label}.id`),
    name: role.name,
    children: children.map((item, index) => roleTreeOf(item, `${label}.children[${index}]`)),
  }
}

function rowOf (value: unknown, label: string): SettingRolePostRow {
  const row = objectOf(value, label)
  const rawRoleNames = row.roleNameList
  const roleNameList = rawRoleNames === undefined || rawRoleNames === null
    ? []
    : Array.isArray(rawRoleNames)
      ? rawRoleNames.map((item, index) => {
          if (typeof item !== 'string') throw new Error(`${label}.roleNameList[${index}]必须为字符串`)
          return item
        })
      : (() => { throw new Error(`${label}.roleNameList必须为数组或缺省`) })()
  return {
    ...row,
    ...(row.id === undefined || row.id === null ? {} : { id: idOf(row.id, `${label}.id`) }),
    postId: idOf(row.postId, `${label}.postId`),
    postName: textOf(row.postName, `${label}.postName`),
    roleNameList,
    ...(Array.isArray(row.roles) ? { roles: row.roles.map((item, index) => roleOf(item, `${label}.roles[${index}]`)) } : {}),
  }
}

function userOf (value: unknown, label: string): SettingRolePostUser {
  const user = objectOf(value, label)
  return {
    ...user,
    id: idOf(user.id, `${label}.id`),
    realName: textOf(user.realName, `${label}.realName`),
    sourceType: integerOf(user.sourceType, `${label}.sourceType`),
    orgfullpath: textOf(user.orgfullpath, `${label}.orgfullpath`),
    organization: nullableIdOf(user.organization, `${label}.organization`),
    organizationName: textOf(user.organizationName, `${label}.organizationName`),
    postName: textOf(user.postName, `${label}.postName`),
  }
}

function listQueryOf (query: SettingRolePostQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    postName: queryTextOf(query.postName, '岗位名称'),
    roleId: nullableIdOf(query.roleId, '角色ID'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    limit: pageNumberOf(query.limit, 20, 'limit'),
  }
}

function userQueryOf (query: SettingRolePostUserQuery): JsonObject {
  return {
    order: '',
    orderField: '',
    postId: idOf(query?.postId, '岗位ID'),
    realName: nullableQueryTextOf(query?.realName, '姓名'),
    organizationId: nullableIdOf(query?.organizationId, '组织ID'),
    pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo'),
    limit: pageNumberOf(query?.limit, 20, 'limit'),
  }
}

function roleIdListOf (value: unknown, label: string): SettingRolePostId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return [...new Set(value.map((item, index) => idOf(item, `${label}[${index}]`)))]
}

function draftOf (value: unknown, label: string): SettingRolePostDraft {
  const draft = objectOf(value, label)
  return {
    postId: idOf(draft.postId, `${label}.postId`),
    roleIdList: roleIdListOf(draft.roleIdList, `${label}.roleIdList`),
  }
}

export function createSettingRolePostCapability (request: PortalRequest) {
  return {
    async list (query: SettingRolePostQuery = {}): Promise<PageResult<SettingRolePostRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listQueryOf(query) }), '岗位角色分页响应', rowOf)
    },

    async roleFilterOptions (): Promise<SettingRolePostRoleTreeNode[]> {
      const result = await request({ url: `${ROLE_ROOT}/allProjectRoleListNotBySystem`, method: 'post', data: [2, 3] })
      if (!Array.isArray(result)) throw new Error('岗位角色筛选候选响应必须为数组')
      return result.map((item, index) => roleTreeOf(item, `岗位角色筛选候选[${index}]`))
    },

    async roles (input: { postId: SettingRolePostId }): Promise<SettingRolePostRole[]> {
      const postId = idOf(input?.postId, '岗位ID')
      const result = await request({ url: `${ROOT}/role/${postId}`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('岗位角色响应必须为数组')
      return result.map((item, index) => roleOf(item, `岗位角色[${index}]`))
    },

    async roleOptionsBySystem (input: { useSystem: number }): Promise<SettingRolePostRole[]> {
      const useSystem = integerOf(input?.useSystem, '系统类型')
      if (useSystem === null) throw new Error('系统类型不能为空')
      const result = await request({ url: `${ROLE_ROOT}/listByUseSystem`, method: 'get', params: { useSystem } })
      if (!Array.isArray(result)) throw new Error('按系统角色候选响应必须为数组')
      return result.map((item, index) => roleOf(item, `按系统角色候选[${index}]`))
    },

    async users (query: SettingRolePostUserQuery): Promise<PageResult<SettingRolePostUser>> {
      return pageOf(await request({ url: `${ROOT}/usersListByPost`, method: 'get', params: userQueryOf(query) }), '岗位人员分页响应', userOf)
    },

    prepareReplace (input: SettingRolePostReplaceInput): SettingRolePostPreparation {
      return { draft: draftOf(input, '岗位角色替换表单') }
    },

    async replace (input: { draft: SettingRolePostDraft }): Promise<void> {
      const draft = draftOf(input?.draft, '岗位角色替换草稿')
      await request({ url: ROOT, method: 'post', data: draft })
    },
  }
}

export type SettingRolePostCapability = ReturnType<typeof createSettingRolePostCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

const listParams: ParamSpec[] = [
  p('postName', 'text', false, '岗位名称包含筛选；默认空字符串'),
  p('roleId', 'text', false, '角色ID筛选；来自角色筛选候选，省略或null表示不筛选'),
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('limit', 'number', false, 'Portal实际分页参数；支持10、20、50、100，默认20'),
]

export const SETTING_ROLE_POST_METHODS = {
  'setting-role-post-list': 'list',
  'setting-role-post-role-filter-options': 'roleFilterOptions',
  'setting-role-post-roles': 'roles',
  'setting-role-post-role-options-by-system': 'roleOptionsBySystem',
  'setting-role-post-users': 'users',
  'setting-role-post-prepare-replace': 'prepareReplace',
  'setting-role-post-replace': 'replace',
} as const

export const settingRolePostCapabilities: CapabilityDefinition[] = [
  { id: 'setting-role-post-list', title: '查询岗位角色列表', write: false, params: listParams },
  { id: 'setting-role-post-role-filter-options', title: '读取岗位角色筛选候选', write: false, params: [] },
  { id: 'setting-role-post-roles', title: '读取岗位已分配角色', write: false, params: [p('postId', 'text', true, '岗位ID；来自岗位角色列表')] },
  { id: 'setting-role-post-role-options-by-system', title: '按系统读取可分配角色', write: false, params: [p('useSystem', 'number', true, '系统类型值；来自Portal系统选项')] },
  { id: 'setting-role-post-users', title: '查询岗位人员列表', write: false, params: [p('postId', 'text', true, '岗位ID；来自岗位角色列表'), p('realName', 'text', false, '姓名包含筛选；默认空字符串'), p('organizationId', 'text', false, '组织ID筛选；省略或null表示不筛选'), p('pageNo', 'number', false, '从1开始；默认1'), p('limit', 'number', false, 'Portal实际分页参数；支持10、20、50、100，默认20')] },
  { id: 'setting-role-post-prepare-replace', title: '准备替换岗位角色', write: false, params: [p('postId', 'text', true, '岗位ID；来自岗位角色列表'), p('roleIdList', 'text', true, '角色ID数组；来自当前岗位角色或按系统角色候选，允许空数组表示清空')] },
  { id: 'setting-role-post-replace', title: '保存岗位角色分配', write: true, params: [p('draft', 'text', true, 'prepareReplace返回的完整草稿；包含postId和去重后的roleIdList')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_ROLE_POST_PAGE_PATH,
  permission: SETTING_ROLE_POST_PERMISSION,
  moduleType: SETTING_ROLE_POST_MODULE_TYPE,
  httpInstance: 'platform',
}))
