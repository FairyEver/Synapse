import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「供应链设置 → 人员配置」；Portal bbcfc35154、Java b7a359adc9e。 */
export const SUPPLY_PERSONNEL_CONFIG_PAGE_PATH = '/dashboard/supply/setting/planner/list'
export const SUPPLY_PERSONNEL_CONFIG_PERMISSION = '/dashboard/supply/setting/planner'
export const SUPPLY_PERSONNEL_CONFIG_MODULE_TYPE = null

const ROOT = '/admin-api/supply/legal-user-config'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'
const STAFF_PAGE_URL = '/org/staff/page'

export type SupplyPersonnelConfigId = string | number

export type SupplyPersonnelConfigQuery = {
  legalId?: SupplyPersonnelConfigId | '' | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type SupplyPersonnelConfigRow = {
  id: SupplyPersonnelConfigId
  legalId: SupplyPersonnelConfigId | null
  legalName: string | null
  userId: SupplyPersonnelConfigId | null
  materielType: string | null
  materielTypeIds: SupplyPersonnelConfigId[]
  materielTypeName: string | null
  planUserId: string | null
  planUserIds: SupplyPersonnelConfigId[]
  planUserName: string | null
  purchaseUserId: string | null
  purchaseUserIds: SupplyPersonnelConfigId[]
  purchaseUserName: string | null
  operatorName: string | null
  createTime: string | number | null
  updateTime: string | number | null
  [key: string]: unknown
}

export type SupplyPersonnelConfigDetail = SupplyPersonnelConfigRow

export type SupplyPersonnelConfigDraft = {
  legalId: SupplyPersonnelConfigId
  materielTypeIds: SupplyPersonnelConfigId[]
  planUserIds: SupplyPersonnelConfigId[]
  purchaseUserIds: SupplyPersonnelConfigId[]
}

export type SupplyPersonnelConfigUpdateInput = {
  current: SupplyPersonnelConfigDetail | Record<string, unknown>
  changes?: Partial<SupplyPersonnelConfigDraft> | null
}

export type SupplyPersonnelConfigPreparedUpdate = {
  draft: SupplyPersonnelConfigDraft & { id: SupplyPersonnelConfigId }
  previous: SupplyPersonnelConfigDraft & { id: SupplyPersonnelConfigId }
}

export type SupplyPersonnelConfigOrganizationNode = {
  id: SupplyPersonnelConfigId
  name: string
  pid: SupplyPersonnelConfigId | null
  isStandardUnit: number | boolean | null
  isCorporation: number | boolean | null
  disabled: boolean
  children: SupplyPersonnelConfigOrganizationNode[]
  [key: string]: unknown
}

export type SupplyPersonnelConfigStaffOption = {
  id: SupplyPersonnelConfigId
  name: string
  staffCode: SupplyPersonnelConfigId | null
  status: number | null
  organization: SupplyPersonnelConfigId | null
  label: string
  [key: string]: unknown
}

export type SupplyPersonnelConfigStaffQuery = {
  keyword: string
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SupplyPersonnelConfigId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SupplyPersonnelConfigId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function scalarOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function candidatePageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1 || (label === 'pageSize' && Number(resolved) > 100)) throw new Error(`${label}必须为1至100的正整数`)
  return Number(resolved)
}

function idListOf (value: unknown, label: string, required = false): SupplyPersonnelConfigId[] {
  let values: unknown[]
  if (value === undefined || value === null || value === '') values = []
  else if (Array.isArray(value)) values = value
  else if (typeof value === 'string') values = value.split(',').map(item => item.trim()).filter(Boolean)
  else throw new Error(`${label}必须是ID数组或逗号分隔字符串`)
  const ids = values.map((item, index) => idOf(item, `${label}[${index}]`))
  if (required && ids.length === 0) throw new Error(`${label}至少选择一项`)
  return ids
}

function requiredIdListOf (value: unknown, label: string): SupplyPersonnelConfigId[] {
  return idListOf(value, label, true)
}

function draftOf (value: unknown, label: string, includeId = false): SupplyPersonnelConfigDraft & Partial<Pick<SupplyPersonnelConfigPreparedUpdate['draft'], 'id'>> {
  const raw = objectOf(value, label)
  const draft: SupplyPersonnelConfigDraft & Partial<Pick<SupplyPersonnelConfigPreparedUpdate['draft'], 'id'>> = {
    legalId: idOf(raw.legalId, `${label}.legalId`),
    materielTypeIds: requiredIdListOf(raw.materielTypeIds, `${label}.materielTypeIds`),
    planUserIds: requiredIdListOf(raw.planUserIds, `${label}.planUserIds`),
    purchaseUserIds: requiredIdListOf(raw.purchaseUserIds, `${label}.purchaseUserIds`),
  }
  if (includeId) draft.id = idOf(raw.id, `${label}.id`)
  return draft
}

