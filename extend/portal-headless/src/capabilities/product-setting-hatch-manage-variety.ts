import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 预案品种」。 */
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH = '/dashboard/product/setting/hatch-manage/variety/list'
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION = '/dashboard/frame/breeding-plan/variety'
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_MODULE_TYPE = null
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_QUERY_PERMISSION = 'program:variety:query'
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_SUBMIT_PERMISSION = 'program:variety:submit'
export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_DELETE_PERMISSION = 'program:variety:delete'

const LIST_URL = '/sys/parameter/page'
const SAVE_URL = '/sys/parameter/save'
const DELETE_URL = '/sys/parameter/delete'

export type ProductSettingHatchManageVarietyId = string | number

export type ProductSettingHatchManageVarietyQuery = {
  suiteId?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingHatchManageVarietyRow = Record<string, unknown> & {
  id: ProductSettingHatchManageVarietyId | null
  name: string | null
  code: string | null
  caption: string | null
  icon: string | null
  variety: string | null
  varietyName: string | null
  gen: string | null
  genName: string | null
}

export type ProductSettingHatchManageVarietyPage = {
  list: ProductSettingHatchManageVarietyRow[]
  total: number
}

export type ProductSettingHatchManageVarietyCreateForm = {
  name: string
  code: string
  caption: string
  icon?: string | null
  variety?: string | null
  gen?: string | null
}

export type ProductSettingHatchManageVarietyCreateDraft = {
  id: ''
  name: string
  code: string
  caption: string
  icon: string
  variety: string
  gen: string
}

export type ProductSettingHatchManageVarietyUpdateForm = Record<string, unknown> & {
  id?: ProductSettingHatchManageVarietyId | null | ''
  name?: string | null
  code?: string | null
  caption?: string | null
  icon?: string | null
  variety?: string | null
  gen?: string | null
}

export type ProductSettingHatchManageVarietyUpdateDraft = {
  id: ProductSettingHatchManageVarietyId | ''
  name: string
  code: string
  caption: string
  icon: string
  variety: string
  gen: string
}

export type ProductSettingHatchManageVarietySaveInput = {
  draft: ProductSettingHatchManageVarietyCreateDraft | ProductSettingHatchManageVarietyUpdateDraft
  suiteId?: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingHatchManageVarietyId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingHatchManageVarietyId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function formTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = formTextOf(value, label)
  if (text.length === 0) throw new Error(`${label}不能为空`)
  return text
}

function optionalIdOf (value: unknown, label: string): ProductSettingHatchManageVarietyId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function suiteIdOf (value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('suiteId必须为字符串或空值')
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function rowOf (value: unknown, index: number): ProductSettingHatchManageVarietyRow {
  const row = objectOf(value, `预案品种列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `预案品种列表[${index}].id`),
    name: nullableTextOf(row.name, `预案品种列表[${index}].name`),
    code: nullableTextOf(row.code, `预案品种列表[${index}].code`),
    caption: nullableTextOf(row.caption, `预案品种列表[${index}].caption`),
    icon: nullableTextOf(row.icon, `预案品种列表[${index}].icon`),
    variety: nullableTextOf(row.variety, `预案品种列表[${index}].variety`),
    varietyName: nullableTextOf(row.varietyName, `预案品种列表[${index}].varietyName`),
    gen: nullableTextOf(row.gen, `预案品种列表[${index}].gen`),
    genName: nullableTextOf(row.genName, `预案品种列表[${index}].genName`),
  }
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (object.data !== undefined && object.page === undefined && object.list === undefined && object.records === undefined && object.rows === undefined) return object.data
  }
  return value
}

function pageOf (value: unknown): ProductSettingHatchManageVarietyPage {
  const payload = payloadOf(value)
  if (Array.isArray(payload)) return { list: payload.map((item, index) => rowOf(item, index)), total: payload.length }
  const object = objectOf(payload, '预案品种分页响应')
  const page = objectOf(object.page ?? object, '预案品种分页响应.page')
  const list = page.records ?? page.list ?? page.rows
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new Error('预案品种分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: Number(total) }
}

function queryOf (query: ProductSettingHatchManageVarietyQuery = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    order: '',
    orderField: '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  const suiteId = suiteIdOf(query.suiteId)
  if (suiteId !== undefined) params.suiteId = suiteId
  return params
}

function createFormOf (value: unknown): ProductSettingHatchManageVarietyCreateDraft {
  const form = objectOf(value, '预案品种新建表单')
  return {
    id: '',
    name: requiredTextOf(form.name, '名字'),
    code: requiredTextOf(form.code, '编码'),
    caption: requiredTextOf(form.caption, '说明'),
    icon: formTextOf(form.icon, '图标'),
    variety: formTextOf(form.variety, '品种'),
    gen: formTextOf(form.gen, '代次'),
  }
}

function updateFormOf (value: unknown): ProductSettingHatchManageVarietyUpdateDraft {
  const form = objectOf(value, '预案品种编辑表单')
  return {
    id: optionalIdOf(form.id, '预案品种ID'),
    name: requiredTextOf(form.name, '名字'),
    code: requiredTextOf(form.code, '编码'),
    caption: requiredTextOf(form.caption, '说明'),
    icon: formTextOf(form.icon, '图标'),
    variety: formTextOf(form.variety, '品种'),
    gen: formTextOf(form.gen, '代次'),
  }
}

function saveInputOf (value: unknown, label: string): { draft: JsonObject; suiteId?: string } {
  const input = objectOf(value, label)
  const draft = objectOf(input.draft, `${label}.draft`)
  return { draft, suiteId: suiteIdOf(input.suiteId) }
}

function removeIdOf (value: unknown): ProductSettingHatchManageVarietyId {
  return idOf(value, '预案品种ID')
}

function saveDataOf (draft: JsonObject, suiteId: string | undefined): JsonObject {
  return suiteId === undefined ? draft : { ...draft, suiteId }
}

/** The injected request must use PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH as page context. */
export function createProductSettingHatchManageVarietyCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingHatchManageVarietyQuery = {}): Promise<ProductSettingHatchManageVarietyPage> {
      return pageOf(await request({ url: LIST_URL, method: 'get', params: queryOf(query) }))
    },

    prepareCreate (form: ProductSettingHatchManageVarietyCreateForm): { draft: ProductSettingHatchManageVarietyCreateDraft } {
      return { draft: createFormOf(form) }
    },

    async create (input: ProductSettingHatchManageVarietySaveInput): Promise<true> {
      const submitted = saveInputOf(input, '预案品种新建参数')
      const draft = createFormOf(submitted.draft)
      await request({ url: SAVE_URL, method: 'post', data: saveDataOf(draft, submitted.suiteId) })
      return true
    },

    prepareUpdate (form: ProductSettingHatchManageVarietyUpdateForm): { draft: ProductSettingHatchManageVarietyUpdateDraft } {
      return { draft: updateFormOf(form) }
    },

    async update (input: ProductSettingHatchManageVarietySaveInput): Promise<true> {
      const submitted = saveInputOf(input, '预案品种编辑参数')
      const draft = updateFormOf(submitted.draft)
      await request({ url: SAVE_URL, method: 'post', data: saveDataOf(draft, submitted.suiteId) })
      return true
    },

    prepareRemove (input: { id: ProductSettingHatchManageVarietyId }): { id: ProductSettingHatchManageVarietyId } {
      return { id: removeIdOf(input?.id) }
    },

    async remove (input: { id: ProductSettingHatchManageVarietyId }): Promise<true> {
      const id = removeIdOf(input?.id)
      await request({ url: DELETE_URL, method: 'get', params: { id } })
      return true
    },
  }
}

export type ProductSettingHatchManageVarietyCapability = ReturnType<typeof createProductSettingHatchManageVarietyCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_HATCH_MANAGE_VARIETY_METHODS = {
  'product-setting-hatch-manage-variety-list': 'list',
  'product-setting-hatch-manage-variety-prepare-create': 'prepareCreate',
  'product-setting-hatch-manage-variety-create': 'create',
  'product-setting-hatch-manage-variety-prepare-update': 'prepareUpdate',
  'product-setting-hatch-manage-variety-update': 'update',
  'product-setting-hatch-manage-variety-prepare-remove': 'prepareRemove',
  'product-setting-hatch-manage-variety-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '预案品种新建弹窗表单；名字、编码、说明必填，图标、品种、代次可为空' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '预案品种编辑弹窗提交对象；只提交Portal表单的id、名字、编码、说明、图标、品种和代次字段' }

export const productSettingHatchManageVarietyCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-hatch-manage-variety-list', title: '查询预案品种', write: false, params: [p('suiteId', 'text', false, 'Portal路由中的可选suiteId；有值时原样加入列表请求'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-hatch-manage-variety-prepare-create', title: '准备新建预案品种', write: false, params: [createFormParam] },
  { id: 'product-setting-hatch-manage-variety-create', title: '新建预案品种', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的预案品种新建草稿'), p('suiteId', 'text', false, 'Portal路由中的可选suiteId；有值时原样加入保存请求体')] },
  { id: 'product-setting-hatch-manage-variety-prepare-update', title: '准备编辑预案品种', write: false, params: [updateFormParam] },
  { id: 'product-setting-hatch-manage-variety-update', title: '编辑预案品种', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的预案品种编辑草稿'), p('suiteId', 'text', false, 'Portal路由中的可选suiteId；有值时原样加入保存请求体')] },
  { id: 'product-setting-hatch-manage-variety-prepare-remove', title: '准备删除预案品种', write: false, params: [p('id', 'text', true, '当前列表行的Parameter记录ID')] },
  { id: 'product-setting-hatch-manage-variety-remove', title: '删除预案品种', write: true, params: [p('id', 'text', true, 'prepareRemove返回的Parameter记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PAGE_PATH,
  permission: PRODUCT_SETTING_HATCH_MANAGE_VARIETY_PERMISSION,
  moduleType: PRODUCT_SETTING_HATCH_MANAGE_VARIETY_MODULE_TYPE,
  httpInstance: 'product',
}))
