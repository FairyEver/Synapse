import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「薪资管理 → 个税专项扣款 → 扣款归档查询」。 */
export const SALARY_PERSON_TAX_FILE_PAGE_PATH = '/dashboard/salary/person-tax-file/list'
export const SALARY_PERSON_TAX_FILE_PERMISSION = '/dashboard/salary/person-tax-file'
export const SALARY_PERSON_TAX_FILE_MODULE_TYPE = 14

const ROOT = '/salary/salarypersontax'
const LIST_URL = `${ROOT}/filingPageNew`
const EXPORT_URL = `${ROOT}/filingExport`
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTreeNew'

export type SalaryPersonTaxFileId = string | number
export type SalaryPersonTaxFileMonthRange = readonly [string | null | undefined, string | null | undefined] | readonly string[]
export type SalaryPersonTaxFileQuery = {
  name?: string | null
  isUsed?: 0 | 1 | '' | null
  orgId?: SalaryPersonTaxFileId | null
  costDate?: SalaryPersonTaxFileMonthRange | null
  archiveStatus?: 1 | 2
  pageNo?: number
  pageSize?: number
}

export type SalaryPersonTaxSpecial = Record<string, unknown> & {
  id?: SalaryPersonTaxFileId | null
  taxId?: SalaryPersonTaxFileId | null
  specialType?: string | null
  amount?: number | string | null
  costStart?: string | null
  costEnd?: string | null
  isDel?: number | null
  creator?: SalaryPersonTaxFileId | null
  createTime?: string | number | null
  updater?: SalaryPersonTaxFileId | null
  updateTime?: string | number | null
  archiveStatus?: 1 | 2 | null
}

export type SalaryPersonTaxFileRow = Record<string, unknown> & {
  id: SalaryPersonTaxFileId
  staffCode: SalaryPersonTaxFileId | null
  staffName: string | null
  idCard: string | null
  organizationName: string | null
  postName: string | null
  archiveStatus: 1 | 2 | null
  createTime: string | number | null
  updaterName: string | null
  costDate: string | null
  documentName: string | null
  isUsed: string | null
  specialList: SalaryPersonTaxSpecial[]
}

export type SalaryPersonTaxEligibilityExcludedStaff = Record<string, unknown> & {
  staffId?: SalaryPersonTaxFileId | null
  staffCode?: SalaryPersonTaxFileId | null
  staffName?: string | null
  status?: number | null
  downtimePay?: string | null
  businessDate?: string | null
  reasonCode?: string | null
  reason?: string | null
}

export type SalaryPersonTaxEligibilityResult = {
  processedIds: SalaryPersonTaxFileId[]
  processedStaffCodes: SalaryPersonTaxFileId[]
  processedCount: number
  eligibleStaffIds: SalaryPersonTaxFileId[]
  eligibleStaffCodes: SalaryPersonTaxFileId[]
  excludedStaffList: SalaryPersonTaxEligibilityExcludedStaff[]
}

