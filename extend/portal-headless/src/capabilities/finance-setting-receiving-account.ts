import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「财务设置 → 银行账户」；静态锚点 Portal d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH = '/dashboard/finance/setting/receiving-account/list'
const ROOT = '/admin-api/finance/receiving-account-number'
const CORPORATION_OPTIONS_URL = '/org/corporation/getAllLegalPerson'

export type FinanceSettingReceivingAccountId = string | number
export type FinanceSettingReceivingAccountStatus = 0 | 1

export type FinanceSettingReceivingAccountQuery = {
  organizationId?: FinanceSettingReceivingAccountId | '' | null
  corporationId?: FinanceSettingReceivingAccountId | '' | null
  bank?: number | '' | null
  bankAccount?: string
  accountType?: number | '' | null
  tenantName?: string
  status?: FinanceSettingReceivingAccountStatus
  pageNo?: number
  pageSize?: number
}

export type FinanceSettingReceivingAccountRow = {
  id: FinanceSettingReceivingAccountId
  organizationId: FinanceSettingReceivingAccountId | null
  corporationId: FinanceSettingReceivingAccountId | null
  tenantName: string | null
  orgName: string | null
  bank: number | null
  bankBranch: string | null
  bankAccount: string | null
  accountType: number | null
  accountBusiness: string
  accountMinimum: number | string | null
  isUsed: number | null
  status: FinanceSettingReceivingAccountStatus
  createTime: string | number | null
}

export type FinanceSettingReceivingAccountCorporation = {
  id: FinanceSettingReceivingAccountId
  name: string
}

export type FinanceSettingReceivingAccountPage = {
  list: FinanceSettingReceivingAccountRow[]
  total: number
}

/** Portal 新建表单的字段；不包含后端存在但该页面没有使用的 businessType 等字段。 */
export type FinanceSettingReceivingAccountCreateDraft = {
  organizationId: FinanceSettingReceivingAccountId
  corporationId: FinanceSettingReceivingAccountId
  bank: number
  bankBranch: string
  accountType: number
  bankAccount: string
  accountBusiness: number[]
  accountMinimum?: number | string | null
  isUsed?: 0 | 1
}

export type FinanceSettingReceivingAccountCreatePayload = {
  organizationId: FinanceSettingReceivingAccountId
  corporationId: FinanceSettingReceivingAccountId
  bank: number
  bankBranch: string
  accountType: number
  bankAccount: string
  accountBusiness: number[]
  accountMinimum: number | string | null
  isUsed: 0 | 1
}

export type FinanceSettingReceivingAccountStatusPayload = {
  id: FinanceSettingReceivingAccountId
  status: FinanceSettingReceivingAccountStatus
}

export type FinanceSettingReceivingAccountPreparedStatus = {
  draft: FinanceSettingReceivingAccountStatusPayload
  previous: FinanceSettingReceivingAccountStatusPayload
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FinanceSettingReceivingAccountId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  }
  return value
}

function nullableIdOf (value: unknown, label: string): FinanceSettingReceivingAccountId | null {
  return value === null || value === undefined ? null : idOf(value, label)
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : textOf(value, label)
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return Number(value)
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : integerOf(value, label)
}

function statusOf (value: unknown, label = 'status'): FinanceSettingReceivingAccountStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（启用）或1（停用）`)
  return value
}

function amountOf (value: unknown, label: string): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

/** a-input-number 的最小值和两位小数规则；未填写时Portal仍会发送初始空字符串。 */
function amountInputOf (value: unknown, label: string): number | string | null {
  if (value === undefined) return ''
  if (value === null || value === '') return value as null | ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || Math.abs(value - Math.round(value * 100) / 100) > 1e-9) {
      throw new Error(`${label}必须是大于等于0且最多两位小数的数字`)
    }
    return value
  }
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return value
  throw new Error(`${label}必须是大于等于0且最多两位小数的数字或空值`)
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}不能为空`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function accountBusinessOf (value: unknown, label = 'accountBusiness'): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空数值数组`)
  return value.map((item, index) => integerOf(item, `${label}[${index}]`))
}

function yesNoOf (value: unknown, label = 'isUsed'): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0或1`)
  return value
}

