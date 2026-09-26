import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 指标库-新」。 */
export const PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH = '/dashboard/product/setting/indicator-lib/list'
export const PRODUCT_SETTING_INDICATOR_LIB_PERMISSION = '/dashboard/frame/breeding-plan-new/indicator-lib'
export const PRODUCT_SETTING_INDICATOR_LIB_MODULE_TYPE = null

const ROOT = '/flockSimu/rearingPlan/indicator'
const MAX_DAY_AGE = 700
const MAX_QUICK_ENTRY_COUNT = 50
const INITIAL_VERSION_NAME = 'V1'
const VALUE_TYPES = new Set(['EXACT', 'RANGE', 'LT', 'GT'])
const LINE_ENABLED_GENERATIONS = new Set(['祖代', '曾祖代'])
const GREAT_GRAND_GENERATION = '曾祖代'

export type ProductSettingIndicatorLibId = string
export type ProductSettingIndicatorLibVersionScope = 'all' | 'latest'
export type ProductSettingIndicatorLibValueType = 'EXACT' | 'RANGE' | 'LT' | 'GT'

export type ProductSettingIndicatorLibListQuery = {
  gen?: string | null
  variety?: string | null
  line?: string | null
  versionScope?: ProductSettingIndicatorLibVersionScope | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingIndicatorLibVersion = Record<string, unknown> & {
  id: ProductSettingIndicatorLibId
  versionId: ProductSettingIndicatorLibId
  libraryId: ProductSettingIndicatorLibId
  generation: string
  variety: string
  strain: string
  versionName: string
  effectiveStart: string | null
  effectiveEnd: string | null
  latest: boolean
  operatorName: string
  operationTime: string | null
}

export type ProductSettingIndicatorLibListPage = {
  list: ProductSettingIndicatorLibVersion[]
  total: number
  latestCount: number
  historyCount: number
}

export type ProductSettingIndicatorLibDimensionForm = {
  generation: string
  /** Portal字典的展示文本；generation是字典value时必须提供它才能复刻动态必填规则。 */
  generationLabel?: string | null
  variety?: string | null
  strain?: string | null
}

export type ProductSettingIndicatorLibCreateForm = ProductSettingIndicatorLibDimensionForm

export type ProductSettingIndicatorLibCreateDraft = {
  generation: string
  variety: string
  strain: string
  /** prepare阶段保留Portal字典展示值；提交时不会发送此字段。 */
  generationLabel?: string
}

export type ProductSettingIndicatorLibUpdateForm = ProductSettingIndicatorLibDimensionForm & {
  id?: ProductSettingIndicatorLibId | null
  libraryId?: ProductSettingIndicatorLibId | null
  standardId?: ProductSettingIndicatorLibId | null
}

export type ProductSettingIndicatorLibUpdateDraft = ProductSettingIndicatorLibCreateDraft & {
  id: ProductSettingIndicatorLibId
}

export type ProductSettingIndicatorLibCopyForm = ProductSettingIndicatorLibDimensionForm & {
  sourceVersionId: ProductSettingIndicatorLibId
}

export type ProductSettingIndicatorLibCopyDraft = ProductSettingIndicatorLibCreateDraft & {
  sourceVersionId: ProductSettingIndicatorLibId
  versionName: string
  effectiveStart: string
}

export type ProductSettingIndicatorLibRemoveInput = {
  versionId?: ProductSettingIndicatorLibId | null
  versionIds?: Array<ProductSettingIndicatorLibId | null>
}

export type ProductSettingIndicatorLibRemoveDraft = {
  versionIds: ProductSettingIndicatorLibId[]
}

export type ProductSettingIndicatorLibVersionUpdateForm = {
  id: ProductSettingIndicatorLibId
  versionName: string
  effectiveStart: string | Date
  effectiveEnd?: string | Date | null
  /** 最新版本只能传null；历史版本必须传结束时间。 */
  isLatest?: boolean
}

export type ProductSettingIndicatorLibVersionUpdateDraft = {
  id: ProductSettingIndicatorLibId
  versionName: string
  effectiveStart: string
  effectiveEnd: string | null
}

export type ProductSettingIndicatorLibCreateVersionForm = {
  libraryId: ProductSettingIndicatorLibId
  versionName: string
  effectiveStart: string | Date
}

export type ProductSettingIndicatorLibCreateVersionDraft = {
  libraryId: ProductSettingIndicatorLibId
  versionName: string
  effectiveStart: string
}

export type ProductSettingIndicatorLibDefinition = Record<string, unknown> & {
  id: ProductSettingIndicatorLibId | ''
  name: string
  code: string
  category: string
  tempBandCode: string | null
  unit: string
  decimalPlaces: number
  sortOrder: number
  indicatorCategoryName: string
  temperatureRelated: boolean
  tempBandName: string
}

export type ProductSettingIndicatorLibDefinitionConfigForm = {
  definitions: Array<Partial<ProductSettingIndicatorLibDefinition> & {
    id?: ProductSettingIndicatorLibId | null
    name?: string | null
    code?: string | null
    category?: string | null
    tempBandCode?: string | null
    unit?: string | null
    decimalPlaces?: number | null
  }>
}

export type ProductSettingIndicatorLibDefinitionConfigDraft = {
  definitions: Array<{
    id: ProductSettingIndicatorLibId | ''
    name: string
    code: string
    category: string
    tempBandCode: string | null
    unit: string
    decimalPlaces: number
    sortOrder: number
  }>
}

export type ProductSettingIndicatorLibValue = {
  valueType: ProductSettingIndicatorLibValueType
  value?: number
  lowerValue?: number
  upperValue?: number
  displayValue?: string
}

export type ProductSettingIndicatorLibDataRow = {
  dayAge: number
  values: Record<string, ProductSettingIndicatorLibValue>
}

export type ProductSettingIndicatorLibDetail = ProductSettingIndicatorLibVersion & {
  versions: ProductSettingIndicatorLibVersion[]
  definitions: ProductSettingIndicatorLibDefinition[]
  rows: Array<{
    dayAge: number
    values: Record<string, ProductSettingIndicatorLibValue>
  }>
}

export type ProductSettingIndicatorLibDataUpdateForm = {
  versionId: ProductSettingIndicatorLibId
  definitions: ProductSettingIndicatorLibDefinition[]
  rows: Array<{
    dayAge: number
    values: Record<string, ProductSettingIndicatorLibValue | null>
  }>
}

export type ProductSettingIndicatorLibDataUpdateDraft = {
  versionId: ProductSettingIndicatorLibId
  /** prepare阶段使用的detail.definitions；提交时不会放入HTTP body。 */
  definitions: ProductSettingIndicatorLibDefinition[]
  rows: Array<{
    dayAge: number
    values: Record<string, ProductSettingIndicatorLibValue | null>
  }>
}

export type ProductSettingIndicatorLibQuickEntryForm = {
  versionId: ProductSettingIndicatorLibId
  definitions: ProductSettingIndicatorLibDefinition[]
  entries: Array<{
    indicatorCode: string
    startDayAge: number
    endDayAge: number
    indicatorValue: {
      valueType: 'EXACT'
      value: number
    }
  }>
}

export type ProductSettingIndicatorLibQuickEntryDraft = {
  versionId: ProductSettingIndicatorLibId
  /** prepare阶段使用的detail.definitions；提交时不会放入HTTP body。 */
  definitions: ProductSettingIndicatorLibDefinition[]
  entries: ProductSettingIndicatorLibQuickEntryForm['entries']
}

export type ProductSettingIndicatorLibFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type ProductSettingIndicatorLibFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type ProductSettingIndicatorLibImportForm = {
  versionId: ProductSettingIndicatorLibId
  file: ProductSettingIndicatorLibFileInput
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  const text = value.trim()
  return text || null
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  const text = textOf(value, label).trim()
  if (!text) throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && text.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return text
}

function idOf (value: unknown, label: string): string {
  const text = value === undefined || value === null ? '' : String(value).trim()
  if (!text) throw new Error(`${label}必须为非空ID`)
  return text
}

function idOrEmptyOf (value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20或50')
  return resolved
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.keys(object).length === 1 && object.data !== undefined) return object.data
  }
  return value
}

