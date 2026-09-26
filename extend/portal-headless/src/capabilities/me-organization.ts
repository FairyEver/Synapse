import type { PortalRequest } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 组织管理 → 组织信息」个人页面及其可达的组织统计查询。 */
export const ME_ORGANIZATION_PAGE_PATH = '/dashboard/me/organization/list'
export const ME_ORGANIZATION_PERMISSION = '/dashboard/me/organization/list'
export const ME_ORGANIZATION_MODULE_TYPE = 11

const STAFF_ROOT = '/org/staff'
const ORGANIZATION_ROOT = '/org/organization'
const DUTY_URL = '/org/hrduty/all'

export type MeOrganizationId = string | number

export type MeOrganizationBaseInfoItem = Record<string, unknown> & {
  key: string
  value: string
}

export type MeOrganizationStaffBaseInfo = Record<string, unknown> & {
  name: string | null
  staffCode: MeOrganizationId | null
  post: MeOrganizationId | null
  postName: string | null
  headImg: string | null
  organization: MeOrganizationId | null
  organizationName: string | null
  leader: MeOrganizationId | null
  leaderName: string | null
  salaryLevel: MeOrganizationId | null
  salaryStructure: MeOrganizationId | null
  salaryLevelName: string | null
  salaryStructureName: string | null
  employmentType: string | null
  entrySeniority: number | null
  baseInfo: MeOrganizationBaseInfoItem[]
  totalScore: number | null
  userId: MeOrganizationId | null
}

export type MeOrganizationNode = Record<string, unknown> & {
  id: MeOrganizationId
  pid?: MeOrganizationId | null
  name?: string | null
  code?: string | null
  fullPath?: string | null
  level?: number | null
  status?: number | null
  children?: MeOrganizationNode[] | null
}

export type MeOrganizationDuty = Record<string, unknown> & {
  id: MeOrganizationId
  dutyName: string | null
  dutyLevelId?: string | null
  isDel?: number | null
}

export type MeOrganizationChartPoint = Record<string, unknown> & {
  x: string | null
  y: number | null
  z?: string | null
}

export type MeOrganizationChartLine = Record<string, unknown> & {
  mark: string | null
  points: MeOrganizationChartPoint[]
}

export type MeOrganizationChart = Record<string, unknown> & {
  title: string | null
  unit: string | null
  lineData: MeOrganizationChartLine[]
}

export type MeOrganizationStatisticsQuery = {
  orgId: MeOrganizationId
  standardUnit?: string | null
  dutyId?: MeOrganizationId | '' | null
}

