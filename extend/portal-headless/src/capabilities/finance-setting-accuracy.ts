import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「财务设置 → 精度管理」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_ACCURACY_PAGE_PATH = '/dashboard/finance/setting/accuracy/list'
const ROOT = '/admin-api/finance/accuracy-manage'

export type FinanceSettingAccuracyId = string | number
export type FinanceSettingAccuracyStatus = 0 | 1

/** 列表页实际展示及行操作所需的字段。 */
export type FinanceSettingAccuracyRow = {
  id: FinanceSettingAccuracyId
  tenantName: string | null
  currencyType: number | null
  decimalQuantity: number | null
  decimalUnitPrice: number | null
  decimalAmount: number | null
  status: FinanceSettingAccuracyStatus
  isUsedByAccountSet: FinanceSettingAccuracyStatus | null
  createTime: string | number | null
}

/**
 * 编辑页 GET 后的表单快照。
 * accuracyName、accuracyDelimiter、decimalPlaces 是后端保留的历史字段：页面不展示，
 * 但 Portal 的 customLoad + {...form} 会在编辑提交时原样带回，故只在详情/更新快照中保留。
 */
export type FinanceSettingAccuracyDetail = FinanceSettingAccuracyRow & {
  accuracyName: string | null
  accuracyDelimiter: number | null
  decimalPlaces: number | null
}

export type FinanceSettingAccuracyCreateDraft = {
  currencyType: number
  decimalQuantity: number
  decimalUnitPrice: number
  decimalAmount: number
}

export type FinanceSettingAccuracyCreatePayload = FinanceSettingAccuracyCreateDraft & {
  status: 0
}

export type FinanceSettingAccuracyUpdateChanges = Partial<FinanceSettingAccuracyCreateDraft>

export type FinanceSettingAccuracySaveDraft = {
  id: FinanceSettingAccuracyId
  accuracyName?: string | null
  currencyType: number
  accuracyDelimiter?: number | null
  decimalPlaces?: number | null
  decimalQuantity: number
  decimalUnitPrice: number
  decimalAmount: number
  status: 0
  isUsedByAccountSet?: FinanceSettingAccuracyStatus | null
  createTime?: string | number | null
  tenantName?: string | null
}

export type FinanceSettingAccuracyUpdateInput = {
  /** 必须是get返回的完整详情或此前prepare结果；列表行缺少Portal编辑会原样回传的历史字段。 */
  current: FinanceSettingAccuracyDetail | FinanceSettingAccuracySaveDraft
  changes?: FinanceSettingAccuracyUpdateChanges | null
}

export type FinanceSettingAccuracyStatusInput = {
  id: FinanceSettingAccuracyId
  currentStatus: FinanceSettingAccuracyStatus
  status: FinanceSettingAccuracyStatus
}

