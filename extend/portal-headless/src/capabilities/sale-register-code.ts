import { Buffer } from 'node:buffer'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 国家代码管理。 */
export const SALE_REGISTER_CODE_PAGE_PATH = '/dashboard/sale/customer/register-code/list'
export const SALE_REGISTER_CODE_PERMISSION = '/dashboard/sale/frame/customer/registerCode'
export const SALE_REGISTER_CODE_ACTION_PERMISSION = 'customer:registerCode:edit'
export const SALE_REGISTER_CODE_MODULE_TYPE = 60

const ROOT = '/vue/customer/registerCode'
const XLS_MIME = 'application/vnd.ms-excel'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type SaleRegisterCodeId = string | number
export type SaleRegisterCodeRow = Record<string, unknown> & {
  id?: SaleRegisterCodeId | null
  number?: string | null
  provinceCode?: string | null
  city?: string | null
  area?: string | null
  breedingCode?: string | null
  farmerName?: string | null
  formerBreedingCode?: string | null
  farmAddress?: string | null
  name?: string | null
}
export type SaleRegisterCodeQuery = {
  order?: string | null
  orderField?: string | null
  breedingCode?: string | null
  farmerName?: string | null
  name?: string | null
  pageNo?: number
  pageSize?: number
}
export type SaleRegisterCodeFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}
export type SaleRegisterCodeFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}
export type SaleRegisterCodeRemoveInput = {
  id: SaleRegisterCodeId
}
export type SaleRegisterCodeRemovePreparation = {
  id: SaleRegisterCodeId
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function textOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null) {
    if (!required) return ''
    throw new Error(`${label}必填`)
  }
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && !value.trim()) throw new Error(`${label}必填且不能全为空格`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function idOf (value: unknown, label: string): SaleRegisterCodeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(result)) {
    throw new Error('pageSize必须是10、20、50、100、200或500')
  }
  return result
}

function rowOf (value: unknown, label: string): SaleRegisterCodeRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    number: nullableTextOf(row.number, `${label}.number`),
    provinceCode: nullableTextOf(row.provinceCode, `${label}.provinceCode`),
    city: nullableTextOf(row.city, `${label}.city`),
    area: nullableTextOf(row.area, `${label}.area`),
    breedingCode: nullableTextOf(row.breedingCode, `${label}.breedingCode`),
    farmerName: nullableTextOf(row.farmerName, `${label}.farmerName`),
    formerBreedingCode: nullableTextOf(row.formerBreedingCode, `${label}.formerBreedingCode`),
    farmAddress: nullableTextOf(row.farmAddress, `${label}.farmAddress`),
    name: nullableTextOf(row.name, `${label}.name`),
  }
}

function pageOf (value: unknown): PageResult<SaleRegisterCodeRow> {
  const page = objectOf(value, '国家代码分页响应')
  if (!Array.isArray(page.list)) throw new Error('国家代码分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('国家代码分页响应缺少有效count')
  return {
    list: page.list.map((item, index) => rowOf(item, `国家代码列表[${index}]`)),
    total: page.count as number,
  }
}

function fileOf (input: SaleRegisterCodeFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '国家代码导入文件')
  const fileName = textOf(value.fileName, 'fileName', true).trim()
  const lowerName = fileName.toLowerCase()
  if (!/\.(xls|xlsx)$/.test(lowerName)) throw new Error('fileName必须以.xls或.xlsx结尾')

  const base64 = textOf(value.base64, 'base64', true).replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('base64必须是非空标准Base64')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')

  const providedType = value.contentType
  const contentType = providedType === undefined || providedType === null || providedType === ''
    ? lowerName.endsWith('.xls') ? XLS_MIME : XLSX_MIME
    : textOf(providedType, 'contentType', true)
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function scalarResultOf (value: unknown): string | number {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error('国家代码导入响应必须是字符串或数字')
}

/**
 * 这个页面使用 Portal 的 crm.js：不能复用默认 platform 实例。
 * 页面没有新增/编辑详情入口，因此不暴露后端虽存在但页面不可达的 save/getRegisterCode。
 */
export function createSaleRegisterCodeCapability (request: PortalRequest) {
  return {
    async list (query: SaleRegisterCodeQuery = {}): Promise<PageResult<SaleRegisterCodeRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          breedingCode: textOf(query.breedingCode, 'breedingCode'),
          farmerName: textOf(query.farmerName, 'farmerName'),
          name: textOf(query.name, 'name'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },

    prepareImport (input: SaleRegisterCodeFileInput): SaleRegisterCodeFilePreview {
      const file = fileOf(input)
      return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
    },

    async importFile (input: SaleRegisterCodeFileInput): Promise<string | number> {
      const file = fileOf(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      return scalarResultOf(await request({
        url: `${ROOT}/import`,
        method: 'post',
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
      }))
    },

    prepareRemove (input: SaleRegisterCodeRemoveInput): SaleRegisterCodeRemovePreparation {
      return { id: idOf(input?.id, '国家代码ID') }
    },

    async remove (input: SaleRegisterCodeRemoveInput): Promise<void> {
      await request({
        url: `${ROOT}/${idOf(input?.id, '国家代码ID')}`,
        method: 'delete',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    },
  }
}

export type SaleRegisterCodeCapability = ReturnType<typeof createSaleRegisterCodeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const fileParams: ParamSpec[] = [
  p('fileName', 'text', true, 'Portal文件选择器接受的.xls或.xlsx文件名'),
  p('base64', 'text', true, '原始Excel文件内容的标准Base64'),
  p('contentType', 'text', false, '可选MIME；省略时按扩展名使用xls或xlsx标准MIME，Portal只按扩展名校验'),
]

export const SALE_REGISTER_CODE_METHODS = {
  'sale-register-code-list': 'list',
  'sale-register-code-prepare-import': 'prepareImport',
  'sale-register-code-import': 'importFile',
  'sale-register-code-prepare-remove': 'prepareRemove',
  'sale-register-code-remove': 'remove',
} as const

export const saleRegisterCodeCapabilities: CapabilityDefinition[] = [
  { id: 'sale-register-code-list', title: '查询国家代码', write: false, params: [p('order', 'text', false, 'Portal公共列表排序值；页面默认空字符串且没有排序控件'), p('orderField', 'text', false, 'Portal公共列表排序字段；页面默认空字符串且没有排序控件'), p('breedingCode', 'text', false, '畜禽养殖代码模糊筛选'), p('farmerName', 'text', false, '养殖场户名称模糊筛选'), p('name', 'text', false, '姓名模糊筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-register-code-prepare-import', title: '准备导入国家代码文件', write: false, params: fileParams },
  { id: 'sale-register-code-import', title: '导入国家代码文件', write: true, params: fileParams },
  { id: 'sale-register-code-prepare-remove', title: '准备删除国家代码', write: false, params: [p('id', 'text', true, '从当前列表记录取得的国家代码ID')] },
  { id: 'sale-register-code-remove', title: '删除国家代码', write: true, params: [p('id', 'text', true, '从当前列表记录取得的国家代码ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_REGISTER_CODE_PAGE_PATH,
  permission: SALE_REGISTER_CODE_PERMISSION,
  moduleType: SALE_REGISTER_CODE_MODULE_TYPE,
  httpInstance: 'crm',
}))
