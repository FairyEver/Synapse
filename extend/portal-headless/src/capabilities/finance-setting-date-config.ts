import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「财务设置 → 支付计划时间管理」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_DATE_CONFIG_PAGE_PATH = '/dashboard/finance/setting/date-config/list'
const ROOT = '/admin-api/finance/payment-plan-time-management'

export type FinanceSettingDateConfigId = string | number
export type FinanceSettingDateConfigStatus = 0 | 1
export type FinanceSettingDateConfigTimeDimension = '1' | '2' | '3'
export type FinanceSettingDateConfigWeekRange = [string, string]

export type FinanceSettingDateConfigQuery = {
  tenantName?: string | null
  yearMonth?: string | null
  status?: FinanceSettingDateConfigStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingDateConfigWeek = {
  weekName: string
  startDate: string
  endDate: string
}

export type FinanceSettingDateConfigRow = {
  id: FinanceSettingDateConfigId
  tenantName: string
  yearMonth: string
  timeDimensionName: string
  weekList: FinanceSettingDateConfigWeek[] | null
  status: FinanceSettingDateConfigStatus
  updateTime: string | number | null
}

export type FinanceSettingDateConfigCreateInput = {
  yearMonth: string
  timeDimension: FinanceSettingDateConfigTimeDimension
  weekList?: FinanceSettingDateConfigWeekRange[]
}

export type FinanceSettingDateConfigWeekPayload = {
  weekName: string
  weekNumber: number
  startDate: string
  endDate: string
}

export type FinanceSettingDateConfigCreatePayload = {
  status: 1
  yearMonth: string
  timeDimension: FinanceSettingDateConfigTimeDimension
  weekList: FinanceSettingDateConfigWeekPayload[]
}

export type FinanceSettingDateConfigStatusInput = {
  id: FinanceSettingDateConfigId
  currentStatus: FinanceSettingDateConfigStatus
  status: FinanceSettingDateConfigStatus
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function hasOwn (value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function idOf (value: unknown, label: string): FinanceSettingDateConfigId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  }
  return value
}

function statusOf (value: unknown, label = 'status'): FinanceSettingDateConfigStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function timeDimensionOf (value: unknown): FinanceSettingDateConfigTimeDimension {
  if (value !== '1' && value !== '2' && value !== '3') {
    throw new Error('timeDimension只能是字符串1（日）、2（周）或3（月）')
  }
  return value
}

function validYearMonth (value: string, label: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  const month = Number(value.slice(5))
  if (month < 1 || month > 12) throw new Error(`${label}不是有效年月`)
  return value
}

function currentYearMonth (now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find(item => item.type === 'year')?.value
  const month = parts.find(item => item.type === 'month')?.value
  if (!year || !month) throw new Error('无法计算门户当前年月')
  return `${year}-${month}`
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value as number
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label}必须为YYYY-MM-DD`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return value
}

function weekRangesOf (
  value: unknown,
  yearMonth: string,
): FinanceSettingDateConfigWeekRange[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('周维度至少保留一个周')
  const ranges = value.map((item, index) => {
    if (!Array.isArray(item) || item.length !== 2) throw new Error(`weekList[${index}]必须是起止日期数组`)
    const startDate = dateOf(item[0], `weekList[${index}][0]`)
    const endDate = dateOf(item[1], `weekList[${index}][1]`)
    if (startDate.slice(0, 7) !== yearMonth || endDate.slice(0, 7) !== yearMonth) {
      throw new Error(`weekList[${index}]必须在yearMonth所属月份内`)
    }
    if (startDate > endDate) throw new Error(`weekList[${index}]开始日期不能大于结束日期`)
    return [startDate, endDate] as FinanceSettingDateConfigWeekRange
  })
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      if (ranges[i]![0] <= ranges[j]![1] && ranges[j]![0] <= ranges[i]![1]) {
        throw new Error(`weekList[${i}]与weekList[${j}]日期重复`)
      }
    }
  }
  return ranges
}

function createPayloadOf (
  input: FinanceSettingDateConfigCreateInput,
  now: () => Date,
): FinanceSettingDateConfigCreatePayload {
  const normalized = createInputOf(input, now)
  return {
    status: 1,
    yearMonth: normalized.yearMonth,
    timeDimension: normalized.timeDimension,
    weekList: normalized.weekList.map(([startDate, endDate], index) => ({
      weekName: `第${index + 1}周`,
      weekNumber: index + 1,
      startDate,
      endDate,
    })),
  }
}

function createInputOf (
  input: FinanceSettingDateConfigCreateInput,
  now: () => Date,
): FinanceSettingDateConfigCreateInput & { weekList: FinanceSettingDateConfigWeekRange[] } {
  const value = objectOf(input, '支付计划时间管理创建输入')
  if (hasOwn(value, 'status') && value.status !== 1) throw new Error('创建status只能为1（启用）')
  if (typeof value.yearMonth !== 'string') throw new Error('yearMonth必须为字符串')
  const yearMonth = validYearMonth(value.yearMonth, 'yearMonth')
  if (yearMonth < currentYearMonth(now())) throw new Error('yearMonth不能早于当前月份')
  const timeDimension = timeDimensionOf(value.timeDimension)
  const ranges = timeDimension === '2' ? weekRangesOf(value.weekList, yearMonth) : []
  return {
    yearMonth,
    timeDimension,
    weekList: ranges,
  }
}

function nullableDateTimeOf (value: unknown, label: string): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数值或null`)
}

