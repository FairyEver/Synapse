import type { AxiosResponse } from 'axios'
import { Buffer } from 'node:buffer'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 孵化预案 → 标准库 → 查看标准」隐藏指标页。 */
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH = '/dashboard/product/setting/hatch-manage/lib/indicator/list'
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION = '/dashboard/frame/hatchery-plan/lib'
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_MODULE_TYPE = null
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_QUERY_PERMISSION = 'program:suite-indicator:query'
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_SUBMIT_PERMISSION = 'program:suite-indicator:submit'
export const PRODUCT_HATCHERY_STANDARD_INDICATOR_DELETE_PERMISSION = 'program:suite-indicator:delete'

const TRAIT_OPTIONS_URL = '/programUnit/getTraitList'
const LIST_URL = '/programNew/standardLib/getTraitPage'
const CREATE_URL = '/programNew/standardLib/createTrait'
const UPDATE_URL = '/programNew/standardLib/editTrait'
const DELETE_URL = '/programNew/standardLib/deleteTrait'
const EXPORT_URL = '/programNew/standardLib/exportStandardLib'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const CONTENT_TYPES = [1, 2, 3] as const

export type ProductHatcheryStandardIndicatorId = string
export type ProductHatcheryStandardIndicatorContentType = (typeof CONTENT_TYPES)[number]
export type ProductHatcheryStandardIndicatorFlag = 0 | 1

export type ProductHatcheryStandardIndicatorQuery = {
  traitType?: string | number | null
  traitCode?: string | null
  age?: number | null
  suiteCode?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductHatcheryStandardIndicatorTraitOption = Record<string, unknown> & {
  label: string | null
  value: string
  contentType: number | null
  unit: string | null
  scale: number | null
}

export type ProductHatcheryStandardIndicatorRow = Record<string, unknown> & {
  id: ProductHatcheryStandardIndicatorId | null
  suiteCode: string | null
  traitCode: string | null
  traitName: string | null
  traitType: string | number | null
  traitTypeName: string | null
  age: number | null
  ageType: number | null
  contentType: number | null
  contentTypeName: string | null
  scale: number | null
  unit: string | null
  min: number | null
  max: number | null
  txt: string | null
  flag: number | null
}

export type ProductHatcheryStandardIndicatorPage = {
  list: ProductHatcheryStandardIndicatorRow[]
  total: number
}

export type ProductHatcheryStandardIndicatorForm = Record<string, unknown> & {
  id?: ProductHatcheryStandardIndicatorId | null
  suiteCode: string
  traitType: string | number
  traitCode: string
  contentType: ProductHatcheryStandardIndicatorContentType
  unit?: string | null
  scale?: number | null
  age: number
  min?: number | null
  max?: number | null
  txt: string
}

export type ProductHatcheryStandardIndicatorCreateDraft = ProductHatcheryStandardIndicatorForm & {
  id?: undefined
}

export type ProductHatcheryStandardIndicatorUpdateDraft = ProductHatcheryStandardIndicatorForm & {
  id: ProductHatcheryStandardIndicatorId
  flag: 1
}

export type ProductHatcheryStandardIndicatorCreateResult =
  | { status: 'submitted' }
  | { status: 'conflict'; flag: 1 }

export type ProductHatcheryStandardIndicatorFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
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

function valueOf (value: unknown, label: string): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空字符串或数字`)
}

function idOf (value: unknown, label: string): ProductHatcheryStandardIndicatorId {
  return requiredTextOf(value, label)
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为数字或null`)
  return value
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  const number = nullableNumberOf(value, label)
  if (number !== null && !Number.isSafeInteger(number)) throw new Error(`${label}必须为整数或null`)
  return number
}

function queryValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null) return ''
  return valueOf(value, label)
}

