import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 存货科目配置」；静态锚点取固定的Portal/Java检出。 */
export const FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH = '/dashboard/finance/setting/inventory-account/list'
export const FINANCE_SETTING_INVENTORY_ACCOUNT_PERMISSION = '/dashboard/finance/setting/inventory-account'
export const FINANCE_SETTING_INVENTORY_ACCOUNT_MODULE_TYPE = null

const ROOT = '/admin-api/finance/inventory-config'
const MATERIAL_CATEGORY_TREE_URL = '/admin-api/supply/materiel-category/tree'
const MATERIAL_PAGE_URL = '/admin-api/supply/materiel/page'
const ADJUSTMENT_TYPE_TREE_URL = `${ROOT}/adjustment-type-tree`
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'
const XML_MIME = 'application/xml'

export type FinanceSettingInventoryAccountId = string | number
export type FinanceSettingInventoryAccountStatus = 0 | 1

export type FinanceSettingInventoryAccountQuery = {
  materialCategoryIds?: FinanceSettingInventoryAccountId[] | null
  materialCode?: string | null
  materialName?: string | null
  inventoryAccountIds?: FinanceSettingInventoryAccountId[] | null
  adjustmentTypeIds?: string | string[] | null
  outboundUseType?: string | null
  counterpartAccountIds?: FinanceSettingInventoryAccountId[] | null
  useOrgAttribute?: 0 | 1 | null
  status?: FinanceSettingInventoryAccountStatus | null
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingInventoryAccountRow = {
  id: FinanceSettingInventoryAccountId
  materialCategoryId: FinanceSettingInventoryAccountId | null
  materialCategoryIds: FinanceSettingInventoryAccountId[]
  materialCategoryName: string | null
  materialId: FinanceSettingInventoryAccountId | null
  materialCode: string | null
  materialName: string | null
  adjustmentTypeId: string | null
  adjustmentTypeLabel: string | null
  adjustmentCategoryName: string | null
  outboundUseType: string | null
  outboundUseTypeName: string | null
  inventoryAccountId: FinanceSettingInventoryAccountId | null
  inventoryAccountCode: string | null
  inventoryAccountName: string | null
  counterpartAccountId: FinanceSettingInventoryAccountId | null
  counterpartAccountCode: string | null
  counterpartAccountName: string | null
  useOrgAttribute: 0 | 1 | null
  useOrgAttributeName: string | null
  status: FinanceSettingInventoryAccountStatus
  statusName: string | null
  remark: string | null
  creator: string | null
  createTime: string | number | null
  updater: string | null
  updateTime: string | number | null
  editable: boolean | null
  deletable: boolean | null
  statusChangeable: boolean | null
  disableReason: string | null
}

export type FinanceSettingInventoryAccountMaterialRow = Record<string, unknown> & {
  id: FinanceSettingInventoryAccountId
  matCode: string | null
  matName: string | null
  status: number | null
  catNameCombination: string | null
}

export type FinanceSettingInventoryAccountMaterialQuery = {
  categoryIds: FinanceSettingInventoryAccountId[]
  matCode?: string | null
  matName?: string | null
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingInventoryAccountFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type FinanceSettingInventoryAccountFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type FinanceSettingInventoryAccountFile = FinanceSettingInventoryAccountFilePreview & {
  base64: string
}

export type FinanceSettingInventoryAccountImportResult = {
  totalCount: number
  successCount: number
  failureCount: number
  errorMessages: string[]
}

export type FinanceSettingInventoryAccountDraft = {
  id?: FinanceSettingInventoryAccountId
  materialCategoryIds: FinanceSettingInventoryAccountId[]
  materialId: FinanceSettingInventoryAccountId | null
  materialCode: string | null
  materialName: string | null
  /** Portal会发送但当前Java VO不落库的编辑态字段，保留以复刻页面请求。 */
  inventoryUnitOrgId: FinanceSettingInventoryAccountId | null
  unitType: string | number | null
  adjustmentTypeId: string
  outboundUseType: string | null
  inventoryAccountId: FinanceSettingInventoryAccountId
  inventoryAccountCode: string
  counterpartAccountId: FinanceSettingInventoryAccountId
  counterpartAccountCode: string
  counterpartAccountName: string
  useOrgAttribute: 0 | 1 | null
  status: FinanceSettingInventoryAccountStatus
  remark: string | null
}

export type FinanceSettingInventoryAccountCreateInput = Omit<FinanceSettingInventoryAccountDraft, 'id' | 'status' | 'unitType' | 'adjustmentTypeId'> & {
  id?: never
  unitType: string | number | Array<string | number> | null
  adjustmentTypeId: string | string[] | null
  status?: FinanceSettingInventoryAccountStatus | null
}

export type FinanceSettingInventoryAccountUpdateInput = {
  current: FinanceSettingInventoryAccountRow
  changes?: Partial<Omit<FinanceSettingInventoryAccountDraft, 'id'>> | null
}

export type FinanceSettingInventoryAccountPreparedUpdate = {
  draft: FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId }
  previous: FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId }
}

