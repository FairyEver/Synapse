import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「系统设置 → 合同编码规则」唯一可达的规则表单页面。 */
export const CONTRACT_CODE_RULE_PAGE_PATH = '/dashboard/contract/code-rule/list'
export const CONTRACT_CODE_RULE_PERMISSION = '/dashboard/contract/code-rule'
export const CONTRACT_CODE_RULE_MODULE_TYPE = 15

const ROOT = '/hr/contract-code-rule'
const DATE_STYLES = [1, 2, 3] as const
const SERIAL_LENGTHS = [4, 6, 8] as const

export type ContractCodeRuleId = string | number
export type ContractCodeRuleDateStyle = typeof DATE_STYLES[number]
export type ContractCodeRuleSerialLength = typeof SERIAL_LENGTHS[number]

export type ContractCodeRule = Record<string, unknown> & {
  id: ContractCodeRuleId
  fixedPrefix: string | null
  dateStyle: number | null
  serialLength: number | null
  description: string | null
  createTime?: string | number | null
}

export type ContractCodeRuleDraft = {
  id: ContractCodeRuleId | null
  fixedPrefix: string
  dateStyle: ContractCodeRuleDateStyle
  serialLength: ContractCodeRuleSerialLength
  description: string | null
}

export type ContractCodeRulePreviewInput = {
  draft: ContractCodeRuleDraft | Record<string, unknown>
  /** 仅用于复现页面日期格式；省略时使用当前本地日期。 */
  date?: Date | string
  /** 仅用于可重复测试/展示；省略时按页面规则随机生成大写数字字母流水号。 */
  serial?: string
}

export type ContractCodeRuleCapability = {
  get: () => Promise<ContractCodeRule | null>
  prepareCreate: (input: Record<string, unknown>) => ContractCodeRuleDraft
  create: (input: { draft: ContractCodeRuleDraft }) => Promise<ContractCodeRuleId>
  prepareUpdate: (input: { draft: Record<string, unknown> }) => ContractCodeRuleDraft
  update: (input: { draft: ContractCodeRuleDraft }) => Promise<true>
  preview: (input: ContractCodeRulePreviewInput) => string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): ContractCodeRuleId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error(`${label}必须为正整数ID`)
}

function requiredPrefixOf (value: unknown, label = 'fixedPrefix'): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  if (value.length > 6) throw new Error(`${label}最多6个字符`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function enumOf<T extends number> (value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`${label}必须是${values.join('/')}之一`)
  return value as T
}

function draftOf (value: unknown, mode: 'create' | 'update'): ContractCodeRuleDraft {
  const input = objectOf(value, mode === 'create' ? '合同编码规则创建表单' : '合同编码规则更新表单')
  const id = mode === 'create' ? null : idOf(input.id, '合同编码规则ID')
  return {
    id,
    fixedPrefix: requiredPrefixOf(input.fixedPrefix),
    dateStyle: enumOf(input.dateStyle, DATE_STYLES, 'dateStyle'),
    serialLength: enumOf(input.serialLength, SERIAL_LENGTHS, 'serialLength'),
    description: nullableTextOf(input.description, 'description'),
  }
}

function ruleOf (value: unknown): ContractCodeRule | null {
  if (value === null || value === undefined) return null
  const row = objectOf(value, '合同编码规则响应')
  return {
    ...row,
    id: idOf(row.id, '合同编码规则响应.id'),
    fixedPrefix: nullableTextOf(row.fixedPrefix, '合同编码规则响应.fixedPrefix'),
    dateStyle: row.dateStyle === undefined || row.dateStyle === null ? null : enumOf(row.dateStyle, DATE_STYLES, '合同编码规则响应.dateStyle'),
    serialLength: row.serialLength === undefined || row.serialLength === null ? null : enumOf(row.serialLength, SERIAL_LENGTHS, '合同编码规则响应.serialLength'),
    description: nullableTextOf(row.description, '合同编码规则响应.description'),
  }
}

