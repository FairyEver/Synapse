import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 种鸡标准(BI)」。 */
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH = '/dashboard/product/setting/standard-manage/standard-flock-week/list'
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION = '/dashboard/frame/standard-library/standard-flock-week'
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_MODULE_TYPE = null
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_QUERY_PERMISSION = 'base:standard-flock-week:query'
export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_SUBMIT_PERMISSION = 'base:standard-flock-week:submit'

const PAGE_URL = '/base/standardFlockWeek/page'
const SAVE_URL = '/base/standardFlockWeek/save'
const DELETE_URL_PREFIX = '/base/standardFlockWeek/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000
const QUERY_WEEK_AGE_MIN = 1
const QUERY_WEEK_AGE_MAX = 200

export type ProductSettingStandardFlockWeekId = string | number

export type ProductSettingStandardFlockWeekQuery = {
  year?: string | number | null
  gen?: string | null
  variety?: string | null
  line?: string | null
  startWeekAge?: number | string | null
  endWeekAge?: number | string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingStandardFlockWeekRow = Record<string, unknown> & {
  id: ProductSettingStandardFlockWeekId | null
  gen: string | null
  variety: string | null
  line: string | null
  weekAge: number | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  hatchingEggLayingRate: number | null
  housed: number | null
  year: number | null
}

export type ProductSettingStandardFlockWeekPage = {
  list: ProductSettingStandardFlockWeekRow[]
  total: number
}

export type ProductSettingStandardFlockWeekCreateForm = Record<string, unknown> & {
  year: number | string
  weekAge: number | string
  variety: string
  line: string
  gen: string
  housed: number | string
  hatchingEggLayingRate: number | string
}

/** POST /base/standardFlockWeek/save 的新建请求体；产蛋率是Java比例小数。 */
export type ProductSettingStandardFlockWeekCreateDraft = Record<string, unknown> & {
  year: number
  weekAge: number
  variety: string
  line: string
  gen: string
  housed: number
  hatchingEggLayingRate: number
}

export type ProductSettingStandardFlockWeekUpdateForm = ProductSettingStandardFlockWeekCreateForm & {
  id?: ProductSettingStandardFlockWeekId | null | ''
}

export type ProductSettingStandardFlockWeekUpdateDraft = Record<string, unknown> & ProductSettingStandardFlockWeekCreateDraft & {
  id: ProductSettingStandardFlockWeekId
}

export type ProductSettingStandardFlockWeekRemoveInput = {
  id?: ProductSettingStandardFlockWeekId | null | ''
}

export type ProductSettingStandardFlockWeekRemoveDraft = {
  id: ProductSettingStandardFlockWeekId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingStandardFlockWeekId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingStandardFlockWeekId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
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

function optionalQueryTextOf (value: unknown, label: string): string {
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

function requiredNumberOf (value: unknown, label: string, options: { min?: number; max?: number } = {}): number {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  const number = numberOf(value, label)!
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function optionalQueryWeekAgeOf (value: unknown, label: string): number | undefined {
  // Portal convertFetchForm deletes empty/zero values before customLoad.
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return undefined
  const number = requiredNumberOf(value, label, { min: QUERY_WEEK_AGE_MIN, max: QUERY_WEEK_AGE_MAX })
  return number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingStandardFlockWeekQuery = {}): JsonObject {
  const params: JsonObject = {
    order: '',
    orderField: '',
    year: query.year === undefined || query.year === null ? '' : String(query.year),
    gen: optionalQueryTextOf(query.gen, '代次'),
    variety: optionalQueryTextOf(query.variety, '品种'),
    line: optionalQueryTextOf(query.line, '品系'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  const startWeekAge = optionalQueryWeekAgeOf(query.startWeekAge, '开始周龄')
  const endWeekAge = optionalQueryWeekAgeOf(query.endWeekAge, '结束周龄')
  if (startWeekAge !== undefined) params.startWeekAge = startWeekAge
  if (endWeekAge !== undefined) params.endWeekAge = endWeekAge
  return params
}

function rowOf (value: unknown, index: number): ProductSettingStandardFlockWeekRow {
  const row = objectOf(value, `种鸡标准(BI)列表[${index}]`)
  const label = `种鸡标准(BI)列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    gen: textOf(row.gen, `${label}.gen`),
    variety: textOf(row.variety, `${label}.variety`),
    line: textOf(row.line, `${label}.line`),
    weekAge: numberOf(row.weekAge, `${label}.weekAge`),
    hatchingEggLayingRate: numberOf(row.hatchingEggLayingRate, `${label}.hatchingEggLayingRate`),
    housed: numberOf(row.housed, `${label}.housed`),
    year: numberOf(row.year, `${label}.year`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingStandardFlockWeekPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '种鸡标准(BI)分页响应')
  const page = objectOf(envelope.page ?? envelope, '种鸡标准(BI)分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('种鸡标准(BI)分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function createDraftOf (value: unknown): ProductSettingStandardFlockWeekCreateDraft {
  const form = objectOf(value, '种鸡标准(BI)新建表单')
  return {
    year: requiredNumberOf(form.year, '年度', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    weekAge: requiredNumberOf(form.weekAge, '周龄', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    variety: requiredTextOf(form.variety, '品种'),
    line: requiredTextOf(form.line, '品系'),
    gen: requiredTextOf(form.gen, '代次'),
    housed: requiredNumberOf(form.housed, '入舍只鸡单产标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    hatchingEggLayingRate: requiredNumberOf(form.hatchingEggLayingRate, '合格种蛋产蛋率标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }) / 100,
  }
}

function payloadNumberOf (value: unknown, label: string): number {
  return requiredNumberOf(value, label)
}

function createPayloadOf (value: unknown): ProductSettingStandardFlockWeekCreateDraft {
  const draft = objectOf(value, '种鸡标准(BI)新建草稿')
  return {
    ...draft,
    year: payloadNumberOf(draft.year, '年度'),
    weekAge: payloadNumberOf(draft.weekAge, '周龄'),
    variety: requiredTextOf(draft.variety, '品种'),
    line: requiredTextOf(draft.line, '品系'),
    gen: requiredTextOf(draft.gen, '代次'),
    housed: payloadNumberOf(draft.housed, '入舍只鸡单产标准'),
    hatchingEggLayingRate: payloadNumberOf(draft.hatchingEggLayingRate, '合格种蛋产蛋率标准'),
  }
}

function updateDraftOf (value: unknown): ProductSettingStandardFlockWeekUpdateDraft {
  const form = objectOf(value, '种鸡标准(BI)编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '种鸡标准(BI)ID') }
}

function updatePayloadOf (value: unknown): ProductSettingStandardFlockWeekUpdateDraft {
  const draft = objectOf(value, '种鸡标准(BI)编辑草稿')
  return { ...draft, ...createPayloadOf(draft), id: idOf(draft.id, '种鸡标准(BI)ID') }
}

/** The injected request must use PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH as its page context. */
export function createProductSettingStandardFlockWeekCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingStandardFlockWeekQuery = {}): Promise<ProductSettingStandardFlockWeekPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingStandardFlockWeekCreateForm): { draft: ProductSettingStandardFlockWeekCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingStandardFlockWeekCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingStandardFlockWeekUpdateForm): { draft: ProductSettingStandardFlockWeekUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingStandardFlockWeekUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingStandardFlockWeekRemoveInput): ProductSettingStandardFlockWeekRemoveDraft {
      return { id: idOf(input?.id, '种鸡标准(BI)ID') }
    },

    async remove (input: ProductSettingStandardFlockWeekRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '种鸡标准(BI)ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingStandardFlockWeekCapability = ReturnType<typeof createProductSettingStandardFlockWeekCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_STANDARD_FLOCK_WEEK_METHODS = {
  'product-setting-standard-flock-week-list': 'list',
  'product-setting-standard-flock-week-prepare-create': 'prepareCreate',
  'product-setting-standard-flock-week-create': 'create',
  'product-setting-standard-flock-week-prepare-update': 'prepareUpdate',
  'product-setting-standard-flock-week-update': 'update',
  'product-setting-standard-flock-week-prepare-remove': 'prepareRemove',
  'product-setting-standard-flock-week-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、周龄、品种、品系、代次、入舍只鸡单产和合格种蛋产蛋率均必填，产蛋率按页面百分数填写' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，产蛋率按页面百分数填写，并保留raw扩展字段' }

export const productSettingStandardFlockWeekCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-standard-flock-week-list', title: '查询种鸡标准(BI)', write: false, params: [p('year', 'text', false, '年度筛选；默认空字符串'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('variety', 'text', false, '品种筛选；默认空字符串'), p('line', 'text', false, '品系筛选；默认空字符串'), p('startWeekAge', 'number', false, '开始周龄；空值时不发送'), p('endWeekAge', 'number', false, '结束周龄；空值时不发送'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-standard-flock-week-prepare-create', title: '准备新建种鸡标准(BI)', write: false, params: [createFormParam] },
  { id: 'product-setting-standard-flock-week-create', title: '新建种鸡标准(BI)', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；合格种蛋产蛋率已经从页面百分数转换为比例小数')] },
  { id: 'product-setting-standard-flock-week-prepare-update', title: '准备编辑种鸡标准(BI)', write: false, params: [updateFormParam] },
  { id: 'product-setting-standard-flock-week-update', title: '编辑种鸡标准(BI)', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；合格种蛋产蛋率已经转换为比例小数')] },
  { id: 'product-setting-standard-flock-week-prepare-remove', title: '准备删除种鸡标准(BI)', write: false, params: [p('id', 'text', true, '当前列表行的种鸡标准(BI)ID')] },
  { id: 'product-setting-standard-flock-week-remove', title: '删除种鸡标准(BI)', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/standardFlockWeek/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PAGE_PATH,
  permission: PRODUCT_SETTING_STANDARD_FLOCK_WEEK_PERMISSION,
  moduleType: PRODUCT_SETTING_STANDARD_FLOCK_WEEK_MODULE_TYPE,
  httpInstance: 'product',
}))
