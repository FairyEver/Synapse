import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 收款账号。 */
export const SALE_PAYMENT_ACCOUNT_PAGE_PATH = '/dashboard/sale/order/payment-account/list'
export const SALE_PAYMENT_ACCOUNT_PERMISSION = '/dashboard/sale/frame/order/payment-account'
export const SALE_PAYMENT_ACCOUNT_CREATE_PERMISSION = 'sale:order:payment-account:create'
export const SALE_PAYMENT_ACCOUNT_EDIT_PERMISSION = 'sale:order:payment-account:edit'
export const SALE_PAYMENT_ACCOUNT_DELETE_PERMISSION = 'sale:order:payment-account:delete'
export const SALE_PAYMENT_ACCOUNT_MODULE_TYPE = 60

const ROOT = '/admin-api/sales/ccb-account'
const ORGANIZATION_TREE_URL = '/admin-api/sales/organization/tree'
const CATEGORY_TREE_URL = '/sys/categoryCat/getTree'
const BANK_BRANCH_LIST_URL = '/admin-api/sales/manual-order/get-bank-branch-list'
const BANK_LIST_URL = '/admin-api/sales/manual-order/get-bank-list'
const BANK_ACCOUNT_LIST_URL = '/admin-api/sales/manual-order/get-bank-account-list'

export type SalePaymentAccountId = string | number
export type SalePaymentAccountScalar = string | number

export type SalePaymentAccountQuery = {
  order?: string | null
  orderField?: string | null
  pageNo?: number
  pageSize?: number
}

export type SalePaymentAccountRow = Record<string, unknown> & {
  id: SalePaymentAccountId
  officeId: SalePaymentAccountId | null
  officeName: string | null
  itemName: string | null
  itemKind: string | null
  bankName: string | null
  receiptAccountName: string | null
  receiptAccountNo: string | null
  merchantCode: string | null
  branchName: string | null
  instCode: string | null
  branchInstCode: string | null
  publicKey: string | null
  creator: SalePaymentAccountId | null
  createTime: string | number | null
  updater: SalePaymentAccountId | null
  updaterName: string | null
  updateTime: string | number | null
  deleted: boolean | null
  tenantId: SalePaymentAccountId | null
}

export type SalePaymentAccountDetail = SalePaymentAccountRow & {
  itemKindCode: string[]
}

export type SalePaymentAccountOrganizationNode = Record<string, unknown> & {
  id: SalePaymentAccountId
  name: string
  salesType: number | null
  disabled: boolean
  children: SalePaymentAccountOrganizationNode[]
}

export type SalePaymentAccountCategoryNode = Record<string, unknown> & {
  catId: SalePaymentAccountId
  catName: string
  level: string | null
  lv2: SalePaymentAccountCategoryNode[]
  lv3: SalePaymentAccountCategoryNode[]
}

export type SalePaymentAccountBankOption = Record<string, unknown> & {
  bank: number | null
  bankName: string | null
}

export type SalePaymentAccountForm = {
  id?: SalePaymentAccountId | null
  officeId?: SalePaymentAccountScalar | null
  itemKindCode?: SalePaymentAccountScalar[] | null
  merchantCode?: string | null
  receiptAccountName?: string | null
  bankName?: string | null
  receiptAccountNo?: string | null
  instCode?: string | null
  branchName?: string | null
  branchInstCode?: string | null
  publicKey?: string | null
  office?: Record<string, unknown> | null
  createDate?: string | number | null
  updateDate?: string | number | null
}

export type SalePaymentAccountUpdateForm = SalePaymentAccountForm & { id: SalePaymentAccountId }

type SalePaymentAccountSaveFields = {
  officeId: SalePaymentAccountScalar
  itemKind: string
  merchantCode: string
  receiptAccountName: string
  bankName: string
  receiptAccountNo: string
  instCode: string
  branchName: string
  branchInstCode: string
  publicKey: string
}

