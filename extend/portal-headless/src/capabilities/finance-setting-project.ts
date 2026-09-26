import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** 门户系统：财务设置 / 项目管理；静态锚点 frontend d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_PROJECT_PAGE_PATH = '/dashboard/finance/setting/project/list'
const ROOT = '/admin-api/finance/project'
const USER_SEARCH_URL = '/admin-api/sys/user/getUserBasicInfoPage'
const ORGANIZATION_TREE_URL = '/admin-api/org/organization/getRoleOrganizationTreeNew'

export type FinanceSettingProjectId = string | number
export type FinanceSettingProjectStatus = 0 | 1
export type FinanceSettingProjectType = 1 | 2 | 3
export type FinanceSettingProjectAttribute = 1 | 2 | 3
export type FinanceSettingProjectStageCode = 1 | 2

export type FinanceSettingProjectStage = {
  id?: FinanceSettingProjectId
  stage: number
  stageName?: string | null
  startDate: string | null
  endDate: string | null
}

export type FinanceSettingProjectRow = {
  id: FinanceSettingProjectId
  projectName: string | null
  projectCode: string | null
  projectType: number | null
  projectAttribute: number | null
  companyId: FinanceSettingProjectId | null
  companyName: string | null
  principalStaffId: FinanceSettingProjectId | null
  principalStaffNo: string | null
  principalName: string | null
  status: FinanceSettingProjectStatus
  createTime: string | null
  stages: FinanceSettingProjectStage[]
  /** 固定前端列表列声明了updateTime，但当前Java Response VO未声明该字段。 */
  updateTime?: string | null
}

export type FinanceSettingProjectDetail = FinanceSettingProjectRow

export type FinanceSettingProjectQuery = {
  projectName?: string | null
  projectCode?: string | null
  projectTypes?: number[]
  projectAttributes?: number[]
  stages?: number[]
  companyIds?: FinanceSettingProjectId[] | null
  principalName?: string | null
  status?: FinanceSettingProjectStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingProjectCreateDraft = {
  id?: FinanceSettingProjectId | ''
  projectName: string
  projectCode: string
  projectType: FinanceSettingProjectType
  projectAttribute: FinanceSettingProjectAttribute
  companyId?: FinanceSettingProjectId | null
  companyName?: string
  principalStaffId: FinanceSettingProjectId
  principalStaffNo?: string
  principalName?: string
  status?: FinanceSettingProjectStatus
  stages?: FinanceSettingProjectStage[]
}

export type FinanceSettingProjectSaveDraft = {
  id: FinanceSettingProjectId
  projectName: string
  projectCode: string
  projectType: number
  projectAttribute: number
  companyId: FinanceSettingProjectId | null
  companyName: string
  principalStaffId: FinanceSettingProjectId
  principalStaffNo: string
  principalName: string
  status: FinanceSettingProjectStatus
  stages: FinanceSettingProjectStage[]
  createTime?: string | null
  updateTime?: string | null
}

export type FinanceSettingProjectUpdateChanges = {
  stages?: FinanceSettingProjectStage[] | null
}

export type FinanceSettingProjectUpdateInput = {
  current: FinanceSettingProjectDetail | FinanceSettingProjectSaveDraft
  changes?: FinanceSettingProjectUpdateChanges | null
}

export type FinanceSettingProjectPreparedUpdate = {
  draft: FinanceSettingProjectSaveDraft
  previous: FinanceSettingProjectSaveDraft
}

export type FinanceSettingProjectStatusInput = {
  id: FinanceSettingProjectId
  currentStatus: FinanceSettingProjectStatus
}

export type FinanceSettingProjectUserOption = {
  id: FinanceSettingProjectId
  realName: string
  username: string
  label: string
}

export type FinanceSettingProjectOrganizationNode = {
  id: FinanceSettingProjectId
  name: string
  pid?: FinanceSettingProjectId | null
  isCorporation?: number | boolean | null
  children: FinanceSettingProjectOrganizationNode[]
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): FinanceSettingProjectId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingProjectId | null {
  if (value === null || value === undefined || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须为非空字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function statusOf (value: unknown, label = 'status'): FinanceSettingProjectStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function enumOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || ![1, 2, 3].includes(Number(value))) throw new Error(`${label}只能是数值1、2或3`)
  return Number(value)
}

function dateOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return value === null ? null : ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD、空字符串或null`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error(`${label}不是有效日期`)
  return value
}

function pageOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function candidatePageOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1 || (label === 'pageSize' && Number(resolved) > 100)) throw new Error(`${label}必须为1至100的正整数`)
  return Number(resolved)
}

function numberListOf (value: unknown, label: string): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是整数数组`)
  return value.map((item, index) => {
    if (!Number.isSafeInteger(item) || Number(item) < 1) throw new Error(`${label}[${index}]必须为正整数`)
    return Number(item)
  })
}

function idListStringOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return null
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => String(idOf(item, `${label}[${index}]`))).join(',')
}

function stageOf (value: unknown, label: string): FinanceSettingProjectStage {
  const stage = objectOf(value, label)
  if (!Number.isSafeInteger(stage.stage) || Number(stage.stage) < 1) throw new Error(`${label}.stage必须为正整数`)
  const result: FinanceSettingProjectStage = {
    stage: Number(stage.stage),
    startDate: dateOf(stage.startDate, `${label}.startDate`),
    endDate: dateOf(stage.endDate, `${label}.endDate`),
  }
  if (stage.id !== undefined) result.id = idOf(stage.id, `${label}.id`)
  if (stage.stageName !== undefined) result.stageName = nullableTextOf(stage.stageName, `${label}.stageName`)
  return result
}

function normalizeStages (value: unknown): FinanceSettingProjectStage[] {
  const source = value === undefined || value === null ? [] : value
  if (!Array.isArray(source)) throw new Error('stages必须是数组')
  const map = new Map<number, FinanceSettingProjectStage>()
  source.forEach((item, index) => {
    const stage = stageOf(item, `stages[${index}]`)
    map.set(stage.stage, stage)
  })
  return [1, 2].map(stage => map.get(stage) ?? { stage, startDate: '', endDate: '' })
}

function validateStages (stages: FinanceSettingProjectStage[]): FinanceSettingProjectStage[] {
  stages.forEach((item, index) => {
    const hasStart = Boolean(item.startDate)
    const hasEnd = Boolean(item.endDate)
    if (hasStart !== hasEnd) throw new Error(`stages[${index}]阶段开始日期和结束日期需同时填写或同时为空`)
    if (hasStart && item.startDate! > item.endDate!) throw new Error(`stages[${index}]阶段开始日期不能晚于结束日期`)
  })
  const research = stages.find(item => item.stage === 1)
  const develop = stages.find(item => item.stage === 2)
  if (research?.endDate && develop?.startDate && research.endDate > develop.startDate) throw new Error('研究阶段结束日期不能晚于开发阶段开始日期')
  return stages
}

function baseFieldsOf (input: unknown, label: string): FinanceSettingProjectSaveDraft {
  const value = objectOf(input, label)
  const projectName = textOf(value.projectName, `${label}.projectName`)
  const projectCode = textOf(value.projectCode, `${label}.projectCode`)
  if (projectName.length > 500) throw new Error('projectName不能超过500个字符')
  if (projectCode.length > 500) throw new Error('projectCode不能超过500个字符')
  const stages = validateStages(normalizeStages(value.stages))
  return {
    id: idOf(value.id, `${label}.id`),
    projectName,
    projectCode,
    projectType: enumOf(value.projectType, `${label}.projectType`),
    projectAttribute: enumOf(value.projectAttribute, `${label}.projectAttribute`),
    companyId: nullableIdOf(value.companyId, `${label}.companyId`),
    companyName: textOf(value.companyName ?? '', `${label}.companyName`, true),
    principalStaffId: idOf(value.principalStaffId, `${label}.principalStaffId`),
    principalStaffNo: textOf(value.principalStaffNo ?? '', `${label}.principalStaffNo`, true),
    principalName: textOf(value.principalName ?? '', `${label}.principalName`, true),
    status: statusOf(value.status ?? 1, `${label}.status`),
    stages,
    ...(value.createTime === undefined ? {} : { createTime: nullableTextOf(value.createTime, `${label}.createTime`) }),
    ...(value.updateTime === undefined ? {} : { updateTime: nullableTextOf(value.updateTime, `${label}.updateTime`) }),
  }
}

