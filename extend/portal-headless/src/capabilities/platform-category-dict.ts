import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「平台设置 → 分类字典」；Portal 3622e02147、Java c3348150f42。 */
export const PLATFORM_CATEGORY_DICT_PAGE_PATH = '/dashboard/platform/setting/category-dict/list'

const ROOT = '/adminmanage-api/system/category-dict'

export type PlatformCategoryDictId = string | number
export type PlatformCategoryDictTenantEditable = 0 | 1

export type PlatformCategoryDictNode = {
  [key: string]: unknown
  id: PlatformCategoryDictId
  pid: PlatformCategoryDictId
  name: string
  code: string | null
  tenantId: PlatformCategoryDictId | null
  platform: boolean | null
  tenantEditable: PlatformCategoryDictTenantEditable | null
  createTime: string | number | null
  children: PlatformCategoryDictNode[]
}

export type PlatformCategoryDictQuery = {
  name?: string | null
  code?: string | null
}

export type PlatformCategoryDictCreateInput = {
  pid?: PlatformCategoryDictId | null
  name: string
  code?: string | null
  tenantEditable?: PlatformCategoryDictTenantEditable | boolean | null
}

export type PlatformCategoryDictUpdateInput = PlatformCategoryDictCreateInput & {
  id: PlatformCategoryDictId
}

export type PlatformCategoryDictInlineUpdateInput = PlatformCategoryDictUpdateInput

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): PlatformCategoryDictId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  return value
}

