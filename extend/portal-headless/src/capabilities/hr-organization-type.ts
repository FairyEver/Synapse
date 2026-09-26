import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

export const HR_ORGANIZATION_TYPE_PAGE_PATH = '/dashboard/org/org-type/list'

export type HrOrganizationTypeRow = {
  id: string | number
  name: string
  remark?: string | null
  useNumber: number
  [key: string]: unknown
}
export type HrOrganizationTypeDraft = { name: string; remark?: string }
export type HrOrganizationTypeQuery = {
  name?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}
export type HrOrganizationTypeIds = { ids: Array<string | number> }
export type HrOrganizationTypeDelete = HrOrganizationTypeIds & { smsRequestId?: string; code?: string }
export type HrOrganizationTypeDeletePreparation = { ids: string[]; verificationRequired: boolean; phone: string | null }

const ROOT = '/org/organizationType'

function id(value: string | number): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d+$/.test(String(value)) ||
    (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) ||
    /^0+$/.test(String(value))
  ) throw new Error('组织类型 ID 必须为正整数字符串或安全正整数')
  return String(value)
}

function ids(input: HrOrganizationTypeIds): string[] {
  if (!Array.isArray(input.ids) || input.ids.length === 0) throw new Error('ids 至少包含一个组织类型 ID')
  return [...new Set(input.ids.map(id))]
}

function page(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1) throw new Error(`${name} 必须为正整数`)
  return result
}

function query(input: HrOrganizationTypeQuery): Required<HrOrganizationTypeQuery> {
  if (input.name !== undefined && typeof input.name !== 'string') throw new Error('name 必须为字符串')
  if (input.order !== undefined && typeof input.order !== 'string') throw new Error('order 必须为字符串')
  if (input.orderField !== undefined && typeof input.orderField !== 'string') throw new Error('orderField 必须为字符串')
  return {
    order: input.order ?? '',
    orderField: input.orderField ?? '',
    name: input.name ?? '',
    pageNo: page(input.pageNo, 1, 'pageNo'),
    pageSize: page(input.pageSize, 20, 'pageSize'),
  }
}

function draft(input: HrOrganizationTypeDraft): Required<HrOrganizationTypeDraft> {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) {
    throw new Error('组织类型名称必填、不得全为空格且最多 50 个字符')
  }
  const remark = input.remark ?? ''
  if (typeof remark !== 'string' || remark.length > 200 || (remark !== '' && !remark.trim())) {
    throw new Error('备注最多 200 个字符且不得全为空格')
  }
  return { name: input.name, remark }
}

/**
 * `pageRequest` 复刻列表页上下文（module-type 11），用于列表、敏感验证与批量删除。
 * `formRequest` 复刻创建页直接导入 platform http 的行为：真实浏览器保存请求不带 module-type。
 */
export function createHrOrganizationTypeCapability(
  pageRequest: PortalRequest,
  formRequest: PortalRequest = pageRequest,
) {
  async function prepareRemove(input: HrOrganizationTypeIds): Promise<HrOrganizationTypeDeletePreparation> {
    const normalized = ids(input)
    const sensitive = await pageRequest<{ mobile?: string; isDel?: number } | null | undefined>({
      url: '/org/sensitive/info',
      method: 'get',
    })
    const verificationRequired = !(
      (sensitive?.mobile === undefined && sensitive?.isDel === undefined) || sensitive?.isDel === 1
    )
    return { ids: normalized, verificationRequired, phone: sensitive?.mobile || null }
  }

  return {
    async list(input: HrOrganizationTypeQuery = {}): Promise<PageResult<HrOrganizationTypeRow>> {
      return pageRequest({ url: `${ROOT}/page`, method: 'get', params: query(input) })
    },

    async create(input: HrOrganizationTypeDraft): Promise<void> {
      await formRequest({ url: `${ROOT}/save`, method: 'post', data: draft(input) })
    },

    prepareRemove,

    async sendDeleteCode(input: HrOrganizationTypeIds): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接 remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await pageRequest<{ requestId?: string | number }>({
        url: '/sys/sms/send',
        method: 'get',
        params: { phone: prepared.phone, templateId: '17709' },
      })
      if (sent?.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) {
        throw new Error('短信响应缺少 requestId；发送结果不确定，不自动重发')
      }
      return { smsRequestId: String(sent.requestId) }
    },

    async remove(input: HrOrganizationTypeDelete): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (!input.smsRequestId?.trim() || !input.code?.trim()) {
          throw new Error('删除需要短信验证：先 sendDeleteCode，再提供 smsRequestId 和用户收到的 code')
        }
        await pageRequest({
          url: '/sys/sms/checkSms',
          method: 'get',
          params: { requestId: input.smsRequestId, code: input.code },
        })
      }
      await pageRequest({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}

export type HrOrganizationTypeCapability = ReturnType<typeof createHrOrganizationTypeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false): ParamSpec => ({ name, kind, required })
const idsParam = p('ids', 'text', true)

export const HR_ORGANIZATION_TYPE_METHODS = {
  'hr-organization-type-list': 'list',
  'hr-organization-type-create': 'create',
  'hr-organization-type-prepare-remove': 'prepareRemove',
  'hr-organization-type-send-delete-code': 'sendDeleteCode',
  'hr-organization-type-remove': 'remove',
} as const

export const hrOrganizationTypeCapabilities: CapabilityDefinition[] = [
  {
    id: 'hr-organization-type-list',
    title: '查询组织类型',
    write: false,
    params: [p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')],
  },
  { id: 'hr-organization-type-create', title: '创建组织类型', write: true, moduleType: null, params: [p('name', 'text', true), p('remark', 'text')] },
  { id: 'hr-organization-type-prepare-remove', title: '准备批量删除组织类型', write: false, params: [idsParam] },
  { id: 'hr-organization-type-send-delete-code', title: '发送组织类型删除验证码', write: true, params: [idsParam] },
  { id: 'hr-organization-type-remove', title: '批量删除组织类型', write: true, params: [idsParam, p('smsRequestId', 'text'), p('code', 'text')] },
].map(capability => ({
  ...capability,
  pagePath: HR_ORGANIZATION_TYPE_PAGE_PATH,
  permission: '/dashboard/org/org-type',
  httpInstance: 'platform' as const,
}))