function listQueryOf (query: SupplyPersonnelConfigQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    legalId: query.legalId === undefined ? null : query.legalId === '' ? null : nullableIdOf(query.legalId, 'legalId'),
    name: query.name === undefined ? null : query.name,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown, label: string): PageResult<SupplyPersonnelConfigRow> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: Number(page.total) }
}

function rowOf (value: unknown, label: string): SupplyPersonnelConfigRow {
  const row = objectOf(value, label)
  const materielTypeIds = idListOf(row.materielTypeIds === undefined ? row.materielType : row.materielTypeIds, `${label}.materielTypeIds`)
  const planUserIds = idListOf(row.planUserIds === undefined ? row.planUserId : row.planUserIds, `${label}.planUserIds`)
  const purchaseUserIds = idListOf(row.purchaseUserIds === undefined ? row.purchaseUserId : row.purchaseUserIds, `${label}.purchaseUserIds`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    legalId: nullableIdOf(row.legalId, `${label}.legalId`),
    userId: nullableIdOf(row.userId, `${label}.userId`),
    legalName: nullableTextOf(row.legalName, `${label}.legalName`),
    materielType: nullableTextOf(row.materielType, `${label}.materielType`),
    materielTypeIds,
    materielTypeName: nullableTextOf(row.materielTypeName, `${label}.materielTypeName`),
    planUserId: nullableTextOf(row.planUserId, `${label}.planUserId`),
    planUserIds,
    planUserName: nullableTextOf(row.planUserName, `${label}.planUserName`),
    purchaseUserId: nullableTextOf(row.purchaseUserId, `${label}.purchaseUserId`),
    purchaseUserIds,
    purchaseUserName: nullableTextOf(row.purchaseUserName, `${label}.purchaseUserName`),
    operatorName: nullableTextOf(row.operatorName, `${label}.operatorName`),
    createTime: scalarOf(row.createTime, `${label}.createTime`),
    updateTime: scalarOf(row.updateTime, `${label}.updateTime`),
  }
}

function organizationNodeOf (value: unknown, label: string): SupplyPersonnelConfigOrganizationNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const isStandardUnit = node.isStandardUnit === undefined ? null : node.isStandardUnit as number | boolean | null
  const isCorporation = node.isCorporation === undefined ? null : node.isCorporation as number | boolean | null
  if (isStandardUnit !== null && typeof isStandardUnit !== 'number' && typeof isStandardUnit !== 'boolean') throw new Error(`${label}.isStandardUnit必须为数值、布尔值或null`)
  if (isCorporation !== null && typeof isCorporation !== 'number' && typeof isCorporation !== 'boolean') throw new Error(`${label}.isCorporation必须为数值、布尔值或null`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: typeof node.name === 'string' ? node.name : (() => { throw new Error(`${label}.name必须为字符串`) })(),
    pid: nullableIdOf(node.pid, `${label}.pid`),
    isStandardUnit,
    isCorporation,
    disabled: !(isStandardUnit === 1 || isCorporation === 1),
    children: children.map((item, index) => organizationNodeOf(item, `${label}.children[${index}]`)),
  }
}

function keywordOf (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('keyword必须为非空关键字')
  return value.trim()
}

