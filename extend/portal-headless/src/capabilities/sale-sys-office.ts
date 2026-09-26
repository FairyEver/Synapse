import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「系统设置 → 销售设置 → 机构扩展」。 */
export const SALE_SYS_OFFICE_PAGE_PATH = '/dashboard/sale/sys/office/list'
export const SALE_SYS_OFFICE_PERMISSION = '/dashboard/sale/frame/sys/office'
export const SALE_SYS_OFFICE_EDIT_PERMISSION = 'sys:office:edit'
export const SALE_SYS_OFFICE_STOP_PERMISSION = 'sys:office:stop'
export const SALE_SYS_OFFICE_STOP_BATCH_PERMISSION = 'sys:office:stopBatch'
export const SALE_SYS_OFFICE_MODULE_TYPE = 60

const ROOT = '/admin-api/sales/organization'
const DICT_PAGE_URL = '/admin-api/system/dict-data/page'
const BUSINESS_TREE_URL = '/admin-api/sales/item/getShopCategoryItemTree'
const CHECK_CODE_URL = '/vue/sys/office/checkOfficeCode'

export type SaleSysOfficeId = string | number
export type SaleSysOfficeScalar = string | number

export type SaleSysOfficeQuery = {
  parentId?: SaleSysOfficeScalar | null
  name?: string | null
  code?: string | null
  salesCode?: string | null
  salesType?: SaleSysOfficeScalar | null
  salesStatus?: SaleSysOfficeScalar | null
  pageNo?: number
  pageSize?: number
}

export type SaleSysOfficeRow = Record<string, unknown> & {
  id: SaleSysOfficeId
  pid: SaleSysOfficeId | null
  parentId: SaleSysOfficeId | null
  name: string | null
  code: string | null
  salesCode: string | null
  salesType: number | null
  salesGrade: number | null
  salesMaster: SaleSysOfficeScalar | null
  salesStatus: number | null
  groupSalesAreaCodes: string | null
  salesBusiness: string | null
  salesId: SaleSysOfficeScalar | null
  salesParentId: SaleSysOfficeScalar | null
  defaultSalesParentId: SaleSysOfficeScalar | null
  salesParentIds: string | null
  updateTime: string | number | null
}

export type SaleSysOfficeTreeNode = Record<string, unknown> & {
  id: SaleSysOfficeId
  name: string
  children: SaleSysOfficeTreeNode[]
  users?: SaleSysOfficeTreeNode[]
}

export type SaleSysOfficeDictOption = Record<string, unknown> & {
  value: number
  label: string
}

export type SaleSysOfficeBusinessNode = Record<string, unknown> & {
  children: SaleSysOfficeBusinessNode[]
}

export type SaleSysOfficeForm = Record<string, unknown> & {
  id: SaleSysOfficeId
  salesId: SaleSysOfficeScalar
  salesCode: string
  salesType: number
  salesParentId: SaleSysOfficeScalar
  salesParentIds?: string | null
  salesGrade?: number | null
  salesMaster?: SaleSysOfficeScalar | null
  salesStatus: number
  groupSalesAreaCodes?: Array<SaleSysOfficeScalar> | null
  groupSalesBusinessCodes?: Array<SaleSysOfficeScalar> | null
}

export type SaleSysOfficeUpdateDraft = Record<string, unknown> & {
  id: SaleSysOfficeId
  salesId: SaleSysOfficeScalar
  salesCode: string
  salesType: number
  salesParentId: SaleSysOfficeScalar
  salesStatus: number
  salesParentIds?: string | null
  salesGrade?: number | null
  salesMaster: SaleSysOfficeScalar | ''
  groupSalesAreaCodes?: string
  salesBusiness?: string
}

export type SaleSysOfficeUpdatePreparation = { draft: SaleSysOfficeUpdateDraft }
export type SaleSysOfficeStopPreparation = { id: SaleSysOfficeId }
export type SaleSysOfficeBatchStopPreparation = { ids: SaleSysOfficeId[] }
export type SaleSysOfficeFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleSysOfficeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function nullableIdOf (value: unknown, label: string): SaleSysOfficeId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function scalarOf (value: unknown, label: string): SaleSysOfficeScalar {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`${label}必须是非空字符串或安全整数`)
}

