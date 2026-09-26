import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 疫苗管理」。 */
export const PRODUCT_SETTING_VACCINE_PAGE_PATH = '/dashboard/product/setting/base-setting/vaccine/list'
export const PRODUCT_SETTING_VACCINE_PERMISSION = '/dashboard/frame/base-setting/vaccine'
export const PRODUCT_SETTING_VACCINE_MODULE_TYPE = null
export const PRODUCT_SETTING_VACCINE_QUERY_PERMISSION = 'base:vaccine:query'
export const PRODUCT_SETTING_VACCINE_SUBMIT_PERMISSION = 'base:vaccine:submit'

const PAGE_URL = '/config/vaccine/page'
const SAVE_URL = '/config/vaccine/save'
const REMOVE_URL = '/config/vaccine/delete'

export type ProductSettingVaccineId = string | number
export type ProductSettingVaccineImported = 0 | 1

export type ProductSettingVaccineQuery = {
  diseaseName?: string | null
  vaccineName?: string | null
  antibody?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingVaccineRow = Record<string, unknown> & {
  id: ProductSettingVaccineId | null
  diseaseName: string | null
  vaccineName: string | null
  imported: ProductSettingVaccineImported | null
  strain: string | null
  manufacturer: string | null
  antibody: string | null
  updateDate: string | null
  createDate: string | null
  sapDescription: string | null
  sapCode: string | null
  unit: string | null
}

export type ProductSettingVaccineSaveDraft = {
  id: ProductSettingVaccineId | ''
  diseaseName: string
  vaccineName: string
  imported: ProductSettingVaccineImported
  strain: string
  manufacturer: string
  antibody: string
}

export type ProductSettingVaccinePage = {
  list: ProductSettingVaccineRow[]
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
  return textOf(value, label) ?? ''
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingVaccineId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function saveIdOf (value: unknown): ProductSettingVaccineId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, '疫苗ID')
}

function importedOf (value: unknown, label: string): ProductSettingVaccineImported {
  if (value === 0 || value === 1) return value
  throw new Error(`${label}只能是0（国产）或1（进口）`)
}

function nullableImportedOf (value: unknown, label: string): ProductSettingVaccineImported | null {
  if (value === undefined || value === null || value === '') return null
  return importedOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingVaccineQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    diseaseName: textOf(query.diseaseName, '疾病名称') ?? '',
    vaccineName: textOf(query.vaccineName, '疫苗名称') ?? '',
    antibody: textOf(query.antibody, '抗体') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingVaccineRow {
  const row = objectOf(value, `疫苗列表[${index}]`)
  return {
    ...row,
    id: row.id === undefined || row.id === null || row.id === '' ? null : idOf(row.id, `疫苗列表[${index}].id`),
    diseaseName: textOf(row.diseaseName, `疫苗列表[${index}].diseaseName`),
    vaccineName: textOf(row.vaccineName, `疫苗列表[${index}].vaccineName`),
    imported: nullableImportedOf(row.imported, `疫苗列表[${index}].imported`),
    strain: textOf(row.strain, `疫苗列表[${index}].strain`),
    manufacturer: textOf(row.manufacturer, `疫苗列表[${index}].manufacturer`),
    antibody: textOf(row.antibody, `疫苗列表[${index}].antibody`),
    updateDate: textOf(row.updateDate, `疫苗列表[${index}].updateDate`),
    createDate: textOf(row.createDate, `疫苗列表[${index}].createDate`),
    sapDescription: textOf(row.sapDescription, `疫苗列表[${index}].sapDescription`),
    sapCode: textOf(row.sapCode, `疫苗列表[${index}].sapCode`),
    unit: textOf(row.unit, `疫苗列表[${index}].unit`),
  }
}

function pageOf (value: unknown): ProductSettingVaccinePage {
  const envelope = objectOf(value, '疫苗分页响应')
  const page = objectOf(envelope.page ?? envelope, '疫苗分页响应.page')
  const list = page.list || page.records || page.rows || []
  const total = page.total || page.count || 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('疫苗分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function formOf (value: unknown): ProductSettingVaccineSaveDraft {
  const form = objectOf(value, '疫苗表单')
  return {
    id: saveIdOf(form.id),
    diseaseName: requiredTextOf(form.diseaseName, '疾病名称'),
    vaccineName: requiredTextOf(form.vaccineName, '疫苗名称'),
    imported: importedOf(form.imported, '进口国产'),
    strain: requiredTextOf(form.strain, '毒株'),
    manufacturer: requiredTextOf(form.manufacturer, '生产厂家'),
    antibody: optionalTextOf(form.antibody, '抗体'),
  }
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_SETTING_VACCINE_PAGE_PATH as its page context. */
export function createProductSettingVaccineCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingVaccineQuery = {}): Promise<ProductSettingVaccinePage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareSave (input: ProductSettingVaccineSaveDraft): { draft: ProductSettingVaccineSaveDraft } {
      return { draft: formOf(input) }
    },

    async save (input: { draft: ProductSettingVaccineSaveDraft }): Promise<true> {
      const draft = formOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },

    async remove (input: { id: ProductSettingVaccineId }): Promise<true> {
      const id = idOf(input?.id, '疫苗ID')
      return trueAfterRequest(request({ url: REMOVE_URL, method: 'delete', params: { id } }))
    },
  }
}

export type ProductSettingVaccineCapability = ReturnType<typeof createProductSettingVaccineCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_VACCINE_METHODS = {
  'product-setting-vaccine-list': 'list',
  'product-setting-vaccine-prepare-save': 'prepareSave',
  'product-setting-vaccine-save': 'save',
  'product-setting-vaccine-remove': 'remove',
} as const

export const productSettingVaccineCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-vaccine-list', title: '查询产品设置疫苗', write: false, params: [p('diseaseName', 'text', false, '疾病名称筛选；默认空字符串'), p('vaccineName', 'text', false, '疫苗名称筛选；默认空字符串'), p('antibody', 'text', false, '抗体筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-vaccine-prepare-save', title: '准备保存产品设置疫苗', write: false, params: [p('form', 'text', true, 'Portal疫苗弹窗表单；疾病名称、疫苗名称、进口国产、毒株和生产厂家必填，抗体可为空')] },
  { id: 'product-setting-vaccine-save', title: '保存产品设置疫苗', write: true, params: [p('draft', 'text', true, 'prepareSave返回的完整七字段草稿；取消时丢弃，不调用保存接口')] },
  { id: 'product-setting-vaccine-remove', title: '删除产品设置疫苗', write: true, params: [p('id', 'text', true, '当前列表行record.id；按Portal发送DELETE查询参数')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_VACCINE_PAGE_PATH,
  permission: PRODUCT_SETTING_VACCINE_PERMISSION,
  moduleType: PRODUCT_SETTING_VACCINE_MODULE_TYPE,
  httpInstance: 'product',
}))
