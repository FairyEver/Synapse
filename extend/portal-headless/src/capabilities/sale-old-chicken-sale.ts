import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 老母鸡销售（含可达的价格管控和008申请表单）。 */
export const SALE_OLD_CHICKEN_SALE_PAGE_PATH = '/dashboard/sale/setting/old-chicken-sale/list'
export const SALE_OLD_CHICKEN_SALE_FORM_PATH = '/simple/sales/form/008'
export const SALE_OLD_CHICKEN_SALE_PERMISSION = '/dashboard/sale/setting/old-chicken-sale'
export const SALE_OLD_CHICKEN_SALE_SET_PRICE_RANGE_PERMISSION = 'setting:old-chicken-sale:set-price-range'
export const SALE_OLD_CHICKEN_SALE_CREATE_APPLICATION_PERMISSION = 'setting:old-chicken-sale:create-sales-apply'
export const SALE_OLD_CHICKEN_SALE_DETAIL_PERMISSION = 'setting:old-chicken-sale:detail-sales-apply'
export const SALE_OLD_CHICKEN_SALE_MODULE_TYPE = 60

const APPLY_ROOT = '/admin-api/sales/eliminated-chicken-sales-apply'
const CUSTOMER_PAGE_URL = '/admin-api/sales/customer/page'
const ORG_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type SaleOldChickenSaleId = string | number

export type SaleOldChickenSaleQuery = {
  pageNo?: number
  pageSize?: number
  salesVariety?: string | null
  orgId?: SaleOldChickenSaleId | null
  applicantName?: string | null
  applyTimeRange?: [string, string] | [] | null
  applyTimeStart?: string | null
  applyTimeEnd?: string | null
}

export type SaleOldChickenSaleRow = Record<string, unknown> & {
  id: SaleOldChickenSaleId
  salesCustomerCompanyName: string | null
  salesCategoryName: string | null
  salesVarietyName: string | null
  salesCustomerName: string | null
  expectedSalesQuantity: number | null
  expectedSalesNum: number | null
  eliminatedAge: number | null
  maleAvgWeight: number | null
  femaleAvgWeight: number | null
  maleQuotePrice: number | null
  femaleQuotePrice: number | null
  applicantName: string | null
  applyTime: string | null
  statusName: string | null
  processInstanceId: string | null
}

export type SaleOldChickenCustomer = Record<string, unknown> & {
  id: SaleOldChickenSaleId | null
  salesCustomerCompanyId: string | null
  salesCustomerCompanyName: string | null
  farmName: string | null
  customerId: string | null
  mobilePhone: string | null
}

export type SaleOldChickenCustomerQuery = {
  pageNo?: number
  pageSize?: number
  farmName?: string
  mobilePhone?: string
}

export type SaleOldChickenControlConfig = {
  salesQuantity: number
  malePriceMin: number | null
  malePriceMax: number | null
  femalePriceMin: number | null
  femalePriceMax: number | null
  expectedSaleDateMaxRange: number
}

export type SaleOldChickenControlConfigDraft = SaleOldChickenControlConfig
export type SaleOldChickenControlConfigPreparation = { draft: SaleOldChickenControlConfigDraft }

export type SaleOldChickenAttachment = Record<string, unknown> & {
  url: string
  name: string
}

export type SaleOldChickenSaleApplicationForm = {
  applicantId: SaleOldChickenSaleId
  applicantName: string
  salesCustomerCompanyId: string
  salesCustomerCompanyName: string
  factoryId: SaleOldChickenSaleId
  salesVariety?: string | null
  salesCustomer: string
  salesCustomerName?: string | null
  expectedSalesQuantity: number
  expectedSalesNum: number
  eliminatedAge: number
  maleAvgWeight: number
  femaleAvgWeight: number
  maleQuotePrice: number
  femaleQuotePrice: number
  expectedSaleDateRange?: [string, string] | [] | null
  expectedSaleStartDate?: string
  expectedSaleEndDate?: string
  applyReason?: string | null
  attachments?: SaleOldChickenAttachment[] | null
}

export type SaleOldChickenSaleApplicationDraft = {
  applicantId: SaleOldChickenSaleId
  applicantName: string
  salesCustomerCompanyId: string
  salesCustomerCompanyName: string
  factoryId: SaleOldChickenSaleId
  salesVariety: string | null
  salesCustomer: string
  salesCustomerName: string | null
  expectedSalesQuantity: number
  expectedSalesNum: number
  eliminatedAge: number
  maleAvgWeight: number
  femaleAvgWeight: number
  maleQuotePrice: number
  femaleQuotePrice: number
  expectedSaleStartDate: string
  expectedSaleEndDate: string
  applyReason: string
  attachments: SaleOldChickenAttachment[]
}

