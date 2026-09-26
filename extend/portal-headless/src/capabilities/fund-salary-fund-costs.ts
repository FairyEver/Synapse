import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「公积金 → 公积金费用 / 公积金归档查询」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FUND_COST_PAGE_PATH = '/dashboard/fund/cost/list'
export const FUND_ARCHIVE_PAGE_PATH = '/dashboard/fund/archive/list'
const ROOT = '/salary/salaryfundcosts'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type FundSalaryCostId = string | number
export type FundSalaryArchiveStatus = 1 | 2
export type FundSalaryUsed = 0 | 1
export type FundMonthRange = readonly [string | null | undefined, string | null | undefined] | readonly string[]

export type FundSalaryCostQuery = {
  name?: string | null
  orgIds?: FundSalaryCostId[] | string | null
  archiveStatus?: FundSalaryArchiveStatus
  isSalaryUsed?: FundSalaryUsed | null
  belongMonth?: FundMonthRange | null
  occurMonth?: FundMonthRange | null
  pageNo?: number
  pageSize?: number
}

export type FundSalaryCostRow = {
  id: FundSalaryCostId
  staffCode: FundSalaryCostId | null
  name: string | null
  organizationPath: string | null
  postName: string | null
  idCard: string | null
  insuredArea: string | null
  depositUnitName: string | null
  depositUnitId: FundSalaryCostId | null
  costDate: string | null
  occurredDate: string | null
  totalCost: number | string | null
  costType: number | null
  operatorName: string | null
  operateTime: string | number | null
  costCenterName: string | null
  costCenterId: FundSalaryCostId | null
  companyBase: number | string | null
  individualBase: number | string | null
  companyRatio: number | string | null
  individualRatio: number | string | null
  companyCost: number | string | null
  individualCost: number | string | null
  archiveStatus: FundSalaryArchiveStatus
  salaryDocumentIds: string | null
  salaryDocumentIdNames: string | null
  isDel: number | null
  creator: FundSalaryCostId | null
  createTime: string | number | null
  updater: FundSalaryCostId | null
  updateTime: string | number | null
}

export type FundSalaryCostMutationItem = { id: FundSalaryCostId; occurredDate: string }
export type FundSalaryCostIdItem = { id: FundSalaryCostId }
export type FundSalaryCostFileInput = { fileName: string; base64: string; contentType?: string }
export type FundSalaryCostFile = { fileName: string; contentType: string | null; base64: string; byteLength: number }
export type FundSalaryOrganizationNode = { id: FundSalaryCostId; name: string; children: FundSalaryOrganizationNode[]; [key: string]: unknown }

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FundSalaryCostId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FundSalaryCostId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return integerOf(value, label)
}

function nullableAmountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function nullableDateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function archiveStatusOf (value: unknown, label = 'archiveStatus'): FundSalaryArchiveStatus {
  if (value !== 1 && value !== 2) throw new Error(`${label}只能是数值1（未归档）或2（已归档）`)
  return value
}

function usedOf (value: unknown, label = 'isSalaryUsed'): FundSalaryUsed | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（未使用）或1（使用过）`)
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function nameOf (value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('name必须为字符串或null')
  return value
}

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM或null`)
  return value
}

function rangeMonthOf (value: FundMonthRange | null | undefined, index: 0 | 1, label: string): string | null {
  if (value === undefined || value === null) return null
  return monthOf(value[index], `${label}[${index}]`)
}

function idsOf (value: unknown, label: string, allowEmpty = true): FundSalaryCostId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  if (!allowEmpty && value.length === 0) throw new Error(`${label}不能为空`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function orgIdsOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') {
    if (!value) return ''
    value.split(',').forEach((item, index) => idOf(item, `orgIds[${index}]`))
    return value
  }
  return idsOf(value, 'orgIds').join(',')
}

