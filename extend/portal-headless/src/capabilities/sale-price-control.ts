import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 价格管控。 */
export const SALE_PRICE_CONTROL_PAGE_PATH = '/dashboard/sale/setting/price-control/list'
export const SALE_PRICE_CONTROL_FORM_PATH = '/simple/sales/form/005'
export const SALE_PRICE_CONTROL_PERMISSION = '/dashboard/sale/setting/price-control'
export const SALE_PRICE_CONTROL_MODULE_TYPE = 60
export const SALE_PRICE_CONTROL_APPLY_PERMISSION = 'setting:price-control:guide-apply:apply'
export const SALE_PRICE_CONTROL_VIEW_PERMISSION = '/dashboard/sale/setting/price-control'
export const SALE_PRICE_CONTROL_STOP_PERMISSION = 'setting:price-control:guide-apply:stop'
export const SALE_PRICE_CONTROL_DELETE_PERMISSION = 'setting:price-control:guide-apply:delete'
export const SALE_PRICE_CONTROL_APPLY_VIEW_PERMISSION = 'setting:price-control:guide-apply:view'
export const SALE_PRICE_CONTROL_WITHDRAW_PERMISSION = 'setting:price-control:guide-apply:withdraw'
export const SALE_PRICE_CONTROL_RESUBMIT_PERMISSION = 'setting:price-control:guide-apply:resubmit'
export const SALE_PRICE_CONTROL_VOID_PERMISSION = 'setting:price-control:guide-apply:void'

const STANDARD_CATEGORY_LIST_URL = '/admin-api/sales/price-control-config/categoryList'
const STANDARD_LIST_URL = '/admin-api/sales/price-control-config/list'
const STANDARD_CREATE_URL = '/admin-api/sales/price-control-standards/create'
const STANDARD_UPDATE_URL = '/admin-api/sales/price-control-standards/update'
const STANDARD_DELETE_URL = '/admin-api/sales/price-control-standards/delete'
const STANDARD_APPROVAL_STATUS_URL = '/admin-api/sales/price-control-standards/approval-status'
const STANDARD_STOP_URL = '/admin-api/sales/price-control-standards/enableOrStop'
const APPLY_CATEGORY_TREE_URL = 'admin-api/priceControlApply/categoryTree'
const APPLY_PAGE_URL = '/admin-api/priceControlApply/page'
const APPLY_GET_URL = 'admin-api/priceControlApply/get'
const APPLY_ITEM_LIST_URL = 'admin-api/priceControlApply/itemList'
const APPLY_SKU_LIST_URL = 'admin-api/priceControlApply/skuList'
const APPLY_CREATE_URL = 'admin-api/priceControlApply/create'
const APPLY_CANCEL_URL = 'admin-api/priceControlApply/cancel'
const APPLY_VOID_URL = '/admin-api/priceControlApply/void'
const THIRD_PARTY_SETTING_URL = '/sales/third-party-payment/setting'

export type SalePriceControlId = string | number
export type SalePriceControlDateRange = [string, string] | [] | null

export type SalePriceControlCategory = Record<string, unknown> & {
  catId: number
  catName: string
}

export type SalePriceControlStandardRow = Record<string, unknown> & {
  id: SalePriceControlId
  orgId: string | null
  officeName: string | null
  controlPeriod: string | null
  categoryId: number | null
  catName: string | null
  itemId: number | null
  itemName: string | null
  skuId: number | null
  specInfo: string | null
  controlType: string | null
  guidePrice: string | null
  updateTime: string | null
  status: number | null
  applyId: SalePriceControlId | null
  statusName: string | null
  statusValue: number | null
  processInstanceId?: string | null
}

export type SalePriceControlStandardForm = Record<string, unknown> & {
  orgId: string | number | null
  controlDate: SalePriceControlDateRange
  categoryId: number | null
  itemId: number | null
  skuId: number | null
  controlType: number | null
  guidePrice: number | null
  id?: SalePriceControlId | null
  status?: number | null
}

export type SalePriceControlStandardDraft = Record<string, unknown> & {
  id: SalePriceControlId | null
  orgId: string | number
  controlStartDate: string
  controlEndDate: string
  categoryId: number
  itemId: number
  skuId: number
  controlType: 1
  guidePrice: number
  status?: number | null
}

export type SalePriceControlApplicationRow = Record<string, unknown> & {
  id: SalePriceControlId
  orgId: string | null
  orgFullName: string | null
  controlPeriod: string | null
  categoryId: number | null
  categoryFullName: string | null
  createTime: string | null
  approveTime: string | null
  status: number | null
  statusName: string | null
  processInstanceId: string | null
}

export type SalePriceControlApplicationItem = Record<string, unknown> & {
  id?: SalePriceControlId | null
  itemId: number
  skuId: number
  guidePrice: number
  unit: string | null
  itemName?: string | null
  specInfo?: string | null
}

