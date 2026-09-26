import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialPageNumberOf,
  materialTextOf,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「系统设置 → 资产编码」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH = '/dashboard/material/assets/code-setting/list'
const ROOT = '/admin-api/inventory/organization-config'
const CORPORATION_URL = '/admin-api/system/dept/list-all-simple'

export type InventoryOrganizationConfigQuery = {
  orgId?: MaterialPageId | null
  pageNo?: number
  pageSize?: number
}

export type InventoryOrganizationConfigRow = {
  id?: MaterialPageId | null
  orgId: MaterialPageId | null
  orgCode: string | null
  orgName: string | null
  creator?: MaterialPageId | null
  creatorName: string | null
  createTime: string | null
  [key: string]: unknown
}

export type InventoryOrganizationConfigDraft = {
  orgCode: string
  orgId: MaterialPageId
}

export type InventoryCorporationOption = {
  id: MaterialPageId
  name: string
  [key: string]: unknown
}

function queryOf (query: InventoryOrganizationConfigQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    orgId: query.orgId === undefined ? null : query.orgId === null || query.orgId === '' ? null : materialIdOf(query.orgId, 'orgId'),
    pageNo: materialPageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: materialPageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): InventoryOrganizationConfigRow {
  const row = materialObjectOf(value, '资产编码列表行')
  return {
    ...row,
    id: materialOptionalIdOf(row.id, '资产编码id'),
    orgId: materialOptionalIdOf(row.orgId, 'orgId'),
    orgCode: materialTextOf(row.orgCode, 'orgCode'),
    orgName: materialTextOf(row.orgName, 'orgName'),
    ...(row.creator === undefined ? {} : { creator: materialOptionalIdOf(row.creator, 'creator') }),
    creatorName: materialTextOf(row.creatorName, 'creatorName'),
    createTime: materialTextOf(row.createTime, 'createTime'),
  }
}

function corporationOf (value: unknown, index: number): InventoryCorporationOption {
  const row = materialObjectOf(value, `法人单位候选[${index}]`)
  return { ...row, id: materialIdOf(row.id, `法人单位候选[${index}].id`), name: typeof row.name === 'string' ? row.name : '' }
}

function draftOf (value: unknown, index: number): InventoryOrganizationConfigDraft {
  const row = materialObjectOf(value, `资产编码创建行[${index}]`)
  if (typeof row.orgCode !== 'string' || !row.orgCode) throw new Error(`资产编码创建行[${index}].orgCode必填`)
  if (row.orgCode.length > 4) throw new Error(`资产编码创建行[${index}].orgCode最多4个字符`)
  return { orgCode: row.orgCode, orgId: materialIdOf(row.orgId, `资产编码创建行[${index}].orgId`) }
}

function draftsOf (value: unknown): InventoryOrganizationConfigDraft[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('资产编码创建行至少包含一行')
  return value.map((row, index) => draftOf(row, index))
}

export function createInventoryOrganizationConfigCapability (request: PortalRequest) {
  return {
    async list (query: InventoryOrganizationConfigQuery = {}): Promise<PageResult<InventoryOrganizationConfigRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('资产编码分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async corporations (): Promise<InventoryCorporationOption[]> {
      const result = await request<unknown>({ url: CORPORATION_URL, method: 'get', params: { pageNo: -1, pageSize: -1, isCorporation: 1 } })
      if (!Array.isArray(result)) throw new Error('资产编码法人单位候选响应必须是数组')
      return result.map(corporationOf)
    },
    prepareCreate (input: { rows: InventoryOrganizationConfigDraft[] }): { rows: InventoryOrganizationConfigDraft[] } {
      return { rows: draftsOf(input?.rows) }
    },
    async create (input: { rows: InventoryOrganizationConfigDraft[] }): Promise<void> {
      const prepared = this.prepareCreate(input)
      await request({ url: `${ROOT}/create`, method: 'post', data: prepared.rows })
    },
    prepareRemove (input: { id: MaterialPageId }): { id: MaterialPageId } {
      return { id: materialIdOf(input?.id, '资产编码id') }
    },
    async remove (input: { id: MaterialPageId }): Promise<void> {
      const prepared = this.prepareRemove(input)
      await request({ url: `${ROOT}/delete`, method: 'delete', params: prepared })
    },
  }
}

export type InventoryOrganizationConfigCapability = ReturnType<typeof createInventoryOrganizationConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('orgId', 'text', false, '法人单位ID；省略或null表示不筛选'), p('pageNo', 'number'), p('pageSize', 'number')]
const rowParams: ParamSpec[] = [p('rows', 'text', true, '创建行数组；每行包含orgCode与orgId')]

export const INVENTORY_ORGANIZATION_CONFIG_METHODS = {
  'inventory-organization-config-list': 'list',
  'inventory-organization-config-corporations': 'corporations',
  'inventory-organization-config-prepare-create': 'prepareCreate',
  'inventory-organization-config-create': 'create',
  'inventory-organization-config-prepare-remove': 'prepareRemove',
  'inventory-organization-config-remove': 'remove',
} as const

export const inventoryOrganizationConfigCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-organization-config-list', title: '查询资产编码规则', write: false, params: queryParams },
  { id: 'inventory-organization-config-corporations', title: '查询资产编码法人单位候选', write: false, params: [] },
  { id: 'inventory-organization-config-prepare-create', title: '准备创建资产编码规则', write: false, params: rowParams },
  { id: 'inventory-organization-config-create', title: '创建资产编码规则', write: true, params: rowParams },
  { id: 'inventory-organization-config-prepare-remove', title: '准备删除资产编码规则', write: false, params: [p('id', 'text', true)] },
  { id: 'inventory-organization-config-remove', title: '删除资产编码规则', write: true, params: [p('id', 'text', true)] },
].map(definition => ({ ...definition, pagePath: INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH, permission: '/dashboard/material/assets/code-setting', moduleType: 31, httpInstance: 'platform' }))
