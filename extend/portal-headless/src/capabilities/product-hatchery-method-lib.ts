import type { PortalRequest } from '../session/types.js'
import {
  createProductSettingHatchManageMethodLibCapability,
  type ProductSettingHatchManageMethodLibCapability,
  type ProductSettingHatchManageMethodLibCreateForm,
  type ProductSettingHatchManageMethodLibCreateInput,
  type ProductSettingHatchManageMethodLibCreateResult,
  type ProductSettingHatchManageMethodLibFile,
  type ProductSettingHatchManageMethodLibPage,
  type ProductSettingHatchManageMethodLibQuery,
  type ProductSettingHatchManageMethodLibRow,
  type ProductSettingHatchManageMethodLibTemperatureOption,
  type ProductSettingHatchManageMethodLibUpdateForm,
} from './product-setting-hatch-manage-method-lib.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 孵化预案 → 方法库」。 */
export const PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH = '/dashboard/product/setting/hatchery-manage/method-lib/list'
export const PRODUCT_HATCHERY_METHOD_LIB_PERMISSION = '/dashboard/frame/hatchery-plan/method-lib'
export const PRODUCT_HATCHERY_METHOD_LIB_MODULE_TYPE = null
export const PRODUCT_HATCHERY_METHOD_LIB_QUERY_PERMISSION = 'program:method-lib:query'
export const PRODUCT_HATCHERY_METHOD_LIB_SUBMIT_PERMISSION = 'program:method-lib:submit'
export const PRODUCT_HATCHERY_METHOD_LIB_DELETE_PERMISSION = 'program:method-lib:delete'

export type ProductHatcheryMethodLibId = string | number
export type ProductHatcheryMethodLibFlag = 1 | 2 | 3
export type ProductHatcheryMethodLibQuery = ProductSettingHatchManageMethodLibQuery
export type ProductHatcheryMethodLibRow = ProductSettingHatchManageMethodLibRow
export type ProductHatcheryMethodLibPage = ProductSettingHatchManageMethodLibPage
export type ProductHatcheryMethodLibTemperatureOption = ProductSettingHatchManageMethodLibTemperatureOption
export type ProductHatcheryMethodLibFile = ProductSettingHatchManageMethodLibFile
export type ProductHatcheryMethodLibCreateForm = ProductSettingHatchManageMethodLibCreateForm
export type ProductHatcheryMethodLibCreateInput = ProductSettingHatchManageMethodLibCreateInput
export type ProductHatcheryMethodLibCreateResult = ProductSettingHatchManageMethodLibCreateResult
export type ProductHatcheryMethodLibUpdateForm = ProductSettingHatchManageMethodLibUpdateForm

const OLD_METHOD_LIB_PREFIX = '/programNew/methodLib'
const HATCHERY_METHOD_LIB_PREFIX = '/hatchProgram/methodLib'

/**
 * The wrapper page reuses the old Vue component, but that component selects the
 * hatchery API base from the current route. Keep the shared validation and
 * FormData behavior while translating only the method-library endpoints.
 */
function hatcheryRequest (request: PortalRequest): PortalRequest {
  return async <T>(config: Parameters<PortalRequest>[0]) => {
    const url = typeof config.url === 'string' && config.url.startsWith(OLD_METHOD_LIB_PREFIX)
      ? `${HATCHERY_METHOD_LIB_PREFIX}${config.url.slice(OLD_METHOD_LIB_PREFIX.length)}`
      : config.url
    return request<T>({ ...config, url })
  }
}

/** The injected request must use PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH as page context. */
export function createProductHatcheryMethodLibCapability (request: PortalRequest): ProductSettingHatchManageMethodLibCapability {
  return createProductSettingHatchManageMethodLibCapability(hatcheryRequest(request))
}

export type ProductHatcheryMethodLibCapability = ReturnType<typeof createProductHatcheryMethodLibCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_HATCHERY_METHOD_LIB_METHODS = {
  'product-hatchery-method-lib-temperature-options': 'temperatureOptions',
  'product-hatchery-method-lib-list': 'list',
  'product-hatchery-method-lib-prepare-create': 'prepareCreate',
  'product-hatchery-method-lib-create': 'create',
  'product-hatchery-method-lib-prepare-update': 'prepareUpdate',
  'product-hatchery-method-lib-update': 'update',
  'product-hatchery-method-lib-prepare-remove': 'prepareRemove',
  'product-hatchery-method-lib-remove': 'remove',
  'product-hatchery-method-lib-download-template': 'downloadTemplate',
} as const

export const productHatcheryMethodLibCapabilities: CapabilityDefinition[] = [
  { id: 'product-hatchery-method-lib-temperature-options', title: '查询孵化预案方法库舍内温度选项', write: false, params: [] },
  { id: 'product-hatchery-method-lib-list', title: '查询孵化预案方法库', write: false, params: [p('variety', 'text', false, '品种筛选；默认空字符串'), p('gen', 'text', false, '代次筛选；默认空字符串'), p('tempId', 'text', false, '舍内温度ID筛选；默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；只支持10、20、50、100，默认20')] },
  { id: 'product-hatchery-method-lib-prepare-create', title: '准备新建孵化预案方法库', write: false, params: [p('form', 'text', true, '品种、代次、舍内温度和可选xls/xlsx文件；首次导入允许文件为空，按Portal原样提交')] },
  { id: 'product-hatchery-method-lib-create', title: '新建或导入孵化预案方法库', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的方法库新建草稿'), p('flag', 'enum', false, '重复预案时用户选择1替换、2增加或3覆盖；首次请求省略')] },
  { id: 'product-hatchery-method-lib-prepare-update', title: '准备编辑孵化预案方法库', write: false, params: [p('form', 'text', true, '当前列表行编辑表单；品种、代次、舍内温度和suiteCode必填')] },
  { id: 'product-hatchery-method-lib-update', title: '编辑孵化预案方法库', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的五字段草稿；file固定为null')] },
  { id: 'product-hatchery-method-lib-prepare-remove', title: '准备删除孵化预案方法库', write: false, params: [p('suiteCode', 'text', true, '当前列表行的非空suiteCode')] },
  { id: 'product-hatchery-method-lib-remove', title: '删除孵化预案方法库', write: true, params: [p('suiteCode', 'text', true, 'prepareRemove返回的suiteCode')] },
  { id: 'product-hatchery-method-lib-download-template', title: '下载孵化预案方法库模板', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_HATCHERY_METHOD_LIB_PAGE_PATH,
  permission: PRODUCT_HATCHERY_METHOD_LIB_PERMISSION,
  moduleType: PRODUCT_HATCHERY_METHOD_LIB_MODULE_TYPE,
  httpInstance: 'product',
}))
