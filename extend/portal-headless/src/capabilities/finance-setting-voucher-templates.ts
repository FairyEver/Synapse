import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「财务设置 → 凭证模板」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH = '/dashboard/finance/setting/voucher-templates/list'
const ROOT = '/admin-api/finance/voucher-template'
const AMOUNT_OPTION_URL = '/admin-api/finance/voucher-amount-option/list'

export type FinanceVoucherTemplateId = string | number
export type FinanceVoucherTemplateStatus = 0 | 1
export type FinanceVoucherEntryType = 1 | 2

export type FinanceVoucherTemplateQuery = {
  name?: string
  businessType?: string
  businessDetail?: string
  orgAttributes?: string
  cashItem?: string
  status?: FinanceVoucherTemplateStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceVoucherTemplateRow = {
  id: FinanceVoucherTemplateId
  name: string | null
  businessType: string | null
  businessDetail: string | null
  createTime: string | number | null
  updateTime: string | number | null
  status: FinanceVoucherTemplateStatus
}

export type FinanceVoucherTemplateEntryLineDraft = {
  subjectId: FinanceVoucherTemplateId
  subjectFullPath?: string
  subjectAmount: Array<string | number>
  addInfo?: Array<string | number>
  cashItemList?: number[]
  type: FinanceVoucherEntryType
}

export type FinanceVoucherTemplateEntryDraft = {
  borrowList: FinanceVoucherTemplateEntryLineDraft[]
  lendList: FinanceVoucherTemplateEntryLineDraft[]
  summary: string
  summaryId?: FinanceVoucherTemplateId | null
  accountingSetType: number
}

export type FinanceVoucherTemplateCreateDraft = {
  name: string
  businessType: string
  businessDetail: string
  outlay?: Record<string, unknown>
  income?: Record<string, unknown>
  allocate?: Record<string, unknown>
  inventory?: Record<string, unknown>
  transfer?: Record<string, unknown>
  entry: FinanceVoucherTemplateEntryDraft[]
  status?: FinanceVoucherTemplateStatus
}

export type FinanceVoucherTemplateCreatePayload = {
  name: string
  businessType: string
  businessDetail: string
  outlay: Record<string, unknown>
  income: Record<string, unknown>
  allocate: Record<string, unknown>
  inventory: Record<string, unknown>
  transfer: Record<string, unknown>
  entry: Array<{
    summary: string
    summaryId: FinanceVoucherTemplateId | null
    accountingSetType: number
    entrySaveReqVOList: Array<{
      subjectId: FinanceVoucherTemplateId
      subjectAmount: string
      addInfo: string
      cashItemList: number[]
      type: FinanceVoucherEntryType
    }>
  }>
  status: FinanceVoucherTemplateStatus
}

export type FinanceVoucherTemplateStatusDraft = FinanceVoucherTemplateRow
export type FinanceVoucherTemplatePreparedStatus = {
  draft: FinanceVoucherTemplateStatusDraft
  previous: FinanceVoucherTemplateRow
}

export type FinanceVoucherAmountOption = {
  amountCode: string
  amountLabel: string
  sort: number | null
}

export type FinanceVoucherTemplateExport = {
  fileName: '凭证模版基础信息.xls'
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

const EMPTY_OUTLAY: JsonObject = {
  useMethod: '', isIncludeTax: '', paymentMethod: '', taxName: '', interestUse: '', businessContent: '', periodDetails: '', expenseSelection: '', energyType: '',
}
const EMPTY_INCOME: JsonObject = {
  isCreditUsed: '', isIncludeTax: '', productCategory: [], paymentMethod: '', deliveryStatus: '', assetType: '', payoutMethods: '', subsidyType: '', periodDetails: '', offerType: '', offerStatus: '', paymentStatus: '', giftType: '', expenseType: '', isMaintainTax: '',
}
const EMPTY_ALLOCATE: JsonObject = {
  increaseType: '', assetCategory: '', decreaseType: '', orgAttributes: '', assetType: '', operationContent: '', paymentType: '', flockBreedingStage: '', outCategory: [], inCategory: [], productCategory: [], expenseCategory: '', fundHandlingMethod: '', isCrossStandardUnit: '', emptyShedTime: '', currentOrgBelong: '',
}
const EMPTY_INVENTORY: JsonObject = {
  voucherTemplateId: '', materialName: '', materialId: '', movementType: '', unitType: '', isIncludeTax: '',
}
const EMPTY_TRANSFER: JsonObject = {
  isCreditUsed: '', transferProductCategory: [], isCrossAccountingSet: '',
}

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceVoucherTemplateId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function textOf (value: unknown, label: string, required = true): string {
  if (typeof value !== 'string' || (required && value.length === 0)) throw new Error(`${label}必须为${required ? '非空' : ''}字符串`)
  return value
}

function statusOf (value: unknown, label = 'status'): FinanceVoucherTemplateStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved
}

function queryOf (query: FinanceVoucherTemplateQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    name: query.name ?? '',
    businessType: query.businessType ?? '',
    businessDetail: query.businessDetail ?? '',
    orgAttributes: query.orgAttributes ?? '',
    cashItem: query.cashItem ?? '',
    status: statusOf(query.status ?? 0),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportQueryOf (query: FinanceVoucherTemplateQuery = {}): Record<string, unknown> {
  const value = queryOf(query)
  return {
    name: value.name,
    businessType: value.businessType,
    businessDetail: value.businessDetail,
    orgAttributes: value.orgAttributes,
    cashItem: value.cashItem,
    status: value.status,
  }
}

function rowOf (value: unknown): FinanceVoucherTemplateRow {
  const row = objectOf(value, '凭证模板列表行')
  return {
    id: idOf(row.id, '凭证模板id'),
    name: nullableTextOf(row.name, 'name'),
    businessType: nullableTextOf(row.businessType, 'businessType'),
    businessDetail: nullableTextOf(row.businessDetail, 'businessDetail'),
    createTime: dateTimeOf(row.createTime, 'createTime'),
    updateTime: dateTimeOf(row.updateTime, 'updateTime'),
    status: statusOf(row.status),
  }
}

function detailOf (value: unknown): JsonObject {
  const detail = objectOf(value, '凭证模板详情')
  if (detail.id !== undefined) idOf(detail.id, '凭证模板详情id')
  if (detail.name !== undefined && detail.name !== null) nullableTextOf(detail.name, '凭证模板详情name')
  if (detail.businessType !== undefined && detail.businessType !== null) nullableTextOf(detail.businessType, '凭证模板详情businessType')
  if (detail.businessDetail !== undefined && detail.businessDetail !== null) nullableTextOf(detail.businessDetail, '凭证模板详情businessDetail')
  if (detail.status !== undefined && detail.status !== null) statusOf(detail.status, '凭证模板详情status')
  return detail
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function nullableIdOf (value: unknown, label: string): FinanceVoucherTemplateId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function stringListOf (value: unknown, label: string, required: boolean): Array<string | number> {
  if (!Array.isArray(value) || (required && value.length === 0)) throw new Error(`${label}必须是${required ? '非空' : ''}数组`)
  return value.map((item, index) => {
    if (typeof item !== 'string' && typeof item !== 'number') throw new Error(`${label}[${index}]必须为字符串或数字`)
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error(`${label}[${index}]必须为有限数字`)
    return item
  })
}

function cashItemListOf (value: unknown, label: string): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => integerOf(item, `${label}[${index}]`))
}

function entryTypeOf (value: unknown, label: string): FinanceVoucherEntryType {
  if (value !== 1 && value !== 2) throw new Error(`${label}只能是1（借）或2（贷）`)
  return value
}

function entryLineOf (value: unknown, label: string, expectedType: FinanceVoucherEntryType): {
  subjectId: FinanceVoucherTemplateId
  subjectAmount: string
  addInfo: string
  cashItemList: number[]
  type: FinanceVoucherEntryType
} {
  const row = objectOf(value, label)
  const type = entryTypeOf(row.type, `${label}.type`)
  if (type !== expectedType) throw new Error(`${label}.type必须与借贷列表一致`)
  return {
    subjectId: idOf(row.subjectId, `${label}.subjectId`),
    subjectAmount: stringListOf(row.subjectAmount, `${label}.subjectAmount`, true).join(','),
    addInfo: stringListOf(row.addInfo ?? [], `${label}.addInfo`, false).join(','),
    cashItemList: cashItemListOf(row.cashItemList, `${label}.cashItemList`),
    type,
  }
}

function entryOf (value: unknown, index: number): FinanceVoucherTemplateCreatePayload['entry'][number] {
  const entry = objectOf(value, `entry[${index}]`)
  const summary = textOf(entry.summary, `entry[${index}].summary`)
  const accountingSetType = integerOf(entry.accountingSetType, `entry[${index}].accountingSetType`)
  const summaryId = nullableIdOf(entry.summaryId, `entry[${index}].summaryId`)
  if (!Array.isArray(entry.borrowList) || entry.borrowList.length === 0) throw new Error(`entry[${index}].borrowList至少需要一条借方信息`)
  if (!Array.isArray(entry.lendList) || entry.lendList.length === 0) throw new Error(`entry[${index}].lendList至少需要一条贷方信息`)
  return {
    summary,
    summaryId,
    accountingSetType,
    entrySaveReqVOList: [
      ...entry.borrowList.map((item, rowIndex) => entryLineOf(item, `entry[${index}].borrowList[${rowIndex}]`, 1)),
      ...entry.lendList.map((item, rowIndex) => entryLineOf(item, `entry[${index}].lendList[${rowIndex}]`, 2)),
    ],
  }
}

function createDetailOf (value: unknown, fallback: JsonObject, label: string): JsonObject {
  if (value === undefined) return { ...fallback }
  return { ...fallback, ...objectOf(value, label) }
}

function createPayloadOf (input: FinanceVoucherTemplateCreateDraft): FinanceVoucherTemplateCreatePayload {
  const value = objectOf(input, '创建凭证模板输入')
  const entry = value.entry
  if (!Array.isArray(entry) || entry.length === 0) throw new Error('entry至少需要一条凭证信息')
  const name = textOf(value.name, 'name')
  if (name.length > 100) throw new Error('name最大长度为100')
  return {
    name,
    businessType: textOf(value.businessType, 'businessType'),
    businessDetail: textOf(value.businessDetail, 'businessDetail'),
    outlay: createDetailOf(value.outlay, EMPTY_OUTLAY, 'outlay'),
    income: createDetailOf(value.income, EMPTY_INCOME, 'income'),
    allocate: createDetailOf(value.allocate, EMPTY_ALLOCATE, 'allocate'),
    inventory: createDetailOf(value.inventory, EMPTY_INVENTORY, 'inventory'),
    transfer: createDetailOf(value.transfer, EMPTY_TRANSFER, 'transfer'),
    entry: entry.map((item, index) => entryOf(item, index)),
    status: statusOf(value.status ?? 0),
  }
}

function statusDraftOf (input: unknown, label: string): FinanceVoucherTemplateRow {
  return rowOf(input)
}

function bytesOf (response: AxiosResponse<ArrayBuffer>): Uint8Array {
  const data: unknown = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('凭证模板导出响应不是二进制文件')
}

function contentTypeOf (response: AxiosResponse): string | null {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return typeof value === 'string' && value ? value : null
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function amountOptionOf (value: unknown, index: number): FinanceVoucherAmountOption {
  const option = objectOf(value, `金额选项[${index}]`)
  return {
    amountCode: textOf(option.amountCode, `金额选项[${index}].amountCode`),
    amountLabel: textOf(option.amountLabel, `金额选项[${index}].amountLabel`),
    sort: option.sort === undefined || option.sort === null ? null : integerOf(option.sort, `金额选项[${index}].sort`),
  }
}

export function createFinanceSettingVoucherTemplatesCapability (request: PortalRequest) {
  return {
    async list (query: FinanceVoucherTemplateQuery = {}): Promise<PageResult<FinanceVoucherTemplateRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('凭证模板分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (input: { id: FinanceVoucherTemplateId }): Promise<JsonObject | null> {
      const id = idOf(input?.id, '凭证模板id')
      const result = await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id } })
      if (result === null || result === undefined) return null
      return detailOf(result)
    },

    async amountOptions (input: { businessType: string; businessDetail?: string | null }): Promise<FinanceVoucherAmountOption[]> {
      const businessType = textOf(input?.businessType, 'businessType')
      const businessDetail = input?.businessDetail === undefined || input.businessDetail === null ? undefined : textOf(input.businessDetail, 'businessDetail')
      const result = await request<unknown>({ url: AMOUNT_OPTION_URL, method: 'get', params: { businessType, businessDetail } })
      if (!Array.isArray(result)) throw new Error('凭证模板金额选项响应必须是数组')
      return result.map(amountOptionOf)
    },

    prepareCreate (input: FinanceVoucherTemplateCreateDraft): { draft: FinanceVoucherTemplateCreatePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceVoucherTemplateCreateDraft): Promise<FinanceVoucherTemplateId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: createPayloadOf(input) })
      return idOf(result, '创建凭证模板返回的id')
    },

    prepareSetStatus (input: { current: FinanceVoucherTemplateRow; targetStatus: FinanceVoucherTemplateStatus }): FinanceVoucherTemplatePreparedStatus {
      const current = statusDraftOf(input?.current, '启停凭证模板当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { ...current, status: targetStatus }, previous: current }
    },

    async setStatus (input: { draft: FinanceVoucherTemplateStatusDraft }): Promise<true> {
      const draft = statusDraftOf(input?.draft, '凭证模板启停输入')
      return trueResult(await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft }), '凭证模板启停')
    },

    async exportExcel (query: FinanceVoucherTemplateQuery = {}): Promise<FinanceVoucherTemplateExport> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: exportQueryOf(query), responseType: 'arraybuffer' })
      const bytes = bytesOf(response)
      if (bytes.byteLength === 0) throw new Error('凭证模板导出响应为空文件')
      return {
        fileName: '凭证模版基础信息.xls',
        contentType: contentTypeOf(response),
        base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
        byteLength: bytes.byteLength,
      }
    },

    preview (input: { record: FinanceVoucherTemplateRow | JsonObject }): JsonObject {
      const record = objectOf(input?.record, '凭证模板预览记录')
      const row = rowOf(record)
      return { ...record, ...row }
    },
  }
}

