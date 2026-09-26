import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「薪资管理 → 工资导入」；只覆盖当前列表页真实可达的查询、导入、模板下载和批量删除。 */
export const SALARY_ADJUST_IMPORT_PAGE_PATH = '/dashboard/salary/adjust-import/list'
export const SALARY_ADJUST_IMPORT_PERMISSION = '/dashboard/salary/adjust-import'
export const SALARY_ADJUST_IMPORT_MODULE_TYPE = 14

const ROOT = '/salary/salarysheet'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type SalaryAdjustImportId = string | number
export type SalaryAdjustImportAmount = number | string | null
export type SalaryAdjustImportFileInput = { fileName: string; base64: string; contentType?: string | null }
export type SalaryAdjustImportFilePreview = { fileName: string; contentType: string; byteLength: number }
export type SalaryAdjustImportFile = SalaryAdjustImportFilePreview & { base64: string }

export const SALARY_ADJUST_IMPORT_AMOUNT_FIELDS = [
  'basicSalary', 'performanceSalary', 'commissionSalary', 'overtimeSalary', 'educationAllowance', 'seniorityAllowance',
  'communicationAllowance', 'laborFee', 'enclosureFee', 'dutyFee', 'otherSalary', 'heatstrokeFee', 'heatingFee',
  'rentalAllowance', 'onlyChildAllowance', 'otherWelfare', 'bonus', 'mealAllowance', 'laborProtectionFee', 'grossSalary',
  'pensionInsurance', 'unemploymentInsurance', 'medicalInsurance', 'majorMedicalInsurance', 'socialInsurance',
  'housingFund', 'taxableSalary', 'personalIncomeTax', 'carPurchaseDeduction', 'housePurchaseDeduction',
  'otherDeductions', 'healthInsuranceDeduction', 'totalDeductions', 'netSalary', 'profitEvaluationSalary',
] as const
type SalaryAdjustImportAmountField = typeof SALARY_ADJUST_IMPORT_AMOUNT_FIELDS[number]

export type SalaryAdjustImportRow = Record<string, unknown> & {
  id: SalaryAdjustImportId
  staffCode: SalaryAdjustImportId | null
  salaryDate: string | null
  name: string | null
  fullPath: string | null
  updaterName: string | null
  updateTime: string | number | null
  isDel: number | null
  creator: SalaryAdjustImportId | null
  createTime: string | number | null
  updater: SalaryAdjustImportId | null
  tenantId: SalaryAdjustImportId | null
} & { [key in SalaryAdjustImportAmountField]: SalaryAdjustImportAmount }

export type SalaryAdjustImportQuery = {
  salaryDate?: string | null
  orgId?: SalaryAdjustImportId | '' | null
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SalaryAdjustImportId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数或十进制正整数字符串`)
}

function optionalIdOf (value: unknown, label: string): SalaryAdjustImportId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function amountOf (value: unknown, label: string): SalaryAdjustImportAmount {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function monthOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM或null`)
  return value
}

function salaryDateParamOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error('salaryDate必须为YYYY-MM、YYYY-MM-01或空值')
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) return `${value}-01`
  if (/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value)) return value
  throw new Error('salaryDate必须为YYYY-MM或YYYY-MM-01')
}

function organizationIdOf (value: unknown): SalaryAdjustImportId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, 'orgId')
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result
}

function queryOf (input: SalaryAdjustImportQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    salaryDate: salaryDateParamOf(input.salaryDate),
    orgId: organizationIdOf(input.orgId),
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, index: number): SalaryAdjustImportRow {
  const row = objectOf(value, `工资导入列表[${index}]`)
  const result: Record<string, unknown> = {
    ...row,
    id: idOf(row.id, `工资导入列表[${index}].id`),
    staffCode: optionalIdOf(row.staffCode, `工资导入列表[${index}].staffCode`),
    salaryDate: monthOf(row.salaryDate, `工资导入列表[${index}].salaryDate`),
    name: textOf(row.name, `工资导入列表[${index}].name`),
    fullPath: textOf(row.fullPath, `工资导入列表[${index}].fullPath`),
    updaterName: textOf(row.updaterName, `工资导入列表[${index}].updaterName`),
    updateTime: dateTimeOf(row.updateTime, `工资导入列表[${index}].updateTime`),
    isDel: integerOf(row.isDel, `工资导入列表[${index}].isDel`),
    creator: optionalIdOf(row.creator, `工资导入列表[${index}].creator`),
    createTime: dateTimeOf(row.createTime, `工资导入列表[${index}].createTime`),
    updater: optionalIdOf(row.updater, `工资导入列表[${index}].updater`),
    tenantId: optionalIdOf(row.tenantId, `工资导入列表[${index}].tenantId`),
  }
  for (const field of SALARY_ADJUST_IMPORT_AMOUNT_FIELDS) result[field] = amountOf(row[field], `工资导入列表[${index}].${field}`)
  return result as SalaryAdjustImportRow
}

function pageOf (value: unknown): PageResult<SalaryAdjustImportRow> {
  const page = objectOf(value, '工资导入分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('工资导入分页响应缺少有效list或total')
  return { list: page.list.map((row, index) => rowOf(row, index)), total: page.total }
}

function treeOf (value: unknown, label: string): JsonObject {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    children: Array.isArray(row.children) ? row.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [],
  }
}

