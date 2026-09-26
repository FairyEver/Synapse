import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 系统开通」列表及其创建、编辑表单。 */
export const SYSTEM_INTEGRATION_PAGE_PATH = '/dashboard/setting/integration/list'
export const SYSTEM_INTEGRATION_PERMISSION = '/dashboard/setting/integration'
export const SYSTEM_INTEGRATION_MODULE_TYPE = null

const ROOT = '/admin-api/system/org-module-switch'

export type SystemIntegrationId = string | number
export type SystemIntegrationFlag = 0 | 1

export type SystemIntegrationQuery = {
  orgId?: SystemIntegrationId | null
  pageNo?: number
  /** Portal 通用列表库将每页数量发送为 limit。 */
  limit?: number
}

export type SystemIntegrationRow = Record<string, unknown> & {
  id: SystemIntegrationId
  orgId: SystemIntegrationId
  orgName: string | null
  orgFullPath: string | null
  hrEnabled: SystemIntegrationFlag | null
  financeEnabled: SystemIntegrationFlag | null
  inventoryEnabled: SystemIntegrationFlag | null
  productionEnabled: SystemIntegrationFlag | null
  supplyEnabled: SystemIntegrationFlag | null
  salesEnabled: SystemIntegrationFlag | null
  remark: string | null
  createTime: string | number | null
  updateTime: string | number | null
}

export type SystemIntegrationForm = {
  id?: SystemIntegrationId
  orgId: SystemIntegrationId
  orgName?: string | null
  orgFullPath?: string | null
  hrEnabled?: boolean | SystemIntegrationFlag | null
  financeEnabled?: boolean | SystemIntegrationFlag | null
  inventoryEnabled?: boolean | SystemIntegrationFlag | null
  productionEnabled?: boolean | SystemIntegrationFlag | null
  supplyEnabled?: boolean | SystemIntegrationFlag | null
  salesEnabled?: boolean | SystemIntegrationFlag | null
  remark?: string | null
}

export type SystemIntegrationDraft = {
  orgId: SystemIntegrationId
  hrEnabled: SystemIntegrationFlag
  financeEnabled: SystemIntegrationFlag
  inventoryEnabled: SystemIntegrationFlag
  productionEnabled: SystemIntegrationFlag
  supplyEnabled: SystemIntegrationFlag
  salesEnabled: SystemIntegrationFlag
  remark: string
}

export type SystemIntegrationPreparation = {
  draft: SystemIntegrationDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): SystemIntegrationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): SystemIntegrationId | null {
  if (value === undefined || value === null) return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function responseFlagOf (value: unknown, label: string): SystemIntegrationFlag | null {
  if (value === undefined || value === null) return null
  if (value === true || value === 1) return 1
  if (value === false || value === 0) return 0
  throw new Error(`${label}必须为0、1、布尔值或null`)
}

function formFlagOf (value: unknown, label: string): SystemIntegrationFlag {
  if (value === undefined || value === null || value === false || value === 0) return 0
  if (value === true || value === 1) return 1
  throw new Error(`${label}必须为布尔值、0或1`)
}

function formRemarkOf (value: unknown): string {
  const remark = value === undefined || value === null ? '' : textOf(value, '备注')!
  if (remark.length > 200) throw new Error('备注不能超过200个字符')
  return remark
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'limit'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'limit' && ![10, 20, 50, 100].includes(resolved as number)) throw new Error('limit必须是页面支持的10、20、50或100')
  return resolved as number
}

function queryOf (query: SystemIntegrationQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    orgId: nullableIdOf(query.orgId, 'orgId'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    limit: pageNumberOf(query.limit, 20, 'limit'),
  }
}

