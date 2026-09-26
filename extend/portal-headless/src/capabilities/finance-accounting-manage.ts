import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal 系统「财务设置 / 账套管理」；静态锚点 frontend d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_ACCOUNTING_MANAGE_PAGE_PATH = '/dashboard/finance/setting/accounting-manage/list'
const ROOT = '/admin-api/finance/accounting-manage'

export type FinanceAccountingManageId = string | number
export type FinanceAccountingManageStatus = 0 | 1
export type FinanceAccountingManageLongTerm = 0 | 1

export type FinanceAccountingManageQuery = {
  corporationId?: FinanceAccountingManageId | null
  accountCode?: string
  accountingName?: string
  accountingStandardsApply?: number | ''
  periodYear?: string
  status?: FinanceAccountingManageStatus
  pageNo?: number
  pageSize?: 10 | 20 | 50 | 100
}

export type FinanceAccountingManageRow = {
  id: FinanceAccountingManageId
  accountingName: string
  accountCode: string
  currencyType: number | null
  corporationId: FinanceAccountingManageId | null
  corporationName: string | null
  accountingStandardsApply: number
  natureId: FinanceAccountingManageId | null
  natureName: string | null
  isLongTerm: FinanceAccountingManageLongTerm
  startTime: string
  endTime: string | null
  periodId: FinanceAccountingManageId
  periodYear: string | null
  accuracyId: FinanceAccountingManageId
  accuracyName: string | null
  accuracyCurrencyType: number | null
  accuracyDecimalQuantity: number | null
  accuracyDecimalUnitPrice: number | null
  accuracyDecimalAmount: number | null
  industry: string | null
  creditCode: string | null
  taxCode: string | null
  businessAddress: string | null
  contacts: string | null
  contactPhone: string | null
  valueAddedUserId: FinanceAccountingManageId | null
  valueAddedUserName: string | null
  status: FinanceAccountingManageStatus
  isEnable: FinanceAccountingManageStatus | null
  createTime: string | number | null
}

export type FinanceAccountingManageDraft = {
  accountingName: string
  accountCode: string
  corporationId: FinanceAccountingManageId
  accountingStandardsApply: number
  isLongTerm: FinanceAccountingManageLongTerm
  startTime: string
  endTime?: string | null
  periodId: FinanceAccountingManageId
  accuracyId: FinanceAccountingManageId
  industry?: string
  creditCode?: string
  taxCode?: string
  businessAddress?: string
  contacts?: string
  contactPhone?: string
  valueAddedUserId?: FinanceAccountingManageId | null
}

export type FinanceAccountingManagePayload = Omit<Required<FinanceAccountingManageDraft>, 'endTime'> & {
  endTime: string
  status: 0
}

export type FinanceAccountingManageStatusInput = {
  id: FinanceAccountingManageId
  currentStatus: FinanceAccountingManageStatus
  status: FinanceAccountingManageStatus
  isEnable?: FinanceAccountingManageStatus | null
}

export type FinanceAccountingManageExport = {
  fileName: '账套管理.xls'
  contentType: string | null
  base64: string
  byteLength: number
}

type UnknownRecord = Record<string, unknown>

function objectOf(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as UnknownRecord
}

function idOf(value: unknown, label: string): FinanceAccountingManageId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  }
  return value
}

function statusOf(value: unknown, label = 'status'): FinanceAccountingManageStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function longTermOf(value: unknown): FinanceAccountingManageLongTerm {
  if (value !== 0 && value !== 1) throw new Error('isLongTerm只能是数值0（时间范围）或1（长期有效）')
  return value
}

