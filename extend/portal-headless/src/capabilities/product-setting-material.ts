import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 物料管理」。 */
export const PRODUCT_SETTING_MATERIAL_PAGE_PATH = '/dashboard/product/setting/base-setting/material/list'
export const PRODUCT_SETTING_MATERIAL_PERMISSION = '/dashboard/frame/base-setting/material'
export const PRODUCT_SETTING_MATERIAL_MODULE_TYPE = null
export const PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION = 'management:material:query'
export const PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION = 'management:material:submit'
export const PRODUCT_SETTING_MATERIAL_BACK_PERMISSION = 'management:material:back'

const PAGE_URL = '/base/material/page/external'
const SAVE_URL = '/base/material/userMaterialSave'
const REMOVE_URL = '/base/material/userMaterialDelete'
const ENABLE_URL = '/base/material/enable'
const DEACTIVATE_URL = '/base/material/deactivate'

export type ProductSettingMaterialId = string | number
export type ProductSettingMaterialType = string | number

export type ProductSettingMaterialQuery = {
  materialDescription?: string | null
  type?: ProductSettingMaterialType | '' | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingMaterialRow = Record<string, unknown> & {
  id: ProductSettingMaterialId | null
  materialDescription: string | null
  type: number | string | null
  typeStr: string | null
  supplier: string | null
  image: string | null
  measureUnit: string | null
  status: number | null
}

export type ProductSettingMaterialSaveDraft = {
  id: ProductSettingMaterialId | ''
  materialDescription: string
  supplier: string
  type: string
  image: string
  measureUnit: string
}

export type ProductSettingMaterialPage = {
  list: ProductSettingMaterialRow[]
  total: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingMaterialId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function saveIdOf (value: unknown): ProductSettingMaterialId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, '物料ID')
}