export type SalePriceControlApplicationRequestItem = {
  itemId: number
  skuId: number
  guidePrice: number
  unit: string | null
}

export type SalePriceControlAttachment = Record<string, unknown> & {
  id?: SalePriceControlId | null
  name: string
  url: string
  size?: number | null
}

export type SalePriceControlApplicationDetail = Record<string, unknown> & {
  id: SalePriceControlId
  orgId: string | null
  orgFullName: string | null
  controlStartDate: string | null
  controlEndDate: string | null
  controlPeriod: string | null
  categoryId: number | null
  parentCategoryId: number | null
  parentCategoryName: string | null
  categoryName: string | null
  categoryFullName: string | null
  controlType: number | null
  approvalTag: string | null
  applicantId: SalePriceControlId | null
  applicantName: string | null
  reason: string | null
  attachments: SalePriceControlAttachment[]
  processInstanceId: string | null
  status: number | null
  statusName: string | null
  createTime: string | null
  approveTime: string | null
  voidTime: string | null
  items: SalePriceControlApplicationItem[]
}

export type SalePriceControlStandardQuery = {
  pageNo?: number
  pageSize?: number
  categoryId?: number | null
  itemName?: string | null
  officeIds?: Array<string | number> | null
}

export type SalePriceControlApplicationQuery = {
  pageNo?: number
  pageSize?: number
  categoryId?: number | null
  officeIds?: Array<string | number> | null
  controlPeriod?: SalePriceControlDateRange
  status?: number | null
}

export type SalePriceControlGoodsForm = {
  itemId: number
  skuId: number
  guidePrice: number
  unit?: string | null
}

export type SalePriceControlApplicationForm = {
  orgId: string | number | null
  controlDate: [string, string] | [] | null
  controlType: number | null
  categoryId: number | null
  goodsList: SalePriceControlGoodsForm[]
  approvalTag: string | null
  reason?: string | null
  attachments?: SalePriceControlAttachment[] | null
}

export type SalePriceControlApplicationDraft = {
  orgId: string
  controlStartDate: string
  controlEndDate: string
  categoryId: number
  controlType: number
  approvalTag: string
  reason: string | null
  attachments: SalePriceControlAttachment[]
  items: SalePriceControlApplicationRequestItem[]
}

export type SalePriceControlApplicationPreparation = { draft: SalePriceControlApplicationDraft }
export type SalePriceControlStandardActionPreparation = { record: SalePriceControlStandardRow }
export type SalePriceControlStandardFormPreparation = { draft: SalePriceControlStandardDraft }
export type SalePriceControlRemovePreparation = { id: SalePriceControlId }
export type SalePriceControlApplicationActionPreparation = { id: SalePriceControlId; status: number }

export type SalePriceControlApplicationCategoryNode = Record<string, unknown> & {
  catId: number
  parentId: number | null
  catName: string
  level: string
  isLeaf: number | null
  disabled: boolean
  children: SalePriceControlApplicationCategoryNode[]
}

export type SalePriceControlItemOption = Record<string, unknown> & {
  itemId: number
  itemName: string
  unit: string | null
  unit2: string | null
  graySign: string | null
}

export type SalePriceControlSkuOption = Record<string, unknown> & {
  skuId: number
  specInfo: string
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SalePriceControlId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function optionalIdOf (value: unknown, label: string): SalePriceControlId | null {
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

function localDateToday (): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function positiveIntegerOf (value: unknown, label: string): number {
  return integerOf(value, label, { min: 1 }) as number
}

function nonNegativeIntegerOf (value: unknown, label: string): number | null {
  return integerOf(value, label, { nullable: true, min: 0 })
}

function moneyOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  if (value < 0) throw new Error(`${label}不能小于0`)
  if (Math.round(value * 100) !== value * 100) throw new Error(`${label}最多保留2位小数`)
  return value
}

function standardOrgIdOf (value: unknown, label: string): string | number {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  throw new Error(`${label}不能为空`)
}

function standardStatusOf (value: unknown, label: string, mode: 'create' | 'update'): number | null | undefined {
  if (mode === 'create') return 1
  if (value === undefined) return undefined
  if (value === null) return null
  return integerOf(value, label, { min: 0 }) as number
}

function standardBodyOf (value: unknown, mode: 'create' | 'update'): SalePriceControlStandardDraft {
  const form = objectOf(value, mode === 'create' ? '价格管控标准创建表单' : '价格管控标准编辑表单')
  let controlStartDate: string
  let controlEndDate: string
  if (Object.prototype.hasOwnProperty.call(form, 'controlDate')) {
    const controlDate = dateRangeOf(form.controlDate, 'controlDate')
    if (!controlDate) throw new Error('controlDate不能为空')
    controlStartDate = controlDate.start
    controlEndDate = controlDate.end
  } else {
    controlStartDate = dateOf(form.controlStartDate, 'controlStartDate')
    controlEndDate = dateOf(form.controlEndDate, 'controlEndDate')
    if (controlEndDate < controlStartDate) throw new Error('controlDate结束日期不能早于开始日期')
  }
  const orgId = standardOrgIdOf(form.orgId, 'orgId')
  const categoryId = positiveIntegerOf(form.categoryId, 'categoryId')
  const itemId = positiveIntegerOf(form.itemId, 'itemId')
  const skuId = positiveIntegerOf(form.skuId, 'skuId')
  const controlType = positiveIntegerOf(form.controlType, 'controlType')
  if (controlType !== 1) throw new Error('controlType必须为1')
  const guidePrice = moneyOf(form.guidePrice, 'guidePrice')
  const id = mode === 'create' ? null : idOf(form.id, '价格管控标准ID')
  const status = standardStatusOf(form.status, 'status', mode)
  const payload = { ...form }
  delete payload.controlDate
  delete payload.controlPeriod
  return {
    ...payload,
    controlType: 1,
    id,
    status,
    controlStartDate,
    controlEndDate,
    orgId,
    categoryId,
    itemId,
    skuId,
    guidePrice,
  }
}

function categoryIdOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  return positiveIntegerOf(value, label)
}

function idsParamOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new Error(`${label}必须是组织ID数组`)
  if (value.length === 0) return null
  return value.map((item, index) => String(idOf(item, `${label}[${index}]`))).join(',')
}

function pageOf<T> (value: unknown, label: string, row: (value: unknown, label: string) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => row(item, `${label}.list[${index}]`)), total: page.total as number }
}

function categoryOf (value: unknown, label: string): SalePriceControlCategory {
  const category = objectOf(value, label)
  return {
    ...category,
    catId: positiveIntegerOf(category.catId, `${label}.catId`),
    catName: requiredTextOf(category.catName, `${label}.catName`),
  }
}

function standardRowOf (value: unknown, label: string): SalePriceControlStandardRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    orgId: optionalTextOf(row.orgId, `${label}.orgId`),
    officeName: optionalTextOf(row.officeName, `${label}.officeName`),
    controlPeriod: optionalTextOf(row.controlPeriod, `${label}.controlPeriod`),
    categoryId: categoryIdOf(row.categoryId, `${label}.categoryId`),
    catName: optionalTextOf(row.catName, `${label}.catName`),
    itemId: categoryIdOf(row.itemId, `${label}.itemId`),
    itemName: optionalTextOf(row.itemName, `${label}.itemName`),
    skuId: categoryIdOf(row.skuId, `${label}.skuId`),
    specInfo: optionalTextOf(row.specInfo, `${label}.specInfo`),
    controlType: optionalTextOf(row.controlType, `${label}.controlType`),
    guidePrice: optionalTextOf(row.guidePrice, `${label}.guidePrice`),
    updateTime: optionalTextOf(row.updateTime, `${label}.updateTime`),
    status: integerOf(row.status, `${label}.status`, { nullable: true, min: 0 }),
    applyId: optionalIdOf(row.applyId, `${label}.applyId`),
    statusName: optionalTextOf(row.statusName, `${label}.statusName`),
    statusValue: integerOf(row.statusValue, `${label}.statusValue`, { nullable: true, min: 1 }),
    ...(row.processInstanceId === undefined ? {} : { processInstanceId: optionalTextOf(row.processInstanceId, `${label}.processInstanceId`) }),
  }
}

function applicationRowOf (value: unknown, label: string): SalePriceControlApplicationRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    orgId: optionalTextOf(row.orgId, `${label}.orgId`),
    orgFullName: optionalTextOf(row.orgFullName, `${label}.orgFullName`),
    controlPeriod: optionalTextOf(row.controlPeriod, `${label}.controlPeriod`),
    categoryId: categoryIdOf(row.categoryId, `${label}.categoryId`),
    categoryFullName: optionalTextOf(row.categoryFullName, `${label}.categoryFullName`),
    createTime: optionalTextOf(row.createTime, `${label}.createTime`),
    approveTime: optionalTextOf(row.approveTime, `${label}.approveTime`),
    status: integerOf(row.status, `${label}.status`, { nullable: true, min: 1 }),
    statusName: optionalTextOf(row.statusName, `${label}.statusName`),
    processInstanceId: optionalTextOf(row.processInstanceId, `${label}.processInstanceId`),
  }
}

