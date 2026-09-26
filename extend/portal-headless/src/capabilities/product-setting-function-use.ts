import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 业务管理 → 功能开关」。 */
export const PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH = '/dashboard/product/setting/business-manage/function-use/list'
export const PRODUCT_SETTING_FUNCTION_USE_PERMISSION = '/dashboard/frame/business/function-use'
export const PRODUCT_SETTING_FUNCTION_USE_MODULE_TYPE = null
export const PRODUCT_SETTING_FUNCTION_USE_QUERY_PERMISSION = 'management:function-use:query'
export const PRODUCT_SETTING_FUNCTION_USE_SUBMIT_PERMISSION = 'management:function-use:submit'

const LIST_URL = '/config/functionUse/list'
const SWITCH_STATUS_URL = '/config/functionUse/openOrClose'

export type ProductSettingFunctionUseId = string | number
export type ProductSettingFunctionUseStatus = 0 | 1

export type ProductSettingFunctionUseRow = Record<string, unknown> & {
  id: ProductSettingFunctionUseId | null
  functionCode: string | null
  functionName: string | null
  remarks: string | null
  status: ProductSettingFunctionUseStatus | null
}

export type ProductSettingFunctionUseSwitchDraft = {
  id: ProductSettingFunctionUseId | null
  functionCode: string
  functionName: string | null
  status: ProductSettingFunctionUseStatus
}

export type ProductSettingFunctionUsePreparedSwitch = {
  draft: ProductSettingFunctionUseSwitchDraft
  previous: ProductSettingFunctionUseSwitchDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductSettingFunctionUseId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空ID`)
}

function nullableIdOf (value: unknown, label: string): ProductSettingFunctionUseId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
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

function nullableStatusOf (value: unknown, label: string): ProductSettingFunctionUseStatus | null {
  if (value === undefined || value === null) return null
  return statusOf(value, label)
}

function statusOf (value: unknown, label: string): ProductSettingFunctionUseStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function rowOf (value: unknown, index: number): ProductSettingFunctionUseRow {
  const row = objectOf(value, `功能开关列表[${index}]`)
  return {
    ...row,
    id: nullableIdOf(row.id, `功能开关列表[${index}].id`),
    functionCode: textOf(row.functionCode, `功能开关列表[${index}].functionCode`),
    functionName: textOf(row.functionName, `功能开关列表[${index}].functionName`),
    remarks: textOf(row.remarks, `功能开关列表[${index}].remarks`),
    status: nullableStatusOf(row.status, `功能开关列表[${index}].status`),
  }
}

function listOf (value: unknown): ProductSettingFunctionUseRow[] {
  const envelope = Array.isArray(value) ? value : objectOf(value, '功能开关列表响应')
  const list = Array.isArray(envelope) ? envelope : envelope.list
  if (!Array.isArray(list)) throw new Error('功能开关列表响应缺少list数组')
  return list.map((item, index) => rowOf(item, index))
}

function switchDraftOf (value: unknown, label: string): ProductSettingFunctionUseSwitchDraft {
  const draft = objectOf(value, label)
  return {
    id: nullableIdOf(draft.id, `${label}.id`),
    functionCode: requiredTextOf(draft.functionCode, `${label}.functionCode`),
    functionName: textOf(draft.functionName, `${label}.functionName`),
    status: statusOf(draft.status, `${label}.status`),
  }
}

/** The injected request must use PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH as its page context. */
export function createProductSettingFunctionUseCapability (request: PortalRequest) {
  return {
    async list (): Promise<ProductSettingFunctionUseRow[]> {
      return listOf(await request({ url: LIST_URL, method: 'get', params: { order: '', orderField: '' } }))
    },

    prepareSwitch (input: { current: ProductSettingFunctionUseRow }): ProductSettingFunctionUsePreparedSwitch {
      const current = switchDraftOf(input?.current, '功能开关当前行')
      const draft: ProductSettingFunctionUseSwitchDraft = {
        ...current,
        status: current.status === 1 ? 0 : 1,
      }
      return { draft, previous: current }
    },

    async switchStatus (input: { draft: ProductSettingFunctionUseSwitchDraft }): Promise<true> {
      const draft = switchDraftOf(input?.draft, '功能开关启停输入')
      await request({
        url: SWITCH_STATUS_URL,
        method: 'get',
        params: {
          id: draft.id,
          functionCode: draft.functionCode,
          functionName: draft.functionName,
          status: draft.status,
        },
      })
      return true
    },
  }
}

export type ProductSettingFunctionUseCapability = ReturnType<typeof createProductSettingFunctionUseCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })
export const PRODUCT_SETTING_FUNCTION_USE_METHODS = {
  'product-setting-function-use-list': 'list',
  'product-setting-function-use-prepare-switch': 'prepareSwitch',
  'product-setting-function-use-switch-status': 'switchStatus',
} as const

export const productSettingFunctionUseCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-function-use-list', title: '查询功能开关', write: false, params: [] },
  { id: 'product-setting-function-use-prepare-switch', title: '准备切换功能开关', write: false, params: [p('current', 'text', true, '来自最新列表的完整功能开关行；系统功能可能id为null'),] },
  { id: 'product-setting-function-use-switch-status', title: '切换功能开关状态', write: true, params: [p('draft', 'text', true, 'prepareSwitch返回的完整draft；确认后原样提交')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_FUNCTION_USE_PAGE_PATH,
  permission: PRODUCT_SETTING_FUNCTION_USE_PERMISSION,
  moduleType: PRODUCT_SETTING_FUNCTION_USE_MODULE_TYPE,
  httpInstance: 'product',
}))
