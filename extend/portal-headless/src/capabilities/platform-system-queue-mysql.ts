import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台设置 → 定时任务 → 队列管理」。页面只提供分页和批量删除。 */
export const PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH = '/dashboard/platform/system/regular/queue/list'
export const PLATFORM_SYSTEM_QUEUE_MYSQL_PERMISSION = '/dashboard/platform-v2/system/regular/queue'
export const PLATFORM_SYSTEM_QUEUE_MYSQL_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/queueMysql'

export type PlatformSystemQueueMysqlId = string | number
export type PlatformSystemQueueMysqlRow = Record<string, unknown> & {
  id: PlatformSystemQueueMysqlId
  queueName: string | null
  worker: string | null
  params: string | null
  createTime: number | null
  lastConsumeTime: number | null
  ownerThreadId: number | null
  attempts: number | null
}
export type PlatformSystemQueueMysqlQuery = { pageNo?: number; pageSize?: number }
type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}
function idOf (value: unknown, label: string): PlatformSystemQueueMysqlId {
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
function rowOf (value: unknown, index: number): PlatformSystemQueueMysqlRow {
  const row = objectOf(value, `队列管理列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `队列管理列表[${index}].id`),
    queueName: nullableTextOf(row.queueName, `队列管理列表[${index}].queueName`),
    worker: nullableTextOf(row.worker, `队列管理列表[${index}].worker`),
    params: nullableTextOf(row.params, `队列管理列表[${index}].params`),
    createTime: nullableIntegerOf(row.createTime, `队列管理列表[${index}].createTime`),
    lastConsumeTime: nullableIntegerOf(row.lastConsumeTime, `队列管理列表[${index}].lastConsumeTime`),
    ownerThreadId: nullableIntegerOf(row.ownerThreadId, `队列管理列表[${index}].ownerThreadId`),
    attempts: nullableIntegerOf(row.attempts, `队列管理列表[${index}].attempts`),
  }
}
function pageOf (value: unknown): PageResult<PlatformSystemQueueMysqlRow> {
  const page = objectOf(value, '队列管理分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('队列管理分页响应缺少有效list或total')
  return { list: page.list.map((row, index) => rowOf(row, index)), total: page.total as number }
}
function queryOf (input: PlatformSystemQueueMysqlQuery = {}): Record<string, unknown> {
  return { order: '', orderField: '', pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input.pageSize, 20, 'pageSize') }
}
function idsOf (value: unknown): PlatformSystemQueueMysqlId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('队列管理ids必须是非空数组')
  return value.map((id, index) => idOf(id, `队列管理ids[${index}]`))
}

export function createPlatformSystemQueueMysqlCapability (request: PortalRequest) {
  return {
    async list (input: PlatformSystemQueueMysqlQuery = {}): Promise<PageResult<PlatformSystemQueueMysqlRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },
    prepareRemove (input: { ids: PlatformSystemQueueMysqlId[] }): { ids: PlatformSystemQueueMysqlId[] } {
      return { ids: idsOf(input.ids) }
    },
    async remove (input: { ids: PlatformSystemQueueMysqlId[] }): Promise<void> {
      await request({ url: `${ROOT}/delete`, method: 'delete', data: idsOf(input.ids) })
    },
  }
}

export type PlatformSystemQueueMysqlCapability = ReturnType<typeof createPlatformSystemQueueMysqlCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('pageNo', 'number', false, '从1开始；页面默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20')]
const idsParam = p('ids', 'text', true, '用户选中的队列管理 ID 数组；至少一项')

export const PLATFORM_SYSTEM_QUEUE_MYSQL_METHODS = {
  'platform-system-queue-mysql-list': 'list',
  'platform-system-queue-mysql-prepare-remove': 'prepareRemove',
  'platform-system-queue-mysql-remove': 'remove',
} as const
export const platformSystemQueueMysqlCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-queue-mysql-list', title: '查询队列管理', write: false, params: queryParams },
  { id: 'platform-system-queue-mysql-prepare-remove', title: '准备删除队列管理记录', write: false, params: [idsParam] },
  { id: 'platform-system-queue-mysql-remove', title: '删除队列管理记录', write: true, params: [idsParam] },
].map(definition => ({ ...definition, pagePath: PLATFORM_SYSTEM_QUEUE_MYSQL_PAGE_PATH, permission: PLATFORM_SYSTEM_QUEUE_MYSQL_PERMISSION, moduleType: PLATFORM_SYSTEM_QUEUE_MYSQL_MODULE_TYPE, httpInstance: 'platform' }))
