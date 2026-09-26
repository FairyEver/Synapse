import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 历史归档记录」及其页面内可达的历史组织/员工只读链路。 */
export const HISTORY_ARCHIVE_PAGE_PATH = '/dashboard/history-archive/list'
export const HISTORY_ARCHIVE_PERMISSION = '/dashboard/history-archive'
export const HISTORY_ARCHIVE_MODULE_TYPE = null

const ORGANIZATION_ROOT = '/hr/org/organization/archive'
const STAFF_ROOT = '/hr/org/staff/snapshot'
const STAFF_CUSTOM_INFO_URL = '/org/staff/getCustomInfo'
const CUSTOM_INFO_TABLE = 'hr_staff'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const HISTORY_ARCHIVE_TREE_PAGE_SIZE = 20

export type HistoryArchiveId = string | number
export type HistoryArchivePageResult<T> = { list: T[]; total: number }

export type HistoryArchiveListQuery = {
  archiveDate?: string | null
  pageNo?: number
  pageSize?: number
}

export type HistoryStaffSnapshotQuery = {
  snapshotMonth?: string | null
  pageNo?: number
  pageSize?: number
}

export type HistoryStaffListQuery = {
  snapshotId: HistoryArchiveId
  staffName?: string
  staffCode?: string | number
  status?: string | number
  mobile?: string | number
  postName?: string
  orgId?: HistoryArchiveId | '' | null
  pageNo?: number
  pageSize?: number
}

export type HistoryArchiveRecord = Record<string, unknown> & {
  id: HistoryArchiveId
  archiveDate: string | null
  archiveTime: string | null
  archiveType: number | null
  orgCount: number | null
  operator: string | null
}

export type HistoryStaffSnapshot = Record<string, unknown> & {
  id: HistoryArchiveId
  snapshotMonth: string | null
  snapshotTime: string | null
  staffCount: number | null
  operator: string | null
}

export type HistoryStaffRow = Record<string, unknown> & {
  id: HistoryArchiveId
  name: string | null
  staffCode: string | number | null
  status: number | null
  fullPath: string | null
  postName: string | null
  mobile: string | number | null
}

export type HistoryStaffDetail = Record<string, unknown> & { id: HistoryArchiveId }

export type HistoryArchiveTreeNode = {
  id: HistoryArchiveId
  parentId: HistoryArchiveId | null
  name: string | null
  code: string | null
  managerId: string | null
  managerName: string | null
  hasChildren: boolean
  sort: HistoryArchiveId | null
  ancestorPath?: HistoryArchiveTreeNode[]
}

export type HistoryArchiveTreePage = HistoryArchivePageResult<HistoryArchiveTreeNode> & {
  projectionToken: string
  archiveDate: string | null
}

export type HistoryArchiveTreeQuery = {
  archiveId: HistoryArchiveId
  parentId?: HistoryArchiveId
  pageNo?: number
  projectionToken?: string | null
}

export type HistoryArchiveTreeSearchQuery = HistoryArchiveTreeQuery & { keyword: string }

export type HistoryArchiveTreeExportInput = {
  archiveId: HistoryArchiveId
  rootId: HistoryArchiveId
  format: 'drawio-vertical' | 'drawio-horizontal' | 'text'
  projectionToken: string
}