function scalarOrEmptyOf (value: unknown, label: string): SaleSysOfficeScalar | '' {
  if (value === undefined || value === null || value === '') return ''
  return scalarOf(value, label)
}

function textOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null) {
    if (!required) return ''
    throw new Error(`${label}必填`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && value.length === 0) throw new Error(`${label}必填`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数或null`)
  return value as number
}

function requiredNumberOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || value === 0) throw new Error(`${label}必填且必须是非零安全整数`)
  return value as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是10、20、50或100')
  return result as number
}

function rowOf (value: unknown, label: string): SaleSysOfficeRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    pid: nullableIdOf(row.pid, `${label}.pid`),
    parentId: nullableIdOf(row.parentId, `${label}.parentId`),
    name: nullableTextOf(row.name, `${label}.name`),
    code: nullableTextOf(row.code, `${label}.code`),
    salesCode: nullableTextOf(row.salesCode, `${label}.salesCode`),
    salesType: nullableNumberOf(row.salesType, `${label}.salesType`),
    salesGrade: nullableNumberOf(row.salesGrade, `${label}.salesGrade`),
    salesMaster: row.salesMaster === undefined || row.salesMaster === null ? null : scalarOf(row.salesMaster, `${label}.salesMaster`),
    salesStatus: nullableNumberOf(row.salesStatus, `${label}.salesStatus`),
    groupSalesAreaCodes: nullableTextOf(row.groupSalesAreaCodes, `${label}.groupSalesAreaCodes`),
    salesBusiness: nullableTextOf(row.salesBusiness, `${label}.salesBusiness`),
    salesId: row.salesId === undefined || row.salesId === null ? null : scalarOf(row.salesId, `${label}.salesId`),
    salesParentId: row.salesParentId === undefined || row.salesParentId === null ? null : scalarOf(row.salesParentId, `${label}.salesParentId`),
    defaultSalesParentId: row.defaultSalesParentId === undefined || row.defaultSalesParentId === null ? null : scalarOf(row.defaultSalesParentId, `${label}.defaultSalesParentId`),
    salesParentIds: nullableTextOf(row.salesParentIds, `${label}.salesParentIds`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
  }
}

function pageOf (value: unknown): PageResult<SaleSysOfficeRow> {
  const page = objectOf(value, '机构扩展分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('机构扩展分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `机构扩展列表[${index}]`)), total: page.total as number }
}

function rawTreeNodeOf (value: unknown, label: string): SaleSysOfficeTreeNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  const users = node.users === undefined || node.users === null ? undefined : node.users
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  if (users !== undefined && !Array.isArray(users)) throw new Error(`${label}.users必须是数组`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: typeof node.name === 'string' ? node.name : '',
    children: children.map((item, index) => rawTreeNodeOf(item, `${label}.children[${index}]`)),
    ...(users === undefined ? {} : { users: users.map((item, index) => rawTreeNodeOf(item, `${label}.users[${index}]`)) }),
  }
}

function treeOf (value: unknown, label: string): SaleSysOfficeTreeNode[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是树数组`)
  return value.map((item, index) => rawTreeNodeOf(item, `${label}[${index}]`))
}

function primaryPersonNodeOf (value: unknown, label: string): SaleSysOfficeTreeNode {
  const node = rawTreeNodeOf(value, label)
  const appendedChildren = [...node.children, ...(node.users ?? [])]
  const realName = typeof node.realName === 'string' && node.realName !== '' ? node.realName : null
  return {
    ...node,
    name: realName ?? node.name,
    ...(realName === null ? { disabled: true } : {}),
    children: appendedChildren.map((item, index) => primaryPersonNodeOf(item, `${label}.children[${index}]`)),
  }
}

function primaryPersonTreeOf (value: unknown): SaleSysOfficeTreeNode[] {
  if (!Array.isArray(value)) throw new Error('机构负责人树必须是树数组')
  return value.map((item, index) => primaryPersonNodeOf(item, `机构负责人树[${index}]`))
}

