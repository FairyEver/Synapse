import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 费用分配规则」列表、详情、表单和启停。 */
export const FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH = '/dashboard/finance/setting/allocation-rules/list'
export const FINANCE_SETTING_ALLOCATION_RULES_PERMISSION = '/dashboard/finance/setting/allocation-rules'
export const FINANCE_SETTING_ALLOCATION_RULES_MODULE_TYPE = null

const ROOT = '/admin-api/finance/expense-allocation-rule'
const DEFAULT_PAGE_SIZE = 20
const DUPLICATE_CHECK_PAGE_SIZE = 999

export const FINANCE_ALLOCATION_RULE_TYPE = {
  CLASS: 'cost_sharing_class',
  ORDER: 'cost_sharing_order',
} as const

export type FinanceAllocationRuleId = string | number
export type FinanceAllocationRuleType = (typeof FINANCE_ALLOCATION_RULE_TYPE)[keyof typeof FINANCE_ALLOCATION_RULE_TYPE]
export type FinanceAllocationRuleStatus = boolean
export type FinanceAllocationRuleListStatus = 0 | 1
export type FinanceAllocationOrderType = 1 | 2

export type FinanceAllocationRuleCostCenter = {
  id: FinanceAllocationRuleId
  code: string | null
  name: string | null
  unitId: FinanceAllocationRuleId | null
  orgAttribute: number | null
  orgIds: FinanceAllocationRuleId[]
}

export type FinanceAllocationRuleQuery = {
  unitIdList?: FinanceAllocationRuleId[]
  allocateCostCenterIdList?: FinanceAllocationRuleId[]
  acceptCostCenterIdList?: FinanceAllocationRuleId[]
  expenseTypeIdList?: Array<string | number>
  ruleType?: FinanceAllocationRuleType | null
  indicator?: FinanceAllocationRuleId | null
  status?: FinanceAllocationRuleListStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceAllocationRuleRow = Record<string, unknown> & {
  id: FinanceAllocationRuleId
  status: FinanceAllocationRuleStatus
  createTime: string | number | null
  updateTime: string | number | null
  allocateOrg: string | null
  ruleType: string | null
  orderAllocationType: number | null
  expenseType: string | null
  expenseTypeName: string | null
  indicator: FinanceAllocationRuleId | null
  acceptOrg: string | null
  description: string | null
  orgFullPath: string | null
  unitId: FinanceAllocationRuleId | null
  unitName: string | null
  unitType: string | null
  orgAttribute: number | null
  ruleOrder: number | null
  productGroups: string | null
  productGroupsName: string | null
  revenueSubjectIds: string | null
  revenueSubjectNames: string | null
  allocateTargets: string | null
  acceptTargets: string | null
  allocateCostCenters: FinanceAllocationRuleCostCenter[]
  acceptCostCenters: FinanceAllocationRuleCostCenter[]
  costCenterMigrationStatus: number | null
  costCenterMigrationMessage: string | null
}

export type FinanceAllocationRuleForm = {
  id?: FinanceAllocationRuleId
  status?: FinanceAllocationRuleStatus
  ruleType: FinanceAllocationRuleType
  allocateCostCenterIds: FinanceAllocationRuleId[]
  acceptCostCenterIds?: FinanceAllocationRuleId[] | null
  orderAllocationType?: FinanceAllocationOrderType | null
  expenseType?: string | number | null
  indicator: FinanceAllocationRuleId
  ruleOrder?: number | null
  productGroups?: Array<string | number> | string | null
  description: string
  /** Selector snapshots let the SDK reproduce Portal's org-attribute checks before submit. */
  allocateCostCenters?: FinanceAllocationRuleCostCenter[] | null
}

export type FinanceAllocationRuleSaveDraft = {
  id?: FinanceAllocationRuleId
  status: FinanceAllocationRuleStatus
  ruleType: FinanceAllocationRuleType
  orderAllocationType: FinanceAllocationOrderType | null
  expenseType: string | null
  indicator: FinanceAllocationRuleId
  description: string
  ruleOrder: number | null
  productGroups: string
  allocateCostCenterIds: FinanceAllocationRuleId[]
  acceptCostCenterIds: FinanceAllocationRuleId[]
  allocateCostCenters?: FinanceAllocationRuleCostCenter[]
}

export type FinanceAllocationRulePreparedUpdate = {
  draft: FinanceAllocationRuleSaveDraft & { id: FinanceAllocationRuleId }
  previous: FinanceAllocationRuleSaveDraft & { id: FinanceAllocationRuleId }
}

export type FinanceAllocationRuleStatusDraft = {
  id: FinanceAllocationRuleId
  status: FinanceAllocationRuleStatus
}

export type FinanceAllocationRulePreparedStatus = {
  draft: FinanceAllocationRuleStatusDraft
  previous: FinanceAllocationRuleStatusDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceAllocationRuleId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceAllocationRuleId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function idListOf (value: unknown, label: string, required = false): FinanceAllocationRuleId[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}必须是非空数组`)
    return []
  }
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (required && value.length === 0) throw new Error(`${label}必须是非空数组`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(result.map(String)).size !== result.length) throw new Error(`${label}不能包含重复ID`)
  return result
}

function booleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}不能超过${maxLength}个字符`)
  return value
}

function integerOrNullOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return Number(value)
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function ruleTypeOf (value: unknown, label = 'ruleType'): FinanceAllocationRuleType {
  if (value === FINANCE_ALLOCATION_RULE_TYPE.CLASS || value === FINANCE_ALLOCATION_RULE_TYPE.ORDER) return value
  throw new Error(`${label}必须是cost_sharing_class或cost_sharing_order`)
}

function orderAllocationTypeOf (value: unknown, label: string, required: boolean): FinanceAllocationOrderType | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const normalized = typeof value === 'string' && /^(?:1|2)$/.test(value) ? Number(value) : value
  if (normalized !== 1 && normalized !== 2) throw new Error(`${label}只能是1（生产订单）或2（销售订单）`)
  return normalized
}

function expenseTypeOf (value: unknown, label: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new Error(`${label}不能为空`)
  const result = String(value)
  if (!result.startsWith('2')) throw new Error(`${label}必须来自expense_category的费用分配类选项`)
  return result
}

function indicatorOf (value: unknown): FinanceAllocationRuleId {
  return idOf(value, 'indicator')
}

function ruleOrderOf (value: unknown, required: boolean): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('ruleOrder不能为空')
    return null
  }
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10000) throw new Error('ruleOrder必须是1至10000的整数')
  return Number(value)
}

function productGroupsOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  const source = Array.isArray(value) ? value : String(value).split(',')
  const result = source.map((item, index) => {
    if (item === undefined || item === null || String(item).trim() === '') throw new Error(`${label}[${index}]不能为空`)
    return String(item).trim()
  })
  return result.join(',')
}

function costCenterOf (value: unknown, label: string): FinanceAllocationRuleCostCenter {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    code: nullableTextOf(row.code, `${label}.code`),
    name: nullableTextOf(row.name, `${label}.name`),
    unitId: nullableIdOf(row.unitId, `${label}.unitId`),
    orgAttribute: integerOrNullOf(row.orgAttribute, `${label}.orgAttribute`),
    orgIds: idListOf(row.orgIds, `${label}.orgIds`),
  }
}

function costCentersOf (value: unknown, label: string): FinanceAllocationRuleCostCenter[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => costCenterOf(item, `${label}[${index}]`))
}

function idsFromCostCenters (value: unknown, label: string): FinanceAllocationRuleId[] {
  return costCentersOf(value, label).map(item => item.id)
}

function sameValueSet (left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): string[] => {
    const source = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : String(value).split(',')
    return [...new Set(source.map(item => String(item).trim()).filter(Boolean))].sort()
  }
  const a = normalize(left)
  const b = normalize(right)
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function validateCostCenterRules (ruleType: FinanceAllocationRuleType, allocatorIds: FinanceAllocationRuleId[], receiverIds: FinanceAllocationRuleId[], expenseType: string | null, snapshots: FinanceAllocationRuleCostCenter[]): void {
  if (ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS && receiverIds.some(id => allocatorIds.some(allocatorId => String(allocatorId) === String(id)))) {
    throw new Error('分配方与接收方成本中心不能一致')
  }
  if (snapshots.length === 0) return
  const byId = new Map(snapshots.map(item => [String(item.id), item]))
  const allocators = allocatorIds.map(id => byId.get(String(id)))
  if (ruleType === FINANCE_ALLOCATION_RULE_TYPE.ORDER) {
    if (allocators.some(item => !item || item.orgAttribute !== 1)) throw new Error('费用分配到订单时，分配方组织财务属性必须为生产成本')
    return
  }
  if (allocators.some(item => item?.orgAttribute === 1) && expenseType !== '29') {
    throw new Error('分配方组织财务属性为生产成本时，费用类别仅支持选择空舍费')
  }
}