function dateTimeOf (value: unknown, label: string): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数值或null`)
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(resolved)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return resolved
}

function filterIdOf (value: unknown, label: string): FinanceSettingReceivingAccountId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function filterIntegerOf (value: unknown, label: string): number | '' {
  if (value === undefined || value === null || value === '') return ''
  return integerOf(value, label)
}

function filterTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  return textOf(value, label)
}

function queryOf (query: FinanceSettingReceivingAccountQuery = {}) {
  return {
    organizationId: filterIdOf(query.organizationId, 'organizationId'),
    corporationId: filterIdOf(query.corporationId, 'corporationId'),
    bank: filterIntegerOf(query.bank, 'bank'),
    bankAccount: filterTextOf(query.bankAccount, 'bankAccount'),
    accountType: filterIntegerOf(query.accountType, 'accountType'),
    tenantName: filterTextOf(query.tenantName, 'tenantName'),
    status: statusOf(query.status ?? 0),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function createPayloadOf (input: FinanceSettingReceivingAccountCreateDraft): FinanceSettingReceivingAccountCreatePayload {
  const value = objectOf(input, '创建银行账户输入')
  return {
    organizationId: idOf(value.organizationId, 'organizationId'),
    corporationId: idOf(value.corporationId, 'corporationId'),
    bank: integerOf(value.bank, 'bank'),
    bankBranch: requiredTextOf(value.bankBranch, 'bankBranch', 200),
    accountType: integerOf(value.accountType, 'accountType'),
    bankAccount: requiredTextOf(value.bankAccount, 'bankAccount'),
    accountBusiness: accountBusinessOf(value.accountBusiness),
    accountMinimum: amountInputOf(value.accountMinimum, 'accountMinimum'),
    // Portal form initializes isUsed to 1 and always spreads it into the create body.
    isUsed: yesNoOf(value.isUsed === undefined ? 1 : value.isUsed),
  }
}

function statusPayloadOf (input: unknown, label: string): FinanceSettingReceivingAccountStatusPayload {
  const value = objectOf(input, label)
  return {
    id: idOf(value.id, `${label}.id`),
    status: statusOf(value.status, `${label}.status`),
  }
}

function rowOf (value: unknown): FinanceSettingReceivingAccountRow {
  const row = objectOf(value, '银行账户列表行')
  return {
    id: idOf(row.id, '银行账户id'),
    organizationId: nullableIdOf(row.organizationId, 'organizationId'),
    corporationId: nullableIdOf(row.corporationId, 'corporationId'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
    orgName: nullableTextOf(row.orgName, 'orgName'),
    bank: nullableIntegerOf(row.bank, 'bank'),
    bankBranch: nullableTextOf(row.bankBranch, 'bankBranch'),
    bankAccount: nullableTextOf(row.bankAccount, 'bankAccount'),
    accountType: nullableIntegerOf(row.accountType, 'accountType'),
    // The Portal calls .split(',') on this field before passing it to its dictionary label.
    accountBusiness: textOf(row.accountBusiness, 'accountBusiness'),
    accountMinimum: amountOf(row.accountMinimum, 'accountMinimum'),
    isUsed: nullableIntegerOf(row.isUsed, 'isUsed'),
    status: statusOf(row.status),
    createTime: dateTimeOf(row.createTime, 'createTime'),
  }
}

function pageOf (value: unknown): FinanceSettingReceivingAccountPage {
  const page = objectOf(value, '银行账户分页响应')
  if (!Array.isArray(page.list) || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0) {
    throw new Error('银行账户分页响应缺少有效list或total')
  }
  return { list: page.list.map(rowOf), total: page.total }
}

function corporationListOf (value: unknown): FinanceSettingReceivingAccountCorporation[] {
  const list = Array.isArray(value) ? value : objectOf(value, '法人候选响应').data
  if (!Array.isArray(list)) throw new Error('法人候选响应必须是数组或包含data数组')
  return list.map((item, index) => {
    const row = objectOf(item, `法人候选[${index}]`)
    return { id: idOf(row.id, `法人候选[${index}].id`), name: textOf(row.name, `法人候选[${index}].name`) }
  })
}

export function createFinanceSettingReceivingAccountCapability (request: PortalRequest) {
  return {
    async list (query: FinanceSettingReceivingAccountQuery = {}): Promise<FinanceSettingReceivingAccountPage> {
      const filters = queryOf(query)
      const result = await request<unknown>({
        url: `${ROOT}/page`,
        method: 'get',
        params: {
          order: '',
          orderField: '',
          organizationId: filters.organizationId,
          corporationId: filters.corporationId,
          bank: filters.bank,
          bankAccount: filters.bankAccount,
          accountType: filters.accountType,
          tenantName: filters.tenantName,
          status: filters.status,
          pageNo: filters.pageNo,
          pageSize: filters.pageSize,
        },
      })
      return pageOf(result)
    },

    /** Supporting read used by the page to render corporationId as a name. */
    async corporationOptions (): Promise<FinanceSettingReceivingAccountCorporation[]> {
      return corporationListOf(await request<unknown>({ url: CORPORATION_OPTIONS_URL, method: 'get' }))
    },

    prepareCreate (input: FinanceSettingReceivingAccountCreateDraft): { draft: FinanceSettingReceivingAccountCreatePayload } {
      return { draft: createPayloadOf(input) }
    },

    async create (input: FinanceSettingReceivingAccountCreateDraft): Promise<FinanceSettingReceivingAccountId> {
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: createPayloadOf(input),
      })
      return idOf(result, '新建银行账户返回的id')
    },

    prepareSetStatus (input: { current: FinanceSettingReceivingAccountRow; targetStatus: FinanceSettingReceivingAccountStatus }): FinanceSettingReceivingAccountPreparedStatus {
      const current = statusPayloadOf(input?.current, '启停银行账户当前值')
      const targetStatus = statusOf(input?.targetStatus, 'targetStatus')
      if (current.status === targetStatus) throw new Error('targetStatus必须与列表当前status相反')
      return {
        draft: { id: current.id, status: targetStatus },
        previous: current,
      }
    },

    async setStatus (input: { draft: FinanceSettingReceivingAccountStatusPayload }): Promise<null> {
      const draft = statusPayloadOf(input?.draft, '银行账户启停输入')
      const result = await request<unknown>({
        url: `${ROOT}/enableOrStop`,
        method: 'get',
        params: draft,
      })
      if (result !== null) throw new Error('银行账户启停响应不是null')
      return null
    },
  }
}

export type FinanceSettingReceivingAccountCapability = ReturnType<typeof createFinanceSettingReceivingAccountCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const statusParam: ParamSpec = {
  name: 'status', kind: 'enum', required: false, description: '绝对状态：0启用，1停用；页面默认0',
  options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }],
}

const listParams: ParamSpec[] = [
  p('organizationId', 'text', false, '所属组织ID；页面默认空字符串'),
  p('corporationId', 'text', false, '所属法人库ID；页面默认空字符串'),
  p('bank', 'number', false, '所属银行字典值；页面默认空字符串'),
  p('bankAccount', 'text', false, '银行账号前缀；页面默认空字符串'),
  p('accountType', 'number', false, '账号类型字典值；页面默认空字符串'),
  p('tenantName', 'text', false, '企业名称前缀；页面仅admin用户显示此筛选项'),
  statusParam,
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '当前页条数；页面默认20'),
]

export const FINANCE_SETTING_RECEIVING_ACCOUNT_METHODS = {
  'finance-setting-receiving-account-list': 'list',
  'finance-setting-receiving-account-corporation-options': 'corporationOptions',
  'finance-setting-receiving-account-prepare-create': 'prepareCreate',
  'finance-setting-receiving-account-create': 'create',
  'finance-setting-receiving-account-prepare-set-status': 'prepareSetStatus',
  'finance-setting-receiving-account-set-status': 'setStatus',
} as const

const createParams: ParamSpec[] = [
  p('organizationId', 'text', true, '所属组织ID；来自Portal组织树，不能用组织名称代替'),
  p('corporationId', 'text', true, '所属法人库ID；来自Portal法人候选，不能用组织ID代替'),
  p('bank', 'number', true, 'belong_bank字典数值'),
  p('bankBranch', 'text', true, '开户行名称；最多200个字符'),
  p('accountType', 'number', true, 'receiving_account_type字典数值'),
  p('bankAccount', 'text', true, '收款银行账号；保持字符串，不能转数字'),
  p('accountBusiness', 'text', true, 'account_business字典数值数组；至少一项'),
  p('accountMinimum', 'number', false, '账号最小限额；空值表示未填写，最小0且最多两位小数'),
  { ...p('isUsed', 'enum', false, '限额是否可用；Portal默认1，取值0或1'), options: [{ label: '否', value: 0 }, { label: '是', value: 1 }] },
]

export const financeSettingReceivingAccountCapabilities: CapabilityDefinition[] = [
  { id: 'finance-setting-receiving-account-list', title: '查询银行账户', write: false, params: listParams },
  { id: 'finance-setting-receiving-account-corporation-options', title: '查询银行账户所属法人选项', write: false, params: [] },
  { id: 'finance-setting-receiving-account-prepare-create', title: '准备创建银行账户', write: false, params: createParams },
  { id: 'finance-setting-receiving-account-create', title: '创建银行账户', write: true, params: createParams },
  { id: 'finance-setting-receiving-account-prepare-set-status', title: '准备启停银行账户', write: false, params: [p('current', 'text', true, '来自最新列表的完整银行账户行'), { ...p('targetStatus', 'enum', true, '与当前状态相反的绝对目标状态'), options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }] }] },
  { id: 'finance-setting-receiving-account-set-status', title: '启停银行账户', write: true, params: [p('draft', 'text', true, 'prepareSetStatus返回的{ id, status }草稿')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_SETTING_RECEIVING_ACCOUNT_PAGE_PATH,
  permission: '/dashboard/finance/setting/receiving-account',
  moduleType: null,
  httpInstance: 'platform',
}))
