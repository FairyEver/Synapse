import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品设置 → 鸡群范围」。 */
export const PRODUCT_SETTING_USER_DICT_PAGE_PATH = '/dashboard/product/setting/base-setting/user-dict/list'
export const PRODUCT_SETTING_USER_DICT_PERMISSION = '/dashboard/frame/base-setting/user-dict'
export const PRODUCT_SETTING_USER_DICT_MODULE_TYPE = null
export const PRODUCT_SETTING_USER_DICT_QUERY_PERMISSION = 'management:user-dict:query'
export const PRODUCT_SETTING_USER_DICT_SUBMIT_PERMISSION = 'management:user-dict:submit'

const TYPE_LIST_URL = '/sys/dict/userDictTypeList'
const PAGE_URL = '/sys/dict/userDictPage'
const ENABLE_URL = '/sys/dict/enable'
const DEACTIVATE_URL = '/sys/dict/deactivate'
const SAVE_URL = '/sys/dict/userDictSave'

export type ProductSettingUserDictId = string | number

export type ProductSettingUserDictQuery = {
  type?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingUserDictTypeOption = {
  label: string
  value: string
}

export type ProductSettingUserDictRow = Record<string, unknown> & {
  id: ProductSettingUserDictId | null
  value: string | null
  label: string | null
  description: string | null
  type: string | null
  status: 0 | 1 | null
  statusStr: string | null
}

export type ProductSettingUserDictPage = {
  list: ProductSettingUserDictRow[]
  total: number
}

/** Portal 弹窗提交的五字段；新建时 id 仍按页面原样发送空字符串。 */
export type ProductSettingUserDictSave = {
  id: ProductSettingUserDictId | ''
  type: string
  description: string
  label: string
  value: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function idOf (value: unknown, label: string): ProductSettingUserDictId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingUserDictId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function saveIdOf (value: unknown): ProductSettingUserDictId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, '鸡群范围字典ID')
}

