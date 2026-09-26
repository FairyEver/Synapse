import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 方法库-新」。 */
export const PRODUCT_SETTING_METHOD_LIB_PAGE_PATH = '/dashboard/product/setting/method-lib/list'
export const PRODUCT_SETTING_METHOD_LIB_PERMISSION = '/dashboard/frame/breeding-plan-new/method-lib'
export const PRODUCT_SETTING_METHOD_LIB_MODULE_TYPE = null

const ROOT = '/flockSimu/rearingPlan/method'
const METHOD_NAME_MAX_LENGTH = 100
const METHOD_DESCRIPTION_MAX_LENGTH = 2000
const METHOD_CATEGORY_MAX_LENGTH = 32
const MAX_DAY_AGE = 500
const MAX_INTERVAL_DAYS = 100
const METHOD_TYPES = new Set([1, 2])

export type ProductSettingMethodLibId = string
export type ProductSettingMethodLibMethodType = 1 | 2

export type ProductSettingMethodLibListQuery = {
  generation?: string | null
  variety?: string | null
  strain?: string | null
  methodName?: string | null
  methodType?: ProductSettingMethodLibMethodType | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingMethodLibRule = Record<string, unknown> & {
  id?: ProductSettingMethodLibId | null
  generation?: string | null
  variety?: string | null
  strain?: string | null
  startDayAge?: number | null
  intervalDays?: number | null
}

export type ProductSettingMethodLibRow = Record<string, unknown> & {
  id: ProductSettingMethodLibId
  methodName: string
  methodDescription: string
  methodCategory: string
  methodType: ProductSettingMethodLibMethodType
  keyPoint: boolean
  ruleCount: number
  rules: ProductSettingMethodLibRule[]
  creatorName: string
  updateTime: string
}

export type ProductSettingMethodLibPage = {
  list: ProductSettingMethodLibRow[]
  total: number
}

export type ProductSettingMethodLibForm = {
  id?: ProductSettingMethodLibId | null
  methodName: string
  methodDescription: string
  methodCategory: string
  methodType: ProductSettingMethodLibMethodType | string | number
  keyPoint?: boolean | number | string | null
  rules?: ProductSettingMethodLibRule[] | null
}

export type ProductSettingMethodLibDraft = {
  id?: ProductSettingMethodLibId
  methodName: string
  methodDescription: string
  methodCategory: string
  methodType: ProductSettingMethodLibMethodType
  keyPoint: boolean
  rules: Array<{
    generation: string
    variety: string
    strain: string
    startDayAge: number
    intervalDays: number
  }>
}

export type ProductSettingMethodLibRemoveInput = {
  id?: ProductSettingMethodLibId | null
  methodId?: ProductSettingMethodLibId | null
}

export type ProductSettingMethodLibRemoveDraft = {
  id: ProductSettingMethodLibId
}

export type ProductSettingMethodLibFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type ProductSettingMethodLibFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type ProductSettingMethodLibImportForm = {
  file: ProductSettingMethodLibFileInput
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  const text = textOf(value, label).trim()
  if (!text) throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && text.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return text
}

function idOf (value: unknown, label: string): string {
  const text = value === undefined || value === null ? '' : String(value).trim()
  if (!text) throw new Error(`${label}必须为非空ID`)
  return text
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20或50')
  return resolved
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.keys(object).length === 1 && object.data !== undefined) return object.data
  }
  return value
}

function arrayOf (value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === 'object') {
    for (const key of keys) {
      const candidate = (value as JsonObject)[key]
      if (Array.isArray(candidate)) return candidate
    }
  }
  return []
}

function numberOf (value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label}必须是数字`)
  return number
}

function integerInRangeOf (value: unknown, label: string, min: number, max: number): number {
  const number = numberOf(value, label)
  if (number === undefined || !Number.isInteger(number) || number < min || number > max) throw new Error(`${label}必须是${min}至${max}的整数`)
  return number
}

function booleanOf (value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function methodTypeOf (value: unknown, label = '方法类型'): ProductSettingMethodLibMethodType {
  const number = numberOf(value, label)
  if (number === undefined || !Number.isInteger(number) || !METHOD_TYPES.has(number)) throw new Error(`${label}只能是1（普通方法）或2（程序方法）`)
  return number as ProductSettingMethodLibMethodType
}

function dictionaryValueOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须是字符串或数字`)
  return String(value).trim()
}