function draftOf (value: unknown, label: string, mode: 'create' | 'update', fallbackStatus?: boolean): FinanceAllocationRuleSaveDraft {
  const input = objectOf(value, label)
  const id = nullableIdOf(input.id, `${label}.id`)
  if (mode === 'update' && id === null) throw new Error(`${label}.id不能为空`)
  const ruleType = ruleTypeOf(input.ruleType, `${label}.ruleType`)
  const allocateCostCenterIds = idListOf(input.allocateCostCenterIds, `${label}.allocateCostCenterIds`, true)
  const acceptCostCenterIds = ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS
    ? idListOf(input.acceptCostCenterIds, `${label}.acceptCostCenterIds`, true)
    : []
  const expenseType = expenseTypeOf(input.expenseType, `${label}.expenseType`, ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS)
  const orderAllocationType = orderAllocationTypeOf(input.orderAllocationType, `${label}.orderAllocationType`, ruleType === FINANCE_ALLOCATION_RULE_TYPE.ORDER)
  const indicator = indicatorOf(input.indicator)
  const ruleOrder = ruleOrderOf(input.ruleOrder, ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS)
  const description = requiredTextOf(input.description, `${label}.description`, 500)
  const status = mode === 'create' ? true : booleanOf(input.status ?? fallbackStatus, `${label}.status`)
  const allocateCostCenters = costCentersOf(input.allocateCostCenters, `${label}.allocateCostCenters`)
  validateCostCenterRules(ruleType, allocateCostCenterIds, acceptCostCenterIds, expenseType, allocateCostCenters)
  return {
    ...(id === null ? {} : { id }),
    status,
    ruleType,
    orderAllocationType,
    expenseType,
    indicator,
    description,
    ruleOrder,
    productGroups: ruleType === FINANCE_ALLOCATION_RULE_TYPE.ORDER ? productGroupsOf(input.productGroups, `${label}.productGroups`) : '',
    allocateCostCenterIds,
    acceptCostCenterIds,
    ...(allocateCostCenters.length ? { allocateCostCenters } : {}),
  }
}

function queryListOf (value: FinanceAllocationRuleQuery = {}): Record<string, unknown> {
  const query = value ?? {}
  const ruleType = query.ruleType === undefined ? FINANCE_ALLOCATION_RULE_TYPE.CLASS : query.ruleType === null ? null : ruleTypeOf(query.ruleType, 'ruleType')
  const status = query.status === undefined ? 1 : query.status
  if (status !== 0 && status !== 1) throw new Error('status只能是数值0（停用）或1（启用）')
  const pageNo = query.pageNo ?? 1
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new Error('pageNo必须为正整数')
  if (!Number.isSafeInteger(pageSize) || ![10, 20, 50, 100].includes(pageSize)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return {
    order: '',
    orderField: '',
    unitIdList: idListOf(query.unitIdList, 'unitIdList'),
    allocateCostCenterIdList: idListOf(query.allocateCostCenterIdList, 'allocateCostCenterIdList'),
    acceptCostCenterIdList: idListOf(query.acceptCostCenterIdList, 'acceptCostCenterIdList'),
    ruleType,
    expenseTypeIdList: query.expenseTypeIdList === undefined
      ? []
      : Array.isArray(query.expenseTypeIdList)
        ? [...query.expenseTypeIdList]
        : (() => { throw new Error('expenseTypeIdList必须是数组') })(),
    indicator: nullableIdOf(query.indicator, 'indicator'),
    status,
    pageNo,
    pageSize,
  }
}

function rowOf (value: unknown, label = '费用分配规则列表行'): FinanceAllocationRuleRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    status: booleanOf(row.status, `${label}.status`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
    allocateOrg: nullableTextOf(row.allocateOrg, `${label}.allocateOrg`),
    ruleType: nullableTextOf(row.ruleType, `${label}.ruleType`),
    orderAllocationType: integerOrNullOf(row.orderAllocationType, `${label}.orderAllocationType`),
    expenseType: nullableTextOf(row.expenseType, `${label}.expenseType`),
    expenseTypeName: nullableTextOf(row.expenseTypeName, `${label}.expenseTypeName`),
    indicator: nullableIdOf(row.indicator, `${label}.indicator`),
    acceptOrg: nullableTextOf(row.acceptOrg, `${label}.acceptOrg`),
    description: nullableTextOf(row.description, `${label}.description`),
    orgFullPath: nullableTextOf(row.orgFullPath, `${label}.orgFullPath`),
    unitId: nullableIdOf(row.unitId, `${label}.unitId`),
    unitName: nullableTextOf(row.unitName, `${label}.unitName`),
    unitType: nullableTextOf(row.unitType, `${label}.unitType`),
    orgAttribute: integerOrNullOf(row.orgAttribute, `${label}.orgAttribute`),
    ruleOrder: integerOrNullOf(row.ruleOrder, `${label}.ruleOrder`),
    productGroups: nullableTextOf(row.productGroups, `${label}.productGroups`),
    productGroupsName: nullableTextOf(row.productGroupsName, `${label}.productGroupsName`),
    revenueSubjectIds: nullableTextOf(row.revenueSubjectIds, `${label}.revenueSubjectIds`),
    revenueSubjectNames: nullableTextOf(row.revenueSubjectNames, `${label}.revenueSubjectNames`),
    allocateTargets: nullableTextOf(row.allocateTargets, `${label}.allocateTargets`),
    acceptTargets: nullableTextOf(row.acceptTargets, `${label}.acceptTargets`),
    allocateCostCenters: costCentersOf(row.allocateCostCenters, `${label}.allocateCostCenters`),
    acceptCostCenters: costCentersOf(row.acceptCostCenters, `${label}.acceptCostCenters`),
    costCenterMigrationStatus: integerOrNullOf(row.costCenterMigrationStatus, `${label}.costCenterMigrationStatus`),
    costCenterMigrationMessage: nullableTextOf(row.costCenterMigrationMessage, `${label}.costCenterMigrationMessage`),
  }
}

