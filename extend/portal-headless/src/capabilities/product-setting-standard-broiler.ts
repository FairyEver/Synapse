import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 肉鸡标准」。 */
export const PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH = '/dashboard/product/setting/standard-manage/standard-broiler/list'
export const PRODUCT_SETTING_STANDARD_BROILER_PERMISSION = '/dashboard/frame/standard-library/standard-broiler'
export const PRODUCT_SETTING_STANDARD_BROILER_MODULE_TYPE = null
export const PRODUCT_SETTING_STANDARD_BROILER_QUERY_PERMISSION = 'base:standard-broiler:query'
export const PRODUCT_SETTING_STANDARD_BROILER_SUBMIT_PERMISSION = 'base:standard-broiler:submit'

const PAGE_URL = '/base/standardBroiler/page'
const SAVE_URL = '/base/standardBroiler/save'
const DELETE_URL_PREFIX = '/base/standardBroiler/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const TYPE_OPTIONS = new Set([1, 7])
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000
const AGE_MIN = 0

export type ProductSettingStandardBroilerId = string | number
export type ProductSettingStandardBroilerType = 1 | 7

export type ProductSettingStandardBroilerQuery = {
  year?: string | number | null
  type?: ProductSettingStandardBroilerType | string | number | null
  age?: string | number | null
  variety?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingStandardBroilerRow = Record<string, unknown> & {
  id: ProductSettingStandardBroilerId | null
  year: number | null
  type: ProductSettingStandardBroilerType | null
  age: number | null
  gen: string | null
  variety: string | null
  varietyName: string | null
  line: string | null
  totalConsumeMaterialStandard: number | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  totalSurvivalRateStandard: number | null
  deathEliminateStandard: number | null
  consumeMaterialStandard: number | null
  feedMeatRatioStandard: number | null
  avgWeightStandard: number | null
}

export type ProductSettingStandardBroilerPage = {
  list: ProductSettingStandardBroilerRow[]
  total: number
}

export type ProductSettingStandardBroilerCreateForm = Record<string, unknown> & {
  year: number | string
  type?: ProductSettingStandardBroilerType | string | number
  age: number | string
  variety?: string | null
  totalConsumeMaterialStandard?: number | string | null
  totalSurvivalRateStandard?: number | string | null
  deathEliminateStandard?: number | string | null
  consumeMaterialStandard?: number | string | null
  feedMeatRatioStandard?: number | string | null
  avgWeightStandard?: number | string | null
}

/** POST /base/standardBroiler/save 的新建请求体；存活率是Java比例小数。 */
export type ProductSettingStandardBroilerCreateDraft = Record<string, unknown> & {
  year: number
  type: ProductSettingStandardBroilerType
  age: number
  variety: string
  totalConsumeMaterialStandard: number | null
  totalSurvivalRateStandard: number | null
  deathEliminateStandard: number | null
  consumeMaterialStandard: number | null
  feedMeatRatioStandard: number | null
  avgWeightStandard: number | null
}

export type ProductSettingStandardBroilerUpdateForm = ProductSettingStandardBroilerCreateForm & {
  id?: ProductSettingStandardBroilerId | null | ''
}

export type ProductSettingStandardBroilerUpdateDraft = Record<string, unknown> & ProductSettingStandardBroilerCreateDraft & {
  id: ProductSettingStandardBroilerId
}

export type ProductSettingStandardBroilerRemoveInput = {
  id?: ProductSettingStandardBroilerId | null | ''
}

export type ProductSettingStandardBroilerRemoveDraft = {
  id: ProductSettingStandardBroilerId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingStandardBroilerId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingStandardBroilerId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或空值`)
  return value
}

function numberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字或null`)
  return number
}

