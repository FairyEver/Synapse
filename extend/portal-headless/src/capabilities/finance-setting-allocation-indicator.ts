import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/** 门户系统：财务设置 / 费用分配指标库。静态锚点 frontend d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_ALLOCATION_INDICATOR_PAGE_PATH = '/dashboard/finance/setting/allocation-indicator/list'
const ROOT = '/admin-api/finance/indicator-library'

export type FinanceAllocationIndicatorId = string | number
export type FinanceAllocationIndicatorStatus = 0 | 1

export type FinanceAllocationIndicatorQuery = {
  quickNumber?: string | null
  status?: FinanceAllocationIndicatorStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceAllocationIndicatorRow = {
  id: FinanceAllocationIndicatorId
  quickNumber: string | null
  abstracts: number | null
  dataSource: number | null
  instruction: string | null
  update: string | null
  status: FinanceAllocationIndicatorStatus
}

export type FinanceAllocationIndicatorStatusInput = {
  id: FinanceAllocationIndicatorId
  currentStatus: FinanceAllocationIndicatorStatus
  status: FinanceAllocationIndicatorStatus
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown): FinanceAllocationIndicatorId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('指标库ID必须为安全正整数或其十进制字符串')
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('指标库ID必须为安全正整数或其十进制字符串')
  }
  return value
}

function statusInputOf (value: unknown, label = 'status'): FinanceAllocationIndicatorStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function rowStatusOf (value: unknown): FinanceAllocationIndicatorStatus {
  if (value === false || value === 0) return 0
  if (value === true || value === 1) return 1
  throw new Error('指标库响应status必须是Boolean或数值0/1')
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  return value
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须是整数或null`)
  return value
}

function dateOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}必须为YYYY-MM-DD或null`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return value
}

function positiveIntegerOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return Number(resolved)
}

function queryOf (query: FinanceAllocationIndicatorQuery): Record<string, unknown> {
  if (query.quickNumber !== undefined && query.quickNumber !== null && typeof query.quickNumber !== 'string') {
    throw new Error('quickNumber必须为字符串或null')
  }
  return {
    order: '',
    orderField: '',
    quickNumber: query.quickNumber ?? null,
    status: statusInputOf(query.status ?? 0),
    pageNo: positiveIntegerOf(query.pageNo, 1, 'pageNo'),
    pageSize: positiveIntegerOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FinanceAllocationIndicatorRow {
  const row = objectOf(value, '费用分配指标库列表行')
  return {
    id: idOf(row.id),
    quickNumber: nullableTextOf(row.quickNumber, 'quickNumber'),
    abstracts: nullableIntegerOf(row.abstracts, 'abstracts'),
    dataSource: nullableIntegerOf(row.dataSource, 'dataSource'),
    instruction: nullableTextOf(row.instruction, 'instruction'),
    update: dateOf(row.update, 'update'),
    status: rowStatusOf(row.status),
  }
}

/** Caller injects createPageCall(FINANCE_ALLOCATION_INDICATOR_PAGE_PATH). */
export function createFinanceAllocationIndicatorCapability (request: PortalRequest) {
  return {
    async list (query: FinanceAllocationIndicatorQuery = {}): Promise<PageResult<FinanceAllocationIndicatorRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryOf(query),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('费用分配指标库分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    async setStatus (input: FinanceAllocationIndicatorStatusInput): Promise<true> {
      const id = idOf(input?.id)
      const currentStatus = statusInputOf(input?.currentStatus, 'currentStatus')
      const status = statusInputOf(input?.status)
      if (status === currentStatus) throw new Error('目标status必须与列表当前status相反')
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: { id, status },
      })
      if (result !== true) throw new Error('费用分配指标库更新响应不是true')
      return true
    },
  }
}

export type FinanceAllocationIndicatorCapability = ReturnType<typeof createFinanceAllocationIndicatorCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description ? { description } : {}),
})

const statusParam = (name: string, required: boolean): ParamSpec => ({
  name,
  kind: 'enum',
  required,
  description: '绝对状态：0启用，1停用',
  options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }],
})

export const FINANCE_ALLOCATION_INDICATOR_METHODS = {
  'finance-allocation-indicator-list': 'list',
  'finance-allocation-indicator-set-status': 'setStatus',
} as const

export const financeAllocationIndicatorCapabilities: CapabilityDefinition[] = [
  {
    id: 'finance-allocation-indicator-list',
    title: '查询费用分配指标库',
    write: false,
    params: [
      p('quickNumber', 'text', false, '指标名称包含筛选；页面默认null'),
      statusParam('status', false),
      p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
      p('pageSize', 'number', false, '当前页条数；页面默认20'),
    ],
  },
  {
    id: 'finance-allocation-indicator-set-status',
    title: '启用或停用费用分配指标',
    write: true,
    params: [
      p('id', 'text', true, '指标库主键，来自当前列表行'),
      statusParam('currentStatus', true),
      statusParam('status', true),
    ],
  },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_ALLOCATION_INDICATOR_PAGE_PATH,
  permission: '/dashboard/finance/setting/allocation-indicator',
  moduleType: null,
  httpInstance: 'platform' as const,
}))
