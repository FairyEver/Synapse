import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 系统核算参数」当前可达的只读分页。 */
export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH = '/dashboard/setting/system-accounting-parameters/list'
export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PERMISSION = '/dashboard/setting/system-accounting-parameters'
export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_MODULE_TYPE = null

const ROOT = '/salary/parameter'

export type SettingSystemAccountingParametersId = string | number

export type SettingSystemAccountingParametersQuery = {
  query1?: string | null
  pageNo?: number
  pageSize?: number
}

export type SettingSystemAccountingParametersRow = Record<string, unknown> & {
  id: SettingSystemAccountingParametersId
  name: string | null
  source: number | null
  remark: string | null
  tableName: string | null
  columnName: string | null
  staffCodeName: string | null
  filterSql: string | null
  isDel: number | null
  creator: SettingSystemAccountingParametersId | null
  createTime: string | number | null
  updater: SettingSystemAccountingParametersId | null
  updateTime: string | number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingSystemAccountingParametersId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SettingSystemAccountingParametersId | null {
  if (value === undefined || value === null) return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryOf (query: SettingSystemAccountingParametersQuery = {}): JsonObject {
  if (query.query1 !== undefined && query.query1 !== null && typeof query.query1 !== 'string') throw new Error('query1必须为字符串或null')
  return {
    order: '',
    orderField: '',
    query1: query.query1 ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label: string): SettingSystemAccountingParametersRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    source: integerOf(row.source, `${label}.source`),
    remark: textOf(row.remark, `${label}.remark`),
    tableName: textOf(row.tableName, `${label}.tableName`),
    columnName: textOf(row.columnName, `${label}.columnName`),
    staffCodeName: textOf(row.staffCodeName, `${label}.staffCodeName`),
    filterSql: textOf(row.filterSql, `${label}.filterSql`),
    isDel: integerOf(row.isDel, `${label}.isDel`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    createTime: dateOf(row.createTime, `${label}.createTime`),
    updater: nullableIdOf(row.updater, `${label}.updater`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
  }
}

/** The injected request must be bound to SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH. */
export function createSettingSystemAccountingParametersCapability (request: PortalRequest) {
  return {
    async list (query: SettingSystemAccountingParametersQuery = {}): Promise<PageResult<SettingSystemAccountingParametersRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('系统核算参数分页响应缺少有效list或total')
      }
      return { list: result.list.map((item, index) => rowOf(item, `系统核算参数列表行[${index}]`)), total: result.total }
    },
  }
}

export type SettingSystemAccountingParametersCapability = ReturnType<typeof createSettingSystemAccountingParametersCapability>

const p = (name: string, kind: ParamSpec['kind'], description: string): ParamSpec => ({ name, kind, required: false, description })

export const SETTING_SYSTEM_ACCOUNTING_PARAMETERS_METHODS = {
  'setting-system-accounting-parameters-list': 'list',
} as const

export const settingSystemAccountingParametersCapabilities: CapabilityDefinition[] = [
  { id: 'setting-system-accounting-parameters-list', title: '查询系统核算参数', write: false, params: [
    p('query1', 'text', 'Portal 页面唯一的条件1文本；页面实际发送该字段，后端分页 DTO 不声明同名筛选字段'),
    p('pageNo', 'number', '从1开始；默认1'),
    p('pageSize', 'number', '页面支持10、20、50、100；默认20'),
  ] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PAGE_PATH,
  permission: SETTING_SYSTEM_ACCOUNTING_PARAMETERS_PERMISSION,
  moduleType: SETTING_SYSTEM_ACCOUNTING_PARAMETERS_MODULE_TYPE,
  httpInstance: 'platform',
}))