function arrayOf (value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value
  if (value !== null && typeof value === 'object') {
    for (const key of keys) {
      const candidate = (value as JsonObject)[key]
      if (Array.isArray(candidate)) return candidate
    }
  }
  return []
}

function numberOrNullOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`${label}必须是数字或null`)
  return number
}

function dateTimeOf (value: unknown, label: string): string {
  if (value === null || value === undefined || value === '') throw new Error(`${label}不能为空`)
  if (typeof value === 'string' && value.length >= 19) return value.slice(0, 19).replace('T', ' ')
  const date = value instanceof Date ? value : new Date(value as string | number)
  if (Number.isNaN(date.getTime())) throw new Error(`${label}必须是有效日期时间`)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function nullableDateTimeOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateTimeOf(value, label)
}

function generationLabelOf (form: { generation: string; generationLabel?: string | null }): string {
  return textOf(form.generationLabel ?? form.generation, '代次展示值').trim()
}

function isGreatGrandGeneration (form: { generation: string; generationLabel?: string | null }): boolean {
  return generationLabelOf(form) === GREAT_GRAND_GENERATION
}

function isLineEnabledGeneration (form: { generation: string; generationLabel?: string | null }): boolean {
  return LINE_ENABLED_GENERATIONS.has(generationLabelOf(form))
}

function dimensionOf (form: unknown, withId: boolean): ProductSettingIndicatorLibCreateDraft | ProductSettingIndicatorLibUpdateDraft {
  const source = objectOf(form, withId ? '指标库编辑表单' : '指标库新建表单') as ProductSettingIndicatorLibDimensionForm & JsonObject
  const generation = requiredTextOf(source.generation, '代次', 64)
  const variety = nullableTextOf(source.variety, '品种')
  if (!isGreatGrandGeneration({ generation, generationLabel: source.generationLabel })) {
    if (!variety) throw new Error('请选择品种')
  }
  const strain = isLineEnabledGeneration({ generation, generationLabel: source.generationLabel })
    ? nullableTextOf(source.strain, '品系') ?? ''
    : ''
  const generationLabel = source.generationLabel === undefined || source.generationLabel === null
    ? undefined
    : requiredTextOf(source.generationLabel, '代次展示值', 64)
  const base = { generation, variety: variety ?? '', strain, ...(generationLabel ? { generationLabel } : {}) }
  if (!withId) return base
  return { ...base, id: idOrEmptyOf(source.id ?? source.libraryId ?? source.standardId) }
}

function dimensionPayloadOf (draft: ProductSettingIndicatorLibCreateDraft): ProductSettingIndicatorLibCreateDraft {
  return { generation: draft.generation, variety: draft.variety, strain: draft.strain }
}

function versionOf (value: unknown, index = 0): ProductSettingIndicatorLibVersion {
  const source = objectOf(value, `指标库版本[${index}]`)
  const id = idOrEmptyOf(source.id ?? source.versionId ?? source.version_id)
  const effectiveEnd = source.effectiveEnd ?? source.effective_end ?? source.effectiveEndTime ?? source.effective_end_time ?? null
  return {
    ...source,
    id,
    versionId: id,
    libraryId: idOrEmptyOf(source.libraryId ?? source.library_id),
    generation: textOf(source.generation ?? source.gen, `指标库版本[${index}].generation`),
    variety: textOf(source.variety, `指标库版本[${index}].variety`),
    strain: textOf(source.strain ?? source.line, `指标库版本[${index}].strain`),
    versionName: textOf(source.versionName ?? source.version_name ?? source.versionNo ?? source.version_no, `指标库版本[${index}].versionName`),
    effectiveStart: (source.effectiveStart ?? source.effective_start ?? source.effectiveStartTime ?? source.effective_start_time ?? null) as string | null,
    effectiveEnd: effectiveEnd as string | null,
    latest: Boolean(source.latest ?? source.isLatest) || effectiveEnd === null,
    operatorName: textOf(source.operatorName ?? source.operator_name ?? source.updateUserName ?? source.update_user_name, `指标库版本[${index}].operatorName`),
    operationTime: (source.operationTime ?? source.operation_time ?? source.updateTime ?? source.update_time ?? null) as string | null,
  }
}

