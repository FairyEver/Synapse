import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/** Portal「科技管理 → 设置 → 类型模板映射」页面；前端源码 d3cf56bdc7。 */
export const TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PAGE_PATH = '/dashboard/technology/setting/type-template-mapping/list'
export const TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PERMISSION = '/dashboard/technology/setting/type-template-mapping'

const ROOT = '/admin-api/technology/setting/type-template-mapping'
const PROJECT_TYPE_ROOT = '/admin-api/technology/setting/project-type'
const TEMPLATE_ROOT = '/admin-api/technology/setting/template'

export type TechnologyTypeTemplateMappingId = string | number
export type TechnologyTypeTemplateMappingStatus = 'enabled' | 'disabled'

export type TechnologyTypeTemplateMappingRow = Record<string, unknown> & {
  id: TechnologyTypeTemplateMappingId
  projectTypeId: TechnologyTypeTemplateMappingId
  projectTypeName: string | null
  templateVersionId: TechnologyTypeTemplateMappingId
  templateName: string | null
  versionNo: string | null
  effectiveStartTime: string | null
  effectiveEndTime: string | null
  status: TechnologyTypeTemplateMappingStatus
  displayStatus: string | null
  remark: string
}

export type TechnologyTypeTemplateMappingProjectType = Record<string, unknown> & {
  id: TechnologyTypeTemplateMappingId
  typeName: string
  projectDomain: string
}

export type TechnologyTypeTemplateMappingTemplate = Record<string, unknown> & {
  id: TechnologyTypeTemplateMappingId
  templateName: string
  projectDomain: string
}

export type TechnologyTypeTemplateMappingVersion = Record<string, unknown> & {
  id: TechnologyTypeTemplateMappingId
  templateId: TechnologyTypeTemplateMappingId
  versionNo: string
  versionName: string
}

export type TechnologyTypeTemplateMappingReferences = {
  projectTypes: TechnologyTypeTemplateMappingProjectType[]
  templates: TechnologyTypeTemplateMappingTemplate[]
  publishedVersions: TechnologyTypeTemplateMappingVersion[]
}

export type TechnologyTypeTemplateMappingQuery = {
  pageNo?: number
  pageSize?: number
  projectTypeId?: TechnologyTypeTemplateMappingId | null
}

export type TechnologyTypeTemplateMappingCreateInput = {
  projectTypeId: TechnologyTypeTemplateMappingId
  templateVersionId: TechnologyTypeTemplateMappingId
  effectiveStartTime: string
  effectiveEndTime?: string | null
  status?: TechnologyTypeTemplateMappingStatus
  remark?: string | null
}

export type TechnologyTypeTemplateMappingCreateDraft = {
  projectTypeId: TechnologyTypeTemplateMappingId
  templateVersionId: TechnologyTypeTemplateMappingId
  effectiveStartTime: string
  effectiveEndTime: string | null
  status: TechnologyTypeTemplateMappingStatus
  remark: string
}

export type TechnologyTypeTemplateMappingSaveDraft = TechnologyTypeTemplateMappingCreateDraft & {
  id: TechnologyTypeTemplateMappingId
}

export type TechnologyTypeTemplateMappingUpdateInput = {
  current: TechnologyTypeTemplateMappingRow | TechnologyTypeTemplateMappingSaveDraft
  changes?: Partial<Omit<TechnologyTypeTemplateMappingSaveDraft, 'id' | 'projectTypeId'>>
}

export type TechnologyTypeTemplateMappingChangeStatusInput = {
  id: TechnologyTypeTemplateMappingId
  enabled: boolean
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf(value: unknown, label: string): TechnologyTypeTemplateMappingId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function requiredTextOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  return value
}

function nullableTextOf(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function remarkOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('备注必须为字符串或null')
  return value
}