function integerOf(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function textOf(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function nullableTextOf(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return textOf(value, label)
}

function nullableIntegerOf(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  return integerOf(value, label)
}

function dateOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return value
}

function pageOf(value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  return textOf(value, label)
}

function queryOf(query: FinanceAccountingManageQuery): Required<FinanceAccountingManageQuery> {
  const standard = query.accountingStandardsApply ?? ''
  if (standard !== '' && !Number.isSafeInteger(standard)) throw new Error('accountingStandardsApply必须为安全整数或空字符串')
  const year = query.periodYear ?? ''
  if (typeof year !== 'string' || (year !== '' && !/^\d{4}$/.test(year))) throw new Error('periodYear必须为YYYY或空字符串')
  return {
    corporationId: query.corporationId == null ? null : idOf(query.corporationId, 'corporationId'),
    accountCode: optionalText(query.accountCode, 'accountCode'),
    accountingName: optionalText(query.accountingName, 'accountingName'),
    accountingStandardsApply: standard,
    periodYear: year,
    status: statusOf(query.status ?? 0),
    pageNo: pageOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageOf(query.pageSize, 20, 'pageSize') as 10 | 20 | 50 | 100,
  }
}

function payloadOf(input: FinanceAccountingManageDraft): FinanceAccountingManagePayload {
  const accountingName = textOf(input?.accountingName, 'accountingName')
  if (!accountingName.trim()) throw new Error('accountingName必填且不得全为空格')
  const accountCode = textOf(input?.accountCode, 'accountCode')
  if (!/^\d{4}$/.test(accountCode)) throw new Error('accountCode必须为4位数字')
  const isLongTerm = longTermOf(input?.isLongTerm)
  const startTime = dateOf(input?.startTime, 'startTime')
  let endTime = ''
  if (isLongTerm === 0) {
    endTime = dateOf(input?.endTime, 'endTime')
    if (endTime < startTime) throw new Error('endTime不能早于startTime')
    if (endTime.slice(0, 4) !== startTime.slice(0, 4)) throw new Error('startTime和endTime必须属于同一年')
  } else if (input.endTime !== undefined && input.endTime !== null && input.endTime !== '') {
    throw new Error('长期有效账套的endTime必须省略、null或空字符串')
  }
  const contactPhone = optionalText(input.contactPhone, 'contactPhone')
  if (contactPhone && !/^1[3456789]\d{9}$/.test(contactPhone)) throw new Error('contactPhone必须是有效的11位中国大陆手机号')
  return {
    corporationId: idOf(input.corporationId, 'corporationId'),
    accountingName,
    contactPhone,
    contacts: optionalText(input.contacts, 'contacts'),
    businessAddress: optionalText(input.businessAddress, 'businessAddress'),
    taxCode: optionalText(input.taxCode, 'taxCode'),
    creditCode: optionalText(input.creditCode, 'creditCode'),
    industry: optionalText(input.industry, 'industry'),
    periodId: idOf(input.periodId, 'periodId'),
    accuracyId: idOf(input.accuracyId, 'accuracyId'),
    startTime,
    endTime,
    accountingStandardsApply: integerOf(input.accountingStandardsApply, 'accountingStandardsApply'),
    accountCode,
    isLongTerm,
    status: 0,
    valueAddedUserId: input.valueAddedUserId == null ? null : idOf(input.valueAddedUserId, 'valueAddedUserId'),
  }
}

function rowOf(value: unknown): FinanceAccountingManageRow {
  const row = objectOf(value, '账套列表行')
  const isLongTerm = longTermOf(row.isLongTerm)
  const endTime = nullableTextOf(row.endTime, 'endTime')
  return {
    id: idOf(row.id, 'id'),
    accountingName: textOf(row.accountingName, 'accountingName'),
    accountCode: textOf(row.accountCode, 'accountCode'),
    currencyType: nullableIntegerOf(row.currencyType, 'currencyType'),
    corporationId: row.corporationId == null ? null : idOf(row.corporationId, 'corporationId'),
    corporationName: nullableTextOf(row.corporationName, 'corporationName'),
    accountingStandardsApply: integerOf(row.accountingStandardsApply, 'accountingStandardsApply'),
    natureId: row.natureId == null ? null : idOf(row.natureId, 'natureId'),
    natureName: nullableTextOf(row.natureName, 'natureName'),
    isLongTerm,
    startTime: dateOf(row.startTime, 'startTime'),
    endTime: endTime === null ? null : dateOf(endTime, 'endTime'),
    periodId: idOf(row.periodId, 'periodId'),
    periodYear: nullableTextOf(row.periodYear, 'periodYear'),
    accuracyId: idOf(row.accuracyId, 'accuracyId'),
    accuracyName: nullableTextOf(row.accuracyName, 'accuracyName'),
    accuracyCurrencyType: nullableIntegerOf(row.accuracyCurrencyType, 'accuracyCurrencyType'),
    accuracyDecimalQuantity: nullableIntegerOf(row.accuracyDecimalQuantity, 'accuracyDecimalQuantity'),
    accuracyDecimalUnitPrice: nullableIntegerOf(row.accuracyDecimalUnitPrice, 'accuracyDecimalUnitPrice'),
    accuracyDecimalAmount: nullableIntegerOf(row.accuracyDecimalAmount, 'accuracyDecimalAmount'),
    industry: nullableTextOf(row.industry, 'industry'),
    creditCode: nullableTextOf(row.creditCode, 'creditCode'),
    taxCode: nullableTextOf(row.taxCode, 'taxCode'),
    businessAddress: nullableTextOf(row.businessAddress, 'businessAddress'),
    contacts: nullableTextOf(row.contacts, 'contacts'),
    contactPhone: nullableTextOf(row.contactPhone, 'contactPhone'),
    valueAddedUserId: row.valueAddedUserId == null ? null : idOf(row.valueAddedUserId, 'valueAddedUserId'),
    valueAddedUserName: nullableTextOf(row.valueAddedUserName, 'valueAddedUserName'),
    status: statusOf(row.status),
    isEnable: row.isEnable == null ? null : statusOf(row.isEnable, 'isEnable'),
    createTime: row.createTime == null ? null : typeof row.createTime === 'string'
      ? row.createTime
      : Number.isFinite(row.createTime) ? Number(row.createTime) : (() => { throw new Error('createTime必须为字符串、有限数值或null') })(),
  }
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('账套导出响应不是二进制文件')
}

function contentTypeOf(response: AxiosResponse): string | null {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return typeof value === 'string' && value ? value : null
}

function keywordOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须提供非空关键字`)
  return value.trim()
}

function candidatePageOf(value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 1 || (label === 'pageSize' && resolved > 100)) {
    throw new Error(`${label}必须为${label === 'pageSize' ? '1至100' : '正'}整数`)
  }
  return resolved
}

export function createFinanceAccountingManageCapability(request: PortalRequest) {
  return {
    async list(query: FinanceAccountingManageQuery = {}): Promise<PageResult<FinanceAccountingManageRow>> {
      const filters = queryOf(query)
      const page = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
          corporationId: filters.corporationId,
          accountCode: filters.accountCode,
          accountingName: filters.accountingName,
          accountingStandardsApply: filters.accountingStandardsApply,
          periodYear: filters.periodYear,
          status: filters.status,
          pageNo: filters.pageNo,
          pageSize: filters.pageSize,
        },
      })
      if (!page || !Array.isArray(page.list) || !Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error('账套分页响应缺少有效list或total')
      }
      return { list: page.list.map(rowOf), total: page.total }
    },

    detail(input: { row: FinanceAccountingManageRow }): FinanceAccountingManageRow {
      return rowOf(objectOf(input, '详情输入').row)
    },

    async exportExcel(filters: FinanceAccountingManageQuery = {}): Promise<FinanceAccountingManageExport> {
      const query = queryOf(filters)
      const response = await request<AxiosResponse<ArrayBuffer>>({
        url: `${ROOT}/export-excel`,
        method: 'get',
        params: {
          corporationId: query.corporationId,
          accountCode: query.accountCode,
          accountingName: query.accountingName,
          accountingStandardsApply: query.accountingStandardsApply,
          periodYear: query.periodYear,
          status: query.status,
        },
        responseType: 'arraybuffer',
      })
      const bytes = bytesOf(response?.data)
      if (bytes.byteLength === 0) throw new Error('账套导出响应为空文件')
      return {
        fileName: '账套管理.xls',
        contentType: contentTypeOf(response),
        base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
        byteLength: bytes.byteLength,
      }
    },

    async searchCorporations(query: { keyword: string; pageNo?: number; pageSize?: number }) {
      const page = await request<PageResult<unknown>>({
        url: '/org/corporation/page',
        method: 'get',
        params: {
          order: '',
          orderField: '',
          name: keywordOf(query?.keyword, 'keyword'),
          mainInvest: '',
          pageNo: candidatePageOf(query?.pageNo, 1, 'pageNo'),
          pageSize: candidatePageOf(query?.pageSize, 20, 'pageSize'),
        },
      })
      if (!page || !Array.isArray(page.list) || !Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error('法人候选响应缺少有效list或total')
      }
      return {
        list: page.list.map(value => {
          const row = objectOf(value, '法人候选')
          return { id: idOf(row.id, '法人id'), name: textOf(row.name, '法人name') }
        }),
        total: page.total,
      }
    },

    async accountingStandardsOptions(): Promise<{ list: Array<{ id: FinanceAccountingManageId; value: number; label: string }> }> {
      const groups = await request<unknown[]>({ url: '/admin-api/system/dict-data/grouped-list', method: 'get' })
      if (!Array.isArray(groups)) throw new Error('平台字典响应必须是数组')
      const group = groups.map(item => objectOf(item, '字典分组')).find(item => item.dictType === 'accounting_standards_apply')
      if (!group || !Array.isArray(group.dataList)) throw new Error('平台字典缺少accounting_standards_apply')
      return {
        list: group.dataList.map(value => {
          const item = objectOf(value, '会计准则选项')
          const numeric = Number(item.value)
          if (!Number.isSafeInteger(numeric)) throw new Error('会计准则value必须可转换为安全整数')
          return { id: idOf(item.id, '会计准则字典id'), value: numeric, label: textOf(item.label, '会计准则label') }
        }),
      }
    },

    async accountingPeriodOptions(input: { startTime: string; isLongTerm: FinanceAccountingManageLongTerm }) {
      const startTime = dateOf(input?.startTime, 'startTime')
      const isLongTerm = longTermOf(input?.isLongTerm)
      const page = await request<PageResult<unknown>>({
        url: '/admin-api/finance/accounting-period/page',
        method: 'get',
        params: { pageSize: -1, status: 0 },
      })
      if (!page || !Array.isArray(page.list)) throw new Error('会计期间候选响应缺少list')
      const startYear = Number(startTime.slice(0, 4))
      const list = page.list.map(value => {
        const row = objectOf(value, '会计期间候选')
        return { id: idOf(row.id, '会计期间id'), year: integerOf(row.year, '会计期间year') }
      }).filter(item => isLongTerm === 1 ? item.year >= startYear : item.year === startYear)
      return { list, total: list.length }
    },

    async accuracyOptions(): Promise<{ list: Array<{ id: FinanceAccountingManageId; name: string; currencyType: number | null; decimalQuantity: number | null; decimalUnitPrice: number | null; decimalAmount: number | null }> }> {
      const page = await request<PageResult<unknown>>({
        url: '/admin-api/finance/accuracy-manage/page',
        method: 'get',
        params: { pageSize: -1, status: 0 },
      })
      if (!page || !Array.isArray(page.list)) throw new Error('会计精度候选响应缺少list')
      return {
        list: page.list.map(value => {
          const row = objectOf(value, '会计精度候选')
          const id = idOf(row.id, '会计精度id')
          return {
            id,
            name: row.accuracyName == null || row.accuracyName === '' ? `精度 #${id}` : textOf(row.accuracyName, 'accuracyName'),
            currencyType: nullableIntegerOf(row.currencyType, 'currencyType'),
            decimalQuantity: nullableIntegerOf(row.decimalQuantity, 'decimalQuantity'),
            decimalUnitPrice: nullableIntegerOf(row.decimalUnitPrice, 'decimalUnitPrice'),
            decimalAmount: nullableIntegerOf(row.decimalAmount, 'decimalAmount'),
          }
        }),
      }
    },

    async searchUsers(query: { keyword: string; pageNo?: number; pageSize?: number }) {
      const page = await request<PageResult<unknown>>({
        url: '/sys/user/getUserBasicInfoPage',
        method: 'get',
        params: {
          pageNo: candidatePageOf(query?.pageNo, 1, 'pageNo'),
          pageSize: candidatePageOf(query?.pageSize, 20, 'pageSize'),
          name: keywordOf(query?.keyword, 'keyword'),
          statusList: '1,4',
        },
      })
      if (!page || !Array.isArray(page.list) || !Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error('人员候选响应缺少有效list或total')
      }
      return {
        list: page.list.map(value => {
          const row = objectOf(value, '人员候选')
          const id = idOf(row.id, '用户id')
          const realName = textOf(row.realName, 'realName')
          const username = textOf(row.username, 'username')
          return { id, realName, username, label: `${realName}(${username})` }
        }),
        total: page.total,
      }
    },

    prepareCreate(input: FinanceAccountingManageDraft): { draft: FinanceAccountingManagePayload } {
      return { draft: payloadOf(input) }
    },

    async create(input: FinanceAccountingManageDraft): Promise<FinanceAccountingManageId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input) }), '新建账套id')
    },

    async setStatus(input: FinanceAccountingManageStatusInput): Promise<true> {
      const currentStatus = statusOf(input?.currentStatus, 'currentStatus')
      const status = statusOf(input?.status)
      if (status === currentStatus) throw new Error('status必须是currentStatus的相反目标状态')
      if (currentStatus === 1 && status === 0 && input.isEnable !== 1) {
        throw new Error('当前停用账套的isEnable不是1，PC页面禁止启用')
      }
      const result = await request({
        url: `${ROOT}/enableOrStop`,
        method: 'put',
        data: { id: idOf(input.id, 'id'), status },
      })
      if (result !== true) throw new Error('账套启停响应不是true')
      return true
    },
  }
}

