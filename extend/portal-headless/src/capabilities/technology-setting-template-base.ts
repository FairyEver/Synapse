import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/** Portal 科技设置 → 模板基础配置；页面来源为 Portal acab69acc7。 */
export const TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH = '/dashboard/technology/setting/template-base/list'
export const TECHNOLOGY_SETTING_TEMPLATE_BASE_PERMISSION = '/dashboard/technology/setting/template-base'
/** Portal 的 technology 菜单没有 module-type 规则，故与浏览器一样不发送该头。 */
export const TECHNOLOGY_SETTING_TEMPLATE_BASE_MODULE_TYPE = null

const ITEM_ROOT = '/admin-api/technology/setting/template-item'
const NODE_ROOT = '/admin-api/technology/setting/template-node'

export const TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS = ['biology', 'information', 'engineering'] as const
export const TECHNOLOGY_SETTING_TEMPLATE_BASE_ITEM_TYPES = ['field', 'component'] as const
export const TECHNOLOGY_SETTING_TEMPLATE_BASE_STATUSES = [0, 1] as const

export type TechnologySettingTemplateBaseId = string | number
export type TechnologySettingTemplateBaseDomain = typeof TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS[number]
export type TechnologySettingTemplateBaseItemType = typeof TECHNOLOGY_SETTING_TEMPLATE_BASE_ITEM_TYPES[number]
export type TechnologySettingTemplateBaseStatus = typeof TECHNOLOGY_SETTING_TEMPLATE_BASE_STATUSES[number]

export type TechnologySettingTemplateBaseItemQuery = {
  pageNo?: number
  pageSize?: number
  code?: string | null
  name?: string | null
  projectDomain?: TechnologySettingTemplateBaseDomain | null
  itemType?: TechnologySettingTemplateBaseItemType | null
}

export type TechnologySettingTemplateBaseItemSimpleQuery = {
  projectDomain?: TechnologySettingTemplateBaseDomain | null
  status?: TechnologySettingTemplateBaseStatus
}

export type TechnologySettingTemplateBaseItemRow = {
  id: TechnologySettingTemplateBaseId
  itemCode: string
  itemName: string
  itemType: string
  projectDomainCodes: string
  mustSelect: boolean
  status: number
  remark: string | null
  updateTime: string | number | null
}

export type TechnologySettingTemplateBaseItemOption = Record<string, unknown> & {
  id: TechnologySettingTemplateBaseId
  itemCode: string
  itemName: string
  itemType: string
  mustSelect: boolean
}

export type TechnologySettingTemplateBaseItemCreateDraft = {
  itemCode: string
  itemName: string
  itemType: TechnologySettingTemplateBaseItemType
  domainValues: TechnologySettingTemplateBaseDomain[]
  mustSelect?: boolean
  status?: TechnologySettingTemplateBaseStatus
  remark?: string | null
}

export type TechnologySettingTemplateBaseItemSaveDraft = {
  id: TechnologySettingTemplateBaseId
  itemCode: string
  itemName: string
  itemType: string
  projectDomainCodes: string
  mustSelect: boolean
  status: number
  remark: string | null
}

export type TechnologySettingTemplateBaseItemChanges = {
  itemName?: string
  itemType?: TechnologySettingTemplateBaseItemType
  domainValues?: TechnologySettingTemplateBaseDomain[]
  mustSelect?: boolean
  status?: TechnologySettingTemplateBaseStatus
  remark?: string | null
}

export type TechnologySettingTemplateBaseItemUpdateInput = {
  current: TechnologySettingTemplateBaseItemRow | TechnologySettingTemplateBaseItemSaveDraft
  changes?: TechnologySettingTemplateBaseItemChanges | null
}

export type TechnologySettingTemplateBaseNodeQuery = {
  projectDomain?: TechnologySettingTemplateBaseDomain
}

