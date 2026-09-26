import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 业务管理 → 配置指标」。 */
export const PRODUCT_SETTING_CONFIGURE_PAGE_PATH = '/dashboard/product/setting/business-manage/configure/list'
export const PRODUCT_SETTING_CONFIGURE_PERMISSION = '/dashboard/frame/business/configure'
export const PRODUCT_SETTING_CONFIGURE_MODULE_TYPE = null
export const PRODUCT_SETTING_CONFIGURE_QUERY_PERMISSION = 'broiler:configtest:query'
export const PRODUCT_SETTING_CONFIGURE_EDIT_PERMISSION = 'broiler:configtest:edit'
export const PRODUCT_SETTING_CONFIGURE_DELETE_PERMISSION = 'broiler:configtest:delete'

const LIST_URL = '/config/traitIndex'
const DETAIL_URL = '/config/traitIndex'
const SAVE_URL = '/config/traitIndex'

export type ProductSettingConfigureId = string | number
export type ProductSettingConfigureScalar = string | number

export type ProductSettingConfigureRow = Record<string, unknown> & {
  id: ProductSettingConfigureId | null
  code: string | null
  name: string | null
  fieldType: number | null
  multipleAttribute: number | null
  decimalPlace: number | null
  unit: string | null
  general: number | null
  defaultValue: string | null
  required: number | null
  maxValue: number | null
  minValue: number | null
  dateType: string | null
  dicts: string | null
  createDate: string | null
  updateDate: string | null
  remarks: string | null
  delFlag: number | null
  type: number | null
}

export type ProductSettingConfigureListQuery = {
  name?: string | null
}

export type ProductSettingConfigureUpdateDraft = {
  id: ProductSettingConfigureId
  type: 1
  code: string
  name: string
  fieldType: string
  multipleAttribute: ProductSettingConfigureScalar
  defaultValue: string
  minValue: ProductSettingConfigureScalar
  maxValue: ProductSettingConfigureScalar
  decimalPlace: number
  required: ProductSettingConfigureScalar
  unit: string
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

function scalarOf (value: unknown, label: string): ProductSettingConfigureScalar {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串或数字`)
}

function requiredScalarOf (value: unknown, label: string): ProductSettingConfigureScalar {
  const scalar = scalarOf(value, label)
  if (typeof scalar === 'string' && scalar.trim() === '') throw new Error(`${label}不能为空`)
  return scalar
}

function idOf (value: unknown, label: string): ProductSettingConfigureId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingConfigureId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function portalNumberOf (value: unknown, fallback: ProductSettingConfigureScalar, label: string): ProductSettingConfigureScalar {
  const candidate = value === undefined || value === null ? fallback : value
  if (!((typeof candidate === 'string' || typeof candidate === 'number') && (Number(candidate) || candidate === '0' || candidate === '' || candidate === 0))) {
    throw new Error(`${label}必须为数字`)
  }
  return candidate as ProductSettingConfigureScalar
}

function decimalPlaceOf (value: unknown): number {
  const result = value === undefined || value === null ? 0 : value
  if (!Number.isSafeInteger(result) || (result as number) < 0) throw new Error('小数位数必须为非负整数')
  return result as number
}

function rowOf (value: unknown, index: number): ProductSettingConfigureRow {
  const row = objectOf(value, `配置指标列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `配置指标列表[${index}].id`),
    code: textOf(row.code, `配置指标列表[${index}].code`),
    name: textOf(row.name, `配置指标列表[${index}].name`),
    fieldType: integerOf(row.fieldType, `配置指标列表[${index}].fieldType`),
    multipleAttribute: integerOf(row.multipleAttribute, `配置指标列表[${index}].multipleAttribute`),
    decimalPlace: integerOf(row.decimalPlace, `配置指标列表[${index}].decimalPlace`),
    unit: textOf(row.unit, `配置指标列表[${index}].unit`),
    general: integerOf(row.general, `配置指标列表[${index}].general`),
    defaultValue: textOf(row.defaultValue, `配置指标列表[${index}].defaultValue`),
    required: integerOf(row.required, `配置指标列表[${index}].required`),
    maxValue: integerOf(row.maxValue, `配置指标列表[${index}].maxValue`),
    minValue: integerOf(row.minValue, `配置指标列表[${index}].minValue`),
    dateType: textOf(row.dateType, `配置指标列表[${index}].dateType`),
    dicts: textOf(row.dicts, `配置指标列表[${index}].dicts`),
    createDate: textOf(row.createDate, `配置指标列表[${index}].createDate`),
    updateDate: textOf(row.updateDate, `配置指标列表[${index}].updateDate`),
    remarks: textOf(row.remarks, `配置指标列表[${index}].remarks`),
    delFlag: integerOf(row.delFlag, `配置指标列表[${index}].delFlag`),
    type: integerOf(row.type, `配置指标列表[${index}].type`),
  }
}