function rowOf (value: unknown, label: string): SystemIntegrationRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    orgId: idOf(row.orgId, `${label}.orgId`),
    orgName: textOf(row.orgName, `${label}.orgName`),
    orgFullPath: textOf(row.orgFullPath, `${label}.orgFullPath`),
    hrEnabled: responseFlagOf(row.hrEnabled, `${label}.hrEnabled`),
    financeEnabled: responseFlagOf(row.financeEnabled, `${label}.financeEnabled`),
    inventoryEnabled: responseFlagOf(row.inventoryEnabled, `${label}.inventoryEnabled`),
    productionEnabled: responseFlagOf(row.productionEnabled, `${label}.productionEnabled`),
    supplyEnabled: responseFlagOf(row.supplyEnabled, `${label}.supplyEnabled`),
    salesEnabled: responseFlagOf(row.salesEnabled, `${label}.salesEnabled`),
    remark: textOf(row.remark, `${label}.remark`),
    createTime: dateOf(row.createTime, `${label}.createTime`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
  }
}

function pageOf (value: unknown): PageResult<SystemIntegrationRow> {
  const page = objectOf(value, '系统开通分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) {
    throw new Error('系统开通分页响应缺少有效list或total')
  }
  return {
    list: page.list.map((item, index) => rowOf(item, `系统开通列表行[${index}]`)),
    total: page.total as number,
  }
}

function formOf (value: unknown, label: string): SystemIntegrationForm {
  const form = objectOf(value, label)
  return {
    ...(form.id === undefined || form.id === null ? {} : { id: idOf(form.id, `${label}.id`) }),
    orgId: idOf(form.orgId, `${label}.orgId`),
    orgName: textOf(form.orgName, `${label}.orgName`),
    orgFullPath: textOf(form.orgFullPath, `${label}.orgFullPath`),
    hrEnabled: formFlagOf(form.hrEnabled, `${label}.hrEnabled`),
    financeEnabled: formFlagOf(form.financeEnabled, `${label}.financeEnabled`),
    inventoryEnabled: formFlagOf(form.inventoryEnabled, `${label}.inventoryEnabled`),
    productionEnabled: formFlagOf(form.productionEnabled, `${label}.productionEnabled`),
    supplyEnabled: formFlagOf(form.supplyEnabled, `${label}.supplyEnabled`),
    salesEnabled: formFlagOf(form.salesEnabled, `${label}.salesEnabled`),
    remark: formRemarkOf(form.remark),
  }
}

function draftOf (value: unknown): SystemIntegrationDraft {
  const draft = objectOf(value, '系统开通草稿')
  return {
    orgId: idOf(draft.orgId, '系统开通草稿.orgId'),
    hrEnabled: formFlagOf(draft.hrEnabled, '系统开通草稿.hrEnabled'),
    financeEnabled: formFlagOf(draft.financeEnabled, '系统开通草稿.financeEnabled'),
    inventoryEnabled: formFlagOf(draft.inventoryEnabled, '系统开通草稿.inventoryEnabled'),
    productionEnabled: formFlagOf(draft.productionEnabled, '系统开通草稿.productionEnabled'),
    supplyEnabled: formFlagOf(draft.supplyEnabled, '系统开通草稿.supplyEnabled'),
    salesEnabled: formFlagOf(draft.salesEnabled, '系统开通草稿.salesEnabled'),
    remark: formRemarkOf(draft.remark),
  }
}

function payloadOf (value: unknown): SystemIntegrationDraft {
  const form = objectOf(value, '系统开通表单')
  return {
    orgId: idOf(form.orgId, '系统开通表单.orgId'),
    hrEnabled: formFlagOf(form.hrEnabled, '系统开通表单.hrEnabled'),
    financeEnabled: formFlagOf(form.financeEnabled, '系统开通表单.financeEnabled'),
    inventoryEnabled: formFlagOf(form.inventoryEnabled, '系统开通表单.inventoryEnabled'),
    productionEnabled: formFlagOf(form.productionEnabled, '系统开通表单.productionEnabled'),
    supplyEnabled: formFlagOf(form.supplyEnabled, '系统开通表单.supplyEnabled'),
    salesEnabled: formFlagOf(form.salesEnabled, '系统开通表单.salesEnabled'),
    remark: formRemarkOf(form.remark),
  }
}