export type FinanceSettingVoucherTemplatesCapability = ReturnType<typeof createFinanceSettingVoucherTemplatesCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const statusParam: ParamSpec = { name: 'status', kind: 'enum', required: false, description: '绝对状态：0启用，1停用；页面默认0', options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }] }
const queryParams: ParamSpec[] = [p('name', 'text', false, '集成逻辑名称筛选'), p('businessType', 'text', false, '业务类型字典值'), p('businessDetail', 'text', false, '业务场景字典值'), p('orgAttributes', 'text', false, 'Portal列表保留的旧筛选键'), p('cashItem', 'text', false, 'Portal列表保留的旧筛选键'), statusParam, p('pageNo', 'number', false, '从1开始的页码'), p('pageSize', 'number', false, '页面支持10、20、50、100')]
const createParams: ParamSpec[] = [p('name', 'text', true, '集成逻辑名称，最多100个字符'), p('businessType', 'text', true, '业务类型字典值'), p('businessDetail', 'text', true, '业务场景字典值'), p('entry', 'text', true, '至少一条凭证信息；每条至少一借一贷，金额数组非空'), p('outlay', 'text', false, '页面支出详情对象'), p('income', 'text', false, '页面收入详情对象'), p('allocate', 'text', false, '页面分配详情对象'), p('inventory', 'text', false, '页面库存详情对象'), p('transfer', 'text', false, '页面转款详情对象'), statusParam]

