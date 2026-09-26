import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 年月指标目标标准」。 */
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH = '/dashboard/product/setting/standard-manage/hatch-annual-monthly/list'
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION = '/dashboard/frame/standard-library/hatch-annual-monthly'
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_QUERY_PERMISSION = 'base:hatch-annual-monthly:query'
export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_SUBMIT_PERMISSION = 'base:hatch-annual-monthly:submit'

const PAGE_URL = '/base/hatchAnnualMonthly/page'
const SAVE_URL = '/base/hatchAnnualMonthly/save'
const DELETE_URL_PREFIX = '/base/hatchAnnualMonthly/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000

export type ProductSettingHatchAnnualMonthlyId = string | number
/** Portal年月类型单选实际发送的值：3年度、1月度。 */
export type ProductSettingHatchAnnualMonthlyType = 1 | 3

export type ProductSettingHatchAnnualMonthlyQuery = {
  hall?: string | number | null
  year?: string | number | null
  month?: number | string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchAnnualMonthlyRow = Record<string, unknown> & {
  id: ProductSettingHatchAnnualMonthlyId | null
  type: number | null
  year: number | null
  month: number | null
  hall: string | null
  hallName: string | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  healthyFemaleRate: number | null
  eggChickRatio: number | null
}

export type ProductSettingHatchAnnualMonthlyPage = {
  list: ProductSettingHatchAnnualMonthlyRow[]
  total: number
}

export type ProductSettingHatchAnnualMonthlyCreateForm = Record<string, unknown> & {
  year: number | string
  month: number | string
  hall: string | number
  healthyFemaleRate: number | string
  eggChickRatio: number | string
  type: ProductSettingHatchAnnualMonthlyType | string | number
}

/** POST /base/hatchAnnualMonthly/save 的新建请求体；健母雏率是Java比例小数。 */
export type ProductSettingHatchAnnualMonthlyCreateDraft = Record<string, unknown> & {
  year: number
  month: number
  hall: string | number
  healthyFemaleRate: number
  eggChickRatio: number
  type: ProductSettingHatchAnnualMonthlyType
}

export type ProductSettingHatchAnnualMonthlyUpdateForm = ProductSettingHatchAnnualMonthlyCreateForm & {
  id?: ProductSettingHatchAnnualMonthlyId | null | ''
}

export type ProductSettingHatchAnnualMonthlyUpdateDraft = Record<string, unknown> & ProductSettingHatchAnnualMonthlyCreateDraft & {
  id: ProductSettingHatchAnnualMonthlyId
}

export type ProductSettingHatchAnnualMonthlyRemoveInput = {
  id?: ProductSettingHatchAnnualMonthlyId | null | ''
}

export type ProductSettingHatchAnnualMonthlyRemoveDraft = {
  id: ProductSettingHatchAnnualMonthlyId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingHatchAnnualMonthlyId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchAnnualMonthlyId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串或数字`)
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function optionalQueryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串、数字或空值`)
  return value
}

function numberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字`)
  return number
}

function boundedNumberOf (value: unknown, label: string, options: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = numberOf(value, label)!
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function requiredFormNumberOf (value: unknown, label: string, options: { min?: number; max?: number } = {}): number {
  return boundedNumberOf(value, label, { required: true, ...options })!
}

function typeOf (value: unknown, label: string, fallback?: ProductSettingHatchAnnualMonthlyType): ProductSettingHatchAnnualMonthlyType {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 1 && number !== 3) throw new Error(`${label}只能是1（月度）或3（年度）`)
  return number as ProductSettingHatchAnnualMonthlyType
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function monthQueryOf (value: unknown): number | string | null {
  if (value === undefined) return 1
  if (value === null || value === '') return null
  return boundedNumberOf(value, '月份', { min: 1, max: 12 })!
}

function queryOf (query: ProductSettingHatchAnnualMonthlyQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    hall: optionalQueryValueOf(query.hall, '孵化厅'),
    year: query.year === undefined || query.year === null ? '' : String(query.year),
    month: monthQueryOf(query.month),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingHatchAnnualMonthlyRow {
  const row = objectOf(value, `年月指标目标标准列表[${index}]`)
  const label = `年月指标目标标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    type: numberOf(row.type, `${label}.type`),
    year: numberOf(row.year, `${label}.year`),
    month: numberOf(row.month, `${label}.month`),
    hall: textOf(row.hall, `${label}.hall`),
    hallName: textOf(row.hallName, `${label}.hallName`),
    healthyFemaleRate: numberOf(row.healthyFemaleRate, `${label}.healthyFemaleRate`),
    eggChickRatio: numberOf(row.eggChickRatio, `${label}.eggChickRatio`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchAnnualMonthlyPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '年月指标目标标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '年月指标目标标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('年月指标目标标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function createDraftOf (value: unknown): ProductSettingHatchAnnualMonthlyCreateDraft {
  const form = objectOf(value, '年月指标目标标准新建表单')
  return {
    year: requiredFormNumberOf(form.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    month: requiredFormNumberOf(form.month, '月度', { min: 1, max: 12 }),
    hall: requiredValueOf(form.hall, '孵化厅'),
    healthyFemaleRate: requiredFormNumberOf(form.healthyFemaleRate, '健母雏率', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }) / 100,
    eggChickRatio: requiredFormNumberOf(form.eggChickRatio, '蛋雏比', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    type: typeOf(form.type, '年月类型'),
  }
}

function payloadNumberOf (value: unknown, label: string): number {
  const number = numberOf(value, label)
  if (number === null) throw new Error(`${label}不能为空`)
  return number
}

function createPayloadOf (value: unknown): ProductSettingHatchAnnualMonthlyCreateDraft {
  const draft = objectOf(value, '年月指标目标标准新建草稿')
  return {
    ...draft,
    year: payloadNumberOf(draft.year, '年度'),
    month: payloadNumberOf(draft.month, '月度'),
    hall: requiredValueOf(draft.hall, '孵化厅'),
    healthyFemaleRate: payloadNumberOf(draft.healthyFemaleRate, '健母雏率'),
    eggChickRatio: payloadNumberOf(draft.eggChickRatio, '蛋雏比'),
    type: typeOf(draft.type, '年月类型'),
  }
}

function updateDraftOf (value: unknown): ProductSettingHatchAnnualMonthlyUpdateDraft {
  const form = objectOf(value, '年月指标目标标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '年月指标目标标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingHatchAnnualMonthlyUpdateDraft {
  const draft = objectOf(value, '年月指标目标标准编辑草稿')
  return { ...draft, ...createPayloadOf(draft), id: idOf(draft.id, '年月指标目标标准ID') }
}

/** The injected request must use PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH as its page context. */
export function createProductSettingHatchAnnualMonthlyCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingHatchAnnualMonthlyQuery = {}): Promise<ProductSettingHatchAnnualMonthlyPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchAnnualMonthlyCreateForm): { draft: ProductSettingHatchAnnualMonthlyCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingHatchAnnualMonthlyCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingHatchAnnualMonthlyUpdateForm): { draft: ProductSettingHatchAnnualMonthlyUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingHatchAnnualMonthlyUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingHatchAnnualMonthlyRemoveInput): ProductSettingHatchAnnualMonthlyRemoveDraft {
      return { id: idOf(input?.id, '年月指标目标标准ID') }
    },

    async remove (input: ProductSettingHatchAnnualMonthlyRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '年月指标目标标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingHatchAnnualMonthlyCapability = ReturnType<typeof createProductSettingHatchAnnualMonthlyCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_METHODS = {
  'product-setting-hatch-annual-monthly-list': 'list',
  'product-setting-hatch-annual-monthly-prepare-create': 'prepareCreate',
  'product-setting-hatch-annual-monthly-create': 'create',
  'product-setting-hatch-annual-monthly-prepare-update': 'prepareUpdate',
  'product-setting-hatch-annual-monthly-update': 'update',
  'product-setting-hatch-annual-monthly-prepare-remove': 'prepareRemove',
  'product-setting-hatch-annual-monthly-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、月度、孵化厅、健母雏率、蛋雏比和年月类型均必填，健母雏率按页面百分数填写' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，健母雏率按页面百分数填写，并保留raw扩展字段' }

export const productSettingHatchAnnualMonthlyCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-annual-monthly-list', title: '查询年月指标目标标准', write: false, params: [p('hall', 'text', false, '孵化厅筛选；默认空字符串'), p('year', 'text', false, '年度筛选；默认空字符串'), p('month', 'number', false, '月份筛选；默认1，传null表示取消月份筛选'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-hatch-annual-monthly-prepare-create', title: '准备新建年月指标目标标准', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-annual-monthly-create', title: '新建年月指标目标标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；健母雏率已经从页面百分数转换为比例小数')] },
  { id: 'product-setting-hatch-annual-monthly-prepare-update', title: '准备编辑年月指标目标标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-annual-monthly-update', title: '编辑年月指标目标标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；健母雏率已经转换为比例小数')] },
  { id: 'product-setting-hatch-annual-monthly-prepare-remove', title: '准备删除年月指标目标标准', write: false, params: [p('id', 'text', true, '当前列表行的年月指标目标标准ID')] },
  { id: 'product-setting-hatch-annual-monthly-remove', title: '删除年月指标目标标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/hatchAnnualMonthly/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_ANNUAL_MONTHLY_MODULE_TYPE,
  httpInstance: 'product',
}))
