import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

export const HR_ORGANIZATION_PROPERTY_PAGE_PATH = '/dashboard/org/org-propType/list'

export type HrOrganizationPropertyId = string | number
export type HrOrganizationPropertyRow = {
  id: HrOrganizationPropertyId
  name: string
  code: string
  remark: string | null
  status: 0 | 1
  useNumber: number
}
export type HrOrganizationPropertyQuery = {
  name?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}
export type HrOrganizationPropertyDraft = {
  name: string
  code: string
  remark?: string
}
export type HrOrganizationPropertyDeactivate = {
  id: HrOrganizationPropertyId
  currentStatus: number
  useNumber: number
}
export type HrOrganizationPropertyEnable = {
  id: HrOrganizationPropertyId
  currentStatus: number
}

const ROOT = '/hr/org/organizationProperty'

function idOf (value: HrOrganizationPropertyId): HrOrganizationPropertyId {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) ||
    (typeof value === 'string' && !/^[1-9]\d*$/.test(value))
  ) {
    throw new Error('组织属性 ID 必须为正整数字符串或安全正整数')
  }
  return value
}

function positiveInteger (value: number | undefined, fallback: number, name: string, maximum?: number): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || (maximum !== undefined && result > maximum)) {
    throw new Error(`${name} 必须为${maximum === undefined ? '正整数' : `1 至 ${maximum} 的整数`}`)
  }
  return result
}

function queryOf (input: HrOrganizationPropertyQuery): Required<HrOrganizationPropertyQuery> {
  if (input.name !== undefined && typeof input.name !== 'string') throw new Error('name 必须为字符串')
  if (input.order !== undefined && typeof input.order !== 'string') throw new Error('order 必须为字符串')
  if (input.orderField !== undefined && typeof input.orderField !== 'string') throw new Error('orderField 必须为字符串')
  return {
    order: input.order ?? '',
    orderField: input.orderField ?? '',
    name: input.name ?? '',
    pageNo: positiveInteger(input.pageNo, 1, 'pageNo'),
    pageSize: positiveInteger(input.pageSize, 20, 'pageSize', 500),
  }
}

function draftOf (input: HrOrganizationPropertyDraft): Required<HrOrganizationPropertyDraft> {
  if (typeof input.name !== 'string' || !input.name || !input.name.trim() || input.name.length > 20) {
    throw new Error('组织属性名称必填、不得全为空格且最多 20 个字符')
  }
  if (typeof input.code !== 'string' || !input.code || !input.code.trim() || input.code.length > 10) {
    throw new Error('组织编码必填、不得全为空格且最多 10 个字符')
  }
  const remark = input.remark ?? ''
  if (typeof remark !== 'string' || remark.length > 50 || (remark !== '' && !remark.trim())) {
    throw new Error('备注最多 50 个字符且不得全为空格')
  }
  // Keep the front-end form object's property order: name, remark, code.
  return { name: input.name, remark, code: input.code }
}

function rowOf (input: Record<string, unknown>): HrOrganizationPropertyRow {
  const id = idOf(input.id as HrOrganizationPropertyId)
  if (typeof input.name !== 'string') throw new Error('组织属性响应缺少 name')
  if (typeof input.code !== 'string') throw new Error('组织属性响应缺少 code')
  if (input.remark !== null && input.remark !== undefined && typeof input.remark !== 'string') {
    throw new Error('组织属性响应 remark 类型错误')
  }
  if (input.status !== 0 && input.status !== 1) throw new Error('组织属性响应 status 不是 0 或 1')
  if (!Number.isInteger(input.useNumber) || (input.useNumber as number) < 0) {
    throw new Error('组织属性响应 useNumber 不是非负整数')
  }
  return {
    id,
    name: input.name,
    code: input.code,
    remark: input.remark == null ? null : input.remark,
    status: input.status,
    useNumber: input.useNumber as number,
  }
}

/** Caller injects createPageCall(HR_ORGANIZATION_PROPERTY_PAGE_PATH). */
export function createHrOrganizationPropertyCapability (request: PortalRequest) {
  return {
    async list (input: HrOrganizationPropertyQuery = {}): Promise<PageResult<HrOrganizationPropertyRow>> {
      const page = await request<PageResult<Record<string, unknown>>>({
        url: `${ROOT}/page`,
        method: 'get',
        params: queryOf(input),
      })
      return { list: page.list.map(rowOf), total: page.total }
    },

    async create (input: HrOrganizationPropertyDraft): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftOf(input) })
    },

    async deactivate (input: HrOrganizationPropertyDeactivate): Promise<void> {
      const id = idOf(input.id)
      if (input.currentStatus !== 1) throw new Error('只有列表当前状态为 1（启用）的组织属性才能作废')
      if (!Number.isInteger(input.useNumber) || input.useNumber !== 0) {
        throw new Error('只有列表 useNumber 严格为 0 的组织属性才能作废')
      }
      await request({ url: `${ROOT}/updateStatus`, method: 'post', data: { id, status: 0 } })
    },

    async enable (input: HrOrganizationPropertyEnable): Promise<void> {
      const id = idOf(input.id)
      if (input.currentStatus !== 0) throw new Error('只有列表当前状态为 0（已作废）的组织属性才能启用')
      await request({ url: `${ROOT}/updateStatus`, method: 'post', data: { id, status: 1 } })
    },
  }
}

export type HrOrganizationPropertyCapability = ReturnType<typeof createHrOrganizationPropertyCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description ? { description } : {}),
})

export const HR_ORGANIZATION_PROPERTY_METHODS = {
  'hr-organization-property-list': 'list',
  'hr-organization-property-create': 'create',
  'hr-organization-property-deactivate': 'deactivate',
  'hr-organization-property-enable': 'enable',
} as const

export const hrOrganizationPropertyCapabilities: CapabilityDefinition[] = [
  {
    id: 'hr-organization-property-list',
    title: '查询组织属性',
    write: false,
    params: [p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')],
  },
  {
    id: 'hr-organization-property-create',
    title: '创建组织属性',
    write: true,
    params: [p('name', 'text', true), p('code', 'text', true), p('remark', 'text')],
  },
  {
    id: 'hr-organization-property-deactivate',
    title: '作废组织属性',
    write: true,
    params: [
      p('id', 'text', true, '组织属性主键，来自列表 id'),
      p('currentStatus', 'number', true, '列表当前状态，必须为 1'),
      p('useNumber', 'number', true, '列表关联组织数，必须为 0'),
    ],
  },
  {
    id: 'hr-organization-property-enable',
    title: '启用组织属性',
    write: true,
    params: [p('id', 'text', true, '组织属性主键，来自列表 id'), p('currentStatus', 'number', true, '列表当前状态，必须为 0')],
  },
].map(capability => ({
  ...capability,
  pagePath: HR_ORGANIZATION_PROPERTY_PAGE_PATH,
  permission: '/dashboard/org/org-propType',
  httpInstance: 'platform' as const,
}))
