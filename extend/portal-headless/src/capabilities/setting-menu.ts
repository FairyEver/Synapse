import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 菜单管理」及其可达的创建、编辑、树删除和批量动作。 */
export const SETTING_MENU_PAGE_PATH = '/dashboard/setting/menu/list'
export const SETTING_MENU_PERMISSION = '/dashboard/setting/menu'
export const SETTING_MENU_MODULE_TYPE = null

const ROOT = '/admin-api/sys/menu'

export type SettingMenuId = string | number

export type SettingMenuNode = Record<string, unknown> & {
  id: SettingMenuId
  pid: SettingMenuId
  name: string | null
  url: string | null
  menuType: number | null
  project: number | null
  icon: string | null
  permissions: string | null
  sort: number | null
  createDate: string | number | null
  parentName: string | null
  useSystem: number | null
  children: SettingMenuNode[]
}

export type SettingMenuCreateInput = Record<string, unknown> & {
  name: string
  pid: SettingMenuId
  permissions?: string | null
  useSystem?: number | null
  project?: number | null
}

export type SettingMenuUpdateInput = Record<string, unknown> & SettingMenuCreateInput & {
  id: SettingMenuId
}

export type SettingMenuBatchInput = {
  items: SettingMenuCreateInput[]
}

export type SettingMenuRemoveInput = {
  id: SettingMenuId
  children?: Array<{ id: SettingMenuId; children?: SettingMenuRemoveInput['children'] }>
}

export type SettingMenuTreeNodeInput = {
  title: string
  permission?: string | null
  children?: SettingMenuTreeNodeInput[]
}

export type SettingMenuTreeInput = {
  nodes: SettingMenuTreeNodeInput[]
  pid: SettingMenuId
  useSystem: number
  project?: number | null
}

export type SettingMenuImportResult = {
  created: Array<{ path: string; id: SettingMenuId }>
  failed: Array<{ path: string; error: string }>
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SettingMenuId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function pidOf (value: unknown, label: string): SettingMenuId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value
  throw new Error(`${label}必须为非负整数ID`)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
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

function nodeOf (value: unknown, label: string): SettingMenuNode {
  const node = objectOf(value, label)
  const rawChildren = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(rawChildren)) throw new Error(`${label}.children必须为数组`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    pid: pidOf(node.pid, `${label}.pid`),
    name: textOf(node.name, `${label}.name`),
    url: textOf(node.url, `${label}.url`),
    menuType: integerOf(node.menuType, `${label}.menuType`),
    project: integerOf(node.project, `${label}.project`),
    icon: textOf(node.icon, `${label}.icon`),
    permissions: textOf(node.permissions, `${label}.permissions`),
    sort: integerOf(node.sort, `${label}.sort`),
    createDate: dateOf(node.createDate, `${label}.createDate`),
    parentName: textOf(node.parentName, `${label}.parentName`),
    useSystem: integerOf(node.useSystem, `${label}.useSystem`),
    children: rawChildren.map((child, index) => nodeOf(child, `${label}.children[${index}]`)),
  }
}

function listParamsOf (): Record<string, unknown> {
  return { order: '', orderField: '' }
}

function optionalIntegerOf (value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined
  return integerOf(value, label)
}

function createPayloadOf (input: SettingMenuCreateInput): Record<string, unknown> {
  const value = objectOf(input, '菜单创建表单')
  return {
    ...value,
    id: '',
    name: requiredTextOf(value.name, 'name'),
    pid: pidOf(value.pid, 'pid'),
    permissions: textOf(value.permissions, 'permissions') ?? '',
    useSystem: optionalIntegerOf(value.useSystem, 'useSystem'),
    project: optionalIntegerOf(value.project, 'project'),
  }
}

