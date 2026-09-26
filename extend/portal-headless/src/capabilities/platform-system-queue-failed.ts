import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台设置 → 定时任务 → 失败队列」。详情页只消费列表行 query，不另发详情请求。 */
export const PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH = '/dashboard/platform/system/regular/fail/list'
export const PLATFORM_SYSTEM_QUEUE_FAILED_PERMISSION = '/dashboard/platform-v2/system/regular/fail'
export const PLATFORM_SYSTEM_QUEUE_FAILED_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/queueFailed'

export type PlatformSystemQueueFailedId = string | number
export type PlatformSystemQueueFailedRow = Record<string, unknown> & {
  id: PlatformSystemQueueFailedId
  queueName: string | null
  data: string | null
  createTime: number | null
  reason: string | null
}
export type PlatformSystemQueueFailedQuery = {
  data?: string
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PlatformSystemQueueFailedId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数或十进制正整数字符串`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
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

function rowOf (value: unknown, index: number): PlatformSystemQueueFailedRow {
  const row = objectOf(value, `失败队列列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `失败队列列表[${index}].id`),
    queueName: nullableTextOf(row.queueName, `失败队列列表[${index}].queueName`),
    data: nullableTextOf(row.data, `失败队列列表[${index}].data`),
    createTime: nullableIntegerOf(row.createTime, `失败队列列表[${index}].createTime`),
    reason: nullableTextOf(row.reason, `失败队列列表[${index}].reason`),
  }
}

function pageOf (value: unknown): PageResult<PlatformSystemQueueFailedRow> {
  const page = objectOf(value, '失败队列分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('失败队列分页响应缺少有效list或total')
  return { list: page.list.map((row, index) => rowOf(row, index)), total: page.total as number }
}

function queryOf (input: PlatformSystemQueueFailedQuery = {}): Record<string, unknown> {
  if (input.data !== undefined && typeof input.data !== 'string') throw new Error('队列数据必须为字符串')
  return {
    order: '',
    orderField: '',
    data: input.data ?? '',
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function idsOf (value: unknown): PlatformSystemQueueFailedId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('失败队列ids必须是非空数组')
  return value.map((id, index) => idOf(id, `失败队列ids[${index}]`))
}

export function createPlatformSystemQueueFailedCapability (request: PortalRequest) {
  return {
    async list (input: PlatformSystemQueueFailedQuery = {}): Promise<PageResult<PlatformSystemQueueFailedRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },

    prepareRemove (input: { ids: PlatformSystemQueueFailedId[] }): { ids: PlatformSystemQueueFailedId[] } {
      return { ids: idsOf(input.ids) }
    },

    async remove (input: { ids: PlatformSystemQueueFailedId[] }): Promise<void> {
      await request({ url: `${ROOT}/delete`, method: 'delete', data: idsOf(input.ids) })
    },

    prepareRun (input: { id: PlatformSystemQueueFailedId }): { id: PlatformSystemQueueFailedId } {
      return { id: idOf(input.id, '失败队列ID') }
    },

    async run (input: { id: PlatformSystemQueueFailedId }): Promise<void> {
      const id = idOf(input.id, '失败队列ID')
      // Portal uses a URL string with the query embedded, not axios params.
      await request({ url: `${ROOT}/run?id=${encodeURIComponent(String(id))}`, method: 'get' })
    },
  }
}

export type PlatformSystemQueueFailedCapability = ReturnType<typeof createPlatformSystemQueueFailedCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('data', 'text', false, '队列数据查询字符串；页面默认空字符串，不自动trim'), p('pageNo', 'number', false, '从1开始；页面默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20')]
const idsParam = p('ids', 'text', true, '用户选中的失败队列 ID 数组；至少一项')
const idParam = p('id', 'text', true, '用户选中的失败队列 ID；来自列表行 id')

export const PLATFORM_SYSTEM_QUEUE_FAILED_METHODS = {
  'platform-system-queue-failed-list': 'list',
  'platform-system-queue-failed-prepare-remove': 'prepareRemove',
  'platform-system-queue-failed-remove': 'remove',
  'platform-system-queue-failed-prepare-run': 'prepareRun',
  'platform-system-queue-failed-run': 'run',
} as const

export const platformSystemQueueFailedCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-queue-failed-list', title: '查询失败队列', write: false, params: queryParams },
  { id: 'platform-system-queue-failed-prepare-remove', title: '准备删除失败队列', write: false, params: [idsParam] },
  { id: 'platform-system-queue-failed-remove', title: '删除失败队列', write: true, params: [idsParam] },
  { id: 'platform-system-queue-failed-prepare-run', title: '准备执行失败队列', write: false, params: [idParam] },
  { id: 'platform-system-queue-failed-run', title: '手动执行失败队列', write: true, params: [idParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_QUEUE_FAILED_PAGE_PATH,
  permission: PLATFORM_SYSTEM_QUEUE_FAILED_PERMISSION,
  moduleType: PLATFORM_SYSTEM_QUEUE_FAILED_MODULE_TYPE,
  httpInstance: 'platform',
}))
