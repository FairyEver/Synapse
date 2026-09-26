import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialNumberOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialPageNumberOf,
  materialTextOf,
  materialTrueResponse,
  type MaterialJsonObject,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「物料 → 库存管理 → 计价配置」；静态锚点以当前固定检出为准。 */
export const INVENTORY_VALUATION_PAGE_PATH = '/dashboard/material/store/valuation/list'
export const INVENTORY_VALUATION_PERMISSION = '/dashboard/material/store/valuation'
export const INVENTORY_VALUATION_MODULE_TYPE = 34

const ROOT = '/admin-api/inventory/pricing-method-config'
const STOCK_TYPE_URL = '/admin-api/inventory/stock/typeList'
const MATERIAL_CATEGORY_TREE_URL = '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree'
const UNIT_TREE_URL = '/admin-api/supply/organization/tree?isFactory=1&includeParents=1'
const CHANGE_LOG_ROOT = '/admin-api/inventory/pricing-method-change-log'
const PRICE_HISTORY_ROOT = '/admin-api/inventory/stock-avg-price-history'
const PRICING_METHOD_DICT_TYPE = 'inventory_pricing_method_type'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const PRICING_METHOD_OPTIONS = [1, 2, 3, 4, 5, 6] as const

export type InventoryValuationId = MaterialPageId
export type InventoryValuationPricingMethod = typeof PRICING_METHOD_OPTIONS[number]

export type InventoryValuationQuery = {
  factoryId?: InventoryValuationId | null
  pricingMethod?: InventoryValuationPricingMethod | number | string | null
  materielCategoryIds?: InventoryValuationId[] | string | null
  moveType?: string | null
  pageNo?: number
  pageSize?: number
}

export type InventoryValuationRow = Record<string, unknown> & {
  id: InventoryValuationId
  typeName: string | null
  companyName: string | null
  factoryId: InventoryValuationId | null
  factoryName: string | null
  materielId: InventoryValuationId | null
  materielCategoryId: InventoryValuationId | null
  materielCategoryName: string | null
  materielName: string | null
  pricingMethod: InventoryValuationPricingMethod | null
  type: string | null
  subtype: number | null
  price: number | string | null
  inAvgPrice: number | string | null
  outAvgPrice: number | string | null
  updateTime: string | null
  updaterName: string | null
  updater: InventoryValuationId | null
}

export type InventoryValuationCreateRow = {
  factoryId: InventoryValuationId
  materielCategoryId: InventoryValuationId
  pricingMethod: InventoryValuationPricingMethod | number | string
  moveType: string
  price?: number | null
}

export type InventoryValuationCreatePayload = {
  factoryId: InventoryValuationId
  materielCategoryId: InventoryValuationId
  pricingMethod: InventoryValuationPricingMethod
  type: string
  /** Portal create form sends the part after `-` as a string. */
  subtype: string
  price: number | null
}

export type InventoryValuationUpdateDraft = {
  id: InventoryValuationId
  factoryId: InventoryValuationId
  materielCategoryId: InventoryValuationId
  pricingMethod: InventoryValuationPricingMethod | number | string
  moveType: string
  price?: number | null
}

export type InventoryValuationUpdatePayload = {
  id: InventoryValuationId
  factoryId: InventoryValuationId
  materielCategoryId: InventoryValuationId
  pricingMethod: InventoryValuationPricingMethod
  type: string
  /** Portal edit form calls Number(subtype), so update sends a number. */
  subtype: number
  price: number | null
}

export type InventoryValuationTypeOption = {
  label: string
  value: string
  dictType: string | null
  remark: string | null
  status: number | null
  [key: string]: unknown
}

export type InventoryValuationChangeLog = Record<string, unknown> & {
  id: InventoryValuationId
  factoryId: InventoryValuationId
  materielId: InventoryValuationId
  oldPricingMethod: InventoryValuationPricingMethod | null
  newPricingMethod: InventoryValuationPricingMethod | null
  createTime: string | null
  creator: InventoryValuationId | null
  creatorName: string | null
}

