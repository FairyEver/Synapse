import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialNullableNumberOf,
  materialNumberOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialPageNumberOf,
  materialTextOf,
  materialTreeOf,
  type MaterialJsonObject,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「系统设置 → 折旧配置」；静态锚点 Portal 8b9a5554d4、Java d83e4086fd5。 */
export const INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH = '/dashboard/material/assets/setting/list'
const ROOT = '/admin-api/inventory/asset-depreciation-config'
const ASSET_CATEGORY_URL = '/admin-api/inventory/asset-category/page'
const ASSET_CATEGORY_PAGE_SIZE = 500
const ASSET_CATEGORY_MAX_PAGES = 100
const MATERIAL_CATEGORY_TREE_URL = `${ROOT}/get-materiel-category-tree`

export type InventoryAssetDepreciationConfigQuery = {
  depreciationLifeMonth?: number | null
  materialCategory?: MaterialPageId | null
  pageNo?: number
  pageSize?: number
}

export type InventoryAssetDepreciationConfigRow = {
  id?: MaterialPageId | null
  assetType?: number | null
  assetCategory: number | null
  depreciationMethod: number | string | null
  depreciationYear: number | null
  depreciationLifeMonth?: number | null
  depreciationDate: number | null
  netSalvageValueRate: number | null
  materialCategory: MaterialPageId | null
  materialCategoryPath: string | null
  addAmortizationAccrualRule?: number | null
  reductionAmortizationAccrualRule?: number | null
  isCurrMonthDep: 0 | 1 | null
  isDepreciationReduction: 0 | 1 | null
  createTime?: string | null
  [key: string]: unknown
}

export type InventoryAssetCategoryOption = {
  id: MaterialPageId
  categoryName: string
  label: string
  value: MaterialPageId
  [key: string]: unknown
}

export type InventoryAssetDepreciationConfigDraft = {
  id?: MaterialPageId
  assetCategory: number
  depreciationMethod: number | string
  depreciationYear: number
  depreciationDate: number
  netSalvageValueRate: number
  materialCategory?: MaterialPageId | null | ''
  isCurrMonthDep?: 0 | 1
  isDepreciationReduction?: 0 | 1
}

function queryOf (query: InventoryAssetDepreciationConfigQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    depreciationLifeMonth: query.depreciationLifeMonth === undefined ? null : materialNullableNumberOf(query.depreciationLifeMonth, 'depreciationLifeMonth', { integer: true, min: 0 }),
    materialCategory: query.materialCategory === undefined || query.materialCategory === null || query.materialCategory === '' ? null : materialIdOf(query.materialCategory, 'materialCategory'),
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function flagOf (value: unknown, label: string): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 0 && value !== 1) throw new Error(`${label}必须为0或1`)
  return value
}

function methodOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return materialNumberOf(value, label, { integer: true, min: 1 })
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数枚举值`)
}

function rowOf (value: unknown, label = '资产折旧配置'): InventoryAssetDepreciationConfigRow {
  const row = materialObjectOf(value, label)
  return {
    ...row,
    id: materialOptionalIdOf(row.id, `${label}.id`),
    assetType: materialNullableNumberOf(row.assetType, `${label}.assetType`, { integer: true, min: 1 }),
    assetCategory: materialNullableNumberOf(row.assetCategory, `${label}.assetCategory`, { integer: true, min: 1 }),
    depreciationMethod: methodOf(row.depreciationMethod, `${label}.depreciationMethod`),
    depreciationYear: materialNullableNumberOf(row.depreciationYear, `${label}.depreciationYear`, { integer: true, min: 0 }),
    ...(row.depreciationLifeMonth === undefined ? {} : { depreciationLifeMonth: materialNullableNumberOf(row.depreciationLifeMonth, `${label}.depreciationLifeMonth`, { integer: true, min: 0 }) }),
    depreciationDate: materialNullableNumberOf(row.depreciationDate, `${label}.depreciationDate`, { integer: true, min: 1, max: 25 }),
    netSalvageValueRate: materialNullableNumberOf(row.netSalvageValueRate, `${label}.netSalvageValueRate`, { min: 0, max: 100 }),
    materialCategory: materialOptionalIdOf(row.materialCategory, `${label}.materialCategory`),
    materialCategoryPath: materialTextOf(row.materialCategoryPath, `${label}.materialCategoryPath`),
    ...(row.addAmortizationAccrualRule === undefined ? {} : { addAmortizationAccrualRule: materialNullableNumberOf(row.addAmortizationAccrualRule, `${label}.addAmortizationAccrualRule`, { integer: true }) }),
    ...(row.reductionAmortizationAccrualRule === undefined ? {} : { reductionAmortizationAccrualRule: materialNullableNumberOf(row.reductionAmortizationAccrualRule, `${label}.reductionAmortizationAccrualRule`, { integer: true }) }),
    isCurrMonthDep: flagOf(row.isCurrMonthDep, `${label}.isCurrMonthDep`),
    isDepreciationReduction: flagOf(row.isDepreciationReduction, `${label}.isDepreciationReduction`),
    ...(row.createTime === undefined ? {} : { createTime: materialTextOf(row.createTime, `${label}.createTime`) }),
  }
}

function methodInputOf (value: unknown, label: string): number | string {
  const method = methodOf(value, label)
  if (method === null) throw new Error(`${label}必填`)
  return method
}

function draftOf (value: unknown, label = '资产折旧配置表单'): InventoryAssetDepreciationConfigDraft {
  const input = materialObjectOf(value, label)
  const materialCategory = input.materialCategory === undefined || input.materialCategory === null || input.materialCategory === '' ? null : materialIdOf(input.materialCategory, `${label}.materialCategory`)
  const isCurrMonthDep = input.isCurrMonthDep === undefined || input.isCurrMonthDep === null || input.isCurrMonthDep === '' ? 0 : flagOf(input.isCurrMonthDep, `${label}.isCurrMonthDep`)
  const isDepreciationReduction = input.isDepreciationReduction === undefined || input.isDepreciationReduction === null || input.isDepreciationReduction === '' ? 0 : flagOf(input.isDepreciationReduction, `${label}.isDepreciationReduction`)
  const draft: InventoryAssetDepreciationConfigDraft = {
    assetCategory: materialNumberOf(input.assetCategory, `${label}.assetCategory`, { integer: true, min: 1 }),
    depreciationMethod: methodInputOf(input.depreciationMethod, `${label}.depreciationMethod`),
    depreciationYear: materialNumberOf(input.depreciationYear, `${label}.depreciationYear`, { integer: true, min: 0 }),
    depreciationDate: materialNumberOf(input.depreciationDate, `${label}.depreciationDate`, { integer: true, min: 1, max: 25 }),
    netSalvageValueRate: materialNumberOf(input.netSalvageValueRate, `${label}.netSalvageValueRate`, { min: 0, max: 100 }),
    materialCategory,
    isCurrMonthDep: isCurrMonthDep!,
    isDepreciationReduction: isDepreciationReduction!,
  }
  if (input.id !== undefined && input.id !== null && input.id !== '') draft.id = materialIdOf(input.id, `${label}.id`)
  return draft
}

function categoryOf (value: unknown, index: number): InventoryAssetCategoryOption {
  const row = materialObjectOf(value, `资产类别候选[${index}]`)
  const id = materialIdOf(row.id, `资产类别候选[${index}].id`)
  const categoryName = typeof row.categoryName === 'string' ? row.categoryName : ''
  return { ...row, id, categoryName, label: categoryName, value: id }
}

function categoryPageOf (value: unknown, label = '资产类别候选分页'): { list: InventoryAssetCategoryOption[]; total: number } {
  const page = materialObjectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map(categoryOf), total: page.total }
}

function treeListOf (value: unknown, label: string): MaterialJsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => materialTreeOf(item, `${label}[${index}]`))
}

export function createInventoryAssetDepreciationConfigCapability (request: PortalRequest) {
  return {
    async list (query: InventoryAssetDepreciationConfigQuery = {}): Promise<PageResult<InventoryAssetDepreciationConfigRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('资产折旧配置分页响应缺少有效list或total')
      return { list: result.list.map(item => rowOf(item, '资产折旧配置列表行')), total: result.total }
    },
    async get (input: { id: MaterialPageId }): Promise<InventoryAssetDepreciationConfigRow> {
      const row = rowOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id: materialIdOf(input?.id, '资产折旧配置id') } }), '资产折旧配置详情')
      return { ...row, depreciationMethod: row.depreciationMethod === null ? null : String(row.depreciationMethod) }
    },
    async assetCategories (): Promise<InventoryAssetCategoryOption[]> {
      const first = categoryPageOf(await request<unknown>({ url: ASSET_CATEGORY_URL, method: 'get', params: { pageNo: 1, pageSize: ASSET_CATEGORY_PAGE_SIZE } }))
      const list = [...first.list]
      const totalPages = Math.min(Math.ceil(first.total / ASSET_CATEGORY_PAGE_SIZE), ASSET_CATEGORY_MAX_PAGES)
      for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
        const page = categoryPageOf(await request<unknown>({ url: ASSET_CATEGORY_URL, method: 'get', params: { pageNo, pageSize: ASSET_CATEGORY_PAGE_SIZE } }), `资产类别候选第${pageNo}页响应`)
        list.push(...page.list)
      }
      return list
    },
    async materialCategoryTree (level?: number): Promise<MaterialJsonObject[]> {
      if (level !== undefined) materialNumberOf(level, 'level', { integer: true, min: 1 })
      return treeListOf(await request<unknown>({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get', ...(level === undefined ? {} : { params: { level } }) }), '资产折旧物料分类树')
    },
    prepareCreate (input: InventoryAssetDepreciationConfigDraft): { draft: InventoryAssetDepreciationConfigDraft } {
      const draft = draftOf(input)
      if (draft.id !== undefined) throw new Error('创建资产折旧配置不能传id')
      return { draft }
    },
    async create (input: InventoryAssetDepreciationConfigDraft): Promise<void> {
      const prepared = this.prepareCreate(input)
      await request({ url: `${ROOT}/create`, method: 'post', data: prepared.draft })
    },
    prepareUpdate (input: InventoryAssetDepreciationConfigDraft): { draft: InventoryAssetDepreciationConfigDraft } {
      const draft = draftOf(input, '资产折旧配置修改表单')
      if (draft.id === undefined) throw new Error('修改资产折旧配置必须传id')
      return { draft }
    },
    async update (input: InventoryAssetDepreciationConfigDraft): Promise<void> {
      const prepared = this.prepareUpdate(input)
      await request({ url: `${ROOT}/update`, method: 'put', data: prepared.draft })
    },
    prepareRemove (input: { id: MaterialPageId }): { id: MaterialPageId } {
      return { id: materialIdOf(input?.id, '资产折旧配置id') }
    },
    async remove (input: { id: MaterialPageId }): Promise<void> {
      const prepared = this.prepareRemove(input)
      await request({ url: `${ROOT}/delete`, method: 'delete', params: prepared })
    },
  }
}

export type InventoryAssetDepreciationConfigCapability = ReturnType<typeof createInventoryAssetDepreciationConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('depreciationLifeMonth', 'number', false, '列表筛选折旧年限(月)'), p('materialCategory', 'tree', false, '物料分类ID'), p('pageNo', 'number'), p('pageSize', 'number')]
const draftParams: ParamSpec[] = [p('assetCategory', 'number', true, '资产类别ID'), p('depreciationMethod', 'enum', true), p('depreciationYear', 'number', true, '折旧年限，非负整数，单位年'), p('depreciationDate', 'number', true, '折旧日，1至25'), p('netSalvageValueRate', 'number', true, '净残值率，0至100，单位百分比'), p('materialCategory', 'tree', false, '物料分类ID；空值按null提交'), p('isCurrMonthDep', 'enum', false, '0下月、1当月；默认0'), p('isDepreciationReduction', 'enum', false, '0当月不折旧、1当月折旧；默认0')]

export const INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS = {
  'inventory-asset-depreciation-config-list': 'list',
  'inventory-asset-depreciation-config-get': 'get',
  'inventory-asset-depreciation-config-asset-categories': 'assetCategories',
  'inventory-asset-depreciation-config-material-category-tree': 'materialCategoryTree',
  'inventory-asset-depreciation-config-prepare-create': 'prepareCreate',
  'inventory-asset-depreciation-config-create': 'create',
  'inventory-asset-depreciation-config-prepare-update': 'prepareUpdate',
  'inventory-asset-depreciation-config-update': 'update',
  'inventory-asset-depreciation-config-prepare-remove': 'prepareRemove',
  'inventory-asset-depreciation-config-remove': 'remove',
} as const

export const inventoryAssetDepreciationConfigCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-asset-depreciation-config-list', title: '查询资产折旧配置', write: false, params: queryParams },
  { id: 'inventory-asset-depreciation-config-get', title: '读取资产折旧配置表单', write: false, params: [p('id', 'text', true)] },
  { id: 'inventory-asset-depreciation-config-asset-categories', title: '查询资产类别候选', write: false, params: [] },
  { id: 'inventory-asset-depreciation-config-material-category-tree', title: '查询资产折旧物料分类树', write: false, params: [p('level', 'number')] },
  { id: 'inventory-asset-depreciation-config-prepare-create', title: '准备创建资产折旧配置', write: false, params: draftParams },
  { id: 'inventory-asset-depreciation-config-create', title: '创建资产折旧配置', write: true, params: draftParams },
  { id: 'inventory-asset-depreciation-config-prepare-update', title: '准备修改资产折旧配置', write: false, params: [p('id', 'text', true), ...draftParams] },
  { id: 'inventory-asset-depreciation-config-update', title: '修改资产折旧配置', write: true, params: [p('id', 'text', true), ...draftParams] },
  { id: 'inventory-asset-depreciation-config-prepare-remove', title: '准备删除资产折旧配置', write: false, params: [p('id', 'text', true)] },
  { id: 'inventory-asset-depreciation-config-remove', title: '删除资产折旧配置', write: true, params: [p('id', 'text', true)] },
].map(definition => ({ ...definition, pagePath: INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH, permission: '/dashboard/material/assets/setting', moduleType: 31, httpInstance: 'platform' }))