function formFromRow (row: SystemIntegrationRow): SystemIntegrationForm {
  return {
    id: row.id,
    orgId: row.orgId,
    orgName: row.orgName,
    orgFullPath: row.orgFullPath,
    hrEnabled: row.hrEnabled === 1,
    financeEnabled: row.financeEnabled === 1,
    inventoryEnabled: row.inventoryEnabled === 1,
    productionEnabled: row.productionEnabled === 1,
    supplyEnabled: row.supplyEnabled === 1,
    salesEnabled: row.salesEnabled === 1,
    remark: row.remark || '',
  }
}

function countOf (value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('系统开通保存响应必须为非负整数影响条数')
  return value as number
}

/** The injected request must be bound to SYSTEM_INTEGRATION_PAGE_PATH. */
export function createSystemIntegrationCapability (request: PortalRequest) {
  return {
    async list (query: SystemIntegrationQuery = {}): Promise<PageResult<SystemIntegrationRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },

    async get (input: { orgId: SystemIntegrationId }): Promise<SystemIntegrationForm> {
      const orgId = idOf(input?.orgId, 'orgId')
      const row = rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { orgId } }), '系统开通详情')
      return formFromRow(row)
    },

    prepareCreate (input: SystemIntegrationForm): SystemIntegrationPreparation {
      return { draft: payloadOf(formOf(input, '系统开通创建表单')) }
    },

    async create (input: { draft: SystemIntegrationDraft }): Promise<number> {
      return countOf(await request({ url: `${ROOT}/batch-config`, method: 'post', data: payloadOf(input?.draft) }))
    },

    prepareUpdate (input: SystemIntegrationForm & { id: SystemIntegrationId }): SystemIntegrationPreparation {
      const form = formOf(input, '系统开通编辑表单')
      idOf(form.id, '系统开通编辑表单.id')
      return { draft: payloadOf(form) }
    },

    async update (input: { draft: SystemIntegrationDraft }): Promise<number> {
      return countOf(await request({ url: `${ROOT}/batch-config`, method: 'post', data: payloadOf(input?.draft) }))
    },
  }
}

export type SystemIntegrationCapability = ReturnType<typeof createSystemIntegrationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const listParams: ParamSpec[] = [
  p('orgId', 'text', false, '组织ID；页面组织树筛选的已知ID，省略或null表示不筛选'),
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('limit', 'number', false, 'Portal实际分页参数；支持10、20、50、100，默认20'),
]
const formParam = p('form', 'text', true, '系统开通表单对象；orgId必填，六个开关接受布尔值或0/1，remark最多200个字符')
const draftParam = p('draft', 'text', true, 'prepareCreate或prepareUpdate返回的完整草稿；必须提交六个0/1开关和remark')

export const SYSTEM_INTEGRATION_METHODS = {
  'system-integration-list': 'list',
  'system-integration-get': 'get',
  'system-integration-prepare-create': 'prepareCreate',
  'system-integration-create': 'create',
  'system-integration-prepare-update': 'prepareUpdate',
  'system-integration-update': 'update',
} as const

export const systemIntegrationCapabilities: CapabilityDefinition[] = [
  { id: 'system-integration-list', title: '查询系统开通列表', write: false, params: listParams },
  { id: 'system-integration-get', title: '读取系统开通表单', write: false, params: [p('orgId', 'text', true, '编辑目标组织ID；来自系统开通列表或已知组织上下文')] },
  { id: 'system-integration-prepare-create', title: '准备创建系统开通配置', write: false, params: [formParam] },
  { id: 'system-integration-create', title: '创建系统开通配置', write: true, params: [draftParam] },
  { id: 'system-integration-prepare-update', title: '准备编辑系统开通配置', write: false, params: [formParam] },
  { id: 'system-integration-update', title: '保存系统开通配置', write: true, params: [draftParam] },
].map(definition => ({
  ...definition,
  pagePath: SYSTEM_INTEGRATION_PAGE_PATH,
  permission: SYSTEM_INTEGRATION_PERMISSION,
  moduleType: SYSTEM_INTEGRATION_MODULE_TYPE,
  httpInstance: 'platform',
}))