function definitionOf (value: unknown, index = 0): ProductSettingIndicatorLibDefinition {
  const source = objectOf(value, `指标定义[${index}]`)
  const id = idOrEmptyOf(source.id ?? source.versionDefId ?? source.version_def_id ?? source.defId ?? source.def_id)
  const codeInfo = source.indicatorCode && typeof source.indicatorCode === 'object'
    ? source.indicatorCode as JsonObject
    : {}
  const decimalPlaces = Number(source.decimalPlaces ?? source.decimal_places ?? codeInfo.decimalPlaces ?? 0)
  if (!Number.isInteger(decimalPlaces)) throw new Error(`指标定义[${index}].decimalPlaces必须是整数`)
  return {
    ...source,
    id,
    name: textOf(source.indicatorName ?? source.indicator_name ?? source.name ?? codeInfo.name, `指标定义[${index}].name`),
    code: textOf(source.indicatorCode ?? source.indicator_code ?? source.code ?? codeInfo.code, `指标定义[${index}].code`),
    category: textOf(source.indicatorCategory ?? source.indicator_category ?? source.category ?? source.categoryCode ?? source.category_code ?? codeInfo.category, `指标定义[${index}].category`),
    tempBandCode: nullableTextOf(source.tempBandCode ?? source.temp_band_code, `指标定义[${index}].tempBandCode`),
    unit: textOf(source.unit ?? codeInfo.unit, `指标定义[${index}].unit`),
    decimalPlaces,
    sortOrder: Number(source.sortNo ?? source.sort_no ?? source.sortOrder ?? source.sort_order ?? index),
    indicatorCategoryName: textOf(source.indicatorCategoryName ?? source.indicator_category_name ?? source.categoryName ?? source.category_name, `指标定义[${index}].indicatorCategoryName`),
    temperatureRelated: Boolean(source.temperatureRelated),
    tempBandName: textOf(source.tempBandName ?? source.temp_band_name, `指标定义[${index}].tempBandName`),
  }
}

function valueOf (value: unknown, label: string): ProductSettingIndicatorLibValue {
  const source = objectOf(value, label)
  const valueType = textOf(source.valueType ?? source.value_type, `${label}.valueType`).toUpperCase() as ProductSettingIndicatorLibValueType
  if (!VALUE_TYPES.has(valueType)) throw new Error(`${label}.valueType只能是EXACT、RANGE、LT或GT`)
  const result: ProductSettingIndicatorLibValue = { valueType }
  if (valueType === 'RANGE') {
    const lowerValue = numberOrNullOf(source.lowerValue ?? source.lower_value, `${label}.lowerValue`)
    const upperValue = numberOrNullOf(source.upperValue ?? source.upper_value, `${label}.upperValue`)
    if (lowerValue === null || upperValue === null) throw new Error(`${label}区间上下限不能为空`)
    if (lowerValue > upperValue) throw new Error(`${label}区间下限不能大于上限`)
    if (source.value !== undefined && source.value !== null) throw new Error(`${label}范围类型不能填写具体值`)
    result.lowerValue = lowerValue
    result.upperValue = upperValue
  } else {
    const number = numberOrNullOf(source.value, `${label}.value`)
    if (number === null) throw new Error(`${label}必须为数字`)
    if (source.lowerValue !== undefined && source.lowerValue !== null) throw new Error(`${label}非范围类型不能填写区间下限`)
    if (source.upperValue !== undefined && source.upperValue !== null) throw new Error(`${label}非范围类型不能填写区间上限`)
    result.value = number
  }
  if (source.displayValue !== undefined) result.displayValue = textOf(source.displayValue, `${label}.displayValue`)
  return result
}

function dataRowOf (value: unknown, definitionMap: Map<string, ProductSettingIndicatorLibDefinition>, index: number): ProductSettingIndicatorLibDataRow {
  const source = objectOf(value, `指标数据行[${index}]`)
  const dayAge = numberOrNullOf(source.dayAge ?? source.day_age, `指标数据行[${index}].dayAge`)
  if (dayAge === null || !Number.isInteger(dayAge) || dayAge < 1 || dayAge > MAX_DAY_AGE) throw new Error(`指标数据行[${index}].dayAge必须是1至700的整数`)
  const rawValues = objectOf(source.values, `指标数据行[${index}].values`)
  const values: Record<string, ProductSettingIndicatorLibValue> = {}
  for (const [code, rawValue] of Object.entries(rawValues)) {
    if (!definitionMap.has(code)) continue
    values[code] = valueOf(rawValue, `指标数据行[${index}].values.${code}`)
  }
  return { dayAge, values }
}

function definitionListOf (value: unknown): ProductSettingIndicatorLibDefinition[] {
  const payload = payloadOf(value)
  return arrayOf(payload, ['definitions', 'definitionList', 'definition_list', 'records', 'list', 'items']).map((item, index) => definitionOf(item, index))
}

function detailOf (value: unknown): ProductSettingIndicatorLibDetail {
  const payload = objectOf(payloadOf(value), '指标库详情响应')
  const root = versionOf(payload)
  const definitions = definitionListOf(payload.definitions ?? payload.definitionList ?? payload.definition_list ?? [])
  const definitionMap = new Map(definitions.map(definition => [definition.code, definition]))
  const rows = arrayOf(payload.rows ?? payload.list ?? payload.items ?? payload.data).map((item, index) => dataRowOf(item, definitionMap, index))
  return {
    ...root,
    versions: arrayOf(payload.versions ?? payload.versionList ?? payload.version_list).map((item, index) => versionOf(item, index)),
    definitions,
    rows,
  }
}

