import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 财务设置 → 期初设置」页面。 */
export const FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH = '/dashboard/finance/setting/initial-manage/list'
export const FINANCE_SETTING_INITIAL_MANAGE_PERMISSION = '/dashboard/finance/setting/initial-manage'
export const FINANCE_SETTING_INITIAL_MANAGE_MODULE_TYPE = null

const ROOT = '/admin-api/finance/opening-setting'
const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'

export const OPENING_SETTING_QUERY_PERMISSION = 'finance:setting:opening-setting:query'
export const OPENING_SETTING_IMPORT_PERMISSION = 'finance:setting:opening-setting:import'
export const OPENING_SETTING_TRIAL_PERMISSION = 'finance:setting:opening-setting:trial'
export const OPENING_SETTING_RECONCILE_PERMISSION = 'finance:setting:opening-setting:reconcile'

export type FinanceSettingInitialManageId = string | number
export type OpeningSettingTabCode =
  | 'SUBJECT'
  | 'SUPPLIER'
  | 'CUSTOMER'
  | 'BIO_LAYING_HEN'
  | 'BIO_GROWING_CHICKEN'
  | 'BANK_STATEMENT'

export type OpeningSettingTab = {
  code: OpeningSettingTabCode
  name: string
  sort: number
}

export type OpeningSettingTabStatus = {
  tabType: OpeningSettingTabCode
  tabName: string | null
  imported: boolean
  batchId: FinanceSettingInitialManageId | null
  versionNo: number | null
  rowCount: number | null
  trialStatus: number | null
  reconcileStatus: number | null
  importTime: string | null
}

export type OpeningSettingStatus = {
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
  sourcePeriodMonth: string | null
  locked: boolean
  disabledReason: string | null
  tabs: OpeningSettingTabStatus[]
}

export type OpeningSettingCommonRow = {
  id: FinanceSettingInitialManageId
  rowNo: number | null
  accountingSetCode: string | null
  accountingSetName: string | null
  matchStatus: number | null
  errorMessage: string | null
}

export type OpeningSettingRow = Record<string, unknown> & OpeningSettingCommonRow & {
  subjectType?: string | null
  subjectCode?: string | null
  subjectName?: string | null
  endingDebitAmount?: number | string | null
  endingCreditAmount?: number | string | null
  endingQuantity?: number | string | null
  supplierCode?: string | null
  supplierName?: string | null
  supplierCategoryCode?: string | null
  supplierCategoryName?: string | null
  beginningBalance?: number | string | null
  endingBalance?: number | string | null
  estimatedEndingBalance?: number | string | null
  endingBalanceTotal?: number | string | null
  customerCode?: string | null
  customerName?: string | null
  salesAreaCode?: string | null
  salesAreaName?: string | null
  salesAreaDescription?: string | null
  salesDeptName?: string | null
  salespersonCode?: string | null
  salespersonName?: string | null
  orderNo?: string | null
  batchNo?: string | null
  materialCode?: string | null
  materialName?: string | null
  factoryCode?: string | null
  factoryName?: string | null
  day154Value?: number | string | null
  monthEndQuantity?: number | string | null
  openingOriginalValue?: number | string | null
  endingNetValue?: number | string | null
  accumulatedDepreciation?: number | string | null
  endingStockQuantity?: number | string | null
  endingCostAmount?: number | string | null
  endingUnitPrice?: number | string | null
  externalSubjectCode?: string | null
  externalSubjectName?: string | null
  externalBalanceDirection?: string | null
  financeSubjectCode?: string | null
  financeSubjectName?: string | null
  bankAccountCode?: string | null
  bankAccountName?: string | null
  statementDate?: string | null
  summary?: string | null
  debitAmount?: number | string | null
  creditAmount?: number | string | null
  balanceAmount?: number | string | null
  rowType?: string | null
  summaryLabel?: string | null
  summaryField?: string | null
  summaryValues?: Record<string, string | null>
}

export type OpeningSettingSummaryRow = Record<string, unknown> & {
  id: FinanceSettingInitialManageId | null
  rowNo: number | null
  rowType: string | null
  summaryLabel: string | null
  summaryField: string | null
  summaryValues: Record<string, string | null>
  [key: string]: unknown
}

export type OpeningSettingPage = {
  list: OpeningSettingRow[]
  total: number
  summary?: OpeningSettingSummaryRow | null
  summaryRows?: OpeningSettingSummaryRow[]
}

export type OpeningSettingListQuery = {
  tabType: OpeningSettingTabCode
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
  subjectCode?: string | null
  supplierCode?: string | null
  supplierName?: string | null
  customerCode?: string | null
  customerName?: string | null
  orderNo?: string | null
  batchNo?: string | null
  materialCode?: string | null
  materialName?: string | null
  bankAccountCode?: string | null
  bankAccountName?: string | null
  pageNo?: number
  pageSize?: number
}

export type OpeningSettingContextInput = {
  tabType: OpeningSettingTabCode
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
  accountingSetCode?: string | null
  accountingSetName?: string | null
  accountCode?: string | null
  accountingName?: string | null
}

export type OpeningSettingFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type OpeningSettingFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type OpeningSettingDownloadedFile = OpeningSettingFilePreview & {
  base64: string
}

export type OpeningSettingImportError = {
  rowNo: number
  fieldName: string | null
  errorReason: string | null
}

export type OpeningSettingPeriodImportResult = {
  periodMonth: string | null
  batchId: FinanceSettingInitialManageId | null
  successCount: number
}

export type OpeningSettingImportResult = {
  batchId: FinanceSettingInitialManageId | null
  success: boolean
  successCount: number
  failCount: number
  errors: OpeningSettingImportError[]
  periodResults: OpeningSettingPeriodImportResult[]
}

export type OpeningSettingTrialBalance = {
  balanced: boolean
  totalDebitAmount: number | string | null
  totalCreditAmount: number | string | null
  asset: number | string | null
  cost: number | string | null
  equity: number | string | null
  liability: number | string | null
  profitLoss: number | string | null
  assetCostTotal: number | string | null
  equityLiabilityProfitLossTotal: number | string | null
  differenceAmount: number | string | null
  message: string | null
}

export type OpeningSettingReconcileResult = {
  reconcileNo: string | null
  matched: boolean
  resultCount: number
}

