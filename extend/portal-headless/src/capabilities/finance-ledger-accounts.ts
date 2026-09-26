import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** 门户系统：财务设置 / 会计科目。静态锚点 frontend d3cf56bdc7、Java dcb3f360194。 */
export const FINANCE_LEDGER_ACCOUNTS_PAGE_PATH = '/dashboard/finance/setting/ledger-accounts/list'
const ROOT = '/admin-api/finance/ledger-accounts'
const ORGANIZATION_TREE_URL = '/admin-api/org/organization/getRoleOrganizationTreeNew'

export type FinanceLedgerAccountLong = string | number
export type FinanceLedgerAccountStatus = 0 | 1

export type FinanceLedgerAccountQuery = {
  name?: string
  subjectLevel?: number | ''
  accountingStandardsApply?: number | ''
  tenantName?: string
  organizationId?: FinanceLedgerAccountLong | ''
  code?: string
  status?: FinanceLedgerAccountStatus
  ledgerType?: number
}

export type FinanceLedgerAccountRow = {
  id: FinanceLedgerAccountLong
  tenantName: string | null
  name: string
  subjectLevel: number | null
  code: FinanceLedgerAccountLong
  type: number | null
  subjectFormat: number | null
  useSystemList: Array<string | number>
  parentId: FinanceLedgerAccountLong | null
  pid: FinanceLedgerAccountLong | null
  parentName: string | null
  ancillaryAccountings: string[]
  balanceDirection: number | null
  status: FinanceLedgerAccountStatus
  accountingStandardsApply: number | null
  createTime: string | number | null
  children: FinanceLedgerAccountRow[]
}

export type FinanceLedgerAccountDetail = Omit<FinanceLedgerAccountRow, 'tenantName' | 'subjectLevel' | 'status' | 'createTime' | 'children'>

export type FinanceLedgerAccountDraft = {
  name: string
  code: string
  type?: number
  subjectFormat?: number | ''
  useSystem?: number[]
  ancillaryAccountings?: string[]
  balanceDirection?: number
  accountingStandardsApply?: number
  pid?: FinanceLedgerAccountLong | ''
  parentName?: string
  parentCode?: string
}

export type FinanceLedgerAccountPayload = {
  organizationId: 34
  name: string
  accountingStandardsApply: number
  balanceDirection: number
  ancillaryAccountings: string[]
  pid: FinanceLedgerAccountLong | ''
  parentName: string
  type: number
  code: string
  subjectFormat: number | ''
  useSystem: string
}

export type FinanceLedgerAccountFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type FinanceLedgerAccountFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type FinanceLedgerAccountFile = FinanceLedgerAccountFilePreview & { base64: string }

export type FinanceLedgerOrganizationOption = {
  id: FinanceLedgerAccountLong
  name: string
  pid: FinanceLedgerAccountLong | null
  pathNames: string
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) throw new Error(`${label}必须是${allowEmpty ? '' : '非空'}字符串`)
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串或null`)
  return value
}

function positiveIntegerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label}必须为正整数`)
  return Number(value)
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  return Number(value)
}

function optionalIntegerOf (value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return Number(value)
}

function longOf (value: unknown, label: string): FinanceLedgerAccountLong {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  return value
}

function nullableLongOf (value: unknown, label: string): FinanceLedgerAccountLong | null {
  return value === null || value === undefined || value === '' ? null : longOf(value, label)
}

/** Portal 组织树与后端 TreeNode 都可能用 0 表示根；SDK 对外统一为 null。 */
function parentLongOf (value: unknown, label: string): FinanceLedgerAccountLong | null {
  return value === 0 || value === '0' ? null : nullableLongOf(value, label)
}

function statusOf (value: unknown): FinanceLedgerAccountStatus {
  if (value !== 0 && value !== 1) throw new Error('status只能是数值0（启用）或1（停用）')
  return value
}

function codeOf (value: unknown, label: string): string {
  const code = textOf(value, label)
  if (!/^\d+$/.test(code)) throw new Error(`${label}只能包含十进制数字`)
  if (BigInt(code) > 9_223_372_036_854_775_807n) throw new Error(`${label}超出Java Long范围`)
  return code
}

