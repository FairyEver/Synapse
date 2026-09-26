import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 员工借款额度」；静态锚点 Portal f61fdca151、Java 7aeaca409d5。 */
export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH = '/dashboard/finance/setting/employee-loan-amount/list'
export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PERMISSION = '/dashboard/finance/setting/employee-loan-amount'
export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_MODULE_TYPE = null

const ROOT = '/admin-api/finance/employee-loan-quota'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'
const XML_MIME = 'application/xml'

export type FinanceSettingEmployeeLoanAmountId = string | number
export type FinanceSettingEmployeeLoanAmountEmployeeType = 1 | 2

export type FinanceSettingEmployeeLoanAmountQuery = {
  employeeName?: string | null
  phone?: string | null
  organizationIds?: FinanceSettingEmployeeLoanAmountId[]
  employeeTypes?: FinanceSettingEmployeeLoanAmountEmployeeType[]
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingEmployeeLoanAmountRow = {
  id: FinanceSettingEmployeeLoanAmountId
  employeeName: string
  employeeNo: string | null
  idCardNo: string
  phone: string | null
  gender: number | null
  genderName: string | null
  age: number | null
  organizationId: FinanceSettingEmployeeLoanAmountId | null
  organizationName: string | null
  position: string | null
  employeeType: number | null
  employeeTypeName: string | null
  loanQuota: number | string
  debtAmount: number | string | null
  availableQuota: number | string | null
  quotaStartDate: string
  quotaEndDate: string
  quotaPeriod: string | null
  createTime: string | null
}

export type FinanceSettingEmployeeLoanAmountFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type FinanceSettingEmployeeLoanAmountFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type FinanceSettingEmployeeLoanAmountFile = FinanceSettingEmployeeLoanAmountFilePreview & {
  base64: string
}

export type FinanceSettingEmployeeLoanAmountImportFailure = {
  rowNum: number
  employeeName: string | null
  idCardNo: string | null
  reason: string
}

export type FinanceSettingEmployeeLoanAmountImportResult = {
  successCount: number
  failCount: number
  failList: FinanceSettingEmployeeLoanAmountImportFailure[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingEmployeeLoanAmountId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingEmployeeLoanAmountId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const result = textOf(value, label)
  if (result.trim() === '') throw new Error(`${label}不能为空`)
  return result
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return Number(value)
}

function amountOf (value: unknown, label: string, required = false): number | string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(value)) return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error(`${label}不是有效日期`)
  return value
}

function nullableDateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function idListOf (value: unknown, label: string): FinanceSettingEmployeeLoanAmountId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function employeeTypesOf (value: unknown): FinanceSettingEmployeeLoanAmountEmployeeType[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('employeeTypes必须是数组')
  return value.map((item, index) => {
    if (item !== 1 && item !== 2) throw new Error(`employeeTypes[${index}]只能是1（内部）或2（外部）`)
    return item
  })
}

function filterTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function queryOf (query: FinanceSettingEmployeeLoanAmountQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    employeeName: filterTextOf(query.employeeName, 'employeeName'),
    phone: filterTextOf(query.phone, 'phone'),
    organizationIds: idListOf(query.organizationIds, 'organizationIds'),
    employeeTypes: employeeTypesOf(query.employeeTypes),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FinanceSettingEmployeeLoanAmountRow {
  const row = objectOf(value, '员工借款额度列表行')
  return {
    id: idOf(row.id, '员工借款额度id'),
    employeeName: requiredTextOf(row.employeeName, 'employeeName'),
    employeeNo: nullableTextOf(row.employeeNo, 'employeeNo'),
    idCardNo: requiredTextOf(row.idCardNo, 'idCardNo'),
    phone: nullableTextOf(row.phone, 'phone'),
    gender: nullableIntegerOf(row.gender, 'gender'),
    genderName: nullableTextOf(row.genderName, 'genderName'),
    age: nullableIntegerOf(row.age, 'age'),
    organizationId: nullableIdOf(row.organizationId, 'organizationId'),
    organizationName: nullableTextOf(row.organizationName, 'organizationName'),
    position: nullableTextOf(row.position, 'position'),
    employeeType: nullableIntegerOf(row.employeeType, 'employeeType'),
    employeeTypeName: nullableTextOf(row.employeeTypeName, 'employeeTypeName'),
    loanQuota: amountOf(row.loanQuota, 'loanQuota', true) as number | string,
    debtAmount: amountOf(row.debtAmount, 'debtAmount'),
    availableQuota: amountOf(row.availableQuota, 'availableQuota'),
    quotaStartDate: dateOf(row.quotaStartDate, 'quotaStartDate'),
    quotaEndDate: dateOf(row.quotaEndDate, 'quotaEndDate'),
    quotaPeriod: nullableTextOf(row.quotaPeriod, 'quotaPeriod'),
    createTime: nullableTextOf(row.createTime, 'createTime'),
  }
}

function pageOf (value: unknown): PageResult<FinanceSettingEmployeeLoanAmountRow> {
  const page = objectOf(value, '员工借款额度分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('员工借款额度分页响应缺少有效list或total')
  return { list: page.list.map(rowOf), total: Number(page.total) }
}

function contentTypeOf (fileName: string, value: unknown): string {
  if (value !== undefined && value !== null && value !== '') {
    if (typeof value !== 'string') throw new Error('contentType必须为字符串')
    return value
  }
  const lower = fileName.toLowerCase()
  return lower.endsWith('.xlsx') ? XLSX_MIME : lower.endsWith('.xls') ? XLS_MIME : XML_MIME
}

function fileInputOf (input: unknown): { preview: FinanceSettingEmployeeLoanAmountFilePreview; bytes: Uint8Array } {
  const value = objectOf(input, '员工借款额度导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xml|xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  const contentType = contentTypeOf(fileName, value.contentType)
  return { preview: { fileName, contentType, byteLength: bytes.byteLength }, bytes: new Uint8Array(bytes) }
}

function binaryOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('员工借款额度模板响应不是二进制文件')
}

function headerOf (response: AxiosResponse, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' && value ? value : null
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>): FinanceSettingEmployeeLoanAmountFile {
  const bytes = binaryOf(response?.data)
  if (bytes.byteLength === 0) throw new Error('员工借款额度模板响应为空文件')
  return {
    fileName: '员工借款额度导入模板.xlsx',
    contentType: headerOf(response, 'content-type') ?? XLSX_MIME,
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function importFailureOf (value: unknown, index: number): FinanceSettingEmployeeLoanAmountImportFailure {
  const failure = objectOf(value, `failList[${index}]`)
  const rowNum = failure.rowNum
  if (!Number.isSafeInteger(rowNum) || Number(rowNum) < 1) throw new Error(`failList[${index}].rowNum必须为正整数`)
  return {
    rowNum: Number(rowNum),
    employeeName: nullableTextOf(failure.employeeName, `failList[${index}].employeeName`),
    idCardNo: nullableTextOf(failure.idCardNo, `failList[${index}].idCardNo`),
    reason: requiredTextOf(failure.reason, `failList[${index}].reason`),
  }
}

function importResultOf (value: unknown): FinanceSettingEmployeeLoanAmountImportResult {
  const result = objectOf(value, '员工借款额度导入响应')
  if (!Number.isSafeInteger(result.successCount) || Number(result.successCount) < 0) throw new Error('successCount必须为非负整数')
  if (!Number.isSafeInteger(result.failCount) || Number(result.failCount) < 0) throw new Error('failCount必须为非负整数')
  if (!Array.isArray(result.failList)) throw new Error('failList必须为数组')
  return {
    successCount: Number(result.successCount),
    failCount: Number(result.failCount),
    failList: result.failList.map(importFailureOf),
  }
}

function formDataOf (file: { preview: FinanceSettingEmployeeLoanAmountFilePreview; bytes: Uint8Array }): FormData {
  const data = new FormData()
  data.append('file', new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

export function createFinanceSettingEmployeeLoanAmountCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingEmployeeLoanAmountQuery = {}): Promise<PageResult<FinanceSettingEmployeeLoanAmountRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'post', data: queryOf(query) }))
    },

    async downloadTemplate (): Promise<FinanceSettingEmployeeLoanAmountFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', responseType: 'arraybuffer' }))
    },

    prepareImport (input: FinanceSettingEmployeeLoanAmountFileInput): FinanceSettingEmployeeLoanAmountFilePreview {
      return fileInputOf(input).preview
    },

    async importFile (input: FinanceSettingEmployeeLoanAmountFileInput): Promise<FinanceSettingEmployeeLoanAmountImportResult> {
      const file = fileInputOf(input)
      return importResultOf(await request<unknown>({ url: `${ROOT}/import`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } }))
    },
  }
}

export type FinanceSettingEmployeeLoanAmountCapability = ReturnType<typeof createFinanceSettingEmployeeLoanAmountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const employeeTypeOptions = [{ label: '内部', value: 1 }, { label: '外部', value: 2 }]
const fileParams: ParamSpec[] = [
  p('fileName', 'text', true, '上传文件名；Portal文件控件接受.xml、.xlsx、.xls'),
  p('base64', 'text', true, '非空标准Base64文件内容'),
  p('contentType', 'text', false, '文件MIME类型；省略时按文件扩展名推导'),
]

export const FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_METHODS = {
  'finance-setting-employee-loan-amount-list': 'list',
  'finance-setting-employee-loan-amount-download-template': 'downloadTemplate',
  'finance-setting-employee-loan-amount-prepare-import': 'prepareImport',
  'finance-setting-employee-loan-amount-import': 'importFile',
} as const

export const financeSettingEmployeeLoanAmountCapabilities: CapabilityDefinition[] = [
  {
    id: 'finance-setting-employee-loan-amount-list',
    title: '查询员工借款额度',
    write: false,
    params: [
      p('employeeName', 'text', false, '员工姓名筛选；默认null'),
      p('phone', 'text', false, '联系电话筛选；默认null'),
      p('organizationIds', 'tree', false, '所属组织ID数组；默认[]，应使用组织树选择结果中的ID'),
      { ...p('employeeTypes', 'enum', false, '员工属性多选；默认[]，1内部、2外部'), options: employeeTypeOptions },
      p('pageNo', 'number', false, '页码；默认1'),
      p('pageSize', 'number', false, '每页条数；默认20，只支持10、20、50、100'),
    ],
  },
  {
    id: 'finance-setting-employee-loan-amount-download-template',
    title: '下载员工借款额度导入模板',
    write: false,
    params: [],
  },
  {
    id: 'finance-setting-employee-loan-amount-prepare-import',
    title: '准备导入员工借款额度',
    write: false,
    params: fileParams,
  },
  {
    id: 'finance-setting-employee-loan-amount-import',
    title: '导入员工借款额度',
    write: true,
    params: fileParams,
  },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PAGE_PATH,
  permission: FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_PERMISSION,
  moduleType: FINANCE_SETTING_EMPLOYEE_LOAN_AMOUNT_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
