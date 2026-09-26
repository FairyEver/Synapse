import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 理赔配置及其可达的理赔原因维护页。 */
export const SALE_CLAIM_SETTING_PAGE_PATH = '/dashboard/sale/setting/claim-setting/list'
export const SALE_CLAIM_SETTING_PERMISSION = '/dashboard/sale/setting/claim-setting'
export const SALE_CLAIM_SETTING_CREATE_PERMISSION = 'setting:claim-setting:create'
export const SALE_CLAIM_SETTING_EDIT_PERMISSION = 'setting:claim-setting:edit'
export const SALE_CLAIM_SETTING_REASON_PERMISSION = 'setting:claim-setting:reason-maintain'
export const SALE_CLAIM_SETTING_DELETE_PERMISSION = 'setting:claim-setting:delete'
export const SALE_CLAIM_SETTING_MODULE_TYPE = 60

const ROOT = '/admin-api/claim/claim-config'
const REASON_ROOT = '/admin-api/claim/claim-reason'

export type SaleClaimSettingId = string | number
export type SaleClaimType = number
export type SaleClaimCategoryId = string | number

export type SaleClaimSettingQuery = {
  pageNo?: number
  pageSize?: number
}

export type SaleClaimSettingRow = Record<string, unknown> & {
  id: SaleClaimSettingId
  claimType: SaleClaimType | null
  categoryId: string | null
  categoryName: string | null
  startDays: number | null
  endDays: number | null
}

export type SaleClaimSettingDetail = Omit<SaleClaimSettingRow, 'categoryId'> & {
  /** Portal customLoad 已将后端逗号字符串转换为表单数组。 */
  categoryId: SaleClaimCategoryId[]
}

export type SaleClaimCategoryNode = Record<string, unknown> & {
  type: string | null
  catId: number
  parentId: number | null
  catName: string | null
  level: number | null
  label: string | null
  value: number | null
  key: number
  children: SaleClaimCategoryNode[]
}

export type SaleClaimSettingForm = {
  id?: SaleClaimSettingId | null
  claimType?: SaleClaimType | null
  categoryId?: SaleClaimCategoryId[] | null
  startDays?: number | null
  endDays?: number | null
}

export type SaleClaimSettingUpdateForm = SaleClaimSettingForm & { id: SaleClaimSettingId }

export type SaleClaimSettingDraft = {
  claimType: SaleClaimType
  categoryId: string
  startDays: number | null
  endDays: number | null
}

export type SaleClaimSettingUpdateDraft = SaleClaimSettingDraft & { id: SaleClaimSettingId }
export type SaleClaimSettingFormPreparation = { draft: SaleClaimSettingDraft }
export type SaleClaimSettingUpdatePreparation = { draft: SaleClaimSettingUpdateDraft }
export type SaleClaimSettingRemovePreparation = { id: SaleClaimSettingId }

export type SaleClaimReason = Record<string, unknown> & {
  id: SaleClaimSettingId | null
  content: string
}

export type SaleClaimReasonInput = {
  id?: SaleClaimSettingId | null
  content?: string | null
}

export type SaleClaimReasonDraft = {
  claimConfigId: SaleClaimSettingId
  claimType: SaleClaimType
  reasons: SaleClaimReason[]
}

export type SaleClaimReasonPreparation = { draft: SaleClaimReasonDraft }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleClaimSettingId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须是正整数字符串或安全正整数`)
}

function nullableIdOf (value: unknown, label: string): SaleClaimSettingId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label}必须是正整数`)
  return value as number
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是整数或null`)
  return value as number
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  return value
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function dayOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 999) throw new Error(`${label}必须是0到999的整数或null`)
  return value as number
}

function categoryIdOf (value: unknown, label: string): SaleClaimCategoryId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须是正整数字符串或安全正整数`)
}

function categoryIdsOf (value: unknown, label: string): SaleClaimCategoryId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => categoryIdOf(item, `${label}[${index}]`))
}

function formatCategoryIds (value: unknown, label: string): string {
  return categoryIdsOf(value, label).map(item => String(item)).join(',')
}

