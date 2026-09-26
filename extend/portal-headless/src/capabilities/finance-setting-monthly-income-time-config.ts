import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal 财务设置 / 月度收入时间配置；静态锚点 frontend d3cf56bdc7、Java dcb3f36019。 */
export const FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH = '/dashboard/finance/setting/monthly-income-time-config/list'
const ROOT = '/admin-api/finance/monthly-income-budget-edit-config'

export type FinanceMonthlyIncomeTimeConfigId = string | number
export type FinanceMonthlyIncomeTimeConfigBizType = 1 | 2 | 3 | 4

export type FinanceMonthlyIncomeTimeConfigQuery = {
  tenantId?: FinanceMonthlyIncomeTimeConfigId | null
  bizType?: FinanceMonthlyIncomeTimeConfigBizType | null
  pageNo?: number
  pageSize?: number
}

export type FinanceMonthlyIncomeTimeConfigRow = {
  id: FinanceMonthlyIncomeTimeConfigId
  bizType: FinanceMonthlyIncomeTimeConfigBizType
  lockDay: number | null
  remark: string | null
  tenantId: FinanceMonthlyIncomeTimeConfigId
}

/** 普通用户表单中的四类配置；Portal表单会把remark的null归一为空字符串。 */
export type FinanceMonthlyIncomeTimeConfigItem = {
  bizType: FinanceMonthlyIncomeTimeConfigBizType
  lockDay: number | null
  remark: string
}

export type FinanceMonthlyIncomeTimeConfigUpdateInput = {
  items: Array<{
    bizType: FinanceMonthlyIncomeTimeConfigBizType
    lockDay: number
    remark?: string | null
  }>
}

export type FinanceMonthlyIncomeTimeConfigUpdatePayload = {
  items: Array<{
    bizType: FinanceMonthlyIncomeTimeConfigBizType
    lockDay: number
    remark: string
  }>
}

const BIZ_TYPES: readonly FinanceMonthlyIncomeTimeConfigBizType[] = [1, 2, 3, 4]

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): FinanceMonthlyIncomeTimeConfigId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  }
  return value
}

function bizTypeOf (value: unknown, label = 'bizType'): FinanceMonthlyIncomeTimeConfigBizType {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) {
    throw new Error(`${label}只能是数值1、2、3或4`)
  }
  return value
}

function nullableLockDayOf (value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  return lockDayOf(value, label)
}

function lockDayOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 31) {
    throw new Error(`${label}必须是1至31的整数`)
  }
  return Number(value)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function queryParamsOf (query: FinanceMonthlyIncomeTimeConfigQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  const tenantId = source.tenantId === undefined || source.tenantId === null
    ? source.tenantId
    : idOf(source.tenantId, 'tenantId')
  const bizType = source.bizType === undefined || source.bizType === null
    ? source.bizType
    : bizTypeOf(source.bizType)
  return {
    order: '',
    orderField: '',
    tenantId,
    bizType,
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FinanceMonthlyIncomeTimeConfigRow {
  const row = objectOf(value, '月度收入时间配置列表行')
  return {
    id: idOf(row.id, '月度收入时间配置id'),
    bizType: bizTypeOf(row.bizType),
    lockDay: nullableLockDayOf(row.lockDay, 'lockDay'),
    remark: nullableTextOf(row.remark, 'remark'),
    tenantId: idOf(row.tenantId, 'tenantId'),
  }
}

function getItemsOf (value: unknown): FinanceMonthlyIncomeTimeConfigItem[] {
  const rawValue = value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : objectOf(value, '月度收入时间配置读取响应').items ?? []
  const rawItems = rawValue
  if (!Array.isArray(rawItems)) throw new Error('月度收入时间配置读取响应必须是数组或包含items数组的对象')

  return BIZ_TYPES.map(bizType => {
    const raw = rawItems.find(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      return Number((item as Record<string, unknown>).bizType) === bizType
    })
    if (raw === undefined) return { bizType, lockDay: null, remark: '' }
    const item = objectOf(raw, '月度收入时间配置表单项')
    return {
      bizType,
      lockDay: nullableLockDayOf(item.lockDay, `bizType=${bizType}的lockDay`),
      remark: formTextOf(item.remark, `bizType=${bizType}的remark`),
    }
  })
}

function updatePayloadOf (input: FinanceMonthlyIncomeTimeConfigUpdateInput): FinanceMonthlyIncomeTimeConfigUpdatePayload {
  const value = objectOf(input, '月度收入时间配置更新输入')
  if (!Array.isArray(value.items) || value.items.length !== BIZ_TYPES.length) {
    throw new Error('月度收入时间配置items必须包含业务类型1、2、3、4各一项')
  }
  const byType = new Map<FinanceMonthlyIncomeTimeConfigBizType, FinanceMonthlyIncomeTimeConfigUpdatePayload['items'][number]>()
  for (const [index, raw] of value.items.entries()) {
    const item = objectOf(raw, `items[${index}]`)
    const bizType = bizTypeOf(item.bizType, `items[${index}].bizType`)
    if (byType.has(bizType)) throw new Error(`items不能重复业务类型${bizType}`)
    byType.set(bizType, {
      bizType,
      lockDay: lockDayOf(item.lockDay, `items[${index}].lockDay`),
      remark: formTextOf(item.remark, `items[${index}].remark`),
    })
  }
  if (byType.size !== BIZ_TYPES.length) throw new Error('items必须覆盖业务类型1、2、3、4')
  return { items: BIZ_TYPES.map(bizType => byType.get(bizType)!) }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH. */
export function createFinanceSettingMonthlyIncomeTimeConfigCapability (request: PortalRequest) {
  return {
    async list (query: FinanceMonthlyIncomeTimeConfigQuery = {}): Promise<PageResult<FinanceMonthlyIncomeTimeConfigRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryParamsOf(query),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('月度收入时间配置分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (): Promise<FinanceMonthlyIncomeTimeConfigItem[]> {
      const result = await request<unknown>({
        url: `${ROOT}/get`,
        method: 'get',
      })
      return getItemsOf(result)
    },

    async update (input: FinanceMonthlyIncomeTimeConfigUpdateInput): Promise<true> {
      const payload = updatePayloadOf(input)
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: payload,
      })
      return trueResult(result, '保存月度收入时间配置')
    },
  }
}

export type FinanceSettingMonthlyIncomeTimeConfigCapability = ReturnType<typeof createFinanceSettingMonthlyIncomeTimeConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const bizTypeParam: ParamSpec = {
  name: 'bizType',
  kind: 'enum',
  required: false,
  description: '业务类型：1主营资金、2主营预测、3其他资金、4其他预测',
  options: [
    { value: 1, label: '月度收入预算（资金）' },
    { value: 2, label: '月度收入预算（预测）' },
    { value: 3, label: '其他资金流入预算（资金）' },
    { value: 4, label: '其他资金流入预算（预测）' },
  ],
}

const listParams: ParamSpec[] = [
  p('tenantId', 'text', false, '平台管理员列表按租户ID筛选'),
  bizTypeParam,
  p('pageNo', 'number'),
  p('pageSize', 'number'),
]

const updateParams: ParamSpec[] = [
  p('items', 'text', true, '四类月度收入填报截止配置数组；每类一项，lockDay为1至31'),
]

export const FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHODS = {
  'finance-setting-monthly-income-time-config-list': 'list',
  'finance-setting-monthly-income-time-config-get': 'get',
  'finance-setting-monthly-income-time-config-update': 'update',
} as const

export const financeSettingMonthlyIncomeTimeConfigCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-monthly-income-time-config-list', title: '查询月度收入时间配置列表', write: false, params: listParams },
  { id: 'finance-setting-monthly-income-time-config-get', title: '读取当前租户月度收入时间配置', write: false, params: [] },
  { id: 'finance-setting-monthly-income-time-config-update', title: '保存月度收入时间配置', write: true, params: updateParams },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_PAGE_PATH,
  permission: '/dashboard/finance/setting/monthly-income-time-config',
  httpInstance: 'platform',
  moduleType: null,
}))
