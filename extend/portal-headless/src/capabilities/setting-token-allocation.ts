import type { AxiosResponse } from 'axios'

import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'
import type { PortalRequest } from '../session/types.js'

/** Portal「系统设置 → 用量分配」页面。 */
export const SETTING_TOKEN_ALLOCATION_PAGE_PATH = '/dashboard/setting/token-allocation/list'
export const SETTING_TOKEN_ALLOCATION_PERMISSION = '/dashboard/setting/token-allocation'
export const SETTING_TOKEN_ALLOCATION_MODULE_TYPE = null

export const SETTING_TOKEN_ALLOCATION_BUTTON_PERMISSIONS = {
  query: 'ai-token:usage:query',
  save: 'ai-token:allocation:save',
  clear: 'ai-token:allocation:clear',
  applyQuery: 'ai-token:apply:query',
  applyHandle: 'ai-token:apply:handle',
} as const

export const SETTING_TOKEN_ALLOCATION_PATHS = {
  modelPage: '/admin-api/ai-token/quota-usage/page',
  overview: '/admin-api/ai-token/allocation/overview',
  preview: '/admin-api/ai-token/allocation/preview',
  saveAverage: '/admin-api/ai-token/allocation/save-average',
  importTemplate: '/admin-api/ai-token/allocation/import-template',
  import: '/admin-api/ai-token/allocation/import',
  clear: '/admin-api/ai-token/allocation/clear',
  clearByModel: '/admin-api/ai-token/allocation/clear-by-model',
  effectivePage: '/admin-api/ai-token/allocation/effective-page',
  saveUser: '/admin-api/ai-token/allocation/save-user',
  applyPage: '/admin-api/ai-token/apply/page',
  applyHandle: '/admin-api/ai-token/apply/handle',
  pendingCount: '/admin-api/ai-token/apply/pending-count',
  userPage: '/admin-api/sys/user/page',
} as const

export const ALLOCATION_METHOD_NONE = 0 as const
export const ALLOCATION_METHOD_AVERAGE = 1 as const
export const ALLOCATION_METHOD_SPECIFIED = 2 as const
export type SettingTokenAllocationMethod =
  | typeof ALLOCATION_METHOD_NONE
  | typeof ALLOCATION_METHOD_AVERAGE
  | typeof ALLOCATION_METHOD_SPECIFIED

export const APPLY_STATUS_PENDING = 0 as const
export const APPLY_STATUS_IGNORED = 1 as const
export const APPLY_STATUS_FILLED = 2 as const
export const APPLY_STATUS_REJECTED = 3 as const
export const APPLY_STATUS_HANDLED = 4 as const
export type SettingTokenAllocationApplyStatus =
  | typeof APPLY_STATUS_PENDING
  | typeof APPLY_STATUS_IGNORED
  | typeof APPLY_STATUS_FILLED
  | typeof APPLY_STATUS_REJECTED
  | typeof APPLY_STATUS_HANDLED
export type SettingTokenAllocationHandleStatus = typeof APPLY_STATUS_REJECTED | typeof APPLY_STATUS_HANDLED

export const OVER_LIMIT_STRATEGY_FORBID = 1 as const
export const OVER_LIMIT_STRATEGY_REMIND = 2 as const
export const OVER_LIMIT_STRATEGY_INHERIT = 0 as const
export type SettingTokenAllocationOverLimitStrategy =
  | typeof OVER_LIMIT_STRATEGY_FORBID
  | typeof OVER_LIMIT_STRATEGY_REMIND
export type SettingTokenAllocationPortalOverLimitStrategy =
  | typeof OVER_LIMIT_STRATEGY_INHERIT
  | SettingTokenAllocationOverLimitStrategy

export type SettingTokenAllocationId = string | number

export type SettingTokenAllocationModelQuery = {
  pageNo?: number
  pageSize?: number
}

export type SettingTokenAllocationOverviewQuery = {
  modelId: SettingTokenAllocationId
  allocationMethod?: SettingTokenAllocationMethod | '' | null
}

export type SettingTokenAllocationEffectiveQuery = {
  modelId: SettingTokenAllocationId
  userName?: string | null
  allocationMethod?: SettingTokenAllocationMethod | '' | null
  pageNo?: number
  pageSize?: number
}

export type SettingTokenAllocationApplyQuery = {
  modelId: SettingTokenAllocationId
  userName?: string | null
  status?: SettingTokenAllocationApplyStatus | '' | null
  dateRange?: readonly [string?, string?] | null
  pageNo?: number
  pageSize?: number
}

export type SettingTokenAllocationUserQuery = {
  keyword: string
  pageNo?: number
  pageSize?: number
}

export type SettingTokenAllocationFormState = {
  averageQuota?: number | string | null
  overLimitStrategy?: number | string | null
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
  id?: SettingTokenAllocationId | null
  userId?: SettingTokenAllocationId | null
  userPhone?: string | null
  userName?: string | null
  allocatedQuota?: number | string | null
}

export type SettingTokenAllocationAverageInput = {
  modelId: SettingTokenAllocationId
  formState?: SettingTokenAllocationFormState
  averageQuota?: number | string | null
  overLimitStrategy?: number | string | null
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
  /** The page always submits an empty adjustment list; non-empty adjustments are not page-visible. */
  adjustments?: readonly []
}

