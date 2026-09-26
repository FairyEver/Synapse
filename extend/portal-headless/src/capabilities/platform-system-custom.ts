import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「平台设置 → 系统配置」；页面直接使用 platform.js / platform-mall-admin.js。 */
export const PLATFORM_SYSTEM_CUSTOM_PAGE_PATH = '/dashboard/platform/system/custom/list'
export const PLATFORM_SYSTEM_CUSTOM_PERMISSION = '/dashboard/platform-v2/system/custom'
export const PLATFORM_SYSTEM_CUSTOM_MODULE_TYPE = null

const ROOT = '/mall-manage-api/sys/diyConf'

export type PlatformSystemCustomId = string | number
export type PlatformSystemCustomItem = Record<string, unknown> & {
  pid?: string | number
  text?: string
  value?: string
  info?: string
}

/** 页面把 body 当 JSON 数组编辑；SDK 同时接受数组和页面已有的 JSON 字符串。 */
export type PlatformSystemCustomForm = {
  id?: PlatformSystemCustomId | ''
  code: string
  name: string
  info?: string | null
  body?: string | PlatformSystemCustomItem[] | null
}

export type PlatformSystemCustomRow = {
  id: PlatformSystemCustomId
  code: string
  name: string
  body: string
  info: string | null
  modifiedTime: string | number | null
}

export type PlatformSystemCustomQuery = {
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): PlatformSystemCustomId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function textOf (value: unknown, label: string, required = false): string {
  if (typeof value !== 'string' || (required && value.length === 0)) throw new Error(`${label}必须${required ? '为非空' : '为'}字符串`)
  return value
}

function bodyOf (value: PlatformSystemCustomForm['body']): { items: PlatformSystemCustomItem[]; serialized: string } {
  let parsed: unknown
  if (Array.isArray(value)) parsed = value
  else {
    const source = value || '[]'
    if (typeof source !== 'string') throw new Error('body必须是JSON字符串或配置项数组')
    try {
      parsed = JSON.parse(source)
    } catch {
      throw new Error('body必须是合法JSON数组')
    }
  }
  if (!Array.isArray(parsed)) throw new Error('body必须是JSON数组')
  const items = parsed.map((item, index) => {
    const row = objectOf(item, `body[${index}]`)
    if (row.pid !== undefined && typeof row.pid !== 'string' && typeof row.pid !== 'number') throw new Error(`body[${index}].pid必须为字符串或数字`)
    return { ...row } as PlatformSystemCustomItem
  })
  return { items, serialized: JSON.stringify(items) }
}

function queryOf (input: PlatformSystemCustomQuery = {}): Record<string, unknown> {
  if (input.order !== undefined && typeof input.order !== 'string') throw new Error('order必须为字符串')
  if (input.orderField !== undefined && typeof input.orderField !== 'string') throw new Error('orderField必须为字符串')
  return {
    order: input.order ?? '',
    orderField: input.orderField ?? '',
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): PlatformSystemCustomRow {
  const row = objectOf(value, '系统配置列表行')
  return {
    id: idOf(row.id, '系统配置ID'),
    code: textOf(row.code, '配置代码'),
    name: textOf(row.name, '配置名称'),
    body: textOf(row.body, '配置项内容', true),
    info: row.info === undefined || row.info === null ? null : textOf(row.info, '配置说明', true),
    modifiedTime: row.modifiedTime === undefined || row.modifiedTime === null
      ? null
      : typeof row.modifiedTime === 'string' || typeof row.modifiedTime === 'number'
        ? row.modifiedTime
        : (() => { throw new Error('更新时间必须为字符串、数字或null') })(),
  }
}

function pageOf (value: unknown): PageResult<PlatformSystemCustomRow> {
  const page = objectOf(value, '系统配置分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('系统配置分页响应缺少有效list或total')
  return { list: page.list.map(rowOf), total: page.total as number }
}

function formPayloadOf (input: PlatformSystemCustomForm, mode: 'create' | 'update'): JsonObject {
  const form = objectOf(input, '系统配置表单')
  const code = textOf(form.code, '配置代码', true)
  const name = textOf(form.name, '配置名称', true)
  const info = form.info === undefined || form.info === null ? '' : textOf(form.info, '备注说明')
  const body = bodyOf(form.body as PlatformSystemCustomForm['body'])
  if (mode === 'update') {
    return {
      id: idOf(form.id, '系统配置ID'),
      code,
      name,
      info,
      body: body.serialized,
    }
  }
  // The create form's initial state includes id: ''. The page spreads the
  // entire form before replacing body, so preserve that exact wire shape.
  return { id: '', code, name, info, body: body.serialized }
}

export function buildPlatformSystemCustomPayload (input: PlatformSystemCustomForm, mode: 'create' | 'update'): JsonObject {
  return formPayloadOf(input, mode)
}

export function createPlatformSystemCustomCapability (request: PortalRequest) {
  return {
    async list (input: PlatformSystemCustomQuery = {}): Promise<PageResult<PlatformSystemCustomRow>> {
      return pageOf(await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(input) }))
    },

    prepareCreate (input: PlatformSystemCustomForm): { payload: JsonObject } {
      return { payload: formPayloadOf(input, 'create') }
    },

    async create (input: PlatformSystemCustomForm): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: formPayloadOf(input, 'create') })
    },

    prepareUpdate (input: PlatformSystemCustomForm & { id: PlatformSystemCustomId }): { payload: JsonObject } {
      return { payload: formPayloadOf(input, 'update') }
    },

    async update (input: PlatformSystemCustomForm & { id: PlatformSystemCustomId }): Promise<void> {
      await request({ url: `${ROOT}/update`, method: 'post', data: formPayloadOf(input, 'update') })
    },
  }
}

export type PlatformSystemCustomCapability = ReturnType<typeof createPlatformSystemCustomCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description ? { description } : {}),
})

const formParam = p('form', 'text', true, '配置表单对象；code/name必填，body是配置项JSON数组或其JSON字符串')
const pageParams = [p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'), p('order', 'text', false, '页面默认空字符串'), p('orderField', 'text', false, '页面默认空字符串')]

export const PLATFORM_SYSTEM_CUSTOM_METHODS = {
  'platform-system-custom-list': 'list',
  'platform-system-custom-prepare-create': 'prepareCreate',
  'platform-system-custom-create': 'create',
  'platform-system-custom-prepare-update': 'prepareUpdate',
  'platform-system-custom-update': 'update',
} as const

export const platformSystemCustomCapabilities: CapabilityDefinition[] = [
  { id: 'platform-system-custom-list', title: '查询系统配置列表', write: false, params: pageParams },
  { id: 'platform-system-custom-prepare-create', title: '准备创建系统配置', write: false, params: [formParam] },
  { id: 'platform-system-custom-create', title: '创建系统配置', write: true, params: [formParam] },
  { id: 'platform-system-custom-prepare-update', title: '准备编辑系统配置', write: false, params: [formParam] },
  { id: 'platform-system-custom-update', title: '编辑系统配置', write: true, params: [formParam] },
].map(definition => ({
  ...definition,
  pagePath: PLATFORM_SYSTEM_CUSTOM_PAGE_PATH,
  permission: PLATFORM_SYSTEM_CUSTOM_PERMISSION,
  moduleType: PLATFORM_SYSTEM_CUSTOM_MODULE_TYPE,
  httpInstance: 'platform',
}))