export type FinanceAccountingManageCapability = ReturnType<typeof createFinanceAccountingManageCapability>
export type FinanceAccountingManageCapabilityWithIdempotency = FinanceAccountingManageCapability & {
  createIdempotent: (input: FinanceAccountingManageDraft & { requestId: string }) => Promise<FinanceAccountingManageId>
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const searchP = (name: string, capabilityId: string, required = false, keywordParam = ''): ParamSpec => ({
  name,
  kind: 'search',
  required,
  ...(keywordParam ? { lookup: { capabilityId, keywordParam } } : {}),
})
const enumP = (name: string, options: Array<{ label: string; value: number }>, required = false): ParamSpec => ({
  name, kind: 'enum', required, options,
})
const statusP = (name = 'status', required = false) => enumP(name, [{ label: '启用', value: 0 }, { label: '停用', value: 1 }], required)
const listParams: ParamSpec[] = [
  searchP('corporationId', 'finance-accounting-manage-corporation-search', false, 'keyword'), p('accountCode', 'text'), p('accountingName', 'text'),
  searchP('accountingStandardsApply', 'finance-accounting-manage-accounting-standards-options'), p('periodYear', 'date'), statusP(),
  p('pageNo', 'number'), p('pageSize', 'number'),
]
const createParams: ParamSpec[] = [
  p('accountingName', 'text', true), p('accountCode', 'text', true), searchP('corporationId', 'finance-accounting-manage-corporation-search', true, 'keyword'),
  searchP('accountingStandardsApply', 'finance-accounting-manage-accounting-standards-options', true), enumP('isLongTerm', [{ label: '时间范围', value: 0 }, { label: '长期有效', value: 1 }], true), p('startTime', 'date', true),
  p('endTime', 'date'), searchP('periodId', 'finance-accounting-manage-accounting-period-options', true), searchP('accuracyId', 'finance-accounting-manage-accuracy-options', true),
  p('industry', 'text'), p('creditCode', 'text'), p('taxCode', 'text'), p('businessAddress', 'text'),
  p('contacts', 'text'), p('contactPhone', 'text'), searchP('valueAddedUserId', 'finance-accounting-manage-user-search', false, 'keyword'),
]

export const FINANCE_ACCOUNTING_MANAGE_METHODS = {
  'finance-accounting-manage-list': 'list',
  'finance-accounting-manage-detail': 'detail',
  'finance-accounting-manage-export': 'exportExcel',
  'finance-accounting-manage-corporation-search': 'searchCorporations',
  'finance-accounting-manage-accounting-standards-options': 'accountingStandardsOptions',
  'finance-accounting-manage-accounting-period-options': 'accountingPeriodOptions',
  'finance-accounting-manage-accuracy-options': 'accuracyOptions',
  'finance-accounting-manage-user-search': 'searchUsers',
  'finance-accounting-manage-prepare-create': 'prepareCreate',
  'finance-accounting-manage-create': 'createIdempotent',
  'finance-accounting-manage-set-status': 'setStatus',
} as const

export const financeAccountingManageCapabilities: CapabilityDefinition[] = [
  { id: 'finance-accounting-manage-list', title: '查询账套', write: false, params: listParams },
  { id: 'finance-accounting-manage-detail', title: '查看账套详情', write: false, params: [p('row', 'text', true, '来自最新账套列表的完整行对象；精细类型见AI契约')] },
  { id: 'finance-accounting-manage-export', title: '导出账套', write: false, params: listParams.slice(0, 6) },
  { id: 'finance-accounting-manage-corporation-search', title: '搜索账套法人候选', write: false, params: [p('keyword', 'text', true), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-accounting-manage-accounting-standards-options', title: '查询账套会计准则候选', write: false, params: [] },
  { id: 'finance-accounting-manage-accounting-period-options', title: '查询账套会计期间候选', write: false, params: [p('startTime', 'date', true), p('isLongTerm', 'enum', true)] },
  { id: 'finance-accounting-manage-accuracy-options', title: '查询账套会计精度候选', write: false, params: [] },
  { id: 'finance-accounting-manage-user-search', title: '搜索账套增值会计候选', write: false, params: [p('keyword', 'text', true), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-accounting-manage-prepare-create', title: '准备创建账套', write: false, params: createParams },
  { id: 'finance-accounting-manage-create', title: '创建账套', write: true, params: [...createParams, p('requestId', 'text', true)] },
  { id: 'finance-accounting-manage-set-status', title: '启用或停用账套', write: true, params: [p('id', 'text', true), statusP('currentStatus', true), statusP('status', true), enumP('isEnable', [{ label: '不允许启用', value: 0 }, { label: '允许启用', value: 1 }])] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_ACCOUNTING_MANAGE_PAGE_PATH,
  permission: '/dashboard/finance/setting/accounting-manage',
  httpInstance: 'platform' as const,
}))