function dateOf (value: Date | string | undefined): Date {
  if (value === undefined) return new Date()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  throw new Error('preview.date必须是有效日期')
}

function serialOf (value: string | undefined, length: number): string {
  if (value !== undefined) {
    if (!new RegExp(`^[0-9A-Z]{${length}}$`).test(value)) throw new Error(`preview.serial必须是${length}位数字或大写字母`)
    return value
  }
  const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('')
}

function previewOf (input: ContractCodeRulePreviewInput): string {
  const draft = draftOf(input?.draft, input?.draft?.id === undefined || input?.draft?.id === null || input?.draft?.id === '' ? 'create' : 'update')
  const date = dateOf(input.date)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const dateText = draft.dateStyle === 1 ? year : draft.dateStyle === 2 ? `${year}${month}` : `${year}${month}${day}`
  return `${draft.fixedPrefix}${dateText}${serialOf(input.serial, draft.serialLength)}`
}

/** The injected request must be bound to CONTRACT_CODE_RULE_PAGE_PATH. */
export function createContractCodeRuleCapability (request: PortalRequest): ContractCodeRuleCapability {
  return {
    async get () {
      return ruleOf(await request({ url: `${ROOT}/getContractCodeRule`, method: 'get' }))
    },
    prepareCreate (input) {
      return draftOf(input, 'create')
    },
    async create ({ draft }) {
      const payload = draftOf(draft, 'create')
      const id = await request<unknown>({ url: `${ROOT}/create`, method: 'post', data: payload })
      return idOf(id, '合同编码规则创建响应')
    },
    prepareUpdate ({ draft }) {
      return draftOf(draft, 'update')
    },
    async update ({ draft }) {
      const payload = draftOf(draft, 'update')
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: payload })
      if (result !== true) throw new Error('合同编码规则更新响应不是true')
      return true
    },
    preview: previewOf,
  }
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })
const draftParams = [
  p('fixedPrefix', 'text', true, '固定前缀；页面必填，最多6个字符'),
  p('dateStyle', 'enum', true, '日期格式：1=年、2=年-月、3=年-月-日'),
  p('serialLength', 'enum', true, '流水号长度：4、6或8'),
  p('description', 'text', false, '规则描述；可为空，按页面原值保存'),
]
const draftParam = p('draft', 'text', true, 'prepareCreate或prepareUpdate返回的完整合同编码规则草稿；确认后原样提交')

export const CONTRACT_CODE_RULE_METHODS = {
  'contract-code-rule-get': 'get',
  'contract-code-rule-prepare-create': 'prepareCreate',
  'contract-code-rule-create': 'create',
  'contract-code-rule-prepare-update': 'prepareUpdate',
  'contract-code-rule-update': 'update',
  'contract-code-rule-preview': 'preview',
} as const

export const contractCodeRuleCapabilities: CapabilityDefinition[] = [
  { id: 'contract-code-rule-get', title: '读取合同编码规则', write: false, params: [] },
  { id: 'contract-code-rule-prepare-create', title: '准备创建合同编码规则', write: false, params: draftParams },
  { id: 'contract-code-rule-create', title: '创建合同编码规则', write: true, params: [draftParam] },
  { id: 'contract-code-rule-prepare-update', title: '准备更新合同编码规则', write: false, params: [draftParam] },
  { id: 'contract-code-rule-update', title: '更新合同编码规则', write: true, params: [draftParam] },
  { id: 'contract-code-rule-preview', title: '预览合同编码规则', write: false, params: [
    draftParam,
    p('date', 'date', false, '预览日期；省略使用当前本地日期'),
    p('serial', 'text', false, '可选的固定流水号；省略时随机生成，仅用于复现页面预览'),
  ] },
].map(definition => ({
  ...definition,
  pagePath: CONTRACT_CODE_RULE_PAGE_PATH,
  permission: CONTRACT_CODE_RULE_PERMISSION,
  moduleType: CONTRACT_CODE_RULE_MODULE_TYPE,
  httpInstance: 'platform',
}))
