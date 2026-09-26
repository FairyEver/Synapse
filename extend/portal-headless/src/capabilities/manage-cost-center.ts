import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「薪酬管理 → 基础设置 → 成本中心」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const MANAGE_COST_CENTER_PAGE_PATH = '/dashboard/manage/cost-center/list'
const ROOT = '/salary/costcenter'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type ManageCostCenterId = string | number
export type ManageCostCenterQuery = {
  name?: string | null
  insuranceCost?: string | null
  fundCost?: string | null
  salaryCost?: string | null
  organization?: ManageCostCenterId | null
  pageNo?: number
  pageSize?: number
}

export type ManageCostCenterRow = {
  id?: ManageCostCenterId | null
  name: string | null
  staffCode: ManageCostCenterId | null
  idCard: string | null
  fullPath: string | null
  insuranceCost: string | null
  fundCost: string | null
  salaryCost: string | null
  [key: string]: unknown
}

export type ManageCostCenterFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type ManageCostCenterMaintenanceRoute = { path: './maintenance/list' }

/**
 * 「成本中心维护」子页（`dashboard/hr/manage/cost-center/maintenance/list.vue`）的行。
 *
 * 后端 `SalaryCostCenterDTO` 还有 creator/updater/isDel 等字段，页面只展示编码与名称；
 * 这里保留完整 DTO 字段但只有 code/name 属于页面消费契约。
 */
export type ManageCostCenterMaintenanceRow = {
  id: ManageCostCenterId
  /** 成本中心编码；后端必填、最多10个字符（保存规则，不是查询规则）。 */
  code: string | null
  /** 成本中心名称；后端必填、最多50个字符。 */
  name: string | null
  /** 逻辑删除标记：0 否、1 是。 */
  isDel: number | null
  creator: ManageCostCenterId | null
  createTime: string | number | null
  updater: ManageCostCenterId | null
  updateTime: string | number | null
}