export type TechnologySettingTemplateBaseNodeRow = {
  id: TechnologySettingTemplateBaseId
  nodeCode: string
  nodeName: string
  projectDomain: string
  parentId: TechnologySettingTemplateBaseId | 0 | null
  sort: number | null
  status: number
  remark: string | null
  path?: string | null
  leaf?: boolean
  depth?: number
  children?: TechnologySettingTemplateBaseNodeRow[]
}

export type TechnologySettingTemplateBaseNodeCreateDraft = {
  nodeCode: string
  nodeName: string
  projectDomain?: TechnologySettingTemplateBaseDomain
  parentId?: TechnologySettingTemplateBaseId | 0 | null
  sort?: number | null
  status?: TechnologySettingTemplateBaseStatus
  remark?: string | null
}

export type TechnologySettingTemplateBaseNodeSaveDraft = {
  id: TechnologySettingTemplateBaseId
  nodeCode: string
  nodeName: string
  projectDomain: string
  parentId: TechnologySettingTemplateBaseId | 0
  sort: number | null
  status: number
  remark: string | null
  [key: string]: unknown
}

export type TechnologySettingTemplateBaseNodeChanges = {
  nodeName?: string
  parentId?: TechnologySettingTemplateBaseId | 0 | null
  sort?: number | null
  status?: TechnologySettingTemplateBaseStatus
  remark?: string | null
}

export type TechnologySettingTemplateBaseNodeUpdateInput = {
  current: TechnologySettingTemplateBaseNodeRow | TechnologySettingTemplateBaseNodeSaveDraft
  changes?: TechnologySettingTemplateBaseNodeChanges | null
}

type ObjectValue = Record<string, unknown>

function objectOf(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + '必须是对象')
  return value as ObjectValue
}

function idOf(value: unknown, label: string): TechnologySettingTemplateBaseId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(label + '必须为安全正整数或其十进制字符串')
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(label + '必填且不得全为空格')
  return value
}

function textOf(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(label + '必须为字符串')
  return value
}

function nullableText(value: unknown, label: string, defaultValue: string | null = null): string | null {
  if (value === undefined) return defaultValue
  if (value === null || typeof value === 'string') return value
  throw new Error(label + '必须为字符串或null')
}

function domainOf(value: unknown, allowUnknown = false): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('项目大类必填')
  if (!allowUnknown && !TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS.includes(value as TechnologySettingTemplateBaseDomain)) {
    throw new Error('项目大类只能是biology、information或engineering')
  }
  return value
}

function itemTypeOf(value: unknown, allowUnknown = false): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('配置项类型必填')
  if (!allowUnknown && !TECHNOLOGY_SETTING_TEMPLATE_BASE_ITEM_TYPES.includes(value as TechnologySettingTemplateBaseItemType)) {
    throw new Error('配置项类型只能是field或component')
  }
  return value
}

function statusOf(value: unknown, label = '状态'): TechnologySettingTemplateBaseStatus {
  if (value !== 0 && value !== 1) throw new Error(label + '只能是数值0（启用）或1（停用）')
  return value
}

function rowStatusOf(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(label + '必须为有限数值')
  return value
}

function booleanOf(value: unknown, label: string, defaultValue?: boolean): boolean {
  const resolved = value === undefined ? defaultValue : value
  if (typeof resolved !== 'boolean') throw new Error(label + '必须为布尔值')
  return resolved
}

function pageNumber(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved < 1) throw new Error(label + '必须为正整数')
  return resolved
}

function dateTimeOf(value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(label + '必须为字符串、有限数字或null')
}

function domainValuesOf(value: unknown, label: string, allowUnknown = false): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(label + '至少选择一个项目大类')
  if (value.some(item => typeof item !== 'string' || item.length === 0)) throw new Error(label + '必须为非空字符串数组')
  const values = value as string[]
  if (new Set(values).size !== values.length) throw new Error(label + '不能重复')
  if (!allowUnknown && values.some(item => !TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS.includes(item as TechnologySettingTemplateBaseDomain))) {
    throw new Error(label + '只能取页面提供的项目大类')
  }
  return values
}

