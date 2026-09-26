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

/** Portal「物料 → 库存管理 → 批次配置」；页面路径命中库存管理 module-type 34。 */
export const INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH = '/dashboard/material/store/batch-setting/list'
export const INVENTORY_ASSET_BATCH_CONFIG_PERMISSION = '/dashboard/material/store/batch-setting'
export const INVENTORY_ASSET_BATCH_CONFIG_MODULE_TYPE = 34

const ROOT = '/admin-api/inventory/asset-batch-config'
const MATERIAL_URL = '/admin-api/supply/materiel/page'
const MATERIAL_CATEGORY_TREE_URL = '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree'
const UNIT_TREE_URL = '/admin-api/supply/organization/tree?isFactory=1&includeParents=1'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const CANDIDATE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500]

export type InventoryAssetBatchConfigId = MaterialPageId
export type InventoryAssetBatchConfigType = 1 | 2

export type InventoryAssetBatchConfigQuery = {
  materielName?: string | null
  categoryId?: InventoryAssetBatchConfigId | null
  pageNo?: number
  pageSize?: number
}

export type InventoryAssetBatchConfigRow = Record<string, unknown> & {
  id: InventoryAssetBatchConfigId
  configType: InventoryAssetBatchConfigType
  categoryId: InventoryAssetBatchConfigId | null
  categoryName: string | null
  categoryPathName: string | null
  materielId: InventoryAssetBatchConfigId | null
  materielName: string | null
  materielCategoryId: InventoryAssetBatchConfigId | null
  materielCode: string | null
  standardUnitId: InventoryAssetBatchConfigId | null
  standardUnitName: string | null
  unit: string | null
  materielStatus: number | null
  batchEnabled: boolean
  shelfLifeDays: number | null
  creator: InventoryAssetBatchConfigId | null
  creatorName: string | null
  createTime: string | null
  updater: InventoryAssetBatchConfigId | null
  updaterName: string | null
  updateTime: string | null
}

export type InventoryAssetBatchMaterialOption = Record<string, unknown> & {
  id: InventoryAssetBatchConfigId
  matCode: string | null
  matName: string | null
  unit: string | null
  categoryId: InventoryAssetBatchConfigId | null
  catNameCombination: string | null
  label: string
}

export type InventoryAssetBatchCategoryNode = Record<string, unknown> & {
  id: InventoryAssetBatchConfigId
  catName: string | null
  name: string
  level: number
  children: InventoryAssetBatchCategoryNode[]
}

export type InventoryAssetBatchUnitNode = Record<string, unknown> & {
  id: InventoryAssetBatchConfigId
  name: string
  isFactory: number | null
  disabled: boolean
  children: InventoryAssetBatchUnitNode[]
}

export type InventoryAssetBatchMaterialCreateRow = {
  materielId: InventoryAssetBatchConfigId
  materielCode?: string
  standardUnitId: InventoryAssetBatchConfigId
  standardUnitName?: string
  unit?: string
  shelfLifeDays: number
}

export type InventoryAssetBatchCategoryCreateRow = {
  categoryId: InventoryAssetBatchConfigId
  categoryName?: string
  standardUnitId: InventoryAssetBatchConfigId
  standardUnitName?: string
  shelfLifeDays: number
}

export type InventoryAssetBatchIdDraft = {
  id: InventoryAssetBatchConfigId
}

export type InventoryAssetBatchIdPreparation = {
  draft: InventoryAssetBatchIdDraft
}

export type InventoryAssetBatchToggleInput = {
  id: InventoryAssetBatchConfigId
  currentBatchEnabled: boolean
}

export type InventoryAssetBatchRemoveInput = {
  id: InventoryAssetBatchConfigId
  batchEnabled: boolean
}

function queryOf (query: InventoryAssetBatchConfigQuery = {}): Record<string, unknown> {
  if (query.materielName !== undefined && query.materielName !== null && typeof query.materielName !== 'string') {
    throw new Error('materielName必须为字符串或null')
  }
  return {
    order: '',
    orderField: '',
    materielName: query.materielName === undefined ? null : query.materielName,
    categoryId: query.categoryId === undefined || query.categoryId === null || query.categoryId === ''
      ? null
      : materialIdOf(query.categoryId, 'categoryId'),
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function booleanOf (value: unknown, label: string): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  throw new Error(`${label}必须为布尔值或0/1`)
}

function configTypeOf (value: unknown, label: string): InventoryAssetBatchConfigType {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (normalized !== 1 && normalized !== 2) throw new Error(`${label}只能是1（物料）或2（分类）`)
  return normalized
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  return materialNumberOf(value, label, { integer: true, min: 0 })
}

function pageOf (value: unknown, label: string): PageResult<unknown> {
  const page = materialObjectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) {
    throw new Error(`${label}缺少有效list或total`)
  }
  return { list: page.list, total: page.total }
}

