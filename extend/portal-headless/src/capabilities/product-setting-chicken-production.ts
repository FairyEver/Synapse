import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 种鸡生产指标标准」。 */
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH = '/dashboard/product/setting/standard-manage/chicken-production/list'
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION = '/dashboard/frame/standard-library/chicken-production'
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_MODULE_TYPE = null
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_QUERY_PERMISSION = 'base:chicken-production:query'
export const PRODUCT_SETTING_CHICKEN_PRODUCTION_SUBMIT_PERMISSION = 'base:chicken-production:submit'

const PAGE_URL = '/base/chickenProduction/page'
const SAVE_URL = '/base/chickenProduction/save'
const DELETE_URL_PREFIX = '/base/chickenProduction/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000

export type ProductSettingChickenProductionId = string | number
export type ProductSettingChickenProductionMoulting = 0 | 1

export type ProductSettingChickenProductionQuery = {
  year?: string | number | null
  weekAge?: string | number | null
  gen?: string | null
  line?: string | null
  variety?: string | null
  moulting?: ProductSettingChickenProductionMoulting | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingChickenProductionRow = Record<string, unknown> & {
  id: ProductSettingChickenProductionId | null
  year: number | null
  moulting: ProductSettingChickenProductionMoulting | null
  weekAge: number | null
  gen: string | null
  variety: string | null
  line: string | null
  lineVer: string | null
  layingRate: number | null
  passRate: number | null
  fertilityRate: number | null
  maleDeathsRate: number | null
  femaleDeathsRate: number | null
  maleDeathEliminationRate: number | null
  femaleDeathEliminationRate: number | null
  maleEliminationRate: number | null
  femaleEliminationRate: number | null
  femaleWeight: number | null
  evennessDegree: number | null
  femaleTibiaLength: number | null
  dailyConsumption: number | null
  maleWeight: number | null
  maleTibiaLength: number | null
  eggWeight: number | null
}

export type ProductSettingChickenProductionPage = {
  list: ProductSettingChickenProductionRow[]
  total: number
}

/** 页面弹窗输入值；率字段使用弹窗显示的百分数。 */
export type ProductSettingChickenProductionCreateForm = Record<string, unknown> & {
  year: number | string
  moulting: ProductSettingChickenProductionMoulting | string | number
  weekAge: number | string
  gen?: string | null
  variety?: string | null
  line?: string | null
  lineVer?: number | string | null
  layingRate?: number | string | null
  passRate?: number | string | null
  fertilityRate?: number | string | null
  maleDeathsRate?: number | string | null
  femaleDeathsRate?: number | string | null
  maleDeathEliminationRate?: number | string | null
  femaleDeathEliminationRate?: number | string | null
  maleEliminationRate?: number | string | null
  femaleEliminationRate?: number | string | null
  femaleWeight?: number | string | null
  evennessDegree?: number | string | null
  femaleTibiaLength?: number | string | null
  dailyConsumption?: number | string | null
  maleWeight?: number | string | null
  maleTibiaLength?: number | string | null
  eggWeight?: number | string | null
}

/** POST /base/chickenProduction/save 的新建请求体。 */
export type ProductSettingChickenProductionCreateDraft = Record<string, unknown> & {
  year: number
  moulting: ProductSettingChickenProductionMoulting
  weekAge: number
  gen: string | null
  variety: string | null
  line: string | null
  lineVer: number | null
  layingRate: number | null
  passRate: number | null
  fertilityRate: number | null
  maleDeathsRate: number | null
  femaleDeathsRate: number | null
  maleDeathEliminationRate: number | null
  femaleDeathEliminationRate: number | null
  maleEliminationRate: number | null
  femaleEliminationRate: number | null
  femaleWeight: number | null
  evennessDegree: number | null
  femaleTibiaLength: number | null
  dailyConsumption: number | null
  maleWeight: number | null
  maleTibiaLength: number | null
  eggWeight: number | null
}

/** 编辑表单保留Portal的raw扩展字段。 */
export type ProductSettingChickenProductionUpdateForm = ProductSettingChickenProductionCreateForm & {
  id?: ProductSettingChickenProductionId | null | ''
}

export type ProductSettingChickenProductionUpdateDraft = Record<string, unknown> & ProductSettingChickenProductionCreateDraft & {
  id: ProductSettingChickenProductionId
}

export type ProductSettingChickenProductionRemoveInput = {
  id?: ProductSettingChickenProductionId | null | ''
}

export type ProductSettingChickenProductionRemoveDraft = {
  id: ProductSettingChickenProductionId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingChickenProductionId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingChickenProductionId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string | null {
  if (value === undefined) return ''
  return textOf(value, label)
}

function numberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字或null`)
  return number
}

function nullableNumberOf (value: unknown, label: string): number | null {
  return numberOf(value, label)
}

function formNumberOf (value: unknown, label: string, options: { required?: boolean; integer?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined) {
    if (options.required) throw new Error(`${label}不能为空`)
    return null
  }
  if (value === null || value === '') {
    if (options.required) throw new Error(`${label}不能为空`)
    return 0
  }
  const number = numberOf(value, label)
  if (number === null) {
    if (options.required) throw new Error(`${label}不能为空`)
    return 0
  }
  if (options.integer && !Number.isInteger(number)) throw new Error(`${label}必须为整数`)
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function payloadNumberOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null) return null
  const number = numberOf(value, label)
  if (number === null) return null
  if (options.integer && !Number.isInteger(number)) throw new Error(`${label}必须为整数`)
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function requiredPayloadNumberOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  return payloadNumberOf(value, label, options)!
}

function moultingOf (value: unknown, label: string, fallback?: ProductSettingChickenProductionMoulting): ProductSettingChickenProductionMoulting {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 0 && number !== 1) throw new Error(`是否换羽（${label}）只能是0（非换羽）或1（换羽）`)
  return number as ProductSettingChickenProductionMoulting
}

function queryNumberOf (value: unknown, label: string, fallback: number): number {
  const candidate = value === undefined ? fallback : value
  const number = numberOf(candidate, label)
  if (number === null) return fallback
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字`)
  return number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingChickenProductionQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    year: query.year === undefined || query.year === null ? '' : String(query.year),
    weekAge: queryNumberOf(query.weekAge, '周龄', 0),
    gen: formTextOf(query.gen, '代次'),
    line: formTextOf(query.line, '品系'),
    variety: formTextOf(query.variety, '品种'),
    moulting: moultingOf(query.moulting, '是否换羽', 0),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingChickenProductionRow {
  const row = objectOf(value, `种鸡生产指标标准列表[${index}]`)
  const rowLabel = `种鸡生产指标标准列表[${index}]`
  const result = {
    ...row,
    id: nullableIdOf(row.id, `${rowLabel}.id`),
    year: nullableNumberOf(row.year, `${rowLabel}.year`),
    moulting: row.moulting === undefined || row.moulting === null || row.moulting === '' ? null : moultingOf(row.moulting, `${rowLabel}.moulting`),
    weekAge: nullableNumberOf(row.weekAge, `${rowLabel}.weekAge`),
    gen: textOf(row.gen, `${rowLabel}.gen`),
    variety: textOf(row.variety, `${rowLabel}.variety`),
    line: textOf(row.line, `${rowLabel}.line`),
    lineVer: row.lineVer === undefined || row.lineVer === null ? null : String(row.lineVer),
    layingRate: nullableNumberOf(row.layingRate, `${rowLabel}.layingRate`),
    passRate: nullableNumberOf(row.passRate, `${rowLabel}.passRate`),
    fertilityRate: nullableNumberOf(row.fertilityRate, `${rowLabel}.fertilityRate`),
    maleDeathsRate: nullableNumberOf(row.maleDeathsRate, `${rowLabel}.maleDeathsRate`),
    femaleDeathsRate: nullableNumberOf(row.femaleDeathsRate, `${rowLabel}.femaleDeathsRate`),
    maleDeathEliminationRate: nullableNumberOf(row.maleDeathEliminationRate, `${rowLabel}.maleDeathEliminationRate`),
    femaleDeathEliminationRate: nullableNumberOf(row.femaleDeathEliminationRate, `${rowLabel}.femaleDeathEliminationRate`),
    maleEliminationRate: nullableNumberOf(row.maleEliminationRate, `${rowLabel}.maleEliminationRate`),
    femaleEliminationRate: nullableNumberOf(row.femaleEliminationRate, `${rowLabel}.femaleEliminationRate`),
    femaleWeight: nullableNumberOf(row.femaleWeight, `${rowLabel}.femaleWeight`),
    evennessDegree: nullableNumberOf(row.evennessDegree, `${rowLabel}.evennessDegree`),
    femaleTibiaLength: nullableNumberOf(row.femaleTibiaLength, `${rowLabel}.femaleTibiaLength`),
    dailyConsumption: nullableNumberOf(row.dailyConsumption, `${rowLabel}.dailyConsumption`),
    maleWeight: nullableNumberOf(row.maleWeight, `${rowLabel}.maleWeight`),
    maleTibiaLength: nullableNumberOf(row.maleTibiaLength, `${rowLabel}.maleTibiaLength`),
    eggWeight: nullableNumberOf(row.eggWeight, `${rowLabel}.eggWeight`),
  }
  return result
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingChickenProductionPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '种鸡生产指标标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '种鸡生产指标标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('种鸡生产指标标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function percentageFromForm (value: unknown, label: string): number | null {
  const number = formNumberOf(value, label, { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX })
  return number === null ? null : number / 100
}

function percentagePayloadOf (value: unknown, label: string): number | null {
  const number = payloadNumberOf(value, label)
  return number
}

function createDraftOf (value: unknown): ProductSettingChickenProductionCreateDraft {
  const form = objectOf(value, '种鸡生产指标标准新建表单')
  return {
    year: formNumberOf(form.year, '年度', { required: true, min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX })!,
    moulting: moultingOf(form.moulting, '是否换羽'),
    weekAge: formNumberOf(form.weekAge, '周龄', { required: true, min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX })!,
    gen: formTextOf(form.gen, '代次'),
    variety: formTextOf(form.variety, '品种'),
    line: formTextOf(form.line, '品系'),
    lineVer: formNumberOf(form.lineVer, '品系版本', { integer: true, min: 1, max: FORM_NUMBER_MAX }),
    layingRate: percentageFromForm(form.layingRate, '产蛋率'),
    passRate: percentageFromForm(form.passRate, '合格率'),
    fertilityRate: percentageFromForm(form.fertilityRate, '受精率'),
    maleDeathsRate: percentageFromForm(form.maleDeathsRate, '公鸡死亡率'),
    femaleDeathsRate: percentageFromForm(form.femaleDeathsRate, '母鸡死亡率'),
    maleDeathEliminationRate: percentageFromForm(form.maleDeathEliminationRate, '公鸡死淘率'),
    femaleDeathEliminationRate: percentageFromForm(form.femaleDeathEliminationRate, '母鸡死淘率'),
    maleEliminationRate: percentageFromForm(form.maleEliminationRate, '公鸡淘汰率'),
    femaleEliminationRate: percentageFromForm(form.femaleEliminationRate, '母鸡淘汰率'),
    femaleWeight: formNumberOf(form.femaleWeight, '母鸡体重', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    evennessDegree: formNumberOf(form.evennessDegree, '均匀度', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    femaleTibiaLength: formNumberOf(form.femaleTibiaLength, '母鸡体尺', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    dailyConsumption: formNumberOf(form.dailyConsumption, '日耗料', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    maleWeight: formNumberOf(form.maleWeight, '公鸡体重', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    maleTibiaLength: formNumberOf(form.maleTibiaLength, '公鸡体尺', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    eggWeight: formNumberOf(form.eggWeight, '蛋重', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
  }
}

function createPayloadOf (value: unknown): ProductSettingChickenProductionCreateDraft {
  const form = objectOf(value, '种鸡生产指标标准新建草稿')
  return {
    ...form,
    year: requiredPayloadNumberOf(form.year, '年度', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    moulting: moultingOf(form.moulting, '是否换羽'),
    weekAge: requiredPayloadNumberOf(form.weekAge, '周龄', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    gen: formTextOf(form.gen, '代次'),
    variety: formTextOf(form.variety, '品种'),
    line: formTextOf(form.line, '品系'),
    lineVer: payloadNumberOf(form.lineVer, '品系版本', { integer: true, min: 1, max: FORM_NUMBER_MAX }),
    layingRate: percentagePayloadOf(form.layingRate, '产蛋率'),
    passRate: percentagePayloadOf(form.passRate, '合格率'),
    fertilityRate: percentagePayloadOf(form.fertilityRate, '受精率'),
    maleDeathsRate: percentagePayloadOf(form.maleDeathsRate, '公鸡死亡率'),
    femaleDeathsRate: percentagePayloadOf(form.femaleDeathsRate, '母鸡死亡率'),
    maleDeathEliminationRate: percentagePayloadOf(form.maleDeathEliminationRate, '公鸡死淘率'),
    femaleDeathEliminationRate: percentagePayloadOf(form.femaleDeathEliminationRate, '母鸡死淘率'),
    maleEliminationRate: percentagePayloadOf(form.maleEliminationRate, '公鸡淘汰率'),
    femaleEliminationRate: percentagePayloadOf(form.femaleEliminationRate, '母鸡淘汰率'),
    femaleWeight: payloadNumberOf(form.femaleWeight, '母鸡体重'),
    evennessDegree: payloadNumberOf(form.evennessDegree, '均匀度'),
    femaleTibiaLength: payloadNumberOf(form.femaleTibiaLength, '母鸡体尺'),
    dailyConsumption: payloadNumberOf(form.dailyConsumption, '日耗料'),
    maleWeight: payloadNumberOf(form.maleWeight, '公鸡体重'),
    maleTibiaLength: payloadNumberOf(form.maleTibiaLength, '公鸡体尺'),
    eggWeight: payloadNumberOf(form.eggWeight, '蛋重'),
  }
}

function updateDraftOf (value: unknown): ProductSettingChickenProductionUpdateDraft {
  const form = objectOf(value, '种鸡生产指标标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '种鸡生产指标标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingChickenProductionUpdateDraft {
  const form = objectOf(value, '种鸡生产指标标准编辑草稿')
  return { ...form, ...createPayloadOf(form), id: idOf(form.id, '种鸡生产指标标准ID') }
}

function removeIdOf (value: unknown): ProductSettingChickenProductionId {
  return idOf(value, '种鸡生产指标标准ID')
}

/** The injected request must use PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH as its page context. */
export function createProductSettingChickenProductionCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingChickenProductionQuery = {}): Promise<ProductSettingChickenProductionPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingChickenProductionCreateForm): { draft: ProductSettingChickenProductionCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingChickenProductionCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingChickenProductionUpdateForm): { draft: ProductSettingChickenProductionUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingChickenProductionUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingChickenProductionRemoveInput): ProductSettingChickenProductionRemoveDraft {
      return { id: removeIdOf(input?.id) }
    },

    async remove (input: ProductSettingChickenProductionRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${removeIdOf(input?.id)}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingChickenProductionCapability = ReturnType<typeof createProductSettingChickenProductionCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_CHICKEN_PRODUCTION_METHODS = {
  'product-setting-chicken-production-list': 'list',
  'product-setting-chicken-production-prepare-create': 'prepareCreate',
  'product-setting-chicken-production-create': 'create',
  'product-setting-chicken-production-prepare-update': 'prepareUpdate',
  'product-setting-chicken-production-update': 'update',
  'product-setting-chicken-production-prepare-remove': 'prepareRemove',
  'product-setting-chicken-production-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、是否换羽和周龄必填，率字段按弹窗百分数填写，其他数值字段可为空' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，率字段按弹窗百分数填写，并保留raw扩展字段' }

export const productSettingChickenProductionCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-chicken-production-list', title: '查询种鸡生产指标标准', write: false, params: [p('year', 'text', false, '年度筛选；默认空字符串'), p('weekAge', 'number', false, '周龄筛选；默认0'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('line', 'text', false, '品系筛选；默认空字符串'), p('variety', 'text', false, '品种筛选；默认空字符串'), p('moulting', 'enum', false, '是否换羽：0非换羽、1换羽；默认0'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-chicken-production-prepare-create', title: '准备新建种鸡生产指标标准', write: false, params: [createFormParam] },
  { id: 'product-setting-chicken-production-create', title: '新建种鸡生产指标标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；率字段已经转换为比例小数')] },
  { id: 'product-setting-chicken-production-prepare-update', title: '准备编辑种鸡生产指标标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-chicken-production-update', title: '编辑种鸡生产指标标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；率字段已经转换为比例小数')] },
  { id: 'product-setting-chicken-production-prepare-remove', title: '准备删除种鸡生产指标标准', write: false, params: [p('id', 'text', true, '当前列表行的种鸡生产指标标准ID')] },
  { id: 'product-setting-chicken-production-remove', title: '删除种鸡生产指标标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/chickenProduction/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_CHICKEN_PRODUCTION_PAGE_PATH,
  permission: PRODUCT_SETTING_CHICKEN_PRODUCTION_PERMISSION,
  moduleType: PRODUCT_SETTING_CHICKEN_PRODUCTION_MODULE_TYPE,
  httpInstance: 'product',
}))
