import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 岗位管理 → 岗位设置」。 */
export const HR_POST_SETTING_PAGE_PATH = '/dashboard/post/post-setting/list'
export const HR_POST_SETTING_PERMISSION = '/dashboard/post/post-setting'
export const HR_POST_SETTING_MODULE_TYPE = 11

const ROOT = '/org/hrpost'
const SALARY_LEVEL_URL = '/org/hrsalarylevel/getAllSalaryLevel'
const SENSITIVE_URL = '/org/sensitive/info'
const SMS_SEND_URL = '/sys/sms/send'
const SMS_CHECK_URL = '/sys/sms/checkSms'
const SMS_TEMPLATE_ID = '17709'
const TEMPLATE_FILE_NAME = '岗位信息模板'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type HrPostSettingId = string | number
export type HrPostSettingParent = HrPostSettingId | 0 | null

export type HrPostSettingQuery = {
  /** 当前目录ID；0表示根目录。页面查询时总是发送该字段。 */
  parentId?: HrPostSettingId | 0 | null
  /** 名称关键字；trim后非空时走searchPage并固定dataType=2。 */
  templateName?: string | null
  pageNo?: number
  pageSize?: number
}

export type HrPostSettingAncestor = Record<string, unknown> & {
  id: HrPostSettingId
  name?: string | null
  available?: boolean
}

export type HrPostSettingRow = Record<string, unknown> & {
  id: HrPostSettingId
  name: string | null
  dataType: number | null
  parent: HrPostSettingParent
  postTypeName: string | null
  salaryLevelMin: HrPostSettingId | null
  salaryLevelMax: HrPostSettingId | null
  ancestorPath: HrPostSettingAncestor[]
}

export type HrPostSettingSalaryLevel = Record<string, unknown> & {
  id: HrPostSettingId
  name: string | null
  sort: number | null
}

/** 页面表单状态；更新时Portal会把详情返回的其它字段也原样带回。 */
export type HrPostSettingForm = Record<string, unknown> & {
  id?: HrPostSettingId | '' | null
  roleIdList?: readonly unknown[]
  parent?: HrPostSettingParent
  name?: string
  postType?: string | null
  dataType?: number
  gender?: number
  salaryLevelMin?: HrPostSettingId | '' | null
  salaryLevelMax?: HrPostSettingId | '' | null
  salaryLevelMinName?: string | null
  salaryLevelMaxName?: string | null
  salaryLevelName?: string | null
  postAssignment?: string | null
  educationalRequirement?: string | null
  experienceRequirement?: string | null
  abilityRequirement?: string | null
  remark?: string | null
}

export type HrPostSettingSavePayload = Record<string, unknown> & {
  name: string
  postType: string[]
  dataType: number
  gender: number
  parent: HrPostSettingParent
}

export type HrPostSettingCreatePayload = HrPostSettingSavePayload & { id?: never }
export type HrPostSettingUpdatePayload = HrPostSettingSavePayload & { id: HrPostSettingId }

export type HrPostSettingFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type HrPostSettingFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type HrPostSettingFile = HrPostSettingFilePreview & { base64: string }

export type HrPostSettingDeletePreparation = {
  ids: HrPostSettingId[]
  verificationRequired: boolean
  phone: string | null
}

type JsonObject = Record<string, unknown>

const DEFAULT_FORM: HrPostSettingForm = {
  roleIdList: [],
  parent: null,
  name: '',
  postType: '',
  dataType: 1,
  gender: 2,
  salaryLevelMin: null,
  salaryLevelMax: null,
  postAssignment: '',
  educationalRequirement: '',
  experienceRequirement: '',
  abilityRequirement: '',
  remark: '',
}

const CREATE_FORM_FIELDS = new Set([
  'roleIdList', 'parent', 'name', 'postType', 'dataType', 'gender', 'salaryLevelMin', 'salaryLevelMax',
  'postAssignment', 'educationalRequirement', 'experienceRequirement', 'abilityRequirement', 'remark',
])

const UI_ONLY_FIELDS = new Set(['salaryLevelMinName', 'salaryLevelMaxName', 'salaryLevelName'])

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HrPostSettingId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): HrPostSettingId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function parentOf (value: unknown, label: string): HrPostSettingParent {
  if (value === undefined || value === null || value === '' || value === '0') return null
  if (value === 0) return 0
  return idOf(value, label)
}

