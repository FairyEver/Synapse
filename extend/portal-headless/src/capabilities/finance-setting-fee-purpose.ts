import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 费用用途管理」；静态锚点 Portal/Java 当前固定检出。 */
export const FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH = '/dashboard/finance/setting/fee-purpose/list'
export const FINANCE_SETTING_FEE_PURPOSE_PERMISSION = '/dashboard/finance/setting/fee-purpose'
export const FINANCE_SETTING_FEE_PURPOSE_MODULE_TYPE = null

const ROOT = '/admin-api/finance/fee-purpose'

export type FinanceSettingFeePurposeId = string | number
export type FinanceSettingFeePurposeStatus = 0 | 1
export type FinanceSettingFeePurposeStatusFilter = FinanceSettingFeePurposeStatus | 'all'

export type FinanceSettingFeePurposeQuery = {
  applicationType?: string | null
  feeCode?: string | number | null
  keyword?: string | null
  /** Portal的“全部”是省略status；省略参数本身则复刻页面初始值0（启用）。 */
  status?: FinanceSettingFeePurposeStatusFilter | null
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingFeePurposeOption = {
  value: string
  label: string
}

export type FinanceSettingFeePurposeRow = {
  id: FinanceSettingFeePurposeId
  applicationType: string
  applicationTypeName: string
  feeCode: string
  feeName: string
  purpose: string
  status: FinanceSettingFeePurposeStatus
  createTime: string | number | null
  updateTime: string | number | null
}

export type FinanceSettingFeePurposeDetail = FinanceSettingFeePurposeRow

export type FinanceSettingFeePurposeCreateInput = {
  applicationType: string
  feeCode: string | number
  purpose: string
}

export type FinanceSettingFeePurposeCreateDraft = {
  applicationType: string
  feeCode: string
  purpose: string
}

export type FinanceSettingFeePurposeCreateSubmitInput = {
  draft: FinanceSettingFeePurposeCreateDraft
}

export type FinanceSettingFeePurposeUpdateChanges = {
  purpose?: string
}

export type FinanceSettingFeePurposeUpdateInput = {
  current: FinanceSettingFeePurposeDetail | FinanceSettingFeePurposeRow
  changes?: FinanceSettingFeePurposeUpdateChanges | null
}

export type FinanceSettingFeePurposeUpdateDraft = {
  id: FinanceSettingFeePurposeId
  purpose: string
}

export type FinanceSettingFeePurposeUpdateSubmitInput = {
  draft: FinanceSettingFeePurposeUpdateDraft
}

export type FinanceSettingFeePurposePreparedUpdate = {
  draft: FinanceSettingFeePurposeUpdateDraft
  previous: FinanceSettingFeePurposeUpdateDraft
}

export type FinanceSettingFeePurposeStatusDraft = {
  id: FinanceSettingFeePurposeId
  status: FinanceSettingFeePurposeStatus
}

export type FinanceSettingFeePurposePreparedStatus = {
  draft: FinanceSettingFeePurposeStatusDraft
  previous: FinanceSettingFeePurposeStatusDraft
}

export type FinanceSettingFeePurposeRemoveInput = {
  current: FinanceSettingFeePurposeDetail | FinanceSettingFeePurposeRow
}

export type FinanceSettingFeePurposeRemoveDraft = {
  id: FinanceSettingFeePurposeId
}

export type FinanceSettingFeePurposeRemoveSubmitInput = {
  draft: FinanceSettingFeePurposeRemoveDraft
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingFeePurposeId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  return value
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须为${allowEmpty ? '字符串' : '非空字符串'}`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  return textOf(value, label, true)
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingFeePurposeStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function optionalQueryTextOf (value: unknown, label: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return textOf(value, label, true)
}

function optionalKeywordOf (value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return textOf(value, 'keyword', true).trim() || undefined
}

function queryOf (query: FinanceSettingFeePurposeQuery = {}): Record<string, unknown> {
  const source = query ?? {}
  const status = source.status === undefined ? 0 : source.status
  const result: Record<string, unknown> = {
    pageNo: pageNumberOf(source.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(source.pageSize, 10, 'pageSize'),
    applicationType: optionalQueryTextOf(source.applicationType, 'applicationType'),
    feeCode: source.feeCode === null || source.feeCode === undefined || source.feeCode === '' ? undefined : source.feeCode,
    keyword: optionalKeywordOf(source.keyword),
  }
  if (status === 0 || status === 1) result.status = status
  else if (status !== 'all' && status !== null) throw new Error('status只能是0（启用）、1（停用）或all（全部）')
  return result
}

function optionOf (value: unknown, label: string): FinanceSettingFeePurposeOption {
  const option = objectOf(value, label)
  return {
    value: textOf(option.value, `${label}.value`),
    label: textOf(option.label, `${label}.label`, true),
  }
}

function optionsOf (value: unknown, label: string): FinanceSettingFeePurposeOption[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => optionOf(item, `${label}[${index}]`))
}

function rowOf (value: unknown, label = '费用用途列表行'): FinanceSettingFeePurposeRow {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    applicationType: textOf(row.applicationType, `${label}.applicationType`),
    applicationTypeName: textOf(row.applicationTypeName, `${label}.applicationTypeName`, true),
    feeCode: textOf(row.feeCode, `${label}.feeCode`),
    feeName: textOf(row.feeName, `${label}.feeName`, true),
    purpose: purposeOf(row.purpose, `${label}.purpose`),
    status: statusOf(row.status, `${label}.status`),
    createTime: dateTimeOf(row.createTime, `${label}.createTime`),
    updateTime: dateTimeOf(row.updateTime, `${label}.updateTime`),
  }
}

function pageOf (value: unknown): PageResult<FinanceSettingFeePurposeRow> {
  const page = objectOf(value, '费用用途分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('费用用途分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `费用用途分页响应.list[${index}]`)), total: Number(page.total) }
}

function purposeOf (value: unknown, label: string): string {
  const purpose = textOf(value, label)
  if ([...purpose].length > 15) throw new Error(`${label}不能超过15个Unicode码点`)
  return purpose
}

function applicationTypeOf (value: unknown, label: string): string {
  return textOf(value, label)
}

function feeCodeOf (value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为字符串或数字`)
  const result = String(value)
  if (result.trim() === '') throw new Error(`${label}不能为空`)
  return result
}

