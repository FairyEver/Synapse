import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「产品运营 → 使用分析 → 防疫功能使用分析」。 */
export const PRODUCT_PREVENTION_USAGE_ANALYSIS_PAGE_PATH = '/dashboard/product/operation/veterinarians/usage-analysis/list'
export const PRODUCT_PREVENTION_USAGE_ANALYSIS_PERMISSION = '/dashboard/frame/veterinarians/usage-analysis'
export const PRODUCT_PREVENTION_USAGE_ANALYSIS_MODULE_TYPE = 45

const TREE_URL = '/config/farm/getOfficeFarmBuildingTreeByTag'
const REPORT_URL = '/use/statistics/preventionUseSituation'
const MENU_NAME = '用户使用情况报表'

export type ProductPreventionUsageAnalysisId = string | number
export type ProductPreventionUsageAnalysisGroup = '1' | '2' | '3'

export type ProductPreventionUsageAnalysisQuery = {
  buildingList: ProductPreventionUsageAnalysisId[]
  startDate: string
  endDate: string
  timeGroup: ProductPreventionUsageAnalysisGroup | 1 | 2 | 3
  orgGroup: ProductPreventionUsageAnalysisGroup | 1 | 2 | 3
}

export type ProductPreventionUsageAnalysisTreeNode = Record<string, unknown> & {
  id: ProductPreventionUsageAnalysisId
  name?: string | null
  type?: number | string | null
  child: ProductPreventionUsageAnalysisTreeNode[]
}

export type ProductPreventionUsageAnalysisRow = Record<string, unknown> & {
  officeName: string | null
  farmName: string | null
  buildingName: string | null
  dateStr: string | null
  whiteDysentery: string | null
  necropsyRecord: string | null
  necropsyImage: string | null
  auscultation: string | null
  other: string | null
  microorganismSubmit: string | null
  microorganismAssay: string | null
  antibodySubmit: string | null
  antibodyAssay: string | null
  etiologySubmit: string | null
  etiologyAssay: string | null
  immunity: string | null
  medication: string | null
  disinfection: string | null
  diagnosis: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductPreventionUsageAnalysisId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空组织ID`)
}

function idsOf (value: unknown): ProductPreventionUsageAnalysisId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('buildingList必须为非空组织ID数组')
  return value.map((item, index) => idOf(item, `buildingList[${index}]`))
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableTreeTypeOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为整数、字符串或null`)
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function dayNumber (value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000
}

function groupOf (value: unknown, label: string): ProductPreventionUsageAnalysisGroup {
  const normalized = value === 1 || value === 2 || value === 3 ? String(value) : value
  if (normalized !== '1' && normalized !== '2' && normalized !== '3') throw new Error(`${label}只能是1、2或3`)
  return normalized
}

