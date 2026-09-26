import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 前端日志」；页面实际展示的是全量 HR 菜单树接口返回的数据。 */
export const SETTING_FRONTEND_LOG_PAGE_PATH = '/dashboard/setting/log/list'
export const SETTING_FRONTEND_LOG_PERMISSION = '/dashboard/setting/log'
export const SETTING_FRONTEND_LOG_MODULE_TYPE = null

const ROOT = '/admin-api/sys/menu/menuListNotBySystem'

export type SettingFrontendLogId = string | number

export type SettingFrontendLogNode = Record<string, unknown> & {
  id: SettingFrontendLogId
  pid: SettingFrontendLogId
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
  children: SettingFrontendLogNode[]
}

export type SettingFrontendLogQuery = {
  text?: string | null
  finger?: string | null
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SettingFrontendLogId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function pidOf (value: unknown, label: string): SettingFrontendLogId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value
  throw new Error(`${label}必须为非负整数字符串或安全非负整数`)
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

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function nodeOf (value: unknown, label: string): SettingFrontendLogNode {
  const node = objectOf(value, label)
  const rawChildren = node.children === undefined ? [] : node.children
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

function queryOf (query: SettingFrontendLogQuery = {}): Record<string, unknown> {
  const value = query ?? {}
  return {
    order: '',
    orderField: '',
    finger: textOf(value.finger, 'finger') ?? '',
    text: textOf(value.text, 'text') ?? '',
  }
}

/** The injected request must be bound to SETTING_FRONTEND_LOG_PAGE_PATH. */
export function createSettingFrontendLogCapability (request: PortalRequest) {
  return {
    async list (query: SettingFrontendLogQuery = {}): Promise<SettingFrontendLogNode[]> {
      const result = await request<unknown>({ url: ROOT, method: 'get', params: queryOf(query) })
      if (!Array.isArray(result)) throw new Error('前端日志菜单树响应必须为数组')
      return result.map((node, index) => nodeOf(node, `前端日志菜单树[${index}]`))
    },
  }
}

export type SettingFrontendLogCapability = ReturnType<typeof createSettingFrontendLogCapability>

const p = (name: string, kind: ParamSpec['kind'], description: string): ParamSpec => ({ name, kind, required: false, description })

export const SETTING_FRONTEND_LOG_METHODS = {
  'setting-frontend-log-list': 'list',
} as const

export const settingFrontendLogCapabilities: CapabilityDefinition[] = [
  { id: 'setting-frontend-log-list', title: '查询前端日志菜单树', write: false, params: [p('text', 'text', '日志内容筛选；当前后端接口不消费该参数'), p('finger', 'text', '指纹筛选；当前后端接口不消费该参数')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_FRONTEND_LOG_PAGE_PATH,
  permission: SETTING_FRONTEND_LOG_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_FRONTEND_LOG_MODULE_TYPE,
}))
