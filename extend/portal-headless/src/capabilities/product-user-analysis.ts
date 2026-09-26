import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品运营 → 业务分析 → 用户使用分析」。 */
export const PRODUCT_USER_ANALYSIS_PAGE_PATH = '/dashboard/product/operation/business/user-analysis/list'
export const PRODUCT_USER_ANALYSIS_PERMISSION = '/dashboard/frame/business/analysis'

const LIST_URL = '/use/statistics/userLogReport2'
const EXPORT_URL = '/use/statistics/userLogReport2/export'
const MENU_NAME = '用户使用分析'
const MAX_REPORT_DAYS = 1000
const EXPORT_COLUMN_HEADER = [
  ['userPermission', '用户群体'],
  ['companyName', '公司'],
  ['userPhone', '手机号'],
  ['userName', '用户名'],
  ['isUsed', '是否使用'],
  ['loginCount', '登录次数'],
  ['appUseCount', 'app使用次数'],
  ['pcUseCount', 'pc使用次数'],
  ['useDateStr', '使用日期'],
  ['useFunctionStr', '使用功能'],
  ['useRate', '日使用率'],
  ['weekUseRate', '周使用率'],
].map(([field, title]) => `${field},${title}`).join(';')

export type ProductUserAnalysisPermission = 'PS' | 'CS' | 'YS' | 'BS'
export type ProductUserAnalysisUsage = '1' | '0' | ''

export type ProductUserAnalysisQuery = {
  /** Portal用户群体多选：PS父母代、CS商品代、YS青年鸡、BS种鸡；省略或null表示全部。 */
  userPermissionList?: ProductUserAnalysisPermission[] | null
  /** Portal单选：1已使用、0未使用、空字符串全部；页面默认1。 */
  isUsed?: ProductUserAnalysisUsage
  /** 页面默认当前日期前30天；格式YYYY-MM-DD。 */
  startDate?: string
  /** 页面默认当前日期；格式YYYY-MM-DD。 */
  endDate?: string
}

export type ProductUserAnalysisRow = Record<string, unknown> & {
  userPermission: string | null
  companyName: string | null
  userName: string | null
  userPhone: string | null
  isUsed: string | null
  loginCount: number | null
  appUseCount: number | null
  pcUseCount: number | null
  useDateList: string[] | null
  useDateStr: string | null
  useFunctionList: string[] | null
  useFunctionStr: string | null
  useRate: string | null
  weekUseRate: string | null
  sort: number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数或null`)
  return value
}

function nullableTextListOf (value: unknown, label: string): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new Error(`${label}必须为字符串数组或null`)
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${label}[${index}]必须为字符串`)
    return item
  })
}

function localDateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function dayNumber (value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000
}

function today (): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function subtractDays (value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function permissionListOf (value: unknown): ProductUserAnalysisPermission[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('userPermissionList必须为数组')
  const allowed = new Set<ProductUserAnalysisPermission>(['PS', 'CS', 'YS', 'BS'])
  return value.map((item, index) => {
    if (typeof item !== 'string' || !allowed.has(item as ProductUserAnalysisPermission)) throw new Error(`userPermissionList[${index}]必须为PS、CS、YS或BS`)
    return item as ProductUserAnalysisPermission
  })
}

function usageOf (value: unknown): ProductUserAnalysisUsage {
  const resolved = value === undefined ? '1' : value
  if (resolved !== '1' && resolved !== '0' && resolved !== '') throw new Error('isUsed只能是1、0或空字符串')
  return resolved
}

function dateRangeOf (query: ProductUserAnalysisQuery): { startDate: string; endDate: string } {
  const endDate = localDateOf(query.endDate ?? today(), 'endDate')
  const startDate = localDateOf(query.startDate ?? subtractDays(endDate, 30), 'startDate')
  const span = dayNumber(endDate) - dayNumber(startDate) + 1
  if (span < 1) throw new Error('endDate不能早于startDate')
  if (span > MAX_REPORT_DAYS) throw new Error(`查询日期范围不能超过${MAX_REPORT_DAYS}天`)
  return { startDate, endDate }
}

function formOf (query: ProductUserAnalysisQuery = {}): JsonObject {
  const { startDate, endDate } = dateRangeOf(query)
  return {
    userPermissionList: permissionListOf(query.userPermissionList),
    isUsed: usageOf(query.isUsed),
    startDate,
    endDate,
    scope: 1,
    menuName: MENU_NAME,
  }
}

function exportFormOf (query: ProductUserAnalysisQuery = {}): JsonObject {
  return {
    ...formOf(query),
    columnHeader: EXPORT_COLUMN_HEADER,
  }
}

function rowOf (value: unknown, index: number): ProductUserAnalysisRow {
  const row = objectOf(value, `用户使用分析列表[${index}]`)
  return {
    ...row,
    userPermission: nullableTextOf(row.userPermission, `用户使用分析列表[${index}].userPermission`),
    companyName: nullableTextOf(row.companyName, `用户使用分析列表[${index}].companyName`),
    userName: nullableTextOf(row.userName, `用户使用分析列表[${index}].userName`),
    userPhone: nullableTextOf(row.userPhone, `用户使用分析列表[${index}].userPhone`),
    isUsed: nullableTextOf(row.isUsed, `用户使用分析列表[${index}].isUsed`),
    loginCount: nullableIntegerOf(row.loginCount, `用户使用分析列表[${index}].loginCount`),
    appUseCount: nullableIntegerOf(row.appUseCount, `用户使用分析列表[${index}].appUseCount`),
    pcUseCount: nullableIntegerOf(row.pcUseCount, `用户使用分析列表[${index}].pcUseCount`),
    useDateList: nullableTextListOf(row.useDateList, `用户使用分析列表[${index}].useDateList`),
    useDateStr: nullableTextOf(row.useDateStr, `用户使用分析列表[${index}].useDateStr`),
    useFunctionList: nullableTextListOf(row.useFunctionList, `用户使用分析列表[${index}].useFunctionList`),
    useFunctionStr: nullableTextOf(row.useFunctionStr, `用户使用分析列表[${index}].useFunctionStr`),
    useRate: nullableTextOf(row.useRate, `用户使用分析列表[${index}].useRate`),
    weekUseRate: nullableTextOf(row.weekUseRate, `用户使用分析列表[${index}].weekUseRate`),
    sort: nullableIntegerOf(row.sort, `用户使用分析列表[${index}].sort`),
  }
}

function rowsOf (value: unknown): ProductUserAnalysisRow[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('用户使用分析响应必须是数组')
  return value.map(rowOf)
}

function exportFileNameOf (value: unknown): string {
  const fileName = typeof value === 'string'
    ? value
    : value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as JsonObject).fileName === 'string'
      ? (value as JsonObject).fileName as string
      : null
  if (fileName === null || fileName.trim() === '') throw new Error('用户使用分析导出响应缺少非空fileName')
  return fileName
}

