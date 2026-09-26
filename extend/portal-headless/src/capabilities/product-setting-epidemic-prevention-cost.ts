import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 只鸡防疫成本标准」。 */
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH = '/dashboard/product/setting/standard-manage/epidemic-prevention-cost/list'
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION = '/dashboard/frame/standard-library/epidemic-prevention-cost'
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_MODULE_TYPE = null
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_QUERY_PERMISSION = 'base:epidemic-prevention-cost:query'
export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_SUBMIT_PERMISSION = 'base:epidemic-prevention-cost:submit'

const PAGE_URL = '/base/epidemicPreventionCost/page'
const SAVE_URL = '/base/epidemicPreventionCost/save'
const DELETE_URL_PREFIX = '/base/epidemicPreventionCost/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const NUMBER_MIN = -10_000_000
const NUMBER_MAX = 10_000_000

export type ProductSettingEpidemicPreventionCostId = string | number
export type ProductSettingEpidemicPreventionCostMoulting = 0 | 1

export type ProductSettingEpidemicPreventionCostQuery = {
  farm?: string | number | null
  year?: string | number | null
  moulting?: ProductSettingEpidemicPreventionCostMoulting | string | number | null
  gen?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingEpidemicPreventionCostRow = Record<string, unknown> & {
  id: ProductSettingEpidemicPreventionCostId | null
  year: number | null
  moulting: ProductSettingEpidemicPreventionCostMoulting | null
  weekAgeBegin: number | null
  weekAgeEnd: number | null
  farm: string | null
  farmName: string | null
  gen: string | null
  genName: string | null
  vaccineUnitCost: number | null
  veterinaryDrugUnitCost: number | null
  disinfectantUnitCost: number | null
  satisfaction: number | null
}

export type ProductSettingEpidemicPreventionCostPage = {
  list: ProductSettingEpidemicPreventionCostRow[]
  total: number
}

export type ProductSettingEpidemicPreventionCostCreateForm = Record<string, unknown> & {
  year: number | string
  weekAgeBegin: number | string
  weekAgeEnd: number | string
  gen: string | number
  farm: string | number
  vaccineUnitCost: number | string
  veterinaryDrugUnitCost: number | string
  disinfectantUnitCost: number | string
  moulting: ProductSettingEpidemicPreventionCostMoulting | string | number
}

export type ProductSettingEpidemicPreventionCostCreateDraft = Record<string, unknown> & {
  year: number
  weekAgeBegin: number
  weekAgeEnd: number
  gen: number
  farm: string | number
  vaccineUnitCost: number
  veterinaryDrugUnitCost: number
  disinfectantUnitCost: number
  moulting: ProductSettingEpidemicPreventionCostMoulting
}

export type ProductSettingEpidemicPreventionCostUpdateForm = ProductSettingEpidemicPreventionCostCreateForm & {
  id?: ProductSettingEpidemicPreventionCostId | null | ''
}

export type ProductSettingEpidemicPreventionCostUpdateDraft = Record<string, unknown> & ProductSettingEpidemicPreventionCostCreateDraft & {
  id: ProductSettingEpidemicPreventionCostId
}

export type ProductSettingEpidemicPreventionCostRemoveInput = {
  id?: ProductSettingEpidemicPreventionCostId | null | ''
}

export type ProductSettingEpidemicPreventionCostRemoveDraft = {
  id: ProductSettingEpidemicPreventionCostId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingEpidemicPreventionCostId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingEpidemicPreventionCostId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function optionalQueryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串、数字或空值`)
  return value
}

function requiredValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串或数字`)
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function numberOf (value: unknown, label: string, options: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label}必须为数字`)
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  return number
}

function requiredNumberOf (value: unknown, label: string): number {
  return numberOf(value, label, { required: true, min: NUMBER_MIN, max: NUMBER_MAX })!
}

function moultingOf (value: unknown, label: string, fallback?: ProductSettingEpidemicPreventionCostMoulting): ProductSettingEpidemicPreventionCostMoulting {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 0 && number !== 1) throw new Error(`是否换羽（${label}）只能是0（否）或1（是）`)
  return number as ProductSettingEpidemicPreventionCostMoulting
}

function genOf (value: unknown, label: string): number {
  const required = requiredValueOf(value, label)
  const number = typeof required === 'number' ? required : Number(required)
  if (!Number.isFinite(number)) throw new Error(`${label}必须能转换为数字`)
  return number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingEpidemicPreventionCostQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    farm: optionalQueryValueOf(query.farm, '场区'),
    year: optionalQueryValueOf(query.year, '年度'),
    moulting: moultingOf(query.moulting, '是否换羽', 0),
    gen: optionalQueryValueOf(query.gen, '代次'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingEpidemicPreventionCostRow {
  const row = objectOf(value, `只鸡防疫成本标准列表[${index}]`)
  const label = `只鸡防疫成本标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    year: numberOf(row.year, `${label}.year`),
    moulting: row.moulting === undefined || row.moulting === null || row.moulting === '' ? null : moultingOf(row.moulting, `${label}.moulting`),
    weekAgeBegin: numberOf(row.weekAgeBegin, `${label}.weekAgeBegin`),
    weekAgeEnd: numberOf(row.weekAgeEnd, `${label}.weekAgeEnd`),
    farm: textOf(row.farm, `${label}.farm`),
    farmName: textOf(row.farmName, `${label}.farmName`),
    gen: textOf(row.gen, `${label}.gen`),
    genName: textOf(row.genName, `${label}.genName`),
    vaccineUnitCost: numberOf(row.vaccineUnitCost, `${label}.vaccineUnitCost`),
    veterinaryDrugUnitCost: numberOf(row.veterinaryDrugUnitCost, `${label}.veterinaryDrugUnitCost`),
    disinfectantUnitCost: numberOf(row.disinfectantUnitCost, `${label}.disinfectantUnitCost`),
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

function pageOf (value: unknown): ProductSettingEpidemicPreventionCostPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '只鸡防疫成本标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '只鸡防疫成本标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('只鸡防疫成本标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function draftOf (value: unknown, label: string): ProductSettingEpidemicPreventionCostCreateDraft {
  const form = objectOf(value, label)
  return {
    year: requiredNumberOf(form.year, '年度'),
    weekAgeBegin: requiredNumberOf(form.weekAgeBegin, '周龄起始'),
    weekAgeEnd: requiredNumberOf(form.weekAgeEnd, '周龄终止'),
    gen: genOf(form.gen, '代次'),
    farm: requiredValueOf(form.farm, '场区'),
    vaccineUnitCost: requiredNumberOf(form.vaccineUnitCost, '只鸡疫苗成本标准'),
    veterinaryDrugUnitCost: requiredNumberOf(form.veterinaryDrugUnitCost, '只鸡兽药成本标准'),
    disinfectantUnitCost: requiredNumberOf(form.disinfectantUnitCost, '只鸡消毒药成本标准'),
    moulting: moultingOf(form.moulting, '是否换羽'),
  }
}

function createDraftOf (value: unknown): ProductSettingEpidemicPreventionCostCreateDraft {
  return draftOf(value, '只鸡防疫成本标准新建表单')
}

function updateDraftOf (value: unknown): ProductSettingEpidemicPreventionCostUpdateDraft {
  const form = objectOf(value, '只鸡防疫成本标准编辑表单')
  return { ...form, ...draftOf(form, '只鸡防疫成本标准编辑表单'), id: idOf(form.id, '只鸡防疫成本标准ID') }
}

/** The injected request must use PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH as its page context. */
export function createProductSettingEpidemicPreventionCostCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingEpidemicPreventionCostQuery = {}): Promise<ProductSettingEpidemicPreventionCostPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingEpidemicPreventionCostCreateForm): { draft: ProductSettingEpidemicPreventionCostCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingEpidemicPreventionCostCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: draftOf(input?.draft, '只鸡防疫成本标准新建草稿') })
      return true
    },

    prepareUpdate (form: ProductSettingEpidemicPreventionCostUpdateForm): { draft: ProductSettingEpidemicPreventionCostUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingEpidemicPreventionCostUpdateDraft }): Promise<true> {
      const draft = objectOf(input?.draft, '只鸡防疫成本标准编辑草稿')
      await request({ url: SAVE_URL, method: 'post', data: { ...draft, ...draftOf(draft, '只鸡防疫成本标准编辑草稿'), id: idOf(draft.id, '只鸡防疫成本标准ID') } })
      return true
    },

    prepareRemove (input: ProductSettingEpidemicPreventionCostRemoveInput): ProductSettingEpidemicPreventionCostRemoveDraft {
      return { id: idOf(input?.id, '只鸡防疫成本标准ID') }
    },

    async remove (input: ProductSettingEpidemicPreventionCostRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '只鸡防疫成本标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingEpidemicPreventionCostCapability = ReturnType<typeof createProductSettingEpidemicPreventionCostCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_METHODS = {
  'product-setting-epidemic-prevention-cost-list': 'list',
  'product-setting-epidemic-prevention-cost-prepare-create': 'prepareCreate',
  'product-setting-epidemic-prevention-cost-create': 'create',
  'product-setting-epidemic-prevention-cost-prepare-update': 'prepareUpdate',
  'product-setting-epidemic-prevention-cost-update': 'update',
  'product-setting-epidemic-prevention-cost-prepare-remove': 'prepareRemove',
  'product-setting-epidemic-prevention-cost-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；年度、周龄起止、代次、场区、三项成本和是否换羽均必填' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，代次按Number转换，并保留raw扩展字段' }

export const productSettingEpidemicPreventionCostCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-epidemic-prevention-cost-list', title: '查询只鸡防疫成本标准', write: false, params: [p('farm', 'text', false, '场区筛选；默认空字符串'), p('year', 'text', false, '年度筛选；默认空字符串'), p('moulting', 'enum', false, '是否换羽：0否、1是；默认0'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-epidemic-prevention-cost-prepare-create', title: '准备新建只鸡防疫成本标准', write: false, params: [createFormParam] },
  { id: 'product-setting-epidemic-prevention-cost-create', title: '新建只鸡防疫成本标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整请求草稿；确认后发送POST /base/epidemicPreventionCost/save')] },
  { id: 'product-setting-epidemic-prevention-cost-prepare-update', title: '准备编辑只鸡防疫成本标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-epidemic-prevention-cost-update', title: '编辑只鸡防疫成本标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID编辑草稿；确认后发送POST /base/epidemicPreventionCost/save')] },
  { id: 'product-setting-epidemic-prevention-cost-prepare-remove', title: '准备删除只鸡防疫成本标准', write: false, params: [p('id', 'text', true, '当前列表行的只鸡防疫成本标准ID')] },
  { id: 'product-setting-epidemic-prevention-cost-remove', title: '删除只鸡防疫成本标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/epidemicPreventionCost/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PAGE_PATH,
  permission: PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_PERMISSION,
  moduleType: PRODUCT_SETTING_EPIDEMIC_PREVENTION_COST_MODULE_TYPE,
  httpInstance: 'product',
}))