function queryOf (query: FundSalaryCostQuery, view: 'cost' | 'archive'): Record<string, unknown> {
  const base = view === 'archive'
    ? {
        archiveStatus: archiveStatusOf(query.archiveStatus ?? 2),
        orgIds: orgIdsOf(query.orgIds),
        isSalaryUsed: usedOf(query.isSalaryUsed),
        name: nameOf(query.name),
      }
    : {
        orgIds: orgIdsOf(query.orgIds),
        name: nameOf(query.name),
        archiveStatus: archiveStatusOf(query.archiveStatus ?? 1),
      }
  return {
    order: '', orderField: '',
    ...base,
    costDateStart: rangeMonthOf(query.belongMonth, 0, 'belongMonth'),
    costDateEnd: rangeMonthOf(query.belongMonth, 1, 'belongMonth'),
    ...(view === 'archive' ? {
      occurredDateStart: rangeMonthOf(query.occurMonth, 0, 'occurMonth'),
      occurredDateEnd: rangeMonthOf(query.occurMonth, 1, 'occurMonth'),
    } : {}),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FundSalaryCostRow {
  const row = objectOf(value, '公积金费用列表行')
  return {
    id: idOf(row.id, '公积金费用id'),
    staffCode: nullableIdOf(row.staffCode, 'staffCode'),
    name: nullableTextOf(row.name, 'name'),
    organizationPath: nullableTextOf(row.organizationPath, 'organizationPath'),
    postName: nullableTextOf(row.postName, 'postName'),
    idCard: nullableTextOf(row.idCard, 'idCard'),
    insuredArea: nullableTextOf(row.insuredArea, 'insuredArea'),
    depositUnitName: nullableTextOf(row.depositUnitName, 'depositUnitName'),
    depositUnitId: nullableIdOf(row.depositUnitId, 'depositUnitId'),
    costDate: nullableTextOf(row.costDate, 'costDate'),
    occurredDate: nullableTextOf(row.occurredDate, 'occurredDate'),
    totalCost: nullableAmountOf(row.totalCost, 'totalCost'),
    costType: nullableIntegerOf(row.costType, 'costType'),
    operatorName: nullableTextOf(row.operatorName, 'operatorName'),
    operateTime: nullableDateTimeOf(row.operateTime, 'operateTime'),
    costCenterName: nullableTextOf(row.costCenterName, 'costCenterName'),
    costCenterId: nullableIdOf(row.costCenterId, 'costCenterId'),
    companyBase: nullableAmountOf(row.companyBase, 'companyBase'),
    individualBase: nullableAmountOf(row.individualBase, 'individualBase'),
    companyRatio: nullableAmountOf(row.companyRatio, 'companyRatio'),
    individualRatio: nullableAmountOf(row.individualRatio, 'individualRatio'),
    companyCost: nullableAmountOf(row.companyCost, 'companyCost'),
    individualCost: nullableAmountOf(row.individualCost, 'individualCost'),
    archiveStatus: archiveStatusOf(row.archiveStatus),
    salaryDocumentIds: nullableTextOf(row.salaryDocumentIds, 'salaryDocumentIds'),
    salaryDocumentIdNames: nullableTextOf(row.salaryDocumentIdNames, 'salaryDocumentIdNames'),
    isDel: nullableIntegerOf(row.isDel, 'isDel'),
    creator: nullableIdOf(row.creator, 'creator'),
    createTime: nullableDateTimeOf(row.createTime, 'createTime'),
    updater: nullableIdOf(row.updater, 'updater'),
    updateTime: nullableDateTimeOf(row.updateTime, 'updateTime'),
  }
}

function pageOf (value: unknown): PageResult<FundSalaryCostRow> {
  const page = objectOf(value, '公积金费用分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('公积金费用分页响应缺少有效list或total')
  return { list: page.list.map(rowOf), total: page.total }
}

function monthInputOf (value: unknown, label: string): string {
  const month = monthOf(value, label)
  if (!month) throw new Error(`${label}不能为空`)
  return month
}

function mutationItemsOf (value: unknown, requireDate: boolean): FundSalaryCostMutationItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('公积金费用操作项不能为空')
  return value.map((item, index) => {
    const row = objectOf(item, `公积金费用操作项[${index}]`)
    return {
      id: idOf(row.id, `公积金费用操作项[${index}].id`),
      occurredDate: requireDate ? monthInputOf(row.occurredDate, `公积金费用操作项[${index}].occurredDate`) : '',
    }
  })
}

function idItemsOf (value: unknown): FundSalaryCostIdItem[] {
  const ids = idsOf(value, 'ids', false)
  return ids.map(id => ({ id }))
}

function fileBytesOf (input: FundSalaryCostFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '文件输入')
  if (typeof value.fileName !== 'string' || !value.fileName.trim()) throw new Error('fileName不能为空')
  if (typeof value.base64 !== 'string' || !value.base64) throw new Error('base64不能为空')
  let bytes: Buffer
  try { bytes = Buffer.from(value.base64, 'base64') } catch { throw new Error('base64不是有效文件内容') }
  if (bytes.byteLength === 0) throw new Error('文件内容不能为空')
  return { fileName: value.fileName, contentType: typeof value.contentType === 'string' && value.contentType ? value.contentType : 'application/octet-stream', bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: FundSalaryCostFileInput) {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fileName: string): FundSalaryCostFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('公积金文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName, contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

function treeNodeOf (value: unknown, label: string): FundSalaryOrganizationNode {
  const node = objectOf(value, label)
  return { ...node, id: idOf(node.id, `${label}.id`), name: typeof node.name === 'string' ? node.name : '', children: Array.isArray(node.children) ? node.children.map((child, index) => treeNodeOf(child, `${label}.children[${index}]`)) : [] }
}

function copyArchivedDraftOf (input: { oldDate: string; newDate: string }) {
  return { oldDate: monthInputOf(input?.oldDate, 'oldDate'), newDate: monthInputOf(input?.newDate, 'newDate') }
}

export function createFundSalaryFundCostsCapability (request: PortalRequest) {
  const list = async (query: FundSalaryCostQuery = {}, view: 'cost' | 'archive'): Promise<PageResult<FundSalaryCostRow>> => pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query, view) }))
  const exportFile = async (query: FundSalaryCostQuery & { ids?: FundSalaryCostId[] | string | null }, view: 'cost' | 'archive'): Promise<FundSalaryCostFile> => {
    const params = queryOf(query, view)
    const ids = orgIdsOf(query.ids)
    delete params.pageNo
    delete params.pageSize
    delete params.order
    delete params.orderField
    return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: { type: view === 'cost' ? 1 : 2, ...params, ids }, responseType: 'arraybuffer' }), view === 'cost' ? '公积金费用.xlsx' : '公积金归档查询.xlsx')
  }
  const prepareBatch = (input: { items: FundSalaryCostMutationItem[] }): { draft: FundSalaryCostMutationItem[] } => ({ draft: mutationItemsOf(input?.items, true) })
  const prepareIds = (input: { ids: FundSalaryCostId[] }): { draft: FundSalaryCostIdItem[] } => ({ draft: idItemsOf(input?.ids) })
  const prepareAssignment = (input: { items: Array<{ id: FundSalaryCostId; targetId: FundSalaryCostId }> }): { draft: Array<{ id: FundSalaryCostId; targetId: FundSalaryCostId }> } => {
    if (!Array.isArray(input?.items) || input.items.length === 0) throw new Error('公积金费用调整项不能为空')
    return { draft: input.items.map((item, index) => ({ id: idOf(item?.id, `调整项[${index}].id`), targetId: idOf(item?.targetId, `调整项[${index}].targetId`) })) }
  }
  return {
    async costList (query: FundSalaryCostQuery = {}) { return list(query, 'cost') },
    async archiveList (query: FundSalaryCostQuery = {}) { return list(query, 'archive') },
    async organizationTree (): Promise<FundSalaryOrganizationNode[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('公积金组织树响应必须是数组')
      return result.map((item, index) => treeNodeOf(item, `组织树[${index}]`))
    },
    prepareArchive: prepareBatch,
    async archive (input: { items: FundSalaryCostMutationItem[] }): Promise<void> {
      await request({ url: `${ROOT}/archive`, method: 'put', data: prepareBatch(input).draft })
    },
    prepareUnarchive (input: { ids: FundSalaryCostId[] }): { draft: FundSalaryCostIdItem[] } { return prepareIds(input) },
    async unarchive (input: { ids: FundSalaryCostId[] }): Promise<void> {
      await request({ url: `${ROOT}/unarchive`, method: 'put', data: prepareIds(input).draft })
    },
    prepareRemove: prepareIds,
    async remove (input: { ids: FundSalaryCostId[] }): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: prepareIds(input).draft.map(item => item.id) })
    },
    async costExport (query: FundSalaryCostQuery & { ids?: FundSalaryCostId[] | string | null } = {}) { return exportFile(query, 'cost') },
    async archiveExport (query: FundSalaryCostQuery & { ids?: FundSalaryCostId[] | string | null } = {}) { return exportFile(query, 'archive') },
    async downloadTemplate (): Promise<FundSalaryCostFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: '/sys/oss/download', method: 'get', params: { fileName: '公积金费用模板' }, responseType: 'arraybuffer' }), '公积金费用模板')
    },
    prepareImport (input: FundSalaryCostFileInput) { return filePreviewOf(input) },
    async importExcel (input: FundSalaryCostFileInput): Promise<void> {
      const file = fileBytesOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      await request({ url: `${ROOT}/importExcel`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
    },
    prepareUpdateDepositUnit (input: { items: Array<{ id: FundSalaryCostId; depositUnitId: FundSalaryCostId }> }) { return prepareAssignment({ items: input.items.map(item => ({ id: item.id, targetId: item.depositUnitId })) }) },
    async updateDepositUnit (input: { items: Array<{ id: FundSalaryCostId; depositUnitId: FundSalaryCostId }> }): Promise<void> {
      const draft = prepareAssignment({ items: input.items.map(item => ({ id: item.id, targetId: item.depositUnitId })) }).draft
      await request({ url: `${ROOT}/updateDepositUnit`, method: 'put', data: draft.map(item => ({ id: item.id, depositUnitId: item.targetId })) })
    },
    prepareUpdateCostCenter (input: { items: Array<{ id: FundSalaryCostId; costCenterId: FundSalaryCostId }> }) { return prepareAssignment({ items: input.items.map(item => ({ id: item.id, targetId: item.costCenterId })) }) },
    async updateCostCenter (input: { items: Array<{ id: FundSalaryCostId; costCenterId: FundSalaryCostId }> }): Promise<void> {
      const draft = prepareAssignment({ items: input.items.map(item => ({ id: item.id, targetId: item.costCenterId })) }).draft
      await request({ url: `${ROOT}/updateCostCenter`, method: 'put', data: draft.map(item => ({ id: item.id, costCenterId: item.targetId })) })
    },
    prepareCopyArchivedData (input: { oldDate: string; newDate: string }) {
      return { draft: copyArchivedDraftOf(input) }
    },
    async copyArchivedData (input: { oldDate: string; newDate: string }): Promise<void> {
      await request({ url: `${ROOT}/copyArchivedData`, method: 'put', data: copyArchivedDraftOf(input) })
    },
  }
}

