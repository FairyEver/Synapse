import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 财务设置 → 客商基础档案」页面。 */
export const FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH = '/dashboard/finance/setting/opening-supplier/list'
export const FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION = '/dashboard/finance/setting/opening-supplier'
export const FINANCE_SETTING_OPENING_SUPPLIER_MODULE_TYPE = null

const ROOT = '/admin-api/finance/party'
const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'

export const FINANCE_SETTING_OPENING_SUPPLIER_CREATE_PERMISSION = 'finance:setting:business-partner:create'
export const FINANCE_SETTING_OPENING_SUPPLIER_UPDATE_PERMISSION = 'finance:setting:business-partner:update'
export const FINANCE_SETTING_OPENING_SUPPLIER_DELETE_PERMISSION = 'finance:setting:business-partner:delete'
export const FINANCE_SETTING_OPENING_SUPPLIER_IMPORT_PERMISSION = 'finance:setting:business-partner:import'
export const FINANCE_SETTING_OPENING_SUPPLIER_EXPORT_PERMISSION = 'finance:setting:business-partner:export'

export type FinanceSettingOpeningSupplierId = string | number
export type FinanceSettingOpeningSupplierStatus = 0 | 1

export type FinanceSettingOpeningSupplierBankAccount = {
  id: FinanceSettingOpeningSupplierId | null
  bankId: FinanceSettingOpeningSupplierId | null
  bankCode: string | null
  bankName: string | null
  bankBranchName: string | null
  bankAccount: string | null
  bankDescription: string | null
}

export type FinanceSettingOpeningSupplierBankAccountDraft = {
  bankId: FinanceSettingOpeningSupplierId | null
  bankBranchName?: string | null
  bankAccount?: string | null
}

type FinanceSettingOpeningSupplierBankAccountSubmit = {
  bankId: FinanceSettingOpeningSupplierId
  bankBranchName?: string | null
  bankAccount?: string | null
}

export type FinanceSettingOpeningSupplierRow = {
  id: FinanceSettingOpeningSupplierId
  partyType: string | null
  companyId: FinanceSettingOpeningSupplierId | null
  companyName: string | null
  accountingSetId: FinanceSettingOpeningSupplierId | null
  code: string | null
  name: string
  status: FinanceSettingOpeningSupplierStatus
  detail: string | null
  categoryCode: string | null
  categoryId: FinanceSettingOpeningSupplierId | null
  categoryName: string | null
  originalCompanyUpdate: boolean
  originalPartyId: FinanceSettingOpeningSupplierId | null
  originalPartyName: string | null
  bankAccounts: FinanceSettingOpeningSupplierBankAccount[]
  referenced: boolean | null
  remark: string | null
  supplyChainFinance: boolean
  createTime: string | null
  updateTime: string | null
}

export type FinanceSettingOpeningSupplierPage = {
  list: FinanceSettingOpeningSupplierRow[]
  total: number
}

export type FinanceSettingOpeningSupplierCategoryOption = {
  id: FinanceSettingOpeningSupplierId | null
  code: string | null
  name: string
}

export type FinanceSettingOpeningSupplierCompanyTreeNode = {
  id: FinanceSettingOpeningSupplierId
  parentId: FinanceSettingOpeningSupplierId | null
  name: string
  isCorporation: number
  fullName: string | null
  children: FinanceSettingOpeningSupplierCompanyTreeNode[]
}

export type FinanceSettingOpeningSupplierOption = {
  id: FinanceSettingOpeningSupplierId
  sourceType: string | null
  companyId: FinanceSettingOpeningSupplierId | null
  companyName: string | null
  code: string | null
  name: string
  status: FinanceSettingOpeningSupplierStatus
  originalPartyId: FinanceSettingOpeningSupplierId | null
  bankAccounts: FinanceSettingOpeningSupplierBankAccount[]
}