function pageOf (value: unknown, label: string): PageResult<FinanceAllocationRuleRow> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: Number(page.total) }
}

function savePayloadOf (draft: FinanceAllocationRuleSaveDraft, mode: 'create' | 'update'): Record<string, unknown> {
  return {
    ...(mode === 'update' ? { id: draft.id } : {}),
    status: draft.status,
    ruleType: draft.ruleType,
    orderAllocationType: draft.orderAllocationType,
    expenseType: draft.expenseType,
    indicator: draft.indicator,
    description: draft.description,
    ruleOrder: draft.ruleOrder,
    productGroups: draft.productGroups,
    allocateCostCenterIds: draft.allocateCostCenterIds,
    acceptCostCenterIds: draft.acceptCostCenterIds,
  }
}

function duplicateQueryOf (draft: FinanceAllocationRuleSaveDraft): Record<string, unknown> {
  return {
    pageNo: 1,
    pageSize: DUPLICATE_CHECK_PAGE_SIZE,
    ruleType: draft.ruleType,
    allocateCostCenterIdList: draft.allocateCostCenterIds,
    acceptCostCenterIdList: draft.ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS ? draft.acceptCostCenterIds : [],
    orderAllocationType: draft.ruleType === FINANCE_ALLOCATION_RULE_TYPE.ORDER ? draft.orderAllocationType : null,
    indicator: draft.indicator,
    expenseTypeIdList: draft.expenseType ? [draft.expenseType] : [],
    status: null,
  }
}

function duplicateRowOf (value: unknown, label: string): JsonObject {
  return objectOf(value, label)
}

function duplicateCostCenterIds (value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.map(item => objectOf(item, '重复检查成本中心').id)
}