export type SalaryPersonTaxFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryPersonTaxFileId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SalaryPersonTaxFileId | null {
  return value === undefined || value === null || value === '' ? null : idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function amountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM或null`)
  return value
}

function dateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD或null`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数或null`)
  return value as number
}

function archiveStatusOf (value: unknown, label = 'archiveStatus'): 1 | 2 | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 1 && value !== 2) throw new Error(`${label}只能是数值1（未归档）或2（已归档）`)
  return value
}

function usedOf (value: unknown): 0 | 1 | '' {
  if (value === undefined || value === null || value === '') return ''
  if (value !== 0 && value !== 1) throw new Error('isUsed只能是数值0（未使用）或1（已使用）')
  return value
}

function monthRangeOf (value: SalaryPersonTaxFileMonthRange | null | undefined): [string, string] {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return ['', '']
  if (!Array.isArray(value) || value.length !== 2) throw new Error('costDate必须是两个月份的数组')
  return [monthOf(value[0], 'costDate[0]') ?? '', monthOf(value[1], 'costDate[1]') ?? '']
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function listParamsOf (query: SalaryPersonTaxFileQuery = {}): Record<string, unknown> {
  const [costDateStart, costDateEnd] = monthRangeOf(query.costDate)
  const name = query.name === undefined || query.name === null ? '' : query.name
  if (typeof name !== 'string') throw new Error('name必须为字符串或null')
  const orgId = query.orgId === undefined || query.orgId === null || query.orgId === '' ? '' : idOf(query.orgId, 'orgId')
  const archiveStatus = query.archiveStatus ?? 2
  if (archiveStatus !== 1 && archiveStatus !== 2) throw new Error('archiveStatus只能是1或2')
  return {
    name,
    isUsed: usedOf(query.isUsed),
    orgId,
    archiveStatus,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
    costDateStart,
    costDateEnd,
    order: 'desc',
    orderField: 'id',
  }
}

function idsOf (value: unknown, label: string, allowEmpty = false): SalaryPersonTaxFileId[] {
  const values = Array.isArray(value) ? value : [value]
  if (!allowEmpty && values.length === 0) throw new Error(`${label}不能为空`)
  const ids = values.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function eligibilityResultOf (value: unknown): SalaryPersonTaxEligibilityResult {
  const result = objectOf(value, '个税归档资格回执')
  const listOf = (name: string): unknown[] => {
    const value = result[name]
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new Error(`个税归档资格回执.${name}必须为数组`)
    return value
  }
  const processedIds = listOf('processedIds').map((item, index) => idOf(item, `processedIds[${index}]`))
  const processedStaffCodes = listOf('processedStaffCodes').map((item, index) => idOf(item, `processedStaffCodes[${index}]`))
  const eligibleStaffIds = listOf('eligibleStaffIds').map((item, index) => idOf(item, `eligibleStaffIds[${index}]`))
  const eligibleStaffCodes = listOf('eligibleStaffCodes').map((item, index) => idOf(item, `eligibleStaffCodes[${index}]`))
  const processedCount = result.processedCount === undefined || result.processedCount === null ? 0 : result.processedCount
  if (typeof processedCount !== 'number' || !Number.isSafeInteger(processedCount) || processedCount < 0) throw new Error('个税归档资格回执.processedCount必须为非负整数')
  return {
    processedIds,
    processedStaffCodes,
    processedCount: processedCount as number,
    eligibleStaffIds,
    eligibleStaffCodes,
    excludedStaffList: listOf('excludedStaffList').map((item, index) => ({ ...objectOf(item, `excludedStaffList[${index}]`) }) as SalaryPersonTaxEligibilityExcludedStaff),
  }
}

function specialOf (value: unknown, index: number): SalaryPersonTaxSpecial {
  const row = objectOf(value, `specialList[${index}]`)
  const archiveStatus = archiveStatusOf(row.archiveStatus, `specialList[${index}].archiveStatus`)
  return {
    ...row,
    id: optionalIdOf(row.id, `specialList[${index}].id`),
    taxId: optionalIdOf(row.taxId, `specialList[${index}].taxId`),
    specialType: textOf(row.specialType, `specialList[${index}].specialType`),
    amount: amountOf(row.amount, `specialList[${index}].amount`),
    costStart: dateOf(row.costStart, `specialList[${index}].costStart`),
    costEnd: dateOf(row.costEnd, `specialList[${index}].costEnd`),
    isDel: integerOf(row.isDel, `specialList[${index}].isDel`),
    creator: optionalIdOf(row.creator, `specialList[${index}].creator`),
    createTime: dateTimeOf(row.createTime, `specialList[${index}].createTime`),
    updater: optionalIdOf(row.updater, `specialList[${index}].updater`),
    updateTime: dateTimeOf(row.updateTime, `specialList[${index}].updateTime`),
    archiveStatus,
  }
}

function rowOf (value: unknown, index: number): SalaryPersonTaxFileRow {
  const row = objectOf(value, `扣款归档列表[${index}]`)
  const specialList = row.specialList === undefined || row.specialList === null
    ? []
    : Array.isArray(row.specialList) ? row.specialList.map((item, itemIndex) => specialOf(item, itemIndex)) : (() => { throw new Error(`扣款归档列表[${index}].specialList必须为数组`) })()
  return {
    ...row,
    id: idOf(row.id, `扣款归档列表[${index}].id`),
    staffCode: optionalIdOf(row.staffCode, `扣款归档列表[${index}].staffCode`),
    staffName: textOf(row.staffName, `扣款归档列表[${index}].staffName`),
    idCard: textOf(row.idCard, `扣款归档列表[${index}].idCard`),
    organizationName: textOf(row.organizationName, `扣款归档列表[${index}].organizationName`),
    postName: textOf(row.postName, `扣款归档列表[${index}].postName`),
    archiveStatus: archiveStatusOf(row.archiveStatus, `扣款归档列表[${index}].archiveStatus`),
    createTime: dateTimeOf(row.createTime, `扣款归档列表[${index}].createTime`),
    updaterName: textOf(row.updaterName, `扣款归档列表[${index}].updaterName`),
    costDate: monthOf(row.costDate, `扣款归档列表[${index}].costDate`),
    documentName: textOf(row.documentName, `扣款归档列表[${index}].documentName`),
    isUsed: textOf(row.isUsed, `扣款归档列表[${index}].isUsed`),
    specialList,
  }
}

function pageOf (value: unknown): PageResult<SalaryPersonTaxFileRow> {
  const page = objectOf(value, '扣款归档分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('扣款归档分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total as number }
}

function treeOf (value: unknown, label: string): JsonObject {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`) ?? '',
    children: Array.isArray(row.children) ? row.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [],
  }
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ''))
    } catch {
      return encoded
    }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>): SalaryPersonTaxFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('扣款归档导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '个税专项扣款.xls'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createSalaryPersonTaxFileCapability (request: PortalRequest) {
  return {
    async list (query: SalaryPersonTaxFileQuery = {}): Promise<PageResult<SalaryPersonTaxFileRow>> {
      return pageOf(await request<PageResult<unknown>>({ url: LIST_URL, method: 'get', params: listParamsOf(query) }))
    },
    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('扣款归档组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `组织树[${index}]`))
    },
    prepareUnarchive (input: { ids: SalaryPersonTaxFileId[] }): { draft: { ids: SalaryPersonTaxFileId[]; status: 1 } } {
      return { draft: { ids: idsOf(input?.ids, 'ids'), status: 1 } }
    },
    async unarchive (input: { ids: SalaryPersonTaxFileId[] }): Promise<SalaryPersonTaxEligibilityResult> {
      const result = await request<unknown>({ url: `${ROOT}/updateArchive`, method: 'post', data: { ids: idsOf(input?.ids, 'ids'), status: 1 } })
      return eligibilityResultOf(result)
    },
    async export (input: { ids?: SalaryPersonTaxFileId[] | null } = {}): Promise<SalaryPersonTaxFile> {
      const ids = input.ids === undefined || input.ids === null ? [] : idsOf(input.ids, 'ids', true)
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: EXPORT_URL, method: 'get', params: { idList: ids.join(',') }, responseType: 'arraybuffer' }))
    },
  }
}

