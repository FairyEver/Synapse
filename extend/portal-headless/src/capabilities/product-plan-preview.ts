import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 生产设置 → 养殖预案 → 预案预览-新」。 */
export const PRODUCT_PLAN_PREVIEW_PAGE_PATH = '/dashboard/product/setting/plan-preview/list'
export const PRODUCT_PLAN_PREVIEW_PERMISSION = '/dashboard/frame/breeding-plan-new/preview'
export const PRODUCT_PLAN_PREVIEW_MODULE_TYPE = null
export const PRODUCT_PLAN_PREVIEW_URL = '/flockSimu/rearingPlan/preview/get'

/** 地区树由温度配置-新页面的公共能力登记，本页不重复暴露。 */
export const PRODUCT_PLAN_PREVIEW_AREA_TREE_CAPABILITY_ID = 'product-setting-season-area-tree'

export type ProductPlanPreviewQuery = {
  generation: string
  variety: string
  provinceCode: string
  cityCode?: string | null
  districtCode?: string | null
  region?: string | null
  entryDate: string
  dayAge?: number | string | null
}

export type ProductPlanPreviewVideo = Record<string, unknown> & {
  id?: string | number | null
  fileUrl?: string | null
  videoId?: string | number | null
  videoName?: string | null
  videoImg?: string | null
  title?: string | null
  duration?: string | number | null
  type?: string | number | null
  tag?: string | null
}

export type ProductPlanPreviewItem = Record<string, unknown> & {
  videoList?: ProductPlanPreviewVideo[]
}

export type ProductPlanPreviewSection = Record<string, unknown> & {
  programIndexList: ProductPlanPreviewItem[]
  programPointList: ProductPlanPreviewItem[]
  programKeyPointList: ProductPlanPreviewItem[]
}

export type ProductPlanPreviewDay = Record<string, unknown> & {
  delFlag?: number | null
  age?: number | null
  feed: ProductPlanPreviewSection
  nutrition: ProductPlanPreviewSection
  prevention: ProductPlanPreviewSection
}

export type ProductPlanPreviewResult = Record<string, unknown> & {
  list: ProductPlanPreviewDay[]
}

type JsonObject = Record<string, unknown>