async function assertNoDuplicate (request: PortalRequest, draft: FinanceAllocationRuleSaveDraft): Promise<void> {
  const result = objectOf(await request({ url: `${ROOT}/page`, method: 'post', data: duplicateQueryOf(draft) }), '费用分配规则重复检查响应')
  if (!Array.isArray(result.list)) throw new Error('费用分配规则重复检查响应缺少list')
  const duplicate = result.list.map((item, index) => duplicateRowOf(item, `费用分配规则重复检查响应.list[${index}]`)).some(current => {
    if (draft.id !== undefined && String(current.id) === String(draft.id)) return false
    if (current.ruleType !== draft.ruleType) return false
    if (String(current.indicator ?? '') !== String(draft.indicator ?? '')) return false
    if (!sameValueSet(duplicateCostCenterIds(current.allocateCostCenters), draft.allocateCostCenterIds)) return false
    if (draft.ruleType === FINANCE_ALLOCATION_RULE_TYPE.CLASS) {
      return String(current.expenseType ?? '') === String(draft.expenseType ?? '') && sameValueSet(duplicateCostCenterIds(current.acceptCostCenters), draft.acceptCostCenterIds)
    }
    return String(current.orderAllocationType ?? '') === String(draft.orderAllocationType ?? '') && sameValueSet(current.productGroups, draft.productGroups)
  })
  if (duplicate) throw new Error('已存在重复规则，请调整规则条件后再保存')
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createFinanceSettingAllocationRulesCapability (request: PortalRequest) {
  return {
    async list (query: FinanceAllocationRuleQuery = {}): Promise<PageResult<FinanceAllocationRuleRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'post', data: queryListOf(query) }), '费用分配规则分页响应')
    },

    async get (input: { id: FinanceAllocationRuleId }): Promise<FinanceAllocationRuleRow> {
      const id = idOf(input?.id, '费用分配规则id')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '费用分配规则详情')
    },

    prepareCreate (input: FinanceAllocationRuleForm): { draft: FinanceAllocationRuleSaveDraft } {
      return { draft: draftOf(input, '创建费用分配规则输入', 'create') }
    },

    async create (input: { draft: FinanceAllocationRuleSaveDraft }): Promise<FinanceAllocationRuleId> {
      const draft = draftOf(input?.draft, '创建费用分配规则draft', 'create')
      await assertNoDuplicate(request, draft)
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: savePayloadOf(draft, 'create') }), '创建费用分配规则返回的id')
    },

    prepareUpdate (input: { current: FinanceAllocationRuleRow; changes?: Partial<FinanceAllocationRuleForm> | null }): FinanceAllocationRulePreparedUpdate {
      const current = rowOf(input?.current, '编辑费用分配规则当前值')
      const changes = objectOf(input?.changes ?? {}, '费用分配规则编辑变更')
      const allowed = new Set(['ruleType', 'allocateCostCenterIds', 'acceptCostCenterIds', 'orderAllocationType', 'expenseType', 'indicator', 'ruleOrder', 'productGroups', 'description', 'status', 'allocateCostCenters'])
      for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`费用分配规则编辑变更不支持字段${key}`)
      const currentForm: FinanceAllocationRuleForm = {
        id: current.id,
        status: current.status,
        ruleType: ruleTypeOf(current.ruleType, '当前ruleType'),
        allocateCostCenterIds: idsFromCostCenters(current.allocateCostCenters, '当前分配方成本中心'),
        acceptCostCenterIds: idsFromCostCenters(current.acceptCostCenters, '当前接收方成本中心'),
        orderAllocationType: orderAllocationTypeOf(current.orderAllocationType, '当前orderAllocationType', false),
        expenseType: current.expenseType,
        indicator: indicatorOf(current.indicator),
        ruleOrder: current.ruleOrder,
        productGroups: current.productGroups,
        description: current.description ?? '',
        allocateCostCenters: current.allocateCostCenters,
      }
      const previous = draftOf(currentForm, '编辑费用分配规则当前值', 'update', current.status) as FinanceAllocationRuleSaveDraft & { id: FinanceAllocationRuleId }
      const draft = draftOf({ ...currentForm, ...changes, id: current.id }, '编辑费用分配规则draft', 'update', current.status) as FinanceAllocationRuleSaveDraft & { id: FinanceAllocationRuleId }
      return { draft, previous }
    },

    async update (input: { draft: FinanceAllocationRuleSaveDraft & { id: FinanceAllocationRuleId } }): Promise<true> {
      const draft = draftOf(input?.draft, '更新费用分配规则draft', 'update')
      await assertNoDuplicate(request, draft)
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: savePayloadOf(draft, 'update') }), '更新费用分配规则')
    },

    prepareSetStatus (input: { current: FinanceAllocationRuleRow; targetStatus: FinanceAllocationRuleStatus }): FinanceAllocationRulePreparedStatus {
      const current = rowOf(input?.current, '启停费用分配规则当前值')
      const targetStatus = booleanOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与当前status相反')
      return { draft: { id: current.id, status: targetStatus }, previous: { id: current.id, status: current.status } }
    },

    async setStatus (input: { draft: FinanceAllocationRuleStatusDraft }): Promise<true> {
      const draft = objectOf(input?.draft, '启停费用分配规则draft')
      const id = idOf(draft.id, '启停费用分配规则draft.id')
      const status = booleanOf(draft.status, '启停费用分配规则draft.status')
      return trueOf(await request({ url: `${ROOT}/updateStatus`, method: 'post', data: { id, status } }), '启停费用分配规则')
    },
  }
}