function dictOptionsOf (value: unknown, label: string): SaleSysOfficeDictOption[] {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list)) throw new Error(`${label}.list必须是数组`)
  return page.list.map((item, index) => {
    const option = objectOf(item, `${label}.list[${index}]`)
    const numericValue = Number(option.value)
    if (!Number.isFinite(numericValue)) throw new Error(`${label}.list[${index}].value必须可转换为数字`)
    return { ...option, value: numericValue, label: textOf(option.label, `${label}.list[${index}].label`) }
  })
}

function businessNodeOf (value: unknown, label: string): SaleSysOfficeBusinessNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return { ...node, children: children.map((item, index) => businessNodeOf(item, `${label}.children[${index}]`)) }
}

function businessTreeOf (value: unknown): SaleSysOfficeBusinessNode[] {
  if (value === undefined || value === null) return []
  const root = objectOf(value, '销售业务树响应')
  const children = root.children === undefined || root.children === null ? [] : root.children
  if (!Array.isArray(children)) throw new Error('销售业务树响应.children必须是数组')
  return children.map((item, index) => businessNodeOf(item, `销售业务树响应.children[${index}]`))
}

function queryParamsOf (query: SaleSysOfficeQuery = {}, includeOrder = false): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...(includeOrder ? { order: '', orderField: '' } : {}),
    parentId: scalarOrEmptyOf(query.parentId, 'parentId'),
    name: textOf(query.name, 'name'),
    code: textOf(query.code, 'code'),
    salesCode: textOf(query.salesCode, 'salesCode'),
    salesType: scalarOrEmptyOf(query.salesType, 'salesType'),
    salesStatus: scalarOrEmptyOf(query.salesStatus === undefined ? 1 : query.salesStatus, 'salesStatus'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  return params
}

function optionPageParams (dictType: string): Record<string, unknown> {
  return { dictType, pageNo: 1, pageSize: 100 }
}

function scalarArrayOf (value: unknown, label: string): SaleSysOfficeScalar[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => scalarOf(item, `${label}[${index}]`))
}

function optionalNumberPropertyOf (form: Record<string, unknown>, key: string, label: string): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(form, key)) return undefined
  return nullableNumberOf(form[key], `${label}.${key}`)
}

function optionalTextPropertyOf (form: Record<string, unknown>, key: string, label: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(form, key)) return undefined
  return nullableTextOf(form[key], `${label}.${key}`)
}

function updatePayloadFromForm (value: unknown): SaleSysOfficeUpdateDraft {
  const form = objectOf(value, '机构扩展编辑表单')
  const id = idOf(form.id, '机构ID')
  const salesId = scalarOf(form.salesId, 'salesId')
  const salesCode = textOf(form.salesCode, 'salesCode', true)
  const salesType = requiredNumberOf(form.salesType, 'salesType')
  const salesParentId = scalarOf(form.salesParentId, 'salesParentId')
  if (String(salesParentId) === String(salesId)) throw new Error('不能选择自己作为上级')
  const salesStatus = requiredNumberOf(form.salesStatus, 'salesStatus')
  const payload: SaleSysOfficeUpdateDraft = {
    id,
    salesId,
    salesCode,
    salesType,
    salesParentId,
    salesStatus,
    salesMaster: scalarOrEmptyOf(form.salesMaster, 'salesMaster'),
  }
  const salesParentIds = optionalTextPropertyOf(form, 'salesParentIds', '机构扩展编辑表单')
  if (salesParentIds !== undefined) payload.salesParentIds = salesParentIds
  const salesGrade = optionalNumberPropertyOf(form, 'salesGrade', '机构扩展编辑表单')
  if (salesGrade !== undefined) payload.salesGrade = salesGrade
  if (salesType === 3) {
    payload.groupSalesAreaCodes = scalarArrayOf(form.groupSalesAreaCodes, 'groupSalesAreaCodes').join(',')
    payload.salesBusiness = scalarArrayOf(form.groupSalesBusinessCodes, 'groupSalesBusinessCodes').join(',')
  }
  return payload
}