function textOf (value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  const text = textOf(value)
  if (!text) throw new Error(`${label}不能为空`)
  if (text.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return text
}

function optionalTextOf (value: unknown, label: string, maxLength: number): string {
  const text = textOf(value)
  if (text.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return text
}

function areaCodeOf (query: ProductPlanPreviewQuery): string {
  const provinceCode = optionalTextOf(query.provinceCode, '省行政区编码', 32)
  const cityCode = optionalTextOf(query.cityCode, '市行政区编码', 32)
  const districtCode = optionalTextOf(query.districtCode, '区县行政区编码', 32)
  if (cityCode && !provinceCode) throw new Error('选择市前必须先选择省')
  if (districtCode && !cityCode) throw new Error('选择区前必须先选择市')
  for (const [label, code] of [['省行政区编码', provinceCode], ['市行政区编码', cityCode], ['区县行政区编码', districtCode]] as const) {
    if (code && !/^\d{6}$/.test(code)) throw new Error(`${label}必须是6位数字`)
  }
  const areaCode = districtCode || cityCode || provinceCode
  if (!/^\d{6}$/.test(areaCode)) throw new Error('行政区编码必须是6位数字')
  return areaCode
}

function entryDateOf (value: unknown): string {
  const date = requiredTextOf(value, '进鸡日期', 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error('进鸡日期必须是YYYY-MM-DD格式')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!) {
    throw new Error('进鸡日期不是有效日期')
  }
  return date
}

function dayAgeOf (value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const dayAge = Number(value)
  if (!Number.isSafeInteger(dayAge)) throw new Error('日龄必须是整数')
  if (dayAge === 0) throw new Error('日龄不能为0')
  if (dayAge !== -1 && (dayAge < 1 || dayAge > 700)) {
    throw new Error('日龄必须是-1或1至700')
  }
  return dayAge
}

export function buildProductPlanPreviewParams (query: ProductPlanPreviewQuery): Record<string, unknown> {
  const generation = requiredTextOf(query.generation, '代次', 64)
  const variety = requiredTextOf(query.variety, '品种', 64)
  const areaCode = areaCodeOf(query)
  const entryDate = entryDateOf(query.entryDate)
  const params: Record<string, unknown> = { generation, areaCode, entryDate, variety }
  const region = optionalTextOf(query.region, '进鸡地区', 64)
  if (region) params.region = region
  const dayAge = dayAgeOf(query.dayAge)
  if (dayAge !== undefined) params.dayAge = dayAge
  return params
}

function getPayload (result: unknown): unknown {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return (result as JsonObject).data
  }
  return result
}

function getArray (source: unknown, keys: readonly string[] = []): unknown[] {
  if (Array.isArray(source)) return source
  if (source && typeof source === 'object') {
    for (const key of keys) {
      const candidate = (source as JsonObject)[key]
      if (Array.isArray(candidate)) return candidate
    }
  }
  return []
}

function objectOf (value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {}
}

function normalizePreviewSection (section: unknown): ProductPlanPreviewSection {
  const source = objectOf(section)
  return {
    ...source,
    programIndexList: getArray(source, ['programIndexList']) as ProductPlanPreviewItem[],
    programPointList: getArray(source, ['programPointList']).map(item => ({
      ...objectOf(item),
      videoList: getArray(objectOf(item), ['videoList']) as ProductPlanPreviewVideo[],
    })),
    programKeyPointList: getArray(source, ['programKeyPointList']) as ProductPlanPreviewItem[],
  }
}

/** 按Portal utils.js的data/list/三类预案数组规则归一响应；不丢弃程序库扩展字段。 */
export function normalizeProductPlanPreview (result: unknown): ProductPlanPreviewResult {
  const payload = getPayload(result)
  const source = objectOf(payload)
  return {
    ...source,
    list: getArray(source, ['list']).map(item => {
      const day = objectOf(item)
      return {
        ...day,
        feed: normalizePreviewSection(day.feed),
        nutrition: normalizePreviewSection(day.nutrition),
        prevention: normalizePreviewSection(day.prevention),
      }
    }),
  }
}

export function createProductPlanPreviewCapability (request: PortalRequest) {
  return {
    async preview (query: ProductPlanPreviewQuery = {} as ProductPlanPreviewQuery): Promise<ProductPlanPreviewResult> {
      const params = buildProductPlanPreviewParams(query)
      const result = await request<unknown>({ url: PRODUCT_PLAN_PREVIEW_URL, method: 'get', params })
      return normalizeProductPlanPreview(result)
    },
  }
}

export type ProductPlanPreviewCapability = ReturnType<typeof createProductPlanPreviewCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const PRODUCT_PLAN_PREVIEW_METHODS = {
  'product-plan-preview-preview': 'preview',
} as const

export const productPlanPreviewCapabilities: CapabilityDefinition[] = [
  {
    id: 'product-plan-preview-preview',
    title: '查询预案预览',
    write: false,
    params: [
      p('generation', 'text', true, '代次字典值；来自Portal代次选择器，不能为空且最多64个字符'),
      p('variety', 'text', true, '品种字典值；来自Portal品种选择器，不能为空且最多64个字符'),
      p('provinceCode', 'tree', true, '省行政区编码；来自公共地区树，六位数字'),
      p('cityCode', 'tree', false, '市行政区编码；省变更时Portal清空它和区县，省级查询可省略'),
      p('districtCode', 'tree', false, '区县行政区编码；市变更时Portal清空它，最终优先作为areaCode'),
      p('entryDate', 'date', true, '进鸡日期；格式YYYY-MM-DD'),
      p('region', 'text', false, '地区名称回显文本；Portal从地区树拼成省 / 市 / 区，空值时不发送'),
      p('dayAge', 'number', false, '日龄切换值；只允许-1（空舍）或1至700，0和其它负数不允许'),
    ],
    pagePath: PRODUCT_PLAN_PREVIEW_PAGE_PATH,
    permission: PRODUCT_PLAN_PREVIEW_PERMISSION,
    moduleType: PRODUCT_PLAN_PREVIEW_MODULE_TYPE,
    httpInstance: 'platform',
  },
]
