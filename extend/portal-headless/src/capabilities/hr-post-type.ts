import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

export const HR_POST_TYPE_PAGE_PATH = '/dashboard/post/post-type/list'
export type HrPostTypeRow = { id: string | number; name: string; sort: number; remark?: string | null; [key: string]: unknown }
export type HrPostTypeDraft = { name: string; sort: number; remark?: string }
export type HrPostTypeQuery = { name?: string; pageNo?: number; pageSize?: number; order?: string; orderField?: string }
export type HrPostTypeIds = { ids: Array<string | number> }
export type HrPostTypeDelete = HrPostTypeIds & { smsRequestId?: string; code?: string }
export type HrPostTypeDeletePreparation = { ids: string[]; verificationRequired: boolean; phone: string | null }
const ROOT = '/org/hrposttype'

function id(value: string | number): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) || /^0+$/.test(String(value))) throw new Error('岗位类别 ID 必须为正整数字符串或安全正整数')
  return String(value)
}
function ids(input: HrPostTypeIds): string[] {
  if (!Array.isArray(input.ids) || input.ids.length === 0) throw new Error('ids 至少包含一个岗位类别 ID')
  return [...new Set(input.ids.map(id))]
}
function draft(input: HrPostTypeDraft): HrPostTypeDraft {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 50) throw new Error('名称必填、不得全为空格且最多 50 个字符')
  if (!Number.isInteger(input.sort) || input.sort < 0) throw new Error('排序必填且为非负整数')
  const remark = input.remark ?? ''
  if (typeof remark !== 'string' || remark.length > 200 || (remark !== '' && !remark.trim())) throw new Error('备注最多 200 个字符且不得全为空格')
  return { name: input.name, sort: input.sort, remark }
}

/** Caller injects createPageCall(HR_POST_TYPE_PAGE_PATH); platform instance and module 11 remain centralized. */
export function createHrPostTypeCapability(request: PortalRequest) {
  async function prepareRemove(input: HrPostTypeIds): Promise<HrPostTypeDeletePreparation> {
    const normalized = ids(input)
    await request({ url: `${ROOT}/checkCanDelete`, method: 'post', data: normalized })
    const sensitive = await request<{ mobile?: string; isDel?: number } | null | undefined>({ url: '/org/sensitive/info', method: 'get' })
    // Exact UI branch from useSensitiveAction: empty configuration or isDel === 1 skips verification.
    const verificationRequired = !((sensitive?.mobile === undefined && sensitive?.isDel === undefined) || sensitive?.isDel === 1)
    return { ids: normalized, verificationRequired, phone: sensitive?.mobile || null }
  }
  return {
    async list(query: HrPostTypeQuery = {}): Promise<PageResult<HrPostTypeRow>> {
      return request({ url: `${ROOT}/page`, method: 'get', params: { order: query.order ?? '', orderField: query.orderField ?? '', name: query.name ?? '', pageNo: query.pageNo ?? 1, pageSize: query.pageSize ?? 20 } })
    },
    async get(input: { id: string | number }): Promise<HrPostTypeRow | null> {
      return request({ url: `${ROOT}/${id(input.id)}`, method: 'get' })
    },
    async create(input: HrPostTypeDraft): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draft(input) })
    },
    async update(input: HrPostTypeDraft & { id: string | number }): Promise<void> {
      const normalized = id(input.id)
      await request({ url: `${ROOT}/save`, method: 'post', data: { ...draft(input), id: normalized } })
    },
    prepareRemove,
    async sendDeleteCode(input: HrPostTypeIds): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接 remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await request<{ requestId?: string | number }>({ url: '/sys/sms/send', method: 'get', params: { phone: prepared.phone, templateId: '17709' } })
      if (!sent?.requestId) throw new Error('短信响应缺少 requestId；发送结果不确定，不自动重发')
      return { smsRequestId: String(sent.requestId) }
    },
    async remove(input: HrPostTypeDelete): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (!input.smsRequestId?.trim() || !input.code?.trim()) throw new Error('删除需要短信验证：先 sendDeleteCode，再提供 smsRequestId 和用户收到的 code')
        // Normal envelope handling rejects ret !== SUCCESS, including incorrect SMS codes.
        await request({ url: '/sys/sms/checkSms', method: 'get', params: { requestId: input.smsRequestId, code: input.code } })
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}
export type HrPostTypeCapability = ReturnType<typeof createHrPostTypeCapability>
const p = (name: string, kind: ParamSpec['kind'], required = false): ParamSpec => ({ name, kind, required })
const writes = [p('name', 'text', true), p('sort', 'number', true), p('remark', 'text')]
export const HR_POST_TYPE_METHODS = {
  'hr-post-type-list': 'list', 'hr-post-type-get': 'get', 'hr-post-type-create': 'create',
  'hr-post-type-update': 'update', 'hr-post-type-prepare-remove': 'prepareRemove',
  'hr-post-type-send-delete-code': 'sendDeleteCode', 'hr-post-type-remove': 'remove',
} as const
export const hrPostTypeCapabilities: CapabilityDefinition[] = [
  { id: 'hr-post-type-list', title: '查询岗位类别', write: false, params: [p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')] },
  { id: 'hr-post-type-get', title: '读取岗位类别编辑详情', write: false, params: [p('id', 'text', true)] },
  { id: 'hr-post-type-create', title: '创建岗位类别', write: true, params: writes },
  { id: 'hr-post-type-update', title: '修改岗位类别', write: true, params: [p('id', 'text', true), ...writes] },
  { id: 'hr-post-type-prepare-remove', title: '检查岗位类别删除条件', write: false, params: [p('ids', 'text', true)] },
  { id: 'hr-post-type-send-delete-code', title: '发送岗位类别删除验证码', write: true, params: [p('ids', 'text', true)] },
  { id: 'hr-post-type-remove', title: '删除岗位类别', write: true, params: [p('ids', 'text', true), p('smsRequestId', 'text'), p('code', 'text')] },
].map(c => ({ ...c, pagePath: HR_POST_TYPE_PAGE_PATH, permission: '/dashboard/post/post-type', httpInstance: 'platform' as const }))
