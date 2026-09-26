import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「平台设置 → 安全配置」；页面使用 platform.js。 */
export const PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH = '/dashboard/platform/system/security-config/list'
export const PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION = '/dashboard/platform-v2/system/security-config'
export const PLATFORM_SYSTEM_SECURITY_CONFIG_MODULE_TYPE = null

const ROOT = '/adminmanage-api/adminmanage/platform-config'

export const PLATFORM_SECURITY_CONFIG_GROUPS = [
  'identity_auth',
  'session_mgmt',
  'intrusion_prevention',
  'audit',
  'cryptography',
] as const

export const PLATFORM_SECURITY_CONFIG_VALUE_TYPES = [
  'BOOLEAN',
  'INTEGER',
  'STRING',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
] as const

export type PlatformSecurityConfigId = string | number
export type PlatformSecurityConfigValueType = typeof PLATFORM_SECURITY_CONFIG_VALUE_TYPES[number]

export type PlatformSecurityConfigRow = Record<string, unknown> & {
  id: PlatformSecurityConfigId
  configKey: string
  configName: string
  configGroup: string
  valueType: string
  configValue: string
  defaultValue: string | null
  optionsJson: string | null
  description: string | null
  isBuiltin: boolean
  sort: number | null
  remark: string | null
  updateTime: string | null
}

export type PlatformSecurityConfigGroups = Record<string, PlatformSecurityConfigRow[]>
export type PlatformSecurityConfigValue = { id: PlatformSecurityConfigId; configValue: string }

export type PlatformSecurityConfigCreateForm = {
  configKey: string
  configName: string
  configGroup: string
  valueType?: PlatformSecurityConfigValueType | string
  configValue?: string | null
  defaultValue?: string | null
  optionsJson?: string | null
  description?: string | null
  sort?: number | null
  remark?: string | null
}

export type PlatformSecurityConfigUpdateForm = {
  id: PlatformSecurityConfigId
  configKey: string
  configName: string
  configGroup: string
  description?: string | null
  sort?: number | null
  remark?: string | null
}

export type PlatformSecurityConfigDeleteRecord = {
  id: PlatformSecurityConfigId
  isBuiltin: boolean
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PlatformSecurityConfigId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数或十进制正整数字符串`)
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  return value
}

/** Portal 的新增/编辑按钮只做 truthy 校验；空白文本交给 Java @NotBlank 处理。 */
function portalRequiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}不能为空`)
  return value
}

function optionalTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string, fallback?: number): number {
  const actual = value === undefined || value === null ? fallback : value
  if (!Number.isSafeInteger(actual)) throw new Error(`${label}必须为整数`)
  return actual as number
}

function nullableIntegerWithDefaultOf (value: unknown, label: string, fallback: number): number | null {
  if (value === undefined) return fallback
  if (value === null) return null
  return integerOf(value, label)
}

