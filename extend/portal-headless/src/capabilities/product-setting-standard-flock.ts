import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 种鸡标准」。 */
export const PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH = '/dashboard/product/setting/standard-manage/standard-flock/list'
export const PRODUCT_SETTING_STANDARD_FLOCK_PERMISSION = '/dashboard/frame/standard-library/standard-flock'
export const PRODUCT_SETTING_STANDARD_FLOCK_MODULE_TYPE = null
export const PRODUCT_SETTING_STANDARD_FLOCK_QUERY_PERMISSION = 'base:standard-flock:query'
export const PRODUCT_SETTING_STANDARD_FLOCK_SUBMIT_PERMISSION = 'base:standard-flock:submit'

const PAGE_URL = '/base/standardFlock/page'
const SAVE_URL = '/base/standardFlock/save'
const DELETE_URL_PREFIX = '/base/standardFlock/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000

export type ProductSettingStandardFlockId = string | number

export type ProductSettingStandardFlockQuery = {
  gen?: string | null
  variety?: string | null
  line?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingStandardFlockRow = Record<string, unknown> & {
  id: ProductSettingStandardFlockId | null
  gen: string | null
  variety: string | null
  line: string | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  hatchingEggLayingRate: number | null
  housed: number | null
  year: number | null
}

export type ProductSettingStandardFlockPage = {
  list: ProductSettingStandardFlockRow[]
  total: number
}

export type ProductSettingStandardFlockCreateForm = Record<string, unknown> & {
  year: number | string
  variety?: string | null
  line: string
  gen: string
  hatchingEggLayingRate: number | string
  housed: number | string
}

/** POST /base/standardFlock/save 的新建请求体；产蛋率是Java比例小数。 */
export type ProductSettingStandardFlockCreateDraft = Record<string, unknown> & {
  year: number
  variety: string
  line: string
  gen: string
  hatchingEggLayingRate: number
  housed: number
}

export type ProductSettingStandardFlockUpdateForm = ProductSettingStandardFlockCreateForm & {
  id?: ProductSettingStandardFlockId | null | ''
}

export type ProductSettingStandardFlockUpdateDraft = Record<string, unknown> & ProductSettingStandardFlockCreateDraft & {
  id: ProductSettingStandardFlockId
}

export type ProductSettingStandardFlockRemoveInput = {
  id?: ProductSettingStandardFlockId | null | ''
}

export type ProductSettingStandardFlockRemoveDraft = {
  id: ProductSettingStandardFlockId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingStandardFlockId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingStandardFlockId | null {
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

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function numberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字或null`)
  return number
}

function formNumberOf (value: unknown, label: string, options: { required?: boolean; min?: number; max?: number } = {}): number | null {
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
  return formNumberOf(value, label, { required: true, ...options })!
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或空值`)
  return value
}

function queryOf (query: ProductSettingStandardFlockQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    gen: queryTextOf(query.gen, '代次'),
    variety: queryTextOf(query.variety, '品种'),
    line: queryTextOf(query.line, '品系'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingStandardFlockRow {
  const row = objectOf(value, `种鸡标准列表[${index}]`)
  const label = `种鸡标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    gen: textOf(row.gen, `${label}.gen`),
    variety: textOf(row.variety, `${label}.variety`),
    line: textOf(row.line, `${label}.line`),
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

function pageOf (value: unknown): ProductSettingStandardFlockPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '种鸡标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '种鸡标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('种鸡标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function createDraftOf (value: unknown): ProductSettingStandardFlockCreateDraft {
  const form = objectOf(value, '种鸡标准新建表单')
  return {
    year: requiredFormNumberOf(form.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    variety: formTextOf(form.variety, '品种'),
    line: requiredTextOf(form.line, '品系'),
    gen: requiredTextOf(form.gen, '代次'),
    hatchingEggLayingRate: requiredFormNumberOf(form.hatchingEggLayingRate, '合格种蛋产蛋率标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }) / 100,
    housed: requiredFormNumberOf(form.housed, '入舍只鸡单产标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
  }
}

function createPayloadOf (value: unknown): ProductSettingStandardFlockCreateDraft {
  const draft = objectOf(value, '种鸡标准新建草稿')
  return {
    ...draft,
    year: requiredFormNumberOf(draft.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    variety: formTextOf(draft.variety, '品种'),
    line: requiredTextOf(draft.line, '品系'),
    gen: requiredTextOf(draft.gen, '代次'),
    hatchingEggLayingRate: requiredFormNumberOf(draft.hatchingEggLayingRate, '合格种蛋产蛋率标准'),
    housed: requiredFormNumberOf(draft.housed, '入舍只鸡单产标准'),
  }
}

function updateDraftOf (value: unknown): ProductSettingStandardFlockUpdateDraft {
  const form = objectOf(value, '种鸡标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '种鸡标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingStandardFlockUpdateDraft {
  const draft = objectOf(value, '种鸡标准编辑草稿')
  return { ...draft, ...createPayloadOf(draft), id: idOf(draft.id, '种鸡标准ID') }
}

/** The injected request must use PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH as its page context. */
export function createProductSettingStandardFlockCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingStandardFlockQuery = {}): Promise<ProductSettingStandardFlockPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingStandardFlockCreateForm): { draft: ProductSettingStandardFlockCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingStandardFlockCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingStandardFlockUpdateForm): { draft: ProductSettingStandardFlockUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingStandardFlockUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingStandardFlockRemoveInput): ProductSettingStandardFlockRemoveDraft {
      return { id: idOf(input?.id, '种鸡标准ID') }
    },

    async remove (input: ProductSettingStandardFlockRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '种鸡标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingStandardFlockCapability = ReturnType<typeof createProductSettingStandardFlockCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_STANDARD_FLOCK_METHODS = {
  'product-setting-standard-flock-list': 'list',
  'product-setting-standard-flock-prepare-create': 'prepareCreate',
  'product-setting-standard-flock-create': 'create',
  'product-setting-standard-flock-prepare-update': 'prepareUpdate',
  'product-setting-standard-flock-update': 'update',
  'product-setting-standard-flock-prepare-remove': 'prepareRemove',
  'product-setting-standard-flock-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、品系、代次、合格种蛋产蛋率和入舍只鸡单产均必填，品种可为空，产蛋率按页面百分数填写' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，品种可为空，产蛋率按页面百分数填写，并保留raw扩展字段' }

export const productSettingStandardFlockCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-standard-flock-list', title: '查询种鸡标准', write: false, params: [p('gen', 'text', false, '代次筛选；默认空字符串'), p('variety', 'text', false, '品种筛选；默认空字符串'), p('line', 'text', false, '品系筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-standard-flock-prepare-create', title: '准备新建种鸡标准', write: false, params: [createFormParam] },
  { id: 'product-setting-standard-flock-create', title: '新建种鸡标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；合格种蛋产蛋率已经从页面百分数转换为比例小数')] },
  { id: 'product-setting-standard-flock-prepare-update', title: '准备编辑种鸡标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-standard-flock-update', title: '编辑种鸡标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；合格种蛋产蛋率已经转换为比例小数')] },
  { id: 'product-setting-standard-flock-prepare-remove', title: '准备删除种鸡标准', write: false, params: [p('id', 'text', true, '当前列表行的种鸡标准ID')] },
  { id: 'product-setting-standard-flock-remove', title: '删除种鸡标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/standardFlock/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_STANDARD_FLOCK_PAGE_PATH,
  permission: PRODUCT_SETTING_STANDARD_FLOCK_PERMISSION,
  moduleType: PRODUCT_SETTING_STANDARD_FLOCK_MODULE_TYPE,
  httpInstance: 'product',
}))
