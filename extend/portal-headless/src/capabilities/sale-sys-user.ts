import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「系统设置 → 销售设置 → 用户扩展」。 */
export const SALE_SYS_USER_PAGE_PATH = '/dashboard/sale/sys/user/list'
export const SALE_SYS_USER_PERMISSION = '/dashboard/sale/frame/sys/user'
export const SALE_SYS_USER_EXPORT_PERMISSION = 'sys:user:export'
export const SALE_SYS_USER_EDIT_PERMISSION = 'sys:user:edit'
export const SALE_SYS_USER_EDIT_OFFICE_PERMISSION = 'sys:user:edit:office'
export const SALE_SYS_USER_EDIT_BUSINESS_PERMISSION = 'sys:user:edit:business'
export const SALE_SYS_USER_STOP_PERMISSION = 'sys:user:stop'
export const SALE_SYS_USER_OPEN_PERMISSION = 'sys:user:open'
export const SALE_SYS_USER_STOP_BATCH_PERMISSION = 'sys:user:stopBatch'
export const SALE_SYS_USER_OPEN_BATCH_PERMISSION = 'sys:user:openBatch'
export const SALE_SYS_USER_TRANSFER_PERMISSION = 'sys:user:transfer'
export const SALE_SYS_USER_MODULE_TYPE = 60

const ROOT = '/admin-api/sales/user'
const ORGANIZATION_ROOT = '/admin-api/sales/organization'
const SHOP_ROOT = '/admin-api/sales/shop'
const DOMESTIC_ROOT = '/admin-api/sales/domestic-business-setting'
const DICT_PAGE_URL = '/admin-api/system/dict-data/page'
const ROLE_PAGE_URL = '/admin-api/system/hr-role/page'
const ITEM_KIND_URL = '/vue/sys/dict/listData'

export type SaleSysUserId = string | number
export type SaleSysUserScalar = string | number

export type SaleSysUserQuery = {
  orgId?: SaleSysUserScalar | null
  username?: string | null
  mobile?: string | null
  realName?: string | null
  roleId?: SaleSysUserScalar | null
  salesStatus?: SaleSysUserScalar | null
  pageNo?: number
  pageSize?: number
}

export type SaleSysUserRoleQuery = {
  keyword: string
  pageNo?: number
  pageSize?: number
}

export type SaleSysUserRow = Record<string, unknown> & {
  id: SaleSysUserId
  salesId?: SaleSysUserScalar | null
  username?: string | null
  realName?: string | null
  mobile?: string | null
  orgPath?: string | null
  salesOrgPath?: string | null
  roleNames?: string | null
  salesStatus?: number | null
  businessAttributeMap?: Record<string, Array<string | number>> | null
  shopIds?: Array<string | number> | null
  officeIds?: Array<string | number> | null
  organizationId?: SaleSysUserId | null
  salesOrganizationId?: SaleSysUserScalar | null
  roles?: Array<Record<string, unknown>> | null
  tenantName?: string | null
}

export type SaleSysUserOption = Record<string, unknown> & {
  value: SaleSysUserScalar
  label: string
}

export type SaleSysUserTreeNode = Record<string, unknown> & {
  id: SaleSysUserId
  name?: string | null
  salesId?: SaleSysUserScalar | null
  children: SaleSysUserTreeNode[]
}

export type SaleSysUserShop = Record<string, unknown> & {
  shopId: SaleSysUserScalar
  shopName?: string | null
}

export type SaleSysUserItemKindOption = Record<string, unknown> & {
  value: SaleSysUserScalar
  label: string
}

export type SaleSysUserMaterial = Record<string, unknown> & {
  materielCode: string
  selectable?: boolean | null
}

export type SaleSysUserDomesticMaterialCodes = {
  materiels: string | null
  codes: string[]
}

export type SaleSysUserDomesticQuery = {
  organizationId?: SaleSysUserScalar | null
  userId: SaleSysUserId
  materielName?: string | null
  materielCode?: string | null
  factoryName?: string | null
  materielCategory?: SaleSysUserScalar | null
  supplierName?: string | null
  shopName?: string | null
  pageNo?: number
  pageSize?: number
}

export type SaleSysUserDomesticMaterialRow = Record<string, unknown> & {
  materielId?: SaleSysUserId | null
  materielCode?: string | null
  materielName?: string | null
  materielCategory?: SaleSysUserScalar | null
  materielCategoryName?: string | null
  factoryId?: SaleSysUserId | null
  factoryName?: string | null
  shopId?: SaleSysUserScalar | null
  shopName?: string | null
  supplierId?: SaleSysUserId | null
  supplierName?: string | null
  isAssigned?: boolean | null
  userId?: SaleSysUserId | null
  materiels?: string | null
  selectable?: boolean | null
}

export type SaleSysUserTransferCustomer = Record<string, unknown> & {
  organizationId: SaleSysUserScalar
  salesOrgName?: string | null
  salesCode?: string | null
  realName?: string | null
  mobile?: string | null
  customerNum?: number | null
  salesParentId?: SaleSysUserScalar | null
}

