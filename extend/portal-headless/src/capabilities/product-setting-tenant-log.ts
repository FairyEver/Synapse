import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 使用分析 → 企业使用情况」。 */
export const PRODUCT_SETTING_TENANT_LOG_PAGE_PATH = '/dashboard/product/setting/business-manage/tenant-log/list'
export const PRODUCT_SETTING_TENANT_LOG_PERMISSION = '/dashboard/frame/job-saas/tenant-log'
export const PRODUCT_SETTING_TENANT_LOG_MODULE_TYPE = null

const COMPANY_LIST_URL = '/sys/office/getTenantCompanyList'
const FUNCTION_TREE_URL = '/config/leaf/getTree'
const USER_LIST_URL = '/sys/user'
const MODULE_LIST_URL = '/use/statistics/companyModuleUseSituation'
const FUNCTION_LIST_URL = '/use/statistics/companyFunctionUseSituation'
const USER_LIST_URL_STATISTICS = '/use/statistics/companyUserUseSituation'
const MODULE_DETAIL_URL = '/use/statistics/companyModuleUseSituationDetail'
const FUNCTION_DETAIL_URL = '/use/statistics/companyFunctionUseSituationDetail'
const USER_DETAIL_URL = '/use/statistics/companyUserUseSituationDetail'

export type ProductSettingTenantLogId = string | number
export type ProductSettingTenantLogPageType = '1' | '2' | '3'
export type ProductSettingTenantLogDeviceType = '' | 'PC' | 'APP'

export type ProductSettingTenantLogFunction = {
  module1: string
  module2: string
  module3: string
}

export type ProductSettingTenantLogQuery = {
  pageType?: ProductSettingTenantLogPageType
  companyId: ProductSettingTenantLogId
  functionList?: ProductSettingTenantLogFunction[] | null
  userIdList?: ProductSettingTenantLogId[] | null
  deviceType?: ProductSettingTenantLogDeviceType | null
  startDate?: string
  endDate?: string
}

export type ProductSettingTenantLogDetailQuery = {
  companyId: ProductSettingTenantLogId
  deviceType?: ProductSettingTenantLogDeviceType | null
  startDate?: string
  endDate?: string
}

export type ProductSettingTenantLogModuleDetailQuery = ProductSettingTenantLogDetailQuery & {
  module: string
}

export type ProductSettingTenantLogFunctionDetailQuery = ProductSettingTenantLogDetailQuery & {
  module: string
  module1: string
  module2: string
  module3: string
}

export type ProductSettingTenantLogUserDetailQuery = ProductSettingTenantLogDetailQuery & {
  userIdList: ProductSettingTenantLogId[]
  functionList: ProductSettingTenantLogFunction[]
}

export type ProductSettingTenantLogCompany = Record<string, unknown> & {
  id: ProductSettingTenantLogId
  name: string
}

export type ProductSettingTenantLogFunctionNode = Record<string, unknown> & {
  id: ProductSettingTenantLogId
  name: string
  fullName: string
  childList: ProductSettingTenantLogFunctionNode[]
}

export type ProductSettingTenantLogUser = Record<string, unknown> & {
  id: ProductSettingTenantLogId
  name: string
}

