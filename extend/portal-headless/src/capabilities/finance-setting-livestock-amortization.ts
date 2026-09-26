import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 种畜摊销设置」；静态锚点取固定的Portal/Java检出。 */
export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH = '/dashboard/finance/setting/livestock-amortization/list'
export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PERMISSION = '/dashboard/finance/setting/livestock-amortization'
export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_MODULE_TYPE = null

const ROOT = '/admin-api/finance/biological-asset-depreciation-config'

export type FinanceSettingLivestockAmortizationId = string | number
export type FinanceSettingLivestockAmortizationStatus = 0 | 1
export type FinanceSettingLivestockAmortizationDecimal = number | string | null
export type FinanceSettingLivestockAmortizationScalar = string | number | null

export type FinanceSettingLivestockAmortizationQuery = {
  order?: string
  orderField?: string
  status?: FinanceSettingLivestockAmortizationStatus
  generations?: string[] | null
  breeds?: string[] | null
  lines?: string[] | null
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingLivestockAmortizationRow = {
  id: FinanceSettingLivestockAmortizationId
  generation: string | null
  breed: string | null
  line: string | null
  depreciationMethod: number | string | null
  accrualAgeDays: number | string | null
  accrualAgeCoefficient: FinanceSettingLivestockAmortizationDecimal
  accrualMaxDays: number | string | null
  netSalvageRate: FinanceSettingLivestockAmortizationDecimal
  accrualRatio: FinanceSettingLivestockAmortizationDecimal
  status: FinanceSettingLivestockAmortizationStatus
  flockStatus: number | string | null
  createTime: string | number | null
  updateTime: string | number | null
  tenantName: string | null
}

/**
 * Portal新建表单的字段。页面编辑路由虽然会先GET详情，但customSubmit仍固定POST /create；
 * 因此这里的create草稿只复刻页面可见字段，并保留调用方显式传入的id以便记录该源码行为。
 */
export type FinanceSettingLivestockAmortizationCreateInput = {
  id?: FinanceSettingLivestockAmortizationId
  generation: string
  breed: string
  line?: string | null
  depreciationMethod?: FinanceSettingLivestockAmortizationScalar
  accrualAgeDays: string | number | null
  accrualAgeCoefficient: string | number | null
  accrualMaxDays: string | number | null
  netSalvageRate: string | number | null
  accrualRatio?: FinanceSettingLivestockAmortizationScalar
  flockStatus?: FinanceSettingLivestockAmortizationScalar
}

export type FinanceSettingLivestockAmortizationDraft = {
  id?: FinanceSettingLivestockAmortizationId
  generation: string
  breed: string
  line: string | null
  depreciationMethod: FinanceSettingLivestockAmortizationScalar
  accrualAgeDays: number | null
  accrualAgeCoefficient: number | null
  accrualMaxDays: number | null
  netSalvageRate: number | null
  accrualRatio?: FinanceSettingLivestockAmortizationScalar
  flockStatus: FinanceSettingLivestockAmortizationScalar
}

export type FinanceSettingLivestockAmortizationPreparedStatus = {
  draft: { id: FinanceSettingLivestockAmortizationId; status: FinanceSettingLivestockAmortizationStatus }
  previous: { id: FinanceSettingLivestockAmortizationId; status: FinanceSettingLivestockAmortizationStatus }
}

export type FinanceSettingLivestockAmortizationStatusInput = {
  current: Pick<FinanceSettingLivestockAmortizationRow, 'id' | 'status'>
  targetStatus: FinanceSettingLivestockAmortizationStatus
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingLivestockAmortizationId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingLivestockAmortizationId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须为${allowEmpty ? '字符串' : '非空字符串'}`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label, true)
}

function nullableScalarOf (value: unknown, label: string): FinanceSettingLivestockAmortizationScalar {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingLivestockAmortizationStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function integerOrStringOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
    return value
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  throw new Error(`${label}必须为整数、整数字符串或null`)
}

function decimalOf (value: unknown, label: string): FinanceSettingLivestockAmortizationDecimal {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return value
  throw new Error(`${label}必须为有限数字、十进制字符串或null`)
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function textListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是字符串数组`)
  return value.map((item, index) => textOf(item, `${label}[${index}]`))
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function queryTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  return textOf(value, label, true)
}

