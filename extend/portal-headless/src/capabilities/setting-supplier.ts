import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 供应商管理」及其可达的平台供应商选择、新建、删除和导出动作。 */
export const SETTING_SUPPLIER_PAGE_PATH = '/dashboard/setting/supplier/list'
export const SETTING_SUPPLIER_PERMISSION = '/dashboard/setting/supplier'
export const SETTING_SUPPLIER_MODULE_TYPE = null

const ROOT = '/admin-api/system/sys-supplier'

export type SettingSupplierId = string | number
export type SettingSupplierType = string | number

export type SettingSupplierQuery = {
  supplierName?: string | null
  supplierCode?: string | null
  type?: SettingSupplierType | null
  pageNo?: number
  pageSize?: number
}

export type SettingSupplierRow = Record<string, unknown> & {
  id: SettingSupplierId
  supplierCode: string | null
  supplierName: string | null
  supplierAbbreviation: string | null
  type: number | null
  category: number | null
  address: string | null
  qualificationCode: string | null
  createTime: string | number | null
  updateTime: string | number | null
  updaterName: string | null
  addedByTenant: boolean | number | null
  selectable: boolean | null
  sysBrandIds: string | null
  sysBrandNames: string | null
}

export type SettingSupplierCreateItem = Record<string, unknown> & {
  supplierName: string
  supplierAbbreviation: string
  supplierCode?: string | null
  type: SettingSupplierType
  address?: string | null
  postalCode?: string | null
  qualificationCode?: string | null
  sysBrandIds?: Array<SettingSupplierId>
  isSysCreate?: boolean
}

export type SettingSupplierCreateInput = { suppliers: SettingSupplierCreateItem[] }

export type SettingSupplierPlatformQuery = {
  supplierName?: string | null
  supplierCode?: string | null
  type?: SettingSupplierType | null
  pageNo?: number
  pageSize?: number
}

export type SettingSupplierAddPlatformInput = {
  supplierIds: SettingSupplierId[]
  tenantId: SettingSupplierId
}

/**
 * 系统品牌候选（供应商表单那一列的 `brandOptions` 来源）。
 *
 * ⚠️ **两个检出里有两个同名端点，只有 supply 那个对得上**：
 *
 * | 类 | 类级映射 | 完整路径 | 是否本能力 |
 * | --- | --- | --- | --- |
 * | `erp-module-supply` 的 `MaterielController#getSysBrandPage:205` | `/supply/materiel` | `/admin-api/supply/materiel/get-sys-brand-page` | ✅ 页面打的就是它 |
 * | `erp-module-system` 包路径 `controller.adminmanage.materiel` 的 `PlatformMaterielController:95` | `/system/materiel` | `/system/materiel/get-sys-brand-page`（**不会**补 `/admin-api`） | ❌ 路径对不上 |
 *
 * 写契约/排障时不要混：平台物料库那条线属于另一个域，它的返回 DTO 虽然同名，但部署前缀与权限都不同。
 *
 * ⚠️ **页面拉它却不用它**：`hr/setting/supplier/[mode]/[id].vue` 在 `onMounted` 里无条件调
 * `getBrandList()`，用 `loopFetch({ pageSize: 200, maxPages: 100 })` 全量翻页拉；
 * 但消费这份数据的品牌多选列（模板 140-155 行的 `<template v-else-if="column.key === 'sysBrandIds'">`
 * 与 `columns` 里的 `{ key: 'sysBrandIds' }`）在固定检出里**都是注释掉的**。
 * 所以这个请求会真发，但当前**没有任何可见功能消费它的结果**，见该能力的 gaps。
 */
const SYS_BRAND_PAGE_URL = '/admin-api/supply/materiel/get-sys-brand-page'

/** 页面自己的全量拉取分片大小；SDK 把它当默认值，并把 `PageParam` 的 `@Max(500)` 当上限。 */
export const SETTING_SUPPLIER_BRAND_PAGE_SIZE_DEFAULT = 200
export const SETTING_SUPPLIER_BRAND_PAGE_SIZE_MAX = 500

