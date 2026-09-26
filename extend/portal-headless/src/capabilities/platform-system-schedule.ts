import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台设置 → 定时任务」。编辑页通过列表行 bridge 加载，不另发详情 GET。 */
export const PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH = '/dashboard/platform/system/regular/task/list'
export const PLATFORM_SYSTEM_SCHEDULE_PERMISSION = '/dashboard/platform-v2/system/regular/task'
export const PLATFORM_SYSTEM_SCHEDULE_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/schedule'

export type PlatformSystemScheduleId = string | number
export type PlatformSystemScheduleRow = Record<string, unknown> & {
  id: PlatformSystemScheduleId
  beanName: string | null
  params: string | null
  cronExpression: string | null
  status: number | null
  remark: string | null
  createDate: string | number | null
}
export type PlatformSystemScheduleQuery = { pageNo?: number; pageSize?: number }
export type PlatformSystemScheduleForm = Record<string, unknown> & {
  id: PlatformSystemScheduleId
  cronExpression: string
  status?: number | null
  beanName?: string | null
  params?: string | null
  remark?: string | null
}
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}
function idOf (value: unknown, label: string): PlatformSystemScheduleId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数或十进制正整数字符串`)
}
function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}
function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}
function dateOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}
function rowOf (value: unknown, index: number): PlatformSystemScheduleRow {
  const row = objectOf(value, `定时任务列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `定时任务列表[${index}].id`),
    beanName: nullableTextOf(row.beanName, `定时任务列表[${index}].beanName`),
    params: nullableTextOf(row.params, `定时任务列表[${index}].params`),
    cronExpression: nullableTextOf(row.cronExpression, `定时任务列表[${index}].cronExpression`),
    status: nullableIntegerOf(row.status, `定时任务列表[${index}].status`),
    remark: nullableTextOf(row.remark, `定时任务列表[${index}].remark`),
    createDate: dateOf(row.createDate, `定时任务列表[${index}].createDate`),
  }
}
function pageOf (value: unknown): PageResult<PlatformSystemScheduleRow> {
  const page = objectOf(value, '定时任务分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('定时任务分页响应缺少有效list或total')
  return { list: page.list.map((row, index) => rowOf(row, index)), total: page.total as number }
}
function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}
function queryOf (input: PlatformSystemScheduleQuery = {}): Record<string, unknown> {
  // This page does not set styleV2, so common list defaults pageSize to 10.
  return { order: '', orderField: '', pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input.pageSize, 10, 'pageSize') }
}
function statusOf (value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (value !== 0 && value !== 1) throw new Error('定时任务status必须为0或1')
  return value as number
}
function formPayloadOf (value: PlatformSystemScheduleForm): JsonObject {
  const form = objectOf(value, '定时任务编辑表单')
  const id = idOf(form.id, '定时任务ID')
  if (typeof form.cronExpression !== 'string' || form.cronExpression.length === 0) throw new Error('定时任务规则必须为非空字符串')
  const payload: JsonObject = { ...form, id, cronExpression: form.cronExpression, status: statusOf(form.status) }
  if (form.status === undefined) delete payload.status
  for (const key of ['beanName', 'params', 'remark'] as const) {
    if (form[key] !== undefined && form[key] !== null) payload[key] = nullableTextOf(form[key], `定时任务${key}`)
  }
  return payload
}

export function buildPlatformSystemSchedulePayload (form: PlatformSystemScheduleForm): JsonObject { return formPayloadOf(form) }

export function createPlatformSystemScheduleCapability (request: PortalRequest) {
  return {
    async list (input: PlatformSystemScheduleQuery = {}): Promise<PageResult<PlatformSystemScheduleRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },
    prepareUpdate (input: { form: PlatformSystemScheduleForm }): { payload: JsonObject } {
      return { payload: formPayloadOf(input.form) }
    },
    async update (input: { form: PlatformSystemScheduleForm }): Promise<void> {
      await request({ url: `${ROOT}/update`, method: 'post', data: formPayloadOf(input.form) })
    },
    prepareRun (input: { id: PlatformSystemScheduleId }): { id: PlatformSystemScheduleId } {
      return { id: idOf(input.id, '定时任务ID') }
    },
    async run (input: { id: PlatformSystemScheduleId }): Promise<void> {
      const id = idOf(input.id, '定时任务ID')
      await request({ url: `${ROOT}/run`, method: 'get', params: { idList: id } })
    },
  }
}

export type PlatformSystemScheduleCapability = ReturnType<typeof createPlatformSystemScheduleCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('pageNo', 'number', false, '从1开始；页面默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认10；本页未启用styleV2')]
const formParam = p('form', 'text', true, '从列表行 bridge 得到的定时任务编辑表单；cronExpression必填，页面提交整份表单')
const idParam = p('id', 'text', true, '用户选中的定时任务 ID；来自列表行 id')
export const PLATFORM_SYSTEM_SCHEDULE_METHODS = {
  'platform-system-schedule-list': 'list',
  'platform-system-schedule-prepare-update': 'prepareUpdate',
  'platform-system-schedule-update': 'update',
  'platform-system-schedule-prepare-run': 'prepareRun',
  'platform-system-schedule-run': 'run',
} as const
export const platformSystemScheduleCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-schedule-list', title: '查询定时任务', write: false, params: queryParams },
  { id: 'platform-system-schedule-prepare-update', title: '准备编辑定时任务', write: false, params: [formParam] },
  { id: 'platform-system-schedule-update', title: '编辑定时任务', write: true, params: [formParam] },
  { id: 'platform-system-schedule-prepare-run', title: '准备执行定时任务', write: false, params: [idParam] },
  { id: 'platform-system-schedule-run', title: '执行定时任务', write: true, params: [idParam] },
].map(definition => ({ ...definition, pagePath: PLATFORM_SYSTEM_SCHEDULE_PAGE_PATH, permission: PLATFORM_SYSTEM_SCHEDULE_PERMISSION, moduleType: PLATFORM_SYSTEM_SCHEDULE_MODULE_TYPE, httpInstance: 'platform' }))
