import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 组织管理 → 调入计划」列表页及其实际可达的详情动作。 */
export const HR_TRANSFER_IN_PLAN_PAGE_PATH = '/dashboard/org/transfer-in-plan/list'
export const HR_TRANSFER_IN_PLAN_PERMISSION = '/dashboard/org/transfer-in-plan'
export const HR_TRANSFER_IN_PLAN_MODULE_TYPE = 11

const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'
const PLAN_PAGE_URL = '/hr/recruitment-plan/page'
const POST_URL = '/org/hrpost'
const DETAIL_PATH = '/dashboard/org/transfer-in-plan/detail'
const RESUME_PATH = '/dashboard/staff/recruitment-plan/resume'

export type HrTransferInPlanId = string | number
export type HrTransferInPlanYear = string | number

export type HrTransferInPlanOrganizationNode = Record<string, unknown> & {
  id: HrTransferInPlanId
  pid?: HrTransferInPlanId | null
  name?: string | null
  fullPath?: string | null
  children?: HrTransferInPlanOrganizationNode[]
}

export type HrTransferInPlanRow = Record<string, unknown> & {
  id: HrTransferInPlanId
  title?: string | null
  recruitmentType?: number | null
  recruitmentTypeName?: string | null
  planYear?: number | null
  organizationId?: HrTransferInPlanId | null
  organizationName?: string | null
  organizationFullPath?: string | null
  postId?: HrTransferInPlanId | null
  postName?: string | null
  postTypeName?: string | null
  planNumber?: number | null
  purpose?: string | null
  requirementText?: string | null
  salaryLevelMin?: HrTransferInPlanId | null
  salaryLevelMax?: HrTransferInPlanId | null
  salaryRangeName?: string | null
  urgency?: string | null
  arrivalDate?: string | null
  remark?: string | null
  status?: number | null
  statusName?: string | null
  processInstanceId?: string | null
  creator?: HrTransferInPlanId | null
  createTime?: string | null
  updater?: HrTransferInPlanId | null
  updateTime?: string | null
}

/** 岗位接口的原始 DTO；不要把 Portal 模板使用的别名改写成另一套字段。 */
export type HrTransferInPlanPostRequirement = Record<string, unknown> & {
  id?: HrTransferInPlanId | null
  name?: string | null
  status?: number | null
  isDel?: number | null
  gender?: number | null
  salaryLevelMin?: HrTransferInPlanId | null
  salaryLevelMax?: HrTransferInPlanId | null
  postType?: HrTransferInPlanId[] | null
  postTypeName?: string | null
  postTypeNameList?: string[] | null
  postAssignment?: string | null
  educationalRequirement?: string | null
  experienceRequirement?: string | null
  abilityRequirement?: string | null
  remark?: string | null
}

export type HrTransferInPlanRoute = { path: string }

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}响应必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HrTransferInPlanId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): HrTransferInPlanId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function yearOf (value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback
  if (value === null || value === '') return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1000 && value <= 9999) return String(value)
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return value
  throw new Error('planYear必须为YYYY年份或null')
}

function pageOf<T> (value: unknown, label: string): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) {
    throw new Error(`${label}缺少有效list或total`)
  }
  return { list: page.list as T[], total: page.total as number }
}

function listOf<T> (value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value as T[]
}

function routeIdOf (value: unknown, label: string): string {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return '0'
  return String(idOf(value, label))
}

function optionalRouteIdOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null
  return String(idOf(value, label))
}

function postRequirementOf (value: unknown): HrTransferInPlanPostRequirement {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as HrTransferInPlanPostRequirement
}

