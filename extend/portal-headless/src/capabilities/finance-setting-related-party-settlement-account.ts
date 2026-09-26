import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** 门户系统：财务设置 / 关联方结算科目配置；静态锚点 frontend d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH = '/dashboard/finance/setting/related-party-settlement-account/list'
const ROOT = '/admin-api/finance/payment-slip-society-related-settlement/subject-config'
const DETAIL_URL = '/admin-api/finance/related-party-settlement-account/getConfig'

export type FinanceRelatedPartySettlementAccountId = string | number
export type FinanceRelatedPartySettlementAccountStatus = 0 | 1
export type FinanceRelatedPartySettlementPaymentContent = string | number

export type FinanceRelatedPartySettlementAccountQuery = {
  paymentContent?: FinanceRelatedPartySettlementPaymentContent | null
  payerSubjectId?: FinanceRelatedPartySettlementAccountId | ''
  receiverSubjectId?: FinanceRelatedPartySettlementAccountId | ''
  status?: FinanceRelatedPartySettlementAccountStatus | null
  pageNo?: number
  pageSize?: number
}

export type FinanceRelatedPartySettlementAccountRow = {
  id: FinanceRelatedPartySettlementAccountId
  paymentContent: FinanceRelatedPartySettlementPaymentContent | null
  payerDebitSubjectId: FinanceRelatedPartySettlementAccountId | null
  payerDebitSubjectName: string | null
  payerCreditSubjectId: FinanceRelatedPartySettlementAccountId | null
  payerCreditSubjectName: string | null
  payeeDebitSubjectId: FinanceRelatedPartySettlementAccountId | null
  payeeDebitSubjectName: string | null
  payeeCreditSubjectId: FinanceRelatedPartySettlementAccountId | null
  payeeCreditSubjectName: string | null
  status: FinanceRelatedPartySettlementAccountStatus
  remark: string | null
}

/** Portal 详情页 customLoad 实际映射到表单的字段；不强制列表状态/备注。 */
export type FinanceRelatedPartySettlementAccountDetail = {
  id: FinanceRelatedPartySettlementAccountId
  paymentContent: FinanceRelatedPartySettlementPaymentContent | null
  payerDebitSubjectId: FinanceRelatedPartySettlementAccountId | null
  payerCreditSubjectId: FinanceRelatedPartySettlementAccountId | null
  payeeDebitSubjectId: FinanceRelatedPartySettlementAccountId | null
  payeeCreditSubjectId: FinanceRelatedPartySettlementAccountId | null
}

export type FinanceRelatedPartySettlementAccountSavePayload = {
  paymentContent: FinanceRelatedPartySettlementPaymentContent
  payerDebitSubjectId: FinanceRelatedPartySettlementAccountId
  payerCreditSubjectId: FinanceRelatedPartySettlementAccountId
  payeeDebitSubjectId: FinanceRelatedPartySettlementAccountId
  payeeCreditSubjectId: FinanceRelatedPartySettlementAccountId
  status: FinanceRelatedPartySettlementAccountStatus
  remark?: string | null
}

export type FinanceRelatedPartySettlementAccountCreateDraft = Omit<FinanceRelatedPartySettlementAccountSavePayload, 'remark' | 'status'> & {
  status?: FinanceRelatedPartySettlementAccountStatus
  remark?: string | null
}

export type FinanceRelatedPartySettlementAccountUpdateChanges = Partial<Omit<FinanceRelatedPartySettlementAccountSavePayload, 'status' | 'remark'>> & {
  remark?: string | null
}

export type FinanceRelatedPartySettlementAccountPreparedUpdate = {
  draft: FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId }
  previous: FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId }
}

export type FinanceRelatedPartySettlementAccountStatusPayload = FinanceRelatedPartySettlementAccountRow & {
  status: FinanceRelatedPartySettlementAccountStatus
}

export type FinanceRelatedPartySettlementAccountPreparedStatus = {
  draft: FinanceRelatedPartySettlementAccountStatusPayload
  previous: FinanceRelatedPartySettlementAccountStatusPayload
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceRelatedPartySettlementAccountId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或无前导零的正整数字符串`)
  }
  return value
}

function optionalIdOf (value: unknown, label: string): FinanceRelatedPartySettlementAccountId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function paymentContentOf (value: unknown, label: string, nullable = false): FinanceRelatedPartySettlementPaymentContent | null {
  if (nullable && (value === undefined || value === null || value === '')) return null
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数或数字字符串`)
    return value
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  throw new Error(`${label}必须为安全整数或数字字符串`)
}

