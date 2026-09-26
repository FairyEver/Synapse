import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialNullableNumberOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialTextOf,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「物料 → 资产 → 盘点配置」；页面路径命中资产管理 module-type 31。 */
export const INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH = '/dashboard/material/assets/stocktaking-config/list'
export const INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION = '/dashboard/material/assets/stocktaking-config'
export const INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE = 31

const ROOT = '/admin-api/inventory/asset-stocktaking-config'
const USER_URL = '/admin-api/system/user/simple-page'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const USER_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export type InventoryAssetStocktakingConfigId = MaterialPageId
export type InventoryAssetStocktakingType = 2 | 3

export type InventoryAssetStocktakingConfigQuery = {
  type?: InventoryAssetStocktakingType | number | string | null
  stocktakerUserId?: InventoryAssetStocktakingConfigId | null
  orgId?: InventoryAssetStocktakingConfigId | null
  /** Portal日期范围选择器的两个YYYY-MM-DD值。 */
  createTime?: [string, string] | string[] | null
  pageNo?: number
  pageSize?: number
}

export type InventoryAssetStocktakingConfigRow = Record<string, unknown> & {
  id: InventoryAssetStocktakingConfigId
  type: InventoryAssetStocktakingType
  typeName: string | null
  orgId: InventoryAssetStocktakingConfigId
  orgName: string | null
  stocktakerUserId: InventoryAssetStocktakingConfigId
  stocktakerUserName: string | null
  triggerMonth: number | null
  triggerDay: number | null
  creator: InventoryAssetStocktakingConfigId | null
  creatorName: string | null
  createTime: string | null
  updater: InventoryAssetStocktakingConfigId | null
  updaterName: string | null
  updateTime: string | null
}

export type InventoryAssetStocktakingConfigUserOption = Record<string, unknown> & {
  id: InventoryAssetStocktakingConfigId
  label: string
  code: string | null
  realName: string | null
  nickname: string | null
  name: string | null
}

export type InventoryAssetStocktakingConfigCreateDraft = {
  type: InventoryAssetStocktakingType
  orgId: InventoryAssetStocktakingConfigId
  stocktakerUserId: InventoryAssetStocktakingConfigId
  triggerMonth: number | null
  triggerDay: number | null
}

export type InventoryAssetStocktakingConfigUpdateDraft = InventoryAssetStocktakingConfigCreateDraft & {
  id: InventoryAssetStocktakingConfigId
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  return materialObjectOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize', allowed = PAGE_SIZE_OPTIONS): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !allowed.includes(resolved)) throw new Error(`${label}必须是页面支持的${allowed.join('、')}`)
  return resolved
}

function idOrNull (value: unknown, label: string): MaterialPageId | null {
  if (value === undefined || value === null || value === '') return null
  return materialIdOf(value, label)
}

function typeOf (value: unknown, label: string): InventoryAssetStocktakingType {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (normalized !== 2 && normalized !== 3) throw new Error(`${label}只能是2（抽盘）或3（清盘）`)
  return normalized
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error(`${label}不是有效日期`)
  return value
}

function createTimeOf (value: unknown): [string, string] | undefined {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return undefined
  if (!Array.isArray(value) || value.length !== 2) throw new Error('createTime必须是起止日期数组')
  const start = dateOf(value[0], 'createTime[0]')
  const end = dateOf(value[1], 'createTime[1]')
  return [`${start} 00:00:00`, `${end} 23:59:59`]
}

function queryOf (query: InventoryAssetStocktakingConfigQuery = {}): Record<string, unknown> {
  const createTime = createTimeOf(query.createTime)
  const params: Record<string, unknown> = {
    order: '',
    orderField: '',
    type: query.type === undefined || query.type === null || query.type === '' ? null : typeOf(query.type, 'type'),
    stocktakerUserId: idOrNull(query.stocktakerUserId, 'stocktakerUserId'),
    orgId: idOrNull(query.orgId, 'orgId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  if (createTime !== undefined) params.createTime = createTime
  return params
}

function nullableNumberOf (value: unknown, label: string, options: { min?: number; max?: number } = {}): number | null {
  return materialNullableNumberOf(value, label, { integer: true, ...options })
}

function rowOf (value: unknown, label = '资产盘点配置列表行'): InventoryAssetStocktakingConfigRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    type: typeOf(row.type, `${label}.type`),
    typeName: materialTextOf(row.typeName, `${label}.typeName`),
    orgId: materialIdOf(row.orgId, `${label}.orgId`),
    orgName: materialTextOf(row.orgName, `${label}.orgName`),
    stocktakerUserId: materialIdOf(row.stocktakerUserId, `${label}.stocktakerUserId`),
    stocktakerUserName: materialTextOf(row.stocktakerUserName, `${label}.stocktakerUserName`),
    triggerMonth: nullableNumberOf(row.triggerMonth, `${label}.triggerMonth`, { min: 1, max: 12 }),
    triggerDay: nullableNumberOf(row.triggerDay, `${label}.triggerDay`, { min: 1, max: 31 }),
    creator: materialOptionalIdOf(row.creator, `${label}.creator`),
    creatorName: materialTextOf(row.creatorName, `${label}.creatorName`),
    createTime: materialTextOf(row.createTime, `${label}.createTime`),
    updater: materialOptionalIdOf(row.updater, `${label}.updater`),
    updaterName: materialTextOf(row.updaterName, `${label}.updaterName`),
    updateTime: materialTextOf(row.updateTime, `${label}.updateTime`),
  }
}