export type ProductSettingTenantLogRow = Record<string, unknown> & {
  module1: string | null
  module2: string | null
  module3: string | null
  moduleName: string | null
  functionName: string | null
  recordCount: number | null
  searchCount: number | null
  totalCount: number | null
  userId: ProductSettingTenantLogId | null
  officeName: string | null
  userName: string | null
  phone: string | null
  date: string | null
  createDate: string | null
  requestType: number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingTenantLogId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingTenantLogId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function localDateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function today (): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function subtractDays (value: string, days: number): string {
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayNumber (value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000
}

function dateRangeOf (query: { startDate?: string; endDate?: string }): { startDate: string; endDate: string } {
  const endDate = localDateOf(query.endDate ?? today(), 'endDate')
  const startDate = localDateOf(query.startDate ?? subtractDays(endDate, 30), 'startDate')
  if (dayNumber(endDate) < dayNumber(startDate)) throw new Error('endDate不能早于startDate')
  return { startDate, endDate }
}

function deviceTypeOf (value: unknown): ProductSettingTenantLogDeviceType {
  if (value === undefined || value === null || value === '') return ''
  if (value === 'PC' || value === 'APP') return value
  throw new Error('deviceType只能是PC、APP或空字符串')
}

function pageTypeOf (value: unknown): ProductSettingTenantLogPageType {
  const resolved = value ?? '1'
  if (resolved === '1' || resolved === '2' || resolved === '3') return resolved
  throw new Error('pageType只能是1、2或3')
}

function functionOf (value: unknown, label: string): ProductSettingTenantLogFunction {
  const item = objectOf(value, label)
  return {
    module1: requiredTextOf(item.module1, `${label}.module1`),
    module2: requiredTextOf(item.module2, `${label}.module2`),
    module3: requiredTextOf(item.module3, `${label}.module3`),
  }
}

function functionListOf (value: unknown, required: boolean): ProductSettingTenantLogFunction[] {
  if (value === undefined || value === null) {
    if (required) throw new Error('functionList不能为空')
    return []
  }
  if (!Array.isArray(value)) throw new Error('functionList必须为数组')
  const list = value.map((item, index) => functionOf(item, `functionList[${index}]`))
  if (required && list.length === 0) throw new Error('functionList不能为空')
  return list
}

function idListOf (value: unknown, label: string, required: boolean): ProductSettingTenantLogId[] {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`)
    return []
  }
  if (!Array.isArray(value)) throw new Error(`${label}必须为ID数组`)
  const list = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (required && list.length === 0) throw new Error(`${label}不能为空`)
  return list
}

function arrayOf (value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value
  const object = objectOf(value, label)
  if (Array.isArray(object.list)) return object.list
  if (Array.isArray(object.items)) return object.items
  throw new Error(`${label}必须为数组或包含list数组的对象`)
}

function pageOf (value: unknown, label: string): unknown[] {
  const object = objectOf(value, label)
  const page = object.page === undefined ? object : objectOf(object.page, `${label}.page`)
  if (!Array.isArray(page.list)) throw new Error(`${label}缺少list数组`)
  return page.list
}

function companyOf (value: unknown, index: number): ProductSettingTenantLogCompany {
  const row = objectOf(value, `企业列表[${index}]`)
  return { ...row, id: idOf(row.id, `企业列表[${index}].id`), name: requiredTextOf(row.name, `企业列表[${index}].name`) }
}

function companyListOf (value: unknown): ProductSettingTenantLogCompany[] {
  return arrayOf(value, '企业列表').map(companyOf)
}

function functionNodeOf (value: unknown, index: string, parent: string | null): ProductSettingTenantLogFunctionNode {
  const node = objectOf(value, `功能树${index}`)
  const name = requiredTextOf(node.name, `功能树${index}.name`)
  const fullName = parent ? `${parent}-${name}` : name
  const childList = node.childList === undefined || node.childList === null ? [] : node.childList
  if (!Array.isArray(childList)) throw new Error(`功能树${index}.childList必须为数组或null`)
  return {
    ...node,
    id: idOf(node.id, `功能树${index}.id`),
    name,
    fullName,
    childList: childList.map((item, childIndex) => functionNodeOf(item, `${index}.childList[${childIndex}]`, fullName)),
  }
}

function functionTreeOf (value: unknown): ProductSettingTenantLogFunctionNode[] {
  return arrayOf(value, '功能树').map((item, index) => functionNodeOf(item, `[${index}]`, null))
}

function userOf (value: unknown, index: number): ProductSettingTenantLogUser {
  const row = objectOf(value, `用户列表[${index}]`)
  return { ...row, id: idOf(row.id, `用户列表[${index}].id`), name: requiredTextOf(row.name, `用户列表[${index}].name`) }
}

function userListOf (value: unknown): ProductSettingTenantLogUser[] {
  return pageOf(value, '用户分页').map(userOf)
}

function rowOf (value: unknown, index: number): ProductSettingTenantLogRow {
  const row = objectOf(value, `企业使用情况列表[${index}]`)
  return {
    ...row,
    module1: textOf(row.module1, `企业使用情况列表[${index}].module1`),
    module2: textOf(row.module2, `企业使用情况列表[${index}].module2`),
    module3: textOf(row.module3, `企业使用情况列表[${index}].module3`),
    moduleName: textOf(row.moduleName, `企业使用情况列表[${index}].moduleName`),
    functionName: textOf(row.functionName, `企业使用情况列表[${index}].functionName`),
    recordCount: integerOf(row.recordCount, `企业使用情况列表[${index}].recordCount`),
    searchCount: integerOf(row.searchCount, `企业使用情况列表[${index}].searchCount`),
    totalCount: integerOf(row.totalCount, `企业使用情况列表[${index}].totalCount`),
    userId: nullableIdOf(row.userId, `企业使用情况列表[${index}].userId`),
    officeName: textOf(row.officeName, `企业使用情况列表[${index}].officeName`),
    userName: textOf(row.userName, `企业使用情况列表[${index}].userName`),
    phone: textOf(row.phone, `企业使用情况列表[${index}].phone`),
    date: textOf(row.date, `企业使用情况列表[${index}].date`),
    createDate: textOf(row.createDate, `企业使用情况列表[${index}].createDate`),
    requestType: integerOf(row.requestType, `企业使用情况列表[${index}].requestType`),
  }
}

function rowsOf (value: unknown): ProductSettingTenantLogRow[] {
  return arrayOf(value, '企业使用情况响应').map(rowOf)
}

function basePayload (query: ProductSettingTenantLogDetailQuery): JsonObject {
  const { startDate, endDate } = dateRangeOf(query)
  return {
    companyId: idOf(query.companyId, 'companyId'),
    startDate,
    endDate,
    deviceType: deviceTypeOf(query.deviceType),
  }
}

function listPayload (query: ProductSettingTenantLogQuery): { pageType: ProductSettingTenantLogPageType; data: JsonObject } {
  const pageType = pageTypeOf(query.pageType)
  const data = basePayload(query)
  if (pageType === '2' || pageType === '3') data.functionList = functionListOf(query.functionList, true)
  if (pageType === '3') data.userIdList = idListOf(query.userIdList, 'userIdList', true)
  return { pageType, data }
}

function detailPayload (query: ProductSettingTenantLogModuleDetailQuery | ProductSettingTenantLogFunctionDetailQuery): JsonObject {
  const data = basePayload(query)
  data.module = requiredTextOf(query.module, 'module')
  if ('module1' in query) {
    data.module1 = requiredTextOf(query.module1, 'module1')
    data.module2 = requiredTextOf(query.module2, 'module2')
    data.module3 = requiredTextOf(query.module3, 'module3')
  }
  return data
}

/** The injected request must use PRODUCT_SETTING_TENANT_LOG_PAGE_PATH as its page context. */
export function createProductSettingTenantLogCapability (request: PortalRequest) {
  return {
    async companyList (): Promise<ProductSettingTenantLogCompany[]> {
      return companyListOf(await request({ url: COMPANY_LIST_URL, method: 'get', params: { id: 0 } }))
    },

    async functionTree (): Promise<ProductSettingTenantLogFunctionNode[]> {
      return functionTreeOf(await request({ url: FUNCTION_TREE_URL, method: 'get', params: { code: 'functionUrl' } }))
    },

    async userList (input: { companyId: ProductSettingTenantLogId }): Promise<ProductSettingTenantLogUser[]> {
      const companyId = idOf(input?.companyId, 'companyId')
      return userListOf(await request({ url: USER_LIST_URL, method: 'get', params: { pageSize: 99999, pageNo: 1, 'office.id': companyId } }))
    },

    async list (query: ProductSettingTenantLogQuery): Promise<ProductSettingTenantLogRow[]> {
      const { pageType, data } = listPayload(query)
      const url = pageType === '1' ? MODULE_LIST_URL : pageType === '2' ? FUNCTION_LIST_URL : USER_LIST_URL_STATISTICS
      return rowsOf(await request({ url, method: 'post', data }))
    },

    async moduleDetail (query: ProductSettingTenantLogModuleDetailQuery): Promise<ProductSettingTenantLogRow[]> {
      return rowsOf(await request({ url: MODULE_DETAIL_URL, method: 'post', data: detailPayload(query) }))
    },

    async functionDetail (query: ProductSettingTenantLogFunctionDetailQuery): Promise<ProductSettingTenantLogRow[]> {
      return rowsOf(await request({ url: FUNCTION_DETAIL_URL, method: 'post', data: detailPayload(query) }))
    },

    async userDetail (query: ProductSettingTenantLogUserDetailQuery): Promise<ProductSettingTenantLogRow[]> {
      const data = basePayload(query)
      data.userIdList = idListOf(query.userIdList, 'userIdList', true)
      data.functionList = functionListOf(query.functionList, true)
      return rowsOf(await request({ url: USER_DETAIL_URL, method: 'post', data }))
    },
  }
}

export type ProductSettingTenantLogCapability = ReturnType<typeof createProductSettingTenantLogCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_TENANT_LOG_METHODS = {
  'product-setting-tenant-log-company-list': 'companyList',
  'product-setting-tenant-log-function-tree': 'functionTree',
  'product-setting-tenant-log-user-list': 'userList',
  'product-setting-tenant-log-list': 'list',
  'product-setting-tenant-log-module-detail': 'moduleDetail',
  'product-setting-tenant-log-function-detail': 'functionDetail',
  'product-setting-tenant-log-user-detail': 'userDetail',
} as const

export const productSettingTenantLogCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-tenant-log-company-list', title: '查询企业使用情况公司选项', write: false, params: [] },
  { id: 'product-setting-tenant-log-function-tree', title: '查询企业使用情况功能树', write: false, params: [] },
  { id: 'product-setting-tenant-log-user-list', title: '查询企业使用情况用户选项', write: false, params: [p('companyId', 'text', true, '公司选项返回的公司ID；Portal按office.id筛选用户')] },
  { id: 'product-setting-tenant-log-list', title: '查询企业使用情况统计', write: false, params: [p('pageType', 'enum', false, '统计模式：1模块、2功能、3用户；默认1'), p('companyId', 'text', true, '公司选项返回的公司ID'), p('functionList', 'text', false, '功能树叶节点转换后的[{module1,module2,module3}]；功能/用户模式必填'), p('userIdList', 'text', false, '用户选项返回的用户ID数组；用户模式必填'), p('deviceType', 'enum', false, '登录平台PC、APP或空字符串；默认空字符串'), p('startDate', 'date', false, '开始日期；默认当前日期前30天'), p('endDate', 'date', false, '结束日期；默认当前日期')] },
  { id: 'product-setting-tenant-log-module-detail', title: '查询模块使用情况明细', write: false, params: [p('companyId', 'text', true, '公司ID'), p('module', 'text', true, '统计列表行的moduleName'), p('deviceType', 'enum', false, '登录平台PC、APP或空字符串'), p('startDate', 'date', false, '开始日期'), p('endDate', 'date', false, '结束日期')] },
  { id: 'product-setting-tenant-log-function-detail', title: '查询功能使用情况明细', write: false, params: [p('companyId', 'text', true, '公司ID'), p('module', 'text', true, '统计列表行的moduleName'), p('module1', 'text', true, '统计列表行的一级模块'), p('module2', 'text', true, '统计列表行的二级模块'), p('module3', 'text', true, '统计列表行的三级功能'), p('deviceType', 'enum', false, '登录平台PC、APP或空字符串'), p('startDate', 'date', false, '开始日期'), p('endDate', 'date', false, '结束日期')] },
  { id: 'product-setting-tenant-log-user-detail', title: '查询用户使用情况明细', write: false, params: [p('companyId', 'text', true, '公司ID'), p('userIdList', 'text', true, '用户选项返回的用户ID数组'), p('functionList', 'text', true, '功能树叶节点转换后的功能数组'), p('deviceType', 'enum', false, '登录平台PC、APP或空字符串'), p('startDate', 'date', false, '开始日期'), p('endDate', 'date', false, '结束日期')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_TENANT_LOG_PAGE_PATH,
  permission: PRODUCT_SETTING_TENANT_LOG_PERMISSION,
  moduleType: PRODUCT_SETTING_TENANT_LOG_MODULE_TYPE,
  httpInstance: 'product',
}))
