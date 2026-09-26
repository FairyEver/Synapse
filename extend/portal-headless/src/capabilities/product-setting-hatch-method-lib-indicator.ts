import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 方法库 → 指标」隐藏页面。 */
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH = '/dashboard/product/setting/hatch-manage/method-lib/indicator/list'
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PERMISSION = '/dashboard/frame/breeding-plan/method-lib'
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_QUERY_PERMISSION = 'program:method-lib-indicator:query'
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_SUBMIT_PERMISSION = 'program:method-lib-indicator:submit'
export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_DELETE_PERMISSION = 'program:method-lib-indicator:delete'

const ROOT = '/programNew/methodLib'
const TRAIT_OPTIONS_URL = '/programUnit/getTraitList'

export type ProductSettingHatchMethodLibIndicatorId = string | number
export type ProductSettingHatchMethodLibIndicatorTraitType = string | number

export type ProductSettingHatchMethodLibIndicatorListQuery = {
  traitType?: ProductSettingHatchMethodLibIndicatorTraitType | null
  traitCode?: string | null
  age?: number | null
  suiteCode?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchMethodLibIndicatorRow = Record<string, unknown> & {
  id: ProductSettingHatchMethodLibIndicatorId | null
  suiteCode: string | null
  traitType: ProductSettingHatchMethodLibIndicatorTraitType | null
  traitTypeName: string | null
  traitCode: string | null
  traitName: string | null
  title1: string | null
  title2: string | null
  title3: string | null
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

export type ProductSettingHatchMethodLibIndicatorPage = {
  list: ProductSettingHatchMethodLibIndicatorRow[]
  total: number
}

export type ProductSettingHatchMethodLibIndicatorTraitOption = Record<string, unknown> & {
  code: string
  name: string
  label: string
  value: string
  contentType: number | null
  title1: string | null
  title2: string | null
  title3: string | null
}

export type ProductSettingHatchMethodLibIndicatorTraitOptionsInput = {
  traitType?: ProductSettingHatchMethodLibIndicatorTraitType | null
}

type TraitFormFields = {
  traitType: ProductSettingHatchMethodLibIndicatorTraitType
  traitCode: string
  contentType?: number | null
  title1?: string | null
  title2?: string | null
  title3?: string | null
  age: number
  txt: string
}

export type ProductSettingHatchMethodLibIndicatorCreateForm = TraitFormFields & {
  suiteCode?: string | null
}

export type ProductSettingHatchMethodLibIndicatorCreateDraft = TraitFormFields & {
  suiteCode: string
}

export type ProductSettingHatchMethodLibIndicatorCreateInput = {
  draft: ProductSettingHatchMethodLibIndicatorCreateDraft
  /** Portal冲突弹窗确认“覆盖”的二次提交；首次请求固定发送0。 */
  flag?: 1
}

export type ProductSettingHatchMethodLibIndicatorCreateResult =
  | { status: 'submitted' }
  | { status: 'conflict'; flag: 1 }

export type ProductSettingHatchMethodLibIndicatorUpdateForm = TraitFormFields & {
  id: ProductSettingHatchMethodLibIndicatorId
  /** 仅用于写后回查上下文，不会发送到editTrait请求体。 */
  suiteCode?: string | null
}

export type ProductSettingHatchMethodLibIndicatorUpdateDraft = ProductSettingHatchMethodLibIndicatorUpdateForm

export type ProductSettingHatchMethodLibIndicatorRemoveForm = {
  id: ProductSettingHatchMethodLibIndicatorId
  /** 仅用于写后回查列表，不会发送到deleteTrait参数。 */
  suiteCode?: string | null
}

export type ProductSettingHatchMethodLibIndicatorRemoveDraft = ProductSettingHatchMethodLibIndicatorRemoveForm

export type ProductSettingHatchMethodLibIndicatorFile = {
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

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  const text = formTextOf(value, label)
  if (text.trim() === '') throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && text.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return text
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchMethodLibIndicatorId | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID或null`)
}

function idOf (value: unknown, label: string): ProductSettingHatchMethodLibIndicatorId {
  const id = nullableIdOf(value, label)
  if (id === null) throw new Error(`${label}必须为非空ID`)
  return id
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function positiveIntegerOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label}必须为正整数`)
  return value
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为数字或null`)
  return value
}

function traitTypeOf (value: unknown, label: string): ProductSettingHatchMethodLibIndicatorTraitType {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}不能为空`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined) return object.data
  }
  return value
}

