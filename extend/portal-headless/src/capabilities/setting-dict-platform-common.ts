import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 公共字典」及其可达的字典数据子页。 */
export const SETTING_DICT_PLATFORM_COMMON_PAGE_PATH = '/dashboard/setting/dict-platform/common/list'
export const SETTING_DICT_PLATFORM_COMMON_PERMISSION = '/dashboard/setting/dict-platform/common'
/** 该页面没有匹配到模块切分规则；浏览器不发送 module-type。 */
export const SETTING_DICT_PLATFORM_COMMON_MODULE_TYPE = null
/** 公共字典根列表由 wrapper 固定传 SYSTEM_COMMON_VALUE。 */
export const SETTING_DICT_PLATFORM_COMMON_SYSTEM = 0

const TYPE_ROOT = '/admin-api/system/dict-type'
const DATA_ROOT = '/admin-api/system/dict-data'

export type SettingDictPlatformCommonId = string | number
export type SettingDictPlatformCommonStatus = 0 | 1

export type SettingDictPlatformCommonTypeRow = Record<string, unknown> & {
  id: SettingDictPlatformCommonId
  name: string | null
  type: string | null
  status: SettingDictPlatformCommonStatus | null
  remark: string | null
  createTime: string | number | null
  useSystem: number | null
  tenantEditable: SettingDictPlatformCommonStatus | null
}

export type SettingDictPlatformCommonTypeQuery = {
  name?: string | null
  type?: string | null
  pageNo?: number
  pageSize?: number
}

export type SettingDictPlatformCommonDataRow = Record<string, unknown> & {
  id: SettingDictPlatformCommonId
  sort: number | null
  label: string | null
  value: string | null
  dictType: string | null
  status: SettingDictPlatformCommonStatus | null
  colorType: string | null
  cssClass: string | null
  remark: string | null
  createTime: string | number | null
  tenantId: SettingDictPlatformCommonId | null
  platform: boolean | null
}

export type SettingDictPlatformCommonDataQuery = {
  dictType: string
  label?: string | null
  status?: SettingDictPlatformCommonStatus | null
  pageNo?: number
  pageSize?: number
}

export type SettingDictPlatformCommonDataCreateInput = {
  dictType: string
  label: string
  value: string
  sort?: number
  status?: SettingDictPlatformCommonStatus
  remark?: string | null
}

export type SettingDictPlatformCommonDataUpdateInput = Record<string, unknown> & SettingDictPlatformCommonDataCreateInput & {
  id: SettingDictPlatformCommonId
  platform?: boolean | null
}

export type SettingDictPlatformCommonDataGetInput = { id: SettingDictPlatformCommonId }
export type SettingDictPlatformCommonDataRemoveInput = { id: SettingDictPlatformCommonId; platform?: boolean | null }

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): SettingDictPlatformCommonId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
}

