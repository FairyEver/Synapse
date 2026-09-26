import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 日龄分割」。 */
export const PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH = '/dashboard/product/setting/business-manage/age-division/list'
export const PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION = '/dashboard/frame/business/age-division'
export const PRODUCT_BUSINESS_AGE_DIVISION_MODULE_TYPE = null
export const PRODUCT_BUSINESS_AGE_DIVISION_QUERY_PERMISSION = 'base:age-division:query'
export const PRODUCT_BUSINESS_AGE_DIVISION_SUBMIT_PERMISSION = 'base:age-division:submit'
export const PRODUCT_BUSINESS_AGE_DIVISION_BATCH_QUERY_PERMISSION = 'base:age-division-batch:query'
export const PRODUCT_BUSINESS_AGE_DIVISION_BATCH_SUBMIT_PERMISSION = 'base:age-division-batch:submit'

const BULK_PAGE_URL = '/base/ageDivision/page'
const BULK_SAVE_URL = '/base/ageDivision/save'
const BULK_DELETE_URL = '/base/ageDivision/delete'
const BATCH_PAGE_URL = '/base/ageDivision/flock/page'
const BATCH_BY_FLOCK_URL = '/base/ageDivision/flock_info'
const BATCH_CREATE_URL = '/base/ageDivision/flock/save'
const BATCH_UPDATE_URL = '/base/ageDivision/flock/edit'

const PAGE_SIZES = [10, 20, 50, 100]

export type ProductBusinessAgeDivisionId = string | number
export type ProductBusinessAgeDivisionMoult = 0 | 1