function projectDomainCodesOf(value: unknown, label: string, allowUnknown = false): string[] {
  if (typeof value !== 'string') throw new Error(label + '必须为逗号分隔字符串')
  return domainValuesOf(value.split(',').filter(item => item.length > 0), label, allowUnknown)
}

function projectDomainCodesValue(value: unknown, label: string, allowUnknown = false): string {
  return projectDomainCodesOf(value, label, allowUnknown).sort().join(',')
}

function parentIdOf(value: unknown, label: string): TechnologySettingTemplateBaseId | 0 | null {
  if (value === undefined || value === null || value === '') return null
  if (value === 0) return 0
  return idOf(value, label)
}

function parentIdPayload(value: unknown, label: string): TechnologySettingTemplateBaseId | 0 {
  return parentIdOf(value, label) ?? 0
}

function sortOf(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('排序必须为非负有限数或null')
  return value
}

function itemRowOf(rawValue: unknown): TechnologySettingTemplateBaseItemRow {
  const raw = objectOf(rawValue, '模板配置项列表行')
  return {
    id: idOf(raw.id, '模板配置项id'),
    itemCode: requiredText(raw.itemCode, '模板配置项响应中的itemCode'),
    itemName: requiredText(raw.itemName, '模板配置项响应中的itemName'),
    itemType: itemTypeOf(raw.itemType, true),
    projectDomainCodes: textOf(raw.projectDomainCodes, '模板配置项响应中的projectDomainCodes'),
    mustSelect: booleanOf(raw.mustSelect, '模板配置项响应中的mustSelect'),
    status: rowStatusOf(raw.status, '模板配置项响应中的status'),
    remark: nullableText(raw.remark, '模板配置项响应中的remark'),
    updateTime: dateTimeOf(raw.updateTime, '模板配置项响应中的updateTime'),
  }
}

function itemOptionOf(rawValue: unknown): TechnologySettingTemplateBaseItemOption {
  const raw = objectOf(rawValue, '模板配置项候选')
  return {
    ...raw,
    id: idOf(raw.id, '模板配置项候选id'),
    itemCode: requiredText(raw.itemCode, '模板配置项候选中的itemCode'),
    itemName: requiredText(raw.itemName, '模板配置项候选中的itemName'),
    itemType: itemTypeOf(raw.itemType, true),
    mustSelect: booleanOf(raw.mustSelect, '模板配置项候选中的mustSelect'),
  }
}

function itemCreateDraftOf(input: unknown): {
  itemCode: string
  itemName: string
  itemType: TechnologySettingTemplateBaseItemType
  domainValues: TechnologySettingTemplateBaseDomain[]
  mustSelect: boolean
  status: TechnologySettingTemplateBaseStatus
  remark: string | null
} {
  const value = objectOf(input, '模板配置项新增表单')
  return {
    itemCode: requiredText(value.itemCode, '配置项编码'),
    itemName: requiredText(value.itemName, '配置项名称'),
    itemType: itemTypeOf(value.itemType) as TechnologySettingTemplateBaseItemType,
    domainValues: domainValuesOf(value.domainValues, '适用项目大类') as TechnologySettingTemplateBaseDomain[],
    mustSelect: booleanOf(value.mustSelect, '发布必选', false),
    status: statusOf(value.status === undefined ? 0 : value.status),
    remark: nullableText(value.remark, '备注', ''),
  }
}

function itemCreatePayloadOf(input: unknown): {
  id: null
  itemCode: string
  itemName: string
  itemType: TechnologySettingTemplateBaseItemType
  projectDomainCodes: string
  mustSelect: boolean
  status: TechnologySettingTemplateBaseStatus
  remark: string | null
} {
  const value = objectOf(input, '模板配置项新增草稿')
  const form = value.domainValues === undefined
    ? {
        itemCode: value.itemCode,
        itemName: value.itemName,
        itemType: value.itemType,
        domainValues: projectDomainCodesOf(value.projectDomainCodes, '适用项目大类'),
        mustSelect: value.mustSelect,
        status: value.status,
        remark: value.remark,
      }
    : value
  const draft = itemCreateDraftOf(form)
  if (value.id !== undefined && value.id !== null) throw new Error('新增模板配置项的id必须为null')
  return {
    id: null,
    itemCode: draft.itemCode,
    itemName: draft.itemName,
    itemType: draft.itemType,
    projectDomainCodes: [...draft.domainValues].sort().join(','),
    mustSelect: draft.mustSelect,
    status: draft.status,
    remark: draft.remark,
  }
}

