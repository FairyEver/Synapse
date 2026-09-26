import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「技术设置 → 模板中心」；Portal 前端 acab69acc7。 */
export const TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH = '/dashboard/technology/setting/template/list'
export const TECHNOLOGY_SETTING_TEMPLATE_PERMISSION = '/dashboard/technology/setting/template'
/** 该路径不命中 Portal 的 module-type 规则，按浏览器约定不发送该头。 */
export const TECHNOLOGY_SETTING_TEMPLATE_MODULE_TYPE = null

const TEMPLATE_ROOT = '/admin-api/technology/setting/template'

export const TECHNOLOGY_SETTING_TEMPLATE_DOMAINS = ['biology', 'information', 'engineering'] as const
export const TECHNOLOGY_SETTING_TEMPLATE_STATUSES = [0, 1] as const
export const TECHNOLOGY_SETTING_TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'disabled'] as const

export type TechnologySettingTemplateId = string | number
export type TechnologySettingTemplateDomain = typeof TECHNOLOGY_SETTING_TEMPLATE_DOMAINS[number]
export type TechnologySettingTemplateStatus = typeof TECHNOLOGY_SETTING_TEMPLATE_STATUSES[number]
export type TechnologySettingTemplateVersionStatus = typeof TECHNOLOGY_SETTING_TEMPLATE_VERSION_STATUSES[number]

export type TechnologySettingTemplateRow = {
  id: TechnologySettingTemplateId
  templateCode: string
  templateName: string
  projectDomain: string
  status: number
  remark: string | null
  updateTime: string | number | null
}

export type TechnologySettingTemplateQuery = {
  pageNo?: number
  pageSize?: number
  code?: string | null
  name?: string | null
  projectDomain?: TechnologySettingTemplateDomain | null
}

export type TechnologySettingTemplateCreateInput = {
  templateCode: string
  templateName: string
  projectDomain: TechnologySettingTemplateDomain
  status?: TechnologySettingTemplateStatus
  remark?: string | null
}

export type TechnologySettingTemplateCreateForm = TechnologySettingTemplateCreateInput & {
  versionNo: string
  versionName: string
}

export type TechnologySettingTemplateUpdateChanges = {
  templateName?: string
  status?: TechnologySettingTemplateStatus
  remark?: string | null
}

export type TechnologySettingTemplateUpdateInput = {
  current: TechnologySettingTemplateRow | Omit<TechnologySettingTemplateRow, 'updateTime'>
  changes?: TechnologySettingTemplateUpdateChanges | null
}

export type TechnologySettingTemplateInitialVersionInput = {
  templateId: TechnologySettingTemplateId
  versionNo: string
  versionName: string
}

export type TechnologySettingTemplateVersionRow = {
  id: TechnologySettingTemplateId
  versionNo: string
  versionName: string
  versionStatus: string
  publishTime: string | number | null
}

export type TechnologySettingTemplateVersionQuery = {
  templateId: TechnologySettingTemplateId
}

export type TechnologySettingTemplateVersionInput = {
  templateId: TechnologySettingTemplateId
  sourceVersionId: TechnologySettingTemplateId | null
  versionNo: string
  versionName: string
  remark?: string | null
}

export type TechnologySettingTemplateVersionCopyInput = TechnologySettingTemplateVersionInput & {
  sourceVersionId: TechnologySettingTemplateId
}

export type TechnologySettingTemplateVersionActionInput = {
  id: TechnologySettingTemplateId
  currentStatus: string
}

export type TechnologySettingTemplateVersionConfigItem = Record<string, unknown> & {
  templateItemId: TechnologySettingTemplateId
  displayName: string
  isRequired: boolean
  sort: number
}

export type TechnologySettingTemplateVersionConfigNode = Record<string, unknown> & {
  sourceNodeId: TechnologySettingTemplateId
  parentSourceNodeId: TechnologySettingTemplateId | null
  sort: number
  items: TechnologySettingTemplateVersionConfigItem[]
  children: TechnologySettingTemplateVersionConfigNode[]
}