function numberListOf (value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数值数组`)
  return value.map((item, index) => integerOf(item, `${label}[${index}]`))
}

function textListOf (value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是字符串数组`)
  return value.map((item, index) => textOf(item, `${label}[${index}]`))
}

function rowOf (value: unknown): FinanceLedgerAccountRow {
  const row = objectOf(value, '会计科目树节点')
  const children = row.children === undefined || row.children === null ? [] : row.children
  if (!Array.isArray(children)) throw new Error('会计科目树节点children必须为数组')
  const useSystemList = row.useSystemList === undefined || row.useSystemList === null ? [] : row.useSystemList
  if (!Array.isArray(useSystemList) || useSystemList.some(item => typeof item !== 'string' && !Number.isSafeInteger(item))) {
    throw new Error('会计科目树节点useSystemList必须为字符串或整数数组')
  }
  const ancillaryAccountings = row.ancillaryAccountings === undefined || row.ancillaryAccountings === null ? [] : row.ancillaryAccountings
  const code = longOf(row.code, '会计科目编码')
  return {
    id: longOf(row.id, '会计科目ID'),
    tenantName: nullableTextOf(row.tenantName, 'tenantName'),
    name: textOf(row.name, '会计科目名称'),
    subjectLevel: optionalIntegerOf(row.subjectLevel, 'subjectLevel'),
    code,
    type: optionalIntegerOf(row.type, 'type'),
    subjectFormat: optionalIntegerOf(row.subjectFormat, 'subjectFormat'),
    useSystemList: [...useSystemList] as Array<string | number>,
    parentId: parentLongOf(row.parentId ?? row.pid, 'parentId'),
    pid: parentLongOf(row.pid ?? row.parentId, 'pid'),
    parentName: nullableTextOf(row.parentName, 'parentName'),
    ancillaryAccountings: textListOf(ancillaryAccountings, 'ancillaryAccountings'),
    balanceDirection: optionalIntegerOf(row.balanceDirection, 'balanceDirection'),
    status: statusOf(row.status),
    accountingStandardsApply: optionalIntegerOf(row.accountingStandardsApply, 'accountingStandardsApply'),
    createTime: row.createTime == null
      ? null
      : typeof row.createTime === 'string' || (typeof row.createTime === 'number' && Number.isFinite(row.createTime))
        ? row.createTime
        : (() => { throw new Error('createTime必须为字符串、有限数值或null') })(),
    children: children.map(rowOf),
  }
}

function detailOf (value: unknown): FinanceLedgerAccountDetail {
  const row = objectOf(value, '会计科目详情快照')
  const normalized = rowOf({
    ...row,
    tenantName: null,
    subjectLevel: null,
    status: 0,
    createTime: null,
    children: [],
  })
  const { tenantName: _tenantName, subjectLevel: _subjectLevel, status: _status, createTime: _createTime, children: _children, ...detail } = normalized
  return detail
}

function filterTextOf (value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function subjectLevelOf (value: unknown): number | '' {
  if (value === undefined || value === '') return ''
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error('subjectLevel必须为非负整数或空字符串')
  return Number(value)
}

function optionalFilterIntegerOf (value: unknown, label: string): number | '' {
  if (value === undefined || value === '') return ''
  return integerOf(value, label)
}

function queryParamsOf (query: FinanceLedgerAccountQuery): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    name: filterTextOf(query.name, 'name'),
    accountingStandardsApply: optionalFilterIntegerOf(query.accountingStandardsApply, 'accountingStandardsApply'),
    organizationId: query.organizationId === undefined || query.organizationId === '' ? '' : longOf(query.organizationId, 'organizationId'),
    tenantName: filterTextOf(query.tenantName, 'tenantName'),
    ledgerType: integerOf(query.ledgerType ?? 1, 'ledgerType'),
    subjectLevel: subjectLevelOf(query.subjectLevel),
    type: '',
    code: filterTextOf(query.code, 'code'),
    status: statusOf(query.status ?? 0),
  }
}