function normalizeRule (value: unknown, index = 0): ProductSettingMethodLibRule {
  const source = objectOf(value, `方法规则[${index + 1}]`)
  const id = source.id ?? source.ruleId ?? source.rule_id
  return {
    ...source,
    id: id === undefined || id === null ? '' : String(id),
    generation: dictionaryValueOf(source.generation ?? source.gen, `方法规则[${index + 1}].generation`),
    variety: dictionaryValueOf(source.variety, `方法规则[${index + 1}].variety`),
    strain: dictionaryValueOf(source.strain ?? source.line, `方法规则[${index + 1}].strain`),
    startDayAge: numberOf(source.startDayAge ?? source.start_day_age, `方法规则[${index + 1}].startDayAge`),
    intervalDays: numberOf(source.intervalDays ?? source.interval_days, `方法规则[${index + 1}].intervalDays`),
  }
}

function methodOf (value: unknown, index = 0): ProductSettingMethodLibRow {
  const source = objectOf(value, `方法记录[${index + 1}]`)
  const rules = arrayOf(source, ['rules', 'ruleList', 'rule_list']).map((rule, ruleIndex) => normalizeRule(rule, ruleIndex))
  const methodType = Number(source.methodType ?? source.method_type ?? 1)
  const ruleCount = Number(source.ruleCount ?? source.rule_count ?? rules.length)
  return {
    ...source,
    id: String(source.id ?? source.methodId ?? source.method_id ?? ''),
    methodName: textOf(source.methodName ?? source.method_name, `方法记录[${index + 1}].methodName`),
    methodDescription: textOf(source.methodDescription ?? source.method_description, `方法记录[${index + 1}].methodDescription`),
    methodCategory: dictionaryValueOf(source.methodCategory ?? source.method_category, `方法记录[${index + 1}].methodCategory`),
    methodType: METHOD_TYPES.has(methodType) ? methodType as ProductSettingMethodLibMethodType : 1,
    keyPoint: booleanOf(source.keyPoint ?? source.key_point),
    ruleCount: Number.isSafeInteger(ruleCount) && ruleCount >= 0 ? ruleCount : rules.length,
    rules,
    creatorName: textOf(source.creatorName ?? source.creator_name, `方法记录[${index + 1}].creatorName`),
    updateTime: textOf(source.updateTime ?? source.update_time, `方法记录[${index + 1}].updateTime`),
  }
}

function pageOf (value: unknown): ProductSettingMethodLibPage {
  const payload = objectOf(payloadOf(value), '方法库分页响应')
  const page = payload.page && typeof payload.page === 'object' && !Array.isArray(payload.page) ? payload.page as JsonObject : payload
  const rawList = page.list ?? page.records ?? page.items
  if (!Array.isArray(rawList)) throw new Error('方法库分页响应缺少list数组')
  const list = rawList.map((item, index) => methodOf(item, index))
  const total = Number(page.total ?? page.count ?? list.length)
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('方法库分页响应缺少有效total')
  return { list, total }
}

function listQueryOf (query: ProductSettingMethodLibListQuery = {}, includePage = true): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  if (includePage) {
    params.pageNo = pageNumberOf(query.pageNo, 1, 'pageNo')
    params.pageSize = pageNumberOf(query.pageSize, 10, 'pageSize')
  }
  const generation = textOf(query.generation, '代次').trim()
  const variety = textOf(query.variety, '品种').trim()
  const strain = textOf(query.strain, '品系').trim()
  const methodName = textOf(query.methodName, '方法名称').trim()
  if (generation) params.generation = generation
  if (variety) params.variety = variety
  if (strain) params.strain = strain
  if (methodName) params.methodName = methodName
  if (query.methodType !== undefined && query.methodType !== null && query.methodType !== '') params.methodType = methodTypeOf(query.methodType)
  return params
}

function rulePayloadOf (value: unknown, index: number) {
  const source = objectOf(value, `方法规则[${index + 1}]`)
  const generation = dictionaryValueOf(source.generation ?? source.gen, `方法规则[${index + 1}].generation`)
  const variety = dictionaryValueOf(source.variety, `方法规则[${index + 1}].variety`)
  const strain = dictionaryValueOf(source.strain ?? source.line, `方法规则[${index + 1}].strain`)
  const startDayAge = integerInRangeOf(source.startDayAge ?? source.start_day_age, `方法规则[${index + 1}].startDayAge`, 1, MAX_DAY_AGE)
  const intervalDays = integerInRangeOf(source.intervalDays ?? source.interval_days, `方法规则[${index + 1}].intervalDays`, 1, MAX_INTERVAL_DAYS)
  if (!generation && (variety || strain)) throw new Error('选择全部代次时不能指定品种或品系')
  return { generation, variety, strain, startDayAge, intervalDays }
}

