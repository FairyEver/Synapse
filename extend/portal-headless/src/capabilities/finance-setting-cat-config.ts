import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** 门户系统：财务设置 / 类目配置；静态锚点 frontend d3cf56bdc76c、Java dcb3f360194。 */
export const FINANCE_SETTING_CAT_CONFIG_PAGE_PATH = '/dashboard/finance/setting/cat-config/list'
const ROOT = '/admin-api/finance/income-category'

export type FinanceSettingCatConfigId = string | number
export type FinanceSettingCatConfigParentId = FinanceSettingCatConfigId | null
export type FinanceSettingCatConfigParentInput = FinanceSettingCatConfigId | ''
export type FinanceSettingCatConfigStatus = 0 | 1

export type FinanceSettingCatConfigRow = {
  id: FinanceSettingCatConfigId
  status: FinanceSettingCatConfigStatus
  createTime: string | number | null
  categoryName: string
  categoryType: number
  pid: FinanceSettingCatConfigParentId
  parentId: FinanceSettingCatConfigParentId
  children: FinanceSettingCatConfigRow[]
}

export type FinanceSettingCatConfigDetail = {
  id: FinanceSettingCatConfigId
  pName: string | null
  pid: FinanceSettingCatConfigParentId
  categoryName: string
  categoryType: number
}

export type FinanceSettingCatConfigCreateDraft = {
  pid?: FinanceSettingCatConfigParentInput | null
  categoryName: string
  categoryType?: number
}

/** 只含后端创建接口使用的字段；pName、id、pList是Portal桥接/表单字段，不发送。 */
export type FinanceSettingCatConfigCreatePayload = {
  pid: FinanceSettingCatConfigParentInput
  categoryName: string
  categoryType: number
}

export type FinanceSettingCatConfigSaveDraft = {
  id: FinanceSettingCatConfigId
  status: FinanceSettingCatConfigStatus
  categoryName: string
  categoryType: number
  pid: FinanceSettingCatConfigParentInput
}

export type FinanceSettingCatConfigUpdateChanges = {
  pid?: FinanceSettingCatConfigParentInput | null
  categoryName?: string
  categoryType?: number
}

export type FinanceSettingCatConfigUpdateInput = {
  current: FinanceSettingCatConfigRow | FinanceSettingCatConfigSaveDraft
  changes?: FinanceSettingCatConfigUpdateChanges | null
}

export type FinanceSettingCatConfigPreparedUpdate = {
  draft: FinanceSettingCatConfigSaveDraft
  previous: FinanceSettingCatConfigSaveDraft
}

export type FinanceSettingCatConfigPreparedDiscard = {
  draft: FinanceSettingCatConfigSaveDraft
  previous: FinanceSettingCatConfigSaveDraft
}

export type FinanceSettingCatConfigUpdateSubmit = {
  draft: FinanceSettingCatConfigSaveDraft
}

export type FinanceSettingCatConfigDiscardSubmit = {
  draft: FinanceSettingCatConfigSaveDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingCatConfigId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  }
  return value
}

function parentIdOf (value: unknown, label: string): FinanceSettingCatConfigParentId {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null
  return idOf(value, label)
}