export type InventoryValuationPriceHistoryRow = Record<string, unknown> & {
  id: InventoryValuationId
  materielId: InventoryValuationId | null
  factoryId: InventoryValuationId
  year: number
  month: number
  inAvgPrice: number | string | null
  outAvgPrice: number | string | null
  createTime: string | null
}

function idOrNull (value: unknown, label: string): MaterialPageId | null {
  if (value === undefined || value === null || value === '') return null
  return materialOptionalIdOf(value, label)
}

function nullablePricingMethodOf (value: unknown, label: string): InventoryValuationPricingMethod | null {
  if (value === undefined || value === null || value === '') return null
  const normalized = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || !PRICING_METHOD_OPTIONS.includes(normalized as InventoryValuationPricingMethod)) {
    throw new Error(`${label}必须是1至6的计价方式值`)
  }
  return normalized as InventoryValuationPricingMethod
}

function pricingMethodOf (value: unknown, label: string): InventoryValuationPricingMethod {
  const result = nullablePricingMethodOf(value, label)
  if (result === null) throw new Error(`${label}必填`)
  return result
}

function decimalOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须是数字或null`)
}

function inputPriceOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = materialNumberOf(value, label, { min: 0 })
  const decimalPart = String(value).split('.')[1]
  if (decimalPart && decimalPart.length > 3) throw new Error(`${label}最多保留3位小数`)
  return number
}

function moveTypePartsOf (value: unknown, label: string): { type: string; subtype: string } {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必填；应来自typeList的value`)
  const parts = value.split('-')
  const type = parts[0]
  const subtype = parts[1]
  if (parts.length !== 2 || type === undefined || subtype === undefined || type === '' || subtype === '' || !/^\d+$/.test(subtype)) {
    throw new Error(`${label}必须是type-subtype格式`)
  }
  return { type, subtype }
}

function categoryIdsOf (value: InventoryValuationQuery['materielCategoryIds']): string {
  if (value === undefined || value === null || value === '') return ''
  const values = typeof value === 'string' ? value.split(',').filter(Boolean) : value
  if (!Array.isArray(values)) throw new Error('materielCategoryIds必须是ID数组或逗号字符串')
  return values.map((item, index) => String(materialIdOf(item, `materielCategoryIds[${index}]`))).join(',')
}

function queryOf (query: InventoryValuationQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    factoryId: idOrNull(query.factoryId, 'factoryId'),
    pricingMethod: nullablePricingMethodOf(query.pricingMethod, 'pricingMethod'),
    materielCategoryIds: categoryIdsOf(query.materielCategoryIds ?? []),
    moveType: query.moveType === undefined || query.moveType === null || query.moveType === '' ? null : String(query.moveType),
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(resolved as typeof PAGE_SIZE_OPTIONS[number])) throw new Error(`${label}必须是页面支持的${PAGE_SIZE_OPTIONS.join('、')}`)
  return resolved
}

function rowOf (value: unknown, label = '计价配置列表行'): InventoryValuationRow {
  const row = materialObjectOf(value, label)
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    typeName: materialTextOf(row.typeName, `${label}.typeName`),
    companyName: materialTextOf(row.companyName, `${label}.companyName`),
    factoryId: idOrNull(row.factoryId, `${label}.factoryId`),
    factoryName: materialTextOf(row.factoryName, `${label}.factoryName`),
    materielId: idOrNull(row.materielId, `${label}.materielId`),
    materielCategoryId: idOrNull(row.materielCategoryId, `${label}.materielCategoryId`),
    materielCategoryName: materialTextOf(row.materielCategoryName, `${label}.materielCategoryName`),
    materielName: materialTextOf(row.materielName, `${label}.materielName`),
    pricingMethod: nullablePricingMethodOf(row.pricingMethod, `${label}.pricingMethod`),
    type: materialTextOf(row.type, `${label}.type`),
    subtype: row.subtype === undefined || row.subtype === null || row.subtype === '' ? null : materialNumberOf(row.subtype, `${label}.subtype`, { integer: true }),
    price: decimalOf(row.price, `${label}.price`),
    inAvgPrice: decimalOf(row.inAvgPrice, `${label}.inAvgPrice`),
    outAvgPrice: decimalOf(row.outAvgPrice, `${label}.outAvgPrice`),
    updateTime: materialTextOf(row.updateTime, `${label}.updateTime`),
    updaterName: materialTextOf(row.updaterName, `${label}.updaterName`),
    updater: idOrNull(row.updater, `${label}.updater`),
  }
}