export const FINANCE_SETTING_VOUCHER_TEMPLATES_METHODS = {
  'finance-setting-voucher-templates-list': 'list',
  'finance-setting-voucher-templates-get': 'get',
  'finance-setting-voucher-templates-amount-options': 'amountOptions',
  'finance-setting-voucher-templates-prepare-create': 'prepareCreate',
  'finance-setting-voucher-templates-create': 'create',
  'finance-setting-voucher-templates-prepare-set-status': 'prepareSetStatus',
  'finance-setting-voucher-templates-set-status': 'setStatus',
  'finance-setting-voucher-templates-export': 'exportExcel',
  'finance-setting-voucher-templates-preview': 'preview',
} as const

export const financeSettingVoucherTemplatesCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-voucher-templates-list', title: '查询凭证模板', write: false, params: queryParams },
  { id: 'finance-setting-voucher-templates-get', title: '查询凭证模板详情', write: false, params: [p('id', 'text', true, '凭证模板主记录ID')] },
  { id: 'finance-setting-voucher-templates-amount-options', title: '查询凭证模板金额选项', write: false, params: [p('businessType', 'text', true, '业务类型字典值'), p('businessDetail', 'text', false, '业务场景字典值')] },
  { id: 'finance-setting-voucher-templates-prepare-create', title: '准备创建凭证模板', write: false, params: createParams },
  { id: 'finance-setting-voucher-templates-create', title: '创建凭证模板', write: true, params: createParams },
  { id: 'finance-setting-voucher-templates-prepare-set-status', title: '准备启停凭证模板', write: false, params: [p('current', 'text', true, '来自最新列表的完整行'), { ...statusParam, name: 'targetStatus', required: true, description: '与当前状态相反的绝对目标状态' }] },
  { id: 'finance-setting-voucher-templates-set-status', title: '启停凭证模板', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的完整行草稿；Portal状态按钮整行PUT')] },
  { id: 'finance-setting-voucher-templates-export', title: '导出凭证模板', write: false, params: queryParams },
  { id: 'finance-setting-voucher-templates-preview', title: '预览凭证模板', write: false, params: [p('record', 'text', true, '来自列表行的预览桥接记录；本地行为，不发请求')] },
].map(definition => ({ ...definition, pagePath: FINANCE_SETTING_VOUCHER_TEMPLATES_PAGE_PATH, permission: '/dashboard/finance/setting/voucher-templates', moduleType: null, httpInstance: 'platform' }))
