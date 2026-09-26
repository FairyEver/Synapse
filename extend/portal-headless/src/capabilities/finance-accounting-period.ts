import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/** Portal 会计期间页面；静态证据锚点：frontend acab69acc7、Java 0f1a55718e。 */
export const FINANCE_ACCOUNTING_PERIOD_PAGE_PATH = '/dashboard/finance/setting/accounting-period/list'
const ROOT = '/admin-api/finance/accounting-period'

export type FinanceAccountingPeriodId = string | number
export type FinanceAccountingPeriodStatus = 0 | 1

export type FinanceAccountingPeriodQuery = {
  year?: string
  tenantName?: string | null
  status?: FinanceAccountingPeriodStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceAccountingPeriodRow = {
  id: FinanceAccountingPeriodId
  tenantName: string | null
  year: number
  startDate: string
  endDate: string
  status: FinanceAccountingPeriodStatus
  updateTime: string | number | null
}

export type FinanceAccountingPeriodDraft = {
  startDate: string
  endDate: string
}

export type FinanceAccountingPeriodMonth = {
  month: number
  start: string
  end: string
}

export type FinanceAccountingPeriodMonthDraft = {
  month: number
  startDate: string
  endDate: string
}

export type FinanceAccountingPeriodPayload = FinanceAccountingPeriodDraft & {
  accountingPeriodMonthList: FinanceAccountingPeriodMonthDraft[]
}

export type FinanceAccountingPeriodDetailInput = FinanceAccountingPeriodDraft
export type FinanceAccountingPeriodStatusInput = {
  id: FinanceAccountingPeriodId
  status: FinanceAccountingPeriodStatus
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown): FinanceAccountingPeriodId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('会计期间id必须为安全正整数或其十进制字符串')
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('会计期间id必须为安全正整数或其十进制字符串')
  return value
}

function statusOf (value: unknown): FinanceAccountingPeriodStatus {
  if (value !== 0 && value !== 1) throw new Error('status只能是数值0（启用）或1（停用）')
  return value
}

function dateOf (value: unknown, label: 'startDate' | 'endDate'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return value
}

function portalYear (now: Date): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(now)
  const year = Number(value)
  if (!Number.isInteger(year)) throw new Error('无法计算门户当前年度')
  return year
}

function rangeOf (input: FinanceAccountingPeriodDraft, minimumYear?: number): FinanceAccountingPeriodDraft {
  const startDate = dateOf(input?.startDate, 'startDate')
  const endDate = dateOf(input?.endDate, 'endDate')
  const startYear = Number(startDate.slice(0, 4))
  if (minimumYear !== undefined && startYear < minimumYear) throw new Error('startDate不能早于门户当前年度')
  if (endDate.slice(0, 4) !== startDate.slice(0, 4)) throw new Error('endDate必须与startDate属于同一年')
  if (endDate < startDate) throw new Error('endDate不能早于startDate')
  return { startDate, endDate }
}

function endOfMonth (year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 逐字复刻 PC 创建页与详情页的 12 行月度期间生成规则。 */
export function buildFinanceAccountingPeriodMonths (
  input: FinanceAccountingPeriodDraft,
): FinanceAccountingPeriodMonth[] {
  const { startDate, endDate } = rangeOf(input)
  const year = Number(startDate.slice(0, 4))
  const startMonth = Number(startDate.slice(5, 7))
  const endMonth = Number(endDate.slice(5, 7))
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const start = startMonth === month
      ? startDate
      : startMonth < month && endMonth >= month
        ? `${year}-${String(month).padStart(2, '0')}-01`
        : ''
    const end = endMonth === month
      ? endDate
      : startMonth <= month && endMonth > month
        ? endOfMonth(year, month)
        : ''
    return { month, start, end }
  })
}