export type FinanceSettingInventoryAccountPreparedStatus = {
  draft: { id: FinanceSettingInventoryAccountId; status: FinanceSettingInventoryAccountStatus }
  previous: { id: FinanceSettingInventoryAccountId; status: FinanceSettingInventoryAccountStatus }
}

export type FinanceSettingInventoryAccountTreeNode = Record<string, unknown> & {
  id: FinanceSettingInventoryAccountId
  catName: string
  children: FinanceSettingInventoryAccountTreeNode[]
}

export type FinanceSettingInventoryAccountAdjustmentNode = Record<string, unknown> & {
  id: string
  label: string
  value: string
  children: FinanceSettingInventoryAccountAdjustmentNode[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingInventoryAccountId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingInventoryAccountId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须为${allowEmpty ? '字符串' : '非空字符串'}`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label, true)
}

function boundedNullableTextOf (value: unknown, label: string, maxLength: number): string | null {
  const result = nullableTextOf(value, label)
  if (result !== null && result.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return result
}

function requiredBoundedTextOf (value: unknown, label: string, maxLength: number): string {
  const result = textOf(value, label)
  if (result.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return result
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingInventoryAccountStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function nullableStatusOf (value: unknown, label: string): FinanceSettingInventoryAccountStatus | null {
  if (value === undefined || value === null || value === '') return null
  return statusOf(value, label)
}

function nullableFlagOf (value: unknown, label: string): 0 | 1 | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0或1`)
  return value
}

function nullableBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}只能是boolean或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize', allowed: number[] = [10, 20, 50, 100]): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !allowed.includes(Number(resolved))) throw new Error(`${label}必须是页面支持的${allowed.join('、')}`)
  return Number(resolved)
}

function idListOf (value: unknown, label: string): FinanceSettingInventoryAccountId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function joinedIdListOf (value: unknown, label: string): string {
  return idListOf(value, label).join(',')
}

function filterTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label, true)
}

function adjustmentTypeFilterOf (value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map((item, index) => textOf(item, `adjustmentTypeIds[${index}]`)).join(',')
  return textOf(value, 'adjustmentTypeIds', true)
}

function queryOf (query: FinanceSettingInventoryAccountQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  return {
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 20, 'pageSize'),
    materialCategoryIds: joinedIdListOf(source.materialCategoryIds, 'materialCategoryIds'),
    materialCode: filterTextOf(source.materialCode, 'materialCode'),
    materialName: filterTextOf(source.materialName, 'materialName'),
    inventoryAccountIds: joinedIdListOf(source.inventoryAccountIds, 'inventoryAccountIds'),
    adjustmentTypeIds: adjustmentTypeFilterOf(source.adjustmentTypeIds),
    outboundUseType: filterTextOf(source.outboundUseType, 'outboundUseType'),
    counterpartAccountIds: joinedIdListOf(source.counterpartAccountIds, 'counterpartAccountIds'),
    useOrgAttribute: nullableFlagOf(source.useOrgAttribute, 'useOrgAttribute'),
    status: nullableStatusOf(source.status, 'status'),
  }
}