export type SaleSysUserForm = Record<string, unknown> & {
  id: SaleSysUserId
  salesOrganizationId: SaleSysUserScalar
  salesId?: SaleSysUserScalar | null
  salesStatus?: SaleSysUserScalar | null
}

export type SaleSysUserUpdateDraft = Record<string, unknown> & {
  id: SaleSysUserId
  salesOrganizationId: SaleSysUserScalar
}
export type SaleSysUserUpdatePreparation = { draft: SaleSysUserUpdateDraft }

export type SaleSysUserRolePreparation = { id: SaleSysUserId; roleIds: SaleSysUserId[] }
export type SaleSysUserShopPreparation = { id: SaleSysUserId; shopIds: SaleSysUserScalar[] }
export type SaleSysUserOfficePreparation = { id: SaleSysUserId; officeIds: SaleSysUserScalar[] }
export type SaleSysUserBusinessPreparation = { id: SaleSysUserId; businessAttributeMap: Record<string, SaleSysUserScalar[]> }
export type SaleSysUserDomesticPreparation = { userId: SaleSysUserId; materials: string }
export type SaleSysUserStatusPreparation = { id: SaleSysUserId }
export type SaleSysUserBatchStatusPreparation = { ids: SaleSysUserId[] }
export type SaleSysUserTransferQuery = { userId: SaleSysUserId; filterName?: string | null }
export type SaleSysUserTransferPreparation = {
  sourceUserId: SaleSysUserId
  salesOrganizationId: SaleSysUserScalar
  salesId: SaleSysUserScalar
  organizationList: SaleSysUserScalar[]
}

export type SaleSysUserFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleSysUserId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function scalarOf (value: unknown, label: string): SaleSysUserScalar {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须是非空字符串或安全整数`)
}

function scalarOrEmptyOf (value: unknown, label: string): SaleSysUserScalar | '' {
  if (value === undefined || value === null || value === '') return ''
  return scalarOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (!text) throw new Error(`${label}必填`)
  return text
}

function keywordOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必须提供非空关键字`)
  return value.trim()
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是10、20、50或100')
  return result as number
}

function idListOf (value: unknown, label: string): SaleSysUserId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function scalarListOf (value: unknown, label: string): SaleSysUserScalar[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => scalarOf(item, `${label}[${index}]`))
}

function uniqueIdListOf (value: unknown, label: string): SaleSysUserId[] {
  const ids = idListOf(value, label)
  if (ids.length === 0) throw new Error(`${label}至少包含一个ID`)
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function rowOf (value: unknown, label: string): SaleSysUserRow {
  const row = objectOf(value, label)
  const result: SaleSysUserRow = { ...row, id: idOf(row.id, `${label}.id`) }
  if (Object.prototype.hasOwnProperty.call(row, 'salesStatus')) {
    const status = row.salesStatus
    if (status !== null && !Number.isSafeInteger(status)) throw new Error(`${label}.salesStatus必须是整数或null`)
    result.salesStatus = status as number | null
  }
  if (Object.prototype.hasOwnProperty.call(row, 'salesId') && row.salesId !== null && row.salesId !== undefined) result.salesId = scalarOf(row.salesId, `${label}.salesId`)
  if (Object.prototype.hasOwnProperty.call(row, 'salesOrganizationId') && row.salesOrganizationId !== null && row.salesOrganizationId !== undefined) result.salesOrganizationId = scalarOf(row.salesOrganizationId, `${label}.salesOrganizationId`)
  if (Object.prototype.hasOwnProperty.call(row, 'organizationId') && row.organizationId !== null && row.organizationId !== undefined) result.organizationId = idOf(row.organizationId, `${label}.organizationId`)
  return result
}

function pageOf<T> (value: unknown, rowMapper: (value: unknown, label: string) => T, label: string): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowMapper(item, `${label}.list[${index}]`)), total: page.total as number }
}

function treeNodeOf (value: unknown, label: string): SaleSysUserTreeNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    ...(node.salesId === null || node.salesId === undefined ? {} : { salesId: scalarOf(node.salesId, `${label}.salesId`) }),
    children: children.map((item, index) => treeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function treeOf (value: unknown, label: string): SaleSysUserTreeNode[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => treeNodeOf(item, `${label}[${index}]`))
}

function statusOptionsOf (value: unknown): SaleSysUserOption[] {
  const page = objectOf(value, '销售用户状态字典')
  if (!Array.isArray(page.list)) throw new Error('销售用户状态字典.list必须是数组')
  return page.list.map((item, index) => {
    const option = objectOf(item, `销售用户状态字典.list[${index}]`)
    const numericValue = Number(option.value)
    if (!Number.isFinite(numericValue) || typeof option.label !== 'string') throw new Error(`销售用户状态字典.list[${index}]字段无效`)
    return { ...option, value: numericValue, label: option.label }
  })
}

