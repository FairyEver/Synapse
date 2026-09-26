import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 日清日结」。 */
export const PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH = '/dashboard/product/setting/business-manage/day-liquidation/list'
export const PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION = '/dashboard/frame/business/day-liquidation'
export const PRODUCT_SETTING_DAY_LIQUIDATION_MODULE_TYPE = null

const LIST_URL = '/base/dayLiquidation/list'
const BUILDING_LIST_URL = '/config/building/getByFarmId'
const BATCH_LIST_URL = '/base/dayLiquidation/getBatchAndSex'

export type ProductSettingDayLiquidationId = string | number
export type ProductSettingDayLiquidationType = 1 | 2 | 3 | 4 | 5

export type ProductSettingDayLiquidationQuery = {
  type: ProductSettingDayLiquidationType
  farm: ProductSettingDayLiquidationId
  building?: ProductSettingDayLiquidationId | null
  /** 页面批次下拉的 value：`${batch}__${groupId}`。 */
  businessId: string
  startDate?: string | null
  endDate?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingDayLiquidationRow = Record<string, unknown> & {
  farm: string | null
  farmName: string | null
  typeName: string | null
  recordDate: string | null
  opDate: string | null
  name: string | null
  disparityDay: number
}

export type ProductSettingDayLiquidationPage = {
  list: ProductSettingDayLiquidationRow[]
  total: number
}

export type ProductSettingDayLiquidationBuildingOption = {
  value: ProductSettingDayLiquidationId
  label: string
}

export type ProductSettingDayLiquidationBatchOption = {
  value: string
  label: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingDayLiquidationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingDayLiquidationId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function typeOf (value: unknown, label: string): ProductSettingDayLiquidationType {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value
  throw new Error(`${label}只能是1、2、3、4或5`)
}

function dateOnlyOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) throw new Error(`${label}必须为YYYY-MM-DD`)
  return value
}

function nullableDateOnlyOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateOnlyOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

/** 复刻页面 `businessId.split('__')[1]`，不要改成批次号或整段value。 */
function selectedGroupIdOf (value: unknown): string {
  const selected = requiredTextOf(value, '批次号')
  const groupId = selected.split('__')[1]
  return requiredTextOf(groupId, '批次组ID')
}