export type OpeningSettingManualMatchResult = {
  updatedCount: number
  allMatchedOrIgnored: boolean
  remainingCount: number
}

export type OpeningSettingDeleteResult = {
  batchId: FinanceSettingInitialManageId | null
  deletedCount: number
  rowCount: number
}

export type OpeningSettingLedgerPostResult = {
  posted: boolean
  subjectCount: number
  customerCount: number
  supplierCount: number
  bankAccountCount: number
}

export type OpeningSettingReconcileResultRow = Record<string, unknown> & {
  id: FinanceSettingInitialManageId
  reconcileNo: string | null
  moduleCode: string | null
  moduleName: string | null
  subjectCode: string | null
  subjectName: string | null
  sourceSystem: string | null
  matchStatus: number | null
  sourceAmount: number | string | null
  financeAmount: number | string | null
  differenceAmount: number | string | null
  sourceQuantity: number | string | null
  financeQuantity: number | string | null
  differenceQuantity: number | string | null
  detailJson: string | null
}

export type OpeningSettingOperationLogRow = {
  id: FinanceSettingInitialManageId
  tabType: OpeningSettingTabCode | null
  operationType: string | null
  operationStatus: number | null
  operatorId: FinanceSettingInitialManageId | null
  operatorName: string | null
  startTime: string | null
  endTime: string | null
  failureDetailJson: string | null
  remark: string | null
}

export type OpeningSettingContextDraft = {
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
}

export type OpeningSettingManualMatchDraft = OpeningSettingContextDraft & {
  tabType: OpeningSettingTabCode
  lineIds: FinanceSettingInitialManageId[]
}

export type OpeningSettingDeleteDraft = OpeningSettingManualMatchDraft & {
  batchId: FinanceSettingInitialManageId
}

export type FinanceSettingInitialManageUpdateForm = Record<string, unknown> & {
  id: FinanceSettingInitialManageId
  openingBalance: string | null
  accumulatedDebit: string | null
  accumulatedCredit: string | null
  beginningBalance: string | null
}

export type FinanceSettingInitialManageUpdateDraft = FinanceSettingInitialManageUpdateForm

export type FinanceSettingInitialManageApi = {
  listTabs: () => Promise<OpeningSettingTab[]>
  getStatus: (input: { accountingSetId: FinanceSettingInitialManageId; periodMonth: string }) => Promise<OpeningSettingStatus>
  list: (query: OpeningSettingListQuery) => Promise<OpeningSettingPage>
  downloadTemplate: (input: OpeningSettingContextInput) => Promise<OpeningSettingDownloadedFile>
  prepareImport: (input: OpeningSettingFileInput) => OpeningSettingFilePreview
  importFile: (input: OpeningSettingContextInput & OpeningSettingFileInput) => Promise<OpeningSettingImportResult>
  prepareTrialBalance: (input: OpeningSettingContextDraft) => { draft: OpeningSettingContextDraft }
  trialBalance: (input: { draft: OpeningSettingContextDraft }) => Promise<OpeningSettingTrialBalance>
  prepareReconcile: (input: OpeningSettingContextDraft) => { draft: OpeningSettingContextDraft }
  reconcile: (input: { draft: OpeningSettingContextDraft }) => Promise<OpeningSettingReconcileResult>
  prepareManualMatch: (input: OpeningSettingManualMatchDraft) => { draft: OpeningSettingManualMatchDraft }
  manualMatch: (input: { draft: OpeningSettingManualMatchDraft }) => Promise<OpeningSettingManualMatchResult>
  prepareDeleteLines: (input: OpeningSettingDeleteDraft) => { draft: OpeningSettingDeleteDraft }
  deleteLines: (input: { draft: OpeningSettingDeleteDraft }) => Promise<OpeningSettingDeleteResult>
  preparePostToLedger: (input: OpeningSettingContextDraft) => { draft: OpeningSettingContextDraft }
  postToLedger: (input: { draft: OpeningSettingContextDraft }) => Promise<OpeningSettingLedgerPostResult>
  prepareUpdate: (input: { form: FinanceSettingInitialManageUpdateForm }) => { draft: FinanceSettingInitialManageUpdateDraft }
  update: (input: { draft: FinanceSettingInitialManageUpdateDraft }) => Promise<void>
  cancelUpdate: () => { cancelled: true }
  listReconcileResults: (input: OpeningSettingReconcileResultQuery) => Promise<{ list: OpeningSettingReconcileResultRow[]; total: number }>
  exportReconcileResults: (input: OpeningSettingReconcileResultExportInput) => Promise<OpeningSettingDownloadedFile>
  listOperationLogs: (input: OpeningSettingOperationLogQuery) => Promise<{ list: OpeningSettingOperationLogRow[]; total: number }>
}

export type OpeningSettingReconcileResultQuery = {
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
  moduleCode?: string | null
  subjectCode?: string | null
  matchStatus?: number | null
  pageNo?: number
  pageSize?: number
}

export type OpeningSettingReconcileResultExportInput = {
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
}

export type OpeningSettingOperationLogQuery = {
  accountingSetId: FinanceSettingInitialManageId
  periodMonth: string
  tabType?: OpeningSettingTabCode | null
  operationType?: string | null
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

const TAB_PATHS: Record<OpeningSettingTabCode, string> = {
  SUBJECT: 'subject',
  SUPPLIER: 'supplier',
  CUSTOMER: 'customer',
  BIO_LAYING_HEN: 'bio-laying-hen',
  BIO_GROWING_CHICKEN: 'bio-growing-chicken',
  BANK_STATEMENT: 'bank-statement',
}

const TAB_CODES = Object.keys(TAB_PATHS) as OpeningSettingTabCode[]

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function arrayOf (value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value
}

function idOf (value: unknown, label: string): FinanceSettingInitialManageId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): FinanceSettingInitialManageId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const result = textOf(value, label)
  if (!result.trim()) throw new Error(`${label}不能为空`)
  return result
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function optionalTextOf (value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return textOf(value, label)
}

function integerOf (value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${label}必须为不小于${minimum}的整数`)
  return Number(value)
}

function nullableIntegerOf (value: unknown, label: string, minimum = 0): number | null {
  if (value === undefined || value === null || value === '') return null
  return integerOf(value, label, minimum)
}

function booleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须为boolean`)
  return value
}

function amountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function dateTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error(`${label}不是有效日期`)
  return value
}

function nullableDateTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateTextOf(value, label)
}

function periodMonthOf (value: unknown, label: string): string {
  const date = dateTextOf(value, label)
  return `${date.slice(0, 7)}-01`
}

function tabCodeOf (value: unknown, label = 'tabType'): OpeningSettingTabCode {
  if (typeof value !== 'string' || !TAB_CODES.includes(value as OpeningSettingTabCode)) throw new Error(`${label}必须是Portal期初设置页签编码`)
  return value as OpeningSettingTabCode
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  const number = integerOf(resolved, label, 1)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return number
}

function lineIdsOf (value: unknown, label: string): FinanceSettingInitialManageId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空ID数组`)
  if (value.length > 1000) throw new Error(`${label}单次最多1000条`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(result.map(item => String(item))).size !== result.length) throw new Error(`${label}不能包含重复ID`)
  return result
}

function contextOf (input: { accountingSetId: unknown; periodMonth: unknown }, label = '期初设置上下文'): OpeningSettingContextDraft {
  return {
    accountingSetId: idOf(input?.accountingSetId, `${label}.accountingSetId`),
    periodMonth: periodMonthOf(input?.periodMonth, `${label}.periodMonth`),
  }
}

function updateAmountOf (value: unknown, label: string): string | null {
  if (value === undefined) throw new Error(`${label}不能为空`)
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  if (value !== '' && !/^[\d\p{P}\p{S}]+$/u.test(value)) throw new Error(`${label}包含非法字符`)
  return value
}

function updateDraftOf (value: unknown, label = '期初设置编辑表单'): FinanceSettingInitialManageUpdateDraft {
  const form = objectOf(value, label)
  return {
    ...form,
    id: idOf(form.id, `${label}.id`),
    openingBalance: updateAmountOf(form.openingBalance, `${label}.openingBalance`),
    accumulatedDebit: updateAmountOf(form.accumulatedDebit, `${label}.accumulatedDebit`),
    accumulatedCredit: updateAmountOf(form.accumulatedCredit, `${label}.accumulatedCredit`),
    beginningBalance: updateAmountOf(form.beginningBalance, `${label}.beginningBalance`),
  }
}

function contextParamsOf (input: OpeningSettingContextInput): JsonObject {
  const result: JsonObject = {
    tabType: tabCodeOf(input?.tabType),
    accountingSetId: idOf(input?.accountingSetId, 'accountingSetId'),
    periodMonth: periodMonthOf(input?.periodMonth, 'periodMonth'),
  }
  for (const [key, label] of [
    ['accountingSetCode', 'accountingSetCode'],
    ['accountingSetName', 'accountingSetName'],
    ['accountCode', 'accountCode'],
    ['accountingName', 'accountingName'],
  ] as const) {
    const value = optionalTextOf(input?.[key], label)
    if (value !== undefined) result[key] = value
  }
  return result
}

function listParamsOf (query: OpeningSettingListQuery): JsonObject {
  const tabType = tabCodeOf(query?.tabType)
  const result: JsonObject = {
    accountingSetId: idOf(query?.accountingSetId, 'accountingSetId'),
    periodMonth: periodMonthOf(query?.periodMonth, 'periodMonth'),
    pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query?.pageSize, 50, 'pageSize'),
  }
  const add = (key: keyof OpeningSettingListQuery, label = String(key)) => {
    const value = optionalTextOf(query?.[key], label)
    if (value !== undefined) result[key] = value
  }
  if (tabType === 'SUBJECT') add('subjectCode')
  if (tabType === 'SUPPLIER') {
    add('subjectCode')
    add('supplierCode')
    add('supplierName')
  }
  if (tabType === 'CUSTOMER') {
    add('subjectCode')
    add('customerCode')
    add('customerName')
  }
  if (tabType === 'BANK_STATEMENT') {
    add('subjectCode')
    add('bankAccountCode')
    add('bankAccountName')
  }
  if (tabType === 'BIO_LAYING_HEN' || tabType === 'BIO_GROWING_CHICKEN') {
    add('orderNo')
    add('batchNo')
    add('materialCode')
    add('materialName')
  }
  return result
}

function rowCommonOf (value: JsonObject, label: string, allowNullId = false): OpeningSettingCommonRow {
  return {
    id: allowNullId ? nullableIdOf(value.id, `${label}.id`) as FinanceSettingInitialManageId : idOf(value.id, `${label}.id`),
    rowNo: nullableIntegerOf(value.rowNo, `${label}.rowNo`, 0),
    accountingSetCode: nullableTextOf(value.accountingSetCode, `${label}.accountingSetCode`),
    accountingSetName: nullableTextOf(value.accountingSetName, `${label}.accountingSetName`),
    matchStatus: nullableIntegerOf(value.matchStatus, `${label}.matchStatus`),
    errorMessage: nullableTextOf(value.errorMessage, `${label}.errorMessage`),
  }
}

function rowOf (value: unknown, tabType: OpeningSettingTabCode, index: number): OpeningSettingRow {
  const row = objectOf(value, `${tabType}列表[${index}]`)
  const common = rowCommonOf(row, `${tabType}列表[${index}]`)
  const result: OpeningSettingRow = { ...row, ...common }
  const textFields = [
    'subjectType', 'subjectCode', 'subjectName', 'supplierCode', 'supplierName', 'supplierCategoryCode',
    'supplierCategoryName', 'customerCode', 'customerName', 'salesAreaCode', 'salesAreaName',
    'salesAreaDesc', 'salesDeptName', 'salespersonCode', 'salespersonName', 'orderNo', 'batchNo',
    'materialCode', 'materialName', 'factoryCode', 'factoryName', 'externalSubjectCode',
    'externalSubjectName', 'externalBalanceDirection', 'financeSubjectCode', 'financeSubjectName',
    'bankAccountCode', 'bankAccountName', 'summary',
  ] as const
  for (const field of textFields) result[field === 'salesAreaDesc' ? 'salesAreaDescription' : field] = nullableTextOf(row[field], `${tabType}列表[${index}].${field}`)
  result.statementDate = nullableDateTextOf(row.statementDate, `${tabType}列表[${index}].statementDate`)
  const amountFields = [
    'endingDebitAmount', 'endingCreditAmount', 'endingQuantity', 'beginningBalance', 'endingBalance',
    'estimatedEndingBalance', 'endingBalanceTotal', 'day154Value', 'monthEndQuantity',
    'openingOriginalValue', 'endingNetValue', 'accumulatedDepreciation', 'endingStockQuantity',
    'endingCostAmount', 'endingUnitPrice', 'debitAmount', 'creditAmount', 'balanceAmount',
  ] as const
  for (const field of amountFields) result[field] = amountOf(row[field], `${tabType}列表[${index}].${field}`)
  return result
}

function summaryValuesOf (value: unknown, label: string): Record<string, string | null> {
  if (value === undefined || value === null) return {}
  const source = objectOf(value, label)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, nullableTextOf(item, `${label}.${key}`)]))
}

function summaryRowOf (value: unknown, label: string): OpeningSettingSummaryRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: nullableIdOf(row.id, `${label}.id`),
    rowNo: nullableIntegerOf(row.rowNo, `${label}.rowNo`, 0),
    rowType: nullableTextOf(row.rowType, `${label}.rowType`),
    summaryLabel: nullableTextOf(row.summaryLabel, `${label}.summaryLabel`),
    summaryField: nullableTextOf(row.summaryField, `${label}.summaryField`),
    summaryValues: summaryValuesOf(row.summaryValues, `${label}.summaryValues`),
  }
}

function pageOf (value: unknown, tabType: OpeningSettingTabCode): OpeningSettingPage {
  const page = objectOf(value, `${tabType}分页响应`)
  if (!Array.isArray(page.list)) throw new Error(`${tabType}分页响应缺少list`)
  const total = integerOf(page.total, `${tabType}分页响应.total`, 0)
  const result: OpeningSettingPage = {
    list: page.list.map((item, index) => rowOf(item, tabType, index)),
    total,
  }
  if (tabType === 'BIO_LAYING_HEN' || tabType === 'BIO_GROWING_CHICKEN') {
    if (page.summary !== undefined) result.summary = page.summary === null ? null : summaryRowOf(page.summary, `${tabType}分页响应.summary`)
    if (page.summaryRows !== undefined) {
      if (!Array.isArray(page.summaryRows)) throw new Error(`${tabType}分页响应.summaryRows必须为数组`)
      result.summaryRows = page.summaryRows.map((item, index) => summaryRowOf(item, `${tabType}分页响应.summaryRows[${index}]`))
    }
  }
  return result
}

function tabOf (value: unknown, index: number): OpeningSettingTab {
  const row = objectOf(value, `期初设置页签[${index}]`)
  return {
    code: tabCodeOf(row.code, `期初设置页签[${index}].code`),
    name: requiredTextOf(row.name, `期初设置页签[${index}].name`),
    sort: integerOf(row.sort, `期初设置页签[${index}].sort`, 0),
  }
}

function tabStatusOf (value: unknown, index: number): OpeningSettingTabStatus {
  const row = objectOf(value, `期初设置状态.tabs[${index}]`)
  return {
    tabType: tabCodeOf(row.tabType, `期初设置状态.tabs[${index}].tabType`),
    tabName: nullableTextOf(row.tabName, `期初设置状态.tabs[${index}].tabName`),
    imported: booleanOf(row.imported, `期初设置状态.tabs[${index}].imported`),
    batchId: nullableIdOf(row.batchId, `期初设置状态.tabs[${index}].batchId`),
    versionNo: nullableIntegerOf(row.versionNo, `期初设置状态.tabs[${index}].versionNo`),
    rowCount: nullableIntegerOf(row.rowCount, `期初设置状态.tabs[${index}].rowCount`),
    trialStatus: nullableIntegerOf(row.trialStatus, `期初设置状态.tabs[${index}].trialStatus`),
    reconcileStatus: nullableIntegerOf(row.reconcileStatus, `期初设置状态.tabs[${index}].reconcileStatus`),
    importTime: nullableTextOf(row.importTime, `期初设置状态.tabs[${index}].importTime`),
  }
}

function statusOf (value: unknown): OpeningSettingStatus {
  const row = objectOf(value, '期初设置状态')
  if (!Array.isArray(row.tabs)) throw new Error('期初设置状态.tabs必须为数组')
  return {
    accountingSetId: idOf(row.accountingSetId, '期初设置状态.accountingSetId'),
    periodMonth: dateTextOf(row.periodMonth, '期初设置状态.periodMonth'),
    sourcePeriodMonth: nullableDateTextOf(row.sourcePeriodMonth, '期初设置状态.sourcePeriodMonth'),
    locked: booleanOf(row.locked, '期初设置状态.locked'),
    disabledReason: nullableTextOf(row.disabledReason, '期初设置状态.disabledReason'),
    tabs: row.tabs.map(tabStatusOf),
  }
}

function importResultOf (value: unknown): OpeningSettingImportResult {
  const row = objectOf(value, '期初设置导入响应')
  if (!Array.isArray(row.errors)) throw new Error('期初设置导入响应.errors必须为数组')
  const periodResults = row.periodResults === undefined ? [] : arrayOf(row.periodResults, '期初设置导入响应.periodResults')
  return {
    batchId: nullableIdOf(row.batchId, '期初设置导入响应.batchId'),
    success: booleanOf(row.success, '期初设置导入响应.success'),
    successCount: integerOf(row.successCount, '期初设置导入响应.successCount'),
    failCount: integerOf(row.failCount, '期初设置导入响应.failCount'),
    errors: row.errors.map((item, index) => {
      const error = objectOf(item, `期初设置导入响应.errors[${index}]`)
      return {
        rowNo: integerOf(error.rowNo, `期初设置导入响应.errors[${index}].rowNo`, 1),
        fieldName: nullableTextOf(error.fieldName, `期初设置导入响应.errors[${index}].fieldName`),
        errorReason: nullableTextOf(error.errorReason, `期初设置导入响应.errors[${index}].errorReason`),
      }
    }),
    periodResults: periodResults.map((item, index) => {
      const result = objectOf(item, `期初设置导入响应.periodResults[${index}]`)
      return {
        periodMonth: nullableDateTextOf(result.periodMonth, `期初设置导入响应.periodResults[${index}].periodMonth`),
        batchId: nullableIdOf(result.batchId, `期初设置导入响应.periodResults[${index}].batchId`),
        successCount: integerOf(result.successCount, `期初设置导入响应.periodResults[${index}].successCount`),
      }
    }),
  }
}

function trialBalanceOf (value: unknown): OpeningSettingTrialBalance {
  const row = objectOf(value, '期初设置试算响应')
  return {
    balanced: booleanOf(row.balanced, '期初设置试算响应.balanced'),
    totalDebitAmount: amountOf(row.totalDebitAmount, 'totalDebitAmount'),
    totalCreditAmount: amountOf(row.totalCreditAmount, 'totalCreditAmount'),
    asset: amountOf(row.asset, 'asset'),
    cost: amountOf(row.cost, 'cost'),
    equity: amountOf(row.equity, 'equity'),
    liability: amountOf(row.liability, 'liability'),
    profitLoss: amountOf(row.profitLoss, 'profitLoss'),
    assetCostTotal: amountOf(row.assetCostTotal, 'assetCostTotal'),
    equityLiabilityProfitLossTotal: amountOf(row.equityLiabilityProfitLossTotal, 'equityLiabilityProfitLossTotal'),
    differenceAmount: amountOf(row.differenceAmount, 'differenceAmount'),
    message: nullableTextOf(row.message, 'message'),
  }
}

function reconcileOf (value: unknown): OpeningSettingReconcileResult {
  const row = objectOf(value, '期初设置对账响应')
  return {
    reconcileNo: nullableTextOf(row.reconcileNo, 'reconcileNo'),
    matched: booleanOf(row.matched, 'matched'),
    resultCount: integerOf(row.resultCount, 'resultCount'),
  }
}

function manualMatchOf (value: unknown): OpeningSettingManualMatchResult {
  const row = objectOf(value, '期初设置人工匹配响应')
  return {
    updatedCount: integerOf(row.updatedCount, 'updatedCount'),
    allMatchedOrIgnored: booleanOf(row.allMatchedOrIgnored, 'allMatchedOrIgnored'),
    remainingCount: integerOf(row.remainingCount, 'remainingCount'),
  }
}

function deleteOf (value: unknown): OpeningSettingDeleteResult {
  const row = objectOf(value, '期初设置删除响应')
  return {
    batchId: nullableIdOf(row.batchId, 'batchId'),
    deletedCount: integerOf(row.deletedCount, 'deletedCount'),
    rowCount: integerOf(row.rowCount, 'rowCount'),
  }
}

function ledgerPostOf (value: unknown): OpeningSettingLedgerPostResult {
  const row = objectOf(value, '期初设置入账响应')
  return {
    posted: booleanOf(row.posted, 'posted'),
    subjectCount: integerOf(row.subjectCount, 'subjectCount'),
    customerCount: integerOf(row.customerCount, 'customerCount'),
    supplierCount: integerOf(row.supplierCount, 'supplierCount'),
    bankAccountCount: integerOf(row.bankAccountCount, 'bankAccountCount'),
  }
}

function reconcileResultRowOf (value: unknown, index: number): OpeningSettingReconcileResultRow {
  const row = objectOf(value, `期初设置对账结果[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `期初设置对账结果[${index}].id`),
    reconcileNo: nullableTextOf(row.reconcileNo, `期初设置对账结果[${index}].reconcileNo`),
    moduleCode: nullableTextOf(row.moduleCode, `期初设置对账结果[${index}].moduleCode`),
    moduleName: nullableTextOf(row.moduleName, `期初设置对账结果[${index}].moduleName`),
    subjectCode: nullableTextOf(row.subjectCode, `期初设置对账结果[${index}].subjectCode`),
    subjectName: nullableTextOf(row.subjectName, `期初设置对账结果[${index}].subjectName`),
    sourceSystem: nullableTextOf(row.sourceSystem, `期初设置对账结果[${index}].sourceSystem`),
    matchStatus: nullableIntegerOf(row.matchStatus, `期初设置对账结果[${index}].matchStatus`),
    sourceAmount: amountOf(row.sourceAmount, `期初设置对账结果[${index}].sourceAmount`),
    financeAmount: amountOf(row.financeAmount, `期初设置对账结果[${index}].financeAmount`),
    differenceAmount: amountOf(row.differenceAmount, `期初设置对账结果[${index}].differenceAmount`),
    sourceQuantity: amountOf(row.sourceQuantity, `期初设置对账结果[${index}].sourceQuantity`),
    financeQuantity: amountOf(row.financeQuantity, `期初设置对账结果[${index}].financeQuantity`),
    differenceQuantity: amountOf(row.differenceQuantity, `期初设置对账结果[${index}].differenceQuantity`),
    detailJson: nullableTextOf(row.detailJson, `期初设置对账结果[${index}].detailJson`),
  }
}