function parseCategoryIds (value: unknown, label: string): SaleClaimCategoryId[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return categoryIdsOf(value, label)
  if (typeof value !== 'string') throw new Error(`${label}必须是逗号分隔字符串或数组`)
  return value.split(',').filter(item => item !== '').map((item, index) => categoryIdOf(Number(item), `${label}[${index}]`))
}

function claimTypeOf (value: unknown, label: string): SaleClaimType {
  return integerOf(value, label)
}

function rowOf (value: unknown, label: string): SaleClaimSettingRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    claimType: row.claimType === undefined || row.claimType === null ? null : integerOf(row.claimType, `${label}.claimType`),
    categoryId: nullableTextOf(row.categoryId, `${label}.categoryId`),
    categoryName: nullableTextOf(row.categoryName, `${label}.categoryName`),
    startDays: nullableIntegerOf(row.startDays, `${label}.startDays`),
    endDays: nullableIntegerOf(row.endDays, `${label}.endDays`),
  }
}

function detailOf (value: unknown): SaleClaimSettingDetail {
  const row = rowOf(value, '理赔配置详情')
  return {
    ...row,
    categoryId: parseCategoryIds(row.categoryId, '理赔配置详情.categoryId'),
  }
}

function pageOf (value: unknown): PageResult<SaleClaimSettingRow> {
  const page = objectOf(value, '理赔配置分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('理赔配置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `理赔配置列表[${index}]`)), total: page.total as number }
}

function categoryNodeOf (value: unknown, label: string): SaleClaimCategoryNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const catId = integerOf(node.catId, `${label}.catId`)
  return {
    ...node,
    type: nullableTextOf(node.type, `${label}.type`),
    catId,
    parentId: nullableIntegerOf(node.parentId, `${label}.parentId`),
    catName: nullableTextOf(node.catName, `${label}.catName`),
    level: nullableIntegerOf(node.level, `${label}.level`),
    label: nullableTextOf(node.label, `${label}.label`),
    value: node.value === undefined || node.value === null ? null : integerOf(node.value, `${label}.value`),
    key: catId,
    children: children.map((child, index) => categoryNodeOf(child, `${label}.children[${index}]`)),
  }
}

function formPayloadOf (input: unknown, mode: 'create' | 'update'): SaleClaimSettingDraft | SaleClaimSettingUpdateDraft {
  const form = objectOf(input, '理赔配置表单')
  const claimType = claimTypeOf(form.claimType, 'claimType')
  const categoryId = formatCategoryIds(form.categoryId, 'categoryId')
  const startDays = dayOf(form.startDays, 'startDays')
  const endDays = dayOf(form.endDays, 'endDays')
  if (endDays !== null && endDays < 1) throw new Error('endDays必须大于等于1')
  if (startDays !== null && endDays !== null && endDays <= startDays) throw new Error('理赔结束时间必须大于理赔开始时间')
  const payload: SaleClaimSettingDraft = { claimType, categoryId, startDays, endDays }
  if (mode === 'update') return { id: idOf(form.id, '理赔配置ID'), ...payload }
  return payload
}

function draftOf (input: unknown, mode: 'create' | 'update'): SaleClaimSettingDraft | SaleClaimSettingUpdateDraft {
  const draft = objectOf(input, '理赔配置提交草稿')
  const claimType = claimTypeOf(draft.claimType, 'claimType')
  const categoryId = textOf(draft.categoryId, 'categoryId')
  const startDays = dayOf(draft.startDays, 'startDays')
  const endDays = dayOf(draft.endDays, 'endDays')
  if (endDays !== null && endDays < 1) throw new Error('endDays必须大于等于1')
  if (startDays !== null && endDays !== null && endDays <= startDays) throw new Error('理赔结束时间必须大于理赔开始时间')
  const payload: SaleClaimSettingDraft = { claimType, categoryId, startDays, endDays }
  if (mode === 'update') return { id: idOf(draft.id, '理赔配置ID'), ...payload }
  return payload
}