function pageOf (value: unknown, label: string): PageResult<unknown> {
  const page = materialObjectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list, total: page.total }
}

function categoryNodeOf (value: unknown, label: string, level: number): MaterialJsonObject {
  const row = materialObjectOf(value, label)
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const catName = materialTextOf(row.catName, `${label}.catName`)
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    catName,
    name: typeof row.name === 'string' ? row.name : catName ?? '',
    level,
    children: children.map((item, index) => categoryNodeOf(item, `${label}.children[${index}]`, level + 1)),
  }
}

function unitNodeOf (value: unknown, label: string): MaterialJsonObject {
  const row = materialObjectOf(value, label)
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const isFactory = row.isFactory === undefined || row.isFactory === null ? null : materialNumberOf(row.isFactory, `${label}.isFactory`, { integer: true })
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    name: typeof row.name === 'string' ? row.name : '',
    isFactory,
    disabled: isFactory !== 1,
    children: children.map((item, index) => unitNodeOf(item, `${label}.children[${index}]`)),
  }
}

function typeOptionOf (value: unknown, index: number): InventoryValuationTypeOption {
  const row = materialObjectOf(value, `出入库类型候选[${index}]`)
  if (typeof row.value !== 'string' || row.value === '') throw new Error(`出入库类型候选[${index}].value必须为非空字符串`)
  return {
    ...row,
    label: typeof row.label === 'string' ? row.label : '',
    value: row.value,
    dictType: materialTextOf(row.dictType, `出入库类型候选[${index}].dictType`),
    remark: materialTextOf(row.remark, `出入库类型候选[${index}].remark`),
    status: row.status === undefined || row.status === null || row.status === '' ? null : materialNumberOf(row.status, `出入库类型候选[${index}].status`, { integer: true }),
  }
}

function createPayloadOf (value: unknown, label: string): InventoryValuationCreatePayload[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const row = materialObjectOf(item, `${label}[${index}]`)
    const moveType = moveTypePartsOf(row.moveType, `${label}[${index}].moveType`)
    const pricingMethod = pricingMethodOf(row.pricingMethod, `${label}[${index}].pricingMethod`)
    const price = inputPriceOf(row.price, `${label}[${index}].price`)
    if (pricingMethod === 4 && price === null) throw new Error(`${label}[${index}].price在标准价法（4）时必填`)
    return {
      factoryId: materialIdOf(row.factoryId, `${label}[${index}].factoryId`),
      materielCategoryId: materialIdOf(row.materielCategoryId, `${label}[${index}].materielCategoryId`),
      pricingMethod,
      type: moveType.type,
      subtype: moveType.subtype,
      price,
    }
  })
}

function createDraftOf (value: unknown, label: string): InventoryValuationCreatePayload[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    const row = materialObjectOf(item, `${label}[${index}]`)
    const pricingMethod = pricingMethodOf(row.pricingMethod, `${label}[${index}].pricingMethod`)
    const price = inputPriceOf(row.price, `${label}[${index}].price`)
    if (typeof row.type !== 'string' || row.type === '') throw new Error(`${label}[${index}].type必填`)
    if (typeof row.subtype !== 'string' || !/^\d+$/.test(row.subtype)) throw new Error(`${label}[${index}].subtype必须是数字字符串`)
    if (pricingMethod === 4 && price === null) throw new Error(`${label}[${index}].price在标准价法（4）时必填`)
    return {
      factoryId: materialIdOf(row.factoryId, `${label}[${index}].factoryId`),
      materielCategoryId: materialIdOf(row.materielCategoryId, `${label}[${index}].materielCategoryId`),
      pricingMethod,
      type: row.type,
      subtype: row.subtype,
      price,
    }
  })
}

