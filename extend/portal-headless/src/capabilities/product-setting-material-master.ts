import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 物料主数据」。 */
export const PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH = '/dashboard/product/setting/business-manage/material/list'
export const PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION = '/dashboard/frame/business/material'
export const PRODUCT_SETTING_MATERIAL_MASTER_MODULE_TYPE = null
export const PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION = 'base:material:submit'

const PAGE_URL = '/base/material/page'
const SAVE_URL = '/base/material/save'
const REMOVE_URL = '/base/material/delete'

export type ProductSettingMaterialMasterId = string | number

export type ProductSettingMaterialMasterQuery = {
  materialDescription?: string | null
  materialCode?: string | null
  materialGroup?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingMaterialMasterRow = Record<string, unknown> & {
  id: ProductSettingMaterialMasterId | null
  materialDescription: string | null
  materialCode: string | null
  materialGroup: string | null
  specification: string | null
  measureUnit: string | null
  type: number | null
  isSystem: number | null
  supplier: string | null
  image: string | null
  remark: string | null
  createDate: string | null
  updateDate: string | null
  delFlag: number | null
}

export type ProductSettingMaterialMasterSaveForm = {
  id?: ProductSettingMaterialMasterId | null | ''
  materialDescription: string
  materialCode: string
  materialGroup: string
  specification: string
  measureUnit: string
}

export type ProductSettingMaterialMasterSaveDraft = ProductSettingMaterialMasterSaveForm

export type ProductSettingMaterialMasterPage = {
  list: ProductSettingMaterialMasterRow[]
  total: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingMaterialMasterId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingMaterialMasterId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function saveIdOf (value: unknown, label: string): ProductSettingMaterialMasterId | null | '' | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return value
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredFormTextOf (value: unknown, label: string): string {
  const text = formTextOf(value, label)
  if (text.length === 0) throw new Error(`${label}不能为空`)
  return text
}

function maxLengthOf (value: string, max: number, label: string): string {
  if (value.length > max) throw new Error(`${label}最多${max}个字符`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function rowOf (value: unknown, index: number): ProductSettingMaterialMasterRow {
  const row = objectOf(value, `物料主数据列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `物料主数据列表[${index}].id`),
    materialDescription: textOf(row.materialDescription, `物料主数据列表[${index}].materialDescription`),
    materialCode: textOf(row.materialCode, `物料主数据列表[${index}].materialCode`),
    materialGroup: textOf(row.materialGroup, `物料主数据列表[${index}].materialGroup`),
    specification: textOf(row.specification, `物料主数据列表[${index}].specification`),
    measureUnit: textOf(row.measureUnit, `物料主数据列表[${index}].measureUnit`),
    type: integerOf(row.type, `物料主数据列表[${index}].type`),
    isSystem: integerOf(row.isSystem, `物料主数据列表[${index}].isSystem`),
    supplier: textOf(row.supplier, `物料主数据列表[${index}].supplier`),
    image: textOf(row.image, `物料主数据列表[${index}].image`),
    remark: textOf(row.remark, `物料主数据列表[${index}].remark`),
    createDate: textOf(row.createDate, `物料主数据列表[${index}].createDate`),
    updateDate: textOf(row.updateDate, `物料主数据列表[${index}].updateDate`),
    delFlag: integerOf(row.delFlag, `物料主数据列表[${index}].delFlag`),
  }
}

function pageOf (value: unknown): ProductSettingMaterialMasterPage {
  const envelope = objectOf(value, '物料主数据分页响应')
  const page = objectOf(envelope.page ?? envelope, '物料主数据分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('物料主数据分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryOf (query: ProductSettingMaterialMasterQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    materialDescription: formTextOf(query.materialDescription, '物料描述'),
    materialCode: formTextOf(query.materialCode, '物料编码'),
    materialGroup: formTextOf(query.materialGroup, '物料组'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function formOf (value: unknown): ProductSettingMaterialMasterSaveDraft {
  const form = objectOf(value, '物料主数据表单')
  const materialDescription = maxLengthOf(requiredFormTextOf(form.materialDescription, '物料描述'), 100, '物料描述')
  const materialCode = maxLengthOf(requiredFormTextOf(form.materialCode, '物料编码'), 9, '物料编码')
  if (!/^\d+$/.test(materialCode)) throw new Error('物料编码必须是数字')
  const materialGroup = maxLengthOf(requiredFormTextOf(form.materialGroup, '物料组'), 50, '物料组')
  if (!/^\S+$/.test(materialGroup)) throw new Error('物料组不能包含空格')
  const specification = maxLengthOf(formTextOf(form.specification, '规格'), 10, '规格')
  const measureUnit = maxLengthOf(formTextOf(form.measureUnit, '基本计量单位'), 10, '基本计量单位')
  return {
    id: saveIdOf(form.id, '物料ID'),
    materialDescription,
    materialCode,
    materialGroup,
    specification,
    measureUnit,
  }
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH as its page context. */
export function createProductSettingMaterialMasterCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingMaterialMasterQuery = {}): Promise<ProductSettingMaterialMasterPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareSave (form: ProductSettingMaterialMasterSaveForm): { draft: ProductSettingMaterialMasterSaveDraft } {
      return { draft: formOf(form) }
    },

    async save (input: { draft: ProductSettingMaterialMasterSaveDraft }): Promise<true> {
      const draft = formOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },

    prepareRemove (input: { id: ProductSettingMaterialMasterId }): { id: ProductSettingMaterialMasterId } {
      return { id: idOf(input?.id, '物料ID') }
    },

    async remove (input: { id: ProductSettingMaterialMasterId }): Promise<true> {
      const id = idOf(input?.id, '物料ID')
      return trueAfterRequest(request({ url: REMOVE_URL, method: 'delete', params: { id } }))
    },
  }
}

export type ProductSettingMaterialMasterCapability = ReturnType<typeof createProductSettingMaterialMasterCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_MATERIAL_MASTER_METHODS = {
  'product-setting-material-master-list': 'list',
  'product-setting-material-master-prepare-save': 'prepareSave',
  'product-setting-material-master-save': 'save',
  'product-setting-material-master-prepare-remove': 'prepareRemove',
  'product-setting-material-master-remove': 'remove',
} as const

export const productSettingMaterialMasterCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-material-master-list', title: '查询物料主数据', write: false, params: [p('materialDescription', 'text', false, '物料描述前缀；默认空字符串'), p('materialCode', 'text', false, '物料编码；默认空字符串'), p('materialGroup', 'text', false, '物料组；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-material-master-prepare-save', title: '准备保存物料主数据', write: false, params: [p('form', 'text', true, 'Portal物料主数据弹窗表单；物料描述、物料编码、物料组必填，规格和基本计量单位最多10个字符')] },
  { id: 'product-setting-material-master-save', title: '保存物料主数据', write: true, params: [p('draft', 'text', true, 'prepareSave返回的六字段草稿；确认后原样提交')] },
  { id: 'product-setting-material-master-prepare-remove', title: '准备删除物料主数据', write: false, params: [p('id', 'text', true, '当前列表行物料ID')] },
  { id: 'product-setting-material-master-remove', title: '删除物料主数据', write: true, params: [p('id', 'text', true, 'prepareRemove返回的物料ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH,
  permission: PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION,
  moduleType: PRODUCT_SETTING_MATERIAL_MASTER_MODULE_TYPE,
  httpInstance: 'product',
}))
