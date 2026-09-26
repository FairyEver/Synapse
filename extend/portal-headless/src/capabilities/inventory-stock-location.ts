import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialNullableNumberOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialPageNumberOf,
  materialTextOf,
  materialTreeOf,
  materialTrueResponse,
  type MaterialJsonObject,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「系统设置 → 库存配置」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const INVENTORY_STOCK_LOCATION_PAGE_PATH = '/dashboard/material/store/point-setting/list'
const ROOT = '/admin-api/inventory/stock-location'
const UNIT_TREE_URL = '/admin-api/supply/organization/tree?isFactory=1&includeParents=1'
const MATERIAL_CATEGORY_TREE_URL = '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree'

export type InventoryStockLocationQuery = {
  unitId?: MaterialPageId | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type InventoryStockLocationRow = {
  id?: MaterialPageId | null
  unitId: MaterialPageId | null
  unitName: string | null
  materielCategoryId: MaterialPageId | null
  materielCategoryName: string | null
  name: string | null
  creator?: MaterialPageId | null
  creatorName: string | null
  createTime: string | null
  minQuantity: number | null
  maxQuantity: number | null
  status: boolean
  [key: string]: unknown
}

export type InventoryStockLocationDraft = {
  unitId: MaterialPageId
  materielCategoryId: MaterialPageId
  name: string
  minQuantity?: number | null
  maxQuantity?: number | null
}

export type InventoryStockLocationStatusInput = {
  id: MaterialPageId
  currentStatus: boolean
  status: boolean
}

export type InventoryStockLocationStatusDraft = {
  id: MaterialPageId
  status: boolean
}

export type InventoryStockLocationStatusPreparation = {
  draft: InventoryStockLocationStatusDraft
  previous: InventoryStockLocationStatusDraft
}

function queryOf (query: InventoryStockLocationQuery = {}): Record<string, unknown> {
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  return {
    order: '',
    orderField: '',
    unitId: query.unitId === undefined || query.unitId === null || query.unitId === '' ? null : materialIdOf(query.unitId, 'unitId'),
    name: query.name === undefined ? null : query.name,
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function booleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值`)
  return value
}

function statusDraftOf (value: unknown, label: string): InventoryStockLocationStatusDraft {
  const draft = materialObjectOf(value, label)
  return {
    id: materialIdOf(draft.id, `${label}.id`),
    status: booleanOf(draft.status, `${label}.status`),
  }
}

function quantityOf (value: unknown, label: string): number | null {
  const number = materialNullableNumberOf(value, label, { min: 0 })
  if (number !== null && Math.round(number * 100) !== number * 100) throw new Error(`${label}最多保留2位小数`)
  return number
}

function rowOf (value: unknown): InventoryStockLocationRow {
  const row = materialObjectOf(value, '库存地点列表行')
  return {
    ...row,
    id: materialOptionalIdOf(row.id, '库存地点id'),
    unitId: materialOptionalIdOf(row.unitId, 'unitId'),
    unitName: materialTextOf(row.unitName, 'unitName'),
    materielCategoryId: materialOptionalIdOf(row.materielCategoryId, 'materielCategoryId'),
    materielCategoryName: materialTextOf(row.materielCategoryName, 'materielCategoryName'),
    name: materialTextOf(row.name, 'name'),
    ...(row.creator === undefined ? {} : { creator: materialOptionalIdOf(row.creator, 'creator') }),
    creatorName: materialTextOf(row.creatorName, 'creatorName'),
    createTime: materialTextOf(row.createTime, 'createTime'),
    minQuantity: quantityOf(row.minQuantity, 'minQuantity'),
    maxQuantity: quantityOf(row.maxQuantity, 'maxQuantity'),
    status: booleanOf(row.status, 'status'),
  }
}

function draftOf (value: unknown, index: number): Record<string, unknown> {
  const row = materialObjectOf(value, `库存地点创建行[${index}]`)
  if (typeof row.name !== 'string' || !row.name) throw new Error(`库存地点创建行[${index}].name必填`)
  if (row.name.length > 20) throw new Error(`库存地点创建行[${index}].name最多20个字符`)
  return {
    unitId: materialIdOf(row.unitId, `库存地点创建行[${index}].unitId`),
    materielCategoryId: materialIdOf(row.materielCategoryId, `库存地点创建行[${index}].materielCategoryId`),
    name: row.name,
    status: true,
    minQuantity: quantityOf(row.minQuantity, `库存地点创建行[${index}].minQuantity`),
    maxQuantity: quantityOf(row.maxQuantity, `库存地点创建行[${index}].maxQuantity`),
  }
}

function draftsOf (value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('库存地点创建行至少包含一行')
  return value.map((row, index) => draftOf(row, index))
}

function treeListOf (value: unknown, label: string): MaterialJsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => materialTreeOf(item, `${label}[${index}]`))
}

export function createInventoryStockLocationCapability (request: PortalRequest) {
  return {
    async list (query: InventoryStockLocationQuery = {}): Promise<PageResult<InventoryStockLocationRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('库存地点分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async unitTree (): Promise<MaterialJsonObject[]> {
      return treeListOf(await request<unknown>({ url: UNIT_TREE_URL, method: 'get' }), '库存地点所属单元树')
    },
    async materialCategoryTree (): Promise<MaterialJsonObject[]> {
      return treeListOf(await request<unknown>({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get' }), '库存地点物料分类树')
    },
    prepareCreate (input: { rows: InventoryStockLocationDraft[] }): { rows: Record<string, unknown>[] } {
      return { rows: draftsOf(input?.rows) }
    },
    async create (input: { rows: InventoryStockLocationDraft[] }): Promise<void> {
      const prepared = this.prepareCreate(input)
      await request({ url: `${ROOT}/create`, method: 'post', data: prepared.rows })
    },
    prepareSetStatus (input: InventoryStockLocationStatusInput): InventoryStockLocationStatusPreparation {
      const id = materialIdOf(input?.id, '库存地点id')
      const currentStatus = booleanOf(input?.currentStatus, 'currentStatus')
      const status = booleanOf(input?.status, 'status')
      if (currentStatus === status) throw new Error('目标status必须与列表当前status相反')
      return {
        draft: { id, status },
        previous: { id, status: currentStatus },
      }
    },
    async setStatus (input: { draft: InventoryStockLocationStatusDraft }): Promise<true> {
      const draft = statusDraftOf(input?.draft, '库存地点启停草稿')
      const result = await request<unknown>({ url: `${ROOT}/${draft.status ? 'open' : 'close'}`, method: 'put', data: { id: draft.id } })
      return materialTrueResponse(result, '库存地点启停')
    },

    cancelSetStatus (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type InventoryStockLocationCapability = ReturnType<typeof createInventoryStockLocationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('unitId', 'tree', false, '所属单元ID'), p('name', 'text', false, '库存地点名称'), p('pageNo', 'number'), p('pageSize', 'number')]
const draftParams: ParamSpec[] = [p('rows', 'text', true, '创建行数组；每行包含unitId、materielCategoryId、name、minQuantity、maxQuantity')]

export const INVENTORY_STOCK_LOCATION_METHODS = {
  'inventory-stock-location-list': 'list',
  'inventory-stock-location-unit-tree': 'unitTree',
  'inventory-stock-location-material-category-tree': 'materialCategoryTree',
  'inventory-stock-location-prepare-create': 'prepareCreate',
  'inventory-stock-location-create': 'create',
  'inventory-stock-location-prepare-set-status': 'prepareSetStatus',
  'inventory-stock-location-set-status': 'setStatus',
  'inventory-stock-location-cancel-set-status': 'cancelSetStatus',
} as const

export const inventoryStockLocationCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-stock-location-list', title: '查询库存地点', write: false, params: queryParams },
  { id: 'inventory-stock-location-unit-tree', title: '查询库存地点所属单元树', write: false, params: [] },
  { id: 'inventory-stock-location-material-category-tree', title: '查询库存地点物料分类树', write: false, params: [] },
  { id: 'inventory-stock-location-prepare-create', title: '准备创建库存地点', write: false, params: draftParams },
  { id: 'inventory-stock-location-create', title: '创建库存地点', write: true, params: draftParams },
  { id: 'inventory-stock-location-prepare-set-status', title: '准备启用或停用库存地点', write: false, params: [p('id', 'text', true, '当前列表记录ID'), p('currentStatus', 'boolean', true, '当前列表status；必须来自最新列表行'), p('status', 'boolean', true, '目标绝对状态；必须与currentStatus相反')] },
  { id: 'inventory-stock-location-set-status', title: '启用或停用库存地点', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{ id, status }草稿')] },
  { id: 'inventory-stock-location-cancel-set-status', title: '取消库存地点启停提交', write: false, params: [] },
].map(definition => ({ ...definition, pagePath: INVENTORY_STOCK_LOCATION_PAGE_PATH, permission: '/dashboard/material/store/point-setting', moduleType: 34, httpInstance: 'platform' }))