function pageOf (value: unknown): PageResult<InventoryAssetStocktakingConfigRow> {
  const page = objectOf(value, '资产盘点配置分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('资产盘点配置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `资产盘点配置分页响应.list[${index}]`)), total: page.total }
}

function userOptionOf (value: unknown, index: number): InventoryAssetStocktakingConfigUserOption {
  const row = objectOf(value, `盘点人候选[${index}]`)
  const realName = materialTextOf(row.realName, `盘点人候选[${index}].realName`)
  const nickname = materialTextOf(row.nickname, `盘点人候选[${index}].nickname`)
  const name = materialTextOf(row.name, `盘点人候选[${index}].name`)
  const code = materialTextOf(row.code, `盘点人候选[${index}].code`)
  const displayName = realName || nickname || name || ''
  return {
    ...row,
    id: materialIdOf(row.id, `盘点人候选[${index}].id`),
    label: `${displayName}${code ? `(${code})` : ''}`,
    code,
    realName,
    nickname,
    name,
  }
}

function userPageOf (value: unknown): PageResult<InventoryAssetStocktakingConfigUserOption> {
  const page = objectOf(value, '盘点人候选分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('盘点人候选分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => userOptionOf(item, index)), total: page.total }
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('keyword不能为空；盘点人是长选项，必须先提供关键字')
  return value
}

function draftOf (value: unknown, label: string, requireId: boolean): InventoryAssetStocktakingConfigCreateDraft | InventoryAssetStocktakingConfigUpdateDraft {
  const row = objectOf(value, label)
  const type = typeOf(row.type, `${label}.type`)
  const triggerMonth = type === 3 ? nullableNumberOf(row.triggerMonth, `${label}.triggerMonth`, { min: 1, max: 12 }) : null
  const triggerDay = type === 3 ? nullableNumberOf(row.triggerDay, `${label}.triggerDay`, { min: 1, max: 31 }) : null
  if (type === 3 && (triggerMonth === null || triggerDay === null)) throw new Error('清盘配置必须填写触发月日')
  const draft: InventoryAssetStocktakingConfigCreateDraft = {
    type,
    orgId: materialIdOf(row.orgId, `${label}.orgId`),
    stocktakerUserId: materialIdOf(row.stocktakerUserId, `${label}.stocktakerUserId`),
    triggerMonth,
    triggerDay,
  }
  if (requireId) return { id: materialIdOf(row.id, `${label}.id`), ...draft }
  if (row.id !== undefined && row.id !== null && row.id !== '') throw new Error('创建资产盘点配置不能传id')
  return draft
}

