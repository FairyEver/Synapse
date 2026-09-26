import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 角色管理」及编辑页实际加载的权限选项。 */
export const SETTING_ROLE_PAGE_PATH = '/dashboard/setting/role/list'
export const SETTING_ROLE_PERMISSION = '/dashboard/setting/role'
export const SETTING_ROLE_MODULE_TYPE = null

const ROOT = '/admin-api/sys/role'
const SYSTEM_VALUES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 10])
const MODULE_VALUES = new Set([
  11, 12, 13, 14, 15, 16,
  21, 22, 23, 24, 25, 26,
  31, 32, 33, 34,
  41, 42, 43, 44, 45, 46,
  51, 52, 53, 54, 55,
  60, 61, 62, 63, 64, 65, 66,
  101,
])
const DATA_SCOPE_VALUES = new Set([1, 4, 8, 32, 64, 128])
const FINANCE_INVESTMENT_MODULE = 23
const EDUCATION_MODULE = 12

export type SettingRoleId = string | number

export type SettingRoleQuery = {
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type SettingRoleGradeOptionsQuery = {
  /** 班级名称关键字；无头调用必须先缩小候选范围。 */
  keyword: string
  pageNo?: number
  pageSize?: number
}

export type SettingRoleRow = Record<string, unknown> & {
  id: SettingRoleId
  name: string | null
  roleIdentifier: string | null
  remark: string | null
  useSystem: number | null
  createDate: string | number | null
}

export type SettingRoleModuleScope = Record<string, unknown> & {
  moduleType: number
  dataScopeType: number
  organizationIdList: SettingRoleId[]
  gradeIdList: SettingRoleId[]
  legalPersonIdList?: SettingRoleId[]
}

export type SettingRoleForm = Record<string, unknown> & {
  id?: SettingRoleId | '' | null
  useSystem?: number | null
  roleIdentifier?: string | null
  name: string
  menuIdList?: SettingRoleId[] | null
  remark?: string | null
  dataScope?: number | null
  roleModuleDataScopeRelList?: SettingRoleModuleScope[] | null
}

export type SettingRoleDetail = Record<string, unknown> & {
  id: SettingRoleId
  useSystem: number | null
  roleIdentifier: string | null
  name: string
  menuIdList: SettingRoleId[]
  remark: string | null
  dataScope: number | null
  roleModuleDataScopeRelList: SettingRoleModuleScope[]
}

export type SettingRoleDraft = Record<string, unknown> & {
  id: SettingRoleId | ''
  useSystem: number | null
  roleIdentifier: string | null
  name: string
  menuIdList: SettingRoleId[]
  remark: string | null
  dataScope: 2
  roleModuleDataScopeRelList: SettingRoleModuleScope[]
}

export type SettingRolePreparation = {
  mode: 'create' | 'update'
  draft: SettingRoleDraft
  previous: SettingRoleDetail | null
}

export type SettingRoleDeleteDraft = {
  ids: SettingRoleId[]
}

export type SettingRoleDeletePreparation = {
  draft: SettingRoleDeleteDraft
}

export type SettingRoleTreeNode = Record<string, unknown> & {
  id: SettingRoleId
  name: string
  children: SettingRoleTreeNode[]
}

export type SettingRoleStandardTreeNode = Record<string, unknown> & {
  id: SettingRoleId
  dictLabel: string
  children: SettingRoleStandardTreeNode[]
}

export type SettingRoleOption = Record<string, unknown> & {
  id: SettingRoleId
  name: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingRoleId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SettingRoleId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (value.length > maxLength) throw new Error(`${label}最多输入${maxLength}个字符`)
  return value
}

function keywordOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必须提供非空关键字`)
  return value
}

function remarkOf (value: unknown): string | null {
  const remark = textOf(value, '备注')
  if (remark !== null && remark.length > 20) throw new Error('备注最多输入20个字符')
  if (remark !== null && remark.length > 0 && remark.trim() === '') throw new Error('备注不能为空或全为空格')
  return remark
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function systemOf (value: unknown, label: string): number | null {
  const system = integerOf(value, label)
  if (system !== null && !SYSTEM_VALUES.has(system)) throw new Error(`${label}不是Portal支持的系统值`)
  return system
}

function moduleOf (value: unknown, label: string): number {
  const moduleType = integerOf(value, label)
  if (moduleType === null || !MODULE_VALUES.has(moduleType)) throw new Error(`${label}不是Portal支持的模块值`)
  return moduleType
}

function dataScopeOf (value: unknown, label: string): number {
  const dataScopeType = integerOf(value, label)
  if (dataScopeType === null || !DATA_SCOPE_VALUES.has(dataScopeType)) throw new Error(`${label}不是Portal支持的数据权限范围`)
  return dataScopeType
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function idListOf (value: unknown, label: string): SettingRoleId[] {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function idListOrCommaOf (value: unknown, label: string): SettingRoleId[] {
  if (Array.isArray(value)) return value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') throw new Error(`${label}必须为ID数组或逗号分隔字符串`)
  if (value.trim() === '') return []
  return value.split(',').map((item, index) => idOf(item.trim(), `${label}[${index}]`))
}

function distinctLegalPersonIdsOf (value: unknown, label: string): SettingRoleId[] {
  if (value === undefined || value === null || value === '') return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  return [...new Set(value.filter(item => item !== 0 && item !== '0').map((item, index) => idOf(item, `${label}[${index}]`)))]
}

function createIdOf (value: unknown): '' {
  if (value === undefined || value === null || value === '') return ''
  throw new Error('新建角色的id必须为空')
}

function roleRowOf (value: unknown, label: string): SettingRoleRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    roleIdentifier: textOf(row.roleIdentifier, `${label}.roleIdentifier`),
    remark: textOf(row.remark, `${label}.remark`),
    useSystem: systemOf(row.useSystem, `${label}.useSystem`),
    createDate: row.createDate === undefined || row.createDate === null || typeof row.createDate === 'string' || (typeof row.createDate === 'number' && Number.isFinite(row.createDate))
      ? (row.createDate as string | number | null | undefined) ?? null
      : (() => { throw new Error(`${label}.createDate必须为字符串、有限数字或null`) })(),
  }
}

function scopeRowOf (value: unknown, label: string, forSubmit: boolean): SettingRoleModuleScope {
  const row = objectOf(value, label)
  const moduleType = forSubmit ? moduleOf(row.moduleType, `${label}.moduleType`) : integerOf(row.moduleType, `${label}.moduleType`)
  if (moduleType === null) throw new Error(`${label}.moduleType不能为空`)
  const dataScopeType = dataScopeOf(row.dataScopeType, `${label}.dataScopeType`)
  if (forSubmit && moduleType === EDUCATION_MODULE && dataScopeType !== 4 && dataScopeType !== 128) {
    throw new Error('学习模块只允许Portal支持的自定义权限或所在法人')
  }

  const organizationIdList = idListOrCommaOf(row.organizationIdList, `${label}.organizationIdList`)
  const gradeIdList = idListOf(row.gradeIdList, `${label}.gradeIdList`)
  const legalPersonIdList = distinctLegalPersonIdsOf(row.legalPersonIdList, `${label}.legalPersonIdList`)

  if (dataScopeType === 128) {
    return { ...row, moduleType, dataScopeType, organizationIdList: [], gradeIdList: [], legalPersonIdList: [] }
  }
  if (forSubmit && dataScopeType === 4 && moduleType === EDUCATION_MODULE && gradeIdList.length === 0) {
    throw new Error('学习模块的自定义权限必须选择班级')
  }
  if (forSubmit && (dataScopeType === 4 || dataScopeType === 32 || dataScopeType === 64) && moduleType !== EDUCATION_MODULE && organizationIdList.length === 0) {
    throw new Error('自定义权限必须选择组织范围')
  }

  const normalized: SettingRoleModuleScope = {
    ...row,
    moduleType,
    dataScopeType,
    organizationIdList: moduleType === EDUCATION_MODULE ? [] : organizationIdList,
    gradeIdList: moduleType === EDUCATION_MODULE ? gradeIdList : gradeIdList,
    legalPersonIdList,
  }
  if (moduleType !== FINANCE_INVESTMENT_MODULE) delete normalized.legalPersonIdList
  return normalized
}

function scopesOf (value: unknown, label: string, forSubmit: boolean): SettingRoleModuleScope[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  const seenModules = new Set<number>()
  return value.map((item, index) => {
    const scope = scopeRowOf(item, `${label}[${index}]`, forSubmit)
    if (forSubmit && seenModules.has(scope.moduleType)) throw new Error(`${label}不能重复选择同一模块`)
    seenModules.add(scope.moduleType)
    return scope
  })
}

function detailOf (value: unknown): SettingRoleDetail {
  const role = objectOf(value, '角色详情响应')
  const id = idOf(role.id, '角色详情响应.id')
  const name = role.name
  if (typeof name !== 'string') throw new Error('角色详情响应.name必须为字符串')
  const result = { ...role }
  delete result.parentId
  return {
    ...result,
    id,
    name,
    useSystem: systemOf(role.useSystem, '角色详情响应.useSystem'),
    roleIdentifier: textOf(role.roleIdentifier, '角色详情响应.roleIdentifier'),
    menuIdList: idListOf(role.menuIdList, '角色详情响应.menuIdList'),
    remark: textOf(role.remark, '角色详情响应.remark'),
    dataScope: integerOf(role.dataScope, '角色详情响应.dataScope'),
    roleModuleDataScopeRelList: scopesOf(role.roleModuleDataScopeRelList, '角色详情响应.roleModuleDataScopeRelList', false),
  }
}

function formDraftOf (value: unknown, mode: 'create' | 'update'): SettingRoleDraft {
  const form = objectOf(value, mode === 'create' ? '角色新建表单' : '角色编辑表单')
  const id = mode === 'create' ? createIdOf(form.id) : idOf(form.id, '角色ID')
  const draft = { ...form }
  delete draft.parentId
  return {
    ...draft,
    id,
    useSystem: systemOf(form.useSystem, '系统'),
    roleIdentifier: textOf(form.roleIdentifier, '角色编码'),
    name: requiredTextOf(form.name, '角色名称', 50),
    menuIdList: idListOf(form.menuIdList, '菜单ID列表'),
    remark: remarkOf(form.remark),
    dataScope: 2,
    roleModuleDataScopeRelList: scopesOf(form.roleModuleDataScopeRelList, '角色模块数据权限列表', true),
  }
}

function pageOf (value: unknown): PageResult<SettingRoleRow> {
  const page = objectOf(value, '角色分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('角色分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => roleRowOf(item, `角色列表行[${index}]`)), total: page.total as number }
}

function listQueryOf (query: SettingRoleQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, '角色名称') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function treeNodeOf (value: unknown, label: string): SettingRoleTreeNode {
  const node = objectOf(value, label)
  if (typeof node.name !== 'string') throw new Error(`${label}.name必须为字符串`)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组或缺省`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: node.name,
    children: children.map((item, index) => treeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function standardTreeNodeOf (value: unknown, label: string): SettingRoleStandardTreeNode {
  const node = objectOf(value, label)
  if (typeof node.dictLabel !== 'string') throw new Error(`${label}.dictLabel必须为字符串`)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组或缺省`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    dictLabel: node.dictLabel,
    children: children.map((item, index) => standardTreeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function optionOf (value: unknown, label: string): SettingRoleOption {
  const option = objectOf(value, label)
  if (typeof option.name !== 'string') throw new Error(`${label}.name必须为字符串`)
  return { ...option, id: idOf(option.id, `${label}.id`), name: option.name }
}

function deleteDraftOf (value: unknown): SettingRoleDeleteDraft {
  const draft = objectOf(value, '角色删除草稿')
  if (!Array.isArray(draft.ids) || draft.ids.length === 0) throw new Error('角色删除ids必须为非空数组')
  return { ids: draft.ids.map((item, index) => idOf(item, `角色删除ids[${index}]`)) }
}

export function createSettingRoleCapability (request: PortalRequest) {
  return {
    async list (query: SettingRoleQuery = {}): Promise<PageResult<SettingRoleRow>> {
      return pageOf(await request({ url: `${ROOT}/allProjectRoleByPage`, method: 'get', params: listQueryOf(query) }))
    },

    async getInfo (input: { id: SettingRoleId }): Promise<SettingRoleDetail> {
      const id = idOf(input?.id, '角色ID')
      return detailOf(await request({ url: `${ROOT}/info/${id}`, method: 'get' }))
    },

    async menuOptions (input: { useSystem: number }): Promise<SettingRoleTreeNode[]> {
      const useSystem = systemOf(input?.useSystem, '系统')
      if (useSystem === null) throw new Error('系统不能为空')
      const result = await request({ url: '/admin-api/sys/menu/select-role-menu-by-tenant', method: 'get', params: { useSystem } })
      if (!Array.isArray(result)) throw new Error('角色菜单候选响应必须为数组')
      return result.map((item, index) => treeNodeOf(item, `角色菜单候选[${index}]`))
    },

    async organizationTree (): Promise<SettingRoleTreeNode[]> {
      const result = await request({ url: '/org/organization/getRoleOrganizationTree', method: 'get' })
      if (!Array.isArray(result)) throw new Error('角色组织树响应必须为数组')
      return result.map((item, index) => treeNodeOf(item, `角色组织树[${index}]`))
    },

    async standardTree (): Promise<SettingRoleStandardTreeNode[]> {
      const result = await request({ url: `${ROOT}/getStandardTree`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('角色标准化单元树响应必须为数组')
      return result.map((item, index) => standardTreeNodeOf(item, `角色标准化单元树[${index}]`))
    },

    async organizationTypeOptions (): Promise<SettingRoleOption[]> {
      const result = await request({ url: '/org/organizationType/selectAll', method: 'get' })
      if (!Array.isArray(result)) throw new Error('角色组织类型候选响应必须为数组')
      return result.map((item, index) => optionOf(item, `角色组织类型候选[${index}]`))
    },

    async legalPersonOptions (): Promise<SettingRoleOption[]> {
      const result = await request({ url: '/org/corporation/getAllLegalPerson', method: 'get' })
      if (!Array.isArray(result)) throw new Error('角色法人候选响应必须为数组')
      return result.map((item, index) => optionOf(item, `角色法人候选[${index}]`))
    },

    async gradeOptions (input: SettingRoleGradeOptionsQuery): Promise<SettingRoleOption[]> {
      const keyword = keywordOf(input?.keyword, '班级关键字')
      const pageNo = pageNumberOf(input?.pageNo, 1, 'pageNo')
      const pageSize = pageNumberOf(input?.pageSize, 20, 'pageSize')
      const result = objectOf(await request({ url: '/study/grade/studygrade/page', method: 'get', params: { name: keyword, pageNo, pageSize } }), '角色班级候选响应')
      if (!Array.isArray(result.list)) throw new Error('角色班级候选响应缺少list')
      return result.list.map((item, index) => optionOf(item, `角色班级候选[${index}]`))
    },

    prepareCreate (input: { form: SettingRoleForm }): SettingRolePreparation {
      return { mode: 'create', draft: formDraftOf(input?.form, 'create'), previous: null }
    },

    async create (input: { draft: SettingRoleDraft }): Promise<void> {
      await request({ url: `${ROOT}/saveRoleV1`, method: 'post', data: formDraftOf(input?.draft, 'create') })
    },

    prepareUpdate (input: { current: SettingRoleDetail | Record<string, unknown>; changes?: Record<string, unknown> | null }): SettingRolePreparation {
      const previous = detailOf(input?.current)
      return { mode: 'update', draft: formDraftOf({ ...previous, ...(input?.changes ?? {}) }, 'update'), previous }
    },

    async update (input: { draft: SettingRoleDraft }): Promise<void> {
      await request({ url: `${ROOT}/updateRoleV1`, method: 'post', data: formDraftOf(input?.draft, 'update') })
    },

    prepareDelete (input: { ids: SettingRoleId[] }): SettingRoleDeletePreparation {
      return { draft: deleteDraftOf(input) }
    },

    async remove (input: { draft: SettingRoleDeleteDraft }): Promise<void> {
      const draft = deleteDraftOf(input?.draft)
      await request({ url: ROOT, method: 'delete', data: draft.ids })
    },
  }
}

export type SettingRoleCapability = ReturnType<typeof createSettingRoleCapability>
export type SettingRoleCapabilityWithIdempotency = SettingRoleCapability & {
  createIdempotent: (input: { draft: SettingRoleDraft; requestId: string }) => Promise<void>
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_ROLE_METHODS = {
  'setting-role-list': 'list',
  'setting-role-get-info': 'getInfo',
  'setting-role-menu-options': 'menuOptions',
  'setting-role-organization-tree': 'organizationTree',
  'setting-role-standard-tree': 'standardTree',
  'setting-role-organization-type-options': 'organizationTypeOptions',
  'setting-role-legal-person-options': 'legalPersonOptions',
  'setting-role-grade-options': 'gradeOptions',
  'setting-role-prepare-create': 'prepareCreate',
  'setting-role-create': 'create',
  'setting-role-prepare-update': 'prepareUpdate',
  'setting-role-update': 'update',
  'setting-role-prepare-delete': 'prepareDelete',
  'setting-role-remove': 'remove',
} as const

const formParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal角色表单对象；prepare会校验名称、模块权限和各类ID' }

export const settingRoleCapabilities: CapabilityDefinition[] = [
  { id: 'setting-role-list', title: '查询角色分页', write: false, params: [p('name', 'text', false, '角色名称包含筛选；默认空字符串'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'setting-role-get-info', title: '读取角色编辑表单', write: false, params: [p('id', 'text', true, '角色ID')] },
  { id: 'setting-role-menu-options', title: '按系统读取角色菜单候选', write: false, params: [p('useSystem', 'number', true, 'Portal系统下拉值')] },
  { id: 'setting-role-organization-tree', title: '读取角色数据权限组织树', write: false, params: [] },
  { id: 'setting-role-standard-tree', title: '读取角色标准化单元树', write: false, params: [] },
  { id: 'setting-role-organization-type-options', title: '读取角色组织类型候选', write: false, params: [] },
  { id: 'setting-role-legal-person-options', title: '读取角色法人候选', write: false, params: [] },
  { id: 'setting-role-grade-options', title: '按关键字读取角色班级候选', write: false, params: [p('keyword', 'text', true, '班级名称关键字；必须是非空字符串，先缩小候选范围'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'setting-role-prepare-create', title: '准备新建角色', write: false, params: [formParam] },
  { id: 'setting-role-create', title: '提交新建角色', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整角色草稿')] },
  { id: 'setting-role-prepare-update', title: '准备编辑角色', write: false, params: [p('current', 'text', true, '来自getInfo的完整角色表单'), p('changes', 'text', false, '要覆盖的角色表单字段')] },
  { id: 'setting-role-update', title: '提交编辑角色', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整角色草稿')] },
  { id: 'setting-role-prepare-delete', title: '准备删除角色', write: false, params: [p('ids', 'text', true, '要删除的角色ID数组')] },
  { id: 'setting-role-remove', title: '批量删除角色', write: true, params: [p('draft', 'text', true, 'prepareDelete返回的角色ID草稿')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_ROLE_PAGE_PATH,
  permission: SETTING_ROLE_PERMISSION,
  moduleType: SETTING_ROLE_MODULE_TYPE,
  httpInstance: 'platform',
}))
