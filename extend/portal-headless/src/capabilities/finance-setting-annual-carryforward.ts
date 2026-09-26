import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'
import type { PortalRequest } from '../session/types.js'

/** Portal 财务设置 / 年度账结转；静态锚点 frontend acab69acc7、Java 0f1a55718e。 */
export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH = '/dashboard/finance/setting/annual-carryforward/list'
const ROOT = '/admin-api/finance/annual-closing'

export type FinanceAnnualCarryforwardId = string | number
export type FinanceAnnualCarryforwardStatus = 0 | 1

export type FinanceAnnualCarryforwardQuery = {
  accountingSetIds?: FinanceAnnualCarryforwardId[]
  periodYear?: string
  closingStatus?: FinanceAnnualCarryforwardStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceAnnualCarryforwardRow = {
  /** 年度账结转记录主键；页面详情桥接使用，不能代替accountingSetId。 */
  id: FinanceAnnualCarryforwardId
  /** 后端 close/cancel-close 要求的账套主键。 */
  accountingSetId: FinanceAnnualCarryforwardId
  tenantName: string | null
  accountingName: string | null
  accountCode: string | null
  periodYear: string
  closingStatus: FinanceAnnualCarryforwardStatus
  closingTime: string | null
  closingByName: string | null
}

export type FinanceAnnualCarryforwardActionInput = {
  accountingSetIds: FinanceAnnualCarryforwardId[]
  /** 结转时省略即按Portal当前年度；取消结转必须提供。 */
  periodYear?: string | number
}

export type FinanceAnnualCarryforwardCancelInput = {
  accountingSetIds: FinanceAnnualCarryforwardId[]
  periodYear: string | number
}

export type FinanceAnnualCarryforwardPayload = {
  periodYear: number
  accountingSetIds: FinanceAnnualCarryforwardId[]
}

export type FinanceAnnualCarryforwardTransferPreparation = {
  draft: FinanceAnnualCarryforwardPayload
  fromYear: number
  toYear: number
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): FinanceAnnualCarryforwardId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  }
  return value
}

function idListOf (value: unknown, label: string, allowEmpty: boolean): FinanceAnnualCarryforwardId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (!allowEmpty && value.length === 0) throw new Error(`${label}不能为空`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  const keys = result.map(item => String(item))
  if (new Set(keys).size !== keys.length) throw new Error(`${label}不能包含重复账套ID`)
  return result
}