export type SalaryPersonTaxFileCapability = ReturnType<typeof createSalaryPersonTaxFileCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const pageParams: ParamSpec[] = [
  p('name', 'text', false, '姓名模糊筛选；Portal默认发送空字符串'),
  p('isUsed', 'enum', false, '工资单使用状态；0未使用、1已使用；Portal默认发送空字符串'),
  p('orgId', 'tree', false, '角色组织树选中的组织ID；服务端会展开下级组织'),
  p('costDate', 'date', false, '归属月份范围；SDK转换为costDateStart/costDateEnd'),
  p('archiveStatus', 'enum', false, '1未归档、2已归档；页面默认2'),
  p('pageNo', 'number'),
  p('pageSize', 'number'),
]
const idsParams: ParamSpec[] = [p('ids', 'text', true, '非空的个税记录ID数组')]

export const SALARY_PERSON_TAX_FILE_METHODS = {
  'salary-person-tax-file-list': 'list',
  'salary-person-tax-file-organization-tree': 'organizationTree',
  'salary-person-tax-file-prepare-unarchive': 'prepareUnarchive',
  'salary-person-tax-file-unarchive': 'unarchive',
  'salary-person-tax-file-export': 'export',
} as const

export const salaryPersonTaxFileCapabilities: CapabilityDefinition[] = [
  { id: 'salary-person-tax-file-list', title: '查询扣款归档', write: false, params: pageParams },
  { id: 'salary-person-tax-file-organization-tree', title: '查询扣款归档组织树', write: false, params: [] },
  { id: 'salary-person-tax-file-prepare-unarchive', title: '准备取消扣款归档', write: false, params: idsParams },
  { id: 'salary-person-tax-file-unarchive', title: '取消扣款归档', write: true, params: idsParams },
  { id: 'salary-person-tax-file-export', title: '导出选中的扣款归档', write: false, params: [p('ids', 'text', false, '选中的个税记录ID数组；页面未选中时仍发送空字符串')] },
].map(definition => ({
  ...definition,
  pagePath: SALARY_PERSON_TAX_FILE_PAGE_PATH,
  permission: SALARY_PERSON_TAX_FILE_PERMISSION,
  moduleType: SALARY_PERSON_TAX_FILE_MODULE_TYPE,
  httpInstance: 'platform',
}))
