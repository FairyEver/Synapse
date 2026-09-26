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
  type MaterialJsonObject,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「系统设置 → 库存规则」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const INVENTORY_STOCK_RULE_PAGE_PATH = '/dashboard/material/store/material-rule/list'
const ROOT = '/admin-api/inventory/stock-rule'
const MATERIAL_CATEGORY_TREE_URL = '/admin-api/supply/materiel-category/tree'

export type InventoryStockRuleQuery = {
  materielCategoryId?: MaterialPageId | null
  type?: string | null
  pageNo?: number
  pageSize?: number
}

export type InventoryStockRuleRow = {
  id?: MaterialPageId | null
  materielCategoryId: MaterialPageId | null
  materielCategoryName: string | null
  minPrice: number | null
  maxPrice: number | null
  type: string | null
  typeName: string | null
  subtype?: number | null
  isUpdate: 0 | 1 | null
  createTime?: string | null
  [key: string]: unknown
}

export type InventoryStockRuleDraft = {
  id?: MaterialPageId
  materielCategoryId?: MaterialPageId | null
  minPrice?: number | null
  maxPrice?: number | null
  type?: string | null
  isUpdate?: 0 | 1
}

export type InventoryStockRuleTypeOption = {
  label: string
  value: string
  dictType: string | null
  remark: string | null
  status: number | null
  [key: string]: unknown
}

function queryOf (query: InventoryStockRuleQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    materielCategoryId: query.materielCategoryId === undefined || query.materielCategoryId === null || query.materielCategoryId === '' ? null : materialIdOf(query.materielCategoryId, 'materielCategoryId'),
    type: query.type === undefined ? null : query.type,
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function statusOf (value: unknown, label: string): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 0 && value !== 1) throw new Error(`${label}必须为0或1`)
  return value
}

function rowOf (value: unknown): InventoryStockRuleRow {
  const row = materialObjectOf(value, '库存规则列表行')
  return {
    ...row,
    id: materialOptionalIdOf(row.id, '库存规则id'),
    materielCategoryId: materialOptionalIdOf(row.materielCategoryId, 'materielCategoryId'),
    materielCategoryName: materialTextOf(row.materielCategoryName, 'materielCategoryName'),
    minPrice: materialNullableNumberOf(row.minPrice, 'minPrice', { min: 0 }),
    maxPrice: materialNullableNumberOf(row.maxPrice, 'maxPrice', { min: 0 }),
    type: row.type === undefined || row.type === null ? null : String(row.type),
    typeName: materialTextOf(row.typeName, 'typeName'),
    ...(row.subtype === undefined ? {} : { subtype: materialNullableNumberOf(row.subtype, 'subtype', { integer: true }) }),
    isUpdate: statusOf(row.isUpdate, 'isUpdate'),
    ...(row.createTime === undefined ? {} : { createTime: materialTextOf(row.createTime, 'createTime') }),
  }
}

function draftOf (value: unknown, label = '库存规则表单'): InventoryStockRuleDraft {
  const input = materialObjectOf(value, label)
  const draft: InventoryStockRuleDraft = {
    materielCategoryId: input.materielCategoryId === undefined || input.materielCategoryId === null || input.materielCategoryId === '' ? null : materialIdOf(input.materielCategoryId, `${label}.materielCategoryId`),
    minPrice: materialNullableNumberOf(input.minPrice, `${label}.minPrice`, { min: 0 }),
    maxPrice: materialNullableNumberOf(input.maxPrice, `${label}.maxPrice`, { min: 0 }),
    type: input.type === undefined || input.type === null || input.type === '' ? null : materialTextOf(input.type, `${label}.type`),
    isUpdate: input.isUpdate === undefined || input.isUpdate === null || input.isUpdate === '' ? 1 : statusOf(input.isUpdate, `${label}.isUpdate`)!,
  }
  if (input.id !== undefined && input.id !== null && input.id !== '') draft.id = materialIdOf(input.id, `${label}.id`)
  return draft
}

function optionOf (value: unknown, index: number): InventoryStockRuleTypeOption {
  const row = materialObjectOf(value, `库存规则类型候选[${index}]`)
  const valueOf = row.value
  if (typeof valueOf !== 'string' || !valueOf) throw new Error(`库存规则类型候选[${index}].value必须为非空字符串`)
  return {
    ...row,
    label: typeof row.label === 'string' ? row.label : '',
    value: valueOf,
    dictType: materialTextOf(row.dictType, `库存规则类型候选[${index}].dictType`),
    remark: materialTextOf(row.remark, `库存规则类型候选[${index}].remark`),
    status: materialNullableNumberOf(row.status, `库存规则类型候选[${index}].status`, { integer: true }),
  }
}