function itemOf (value: unknown, label: string): SalePriceControlApplicationItem {
  const item = objectOf(value, label)
  return {
    ...item,
    ...(item.id === undefined ? {} : { id: optionalIdOf(item.id, `${label}.id`) }),
    itemId: positiveIntegerOf(item.itemId, `${label}.itemId`),
    skuId: positiveIntegerOf(item.skuId, `${label}.skuId`),
    guidePrice: moneyOf(item.guidePrice, `${label}.guidePrice`),
    unit: optionalTextOf(item.unit, `${label}.unit`),
    ...(item.itemName === undefined ? {} : { itemName: optionalTextOf(item.itemName, `${label}.itemName`) }),
    ...(item.specInfo === undefined ? {} : { specInfo: optionalTextOf(item.specInfo, `${label}.specInfo`) }),
  }
}

function requestItemOf (value: unknown, label: string): SalePriceControlApplicationRequestItem {
  const item = objectOf(value, label)
  return {
    itemId: positiveIntegerOf(item.itemId, `${label}.itemId`),
    skuId: positiveIntegerOf(item.skuId, `${label}.skuId`),
    guidePrice: moneyOf(item.guidePrice, `${label}.guidePrice`),
    unit: optionalTextOf(item.unit, `${label}.unit`),
  }
}

function attachmentOf (value: unknown, label: string): SalePriceControlAttachment {
  const attachment = objectOf(value, label)
  return {
    ...attachment,
    ...(attachment.id === undefined ? {} : { id: optionalIdOf(attachment.id, `${label}.id`) }),
    name: requiredTextOf(attachment.name, `${label}.name`),
    url: requiredTextOf(attachment.url, `${label}.url`),
    ...(attachment.size === undefined ? {} : { size: attachment.size === null ? null : nonNegativeIntegerOf(attachment.size, `${label}.size`) }),
  }
}

function attachmentsOf (value: unknown): SalePriceControlAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('attachments必须是数组或null')
  if (value.length > 50) throw new Error('attachments最多上传50个文件')
  return value.map((item, index) => attachmentOf(item, `attachments[${index}]`))
}

function applicationDetailOf (value: unknown): SalePriceControlApplicationDetail {
  const detail = objectOf(value, '指导价申请详情')
  return {
    ...detail,
    id: idOf(detail.id, '指导价申请详情.id'),
    orgId: optionalTextOf(detail.orgId, '指导价申请详情.orgId'),
    orgFullName: optionalTextOf(detail.orgFullName, '指导价申请详情.orgFullName'),
    controlStartDate: optionalTextOf(detail.controlStartDate, '指导价申请详情.controlStartDate'),
    controlEndDate: optionalTextOf(detail.controlEndDate, '指导价申请详情.controlEndDate'),
    controlPeriod: optionalTextOf(detail.controlPeriod, '指导价申请详情.controlPeriod'),
    categoryId: categoryIdOf(detail.categoryId, '指导价申请详情.categoryId'),
    parentCategoryId: categoryIdOf(detail.parentCategoryId, '指导价申请详情.parentCategoryId'),
    parentCategoryName: optionalTextOf(detail.parentCategoryName, '指导价申请详情.parentCategoryName'),
    categoryName: optionalTextOf(detail.categoryName, '指导价申请详情.categoryName'),
    categoryFullName: optionalTextOf(detail.categoryFullName, '指导价申请详情.categoryFullName'),
    controlType: integerOf(detail.controlType, '指导价申请详情.controlType', { nullable: true, min: 1 }),
    approvalTag: optionalTextOf(detail.approvalTag, '指导价申请详情.approvalTag'),
    applicantId: optionalIdOf(detail.applicantId, '指导价申请详情.applicantId'),
    applicantName: optionalTextOf(detail.applicantName, '指导价申请详情.applicantName'),
    reason: optionalTextOf(detail.reason, '指导价申请详情.reason'),
    attachments: attachmentsOf(detail.attachments),
    processInstanceId: optionalTextOf(detail.processInstanceId, '指导价申请详情.processInstanceId'),
    status: integerOf(detail.status, '指导价申请详情.status', { nullable: true, min: 1 }),
    statusName: optionalTextOf(detail.statusName, '指导价申请详情.statusName'),
    createTime: optionalTextOf(detail.createTime, '指导价申请详情.createTime'),
    approveTime: optionalTextOf(detail.approveTime, '指导价申请详情.approveTime'),
    voidTime: optionalTextOf(detail.voidTime, '指导价申请详情.voidTime'),
    items: Array.isArray(detail.items) ? detail.items.map((item, index) => itemOf(item, `指导价申请详情.items[${index}]`)) : [],
  }
}

function applicationCategoryNodeOf (value: unknown, label: string): SalePriceControlApplicationCategoryNode {
  const node = objectOf(value, label)
  const level = String(node.level ?? '')
  return {
    ...node,
    catId: positiveIntegerOf(node.catId, `${label}.catId`),
    parentId: nonNegativeIntegerOf(node.parentId, `${label}.parentId`),
    catName: requiredTextOf(node.catName, `${label}.catName`),
    level,
    isLeaf: integerOf(node.isLeaf, `${label}.isLeaf`, { nullable: true, min: 0 }),
    disabled: Number(level) !== 2,
    children: Array.isArray(node.children)
      ? node.children.map((child, index) => applicationCategoryNodeOf(child, `${label}.children[${index}]`))
      : [],
  }
}