export type ManageCostCenterMaintenanceQuery = {
  /**
   * 成本中心编码关键字（后端 `like`，不是等值）。
   *
   * 页面用 `convertFetchForm` 先把值 trim，**空值转成 undefined**（qs 的 skipNulls 会把
   * undefined 丢掉，所以空筛选时 URL 上**没有** code 这个键）——SDK 同样处理。
   */
  code?: string | null
  /** 成本中心名称关键字（后端 `like`）。与 code 同样的 trim + 空值省略规则。 */
  name?: string | null
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ManageCostCenterId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

function optionalIdOf (value: unknown, label: string): ManageCostCenterId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function queryOf (query: ManageCostCenterQuery = {}): Record<string, unknown> {
  for (const [name, value] of [['name', query.name], ['insuranceCost', query.insuranceCost], ['fundCost', query.fundCost], ['salaryCost', query.salaryCost] ] as const) {
    if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(`${name}必须为字符串或null`)
  }
  return {
    order: '', orderField: '',
    name: query.name ?? '',
    insuranceCost: query.insuranceCost ?? '',
    fundCost: query.fundCost ?? '',
    salaryCost: query.salaryCost ?? '',
    organization: query.organization === undefined || query.organization === null || query.organization === '' ? '' : idOf(query.organization, 'organization'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportQueryOf (query: ManageCostCenterQuery = {}): Record<string, unknown> {
  const params = queryOf(query)
  delete params.pageNo
  delete params.pageSize
  delete params.order
  delete params.orderField
  return params
}

function rowOf (value: unknown): ManageCostCenterRow {
  const row = objectOf(value, '成本中心列表行')
  return {
    ...row,
    id: optionalIdOf(row.id, '成本中心id'),
    name: textOf(row.name, 'name'),
    staffCode: optionalIdOf(row.staffCode, 'staffCode'),
    idCard: textOf(row.idCard, 'idCard'),
    fullPath: textOf(row.fullPath, 'fullPath'),
    insuranceCost: textOf(row.insuranceCost, 'insuranceCost'),
    fundCost: textOf(row.fundCost, 'fundCost'),
    salaryCost: textOf(row.salaryCost, 'salaryCost'),
  }
}

/** 页面的 code/name 会 trim，空值转 undefined（qs 的 skipNulls 把它整条丢掉）。 */
function trimmedOrUndefined (value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function nullableIntegerFieldOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateTimeFieldOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function maintenanceQueryOf (query: ManageCostCenterMaintenanceQuery = {}): Record<string, unknown> {
  const pageSize = query.pageSize ?? 20
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('pageSize必须为正整数')
  // ⚠️ 维护子页用的是 `useListPageModule` 的默认分页选项（`config.js:12` 的 10/20/50/100），
  //    与汇总页那份允许 200/500 的校验**不是同一组**，所以这里单独判。
  if (![10, 20, 50, 100].includes(pageSize)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return {
    order: '',
    orderField: '',
    code: trimmedOrUndefined(query.code, 'code'),
    name: trimmedOrUndefined(query.name, 'name'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize,
  }
}

function maintenanceRowOf (value: unknown): ManageCostCenterMaintenanceRow {
  const row = objectOf(value, '成本中心维护行')
  return {
    id: idOf(row.id, '成本中心维护id'),
    code: textOf(row.code, 'code'),
    name: textOf(row.name, 'name'),
    isDel: nullableIntegerFieldOf(row.isDel, 'isDel'),
    creator: optionalIdOf(row.creator, 'creator'),
    createTime: dateTimeFieldOf(row.createTime, 'createTime'),
    updater: optionalIdOf(row.updater, 'updater'),
    updateTime: dateTimeFieldOf(row.updateTime, 'updateTime'),
  }
}

function treeOf (value: unknown, label: string): JsonObject {
  const node = objectOf(value, label)
  return { ...node, id: idOf(node.id, `${label}.id`), name: typeof node.name === 'string' ? node.name : '', children: Array.isArray(node.children) ? node.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [] }
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>): ManageCostCenterFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('成本中心导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '成本中心.xlsx'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createManageCostCenterCapability (request: PortalRequest) {
  return {
    async list (query: ManageCostCenterQuery = {}): Promise<PageResult<ManageCostCenterRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('成本中心分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('成本中心组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `组织树[${index}]`))
    },
    async export (query: ManageCostCenterQuery = {}): Promise<ManageCostCenterFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: exportQueryOf(query), responseType: 'arraybuffer' }))
    },
    maintenance (): ManageCostCenterMaintenanceRoute {
      return { path: './maintenance/list' }
    },

    /**
     * 「成本中心维护」子页的列表（`getDataListURL: '/salary/costcenter/manage-page'`）。
     *
     * ⚠️ 两点与列表页不同：
     * 1. 后端这条 SQL **固定 `is_del=0` 且 `order by id asc`**（`SalaryCostCenterServiceImpl`），
     *    页面仍然发 `order=&orderField=`，但**后端根本不读这两个键** —— SDK 为了与页面请求
     *    逐字一致照样发，只是不要在说明里承诺排序由调用方控制。
     * 2. 该子页的「删除」走的是 `DELETE /salary/costcenter`（body 是 `[id]`），属于另一个动作，
     *    不在本能力范围内；本能力只读。
     */
    async listMaintenance (query: ManageCostCenterMaintenanceQuery = {}): Promise<PageResult<ManageCostCenterMaintenanceRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/manage-page`, method: 'get', params: maintenanceQueryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('成本中心维护分页响应缺少有效list或total')
      return { list: result.list.map(maintenanceRowOf), total: result.total }
    },
  }
}

export type ManageCostCenterCapability = ReturnType<typeof createManageCostCenterCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('name', 'text'), p('insuranceCost', 'text'), p('fundCost', 'text'), p('salaryCost', 'text'), p('organization', 'text', false, '所属组织ID'), p('pageNo', 'number'), p('pageSize', 'number')]

export const MANAGE_COST_CENTER_METHODS = {
  'manage-cost-center-list': 'list',
  'manage-cost-center-organization-tree': 'organizationTree',
  'manage-cost-center-export': 'export',
  'manage-cost-center-maintenance': 'maintenance',
  'manage-cost-center-maintenance-list': 'listMaintenance',
} as const

const maintenanceParams: ParamSpec[] = [
  p('code', 'text', false, '成本中心编码关键字；后端like匹配，空值不发该键'),
  p('name', 'text', false, '成本中心名称关键字；后端like匹配，空值不发该键'),
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('pageSize', 'number', false, '默认20；页面支持10、20、50、100'),
]

export const manageCostCenterCapabilities: CapabilityDefinition[] = [
  { id: 'manage-cost-center-list', title: '查询成本中心汇总', write: false, params: queryParams },
  { id: 'manage-cost-center-organization-tree', title: '查询成本中心组织树', write: false, params: [] },
  { id: 'manage-cost-center-export', title: '导出成本中心汇总', write: false, params: queryParams },
  { id: 'manage-cost-center-maintenance', title: '进入成本中心维护', write: false, params: [] },
  { id: 'manage-cost-center-maintenance-list', title: '查询成本中心维护列表', write: false, params: maintenanceParams },
].map(definition => ({ ...definition, pagePath: MANAGE_COST_CENTER_PAGE_PATH, permission: '/dashboard/manage/cost-center', moduleType: 14, httpInstance: 'platform' }))