function nonNegativeIdOf (value: unknown, label: string): SettingDictPlatformCommonId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) return value
  throw new Error(`${label}必须为非负整数字符串或安全非负整数`)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空或全为空格`)
  return value
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function nonNegativeIntegerOf (value: unknown, label: string): number {
  const result = value ?? 0
  if (!Number.isSafeInteger(result) || (result as number) < 0) throw new Error(`${label}必须为非负整数`)
  return result as number
}

function statusOf (value: unknown, label: string): SettingDictPlatformCommonStatus {
  const result = value ?? 0
  if (result !== 0 && result !== 1) throw new Error(`${label}必须为0或1`)
  return result as SettingDictPlatformCommonStatus
}

function nullableStatusOf (value: unknown, label: string): SettingDictPlatformCommonStatus | null {
  if (value === undefined || value === null) return null
  return statusOf(value, label)
}

function nullableBooleanOf (value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label}必须为布尔值或null`)
  return value
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function typeRowOf (value: unknown, index: number): SettingDictPlatformCommonTypeRow {
  const row = objectOf(value, `公共字典类型列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `公共字典类型列表[${index}].id`),
    name: nullableTextOf(row.name, `公共字典类型列表[${index}].name`),
    type: nullableTextOf(row.type, `公共字典类型列表[${index}].type`),
    status: nullableStatusOf(row.status, `公共字典类型列表[${index}].status`),
    remark: nullableTextOf(row.remark, `公共字典类型列表[${index}].remark`),
    createTime: dateOf(row.createTime, `公共字典类型列表[${index}].createTime`),
    useSystem: nullableIntegerOf(row.useSystem, `公共字典类型列表[${index}].useSystem`),
    tenantEditable: nullableStatusOf(row.tenantEditable, `公共字典类型列表[${index}].tenantEditable`),
  }
}

function dataRowOf (value: unknown, index: number): SettingDictPlatformCommonDataRow {
  const row = objectOf(value, `公共字典数据列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `公共字典数据列表[${index}].id`),
    sort: nullableIntegerOf(row.sort, `公共字典数据列表[${index}].sort`),
    label: nullableTextOf(row.label, `公共字典数据列表[${index}].label`),
    value: nullableTextOf(row.value, `公共字典数据列表[${index}].value`),
    dictType: nullableTextOf(row.dictType, `公共字典数据列表[${index}].dictType`),
    status: nullableStatusOf(row.status, `公共字典数据列表[${index}].status`),
    colorType: nullableTextOf(row.colorType, `公共字典数据列表[${index}].colorType`),
    cssClass: nullableTextOf(row.cssClass, `公共字典数据列表[${index}].cssClass`),
    remark: nullableTextOf(row.remark, `公共字典数据列表[${index}].remark`),
    createTime: dateOf(row.createTime, `公共字典数据列表[${index}].createTime`),
    tenantId: row.tenantId === undefined || row.tenantId === null
      ? null
      : nonNegativeIdOf(row.tenantId, `公共字典数据列表[${index}].tenantId`),
    platform: nullableBooleanOf(row.platform, `公共字典数据列表[${index}].platform`),
  }
}

function pageOf<T> (value: unknown, label: string, rowOf: (value: unknown, index: number) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) {
    throw new Error(`${label}缺少有效list或total`)
  }
  return { list: page.list.map(rowOf), total: page.total as number }
}

function typeQueryOf (query: SettingDictPlatformCommonTypeQuery = {}): Record<string, unknown> {
  const value = query ?? {}
  return {
    order: '',
    orderField: '',
    useSystem: SETTING_DICT_PLATFORM_COMMON_SYSTEM,
    name: nullableTextOf(value.name, '字典名称') ?? '',
    type: nullableTextOf(value.type, '字典类型') ?? '',
    pageNo: pageNumberOf(value.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize, 20, 'pageSize'),
  }
}

function dataQueryOf (query: SettingDictPlatformCommonDataQuery): Record<string, unknown> {
  const value = objectOf(query, '公共字典数据查询')
  return {
    order: '',
    orderField: '',
    dictType: requiredTextOf(value.dictType, 'dictType'),
    label: nullableTextOf(value.label, '字典标签') ?? '',
    status: value.status === undefined || value.status === null ? undefined : nullableStatusOf(value.status, 'status'),
    pageNo: pageNumberOf(value.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize, 20, 'pageSize'),
  }
}

function createDataPayloadOf (input: SettingDictPlatformCommonDataCreateInput): Record<string, unknown> {
  const value = objectOf(input, '公共字典数据创建表单')
  const dictType = requiredTextOf(value.dictType, 'dictType')
  return {
    id: '',
    dictTypeId: dictType,
    label: requiredTextOf(value.label, 'label'),
    value: requiredTextOf(value.value, 'value'),
    status: statusOf(value.status, 'status'),
    sort: nonNegativeIntegerOf(value.sort, 'sort'),
    remark: nullableTextOf(value.remark, 'remark') ?? '',
    dictType,
  }
}

