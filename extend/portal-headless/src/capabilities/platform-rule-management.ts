import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台 → 系统 → 规则管理」；列表和表单都使用 platform.js。 */
export const PLATFORM_RULE_MANAGEMENT_PAGE_PATH = '/dashboard/platform/system/express/list'
export const PLATFORM_RULE_MANAGEMENT_PERMISSION = '/dashboard/platform/system/express'
/** Portal 菜单规则表没有为此路径计算出 module-type，因此请求不发送该头。 */
export const PLATFORM_RULE_MANAGEMENT_MODULE_TYPE = null

const ROOT = '/admin-api/rulesManage'

export type PlatformRuleManagementId = string | number
export type PlatformRuleManagementSystemType = string | number

/** 来源于 Portal 的 SYSTEM_OPTIONS_ALL，顺序也按页面常量保留。 */
export const PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { value: 8, label: '科技' },
  { value: 0, label: '公共' },
  { value: 1, label: '人力' },
  { value: 2, label: '财务' },
  { value: 3, label: '资产' },
  { value: 4, label: '生产' },
  { value: 5, label: '采购' },
  { value: 6, label: '销售' },
  { value: 7, label: '门户' },
  { value: 10, label: '平台' },
]

export type PlatformRuleManagementQuery = {
  ruleCode?: string | null
  ruleName?: string | null
  ruleType?: string | null
  ruleGroup?: string | null
  enabled?: boolean | null
  systemType?: PlatformRuleManagementSystemType | null
  pageNo?: number
  pageSize?: number
  order?: string | null
  orderField?: string | null
}

export type PlatformRuleManagementRecord = Record<string, unknown> & {
  id: PlatformRuleManagementId
  ruleCode: string | null
  ruleName: string | null
  ruleExpression: string | null
  ruleDescription: string | null
  ruleType: string | null
  ruleGroup: string | null
  enabled: boolean | null
  priority: number | null
  systemType: PlatformRuleManagementSystemType | null
  version: number | null
  updateTime: string | number | null
}

/** 页面 pick(form, submitFields) 后的创建请求体（创建时不带 id）。 */
export type PlatformRuleManagementCreatePayload = {
  ruleCode: string
  ruleName: string
  ruleExpression: string
  ruleDescription: string | null
  ruleType: string
  ruleGroup: string
  enabled: boolean
  priority: number
  systemType: PlatformRuleManagementSystemType
  version: number
}

/** 页面 pick(form, submitFields) 后的更新请求体（id 在首位）。 */
export type PlatformRuleManagementUpdatePayload = PlatformRuleManagementCreatePayload & {
  id: PlatformRuleManagementId
}

export type PlatformRuleManagementForm = {
  id?: PlatformRuleManagementId | '' | null
  ruleCode: string
  ruleName: string
  ruleExpression: string
  ruleDescription?: string | null
  ruleType: string
  ruleGroup: string
  enabled: boolean
  priority: number
  systemType: PlatformRuleManagementSystemType
  version: number
}

export type PlatformRuleValidationResult = {
  valid: boolean
  message: string | null
  errors: string[] | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PlatformRuleManagementId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return value as number
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return integerOf(value, label)
}

function nullableBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function requiredBooleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数值或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined || value === null ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return result as number
}

function systemTypeOf (value: unknown, label: string, required = true): PlatformRuleManagementSystemType | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${label}必须为数字或字符串`)
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${label}不能为空`)
  const option = PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS.find(item => String(item.value) === String(value))
  return option?.value ?? value
}

function filterTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function filterBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  return requiredBooleanOf(value, label)
}

function filterSystemTypeOf (value: unknown, label: string): PlatformRuleManagementSystemType | null {
  return systemTypeOf(value, label, false)
}

