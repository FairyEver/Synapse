import type { PortalRequest } from '../session/types.js'
import {
  createProductSettingHatchManageLibCapability,
  type ProductSettingHatchManageLibCapability,
  type ProductSettingHatchManageLibCreateForm,
  type ProductSettingHatchManageLibCreateInput,
  type ProductSettingHatchManageLibCreateResult,
  type ProductSettingHatchManageLibFile,
  type ProductSettingHatchManageLibPage,
  type ProductSettingHatchManageLibQuery,
  type ProductSettingHatchManageLibRow,
  type ProductSettingHatchManageLibTemperatureOption,
  type ProductSettingHatchManageLibUpdateForm,
} from './product-setting-hatch-manage-lib.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 孵化预案 → 标准库」。页面组件由Portal包装器复用养殖预案标准库组件。 */
export const PRODUCT_HATCHERY_LIB_PAGE_PATH = '/dashboard/product/setting/hatchery-manage/lib/list'
export const PRODUCT_HATCHERY_LIB_PERMISSION = '/dashboard/frame/hatchery-plan/lib'
export const PRODUCT_HATCHERY_LIB_MODULE_TYPE = null
export const PRODUCT_HATCHERY_LIB_QUERY_PERMISSION = 'program:suite:query'
export const PRODUCT_HATCHERY_LIB_SUBMIT_PERMISSION = 'program:suite:submit'
export const PRODUCT_HATCHERY_LIB_DELETE_PERMISSION = 'program:suite:delete'

export type ProductHatcheryLibId = string | number
export type ProductHatcheryLibFlag = 1 | 2 | 3
export type ProductHatcheryLibQuery = ProductSettingHatchManageLibQuery
export type ProductHatcheryLibRow = ProductSettingHatchManageLibRow
export type ProductHatcheryLibPage = ProductSettingHatchManageLibPage
export type ProductHatcheryLibTemperatureOption = ProductSettingHatchManageLibTemperatureOption
export type ProductHatcheryLibFile = ProductSettingHatchManageLibFile
export type ProductHatcheryLibCreateForm = ProductSettingHatchManageLibCreateForm
export type ProductHatcheryLibCreateInput = ProductSettingHatchManageLibCreateInput
export type ProductHatcheryLibCreateResult = ProductSettingHatchManageLibCreateResult
export type ProductHatcheryLibUpdateForm = ProductSettingHatchManageLibUpdateForm

/** The injected request must use PRODUCT_HATCHERY_LIB_PAGE_PATH as page context. */
export function createProductHatcheryLibCapability (request: PortalRequest): ProductSettingHatchManageLibCapability {
  // hatchery-manage/lib/list imports hatch-manage/lib/list in Portal; this deliberately
  // reuses that component's exact request, FormData and response behavior.
  return createProductSettingHatchManageLibCapability(request)
}

export type ProductHatcheryLibCapability = ReturnType<typeof createProductHatcheryLibCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_HATCHERY_LIB_METHODS = {
  'product-hatchery-lib-temperature-options': 'temperatureOptions',
  'product-hatchery-lib-list': 'list',
  'product-hatchery-lib-prepare-create': 'prepareCreate',
  'product-hatchery-lib-create': 'create',
  'product-hatchery-lib-prepare-update': 'prepareUpdate',
  'product-hatchery-lib-update': 'update',
  'product-hatchery-lib-prepare-remove': 'prepareRemove',
  'product-hatchery-lib-remove': 'remove',
  'product-hatchery-lib-download-template': 'downloadTemplate',
} as const

export const productHatcheryLibCapabilities: CapabilityDefinition[] = [
  { id: 'product-hatchery-lib-temperature-options', title: '查询孵化预案标准库舍内温度选项', write: false, params: [] },
  { id: 'product-hatchery-lib-list', title: '查询孵化预案标准库', write: false, params: [p('variety', 'text'), p('gen', 'text'), p('tempId', 'text'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'product-hatchery-lib-prepare-create', title: '准备新建孵化预案标准库', write: false, params: [p('form', 'text', true, '品种、代次、舍内温度和Excel文件')] },
  { id: 'product-hatchery-lib-create', title: '新建或导入孵化预案标准库', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的草稿'), p('flag', 'enum', false, '冲突时用户选择1替换、2增加或3覆盖')] },
  { id: 'product-hatchery-lib-prepare-update', title: '准备编辑孵化预案标准库', write: false, params: [p('form', 'text', true, '当前行编辑表单')] },
  { id: 'product-hatchery-lib-update', title: '编辑孵化预案标准库', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的草稿')] },
  { id: 'product-hatchery-lib-prepare-remove', title: '准备删除孵化预案标准库', write: false, params: [p('suiteCode', 'text', true, '当前列表行suiteCode')] },
  { id: 'product-hatchery-lib-remove', title: '删除孵化预案标准库', write: true, params: [p('suiteCode', 'text', true, 'prepareRemove返回的suiteCode')] },
  { id: 'product-hatchery-lib-download-template', title: '下载孵化预案标准库模板', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_HATCHERY_LIB_PAGE_PATH,
  permission: PRODUCT_HATCHERY_LIB_PERMISSION,
  moduleType: PRODUCT_HATCHERY_LIB_MODULE_TYPE,
  httpInstance: 'product',
}))
