import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 字典配置；与“配置数据”页面不是同一页。 */
export const SALE_SYS_DICT_PAGE_PATH = '/dashboard/sale/sys/dict/list'
export const SALE_SYS_DICT_PERMISSION = '/dashboard/sale/frame/sys/dict'
export const SALE_SYS_DICT_ACTION_PERMISSION = 'sys:dict:edit'
export const SALE_SYS_DICT_MODULE_TYPE = 60

const ROOT = '/vue/sys/dict'
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export type SaleSysDictId = string | number
export type SaleSysDictRow = Record<string, unknown> & {
  id?: SaleSysDictId | null
  value?: string | null
  label?: string | null
  type?: string | null
  description?: string | null
  sort?: number | null
  parentId?: string | null
  brandId?: number | null
  itemId?: number | null
  remarks?: string | null
  createDate?: string | number | null
  updateDate?: string | number | null
}
export type SaleSysDictQuery = {
  order?: string | null
  orderField?: string | null
  label?: string | null
  type?: string | null
  description?: string | null
  pageNo?: number
  pageSize?: number
}
export type SaleSysDictForm = {
  id?: SaleSysDictId | null
  value?: string | null
  label?: string | null
  type?: string | null
  description?: string | null
  sort?: number | null
  parentId?: string | null
  brandId?: number | null
  itemId?: number | null
  remarks?: string | null
  [key: string]: unknown
}
export type SaleSysDictDraft = Record<string, unknown> & {
  id?: SaleSysDictId | null
  value: string
  label: string
  type: string
  description: string
  sort: number | null
  remarks: string
}
export type SaleSysDictUpdateDraft = SaleSysDictDraft & { id: SaleSysDictId }
export type SaleSysDictCreatePreparation = { draft: SaleSysDictDraft }
export type SaleSysDictUpdatePreparation = { draft: SaleSysDictUpdateDraft }
export type SaleSysDictRemovePreparation = { id: SaleSysDictId }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SaleSysDictId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(`${label}必须是非空字符串或正整数`)
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function numberOrNullOf (value: unknown, label: string, fallback: number | null = null): number | null {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label}必须是非负有限数字或null`)
  return value
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须是字符串、有限数字或null`)
}

function integerOrNullOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须是安全整数或null`)
  return value as number
}

function rowOf (value: unknown, label: string): SaleSysDictRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    value: row.value === undefined || row.value === null ? null : textOf(row.value, `${label}.value`),
    label: row.label === undefined || row.label === null ? null : textOf(row.label, `${label}.label`),
    type: row.type === undefined || row.type === null ? null : textOf(row.type, `${label}.type`),
    description: row.description === undefined || row.description === null ? null : textOf(row.description, `${label}.description`),
    sort: numberOrNullOf(row.sort, `${label}.sort`),
    parentId: row.parentId === undefined || row.parentId === null ? null : textOf(row.parentId, `${label}.parentId`),
    brandId: integerOrNullOf(row.brandId, `${label}.brandId`),
    itemId: integerOrNullOf(row.itemId, `${label}.itemId`),
    remarks: row.remarks === undefined || row.remarks === null ? null : textOf(row.remarks, `${label}.remarks`),
    createDate: dateOf(row.createDate, `${label}.createDate`),
    updateDate: dateOf(row.updateDate, `${label}.updateDate`),
  }
}

function pageOf (value: unknown): PageResult<SaleSysDictRow> {
  const page = objectOf(value, '字典配置分页响应')
  if (!Array.isArray(page.list)) throw new Error('字典配置分页响应缺少list数组')
  if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) throw new Error('字典配置分页响应缺少有效count')
  return {
    list: page.list.map((item, index) => rowOf(item, `字典配置列表[${index}]`)),
    total: page.count as number,
  }
}

function formOf (input: unknown, mode: 'create' | 'update'): SaleSysDictDraft | SaleSysDictUpdateDraft {
  const form = objectOf(input, '字典配置表单')
  const id = form.id === undefined || form.id === null || form.id === '' ? undefined : idOf(form.id, '字典配置ID')
  if (mode === 'update' && id === undefined) throw new Error('编辑字典配置必须带当前记录ID')
  const draft: SaleSysDictDraft = {
    ...form,
    ...(id === undefined ? {} : { id }),
    value: textOf(form.value, 'value'),
    label: textOf(form.label, 'label'),
    type: textOf(form.type, 'type'),
    description: textOf(form.description, 'description'),
    sort: numberOrNullOf(form.sort, 'sort', 10),
    remarks: textOf(form.remarks, 'remarks'),
  }
  return mode === 'update' ? { ...draft, id: id as SaleSysDictId } : draft
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(result)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return result
}

function maxSortOf (value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('字典配置最大排序值必须是非负整数或null')
  return value as number
}

/** Portal 销售系统 → 字典配置；列表和弹窗均绑定 CRM 的旧 /vue/sys/dict 链路。 */
export function createSaleSysDictCapability (request: PortalRequest) {
  return {
    async list (query: SaleSysDictQuery = {}): Promise<PageResult<SaleSysDictRow>> {
      return pageOf(await request({
        url: `${ROOT}/list`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          label: textOf(query.label, 'label'),
          type: textOf(query.type, 'type'),
          description: textOf(query.description, 'description'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
        headers: FORM_HEADERS,
      }))
    },

    async typeList (): Promise<string[]> {
      const result = await request({ url: `${ROOT}/getDictTypeList`, method: 'get', headers: FORM_HEADERS })
      if (!Array.isArray(result) || result.some(item => typeof item !== 'string')) throw new Error('字典配置类型响应必须是字符串数组')
      return result as string[]
    },

    async maxSort (input: { type?: string | null } = {}): Promise<number | null> {
      const result = await request({
        url: `${ROOT}/getMaxSort`,
        method: 'get',
        params: { type: textOf(input?.type, 'type') },
        headers: FORM_HEADERS,
      })
      return maxSortOf(result)
    },

    prepareCreate (input: { form: SaleSysDictForm }): SaleSysDictCreatePreparation {
      return { draft: formOf(input?.form, 'create') as SaleSysDictDraft }
    },

    async create (input: { draft: SaleSysDictDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: formOf(input?.draft, 'create'), headers: FORM_HEADERS })
    },

    prepareUpdate (input: { form: SaleSysDictForm }): SaleSysDictUpdatePreparation {
      return { draft: formOf(input?.form, 'update') as SaleSysDictUpdateDraft }
    },

    async update (input: { draft: SaleSysDictUpdateDraft }): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: formOf(input?.draft, 'update'), headers: FORM_HEADERS })
    },

    prepareRemove (input: { id: SaleSysDictId }): SaleSysDictRemovePreparation {
      return { id: idOf(input?.id, '字典配置ID') }
    },

    async remove (input: { id: SaleSysDictId }): Promise<void> {
      await request({ url: `${ROOT}/${idOf(input?.id, '字典配置ID')}`, method: 'delete', headers: FORM_HEADERS })
    },
  }
}

export type SaleSysDictCapability = ReturnType<typeof createSaleSysDictCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'Portal字典配置弹窗完整表单；新增键值时应先用maxSort(type)取得当前类型最大排序值')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate返回的完整字典配置提交草稿')

export const SALE_SYS_DICT_METHODS = {
  'sale-sys-dict-list': 'list',
  'sale-sys-dict-type-list': 'typeList',
  'sale-sys-dict-max-sort': 'maxSort',
  'sale-sys-dict-prepare-create': 'prepareCreate',
  'sale-sys-dict-create': 'create',
  'sale-sys-dict-prepare-update': 'prepareUpdate',
  'sale-sys-dict-update': 'update',
  'sale-sys-dict-prepare-remove': 'prepareRemove',
  'sale-sys-dict-remove': 'remove',
} as const

export const saleSysDictCapabilities: CapabilityDefinition[] = [
  { id: 'sale-sys-dict-list', title: '查询字典配置', write: false, params: [p('order', 'text', false, 'Portal公共列表排序值；页面默认空字符串且没有排序控件'), p('orderField', 'text', false, 'Portal公共列表排序字段；页面默认空字符串且没有排序控件'), p('label', 'text', false, '标签模糊筛选'), p('type', 'text', false, '字典类型筛选'), p('description', 'text', false, '描述模糊筛选'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'sale-sys-dict-type-list', title: '查询字典类型选项', write: false, params: [] },
  { id: 'sale-sys-dict-max-sort', title: '查询字典类型最大排序', write: false, params: [p('type', 'text', false, '当前字典行的type；页面新增键值前传入')] },
  { id: 'sale-sys-dict-prepare-create', title: '准备新建字典配置', write: false, params: [formParam] },
  { id: 'sale-sys-dict-create', title: '新建字典配置', write: true, params: [draftParam] },
  { id: 'sale-sys-dict-prepare-update', title: '准备编辑字典配置', write: false, params: [formParam] },
  { id: 'sale-sys-dict-update', title: '编辑字典配置', write: true, params: [draftParam] },
  { id: 'sale-sys-dict-prepare-remove', title: '准备删除字典配置', write: false, params: [p('id', 'text', true, '当前列表记录ID')] },
  { id: 'sale-sys-dict-remove', title: '删除字典配置', write: true, params: [p('id', 'text', true, '当前列表记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_SYS_DICT_PAGE_PATH,
  permission: SALE_SYS_DICT_PERMISSION,
  moduleType: SALE_SYS_DICT_MODULE_TYPE,
  httpInstance: 'crm',
}))