function rowOf (value: unknown, index: number): InventoryAssetBatchConfigRow {
  const row = materialObjectOf(value, `批次配置列表行[${index}]`)
  return {
    ...row,
    id: materialIdOf(row.id, `批次配置列表行[${index}].id`),
    configType: configTypeOf(row.configType, `批次配置列表行[${index}].configType`),
    categoryId: materialOptionalIdOf(row.categoryId, `批次配置列表行[${index}].categoryId`),
    categoryName: materialTextOf(row.categoryName, `批次配置列表行[${index}].categoryName`),
    categoryPathName: materialTextOf(row.categoryPathName, `批次配置列表行[${index}].categoryPathName`),
    materielId: materialOptionalIdOf(row.materielId, `批次配置列表行[${index}].materielId`),
    materielName: materialTextOf(row.materielName, `批次配置列表行[${index}].materielName`),
    materielCategoryId: materialOptionalIdOf(row.materielCategoryId, `批次配置列表行[${index}].materielCategoryId`),
    materielCode: materialTextOf(row.materielCode, `批次配置列表行[${index}].materielCode`),
    standardUnitId: materialOptionalIdOf(row.standardUnitId, `批次配置列表行[${index}].standardUnitId`),
    standardUnitName: materialTextOf(row.standardUnitName, `批次配置列表行[${index}].standardUnitName`),
    unit: materialTextOf(row.unit, `批次配置列表行[${index}].unit`),
    materielStatus: nullableNumberOf(row.materielStatus, `批次配置列表行[${index}].materielStatus`),
    batchEnabled: booleanOf(row.batchEnabled, `批次配置列表行[${index}].batchEnabled`),
    shelfLifeDays: nullableNumberOf(row.shelfLifeDays, `批次配置列表行[${index}].shelfLifeDays`),
    creator: materialOptionalIdOf(row.creator, `批次配置列表行[${index}].creator`),
    creatorName: materialTextOf(row.creatorName, `批次配置列表行[${index}].creatorName`),
    createTime: materialTextOf(row.createTime, `批次配置列表行[${index}].createTime`),
    updater: materialOptionalIdOf(row.updater, `批次配置列表行[${index}].updater`),
    updaterName: materialTextOf(row.updaterName, `批次配置列表行[${index}].updaterName`),
    updateTime: materialTextOf(row.updateTime, `批次配置列表行[${index}].updateTime`),
  }
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('keyword不能为空；物料候选是长选项，必须先提供关键字')
  return value.trim()
}

function candidatePageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !CANDIDATE_PAGE_SIZE_OPTIONS.includes(resolved)) {
    throw new Error(`${label}必须是页面支持的${CANDIDATE_PAGE_SIZE_OPTIONS.join('、')}`)
  }
  return resolved
}

function materialOptionOf (value: unknown, index: number): InventoryAssetBatchMaterialOption {
  const row = materialObjectOf(value, `物料候选[${index}]`)
  const matCode = materialTextOf(row.matCode, `物料候选[${index}].matCode`)
  const matName = materialTextOf(row.matName, `物料候选[${index}].matName`)
  return {
    ...row,
    id: materialIdOf(row.id, `物料候选[${index}].id`),
    matCode,
    matName,
    unit: materialTextOf(row.unit, `物料候选[${index}].unit`),
    categoryId: materialOptionalIdOf(row.categoryId, `物料候选[${index}].categoryId`),
    catNameCombination: materialTextOf(row.catNameCombination, `物料候选[${index}].catNameCombination`),
    label: matName || matCode || '',
  }
}

function materialPageOf (value: unknown): PageResult<InventoryAssetBatchMaterialOption> {
  const page = pageOf(value, '物料候选分页响应')
  return { list: page.list.map((item, index) => materialOptionOf(item, index)), total: page.total }
}