function createDraftOf (input: FinanceSettingFeePurposeCreateInput): FinanceSettingFeePurposeCreateDraft {
  const value = objectOf(input, '创建费用用途输入')
  return {
    applicationType: applicationTypeOf(value.applicationType, 'applicationType'),
    feeCode: feeCodeOf(value.feeCode, 'feeCode'),
    purpose: purposeOf(value.purpose, 'purpose'),
  }
}

function createSubmitDraftOf (input: FinanceSettingFeePurposeCreateSubmitInput): FinanceSettingFeePurposeCreateDraft {
  const value = objectOf(input, '提交创建费用用途输入')
  return createDraftOf(objectOf(value.draft, '创建费用用途draft') as FinanceSettingFeePurposeCreateInput)
}

function updateDraftOf (value: unknown, label: string): FinanceSettingFeePurposeUpdateDraft {
  const draft = objectOf(value, label)
  return {
    id: idOf(draft.id, `${label}.id`),
    purpose: purposeOf(draft.purpose, `${label}.purpose`),
  }
}

function updatePayloadOf (input: FinanceSettingFeePurposeUpdateInput): FinanceSettingFeePurposePreparedUpdate {
  const current = rowOf(input?.current, '编辑费用用途当前值')
  if (current.status !== 1) throw new Error('只能编辑当前停用的费用用途；请刷新后再操作')
  const changes = input?.changes === undefined || input?.changes === null ? {} : objectOf(input.changes, '编辑费用用途变更')
  for (const key of Object.keys(changes)) if (key !== 'purpose') throw new Error(`编辑费用用途变更不支持字段${key}`)
  const previous = { id: current.id, purpose: purposeOf(current.purpose, '当前purpose') }
  const draft = { id: current.id, purpose: purposeOf(Object.prototype.hasOwnProperty.call(changes, 'purpose') ? changes.purpose : current.purpose, '编辑purpose') }
  return { draft, previous }
}

function updateSubmitDraftOf (input: FinanceSettingFeePurposeUpdateSubmitInput): FinanceSettingFeePurposeUpdateDraft {
  const value = objectOf(input, '提交编辑费用用途输入')
  return updateDraftOf(value.draft, '编辑费用用途draft')
}