function exportQueryOf (query: FinanceSettingInventoryAccountQuery = {}): Record<string, unknown> {
  const params = queryOf({ ...query, pageNo: 1, pageSize: 20 })
  delete params.pageNo
  delete params.pageSize
  return params
}

function materialQueryOf (query: FinanceSettingInventoryAccountMaterialQuery): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    matName: filterTextOf(query?.matName, 'matName'),
    type: null,
    matCode: filterTextOf(query?.matCode, 'matCode'),
    categoryIds: joinedIdListOf(query?.categoryIds, 'categoryIds') || null,
    status: 1,
    pageNo: pageNumberOf(query?.pageNo, 1, 'pageNo', [10, 50, 100, 500]),
    pageSize: pageNumberOf(query?.pageSize, 10, 'pageSize', [10, 50, 100, 500]),
  }
}

function rowOf (value: unknown, label = '存货科目配置列表行'): FinanceSettingInventoryAccountRow {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    materialCategoryId: nullableIdOf(row.materialCategoryId, `${label}.materialCategoryId`),
    materialCategoryIds: idListOf(row.materialCategoryIds, `${label}.materialCategoryIds`),
    materialCategoryName: nullableTextOf(row.materialCategoryName, `${label}.materialCategoryName`),
    materialId: nullableIdOf(row.materialId, `${label}.materialId`),
    materialCode: nullableTextOf(row.materialCode, `${label}.materialCode`),
    materialName: nullableTextOf(row.materialName, `${label}.materialName`),
    adjustmentTypeId: nullableTextOf(row.adjustmentTypeId, `${label}.adjustmentTypeId`),
    adjustmentTypeLabel: nullableTextOf(row.adjustmentTypeLabel, `${label}.adjustmentTypeLabel`),
    adjustmentCategoryName: nullableTextOf(row.adjustmentCategoryName, `${label}.adjustmentCategoryName`),
    outboundUseType: nullableTextOf(row.outboundUseType, `${label}.outboundUseType`),
    outboundUseTypeName: nullableTextOf(row.outboundUseTypeName, `${label}.outboundUseTypeName`),
    inventoryAccountId: nullableIdOf(row.inventoryAccountId, `${label}.inventoryAccountId`),
    inventoryAccountCode: nullableTextOf(row.inventoryAccountCode, `${label}.inventoryAccountCode`),
    inventoryAccountName: nullableTextOf(row.inventoryAccountName, `${label}.inventoryAccountName`),
    counterpartAccountId: nullableIdOf(row.counterpartAccountId, `${label}.counterpartAccountId`),
    counterpartAccountCode: nullableTextOf(row.counterpartAccountCode, `${label}.counterpartAccountCode`),
    counterpartAccountName: nullableTextOf(row.counterpartAccountName, `${label}.counterpartAccountName`),
    useOrgAttribute: nullableFlagOf(row.useOrgAttribute, `${label}.useOrgAttribute`),
    useOrgAttributeName: nullableTextOf(row.useOrgAttributeName, `${label}.useOrgAttributeName`),
    status: statusOf(row.status, `${label}.status`),
    statusName: nullableTextOf(row.statusName, `${label}.statusName`),
    remark: nullableTextOf(row.remark, `${label}.remark`),
    creator: nullableTextOf(row.creator, `${label}.creator`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updater: nullableTextOf(row.updater, `${label}.updater`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
    editable: nullableBooleanOf(row.editable, `${label}.editable`),
    deletable: nullableBooleanOf(row.deletable, `${label}.deletable`),
    statusChangeable: nullableBooleanOf(row.statusChangeable, `${label}.statusChangeable`),
    disableReason: nullableTextOf(row.disableReason, `${label}.disableReason`),
  }
}

function pageOf (value: unknown): PageResult<FinanceSettingInventoryAccountRow> {
  const page = objectOf(value, '存货科目配置分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('存货科目配置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `存货科目配置分页响应.list[${index}]`)), total: Number(page.total) }
}