function rolePageOf (value: unknown, label: string): { list: Array<Record<string, unknown>>; total: number } {
  if (Array.isArray(value)) return { list: value.map((item, index) => objectOf(item, `${label}[${index}]`)), total: value.length }
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => objectOf(item, `${label}.list[${index}]`)), total: page.total as number }
}

function roleOptionsOf (rows: Array<Record<string, unknown>>): SaleSysUserOption[] {
  return rows.map((row, index) => ({
    label: requiredTextOf(row.name, `角色[${index}].name`),
    value: scalarOf(row.id, `角色[${index}].id`),
  }))
}

function shopListOf (value: unknown): SaleSysUserShop[] {
  if (!Array.isArray(value)) throw new Error('用户店铺列表必须是数组')
  return value.map((item, index) => {
    const shop = objectOf(item, `用户店铺列表[${index}]`)
    return {
      ...shop,
      shopId: scalarOf(shop.shopId, `用户店铺列表[${index}].shopId`),
      ...(shop.shopName === undefined || shop.shopName === null ? {} : { shopName: textOf(shop.shopName, `用户店铺列表[${index}].shopName`) }),
    }
  })
}

function itemKindOptionsOf (value: unknown): SaleSysUserItemKindOption[] {
  if (!Array.isArray(value)) throw new Error('商品类型字典必须是数组')
  return value.map((item, index) => {
    const option = objectOf(item, `商品类型字典[${index}]`)
    return {
      ...option,
      value: scalarOf(option.value, `商品类型字典[${index}].value`),
      label: requiredTextOf(option.label, `商品类型字典[${index}].label`),
    }
  })
}

function domesticMaterialCodesOf (value: unknown): SaleSysUserDomesticMaterialCodes {
  const data = objectOf(value, '用户内销物料编码响应')
  const materiels = data.materiels === undefined || data.materiels === null ? null : requiredTextOf(data.materiels, '用户内销物料编码响应.materiels')
  return { materiels, codes: materiels ? materiels.split(',') : [] }
}