function updatePayloadOf (input: SettingMenuUpdateInput): Record<string, unknown> {
  const value = objectOf(input, '菜单修改表单')
  return {
    ...value,
    id: idOf(value.id, 'id'),
    name: requiredTextOf(value.name, 'name'),
    pid: pidOf(value.pid, 'pid'),
    permissions: textOf(value.permissions, 'permissions') ?? '',
    useSystem: optionalIntegerOf(value.useSystem, 'useSystem'),
    project: optionalIntegerOf(value.project, 'project'),
  }
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function createdIdOf (value: unknown): SettingMenuId {
  return idOf(value, '菜单新建响应')
}

function treeNodeInputOf (value: unknown, label: string): SettingMenuTreeNodeInput {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组`)
  return {
    title: requiredTextOf(node.title, `${label}.title`),
    permission: textOf(node.permission, `${label}.permission`),
    children: children.map((child, index) => treeNodeInputOf(child, `${label}.children[${index}]`)),
  }
}

function treeInputOf (input: SettingMenuTreeInput): { nodes: SettingMenuTreeNodeInput[]; pid: SettingMenuId; useSystem: number; project?: number | null } {
  const value = objectOf(input, '菜单树导入参数')
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) throw new Error('nodes必须为非空数组')
  if (!Number.isSafeInteger(value.useSystem)) throw new Error('useSystem必须为整数')
  return {
    nodes: value.nodes.map((node, index) => treeNodeInputOf(node, `nodes[${index}]`)),
    pid: pidOf(value.pid, 'pid'),
    useSystem: value.useSystem as number,
    project: optionalIntegerOf(value.project, 'project'),
  }
}

function removeIdsOf (input: SettingMenuRemoveInput): SettingMenuId[] {
  const value = objectOf(input, '菜单删除参数')
  const children = value.children === undefined || value.children === null ? [] : value.children
  if (!Array.isArray(children)) throw new Error('children必须为数组')
  const ids: SettingMenuId[] = []
  for (const child of children) ids.push(...removeIdsOf(child))
  ids.push(idOf(value.id, 'id'))
  return ids
}

/** The injected request must be bound to SETTING_MENU_PAGE_PATH. */
export function createSettingMenuCapability (request: PortalRequest) {
  const createOne = async (input: SettingMenuCreateInput): Promise<SettingMenuId> => createdIdOf(await request({ url: ROOT, method: 'post', data: createPayloadOf(input) }))
  const updateOne = async (input: SettingMenuUpdateInput): Promise<true> => trueOf(await request({ url: ROOT, method: 'put', data: updatePayloadOf(input) }), '菜单修改')

  return {
    async list (): Promise<SettingMenuNode[]> {
      const result = await request<unknown>({ url: `${ROOT}/menuListNotBySystem`, method: 'get', params: listParamsOf() })
      if (!Array.isArray(result)) throw new Error('菜单树响应必须为数组')
      return result.map((node, index) => nodeOf(node, `菜单树[${index}]`))
    },

    async get (input: { id: SettingMenuId }): Promise<SettingMenuNode> {
      const id = idOf(input?.id, 'id')
      return nodeOf(await request({ url: `${ROOT}/${id}`, method: 'get' }), '菜单详情')
    },

    async create (input: SettingMenuCreateInput): Promise<SettingMenuId> {
      return createOne(input)
    },

    async createMany (input: SettingMenuBatchInput): Promise<SettingMenuId[]> {
      const value = objectOf(input, '菜单批量创建参数')
      if (!Array.isArray(value.items) || value.items.length === 0) throw new Error('items必须为非空数组')
      const ids: SettingMenuId[] = []
      for (const item of value.items) ids.push(await createOne(item))
      return ids
    },

    async importTree (input: SettingMenuTreeInput): Promise<SettingMenuImportResult> {
      const value = treeInputOf(input)
      const result: SettingMenuImportResult = { created: [], failed: [] }
      const visit = async (nodes: SettingMenuTreeNodeInput[], parentId: SettingMenuId, prefix: string): Promise<void> => {
        for (const node of nodes) {
          const path = prefix ? `${prefix} > ${node.title}` : node.title
          try {
            const id = await createOne({ name: node.title, pid: parentId, permissions: node.permission ?? '', useSystem: value.useSystem, project: value.project })
            result.created.push({ path, id })
            if (node.children && node.children.length > 0) await visit(node.children, id, path)
          } catch (error) {
            result.failed.push({ path, error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
      await visit(value.nodes, value.pid, '')
      return result
    },

    async update (input: SettingMenuUpdateInput): Promise<true> {
      return updateOne(input)
    },

    async updateMany (input: { items: SettingMenuUpdateInput[] }): Promise<SettingMenuId[]> {
      const value = objectOf(input, '菜单批量修改参数')
      if (!Array.isArray(value.items)) throw new Error('items必须为数组')
      const ids: SettingMenuId[] = []
      for (const item of value.items) {
        await updateOne(item)
        ids.push(idOf(item?.id, 'items[].id'))
      }
      return ids
    },

    async remove (input: SettingMenuRemoveInput): Promise<true> {
      for (const id of removeIdsOf(input)) {
        await trueOf(await request({ url: `${ROOT}/${id}`, method: 'delete' }), `菜单删除${id}`)
      }
      return true
    },
  }
}

export type SettingMenuCapability = ReturnType<typeof createSettingMenuCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_MENU_METHODS = {
  'setting-menu-list': 'list',
  'setting-menu-get': 'get',
  'setting-menu-create': 'create',
  'setting-menu-create-many': 'createMany',
  'setting-menu-import-tree': 'importTree',
  'setting-menu-update': 'update',
  'setting-menu-update-many': 'updateMany',
  'setting-menu-remove': 'remove',
} as const

export const settingMenuCapabilities: CapabilityDefinition[] = [
  { id: 'setting-menu-list', title: '查询菜单树', write: false, params: [] },
  { id: 'setting-menu-get', title: '读取菜单详情', write: false, params: [p('id', 'text', true, '菜单ID')] },
  { id: 'setting-menu-create', title: '创建菜单', write: true, params: [p('name', 'text', true, '菜单名称'), p('pid', 'text', true, '父菜单ID；0表示一级菜单'), p('permissions', 'text', false, '授权标识'), p('useSystem', 'number', false, '使用系统编号'), p('project', 'number', false, '项目编号')] },
  { id: 'setting-menu-create-many', title: '批量创建菜单', write: true, params: [p('items', 'text', true, '多个菜单创建表单；页面按顺序逐条POST')] },
  { id: 'setting-menu-import-tree', title: '导入菜单树', write: true, params: [p('nodes', 'text', true, 'title/permission/children组成的非空菜单树'), p('pid', 'text', true, '导入根节点的父菜单ID'), p('useSystem', 'number', true, '使用系统编号'), p('project', 'number', false, '项目编号')] },
  { id: 'setting-menu-update', title: '修改菜单', write: true, params: [p('id', 'text', true, '菜单ID'), p('name', 'text', true, '完整菜单名称'), p('pid', 'text', true, '父菜单ID；0表示一级菜单'), p('permissions', 'text', false, '完整授权标识'), p('useSystem', 'number', false, '使用系统编号'), p('project', 'number', false, '项目编号')] },
  { id: 'setting-menu-update-many', title: '批量修改菜单', write: true, params: [p('items', 'text', true, '多个完整菜单修改表单；页面只提交实际发生变化的行')] },
  { id: 'setting-menu-remove', title: '删除菜单树节点', write: true, params: [p('id', 'text', true, '菜单ID'), p('children', 'text', false, '当前节点的递归子节点；页面删除父节点时按叶子到根删除')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_MENU_PAGE_PATH,
  permission: SETTING_MENU_PERMISSION,
  moduleType: SETTING_MENU_MODULE_TYPE,
  httpInstance: 'platform',
}))