function materialRowOf (value: unknown, index: number): FinanceSettingInventoryAccountMaterialRow {
  const row = objectOf(value, `物料候选[${index}]`)
  return {
    id: idOf(row.id, `物料候选[${index}].id`),
    matCode: nullableTextOf(row.matCode, `物料候选[${index}].matCode`),
    matName: nullableTextOf(row.matName, `物料候选[${index}].matName`),
    status: row.status === undefined || row.status === null ? null : Number(row.status),
    catNameCombination: nullableTextOf(row.catNameCombination, `物料候选[${index}].catNameCombination`),
  }
}

function materialPageOf (value: unknown): PageResult<FinanceSettingInventoryAccountMaterialRow> {
  const page = objectOf(value, '物料候选分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('物料候选分页响应缺少有效list或total')
  return { list: page.list.map(materialRowOf), total: Number(page.total) }
}

function categoryTreeNodeOf (value: unknown, label: string): FinanceSettingInventoryAccountTreeNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  const name = node.catName ?? node.name
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    catName: textOf(name, `${label}.catName`),
    children: children.map((item, index) => categoryTreeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function adjustmentTreeNodeOf (value: unknown, label: string): FinanceSettingInventoryAccountAdjustmentNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return {
    ...node,
    id: textOf(node.id, `${label}.id`),
    label: textOf(node.label, `${label}.label`),
    value: textOf(node.value, `${label}.value`),
    children: children.map((item, index) => adjustmentTreeNodeOf(item, `${label}.children[${index}]`)),
  }
}

function singleValueOf (value: unknown, label: string): string | number | null {
  const result = Array.isArray(value) ? (value.length ? value[value.length - 1] : null) : (value ?? null)
  if (result === null) return null
  if (typeof result !== 'string' && typeof result !== 'number') throw new Error(`${label}必须为字符串、数字或null`)
  return result
}

function requiredSingleTextOf (value: unknown, label: string, maxLength: number): string {
  const result = singleValueOf(value, label)
  if (typeof result !== 'string') throw new Error(`${label}必须为非空字符串`)
  return requiredBoundedTextOf(result, label, maxLength)
}

function payloadOf (value: unknown, label: string, requireId: boolean, defaultStatus: boolean): FinanceSettingInventoryAccountDraft & { id?: FinanceSettingInventoryAccountId } {
  const input = objectOf(value, label)
  const id = nullableIdOf(input.id, `${label}.id`)
  if (requireId && id === null) throw new Error(`${label}.id必须传入`)
  if (!requireId && id !== null) throw new Error(`${label}不能传id`)

  const materialId = nullableIdOf(input.materialId, `${label}.materialId`)
  const materialCategoryIds = idListOf(input.materialCategoryIds, `${label}.materialCategoryIds`)
  if (materialId === null && materialCategoryIds.length === 0) throw new Error(`${label}必须选择物料或至少一个物料分类`)

  const adjustmentTypeId = requiredSingleTextOf(input.adjustmentTypeId, `${label}.adjustmentTypeId`, 50)
  const inventoryAccountId = idOf(input.inventoryAccountId, `${label}.inventoryAccountId`)
  const inventoryAccountCode = requiredBoundedTextOf(input.inventoryAccountCode, `${label}.inventoryAccountCode`, 50)
  const counterpartAccountId = idOf(input.counterpartAccountId, `${label}.counterpartAccountId`)
  const counterpartAccountCode = requiredBoundedTextOf(input.counterpartAccountCode, `${label}.counterpartAccountCode`, 50)
  const counterpartAccountName = requiredBoundedTextOf(input.counterpartAccountName, `${label}.counterpartAccountName`, 200)
  const statusValue = input.status === undefined || (defaultStatus && input.status === null) ? 1 : statusOf(input.status, `${label}.status`)
  const useOrgAttribute = nullableFlagOf(input.useOrgAttribute, `${label}.useOrgAttribute`)
  const unitType = singleValueOf(input.unitType, `${label}.unitType`)
  const unitTypeValue = unitType === null ? null : unitType
  const remark = boundedNullableTextOf(input.remark, `${label}.remark`, 500)

  return {
    ...(id === null ? {} : { id }),
    materialCategoryIds,
    materialId,
    materialCode: boundedNullableTextOf(input.materialCode, `${label}.materialCode`, 100),
    materialName: boundedNullableTextOf(input.materialName, `${label}.materialName`, 200),
    inventoryUnitOrgId: nullableIdOf(input.inventoryUnitOrgId, `${label}.inventoryUnitOrgId`),
    unitType: unitTypeValue,
    adjustmentTypeId,
    outboundUseType: boundedNullableTextOf(input.outboundUseType, `${label}.outboundUseType`, 50),
    inventoryAccountId,
    inventoryAccountCode,
    counterpartAccountId,
    counterpartAccountCode,
    counterpartAccountName,
    useOrgAttribute,
    status: statusValue,
    remark,
  }
}

function rowDraftOf (row: FinanceSettingInventoryAccountRow, label: string): FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId } {
  return payloadOf(row, label, true, false) as FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId }
}