function methodDraftOf (value: unknown, withId: boolean): ProductSettingMethodLibDraft {
  const source = objectOf(value, withId ? '方法库编辑表单' : '方法库新建表单')
  const methodName = requiredTextOf(source.methodName, '方法名称', METHOD_NAME_MAX_LENGTH)
  const methodDescription = requiredTextOf(source.methodDescription, '方法描述', METHOD_DESCRIPTION_MAX_LENGTH)
  const methodCategory = requiredTextOf(source.methodCategory, '方法分类', METHOD_CATEGORY_MAX_LENGTH)
  const methodType = methodTypeOf(source.methodType)
  const rawRules = Array.isArray(source.rules) ? source.rules : []
  const rules = methodType === 2 ? [] : rawRules.map((rule, index) => rulePayloadOf(rule, index))
  if (methodType === 1 && rules.length === 0) throw new Error('请至少添加一条频次规则')
  const scopeStartKeys = new Set<string>()
  for (const rule of rules) {
    const key = [rule.generation, rule.variety, rule.strain, rule.startDayAge].join('|')
    if (scopeStartKeys.has(key)) throw new Error('存在重复的适用范围和开始日龄')
    scopeStartKeys.add(key)
  }
  const draft: ProductSettingMethodLibDraft = {
    methodName,
    methodDescription,
    methodCategory,
    methodType,
    keyPoint: booleanOf(source.keyPoint),
    rules,
  }
  if (withId) draft.id = idOf(source.id ?? source.methodId ?? source.method_id, '方法ID')
  return draft
}

function methodPayloadOf (draft: ProductSettingMethodLibDraft): Record<string, unknown> {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    methodName: draft.methodName,
    methodDescription: draft.methodDescription,
    methodCategory: draft.methodCategory,
    methodType: draft.methodType,
    keyPoint: draft.keyPoint,
    rules: draft.rules,
  }
}