function domesticQueryParamsOf (query: SaleSysUserDomesticQuery): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    organizationId: query.organizationId === undefined ? '' : scalarOrEmptyOf(query.organizationId, 'organizationId'),
    userId: idOf(query.userId, 'userId'),
    materielName: textOf(query.materielName, 'materielName'),
    materielCode: textOf(query.materielCode, 'materielCode'),
    factoryName: textOf(query.factoryName, 'factoryName'),
    materielCategory: scalarOrEmptyOf(query.materielCategory, 'materielCategory'),
    supplierName: textOf(query.supplierName, 'supplierName'),
    shopName: textOf(query.shopName, 'shopName'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function updatePayloadOf (value: unknown): SaleSysUserUpdateDraft {
  const form = objectOf(value, '销售用户编辑表单')
  const id = idOf(form.id, '用户ID')
  const salesOrganizationId = scalarOf(form.salesOrganizationId, 'salesOrganizationId')
  if (form.salesId !== undefined && form.salesId !== null && portalLooseEqualOf(salesOrganizationId, scalarOf(form.salesId, 'salesId'))) throw new Error('不能选择自己作为上级机构')
  return { ...form, id, salesOrganizationId }
}

function rolePreparationOf (input: { id: unknown; roleIds: unknown }): SaleSysUserRolePreparation {
  return { id: idOf(input?.id, '用户ID'), roleIds: idListOf(input?.roleIds, 'roleIds') }
}

function shopPreparationOf (input: { id: unknown; shopIds: unknown }): SaleSysUserShopPreparation {
  return { id: idOf(input?.id, '用户ID'), shopIds: scalarListOf(input?.shopIds, 'shopIds') }
}

function officePreparationOf (input: { id: unknown; officeIds: unknown }): SaleSysUserOfficePreparation {
  return { id: idOf(input?.id, '用户ID'), officeIds: scalarListOf(input?.officeIds, 'officeIds') }
}

function businessPreparationOf (input: { id: unknown; businessAttributeMap: unknown }): SaleSysUserBusinessPreparation {
  const source = objectOf(input?.businessAttributeMap, 'businessAttributeMap')
  const businessAttributeMap: Record<string, SaleSysUserScalar[]> = {}
  for (const [key, values] of Object.entries(source)) businessAttributeMap[key] = scalarListOf(values, `businessAttributeMap.${key}`)
  return { id: idOf(input?.id, '用户ID'), businessAttributeMap }
}

function domesticPreparationOf (input: { userId: unknown; materials: unknown }): SaleSysUserDomesticPreparation {
  const materials = input?.materials
  if (!Array.isArray(materials)) throw new Error('materials必须是物料数组')
  const codes = materials.map((item, index) => {
    const material = objectOf(item, `materials[${index}]`)
    if (material.selectable === false) throw new Error(`materials[${index}]不可选择`)
    return requiredTextOf(material.materielCode, `materials[${index}].materielCode`)
  })
  return { userId: idOf(input?.userId, 'userId'), materials: codes.join(',') }
}

function domesticDraftOf (input: { userId: unknown; materials: unknown }): SaleSysUserDomesticPreparation {
  return {
    userId: idOf(input?.userId, 'userId'),
    materials: requiredTextOf(input?.materials, 'materials'),
  }
}

function transferCustomerListOf (value: unknown): SaleSysUserTransferCustomer[] {
  if (!Array.isArray(value)) throw new Error('待移交客户组织必须是数组')
  return value.map((item, index) => {
    const organization = objectOf(item, `待移交客户组织[${index}]`)
    return {
      ...organization,
      organizationId: scalarOf(organization.organizationId, `待移交客户组织[${index}].organizationId`),
    }
  })
}

function uniqueScalarListOf (value: unknown, label: string): SaleSysUserScalar[] {
  const ids = scalarListOf(value, label)
  if (ids.length === 0) throw new Error(`${label}至少包含一个ID`)
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function transferPreparationOf (input: { sourceUserId: unknown; salesOrganizationId: unknown; salesId: unknown; organizationList: unknown }): SaleSysUserTransferPreparation {
  return {
    sourceUserId: idOf(input?.sourceUserId, 'sourceUserId'),
    salesOrganizationId: scalarOf(input?.salesOrganizationId, 'salesOrganizationId'),
    salesId: scalarOf(input?.salesId, 'salesId'),
    organizationList: uniqueScalarListOf(input?.organizationList, 'organizationList'),
  }
}

function portalLooseEqualOf (left: SaleSysUserScalar, right: SaleSysUserScalar): boolean {
  if (typeof left === typeof right) return left === right
  const leftNumber = typeof left === 'number' ? left : Number(left)
  const rightNumber = typeof right === 'number' ? right : Number(right)
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber
}

function activeFilterOf (value: unknown): number {
  if (String(value) !== '1') throw new Error('只有筛选启用状态时Portal才显示该操作')
  return 1
}

function inactiveFilterOf (value: unknown): number {
  if (String(value) === '1') throw new Error('只有筛选非启用状态时Portal才显示启用操作')
  return 0
}

function bytesOf (response: AxiosResponse<ArrayBuffer>): Uint8Array {
  const data: unknown = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('用户扩展导出响应不是二进制文件')
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return '用户.xlsx'
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || '用户.xlsx'
}

function fileOf (response: AxiosResponse<ArrayBuffer>): SaleSysUserFile {
  const bytes = bytesOf(response)
  if (bytes.byteLength === 0) throw new Error('用户扩展导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function trueResultOf (value: unknown, label: string): void {
  if (value !== true) throw new Error(`${label}响应不是true`)
}

/** 用户扩展页的列表、候选、管辖范围、业务属性和启停能力。 */
export function createSaleSysUserCapability (request: PortalRequest) {
  return {
    async list (query: SaleSysUserQuery = {}): Promise<PageResult<SaleSysUserRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
          orgId: scalarOrEmptyOf(query.orgId, 'orgId'),
          username: textOf(query.username, 'username'),
          mobile: textOf(query.mobile, 'mobile'),
          realName: textOf(query.realName, 'realName'),
          roleId: scalarOrEmptyOf(query.roleId, 'roleId'),
          salesStatus: scalarOrEmptyOf(query.salesStatus === undefined ? 1 : query.salesStatus, 'salesStatus'),
          useSystem: 6,
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
        httpInstance: 'platform',
      }), rowOf, '销售用户分页响应')
    },

    async statusOptions (): Promise<SaleSysUserOption[]> {
      return statusOptionsOf(await request({ url: DICT_PAGE_URL, method: 'get', params: { dictType: 'sales_user_status', pageNo: 1, pageSize: 100 }, httpInstance: 'platform' }))
    },

    async roleOptions (query: SaleSysUserRoleQuery): Promise<SaleSysUserOption[]> {
      const keyword = keywordOf(query?.keyword, '角色关键字')
      const pageNo = pageNumberOf(query?.pageNo, 1, 'pageNo')
      const pageSize = pageNumberOf(query?.pageSize, 20, 'pageSize')
      const page = rolePageOf(await request({ url: ROLE_PAGE_URL, method: 'get', params: { name: keyword, pageNo, pageSize, useSystem: 6 }, httpInstance: 'platform' }), '角色分页响应')
      return roleOptionsOf(page.list)
    },

    async companyTree (): Promise<SaleSysUserTreeNode[]> {
      return treeOf(await request({ url: `${ORGANIZATION_ROOT}/tree`, method: 'get', params: { salesTypeMax: '1', isSalesTree: false }, httpInstance: 'platform' }), '公司树')
    },

    async organizationTree (): Promise<SaleSysUserTreeNode[]> {
      return treeOf(await request({ url: `${ORGANIZATION_ROOT}/tree`, method: 'get', params: { isSalesTree: false }, httpInstance: 'platform' }), '机构树')
    },

    async get (input: { id: SaleSysUserId }): Promise<SaleSysUserRow> {
      const id = idOf(input?.id, '用户ID')
      return rowOf(await request({ url: `${ROOT}/detail/${id}`, method: 'get', httpInstance: 'platform' }), '销售用户详情')
    },

    async salesTree (): Promise<SaleSysUserTreeNode[]> {
      return treeOf(await request({ url: `${ORGANIZATION_ROOT}/tree`, method: 'get', params: {}, httpInstance: 'platform' }), '销售机构树')
    },

    async shops (input: { userId: SaleSysUserId }): Promise<SaleSysUserShop[]> {
      const userId = idOf(input?.userId, 'userId')
      return shopListOf(await request({ url: `${SHOP_ROOT}/user-tenant-shops`, method: 'get', params: { userId }, httpInstance: 'platform' }))
    },

    async childOrganizations (input: { userId: SaleSysUserId }): Promise<SaleSysUserTreeNode[]> {
      const userId = idOf(input?.userId, 'userId')
      const value: unknown = await request({ url: `${ORGANIZATION_ROOT}/user-sales-child-organizations`, method: 'get', params: { userId }, httpInstance: 'platform' })
      return treeOf(value, '销售部范围')
    },

    async transferTargetTree (): Promise<SaleSysUserTreeNode[]> {
      return treeOf(await request({ url: `${ORGANIZATION_ROOT}/undertakeTree`, method: 'get', params: { isSalesTree: true }, httpInstance: 'platform' }), '移交承接组织树')
    },

    async transferCustomerOrganizations (query: SaleSysUserTransferQuery): Promise<SaleSysUserTransferCustomer[]> {
      const userId = idOf(query?.userId, 'userId')
      return transferCustomerListOf(await request({
        url: `${ORGANIZATION_ROOT}/user-sales-child-customer-organizations`,
        method: 'get',
        params: { order: '', orderField: '', userId, filterName: query.filterName ?? null },
        httpInstance: 'platform',
      }))
    },

    async itemKindOptions (): Promise<SaleSysUserItemKindOption[]> {
      return itemKindOptionsOf(await request({ url: ITEM_KIND_URL, method: 'get', params: { type: 'item_kind' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpInstance: 'crm' }))
    },

    async domesticMaterialCodes (input: { userId: SaleSysUserId }): Promise<SaleSysUserDomesticMaterialCodes> {
      const userId = idOf(input?.userId, 'userId')
      return domesticMaterialCodesOf(await request({ url: `${DOMESTIC_ROOT}/get-materiels`, method: 'get', params: { userId }, httpInstance: 'platform' }))
    },

    async domesticMaterialList (query: SaleSysUserDomesticQuery): Promise<PageResult<SaleSysUserDomesticMaterialRow>> {
      return pageOf(await request({ url: `${DOMESTIC_ROOT}/materiel-list`, method: 'get', params: domesticQueryParamsOf(query), httpInstance: 'platform' }), (value, label) => ({ ...objectOf(value, label) }), '内销物料分页响应')
    },

    prepareUpdate (input: { form: SaleSysUserForm }): SaleSysUserUpdatePreparation {
      return { draft: updatePayloadOf(input?.form) }
    },

    async update (input: { draft: SaleSysUserUpdateDraft }): Promise<void> {
      const draft = updatePayloadOf(input?.draft)
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: draft, httpInstance: 'platform' }), '用户编辑')
    },

    prepareRoleUpdate (input: { id: SaleSysUserId; roleIds: SaleSysUserId[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserRolePreparation {
      activeFilterOf(input?.currentFilterStatus)
      return rolePreparationOf(input)
    },

    async updateRoles (input: SaleSysUserRolePreparation): Promise<void> {
      const prepared = rolePreparationOf(input)
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id: prepared.id, roleIds: prepared.roleIds }, httpInstance: 'platform' }), '用户角色保存')
    },

    prepareShopUpdate (input: { id: SaleSysUserId; shopIds: SaleSysUserScalar[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserShopPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return shopPreparationOf(input)
    },

    async updateShops (input: SaleSysUserShopPreparation): Promise<void> {
      const prepared = shopPreparationOf(input)
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id: prepared.id, shopIds: prepared.shopIds }, httpInstance: 'platform' }), '用户店铺保存')
    },

    prepareOfficeUpdate (input: { id: SaleSysUserId; officeIds: SaleSysUserScalar[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserOfficePreparation {
      activeFilterOf(input?.currentFilterStatus)
      return officePreparationOf(input)
    },

    async updateOffices (input: SaleSysUserOfficePreparation): Promise<void> {
      const prepared = officePreparationOf(input)
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id: prepared.id, officeIds: prepared.officeIds }, httpInstance: 'platform' }), '用户销售部范围保存')
    },

    prepareBusinessUpdate (input: { id: SaleSysUserId; businessAttributeMap: Record<string, SaleSysUserScalar[]>; currentFilterStatus: SaleSysUserScalar }): SaleSysUserBusinessPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return businessPreparationOf(input)
    },

    async updateBusiness (input: SaleSysUserBusinessPreparation): Promise<void> {
      const prepared = businessPreparationOf(input)
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id: prepared.id, businessAttributeMap: prepared.businessAttributeMap }, httpInstance: 'platform' }), '用户外销业务保存')
    },

    prepareDomesticSave (input: { userId: SaleSysUserId; materials: SaleSysUserMaterial[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserDomesticPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return domesticPreparationOf(input)
    },

    async saveDomestic (input: SaleSysUserDomesticPreparation): Promise<void> {
      const prepared = domesticDraftOf(input)
      trueResultOf(await request({ url: `${DOMESTIC_ROOT}/save`, method: 'post', data: prepared, httpInstance: 'platform' }), '用户内销业务保存')
    },

    prepareStop (input: { id: SaleSysUserId; currentFilterStatus: SaleSysUserScalar }): SaleSysUserStatusPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return { id: idOf(input?.id, '用户ID') }
    },

    async stop (input: SaleSysUserStatusPreparation): Promise<void> {
      const id = idOf(input?.id, '用户ID')
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id, salesStatus: 2 }, httpInstance: 'platform' }), '用户停用')
    },

    prepareOpen (input: { id: SaleSysUserId; currentFilterStatus: SaleSysUserScalar }): SaleSysUserStatusPreparation {
      inactiveFilterOf(input?.currentFilterStatus)
      return { id: idOf(input?.id, '用户ID') }
    },

    async open (input: SaleSysUserStatusPreparation): Promise<void> {
      const id = idOf(input?.id, '用户ID')
      trueResultOf(await request({ url: `${ROOT}/update`, method: 'put', data: { id, salesStatus: 1 }, httpInstance: 'platform' }), '用户启用')
    },

    prepareBatchStop (input: { ids: SaleSysUserId[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserBatchStatusPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return { ids: uniqueIdListOf(input?.ids, 'ids') }
    },

    async batchStop (input: SaleSysUserBatchStatusPreparation): Promise<void> {
      const ids = uniqueIdListOf(input?.ids, 'ids')
      trueResultOf(await request({ url: `${ROOT}/batch-disable`, method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: ids, httpInstance: 'platform' }), '用户批量停用')
    },

    prepareBatchOpen (input: { ids: SaleSysUserId[]; currentFilterStatus: SaleSysUserScalar }): SaleSysUserBatchStatusPreparation {
      inactiveFilterOf(input?.currentFilterStatus)
      return { ids: uniqueIdListOf(input?.ids, 'ids') }
    },

    async batchOpen (input: SaleSysUserBatchStatusPreparation): Promise<void> {
      const ids = uniqueIdListOf(input?.ids, 'ids')
      trueResultOf(await request({ url: `${ROOT}/batch-enable`, method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: ids, httpInstance: 'platform' }), '用户批量启用')
    },

    prepareTransfer (input: { sourceUserId: SaleSysUserId; salesOrganizationId: SaleSysUserScalar; salesId: SaleSysUserScalar; organizationList: SaleSysUserScalar[] }): SaleSysUserTransferPreparation {
      return transferPreparationOf(input)
    },

    async transfer (input: SaleSysUserTransferPreparation): Promise<void> {
      const prepared = transferPreparationOf(input)
      trueResultOf(await request({
        url: `${ORGANIZATION_ROOT}/undertakeUpdate`,
        method: 'put',
        data: {
          salesOrganizationId: prepared.salesOrganizationId,
          salesId: prepared.salesId,
          organizationList: prepared.organizationList,
        },
        httpInstance: 'platform',
      }), '用户客户移交')
    },

    async export (query: SaleSysUserQuery = {}): Promise<SaleSysUserFile> {
      const params = {
        orgId: scalarOrEmptyOf(query.orgId, 'orgId'),
        username: textOf(query.username, 'username'),
        mobile: textOf(query.mobile, 'mobile'),
        realName: textOf(query.realName, 'realName'),
        roleId: scalarOrEmptyOf(query.roleId, 'roleId'),
        salesStatus: scalarOrEmptyOf(query.salesStatus === undefined ? 1 : query.salesStatus, 'salesStatus'),
        pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
        pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
      }
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params, responseType: 'arraybuffer', httpInstance: 'platform' })
      return fileOf(response)
    },
  }
}