function typeOf (value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  throw new Error(`${label}不能为空`)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function nullableIdOf (value: unknown, label: string): ProductSettingMaterialId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function rowOf (value: unknown, index: number): ProductSettingMaterialRow {
  const row = objectOf(value, `物料列表[${index}]`)
  const type = row.type === undefined || row.type === null || row.type === ''
    ? null
    : typeof row.type === 'number' || typeof row.type === 'string'
      ? row.type
      : (() => { throw new Error(`物料列表[${index}].type必须为字符串、数字或null`) })()
  return {
    ...row,
    id: nullableIdOf(row.id, `物料列表[${index}].id`),
    materialDescription: textOf(row.materialDescription, `物料列表[${index}].materialDescription`),
    type,
    typeStr: textOf(row.typeStr, `物料列表[${index}].typeStr`),
    supplier: textOf(row.supplier, `物料列表[${index}].supplier`),
    image: textOf(row.image, `物料列表[${index}].image`),
    measureUnit: textOf(row.measureUnit, `物料列表[${index}].measureUnit`),
    status: nullableIntegerOf(row.status, `物料列表[${index}].status`),
  }
}

function pageOf (value: unknown): ProductSettingMaterialPage {
  const envelope = objectOf(value, '物料分页响应')
  const page = objectOf(envelope.page ?? envelope, '物料分页响应.page')
  const list = page.list || page.records || page.rows || []
  const total = page.total || page.count || 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('物料分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingMaterialQuery = {}): JsonObject {
  const type = query.type === undefined || query.type === null ? '' : query.type
  if (type !== '' && typeof type !== 'string' && (typeof type !== 'number' || !Number.isSafeInteger(type))) throw new Error('物料类型必须为字符串、整数或空字符串')
  return {
    order: '',
    orderField: '',
    materialDescription: textOf(query.materialDescription, '物料名称') ?? '',
    type,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function formOf (value: unknown): ProductSettingMaterialSaveDraft {
  const form = objectOf(value, '物料表单')
  const materialDescription = requiredTextOf(form.materialDescription, '物料名称')
  const type = typeOf(form.type, '物料类型')
  const measureUnit = requiredTextOf(form.measureUnit, '物料规格')
  if (measureUnit.length > 10) throw new Error('物料规格最多10个字符')
  const supplier = requiredTextOf(form.supplier, '供应商名称')
  const image = form.image === undefined || form.image === null ? '' : textOf(form.image, '图片')
  if (image === null) throw new Error('图片必须为字符串或null')
  return {
    id: saveIdOf(form.id),
    materialDescription,
    supplier,
    type,
    image,
    measureUnit,
  }
}

function idListOf (value: unknown): ProductSettingMaterialId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('物料ID数组必须为非空数组')
  return value.map((item, index) => idOf(item, `物料ID数组[${index}]`))
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_SETTING_MATERIAL_PAGE_PATH as its page context. */
export function createProductSettingMaterialCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingMaterialQuery = {}): Promise<ProductSettingMaterialPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareSave (input: ProductSettingMaterialSaveDraft): { draft: ProductSettingMaterialSaveDraft } {
      return { draft: formOf(input) }
    },

    async save (input: { draft: ProductSettingMaterialSaveDraft }): Promise<true> {
      const draft = formOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },

    async removeBatch (input: { ids: ProductSettingMaterialId[] }): Promise<true> {
      const ids = idListOf(input?.ids)
      return trueAfterRequest(request({ url: REMOVE_URL, method: 'get', params: { materialIdList: ids.join(',') } }))
    },

    async enable (input: { materialId: ProductSettingMaterialId }): Promise<true> {
      const materialId = idOf(input?.materialId, '物料ID')
      return trueAfterRequest(request({ url: ENABLE_URL, method: 'get', params: { materialId } }))
    },

    async deactivate (input: { materialId: ProductSettingMaterialId }): Promise<true> {
      const materialId = idOf(input?.materialId, '物料ID')
      return trueAfterRequest(request({ url: DEACTIVATE_URL, method: 'get', params: { materialId } }))
    },
  }
}

export type ProductSettingMaterialCapability = ReturnType<typeof createProductSettingMaterialCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_MATERIAL_METHODS = {
  'product-setting-material-list': 'list',
  'product-setting-material-prepare-save': 'prepareSave',
  'product-setting-material-save': 'save',
  'product-setting-material-remove-batch': 'removeBatch',
  'product-setting-material-enable': 'enable',
  'product-setting-material-deactivate': 'deactivate',
} as const

export const productSettingMaterialCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-material-list', title: '查询产品设置物料', write: false, params: [p('materialDescription', 'text', false, '物料名称筛选；默认空字符串'), p('type', 'text', false, '物料类型字典值；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-material-prepare-save', title: '准备保存产品设置物料', write: false, params: [p('form', 'text', true, 'Portal物料弹窗表单；物料名称、类型、规格和供应商必填，规格最多10个字符，图片可为空')] },
  { id: 'product-setting-material-save', title: '保存产品设置物料', write: true, params: [p('draft', 'text', true, 'prepareSave返回的完整六字段草稿；取消时丢弃，不调用保存接口')] },
  { id: 'product-setting-material-remove-batch', title: '批量删除产品设置物料', write: true, params: [p('ids', 'text', true, '列表勾选的物料ID数组；SDK按Portal join为逗号字符串')] },
  { id: 'product-setting-material-enable', title: '启用产品设置物料', write: true, params: [p('materialId', 'text', true, '当前列表行id')] },
  { id: 'product-setting-material-deactivate', title: '停用产品设置物料', write: true, params: [p('materialId', 'text', true, '当前列表行id；后端在物料已被使用时可能拒绝停用')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_MATERIAL_PAGE_PATH,
  permission: PRODUCT_SETTING_MATERIAL_PERMISSION,
  moduleType: PRODUCT_SETTING_MATERIAL_MODULE_TYPE,
  httpInstance: 'product',
}))