export function createHrTransferInPlanCapability (request: PortalRequest) {
  return {
    async organizationTree (): Promise<HrTransferInPlanOrganizationNode[]> {
      return listOf<HrTransferInPlanOrganizationNode>(await request({ url: ORGANIZATION_TREE_URL, method: 'get' }), '调入计划组织树')
    },

    async overview (): Promise<PageResult<HrTransferInPlanRow>> {
      const planYear = String(new Date().getFullYear())
      return pageOf<HrTransferInPlanRow>(await request({
        url: PLAN_PAGE_URL,
        method: 'get',
        params: { pageNo: 1, pageSize: 1000, status: 2, planYear },
      }), '调入计划概览分页响应')
    },

    async detail (input: { organizationId?: HrTransferInPlanId | null; planYear?: HrTransferInPlanYear | null } = {}): Promise<PageResult<HrTransferInPlanRow>> {
      const planYear = yearOf(input?.planYear, String(new Date().getFullYear()))
      return pageOf<HrTransferInPlanRow>(await request({
        url: PLAN_PAGE_URL,
        method: 'get',
        params: {
          pageNo: 1,
          pageSize: 1000,
          status: 2,
          organizationId: optionalIdOf(input?.organizationId, 'organizationId'),
          planYear,
        },
      }), '调入计划详情分页响应')
    },

    async postRequirement (input: { postId?: HrTransferInPlanId | null } = {}): Promise<HrTransferInPlanPostRequirement> {
      const postId = optionalIdOf(input?.postId, 'postId')
      if (postId === null) return {}
      return postRequirementOf(await request({ url: `${POST_URL}/${postId}`, method: 'get' }))
    },

    prepareDetail (input: { id?: HrTransferInPlanId | null } = {}): HrTransferInPlanRoute {
      return { path: `${DETAIL_PATH}/${routeIdOf(input?.id, 'id')}` }
    },

    prepareResume (input: { id?: HrTransferInPlanId | null } = {}): HrTransferInPlanRoute | null {
      const id = optionalRouteIdOf(input?.id, 'id')
      return id === null ? null : { path: `${RESUME_PATH}/${id}` }
    },
  }
}

export type HrTransferInPlanCapability = ReturnType<typeof createHrTransferInPlanCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })

export const HR_TRANSFER_IN_PLAN_METHODS = {
  'hr-transfer-in-plan-organization-tree': 'organizationTree',
  'hr-transfer-in-plan-overview': 'overview',
  'hr-transfer-in-plan-detail': 'detail',
  'hr-transfer-in-plan-post-requirement': 'postRequirement',
  'hr-transfer-in-plan-prepare-detail': 'prepareDetail',
  'hr-transfer-in-plan-prepare-resume': 'prepareResume',
} as const

export const hrTransferInPlanCapabilities: CapabilityDefinition[] = [
  { id: 'hr-transfer-in-plan-organization-tree', title: '读取调入计划有权限组织树', write: false, params: [] },
  { id: 'hr-transfer-in-plan-overview', title: '读取调入计划年度概览', write: false, params: [] },
  { id: 'hr-transfer-in-plan-detail', title: '按组织和年度读取已审批调入计划', write: false, params: [p('organizationId', 'tree', false, '详情页当前组织；省略或null表示Portal的0根路由对应的不限组织查询'), p('planYear', 'date', false, '四位年份YYYY；省略按当前年，显式null复现清空年份后的请求')] },
  { id: 'hr-transfer-in-plan-post-requirement', title: '读取调入计划岗位任职要求原始数据', write: false, params: [p('postId', 'search', false, '详情行的postId；缺失时Portal只展示计划自身的兜底文本')] },
  { id: 'hr-transfer-in-plan-prepare-detail', title: '准备打开调入计划详情页', write: false, params: [p('id', 'tree', false, '当前组织节点ID；省略时与Portal整体情况按钮一致，路由使用0')] },
  { id: 'hr-transfer-in-plan-prepare-resume', title: '准备打开招聘计划简历库', write: false, params: [p('id', 'search', false, '详情行招聘计划ID；缺失时Portal不跳转并返回null')] },
].map(definition => ({
  ...definition,
  pagePath: HR_TRANSFER_IN_PLAN_PAGE_PATH,
  permission: HR_TRANSFER_IN_PLAN_PERMISSION,
  moduleType: HR_TRANSFER_IN_PLAN_MODULE_TYPE,
  httpInstance: 'platform' as const,
}))