export type SettingTokenAllocationAverageDraft = {
  modelId: SettingTokenAllocationId
  averageQuota: number | string
  overLimitStrategy: SettingTokenAllocationOverLimitStrategy
  startTime: string
  endTime?: string
  reason: string
  adjustments: []
}

export type SettingTokenAllocationPreviewInput = SettingTokenAllocationAverageInput & {
  allocationMethod: SettingTokenAllocationMethod
}

export type SettingTokenAllocationPreviewDraft = {
  modelId: SettingTokenAllocationId
  allocationMethod: SettingTokenAllocationMethod
  averageQuota?: number | string
  overLimitStrategy?: SettingTokenAllocationPortalOverLimitStrategy
  startTime?: string
  endTime?: string
  reason: string
  adjustments: []
}

export type SettingTokenAllocationUserInput = {
  modelId: SettingTokenAllocationId
  formState?: SettingTokenAllocationFormState
  id?: SettingTokenAllocationId | null
  userId?: SettingTokenAllocationId | null
  userPhone?: string | null
  userName?: string | null
  allocatedQuota?: number | string | null
  overLimitStrategy?: number | string | null
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}

export type SettingTokenAllocationUserDraft = {
  id?: SettingTokenAllocationId
  modelId: SettingTokenAllocationId
  userId: SettingTokenAllocationId
  userPhone: string
  userName: string
  allocatedQuota: number | string
  overLimitStrategy: SettingTokenAllocationOverLimitStrategy
  startTime: string
  endTime?: string
  reason: string
}

export type SettingTokenAllocationFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type SettingTokenAllocationFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type SettingTokenAllocationFile = SettingTokenAllocationFilePreview & {
  base64: string
}

export type SettingTokenAllocationImportInput = {
  modelId: SettingTokenAllocationId
  overLimitStrategy: number | string | null
  startTime: string | null
  endTime?: string | null
  reason?: string | null
  file: SettingTokenAllocationFileInput
}

export type SettingTokenAllocationImportDraft = {
  modelId: SettingTokenAllocationId
  overLimitStrategy: SettingTokenAllocationPortalOverLimitStrategy
  startTime: string
  endTime?: string
  reason: string
}

export type SettingTokenAllocationImportPreparation = {
  draft: SettingTokenAllocationImportDraft
  file: SettingTokenAllocationFilePreview
}

export type SettingTokenAllocationHandleInput = {
  id: SettingTokenAllocationId
  status: SettingTokenAllocationHandleStatus
  rejectReason?: string | null
}

export type SettingTokenAllocationHandleDraft = {
  id: SettingTokenAllocationId
  status: SettingTokenAllocationHandleStatus
  rejectReason?: string
}

export type SettingTokenAllocationOverview = Record<string, unknown> & {
  tenantTotalQuota?: number | string | null
  tenantUserCount?: number | string | null
  averageQuota?: number | string | null
  adjustedUserCount?: number | string | null
  unadjustedUserCount?: number | string | null
  allocatedQuota?: number | string | null
  remainingQuota?: number | string | null
  exceeded?: boolean | null
  allocationMethod?: number | null
  allocationMethodName?: string | null
  overLimitStrategy?: number | null
  overLimitStrategyName?: string | null
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}

export type SettingTokenAllocationModelRow = Record<string, unknown> & {
  modelId?: SettingTokenAllocationId | null
  modelName?: string | null
}

export type SettingTokenAllocationEffectiveRow = Record<string, unknown> & {
  id?: SettingTokenAllocationId | null
  modelId?: SettingTokenAllocationId | null
  userId?: SettingTokenAllocationId | null
  userPhone?: string | null
  userName?: string | null
  allocationMethod?: number | null
  allocationMethodName?: string | null
  allocatedQuota?: number | string | null
  usedQuota?: number | string | null
  remainingQuota?: number | string | null
  usageStatus?: number | null
  usageStatusName?: string | null
  overLimitStrategy?: number | null
  overLimitStrategyName?: string | null
  startTime?: string | null
  endTime?: string | null
  reason?: string | null
}

export type SettingTokenAllocationApplyRow = Record<string, unknown> & {
  id?: SettingTokenAllocationId | null
  modelId?: SettingTokenAllocationId | null
  modelName?: string | null
  userId?: SettingTokenAllocationId | null
  userPhone?: string | null
  userName?: string | null
  currentMonthlyQuota?: number | string | null
  expectedMonthlyQuota?: number | string | null
  currentMaxToken?: number | string | null
  expectedMaxToken?: number | string | null
  reason?: string | null
  rejectReason?: string | null
  status?: number | null
  statusName?: string | null
  handlerName?: string | null
  handledTime?: string | null
}

export type SettingTokenAllocationUserOption = Record<string, unknown> & {
  id?: SettingTokenAllocationId | null
  mobile?: string | null
  realName?: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingTokenAllocationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): SettingTokenAllocationId | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return idOf(value, label)
}

function textOf (value: unknown, label: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (text.trim() === '') throw new Error(`${label}不能为空`)
  return text
}

function reasonOf (value: unknown): string {
  const reason = textOf(value, 'reason')
  if (reason.length > 500) throw new Error('reason不能超过500个字符')
  return reason
}