function pageOf (value: unknown): ProductSettingIndicatorLibListPage {
  const payload = objectOf(payloadOf(value), '指标库分页响应')
  const page = payload.page && typeof payload.page === 'object' ? payload.page as JsonObject : payload
  const rawList = page.list ?? page.records ?? page.rows ?? page.items
  if (!Array.isArray(rawList)) throw new Error('指标库分页响应缺少list数组')
  const list = rawList.map((item, index) => versionOf(item, index))
  const total = Number(page.total ?? page.count ?? list.length)
  const latestCount = Number(page.latestCount ?? page.latest_count ?? 0)
  const historyCount = Number(page.historyCount ?? page.history_count ?? 0)
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(latestCount) || latestCount < 0 || !Number.isSafeInteger(historyCount) || historyCount < 0) throw new Error('指标库分页响应缺少有效total或版本统计')
  return { list, total, latestCount, historyCount }
}

function listQueryOf (query: ProductSettingIndicatorLibListQuery = {}): Record<string, unknown> {
  const scope = query.versionScope === 'all' ? 'all' : 'latest'
  const params: Record<string, unknown> = {
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 10, 'pageSize'),
    latestOnly: scope !== 'all',
  }
  const gen = textOf(query.gen, '代次').trim()
  const variety = textOf(query.variety, '品种').trim()
  const line = textOf(query.line, '品系').trim()
  if (gen) params.generation = gen
  if (variety) params.variety = variety
  if (line) params.strain = line
  return params
}

function versionUpdateOf (value: unknown): ProductSettingIndicatorLibVersionUpdateDraft {
  const source = objectOf(value, '指标库版本编辑表单') as ProductSettingIndicatorLibVersionUpdateForm
  const id = idOf(source.id, '版本ID')
  const versionName = requiredTextOf(source.versionName, '版本号', 32)
  const effectiveStart = dateTimeOf(source.effectiveStart, '生效开始时间')
  let effectiveEnd = nullableDateTimeOf(source.effectiveEnd, '生效结束时间')
  if (source.isLatest === true) effectiveEnd = null
  if (source.isLatest === false && !effectiveEnd) throw new Error('历史版本生效结束时间不能为空')
  if (effectiveEnd && new Date(effectiveEnd.replace(' ', 'T')).getTime() <= new Date(effectiveStart.replace(' ', 'T')).getTime()) throw new Error('生效结束时间必须晚于生效开始时间')
  return { id, versionName, effectiveStart, effectiveEnd }
}

function createVersionOf (value: unknown): ProductSettingIndicatorLibCreateVersionDraft {
  const source = objectOf(value, '指标库新建版本表单') as ProductSettingIndicatorLibCreateVersionForm
  return {
    libraryId: idOf(source.libraryId, '指标库ID'),
    versionName: requiredTextOf(source.versionName, '版本号', 32),
    effectiveStart: dateTimeOf(source.effectiveStart, '生效开始时间'),
  }
}

function definitionConfigOf (value: unknown): ProductSettingIndicatorLibDefinitionConfigDraft {
  const source = objectOf(value, '指标配置')
  if (!Array.isArray(source.definitions)) throw new Error('指标配置definitions必须是数组')
  const codes = new Set<string>()
  const definitions = source.definitions.map((item, index) => {
    const raw = objectOf(item, `指标配置[${index}]`)
    const name = requiredTextOf(raw.name ?? raw.indicatorName, `第${index + 1}项指标名称`, 100)
    const code = requiredTextOf(raw.code ?? raw.indicatorCode, `第${index + 1}项指标Code`, 64)
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(code)) throw new Error(`第${index + 1}项指标Code须以小写字母开头，仅支持小写字母、数字和下划线，长度不超过64位`)
    if (codes.has(code)) throw new Error(`指标Code ${code}重复，请重新输入`)
    codes.add(code)
    const category = requiredTextOf(raw.category ?? raw.indicatorCategory, `第${index + 1}项指标分类`, 32)
    const decimalPlaces = Number(raw.decimalPlaces ?? 0)
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 3) throw new Error(`第${index + 1}项小数位必须是0-3的整数`)
    return {
      id: idOrEmptyOf(raw.id),
      name,
      code,
      category,
      tempBandCode: nullableTextOf(raw.tempBandCode, `第${index + 1}项温度段关联`),
      unit: textOf(raw.unit, `第${index + 1}项单位`).trim(),
      decimalPlaces,
      sortOrder: index,
    }
  })
  return { definitions }
}

function decimalPlacesOf (value: number, label: string): void {
  const text = String(value)
  const decimals = text.split('.')[1]?.length ?? 0
  if (decimals > Number(label)) throw new Error(`指标值最多保留${label}位小数`)
}

