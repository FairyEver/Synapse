import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/**
 * 人力「组织设置」列表页。
 *
 * 代码依据：Portal `views/dashboard/hr/org/org-setting/list.vue`、同目录
 * `[mode]/[id].vue`、`components/{post,create-multiple,download-template,change-relation,part-time-staff}.vue`
 * 以及 HR Java `HrOrganizationController` / `HrOrganizationPostController`。
 * 请求由调用方通过 `createPageCall` 注入，页面上下文会补 platform、租户凭据和 module-type=11。
 */
export const HR_ORGANIZATION_SETTING_PAGE_PATH = '/dashboard/org/org-setting/list'
export const HR_ORGANIZATION_SETTING_PERMISSION = '/dashboard/org/org-setting/list'
export const HR_ORGANIZATION_SETTING_MODULE_TYPE = 11

const ROOT = '/org/organization'
const HISTORY_ROOT = '/hr/org/organization/changeLog'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type HrOrganizationSettingId = string | number
export type HrOrganizationSettingStatus = 0 | 1

export type HrOrganizationSettingQuery = {
  /** 组织编码包含筛选；页面默认空字符串。 */
  code?: string
  /** 组织名称包含筛选；页面默认空字符串。 */
  name?: string
  /** 上级组织名称包含筛选；页面默认空字符串。 */
  pName?: string
  /** 组织类型 ID；null 表示清除筛选。 */
  typeId?: HrOrganizationSettingId | '' | null
  /** 组织层级；页面只允许正整数，null 表示清除筛选。 */
  level?: number | '' | null
  /** 1 启用、0 停用；null 表示清除状态筛选。省略时复刻页面默认 1。 */
  status?: HrOrganizationSettingStatus | null
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

export type HrOrganizationSettingPageRow = {
  id: HrOrganizationSettingId
  name: string
  code: string | null
  type: string | null
  level: number | null
  parentOrg: string | null
  director: string | null
  foundDate: string | null
  isCorporation: HrOrganizationSettingStatus | null
  legalName: string | null
  mainInvest: string | null
  isStandardUnit: HrOrganizationSettingStatus | null
  standardUnit: string | null
  standardLine: string | null
  fullPath: string | null
  containJob: string | null
  createTime: string | number | null
  country: string | null
  address: string | null
  officeAddress: string | null
  remark: string | null
  status: HrOrganizationSettingStatus
}

export type HrOrganizationSettingDetail = Record<string, unknown> & {
  id: HrOrganizationSettingId
}

export type HrOrganizationSettingJob = Record<string, unknown> & {
  postId: HrOrganizationSettingId
  postName?: string
  isExternal: 0 | 1
  needNumber: number | string | null
  existNumber?: number | null
  remark?: string | null
}

export type HrOrganizationSettingLicense = {
  typeId: HrOrganizationSettingId
  typeNum: number
  label?: string
}

export type HrOrganizationSettingForm = Record<string, unknown> & {
  id?: HrOrganizationSettingId
  name: string
  code?: string
  typeList: HrOrganizationSettingId[]
  propertyList?: HrOrganizationSettingId[]
  directorList?: HrOrganizationSettingId | HrOrganizationSettingId[] | '' | null
  pid: HrOrganizationSettingId | ''
  foundDate: string
  jobList?: HrOrganizationSettingJob[]
  partTimeJobList?: Array<HrOrganizationSettingId | { postId?: HrOrganizationSettingId } | null | undefined>
  checkedIdList?: HrOrganizationSettingId[]
  hrOrganizationLicenseDTOList?: Array<Partial<HrOrganizationSettingLicense>>
  containJob?: string
  country?: string
  city?: string | number | null
  officeAddress?: string
  isCorporation?: HrOrganizationSettingStatus
  corporation?: HrOrganizationSettingId | ''
  hrLegalPersonDTO?: Record<string, unknown> | null
  isStandardUnit?: HrOrganizationSettingStatus
  standardUnit?: string
  standardLine?: string
  belongLegalPersonId?: HrOrganizationSettingId | '' | null
  belongLegalPersonName?: string
  isCostCenter?: HrOrganizationSettingStatus
  costCenter?: string
  remark?: string
  directorPostName?: string
}

export type HrOrganizationSettingUpdateForm = HrOrganizationSettingForm & {
  id: HrOrganizationSettingId
}

export type HrOrganizationSettingPayload = Record<string, unknown>

export type HrOrganizationSettingFileInput = {
  fileName: string
  base64: string
  /** Portal 上传组件只接受这个精确 MIME；省略时按 .xlsx 的浏览器默认值处理。 */
  contentType?: string
}

export type HrOrganizationSettingFile = {
  fileName: string
  contentType: string
  base64: string
  byteLength: number
}

export type HrOrganizationSettingFilePreview = Omit<HrOrganizationSettingFile, 'base64'>

export type HrOrganizationSettingHistoryQuery = {
  orgName?: string
  operatorName?: string
  /** Portal range-picker 格式化后的 YYYY-MM-DD HH:mm:ss。 */
  startTime?: string
  endTime?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

export type HrOrganizationSettingHistoryRow = {
  id: HrOrganizationSettingId
  orgId: HrOrganizationSettingId | null
  orgName: string | null
  changeTypeDesc: string | null
  changeFieldCount: number | null
  changeTime: string | null
  operatorName: string | null
}

export type HrOrganizationSettingHistoryItem = {
  field: string
  oldValue: string | null
  newValue: string | null
  changeDesc?: string | null
}

export type HrOrganizationSettingHistoryDetail = HrOrganizationSettingHistoryRow & {
  changeItems: HrOrganizationSettingHistoryItem[]
}

export type HrOrganizationSettingSensitivePreparation = {
  verificationRequired: boolean
  phone: string | null
  isDel: number | string | null
}

export type HrOrganizationSettingRelationInput = {
  id: HrOrganizationSettingId
  pid: HrOrganizationSettingId
  /** 需要敏感验证时，由 sendChangeRelationCode 返回的 requestId 与用户输入验证码。 */
  verification?: { requestId: string; code: string }
}

export type HrOrganizationSettingOption = {
  id: HrOrganizationSettingId
  name: string
}

export type HrOrganizationSettingPropertyOption = {
  label: string
  value: string
}

export type HrOrganizationSettingLicenseOption = {
  label: string
  typeId: string
  typeNum: null
}

export type HrOrganizationSettingPostNode = Record<string, unknown> & {
  id: HrOrganizationSettingId
  name: string
}

export type HrOrganizationSettingUser = Record<string, unknown> & {
  id: HrOrganizationSettingId
  realName?: string
  username?: string
  staffId?: HrOrganizationSettingId | null
}

export type HrOrganizationSettingLegalPerson = {
  id: HrOrganizationSettingId
  name: string
  superOrganizationName: string | null
  mainInvest: string | null
}

export type HrOrganizationSettingCostCenter = {
  code: string
  name: string
}

export type HrOrganizationSettingPartTimePost = {
  postId: HrOrganizationSettingId
  postName: string | null
  partTimeStaffCount: number | null
  existNumber: number | null
}

export type HrOrganizationSettingPartTimeStaff = Record<string, unknown> & {
  relationId: HrOrganizationSettingId
  name: string | null
  staffCode: string | null
  organizationName: string | null
  postName: string | null
  status: string | number | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new Error(`${label}必须是${allowEmpty ? '' : '非空'}字符串`)
  }
  return value
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return textOf(value, label, true)
}

function idOf (value: unknown, label: string): HrOrganizationSettingId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
    return value
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${label}必须为安全正整数或十进制正整数字符串`)
  }
  return value
}

function optionalIdOf (value: unknown, label: string): HrOrganizationSettingId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function idListOf (value: unknown, label: string, required = false): HrOrganizationSettingId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  const result = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (required && result.length === 0) throw new Error(`${label}至少选择一项`)
  return result
}

function nullableIntegerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  return value as number
}

function statusOf (value: unknown, label = 'status'): HrOrganizationSettingStatus {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是数值0（停用）或1（启用）`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) {
    throw new Error('pageSize必须是页面支持的10、20、50或100')
  }
  return result as number
}

function boundedTreePageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || (result as number) < 1 || (result as number) > 100) {
    throw new Error(`${label}必须为1至100的整数`)
  }
  return result as number
}

function filterTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  return textOf(value, label, true)
}

function filterIdOf (value: unknown, label: string): HrOrganizationSettingId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, label)
}

function filterLevelOf (value: unknown): number | '' {
  if (value === undefined || value === null || value === '') return ''
  const level = integerOf(value, 'level')
  if (level < 1) throw new Error('level必须为正整数')
  return level
}

function filterParamsOf (input: HrOrganizationSettingQuery): Record<string, unknown> {
  return {
    // Keep the form object's order from list.vue: name, pName, code, typeId, level, status.
    name: filterTextOf(input.name, 'name'),
    pName: filterTextOf(input.pName, 'pName'),
    code: filterTextOf(input.code, 'code'),
    typeId: filterIdOf(input.typeId, 'typeId'),
    level: filterLevelOf(input.level),
    status: input.status === null ? undefined : statusOf(input.status ?? 1),
  }
}

function listQueryOf (input: HrOrganizationSettingQuery): Record<string, unknown> {
  if (input.order !== undefined && typeof input.order !== 'string') throw new Error('order必须为字符串')
  if (input.orderField !== undefined && typeof input.orderField !== 'string') throw new Error('orderField必须为字符串')
  return {
    order: input.order ?? '',
    orderField: input.orderField ?? '',
    ...filterParamsOf(input),
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function exportParamsOf (input: HrOrganizationSettingQuery): Record<string, unknown> {
  return filterParamsOf(input)
}

function rowOf (value: unknown): HrOrganizationSettingPageRow {
  const row = objectOf(value, '组织设置列表行')
  const id = idOf(row.id, '组织ID')
  const name = textOf(row.name, '组织名称', true)
  const status = statusOf(row.status)
  const optionalStatus = (field: string): HrOrganizationSettingStatus | null => {
    if (row[field] === undefined || row[field] === null) return null
    return statusOf(row[field], field)
  }
  return {
    id,
    name,
    code: nullableTextOf(row.code, '组织编码'),
    type: nullableTextOf(row.type, '组织类型'),
    level: nullableIntegerOf(row.level, '组织层级'),
    parentOrg: nullableTextOf(row.parentOrg, '上级组织'),
    director: nullableTextOf(row.director, '组织负责人'),
    foundDate: nullableTextOf(row.foundDate, '成立日期'),
    isCorporation: optionalStatus('isCorporation'),
    legalName: nullableTextOf(row.legalName, '法人名称'),
    mainInvest: nullableTextOf(row.mainInvest, '投资主体'),
    isStandardUnit: optionalStatus('isStandardUnit'),
    standardUnit: nullableTextOf(row.standardUnit, '标准单元'),
    standardLine: nullableTextOf(row.standardLine, '标准线'),
    fullPath: nullableTextOf(row.fullPath, '组织架构全路径'),
    containJob: nullableTextOf(row.containJob, '包含岗位'),
    createTime: row.createTime === undefined || row.createTime === null
      ? null
      : typeof row.createTime === 'string' || typeof row.createTime === 'number'
        ? row.createTime
        : (() => { throw new Error('创建时间必须为字符串、数字或null') })(),
    country: nullableTextOf(row.country, '所属国家'),
    address: nullableTextOf(row.address, '所属地区'),
    officeAddress: nullableTextOf(row.officeAddress, '办公地址'),
    remark: nullableTextOf(row.remark, '备注'),
    status,
  }
}

function pageOf<T extends JsonObject> (value: unknown, label: string): PageResult<T> {
  if (Array.isArray(value)) return { list: value as T[], total: value.length }
  const page = objectOf(value, label)
  if (!Array.isArray(page.list)) throw new Error(`${label}缺少list数组`)
  if (!Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error(`${label}缺少有效total`)
  return { list: page.list as T[], total: page.total as number }
}

function detailOf (value: unknown): HrOrganizationSettingDetail {
  const detail = objectOf(value, '组织设置详情')
  return { ...detail, id: idOf(detail.id, '组织ID') }
}

function postJobListOf (value: unknown): HrOrganizationSettingJob[] {
  if (!Array.isArray(value)) throw new Error('jobList必须是数组')
  return value.map((item, index) => {
    const job = objectOf(item, `jobList[${index}]`)
    const postId = idOf(job.postId, `jobList[${index}].postId`)
    const isExternal = statusOf(job.isExternal, `jobList[${index}].isExternal`)
    const remark = job.remark === undefined
      ? ''
      : job.remark === null
        ? null
        : textOf(job.remark, `jobList[${index}].remark`, true)
    if (typeof remark === 'string' && remark && !remark.trim()) throw new Error(`jobList[${index}].remark不能全为空格`)
    let needNumber: number | string | null
    if (isExternal === 1) {
      if (job.needNumber !== undefined && job.needNumber !== '' && job.needNumber !== null && !Number.isSafeInteger(job.needNumber)) {
        throw new Error(`jobList[${index}].needNumber必须为空或非负整数`)
      }
      needNumber = job.needNumber === undefined ? '' : job.needNumber as number | string | null
    } else {
      if (!Number.isSafeInteger(job.needNumber) || (job.needNumber as number) < 0) {
        throw new Error(`jobList[${index}].needNumber必须为非负整数`)
      }
      needNumber = job.needNumber as number
    }
    return { ...job, postId, isExternal, needNumber, remark }
  })
}

function partTimePostIdsOf (value: unknown): Array<{ postId: HrOrganizationSettingId }> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('partTimeJobList必须是数组')
  const result: Array<{ postId: HrOrganizationSettingId }> = []
  for (const [index, item] of value.entries()) {
    const raw = item && typeof item === 'object' ? (item as { postId?: unknown }).postId : item
    if (raw === undefined || raw === null || raw === '') continue
    result.push({ postId: idOf(raw, `partTimeJobList[${index}].postId`) })
  }
  return result
}

function directorListOf (value: unknown): HrOrganizationSettingId | HrOrganizationSettingId[] | '' | null {
  if (value === undefined) return []
  if (value === null) return null
  if (typeof value === 'string') return [idOf(value, 'directorList')]
  if (Array.isArray(value)) return value.map((item, index) => idOf(item, `directorList[${index}]`))
  return idOf(value, 'directorList')
}

function licenseListOf (value: unknown, requiredValues: boolean): Array<{ typeId: HrOrganizationSettingId; typeNum: number }> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('hrOrganizationLicenseDTOList必须是数组')
  return value.map((item, index) => {
    const license = objectOf(item, `hrOrganizationLicenseDTOList[${index}]`)
    const typeId = idOf(license.typeId, `hrOrganizationLicenseDTOList[${index}].typeId`)
    if (!requiredValues && (license.typeNum === undefined || license.typeNum === null || license.typeNum === '')) {
      return { typeId, typeNum: 0 }
    }
    const typeNum = integerOf(license.typeNum, `hrOrganizationLicenseDTOList[${index}].typeNum`)
    if (typeNum < 0) throw new Error(`hrOrganizationLicenseDTOList[${index}].typeNum不能小于0`)
    return { typeId, typeNum }
  })
}

const DEFAULT_FORM: Record<string, unknown> = {
  name: '',
  code: '',
  typeList: [],
  propertyList: [],
  directorList: [],
  pid: '',
  foundDate: '',
  jobList: [],
  partTimeJobList: [],
  checkedIdList: [],
  hrOrganizationLicenseDTOList: [],
  containJob: '',
  country: '中国',
  city: null,
  officeAddress: '',
  isCorporation: 0,
  corporation: '',
  hrLegalPersonDTO: { superOrganizationName: '', mainInvest: '' },
  isStandardUnit: 0,
  standardUnit: '',
  standardLine: '',
  belongLegalPersonId: '',
  belongLegalPersonName: '',
  isCostCenter: 0,
  costCenter: '',
  remark: '',
}

const CREATE_FORM_KEYS = new Set(Object.keys(DEFAULT_FORM))

function formForCreate (input: HrOrganizationSettingForm): Record<string, unknown> {
  const result = { ...DEFAULT_FORM }
  for (const [key, value] of Object.entries(input)) {
    if (CREATE_FORM_KEYS.has(key)) result[key] = value
  }
  return result
}

function payloadOf (input: HrOrganizationSettingForm, mode: 'create' | 'update'): HrOrganizationSettingPayload {
  const form = mode === 'create' ? formForCreate(input) : { ...input }
  if (mode === 'update') form.id = idOf(form.id, '组织ID')

  const name = textOf(form.name, '组织名称')
  if (!name.trim() || name.length > 50) throw new Error('组织名称必填、不得全为空格且最多50个字符')
  const rawCode = form.code as unknown
  const code = rawCode === undefined ? '' : rawCode === null ? null : textOf(rawCode, '组织编码', true)
  if (typeof code === 'string' && code && !/^[0-9a-zA-Z]+$/.test(code)) throw new Error('组织编码只能输入数字和字母')
  const typeList = idListOf(form.typeList, 'typeList', true)
  const pid = idOf(form.pid, 'pid')
  const foundDate = textOf(form.foundDate, 'foundDate')
  const propertyList = idListOf(form.propertyList ?? [], 'propertyList')
  const directorList = directorListOf(form.directorList)
  const jobList = postJobListOf(form.jobList ?? [])
  const partTimeJobList = partTimePostIdsOf(form.partTimeJobList)
  const isCorporation = statusOf(form.isCorporation ?? 0, 'isCorporation')
  const corporation = optionalIdOf(form.corporation, '法人单位ID')
  const isStandardUnit = statusOf(form.isStandardUnit ?? 0, 'isStandardUnit')
  const rawStandardUnit = form.standardUnit as unknown
  const rawStandardLine = form.standardLine as unknown
  const standardUnit = rawStandardUnit === undefined ? '' : rawStandardUnit === null ? null : textOf(rawStandardUnit, 'standardUnit', true)
  const standardLine = rawStandardLine === undefined ? '' : rawStandardLine === null ? null : textOf(rawStandardLine, 'standardLine', true)
  const isCostCenter = statusOf(form.isCostCenter ?? 0, 'isCostCenter')
  const rawCostCenter = form.costCenter as unknown
  const costCenter = rawCostCenter === undefined ? '' : rawCostCenter === null ? null : textOf(rawCostCenter, 'costCenter', true)
  const rawRemark = form.remark as unknown
  const remark = rawRemark === undefined ? '' : rawRemark === null ? null : textOf(rawRemark, '备注', true)
  if (typeof remark === 'string' && (remark.length > 200 || (remark !== '' && !remark.trim()))) throw new Error('备注最多200个字符且不得全为空格')
  if (isCorporation === 1) {
    if (corporation === '') throw new Error('isCorporation为1时法人名称必填')
    objectOf(form.hrLegalPersonDTO ?? {}, 'hrLegalPersonDTO')
  }
  if (isStandardUnit === 1) {
    if (typeof standardUnit !== 'string' || typeof standardLine !== 'string' || !standardUnit.trim() || !standardLine.trim()) throw new Error('isStandardUnit为1时standardUnit和standardLine必填')
  }
  if (isCostCenter === 1 && (typeof costCenter !== 'string' || !costCenter.trim())) throw new Error('isCostCenter为1时costCenter必填')
  const licenseList = licenseListOf(form.hrOrganizationLicenseDTOList, isCorporation === 1)

  const data: Record<string, unknown> = {
    ...form,
    name,
    code: typeof code === 'string' ? code.toUpperCase() : code,
    typeList,
    propertyList,
    directorList,
    pid,
    foundDate,
    jobList,
    partTimeJobList,
    hrOrganizationLicenseDTOList: licenseList,
    country: form.country === undefined ? '中国' : form.country,
    city: form.city === undefined ? null : form.city,
    officeAddress: form.officeAddress === undefined ? '' : form.officeAddress,
    isCorporation,
    corporation,
    isStandardUnit,
    standardUnit,
    standardLine,
    belongLegalPersonId: form.belongLegalPersonId === undefined ? '' : form.belongLegalPersonId,
    isCostCenter,
    costCenter,
    remark,
  }
  // This is the page's exact omit list. These values are UI-only display/selection state.
  delete data.directorPostName
  delete data.checkedIdList
  delete data.belongLegalPersonName
  if (isCorporation === 0) {
    delete data.hrLegalPersonDTO
    delete data.hrOrganizationLicenseDTOList
  }
  return data
}

function binaryOf (value: unknown, label: string): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
  }
  throw new Error(`${label}不是二进制文件`)
}