export function buildFinanceAccountingPeriodPayload (
  input: FinanceAccountingPeriodDraft,
  minimumYear: number,
): FinanceAccountingPeriodPayload {
  const draft = rangeOf(input, minimumYear)
  return {
    ...draft,
    accountingPeriodMonthList: buildFinanceAccountingPeriodMonths(draft).map(({ month, start, end }) => ({
      month,
      startDate: start,
      endDate: end,
    })),
  }
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function yearQueryOf (value: string | undefined): string {
  if (value === undefined || value === '') return ''
  if (!/^\d{4}$/.test(value)) throw new Error('year必须为YYYY或空字符串')
  return value
}

function tenantNameOf (value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('tenantName必须为字符串或null')
  return value
}

function rowOf (value: unknown): FinanceAccountingPeriodRow {
  const row = objectOf(value, '会计期间列表行')
  const year = row.year
  if (!Number.isInteger(year) || Number(year) < 1000 || Number(year) > 9999) throw new Error('会计期间列表行year必须为四位整数')
  const updateTime = row.updateTime
  if (updateTime !== null && updateTime !== undefined && typeof updateTime !== 'string' && (typeof updateTime !== 'number' || !Number.isFinite(updateTime))) {
    throw new Error('会计期间列表行updateTime必须为字符串、有限数值或null')
  }
  if (row.tenantName !== null && row.tenantName !== undefined && typeof row.tenantName !== 'string') {
    throw new Error('会计期间列表行tenantName必须为字符串或null')
  }
  return {
    id: idOf(row.id),
    tenantName: row.tenantName == null ? null : row.tenantName,
    year: Number(year),
    startDate: dateOf(row.startDate, 'startDate'),
    endDate: dateOf(row.endDate, 'endDate'),
    status: statusOf(row.status),
    updateTime: updateTime == null ? null : updateTime,
  }
}

export function createFinanceAccountingPeriodCapability (
  request: PortalRequest,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date())
  const payloadOf = (input: FinanceAccountingPeriodDraft) => buildFinanceAccountingPeriodPayload(input, portalYear(now()))
  return {
    async list (query: FinanceAccountingPeriodQuery = {}): Promise<PageResult<FinanceAccountingPeriodRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
          year: yearQueryOf(query.year),
          tenantName: tenantNameOf(query.tenantName),
          status: statusOf(query.status ?? 0),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('会计期间分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    detail (input: FinanceAccountingPeriodDetailInput): { list: FinanceAccountingPeriodMonth[] } {
      return { list: buildFinanceAccountingPeriodMonths(input) }
    },

    prepareCreate (input: FinanceAccountingPeriodDraft): { draft: FinanceAccountingPeriodPayload } {
      return { draft: payloadOf(input) }
    },

    async create (input: FinanceAccountingPeriodDraft): Promise<FinanceAccountingPeriodId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input) }))
    },

    async setStatus (input: FinanceAccountingPeriodStatusInput): Promise<null> {
      const result = await request<unknown>({
        url: `${ROOT}/enableOrStop`,
        method: 'get',
        params: { id: idOf(input?.id), status: statusOf(input?.status) },
      })
      if (result !== null) throw new Error('会计期间启停成功响应必须为null')
      return null
    },
  }
}

export type FinanceAccountingPeriodCapability = ReturnType<typeof createFinanceAccountingPeriodCapability>
export type FinanceAccountingPeriodCapabilityWithIdempotency = FinanceAccountingPeriodCapability & {
  createIdempotent: (
    input: FinanceAccountingPeriodDraft & { requestId: string },
  ) => Promise<FinanceAccountingPeriodId>
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const dateParams = [p('startDate', 'date', true, '会计期间启用日期，YYYY-MM-DD'), p('endDate', 'date', true, '同年的结束日期，YYYY-MM-DD')]
const statusParam = (required = false): ParamSpec => ({
  name: 'status', kind: 'enum', required,
  description: '绝对状态：0启用，1停用',
  options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }],
})

export const FINANCE_ACCOUNTING_PERIOD_METHODS = {
  'finance-accounting-period-list': 'list',
  'finance-accounting-period-detail': 'detail',
  'finance-accounting-period-prepare-create': 'prepareCreate',
  'finance-accounting-period-create': 'createIdempotent',
  'finance-accounting-period-set-status': 'setStatus',
} as const

export const financeAccountingPeriodCapabilities: CapabilityDefinition[] = [
  { id: 'finance-accounting-period-list', title: '查询会计期间', write: false, params: [p('year', 'date'), p('tenantName', 'text'), statusParam(), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-accounting-period-detail', title: '查看会计期间月度明细', write: false, params: dateParams },
  { id: 'finance-accounting-period-prepare-create', title: '生成会计期间月度草稿', write: false, params: dateParams },
  { id: 'finance-accounting-period-create', title: '创建会计期间', write: true, params: [...dateParams, p('requestId', 'text', true, 'SDK本地防重键；同一创建意图重试复用')] },
  { id: 'finance-accounting-period-set-status', title: '启用或停用会计期间', write: true, params: [p('id', 'text', true), statusParam(true)] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_ACCOUNTING_PERIOD_PAGE_PATH,
  permission: '/dashboard/finance/setting/accounting-period',
  moduleType: null,
  httpInstance: 'platform' as const,
}))