function pageNumberOf (value: unknown, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  return resolved as number
}

function integerNumberOf (value: unknown, label: string): number {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized)) throw new Error(`${label}必须为整数`)
  return normalized
}

function positiveIntegerOf (value: unknown, label: string): number | string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为大于0的整数`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为大于0的整数`)
}

function methodOf (value: unknown, label: string): SettingTokenAllocationMethod {
  const method = integerNumberOf(value, label)
  if (![ALLOCATION_METHOD_NONE, ALLOCATION_METHOD_AVERAGE, ALLOCATION_METHOD_SPECIFIED].includes(method as SettingTokenAllocationMethod)) {
    throw new Error(`${label}只能是0（未分配）、1（平均分配）或2（指定用户分配）`)
  }
  return method as SettingTokenAllocationMethod
}

function optionalMethodOf (value: unknown, label: string): SettingTokenAllocationMethod | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return methodOf(value, label)
}

function strategyOf (value: unknown, label: string): SettingTokenAllocationOverLimitStrategy {
  const strategy = integerNumberOf(value, label)
  if (![OVER_LIMIT_STRATEGY_FORBID, OVER_LIMIT_STRATEGY_REMIND].includes(strategy as SettingTokenAllocationOverLimitStrategy)) {
    throw new Error(`${label}只能是1（禁止使用）或2（仅提醒）；0（继承全局）不能提交到该接口`)
  }
  return strategy as SettingTokenAllocationOverLimitStrategy
}

function portalStrategyOf (value: unknown, label: string): SettingTokenAllocationPortalOverLimitStrategy {
  const strategy = integerNumberOf(value, label)
  if (![OVER_LIMIT_STRATEGY_INHERIT, OVER_LIMIT_STRATEGY_FORBID, OVER_LIMIT_STRATEGY_REMIND].includes(strategy as SettingTokenAllocationPortalOverLimitStrategy)) {
    throw new Error(`${label}只能是0（继承全局）、1（禁止使用）或2（仅提醒）`)
  }
  return strategy as SettingTokenAllocationPortalOverLimitStrategy
}

function optionalStrategyOf (value: unknown, label: string): SettingTokenAllocationOverLimitStrategy | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return strategyOf(value, label)
}

function optionalPortalStrategyOf (value: unknown, label: string): SettingTokenAllocationPortalOverLimitStrategy | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return portalStrategyOf(value, label)
}

function applyStatusOf (value: unknown, label: string): SettingTokenAllocationApplyStatus {
  const status = integerNumberOf(value, label)
  if (![APPLY_STATUS_PENDING, APPLY_STATUS_IGNORED, APPLY_STATUS_FILLED, APPLY_STATUS_REJECTED, APPLY_STATUS_HANDLED].includes(status as SettingTokenAllocationApplyStatus)) {
    throw new Error(`${label}只能是0、1、2、3或4`)
  }
  return status as SettingTokenAllocationApplyStatus
}

function handleStatusOf (value: unknown, label: string): SettingTokenAllocationHandleStatus {
  const status = applyStatusOf(value, label)
  if (status !== APPLY_STATUS_REJECTED && status !== APPLY_STATUS_HANDLED) throw new Error(`${label}只能是3（驳回）或4（已处理）`)
  return status
}

