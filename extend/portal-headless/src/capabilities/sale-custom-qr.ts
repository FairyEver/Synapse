import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户 → 系统设置 → 销售设置 → 二维码管理。 */
export const SALE_CUSTOM_QR_PAGE_PATH = '/dashboard/sale/custom/qr/list'
export const SALE_CUSTOM_QR_PERMISSION = '/dashboard/sale/frame/custom/qr'
export const SALE_CUSTOM_QR_MODULE_TYPE = 60

const ROOT = '/vue/config/codeOrder'
const DICT_ORDER_FIELD_URL = '/vue/sys/dict/listData'
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export type SaleCustomQrId = string | number
export type SaleCustomQrShopId = number

export type SaleCustomQrSupplierRow = Record<string, unknown> & {
  tenantId?: string | null
  tenantName?: string | null
  shopId: SaleCustomQrShopId
  shopName?: string | null
  itemKindNum?: number | null
  updateTime?: string | null
}

export type SaleCustomQrSupplierQuery = {
  tenantName?: string | null
  pageNo?: number
  pageSize?: number
}

export type SaleCustomQrItemKindRow = Record<string, unknown> & {
  itemKind: string
  itemKindName: string
  num: number
  updateTime?: string | null
}

export type SaleCustomQrFieldRow = Record<string, unknown> & {
  id: SaleCustomQrId
  shopId: SaleCustomQrShopId
  itemKind: string
  field: string
  fieldName?: string | null
  fieldType?: string | null
  fieldTypeName?: string | null
  sort: number
}

export type SaleCustomQrOrderFieldOption = Record<string, unknown> & {
  value: string
  label: string
  remarks?: string | null
  fieldTypeName: string
}

export type SaleCustomQrForm = {
  shopId: SaleCustomQrShopId
  itemKind: string
  field: string
  sort?: number | null
  id?: SaleCustomQrId | null
}

export type SaleCustomQrCreateForm = {
  form: SaleCustomQrForm
  /** 当前字段列表中已占用的sort；Portal新建时默认取最大值+1，无记录时为1。 */
  usedSort?: readonly number[]
}

export type SaleCustomQrUpdateForm = {
  form: SaleCustomQrForm & { id: SaleCustomQrId }
  /** 当前列表行的原字段值；编辑页的field控件禁用，必须保持不变。 */
  currentField: string
  /** Portal编辑弹窗传入的、已排除当前行sort的已占用排序集合。 */
  usedSort?: readonly number[]
}

export type SaleCustomQrDraft = {
  shopId: SaleCustomQrShopId
  itemKind: string
  field: string
  sort: number
  id: SaleCustomQrId | null
}

export type SaleCustomQrUpdateDraft = SaleCustomQrDraft & {
  /** 本地锁，不能作为HTTP字段发送；用于复现Portal编辑时field不可修改。 */
  currentField: string
}

