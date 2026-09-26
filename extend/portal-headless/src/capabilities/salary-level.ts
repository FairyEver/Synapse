import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

export const SALARY_LEVEL_PAGE_PATH = '/dashboard/salary/salary-level/list'
export const SALARY_LEVEL_PERMISSION = '/dashboard/salary/salary-level'
export const SALARY_LEVEL_MODULE_TYPE = 14

const ROOT = '/org/hrsalarylevel'
const SENSITIVE_INFO_URL = '/org/sensitive/info'
const SMS_SEND_URL = '/sys/sms/send'
const SMS_CHECK_URL = '/sys/sms/checkSms'

export type SalaryLevelId = string | number
export type SalaryLevelStandard = number | string
export type SalaryLevelRow = Record<string, unknown> & {
  id?: SalaryLevelId | null
  name?: string | null
  status?: number | null
  sort?: number | null
  isDel?: number | null
  salaryStandard?: SalaryLevelStandard | null
}
export type SalaryLevelQuery = {
  name?: string | null
  pageNo?: number
  pageSize?: number
  order?: string | null
  orderField?: string | null
}
export type SalaryLevelDraft = {
  name: string
  sort: number
  salaryStandard: SalaryLevelStandard
}
export type SalaryLevelIds = { ids: SalaryLevelId[] }
export type SalaryLevelDelete = SalaryLevelIds & { smsRequestId?: string; code?: string }
export type SalaryLevelDeletePreparation = {
  ids: string[]
  verificationRequired: boolean
  phone: string | null
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('薪资等级ID必须为正整数')
    return String(value)
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error('薪资等级ID必须为正整数字符串或安全正整数')
}

function idsOf (input: SalaryLevelIds): string[] {
  if (!Array.isArray(input?.ids) || input.ids.length === 0) throw new Error('ids至少包含一个薪资等级ID')
  return [...new Set(input.ids.map(idOf))]
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是10、20、50、100、200或500')
  return resolved
}

function textOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function salaryStandardOf (value: unknown): SalaryLevelStandard {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100) throw new Error('salaryStandard必须为非负且最多两位小数的金额')
    return value
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return value
  throw new Error('salaryStandard必须为非负且最多两位小数的金额')
}

function draftOf (input: SalaryLevelDraft): SalaryLevelDraft {
  const value = objectOf(input, '薪资等级表单')
  const name = textOf(value.name, 'name')
  if (!name.trim()) throw new Error('name必填且不能全为空格')
  if (name.length > 50) throw new Error('name最多50个字符')
  const sort = value.sort
  if (typeof sort !== 'number' || !Number.isSafeInteger(sort) || sort < 0) throw new Error('sort必填且必须为非负整数')
  return { name, sort, salaryStandard: salaryStandardOf(value.salaryStandard) }
}

