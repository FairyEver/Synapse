import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「公积金 → 公积金办理」；固定分支实测锚点 Portal acab69acc7、Java 0f1a55718e。 */
export const FUND_SALARY_FUND_PROCESS_PAGE_PATH = '/dashboard/fund/process/list'
export const FUND_SALARY_FUND_PROCESS_PERMISSION = '/dashboard/fund/process'
export const FUND_SALARY_FUND_PROCESS_MODULE_TYPE = 14
const ROOT = '/salary/salaryfund'
const AREA_TREE_URL = '/system/area/getTree'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type FundSalaryFundProcessId = string | number
export type FundSalaryFundProcessQuery = {
  name?: string | null
  orgIds?: FundSalaryFundProcessId[] | string | null
  staffStatus?: number | null
  insuranceStatus?: number | null
  entryTime?: [string | null, string | null] | string[] | null
  businessDate?: string
  pageNo?: number
  pageSize?: number
}

export type FundSalaryFundProcessRow = {
  id?: FundSalaryFundProcessId | null
  staffCode: FundSalaryFundProcessId
  name: string | null
  organizationPath: string | null
  postName: string | null
  idCard: string | null
  householdType: number | null
  employmentType: number | null
  entryTime: string | null
  depositUnitName: string | null
  depositUnitId: FundSalaryFundProcessId | null
  costCenterName: string | null
  costCenterId: FundSalaryFundProcessId | null
  insuredArea: string | null
  insuranceStatus: number | null
  insuranceStartDate: string | null
  insuranceStopDate: string | null
  companyBase: number | string | null
  individualBase: number | string | null
  companyRatio: number | string | null
  individualRatio: number | string | null
  reductionReason: string | null
  [key: string]: unknown
}

export type FundSalaryFundProcessAssignment = {
  staffCode: FundSalaryFundProcessId
  depositUnitId?: FundSalaryFundProcessId
  costCenterId?: FundSalaryFundProcessId
}

export type FundSalaryFundProcessEligibilityResult = {
  processedIds: FundSalaryFundProcessId[]
  processedStaffCodes: FundSalaryFundProcessId[]
  processedCount: number
  eligibleStaffIds: FundSalaryFundProcessId[]
  eligibleStaffCodes: FundSalaryFundProcessId[]
  excludedStaffList: JsonObject[]
}

export type FundSalaryFundProcessFile = {
  fileName: '公积金办理.xlsx'
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): FundSalaryFundProcessId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

function optionalIdOf (value: unknown, label: string): FundSalaryFundProcessId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isSafeInteger(number)) throw new Error(`${label}必须为安全整数或null`)
  return number
}