function statusDraftOf (value: unknown, label: string): FinanceSettingFeePurposeStatusDraft {
  const draft = objectOf(value, label)
  return { id: idOf(draft.id, `${label}.id`), status: statusOf(draft.status, `${label}.status`) }
}

function removeDraftOf (value: unknown, label: string): FinanceSettingFeePurposeRemoveDraft {
  const draft = objectOf(value, label)
  return { id: idOf(draft.id, `${label}.id`) }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** The injected request must be created for FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH. */
export function createFinanceSettingFeePurposeCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingFeePurposeQuery = {}): Promise<PageResult<FinanceSettingFeePurposeRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },

    async get (input: { id: FinanceSettingFeePurposeId }): Promise<FinanceSettingFeePurposeDetail> {
      const id = idOf(input?.id, '费用用途id')
      return rowOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '费用用途详情')
    },

    async searchApplicationTypes (input: { keyword?: string | null } = {}): Promise<FinanceSettingFeePurposeOption[]> {
      const keyword = optionalKeywordOf(input?.keyword)
      return optionsOf(await request({ url: `${ROOT}/application-type-options`, method: 'get', params: { keyword } }), '申请类型候选')
    },

    async searchFees (input: { applicationType: string; keyword?: string | null }): Promise<FinanceSettingFeePurposeOption[]> {
      const applicationType = applicationTypeOf(input?.applicationType, 'applicationType')
      const keyword = optionalKeywordOf(input?.keyword)
      return optionsOf(await request({ url: `${ROOT}/fee-options`, method: 'get', params: { applicationType, keyword } }), '费用候选')
    },

    prepareCreate (input: FinanceSettingFeePurposeCreateInput): { draft: FinanceSettingFeePurposeCreateDraft } {
      return { draft: createDraftOf(input) }
    },

    async create (input: FinanceSettingFeePurposeCreateSubmitInput): Promise<FinanceSettingFeePurposeId> {
      const draft = createSubmitDraftOf(input)
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: draft }), '新建费用用途返回的id')
    },

    prepareUpdate (input: FinanceSettingFeePurposeUpdateInput): FinanceSettingFeePurposePreparedUpdate {
      return updatePayloadOf(input)
    },

    async update (input: FinanceSettingFeePurposeUpdateSubmitInput): Promise<true> {
      const draft = updateSubmitDraftOf(input)
      return trueResult(await request({ url: `${ROOT}/update`, method: 'put', data: draft }), '更新费用用途')
    },

    prepareSetStatus (input: { current: FinanceSettingFeePurposeRow; targetStatus: FinanceSettingFeePurposeStatus }): FinanceSettingFeePurposePreparedStatus {
      const current = rowOf(input?.current, '启停费用用途当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与当前status相反')
      return {
        draft: { id: current.id, status: targetStatus },
        previous: { id: current.id, status: current.status },
      }
    },

    async setStatus (input: { draft: FinanceSettingFeePurposeStatusDraft }): Promise<true> {
      const draft = statusDraftOf(input?.draft, '启停费用用途draft')
      return trueResult(await request({ url: `${ROOT}/update-status`, method: 'put', data: draft }), '启停费用用途')
    },

    prepareRemove (input: FinanceSettingFeePurposeRemoveInput): { draft: FinanceSettingFeePurposeRemoveDraft } {
      const current = rowOf(input?.current, '删除费用用途当前值')
      if (current.status !== 1) throw new Error('只能删除当前停用的费用用途；请刷新后再操作')
      return { draft: { id: current.id } }
    },

    async remove (input: FinanceSettingFeePurposeRemoveSubmitInput): Promise<true> {
      const draft = removeDraftOf(input?.draft, '删除费用用途draft')
      return trueResult(await request({ url: `${ROOT}/delete`, method: 'delete', params: { id: draft.id } }), '删除费用用途')
    },
  }
}