function pageOf (value: unknown): PageResult<SalaryLevelRow> {
  const page = objectOf(value, '薪资等级分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error('薪资等级分页响应缺少有效list或total')
  return { list: page.list as SalaryLevelRow[], total: page.total }
}

function verificationOf (value: unknown): { verificationRequired: boolean; phone: string | null } {
  const sensitive = value === undefined || value === null ? {} : objectOf(value, '敏感操作配置')
  const mobile = typeof sensitive.mobile === 'string' ? sensitive.mobile : null
  const isDel = sensitive.isDel
  const isEmptyState = sensitive.mobile === undefined && sensitive.isDel === undefined
  return {
    verificationRequired: !(isEmptyState || isDel === 1),
    phone: mobile || null,
  }
}

/** Portal 薪资等级列表及其编辑、删除确认链；由页面上下文绑定 platform/module-type=14。 */
export function createSalaryLevelCapability (request: PortalRequest) {
  async function prepareRemove (input: SalaryLevelIds): Promise<SalaryLevelDeletePreparation> {
    const ids = idsOf(input)
    await request({ url: `${ROOT}/checkCanDelete`, method: 'post', data: ids })
    const sensitive = verificationOf(await request({ url: SENSITIVE_INFO_URL, method: 'get' }))
    return { ids, ...sensitive }
  }

  return {
    async list (query: SalaryLevelQuery = {}): Promise<PageResult<SalaryLevelRow>> {
      return pageOf(await request({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: textOf(query.order, 'order'),
          orderField: textOf(query.orderField, 'orderField'),
          name: textOf(query.name, 'name'),
          pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
          pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }))
    },
    async get (input: { id: SalaryLevelId }): Promise<SalaryLevelRow | null> {
      return await request({ url: `${ROOT}/${idOf(input?.id)}`, method: 'get' }) as SalaryLevelRow | null
    },
    async create (input: SalaryLevelDraft): Promise<void> {
      await request({ url: `${ROOT}/save`, method: 'post', data: draftOf(input) })
    },
    async update (input: SalaryLevelDraft & { id: SalaryLevelId }): Promise<void> {
      const id = idOf(input?.id)
      await request({ url: `${ROOT}/save`, method: 'post', data: { ...draftOf(input), id } })
    },
    prepareRemove,
    async sendDeleteCode (input: SalaryLevelIds): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = objectOf(await request({ url: SMS_SEND_URL, method: 'get', params: { phone: prepared.phone, templateId: '17709' } }), '短信发送响应')
      if (sent.requestId === undefined || sent.requestId === null || sent.requestId === '') throw new Error('短信响应缺少requestId；发送结果不确定，不自动重发')
      return { smsRequestId: String(sent.requestId) }
    },
    async remove (input: SalaryLevelDelete): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (typeof input?.smsRequestId !== 'string' || !input.smsRequestId.trim() || typeof input?.code !== 'string' || !input.code.trim()) throw new Error('删除需要短信验证：先sendDeleteCode，再提供smsRequestId和用户收到的code')
        await request({ url: SMS_CHECK_URL, method: 'get', params: { requestId: input.smsRequestId, code: input.code } })
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}

export type SalaryLevelCapability = ReturnType<typeof createSalaryLevelCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}) })
const draftParams = [p('name', 'text', true, '薪资等级名称'), p('sort', 'number', true, '非负整数排序'), p('salaryStandard', 'number', true, '非负且最多两位小数的标准工资')]

export const SALARY_LEVEL_METHODS = {
  'salary-level-list': 'list',
  'salary-level-get': 'get',
  'salary-level-create': 'create',
  'salary-level-update': 'update',
  'salary-level-prepare-remove': 'prepareRemove',
  'salary-level-send-delete-code': 'sendDeleteCode',
  'salary-level-remove': 'remove',
} as const

export const salaryLevelCapabilities: CapabilityDefinition[] = [
  { id: 'salary-level-list', title: '查询薪资等级', write: false, params: [p('name', 'text'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')] },
  { id: 'salary-level-get', title: '读取薪资等级编辑详情', write: false, params: [p('id', 'text', true, '薪资等级ID')] },
  { id: 'salary-level-create', title: '创建薪资等级', write: true, params: draftParams },
  { id: 'salary-level-update', title: '修改薪资等级', write: true, params: [p('id', 'text', true, '薪资等级ID'), ...draftParams] },
  { id: 'salary-level-prepare-remove', title: '检查薪资等级删除条件', write: false, params: [p('ids', 'text', true, '薪资等级ID数组')] },
  { id: 'salary-level-send-delete-code', title: '发送薪资等级删除验证码', write: true, params: [p('ids', 'text', true, '薪资等级ID数组')] },
  { id: 'salary-level-remove', title: '删除薪资等级', write: true, params: [p('ids', 'text', true, '薪资等级ID数组'), p('smsRequestId', 'text'), p('code', 'text')] },
].map(item => ({ ...item, pagePath: SALARY_LEVEL_PAGE_PATH, permission: SALARY_LEVEL_PERMISSION, moduleType: SALARY_LEVEL_MODULE_TYPE, httpInstance: 'platform' as const }))