export type HistoryArchiveFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type HistoryArchiveCustomInfo = Record<string, unknown> & {
  tableName: string
  customColumnsInfo: unknown[]
  customExportColumns?: unknown[]
  customQueryColumns?: unknown[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HistoryArchiveId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): HistoryArchiveId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return value === '' ? '' : null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableScalarOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null || value === '') return value === '' ? '' : null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return value === '' ? null : null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function nonNegativeIntegerOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负整数`)
  return value
}

function positiveIntegerOf (value: unknown, fallback: number, label: string, max?: number): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1 || (max !== undefined && resolved > max)) {
    throw new Error(`${label}必须为${max === undefined ? '正整数' : `1至${max}的整数`}`)
  }
  return resolved
}

function portalPageSizeOf (value: unknown, fallback = 20): number {
  const resolved = positiveIntegerOf(value, fallback, 'pageSize')
  if (!(PAGE_SIZE_OPTIONS as readonly number[]).includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved
}

function dateOnlyOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error(`${label}不是有效日期`)
  return value
}

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function pageOf<T> (value: unknown, label: string, mapRow: (row: unknown, index: number) => T): HistoryArchivePageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list)) throw new Error(`${label}.list必须是数组`)
  return {
    list: page.list.map(mapRow),
    total: nonNegativeIntegerOf(page.total, `${label}.total`),
  }
}

function archiveRecordOf (value: unknown, index: number): HistoryArchiveRecord {
  const row = objectOf(value, `组织归档记录[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `组织归档记录[${index}].id`),
    archiveDate: nullableTextOf(row.archiveDate, `组织归档记录[${index}].archiveDate`),
    archiveTime: nullableTextOf(row.archiveTime, `组织归档记录[${index}].archiveTime`),
    archiveType: nullableIntegerOf(row.archiveType, `组织归档记录[${index}].archiveType`),
    orgCount: nullableIntegerOf(row.orgCount, `组织归档记录[${index}].orgCount`),
    operator: nullableTextOf(row.operator, `组织归档记录[${index}].operator`),
  }
}

function staffSnapshotOf (value: unknown, index: number): HistoryStaffSnapshot {
  const row = objectOf(value, `人员归档记录[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `人员归档记录[${index}].id`),
    snapshotMonth: nullableTextOf(row.snapshotMonth, `人员归档记录[${index}].snapshotMonth`),
    snapshotTime: nullableTextOf(row.snapshotTime, `人员归档记录[${index}].snapshotTime`),
    staffCount: nullableIntegerOf(row.staffCount, `人员归档记录[${index}].staffCount`),
    operator: nullableTextOf(row.operator, `人员归档记录[${index}].operator`),
  }
}

function staffRowOf (value: unknown, index: number): HistoryStaffRow {
  const row = objectOf(value, `历史员工列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `历史员工列表[${index}].id`),
    name: nullableTextOf(row.name, `历史员工列表[${index}].name`),
    staffCode: nullableScalarOf(row.staffCode, `历史员工列表[${index}].staffCode`),
    status: nullableIntegerOf(row.status, `历史员工列表[${index}].status`),
    fullPath: nullableTextOf(row.fullPath, `历史员工列表[${index}].fullPath`),
    postName: nullableTextOf(row.postName, `历史员工列表[${index}].postName`),
    mobile: nullableScalarOf(row.mobile, `历史员工列表[${index}].mobile`),
  }
}

function staffDetailOf (value: unknown): HistoryStaffDetail | null {
  if (value === null || value === undefined) return null
  const detail = objectOf(value, '历史员工详情')
  return { ...detail, id: idOf(detail.id, '历史员工详情.id') }
}

function treeNodeOf (value: unknown, label: string, includePath = true): HistoryArchiveTreeNode {
  const row = objectOf(value, label)
  const ancestorPath = row.ancestorPath === undefined || row.ancestorPath === null
    ? undefined
    : !Array.isArray(row.ancestorPath)
        ? (() => { throw new Error(`${label}.ancestorPath必须是数组`) })()
        : row.ancestorPath.map((item, index) => treeNodeOf(item, `${label}.ancestorPath[${index}]`, false))
  return {
    id: idOf(row.id, `${label}.id`),
    parentId: nullableIdOf(row.parentId, `${label}.parentId`),
    name: nullableTextOf(row.name, `${label}.name`),
    code: nullableTextOf(row.code, `${label}.code`),
    managerId: nullableTextOf(row.managerId, `${label}.managerId`),
    managerName: nullableTextOf(row.managerName, `${label}.managerName`),
    hasChildren: row.hasChildren === undefined ? false : row.hasChildren === true,
    sort: nullableIdOf(row.sort, `${label}.sort`),
    ...(includePath && ancestorPath !== undefined ? { ancestorPath } : {}),
  }
}

function treePageOf (value: unknown, label: string): HistoryArchiveTreePage {
  const page = pageOf(value, label, (row, index) => treeNodeOf(row, `${label}.list[${index}]`))
  const raw = objectOf(value, label)
  if (typeof raw.projectionToken !== 'string' || raw.projectionToken.trim() === '') throw new Error(`${label}.projectionToken必须是非空字符串`)
  return { ...page, projectionToken: raw.projectionToken, archiveDate: nullableTextOf(raw.archiveDate, `${label}.archiveDate`) }
}

