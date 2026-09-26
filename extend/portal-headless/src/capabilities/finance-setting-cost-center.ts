import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 成本中心管理」；静态锚点 Portal f61fdca151、Java 7aeaca409d5。 */
export const FINANCE_SETTING_COST_CENTER_PAGE_PATH = '/dashboard/finance/setting/cost-center/list'
export const FINANCE_SETTING_COST_CENTER_PERMISSION = '/dashboard/finance/setting/cost-center'
export const FINANCE_SETTING_COST_CENTER_MODULE_TYPE = null

const ROOT = '/admin-api/finance/cost-center'

export type FinanceSettingCostCenterId = string | number
export type FinanceSettingCostCenterStatus = 0 | 1
export type FinanceSettingCostCenterOrgAttribute = 1 | 2 | 3 | 4 | 5 | 6

export type FinanceSettingCostCenterQuery = {
  name?: string | null
  code?: string | null
  unitName?: string | null
  accountingSetId?: FinanceSettingCostCenterId | null
  orgId?: FinanceSettingCostCenterId | null
  orgAttribute?: FinanceSettingCostCenterOrgAttribute | null
  status?: FinanceSettingCostCenterStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingCostCenterOrg = {
  orgId: FinanceSettingCostCenterId
  orgName: string | null
  fullPath: string | null
}

export type FinanceSettingCostCenterRow = {
  id: FinanceSettingCostCenterId
  name: string | null
  code: string | null
  unitId: FinanceSettingCostCenterId | null
  unitName: string | null
  companyId: FinanceSettingCostCenterId | null
  companyName: string | null
  companyOrgName: string | null
  legalPersonId: FinanceSettingCostCenterId | null
  legalPersonName: string | null
  accountingSetId: FinanceSettingCostCenterId | null
  accountingSetName: string | null
  status: FinanceSettingCostCenterStatus
  orgList: FinanceSettingCostCenterOrg[]
  updateTime: string | null
  orgAttribute: FinanceSettingCostCenterOrgAttribute | null
  subjectCodePrefix: string | null
  editable: boolean | null
  deletable: boolean | null
  disableReason: string | null
}

export type FinanceSettingCostCenterOrgScope = {
  orgId: FinanceSettingCostCenterId | null
  orgName: string | null
  accountingSetId: FinanceSettingCostCenterId | null
  accountingSetName: string | null
  companyId: FinanceSettingCostCenterId | null
  companyOrgName: string | null
  legalPersonId: FinanceSettingCostCenterId | null
  legalPersonName: string | null
  companyName: string | null
}

export type FinanceSettingCostCenterCreateInput = {
  name: string
  unitId: FinanceSettingCostCenterId
  orgAttribute: FinanceSettingCostCenterOrgAttribute
  orgIds?: FinanceSettingCostCenterId[] | null
  code?: string | null
  accountingSetId?: FinanceSettingCostCenterId | null
}

export type FinanceSettingCostCenterCreateSubmitInput = {
  draft: FinanceSettingCostCenterSaveDraft & { id: '' }
}

export type FinanceSettingCostCenterSaveDraft = {
  id?: FinanceSettingCostCenterId | ''
  name: string
  unitId: FinanceSettingCostCenterId
  code: string | null
  orgAttribute: FinanceSettingCostCenterOrgAttribute
  orgIds: FinanceSettingCostCenterId[]
  accountingSetId: FinanceSettingCostCenterId | null
  status: FinanceSettingCostCenterStatus
}

export type FinanceSettingCostCenterUpdateChanges = {
  name?: string
  orgAttribute?: FinanceSettingCostCenterOrgAttribute
}

export type FinanceSettingCostCenterUpdateInput = {
  current: FinanceSettingCostCenterRow | FinanceSettingCostCenterSaveDraft
  changes?: FinanceSettingCostCenterUpdateChanges | null
}

export type FinanceSettingCostCenterUpdateSubmitInput = {
  draft: FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId }
}