function categoryNodeOf (value: unknown, label: string, level: number): InventoryAssetBatchCategoryNode {
  const row = materialObjectOf(value, label)
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const catName = materialTextOf(row.catName, `${label}.catName`)
  // Portal 的 mapTree 按树位置重算 level，不信任后端同名字段。
  const nodeLevel = level
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    catName,
    name: typeof row.name === 'string' ? row.name : catName ?? '',
    level: nodeLevel,
    children: children.map((item, index) => categoryNodeOf(item, `${label}.children[${index}]`, nodeLevel + 1)),
  }
}

function unitNodeOf (value: unknown, label: string): InventoryAssetBatchUnitNode {
  const row = materialObjectOf(value, label)
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const isFactory = row.isFactory === undefined || row.isFactory === null
    ? null
    : materialNumberOf(row.isFactory, `${label}.isFactory`, { integer: true })
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    name: typeof row.name === 'string' ? row.name : '',
    isFactory,
    // Portal 的 material/tree-select/unit.js 使用 item.isFactory !== 1。
    disabled: isFactory !== 1,
    children: children.map((item, index) => unitNodeOf(item, `${label}.children[${index}]`)),
  }
}

function treeListOf<T> (value: unknown, label: string, mapper: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map(mapper)
}

function textOrEmpty (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function shelfLifeOf (value: unknown, label: string): number {
  return materialNumberOf(value, label, { integer: true, min: 0 })
}

function materialCreateRowOf (value: unknown, index: number): InventoryAssetBatchMaterialCreateRow {
  const row = materialObjectOf(value, `物料批次配置新建行[${index}]`)
  return {
    materielId: materialIdOf(row.materielId, `物料批次配置新建行[${index}].materielId`),
    materielCode: textOrEmpty(row.materielCode, `物料批次配置新建行[${index}].materielCode`),
    standardUnitId: materialIdOf(row.standardUnitId, `物料批次配置新建行[${index}].standardUnitId`),
    standardUnitName: textOrEmpty(row.standardUnitName, `物料批次配置新建行[${index}].standardUnitName`),
    unit: textOrEmpty(row.unit, `物料批次配置新建行[${index}].unit`),
    shelfLifeDays: shelfLifeOf(row.shelfLifeDays, `物料批次配置新建行[${index}].shelfLifeDays`),
  }
}

function categoryCreateRowOf (value: unknown, index: number): InventoryAssetBatchCategoryCreateRow {
  const row = materialObjectOf(value, `分类批次配置新建行[${index}]`)
  return {
    categoryId: materialIdOf(row.categoryId, `分类批次配置新建行[${index}].categoryId`),
    categoryName: textOrEmpty(row.categoryName, `分类批次配置新建行[${index}].categoryName`),
    standardUnitId: materialIdOf(row.standardUnitId, `分类批次配置新建行[${index}].standardUnitId`),
    standardUnitName: textOrEmpty(row.standardUnitName, `分类批次配置新建行[${index}].standardUnitName`),
    shelfLifeDays: shelfLifeOf(row.shelfLifeDays, `分类批次配置新建行[${index}].shelfLifeDays`),
  }
}

function nonEmptyRowsOf<T> (value: unknown, label: string, mapper: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}至少包含一行`)
  const rows = value.map(mapper)
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const item = row as Record<string, unknown>
    const left = item.materielId ?? item.categoryId
    const key = `${String(left)}|${String(item.standardUnitId)}`
    if (seen.has(key)) throw new Error(`${label}[${index}]与前面存在相同对象、相同组织的重复配置`)
    seen.add(key)
  }
  return rows
}

function idDraftOf (value: unknown, label: string): InventoryAssetBatchIdDraft {
  const row = materialObjectOf(value, label)
  return { id: materialIdOf(row.id, `${label}.id`) }
}

function toggleDraftOf (value: unknown, target: boolean): InventoryAssetBatchIdDraft {
  const row = materialObjectOf(value, '批次管理开关')
  const current = booleanOf(row.currentBatchEnabled, 'currentBatchEnabled')
  if (current === target) throw new Error(`当前批次状态已经是${target ? '开启' : '关闭'}，不能重复提交`)
  return { id: materialIdOf(row.id, '批次配置id') }
}

function removeDraftOf (value: unknown): InventoryAssetBatchIdDraft {
  const row = materialObjectOf(value, '批次配置删除')
  if (booleanOf(row.batchEnabled, 'batchEnabled')) throw new Error('批次开启时Portal不显示删除按钮，必须先关闭批次')
  return { id: materialIdOf(row.id, '批次配置id') }
}

export function createInventoryAssetBatchConfigCapability (request: PortalRequest) {
  return {
    async list (query: InventoryAssetBatchConfigQuery = {}): Promise<PageResult<InventoryAssetBatchConfigRow>> {
      const page = pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }), '批次配置分页响应')
      return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total }
    },
    async searchMaterials (input: { keyword: string; pageNo?: number; pageSize?: number }): Promise<PageResult<InventoryAssetBatchMaterialOption>> {
      const params = {
        pageNo: candidatePageNumberOf(input?.pageNo, 1, 'pageNo'),
        pageSize: candidatePageNumberOf(input?.pageSize, 20, 'pageSize'),
        status: 1,
        matNameOrCoder: keywordOf(input?.keyword),
      }
      return materialPageOf(await request({ url: MATERIAL_URL, method: 'get', params }))
    },
    async materialCategoryTree (): Promise<InventoryAssetBatchCategoryNode[]> {
      return treeListOf(await request({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get', params: { level: 5 } }), '批次配置物料分类树', (item, index) => categoryNodeOf(item, `批次配置物料分类树[${index}]`, 1))
    },
    async unitTree (): Promise<InventoryAssetBatchUnitNode[]> {
      return treeListOf(await request({ url: UNIT_TREE_URL, method: 'get' }), '批次配置涉及组织树', (item, index) => unitNodeOf(item, `批次配置涉及组织树[${index}]`))
    },
    prepareCreateMateriel (input: { rows: InventoryAssetBatchMaterialCreateRow[] }): { draft: InventoryAssetBatchMaterialCreateRow[] } {
      return { draft: nonEmptyRowsOf(input?.rows, '物料批次配置新建行', materialCreateRowOf) }
    },
    async createMateriel (input: { draft: InventoryAssetBatchMaterialCreateRow[] }): Promise<true> {
      const draft = nonEmptyRowsOf(input?.draft, '物料批次配置新建草稿', materialCreateRowOf)
      return materialTrueResponse(await request({ url: `${ROOT}/batch-create-materiel`, method: 'post', data: draft }), '物料批次配置批量创建')
    },
    prepareCreateCategory (input: { rows: InventoryAssetBatchCategoryCreateRow[] }): { draft: InventoryAssetBatchCategoryCreateRow[] } {
      return { draft: nonEmptyRowsOf(input?.rows, '分类批次配置新建行', categoryCreateRowOf) }
    },
    async createCategory (input: { draft: InventoryAssetBatchCategoryCreateRow[] }): Promise<true> {
      const draft = nonEmptyRowsOf(input?.draft, '分类批次配置新建草稿', categoryCreateRowOf)
      return materialTrueResponse(await request({ url: `${ROOT}/batch-create-materiel-category`, method: 'post', data: draft }), '分类批次配置批量创建')
    },
    prepareEnableBatch (input: InventoryAssetBatchToggleInput): InventoryAssetBatchIdPreparation {
      return { draft: toggleDraftOf(input, true) }
    },
    async enableBatch (input: { draft: InventoryAssetBatchIdDraft }): Promise<true> {
      const draft = idDraftOf(input?.draft, '开启批次草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/enable-batch`, method: 'put', data: null, params: { id: draft.id } }), '开启批次')
    },
    prepareDisableBatch (input: InventoryAssetBatchToggleInput): InventoryAssetBatchIdPreparation {
      return { draft: toggleDraftOf(input, false) }
    },
    async disableBatch (input: { draft: InventoryAssetBatchIdDraft }): Promise<true> {
      const draft = idDraftOf(input?.draft, '关闭批次草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/disable-batch`, method: 'put', data: null, params: { id: draft.id } }), '关闭批次')
    },
    prepareRemove (input: InventoryAssetBatchRemoveInput): InventoryAssetBatchIdPreparation {
      return { draft: removeDraftOf(input) }
    },
    async remove (input: { draft: InventoryAssetBatchIdDraft }): Promise<true> {
      const draft = idDraftOf(input?.draft, '删除批次配置草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: draft.id } }), '删除批次配置')
    },
  }
}