function dateOf (value: unknown, label: string, nullable = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD或完整日期时间`)
  return value
}

function idsOf (value: unknown, label: string): FundSalaryFundProcessId[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : []
  if (values.length === 0) throw new Error(`${label}不能为空`)
  const ids = values.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function commaIdsOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : null
  if (!values) throw new Error('orgIds必须是ID数组、逗号分隔字符串或空值')
  return values.length === 0 ? '' : idsOf(values, 'orgIds').join(',')
}

function today (): string {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayRangeOf (value: unknown, label: string): { start: string; end: string } {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return { start: '', end: '' }
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是两个日期的数组`)
  const start = dateOf(value[0], `${label}[0]`, false)!.slice(0, 10)
  const end = dateOf(value[1], `${label}[1]`, false)!.slice(0, 10)
  const next = new Date(`${end}T00:00:00`)
  next.setDate(next.getDate() + 1)
  const endExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
  return { start, end: endExclusive }
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function queryOf (query: FundSalaryFundProcessQuery = {}): Record<string, unknown> {
  const range = dayRangeOf(query.entryTime, 'entryTime')
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  if (query.staffStatus !== undefined && query.staffStatus !== null && !Number.isSafeInteger(query.staffStatus)) throw new Error('staffStatus必须为整数或null')
  if (query.insuranceStatus !== undefined && query.insuranceStatus !== null && !Number.isSafeInteger(query.insuranceStatus)) throw new Error('insuranceStatus必须为整数或null')
  const businessDate = query.businessDate ?? today()
  dateOf(businessDate, 'businessDate', false)
  return {
    order: '', orderField: '',
    name: query.name ?? '',
    orgIds: commaIdsOf(query.orgIds),
    staffStatus: query.staffStatus ?? null,
    insuranceStatus: query.insuranceStatus ?? null,
    businessDate,
    entryTimeStart: range.start,
    entryTimeEnd: range.end,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function exportQueryOf (query: FundSalaryFundProcessQuery = {}): Record<string, unknown> {
  const range = dayRangeOf(query.entryTime, 'entryTime')
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  if (query.staffStatus !== undefined && query.staffStatus !== null && !Number.isSafeInteger(query.staffStatus)) throw new Error('staffStatus必须为整数或null')
  if (query.insuranceStatus !== undefined && query.insuranceStatus !== null && !Number.isSafeInteger(query.insuranceStatus)) throw new Error('insuranceStatus必须为整数或null')
  const businessDate = query.businessDate ?? today()
  dateOf(businessDate, 'businessDate', false)
  return {
    name: query.name ?? '',
    orgIds: commaIdsOf(query.orgIds),
    staffStatus: query.staffStatus ?? null,
    insuranceStatus: query.insuranceStatus ?? null,
    businessDate,
    entryTimeStart: range.start || null,
    entryTimeEnd: range.end || null,
    limit: pageNumberOf(query.pageSize, 20, 'pageSize'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
  }
}

function rowOf (value: unknown): FundSalaryFundProcessRow {
  const row = objectOf(value, '公积金办理列表行')
  return {
    ...row,
    id: optionalIdOf(row.id, '公积金办理id'),
    staffCode: idOf(row.staffCode, '公积金办理staffCode'),
    name: textOf(row.name, 'name'), organizationPath: textOf(row.organizationPath, 'organizationPath'), postName: textOf(row.postName, 'postName'), idCard: textOf(row.idCard, 'idCard'),
    householdType: integerOf(row.householdType, 'householdType'), employmentType: integerOf(row.employmentType, 'employmentType'),
    entryTime: dateOf(row.entryTime, 'entryTime'), depositUnitName: textOf(row.depositUnitName, 'depositUnitName'), depositUnitId: optionalIdOf(row.depositUnitId, 'depositUnitId'), costCenterName: textOf(row.costCenterName, 'costCenterName'), costCenterId: optionalIdOf(row.costCenterId, 'costCenterId'), insuredArea: textOf(row.insuredArea, 'insuredArea'), insuranceStatus: integerOf(row.insuranceStatus, 'insuranceStatus'), insuranceStartDate: dateOf(row.insuranceStartDate, 'insuranceStartDate'), insuranceStopDate: dateOf(row.insuranceStopDate, 'insuranceStopDate'),
    companyBase: row.companyBase === undefined || row.companyBase === null ? null : (typeof row.companyBase === 'number' || typeof row.companyBase === 'string' ? row.companyBase : (() => { throw new Error('companyBase必须为数字、字符串或null') })()), individualBase: row.individualBase === undefined || row.individualBase === null ? null : (typeof row.individualBase === 'number' || typeof row.individualBase === 'string' ? row.individualBase : (() => { throw new Error('individualBase必须为数字、字符串或null') })()), companyRatio: row.companyRatio === undefined || row.companyRatio === null ? null : (typeof row.companyRatio === 'number' || typeof row.companyRatio === 'string' ? row.companyRatio : (() => { throw new Error('companyRatio必须为数字、字符串或null') })()), individualRatio: row.individualRatio === undefined || row.individualRatio === null ? null : (typeof row.individualRatio === 'number' || typeof row.individualRatio === 'string' ? row.individualRatio : (() => { throw new Error('individualRatio必须为数字、字符串或null') })()), reductionReason: textOf(row.reductionReason, 'reductionReason'),
  }
}

function requiredActionTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (!text || !text.trim()) throw new Error(`${label}不能为空`)
  return text
}

function actionRowsOf (value: unknown, action: 'insure' | 'terminate'): FundSalaryFundProcessRow[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${action}行不能为空`)
  return value.map((item, index) => {
    const row = objectOf(item, `${action}行[${index}]`)
    const staffCode = idOf(row.staffCode, `${action}行[${index}].staffCode`)
    const status = integerOf(row.insuranceStatus, `${action}行[${index}].insuranceStatus`)
    if (status !== null && ((action === 'insure' && status === 2) || (action === 'terminate' && status !== 2))) throw new Error(`${action}行[${index}]的insuranceStatus与Portal操作条件不符`)
    if (action === 'insure') {
      const insuredArea = requiredActionTextOf(row.insuredArea, `${action}行[${index}].insuredArea`)
      const depositUnitId = idOf(row.depositUnitId, `${action}行[${index}].depositUnitId`)
      const costCenterId = idOf(row.costCenterId, `${action}行[${index}].costCenterId`)
      if (!row.companyFee) throw new Error(`${action}行[${index}].companyFee不能为空`)
      if (!row.individualFee) throw new Error(`${action}行[${index}].individualFee不能为空`)
      return {
        ...row,
        staffCode,
        insuredArea,
        depositUnitId,
        costCenterId,
        insuranceStartDate: dateOf(row.insuranceStartDate, `${action}行[${index}].insuranceStartDate`),
      } as FundSalaryFundProcessRow
    }
    return {
      ...row,
      staffCode,
      insuranceStopDate: dateOf(row.insuranceStopDate, `${action}行[${index}].insuranceStopDate`, false),
      reductionReason: requiredActionTextOf(row.reductionReason, `${action}行[${index}].reductionReason`),
    } as FundSalaryFundProcessRow
  })
}

function insurePayloadOf (value: unknown): JsonObject[] {
  return actionRowsOf(value, 'insure').map(({ insuranceStartDate, ...rest }) => ({
    ...rest,
    insuranceStartDate: insuranceStartDate ? insuranceStartDate.slice(0, 10) : null,
  }))
}

function terminatePayloadOf (value: unknown): JsonObject[] {
  return actionRowsOf(value, 'terminate').map(row => ({
    ...row,
    insuranceStopDate: row.insuranceStopDate!.slice(0, 10),
  }))
}

function eligibilityResultOf (value: unknown): FundSalaryFundProcessEligibilityResult {
  const result = objectOf(value, '公积金资格结果')
  const array = (name: string): unknown[] => {
    if (!Array.isArray(result[name])) throw new Error(`公积金资格结果.${name}必须为数组`)
    return result[name] as unknown[]
  }
  const ids = (name: string): FundSalaryFundProcessId[] => array(name).map((item, index) => idOf(item, `公积金资格结果.${name}[${index}]`))
  const processedCount = result.processedCount
  if (typeof processedCount !== 'number' || !Number.isSafeInteger(processedCount) || processedCount < 0) throw new Error('公积金资格结果.processedCount无效')
  return {
    processedIds: ids('processedIds'),
    processedStaffCodes: ids('processedStaffCodes'),
    processedCount,
    eligibleStaffIds: ids('eligibleStaffIds'),
    eligibleStaffCodes: ids('eligibleStaffCodes'),
    excludedStaffList: array('excludedStaffList').map((item, index) => objectOf(item, `公积金资格结果.excludedStaffList[${index}]`)),
  }
}

function assignmentOf (input: unknown, field: 'depositUnitId' | 'costCenterId'): FundSalaryFundProcessAssignment[] {
  const value = objectOf(input, '公积金办理调整输入')
  const staffCodes = idsOf(value.staffCodes, 'staffCodes')
  const target = idOf(value[field], field)
  return staffCodes.map(staffCode => ({ staffCode, [field]: target }))
}

function bytesOf (response: AxiosResponse<ArrayBuffer>): FundSalaryFundProcessFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('公积金办理导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return { fileName: '公积金办理.xlsx', contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

function treeOf (value: unknown, label: string): JsonObject {
  const node = objectOf(value, label)
  return { ...node, id: idOf(node.id, `${label}.id`), name: typeof node.name === 'string' ? node.name : '', children: Array.isArray(node.children) ? node.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [] }
}

export function createFundSalaryFundProcessCapability (request: PortalRequest) {
  return {
    async list (query: FundSalaryFundProcessQuery = {}): Promise<PageResult<FundSalaryFundProcessRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('公积金办理分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('公积金办理组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `组织树[${index}]`))
    },
    async areaTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: AREA_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('公积金办理地区树响应必须是数组')
      return result.map((item, index) => treeOf(item, `地区树[${index}]`))
    },
    prepareInsure (input: { rows: FundSalaryFundProcessRow[] }) { return { draft: insurePayloadOf(input?.rows) } },
    async insure (input: { draft: JsonObject[] }): Promise<FundSalaryFundProcessEligibilityResult> {
      return eligibilityResultOf(await request({ url: `${ROOT}/insure`, method: 'post', data: insurePayloadOf(input?.draft) }))
    },
    cancelInsure (): { cancelled: true } { return { cancelled: true } },
    prepareTerminate (input: { rows: FundSalaryFundProcessRow[] }) { return { draft: terminatePayloadOf(input?.rows) } },
    async terminate (input: { draft: JsonObject[] }): Promise<void> {
      await request({ url: `${ROOT}/terminate`, method: 'put', data: terminatePayloadOf(input?.draft) })
    },
    cancelTerminate (): { cancelled: true } { return { cancelled: true } },
    prepareUpdateDepositUnit (input: { staffCodes: FundSalaryFundProcessId[]; depositUnitId: FundSalaryFundProcessId }) { return { draft: assignmentOf(input, 'depositUnitId') } },
    async updateDepositUnit (input: { staffCodes: FundSalaryFundProcessId[]; depositUnitId: FundSalaryFundProcessId }): Promise<void> { await request({ url: `${ROOT}/updateDepositUnit`, method: 'put', data: assignmentOf(input, 'depositUnitId') }) },
    prepareUpdateCostCenter (input: { staffCodes: FundSalaryFundProcessId[]; costCenterId: FundSalaryFundProcessId }) { return { draft: assignmentOf(input, 'costCenterId') } },
    async updateCostCenter (input: { staffCodes: FundSalaryFundProcessId[]; costCenterId: FundSalaryFundProcessId }): Promise<void> { await request({ url: `${ROOT}/updateCostCenter`, method: 'put', data: assignmentOf(input, 'costCenterId') }) },
    async export (query: FundSalaryFundProcessQuery = {}): Promise<FundSalaryFundProcessFile> {
      const params = exportQueryOf(query)
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params, responseType: 'arraybuffer' })
      return bytesOf(response)
    },
  }
}

export type FundSalaryFundProcessCapability = ReturnType<typeof createFundSalaryFundProcessCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('name', 'text'), p('orgIds', 'text', false, '所属组织ID数组，SDK按Portal转为逗号字符串'), p('staffStatus', 'enum', false, '在职状态字典值'), p('insuranceStatus', 'enum', false, '公积金状态字典值'), p('entryTime', 'date', false, '入职日期范围，SDK转为entryTimeStart/entryTimeEnd'), p('businessDate', 'date', false, '办理业务日期，省略时使用当天'), p('pageNo', 'number'), p('pageSize', 'number')]
const assignmentParams: ParamSpec[] = [p('staffCodes', 'text', true, '当前列表行staffCode数组'), p('depositUnitId', 'text', false, '缴存单位ID；updateDepositUnit时必填'), p('costCenterId', 'text', false, '成本中心ID；updateCostCenter时必填')]

export const FUND_SALARY_FUND_PROCESS_METHODS = {
  'fund-process-list': 'list', 'fund-process-organization-tree': 'organizationTree', 'fund-process-area-tree': 'areaTree', 'fund-process-prepare-update-deposit-unit': 'prepareUpdateDepositUnit', 'fund-process-update-deposit-unit': 'updateDepositUnit', 'fund-process-prepare-update-cost-center': 'prepareUpdateCostCenter', 'fund-process-update-cost-center': 'updateCostCenter', 'fund-process-export': 'export',
  'fund-process-prepare-insure': 'prepareInsure', 'fund-process-insure': 'insure', 'fund-process-cancel-insure': 'cancelInsure', 'fund-process-prepare-terminate': 'prepareTerminate', 'fund-process-terminate': 'terminate', 'fund-process-cancel-terminate': 'cancelTerminate',
} as const

export const fundSalaryFundProcessCapabilities: CapabilityDefinition[] = [
  { id: 'fund-process-list', title: '查询公积金办理', write: false, params: queryParams },
  { id: 'fund-process-organization-tree', title: '查询公积金办理组织树', write: false, params: [] },
  { id: 'fund-process-area-tree', title: '查询公积金办理地区树', write: false, params: [] },
  { id: 'fund-process-prepare-insure', title: '准备公积金增员', write: false, params: [p('rows', 'text', true, '增员子页的完整列表行数组；保留Portal提交的全部字段')] },
  { id: 'fund-process-insure', title: '办理公积金增员', write: true, params: [p('draft', 'text', true, 'prepareInsure返回的完整请求body数组')] },
  { id: 'fund-process-cancel-insure', title: '取消公积金增员', write: false, params: [] },
  { id: 'fund-process-prepare-terminate', title: '准备公积金减员', write: false, params: [p('rows', 'text', true, '减员子页的完整列表行数组；包含insuranceStopDate和reductionReason')] },
  { id: 'fund-process-terminate', title: '办理公积金减员', write: true, params: [p('draft', 'text', true, 'prepareTerminate返回的完整请求body数组')] },
  { id: 'fund-process-cancel-terminate', title: '取消公积金减员', write: false, params: [] },
  { id: 'fund-process-prepare-update-deposit-unit', title: '准备调整公积金缴存单位', write: false, params: assignmentParams },
  { id: 'fund-process-update-deposit-unit', title: '调整公积金缴存单位', write: true, params: assignmentParams },
  { id: 'fund-process-prepare-update-cost-center', title: '准备调整公积金成本中心', write: false, params: assignmentParams },
  { id: 'fund-process-update-cost-center', title: '调整公积金成本中心', write: true, params: assignmentParams },
  { id: 'fund-process-export', title: '导出公积金办理', write: false, params: queryParams },
].map(definition => ({ ...definition, pagePath: FUND_SALARY_FUND_PROCESS_PAGE_PATH, permission: FUND_SALARY_FUND_PROCESS_PERMISSION, moduleType: FUND_SALARY_FUND_PROCESS_MODULE_TYPE, httpInstance: 'platform' }))