function queryOf (query: ProductSettingDayLiquidationQuery): JsonObject {
  const type = typeOf(query?.type, '类型')
  const farm = idOf(query?.farm, '场区')
  const building = nullableIdOf(query?.building, '栋号')
  const startDate = nullableDateOnlyOf(query?.startDate, '开始日期')
  const endDate = nullableDateOnlyOf(query?.endDate, '结束日期')
  return {
    order: '',
    orderField: '',
    type,
    farm,
    building,
    businessId: selectedGroupIdOf(query?.businessId),
    startDate,
    endDate,
    scope: 1,
    pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query?.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): ProductSettingDayLiquidationRow {
  const row = objectOf(value, `日清日结列表[${index}]`)
  const disparityDay = row.disparityDay
  if (!Number.isSafeInteger(disparityDay)) throw new Error(`日清日结列表[${index}].disparityDay必须为整数`)
  return {
    ...row,
    farm: nullableTextOf(row.farm, `日清日结列表[${index}].farm`),
    farmName: nullableTextOf(row.farmName, `日清日结列表[${index}].farmName`),
    typeName: nullableTextOf(row.typeName, `日清日结列表[${index}].typeName`),
    recordDate: nullableDateOnlyOf(row.recordDate, `日清日结列表[${index}].recordDate`),
    opDate: nullableDateOnlyOf(row.opDate, `日清日结列表[${index}].opDate`),
    name: nullableTextOf(row.name, `日清日结列表[${index}].name`),
    disparityDay: disparityDay as number,
  }
}

function pageOf (value: unknown): ProductSettingDayLiquidationPage {
  const envelope = objectOf(value, '日清日结分页响应')
  const page = objectOf(envelope.page ?? envelope, '日清日结分页响应.page')
  const list = page.list ?? page.records ?? page.rows
  const total = page.total ?? page.count
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('日清日结分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function listOf (value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value
  const envelope = objectOf(value, label)
  if (!Array.isArray(envelope.list)) throw new Error(`${label}缺少list数组`)
  return envelope.list
}

function buildingOptionsOf (value: unknown): ProductSettingDayLiquidationBuildingOption[] {
  return listOf(value, '日清日结栋号响应').map((item, index) => {
    const building = objectOf(item, `日清日结栋号[${index}]`)
    return {
      value: idOf(building.id, `日清日结栋号[${index}].id`),
      label: requiredTextOf(building.shortName, `日清日结栋号[${index}].shortName`),
    }
  })
}

function batchOptionsOf (value: unknown): ProductSettingDayLiquidationBatchOption[] {
  return listOf(value, '日清日结批次响应').map((item, index) => {
    const batch = objectOf(item, `日清日结批次[${index}]`)
    const batchName = requiredTextOf(batch.batch, `日清日结批次[${index}].batch`)
    const groupId = idOf(batch.groupId, `日清日结批次[${index}].groupId`)
    return { label: batchName, value: `${batchName}__${groupId}` }
  })
}

/** The injected request must use PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH as its page context. */
export function createProductSettingDayLiquidationCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingDayLiquidationQuery): Promise<ProductSettingDayLiquidationPage> {
      const params = queryOf(query)
      return pageOf(await request({ url: LIST_URL, method: 'get', params }))
    },

    async buildingList (input: { farmId: ProductSettingDayLiquidationId }): Promise<ProductSettingDayLiquidationBuildingOption[]> {
      const farmId = idOf(input?.farmId, '场区ID')
      return buildingOptionsOf(await request({ url: BUILDING_LIST_URL, method: 'get', params: { farmId } }))
    },

    async batchList (input: { type: ProductSettingDayLiquidationType; farm: ProductSettingDayLiquidationId; building?: ProductSettingDayLiquidationId | null }): Promise<ProductSettingDayLiquidationBatchOption[]> {
      const type = typeOf(input?.type, '类型')
      const farm = idOf(input?.farm, '场区')
      const building = nullableIdOf(input?.building, '栋号')
      return batchOptionsOf(await request({
        url: BATCH_LIST_URL,
        method: 'get',
        params: { farm, type, building, scope: 1 },
      }))
    },
  }
}

export type ProductSettingDayLiquidationCapability = ReturnType<typeof createProductSettingDayLiquidationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })

const typeOptions = [
  { label: '入孵', value: 1 },
  { label: '验蛋', value: 2 },
  { label: '出雏', value: 3 },
  { label: '雏鸡日记录', value: 4 },
  { label: '蛋鸡日记录', value: 5 },
]

export const PRODUCT_SETTING_DAY_LIQUIDATION_METHODS = {
  'product-setting-day-liquidation-list': 'list',
  'product-setting-day-liquidation-building-list': 'buildingList',
  'product-setting-day-liquidation-batch-list': 'batchList',
} as const

export const productSettingDayLiquidationCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-day-liquidation-list', title: '查询日清日结', write: false, params: [p('type', 'enum', true, '日清日结类型：1入孵、2验蛋、3出雏、4雏鸡日记录、5蛋鸡日记录', typeOptions), p('farm', 'text', true, '场区ID；页面表单必填'), p('building', 'text', false, '栋号ID；默认空值'), p('businessId', 'text', true, '页面批次下拉的value，格式为批次号__批次组ID；发送列表请求时只取分隔符后的批次组ID'), p('startDate', 'date', false, '开始日期；YYYY-MM-DD；默认空值'), p('endDate', 'date', false, '结束日期；YYYY-MM-DD；默认空值'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-day-liquidation-building-list', title: '查询日清日结栋号', write: false, params: [p('farmId', 'text', true, '场区ID')] },
  { id: 'product-setting-day-liquidation-batch-list', title: '查询日清日结批次号', write: false, params: [p('type', 'enum', true, '日清日结类型；决定场区选择器的typeList', typeOptions), p('farm', 'text', true, '场区ID'), p('building', 'text', false, '栋号ID；默认空值')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_DAY_LIQUIDATION_PAGE_PATH,
  permission: PRODUCT_SETTING_DAY_LIQUIDATION_PERMISSION,
  moduleType: PRODUCT_SETTING_DAY_LIQUIDATION_MODULE_TYPE,
  httpInstance: 'product',
}))