function statusOf (value: unknown, label: string): 0 | 1 | null {
  if (value === undefined || value === null) return null
  if (value === 0 || value === 1) return value
  throw new Error(`${label}必须为0或1或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: ProductSettingUserDictQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    type: textOf(query.type, '鸡群范围类型') ?? '',
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function typeOptionsOf (value: unknown): ProductSettingUserDictTypeOption[] {
  const envelope = Array.isArray(value) ? value : objectOf(value, '鸡群范围类型响应')
  const list = Array.isArray(envelope) ? envelope : envelope.typeList
  if (!Array.isArray(list)) throw new Error('鸡群范围类型响应必须包含数组typeList')
  return list.map((item, index) => {
    const option = objectOf(item, `鸡群范围类型[${index}]`)
    return {
      label: requiredTextOf(option.description, `鸡群范围类型[${index}].description`),
      value: requiredTextOf(option.type, `鸡群范围类型[${index}].type`),
    }
  })
}

function rowOf (value: unknown, index: number): ProductSettingUserDictRow {
  const row = objectOf(value, `鸡群范围列表[${index}]`)
  const rawId = row.id ?? row.dictId ?? row.dictID
  return {
    ...row,
    id: nullableIdOf(rawId, `鸡群范围列表[${index}].id`),
    value: textOf(row.value, `鸡群范围列表[${index}].value`),
    label: textOf(row.label, `鸡群范围列表[${index}].label`),
    description: textOf(row.description, `鸡群范围列表[${index}].description`),
    type: textOf(row.type, `鸡群范围列表[${index}].type`),
    status: statusOf(row.status, `鸡群范围列表[${index}].status`),
    statusStr: textOf(row.statusStr, `鸡群范围列表[${index}].statusStr`),
  }
}

function pageOf (value: unknown): ProductSettingUserDictPage {
  const envelope = objectOf(value, '鸡群范围分页响应')
  const page = objectOf(envelope.page ?? envelope, '鸡群范围分页响应.page')
  const list = page.list || page.records || page.rows || []
  const total = page.total || page.count || 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('鸡群范围分页响应缺少有效list或total')
  return { list: list.map((item, index) => rowOf(item, index)), total: total as number }
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

function userDictSaveOf (input: unknown): ProductSettingUserDictSave {
  const value = objectOf(input, '鸡群范围保存表单')
  return {
    id: saveIdOf(value.id),
    type: requiredTextOf(value.type, 'type'),
    description: value.description === undefined || value.description === null ? '' : (textOf(value.description, 'description') ?? ''),
    label: requiredTextOf(value.label, 'label'),
    value: requiredTextOf(value.value, 'value'),
  }
}

/** The injected request must use PRODUCT_SETTING_USER_DICT_PAGE_PATH as its page context. */
export function createProductSettingUserDictCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingUserDictQuery = {}): Promise<ProductSettingUserDictPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    async typeList (): Promise<ProductSettingUserDictTypeOption[]> {
      return typeOptionsOf(await request({ url: TYPE_LIST_URL, method: 'get' }))
    },

    async enable (input: { dictId: ProductSettingUserDictId }): Promise<true> {
      const dictId = idOf(input?.dictId, '鸡群范围ID')
      return trueAfterRequest(request({ url: ENABLE_URL, method: 'get', params: { dictId } }))
    },

    async deactivate (input: { dictId: ProductSettingUserDictId }): Promise<true> {
      const dictId = idOf(input?.dictId, '鸡群范围ID')
      return trueAfterRequest(request({ url: DEACTIVATE_URL, method: 'get', params: { dictId } }))
    },

    /** 只在本地校验 Portal 弹窗的五字段，不发送请求。 */
    prepareUserDictSave (input: ProductSettingUserDictSave): { draft: ProductSettingUserDictSave } {
      return { draft: userDictSaveOf(input) }
    },

    /** Portal 新建和编辑弹窗共用的 POST；body 保持 id/type/description/label/value 五字段。 */
    async submitUserDictSave (input: { draft: ProductSettingUserDictSave }): Promise<true> {
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: userDictSaveOf(input?.draft) }))
    },

    /** 弹窗取消只有本地副作用，不调用后端。 */
    cancelUserDictSave (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type ProductSettingUserDictCapability = ReturnType<typeof createProductSettingUserDictCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_SETTING_USER_DICT_METHODS = {
  'product-setting-user-dict-list': 'list',
  'product-setting-user-dict-type-list': 'typeList',
  'product-setting-user-dict-enable': 'enable',
  'product-setting-user-dict-deactivate': 'deactivate',
  'product-setting-user-dict-prepare-save': 'prepareUserDictSave',
  'product-setting-user-dict-save': 'submitUserDictSave',
  'product-setting-user-dict-cancel-save': 'cancelUserDictSave',
} as const

const USER_DICT_SAVE_PARAMS: ParamSpec[] = [
  p('id', 'text', false, '编辑时传当前字典ID；新建时按Portal原样发送空字符串。'),
  p('type', 'text', true, '类型值；从typeList返回的value取得。'),
  p('description', 'text', false, '类型展示名称；页面按类型候选的label回填，缺省发送空字符串。'),
  p('label', 'text', true, '鸡群范围展示名称。'),
  p('value', 'text', true, '鸡群范围业务值。'),
]
const USER_DICT_SAVE_DRAFT_PARAMS: ParamSpec[] = [
  p('draft', 'text', true, 'prepareUserDictSave返回的五字段请求草稿；提交时直接作为POST body。'),
]

export const productSettingUserDictCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-user-dict-list', title: '查询鸡群范围', write: false, params: [p('type', 'text', false, '鸡群范围类型筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-setting-user-dict-type-list', title: '查询鸡群范围类型', write: false, params: [] },
  { id: 'product-setting-user-dict-enable', title: '启用鸡群范围', write: true, params: [p('dictId', 'text', true, '当前列表行的字典ID')] },
  { id: 'product-setting-user-dict-deactivate', title: '停用鸡群范围', write: true, params: [p('dictId', 'text', true, '当前列表行的字典ID；后端会拒绝最后一项或已被使用的数据')] },
  { id: 'product-setting-user-dict-prepare-save', title: '准备保存鸡群范围', write: false, params: USER_DICT_SAVE_PARAMS },
  { id: 'product-setting-user-dict-save', title: '保存鸡群范围', write: true, params: USER_DICT_SAVE_DRAFT_PARAMS },
  { id: 'product-setting-user-dict-cancel-save', title: '取消保存鸡群范围', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_USER_DICT_PAGE_PATH,
  permission: PRODUCT_SETTING_USER_DICT_PERMISSION,
  moduleType: PRODUCT_SETTING_USER_DICT_MODULE_TYPE,
  httpInstance: 'product',
}))