function pageQueryOf (query: HistoryArchiveListQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    archiveDate: dateOnlyOf(query.archiveDate, 'archiveDate'),
    page: positiveIntegerOf(query.pageNo, 1, 'pageNo'),
    pageSize: portalPageSizeOf(query.pageSize),
  }
}

function snapshotQueryOf (query: HistoryStaffSnapshotQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    snapshotMonth: monthOf(query.snapshotMonth, 'snapshotMonth'),
    page: positiveIntegerOf(query.pageNo, 1, 'pageNo'),
    pageSize: portalPageSizeOf(query.pageSize),
  }
}

function stringOrEmptyOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function staffCodeOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  throw new Error('staffCode必须为数字或数字字符串')
}

function statusOf (value: unknown): string | number {
  if (value === undefined || value === null) return ''
  if (value === '') return ''
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 5) return value
  if (typeof value === 'string' && /^(?:1|2|3|4|5)$/.test(value)) return value
  throw new Error('status必须是job_status字典值1至5')
}

function optionalOrgIdOf (value: unknown): HistoryArchiveId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, 'orgId')
}

function staffListParamsOf (query: HistoryStaffListQuery): JsonObject {
  return {
    order: '',
    orderField: '',
    staffName: stringOrEmptyOf(query.staffName, 'staffName'),
    staffCode: staffCodeOf(query.staffCode),
    status: statusOf(query.status),
    mobile: query.mobile === undefined || query.mobile === null ? '' : nullableScalarOf(query.mobile, 'mobile'),
    postName: stringOrEmptyOf(query.postName, 'postName'),
    orgId: optionalOrgIdOf(query.orgId),
    pageNo: positiveIntegerOf(query.pageNo, 1, 'pageNo'),
    pageSize: portalPageSizeOf(query.pageSize),
  }
}

function archiveIdOf (value: unknown, label: string): HistoryArchiveId {
  return idOf(value, label)
}

function treeQueryOf (query: HistoryArchiveTreeQuery): JsonObject {
  const params: JsonObject = {
    pageNo: positiveIntegerOf(query.pageNo, 1, 'pageNo'),
    pageSize: HISTORY_ARCHIVE_TREE_PAGE_SIZE,
    projectionToken: query.projectionToken === undefined ? null : query.projectionToken,
  }
  if (query.parentId !== undefined) params.parentId = idOf(query.parentId, 'parentId')
  if (query.projectionToken !== undefined && query.projectionToken !== null && (typeof query.projectionToken !== 'string' || query.projectionToken.trim() === '' || query.projectionToken.length > 64)) throw new Error('projectionToken必须为1至64个字符或null')
  return params
}

function treeSearchParamsOf (query: HistoryArchiveTreeSearchQuery): JsonObject {
  if (typeof query.keyword !== 'string' || query.keyword.trim() === '') throw new Error('keyword不能为空')
  if (query.keyword.trim().length > 100) throw new Error('keyword最多100个字符')
  return { ...treeQueryOf(query), keyword: query.keyword.trim() }
}

function formatOf (value: unknown): HistoryArchiveTreeExportInput['format'] {
  if (value === 'drawio-vertical' || value === 'drawio-horizontal' || value === 'text') return value
  throw new Error('format只能是drawio-vertical、drawio-horizontal或text')
}

function bytesOf (response: AxiosResponse<unknown>): Uint8Array {
  const data = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
  throw new Error('历史组织导出响应不是二进制文件')
}

function headerOf (response: AxiosResponse<unknown>, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' ? value : null
}