function textWithDefaultOf (value: unknown, label: string, fallback: string | null): string | null {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function rowOf (value: unknown, index: number): PlatformSecurityConfigRow {
  const row = objectOf(value, `安全配置[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `安全配置[${index}].id`),
    configKey: requiredTextOf(row.configKey, `安全配置[${index}].configKey`),
    configName: requiredTextOf(row.configName, `安全配置[${index}].configName`),
    configGroup: requiredTextOf(row.configGroup, `安全配置[${index}].configGroup`),
    valueType: requiredTextOf(row.valueType, `安全配置[${index}].valueType`),
    configValue: optionalTextOf(row.configValue, `安全配置[${index}].configValue`),
    defaultValue: nullableTextOf(row.defaultValue, `安全配置[${index}].defaultValue`),
    optionsJson: nullableTextOf(row.optionsJson, `安全配置[${index}].optionsJson`),
    description: nullableTextOf(row.description, `安全配置[${index}].description`),
    isBuiltin: typeof row.isBuiltin === 'boolean' ? row.isBuiltin : Boolean(row.isBuiltin),
    sort: row.sort === undefined || row.sort === null ? null : integerOf(row.sort, `安全配置[${index}].sort`),
    remark: nullableTextOf(row.remark, `安全配置[${index}].remark`),
    updateTime: nullableTextOf(row.updateTime, `安全配置[${index}].updateTime`),
  }
}

function compareIds (left: PlatformSecurityConfigId, right: PlatformSecurityConfigId): number {
  // The Portal comparator is Number(prev.id || 0) - Number(next.id || 0).
  // Keep the original ID untouched, but preserve that ordering (including its
  // precision behaviour for values beyond Number.MAX_SAFE_INTEGER).
  return Number(left) - Number(right)
}

function normalizeGroups (value: unknown): PlatformSecurityConfigGroups {
  const source = objectOf(value ?? {}, '安全配置分组响应')
  return Object.fromEntries(PLATFORM_SECURITY_CONFIG_GROUPS.map(group => {
    const rows = source[group]
    if (rows === undefined || rows === null) return [group, []]
    if (!Array.isArray(rows)) throw new Error(`安全配置分组 ${group} 必须是数组`)
    return [group, rows.map((row, index) => rowOf(row, index)).sort((left, right) =>
      (left.sort ?? 0) - (right.sort ?? 0) || compareIds(left.id, right.id))]
  })) as PlatformSecurityConfigGroups
}

function valuePayloadOf (configs: PlatformSecurityConfigValue[]): Array<{ id: PlatformSecurityConfigId; configValue: string }> {
  if (!Array.isArray(configs)) throw new Error('安全配置值列表必须是数组')
  return configs.map((config, index) => {
    const row = objectOf(config, `安全配置值[${index}]`)
    return {
      id: idOf(row.id, `安全配置值[${index}].id`),
      configValue: optionalTextOf(row.configValue, `安全配置值[${index}].configValue`),
    }
  })
}

function createPayloadOf (input: PlatformSecurityConfigCreateForm): JsonObject {
  const form = objectOf(input, '安全配置创建表单')
  const configGroup = requiredTextOf(form.configGroup, '配置分组')
  const valueType = requiredTextOf(form.valueType ?? 'BOOLEAN', '值类型')
  if (!PLATFORM_SECURITY_CONFIG_GROUPS.includes(configGroup as typeof PLATFORM_SECURITY_CONFIG_GROUPS[number])) throw new Error('配置分组不是页面支持的选项')
  if (!PLATFORM_SECURITY_CONFIG_VALUE_TYPES.includes(valueType as PlatformSecurityConfigValueType)) throw new Error('值类型不是页面支持的选项')
  const defaults = {
    BOOLEAN: { configValue: 'false', defaultValue: 'false', optionsJson: null },
    INTEGER: { configValue: '0', defaultValue: '0', optionsJson: null },
    STRING: { configValue: '', defaultValue: '', optionsJson: null },
    SINGLE_CHOICE: { configValue: '', defaultValue: '', optionsJson: '[]' },
    MULTI_CHOICE: { configValue: '[]', defaultValue: '[]', optionsJson: '[]' },
  }[valueType as PlatformSecurityConfigValueType]
  return {
    configKey: portalRequiredTextOf(form.configKey, '配置键'),
    configName: portalRequiredTextOf(form.configName, '配置名称'),
    configGroup,
    valueType,
    configValue: textWithDefaultOf(form.configValue, '当前值', defaults.configValue),
    defaultValue: textWithDefaultOf(form.defaultValue, '默认值', defaults.defaultValue),
    optionsJson: textWithDefaultOf(form.optionsJson, '选项列表', defaults.optionsJson),
    description: textWithDefaultOf(form.description, '配置说明', ''),
    sort: nullableIntegerWithDefaultOf(form.sort, '排序', 99),
    remark: textWithDefaultOf(form.remark, '备注', ''),
  }
}

function metadataPayloadOf (input: PlatformSecurityConfigUpdateForm): JsonObject {
  const form = objectOf(input, '安全配置元数据表单')
  const configGroup = requiredTextOf(form.configGroup, '配置分组')
  if (!PLATFORM_SECURITY_CONFIG_GROUPS.includes(configGroup as typeof PLATFORM_SECURITY_CONFIG_GROUPS[number])) throw new Error('配置分组不是页面支持的选项')
  return {
    id: idOf(form.id, '安全配置ID'),
    configKey: portalRequiredTextOf(form.configKey, '配置键'),
    configName: portalRequiredTextOf(form.configName, '配置名称'),
    configGroup,
    description: textWithDefaultOf(form.description, '配置说明', ''),
    sort: nullableIntegerWithDefaultOf(form.sort, '排序', 99),
    remark: textWithDefaultOf(form.remark, '备注', ''),
  }
}

export function normalizePlatformSecurityConfigGroups (value: unknown): PlatformSecurityConfigGroups {
  return normalizeGroups(value)
}

export function buildPlatformSecurityConfigValuesPayload (configs: PlatformSecurityConfigValue[]): Array<{ id: PlatformSecurityConfigId; configValue: string }> {
  return valuePayloadOf(configs)
}

export function buildPlatformSecurityConfigCreatePayload (input: PlatformSecurityConfigCreateForm): JsonObject {
  return createPayloadOf(input)
}

export function buildPlatformSecurityConfigMetadataPayload (input: PlatformSecurityConfigUpdateForm): JsonObject {
  return metadataPayloadOf(input)
}

export function createPlatformSystemSecurityConfigCapability (request: PortalRequest) {
  return {
    async list (): Promise<PlatformSecurityConfigGroups> {
      return normalizeGroups(await request<unknown>({ url: `${ROOT}/list`, method: 'get' }))
    },

    prepareUpdateValues (configs: PlatformSecurityConfigValue[]): { payload: Array<{ id: PlatformSecurityConfigId; configValue: string }> } {
      return { payload: valuePayloadOf(configs) }
    },

    async updateValues (configs: PlatformSecurityConfigValue[]): Promise<boolean> {
      return await request<boolean>({ url: `${ROOT}/update-values`, method: 'put', data: valuePayloadOf(configs) })
    },

    prepareCreate (form: PlatformSecurityConfigCreateForm): { payload: JsonObject } {
      return { payload: createPayloadOf(form) }
    },

    async create (form: PlatformSecurityConfigCreateForm): Promise<PlatformSecurityConfigId | null> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: createPayloadOf(form) })
      return result === null || result === undefined ? null : idOf(result, '新建安全配置ID')
    },

    prepareUpdate (form: PlatformSecurityConfigUpdateForm): { payload: JsonObject } {
      return { payload: metadataPayloadOf(form) }
    },

    async update (form: PlatformSecurityConfigUpdateForm): Promise<boolean> {
      return await request<boolean>({ url: `${ROOT}/update`, method: 'put', data: metadataPayloadOf(form) })
    },

    prepareRemove (record: PlatformSecurityConfigDeleteRecord): { id: PlatformSecurityConfigId; isBuiltin: false } {
      const id = idOf(record?.id, '安全配置ID')
      if (record?.isBuiltin !== false) throw new Error('内置安全配置不能删除；必须从列表选择 isBuiltin=false 的自定义配置')
      return { id, isBuiltin: false }
    },

    async remove (record: PlatformSecurityConfigDeleteRecord): Promise<boolean> {
      const prepared = this.prepareRemove(record)
      return await request<boolean>({ url: `${ROOT}/delete`, method: 'delete', params: { id: prepared.id } })
    },
  }
}

export type PlatformSystemSecurityConfigCapability = ReturnType<typeof createPlatformSystemSecurityConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const valuesParam = p('configs', 'text', true, '当前分组全部配置值数组；每项为 { id, configValue }，保存会整组提交')
const formParam = p('form', 'text', true, '页面配置表单；创建/元数据编辑按 Portal 可见字段提交')
const recordParam = p('record', 'text', true, '当前列表行；必须携带 isBuiltin=false 才能准备删除')

export const PLATFORM_SYSTEM_SECURITY_CONFIG_METHODS = {
  'platform-system-security-config-list': 'list',
  'platform-system-security-config-prepare-update-values': 'prepareUpdateValues',
  'platform-system-security-config-update-values': 'updateValues',
  'platform-system-security-config-prepare-create': 'prepareCreate',
  'platform-system-security-config-create': 'create',
  'platform-system-security-config-prepare-update': 'prepareUpdate',
  'platform-system-security-config-update': 'update',
  'platform-system-security-config-prepare-remove': 'prepareRemove',
  'platform-system-security-config-remove': 'remove',
} as const

export const platformSystemSecurityConfigCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-security-config-list', title: '查询安全配置分组', write: false, params: [] },
  { id: 'platform-system-security-config-prepare-update-values', title: '准备整组保存安全配置值', write: false, params: [valuesParam] },
  { id: 'platform-system-security-config-update-values', title: '整组保存安全配置值', write: true, params: [valuesParam] },
  { id: 'platform-system-security-config-prepare-create', title: '准备新增自定义安全配置', write: false, params: [formParam] },
  { id: 'platform-system-security-config-create', title: '新增自定义安全配置', write: true, params: [formParam] },
  { id: 'platform-system-security-config-prepare-update', title: '准备编辑安全配置元数据', write: false, params: [formParam] },
  { id: 'platform-system-security-config-update', title: '编辑安全配置元数据', write: true, params: [formParam] },
  { id: 'platform-system-security-config-prepare-remove', title: '准备删除自定义安全配置', write: false, params: [recordParam] },
  { id: 'platform-system-security-config-remove', title: '删除自定义安全配置', write: true, params: [recordParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_SECURITY_CONFIG_PAGE_PATH,
  permission: PLATFORM_SYSTEM_SECURITY_CONFIG_PERMISSION,
  moduleType: PLATFORM_SYSTEM_SECURITY_CONFIG_MODULE_TYPE,
  httpInstance: 'platform',
}))