function nullableTenantIdOf (value: unknown, label: string): PlatformCategoryDictId | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负安全整数、十进制正整数字符串或null`)
    return value
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value
  throw new Error(`${label}必须为非负安全整数、十进制正整数字符串或null`)
}

function pidOf (value: unknown, label: string): PlatformCategoryDictId {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return 0
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredNameOf (value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('name不能为空字符串')
  return value
}

function tenantEditableOf (value: unknown, fallback: PlatformCategoryDictTenantEditable = 0): PlatformCategoryDictTenantEditable {
  if (value === undefined || value === null) return fallback
  if (value === true || value === 1 || value === '1') return 1
  if (value === false || value === 0 || value === '0') return 0
  throw new Error('tenantEditable只能是0、1或布尔值')
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function nodeOf (value: unknown, label: string): PlatformCategoryDictNode {
  const node = objectOf(value, label)
  const rawChildren = node.children === undefined ? [] : node.children
  if (!Array.isArray(rawChildren)) throw new Error(`${label}.children必须为数组`)
  const children = rawChildren.map((child: unknown, index: number) => nodeOf(child, `${label}.children[${index}]`))
  const pid = pidOf(node.pid, `${label}.pid`)
  const tenantEditable = node.tenantEditable === null || node.tenantEditable === undefined
    ? null
    : tenantEditableOf(node.tenantEditable)
  const platform = node.platform === undefined || node.platform === null
    ? null
    : typeof node.platform === 'boolean' ? node.platform : (() => { throw new Error(`${label}.platform必须为布尔值或null`) })()
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    pid,
    name: requiredNameOf(node.name),
    code: textOf(node.code, `${label}.code`),
    tenantId: nullableTenantIdOf(node.tenantId, `${label}.tenantId`),
    platform,
    tenantEditable,
    createTime: dateTimeOf(node.createTime, `${label}.createTime`),
    children,
  }
}

function queryOf (query: PlatformCategoryDictQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  const name = textOf(source.name, 'name') ?? ''
  const code = textOf(source.code, 'code') ?? ''
  return { order: '', orderField: '', name, code }
}

function savePayloadOf (input: PlatformCategoryDictCreateInput | PlatformCategoryDictUpdateInput, id: PlatformCategoryDictId | undefined, includeChildTenantEditable: boolean): Record<string, unknown> {
  const value = objectOf(input, '分类字典表单')
  const pid = pidOf(value.pid, 'pid')
  const payload: Record<string, unknown> = {
    ...(id === undefined ? {} : { id: idOf(id, 'id') }),
    pid,
    name: requiredNameOf(value.name),
    code: textOf(value.code, 'code') ?? '',
  }
  if (pid === 0 || includeChildTenantEditable) {
    // The Portal inline action uses `data.tenantEditable === 0 ? 0 : 1`.
    // Its missing/null value therefore becomes 1; modal forms normalize a
    // missing root value to 0 before reaching this projection.
    payload.tenantEditable = tenantEditableOf(value.tenantEditable, includeChildTenantEditable ? 1 : 0)
  }
  return payload
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function createdIdOf (value: unknown): PlatformCategoryDictId {
  return idOf(value, '分类字典新建id')
}

/** The injected request must be bound to PLATFORM_CATEGORY_DICT_PAGE_PATH. */
export function createPlatformCategoryDictCapability (request: PortalRequest) {
  return {
    async list (query: PlatformCategoryDictQuery = {}): Promise<PlatformCategoryDictNode[]> {
      const result = await request<unknown>({ url: `${ROOT}/tree`, method: 'get', params: queryOf(query) })
      if (!Array.isArray(result)) throw new Error('分类字典树响应必须为数组')
      return result.map((node, index) => nodeOf(node, `分类字典树[${index}]`))
    },

    async create (input: PlatformCategoryDictCreateInput): Promise<PlatformCategoryDictId> {
      const payload = savePayloadOf(input, undefined, false)
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: payload })
      return createdIdOf(result)
    },

    async update (input: PlatformCategoryDictUpdateInput): Promise<true> {
      const payload = savePayloadOf(input, input.id, false)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payload })
      return trueResult(result, '更新分类字典')
    },

    /** Portal inline name/code editing sends tenantEditable even for child rows. */
    async updateInline (input: PlatformCategoryDictInlineUpdateInput): Promise<true> {
      const payload = savePayloadOf(input, input.id, true)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payload })
      return trueResult(result, '行内更新分类字典')
    },

    async setTenantEditable (input: PlatformCategoryDictUpdateInput): Promise<true> {
      const value = objectOf(input, '分类字典租户自定义开关输入')
      const pid = pidOf(value.pid, 'pid')
      if (pid !== 0) throw new Error('只有根分类可以修改tenantEditable')
      const payload = savePayloadOf(input, input.id, true)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payload })
      return trueResult(result, '修改分类字典租户自定义开关')
    },

    async remove (id: PlatformCategoryDictId): Promise<true> {
      const result = await request<unknown>({ url: `${ROOT}/delete/${idOf(id, 'id')}`, method: 'delete' })
      return trueResult(result, '删除分类字典')
    },
  }
}

export type PlatformCategoryDictCapability = ReturnType<typeof createPlatformCategoryDictCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const idParam = (name: string, required: boolean, description: string): ParamSpec => p(name, 'text', required, description)
const tenantEditableParam: ParamSpec = {
  name: 'tenantEditable', kind: 'enum', required: false,
  description: '是否支持租户自定义：0否、1是；仅根分类有效',
  options: [{ value: 0, label: '否' }, { value: 1, label: '是' }],
}

export const PLATFORM_CATEGORY_DICT_METHODS = {
  'platform-category-dict-list': 'list',
  'platform-category-dict-create': 'create',
  'platform-category-dict-update': 'update',
  'platform-category-dict-update-inline': 'updateInline',
  'platform-category-dict-set-tenant-editable': 'setTenantEditable',
  'platform-category-dict-remove': 'remove',
} as const

export const platformCategoryDictCapabilities: CapabilityDefinition[] = [
  { id: 'platform-category-dict-list', title: '查询分类字典树', write: false, params: [p('name', 'text', false, '名称，模糊匹配'), p('code', 'text', false, '编码，精确匹配')] },
  { id: 'platform-category-dict-create', title: '创建分类字典', write: true, params: [idParam('pid', true, '父级节点 ID；根节点传0或null'), p('name', 'text', true, '分类名称'), p('code', 'text', false, '编码；未填写按空字符串提交'), tenantEditableParam] },
  { id: 'platform-category-dict-update', title: '编辑分类字典', write: true, params: [idParam('id', true, '分类字典 ID'), idParam('pid', true, '父级节点 ID；根节点传0'), p('name', 'text', true, '分类名称'), p('code', 'text', false, '编码'), tenantEditableParam] },
  { id: 'platform-category-dict-update-inline', title: '行内修改分类字典名称或编码', write: true, params: [idParam('id', true, '分类字典 ID'), idParam('pid', true, '父级节点 ID；沿用当前行'), p('name', 'text', true, '完整分类名称'), p('code', 'text', false, '完整编码'), tenantEditableParam] },
  { id: 'platform-category-dict-set-tenant-editable', title: '修改根分类租户自定义开关', write: true, params: [idParam('id', true, '根分类 ID'), idParam('pid', true, '必须为0'), p('name', 'text', true, '沿用当前根分类名称'), p('code', 'text', false, '沿用当前编码'), tenantEditableParam] },
  { id: 'platform-category-dict-remove', title: '删除分类字典', write: true, params: [idParam('id', true, '分类字典 ID')] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_CATEGORY_DICT_PAGE_PATH,
  permission: '/dashboard/platform-v2/setting/category-dict',
  httpInstance: 'platform',
  moduleType: null,
}))