function statusOf (value: unknown, label = 'status'): FinanceRelatedPartySettlementAccountStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function optionalTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function positiveIntegerOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return Number(resolved)
}

function queryValueOf (value: unknown, label: string): unknown {
  if (value === undefined) return ''
  if (value === null || value === '') return value
  if (label === 'paymentContent') return paymentContentOf(value, label)
  return idOf(value, label)
}

function queryOf (query: FinanceRelatedPartySettlementAccountQuery): Record<string, unknown> {
  if (query?.status !== undefined && query.status !== null) statusOf(query.status)
  return {
    order: '',
    orderField: '',
    paymentContent: queryValueOf(query?.paymentContent, 'paymentContent'),
    payerSubjectId: queryValueOf(query?.payerSubjectId, 'payerSubjectId'),
    receiverSubjectId: queryValueOf(query?.receiverSubjectId, 'receiverSubjectId'),
    status: query?.status ?? null,
    pageNo: positiveIntegerOf(query?.pageNo, 1, 'pageNo'),
    pageSize: positiveIntegerOf(query?.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown): FinanceRelatedPartySettlementAccountRow {
  const row = objectOf(value, '关联方结算科目配置列表行')
  return {
    id: idOf(row.id, '关联方结算科目配置id'),
    paymentContent: paymentContentOf(row.paymentContent, 'paymentContent', true),
    payerDebitSubjectId: optionalIdOf(row.payerDebitSubjectId, 'payerDebitSubjectId'),
    payerDebitSubjectName: optionalTextOf(row.payerDebitSubjectName, 'payerDebitSubjectName'),
    payerCreditSubjectId: optionalIdOf(row.payerCreditSubjectId, 'payerCreditSubjectId'),
    payerCreditSubjectName: optionalTextOf(row.payerCreditSubjectName, 'payerCreditSubjectName'),
    payeeDebitSubjectId: optionalIdOf(row.payeeDebitSubjectId, 'payeeDebitSubjectId'),
    payeeDebitSubjectName: optionalTextOf(row.payeeDebitSubjectName, 'payeeDebitSubjectName'),
    payeeCreditSubjectId: optionalIdOf(row.payeeCreditSubjectId, 'payeeCreditSubjectId'),
    payeeCreditSubjectName: optionalTextOf(row.payeeCreditSubjectName, 'payeeCreditSubjectName'),
    status: statusOf(row.status),
    remark: optionalTextOf(row.remark, 'remark'),
  }
}

function detailOf (value: unknown): FinanceRelatedPartySettlementAccountDetail {
  const row = objectOf(value, '关联方结算科目配置详情')
  return {
    id: idOf(row.id, '详情id'),
    paymentContent: paymentContentOf(row.paymentContent, 'paymentContent', true),
    payerDebitSubjectId: optionalIdOf(row.payerDebitSubjectId, 'payerDebitSubjectId'),
    payerCreditSubjectId: optionalIdOf(row.payerCreditSubjectId, 'payerCreditSubjectId'),
    payeeDebitSubjectId: optionalIdOf(row.payeeDebitSubjectId, 'payeeDebitSubjectId'),
    payeeCreditSubjectId: optionalIdOf(row.payeeCreditSubjectId, 'payeeCreditSubjectId'),
  }
}

function requiredSubjectOf (value: unknown, label: string): FinanceRelatedPartySettlementAccountId {
  return idOf(value, label)
}

function savePayloadOf (input: unknown, label: string, withId: boolean): FinanceRelatedPartySettlementAccountSavePayload & Partial<{ id: FinanceRelatedPartySettlementAccountId }> {
  const value = objectOf(input, label)
  const payload: FinanceRelatedPartySettlementAccountSavePayload & Partial<{ id: FinanceRelatedPartySettlementAccountId }> = {
    paymentContent: paymentContentOf(value.paymentContent, `${label}.paymentContent`)!,
    payerDebitSubjectId: requiredSubjectOf(value.payerDebitSubjectId, `${label}.payerDebitSubjectId`),
    payerCreditSubjectId: requiredSubjectOf(value.payerCreditSubjectId, `${label}.payerCreditSubjectId`),
    payeeDebitSubjectId: requiredSubjectOf(value.payeeDebitSubjectId, `${label}.payeeDebitSubjectId`),
    payeeCreditSubjectId: requiredSubjectOf(value.payeeCreditSubjectId, `${label}.payeeCreditSubjectId`),
    status: statusOf(value.status === undefined ? 1 : value.status, `${label}.status`),
  }
  if (Object.prototype.hasOwnProperty.call(value, 'remark')) payload.remark = optionalTextOf(value.remark, `${label}.remark`)
  if (withId) payload.id = idOf(value.id, `${label}.id`)
  return payload
}

function createPayloadOf (input: FinanceRelatedPartySettlementAccountCreateDraft): FinanceRelatedPartySettlementAccountSavePayload {
  return savePayloadOf(input, '创建关联方结算科目配置输入', false) as FinanceRelatedPartySettlementAccountSavePayload
}

function updatePayloadOf (input: { current: unknown; changes?: FinanceRelatedPartySettlementAccountUpdateChanges | null }): FinanceRelatedPartySettlementAccountPreparedUpdate {
  const current = savePayloadOf(input?.current, '编辑关联方结算科目配置当前值', true) as FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId }
  const changes = input?.changes
  const changeObject = changes === undefined || changes === null ? {} : objectOf(changes, '编辑关联方结算科目配置变更')
  const allowed = new Set(['paymentContent', 'payerDebitSubjectId', 'payerCreditSubjectId', 'payeeDebitSubjectId', 'payeeCreditSubjectId', 'remark'])
  for (const key of Object.keys(changeObject)) {
    if (!allowed.has(key)) throw new Error(`编辑关联方结算科目配置变更不支持字段${key}`)
  }
  const draftInput = { ...current, ...changeObject }
  const draft = savePayloadOf(draftInput, '编辑关联方结算科目配置草稿', true) as FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId }
  return { draft, previous: current }
}