export type ProductBusinessAgeDivisionBulkQuery = {
  line?: string | null
  gen?: string | null
  variety?: string | null
  moult?: ProductBusinessAgeDivisionMoult | string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductBusinessAgeDivisionBatchQuery = {
  flockInfo?: string | null
  ageDiv?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type ProductBusinessAgeDivisionBulkRow = Record<string, unknown> & {
  id: ProductBusinessAgeDivisionId | null
  line: string | null
  gen: string | null
  variety: string | null
  moult: ProductBusinessAgeDivisionMoult | null
  ageDiv: number | null
  lineName: string | null
  genName: string | null
  varietyName: string | null
}

export type ProductBusinessAgeDivisionBatchRow = Record<string, unknown> & {
  id: ProductBusinessAgeDivisionId | null
  batch: string | null
  ageDiv: number | null
}

export type ProductBusinessAgeDivisionPage<T> = { list: T[]; total: number }

export type ProductBusinessAgeDivisionBulkForm = Record<string, unknown> & {
  id?: ProductBusinessAgeDivisionId | null | ''
  line?: string | null
  gen: string
  variety?: string | null
  moult: ProductBusinessAgeDivisionMoult | string | number
  ageDiv: number | string
}

export type ProductBusinessAgeDivisionBulkDraft = Record<string, unknown> & {
  line: string
  gen: string
  variety: string
  moult: ProductBusinessAgeDivisionMoult
  ageDiv: number
  id?: ProductBusinessAgeDivisionId
}

export type ProductBusinessAgeDivisionBatchForm = Record<string, unknown> & {
  id?: ProductBusinessAgeDivisionId | null | ''
  batch: string
  ageDiv: number | string
}

export type ProductBusinessAgeDivisionBatchDraft = {
  batch: string
  ageDiv: number
  id?: ProductBusinessAgeDivisionId
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductBusinessAgeDivisionId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductBusinessAgeDivisionId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function optionalTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function moultOf (value: unknown, label: string, fallback?: ProductBusinessAgeDivisionMoult): ProductBusinessAgeDivisionMoult {
  const candidate = value === undefined || value === null || value === '' ? fallback : value
  const number = typeof candidate === 'number' ? candidate : typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : NaN
  if (number !== 0 && number !== 1) throw new Error(`${label}只能是0（正常蛋鸡）或1（换羽蛋鸡）`)
  return number as ProductBusinessAgeDivisionMoult
}

function integerOf (value: unknown, label: string, required: boolean, min?: number): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(number) || (min !== undefined && number < min)) throw new Error(`${label}必须为${min === undefined ? '' : `不小于${min}的`}整数`)
  return number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZES.includes(number as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return number as number
}

function nullableFilterTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function bulkQueryOf (query: ProductBusinessAgeDivisionBulkQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    line: nullableFilterTextOf(query.line, '品系筛选'),
    gen: nullableFilterTextOf(query.gen, '代次筛选'),
    variety: nullableFilterTextOf(query.variety, '品种筛选'),
    moult: moultOf(query.moult, '蛋鸡类型', 0),
    flockInfo: '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function batchQueryOf (query: ProductBusinessAgeDivisionBatchQuery = {}): JsonObject {
  const ageDiv = nullableFilterTextOf(query.ageDiv, '日龄分割筛选')
  if (ageDiv !== '' && !/^\d+$/.test(ageDiv)) throw new Error('日龄分割筛选必须为整数')
  return {
    order: '',
    orderField: '',
    flockInfo: nullableFilterTextOf(query.flockInfo, '批次号筛选'),
    ageDiv,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf<T extends JsonObject> (value: unknown, index: number, kind: 'bulk' | 'batch'): T {
  const row = objectOf(value, `${kind === 'bulk' ? '日龄分割' : '批次日龄分割'}列表[${index}]`)
  if (kind === 'bulk') {
    return {
      ...row,
      id: nullableIdOf(row.id, `日龄分割列表[${index}].id`),
      line: nullableTextOf(row.line, `日龄分割列表[${index}].line`),
      gen: nullableTextOf(row.gen, `日龄分割列表[${index}].gen`),
      variety: nullableTextOf(row.variety, `日龄分割列表[${index}].variety`),
      moult: row.moult === undefined || row.moult === null || row.moult === '' ? null : moultOf(row.moult, `日龄分割列表[${index}].蛋鸡类型`),
      ageDiv: integerOf(row.ageDiv, `日龄分割列表[${index}].ageDiv`, false),
      lineName: nullableTextOf(row.lineName, `日龄分割列表[${index}].lineName`),
      genName: nullableTextOf(row.genName, `日龄分割列表[${index}].genName`),
      varietyName: nullableTextOf(row.varietyName, `日龄分割列表[${index}].varietyName`),
    } as unknown as T
  }
  return {
    ...row,
    id: nullableIdOf(row.id, `批次日龄分割列表[${index}].id`),
    batch: nullableTextOf(row.batch, `批次日龄分割列表[${index}].batch`),
    ageDiv: integerOf(row.ageDiv, `批次日龄分割列表[${index}].ageDiv`, false),
  } as unknown as T
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined) return object.data
  }
  return value
}

function pageOf<T extends JsonObject> (value: unknown, kind: 'bulk' | 'batch'): ProductBusinessAgeDivisionPage<T> {
  const envelope = objectOf(payloadOf(value), `${kind === 'bulk' ? '日龄分割' : '批次日龄分割'}分页响应`)
  const page = objectOf(envelope.page ?? envelope, '日龄分割分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('日龄分割分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf<T>(item, index, kind)), total: Number(total) }
}

function flockInfoPageOf (value: unknown): ProductBusinessAgeDivisionPage<ProductBusinessAgeDivisionBulkRow> {
  const payload = payloadOf(value)
  const list = Array.isArray(payload) ? payload : objectOf(payload, '批次日龄分割查询响应').list
  if (!Array.isArray(list)) throw new Error('批次日龄分割查询响应缺少list')
  return { list: list.map((item, index) => rowOf<ProductBusinessAgeDivisionBulkRow>(item, index, 'bulk')), total: list.length }
}

function bulkDraftOf (value: unknown, withId: boolean): ProductBusinessAgeDivisionBulkDraft {
  const form = objectOf(value, '日龄分割表单')
  const line = nullableFilterTextOf(form.line, '品系')
  const variety = nullableFilterTextOf(form.variety, '品种')
  if (line === '' && variety === '') throw new Error('品种和品系至少填一项')
  const draft: ProductBusinessAgeDivisionBulkDraft = {
    line,
    gen: requiredTextOf(form.gen, '代次'),
    variety,
    moult: moultOf(form.moult, '蛋鸡类型'),
    ageDiv: integerOf(form.ageDiv, '日龄分割', true, 0)!,
  }
  if (withId) draft.id = idOf(form.id, '日龄分割ID')
  return draft
}

function batchDraftOf (value: unknown, withId: boolean): ProductBusinessAgeDivisionBatchDraft {
  const form = objectOf(value, '批次日龄分割表单')
  const draft: ProductBusinessAgeDivisionBatchDraft = {
    batch: requiredTextOf(form.batch, '批次号'),
    ageDiv: integerOf(form.ageDiv, '日龄分割', true, 0)!,
  }
  if (withId) draft.id = idOf(form.id, '批次日龄分割ID')
  return draft
}

export function createProductBusinessAgeDivisionCapability (request: PortalRequest) {
  return {
    async listBulk (query: ProductBusinessAgeDivisionBulkQuery = {}): Promise<ProductBusinessAgeDivisionPage<ProductBusinessAgeDivisionBulkRow>> {
      return pageOf(await request({ url: BULK_PAGE_URL, method: 'get', params: bulkQueryOf(query) }), 'bulk')
    },
    async getBulkByFlockInfo (input: { flockInfo?: string | null } = {}): Promise<ProductBusinessAgeDivisionPage<ProductBusinessAgeDivisionBulkRow>> {
      const flockInfo = optionalTextOf(input?.flockInfo, '批次号')
      if (flockInfo === '') return { list: [], total: 0 }
      return flockInfoPageOf(await request({ url: `${BATCH_BY_FLOCK_URL}/${encodeURIComponent(flockInfo)}`, method: 'get' }))
    },
    async listBatch (query: ProductBusinessAgeDivisionBatchQuery = {}): Promise<ProductBusinessAgeDivisionPage<ProductBusinessAgeDivisionBatchRow>> {
      return pageOf(await request({ url: BATCH_PAGE_URL, method: 'get', params: batchQueryOf(query) }), 'batch')
    },
    prepareCreateBulk (form: ProductBusinessAgeDivisionBulkForm) { return { draft: bulkDraftOf(form, false) } },
    async createBulk (input: { draft: ProductBusinessAgeDivisionBulkDraft }): Promise<true> {
      await request({ url: BULK_SAVE_URL, method: 'post', data: bulkDraftOf(input?.draft, false) })
      return true
    },
    prepareUpdateBulk (form: ProductBusinessAgeDivisionBulkForm) { return { draft: bulkDraftOf(form, true) } },
    async updateBulk (input: { draft: ProductBusinessAgeDivisionBulkDraft }): Promise<true> {
      await request({ url: BULK_SAVE_URL, method: 'post', data: bulkDraftOf(input?.draft, true) })
      return true
    },
    prepareRemoveBulk (input: { id: ProductBusinessAgeDivisionId }) { return { id: idOf(input?.id, '日龄分割ID') } },
    async removeBulk (input: { id: ProductBusinessAgeDivisionId }): Promise<true> {
      await request({ url: BULK_DELETE_URL, method: 'get', params: { id: idOf(input?.id, '日龄分割ID') } })
      return true
    },
    prepareCreateBatch (form: ProductBusinessAgeDivisionBatchForm) { return { draft: batchDraftOf(form, false) } },
    async createBatch (input: { draft: ProductBusinessAgeDivisionBatchDraft }): Promise<true> {
      await request({ url: BATCH_CREATE_URL, method: 'post', data: batchDraftOf(input?.draft, false) })
      return true
    },
    prepareUpdateBatch (form: ProductBusinessAgeDivisionBatchForm) { return { draft: batchDraftOf(form, true) } },
    async updateBatch (input: { draft: ProductBusinessAgeDivisionBatchDraft }): Promise<true> {
      await request({ url: BATCH_UPDATE_URL, method: 'post', data: batchDraftOf(input?.draft, true) })
      return true
    },
    prepareRemoveBatch (input: { id: ProductBusinessAgeDivisionId }) { return { id: idOf(input?.id, '批次日龄分割ID') } },
    async removeBatch (input: { id: ProductBusinessAgeDivisionId }): Promise<true> {
      await request({ url: `${BATCH_CREATE_URL.replace('/save', '')}/${idOf(input?.id, '批次日龄分割ID')}`, method: 'delete' })
      return true
    },
  }
}

export type ProductBusinessAgeDivisionCapability = ReturnType<typeof createProductBusinessAgeDivisionCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const bulkFormParam = p('form', 'text', true, '批量设置弹窗表单；品系和品种至少填一项，代次、蛋鸡类型和日龄分割必填。')
const batchFormParam = p('form', 'text', true, '批次设置弹窗表单；批次号和日龄分割必填。')

export const PRODUCT_BUSINESS_AGE_DIVISION_METHODS = {
  'product-business-age-division-list-bulk': 'listBulk',
  'product-business-age-division-get-bulk-by-flock-info': 'getBulkByFlockInfo',
  'product-business-age-division-list-batch': 'listBatch',
  'product-business-age-division-prepare-create-bulk': 'prepareCreateBulk',
  'product-business-age-division-create-bulk': 'createBulk',
  'product-business-age-division-prepare-update-bulk': 'prepareUpdateBulk',
  'product-business-age-division-update-bulk': 'updateBulk',
  'product-business-age-division-prepare-remove-bulk': 'prepareRemoveBulk',
  'product-business-age-division-remove-bulk': 'removeBulk',
  'product-business-age-division-prepare-create-batch': 'prepareCreateBatch',
  'product-business-age-division-create-batch': 'createBatch',
  'product-business-age-division-prepare-update-batch': 'prepareUpdateBatch',
  'product-business-age-division-update-batch': 'updateBatch',
  'product-business-age-division-prepare-remove-batch': 'prepareRemoveBatch',
  'product-business-age-division-remove-batch': 'removeBatch',
} as const

export const productBusinessAgeDivisionCapabilities: CapabilityDefinition[] = [
  { id: 'product-business-age-division-list-bulk', title: '查询日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [p('line', 'text', false, '品系筛选'), p('gen', 'text', false, '代次筛选'), p('variety', 'text', false, '品种筛选'), p('moult', 'enum', false, '蛋鸡类型：0正常、1换羽'), p('pageNo', 'number', false, '页码'), p('pageSize', 'number', false, '每页条数')] },
  { id: 'product-business-age-division-get-bulk-by-flock-info', title: '按批次号查询日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [p('flockInfo', 'text', true, '批次号')] },
  { id: 'product-business-age-division-list-batch', title: '查询批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [p('flockInfo', 'text', false, '批次号筛选'), p('ageDiv', 'text', false, '日龄分割整数筛选'), p('pageNo', 'number', false, '页码'), p('pageSize', 'number', false, '每页条数')] },
  { id: 'product-business-age-division-prepare-create-bulk', title: '准备新建日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [bulkFormParam] },
  { id: 'product-business-age-division-create-bulk', title: '新建日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('draft', 'text', true, 'prepareCreateBulk返回的草稿')] },
  { id: 'product-business-age-division-prepare-update-bulk', title: '准备编辑日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [bulkFormParam] },
  { id: 'product-business-age-division-update-bulk', title: '编辑日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('draft', 'text', true, 'prepareUpdateBulk返回的草稿')] },
  { id: 'product-business-age-division-prepare-remove-bulk', title: '准备删除日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [p('id', 'text', true, '当前列表行ID')] },
  { id: 'product-business-age-division-remove-bulk', title: '删除日龄分割批量设置', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('id', 'text', true, 'prepareRemoveBulk返回的ID')] },
  { id: 'product-business-age-division-prepare-create-batch', title: '准备新建批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [batchFormParam] },
  { id: 'product-business-age-division-create-batch', title: '新建批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('draft', 'text', true, 'prepareCreateBatch返回的草稿')] },
  { id: 'product-business-age-division-prepare-update-batch', title: '准备编辑批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [batchFormParam] },
  { id: 'product-business-age-division-update-batch', title: '编辑批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('draft', 'text', true, 'prepareUpdateBatch返回的草稿')] },
  { id: 'product-business-age-division-prepare-remove-batch', title: '准备删除批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: false, params: [p('id', 'text', true, '当前列表行ID')] },
  { id: 'product-business-age-division-remove-batch', title: '删除批次日龄分割', pagePath: PRODUCT_BUSINESS_AGE_DIVISION_PAGE_PATH, permission: PRODUCT_BUSINESS_AGE_DIVISION_PERMISSION, httpInstance: 'product', moduleType: null, write: true, params: [p('id', 'text', true, 'prepareRemoveBatch返回的ID')] },
]