function dataUpdateOf (value: unknown): ProductSettingIndicatorLibDataUpdateDraft {
  const source = objectOf(value, '指标数据保存表单') as ProductSettingIndicatorLibDataUpdateForm
  const versionId = idOf(source.versionId, '版本ID')
  if (!Array.isArray(source.definitions)) throw new Error('指标数据保存必须提供detail.definitions用于校验')
  if (!Array.isArray(source.rows) || source.rows.length === 0) throw new Error('请至少提交一行指标数据')
  const definitions = source.definitions.map((item, index) => definitionOf(item, index))
  const definitionMap = new Map(definitions.map(definition => [definition.code, definition]))
  const dayAges = new Set<number>()
  const rows = source.rows.map((item, index) => {
    const raw = objectOf(item, `指标数据保存行[${index}]`)
    const dayAge = numberOrNullOf(raw.dayAge, `指标数据保存行[${index}].dayAge`)
    if (dayAge === null || !Number.isInteger(dayAge) || dayAge < 1 || dayAge > MAX_DAY_AGE) throw new Error(`指标数据保存行[${index}].dayAge必须是1至700的整数`)
    if (dayAges.has(dayAge)) throw new Error(`日龄不能重复：${dayAge}`)
    dayAges.add(dayAge)
    const rawValues = objectOf(raw.values, `指标数据保存行[${index}].values`)
    const values: Record<string, ProductSettingIndicatorLibValue | null> = {}
    for (const [code, rawValue] of Object.entries(rawValues)) {
      const definition = definitionMap.get(code)
      if (!definition) throw new Error(`存在未配置的指标Code：${code}`)
      if (rawValue === null) {
        values[code] = null
        continue
      }
      const normalized = valueOf(rawValue, `指标数据保存行[${index}].values.${code}`)
      if (normalized.valueType === 'RANGE') {
        decimalPlacesOf(normalized.lowerValue!, String(definition.decimalPlaces))
        decimalPlacesOf(normalized.upperValue!, String(definition.decimalPlaces))
      } else decimalPlacesOf(normalized.value!, String(definition.decimalPlaces))
      values[code] = normalized
    }
    if (Object.keys(values).length === 0) throw new Error(`指标数据保存行[${index}]至少要提交一个指标值`)
    return { dayAge, values }
  })
  return { versionId, definitions, rows }
}

function quickEntryOf (value: unknown): ProductSettingIndicatorLibQuickEntryDraft {
  const source = objectOf(value, '指标快速录入表单') as ProductSettingIndicatorLibQuickEntryForm
  const versionId = idOf(source.versionId, '版本ID')
  if (!Array.isArray(source.definitions)) throw new Error('指标快速录入必须提供detail.definitions用于校验')
  if (!Array.isArray(source.entries) || source.entries.length === 0) throw new Error('请至少添加一条快速录入数据')
  if (source.entries.length > MAX_QUICK_ENTRY_COUNT) throw new Error('单次快速录入不能超过50条')
  const definitionMap = new Map(source.definitions.map((item, index) => {
    const definition = definitionOf(item, index)
    return [definition.code, definition]
  }))
  const entries = source.entries.map((item, index) => {
    const entry = objectOf(item, `快速录入[${index}]`)
    const indicatorCode = requiredTextOf(entry.indicatorCode, `快速录入[${index}].indicatorCode`)
    const definition = definitionMap.get(indicatorCode)
    if (!definition) throw new Error(`存在未配置的指标Code：${indicatorCode}`)
    const startDayAge = numberOrNullOf(entry.startDayAge, `快速录入[${index}].startDayAge`)
    const endDayAge = numberOrNullOf(entry.endDayAge, `快速录入[${index}].endDayAge`)
    if (startDayAge === null || endDayAge === null || !Number.isInteger(startDayAge) || !Number.isInteger(endDayAge) || startDayAge < 1 || endDayAge > MAX_DAY_AGE || startDayAge > endDayAge) throw new Error(`快速录入[${index}]日龄区间必须在1-${MAX_DAY_AGE}之间且起始日龄不大于结束日龄`)
    const indicatorValue = objectOf(entry.indicatorValue, `快速录入[${index}].indicatorValue`)
    const valueType = textOf(indicatorValue.valueType, `快速录入[${index}].indicatorValue.valueType`).toUpperCase()
    if (valueType !== 'EXACT') throw new Error('Portal快速录入只提交EXACT具体值')
    const number = numberOrNullOf(indicatorValue.value, `快速录入[${index}].indicatorValue.value`)
    if (number === null) throw new Error(`快速录入[${index}]对应数值必须为数字`)
    decimalPlacesOf(number, String(definition.decimalPlaces))
    return { indicatorCode, startDayAge, endDayAge, indicatorValue: { valueType: 'EXACT' as const, value: number } }
  })
  return { versionId, definitions: [...definitionMap.values()], entries }
}