function updatePayloadOf (value: unknown): SaleSysOfficeUpdateDraft {
  const draft = objectOf(value, '机构扩展编辑草稿')
  const id = idOf(draft.id, '机构ID')
  const salesId = scalarOf(draft.salesId, 'salesId')
  const salesCode = textOf(draft.salesCode, 'salesCode', true)
  const salesType = requiredNumberOf(draft.salesType, 'salesType')
  const salesParentId = scalarOf(draft.salesParentId, 'salesParentId')
  if (String(salesParentId) === String(salesId)) throw new Error('不能选择自己作为上级')
  const salesStatus = requiredNumberOf(draft.salesStatus, 'salesStatus')
  const payload: SaleSysOfficeUpdateDraft = {
    id,
    salesId,
    salesCode,
    salesType,
    salesParentId,
    salesStatus,
    salesMaster: scalarOrEmptyOf(draft.salesMaster, 'salesMaster'),
  }
  const salesParentIds = optionalTextPropertyOf(draft, 'salesParentIds', '机构扩展编辑草稿')
  if (salesParentIds !== undefined) payload.salesParentIds = salesParentIds
  const salesGrade = optionalNumberPropertyOf(draft, 'salesGrade', '机构扩展编辑草稿')
  if (salesGrade !== undefined) payload.salesGrade = salesGrade
  if (salesType === 3) {
    payload.groupSalesAreaCodes = textOf(draft.groupSalesAreaCodes, 'groupSalesAreaCodes')
    payload.salesBusiness = textOf(draft.salesBusiness, 'salesBusiness')
  }
  return payload
}

function activeFilterOf (value: unknown): number {
  if (String(value) !== '1') throw new Error('只有筛选启用状态时Portal才显示停用操作')
  return 1
}