function rangeCount (start: string, end: string, group: ProductPreventionUsageAnalysisGroup): number {
  if (group === '1') return dayNumber(end) - dayNumber(start) + 1
  if (group === '2') {
    const startDate = new Date(`${start}T00:00:00Z`)
    const mondayOffset = (startDate.getUTCDay() + 6) % 7
    const firstMonday = dayNumber(start) - mondayOffset
    return Math.floor((dayNumber(end) - firstMonday) / 7) + 1
  }
  const startDate = new Date(`${start}T00:00:00Z`)
  const endDate = new Date(`${end}T00:00:00Z`)
  return (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + endDate.getUTCMonth() - startDate.getUTCMonth() + 1
}

function reportPayloadOf (value: unknown): Record<string, unknown> {
  const query = objectOf(value, '防疫功能使用分析查询') as Partial<ProductPreventionUsageAnalysisQuery>
  const buildingList = idsOf(query.buildingList)
  const startDate = dateOf(query.startDate, 'startDate')
  const endDate = dateOf(query.endDate, 'endDate')
  const timeGroup = groupOf(query.timeGroup, 'timeGroup')
  const orgGroup = groupOf(query.orgGroup, 'orgGroup')
  if (dayNumber(endDate) < dayNumber(startDate)) throw new Error('endDate不能早于startDate')

  const limits: Record<ProductPreventionUsageAnalysisGroup, { days: number; buildings: number }> = {
    '1': { days: 366, buildings: 100 },
    '2': { days: 1096, buildings: 200 },
    '3': { days: 1827, buildings: 300 },
  }
  const limit = limits[timeGroup]
  const dateSpan = dayNumber(endDate) - dayNumber(startDate) + 1
  if (dateSpan > limit.days) throw new Error(`当前时间分组查询日期不能超过${limit.days}天`)
  if (buildingList.length > limit.buildings) throw new Error(`当前时间分组最多选择${limit.buildings}个栋舍`)
  if (buildingList.length * rangeCount(startDate, endDate, timeGroup) > 10_000) throw new Error('预计统计数据量不能超过10000条')

  return {
    buildingList,
    startDate,
    endDate,
    timeGroup,
    orgGroup,
    scope: 1,
    menuName: MENU_NAME,
  }
}

function treeNodeOf (value: unknown, label: string): ProductPreventionUsageAnalysisTreeNode {
  const node = objectOf(value, label)
  const children = node.child === undefined || node.child === null ? [] : node.child
  if (!Array.isArray(children)) throw new Error(`${label}.child必须为数组或null`)
  return {
    ...node,
    id: idOf(node.id, `${label}.id`),
    name: nullableTextOf(node.name, `${label}.name`),
    type: nullableTreeTypeOf(node.type, `${label}.type`),
    child: children.map((item, index) => treeNodeOf(item, `${label}.child[${index}]`)),
  }
}

function treeOf (value: unknown): ProductPreventionUsageAnalysisTreeNode[] {
  if (value === undefined || value === null) return []
  const source = Array.isArray(value)
    ? value
    : (() => {
        const envelope = objectOf(value, '防疫功能使用分析组织树')
        if (!Object.prototype.hasOwnProperty.call(envelope, 'tree') || envelope.tree === undefined || envelope.tree === null) {
          throw new Error('防疫功能使用分析组织树必须包含tree数组')
        }
        return envelope.tree
      })()
  if (!Array.isArray(source)) throw new Error('防疫功能使用分析组织树必须是数组或包含tree数组的对象')
  return source.map((item, index) => treeNodeOf(item, `防疫功能使用分析组织树[${index}]`))
}

function rowOf (value: unknown, index: number): ProductPreventionUsageAnalysisRow {
  const row = objectOf(value, `防疫功能使用分析列表[${index}]`)
  return {
    ...row,
    officeName: nullableTextOf(row.officeName, `防疫功能使用分析列表[${index}].officeName`),
    farmName: nullableTextOf(row.farmName, `防疫功能使用分析列表[${index}].farmName`),
    buildingName: nullableTextOf(row.buildingName, `防疫功能使用分析列表[${index}].buildingName`),
    dateStr: nullableTextOf(row.dateStr, `防疫功能使用分析列表[${index}].dateStr`),
    whiteDysentery: nullableTextOf(row.whiteDysentery, `防疫功能使用分析列表[${index}].whiteDysentery`),
    necropsyRecord: nullableTextOf(row.necropsyRecord, `防疫功能使用分析列表[${index}].necropsyRecord`),
    necropsyImage: nullableTextOf(row.necropsyImage, `防疫功能使用分析列表[${index}].necropsyImage`),
    auscultation: nullableTextOf(row.auscultation, `防疫功能使用分析列表[${index}].auscultation`),
    other: nullableTextOf(row.other, `防疫功能使用分析列表[${index}].other`),
    microorganismSubmit: nullableTextOf(row.microorganismSubmit, `防疫功能使用分析列表[${index}].microorganismSubmit`),
    microorganismAssay: nullableTextOf(row.microorganismAssay, `防疫功能使用分析列表[${index}].microorganismAssay`),
    antibodySubmit: nullableTextOf(row.antibodySubmit, `防疫功能使用分析列表[${index}].antibodySubmit`),
    antibodyAssay: nullableTextOf(row.antibodyAssay, `防疫功能使用分析列表[${index}].antibodyAssay`),
    etiologySubmit: nullableTextOf(row.etiologySubmit, `防疫功能使用分析列表[${index}].etiologySubmit`),
    etiologyAssay: nullableTextOf(row.etiologyAssay, `防疫功能使用分析列表[${index}].etiologyAssay`),
    immunity: nullableTextOf(row.immunity, `防疫功能使用分析列表[${index}].immunity`),
    medication: nullableTextOf(row.medication, `防疫功能使用分析列表[${index}].medication`),
    disinfection: nullableTextOf(row.disinfection, `防疫功能使用分析列表[${index}].disinfection`),
    diagnosis: nullableTextOf(row.diagnosis, `防疫功能使用分析列表[${index}].diagnosis`),
  }
}

function rowsOf (value: unknown): ProductPreventionUsageAnalysisRow[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('防疫功能使用分析响应必须是数组')
  return value.map(rowOf)
}

export function createProductPreventionUsageAnalysisCapability (request: PortalRequest) {
  return {
    async tree (): Promise<ProductPreventionUsageAnalysisTreeNode[]> {
      return treeOf(await request({ url: TREE_URL, method: 'get', params: { types: '1,2' } }))
    },

    async list (query: ProductPreventionUsageAnalysisQuery): Promise<ProductPreventionUsageAnalysisRow[]> {
      return rowsOf(await request({ url: REPORT_URL, method: 'post', data: reportPayloadOf(query) }))
    },
  }
}

export type ProductPreventionUsageAnalysisCapability = ReturnType<typeof createProductPreventionUsageAnalysisCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const groupOptions = [
  { label: '按天', value: '1' },
  { label: '按周', value: '2' },
  { label: '按月', value: '3' },
]
const orgOptions = [
  { label: '按公司', value: '1' },
  { label: '按场区', value: '2' },
  { label: '按栋号', value: '3' },
]

export const PRODUCT_PREVENTION_USAGE_ANALYSIS_METHODS = {
  'product-prevention-usage-analysis-tree': 'tree',
  'product-prevention-usage-analysis-list': 'list',
} as const

export const productPreventionUsageAnalysisCapabilities: CapabilityDefinition[] = [
  {
    id: 'product-prevention-usage-analysis-tree',
    title: '读取防疫功能使用分析组织树',
    write: false,
    params: [],
  },
  {
    id: 'product-prevention-usage-analysis-list',
    title: '查询防疫功能使用分析统计',
    write: false,
    params: [
      p('buildingList', 'tree', true, '组织树中选中的栋舍ID数组；页面最终只提交type=4或叶节点ID'),
      p('startDate', 'date', true, '开始日期，格式YYYY-MM-DD'),
      p('endDate', 'date', true, '结束日期，格式YYYY-MM-DD且不能早于开始日期'),
      { ...p('timeGroup', 'enum', true, '时间分组：1按天、2按周、3按月'), options: groupOptions },
      { ...p('orgGroup', 'enum', true, '组织分组：1按公司、2按场区、3按栋号'), options: orgOptions },
    ],
  },
].map(definition => ({
  ...definition,
  pagePath: PRODUCT_PREVENTION_USAGE_ANALYSIS_PAGE_PATH,
  permission: PRODUCT_PREVENTION_USAGE_ANALYSIS_PERMISSION,
  moduleType: PRODUCT_PREVENTION_USAGE_ANALYSIS_MODULE_TYPE,
  httpInstance: 'product',
}))
