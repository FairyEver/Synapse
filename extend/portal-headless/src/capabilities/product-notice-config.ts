import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品运营 → 知会配置」。 */
export const PRODUCT_NOTICE_CONFIG_PAGE_PATH = '/dashboard/product/operation/notice-config/list'
export const PRODUCT_NOTICE_CONFIG_PERMISSION = '/dashboard/product/operation/notice-config'
export const PRODUCT_NOTICE_CONFIG_MODULE_TYPE = null

const PAGE_URL = '/config/notification/page'
const MODULE_LIST_URL = '/config/notification/getModuleList'
const POST_LIST_URL = '/config/notification/getPostList'
const CHOOSE_URL = '/config/notification/getChoose'
const SAVE_URL = '/flockSimu/config/notification/save'
const DELETE_URL = '/noticeConfig/delete'
const TOGGLE_STATUS_URL = '/config/notification/enableOrDisable'

export type ProductNoticeConfigId = string | number
export type ProductNoticeConfigModule = string | number
export type ProductNoticeConfigStatus = 0 | 1 | '0' | '1'

export type ProductNoticeConfigQuery = {
  title?: string | null
  module?: ProductNoticeConfigModule | null
  postId?: ProductNoticeConfigId | null
  status?: ProductNoticeConfigStatus | '' | null
  pageNo?: number
  pageSize?: number
}

export type ProductNoticeConfigRow = Record<string, unknown> & {
  id: ProductNoticeConfigId | null
  title: string | null
  module: number | null
  moduleName: string | null
  indicatorName: string | null
  params: string | null
  postIdList: number[] | null
  postName: string | null
  task: string | null
  jumpPage: string | null
  status: number | null
  statusName: string | null
}

export type ProductNoticeConfigForm = Record<string, unknown> & {
  module: ProductNoticeConfigModule
  title: string
  task: string
  jumpPage: string
  indicatorName: string
  params: string
  status: ProductNoticeConfigStatus
  postIdList: ProductNoticeConfigId[]
}

export type ProductNoticeConfigOption = {
  label: string
  value: string
}

export type ProductNoticeConfigPostOption = {
  label: string
  value: number
}

export type ProductNoticeConfigChooseNode = Record<string, unknown> & {
  value: string
  label: string
  childList: ProductNoticeConfigChooseNode[]
}