function base64BytesOf (value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  const base64 = value.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}不能为空`)
  return new Uint8Array(bytes)
}

function fileOf (value: unknown): { fileName: string; contentType: string; bytes: Uint8Array; base64: string } {
  const source = objectOf(value, '指标库导入文件')
  const fileName = requiredTextOf(source.fileName, 'fileName')
  if (!/\.xlsx$/i.test(fileName)) throw new Error('Portal导入控件只接受.xlsx文件')
  const bytes = base64BytesOf(source.base64, 'base64')
  const contentType = typeof source.contentType === 'string' && source.contentType.trim()
    ? source.contentType
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes, base64: Buffer.from(bytes).toString('base64') }
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): ProductSettingIndicatorLibFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('指标库文件响应为空')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers?.get === 'function' ? headers.get('content-type') : headers?.['content-type']
  const disposition = typeof headers?.get === 'function' ? headers.get('content-disposition') : headers?.['content-disposition']
  const dispositionText = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(dispositionText)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(dispositionText)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else if (plain) fileName = plain
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function formDataOf (file: { fileName: string; contentType: string; bytes: Uint8Array }): FormData {
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  return data
}

function scalarIdOf (value: unknown): string {
  const payload = payloadOf(value)
  if (typeof payload === 'string' || typeof payload === 'number') return String(payload)
  if (payload !== null && typeof payload === 'object') {
    const object = payload as JsonObject
    const id = object.id ?? object.versionId ?? object.version_id ?? object.data
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return ''
}

function importCountOf (value: unknown): number {
  const payload = payloadOf(value)
  const number = typeof payload === 'number' ? payload : payload !== null && typeof payload === 'object' ? Number((payload as JsonObject).count ?? (payload as JsonObject).importedCount) : Number.NaN
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('指标库导入响应缺少有效条数')
  return number
}

function definitionPayloadOf (definition: ProductSettingIndicatorLibDefinitionConfigDraft['definitions'][number]): Record<string, unknown> {
  return {
    indicatorName: definition.name,
    indicatorCode: definition.code,
    indicatorCategory: definition.category,
    tempBandCode: definition.tempBandCode,
    unit: definition.unit,
    decimalPlaces: definition.decimalPlaces,
  }
}

/** The injected request must use PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH as page context. */
export function createProductSettingIndicatorLibCapability (request: PortalRequest) {
  return {
    async list (query: ProductSettingIndicatorLibListQuery = {}): Promise<ProductSettingIndicatorLibListPage> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listQueryOf(query) }))
    },

    prepareCreate (form: ProductSettingIndicatorLibCreateForm): { draft: ProductSettingIndicatorLibCreateDraft } {
      return { draft: dimensionOf(form, false) as ProductSettingIndicatorLibCreateDraft }
    },

    async create (input: { draft: ProductSettingIndicatorLibCreateDraft }): Promise<ProductSettingIndicatorLibId> {
      const draft = dimensionOf(input?.draft, false) as ProductSettingIndicatorLibCreateDraft
      const result = await request({ url: `${ROOT}/create`, method: 'post', data: dimensionPayloadOf(draft) })
      const id = scalarIdOf(result)
      if (!id) throw new Error('指标库创建成功但未返回版本ID')
      return id
    },

    prepareUpdate (form: ProductSettingIndicatorLibUpdateForm): { draft: ProductSettingIndicatorLibUpdateDraft } {
      return { draft: dimensionOf(form, true) as ProductSettingIndicatorLibUpdateDraft }
    },

    async update (input: { draft: ProductSettingIndicatorLibUpdateDraft }): Promise<true> {
      const draft = dimensionOf(input?.draft, true) as ProductSettingIndicatorLibUpdateDraft
      await request({ url: `${ROOT}/update`, method: 'put', data: { id: draft.id, ...dimensionPayloadOf(draft) } })
      return true
    },

    async get (input: { versionId: ProductSettingIndicatorLibId }): Promise<ProductSettingIndicatorLibDetail> {
      const versionId = idOf(input?.versionId, '版本ID')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { versionId } }))
    },

    prepareCopy (form: ProductSettingIndicatorLibCopyForm): { draft: ProductSettingIndicatorLibCopyDraft } {
      const source = objectOf(form, '指标库复制表单') as ProductSettingIndicatorLibCopyForm
      const dimensions = dimensionOf(source, false) as ProductSettingIndicatorLibCreateDraft
      return {
        draft: {
          ...dimensions,
          sourceVersionId: idOf(source.sourceVersionId, '源版本ID'),
          versionName: INITIAL_VERSION_NAME,
          effectiveStart: dateTimeOf(new Date(), '生效开始时间'),
        },
      }
    },

    async copy (input: { draft: ProductSettingIndicatorLibCopyDraft }): Promise<ProductSettingIndicatorLibId> {
      const draft = objectOf(input?.draft, '指标库复制草稿') as ProductSettingIndicatorLibCopyDraft
      const dimensions = dimensionOf(draft, false) as ProductSettingIndicatorLibCreateDraft
      const payload = {
        sourceVersionId: idOf(draft.sourceVersionId, '源版本ID'),
        ...dimensionPayloadOf(dimensions),
        versionName: requiredTextOf(draft.versionName, '版本号', 32),
        effectiveStart: dateTimeOf(draft.effectiveStart, '生效开始时间'),
      }
      const result = await request({ url: `${ROOT}/copy`, method: 'post', data: payload })
      const id = scalarIdOf(result)
      if (!id) throw new Error('指标库复制成功但未返回版本ID')
      return id
    },

    prepareRemove (input: ProductSettingIndicatorLibRemoveInput): ProductSettingIndicatorLibRemoveDraft {
      const source = input ?? {}
      const candidates = source.versionIds ?? (source.versionId === undefined || source.versionId === null ? [] : [source.versionId])
      const versionIds = candidates.map((value, index) => idOf(value, `第${index + 1}个版本ID`))
      if (!versionIds.length) throw new Error('至少需要一个版本ID')
      return { versionIds }
    },

    async remove (input: ProductSettingIndicatorLibRemoveDraft): Promise<true> {
      const versionIds = this.prepareRemove(input).versionIds
      for (const versionId of versionIds) {
        await request({ url: `${ROOT}/delete`, method: 'delete', params: { versionId } })
      }
      return true
    },

    prepareVersionUpdate (form: ProductSettingIndicatorLibVersionUpdateForm): { draft: ProductSettingIndicatorLibVersionUpdateDraft } {
      return { draft: versionUpdateOf(form) }
    },

    async updateVersion (input: { draft: ProductSettingIndicatorLibVersionUpdateDraft }): Promise<true> {
      await request({ url: `${ROOT}/version/update`, method: 'put', data: versionUpdateOf(input?.draft) })
      return true
    },

    prepareCreateVersion (form: ProductSettingIndicatorLibCreateVersionForm): { draft: ProductSettingIndicatorLibCreateVersionDraft } {
      return { draft: createVersionOf(form) }
    },

    async createVersion (input: { draft: ProductSettingIndicatorLibCreateVersionDraft }): Promise<ProductSettingIndicatorLibId> {
      const draft = createVersionOf(input?.draft)
      const result = await request({ url: `${ROOT}/version/create`, method: 'post', data: draft })
      const id = scalarIdOf(result)
      if (!id) throw new Error('指标库版本创建成功但未返回版本ID')
      return id
    },

    async definitionList (): Promise<ProductSettingIndicatorLibDefinition[]> {
      return definitionListOf(await request({ url: `${ROOT}/definition/list`, method: 'get' }))
    },

    prepareDefinitionConfig (form: ProductSettingIndicatorLibDefinitionConfigForm): { draft: ProductSettingIndicatorLibDefinitionConfigDraft } {
      return { draft: definitionConfigOf(form) }
    },

    async applyDefinitionConfig (input: { draft: ProductSettingIndicatorLibDefinitionConfigDraft }): Promise<ProductSettingIndicatorLibDefinition[]> {
      const draft = definitionConfigOf(input?.draft)
      const current = await this.definitionList()
      const currentWithIds = current.filter(definition => Boolean(definition.id))
      const currentMap = new Map(currentWithIds.map(definition => [definition.id, definition]))
      const currentIds = currentWithIds.map(definition => definition.id)
      const nextIds: string[] = []
      for (const definition of draft.definitions) {
        const payload = definitionPayloadOf(definition)
        if (definition.id && currentMap.has(definition.id)) {
          const currentDefinition = currentMap.get(definition.id)!
          const currentPayload = definitionPayloadOf({
            id: currentDefinition.id,
            name: currentDefinition.name,
            code: currentDefinition.code,
            category: currentDefinition.category,
            tempBandCode: currentDefinition.tempBandCode,
            unit: currentDefinition.unit,
            decimalPlaces: currentDefinition.decimalPlaces,
            sortOrder: currentDefinition.sortOrder,
          })
          if (Object.keys(payload).some(key => payload[key] !== currentPayload[key])) {
            await request({ url: `${ROOT}/definition/update`, method: 'put', data: { id: definition.id, ...payload } })
          }
          nextIds.push(definition.id)
        } else {
          const result = await request({ url: `${ROOT}/definition/create`, method: 'post', data: payload })
          const id = scalarIdOf(result)
          if (!id) throw new Error('指标创建成功但未返回指标ID')
          nextIds.push(id)
        }
      }
      for (const id of currentIds) {
        if (!nextIds.includes(id)) await request({ url: `${ROOT}/definition/delete`, method: 'delete', params: { id } })
      }
      if (nextIds.length && (currentIds.length !== nextIds.length || currentIds.some((id, index) => id !== nextIds[index]))) {
        await request({ url: `${ROOT}/definition/sort`, method: 'put', data: { definitionIds: nextIds } })
      }
      return this.definitionList()
    },

    prepareDataUpdate (form: ProductSettingIndicatorLibDataUpdateForm): { draft: ProductSettingIndicatorLibDataUpdateDraft } {
      return { draft: dataUpdateOf(form) }
    },

    async partialUpdate (input: { draft: ProductSettingIndicatorLibDataUpdateDraft }): Promise<true> {
      const draft = dataUpdateOf(input?.draft)
      await request({ url: `${ROOT}/data/partial-update`, method: 'put', data: { versionId: draft.versionId, rows: draft.rows } })
      return true
    },

    prepareQuickEntry (form: ProductSettingIndicatorLibQuickEntryForm): { draft: ProductSettingIndicatorLibQuickEntryDraft } {
      return { draft: quickEntryOf(form) }
    },

    async quickEntry (input: { draft: ProductSettingIndicatorLibQuickEntryDraft }): Promise<true> {
      const draft = quickEntryOf(input?.draft)
      await request({ url: `${ROOT}/data/quick-entry`, method: 'put', data: { versionId: draft.versionId, entries: draft.entries } })
      return true
    },

    async downloadTemplate (): Promise<ProductSettingIndicatorLibFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', responseType: 'arraybuffer' })
      return downloadedFileOf(response, '指标库导入模板.xlsx')
    },

    async exportExcel (input: { versionId: ProductSettingIndicatorLibId }): Promise<ProductSettingIndicatorLibFile> {
      const versionId = idOf(input?.versionId, '版本ID')
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: { versionId }, responseType: 'arraybuffer' })
      return downloadedFileOf(response, '指标库.xls')
    },

    async importExcel (input: ProductSettingIndicatorLibImportForm): Promise<number> {
      const versionId = idOf(input?.versionId, '版本ID')
      const file = fileOf(input?.file)
      const result = await request({
        url: `${ROOT}/import-excel`,
        method: 'post',
        params: { versionId },
        data: formDataOf(file),
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return importCountOf(result)
    },
  }
}

export type ProductSettingIndicatorLibCapability = ReturnType<typeof createProductSettingIndicatorLibCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const dimensionParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '指标库代次/品种/品系表单；generation必填，除“曾祖代”外variety必填，仅“祖代/曾祖代”允许提交strain；generation为字典value时同时提供generationLabel以复刻Portal动态规则' }
const draftParam = (name: string, description: string): ParamSpec => p(name, 'text', true, description)

export const PRODUCT_SETTING_INDICATOR_LIB_METHODS = {
  'product-setting-indicator-lib-list': 'list',
  'product-setting-indicator-lib-prepare-create': 'prepareCreate',
  'product-setting-indicator-lib-create': 'create',
  'product-setting-indicator-lib-prepare-update': 'prepareUpdate',
  'product-setting-indicator-lib-update': 'update',
  'product-setting-indicator-lib-get': 'get',
  'product-setting-indicator-lib-prepare-copy': 'prepareCopy',
  'product-setting-indicator-lib-copy': 'copy',
  'product-setting-indicator-lib-prepare-remove': 'prepareRemove',
  'product-setting-indicator-lib-remove': 'remove',
  'product-setting-indicator-lib-prepare-version-update': 'prepareVersionUpdate',
  'product-setting-indicator-lib-version-update': 'updateVersion',
  'product-setting-indicator-lib-prepare-version-create': 'prepareCreateVersion',
  'product-setting-indicator-lib-version-create': 'createVersion',
  'product-setting-indicator-lib-definition-list': 'definitionList',
  'product-setting-indicator-lib-prepare-definition-config': 'prepareDefinitionConfig',
  'product-setting-indicator-lib-apply-definition-config': 'applyDefinitionConfig',
  'product-setting-indicator-lib-prepare-data-update': 'prepareDataUpdate',
  'product-setting-indicator-lib-data-update': 'partialUpdate',
  'product-setting-indicator-lib-prepare-quick-entry': 'prepareQuickEntry',
  'product-setting-indicator-lib-quick-entry': 'quickEntry',
  'product-setting-indicator-lib-download-template': 'downloadTemplate',
  'product-setting-indicator-lib-export': 'exportExcel',
  'product-setting-indicator-lib-import': 'importExcel',
} as const

export const productSettingIndicatorLibCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-indicator-lib-list', title: '查询指标库', write: false, params: [p('gen', 'text', false, '代次筛选；Portal映射为generation，默认省略'), p('variety', 'text', false, '品种筛选；默认省略'), p('line', 'text', false, '品系筛选；Portal映射为strain，默认省略'), p('versionScope', 'enum', false, '版本范围：all=全部版本，latest=最新版本；默认latest',), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50，默认10')] },
  { id: 'product-setting-indicator-lib-prepare-create', title: '准备新建指标库', write: false, params: [dimensionParam] },
  { id: 'product-setting-indicator-lib-create', title: '新建指标库', write: true, params: [draftParam('draft', 'prepareCreate返回的三字段指标库草稿')] },
  { id: 'product-setting-indicator-lib-prepare-update', title: '准备编辑指标库', write: false, params: [dimensionParam] },
  { id: 'product-setting-indicator-lib-update', title: '编辑指标库', write: true, params: [draftParam('draft', 'prepareUpdate返回的含id指标库草稿')] },
  { id: 'product-setting-indicator-lib-get', title: '查询指标库版本详情', write: false, params: [p('versionId', 'text', true, '指标库版本ID；来自list[].versionId或版本详情versions[].versionId')] },
  { id: 'product-setting-indicator-lib-prepare-copy', title: '准备复制指标库', write: false, params: [p('form', 'text', true, '复制弹窗表单；sourceVersionId和generation必填，代次规则同新建，版本号固定V1且生效开始时间按Portal当前时间生成')] },
  { id: 'product-setting-indicator-lib-copy', title: '复制指标库', write: true, params: [draftParam('draft', 'prepareCopy返回的复制草稿')] },
  { id: 'product-setting-indicator-lib-prepare-remove', title: '准备删除指标库版本', write: false, params: [p('versionId', 'text', false, '单个版本ID；与versionIds二选一'), p('versionIds', 'text', false, '批量删除的版本ID数组；Portal逐个发送DELETE')] },
  { id: 'product-setting-indicator-lib-remove', title: '删除指标库版本', write: true, params: [draftParam('versionIds', 'prepareRemove返回的版本ID数组')] },
  { id: 'product-setting-indicator-lib-prepare-version-update', title: '准备编辑指标库版本', write: false, params: [p('form', 'text', true, '版本号和生效时间表单；versionName必填，结束时间必须晚于开始时间，最新版本结束时间必须为空，历史版本必须有结束时间')] },
  { id: 'product-setting-indicator-lib-version-update', title: '编辑指标库版本', write: true, params: [draftParam('draft', 'prepareVersionUpdate返回的版本编辑草稿')] },
  { id: 'product-setting-indicator-lib-prepare-version-create', title: '准备新建指标库版本', write: false, params: [p('form', 'text', true, 'libraryId、versionName和effectiveStart；Portal页面默认按当前版本计算Vn并使用当前时间，SDK要求调用方把页面计算结果明确传入')] },
  { id: 'product-setting-indicator-lib-version-create', title: '新建指标库版本', write: true, params: [draftParam('draft', 'prepareCreateVersion返回的版本草稿')] },
  { id: 'product-setting-indicator-lib-definition-list', title: '查询指标定义', write: false, params: [] },
  { id: 'product-setting-indicator-lib-prepare-definition-config', title: '准备指标配置', write: false, params: [p('form', 'text', true, '配置页全部指标行；名称、Code、分类必填，Code为小写字母/数字/下划线且以小写字母开头，小数位为0-3，Code不可重复')] },
  { id: 'product-setting-indicator-lib-apply-definition-config', title: '应用指标配置', write: true, params: [draftParam('draft', 'prepareDefinitionConfig返回的指标配置草稿；SDK按Portal顺序创建、更新、删除并在顺序变化时排序')] },
  { id: 'product-setting-indicator-lib-prepare-data-update', title: '准备指标数据增量保存', write: false, params: [p('form', 'text', true, '版本ID、detail.definitions和发生变化的日龄/指标单元格；日龄1-700，null表示清空单元格，值类型支持EXACT/RANGE/LT/GT并校验小数位')] },
  { id: 'product-setting-indicator-lib-data-update', title: '保存指标数据', write: true, params: [draftParam('draft', 'prepareDataUpdate返回的增量保存草稿')] },
  { id: 'product-setting-indicator-lib-prepare-quick-entry', title: '准备快速录入指标数据', write: false, params: [p('form', 'text', true, '版本ID、detail.definitions和最多50组日龄区间；复刻Portal只提交EXACT具体数值')] },
  { id: 'product-setting-indicator-lib-quick-entry', title: '快速录入指标数据', write: true, params: [draftParam('draft', 'prepareQuickEntry返回的快速录入草稿')] },
  { id: 'product-setting-indicator-lib-download-template', title: '下载指标库导入模板', write: false, params: [] },
  { id: 'product-setting-indicator-lib-export', title: '导出指标库数据', write: false, params: [p('versionId', 'text', true, '当前版本ID')] },
  { id: 'product-setting-indicator-lib-import', title: '导入指标库数据', write: true, params: [p('versionId', 'text', true, '当前版本ID'), p('fileName', 'text', true, 'xlsx文件名'), p('base64', 'text', true, 'xlsx文件的标准Base64'), p('contentType', 'text', false, '文件MIME类型；省略时使用xlsx默认值')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_INDICATOR_LIB_PAGE_PATH,
  permission: PRODUCT_SETTING_INDICATOR_LIB_PERMISSION,
  moduleType: PRODUCT_SETTING_INDICATOR_LIB_MODULE_TYPE,
  httpInstance: 'platform',
}))