function statusPayloadOf (input: unknown, label: string): FinanceRelatedPartySettlementAccountStatusPayload {
  const row = rowOf(input)
  // Portal状态按钮展开整行提交，后端SaveReqVO仍要求付款内容和四个科目ID非空。
  savePayloadOf(input, label, true)
  return {
    id: row.id,
    paymentContent: row.paymentContent,
    payerDebitSubjectId: row.payerDebitSubjectId,
    payerDebitSubjectName: row.payerDebitSubjectName,
    payerCreditSubjectId: row.payerCreditSubjectId,
    payerCreditSubjectName: row.payerCreditSubjectName,
    payeeDebitSubjectId: row.payeeDebitSubjectId,
    payeeDebitSubjectName: row.payeeDebitSubjectName,
    payeeCreditSubjectId: row.payeeCreditSubjectId,
    payeeCreditSubjectName: row.payeeCreditSubjectName,
    status: statusOf(objectOf(input, label).status, `${label}.status`),
    remark: row.remark,
  }
}

function trueResult (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

/** Caller injects createPageCall(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH). */
export function createFinanceSettingRelatedPartySettlementAccountCapability (request: PortalRequest) {
  return {
    async list (query: FinanceRelatedPartySettlementAccountQuery = {}): Promise<{ list: FinanceRelatedPartySettlementAccountRow[]; total: number }> {
      const result = await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      const value = objectOf(result, '关联方结算科目配置分页响应')
      if (!Array.isArray(value.list) || !Number.isSafeInteger(value.total) || Number(value.total) < 0) {
        throw new Error('关联方结算科目配置分页响应缺少有效list或total')
      }
      return { list: value.list.map(rowOf), total: Number(value.total) }
    },

    async detail (input: { id: FinanceRelatedPartySettlementAccountId }): Promise<FinanceRelatedPartySettlementAccountDetail> {
      const id = idOf(input?.id, '详情id')
      const result = await request<unknown>({ url: DETAIL_URL, method: 'get', params: { id } })
      if (result === null || result === undefined) throw new Error('关联方结算科目配置详情为空')
      return detailOf(result)
    },

    prepareCreate (input: FinanceRelatedPartySettlementAccountCreateDraft): { draft: FinanceRelatedPartySettlementAccountSavePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceRelatedPartySettlementAccountCreateDraft): Promise<FinanceRelatedPartySettlementAccountId> {
      const result = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: createPayloadOf(input) })
      return idOf(result, '新建关联方结算科目配置返回的id')
    },

    prepareUpdate (input: { current: FinanceRelatedPartySettlementAccountRow | FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId }; changes?: FinanceRelatedPartySettlementAccountUpdateChanges | null }): FinanceRelatedPartySettlementAccountPreparedUpdate {
      return updatePayloadOf(input)
    },

    async update (input: { draft: FinanceRelatedPartySettlementAccountSavePayload & { id: FinanceRelatedPartySettlementAccountId } }): Promise<true> {
      const draft = savePayloadOf(input?.draft, '关联方结算科目配置更新输入', true)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft })
      return trueResult(result, '更新关联方结算科目配置')
    },

    prepareSetStatus (input: { current: FinanceRelatedPartySettlementAccountRow; targetStatus: FinanceRelatedPartySettlementAccountStatus }): FinanceRelatedPartySettlementAccountPreparedStatus {
      const previous = statusPayloadOf(input?.current, '启停关联方结算科目配置当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (previous.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return { draft: { ...previous, status: targetStatus }, previous }
    },

    async setStatus (input: { draft: FinanceRelatedPartySettlementAccountStatusPayload }): Promise<true> {
      const draft = statusPayloadOf(input?.draft, '关联方结算科目配置启停输入')
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: draft })
      return trueResult(result, '启停关联方结算科目配置')
    },
  }
}