function listOf (value: unknown): ProductSettingConfigureRow[] {
  const envelope = Array.isArray(value) ? value : objectOf(value, '配置指标列表响应')
  const page = !Array.isArray(envelope) && envelope.page !== undefined ? objectOf(envelope.page, '配置指标列表响应.page') : envelope
  const list = Array.isArray(page) ? page : page.list || page.records || page.rows
  if (!Array.isArray(list)) throw new Error('配置指标列表响应缺少数组')
  return list.map((item, index) => rowOf(item, index))
}

function detailOf (value: unknown): ProductSettingConfigureRow {
  let current: unknown = value
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const envelope = current as JsonObject
    if (envelope.data !== undefined && envelope.data !== null && typeof envelope.data === 'object') current = envelope.data
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const envelope = current as JsonObject
    if (envelope.traitIndex !== undefined) current = envelope.traitIndex
  }
  return rowOf(current, 0)
}

function updateOf (value: unknown): ProductSettingConfigureUpdateDraft {
  const form = objectOf(value, '配置指标编辑表单')
  const id = idOf(form.id, '配置指标ID')
  return {
    id,
    type: 1,
    code: requiredTextOf(form.code, '字段编码'),
    name: requiredTextOf(form.name, '字段名称'),
    fieldType: requiredTextOf(typeof form.fieldType === 'number' ? String(form.fieldType) : form.fieldType, '字段类型'),
    multipleAttribute: requiredScalarOf(form.multipleAttribute, '字段属性'),
    defaultValue: form.defaultValue === undefined || form.defaultValue === null ? '' : textOf(form.defaultValue, '默认数值') ?? '',
    minValue: portalNumberOf(form.minValue, '0', '最小数值'),
    maxValue: portalNumberOf(form.maxValue, '', '最大数值'),
    decimalPlace: decimalPlaceOf(form.decimalPlace),
    required: form.required === undefined || form.required === null ? '1' : scalarOf(form.required, '默认展开'),
    unit: form.unit === undefined || form.unit === null ? '' : textOf(form.unit, '字段单位') ?? '',
  }
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_SETTING_CONFIGURE_PAGE_PATH as its page context. */
export function createProductSettingConfigureCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingConfigureListQuery = {}): Promise<ProductSettingConfigureRow[]> {
      return listOf(await request({
        url: LIST_URL,
        method: 'get',
        params: { order: '', orderField: '', name: textOf(query.name, '指标名') ?? '', type: 1 },
      }))
    },

    async get (input: { id: ProductSettingConfigureId }): Promise<ProductSettingConfigureRow> {
      const id = idOf(input?.id, '配置指标ID')
      return detailOf(await request({ url: `${DETAIL_URL}/${id}`, method: 'get' }))
    },

    prepareUpdate (input: ProductSettingConfigureUpdateDraft): { draft: ProductSettingConfigureUpdateDraft } {
      return { draft: updateOf(input) }
    },

    async update (input: { draft: ProductSettingConfigureUpdateDraft }): Promise<true> {
      const draft = updateOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },
  }
}

export type ProductSettingConfigureCapability = ReturnType<typeof createProductSettingConfigureCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })

export const PRODUCT_SETTING_CONFIGURE_METHODS = {
  'product-setting-configure-list': 'list',
  'product-setting-configure-get': 'get',
  'product-setting-configure-prepare-update': 'prepareUpdate',
  'product-setting-configure-update': 'update',
} as const

export const productSettingConfigureCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-configure-list', title: '查询配置指标', write: false, params: [p('name', 'text', false, '指标名或编码前缀；默认空字符串')] },
  { id: 'product-setting-configure-get', title: '读取配置指标详情', write: false, params: [p('id', 'text', true, '当前列表行配置指标ID')] },
  { id: 'product-setting-configure-prepare-update', title: '准备编辑配置指标', write: false, params: [p('form', 'text', true, '当前详情与用户编辑后的表单')] },
  { id: 'product-setting-configure-update', title: '编辑配置指标', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整编辑草稿')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_CONFIGURE_PAGE_PATH,
  permission: PRODUCT_SETTING_CONFIGURE_PERMISSION,
  moduleType: PRODUCT_SETTING_CONFIGURE_MODULE_TYPE,
  httpInstance: 'product',
}))
