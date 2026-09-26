import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 标准设置」。 */
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH = '/dashboard/product/setting/hatch-manage/unit/list'
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_PERMISSION = '/dashboard/frame/breeding-plan/unit'
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_QUERY_PERMISSION = 'program:unit:query'
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_SUBMIT_PERMISSION = 'program:unit:submit'
export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_DELETE_PERMISSION = 'program:unit:delete'

const LIST_URL = '/programUnit/getList'
const CREATE_URL = '/programUnit/add'
const UPDATE_URL = '/programUnit/update'
const DELETE_URL = '/programUnit/delete'

export type ProductSettingHatchManageUnitId = string | number
export type ProductSettingHatchManageUnitContentType = 1 | 2 | 3

export type ProductSettingHatchManageUnitQuery = {
  classification?: string | number | null
  search?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchManageUnitRow = Record<string, unknown> & {
  id: ProductSettingHatchManageUnitId | null
  classification: string | number | null
  traitTypeName: string | null
  name: string | null
  unit: string | null
  code: string | null
  contentType: number | null
  contentTypeName: string | null
  scale: number | null
}

export type ProductSettingHatchManageUnitPage = {
  list: ProductSettingHatchManageUnitRow[]
  total: number
}

export type ProductSettingHatchManageUnitCreateForm = {
  classification: string | number
  contentType: ProductSettingHatchManageUnitContentType
  name: string
  code: string
  unit?: string | null
  scale?: number | null
}

export type ProductSettingHatchManageUnitCreateDraft = {
  id?: undefined
  classification: string | number
  contentType: ProductSettingHatchManageUnitContentType
  name: string
  code: string
  unit: string
  scale: number | ''
}

export type ProductSettingHatchManageUnitUpdateForm = Record<string, unknown> & {
  id?: ProductSettingHatchManageUnitId | null | ''
  classification?: string | number | null
  contentType?: ProductSettingHatchManageUnitContentType | null
  name?: string | null
  code?: string | null
  unit?: string | null
  scale?: number | null
}

export type ProductSettingHatchManageUnitUpdateDraft = Record<string, unknown> & {
  id?: ProductSettingHatchManageUnitId | null | ''
  classification: string | number
  contentType: ProductSettingHatchManageUnitContentType
  name: string
  code: string
  unit: string
  scale: number | ''
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingHatchManageUnitId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchManageUnitId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function optionalIdOf (value: unknown, label: string): ProductSettingHatchManageUnitId | null | undefined | '' {
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

function requiredTextOf (value: unknown, label: string): string {
  const text = formTextOf(value, label)
  if (text.length === 0) throw new Error(`${label}不能为空`)
  return text
}

function requiredClassificationOf (value: unknown): string | number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error('指标归类不能为空')
}

function queryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须为字符串、整数或空值`)
}

function contentTypeOf (value: unknown): ProductSettingHatchManageUnitContentType {
  if (value === 1 || value === 2 || value === 3) return value
  throw new Error('文本类型必须是1（纯文本）、2（富文本）或3（数值）')
}

function scaleOf (value: unknown, contentType: ProductSettingHatchManageUnitContentType): number | '' {
  if (contentType !== 3) return ''
  if (value === undefined || value === null || value === '') throw new Error('小数位数不能为空')
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('小数位数必须是数字')
  return value
}

function unitOf (value: unknown, contentType: ProductSettingHatchManageUnitContentType): string {
  if (contentType !== 3) return ''
  const unit = formTextOf(value, '指标单位')
  if (unit.trim() === '') throw new Error('指标单位不能为空')
  return unit
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function rowOf (value: unknown, index: number): ProductSettingHatchManageUnitRow {
  const row = objectOf(value, `标准设置列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `标准设置列表[${index}].id`),
    classification: row.classification === undefined || row.classification === null || row.classification === '' ? null : queryValueOf(row.classification, `标准设置列表[${index}].classification`),
    traitTypeName: nullableTextOf(row.traitTypeName, `标准设置列表[${index}].traitTypeName`),
    name: nullableTextOf(row.name, `标准设置列表[${index}].name`),
    unit: nullableTextOf(row.unit, `标准设置列表[${index}].unit`),
    code: nullableTextOf(row.code, `标准设置列表[${index}].code`),
    contentType: row.contentType === undefined || row.contentType === null ? null : contentTypeOf(row.contentType),
    contentTypeName: nullableTextOf(row.contentTypeName, `标准设置列表[${index}].contentTypeName`),
    scale: row.scale === undefined || row.scale === null ? null : typeof row.scale === 'number' && Number.isFinite(row.scale) ? row.scale : (() => { throw new Error(`标准设置列表[${index}].scale必须为数字或null`) })(),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined && object.rows === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchManageUnitPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const object = objectOf(payload, '标准设置分页响应')
  const page = objectOf(object.page ?? object, '标准设置分页响应.page')
  const list = page.records ?? page.list ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('标准设置分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingHatchManageUnitQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    classification: queryValueOf(query.classification, '指标归类'),
    search: formTextOf(query.search, '指标名称'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createFormOf (value: unknown): ProductSettingHatchManageUnitCreateDraft {
  const form = objectOf(value, '标准设置新建表单')
  const contentType = contentTypeOf(form.contentType)
  return {
    id: undefined,
    classification: requiredClassificationOf(form.classification),
    contentType,
    name: requiredTextOf(form.name, '指标名称'),
    code: requiredTextOf(form.code, '指标编码'),
    unit: unitOf(form.unit, contentType),
    scale: scaleOf(form.scale, contentType),
  }
}

function updateFormOf (value: unknown): ProductSettingHatchManageUnitUpdateDraft {
  const form = objectOf(value, '标准设置编辑表单')
  const contentType = contentTypeOf(form.contentType)
  return {
    ...form,
    id: optionalIdOf(form.id, '标准设置ID'),
    classification: requiredClassificationOf(form.classification),
    contentType,
    name: requiredTextOf(form.name, '指标名称'),
    code: requiredTextOf(form.code, '指标编码'),
    unit: unitOf(form.unit, contentType),
    scale: scaleOf(form.scale, contentType),
  }
}

function removeIdOf (value: unknown): ProductSettingHatchManageUnitId {
  return idOf(value, '标准设置ID')
}

/** The injected request must use PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH as page context. */
export function createProductSettingHatchManageUnitCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingHatchManageUnitQuery = {}): Promise<ProductSettingHatchManageUnitPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchManageUnitCreateForm): { draft: ProductSettingHatchManageUnitCreateDraft } {
      return { draft: createFormOf(form) }
    },

    async create (input: { draft: ProductSettingHatchManageUnitCreateDraft }): Promise<true> {
      const draft = createFormOf(input?.draft)
      await request({ url: CREATE_URL, method: 'post', data: draft })
      return true
    },

    prepareUpdate (form: ProductSettingHatchManageUnitUpdateForm): { draft: ProductSettingHatchManageUnitUpdateDraft } {
      return { draft: updateFormOf(form) }
    },

    async update (input: { draft: ProductSettingHatchManageUnitUpdateDraft }): Promise<true> {
      const draft = updateFormOf(input?.draft)
      await request({ url: UPDATE_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: { id: ProductSettingHatchManageUnitId }): { id: ProductSettingHatchManageUnitId } {
      return { id: removeIdOf(input?.id) }
    },

    async remove (input: { id: ProductSettingHatchManageUnitId }): Promise<true> {
      const id = removeIdOf(input?.id)
      await request({ url: DELETE_URL, method: 'get', params: { id } })
      return true
    },
  }
}

export type ProductSettingHatchManageUnitCapability = ReturnType<typeof createProductSettingHatchManageUnitCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_MANAGE_UNIT_METHODS = {
  'product-setting-hatch-manage-unit-list': 'list',
  'product-setting-hatch-manage-unit-prepare-create': 'prepareCreate',
  'product-setting-hatch-manage-unit-create': 'create',
  'product-setting-hatch-manage-unit-prepare-update': 'prepareUpdate',
  'product-setting-hatch-manage-unit-update': 'update',
  'product-setting-hatch-manage-unit-prepare-remove': 'prepareRemove',
  'product-setting-hatch-manage-unit-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '标准设置新建弹窗表单；归类、文本类型、名称和编码必填，数值类型还要求单位和小数位数' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '标准设置编辑弹窗提交对象；来自当前列表行并覆盖id、归类、文本类型、名称、编码、单位和小数位数' }

export const productSettingHatchManageUnitCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-manage-unit-list', title: '查询标准设置', write: false, params: [p('classification', 'text', false, '指标归类字典值；省略时按Portal发送空字符串'), p('search', 'text', false, '指标名称或编码前缀；省略时发送空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-hatch-manage-unit-prepare-create', title: '准备新建标准设置', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-manage-unit-create', title: '新建标准设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的标准设置新建草稿')] },
  { id: 'product-setting-hatch-manage-unit-prepare-update', title: '准备编辑标准设置', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-manage-unit-update', title: '编辑标准设置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的编辑草稿；会保留Portal编辑提交对象中的扩展字段')] },
  { id: 'product-setting-hatch-manage-unit-prepare-remove', title: '准备删除标准设置', write: false, params: [p('id', 'text', true, '当前列表行的ProgramUnit记录ID')] },
  { id: 'product-setting-hatch-manage-unit-remove', title: '删除标准设置', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ProgramUnit记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_MANAGE_UNIT_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_MANAGE_UNIT_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_MANAGE_UNIT_MODULE_TYPE,
  httpInstance: 'product',
}))