function itemSaveDraftOf(input: unknown, allowUnknown: boolean): TechnologySettingTemplateBaseItemSaveDraft {
  const value = objectOf(input, '模板配置项保存草稿')
  return {
    id: idOf(value.id, '模板配置项id'),
    itemCode: requiredText(value.itemCode, '配置项编码'),
    itemName: requiredText(value.itemName, '配置项名称'),
    itemType: itemTypeOf(value.itemType, allowUnknown),
    projectDomainCodes: projectDomainCodesValue(value.projectDomainCodes, '适用项目大类', allowUnknown),
    mustSelect: booleanOf(value.mustSelect, '发布必选'),
    status: allowUnknown ? rowStatusOf(value.status, '状态') : statusOf(value.status),
    remark: nullableText(value.remark, '备注'),
  }
}

function itemPreviousOf(row: TechnologySettingTemplateBaseItemRow): TechnologySettingTemplateBaseItemSaveDraft {
  return {
    id: row.id,
    itemCode: row.itemCode,
    itemName: row.itemName,
    itemType: row.itemType,
    projectDomainCodes: projectDomainCodesValue(row.projectDomainCodes, '适用项目大类', true),
    mustSelect: row.mustSelect,
    status: row.status,
    remark: row.remark,
  }
}

function itemChangesOf(input: unknown): Partial<TechnologySettingTemplateBaseItemSaveDraft> {
  const value = input === undefined || input === null ? {} : objectOf(input, '模板配置项编辑变更')
  const changes: Partial<TechnologySettingTemplateBaseItemSaveDraft> = {}
  if (value.itemName !== undefined) changes.itemName = requiredText(value.itemName, '配置项名称')
  if (value.itemType !== undefined) changes.itemType = itemTypeOf(value.itemType) as TechnologySettingTemplateBaseItemType
  if (value.domainValues !== undefined) changes.projectDomainCodes = domainValuesOf(value.domainValues, '适用项目大类').sort().join(',')
  if (value.mustSelect !== undefined) changes.mustSelect = booleanOf(value.mustSelect, '发布必选')
  if (value.status !== undefined) changes.status = statusOf(value.status)
  if (value.remark !== undefined) changes.remark = nullableText(value.remark, '备注')
  return changes
}

function nodeRowOf(rawValue: unknown): TechnologySettingTemplateBaseNodeRow {
  const raw = objectOf(rawValue, '模板节点树节点')
  const row: TechnologySettingTemplateBaseNodeRow = {
    ...raw,
    id: idOf(raw.id, '模板节点id'),
    nodeCode: requiredText(raw.nodeCode, '模板节点响应中的nodeCode'),
    nodeName: requiredText(raw.nodeName, '模板节点响应中的nodeName'),
    projectDomain: domainOf(raw.projectDomain, true),
    parentId: parentIdOf(raw.parentId, '模板节点响应中的parentId'),
    sort: sortOf(raw.sort, null),
    status: rowStatusOf(raw.status, '模板节点响应中的status'),
    remark: nullableText(raw.remark, '模板节点响应中的remark'),
  }
  if (raw.path !== undefined) row.path = nullableText(raw.path, '模板节点响应中的path')
  if (raw.leaf !== undefined) row.leaf = booleanOf(raw.leaf, '模板节点响应中的leaf')
  if (raw.depth !== undefined) {
    if (typeof raw.depth !== 'number' || !Number.isFinite(raw.depth)) throw new Error('模板节点响应中的depth必须为有限数值')
    row.depth = raw.depth
  }
  if (raw.children !== undefined) {
    if (!Array.isArray(raw.children)) throw new Error('模板节点响应中的children必须为数组')
    row.children = raw.children.map(nodeRowOf)
  }
  return row
}