const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function optionalDateTimeOf (value: unknown, label: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}必填`)
    return undefined
  }
  if (typeof value !== 'string' || !DATE_TIME_PATTERN.test(value)) throw new Error(`${label}必须是YYYY-MM-DD HH:mm:ss格式`)
  return value
}

function assertDateRange (startTime: string | undefined, endTime: string | undefined): void {
  if (startTime && endTime && endTime <= startTime) throw new Error('endTime必须晚于startTime')
}

function pageOf<T extends Record<string, unknown>> (value: unknown, label: string, rowOf: (item: unknown, itemLabel: string) => T): PageResult<T> {
  const page = objectOf(value, label)
  const total = pageNumberValueOf(page.total, `${label}.total`, true)
  if (!Array.isArray(page.list)) throw new Error(`${label}.list必须为数组`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total }
}

function pageNumberValueOf (value: unknown, label: string, allowZero = false): number {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || (allowZero ? normalized < 0 : normalized < 1)) throw new Error(`${label}必须为${allowZero ? '非负' : '正'}整数`)
  return normalized
}

function rowOf<T extends Record<string, unknown>> (value: unknown, label: string): T {
  return objectOf(value, label) as T
}

function overviewOf (value: unknown, label: string): SettingTokenAllocationOverview {
  return objectOf(value, label) as SettingTokenAllocationOverview
}

function trueResultOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function idResultOf (value: unknown, label: string): SettingTokenAllocationId {
  return idOf(value, label)
}

function normalizedForm (input: unknown, label: string): JsonObject {
  const value = objectOf(input, label)
  if (value.formState === undefined || value.formState === null) return value
  return objectOf(value.formState, `${label}.formState`)
}

function formValue (input: unknown, key: string, label: string): unknown {
  const value = objectOf(input, label)
  const form = value.formState === undefined || value.formState === null ? value : objectOf(value.formState, `${label}.formState`)
  return Object.prototype.hasOwnProperty.call(form, key) ? form[key] : value[key]
}

function ensureEmptyAdjustments (value: unknown, label: string): [] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  if (value.length !== 0) throw new Error(`${label}当前页面只能提交空数组；逐用户调整请使用用户分配能力`)
  return []
}

function averageDraftOf (input: unknown, label: string, preview: boolean): SettingTokenAllocationAverageDraft | SettingTokenAllocationPreviewDraft {
  const value = objectOf(input, label)
  const modelId = idOf(value.modelId, `${label}.modelId`)
  const method = preview ? methodOf(value.allocationMethod, `${label}.allocationMethod`) : undefined
  const averageQuotaRaw = formValue(input, 'averageQuota', label)
  const averageQuota = averageQuotaRaw === undefined || averageQuotaRaw === null || averageQuotaRaw === ''
    ? undefined
    : positiveIntegerOf(averageQuotaRaw, `${label}.averageQuota`)
  if (preview && method === ALLOCATION_METHOD_AVERAGE && averageQuota === undefined) throw new Error(`${label}.averageQuota在平均分配时必填且必须大于0`)
  if (!preview && averageQuota === undefined) throw new Error(`${label}.averageQuota必填且必须大于0`)
  const strategy = preview
    ? optionalPortalStrategyOf(formValue(input, 'overLimitStrategy', label), `${label}.overLimitStrategy`)
    : optionalStrategyOf(formValue(input, 'overLimitStrategy', label), `${label}.overLimitStrategy`)
  if (!preview && strategy === undefined) throw new Error(`${label}.overLimitStrategy必填`)
  const startTime = optionalDateTimeOf(formValue(input, 'startTime', label), `${label}.startTime`, !preview)
  const endTime = optionalDateTimeOf(formValue(input, 'endTime', label), `${label}.endTime`)
  assertDateRange(startTime, endTime)
  const reason = reasonOf(formValue(input, 'reason', label))
  const adjustments = ensureEmptyAdjustments(value.adjustments, `${label}.adjustments`)
  if (preview) {
    return {
      modelId,
      allocationMethod: method!,
      ...(averageQuota === undefined ? {} : { averageQuota }),
      ...(strategy === undefined ? {} : { overLimitStrategy: strategy }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
      reason,
      adjustments,
    }
  }
  return {
    modelId,
    averageQuota: averageQuota!,
    overLimitStrategy: strategy! as SettingTokenAllocationOverLimitStrategy,
    startTime: startTime!,
    ...(endTime === undefined ? {} : { endTime }),
    reason,
    adjustments,
  }
}

function averagePayloadOf (draft: SettingTokenAllocationAverageDraft | SettingTokenAllocationPreviewDraft): JsonObject {
  const payload: JsonObject = {
    modelId: draft.modelId,
    ...(Object.prototype.hasOwnProperty.call(draft, 'allocationMethod') ? { allocationMethod: (draft as SettingTokenAllocationPreviewDraft).allocationMethod } : {}),
    averageQuota: draft.averageQuota,
    overLimitStrategy: draft.overLimitStrategy,
    startTime: draft.startTime,
    endTime: draft.endTime,
    reason: draft.reason,
    adjustments: draft.adjustments,
  }
  return payload
}

function userDraftOf (input: unknown, label: string): SettingTokenAllocationUserDraft {
  const value = objectOf(input, label)
  const modelId = idOf(value.modelId, `${label}.modelId`)
  const userId = idOf(formValue(input, 'userId', label), `${label}.userId`)
  const userPhone = requiredTextOf(formValue(input, 'userPhone', label), `${label}.userPhone`)
  const userName = textOf(formValue(input, 'userName', label), `${label}.userName`)
  const allocatedQuota = positiveIntegerOf(formValue(input, 'allocatedQuota', label), `${label}.allocatedQuota`)
  const overLimitStrategy = strategyOf(formValue(input, 'overLimitStrategy', label), `${label}.overLimitStrategy`)
  const startTime = optionalDateTimeOf(formValue(input, 'startTime', label), `${label}.startTime`, true)!
  const endTime = optionalDateTimeOf(formValue(input, 'endTime', label), `${label}.endTime`)
  assertDateRange(startTime, endTime)
  const reason = reasonOf(formValue(input, 'reason', label))
  const id = optionalIdOf(formValue(input, 'id', label), `${label}.id`)
  return {
    ...(id === undefined ? {} : { id }),
    modelId,
    userId,
    userPhone,
    userName,
    allocatedQuota,
    overLimitStrategy,
    startTime,
    ...(endTime === undefined ? {} : { endTime }),
    reason,
  }
}

function userPayloadOf (draft: SettingTokenAllocationUserDraft): JsonObject {
  return {
    id: draft.id,
    modelId: draft.modelId,
    userId: draft.userId,
    userPhone: draft.userPhone,
    userName: draft.userName,
    allocatedQuota: draft.allocatedQuota,
    overLimitStrategy: draft.overLimitStrategy,
    startTime: draft.startTime,
    endTime: draft.endTime,
    reason: draft.reason,
  }
}

function applyQueryOf (query: SettingTokenAllocationApplyQuery): JsonObject {
  const dateRange = query.dateRange ?? []
  if (!Array.isArray(dateRange) || dateRange.length > 2) throw new Error('dateRange必须是开始、结束日期数组')
  for (const item of dateRange) if (item !== undefined && item !== null && typeof item !== 'string') throw new Error('dateRange中的日期必须为字符串')
  const status = query.status === undefined || query.status === null || query.status === '' ? undefined : applyStatusOf(query.status, 'status')
  return {
    modelId: idOf(query.modelId, 'modelId'),
    userName: textOf(query.userName, 'userName'),
    status,
    startDate: dateRange[0],
    endDate: dateRange[1],
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function effectiveQueryOf (query: SettingTokenAllocationEffectiveQuery): JsonObject {
  return {
    modelId: idOf(query.modelId, 'modelId'),
    userName: textOf(query.userName, 'userName'),
    allocationMethod: optionalMethodOf(query.allocationMethod, 'allocationMethod'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function fileBytesOf (input: unknown): { fileName: string; contentType: string; bytes: Uint8Array; base64: string } {
  const value = objectOf(input, '导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.(xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx或.xls')
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  const contentType = typeof value.contentType === 'string' && value.contentType
    ? value.contentType
    : fileName.toLowerCase().endsWith('.xls')
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes: new Uint8Array(bytes), base64 }
}

function filePreviewOf (input: unknown): SettingTokenAllocationFilePreview {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function headerOf (headers: unknown, name: string): unknown {
  if (headers && typeof headers === 'object' && 'get' in headers && typeof (headers as { get?: unknown }).get === 'function') return (headers as { get: (key: string) => unknown }).get(name)
  const record = headers && typeof headers === 'object' ? headers as Record<string, unknown> : {}
  return record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()]
}

function fileResponseOf (response: AxiosResponse<ArrayBuffer>): SettingTokenAllocationFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('用户额度分配模板响应为空文件')
  const disposition = headerOf(response.headers, 'content-disposition')
  const header = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = '用户额度分配导入模板.xls'
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fileName
  const contentType = headerOf(response.headers, 'content-type')
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : 'application/vnd.ms-excel',
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function importDraftOf (input: unknown, label: string): { draft: SettingTokenAllocationImportDraft; file: SettingTokenAllocationFileInput } {
  const value = objectOf(input, label)
  const form = value.draft === undefined ? value : objectOf(value.draft, `${label}.draft`)
  const modelId = idOf(form.modelId, `${label}.modelId`)
  const overLimitStrategy = portalStrategyOf(form.overLimitStrategy, `${label}.overLimitStrategy`)
  const startTime = optionalDateTimeOf(form.startTime, `${label}.startTime`, true)!
  const endTime = optionalDateTimeOf(form.endTime, `${label}.endTime`)
  assertDateRange(startTime, endTime)
  const reason = reasonOf(form.reason)
  if (value.file === undefined) throw new Error(`${label}.file必填`)
  const file = objectOf(value.file, `${label}.file`) as unknown as SettingTokenAllocationFileInput
  return {
    draft: {
      modelId,
      overLimitStrategy,
      startTime,
      ...(endTime === undefined ? {} : { endTime }),
      reason,
    },
    file,
  }
}

function importFormDataOf (draft: SettingTokenAllocationImportDraft, fileInput: unknown): FormData {
  const file = fileBytesOf(fileInput)
  const formData = new FormData()
  for (const [key, value] of [
    ['modelId', draft.modelId],
    ['overLimitStrategy', draft.overLimitStrategy],
    ['startTime', draft.startTime],
    ['endTime', draft.endTime],
    ['reason', draft.reason],
  ] as const) {
    if (value !== undefined && value !== null && value !== '') formData.append(key, String(value))
  }
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  formData.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  return formData
}

function importResultOf (value: unknown): Record<string, unknown> & {
  totalCount: number
  successCount: number
  failureCount: number
  failureMessages: string[]
} {
  const result = objectOf(value, '用户额度分配导入响应')
  const totalCount = pageNumberValueOf(result.totalCount, 'totalCount', true)
  const successCount = pageNumberValueOf(result.successCount, 'successCount', true)
  const failureCount = pageNumberValueOf(result.failureCount, 'failureCount', true)
  if (!Array.isArray(result.failureMessages) || result.failureMessages.some(item => typeof item !== 'string')) throw new Error('failureMessages必须为字符串数组')
  return { ...result, totalCount, successCount, failureCount, failureMessages: result.failureMessages as string[] }
}

/** The injected request must be bound to SETTING_TOKEN_ALLOCATION_PAGE_PATH. */
export function createSettingTokenAllocationCapability (request: PortalRequest) {
  return {
    async listModels (query: SettingTokenAllocationModelQuery = {}): Promise<PageResult<SettingTokenAllocationModelRow>> {
      return pageOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.modelPage, method: 'get', params: {
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 100, 'pageSize'),
      } }), '模型候选分页响应', rowOf<SettingTokenAllocationModelRow>)
    },

    async overview (query: SettingTokenAllocationOverviewQuery): Promise<SettingTokenAllocationOverview> {
      const modelId = idOf(query?.modelId, 'modelId')
      return overviewOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.overview, method: 'get', params: {
        modelId,
        allocationMethod: optionalMethodOf(query?.allocationMethod, 'allocationMethod'),
      } }), '用量分配概览响应')
    },

    preparePreview (input: SettingTokenAllocationPreviewInput): { draft: SettingTokenAllocationPreviewDraft; payload: JsonObject } {
      const draft = averageDraftOf(input, 'preview', true) as SettingTokenAllocationPreviewDraft
      return { draft, payload: averagePayloadOf(draft) }
    },

    async preview (input: { draft: SettingTokenAllocationPreviewDraft } | SettingTokenAllocationPreviewInput): Promise<SettingTokenAllocationOverview> {
      const value = objectOf(input, 'preview')
      const draft = value.draft === undefined
        ? averageDraftOf(input, 'preview', true) as SettingTokenAllocationPreviewDraft
        : averageDraftOf(value.draft, 'preview.draft', true) as SettingTokenAllocationPreviewDraft
      return overviewOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.preview, method: 'post', data: averagePayloadOf(draft) }), '用量分配预览响应')
    },

    prepareSaveAverage (input: SettingTokenAllocationAverageInput): { draft: SettingTokenAllocationAverageDraft; payload: JsonObject } {
      const draft = averageDraftOf(input, 'saveAverage', false) as SettingTokenAllocationAverageDraft
      return { draft, payload: averagePayloadOf(draft) }
    },

    async saveAverage (input: { draft: SettingTokenAllocationAverageDraft } | SettingTokenAllocationAverageInput): Promise<true> {
      const value = objectOf(input, 'saveAverage')
      const draft = value.draft === undefined
        ? averageDraftOf(input, 'saveAverage', false) as SettingTokenAllocationAverageDraft
        : averageDraftOf(value.draft, 'saveAverage.draft', false) as SettingTokenAllocationAverageDraft
      return trueResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.saveAverage, method: 'post', data: averagePayloadOf(draft) }), '平均分配保存')
    },

    async downloadTemplate (): Promise<SettingTokenAllocationFile> {
      return fileResponseOf(await request<AxiosResponse<ArrayBuffer>>({ url: SETTING_TOKEN_ALLOCATION_PATHS.importTemplate, method: 'get', responseType: 'arraybuffer' }))
    },

    prepareImport (input: SettingTokenAllocationImportInput): SettingTokenAllocationImportPreparation {
      const { draft, file } = importDraftOf(input, 'import')
      return { draft, file: filePreviewOf(file) }
    },

    async importAllocation (input: SettingTokenAllocationImportInput | { draft: SettingTokenAllocationImportDraft; file: SettingTokenAllocationFileInput }): Promise<ReturnType<typeof importResultOf>> {
      const { draft, file } = importDraftOf(input, 'import')
      const data = importFormDataOf(draft, file)
      return importResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.import, method: 'post', data }))
    },

    async listEffective (query: SettingTokenAllocationEffectiveQuery): Promise<PageResult<SettingTokenAllocationEffectiveRow>> {
      return pageOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.effectivePage, method: 'get', params: effectiveQueryOf(query) }), '用户有效分配分页响应', rowOf<SettingTokenAllocationEffectiveRow>)
    },

    prepareSaveUser (input: SettingTokenAllocationUserInput): { draft: SettingTokenAllocationUserDraft; payload: JsonObject } {
      const draft = userDraftOf(input, 'saveUser')
      return { draft, payload: userPayloadOf(draft) }
    },

    async saveUser (input: { draft: SettingTokenAllocationUserDraft } | SettingTokenAllocationUserInput): Promise<SettingTokenAllocationId> {
      const value = objectOf(input, 'saveUser')
      const draft = userDraftOf(value.draft === undefined ? input : value.draft, 'saveUser')
      return idResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.saveUser, method: 'post', data: userPayloadOf(draft) }), '用户分配保存返回ID')
    },

    prepareClearUser (input: { id: SettingTokenAllocationId }): { draft: { id: SettingTokenAllocationId } } {
      return { draft: { id: idOf(input?.id, 'allocationId') } }
    },

    async clearUser (input: { id: SettingTokenAllocationId } | { draft: { id: SettingTokenAllocationId }}): Promise<true> {
      const value = objectOf(input, 'clearUser')
      const draft = value.draft === undefined ? value : objectOf(value.draft, 'clearUser.draft')
      const id = idOf(draft.id, 'allocationId')
      return trueResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.clear, method: 'get', params: { id } }), '用户分配清空')
    },

    prepareClearAll (input: { modelId: SettingTokenAllocationId }): { draft: { modelId: SettingTokenAllocationId } } {
      return { draft: { modelId: idOf(input?.modelId, 'modelId') } }
    },

    async clearAll (input: { modelId: SettingTokenAllocationId } | { draft: { modelId: SettingTokenAllocationId }}): Promise<true> {
      const value = objectOf(input, 'clearAll')
      const draft = value.draft === undefined ? value : objectOf(value.draft, 'clearAll.draft')
      const modelId = idOf(draft.modelId, 'modelId')
      return trueResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.clearByModel, method: 'get', params: { modelId } }), '模型分配清空')
    },

    async listApply (query: SettingTokenAllocationApplyQuery): Promise<PageResult<SettingTokenAllocationApplyRow>> {
      return pageOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.applyPage, method: 'get', params: applyQueryOf(query) }), '用量申请分页响应', rowOf<SettingTokenAllocationApplyRow>)
    },

    prepareHandleApply (input: SettingTokenAllocationHandleInput): { draft: SettingTokenAllocationHandleDraft } {
      const id = idOf(input?.id, 'applyId')
      const status = handleStatusOf(input?.status, 'status')
      const rejectReason = reasonOf(input?.rejectReason)
      return { draft: {
        id,
        status,
        ...(status === APPLY_STATUS_REJECTED || rejectReason !== '' ? { rejectReason } : {}),
      } }
    },

    async handleApply (input: { draft: SettingTokenAllocationHandleDraft } | SettingTokenAllocationHandleInput): Promise<true> {
      const value = objectOf(input, 'handleApply')
      const source = value.draft === undefined ? input : value.draft
      const draft = objectOf(source, 'handleApply.draft')
      const id = idOf(draft.id, 'applyId')
      const status = handleStatusOf(draft.status, 'status')
      const rejectReason = reasonOf(draft.rejectReason)
      const payload: JsonObject = { id, status }
      if (status === APPLY_STATUS_REJECTED) payload.rejectReason = rejectReason
      return trueResultOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.applyHandle, method: 'post', data: payload }), '用量申请处理')
    },

    async pendingApplyCount (input: { modelId: SettingTokenAllocationId }): Promise<number> {
      const result = await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.pendingCount, method: 'get', params: { modelId: idOf(input?.modelId, 'modelId') } })
      return pageNumberValueOf(result, 'pendingCount', true)
    },

    async searchUsers (query: SettingTokenAllocationUserQuery): Promise<PageResult<SettingTokenAllocationUserOption>> {
      const keyword = requiredTextOf(query?.keyword, 'keyword')
      return pageOf(await request({ url: SETTING_TOKEN_ALLOCATION_PATHS.userPage, method: 'get', params: {
        name: keyword,
        pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query?.pageSize, 20, 'pageSize'),
      } }), '用户候选分页响应', rowOf<SettingTokenAllocationUserOption>)
    },
  }
}

export type SettingTokenAllocationCapability = ReturnType<typeof createSettingTokenAllocationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })
const modelIdParam = p('modelId', 'text', true, '模型ID；必须来自 listModels 返回的 list[].modelId，不要按模型名称猜ID')
const draftParam = (name: string, description: string): ParamSpec => p(name, 'text', true, description)
const allocationMethodOptions = [
  { label: '未分配', value: ALLOCATION_METHOD_NONE },
  { label: '平均分配', value: ALLOCATION_METHOD_AVERAGE },
  { label: '指定用户分配', value: ALLOCATION_METHOD_SPECIFIED },
]
const applyStatusOptions = [
  { label: '待处理', value: APPLY_STATUS_PENDING },
  { label: '已忽略', value: APPLY_STATUS_IGNORED },
  { label: '已填写', value: APPLY_STATUS_FILLED },
  { label: '已驳回', value: APPLY_STATUS_REJECTED },
  { label: '已处理', value: APPLY_STATUS_HANDLED },
]

export const SETTING_TOKEN_ALLOCATION_METHODS = {
  'setting-token-allocation-model-list': 'listModels',
  'setting-token-allocation-overview': 'overview',
  'setting-token-allocation-prepare-preview': 'preparePreview',
  'setting-token-allocation-preview': 'preview',
  'setting-token-allocation-prepare-save-average': 'prepareSaveAverage',
  'setting-token-allocation-save-average': 'saveAverage',
  'setting-token-allocation-download-template': 'downloadTemplate',
  'setting-token-allocation-prepare-import': 'prepareImport',
  'setting-token-allocation-import': 'importAllocation',
  'setting-token-allocation-effective-list': 'listEffective',
  'setting-token-allocation-prepare-save-user': 'prepareSaveUser',
  'setting-token-allocation-save-user': 'saveUser',
  'setting-token-allocation-prepare-clear-user': 'prepareClearUser',
  'setting-token-allocation-clear-user': 'clearUser',
  'setting-token-allocation-prepare-clear-all': 'prepareClearAll',
  'setting-token-allocation-clear-all': 'clearAll',
  'setting-token-allocation-apply-list': 'listApply',
  'setting-token-allocation-prepare-handle-apply': 'prepareHandleApply',
  'setting-token-allocation-handle-apply': 'handleApply',
  'setting-token-allocation-pending-count': 'pendingApplyCount',
  'setting-token-allocation-user-search': 'searchUsers',
} as const

const pageContext = {
  pagePath: SETTING_TOKEN_ALLOCATION_PAGE_PATH,
  permission: SETTING_TOKEN_ALLOCATION_PERMISSION,
  moduleType: SETTING_TOKEN_ALLOCATION_MODULE_TYPE,
  httpInstance: 'platform',
} as const

export const settingTokenAllocationCapabilities: CapabilityDefinition[] = [
  { id: 'setting-token-allocation-model-list', title: '查询用量分配模型候选', write: false, params: [p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '页面固定默认100，用于初始模型候选')] },
  { id: 'setting-token-allocation-overview', title: '查询用量分配概览', write: false, params: [modelIdParam, p('allocationMethod', 'enum', false, '概览分配方式；空值不发送', allocationMethodOptions)] },
  { id: 'setting-token-allocation-prepare-preview', title: '准备用量分配预览', write: false, params: [modelIdParam, p('allocationMethod', 'enum', true, '预览分配方式；0未分配、1平均分配、2指定用户分配', allocationMethodOptions), draftParam('formState', 'Portal分配设置草稿；平均分配时averageQuota必填，策略可为0继承全局、1禁止或2提醒，时间按YYYY-MM-DD HH:mm:ss，reason最多500字符')] },
  { id: 'setting-token-allocation-preview', title: '预览用量分配', write: false, params: [draftParam('draft', 'preparePreview返回的分配草稿；页面只允许提交空adjustments数组')] },
  { id: 'setting-token-allocation-prepare-save-average', title: '准备保存平均用量分配', write: false, params: [modelIdParam, draftParam('formState', '平均分配草稿；averageQuota正整数、策略1/2、startTime必填、endTime晚于startTime、reason最多500字符')] },
  { id: 'setting-token-allocation-save-average', title: '保存平均用量分配', write: true, params: [draftParam('draft', 'prepareSaveAverage返回的草稿；提交后会替换该模型的平均规则和指定调整，页面调整数组固定为空')] },
  { id: 'setting-token-allocation-download-template', title: '下载用量分配导入模板', write: false, params: [] },
  { id: 'setting-token-allocation-prepare-import', title: '准备导入用量分配文件', write: false, params: [modelIdParam, p('overLimitStrategy', 'enum', true, '导入策略；Portal/Java接口允许0继承全局、1禁止或2提醒'), p('startTime', 'date', true, '生效时间，YYYY-MM-DD HH:mm:ss'), p('endTime', 'date', false, '结束时间；有值时必须晚于startTime'), p('reason', 'text', false, '批量调整原因，最多500字符'), draftParam('file', 'Excel文件输入；fileName支持.xls/.xlsx，base64必须为非空标准Base64')] },
  { id: 'setting-token-allocation-import', title: '导入用量分配', write: true, params: [draftParam('draft', 'prepareImport返回的表单草稿'), draftParam('file', '与prepareImport相同的原始Excel文件输入；SDK以multipart/form-data提交')] },
  { id: 'setting-token-allocation-effective-list', title: '查询用户有效用量分配', write: false, params: [modelIdParam, p('userName', 'text', false, '用户名模糊筛选；默认空字符串'), p('allocationMethod', 'enum', false, '分配方式筛选；空值不发送', allocationMethodOptions), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，默认20')] },
  { id: 'setting-token-allocation-prepare-save-user', title: '准备保存用户用量分配', write: false, params: [modelIdParam, draftParam('formState', '用户分配草稿；userId、userPhone、allocatedQuota、overLimitStrategy、startTime必填，endTime必须晚于startTime，reason最多500字符')] },
  { id: 'setting-token-allocation-save-user', title: '保存用户用量分配', write: true, params: [draftParam('draft', 'prepareSaveUser返回的用户分配草稿；有id为编辑，无id为新增/按手机号更新')] },
  { id: 'setting-token-allocation-prepare-clear-user', title: '准备清空用户用量分配', write: false, params: [p('id', 'text', true, '当前有效分配行的allocation id')] },
  { id: 'setting-token-allocation-clear-user', title: '清空用户用量分配', write: true, params: [draftParam('draft', 'prepareClearUser返回的allocation id；调用前应由用户确认')] },
  { id: 'setting-token-allocation-prepare-clear-all', title: '准备清空模型用量分配', write: false, params: [modelIdParam] },
  { id: 'setting-token-allocation-clear-all', title: '清空模型用户用量分配', write: true, params: [draftParam('draft', 'prepareClearAll返回的modelId；只清空用户指定分配，平均基础规则由后端保留')] },
  { id: 'setting-token-allocation-apply-list', title: '查询用量分配申请记录', write: false, params: [modelIdParam, p('userName', 'text', false, '申请人名称模糊筛选；默认空字符串'), p('status', 'enum', false, '页面筛选状态0待处理、1已忽略、2已填写、3已驳回、4已处理；按Portal原样传递', applyStatusOptions), p('dateRange', 'date', false, '申请时间范围；转换为startDate/endDate，按页面原值发送'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，默认20')] },
  { id: 'setting-token-allocation-prepare-handle-apply', title: '准备处理用量分配申请', write: false, params: [p('id', 'text', true, '申请记录ID'), p('status', 'enum', true, '处理状态只允许3驳回或4已处理', [{ label: '驳回', value: APPLY_STATUS_REJECTED }, { label: '已处理', value: APPLY_STATUS_HANDLED }]), p('rejectReason', 'text', false, '驳回原因，最多500字符；Portal未设必填校验')] },
  { id: 'setting-token-allocation-handle-apply', title: '处理用量分配申请', write: true, params: [draftParam('draft', 'prepareHandleApply返回的申请处理草稿；3才提交rejectReason')] },
  { id: 'setting-token-allocation-pending-count', title: '查询待处理用量分配申请数', write: false, params: [modelIdParam] },
  { id: 'setting-token-allocation-user-search', title: '按关键词查询用量分配用户候选', write: false, params: [p('keyword', 'search', true, '用户名称关键词；必须非空，避免照抄Portal的全量候选请求'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，默认20')] },
].map(definition => ({ ...definition, ...pageContext }))