export type FundSalaryFundCostsCapability = ReturnType<typeof createFundSalaryFundCostsCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const pageParams: ParamSpec[] = [p('name', 'text'), p('orgIds', 'text', false, '组织ID数组；SDK按Portal转换为逗号字符串'), p('archiveStatus', 'enum', false, '1未归档，2已归档'), p('isSalaryUsed', 'enum', false, '0未使用，1使用过'), p('belongMonth', 'date', false, '月份范围，转换为costDateStart/costDateEnd'), p('occurMonth', 'date', false, '月份范围，转换为occurredDateStart/occurredDateEnd'), p('pageNo', 'number'), p('pageSize', 'number')]
const idsParams: ParamSpec[] = [p('ids', 'text', true, '非空记录ID数组')]
const optionalIdsParams: ParamSpec[] = [p('ids', 'text', false, '可选勾选记录ID数组；省略时导出当前筛选结果')]
const mutationParams: ParamSpec[] = [p('items', 'text', true, '记录ID和费用发生月份数组')]

export const FUND_SALARY_FUND_COST_METHODS = {
  'fund-cost-list': 'costList', 'fund-cost-organization-tree': 'organizationTree', 'fund-cost-prepare-archive': 'prepareArchive', 'fund-cost-archive': 'archive', 'fund-cost-prepare-remove': 'prepareRemove', 'fund-cost-remove': 'remove', 'fund-cost-export': 'costExport', 'fund-cost-download-template': 'downloadTemplate', 'fund-cost-prepare-import': 'prepareImport', 'fund-cost-import': 'importExcel', 'fund-cost-prepare-update-deposit-unit': 'prepareUpdateDepositUnit', 'fund-cost-update-deposit-unit': 'updateDepositUnit', 'fund-cost-prepare-update-cost-center': 'prepareUpdateCostCenter', 'fund-cost-update-cost-center': 'updateCostCenter', 'fund-cost-prepare-copy-archived-data': 'prepareCopyArchivedData', 'fund-cost-copy-archived-data': 'copyArchivedData',
  'fund-archive-list': 'archiveList', 'fund-archive-organization-tree': 'organizationTree', 'fund-archive-prepare-unarchive': 'prepareUnarchive', 'fund-archive-unarchive': 'unarchive', 'fund-archive-export': 'archiveExport',
} as const