function weekOf (value: unknown, label: string): FinanceSettingDateConfigWeek {
  const row = objectOf(value, label)
  if (typeof row.weekName !== 'string') throw new Error(`${label}.weekName必须为字符串`)
  return {
    weekName: row.weekName,
    startDate: dateOf(row.startDate, `${label}.startDate`),
    endDate: dateOf(row.endDate, `${label}.endDate`),
  }
}

function rowOf (value: unknown): FinanceSettingDateConfigRow {
  const row = objectOf(value, '支付计划时间管理列表行')
  let weekList: FinanceSettingDateConfigWeek[] | null = null
  if (row.weekList !== null && row.weekList !== undefined) {
    if (!Array.isArray(row.weekList)) throw new Error('weekList必须是数组或null')
    weekList = row.weekList.map((item, index) => weekOf(item, `weekList[${index}]`))
  }
  if (typeof row.tenantName !== 'string') throw new Error('tenantName必须为字符串')
  if (typeof row.yearMonth !== 'string') throw new Error('yearMonth必须为字符串')
  if (typeof row.timeDimensionName !== 'string') throw new Error('timeDimensionName必须为字符串')
  return {
    id: idOf(row.id, '支付计划时间管理id'),
    tenantName: row.tenantName,
    yearMonth: validYearMonth(row.yearMonth, '列表行yearMonth'),
    timeDimensionName: row.timeDimensionName,
    weekList,
    status: statusOf(row.status),
    updateTime: nullableDateTimeOf(row.updateTime, 'updateTime'),
  }
}

