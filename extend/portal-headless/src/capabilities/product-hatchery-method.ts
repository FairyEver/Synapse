import type { PortalRequest } from '../session/types.js'
import {
  createProductSettingHatchManageMethodCapability,
  type ProductSettingHatchManageMethodCapability,
  type ProductSettingHatchManageMethodCreateForm,
  type ProductSettingHatchManageMethodCreateDraft,
  type ProductSettingHatchManageMethodId,
  type ProductSettingHatchManageMethodPage,
  type ProductSettingHatchManageMethodQuery,
  type ProductSettingHatchManageMethodRow,
  type ProductSettingHatchManageMethodUpdateDraft,
  type ProductSettingHatchManageMethodUpdateForm,
} from './product-setting-hatch-manage-method.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 孵化预案 → 方法设置」。页面包装器复用养殖预案的方法设置组件。 */
export const PRODUCT_HATCHERY_METHOD_PAGE_PATH = '/dashboard/product/setting/hatchery-manage/method/list'
export const PRODUCT_HATCHERY_METHOD_PERMISSION = '/dashboard/frame/hatchery-plan/method'
export const PRODUCT_HATCHERY_METHOD_MODULE_TYPE = null
export const PRODUCT_HATCHERY_METHOD_QUERY_PERMISSION = 'program:method:query'
export const PRODUCT_HATCHERY_METHOD_SUBMIT_PERMISSION = 'program:method:submit'
export const PRODUCT_HATCHERY_METHOD_DELETE_PERMISSION = 'program:method:delete'

export type ProductHatcheryMethodId = ProductSettingHatchManageMethodId
export type ProductHatcheryMethodQuery = ProductSettingHatchManageMethodQuery
export type ProductHatcheryMethodRow = ProductSettingHatchManageMethodRow
export type ProductHatcheryMethodPage = ProductSettingHatchManageMethodPage
export type ProductHatcheryMethodCreateForm = ProductSettingHatchManageMethodCreateForm
export type ProductHatcheryMethodCreateDraft = ProductSettingHatchManageMethodCreateDraft
export type ProductHatcheryMethodUpdateForm = ProductSettingHatchManageMethodUpdateForm
export type ProductHatcheryMethodUpdateDraft = ProductSettingHatchManageMethodUpdateDraft

/** The injected request must use PRODUCT_HATCHERY_METHOD_PAGE_PATH as page context. */
export function createProductHatcheryMethodCapability (request: PortalRequest): ProductSettingHatchManageMethodCapability {
  // hatchery-manage/method/list imports hatch-manage/method/list in Portal. Reusing
  // the implementation preserves its exact product requests, validation and response handling.
  return createProductSettingHatchManageMethodCapability(request)
}

export type ProductHatcheryMethodCapability = ReturnType<typeof createProductHatcheryMethodCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_HATCHERY_METHODS = {
  'product-hatchery-method-list': 'list',
  'product-hatchery-method-prepare-create': 'prepareCreate',
  'product-hatchery-method-create': 'create',
  'product-hatchery-method-prepare-update': 'prepareUpdate',
  'product-hatchery-method-update': 'update',
  'product-hatchery-method-prepare-remove': 'prepareRemove',
  'product-hatchery-method-remove': 'remove',
} as const

const createFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '方法设置新建弹窗表单；方法归类、名称、一级标题、二级标题、三级标题均必填' }
const updateFormParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '方法设置编辑弹窗提交对象；来自当前列表行并覆盖方法归类、名称和三级标题字段' }

export const productHatcheryMethodCapabilities: CapabilityDefinition[] = [
  { id: 'product-hatchery-method-list', title: '查询孵化预案方法设置', write: false, params: [p('classification', 'text', false, '方法归类字典值；省略时按Portal发送空字符串'), p('search', 'text', false, '方法名称或编码前缀；省略时发送空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-hatchery-method-prepare-create', title: '准备新建孵化预案方法设置', write: false, params: [createFormParam] },
  { id: 'product-hatchery-method-create', title: '新建孵化预案方法设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的方法设置新建草稿')] },
  { id: 'product-hatchery-method-prepare-update', title: '准备编辑孵化预案方法设置', write: false, params: [updateFormParam] },
  { id: 'product-hatchery-method-update', title: '编辑孵化预案方法设置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的编辑草稿；会保留Portal编辑提交对象中的扩展字段')] },
  { id: 'product-hatchery-method-prepare-remove', title: '准备删除孵化预案方法设置', write: false, params: [p('id', 'text', true, '当前列表行的ProgramUnit方法记录ID')] },
  { id: 'product-hatchery-method-remove', title: '删除孵化预案方法设置', write: true, params: [p('id', 'text', true, 'prepareRemove返回的方法记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_HATCHERY_METHOD_PAGE_PATH,
  permission: PRODUCT_HATCHERY_METHOD_PERMISSION,
  moduleType: PRODUCT_HATCHERY_METHOD_MODULE_TYPE,
  httpInstance: 'product',
}))