export function createInventoryStockRuleCapability (request: PortalRequest) {
  return {
    async list (query: InventoryStockRuleQuery = {}): Promise<PageResult<InventoryStockRuleRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('库存规则分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async get (input: { id: MaterialPageId }): Promise<InventoryStockRuleRow> {
      return rowOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id: materialIdOf(input?.id, '库存规则id') } }))
    },
    async typeList (): Promise<InventoryStockRuleTypeOption[]> {
      const result = await request<unknown>({ url: `${ROOT}/typeList`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('库存规则类型候选响应必须是数组')
      return result.map(optionOf)
    },
    async materialCategoryTree (): Promise<MaterialJsonObject[]> {
      const result = await request<unknown>({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('库存规则物料分类树响应必须是数组')
      return result.map((item, index) => materialTreeOf(item, `库存规则物料分类树[${index}]`))
    },
    prepareCreate (input: InventoryStockRuleDraft): { draft: InventoryStockRuleDraft } {
      const draft = draftOf(input)
      if (draft.id !== undefined) throw new Error('创建库存规则不能传id')
      return { draft }
    },
    async create (input: InventoryStockRuleDraft): Promise<void> {
      const prepared = this.prepareCreate(input)
      await request({ url: `${ROOT}/create`, method: 'post', data: prepared.draft })
    },
    prepareUpdate (input: InventoryStockRuleDraft): { draft: InventoryStockRuleDraft } {
      const draft = draftOf(input, '库存规则修改表单')
      if (draft.id === undefined) throw new Error('修改库存规则必须传id')
      return { draft }
    },
    async update (input: InventoryStockRuleDraft): Promise<void> {
      const prepared = this.prepareUpdate(input)
      await request({ url: `${ROOT}/update`, method: 'put', data: prepared.draft })
    },
    prepareRemove (input: { id: MaterialPageId }): { id: MaterialPageId } {
      return { id: materialIdOf(input?.id, '库存规则id') }
    },
    async remove (input: { id: MaterialPageId }): Promise<void> {
      const prepared = this.prepareRemove(input)
      // Portal useListPageModule with deleteIsBatch=false appends /{id}; preserve that wire path.
      await request({ url: `${ROOT}/delete/${prepared.id}`, method: 'delete' })
    },
  }
}

export type InventoryStockRuleCapability = ReturnType<typeof createInventoryStockRuleCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('materielCategoryId', 'tree', false, '物料分类ID'), p('type', 'text', false, '规则类型值'), p('pageNo', 'number'), p('pageSize', 'number')]
const draftParams: ParamSpec[] = [p('materielCategoryId', 'tree', false), p('minPrice', 'number', false, '最小价格，非负；页面不强制与maxPrice比较'), p('maxPrice', 'number', false, '最大价格，非负；页面不强制与minPrice比较'), p('type', 'text', false, '来自typeList的value'), p('isUpdate', 'enum', false, '0否、1是；默认1')]

export const INVENTORY_STOCK_RULE_METHODS = {
  'inventory-stock-rule-list': 'list',
  'inventory-stock-rule-get': 'get',
  'inventory-stock-rule-type-list': 'typeList',
  'inventory-stock-rule-material-category-tree': 'materialCategoryTree',
  'inventory-stock-rule-prepare-create': 'prepareCreate',
  'inventory-stock-rule-create': 'create',
  'inventory-stock-rule-prepare-update': 'prepareUpdate',
  'inventory-stock-rule-update': 'update',
  'inventory-stock-rule-prepare-remove': 'prepareRemove',
  'inventory-stock-rule-remove': 'remove',
} as const

export const inventoryStockRuleCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-stock-rule-list', title: '查询库存规则', write: false, params: queryParams },
  { id: 'inventory-stock-rule-get', title: '读取库存规则表单', write: false, params: [p('id', 'text', true)] },
  { id: 'inventory-stock-rule-type-list', title: '查询库存规则类型', write: false, params: [] },
  { id: 'inventory-stock-rule-material-category-tree', title: '查询库存规则物料分类树', write: false, params: [] },
  { id: 'inventory-stock-rule-prepare-create', title: '准备创建库存规则', write: false, params: draftParams },
  { id: 'inventory-stock-rule-create', title: '创建库存规则', write: true, params: draftParams },
  { id: 'inventory-stock-rule-prepare-update', title: '准备修改库存规则', write: false, params: [p('id', 'text', true), ...draftParams] },
  { id: 'inventory-stock-rule-update', title: '修改库存规则', write: true, params: [p('id', 'text', true), ...draftParams] },
  { id: 'inventory-stock-rule-prepare-remove', title: '准备删除库存规则', write: false, params: [p('id', 'text', true)] },
  { id: 'inventory-stock-rule-remove', title: '删除库存规则', write: true, params: [p('id', 'text', true)] },
].map(definition => ({ ...definition, pagePath: INVENTORY_STOCK_RULE_PAGE_PATH, permission: '/dashboard/material/store/material-rule', moduleType: 34, httpInstance: 'platform' }))