export type FinanceSettingAllocationRulesCapability = ReturnType<typeof createFinanceSettingAllocationRulesCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const FINANCE_SETTING_ALLOCATION_RULES_METHODS = {
  'finance-setting-allocation-rules-list': 'list',
  'finance-setting-allocation-rules-get': 'get',
  'finance-setting-allocation-rules-prepare-create': 'prepareCreate',
  'finance-setting-allocation-rules-create': 'create',
  'finance-setting-allocation-rules-prepare-update': 'prepareUpdate',
  'finance-setting-allocation-rules-update': 'update',
  'finance-setting-allocation-rules-prepare-set-status': 'prepareSetStatus',
  'finance-setting-allocation-rules-set-status': 'setStatus',
} as const

const ruleTypeParam: ParamSpec = { name: 'ruleType', kind: 'enum', required: false, description: '规则类型；cost_sharing_class费用类别分摊，cost_sharing_order订单分配', options: [{ value: FINANCE_ALLOCATION_RULE_TYPE.CLASS, label: '费用类别分摊' }, { value: FINANCE_ALLOCATION_RULE_TYPE.ORDER, label: '订单分配' }] }

export const financeSettingAllocationRulesCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-allocation-rules-list', title: '查询费用分配规则', write: false, params: [p('unitIdList', 'tree', false, '所属单元ID数组；默认[]'), p('allocateCostCenterIdList', 'tree', false, '分配方成本中心ID数组；默认[]'), p('acceptCostCenterIdList', 'tree', false, '接收方成本中心ID数组；默认[]'), p('expenseTypeIdList', 'enum', false, '费用类别ID数组；默认[]'), ruleTypeParam, p('indicator', 'text', false, '分摊指标ID；默认null'), p('status', 'boolean', false, '状态；默认true启用'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认20，支持10/20/50/100')] },
  { id: 'finance-setting-allocation-rules-get', title: '查询费用分配规则详情', write: false, params: [p('id', 'text', true, '费用分配规则主记录ID')] },
  { id: 'finance-setting-allocation-rules-prepare-create', title: '准备创建费用分配规则', write: false, params: [p('ruleType', 'enum', true, '规则类型'), p('allocateCostCenterIds', 'tree', true, '分配方成本中心ID数组，至少一项'), p('acceptCostCenterIds', 'tree', false, '费用类别分摊时的接收方成本中心ID数组，至少一项'), p('orderAllocationType', 'enum', false, '订单分配类型：1生产订单或2销售订单'), p('expenseType', 'enum', false, '费用类别分摊时的费用分配类字典值'), p('indicator', 'text', true, '分摊指标ID'), p('ruleOrder', 'number', false, '费用类别分摊时的1至10000规则顺序'), p('productGroups', 'tree', false, '订单分配时的产品组ID数组或逗号字符串'), p('description', 'text', true, '规则描述，最多500字符'), p('allocateCostCenters', 'text', false, '已核实的分配方成本中心快照，用于组织财务属性校验')] },
  { id: 'finance-setting-allocation-rules-create', title: '创建费用分配规则', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整草稿')] },
  { id: 'finance-setting-allocation-rules-prepare-update', title: '准备编辑费用分配规则', write: false, params: [p('current', 'text', true, 'get返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'finance-setting-allocation-rules-update', title: '更新费用分配规则', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整草稿')] },
  { id: 'finance-setting-allocation-rules-prepare-set-status', title: '准备启停费用分配规则', write: false, params: [p('current', 'text', true, '来自最新列表或详情的完整行'), p('targetStatus', 'boolean', true, '与current.status相反的绝对目标状态')] },
  { id: 'finance-setting-allocation-rules-set-status', title: '启停费用分配规则', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{id,status}')] },
].map(definition => ({ ...definition, pagePath: FINANCE_SETTING_ALLOCATION_RULES_PAGE_PATH, permission: FINANCE_SETTING_ALLOCATION_RULES_PERMISSION, moduleType: FINANCE_SETTING_ALLOCATION_RULES_MODULE_TYPE, httpInstance: 'platform' }))