export type FinanceSettingAccuracyRemoveInput = {
  id: FinanceSettingAccuracyId
  currentStatus: FinanceSettingAccuracyStatus
  isUsedByAccountSet: FinanceSettingAccuracyStatus | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function hasOwn (value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function idOf (value: unknown, label = 'id'): FinanceSettingAccuracyId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  }
  return value
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  return integerOf(value, label)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingAccuracyStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function nullableStatusOf (value: unknown, label: string): FinanceSettingAccuracyStatus | null {
  if (value === null || value === undefined) return null
  return statusOf(value, label)
}

function decimalOf (value: unknown, label: string, defaultZero = false): number {
  const resolved = defaultZero && (value === null || value === undefined) ? 0 : value
  const result = integerOf(resolved, label)
  if (result < 0 || result > 9) throw new Error(`${label}必须为0至9的整数`)
  return result
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数值或null`)
}

function pageOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function queryOf (query: FinanceSettingAccuracyQuery): { order: ''; orderField: ''; pageNo: number; pageSize: number } {
  const source = query ?? {}
  return {
    order: '',
    orderField: '',
    pageNo: pageOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageOf(source.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FinanceSettingAccuracyRow {
  const row = objectOf(value, '精度管理列表行')
  return {
    id: idOf(row.id, '精度管理id'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
    currencyType: nullableIntegerOf(row.currencyType, 'currencyType'),
    decimalQuantity: row.decimalQuantity == null ? null : decimalOf(row.decimalQuantity, 'decimalQuantity'),
    decimalUnitPrice: row.decimalUnitPrice == null ? null : decimalOf(row.decimalUnitPrice, 'decimalUnitPrice'),
    decimalAmount: row.decimalAmount == null ? null : decimalOf(row.decimalAmount, 'decimalAmount'),
    status: statusOf(row.status),
    isUsedByAccountSet: nullableStatusOf(row.isUsedByAccountSet, 'isUsedByAccountSet'),
    createTime: dateTimeOf(row.createTime, 'createTime'),
  }
}

function detailOf (value: unknown): FinanceSettingAccuracyDetail {
  const row = objectOf(value, '精度管理详情')
  return {
    id: idOf(row.id, '精度管理id'),
    accuracyName: nullableTextOf(row.accuracyName, 'accuracyName'),
    currencyType: nullableIntegerOf(row.currencyType, 'currencyType'),
    accuracyDelimiter: nullableIntegerOf(row.accuracyDelimiter, 'accuracyDelimiter'),
    decimalPlaces: nullableIntegerOf(row.decimalPlaces, 'decimalPlaces'),
    decimalQuantity: decimalOf(row.decimalQuantity, 'decimalQuantity', true),
    decimalUnitPrice: decimalOf(row.decimalUnitPrice, 'decimalUnitPrice', true),
    decimalAmount: decimalOf(row.decimalAmount, 'decimalAmount', true),
    status: statusOf(row.status),
    isUsedByAccountSet: nullableStatusOf(row.isUsedByAccountSet, 'isUsedByAccountSet'),
    createTime: dateTimeOf(row.createTime, 'createTime'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
  }
}

type CreateInput = FinanceSettingAccuracyCreateDraft | FinanceSettingAccuracyCreatePayload

function createDraftOf (input: CreateInput): FinanceSettingAccuracyCreateDraft {
  const value = objectOf(input, '创建精度管理输入')
  if (hasOwn(value, 'status') && value.status !== 0) throw new Error('创建精度管理status只能为0（启用）')
  return {
    currencyType: integerOf(value.currencyType, 'currencyType'),
    decimalQuantity: decimalOf(value.decimalQuantity, 'decimalQuantity'),
    decimalUnitPrice: decimalOf(value.decimalUnitPrice, 'decimalUnitPrice'),
    decimalAmount: decimalOf(value.decimalAmount, 'decimalAmount'),
  }
}

function createPayloadOf (input: CreateInput): FinanceSettingAccuracyCreatePayload {
  const draft = createDraftOf(input)
  return {
    currencyType: draft.currencyType,
    decimalQuantity: draft.decimalQuantity,
    decimalUnitPrice: draft.decimalUnitPrice,
    decimalAmount: draft.decimalAmount,
    status: 0,
  }
}

function saveDraftOf (input: FinanceSettingAccuracyUpdateInput['current']): FinanceSettingAccuracySaveDraft {
  const value = objectOf(input, '编辑精度管理当前值')
  const status = statusOf(value.status)
  if (status !== 0) throw new Error('当前status为停用，Portal页面禁止编辑；请刷新后再操作')
  const isUsedByAccountSet = nullableStatusOf(value.isUsedByAccountSet, 'isUsedByAccountSet')
  if (isUsedByAccountSet === 1) throw new Error('当前精度已被账套引用，Portal页面禁止编辑')

  const draft = { id: idOf(value.id, '精度管理id') } as Partial<FinanceSettingAccuracySaveDraft>
  if (hasOwn(value, 'accuracyName')) draft.accuracyName = nullableTextOf(value.accuracyName, 'accuracyName')
  draft.currencyType = integerOf(value.currencyType, 'currencyType')
  if (hasOwn(value, 'accuracyDelimiter')) draft.accuracyDelimiter = nullableIntegerOf(value.accuracyDelimiter, 'accuracyDelimiter')
  if (hasOwn(value, 'decimalPlaces')) draft.decimalPlaces = nullableIntegerOf(value.decimalPlaces, 'decimalPlaces')
  draft.decimalQuantity = decimalOf(value.decimalQuantity, 'decimalQuantity', true)
  draft.decimalUnitPrice = decimalOf(value.decimalUnitPrice, 'decimalUnitPrice', true)
  draft.decimalAmount = decimalOf(value.decimalAmount, 'decimalAmount', true)
  draft.status = 0
  if (hasOwn(value, 'isUsedByAccountSet')) draft.isUsedByAccountSet = isUsedByAccountSet
  if (hasOwn(value, 'createTime')) draft.createTime = dateTimeOf(value.createTime, 'createTime')
  if (hasOwn(value, 'tenantName')) draft.tenantName = nullableTextOf(value.tenantName, 'tenantName')
  return draft as FinanceSettingAccuracySaveDraft
}

function changesOf (input: FinanceSettingAccuracyUpdateChanges | null | undefined): FinanceSettingAccuracyUpdateChanges {
  if (input === null || input === undefined) return {}
  const value = objectOf(input, '精度管理编辑变更')
  const allowed = new Set(['currencyType', 'decimalQuantity', 'decimalUnitPrice', 'decimalAmount'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`精度管理编辑变更不支持字段${key}`)
  }
  const changes: FinanceSettingAccuracyUpdateChanges = {}
  if (hasOwn(value, 'currencyType')) changes.currencyType = integerOf(value.currencyType, 'currencyType')
  if (hasOwn(value, 'decimalQuantity')) changes.decimalQuantity = decimalOf(value.decimalQuantity, 'decimalQuantity')
  if (hasOwn(value, 'decimalUnitPrice')) changes.decimalUnitPrice = decimalOf(value.decimalUnitPrice, 'decimalUnitPrice')
  if (hasOwn(value, 'decimalAmount')) changes.decimalAmount = decimalOf(value.decimalAmount, 'decimalAmount')
  return changes
}

function updatePayloadOf (input: FinanceSettingAccuracyUpdateInput): {
  draft: FinanceSettingAccuracySaveDraft
  previous: FinanceSettingAccuracySaveDraft
} {
  const previous = saveDraftOf(input?.current)
  const changes = changesOf(input?.changes)
  return {
    previous,
    draft: { ...previous, ...changes },
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_ACCURACY_PAGE_PATH. */
export function createFinanceSettingAccuracyCapability (request: PortalRequest) {
  function prepareUpdate (input: FinanceSettingAccuracyUpdateInput) {
    return updatePayloadOf(input)
  }

  return {
    async list (query: FinanceSettingAccuracyQuery = {}): Promise<PageResult<FinanceSettingAccuracyRow>> {
      const result = await request<PageResult<unknown>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryOf(query),
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('精度管理分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (input: { id: FinanceSettingAccuracyId }): Promise<FinanceSettingAccuracyDetail | null> {
      const result = await request<unknown>({
        url: `${ROOT}/get`,
        method: 'get',
        params: { id: idOf(input?.id, '精度管理id') },
      })
      return result === null || result === undefined ? null : detailOf(result)
    },

    prepareCreate (input: CreateInput): { draft: FinanceSettingAccuracyCreatePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: CreateInput): Promise<FinanceSettingAccuracyId> {
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: createPayloadOf(input),
      })
      return idOf(result, '新建精度管理返回的id')
    },

    prepareUpdate,

    async update (input: FinanceSettingAccuracyUpdateInput): Promise<true> {
      const { draft } = updatePayloadOf(input)
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: draft,
      })
      return trueResult(result, '更新精度管理')
    },

    async setStatus (input: FinanceSettingAccuracyStatusInput): Promise<true> {
      const id = idOf(input?.id, '精度管理id')
      const currentStatus = statusOf(input?.currentStatus, 'currentStatus')
      const status = statusOf(input?.status)
      if (status === currentStatus) throw new Error('目标status必须与列表当前status相反')
      const result = await request<unknown>({
        url: `${ROOT}/enableOrStop`,
        method: 'put',
        data: { id, status },
      })
      return trueResult(result, '精度管理启停')
    },

    async remove (input: FinanceSettingAccuracyRemoveInput): Promise<true> {
      const id = idOf(input?.id, '精度管理id')
      const currentStatus = statusOf(input?.currentStatus, 'currentStatus')
      const isUsedByAccountSet = nullableStatusOf(input?.isUsedByAccountSet, 'isUsedByAccountSet')
      if (currentStatus !== 0) throw new Error('当前status为停用，Portal页面禁止删除；请刷新后再操作')
      if (isUsedByAccountSet === 1) throw new Error('当前精度已被账套引用，Portal页面禁止删除')
      const result = await request<unknown>({
        url: `${ROOT}/delete`,
        method: 'delete',
        params: { id },
      })
      return trueResult(result, '删除精度管理')
    },
  }
}

export type FinanceSettingAccuracyCapability = ReturnType<typeof createFinanceSettingAccuracyCapability>
export type FinanceSettingAccuracyCapabilityWithIdempotency = FinanceSettingAccuracyCapability & {
  createIdempotent: (input: FinanceSettingAccuracyCreateDraft & { requestId: string }) => Promise<FinanceSettingAccuracyId>
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const statusOptions = [{ label: '启用', value: 0 }, { label: '停用', value: 1 }]
const statusParam = (name: string, required = true): ParamSpec => ({
  name,
  kind: 'enum',
  required,
  description: '绝对状态：0启用，1停用',
  options: statusOptions,
})

const createParams: ParamSpec[] = [
  p('currencyType', 'number', true, '币种字典数值；来自页面币种选择器'),
  p('decimalQuantity', 'number', true, '数量小数位，0至9整数'),
  p('decimalUnitPrice', 'number', true, '单价小数位，0至9整数'),
  p('decimalAmount', 'number', true, '金额小数位，0至9整数'),
]

const updateParams: ParamSpec[] = [
  p('current', 'text', true, '来自最新精度详情或此前prepareUpdate结果的完整当前对象；不要直接传列表行'),
  p('changes', 'text', false, '只包含currencyType及三类小数位的编辑变更'),
]

export const FINANCE_SETTING_ACCURACY_METHODS = {
  'finance-setting-accuracy-list': 'list',
  'finance-setting-accuracy-get': 'get',
  'finance-setting-accuracy-prepare-create': 'prepareCreate',
  'finance-setting-accuracy-create': 'createIdempotent',
  'finance-setting-accuracy-prepare-update': 'prepareUpdate',
  'finance-setting-accuracy-update': 'update',
  'finance-setting-accuracy-set-status': 'setStatus',
  'finance-setting-accuracy-remove': 'remove',
} as const

export const financeSettingAccuracyCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-accuracy-list', title: '查询精度管理', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-setting-accuracy-get', title: '读取精度管理详情', write: false, params: [p('id', 'text', true, '精度管理主键ID')] },
  { id: 'finance-setting-accuracy-prepare-create', title: '准备创建精度管理', write: false, params: createParams },
  { id: 'finance-setting-accuracy-create', title: '创建精度管理', write: true, params: [...createParams, p('requestId', 'text', true, '同一创建意图重试复用的SDK防重键')] },
  { id: 'finance-setting-accuracy-prepare-update', title: '准备编辑精度管理', write: false, params: updateParams },
  { id: 'finance-setting-accuracy-update', title: '编辑精度管理', write: true, params: updateParams },
  { id: 'finance-setting-accuracy-set-status', title: '启用或停用精度管理', write: true, params: [p('id', 'text', true, '精度管理主键ID'), statusParam('currentStatus'), statusParam('status')] },
  { id: 'finance-setting-accuracy-remove', title: '删除精度管理', write: true, params: [p('id', 'text', true, '精度管理主键ID'), statusParam('currentStatus'), { ...statusParam('isUsedByAccountSet'), description: '列表行是否已被账套引用；1时页面隐藏删除按钮' }] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_ACCURACY_PAGE_PATH,
  permission: '/dashboard/finance/setting/accuracy',
  moduleType: null,
  httpInstance: 'platform',
}))

export type FinanceSettingAccuracyQuery = {
  pageNo?: number
  pageSize?: number
}