export type FinanceSettingCostCenterPreparedUpdate = {
  draft: FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId }
  previous: FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId }
}

export type FinanceSettingCostCenterStatusPayload = {
  id: FinanceSettingCostCenterId
  status: FinanceSettingCostCenterStatus
}

export type FinanceSettingCostCenterPreparedStatus = {
  draft: FinanceSettingCostCenterStatusPayload
  previous: FinanceSettingCostCenterStatusPayload
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingCostCenterId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingCostCenterId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须为非空字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function statusOf (value: unknown, label = 'status'): FinanceSettingCostCenterStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function orgAttributeOf (value: unknown, label = 'orgAttribute'): FinanceSettingCostCenterOrgAttribute {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 6) throw new Error(`${label}只能是数值1至6`)
  return Number(value) as FinanceSettingCostCenterOrgAttribute
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function filterTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function submittedOrgIdOf (value: unknown, label: string): FinanceSettingCostCenterId {
  if (typeof value === 'string') {
    const token = value.split('_').pop() ?? value
    return idOf(token, label)
  }
  return idOf(value, label)
}

function orgIdsOf (value: unknown, label: string): FinanceSettingCostCenterId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => submittedOrgIdOf(item, `${label}[${index}]`))
}

function dateTimeOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function orgOf (value: unknown, label: string): FinanceSettingCostCenterOrg {
  const org = objectOf(value, label)
  return {
    orgId: idOf(org.orgId ?? org.id, `${label}.orgId`),
    orgName: nullableTextOf(org.orgName ?? org.name, `${label}.orgName`),
    fullPath: nullableTextOf(org.fullPath ?? org.orgFullName ?? org.path, `${label}.fullPath`),
  }
}

function rowOf (value: unknown): FinanceSettingCostCenterRow {
  const row = objectOf(value, '成本中心列表行')
  const orgList = row.orgList === undefined || row.orgList === null
    ? []
    : Array.isArray(row.orgList)
      ? row.orgList.map((item, index) => orgOf(item, `orgList[${index}]`))
      : (() => { throw new Error('orgList必须是数组或null') })()
  return {
    id: idOf(row.id, '成本中心id'),
    name: nullableTextOf(row.name, 'name'),
    code: nullableTextOf(row.code, 'code'),
    unitId: nullableIdOf(row.unitId, 'unitId'),
    unitName: nullableTextOf(row.unitName, 'unitName'),
    companyId: nullableIdOf(row.companyId, 'companyId'),
    companyName: nullableTextOf(row.companyName, 'companyName'),
    companyOrgName: nullableTextOf(row.companyOrgName, 'companyOrgName'),
    legalPersonId: nullableIdOf(row.legalPersonId, 'legalPersonId'),
    legalPersonName: nullableTextOf(row.legalPersonName, 'legalPersonName'),
    accountingSetId: nullableIdOf(row.accountingSetId, 'accountingSetId'),
    accountingSetName: nullableTextOf(row.accountingSetName, 'accountingSetName'),
    status: statusOf(row.status),
    orgList,
    updateTime: dateTimeOf(row.updateTime, 'updateTime'),
    orgAttribute: row.orgAttribute === null || row.orgAttribute === undefined ? null : orgAttributeOf(row.orgAttribute),
    subjectCodePrefix: nullableTextOf(row.subjectCodePrefix, 'subjectCodePrefix'),
    editable: row.editable === null || row.editable === undefined ? null : booleanOf(row.editable, 'editable'),
    deletable: row.deletable === null || row.deletable === undefined ? null : booleanOf(row.deletable, 'deletable'),
    disableReason: nullableTextOf(row.disableReason, 'disableReason'),
  }
}

function booleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须为boolean`)
  return value
}

function scopeOf (value: unknown): FinanceSettingCostCenterOrgScope {
  const scope = objectOf(value, '成本中心组织范围响应')
  return {
    orgId: nullableIdOf(scope.orgId, 'orgId'),
    orgName: nullableTextOf(scope.orgName, 'orgName'),
    accountingSetId: nullableIdOf(scope.accountingSetId, 'accountingSetId'),
    accountingSetName: nullableTextOf(scope.accountingSetName, 'accountingSetName'),
    companyId: nullableIdOf(scope.companyId, 'companyId'),
    companyOrgName: nullableTextOf(scope.companyOrgName, 'companyOrgName'),
    legalPersonId: nullableIdOf(scope.legalPersonId, 'legalPersonId'),
    legalPersonName: nullableTextOf(scope.legalPersonName, 'legalPersonName'),
    companyName: nullableTextOf(scope.companyName, 'companyName'),
  }
}

function queryOf (query: FinanceSettingCostCenterQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    name: filterTextOf(query.name, 'name'),
    code: filterTextOf(query.code, 'code'),
    unitName: filterTextOf(query.unitName, 'unitName'),
    accountingSetId: nullableIdOf(query.accountingSetId, 'accountingSetId'),
    orgId: nullableIdOf(query.orgId, 'orgId'),
    orgAttribute: query.orgAttribute === undefined || query.orgAttribute === null ? null : orgAttributeOf(query.orgAttribute),
    status: statusOf(query.status ?? 1),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createPayloadOf (input: FinanceSettingCostCenterCreateInput): FinanceSettingCostCenterSaveDraft & { id: '' } {
  const value = objectOf(input, '创建成本中心输入')
  const name = textOf(value.name, 'name')
  if (name.length > 500) throw new Error('name不能超过500个字符')
  return {
    id: '',
    name,
    unitId: idOf(value.unitId, 'unitId'),
    code: nullableTextOf(value.code, 'code'),
    orgAttribute: orgAttributeOf(value.orgAttribute),
    orgIds: orgIdsOf(value.orgIds, 'orgIds'),
    accountingSetId: nullableIdOf(value.accountingSetId, 'accountingSetId'),
    status: 1,
  }
}

function savePayloadOf (input: unknown, label: string, withId: boolean): FinanceSettingCostCenterSaveDraft & { id?: FinanceSettingCostCenterId | '' } {
  const value = objectOf(input, label)
  const name = textOf(value.name, `${label}.name`)
  if (name.length > 500) throw new Error(`${label}.name不能超过500个字符`)
  const payload: FinanceSettingCostCenterSaveDraft & { id?: FinanceSettingCostCenterId | '' } = {
    ...(withId ? { id: idOf(value.id, `${label}.id`) } : { id: '' }),
    name,
    unitId: idOf(value.unitId, `${label}.unitId`),
    code: nullableTextOf(value.code, `${label}.code`),
    orgAttribute: orgAttributeOf(value.orgAttribute, `${label}.orgAttribute`),
    orgIds: orgIdsOf(value.orgIds, `${label}.orgIds`),
    accountingSetId: nullableIdOf(value.accountingSetId, `${label}.accountingSetId`),
    status: statusOf(value.status === undefined ? 1 : value.status, `${label}.status`),
  }
  return payload
}

function currentPayloadOf (input: FinanceSettingCostCenterRow | FinanceSettingCostCenterSaveDraft): FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId } {
  const value = objectOf(input, '编辑成本中心当前值')
  const orgIds = value.orgIds !== undefined ? value.orgIds : Array.isArray(value.orgList) ? value.orgList.map((item, index) => {
    const org = objectOf(item, `编辑成本中心当前值.orgList[${index}]`)
    return org.orgId ?? org.id
  }) : []
  return savePayloadOf({ ...value, orgIds }, '编辑成本中心当前值', true) as FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId }
}

function updatePayloadOf (input: FinanceSettingCostCenterUpdateInput): FinanceSettingCostCenterPreparedUpdate {
  const previous = currentPayloadOf(input?.current)
  const changes = input?.changes === undefined || input?.changes === null ? {} : objectOf(input.changes, '编辑成本中心变更')
  const allowed = new Set(['name', 'orgAttribute'])
  for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`编辑成本中心变更不支持字段${key}`)
  const draft = currentPayloadOf({ ...previous, ...changes })
  return { draft, previous }
}

function createSubmitPayloadOf (input: FinanceSettingCostCenterCreateSubmitInput): FinanceSettingCostCenterSaveDraft & { id: '' } {
  const value = objectOf(input, '提交创建成本中心输入')
  return createPayloadOf(objectOf(value.draft, '创建成本中心draft') as FinanceSettingCostCenterCreateInput)
}

function updateSubmitPayloadOf (input: FinanceSettingCostCenterUpdateSubmitInput): FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId } {
  const value = objectOf(input, '提交编辑成本中心输入')
  return savePayloadOf(objectOf(value.draft, '编辑成本中心draft'), '编辑成本中心draft', true) as FinanceSettingCostCenterSaveDraft & { id: FinanceSettingCostCenterId }
}

function statusPayloadOf (input: unknown, label: string): FinanceSettingCostCenterStatusPayload {
  const value = objectOf(input, label)
  return { id: idOf(value.id, `${label}.id`), status: statusOf(value.status, `${label}.status`) }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createFinanceSettingCostCenterCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingCostCenterQuery = {}): Promise<PageResult<FinanceSettingCostCenterRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'post', data: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('成本中心分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (input: { id: FinanceSettingCostCenterId }): Promise<FinanceSettingCostCenterRow> {
      const id = idOf(input?.id, '成本中心id')
      return rowOf(await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },

    async resolveOrgScope (input: { orgId: FinanceSettingCostCenterId }): Promise<FinanceSettingCostCenterOrgScope> {
      const orgId = idOf(input?.orgId, 'orgId')
      return scopeOf(await request<unknown>({ url: `${ROOT}/resolve-org-scope`, method: 'get', params: { orgId } }))
    },

    async generateCode (input: { unitId: FinanceSettingCostCenterId }): Promise<string> {
      const unitId = idOf(input?.unitId, 'unitId')
      const result = await request<unknown>({ url: `${ROOT}/generate-code`, method: 'get', params: { unitId } })
      if (result === null || result === undefined) return ''
      return textOf(result, '成本中心编码')
    },

    prepareCreate (input: FinanceSettingCostCenterCreateInput): { draft: FinanceSettingCostCenterSaveDraft & { id: '' } } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceSettingCostCenterCreateSubmitInput): Promise<FinanceSettingCostCenterId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: createSubmitPayloadOf(input) })
      return idOf(result, '新建成本中心返回的id')
    },

    prepareUpdate (input: FinanceSettingCostCenterUpdateInput): FinanceSettingCostCenterPreparedUpdate {
      return updatePayloadOf(input)
    },

    async update (input: FinanceSettingCostCenterUpdateSubmitInput): Promise<true> {
      const draft = updateSubmitPayloadOf(input)
      return trueResult(await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft }), '更新成本中心')
    },

    prepareSetStatus (input: { current: FinanceSettingCostCenterRow; targetStatus: FinanceSettingCostCenterStatus }): FinanceSettingCostCenterPreparedStatus {
      const current = statusPayloadOf(input?.current, '启停成本中心当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { id: current.id, status: targetStatus }, previous: current }
    },

    async setStatus (input: { draft: FinanceSettingCostCenterStatusPayload }): Promise<true> {
      const draft = statusPayloadOf(input?.draft, '成本中心启停输入')
      return trueResult(await request<unknown>({ url: `${ROOT}/update-status`, method: 'put', data: draft }), '启停成本中心')
    },
  }
}

export type FinanceSettingCostCenterCapability = ReturnType<typeof createFinanceSettingCostCenterCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const statusParam: ParamSpec = { name: 'status', kind: 'enum', required: false, description: '列表绝对状态：0停用、1启用；页面默认1', options: [{ value: 0, label: '停用' }, { value: 1, label: '启用' }] }
const orgAttributeParam: ParamSpec = { name: 'orgAttribute', kind: 'enum', required: true, description: '组织财务属性：1生产成本、2辅助生产成本、3制造费用、4研发费用、5销售费用、6管理费用', options: [1, 2, 3, 4, 5, 6].map(value => ({ value, label: String(value) })) }
const createParams: ParamSpec[] = [
  p('name', 'text', true, '成本中心名称；最多500字符'),
  p('unitId', 'text', true, '所属组织ID；不是组织名称'),
  orgAttributeParam,
  p('orgIds', 'tree', false, '成本中心包含的组织ID数组；页面没有必填规则，省略时发送[]'),
  p('code', 'text', false, '页面按所属组织自动预填的编码；服务端会覆盖，省略时发送null'),
  p('accountingSetId', 'text', false, '页面按所属组织解析的账套ID；服务端会覆盖，省略时发送null'),
]

export const FINANCE_SETTING_COST_CENTER_METHODS = {
  'finance-setting-cost-center-list': 'list',
  'finance-setting-cost-center-get': 'get',
  'finance-setting-cost-center-resolve-org-scope': 'resolveOrgScope',
  'finance-setting-cost-center-generate-code': 'generateCode',
  'finance-setting-cost-center-prepare-create': 'prepareCreate',
  'finance-setting-cost-center-create': 'create',
  'finance-setting-cost-center-prepare-update': 'prepareUpdate',
  'finance-setting-cost-center-update': 'update',
  'finance-setting-cost-center-prepare-set-status': 'prepareSetStatus',
  'finance-setting-cost-center-set-status': 'setStatus',
} as const

export const financeSettingCostCenterCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-cost-center-list', title: '查询成本中心', write: false, params: [p('name', 'text', false, '成本中心名称筛选；默认null'), p('code', 'text', false, '成本中心编码筛选；默认null'), p('unitName', 'text', false, '所属组织名称筛选；默认null'), p('accountingSetId', 'text', false, '账套ID筛选；默认null'), p('orgId', 'text', false, '组织ID筛选；包含该组织及下级关联的成本中心'), p('orgAttribute', 'enum', false, '组织财务属性筛选；默认null'), statusParam, p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认20，只支持10、20、50、100')] },
  { id: 'finance-setting-cost-center-get', title: '查询成本中心详情', write: false, params: [p('id', 'text', true, '成本中心主键ID')] },
  { id: 'finance-setting-cost-center-resolve-org-scope', title: '解析成本中心组织账套', write: false, params: [p('orgId', 'text', true, '所属组织ID；页面选择unitId后调用')] },
  { id: 'finance-setting-cost-center-generate-code', title: '生成成本中心编码', write: false, params: [p('unitId', 'text', true, '所属组织ID；页面选择unitId后调用')] },
  { id: 'finance-setting-cost-center-prepare-create', title: '准备创建成本中心', write: false, params: createParams },
  { id: 'finance-setting-cost-center-create', title: '创建成本中心', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整创建草稿；不要添加accountingSetName')] },
  { id: 'finance-setting-cost-center-prepare-update', title: '准备编辑成本中心', write: false, params: [p('current', 'text', true, '来自最新get或list的完整成本中心行'), p('changes', 'text', false, '只允许页面编辑的name、orgAttribute')] },
  { id: 'finance-setting-cost-center-update', title: '编辑成本中心', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整编辑草稿')] },
  { id: 'finance-setting-cost-center-prepare-set-status', title: '准备启停成本中心', write: false, params: [p('current', 'text', true, '来自最新列表的完整行'), { ...statusParam, name: 'targetStatus', required: true, description: '与current.status相反的绝对目标状态' }] },
  { id: 'finance-setting-cost-center-set-status', title: '启停成本中心', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{id,status}草稿')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_COST_CENTER_PAGE_PATH,
  permission: FINANCE_SETTING_COST_CENTER_PERMISSION,
  moduleType: FINANCE_SETTING_COST_CENTER_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