function removePreparationOf (input: unknown): SaleClaimSettingRemovePreparation {
  const value = objectOf(input, '理赔配置删除操作')
  return { id: idOf(value.id, '理赔配置ID') }
}

function reasonOf (value: unknown, label: string): SaleClaimReason {
  const reason = objectOf(value, label)
  const content = textOf(reason.content, `${label}.content`)
  if (content.trim() === '') throw new Error(`${label}.content不能为空`)
  if (content.length > 50) throw new Error(`${label}.content长度不能超过50`)
  return { ...reason, id: nullableIdOf(reason.id, `${label}.id`), content }
}

function reasonDraftOf (input: unknown): SaleClaimReasonDraft {
  const value = objectOf(input, '理赔原因保存操作')
  const claimConfigId = idOf(value.claimConfigId, 'claimConfigId')
  const claimType = claimTypeOf(value.claimType, 'claimType')
  if (!Array.isArray(value.reasons) || value.reasons.length < 1 || value.reasons.length > 20) throw new Error('reasons必须是1到20条')
  const reasons = value.reasons.map((item, index) => reasonOf(item, `reasons[${index}]`))
  const contents = new Set(reasons.map(item => item.content))
  if (contents.size !== reasons.length) throw new Error('reasons不能有重复原因')
  return { claimConfigId, claimType, reasons }
}

function reasonsOf (value: unknown): SaleClaimReason[] {
  const list = Array.isArray(value) ? value : objectOf(value, '理赔原因列表响应').list
  if (!Array.isArray(list)) throw new Error('理赔原因列表响应必须是数组')
  return list.map((item, index) => {
    const reason = objectOf(item, `理赔原因列表[${index}]`)
    return { ...reason, id: nullableIdOf(reason.id, `理赔原因列表[${index}].id`), content: typeof reason.content === 'string' ? reason.content : '' }
  })
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be bound to SALE_CLAIM_SETTING_PAGE_PATH. */
export function createSaleClaimSettingCapability (request: PortalRequest) {
  return {
    async list (query: SaleClaimSettingQuery = {}): Promise<PageResult<SaleClaimSettingRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'post',
        data: {
          order: '',
          orderField: '',
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },

    async get (input: { id: SaleClaimSettingId }): Promise<SaleClaimSettingDetail> {
      const id = idOf(input?.id, '理赔配置ID')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },

    async categoryList (input: { claimType?: SaleClaimType | null } = {}): Promise<SaleClaimCategoryNode[]> {
      if (input.claimType === undefined || input.claimType === null) return []
      const claimType = claimTypeOf(input.claimType, 'claimType')
      const result = await request({ url: `${ROOT}/categories`, method: 'get', params: { claimType } })
      if (!Array.isArray(result)) throw new Error('理赔品类响应必须是数组')
      return result.map((item, index) => categoryNodeOf(item, `理赔品类树[${index}]`))
    },

    async reasonList (input: { claimType: SaleClaimType }): Promise<SaleClaimReason[]> {
      const claimType = claimTypeOf(input?.claimType, 'claimType')
      return reasonsOf(await request({ url: `${REASON_ROOT}/list`, method: 'get', params: { claimType } }))
    },

    prepareCreate (input: { form: Partial<SaleClaimSettingForm> }): SaleClaimSettingFormPreparation {
      return { draft: formPayloadOf(input?.form, 'create') as SaleClaimSettingDraft }
    },

    async create (input: { draft: SaleClaimSettingDraft }): Promise<true> {
      return trueResult(await request({ url: `${ROOT}/create`, method: 'post', data: draftOf(input?.draft, 'create') }), '新建理赔配置')
    },

    prepareUpdate (input: { form: SaleClaimSettingUpdateForm }): SaleClaimSettingUpdatePreparation {
      return { draft: formPayloadOf(input?.form, 'update') as SaleClaimSettingUpdateDraft }
    },

    async update (input: { draft: SaleClaimSettingUpdateDraft }): Promise<true> {
      return trueResult(await request({ url: `${ROOT}/update`, method: 'put', data: draftOf(input?.draft, 'update') }), '编辑理赔配置')
    },

    prepareRemove (input: { id: SaleClaimSettingId }): SaleClaimSettingRemovePreparation {
      return removePreparationOf(input)
    },

    async remove (input: SaleClaimSettingRemovePreparation): Promise<true> {
      const draft = removePreparationOf(input)
      return trueResult(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: draft.id } }), '删除理赔配置')
    },

    prepareSaveReasons (input: { claimConfigId: SaleClaimSettingId; claimType: SaleClaimType; reasons: SaleClaimReasonInput[] }): SaleClaimReasonPreparation {
      return { draft: reasonDraftOf(input) }
    },

    async saveReasons (input: { draft: SaleClaimReasonDraft }): Promise<true> {
      return trueResult(await request({ url: `${REASON_ROOT}/save`, method: 'post', data: reasonDraftOf(input?.draft) }), '保存理赔原因')
    },
  }
}