export function createInventoryAssetStocktakingConfigCapability (request: PortalRequest) {
  return {
    async list (query: InventoryAssetStocktakingConfigQuery = {}): Promise<PageResult<InventoryAssetStocktakingConfigRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryOf(query),
        paramsArrayFormat: 'repeat',
      }))
    },
    /**
     * Portal 会在页面挂载时无关键字拉取全部人员；无头调用不照抄这个长选项行为，
     * 必须用关键字，组织筛选可作为额外的 companyUnitId 约束。
     */
    async searchStocktakerUsers (input: { keyword: string; orgId?: InventoryAssetStocktakingConfigId; pageNo?: number; pageSize?: number }): Promise<PageResult<InventoryAssetStocktakingConfigUserOption>> {
      const params: Record<string, unknown> = {
        pageNo: pageNumberOf(input?.pageNo, 1, 'pageNo', USER_PAGE_SIZE_OPTIONS),
        pageSize: pageNumberOf(input?.pageSize, 20, 'pageSize', USER_PAGE_SIZE_OPTIONS),
        nickname: keywordOf(input?.keyword),
      }
      if (input?.orgId !== undefined) params.companyUnitId = materialIdOf(input.orgId, 'orgId')
      return userPageOf(await request({ url: USER_URL, method: 'get', params }))
    },
    prepareCreate (input: InventoryAssetStocktakingConfigCreateDraft): { draft: InventoryAssetStocktakingConfigCreateDraft } {
      return { draft: draftOf(input, '资产盘点配置创建表单', false) as InventoryAssetStocktakingConfigCreateDraft }
    },
    async create (input: { draft: InventoryAssetStocktakingConfigCreateDraft }): Promise<InventoryAssetStocktakingConfigId> {
      const draft = draftOf(input?.draft, '资产盘点配置创建草稿', false)
      return materialIdOf(await request({ url: `${ROOT}/create`, method: 'post', data: draft }), '新建资产盘点配置返回的id')
    },
    prepareUpdate (input: InventoryAssetStocktakingConfigUpdateDraft): { draft: InventoryAssetStocktakingConfigUpdateDraft } {
      return { draft: draftOf(input, '资产盘点配置修改表单', true) as InventoryAssetStocktakingConfigUpdateDraft }
    },
    async update (input: { draft: InventoryAssetStocktakingConfigUpdateDraft }): Promise<true> {
      const draft = draftOf(input?.draft, '资产盘点配置修改草稿', true)
      const result = await request({ url: `${ROOT}/update`, method: 'put', data: draft })
      if (result !== true) throw new Error('更新资产盘点配置响应不是true')
      return true
    },
    prepareRemove (input: { id: InventoryAssetStocktakingConfigId }): { id: InventoryAssetStocktakingConfigId } {
      return { id: materialIdOf(input?.id, '资产盘点配置id') }
    },
    async remove (input: { id: InventoryAssetStocktakingConfigId }): Promise<true> {
      const id = materialIdOf(input?.id, '资产盘点配置id')
      const result = await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } })
      if (result !== true) throw new Error('删除资产盘点配置响应不是true')
      return true
    },
  }
}

export type InventoryAssetStocktakingConfigCapability = ReturnType<typeof createInventoryAssetStocktakingConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const draftParams = [
  p('type', 'enum', true, '2抽盘、3清盘；后端不允许修改已有记录的类型'),
  p('orgId', 'text', true, '适用法人组织ID'),
  p('stocktakerUserId', 'text', true, '盘点人用户ID'),
  p('triggerMonth', 'number', false, '清盘触发月1至12；抽盘按Portal强制提交null'),
  p('triggerDay', 'number', false, '清盘触发日1至31；抽盘按Portal强制提交null'),
]

export const INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS = {
  'inventory-asset-stocktaking-config-list': 'list',
  'inventory-asset-stocktaking-config-search-users': 'searchStocktakerUsers',
  'inventory-asset-stocktaking-config-prepare-create': 'prepareCreate',
  'inventory-asset-stocktaking-config-create': 'create',
  'inventory-asset-stocktaking-config-prepare-update': 'prepareUpdate',
  'inventory-asset-stocktaking-config-update': 'update',
  'inventory-asset-stocktaking-config-prepare-remove': 'prepareRemove',
  'inventory-asset-stocktaking-config-remove': 'remove',
} as const

export const inventoryAssetStocktakingConfigCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-asset-stocktaking-config-list', title: '查询资产盘点配置', write: false, params: [p('type', 'enum', false, '2抽盘、3清盘；默认null'), p('stocktakerUserId', 'text', false, '盘点人ID；默认null'), p('orgId', 'text', false, '法人组织ID；默认null'), p('createTime', 'date', false, '日期范围YYYY-MM-DD；提交时转换为当天00:00:00至23:59:59'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'inventory-asset-stocktaking-config-search-users', title: '搜索资产盘点人', write: false, params: [p('keyword', 'text', true, '人员关键字；长选项必须先给关键字'), p('orgId', 'text', false, '法人组织ID；映射为companyUnitId'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'inventory-asset-stocktaking-config-prepare-create', title: '准备创建资产盘点配置', write: false, params: draftParams },
  { id: 'inventory-asset-stocktaking-config-create', title: '创建资产盘点配置', write: true, params: draftParams },
  { id: 'inventory-asset-stocktaking-config-prepare-update', title: '准备修改资产盘点配置', write: false, params: [p('id', 'text', true, '配置ID'), ...draftParams] },
  { id: 'inventory-asset-stocktaking-config-update', title: '修改资产盘点配置', write: true, params: [p('id', 'text', true, '配置ID'), ...draftParams] },
  { id: 'inventory-asset-stocktaking-config-prepare-remove', title: '准备删除资产盘点配置', write: false, params: [p('id', 'text', true, '配置ID')] },
  { id: 'inventory-asset-stocktaking-config-remove', title: '删除资产盘点配置', write: true, params: [p('id', 'text', true, '配置ID')] },
].map(definition => ({ ...definition, pagePath: INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH, permission: INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION, moduleType: INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE, httpInstance: 'platform' }))