function rowOf (value: unknown, index: number): ProductSettingHatchMethodLibIndicatorRow {
  const row = objectOf(value, `方法指标列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `方法指标列表[${index}].id`),
    suiteCode: nullableTextOf(row.suiteCode, `方法指标列表[${index}].suiteCode`),
    traitType: row.traitType === undefined || row.traitType === null ? null : traitTypeOf(row.traitType, `方法指标列表[${index}].traitType`),
    traitTypeName: nullableTextOf(row.traitTypeName, `方法指标列表[${index}].traitTypeName`),
    traitCode: nullableTextOf(row.traitCode, `方法指标列表[${index}].traitCode`),
    traitName: nullableTextOf(row.traitName, `方法指标列表[${index}].traitName`),
    title1: nullableTextOf(row.title1, `方法指标列表[${index}].title1`),
    title2: nullableTextOf(row.title2, `方法指标列表[${index}].title2`),
    title3: nullableTextOf(row.title3, `方法指标列表[${index}].title3`),
    age: nullableIntegerOf(row.age, `方法指标列表[${index}].age`),
    ageType: nullableIntegerOf(row.ageType, `方法指标列表[${index}].ageType`),
    contentType: nullableIntegerOf(row.contentType, `方法指标列表[${index}].contentType`),
    contentTypeName: nullableTextOf(row.contentTypeName, `方法指标列表[${index}].contentTypeName`),
    scale: nullableIntegerOf(row.scale, `方法指标列表[${index}].scale`),
    unit: nullableTextOf(row.unit, `方法指标列表[${index}].unit`),
    min: nullableNumberOf(row.min, `方法指标列表[${index}].min`),
    max: nullableNumberOf(row.max, `方法指标列表[${index}].max`),
    txt: nullableTextOf(row.txt, `方法指标列表[${index}].txt`),
    flag: nullableIntegerOf(row.flag, `方法指标列表[${index}].flag`),
  }
}

function pageOf (value: unknown): ProductSettingHatchMethodLibIndicatorPage {
  const payload = objectOf(payloadOf(value), '方法指标分页响应')
  const page = objectOf(payload.page ?? payload, '方法指标分页响应.page')
  const list = page.records ?? page.list ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('方法指标分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingHatchMethodLibIndicatorListQuery = {}): Record<string, unknown> {
  const traitType = query.traitType === undefined || query.traitType === null || query.traitType === ''
    ? ''
    : traitTypeOf(query.traitType, '方法归类')
  return {
    traitType,
    traitCode: formTextOf(query.traitCode, '方法名称'),
    age: query.age === undefined || query.age === null ? 1 : positiveIntegerOf(query.age, '日龄'),
    suiteCode: formTextOf(query.suiteCode, 'suiteCode'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function traitOptionOf (value: unknown, index: number): ProductSettingHatchMethodLibIndicatorTraitOption {
  const item = objectOf(value, `方法名称选项[${index}]`)
  const code = requiredTextOf(item.code, `方法名称选项[${index}].code`)
  const name = requiredTextOf(item.name, `方法名称选项[${index}].name`)
  return {
    ...item,
    code,
    name,
    label: name,
    value: code,
    contentType: nullableIntegerOf(item.contentType, `方法名称选项[${index}].contentType`),
    title1: nullableTextOf(item.title1, `方法名称选项[${index}].title1`),
    title2: nullableTextOf(item.title2, `方法名称选项[${index}].title2`),
    title3: nullableTextOf(item.title3, `方法名称选项[${index}].title3`),
  }
}

function traitOptionsOf (value: unknown): ProductSettingHatchMethodLibIndicatorTraitOption[] {
  const payload = payloadOf(value)
  if (!Array.isArray(payload)) throw new Error('方法名称选项响应不是数组')
  return payload.map((item, index) => traitOptionOf(item, index))
}

function traitFormOf (value: unknown, includeId: boolean): TraitFormFields & { id?: ProductSettingHatchMethodLibIndicatorId; suiteCode?: string } {
  const form = objectOf(value, includeId ? '方法指标编辑表单' : '方法指标新建表单')
  const result: TraitFormFields & { id?: ProductSettingHatchMethodLibIndicatorId; suiteCode?: string } = {
    traitType: traitTypeOf(form.traitType, '方法归类'),
    traitCode: requiredTextOf(form.traitCode, '方法名称'),
    contentType: form.contentType === undefined ? undefined : nullableIntegerOf(form.contentType, 'contentType'),
    title1: nullableTextOf(form.title1, '一级标题'),
    title2: nullableTextOf(form.title2, '二级标题'),
    title3: nullableTextOf(form.title3, '三级标题'),
    age: positiveIntegerOf(form.age, '日龄'),
    txt: requiredTextOf(form.txt, '方法内容', 3000),
  }
  if (includeId) result.id = idOf(form.id, '方法指标ID')
  if (form.suiteCode !== undefined && form.suiteCode !== null) result.suiteCode = requiredTextOf(form.suiteCode, 'suiteCode')
  return result
}

function createDraftOf (value: unknown): ProductSettingHatchMethodLibIndicatorCreateDraft {
  const form = traitFormOf(value, false)
  return { ...form, suiteCode: form.suiteCode ?? '' }
}

function updateDraftOf (value: unknown): ProductSettingHatchMethodLibIndicatorUpdateDraft {
  return traitFormOf(value, true) as ProductSettingHatchMethodLibIndicatorUpdateDraft
}

function removeDraftOf (value: unknown): ProductSettingHatchMethodLibIndicatorRemoveDraft {
  const form = objectOf(value, '方法指标删除确认')
  return {
    id: idOf(form.id, '方法指标ID'),
    ...(form.suiteCode === undefined || form.suiteCode === null ? {} : { suiteCode: requiredTextOf(form.suiteCode, 'suiteCode') }),
  }
}

function conflictOf (value: unknown): boolean {
  if (value === 1) return true
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    return object.flag === 1 || (object.data !== null && typeof object.data === 'object' && (object.data as JsonObject).flag === 1)
  }
  return false
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ProductSettingHatchMethodLibIndicatorFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('方法库方法导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const text = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(text)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(text)?.[1]
  let fileName = fallback
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

/** The injected request must use PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH as page context. */
export function createProductSettingHatchMethodLibIndicatorCapability (request: PortalRequest) {
  return {
    async traitCodeOptions (input: ProductSettingHatchMethodLibIndicatorTraitOptionsInput = {}): Promise<ProductSettingHatchMethodLibIndicatorTraitOption[]> {
      if (input.traitType === undefined || input.traitType === null || input.traitType === '') return []
      const traitType = traitTypeOf(input.traitType, '方法归类')
      return traitOptionsOf(await request({ url: TRAIT_OPTIONS_URL, method: 'get', params: { classification: String(traitType), searchType: 2 } }))
    },

    async list (query: ProductSettingHatchMethodLibIndicatorListQuery = {}): Promise<ProductSettingHatchMethodLibIndicatorPage> {
      return pageOf(await request({ url: `${ROOT}/getTraitPage`, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchMethodLibIndicatorCreateForm): { draft: ProductSettingHatchMethodLibIndicatorCreateDraft } {
      return { draft: createDraftOf(form) }
    },

    async create (input: ProductSettingHatchMethodLibIndicatorCreateInput): Promise<ProductSettingHatchMethodLibIndicatorCreateResult> {
      const draft = createDraftOf(input?.draft)
      const flag = input?.flag === undefined ? 0 : input.flag
      if (input?.flag !== undefined && input.flag !== 1) throw new Error('flag只能省略或传1（覆盖）')
      const result = await request({ url: `${ROOT}/createTrait`, method: 'post', data: { ...draft, flag } })
      return flag === 0 && conflictOf(result) ? { status: 'conflict', flag: 1 } : { status: 'submitted' }
    },

    prepareUpdate (form: ProductSettingHatchMethodLibIndicatorUpdateForm): { draft: ProductSettingHatchMethodLibIndicatorUpdateDraft } {
      return { draft: updateDraftOf(form) }
    },

    async update (input: { draft: ProductSettingHatchMethodLibIndicatorUpdateDraft }): Promise<true> {
      const draft = updateDraftOf(input?.draft)
      const { suiteCode: _suiteCode, ...payload } = draft
      await request({ url: `${ROOT}/editTrait`, method: 'post', data: { ...payload, flag: 1 } })
      return true
    },

    prepareRemove (form: ProductSettingHatchMethodLibIndicatorRemoveForm): { draft: ProductSettingHatchMethodLibIndicatorRemoveDraft } {
      return { draft: removeDraftOf(form) }
    },

    async remove (input: { draft: ProductSettingHatchMethodLibIndicatorRemoveDraft }): Promise<true> {
      const draft = removeDraftOf(input?.draft)
      await request({ url: `${ROOT}/deleteTrait`, method: 'get', params: { id: draft.id } })
      return true
    },

    async export (query: ProductSettingHatchMethodLibIndicatorListQuery = {}): Promise<ProductSettingHatchMethodLibIndicatorFile> {
      const params = queryOf(query)
      delete params.pageNo
      delete params.pageSize
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/exportMethodLib`, method: 'get', params, responseType: 'arraybuffer' }), '方法库方法.xlsx')
    },
  }
}

