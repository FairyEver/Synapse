import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 孵化健母率标准」。 */
export const PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH = '/dashboard/product/setting/standard-manage/standard-hatch/list'
export const PRODUCT_SETTING_STANDARD_HATCH_PERMISSION = '/dashboard/frame/standard-library/standard-hatch'
export const PRODUCT_SETTING_STANDARD_HATCH_MODULE_TYPE = null
export const PRODUCT_SETTING_STANDARD_HATCH_QUERY_PERMISSION = 'base:standard-hatch:query'
export const PRODUCT_SETTING_STANDARD_HATCH_SUBMIT_PERMISSION = 'base:standard-hatch:submit'

const PAGE_URL = '/base/standardHatch/page'
const AGE_STAGE_OPTIONS_URL = '/egg/standardAgeStage/list'
const SAVE_URL = '/base/standardHatch/save'
const DELETE_URL_PREFIX = '/base/standardHatch/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const FORM_NUMBER_MIN = -10_000_000
const FORM_NUMBER_MAX = 10_000_000

export type ProductSettingStandardHatchId = string | number
export type ProductSettingStandardHatchGenDown = 0 | 1

export type ProductSettingStandardHatchQuery = {
  ageStage?: string | number | null
  hall?: string | number | null
  gen?: string | null
  variety?: string | null
  year?: string | number | null
  genDown?: ProductSettingStandardHatchGenDown | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingStandardHatchAgeStageOption = {
  id: ProductSettingStandardHatchId
  stage: string | null
}

export type ProductSettingStandardHatchRow = Record<string, unknown> & {
  id: ProductSettingStandardHatchId | null
  year: number | null
  ageStage: string | null
  gen: string | null
  hall: string | null
  hallName: string | null
  variety: string | null
  genDown: ProductSettingStandardHatchGenDown | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  healthyFemaleRate: number | null
  abnormalFemaleRate: number | null
  eggChickRatio: number | null
  chickWeight: number | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  fertilizedHatchingRate: number | null
  /** Java分页接口已把数据库比例小数乘以100后的响应值。 */
  excludedBloodFertilityRate: number | null
  satisfaction: number | null
}

export type ProductSettingStandardHatchPage = {
  list: ProductSettingStandardHatchRow[]
  total: number
}

export type ProductSettingStandardHatchCreateForm = Record<string, unknown> & {
  year: number | string
  ageStage: string | number
  gen: string
  hall: string | number
  variety: string
  genDown: ProductSettingStandardHatchGenDown | string | number
  healthyFemaleRate: number | string
  abnormalFemaleRate?: number | string | null
  eggChickRatio: number | string
  chickWeight: number | string
  fertilizedHatchingRate: number | string
  excludedBloodFertilityRate: number | string
  satisfaction: number | string
}

/** POST /base/standardHatch/save 的新建请求体；四个率字段是Java比例小数。 */
export type ProductSettingStandardHatchCreateDraft = Record<string, unknown> & {
  year: number
  ageStage: string | number
  gen: string
  hall: string | number
  variety: string
  genDown: ProductSettingStandardHatchGenDown
  healthyFemaleRate: number
  abnormalFemaleRate: number | null
  eggChickRatio: number
  chickWeight: number
  fertilizedHatchingRate: number
  excludedBloodFertilityRate: number
  satisfaction: number
}

export type ProductSettingStandardHatchUpdateForm = ProductSettingStandardHatchCreateForm & {
  id?: ProductSettingStandardHatchId | null | ''
}

export type ProductSettingStandardHatchUpdateDraft = Record<string, unknown> & ProductSettingStandardHatchCreateDraft & {
  id: ProductSettingStandardHatchId
}

export type ProductSettingStandardHatchRemoveInput = {
  id?: ProductSettingStandardHatchId | null | ''
}

export type ProductSettingStandardHatchRemoveDraft = {
  id: ProductSettingStandardHatchId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingStandardHatchId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingStandardHatchId | null {
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
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字或null`)
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

function genDownOf (value: unknown, label: string, fallback?: ProductSettingStandardHatchGenDown): ProductSettingStandardHatchGenDown {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 0 && number !== 1) throw new Error(`${label}只能是0（否）或1（是）`)
  return number as ProductSettingStandardHatchGenDown
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingStandardHatchQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ageStage: optionalQueryValueOf(query.ageStage, '日龄段'),
    hall: optionalQueryValueOf(query.hall, '孵化厅'),
    gen: query.gen === undefined || query.gen === null ? '' : textOf(query.gen, '代次') ?? '',
    variety: query.variety === undefined || query.variety === null ? '' : textOf(query.variety, '品种') ?? '',
    year: query.year === undefined || query.year === null ? '' : String(query.year),
    genDown: genDownOf(query.genDown, '是否降代', 0),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingStandardHatchRow {
  const row = objectOf(value, `孵化健母率标准列表[${index}]`)
  const label = `孵化健母率标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    year: numberOf(row.year, `${label}.year`),
    ageStage: textOf(row.ageStage, `${label}.ageStage`),
    gen: textOf(row.gen, `${label}.gen`),
    hall: textOf(row.hall, `${label}.hall`),
    hallName: textOf(row.hallName, `${label}.hallName`),
    variety: textOf(row.variety, `${label}.variety`),
    genDown: row.genDown === undefined || row.genDown === null || row.genDown === '' ? null : genDownOf(row.genDown, `${label}.genDown`),
    healthyFemaleRate: numberOf(row.healthyFemaleRate, `${label}.healthyFemaleRate`),
    abnormalFemaleRate: numberOf(row.abnormalFemaleRate, `${label}.abnormalFemaleRate`),
    eggChickRatio: numberOf(row.eggChickRatio, `${label}.eggChickRatio`),
    chickWeight: numberOf(row.chickWeight, `${label}.chickWeight`),
    fertilizedHatchingRate: numberOf(row.fertilizedHatchingRate, `${label}.fertilizedHatchingRate`),
    excludedBloodFertilityRate: numberOf(row.excludedBloodFertilityRate, `${label}.excludedBloodFertilityRate`),
    satisfaction: numberOf(row.satisfaction, `${label}.satisfaction`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingStandardHatchPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '孵化健母率标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '孵化健母率标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('孵化健母率标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function ageStageOptionOf (value: unknown, index: number): ProductSettingStandardHatchAgeStageOption {
  const option = objectOf(value, `日龄段选项[${index}]`)
  return {
    id: idOf(option.id, `日龄段选项[${index}].id`),
    stage: textOf(option.stage, `日龄段选项[${index}].stage`),
  }
}

function ageStageOptionsOf (value: unknown): ProductSettingStandardHatchAgeStageOption[] {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return payload.map(ageStageOptionOf)
  const object = objectOf(payload, '日龄段选项响应')
  const list = object.list ?? object.data
  if (!Array.isArray(list)) throw new Error('日龄段选项响应必须是数组或包含list的对象')
  return list.map(ageStageOptionOf)
}

function rateOf (value: unknown, label: string, required: boolean): number | null {
  const number = boundedNumberOf(value, label, { required, min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX })
  return number === null ? null : number / 100
}

function createDraftOf (value: unknown): ProductSettingStandardHatchCreateDraft {
  const form = objectOf(value, '孵化健母率标准新建表单')
  return {
    year: requiredFormNumberOf(form.year, '年度', { min: 1970, max: FORM_NUMBER_MAX }),
    ageStage: requiredValueOf(form.ageStage, '日龄段'),
    gen: requiredTextOf(form.gen, '代次'),
    hall: requiredValueOf(form.hall, '孵化厅'),
    variety: requiredTextOf(form.variety, '品种'),
    genDown: genDownOf(form.genDown, '是否降代'),
    healthyFemaleRate: rateOf(form.healthyFemaleRate, '健母率标准', true)!,
    abnormalFemaleRate: rateOf(form.abnormalFemaleRate, '残母雏率标准', false),
    eggChickRatio: requiredFormNumberOf(form.eggChickRatio, '蛋雏比标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    chickWeight: requiredFormNumberOf(form.chickWeight, '雏鸡体重标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
    fertilizedHatchingRate: rateOf(form.fertilizedHatchingRate, '受精卵孵化率标准', true)!,
    excludedBloodFertilityRate: rateOf(form.excludedBloodFertilityRate, '不含血受精率标准', true)!,
    satisfaction: requiredFormNumberOf(form.satisfaction, '满意度标准', { min: FORM_NUMBER_MIN, max: FORM_NUMBER_MAX }),
  }
}

function payloadNumberOf (value: unknown, label: string): number {
  const number = numberOf(value, label)
  if (number === null) throw new Error(`${label}不能为空`)
  return number
}

function createPayloadOf (value: unknown): ProductSettingStandardHatchCreateDraft {
  const draft = objectOf(value, '孵化健母率标准新建草稿')
  return {
    ...draft,
    year: payloadNumberOf(draft.year, '年度'),
    ageStage: requiredValueOf(draft.ageStage, '日龄段'),
    gen: requiredTextOf(draft.gen, '代次'),
    hall: requiredValueOf(draft.hall, '孵化厅'),
    variety: requiredTextOf(draft.variety, '品种'),
    genDown: genDownOf(draft.genDown, '是否降代'),
    healthyFemaleRate: payloadNumberOf(draft.healthyFemaleRate, '健母率标准'),
    abnormalFemaleRate: numberOf(draft.abnormalFemaleRate, '残母雏率标准'),
    eggChickRatio: payloadNumberOf(draft.eggChickRatio, '蛋雏比标准'),
    chickWeight: payloadNumberOf(draft.chickWeight, '雏鸡体重标准'),
    fertilizedHatchingRate: payloadNumberOf(draft.fertilizedHatchingRate, '受精卵孵化率标准'),
    excludedBloodFertilityRate: payloadNumberOf(draft.excludedBloodFertilityRate, '不含血受精率标准'),
    satisfaction: payloadNumberOf(draft.satisfaction, '满意度标准'),
  }
}

function updateDraftOf (value: unknown): ProductSettingStandardHatchUpdateDraft {
  const form = objectOf(value, '孵化健母率标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '孵化健母率标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingStandardHatchUpdateDraft {
  const draft = objectOf(value, '孵化健母率标准编辑草稿')
  return { ...draft, ...createPayloadOf(draft), id: idOf(draft.id, '孵化健母率标准ID') }
}

/** The injected request must use PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH as its page context. */
export function createProductSettingStandardHatchCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingStandardHatchQuery = {}): Promise<ProductSettingStandardHatchPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    async ageStageOptions (): Promise<ProductSettingStandardHatchAgeStageOption[]> {
      return ageStageOptionsOf(await request({ url: AGE_STAGE_OPTIONS_URL, method: 'get' }))
    },

    prepareCreate (form: ProductSettingStandardHatchCreateForm): { draft: ProductSettingStandardHatchCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingStandardHatchCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingStandardHatchUpdateForm): { draft: ProductSettingStandardHatchUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingStandardHatchUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingStandardHatchRemoveInput): ProductSettingStandardHatchRemoveDraft {
      return { id: idOf(input?.id, '孵化健母率标准ID') }
    },

    async remove (input: ProductSettingStandardHatchRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '孵化健母率标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingStandardHatchCapability = ReturnType<typeof createProductSettingStandardHatchCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_STANDARD_HATCH_METHODS = {
  'product-setting-standard-hatch-list': 'list',
  'product-setting-standard-hatch-age-stage-options': 'ageStageOptions',
  'product-setting-standard-hatch-prepare-create': 'prepareCreate',
  'product-setting-standard-hatch-create': 'create',
  'product-setting-standard-hatch-prepare-update': 'prepareUpdate',
  'product-setting-standard-hatch-update': 'update',
  'product-setting-standard-hatch-prepare-remove': 'prepareRemove',
  'product-setting-standard-hatch-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、日龄段、代次、孵化厅、品种、是否降代、健母率、蛋雏比、雏鸡体重、受精卵孵化率、不含血受精率和满意度必填；残母雏率可为空；四个率按页面百分数填写' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，残母雏率可为空，四个率按页面百分数填写，并保留raw扩展字段' }

export const productSettingStandardHatchCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-standard-hatch-list', title: '查询孵化健母率标准', write: false, params: [p('ageStage', 'text', false, '日龄段筛选；默认空字符串'), p('hall', 'text', false, '孵化厅筛选；默认空字符串'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('variety', 'text', false, '品种筛选；默认空字符串'), p('year', 'text', false, '年度筛选；默认空字符串'), p('genDown', 'enum', false, '是否降代：0否、1是；默认0'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-standard-hatch-age-stage-options', title: '查询孵化健母率标准日龄段选项', write: false, params: [] },
  { id: 'product-setting-standard-hatch-prepare-create', title: '准备新建孵化健母率标准', write: false, params: [createFormParam] },
  { id: 'product-setting-standard-hatch-create', title: '新建孵化健母率标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的请求草稿；率字段已经从页面百分数转换为比例小数')] },
  { id: 'product-setting-standard-hatch-prepare-update', title: '准备编辑孵化健母率标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-standard-hatch-update', title: '编辑孵化健母率标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID请求草稿；率字段已经转换为比例小数')] },
  { id: 'product-setting-standard-hatch-prepare-remove', title: '准备删除孵化健母率标准', write: false, params: [p('id', 'text', true, '当前列表行的孵化健母率标准ID')] },
  { id: 'product-setting-standard-hatch-remove', title: '删除孵化健母率标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/standardHatch/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_STANDARD_HATCH_PAGE_PATH,
  permission: PRODUCT_SETTING_STANDARD_HATCH_PERMISSION,
  moduleType: PRODUCT_SETTING_STANDARD_HATCH_MODULE_TYPE,
  httpInstance: 'product',
}))