/** The injected request must use PRODUCT_USER_ANALYSIS_PAGE_PATH as its page context. */
export function createProductUserAnalysisCapability (request: PortalRequest) {
  return {
    async list (query: ProductUserAnalysisQuery = {}): Promise<ProductUserAnalysisRow[]> {
      return rowsOf(await request({ url: LIST_URL, method: 'post', data: formOf(query) }))
    },

    async export (query: ProductUserAnalysisQuery = {}): Promise<string> {
      return exportFileNameOf(await request({ url: EXPORT_URL, method: 'post', data: exportFormOf(query) }))
    },
  }
}

export type ProductUserAnalysisCapability = ReturnType<typeof createProductUserAnalysisCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

const userPermissionOptions = [
  { label: '父母代', value: 'PS' },
  { label: '商品代', value: 'CS' },
  { label: '青年鸡', value: 'YS' },
  { label: '种鸡', value: 'BS' },
]

const usageOptions = [
  { label: '是', value: '1' },
  { label: '否', value: '0' },
  { label: '全部', value: '' },
]

export const PRODUCT_USER_ANALYSIS_METHODS = {
  'product-user-analysis-list': 'list',
  'product-user-analysis-export': 'export',
} as const

export const productUserAnalysisCapabilities: CapabilityDefinition[] = [
  {
    id: 'product-user-analysis-list',
    title: '查询用户使用分析',
    write: false,
    params: [
      { ...p('userPermissionList', 'enum', false, '用户群体多选：PS父母代、CS商品代、YS青年鸡、BS种鸡；省略表示全部'), options: userPermissionOptions },
      { ...p('isUsed', 'enum', false, '是否使用：1是、0否、空字符串全部；页面默认1'), options: usageOptions },
      p('startDate', 'date', false, '开始日期，格式YYYY-MM-DD；页面默认当前日期前30天'),
      p('endDate', 'date', false, '结束日期，格式YYYY-MM-DD；页面默认当前日期'),
    ],
  },
  {
    id: 'product-user-analysis-export',
    title: '导出用户使用分析',
    write: false,
    params: [
      { ...p('userPermissionList', 'enum', false, '与列表相同的用户群体筛选；省略表示全部'), options: userPermissionOptions },
      { ...p('isUsed', 'enum', false, '与列表相同的是否使用筛选；页面默认1'), options: usageOptions },
      p('startDate', 'date', false, '与列表相同的开始日期；页面默认当前日期前30天'),
      p('endDate', 'date', false, '与列表相同的结束日期；页面默认当前日期'),
    ],
  },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_USER_ANALYSIS_PAGE_PATH,
  permission: PRODUCT_USER_ANALYSIS_PERMISSION,
  moduleType: null,
  httpInstance: 'product',
}))

export { EXPORT_COLUMN_HEADER }