export function buildFinanceLedgerAccountPayload (draft: FinanceLedgerAccountDraft): FinanceLedgerAccountPayload {
  const name = textOf(draft?.name, 'name').trim()
  const suffix = codeOf(draft?.code, 'code')
  const parentCode = draft.parentCode === undefined || draft.parentCode === '' ? '' : codeOf(draft.parentCode, 'parentCode')
  const pid = draft.pid === undefined || draft.pid === '' ? '' : longOf(draft.pid, 'pid')
  if ((pid === '') !== (parentCode === '')) throw new Error('添加下级时pid与parentCode必须同时提供；创建顶级科目时都省略')
  const parentName = draft.parentName === undefined ? '' : textOf(draft.parentName, 'parentName', true)
  if (pid !== '' && parentName.trim() === '') throw new Error('添加下级时必须提供列表行parentName供核对')
  const balanceDirection = integerOf(draft.balanceDirection ?? 1, 'balanceDirection')
  return {
    organizationId: 34,
    name,
    accountingStandardsApply: integerOf(draft.accountingStandardsApply ?? 1, 'accountingStandardsApply'),
    balanceDirection,
    ancillaryAccountings: textListOf(draft.ancillaryAccountings ?? [], 'ancillaryAccountings'),
    pid,
    parentName,
    type: integerOf(draft.type ?? 1, 'type'),
    code: codeOf(`${parentCode}${suffix}`, '完整code'),
    subjectFormat: draft.subjectFormat === undefined || draft.subjectFormat === '' ? '' : integerOf(draft.subjectFormat, 'subjectFormat'),
    useSystem: numberListOf(draft.useSystem ?? [], 'useSystem').join(','),
  }
}

function decodeFile (input: FinanceLedgerAccountFileInput): { preview: FinanceLedgerAccountFilePreview; bytes: Uint8Array } {
  const fileName = textOf(input?.fileName, 'fileName').trim()
  if (!/\.(xml|xlsx|xls)$/i.test(fileName)) throw new Error('fileName扩展名必须是.xml、.xlsx或.xls')
  const base64 = textOf(input?.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('base64不是合法的标准Base64')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  const contentType = input.contentType === undefined || input.contentType === ''
    ? fileName.toLowerCase().endsWith('.xml')
      ? 'application/xml'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : textOf(input.contentType, 'contentType')
  return { preview: { fileName, contentType, byteLength: bytes.byteLength }, bytes }
}

function bytesOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('会计科目下载响应不是二进制文件')
}

