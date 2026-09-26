import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「社会保险 → 社保费用 / 社保归档查询」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const INSURANCE_COST_PAGE_PATH = '/dashboard/insurance/cost/list'
export const INSURANCE_ARCHIVE_PAGE_PATH = '/dashboard/insurance/archive/list'
const ROOT = '/salary/salaryinsurancecosts'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type InsuranceSalaryInsuranceCostId = string | number
export type InsuranceSalaryInsuranceCostQuery = {
  name?: string | null
  orgIds?: InsuranceSalaryInsuranceCostId[] | string | null
  archiveStatus?: 1 | 2 | number | null
  isSalaryUsed?: 0 | 1 | number | null
  belongMonth?: [string | null, string | null] | string[] | null
  occurMonth?: [string | null, string | null] | string[] | null
  pageNo?: number
  pageSize?: number
}

export type InsuranceSalaryInsuranceCostRow = {
  id: InsuranceSalaryInsuranceCostId
  staffCode: InsuranceSalaryInsuranceCostId | null
  name: string | null
  organizationPath: string | null
  postName: string | null
  idCard: string | null
  insuredArea: string | null
  depositUnitName: string | null
  depositUnitId: InsuranceSalaryInsuranceCostId | null
  costMonth: string | null
  occurredMonth: string | null
  totalInsuranceCost: number | string | null
  totalUnitCost: number | string | null
  totalPersonalCost: number | string | null
  costType: number | null
  operatorName: string | null
  operateTime: string | number | null
  costCenterName: string | null
  costCenterId: InsuranceSalaryInsuranceCostId | null
  pensionUnitCost: number | string | null
  pensionPersonalCost: number | string | null
  pensionTotalCost: number | string | null
  unemploymentUnitCost: number | string | null
  unemploymentPersonalCost: number | string | null
  unemploymentTotalCost: number | string | null
  workInjuryUnitCost: number | string | null
  workInjuryPersonalCost: number | string | null
  workInjuryTotalCost: number | string | null
  maternityUnitCost: number | string | null
  maternityPersonalCost: number | string | null
  maternityTotalCost: number | string | null
  basicMedicalUnitCost: number | string | null
  basicMedicalPersonalCost: number | string | null
  basicMedicalTotalCost: number | string | null
  majorMedicalUnitCost: number | string | null
  majorMedicalPersonalCost: number | string | null
  majorMedicalTotalCost: number | string | null
  salaryDocumentIds: string | null
  salaryDocumentIdNames: string | null
  archiveStatus: 1 | 2
  isDel: number | null
  creator: InsuranceSalaryInsuranceCostId | null
  createTime: string | number | null
  updater: InsuranceSalaryInsuranceCostId | null
  updateTime: string | number | null
  isSalaryUsed: number | string | null
  [key: string]: unknown
}

export type InsuranceSalaryInsuranceCostMutation = { id: InsuranceSalaryInsuranceCostId; occurredMonth: string }
export type InsuranceSalaryInsuranceCostAssignment = { id: InsuranceSalaryInsuranceCostId; depositUnitId?: InsuranceSalaryInsuranceCostId; costCenterId?: InsuranceSalaryInsuranceCostId }
export type InsuranceSalaryInsuranceCostFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
export type InsuranceSalaryInsuranceCostImport = { fileName: string; base64: string; contentType?: string | null }

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}
function idOf (value: unknown, label: string): InsuranceSalaryInsuranceCostId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}
function optionalIdOf (value: unknown, label: string): InsuranceSalaryInsuranceCostId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}
function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}
function idsOf (value: unknown, label: string): InsuranceSalaryInsuranceCostId[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : []
  if (values.length === 0) throw new Error(`${label}不能为空`)
  const ids = values.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}
function commaIdsOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return idsOf(value, 'orgIds').join(',')
}
function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}
function monthRangeOf (value: unknown, label: string): [string | null, string | null] {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return [null, null]
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是两个月份的数组`)
  return [monthOf(value[0], `${label}[0]`), monthOf(value[1], `${label}[1]`)]
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
function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isSafeInteger(number)) throw new Error(`${label}必须为安全整数或null`)
  return number
}
function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}
function baseQueryOf (query: InsuranceSalaryInsuranceCostQuery, view: 'cost' | 'archive'): Record<string, unknown> {
  const belong = monthRangeOf(query.belongMonth, 'belongMonth')
  const occur = monthRangeOf(query.occurMonth, 'occurMonth')
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  if (query.archiveStatus !== undefined && query.archiveStatus !== null && ![1, 2].includes(query.archiveStatus)) throw new Error('archiveStatus只能是1或2')
  if (view === 'archive' && query.isSalaryUsed !== undefined && query.isSalaryUsed !== null && ![0, 1].includes(query.isSalaryUsed)) throw new Error('isSalaryUsed只能是0或1')
  const result: Record<string, unknown> = {
    order: '', orderField: '',
    archiveStatus: query.archiveStatus ?? (view === 'cost' ? 1 : 2),
    orgIds: commaIdsOf(query.orgIds),
    name: query.name ?? null,
    costDateStart: belong[0], costDateEnd: belong[1],
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  if (view === 'archive') {
    result.isSalaryUsed = query.isSalaryUsed ?? null
    result.occurredDateStart = occur[0]
    result.occurredDateEnd = occur[1]
  }
  return result
}

function exportQueryOf (query: InsuranceSalaryInsuranceCostQuery & { ids?: InsuranceSalaryInsuranceCostId[] | string | null }, view: 'cost' | 'archive'): Record<string, unknown> {
  const params = baseQueryOf(query, view)
  delete params.pageNo
  delete params.pageSize
  delete params.order
  delete params.orderField
  return { type: view === 'cost' ? 1 : 2, ...params, ids: commaIdsOf(query.ids) }
}
function rowOf (value: unknown): InsuranceSalaryInsuranceCostRow {
  const row = objectOf(value, '社保费用列表行')
  const id = idOf(row.id, '社保费用id')
  const archiveStatus = Number(row.archiveStatus)
  if (archiveStatus !== 1 && archiveStatus !== 2) throw new Error('archiveStatus只能是数值1（未归档）或2（已归档）')
  return {
    ...row,
    id,
    staffCode: optionalIdOf(row.staffCode, 'staffCode'),
    name: textOf(row.name, 'name'),
    organizationPath: textOf(row.organizationPath, 'organizationPath'),
    postName: textOf(row.postName, 'postName'),
    idCard: textOf(row.idCard, 'idCard'),
    insuredArea: textOf(row.insuredArea, 'insuredArea'),
    depositUnitName: textOf(row.depositUnitName, 'depositUnitName'),
    depositUnitId: optionalIdOf(row.depositUnitId, 'depositUnitId'),
    costMonth: monthOf(row.costMonth, 'costMonth'),
    occurredMonth: monthOf(row.occurredMonth, 'occurredMonth'),
    totalInsuranceCost: amountOf(row.totalInsuranceCost, 'totalInsuranceCost'),
    totalUnitCost: amountOf(row.totalUnitCost, 'totalUnitCost'),
    totalPersonalCost: amountOf(row.totalPersonalCost, 'totalPersonalCost'),
    costType: integerOf(row.costType, 'costType'),
    operatorName: textOf(row.operatorName, 'operatorName'),
    operateTime: dateTimeOf(row.operateTime, 'operateTime'),
    costCenterName: textOf(row.costCenterName, 'costCenterName'),
    costCenterId: optionalIdOf(row.costCenterId, 'costCenterId'),
    pensionUnitCost: amountOf(row.pensionUnitCost, 'pensionUnitCost'),
    pensionPersonalCost: amountOf(row.pensionPersonalCost, 'pensionPersonalCost'),
    pensionTotalCost: amountOf(row.pensionTotalCost, 'pensionTotalCost'),
    unemploymentUnitCost: amountOf(row.unemploymentUnitCost, 'unemploymentUnitCost'),
    unemploymentPersonalCost: amountOf(row.unemploymentPersonalCost, 'unemploymentPersonalCost'),
    unemploymentTotalCost: amountOf(row.unemploymentTotalCost, 'unemploymentTotalCost'),
    workInjuryUnitCost: amountOf(row.workInjuryUnitCost, 'workInjuryUnitCost'),
    workInjuryPersonalCost: amountOf(row.workInjuryPersonalCost, 'workInjuryPersonalCost'),
    workInjuryTotalCost: amountOf(row.workInjuryTotalCost, 'workInjuryTotalCost'),
    maternityUnitCost: amountOf(row.maternityUnitCost, 'maternityUnitCost'),
    maternityPersonalCost: amountOf(row.maternityPersonalCost, 'maternityPersonalCost'),
    maternityTotalCost: amountOf(row.maternityTotalCost, 'maternityTotalCost'),
    basicMedicalUnitCost: amountOf(row.basicMedicalUnitCost, 'basicMedicalUnitCost'),
    basicMedicalPersonalCost: amountOf(row.basicMedicalPersonalCost, 'basicMedicalPersonalCost'),
    basicMedicalTotalCost: amountOf(row.basicMedicalTotalCost, 'basicMedicalTotalCost'),
    majorMedicalUnitCost: amountOf(row.majorMedicalUnitCost, 'majorMedicalUnitCost'),
    majorMedicalPersonalCost: amountOf(row.majorMedicalPersonalCost, 'majorMedicalPersonalCost'),
    majorMedicalTotalCost: amountOf(row.majorMedicalTotalCost, 'majorMedicalTotalCost'),
    salaryDocumentIds: textOf(row.salaryDocumentIds, 'salaryDocumentIds'),
    salaryDocumentIdNames: textOf(row.salaryDocumentIdNames, 'salaryDocumentIdNames'),
    archiveStatus: archiveStatus as 1 | 2,
    isDel: integerOf(row.isDel, 'isDel'),
    creator: optionalIdOf(row.creator, 'creator'),
    createTime: dateTimeOf(row.createTime, 'createTime'),
    updater: optionalIdOf(row.updater, 'updater'),
    updateTime: dateTimeOf(row.updateTime, 'updateTime'),
    isSalaryUsed: row.isSalaryUsed === undefined || row.isSalaryUsed === null ? null : (typeof row.isSalaryUsed === 'number' || typeof row.isSalaryUsed === 'string' ? row.isSalaryUsed : (() => { throw new Error('isSalaryUsed必须为数字、字符串或null') })()),
  }
}
function mutationOf (value: unknown): InsuranceSalaryInsuranceCostMutation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('社保费用归档项不能为空')
  return value.map((item, index) => {
    const row = objectOf(item, `社保费用归档项[${index}]`)
    return { id: idOf(row.id, `社保费用归档项[${index}].id`), occurredMonth: monthOf(row.occurredMonth ?? row.occurredDate, `社保费用归档项[${index}].occurredMonth`)! }
  })
}
function idItemsOf (value: unknown): Array<{ id: InsuranceSalaryInsuranceCostId }> { return idsOf(value, 'ids').map(id => ({ id })) }
function assignmentOf (value: unknown, field: 'depositUnitId' | 'costCenterId'): InsuranceSalaryInsuranceCostAssignment[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('社保费用调整项不能为空')
  return value.map((item, index) => {
    const row = objectOf(item, `社保费用调整项[${index}]`)
    return { id: idOf(row.id, `社保费用调整项[${index}].id`), [field]: idOf(row[field], `社保费用调整项[${index}].${field}`) }
  })
}
function copyOf (value: unknown): { oldDate: string; newDate: string } {
  const row = objectOf(value, '调用历史归档费用输入')
  return { oldDate: monthOf(row.oldDate, 'oldDate')!, newDate: monthOf(row.newDate, 'newDate')! }
}
function fileBytesOf (value: unknown): { fileName: string; contentType: string; bytes: Uint8Array } {
  const row = objectOf(value, '社保费用导入文件')
  if (typeof row.fileName !== 'string' || !row.fileName.trim()) throw new Error('fileName不能为空')
  if (typeof row.base64 !== 'string' || !row.base64) throw new Error('base64不能为空')
  const bytes = Buffer.from(row.base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('文件内容不能为空')
  return { fileName: row.fileName, contentType: typeof row.contentType === 'string' && row.contentType ? row.contentType : 'application/octet-stream', bytes: new Uint8Array(bytes) }
}
function fileOf (response: AxiosResponse<ArrayBuffer>, fileName: string): InsuranceSalaryInsuranceCostFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('社保费用导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName, contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}
function treeOf (value: unknown, label: string): JsonObject {
  const row = objectOf(value, label)
  return { ...row, id: idOf(row.id, `${label}.id`), name: typeof row.name === 'string' ? row.name : '', children: Array.isArray(row.children) ? row.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [] }
}

export function createInsuranceSalaryInsuranceCostsCapability (request: PortalRequest) {
  const list = async (query: InsuranceSalaryInsuranceCostQuery, view: 'cost' | 'archive'): Promise<PageResult<InsuranceSalaryInsuranceCostRow>> => {
    const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: baseQueryOf(query ?? {}, view) })
    if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('社保费用分页响应缺少有效list或total')
    return { list: result.list.map(rowOf), total: result.total }
  }
  const exportFile = async (query: InsuranceSalaryInsuranceCostQuery & { ids?: InsuranceSalaryInsuranceCostId[] | string | null } = {}, view: 'cost' | 'archive'): Promise<InsuranceSalaryInsuranceCostFile> => {
    return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: exportQueryOf(query, view), responseType: 'arraybuffer' }), view === 'cost' ? '社保费用.xlsx' : '社保归档查询.xlsx')
  }
  return {
    async costList (query: InsuranceSalaryInsuranceCostQuery = {}) { return list(query, 'cost') },
    async archiveList (query: InsuranceSalaryInsuranceCostQuery = {}) { return list(query, 'archive') },
    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('社保费用组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `组织树[${index}]`))
    },
    prepareArchive (input: { items: InsuranceSalaryInsuranceCostMutation[] }) { return { draft: mutationOf(input?.items) } },
    async archive (input: { items: InsuranceSalaryInsuranceCostMutation[] }): Promise<void> { await request({ url: `${ROOT}/archive`, method: 'put', data: mutationOf(input?.items) }) },
    prepareUnarchive (input: { ids: InsuranceSalaryInsuranceCostId[] }) { return { draft: idItemsOf(input?.ids) } },
    async unarchive (input: { ids: InsuranceSalaryInsuranceCostId[] }): Promise<void> { await request({ url: `${ROOT}/unarchive`, method: 'put', data: idItemsOf(input?.ids) }) },
    prepareRemove (input: { ids: InsuranceSalaryInsuranceCostId[] }) { return { draft: idItemsOf(input?.ids) } },
    async remove (input: { ids: InsuranceSalaryInsuranceCostId[] }): Promise<void> { await request({ url: ROOT, method: 'delete', data: idsOf(input?.ids, 'ids') }) },
    prepareUpdateDepositUnit (input: { items: InsuranceSalaryInsuranceCostAssignment[] }) { return { draft: assignmentOf(input?.items, 'depositUnitId') } },
    async updateDepositUnit (input: { items: InsuranceSalaryInsuranceCostAssignment[] }): Promise<void> { await request({ url: `${ROOT}/updateDepositUnit`, method: 'put', data: assignmentOf(input?.items, 'depositUnitId') }) },
    prepareUpdateCostCenter (input: { items: InsuranceSalaryInsuranceCostAssignment[] }) { return { draft: assignmentOf(input?.items, 'costCenterId') } },
    async updateCostCenter (input: { items: InsuranceSalaryInsuranceCostAssignment[] }): Promise<void> { await request({ url: `${ROOT}/updateCostCenter`, method: 'put', data: assignmentOf(input?.items, 'costCenterId') }) },
    prepareCopyArchivedData (input: { oldDate: string; newDate: string }) { return { draft: copyOf(input) } },
    async copyArchivedData (input: { oldDate: string; newDate: string }): Promise<void> { await request({ url: `${ROOT}/importArchiveData`, method: 'put', data: copyOf(input) }) },
    async costExport (query: InsuranceSalaryInsuranceCostQuery & { ids?: InsuranceSalaryInsuranceCostId[] | string | null } = {}) { return exportFile(query, 'cost') },
    async archiveExport (query: InsuranceSalaryInsuranceCostQuery & { ids?: InsuranceSalaryInsuranceCostId[] | string | null } = {}) { return exportFile(query, 'archive') },
    async downloadTemplate (): Promise<InsuranceSalaryInsuranceCostFile> { return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: '/sys/oss/download', method: 'get', params: { fileName: '社保费用模板' }, responseType: 'arraybuffer' }), '社保费用模板') },
    prepareImport (input: InsuranceSalaryInsuranceCostImport) { const file = fileBytesOf(input); return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength } },
    async importExcel (input: InsuranceSalaryInsuranceCostImport): Promise<void> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      await request({ url: `${ROOT}/importExcel`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
    },
  }
}

export type InsuranceSalaryInsuranceCostsCapability = ReturnType<typeof createInsuranceSalaryInsuranceCostsCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const costPageParams: ParamSpec[] = [p('name', 'text'), p('orgIds', 'text', false, '组织ID数组；SDK按Portal转为逗号字符串'), p('archiveStatus', 'enum', false, '1未归档、2已归档'), p('belongMonth', 'date', false, '费用归属月份范围'), p('pageNo', 'number'), p('pageSize', 'number')]
const archivePageParams: ParamSpec[] = [p('name', 'text'), p('orgIds', 'text', false, '组织ID数组；SDK按Portal转为逗号字符串'), p('archiveStatus', 'enum', false, '1未归档、2已归档'), p('isSalaryUsed', 'enum', false, '0未使用、1使用过'), p('belongMonth', 'date', false, '费用归属月份范围'), p('occurMonth', 'date', false, '费用发生月份范围'), p('pageNo', 'number'), p('pageSize', 'number')]
const idsParams: ParamSpec[] = [p('ids', 'text', true, '非空记录ID数组')]
const optionalIdsParams: ParamSpec[] = [p('ids', 'text', false, '可选勾选记录ID数组；省略时导出当前筛选结果')]
const itemsParams: ParamSpec[] = [p('items', 'text', true, '批量记录数组')]
const fileParams: ParamSpec[] = [p('fileName', 'text', true), p('base64', 'text', true), p('contentType', 'text')]

export const INSURANCE_SALARY_INSURANCE_COST_METHODS = {
  'insurance-cost-list': 'costList', 'insurance-cost-organization-tree': 'organizationTree', 'insurance-cost-prepare-archive': 'prepareArchive', 'insurance-cost-archive': 'archive', 'insurance-cost-prepare-remove': 'prepareRemove', 'insurance-cost-remove': 'remove', 'insurance-cost-export': 'costExport', 'insurance-cost-download-template': 'downloadTemplate', 'insurance-cost-prepare-import': 'prepareImport', 'insurance-cost-import': 'importExcel', 'insurance-cost-prepare-update-deposit-unit': 'prepareUpdateDepositUnit', 'insurance-cost-update-deposit-unit': 'updateDepositUnit', 'insurance-cost-prepare-update-cost-center': 'prepareUpdateCostCenter', 'insurance-cost-update-cost-center': 'updateCostCenter', 'insurance-cost-prepare-copy-archived-data': 'prepareCopyArchivedData', 'insurance-cost-copy-archived-data': 'copyArchivedData',
  'insurance-archive-list': 'archiveList', 'insurance-archive-organization-tree': 'organizationTree', 'insurance-archive-prepare-unarchive': 'prepareUnarchive', 'insurance-archive-unarchive': 'unarchive', 'insurance-archive-export': 'archiveExport',
} as const

const costDefinitions: CapabilityDefinition[] = [
  { id: 'insurance-cost-list', title: '查询社保费用', write: false, params: costPageParams }, { id: 'insurance-cost-organization-tree', title: '查询社保费用组织树', write: false, params: [] }, { id: 'insurance-cost-prepare-archive', title: '准备归档社保费用', write: false, params: itemsParams }, { id: 'insurance-cost-archive', title: '归档社保费用', write: true, params: itemsParams }, { id: 'insurance-cost-prepare-remove', title: '准备删除社保费用', write: false, params: idsParams }, { id: 'insurance-cost-remove', title: '删除社保费用', write: true, params: idsParams }, { id: 'insurance-cost-export', title: '导出社保费用', write: false, params: [...costPageParams, ...optionalIdsParams] }, { id: 'insurance-cost-download-template', title: '下载社保费用模板', write: false, params: [] }, { id: 'insurance-cost-prepare-import', title: '准备导入社保费用', write: false, params: fileParams }, { id: 'insurance-cost-import', title: '导入社保费用', write: true, params: fileParams }, { id: 'insurance-cost-prepare-update-deposit-unit', title: '准备调整社保缴存单位', write: false, params: itemsParams }, { id: 'insurance-cost-update-deposit-unit', title: '调整社保缴存单位', write: true, params: itemsParams }, { id: 'insurance-cost-prepare-update-cost-center', title: '准备调整社保成本中心', write: false, params: itemsParams }, { id: 'insurance-cost-update-cost-center', title: '调整社保成本中心', write: true, params: itemsParams }, { id: 'insurance-cost-prepare-copy-archived-data', title: '准备调用历史归档社保费用', write: false, params: [p('oldDate', 'date', true), p('newDate', 'date', true)] }, { id: 'insurance-cost-copy-archived-data', title: '调用历史归档社保费用', write: true, params: [p('oldDate', 'date', true), p('newDate', 'date', true)] },
].map(definition => ({ ...definition, pagePath: INSURANCE_COST_PAGE_PATH, permission: '/dashboard/insurance/cost', moduleType: 14, httpInstance: 'platform' }))
const archiveDefinitions: CapabilityDefinition[] = [
  { id: 'insurance-archive-list', title: '查询社保归档', write: false, params: archivePageParams }, { id: 'insurance-archive-organization-tree', title: '查询社保归档组织树', write: false, params: [] }, { id: 'insurance-archive-prepare-unarchive', title: '准备取消社保归档', write: false, params: idsParams }, { id: 'insurance-archive-unarchive', title: '取消社保归档', write: true, params: idsParams }, { id: 'insurance-archive-export', title: '导出社保归档', write: false, params: [...archivePageParams, ...optionalIdsParams] },
].map(definition => ({ ...definition, pagePath: INSURANCE_ARCHIVE_PAGE_PATH, permission: '/dashboard/insurance/archive', moduleType: 14, httpInstance: 'platform' }))

export const insuranceSalaryInsuranceCostsCapabilities: CapabilityDefinition[] = [...costDefinitions, ...archiveDefinitions]
export const insuranceSalaryInsuranceCostsCapabilitiesByPage = { costDefinitions, archiveDefinitions } as const
