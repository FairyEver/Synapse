import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal“系统设置 → 分类字典”；Portal 2cd9b0f37d、Java ecae93d9b50。 */
export const SETTING_CATEGORY_DICT_PAGE_PATH = '/dashboard/setting/category-dict/list'
export const SETTING_CATEGORY_DICT_PERMISSION = '/dashboard/setting/category-dict'
/** 该路径不命中 Portal 的 getCurrentModuleType 规则，浏览器不发送 module-type。 */
export const SETTING_CATEGORY_DICT_MODULE_TYPE = null

const ROOT = '/admin-api/system/category-dict'

export type SettingCategoryDictId = string | number
export type SettingCategoryDictTenantEditable = 0 | 1

export type SettingCategoryDictNode = Record<string, unknown> & {
  id: SettingCategoryDictId
  pid: SettingCategoryDictId
  name: string
  code: string | null
  tenantId: SettingCategoryDictId | null
  platform: boolean | null
  tenantEditable: SettingCategoryDictTenantEditable | null
  createTime: string | number | null
  children: SettingCategoryDictNode[]
}

export type SettingCategoryDictQuery = {
  name?: string | null
  code?: string | null
  /** Portal 页面固定为 true，只展示租户可维护根及其后代。 */
  onlyTenantEditable?: boolean
}

export type SettingCategoryDictCreateInput = {
  /** 租户页面只能在已有父节点下新增子分类，根节点由平台维护。 */
  pid: SettingCategoryDictId
  name: string
  code?: string | null
}

export type SettingCategoryDictUpdateInput = SettingCategoryDictCreateInput & {
  id: SettingCategoryDictId
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SettingCategoryDictId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function pidOf (value: unknown, label: string): SettingCategoryDictId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value
  throw new Error(`${label}必须为非负整数字符串或安全非负整数`)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredNameOf (value: unknown): string {
  // Java 使用 @NotEmpty，空格由后端按原值处理，不能擅自 trim 或把空格判成空值。
  if (typeof value !== 'string' || value.length === 0) throw new Error('name不能为空字符串')
  return value
}

function tenantEditableOf (value: unknown, label: string): SettingCategoryDictTenantEditable | null {
  if (value === undefined || value === null) return null
  if (value === 0 || value === '0') return 0
  if (value === 1 || value === '1') return 1
  throw new Error(`${label}必须为0、1或null`)
}

function platformOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function nodeOf (value: unknown, label: string): SettingCategoryDictNode {
  const node = objectOf(value, label)
  const rawChildren = node.children === undefined ? [] : node.children
  if (!Array.isArray(rawChildren)) throw new Error(`${label}.children必须为数组`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    pid: pidOf(node.pid, `${label}.pid`),
    name: requiredNameOf(node.name),
    code: textOf(node.code, `${label}.code`),
    tenantId: node.tenantId === undefined || node.tenantId === null
      ? null
      : pidOf(node.tenantId, `${label}.tenantId`),
    platform: platformOf(node.platform, `${label}.platform`),
    tenantEditable: tenantEditableOf(node.tenantEditable, `${label}.tenantEditable`),
    createTime: dateTimeOf(node.createTime, `${label}.createTime`),
    children: rawChildren.map((child, index) => nodeOf(child, `${label}.children[${index}]`)),
  }
}

function queryOf (query: SettingCategoryDictQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  const name = textOf(source.name, 'name') ?? ''
  const code = textOf(source.code, 'code') ?? ''
  if (source.onlyTenantEditable !== undefined && typeof source.onlyTenantEditable !== 'boolean') {
    throw new Error('onlyTenantEditable必须为布尔值')
  }
  return {
    order: '',
    orderField: '',
    name,
    code,
    onlyTenantEditable: source.onlyTenantEditable ?? true,
  }
}

function savePayloadOf (input: SettingCategoryDictCreateInput | SettingCategoryDictUpdateInput, id?: SettingCategoryDictId): Record<string, unknown> {
  const value = objectOf(input, '分类字典表单')
  const pid = idOf(value.pid, 'pid')
  const payload: Record<string, unknown> = {
    ...(id === undefined ? {} : { id: idOf(id, 'id') }),
    pid,
    name: requiredNameOf(value.name),
    // ModalForm 的 code 默认值是 null；保留 null，不伪造为空字符串。
    code: textOf(value.code, 'code'),
  }
  return payload
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function createdIdOf (value: unknown): SettingCategoryDictId {
  return idOf(value, '分类字典新建id')
}

/** The injected request must be bound to SETTING_CATEGORY_DICT_PAGE_PATH. */
export function createSettingCategoryDictCapability (request: PortalRequest) {
  return {
    async list (query: SettingCategoryDictQuery = {}): Promise<SettingCategoryDictNode[]> {
      const result = await request<unknown>({ url: `${ROOT}/tree`, method: 'get', params: queryOf(query) })
      if (!Array.isArray(result)) throw new Error('分类字典树响应必须为数组')
      return result.map((node, index) => nodeOf(node, `分类字典树[${index}]`))
    },

    async create (input: SettingCategoryDictCreateInput): Promise<SettingCategoryDictId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: savePayloadOf(input) })
      return createdIdOf(result)
    },

    async update (input: SettingCategoryDictUpdateInput): Promise<true> {
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: savePayloadOf(input, input?.id) })
      return trueResult(result, '更新分类字典')
    },

    async remove (id: SettingCategoryDictId): Promise<true> {
      const result = await request<unknown>({ url: `${ROOT}/delete/${idOf(id, 'id')}`, method: 'delete' })
      return trueResult(result, '删除分类字典')
    },
  }
}

export type SettingCategoryDictCapability = ReturnType<typeof createSettingCategoryDictCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_CATEGORY_DICT_METHODS = {
  'setting-category-dict-list': 'list',
  'setting-category-dict-create': 'create',
  'setting-category-dict-update': 'update',
  'setting-category-dict-remove': 'remove',
} as const

export const settingCategoryDictCapabilities: CapabilityDefinition[] = [
  { id: 'setting-category-dict-list', title: '查询分类字典树', write: false, params: [p('name', 'text', false, '名称，模糊匹配'), p('code', 'text', false, '编码，精确匹配'), p('onlyTenantEditable', 'boolean', false, '是否只返回租户可维护根及其后代，页面默认true')] },
  { id: 'setting-category-dict-create', title: '创建分类字典子项', write: true, params: [p('pid', 'text', true, '父级分类 ID；必须来自当前树中可见的父节点'), p('name', 'text', true, '分类名称'), p('code', 'text', false, '分类编码；未填写按null提交')] },
  { id: 'setting-category-dict-update', title: '修改分类字典子项', write: true, params: [p('id', 'text', true, '租户自有分类字典 ID'), p('pid', 'text', true, '父级分类 ID'), p('name', 'text', true, '完整分类名称'), p('code', 'text', false, '完整分类编码；未填写按null提交')] },
  { id: 'setting-category-dict-remove', title: '删除分类字典子项', write: true, params: [p('id', 'text', true, '租户自有且没有子节点的分类字典 ID')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_CATEGORY_DICT_PAGE_PATH,
  permission: SETTING_CATEGORY_DICT_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_CATEGORY_DICT_MODULE_TYPE,
}))