function contentTypeOf (response: AxiosResponse): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return typeof value === 'string' && value ? value : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fileName: string): FinanceLedgerAccountFile {
  const bytes = bytesOf(response?.data)
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('会计科目下载响应不是有效的xlsx压缩包')
  }
  return {
    fileName,
    contentType: contentTypeOf(response),
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function organizationOptionsOf (roots: unknown, keyword: string, limit: number): FinanceLedgerOrganizationOption[] {
  if (!Array.isArray(roots)) throw new Error('组织候选响应必须为树数组')
  const result: FinanceLedgerOrganizationOption[] = []
  const walk = (nodes: unknown[], parents: string[]) => {
    for (const value of nodes) {
      const node = objectOf(value, '组织树节点')
      const name = textOf(node.name, '组织名称')
      const nextParents = [...parents, name]
      if (name.includes(keyword) && result.length < limit) {
        result.push({
          id: longOf(node.id, '组织ID'),
          name,
          pid: parentLongOf(node.pid ?? node.parentId, '组织pid'),
          pathNames: nextParents.join('/'),
        })
      }
      if (node.children !== undefined && node.children !== null) {
        if (!Array.isArray(node.children)) throw new Error('组织树节点children必须为数组')
        walk(node.children, nextParents)
      }
    }
  }
  walk(roots, [])
  return result
}

export function createFinanceLedgerAccountsCapability (request: PortalRequest) {
  return {
    async searchOrganizations (input: { keyword: string; limit?: number }): Promise<{ list: FinanceLedgerOrganizationOption[] }> {
      const keyword = textOf(input?.keyword, 'keyword').trim()
      const limit = input.limit === undefined ? 20 : positiveIntegerOf(input.limit, 'limit')
      if (limit > 50) throw new Error('limit不能超过50')
      const tree = await request<unknown>({
        url: ORGANIZATION_TREE_URL,
        method: 'get',
        params: { excludePost: false },
      })
      return { list: organizationOptionsOf(tree, keyword, limit) }
    },

    async list (query: FinanceLedgerAccountQuery = {}): Promise<FinanceLedgerAccountRow[]> {
      const result = await request<unknown>({ url: `${ROOT}/page`, method: 'get', params: queryParamsOf(query) })
      if (!Array.isArray(result)) throw new Error('会计科目列表响应必须为树数组')
      return result.map(rowOf)
    },

    detail (input: FinanceLedgerAccountDetail): FinanceLedgerAccountDetail {
      return detailOf(input)
    },

    prepareCreate (draft: FinanceLedgerAccountDraft): { draft: FinanceLedgerAccountPayload } {
      return { draft: buildFinanceLedgerAccountPayload(draft) }
    },

    async create (draft: FinanceLedgerAccountDraft): Promise<FinanceLedgerAccountLong> {
      return longOf(await request({ url: `${ROOT}/create`, method: 'post', data: buildFinanceLedgerAccountPayload(draft) }), '新建会计科目ID')
    },

    async setStatus (input: { id: FinanceLedgerAccountLong; status: FinanceLedgerAccountStatus }): Promise<null> {
      return request({
        url: `${ROOT}/enableOrStop`,
        method: 'get',
        params: { id: longOf(input?.id, 'id'), status: statusOf(input?.status) },
      })
    },

    async export (query: FinanceLedgerAccountQuery = {}): Promise<FinanceLedgerAccountFile> {
      const params = queryParamsOf(query)
      delete params.order
      delete params.orderField
      const response = await request<AxiosResponse<ArrayBuffer>>({
        url: `${ROOT}/export-excel`, method: 'get', params, responseType: 'arraybuffer',
      })
      return downloadedFileOf(response, '会计科目.xlsx')
    },

    async downloadTemplate (): Promise<FinanceLedgerAccountFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({
        url: `${ROOT}/down-excel`, method: 'get', responseType: 'arraybuffer',
      })
      return downloadedFileOf(response, '会计科目模板.xlsx')
    },

    prepareImport (input: FinanceLedgerAccountFileInput): FinanceLedgerAccountFilePreview {
      return decodeFile(input).preview
    },

    async importFile (input: FinanceLedgerAccountFileInput): Promise<true> {
      const { preview, bytes } = decodeFile(input)
      const data = new FormData()
      const fileBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([fileBuffer], { type: preview.contentType }), preview.fileName)
      const result = await request({
        url: `${ROOT}/import-excel`,
        method: 'post',
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (result !== true) throw new Error('会计科目导入响应不是true')
      return true
    },
  }
}

export type FinanceLedgerAccountsCapability = ReturnType<typeof createFinanceLedgerAccountsCapability>
export type FinanceLedgerAccountsCapabilityWithIdempotency = FinanceLedgerAccountsCapability & {
  createIdempotent: (input: FinanceLedgerAccountDraft & { requestId: string }) => Promise<FinanceLedgerAccountLong>
  importIdempotent: (input: FinanceLedgerAccountFileInput & { requestId: string }) => Promise<true>
}

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [
  p('name', 'text', false, '科目名称包含筛选'),
  p('subjectLevel', 'number', false, '科目等级，非负整数'),
  p('accountingStandardsApply', 'enum', false, '适用会计准则字典value'),
  p('tenantName', 'text', false, '企业名称；PC仅admin显示'),
  { ...p('organizationId', 'search', false, '组织ID'), lookup: { capabilityId: 'finance-ledger-account-organization-search', keywordParam: 'keyword' } },
  p('code', 'text', false, '科目编码包含筛选'),
  { ...p('status', 'enum', false, '0启用、1停用；默认0'), options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }] },
  p('ledgerType', 'enum', false, '科目类型页签的account_type字典value；默认1'),
]
const createParams: ParamSpec[] = [
  p('name', 'text', true, '科目名称'), p('code', 'text', true, '顶级完整编码或下级编码后缀'),
  p('type', 'enum', false, 'account_type字典value，页面默认1'), p('subjectFormat', 'enum', false, 'subject_format字典value'),
  p('useSystem', 'enum', false, 'system_tenant_apply_use_system字典value数组'),
  p('ancillaryAccountings', 'enum', false, 'ancillary_accounting字典value数组'),
  p('balanceDirection', 'enum', false, 'balance_direction字典value；页面默认1'),
  p('accountingStandardsApply', 'enum', false, 'accounting_standards_apply字典value；页面默认1'),
  p('pid', 'text', false, '上级会计科目ID；添加下级时必填'), p('parentName', 'text', false, '上级科目名称；添加下级时核对'),
  p('parentCode', 'text', false, '上级科目编码；添加下级时与code后缀拼接'),
]
const fileParams: ParamSpec[] = [p('fileName', 'text', true), p('base64', 'text', true), p('contentType', 'text', false)]