function queryOf (query: FinanceSettingLivestockAmortizationQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  return {
    order: queryTextOf(source.order, 'order'),
    orderField: queryTextOf(source.orderField, 'orderField'),
    status: statusOf(source.status ?? 1),
    generations: textListOf(source.generations, 'generations'),
    breeds: textListOf(source.breeds, 'breeds'),
    lines: textListOf(source.lines, 'lines'),
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label = '种畜摊销设置列表行'): FinanceSettingLivestockAmortizationRow {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    generation: nullableTextOf(row.generation, `${label}.generation`),
    breed: nullableTextOf(row.breed, `${label}.breed`),
    line: nullableTextOf(row.line, `${label}.line`),
    depreciationMethod: integerOrStringOf(row.depreciationMethod, `${label}.depreciationMethod`),
    accrualAgeDays: integerOrStringOf(row.accrualAgeDays, `${label}.accrualAgeDays`),
    accrualAgeCoefficient: decimalOf(row.accrualAgeCoefficient, `${label}.accrualAgeCoefficient`),
    accrualMaxDays: integerOrStringOf(row.accrualMaxDays, `${label}.accrualMaxDays`),
    netSalvageRate: decimalOf(row.netSalvageRate, `${label}.netSalvageRate`),
    accrualRatio: decimalOf(row.accrualRatio, `${label}.accrualRatio`),
    status: statusOf(row.status, `${label}.status`),
    flockStatus: integerOrStringOf(row.flockStatus, `${label}.flockStatus`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
    tenantName: nullableTextOf(row.tenantName, `${label}.tenantName`),
  }
}

function pageOf (value: unknown): PageResult<FinanceSettingLivestockAmortizationRow> {
  const page = objectOf(value, '种畜摊销设置分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('种畜摊销设置分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `种畜摊销设置分页响应.list[${index}]`)), total: Number(page.total) }
}

function requiredNumericInputOf (value: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') throw new Error(`${label}为必填项`)
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为数字或数字字符串`)
  if (typeof value === 'string' && value.trim() === '') throw new Error(`${label}为必填项`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label}必须为有限数字`)
  if (options.integer && !Number.isInteger(number)) throw new Error(`${label}必须为整数`)
  if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
  if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
  // 与Portal customSubmit保持一致：truthy输入才执行一元+，数字0会被转成null，字符串"0"会转成0。
  return value ? number : null
}