function queryOf (input: PlatformRuleManagementQuery = {}): Record<string, unknown> {
  const query = input ?? {}
  const params: Record<string, unknown> = {
    order: filterTextOf(query.order, 'order') ?? '',
    orderField: filterTextOf(query.orderField, 'orderField') ?? '',
    ruleCode: filterTextOf(query.ruleCode, 'ruleCode'),
    ruleName: filterTextOf(query.ruleName, 'ruleName'),
    ruleType: filterTextOf(query.ruleType, 'ruleType'),
    ruleGroup: filterTextOf(query.ruleGroup, 'ruleGroup'),
    enabled: filterBooleanOf(query.enabled, 'enabled'),
    systemType: filterSystemTypeOf(query.systemType, 'systemType'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

function normalizeRuleExpression (value: unknown, label: string): string | null {
  const expression = nullableTextOf(value, label)
  if (expression === null || /[\r\n]/.test(expression)) return expression
  return expression.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
}

function systemTypeResponseOf (value: unknown, label: string): PlatformRuleManagementSystemType | null {
  return systemTypeOf(value, label, false)
}

function recordOf (value: unknown, label: string, normalizeExpression = false): PlatformRuleManagementRecord {
  const record = objectOf(value, label)
  return {
    ...record,
    id: idOf(record.id, `${label}.id`),
    ruleCode: nullableTextOf(record.ruleCode, `${label}.ruleCode`),
    ruleName: nullableTextOf(record.ruleName, `${label}.ruleName`),
    ruleExpression: normalizeExpression
      ? normalizeRuleExpression(record.ruleExpression, `${label}.ruleExpression`)
      : nullableTextOf(record.ruleExpression, `${label}.ruleExpression`),
    ruleDescription: nullableTextOf(record.ruleDescription, `${label}.ruleDescription`),
    ruleType: nullableTextOf(record.ruleType, `${label}.ruleType`),
    ruleGroup: nullableTextOf(record.ruleGroup, `${label}.ruleGroup`),
    enabled: nullableBooleanOf(record.enabled, `${label}.enabled`),
    priority: nullableIntegerOf(record.priority, `${label}.priority`),
    systemType: systemTypeResponseOf(record.systemType, `${label}.systemType`),
    version: nullableIntegerOf(record.version, `${label}.version`),
    updateTime: dateTimeOf(record.updateTime, `${label}.updateTime`),
  }
}

function pageOf (value: unknown): PageResult<PlatformRuleManagementRecord> {
  if (Array.isArray(value)) return { list: value.map((item, index) => recordOf(item, `规则列表[${index}]`)), total: value.length }
  const page = objectOf(value, '规则管理分页响应')
  const list = page.list ?? page.records ?? page.rows ?? []
  const total = page.total ?? page.count ?? 0
  if (!Array.isArray(list) || !Number.isSafeInteger(total) || (total as number) < 0) throw new Error('规则管理分页响应缺少有效list或total')
  return { list: list.map((item, index) => recordOf(item, `规则列表[${index}]`)), total: total as number }
}

type RuleFields = Omit<PlatformRuleManagementCreatePayload, 'ruleDescription'> & { ruleDescription: string | null }

function formFieldsOf (value: unknown, label: string): RuleFields {
  const form = objectOf(value, label)
  return {
    ruleCode: requiredTextOf(form.ruleCode, `${label}.ruleCode`),
    ruleName: requiredTextOf(form.ruleName, `${label}.ruleName`),
    ruleExpression: requiredTextOf(form.ruleExpression, `${label}.ruleExpression`),
    ruleDescription: form.ruleDescription === undefined ? '' : nullableTextOf(form.ruleDescription, `${label}.ruleDescription`),
    ruleType: requiredTextOf(form.ruleType, `${label}.ruleType`),
    ruleGroup: requiredTextOf(form.ruleGroup, `${label}.ruleGroup`),
    enabled: requiredBooleanOf(form.enabled, `${label}.enabled`),
    priority: integerOf(form.priority, `${label}.priority`),
    systemType: systemTypeOf(form.systemType, `${label}.systemType`)!,
    version: integerOf(form.version, `${label}.version`),
  }
}

function createPayloadOf (value: unknown, label = '规则创建草稿'): PlatformRuleManagementCreatePayload {
  return formFieldsOf(value, label)
}

function updatePayloadOf (value: unknown, label = '规则更新草稿'): PlatformRuleManagementUpdatePayload {
  const form = objectOf(value, label)
  return {
    id: idOf(form.id, `${label}.id`),
    ...formFieldsOf(form, label),
  }
}

function validationResultOf (value: unknown): PlatformRuleValidationResult {
  const result = objectOf(value, '规则语法校验响应')
  if (typeof result.valid !== 'boolean') throw new Error('规则语法校验响应缺少valid布尔值')
  const errors = result.errors === undefined || result.errors === null
    ? null
    : Array.isArray(result.errors)
      ? result.errors.map((item, index) => {
          if (typeof item !== 'string') throw new Error(`规则语法校验响应.errors[${index}]必须为字符串`)
          return item
        })
      : (() => { throw new Error('规则语法校验响应.errors必须为字符串数组或null') })()
  return {
    ...result,
    valid: result.valid,
    message: nullableTextOf(result.message, '规则语法校验响应.message'),
    errors,
  }
}

export function createPlatformRuleManagementCapability (request: PortalRequest) {
  return {
    async list (input: PlatformRuleManagementQuery = {}): Promise<PageResult<PlatformRuleManagementRecord>> {
      return pageOf(await request({ url: `${ROOT}/listByPage`, method: 'get', params: queryOf(input) }))
    },

    async get (input: { id: PlatformRuleManagementId }): Promise<PlatformRuleManagementRecord> {
      const id = idOf(input?.id, '规则ID')
      return recordOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '规则详情', true)
    },

    async validate (input: { expression: string }): Promise<PlatformRuleValidationResult> {
      const expression = requiredTextOf(input?.expression, '规则表达式')
      return validationResultOf(await request({ url: `${ROOT}/validate`, method: 'post', data: { expression } }))
    },

    prepareCreate (input: PlatformRuleManagementForm): { draft: PlatformRuleManagementCreatePayload } {
      return { draft: createPayloadOf(input, '规则创建表单') }
    },

    async create (input: { draft: PlatformRuleManagementCreatePayload }): Promise<void> {
      await request({ url: `${ROOT}/create`, method: 'post', data: createPayloadOf(input?.draft) })
    },

    prepareUpdate (input: PlatformRuleManagementForm): { draft: PlatformRuleManagementUpdatePayload } {
      return { draft: updatePayloadOf(input, '规则编辑表单') }
    },

    async update (input: { draft: PlatformRuleManagementUpdatePayload }): Promise<void> {
      await request({ url: `${ROOT}/update`, method: 'put', data: updatePayloadOf(input?.draft) })
    },
  }
}

export type PlatformRuleManagementCapability = ReturnType<typeof createPlatformRuleManagementCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, description, ...(options ? { options } : {}) })
const systemOptions = PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS.map(item => ({ label: item.label, value: item.value }))
const listParams: ParamSpec[] = [
  p('ruleCode', 'text', false, '规则编码模糊筛选；空值不发给后端'),
  p('ruleName', 'text', false, '规则名称模糊筛选；空值不发给后端'),
  p('ruleType', 'text', false, '规则类型精确筛选；页面字典 sales_rule_type 的 value'),
  p('ruleGroup', 'text', false, '规则分组精确筛选；页面字典 sales_rule_group 的 value'),
  p('enabled', 'boolean', false, '状态筛选；true=启用、false=停用，省略时后端默认只查启用'),
  p('systemType', 'enum', false, '系统类型；候选来自页面本地 SYSTEM_OPTIONS_ALL', systemOptions),
  p('pageNo', 'number', false, '页码，默认1'),
  p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20'),
]
const formParam = p('form', 'text', true, '规则表单对象；规则编码、名称、表达式、类型、分组、启用状态、优先级、系统类型和版本必填，描述可空')
const draftParam = p('draft', 'text', true, 'prepareCreate/prepareUpdate返回的完整草稿；取消时丢弃，不调用写接口')