/** 表单顶级类目按Portal原样发送空字符串；返回树节点时统一为空父ID null。 */
function parentInputOf (value: unknown, label: string): FinanceSettingCatConfigParentInput {
  return parentIdOf(value, label) ?? ''
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必须为非空字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function categoryTypeOf (value: unknown, label = 'categoryType'): number {
  return integerOf(value, label)
}

function statusOf (value: unknown): FinanceSettingCatConfigStatus {
  if (value !== 0 && value !== 1) throw new Error('status只能是数值0（停用）或1（启用）')
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数值或null`)
}

function rowOf (value: unknown): FinanceSettingCatConfigRow {
  const row = objectOf(value, '类目配置树节点')
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error('类目配置树节点children必须为数组')
  const pid = parentIdOf(row.pid ?? row.parentId, 'pid')
  const parentId = parentIdOf(row.parentId ?? row.pid, 'parentId')
  return {
    id: idOf(row.id, '类目配置id'),
    status: statusOf(row.status),
    createTime: dateTimeOf(row.createTime, 'createTime'),
    categoryName: textOf(row.categoryName, 'categoryName'),
    categoryType: categoryTypeOf(row.categoryType),
    pid,
    parentId,
    children: children.map(rowOf),
  }
}

function detailOf (value: unknown): FinanceSettingCatConfigDetail {
  const row = objectOf(value, '类目配置详情输入')
  return {
    id: idOf(row.id, 'id'),
    pName: nullableTextOf(row.pName, 'pName'),
    pid: parentIdOf(row.pid ?? row.parentId, 'pid'),
    categoryName: textOf(row.categoryName, 'categoryName'),
    categoryType: categoryTypeOf(row.categoryType),
  }
}

function createDraftOf (input: FinanceSettingCatConfigCreateDraft): FinanceSettingCatConfigCreateDraft {
  const value = objectOf(input, '创建类目配置输入')
  return {
    pid: parentInputOf(value.pid, 'pid'),
    categoryName: textOf(value.categoryName, 'categoryName'),
    categoryType: value.categoryType === undefined ? 1 : categoryTypeOf(value.categoryType),
  }
}

function saveDraftOf (input: unknown, label: string): FinanceSettingCatConfigSaveDraft {
  const value = objectOf(input, label)
  return {
    id: idOf(value.id, 'id'),
    status: statusOf(value.status),
    categoryName: textOf(value.categoryName, 'categoryName'),
    categoryType: categoryTypeOf(value.categoryType),
    pid: parentInputOf(value.pid ?? value.parentId, 'pid'),
  }
}

function changesOf (input: FinanceSettingCatConfigUpdateChanges | null | undefined): FinanceSettingCatConfigUpdateChanges {
  if (input === undefined || input === null) return {}
  const value = objectOf(input, '类目配置编辑变更')
  const allowed = new Set(['pid', 'categoryName', 'categoryType'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`类目配置编辑变更不支持字段${key}`)
  }
  const changes: FinanceSettingCatConfigUpdateChanges = {}
  if (Object.prototype.hasOwnProperty.call(value, 'pid')) changes.pid = parentInputOf(value.pid, 'pid')
  if (Object.prototype.hasOwnProperty.call(value, 'categoryName')) changes.categoryName = textOf(value.categoryName, 'categoryName')
  if (Object.prototype.hasOwnProperty.call(value, 'categoryType')) changes.categoryType = categoryTypeOf(value.categoryType)
  return changes
}

function updatePayloadOf (input: FinanceSettingCatConfigUpdateInput): FinanceSettingCatConfigPreparedUpdate {
  const previous = saveDraftOf(input?.current, '类目配置编辑当前值')
  const changes = changesOf(input?.changes)
  const draft: FinanceSettingCatConfigSaveDraft = {
    id: previous.id,
    status: previous.status,
    categoryName: changes.categoryName ?? previous.categoryName,
    categoryType: changes.categoryType ?? previous.categoryType,
    pid: changes.pid ?? previous.pid,
  }
  return { draft, previous }
}

function createPayloadOf (input: FinanceSettingCatConfigCreateDraft): FinanceSettingCatConfigCreatePayload {
  const normalized = createDraftOf(input)
  return {
    pid: normalized.pid ?? '',
    categoryName: normalized.categoryName,
    categoryType: normalized.categoryType ?? 1,
  }
}

function submitDraftOf (input: FinanceSettingCatConfigUpdateSubmit | FinanceSettingCatConfigDiscardSubmit, label: string): FinanceSettingCatConfigSaveDraft {
  const value = objectOf(input, label)
  return saveDraftOf(value.draft, `${label}.draft`)
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_CAT_CONFIG_PAGE_PATH. */
export function createFinanceSettingCatConfigCapability (request: PortalRequest) {
  return {
    async list (): Promise<FinanceSettingCatConfigRow[]> {
      const result = await request<unknown>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
        },
      })
      if (!Array.isArray(result)) throw new Error('类目配置列表响应必须为数组')
      return result.map(rowOf)
    },

    detail (input: { row: FinanceSettingCatConfigRow }): FinanceSettingCatConfigDetail {
      return detailOf(objectOf(input, '详情输入').row)
    },

    prepareCreate (input: FinanceSettingCatConfigCreateDraft): { draft: FinanceSettingCatConfigCreatePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceSettingCatConfigCreateDraft): Promise<FinanceSettingCatConfigId> {
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: createPayloadOf(input),
      })
      return idOf(result, '新建类目配置返回的id')
    },

    prepareUpdate (input: FinanceSettingCatConfigUpdateInput): FinanceSettingCatConfigPreparedUpdate {
      return updatePayloadOf(input)
    },

    async update (input: FinanceSettingCatConfigUpdateSubmit): Promise<true> {
      const draft = submitDraftOf(input, '类目配置更新输入')
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: draft,
      })
      return trueResult(result, '更新类目配置')
    },

    prepareDiscard (input: { current: FinanceSettingCatConfigRow | FinanceSettingCatConfigSaveDraft }): FinanceSettingCatConfigPreparedDiscard {
      const previous = saveDraftOf(objectOf(input, '废弃类目配置输入').current, '废弃类目配置当前值')
      if (previous.status !== 1) throw new Error('只能废弃当前状态为1（启用）的类目配置')
      return {
        draft: { ...previous, status: 0 },
        previous,
      }
    },

    async discard (input: FinanceSettingCatConfigDiscardSubmit): Promise<true> {
      const draft = submitDraftOf(input, '类目配置废弃输入')
      if (draft.status !== 0) throw new Error('废弃请求的draft.status必须为0（停用）')
      const result = await request<unknown>({
        url: `${ROOT}/update`,
        method: 'put',
        data: draft,
      })
      return trueResult(result, '废弃类目配置')
    },
  }
}

export type FinanceSettingCatConfigCapability = ReturnType<typeof createFinanceSettingCatConfigCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const createParams: ParamSpec[] = [
  p('pid', 'text', false, '上级类目主键ID；顶级类目按Portal发送空字符串'),
  p('categoryName', 'text', true, '类目名称；去首尾空白后不能为空，但发送时保留原字符串'),
  p('categoryType', 'number', false, '类目类别字典值；页面默认数值1，前端运行时字典决定可选项'),
]

export const FINANCE_SETTING_CAT_CONFIG_METHODS = {
  'finance-setting-cat-config-list': 'list',
  'finance-setting-cat-config-detail': 'detail',
  'finance-setting-cat-config-prepare-create': 'prepareCreate',
  'finance-setting-cat-config-create': 'create',
  'finance-setting-cat-config-prepare-update': 'prepareUpdate',
  'finance-setting-cat-config-update': 'update',
  'finance-setting-cat-config-prepare-discard': 'prepareDiscard',
  'finance-setting-cat-config-discard': 'discard',
} as const

export const financeSettingCatConfigCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-cat-config-list', title: '查询类目配置', write: false, params: [] },
  { id: 'finance-setting-cat-config-detail', title: '查看类目配置', write: false, params: [p('row', 'text', true, '来自最新类目配置树的完整行对象；详情使用本地桥接快照')] },
  { id: 'finance-setting-cat-config-prepare-create', title: '准备创建类目配置', write: false, params: createParams },
  { id: 'finance-setting-cat-config-create', title: '创建类目配置', write: true, params: createParams },
  {
    id: 'finance-setting-cat-config-prepare-update',
    title: '准备编辑类目配置',
    write: false,
    params: [
      p('current', 'text', true, '来自最新类目配置树的完整行对象或此前保存草稿'),
      p('changes', 'text', false, '只包含pid、categoryName、categoryType的编辑变更'),
    ],
  },
  { id: 'finance-setting-cat-config-update', title: '编辑类目配置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整保存草稿')] },
  { id: 'finance-setting-cat-config-prepare-discard', title: '准备废弃类目配置', write: false, params: [p('current', 'text', true, '来自最新启用树的完整行对象或保存草稿')] },
  { id: 'finance-setting-cat-config-discard', title: '废弃类目配置', write: true, params: [p('draft', 'text', true, 'prepareDiscard返回的status=0完整保存草稿')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_CAT_CONFIG_PAGE_PATH,
  permission: '/dashboard/finance/setting/cat-config',
  moduleType: null,
  httpInstance: 'platform',
}))