function createDraftOf (input: FinanceSettingProjectCreateDraft): FinanceSettingProjectCreateDraft & { id: ''; companyId: FinanceSettingProjectId | null; companyName: string; principalStaffNo: string; principalName: string; status: FinanceSettingProjectStatus; stages: FinanceSettingProjectStage[] } {
  const value = objectOf(input, '创建项目输入')
  const projectName = textOf(value.projectName, 'projectName')
  const projectCode = textOf(value.projectCode, 'projectCode')
  if (projectName.length > 500) throw new Error('projectName不能超过500个字符')
  if (projectCode.length > 500) throw new Error('projectCode不能超过500个字符')
  return {
    id: '',
    projectName,
    projectCode,
    projectType: enumOf(value.projectType, 'projectType') as FinanceSettingProjectType,
    projectAttribute: enumOf(value.projectAttribute, 'projectAttribute') as FinanceSettingProjectAttribute,
    companyId: nullableIdOf(value.companyId, 'companyId'),
    companyName: textOf(value.companyName ?? '', 'companyName', true),
    principalStaffId: idOf(value.principalStaffId, 'principalStaffId'),
    principalStaffNo: textOf(value.principalStaffNo ?? '', 'principalStaffNo', true),
    principalName: textOf(value.principalName ?? '', 'principalName', true),
    status: statusOf(value.status ?? 1),
    stages: validateStages(normalizeStages(value.stages)),
  }
}

function saveDraftOf (input: unknown, label: string): FinanceSettingProjectSaveDraft {
  return baseFieldsOf(input, label)
}

function updateOf (input: FinanceSettingProjectUpdateInput): FinanceSettingProjectPreparedUpdate {
  const previous = saveDraftOf(input?.current, '编辑项目当前值')
  const changes = input?.changes ?? {}
  const changesObject = objectOf(changes, '项目编辑变更')
  for (const key of Object.keys(changesObject)) if (key !== 'stages') throw new Error(`项目编辑变更不支持字段${key}`)
  const draft = {
    ...previous,
    stages: validateStages(normalizeStages(changesObject.stages === undefined ? previous.stages : changesObject.stages)),
  }
  return { draft, previous }
}

function rowOf (value: unknown): FinanceSettingProjectRow {
  const row = objectOf(value, '项目列表行')
  return {
    id: idOf(row.id, '项目id'),
    projectName: nullableTextOf(row.projectName, 'projectName'),
    projectCode: nullableTextOf(row.projectCode, 'projectCode'),
    projectType: row.projectType === null || row.projectType === undefined ? null : enumOf(row.projectType, 'projectType'),
    projectAttribute: row.projectAttribute === null || row.projectAttribute === undefined ? null : enumOf(row.projectAttribute, 'projectAttribute'),
    companyId: nullableIdOf(row.companyId, 'companyId'),
    companyName: nullableTextOf(row.companyName, 'companyName'),
    principalStaffId: nullableIdOf(row.principalStaffId, 'principalStaffId'),
    principalStaffNo: nullableTextOf(row.principalStaffNo, 'principalStaffNo'),
    principalName: nullableTextOf(row.principalName, 'principalName'),
    status: statusOf(row.status),
    createTime: nullableTextOf(row.createTime, 'createTime'),
    stages: normalizeStages(row.stages),
    ...(row.updateTime === undefined ? {} : { updateTime: nullableTextOf(row.updateTime, 'updateTime') }),
  }
}

function organizationNodeOf (value: unknown, label: string): FinanceSettingProjectOrganizationNode {
  const node = objectOf(value, label)
  const children = node.children === undefined || node.children === null ? [] : node.children
  if (!Array.isArray(children)) throw new Error(`${label}.children必须是数组`)
  return {
    id: idOf(node.id, `${label}.id`),
    name: textOf(node.name, `${label}.name`),
    pid: node.pid === 0 || node.pid === '0' ? null : nullableIdOf(node.pid, `${label}.pid`),
    isCorporation: node.isCorporation === undefined ? null : (typeof node.isCorporation === 'number' || typeof node.isCorporation === 'boolean' ? node.isCorporation : (() => { throw new Error(`${label}.isCorporation必须为数值或布尔值`) })()),
    children: children.map((item, index) => organizationNodeOf(item, `${label}.children[${index}]`)),
  }
}