function queryOf (query: FinanceSettingDateConfigQuery, now: () => Date): Record<string, unknown> {
  const value = query ?? {}
  if (value.tenantName !== undefined && value.tenantName !== null && typeof value.tenantName !== 'string') {
    throw new Error('tenantName必须为字符串或null')
  }
  const yearMonth = value.yearMonth === undefined
    ? currentYearMonth(now())
    : value.yearMonth === null || value.yearMonth === ''
      ? ''
      : validYearMonth(value.yearMonth, 'yearMonth')
  return {
    order: '',
    orderField: '',
    tenantName: value.tenantName ?? '',
    yearMonth,
    status: statusOf(value.status ?? 1),
    pageNo: pageNumberOf(value.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize, 20, 'pageSize'),
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_DATE_CONFIG_PAGE_PATH. */
export function createFinanceSettingDateConfigCapability (
  request: PortalRequest,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date())
  return {
    async list (query: FinanceSettingDateConfigQuery = {}): Promise<PageResult<FinanceSettingDateConfigRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryOf(query, now),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('支付计划时间管理分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    prepareCreate (input: FinanceSettingDateConfigCreateInput): { draft: FinanceSettingDateConfigCreateInput & { weekList: FinanceSettingDateConfigWeekRange[] } } {
      return { draft: createInputOf(input, now) }
    },

    async create (input: FinanceSettingDateConfigCreateInput): Promise<FinanceSettingDateConfigId> {
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: createPayloadOf(input, now),
      })
      return idOf(result, '新建支付计划时间管理返回的id')
    },

    async setStatus (input: FinanceSettingDateConfigStatusInput): Promise<true> {
      const value = objectOf(input, '支付计划时间管理启停输入')
      const id = idOf(value.id, '支付计划时间管理id')
      const currentStatus = statusOf(value.currentStatus, 'currentStatus')
      const status = statusOf(value.status)
      if (status === currentStatus) throw new Error('目标status必须与列表当前status相反')
      const data = new FormData()
      data.append('id', String(id))
      data.append('status', String(status))
      const result = await request<unknown>({
        url: `${ROOT}/update-status`,
        method: 'post',
        data,
      })
      return trueResult(result, '支付计划时间管理启停')
    },
  }
}

export type FinanceSettingDateConfigCapability = ReturnType<typeof createFinanceSettingDateConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const timeDimensionOptions = [{ label: '日', value: '1' }, { label: '周', value: '2' }, { label: '月', value: '3' }]
const createParams: ParamSpec[] = [
  p('yearMonth', 'date', true, '所属年月，YYYY-MM，不能早于当前月份'),
  { ...p('timeDimension', 'enum', true, '提报时间维度；Portal字典值是字符串'), options: timeDimensionOptions },
  p('weekList', 'text', false, '周维度的日期范围数组；timeDimension为2时必填，非周维度忽略'),
]

export const FINANCE_SETTING_DATE_CONFIG_METHODS = {
  'finance-setting-date-config-list': 'list',
  'finance-setting-date-config-prepare-create': 'prepareCreate',
  'finance-setting-date-config-create': 'create',
  'finance-setting-date-config-set-status': 'setStatus',
} as const

export const financeSettingDateConfigCapabilities: CapabilityDefinition[] = [
  {
    id: 'finance-setting-date-config-list',
    title: '查询支付计划时间管理',
    write: false,
    params: [
      p('tenantName', 'text', false, '所属租户名称包含筛选；默认空字符串'),
      p('yearMonth', 'date', false, '所属年月YYYY-MM；省略默认当前月份，传空字符串表示不按年月筛选'),
      { ...p('status', 'enum', false, '状态；默认1启用'), options: statusOptions },
      p('pageNo', 'number', false, '从1开始的页码；默认1'),
      p('pageSize', 'number', false, '当前页条数；默认20，只支持10、20、50、100'),
    ],
  },
  {
    id: 'finance-setting-date-config-prepare-create',
    title: '准备新增支付计划时间配置',
    write: false,
    params: createParams,
  },
  {
    id: 'finance-setting-date-config-create',
    title: '新增支付计划时间配置',
    write: true,
    params: createParams,
  },
  {
    id: 'finance-setting-date-config-set-status',
    title: '启用或停用支付计划时间配置',
    write: true,
    params: [
      p('id', 'text', true, '支付计划时间管理主键ID，来自当前列表行'),
      { ...p('currentStatus', 'enum', true, '当前列表行绝对状态'), options: statusOptions },
      { ...p('status', 'enum', true, '目标绝对状态，必须与currentStatus相反'), options: statusOptions },
    ],
  },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_DATE_CONFIG_PAGE_PATH,
  permission: '/dashboard/finance/setting/date-config',
  moduleType: null,
  httpInstance: 'platform' as const,
}))
