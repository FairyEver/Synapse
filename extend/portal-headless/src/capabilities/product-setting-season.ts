import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 温度配置-新」。 */
export const PRODUCT_SETTING_SEASON_PAGE_PATH = '/dashboard/product/setting/season/list'
export const PRODUCT_SETTING_SEASON_PERMISSION = '/dashboard/frame/breeding-plan-new/season'
export const PRODUCT_SETTING_SEASON_MODULE_TYPE = null

const AREA_TREE_URL = '/system/area/tree'
const TEMP_BAND_ROOT = '/flockSimu/rearingPlan/tempBand'
const ROOT = '/flockSimu/rearingPlan/areaTempConfig'
const PAGE_SIZE_OPTIONS = [10, 20, 50]
const MAX_TEMP_BANDS = 5
const YEAR_DAYS = 365
const REFERENCE_YEAR = 2001

export type ProductSettingSeasonAreaId = string

export type ProductSettingSeasonAreaNode = Record<string, unknown> & {
  id: ProductSettingSeasonAreaId
  name: string
  children: ProductSettingSeasonAreaNode[]
}

export type ProductSettingSeasonDateRange = Record<string, unknown> & {
  startMonth: number | undefined
  startDay: number | undefined
  endMonth: number | undefined
  endDay: number | undefined
}

export type ProductSettingSeasonTempBand = Record<string, unknown> & {
  tempBandId: string
  bandCode: string
  bandName: string
  lowerTemp: number | undefined
  upperTemp: number | undefined
  sortNo: number
  status: number | undefined
  dateRanges: ProductSettingSeasonDateRange[]
}

export type ProductSettingSeasonAreaConfig = Record<string, unknown> & {
  areaCode: string
  provinceCode: string
  provinceName: string
  cityCode: string
  cityName: string
  districtCode: string
  districtName: string
  tempBandCount: number
  operatorId: string
  operatorName: string
  operationTime: string | null
  status: number | undefined
  remarks: string | null
  tempBands: ProductSettingSeasonTempBand[]
}

export type ProductSettingSeasonListPage = {
  list: ProductSettingSeasonAreaConfig[]
  total: number
}

export type ProductSettingSeasonListQuery = {
  provinceCode?: string | null
  cityCode?: string | null
  districtCode?: string | null
  pageNo?: number
  pageSize?: number
}

export type ProductSettingSeasonDateRangeForm = Record<string, unknown> & {
  startMonth?: number | string | null
  startDay?: number | string | null
  endMonth?: number | string | null
  endDay?: number | string | null
}

export type ProductSettingSeasonTempBandForm = Record<string, unknown> & {
  tempBandId?: string | number | null
  id?: string | number | null
  dateRanges?: ProductSettingSeasonDateRangeForm[] | null
  sortNo?: number | string | null
}

export type ProductSettingSeasonSaveForm = {
  provinceCode?: string | number | null
  cityCode?: string | number | null
  districtCode?: string | number | null
  /** 允许直接传入已确认的六位areaCode，主要用于服务端返回的草稿回传。 */
  areaCode?: string | number | null
  tempBands: ProductSettingSeasonTempBandForm[]
  /** Portal保存payload不会携带这两个展示字段；保留在输入类型只是为了明确会被丢弃。 */
  status?: number | null
  remarks?: string | null
}

export type ProductSettingSeasonDateRangeDraft = {
  startMonth: number
  startDay: number
  endMonth: number
  endDay: number
}

export type ProductSettingSeasonTempBandDraft = {
  tempBandId: string
  dateRanges: ProductSettingSeasonDateRangeDraft[]
}

export type ProductSettingSeasonSaveDraft = {
  areaCode: string
  tempBands: ProductSettingSeasonTempBandDraft[]
}

export type ProductSettingSeasonRemoveInput = {
  areaCode?: string | number | null
}

export type ProductSettingSeasonRemoveDraft = {
  areaCode: string
}

export type ProductSettingSeasonRemoveBatchInput = {
  areaCodes?: Array<string | number | null> | null
}