function ageOf (value: unknown, label: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const age = nullableIntegerOf(value, label)
  if (age === null || age < 1 || age > 700) throw new Error(`${label}必须在1到700之间`)
  return age
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function contentTypeOf (value: unknown, label: string): ProductHatcheryStandardIndicatorContentType {
  if (CONTENT_TYPES.includes(value as ProductHatcheryStandardIndicatorContentType)) return value as ProductHatcheryStandardIndicatorContentType
  throw new Error(`${label}只能是1（文本）、2（富文本）或3（数值）`)
}

function pageOf (value: unknown): ProductHatcheryStandardIndicatorPage {
  const envelope = objectOf(payloadOf(value), '标准指标分页响应')
  const page = objectOf(envelope.page ?? envelope, '标准指标分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('标准指标分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function rowOf (value: unknown, index: number): ProductHatcheryStandardIndicatorRow {
  const row = objectOf(value, `标准指标列表[${index}]`)
  const label = `标准指标列表[${index}]`
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    suiteCode: textOf(row.suiteCode, `${label}.suiteCode`),
    traitCode: textOf(row.traitCode, `${label}.traitCode`),
    traitName: textOf(row.traitName, `${label}.traitName`),
    traitType: row.traitType === undefined || row.traitType === null || row.traitType === '' ? null : valueOf(row.traitType, `${label}.traitType`),
    traitTypeName: textOf(row.traitTypeName, `${label}.traitTypeName`),
    age: nullableIntegerOf(row.age, `${label}.age`),
    ageType: nullableIntegerOf(row.ageType, `${label}.ageType`),
    contentType: nullableIntegerOf(row.contentType, `${label}.contentType`),
    contentTypeName: textOf(row.contentTypeName, `${label}.contentTypeName`),
    scale: nullableIntegerOf(row.scale, `${label}.scale`),
    unit: textOf(row.unit, `${label}.unit`),
    min: nullableNumberOf(row.min, `${label}.min`),
    max: nullableNumberOf(row.max, `${label}.max`),
    txt: textOf(row.txt, `${label}.txt`),
    flag: nullableIntegerOf(row.flag, `${label}.flag`),
  }
}

function traitOptionOf (value: unknown, index: number): ProductHatcheryStandardIndicatorTraitOption {
  const item = objectOf(value, `指标名称选项[${index}]`)
  const code = requiredTextOf(item.code, `指标名称选项[${index}].code`)
  return {
    ...item,
    label: textOf(item.name, `指标名称选项[${index}].name`),
    value: code,
    contentType: nullableIntegerOf(item.contentType, `指标名称选项[${index}].contentType`),
    unit: textOf(item.unit, `指标名称选项[${index}].unit`),
    scale: nullableIntegerOf(item.scale, `指标名称选项[${index}].scale`),
  }
}

function traitOptionsOf (value: unknown): ProductHatcheryStandardIndicatorTraitOption[] {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return payload.map(traitOptionOf)
  const object = objectOf(payload, '指标名称选项响应')
  const list = object.list ?? object.records ?? object.rows
  if (!Array.isArray(list)) throw new Error('指标名称选项响应缺少list数组')
  return list.map(traitOptionOf)
}

function queryOf (query: ProductHatcheryStandardIndicatorQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    traitType: queryValueOf(query.traitType, '指标归类'),
    traitCode: query.traitCode === undefined || query.traitCode === null ? '' : textOf(query.traitCode, '指标名称') ?? '',
    age: query.age === undefined ? undefined : ageOf(query.age, '日龄', false),
    suiteCode: query.suiteCode === undefined || query.suiteCode === null ? '' : textOf(query.suiteCode, '标准库suiteCode') ?? '',
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportParamsOf (query: ProductHatcheryStandardIndicatorQuery): Record<string, unknown> {
  const params = queryOf(query)
  delete params.order
  delete params.orderField
  delete params.pageNo
  delete params.pageSize
  return params
}

function traitTypeOf (value: unknown): string | number {
  return valueOf(value, '指标归类')
}

function formNumberOf (value: unknown, label: string, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = nullableNumberOf(value, label)
  return number
}

function formOf (value: unknown, mode: 'create' | 'update'): ProductHatcheryStandardIndicatorCreateDraft | ProductHatcheryStandardIndicatorUpdateDraft {
  const form = objectOf(value, '标准指标表单')
  const contentType = contentTypeOf(form.contentType, '文本类型')
  const txt = requiredTextOf(form.txt, '标准内容')
  const min = formNumberOf(form.min, '最小值', contentType === 3)
  const max = formNumberOf(form.max, '最大值', contentType === 3)
  if (contentType === 3 && min !== null && max !== null && min > max) throw new Error('最小值不能超过最大值')
  const base = {
    ...(mode === 'update' ? { id: idOf(form.id, '标准指标ID') } : { id: undefined }),
    suiteCode: requiredTextOf(form.suiteCode, 'suiteCode'),
    traitType: traitTypeOf(form.traitType),
    traitCode: requiredTextOf(form.traitCode, '指标名称'),
    contentType,
    unit: form.unit === undefined || form.unit === null ? '' : requiredTextOf(form.unit, '单位'),
    scale: formNumberOf(form.scale, '小数位数', false),
    age: ageOf(form.age, '日龄', true) as number,
    min: contentType === 3 ? min : undefined,
    max: contentType === 3 ? max : undefined,
    txt,
  }
  if (mode === 'update') return { ...base, flag: 1 } as ProductHatcheryStandardIndicatorUpdateDraft
  return base as ProductHatcheryStandardIndicatorCreateDraft
}

function flagOf (value: unknown): ProductHatcheryStandardIndicatorFlag {
  if (value === 0 || value === 1) return value
  throw new Error('flag只能是0（先检查冲突）或1（覆盖）')
}

function removeInputOf (value: unknown): { id: ProductHatcheryStandardIndicatorId } {
  const input = objectOf(value, '标准指标删除参数')
  return { id: idOf(input.id, '标准指标ID') }
}

function base64FileOf (response: AxiosResponse<ArrayBuffer>): ProductHatcheryStandardIndicatorFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('标准库标准导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const text = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(text)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(text)?.[1]
  let fileName = '标准库标准.xlsx'
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else if (plain) fileName = plain
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function conflictOf (value: unknown): boolean {
  if (value === 1) return true
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return (value as JsonObject).flag === 1
  return false
}

/** The injected request must use PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH as page context. */
export function createProductHatcheryStandardIndicatorCapability (request: PortalRequest) {
  return {
    async traitOptions (input: { traitType: string | number }): Promise<ProductHatcheryStandardIndicatorTraitOption[]> {
      const traitType = traitTypeOf(input?.traitType)
      return traitOptionsOf(await request({ url: TRAIT_OPTIONS_URL, method: 'get', params: { classification: traitType } }))
    },

    async list (query: ProductHatcheryStandardIndicatorQuery = {}): Promise<ProductHatcheryStandardIndicatorPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductHatcheryStandardIndicatorForm): { draft: ProductHatcheryStandardIndicatorCreateDraft } {
      return { draft: formOf(form, 'create') as ProductHatcheryStandardIndicatorCreateDraft }
    },

    async create (input: { draft: ProductHatcheryStandardIndicatorCreateDraft; flag?: ProductHatcheryStandardIndicatorFlag }): Promise<ProductHatcheryStandardIndicatorCreateResult> {
      const draft = formOf(input?.draft, 'create') as ProductHatcheryStandardIndicatorCreateDraft
      const flag = input?.flag === undefined ? 0 : flagOf(input.flag)
      const result = await request({ url: CREATE_URL, method: 'post', data: { ...draft, flag } })
      return flag === 0 && conflictOf(result) ? { status: 'conflict', flag: 1 } : { status: 'submitted' }
    },

    prepareUpdate (form: ProductHatcheryStandardIndicatorForm): { draft: ProductHatcheryStandardIndicatorUpdateDraft } {
      return { draft: formOf(form, 'update') as ProductHatcheryStandardIndicatorUpdateDraft }
    },

    async update (input: { draft: ProductHatcheryStandardIndicatorUpdateDraft }): Promise<true> {
      const draft = formOf(input?.draft, 'update') as ProductHatcheryStandardIndicatorUpdateDraft
      await request({ url: UPDATE_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: { id: ProductHatcheryStandardIndicatorId }): { id: ProductHatcheryStandardIndicatorId } {
      return removeInputOf(input)
    },

    async remove (input: { id: ProductHatcheryStandardIndicatorId }): Promise<true> {
      const target = removeInputOf(input)
      await request({ url: DELETE_URL, method: 'get', params: target })
      return true
    },

    async exportData (query: ProductHatcheryStandardIndicatorQuery): Promise<ProductHatcheryStandardIndicatorFile> {
      const params = exportParamsOf(query)
      if (typeof params.suiteCode !== 'string' || params.suiteCode.trim() === '') throw new Error('suiteCode不能为空')
      return base64FileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params, responseType: 'arraybuffer' }))
    },
  }
}

export type ProductHatcheryStandardIndicatorCapability = ReturnType<typeof createProductHatcheryStandardIndicatorCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_HATCHERY_STANDARD_INDICATOR_METHODS = {
  'product-hatchery-standard-indicator-trait-options': 'traitOptions',
  'product-hatchery-standard-indicator-list': 'list',
  'product-hatchery-standard-indicator-prepare-create': 'prepareCreate',
  'product-hatchery-standard-indicator-create': 'create',
  'product-hatchery-standard-indicator-prepare-update': 'prepareUpdate',
  'product-hatchery-standard-indicator-update': 'update',
  'product-hatchery-standard-indicator-prepare-remove': 'prepareRemove',
  'product-hatchery-standard-indicator-remove': 'remove',
  'product-hatchery-standard-indicator-export': 'exportData',
} as const

const formParam = p('form', 'text', true, '来自Portal指标弹窗提交事件的完整表单；suiteCode、指标归类、指标名称、文本类型、日龄和标准内容必填，数值型还需最小值和最大值。')

export const productHatcheryStandardIndicatorCapabilities: CapabilityDefinition[] = [
  { id: 'product-hatchery-standard-indicator-trait-options', title: '查询标准指标名称选项', write: false, params: [p('traitType', 'text', true, '指标归类字典值；来自standard_class平台字典')] },
  { id: 'product-hatchery-standard-indicator-list', title: '查询孵化预案标准指标', write: false, params: [p('traitType', 'text', false, '指标归类字典值；页面正常加载时取standard_class首项'), p('traitCode', 'text', false, '指标编码；默认空字符串'), p('age', 'number', false, '日龄；省略时不按日龄筛选'), p('suiteCode', 'text', false, '来源标准库行的suiteCode；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-hatchery-standard-indicator-prepare-create', title: '准备新建标准指标', write: false, params: [formParam] },
  { id: 'product-hatchery-standard-indicator-create', title: '新建标准指标', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的标准指标草稿'), p('flag', 'enum', false, '首次为0或省略；冲突后用户确认覆盖时传1')] },
  { id: 'product-hatchery-standard-indicator-prepare-update', title: '准备编辑标准指标', write: false, params: [formParam] },
  { id: 'product-hatchery-standard-indicator-update', title: '编辑标准指标', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的标准指标草稿；包含id和flag=1')] },
  { id: 'product-hatchery-standard-indicator-prepare-remove', title: '准备删除标准指标', write: false, params: [p('id', 'text', true, '当前列表行的标准指标记录ID')] },
  { id: 'product-hatchery-standard-indicator-remove', title: '删除标准指标', write: true, params: [p('id', 'text', true, 'prepareRemove返回的标准指标记录ID')] },
  { id: 'product-hatchery-standard-indicator-export', title: '导出标准库指标', write: false, params: [p('suiteCode', 'text', true, '来源标准库行的suiteCode'), p('traitType', 'text', false, '当前指标归类筛选'), p('traitCode', 'text', false, '当前指标名称筛选'), p('age', 'number', false, '当前日龄筛选')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_HATCHERY_STANDARD_INDICATOR_PAGE_PATH,
  permission: PRODUCT_HATCHERY_STANDARD_INDICATOR_PERMISSION,
  moduleType: PRODUCT_HATCHERY_STANDARD_INDICATOR_MODULE_TYPE,
  httpInstance: 'product',
}))
