import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 薪资报表 → 报表配置」及其可达的动态报表明细页。 */
export const REPORT_CONFIGURATION_PAGE_PATH = '/dashboard/report/report-configuration/list'
export const REPORT_CONFIGURATION_PERMISSION = '/dashboard/report/report-configuration'
export const REPORT_CONFIGURATION_MODULE_TYPE = 14

const ROOT = '/report/template'
const REPORT_FIELDS_URL = '/salary/ledgerItem/getAllReportField'

export type ReportConfigurationId = string | number
export type ReportConfigurationFieldType = 0 | 1 | 2
export type ReportConfigurationTemplateType = string | number

export type ReportConfigurationField = Record<string, unknown> & {
  name: string
  tableName: string
  columnName: string
  type: number | null
}

export type ReportConfigurationDetail = Record<string, unknown> & {
  id?: ReportConfigurationId | null
  templateId?: ReportConfigurationId | null
  tableName?: string | null
  columnName?: string | null
  name?: string | null
  sort?: number | null
  joinColumn?: string | null
  fieldName?: string | null
  filterType?: string | null
  isFilterable?: number | null
  isSortable?: number | null
  isGrouped?: number | null
  type?: number | null
  isDel?: number | null
}

export type ReportConfigurationTemplate = Record<string, unknown> & {
  id?: ReportConfigurationId | null
  name?: string | null
  type?: ReportConfigurationTemplateType | null
  tag?: ReportConfigurationTemplateType | null
  description?: string | null
  lockTopColumnsCount?: number | null
  detailList?: ReportConfigurationDetail[] | null
}

export type ReportConfigurationQuery = {
  name?: string | null
  type?: ReportConfigurationTemplateType | null
  pageNo?: number
  pageSize?: number
}

export type ReportConfigurationTemplateDraft = {
  name: string
  type?: ReportConfigurationTemplateType | null
  tag: ReportConfigurationTemplateType
  lockTopColumnsCount?: number | null
  fields: ReportConfigurationField[]
  filterFieldNames?: string[] | null
}

export type ReportConfigurationTemplateUpdate = ReportConfigurationTemplateDraft & {
  id: ReportConfigurationId
}

export type ReportConfigurationDetailQuery = {
  id: ReportConfigurationId
  year?: string | null
  month?: string | null
  filters?: Record<string, unknown> | null
}

export type ReportConfigurationCopyInput = {
  id: ReportConfigurationId
  name: string
}