const costDefinitions: CapabilityDefinition[] = [
  { id: 'fund-cost-list', title: '查询公积金费用', write: false, params: pageParams },
  { id: 'fund-cost-organization-tree', title: '查询公积金费用组织树', write: false, params: [] },
  { id: 'fund-cost-prepare-archive', title: '准备归档公积金费用', write: false, params: mutationParams },
  { id: 'fund-cost-archive', title: '归档公积金费用', write: true, params: mutationParams },
  { id: 'fund-cost-prepare-remove', title: '准备删除公积金费用', write: false, params: idsParams },
  { id: 'fund-cost-remove', title: '删除公积金费用', write: true, params: idsParams },
  { id: 'fund-cost-export', title: '导出公积金费用', write: false, params: [...pageParams, ...optionalIdsParams] },
  { id: 'fund-cost-download-template', title: '下载公积金费用模板', write: false, params: [] },
  { id: 'fund-cost-prepare-import', title: '准备导入公积金费用', write: false, params: [p('fileName', 'text', true), p('base64', 'text', true), p('contentType', 'text')] },
  { id: 'fund-cost-import', title: '导入公积金费用', write: true, params: [p('fileName', 'text', true), p('base64', 'text', true), p('contentType', 'text')] },
  { id: 'fund-cost-prepare-update-deposit-unit', title: '准备调整公积金缴存单位', write: false, params: [p('items', 'text', true)] },
  { id: 'fund-cost-update-deposit-unit', title: '调整公积金缴存单位', write: true, params: [p('items', 'text', true)] },
  { id: 'fund-cost-prepare-update-cost-center', title: '准备调整公积金成本中心', write: false, params: [p('items', 'text', true)] },
  { id: 'fund-cost-update-cost-center', title: '调整公积金成本中心', write: true, params: [p('items', 'text', true)] },
  { id: 'fund-cost-prepare-copy-archived-data', title: '准备调用历史归档费用', write: false, params: [p('oldDate', 'date', true), p('newDate', 'date', true)] },
  { id: 'fund-cost-copy-archived-data', title: '调用历史归档费用', write: true, params: [p('oldDate', 'date', true), p('newDate', 'date', true)] },
].map(definition => ({ ...definition, pagePath: FUND_COST_PAGE_PATH, permission: '/dashboard/fund/cost', moduleType: 14, httpInstance: 'platform' }))

const archiveDefinitions: CapabilityDefinition[] = [
  { id: 'fund-archive-list', title: '查询公积金归档', write: false, params: pageParams },
  { id: 'fund-archive-organization-tree', title: '查询公积金归档组织树', write: false, params: [] },
  { id: 'fund-archive-prepare-unarchive', title: '准备取消公积金归档', write: false, params: idsParams },
  { id: 'fund-archive-unarchive', title: '取消公积金归档', write: true, params: idsParams },
  { id: 'fund-archive-export', title: '导出公积金归档', write: false, params: [...pageParams, ...optionalIdsParams] },
].map(definition => ({ ...definition, pagePath: FUND_ARCHIVE_PAGE_PATH, permission: '/dashboard/fund/archive', moduleType: 14, httpInstance: 'platform' }))

export const fundSalaryFundCostsCapabilities: CapabilityDefinition[] = [...costDefinitions, ...archiveDefinitions]
export const fundSalaryFundCostsCapabilitiesByPage = { costDefinitions, archiveDefinitions } as const
