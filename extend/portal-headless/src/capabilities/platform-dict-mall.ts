import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  createSettingDictPlatformCapability,
  type SettingDictDataCreateInput,
  type SettingDictDataGetInput,
  type SettingDictDataQuery,
  type SettingDictDataRow,
  type SettingDictPlatformId,
  type SettingDictPlatformStatus,
  type SettingDictTypeRow,
} from './setting-dict-platform.js'

/** Portal「平台设置 → 平台字典 → 字典管理」及其字典数据子页。 */
export const PLATFORM_DICT_MALL_PAGE_PATH = '/dashboard/platform/setting/dict-mall/all/list'
export const PLATFORM_DICT_MALL_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/all'
/** 该页面使用 platform 实例，但不发送 module-type。 */
export const PLATFORM_DICT_MALL_MODULE_TYPE = null
export const PLATFORM_DICT_MALL_COMMON_PAGE_PATH = '/dashboard/platform/setting/dict-mall/common/list'
export const PLATFORM_DICT_MALL_COMMON_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/common'
export const PLATFORM_DICT_MALL_COMMON_SYSTEM = 0
export const PLATFORM_DICT_MALL_FINANCE_PAGE_PATH = '/dashboard/platform/setting/dict-mall/finance/list'
export const PLATFORM_DICT_MALL_FINANCE_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/finance'
export const PLATFORM_DICT_MALL_FINANCE_SYSTEM = 2
export const PLATFORM_DICT_MALL_HR_PAGE_PATH = '/dashboard/platform/setting/dict-mall/hr/list'
export const PLATFORM_DICT_MALL_HR_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/hr'
export const PLATFORM_DICT_MALL_HR_SYSTEM = 1
export const PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH = '/dashboard/platform/setting/dict-mall/material/list'
export const PLATFORM_DICT_MALL_MATERIAL_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/material'
export const PLATFORM_DICT_MALL_MATERIAL_SYSTEM = 3
export const PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH = '/dashboard/platform/setting/dict-mall/product/list'
export const PLATFORM_DICT_MALL_PRODUCT_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/product'
export const PLATFORM_DICT_MALL_PRODUCT_SYSTEM = 4
export const PLATFORM_DICT_MALL_SALE_PAGE_PATH = '/dashboard/platform/setting/dict-mall/sale/list'
export const PLATFORM_DICT_MALL_SALE_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/sale'
export const PLATFORM_DICT_MALL_SALE_SYSTEM = 6
export const PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH = '/dashboard/platform/setting/dict-mall/supply/list'
export const PLATFORM_DICT_MALL_SUPPLY_PERMISSION = '/dashboard/platform-v2/setting/dict-mall/supply'
export const PLATFORM_DICT_MALL_SUPPLY_SYSTEM = 5

const TYPE_ROOT = '/adminmanage-api/system/dict-type'
const DATA_ROOT = '/adminmanage-api/system/dict-data'
const SYSTEM_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10]

export type PlatformDictMallId = SettingDictPlatformId
export type PlatformDictMallStatus = SettingDictPlatformStatus
export type PlatformDictMallTypeRow = SettingDictTypeRow
export type PlatformDictMallDataRow = SettingDictDataRow

export type PlatformDictMallTypeQuery = {
  name?: string | null
  type?: string | null
  useSystem?: number | null
  tenantEditable?: PlatformDictMallStatus | null
  pageNo?: number
  pageSize?: number
}

export type PlatformDictMallTypeCreateInput = {
  name: string
  type: string
  useSystem?: number | null
  tenantEditable?: PlatformDictMallStatus | null
  remark?: string | null
  status?: PlatformDictMallStatus
}

export type PlatformDictMallTypeUpdateInput = Record<string, unknown> & PlatformDictMallTypeCreateInput & {
  id: PlatformDictMallId
}

export type PlatformDictMallDataUpdateInput = Record<string, unknown> & SettingDictDataCreateInput & {
  id: PlatformDictMallId
}

