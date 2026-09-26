import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** 门户系统设置 → 销售设置 → 设置服务主体。 */
export const SALE_SERVICE_SUBJECT_PAGE_PATH = '/dashboard/sale/setting/service-subject/list'
export const SALE_SERVICE_SUBJECT_PERMISSION = '/dashboard/sale/setting/service-subject'
export const SALE_SERVICE_SUBJECT_CREATE_PERMISSION = 'sales:setting:service-subject:create'
export const SALE_SERVICE_SUBJECT_EDIT_PERMISSION = 'sales:setting:service-subject:edit'
export const SALE_SERVICE_SUBJECT_DELETE_PERMISSION = 'sales:setting:service-subject:delete'
export const SALE_SERVICE_SUBJECT_MODULE_TYPE = 60

const ROLE_PAGE_URL = '/admin-api/system/hr-role/page'
const ROLE_DELETE_URL = '/admin-api/system/hr-role/delete'
// The form uses useFormPageModule({ objectURL: '/admin/dict/type' }), and platformHttp
// adds the /admin-api prefix before sending the request.
const FORM_OBJECT_URL = '/admin-api/dict/type'
const FORM_SUBMIT_URL = '/admin-api/customerType'

export type SaleServiceSubjectId = string | number
export type SaleServiceSubjectScalar = string | number

export type SaleServiceSubjectRow = Record<string, unknown> & {
  id?: SaleServiceSubjectId | null
  name?: string | null
  customerType?: SaleServiceSubjectScalar | null
  parentId?: SaleServiceSubjectScalar | null
  updateTime?: string | number | null
  updateDate?: string | number | null
}

export type SaleServiceSubjectQuery = {
  order?: string | null
  orderField?: string | null
  pageNo?: number
  limit?: number
}

export type SaleServiceSubjectForm = {
  parentId: SaleServiceSubjectScalar
  name: string
  customerType: SaleServiceSubjectScalar
}

export type SaleServiceSubjectUpdateForm = SaleServiceSubjectForm & {
  id: SaleServiceSubjectId
}

export type SaleServiceSubjectCreatePreparation = {
  draft: SaleServiceSubjectForm
}

export type SaleServiceSubjectUpdatePreparation = {
  draft: SaleServiceSubjectUpdateForm
}

export type SaleServiceSubjectRemovePreparation = {
  id: SaleServiceSubjectId
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function scalarOf (value: unknown, label: string): SaleServiceSubjectScalar {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必填且必须是非空字符串或有限数字`)
}

function nullableScalarOf (value: unknown, label: string): SaleServiceSubjectScalar | null {
  if (value === undefined || value === null || value === '') return null
  return scalarOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}必填`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label)
}

