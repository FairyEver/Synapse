import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「财务设置 → 结转单设置」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH = '/dashboard/finance/setting/settlement-setting/list'
const ROOT = '/admin-api/finance/settlement-setting'
const ORG_TREE_URL = '/admin-api/org/organization/getRoleOrganizationTreeNew'

export type FinanceSettlementSettingId = string | number
export type FinanceSettlementSettingStatus = 0 | 1
export type FinanceSettlementAccountingEntityType = 'standard_unit' | 'corporation'
export type FinanceSettlementExternalSalesBelongType = 'sales_org' | 'delivery_org'
export type FinanceSettlementValidType = 'range' | 'long_term'

export type FinanceSettlementSettingQuery = {
  accountingEntityType?: FinanceSettlementAccountingEntityType | null
  status?: FinanceSettlementSettingStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSettlementSettingRow = {
  id: FinanceSettlementSettingId
  accountingEntityType: FinanceSettlementAccountingEntityType | string | null
  accountingScopeOrgIds: FinanceSettlementSettingId[]
  externalSalesBelongType: FinanceSettlementExternalSalesBelongType | string | null
  validType: FinanceSettlementValidType | string | null
  effectiveStart: string | null
  effectiveEnd: string | null
  status: FinanceSettlementSettingStatus
  creatorName: string | null
  createTime: string | number | null
}

export type FinanceSettlementSettingDetail = FinanceSettlementSettingRow

export type FinanceSettlementSettingSaveDraft = {
  id?: FinanceSettlementSettingId | ''
  accountingEntityType: FinanceSettlementAccountingEntityType
  accountingScopeOrgIds: FinanceSettlementSettingId[]
  externalSalesBelongType: FinanceSettlementExternalSalesBelongType
  validType: FinanceSettlementValidType
  effectiveStart: string
  effectiveEnd?: string | ''
  status: FinanceSettlementSettingStatus
}

export type FinanceSettlementSettingCreateDraft = Omit<FinanceSettlementSettingSaveDraft, 'id'> & { id?: '' }
export type FinanceSettlementSettingUpdateInput = {
  current: FinanceSettlementSettingDetail | FinanceSettlementSettingSaveDraft
  changes?: Partial<Omit<FinanceSettlementSettingSaveDraft, 'id'>> | null
}
export type FinanceSettlementSettingPreparedUpdate = {
  draft: FinanceSettlementSettingSaveDraft & { id: FinanceSettlementSettingId }
  previous: FinanceSettlementSettingSaveDraft & { id: FinanceSettlementSettingId }
}
export type FinanceSettlementSettingStatusPayload = { id: FinanceSettlementSettingId; status: FinanceSettlementSettingStatus }
export type FinanceSettlementSettingPreparedStatus = { draft: FinanceSettlementSettingStatusPayload; previous: FinanceSettlementSettingStatusPayload }

export type FinanceSettlementOrganizationNode = {
  id: FinanceSettlementSettingId
  name: string
  pid?: FinanceSettlementSettingId | null
  children: FinanceSettlementOrganizationNode[]
  isCorporation?: boolean | number | string
  isStandardUnit?: boolean | number | string
  [key: string]: unknown
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}
function idOf (value: unknown, label: string): FinanceSettlementSettingId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}
function optionalIdOf (value: unknown, label: string): FinanceSettlementSettingId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}
function idListOf (value: unknown, label: string): FinanceSettlementSettingId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空数组`)
  const result = value.map((item, index) => {
    const raw = item && typeof item === 'object' ? (item as JsonObject).value : item
    return idOf(raw, `${label}[${index}]`)
  })
  if (new Set(result.map(String)).size !== result.length) throw new Error(`${label}不能包含重复组织ID`)
  return result
}
function statusOf (value: unknown, label = 'status'): FinanceSettlementSettingStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}
function accountingEntityTypeOf (value: unknown, label = 'accountingEntityType'): FinanceSettlementAccountingEntityType {
  if (value !== 'standard_unit' && value !== 'corporation') throw new Error(`${label}只能是standard_unit或corporation`)
  return value
}
function externalTypeOf (value: unknown, label = 'externalSalesBelongType'): FinanceSettlementExternalSalesBelongType {
  if (value !== 'sales_org' && value !== 'delivery_org') throw new Error(`${label}只能是sales_org或delivery_org`)
  return value
}
function validTypeOf (value: unknown, label = 'validType'): FinanceSettlementValidType {
  if (value !== 'range' && value !== 'long_term') throw new Error(`${label}只能是range或long_term`)
  return value
}
function monthOf (value: unknown, label: string, required = true): string {
  if (!required && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}
function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}
function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}
function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved
}
function rowOf (value: unknown): FinanceSettlementSettingRow {
  const row = objectOf(value, '结转单设置列表行')
  const scope = row.accountingScopeOrgIds ?? row.accountingScopeOrgIdList ?? row.scopeOrgIds
  return {
    id: idOf(row.id, '结转单设置id'),
    accountingEntityType: nullableTextOf(row.accountingEntityType, 'accountingEntityType'),
    accountingScopeOrgIds: Array.isArray(scope) ? idListOf(scope, 'accountingScopeOrgIds') : [],
    externalSalesBelongType: nullableTextOf(row.externalSalesBelongType, 'externalSalesBelongType'),
    validType: nullableTextOf(row.validType, 'validType'),
    effectiveStart: nullableTextOf(row.effectiveStart, 'effectiveStart'),
    effectiveEnd: nullableTextOf(row.effectiveEnd, 'effectiveEnd'),
    status: statusOf(row.status),
    creatorName: nullableTextOf(row.creatorName, 'creatorName'),
    createTime: dateTimeOf(row.createTime, 'createTime'),
  }
}
function detailOf (value: unknown): FinanceSettlementSettingDetail | null {
  if (value === null || value === undefined) return null
  return rowOf(value)
}
function queryOf (query: FinanceSettlementSettingQuery = {}): Record<string, unknown> {
  return {
    order: '', orderField: '',
    accountingEntityType: query.accountingEntityType,
    status: statusOf(query.status ?? 1),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}
function savePayloadOf (input: unknown, label: string, withId: boolean): FinanceSettlementSettingSaveDraft & Partial<{ id: FinanceSettlementSettingId }> {
  const value = objectOf(input, label)
  const accountingEntityType = accountingEntityTypeOf(value.accountingEntityType, `${label}.accountingEntityType`)
  const scope = idListOf(value.accountingScopeOrgIds, `${label}.accountingScopeOrgIds`)
  const externalSalesBelongType = externalTypeOf(value.externalSalesBelongType, `${label}.externalSalesBelongType`)
  const validType = validTypeOf(value.validType === undefined || value.validType === '' ? 'range' : value.validType, `${label}.validType`)
  const effectiveStart = monthOf(value.effectiveStart, `${label}.effectiveStart`)
  const effectiveEnd = validType === 'long_term' ? '' : monthOf(value.effectiveEnd, `${label}.effectiveEnd`)
  if (validType === 'range' && effectiveEnd < effectiveStart) throw new Error(`${label}.effectiveEnd不能早于effectiveStart`)
  const payload: FinanceSettlementSettingSaveDraft & Partial<{ id: FinanceSettlementSettingId }> = {
    ...(withId ? { id: idOf(value.id, `${label}.id`) } : { id: '' }),
    accountingEntityType,
    accountingScopeOrgIds: scope,
    externalSalesBelongType,
    validType,
    effectiveStart,
    effectiveEnd,
    status: statusOf(value.status === undefined ? 1 : value.status, `${label}.status`),
  }
  return payload
}
function statusPayloadOf (input: unknown, label: string): FinanceSettlementSettingStatusPayload {
  const value = objectOf(input, label)
  return { id: idOf(value.id, `${label}.id`), status: statusOf(value.status, `${label}.status`) }
}
function treeNodeOf (value: unknown, label: string): FinanceSettlementOrganizationNode {
  const node = objectOf(value, label)
  const children = Array.isArray(node.children) ? node.children.map((item, index) => treeNodeOf(item, `${label}.children[${index}]`)) : []
  return { ...node, id: idOf(node.id, `${label}.id`), name: typeof node.name === 'string' ? node.name : '', pid: optionalIdOf(node.pid, `${label}.pid`), children }
}
function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createFinanceSettingSettlementSettingCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettlementSettingQuery = {}): Promise<PageResult<FinanceSettlementSettingRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('结转单设置分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async get (input: { id: FinanceSettlementSettingId }): Promise<FinanceSettlementSettingDetail | null> {
      const id = idOf(input?.id, '结转单设置id')
      return detailOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },
    async organizationTree (): Promise<FinanceSettlementOrganizationNode[]> {
      const result = await request<unknown>({ url: ORG_TREE_URL, method: 'get', params: { excludePost: false } })
      if (!Array.isArray(result)) throw new Error('结转单设置组织树响应必须是数组')
      return result.map((item, index) => treeNodeOf(item, `组织树[${index}]`))
    },
    prepareCreate (input: FinanceSettlementSettingCreateDraft): { draft: FinanceSettlementSettingSaveDraft & { id: '' } } {
      return { draft: savePayloadOf(input, '创建结转单设置输入', false) as FinanceSettlementSettingSaveDraft & { id: '' } }
    },
    async create (input: FinanceSettlementSettingCreateDraft): Promise<FinanceSettlementSettingId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: savePayloadOf(input, '创建结转单设置输入', false) })
      return idOf(result, '创建结转单设置返回的id')
    },
    prepareUpdate (input: FinanceSettlementSettingUpdateInput): FinanceSettlementSettingPreparedUpdate {
      const current = savePayloadOf(input?.current, '编辑结转单设置当前值', true) as FinanceSettlementSettingSaveDraft & { id: FinanceSettlementSettingId }
      const changes = input?.changes
      const changeObject = changes === undefined || changes === null ? {} : objectOf(changes, '编辑结转单设置变更')
      const allowed = new Set(['accountingEntityType', 'accountingScopeOrgIds', 'externalSalesBelongType', 'validType', 'effectiveStart', 'effectiveEnd', 'status'])
      for (const key of Object.keys(changeObject)) if (!allowed.has(key)) throw new Error(`编辑结转单设置变更不支持字段${key}`)
      const draft = savePayloadOf({ ...current, ...changeObject }, '编辑结转单设置草稿', true) as FinanceSettlementSettingSaveDraft & { id: FinanceSettlementSettingId }
      return { draft, previous: current }
    },
    async update (input: FinanceSettlementSettingUpdateInput): Promise<true> {
      const prepared = this.prepareUpdate(input)
      return trueResult(await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: prepared.draft }), '更新结转单设置')
    },
    prepareSetStatus (input: { current: FinanceSettlementSettingRow; targetStatus: FinanceSettlementSettingStatus }): FinanceSettlementSettingPreparedStatus {
      const current = statusPayloadOf(input?.current, '启停结转单设置当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { id: current.id, status: targetStatus }, previous: current }
    },
    async setStatus (input: { draft: FinanceSettlementSettingStatusPayload }): Promise<true> {
      const draft = statusPayloadOf(input?.draft, '结转单设置启停输入')
      // Portal 当前源码把 { params: { id, status } } 作为PUT第二参数，实际即为请求body；按源码保留该形状。
      return trueResult(await request<unknown>({ url: `${ROOT}/update-status`, method: 'put', data: { params: draft } }), '启停结转单设置')
    },
  }
}

export type FinanceSettingSettlementSettingCapability = ReturnType<typeof createFinanceSettingSettlementSettingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const statusParam: ParamSpec = { name: 'status', kind: 'enum', required: false, description: '绝对状态：0停用，1启用；页面默认1', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] }
const pageParams: ParamSpec[] = [p('accountingEntityType', 'text', false, '核算主体类型：standard_unit或corporation'), statusParam, p('pageNo', 'number'), p('pageSize', 'number')]
const saveParams: ParamSpec[] = [
  p('accountingEntityType', 'text', true, 'standard_unit标准化单元或corporation法人主体'),
  p('accountingScopeOrgIds', 'text', true, '非空组织ID数组；可来自组织树节点或节点对象value'),
  p('externalSalesBelongType', 'text', true, 'sales_org销售组织或delivery_org发货组织'),
  p('validType', 'text', true, 'range时间范围或long_term长期有效'),
  p('effectiveStart', 'date', true, 'YYYY-MM生效开始月份'),
  p('effectiveEnd', 'date', false, 'range必填且不得早于开始月份；long_term按Portal发送空字符串'),
  statusParam,
]

export const FINANCE_SETTING_SETTLEMENT_SETTING_METHODS = {
  'finance-setting-settlement-setting-list': 'list',
  'finance-setting-settlement-setting-get': 'get',
  'finance-setting-settlement-setting-organization-tree': 'organizationTree',
  'finance-setting-settlement-setting-prepare-create': 'prepareCreate',
  'finance-setting-settlement-setting-create': 'create',
  'finance-setting-settlement-setting-prepare-update': 'prepareUpdate',
  'finance-setting-settlement-setting-update': 'update',
  'finance-setting-settlement-setting-prepare-set-status': 'prepareSetStatus',
  'finance-setting-settlement-setting-set-status': 'setStatus',
} as const

export const financeSettingSettlementSettingCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-settlement-setting-list', title: '查询结转单设置', write: false, params: pageParams },
  { id: 'finance-setting-settlement-setting-get', title: '查询结转单设置详情', write: false, params: [p('id', 'text', true, '结转单设置主记录ID')] },
  { id: 'finance-setting-settlement-setting-organization-tree', title: '查询结转单设置组织树', write: false, params: [] },
  { id: 'finance-setting-settlement-setting-prepare-create', title: '准备创建结转单设置', write: false, params: saveParams },
  { id: 'finance-setting-settlement-setting-create', title: '创建结转单设置', write: true, params: saveParams },
  { id: 'finance-setting-settlement-setting-prepare-update', title: '准备更新结转单设置', write: false, params: [p('current', 'text', true, '来自最新详情或列表的完整值'), p('changes', 'text', false, '只允许页面表单字段')] },
  { id: 'finance-setting-settlement-setting-update', title: '更新结转单设置', write: true, params: [p('current', 'text', true, '当前完整值'), p('changes', 'text', false, '页面表单字段变更')] },
  { id: 'finance-setting-settlement-setting-prepare-set-status', title: '准备启停结转单设置', write: false, params: [p('current', 'text', true, '来自最新列表的完整行'), { ...statusParam, name: 'targetStatus', required: true }] },
  { id: 'finance-setting-settlement-setting-set-status', title: '启停结转单设置', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{ id, status }')] },
].map(definition => ({ ...definition, pagePath: FINANCE_SETTING_SETTLEMENT_SETTING_PAGE_PATH, permission: '/dashboard/finance/setting/settlement-setting', moduleType: null, httpInstance: 'platform' }))