function fileNameOf (response: AxiosResponse<unknown>, fallback: string): string {
  const header = headerOf(response, 'content-disposition')
  if (!header) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<unknown>, fallback: string): HistoryArchiveFile {
  const bytes = bytesOf(response)
  if (bytes.byteLength === 0) throw new Error('历史组织导出响应为空文件')
  return {
    fileName: fileNameOf(response, fallback),
    contentType: headerOf(response, 'content-type'),
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createHistoryArchiveCapability (request: PortalRequest) {
  return {
    async listOrganizationArchives (query: HistoryArchiveListQuery = {}): Promise<HistoryArchivePageResult<HistoryArchiveRecord>> {
      return pageOf(await request({ url: `${ORGANIZATION_ROOT}/page`, method: 'get', params: pageQueryOf(query) }), '组织归档记录分页响应', archiveRecordOf)
    },

    async listStaffSnapshots (query: HistoryStaffSnapshotQuery = {}): Promise<HistoryArchivePageResult<HistoryStaffSnapshot>> {
      return pageOf(await request({ url: `${STAFF_ROOT}/page`, method: 'get', params: snapshotQueryOf(query) }), '人员归档记录分页响应', staffSnapshotOf)
    },

    async listStaff (query: HistoryStaffListQuery): Promise<HistoryArchivePageResult<HistoryStaffRow>> {
      const snapshotId = archiveIdOf(query?.snapshotId, 'snapshotId')
      return pageOf(await request({ url: `${STAFF_ROOT}/staffPage/${snapshotId}`, method: 'get', params: staffListParamsOf(query) }), '历史员工分页响应', staffRowOf)
    },

    async getStaffDetail (input: { snapshotId: HistoryArchiveId; staffId: HistoryArchiveId }): Promise<HistoryStaffDetail | null> {
      const snapshotId = archiveIdOf(input?.snapshotId, 'snapshotId')
      const staffId = archiveIdOf(input?.staffId, 'staffId')
      return staffDetailOf(await request({ url: `${STAFF_ROOT}/detail/${snapshotId}/${staffId}`, method: 'get' }))
    },

    async getCustomInfo (): Promise<HistoryArchiveCustomInfo> {
      const result = objectOf(await request({ url: STAFF_CUSTOM_INFO_URL, method: 'get', params: { tableName: CUSTOM_INFO_TABLE } }), '历史员工自定义列信息')
      if (result.tableName !== undefined && result.tableName !== CUSTOM_INFO_TABLE) throw new Error('历史员工自定义列信息.tableName必须为hr_staff')
      if (!Array.isArray(result.customColumnsInfo)) throw new Error('历史员工自定义列信息.customColumnsInfo必须是数组')
      return { ...result, tableName: CUSTOM_INFO_TABLE, customColumnsInfo: result.customColumnsInfo, ...(Array.isArray(result.customExportColumns) ? { customExportColumns: result.customExportColumns } : {}), ...(Array.isArray(result.customQueryColumns) ? { customQueryColumns: result.customQueryColumns } : {}) }
    },

    async organizationTreePage (query: HistoryArchiveTreeQuery): Promise<HistoryArchiveTreePage> {
      const archiveId = archiveIdOf(query?.archiveId, 'archiveId')
      return treePageOf(await request({ url: `${ORGANIZATION_ROOT}/orgTreePage/${archiveId}`, method: 'get', params: treeQueryOf(query) }), '历史组织树分页响应')
    },

    async searchOrganizationTree (query: HistoryArchiveTreeSearchQuery): Promise<HistoryArchiveTreePage> {
      const archiveId = archiveIdOf(query?.archiveId, 'archiveId')
      return treePageOf(await request({ url: `${ORGANIZATION_ROOT}/orgTreeSearch/${archiveId}`, method: 'get', params: treeSearchParamsOf(query) }), '历史组织树搜索响应')
    },

    async exportOrganizationTree (input: HistoryArchiveTreeExportInput): Promise<HistoryArchiveFile> {
      const archiveId = archiveIdOf(input?.archiveId, 'archiveId')
      const rootId = archiveIdOf(input?.rootId, 'rootId')
      const format = formatOf(input?.format)
      if (typeof input?.projectionToken !== 'string' || input.projectionToken.trim() === '' || input.projectionToken.length > 64) throw new Error('projectionToken必须为1至64个字符')
      return fileOf(await request<AxiosResponse<unknown>>({
        url: `${ORGANIZATION_ROOT}/orgTreeExport/${archiveId}`,
        method: 'get',
        params: { rootId, format, projectionToken: input.projectionToken },
        responseType: 'arraybuffer',
      }), `历史组织架构_${archiveId}${format === 'text' ? '.txt' : '.drawio'}`)
    },
  }
}

export type HistoryArchiveCapability = ReturnType<typeof createHistoryArchiveCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const pageParams = [p('archiveDate', 'date', false, '归档日期，格式YYYY-MM-DD；Portal为空时不限制'), p('pageNo', 'number', false, 'SDK页码，发送给Portal请求的page字段，默认1'), p('pageSize', 'number', false, '每页条数，默认20，页面支持10/20/50/100')]
const snapshotParams = [p('snapshotMonth', 'date', false, '归档月份，格式YYYY-MM；Portal为空时不限制'), p('pageNo', 'number', false, 'SDK页码，发送给Portal请求的page字段，默认1'), p('pageSize', 'number', false, '每页条数，默认20，页面支持10/20/50/100')]
const staffParams = [p('snapshotId', 'search', true, '人员归档快照ID'), p('staffName', 'text', false, '姓名模糊筛选；默认空字符串'), p('staffCode', 'text', false, '员工号精确筛选；默认空字符串'), p('status', 'enum', false, '在职类型字典值；默认空字符串'), p('mobile', 'text', false, '手机号精确筛选；默认空字符串'), p('postName', 'text', false, '岗位模糊筛选；默认空字符串'), p('orgId', 'tree', false, '组织ID及其历史下级组织；默认空字符串'), p('pageNo', 'number', false, '页码，发送给staffPage的pageNo，默认1'), p('pageSize', 'number', false, '每页条数，默认20，页面支持10/20/50/100')]

export const HISTORY_ARCHIVE_METHODS = {
  'history-archive-organization-list': 'listOrganizationArchives',
  'history-archive-people-list': 'listStaffSnapshots',
  'history-archive-staff-list': 'listStaff',
  'history-archive-staff-detail': 'getStaffDetail',
  'history-archive-staff-custom-info': 'getCustomInfo',
  'history-archive-organization-tree-page': 'organizationTreePage',
  'history-archive-organization-tree-search': 'searchOrganizationTree',
  'history-archive-organization-tree-export': 'exportOrganizationTree',
} as const

export const historyArchiveCapabilities: CapabilityDefinition[] = [
  { id: 'history-archive-organization-list', title: '查询组织历史归档记录', write: false, params: pageParams },
  { id: 'history-archive-people-list', title: '查询人员历史归档记录', write: false, params: snapshotParams },
  { id: 'history-archive-staff-list', title: '查询历史员工列表', write: false, params: staffParams },
  { id: 'history-archive-staff-detail', title: '查询历史员工详情', write: false, params: [p('snapshotId', 'search', true, '人员归档快照ID'), p('staffId', 'search', true, '历史员工原始ID')] },
  { id: 'history-archive-staff-custom-info', title: '查询历史员工自定义列', write: false, params: [] },
  { id: 'history-archive-organization-tree-page', title: '分页查询历史组织架构', write: false, params: [p('archiveId', 'search', true, '组织归档记录ID'), p('parentId', 'search', false, '要展开的历史组织ID；省略表示根节点'), p('pageNo', 'number', false, '页码，默认1'), p('projectionToken', 'text', false, '首次省略；后续沿用同一次根查询返回的投影令牌；Portal固定每页20')] },
  { id: 'history-archive-organization-tree-search', title: '搜索历史组织架构', write: false, params: [p('archiveId', 'search', true, '组织归档记录ID'), p('keyword', 'text', true, '跨层组织名称关键字，最多100字符'), p('pageNo', 'number', false, '页码，默认1'), p('projectionToken', 'text', true, '根查询返回的同一次投影令牌；Portal固定每页20')] },
  { id: 'history-archive-organization-tree-export', title: '导出历史组织架构', write: false, params: [p('archiveId', 'search', true, '组织归档记录ID'), p('rootId', 'search', true, '当前选中的历史根组织ID'), p('format', 'enum', true, '导出格式：drawio-vertical、drawio-horizontal或text',), p('projectionToken', 'text', true, '根查询返回的同一次投影令牌')] },
].map(definition => ({ ...definition, pagePath: HISTORY_ARCHIVE_PAGE_PATH, permission: HISTORY_ARCHIVE_PERMISSION, moduleType: HISTORY_ARCHIVE_MODULE_TYPE, httpInstance: 'platform' }))