export type PlatformDictMallDataRemoveInput = SettingDictDataGetInput & {
  /** 页面不会预先屏蔽平台行；该字段仅用于让调用方携带原始行信息。 */
  platform?: boolean | null
}

export type PlatformDictMallDataRemoveBatchInput = {
  ids: Array<PlatformDictMallId>
}

type RequestConfig = Parameters<PortalRequest>[0]

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): PlatformDictMallId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数字符串或安全正整数`)
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

function statusOf (value: unknown, label: string, fallback = 0): PlatformDictMallStatus {
  const result = value ?? fallback
  if (result !== 0 && result !== 1) throw new Error(`${label}必须为0或1`)
  return result as PlatformDictMallStatus
}

function systemOf (value: unknown, label: string, fallback = 0): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || !SYSTEM_VALUES.includes(result as number)) throw new Error(`${label}必须是Portal支持的系统值`)
  return result as number
}

function nullableSystemOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return systemOf(value, label)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function typeRowOf (value: unknown, index: number): PlatformDictMallTypeRow {
  const row = objectOf(value, `字典类型列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `字典类型列表[${index}].id`),
    name: nullableTextOf(row.name, `字典类型列表[${index}].name`),
    type: nullableTextOf(row.type, `字典类型列表[${index}].type`),
    status: row.status === undefined || row.status === null ? null : statusOf(row.status, `字典类型列表[${index}].status`),
    remark: nullableTextOf(row.remark, `字典类型列表[${index}].remark`),
    createTime: dateOf(row.createTime, `字典类型列表[${index}].createTime`),
    useSystem: nullableIntegerOf(row.useSystem, `字典类型列表[${index}].useSystem`),
    tenantEditable: row.tenantEditable === undefined || row.tenantEditable === null ? null : statusOf(row.tenantEditable, `字典类型列表[${index}].tenantEditable`),
  }
}

