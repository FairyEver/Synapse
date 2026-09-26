import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  materialIdOf,
  materialObjectOf,
  materialOptionalIdOf,
  materialTextOf,
  materialTrueResponse,
  type MaterialPageId,
} from './material-page-support.js'

/** Portal「物料 → 审批配置」；页面未命中 module-type 规则，因此不发送 module-type。 */
export const INVENTORY_APPROVAL_CONFIG_PAGE_PATH = '/dashboard/material/approval-configuration/list'
export const INVENTORY_APPROVAL_CONFIG_PERMISSION = '/dashboard/material/approval-configuration'
export const INVENTORY_APPROVAL_CONFIG_MODULE_TYPE = null
const ROOT = '/admin-api/inventory/approval-config'
const TYPE_ROOT = '/admin-api/inventory/stock'

export type InventoryApprovalConfigId = MaterialPageId

export type InventoryApprovalConfigQuery = {
  orgId?: InventoryApprovalConfigId | null
}

export type InventoryApprovalConfigLeaf = Record<string, unknown> & {
  id: InventoryApprovalConfigId
  name: string
  isRequiresApproval: boolean
  createTime?: string | null
  unitId?: InventoryApprovalConfigId | null
  unitName?: string | null
}

export type InventoryApprovalConfigTreeNode = Record<string, unknown> & {
  id?: InventoryApprovalConfigId
  name: string
  unitId?: InventoryApprovalConfigId | null
  unitName?: string | null
  children: InventoryApprovalConfigLeaf[]
}

export type InventoryApprovalConfigTypeOption = Record<string, unknown> & {
  label: string
  value: string
}

export type InventoryApprovalConfigCreateRow = {
  unitId: InventoryApprovalConfigId
  typeList: Array<{
    type: string
    subtype: string
    subtypeName?: string
  }>
  isRequiresApproval: boolean
}

export type InventoryApprovalConfigCreateInputRow = {
  unitId: InventoryApprovalConfigId
  typeIds: string[]
  isRequiresApproval: boolean | 0 | 1
}

export type InventoryApprovalConfigCreatePreparation = {
  draft: InventoryApprovalConfigCreateRow[]
}

export type InventoryApprovalConfigSetApprovalDraft = {
  id: InventoryApprovalConfigId
  isRequiresApproval: boolean
}

export type InventoryApprovalConfigSetApprovalPreparation = {
  draft: InventoryApprovalConfigSetApprovalDraft
  previous?: InventoryApprovalConfigSetApprovalDraft
}

function queryOf (query: InventoryApprovalConfigQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    orgId: query.orgId === undefined || query.orgId === null || query.orgId === ''
      ? null
      : materialIdOf(query.orgId, '审批配置组织ID'),
  }
}

function booleanOf (value: unknown, label: string): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  throw new Error(`${label}必须为布尔值或0/1`)
}

function typeOptionOf (value: unknown, index: number): InventoryApprovalConfigTypeOption {
  const row = materialObjectOf(value, `审批配置类型候选[${index}]`)
  if (typeof row.value !== 'string' || !row.value) throw new Error(`审批配置类型候选[${index}].value必须为非空字符串`)
  if (typeof row.label !== 'string') throw new Error(`审批配置类型候选[${index}].label必须为字符串`)
  return { ...row, label: row.label, value: row.value }
}