function idsOf (value: unknown): SalaryAdjustImportId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('工资导入ids必须是非空数组')
  const ids = value.map((item, index) => idOf(item, `工资导入ids[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('工资导入ids不能包含重复ID')
  return ids
}

function fileInputOf (value: unknown): { preview: SalaryAdjustImportFilePreview; bytes: Uint8Array } {
  const input = objectOf(value, '工资导入文件')
  if (typeof input.fileName !== 'string' || input.fileName.trim() === '' || !/\.xlsx$/i.test(input.fileName)) throw new Error('工资导入文件.fileName扩展名必须为.xlsx')
  if (typeof input.base64 !== 'string' || input.base64.trim() === '') throw new Error('工资导入文件.base64不能为空')
  const base64 = input.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('工资导入文件.base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('工资导入文件不能为空')
  const contentType = input.contentType === undefined || input.contentType === null || input.contentType === '' ? XLSX_MIME : input.contentType
  if (contentType !== XLSX_MIME) throw new Error('工资导入文件.contentType必须为Portal接受的xlsx MIME类型')
  return { preview: { fileName: input.fileName, contentType, byteLength: bytes.byteLength }, bytes: new Uint8Array(bytes) }
}

function formDataOf (file: { preview: SalaryAdjustImportFilePreview; bytes: Uint8Array }): FormData {
  const data = new FormData()
  data.append('file', new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

function headerOf (response: AxiosResponse<ArrayBuffer>, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()]
  return typeof value === 'string' && value ? value : null
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>): SalaryAdjustImportFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('工资导入模板下载响应为空文件')
  const disposition = headerOf(response, 'content-disposition')
  const encodedName = disposition ? /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] : undefined
  const plainName = disposition ? /filename="?([^";]+)"?/i.exec(disposition)?.[1] : undefined
  let fileName = '工资导入模板.xlsx'
  try { fileName = encodedName ? decodeURIComponent(encodedName.replace(/^"|"$/g, '')) : plainName ?? fileName } catch { fileName = encodedName ?? plainName ?? fileName }
  return {
    fileName,
    contentType: headerOf(response, 'content-type') ?? XLSX_MIME,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createSalaryAdjustImportCapability (request: PortalRequest) {
  return {
    async list (input: SalaryAdjustImportQuery = {}): Promise<PageResult<SalaryAdjustImportRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },

    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('工资导入组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `工资导入组织树[${index}]`))
    },

    prepareImport (input: SalaryAdjustImportFileInput): SalaryAdjustImportFilePreview {
      return fileInputOf(input).preview
    },

    async importExcel (input: SalaryAdjustImportFileInput): Promise<void> {
      await request({ url: `${ROOT}/importExcel`, method: 'post', data: formDataOf(fileInputOf(input)), headers: { 'Content-Type': 'multipart/form-data' } })
    },

    async downloadTemplate (): Promise<SalaryAdjustImportFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/downloadTemplate`, method: 'get', params: { fileName: '考核结果导入模板' }, responseType: 'arraybuffer' }))
    },

    prepareRemove (input: { ids: SalaryAdjustImportId[] }): { ids: SalaryAdjustImportId[] } {
      return { ids: idsOf(input?.ids) }
    },

    async remove (input: { ids: SalaryAdjustImportId[] }): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: idsOf(input?.ids) })
    },
  }
}

export type SalaryAdjustImportCapability = ReturnType<typeof createSalaryAdjustImportCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('salaryDate', 'date', false, '工资月份；Portal月份选择器最终发送该月第一天YYYY-MM-01，省略为空字符串'), p('orgId', 'text', false, '角色组织树中的组织ID；省略为空字符串'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')]
const fileParams = [p('fileName', 'text', true, '仅支持.xlsx文件名'), p('base64', 'text', true, 'Excel文件内容的标准Base64'), p('contentType', 'text', false, `Portal接受的固定MIME：${XLSX_MIME}`)]
const idsParam = p('ids', 'text', true, '当前列表选中的工资记录ID数组；至少一项且不能重复')

export const SALARY_ADJUST_IMPORT_METHODS = {
  'salary-adjust-import-list': 'list',
  'salary-adjust-import-organization-tree': 'organizationTree',
  'salary-adjust-import-prepare-import': 'prepareImport',
  'salary-adjust-import-import': 'importExcel',
  'salary-adjust-import-download-template': 'downloadTemplate',
  'salary-adjust-import-prepare-remove': 'prepareRemove',
  'salary-adjust-import-remove': 'remove',
} as const

export const salaryAdjustImportCapabilities: CapabilityDefinition[] = [
  { id: 'salary-adjust-import-list', title: '查询工资导入记录', write: false, params: queryParams },
  { id: 'salary-adjust-import-organization-tree', title: '查询工资导入角色组织树', write: false, params: [] },
  { id: 'salary-adjust-import-prepare-import', title: '准备导入工资Excel', write: false, params: fileParams },
  { id: 'salary-adjust-import-import', title: '导入工资Excel', write: true, params: fileParams },
  { id: 'salary-adjust-import-download-template', title: '下载工资导入模板', write: false, params: [] },
  { id: 'salary-adjust-import-prepare-remove', title: '准备删除工资导入记录', write: false, params: [idsParam] },
  { id: 'salary-adjust-import-remove', title: '删除工资导入记录', write: true, params: [idsParam] },
].map(definition => ({
  ...definition,
  pagePath: SALARY_ADJUST_IMPORT_PAGE_PATH,
  permission: SALARY_ADJUST_IMPORT_PERMISSION,
  moduleType: SALARY_ADJUST_IMPORT_MODULE_TYPE,
  httpInstance: 'platform',
}))