export const FINANCE_LEDGER_ACCOUNTS_METHODS = {
  'finance-ledger-account-organization-search': 'searchOrganizations',
  'finance-ledger-account-list': 'list',
  'finance-ledger-account-detail': 'detail',
  'finance-ledger-account-prepare-create': 'prepareCreate',
  'finance-ledger-account-create': 'createIdempotent',
  'finance-ledger-account-set-status': 'setStatus',
  'finance-ledger-account-export': 'export',
  'finance-ledger-account-download-template': 'downloadTemplate',
  'finance-ledger-account-prepare-import': 'prepareImport',
  'finance-ledger-account-import': 'importIdempotent',
} as const

export const financeLedgerAccountsCapabilities: CapabilityDefinition[] = [
  { id: 'finance-ledger-account-organization-search', title: '搜索会计科目组织筛选候选', write: false, params: [p('keyword', 'text', true), p('limit', 'number')] },
  { id: 'finance-ledger-account-list', title: '查询会计科目树', write: false, params: queryParams },
  { id: 'finance-ledger-account-detail', title: '查看会计科目详情', write: false, params: [
    p('id', 'text', true), p('name', 'text', true), p('code', 'text', true), p('type', 'number'), p('subjectFormat', 'number'),
    p('useSystemList', 'text'), p('parentId', 'text'), p('pid', 'text'), p('parentName', 'text'), p('ancillaryAccountings', 'text'),
    p('balanceDirection', 'number'), p('accountingStandardsApply', 'number'),
  ] },
  { id: 'finance-ledger-account-prepare-create', title: '生成会计科目创建草稿', write: false, params: createParams },
  { id: 'finance-ledger-account-create', title: '创建会计科目或添加下级', write: true, params: [...createParams, p('requestId', 'text', true, 'SDK本地防重键')] },
  { id: 'finance-ledger-account-set-status', title: '启用或停用会计科目', write: true, params: [p('id', 'text', true), { ...p('status', 'enum', true), options: [{ label: '启用', value: 0 }, { label: '停用', value: 1 }] }] },
  { id: 'finance-ledger-account-export', title: '导出会计科目', write: false, params: queryParams },
  { id: 'finance-ledger-account-download-template', title: '下载会计科目导入模板', write: false, params: [] },
  { id: 'finance-ledger-account-prepare-import', title: '校验会计科目导入文件', write: false, params: fileParams },
  { id: 'finance-ledger-account-import', title: '导入会计科目', write: true, params: [...fileParams, p('requestId', 'text', true, 'SDK本地防重键')] },
].map(definition => ({
  ...definition,
  pagePath: FINANCE_LEDGER_ACCOUNTS_PAGE_PATH,
  permission: '/dashboard/finance/setting/ledger-accounts',
  httpInstance: 'platform' as const,
}))