function statusOf (value: unknown, label = 'closingStatus'): FinanceAnnualCarryforwardStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（未结转）或1（已结转）`)
  return value
}

function yearTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new Error(`${label}必须为YYYY`)
  const year = Number(value)
  if (year < 1000 || year > 9999) throw new Error(`${label}必须为四位年份`)
  return value
}

function yearNumberOf (value: unknown, label: string): number {
  if (typeof value === 'string') return Number(yearTextOf(value, label))
  if (!Number.isSafeInteger(value) || Number(value) < 1000 || Number(value) > 9999) {
    throw new Error(`${label}必须为四位年份或YYYY字符串`)
  }
  return Number(value)
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

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function queryParamsOf (query: FinanceAnnualCarryforwardQuery, now: () => Date): Record<string, unknown> {
  const source = query ?? {}
  const accountingSetIds = source.accountingSetIds === undefined
    ? []
    : idListOf(source.accountingSetIds, 'accountingSetIds', true)
  const periodYear = source.periodYear === undefined
    ? String(portalYear(now()))
    : yearTextOf(source.periodYear, 'periodYear')
  const closingStatus = source.closingStatus === undefined ? undefined : statusOf(source.closingStatus)
  return {
    order: '',
    orderField: '',
    accountingSetIds,
    periodYear,
    closingStatus,
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 20, 'pageSize'),
  }
}

function payloadOf (
  input: FinanceAnnualCarryforwardActionInput,
  now: () => Date,
  requireYear: boolean,
): FinanceAnnualCarryforwardPayload {
  const accountingSetIds = idListOf(input?.accountingSetIds, 'accountingSetIds', false)
  const rawYear = input?.periodYear
  if (requireYear && rawYear === undefined) throw new Error('取消结转必须提供periodYear')
  const periodYear = rawYear === undefined ? portalYear(now()) : yearNumberOf(rawYear, 'periodYear')
  return { periodYear, accountingSetIds }
}

function rowOf (value: unknown): FinanceAnnualCarryforwardRow {
  const row = objectOf(value, '年度账结转列表行')
  return {
    id: idOf(row.id, '年度账结转记录id'),
    accountingSetId: idOf(row.accountingSetId, '账套id'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
    accountingName: nullableTextOf(row.accountingName, 'accountingName'),
    accountCode: nullableTextOf(row.accountCode, 'accountCode'),
    periodYear: yearTextOf(row.periodYear, 'periodYear'),
    closingStatus: statusOf(row.closingStatus),
    closingTime: nullableTextOf(row.closingTime, 'closingTime'),
    closingByName: nullableTextOf(row.closingByName, 'closingByName'),
  }
}

/**
 * 创建年度账结转页面能力。
 *
 * `now` 只用于复刻Portal在列表/批量结转弹窗里生成的当前年度，生产调用不需要传入。
 */
export function createFinanceSettingAnnualCarryforwardCapability (
  request: PortalRequest,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date())
  return {
    async list (query: FinanceAnnualCarryforwardQuery = {}): Promise<PageResult<FinanceAnnualCarryforwardRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryParamsOf(query, now),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('年度账结转分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    prepareTransfer (input: FinanceAnnualCarryforwardActionInput): FinanceAnnualCarryforwardTransferPreparation {
      const draft = payloadOf(input, now, false)
      return { draft, fromYear: draft.periodYear - 1, toYear: draft.periodYear }
    },

    async transfer (input: FinanceAnnualCarryforwardActionInput): Promise<true> {
      const payload = payloadOf(input, now, false)
      const result = await request<unknown>({
        url: `${ROOT}/close`,
        method: 'post',
        data: payload,
      })
      if (result !== true) throw new Error('年度账结转响应不是true')
      return true
    },

    async cancelTransfer (input: FinanceAnnualCarryforwardCancelInput): Promise<true> {
      const payload = payloadOf(input, now, true)
      const result = await request<unknown>({
        url: `${ROOT}/cancel-close`,
        method: 'post',
        data: payload,
      })
      if (result !== true) throw new Error('取消年度账结转响应不是true')
      return true
    },

  }
}

export type FinanceSettingAnnualCarryforwardCapability = ReturnType<typeof createFinanceSettingAnnualCarryforwardCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const idListParam = (required = false): ParamSpec => p('accountingSetIds', 'text', required, '账套ID数组；不是年度账结转记录id数组')
const yearParam = (required = false): ParamSpec => p('periodYear', 'date', required, '会计期间年份，YYYY')
const pageParams: ParamSpec[] = [
  idListParam(), yearParam(),
  { name: 'closingStatus', kind: 'enum', required: false, description: '结转状态：0未结转，1已结转', options: [{ label: '未结转', value: 0 }, { label: '已结转', value: 1 }] },
  p('pageNo', 'number'), p('pageSize', 'number'),
]

export const FINANCE_SETTING_ANNUAL_CARRYFORWARD_METHODS = {
  'finance-setting-annual-carryforward-list': 'list',
  'finance-setting-annual-carryforward-prepare-transfer': 'prepareTransfer',
  'finance-setting-annual-carryforward-transfer': 'transfer',
  'finance-setting-annual-carryforward-cancel-transfer': 'cancelTransfer',
} as const

export const financeSettingAnnualCarryforwardCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-annual-carryforward-list', title: '查询年度账结转', write: false, params: pageParams },
  { id: 'finance-setting-annual-carryforward-prepare-transfer', title: '准备年度账结转', write: false, params: [idListParam(true), yearParam()] },
  { id: 'finance-setting-annual-carryforward-transfer', title: '执行年度账结转', write: true, params: [idListParam(true), yearParam()] },
  { id: 'finance-setting-annual-carryforward-cancel-transfer', title: '取消年度账结转', write: true, params: [idListParam(true), yearParam(true)] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_ANNUAL_CARRYFORWARD_PAGE_PATH,
  permission: '/dashboard/finance/setting/annual-carryforward',
  httpInstance: 'platform',
  moduleType: null,
}))