export type TechnologySettingTemplateVersionConfig = Record<string, unknown> & {
  templateVersionId?: TechnologySettingTemplateId | null
  templateName?: string | null
  projectDomain?: string | null
  versionNo?: string | null
  versionName?: string | null
  versionStatus: string
  editable: boolean
  updateTime?: string | number | null
  nodes: TechnologySettingTemplateVersionConfigNode[]
}

export type TechnologySettingTemplateVersionConfigSaveInput = {
  templateVersionId: TechnologySettingTemplateId
  nodes: readonly TechnologySettingTemplateVersionConfigNode[]
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf(value: unknown, label: string): TechnologySettingTemplateId {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为安全正整数或其十进制字符串`)
}

function nullableIdOf(value: unknown, label: string): TechnologySettingTemplateId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必填且不得全为空格`)
  return value
}

function nullableText(value: unknown, label: string, defaultValue: string | null = null): string | null {
  if (value === undefined) return defaultValue
  if (value === null || typeof value === 'string') return value
  throw new Error(`${label}必须为字符串或null`)
}

function domainOf(value: unknown, allowUnknown = false): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('项目大类必填')
  if (!allowUnknown && !TECHNOLOGY_SETTING_TEMPLATE_DOMAINS.includes(value as TechnologySettingTemplateDomain)) {
    throw new Error('项目大类只能是biology、information或engineering')
  }
  return value
}

function statusOf(value: unknown, label = 'status'): TechnologySettingTemplateStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function rowStatusOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('模板列表响应中的status必须为有限数值')
  return value
}