function pageOf<T> (value: unknown, label: string, rowOf: (value: unknown, index: number) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效list或total`)
  return { list: page.list.map(rowOf), total: page.total as number }
}

function typeQueryOf (query: PlatformDictMallTypeQuery = {}, fixedUseSystem?: number): Record<string, unknown> {
  const value = query ?? {}
  const useSystem = fixedUseSystem === undefined
    ? value.useSystem === undefined || value.useSystem === null ? undefined : systemOf(value.useSystem, 'useSystem')
    : systemOf(fixedUseSystem, 'useSystem')
  return {
    order: '',
    orderField: '',
    ...(useSystem === undefined ? {} : { useSystem }),
    name: nullableTextOf(value.name, '字典名称') ?? '',
    type: nullableTextOf(value.type, '字典类型') ?? '',
    tenantEditable: value.tenantEditable === undefined || value.tenantEditable === null
      ? undefined
      : statusOf(value.tenantEditable, 'tenantEditable'),
    pageNo: pageNumberOf(value.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(value.pageSize, 20, 'pageSize'),
  }
}

function typeCreatePayloadOf (input: PlatformDictMallTypeCreateInput, fixedUseSystem?: number): Record<string, unknown> {
  const value = objectOf(input, '字典类型创建表单')
  const useSystem = fixedUseSystem === undefined
    ? systemOf(value.useSystem, 'useSystem')
    : systemOf(value.useSystem === undefined || value.useSystem === null ? fixedUseSystem : value.useSystem, 'useSystem')
  if (fixedUseSystem !== undefined && useSystem !== fixedUseSystem) throw new Error('当前平台字典页面不允许修改所属系统')
  return {
    useSystem,
    name: requiredTextOf(value.name, 'name'),
    type: requiredTextOf(value.type, 'type'),
    tenantEditable: statusOf(value.tenantEditable, 'tenantEditable'),
    remark: nullableTextOf(value.remark, 'remark') ?? '',
    status: statusOf(value.status, 'status'),
  }
}

function typeUpdatePayloadOf (input: PlatformDictMallTypeUpdateInput, fixedUseSystem?: number): Record<string, unknown> {
  const value = objectOf(input, '字典类型编辑表单')
  const useSystem = fixedUseSystem === undefined
    ? value.useSystem === undefined ? 0 : nullableSystemOf(value.useSystem, 'useSystem')
    : systemOf(value.useSystem === undefined || value.useSystem === null ? fixedUseSystem : value.useSystem, 'useSystem')
  if (fixedUseSystem !== undefined && useSystem !== fixedUseSystem) throw new Error('当前平台字典页面不允许修改所属系统')
  return {
    ...value,
    id: idOf(value.id, '字典类型ID'),
    useSystem,
    name: requiredTextOf(value.name, 'name'),
    type: requiredTextOf(value.type, 'type'),
    tenantEditable: statusOf(value.tenantEditable, 'tenantEditable'),
    remark: nullableTextOf(value.remark, 'remark') ?? '',
    status: statusOf(value.status, 'status'),
  }
}

function dataUpdatePayloadOf (input: PlatformDictMallDataUpdateInput): Record<string, unknown> {
  const value = objectOf(input, '字典数据编辑表单')
  return {
    ...value,
    id: idOf(value.id, '字典数据ID'),
    dictType: requiredTextOf(value.dictType, 'dictType'),
    label: requiredTextOf(value.label, 'label'),
    value: requiredTextOf(value.value, 'value'),
    sort: (() => {
      const result = value.sort ?? 0
      if (!Number.isSafeInteger(result) || (result as number) < 0) throw new Error('sort必须为非负整数')
      return result
    })(),
    status: statusOf(value.status, 'status'),
    remark: nullableTextOf(value.remark, 'remark') ?? '',
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function rewriteToAdminManage (config: RequestConfig): RequestConfig {
  if (typeof config.url !== 'string') return config
  if (config.url.startsWith('/admin-api/system/dict-')) {
    return { ...config, url: config.url.replace('/admin-api/system/dict-', '/adminmanage-api/system/dict-') }
  }
  return config
}

function routedRequest (request: PortalRequest): PortalRequest {
  return config => request(rewriteToAdminManage(config))
}

/** The injected request must be bound to the page path represented by the capability. */
export function createPlatformDictMallCapability (request: PortalRequest, options: { fixedUseSystem?: number } = {}) {
  const fixedUseSystem = options.fixedUseSystem
  const dataCapability = createSettingDictPlatformCapability(routedRequest(request))
  return {
    async typeList (query: PlatformDictMallTypeQuery = {}): Promise<PageResult<PlatformDictMallTypeRow>> {
      return pageOf(await request({ url: `${TYPE_ROOT}/page`, method: 'get', params: typeQueryOf(query, fixedUseSystem) }), '字典类型分页响应', typeRowOf)
    },

    async typeGet (input: { id: PlatformDictMallId }): Promise<PlatformDictMallTypeRow | null> {
      const result = await request({ url: `${TYPE_ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '字典类型ID') } })
      return result === null || result === undefined ? null : typeRowOf(result, 0)
    },

    async typeCreate (input: PlatformDictMallTypeCreateInput): Promise<PlatformDictMallId> {
      const result = await request({ url: `${TYPE_ROOT}/create`, method: 'post', data: typeCreatePayloadOf(input, fixedUseSystem) })
      return idOf(result, '字典类型新建ID')
    },

    async typeUpdate (input: PlatformDictMallTypeUpdateInput): Promise<true> {
      const result = await request({ url: `${TYPE_ROOT}/update`, method: 'put', data: typeUpdatePayloadOf(input, fixedUseSystem) })
      return trueResult(result, '更新字典类型')
    },

    async typeRemove (input: { id: PlatformDictMallId }): Promise<true> {
      const result = await request({ url: `${TYPE_ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '字典类型ID') } })
      return trueResult(result, '删除字典类型')
    },

    dataList: (query: SettingDictDataQuery) => dataCapability.dataList(query),
    dataGet: (input: SettingDictDataGetInput) => dataCapability.dataGet(input),
    dataCreate: (input: SettingDictDataCreateInput) => dataCapability.dataCreate(input),

    async dataUpdate (input: PlatformDictMallDataUpdateInput): Promise<true> {
      const result = await request({ url: `${DATA_ROOT}/update`, method: 'put', data: dataUpdatePayloadOf(input) })
      return trueResult(result, '更新字典数据')
    },

    async dataRemove (input: PlatformDictMallDataRemoveInput): Promise<true> {
      const result = await request({ url: `${DATA_ROOT}/delete`, method: 'delete', params: { id: idOf(input?.id, '字典数据ID') } })
      return trueResult(result, '删除字典数据')
    },

    async dataRemoveBatch (input: PlatformDictMallDataRemoveBatchInput): Promise<true> {
      const value = objectOf(input, '字典数据批量删除参数')
      if (!Array.isArray(value.ids) || value.ids.length === 0) throw new Error('ids不能为空数组')
      const ids = value.ids.map((id, index) => idOf(id, `ids[${index}]`))
      const result = await request({ url: `${DATA_ROOT}/delete`, method: 'delete', params: { ids } })
      return trueResult(result, '批量删除字典数据')
    },
  }
}

export type PlatformDictMallCapability = ReturnType<typeof createPlatformDictMallCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PLATFORM_DICT_MALL_METHODS = {
  'platform-dict-mall-type-list': 'typeList',
  'platform-dict-mall-type-get': 'typeGet',
  'platform-dict-mall-type-create': 'typeCreate',
  'platform-dict-mall-type-update': 'typeUpdate',
  'platform-dict-mall-type-remove': 'typeRemove',
  'platform-dict-mall-data-list': 'dataList',
  'platform-dict-mall-data-get': 'dataGet',
  'platform-dict-mall-data-create': 'dataCreate',
  'platform-dict-mall-data-update': 'dataUpdate',
  'platform-dict-mall-data-remove': 'dataRemove',
  'platform-dict-mall-data-remove-batch': 'dataRemoveBatch',
} as const

export const platformDictMallCapabilities: CapabilityDefinition[] = [
  { id: 'platform-dict-mall-type-list', title: '查询平台字典类型', write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('useSystem', 'number', false, '系统值筛选；根页可筛选全部系统'), p('tenantEditable', 'number', false, '是否支持租户自定义：0否、1是'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'platform-dict-mall-type-get', title: '读取平台字典类型详情', write: false, params: [p('id', 'text', true, '字典类型主键')] },
  { id: 'platform-dict-mall-type-create', title: '创建平台字典类型', write: true, params: [p('name', 'text', true, '字典名称'), p('type', 'text', true, '字典类型代码'), p('useSystem', 'number', false, '系统值，默认公共0'), p('tenantEditable', 'number', false, '是否支持租户自定义：0否、1是，默认0'), p('remark', 'text', false, '备注'), p('status', 'number', false, '状态：0开启、1关闭，默认0')] },
  { id: 'platform-dict-mall-type-update', title: '修改平台字典类型', write: true, params: [p('id', 'text', true, '字典类型主键'), p('name', 'text', true, '字典名称'), p('type', 'text', true, '字典类型代码'), p('useSystem', 'number', false, '系统值，默认公共0'), p('tenantEditable', 'number', false, '是否支持租户自定义：0否、1是'), p('remark', 'text', false, '备注'), p('status', 'number', false, '状态：0开启、1关闭')] },
  { id: 'platform-dict-mall-type-remove', title: '删除平台字典类型', write: true, params: [p('id', 'text', true, '字典类型主键；存在字典数据时后端会拒绝')] },
  { id: 'platform-dict-mall-data-list', title: '查询平台字典数据', write: false, params: [p('dictType', 'text', true, '从类型列表的type或当前子页路由获得'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'platform-dict-mall-data-get', title: '读取平台字典数据详情', write: false, params: [p('id', 'text', true, '字典数据主键')] },
  { id: 'platform-dict-mall-data-create', title: '创建平台字典数据', write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
  { id: 'platform-dict-mall-data-update', title: '修改平台字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
  { id: 'platform-dict-mall-data-remove', title: '删除平台字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '原始列表行的平台共享标记；页面不提前拦截，最终由后端归属校验裁决')] },
  { id: 'platform-dict-mall-data-remove-batch', title: '批量删除平台字典数据', write: true, params: [p('ids', 'text', true, '要删除的字典数据主键数组；Portal 会按 ids 参数发送')] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_DICT_MALL_PAGE_PATH,
  permission: PLATFORM_DICT_MALL_PERMISSION,
  httpInstance: 'platform',
  moduleType: PLATFORM_DICT_MALL_MODULE_TYPE,
}))

const scopedIdOf = (id: string, scope: string): string => id.replace('platform-dict-mall-', `platform-dict-mall-${scope}-`)

function scopedCapabilities (scope: string, title: string, pagePath: string, permission: string): CapabilityDefinition[] {
  return platformDictMallCapabilities.map(definition => ({
    ...definition,
    id: scopedIdOf(definition.id, scope),
    title: definition.title.replace('平台字典', `${title}字典`),
    pagePath,
    permission,
    params: definition.params.filter(param => param.name !== 'useSystem'),
  }))
}

function scopedMethods (scope: string): Record<string, keyof PlatformDictMallCapability> {
  return Object.fromEntries(
    Object.entries(PLATFORM_DICT_MALL_METHODS).map(([id, method]) => [scopedIdOf(id, scope), method]),
  ) as Record<string, keyof PlatformDictMallCapability>
}

export const PLATFORM_DICT_MALL_COMMON_METHODS = scopedMethods('common')

export const platformDictMallCommonCapabilities = scopedCapabilities(
  'common',
  '公共',
  PLATFORM_DICT_MALL_COMMON_PAGE_PATH,
  PLATFORM_DICT_MALL_COMMON_PERMISSION,
)

export const PLATFORM_DICT_MALL_FINANCE_METHODS = scopedMethods('finance')

export const platformDictMallFinanceCapabilities = scopedCapabilities(
  'finance',
  '财务',
  PLATFORM_DICT_MALL_FINANCE_PAGE_PATH,
  PLATFORM_DICT_MALL_FINANCE_PERMISSION,
)

export const PLATFORM_DICT_MALL_HR_METHODS = scopedMethods('hr')

export const platformDictMallHrCapabilities = scopedCapabilities(
  'hr',
  '人力',
  PLATFORM_DICT_MALL_HR_PAGE_PATH,
  PLATFORM_DICT_MALL_HR_PERMISSION,
)

export const PLATFORM_DICT_MALL_MATERIAL_METHODS = scopedMethods('material')

export const platformDictMallMaterialCapabilities = scopedCapabilities(
  'material',
  '资产',
  PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH,
  PLATFORM_DICT_MALL_MATERIAL_PERMISSION,
)

export const PLATFORM_DICT_MALL_PRODUCT_METHODS = scopedMethods('product')

export const platformDictMallProductCapabilities = scopedCapabilities(
  'product',
  '生产',
  PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH,
  PLATFORM_DICT_MALL_PRODUCT_PERMISSION,
)

export const PLATFORM_DICT_MALL_SALE_METHODS = scopedMethods('sale')

export const platformDictMallSaleCapabilities = scopedCapabilities(
  'sale',
  '销售',
  PLATFORM_DICT_MALL_SALE_PAGE_PATH,
  PLATFORM_DICT_MALL_SALE_PERMISSION,
)

export const PLATFORM_DICT_MALL_SUPPLY_METHODS = scopedMethods('supply')

export const platformDictMallSupplyCapabilities = scopedCapabilities(
  'supply',
  '采购',
  PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH,
  PLATFORM_DICT_MALL_SUPPLY_PERMISSION,
)