export type SaleClaimSettingCapability = ReturnType<typeof createSaleClaimSettingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal理赔配置编辑页表单；categoryId是品类ID数组')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate返回的理赔配置提交草稿')
const reasonDraftParam = p('draft', 'text', true, 'prepareSaveReasons返回的覆盖式理赔原因草稿')

export const SALE_CLAIM_SETTING_METHODS = {
  'sale-claim-setting-list': 'list',
  'sale-claim-setting-get': 'get',
  'sale-claim-setting-category-list': 'categoryList',
  'sale-claim-setting-reason-list': 'reasonList',
  'sale-claim-setting-prepare-create': 'prepareCreate',
  'sale-claim-setting-create': 'create',
  'sale-claim-setting-prepare-update': 'prepareUpdate',
  'sale-claim-setting-update': 'update',
  'sale-claim-setting-prepare-remove': 'prepareRemove',
  'sale-claim-setting-remove': 'remove',
  'sale-claim-setting-prepare-save-reasons': 'prepareSaveReasons',
  'sale-claim-setting-save-reasons': 'saveReasons',
} as const

export const saleClaimSettingCapabilities: CapabilityDefinition[] = [
  { id: 'sale-claim-setting-list', title: '查询理赔配置列表', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-claim-setting-get', title: '查询理赔配置详情', write: false, params: [p('id', 'text', true, '当前理赔配置ID')] },
  { id: 'sale-claim-setting-category-list', title: '查询理赔品类树', write: false, params: [p('claimType', 'number', false, '理赔类型；缺失时按Portal返回空数组')] },
  { id: 'sale-claim-setting-reason-list', title: '查询理赔原因', write: false, params: [p('claimType', 'number', true, '理赔类型')] },
  { id: 'sale-claim-setting-prepare-create', title: '准备新建理赔配置', write: false, params: [formParam] },
  { id: 'sale-claim-setting-create', title: '新建理赔配置', write: true, params: [draftParam] },
  { id: 'sale-claim-setting-prepare-update', title: '准备编辑理赔配置', write: false, params: [formParam] },
  { id: 'sale-claim-setting-update', title: '编辑理赔配置', write: true, params: [draftParam] },
  { id: 'sale-claim-setting-prepare-remove', title: '准备删除理赔配置', write: false, params: [p('id', 'text', true, '当前理赔配置ID')] },
  { id: 'sale-claim-setting-remove', title: '删除理赔配置', write: true, params: [p('id', 'text', true, '当前理赔配置ID')] },
  { id: 'sale-claim-setting-prepare-save-reasons', title: '准备保存理赔原因', write: false, params: [p('claimConfigId', 'text', true, '当前理赔配置ID'), p('claimType', 'number', true, '理赔类型'), p('reasons', 'text', true, '1到20条原因表单')] },
  { id: 'sale-claim-setting-save-reasons', title: '覆盖保存理赔原因', write: true, params: [reasonDraftParam] },
].map(definition => ({
  ...definition,
  pagePath: SALE_CLAIM_SETTING_PAGE_PATH,
  permission: SALE_CLAIM_SETTING_PERMISSION,
  moduleType: SALE_CLAIM_SETTING_MODULE_TYPE,
  httpInstance: 'platform',
}))
