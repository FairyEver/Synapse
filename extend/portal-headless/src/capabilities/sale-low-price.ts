import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 价格管控 → 低价设置。 */
export const SALE_LOW_PRICE_PAGE_PATH = '/dashboard/sale/setting/price-control/low-price/list'
export const SALE_LOW_PRICE_PERMISSION = '/dashboard/sale/setting/price-control/low-price'
export const SALE_LOW_PRICE_CREATE_PERMISSION = 'setting:price-control:low-price:create'
export const SALE_LOW_PRICE_EDIT_PERMISSION = 'setting:price-control:low-price:edit'
export const SALE_LOW_PRICE_DELETE_PERMISSION = 'setting:price-control:low-price:delete'
export const SALE_LOW_PRICE_MODULE_TYPE = 60

const ROOT = 'admin-api/priceControlStandardConfig'
const CATEGORY_OPTIONS_URL = `${ROOT}/categoryOptions`
const PAGE_URL = `${ROOT}/page`
const CATEGORY_TREE_URL = `${ROOT}/skuTree/categories`
const SKU_TREE_URL = `${ROOT}/skuTree/skus`
const GET_URL = `${ROOT}/get`
const CREATE_URL = `${ROOT}/create`
const UPDATE_URL = `${ROOT}/update`
const DELETE_URL = `${ROOT}/delete`

const LOWER_OPERATORS = ['>', '>=', '='] as const
const UPPER_OPERATORS = ['<', '<='] as const
const ALL_OPERATORS = ['>', '<', '=', '>=', '<='] as const

export type SaleLowPriceId = string | number
export type SaleLowPriceDateRange = [string, string] | [] | null

export type SaleLowPriceCategoryOption = Record<string, unknown> & {
  parentCategoryId: number | null
  parentCategoryName: string | null
  categoryId: number
  categoryName: string
  categoryFullName: string | null
}

export type SaleLowPriceCategoryNode = Record<string, unknown> & {
  parentCategoryId: number | null
  categoryId: number
  categoryName: string
  disabled: boolean
}

export type SaleLowPriceSkuOption = Record<string, unknown> & {
  nodeType?: string | null
  parentCategoryId: number | null
  categoryId: number
  itemId: number
  itemName: string | null
  skuId: number
  specInfo: string | null
  disabled: boolean
}

export type SaleLowPriceSku = Record<string, unknown> & {
  id?: SaleLowPriceId | null
  itemId: number
  skuId: number
  itemName: string | null
  specInfo: string | null
}

export type SaleLowPriceRule = Record<string, unknown> & {
  id?: SaleLowPriceId | null
  sortNo: number | null
  qtyLowerOp: string | null
  qtyLowerValue: number | null
  qtyUpperOp: string | null
  qtyUpperValue: number | null
  priceLowerOp: string | null
  priceLowerValue: number | null
  priceUpperOp: string | null
  priceUpperValue: number | null
  approvalTag: string | null
}

export type SaleLowPriceRuleDraft = Omit<SaleLowPriceRule, 'sortNo'>

export type SaleLowPriceConfig = Record<string, unknown> & {
  id: SaleLowPriceId
  parentCategoryId: number | null
  parentCategoryName: string | null
  categoryId: number | null
  categoryName: string | null
  categoryFullName: string | null
  skuSpecsText: string | null
  skus: SaleLowPriceSku[]
  rules: SaleLowPriceRule[]
  updaterId: SaleLowPriceId | null
  updaterName: string | null
  updateTime: string | null
  createTime: string | null
}

export type SaleLowPriceListQuery = {
  order?: string | null
  orderField?: string | null
  pageNo?: number
  pageSize?: number
  categoryId?: number | null
  operatorKeyword?: string | null
  updateTimeRange?: SaleLowPriceDateRange
  updateTimeStart?: string | null
  updateTimeEnd?: string | null
}

export type SaleLowPriceSkuInput = {
  id?: SaleLowPriceId | null
  itemId: number
  skuId: number
  itemName?: string | null
  specInfo?: string | null
}

export type SaleLowPriceRuleInput = {
  id?: SaleLowPriceId | null
  sortNo?: number | null
  /** Portal表单为每个标准块生成的本地行键，不会提交给后端。 */
  uid?: string | null
  qtyLowerOp?: string | null
  qtyLowerValue?: number | null
  qtyUpperOp?: string | null
  qtyUpperValue?: number | null
  priceLowerOp?: string | null
  priceLowerValue?: number | null
  priceUpperOp?: string | null
  priceUpperValue?: number | null
  approvalTag?: string | null
}

