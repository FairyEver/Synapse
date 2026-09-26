import type { PortalRequest } from '../session/types.js'
import {
  createProductSettingHatchManageUnitCapability,
  type ProductSettingHatchManageUnitCapability,
  type ProductSettingHatchManageUnitContentType,
  type ProductSettingHatchManageUnitCreateDraft,
  type ProductSettingHatchManageUnitCreateForm,
  type ProductSettingHatchManageUnitId,
  type ProductSettingHatchManageUnitPage,
  type ProductSettingHatchManageUnitQuery,
  type ProductSettingHatchManageUnitRow,
  type ProductSettingHatchManageUnitUpdateDraft,
  type ProductSettingHatchManageUnitUpdateForm,
} from './product-setting-hatch-manage-unit.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 孵化预案 → 标准设置」。页面组件复用养殖预案标准设置组件。 */
export const PRODUCT_HATCHERY_UNIT_PAGE_PATH = '/dashboard/product/setting/hatchery-manage/unit/list'
export const PRODUCT_HATCHERY_UNIT_PERMISSION = '/dashboard/frame/hatchery-plan/unit'
export const PRODUCT_HATCHERY_UNIT_MODULE_TYPE = null
export const PRODUCT_HATCHERY_UNIT_QUERY_PERMISSION = 'program:unit:query'
export const PRODUCT_HATCHERY_UNIT_SUBMIT_PERMISSION = 'program:unit:submit'
export const PRODUCT_HATCHERY_UNIT_DELETE_PERMISSION = 'program:unit:delete'

export type ProductHatcheryUnitId = ProductSettingHatchManageUnitId
export type ProductHatcheryUnitContentType = ProductSettingHatchManageUnitContentType
export type ProductHatcheryUnitQuery = ProductSettingHatchManageUnitQuery
export type ProductHatcheryUnitRow = ProductSettingHatchManageUnitRow
export type ProductHatcheryUnitPage = ProductSettingHatchManageUnitPage
export type ProductHatcheryUnitCreateForm = ProductSettingHatchManageUnitCreateForm
export type ProductHatcheryUnitCreateDraft = ProductSettingHatchManageUnitCreateDraft
export type ProductHatcheryUnitUpdateForm = ProductSettingHatchManageUnitUpdateForm
export type ProductHatcheryUnitUpdateDraft = ProductSettingHatchManageUnitUpdateDraft

/** The injected request must use PRODUCT_HATCHERY_UNIT_PAGE_PATH as page context. */
export function createProductHatcheryUnitCapability (request: PortalRequest): ProductSettingHatchManageUnitCapability {
  // hatchery-manage/unit/list imports hatch-manage/unit/list in Portal; this deliberately
  // reuses that component's exact request, form and response behavior.
  return createProductSettingHatchManageUnitCapability(request)
}

export type ProductHatcheryUnitCapability = ReturnType<typeof createProductHatcheryUnitCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_HATCHERY_UNIT_METHODS = {
  'product-hatchery-unit-list': 'list',
  'product-hatchery-unit-prepare-create': 'prepareCreate',
  'product-hatchery-unit-create': 'create',
  'product-hatchery-unit-prepare-update': 'prepareUpdate',
  'product-hatchery-unit-update': 'update',
  'product-hatchery-unit-prepare-remove': 'prepareRemove',
  'product-hatchery-unit-remove': 'remove',
} as const

export const productHatcheryUnitCapabilities: CapabilityDefinition[] = [
  { id: 'product-hatchery-unit-list', title: '查询孵化预案标准设置', write: false, params: [p('classification', 'text', false, '指标归类字典值；省略时按Portal发送空字符串'), p('search', 'text', false, '指标名称或编码前缀；省略时发送空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'product-hatchery-unit-prepare-create', title: '准备新建孵化预案标准设置', write: false, params: [p('form', 'text', true, '标准设置新建弹窗表单；归类、文本类型、名称和编码必填，数值类型还要求单位和小数位数')] },
  { id: 'product-hatchery-unit-create', title: '新建孵化预案标准设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的标准设置新建草稿')] },
  { id: 'product-hatchery-unit-prepare-update', title: '准备编辑孵化预案标准设置', write: false, params: [p('form', 'text', true, '标准设置编辑弹窗提交对象；来自当前列表行并覆盖id、归类、文本类型、名称、编码、单位和小数位数')] },
  { id: 'product-hatchery-unit-update', title: '编辑孵化预案标准设置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的编辑草稿；会保留Portal编辑提交对象中的扩展字段')] },
  { id: 'product-hatchery-unit-prepare-remove', title: '准备删除孵化预案标准设置', write: false, params: [p('id', 'text', true, '当前列表行的ProgramUnit记录ID')] },
  { id: 'product-hatchery-unit-remove', title: '删除孵化预案标准设置', write: true, params: [p('id', 'text', true, 'prepareRemove返回的ProgramUnit记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_HATCHERY_UNIT_PAGE_PATH,
  permission: PRODUCT_HATCHERY_UNIT_PERMISSION,
  moduleType: PRODUCT_HATCHERY_UNIT_MODULE_TYPE,
  httpInstance: 'product',
}))