export type FinanceSettingRelatedPartySettlementAccountCapability = ReturnType<typeof createFinanceSettingRelatedPartySettlementAccountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description === undefined ? {} : { description }),
})

const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const saveParams: ParamSpec[] = [
  p('paymentContent', 'enum', true, '付款内容字典finance_related_settlement_content的value'),
  p('payerDebitSubjectId', 'text', true, '付款方借方会计科目主键ID'),
  p('payerCreditSubjectId', 'text', true, '付款方贷方会计科目主键ID'),
  p('payeeDebitSubjectId', 'text', true, '收款方借方会计科目主键ID'),
  p('payeeCreditSubjectId', 'text', true, '收款方贷方会计科目主键ID'),
  { ...p('status', 'enum', false, '绝对状态：0停用、1启用；创建默认1'), options: statusOptions },
  p('remark', 'text', false, '后端保存备注；页面未提供输入控件'),
]

export const FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS = {
  'finance-setting-related-party-settlement-account-list': 'list',
  'finance-setting-related-party-settlement-account-detail': 'detail',
  'finance-setting-related-party-settlement-account-prepare-create': 'prepareCreate',
  'finance-setting-related-party-settlement-account-create': 'create',
  'finance-setting-related-party-settlement-account-prepare-update': 'prepareUpdate',
  'finance-setting-related-party-settlement-account-update': 'update',
  'finance-setting-related-party-settlement-account-prepare-set-status': 'prepareSetStatus',
  'finance-setting-related-party-settlement-account-set-status': 'setStatus',
} as const

export const financeSettingRelatedPartySettlementAccountCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-related-party-settlement-account-list', title: '查询关联方结算科目配置', write: false, params: [p('paymentContent', 'enum'), p('payerSubjectId', 'text'), p('receiverSubjectId', 'text'), { ...p('status', 'enum'), options: statusOptions }, p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'finance-setting-related-party-settlement-account-detail', title: '查看关联方结算科目配置', write: false, params: [p('id', 'text', true, '配置主键ID；来自当前列表行')] },
  { id: 'finance-setting-related-party-settlement-account-prepare-create', title: '准备创建关联方结算科目配置', write: false, params: saveParams },
  { id: 'finance-setting-related-party-settlement-account-create', title: '创建关联方结算科目配置', write: true, params: saveParams },
  { id: 'finance-setting-related-party-settlement-account-prepare-update', title: '准备编辑关联方结算科目配置', write: false, params: [p('current', 'text', true, '来自最新列表或详情的完整配置行'), p('changes', 'text', false, '只包含付款内容或四个科目ID、remark的变更')] },
  { id: 'finance-setting-related-party-settlement-account-update', title: '编辑关联方结算科目配置', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整保存草稿')] },
  { id: 'finance-setting-related-party-settlement-account-prepare-set-status', title: '准备启停关联方结算科目配置', write: false, params: [p('current', 'text', true, '来自最新列表的完整配置行'), { ...p('targetStatus', 'enum', true, '与当前状态相反的绝对目标状态'), options: statusOptions }] },
  { id: 'finance-setting-related-party-settlement-account-set-status', title: '启停关联方结算科目配置', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的整行启停草稿')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_PAGE_PATH,
  permission: '/dashboard/finance/setting/related-party-settlement-account',
  moduleType: null,
  httpInstance: 'platform' as const,
}))