function updateDataPayloadOf (input: SettingDictPlatformCommonDataUpdateInput): Record<string, unknown> {
  const value = objectOf(input, '公共字典数据编辑表单')
  if (value.platform === true) throw new Error('平台公共字典数据只读，Portal 不允许编辑')
  const dictType = requiredTextOf(value.dictType, 'dictType')
  return {
    ...value,
    id: idOf(value.id, '字典数据ID'),
    sort: nonNegativeIntegerOf(value.sort, 'sort'),
    label: requiredTextOf(value.label, 'label'),
    value: requiredTextOf(value.value, 'value'),
    status: statusOf(value.status, 'status'),
    remark: nullableTextOf(value.remark, 'remark') ?? '',
    dictType,
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function createdIdOf (value: unknown): SettingDictPlatformCommonId {
  return idOf(value, '公共字典数据新建ID')
}

/** The injected request must be bound to SETTING_DICT_PLATFORM_COMMON_PAGE_PATH. */
export function createSettingDictPlatformCommonCapability (request: PortalRequest) {
  return {
    async list (query: SettingDictPlatformCommonTypeQuery = {}): Promise<PageResult<SettingDictPlatformCommonTypeRow>> {
      return pageOf(await request({ url: `${TYPE_ROOT}/page`, method: 'get', params: typeQueryOf(query) }), '公共字典类型分页响应', typeRowOf)
    },

    async dataList (query: SettingDictPlatformCommonDataQuery): Promise<PageResult<SettingDictPlatformCommonDataRow>> {
      return pageOf(await request({ url: `${DATA_ROOT}/page`, method: 'get', params: dataQueryOf(query) }), '公共字典数据分页响应', dataRowOf)
    },

    async dataGet (input: SettingDictPlatformCommonDataGetInput): Promise<SettingDictPlatformCommonDataRow | null> {
      const result = await request({ url: `${DATA_ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '字典数据ID') } })
      return result === null || result === undefined ? null : dataRowOf(result, 0)
    },

    async dataCreate (input: SettingDictPlatformCommonDataCreateInput): Promise<SettingDictPlatformCommonId> {
      const result = await request({ url: `${DATA_ROOT}/create`, method: 'post', data: createDataPayloadOf(input) })
      return createdIdOf(result)
    },

    async dataUpdate (input: SettingDictPlatformCommonDataUpdateInput): Promise<true> {
      const result = await request({ url: `${DATA_ROOT}/update`, method: 'put', data: updateDataPayloadOf(input) })
      return trueResult(result, '更新公共字典数据')
    },

    async dataRemove (input: SettingDictPlatformCommonDataRemoveInput): Promise<true> {
      const value = objectOf(input, '公共字典数据删除参数')
      if (value.platform === true) throw new Error('平台公共字典数据只读，Portal 不允许删除')
      const result = await request({ url: `${DATA_ROOT}/delete`, method: 'delete', params: { id: idOf(value.id, '字典数据ID') } })
      return trueResult(result, '删除公共字典数据')
    },
  }
}

export type SettingDictPlatformCommonCapability = ReturnType<typeof createSettingDictPlatformCommonCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_DICT_PLATFORM_COMMON_METHODS = {
  'setting-dict-platform-common-type-list': 'list',
  'setting-dict-platform-common-data-list': 'dataList',
  'setting-dict-platform-common-data-get': 'dataGet',
  'setting-dict-platform-common-data-create': 'dataCreate',
  'setting-dict-platform-common-data-update': 'dataUpdate',
  'setting-dict-platform-common-data-remove': 'dataRemove',
} as const

export const settingDictPlatformCommonCapabilities: CapabilityDefinition[] = [
  { id: 'setting-dict-platform-common-type-list', title: '查询公共字典类型', write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-common-data-list', title: '查询公共字典数据', write: false, params: [p('dictType', 'text', true, '从公共字典类型列表的type获得'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-common-data-get', title: '读取公共字典数据详情', write: false, params: [p('id', 'text', true, '字典数据主键')] },
  { id: 'setting-dict-platform-common-data-create', title: '创建公共字典数据', write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-common-data-update', title: '修改公共字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-common-data-remove', title: '删除公共字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '来自列表行；true时Portal禁用删除')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_DICT_PLATFORM_COMMON_PAGE_PATH,
  permission: SETTING_DICT_PLATFORM_COMMON_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_DICT_PLATFORM_COMMON_MODULE_TYPE,
}))
