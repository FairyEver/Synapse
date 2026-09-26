import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「风险防控 → 制度管理 → 制度类型」列表和表单。 */
export const INSTITUTION_TYPE_PAGE_PATH = '/dashboard/institution/type/list'
export const INSTITUTION_TYPE_PERMISSION = '/dashboard/institution/type'
export const INSTITUTION_TYPE_MODULE_TYPE = 15

const ROOT = '/admin-api/system/policy-category'

export type InstitutionTypeId = string | number

export type InstitutionTypeQuery = {
  name?: string | null
  pageNo?: number
  pageSize?: number
}

export type InstitutionTypeRow = Record<string, unknown> & {
  id: InstitutionTypeId
  name: string | null
  sort: number | null
  size: number | null
}

export type InstitutionTypePage = {
  list: InstitutionTypeRow[]
  total: number
}

export type InstitutionTypeForm = {
  id?: InstitutionTypeId
  name: string
  sort: number
}

export type InstitutionTypePreparation = {
  draft: InstitutionTypeForm
  previous?: InstitutionTypeForm
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): InstitutionTypeId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nameOf (value: unknown, label: string, trim = true): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  const name = trim ? value.trim() : value
  if (name.length === 0) throw new Error(`${label}不能为空或全为空格`)
  if (name.length > 15) throw new Error(`${label}最多15个字符`)
  return name
}

function filterNameOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}必须为非负整数或null`)
  return value as number
}

function requiredSortOf (value: unknown, label: string): number {
  const sort = nullableIntegerOf(value, label)
  if (sort === null) throw new Error(`${label}必填`)
  return sort
}

function sizeOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label}必须为非负整数或null`)
  return value as number
}

function rowOf (value: unknown, label: string, listResponse = false): InstitutionTypeRow {
  const row = objectOf(value, label)
  const sort = nullableIntegerOf(row.sort, `${label}.sort`)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: row.name === undefined || row.name === null ? null : nameOf(row.name, `${label}.name`, false),
    sort: listResponse && sort === null ? 99999 : sort,
    size: sizeOf(row.size, `${label}.size`),
  }
}

function rowsOf (value: unknown, label: string, listResponse = false): InstitutionTypeRow[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => rowOf(item, `${label}[${index}]`, listResponse))
}

function pageParams (query: InstitutionTypeQuery = {}): Record<string, unknown> {
  const pageNo = query.pageNo === undefined ? 1 : query.pageNo
  const pageSize = query.pageSize === undefined ? 20 : query.pageSize
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new Error('制度类型页码必须为正整数')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('制度类型每页数量必须为正整数')
  return {
    order: '',
    orderField: '',
    name: filterNameOf(query.name ?? '', '制度类型名称筛选'),
    pageNo,
    pageSize,
  }
}

function formOf (value: unknown, label: string, requireId = false): InstitutionTypeForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  return {
    ...(id === undefined ? {} : { id }),
    name: nameOf(input.name, `${label}.name`),
    sort: requiredSortOf(input.sort, `${label}.sort`),
  }
}

function payloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const form = formOf(value, label, requireId)
  return {
    ...(requireId ? { id: form.id } : {}),
    name: form.name,
    sort: form.sort,
  }
}

function formFromRow (row: InstitutionTypeRow | InstitutionTypeForm): InstitutionTypeForm {
  return formOf({ id: row.id, name: row.name, sort: row.sort }, 'current', true)
}

function trueOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function createInstitutionTypeCapability (request: PortalRequest) {
  return {
    async list (query: InstitutionTypeQuery = {}): Promise<InstitutionTypePage> {
      const rows = rowsOf(await request({ url: `${ROOT}/page`, method: 'get', params: pageParams(query) }), '制度类型列表响应', true)
      return { list: rows, total: rows.length }
    },
    async get (input: { id: InstitutionTypeId }): Promise<InstitutionTypeRow> {
      const id = idOf(input?.id, '制度类型ID')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '制度类型详情')
    },
    prepareCreate (input: InstitutionTypeForm): InstitutionTypePreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: InstitutionTypeForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/create`, method: 'post', data: payloadOf(input?.draft, 'draft', false) }), '创建制度类型')
    },
    prepareUpdate (input: { current: InstitutionTypeRow | InstitutionTypeForm; changes?: Partial<Pick<InstitutionTypeForm, 'name' | 'sort'>> | null }): InstitutionTypePreparation {
      const previous = formFromRow(input?.current)
      return { draft: formOf({ ...previous, ...(input?.changes ?? {}) }, 'draft', true), previous }
    },
    async update (input: { draft: InstitutionTypeForm }): Promise<true> {
      return trueOf(await request({ url: `${ROOT}/update`, method: 'put', data: payloadOf(input?.draft, 'draft', true) }), '更新制度类型')
    },
    async remove (input: { id: InstitutionTypeId }): Promise<true> {
      const id = idOf(input?.id, '制度类型ID')
      return trueOf(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } }), '删除制度类型')
    },
  }
}

export type InstitutionTypeCapability = ReturnType<typeof createInstitutionTypeCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const INSTITUTION_TYPE_METHODS = {
  'institution-type-list': 'list',
  'institution-type-get': 'get',
  'institution-type-prepare-create': 'prepareCreate',
  'institution-type-create': 'create',
  'institution-type-prepare-update': 'prepareUpdate',
  'institution-type-update': 'update',
  'institution-type-remove': 'remove',
} as const

export const institutionTypeCapabilities: CapabilityDefinition[] = [
  { id: 'institution-type-list', title: '查询制度类型', write: false, params: [p('name', 'text', false, '类型名称筛选；省略时发送空字符串'), p('pageNo', 'number', false, '页面页码；默认1'), p('pageSize', 'number', false, '页面每页数量；默认20')] },
  { id: 'institution-type-get', title: '读取制度类型', write: false, params: [p('id', 'number', true, '制度类型 ID')] },
  { id: 'institution-type-prepare-create', title: '准备新建制度类型', write: false, params: [p('form', 'text', true, '类型名称和 APP 端排序')] },
  { id: 'institution-type-create', title: '新建制度类型', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的制度类型草稿')] },
  { id: 'institution-type-prepare-update', title: '准备编辑制度类型', write: false, params: [p('current', 'text', true, '最新制度类型详情'), p('changes', 'text', false, '用户明确修改的名称或排序')] },
  { id: 'institution-type-update', title: '保存制度类型', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的制度类型草稿')] },
  { id: 'institution-type-remove', title: '删除制度类型', write: true, params: [p('id', 'number', true, '制度类型 ID；仍被公司制度使用时后端拒绝')] },
].map(definition => ({ ...definition, pagePath: INSTITUTION_TYPE_PAGE_PATH, permission: INSTITUTION_TYPE_PERMISSION, moduleType: INSTITUTION_TYPE_MODULE_TYPE, httpInstance: 'platform' }))