export type MeOrganizationEmployeeStatisticsQuery = {
  orgId: MeOrganizationId
  date: string
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): MeOrganizationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function dateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    throw new Error(`${label}必须为YYYY-MM-DD`)
  }
  const parts = value.split('-').map(Number)
  const year = parts[0]!
  const month = parts[1]!
  const day = parts[2]!
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`)
  }
  return value
}

function standardUnitOf (value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('standardUnit必须为字符串或null')
  return value
}

function optionalDutyIdOf (value: unknown): MeOrganizationId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, 'dutyId')
}

function listOf<T> (value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value as T[]
}

function chartListOf (value: unknown, label: string): MeOrganizationChart[] {
  return listOf<Record<string, unknown>>(value, label).map((item, index) => {
    objectOf(item, `${label}[${index}]`)
    return item as MeOrganizationChart
  })
}

function baseInfoOf (value: unknown): MeOrganizationStaffBaseInfo {
  return objectOf(value, '员工基本信息') as MeOrganizationStaffBaseInfo
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const commonDefinitions: Array<{ id: string; title: string; params: ParamSpec[] }> = [
  { id: 'me-organization-direct-org-list', title: '查询当前用户所辖组织', params: [] },
  { id: 'me-organization-staff-base-info', title: '读取当前用户员工基本信息', params: [] },
  { id: 'me-organization-organization-tree', title: '查询当前用户可见的角色组织树', params: [] },
  { id: 'me-organization-duty-options', title: '查询组织统计可选职务', params: [] },
  {
    id: 'me-organization-establishment-chart',
    title: '查询组织编制统计图表',
    params: [p('orgId', 'tree', true, '组织ID；来自员工基本信息organization或组织树节点id')],
  },
  {
    id: 'me-organization-employee-statistics',
    title: '查询组织员工统计小结',
    params: [
      p('orgId', 'tree', true, '组织ID；来自员工基本信息organization或组织树节点id'),
      p('date', 'date', true, '统计日期，格式YYYY-MM-DD；Portal月份选择器实际提交该格式'),
    ],
  },
  {
    id: 'me-organization-organization-statistics',
    title: '查询组织员工分布统计',
    params: [
      p('orgId', 'tree', true, '组织ID；来自员工基本信息organization或组织树节点id'),
      p('standardUnit', 'text', false, '标准单元字典值；清空时发送空字符串'),
      p('dutyId', 'number', false, '职务ID；清空时发送空字符串'),
    ],
  },
]

export const meOrganizationCapabilities: CapabilityDefinition[] = commonDefinitions.map(definition => ({
  ...definition,
  write: false,
  pagePath: ME_ORGANIZATION_PAGE_PATH,
  permission: ME_ORGANIZATION_PERMISSION,
  moduleType: ME_ORGANIZATION_MODULE_TYPE,
  httpInstance: 'platform',
}))

export const ME_ORGANIZATION_METHODS = {
  'me-organization-direct-org-list': 'listDirectOrganizations',
  'me-organization-staff-base-info': 'getStaffBaseInfo',
  'me-organization-organization-tree': 'organizationTree',
  'me-organization-duty-options': 'dutyOptions',
  'me-organization-establishment-chart': 'getEstablishmentChart',
  'me-organization-employee-statistics': 'getEmployeeStatistics',
  'me-organization-organization-statistics': 'getOrganizationStatistics',
} as const

export function createMeOrganizationCapability (request: PortalRequest) {
  return {
    async listDirectOrganizations (): Promise<MeOrganizationNode[]> {
      return listOf<MeOrganizationNode>(await request({ url: `${ORGANIZATION_ROOT}/getAllDirectOrgList`, method: 'get' }), '所辖组织')
    },

    async getStaffBaseInfo (): Promise<MeOrganizationStaffBaseInfo> {
      return baseInfoOf(await request({ url: `${STAFF_ROOT}/getStaffBaseInfo`, method: 'get' }))
    },

    async organizationTree (): Promise<MeOrganizationNode[]> {
      return listOf<MeOrganizationNode>(await request({ url: `${ORGANIZATION_ROOT}/getRoleOrganizationTree`, method: 'get' }), '角色组织树')
    },

    async dutyOptions (): Promise<MeOrganizationDuty[]> {
      return listOf<MeOrganizationDuty>(await request({ url: DUTY_URL, method: 'get' }), '职务候选')
    },

    async getEstablishmentChart (input: { orgId: MeOrganizationId }): Promise<MeOrganizationChart[]> {
      const orgId = idOf(input?.orgId, 'orgId')
      return chartListOf(await request({ url: `${ORGANIZATION_ROOT}/getDirectOrgPostNumber`, method: 'get', params: { orgId } }), '编制统计图表')
    },

    async getEmployeeStatistics (input: MeOrganizationEmployeeStatisticsQuery): Promise<MeOrganizationChart[]> {
      const orgId = idOf(input?.orgId, 'orgId')
      const date = dateOf(input?.date, 'date')
      return chartListOf(await request({ url: `${ORGANIZATION_ROOT}/getDirectOrgStaff`, method: 'get', params: { date, orgId } }), '员工统计小结')
    },

    async getOrganizationStatistics (input: MeOrganizationStatisticsQuery): Promise<MeOrganizationChart[]> {
      const orgId = idOf(input?.orgId, 'orgId')
      const dutyId = optionalDutyIdOf(input?.dutyId)
      const standardUnit = standardUnitOf(input?.standardUnit)
      return chartListOf(await request({ url: `${ORGANIZATION_ROOT}/getDirectOrgInfoV2`, method: 'get', params: { orgId, dutyId, standardUnit } }), '组织员工统计')
    },
  }
}

export type MeOrganizationCapability = ReturnType<typeof createMeOrganizationCapability>