function idsOf (value: unknown): SaleSysOfficeId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids至少包含一个机构ID')
  const ids = value.map((item, index) => idOf(item, `ids[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('ids不能包含重复机构ID')
  return ids
}

function bytesOf (response: AxiosResponse<ArrayBuffer>): Uint8Array {
  const data: unknown = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('机构扩展导出响应不是二进制文件')
}

function fileNameOf (response: AxiosResponse<ArrayBuffer>): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return '机构.xls'
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || '机构.xls'
}

function fileOf (response: AxiosResponse<ArrayBuffer>): SaleSysOfficeFile {
  const bytes = bytesOf(response)
  if (bytes.byteLength === 0) throw new Error('机构扩展导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: fileNameOf(response),
    contentType: typeof value === 'string' && value ? value : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

/** 机构扩展页的列表、树、编辑和停用能力。 */
export function createSaleSysOfficeCapability (request: PortalRequest) {
  return {
    async list (query: SaleSysOfficeQuery = {}): Promise<PageResult<SaleSysOfficeRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryParamsOf(query, true), httpInstance: 'platform' }))
    },

    async organizationTree (): Promise<SaleSysOfficeTreeNode[]> {
      return treeOf(await request({ url: `${ROOT}/tree`, method: 'get', params: { isSalesTree: false }, httpInstance: 'platform' }), '机构树')
    },

    async statusOptions (): Promise<SaleSysOfficeDictOption[]> {
      return dictOptionsOf(await request({ url: DICT_PAGE_URL, method: 'get', params: optionPageParams('sales_organization_status'), httpInstance: 'platform' }), '机构状态字典')
    },

    async gradeOptions (): Promise<SaleSysOfficeDictOption[]> {
      return dictOptionsOf(await request({ url: DICT_PAGE_URL, method: 'get', params: optionPageParams('sys_office_grade'), httpInstance: 'platform' }), '机构级别字典')
    },

    async typeOptions (): Promise<SaleSysOfficeDictOption[]> {
      return dictOptionsOf(await request({ url: DICT_PAGE_URL, method: 'get', params: optionPageParams('sys_office_type'), httpInstance: 'platform' }), '机构类型字典')
    },

    async get (input: { id: SaleSysOfficeId }): Promise<SaleSysOfficeRow> {
      const id = idOf(input?.id, '机构ID')
      return rowOf(await request({ url: `${ROOT}/detail/${id}`, method: 'get', httpInstance: 'platform' }), '机构扩展详情')
    },

    async salesTree (): Promise<SaleSysOfficeTreeNode[]> {
      return treeOf(await request({ url: `${ROOT}/tree`, method: 'get', params: {}, httpInstance: 'platform' }), '销售机构树')
    },

    async primaryPersonTree (): Promise<SaleSysOfficeTreeNode[]> {
      return primaryPersonTreeOf(await request({ url: `${ROOT}/tree`, method: 'get', params: { isNeedUsers: true, isSalesTree: false }, httpInstance: 'platform' }))
    },

    async businessTree (): Promise<SaleSysOfficeBusinessNode[]> {
      return businessTreeOf(await request({ url: BUSINESS_TREE_URL, method: 'get', httpInstance: 'platform' }))
    },

    async checkCode (input: { code: string; oldCode?: string | null }): Promise<boolean> {
      const code = textOf(input?.code, 'code', true)
      const oldCode = textOf(input?.oldCode, 'oldCode')
      if (oldCode && code === oldCode) return true
      const params = oldCode ? { code, oldCode } : { code }
      const result = await request({ url: CHECK_CODE_URL, method: 'get', params, httpInstance: 'crm' })
      if (typeof result !== 'boolean') throw new Error('机构编码校验响应不是boolean')
      return result
    },

    prepareUpdate (input: { form: SaleSysOfficeForm }): SaleSysOfficeUpdatePreparation {
      return { draft: updatePayloadFromForm(input?.form) }
    },

    async update (input: { draft: SaleSysOfficeUpdateDraft }): Promise<void> {
      const draft = updatePayloadOf(input?.draft)
      const result = await request({ url: `${ROOT}/update`, method: 'put', data: draft, httpInstance: 'platform' })
      if (result !== true) throw new Error('机构扩展编辑响应不是true')
    },

    prepareStop (input: { id: SaleSysOfficeId; currentFilterStatus: SaleSysOfficeScalar }): SaleSysOfficeStopPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return { id: idOf(input?.id, '机构ID') }
    },

    async stop (input: { id: SaleSysOfficeId }): Promise<void> {
      const id = idOf(input?.id, '机构ID')
      const result = await request({ url: `${ROOT}/update`, method: 'put', data: { id, salesStatus: 2 }, httpInstance: 'platform' })
      if (result !== true) throw new Error('机构扩展停用响应不是true')
    },

    prepareBatchStop (input: { ids: SaleSysOfficeId[]; currentFilterStatus: SaleSysOfficeScalar }): SaleSysOfficeBatchStopPreparation {
      activeFilterOf(input?.currentFilterStatus)
      return { ids: idsOf(input?.ids) }
    },

    async batchStop (input: { ids: SaleSysOfficeId[] }): Promise<void> {
      const ids = idsOf(input?.ids)
      const result = await request({
        url: `${ROOT}/batch-disable`,
        method: 'post',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        data: ids,
        httpInstance: 'platform',
      })
      if (result !== true) throw new Error('机构扩展批量停用响应不是true')
    },

    async export (query: SaleSysOfficeQuery = {}): Promise<SaleSysOfficeFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: queryParamsOf(query), responseType: 'arraybuffer', httpInstance: 'platform' })
      return fileOf(response)
    },
  }
}

export type SaleSysOfficeCapability = ReturnType<typeof createSaleSysOfficeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams: ParamSpec[] = [
  p('parentId', 'tree', false, '隶属机构筛选值；来自organizationTree节点id，未选择发送空字符串'),
  p('name', 'text', false, '机构名称筛选'),
  p('code', 'text', false, '人系统机构编码筛选'),
  p('salesCode', 'text', false, '销售机构编码筛选'),
  p('salesType', 'enum', false, '机构类型字典值；未选择发送空字符串'),
  p('salesStatus', 'enum', false, '启用状态筛选；省略时Portal默认1启用'),
]

const updateFormParam = p('form', 'text', true, 'Portal编辑弹窗表单；prepareUpdate只整理pick后的提交字段，不发送请求')
const updateDraftParam = p('draft', 'text', true, 'prepareUpdate返回的草稿；必须原样交给update')
const idsParam = p('ids', 'text', true, '当前列表勾选的机构ID数组；批量停用至少一项且不能重复')

export const SALE_SYS_OFFICE_METHODS = {
  'sale-sys-office-list': 'list',
  'sale-sys-office-organization-tree': 'organizationTree',
  'sale-sys-office-status-options': 'statusOptions',
  'sale-sys-office-grade-options': 'gradeOptions',
  'sale-sys-office-type-options': 'typeOptions',
  'sale-sys-office-get': 'get',
  'sale-sys-office-sales-tree': 'salesTree',
  'sale-sys-office-primary-person-tree': 'primaryPersonTree',
  'sale-sys-office-business-tree': 'businessTree',
  'sale-sys-office-check-code': 'checkCode',
  'sale-sys-office-prepare-update': 'prepareUpdate',
  'sale-sys-office-update': 'update',
  'sale-sys-office-prepare-stop': 'prepareStop',
  'sale-sys-office-stop': 'stop',
  'sale-sys-office-prepare-batch-stop': 'prepareBatchStop',
  'sale-sys-office-batch-stop': 'batchStop',
  'sale-sys-office-export': 'export',
} as const

export const saleSysOfficeCapabilities: CapabilityDefinition[] = [
  { id: 'sale-sys-office-list', title: '查询机构扩展', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-sys-office-organization-tree', title: '查询机构扩展隶属机构树', write: false, params: [] },
  { id: 'sale-sys-office-status-options', title: '查询机构扩展状态选项', write: false, params: [] },
  { id: 'sale-sys-office-grade-options', title: '查询机构扩展级别选项', write: false, params: [] },
  { id: 'sale-sys-office-type-options', title: '查询机构扩展类型选项', write: false, params: [] },
  { id: 'sale-sys-office-get', title: '读取机构扩展详情', write: false, params: [p('id', 'text', true, '当前列表记录机构ID')] },
  { id: 'sale-sys-office-sales-tree', title: '查询销售上级机构树', write: false, params: [] },
  { id: 'sale-sys-office-primary-person-tree', title: '查询机构负责人树', write: false, params: [] },
  { id: 'sale-sys-office-business-tree', title: '查询机构销售业务树', write: false, params: [] },
  { id: 'sale-sys-office-check-code', title: '校验销售机构编码', write: false, params: [p('code', 'text', true, '编辑表单当前销售机构编码'), p('oldCode', 'text', false, '编辑前原销售机构编码；不变时Portal跳过请求')] },
  { id: 'sale-sys-office-prepare-update', title: '准备编辑机构扩展', write: false, params: [updateFormParam] },
  { id: 'sale-sys-office-update', title: '编辑机构扩展', write: true, params: [updateDraftParam] },
  { id: 'sale-sys-office-prepare-stop', title: '准备停用机构扩展', write: false, params: [p('id', 'text', true, '当前列表记录机构ID'), p('currentFilterStatus', 'enum', true, '当前列表筛选状态；必须为1启用')] },
  { id: 'sale-sys-office-stop', title: '停用机构扩展', write: true, params: [p('id', 'text', true, '当前列表记录机构ID')] },
  { id: 'sale-sys-office-prepare-batch-stop', title: '准备批量停用机构扩展', write: false, params: [idsParam, p('currentFilterStatus', 'enum', true, '当前列表筛选状态；必须为1启用')] },
  { id: 'sale-sys-office-batch-stop', title: '批量停用机构扩展', write: true, params: [idsParam] },
  { id: 'sale-sys-office-export', title: '导出机构扩展', write: false, params: [...queryParams, p('pageNo', 'number'), p('pageSize', 'number')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_SYS_OFFICE_PAGE_PATH,
  permission: SALE_SYS_OFFICE_PERMISSION,
  moduleType: SALE_SYS_OFFICE_MODULE_TYPE,
  httpInstance: definition.id === 'sale-sys-office-check-code' ? 'crm' : 'platform',
}))