function parentIdOf (value: unknown, label: string): HrPostSettingId | 0 {
  if (value === undefined || value === null || value === '' || value === 0) return 0
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowNull = false): string | null {
  if (value === undefined || value === null) {
    if (allowNull) return value === null ? null : ''
    throw new Error(`${label}必须为字符串`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function optionalTextOf (value: unknown, label: string, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  if (value && value.trim() === '') throw new Error(`${label}不能全为空格`)
  if (value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function choiceOf (value: unknown, label: string, values: readonly number[], fallback: number): number {
  const result = value === undefined || value === null || value === '' ? fallback : value
  if (!Number.isSafeInteger(result) || !values.includes(result as number)) throw new Error(`${label}只能是${values.join('、')}`)
  return result as number
}

function postTypeOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) {
    if (!value.every(item => typeof item === 'string')) throw new Error(`${label}必须是字符串数组`)
    return [...value]
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是逗号分隔字符串`)
  // Portal uses `form.postType?.split(',') || []`; an empty string therefore becomes [''].
  return value.split(',')
}

function salaryLevelSort (a: HrPostSettingSalaryLevel, b: HrPostSettingSalaryLevel): number {
  const aHasSort = a.sort !== null && a.sort !== undefined
  const bHasSort = b.sort !== null && b.sort !== undefined
  if (!aHasSort && !bHasSort) return 0
  if (!aHasSort) return 1
  if (!bHasSort) return -1
  return Number(a.sort) - Number(b.sort)
}

function salaryLevelsOf (value: unknown): HrPostSettingSalaryLevel[] {
  if (!Array.isArray(value)) throw new Error('薪资等级响应必须是数组')
  return value.map((item, index) => {
    const row = objectOf(item, `薪资等级[${index}]`)
    const sort = row.sort === undefined || row.sort === null || row.sort === ''
      ? null
      : Number.isSafeInteger(row.sort) ? row.sort as number : (() => { throw new Error(`薪资等级[${index}].sort必须为整数或null`) })()
    return {
      ...row,
      id: idOf(row.id, `薪资等级[${index}].id`),
      name: textOf(row.name, `薪资等级[${index}].name`, true),
      sort,
    }
  }).sort(salaryLevelSort)
}

function salaryLevelIndex (levels: readonly HrPostSettingSalaryLevel[], value: unknown): number {
  if (value === undefined || value === null || value === '') return -1
  return levels.findIndex(item => String(item.id) === String(value))
}

function validateSalaryLevelRange (form: JsonObject, levels: readonly HrPostSettingSalaryLevel[] | undefined): void {
  if (!levels || levels.length === 0) return
  const minIndex = salaryLevelIndex(levels, form.salaryLevelMin)
  const maxIndex = salaryLevelIndex(levels, form.salaryLevelMax)
  if (minIndex === -1 || maxIndex === -1) return
  if (minIndex > maxIndex) throw new Error('薪资等级范围下限不能大于上限')
}

function formStateOf (value: unknown, label: string): HrPostSettingForm {
  const form = objectOf(value, label)
  const postType = form.postType === undefined || form.postType === null
    ? ''
    : Array.isArray(form.postType)
      ? form.postType.join(',')
      : textOf(form.postType, `${label}.postType`)!
  return {
    ...form,
    roleIdList: Array.isArray(form.roleIdList) ? form.roleIdList : [],
    postType,
    parent: form.parent === '0' ? null : form.parent as HrPostSettingParent,
  }
}

function payloadOf (value: unknown, label: string, mode: 'create' | 'update', levels?: readonly HrPostSettingSalaryLevel[]): HrPostSettingSavePayload {
  const raw = objectOf(value, label)
  const source: JsonObject = mode === 'create'
    ? Object.fromEntries(Object.entries(DEFAULT_FORM).map(([key, item]) => [key, Array.isArray(item) ? [...item] : item]))
    : { ...raw }
  if (mode === 'create') {
    for (const key of CREATE_FORM_FIELDS) if (Object.prototype.hasOwnProperty.call(raw, key)) source[key] = raw[key]
  }
  if (mode === 'update') source.id = idOf(raw.id, `${label}.id`)

  source.name = requiredTextOf(source.name, `${label}.name`, 50)
  source.dataType = choiceOf(source.dataType, `${label}.dataType`, [1, 2], 1)
  source.gender = choiceOf(source.gender, `${label}.gender`, [0, 1, 2], 2)
  source.parent = parentOf(source.parent, `${label}.parent`)
  for (const [field, maxLength] of [
    ['postAssignment', 500], ['educationalRequirement', 500], ['experienceRequirement', 500],
    ['abilityRequirement', 500], ['remark', 200],
  ] as const) {
    const normalized = optionalTextOf(source[field], `${label}.${field}`, maxLength)
    if (normalized === undefined) delete source[field]
    else source[field] = normalized
  }
  source.postType = postTypeOf(source.postType, `${label}.postType`)
  source.salaryLevelMin = nullableIdOf(source.salaryLevelMin, `${label}.salaryLevelMin`)
  source.salaryLevelMax = nullableIdOf(source.salaryLevelMax, `${label}.salaryLevelMax`)
  validateSalaryLevelRange(source, levels === undefined ? undefined : salaryLevelsOf(levels))
  for (const key of UI_ONLY_FIELDS) delete source[key]
  return source as HrPostSettingSavePayload
}

function rowOf (value: unknown, label: string): HrPostSettingRow {
  const raw = objectOf(value, label)
  const { children: _children, ...row } = raw
  const ancestorPath = row.ancestorPath === undefined || row.ancestorPath === null ? [] : row.ancestorPath
  if (!Array.isArray(ancestorPath)) throw new Error(`${label}.ancestorPath必须是数组或null`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`, true),
    dataType: row.dataType === undefined || row.dataType === null ? null : choiceOf(row.dataType, `${label}.dataType`, [1, 2], 1),
    parent: row.parent === undefined || row.parent === null || row.parent === '' ? null : row.parent === 0 || row.parent === '0' ? row.parent as 0 : idOf(row.parent, `${label}.parent`),
    postTypeName: textOf(row.postTypeName, `${label}.postTypeName`, true),
    salaryLevelMin: nullableIdOf(row.salaryLevelMin, `${label}.salaryLevelMin`),
    salaryLevelMax: nullableIdOf(row.salaryLevelMax, `${label}.salaryLevelMax`),
    ancestorPath: ancestorPath.map((item, index) => {
      const ancestor = objectOf(item, `${label}.ancestorPath[${index}]`)
      return { ...ancestor, id: idOf(ancestor.id, `${label}.ancestorPath[${index}].id`), name: textOf(ancestor.name, `${label}.ancestorPath[${index}].name`, true) }
    }),
  }
}

function pageOf (value: unknown): PageResult<HrPostSettingRow> {
  const page = objectOf(value, '岗位设置分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('岗位设置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `岗位设置列表[${index}]`)), total: page.total as number }
}

