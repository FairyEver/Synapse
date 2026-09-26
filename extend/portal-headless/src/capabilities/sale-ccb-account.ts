import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → SAP-收款账号。 */
export const SALE_CCB_ACCOUNT_PAGE_PATH = '/dashboard/sale/order/ccb-account/list'
export const SALE_CCB_ACCOUNT_PERMISSION = '/dashboard/sale/frame/order/ccb-account'
export const SALE_CCB_ACCOUNT_CREATE_PERMISSION = 'order:ccbAccount:edit'
/** Portal 源码中的编辑/删除按钮实际使用了这个权限串，不能擅自改成 ccbAccount。 */
export const SALE_CCB_ACCOUNT_ROW_ACTION_PERMISSION = 'order:tradeStoreroom:edit'
export const SALE_CCB_ACCOUNT_MODULE_TYPE = 60

const ROOT = '/vue/order/ccbAccount'
const ORGANIZATION_TREE_URL = '/admin-api/sales/organization/tree'
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export type SaleCcbAccountId = string | number
export type SaleCcbAccountScalar = string | number
export type SaleCcbAccountOffice = Record<string, unknown> & {
  id?: SaleCcbAccountScalar | null
  name?: string | null
}
export type SaleCcbAccountForm = {
  id?: SaleCcbAccountId | null
  companyId?: SaleCcbAccountScalar | null
  office?: SaleCcbAccountOffice | null
  officeId?: SaleCcbAccountScalar | null
  itemKindCode?: SaleCcbAccountScalar[] | null
  publicKey?: string | null
  branchCode?: string | null
  merchantCode?: string | null
  ccbpayAccount?: string | null
  counterCode?: string | null
  receiptAccountName?: string | null
  receiptAccountNo?: string | null
  bankName?: string | null
  branchName?: string | null
  instCode?: string | null
  branchInstCode?: string | null
}
export type SaleCcbAccountUpdateForm = SaleCcbAccountForm & { id: SaleCcbAccountId }
export type SaleCcbAccountDraft = {
  id: SaleCcbAccountScalar
  companyId: SaleCcbAccountScalar
  office: SaleCcbAccountOffice
  officeId: SaleCcbAccountScalar
  itemKind: string
  publicKey: string
  branchCode: string
  merchantCode: string
  ccbpayAccount: string
  counterCode: string
  receiptAccountName: string
  receiptAccountNo: string
  bankName: string
  branchName: string
  instCode: string
  branchInstCode: string
}
export type SaleCcbAccountFormPreparation = { draft: SaleCcbAccountDraft }
export type SaleCcbAccountRemovePreparation = { id: SaleCcbAccountId }
export type SaleCcbAccountOrganizationNode = Record<string, unknown> & {
  salesId: string
  name: string
  salesParentId?: string | null
  children: SaleCcbAccountOrganizationNode[]
}
export type SaleCcbAccountRow = Record<string, unknown> & {
  id?: SaleCcbAccountId | null
  office?: SaleCcbAccountOffice | null
  itemKind?: string | null
  branchCode?: string | null
  merchantCode?: string | null
  counterCode?: string | null
  ccbpayAccount?: string | null
  publicKey?: string | null
  createDate?: string | number | null
  updateDate?: string | number | null
  remarks?: string | null
  receiptAccountName?: string | null
  receiptAccountNo?: string | null
  bankName?: string | null
  branchName?: string | null
  instCode?: string | null
  branchInstCode?: string | null
}
export type SaleCcbAccountQuery = {
  pageNo?: number
  pageSize?: number
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleCcbAccountId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function scalarOf (value: unknown, label: string): SaleCcbAccountScalar {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须是字符串或安全整数`)
}

function optionalScalarOf (value: unknown, label: string): SaleCcbAccountScalar {
  if (value === undefined || value === null) return ''
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

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) {
    throw new Error('pageSize必须是10、20、50或100')
  }
  return result
}

function officeOf (value: unknown, label: string): SaleCcbAccountOffice {
  const office = value === undefined || value === null ? {} : objectOf(value, label)
  return {
    ...office,
    id: optionalScalarOf(office.id, `${label}.id`),
    name: textOf(office.name, `${label}.name`),
  }
}

function itemKindCodesOf (value: unknown, label: string): SaleCcbAccountScalar[] {
  const codes = value === undefined || value === null ? [] : value
  if (!Array.isArray(codes) || codes.length === 0) throw new Error(`${label}必填且至少选择一项`)
  return codes.map((code, index) => scalarOf(code, `${label}[${index}]`))
}

function itemKindPayloadOf (codes: SaleCcbAccountScalar[]): string {
  return JSON.stringify(codes).replace(/"/g, "'")
}

function formPayloadOf (input: unknown, mode: 'create' | 'update'): SaleCcbAccountDraft {
  const form = objectOf(input, 'SAP-收款账号表单')
  const id = mode === 'update' ? idOf(form.id, 'SAP收款账号ID') : optionalScalarOf(form.id, 'id')
  if (mode === 'create' && id !== '') throw new Error('新建SAP收款账号不能带已有id')
  const officeId = scalarOf(form.officeId, 'officeId')
  if (officeId === '') throw new Error('officeId必填')
  return {
    id,
    companyId: optionalScalarOf(form.companyId, 'companyId'),
    office: officeOf(form.office, 'office'),
    officeId,
    itemKind: itemKindPayloadOf(itemKindCodesOf(form.itemKindCode, 'itemKindCode')),
    publicKey: textOf(form.publicKey, 'publicKey'),
    branchCode: textOf(form.branchCode, 'branchCode'),
    merchantCode: textOf(form.merchantCode, 'merchantCode'),
    ccbpayAccount: textOf(form.ccbpayAccount, 'ccbpayAccount', true),
    counterCode: textOf(form.counterCode, 'counterCode'),
    receiptAccountName: textOf(form.receiptAccountName, 'receiptAccountName', true),
    receiptAccountNo: textOf(form.receiptAccountNo, 'receiptAccountNo', true),
    bankName: textOf(form.bankName, 'bankName', true),
    branchName: textOf(form.branchName, 'branchName', true),
    instCode: textOf(form.instCode, 'instCode'),
    branchInstCode: textOf(form.branchInstCode, 'branchInstCode'),
  }
}

function draftPayloadOf (input: unknown, mode: 'create' | 'update'): SaleCcbAccountDraft {
  const draft = objectOf(input, 'SAP-收款账号提交草稿')
  const id = mode === 'update' ? idOf(draft.id, 'SAP收款账号ID') : optionalScalarOf(draft.id, 'id')
  if (mode === 'create' && id !== '') throw new Error('新建SAP收款账号不能带已有id')
  const officeId = scalarOf(draft.officeId, 'officeId')
  if (officeId === '') throw new Error('officeId必填')
  return {
    id,
    companyId: optionalScalarOf(draft.companyId, 'companyId'),
    office: officeOf(draft.office, 'office'),
    officeId,
    itemKind: textOf(draft.itemKind, 'itemKind', true),
    publicKey: textOf(draft.publicKey, 'publicKey'),
    branchCode: textOf(draft.branchCode, 'branchCode'),
    merchantCode: textOf(draft.merchantCode, 'merchantCode'),
    ccbpayAccount: textOf(draft.ccbpayAccount, 'ccbpayAccount', true),
    counterCode: textOf(draft.counterCode, 'counterCode'),
    receiptAccountName: textOf(draft.receiptAccountName, 'receiptAccountName', true),
    receiptAccountNo: textOf(draft.receiptAccountNo, 'receiptAccountNo', true),
    bankName: textOf(draft.bankName, 'bankName', true),
    branchName: textOf(draft.branchName, 'branchName', true),
    instCode: textOf(draft.instCode, 'instCode'),
    branchInstCode: textOf(draft.branchInstCode, 'branchInstCode'),
  }
}

function rowOfficeOf (value: unknown, label: string): SaleCcbAccountOffice | null {
  if (value === undefined || value === null) return null
  const office = objectOf(value, label)
  return { ...office, id: optionalScalarOf(office.id, `${label}.id`), name: nullableTextOf(office.name, `${label}.name`) }
}

function rowOf (value: unknown, label: string): SaleCcbAccountRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    office: rowOfficeOf(row.office, `${label}.office`),
    itemKind: nullableTextOf(row.itemKind, `${label}.itemKind`),
    branchCode: nullableTextOf(row.branchCode, `${label}.branchCode`),
    merchantCode: nullableTextOf(row.merchantCode, `${label}.merchantCode`),
    counterCode: nullableTextOf(row.counterCode, `${label}.counterCode`),
    ccbpayAccount: nullableTextOf(row.ccbpayAccount, `${label}.ccbpayAccount`),
    publicKey: nullableTextOf(row.publicKey, `${label}.publicKey`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
    remarks: nullableTextOf(row.remarks, `${label}.remarks`),
    receiptAccountName: nullableTextOf(row.receiptAccountName, `${label}.receiptAccountName`),
    receiptAccountNo: nullableTextOf(row.receiptAccountNo, `${label}.receiptAccountNo`),
    bankName: nullableTextOf(row.bankName, `${label}.bankName`),
    branchName: nullableTextOf(row.branchName, `${label}.branchName`),
    instCode: nullableTextOf(row.instCode, `${label}.instCode`),
    branchInstCode: nullableTextOf(row.branchInstCode, `${label}.branchInstCode`),
  }
}

function pageOf (value: unknown): PageResult<SaleCcbAccountRow> {
  const page = objectOf(value, 'SAP-收款账号分页响应')
  if (!Array.isArray(page.list)) throw new Error('SAP-收款账号分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('SAP-收款账号分页响应缺少有效count')
  return { list: page.list.map((item, index) => rowOf(item, `SAP收款账号列表[${index}]`)), total: page.count as number }
}

function treeNodeOf (value: unknown, label: string): SaleCcbAccountOrganizationNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return {
    ...node,
    salesId: textOf(node.salesId, `${label}.salesId`, true),
    name: textOf(node.name, `${label}.name`, true),
    salesParentId: nullableTextOf(node.salesParentId, `${label}.salesParentId`),
    children: children.map((child, index) => treeNodeOf(child, `${label}.children[${index}]`)),
  }
}

export function createSaleCcbAccountCapability (request: PortalRequest) {
  return {
    async list (query: SaleCcbAccountQuery = {}): Promise<PageResult<SaleCcbAccountRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
        headers: FORM_HEADERS,
      }))
    },

    async organizationTree (): Promise<SaleCcbAccountOrganizationNode[]> {
      const result = await request({
        url: ORGANIZATION_TREE_URL,
        method: 'get',
        params: { salesTypeMax: '1' },
        httpInstance: 'platform',
      })
      if (!Array.isArray(result)) throw new Error('SAP-收款账号组织树响应必须是数组')
      return result.map((item, index) => treeNodeOf(item, `SAP收款账号组织树[${index}]`))
    },

    prepareCreate (input: { form: Partial<SaleCcbAccountForm> }): SaleCcbAccountFormPreparation {
      return { draft: formPayloadOf(input?.form, 'create') }
    },

    async create (input: { draft: SaleCcbAccountDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftPayloadOf(input?.draft, 'create'), headers: FORM_HEADERS })
    },

    prepareUpdate (input: { form: SaleCcbAccountUpdateForm }): SaleCcbAccountFormPreparation {
      return { draft: formPayloadOf(input?.form, 'update') }
    },

    async update (input: { draft: SaleCcbAccountDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftPayloadOf(input?.draft, 'update'), headers: FORM_HEADERS })
    },

    prepareRemove (input: { id: SaleCcbAccountId }): SaleCcbAccountRemovePreparation {
      return { id: idOf(input?.id, 'SAP收款账号ID') }
    },

    async remove (input: { id: SaleCcbAccountId }): Promise<void> {
      await request({ url: `${ROOT}/${idOf(input?.id, 'SAP收款账号ID')}`, method: 'delete', headers: FORM_HEADERS })
    },
  }
}

export type SaleCcbAccountCapability = ReturnType<typeof createSaleCcbAccountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal ModalFormContent 的完整表单；itemKindCode 是字典值数组，编辑必须带当前行id')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate 返回的完整提交草稿；已将itemKindCode转换为itemKind')

export const SALE_CCB_ACCOUNT_METHODS = {
  'sale-ccb-account-list': 'list',
  'sale-ccb-account-organization-tree': 'organizationTree',
  'sale-ccb-account-prepare-create': 'prepareCreate',
  'sale-ccb-account-create': 'create',
  'sale-ccb-account-prepare-update': 'prepareUpdate',
  'sale-ccb-account-update': 'update',
  'sale-ccb-account-prepare-remove': 'prepareRemove',
  'sale-ccb-account-remove': 'remove',
} as const

export const saleCcbAccountCapabilities: CapabilityDefinition[] = [
  { id: 'sale-ccb-account-list', title: '查询SAP收款账号', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-ccb-account-organization-tree', title: '查询SAP收款账号公司树', write: false, params: [] },
  { id: 'sale-ccb-account-prepare-create', title: '准备新建SAP收款账号', write: false, params: [formParam] },
  { id: 'sale-ccb-account-create', title: '新建SAP收款账号', write: true, params: [draftParam] },
  { id: 'sale-ccb-account-prepare-update', title: '准备编辑SAP收款账号', write: false, params: [formParam] },
  { id: 'sale-ccb-account-update', title: '编辑SAP收款账号', write: true, params: [draftParam] },
  { id: 'sale-ccb-account-prepare-remove', title: '准备删除SAP收款账号', write: false, params: [p('id', 'text', true, '当前列表记录ID')] },
  { id: 'sale-ccb-account-remove', title: '删除SAP收款账号', write: true, params: [p('id', 'text', true, '当前列表记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_CCB_ACCOUNT_PAGE_PATH,
  permission: SALE_CCB_ACCOUNT_PERMISSION,
  moduleType: SALE_CCB_ACCOUNT_MODULE_TYPE,
  httpInstance: definition.id === 'sale-ccb-account-organization-tree' ? 'platform' : 'crm',
}))