function nodeCreateDraftOf(input: unknown): {
  nodeCode: string
  nodeName: string
  projectDomain: TechnologySettingTemplateBaseDomain
  parentId: TechnologySettingTemplateBaseId | 0
  sort: number | null
  status: TechnologySettingTemplateBaseStatus
  remark: string | null
} {
  const value = objectOf(input, '模板节点新增表单')
  return {
    nodeCode: requiredText(value.nodeCode, '节点编码'),
    nodeName: requiredText(value.nodeName, '节点名称'),
    projectDomain: domainOf(value.projectDomain === undefined ? 'biology' : value.projectDomain) as TechnologySettingTemplateBaseDomain,
    parentId: parentIdPayload(value.parentId, '父节点id'),
    sort: sortOf(value.sort, 0),
    status: statusOf(value.status === undefined ? 0 : value.status),
    remark: nullableText(value.remark, '备注', ''),
  }
}

function nodeSaveDraftOf(input: unknown, allowUnknown: boolean): TechnologySettingTemplateBaseNodeSaveDraft {
  const value = objectOf(input, '模板节点保存草稿')
  const raw: ObjectValue = { ...value }
  return {
    ...raw,
    id: idOf(value.id, '模板节点id'),
    nodeCode: requiredText(value.nodeCode, '节点编码'),
    nodeName: requiredText(value.nodeName, '节点名称'),
    projectDomain: domainOf(value.projectDomain, allowUnknown),
    parentId: parentIdPayload(value.parentId, '父节点id'),
    sort: sortOf(value.sort, null),
    status: allowUnknown ? rowStatusOf(value.status, '状态') : statusOf(value.status),
    remark: nullableText(value.remark, '备注'),
  }
}

function nodePreviousOf(row: TechnologySettingTemplateBaseNodeRow): TechnologySettingTemplateBaseNodeSaveDraft {
  return nodeSaveDraftOf(row, true)
}

function nodeChangesOf(input: unknown): Partial<TechnologySettingTemplateBaseNodeSaveDraft> {
  const value = input === undefined || input === null ? {} : objectOf(input, '模板节点编辑变更')
  const changes: Partial<TechnologySettingTemplateBaseNodeSaveDraft> = {}
  if (value.nodeName !== undefined) changes.nodeName = requiredText(value.nodeName, '节点名称')
  if (value.parentId !== undefined) changes.parentId = parentIdPayload(value.parentId, '父节点id')
  if (value.sort !== undefined) changes.sort = sortOf(value.sort, null)
  if (value.status !== undefined) changes.status = statusOf(value.status)
  if (value.remark !== undefined) changes.remark = nullableText(value.remark, '备注')
  return changes
}

function unwrapDraft(input: unknown): unknown {
  const value = objectOf(input, '保存参数')
  return value.draft === undefined ? input : value.draft
}

function removeId(input: unknown, label: string): TechnologySettingTemplateBaseId {
  if (input !== null && typeof input === 'object' && !Array.isArray(input) && 'id' in input) {
    return idOf((input as ObjectValue).id, label)
  }
  return idOf(input, label)
}

function pageResultOf(value: unknown, label: string): PageResult<ObjectValue> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list)) throw new Error(label + '.list必须为数组')
  if (typeof page.total !== 'number' || !Number.isFinite(page.total) || page.total < 0) throw new Error(label + '.total必须为非负有限数值')
  return { list: page.list as ObjectValue[], total: page.total }
}

function treeOf(value: unknown): TechnologySettingTemplateBaseNodeRow[] {
  if (!Array.isArray(value)) throw new Error('模板节点树响应必须为数组')
  return value.map(nodeRowOf)
}