export type FinanceSettingFeePurposeCapability = ReturnType<typeof createFinanceSettingFeePurposeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const statusOptions = [{ label: '启用', value: 0 }, { label: '停用', value: 1 }]
const statusFilterOptions = [{ label: '全部', value: 'all' }, ...statusOptions]
const statusParam: ParamSpec = { ...p('status', 'enum'), description: '列表筛选：all表示全部（请求省略status），0启用，1停用；页面默认0', options: statusFilterOptions }
const createParams: ParamSpec[] = [
  p('applicationType', 'search', true, '稳定申请单类型value；先用申请类型候选按名称关键字查询'),
  p('feeCode', 'search', true, '当前申请类型下的费用代码字符串；先用费用候选查询，不能用费用名称代替'),
  p('purpose', 'text', true, '费用用途文本；去首尾空白后不能为空，最多15个Unicode码点'),
]

export const FINANCE_SETTING_FEE_PURPOSE_METHODS = {
  'finance-setting-fee-purpose-list': 'list',
  'finance-setting-fee-purpose-get': 'get',
  'finance-setting-fee-purpose-application-type-options': 'searchApplicationTypes',
  'finance-setting-fee-purpose-fee-options': 'searchFees',
  'finance-setting-fee-purpose-prepare-create': 'prepareCreate',
  'finance-setting-fee-purpose-create': 'create',
  'finance-setting-fee-purpose-prepare-update': 'prepareUpdate',
  'finance-setting-fee-purpose-update': 'update',
  'finance-setting-fee-purpose-prepare-set-status': 'prepareSetStatus',
  'finance-setting-fee-purpose-set-status': 'setStatus',
  'finance-setting-fee-purpose-prepare-remove': 'prepareRemove',
  'finance-setting-fee-purpose-remove': 'remove',
} as const

export const financeSettingFeePurposeCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-fee-purpose-list', title: '查询费用用途列表', write: false, params: [p('applicationType', 'search', false, '申请单类型value；来自申请类型候选'), p('feeCode', 'search', false, '费用代码字符串；来自当前申请类型费用候选'), p('keyword', 'text', false, '费用用途关键字；SDK去首尾空白，空值不发送'), statusParam, p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, '每页条数；默认10，页面支持10、20、50、100')] },
  { id: 'finance-setting-fee-purpose-get', title: '查询费用用途详情', write: false, params: [p('id', 'text', true, '费用用途主键ID')] },
  { id: 'finance-setting-fee-purpose-application-type-options', title: '查询费用用途申请类型候选', write: false, params: [p('keyword', 'text', false, '申请类型名称关键字；空值加载页面候选')] },
  { id: 'finance-setting-fee-purpose-fee-options', title: '查询费用用途费用候选', write: false, params: [p('applicationType', 'search', true, '申请单类型value；必须先选申请类型'), p('keyword', 'text', false, '费用名称关键字；空值加载该类型候选')] },
  { id: 'finance-setting-fee-purpose-prepare-create', title: '准备创建费用用途', write: false, params: createParams },
  { id: 'finance-setting-fee-purpose-create', title: '创建费用用途', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的{applicationType,feeCode,purpose}草稿')] },
  { id: 'finance-setting-fee-purpose-prepare-update', title: '准备编辑费用用途', write: false, params: [p('current', 'text', true, '来自最新列表或详情的完整行；必须是停用状态'), p('changes', 'text', false, '只允许包含purpose')] },
  { id: 'finance-setting-fee-purpose-update', title: '编辑费用用途', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的{id,purpose}草稿')] },
  { id: 'finance-setting-fee-purpose-prepare-set-status', title: '准备启停费用用途', write: false, params: [p('current', 'text', true, '来自最新列表或详情的完整行'), { ...statusParam, name: 'targetStatus', required: true, description: '与current.status相反的绝对目标状态；0启用，1停用' }] },
  { id: 'finance-setting-fee-purpose-set-status', title: '启停费用用途', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{id,status}草稿')] },
  { id: 'finance-setting-fee-purpose-prepare-remove', title: '准备删除费用用途', write: false, params: [p('current', 'text', true, '来自最新列表或详情的完整行；必须是停用状态')] },
  { id: 'finance-setting-fee-purpose-remove', title: '删除费用用途', write: true, params: [p('draft', 'text', true, 'prepareRemove返回的{id}草稿；删除为服务端逻辑删除且页面没有恢复按钮')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_FEE_PURPOSE_PAGE_PATH,
  permission: FINANCE_SETTING_FEE_PURPOSE_PERMISSION,
  moduleType: FINANCE_SETTING_FEE_PURPOSE_MODULE_TYPE,
  httpInstance: 'platform',
}))