function updatePayloadOf (value: unknown, label: string): InventoryValuationUpdatePayload {
  const row = materialObjectOf(value, label)
  const moveType = moveTypePartsOf(row.moveType, `${label}.moveType`)
  const pricingMethod = pricingMethodOf(row.pricingMethod, `${label}.pricingMethod`)
  const price = inputPriceOf(row.price, `${label}.price`)
  if (pricingMethod === 4 && price === null) throw new Error(`${label}.price在标准价法（4）时必填`)
  return {
    id: materialIdOf(row.id, `${label}.id`),
    factoryId: materialIdOf(row.factoryId, `${label}.factoryId`),
    materielCategoryId: materialIdOf(row.materielCategoryId, `${label}.materielCategoryId`),
    pricingMethod,
    type: moveType.type,
    subtype: Number(moveType.subtype),
    price,
  }
}

function updateDraftOf (value: unknown, label: string): InventoryValuationUpdatePayload {
  const row = materialObjectOf(value, label)
  const pricingMethod = pricingMethodOf(row.pricingMethod, `${label}.pricingMethod`)
  const price = inputPriceOf(row.price, `${label}.price`)
  if (typeof row.type !== 'string' || row.type === '') throw new Error(`${label}.type必填`)
  const subtype = materialNumberOf(row.subtype, `${label}.subtype`, { integer: true })
  if (pricingMethod === 4 && price === null) throw new Error(`${label}.price在标准价法（4）时必填`)
  return {
    id: materialIdOf(row.id, `${label}.id`),
    factoryId: materialIdOf(row.factoryId, `${label}.factoryId`),
    materielCategoryId: materialIdOf(row.materielCategoryId, `${label}.materielCategoryId`),
    pricingMethod,
    type: row.type,
    subtype,
    price,
  }
}

function changeLogOf (value: unknown, index: number): InventoryValuationChangeLog {
  const row = materialObjectOf(value, `计价方式变更记录[${index}]`)
  return {
    ...row,
    id: materialIdOf(row.id, `计价方式变更记录[${index}].id`),
    factoryId: materialIdOf(row.factoryId, `计价方式变更记录[${index}].factoryId`),
    materielId: materialIdOf(row.materielId, `计价方式变更记录[${index}].materielId`),
    oldPricingMethod: nullablePricingMethodOf(row.oldPricingMethod, `计价方式变更记录[${index}].oldPricingMethod`),
    newPricingMethod: nullablePricingMethodOf(row.newPricingMethod, `计价方式变更记录[${index}].newPricingMethod`),
    createTime: materialTextOf(row.createTime, `计价方式变更记录[${index}].createTime`),
    creator: idOrNull(row.creator, `计价方式变更记录[${index}].creator`),
    creatorName: materialTextOf(row.creatorName, `计价方式变更记录[${index}].creatorName`),
  }
}

function priceHistoryOf (value: unknown, index: number): InventoryValuationPriceHistoryRow {
  const row = materialObjectOf(value, `出入库单价历史[${index}]`)
  return {
    ...row,
    id: materialIdOf(row.id, `出入库单价历史[${index}].id`),
    materielId: idOrNull(row.materielId, `出入库单价历史[${index}].materielId`),
    factoryId: materialIdOf(row.factoryId, `出入库单价历史[${index}].factoryId`),
    year: materialNumberOf(row.year, `出入库单价历史[${index}].year`, { integer: true }),
    month: materialNumberOf(row.month, `出入库单价历史[${index}].month`, { integer: true, min: 1, max: 12 }),
    inAvgPrice: decimalOf(row.inAvgPrice, `出入库单价历史[${index}].inAvgPrice`),
    outAvgPrice: decimalOf(row.outAvgPrice, `出入库单价历史[${index}].outAvgPrice`),
    createTime: materialTextOf(row.createTime, `出入库单价历史[${index}].createTime`),
  }
}

function maxPagesOf (value: unknown): number {
  const resolved = value === undefined ? 100 : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1 || resolved > 100) throw new Error('maxPages必须是1至100的整数')
  return resolved
}

