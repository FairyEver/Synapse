import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 孵化日龄段标准」。 */
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH = '/dashboard/product/setting/standard-manage/egg-standard-age-stage/list'
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION = '/dashboard/frame/standard-library/egg-standard-age-stage'
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_MODULE_TYPE = null
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_QUERY_PERMISSION = 'base:egg-standard-age-stage:query'
export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_SUBMIT_PERMISSION = 'base:egg-standard-age-stage:submit'

const PAGE_URL = '/egg/standardAgeStage/page'
const SAVE_URL = '/egg/standardAgeStage/save'
const DELETE_URL_PREFIX = '/egg/standardAgeStage/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const AGE_MIN = 0
const AGE_MAX = 10_000_000

export type ProductSettingEggStandardAgeStageId = string | number
export type ProductSettingEggStandardAgeStageMoulting = 0 | 1

export type ProductSettingEggStandardAgeStageQuery = {
  moulting?: ProductSettingEggStandardAgeStageMoulting | string | number | null
  stage?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingEggStandardAgeStageRow = Record<string, unknown> & {
  id: ProductSettingEggStandardAgeStageId | null
  moulting: ProductSettingEggStandardAgeStageMoulting | null
  stage: string | null
  begin: number | null
  end: number | null
  updateByName: string | null
  updateDate: string | null
}

export type ProductSettingEggStandardAgeStagePage = {
  list: ProductSettingEggStandardAgeStageRow[]
  total: number
}

export type ProductSettingEggStandardAgeStageCreateForm = Record<string, unknown> & {
  moulting: ProductSettingEggStandardAgeStageMoulting | string | number
  stage: string
  begin: number | string
  end: number | string
}

export type ProductSettingEggStandardAgeStageCreateDraft = Record<string, unknown> & {
  moulting: ProductSettingEggStandardAgeStageMoulting
  stage: string
  begin: number
  end: number
}

export type ProductSettingEggStandardAgeStageUpdateForm = ProductSettingEggStandardAgeStageCreateForm & {
  id?: ProductSettingEggStandardAgeStageId | null | ''
}

export type ProductSettingEggStandardAgeStageUpdateDraft = Record<string, unknown> & ProductSettingEggStandardAgeStageCreateDraft & {
  id: ProductSettingEggStandardAgeStageId
}

export type ProductSettingEggStandardAgeStageRemoveInput = {
  id?: ProductSettingEggStandardAgeStageId | null | ''
}

export type ProductSettingEggStandardAgeStageRemoveDraft = {
  id: ProductSettingEggStandardAgeStageId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingEggStandardAgeStageId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingEggStandardAgeStageId | null {
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

function moultingOf (value: unknown, label: string, fallback?: ProductSettingEggStandardAgeStageMoulting): ProductSettingEggStandardAgeStageMoulting {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 0 && number !== 1) throw new Error(`是否换羽（${label}）只能是0（否）或1（是）`)
  return number as ProductSettingEggStandardAgeStageMoulting
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

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingEggStandardAgeStageQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    moulting: moultingOf(query.moulting, '是否换羽', 0),
    stage: query.stage === undefined || query.stage === null ? '' : textOf(query.stage, '日龄段') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingEggStandardAgeStageRow {
  const row = objectOf(value, `孵化日龄段标准列表[${index}]`)
  const label = `孵化日龄段标准列表[${index}]`
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    moulting: row.moulting === undefined || row.moulting === null || row.moulting === '' ? null : moultingOf(row.moulting, `${label}.moulting`),
    stage: textOf(row.stage, `${label}.stage`),
    begin: numberOf(row.begin, `${label}.begin`),
    end: numberOf(row.end, `${label}.end`),
    updateByName: textOf(row.updateByName, `${label}.updateByName`),
    updateDate: textOf(row.updateDate, `${label}.updateDate`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingEggStandardAgeStagePage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const envelope = objectOf(payload, '孵化日龄段标准分页响应')
  const page = objectOf(envelope.page ?? envelope, '孵化日龄段标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('孵化日龄段标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function createDraftOf (value: unknown): ProductSettingEggStandardAgeStageCreateDraft {
  const form = objectOf(value, '孵化日龄段标准新建表单')
  return {
    moulting: moultingOf(form.moulting, '是否换羽'),
    stage: requiredTextOf(form.stage, '日龄段'),
    begin: numberOf(form.begin, '母鸡起始日龄', { required: true, min: AGE_MIN, max: AGE_MAX })!,
    end: numberOf(form.end, '母鸡终止日龄', { required: true, min: AGE_MIN, max: AGE_MAX })!,
  }
}

function createPayloadOf (value: unknown): ProductSettingEggStandardAgeStageCreateDraft {
  return createDraftOf(value)
}

function updateDraftOf (value: unknown): ProductSettingEggStandardAgeStageUpdateDraft {
  const form = objectOf(value, '孵化日龄段标准编辑表单')
  return { ...form, ...createDraftOf(form), id: idOf(form.id, '孵化日龄段标准ID') }
}

function updatePayloadOf (value: unknown): ProductSettingEggStandardAgeStageUpdateDraft {
  const form = objectOf(value, '孵化日龄段标准编辑草稿')
  return { ...form, ...createPayloadOf(form), id: idOf(form.id, '孵化日龄段标准ID') }
}

/** The injected request must use PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH as its page context. */
export function createProductSettingEggStandardAgeStageCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingEggStandardAgeStageQuery = {}): Promise<ProductSettingEggStandardAgeStagePage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingEggStandardAgeStageCreateForm): { draft: ProductSettingEggStandardAgeStageCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingEggStandardAgeStageCreateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: createPayloadOf(input?.draft) })
      return true
    },

    prepareUpdate (form: ProductSettingEggStandardAgeStageUpdateForm): { draft: ProductSettingEggStandardAgeStageUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingEggStandardAgeStageUpdateDraft }): Promise<true> {
      await request({ url: SAVE_URL, method: 'post', data: updatePayloadOf(input?.draft) })
      return true
    },

    prepareRemove (input: ProductSettingEggStandardAgeStageRemoveInput): ProductSettingEggStandardAgeStageRemoveDraft {
      return { id: idOf(input?.id, '孵化日龄段标准ID') }
    },

    async remove (input: ProductSettingEggStandardAgeStageRemoveDraft): Promise<true> {
      await request({ url: `${DELETE_URL_PREFIX}${idOf(input?.id, '孵化日龄段标准ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingEggStandardAgeStageCapability = ReturnType<typeof createProductSettingEggStandardAgeStageCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_METHODS = {
  'product-setting-egg-standard-age-stage-list': 'list',
  'product-setting-egg-standard-age-stage-prepare-create': 'prepareCreate',
  'product-setting-egg-standard-age-stage-create': 'create',
  'product-setting-egg-standard-age-stage-prepare-update': 'prepareUpdate',
  'product-setting-egg-standard-age-stage-update': 'update',
  'product-setting-egg-standard-age-stage-prepare-remove': 'prepareRemove',
  'product-setting-egg-standard-age-stage-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；日龄段、起始日龄、终止日龄和是否换羽必填，日龄范围0至10000000' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗表单；必须包含当前行ID，并保留raw扩展字段' }

export const productSettingEggStandardAgeStageCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-egg-standard-age-stage-list', title: '查询孵化日龄段标准', write: false, params: [p('moulting', 'enum', false, '是否换羽：0否、1是；默认0'), p('stage', 'text', false, '日龄段前缀筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-egg-standard-age-stage-prepare-create', title: '准备新建孵化日龄段标准', write: false, params: [createFormParam] },
  { id: 'product-setting-egg-standard-age-stage-create', title: '新建孵化日龄段标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整请求草稿；确认后发送POST /egg/standardAgeStage/save')] },
  { id: 'product-setting-egg-standard-age-stage-prepare-update', title: '准备编辑孵化日龄段标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-egg-standard-age-stage-update', title: '编辑孵化日龄段标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID编辑草稿；确认后发送POST /egg/standardAgeStage/save')] },
  { id: 'product-setting-egg-standard-age-stage-prepare-remove', title: '准备删除孵化日龄段标准', write: false, params: [p('id', 'text', true, '当前列表行的孵化日龄段标准ID')] },
  { id: 'product-setting-egg-standard-age-stage-remove', title: '删除孵化日龄段标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /egg/standardAgeStage/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PAGE_PATH,
  permission: PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_PERMISSION,
  moduleType: PRODUCT_SETTING_EGG_STANDARD_AGE_STAGE_MODULE_TYPE,
  httpInstance: 'product',
}))