export type ProductSettingHatchMethodLibIndicatorCapability = ReturnType<typeof createProductSettingHatchMethodLibIndicatorCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_METHODS = {
  'product-setting-hatch-method-lib-indicator-trait-code-options': 'traitCodeOptions',
  'product-setting-hatch-method-lib-indicator-list': 'list',
  'product-setting-hatch-method-lib-indicator-prepare-create': 'prepareCreate',
  'product-setting-hatch-method-lib-indicator-create': 'create',
  'product-setting-hatch-method-lib-indicator-prepare-update': 'prepareUpdate',
  'product-setting-hatch-method-lib-indicator-update': 'update',
  'product-setting-hatch-method-lib-indicator-prepare-remove': 'prepareRemove',
  'product-setting-hatch-method-lib-indicator-remove': 'remove',
  'product-setting-hatch-method-lib-indicator-export': 'export',
} as const

export const productSettingHatchMethodLibIndicatorCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-method-lib-indicator-trait-code-options', title: '查询方法库方法名称选项', write: false, params: [p('traitType', 'text', false, '方法归类字典值；省略时按Portal行为返回空数组')] },
  { id: 'product-setting-hatch-method-lib-indicator-list', title: '查询方法库指标', write: false, params: [p('traitType', 'text', false, '方法归类筛选；默认空字符串'), p('traitCode', 'text', false, '方法名称编码筛选；默认空字符串'), p('age', 'number', false, '日龄；默认1'), p('suiteCode', 'text', false, '父方法库行的suiteCode；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；只支持10、20、50、100，默认20')] },
  { id: 'product-setting-hatch-method-lib-indicator-prepare-create', title: '准备新建方法库指标', write: false, params: [p('form', 'text', true, '方法归类、方法名称、日龄和方法内容；由动态方法名称选项补齐标题与内容类型')] },
  { id: 'product-setting-hatch-method-lib-indicator-create', title: '新建方法库指标', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整草稿'), p('flag', 'enum', false, '冲突确认后的覆盖标记；首次请求固定发送0，二次提交只能传1')] },
  { id: 'product-setting-hatch-method-lib-indicator-prepare-update', title: '准备编辑方法库指标', write: false, params: [p('form', 'text', true, '当前指标列表行和用户修改后的方法内容；id必填')] },
  { id: 'product-setting-hatch-method-lib-indicator-update', title: '编辑方法库指标', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的草稿；suiteCode仅供回查，不发送到editTrait')] },
  { id: 'product-setting-hatch-method-lib-indicator-prepare-remove', title: '准备删除方法库指标', write: false, params: [p('form', 'text', true, '当前指标行的id，可附带suiteCode用于写后回查')] },
  { id: 'product-setting-hatch-method-lib-indicator-remove', title: '删除方法库指标', write: true, params: [p('draft', 'text', true, 'prepareRemove返回的删除草稿')] },
  { id: 'product-setting-hatch-method-lib-indicator-export', title: '导出方法库方法', write: false, params: [p('traitType', 'text', false, '方法归类筛选；默认空字符串'), p('traitCode', 'text', false, '方法名称编码筛选；默认空字符串'), p('age', 'number', false, '日龄；默认1'), p('suiteCode', 'text', false, '父方法库行的suiteCode；默认空字符串')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_METHOD_LIB_INDICATOR_MODULE_TYPE,
  httpInstance: 'product',
}))
