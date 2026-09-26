import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/** Portal technology setting / 项目类型; frontend d3cf56bdc7. */
export const TECHNOLOGY_PROJECT_TYPE_PAGE_PATH = '/dashboard/technology/setting/project-type/list'
const ROOT = '/admin-api/technology/setting/project-type'

export const TECHNOLOGY_PROJECT_DOMAINS = ['biology', 'information', 'engineering'] as const
export const TECHNOLOGY_PROJECT_TYPE_ROLES = ['project_owner', 'project_member', 'evaluation_recorder', 'promotion_owner'] as const

export type TechnologyProjectDomain = typeof TECHNOLOGY_PROJECT_DOMAINS[number]
export type TechnologyProjectTypeRole = typeof TECHNOLOGY_PROJECT_TYPE_ROLES[number]
export type TechnologyProjectTypeId = string | number
export type TechnologyProjectTypeStatus = 0 | 1

export type TechnologyProjectTypeRow = {
  id: TechnologyProjectTypeId
  typeCode: string
  codeAbbreviation: string | null
  roleCodes: string[]
  typeName: string
  projectDomain: string
  status: number
  sort: number | null
  remark: string | null
  updateTime: string | null
}

export type TechnologyProjectTypeCreateDraft = {
  typeCode: string
  codeAbbreviation?: string | null
  roleCodes?: TechnologyProjectTypeRole[]
  typeName: string
  projectDomain: TechnologyProjectDomain
  status?: TechnologyProjectTypeStatus
  sort?: number | null
  remark?: string | null
}

export type TechnologyProjectTypeSaveDraft = {
  id: TechnologyProjectTypeId
  typeCode: string
  codeAbbreviation: string | null
  roleCodes: string[]
  typeName: string
  projectDomain: string
  status: TechnologyProjectTypeStatus
  sort: number | null
  remark: string | null
}

export type TechnologyProjectTypeChanges = Partial<Pick<TechnologyProjectTypeSaveDraft,
  'codeAbbreviation' | 'roleCodes' | 'typeName' | 'status' | 'sort' | 'remark'>>

export type TechnologyProjectTypeUpdateInput = {
  current: TechnologyProjectTypeSaveDraft | TechnologyProjectTypeRow
  changes?: TechnologyProjectTypeChanges
}

export type TechnologyProjectTypeQuery = {
  pageNo?: number
  pageSize?: number
  code?: string | null
  name?: string | null
  projectDomain?: TechnologyProjectDomain | null
}