export type ReportConfigurationFile = {
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

function idOf (value: unknown, label: string): ReportConfigurationId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): ReportConfigurationId | null {
  return value === undefined || value === null || value === '' ? null : idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredNameOf (value: unknown, label: string, max: number): string {
  const name = textOf(value, label)
  if (!name.trim()) throw new Error(`${label}必填且不能全为空格`)
  if (name.length > max) throw new Error(`${label}最多${max}个字符`)
  return name
}

function scalarTextOf (value: unknown, label: string, allowEmpty = true): string {
  if (value === undefined || value === null || value === '') {
    if (allowEmpty) return ''
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串或数字`)
  return String(value)
}

function tagOf (value: unknown): string {
  const tag = scalarTextOf(value, 'tag', false)
  if (tag !== '1' && tag !== '2') throw new Error('tag必须为1或2')
  return tag
}

function nonNegativeIntegerOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}必须为非负整数`)
  return value as number
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function queryTypeOf (value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return scalarTextOf(value, 'type')
}

function queryParamsOf (query: ReportConfigurationQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    name: textOf(query.name, 'name'),
    type: queryTypeOf(query.type),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function detailOf (value: unknown, label: string): ReportConfigurationDetail {
  const row = objectOf(value, label)
  return {
    ...row,
    ...(row.id === undefined ? {} : { id: optionalIdOf(row.id, `${label}.id`) }),
    ...(row.templateId === undefined ? {} : { templateId: optionalIdOf(row.templateId, `${label}.templateId`) }),
    ...(row.tableName === undefined ? {} : { tableName: nullableTextOf(row.tableName, `${label}.tableName`) }),
    ...(row.columnName === undefined ? {} : { columnName: nullableTextOf(row.columnName, `${label}.columnName`) }),
    ...(row.name === undefined ? {} : { name: nullableTextOf(row.name, `${label}.name`) }),
    ...(row.sort === undefined ? {} : { sort: nullableIntegerOf(row.sort, `${label}.sort`) }),
    ...(row.fieldName === undefined ? {} : { fieldName: nullableTextOf(row.fieldName, `${label}.fieldName`) }),
    ...(row.filterType === undefined ? {} : { filterType: nullableTextOf(row.filterType, `${label}.filterType`) }),
    ...(row.isFilterable === undefined ? {} : { isFilterable: nullableIntegerOf(row.isFilterable, `${label}.isFilterable`) }),
    ...(row.isSortable === undefined ? {} : { isSortable: nullableIntegerOf(row.isSortable, `${label}.isSortable`) }),
    ...(row.isGrouped === undefined ? {} : { isGrouped: nullableIntegerOf(row.isGrouped, `${label}.isGrouped`) }),
    ...(row.type === undefined ? {} : { type: nullableIntegerOf(row.type, `${label}.type`) }),
    ...(row.isDel === undefined ? {} : { isDel: nullableIntegerOf(row.isDel, `${label}.isDel`) }),
  }
}

function detailListOf (value: unknown, label: string): ReportConfigurationDetail[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => detailOf(item, `${label}[${index}]`))
}

function templateOf (value: unknown, label: string): ReportConfigurationTemplate {
  const row = objectOf(value, label)
  return {
    ...row,
    ...(row.id === undefined ? {} : { id: optionalIdOf(row.id, `${label}.id`) }),
    ...(row.name === undefined ? {} : { name: nullableTextOf(row.name, `${label}.name`) }),
    ...(row.type === undefined ? {} : { type: row.type === null ? null : scalarTextOf(row.type, `${label}.type`) }),
    ...(row.tag === undefined ? {} : { tag: row.tag === null ? null : scalarTextOf(row.tag, `${label}.tag`) }),
    ...(row.description === undefined ? {} : { description: nullableTextOf(row.description, `${label}.description`) }),
    ...(row.lockTopColumnsCount === undefined ? {} : { lockTopColumnsCount: nullableIntegerOf(row.lockTopColumnsCount, `${label}.lockTopColumnsCount`) }),
    ...(row.detailList === undefined ? {} : { detailList: detailListOf(row.detailList, `${label}.detailList`) }),
  }
}

function pageOf (value: unknown): PageResult<ReportConfigurationTemplate> {
  const page = objectOf(value, '报表配置分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('报表配置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => templateOf(item, `报表配置列表[${index}]`)), total: page.total }
}

function fieldOf (value: unknown, index: number): ReportConfigurationField {
  const row = objectOf(value, `报表字段候选[${index}]`)
  const name = requiredNameOf(row.name, `报表字段候选[${index}].name`, 255)
  const tableName = requiredNameOf(row.tableName, `报表字段候选[${index}].tableName`, 255)
  const columnName = requiredNameOf(row.columnName, `报表字段候选[${index}].columnName`, 255)
  const type = row.type === undefined || row.type === null ? null : nullableIntegerOf(row.type, `报表字段候选[${index}].type`)
  return { ...row, name, tableName, columnName, type }
}

function fieldsOf (value: unknown): ReportConfigurationField[] {
  if (!Array.isArray(value)) throw new Error('fields必须为报表字段数组')
  return value.map(fieldOf)
}

function filterNamesOf (value: unknown, fields: ReportConfigurationField[]): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('filterFieldNames必须为字符串数组')
  const available = new Set(fields.map(field => field.name))
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`filterFieldNames[${index}]必须为非空字符串`)
    if (!available.has(item)) throw new Error(`filterFieldNames[${index}]不在fields中`)
    return item
  })
}

function payloadOf (input: ReportConfigurationTemplateDraft | ReportConfigurationTemplateUpdate, withId: boolean): JsonObject {
  const value = objectOf(input, '报表配置表单')
  const fields = fieldsOf(value.fields)
  const filterFieldNames = filterNamesOf(value.filterFieldNames, fields)
  const filterSet = new Set(filterFieldNames)
  const payload: JsonObject = {
    name: requiredNameOf(value.name, 'name', 50),
    type: scalarTextOf(value.type, 'type'),
    tag: tagOf(value.tag),
    lockTopColumnsCount: nonNegativeIntegerOf(value.lockTopColumnsCount, 'lockTopColumnsCount'),
    detailList: fields.map(field => ({
      name: field.name,
      tableName: field.tableName,
      columnName: field.columnName,
      type: field.type,
      isFilterable: Number(filterSet.has(field.name)),
      filterType: '=',
    })),
  }
  if (withId) payload.id = idOf(value.id, 'id')
  return payload
}