export type SaleSysUserCapability = ReturnType<typeof createSaleSysUserCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('orgId', 'tree', false, '公司树节点id；未选择发送空字符串'),
  p('username', 'text', false, '工号筛选'),
  p('mobile', 'text', false, '手机号筛选'),
  p('realName', 'text', false, '姓名筛选'),
  p('roleId', 'enum', false, '角色id；未选择发送空字符串'),
  p('salesStatus', 'enum', false, '用户启停状态；省略时Portal默认1'),
  p('pageNo', 'number', false, '从1开始的页码'),
  p('pageSize', 'number', false, '每页条数，支持10、20、50、100'),
]
const activeParam = p('currentFilterStatus', 'enum', true, '当前列表筛选状态；编辑类动作必须为1，启用类动作必须不是1')
const idParam = p('id', 'text', true, '当前列表记录用户ID')
const idsParam = p('ids', 'text', true, '当前列表勾选的用户ID数组；至少一项且不能重复')

export const SALE_SYS_USER_METHODS = {
  'sale-sys-user-list': 'list',
  'sale-sys-user-status-options': 'statusOptions',
  'sale-sys-user-role-options': 'roleOptions',
  'sale-sys-user-company-tree': 'companyTree',
  'sale-sys-user-organization-tree': 'organizationTree',
  'sale-sys-user-get': 'get',
  'sale-sys-user-sales-tree': 'salesTree',
  'sale-sys-user-shop-list': 'shops',
  'sale-sys-user-child-organization-list': 'childOrganizations',
  'sale-sys-user-transfer-target-tree': 'transferTargetTree',
  'sale-sys-user-transfer-customer-organizations': 'transferCustomerOrganizations',
  'sale-sys-user-item-kind-options': 'itemKindOptions',
  'sale-sys-user-domestic-material-codes': 'domesticMaterialCodes',
  'sale-sys-user-domestic-material-list': 'domesticMaterialList',
  'sale-sys-user-prepare-update': 'prepareUpdate',
  'sale-sys-user-update': 'update',
  'sale-sys-user-prepare-role-update': 'prepareRoleUpdate',
  'sale-sys-user-update-roles': 'updateRoles',
  'sale-sys-user-prepare-shop-update': 'prepareShopUpdate',
  'sale-sys-user-update-shops': 'updateShops',
  'sale-sys-user-prepare-office-update': 'prepareOfficeUpdate',
  'sale-sys-user-update-offices': 'updateOffices',
  'sale-sys-user-prepare-business-update': 'prepareBusinessUpdate',
  'sale-sys-user-update-business': 'updateBusiness',
  'sale-sys-user-prepare-domestic-save': 'prepareDomesticSave',
  'sale-sys-user-save-domestic': 'saveDomestic',
  'sale-sys-user-prepare-stop': 'prepareStop',
  'sale-sys-user-stop': 'stop',
  'sale-sys-user-prepare-open': 'prepareOpen',
  'sale-sys-user-open': 'open',
  'sale-sys-user-prepare-batch-stop': 'prepareBatchStop',
  'sale-sys-user-batch-stop': 'batchStop',
  'sale-sys-user-prepare-batch-open': 'prepareBatchOpen',
  'sale-sys-user-batch-open': 'batchOpen',
  'sale-sys-user-prepare-transfer': 'prepareTransfer',
  'sale-sys-user-transfer': 'transfer',
  'sale-sys-user-export': 'export',
} as const

