import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

export const SALE_SETTING_DICT_PAGE_PATH = '/dashboard/sale/setting/dict/list'
export const SALE_SETTING_DICT_PERMISSION = '/dashboard/sale/setting/dict'
export const SALE_SETTING_DICT_MODULE_TYPE = 60

const ROOT = '/admin/dict/type'

export type SaleSettingDictId = string | number
export type SaleSettingDictRow = Record<string, unknown> & {
  id?: SaleSettingDictId | null
  dictType?: string | null
  dictName?: string | null
  sort?: number | null
  remark?: string | null
  createDate?: string | number | null
  updateDate?: string | number | null
}
export type SaleSettingDictQuery = {
  dictName?: string | null
  dictType?: string | null
  pageNo?: number
  pageSize?: number
  order?: string | null
  orderField?: string | null
}
export type SaleSettingDictDraft = {
  dictName: string
  dictType: string
  sort?: number
  remark?: string
}
export type SaleSettingDictUpdate = SaleSettingDictDraft & { id: SaleSettingDictId }
export type SaleSettingDictIds = { ids: SaleSettingDictId[] }
export type SaleSettingDictDataRemoveDraft = { ids: string[] }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function responseIdOf (value: unknown, label: string): SaleSettingDictId {
  idOf(value, label)
  return value as SaleSettingDictId
}

function idsOf (input: SaleSettingDictIds): string[] {
  if (!Array.isArray(input?.ids) || input.ids.length === 0) throw new Error('ids至少包含一个配置数据ID')
  return [...new Set(input.ids.map(value => idOf(value, '配置数据ID')))]
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(result)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return result
}

function textOf (value: unknown, label: string, required = false): string {
  if (value === undefined || value === null) {
    if (!required) return ''
    throw new Error(`${label}必填`)
  }
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${label}必填且不能全为空格`)
  return value
}

function sortOf (value: unknown): number {
  const result = value ?? 0
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) throw new Error('sort必须为非负整数')
  return result
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function rowOf (value: unknown, label: string): SaleSettingDictRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : responseIdOf(row.id, `${label}.id`),
    dictType: row.dictType === undefined || row.dictType === null ? null : textOf(row.dictType, `${label}.dictType`),
    dictName: row.dictName === undefined || row.dictName === null ? null : textOf(row.dictName, `${label}.dictName`),
    sort: row.sort === undefined || row.sort === null ? null : sortOf(row.sort),
    remark: row.remark === undefined || row.remark === null ? null : textOf(row.remark, `${label}.remark`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
  }
}

function pageOf (value: unknown): PageResult<SaleSettingDictRow> {
  const page = objectOf(value, '配置数据分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('配置数据分页响应缺少有效list或total')
  const total = page.total as number
  return { list: page.list.map((item, index) => rowOf(item, `配置数据列表[${index}]`)), total }
}

function draftOf (input: SaleSettingDictDraft): Record<string, unknown> {
  const value = objectOf(input, '配置数据表单')
  return {
    dictName: textOf(value.dictName, 'dictName', true),
    dictType: textOf(value.dictType, 'dictType', true),
    sort: sortOf(value.sort),
    remark: textOf(value.remark, 'remark'),
  }
}

/** Portal 销售系统 → 配置数据；列表/表单均绑定 sale.js。 */
export function createSaleSettingDictCapability (request: PortalRequest) {
  return {
    async list (query: SaleSettingDictQuery = {}): Promise<PageResult<SaleSettingDictRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          dictName: textOf(query.dictName, 'dictName'),
          dictType: textOf(query.dictType, 'dictType'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },

    async get (input: { id: SaleSettingDictId }): Promise<SaleSettingDictRow | null> {
      const result = await request({ url: `${ROOT}/${idOf(input?.id, '配置数据ID')}`, method: 'get' })
      return result === null || result === undefined ? null : rowOf(result, '配置数据详情')
    },

    async create (input: SaleSettingDictDraft): Promise<void> {
      await request({ url: ROOT, method: 'post', data: draftOf(input) })
    },

    async update (input: SaleSettingDictUpdate): Promise<void> {
      await request({ url: ROOT, method: 'put', data: { id: idOf(input?.id, '配置数据ID'), ...draftOf(input) } })
    },

    async remove (input: SaleSettingDictIds): Promise<void> {
      await request({ url: ROOT, method: 'delete', data: idsOf(input) })
    },

    prepareRemoveData (input: SaleSettingDictIds): { draft: SaleSettingDictDataRemoveDraft } {
      return { draft: { ids: idsOf(input) } }
    },

    async removeData (input: { draft: SaleSettingDictDataRemoveDraft }): Promise<void> {
      await request({ url: '/admin/dict/data', method: 'delete', data: idsOf(input?.draft) })
    },

    cancelRemoveData (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type SaleSettingDictCapability = ReturnType<typeof createSaleSettingDictCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })

export const SALE_SETTING_DICT_METHODS = {
  'sale-setting-dict-list': 'list',
  'sale-setting-dict-get': 'get',
  'sale-setting-dict-create': 'create',
  'sale-setting-dict-update': 'update',
  'sale-setting-dict-remove': 'remove',
  'sale-setting-dict-data-prepare-remove': 'prepareRemoveData',
  'sale-setting-dict-data-remove': 'removeData',
  'sale-setting-dict-data-cancel-remove': 'cancelRemoveData',
} as const

export const saleSettingDictCapabilities: CapabilityDefinition[] = [
  { id: 'sale-setting-dict-list', title: '查询配置数据类型', write: false, params: [p('dictName', 'text', false, '中文字典名称，模糊筛选'), p('dictType', 'text', false, '英文类型，模糊筛选'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')] },
  { id: 'sale-setting-dict-get', title: '读取配置数据类型详情', write: false, params: [p('id', 'text', true, '配置数据类型ID')] },
  { id: 'sale-setting-dict-create', title: '创建配置数据类型', write: true, params: [p('dictName', 'text', true, '中文字典名称'), p('dictType', 'text', true, '英文类型'), p('sort', 'number', false, '非负整数排序，默认0'), p('remark', 'text', false, '备注，默认空字符串')] },
  { id: 'sale-setting-dict-update', title: '修改配置数据类型', write: true, params: [p('id', 'text', true, '配置数据类型ID'), p('dictName', 'text', true, '中文字典名称'), p('dictType', 'text', true, '英文类型'), p('sort', 'number', false, '非负整数排序，默认0'), p('remark', 'text', false, '备注，默认空字符串')] },
  { id: 'sale-setting-dict-remove', title: '删除配置数据类型', write: true, params: [p('ids', 'text', true, '配置数据类型ID数组')] },
  { id: 'sale-setting-dict-data-prepare-remove', title: '准备删除配置数据', write: false, params: [p('ids', 'text', true, '嵌套配置数据列表选中的数据ID数组')] },
  { id: 'sale-setting-dict-data-remove', title: '删除配置数据', write: true, params: [p('draft', 'text', true, 'prepareRemoveData返回的{ ids }草稿')] },
  { id: 'sale-setting-dict-data-cancel-remove', title: '取消配置数据删除提交', write: false, params: [] },
].map(definition => ({ ...definition, pagePath: SALE_SETTING_DICT_PAGE_PATH, permission: SALE_SETTING_DICT_PERMISSION, moduleType: SALE_SETTING_DICT_MODULE_TYPE, httpInstance: 'sale' as const }))