function nullableNumericInputOf (value: unknown, label: string): FinanceSettingLivestockAmortizationScalar {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串、数字或null`)
  if (typeof value === 'string' && value.trim() === '') return value
  if (!Number.isFinite(Number(value))) throw new Error(`${label}必须为有限数字或null`)
  return value
}

function payloadOf (value: unknown): FinanceSettingLivestockAmortizationDraft {
  const input = objectOf(value, '创建种畜摊销设置输入')
  const id = nullableIdOf(input.id, '创建种畜摊销设置输入.id')
  const generation = textOf(input.generation, 'generation')
  if (generation.length > 100) throw new Error('generation长度不能超过100个字符')
  const breed = textOf(input.breed, 'breed')
  if (breed.length > 100) throw new Error('breed长度不能超过100个字符')
  const line = nullableTextOf(input.line, 'line')
  if (line !== null && line.length > 100) throw new Error('line长度不能超过100个字符')
  const depreciationMethod = nullableScalarOf(input.depreciationMethod === undefined ? '1' : input.depreciationMethod, 'depreciationMethod')
  const flockStatus = nullableScalarOf(input.flockStatus, 'flockStatus')
  const payload: FinanceSettingLivestockAmortizationDraft = {
    ...(id === null ? {} : { id }),
    generation,
    breed,
    line,
    depreciationMethod,
    accrualAgeDays: requiredNumericInputOf(input.accrualAgeDays, 'accrualAgeDays', { integer: true, min: 0 }),
    accrualAgeCoefficient: requiredNumericInputOf(input.accrualAgeCoefficient, 'accrualAgeCoefficient'),
    accrualMaxDays: requiredNumericInputOf(input.accrualMaxDays, 'accrualMaxDays', { integer: true, min: 0 }),
    netSalvageRate: requiredNumericInputOf(input.netSalvageRate, 'netSalvageRate', { min: 0, max: 1 }),
    flockStatus,
  }
  if (Object.prototype.hasOwnProperty.call(input, 'accrualRatio')) payload.accrualRatio = nullableNumericInputOf(input.accrualRatio, 'accrualRatio')
  return payload
}

function submittedDraftOf (value: unknown): FinanceSettingLivestockAmortizationDraft {
  const input = objectOf(value, '提交创建种畜摊销设置draft')
  const id = nullableIdOf(input.id, '提交创建种畜摊销设置draft.id')
  const generation = textOf(input.generation, '提交创建种畜摊销设置draft.generation')
  const breed = textOf(input.breed, '提交创建种畜摊销设置draft.breed')
  const line = nullableTextOf(input.line, '提交创建种畜摊销设置draft.line')
  const depreciationMethod = nullableScalarOf(input.depreciationMethod, '提交创建种畜摊销设置draft.depreciationMethod')
  const flockStatus = nullableScalarOf(input.flockStatus, '提交创建种畜摊销设置draft.flockStatus')
  const submittedNumberOf = (number: unknown, label: string, options: { integer?: boolean; min?: number; max?: number } = {}): number | null => {
    if (number === null) return null
    if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error(`${label}必须为有限数字或null`)
    if (options.integer && !Number.isInteger(number)) throw new Error(`${label}必须为整数`)
    if (options.min !== undefined && number < options.min) throw new Error(`${label}不能小于${options.min}`)
    if (options.max !== undefined && number > options.max) throw new Error(`${label}不能大于${options.max}`)
    return number
  }
  const draft: FinanceSettingLivestockAmortizationDraft = {
    ...(id === null ? {} : { id }),
    generation,
    breed,
    line,
    depreciationMethod,
    accrualAgeDays: submittedNumberOf(input.accrualAgeDays, '提交创建种畜摊销设置draft.accrualAgeDays', { integer: true, min: 0 }),
    accrualAgeCoefficient: submittedNumberOf(input.accrualAgeCoefficient, '提交创建种畜摊销设置draft.accrualAgeCoefficient'),
    accrualMaxDays: submittedNumberOf(input.accrualMaxDays, '提交创建种畜摊销设置draft.accrualMaxDays', { integer: true, min: 0 }),
    netSalvageRate: submittedNumberOf(input.netSalvageRate, '提交创建种畜摊销设置draft.netSalvageRate', { min: 0, max: 1 }),
    flockStatus,
  }
  if (Object.prototype.hasOwnProperty.call(input, 'accrualRatio')) draft.accrualRatio = nullableNumericInputOf(input.accrualRatio, '提交创建种畜摊销设置draft.accrualRatio')
  return draft
}

function statusDraftOf (value: unknown, label: string): { id: FinanceSettingLivestockAmortizationId; status: FinanceSettingLivestockAmortizationStatus } {
  const draft = objectOf(value, label)
  return { id: idOf(draft.id, `${label}.id`), status: statusOf(draft.status, `${label}.status`) }
}

function detailOf (value: unknown): FinanceSettingLivestockAmortizationRow | null {
  if (value === undefined || value === null) return null
  return rowOf(value, '种畜摊销设置详情')
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

export function calculateFinanceSettingLivestockAmortizationCoefficient (input: { netSalvageRate: string | number | null | undefined; accrualMaxDays: string | number | null | undefined }): number | null {
  if (input?.netSalvageRate === null || input?.netSalvageRate === undefined || input?.accrualMaxDays === null || input?.accrualMaxDays === undefined) return null
  const netSalvageRate = Number(input.netSalvageRate)
  const accrualMaxDays = Number(input.accrualMaxDays)
  if (!Number.isFinite(netSalvageRate) || !Number.isFinite(accrualMaxDays) || accrualMaxDays <= 0) return null
  const coefficient = (1 - netSalvageRate) / accrualMaxDays
  return coefficient > 0 ? coefficient : null
}

export function createFinanceSettingLivestockAmortizationCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingLivestockAmortizationQuery = {}): Promise<PageResult<FinanceSettingLivestockAmortizationRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'post', data: queryOf(query) }))
    },

    async get (input: { id: FinanceSettingLivestockAmortizationId }): Promise<FinanceSettingLivestockAmortizationRow | null> {
      const id = idOf(input?.id, '种畜摊销设置id')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }))
    },

    prepareCreate (input: FinanceSettingLivestockAmortizationCreateInput): { draft: FinanceSettingLivestockAmortizationDraft } {
      return { draft: payloadOf(input) }
    },

    async create (input: { draft: FinanceSettingLivestockAmortizationDraft }): Promise<FinanceSettingLivestockAmortizationId> {
      const draft = submittedDraftOf(input?.draft)
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: draft }), '创建种畜摊销设置返回的id')
    },

    prepareSetStatus (input: FinanceSettingLivestockAmortizationStatusInput): FinanceSettingLivestockAmortizationPreparedStatus {
      const current = statusDraftOf(input?.current, '启停种畜摊销设置当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { id: current.id, status: targetStatus }, previous: current }
    },

    async setStatus (input: { draft: { id: FinanceSettingLivestockAmortizationId; status: FinanceSettingLivestockAmortizationStatus } }): Promise<true> {
      const draft = statusDraftOf(input?.draft, '启停种畜摊销设置输入')
      // Portal源码把{ params: { id, status }}作为PUT第二参数，实际即为请求body；按源码保留该形状。
      return trueResult(await request({ url: `${ROOT}/update-status`, method: 'put', data: { params: draft } }), '启停种畜摊销设置')
    },

    calculateAccrualAgeCoefficient (input: { netSalvageRate: string | number | null | undefined; accrualMaxDays: string | number | null | undefined }): number | null {
      return calculateFinanceSettingLivestockAmortizationCoefficient(input)
    },
  }
}

export type FinanceSettingLivestockAmortizationCapability = ReturnType<typeof createFinanceSettingLivestockAmortizationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const listParams: ParamSpec[] = [
  p('order', 'text', false, '排序字段；当前页面没有排序控件，默认空字符串'),
  p('orderField', 'text', false, '排序方向；当前页面没有排序控件，默认空字符串'),
  { ...p('status', 'enum', false, '状态筛选：0停用、1启用；页面默认1'), options: statusOptions },
  p('generations', 'text', false, '代次多选值数组；默认空数组'),
  p('breeds', 'text', false, '品种多选值数组；默认空数组'),
  p('lines', 'text', false, '品系多选值数组；默认空数组'),
  p('pageNo', 'number', false, '页码；默认1'),
  p('pageSize', 'number', false, '每页条数；默认20，只支持10、20、50、100'),
]
const createParams: ParamSpec[] = [
  p('generation', 'text', true, '代次；页面必填，最多100个字符'),
  p('breed', 'text', true, '品种；页面必填，最多100个字符'),
  p('line', 'text', false, '品系；最多100个字符'),
  p('depreciationMethod', 'enum', false, '种摊计提方法；页面默认字符串1且控件禁用'),
  p('accrualAgeDays', 'number', true, '计提种摊日龄；页面必填，最小0，提交前按Portal规则转数字'),
  p('accrualAgeCoefficient', 'number', true, '计提种摊日龄系数；页面必填，提交前按Portal规则转数字'),
  p('accrualMaxDays', 'number', true, '种摊提取天数；页面必填、最小0、整数，提交前按Portal规则转数字'),
  p('netSalvageRate', 'number', true, '净残值率；页面必填、最小0且不能超过1，提交前按Portal规则转数字'),
  p('accrualRatio', 'number', false, '后端保存字段；当前创建表单不展示，只有调用方显式传入时才随Portal展开字段发送'),
  p('flockStatus', 'enum', false, '鸡群状态；页面未设必填规则，缺省发送null'),
  p('id', 'text', false, '编辑路由详情可能带出的主键；当前Portal仍POST /create，SDK仅保留显式传入值用于复刻请求'),
]

export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS = {
  'finance-setting-livestock-amortization-list': 'list',
  'finance-setting-livestock-amortization-get': 'get',
  'finance-setting-livestock-amortization-prepare-create': 'prepareCreate',
  'finance-setting-livestock-amortization-create': 'create',
  'finance-setting-livestock-amortization-prepare-set-status': 'prepareSetStatus',
  'finance-setting-livestock-amortization-set-status': 'setStatus',
  'finance-setting-livestock-amortization-calculate-coefficient': 'calculateAccrualAgeCoefficient',
} as const

export const financeSettingLivestockAmortizationCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-livestock-amortization-list', title: '查询种畜摊销设置', write: false, params: listParams },
  { id: 'finance-setting-livestock-amortization-get', title: '查询种畜摊销设置详情', write: false, params: [p('id', 'text', true, '种畜摊销设置主键')] },
  { id: 'finance-setting-livestock-amortization-prepare-create', title: '准备创建种畜摊销设置', write: false, params: createParams },
  { id: 'finance-setting-livestock-amortization-create', title: '创建种畜摊销设置', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的完整Portal创建草稿')] },
  { id: 'finance-setting-livestock-amortization-prepare-set-status', title: '准备启停种畜摊销设置', write: false, params: [p('current', 'text', true, '来自最新列表行的id与status'), { ...p('targetStatus', 'enum', true, '与current.status相反的绝对目标状态'), options: statusOptions }] },
  { id: 'finance-setting-livestock-amortization-set-status', title: '启停种畜摊销设置', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{id,status}草稿')] },
  { id: 'finance-setting-livestock-amortization-calculate-coefficient', title: '计算种畜摊销日龄系数', write: false, params: [p('netSalvageRate', 'number', false, '净残值率；缺省或非法时返回null'), p('accrualMaxDays', 'number', false, '种摊提取天数；必须大于0才计算')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PAGE_PATH,
  permission: FINANCE_SETTING_LIVESTOCK_AMORTIZATION_PERMISSION,
  moduleType: FINANCE_SETTING_LIVESTOCK_AMORTIZATION_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