/** 注入的 request 必须由 createPageCall(TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH) 包装。 */
export function createTechnologySettingTemplateBaseCapability(request: PortalRequest) {
  function prepareItemUpdate(input: TechnologySettingTemplateBaseItemUpdateInput) {
    const current = itemRowOf(input?.current)
    const previous = itemPreviousOf(current)
    const draft = itemSaveDraftOf({ ...previous, ...itemChangesOf(input?.changes) }, true)
    return { draft, previous }
  }

  function prepareNodeUpdate(input: TechnologySettingTemplateBaseNodeUpdateInput) {
    const current = nodeRowOf(input?.current)
    const previous = nodePreviousOf(current)
    const draft = nodeSaveDraftOf({ ...previous, ...nodeChangesOf(input?.changes) }, true)
    return { draft, previous }
  }

  return {
    async itemList(query: TechnologySettingTemplateBaseItemQuery = {}): Promise<PageResult<TechnologySettingTemplateBaseItemRow>> {
      const pageNo = pageNumber(query.pageNo, 1, 'pageNo')
      const pageSize = pageNumber(query.pageSize, 20, 'pageSize')
      if (![10, 20, 50, 100].includes(pageSize)) throw new Error('pageSize只能是10、20、50或100')
      const projectDomain = query.projectDomain ?? null
      const itemType = query.itemType ?? null
      if (projectDomain !== null) domainOf(projectDomain)
      if (itemType !== null) itemTypeOf(itemType)
      const page = pageResultOf(await request<PageResult<ObjectValue>>({
        url: ITEM_ROOT + '/page',
        method: 'get',
        params: {
          pageNo,
          pageSize,
          code: query.code ?? null,
          name: query.name ?? null,
          projectDomain,
          itemType,
        },
      }), '模板配置项分页响应')
      return { list: page.list.map(itemRowOf), total: page.total }
    },

    async itemSimpleList(query: TechnologySettingTemplateBaseItemSimpleQuery = {}): Promise<TechnologySettingTemplateBaseItemOption[]> {
      const projectDomain = query.projectDomain ?? null
      if (projectDomain !== null) domainOf(projectDomain)
      const status = statusOf(query.status ?? 0)
      const items = await request<unknown>({
        url: ITEM_ROOT + '/simple-list',
        method: 'get',
        params: { projectDomain, status },
      })
      if (!Array.isArray(items)) throw new Error('模板配置项候选响应必须为数组')
      return items.map(itemOptionOf)
    },

    prepareItemCreate(input: TechnologySettingTemplateBaseItemCreateDraft) {
      const draft = itemCreateDraftOf(input)
      return {
        draft: {
          id: null,
          itemCode: draft.itemCode,
          itemName: draft.itemName,
          itemType: draft.itemType,
          projectDomainCodes: [...draft.domainValues].sort().join(','),
          mustSelect: draft.mustSelect,
          status: draft.status,
          remark: draft.remark,
        },
      }
    },

    async itemCreate(input: TechnologySettingTemplateBaseItemCreateDraft | { draft: ObjectValue }): Promise<void> {
      const draft = itemCreatePayloadOf(unwrapDraft(input))
      await request({
        url: ITEM_ROOT + '/create',
        method: 'post',
        data: draft,
      })
    },

    prepareItemUpdate,

    async itemUpdate(input: TechnologySettingTemplateBaseItemUpdateInput | { draft: ObjectValue }): Promise<void> {
      const value = objectOf(input, '模板配置项编辑参数')
      const draft = 'draft' in value
        ? itemSaveDraftOf(unwrapDraft(input), true)
        : 'current' in value
          ? prepareItemUpdate(input as TechnologySettingTemplateBaseItemUpdateInput).draft
          : itemSaveDraftOf(input, true)
      await request({ url: ITEM_ROOT + '/update', method: 'put', data: draft })
    },

    prepareItemRemove(input: { id: TechnologySettingTemplateBaseId } | TechnologySettingTemplateBaseItemRow) {
      return { id: removeId(input, '模板配置项id') }
    },

    async itemRemove(input: TechnologySettingTemplateBaseId | { id: TechnologySettingTemplateBaseId }): Promise<void> {
      await request({ url: ITEM_ROOT + '/delete', method: 'delete', params: { id: removeId(input, '模板配置项id') } })
    },

    async nodeList(query: TechnologySettingTemplateBaseNodeQuery = {}): Promise<TechnologySettingTemplateBaseNodeRow[]> {
      const projectDomain = query.projectDomain ?? 'biology'
      domainOf(projectDomain)
      const tree = await request<unknown>({
        url: NODE_ROOT + '/tree',
        method: 'get',
        params: { projectDomain },
      })
      return treeOf(tree)
    },

    prepareNodeCreate(input: TechnologySettingTemplateBaseNodeCreateDraft) {
      return { draft: nodeCreateDraftOf(input) }
    },

    async nodeCreate(input: TechnologySettingTemplateBaseNodeCreateDraft | { draft: ObjectValue }): Promise<void> {
      const draft = nodeCreateDraftOf(unwrapDraft(input))
      await request({
        url: NODE_ROOT + '/create',
        method: 'post',
        data: { id: null, ...draft },
      })
    },

    prepareNodeUpdate,

    async nodeUpdate(input: TechnologySettingTemplateBaseNodeUpdateInput | { draft: ObjectValue }): Promise<void> {
      const value = objectOf(input, '模板节点编辑参数')
      const draft = 'draft' in value
        ? nodeSaveDraftOf(unwrapDraft(input), true)
        : 'current' in value
          ? prepareNodeUpdate(input as TechnologySettingTemplateBaseNodeUpdateInput).draft
          : nodeSaveDraftOf(input, true)
      await request({ url: NODE_ROOT + '/update', method: 'put', data: draft })
    },

    prepareNodeRemove(input: { id: TechnologySettingTemplateBaseId } | TechnologySettingTemplateBaseNodeRow) {
      return { id: removeId(input, '模板节点id') }
    },

    async nodeRemove(input: TechnologySettingTemplateBaseId | { id: TechnologySettingTemplateBaseId }): Promise<void> {
      await request({ url: NODE_ROOT + '/delete', method: 'delete', params: { id: removeId(input, '模板节点id') } })
    },
  }
}