function idOf(value: TechnologyProjectTypeId): TechnologyProjectTypeId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('项目类型 id 必须为安全正整数或其十进制字符串')
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('项目类型 id 必须为安全正整数或其十进制字符串')
  return value
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}必填且不得全为空格`)
  return value
}

function abbreviationOf(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('编号缩写必须为字符串或null')
  if (value !== '' && !/^[a-z][a-z0-9]{0,11}$/.test(value)) throw new Error('编号缩写须为1至12位小写字母数字且以字母开头')
  return value
}

function rolesOf(value: unknown, allowUnknown = false): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('适用角色至少选择一项')
  if (value.some(item => typeof item !== 'string' || item.length === 0)) throw new Error('适用角色必须为非空字符串数组')
  const roles = [...new Set(value)] as string[]
  if (roles.length !== value.length) throw new Error('适用角色不能重复')
  if (!allowUnknown && roles.some(role => !TECHNOLOGY_PROJECT_TYPE_ROLES.includes(role as TechnologyProjectTypeRole))) {
    throw new Error('适用角色只能取页面提供的四个角色编码')
  }
  return roles
}

function domainOf(value: unknown, allowUnknown = false): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('项目大类必填')
  if (!allowUnknown && !TECHNOLOGY_PROJECT_DOMAINS.includes(value as TechnologyProjectDomain)) {
    throw new Error('项目大类只能是 biology、information 或 engineering')
  }
  return value
}

function statusOf(value: unknown): TechnologyProjectTypeStatus {
  if (value !== 0 && value !== 1) throw new Error('状态只能是数值0（启用）或1（停用）')
  return value
}

function sortOf(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('排序必须为非负有限数或null')
  return value
}

function remarkOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('备注必须为字符串或null')
  return value
}

function createDraftOf(input: TechnologyProjectTypeCreateDraft): TechnologyProjectTypeCreateDraft & {
  codeAbbreviation: string | null
  roleCodes: TechnologyProjectTypeRole[]
  status: TechnologyProjectTypeStatus
  sort: number | null
  remark: string | null
} {
  return {
    typeCode: requiredText(input?.typeCode, '类型编码'),
    codeAbbreviation: abbreviationOf(input?.codeAbbreviation),
    roleCodes: rolesOf(input?.roleCodes ?? TECHNOLOGY_PROJECT_TYPE_ROLES) as TechnologyProjectTypeRole[],
    typeName: requiredText(input?.typeName, '类型名称'),
    projectDomain: domainOf(input?.projectDomain) as TechnologyProjectDomain,
    status: statusOf(input?.status ?? 0),
    sort: sortOf(input?.sort ?? 0),
    remark: remarkOf(input?.remark ?? ''),
  }
}

function saveDraftOf(input: TechnologyProjectTypeSaveDraft | TechnologyProjectTypeRow): TechnologyProjectTypeSaveDraft {
  return {
    id: idOf(input?.id),
    typeCode: requiredText(input?.typeCode, '类型编码'),
    codeAbbreviation: abbreviationOf(input?.codeAbbreviation),
    roleCodes: rolesOf(input?.roleCodes, true),
    typeName: requiredText(input?.typeName, '类型名称'),
    projectDomain: domainOf(input?.projectDomain, true),
    status: statusOf(input?.status),
    sort: sortOf(input?.sort),
    remark: remarkOf(input?.remark),
  }
}

function changesOf(input: TechnologyProjectTypeChanges = {}): TechnologyProjectTypeChanges {
  const changes: TechnologyProjectTypeChanges = {}
  if (input.codeAbbreviation !== undefined) changes.codeAbbreviation = abbreviationOf(input.codeAbbreviation)
  if (input.roleCodes !== undefined) changes.roleCodes = rolesOf(input.roleCodes) as TechnologyProjectTypeRole[]
  if (input.typeName !== undefined) changes.typeName = requiredText(input.typeName, '类型名称')
  if (input.status !== undefined) changes.status = statusOf(input.status)
  if (input.sort !== undefined) changes.sort = sortOf(input.sort)
  if (input.remark !== undefined) changes.remark = remarkOf(input.remark)
  return changes
}

function rowOf(raw: Record<string, unknown>): TechnologyProjectTypeRow {
  return {
    id: idOf(raw.id as TechnologyProjectTypeId),
    typeCode: requiredText(raw.typeCode, '项目类型响应中的 typeCode'),
    codeAbbreviation: abbreviationOf(raw.codeAbbreviation),
    roleCodes: rolesOf(raw.roleCodes ?? TECHNOLOGY_PROJECT_TYPE_ROLES, true),
    typeName: requiredText(raw.typeName, '项目类型响应中的 typeName'),
    projectDomain: domainOf(raw.projectDomain, true),
    status: typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : (() => { throw new Error('项目类型响应中的 status 必须为数值') })(),
    sort: sortOf(raw.sort ?? null),
    remark: remarkOf(raw.remark ?? null),
    updateTime: raw.updateTime == null ? null : String(raw.updateTime),
  }
}

/** The injected request must be createPageCall(TECHNOLOGY_PROJECT_TYPE_PAGE_PATH). */
export function createTechnologyProjectTypeCapability(request: PortalRequest) {
  function prepareUpdate(input: TechnologyProjectTypeUpdateInput) {
    const previous = saveDraftOf(input?.current)
    const draft = saveDraftOf({ ...previous, ...changesOf(input?.changes) })
    return { draft, previous }
  }

  return {
    async list(query: TechnologyProjectTypeQuery = {}): Promise<PageResult<TechnologyProjectTypeRow>> {
      const pageNo = query.pageNo ?? 1
      const pageSize = query.pageSize ?? 20
      if (!Number.isInteger(pageNo) || pageNo < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
        throw new Error('pageNo必须为正整数，pageSize必须为1至500的整数')
      }
      const projectDomain = query.projectDomain ?? null
      if (projectDomain !== null) domainOf(projectDomain)
      const page = await request<PageResult<Record<string, unknown>>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          pageNo,
          pageSize,
          code: query.code ?? null,
          name: query.name ?? null,
          projectDomain,
        },
      })
      return { list: page.list.map(rowOf), total: page.total }
    },
    prepareCreate(input: TechnologyProjectTypeCreateDraft) {
      return { draft: createDraftOf(input) }
    },
    prepareUpdate,
    async create(input: TechnologyProjectTypeCreateDraft): Promise<void> {
      const draft = createDraftOf(input)
      await request({ url: `${ROOT}/create`, method: 'post', data: { id: null, ...draft } })
    },
    async update(input: TechnologyProjectTypeUpdateInput): Promise<void> {
      const { draft } = prepareUpdate(input)
      await request({ url: `${ROOT}/update`, method: 'put', data: draft })
    },
    async remove(id: TechnologyProjectTypeId): Promise<void> {
      await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: idOf(id) } })
    },
  }
}

export type TechnologyProjectTypeCapability = ReturnType<typeof createTechnologyProjectTypeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }), ...(options === undefined ? {} : { options }) })
const domains = TECHNOLOGY_PROJECT_DOMAINS.map(value => ({ value, label: value === 'biology' ? '生物' : value === 'information' ? '信息' : '工程' }))
const statuses = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const createParams: ParamSpec[] = [
  p('typeCode', 'text', true),
  p('codeAbbreviation', 'text'),
  p('roleCodes', 'enum', false, '适用角色编码数组；省略时与PC新增默认一致，选择全部四项', TECHNOLOGY_PROJECT_TYPE_ROLES.map(value => ({ value, label: value }))),
  p('typeName', 'text', true),
  p('projectDomain', 'enum', true, undefined, domains),
  p('status', 'enum', false, undefined, statuses),
  p('sort', 'number'),
  p('remark', 'text'),
]

export const TECHNOLOGY_PROJECT_TYPE_METHODS = {
  'technology-project-type-list': 'list',
  'technology-project-type-prepare-create': 'prepareCreate',
  'technology-project-type-prepare-update': 'prepareUpdate',
  'technology-project-type-create': 'create',
  'technology-project-type-update': 'update',
  'technology-project-type-remove': 'remove',
} as const

export const technologyProjectTypeCapabilities: CapabilityDefinition[] = [
  { id: 'technology-project-type-list', title: '查询项目类型', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number'), p('code', 'text'), p('name', 'text'), p('projectDomain', 'enum', false, undefined, domains)] },
  { id: 'technology-project-type-prepare-create', title: '准备新增项目类型', write: false, params: createParams },
  { id: 'technology-project-type-prepare-update', title: '准备编辑项目类型', write: false, params: [p('current', 'text', true, '列表行或此前准备结果中的完整当前值对象'), p('changes', 'text', false, '只包含本次允许修改字段的对象')] },
  { id: 'technology-project-type-create', title: '新增项目类型', write: true, params: createParams },
  { id: 'technology-project-type-update', title: '编辑项目类型', write: true, params: [p('current', 'text', true, '列表行或此前准备结果中的完整当前值对象'), p('changes', 'text', false, '只包含本次允许修改字段的对象')] },
  { id: 'technology-project-type-remove', title: '删除项目类型', write: true, params: [p('id', 'text', true)] },
].map(capability => ({
  ...capability,
  pagePath: TECHNOLOGY_PROJECT_TYPE_PAGE_PATH,
  permission: '/dashboard/technology/setting/project-type',
  httpInstance: 'platform',
}))
