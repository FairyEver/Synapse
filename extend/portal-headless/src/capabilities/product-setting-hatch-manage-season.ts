import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 温度设置」。 */
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH = '/dashboard/product/setting/hatch-manage/season/list'
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION = '/dashboard/frame/breeding-plan/season'
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_QUERY_PERMISSION = 'program:season:query'
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_SUBMIT_PERMISSION = 'program:season:submit'
export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_DELETE_PERMISSION = 'program:season:delete'

const LIST_URL = '/programNew/baseSetting/temp/getPage'
const CREATE_URL = '/programNew/baseSetting/temp/create'
const UPDATE_URL = '/programNew/baseSetting/temp/edit'
const DELETE_URL = '/programNew/baseSetting/temp/delete'

export type ProductSettingHatchManageSeasonId = string | number

export type ProductSettingHatchManageSeasonQuery = {
  min?: number | null
  max?: number | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchManageSeasonRow = Record<string, unknown> & {
  id: ProductSettingHatchManageSeasonId | null
  tempId: ProductSettingHatchManageSeasonId | null
  inMin: number | null
  inMax: number | null
  inTitle: string | null
  outMin: number | null
  outMax: number | null
  outTitle: string | null
}

export type ProductSettingHatchManageSeasonPage = {
  list: ProductSettingHatchManageSeasonRow[]
  total: number
}

export type ProductSettingHatchManageSeasonCreateForm = {
  inMin: number
  inMax: number
  outMin: number
  outMax: number
}

export type ProductSettingHatchManageSeasonCreateDraft = {
  id?: undefined
  tempId?: undefined
  inMin: number
  inMax: number
  outMin: number
  outMax: number
}

export type ProductSettingHatchManageSeasonUpdateForm = Record<string, unknown> & {
  id?: ProductSettingHatchManageSeasonId | null | ''
  tempId?: ProductSettingHatchManageSeasonId | null | ''
  inMin?: number | null
  inMax?: number | null
  outMin?: number | null
  outMax?: number | null
}

export type ProductSettingHatchManageSeasonUpdateDraft = Record<string, unknown> & {
  id?: ProductSettingHatchManageSeasonId | null | ''
  tempId?: ProductSettingHatchManageSeasonId | null | ''
  inMin: number
  inMax: number
  outMin: number
  outMax: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingHatchManageSeasonId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchManageSeasonId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function optionalIdOf (value: unknown, label: string): ProductSettingHatchManageSeasonId | null | undefined | '' {
  if (value === undefined) return undefined
  if (value === null || value === '') return value
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function boundedNumberOf (value: unknown, label: string, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -99 || value > 99) throw new Error(`${label}必须是-99到99之间的数字`)
  return value
}

function formNumberOf (value: unknown, label: string): number {
  return boundedNumberOf(value, label, true) as number
}

function queryNumberOf (value: unknown, fallback: number, label: string): number | null {
  if (value === undefined) return fallback
  return boundedNumberOf(value, label, false)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function rowOf (value: unknown, index: number): ProductSettingHatchManageSeasonRow {
  const row = objectOf(value, `温度设置列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `温度设置列表[${index}].id`),
    tempId: nullableIdOf(row.tempId, `温度设置列表[${index}].tempId`),
    inMin: boundedNumberOf(row.inMin, `温度设置列表[${index}].inMin`, false),
    inMax: boundedNumberOf(row.inMax, `温度设置列表[${index}].inMax`, false),
    inTitle: nullableTextOf(row.inTitle, `温度设置列表[${index}].inTitle`),
    outMin: boundedNumberOf(row.outMin, `温度设置列表[${index}].outMin`, false),
    outMax: boundedNumberOf(row.outMax, `温度设置列表[${index}].outMax`, false),
    outTitle: nullableTextOf(row.outTitle, `温度设置列表[${index}].outTitle`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined && object.rows === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchManageSeasonPage {
  const payload = objectOf(payloadOf(value), '温度设置分页响应')
  const page = objectOf(payload.page ?? payload, '温度设置分页响应.page')
  const list = page.records ?? page.list ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('温度设置分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingHatchManageSeasonQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    min: queryNumberOf(query.min, -99, '外界温度最小值'),
    max: queryNumberOf(query.max, 99, '外界温度最大值'),
    scope: 1,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createFormOf (value: unknown): ProductSettingHatchManageSeasonCreateDraft {
  const form = objectOf(value, '温度设置新建表单')
  return {
    id: undefined,
    tempId: undefined,
    inMin: formNumberOf(form.inMin, '舍内温度最小值'),
    inMax: formNumberOf(form.inMax, '舍内温度最大值'),
    outMin: formNumberOf(form.outMin, '外界温度最小值'),
    outMax: formNumberOf(form.outMax, '外界温度最大值'),
  }
}

function updateFormOf (value: unknown): ProductSettingHatchManageSeasonUpdateDraft {
  const form = objectOf(value, '温度设置编辑表单')
  return {
    ...form,
    id: optionalIdOf(form.id, '温度设置ID'),
    tempId: optionalIdOf(form.tempId, '舍内温度ID'),
    inMin: formNumberOf(form.inMin, '舍内温度最小值'),
    inMax: formNumberOf(form.inMax, '舍内温度最大值'),
    outMin: formNumberOf(form.outMin, '外界温度最小值'),
    outMax: formNumberOf(form.outMax, '外界温度最大值'),
  }
}

function removeInputOf (value: unknown): { id: ProductSettingHatchManageSeasonId; tempId: ProductSettingHatchManageSeasonId } {
  const input = objectOf(value, '温度设置删除参数')
  return { id: idOf(input.id, '温度设置ID'), tempId: idOf(input.tempId, '舍内温度ID') }
}

/** The injected request must use PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH as page context. */
export function createProductSettingHatchManageSeasonCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingHatchManageSeasonQuery = {}): Promise<ProductSettingHatchManageSeasonPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchManageSeasonCreateForm): { draft: ProductSettingHatchManageSeasonCreateDraft } {
      return { draft: createFormOf(form) }
    },

    async create (input: { draft: ProductSettingHatchManageSeasonCreateDraft }): Promise<true> {
      const draft = createFormOf(input?.draft)
      await request({ url: CREATE_URL, method: 'post', data: draft })
      return true
    },

    prepareUpdate (form: ProductSettingHatchManageSeasonUpdateForm): { draft: ProductSettingHatchManageSeasonUpdateDraft } {
      return { draft: updateFormOf(form) }
    },

    async update (input: { draft: ProductSettingHatchManageSeasonUpdateDraft }): Promise<true> {
      const draft = updateFormOf(input?.draft)
      await request({ url: UPDATE_URL, method: 'post', data: draft })
      return true
    },

    prepareRemove (input: { id: ProductSettingHatchManageSeasonId; tempId: ProductSettingHatchManageSeasonId }): { id: ProductSettingHatchManageSeasonId; tempId: ProductSettingHatchManageSeasonId } {
      return removeInputOf(input)
    },

    async remove (input: { id: ProductSettingHatchManageSeasonId; tempId: ProductSettingHatchManageSeasonId }): Promise<true> {
      const target = removeInputOf(input)
      await request({ url: DELETE_URL, method: 'get', params: target })
      return true
    },
  }
}

export type ProductSettingHatchManageSeasonCapability = ReturnType<typeof createProductSettingHatchManageSeasonCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_MANAGE_SEASON_METHODS = {
  'product-setting-hatch-manage-season-list': 'list',
  'product-setting-hatch-manage-season-prepare-create': 'prepareCreate',
  'product-setting-hatch-manage-season-create': 'create',
  'product-setting-hatch-manage-season-prepare-update': 'prepareUpdate',
  'product-setting-hatch-manage-season-update': 'update',
  'product-setting-hatch-manage-season-prepare-remove': 'prepareRemove',
  'product-setting-hatch-manage-season-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '温度设置新建弹窗表单；舍内和外界的最小/最大值均必填，范围为-99到99' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '温度设置编辑弹窗提交对象；来自当前列表行并覆盖id、tempId及四个温度边界字段' }

export const productSettingHatchManageSeasonCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-manage-season-list', title: '查询温度设置', write: false, params: [p('min', 'number', false, '外界温度最小筛选值；默认-99，可传null取消下限'), p('max', 'number', false, '外界温度最大筛选值；默认99，可传null取消上限'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-hatch-manage-season-prepare-create', title: '准备新建温度设置', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-manage-season-create', title: '新建温度设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的温度设置新建草稿')] },
  { id: 'product-setting-hatch-manage-season-prepare-update', title: '准备编辑温度设置', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-manage-season-update', title: '编辑温度设置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的编辑草稿；会保留Portal编辑提交对象中的扩展字段')] },
  { id: 'product-setting-hatch-manage-season-prepare-remove', title: '准备删除温度设置', write: false, params: [p('id', 'text', true, '当前列表行内外温度对照记录ID'), p('tempId', 'text', true, '当前列表行舍内温度记录ID')] },
  { id: 'product-setting-hatch-manage-season-remove', title: '删除温度设置', write: true, params: [p('id', 'text', true, 'prepareRemove返回的内外温度对照记录ID'), p('tempId', 'text', true, 'prepareRemove返回的舍内温度记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_MANAGE_SEASON_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_MANAGE_SEASON_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_MANAGE_SEASON_MODULE_TYPE,
  httpInstance: 'product',
}))