function base64BytesOf (value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  const base64 = value.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}不能为空`)
  return new Uint8Array(bytes)
}

function fileOf (value: unknown): { fileName: string; contentType: string; bytes: Uint8Array } {
  const source = objectOf(value, '方法库导入文件')
  const fileName = requiredTextOf(source.fileName, 'fileName')
  if (!/\.xlsx$/i.test(fileName)) throw new Error('Portal导入控件只接受.xlsx文件')
  const bytes = base64BytesOf(source.base64, 'base64')
  const contentType = typeof source.contentType === 'string' && source.contentType.trim()
    ? source.contentType
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes }
}

function formDataOf (file: { fileName: string; contentType: string; bytes: Uint8Array }): FormData {
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  return data
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ProductSettingMethodLibFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('方法库文件响应为空')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers?.get === 'function' ? headers.get('content-type') : headers?.['content-type']
  const disposition = typeof headers?.get === 'function' ? headers.get('content-disposition') : headers?.['content-disposition']
  const dispositionText = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(dispositionText)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(dispositionText)?.[1]
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

function scalarIdOf (value: unknown): string {
  const payload = payloadOf(value)
  if (typeof payload === 'string' || typeof payload === 'number') return String(payload)
  if (payload !== null && typeof payload === 'object') {
    const object = payload as JsonObject
    const id = object.id ?? object.methodId ?? object.method_id ?? object.data
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return ''
}

function importCountOf (value: unknown): number {
  const payload = payloadOf(value)
  const number = typeof payload === 'number'
    ? payload
    : payload !== null && typeof payload === 'object'
      ? Number((payload as JsonObject).count ?? (payload as JsonObject).importedCount)
      : Number.NaN
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('方法库导入响应缺少有效条数')
  return number
}

/** The injected request must use PRODUCT_SETTING_METHOD_LIB_PAGE_PATH as page context. */
export function createProductSettingMethodLibCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingMethodLibListQuery = {}): Promise<ProductSettingMethodLibPage> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listQueryOf(query) }))
    },

    prepareCreate (form: ProductSettingMethodLibForm): { draft: ProductSettingMethodLibDraft } {
      return { draft: methodDraftOf(form, false) }
    },

    async create (input: { draft: ProductSettingMethodLibDraft }): Promise<ProductSettingMethodLibId> {
      const draft = methodDraftOf(input?.draft, false)
      const result = await request({ url: `${ROOT}/create`, method: 'post', data: methodPayloadOf(draft) })
      const id = scalarIdOf(result)
      if (!id) throw new Error('方法创建成功但未返回方法ID')
      return id
    },

    prepareUpdate (form: ProductSettingMethodLibForm): { draft: ProductSettingMethodLibDraft & { id: ProductSettingMethodLibId } } {
      return { draft: methodDraftOf(form, true) as ProductSettingMethodLibDraft & { id: ProductSettingMethodLibId } }
    },

    async update (input: { draft: ProductSettingMethodLibDraft & { id: ProductSettingMethodLibId } }): Promise<true> {
      const draft = methodDraftOf(input?.draft, true)
      await request({ url: `${ROOT}/update`, method: 'put', data: methodPayloadOf(draft) })
      return true
    },

    async get (input: { id: ProductSettingMethodLibId }): Promise<ProductSettingMethodLibRow> {
      const id = idOf(input?.id, '方法ID')
      return methodOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },

    prepareRemove (input: ProductSettingMethodLibRemoveInput): ProductSettingMethodLibRemoveDraft {
      return { id: idOf(input?.id ?? input?.methodId, '方法ID') }
    },

    async remove (input: ProductSettingMethodLibRemoveDraft): Promise<true> {
      const id = idOf(input?.id, '方法ID')
      await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } })
      return true
    },

    async downloadTemplate (): Promise<ProductSettingMethodLibFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', responseType: 'arraybuffer' })
      return downloadedFileOf(response, '方法库导入模板.xlsx')
    },

    async exportExcel (query: ProductSettingMethodLibListQuery = {}): Promise<ProductSettingMethodLibFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: listQueryOf(query, false), responseType: 'arraybuffer' })
      return downloadedFileOf(response, '方法库.xls')
    },

    async importExcel (input: ProductSettingMethodLibImportForm): Promise<number> {
      const file = fileOf(input?.file)
      const result = await request({
        url: `${ROOT}/import-excel`,
        method: 'post',
        data: formDataOf(file),
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return importCountOf(result)
    },
  }
}

export type ProductSettingMethodLibCapability = ReturnType<typeof createProductSettingMethodLibCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const formParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '方法库表单；方法名称、描述、分类必填，方法类型1=普通方法、2=程序方法；普通方法至少一条规则，程序方法提交空rules' }
const draftParam = (name: string, description: string): ParamSpec => p(name, 'text', true, description)

const queryParams = [
  p('generation', 'text', false, '适用代次筛选；默认省略'),
  p('variety', 'text', false, '品种筛选；默认省略'),
  p('strain', 'text', false, '品系筛选；默认省略'),
  p('methodName', 'text', false, '方法名称筛选；SDK提交trim后的值'),
  p('methodType', 'enum', false, '方法类型筛选：1=普通方法，2=程序方法'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '每页条数；只支持10、20、50，默认10'),
]

export const PRODUCT_SETTING_METHOD_LIB_METHODS = {
  'product-setting-method-lib-list': 'list',
  'product-setting-method-lib-prepare-create': 'prepareCreate',
  'product-setting-method-lib-create': 'create',
  'product-setting-method-lib-prepare-update': 'prepareUpdate',
  'product-setting-method-lib-update': 'update',
  'product-setting-method-lib-get': 'get',
  'product-setting-method-lib-prepare-remove': 'prepareRemove',
  'product-setting-method-lib-remove': 'remove',
  'product-setting-method-lib-download-template': 'downloadTemplate',
  'product-setting-method-lib-export': 'exportExcel',
  'product-setting-method-lib-import': 'importExcel',
} as const

export const productSettingMethodLibCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-method-lib-list', title: '查询方法库', write: false, params: queryParams },
  { id: 'product-setting-method-lib-prepare-create', title: '准备新建方法', write: false, params: [formParam] },
  { id: 'product-setting-method-lib-create', title: '新建方法', write: true, params: [draftParam('draft', 'prepareCreate返回的方法草稿；提交前不要改写字段')] },
  { id: 'product-setting-method-lib-prepare-update', title: '准备编辑方法', write: false, params: [formParam] },
  { id: 'product-setting-method-lib-update', title: '编辑方法', write: true, params: [draftParam('draft', 'prepareUpdate返回的含id方法草稿')] },
  { id: 'product-setting-method-lib-get', title: '查询方法详情', write: false, params: [p('id', 'text', true, '方法ID；来自list结果')] },
  { id: 'product-setting-method-lib-prepare-remove', title: '准备删除方法', write: false, params: [p('id', 'text', true, '待删除方法ID；来自list结果')] },
  { id: 'product-setting-method-lib-remove', title: '删除方法', write: true, params: [draftParam('id', 'prepareRemove返回的方法ID；用户确认后提交')] },
  { id: 'product-setting-method-lib-download-template', title: '下载方法库导入模板', write: false, params: [] },
  { id: 'product-setting-method-lib-export', title: '导出方法库Excel', write: false, params: queryParams.slice(0, 5) },
  { id: 'product-setting-method-lib-import', title: '导入方法库Excel', write: true, params: [p('fileName', 'text', true, '仅接受.xlsx文件名'), p('base64', 'text', true, 'xlsx文件的标准Base64'), p('contentType', 'text', false, '文件MIME类型；省略时使用xlsx默认值')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_METHOD_LIB_PAGE_PATH,
  permission: PRODUCT_SETTING_METHOD_LIB_PERMISSION,
  moduleType: PRODUCT_SETTING_METHOD_LIB_MODULE_TYPE,
  httpInstance: 'platform',
}))
