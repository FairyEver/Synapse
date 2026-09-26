import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 标准库管理 → 抗体监测标准」。 */
export const PRODUCT_SETTING_ANTIBODY_PAGE_PATH = '/dashboard/product/setting/standard-manage/antibody/list'
export const PRODUCT_SETTING_ANTIBODY_PERMISSION = '/dashboard/frame/standard-library/antibody'
export const PRODUCT_SETTING_ANTIBODY_MODULE_TYPE = null

const PAGE_URL = '/base/antibody/page'
const SAVE_URL = '/base/antibody/save'
const DELETE_URL_PREFIX = '/base/antibody/'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const TYPE_OPTIONS = new Set([1, 2])
const EVALUATION_OPTIONS = new Set([-1, 0, 1])
const UI_NUMBER_MIN = -10_000_000
const UI_NUMBER_MAX = 10_000_000
const PAYLOAD_RATE_MIN = UI_NUMBER_MIN / 100
const PAYLOAD_RATE_MAX = UI_NUMBER_MAX / 100

export type ProductSettingAntibodyId = string | number
export type ProductSettingAntibodyType = 1 | 2
export type ProductSettingAntibodyEvaluation = -1 | 0 | 1

export type ProductSettingAntibodyQuery = {
  antibody?: string | null
  evaluation?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingAntibodyRow = Record<string, unknown> & {
  id: ProductSettingAntibodyId | null
  type: ProductSettingAntibodyType | null
  antibody: string | null
  upLimit: number | null
  downLimit: number | null
  upProtectionRate: number | null
  downProtectionRate: number | null
  protectionValue: number | null
  evaluation: ProductSettingAntibodyEvaluation | null
}

export type ProductSettingAntibodyPage = {
  list: ProductSettingAntibodyRow[]
  total: number
}

/** 页面输入值；三个保护字段使用页面显示的百分数，例：25 表示25%。 */
export type ProductSettingAntibodyCreateForm = {
  type: ProductSettingAntibodyType | string | number
  antibody: string
  upLimit?: number | null
  downLimit?: number | null
  upProtectionRate?: number | null
  downProtectionRate?: number | null
  protectionValue?: number | null
  evaluation: ProductSettingAntibodyEvaluation | string | number
}

/** Portal POST /base/antibody/save 的新建请求体。 */
export type ProductSettingAntibodyCreateDraft = {
  type: ProductSettingAntibodyType
  antibody: string
  upLimit: number
  downLimit: number
  upProtectionRate: number
  downProtectionRate: number
  protectionValue: number
  evaluation: ProductSettingAntibodyEvaluation
}

/** 编辑表单包含当前列表行，因此保留Portal的raw扩展字段。 */
export type ProductSettingAntibodyUpdateForm = Record<string, unknown> & ProductSettingAntibodyCreateForm & {
  id?: ProductSettingAntibodyId | null | ''
}

export type ProductSettingAntibodyUpdateDraft = Record<string, unknown> & ProductSettingAntibodyCreateDraft & {
  id: ProductSettingAntibodyId
}

export type ProductSettingAntibodyRemoveInput = {
  id?: ProductSettingAntibodyId | null | ''
}

export type ProductSettingAntibodyRemoveDraft = {
  id: ProductSettingAntibodyId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingAntibodyId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function optionalTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或空值`)
  return value
}

function typeOf (value: unknown): ProductSettingAntibodyType {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(number) || !TYPE_OPTIONS.has(number)) throw new Error('类型只能是1（育成鸡）或2（产蛋鸡）')
  return number as ProductSettingAntibodyType
}

function evaluationOf (value: unknown): ProductSettingAntibodyEvaluation {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(number) || !EVALUATION_OPTIONS.has(number)) throw new Error('评价只能是-1（差）、0（中）或1（优）')
  return number as ProductSettingAntibodyEvaluation
}

function queryEvaluationOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' && Number.isInteger(value) && EVALUATION_OPTIONS.has(value)) return value
  if (typeof value === 'string' && EVALUATION_OPTIONS.has(Number(value))) return value
  throw new Error('评价筛选只能是-1、0或1')
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function uiNumberOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < UI_NUMBER_MIN || value > UI_NUMBER_MAX) {
    throw new Error(`${label}必须是${UI_NUMBER_MIN}至${UI_NUMBER_MAX}之间的数字`)
  }
  return value
}

function payloadNumberOf (value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}必须是${min}至${max}之间的数字`)
  }
  return value
}

