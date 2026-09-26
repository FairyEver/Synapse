import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 药品管理」。 */
export const PRODUCT_SETTING_MEDICINE_PAGE_PATH = '/dashboard/product/setting/base-setting/medicine/list'
export const PRODUCT_SETTING_MEDICINE_PERMISSION = '/dashboard/frame/base-setting/medicine'
export const PRODUCT_SETTING_MEDICINE_MODULE_TYPE = null
export const PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION = 'base:medicine:query'
export const PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION = 'base:medicine:submit'

const PAGE_URL = '/config/medicine/page'
const SAVE_URL = '/config/medicine/save'
const REMOVE_URL = '/config/medicine/delete'

export type ProductSettingMedicineId = string | number
export type ProductSettingMedicineType = 1 | 2

export type ProductSettingMedicineQuery = {
  type?: ProductSettingMedicineType | '1' | '2' | '' | null
  factory?: string | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingMedicineRow = Record<string, unknown> & {
  id: ProductSettingMedicineId | null
  type: number | null
  purpose: string | null
  medicineGroup: string | null
  element: string | null
  factory: string | null
  supplier: string | null
  name: string | null
  measureUnit: string | null
  unit: string | null
}

export type ProductSettingMedicineSaveDraft = {
  id: ProductSettingMedicineId | ''
  type: ProductSettingMedicineType
  purpose: string
  medicineGroup: string
  element: string
  factory: string
  supplier: string
  name: string
}

export type ProductSettingMedicinePage = {
  list: ProductSettingMedicineRow[]
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

function optionalTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  const text = textOf(value, label)
  return text ?? ''
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingMedicineId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function saveIdOf (value: unknown): ProductSettingMedicineId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, '药品ID')
}

function typeOf (value: unknown, label: string): ProductSettingMedicineType {
  const type = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (type === 1 || type === 2) return type
  throw new Error(`${label}只能是1（兽药）或2（消毒药）`)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function nullableIdOf (value: unknown, label: string): ProductSettingMedicineId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function rowOf (value: unknown, index: number): ProductSettingMedicineRow {
  const row = objectOf(value, `药品列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `药品列表[${index}].id`),
    type: nullableIntegerOf(row.type, `药品列表[${index}].type`),
    purpose: textOf(row.purpose, `药品列表[${index}].purpose`),
    medicineGroup: textOf(row.medicineGroup, `药品列表[${index}].medicineGroup`),
    element: textOf(row.element, `药品列表[${index}].element`),
    factory: textOf(row.factory, `药品列表[${index}].factory`),
    supplier: textOf(row.supplier, `药品列表[${index}].supplier`),
    name: textOf(row.name, `药品列表[${index}].name`),
    measureUnit: textOf(row.measureUnit, `药品列表[${index}].measureUnit`),
    unit: textOf(row.unit, `药品列表[${index}].unit`),
  }
}

function pageOf (value: unknown): ProductSettingMedicinePage {
  const envelope = objectOf(value, '药品分页响应')
  const page = objectOf(envelope.page ?? envelope, '药品分页响应.page')
  const list = page.list || []
  const total = page.total || 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('药品分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingMedicineQuery = {}): JsonObject {
  const type = query.type === undefined || query.type === null ? '' : query.type
  if (type !== '' && type !== 1 && type !== 2 && type !== '1' && type !== '2') throw new Error('药物类型只能是1、2或空字符串')
  return {
    order: '',
    orderField: '',
    type: type === 1 ? '1' : type === 2 ? '2' : type,
    factory: textOf(query.factory, '生产厂家') ?? '',
    name: textOf(query.name, '药物名称') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function formOf (value: unknown): ProductSettingMedicineSaveDraft {
  const form = objectOf(value, '药品表单')
  return {
    id: saveIdOf(form.id),
    type: typeOf(form.type, '药物类型'),
    purpose: requiredTextOf(form.purpose, '使用途径'),
    medicineGroup: optionalTextOf(form.medicineGroup, '药物分组'),
    element: optionalTextOf(form.element, '成份'),
    factory: requiredTextOf(form.factory, '生产厂家'),
    supplier: optionalTextOf(form.supplier, '供应商'),
    name: requiredTextOf(form.name, '药物名称'),
  }
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_SETTING_MEDICINE_PAGE_PATH as its page context. */
export function createProductSettingMedicineCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingMedicineQuery = {}): Promise<ProductSettingMedicinePage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareSave (input: ProductSettingMedicineSaveDraft): { draft: ProductSettingMedicineSaveDraft } {
      return { draft: formOf(input) }
    },

    async save (input: { draft: ProductSettingMedicineSaveDraft }): Promise<true> {
      const draft = formOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },

    async remove (input: { id: ProductSettingMedicineId }): Promise<true> {
      const id = idOf(input?.id, '药品ID')
      return trueAfterRequest(request({ url: REMOVE_URL, method: 'delete', params: { id } }))
    },
  }
}

export type ProductSettingMedicineCapability = ReturnType<typeof createProductSettingMedicineCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_MEDICINE_METHODS = {
  'product-setting-medicine-list': 'list',
  'product-setting-medicine-prepare-save': 'prepareSave',
  'product-setting-medicine-save': 'save',
  'product-setting-medicine-remove': 'remove',
} as const

export const productSettingMedicineCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-medicine-list', title: '查询产品设置药品', write: false, params: [p('type', 'enum', false, '药物类型；1兽药、2消毒药，默认页面值1'), p('factory', 'text', false, '生产厂家筛选；默认空字符串'), p('name', 'text', false, '药物名称筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-medicine-prepare-save', title: '准备保存产品设置药品', write: false, params: [p('form', 'text', true, 'Portal药品弹窗表单；类型、使用途径、生产厂家和药物名称必填')] },
  { id: 'product-setting-medicine-save', title: '保存产品设置药品', write: true, params: [p('draft', 'text', true, 'prepareSave返回的完整八字段草稿；取消时丢弃，不调用保存接口')] },
  { id: 'product-setting-medicine-remove', title: '删除产品设置药品', write: true, params: [p('id', 'text', true, '当前列表行record.id；按Portal发送DELETE查询参数')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_MEDICINE_PAGE_PATH,
  permission: PRODUCT_SETTING_MEDICINE_PERMISSION,
  moduleType: PRODUCT_SETTING_MEDICINE_MODULE_TYPE,
  httpInstance: 'product',
}))