function typeListOf (value: unknown, label: string): InventoryApprovalConfigCreateRow['typeList'] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空数组`)
  return value.map((item, index) => {
    const row = materialObjectOf(item, `${label}[${index}]`)
    if (typeof row.type !== 'string' || !row.type) throw new Error(`${label}[${index}].type必须为非空字符串`)
    if (typeof row.subtype !== 'string' || !row.subtype) throw new Error(`${label}[${index}].subtype必须为非空字符串`)
    const subtypeName = row.subtypeName === undefined || row.subtypeName === null
      ? undefined
      : materialTextOf(row.subtypeName, `${label}[${index}].subtypeName`) ?? undefined
    return {
      type: row.type,
      subtype: row.subtype,
      ...(subtypeName === undefined ? {} : { subtypeName }),
    }
  })
}

function createRowOf (value: unknown, label: string): InventoryApprovalConfigCreateRow {
  const row = materialObjectOf(value, label)
  return {
    unitId: materialIdOf(row.unitId, `${label}.unitId`),
    typeList: typeListOf(row.typeList, `${label}.typeList`),
    isRequiresApproval: booleanOf(row.isRequiresApproval, `${label}.isRequiresApproval`),
  }
}

function createBatchOf (value: unknown, label = '审批配置批量草稿'): InventoryApprovalConfigCreateRow[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => createRowOf(item, `${label}[${index}]`))
}

function leafOf (value: unknown, label: string, unitId?: InventoryApprovalConfigId | null, unitName?: string | null): InventoryApprovalConfigLeaf {
  const row = materialObjectOf(value, label)
  const rowUnitId = row.unitId === undefined || row.unitId === null || row.unitId === ''
    ? unitId ?? null
    : materialOptionalIdOf(row.unitId, `${label}.unitId`)
  const rowUnitName = row.unitName === undefined || row.unitName === null
    ? unitName ?? null
    : materialTextOf(row.unitName, `${label}.unitName`)
  const createTime = row.createTime === undefined || row.createTime === null
    ? row.createTime ?? null
    : materialTextOf(row.createTime, `${label}.createTime`)
  return {
    ...row,
    id: materialIdOf(row.id, `${label}.id`),
    name: materialTextOf(row.name, `${label}.name`) ?? '',
    isRequiresApproval: booleanOf(row.isRequiresApproval, `${label}.isRequiresApproval`),
    ...(createTime === null ? { createTime: null } : { createTime }),
    unitId: rowUnitId,
    unitName: rowUnitName,
  }
}

function treeNodeOf (value: unknown, index: number): InventoryApprovalConfigTreeNode {
  const row = materialObjectOf(value, `审批配置树[${index}]`)
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error(`审批配置树[${index}].children必须是数组`)
  const unitId = materialOptionalIdOf(row.unitId, `审批配置树[${index}].unitId`)
  const unitName = row.unitName === undefined || row.unitName === null
    ? null
    : materialTextOf(row.unitName, `审批配置树[${index}].unitName`)
  const id = row.id === undefined || row.id === null || row.id === '' ? undefined : materialIdOf(row.id, `审批配置树[${index}].id`)
  return {
    ...row,
    ...(id === undefined ? {} : { id }),
    name: materialTextOf(row.name, `审批配置树[${index}].name`) ?? '',
    unitId,
    unitName,
    children: children.map((item, childIndex) => leafOf(item, `审批配置树[${index}].children[${childIndex}]`, unitId, unitName)),
  }
}

function setApprovalDraftOf (value: unknown, label: string): InventoryApprovalConfigSetApprovalDraft {
  const row = materialObjectOf(value, label)
  return {
    id: materialIdOf(row.id, `${label}.id`),
    isRequiresApproval: booleanOf(row.isRequiresApproval, `${label}.isRequiresApproval`),
  }
}

function normalizedCreateRowOf (value: InventoryApprovalConfigCreateInputRow, options: Map<string, InventoryApprovalConfigTypeOption>, index: number): InventoryApprovalConfigCreateRow {
  const row = materialObjectOf(value, `审批配置新建行[${index}]`)
  const unitId = materialIdOf(row.unitId, `审批配置新建行[${index}].unitId`)
  if (!Array.isArray(row.typeIds) || row.typeIds.length === 0) throw new Error(`审批配置新建行[${index}].typeIds必须是非空数组`)
  const typeList = row.typeIds.map((value, typeIndex) => {
    if (typeof value !== 'string' || !value) throw new Error(`审批配置新建行[${index}].typeIds[${typeIndex}]必须为非空字符串`)
    const [type, subtype] = value.split('-')
    if (!type || !subtype) throw new Error(`审批配置新建行[${index}].typeIds[${typeIndex}]必须为type-subtype格式`)
    const option = options.get(value)
    return {
      type,
      subtype,
      ...(option ? { subtypeName: option.label } : {}),
    }
  })
  return {
    unitId,
    typeList,
    isRequiresApproval: booleanOf(row.isRequiresApproval, `审批配置新建行[${index}].isRequiresApproval`),
  }
}

export function createInventoryApprovalConfigCapability (request: PortalRequest) {
  return {
    async list (query: InventoryApprovalConfigQuery = {}): Promise<InventoryApprovalConfigTreeNode[]> {
      const result = await request<unknown>({ url: `${ROOT}/list`, method: 'get', params: queryOf(query) })
      if (!Array.isArray(result)) throw new Error('审批配置列表响应必须是数组')
      return result.map(treeNodeOf)
    },
    async typeList (): Promise<InventoryApprovalConfigTypeOption[]> {
      const result = await request<unknown>({ url: `${TYPE_ROOT}/typeList`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('审批配置类型候选响应必须是数组')
      return result.map(typeOptionOf)
    },
    prepareCreate (input: { rows: InventoryApprovalConfigCreateInputRow[]; typeOptions: InventoryApprovalConfigTypeOption[] }): InventoryApprovalConfigCreatePreparation {
      if (!Array.isArray(input?.typeOptions)) throw new Error('审批配置类型候选必须是数组')
      const options = new Map(input.typeOptions.map((item, index) => {
        const option = typeOptionOf(item, index)
        return [option.value, option] as const
      }))
      return { draft: (input.rows ?? []).map((row, index) => normalizedCreateRowOf(row, options, index)) }
    },
    async create (input: { draft: InventoryApprovalConfigCreateRow[] }): Promise<true> {
      const draft = createBatchOf(input?.draft)
      return materialTrueResponse(await request({ url: `${ROOT}/batch-create`, method: 'post', data: draft }), '审批配置批量创建')
    },
    prepareSetApproval (input: { id: InventoryApprovalConfigId; isRequiresApproval: boolean }): InventoryApprovalConfigSetApprovalPreparation {
      const draft = setApprovalDraftOf(input, '审批配置审批开关')
      return { draft }
    },
    async setApproval (input: { draft: InventoryApprovalConfigSetApprovalDraft }): Promise<true> {
      const draft = setApprovalDraftOf(input?.draft, '审批配置审批开关草稿')
      return materialTrueResponse(await request({ url: `${ROOT}/update`, method: 'put', data: draft }), '审批配置审批开关更新')
    },
  }
}

export type InventoryApprovalConfigCapability = ReturnType<typeof createInventoryApprovalConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })

export const INVENTORY_APPROVAL_CONFIG_METHODS = {
  'inventory-approval-config-list': 'list',
  'inventory-approval-config-type-list': 'typeList',
  'inventory-approval-config-prepare-create': 'prepareCreate',
  'inventory-approval-config-create': 'create',
  'inventory-approval-config-prepare-set-approval': 'prepareSetApproval',
  'inventory-approval-config-set-approval': 'setApproval',
} as const

export const inventoryApprovalConfigCapabilities: CapabilityDefinition[] = [
  { id: 'inventory-approval-config-list', title: '查询物料审批配置', write: false, params: [p('orgId', 'tree', false, '所属组织ID；缺省为null，页面请求同时带order和orderField空值')] },
  { id: 'inventory-approval-config-type-list', title: '查询审批配置类型候选', write: false, params: [] },
  { id: 'inventory-approval-config-prepare-create', title: '准备批量创建审批配置', write: false, params: [p('rows', 'text', true, '页面表格行：unitId、typeIds和isRequiresApproval'), p('typeOptions', 'text', true, 'typeList返回的value/label候选')] },
  { id: 'inventory-approval-config-create', title: '批量创建审批配置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的typeList/isRequiresApproval批量草稿')] },
  { id: 'inventory-approval-config-prepare-set-approval', title: '准备切换审批开关', write: false, params: [p('id', 'text', true), p('isRequiresApproval', 'boolean', true)] },
  { id: 'inventory-approval-config-set-approval', title: '切换审批开关', write: true, params: [p('draft', 'text', true, 'prepareSetApproval返回的ID和布尔值草稿')] },
].map(definition => ({ ...definition, pagePath: INVENTORY_APPROVAL_CONFIG_PAGE_PATH, permission: INVENTORY_APPROVAL_CONFIG_PERMISSION, moduleType: INVENTORY_APPROVAL_CONFIG_MODULE_TYPE, httpInstance: 'platform' }))