function versionStatusOf(value: unknown, label = 'versionStatus'): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}必须为非空字符串`)
  return value
}

function pageOf(value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  return Number(resolved)
}

function dateTimeOf(value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function sortOf(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error(`${label}必须为非负安全整数`)
}

function booleanOf(value: unknown, label: string): boolean {
  if (typeof value === 'boolean') return value
  if (value === 0) return false
  if (value === 1) return true
  throw new Error(`${label}必须为布尔值或0/1`)
}

function templateFieldsOf(input: unknown, includeId: false): {
  id: null
  templateCode: string
  templateName: string
  projectDomain: TechnologySettingTemplateDomain
  status: TechnologySettingTemplateStatus
  remark: string
}
function templateFieldsOf(input: unknown, includeId: true): {
  id: TechnologySettingTemplateId
  templateCode: string
  templateName: string
  projectDomain: string
  status: TechnologySettingTemplateStatus
  remark: string | null
}
function templateFieldsOf(input: unknown, includeId: boolean) {
  const value = objectOf(input, '模板基本信息')
  const result = {
    ...(includeId ? { id: idOf(value.id, '模板id') } : { id: null }),
    templateCode: requiredText(value.templateCode, '模板编码'),
    templateName: requiredText(value.templateName, '模板名称'),
    projectDomain: domainOf(value.projectDomain, includeId),
    status: statusOf(value.status ?? 0),
    remark: nullableText(value.remark, '备注', includeId ? null : '') as string | null,
  }
  return result
}

function initialVersionFieldsOf(input: unknown): { versionNo: string; versionName: string } {
  const value = objectOf(input, '初始版本表单')
  const versionNo = requiredText(value.versionNo, '版本号')
  const versionName = requiredText(value.versionName, '版本名称')
  if (versionNo.length > 32) throw new Error('版本号不能超过32个字符')
  if (versionName.length > 100) throw new Error('版本名称不能超过100个字符')
  return { versionNo, versionName }
}

function createTemplateInputOf(input: TechnologySettingTemplateCreateInput): TechnologySettingTemplateCreateInput & {
  status: TechnologySettingTemplateStatus
  remark: string
} {
  const value = objectOf(input, '新增模板输入')
  return {
    templateCode: requiredText(value.templateCode, '模板编码'),
    templateName: requiredText(value.templateName, '模板名称'),
    projectDomain: domainOf(value.projectDomain) as TechnologySettingTemplateDomain,
    status: statusOf(value.status ?? 0),
    remark: nullableText(value.remark, '备注', '') as string,
  }
}

function updateChangesOf(value: unknown): TechnologySettingTemplateUpdateChanges {
  const changes = objectOf(value ?? {}, '模板编辑变更')
  const allowed = new Set(['templateName', 'status', 'remark'])
  for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new Error(`模板编辑变更不支持字段${key}`)
  return {
    ...(changes.templateName === undefined ? {} : { templateName: requiredText(changes.templateName, '模板名称') }),
    ...(changes.status === undefined ? {} : { status: statusOf(changes.status) }),
    ...(changes.remark === undefined ? {} : { remark: nullableText(changes.remark, '备注') }),
  }
}

function updateOf(input: TechnologySettingTemplateUpdateInput): {
  draft: ReturnType<typeof templateFieldsOf>
  previous: ReturnType<typeof templateFieldsOf>
} {
  const current = objectOf(input?.current, '编辑模板当前值')
  const previous = templateFieldsOf(current, true)
  const draft = { ...previous, ...updateChangesOf(input?.changes) }
  return { draft, previous }
}

function templateRowOf(value: unknown): TechnologySettingTemplateRow {
  const row = objectOf(value, '模板列表行')
  return {
    id: idOf(row.id, '模板id'),
    templateCode: requiredText(row.templateCode, '模板列表响应中的templateCode'),
    templateName: requiredText(row.templateName, '模板列表响应中的templateName'),
    projectDomain: domainOf(row.projectDomain, true),
    status: rowStatusOf(row.status),
    remark: nullableText(row.remark, 'remark'),
    updateTime: dateTimeOf(row.updateTime, 'updateTime'),
  }
}

function versionInputOf(input: TechnologySettingTemplateVersionInput, requireSource: boolean): {
  templateId: TechnologySettingTemplateId
  sourceVersionId: TechnologySettingTemplateId | null
  versionNo: string
  versionName: string
  remark: string
} {
  const value = objectOf(input, requireSource ? '复制版本输入' : '新建版本输入')
  const sourceVersionId = nullableIdOf(value.sourceVersionId, '来源版本id')
  if (requireSource && sourceVersionId === null) throw new Error('复制版本必须提供来源版本id')
  return {
    templateId: idOf(value.templateId, '模板id'),
    sourceVersionId,
    versionNo: requiredText(value.versionNo, '版本号'),
    versionName: requiredText(value.versionName, '版本名称'),
    remark: nullableText(value.remark, '版本变更说明', '') as string,
  }
}

function versionRowOf(value: unknown): TechnologySettingTemplateVersionRow {
  const row = objectOf(value, '模板版本列表行')
  return {
    id: idOf(row.id, '版本id'),
    versionNo: requiredText(row.versionNo, '版本列表响应中的versionNo'),
    versionName: requiredText(row.versionName, '版本列表响应中的versionName'),
    versionStatus: versionStatusOf(row.versionStatus),
    publishTime: dateTimeOf(row.publishTime, 'publishTime'),
  }
}

function versionConfigItemOf(value: unknown, label: string): TechnologySettingTemplateVersionConfigItem {
  const item = objectOf(value, label)
  return {
    ...item,
    templateItemId: idOf(item.templateItemId, `${label}.templateItemId`),
    displayName: typeof item.displayName === 'string' ? item.displayName : (() => { throw new Error(`${label}.displayName必须为字符串`) })(),
    isRequired: booleanOf(item.isRequired, `${label}.isRequired`),
    sort: sortOf(item.sort, `${label}.sort`),
  }
}

function versionConfigNodeOf(value: unknown, label: string): TechnologySettingTemplateVersionConfigNode {
  const node = objectOf(value, label)
  const items = node.items === undefined ? [] : node.items
  const children = node.children === undefined ? [] : node.children
  if (!Array.isArray(items)) throw new Error(`${label}.items必须为数组`)
  if (!Array.isArray(children)) throw new Error(`${label}.children必须为数组`)
  return {
    ...node,
    sourceNodeId: idOf(node.sourceNodeId, `${label}.sourceNodeId`),
    parentSourceNodeId: nullableIdOf(node.parentSourceNodeId, `${label}.parentSourceNodeId`),
    sort: sortOf(node.sort, `${label}.sort`),
    items: items.map((item, index) => versionConfigItemOf(item, `${label}.items[${index}]`)),
    children: children.map((child, index) => versionConfigNodeOf(child, `${label}.children[${index}]`)),
  }
}

function versionConfigOf(value: unknown): TechnologySettingTemplateVersionConfig {
  const config = objectOf(value, '模板版本配置响应')
  if (typeof config.editable !== 'boolean') throw new Error('模板版本配置响应中的editable必须为布尔值')
  return {
    ...config,
    ...(config.templateVersionId === undefined ? {} : { templateVersionId: nullableIdOf(config.templateVersionId, 'templateVersionId') }),
    ...(config.templateName === undefined ? {} : { templateName: nullableText(config.templateName, 'templateName') }),
    ...(config.projectDomain === undefined ? {} : { projectDomain: config.projectDomain === null ? null : domainOf(config.projectDomain, true) }),
    ...(config.versionNo === undefined ? {} : { versionNo: nullableText(config.versionNo, 'versionNo') }),
    ...(config.versionName === undefined ? {} : { versionName: nullableText(config.versionName, 'versionName') }),
    versionStatus: versionStatusOf(config.versionStatus, '模板版本配置响应中的versionStatus'),
    editable: config.editable,
    ...(config.updateTime === undefined ? {} : { updateTime: dateTimeOf(config.updateTime, 'updateTime') }),
    nodes: Array.isArray(config.nodes)
      ? config.nodes.map((node, index) => versionConfigNodeOf(node, `模板版本配置响应.nodes[${index}]`))
      : (() => { throw new Error('模板版本配置响应中的nodes必须为数组') })(),
  }
}

function versionConfigSaveItemOf(value: unknown, label: string): Record<string, unknown> {
  const item = objectOf(value, label)
  return {
    templateItemId: idOf(item.templateItemId, `${label}.templateItemId`),
    displayName: typeof item.displayName === 'string' ? item.displayName : (() => { throw new Error(`${label}.displayName必须为字符串`) })(),
    isRequired: booleanOf(item.isRequired, `${label}.isRequired`),
    sort: sortOf(item.sort, `${label}.sort`),
  }
}

function versionConfigSaveNodeOf(value: unknown, label: string): Record<string, unknown> {
  const node = objectOf(value, label)
  if (!Array.isArray(node.items)) throw new Error(`${label}.items必须为数组`)
  return {
    sourceNodeId: idOf(node.sourceNodeId, `${label}.sourceNodeId`),
    parentSourceNodeId: nullableIdOf(node.parentSourceNodeId, `${label}.parentSourceNodeId`),
    sort: sortOf(node.sort, `${label}.sort`),
    items: node.items.map((item, index) => versionConfigSaveItemOf(item, `${label}.items[${index}]`)),
  }
}

function versionConfigSaveOf(input: TechnologySettingTemplateVersionConfigSaveInput): {
  templateVersionId: TechnologySettingTemplateId
  nodes: Record<string, unknown>[]
} {
  const value = objectOf(input, '模板版本配置保存输入')
  if (!Array.isArray(value.nodes)) throw new Error('模板版本配置保存输入.nodes必须为数组')
  return {
    templateVersionId: idOf(value.templateVersionId, 'templateVersionId'),
    nodes: value.nodes.map((node, index) => versionConfigSaveNodeOf(node, `模板版本配置保存输入.nodes[${index}]`)),
  }
}

function versionActionOf(input: TechnologySettingTemplateVersionActionInput, expected: string): TechnologySettingTemplateId {
  const value = objectOf(input, '版本状态操作')
  const id = idOf(value.id, '版本id')
  if (value.currentStatus !== expected) throw new Error(`只有${expected === 'draft' ? '草稿' : '已发布'}版本才能执行该操作`)
  return id
}

function createdIdOf(value: unknown, label: string): TechnologySettingTemplateId {
  return idOf(value, label)
}

/** The injected request must be bound to TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH. */
export function createTechnologySettingTemplateCapability(request: PortalRequest) {
  return {
    async list(query: TechnologySettingTemplateQuery = {}): Promise<PageResult<TechnologySettingTemplateRow>> {
      const source = query ?? {}
      const projectDomain = source.projectDomain ?? null
      if (projectDomain !== null) domainOf(projectDomain)
      const page = await request<PageResult<unknown>>({
        url: `${TEMPLATE_ROOT}/page`,
        method: 'get',
        params: {
          pageNo: pageOf(source.pageNo, 1, 'pageNo'),
          pageSize: pageOf(source.pageSize, 20, 'pageSize'),
          code: nullableText(source.code, '编码筛选'),
          name: nullableText(source.name, '名称筛选'),
          projectDomain,
        },
      })
      if (!page || !Array.isArray(page.list) || !Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error('模板分页响应缺少有效list或total')
      }
      return { list: page.list.map(templateRowOf), total: page.total }
    },

    prepareCreate(input: TechnologySettingTemplateCreateForm) {
      const value = objectOf(input, '新建模板表单')
      return {
        draft: {
          template: templateFieldsOf(createTemplateInputOf(value as TechnologySettingTemplateCreateInput), false),
          initialVersion: initialVersionFieldsOf(value),
        },
      }
    },

    async create(input: TechnologySettingTemplateCreateInput): Promise<TechnologySettingTemplateId> {
      const value = createTemplateInputOf(input)
      const result = await request<unknown>({
        url: `${TEMPLATE_ROOT}/create`,
        method: 'post',
        data: templateFieldsOf(value, false),
      })
      return createdIdOf(result, '模板新建id')
    },

    prepareUpdate(input: TechnologySettingTemplateUpdateInput) {
      return updateOf(input)
    },

    async update(input: TechnologySettingTemplateUpdateInput): Promise<void> {
      const { draft } = updateOf(input)
      await request({ url: `${TEMPLATE_ROOT}/update`, method: 'put', data: draft })
    },

    async remove(id: TechnologySettingTemplateId): Promise<void> {
      await request({ url: `${TEMPLATE_ROOT}/delete`, method: 'delete', params: { id: idOf(id, '模板id') } })
    },

    async listVersions(query: TechnologySettingTemplateVersionQuery): Promise<PageResult<TechnologySettingTemplateVersionRow>> {
      const templateId = idOf(query?.templateId, '模板id')
      const page = await request<PageResult<unknown>>({
        url: `${TEMPLATE_ROOT}/version/page`,
        method: 'get',
        params: { templateId, pageNo: 1, pageSize: 500 },
      })
      if (!page || !Array.isArray(page.list) || !Number.isSafeInteger(page.total) || page.total < 0) {
        throw new Error('模板版本分页响应缺少有效list或total')
      }
      return { list: page.list.map(versionRowOf), total: page.total }
    },

    async getVersionConfig(versionId: TechnologySettingTemplateId): Promise<TechnologySettingTemplateVersionConfig> {
      const templateVersionId = idOf(versionId, 'templateVersionId')
      return versionConfigOf(await request({
        url: `${TEMPLATE_ROOT}/version/config`,
        method: 'get',
        params: { templateVersionId },
      }))
    },

    prepareVersionConfigSave(input: TechnologySettingTemplateVersionConfigSaveInput) {
      return { draft: versionConfigSaveOf(input) }
    },

    async saveVersionConfig(input: TechnologySettingTemplateVersionConfigSaveInput | { draft: TechnologySettingTemplateVersionConfigSaveInput }): Promise<TechnologySettingTemplateVersionConfig> {
      const value = objectOf(input, '模板版本配置保存')
      const draft = versionConfigSaveOf(value.draft === undefined ? input as TechnologySettingTemplateVersionConfigSaveInput : value.draft as TechnologySettingTemplateVersionConfigSaveInput)
      return versionConfigOf(await request({
        url: `${TEMPLATE_ROOT}/version/config`,
        method: 'put',
        data: draft,
      }))
    },

    prepareInitialVersion(input: TechnologySettingTemplateInitialVersionInput) {
      const value = objectOf(input, '初始版本输入')
      return {
        draft: {
          templateId: idOf(value.templateId, '模板id'),
          ...initialVersionFieldsOf(value),
        },
      }
    },

    async createInitialVersion(input: TechnologySettingTemplateInitialVersionInput): Promise<TechnologySettingTemplateId> {
      const value = objectOf(input, '初始版本输入')
      const draft = {
        templateId: idOf(value.templateId, '模板id'),
        ...initialVersionFieldsOf(value),
      }
      const result = await request<unknown>({ url: `${TEMPLATE_ROOT}/version/create`, method: 'post', data: draft })
      return createdIdOf(result, '初始版本新建id')
    },

    prepareVersionCreate(input: TechnologySettingTemplateVersionInput) {
      return { draft: versionInputOf(input, false) }
    },

    async createVersion(input: TechnologySettingTemplateVersionInput): Promise<TechnologySettingTemplateId> {
      const draft = versionInputOf(input, false)
      const result = await request<unknown>({ url: `${TEMPLATE_ROOT}/version/create`, method: 'post', data: draft })
      return createdIdOf(result, '版本新建id')
    },

    prepareVersionCopy(input: TechnologySettingTemplateVersionCopyInput) {
      return { draft: versionInputOf(input, true) }
    },

    async copyVersion(input: TechnologySettingTemplateVersionCopyInput): Promise<TechnologySettingTemplateId> {
      const draft = versionInputOf(input, true)
      const result = await request<unknown>({ url: `${TEMPLATE_ROOT}/version/copy`, method: 'post', data: draft })
      return createdIdOf(result, '复制版本新建id')
    },

    async publishVersion(input: TechnologySettingTemplateVersionActionInput): Promise<void> {
      const id = versionActionOf(input, 'draft')
      await request({ url: `${TEMPLATE_ROOT}/version/publish`, method: 'post', params: { id }, data: null })
    },

    async disableVersion(input: TechnologySettingTemplateVersionActionInput): Promise<void> {
      const id = versionActionOf(input, 'published')
      await request({ url: `${TEMPLATE_ROOT}/version/disable`, method: 'put', params: { id }, data: null })
    },
  }
}

export type TechnologySettingTemplateCapability = ReturnType<typeof createTechnologySettingTemplateCapability>

const p = (
  name: string,
  kind: ParamSpec['kind'],
  required = false,
  description?: string,
  options?: ParamSpec['options'],
): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }), ...(options === undefined ? {} : { options }) })

const domainOptions = TECHNOLOGY_SETTING_TEMPLATE_DOMAINS.map(value => ({
  value,
  label: value === 'biology' ? '生物' : value === 'information' ? '信息' : '工程',
}))
const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const versionStatusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'disabled', label: '已停用' },
]
const templateCreateParams: ParamSpec[] = [
  p('templateCode', 'text', true, '模板编码；编辑时不可修改'),
  p('templateName', 'text', true, '模板名称'),
  p('projectDomain', 'enum', true, '项目大类', domainOptions),
  p('status', 'enum', false, '状态：0启用、1停用；默认0', statusOptions),
  p('remark', 'text', false, '模板备注；省略时按空字符串提交'),
]
const initialVersionParams: ParamSpec[] = [
  p('templateId', 'text', true, '刚创建的模板族ID'),
  p('versionNo', 'text', true, '首个版本号；最多32个字符'),
  p('versionName', 'text', true, '首个版本名称；最多100个字符'),
]
const versionParams: ParamSpec[] = [
  p('templateId', 'text', true, '模板族ID'),
  p('sourceVersionId', 'text', true, '复制来源版本ID；新建版本时传null'),
  p('versionNo', 'text', true, '版本号'),
  p('versionName', 'text', true, '版本名称'),
  p('remark', 'text', false, '版本变更说明；省略时按空字符串提交'),
]
const versionActionParams: ParamSpec[] = [
  p('id', 'text', true, '模板版本ID'),
  p('currentStatus', 'enum', true, '调用前列表行的当前绝对状态；只用于页面按钮前置校验，不发送给后端', versionStatusOptions),
]

export const TECHNOLOGY_SETTING_TEMPLATE_METHODS = {
  'technology-setting-template-list': 'list',
  'technology-setting-template-prepare-create': 'prepareCreate',
  'technology-setting-template-create': 'create',
  'technology-setting-template-prepare-update': 'prepareUpdate',
  'technology-setting-template-update': 'update',
  'technology-setting-template-remove': 'remove',
  'technology-setting-template-version-list': 'listVersions',
  'technology-setting-template-version-config-get': 'getVersionConfig',
  'technology-setting-template-version-config-prepare-save': 'prepareVersionConfigSave',
  'technology-setting-template-version-config-save': 'saveVersionConfig',
  'technology-setting-template-version-prepare-initial': 'prepareInitialVersion',
  'technology-setting-template-version-create-initial': 'createInitialVersion',
  'technology-setting-template-version-prepare-create': 'prepareVersionCreate',
  'technology-setting-template-version-create': 'createVersion',
  'technology-setting-template-version-prepare-copy': 'prepareVersionCopy',
  'technology-setting-template-version-copy': 'copyVersion',
  'technology-setting-template-version-publish': 'publishVersion',
  'technology-setting-template-version-disable': 'disableVersion',
} as const

export const technologySettingTemplateCapabilities: CapabilityDefinition[] = [
  { id: 'technology-setting-template-list', title: '查询模板中心模板族', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number'), p('code', 'text'), p('name', 'text'), p('projectDomain', 'enum', false, '项目大类筛选', domainOptions)] },
  { id: 'technology-setting-template-prepare-create', title: '准备新建模板族及首个版本', write: false, params: [...templateCreateParams, p('versionNo', 'text', true, '首个版本号；最多32个字符'), p('versionName', 'text', true, '首个版本名称；最多100个字符')] },
  { id: 'technology-setting-template-create', title: '新建模板族基本信息', write: true, params: templateCreateParams },
  { id: 'technology-setting-template-prepare-update', title: '准备编辑模板族基本信息', write: false, params: [p('current', 'text', true, '来自模板列表的完整当前行对象'), p('changes', 'text', false, '只包含模板名称、状态、备注的变更对象')] },
  { id: 'technology-setting-template-update', title: '编辑模板族基本信息', write: true, params: [p('current', 'text', true, '来自模板列表的完整当前行对象'), p('changes', 'text', false, '只包含模板名称、状态、备注的变更对象')] },
  { id: 'technology-setting-template-remove', title: '删除模板族', write: true, params: [p('id', 'text', true, '模板族ID')] },
  { id: 'technology-setting-template-version-list', title: '查询模板版本列表', write: false, params: [p('templateId', 'text', true, '模板族ID')] },
  { id: 'technology-setting-template-version-config-get', title: '查询模板版本配置', write: false, params: [p('versionId', 'text', true, '模板版本ID；来自版本列表行.id')] },
  { id: 'technology-setting-template-version-config-prepare-save', title: '准备保存模板版本配置', write: false, params: [p('templateVersionId', 'text', true, '模板版本ID'), p('nodes', 'text', true, '页面构造的扁平节点配置数组；每项含sourceNodeId、parentSourceNodeId、sort和items')] },
  { id: 'technology-setting-template-version-config-save', title: '保存模板版本配置', write: true, params: [p('templateVersionId', 'text', true, '模板版本ID'), p('nodes', 'text', true, '页面构造的扁平节点配置数组；配置项只提交templateItemId、displayName、isRequired、sort')] },
  { id: 'technology-setting-template-version-prepare-initial', title: '准备新建首个模板版本', write: false, params: initialVersionParams },
  { id: 'technology-setting-template-version-create-initial', title: '新建首个模板版本', write: true, params: initialVersionParams },
  { id: 'technology-setting-template-version-prepare-create', title: '准备新建模板版本', write: false, params: versionParams },
  { id: 'technology-setting-template-version-create', title: '新建模板版本', write: true, params: versionParams },
  { id: 'technology-setting-template-version-prepare-copy', title: '准备复制模板版本', write: false, params: versionParams },
  { id: 'technology-setting-template-version-copy', title: '复制模板版本为草稿', write: true, params: versionParams },
  { id: 'technology-setting-template-version-publish', title: '发布模板版本', write: true, params: versionActionParams },
  { id: 'technology-setting-template-version-disable', title: '停用模板版本', write: true, params: versionActionParams },
].map(definition => ({
  ...definition,
  pagePath: TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH,
  permission: TECHNOLOGY_SETTING_TEMPLATE_PERMISSION,
  httpInstance: 'platform',
  moduleType: TECHNOLOGY_SETTING_TEMPLATE_MODULE_TYPE,
}))