export type SettingSupplierBrandQuery = {
  pageNo?: number
  pageSize?: number
}

export type SettingSupplierBrand = {
  /** 品牌ID；供应商表单勾选后按逗号 join 成 `sysBrandIds`。 */
  brandId: SettingSupplierId
  brandName: string | null
  brandAlias: string | null
  /** 品牌网址（后端标注为保留字段）。 */
  brandUrl: string | null
  orderSort: number | null
  /** 品牌介绍（后端标注为保留字段）。 */
  brandDesc: string | null
  brandLogo: string | null
  modifiedTime: number | null
  /** 是否失效：0 有效、1 失效。 */
  disabled: number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SettingSupplierId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function textOrEmptyOf (value: unknown, label: string): string {
  return textOf(value, label) ?? ''
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空或全为空格`)
  return value
}

function supplierTypeOf (value: unknown, label: string): SettingSupplierType {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`${label}不能为空`)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function booleanOrNumberOf (value: unknown, label: string): boolean | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为布尔值、数字或null`)
}

function nullableBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value
  throw new Error(`${label}必须为布尔值或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryTextOf (value: unknown, label: string): string {
  return textOf(value, label) ?? ''
}

function pageParamsOf (query: SettingSupplierQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    supplierName: queryTextOf(query.supplierName, '供应商名称'),
    supplierCode: queryTextOf(query.supplierCode, '供应商号'),
    type: query.type,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function platformPageParamsOf (query: SettingSupplierPlatformQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    supplierName: queryTextOf(query.supplierName, '供应商名称'),
    supplierCode: queryTextOf(query.supplierCode, '供应商号'),
    type: query.type === undefined ? null : query.type,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportParamsOf (query: SettingSupplierQuery = {}): JsonObject {
  return {
    supplierName: queryTextOf(query.supplierName, '供应商名称'),
    supplierCode: queryTextOf(query.supplierCode, '供应商号'),
    type: query.type,
  }
}

function rowOf (value: unknown, label: string): SettingSupplierRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    supplierCode: textOf(row.supplierCode, `${label}.supplierCode`),
    supplierName: textOf(row.supplierName, `${label}.supplierName`),
    supplierAbbreviation: textOf(row.supplierAbbreviation, `${label}.supplierAbbreviation`),
    type: nullableIntegerOf(row.type, `${label}.type`),
    category: nullableIntegerOf(row.category, `${label}.category`),
    address: textOf(row.address, `${label}.address`),
    qualificationCode: textOf(row.qualificationCode, `${label}.qualificationCode`),
    createTime: dateOf(row.createTime, `${label}.createTime`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
    updaterName: textOf(row.updaterName, `${label}.updaterName`),
    addedByTenant: booleanOrNumberOf(row.addedByTenant, `${label}.addedByTenant`),
    selectable: nullableBooleanOf(row.selectable, `${label}.selectable`),
    sysBrandIds: textOf(row.sysBrandIds, `${label}.sysBrandIds`),
    sysBrandNames: textOf(row.sysBrandNames, `${label}.sysBrandNames`),
  }
}

function pageOf (value: unknown, label: string): PageResult<SettingSupplierRow> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map((item, index) => rowOf(item, `${label}.list[${index}]`)), total: page.total as number }
}

function idArrayOf (value: unknown, label: string): SettingSupplierId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function brandPageParamsOf (query: SettingSupplierBrandQuery = {}): JsonObject {
  const rawPageNo = query.pageNo
  const pageNo = rawPageNo === undefined ? 1 : rawPageNo
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new Error('pageNo必须为正整数')
  const rawPageSize = query.pageSize
  const pageSize = rawPageSize === undefined ? SETTING_SUPPLIER_BRAND_PAGE_SIZE_DEFAULT : rawPageSize
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > SETTING_SUPPLIER_BRAND_PAGE_SIZE_MAX) {
    throw new Error(`pageSize必须是1到${SETTING_SUPPLIER_BRAND_PAGE_SIZE_MAX}之间的正整数（后端PageParam的最大值校验是500）`)
  }
  return { pageNo, pageSize }
}

function nullableIntegerFieldOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function brandOf (value: unknown, index: number): SettingSupplierBrand {
  const row = objectOf(value, `系统品牌[${index}]`)
  return {
    brandId: idOf(row.brandId, `系统品牌[${index}].brandId`),
    brandName: textOf(row.brandName, `系统品牌[${index}].brandName`),
    brandAlias: textOf(row.brandAlias, `系统品牌[${index}].brandAlias`),
    brandUrl: textOf(row.brandUrl, `系统品牌[${index}].brandUrl`),
    orderSort: nullableIntegerFieldOf(row.orderSort, `系统品牌[${index}].orderSort`),
    brandDesc: textOf(row.brandDesc, `系统品牌[${index}].brandDesc`),
    brandLogo: textOf(row.brandLogo, `系统品牌[${index}].brandLogo`),
    modifiedTime: nullableIntegerFieldOf(row.modifiedTime, `系统品牌[${index}].modifiedTime`),
    disabled: nullableIntegerFieldOf(row.disabled, `系统品牌[${index}].disabled`),
  }
}

function createPayloadOf (input: SettingSupplierCreateInput): JsonObject[] {
  const value = objectOf(input, '供应商批量创建参数')
  if (!Array.isArray(value.suppliers) || value.suppliers.length === 0) throw new Error('suppliers必须为非空数组')
  return value.suppliers.map((rawItem, index) => {
    const item = objectOf(rawItem, `suppliers[${index}]`)
    const supplierName = requiredTextOf(item.supplierName, `suppliers[${index}].supplierName`)
    const supplierAbbreviation = requiredTextOf(item.supplierAbbreviation, `suppliers[${index}].supplierAbbreviation`)
    const type = supplierTypeOf(item.type, `suppliers[${index}].type`)
    const supplierCode = textOrEmptyOf(item.supplierCode, `suppliers[${index}].supplierCode`)
    const address = textOrEmptyOf(item.address, `suppliers[${index}].address`)
    const qualificationCode = textOrEmptyOf(item.qualificationCode, `suppliers[${index}].qualificationCode`)
    const postalCode = textOrEmptyOf(item.postalCode, `suppliers[${index}].postalCode`)
    if (postalCode !== '' && !/^\d{6}$/.test(postalCode)) throw new Error(`suppliers[${index}].postalCode必须为6位数字`)
    const rawBrandIds = item.sysBrandIds === undefined || item.sysBrandIds === null ? [] : item.sysBrandIds
    if (!Array.isArray(rawBrandIds)) throw new Error(`suppliers[${index}].sysBrandIds必须为ID数组`)
    const sysBrandIds = rawBrandIds.map((brandId, brandIndex) => idOf(brandId, `suppliers[${index}].sysBrandIds[${brandIndex}]`)).join(',')
    const isSysCreate = item.isSysCreate === undefined ? true : item.isSysCreate
    if (typeof isSysCreate !== 'boolean') throw new Error(`suppliers[${index}].isSysCreate必须为布尔值`)
    return { ...item, supplierName, supplierAbbreviation, supplierCode, type, address, postalCode, qualificationCode, sysBrandIds, isSysCreate }
  })
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

export type SettingSupplierFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

function fileOf (response: AxiosResponse<ArrayBuffer>): SettingSupplierFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('供应商导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response, '系统供应商.xls'),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createSettingSupplierCapability (request: PortalRequest) {
  return {
    async list (query: SettingSupplierQuery = {}): Promise<PageResult<SettingSupplierRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: pageParamsOf(query) }), '供应商分页响应')
    },
    async export (query: SettingSupplierQuery = {}): Promise<SettingSupplierFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: exportParamsOf(query), responseType: 'arraybuffer' }))
    },
    async create (input: SettingSupplierCreateInput): Promise<SettingSupplierId[]> {
      const result = await request<unknown>({ url: `${ROOT}/batch-create`, method: 'post', data: createPayloadOf(input) })
      return idArrayOf(result, '供应商批量创建响应')
    },
    async remove (input: { id: SettingSupplierId }): Promise<true> {
      const id = idOf(input?.id, '供应商ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '供应商删除')
    },
    async platformList (query: SettingSupplierPlatformQuery = {}): Promise<PageResult<SettingSupplierRow>> {
      return pageOf(await request({ url: `${ROOT}/select-platform-page`, method: 'get', params: platformPageParamsOf(query) }), '平台供应商分页响应')
    },
    async addPlatform (input: SettingSupplierAddPlatformInput): Promise<true> {
      const supplierIds = idArrayOf(input?.supplierIds, 'supplierIds')
      const tenantId = idOf(input?.tenantId, 'tenantId')
      return trueOf(await request({ url: `${ROOT}/update-use-tenant`, method: 'post', data: { supplierIds, tenantId } }), '添加平台供应商')
    },

    /**
     * 系统品牌候选分页（供应商表单品牌多选列的数据源）。
     *
     * ⚠️ 该接口带 `@TenantIgnore`，返回的是**跨租户的系统品牌字典**，不是当前租户私有的品牌；
     * 页面也正因如此把它当作全局候选。
     */
    async listBrandCandidates (query: SettingSupplierBrandQuery = {}): Promise<PageResult<SettingSupplierBrand>> {
      const result = await request<unknown>({ url: SYS_BRAND_PAGE_URL, method: 'get', params: brandPageParamsOf(query) })
      const page = objectOf(result, '系统品牌分页响应')
      if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('系统品牌分页响应缺少有效list或total')
      return { list: page.list.map(brandOf), total: page.total as number }
    },
  }
}

export type SettingSupplierCapability = ReturnType<typeof createSettingSupplierCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const idParam = (name: string, description: string): ParamSpec => p(name, 'text', true, description)
const queryParams: ParamSpec[] = [
  p('supplierName', 'text', false, '供应商名称筛选；默认空字符串'),
  p('supplierCode', 'text', false, '供应商号筛选；默认空字符串'),
  p('type', 'text', false, '供应商类型；当前租户列表省略时发送undefined，平台选择页默认null'),
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'),
]

export const SETTING_SUPPLIER_METHODS = {
  'setting-supplier-list': 'list',
  'setting-supplier-export': 'export',
  'setting-supplier-create': 'create',
  'setting-supplier-remove': 'remove',
  'setting-supplier-platform-list': 'platformList',
  'setting-supplier-add-platform': 'addPlatform',
  'setting-supplier-brand-candidates': 'listBrandCandidates',
} as const

export const settingSupplierCapabilities: CapabilityDefinition[] = [
  { id: 'setting-supplier-list', title: '查询当前租户供应商', write: false, params: queryParams },
  { id: 'setting-supplier-export', title: '导出供应商', write: false, params: queryParams },
  { id: 'setting-supplier-create', title: '批量新增供应商', write: true, params: [p('suppliers', 'text', true, '供应商表单数组；每行按 Portal 的名称、简称、类型和邮编规则填写')] },
  { id: 'setting-supplier-remove', title: '删除供应商', write: true, params: [idParam('id', '供应商ID')] },
  { id: 'setting-supplier-platform-list', title: '查询平台供应商库', write: false, params: queryParams },
  { id: 'setting-supplier-add-platform', title: '添加平台供应商到当前租户', write: true, params: [p('supplierIds', 'text', true, '平台供应商ID数组'), idParam('tenantId', '当前租户ID；页面随请求提交，后端以会话租户为准')] },
  { id: 'setting-supplier-brand-candidates', title: '查询系统品牌候选', write: false, params: [p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '默认200（页面的分片大小），上限500')] },
].map(definition => ({ ...definition, pagePath: SETTING_SUPPLIER_PAGE_PATH, permission: SETTING_SUPPLIER_PERMISSION, moduleType: SETTING_SUPPLIER_MODULE_TYPE, httpInstance: 'platform' }))
