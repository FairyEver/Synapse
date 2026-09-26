import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「财务设置 → 销售分配系数」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH = '/dashboard/finance/setting/sale-allocation-coefficient/list'
const ROOT = '/admin-api/finance/sales-allocation-coefficient'

export type FinanceSaleAllocationCoefficientId = string | number
export type FinanceSaleAllocationCoefficientStatus = 0 | 1

export type FinanceSaleAllocationCoefficientQuery = {
  tenantName?: string | null
  productGroupId?: FinanceSaleAllocationCoefficientId | null
  categoryId?: FinanceSaleAllocationCoefficientId | null
  status?: FinanceSaleAllocationCoefficientStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSaleAllocationCoefficientRow = {
  id: FinanceSaleAllocationCoefficientId
  tenantName: string | null
  categoryName: string | null
  coefficient: number | string | null
  status: FinanceSaleAllocationCoefficientStatus
  updateTime: string | number | null
}

export type FinanceSaleAllocationCoefficientDetail = {
  id: FinanceSaleAllocationCoefficientId
  tenantName: string | null
  categoryName: string | null
  coefficient: number | string | null
}

export type FinanceSaleAllocationCoefficientCreateDraft = {
  productGroupId: FinanceSaleAllocationCoefficientId
  categoryId: FinanceSaleAllocationCoefficientId[]
  coefficient: number
}

export type FinanceSaleAllocationCoefficientCreatePayload = FinanceSaleAllocationCoefficientCreateDraft

export type FinanceSaleAllocationCoefficientStatusPayload = {
  id: FinanceSaleAllocationCoefficientId
  status: FinanceSaleAllocationCoefficientStatus
}

export type FinanceSaleAllocationCoefficientPreparedStatus = {
  draft: FinanceSaleAllocationCoefficientStatusPayload
  previous: FinanceSaleAllocationCoefficientStatusPayload
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSaleAllocationCoefficientId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function optionalIdOf (value: unknown, label: string): FinanceSaleAllocationCoefficientId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function idListOf (value: unknown, label: string): FinanceSaleAllocationCoefficientId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空数组`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(result.map(String)).size !== result.length) throw new Error(`${label}不能包含重复ID`)
  return result
}

function statusOf (value: unknown, label = 'status'): FinanceSaleAllocationCoefficientStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function coefficientOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 10000 || Math.abs(value - Math.round(value * 100) / 100) > 1e-9) {
      throw new Error(`${label}必须为0至10000且最多两位小数的数字`)
    }
    return value
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,3}(?:\.\d{1,2})?|10000(?:\.0{1,2})?)$/.test(value)) return value
  throw new Error(`${label}必须为0至10000且最多两位小数的数字`)
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

function queryOf (query: FinanceSaleAllocationCoefficientQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  if (source.tenantName !== undefined && source.tenantName !== null && typeof source.tenantName !== 'string') throw new Error('tenantName必须为字符串或null')
  const result: Record<string, unknown> = {
    order: '',
    orderField: '',
    unit: null,
    allocateOrg: '',
    ruleType: null,
    expenseType: null,
    indicator: null,
    status: statusOf(source.status ?? 1),
  }
  if (source.tenantName !== undefined) result.tenantName = source.tenantName
  if (source.productGroupId !== undefined) result.productGroupId = optionalIdOf(source.productGroupId, 'productGroupId')
  if (source.categoryId !== undefined) result.categoryId = optionalIdOf(source.categoryId, 'categoryId')
  result.pageNo = pageNumberOf(source.pageNo, 1, 'pageNo')
  result.pageSize = pageNumberOf(source.pageSize, 20, 'pageSize')
  return result
}

function rowOf (value: unknown): FinanceSaleAllocationCoefficientRow {
  const row = objectOf(value, '销售分配系数列表行')
  return {
    id: idOf(row.id, '销售分配系数id'),
    tenantName: textOf(row.tenantName, 'tenantName'),
    categoryName: textOf(row.categoryName, 'categoryName'),
    coefficient: coefficientOf(row.coefficient, 'coefficient'),
    status: statusOf(row.status),
    updateTime: dateTimeOf(row.updateTime, 'updateTime'),
  }
}

function detailOf (value: unknown): FinanceSaleAllocationCoefficientDetail | null {
  if (value === null || value === undefined) return null
  const row = objectOf(value, '销售分配系数详情')
  return {
    id: idOf(row.id, '销售分配系数id'),
    tenantName: textOf(row.tenantName, 'tenantName'),
    categoryName: textOf(row.categoryName, 'categoryName'),
    coefficient: coefficientOf(row.coefficient, 'coefficient'),
  }
}

function createPayloadOf (input: FinanceSaleAllocationCoefficientCreateDraft): FinanceSaleAllocationCoefficientCreatePayload {
  const value = objectOf(input, '创建销售分配系数输入')
  return {
    productGroupId: idOf(value.productGroupId, 'productGroupId'),
    categoryId: idListOf(value.categoryId, 'categoryId'),
    coefficient: coefficientOf(value.coefficient, 'coefficient') as number,
  }
}

function statusPayloadOf (input: unknown, label: string): FinanceSaleAllocationCoefficientStatusPayload {
  const value = objectOf(input, label)
  return { id: idOf(value.id, `${label}.id`), status: statusOf(value.status, `${label}.status`) }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createFinanceSettingSaleAllocationCoefficientCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSaleAllocationCoefficientQuery = {}): Promise<PageResult<FinanceSaleAllocationCoefficientRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('销售分配系数分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (input: { id: FinanceSaleAllocationCoefficientId }): Promise<FinanceSaleAllocationCoefficientDetail | null> {
      const id = idOf(input?.id, '销售分配系数id')
      const result = await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id } })
      return detailOf(result)
    },

    prepareCreate (input: FinanceSaleAllocationCoefficientCreateDraft): { draft: FinanceSaleAllocationCoefficientCreatePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceSaleAllocationCoefficientCreateDraft): Promise<FinanceSaleAllocationCoefficientId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: createPayloadOf(input) })
      return idOf(result, '创建销售分配系数返回的id')
    },

    prepareSetStatus (input: { current: FinanceSaleAllocationCoefficientRow; targetStatus: FinanceSaleAllocationCoefficientStatus }): FinanceSaleAllocationCoefficientPreparedStatus {
      const current = statusPayloadOf(input?.current, '启停销售分配系数当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { id: current.id, status: targetStatus }, previous: current }
    },

    async setStatus (input: { draft: FinanceSaleAllocationCoefficientStatusPayload }): Promise<true> {
      const draft = statusPayloadOf(input?.draft, '销售分配系数启停输入')
      const result = await request<unknown>({ url: `${ROOT}/update-status`, method: 'put', data: draft })
      return trueResult(result, '销售分配系数启停')
    },
  }
}

export type FinanceSettingSaleAllocationCoefficientCapability = ReturnType<typeof createFinanceSettingSaleAllocationCoefficientCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const statusParam: ParamSpec = { name: 'status', kind: 'enum', required: false, description: '绝对状态：0停用，1启用；页面默认1', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] }

export const FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS = {
  'finance-setting-sale-allocation-coefficient-list': 'list',
  'finance-setting-sale-allocation-coefficient-get': 'get',
  'finance-setting-sale-allocation-coefficient-prepare-create': 'prepareCreate',
  'finance-setting-sale-allocation-coefficient-create': 'create',
  'finance-setting-sale-allocation-coefficient-prepare-set-status': 'prepareSetStatus',
  'finance-setting-sale-allocation-coefficient-set-status': 'setStatus',
} as const

const listParams: ParamSpec[] = [
  p('tenantName', 'text', false, '租户名称前缀；页面输入框值'),
  p('productGroupId', 'text', false, '产品组ID；页面字典选择值'),
  p('categoryId', 'text', false, '分类ID；页面分类树选择值'),
  statusParam,
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '当前页条数；页面默认20'),
]

const createParams: ParamSpec[] = [
  p('productGroupId', 'text', true, '产品组ID；页面表单校验要求必填，不能用产品组名称代替'),
  p('categoryId', 'text', true, '分类ID数组；页面多选分类树，至少一项且不能重复'),
  p('coefficient', 'number', true, '统计指标系数；0至10000，最多两位小数'),
]

export const financeSettingSaleAllocationCoefficientCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-sale-allocation-coefficient-list', title: '查询销售分配系数', write: false, params: listParams },
  { id: 'finance-setting-sale-allocation-coefficient-get', title: '查询销售分配系数详情', write: false, params: [p('id', 'text', true, '销售分配系数主记录ID')] },
  { id: 'finance-setting-sale-allocation-coefficient-prepare-create', title: '准备创建销售分配系数', write: false, params: createParams },
  { id: 'finance-setting-sale-allocation-coefficient-create', title: '创建销售分配系数', write: true, params: createParams },
  { id: 'finance-setting-sale-allocation-coefficient-prepare-set-status', title: '准备启停销售分配系数', write: false, params: [p('current', 'text', true, '来自最新列表的完整行'), { ...statusParam, name: 'targetStatus', required: true, description: '与当前状态相反的绝对目标状态' }] },
  { id: 'finance-setting-sale-allocation-coefficient-set-status', title: '启停销售分配系数', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{ id, status }')] },
].map(definition => ({ ...definition, pagePath: FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH, permission: '/dashboard/finance/setting/sale-allocation-coefficient', moduleType: null, httpInstance: 'platform' }))
