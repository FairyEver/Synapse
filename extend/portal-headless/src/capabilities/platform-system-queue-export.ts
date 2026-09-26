import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台设置 → 队列管理 → 导出队列」。页面使用 platform-mall-admin.js。 */
export const PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH = '/dashboard/platform/system/queue/export/list'
export const PLATFORM_SYSTEM_QUEUE_EXPORT_PERMISSION = '/dashboard/platform-v2/system/queue/export'
export const PLATFORM_SYSTEM_QUEUE_EXPORT_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/queueInOut/out'

export type PlatformSystemQueueExportId = string | number

export type PlatformSystemQueueExportRow = Record<string, unknown> & {
  id: PlatformSystemQueueExportId
  name: string | null
  message: string | null
  fileType: string | null
  createDateString: string | null
  completeDateString: string | null
  statusString: string | null
  key: string | null
}

export type PlatformSystemQueueExportQuery = {
  pageNo?: number
  pageSize?: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PlatformSystemQueueExportId {
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

function rowOf (value: unknown, index: number): PlatformSystemQueueExportRow {
  const row = objectOf(value, `导出队列列表[${index}]`)
  return {
    ...row,
    id: idOf(row.id, `导出队列列表[${index}].id`),
    name: nullableTextOf(row.name, `导出队列列表[${index}].name`),
    message: nullableTextOf(row.message, `导出队列列表[${index}].message`),
    fileType: nullableTextOf(row.fileType, `导出队列列表[${index}].fileType`),
    createDateString: nullableTextOf(row.createDateString, `导出队列列表[${index}].createDateString`),
    completeDateString: nullableTextOf(row.completeDateString, `导出队列列表[${index}].completeDateString`),
    statusString: nullableTextOf(row.statusString, `导出队列列表[${index}].statusString`),
    key: nullableTextOf(row.key, `导出队列列表[${index}].key`),
    createDate: nullableIntegerOf(row.createDate, `导出队列列表[${index}].createDate`),
    completeDate: nullableIntegerOf(row.completeDate, `导出队列列表[${index}].completeDate`),
    status: nullableIntegerOf(row.status, `导出队列列表[${index}].status`),
    type: nullableTextOf(row.type, `导出队列列表[${index}].type`),
    isDisplay: nullableTextOf(row.isDisplay, `导出队列列表[${index}].isDisplay`),
  }
}

function pageOf (value: unknown): PageResult<PlatformSystemQueueExportRow> {
  const page = objectOf(value, '导出队列分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('导出队列分页响应缺少有效list或total')
  return { list: page.list.map((row, index) => rowOf(row, index)), total: page.total as number }
}

function queryOf (input: PlatformSystemQueueExportQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    type: 'export',
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function idsOf (value: unknown): PlatformSystemQueueExportId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('导出队列ids必须是非空数组')
  return value.map((id, index) => idOf(id, `导出队列ids[${index}]`))
}

export function createPlatformSystemQueueExportCapability (request: PortalRequest) {
  return {
    async list (input: PlatformSystemQueueExportQuery = {}): Promise<PageResult<PlatformSystemQueueExportRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },

    prepareRemove (input: { ids: PlatformSystemQueueExportId[] }): { ids: PlatformSystemQueueExportId[] } {
      return { ids: idsOf(input.ids) }
    },

    async remove (input: { ids: PlatformSystemQueueExportId[] }): Promise<void> {
      await request({ url: `${ROOT}/delete`, method: 'delete', data: idsOf(input.ids) })
    },
  }
}

export type PlatformSystemQueueExportCapability = ReturnType<typeof createPlatformSystemQueueExportCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const queryParams = [p('pageNo', 'number', false, '从1开始；页面默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20')]
const idsParam = p('ids', 'text', true, '用户选中的导出队列 ID 数组；至少一项，不能用行号')

export const PLATFORM_SYSTEM_QUEUE_EXPORT_METHODS = {
  'platform-system-queue-export-list': 'list',
  'platform-system-queue-export-prepare-remove': 'prepareRemove',
  'platform-system-queue-export-remove': 'remove',
} as const

export const platformSystemQueueExportCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-queue-export-list', title: '查询导出队列', write: false, params: queryParams },
  { id: 'platform-system-queue-export-prepare-remove', title: '准备删除导出队列', write: false, params: [idsParam] },
  { id: 'platform-system-queue-export-remove', title: '删除导出队列', write: true, params: [idsParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_QUEUE_EXPORT_PAGE_PATH,
  permission: PLATFORM_SYSTEM_QUEUE_EXPORT_PERMISSION,
  moduleType: PLATFORM_SYSTEM_QUEUE_EXPORT_MODULE_TYPE,
  httpInstance: 'platform',
}))
