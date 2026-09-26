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
} as const

export const manageCostCenterCapabilities: CapabilityDefinition[] = [
  { id: 'manage-cost-center-list', title: '查询成本中心汇总', write: false, params: queryParams },
  { id: 'manage-cost-center-organization-tree', title: '查询成本中心组织树', write: false, params: [] },
  { id: 'manage-cost-center-export', title: '导出成本中心汇总', write: false, params: queryParams },
  { id: 'manage-cost-center-maintenance', title: '进入成本中心维护', write: false, params: [] },
].map(definition => ({ ...definition, pagePath: MANAGE_COST_CENTER_PAGE_PATH, permission: '/dashboard/manage/cost-center', moduleType: 14, httpInstance: 'platform' }))