function idOf (value: unknown, label: string): SaleServiceSubjectId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须是正整数字符串或安全正整数`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'limit'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'limit' && ![10, 20, 50, 100].includes(result as number)) throw new Error('limit必须是10、20、50或100')
  return result as number
}

function rowOf (value: unknown, label: string): SaleServiceSubjectRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: row.id === undefined || row.id === null ? null : idOf(row.id, `${label}.id`),
    name: row.name === undefined || row.name === null ? null : nullableTextOf(row.name, `${label}.name`),
    parentId: nullableScalarOf(row.parentId, `${label}.parentId`),
    customerType: nullableScalarOf(row.customerType, `${label}.customerType`),
    updateTime: row.updateTime === undefined || row.updateTime === null ? null : row.updateTime as string | number,
    updateDate: row.updateDate === undefined || row.updateDate === null ? null : row.updateDate as string | number,
  }
}

function pageOf (value: unknown): PageResult<SaleServiceSubjectRow> {
  const page = objectOf(value, '服务主体分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) {
    throw new Error('服务主体分页响应缺少有效list或total')
  }
  return {
    list: page.list.map((item, index) => rowOf(item, `服务主体列表[${index}]`)),
    total: page.total as number,
  }
}

function formOf (value: unknown, label: string, withId: boolean): SaleServiceSubjectForm | SaleServiceSubjectUpdateForm {
  const form = objectOf(value, label)
  const result: SaleServiceSubjectForm = {
    parentId: scalarOf(form.parentId, `${label}.parentId`),
    name: textOf(form.name, `${label}.name`),
    customerType: scalarOf(form.customerType, `${label}.customerType`),
  }
  return withId
    ? { id: idOf(form.id, `${label}.id`), ...result }
    : result
}

/**
 * 设置服务主体页按 Portal 源码保留两条看起来不一致的请求链：列表/删除走
 * system/hr-role，而编辑页的 objectURL 与新增/编辑 customSubmit 走旧的 customerType
 * 路径。不能把它们擅自合并成 hr-role 的标准 CRUD。
 */
export function createSaleServiceSubjectCapability (request: PortalRequest) {
  return {
    async list (query: SaleServiceSubjectQuery = {}): Promise<PageResult<SaleServiceSubjectRow>> {
      return pageOf(await request({
        url: ROLE_PAGE_URL,
        method: 'get',
        params: {
          order: typeof query.order === 'string' ? query.order : '',
          orderField: typeof query.orderField === 'string' ? query.orderField : '',
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          limit: pageNumberOf(query.limit, 20, 'limit'),
        },
      }))
    },

    async get (input: { id: SaleServiceSubjectId }): Promise<SaleServiceSubjectRow> {
      return rowOf(await request({ url: `${FORM_OBJECT_URL}/${idOf(input?.id, '服务主体ID')}`, method: 'get' }), '服务主体表单详情')
    },

    prepareCreate (input: SaleServiceSubjectForm): SaleServiceSubjectCreatePreparation {
      return { draft: formOf(input, '服务主体新增表单', false) as SaleServiceSubjectForm }
    },

    async create (input: SaleServiceSubjectForm): Promise<void> {
      await request({ url: FORM_SUBMIT_URL, method: 'post', data: formOf(input, '服务主体新增表单', false) })
    },

    prepareUpdate (input: SaleServiceSubjectUpdateForm): SaleServiceSubjectUpdatePreparation {
      return { draft: formOf(input, '服务主体编辑表单', true) as SaleServiceSubjectUpdateForm }
    },

    async update (input: SaleServiceSubjectUpdateForm): Promise<void> {
      await request({ url: FORM_SUBMIT_URL, method: 'post', data: formOf(input, '服务主体编辑表单', true) })
    },

    prepareRemove (input: { id: SaleServiceSubjectId }): SaleServiceSubjectRemovePreparation {
      return { id: idOf(input?.id, '服务主体ID') }
    },

    async remove (input: { id: SaleServiceSubjectId }): Promise<void> {
      await request({ url: ROLE_DELETE_URL, method: 'delete', params: { id: idOf(input?.id, '服务主体ID') } })
    },
  }
}

export type SaleServiceSubjectCapability = ReturnType<typeof createSaleServiceSubjectCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParams: ParamSpec[] = [
  p('parentId', 'text', true, '页面“上级组织”选择值；Portal只做必填校验，不在SDK中猜测组织ID格式'),
  p('name', 'text', true, '服务主体名称；Portal只做非空校验'),
  p('customerType', 'text', true, '页面“客户分类”选择值；Portal只做必填校验'),
]

export const SALE_SERVICE_SUBJECT_METHODS = {
  'sale-service-subject-list': 'list',
  'sale-service-subject-get': 'get',
  'sale-service-subject-prepare-create': 'prepareCreate',
  'sale-service-subject-create': 'create',
  'sale-service-subject-prepare-update': 'prepareUpdate',
  'sale-service-subject-update': 'update',
  'sale-service-subject-prepare-remove': 'prepareRemove',
  'sale-service-subject-remove': 'remove',
} as const

export const saleServiceSubjectCapabilities: CapabilityDefinition[] = [
  { id: 'sale-service-subject-list', title: '查询服务主体', write: false, params: [p('order', 'text', false, 'Portal公共排序方向；页面没有排序控件，默认空字符串'), p('orderField', 'text', false, 'Portal公共排序字段；页面没有排序控件，默认空字符串'), p('pageNo', 'number', false, '从1开始的页码'), p('limit', 'number', false, '每页条数，页面默认20，支持10/20/50/100')] },
  { id: 'sale-service-subject-get', title: '读取服务主体编辑表单', write: false, params: [p('id', 'text', true, '从当前服务主体列表记录取得的ID')] },
  { id: 'sale-service-subject-prepare-create', title: '准备新增服务主体', write: false, params: formParams },
  { id: 'sale-service-subject-create', title: '新增服务主体', write: true, params: formParams },
  { id: 'sale-service-subject-prepare-update', title: '准备编辑服务主体', write: false, params: [p('id', 'text', true, '当前编辑目标服务主体ID'), ...formParams] },
  { id: 'sale-service-subject-update', title: '编辑服务主体', write: true, params: [p('id', 'text', true, '当前编辑目标服务主体ID'), ...formParams] },
  { id: 'sale-service-subject-prepare-remove', title: '准备删除服务主体', write: false, params: [p('id', 'text', true, '从当前服务主体列表记录取得的ID')] },
  { id: 'sale-service-subject-remove', title: '删除服务主体', write: true, params: [p('id', 'text', true, '从当前服务主体列表记录取得的ID')] },
].map(definition => ({
  ...definition,
  pagePath: SALE_SERVICE_SUBJECT_PAGE_PATH,
  permission: SALE_SERVICE_SUBJECT_PERMISSION,
  moduleType: SALE_SERVICE_SUBJECT_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