function detailOf (value: unknown): HrPostSettingForm {
  const detail = objectOf(value, '岗位设置详情')
  if (detail.id !== undefined && detail.id !== null) idOf(detail.id, '岗位设置详情.id')
  return formStateOf(detail, '岗位设置详情')
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const raw = value === undefined || value === null || value === '' ? fallback : Number(value)
  const result = Number.isFinite(raw) && raw !== 0 ? raw : fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && result > 100) return 100
  return result
}

function listParamsOf (query: HrPostSettingQuery = {}): Record<string, unknown> {
  const keyword = query.templateName === undefined || query.templateName === null ? '' : textOf(query.templateName, 'templateName')!.trim()
  return {
    parentId: parentIdOf(query.parentId, 'parentId'),
    keyword,
    dataType: keyword ? 2 : undefined,
    selection: false,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function idsOf (value: unknown): HrPostSettingId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids必须为非空ID数组')
  const ids = value.map((item, index) => idOf(item, `ids[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复ID')
  return ids
}

function sensitiveStateOf (value: unknown): { verificationRequired: boolean; phone: string | null } {
  if (value === undefined || value === null) return { verificationRequired: false, phone: null }
  const sensitive = objectOf(value, '敏感操作配置')
  const emptyState = sensitive.mobile === undefined && sensitive.isDel === undefined
  const verificationRequired = !(emptyState || sensitive.isDel === 1)
  const phone = sensitive.mobile === undefined || sensitive.mobile === null || sensitive.mobile === '' ? null : String(sensitive.mobile)
  return { verificationRequired, phone }
}

function binaryOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
  throw new Error('岗位设置文件响应不是二进制文件')
}

function headerOf (response: AxiosResponse, name: string): string | undefined {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' ? value : undefined
}

function fileNameOf (response: AxiosResponse, fallback: string): string {
  const header = headerOf(response, 'content-disposition')
  if (!header) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): HrPostSettingFile {
  const bytes = binaryOf(response?.data)
  if (bytes.byteLength === 0) throw new Error('岗位设置文件响应为空')
  return {
    fileName: fileNameOf(response, fallback),
    contentType: headerOf(response, 'content-type') || XLSX_MIME,
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function fileInputOf (value: unknown, label: string): { preview: HrPostSettingFilePreview; bytes: Uint8Array } {
  const file = objectOf(value, label)
  const fileName = textOf(file.fileName, `${label}.fileName`)!.trim()
  if (!fileName) throw new Error(`${label}.fileName不能为空`)
  const base64 = textOf(file.base64, `${label}.base64`)!.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}.base64不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}不能为空文件`)
  const contentType = file.contentType === undefined || file.contentType === '' ? XLSX_MIME : textOf(file.contentType, `${label}.contentType`)!
  if (contentType !== XLSX_MIME) throw new Error(`contentType必须为${XLSX_MIME}；Portal上传控件只接受xlsx MIME`)
  return { preview: { fileName, contentType, byteLength: bytes.byteLength }, bytes: new Uint8Array(bytes) }
}

function formDataOf (file: { preview: HrPostSettingFilePreview; bytes: Uint8Array }): FormData {
  const data = new FormData()
  const arrayBuffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([arrayBuffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

export function createHrPostSettingCapability (request: PortalRequest) {
  async function prepareRemove (input: { ids: HrPostSettingId[] }): Promise<HrPostSettingDeletePreparation> {
    const ids = idsOf(input?.ids)
    await request({ url: `${ROOT}/checkCanDelete`, method: 'post', data: ids })
    const sensitive = await request<unknown>({ url: SENSITIVE_URL, method: 'get' })
    return { ids, ...sensitiveStateOf(sensitive) }
  }

  return {
    async list (query: HrPostSettingQuery = {}): Promise<PageResult<HrPostSettingRow>> {
      const params = listParamsOf(query)
      return pageOf(await request({ url: keywordPath(params.keyword as string), method: 'get', params }))
    },

    async get (input: { id: HrPostSettingId }): Promise<HrPostSettingForm> {
      const id = idOf(input?.id, '岗位设置ID')
      return detailOf(await request({ url: `${ROOT}/${id}`, method: 'get' }))
    },

    async salaryLevels (): Promise<HrPostSettingSalaryLevel[]> {
      return salaryLevelsOf(await request({ url: SALARY_LEVEL_URL, method: 'get' }))
    },

    prepareCreate (input: { form?: Partial<HrPostSettingForm>; salaryLevels?: HrPostSettingSalaryLevel[] } = {}): { draft: HrPostSettingCreatePayload } {
      const form = objectOf(input.form ?? {}, '岗位设置新建表单')
      return { draft: payloadOf(form, '岗位设置新建表单', 'create', input.salaryLevels) as HrPostSettingCreatePayload }
    },

    async create (input: { draft: HrPostSettingCreatePayload; salaryLevels?: HrPostSettingSalaryLevel[] }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: payloadOf(input?.draft, '岗位设置新建草稿', 'create', input?.salaryLevels) })
    },

    prepareUpdate (input: { current: HrPostSettingForm | Record<string, unknown>; changes?: Record<string, unknown> | null; salaryLevels?: HrPostSettingSalaryLevel[] }): { draft: HrPostSettingUpdatePayload } {
      const current = formStateOf(input?.current, '岗位设置编辑当前值')
      const changes = input?.changes === undefined || input.changes === null ? {} : objectOf(input.changes, '岗位设置编辑变更')
      for (const key of Object.keys(changes)) if (!CREATE_FORM_FIELDS.has(key) && !UI_ONLY_FIELDS.has(key)) throw new Error(`岗位设置编辑变更不支持字段${key}`)
      return { draft: payloadOf({ ...current, ...changes }, '岗位设置编辑草稿', 'update', input?.salaryLevels) as HrPostSettingUpdatePayload }
    },

    async update (input: { draft: HrPostSettingUpdatePayload; salaryLevels?: HrPostSettingSalaryLevel[] }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: payloadOf(input?.draft, '岗位设置编辑草稿', 'update', input?.salaryLevels) })
    },

    prepareRemove,

    async sendDeleteCode (input: { ids: HrPostSettingId[] }): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await request<{ requestId?: string | number }>({ url: SMS_SEND_URL, method: 'get', params: { phone: prepared.phone, templateId: SMS_TEMPLATE_ID } })
      if (sent?.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) throw new Error('短信响应缺少requestId；发送结果不确定，不自动重发')
      return { smsRequestId: String(sent.requestId) }
    },

    async remove (input: { ids: HrPostSettingId[]; smsRequestId?: string; code?: string }): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (!input.smsRequestId?.trim() || !input.code?.trim()) throw new Error('删除需要短信验证：先sendDeleteCode，再提供smsRequestId和用户收到的code')
        const result = await request<{ ret?: string; msg?: string }>({ url: SMS_CHECK_URL, method: 'get', params: { code: input.code, requestId: input.smsRequestId }, sourceResponse: true })
        if (result?.ret !== 'SUCCESS') throw new Error(result?.msg || '短信验证码校验失败')
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },

    async downloadTemplate (): Promise<HrPostSettingFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/download`, method: 'get', params: { fileName: TEMPLATE_FILE_NAME }, responseType: 'arraybuffer' }), `${TEMPLATE_FILE_NAME}.xlsx`)
    },

    async export (input: { id: HrPostSettingId }): Promise<HrPostSettingFile> {
      const id = idOf(input?.id, '导出岗位目录ID')
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: { id }, responseType: 'arraybuffer' }), '岗位信息.xlsx')
    },

    prepareImport (input: { file: HrPostSettingFileInput; parentId?: HrPostSettingId | 0 | null }): HrPostSettingFilePreview {
      parentIdOf(input?.parentId, '导入父目录ID')
      return fileInputOf(input?.file, '岗位新增导入文件').preview
    },

    async importFile (input: { file: HrPostSettingFileInput; parentId?: HrPostSettingId | 0 | null }): Promise<void> {
      const parentId = input?.parentId === undefined || input.parentId === null || input.parentId === '' || input.parentId === 0 ? null : idOf(input.parentId, '导入父目录ID')
      const file = fileInputOf(input?.file, '岗位新增导入文件')
      await request({ url: `${ROOT}/v1/import`, method: 'post', params: { parentId }, data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } })
    },

    prepareImportUpdate (input: { file: HrPostSettingFileInput }): HrPostSettingFilePreview {
      return fileInputOf(input?.file, '岗位导入更新文件').preview
    },

    async importUpdate (input: { file: HrPostSettingFileInput }): Promise<void> {
      const file = fileInputOf(input?.file, '岗位导入更新文件')
      await request({ url: `${ROOT}/updateByExcelFile`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } })
    },
  }
}

function keywordPath (keyword: string): string {
  return `${ROOT}/${keyword ? 'searchPage' : 'treePage'}`
}

export type HrPostSettingCapability = ReturnType<typeof createHrPostSettingCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const fileParam = p('file', 'text', true, '文件对象：fileName、Base64、可选contentType；Portal上传控件只接受xlsx MIME')

export const HR_POST_SETTING_METHODS = {
  'hr-post-setting-list': 'list',
  'hr-post-setting-get': 'get',
  'hr-post-setting-salary-levels': 'salaryLevels',
  'hr-post-setting-prepare-create': 'prepareCreate',
  'hr-post-setting-create': 'create',
  'hr-post-setting-prepare-update': 'prepareUpdate',
  'hr-post-setting-update': 'update',
  'hr-post-setting-prepare-remove': 'prepareRemove',
  'hr-post-setting-send-delete-code': 'sendDeleteCode',
  'hr-post-setting-remove': 'remove',
  'hr-post-setting-download-template': 'downloadTemplate',
  'hr-post-setting-export': 'export',
  'hr-post-setting-prepare-import': 'prepareImport',
  'hr-post-setting-import': 'importFile',
  'hr-post-setting-prepare-import-update': 'prepareImportUpdate',
  'hr-post-setting-import-update': 'importUpdate',
} as const

export const hrPostSettingCapabilities: CapabilityDefinition[] = [
  { id: 'hr-post-setting-list', title: '查询岗位设置树分页', write: false, params: [p('parentId', 'number', false, '父目录ID；0表示根目录，默认0'), p('templateName', 'text', false, '名称关键字；trim后非空时跨层搜索岗位'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '页面默认20，超过100按页面压到100')] },
  { id: 'hr-post-setting-get', title: '读取岗位设置详情', write: false, params: [p('id', 'text', true, '岗位或目录ID')] },
  { id: 'hr-post-setting-salary-levels', title: '读取岗位设置薪资等级选项', write: false, params: [] },
  { id: 'hr-post-setting-prepare-create', title: '准备创建岗位或目录', write: false, params: [p('form', 'text', true, 'Portal岗位设置新建表单对象；可覆盖默认字段'), p('salaryLevels', 'text', false, 'salaryLevels返回的完整数组；提供时复刻页面上下限顺序校验')] },
  { id: 'hr-post-setting-create', title: '创建岗位或目录', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整保存草稿'), p('salaryLevels', 'text', false, '同一批薪资等级选项；用于再次执行页面范围校验')] },
  { id: 'hr-post-setting-prepare-update', title: '准备编辑岗位或目录', write: false, params: [p('current', 'text', true, 'get返回的完整表单状态'), p('changes', 'text', false, '用户明确修改的页面字段'), p('salaryLevels', 'text', false, 'salaryLevels返回的完整数组')] },
  { id: 'hr-post-setting-update', title: '保存岗位或目录编辑', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整保存草稿'), p('salaryLevels', 'text', false, '同一批薪资等级选项')] },
  { id: 'hr-post-setting-prepare-remove', title: '检查岗位或目录删除条件', write: false, params: [p('ids', 'text', true, '待删除ID数组；页面行删除为单个ID')] },
  { id: 'hr-post-setting-send-delete-code', title: '发送岗位删除验证码', write: true, params: [p('ids', 'text', true, '待删除ID数组')] },
  { id: 'hr-post-setting-remove', title: '删除岗位或目录', write: true, params: [p('ids', 'text', true, 'prepareRemove通过的ID数组'), p('smsRequestId', 'text', false, '敏感保护开启时sendDeleteCode返回的requestId'), p('code', 'text', false, '手机号持有人提供的短信验证码')] },
  { id: 'hr-post-setting-download-template', title: '下载岗位信息模板', write: false, params: [] },
  { id: 'hr-post-setting-export', title: '导出指定岗位目录', write: false, params: [p('id', 'text', true, '自定义导出选择的岗位或目录ID')] },
  { id: 'hr-post-setting-prepare-import', title: '准备导入新增岗位文件', write: false, params: [fileParam, p('parentId', 'number', false, '导入到的父目录ID；根目录按页面发送null')] },
  { id: 'hr-post-setting-import', title: '导入新增岗位文件', write: true, params: [fileParam, p('parentId', 'number', false, '导入到的父目录ID；根目录按页面发送null')] },
  { id: 'hr-post-setting-prepare-import-update', title: '准备导入更新岗位文件', write: false, params: [fileParam] },
  { id: 'hr-post-setting-import-update', title: '导入更新岗位文件', write: true, params: [fileParam] },
].map(definition => ({
  ...definition,
  pagePath: HR_POST_SETTING_PAGE_PATH,
  permission: HR_POST_SETTING_PERMISSION,
  moduleType: HR_POST_SETTING_MODULE_TYPE,
  httpInstance: 'platform',
}))