function itemOptionOf (value: unknown, label: string): SalePriceControlItemOption {
  const item = objectOf(value, label)
  return {
    ...item,
    itemId: positiveIntegerOf(item.itemId, `${label}.itemId`),
    itemName: requiredTextOf(item.itemName, `${label}.itemName`),
    unit: optionalTextOf(item.unit, `${label}.unit`),
    unit2: optionalTextOf(item.unit2, `${label}.unit2`),
    graySign: optionalTextOf(item.graySign, `${label}.graySign`),
  }
}

function skuOptionOf (value: unknown, label: string): SalePriceControlSkuOption {
  const sku = objectOf(value, label)
  return {
    ...sku,
    skuId: positiveIntegerOf(sku.skuId, `${label}.skuId`),
    specInfo: requiredTextOf(sku.specInfo, `${label}.specInfo`),
  }
}

function applicationDraftOf (input: unknown): SalePriceControlApplicationDraft {
  const form = objectOf(input, '指导价申请表单')
  const controlDate = dateRangeOf(form.controlDate, 'controlDate')
  if (!controlDate) throw new Error('controlDate不能为空')
  if (controlDate.end <= localDateToday()) throw new Error('controlDate结束日期须为未来日期')
  const orgId = requiredTextOf(String(form.orgId ?? ''), 'orgId')
  const categoryId = positiveIntegerOf(form.categoryId, 'categoryId')
  const controlType = positiveIntegerOf(form.controlType, 'controlType')
  if (![1, 2].includes(controlType)) throw new Error('controlType必须是1或2')
  const approvalTag = requiredTextOf(form.approvalTag, 'approvalTag')
  const reasonValue = form.reason === undefined || form.reason === null || form.reason === '' ? null : requiredTextOf(form.reason, 'reason')
  if (reasonValue !== null && reasonValue.length > 500) throw new Error('reason最多500个字符')
  if (!Array.isArray(form.goodsList) || form.goodsList.length < 1) throw new Error('goodsList至少包含一行商品明细')
  const items = form.goodsList.map((value, index) => requestItemOf(value, `goodsList[${index}]`))
  return {
    orgId,
    controlStartDate: controlDate.start,
    controlEndDate: controlDate.end,
    categoryId,
    controlType,
    approvalTag,
    reason: reasonValue,
    attachments: attachmentsOf(form.attachments),
    items,
  }
}

function applicationDraftInputOf (input: unknown): SalePriceControlApplicationDraft {
  const draft = objectOf(input, '指导价申请提交草稿')
  return applicationDraftOf({
    orgId: draft.orgId,
    controlDate: [draft.controlStartDate, draft.controlEndDate],
    categoryId: draft.categoryId,
    controlType: draft.controlType,
    approvalTag: draft.approvalTag,
    reason: draft.reason,
    attachments: draft.attachments,
    goodsList: draft.items,
  })
}