export type ProductNoticeConfigPage = {
  list: ProductNoticeConfigRow[]
  total: number
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

function idOf (value: unknown, label: string): ProductNoticeConfigId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function moduleOf (value: unknown, label: string): ProductNoticeConfigModule {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}不能为空`)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value
}

function nullableIdOf (value: unknown, label: string): ProductNoticeConfigId | null {
  if (value === undefined || value === null) return null
  return idOf(value, label)
}

function postIdListOf (value: unknown, label: string, required: boolean): ProductNoticeConfigId[] {
  if (!Array.isArray(value) || (required && value.length === 0)) throw new Error(`${label}必须为${required ? '非空' : ''}数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function statusOf (value: unknown, label: string, allowEmpty = false): ProductNoticeConfigStatus | '' {
  if (allowEmpty && (value === undefined || value === null || value === '')) return ''
  if (value === 0 || value === 1 || value === '0' || value === '1') return value
  throw new Error(`${label}只能是0或1`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryOf (query: ProductNoticeConfigQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    title: textOf(query.title, '推送名称') ?? '',
    module: query.module ?? '',
    postId: query.postId ?? '',
    status: statusOf(query.status, '状态', true),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function formOf (input: ProductNoticeConfigForm): ProductNoticeConfigForm {
  const value = objectOf(input, '知会配置表单')
  const payload = {
    ...value,
    module: moduleOf(value.module, '模块'),
    title: requiredTextOf(value.title, '推送名称'),
    task: requiredTextOf(value.task, '关联任务'),
    jumpPage: requiredTextOf(value.jumpPage, '跳转页面'),
    indicatorName: requiredTextOf(value.indicatorName, '指标名称'),
    params: requiredTextOf(value.params, '推送参数'),
    status: statusOf(value.status, '状态') as ProductNoticeConfigStatus,
    postIdList: postIdListOf(value.postIdList, '推送岗位', true),
  }
  return payload as ProductNoticeConfigForm
}

function rowOf (value: unknown, index: number): ProductNoticeConfigRow {
  const row = objectOf(value, `知会配置列表[${index}]`)
  const postIdList = row.postIdList === undefined || row.postIdList === null
    ? null
    : postIdListOf(row.postIdList, `知会配置列表[${index}].postIdList`, false).map(item => typeof item === 'number' ? item : Number(item))
  return {
    ...row,
    id: nullableIdOf(row.id, `知会配置列表[${index}].id`),
    title: textOf(row.title, `知会配置列表[${index}].title`),
    module: nullableIntegerOf(row.module, `知会配置列表[${index}].module`),
    moduleName: textOf(row.moduleName, `知会配置列表[${index}].moduleName`),
    indicatorName: textOf(row.indicatorName, `知会配置列表[${index}].indicatorName`),
    params: textOf(row.params, `知会配置列表[${index}].params`),
    postIdList,
    postName: textOf(row.postName, `知会配置列表[${index}].postName`),
    task: textOf(row.task, `知会配置列表[${index}].task`),
    jumpPage: textOf(row.jumpPage, `知会配置列表[${index}].jumpPage`),
    status: nullableIntegerOf(row.status, `知会配置列表[${index}].status`),
    statusName: textOf(row.statusName, `知会配置列表[${index}].statusName`),
  }
}

function pageOf (value: unknown): ProductNoticeConfigPage {
  const envelope = objectOf(value, '知会配置分页响应')
  const page = objectOf(envelope.page ?? envelope, '知会配置分页响应.page')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('知会配置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, index)), total: page.total as number }
}

function optionsOf (value: unknown, key: 'moduleList' | 'postList'): unknown[] {
  if (Array.isArray(value)) return value
  const object = objectOf(value, `知会配置${key}响应`)
  if (!Array.isArray(object[key])) throw new Error(`知会配置${key}响应必须为数组`)
  return object[key] as unknown[]
}

function moduleOptionsOf (value: unknown): ProductNoticeConfigOption[] {
  return optionsOf(value, 'moduleList').map((item, index) => {
    const option = objectOf(item, `模块选项[${index}]`)
    return { label: requiredTextOf(option.label, `模块选项[${index}].label`), value: requiredTextOf(String(option.value ?? ''), `模块选项[${index}].value`) }
  })
}

function postOptionsOf (value: unknown): ProductNoticeConfigPostOption[] {
  return optionsOf(value, 'postList').map((item, index) => {
    const option = objectOf(item, `岗位选项[${index}]`)
    const rawValue = option.value
    const numericValue = typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' && /^\d+$/.test(rawValue) ? Number(rawValue) : NaN
    if (!Number.isSafeInteger(numericValue) || numericValue <= 0) throw new Error(`岗位选项[${index}].value必须为正整数`)
    return { label: requiredTextOf(option.label, `岗位选项[${index}].label`), value: numericValue }
  })
}

function chooseNodeOf (value: unknown, label: string): ProductNoticeConfigChooseNode {
  const node = objectOf(value, label)
  if (!Array.isArray(node.childList)) throw new Error(`${label}.childList必须为数组`)
  return {
    ...node,
    value: requiredTextOf(node.value, `${label}.value`),
    label: requiredTextOf(node.label, `${label}.label`),
    childList: node.childList.map((item, index) => chooseNodeOf(item, `${label}.childList[${index}]`)),
  }
}

function chooseOf (value: unknown): ProductNoticeConfigChooseNode[] {
  if (Array.isArray(value)) return value.map((item, index) => chooseNodeOf(item, `知会级联选项[${index}]`))
  const object = objectOf(value, '知会级联选项响应')
  if (!Array.isArray(object.list)) throw new Error('知会级联选项响应必须为数组')
  return object.list.map((item, index) => chooseNodeOf(item, `知会级联选项[${index}]`))
}

function trueAfterRequest (request: Promise<unknown>): Promise<true> {
  return request.then(() => true)
}

/** The injected request must use PRODUCT_NOTICE_CONFIG_PAGE_PATH as its page context. */
export function createProductNoticeConfigCapability (request: PortalRequest) {
  return {
    async list (query: ProductNoticeConfigQuery = {}): Promise<ProductNoticeConfigPage> {
      return pageOf(await request({ url: PAGE_URL, method: 'get', params: queryOf(query) }))
    },

    async moduleList (): Promise<ProductNoticeConfigOption[]> {
      return moduleOptionsOf(await request({ url: MODULE_LIST_URL, method: 'get' }))
    },

    async postList (): Promise<ProductNoticeConfigPostOption[]> {
      return postOptionsOf(await request({ url: POST_LIST_URL, method: 'get' }))
    },

    async choose (): Promise<ProductNoticeConfigChooseNode[]> {
      return chooseOf(await request({ url: CHOOSE_URL, method: 'get' }))
    },

    prepareSave (form: ProductNoticeConfigForm): { draft: ProductNoticeConfigForm } {
      return { draft: formOf(form) }
    },

    async save (input: { draft: ProductNoticeConfigForm }): Promise<true> {
      const draft = formOf(input?.draft)
      return trueAfterRequest(request({ url: SAVE_URL, method: 'post', data: draft }))
    },

    async remove (input: { id: ProductNoticeConfigId }): Promise<true> {
      const id = idOf(input?.id, '知会配置ID')
      return trueAfterRequest(request({ url: DELETE_URL, method: 'delete', params: { id } }))
    },

    async toggleStatus (input: { title: string; module: ProductNoticeConfigModule; status: 0 | 1 }): Promise<true> {
      const title = requiredTextOf(input?.title, '推送名称')
      const module = moduleOf(input?.module, '模块')
      if (input?.status !== 0 && input?.status !== 1) throw new Error('当前状态只能是0或1')
      const status = input.status === 1 ? '0' : '1'
      return trueAfterRequest(request({ url: TOGGLE_STATUS_URL, method: 'get', params: { title, module, status } }))
    },
  }
}

export type ProductNoticeConfigCapability = ReturnType<typeof createProductNoticeConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_NOTICE_CONFIG_METHODS = {
  'product-notice-config-list': 'list',
  'product-notice-config-module-list': 'moduleList',
  'product-notice-config-post-list': 'postList',
  'product-notice-config-choose': 'choose',
  'product-notice-config-prepare-save': 'prepareSave',
  'product-notice-config-save': 'save',
  'product-notice-config-remove': 'remove',
  'product-notice-config-toggle-status': 'toggleStatus',
} as const

export const productNoticeConfigCapabilities: CapabilityDefinition[] = [
  { id: 'product-notice-config-list', title: '查询知会配置', write: false, params: [p('title', 'text', false, '推送名称前缀筛选；默认空字符串'), p('module', 'text', false, '模块值；默认空字符串'), p('postId', 'text', false, '推送岗位ID；默认空字符串'), p('status', 'enum', false, '状态0停用、1启用；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-notice-config-module-list', title: '查询知会配置模块', write: false, params: [] },
  { id: 'product-notice-config-post-list', title: '查询知会配置岗位', write: false, params: [] },
  { id: 'product-notice-config-choose', title: '查询知会级联选项', write: false, params: [] },
  { id: 'product-notice-config-prepare-save', title: '准备保存知会配置', write: false, params: [p('form', 'text', true, 'Portal知会配置表单；模块、推送名称、关联任务、跳转页面、指标名称、推送参数、状态和推送岗位均必填')] },
  { id: 'product-notice-config-save', title: '保存知会配置', write: true, params: [p('draft', 'text', true, 'prepareSave返回的完整表单草稿；取消时丢弃，不调用保存接口')] },
  { id: 'product-notice-config-remove', title: '删除知会配置', write: true, params: [p('id', 'text', true, 'Portal列表行record.id；页面当前直接按该ID发送DELETE')] },
  { id: 'product-notice-config-toggle-status', title: '切换知会配置状态', write: true, params: [p('title', 'text', true, '当前列表行推送名称'), p('module', 'text', true, '当前列表行模块值'), p('status', 'number', true, '当前列表行状态0或1；SDK按Portal严格反转为字符串目标值')] },
].map(definition => ({ ...definition, pagePath: PRODUCT_NOTICE_CONFIG_PAGE_PATH, permission: PRODUCT_NOTICE_CONFIG_PERMISSION, moduleType: PRODUCT_NOTICE_CONFIG_MODULE_TYPE, httpInstance: 'product' }))