function payloadRateOf (value: unknown, label: string): number {
  return payloadNumberOf(value, label, PAYLOAD_RATE_MIN, PAYLOAD_RATE_MAX)
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function nullableIdOf (value: unknown, label: string): ProductSettingAntibodyId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTypeOf (value: unknown, label: string): ProductSettingAntibodyType | null {
  if (value === undefined || value === null || value === '') return null
  try {
    return typeOf(value)
  } catch {
    throw new Error(`类型（${label}）只能是1（育成鸡）或2（产蛋鸡）或null`)
  }
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为数字或null`)
  return value
}

function nullableEvaluationOf (value: unknown, label: string): ProductSettingAntibodyEvaluation | null {
  if (value === undefined || value === null || value === '') return null
  try {
    return evaluationOf(value)
  } catch {
    throw new Error(`${label}只能是-1（差）、0（中）或1（优）或null`)
  }
}

function rowOf (value: unknown, index: number): ProductSettingAntibodyRow {
  const row = objectOf(value, `抗体监测标准列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `抗体监测标准列表[${index}].id`),
    type: nullableTypeOf(row.type, `抗体监测标准列表[${index}].type`),
    antibody: row.antibody === undefined || row.antibody === null ? null : optionalTextOf(row.antibody, `抗体监测标准列表[${index}].antibody`),
    upLimit: nullableNumberOf(row.upLimit, `抗体监测标准列表[${index}].upLimit`),
    downLimit: nullableNumberOf(row.downLimit, `抗体监测标准列表[${index}].downLimit`),
    upProtectionRate: nullableNumberOf(row.upProtectionRate, `抗体监测标准列表[${index}].upProtectionRate`),
    downProtectionRate: nullableNumberOf(row.downProtectionRate, `抗体监测标准列表[${index}].downProtectionRate`),
    protectionValue: nullableNumberOf(row.protectionValue, `抗体监测标准列表[${index}].protectionValue`),
    evaluation: nullableEvaluationOf(row.evaluation, `抗体监测标准列表[${index}].evaluation`),
  }
}