function createSubmitDraftOf (value: unknown): FinanceSettingInventoryAccountDraft {
  const input = objectOf(value, '提交创建存货科目配置输入')
  return payloadOf(input.draft, '创建存货科目配置draft', false, true) as FinanceSettingInventoryAccountDraft
}

function updateSubmitDraftOf (value: unknown): FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId } {
  const input = objectOf(value, '提交编辑存货科目配置输入')
  return rowDraftOf(objectOf(input.draft, '编辑存货科目配置draft') as unknown as FinanceSettingInventoryAccountRow, '编辑存货科目配置draft')
}

function statusDraftOf (value: unknown, label: string): { id: FinanceSettingInventoryAccountId; status: FinanceSettingInventoryAccountStatus } {
  const draft = objectOf(value, label)
  return { id: idOf(draft.id, `${label}.id`), status: statusOf(draft.status, `${label}.status`) }
}

function binaryOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('存货科目配置下载响应不是二进制文件')
}

function responseHeaderOf (response: AxiosResponse, name: string): string | null {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' && value ? value : null
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fileName: string, fallbackContentType: string): FinanceSettingInventoryAccountFile {
  const bytes = binaryOf(response?.data)
  if (bytes.byteLength === 0) throw new Error('存货科目配置下载响应为空文件')
  return {
    fileName,
    contentType: responseHeaderOf(response, 'content-type') ?? fallbackContentType,
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function contentTypeOf (fileName: string, value: unknown): string {
  if (value !== undefined && value !== null && value !== '') return textOf(value, 'contentType', true)
  const lower = fileName.toLowerCase()
  return lower.endsWith('.xlsx') ? XLSX_MIME : lower.endsWith('.xls') ? XLS_MIME : XML_MIME
}

function fileInputOf (value: unknown): { preview: FinanceSettingInventoryAccountFilePreview; bytes: Uint8Array } {
  const input = objectOf(value, '存货科目配置导入文件')
  const fileName = textOf(input.fileName, 'fileName')
  if (!/\.(xml|xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  const base64 = textOf(input.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  const contentType = contentTypeOf(fileName, input.contentType)
  return { preview: { fileName, contentType, byteLength: bytes.byteLength }, bytes: new Uint8Array(bytes) }
}

function formDataOf (file: { preview: FinanceSettingInventoryAccountFilePreview; bytes: Uint8Array }): FormData {
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

function importResultOf (value: unknown): FinanceSettingInventoryAccountImportResult {
  const result = objectOf(value, '存货科目配置导入响应')
  for (const name of ['totalCount', 'successCount', 'failureCount']) {
    if (!Number.isSafeInteger(result[name]) || Number(result[name]) < 0) throw new Error(`${name}必须为非负整数`)
  }
  const errorMessages = result.errorMessages === undefined || result.errorMessages === null ? [] : result.errorMessages
  if (!Array.isArray(errorMessages) || errorMessages.some(item => typeof item !== 'string')) throw new Error('errorMessages必须为字符串数组')
  return {
    totalCount: Number(result.totalCount),
    successCount: Number(result.successCount),
    failureCount: Number(result.failureCount),
    errorMessages: [...errorMessages],
  }
}

export function createFinanceSettingInventoryAccountCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingInventoryAccountQuery = {}): Promise<PageResult<FinanceSettingInventoryAccountRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },

    async materialCategoryTree (): Promise<FinanceSettingInventoryAccountTreeNode[]> {
      const result = await request<unknown>({ url: MATERIAL_CATEGORY_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('存货科目配置物料分类树响应必须是数组')
      return result.map((item, index) => categoryTreeNodeOf(item, `存货科目配置物料分类树[${index}]`))
    },

    async adjustmentTypeTree (): Promise<FinanceSettingInventoryAccountAdjustmentNode[]> {
      const result = await request<unknown>({ url: ADJUSTMENT_TYPE_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('存货科目配置存货调整类型树响应必须是数组')
      return result.map((item, index) => adjustmentTreeNodeOf(item, `存货科目配置调整类型树[${index}]`))
    },

    async searchMaterials (query: FinanceSettingInventoryAccountMaterialQuery): Promise<PageResult<FinanceSettingInventoryAccountMaterialRow>> {
      if (idListOf(query?.categoryIds, 'categoryIds').length === 0) throw new Error('categoryIds至少选择一个物料分类')
      return materialPageOf(await request({ url: MATERIAL_PAGE_URL, method: 'get', params: materialQueryOf(query) }))
    },

    prepareCreate (input: FinanceSettingInventoryAccountCreateInput): { draft: FinanceSettingInventoryAccountDraft } {
      return { draft: payloadOf(input, '创建存货科目配置', false, true) as FinanceSettingInventoryAccountDraft }
    },

    async create (input: { draft: FinanceSettingInventoryAccountDraft }): Promise<FinanceSettingInventoryAccountId> {
      const draft = createSubmitDraftOf(input)
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: draft }), '新建存货科目配置返回的id')
    },

    prepareUpdate (input: FinanceSettingInventoryAccountUpdateInput): FinanceSettingInventoryAccountPreparedUpdate {
      const current = rowOf(input?.current, '编辑存货科目配置当前值')
      const changes = input?.changes === undefined || input?.changes === null ? {} : objectOf(input.changes, '编辑存货科目配置变更')
      if (Object.prototype.hasOwnProperty.call(changes, 'id')) throw new Error('编辑存货科目配置变更不允许修改id')
      const previous = rowDraftOf(current, '编辑存货科目配置previous')
      const draft = payloadOf({ ...current, ...changes }, '编辑存货科目配置draft', true, false) as FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId }
      return { draft, previous }
    },

    async update (input: { draft: FinanceSettingInventoryAccountDraft & { id: FinanceSettingInventoryAccountId } }): Promise<true> {
      const draft = updateSubmitDraftOf(input)
      const result = await request({ url: `${ROOT}/update`, method: 'put', data: draft })
      if (result !== true) throw new Error('更新存货科目配置响应不是true')
      return true
    },

    prepareSetStatus (input: { current: FinanceSettingInventoryAccountRow; targetStatus: FinanceSettingInventoryAccountStatus }): FinanceSettingInventoryAccountPreparedStatus {
      const current = rowOf(input?.current, '启停存货科目配置当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与当前status相反')
      return {
        draft: { id: current.id, status: targetStatus },
        previous: { id: current.id, status: current.status },
      }
    },

    async setStatus (input: { draft: { id: FinanceSettingInventoryAccountId; status: FinanceSettingInventoryAccountStatus } }): Promise<true> {
      const draft = statusDraftOf(input?.draft, '启停存货科目配置draft')
      const result = await request({ url: `${ROOT}/update-status`, method: 'put', params: draft })
      if (result !== true) throw new Error('启停存货科目配置响应不是true')
      return true
    },

    async export (query: FinanceSettingInventoryAccountQuery = {}): Promise<FinanceSettingInventoryAccountFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: exportQueryOf(query), responseType: 'arraybuffer' })
      return downloadedFileOf(response, '存货科目配置.xls', XLS_MIME)
    },

    async downloadTemplate (): Promise<FinanceSettingInventoryAccountFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', responseType: 'arraybuffer' })
      return downloadedFileOf(response, '存货科目配置导入模板.xlsx', XLSX_MIME)
    },

    prepareImport (input: FinanceSettingInventoryAccountFileInput): FinanceSettingInventoryAccountFilePreview {
      return fileInputOf(input).preview
    },

    async importFile (input: FinanceSettingInventoryAccountFileInput): Promise<FinanceSettingInventoryAccountImportResult> {
      const file = fileInputOf(input)
      return importResultOf(await request({ url: `${ROOT}/import-excel`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } }))
    },
  }
}