export type SaleCustomQrFormPreparation = { draft: SaleCustomQrDraft }
export type SaleCustomQrUpdatePreparation = { draft: SaleCustomQrUpdateDraft }
export type SaleCustomQrRemovePreparation = { id: SaleCustomQrId }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleCustomQrId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function shopIdOf (value: unknown, label: string): SaleCustomQrShopId {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}必须是正整数`)
  }
  return value
}

function optionalShopIdOf (value: unknown, label: string): SaleCustomQrShopId | null {
  if (value === undefined || value === null) return null
  return shopIdOf(value, label)
}

function textOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}必填`)
    return ''
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && !value.trim()) throw new Error(`${label}必填且不能全为空格`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function integerOf (value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label}必须是大于等于${minimum}的安全整数`)
  }
  return value as number
}

function sortOf (value: unknown, label: string): number {
  return integerOf(value, label, 1)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return integerOf(value, label)
}

function updateTimeOf (value: unknown, label: string): string | null {
  return nullableTextOf(value, label)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) {
    throw new Error('pageSize必须是10、20、50或100')
  }
  return result
}

function supplierOf (value: unknown, label: string): SaleCustomQrSupplierRow {
  const row = objectOf(value, label)
  return {
    ...row,
    tenantId: nullableTextOf(row.tenantId, `${label}.tenantId`),
    tenantName: nullableTextOf(row.tenantName, `${label}.tenantName`),
    shopId: shopIdOf(row.shopId, `${label}.shopId`),
    shopName: nullableTextOf(row.shopName, `${label}.shopName`),
    itemKindNum: nullableIntegerOf(row.itemKindNum, `${label}.itemKindNum`),
    updateTime: updateTimeOf(row.updateTime, `${label}.updateTime`),
  }
}

function supplierPageOf (value: unknown): PageResult<SaleCustomQrSupplierRow> {
  const page = objectOf(value, '二维码供应商分页响应')
  if (!Array.isArray(page.list)) throw new Error('二维码供应商分页响应缺少list数组')
  return {
    list: page.list.map((item, index) => supplierOf(item, `二维码供应商列表[${index}]`)),
    total: integerOf(page.count, '二维码供应商分页响应count'),
  }
}

function itemKindOf (value: unknown, label: string): SaleCustomQrItemKindRow {
  const row = objectOf(value, label)
  return {
    ...row,
    itemKind: textOf(row.itemKind, `${label}.itemKind`, true),
    itemKindName: textOf(row.itemKindName, `${label}.itemKindName`, true),
    num: integerOf(row.num, `${label}.num`),
    updateTime: updateTimeOf(row.updateTime, `${label}.updateTime`),
  }
}

function itemKindListOf (value: unknown): SaleCustomQrItemKindRow[] {
  if (!Array.isArray(value)) throw new Error('二维码商品分类响应必须是数组')
  return value.map((item, index) => itemKindOf(item, `二维码商品分类列表[${index}]`))
}

function fieldOf (value: unknown, label: string): SaleCustomQrFieldRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    shopId: shopIdOf(row.shopId, `${label}.shopId`),
    itemKind: textOf(row.itemKind, `${label}.itemKind`, true),
    field: textOf(row.field, `${label}.field`, true),
    fieldName: nullableTextOf(row.fieldName, `${label}.fieldName`),
    fieldType: nullableTextOf(row.fieldType, `${label}.fieldType`),
    fieldTypeName: nullableTextOf(row.fieldTypeName, `${label}.fieldTypeName`),
    sort: sortOf(row.sort, `${label}.sort`),
  }
}

function fieldListOf (value: unknown): SaleCustomQrFieldRow[] {
  if (!Array.isArray(value)) throw new Error('二维码字段列表响应必须是数组')
  return value.map((item, index) => fieldOf(item, `二维码字段列表[${index}]`))
}

function fieldTypeNameOf (remarks: string | null): string {
  switch (remarks) {
    case 'order':
      return '订单信息'
    case 'item':
      return '商品信息'
    default:
      return ''
  }
}

function orderFieldOf (value: unknown, label: string): SaleCustomQrOrderFieldOption {
  const option = objectOf(value, label)
  const remarks = nullableTextOf(option.remarks, `${label}.remarks`)
  return {
    ...option,
    value: textOf(option.value, `${label}.value`, true),
    label: textOf(option.label, `${label}.label`, true),
    remarks,
    fieldTypeName: fieldTypeNameOf(remarks),
  }
}

function orderFieldListOf (value: unknown): SaleCustomQrOrderFieldOption[] {
  if (!Array.isArray(value)) throw new Error('order_field字典响应必须是数组')
  return value.map((item, index) => orderFieldOf(item, `order_field字典[${index}]`))
}

function usedSortOf (value: unknown): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('usedSort必须是数组')
  return value.map((item, index) => sortOf(item, `usedSort[${index}]`))
}

function defaultSortOf (usedSort: readonly number[]): number {
  return usedSort.length === 0 ? 1 : Math.max(...usedSort) + 1
}

function assertSortAvailable (sort: number, usedSort: readonly number[]): void {
  if (usedSort.includes(sort)) throw new Error('该排序已被使用')
}

function formPayloadOf (value: unknown, mode: 'create' | 'update', usedSortInput: unknown): SaleCustomQrDraft {
  const form = objectOf(value, '二维码字段表单')
  const usedSort = usedSortOf(usedSortInput)
  const sort = form.sort === undefined ? (mode === 'create' ? defaultSortOf(usedSort) : sortOf(form.sort, 'sort')) : sortOf(form.sort, 'sort')
  assertSortAvailable(sort, usedSort)

  const id = mode === 'update' ? idOf(form.id, '二维码字段ID') : null
  if (mode === 'create' && form.id !== undefined && form.id !== null && form.id !== '') {
    throw new Error('新建二维码字段不能带已有id')
  }

  return {
    shopId: shopIdOf(form.shopId, 'shopId'),
    itemKind: textOf(form.itemKind, 'itemKind', true),
    field: textOf(form.field, 'field', true),
    sort,
    id,
  }
}

function createDraftOf (input: unknown): SaleCustomQrDraft {
  const source = objectOf(input, '二维码字段新建草稿')
  return formPayloadOf(source, 'create', undefined)
}

function updateDraftOf (input: unknown): SaleCustomQrUpdateDraft {
  const draft = objectOf(input, '二维码字段编辑草稿')
  const currentField = textOf(draft.currentField, 'currentField', true)
  const normalized = formPayloadOf(draft, 'update', undefined)
  if (normalized.field !== currentField) throw new Error('编辑二维码字段时field不可修改')
  return { ...normalized, currentField }
}

function updateFormPayloadOf (input: unknown): SaleCustomQrUpdateDraft {
  const source = objectOf(input, '二维码字段编辑表单')
  const currentField = textOf(source.currentField, 'currentField', true)
  const normalized = formPayloadOf(source.form, 'update', source.usedSort)
  if (normalized.field !== currentField) throw new Error('编辑二维码字段时field不可修改')
  return { ...normalized, currentField }
}

function requestDataOf (draft: SaleCustomQrDraft): SaleCustomQrDraft {
  return {
    shopId: draft.shopId,
    itemKind: draft.itemKind,
    field: draft.field,
    sort: draft.sort,
    id: draft.id,
  }
}

export function createSaleCustomQrCapability (request: PortalRequest) {
  return {
    async supplierList (query: SaleCustomQrSupplierQuery = {}): Promise<PageResult<SaleCustomQrSupplierRow>> {
      return supplierPageOf(await request({
        url: `${ROOT}/shopSumPage`,
        method: 'get',
        params: {
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
          tenantName: textOf(query.tenantName, 'tenantName'),
        },
      }))
    },

    async itemKindList (input: { shopId?: SaleCustomQrShopId | null } = {}): Promise<SaleCustomQrItemKindRow[]> {
      return itemKindListOf(await request({
        url: `${ROOT}/itemKindSumList`,
        method: 'get',
        params: { shopId: optionalShopIdOf(input?.shopId, 'shopId') },
      }))
    },

    async fieldList (input: { shopId: SaleCustomQrShopId; itemKind: string }): Promise<SaleCustomQrFieldRow[]> {
      const shopId = shopIdOf(input?.shopId, 'shopId')
      const itemKind = textOf(input?.itemKind, 'itemKind', true)
      return fieldListOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: { shopId, itemKind },
      }))
    },

    async orderFieldList (): Promise<SaleCustomQrOrderFieldOption[]> {
      return orderFieldListOf(await request({
        url: DICT_ORDER_FIELD_URL,
        method: 'get',
        params: { type: 'order_field' },
      }))
    },

    prepareCreate (input: SaleCustomQrCreateForm): SaleCustomQrFormPreparation {
      const form = objectOf(input?.form, '二维码字段新建表单')
      return { draft: formPayloadOf(form, 'create', input?.usedSort) }
    },

    async create (input: { draft: SaleCustomQrDraft }): Promise<void> {
      const draft = createDraftOf(input?.draft)
      await request({ url: `${ROOT}/save`, method: 'post', data: requestDataOf(draft), headers: FORM_HEADERS })
    },

    prepareUpdate (input: SaleCustomQrUpdateForm): SaleCustomQrUpdatePreparation {
      return { draft: updateFormPayloadOf(input) }
    },

    async update (input: { draft: SaleCustomQrUpdateDraft }): Promise<void> {
      const draft = updateDraftOf(input?.draft)
      await request({ url: `${ROOT}/save`, method: 'post', data: requestDataOf(draft), headers: FORM_HEADERS })
    },

    prepareRemove (input: { id: SaleCustomQrId }): SaleCustomQrRemovePreparation {
      return { id: idOf(input?.id, '二维码字段ID') }
    },

    async remove (input: { id: SaleCustomQrId }): Promise<void> {
      await request({ url: `${ROOT}/${idOf(input?.id, '二维码字段ID')}`, method: 'delete' })
    },
  }
}

export type SaleCustomQrCapability = ReturnType<typeof createSaleCustomQrCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal字段弹窗表单；shopId/itemKind/field/sort来自当前页面上下文，编辑还必须带当前行id')
const usedSortParam = p('usedSort', 'text', false, '当前字段列表中已占用的正整数排序；编辑时应排除当前行的sort')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate返回的草稿；必须原样交给对应保存能力')

export const SALE_CUSTOM_QR_METHODS = {
  'sale-custom-qr-supplier-list': 'supplierList',
  'sale-custom-qr-item-kind-list': 'itemKindList',
  'sale-custom-qr-field-list': 'fieldList',
  'sale-custom-qr-order-field-list': 'orderFieldList',
  'sale-custom-qr-prepare-create': 'prepareCreate',
  'sale-custom-qr-create': 'create',
  'sale-custom-qr-prepare-update': 'prepareUpdate',
  'sale-custom-qr-update': 'update',
  'sale-custom-qr-prepare-remove': 'prepareRemove',
  'sale-custom-qr-remove': 'remove',
} as const

export const saleCustomQrCapabilities: CapabilityDefinition[] = [
  { id: 'sale-custom-qr-supplier-list', title: '查询二维码供应商店铺', write: false, params: [p('tenantName', 'text', false, '供应商名称模糊筛选；空字符串不筛选'), p('pageNo', 'number', false, '从1开始的供应商分页页码'), p('pageSize', 'number', false, '供应商分页大小；页面默认20，接受10/20/50/100')] },
  { id: 'sale-custom-qr-item-kind-list', title: '查询店铺商品分类配置', write: false, params: [p('shopId', 'number', false, '从供应商列表行取得的店铺shopId；省略或null时由CRM Java按当前用户租户回退')] },
  { id: 'sale-custom-qr-field-list', title: '查询商品分类引种证明字段', write: false, params: [p('shopId', 'number', true, '从供应商列表行取得的店铺shopId'), p('itemKind', 'text', true, '从商品分类列表行取得的商品分类字典值itemKind')] },
  { id: 'sale-custom-qr-order-field-list', title: '查询引种证明字段字典', write: false, params: [] },
  { id: 'sale-custom-qr-prepare-create', title: '准备新建引种证明字段', write: false, params: [formParam, usedSortParam] },
  { id: 'sale-custom-qr-create', title: '新建引种证明字段', write: true, params: [draftParam] },
  { id: 'sale-custom-qr-prepare-update', title: '准备编辑引种证明字段', write: false, params: [formParam, p('currentField', 'text', true, '当前列表行原始field；用于复现编辑弹窗的字段不可编辑规则'), usedSortParam] },
  { id: 'sale-custom-qr-update', title: '编辑引种证明字段排序', write: true, params: [draftParam] },
  { id: 'sale-custom-qr-prepare-remove', title: '准备删除引种证明字段', write: false, params: [p('id', 'text', true, '从当前字段列表行取得的字段记录ID')] },
  { id: 'sale-custom-qr-remove', title: '删除引种证明字段', write: true, params: [p('id', 'text', true, '从当前字段列表行取得的字段记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_CUSTOM_QR_PAGE_PATH,
  permission: SALE_CUSTOM_QR_PERMISSION,
  moduleType: SALE_CUSTOM_QR_MODULE_TYPE,
  httpInstance: 'crm',
}))