export type TechnologySettingTemplateBaseCapability = ReturnType<typeof createTechnologySettingTemplateBaseCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
  ...(options === undefined ? {} : { options }),
})

const domains = TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS.map(value => ({
  value,
  label: value === 'biology' ? '生物' : value === 'information' ? '信息' : '工程',
}))
const itemTypes = [{ value: 'field', label: '字段' }, { value: 'component', label: '业务组件' }]
const statuses = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const itemCreateParams: ParamSpec[] = [
  p('itemCode', 'text', true, '配置项编码；新增后编辑页禁用'),
  p('itemName', 'text', true),
  p('itemType', 'enum', true, undefined, itemTypes),
  p('domainValues', 'enum', true, '页面多选值；提交时映射为排序后的projectDomainCodes字符串', domains),
  p('mustSelect', 'boolean'),
  p('status', 'enum', false, undefined, statuses),
  p('remark', 'text'),
]
const itemUpdateParams: ParamSpec[] = [
  p('current', 'text', true, '列表行或prepareItemUpdate返回的完整当前值'),
  p('changes', 'text', false, '只允许修改itemName/itemType/domainValues/mustSelect/status/remark'),
]
const nodeCreateParams: ParamSpec[] = [
  p('nodeCode', 'text', true, '节点编码；编辑时禁用'),
  p('nodeName', 'text', true),
  p('projectDomain', 'enum', false, '省略时按页面默认biology', domains),
  p('parentId', 'text', false, '空值表示根节点，提交映射为0'),
  p('sort', 'number'),
  p('status', 'enum', false, undefined, statuses),
  p('remark', 'text'),
]
const nodeUpdateParams: ParamSpec[] = [
  p('current', 'text', true, '树节点或prepareNodeUpdate返回的完整当前值；包含页面回传的children/path等扩展字段'),
  p('changes', 'text', false, '只允许修改nodeName/parentId/sort/status/remark'),
]