function responseContentTypeOf (response: AxiosResponse, fallback: string): string {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return typeof value === 'string' && value ? value : fallback
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fileName: string, fallbackType: string): HrOrganizationSettingFile {
  const bytes = binaryOf(response?.data, '组织设置下载响应')
  if (bytes.byteLength === 0) throw new Error('组织设置下载响应为空')
  return {
    fileName,
    contentType: responseContentTypeOf(response, fallbackType),
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function decodeImportFile (input: HrOrganizationSettingFileInput): { preview: HrOrganizationSettingFilePreview; bytes: Uint8Array } {
  const fileName = textOf(input?.fileName, 'fileName').trim()
  if (!/\.xlsx$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx；Portal上传控件不接受.xls')
  const base64 = textOf(input?.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('base64不是合法的标准Base64')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('导入文件不能为空')
  const contentType = input.contentType === undefined || input.contentType === ''
    ? XLSX_MIME
    : textOf(input.contentType, 'contentType')
  if (contentType !== XLSX_MIME) throw new Error(`contentType必须为${XLSX_MIME}`)
  return {
    preview: { fileName, contentType, byteLength: bytes.byteLength },
    bytes,
  }
}

function fileNameFromUrl (value: string): string {
  const path = value.split(/[?#]/, 1)[0] || ''
  const raw = path.split('/').pop() || '组织岗位编制模板.xlsx'
  try {
    return decodeURIComponent(raw) || '组织岗位编制模板.xlsx'
  } catch {
    return raw || '组织岗位编制模板.xlsx'
  }
}

function optionListOf (value: unknown, label: string): HrOrganizationSettingOption[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    return { id: idOf(row.id, `${label}[${index}].id`), name: textOf(row.name, `${label}[${index}].name`) }
  })
}

function historyQueryOf (input: HrOrganizationSettingHistoryQuery): Record<string, unknown> {
  const dateTime = (value: unknown, label: string): string => {
    if (value === undefined || value === null || value === '') return ''
    const result = textOf(value, label)
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result)) throw new Error(`${label}必须为YYYY-MM-DD HH:mm:ss`)
    return result
  }
  return {
    order: input.order ?? '',
    orderField: input.orderField ?? '',
    orgName: filterTextOf(input.orgName, 'orgName'),
    operatorName: filterTextOf(input.operatorName, 'operatorName'),
    startTime: dateTime(input.startTime, 'startTime'),
    endTime: dateTime(input.endTime, 'endTime'),
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function historyRowOf (value: unknown): HrOrganizationSettingHistoryRow {
  const row = objectOf(value, '组织变更记录')
  return {
    id: idOf(row.id, '变更记录ID'),
    orgId: row.orgId === undefined || row.orgId === null || row.orgId === '' ? null : idOf(row.orgId, '组织ID'),
    orgName: nullableTextOf(row.orgName, '组织名称'),
    changeTypeDesc: nullableTextOf(row.changeTypeDesc, '变更类型'),
    changeFieldCount: nullableIntegerOf(row.changeFieldCount, '变更字段数'),
    changeTime: nullableTextOf(row.changeTime, '变更时间'),
    operatorName: nullableTextOf(row.operatorName, '操作人'),
  }
}

function historyDetailOf (value: unknown): HrOrganizationSettingHistoryDetail {
  const row = objectOf(value, '组织变更记录详情')
  const base = historyRowOf(row)
  if (!Array.isArray(row.changeItems)) throw new Error('组织变更记录详情缺少changeItems数组')
  const changeItems = row.changeItems.map((item, index) => {
    const change = objectOf(item, `changeItems[${index}]`)
    return {
      field: textOf(change.field, `changeItems[${index}].field`, true),
      oldValue: nullableTextOf(change.oldValue, `changeItems[${index}].oldValue`),
      newValue: nullableTextOf(change.newValue, `changeItems[${index}].newValue`),
      changeDesc: nullableTextOf(change.changeDesc, `changeItems[${index}].changeDesc`),
    }
  })
  return { ...base, changeItems }
}

function postNodeOf (value: unknown, label: string): HrOrganizationSettingPostNode {
  const node = objectOf(value, label)
  return { ...node, id: idOf(node.id, `${label}.id`), name: textOf(node.name, `${label}.name`) }
}

function userOf (value: unknown, label: string): HrOrganizationSettingUser {
  const user = objectOf(value, label)
  return {
    ...user,
    id: idOf(user.id, `${label}.id`),
    ...(user.realName === undefined ? {} : { realName: textOf(user.realName, `${label}.realName`, true) }),
    ...(user.username === undefined ? {} : { username: textOf(user.username, `${label}.username`, true) }),
    ...(user.staffId === undefined || user.staffId === null || user.staffId === '' ? { staffId: null } : { staffId: idOf(user.staffId, `${label}.staffId`) }),
  }
}

function partTimeStaffOf (value: unknown, label: string): HrOrganizationSettingPartTimeStaff {
  const row = objectOf(value, label)
  return {
    ...row,
    relationId: idOf(row.relationId, `${label}.relationId`),
    name: nullableTextOf(row.name, `${label}.name`),
    staffCode: nullableTextOf(row.staffCode, `${label}.staffCode`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    postName: nullableTextOf(row.postName, `${label}.postName`),
    status: row.status === undefined || row.status === null
      ? null
      : typeof row.status === 'string' || typeof row.status === 'number'
        ? row.status
        : (() => { throw new Error(`${label}.status必须为字符串、数字或null`) })(),
  }
}

function sensitiveInfoOf (value: unknown): { mobile?: string; isDel?: number | string } {
  if (value === undefined || value === null) return {}
  const info = objectOf(value, '敏感操作配置')
  return {
    ...(info.mobile === undefined ? {} : { mobile: textOf(info.mobile, '敏感操作手机号', true) }),
    ...(info.isDel === undefined ? {} : { isDel: typeof info.isDel === 'number' || typeof info.isDel === 'string' ? info.isDel : (() => { throw new Error('敏感操作isDel类型错误') })() }),
  }
}

/** 构造 Portal 表单实际提交的数据；update 会保留详情对象中的页面状态字段，再按页面 omit 规则删除 UI 字段。 */
export function buildHrOrganizationSettingPayload (input: HrOrganizationSettingForm, mode: 'create' | 'update'): HrOrganizationSettingPayload {
  return payloadOf(input, mode)
}

export function createHrOrganizationSettingCapability (request: PortalRequest) {
  return {
    async list (input: HrOrganizationSettingQuery = {}): Promise<PageResult<HrOrganizationSettingPageRow>> {
      const result = await request<PageResult<JsonObject>>({ url: `${ROOT}/page`, method: 'get', params: listQueryOf(input) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('组织设置分页响应缺少有效list或total')
      }
      return { list: result.list.map(rowOf), total: result.total }
    },

    async detail (id: HrOrganizationSettingId): Promise<HrOrganizationSettingDetail> {
      return detailOf(await request<unknown>({ url: `${ROOT}/${idOf(id, '组织ID')}`, method: 'get' }))
    },

    async checkHaveStandardUnit (pid: HrOrganizationSettingId): Promise<boolean> {
      const result = await request<unknown>({ url: `${ROOT}/checkHaveStandardUnit`, method: 'get', params: { pid: idOf(pid, '上级组织ID') } })
      if (typeof result !== 'boolean') throw new Error('checkHaveStandardUnit响应必须为boolean')
      return result
    },

    prepareCreate (input: HrOrganizationSettingForm): { payload: HrOrganizationSettingPayload } {
      return { payload: payloadOf(input, 'create') }
    },

    async create (input: HrOrganizationSettingForm): Promise<void> {
      await request({ url: ROOT, method: 'post', data: payloadOf(input, 'create') })
    },

    prepareUpdate (input: HrOrganizationSettingUpdateForm): { payload: HrOrganizationSettingPayload } {
      return { payload: payloadOf(input, 'update') }
    },

    async update (input: HrOrganizationSettingUpdateForm): Promise<void> {
      await request({ url: ROOT, method: 'put', data: payloadOf(input, 'update') })
    },

    async checkCanDisable (id: HrOrganizationSettingId): Promise<string | null> {
      const result = await request<unknown>({ url: `${ROOT}/checkCanDisable/${idOf(id, '组织ID')}`, method: 'post' })
      if (result === undefined || result === null || result === '') return null
      return textOf(result, '停用前检查响应', true)
    },

    async disable (input: { id: HrOrganizationSettingId; currentStatus: HrOrganizationSettingStatus }): Promise<void> {
      const id = idOf(input.id, '组织ID')
      if (statusOf(input.currentStatus, 'currentStatus') !== 1) throw new Error('只有列表当前status为1（启用）的组织才能停用')
      await request({ url: `${ROOT}/disable/${id}`, method: 'post' })
    },

    async enable (input: { id: HrOrganizationSettingId; currentStatus: HrOrganizationSettingStatus }): Promise<void> {
      const id = idOf(input.id, '组织ID')
      if (statusOf(input.currentStatus, 'currentStatus') !== 0) throw new Error('只有列表当前status为0（停用）的组织才能启用')
      await request({ url: `${ROOT}/enable/${id}`, method: 'post' })
    },

    async prepareChangeRelation (): Promise<HrOrganizationSettingSensitivePreparation> {
      const info = sensitiveInfoOf(await request<unknown>({ url: '/org/sensitive/info', method: 'get' }))
      const isEmptyState = info.mobile === undefined && info.isDel === undefined
      return {
        verificationRequired: !(isEmptyState || info.isDel === 1),
        phone: info.mobile ?? null,
        isDel: info.isDel ?? null,
      }
    },

    async sendChangeRelationCode (input: { phone: string }): Promise<{ requestId: string }> {
      const phone = textOf(input.phone, '敏感操作手机号')
      const result = objectOf(await request<unknown>({
        url: '/sys/sms/send', method: 'get', params: { phone, templateId: '17709' },
      }), '短信发送响应')
      if (result.requestId === undefined || result.requestId === null || String(result.requestId).trim() === '') {
        throw new Error('短信发送响应缺少requestId；结果不确定，不自动重发')
      }
      return { requestId: String(result.requestId) }
    },

    async verifyChangeRelationCode (input: { requestId: string; code: string }): Promise<true> {
      const requestId = textOf(input.requestId, '短信requestId')
      const code = textOf(input.code, '短信验证码')
      const result = objectOf(await request<unknown>({
        url: '/sys/sms/checkSms', method: 'get', params: { code, requestId }, sourceResponse: true,
      }), '短信校验响应')
      if (result.ret !== 'SUCCESS') throw new Error(typeof result.msg === 'string' && result.msg ? result.msg : '短信验证码校验失败')
      return true
    },

    async changeRelation (input: HrOrganizationSettingRelationInput): Promise<void> {
      const id = idOf(input.id, '被变更组织ID')
      const pid = idOf(input.pid, '目标组织ID')
      const sensitive = await this.prepareChangeRelation()
      if (sensitive.verificationRequired) {
        if (!input.verification) throw new Error('组织关系变更需要敏感验证；先发送验证码并提供requestId与code')
        await this.verifyChangeRelationCode(input.verification)
      }
      await request({ url: `${ROOT}/updateBelongRelation`, method: 'put', data: { id, pid } })
    },

    async export (input: HrOrganizationSettingQuery = {}): Promise<HrOrganizationSettingFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({
        url: `${ROOT}/export`, method: 'get', params: exportParamsOf(input), responseType: 'arraybuffer',
      })
      return downloadedFileOf(response, '组织.xlsx', 'application/vnd.ms-excel')
    },

    prepareImport (input: HrOrganizationSettingFileInput): HrOrganizationSettingFilePreview {
      return decodeImportFile(input).preview
    },

    async importFile (input: HrOrganizationSettingFileInput): Promise<string | null> {
      const { preview, bytes } = decodeImportFile(input)
      const data = new FormData()
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([arrayBuffer], { type: preview.contentType }), preview.fileName)
      const result = await request<unknown>({
        url: `${ROOT}/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (result === undefined || result === null || result === '') return null
      return textOf(result, '组织编制导入响应', true)
    },

    async downloadTemplate (input: { orgId: HrOrganizationSettingId }): Promise<HrOrganizationSettingFile> {
      const orgId = idOf(input.orgId, '模板组织ID')
      const url = await request<unknown>({ url: `${ROOT}/downloadTemplate`, method: 'get', params: { orgId } })
      const fileUrl = textOf(url, '模板下载URL')
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: fileUrl, method: 'get', responseType: 'arraybuffer' })
      return downloadedFileOf(response, fileNameFromUrl(fileUrl), XLSX_MIME)
    },

    async historyList (input: HrOrganizationSettingHistoryQuery = {}): Promise<PageResult<HrOrganizationSettingHistoryRow>> {
      const result = await request<PageResult<JsonObject>>({ url: `${HISTORY_ROOT}/page`, method: 'get', params: historyQueryOf(input) })
      if (!result || !Array.isArray(result.list) || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('组织变更记录分页响应缺少有效list或total')
      }
      return { list: result.list.map(historyRowOf), total: result.total }
    },

    async historyDetail (id: HrOrganizationSettingId): Promise<HrOrganizationSettingHistoryDetail> {
      return historyDetailOf(await request<unknown>({ url: `${HISTORY_ROOT}/${idOf(id, '变更记录ID')}`, method: 'get' }))
    },

    async partTimePosts (organizationId: HrOrganizationSettingId): Promise<HrOrganizationSettingPartTimePost[]> {
      const result = objectOf(await request<unknown>({
        url: '/hr/organization-scene/post-scene/list', method: 'get', params: { organizationId: idOf(organizationId, '组织ID') },
      }), '兼职岗位汇总')
      if (!Array.isArray(result.partTimePosts)) throw new Error('兼职岗位汇总缺少partTimePosts数组')
      return result.partTimePosts.map((item, index) => {
        const row = objectOf(item, `兼职岗位[${index}]`)
        return {
          postId: idOf(row.postId, `兼职岗位[${index}].postId`),
          postName: nullableTextOf(row.postName, `兼职岗位[${index}].postName`),
          partTimeStaffCount: nullableIntegerOf(row.partTimeStaffCount, `兼职岗位[${index}].partTimeStaffCount`),
          existNumber: nullableIntegerOf(row.existNumber, `兼职岗位[${index}].existNumber`),
        }
      })
    },

    async partTimeStaffPage (input: { organizationId: HrOrganizationSettingId; postId: HrOrganizationSettingId; keyword?: string; pageNo?: number }): Promise<PageResult<HrOrganizationSettingPartTimeStaff>> {
      const keyword = filterTextOf(input.keyword, '兼职人员关键字').trim()
      const result = pageOf<JsonObject>(await request<unknown>({
        url: '/hr/organization-scene/post-level/staff-page',
        method: 'get',
        params: {
          organizationId: idOf(input.organizationId, '组织ID'),
          postKind: 'PART_TIME',
          postId: idOf(input.postId, '兼职岗位ID'),
          keyword,
          pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'),
          pageSize: 20,
        },
      }), '兼职人员分页')
      return { list: result.list.map((item, index) => partTimeStaffOf(item, `兼职人员[${index}]`)), total: result.total }
    },

    async organizationTypes (): Promise<HrOrganizationSettingOption[]> {
      return optionListOf(await request<unknown>({ url: '/org/organizationType/selectAll', method: 'get' }), '组织类型')
    },

    async organizationProperties (): Promise<HrOrganizationSettingPropertyOption[]> {
      const result: JsonObject[] = []
      const pageSize = 200
      for (let pageNo = 1; pageNo <= 100; pageNo += 1) {
        const page = pageOf<JsonObject>(await request<unknown>({
          url: '/hr/org/organizationProperty/page', method: 'get', params: { pageNo, pageSize, status: 1 },
        }), '组织属性分页')
        result.push(...page.list)
        if (page.list.length === 0 || result.length >= page.total) break
      }
      return result.map((item, index) => ({
        label: textOf(item.name, `组织属性[${index}].name`),
        value: String(idOf(item.id, `组织属性[${index}].id`)),
      }))
    },

    async licenseCategories (): Promise<HrOrganizationSettingLicenseOption[]> {
      const result = await request<unknown>({ url: '/system/license-category/page', method: 'get' })
      if (!Array.isArray(result)) throw new Error('证照类型响应必须是数组')
      return result.map((item, index) => {
        const row = objectOf(item, `证照类型[${index}]`)
        return { label: textOf(row.name, `证照类型[${index}].name`), typeId: String(idOf(row.id, `证照类型[${index}].id`)), typeNum: null }
      })
    },

    async searchPostOptions (input: { keyword: string; pageNo?: number; pageSize?: number }): Promise<PageResult<HrOrganizationSettingPostNode>> {
      const keyword = textOf(input.keyword, '岗位关键字').trim()
      if (!keyword) throw new Error('岗位关键字不能为空；长选项必须先提供关键字')
      const result = pageOf<JsonObject>(await request<unknown>({
        url: '/org/hrpost/searchPage',
        method: 'get',
        params: {
          parentId: 0,
          keyword,
          pageNo: boundedTreePageNumberOf(input.pageNo, 1, 'pageNo'),
          pageSize: boundedTreePageNumberOf(input.pageSize, 20, 'pageSize'),
          selection: true,
          dataType: 2,
        },
      }), '岗位搜索分页')
      return { list: result.list.map((item, index) => postNodeOf(item, `岗位搜索[${index}]`)), total: result.total }
    },

    async postNodeDetails (input: { ids: HrOrganizationSettingId[] }): Promise<HrOrganizationSettingPostNode[]> {
      if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 100) throw new Error('岗位ids必须为1至100个')
      const ids = input.ids.map((id, index) => idOf(id, `岗位ids[${index}]`))
      const result = await request<unknown>({ url: '/org/hrpost/nodeDetails', method: 'post', data: { ids, selection: true } })
      if (!Array.isArray(result)) throw new Error('岗位节点详情响应必须是数组')
      return result.map((item, index) => postNodeOf(item, `岗位节点详情[${index}]`))
    },

    async searchUsers (input: { keyword: string; pageNo?: number; pageSize?: number }): Promise<PageResult<HrOrganizationSettingUser>> {
      const keyword = textOf(input.keyword, '用户关键字').trim()
      if (!keyword) throw new Error('用户关键字不能为空；人员候选必须先按关键字搜索')
      const result = pageOf<JsonObject>(await request<unknown>({
        url: '/sys/user/getUserPageInfo', method: 'get',
        params: { pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'), name: keyword },
      }), '用户分页')
      return { list: result.list.map((item, index) => userOf(item, `用户[${index}]`)), total: result.total }
    },

    async usersByIds (input: { ids: HrOrganizationSettingId[] }): Promise<HrOrganizationSettingUser[]> {
      if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 500) throw new Error('用户ids必须为1至500个')
      const ids = input.ids.map((id, index) => idOf(id, `用户ids[${index}]`))
      const result = await request<unknown>({
        url: '/sys/user/getUserListInfoByIds',
        method: 'get',
        params: { userIdList: ids },
        // platform.js supports this request-level qs option; the shared request type
        // predates the option, so keep the extra field local to this request.
        paramsArrayFormat: 'comma',
      } as Parameters<PortalRequest>[0] & { paramsArrayFormat: 'comma' })
      if (!Array.isArray(result)) throw new Error('用户选中项响应必须是数组')
      return result.map((item, index) => userOf(item, `已选用户[${index}]`))
    },

    async legalPersons (): Promise<HrOrganizationSettingLegalPerson[]> {
      const result = await request<unknown>({ url: '/org/corporation/getAllLegalPerson', method: 'get' })
      if (!Array.isArray(result)) throw new Error('法人单位响应必须是数组')
      return result.map((item, index) => {
        const row = objectOf(item, `法人单位[${index}]`)
        return {
          id: idOf(row.id, `法人单位[${index}].id`),
          name: textOf(row.name, `法人单位[${index}].name`),
          superOrganizationName: nullableTextOf(row.superOrganizationName, `法人单位[${index}].superOrganizationName`),
          mainInvest: nullableTextOf(row.mainInvest, `法人单位[${index}].mainInvest`),
        }
      })
    },

    async costCenters (): Promise<HrOrganizationSettingCostCenter[]> {
      const result = await request<unknown>({ url: '/salary/costcenter/list', method: 'get' })
      if (!Array.isArray(result)) throw new Error('成本中心响应必须是数组')
      return result.map((item, index) => {
        const row = objectOf(item, `成本中心[${index}]`)
        return { code: textOf(row.code, `成本中心[${index}].code`), name: textOf(row.name, `成本中心[${index}].name`) }
      })
    },
  }
}

export type HrOrganizationSettingCapability = ReturnType<typeof createHrOrganizationSettingCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({
  name,
  kind,
  required,
  ...(description ? { description } : {}),
})

const statusOptions = [{ label: '停用', value: 0 }, { label: '启用', value: 1 }]
const fileParams = [p('fileName', 'text', true), p('base64', 'text', true), p('contentType', 'text', false, `省略时按${XLSX_MIME}处理；Portal仅接受.xlsx`)]
const queryParams = [
  p('code', 'text', false, '组织编码包含筛选；默认空字符串'),
  p('name', 'text', false, '组织名称包含筛选；默认空字符串'),
  p('pName', 'text', false, '上级组织名称包含筛选；默认空字符串'),
  p('typeId', 'text', false, '组织类型ID；null清除筛选'),
  p('level', 'number', false, '组织层级正整数；null清除筛选'),
  { ...p('status', 'enum', false, '页面默认1启用；0停用；传null清除筛选'), options: statusOptions },
  p('pageNo', 'number', false, '从1开始；默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；默认20'),
  p('order', 'text', false, '页面默认空字符串'),
  p('orderField', 'text', false, '页面默认空字符串'),
]

export const HR_ORGANIZATION_SETTING_METHODS = {
  'hr-organization-setting-list': 'list',
  'hr-organization-setting-detail': 'detail',
  'hr-organization-setting-check-have-standard-unit': 'checkHaveStandardUnit',
  'hr-organization-setting-prepare-create': 'prepareCreate',
  'hr-organization-setting-create': 'create',
  'hr-organization-setting-prepare-update': 'prepareUpdate',
  'hr-organization-setting-update': 'update',
  'hr-organization-setting-check-can-disable': 'checkCanDisable',
  'hr-organization-setting-disable': 'disable',
  'hr-organization-setting-enable': 'enable',
  'hr-organization-setting-prepare-change-relation': 'prepareChangeRelation',
  'hr-organization-setting-send-change-relation-code': 'sendChangeRelationCode',
  'hr-organization-setting-verify-change-relation-code': 'verifyChangeRelationCode',
  'hr-organization-setting-change-relation': 'changeRelation',
  'hr-organization-setting-export': 'export',
  'hr-organization-setting-prepare-import': 'prepareImport',
  'hr-organization-setting-import': 'importFile',
  'hr-organization-setting-download-template': 'downloadTemplate',
  'hr-organization-setting-history-list': 'historyList',
  'hr-organization-setting-history-detail': 'historyDetail',
  'hr-organization-setting-part-time-posts': 'partTimePosts',
  'hr-organization-setting-part-time-staff-page': 'partTimeStaffPage',
  'hr-organization-setting-organization-types': 'organizationTypes',
  'hr-organization-setting-organization-properties': 'organizationProperties',
  'hr-organization-setting-license-categories': 'licenseCategories',
  'hr-organization-setting-search-post-options': 'searchPostOptions',
  'hr-organization-setting-post-node-details': 'postNodeDetails',
  'hr-organization-setting-search-users': 'searchUsers',
  'hr-organization-setting-users-by-ids': 'usersByIds',
  'hr-organization-setting-legal-persons': 'legalPersons',
  'hr-organization-setting-cost-centers': 'costCenters',
} as const

export const hrOrganizationSettingCapabilities: CapabilityDefinition[] = [
  { id: 'hr-organization-setting-list', title: '查询组织设置列表', write: false, params: queryParams },
  { id: 'hr-organization-setting-detail', title: '查看组织设置详情', write: false, params: [p('id', 'text', true, '组织主键ID，来自列表行')] },
  { id: 'hr-organization-setting-check-have-standard-unit', title: '校验上级组织是否存在标准化单元', write: false, params: [p('pid', 'text', true, '上级组织主键ID')] },
  { id: 'hr-organization-setting-prepare-create', title: '准备创建组织设置', write: false, params: [p('form', 'text', true, '按Portal表单规则填写的组织表单对象')] },
  { id: 'hr-organization-setting-create', title: '创建组织设置', write: true, params: [p('form', 'text', true, '按Portal表单规则填写的组织表单对象')] },
  { id: 'hr-organization-setting-prepare-update', title: '准备编辑组织设置', write: false, params: [p('form', 'text', true, '详情回显后按Portal表单规则修改的完整表单对象')] },
  { id: 'hr-organization-setting-update', title: '编辑组织设置', write: true, params: [p('form', 'text', true, '详情回显后按Portal表单规则修改的完整表单对象')] },
  { id: 'hr-organization-setting-check-can-disable', title: '检查组织是否允许停用', write: false, params: [p('id', 'text', true, '组织主键ID，来自当前列表行')] },
  { id: 'hr-organization-setting-disable', title: '停用组织', write: true, params: [p('id', 'text', true), { ...p('currentStatus', 'enum', true, '列表当前状态，必须为1'), options: statusOptions }] },
  { id: 'hr-organization-setting-enable', title: '启用组织', write: true, params: [p('id', 'text', true), { ...p('currentStatus', 'enum', true, '列表当前状态，必须为0'), options: statusOptions }] },
  { id: 'hr-organization-setting-prepare-change-relation', title: '准备变更组织隶属关系的敏感验证', write: false, params: [] },
  { id: 'hr-organization-setting-send-change-relation-code', title: '发送组织关系变更验证码', write: true, params: [p('phone', 'text', true, '仅使用准备结果中的脱敏配置手机号')] },
  { id: 'hr-organization-setting-verify-change-relation-code', title: '校验组织关系变更验证码', write: false, params: [p('requestId', 'text', true), p('code', 'text', true)] },
  { id: 'hr-organization-setting-change-relation', title: '变更组织隶属关系', write: true, params: [p('id', 'text', true, '被变更组织ID'), p('pid', 'text', true, '目标上级组织ID'), p('verification', 'text', false, '敏感配置要求验证时提供requestId与code')] },
  { id: 'hr-organization-setting-export', title: '按当前筛选条件导出组织', write: false, params: queryParams.slice(0, 6) },
  { id: 'hr-organization-setting-prepare-import', title: '校验组织岗位编制导入文件', write: false, params: fileParams },
  { id: 'hr-organization-setting-import', title: '导入组织岗位编制', write: true, params: fileParams },
  { id: 'hr-organization-setting-download-template', title: '下载组织岗位编制模板或数据', write: false, params: [p('orgId', 'text', true, '模板组织ID；必须能找到标准化单元')] },
  { id: 'hr-organization-setting-history-list', title: '查询组织变更历史', write: false, params: [p('orgName', 'text'), p('operatorName', 'text'), p('startTime', 'date'), p('endTime', 'date'), p('pageNo', 'number'), p('pageSize', 'number'), p('order', 'text'), p('orderField', 'text')] },
  { id: 'hr-organization-setting-history-detail', title: '查看组织变更历史详情', write: false, params: [p('id', 'text', true, '变更记录ID，来自历史列表行')] },
  { id: 'hr-organization-setting-part-time-posts', title: '查询组织下兼职岗位', write: false, params: [p('organizationId', 'text', true, '当前编辑组织ID')] },
  { id: 'hr-organization-setting-part-time-staff-page', title: '分页查询兼职岗位人员', write: false, params: [p('organizationId', 'text', true), p('postId', 'text', true), p('keyword', 'text'), p('pageNo', 'number')] },
  { id: 'hr-organization-setting-organization-types', title: '加载组织类型候选', write: false, params: [] },
  { id: 'hr-organization-setting-organization-properties', title: '加载启用的组织属性候选', write: false, params: [] },
  { id: 'hr-organization-setting-license-categories', title: '加载证照类型候选', write: false, params: [] },
  { id: 'hr-organization-setting-search-post-options', title: '按关键字搜索岗位候选', write: false, params: [p('keyword', 'search', true), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'hr-organization-setting-post-node-details', title: '补取已选岗位节点', write: false, params: [p('ids', 'text', true)] },
  { id: 'hr-organization-setting-search-users', title: '按关键字搜索组织负责人候选', write: false, params: [p('keyword', 'search', true), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'hr-organization-setting-users-by-ids', title: '补取已选组织负责人', write: false, params: [p('ids', 'text', true)] },
  { id: 'hr-organization-setting-legal-persons', title: '加载法人单位候选', write: false, params: [] },
  { id: 'hr-organization-setting-cost-centers', title: '加载成本中心候选', write: false, params: [] },
].map(definition => ({
  ...definition,
  pagePath: HR_ORGANIZATION_SETTING_PAGE_PATH,
  permission: HR_ORGANIZATION_SETTING_PERMISSION,
  httpInstance: 'platform',
}))
