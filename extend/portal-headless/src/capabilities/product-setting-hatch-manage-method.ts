import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 方法设置」。 */
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH = '/dashboard/product/setting/hatch-manage/method/list'
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_PERMISSION = '/dashboard/frame/breeding-plan/method'
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_QUERY_PERMISSION = 'program:method:query'
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_SUBMIT_PERMISSION = 'program:method:submit'
export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_DELETE_PERMISSION = 'program:method:delete'

const LIST_URL = '/programUnit/getList'
const CREATE_URL = '/programNew/methodLib/createTrait'
const UPDATE_URL = '/programNew/methodLib/editTrait'
const DELETE_URL = '/programNew/methodLib/deleteTrait'

export type ProductSettingHatchManageMethodId = string | number

export type ProductSettingHatchManageMethodQuery = {
  classification?: string | number | null
  search?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchManageMethodRow = Record<string, unknown> & {
  id: ProductSettingHatchManageMethodId | null
  classification: string | number | null
  traitTypeName: string | null
  name: string | null
  traitName: string | null
  title1: string | null
  title2: string | null
  title3: string | null
}

export type ProductSettingHatchManageMethodPage = {
  list: ProductSettingHatchManageMethodRow[]
  total: number
}

export type ProductSettingHatchManageMethodCreateForm = {
  traitType: string | number
  name: string
  title1: string
  title2: string
  title3: string
}

export type ProductSettingHatchManageMethodCreateDraft = {
  id?: undefined
  traitType: string
  name: string
  title1: string
  title2: string
  title3: string
}

export type ProductSettingHatchManageMethodUpdateForm = Record<string, unknown> & {
  id?: ProductSettingHatchManageMethodId | null | ''
  traitType?: string | number | null
  classification?: string | number | null
  name?: string | null
  traitName?: string | null
  title1?: string | null
  title2?: string | null
  title3?: string | null
}

export type ProductSettingHatchManageMethodUpdateDraft = Record<string, unknown> & {
  id?: ProductSettingHatchManageMethodId | null | ''
  traitType: string
  name: string
  title1: string
  title2: string
  title3: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingHatchManageMethodId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchManageMethodId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function optionalIdOf (value: unknown, label: string): ProductSettingHatchManageMethodId | null | undefined | '' {
  if (value === undefined) return undefined
  if (value === null || value === '') return value
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function queryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须为字符串、整数或空值`)
}

function requiredTextOf (value: unknown, label: string): string {
  const text = formTextOf(value, label)
  if (text.length === 0) throw new Error(`${label}不能为空`)
  return text
}

/** Portal弹窗会把字典项和当前行的分类都转成字符串后再提交。 */
function requiredTraitTypeOf (value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return requiredTextOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function rowOf (value: unknown, index: number): ProductSettingHatchManageMethodRow {
  const row = objectOf(value, `方法设置列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `方法设置列表[${index}].id`),
    classification: row.classification === undefined || row.classification === null || row.classification === ''
      ? null
      : queryValueOf(row.classification, `方法设置列表[${index}].classification`),
    traitTypeName: nullableTextOf(row.traitTypeName, `方法设置列表[${index}].traitTypeName`),
    name: nullableTextOf(row.name, `方法设置列表[${index}].name`),
    traitName: nullableTextOf(row.traitName, `方法设置列表[${index}].traitName`),
    title1: nullableTextOf(row.title1, `方法设置列表[${index}].title1`),
    title2: nullableTextOf(row.title2, `方法设置列表[${index}].title2`),
    title3: nullableTextOf(row.title3, `方法设置列表[${index}].title3`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined && object.rows === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchManageMethodPage {
  const payload = objectOf(payloadOf(value), '方法设置分页响应')
  const page = objectOf(payload.page ?? payload, '方法设置分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('方法设置分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingHatchManageMethodQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    classification: queryValueOf(query.classification, '方法归类'),
    search: formTextOf(query.search, '方法名称'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createFormOf (value: unknown): ProductSettingHatchManageMethodCreateDraft {
  const form = objectOf(value, '方法设置新建表单')
  return {
    id: undefined,
    traitType: requiredTraitTypeOf(form.traitType, '方法归类'),
    name: requiredTextOf(form.name, '名称'),
    title1: requiredTextOf(form.title1, '一级标题'),
    title2: requiredTextOf(form.title2, '二级标题'),
    title3: requiredTextOf(form.title3, '三级标题'),
  }
}

function updateFormOf (value: unknown): ProductSettingHatchManageMethodUpdateDraft {
  const form = objectOf(value, '方法设置编辑表单')
  const traitType = form.traitType === undefined || form.traitType === null || form.traitType === '' ? form.classification : form.traitType
  const name = form.name === undefined || form.name === null || form.name === '' ? form.traitName : form.name
  return {
    ...form,
    id: optionalIdOf(form.id, '方法设置ID'),
    traitType: requiredTraitTypeOf(traitType, '方法归类'),
    name: requiredTextOf(name, '名称'),
    title1: requiredTextOf(form.title1, '一级标题'),
    title2: requiredTextOf(form.title2, '二级标题'),
    title3: requiredTextOf(form.title3, '三级标题'),
  }
}

function removeIdOf (value: unknown): ProductSettingHatchManageMethodId {
  return idOf(value, '方法设置ID')
}

/** The injected request must use PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH as page context. */
export function createProductSettingHatchManageMethodCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingHatchManageMethodQuery = {}): Promise<ProductSettingHatchManageMethodPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchManageMethodCreateForm): { draft: ProductSettingHatchManageMethodCreateDraft } {
      return { draft: createFormOf(form) }
    },

    async create (input: { draft: ProductSettingHatchManageMethodCreateDraft }): Promise<true> {
      const draft = createFormOf(input?.draft)
      await request({ url: CREATE_URL, method: 'post', data: draft })
      return true
    },

    prepareUpdate (form: ProductSettingHatchManageMethodUpdateForm): { draft: ProductSettingHatchManageMethodUpdateDraft } {
      return { draft: updateFormOf(form) }
    },

    async update (input: { draft: ProductSettingHatchManageMethodUpdateDraft }): Promise<true> {
      const draft = updateFormOf(input?.draft)
      await request({ url: UPDATE_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: { id: ProductSettingHatchManageMethodId }): { id: ProductSettingHatchManageMethodId } {
      return { id: removeIdOf(input?.id) }
    },

    async remove (input: { id: ProductSettingHatchManageMethodId }): Promise<true> {
      const id = removeIdOf(input?.id)
      await request({ url: DELETE_URL, method: 'get', params: { id } })
      return true
    },
  }
}

export type ProductSettingHatchManageMethodCapability = ReturnType<typeof createProductSettingHatchManageMethodCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_MANAGE_METHOD_METHODS = {
  'product-setting-hatch-manage-method-list': 'list',
  'product-setting-hatch-manage-method-prepare-create': 'prepareCreate',
  'product-setting-hatch-manage-method-create': 'create',
  'product-setting-hatch-manage-method-prepare-update': 'prepareUpdate',
  'product-setting-hatch-manage-method-update': 'update',
  'product-setting-hatch-manage-method-prepare-remove': 'prepareRemove',
  'product-setting-hatch-manage-method-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '方法设置新建弹窗表单；方法归类、名称、一级标题、二级标题、三级标题均必填' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '方法设置编辑弹窗提交对象；来自当前列表行并覆盖方法归类、名称和三级标题字段' }

export const productSettingHatchManageMethodCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-manage-method-list', title: '查询方法设置', write: false, params: [p('classification', 'text', false, '方法归类字典值；省略时按Portal发送空字符串'), p('search', 'text', false, '方法名称或编码前缀；省略时发送空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-hatch-manage-method-prepare-create', title: '准备新建方法设置', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-manage-method-create', title: '新建方法设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的方法设置新建草稿')] },
  { id: 'product-setting-hatch-manage-method-prepare-update', title: '准备编辑方法设置', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-manage-method-update', title: '编辑方法设置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的编辑草稿；会保留Portal编辑提交对象中的扩展字段')] },
  { id: 'product-setting-hatch-manage-method-prepare-remove', title: '准备删除方法设置', write: false, params: [p('id', 'text', true, '当前列表行的ProgramUnit方法记录ID')] },
  { id: 'product-setting-hatch-manage-method-remove', title: '删除方法设置', write: true, params: [p('id', 'text', true, 'prepareRemove返回的方法记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_MANAGE_METHOD_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_MANAGE_METHOD_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_MANAGE_METHOD_MODULE_TYPE,
  httpInstance: 'product',
}))