export type FinanceSettingInventoryAccountCapability = ReturnType<typeof createFinanceSettingInventoryAccountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const fileParams: ParamSpec[] = [p('fileName', 'text', true, '上传文件名；Portal文件控件接受.xml、.xlsx、.xls'), p('base64', 'text', true, '非空标准Base64文件内容'), p('contentType', 'text', false, '文件MIME类型；省略时按扩展名推导')]
const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const listParams: ParamSpec[] = [
  p('materialCategoryIds', 'tree', false, '物料分类ID数组；页面多选后按英文逗号提交，默认[]'),
  p('materialCode', 'text', false, '物料编码模糊筛选；默认null'),
  p('materialName', 'text', false, '物料名称模糊筛选；默认null'),
  p('inventoryAccountIds', 'tree', false, '存货科目ID数组；页面多选后按英文逗号提交，默认[]'),
  p('adjustmentTypeIds', 'tree', false, '存货调整类型ID或ID数组；页面单选时为INBOUND_/OUTBOUND_值'),
  p('outboundUseType', 'enum', false, 'inventory_outbound_use_type字典值；默认null'),
  p('counterpartAccountIds', 'tree', false, '对方科目ID数组；页面多选后按英文逗号提交，默认[]'),
  { ...p('useOrgAttribute', 'enum', false, '是否使用组织财务属性：0否、1是'), options: [{ label: '否', value: 0 }, { label: '是', value: 1 }] },
  { ...p('status', 'enum', false, '状态筛选：0停用、1启用；默认null表示全部'), options: statusOptions },
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '每页条数；默认20，只支持10、20、50、100'),
]
const draftParams: ParamSpec[] = [
  p('materialCategoryIds', 'tree', false, '分类维度ID数组；无materialId时至少一个'),
  p('materialId', 'search', false, '物料ID；有值时按物料维度保存'),
  p('materialCode', 'text', false, '物料编码；由物料候选返回'),
  p('materialName', 'text', false, '物料名称；由物料候选返回'),
  p('inventoryUnitOrgId', 'tree', false, 'Portal编辑态发送的所属单元ID；当前Java保存VO不落库'),
  p('unitType', 'enum', false, 'Portal编辑态发送的单元类型；当前Java保存VO不落库'),
  p('adjustmentTypeId', 'text', true, '存货调整类型ID，来自adjustment-type-tree节点id'),
  p('outboundUseType', 'enum', false, 'inventory_outbound_use_type字典值'),
  p('inventoryAccountId', 'search', true, '存货科目ID；来自会计科目树'),
  p('inventoryAccountCode', 'text', true, '存货科目编码'),
  p('counterpartAccountId', 'search', true, '对方科目ID；来自会计科目树'),
  p('counterpartAccountCode', 'text', true, '对方科目编码'),
  p('counterpartAccountName', 'text', true, '对方科目名称'),
  { ...p('useOrgAttribute', 'enum', false, '0否、1是；默认null'), options: [{ label: '否', value: 0 }, { label: '是', value: 1 }] },
  { ...p('status', 'enum', false, '0停用、1启用；创建默认启用'), options: statusOptions },
  p('remark', 'text', false, '备注；最多500个字符'),
]