function pageOf (value: unknown): ProductSettingAntibodyPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const object = objectOf(payload, '抗体监测标准分页响应')
  const page = objectOf(object.page ?? object, '抗体监测标准分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('抗体监测标准分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingAntibodyQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    antibody: optionalTextOf(query.antibody, '个体抗体项目'),
    evaluation: queryEvaluationOf(query.evaluation),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createDraftOf (value: unknown): ProductSettingAntibodyCreateDraft {
  const form = objectOf(value, '抗体监测标准新建表单')
  return {
    type: typeOf(form.type),
    antibody: requiredTextOf(form.antibody, '抗体监测项目名'),
    upLimit: uiNumberOf(form.upLimit, '均值起'),
    downLimit: uiNumberOf(form.downLimit, '均值止'),
    upProtectionRate: uiNumberOf(form.upProtectionRate, '保护率起') / 100,
    downProtectionRate: uiNumberOf(form.downProtectionRate, '保护率止') / 100,
    protectionValue: uiNumberOf(form.protectionValue, '个体保护值') / 100,
    evaluation: evaluationOf(form.evaluation),
  }
}

function createPayloadOf (value: unknown): ProductSettingAntibodyCreateDraft {
  const form = objectOf(value, '抗体监测标准新建草稿')
  return {
    type: typeOf(form.type),
    antibody: requiredTextOf(form.antibody, '抗体监测项目名'),
    upLimit: payloadNumberOf(form.upLimit, '均值起', UI_NUMBER_MIN, UI_NUMBER_MAX),
    downLimit: payloadNumberOf(form.downLimit, '均值止', UI_NUMBER_MIN, UI_NUMBER_MAX),
    upProtectionRate: payloadRateOf(form.upProtectionRate, '保护率起'),
    downProtectionRate: payloadRateOf(form.downProtectionRate, '保护率止'),
    protectionValue: payloadRateOf(form.protectionValue, '个体保护值'),
    evaluation: evaluationOf(form.evaluation),
  }
}

function updateDraftOf (value: unknown): ProductSettingAntibodyUpdateDraft {
  const form = objectOf(value, '抗体监测标准编辑表单')
  return {
    ...form,
    id: idOf(form.id, '抗体监测标准ID'),
    type: typeOf(form.type),
    antibody: requiredTextOf(form.antibody, '抗体监测项目名'),
    upLimit: uiNumberOf(form.upLimit, '均值起'),
    downLimit: uiNumberOf(form.downLimit, '均值止'),
    upProtectionRate: uiNumberOf(form.upProtectionRate, '保护率起') / 100,
    downProtectionRate: uiNumberOf(form.downProtectionRate, '保护率止') / 100,
    protectionValue: uiNumberOf(form.protectionValue, '个体保护值') / 100,
    evaluation: evaluationOf(form.evaluation),
  }
}

function updatePayloadOf (value: unknown): ProductSettingAntibodyUpdateDraft {
  const form = objectOf(value, '抗体监测标准编辑草稿')
  return {
    ...form,
    id: idOf(form.id, '抗体监测标准ID'),
    type: typeOf(form.type),
    antibody: requiredTextOf(form.antibody, '抗体监测项目名'),
    upLimit: payloadNumberOf(form.upLimit, '均值起', UI_NUMBER_MIN, UI_NUMBER_MAX),
    downLimit: payloadNumberOf(form.downLimit, '均值止', UI_NUMBER_MIN, UI_NUMBER_MAX),
    upProtectionRate: payloadRateOf(form.upProtectionRate, '保护率起'),
    downProtectionRate: payloadRateOf(form.downProtectionRate, '保护率止'),
    protectionValue: payloadRateOf(form.protectionValue, '个体保护值'),
    evaluation: evaluationOf(form.evaluation),
  }
}

function removeIdOf (value: unknown): ProductSettingAntibodyId {
  return idOf(value, '抗体监测标准ID')
}

/** The injected request must use PRODUCT_SETTING_ANTIBODY_PAGE_PATH as its page context. */
export function createProductSettingAntibodyCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingAntibodyQuery = {}): Promise<ProductSettingAntibodyPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingAntibodyCreateForm): { draft: ProductSettingAntibodyCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: { draft: ProductSettingAntibodyCreateDraft }): Promise<true> {
      const draft = createPayloadOf(input?.draft)
      await request({ url: SAVE_URL, method: 'post', data: draft })
      return true
    },

    prepareUpdate (form: ProductSettingAntibodyUpdateForm): { draft: ProductSettingAntibodyUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingAntibodyUpdateDraft }): Promise<true> {
      const draft = updatePayloadOf(input?.draft)
      await request({ url: SAVE_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: ProductSettingAntibodyRemoveInput): ProductSettingAntibodyRemoveDraft {
      return { id: removeIdOf(input?.id) }
    },

    async remove (input: ProductSettingAntibodyRemoveDraft): Promise<true> {
      const id = removeIdOf(input?.id)
      await request({ url: `${DELETE_URL_PREFIX}${id}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingAntibodyCapability = ReturnType<typeof createProductSettingAntibodyCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_ANTIBODY_METHODS = {
  'product-setting-antibody-list': 'list',
  'product-setting-antibody-prepare-create': 'prepareCreate',
  'product-setting-antibody-create': 'create',
  'product-setting-antibody-prepare-update': 'prepareUpdate',
  'product-setting-antibody-update': 'update',
  'product-setting-antibody-prepare-remove': 'prepareRemove',
  'product-setting-antibody-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal新建弹窗表单；类型、抗体监测项目名和评价必填，三个保护字段按页面百分数填写，其他数值空值按0提交' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal编辑弹窗提交对象；必须包含当前列表行ID，三个保护字段按页面百分数填写，并保留raw扩展字段' }

export const productSettingAntibodyCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-antibody-list', title: '查询抗体监测标准', write: false, params: [p('antibody', 'text', false, '个体抗体项目筛选；默认发送空字符串'), p('evaluation', 'enum', false, '评价筛选：-1差、0中、1优；默认发送空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-antibody-prepare-create', title: '准备新建抗体监测标准', write: false, params: [createFormParam] },
  { id: 'product-setting-antibody-create', title: '新建抗体监测标准', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整请求草稿；确认后发送POST /base/antibody/save')] },
  { id: 'product-setting-antibody-prepare-update', title: '准备编辑抗体监测标准', write: false, params: [updateFormParam] },
  { id: 'product-setting-antibody-update', title: '编辑抗体监测标准', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的含ID编辑草稿；确认后发送POST /base/antibody/save')] },
  { id: 'product-setting-antibody-prepare-remove', title: '准备删除抗体监测标准', write: false, params: [p('id', 'text', true, '当前列表行的抗体监测标准ID')] },
  { id: 'product-setting-antibody-remove', title: '删除抗体监测标准', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ID；确认后发送DELETE /base/antibody/{id}')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_ANTIBODY_PAGE_PATH,
  permission: PRODUCT_SETTING_ANTIBODY_PERMISSION,
  moduleType: PRODUCT_SETTING_ANTIBODY_MODULE_TYPE,
  httpInstance: 'product',
}))