export type FinanceSettingOpeningSupplierListQuery = {
  name?: string | null
  code?: string | null
  categoryCode?: string | null
  companyIds?: FinanceSettingOpeningSupplierId[] | null
  status?: FinanceSettingOpeningSupplierStatus | null
  supplyChainFinance?: boolean | null
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingOpeningSupplierCodeInput = {
  companyId: FinanceSettingOpeningSupplierId
}

export type FinanceSettingOpeningSupplierOriginalOptionsQuery = {
  keyword: string
  companyId?: FinanceSettingOpeningSupplierId | null
  excludeId?: FinanceSettingOpeningSupplierId | null
}

export type FinanceSettingOpeningSupplierCreateInput = {
  name: string
  code?: string | null
  autoAssignCode?: boolean
  companyId: FinanceSettingOpeningSupplierId
  categoryCode?: string | null
  originalCompanyUpdate: boolean
  originalPartyId?: FinanceSettingOpeningSupplierId | null
  supplyChainFinance?: boolean
  bankAccounts?: FinanceSettingOpeningSupplierBankAccountDraft[] | null
  status?: FinanceSettingOpeningSupplierStatus
  detail?: string | null
  remark?: string | null
}

export type FinanceSettingOpeningSupplierSaveDraft = Omit<FinanceSettingOpeningSupplierCreateInput, 'code' | 'autoAssignCode' | 'supplyChainFinance' | 'status' | 'bankAccounts'> & {
  id?: FinanceSettingOpeningSupplierId
  code: string
  autoAssignCode: boolean
  supplyChainFinance: boolean
  status: FinanceSettingOpeningSupplierStatus
  bankAccounts: FinanceSettingOpeningSupplierBankAccountSubmit[]
}

export type FinanceSettingOpeningSupplierUpdateChanges = Partial<Pick<
  FinanceSettingOpeningSupplierSaveDraft,
  'categoryCode' | 'originalCompanyUpdate' | 'originalPartyId' | 'supplyChainFinance' | 'detail' | 'remark'
>> & {
  bankAccounts?: FinanceSettingOpeningSupplierBankAccountDraft[] | null
}

export type FinanceSettingOpeningSupplierUpdateInput = {
  current: FinanceSettingOpeningSupplierRow | FinanceSettingOpeningSupplierSaveDraft
  changes?: FinanceSettingOpeningSupplierUpdateChanges | null
}

export type FinanceSettingOpeningSupplierPreparedUpdate = {
  draft: FinanceSettingOpeningSupplierSaveDraft & { id: FinanceSettingOpeningSupplierId }
  previous: FinanceSettingOpeningSupplierSaveDraft & { id: FinanceSettingOpeningSupplierId }
}

export type FinanceSettingOpeningSupplierStatusDraft = {
  id: FinanceSettingOpeningSupplierId
  status: FinanceSettingOpeningSupplierStatus
}

export type FinanceSettingOpeningSupplierFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type FinanceSettingOpeningSupplierFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type FinanceSettingOpeningSupplierDownloadedFile = FinanceSettingOpeningSupplierFilePreview & {
  base64: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingOpeningSupplierId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingOpeningSupplierId | null {
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

function keywordOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必须提供非空关键字`)
  return value
}

function boundedTextOf (value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  const result = textOf(value, label)
  if (result.length > max) throw new Error(`${label}不能超过${max}个字符`)
  if (required && result.trim() === '') throw new Error(`${label}不能为空`)
  return result
}

function booleanOf (value: unknown, label: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${label}必须为boolean`)
  return value
}

function nullableBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  return booleanOf(value, label)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingOpeningSupplierStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function numberOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label}必须为非负安全整数`)
  return Number(value)
}

function bankAccountResponseOf (value: unknown, label: string): FinanceSettingOpeningSupplierBankAccount {
  const row = objectOf(value, label)
  return {
    id: nullableIdOf(row.id, `${label}.id`),
    bankId: nullableIdOf(row.bankId, `${label}.bankId`),
    bankCode: boundedTextOf(row.bankCode, `${label}.bankCode`, 500),
    bankName: boundedTextOf(row.bankName, `${label}.bankName`, 500),
    bankBranchName: boundedTextOf(row.bankBranchName, `${label}.bankBranchName`, 500),
    bankAccount: boundedTextOf(row.bankAccount, `${label}.bankAccount`, 50),
    bankDescription: boundedTextOf(row.bankDescription, `${label}.bankDescription`, 500),
  }
}

function hasBankId (value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function bankAccountsOf (value: unknown, label: string): FinanceSettingOpeningSupplierBankAccountSubmit[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  const accounts: FinanceSettingOpeningSupplierBankAccountSubmit[] = []
  value.forEach((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    const bankId = nullableIdOf(row.bankId, `${label}[${index}].bankId`)
    const bankBranchName = boundedTextOf(row.bankBranchName, `${label}[${index}].bankBranchName`, 500)
    const bankAccount = boundedTextOf(row.bankAccount, `${label}[${index}].bankAccount`, 50)
    const hasAnyValue = hasBankId(row.bankId) || Boolean(bankBranchName) || Boolean(bankAccount)
    if (!hasAnyValue) return
    if (bankId === null) throw new Error(`${label}[${index}]已填写收款信息时必须选择所属银行`)
    if (bankAccount !== null && !/^\d{1,50}$/.test(bankAccount)) throw new Error(`${label}[${index}].bankAccount只能包含数字且最长50位`)
    accounts.push({ bankId, bankBranchName, bankAccount })
  })
  return accounts
}

function partyRowOf (value: unknown, label = '客商档案'): FinanceSettingOpeningSupplierRow {
  const row = objectOf(value, label)
  const name = requiredTextOf(row.name, `${label}.name`)
  if (name.length > 500) throw new Error(`${label}.name不能超过500个字符`)
  return {
    id: idOf(row.id, `${label}.id`),
    partyType: boundedTextOf(row.partyType, `${label}.partyType`, 100),
    companyId: nullableIdOf(row.companyId, `${label}.companyId`),
    companyName: boundedTextOf(row.companyName, `${label}.companyName`, 500),
    accountingSetId: nullableIdOf(row.accountingSetId, `${label}.accountingSetId`),
    code: boundedTextOf(row.code, `${label}.code`, 500),
    name,
    status: statusOf(row.status, `${label}.status`),
    detail: boundedTextOf(row.detail, `${label}.detail`, 500),
    categoryCode: boundedTextOf(row.categoryCode, `${label}.categoryCode`, 100),
    categoryId: nullableIdOf(row.categoryId, `${label}.categoryId`),
    categoryName: boundedTextOf(row.categoryName, `${label}.categoryName`, 500),
    originalCompanyUpdate: booleanOf(row.originalCompanyUpdate, `${label}.originalCompanyUpdate`, false),
    originalPartyId: nullableIdOf(row.originalPartyId, `${label}.originalPartyId`),
    originalPartyName: boundedTextOf(row.originalPartyName, `${label}.originalPartyName`, 500),
    bankAccounts: (row.bankAccounts === undefined || row.bankAccounts === null ? [] : row.bankAccounts as unknown[]).map((item, index) => bankAccountResponseOf(item, `${label}.bankAccounts[${index}]`)),
    referenced: nullableBooleanOf(row.referenced, `${label}.referenced`),
    remark: boundedTextOf(row.remark, `${label}.remark`, 500),
    supplyChainFinance: booleanOf(row.supplyChainFinance, `${label}.supplyChainFinance`, false),
    createTime: boundedTextOf(row.createTime, `${label}.createTime`, 100),
    updateTime: boundedTextOf(row.updateTime, `${label}.updateTime`, 100),
  }
}

function pageOf (value: unknown): FinanceSettingOpeningSupplierPage {
  const page = objectOf(value, '客商基础档案分页响应')
  if (!Array.isArray(page.list)) throw new Error('客商基础档案分页响应list必须是数组')
  return { list: page.list.map((item, index) => partyRowOf(item, `客商基础档案分页响应.list[${index}]`)), total: numberOf(page.total, '客商基础档案分页响应.total') }
}

function categoryOptionOf (value: unknown, label: string): FinanceSettingOpeningSupplierCategoryOption {
  const option = objectOf(value, label)
  return { id: nullableIdOf(option.id, `${label}.id`), code: boundedTextOf(option.code, `${label}.code`, 100), name: requiredTextOf(option.name, `${label}.name`) }
}

function companyTreeNodeOf (value: unknown, label: string): FinanceSettingOpeningSupplierCompanyTreeNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const isCorporation = numberOf(node.isCorporation, `${label}.isCorporation`)
  if (isCorporation !== 0 && isCorporation !== 1) throw new Error(`${label}.isCorporation只能是0或1`)
  return {
    id: idOf(node.id, `${label}.id`),
    parentId: nullableIdOf(node.parentId ?? node.pid, `${label}.parentId`),
    name: requiredTextOf(node.name, `${label}.name`),
    isCorporation,
    fullName: boundedTextOf(node.fullName, `${label}.fullName`, 500),
    children: children.map((item, index) => companyTreeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function optionOf (value: unknown, label: string): FinanceSettingOpeningSupplierOption {
  const option = objectOf(value, label)
  return {
    id: idOf(option.id, `${label}.id`),
    sourceType: boundedTextOf(option.sourceType, `${label}.sourceType`, 100),
    companyId: nullableIdOf(option.companyId, `${label}.companyId`),
    companyName: boundedTextOf(option.companyName, `${label}.companyName`, 500),
    code: boundedTextOf(option.code, `${label}.code`, 500),
    name: requiredTextOf(option.name, `${label}.name`),
    status: statusOf(option.status, `${label}.status`),
    originalPartyId: nullableIdOf(option.originalPartyId, `${label}.originalPartyId`),
    bankAccounts: (option.bankAccounts === undefined || option.bankAccounts === null ? [] : option.bankAccounts as unknown[]).map((item, index) => bankAccountResponseOf(item, `${label}.bankAccounts[${index}]`)),
  }
}

function filterValueOf (value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return textOf(value, label)
}

function idListOf (value: unknown, label: string): FinanceSettingOpeningSupplierId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function listParamsOf (query: FinanceSettingOpeningSupplierListQuery = {}, includePaging = true, includeOrder = true): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...(includeOrder ? { order: '', orderField: '' } : {}),
    name: filterValueOf(query.name, 'name') ?? '',
    code: filterValueOf(query.code, 'code') ?? '',
    companyIds: idListOf(query.companyIds, 'companyIds'),
  }
  const categoryCode = filterValueOf(query.categoryCode, 'categoryCode')
  if (categoryCode !== undefined) params.categoryCode = categoryCode
  if (query.status !== undefined) params.status = query.status === null ? null : statusOf(query.status)
  else params.status = 0
  if (query.supplyChainFinance !== undefined) params.supplyChainFinance = query.supplyChainFinance === null ? null : booleanOf(query.supplyChainFinance, 'supplyChainFinance')
  if (includePaging) {
    params.pageNo = pageNumberOf(query.pageNo, 1, 'pageNo')
    params.pageSize = pageNumberOf(query.pageSize, 20, 'pageSize')
  }
  return params
}

function bankDraftForSubmit (value: unknown, label: string): FinanceSettingOpeningSupplierBankAccountSubmit[] {
  return bankAccountsOf(value, label)
}

function saveDraftOf (input: unknown, label: string, requireId: boolean): FinanceSettingOpeningSupplierSaveDraft & { id?: FinanceSettingOpeningSupplierId } {
  const value = objectOf(input, label)
  const id = requireId ? idOf(value.id, `${label}.id`) : value.id === undefined ? undefined : idOf(value.id, `${label}.id`)
  const name = boundedTextOf(value.name, `${label}.name`, 500, true)!
  const autoAssignCode = booleanOf(value.autoAssignCode, `${label}.autoAssignCode`, false)
  const code = boundedTextOf(value.code, `${label}.code`, 500, !autoAssignCode) ?? ''
  if (code !== '' && !/^[A-Za-z0-9]{1,500}$/.test(code)) throw new Error(`${label}.code只能包含字母和数字，最多500个字符`)
  const originalCompanyUpdate = booleanOf(value.originalCompanyUpdate, `${label}.originalCompanyUpdate`)
  const originalPartyId = nullableIdOf(value.originalPartyId, `${label}.originalPartyId`)
  if (originalCompanyUpdate && originalPartyId === null) throw new Error(`${label}.originalPartyId在originalCompanyUpdate为true时不能为空`)
  const companyId = idOf(value.companyId, `${label}.companyId`)
  const categoryCode = filterValueOf(value.categoryCode, `${label}.categoryCode`)
  const status = statusOf(value.status === undefined ? 0 : value.status, `${label}.status`)
  const detail = boundedTextOf(value.detail, `${label}.detail`, 500)
  const remark = boundedTextOf(value.remark, `${label}.remark`, 500)
  const draft: FinanceSettingOpeningSupplierSaveDraft & { id?: FinanceSettingOpeningSupplierId } = {
    ...(id === undefined ? {} : { id }),
    name,
    code,
    autoAssignCode,
    companyId,
    ...(categoryCode === undefined ? {} : { categoryCode }),
    originalCompanyUpdate,
    ...(originalPartyId === null ? {} : { originalPartyId }),
    supplyChainFinance: booleanOf(value.supplyChainFinance, `${label}.supplyChainFinance`, false),
    bankAccounts: bankDraftForSubmit(value.bankAccounts, `${label}.bankAccounts`),
    status,
  }
  if (detail !== null) draft.detail = detail
  if (remark !== null) draft.remark = remark
  return draft
}

function createDraftOf (input: FinanceSettingOpeningSupplierCreateInput): FinanceSettingOpeningSupplierSaveDraft {
  return saveDraftOf(input, '客商基础档案创建输入', false)
}

function updatePayloadOf (input: FinanceSettingOpeningSupplierUpdateInput): FinanceSettingOpeningSupplierPreparedUpdate {
  const previous = saveDraftOf(input?.current, '客商基础档案编辑当前值', true) as FinanceSettingOpeningSupplierSaveDraft & { id: FinanceSettingOpeningSupplierId }
  const changes = input?.changes === undefined || input?.changes === null ? {} : objectOf(input.changes, '客商基础档案编辑变更')
  const allowed = new Set(['categoryCode', 'originalCompanyUpdate', 'originalPartyId', 'supplyChainFinance', 'bankAccounts', 'detail', 'remark'])
  for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`客商基础档案编辑变更不支持字段${key}`)
  const merged = { ...previous, ...changes }
  const draft = saveDraftOf(merged, '客商基础档案编辑草稿', true) as FinanceSettingOpeningSupplierSaveDraft & { id: FinanceSettingOpeningSupplierId }
  return { draft, previous }
}

function draftSubmitOf (input: unknown, label: string, requireId: boolean): FinanceSettingOpeningSupplierSaveDraft & { id?: FinanceSettingOpeningSupplierId } {
  const value = objectOf(input, label)
  return saveDraftOf(value.draft, `${label}.draft`, requireId)
}

function statusDraftOf (input: unknown, label: string): FinanceSettingOpeningSupplierStatusDraft {
  const value = objectOf(input, label)
  return { id: idOf(value.id, `${label}.id`), status: statusOf(value.status, `${label}.status`) }
}

function fileInputOf (input: unknown): { preview: FinanceSettingOpeningSupplierFilePreview; bytes: Uint8Array } {
  const value = objectOf(input, '客商基础档案导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('导入文件大小不能超过20MB')
  const contentType = value.contentType === undefined || value.contentType === null || value.contentType === ''
    ? fileName.toLowerCase().endsWith('.xlsx') ? XLSX_MIME : XLS_MIME
    : textOf(value.contentType, 'contentType')
  return { preview: { fileName, contentType, byteLength: bytes.byteLength }, bytes: new Uint8Array(bytes) }
}

function binaryOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('客商基础档案文件响应不是二进制文件')
}

function headerOf (response: AxiosResponse<unknown>, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' && value ? value : null
}

function downloadedFileOf (response: AxiosResponse<unknown>, fallbackName: string): FinanceSettingOpeningSupplierDownloadedFile {
  const bytes = binaryOf(response?.data)
  if (bytes.byteLength === 0) throw new Error('客商基础档案文件响应为空文件')
  return {
    fileName: fallbackName,
    contentType: headerOf(response, 'content-type') ?? XLSX_MIME,
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function formDataOf (input: unknown): FormData {
  const file = fileInputOf(input)
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

export type FinanceSettingOpeningSupplierApi = {
  list: (query?: FinanceSettingOpeningSupplierListQuery) => Promise<FinanceSettingOpeningSupplierPage>
  listCategoryOptions: () => Promise<FinanceSettingOpeningSupplierCategoryOption[]>
  companyTree: () => Promise<FinanceSettingOpeningSupplierCompanyTreeNode[]>
  get: (input: { id: FinanceSettingOpeningSupplierId }) => Promise<FinanceSettingOpeningSupplierRow>
  originalOptions: (input: FinanceSettingOpeningSupplierOriginalOptionsQuery) => Promise<FinanceSettingOpeningSupplierOption[]>
  generateCode: (input: FinanceSettingOpeningSupplierCodeInput) => Promise<string>
  prepareCreate: (input: FinanceSettingOpeningSupplierCreateInput) => { draft: FinanceSettingOpeningSupplierSaveDraft }
  create: (input: { draft: FinanceSettingOpeningSupplierSaveDraft }) => Promise<FinanceSettingOpeningSupplierId>
  prepareUpdate: (input: FinanceSettingOpeningSupplierUpdateInput) => FinanceSettingOpeningSupplierPreparedUpdate
  update: (input: { draft: FinanceSettingOpeningSupplierSaveDraft & { id: FinanceSettingOpeningSupplierId } }) => Promise<true>
  prepareChangeStatus: (input: FinanceSettingOpeningSupplierStatusDraft) => { draft: FinanceSettingOpeningSupplierStatusDraft }
  changeStatus: (input: { draft: FinanceSettingOpeningSupplierStatusDraft }) => Promise<true>
  prepareDelete: (input: { id: FinanceSettingOpeningSupplierId }) => { draft: { id: FinanceSettingOpeningSupplierId } }
  delete: (input: { draft: { id: FinanceSettingOpeningSupplierId } }) => Promise<true>
  downloadTemplate: () => Promise<FinanceSettingOpeningSupplierDownloadedFile>
  prepareImport: (input: FinanceSettingOpeningSupplierFileInput) => FinanceSettingOpeningSupplierFilePreview
  importFile: (input: FinanceSettingOpeningSupplierFileInput) => Promise<number>
  export: (query?: FinanceSettingOpeningSupplierListQuery) => Promise<FinanceSettingOpeningSupplierDownloadedFile>
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createFinanceSettingOpeningSupplierCapability (request: PortalRequest): FinanceSettingOpeningSupplierApi {
  return {
    async list (query = {}) {
      const result = await request({ url: `${ROOT}/page`, method: 'post', data: listParamsOf(query) })
      return pageOf(result)
    },

    async listCategoryOptions () {
      const result = await request<unknown>({ url: `${ROOT}/category-options`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('客商分类候选响应必须是数组')
      return result.map((item, index) => categoryOptionOf(item, `客商分类候选[${index}]`))
    },

    async companyTree () {
      const result = await request<unknown>({ url: `${ROOT}/company-tree`, method: 'get' })
      if (!Array.isArray(result)) throw new Error('客商所属公司树响应必须是数组')
      return result.map((item, index) => companyTreeNodeOf(item, `客商所属公司树[${index}]`))
    },

    async get (input) {
      const id = idOf(input?.id, '客商档案id')
      return partyRowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '客商档案详情')
    },

    async originalOptions (input) {
      const params: Record<string, unknown> = { keyword: keywordOf(input?.keyword, '原客商关键字') }
      if (input.companyId !== undefined) params.companyId = input.companyId === null ? null : idOf(input.companyId, 'companyId')
      if (input.excludeId !== undefined) params.excludeId = input.excludeId === null ? null : idOf(input.excludeId, 'excludeId')
      const result = await request<unknown>({ url: `${ROOT}/original-options`, method: 'get', params })
      if (!Array.isArray(result)) throw new Error('原客商候选响应必须是数组')
      return result.map((item, index) => optionOf(item, `原客商候选[${index}]`))
    },

    async generateCode (input) {
      const companyId = idOf(input?.companyId, 'companyId')
      const result = await request<unknown>({ url: `${ROOT}/generate-code`, method: 'get', params: { companyId } })
      return requiredTextOf(result, '客商编码')
    },

    prepareCreate (input) {
      return { draft: createDraftOf(input) }
    },

    async create (input) {
      const draft = draftSubmitOf(input, '客商基础档案创建提交', false)
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: draft })
      return idOf(result, '客商基础档案创建返回的id')
    },

    prepareUpdate (input) {
      return updatePayloadOf(input)
    },

    async update (input) {
      const draft = draftSubmitOf(input, '客商基础档案编辑提交', true)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft })
      return trueResult(result, '客商基础档案编辑')
    },

    prepareChangeStatus (input) {
      return { draft: statusDraftOf(input, '客商基础档案启停输入') }
    },

    async changeStatus (input) {
      const draft = statusDraftOf(input?.draft, '客商基础档案启停提交.draft')
      const result = await request<unknown>({ url: `${ROOT}/change-status`, method: 'put', data: draft })
      return trueResult(result, '客商基础档案启停')
    },

    prepareDelete (input) {
      return { draft: { id: idOf(input?.id, '客商档案id') } }
    },

    async delete (input) {
      const draft = objectOf(input?.draft, '客商基础档案删除提交.draft')
      const id = idOf(draft.id, '客商基础档案删除提交.draft.id')
      const result = await request<unknown>({ url: `${ROOT}/delete`, method: 'delete', params: { id } })
      return trueResult(result, '客商基础档案删除')
    },

    async downloadTemplate () {
      return downloadedFileOf(await request<AxiosResponse<unknown>>({ url: `${ROOT}/template`, method: 'get', responseType: 'arraybuffer' }), '客商基础档案导入模板.xlsx')
    },

    prepareImport (input) {
      return fileInputOf(input).preview
    },

    async importFile (input) {
      const result = await request<unknown>({ url: `${ROOT}/import`, method: 'post', data: formDataOf(input), headers: { 'Content-Type': 'multipart/form-data' } })
      return numberOf(result, '客商基础档案导入条数')
    },

    async export (query = {}) {
      return downloadedFileOf(await request<AxiosResponse<unknown>>({ url: `${ROOT}/export`, method: 'post', data: listParamsOf(query, false, false), responseType: 'arraybuffer' }), '客商基础档案.xlsx')
    },
  }
}

export type FinanceSettingOpeningSupplierCapability = ReturnType<typeof createFinanceSettingOpeningSupplierCapability>
export type FinanceSettingOpeningSupplierCapabilityWithIdempotency = FinanceSettingOpeningSupplierCapability & {
  createIdempotent: (input: { draft: FinanceSettingOpeningSupplierSaveDraft; requestId: string }) => Promise<FinanceSettingOpeningSupplierId>
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const statusParam: ParamSpec = { name: 'status', kind: 'enum', required: false, description: '状态：0启用、1停用；列表默认0', options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }] }
const bankAccountsParam: ParamSpec = p('bankAccounts', 'text', false, '收款信息数组；至少填写一项时每行必须有bankId，银行账号只允许数字且最多50位')
const createParams: ParamSpec[] = [
  p('name', 'text', true, '公司/个人名称，最多500个字符'),
  p('code', 'text', false, '编码；autoAssignCode=false时必填，只允许字母和数字且最多500个字符'),
  p('autoAssignCode', 'boolean', false, '是否让服务端自动分配编码；Portal会先按所属公司调用generate-code展示预览'),
  p('companyId', 'search', true, '所属法人公司ID，必须来自companyTree中isCorporation=1的节点'),
  p('categoryCode', 'text', false, '分类科目编码；来自listCategoryOptions，可省略'),
  p('originalCompanyUpdate', 'boolean', true, '是否为原公司更新；为true时originalPartyId必填'),
  p('originalPartyId', 'search', false, '直接原客商ID；来自originalOptions，不能指向自身'),
  p('supplyChainFinance', 'boolean', false, '是否为供应链金融档案；省略按Portal默认false'),
  bankAccountsParam,
  statusParam,
  p('detail', 'text', false, '明细/描述，最多500个字符；页面当前表单未展示，可从详情快照保留'),
  p('remark', 'text', false, '备注，最多500个字符；页面当前表单未展示，可从详情快照保留'),
]
const draftParam: ParamSpec = p('draft', 'text', true, '对应prepare能力返回的完整草稿；不要手写或删除服务端需要的字段')

export const FINANCE_SETTING_OPENING_SUPPLIER_METHODS = {
  'finance-setting-opening-supplier-list': 'list',
  'finance-setting-opening-supplier-category-options': 'listCategoryOptions',
  'finance-setting-opening-supplier-company-tree': 'companyTree',
  'finance-setting-opening-supplier-get': 'get',
  'finance-setting-opening-supplier-original-options': 'originalOptions',
  'finance-setting-opening-supplier-generate-code': 'generateCode',
  'finance-setting-opening-supplier-prepare-create': 'prepareCreate',
  'finance-setting-opening-supplier-create': 'create',
  'finance-setting-opening-supplier-prepare-update': 'prepareUpdate',
  'finance-setting-opening-supplier-update': 'update',
  'finance-setting-opening-supplier-prepare-change-status': 'prepareChangeStatus',
  'finance-setting-opening-supplier-change-status': 'changeStatus',
  'finance-setting-opening-supplier-prepare-delete': 'prepareDelete',
  'finance-setting-opening-supplier-delete': 'delete',
  'finance-setting-opening-supplier-download-template': 'downloadTemplate',
  'finance-setting-opening-supplier-prepare-import': 'prepareImport',
  'finance-setting-opening-supplier-import': 'importFile',
  'finance-setting-opening-supplier-export': 'export',
} as const

const queryParams: ParamSpec[] = [
  p('name', 'text', false, '公司/个人名称模糊筛选；页面默认空字符串'),
  p('code', 'text', false, '编码模糊筛选；页面默认空字符串'),
  p('categoryCode', 'text', false, '分类编码；清空时省略或传null'),
  p('companyIds', 'tree', false, '所属公司ID数组；默认空数组，服务端再与当前用户有权限公司求交'),
  statusParam,
  p('supplyChainFinance', 'boolean', false, '供应链金融档案筛选；省略表示不过滤'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '每页条数；默认20，页面支持10、20、50、100'),
]
const fileParams: ParamSpec[] = [
  p('fileName', 'text', true, '文件名；仅支持.xlsx或.xls'),
  p('base64', 'text', true, '文件内容标准Base64；解码后不能为空且不超过20MB'),
  p('contentType', 'text', false, '文件MIME；省略时按扩展名推导'),
]

export const financeSettingOpeningSupplierCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-opening-supplier-list', title: '分页查询客商基础档案', write: false, params: queryParams },
  { id: 'finance-setting-opening-supplier-category-options', title: '查询客商分类候选', write: false, params: [] },
  { id: 'finance-setting-opening-supplier-company-tree', title: '查询客商所属公司树', write: false, params: [] },
  { id: 'finance-setting-opening-supplier-get', title: '查询客商基础档案详情', write: false, params: [p('id', 'search', true, '客商档案主键ID')] },
  { id: 'finance-setting-opening-supplier-original-options', title: '按关键字搜索原客商候选', write: false, params: [p('companyId', 'search', false, '可选法人公司ID；当前Portal页面省略'), p('excludeId', 'search', false, '编辑时排除当前客商ID'), p('keyword', 'text', true, '编码或名称关键字；必须提供非空关键字')] },
  { id: 'finance-setting-opening-supplier-generate-code', title: '按所属公司生成客商编码', write: false, params: [p('companyId', 'search', true, '所属法人公司ID')] },
  { id: 'finance-setting-opening-supplier-prepare-create', title: '准备创建客商基础档案', write: false, params: createParams },
  { id: 'finance-setting-opening-supplier-create', title: '创建客商基础档案', write: true, params: [draftParam] },
  { id: 'finance-setting-opening-supplier-prepare-update', title: '准备编辑客商基础档案', write: false, params: [p('current', 'text', true, '最新详情或列表行快照'), p('changes', 'text', false, '用户明确修改的分类、原公司关系、供应链金融标识、银行账户、明细或备注')] },
  { id: 'finance-setting-opening-supplier-update', title: '编辑客商基础档案', write: true, params: [draftParam] },
  { id: 'finance-setting-opening-supplier-prepare-change-status', title: '准备启停客商基础档案', write: false, params: [p('id', 'search', true, '客商档案ID'), statusParam] },
  { id: 'finance-setting-opening-supplier-change-status', title: '启停客商基础档案', write: true, params: [draftParam] },
  { id: 'finance-setting-opening-supplier-prepare-delete', title: '准备删除客商基础档案', write: false, params: [p('id', 'search', true, '客商档案ID')] },
  { id: 'finance-setting-opening-supplier-delete', title: '删除客商基础档案', write: true, params: [draftParam] },
  { id: 'finance-setting-opening-supplier-download-template', title: '下载客商基础档案导入模板', write: false, params: [] },
  { id: 'finance-setting-opening-supplier-prepare-import', title: '准备导入客商基础档案文件', write: false, params: fileParams },
  { id: 'finance-setting-opening-supplier-import', title: '导入客商基础档案', write: true, params: fileParams },
  { id: 'finance-setting-opening-supplier-export', title: '导出客商基础档案', write: false, params: queryParams.slice(0, 6) },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_OPENING_SUPPLIER_PAGE_PATH,
  permission: FINANCE_SETTING_OPENING_SUPPLIER_PERMISSION,
  moduleType: FINANCE_SETTING_OPENING_SUPPLIER_MODULE_TYPE,
  httpInstance: 'platform',
}))
