import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 工厂管理。 */
export const SALE_TRADE_STOREROOM_PAGE_PATH = '/dashboard/sale/order/trade-storeroom/list'
export const SALE_TRADE_STOREROOM_PERMISSION = '/dashboard/sale/frame/order/trade-storeroom'
export const SALE_TRADE_STOREROOM_ACTION_PERMISSION = 'order:tradeStoreroom:edit'
export const SALE_TRADE_STOREROOM_MODULE_TYPE = 60

const ROOT = '/vue/order/tradeStoreroom'
const ORGANIZATION_TREE_URL = '/admin-api/sales/organization/tree'
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export type SaleTradeStoreroomId = string | number
export type SaleTradeStoreroomScalar = string | number
export type SaleTradeStoreroomType = string

export type SaleTradeStoreroomQuery = {
  type?: string | null
  name?: string | null
  shopName?: string | null
  factoryKind?: string | number | null
  pageNo?: number
  pageSize?: number
}

export type SaleTradeStoreroomRow = Record<string, unknown> & {
  id: SaleTradeStoreroomId
  parentId: SaleTradeStoreroomId | null
  name: string | null
  type: SaleTradeStoreroomType | null
  code: string | null
  shopId: number | null
  factoryKind: string | number | null
  belongFactory: string | null
  shopName: string | null
  companyOfficeId: SaleTradeStoreroomId | null
  companyName: string | null
  companyCode: string | null
  companyValid: boolean | null
  createDate: string | number | null
  updateDate: string | number | null
}

export type SaleTradeStoreroomSupplier = Record<string, unknown> & {
  shopId: number
  shopName: string | null
}

export type SaleTradeStoreroomCompany = Record<string, unknown> & {
  id: SaleTradeStoreroomId
  name: string
  code: string | null
  type: string | null
  valid: number | null
}

export type SaleTradeStoreroomCandidate = Record<string, unknown> & {
  id: SaleTradeStoreroomId
  name: string
  code?: string | null
}

export type SaleTradeStoreroomOrganizationNode = Record<string, unknown> & {
  id: SaleTradeStoreroomId
  name: string
  children: SaleTradeStoreroomOrganizationNode[]
}

export type SaleTradeStoreroomSelectedBase = Record<string, unknown> & {
  id: SaleTradeStoreroomId | null
  hrOrgId: SaleTradeStoreroomId
  hrOrgName: string | null
}

export type SaleTradeStoreroomForm = {
  id?: SaleTradeStoreroomId | null
  shopId?: SaleTradeStoreroomScalar | null
  code?: string | null
  factoryKind?: SaleTradeStoreroomScalar | null
  name?: string | null
  type?: SaleTradeStoreroomScalar | null
  parentId?: SaleTradeStoreroomScalar | null
  companyOfficeId?: SaleTradeStoreroomScalar | null
}

export type SaleTradeStoreroomUpdateForm = SaleTradeStoreroomForm & { id: SaleTradeStoreroomId }
export type SaleTradeStoreroomDraft = {
  id: SaleTradeStoreroomId | ''
  shopId: SaleTradeStoreroomScalar
  code: string
  factoryKind: SaleTradeStoreroomScalar
  name: string
  type: SaleTradeStoreroomScalar
  parentId: SaleTradeStoreroomScalar | ''
  companyOfficeId: SaleTradeStoreroomScalar | ''
}
export type SaleTradeStoreroomFormPreparation = { draft: SaleTradeStoreroomDraft }
export type SaleTradeStoreroomRemovePreparation = { id: SaleTradeStoreroomId; type: SaleTradeStoreroomType }
export type SaleTradeStoreroomSyncDraft = { list: string }
export type SaleTradeStoreroomSyncPreparation = { draft: SaleTradeStoreroomSyncDraft }
export type SaleTradeStoreroomCandidateQuery = { factoryKind?: SaleTradeStoreroomScalar | null; supplier?: SaleTradeStoreroomId | null }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleTradeStoreroomId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function nullableIdOf (value: unknown, label: string): SaleTradeStoreroomId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function scalarOf (value: unknown, label: string): SaleTradeStoreroomScalar {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须是非空字符串或安全整数`)
}

function optionalScalarOf (value: unknown, label: string): SaleTradeStoreroomScalar | '' {
  if (value === undefined || value === null || value === '') return ''
  return scalarOf(value, label)
}

function textOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null) {
    if (!required) return ''
    throw new Error(`${label}必填`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && value === '') throw new Error(`${label}必填`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数或null`)
  return value as number
}

function positiveIntegerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label}必须是正整数`)
  return value as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function booleanLikeOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  throw new Error(`${label}必须是布尔值或0/1`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) throw new Error('pageSize必须是10、20、50或100')
  return result
}

function rowOf (value: unknown, label: string): SaleTradeStoreroomRow {
  const row = objectOf(value, label)
  const shopIdValue = row.shopId ?? row.shopID
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    parentId: nullableIdOf(row.parentId, `${label}.parentId`),
    name: nullableTextOf(row.name, `${label}.name`),
    type: nullableTextOf(row.type, `${label}.type`),
    code: nullableTextOf(row.code, `${label}.code`),
    shopId: nullableIntegerOf(shopIdValue, `${label}.shopId`),
    factoryKind: row.factoryKind === undefined || row.factoryKind === null ? null : scalarOf(row.factoryKind, `${label}.factoryKind`),
    belongFactory: nullableTextOf(row.belongFactory, `${label}.belongFactory`),
    shopName: nullableTextOf(row.shopName, `${label}.shopName`),
    companyOfficeId: nullableIdOf(row.companyOfficeId, `${label}.companyOfficeId`),
    companyName: nullableTextOf(row.companyName, `${label}.companyName`),
    companyCode: nullableTextOf(row.companyCode, `${label}.companyCode`),
    companyValid: booleanLikeOf(row.companyValid, `${label}.companyValid`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
  }
}

function pageOf (value: unknown): PageResult<SaleTradeStoreroomRow> {
  const page = objectOf(value, '工厂管理分页响应')
  if (!Array.isArray(page.list)) throw new Error('工厂管理分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('工厂管理分页响应缺少有效count')
  return { list: page.list.map((item, index) => rowOf(item, `工厂管理列表[${index}]`)), total: page.count as number }
}

function supplierOf (value: unknown, label: string): SaleTradeStoreroomSupplier {
  const supplier = objectOf(value, label)
  return {
    ...supplier,
    shopId: positiveIntegerOf(supplier.shopId, `${label}.shopId`),
    shopName: nullableTextOf(supplier.shopName, `${label}.shopName`),
  }
}

function companyOf (value: unknown, label: string): SaleTradeStoreroomCompany {
  const company = objectOf(value, label)
  return {
    ...company,
    id: idOf(company.id, `${label}.id`),
    name: textOf(company.name, `${label}.name`, true),
    code: nullableTextOf(company.code, `${label}.code`),
    type: nullableTextOf(company.type, `${label}.type`),
    valid: nullableIntegerOf(company.valid, `${label}.valid`),
  }
}

function candidateOf (value: unknown, label: string, withCode = false): SaleTradeStoreroomCandidate {
  const candidate = objectOf(value, label)
  return {
    ...candidate,
    id: idOf(candidate.id, `${label}.id`),
    name: textOf(candidate.name, `${label}.name`, true),
    ...(withCode ? { code: nullableTextOf(candidate.code, `${label}.code`) } : {}),
  }
}

function organizationNodeOf (value: unknown, label: string): SaleTradeStoreroomOrganizationNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: textOf(node.name, `${label}.name`, true),
    children: children.map((child, index) => organizationNodeOf(child, `${label}.children[${index}]`)),
  }
}

function selectedBaseOf (value: unknown, label: string): SaleTradeStoreroomSelectedBase {
  const base = objectOf(value, label)
  return {
    ...base,
    id: nullableIdOf(base.id, `${label}.id`),
    hrOrgId: idOf(base.hrOrgId, `${label}.hrOrgId`),
    hrOrgName: nullableTextOf(base.hrOrgName, `${label}.hrOrgName`),
  }
}

function requiredShopIdOf (value: unknown): SaleTradeStoreroomScalar {
  return scalarOf(value, 'shopId')
}

function formPayloadOf (input: unknown, mode: 'create' | 'update'): SaleTradeStoreroomDraft {
  const form = objectOf(input, '工厂管理表单')
  const id = mode === 'update' ? idOf(form.id, '工厂管理ID') : ''
  if (mode === 'create' && form.id !== undefined && form.id !== null && form.id !== '') throw new Error('新建工厂管理记录不能带已有id')
  const shopId = requiredShopIdOf(form.shopId)
  const code = textOf(form.code, 'code', true)
  const factoryKind = scalarOf(form.factoryKind, 'factoryKind')
  const name = textOf(form.name, 'name', true)
  const type = scalarOf(form.type, 'type')
  if (String(type) === '0' && !/^[a-zA-Z0-9]{0,30}$/.test(code)) throw new Error('type为0时code只能是最多30位数字和字母')
  const companyOfficeId = String(type) === '1' ? scalarOf(form.companyOfficeId, 'companyOfficeId') : optionalScalarOf(form.companyOfficeId, 'companyOfficeId')
  return {
    id,
    shopId,
    code,
    factoryKind,
    name,
    type,
    parentId: optionalScalarOf(form.parentId, 'parentId'),
    companyOfficeId,
  }
}

function draftOf (input: unknown, mode: 'create' | 'update'): SaleTradeStoreroomDraft {
  const draft = objectOf(input, '工厂管理提交草稿')
  return formPayloadOf(draft, mode)
}

function removePreparationOf (input: unknown): SaleTradeStoreroomRemovePreparation {
  const value = objectOf(input, '工厂管理删除操作')
  return { id: idOf(value.id, '工厂管理ID'), type: textOf(value.type, 'type', true) }
}

function syncPreparationOf (input: unknown): SaleTradeStoreroomSyncPreparation {
  const value = objectOf(input, '工厂管理基地同步操作')
  if (!Array.isArray(value.ids)) throw new Error('同步基地ids必须是数组')
  const ids = value.ids.map((item, index) => String(idOf(item, `同步基地ids[${index}]`)))
  return { draft: { list: ids.join(',') } }
}

function candidateQueryOf (input: SaleTradeStoreroomCandidateQuery | undefined, label: string): { factoryKind: SaleTradeStoreroomScalar; supplier: SaleTradeStoreroomId } | null {
  const factoryKind = optionalScalarOf(input?.factoryKind, `${label}.factoryKind`)
  const supplier = input?.supplier === undefined || input.supplier === null || input.supplier === '' ? null : idOf(input.supplier, `${label}.supplier`)
  if (factoryKind === '' || supplier === null) return null
  return { factoryKind, supplier }
}

export function createSaleTradeStoreroomCapability (request: PortalRequest) {
  return {
    async list (query: SaleTradeStoreroomQuery = {}): Promise<PageResult<SaleTradeStoreroomRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
          type: textOf(query.type === undefined || query.type === null ? '0' : query.type, 'type'),
          name: textOf(query.name, 'name'),
          shopName: textOf(query.shopName, 'shopName'),
          factoryKind: optionalScalarOf(query.factoryKind, 'factoryKind'),
        },
        headers: FORM_HEADERS,
      }))
    },

    async supplierList (): Promise<SaleTradeStoreroomSupplier[]> {
      const result = await request({ url: `${ROOT}/getSupplier`, method: 'get', params: { type: 1 }, headers: FORM_HEADERS })
      if (!Array.isArray(result)) throw new Error('工厂管理供应商响应必须是数组')
      return result.map((item, index) => supplierOf(item, `工厂管理供应商[${index}]`))
    },

    async companyList (): Promise<SaleTradeStoreroomCompany[]> {
      const result = await request({ url: `${ROOT}/companyList`, method: 'get', headers: FORM_HEADERS })
      if (!Array.isArray(result)) throw new Error('工厂管理公司响应必须是数组')
      return result.map((item, index) => companyOf(item, `工厂管理公司[${index}]`))
    },

    async factoryList (input: SaleTradeStoreroomCandidateQuery = {}): Promise<SaleTradeStoreroomCandidate[]> {
      const query = candidateQueryOf(input, '工厂候选')
      if (query === null) return []
      const result = await request({ url: `${ROOT}/findFactory`, method: 'get', params: query, headers: FORM_HEADERS })
      if (!Array.isArray(result)) throw new Error('工厂候选响应必须是数组')
      return result.map((item, index) => candidateOf(item, `工厂候选[${index}]`))
    },

    async baseList (input: SaleTradeStoreroomCandidateQuery = {}): Promise<SaleTradeStoreroomCandidate[]> {
      const query = candidateQueryOf(input, '基地候选')
      if (query === null) return []
      const result = await request({ url: `${ROOT}/findBase`, method: 'get', params: query, headers: FORM_HEADERS })
      if (!Array.isArray(result)) throw new Error('基地候选响应必须是数组')
      return result.map((item, index) => candidateOf(item, `基地候选[${index}]`, true))
    },

    async organizationTree (): Promise<SaleTradeStoreroomOrganizationNode[]> {
      const result = await request({ url: ORGANIZATION_TREE_URL, method: 'get', httpInstance: 'platform' })
      if (!Array.isArray(result)) throw new Error('工厂管理组织树响应必须是数组')
      return result.map((item, index) => organizationNodeOf(item, `工厂管理组织树[${index}]`))
    },

    async selectedBaseList (): Promise<SaleTradeStoreroomSelectedBase[]> {
      const result = await request({ url: `${ROOT}/selectShippingBaseList`, method: 'get', headers: FORM_HEADERS })
      if (!Array.isArray(result)) throw new Error('已同步基地响应必须是数组')
      return result.map((item, index) => selectedBaseOf(item, `已同步基地[${index}]`))
    },

    prepareCreate (input: { form: Partial<SaleTradeStoreroomForm> }): SaleTradeStoreroomFormPreparation {
      return { draft: formPayloadOf(input?.form, 'create') }
    },

    async create (input: { draft: SaleTradeStoreroomDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftOf(input?.draft, 'create'), headers: FORM_HEADERS })
    },

    prepareUpdate (input: { form: SaleTradeStoreroomUpdateForm }): SaleTradeStoreroomFormPreparation {
      return { draft: formPayloadOf(input?.form, 'update') }
    },

    async update (input: { draft: SaleTradeStoreroomDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftOf(input?.draft, 'update'), headers: FORM_HEADERS })
    },

    prepareRemove (input: { id: SaleTradeStoreroomId; type: SaleTradeStoreroomType }): SaleTradeStoreroomRemovePreparation {
      return removePreparationOf(input)
    },

    async remove (input: SaleTradeStoreroomRemovePreparation): Promise<void> {
      const draft = removePreparationOf(input)
      await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: draft.id, type: draft.type }, headers: FORM_HEADERS })
    },

    prepareSyncBase (input: { ids: SaleTradeStoreroomId[] }): SaleTradeStoreroomSyncPreparation {
      return syncPreparationOf(input)
    },

    async syncBase (input: { draft: SaleTradeStoreroomSyncDraft }): Promise<void> {
      const draft = syncPreparationOf({ ids: String(input?.draft?.list ?? '').split(',').filter(Boolean) })
      await request({ url: `${ROOT}/saveShippingBaseList`, method: 'post', data: draft.draft, headers: FORM_HEADERS })
    },
  }
}

export type SaleTradeStoreroomCapability = ReturnType<typeof createSaleTradeStoreroomCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal工厂管理弹窗的完整表单；新建不带已有id，编辑必须带当前行id')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate返回的提交草稿；仅包含页面实际提交字段')
const removeParam = [p('id', 'text', true, '当前列表行ID'), p('type', 'text', true, '当前列表行类型；删除接口必须同时传递')]

export const SALE_TRADE_STOREROOM_METHODS = {
  'sale-trade-storeroom-list': 'list',
  'sale-trade-storeroom-supplier-list': 'supplierList',
  'sale-trade-storeroom-company-list': 'companyList',
  'sale-trade-storeroom-factory-list': 'factoryList',
  'sale-trade-storeroom-base-list': 'baseList',
  'sale-trade-storeroom-organization-tree': 'organizationTree',
  'sale-trade-storeroom-selected-base-list': 'selectedBaseList',
  'sale-trade-storeroom-prepare-create': 'prepareCreate',
  'sale-trade-storeroom-create': 'create',
  'sale-trade-storeroom-prepare-update': 'prepareUpdate',
  'sale-trade-storeroom-update': 'update',
  'sale-trade-storeroom-prepare-remove': 'prepareRemove',
  'sale-trade-storeroom-remove': 'remove',
  'sale-trade-storeroom-prepare-sync-base': 'prepareSyncBase',
  'sale-trade-storeroom-sync-base': 'syncBase',
} as const

export const saleTradeStoreroomCapabilities: CapabilityDefinition[] = [
  { id: 'sale-trade-storeroom-list', title: '查询工厂管理列表', write: false, params: [p('type', 'text', false, '类型筛选；Portal默认0表示基地'), p('name', 'text'), p('shopName', 'text'), p('factoryKind', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-trade-storeroom-supplier-list', title: '查询工厂管理供应商', write: false, params: [] },
  { id: 'sale-trade-storeroom-company-list', title: '查询发货工厂所属公司', write: false, params: [] },
  { id: 'sale-trade-storeroom-factory-list', title: '查询所属工厂候选', write: false, params: [p('factoryKind', 'text', false, '类别字典值'), p('supplier', 'text', false, '供应商店铺ID')] },
  { id: 'sale-trade-storeroom-base-list', title: '查询所属基地候选', write: false, params: [p('factoryKind', 'text', false, '类别字典值'), p('supplier', 'text', false, '供应商店铺ID')] },
  { id: 'sale-trade-storeroom-organization-tree', title: '查询同步基地组织树', write: false, params: [] },
  { id: 'sale-trade-storeroom-selected-base-list', title: '查询已同步基地', write: false, params: [] },
  { id: 'sale-trade-storeroom-prepare-create', title: '准备新建工厂管理记录', write: false, params: [formParam] },
  { id: 'sale-trade-storeroom-create', title: '新建工厂管理记录', write: true, params: [draftParam] },
  { id: 'sale-trade-storeroom-prepare-update', title: '准备编辑工厂管理记录', write: false, params: [formParam] },
  { id: 'sale-trade-storeroom-update', title: '编辑工厂管理记录', write: true, params: [draftParam] },
  { id: 'sale-trade-storeroom-prepare-remove', title: '准备删除工厂管理记录', write: false, params: removeParam },
  { id: 'sale-trade-storeroom-remove', title: '删除工厂管理记录', write: true, params: removeParam },
  { id: 'sale-trade-storeroom-prepare-sync-base', title: '准备同步基地', write: false, params: [p('ids', 'text', true, '组织树中用户选中的基地组织ID数组')] },
  { id: 'sale-trade-storeroom-sync-base', title: '同步基地', write: true, params: [p('draft', 'text', true, 'prepareSyncBase返回的草稿；list是逗号分隔的组织ID字符串')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_TRADE_STOREROOM_PAGE_PATH,
  permission: SALE_TRADE_STOREROOM_PERMISSION,
  moduleType: SALE_TRADE_STOREROOM_MODULE_TYPE,
  httpInstance: definition.id === 'sale-trade-storeroom-organization-tree' ? 'platform' : 'crm',
}))