export const TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS = {
  'technology-setting-template-base-item-simple-list': 'itemSimpleList',
  'technology-setting-template-base-item-list': 'itemList',
  'technology-setting-template-base-item-prepare-create': 'prepareItemCreate',
  'technology-setting-template-base-item-create': 'itemCreate',
  'technology-setting-template-base-item-prepare-update': 'prepareItemUpdate',
  'technology-setting-template-base-item-update': 'itemUpdate',
  'technology-setting-template-base-item-prepare-remove': 'prepareItemRemove',
  'technology-setting-template-base-item-remove': 'itemRemove',
  'technology-setting-template-base-node-list': 'nodeList',
  'technology-setting-template-base-node-prepare-create': 'prepareNodeCreate',
  'technology-setting-template-base-node-create': 'nodeCreate',
  'technology-setting-template-base-node-prepare-update': 'prepareNodeUpdate',
  'technology-setting-template-base-node-update': 'nodeUpdate',
  'technology-setting-template-base-node-prepare-remove': 'prepareNodeRemove',
  'technology-setting-template-base-node-remove': 'nodeRemove',
} as const

export const technologySettingTemplateBaseCapabilities: CapabilityDefinition[] = [
  { id: 'technology-setting-template-base-item-simple-list', title: '查询启用模板配置项候选', write: false, params: [p('projectDomain', 'enum', false, '项目大类；编辑器按版本配置返回值传入', domains), p('status', 'enum', false, '状态：默认0启用', statuses)] },
  { id: 'technology-setting-template-base-item-list', title: '查询模板配置项库', write: false, params: [p('pageNo', 'number'), p('pageSize', 'number'), p('code', 'text'), p('name', 'text'), p('projectDomain', 'enum', false, undefined, domains), p('itemType', 'enum', false, undefined, itemTypes)] },
  { id: 'technology-setting-template-base-item-prepare-create', title: '准备新增模板配置项', write: false, params: itemCreateParams },
  { id: 'technology-setting-template-base-item-create', title: '新增模板配置项', write: true, params: itemCreateParams },
  { id: 'technology-setting-template-base-item-prepare-update', title: '准备编辑模板配置项', write: false, params: itemUpdateParams },
  { id: 'technology-setting-template-base-item-update', title: '编辑模板配置项', write: true, params: itemUpdateParams },
  { id: 'technology-setting-template-base-item-prepare-remove', title: '准备删除模板配置项', write: false, params: [p('id', 'text', true)] },
  { id: 'technology-setting-template-base-item-remove', title: '删除模板配置项', write: true, params: [p('id', 'text', true)] },
  { id: 'technology-setting-template-base-node-list', title: '查询模板节点库', write: false, params: [p('projectDomain', 'enum', false, '省略时为biology', domains)] },
  { id: 'technology-setting-template-base-node-prepare-create', title: '准备新增模板节点', write: false, params: nodeCreateParams },
  { id: 'technology-setting-template-base-node-create', title: '新增模板节点', write: true, params: nodeCreateParams },
  { id: 'technology-setting-template-base-node-prepare-update', title: '准备编辑模板节点', write: false, params: nodeUpdateParams },
  { id: 'technology-setting-template-base-node-update', title: '编辑模板节点', write: true, params: nodeUpdateParams },
  { id: 'technology-setting-template-base-node-prepare-remove', title: '准备删除模板节点', write: false, params: [p('id', 'text', true)] },
  { id: 'technology-setting-template-base-node-remove', title: '删除模板节点', write: true, params: [p('id', 'text', true)] },
].map(capability => ({
  ...capability,
  pagePath: TECHNOLOGY_SETTING_TEMPLATE_BASE_PAGE_PATH,
  permission: TECHNOLOGY_SETTING_TEMPLATE_BASE_PERMISSION,
  moduleType: TECHNOLOGY_SETTING_TEMPLATE_BASE_MODULE_TYPE,
  httpInstance: 'platform',
}))
