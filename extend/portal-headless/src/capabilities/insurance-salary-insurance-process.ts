import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/** Portal「社会保险 → 社保办理」；固定分支实测锚点 Portal acab69acc7、Java 0f1a55718e。 */
export const INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH = '/dashboard/insurance/process/list'
export const INSURANCE_SALARY_INSURANCE_PROCESS_PERMISSION = '/dashboard/insurance/process'
export const INSURANCE_SALARY_INSURANCE_PROCESS_MODULE_TYPE = 14
const ROOT = '/salary/salaryinsurance'
const AREA_TREE_URL = '/system/area/getTree'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'

export type InsuranceSalaryInsuranceProcessId = string | number
export type InsuranceSalaryInsuranceProcessQuery = {
  name?: string | null
  orgIds?: InsuranceSalaryInsuranceProcessId[] | string | null
  staffStatus?: number | null
  insuranceStatus?: number | null
  entryTime?: [string | null, string | null] | string[] | null
  businessDate?: string
  pageNo?: number
  pageSize?: number
}

export type InsuranceSalaryInsuranceProcessRow = {
  id?: InsuranceSalaryInsuranceProcessId | null
  staffCode: InsuranceSalaryInsuranceProcessId
  name: string | null
  organizationPath: string | null
  postName: string | null
  idCard: string | null
  householdType: number | null
  employmentType: number | null
  entryTime: string | null
  depositUnitName: string | null
  depositUnitId: InsuranceSalaryInsuranceProcessId | null
  costCenterName: string | null
  costCenterId: InsuranceSalaryInsuranceProcessId | null
  costCenter: string | null
  organizationId: InsuranceSalaryInsuranceProcessId | null
  postId: InsuranceSalaryInsuranceProcessId | null
  insuredArea: string | null
  insuranceStatus: number | null
  insuranceStatusName: string | null
  staffStatus: number | null
  staffStatusName: string | null
  insuranceStartDate: string | null
  insuranceStopDate: string | null
  depositBase: number | string | null
  reductionReason: string | null
  [key: string]: unknown
}

export type InsuranceSalaryInsuranceProcessAssignment = {
  staffCode: InsuranceSalaryInsuranceProcessId
  depositUnitId?: InsuranceSalaryInsuranceProcessId
  costCenterId?: InsuranceSalaryInsuranceProcessId
}

export type InsuranceSalaryInsuranceProcessEligibilityResult = {
  processedIds: InsuranceSalaryInsuranceProcessId[]
  processedStaffCodes: InsuranceSalaryInsuranceProcessId[]
  processedCount: number
  eligibleStaffIds: InsuranceSalaryInsuranceProcessId[]
  eligibleStaffCodes: InsuranceSalaryInsuranceProcessId[]
  excludedStaffList: JsonObject[]
}

export type InsuranceSalaryInsuranceProcessYearBaseQuery = {
  orgIds: InsuranceSalaryInsuranceProcessId[] | string
  startDate: string
  endDate: string
}

export type InsuranceSalaryInsuranceProcessFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): InsuranceSalaryInsuranceProcessId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error(`${label}必须为安全正整数或其十进制字符串`)
  return value
}

function optionalIdOf (value: unknown, label: string): InsuranceSalaryInsuranceProcessId | null {
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

function amountOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、十进制字符串或null`)
}

function dateOf (value: unknown, label: string, nullable = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null
    throw new Error(`${label}不能为空`)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD或完整日期时间`)
  return value
}

function monthOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label}必须为YYYY-MM`)
  return value
}

function idsOf (value: unknown, label: string): InsuranceSalaryInsuranceProcessId[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').filter(Boolean) : []
  if (values.length === 0) throw new Error(`${label}不能为空`)
  const ids = values.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function commaIdsOf (value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return idsOf(value, 'orgIds').join(',')
}

function today (): string {
  const value = new Date()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function dayRangeOf (value: unknown, label: string): { start: string | null; end: string | null } {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return { start: null, end: null }
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label}必须是两个日期的数组`)
  const start = dateOf(value[0], `${label}[0]`, false)!.slice(0, 10)
  const end = dateOf(value[1], `${label}[1]`, false)!.slice(0, 10)
  const next = new Date(`${end}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return {
    start,
    end: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
  }
}

function pageNumberOf (value: number | undefined, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100, 200, 500].includes(resolved)) throw new Error('pageSize必须是页面支持的10、20、50、100、200或500')
  return resolved
}

function queryOf (query: InsuranceSalaryInsuranceProcessQuery = {}, exportMode = false): Record<string, unknown> {
  const range = dayRangeOf(query.entryTime, 'entryTime')
  if (query.name !== undefined && query.name !== null && typeof query.name !== 'string') throw new Error('name必须为字符串或null')
  if (query.staffStatus !== undefined && query.staffStatus !== null && !Number.isSafeInteger(query.staffStatus)) throw new Error('staffStatus必须为整数或null')
  if (query.insuranceStatus !== undefined && query.insuranceStatus !== null && !Number.isSafeInteger(query.insuranceStatus)) throw new Error('insuranceStatus必须为整数或null')
  const businessDate = query.businessDate ?? today()
  dateOf(businessDate, 'businessDate', false)
  return {
    ...(exportMode ? {} : { order: '', orderField: '' }),
    name: query.name ?? '',
    orgIds: commaIdsOf(query.orgIds),
    staffStatus: query.staffStatus ?? null,
    insuranceStatus: query.insuranceStatus ?? null,
    businessDate,
    entryTimeStart: range.start,
    entryTimeEnd: range.end,
    ...(exportMode
      ? { limit: pageNumberOf(query.pageSize, 20, 'pageSize'), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo') }
      : { pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize') }),
  }
}

function yearBaseQueryOf (input: InsuranceSalaryInsuranceProcessYearBaseQuery): Record<string, unknown> {
  const value = objectOf(input, '社保年度基数输入')
  const orgIds = idsOf(value.orgIds, 'orgIds')
  const startDate = monthOf(value.startDate, 'startDate')
  const endDate = monthOf(value.endDate, 'endDate')
  return { orgIds: orgIds.join(','), startDate, endDate }
}

function rowOf (value: unknown): InsuranceSalaryInsuranceProcessRow {
  const row = objectOf(value, '社保办理列表行')
  return {
    ...row,
    id: optionalIdOf(row.id, '社保办理id'),
    staffCode: idOf(row.staffCode, '社保办理staffCode'),
    name: textOf(row.name, 'name'),
    organizationPath: textOf(row.organizationPath, 'organizationPath'),
    postName: textOf(row.postName, 'postName'),
    idCard: textOf(row.idCard, 'idCard'),
    householdType: integerOf(row.householdType, 'householdType'),
    employmentType: integerOf(row.employmentType, 'employmentType'),
    entryTime: dateOf(row.entryTime, 'entryTime'),
    depositUnitName: textOf(row.depositUnitName, 'depositUnitName'),
    depositUnitId: optionalIdOf(row.depositUnitId, 'depositUnitId'),
    costCenterName: textOf(row.costCenterName, 'costCenterName'),
    costCenterId: optionalIdOf(row.costCenterId, 'costCenterId'),
    costCenter: textOf(row.costCenter, 'costCenter'),
    organizationId: optionalIdOf(row.organizationId, 'organizationId'),
    postId: optionalIdOf(row.postId, 'postId'),
    insuredArea: textOf(row.insuredArea, 'insuredArea'),
    insuranceStatus: integerOf(row.insuranceStatus, 'insuranceStatus'),
    insuranceStatusName: textOf(row.insuranceStatusName, 'insuranceStatusName'),
    staffStatus: integerOf(row.staffStatus, 'staffStatus'),
    staffStatusName: textOf(row.staffStatusName, 'staffStatusName'),
    insuranceStartDate: dateOf(row.insuranceStartDate, 'insuranceStartDate'),
    insuranceStopDate: dateOf(row.insuranceStopDate, 'insuranceStopDate'),
    depositBase: amountOf(row.depositBase, 'depositBase'),
    reductionReason: textOf(row.reductionReason, 'reductionReason'),
  }
}

function requiredActionTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (!text || !text.trim()) throw new Error(`${label}不能为空`)
  return text
}

function actionRowsOf (value: unknown, action: 'insure' | 'terminate'): InsuranceSalaryInsuranceProcessRow[] {
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
      return {
        ...row,
        staffCode,
        insuredArea,
        depositUnitId,
        costCenterId,
        insuranceStartDate: dateOf(row.insuranceStartDate, `${action}行[${index}].insuranceStartDate`),
      } as InsuranceSalaryInsuranceProcessRow
    }
    return {
      ...row,
      staffCode,
      insuranceStopDate: dateOf(row.insuranceStopDate, `${action}行[${index}].insuranceStopDate`, false),
      reductionReason: requiredActionTextOf(row.reductionReason, `${action}行[${index}].reductionReason`),
    } as InsuranceSalaryInsuranceProcessRow
  })
}

function insurePayloadOf (value: unknown): JsonObject[] {
  return actionRowsOf(value, 'insure').map(row => ({
    ...row,
    insuranceStartDate: row.insuranceStartDate ? row.insuranceStartDate.slice(0, 10) : null,
  }))
}

function terminatePayloadOf (value: unknown): JsonObject[] {
  return actionRowsOf(value, 'terminate').map(row => ({
    ...row,
    insuranceStopDate: row.insuranceStopDate!.slice(0, 10),
  }))
}

function eligibilityResultOf (value: unknown): InsuranceSalaryInsuranceProcessEligibilityResult {
  const result = objectOf(value, '社保资格结果')
  const array = (name: string): unknown[] => {
    if (!Array.isArray(result[name])) throw new Error(`社保资格结果.${name}必须为数组`)
    return result[name] as unknown[]
  }
  const ids = (name: string): InsuranceSalaryInsuranceProcessId[] => array(name).map((item, index) => idOf(item, `社保资格结果.${name}[${index}]`))
  const processedCount = result.processedCount
  if (typeof processedCount !== 'number' || !Number.isSafeInteger(processedCount) || processedCount < 0) throw new Error('社保资格结果.processedCount无效')
  return {
    processedIds: ids('processedIds'),
    processedStaffCodes: ids('processedStaffCodes'),
    processedCount,
    eligibleStaffIds: ids('eligibleStaffIds'),
    eligibleStaffCodes: ids('eligibleStaffCodes'),
    excludedStaffList: array('excludedStaffList').map((item, index) => objectOf(item, `社保资格结果.excludedStaffList[${index}]`)),
  }
}

function assignmentOf (input: unknown, field: 'depositUnitId' | 'costCenterId'): InsuranceSalaryInsuranceProcessAssignment[] {
  const value = objectOf(input, '社保办理调整输入')
  const staffCodes = idsOf(value.staffCodes, 'staffCodes')
  const target = idOf(value[field], field)
  return staffCodes.map(staffCode => ({ staffCode, [field]: target }))
}

function treeOf (value: unknown, label: string): JsonObject {
  const node = objectOf(value, label)
  return { ...node, id: idOf(node.id, `${label}.id`), name: typeof node.name === 'string' ? node.name : '', children: Array.isArray(node.children) ? node.children.map((item, index) => treeOf(item, `${label}.children[${index}]`)) : [] }
}

function responseFileName (response: AxiosResponse<ArrayBuffer>, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const header = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  if (typeof header !== 'string') return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)?.[1]
  return plain || fallback
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): InsuranceSalaryInsuranceProcessFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('社保办理导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName: responseFileName(response, fallback),
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

export function createInsuranceSalaryInsuranceProcessCapability (request: PortalRequest) {
  return {
    async list (query: InsuranceSalaryInsuranceProcessQuery = {}): Promise<PageResult<InsuranceSalaryInsuranceProcessRow>> {
      const result = await request<PageResult<unknown>>({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error('社保办理分页响应缺少有效list或total')
      return { list: result.list.map(rowOf), total: result.total }
    },
    async organizationTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: ORGANIZATION_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('社保办理组织树响应必须是数组')
      return result.map((item, index) => treeOf(item, `组织树[${index}]`))
    },
    async areaTree (): Promise<JsonObject[]> {
      const result = await request<unknown>({ url: AREA_TREE_URL, method: 'get' })
      if (!Array.isArray(result)) throw new Error('社保办理地区树响应必须是数组')
      return result.map((item, index) => treeOf(item, `地区树[${index}]`))
    },
    prepareInsure (input: { rows: InsuranceSalaryInsuranceProcessRow[] }) { return { draft: insurePayloadOf(input?.rows) } },
    async insure (input: { draft: JsonObject[] }): Promise<InsuranceSalaryInsuranceProcessEligibilityResult> {
      return eligibilityResultOf(await request({ url: `${ROOT}/insure`, method: 'post', data: insurePayloadOf(input?.draft) }))
    },
    cancelInsure (): { cancelled: true } { return { cancelled: true } },
    prepareTerminate (input: { rows: InsuranceSalaryInsuranceProcessRow[] }) { return { draft: terminatePayloadOf(input?.rows) } },
    async terminate (input: { draft: JsonObject[] }): Promise<void> {
      await request({ url: `${ROOT}/terminate`, method: 'put', data: terminatePayloadOf(input?.draft) })
    },
    cancelTerminate (): { cancelled: true } { return { cancelled: true } },
    prepareUpdateDepositUnit (input: { staffCodes: InsuranceSalaryInsuranceProcessId[]; depositUnitId: InsuranceSalaryInsuranceProcessId }) { return { draft: assignmentOf(input, 'depositUnitId') } },
    async updateDepositUnit (input: { staffCodes: InsuranceSalaryInsuranceProcessId[]; depositUnitId: InsuranceSalaryInsuranceProcessId }): Promise<void> { await request({ url: `${ROOT}/updateDepositUnit`, method: 'put', data: assignmentOf(input, 'depositUnitId') }) },
    prepareUpdateCostCenter (input: { staffCodes: InsuranceSalaryInsuranceProcessId[]; costCenterId: InsuranceSalaryInsuranceProcessId }) { return { draft: assignmentOf(input, 'costCenterId') } },
    async updateCostCenter (input: { staffCodes: InsuranceSalaryInsuranceProcessId[]; costCenterId: InsuranceSalaryInsuranceProcessId }): Promise<void> { await request({ url: `${ROOT}/updateCostCenter`, method: 'put', data: assignmentOf(input, 'costCenterId') }) },
    async export (query: InsuranceSalaryInsuranceProcessQuery = {}): Promise<InsuranceSalaryInsuranceProcessFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/exportList`, method: 'get', params: queryOf(query, true), responseType: 'arraybuffer' })
      return fileOf(response, '社保办理.xlsx')
    },
    async exportYearBase (input: InsuranceSalaryInsuranceProcessYearBaseQuery): Promise<InsuranceSalaryInsuranceProcessFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export`, method: 'get', params: yearBaseQueryOf(input), responseType: 'arraybuffer' })
      return fileOf(response, '年度基数.xlsx')
    },
  }
}

export type InsuranceSalaryInsuranceProcessCapability = ReturnType<typeof createInsuranceSalaryInsuranceProcessCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, description })
const queryParams: ParamSpec[] = [p('name', 'text'), p('orgIds', 'text', false, '所属组织ID数组，SDK按Portal转为逗号字符串'), p('staffStatus', 'enum', false, '在职状态字典值'), p('insuranceStatus', 'enum', false, '参保状态字典值'), p('entryTime', 'date', false, '入职日期范围，SDK转为entryTimeStart/entryTimeEnd'), p('businessDate', 'date', false, '办理业务日期，省略时使用当天'), p('pageNo', 'number'), p('pageSize', 'number')]
const depositParams: ParamSpec[] = [p('staffCodes', 'text', true, '当前列表行staffCode数组'), p('depositUnitId', 'text', true, '缴存单位ID')]
const costParams: ParamSpec[] = [p('staffCodes', 'text', true, '当前列表行staffCode数组'), p('costCenterId', 'text', true, '成本中心ID')]
const yearBaseParams: ParamSpec[] = [p('orgIds', 'text', true, '年度基数所属组织ID数组'), p('startDate', 'date', true, '年度基数起始月份，YYYY-MM'), p('endDate', 'date', true, '年度基数结束月份，YYYY-MM')]

export const INSURANCE_SALARY_INSURANCE_PROCESS_METHODS = {
  'insurance-process-list': 'list',
  'insurance-process-organization-tree': 'organizationTree',
  'insurance-process-area-tree': 'areaTree',
  'insurance-process-prepare-insure': 'prepareInsure',
  'insurance-process-insure': 'insure',
  'insurance-process-cancel-insure': 'cancelInsure',
  'insurance-process-prepare-terminate': 'prepareTerminate',
  'insurance-process-terminate': 'terminate',
  'insurance-process-cancel-terminate': 'cancelTerminate',
  'insurance-process-prepare-update-deposit-unit': 'prepareUpdateDepositUnit',
  'insurance-process-update-deposit-unit': 'updateDepositUnit',
  'insurance-process-prepare-update-cost-center': 'prepareUpdateCostCenter',
  'insurance-process-update-cost-center': 'updateCostCenter',
  'insurance-process-export': 'export',
  'insurance-process-export-year-base': 'exportYearBase',
} as const

export const insuranceSalaryInsuranceProcessCapabilities: CapabilityDefinition[] = [
  { id: 'insurance-process-list', title: '查询社保办理', write: false, params: queryParams },
  { id: 'insurance-process-organization-tree', title: '查询社保办理组织树', write: false, params: [] },
  { id: 'insurance-process-area-tree', title: '查询社保办理地区树', write: false, params: [] },
  { id: 'insurance-process-prepare-insure', title: '准备社保增员', write: false, params: [p('rows', 'text', true, '增员子页的完整列表行数组；保留Portal提交的全部字段')] },
  { id: 'insurance-process-insure', title: '办理社保增员', write: true, params: [p('draft', 'text', true, 'prepareInsure返回的完整请求body数组')] },
  { id: 'insurance-process-cancel-insure', title: '取消社保增员', write: false, params: [] },
  { id: 'insurance-process-prepare-terminate', title: '准备社保减员', write: false, params: [p('rows', 'text', true, '减员子页的完整列表行数组；包含insuranceStopDate和reductionReason')] },
  { id: 'insurance-process-terminate', title: '办理社保减员', write: true, params: [p('draft', 'text', true, 'prepareTerminate返回的完整请求body数组')] },
  { id: 'insurance-process-cancel-terminate', title: '取消社保减员', write: false, params: [] },
  { id: 'insurance-process-prepare-update-deposit-unit', title: '准备调整社保缴存单位', write: false, params: depositParams },
  { id: 'insurance-process-update-deposit-unit', title: '调整社保缴存单位', write: true, params: depositParams },
  { id: 'insurance-process-prepare-update-cost-center', title: '准备调整社保成本中心', write: false, params: costParams },
  { id: 'insurance-process-update-cost-center', title: '调整社保成本中心', write: true, params: costParams },
  { id: 'insurance-process-export', title: '导出社保办理', write: false, params: queryParams },
  { id: 'insurance-process-export-year-base', title: '生成社保年度基数', write: false, params: yearBaseParams },
].map(definition => ({ ...definition, pagePath: INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH, permission: INSURANCE_SALARY_INSURANCE_PROCESS_PERMISSION, moduleType: INSURANCE_SALARY_INSURANCE_PROCESS_MODULE_TYPE, httpInstance: 'platform' }))