export const FINANCE_SETTING_INVENTORY_ACCOUNT_METHODS = {
  'finance-setting-inventory-account-list': 'list',
  'finance-setting-inventory-account-material-category-tree': 'materialCategoryTree',
  'finance-setting-inventory-account-adjustment-type-tree': 'adjustmentTypeTree',
  'finance-setting-inventory-account-material-options': 'searchMaterials',
  'finance-setting-inventory-account-prepare-create': 'prepareCreate',
  'finance-setting-inventory-account-create': 'create',
  'finance-setting-inventory-account-prepare-update': 'prepareUpdate',
  'finance-setting-inventory-account-update': 'update',
  'finance-setting-inventory-account-prepare-set-status': 'prepareSetStatus',
  'finance-setting-inventory-account-set-status': 'setStatus',
  'finance-setting-inventory-account-export': 'export',
  'finance-setting-inventory-account-download-template': 'downloadTemplate',
  'finance-setting-inventory-account-prepare-import': 'prepareImport',
  'finance-setting-inventory-account-import': 'importFile',
} as const

export const financeSettingInventoryAccountCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-inventory-account-list', title: '查询存货科目配置', write: false, params: listParams },
  { id: 'finance-setting-inventory-account-material-category-tree', title: '查询存货科目配置物料分类树', write: false, params: [] },
  { id: 'finance-setting-inventory-account-adjustment-type-tree', title: '查询存货调整类型树', write: false, params: [] },
  { id: 'finance-setting-inventory-account-material-options', title: '查询存货科目配置物料候选', write: false, params: [p('categoryIds', 'tree', true, '已选物料分类ID数组；页面未选择分类时不会打开物料弹窗'), p('matCode', 'text', false, '物料编码关键字'), p('matName', 'text', false, '物料名称关键字'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认10，只支持10、50、100、500')] },
  { id: 'finance-setting-inventory-account-prepare-create', title: '准备创建存货科目配置', write: false, params: draftParams },
  { id: 'finance-setting-inventory-account-create', title: '创建存货科目配置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整Portal提交草稿')] },
  { id: 'finance-setting-inventory-account-prepare-update', title: '准备编辑存货科目配置', write: false, params: [p('current', 'text', true, '来自最新列表行的完整配置'), p('changes', 'text', false, '本次明确修改的字段；未给字段沿用current')] },
  { id: 'finance-setting-inventory-account-update', title: '编辑存货科目配置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整{id,...}草稿')] },
  { id: 'finance-setting-inventory-account-prepare-set-status', title: '准备启停存货科目配置', write: false, params: [p('current', 'text', true, '来自最新列表行的完整配置'), { ...p('targetStatus', 'enum', true, '与current.status相反的绝对状态'), options: statusOptions }] },
  { id: 'finance-setting-inventory-account-set-status', title: '启停存货科目配置', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{id,status}草稿')] },
  { id: 'finance-setting-inventory-account-export', title: '导出存货科目配置', write: false, params: listParams.filter(param => !['pageNo', 'pageSize'].includes(param.name)) },
  { id: 'finance-setting-inventory-account-download-template', title: '下载存货科目配置导入模板', write: false, params: [] },
  { id: 'finance-setting-inventory-account-prepare-import', title: '准备导入存货科目配置文件', write: false, params: fileParams },
  { id: 'finance-setting-inventory-account-import', title: '导入存货科目配置', write: true, params: fileParams },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_INVENTORY_ACCOUNT_PAGE_PATH,
  permission: FINANCE_SETTING_INVENTORY_ACCOUNT_PERMISSION,
  moduleType: FINANCE_SETTING_INVENTORY_ACCOUNT_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
