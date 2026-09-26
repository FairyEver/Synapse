import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 种摊数据重传」。 */
export const PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH = '/dashboard/product/setting/business-manage/data-retransmit/list'
export const PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION = '/dashboard/frame/business/re-upload'
export const PRODUCT_BUSINESS_DATA_RETRANSMIT_MODULE_TYPE = null

const SAP_SUBMIT_URL = '/base/dataRetransmit/submit'
const SAP_LIST_URL = '/base/dataRetransmit/list'
const FINANCE_SYNC_URL = '/base/financeRetransmit/uploadAllByDateAndType'

export const PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
export const PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

export type ProductBusinessDataRetransmitSapUploadType = typeof PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES[number]
export type ProductBusinessDataRetransmitFinanceType = typeof PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES[number]
export type ProductBusinessDataRetransmitId = string | number

export type ProductBusinessDataRetransmitSapUploadForm = {
  type: ProductBusinessDataRetransmitSapUploadType | number | string
  yearMonth: string
  farm: string
}

export type ProductBusinessDataRetransmitSapQuery = {
  type?: string | number | null
  farm?: string | null
  yearMonth?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductBusinessDataRetransmitDetail = Record<string, unknown> & {
  type?: string | number | null
  total?: number | string | null
  batch?: string | null
  order?: string | null
  deathDate?: string | null
  transferDate?: string | null
}

export type ProductBusinessDataRetransmitRow = Record<string, unknown> & {
  id: ProductBusinessDataRetransmitId | null
  farmName: string | null
  yearAndMonth: string | null
  layerDeathsAndEliminateItemList?: ProductBusinessDataRetransmitDetail[]
  layerTransferList?: ProductBusinessDataRetransmitDetail[]
  transferList?: ProductBusinessDataRetransmitDetail[]
}

export type ProductBusinessDataRetransmitPage = {
  list: ProductBusinessDataRetransmitRow[]
  total: number
}

export type ProductBusinessDataRetransmitFinanceForm = {
  yearMonth: string
  farm?: string | null
}

export type ProductBusinessDataRetransmitFinanceDraft = {
  yearMonth: string
  farm?: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function monthOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function optionalMonthOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  return monthOf(value, label)
}

function textOf (value: unknown, label: string, nullable = true): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function nonEmptyTextOf (value: unknown, label: string): string {
  const text = textOf(value, label, false) as string
  if (text.trim() === '') throw new Error(`${label}不能为空`)
  return text
}

function oneOfNumberOf<T extends readonly number[]> (value: unknown, values: T, label: string): T[number] {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!values.includes(number as T[number])) throw new Error(`${label}不在页面支持的类型范围内`)
  return number as T[number]
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(number as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return number as number
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined) return object.data
  }
  return value
}

function detailListOf (value: unknown, label: string): ProductBusinessDataRetransmitDetail[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`${label}必须为数组`)
  return value.map((item, index) => ({ ...objectOf(item, `${label}[${index}]`) })) as ProductBusinessDataRetransmitDetail[]
}

function rowOf (value: unknown, index: number): ProductBusinessDataRetransmitRow {
  const source = objectOf(value, `种摊数据查询列表[${index}]`)
  const amortizationData = source.amortizationData === undefined || source.amortizationData === null ? {} : objectOf(source.amortizationData, `种摊数据查询列表[${index}].amortizationData`)
  const row: ProductBusinessDataRetransmitRow = {
    ...amortizationData,
    id: source.id === undefined || source.id === null || source.id === '' ? null : (typeof source.id === 'number' || typeof source.id === 'string' ? source.id : (() => { throw new Error(`种摊数据查询列表[${index}].id必须为字符串或数字`) })()),
    farmName: textOf(source.farmName, `种摊数据查询列表[${index}].farmName`),
    yearAndMonth: textOf(source.month, `种摊数据查询列表[${index}].month`),
  }
  const deaths = detailListOf(amortizationData.layerDeathsAndEliminateItemList, `种摊数据查询列表[${index}].layerDeathsAndEliminateItemList`)
  const layerTransfers = detailListOf(amortizationData.layerTransferList, `种摊数据查询列表[${index}].layerTransferList`)
  const transfers = detailListOf(amortizationData.transferList, `种摊数据查询列表[${index}].transferList`)
  if (deaths !== undefined) row.layerDeathsAndEliminateItemList = deaths
  if (layerTransfers !== undefined) row.layerTransferList = layerTransfers
  if (transfers !== undefined) row.transferList = transfers
  return row
}