export type SaleLowPriceConfigForm = {
  id?: SaleLowPriceId | null
  parentCategoryId?: number | null
  /** Portal表单字段名；SDK同时接受规范字段categoryId。 */
  controlCategoryId?: number | null
  categoryId?: number | null
  /** 必须来自skuTreeSkus返回的当前可选规格，SDK据此生成itemId/itemName/skuId/specInfo。 */
  skus: SaleLowPriceSkuInput[]
  standards: SaleLowPriceRuleInput[]
}

export type SaleLowPriceConfigDraft = {
  id?: SaleLowPriceId
  parentCategoryId: number
  categoryId: number
  skus: SaleLowPriceSku[]
  rules: SaleLowPriceRuleDraft[]
}

export type SaleLowPriceConfigPreparation = { draft: SaleLowPriceConfigDraft }
export type SaleLowPriceRemovePreparation = { id: SaleLowPriceId }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleLowPriceId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function optionalIdOf (value: unknown, label: string): SaleLowPriceId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function integerOf (value: unknown, label: string, options: { nullable?: boolean; min?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (options.nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须是整数`)
  if (options.min !== undefined && value < options.min) throw new Error(`${label}不能小于${options.min}`)
  return value
}

function numberOf (value: unknown, label: string, options: { nullable?: boolean; min?: number; decimals?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (options.nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  if (options.min !== undefined && value < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.decimals !== undefined && Math.round(value * (10 ** options.decimals)) !== value * (10 ** options.decimals)) {
    throw new Error(`${label}最多保留${options.decimals}位小数`)
  }
  return value
}

function responseNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(result)) throw new Error(`${label}必须是数字或null`)
  return result
}

function optionalTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
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

function dateRangeOf (value: unknown, label: string): { start: string; end: string } | null {
  if (value === undefined || value === null || value === '') return null
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是两个日期组成的范围`)
  const start = dateOf(value[0], `${label}[0]`)
  const end = dateOf(value[1], `${label}[1]`)
  if (end < start) throw new Error(`${label}结束日期不能早于开始日期`)
  return { start, end }
}

function operatorOf (value: unknown, label: string, allowed: readonly string[], nullable = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label}取值不在Portal支持范围内`)
  return value
}

function categoryIdOf (value: unknown, label: string, nullable = true): number | null {
  return integerOf(value, label, { nullable, min: 1 })
}

function pageOf<T> (value: unknown, label: string, rowOf: (value: unknown, label: string) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: page.total as number }
}

function categoryOptionOf (value: unknown, label: string): SaleLowPriceCategoryOption {
  const item = objectOf(value, label)
  return {
    ...item,
    parentCategoryId: categoryIdOf(item.parentCategoryId, `${label}.parentCategoryId`),
    parentCategoryName: optionalTextOf(item.parentCategoryName, `${label}.parentCategoryName`),
    categoryId: categoryIdOf(item.categoryId, `${label}.categoryId`, false) as number,
    categoryName: requiredTextOf(item.categoryName, `${label}.categoryName`),
    categoryFullName: optionalTextOf(item.categoryFullName, `${label}.categoryFullName`),
  }
}

function categoryNodeOf (value: unknown, label: string): SaleLowPriceCategoryNode {
  const item = objectOf(value, label)
  if (typeof item.disabled !== 'boolean') throw new Error(`${label}.disabled必须是boolean`)
  return {
    ...item,
    parentCategoryId: categoryIdOf(item.parentCategoryId, `${label}.parentCategoryId`),
    categoryId: categoryIdOf(item.categoryId, `${label}.categoryId`, false) as number,
    categoryName: requiredTextOf(item.categoryName, `${label}.categoryName`),
    disabled: item.disabled,
  }
}

function skuOptionOf (value: unknown, label: string): SaleLowPriceSkuOption {
  const item = objectOf(value, label)
  if (typeof item.disabled !== 'boolean') throw new Error(`${label}.disabled必须是boolean`)
  return {
    ...item,
    ...(item.nodeType === undefined ? {} : { nodeType: optionalTextOf(item.nodeType, `${label}.nodeType`) }),
    parentCategoryId: categoryIdOf(item.parentCategoryId, `${label}.parentCategoryId`),
    categoryId: categoryIdOf(item.categoryId, `${label}.categoryId`, false) as number,
    itemId: categoryIdOf(item.itemId, `${label}.itemId`, false) as number,
    itemName: optionalTextOf(item.itemName, `${label}.itemName`),
    skuId: categoryIdOf(item.skuId, `${label}.skuId`, false) as number,
    specInfo: optionalTextOf(item.specInfo, `${label}.specInfo`),
    disabled: item.disabled,
  }
}

function skuOf (value: unknown, label: string): SaleLowPriceSku {
  const item = objectOf(value, label)
  const id = item.id === undefined ? undefined : optionalIdOf(item.id, `${label}.id`)
  return {
    ...item,
    ...(id === undefined ? {} : { id }),
    itemId: categoryIdOf(item.itemId, `${label}.itemId`, false) as number,
    skuId: categoryIdOf(item.skuId, `${label}.skuId`, false) as number,
    itemName: optionalTextOf(item.itemName, `${label}.itemName`),
    specInfo: optionalTextOf(item.specInfo, `${label}.specInfo`),
  }
}

function ruleOf (value: unknown, label: string): SaleLowPriceRule {
  const item = objectOf(value, label)
  const id = item.id === undefined ? undefined : optionalIdOf(item.id, `${label}.id`)
  return {
    ...item,
    ...(id === undefined ? {} : { id }),
    sortNo: integerOf(item.sortNo, `${label}.sortNo`, { nullable: true, min: 1 }),
    qtyLowerOp: operatorOf(item.qtyLowerOp, `${label}.qtyLowerOp`, ALL_OPERATORS),
    qtyLowerValue: responseNumberOf(item.qtyLowerValue, `${label}.qtyLowerValue`),
    qtyUpperOp: operatorOf(item.qtyUpperOp, `${label}.qtyUpperOp`, ALL_OPERATORS),
    qtyUpperValue: responseNumberOf(item.qtyUpperValue, `${label}.qtyUpperValue`),
    priceLowerOp: operatorOf(item.priceLowerOp, `${label}.priceLowerOp`, ALL_OPERATORS),
    priceLowerValue: responseNumberOf(item.priceLowerValue, `${label}.priceLowerValue`),
    priceUpperOp: operatorOf(item.priceUpperOp, `${label}.priceUpperOp`, ALL_OPERATORS),
    priceUpperValue: responseNumberOf(item.priceUpperValue, `${label}.priceUpperValue`),
    approvalTag: optionalTextOf(item.approvalTag, `${label}.approvalTag`),
  }
}

function configOf (value: unknown, label: string): SaleLowPriceConfig {
  const item = objectOf(value, label)
  return {
    ...item,
    id: idOf(item.id, `${label}.id`),
    parentCategoryId: categoryIdOf(item.parentCategoryId, `${label}.parentCategoryId`),
    parentCategoryName: optionalTextOf(item.parentCategoryName, `${label}.parentCategoryName`),
    categoryId: categoryIdOf(item.categoryId, `${label}.categoryId`),
    categoryName: optionalTextOf(item.categoryName, `${label}.categoryName`),
    categoryFullName: optionalTextOf(item.categoryFullName, `${label}.categoryFullName`),
    skuSpecsText: optionalTextOf(item.skuSpecsText, `${label}.skuSpecsText`),
    skus: Array.isArray(item.skus) ? item.skus.map((sku, index) => skuOf(sku, `${label}.skus[${index}]`)) : [],
    rules: Array.isArray(item.rules) ? item.rules.map((rule, index) => ruleOf(rule, `${label}.rules[${index}]`)) : [],
    updaterId: optionalIdOf(item.updaterId, `${label}.updaterId`),
    updaterName: optionalTextOf(item.updaterName, `${label}.updaterName`),
    updateTime: optionalTextOf(item.updateTime, `${label}.updateTime`),
    createTime: optionalTextOf(item.createTime, `${label}.createTime`),
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function localDateRangeParamOf (query: SaleLowPriceListQuery): { start?: string; end?: string } {
  const range = dateRangeOf(query.updateTimeRange, 'updateTimeRange')
  if (range) return { start: range.start, end: range.end }
  const start = query.updateTimeStart === undefined || query.updateTimeStart === null || query.updateTimeStart === ''
    ? undefined
    : dateOf(query.updateTimeStart, 'updateTimeStart')
  const end = query.updateTimeEnd === undefined || query.updateTimeEnd === null || query.updateTimeEnd === ''
    ? undefined
    : dateOf(query.updateTimeEnd, 'updateTimeEnd')
  if (start && end && end < start) throw new Error('updateTimeEnd不能早于updateTimeStart')
  return { start, end }
}

function validatePair (operator: string | null, value: number | null, label: string): void {
  if ((operator === null) !== (value === null)) throw new Error(`${label}的条件与数值须同时录入`)
}

function ruleDraftOf (value: unknown, label: string, mode: 'create' | 'update'): SaleLowPriceRuleDraft {
  const item = objectOf(value, label)
  const id = item.id === undefined || item.id === null || item.id === '' ? undefined : idOf(item.id, `${label}.id`)
  if (mode === 'create' && id !== undefined) throw new Error(`${label}.id不能出现在新增草稿`)
  const qtyLowerOp = operatorOf(item.qtyLowerOp, `${label}.qtyLowerOp`, LOWER_OPERATORS)
  const qtyLowerValue = numberOf(item.qtyLowerValue, `${label}.qtyLowerValue`, { nullable: true, min: 0 })
  const qtyUpperOp = operatorOf(item.qtyUpperOp, `${label}.qtyUpperOp`, UPPER_OPERATORS)
  const qtyUpperValue = numberOf(item.qtyUpperValue, `${label}.qtyUpperValue`, { nullable: true, min: 0 })
  const priceLowerOp = operatorOf(item.priceLowerOp, `${label}.priceLowerOp`, LOWER_OPERATORS)
  const priceLowerValue = numberOf(item.priceLowerValue, `${label}.priceLowerValue`, { nullable: true, min: 0, decimals: 2 })
  const priceUpperOp = operatorOf(item.priceUpperOp, `${label}.priceUpperOp`, UPPER_OPERATORS)
  const priceUpperValue = numberOf(item.priceUpperValue, `${label}.priceUpperValue`, { nullable: true, min: 0, decimals: 2 })

  const normalizedQtyUpperOp = qtyLowerOp === '=' ? null : qtyUpperOp
  const normalizedQtyUpperValue = qtyLowerOp === '=' ? null : qtyUpperValue
  const normalizedPriceUpperOp = priceLowerOp === '=' ? null : priceUpperOp
  const normalizedPriceUpperValue = priceLowerOp === '=' ? null : priceUpperValue
  validatePair(qtyLowerOp, qtyLowerValue, `${label}.qtyLower`)
  validatePair(normalizedQtyUpperOp, normalizedQtyUpperValue, `${label}.qtyUpper`)
  validatePair(priceLowerOp, priceLowerValue, `${label}.priceLower`)
  validatePair(normalizedPriceUpperOp, normalizedPriceUpperValue, `${label}.priceUpper`)
  if (priceLowerValue === null && normalizedPriceUpperValue === null) throw new Error(`${label}的低于指导价须至少录入一侧`)
  if (qtyLowerValue !== null && normalizedQtyUpperValue !== null && qtyLowerValue > normalizedQtyUpperValue) throw new Error(`${label}的管控数量下限数值不能大于上限数值`)
  if (priceLowerValue !== null && normalizedPriceUpperValue !== null && priceLowerValue > normalizedPriceUpperValue) throw new Error(`${label}的低于指导价下限数值不能大于上限数值`)

  return {
    ...(id === undefined ? {} : { id }),
    qtyLowerOp,
    qtyLowerValue,
    qtyUpperOp: normalizedQtyUpperOp,
    qtyUpperValue: normalizedQtyUpperValue,
    priceLowerOp,
    priceLowerValue,
    priceUpperOp: normalizedPriceUpperOp,
    priceUpperValue: normalizedPriceUpperValue,
    approvalTag: optionalTextOf(item.approvalTag, `${label}.approvalTag`),
  }
}

function skuDraftOf (value: unknown, label: string): SaleLowPriceSku {
  const item = objectOf(value, label)
  const id = item.id === undefined || item.id === null || item.id === '' ? undefined : idOf(item.id, `${label}.id`)
  return {
    ...(id === undefined ? {} : { id }),
    itemId: categoryIdOf(item.itemId, `${label}.itemId`, false) as number,
    skuId: categoryIdOf(item.skuId, `${label}.skuId`, false) as number,
    itemName: optionalTextOf(item.itemName, `${label}.itemName`),
    specInfo: optionalTextOf(item.specInfo, `${label}.specInfo`),
  }
}

function configDraftOf (value: unknown, mode: 'create' | 'update'): SaleLowPriceConfigDraft {
  const form = objectOf(value, mode === 'create' ? '低价管控标准新增表单' : '低价管控标准编辑表单')
  const id = form.id === undefined || form.id === null || form.id === '' ? undefined : idOf(form.id, '低价管控标准配置ID')
  if (mode === 'update' && id === undefined) throw new Error('编辑低价管控标准必须提供id')
  if (mode === 'create' && id !== undefined) throw new Error('新增低价管控标准不能提供id')
  const parentCategoryId = categoryIdOf(form.parentCategoryId, 'parentCategoryId', false) as number
  const categoryId = categoryIdOf(form.categoryId ?? form.controlCategoryId, 'categoryId', false) as number
  if (!Array.isArray(form.skus) || form.skus.length < 1) throw new Error('管控商品不能为空；请传入skuTreeSkus返回的skus')
  const skus = form.skus.map((sku, index) => skuDraftOf(sku, `skus[${index}]`))
  const skuIds = skus.map(sku => sku.skuId)
  if (new Set(skuIds).size !== skuIds.length) throw new Error('管控商品列表中存在重复的规格')
  const rawRules = form.standards ?? form.rules
  if (!Array.isArray(rawRules) || rawRules.length < 1) throw new Error('管控标准不能为空')
  const rules = rawRules.map((rule, index) => ruleDraftOf(rule, `standards[${index}]`, mode))
  return {
    ...(id === undefined ? {} : { id }),
    parentCategoryId,
    categoryId,
    skus,
    rules,
  }
}

/** The injected request is bound to SALE_LOW_PRICE_PAGE_PATH. */
export function createSaleLowPriceCapability (request: PortalRequest) {
  return {
    async categoryOptions (): Promise<SaleLowPriceCategoryOption[]> {
      const result = await request({ url: CATEGORY_OPTIONS_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('低价设置管控品类筛选项响应必须是数组')
      return result.map((item, index) => categoryOptionOf(item, `低价设置管控品类筛选项[${index}]`))
    },

    async list (query: SaleLowPriceListQuery = {}): Promise<PageResult<SaleLowPriceConfig>> {
      const range = localDateRangeParamOf(query)
      const params: Record<string, unknown> = {
        order: optionalTextOf(query.order, 'order') ?? '',
        orderField: optionalTextOf(query.orderField, 'orderField') ?? '',
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        categoryId: categoryIdOf(query.categoryId, 'categoryId'),
        operatorKeyword: optionalTextOf(query.operatorKeyword, 'operatorKeyword'),
      }
      if (range.start !== undefined) params.updateTimeStart = range.start
      if (range.end !== undefined) params.updateTimeEnd = range.end
      return pageOf(await request({ url: PAGE_URL, method: 'get', params }), '低价设置分页响应', configOf)
    },

    async skuTreeCategories (input: { excludeConfigId?: SaleLowPriceId | null } = {}): Promise<SaleLowPriceCategoryNode[]> {
      const params: Record<string, unknown> = {}
      if (input.excludeConfigId !== undefined && input.excludeConfigId !== null && input.excludeConfigId !== '') {
        params.excludeConfigId = idOf(input.excludeConfigId, 'excludeConfigId')
      }
      const result = await request({ url: CATEGORY_TREE_URL, method: 'get', params })
      if (!Array.isArray(result)) throw new Error('低价设置商品品类候选响应必须是数组')
      return result.map((item, index) => categoryNodeOf(item, `低价设置商品品类候选[${index}]`))
    },

    async skuTreeSkus (input: { categoryId: number; excludeConfigId?: SaleLowPriceId | null }): Promise<SaleLowPriceSkuOption[]> {
      const categoryId = categoryIdOf(input?.categoryId, 'categoryId', false) as number
      const params: Record<string, unknown> = { categoryId }
      if (input.excludeConfigId !== undefined && input.excludeConfigId !== null && input.excludeConfigId !== '') {
        params.excludeConfigId = idOf(input.excludeConfigId, 'excludeConfigId')
      }
      const result = await request({ url: SKU_TREE_URL, method: 'get', params })
      if (!Array.isArray(result)) throw new Error('低价设置商品规格候选响应必须是数组')
      return result.map((item, index) => skuOptionOf(item, `低价设置商品规格候选[${index}]`))
    },

    async get (input: { id: SaleLowPriceId }): Promise<SaleLowPriceConfig> {
      const id = idOf(input?.id, '低价管控标准配置ID')
      return configOf(await request({ url: GET_URL, method: 'get', params: { id } }), '低价管控标准配置详情')
    },

    prepareCreate (input: { form: SaleLowPriceConfigForm }): SaleLowPriceConfigPreparation {
      return { draft: configDraftOf(input?.form, 'create') }
    },

    async create (input: SaleLowPriceConfigPreparation): Promise<SaleLowPriceId> {
      const draft = configDraftOf(input?.draft, 'create')
      const result = await request({ url: CREATE_URL, method: 'post', data: draft })
      return idOf(result, '新增低价管控标准返回ID')
    },

    prepareUpdate (input: { form: SaleLowPriceConfigForm }): SaleLowPriceConfigPreparation {
      return { draft: configDraftOf(input?.form, 'update') }
    },

    async update (input: SaleLowPriceConfigPreparation): Promise<true> {
      const draft = configDraftOf(input?.draft, 'update')
      return trueResult(await request({ url: UPDATE_URL, method: 'put', data: draft }), '编辑低价管控标准')
    },

    prepareRemove (input: { id: SaleLowPriceId }): SaleLowPriceRemovePreparation {
      return { id: idOf(input?.id, '低价管控标准配置ID') }
    },

    async remove (input: SaleLowPriceRemovePreparation): Promise<true> {
      const id = idOf(input?.id, '低价管控标准配置ID')
      return trueResult(await request({ url: DELETE_URL, method: 'delete', params: { id } }), '删除低价管控标准')
    },
  }
}

export type SaleLowPriceCapability = ReturnType<typeof createSaleLowPriceCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const pageParams = [p('pageNo', 'number'), p('pageSize', 'number'), p('categoryId', 'number'), p('updateTimeRange', 'date'), p('operatorKeyword', 'text')]
const idParam = p('id', 'text', true, '当前低价管控标准配置ID')
const configFormParam = p('form', 'text', true, 'Portal低价设置新增/编辑表单；先用skuTreeCategories和skuTreeSkus取得可选品类与规格，再传入skus和standards')
const configDraftParam = p('draft', 'text', true, 'prepareCreate或prepareUpdate返回的低价管控标准提交草稿；rules不包含Portal本地uid和sortNo')

export const SALE_LOW_PRICE_METHODS = {
  'sale-low-price-category-options': 'categoryOptions',
  'sale-low-price-list': 'list',
  'sale-low-price-sku-tree-categories': 'skuTreeCategories',
  'sale-low-price-sku-tree-skus': 'skuTreeSkus',
  'sale-low-price-get': 'get',
  'sale-low-price-prepare-create': 'prepareCreate',
  'sale-low-price-create': 'create',
  'sale-low-price-prepare-update': 'prepareUpdate',
  'sale-low-price-update': 'update',
  'sale-low-price-prepare-remove': 'prepareRemove',
  'sale-low-price-remove': 'remove',
} as const

export const saleLowPriceCapabilities: CapabilityDefinition[] = [
  { id: 'sale-low-price-category-options', title: '查询低价设置管控品类筛选项', write: false, params: [] },
  { id: 'sale-low-price-list', title: '查询低价设置管控标准列表', write: false, params: pageParams },
  { id: 'sale-low-price-sku-tree-categories', title: '查询低价设置可选品类', write: false, params: [p('excludeConfigId', 'text', false, '编辑时排除当前配置，避免当前配置的SKU被自身置灰')] },
  { id: 'sale-low-price-sku-tree-skus', title: '查询低价设置可选商品规格', write: false, params: [p('categoryId', 'number', true, '从skuTreeCategories返回的二级品类ID'), p('excludeConfigId', 'text', false, '编辑时排除当前配置')] },
  { id: 'sale-low-price-get', title: '查询低价管控标准配置详情', write: false, params: [idParam] },
  { id: 'sale-low-price-prepare-create', title: '准备新增低价管控标准草稿', write: false, params: [configFormParam] },
  { id: 'sale-low-price-create', title: '新增低价管控标准', write: true, params: [configDraftParam] },
  { id: 'sale-low-price-prepare-update', title: '准备编辑低价管控标准草稿', write: false, params: [configFormParam] },
  { id: 'sale-low-price-update', title: '编辑低价管控标准', write: true, params: [configDraftParam] },
  { id: 'sale-low-price-prepare-remove', title: '准备删除低价管控标准', write: false, params: [idParam] },
  { id: 'sale-low-price-remove', title: '删除低价管控标准', write: true, params: [idParam] },
].map(definition => ({
  ...definition,
  pagePath: SALE_LOW_PRICE_PAGE_PATH,
  permission: SALE_LOW_PRICE_PERMISSION,
  moduleType: SALE_LOW_PRICE_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
