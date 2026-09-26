import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 标准库」。 */
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH = '/dashboard/product/setting/hatch-manage/lib/list'
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION = '/dashboard/frame/breeding-plan/lib'
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_QUERY_PERMISSION = 'program:suite:query'
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_SUBMIT_PERMISSION = 'program:suite:submit'
export const PRODUCT_SETTING_HATCH_MANAGE_LIB_DELETE_PERMISSION = 'program:suite:delete'

const TEMP_OPTIONS_URL = '/programNew/baseSetting/temp/getTempInList'
const LIST_URL = '/programNew/standardLib/getPage'
const IMPORT_URL = '/programNew/standardLib/importStandardLib'
const EDIT_URL = '/programNew/standardLib/edit'
const DELETE_URL = '/programNew/standardLib/delete'
const TEMPLATE_URL = '/programManage/exportFile'
const TEMPLATE_NAME = '标准库模板'

export type ProductSettingHatchManageLibId = string | number
export type ProductSettingHatchManageLibFlag = 1 | 2 | 3

export type ProductSettingHatchManageLibQuery = {
  variety?: string | null
  gen?: string | null
  tempId?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchManageLibRow = Record<string, unknown> & {
  id: ProductSettingHatchManageLibId | null
  variety: string | null
  varietyName: string | null
  gen: string | null
  genName: string | null
  ageStage: string | null
  ageStageName: string | null
  tempId: string | null
  tempName: string | null
  suiteCode: string | null
  flag: number | null
}

export type ProductSettingHatchManageLibPage = {
  list: ProductSettingHatchManageLibRow[]
  total: number
}

export type ProductSettingHatchManageLibTemperatureOption = Record<string, unknown> & {
  id: ProductSettingHatchManageLibId
  inTitle: string | null
  label: string | null
  value: ProductSettingHatchManageLibId
}

export type ProductSettingHatchManageLibFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type ProductSettingHatchManageLibCreateForm = {
  variety: string
  gen: string
  tempId: string
  suiteCode?: string | null
  file: ProductSettingHatchManageLibFileInput
}

export type ProductSettingHatchManageLibCreateDraft = {
  variety: string
  gen: string
  tempId: string
  suiteCode: string
  file: ProductSettingHatchManageLibFileInput
}

export type ProductSettingHatchManageLibCreateInput = {
  draft: ProductSettingHatchManageLibCreateDraft
  /** Portal重复预案弹窗的创建方式：1替换、2增加、3覆盖；首次请求省略。 */
  flag?: ProductSettingHatchManageLibFlag
}

export type ProductSettingHatchManageLibUpdateForm = {
  id?: ProductSettingHatchManageLibId | null | ''
  variety: string
  gen: string
  tempId: string
  suiteCode: string
}

export type ProductSettingHatchManageLibUpdateDraft = {
  id: ProductSettingHatchManageLibId | null | ''
  variety: string
  gen: string
  tempId: string
  suiteCode: string
  file: null
}

export type ProductSettingHatchManageLibCreateResult =
  | { status: 'submitted' }
  | { status: 'conflict'; flag: 1 }

export type ProductSettingHatchManageLibFile = {
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

function idOf (value: unknown, label: string): ProductSettingHatchManageLibId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchManageLibId | null {
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
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredFormTextOf (value: unknown, label: string): string {
  const text = formTextOf(value, label)
  if (text.trim() === '') throw new Error(`${label}不能为空`)
  return text
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function rowOf (value: unknown, index: number): ProductSettingHatchManageLibRow {
  const row = objectOf(value, `标准库列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `标准库列表[${index}].id`),
    variety: textOf(row.variety, `标准库列表[${index}].variety`),
    varietyName: textOf(row.varietyName, `标准库列表[${index}].varietyName`),
    gen: textOf(row.gen, `标准库列表[${index}].gen`),
    genName: textOf(row.genName, `标准库列表[${index}].genName`),
    ageStage: textOf(row.ageStage, `标准库列表[${index}].ageStage`),
    ageStageName: textOf(row.ageStageName, `标准库列表[${index}].ageStageName`),
    tempId: textOf(row.tempId, `标准库列表[${index}].tempId`),
    tempName: textOf(row.tempName, `标准库列表[${index}].tempName`),
    suiteCode: textOf(row.suiteCode, `标准库列表[${index}].suiteCode`),
    flag: integerOf(row.flag, `标准库列表[${index}].flag`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined && object.rows === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchManageLibPage {
  const payload = objectOf(payloadOf(value), '标准库分页响应')
  const page = objectOf(payload.page ?? payload, '标准库分页响应.page')
  const list = page.records ?? page.list ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('标准库分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function temperatureOptionOf (value: unknown, index: number): ProductSettingHatchManageLibTemperatureOption {
  const item = objectOf(value, `舍内温度选项[${index}]`)
  const id = idOf(item.id, `舍内温度选项[${index}].id`)
  const inTitle = textOf(item.inTitle, `舍内温度选项[${index}].inTitle`)
  return { ...item, id, inTitle, label: inTitle, value: id }
}

function temperatureOptionsOf (value: unknown): ProductSettingHatchManageLibTemperatureOption[] {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return payload.map((item, index) => temperatureOptionOf(item, index))
  const object = objectOf(payload, '舍内温度选项响应')
  const list = object.list ?? object.records ?? object.rows
  if (!Array.isArray(list)) throw new Error('舍内温度选项响应缺少list数组')
  return list.map((item, index) => temperatureOptionOf(item, index))
}

function queryOf (query: ProductSettingHatchManageLibQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    variety: formTextOf(query.variety, '品种'),
    gen: formTextOf(query.gen, '代次'),
    tempId: formTextOf(query.tempId, '舍内温度'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function base64BytesOf (value: string, label: string): Uint8Array {
  const base64 = value.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}不能为空`)
  return new Uint8Array(bytes)
}

function fileOf (value: unknown): { fileName: string; contentType: string; base64: string; bytes: Uint8Array } {
  const file = objectOf(value, '标准库导入文件')
  if (typeof file.fileName !== 'string' || !/\.(xls|xlsx)$/i.test(file.fileName)) throw new Error('fileName必须是xls或xlsx文件；Portal上传控件只接受.xls/.xlsx')
  if (typeof file.base64 !== 'string' || file.base64.trim() === '') throw new Error('base64不能为空')
  const bytes = base64BytesOf(file.base64, 'base64')
  const contentType = typeof file.contentType === 'string' && file.contentType.trim()
    ? file.contentType
    : /\.xls$/i.test(file.fileName) && !/\.xlsx$/i.test(file.fileName)
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName: file.fileName, contentType, base64: Buffer.from(bytes).toString('base64'), bytes }
}

function createFormOf (value: unknown): ProductSettingHatchManageLibCreateDraft {
  const form = objectOf(value, '标准库新建表单')
  const file = fileOf(form.file)
  return {
    variety: requiredFormTextOf(form.variety, '品种'),
    gen: requiredFormTextOf(form.gen, '代次'),
    tempId: requiredFormTextOf(form.tempId, '舍内温度'),
    suiteCode: formTextOf(form.suiteCode, 'suiteCode'),
    file: { fileName: file.fileName, base64: file.base64, contentType: file.contentType },
  }
}

function updateFormOf (value: unknown): ProductSettingHatchManageLibUpdateDraft {
  const form = objectOf(value, '标准库编辑表单')
  return {
    id: form.id === undefined || form.id === null || form.id === '' ? '' : idOf(form.id, '标准库ID'),
    variety: requiredFormTextOf(form.variety, '品种'),
    gen: requiredFormTextOf(form.gen, '代次'),
    tempId: requiredFormTextOf(form.tempId, '舍内温度'),
    suiteCode: requiredFormTextOf(form.suiteCode, 'suiteCode'),
    file: null,
  }
}

function flagOf (value: unknown): ProductSettingHatchManageLibFlag {
  if (value === 1 || value === 2 || value === 3) return value
  throw new Error('flag只能是1（替换）、2（增加）或3（覆盖）')
}

function suiteCodeOf (value: unknown): string {
  return requiredFormTextOf(value, 'suiteCode')
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ProductSettingHatchManageLibFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('标准库模板响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentTypeValue = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const dispositionText = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(dispositionText)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(dispositionText)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else if (plain) fileName = plain
  return {
    fileName,
    contentType: typeof contentTypeValue === 'string' && contentTypeValue ? contentTypeValue : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function formDataOf (draft: ProductSettingHatchManageLibCreateDraft, flag?: ProductSettingHatchManageLibFlag): FormData {
  const file = fileOf(draft.file)
  const data = new FormData()
  data.append('variety', draft.variety || '')
  data.append('gen', draft.gen || '')
  data.append('tempId', draft.tempId || '')
  data.append('suiteCode', draft.suiteCode || '')
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  if (flag !== undefined) data.append('flag', String(flag))
  return data
}

function conflictOf (value: unknown): boolean {
  if (value === 1) return true
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return (value as JsonObject).flag === 1
  return false
}

/** The injected request must use PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH as page context. */
export function createProductSettingHatchManageLibCapability (request: PortalRequest) {
  return {
    async temperatureOptions (): Promise<ProductSettingHatchManageLibTemperatureOption[]> {
      return temperatureOptionsOf(await request({ url: TEMP_OPTIONS_URL, method: 'get' }))
    },

    async list (query: ProductSettingHatchManageLibQuery = {}): Promise<ProductSettingHatchManageLibPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchManageLibCreateForm): { draft: ProductSettingHatchManageLibCreateDraft } {
      return { draft: createFormOf(form) }
    },

    async create (input: ProductSettingHatchManageLibCreateInput): Promise<ProductSettingHatchManageLibCreateResult> {
      const draft = createFormOf(input?.draft)
      const flag = input?.flag === undefined ? undefined : flagOf(input.flag)
      const result = await request({ url: IMPORT_URL, method: 'post', data: formDataOf(draft, flag), headers: { 'Content-Type': 'multipart/form-data' } })
      return flag === undefined && conflictOf(result) ? { status: 'conflict', flag: 1 } : { status: 'submitted' }
    },

    prepareUpdate (form: ProductSettingHatchManageLibUpdateForm): { draft: ProductSettingHatchManageLibUpdateDraft } {
      return { draft: updateFormOf(form) }
    },

    async update (input: { draft: ProductSettingHatchManageLibUpdateDraft }): Promise<true> {
      const draft = updateFormOf(input?.draft)
      await request({ url: EDIT_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: { suiteCode: string }): { suiteCode: string } {
      return { suiteCode: suiteCodeOf(input?.suiteCode) }
    },

    async remove (input: { suiteCode: string }): Promise<true> {
      const suiteCode = suiteCodeOf(input?.suiteCode)
      await request({ url: DELETE_URL, method: 'get', params: { suiteCode } })
      return true
    },

    async downloadTemplate (): Promise<ProductSettingHatchManageLibFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: TEMPLATE_URL, method: 'get', params: { fileName: TEMPLATE_NAME }, responseType: 'arraybuffer' }), `${TEMPLATE_NAME}.xlsx`)
    },
  }
}

export type ProductSettingHatchManageLibCapability = ReturnType<typeof createProductSettingHatchManageLibCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

const createFormParam: ParamSpec = p('form', 'text', true, '标准库新建表单；品种、代次、舍内温度和文件必填，suiteCode按Portal原样透传，默认空字符串')
const updateFormParam: ParamSpec = p('form', 'text', true, '标准库编辑表单；来自当前列表行的id、品种、代次、舍内温度和suiteCode')

export const PRODUCT_SETTING_HATCH_MANAGE_LIB_METHODS = {
  'product-setting-hatch-manage-lib-temperature-options': 'temperatureOptions',
  'product-setting-hatch-manage-lib-list': 'list',
  'product-setting-hatch-manage-lib-prepare-create': 'prepareCreate',
  'product-setting-hatch-manage-lib-create': 'create',
  'product-setting-hatch-manage-lib-prepare-update': 'prepareUpdate',
  'product-setting-hatch-manage-lib-update': 'update',
  'product-setting-hatch-manage-lib-prepare-remove': 'prepareRemove',
  'product-setting-hatch-manage-lib-remove': 'remove',
  'product-setting-hatch-manage-lib-download-template': 'downloadTemplate',
} as const

export const productSettingHatchManageLibCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-manage-lib-temperature-options', title: '查询标准库舍内温度选项', write: false, params: [] },
  { id: 'product-setting-hatch-manage-lib-list', title: '查询标准库', write: false, params: [p('variety', 'text', false, '品种筛选；默认空字符串'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('tempId', 'text', false, '舍内温度ID筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；只支持10、20、50、100，默认20')] },
  { id: 'product-setting-hatch-manage-lib-prepare-create', title: '准备新建标准库', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-manage-lib-create', title: '新建或导入标准库', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的标准库新建草稿'), p('flag', 'enum', false, '重复预案的创建方式：1替换、2增加、3覆盖；首次请求省略',),] },
  { id: 'product-setting-hatch-manage-lib-prepare-update', title: '准备编辑标准库', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-manage-lib-update', title: '编辑标准库', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的五字段编辑草稿；file固定为null')] },
  { id: 'product-setting-hatch-manage-lib-prepare-remove', title: '准备删除标准库', write: false, params: [p('suiteCode', 'text', true, '当前列表行的suiteCode；删除确认前只在本地保存')] },
  { id: 'product-setting-hatch-manage-lib-remove', title: '删除标准库', write: true, params: [p('suiteCode', 'text', true, 'prepareRemove返回的suiteCode')] },
  { id: 'product-setting-hatch-manage-lib-download-template', title: '下载标准库模板', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_MANAGE_LIB_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_MANAGE_LIB_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_MANAGE_LIB_MODULE_TYPE,
  httpInstance: 'product',
}))