function operationLogRowOf (value: unknown, index: number): OpeningSettingOperationLogRow {
  const row = objectOf(value, `期初设置操作日志[${index}]`)
  return {
    id: idOf(row.id, `期初设置操作日志[${index}].id`),
    tabType: row.tabType === undefined || row.tabType === null || row.tabType === '' ? null : tabCodeOf(row.tabType, `期初设置操作日志[${index}].tabType`),
    operationType: nullableTextOf(row.operationType, `期初设置操作日志[${index}].operationType`),
    operationStatus: nullableIntegerOf(row.operationStatus, `期初设置操作日志[${index}].operationStatus`),
    operatorId: nullableIdOf(row.operatorId, `期初设置操作日志[${index}].operatorId`),
    operatorName: nullableTextOf(row.operatorName, `期初设置操作日志[${index}].operatorName`),
    startTime: nullableTextOf(row.startTime, `期初设置操作日志[${index}].startTime`),
    endTime: nullableTextOf(row.endTime, `期初设置操作日志[${index}].endTime`),
    failureDetailJson: nullableTextOf(row.failureDetailJson, `期初设置操作日志[${index}].failureDetailJson`),
    remark: nullableTextOf(row.remark, `期初设置操作日志[${index}].remark`),
  }
}

function pagedRowsOf<T> (value: unknown, label: string, map: (item: unknown, index: number) => T): { list: T[]; total: number } {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list)) throw new Error(`${label}.list必须为数组`)
  return { list: page.list.map(map), total: integerOf(page.total, `${label}.total`) }
}