function staffOptionOf (value: unknown, label: string): SupplyPersonnelConfigStaffOption {
  const row = objectOf(value, label)
  const name = typeof row.name === 'string' ? row.name : ''
  if (name === '') throw new Error(`${label}.name必须为字符串`)
  const staffCode = nullableIdOf(row.staffCode, `${label}.staffCode`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name,
    staffCode,
    status: row.status === undefined || row.status === null ? null : Number.isSafeInteger(row.status) ? Number(row.status) : (() => { throw new Error(`${label}.status必须为整数或null`) })(),
    organization: nullableIdOf(row.organization, `${label}.organization`),
    label: `${name}(${staffCode === null ? '' : String(staffCode)})`,
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function updateOf (input: SupplyPersonnelConfigUpdateInput): SupplyPersonnelConfigPreparedUpdate {
  const current = draftOf(input?.current, '人员配置编辑当前值', true)
  const changes = input?.changes === undefined || input.changes === null ? {} : objectOf(input.changes, '人员配置编辑变更')
  for (const key of Object.keys(changes)) if (!['legalId', 'materielTypeIds', 'planUserIds', 'purchaseUserIds'].includes(key)) throw new Error(`人员配置编辑变更不支持字段${key}`)
  const previous = { ...current }
  const draft = draftOf({ ...current, ...changes }, '人员配置编辑草稿', true)
  return { draft: draft as SupplyPersonnelConfigPreparedUpdate['draft'], previous: previous as SupplyPersonnelConfigPreparedUpdate['previous'] }
}

/** The injected request must be created for SUPPLY_PERSONNEL_CONFIG_PAGE_PATH. */
export function createSupplyPersonnelConfigCapability (request: PortalRequest) {
  return {
    async list (query: SupplyPersonnelConfigQuery = {}): Promise<PageResult<SupplyPersonnelConfigRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listQueryOf(query) }), '人员配置分页响应')
    },

    async get (input: { id: SupplyPersonnelConfigId }): Promise<SupplyPersonnelConfigDetail> {
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '人员配置ID') } }), '人员配置详情响应')
    },

    async organizationTree (): Promise<SupplyPersonnelConfigOrganizationNode[]> {
      const result = await request({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('人员配置组织树响应必须是数组')
      return result.map((item, index) => organizationNodeOf(item, `组织树[${index}]`))
    },

    async staffSearch (query: SupplyPersonnelConfigStaffQuery): Promise<PageResult<SupplyPersonnelConfigStaffOption>> {
      const result = await request<unknown>({
        url: STAFF_PAGE_URL,
        method: 'get',
        params: {
          pageNo: candidatePageNumberOf(query?.pageNo, 1, 'pageNo'),
          pageSize: candidatePageNumberOf(query?.pageSize, 20, 'pageSize'),
          staffName: keywordOf(query?.keyword),
        },
      })
      const page = objectOf(result, '人员候选分页响应')
      if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('人员候选分页响应缺少有效list或total')
      return { list: page.list.map((item, index) => staffOptionOf(item, `人员候选分页响应.list[${index}]`)), total: Number(page.total) }
    },

    prepareCreate (input: { form: SupplyPersonnelConfigDraft }): { draft: SupplyPersonnelConfigDraft } {
      return { draft: draftOf(input?.form, '人员配置新建表单') as SupplyPersonnelConfigDraft }
    },

    async create (input: { draft: SupplyPersonnelConfigDraft }): Promise<SupplyPersonnelConfigId> {
      const result = await request({ url: `${ROOT}/create`, method: 'post', data: draftOf(input?.draft, '人员配置新建草稿') })
      return idOf(result, '人员配置新建响应ID')
    },

    prepareUpdate: updateOf,

    async update (input: { draft: SupplyPersonnelConfigPreparedUpdate['draft'] }): Promise<true> {
      const draft = draftOf(input?.draft, '人员配置编辑草稿', true)
      return trueResult(await request({ url: `${ROOT}/update`, method: 'put', data: draft }), '人员配置编辑')
    },

    async remove (input: { id: SupplyPersonnelConfigId }): Promise<true> {
      return trueResult(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '人员配置ID') } }), '人员配置删除')
    },
  }
}

export type SupplyPersonnelConfigCapability = ReturnType<typeof createSupplyPersonnelConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })

export const SUPPLY_PERSONNEL_CONFIG_METHODS = {
  'supply-personnel-config-list': 'list',
  'supply-personnel-config-get': 'get',
  'supply-personnel-config-organization-tree': 'organizationTree',
  'supply-personnel-config-staff-search': 'staffSearch',
  'supply-personnel-config-prepare-create': 'prepareCreate',
  'supply-personnel-config-create': 'create',
  'supply-personnel-config-prepare-update': 'prepareUpdate',
  'supply-personnel-config-update': 'update',
  'supply-personnel-config-remove': 'remove',
} as const

export const supplyPersonnelConfigCapabilities: CapabilityDefinition[] = [
  { id: 'supply-personnel-config-list', title: '查询人员配置列表', write: false, params: [p('legalId', 'tree'), p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'supply-personnel-config-get', title: '读取人员配置详情', write: false, params: [p('id', 'text', true, '人员配置主键ID')] },
  { id: 'supply-personnel-config-organization-tree', title: '读取人员配置组织树', write: false, params: [] },
  { id: 'supply-personnel-config-staff-search', title: '按关键字搜索人员配置员工候选', write: false, params: [p('keyword', 'search', true, '员工姓名关键字；不能省略或传空白'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'supply-personnel-config-prepare-create', title: '准备创建人员配置', write: false, params: [p('form', 'text', true, '人员配置表单对象；包含legalId、materielTypeIds、planUserIds、purchaseUserIds')] },
  { id: 'supply-personnel-config-create', title: '创建人员配置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的人员配置草稿')] },
  { id: 'supply-personnel-config-prepare-update', title: '准备编辑人员配置', write: false, params: [p('current', 'text', true, 'get返回的完整人员配置详情'), p('changes', 'text', false, '只允许legalId、materielTypeIds、planUserIds、purchaseUserIds')] },
  { id: 'supply-personnel-config-update', title: '编辑人员配置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整草稿，含id')] },
  { id: 'supply-personnel-config-remove', title: '删除人员配置', write: true, params: [p('id', 'text', true, '列表行的人员配置主键ID')] },
].map(definition => ({ ...definition, pagePath: SUPPLY_PERSONNEL_CONFIG_PAGE_PATH, permission: SUPPLY_PERSONNEL_CONFIG_PERMISSION, moduleType: SUPPLY_PERSONNEL_CONFIG_MODULE_TYPE, httpInstance: 'platform' }))