export const saleSysUserCapabilities: CapabilityDefinition[] = [
  { id: 'sale-sys-user-list', title: '查询用户扩展', write: false, params: queryParams },
  { id: 'sale-sys-user-status-options', title: '查询用户状态选项', write: false, params: [] },
  { id: 'sale-sys-user-role-options', title: '按关键字查询销售角色选项', write: false, params: [p('keyword', 'search', true, '角色名称关键字；必须为非空白字符串'), p('pageNo', 'number', false, '从1开始的页码'), p('pageSize', 'number', false, '每页条数，支持10、20、50、100')] },
  { id: 'sale-sys-user-company-tree', title: '查询用户公司树', write: false, params: [] },
  { id: 'sale-sys-user-organization-tree', title: '查询用户机构树', write: false, params: [] },
  { id: 'sale-sys-user-get', title: '读取用户扩展详情', write: false, params: [idParam] },
  { id: 'sale-sys-user-sales-tree', title: '查询用户销售上级机构树', write: false, params: [] },
  { id: 'sale-sys-user-shop-list', title: '查询用户可管辖店铺', write: false, params: [p('userId', 'text', true, '目标用户ID')] },
  { id: 'sale-sys-user-child-organization-list', title: '查询用户可管辖销售部', write: false, params: [p('userId', 'text', true, '目标用户ID')] },
  { id: 'sale-sys-user-transfer-target-tree', title: '查询用户移交承接组织树', write: false, params: [] },
  { id: 'sale-sys-user-transfer-customer-organizations', title: '查询用户待移交客户组织', write: false, params: [p('userId', 'text', true, '待移交用户ID'), p('filterName', 'text', false, '手机号、负责人或客户名称筛选')] },
  { id: 'sale-sys-user-item-kind-options', title: '查询用户外销商品类型选项', write: false, params: [] },
  { id: 'sale-sys-user-domestic-material-codes', title: '查询用户内销物料编码', write: false, params: [p('userId', 'text', true, '目标用户ID')] },
  { id: 'sale-sys-user-domestic-material-list', title: '查询用户内销物料列表', write: false, params: [p('organizationId', 'text', false, '用户所属人系统组织ID'), p('userId', 'text', true, '目标用户ID'), p('materielName', 'text'), p('materielCode', 'text'), p('factoryName', 'text'), p('materielCategory', 'text'), p('supplierName', 'text'), p('shopName', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-sys-user-prepare-update', title: '准备编辑用户扩展', write: false, params: [p('form', 'text', true, 'Portal编辑弹窗整份表单；保留未知字段，不发送请求')] },
  { id: 'sale-sys-user-update', title: '编辑用户扩展', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的整份表单草稿')] },
  { id: 'sale-sys-user-prepare-role-update', title: '准备分配用户角色', write: false, params: [idParam, p('roleIds', 'text', true, '角色ID数组'), activeParam] },
  { id: 'sale-sys-user-update-roles', title: '保存用户角色', write: true, params: [idParam, p('roleIds', 'text', true, '角色ID数组')] },
  { id: 'sale-sys-user-prepare-shop-update', title: '准备设置用户管辖店铺', write: false, params: [idParam, p('shopIds', 'text', true, '店铺ID数组'), activeParam] },
  { id: 'sale-sys-user-update-shops', title: '保存用户管辖店铺', write: true, params: [idParam, p('shopIds', 'text', true, '店铺ID数组')] },
  { id: 'sale-sys-user-prepare-office-update', title: '准备设置用户销售部范围', write: false, params: [idParam, p('officeIds', 'text', true, '销售组织salesId数组'), activeParam] },
  { id: 'sale-sys-user-update-offices', title: '保存用户销售部范围', write: true, params: [idParam, p('officeIds', 'text', true, '销售组织salesId数组')] },
  { id: 'sale-sys-user-prepare-business-update', title: '准备设置用户外销业务属性', write: false, params: [idParam, p('businessAttributeMap', 'text', true, '店铺ID到商品类型值数组的映射'), activeParam] },
  { id: 'sale-sys-user-update-business', title: '保存用户外销业务属性', write: true, params: [idParam, p('businessAttributeMap', 'text', true, '店铺ID到商品类型值数组的映射')] },
  { id: 'sale-sys-user-prepare-domestic-save', title: '准备保存用户内销业务', write: false, params: [p('userId', 'text', true, '目标用户ID'), p('materials', 'text', true, '内销物料行数组'), activeParam] },
  { id: 'sale-sys-user-save-domestic', title: '保存用户内销业务', write: true, params: [p('userId', 'text', true, '目标用户ID'), p('materials', 'text', true, 'prepareDomesticSave返回的逗号字符串')] },
  { id: 'sale-sys-user-prepare-stop', title: '准备停用用户', write: false, params: [idParam, activeParam] },
  { id: 'sale-sys-user-stop', title: '停用用户', write: true, params: [idParam] },
  { id: 'sale-sys-user-prepare-open', title: '准备启用用户', write: false, params: [idParam, activeParam] },
  { id: 'sale-sys-user-open', title: '启用用户', write: true, params: [idParam] },
  { id: 'sale-sys-user-prepare-batch-stop', title: '准备批量停用用户', write: false, params: [idsParam, activeParam] },
  { id: 'sale-sys-user-batch-stop', title: '批量停用用户', write: true, params: [idsParam] },
  { id: 'sale-sys-user-prepare-batch-open', title: '准备批量启用用户', write: false, params: [idsParam, activeParam] },
  { id: 'sale-sys-user-batch-open', title: '批量启用用户', write: true, params: [idsParam] },
  { id: 'sale-sys-user-prepare-transfer', title: '准备移交用户客户', write: false, params: [p('sourceUserId', 'text', true, '待移交用户ID'), p('salesOrganizationId', 'text', true, '承接销售组ID'), p('salesId', 'text', true, '承接销售用户ID'), p('organizationList', 'text', true, '用户确认的客户组织ID数组')] },
  { id: 'sale-sys-user-transfer', title: '移交用户客户', write: true, params: [p('sourceUserId', 'text', true, '待移交用户ID，用于回查'), p('salesOrganizationId', 'text', true, '承接销售组ID'), p('salesId', 'text', true, '承接销售用户ID'), p('organizationList', 'text', true, '客户组织ID数组')] },
  { id: 'sale-sys-user-export', title: '导出用户扩展', write: false, params: queryParams },
].map(definition => ({
  ...definition,
  pagePath: SALE_SYS_USER_PAGE_PATH,
  permission: SALE_SYS_USER_PERMISSION,
  moduleType: SALE_SYS_USER_MODULE_TYPE,
  httpInstance: definition.id === 'sale-sys-user-item-kind-options' ? 'crm' : 'platform',
}))
