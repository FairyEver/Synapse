import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

export type ProductProductionUsageId = string | number
export type ProductProductionUsageGroup = '1' | '2' | '3'

export type ProductProductionUsageQuery = {
  buildingList: ProductProductionUsageId[]
  startDate: string
  endDate: string
  timeGroup: ProductProductionUsageGroup | 1 | 2 | 3
  orgGroup: ProductProductionUsageGroup | 1 | 2 | 3
}

export type ProductProductionUsageTreeNode = Record<string, unknown> & {
  id: ProductProductionUsageId
  name?: string | null
  type?: number | string | null
  child: ProductProductionUsageTreeNode[]
}

export type ProductProductionUsageRow = Record<string, unknown> & {
  officeName: string | null
  farmName: string | null
  buildingName: string | null
  dateStr: string | null
  flockCount: number | string | null
  openingQty: number | string | null
  programCount: number | string | null
  dailyRecord: string | null
  weightRecord: string | null
  tibiaRecord: string | null
  inChickenCount: number | string | null
  transferCount: number | string | null
}

type JsonObject = Record<string, unknown>

export type ProductProductionUsageConfig = {
  treeType: '1' | '2'
  reportUrl: string
  reportLabel: string
  treeLabel: string
}

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ProductProductionUsageId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空组织ID`)
}

function idsOf (value: unknown): ProductProductionUsageId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('buildingList必须为非空组织ID数组')
  return value.map((item, index) => idOf(item, `buildingList[${index}]`))
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function nullableScalarOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、字符串或null`)
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

function groupOf (value: unknown, label: string): ProductProductionUsageGroup {
  const normalized = value === 1 || value === 2 || value === 3 ? String(value) : value
  if (normalized !== '1' && normalized !== '2' && normalized !== '3') throw new Error(`${label}只能是1、2或3`)
  return normalized
}

function rangeCount (start: string, end: string, group: ProductProductionUsageGroup): number {
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

function reportPayloadOf (value: unknown, config: ProductProductionUsageConfig): Record<string, unknown> {
  const query = objectOf(value, `${config.reportLabel}查询`) as Partial<ProductProductionUsageQuery>
  const buildingList = idsOf(query.buildingList)
  const startDate = dateOf(query.startDate, 'startDate')
  const endDate = dateOf(query.endDate, 'endDate')
  const timeGroup = groupOf(query.timeGroup, 'timeGroup')
  const orgGroup = groupOf(query.orgGroup, 'orgGroup')
  if (dayNumber(endDate) < dayNumber(startDate)) throw new Error('endDate不能早于startDate')

  const limits: Record<ProductProductionUsageGroup, { days: number; buildings: number }> = {
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
    menuName: '用户使用情况报表',
  }
}

function treeNodeOf (value: unknown, label: string): ProductProductionUsageTreeNode {
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

function treeOf (value: unknown, label: string): ProductProductionUsageTreeNode[] {
  if (value === undefined || value === null) return []
  const source = Array.isArray(value)
    ? value
    : (() => {
        const envelope = objectOf(value, `${label}组织树`)
        if (!Object.prototype.hasOwnProperty.call(envelope, 'tree') || envelope.tree === undefined || envelope.tree === null) {
          throw new Error(`${label}组织树必须包含tree数组`)
        }
        return envelope.tree
      })()
  if (!Array.isArray(source)) throw new Error(`${label}组织树必须是数组或包含tree数组的对象`)
  return source.map((item, index) => treeNodeOf(item, `${label}组织树[${index}]`))
}

function rowOf (value: unknown, index: number, label: string): ProductProductionUsageRow {
  const row = objectOf(value, `${label}列表[${index}]`)
  return {
    ...row,
    officeName: nullableTextOf(row.officeName, `${label}列表[${index}].officeName`),
    farmName: nullableTextOf(row.farmName, `${label}列表[${index}].farmName`),
    buildingName: nullableTextOf(row.buildingName, `${label}列表[${index}].buildingName`),
    dateStr: nullableTextOf(row.dateStr, `${label}列表[${index}].dateStr`),
    flockCount: nullableScalarOf(row.flockCount, `${label}列表[${index}].flockCount`),
    openingQty: nullableScalarOf(row.openingQty, `${label}列表[${index}].openingQty`),
    programCount: nullableScalarOf(row.programCount, `${label}列表[${index}].programCount`),
    dailyRecord: nullableTextOf(row.dailyRecord, `${label}列表[${index}].dailyRecord`),
    weightRecord: nullableTextOf(row.weightRecord, `${label}列表[${index}].weightRecord`),
    tibiaRecord: nullableTextOf(row.tibiaRecord, `${label}列表[${index}].tibiaRecord`),
    inChickenCount: nullableScalarOf(row.inChickenCount, `${label}列表[${index}].inChickenCount`),
    transferCount: nullableScalarOf(row.transferCount, `${label}列表[${index}].transferCount`),
  }
}

function rowsOf (value: unknown, label: string): ProductProductionUsageRow[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => rowOf(item, index, label))
}

export function createProductProductionUsageCapability (request: PortalRequest, config: ProductProductionUsageConfig) {
  return {
    async tree (): Promise<ProductProductionUsageTreeNode[]> {
      return treeOf(await request({ url: '/config/farm/getOfficeFarmBuildingTreeByTag', method: 'get', params: { types: config.treeType } }), config.treeLabel)
    },

    async list (query: ProductProductionUsageQuery): Promise<ProductProductionUsageRow[]> {
      return rowsOf(await request({ url: config.reportUrl, method: 'post', data: reportPayloadOf(query, config) }), config.reportLabel)
    },
  }
}

export type ProductProductionUsageCapability = ReturnType<typeof createProductProductionUsageCapability>

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

export function productProductionUsageCapabilities (options: {
  prefix: string
  title: string
  pagePath: string
  permission: string
}): CapabilityDefinition[] {
  return [
    { id: `${options.prefix}-tree`, title: `读取${options.title}组织树`, write: false, params: [] },
    {
      id: `${options.prefix}-list`,
      title: `查询${options.title}统计`,
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
    pagePath: options.pagePath,
    permission: options.permission,
    moduleType: null,
    httpInstance: 'product',
  }))
}