export const PLATFORM_RULE_MANAGEMENT_METHODS = {
  'platform-rule-management-list': 'list',
  'platform-rule-management-get': 'get',
  'platform-rule-management-validate': 'validate',
  'platform-rule-management-prepare-create': 'prepareCreate',
  'platform-rule-management-create': 'create',
  'platform-rule-management-prepare-update': 'prepareUpdate',
  'platform-rule-management-update': 'update',
} as const

export const platformRuleManagementCapabilities: CapabilityDefinition[] = [
  { id: 'platform-rule-management-list', title: '查询规则管理列表', write: false, params: listParams },
  { id: 'platform-rule-management-get', title: '读取规则详情', write: false, params: [p('id', 'text', true, '规则ID')] },
  { id: 'platform-rule-management-validate', title: '验证规则表达式', write: false, params: [p('expression', 'text', true, 'QLExpress规则表达式，去除首尾空白后不能为空')] },
  { id: 'platform-rule-management-prepare-create', title: '准备创建规则', write: false, params: [formParam] },
  { id: 'platform-rule-management-create', title: '创建规则', write: true, params: [draftParam] },
  { id: 'platform-rule-management-prepare-update', title: '准备编辑规则', write: false, params: [formParam] },
  { id: 'platform-rule-management-update', title: '编辑规则', write: true, params: [draftParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_RULE_MANAGEMENT_PAGE_PATH,
  permission: PLATFORM_RULE_MANAGEMENT_PERMISSION,
  moduleType: PLATFORM_RULE_MANAGEMENT_MODULE_TYPE,
  httpInstance: 'platform',
}))