export type ProductSettingSeasonRemoveBatchDraft = {
  areaCodes: string[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function requiredAreaCode (value: unknown, label = '行政区编码'): string {
  const code = textOf(value).trim()
  if (!/^\d{6}$/.test(code)) throw new Error(`${label}必须是6位数字`)
  return code
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && !PAGE_SIZE_OPTIONS.includes(resolved)) throw new Error('pageSize必须是页面支持的10、20或50')
  return resolved
}

function payloadOf (value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as JsonObject
    if (Object.prototype.hasOwnProperty.call(object, 'data')) return object.data
  }
  return value
}

function pagePayloadOf (value: unknown): unknown {
  const payload = payloadOf(value)
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const page = (payload as JsonObject).page
    if (page !== null && typeof page === 'object' && !Array.isArray(page)) return page
  }
  return payload
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

function numberOf (value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function integerOf (value: unknown, label: string, min: number, max: number): number {
  const number = numberOf(value)
  if (number === undefined || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}必须是${min}至${max}的整数`)
  }
  return number
}

function daysInMonth (month: number): number {
  if (month === 2) return 28
  if ([4, 6, 9, 11].includes(month)) return 30
  return 31
}

function normalizeDateRange (value: unknown, index = 0): ProductSettingSeasonDateRange {
  const source = objectOf(value, `日期范围[${index + 1}]`)
  return {
    ...source,
    startMonth: numberOf(source.startMonth ?? source.start_month),
    startDay: numberOf(source.startDay ?? source.start_day),
    endMonth: numberOf(source.endMonth ?? source.end_month),
    endDay: numberOf(source.endDay ?? source.end_day),
  }
}

function normalizeAreaNode (value: unknown, index = 0): ProductSettingSeasonAreaNode {
  const source = objectOf(value, `地区节点[${index + 1}]`)
  const children = arrayOf(source.children ?? source.child, [])
    .map((item, childIndex) => normalizeAreaNode(item, childIndex))
    .filter(item => item.id)
  return {
    ...source,
    id: textOf(source.id).trim(),
    name: textOf(source.name),
    children,
  }
}

function normalizeAreaTreeOf (value: unknown): ProductSettingSeasonAreaNode[] {
  const payload = payloadOf(value)
  return arrayOf(payload, ['list', 'items', 'children'])
    .map((item, index) => normalizeAreaNode(item, index))
    .filter(item => item.id)
}

function normalizeTempBandOf (value: unknown, index = 0): ProductSettingSeasonTempBand {
  const source = objectOf(value, `温度段[${index + 1}]`)
  const dateRanges = arrayOf(source, ['dateRanges', 'date_ranges'])
    .map((item, rangeIndex) => normalizeDateRange(item, rangeIndex))
  return {
    ...source,
    tempBandId: textOf(source.tempBandId ?? source.temp_band_id ?? source.id).trim(),
    bandCode: textOf(source.bandCode ?? source.band_code),
    bandName: textOf(source.bandName ?? source.band_name),
    lowerTemp: numberOf(source.lowerTemp ?? source.lower_temp),
    upperTemp: numberOf(source.upperTemp ?? source.upper_temp),
    sortNo: numberOf(source.sortNo ?? source.sort_no) ?? index + 1,
    status: numberOf(source.status),
    dateRanges,
  }
}

function normalizeTempBandsOf (value: unknown): ProductSettingSeasonTempBand[] {
  return arrayOf(pagePayloadOf(value), ['list', 'records', 'items', 'tempBands'])
    .map((item, index) => normalizeTempBandOf(item, index))
    .sort((left, right) => left.sortNo - right.sortNo)
}

function normalizeAreaTempConfigOf (value: unknown, index = 0): ProductSettingSeasonAreaConfig {
  const source = objectOf(value, `地区温度配置[${index + 1}]`)
  const tempBands = arrayOf(source, ['tempBands', 'temp_band_list'])
    .map((item, bandIndex) => normalizeTempBandOf(item, bandIndex))
  return {
    ...source,
    areaCode: textOf(source.areaCode ?? source.area_code).trim(),
    provinceCode: textOf(source.provinceCode ?? source.province_code).trim(),
    provinceName: textOf(source.provinceName ?? source.province_name),
    cityCode: textOf(source.cityCode ?? source.city_code).trim(),
    cityName: textOf(source.cityName ?? source.city_name),
    districtCode: textOf(source.districtCode ?? source.district_code).trim(),
    districtName: textOf(source.districtName ?? source.district_name),
    tempBandCount: numberOf(source.tempBandCount ?? source.temp_band_count) ?? tempBands.length,
    operatorId: textOf(source.operatorId ?? source.operator_id).trim(),
    operatorName: textOf(source.operatorName ?? source.operator_name),
    operationTime: source.operationTime === undefined && source.operation_time === undefined
      ? null
      : textOf(source.operationTime ?? source.operation_time),
    status: numberOf(source.status),
    remarks: source.remarks === undefined || source.remarks === null ? null : textOf(source.remarks),
    tempBands,
  }
}

function pageOf (value: unknown): ProductSettingSeasonListPage {
  const page = objectOf(pagePayloadOf(value), '温度配置分页响应')
  const rawList = page.list ?? page.records ?? page.items
  if (!Array.isArray(rawList)) throw new Error('温度配置分页响应缺少list数组')
  const list = rawList.map((item, index) => normalizeAreaTempConfigOf(item, index))
  const total = Number(page.total ?? page.count ?? list.length)
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('温度配置分页响应缺少有效total')
  return { list, total }
}

function areaCodeFrom (source: JsonObject): string {
  const provinceCode = textOf(source.provinceCode).trim()
  const cityCode = textOf(source.cityCode).trim()
  const districtCode = textOf(source.districtCode).trim()
  if (cityCode && !provinceCode) throw new Error('选择市前必须先选择省')
  if (districtCode && !cityCode) throw new Error('选择区前必须先选择市')
  if (provinceCode) requiredAreaCode(provinceCode, '省行政区编码')
  if (cityCode) requiredAreaCode(cityCode, '市行政区编码')
  if (districtCode) requiredAreaCode(districtCode, '区行政区编码')
  const selected = districtCode || cityCode || provinceCode
  return requiredAreaCode(selected || source.areaCode)
}

function strictDateRangeOf (value: unknown, index: number): ProductSettingSeasonDateRangeDraft {
  const source = objectOf(value, `日期范围[${index + 1}]`)
  const startMonth = integerOf(source.startMonth ?? source.start_month, `日期范围[${index + 1}].startMonth`, 1, 12)
  const startDay = integerOf(source.startDay ?? source.start_day, `日期范围[${index + 1}].startDay`, 1, daysInMonth(startMonth))
  const endMonth = integerOf(source.endMonth ?? source.end_month, `日期范围[${index + 1}].endMonth`, 1, 12)
  const endDay = integerOf(source.endDay ?? source.end_day, `日期范围[${index + 1}].endDay`, 1, daysInMonth(endMonth))
  return { startMonth, startDay, endMonth, endDay }
}

function dayOfYear (month: number, day: number): number {
  return Math.floor((Date.UTC(REFERENCE_YEAR, month - 1, day) - Date.UTC(REFERENCE_YEAR, 0, 1)) / 86400000) + 1
}

function validateFullYearCoverage (bands: Array<{ tempBandId: string; dateRanges: ProductSettingSeasonDateRangeDraft[] }>): void {
  const owners: Array<string | undefined> = new Array(YEAR_DAYS + 1)
  for (const band of bands) {
    for (const range of band.dateRanges) {
      const start = dayOfYear(range.startMonth, range.startDay)
      const end = dayOfYear(range.endMonth, range.endDay)
      const mark = (from: number, to: number) => {
        for (let day = from; day <= to; day += 1) {
          if (owners[day]) throw new Error(`日期范围不能重叠，重复日期为${day}日序`)
          owners[day] = band.tempBandId
        }
      }
      if (start <= end) mark(start, end)
      else {
        mark(start, YEAR_DAYS)
        mark(1, end)
      }
    }
  }
  const missing = owners.findIndex((owner, index) => index > 0 && !owner)
  if (missing !== -1) throw new Error('日期范围必须完整覆盖全年')
}

function validateTempBandsContinuous (bands: Array<ProductSettingSeasonTempBandForm & { dateRanges: ProductSettingSeasonDateRangeDraft[] }>): void {
  const sortNumbers = bands
    .filter(band => band.dateRanges.length)
    .map(band => numberOf(band.sortNo))
    .filter((sortNo): sortNo is number => Number.isInteger(sortNo))
    .filter((sortNo, index, values) => values.indexOf(sortNo) === index)
    .sort((left, right) => left - right)
  if (sortNumbers.length < 2) return
  for (let index = 1; index < sortNumbers.length; index += 1) {
    if (sortNumbers[index] !== sortNumbers[index - 1]! + 1) throw new Error('已配置的温度段必须连续，不能跳过中间温度段')
  }
}

function saveDraftOf (value: unknown): ProductSettingSeasonSaveDraft {
  const source = objectOf(value, '温度配置表单')
  const areaCode = areaCodeFrom(source)
  const rawBands = source.tempBands
  if (!Array.isArray(rawBands) || rawBands.length === 0) throw new Error('温度段日期配置不能为空')
  if (rawBands.length > MAX_TEMP_BANDS) throw new Error('温度段最多配置5项')

  const ids = new Set<string>()
  const bands: Array<ProductSettingSeasonTempBandForm & { tempBandId: string; dateRanges: ProductSettingSeasonDateRangeDraft[] }> = []
  for (const [index, rawBand] of rawBands.entries()) {
    const band = objectOf(rawBand, `温度段[${index + 1}]`)
    const tempBandId = textOf(band.tempBandId ?? band.temp_band_id ?? band.id).trim()
    if (!tempBandId) throw new Error(`温度段[${index + 1}]不能为空`)
    if (ids.has(tempBandId)) throw new Error('温度段不能重复配置')
    ids.add(tempBandId)
    const rawRanges = band.dateRanges
    if (!Array.isArray(rawRanges)) throw new Error(`温度段[${index + 1}].dateRanges不能为null`)
    bands.push({
      ...band,
      tempBandId,
      dateRanges: rawRanges.map((range, rangeIndex) => strictDateRangeOf(range, rangeIndex)),
    })
  }

  const configuredBands = bands.filter(band => band.dateRanges.length)
  if (!configuredBands.length) throw new Error('至少需要配置一个温度段的日期范围')
  validateTempBandsContinuous(bands)
  validateFullYearCoverage(configuredBands)
  return {
    areaCode,
    tempBands: bands.map(band => ({ tempBandId: band.tempBandId, dateRanges: band.dateRanges })),
  }
}

function listParamsOf (query: ProductSettingSeasonListQuery = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 10, 'pageSize'),
  }
  for (const key of ['provinceCode', 'cityCode', 'districtCode'] as const) {
    const value = textOf(query[key]).trim()
    if (value) params[key] = requiredAreaCode(value, `${key}必须`)
  }
  return params
}

function removeBatchOf (value: unknown): ProductSettingSeasonRemoveBatchDraft {
  const source = objectOf(value, '批量删除参数')
  if (!Array.isArray(source.areaCodes) || source.areaCodes.length === 0) throw new Error('areaCodes不能为空')
  const areaCodes = [...new Set(source.areaCodes.map((areaCode, index) => requiredAreaCode(areaCode, `areaCodes[${index + 1}]`)))]
  if (areaCodes.length > 50) throw new Error('areaCodes最多支持50项')
  return { areaCodes }
}

export function createProductSettingSeasonCapability (request: PortalRequest) {
  return {
    async areaTree (): Promise<ProductSettingSeasonAreaNode[]> {
      return normalizeAreaTreeOf(await request({ url: AREA_TREE_URL, method: 'get' }))
    },

    async tempBandList (): Promise<ProductSettingSeasonTempBand[]> {
      return normalizeTempBandsOf(await request({
        url: `${TEMP_BAND_ROOT}/page`,
        method: 'get',
        params: { pageNo: 1, pageSize: 5, status: 1 },
      }))
    },

    async list (query: ProductSettingSeasonListQuery = {}): Promise<ProductSettingSeasonListPage> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },

    async get (input: { areaCode: string | number }): Promise<ProductSettingSeasonAreaConfig> {
      const areaCode = requiredAreaCode(input?.areaCode)
      return normalizeAreaTempConfigOf(await request({ url: `${ROOT}/get`, method: 'get', params: { areaCode } }))
    },

    prepareSave (form: ProductSettingSeasonSaveForm): { draft: ProductSettingSeasonSaveDraft } {
      return { draft: saveDraftOf(form) }
    },

    async save (input: { draft: ProductSettingSeasonSaveDraft }): Promise<true> {
      const draft = saveDraftOf(input?.draft)
      await request({ url: `${ROOT}/save`, method: 'put', data: draft })
      return true
    },

    prepareRemove (input: ProductSettingSeasonRemoveInput): ProductSettingSeasonRemoveDraft {
      return { areaCode: requiredAreaCode(input?.areaCode) }
    },

    async remove (input: ProductSettingSeasonRemoveDraft): Promise<true> {
      const areaCode = requiredAreaCode(input?.areaCode)
      await request({ url: `${ROOT}/delete`, method: 'delete', params: { areaCode } })
      return true
    },

    prepareRemoveBatch (input: ProductSettingSeasonRemoveBatchInput): ProductSettingSeasonRemoveBatchDraft {
      return removeBatchOf(input)
    },

    async removeBatch (input: ProductSettingSeasonRemoveBatchDraft): Promise<true> {
      const { areaCodes } = removeBatchOf(input)
      const query = areaCodes.map(areaCode => `areaCodes=${encodeURIComponent(areaCode)}`).join('&')
      await request({ url: `${ROOT}/delete-list?${query}`, method: 'delete' })
      return true
    },
  }
}

export type ProductSettingSeasonCapability = ReturnType<typeof createProductSettingSeasonCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const formParam: ParamSpec = { name: 'form', kind: 'text', required: true, description: '温度配置表单；省必选，市/区按层级选择，tempBands必须包含日期范围并覆盖全年' }
const draftParam: ParamSpec = { name: 'draft', kind: 'text', required: true, description: 'prepareSave返回的温度配置草稿；提交前不要改写' }

export const PRODUCT_SETTING_SEASON_METHODS = {
  'product-setting-season-area-tree': 'areaTree',
  'product-setting-season-temp-band-list': 'tempBandList',
  'product-setting-season-list': 'list',
  'product-setting-season-get': 'get',
  'product-setting-season-prepare-save': 'prepareSave',
  'product-setting-season-save': 'save',
  'product-setting-season-prepare-remove': 'prepareRemove',
  'product-setting-season-remove': 'remove',
  'product-setting-season-prepare-remove-batch': 'prepareRemoveBatch',
  'product-setting-season-remove-batch': 'removeBatch',
} as const

export const productSettingSeasonCapabilities: CapabilityDefinition[] = [
  { id: 'product-setting-season-area-tree', title: '查询温度配置地区树', write: false, params: [] },
  { id: 'product-setting-season-temp-band-list', title: '查询启用温度段', write: false, params: [] },
  { id: 'product-setting-season-list', title: '查询温度配置', write: false, params: [p('provinceCode', 'text', false, '省级行政区编码；省级筛选'), p('cityCode', 'text', false, '市级行政区编码；依赖provinceCode'), p('districtCode', 'text', false, '区县行政区编码；依赖cityCode'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '页面支持10、20、50；默认10')] },
  { id: 'product-setting-season-get', title: '查询温度配置详情', write: false, params: [p('areaCode', 'text', true, '六位行政区编码；来自列表记录')] },
  { id: 'product-setting-season-prepare-save', title: '准备保存温度配置', write: false, params: [formParam] },
  { id: 'product-setting-season-save', title: '保存温度配置', write: true, params: [draftParam] },
  { id: 'product-setting-season-prepare-remove', title: '准备删除温度配置', write: false, params: [p('areaCode', 'text', true, '六位行政区编码；来自列表记录')] },
  { id: 'product-setting-season-remove', title: '删除温度配置', write: true, params: [p('areaCode', 'text', true, 'prepareRemove返回的地区编码')] },
  { id: 'product-setting-season-prepare-remove-batch', title: '准备批量删除温度配置', write: false, params: [p('areaCodes', 'text', true, '待删除的六位行政区编码数组，最多50项')] },
  { id: 'product-setting-season-remove-batch', title: '批量删除温度配置', write: true, params: [p('areaCodes', 'text', true, 'prepareRemoveBatch返回的地区编码数组')] },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_SETTING_SEASON_PAGE_PATH,
  permission: PRODUCT_SETTING_SEASON_PERMISSION,
  moduleType: PRODUCT_SETTING_SEASON_MODULE_TYPE,
  httpInstance: 'platform',
}))