export type SalePaymentAccountCreateDraft = SalePaymentAccountSaveFields
export type SalePaymentAccountUpdateDraft = SalePaymentAccountSaveFields & { id: SalePaymentAccountId }
export type SalePaymentAccountCreatePreparation = { draft: SalePaymentAccountCreateDraft }
export type SalePaymentAccountUpdatePreparation = { draft: SalePaymentAccountUpdateDraft }
export type SalePaymentAccountRemovePreparation = { id: SalePaymentAccountId }
export type SalePaymentAccountOrganizationQuery = { organizationId?: SalePaymentAccountId | null }
export type SalePaymentAccountBankQuery = { organizationId?: SalePaymentAccountId | null; bankBranch?: string | null }
export type SalePaymentAccountBankAccountQuery = { organizationId?: SalePaymentAccountId | null; bank?: SalePaymentAccountScalar | null; bankBranch?: string | null }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SalePaymentAccountId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function nullableIdOf (value: unknown, label: string): SalePaymentAccountId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function scalarOf (value: unknown, label: string): SalePaymentAccountScalar {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须是非空字符串或安全整数`)
}

function optionalScalarOf (value: unknown, label: string): SalePaymentAccountScalar | '' {
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
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数`)
  return value as number
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function booleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值或null`)
  return value
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) throw new Error('pageSize必须是10、20、50或100')
  return result
}

function itemKindCodesOf (value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('itemKindCode必填且至少选择一项')
  return value.map((item, index) => String(scalarOf(item, `itemKindCode[${index}]`)))
}

function saveFieldsOf (input: unknown, label: string): SalePaymentAccountSaveFields {
  const form = objectOf(input, label)
  const officeId = idOf(form.officeId, 'officeId')
  const itemKindCode = itemKindCodesOf(form.itemKindCode)
  return {
    officeId,
    itemKind: itemKindCode.join(','),
    merchantCode: textOf(form.merchantCode, 'merchantCode'),
    receiptAccountName: textOf(form.receiptAccountName, 'receiptAccountName', true),
    bankName: textOf(form.bankName, 'bankName', true),
    receiptAccountNo: textOf(form.receiptAccountNo, 'receiptAccountNo', true),
    instCode: textOf(form.instCode, 'instCode'),
    branchName: textOf(form.branchName, 'branchName'),
    branchInstCode: textOf(form.branchInstCode, 'branchInstCode'),
    publicKey: textOf(form.publicKey, 'publicKey'),
  }
}

function createDraftOf (input: unknown): SalePaymentAccountCreateDraft {
  const form = objectOf(input, '收款账号新建草稿')
  if (form.id !== undefined && form.id !== null && form.id !== '') throw new Error('新建收款账号不能带已有id')
  return draftFieldsOf(form, '收款账号新建草稿')
}

function updateDraftOf (input: unknown): SalePaymentAccountUpdateDraft {
  const form = objectOf(input, '收款账号编辑草稿')
  return { id: idOf(form.id, '收款账号ID'), ...draftFieldsOf(form, '收款账号编辑草稿') }
}

function draftFieldsOf (input: Record<string, unknown>, label: string): SalePaymentAccountSaveFields {
  return {
    officeId: idOf(input.officeId, `${label}.officeId`),
    itemKind: textOf(input.itemKind, `${label}.itemKind`, true),
    merchantCode: textOf(input.merchantCode, `${label}.merchantCode`),
    receiptAccountName: textOf(input.receiptAccountName, `${label}.receiptAccountName`, true),
    bankName: textOf(input.bankName, `${label}.bankName`, true),
    receiptAccountNo: textOf(input.receiptAccountNo, `${label}.receiptAccountNo`, true),
    instCode: textOf(input.instCode, `${label}.instCode`),
    branchName: textOf(input.branchName, `${label}.branchName`),
    branchInstCode: textOf(input.branchInstCode, `${label}.branchInstCode`),
    publicKey: textOf(input.publicKey, `${label}.publicKey`),
  }
}

function formOf (input: unknown, mode: 'create' | 'update'): SalePaymentAccountCreateDraft | SalePaymentAccountUpdateDraft {
  return mode === 'create' ? saveFieldsOf(input, '收款账号新建表单') : { id: idOf(objectOf(input, '收款账号编辑表单').id, '收款账号ID'), ...saveFieldsOf(input, '收款账号编辑表单') }
}

function rowOf (value: unknown, label: string): SalePaymentAccountRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    officeId: nullableIdOf(row.officeId, `${label}.officeId`),
    officeName: nullableTextOf(row.officeName, `${label}.officeName`),
    itemName: nullableTextOf(row.itemName, `${label}.itemName`),
    itemKind: nullableTextOf(row.itemKind, `${label}.itemKind`),
    bankName: nullableTextOf(row.bankName, `${label}.bankName`),
    receiptAccountName: nullableTextOf(row.receiptAccountName, `${label}.receiptAccountName`),
    receiptAccountNo: nullableTextOf(row.receiptAccountNo, `${label}.receiptAccountNo`),
    merchantCode: nullableTextOf(row.merchantCode, `${label}.merchantCode`),
    branchName: nullableTextOf(row.branchName, `${label}.branchName`),
    instCode: nullableTextOf(row.instCode, `${label}.instCode`),
    branchInstCode: nullableTextOf(row.branchInstCode, `${label}.branchInstCode`),
    publicKey: nullableTextOf(row.publicKey, `${label}.publicKey`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updater: nullableIdOf(row.updater, `${label}.updater`),
    updaterName: nullableTextOf(row.updaterName, `${label}.updaterName`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
    deleted: booleanOf(row.deleted, `${label}.deleted`),
    tenantId: nullableIdOf(row.tenantId, `${label}.tenantId`),
  }
}

function pageOf (value: unknown): PageResult<SalePaymentAccountRow> {
  const page = objectOf(value, '收款账号分页响应')
  if (!Array.isArray(page.list)) throw new Error('收款账号分页响应缺少list数组')
  if (!Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('收款账号分页响应缺少有效total')
  return { list: page.list.map((item, index) => rowOf(item, `收款账号列表[${index}]`)), total: page.total as number }
}

function detailOf (value: unknown): SalePaymentAccountDetail {
  const row = rowOf(value, '收款账号详情')
  const itemKindCode = row.itemKind ? row.itemKind.split(',') : []
  return { ...row, itemKindCode }
}

function organizationNodeOf (value: unknown, label: string): SalePaymentAccountOrganizationNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const salesType = nullableIntegerOf(node.salesType, `${label}.salesType`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: textOf(node.name, `${label}.name`, true),
    salesType,
    disabled: ![0, 1].includes(Number(node.salesType)),
    children: children.map((child, index) => organizationNodeOf(child, `${label}.children[${index}]`)),
  }
}

function categoryNodeOf (value: unknown, label: string): SalePaymentAccountCategoryNode {
  const node = objectOf(value, label)
  const lv2 = node.lv2 === undefined || node.lv2 === null ? [] : node.lv2
  const lv3 = node.lv3 === undefined || node.lv3 === null ? [] : node.lv3
  if (!Array.isArray(lv2) || !Array.isArray(lv3)) throw new Error(`${label}.lv2和lv3必须是数组`)
  return {
    ...node,
    catId: idOf(node.catId, `${label}.catId`),
    catName: textOf(node.catName, `${label}.catName`, true),
    level: nullableTextOf(node.level, `${label}.level`),
    lv2: lv2.map((child, index) => categoryNodeOf(child, `${label}.lv2[${index}]`)),
    lv3: lv3.map((child, index) => categoryNodeOf(child, `${label}.lv3[${index}]`)),
  }
}

function stringListOf (value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => textOf(item, `${label}[${index}]`, true))
}

function bankListOf (value: unknown): SalePaymentAccountBankOption[] {
  if (!Array.isArray(value)) throw new Error('收款账号银行候选响应必须是数组')
  return value.map((item, index) => {
    const bank = objectOf(item, `收款账号银行候选[${index}]`)
    return {
      ...bank,
      bank: nullableIntegerOf(bank.bank, `收款账号银行候选[${index}].bank`),
      bankName: nullableTextOf(bank.bankName, `收款账号银行候选[${index}].bankName`),
    }
  })
}

function optionalOrganizationIdOf (value: unknown, label: string): SalePaymentAccountId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

export function createSalePaymentAccountCapability (request: PortalRequest) {
  return {
    async list (query: SalePaymentAccountQuery = {}): Promise<PageResult<SalePaymentAccountRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
        httpInstance: 'platform',
      }))
    },

    async organizationTree (): Promise<SalePaymentAccountOrganizationNode[]> {
      const result = await request({ url: ORGANIZATION_TREE_URL, method: 'get', params: { salesTypeMax: '1' }, httpInstance: 'platform' })
      if (!Array.isArray(result)) throw new Error('收款账号组织树响应必须是数组')
      return result.map((item, index) => organizationNodeOf(item, `收款账号组织树[${index}]`))
    },

    async categoryTree (): Promise<SalePaymentAccountCategoryNode[]> {
      const result = await request({ url: CATEGORY_TREE_URL, method: 'get', httpInstance: 'platform-mall-admin' })
      if (!Array.isArray(result)) throw new Error('收款账号品类树响应必须是数组')
      return result.map((item, index) => categoryNodeOf(item, `收款账号品类树[${index}]`))
    },

    async bankBranchList (input: SalePaymentAccountOrganizationQuery = {}): Promise<string[]> {
      const organizationId = optionalOrganizationIdOf(input?.organizationId, 'organizationId')
      if (organizationId === null) return []
      return stringListOf(await request({ url: BANK_BRANCH_LIST_URL, method: 'get', params: { organizationId }, httpInstance: 'platform' }), '开户行候选')
    },

    async bankList (input: SalePaymentAccountBankQuery = {}): Promise<SalePaymentAccountBankOption[]> {
      const organizationId = optionalOrganizationIdOf(input?.organizationId, 'organizationId')
      const bankBranch = input?.bankBranch === undefined || input.bankBranch === null ? '' : textOf(input.bankBranch, 'bankBranch')
      if (organizationId === null || !bankBranch) return []
      return bankListOf(await request({ url: BANK_LIST_URL, method: 'get', params: { organizationId, bankBranch }, httpInstance: 'platform' }))
    },

    async bankAccountList (input: SalePaymentAccountBankAccountQuery = {}): Promise<string[]> {
      const organizationId = optionalOrganizationIdOf(input?.organizationId, 'organizationId')
      const bankBranch = input?.bankBranch === undefined || input.bankBranch === null ? '' : textOf(input.bankBranch, 'bankBranch')
      const bank = input?.bank === undefined || input.bank === null || input.bank === '' ? null : scalarOf(input.bank, 'bank')
      if (organizationId === null || !bankBranch || bank === null) return []
      return stringListOf(await request({ url: BANK_ACCOUNT_LIST_URL, method: 'get', params: { organizationId, bank, bankBranch }, httpInstance: 'platform' }), '收款账号候选')
    },

    async get (input: { id: SalePaymentAccountId }): Promise<SalePaymentAccountDetail> {
      const id = idOf(input?.id, '收款账号ID')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id }, httpInstance: 'platform' }))
    },

    prepareCreate (input: { form: Partial<SalePaymentAccountForm> }): SalePaymentAccountCreatePreparation {
      return { draft: formOf(input?.form, 'create') as SalePaymentAccountCreateDraft }
    },

    async create (input: { draft: SalePaymentAccountCreateDraft }): Promise<SalePaymentAccountId> {
      const result = await request({ url: `${ROOT}/create`, method: 'post', data: createDraftOf(input?.draft), httpInstance: 'platform' })
      return idOf(result, '新建收款账号返回的id')
    },

    prepareUpdate (input: { form: SalePaymentAccountUpdateForm }): SalePaymentAccountUpdatePreparation {
      return { draft: formOf(input?.form, 'update') as SalePaymentAccountUpdateDraft }
    },

    async update (input: { draft: SalePaymentAccountUpdateDraft }): Promise<void> {
      const draft = updateDraftOf(input?.draft)
      const result = await request({ url: `${ROOT}/update`, method: 'put', data: draft, httpInstance: 'platform' })
      if (result !== true) throw new Error('编辑收款账号响应不是true')
    },

    prepareRemove (input: { id: SalePaymentAccountId }): SalePaymentAccountRemovePreparation {
      return { id: idOf(input?.id, '收款账号ID') }
    },

    async remove (input: { id: SalePaymentAccountId }): Promise<void> {
      const id = idOf(input?.id, '收款账号ID')
      const result = await request({ url: `${ROOT}/delete`, method: 'delete', params: { id }, httpInstance: 'platform' })
      if (result !== true) throw new Error('删除收款账号响应不是true')
    },
  }
}

export type SalePaymentAccountCapability = ReturnType<typeof createSalePaymentAccountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal收款账号编辑页的完整表单；新建不带id，编辑必须带当前记录id；itemKindCode是品类value数组')
const createDraftParam = p('draft', 'text', true, 'prepareCreate返回的草稿；已移除id、office、日期字段并将itemKindCode转换为逗号字符串itemKind')
const updateDraftParam = p('draft', 'text', true, 'prepareUpdate返回的草稿；包含当前记录id，已将itemKindCode转换为逗号字符串itemKind')

export const SALE_PAYMENT_ACCOUNT_METHODS = {
  'sale-payment-account-list': 'list',
  'sale-payment-account-organization-tree': 'organizationTree',
  'sale-payment-account-category-tree': 'categoryTree',
  'sale-payment-account-bank-branch-list': 'bankBranchList',
  'sale-payment-account-bank-list': 'bankList',
  'sale-payment-account-bank-account-list': 'bankAccountList',
  'sale-payment-account-get': 'get',
  'sale-payment-account-prepare-create': 'prepareCreate',
  'sale-payment-account-create': 'create',
  'sale-payment-account-prepare-update': 'prepareUpdate',
  'sale-payment-account-update': 'update',
  'sale-payment-account-prepare-remove': 'prepareRemove',
  'sale-payment-account-remove': 'remove',
} as const

export const salePaymentAccountCapabilities: CapabilityDefinition[] = [
  { id: 'sale-payment-account-list', title: '查询收款账号', write: false, params: [p('order', 'text', false, 'Portal公共列表排序值；页面默认空字符串且没有排序控件'), p('orderField', 'text', false, 'Portal公共列表排序字段；页面默认空字符串且没有排序控件'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-payment-account-organization-tree', title: '查询收款账号公司树', write: false, params: [] },
  { id: 'sale-payment-account-category-tree', title: '查询收款账号品类树', write: false, params: [] },
  { id: 'sale-payment-account-bank-branch-list', title: '查询收款账号开户行候选', write: false, params: [p('organizationId', 'text', false, '已选择的公司ID；未选择时Portal不发请求并返回空数组')] },
  { id: 'sale-payment-account-bank-list', title: '查询收款账号银行候选', write: false, params: [p('organizationId', 'text', false, '已选择的公司ID'), p('bankBranch', 'text', false, '已输入或选择的开户行；任一前置值为空时Portal返回空数组')] },
  { id: 'sale-payment-account-bank-account-list', title: '查询收款账号候选', write: false, params: [p('organizationId', 'text', false, '已选择的公司ID'), p('bank', 'text', false, 'bank-list返回的银行编码'), p('bankBranch', 'text', false, '已输入或选择的开户行')] },
  { id: 'sale-payment-account-get', title: '读取收款账号详情', write: false, params: [p('id', 'text', true, '当前列表记录ID')] },
  { id: 'sale-payment-account-prepare-create', title: '准备新建收款账号', write: false, params: [formParam] },
  { id: 'sale-payment-account-create', title: '新建收款账号', write: true, params: [createDraftParam] },
  { id: 'sale-payment-account-prepare-update', title: '准备编辑收款账号', write: false, params: [formParam] },
  { id: 'sale-payment-account-update', title: '编辑收款账号', write: true, params: [updateDraftParam] },
  { id: 'sale-payment-account-prepare-remove', title: '准备删除收款账号', write: false, params: [p('id', 'text', true, '当前列表记录ID')] },
  { id: 'sale-payment-account-remove', title: '删除收款账号', write: true, params: [p('id', 'text', true, '当前列表记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_PAYMENT_ACCOUNT_PAGE_PATH,
  permission: SALE_PAYMENT_ACCOUNT_PERMISSION,
  moduleType: SALE_PAYMENT_ACCOUNT_MODULE_TYPE,
  httpInstance: definition.id === 'sale-payment-account-category-tree' ? 'platform-mall-admin' : 'platform',
}))