function userOptionOf (value: unknown): FinanceSettingProjectUserOption {
  const row = objectOf(value, '人员候选')
  const id = idOf(row.id, '人员候选id')
  const realName = textOf(row.realName, 'realName')
  const username = textOf(row.username, 'username')
  return { id, realName, username, label: `${realName}(${username})` }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function positiveKeyword (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('人员候选搜索必须提供非空关键字')
  return value.trim()
}

function queryOf (query: FinanceSettingProjectQuery): Record<string, unknown> {
  const source = query ?? {}
  return {
    order: '',
    orderField: '',
    projectName: source.projectName ?? null,
    projectCode: source.projectCode ?? null,
    projectTypes: numberListOf(source.projectTypes, 'projectTypes'),
    projectAttributes: numberListOf(source.projectAttributes, 'projectAttributes'),
    stages: numberListOf(source.stages, 'stages'),
    companyIds: idListStringOf(source.companyIds, 'companyIds'),
    principalName: source.principalName ?? null,
    status: statusOf(source.status ?? 1),
    pageNo: pageOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageOf(source.pageSize, 20, 'pageSize'),
  }
}

/** The injected request must be created for FINANCE_SETTING_PROJECT_PAGE_PATH. */
export function createFinanceSettingProjectCapability (request: PortalRequest, options: { now?: () => Date } = {}) {
  void options
  return {
    async list (query: FinanceSettingProjectQuery = {}): Promise<PageResult<FinanceSettingProjectRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('项目分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },

    async get (input: { id: FinanceSettingProjectId }): Promise<FinanceSettingProjectDetail> {
      const result = await request<unknown>({ url: `${ROOT}/get`, method: 'get', params: { id: idOf(input?.id, '项目id') } })
      return rowOf(result)
    },

    organizationTree: async (): Promise<FinanceSettingProjectOrganizationNode[]> => {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get', params: { excludePost: false } })
      if (!Array.isArray(result)) throw new Error('项目所属公司组织树响应必须是数组')
      return result.map((item, index) => organizationNodeOf(item, `组织树[${index}]`))
    },

    async searchUsers (query: { keyword: string; pageNo?: number; pageSize?: number }): Promise<PageResult<FinanceSettingProjectUserOption>> {
      const result = await request<PageResult<unknown>>({
        url: USER_SEARCH_URL,
        method: 'get',
        params: {
          pageNo: candidatePageOf(query?.pageNo, 1, 'pageNo'),
          pageSize: candidatePageOf(query?.pageSize, 20, 'pageSize'),
          name: positiveKeyword(query?.keyword),
          statusList: '1,4',
        },
      })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('人员候选响应缺少有效list或total')
      return { list: result.list.map(userOptionOf), total: result.total }
    },

    prepareCreate (input: FinanceSettingProjectCreateDraft) {
      return { draft: createDraftOf(input) }
    },

    async create (input: FinanceSettingProjectCreateDraft): Promise<FinanceSettingProjectId> {
      const draft = createDraftOf(input)
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: draft })
      return idOf(result, '新建项目返回的id')
    },

    prepareUpdate: updateOf,

    async update (input: FinanceSettingProjectUpdateInput): Promise<true> {
      const { draft } = updateOf(input)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft })
      return trueResult(result, '编辑项目')
    },

    async enable (input: FinanceSettingProjectStatusInput): Promise<true> {
      if (statusOf(input?.currentStatus, 'currentStatus') !== 0) throw new Error('只能启用当前停用项目')
      const result = await request<unknown>({ url: `${ROOT}/enable`, method: 'put', params: { id: idOf(input?.id, '项目id') } })
      return trueResult(result, '启用项目')
    },

    async disable (input: FinanceSettingProjectStatusInput): Promise<true> {
      if (statusOf(input?.currentStatus, 'currentStatus') !== 1) throw new Error('只能停用当前启用项目')
      const result = await request<unknown>({ url: `${ROOT}/disable`, method: 'put', params: { id: idOf(input?.id, '项目id') } })
      return trueResult(result, '停用项目')
    },

    async remove (id: FinanceSettingProjectId): Promise<true> {
      const result = await request<unknown>({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(id, '项目id') } })
      return trueResult(result, '删除项目')
    },
  }
}