export type InventoryAssetBatchConfigCapability = ReturnType<typeof createInventoryAssetBatchConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const materialRows = p('rows', 'text', true, '物料新建行数组：materielId、materielCode、standardUnitId、standardUnitName、unit、shelfLifeDays；重复的物料+组织组合会被拒绝')
const categoryRows = p('rows', 'text', true, '分类新建行数组：categoryId、categoryName、standardUnitId、standardUnitName、shelfLifeDays；重复的分类+组织组合会被拒绝')
const toggleParams = [p('id', 'text', true, '批次配置ID'), p('currentBatchEnabled', 'boolean', true, '列表当前batchEnabled；必须与目标动作相反')]

export const INVENTORY_ASSET_BATCH_CONFIG_METHODS = {
  'inventory-asset-batch-config-list': 'list',
  'inventory-asset-batch-config-search-materials': 'searchMaterials',
  'inventory-asset-batch-config-material-category-tree': 'materialCategoryTree',
  'inventory-asset-batch-config-unit-tree': 'unitTree',
  'inventory-asset-batch-config-prepare-create-materiel': 'prepareCreateMateriel',
  'inventory-asset-batch-config-create-materiel': 'createMateriel',
  'inventory-asset-batch-config-prepare-create-category': 'prepareCreateCategory',
  'inventory-asset-batch-config-create-category': 'createCategory',
  'inventory-asset-batch-config-prepare-enable-batch': 'prepareEnableBatch',
  'inventory-asset-batch-config-enable-batch': 'enableBatch',
  'inventory-asset-batch-config-prepare-disable-batch': 'prepareDisableBatch',
  'inventory-asset-batch-config-disable-batch': 'disableBatch',
  'inventory-asset-batch-config-prepare-remove': 'prepareRemove',
  'inventory-asset-batch-config-remove': 'remove',
} as const

export const inventoryAssetBatchConfigCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-asset-batch-config-list', title: '查询批次配置', write: false, params: [p('materielName', 'text', false, '物料名称前缀筛选；默认null'), p('categoryId', 'tree', false, '物料分类ID；后端会扩展到该分类及子分类；默认null'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'inventory-asset-batch-config-search-materials', title: '搜索批次配置物料候选', write: false, params: [p('keyword', 'text', true, '物料名称或编码关键字；长选项必须先提供关键字'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '候选页支持10、20、50、100、200、500；默认20')] },
  { id: 'inventory-asset-batch-config-material-category-tree', title: '查询批次配置物料分类树', write: false, params: [] },
  { id: 'inventory-asset-batch-config-unit-tree', title: '查询批次配置涉及组织树', write: false, params: [] },
  { id: 'inventory-asset-batch-config-prepare-create-materiel', title: '准备按物料创建批次配置', write: false, params: [materialRows] },
  { id: 'inventory-asset-batch-config-create-materiel', title: '按物料批量创建批次配置', write: true, params: [p('draft', 'text', true, 'prepareCreateMateriel返回的draft；提交给batch-create-materiel')] },
  { id: 'inventory-asset-batch-config-prepare-create-category', title: '准备按分类创建批次配置', write: false, params: [categoryRows] },
  { id: 'inventory-asset-batch-config-create-category', title: '按分类批量创建批次配置', write: true, params: [p('draft', 'text', true, 'prepareCreateCategory返回的draft；提交给batch-create-materiel-category')] },
  { id: 'inventory-asset-batch-config-prepare-enable-batch', title: '准备开启批次管理', write: false, params: toggleParams },
  { id: 'inventory-asset-batch-config-enable-batch', title: '开启批次管理', write: true, params: [p('draft', 'text', true, 'prepareEnableBatch返回的ID草稿')] },
  { id: 'inventory-asset-batch-config-prepare-disable-batch', title: '准备关闭批次管理', write: false, params: toggleParams },
  { id: 'inventory-asset-batch-config-disable-batch', title: '关闭批次管理', write: true, params: [p('draft', 'text', true, 'prepareDisableBatch返回的ID草稿')] },
  { id: 'inventory-asset-batch-config-prepare-remove', title: '准备删除批次配置', write: false, params: [p('id', 'text', true, '配置ID'), p('batchEnabled', 'boolean', true, '列表当前状态；只有false时Portal显示删除按钮')] },
  { id: 'inventory-asset-batch-config-remove', title: '删除批次配置', write: true, params: [p('draft', 'text', true, 'prepareRemove返回的ID草稿')] },
].map(definition => ({ ...definition, pagePath: INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH, permission: INVENTORY_ASSET_BATCH_CONFIG_PERMISSION, moduleType: INVENTORY_ASSET_BATCH_CONFIG_MODULE_TYPE, httpInstance: 'platform' }))