function fileOf (input: OpeningSettingFileInput): { preview: OpeningSettingFilePreview; bytes: Uint8Array } {
  const fileName = requiredTextOf(input?.fileName, 'fileName')
  if (!/\.xlsx?$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx或.xls')
  const base64 = requiredTextOf(input?.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('文件大小不能超过20MB')
  const contentType = input?.contentType === undefined || input.contentType === null || input.contentType === ''
    ? (fileName.toLowerCase().endsWith('.xlsx') ? XLSX_MIME : XLS_MIME)
    : textOf(input.contentType, 'contentType')
  return {
    preview: { fileName, contentType, byteLength: bytes.byteLength },
    bytes: new Uint8Array(bytes),
  }
}

function binaryOf (response: AxiosResponse<unknown>): Uint8Array {
  const data = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('期初设置文件响应不是二进制文件')
}

function headerOf (response: AxiosResponse, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' && value ? value : null
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fileName: string): OpeningSettingDownloadedFile {
  const bytes = binaryOf(response)
  if (!bytes.byteLength) throw new Error('期初设置文件响应为空文件')
  return {
    fileName,
    contentType: headerOf(response, 'content-type') ?? 'application/vnd.ms-excel',
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function prepareContext (input: OpeningSettingContextDraft): { draft: OpeningSettingContextDraft } {
  return { draft: contextOf(input, 'draft') }
}

function prepareManualMatch (input: OpeningSettingManualMatchDraft): { draft: OpeningSettingManualMatchDraft } {
  const context = contextOf(input, 'draft')
  return {
    draft: {
      ...context,
      tabType: tabCodeOf(input?.tabType, 'draft.tabType'),
      lineIds: lineIdsOf(input?.lineIds, 'draft.lineIds'),
    },
  }
}

function prepareDeleteLines (input: OpeningSettingDeleteDraft): { draft: OpeningSettingDeleteDraft } {
  const prepared = prepareManualMatch(input)
  return {
    draft: {
      ...prepared.draft,
      batchId: idOf(input?.batchId, 'draft.batchId'),
    },
  }
}

function reconcileResultParamsOf (input: OpeningSettingReconcileResultQuery, pageSizeFallback = 50): JsonObject {
  const result: JsonObject = {
    accountingSetId: idOf(input?.accountingSetId, 'accountingSetId'),
    periodMonth: periodMonthOf(input?.periodMonth, 'periodMonth'),
    pageNo: pageNumberOf(input?.pageNo, 1, 'pageNo'),
    pageSize: input?.pageSize === 500 ? 500 : pageNumberOf(input?.pageSize, pageSizeFallback, 'pageSize'),
  }
  const moduleCode = optionalTextOf(input?.moduleCode, 'moduleCode')
  const subjectCode = optionalTextOf(input?.subjectCode, 'subjectCode')
  if (moduleCode !== undefined) result.moduleCode = moduleCode
  if (subjectCode !== undefined) result.subjectCode = subjectCode
  if (input?.matchStatus !== undefined && input.matchStatus !== null) result.matchStatus = integerOf(input.matchStatus, 'matchStatus')
  return result
}

function operationLogParamsOf (input: OpeningSettingOperationLogQuery): JsonObject {
  const result: JsonObject = {
    accountingSetId: idOf(input?.accountingSetId, 'accountingSetId'),
    periodMonth: periodMonthOf(input?.periodMonth, 'periodMonth'),
    pageNo: pageNumberOf(input?.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input?.pageSize, 50, 'pageSize'),
  }
  if (input?.tabType !== undefined && input.tabType !== null) result.tabType = tabCodeOf(input.tabType)
  const operationType = optionalTextOf(input?.operationType, 'operationType')
  if (operationType !== undefined) result.operationType = operationType
  return result
}

function xmlEscape (value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function xmlCell (value: unknown, styleId = 'Default'): string {
  const numeric = typeof value === 'number' && Number.isFinite(value)
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${numeric ? 'Number' : 'String'}">${xmlEscape(value)}</Data></Cell>`
}

function reconcileStatusText (value: number | null): string {
  if (value === 1) return '匹配'
  if (value === 2) return '不匹配'
  return '-'
}

function buildReconcileResultXml (rows: OpeningSettingReconcileResultRow[]): string {
  const columns = [
    ['模块', 'moduleName'], ['科目编码', 'subjectCode'], ['科目名称', 'subjectName'],
    ['来源系统', 'sourceSystem'], ['匹配状态', 'matchStatusText'], ['来源金额', 'sourceAmount'],
    ['财务金额', 'financeAmount'], ['差异金额', 'differenceAmount'],
  ] as const
  const header = `<Row>${columns.map(([title]) => xmlCell(title, 'Header')).join('')}</Row>`
  const body = rows.map(row => {
    const values: Record<string, unknown> = { ...row, matchStatusText: reconcileStatusText(row.matchStatus) }
    const style = row.matchStatus === 2 ? 'Mismatch' : 'Default'
    return `<Row>${columns.map(([, key]) => xmlCell(values[key], style)).join('')}</Row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles><Style ss:ID="Default"/><Style ss:ID="Header"><Font ss:Bold="1"/></Style><Style ss:ID="Mismatch"><Font ss:Color="#FF0000"/></Style></Styles>
  <Worksheet ss:Name="对账结果"><Table>${header}${body}</Table></Worksheet>
</Workbook>`
}

export function createFinanceSettingInitialManageCapability (request: PortalRequest): FinanceSettingInitialManageApi {
  return {
    async listTabs () {
      const result = await request<unknown>({ url: `${ROOT}/tabs`, method: 'get' })
      return arrayOf(result, '期初设置页签响应').map(tabOf)
    },

    async getStatus (input) {
      const context = contextOf(input)
      return statusOf(await request({ url: `${ROOT}/status`, method: 'get', params: context }))
    },

    async list (query) {
      const tabType = tabCodeOf(query?.tabType)
      const result = await request({ url: `${ROOT}/${TAB_PATHS[tabType]}/page`, method: 'post', data: listParamsOf(query) })
      return pageOf(result, tabType)
    },

    async downloadTemplate (input) {
      const tabType = tabCodeOf(input?.tabType)
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', params: contextParamsOf(input), responseType: 'arraybuffer' })
      const tabNames: Record<OpeningSettingTabCode, string> = {
        SUBJECT: '科目期初数据', SUPPLIER: '供应商期初明细账', CUSTOMER: '客户期初明细账',
        BIO_LAYING_HEN: '生产性生物资产-种蛋鸡', BIO_GROWING_CHICKEN: '生产性生物资产-育成鸡', BANK_STATEMENT: '银行明细账',
      }
      return downloadedFileOf(response, `${tabNames[tabType]}导入模板.xlsx`)
    },

    prepareImport (input) {
      return fileOf(input).preview
    },

    async importFile (input) {
      const context = contextParamsOf(input)
      const file = fileOf(input)
      const data = new FormData()
      const fileBuffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([fileBuffer], { type: file.preview.contentType }), file.preview.fileName)
      return importResultOf(await request({ url: `${ROOT}/import-excel`, method: 'post', params: context, data, headers: { 'Content-Type': 'multipart/form-data' } }))
    },

    prepareTrialBalance: prepareContext,
    async trialBalance (input) {
      return trialBalanceOf(await request({ url: `${ROOT}/trial-balance`, method: 'post', data: contextOf(input?.draft, 'draft') }))
    },

    prepareReconcile: prepareContext,
    async reconcile (input) {
      return reconcileOf(await request({ url: `${ROOT}/reconcile`, method: 'post', data: contextOf(input?.draft, 'draft') }))
    },

    prepareManualMatch,
    async manualMatch (input) {
      const draft = prepareManualMatch(input?.draft).draft
      return manualMatchOf(await request({ url: `${ROOT}/manual-match`, method: 'post', data: draft }))
    },

    prepareDeleteLines,
    async deleteLines (input) {
      const draft = prepareDeleteLines(input?.draft).draft
      return deleteOf(await request({ url: `${ROOT}/delete-lines`, method: 'post', data: draft }))
    },

    preparePostToLedger: prepareContext,
    async postToLedger (input) {
      return ledgerPostOf(await request({ url: `${ROOT}/post-to-ledger`, method: 'post', data: contextOf(input?.draft, 'draft') }))
    },

    prepareUpdate (input) {
      return { draft: updateDraftOf(input?.form) }
    },
    async update (input) {
      await request({ url: '/admin-api/finance/initial-manage/update', method: 'put', data: updateDraftOf(input?.draft, 'draft') })
    },

    cancelUpdate (): { cancelled: true } {
      return { cancelled: true }
    },

    async listReconcileResults (input) {
      const result = await request({ url: `${ROOT}/reconcile-result/page`, method: 'post', data: reconcileResultParamsOf(input) })
      return pagedRowsOf(result, '期初设置对账结果分页响应', reconcileResultRowOf)
    },

    async exportReconcileResults (input) {
      const base = { accountingSetId: input?.accountingSetId, periodMonth: input?.periodMonth }
      const rows: OpeningSettingReconcileResultRow[] = []
      let pageNo = 1
      let total = 0
      do {
        const page = await this.listReconcileResults({ ...base, pageNo, pageSize: 500 })
        rows.push(...page.list)
        total = page.total
        pageNo += 1
        if (!page.list.length) break
      } while (rows.length < total)
      const xml = buildReconcileResultXml(rows)
      const bytes = Buffer.from(xml, 'utf8')
      return {
        fileName: '对账结果.xls',
        contentType: 'application/vnd.ms-excel',
        byteLength: bytes.byteLength,
        base64: bytes.toString('base64'),
      }
    },

    async listOperationLogs (input) {
      const result = await request({ url: `${ROOT}/operation-log/page`, method: 'post', data: operationLogParamsOf(input) })
      return pagedRowsOf(result, '期初设置操作日志分页响应', operationLogRowOf)
    },
  }
}

export type FinanceSettingInitialManageCapability = ReturnType<typeof createFinanceSettingInitialManageCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const tabParam: ParamSpec = {
  name: 'tabType', kind: 'enum', required: true, description: 'Portal当前页签编码；必须是SUBJECT、SUPPLIER、CUSTOMER、BIO_LAYING_HEN、BIO_GROWING_CHICKEN或BANK_STATEMENT',
  options: [
    { label: '科目期初数据', value: 'SUBJECT' }, { label: '供应商期初明细账', value: 'SUPPLIER' },
    { label: '客户期初明细账', value: 'CUSTOMER' }, { label: '种蛋鸡', value: 'BIO_LAYING_HEN' },
    { label: '育成鸡', value: 'BIO_GROWING_CHICKEN' }, { label: '银行明细账', value: 'BANK_STATEMENT' },
  ],
}
const contextParams: ParamSpec[] = [
  p('accountingSetId', 'search', true, '账套ID；来自Portal账套选择器，不要传账套名称'),
  p('periodMonth', 'date', true, '期初所属月份；Portal会归一化为该月第一天YYYY-MM-DD'),
]
const fileParams: ParamSpec[] = [
  p('fileName', 'text', true, '上传文件名；Portal文件控件只接受.xlsx或.xls'),
  p('base64', 'text', true, '非空标准Base64文件内容；最大20MB'),
  p('contentType', 'text', false, '文件MIME类型；省略时按扩展名推导'),
]
const actionDraftParam: ParamSpec = p('draft', 'text', true, '对应prepare能力返回的完整草稿；不要自行删改字段')
const updateFormParam: ParamSpec = p('form', 'text', true, '期初设置隐藏编辑页表单；必须包含id及四个金额字段，未知字段按Portal原表单一并保留')

export const FINANCE_SETTING_INITIAL_MANAGE_METHODS = {
  'finance-setting-initial-manage-list-tabs': 'listTabs',
  'finance-setting-initial-manage-status': 'getStatus',
  'finance-setting-initial-manage-list': 'list',
  'finance-setting-initial-manage-download-template': 'downloadTemplate',
  'finance-setting-initial-manage-prepare-import': 'prepareImport',
  'finance-setting-initial-manage-import': 'importFile',
  'finance-setting-initial-manage-prepare-trial-balance': 'prepareTrialBalance',
  'finance-setting-initial-manage-trial-balance': 'trialBalance',
  'finance-setting-initial-manage-prepare-reconcile': 'prepareReconcile',
  'finance-setting-initial-manage-reconcile': 'reconcile',
  'finance-setting-initial-manage-prepare-manual-match': 'prepareManualMatch',
  'finance-setting-initial-manage-manual-match': 'manualMatch',
  'finance-setting-initial-manage-prepare-delete-lines': 'prepareDeleteLines',
  'finance-setting-initial-manage-delete-lines': 'deleteLines',
  'finance-setting-initial-manage-prepare-post-to-ledger': 'preparePostToLedger',
  'finance-setting-initial-manage-post-to-ledger': 'postToLedger',
  'finance-setting-initial-manage-prepare-update': 'prepareUpdate',
  'finance-setting-initial-manage-update': 'update',
  'finance-setting-initial-manage-cancel-update': 'cancelUpdate',
  'finance-setting-initial-manage-reconcile-results': 'listReconcileResults',
  'finance-setting-initial-manage-export-reconcile-results': 'exportReconcileResults',
  'finance-setting-initial-manage-operation-logs': 'listOperationLogs',
} as const

const listParams: ParamSpec[] = [
  tabParam, ...contextParams,
  p('subjectCode', 'text', false, '科目编码；仅SUBJECT、SUPPLIER、CUSTOMER、BANK_STATEMENT页签发送'),
  p('supplierCode', 'text', false, '供应商编码；仅SUPPLIER页签发送'),
  p('supplierName', 'text', false, '供应商名称；仅SUPPLIER页签发送'),
  p('customerCode', 'text', false, '客户编码；仅CUSTOMER页签发送'),
  p('customerName', 'text', false, '客户名称；仅CUSTOMER页签发送'),
  p('orderNo', 'text', false, '订单号；仅两个生物资产页签发送'),
  p('batchNo', 'text', false, '批次号；仅两个生物资产页签发送'),
  p('materialCode', 'text', false, '物料编码；仅两个生物资产页签发送'),
  p('materialName', 'text', false, '物料名称；仅两个生物资产页签发送'),
  p('bankAccountCode', 'text', false, '银行账户编码；仅BANK_STATEMENT页签发送'),
  p('bankAccountName', 'text', false, '银行账户名称；仅BANK_STATEMENT页签发送'),
  p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认50，页面支持10、20、50、100'),
]

export const financeSettingInitialManageCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-initial-manage-list-tabs', title: '查询期初设置页签', write: false, params: [] },
  { id: 'finance-setting-initial-manage-status', title: '查询期初设置账套月份状态', write: false, params: contextParams },
  { id: 'finance-setting-initial-manage-list', title: '分页查询期初设置明细', write: false, params: listParams },
  { id: 'finance-setting-initial-manage-download-template', title: '下载期初设置导入模板', write: false, params: [tabParam, ...contextParams, p('accountingSetCode', 'text', false, 'Portal账套编码；页面随上下文附带，可省略'), p('accountingSetName', 'text', false, 'Portal账套名称；页面随上下文附带，可省略'), p('accountCode', 'text', false, 'Portal兼容账套编码；可省略'), p('accountingName', 'text', false, 'Portal兼容账套名称；可省略')] },
  { id: 'finance-setting-initial-manage-prepare-import', title: '准备导入期初设置文件', write: false, params: fileParams },
  { id: 'finance-setting-initial-manage-import', title: '导入期初设置明细', write: true, params: [tabParam, ...contextParams, ...fileParams] },
  { id: 'finance-setting-initial-manage-prepare-trial-balance', title: '准备期初设置试算', write: false, params: contextParams },
  { id: 'finance-setting-initial-manage-trial-balance', title: '执行期初设置试算', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-prepare-reconcile', title: '准备期初设置对账', write: false, params: contextParams },
  { id: 'finance-setting-initial-manage-reconcile', title: '执行期初设置对账', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-prepare-manual-match', title: '准备人工确认期初匹配', write: false, params: [...contextParams, tabParam, p('lineIds', 'text', true, '从当前页列表记录id取得的明细ID数组，1至1000条')] },
  { id: 'finance-setting-initial-manage-manual-match', title: '人工确认期初匹配', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-prepare-delete-lines', title: '准备删除期初明细', write: false, params: [...contextParams, tabParam, p('batchId', 'search', true, '当前页签状态中的导入批次ID'), p('lineIds', 'text', true, '从当前页列表记录id取得的明细ID数组，1至1000条')] },
  { id: 'finance-setting-initial-manage-delete-lines', title: '删除期初明细', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-prepare-post-to-ledger', title: '准备期初入账', write: false, params: contextParams },
  { id: 'finance-setting-initial-manage-post-to-ledger', title: '将期初数据写入明细账', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-prepare-update', title: '准备期初设置隐藏编辑', write: false, params: [updateFormParam] },
  { id: 'finance-setting-initial-manage-update', title: '保存期初设置隐藏编辑', write: true, params: [actionDraftParam] },
  { id: 'finance-setting-initial-manage-cancel-update', title: '取消期初设置隐藏编辑提交', write: false, params: [] },
  { id: 'finance-setting-initial-manage-reconcile-results', title: '分页查询期初对账结果', write: false, params: [...contextParams, p('moduleCode', 'enum', false, '当前页签编码；SUBJECT页签按Portal规则省略'), p('subjectCode', 'text', false, '科目编码筛选'), p('matchStatus', 'enum', false, '匹配状态筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-setting-initial-manage-export-reconcile-results', title: '导出期初对账结果', write: false, params: contextParams },
  { id: 'finance-setting-initial-manage-operation-logs', title: '分页查询期初操作日志', write: false, params: [...contextParams, p('tabType', 'enum', false, '当前页签编码；省略表示全部'), p('operationType', 'text', false, '操作类型筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_INITIAL_MANAGE_PAGE_PATH,
  permission: FINANCE_SETTING_INITIAL_MANAGE_PERMISSION,
  moduleType: FINANCE_SETTING_INITIAL_MANAGE_MODULE_TYPE,
  httpInstance: 'platform',
}))