function pageOf (value: unknown): ProductBusinessDataRetransmitPage {
  const envelope = objectOf(payloadOf(value), '种摊数据查询分页响应')
  const list = envelope.list
  const total = envelope.total ?? envelope.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('种摊数据查询分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function sapUploadDraftOf (value: unknown): ProductBusinessDataRetransmitSapUploadForm {
  const form = objectOf(value, 'SAP种摊数据重传表单')
  return {
    type: oneOfNumberOf(form.type, PRODUCT_BUSINESS_DATA_RETRANSMIT_SAP_UPLOAD_TYPES, 'SAP重传类型'),
    yearMonth: monthOf(form.yearMonth, '月份'),
    farm: nonEmptyTextOf(form.farm, '场区'),
  }
}

function sapQueryOf (query: ProductBusinessDataRetransmitSapQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    type: String(oneOfNumberOf(query.type === undefined || query.type === null || query.type === '' ? 1 : query.type, [1, 2, 3, 4, 5, 6, 7, 8, 9, 101, 102, 11, 121, 122] as const, 'SAP查询类型')),
    farm: query.farm === undefined || query.farm === null ? '' : textOf(query.farm, '场栋') as string,
    yearMonth: optionalMonthOf(query.yearMonth, '年月'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function financeDraftOf (value: unknown): ProductBusinessDataRetransmitFinanceDraft {
  const form = objectOf(value, '财务种摊数据重传表单')
  const draft: ProductBusinessDataRetransmitFinanceDraft = { yearMonth: monthOf(form.yearMonth, '摊销月份') }
  if (form.farm !== undefined && form.farm !== null && form.farm !== '') draft.farm = nonEmptyTextOf(form.farm, '场区')
  return draft
}

function financeParamsOf (draft: ProductBusinessDataRetransmitFinanceDraft, type: unknown): JsonObject {
  const params: JsonObject = { yearMonth: monthOf(draft.yearMonth, '摊销月份'), type: oneOfNumberOf(type, PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES, '财务同步类型') }
  if (draft.farm) params.farm = nonEmptyTextOf(draft.farm, '场区')
  return params
}

export function createProductBusinessDataRetransmitCapability (request: PortalRequest) {
  return {
    prepareSapUpload (form: ProductBusinessDataRetransmitSapUploadForm) { return { draft: sapUploadDraftOf(form) } },
    async submitSapUpload (input: { draft: ProductBusinessDataRetransmitSapUploadForm }): Promise<true> {
      const draft = sapUploadDraftOf(input?.draft)
      await request({ url: SAP_SUBMIT_URL, method: 'post', data: { type: draft.type, yearMonth: draft.yearMonth, farm: draft.farm } })
      return true
    },
    async listSap (query: ProductBusinessDataRetransmitSapQuery = {}): Promise<ProductBusinessDataRetransmitPage> {
      return pageOf(await request({ url: SAP_LIST_URL, method: 'get', params: sapQueryOf(query) }))
    },
    prepareFinanceSync (form: ProductBusinessDataRetransmitFinanceForm) { return { draft: financeDraftOf(form) } },
    async submitFinanceSync (input: { draft: ProductBusinessDataRetransmitFinanceDraft; type: ProductBusinessDataRetransmitFinanceType | number | string }): Promise<true> {
      const draft = financeDraftOf(input?.draft)
      await request({ url: FINANCE_SYNC_URL, method: 'get', params: financeParamsOf(draft, input?.type) })
      return true
    },
    prepareFinanceSyncAll (form: ProductBusinessDataRetransmitFinanceForm) { return { draft: financeDraftOf(form) } },
    async submitFinanceSyncAll (input: { draft: ProductBusinessDataRetransmitFinanceDraft }): Promise<ProductBusinessDataRetransmitFinanceType[]> {
      const draft = financeDraftOf(input?.draft)
      const completed: ProductBusinessDataRetransmitFinanceType[] = []
      for (const type of PRODUCT_BUSINESS_DATA_RETRANSMIT_FINANCE_TYPES) {
        await request({ url: FINANCE_SYNC_URL, method: 'get', params: financeParamsOf(draft, type) })
        completed.push(type)
      }
      return completed
    },
  }
}

export type ProductBusinessDataRetransmitCapability = ReturnType<typeof createProductBusinessDataRetransmitCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_BUSINESS_DATA_RETRANSMIT_METHODS = {
  'product-business-data-retransmit-prepare-sap-upload': 'prepareSapUpload',
  'product-business-data-retransmit-submit-sap-upload': 'submitSapUpload',
  'product-business-data-retransmit-list-sap': 'listSap',
  'product-business-data-retransmit-prepare-finance-sync': 'prepareFinanceSync',
  'product-business-data-retransmit-submit-finance-sync': 'submitFinanceSync',
  'product-business-data-retransmit-prepare-finance-sync-all': 'prepareFinanceSyncAll',
  'product-business-data-retransmit-submit-finance-sync-all': 'submitFinanceSyncAll',
} as const

const pageMeta = { pagePath: PRODUCT_BUSINESS_DATA_RETRANSMIT_PAGE_PATH, permission: PRODUCT_BUSINESS_DATA_RETRANSMIT_PERMISSION, httpInstance: 'product', moduleType: null } as const

export const productBusinessDataRetransmitCapabilities: CapabilityDefinition[] = [
  { ...pageMeta, id: 'product-business-data-retransmit-prepare-sap-upload', title: '准备SAP种摊数据重传', write: false, params: [p('form', 'text', true, '月份、场区和12种SAP重传类型的表单')] },
  { ...pageMeta, id: 'product-business-data-retransmit-submit-sap-upload', title: '执行SAP种摊数据重传', write: true, params: [p('draft', 'text', true, 'prepareSapUpload返回的草稿')] },
  { ...pageMeta, id: 'product-business-data-retransmit-list-sap', title: '查询SAP种摊数据', write: false, params: [p('type', 'enum', false, '查询类型；默认1'), p('farm', 'text', false, '场栋筛选'), p('yearMonth', 'date', false, '年月筛选'), p('pageNo', 'number', false, '页码'), p('pageSize', 'number', false, '每页条数')] },
  { ...pageMeta, id: 'product-business-data-retransmit-prepare-finance-sync', title: '准备财务种摊数据单个同步', write: false, params: [p('form', 'text', true, '摊销月份和可选场区')] },
  { ...pageMeta, id: 'product-business-data-retransmit-submit-finance-sync', title: '执行财务种摊数据单个同步', write: true, params: [p('draft', 'text', true, 'prepareFinanceSync返回的草稿'), p('type', 'enum', true, '财务同步类型1至11')] },
  { ...pageMeta, id: 'product-business-data-retransmit-prepare-finance-sync-all', title: '准备财务种摊数据全部同步', write: false, params: [p('form', 'text', true, '摊销月份和可选场区')] },
  { ...pageMeta, id: 'product-business-data-retransmit-submit-finance-sync-all', title: '执行财务种摊数据全部同步', write: true, params: [p('draft', 'text', true, 'prepareFinanceSyncAll返回的草稿')] },
]