function actionRecordOf (input: unknown, label: string): SalePriceControlStandardRow {
  const value = objectOf(input, label)
  return standardRowOf(value, label)
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function approvalPromptOf (value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error('价格管控删除审批校验响应必须是字符串或null')
  return value
}

/** The injected request is bound to SALE_PRICE_CONTROL_PAGE_PATH. */
export function createSalePriceControlCapability (request: PortalRequest) {
  const checkStandardApprovalStatus = async (id: SalePriceControlId): Promise<string | null> => {
    const result = await request({ url: `${STANDARD_APPROVAL_STATUS_URL}?id=${id}`, method: 'get' })
    return approvalPromptOf(result)
  }

  return {
    async categoryList (): Promise<SalePriceControlCategory[]> {
      const result = await request({ url: STANDARD_CATEGORY_LIST_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('价格管控商品品类响应必须是数组')
      return result.map((item, index) => categoryOf(item, `价格管控商品品类[${index}]`))
    },

    async standardList (query: SalePriceControlStandardQuery = {}): Promise<PageResult<SalePriceControlStandardRow>> {
      const categoryId = categoryIdOf(query.categoryId, 'categoryId')
      return pageOf(await request({
        url: STANDARD_LIST_URL,
        method: 'get',
        params: {
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
          categoryId,
          itemName: optionalTextOf(query.itemName, 'itemName'),
          officeId: idsParamOf(query.officeIds, 'officeIds'),
        },
      }), '价格管控标准分页响应', standardRowOf)
    },

    async applicationList (query: SalePriceControlApplicationQuery = {}): Promise<PageResult<SalePriceControlApplicationRow>> {
      const range = dateRangeOf(query.controlPeriod, 'controlPeriod')
      const params: Record<string, unknown> = {
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        categoryId: categoryIdOf(query.categoryId, 'categoryId'),
        orgIds: idsParamOf(query.officeIds, 'officeIds'),
        status: integerOf(query.status, 'status', { nullable: true, min: 1 }),
      }
      if (range) {
        params.controlPeriodStart = range.start
        params.controlPeriodEnd = range.end
      }
      return pageOf(await request({ url: APPLY_PAGE_URL, method: 'get', params }), '指导价申请分页响应', applicationRowOf)
    },

    async applicationCategoryTree (): Promise<SalePriceControlApplicationCategoryNode[]> {
      const result = await request({ url: APPLY_CATEGORY_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('指导价申请管控品类树响应必须是数组')
      return result.map((node, index) => applicationCategoryNodeOf(node, `指导价申请管控品类树[${index}]`))
    },

    async applicationItemList (input: { categoryId: number }): Promise<SalePriceControlItemOption[]> {
      const categoryId = positiveIntegerOf(input?.categoryId, 'categoryId')
      const result = await request({ url: APPLY_ITEM_LIST_URL, method: 'get', params: { categoryId } })
      if (!Array.isArray(result)) throw new Error('指导价申请商品候选响应必须是数组')
      return result.map((item, index) => itemOptionOf(item, `指导价申请商品候选[${index}]`))
    },

    async applicationSkuList (input: { itemId: number }): Promise<SalePriceControlSkuOption[]> {
      const itemId = positiveIntegerOf(input?.itemId, 'itemId')
      const result = await request({ url: APPLY_SKU_LIST_URL, method: 'get', params: { itemId } })
      if (!Array.isArray(result)) throw new Error('指导价申请规格候选响应必须是数组')
      return result.map((sku, index) => skuOptionOf(sku, `指导价申请规格候选[${index}]`))
    },

    async applicationGet (input: { id: SalePriceControlId }): Promise<SalePriceControlApplicationDetail> {
      const id = idOf(input?.id, '指导价申请ID')
      return applicationDetailOf(await request({ url: APPLY_GET_URL, method: 'get', params: { id } }))
    },

    prepareCreate (input: { form: SalePriceControlApplicationForm }): SalePriceControlApplicationPreparation {
      return { draft: applicationDraftOf(input?.form) }
    },

    async create (input: SalePriceControlApplicationPreparation): Promise<SalePriceControlId> {
      const draft = applicationDraftInputOf(input?.draft)
      const result = await request({ url: APPLY_CREATE_URL, method: 'post', data: draft })
      return idOf(result, '创建指导价申请返回ID')
    },

    prepareStandardCreate (input: { form: SalePriceControlStandardForm }): SalePriceControlStandardFormPreparation {
      return { draft: standardBodyOf(input?.form, 'create') }
    },

    async standardCreate (input: SalePriceControlStandardFormPreparation): Promise<SalePriceControlId> {
      const draft = standardBodyOf(input?.draft, 'create')
      return idOf(await request({ url: STANDARD_CREATE_URL, method: 'post', data: draft }), '创建价格管控标准返回ID')
    },

    prepareStandardUpdate (input: { form: SalePriceControlStandardForm }): SalePriceControlStandardFormPreparation {
      return { draft: standardBodyOf(input?.form, 'update') }
    },

    async standardUpdate (input: SalePriceControlStandardFormPreparation): Promise<true> {
      const draft = standardBodyOf(input?.draft, 'update')
      return trueResult(await request({ url: STANDARD_UPDATE_URL, method: 'put', data: draft }), '更新价格管控标准')
    },

    cancelStandardCreate (): { cancelled: true } {
      return { cancelled: true }
    },

    cancelStandardUpdate (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareWithdraw (input: { id: SalePriceControlId; status: number }): SalePriceControlApplicationActionPreparation {
      const id = idOf(input?.id, '指导价申请ID')
      const status = positiveIntegerOf(input?.status, 'status')
      if (status !== 1) throw new Error('只有审批中的指导价申请可以撤回')
      return { id, status }
    },

    async withdraw (input: { id: SalePriceControlId; status: number }): Promise<true> {
      const id = idOf(input?.id, '指导价申请ID')
      const status = positiveIntegerOf(input?.status, 'status')
      if (status !== 1) throw new Error('只有审批中的指导价申请可以撤回')
      return trueResult(await request({ url: APPLY_CANCEL_URL, method: 'delete', params: { id } }), '撤回指导价申请')
    },

    prepareVoid (input: { id: SalePriceControlId; status: number }): SalePriceControlApplicationActionPreparation {
      const id = idOf(input?.id, '指导价申请ID')
      const status = positiveIntegerOf(input?.status, 'status')
      if (status !== 2) throw new Error('只有审批通过的指导价申请可以作废')
      return { id, status }
    },

    async void (input: { id: SalePriceControlId; status: number }): Promise<true> {
      const id = idOf(input?.id, '指导价申请ID')
      const status = positiveIntegerOf(input?.status, 'status')
      if (status !== 2) throw new Error('只有审批通过的指导价申请可以作废')
      return trueResult(await request({ url: APPLY_VOID_URL, method: 'put', data: null, params: { id } }), '作废指导价申请')
    },

    prepareStop (input: { record: SalePriceControlStandardRow }): SalePriceControlStandardActionPreparation {
      const record = actionRecordOf(input?.record, '价格管控标准记录')
      if (record.status !== 1 || record.statusValue !== 2) throw new Error('只有已生效的价格管控标准可以停用')
      return { record }
    },

    async stop (input: { record: SalePriceControlStandardRow }): Promise<true> {
      const record = actionRecordOf(input?.record, '价格管控标准停用草稿')
      if (record.status !== 1 || record.statusValue !== 2) throw new Error('只有已生效的价格管控标准可以停用')
      if (!record.controlPeriod || record.controlPeriod.split('~').length !== 2) throw new Error('价格管控标准记录缺少有效controlPeriod')
      const [controlStartDate, controlEndDate] = record.controlPeriod.split('~').map((value, index) => dateOf(value, `controlPeriod[${index}]`))
      return trueResult(await request({
        url: STANDARD_STOP_URL,
        method: 'put',
        data: {
          ...record,
          controlType: 1,
          status: 0,
          controlStartDate,
          controlEndDate,
        },
      }), '停用价格管控标准')
    },

    async standardApprovalStatus (input: { id: SalePriceControlId }): Promise<string | null> {
      const id = idOf(input?.id, '价格管控标准ID')
      const result = await request({ url: `${STANDARD_APPROVAL_STATUS_URL}?id=${id}`, method: 'get' })
      return approvalPromptOf(result)
    },

    async prepareRemove (input: { id: SalePriceControlId }): Promise<SalePriceControlRemovePreparation> {
      const id = idOf(input?.id, '价格管控标准ID')
      const prompt = await checkStandardApprovalStatus(id)
      if (prompt) throw new Error(prompt)
      return { id }
    },

    async remove (input: SalePriceControlRemovePreparation): Promise<true> {
      const id = idOf(input?.id, '价格管控标准ID')
      return trueResult(await request({ url: `${STANDARD_DELETE_URL}?id=${id}`, method: 'delete' }), '删除价格管控标准')
    },

    async getThirdPartySetting (): Promise<boolean> {
      const result = await request({ url: THIRD_PARTY_SETTING_URL, method: 'get' })
      if (typeof result !== 'boolean') throw new Error('第三方收款管控开关响应必须是boolean')
      return result
    },

    async setThirdPartySetting (input: { enabled: boolean }): Promise<true> {
      if (typeof input?.enabled !== 'boolean') throw new Error('enabled必须是boolean')
      return trueResult(await request({ url: THIRD_PARTY_SETTING_URL, method: 'put', data: { enabled: input.enabled } }), '更新第三方收款管控开关')
    },
  }
}

export type SalePriceControlCapability = ReturnType<typeof createSalePriceControlCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const pageParams = [p('pageNo', 'number'), p('pageSize', 'number')]
const idParam = p('id', 'text', true, '当前列表/详情记录ID')
const statusParam = p('status', 'number', true, 'Portal按钮显示时的当前审批状态：1审批中或2审批通过')

export const SALE_PRICE_CONTROL_METHODS = {
  'sale-price-control-category-list': 'categoryList',
  'sale-price-control-standard-list': 'standardList',
  'sale-price-control-application-list': 'applicationList',
  'sale-price-control-application-category-tree': 'applicationCategoryTree',
  'sale-price-control-application-item-list': 'applicationItemList',
  'sale-price-control-application-sku-list': 'applicationSkuList',
  'sale-price-control-application-get': 'applicationGet',
  'sale-price-control-prepare-create': 'prepareCreate',
  'sale-price-control-create': 'create',
  'sale-price-control-prepare-standard-create': 'prepareStandardCreate',
  'sale-price-control-standard-create': 'standardCreate',
  'sale-price-control-prepare-standard-update': 'prepareStandardUpdate',
  'sale-price-control-standard-update': 'standardUpdate',
  'sale-price-control-cancel-standard-create': 'cancelStandardCreate',
  'sale-price-control-cancel-standard-update': 'cancelStandardUpdate',
  'sale-price-control-prepare-withdraw': 'prepareWithdraw',
  'sale-price-control-withdraw': 'withdraw',
  'sale-price-control-prepare-void': 'prepareVoid',
  'sale-price-control-void': 'void',
  'sale-price-control-prepare-stop': 'prepareStop',
  'sale-price-control-stop': 'stop',
  'sale-price-control-standard-approval-status': 'standardApprovalStatus',
  'sale-price-control-prepare-remove': 'prepareRemove',
  'sale-price-control-remove': 'remove',
  'sale-price-control-get-third-party-setting': 'getThirdPartySetting',
  'sale-price-control-set-third-party-setting': 'setThirdPartySetting',
} as const

const standardRecordParam = p('record', 'text', true, '当前价格管控标准列表中的完整记录；停用需要保留Portal展开的原记录字段')
const applicationFormParam = p('form', 'text', true, '指导价申请PC表单；goodsList至少一行，管控品类必须来自树中未禁用的二级节点')
const applicationDraftParam = p('draft', 'text', true, 'prepareCreate返回的最终申请请求草稿')
const standardFormParam = p('form', 'text', true, '价格管控标准隐藏表单；包含组织、日期范围、品类、商品、规格、管控类型和指导价')
const standardDraftParam = p('draft', 'text', true, 'prepareStandardCreate或prepareStandardUpdate返回的完整请求草稿')

export const salePriceControlCapabilities: CapabilityDefinition[] = [
  { id: 'sale-price-control-category-list', title: '查询价格管控商品品类', write: false, params: [] },
  { id: 'sale-price-control-standard-list', title: '查询价格管控标准列表', write: false, params: [...pageParams, p('categoryId', 'number'), p('itemName', 'text'), p('officeIds', 'tree')] },
  { id: 'sale-price-control-application-list', title: '查询指导价申请列表', write: false, params: [...pageParams, p('categoryId', 'number'), p('officeIds', 'tree'), p('controlPeriod', 'date'), p('status', 'number')] },
  { id: 'sale-price-control-application-category-tree', title: '查询指导价申请管控品类树', write: false, params: [] },
  { id: 'sale-price-control-application-item-list', title: '查询指导价申请商品候选', write: false, params: [p('categoryId', 'number', true, '从管控品类树选择的可选二级品类ID')] },
  { id: 'sale-price-control-application-sku-list', title: '查询指导价申请规格候选', write: false, params: [p('itemId', 'number', true, '从商品候选选择的商品ID')] },
  { id: 'sale-price-control-application-get', title: '查询指导价申请详情', write: false, params: [idParam] },
  { id: 'sale-price-control-prepare-create', title: '准备指导价申请提交草稿', write: false, params: [applicationFormParam] },
  { id: 'sale-price-control-create', title: '提交指导价申请', write: true, params: [applicationDraftParam] },
  { id: 'sale-price-control-prepare-standard-create', title: '准备创建价格管控标准', write: false, params: [standardFormParam] },
  { id: 'sale-price-control-standard-create', title: '创建价格管控标准', write: true, params: [standardDraftParam] },
  { id: 'sale-price-control-prepare-standard-update', title: '准备编辑价格管控标准', write: false, params: [standardFormParam] },
  { id: 'sale-price-control-standard-update', title: '编辑价格管控标准', write: true, params: [standardDraftParam] },
  { id: 'sale-price-control-cancel-standard-create', title: '取消创建价格管控标准提交', write: false, params: [] },
  { id: 'sale-price-control-cancel-standard-update', title: '取消编辑价格管控标准提交', write: false, params: [] },
  { id: 'sale-price-control-prepare-withdraw', title: '准备撤回指导价申请', write: false, params: [idParam, statusParam] },
  { id: 'sale-price-control-withdraw', title: '撤回指导价申请', write: true, params: [idParam, statusParam] },
  { id: 'sale-price-control-prepare-void', title: '准备作废指导价申请', write: false, params: [idParam, statusParam] },
  { id: 'sale-price-control-void', title: '作废指导价申请', write: true, params: [idParam, statusParam] },
  { id: 'sale-price-control-prepare-stop', title: '准备停用价格管控标准', write: false, params: [standardRecordParam] },
  { id: 'sale-price-control-stop', title: '停用价格管控标准', write: true, params: [standardRecordParam] },
  { id: 'sale-price-control-standard-approval-status', title: '校验价格管控标准删除审批状态', write: false, params: [idParam] },
  { id: 'sale-price-control-prepare-remove', title: '准备删除价格管控标准', write: false, params: [idParam] },
  { id: 'sale-price-control-remove', title: '删除价格管控标准', write: true, params: [idParam] },
  { id: 'sale-price-control-get-third-party-setting', title: '查询第三方收款管控开关', write: false, params: [] },
  { id: 'sale-price-control-set-third-party-setting', title: '更新第三方收款管控开关', write: true, params: [p('enabled', 'boolean', true, '第三方收款管控开关；Portal没有前端按钮权限判断，仍以服务端响应为准')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_PRICE_CONTROL_PAGE_PATH,
  permission: SALE_PRICE_CONTROL_PERMISSION,
  moduleType: SALE_PRICE_CONTROL_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