/** 页面 date-picker 的 value-format；编辑列表行时仅把 ISO 的 T 换成空格，不做时区转换。 */
function dateTimeOf(value: unknown, label: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}必填`)
    return null
  }
  if (typeof value !== 'string') throw new Error(`${label}必须为YYYY-MM-DD HH:mm:ss字符串或null`)
  const normalized = value.replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(normalized)) {
    throw new Error(`${label}必须为Portal的YYYY-MM-DD HH:mm:ss格式`)
  }
  return normalized
}

function statusOf(value: unknown, label: string): TechnologyTypeTemplateMappingStatus {
  if (value === 'enabled' || value === 'disabled') return value
  throw new Error(`${label}必须为enabled或disabled`)
}

function pageNumberOf(value: unknown, fallback: number, label: string, max?: number): number {
  const result = value === undefined ? fallback : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 1 || (max !== undefined && result > max)) {
    throw new Error(`${label}必须为${max === undefined ? '正' : `1至${max}范围内的`}整数`)
  }
  return result
}

function pageOf<T>(value: unknown, label: string, map: (row: unknown, index: number) => T): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) {
    throw new Error(`${label}缺少有效list或total`)
  }
  return { list: page.list.map(map), total: page.total }
}

function projectTypeOf(value: unknown, label: string): TechnologyTypeTemplateMappingProjectType {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    typeName: requiredTextOf(row.typeName, `${label}.typeName`),
    projectDomain: requiredTextOf(row.projectDomain, `${label}.projectDomain`),
  }
}

function templateOf(value: unknown, label: string): TechnologyTypeTemplateMappingTemplate {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    templateName: requiredTextOf(row.templateName, `${label}.templateName`),
    projectDomain: requiredTextOf(row.projectDomain, `${label}.projectDomain`),
  }
}

function versionOf(value: unknown, label: string): TechnologyTypeTemplateMappingVersion {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    templateId: idOf(row.templateId, `${label}.templateId`),
    versionNo: requiredTextOf(row.versionNo, `${label}.versionNo`),
    versionName: requiredTextOf(row.versionName, `${label}.versionName`),
  }
}

function rowOf(value: unknown, label: string): TechnologyTypeTemplateMappingRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    projectTypeId: idOf(row.projectTypeId, `${label}.projectTypeId`),
    projectTypeName: nullableTextOf(row.projectTypeName, `${label}.projectTypeName`),
    templateVersionId: idOf(row.templateVersionId, `${label}.templateVersionId`),
    templateName: nullableTextOf(row.templateName, `${label}.templateName`),
    versionNo: nullableTextOf(row.versionNo, `${label}.versionNo`),
    effectiveStartTime: nullableTextOf(row.effectiveStartTime, `${label}.effectiveStartTime`),
    effectiveEndTime: nullableTextOf(row.effectiveEndTime, `${label}.effectiveEndTime`),
    status: statusOf(row.status, `${label}.status`),
    displayStatus: nullableTextOf(row.displayStatus, `${label}.displayStatus`),
    remark: remarkOf(row.remark),
  }
}

function createDraftOf(input: TechnologyTypeTemplateMappingCreateInput): TechnologyTypeTemplateMappingCreateDraft {
  return {
    projectTypeId: idOf(input?.projectTypeId, 'projectTypeId'),
    templateVersionId: idOf(input?.templateVersionId, 'templateVersionId'),
    effectiveStartTime: dateTimeOf(input?.effectiveStartTime, 'effectiveStartTime', true)!,
    effectiveEndTime: dateTimeOf(input?.effectiveEndTime, 'effectiveEndTime', false),
    status: statusOf(input?.status ?? 'enabled', 'status'),
    remark: remarkOf(input?.remark),
  }
}

function saveDraftOf(input: TechnologyTypeTemplateMappingSaveDraft | TechnologyTypeTemplateMappingRow): TechnologyTypeTemplateMappingSaveDraft {
  const source = input as TechnologyTypeTemplateMappingCreateInput
  return {
    id: idOf(input?.id, 'id'),
    ...createDraftOf({
      projectTypeId: source.projectTypeId,
      templateVersionId: source.templateVersionId,
      effectiveStartTime: source.effectiveStartTime as string,
      effectiveEndTime: source.effectiveEndTime,
      status: source.status,
      remark: source.remark,
    }),
  }
}

function updateDraftOf(input: TechnologyTypeTemplateMappingUpdateInput): { draft: TechnologyTypeTemplateMappingSaveDraft; previous: TechnologyTypeTemplateMappingSaveDraft } {
  const previous = saveDraftOf(input?.current)
  const changes = input?.changes ?? {}
  for (const key of Object.keys(changes)) {
    if (!['templateVersionId', 'effectiveStartTime', 'effectiveEndTime', 'status', 'remark'].includes(key)) {
      throw new Error(`编辑变更不支持字段${key}`)
    }
  }
  return {
    previous,
    draft: saveDraftOf({ ...previous, ...changes }),
  }
}

/** The injected request must be bound to TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PAGE_PATH. */
export function createTechnologyTypeTemplateMappingCapability(request: PortalRequest) {
  return {
    async list(query: TechnologyTypeTemplateMappingQuery = {}): Promise<PageResult<TechnologyTypeTemplateMappingRow>> {
      const pageNo = pageNumberOf(query.pageNo, 1, 'pageNo')
      const pageSize = pageNumberOf(query.pageSize, 20, 'pageSize', 500)
      const projectTypeId = query.projectTypeId == null ? null : idOf(query.projectTypeId, 'projectTypeId')
      return pageOf(
        await request({ url: `${ROOT}/page`, method: 'get', params: { pageNo, pageSize, projectTypeId } }),
        '类型模板映射分页响应',
        (row, index) => rowOf(row, `类型模板映射列表[${index}]`),
      )
    },

    async references(): Promise<TechnologyTypeTemplateMappingReferences> {
      const [projectTypeResult, templateResult] = await Promise.all([
        request<unknown[]>({ url: `${PROJECT_TYPE_ROOT}/simple-list`, method: 'get', params: { status: null } }),
        request<unknown>({ url: `${TEMPLATE_ROOT}/page`, method: 'get', params: { pageNo: 1, pageSize: 500 } }),
      ])
      if (!Array.isArray(projectTypeResult)) throw new Error('类型模板映射项目类型候选响应必须是数组')
      const projectTypes = projectTypeResult.map((row, index) => projectTypeOf(row, `项目类型候选[${index}]`))
      const templates = pageOf(templateResult, '模板候选分页响应', (row, index) => templateOf(row, `模板候选列表[${index}]`)).list
      const versionPages = await Promise.all(templates.map(template => request<unknown>({
        url: `${TEMPLATE_ROOT}/version/page`,
        method: 'get',
        params: { templateId: template.id, versionStatus: 'published', pageNo: 1, pageSize: 500 },
      })))
      const publishedVersions = versionPages.flatMap((page, pageIndex) => pageOf(page, `已发布模板版本分页响应[${pageIndex}]`, (row, index) => versionOf(row, `已发布模板版本[${pageIndex}].list[${index}]`)).list)
      return { projectTypes, templates, publishedVersions }
    },

    prepareCreate(input: TechnologyTypeTemplateMappingCreateInput) {
      return { draft: createDraftOf(input) }
    },

    prepareUpdate(input: TechnologyTypeTemplateMappingUpdateInput) {
      return updateDraftOf(input)
    },

    async create(input: { draft: TechnologyTypeTemplateMappingCreateDraft }): Promise<void> {
      const draft = createDraftOf(input?.draft)
      await request({ url: `${ROOT}/create`, method: 'post', data: { id: null, ...draft } })
    },

    async update(input: { draft: TechnologyTypeTemplateMappingSaveDraft }): Promise<void> {
      const draft = saveDraftOf(input?.draft)
      await request({ url: `${ROOT}/update`, method: 'put', data: draft })
    },

    prepareChangeStatus(input: TechnologyTypeTemplateMappingChangeStatusInput) {
      const value = objectOf(input, '类型模板映射启停输入')
      if (typeof value.enabled !== 'boolean') throw new Error('enabled必须为boolean')
      return { draft: { id: idOf(value.id, 'id'), enabled: value.enabled } }
    },

    async changeStatus(input: { draft: TechnologyTypeTemplateMappingChangeStatusInput }): Promise<void> {
      const draft = this.prepareChangeStatus(input?.draft).draft
      await request({
        url: `${ROOT}/${draft.enabled ? 'enable' : 'disable'}`,
        method: 'put',
        params: { id: draft.id },
        data: null,
      })
    },
  }
}

export type TechnologyTypeTemplateMappingCapability = ReturnType<typeof createTechnologyTypeTemplateMappingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
  ...(options === undefined ? {} : { options }),
})
const statusOptions = [{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]
const createParams: ParamSpec[] = [
  p('projectTypeId', 'search', true, '项目类型ID；来自references.projectTypes，不是项目类型编码'),
  p('templateVersionId', 'search', true, '已发布模板版本ID；来自与项目类型projectDomain相同的references.publishedVersions'),
  p('effectiveStartTime', 'date', true, '生效开始时间；Portal格式YYYY-MM-DD HH:mm:ss'),
  p('effectiveEndTime', 'date', false, '生效结束时间；null表示不设置结束时间，页面按不含该时刻解释'),
  p('status', 'enum', false, '数据库状态；默认enabled', statusOptions),
  p('remark', 'text', false, '变更原因；默认空字符串'),
]
const draftParam = p('draft', 'text', true, 'prepare能力返回的完整草稿；不要自行删除字段')

export const TECHNOLOGY_TYPE_TEMPLATE_MAPPING_METHODS = {
  'technology-type-template-mapping-list': 'list',
  'technology-type-template-mapping-references': 'references',
  'technology-type-template-mapping-prepare-create': 'prepareCreate',
  'technology-type-template-mapping-create': 'create',
  'technology-type-template-mapping-prepare-update': 'prepareUpdate',
  'technology-type-template-mapping-update': 'update',
  'technology-type-template-mapping-prepare-change-status': 'prepareChangeStatus',
  'technology-type-template-mapping-change-status': 'changeStatus',
} as const

export const technologyTypeTemplateMappingCapabilities: CapabilityDefinition[] = [
  { id: 'technology-type-template-mapping-list', title: '分页查询类型模板映射', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number'), p('projectTypeId', 'search', false, '按项目类型ID筛选；null表示不过滤')] },
  { id: 'technology-type-template-mapping-references', title: '查询类型模板映射候选', write: false, params: [] },
  { id: 'technology-type-template-mapping-prepare-create', title: '准备新增类型模板映射', write: false, params: createParams },
  { id: 'technology-type-template-mapping-create', title: '新增类型模板映射', write: true, params: [draftParam] },
  { id: 'technology-type-template-mapping-prepare-update', title: '准备编辑类型模板映射', write: false, params: [p('current', 'text', true, '最新列表行或此前准备结果中的完整当前值'), p('changes', 'text', false, '允许修改templateVersionId、effectiveStartTime、effectiveEndTime、status、remark；不能修改projectTypeId')] },
  { id: 'technology-type-template-mapping-update', title: '编辑类型模板映射', write: true, params: [draftParam] },
  { id: 'technology-type-template-mapping-prepare-change-status', title: '准备启停类型模板映射', write: false, params: [p('id', 'search', true, '映射记录ID'), p('enabled', 'boolean', true, '目标状态；true启用，false停用')] },
  { id: 'technology-type-template-mapping-change-status', title: '启停类型模板映射', write: true, params: [draftParam] },
].map(definition => ({
  ...definition,
  pagePath: TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PAGE_PATH,
  permission: TECHNOLOGY_TYPE_TEMPLATE_MAPPING_PERMISSION,
  httpInstance: 'platform',
}))