function copyOf (input: ReportConfigurationCopyInput): { id: ReportConfigurationId; name: string } {
  const value = objectOf(input, '复制报表表单')
  return { id: idOf(value.id, 'id'), name: requiredNameOf(value.name, 'name', 30) }
}

function idsOf (value: unknown): ReportConfigurationId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids至少包含一个报表配置ID')
  const ids = value.map((item, index) => idOf(item, `ids[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复报表配置ID')
  return ids
}

function detailParamsOf (query: ReportConfigurationDetailQuery): JsonObject {
  const value = objectOf(query, '报表明细查询')
  const params: JsonObject = { id: idOf(value.id, 'id') }
  if (value.year !== undefined && value.year !== null) params.year = textOf(value.year, 'year')
  if (value.month !== undefined && value.month !== null) params.month = textOf(value.month, 'month')
  const filters = value.filters
  if (filters !== undefined && filters !== null) {
    const filterObject = objectOf(filters, 'filters')
    for (const [key, filterValue] of Object.entries(filterObject)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`filters键名非法：${key}`)
      if (filterValue !== undefined) params[key] = filterValue
    }
  }
  return params
}

function detailRowsOf (value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('报表明细响应必须是数组')
  return value.map((item, index) => ({ ...objectOf(item, `报表明细列表[${index}]`) }))
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>): ReportConfigurationFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('报表明细导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '报表明细.xls'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createReportConfigurationCapability (request: PortalRequest) {
  return {
    async list (query: ReportConfigurationQuery = {}): Promise<PageResult<ReportConfigurationTemplate>> {
      return pageOf(await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryParamsOf(query) }))
    },
    async all (): Promise<ReportConfigurationTemplate[]> {
      const result = await request<unknown>({ url: `${ROOT}/allReport`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('全部报表响应必须是数组')
      return result.map((item, index) => templateOf(item, `全部报表候选[${index}]`))
    },
    async reportFields (type: ReportConfigurationFieldType = 0): Promise<ReportConfigurationField[]> {
      if (![0, 1, 2].includes(type)) throw new Error('type必须是0、1或2')
      const result = await request<unknown>({ url: REPORT_FIELDS_URL, method: 'get', params: { type } })
      if (!Array.isArray(result)) throw new Error('报表字段候选响应必须是数组')
      return result.map(fieldOf)
    },
    async get (input: { id: ReportConfigurationId }): Promise<ReportConfigurationTemplate> {
      const id = idOf(input?.id, 'id')
      return templateOf(await request<unknown>({ url: `${ROOT}/${id}`, method: 'get' }), '报表配置详情')
    },
    async getDetail (query: ReportConfigurationDetailQuery): Promise<Record<string, unknown>[]> {
      return detailRowsOf(await request<unknown>({ url: `${ROOT}/getDetail`, method: 'get', params: detailParamsOf(query) }))
    },
    async export (query: ReportConfigurationDetailQuery): Promise<ReportConfigurationFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: detailParamsOf(query), responseType: 'arraybuffer' }))
    },
    prepareCreate (input: ReportConfigurationTemplateDraft): { draft: JsonObject } {
      return { draft: payloadOf(input, false) }
    },
    async create (input: ReportConfigurationTemplateDraft): Promise<void> {
      await request({ url: ROOT, method: 'post', data: payloadOf(input, false) })
    },
    prepareUpdate (input: ReportConfigurationTemplateUpdate): { draft: JsonObject } {
      return { draft: payloadOf(input, true) }
    },
    async update (input: ReportConfigurationTemplateUpdate): Promise<void> {
      await request({ url: ROOT, method: 'put', data: payloadOf(input, true) })
    },
    prepareRemove (input: { ids: ReportConfigurationId[] }): { ids: ReportConfigurationId[] } {
      return { ids: idsOf(input?.ids) }
    },
    async remove (input: { ids: ReportConfigurationId[] }): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: idsOf(input?.ids) })
    },
    prepareCopy (input: ReportConfigurationCopyInput): { draft: { id: ReportConfigurationId; name: string } } {
      return { draft: copyOf(input) }
    },
    async copy (input: ReportConfigurationCopyInput): Promise<void> {
      const value = this.prepareCopy(input).draft
      const data = new FormData()
      data.append('id', String(value.id))
      data.append('name', value.name)
      await request({ url: `${ROOT}/copyReport`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
    },
  }
}

export type ReportConfigurationCapability = ReturnType<typeof createReportConfigurationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('name', 'text', false, '报表名称模糊查询；省略发送空字符串'), p('type', 'text', false, '报表分类字典值；省略发送null'), p('pageNo', 'number'), p('pageSize', 'number')]
const draftParams = [
  p('name', 'text', true, '报表名称，必填且不能全为空格，最多50字符'),
  p('type', 'text', false, '报表分类字典值；按Portal原值提交'),
  p('tag', 'enum', true, '报表属性：1明细表、2汇总表'),
  p('lockTopColumnsCount', 'number', false, '锁定前几列；省略按Portal默认0'),
  p('fields', 'text', true, '按reportFields返回值保留顺序的字段数组'),
  p('filterFieldNames', 'text', false, '查询字段名称数组；每项必须来自fields.name'),
]
const detailParams = [p('id', 'text', true, '报表模板ID'), p('year', 'text', false, '明细查询年份；省略由后端使用当前年'), p('month', 'text', false, '非汇总报表明细查询月份；省略由后端使用当前月'), p('filters', 'text', false, '按详情detailList[].fieldName组织的动态过滤参数')]

export const REPORT_CONFIGURATION_METHODS = {
  'report-configuration-list': 'list',
  'report-configuration-all': 'all',
  'report-configuration-report-fields': 'reportFields',
  'report-configuration-get': 'get',
  'report-configuration-get-detail': 'getDetail',
  'report-configuration-export': 'export',
  'report-configuration-prepare-create': 'prepareCreate',
  'report-configuration-create': 'create',
  'report-configuration-prepare-update': 'prepareUpdate',
  'report-configuration-update': 'update',
  'report-configuration-prepare-remove': 'prepareRemove',
  'report-configuration-remove': 'remove',
  'report-configuration-prepare-copy': 'prepareCopy',
  'report-configuration-copy': 'copy',
} as const

export const reportConfigurationCapabilities: CapabilityDefinition[] = [
  { id: 'report-configuration-list', title: '查询报表配置', write: false, params: queryParams },
  { id: 'report-configuration-all', title: '查询全部报表配置候选', write: false, params: [] },
  { id: 'report-configuration-report-fields', title: '查询报表字段候选', write: false, params: [p('type', 'enum', false, '字段来源：0全部、1人员信息、2账套信息；页面固定使用0')] },
  { id: 'report-configuration-get', title: '读取报表配置编辑表单', write: false, params: [p('id', 'text', true)] },
  { id: 'report-configuration-get-detail', title: '查询动态报表明细', write: false, params: detailParams },
  { id: 'report-configuration-export', title: '导出动态报表明细', write: false, params: detailParams },
  { id: 'report-configuration-prepare-create', title: '准备创建报表配置', write: false, params: draftParams },
  { id: 'report-configuration-create', title: '创建报表配置', write: true, params: draftParams },
  { id: 'report-configuration-prepare-update', title: '准备修改报表配置', write: false, params: [p('id', 'text', true), ...draftParams] },
  { id: 'report-configuration-update', title: '修改报表配置', write: true, params: [p('id', 'text', true), ...draftParams] },
  { id: 'report-configuration-prepare-remove', title: '准备删除报表配置', write: false, params: [p('ids', 'text', true)] },
  { id: 'report-configuration-remove', title: '删除报表配置', write: true, params: [p('ids', 'text', true)] },
  { id: 'report-configuration-prepare-copy', title: '准备复制报表配置', write: false, params: [p('id', 'text', true), p('name', 'text', true, '复制名称，必填且最多30字符')] },
  { id: 'report-configuration-copy', title: '复制报表配置', write: true, params: [p('id', 'text', true), p('name', 'text', true, '复制名称，必填且最多30字符')] },
].map(definition => ({ ...definition, pagePath: REPORT_CONFIGURATION_PAGE_PATH, permission: REPORT_CONFIGURATION_PERMISSION, moduleType: REPORT_CONFIGURATION_MODULE_TYPE, httpInstance: 'platform' }))