export type SaleOldChickenSaleApplicationPreparation = { draft: SaleOldChickenSaleApplicationDraft }
export type SaleOldChickenSaleRemovePreparation = { id: SaleOldChickenSaleId }

export type SaleOldChickenSaleApplicationDetail = Record<string, unknown> & {
  id: SaleOldChickenSaleId
  applicantId: SaleOldChickenSaleId | null
  applicantName: string | null
  salesCustomerCompanyId: string | null
  salesCustomerCompanyName: string | null
  factoryId: SaleOldChickenSaleId | null
  salesVariety: string | null
  salesCustomer: string | null
  salesCustomerName: string | null
  expectedSalesQuantity: number | null
  expectedSalesNum: number | null
  expectedSaleStartDate: string | null
  expectedSaleEndDate: string | null
  eliminatedAge: number | null
  maleAvgWeight: number | null
  femaleAvgWeight: number | null
  maleQuotePrice: number | null
  femaleQuotePrice: number | null
  applyReason: string | null
  attachments: SaleOldChickenAttachment[]
  processInstanceId: string | null
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleOldChickenSaleId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须是正整数字符串或安全正整数`)
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须是YYYY-MM-DD日期`)
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function numberOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number; nullable?: boolean } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (options.nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  if (options.integer && !Number.isSafeInteger(value)) throw new Error(`${label}必须是整数`)
  if (options.min !== undefined && value < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && value > options.max) throw new Error(`${label}不能大于${options.max}`)
  return value
}

function moneyOf (value: unknown, label: string): number | null {
  const result = numberOf(value, label, { min: 0, max: 100, nullable: true })
  if (result !== null && Math.round(result * 100) !== result * 100) throw new Error(`${label}最多保留2位小数`)
  return result
}