export function createInventoryValuationCapability (request: PortalRequest) {
  return {
    async list (query: InventoryValuationQuery = {}): Promise<PageResult<InventoryValuationRow>> {
      const page = pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }), '计价配置分页响应')
      return { list: page.list.map((item, index) => rowOf(item, `计价配置分页响应.list[${index}]`)), total: page.total }
    },
    async typeList (): Promise<InventoryValuationTypeOption[]> {
      const result = await request<unknown>({ url: STOCK_TYPE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('出入库类型候选响应必须是数组')
      return result.map(typeOptionOf)
    },
    async materialCategoryTree (): Promise<MaterialJsonObject[]> {
      const result = await request<unknown>({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get', params: { level: 5 } })
      if (!Array.isArray(result)) throw new Error('计价配置物料分类树响应必须是数组')
      return result.map((item, index) => categoryNodeOf(item, `计价配置物料分类树[${index}]`, 1))
    },
    async unitTree (): Promise<MaterialJsonObject[]> {
      const result = await request<unknown>({ url: UNIT_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('计价配置所属单元树响应必须是数组')
      return result.map((item, index) => unitNodeOf(item, `计价配置所属单元树[${index}]`))
    },
    async get (input: { id: InventoryValuationId }): Promise<InventoryValuationRow> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: materialIdOf(input?.id, '计价配置id') } }), '计价配置详情')
    },
    prepareCreate (input: { rows: InventoryValuationCreateRow[] }): { draft: InventoryValuationCreatePayload[] } {
      return { draft: createPayloadOf(input?.rows, '计价配置创建行') }
    },
    async create (input: { draft: InventoryValuationCreatePayload[] }): Promise<true> {
      const draft = createDraftOf(input?.draft, '计价配置创建草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/create`, method: 'post', data: draft }), '创建计价配置')
    },
    prepareUpdate (input: InventoryValuationUpdateDraft): { draft: InventoryValuationUpdatePayload } {
      return { draft: updatePayloadOf(input, '计价配置修改表单') }
    },
    async update (input: { draft: InventoryValuationUpdatePayload }): Promise<true> {
      const draft = updateDraftOf(input?.draft, '计价配置修改草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/update`, method: 'put', data: draft }), '修改计价配置')
    },
    prepareRemove (input: { id: InventoryValuationId }): { draft: { id: InventoryValuationId } } {
      return { draft: { id: materialIdOf(input?.id, '计价配置id') } }
    },
    async remove (input: { draft: { id: InventoryValuationId } }): Promise<true> {
      const id = materialIdOf(input?.draft?.id, '计价配置id')
      return materialTrueResponse(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除计价配置')
    },
    async changeLogs (input: { factoryId: InventoryValuationId; materielId: InventoryValuationId; pageSize?: number; maxPages?: number }): Promise<InventoryValuationChangeLog[]> {
      const factoryId = materialIdOf(input?.factoryId, '变动详情factoryId')
      const materielId = materialIdOf(input?.materielId, '变动详情materielId')
      const pageSize = input?.pageSize === undefined ? 500 : input.pageSize
      if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('变动详情pageSize必须为正整数')
      const maxPages = maxPagesOf(input?.maxPages)
      const all: InventoryValuationChangeLog[] = []
      for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
        const page = pageOf(await request({ url: `${CHANGE_LOG_ROOT}/page`, method: 'get', params: { pageNo, pageSize, factoryId, materielId } }), '计价方式变更记录分页响应')
        all.push(...page.list.map((item, index) => changeLogOf(item, all.length + index)))
        if (all.length >= page.total || page.list.length === 0) break
      }
      return all
    },
    async priceHistoryList (query: { factoryId: InventoryValuationId; materielId: InventoryValuationId; pageNo?: number; pageSize?: number }): Promise<PageResult<InventoryValuationPriceHistoryRow>> {
      const page = pageOf(await request({
        url: `${PRICE_HISTORY_ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
          factoryId: materialIdOf(query?.factoryId, '单价历史factoryId'),
          materielId: materialIdOf(query?.materielId, '单价历史materielId'),
          pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query?.pageSize, 20, 'pageSize'),
        },
      }), '出入库单价历史分页响应')
      return { list: page.list.map((item, index) => priceHistoryOf(item, index)), total: page.total }
    },
  }
}

export type InventoryValuationCapability = ReturnType<typeof createInventoryValuationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const pricingMethodParam = p('pricingMethod', 'enum', false, '计价方式1至6；候选标签和当前值用base-dict-get(dictType=inventory_pricing_method_type)读取')
const updatePricingMethodParam = p('pricingMethod', 'enum', true, '计价方式1至6；4时必须填写price')
const rowParams = [p('rows', 'text', true, '创建行数组；每行factoryId、materielCategoryId、pricingMethod、moveType、price')]
const createDraftParams = [p('draft', 'text', true, 'prepareCreate返回的draft数组；创建请求保持subtype为字符串')]
const updateParams = [p('id', 'text', true, '计价配置ID'), p('factoryId', 'text', true, '详情中的所属单元ID'), p('materielCategoryId', 'text', true, '详情中的物料分类ID'), updatePricingMethodParam, p('moveType', 'text', true, 'typeList返回的type-subtype值'), p('price', 'number', false, '标准价法（4）必填；非4时页面可能提交null')]
const updateDraftParams = [p('draft', 'text', true, 'prepareUpdate返回的draft对象；提交时按Portal发送数字subtype')]

export const INVENTORY_VALUATION_METHODS = {
  'inventory-valuation-list': 'list',
  'inventory-valuation-type-list': 'typeList',
  'inventory-valuation-material-category-tree': 'materialCategoryTree',
  'inventory-valuation-unit-tree': 'unitTree',
  'inventory-valuation-get': 'get',
  'inventory-valuation-prepare-create': 'prepareCreate',
  'inventory-valuation-create': 'create',
  'inventory-valuation-prepare-update': 'prepareUpdate',
  'inventory-valuation-update': 'update',
  'inventory-valuation-prepare-remove': 'prepareRemove',
  'inventory-valuation-remove': 'remove',
  'inventory-valuation-change-logs': 'changeLogs',
  'inventory-valuation-price-history-list': 'priceHistoryList',
} as const

export const inventoryValuationCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-valuation-list', title: '查询计价配置', write: false, params: [p('factoryId', 'tree', false, '所属工厂/标准化单元ID'), pricingMethodParam, p('materielCategoryIds', 'tree', false, '物料分类ID数组；发请求时join为逗号字符串'), p('moveType', 'text', false, '出入库类型type-subtype'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'inventory-valuation-type-list', title: '查询计价配置出入库类型', write: false, params: [] },
  { id: 'inventory-valuation-material-category-tree', title: '查询计价配置物料分类树', write: false, params: [] },
  { id: 'inventory-valuation-unit-tree', title: '查询计价配置所属单元树', write: false, params: [] },
  { id: 'inventory-valuation-get', title: '读取计价配置详情', write: false, params: [p('id', 'text', true, '计价配置ID')] },
  { id: 'inventory-valuation-prepare-create', title: '准备创建计价配置', write: false, params: rowParams },
  { id: 'inventory-valuation-create', title: '创建计价配置', write: true, params: createDraftParams },
  { id: 'inventory-valuation-prepare-update', title: '准备修改计价配置', write: false, params: updateParams },
  { id: 'inventory-valuation-update', title: '修改计价配置', write: true, params: updateDraftParams },
  { id: 'inventory-valuation-prepare-remove', title: '准备删除计价配置', write: false, params: [p('id', 'text', true, '计价配置ID')] },
  { id: 'inventory-valuation-remove', title: '删除计价配置', write: true, params: [p('draft', 'text', true, 'prepareRemove返回的ID草稿；后端还会校验当月单据和未定价单据')] },
  { id: 'inventory-valuation-change-logs', title: '查询计价方式变动详情', write: false, params: [p('factoryId', 'text', true, '变动详情页桥接的工厂ID'), p('materielId', 'text', true, 'Portal详情页实际把路由计价配置ID作为此参数传入'), p('pageSize', 'number', false, '默认500'), p('maxPages', 'number', false, '默认100，最多100页')] },
  { id: 'inventory-valuation-price-history-list', title: '查询出入库单价历史', write: false, params: [p('factoryId', 'text', true, '桥接的工厂ID'), p('materielId', 'text', true, '列表行物料ID'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
].map(definition => ({ ...definition, pagePath: INVENTORY_VALUATION_PAGE_PATH, permission: INVENTORY_VALUATION_PERMISSION, moduleType: INVENTORY_VALUATION_MODULE_TYPE, httpInstance: 'platform' }))

export { PRICING_METHOD_DICT_TYPE }