function formNumberOf (value: unknown, label: string, options: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined) {
    if (options.required) throw new Error(`${label}不能为空`)
    return null
  }
  if (value === null || value === '') {
    if (options.required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = numberOf(value, label)!
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function requiredFormNumberOf (value: unknown, label: string, options: { min?: number; max?: number } = {}): number {
  return formNumberOf(value, label, { required: true, ...options })!
}

function typeOf (value: unknown, label: string, fallback?: ProductSettingStandardBroilerType): ProductSettingStandardBroilerType {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (!Number.isInteger(number) || !TYPE_OPTIONS.has(number)) throw new Error(`${label}只能是1（日龄）或7（周龄）`)
  return number as ProductSettingStandardBroilerType
}

function queryTypeOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') return ''
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(number) || !TYPE_OPTIONS.has(number)) throw new Error('类型筛选只能是1（日龄）或7（周龄）')
  return typeof value === 'number' ? number : value as string
}

function optionalQueryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串、数字或空值`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingStandardBroilerQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    year: query.year === undefined || query.year === null ? '' : String(query.year),
    type: queryTypeOf(query.type),
    age: optionalQueryValueOf(query.age, '日龄/周龄'),
    variety: query.variety === undefined || query.variety === null ? '' : query.variety,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingStandardBroilerRow {
  const row = objectOf(value, `肉鸡标准列表[${index}]`)
  const label = `肉鸡标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    year: numberOf(row.year, `${label}.year`),
    type: row.type === undefined || row.type === null || row.type === '' ? null : typeOf(row.type, `${label}.type`),
    age: numberOf(row.age, `${label}.age`),
    gen: textOf(row.gen, `${label}.gen`),
    variety: textOf(row.variety, `${label}.variety`),
    varietyName: textOf(row.varietyName, `${label}.varietyName`),
    line: textOf(row.line, `${label}.line`),
    totalConsumeMaterialStandard: numberOf(row.totalConsumeMaterialStandard, `${label}.totalConsumeMaterialStandard`),
    totalSurvivalRateStandard: numberOf(row.totalSurvivalRateStandard, `${label}.totalSurvivalRateStandard`),
    deathEliminateStandard: numberOf(row.deathEliminateStandard, `${label}.deathEliminateStandard`),
    consumeMaterialStandard: numberOf(row.consumeMaterialStandard, `${label}.consumeMaterialStandard`),
    feedMeatRatioStandard: numberOf(row.feedMeatRatioStandard, `${label}.feedMeatRatioStandard`),
    avgWeightStandard: numberOf(row.avgWeightStandard, `${label}.avgWeightStandard`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingStandardBroilerPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '肉鸡标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '肉鸡标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('肉鸡标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function percentageFromForm (value: unknown, label: string): number | null {
  const number = formNumberOf(value, label, { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX })
  return number === null ? null : number / 100
}

function createDraftOf (value: unknown): ProductSettingStandardBroilerCreateDraft {
  const form = objectOf(value, '肉鸡标准新建表单')
  return {
    year: requiredFormNumberOf(form.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    type: typeOf(form.type, '类型', 1),
    age: requiredFormNumberOf(form.age, '日龄/周龄', { min: AGE_MIN, max: FORM_NUMBER_MAX }),
    variety: formTextOf(form.variety, '品种'),
    avgWeightStandard: formNumberOf(form.avgWeightStandard, '平均体重标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    feedMeatRatioStandard: formNumberOf(form.feedMeatRatioStandard, '料肉比标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    consumeMaterialStandard: formNumberOf(form.consumeMaterialStandard, '耗料标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    deathEliminateStandard: formNumberOf(form.deathEliminateStandard, '死淘数标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    totalSurvivalRateStandard: percentageFromForm(form.totalSurvivalRateStandard, '累计存活率标准'),
    totalConsumeMaterialStandard: formNumberOf(form.totalConsumeMaterialStandard, '累计耗料标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
  }
}

function payloadNumberOf (value: unknown, label: string): number | null {
  return numberOf(value, label)
}

function createPayloadOf (value: unknown): ProductSettingStandardBroilerCreateDraft {
  const draft = objectOf(value, '肉鸡标准新建草稿')
  return {
    ...draft,
    year: requiredFormNumberOf(draft.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    type: typeOf(draft.type, '类型', 1),
    age: requiredFormNumberOf(draft.age, '日龄/周龄', { min: AGE_MIN, max: FORM_NUMBER_MAX }),
    variety: formTextOf(draft.variety, '品种'),
    avgWeightStandard: payloadNumberOf(draft.avgWeightStandard, '平均体重标准'),
    feedMeatRatioStandard: payloadNumberOf(draft.feedMeatRatioStandard, '料肉比标准'),
    consumeMaterialStandard: payloadNumberOf(draft.consumeMaterialStandard, '耗料标准'),
    deathEliminateStandard: payloadNumberOf(draft.deathEliminateStandard, '死淘数标准'),
    totalSurvivalRateStandard: payloadNumberOf(draft.totalSurvivalRateStandard, '累计存活率标准'),
    totalConsumeMaterialStandard: payloadNumberOf(draft.totalConsumeMaterialStandard, '累计耗料标准'),
  }
}

function updateDraftOf (value: unknown): ProductSettingStandardBroilerUpdateDraft {
  const form = objectOf(value, '肉鸡标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '肉鸡标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingStandardBroilerUpdateDraft {
  const draft = objectOf(value, '肉鸡标准编辑草稿')
  return { ...draft, ...createPayloadOf(draft), id: idOf(draft.id, '肉鸡标准ID') }
}

/** The injected request must use PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH as its page context. */
export function createProductSettingStandardBroilerCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingStandardBroilerQuery = {}): Promise<ProductSettingStandardBroilerPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingStandardBroilerCreateForm): { draft: ProductSettingStandardBroilerCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingStandardBroilerCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingStandardBroilerUpdateForm): { draft: ProductSettingStandardBroilerUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingStandardBroilerUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingStandardBroilerRemoveInput): ProductSettingStandardBroilerRemoveDraft {
      return { id: idOf(input?.id, '肉鸡标准ID') }
    },

    async remove (input: ProductSettingStandardBroilerRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '肉鸡标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingStandardBroilerCapability = ReturnType<typeof createProductSettingStandardBroilerCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_STANDARD_BROILER_METHODS = {
  'product-setting-standard-broiler-list': 'list',
  'product-setting-standard-broiler-prepare-create': 'prepareCreate',
  'product-setting-standard-broiler-create': 'create',
  'product-setting-standard-broiler-prepare-update': 'prepareUpdate',
  'product-setting-standard-broiler-update': 'update',
  'product-setting-standard-broiler-prepare-remove': 'prepareRemove',
  'product-setting-standard-broiler-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度和日龄/周龄必填，类型默认日龄，存活率按页面百分数填写，其他指标可为空' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，存活率按页面百分数填写，并保留raw扩展字段' }

export const productSettingStandardBroilerCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-standard-broiler-list', title: '查询肉鸡标准', write: false, params: [p('year', 'text', false, '年度筛选；默认空字符串'), p('type', 'enum', false, '类型：1日龄、7周龄；默认空字符串'), p('age', 'text', false, '日龄/周龄筛选；默认空字符串'), p('variety', 'text', false, '品种筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-standard-broiler-prepare-create', title: '准备新建肉鸡标准', write: false, params: [createFormParam] },
  { id: 'product-setting-standard-broiler-create', title: '新建肉鸡标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；累计存活率已经从页面百分数转换为比例小数')] },
  { id: 'product-setting-standard-broiler-prepare-update', title: '准备编辑肉鸡标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-standard-broiler-update', title: '编辑肉鸡标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；累计存活率已经转换为比例小数')] },
  { id: 'product-setting-standard-broiler-prepare-remove', title: '准备删除肉鸡标准', write: false, params: [p('id', 'text', true, '当前列表行的肉鸡标准ID')] },
  { id: 'product-setting-standard-broiler-remove', title: '删除肉鸡标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/standardBroiler/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_STANDARD_BROILER_PAGE_PATH,
  permission: PRODUCT_SETTING_STANDARD_BROILER_PERMISSION,
  moduleType: PRODUCT_SETTING_STANDARD_BROILER_MODULE_TYPE,
  httpInstance: 'product',
}))