function pageOf (value: unknown): PageResult<SaleOldChickenSaleRow> {
  const page = objectOf(value, '老母鸡销售分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('老母鸡销售分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `老母鸡销售列表[${index}]`)), total: page.total as number }
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字或null`)
  return value
}

function rowOf (value: unknown, label: string): SaleOldChickenSaleRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    salesCustomerCompanyName: nullableTextOf(row.salesCustomerCompanyName, `${label}.salesCustomerCompanyName`),
    salesCategoryName: nullableTextOf(row.salesCategoryName, `${label}.salesCategoryName`),
    salesVarietyName: nullableTextOf(row.salesVarietyName, `${label}.salesVarietyName`),
    salesCustomerName: nullableTextOf(row.salesCustomerName, `${label}.salesCustomerName`),
    expectedSalesQuantity: nullableNumberOf(row.expectedSalesQuantity, `${label}.expectedSalesQuantity`),
    expectedSalesNum: nullableNumberOf(row.expectedSalesNum, `${label}.expectedSalesNum`),
    eliminatedAge: nullableNumberOf(row.eliminatedAge, `${label}.eliminatedAge`),
    maleAvgWeight: nullableNumberOf(row.maleAvgWeight, `${label}.maleAvgWeight`),
    femaleAvgWeight: nullableNumberOf(row.femaleAvgWeight, `${label}.femaleAvgWeight`),
    maleQuotePrice: nullableNumberOf(row.maleQuotePrice, `${label}.maleQuotePrice`),
    femaleQuotePrice: nullableNumberOf(row.femaleQuotePrice, `${label}.femaleQuotePrice`),
    applicantName: nullableTextOf(row.applicantName, `${label}.applicantName`),
    applyTime: nullableTextOf(row.applyTime, `${label}.applyTime`),
    statusName: nullableTextOf(row.statusName, `${label}.statusName`),
    processInstanceId: nullableTextOf(row.processInstanceId, `${label}.processInstanceId`),
  }
}

function customerPageOf (value: unknown): PageResult<SaleOldChickenCustomer> {
  const page = objectOf(value, '销售客户分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('销售客户分页响应缺少有效list或total')
  return {
    list: page.list.map((item, index) => {
      const row = objectOf(item, `销售客户候选[${index}]`)
      return {
        ...row,
        id: row.id === undefined || row.id === null ? null : idOf(row.id, `销售客户候选[${index}].id`),
        salesCustomerCompanyId: nullableTextOf(row.salesCustomerCompanyId, `销售客户候选[${index}].salesCustomerCompanyId`),
        salesCustomerCompanyName: nullableTextOf(row.salesCustomerCompanyName, `销售客户候选[${index}].salesCustomerCompanyName`),
        farmName: nullableTextOf(row.farmName, `销售客户候选[${index}].farmName`),
        customerId: nullableTextOf(row.customerId, `销售客户候选[${index}].customerId`),
        mobilePhone: nullableTextOf(row.mobilePhone, `销售客户候选[${index}].mobilePhone`),
      }
    }),
    total: page.total as number,
  }
}

function attachmentOf (value: unknown, label: string): SaleOldChickenAttachment {
  const attachment = objectOf(value, label)
  return {
    ...attachment,
    url: requiredTextOf(attachment.url, `${label}.url`),
    name: requiredTextOf(attachment.name, `${label}.name`),
  }
}

function attachmentsOf (value: unknown): SaleOldChickenAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('attachments必须是数组或null')
  return value.map((item, index) => attachmentOf(item, `attachments[${index}]`))
}

function controlConfigOf (value: unknown): SaleOldChickenControlConfig {
  const config = objectOf(value, '老母鸡价格管控配置')
  return {
    salesQuantity: numberOf(config.salesQuantity, 'salesQuantity', { integer: true, min: 0, max: 99999 }) as number,
    malePriceMin: moneyOf(config.malePriceMin, 'malePriceMin'),
    malePriceMax: moneyOf(config.malePriceMax, 'malePriceMax'),
    femalePriceMin: moneyOf(config.femalePriceMin, 'femalePriceMin'),
    femalePriceMax: moneyOf(config.femalePriceMax, 'femalePriceMax'),
    expectedSaleDateMaxRange: numberOf(config.expectedSaleDateMaxRange, 'expectedSaleDateMaxRange', { integer: true, min: 1 }) as number,
  }
}

function controlConfigDraftOf (input: unknown): SaleOldChickenControlConfigDraft {
  const config = controlConfigOf(input)
  for (const [label, value] of Object.entries({ malePriceMin: config.malePriceMin, malePriceMax: config.malePriceMax, femalePriceMin: config.femalePriceMin, femalePriceMax: config.femalePriceMax })) {
    if (value === 0) throw new Error(`${label}必须为空或不小于0.01`)
  }
  if (config.malePriceMin !== null && config.malePriceMax !== null && config.malePriceMax < config.malePriceMin) throw new Error('malePriceMax不能小于malePriceMin')
  if (config.femalePriceMin !== null && config.femalePriceMax !== null && config.femalePriceMax < config.femalePriceMin) throw new Error('femalePriceMax不能小于femalePriceMin')
  return config
}

function applicationDraftOf (input: unknown): SaleOldChickenSaleApplicationDraft {
  const form = objectOf(input, '老母鸡销售申请表单')
  const expectedSaleDateRange = form.expectedSaleDateRange
  const start = form.expectedSaleStartDate ?? (Array.isArray(expectedSaleDateRange) ? expectedSaleDateRange[0] : undefined)
  const end = form.expectedSaleEndDate ?? (Array.isArray(expectedSaleDateRange) ? expectedSaleDateRange[1] : undefined)
  const expectedSaleStartDate = dateOf(start, 'expectedSaleStartDate')
  const expectedSaleEndDate = dateOf(end, 'expectedSaleEndDate')
  if (expectedSaleEndDate < expectedSaleStartDate) throw new Error('expectedSaleEndDate不能早于expectedSaleStartDate')

  const applicantId = idOf(form.applicantId, 'applicantId')
  const applicantName = requiredTextOf(form.applicantName, 'applicantName')
  const salesCustomerCompanyId = requiredTextOf(form.salesCustomerCompanyId, 'salesCustomerCompanyId')
  const salesCustomerCompanyName = requiredTextOf(form.salesCustomerCompanyName, 'salesCustomerCompanyName')
  const factoryId = idOf(form.factoryId, 'factoryId')
  const salesCustomer = requiredTextOf(form.salesCustomer, 'salesCustomer')
  const expectedSalesQuantity = numberOf(form.expectedSalesQuantity, 'expectedSalesQuantity', { integer: true, min: 1 }) as number
  const expectedSalesNum = numberOf(form.expectedSalesNum, 'expectedSalesNum', { integer: true, min: 1 }) as number
  const eliminatedAge = numberOf(form.eliminatedAge, 'eliminatedAge', { integer: true, min: 1 }) as number
  const maleAvgWeight = numberOf(form.maleAvgWeight, 'maleAvgWeight', { min: 1 }) as number
  const femaleAvgWeight = numberOf(form.femaleAvgWeight, 'femaleAvgWeight', { min: 1 }) as number
  const maleQuotePrice = numberOf(form.maleQuotePrice, 'maleQuotePrice', { min: 1 }) as number
  const femaleQuotePrice = numberOf(form.femaleQuotePrice, 'femaleQuotePrice', { min: 1 }) as number
  for (const [label, value] of Object.entries({ maleAvgWeight, femaleAvgWeight, maleQuotePrice, femaleQuotePrice })) {
    if (Math.round(value * 100) !== value * 100) throw new Error(`${label}最多保留2位小数`)
  }
  const applyReason = form.applyReason === undefined || form.applyReason === null || form.applyReason === '' ? '' : requiredTextOf(form.applyReason, 'applyReason')
  if (applyReason.length > 200) throw new Error('applyReason长度不能超过200')
  return {
    applicantId,
    applicantName,
    salesCustomerCompanyId,
    salesCustomerCompanyName,
    factoryId,
    salesVariety: nullableTextOf(form.salesVariety, 'salesVariety'),
    salesCustomer,
    salesCustomerName: nullableTextOf(form.salesCustomerName, 'salesCustomerName'),
    expectedSalesQuantity,
    expectedSalesNum,
    eliminatedAge,
    maleAvgWeight,
    femaleAvgWeight,
    maleQuotePrice,
    femaleQuotePrice,
    expectedSaleStartDate,
    expectedSaleEndDate,
    applyReason,
    attachments: attachmentsOf(form.attachments),
  }
}

function removePreparationOf (input: unknown): SaleOldChickenSaleRemovePreparation {
  const value = objectOf(input, '老母鸡销售申请删除操作')
  return { id: idOf(value.id, '老母鸡销售申请ID') }
}

function applicationDetailOf (value: unknown): SaleOldChickenSaleApplicationDetail {
  const detail = objectOf(value, '老母鸡销售申请详情')
  return {
    ...detail,
    id: idOf(detail.id, '老母鸡销售申请详情.id'),
    applicantId: detail.applicantId === undefined || detail.applicantId === null ? null : idOf(detail.applicantId, '老母鸡销售申请详情.applicantId'),
    applicantName: nullableTextOf(detail.applicantName, '老母鸡销售申请详情.applicantName'),
    salesCustomerCompanyId: nullableTextOf(detail.salesCustomerCompanyId, '老母鸡销售申请详情.salesCustomerCompanyId'),
    salesCustomerCompanyName: nullableTextOf(detail.salesCustomerCompanyName, '老母鸡销售申请详情.salesCustomerCompanyName'),
    factoryId: detail.factoryId === undefined || detail.factoryId === null ? null : idOf(detail.factoryId, '老母鸡销售申请详情.factoryId'),
    salesVariety: nullableTextOf(detail.salesVariety, '老母鸡销售申请详情.salesVariety'),
    salesCustomer: nullableTextOf(detail.salesCustomer, '老母鸡销售申请详情.salesCustomer'),
    salesCustomerName: nullableTextOf(detail.salesCustomerName, '老母鸡销售申请详情.salesCustomerName'),
    expectedSalesQuantity: nullableNumberOf(detail.expectedSalesQuantity, '老母鸡销售申请详情.expectedSalesQuantity'),
    expectedSalesNum: nullableNumberOf(detail.expectedSalesNum, '老母鸡销售申请详情.expectedSalesNum'),
    expectedSaleStartDate: nullableTextOf(detail.expectedSaleStartDate, '老母鸡销售申请详情.expectedSaleStartDate'),
    expectedSaleEndDate: nullableTextOf(detail.expectedSaleEndDate, '老母鸡销售申请详情.expectedSaleEndDate'),
    eliminatedAge: nullableNumberOf(detail.eliminatedAge, '老母鸡销售申请详情.eliminatedAge'),
    maleAvgWeight: nullableNumberOf(detail.maleAvgWeight, '老母鸡销售申请详情.maleAvgWeight'),
    femaleAvgWeight: nullableNumberOf(detail.femaleAvgWeight, '老母鸡销售申请详情.femaleAvgWeight'),
    maleQuotePrice: nullableNumberOf(detail.maleQuotePrice, '老母鸡销售申请详情.maleQuotePrice'),
    femaleQuotePrice: nullableNumberOf(detail.femaleQuotePrice, '老母鸡销售申请详情.femaleQuotePrice'),
    applyReason: nullableTextOf(detail.applyReason, '老母鸡销售申请详情.applyReason'),
    attachments: attachmentsOf(detail.attachments),
    processInstanceId: nullableTextOf(detail.processInstanceId, '老母鸡销售申请详情.processInstanceId'),
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request is bound to SALE_OLD_CHICKEN_SALE_PAGE_PATH. */
export function createSaleOldChickenSaleCapability (request: PortalRequest) {
  return {
    async list (query: SaleOldChickenSaleQuery = {}): Promise<PageResult<SaleOldChickenSaleRow>> {
      const applyTimeRange = query.applyTimeRange
      const params: Record<string, unknown> = {
        order: '',
        orderField: '',
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        salesVariety: nullableTextOf(query.salesVariety, 'salesVariety'),
        orgId: query.orgId === undefined || query.orgId === null ? null : idOf(query.orgId, 'orgId'),
        applicantName: nullableTextOf(query.applicantName, 'applicantName'),
      }
      if (Array.isArray(applyTimeRange) && applyTimeRange.length === 2) {
        params.applyTimeStart = dateOf(applyTimeRange[0], 'applyTimeStart')
        params.applyTimeEnd = dateOf(applyTimeRange[1], 'applyTimeEnd')
        if ((params.applyTimeEnd as string) < (params.applyTimeStart as string)) throw new Error('applyTimeEnd不能早于applyTimeStart')
      } else {
        if (query.applyTimeStart !== undefined && query.applyTimeStart !== null && query.applyTimeStart !== '') params.applyTimeStart = dateOf(query.applyTimeStart, 'applyTimeStart')
        if (query.applyTimeEnd !== undefined && query.applyTimeEnd !== null && query.applyTimeEnd !== '') params.applyTimeEnd = dateOf(query.applyTimeEnd, 'applyTimeEnd')
        if (typeof params.applyTimeStart === 'string' && typeof params.applyTimeEnd === 'string' && params.applyTimeEnd < params.applyTimeStart) throw new Error('applyTimeEnd不能早于applyTimeStart')
      }
      return pageOf(await request({ url: `${APPLY_ROOT}/page`, method: 'get', params }))
    },

    async customerSearch (query: SaleOldChickenCustomerQuery = {}): Promise<PageResult<SaleOldChickenCustomer>> {
      const farmName = query.farmName === undefined ? '' : requiredTextOf(query.farmName, 'farmName')
      const mobilePhone = query.mobilePhone === undefined ? '' : requiredTextOf(query.mobilePhone, 'mobilePhone')
      if (farmName === '' && mobilePhone === '') throw new Error('销售客户查询至少需要farmName或mobilePhone关键字')
      const params: Record<string, unknown> = {
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
      }
      if (farmName !== '') params.farmName = farmName
      if (mobilePhone !== '') params.mobilePhone = mobilePhone
      return customerPageOf(await request({ url: CUSTOMER_PAGE_URL, method: 'get', params, moduleType: SALE_OLD_CHICKEN_SALE_MODULE_TYPE }))
    },

    async organizationTree (): Promise<unknown[]> {
      const result = await request<unknown>({ url: ORG_TREE_URL, method: 'get', params: {} })
      if (!Array.isArray(result)) throw new Error('老母鸡销售管控工厂组织树响应必须是数组')
      return result
    },

    async getControlConfig (): Promise<SaleOldChickenControlConfig> {
      return controlConfigOf(await request({ url: `${APPLY_ROOT}/control-config/get`, method: 'get' }))
    },

    prepareControlConfig (input: { form: Partial<SaleOldChickenControlConfig> }): SaleOldChickenControlConfigPreparation {
      return { draft: controlConfigDraftOf(input?.form) }
    },

    async saveControlConfig (input: SaleOldChickenControlConfigPreparation): Promise<true> {
      return trueResult(await request({ url: `${APPLY_ROOT}/control-config/save`, method: 'post', data: controlConfigDraftOf(input?.draft) }), '保存老母鸡价格管控配置')
    },

    async get (input: { id: SaleOldChickenSaleId }): Promise<SaleOldChickenSaleApplicationDetail> {
      const id = idOf(input?.id, '老母鸡销售申请ID')
      return applicationDetailOf(await request({ url: `${APPLY_ROOT}/get`, method: 'get', params: { id } }))
    },

    prepareCreate (input: { form: SaleOldChickenSaleApplicationForm }): SaleOldChickenSaleApplicationPreparation {
      return { draft: applicationDraftOf(input?.form) }
    },

    async create (input: SaleOldChickenSaleApplicationPreparation): Promise<SaleOldChickenSaleId> {
      const result = await request({ url: `${APPLY_ROOT}/create`, method: 'post', data: applicationDraftOf(input?.draft) })
      return idOf(result, '创建老母鸡销售申请返回ID')
    },

    prepareRemove (input: { id: SaleOldChickenSaleId }): SaleOldChickenSaleRemovePreparation {
      return removePreparationOf(input)
    },

    async remove (input: SaleOldChickenSaleRemovePreparation): Promise<true> {
      const draft = removePreparationOf(input)
      return trueResult(await request({ url: `${APPLY_ROOT}/delete`, method: 'delete', params: { id: draft.id } }), '删除老母鸡销售申请')
    },
  }
}

export type SaleOldChickenSaleCapability = ReturnType<typeof createSaleOldChickenSaleCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal老母鸡销售申请表单；支持PC页expectedSaleDateRange或已转换的起止日期')
const draftParam = p('draft', 'text', true, 'prepareCreate返回的老母鸡销售申请提交草稿')
const configFormParam = p('form', 'text', true, 'Portal设置价格区间页面表单')
const configDraftParam = p('draft', 'text', true, 'prepareControlConfig返回的价格管控提交草稿')

export const SALE_OLD_CHICKEN_SALE_METHODS = {
  'sale-old-chicken-sale-list': 'list',
  'sale-old-chicken-sale-customer-search': 'customerSearch',
  'sale-old-chicken-sale-organization-tree': 'organizationTree',
  'sale-old-chicken-sale-get-control-config': 'getControlConfig',
  'sale-old-chicken-sale-prepare-control-config': 'prepareControlConfig',
  'sale-old-chicken-sale-save-control-config': 'saveControlConfig',
  'sale-old-chicken-sale-get': 'get',
  'sale-old-chicken-sale-prepare-create': 'prepareCreate',
  'sale-old-chicken-sale-create': 'create',
  'sale-old-chicken-sale-prepare-remove': 'prepareRemove',
  'sale-old-chicken-sale-remove': 'remove',
} as const

export const saleOldChickenSaleCapabilities: CapabilityDefinition[] = [
  { id: 'sale-old-chicken-sale-list', title: '查询老母鸡销售申请列表', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number'), p('salesVariety', 'enum'), p('orgId', 'tree'), p('applicantName', 'text'), p('applyTimeRange', 'date')] },
  { id: 'sale-old-chicken-sale-customer-search', title: '搜索老母鸡销售客户候选', write: false, params: [p('farmName', 'search', false, '客户农场名关键字；与mobilePhone至少提供一个'), p('mobilePhone', 'search', false, '客户手机号关键字；与farmName至少提供一个'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-old-chicken-sale-organization-tree', title: '查询老母鸡销售管控工厂组织树', write: false, params: [] },
  { id: 'sale-old-chicken-sale-get-control-config', title: '查询老母鸡销售价格管控配置', write: false, params: [] },
  { id: 'sale-old-chicken-sale-prepare-control-config', title: '准备老母鸡销售价格管控配置', write: false, params: [configFormParam] },
  { id: 'sale-old-chicken-sale-save-control-config', title: '保存老母鸡销售价格管控配置', write: true, params: [configDraftParam] },
  { id: 'sale-old-chicken-sale-get', title: '查询老母鸡销售申请详情', write: false, params: [p('id', 'text', true, '当前申请ID；列表行id或流程业务key')] },
  { id: 'sale-old-chicken-sale-prepare-create', title: '准备老母鸡销售申请', write: false, params: [formParam] },
  { id: 'sale-old-chicken-sale-create', title: '提交老母鸡销售申请', write: true, params: [draftParam] },
  { id: 'sale-old-chicken-sale-prepare-remove', title: '准备删除老母鸡销售申请', write: false, params: [p('id', 'text', true, '当前申请ID')] },
  { id: 'sale-old-chicken-sale-remove', title: '删除老母鸡销售申请', write: true, params: [p('id', 'text', true, '当前申请ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_OLD_CHICKEN_SALE_PAGE_PATH,
  permission: SALE_OLD_CHICKEN_SALE_PERMISSION,
  moduleType: SALE_OLD_CHICKEN_SALE_MODULE_TYPE,
  httpInstance: 'platform',
}))