export type FinanceSettingProjectCapability = ReturnType<typeof createFinanceSettingProjectCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const projectTypeOptions = [{ label: '生物技术类', value: 1 }, { label: '信息技术类', value: 2 }, { label: '工程类', value: 3 }]
const projectAttributeOptions = [{ label: '自主开发项目', value: 1 }, { label: '外部科研项目', value: 2 }, { label: '受托开发项目', value: 3 }]
const stageOptions = [{ label: '研究阶段', value: 1 }, { label: '开发阶段', value: 2 }]
const stageParam = p('stages', 'enum', false, '按当前阶段筛选；页面将选中的阶段编码作为数组发送')
const statusParam = (name: string, required = false): ParamSpec => ({ name, kind: 'enum', required, options: statusOptions })
const createParams: ParamSpec[] = [
  p('projectName', 'text', true, '项目名称，最多500个字符'),
  p('projectCode', 'text', true, '项目编号，最多500个字符'),
  { ...p('projectType', 'enum', true), options: projectTypeOptions },
  { ...p('projectAttribute', 'enum', true), options: projectAttributeOptions },
  p('companyId', 'tree', false, '所属公司ID；来自当前组织树，可省略'),
  p('companyName', 'text', false, '所属公司名称；从组织树选择时由页面补齐'),
  p('principalStaffId', 'search', true, '课题负责人用户ID；先用关键字搜索人员候选'),
  p('principalStaffNo', 'text', false, '负责人工号；从人员候选结果补齐'),
  p('principalName', 'text', false, '负责人姓名；从人员候选结果补齐'),
  { ...statusParam('status'), description: '绝对状态；新增默认1启用' },
  stageParam,
]

export const FINANCE_SETTING_PROJECT_METHODS = {
  'finance-setting-project-list': 'list',
  'finance-setting-project-get': 'get',
  'finance-setting-project-organization-tree': 'organizationTree',
  'finance-setting-project-user-search': 'searchUsers',
  'finance-setting-project-prepare-create': 'prepareCreate',
  'finance-setting-project-create': 'create',
  'finance-setting-project-prepare-update': 'prepareUpdate',
  'finance-setting-project-update': 'update',
  'finance-setting-project-enable': 'enable',
  'finance-setting-project-disable': 'disable',
  'finance-setting-project-remove': 'remove',
} as const

export const financeSettingProjectCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-project-list', title: '查询项目管理列表', write: false, params: [p('projectName', 'text'), p('projectCode', 'text'), p('projectTypes', 'enum'), p('projectAttributes', 'enum'), stageParam, p('companyIds', 'tree'), p('principalName', 'text'), { ...p('status', 'enum'), options: statusOptions }, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-setting-project-get', title: '查看项目详情', write: false, params: [p('id', 'text', true, '项目主键ID')] },
  { id: 'finance-setting-project-organization-tree', title: '查询项目所属公司组织树', write: false, params: [] },
  { id: 'finance-setting-project-user-search', title: '搜索项目负责人候选', write: false, params: [p('keyword', 'text', true, '人员姓名关键字，不允许空关键字'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-setting-project-prepare-create', title: '准备创建项目', write: false, params: createParams },
  { id: 'finance-setting-project-create', title: '创建项目', write: true, params: createParams },
  { id: 'finance-setting-project-prepare-update', title: '准备编辑项目阶段', write: false, params: [p('current', 'text', true, '来自最新项目详情的完整当前值'), p('changes', 'text', false, '只允许包含stages')] },
  { id: 'finance-setting-project-update', title: '编辑项目阶段', write: true, params: [p('current', 'text', true, '来自最新项目详情的完整当前值'), p('changes', 'text', false, '只允许包含stages')] },
  { id: 'finance-setting-project-enable', title: '启用项目', write: true, params: [p('id', 'text', true, '项目主键ID'), statusParam('currentStatus', true)] },
  { id: 'finance-setting-project-disable', title: '停用项目', write: true, params: [p('id', 'text', true, '项目主键ID'), statusParam('currentStatus', true)] },
  { id: 'finance-setting-project-remove', title: '删除项目', write: true, params: [p('id', 'text', true, '项目主键ID')] },
].map(definition => ({ ...definition, pagePath: FINANCE_SETTING_PROJECT_PAGE_PATH, permission: '/dashboard/finance/setting/project', moduleType: null, httpInstance: 'platform' }))
