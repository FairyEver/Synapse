import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「平台设置 → 队列管理 → 存储方式」；页面是 FTP 配置表单，不是列表 CRUD。 */
export const PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH = '/dashboard/platform/system/queue/storage/list'
export const PLATFORM_SYSTEM_QUEUE_STORAGE_PERMISSION = '/dashboard/platform-v2/system/queue/storage'
export const PLATFORM_SYSTEM_QUEUE_STORAGE_MODULE_TYPE = null

const ROOT = '/sys/queueInOut'
const FIELDS = ['host', 'port', 'name', 'pass', 'dir'] as const

export type PlatformSystemQueueStorageField = typeof FIELDS[number]
export type PlatformSystemQueueStorageForm = Record<string, unknown> & {
  host?: string | null
  port?: string | null
  name?: string | null
  pass?: string | null
  dir?: string | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function nullableTextOf (value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串、null或省略`)
  return value
}

function formOf (value: unknown, label: string): PlatformSystemQueueStorageForm {
  const form = objectOf(value, label)
  const normalized: PlatformSystemQueueStorageForm = { ...form }
  for (const field of FIELDS) {
    const fieldValue = nullableTextOf(form[field], `${label}.${field}`)
    if (fieldValue !== undefined) normalized[field] = fieldValue
  }
  return normalized
}

export function buildPlatformSystemQueueStoragePayload (form: PlatformSystemQueueStorageForm): PlatformSystemQueueStorageForm {
  return formOf(form, '存储方式表单')
}

export function createPlatformSystemQueueStorageCapability (request: PortalRequest) {
  return {
    async get (): Promise<PlatformSystemQueueStorageForm> {
      return formOf(await request<unknown>({ url: `${ROOT}/getFTPSetting`, method: 'get', httpInstance: 'platform-mall-admin' }), '存储方式配置响应')
    },

    prepareSave (input: { form: PlatformSystemQueueStorageForm }): { payload: PlatformSystemQueueStorageForm } {
      return { payload: buildPlatformSystemQueueStoragePayload(input.form) }
    },

    async save (input: { form: PlatformSystemQueueStorageForm }): Promise<void> {
      await request({ url: `${ROOT}/saveFTPSetting`, method: 'post', data: buildPlatformSystemQueueStoragePayload(input.form), httpInstance: 'platform-mall-admin' })
    },
  }
}

export type PlatformSystemQueueStorageCapability = ReturnType<typeof createPlatformSystemQueueStorageCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const formParam = p('form', 'text', true, 'FTP配置表单对象；host、port、name、pass、dir均按页面原值传递，页面不设置必填校验')

export const PLATFORM_SYSTEM_QUEUE_STORAGE_METHODS = {
  'platform-system-queue-storage-get': 'get',
  'platform-system-queue-storage-prepare-save': 'prepareSave',
  'platform-system-queue-storage-save': 'save',
} as const

export const platformSystemQueueStorageCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-queue-storage-get', title: '读取存储方式配置', write: false, params: [] },
  { id: 'platform-system-queue-storage-prepare-save', title: '准备保存存储方式配置', write: false, params: [formParam] },
  { id: 'platform-system-queue-storage-save', title: '保存存储方式配置', write: true, params: [formParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_QUEUE_STORAGE_PAGE_PATH,
  permission: PLATFORM_SYSTEM_QUEUE_STORAGE_PERMISSION,
  moduleType: PLATFORM_SYSTEM_QUEUE_STORAGE_MODULE_TYPE,
  httpInstance: 'platform-mall-admin',
}))
