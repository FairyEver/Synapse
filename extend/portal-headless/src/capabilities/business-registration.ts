import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult } from './meeting-room.js'

/**
 * Portal「风险防控 → 登记信息」列表、企业登记表单和变更记录页面。
 *
 * ## 人员弹窗的两个候选（本文件第二批）
 *
 * `components/add-personnel.vue` 有三个页签，其中「内部人员」与「外部人员」各打一条只读接口：
 *
 * | 页签 | 端点 | 本文件的能力 |
 * | --- | --- | --- |
 * | 内部人员 | `GET /sys/user/userNotInGrade` | `business-registration-person-candidate` |
 * | 外部人员 | `GET /study/grade/student/getExternalStudentList` | `business-registration-external-person-list` |
 * | 未注册智慧蛋鸡人员 | 无接口（纯本地输入） | — |
 *
 * ⚠️ 这两个端点在**班级管理**页里也各有一条能力（`study-grade.ts` 的
 * `study-grade-student-candidate` / `study-grade-external-student-list`）。
 * 是**两条能力**而不是一条复用的原因：能力的页面语境是契约的一部分 ——
 * 这一页是 module-type 15（风险防控）、权限 `/dashboard/certificate/enterpriseRegistration`、
 * 提交给企业登记表单；班级管理页是 module-type 12（学习管理）、权限 `/dashboard/grade/grade`、
 * 提交给班级学员。同一个 URL 在两个上下文里 `boundaries` 与 `consume` 都不一样，
 * 合并会让 AI 看到一半是错的说明。
 *
 * 「未注册智慧蛋鸡人员」页签**不进 SDK**：它在页面上就是一个输入框加一个"添加"按钮
 * （`add-personnel.vue:329` 的 `onAdd`），值只进组件的本地数组，随弹窗的 `modalEmit('ok', …)`
 * 交给父页面，不发任何请求。
 *
 * ## `userNotInGrade` 的两条实测语义（与班级管理页共享，理由见 `study-grade.ts` 文件头）
 *
 * 1. 它的 SQL 把「本班学员」子查询 `LEFT JOIN` 进来却**从没在 `WHERE`/`SELECT` 里使用**，
 *    所以它**不过滤已在班级的人**；而且本页**根本不传 `gradeId`**
 *    （`add-personnel.vue:178` 的 params 只有 name/pageNo/pageSize），
 *    连那条子查询都命中不了 —— 这个接口在本页就是一个「在职、组织非空的用户列表」。
 * 2. 它的 `name` 是 **`real_name LIKE 'kw%'`（仅前缀）**；而外部人员那条是
 *    `name LIKE %kw%` **或** `mobile LIKE %kw%`（同时匹配手机号）。两者别互相照抄。
 *
 * ## 凭据形状的字段
 *
 * `userNotInGrade` 的响应 DTO 里 `password2`（口令散列）与 `salt` 会真的被序列化
 * （`password` 上有 `@JsonProperty(WRITE_ONLY)`，不会）。SDK **裁掉这三个键**再返回，
 * 与 `study-grade.ts` 的处理一致；理由见那边文件头。
 */

/** Portal「风险防控 → 登记信息」列表、企业登记表单和变更记录页面。 */
export const BUSINESS_REGISTRATION_PAGE_PATH = '/dashboard/certificate/enterpriseRegistration/list'
export const BUSINESS_REGISTRATION_PERMISSION = '/dashboard/certificate/enterpriseRegistration'
export const BUSINESS_REGISTRATION_MODULE_TYPE = 15

/** 「内部人员」候选（`components/add-personnel.vue:178`）。platform 实例会补 `/admin-api` 前缀 */
export const BUSINESS_REGISTRATION_PERSON_CANDIDATE_PATH = '/sys/user/userNotInGrade'
/** 「外部人员」候选（`components/add-personnel.vue:258`）。与班级管理页是**同一条 URL** */
export const BUSINESS_REGISTRATION_EXTERNAL_PERSON_PATH = '/study/grade/student/getExternalStudentList'

/**
 * 人员候选的每页条数。
 *
 * 页面两张表都写死 `pageSize: 5`（`add-personnel.vue:182` 与 `:262`）。
 * 与 `study-grade.ts` 的同名常量是同一个数、同一套理由（那边文件头有完整说明）：
 * 这里是**刻意各写一份**，能力层不跨文件共享数值，改的时候两处都要看。
 */
export const PERSON_CANDIDATE_PAGE_SIZE = 5
/** 人员候选单页上限。与 `study-grade.ts` 的 `MAX_PERSON_PAGE_SIZE` 同值同理由 */
export const MAX_PERSON_PAGE_SIZE = 500

/** 响应里**必须裁掉**的三个键（`SysUserDTO` 的口令散列与盐） */
const CREDENTIAL_KEYS = ['password', 'password2', 'salt'] as const

const ROOT = '/admin-api/hr/business-registration'
const LOG_ROOT = '/admin-api/hr/business-registration-log'
const SHARE_ROOT = '/admin-api/system/share-user'
const SHARE_TYPE = 5
const DEFAULT_PAGE_SIZE = 20

export type BusinessRegistrationId = string | number
export type BusinessRegistrationType = string | number
export type BusinessRegistrationStatus = 1 | 2 | 3
export type BusinessRegistrationFlag = 0 | 1

export type BusinessRegistrationQuery = {
  name?: string | null
  type?: BusinessRegistrationType | null
  pageNo?: number
  pageSize?: number
}

export type BusinessRegistrationStaffRef = Record<string, unknown> & {
  staffCode: string | number
  staffName?: string | null
}

export type BusinessRegistrationRow = Record<string, unknown> & {
  id: BusinessRegistrationId
  name: string | null
  signNumber: string | null
  organizationId: BusinessRegistrationId | null
  type: BusinessRegistrationType | null
  status: BusinessRegistrationStatus | null
  address: string | null
  legalRepresentative: string | null
  legalRepresentativeOutside: string | null
  legalRepresentativeName: string | null
  isUnit: boolean | number | null
  registeredCapital: number | string | null
  establishmentTime: string | null
  timeBusiness: string | null
  isForever: string | number | null
  remindTime: number | null
  remindPost: string | null
  remindPostTree: string | null
  scopeBusiness: string | null
  registrationAuthority: string | null
  shareholdingStructure: string | null
  pdfName: string | null
  pdfUrl: string | null
  director: string | null
  supervisor: string | null
  admin: string | null
  log: number | null
  organizationName: string | null
  creator: BusinessRegistrationId | null
  creatorName: string | null
}

export type BusinessRegistrationDetail = Omit<BusinessRegistrationRow, 'director' | 'supervisor' | 'admin'> & {
  loginTime: string | null
  director: BusinessRegistrationStaffRef[]
  directorOutside: BusinessRegistrationStaffRef[]
  isDirectorOutside: BusinessRegistrationStaffRef[]
  supervisor: BusinessRegistrationStaffRef[]
  supervisorOutside: BusinessRegistrationStaffRef[]
  isSupervisorOutside: BusinessRegistrationStaffRef[]
  admin: BusinessRegistrationStaffRef[]
  adminOutside: BusinessRegistrationStaffRef[]
  isAdminOutside: BusinessRegistrationStaffRef[]
}

export type BusinessRegistrationForm = {
  id?: BusinessRegistrationId
  status: BusinessRegistrationStatus
  name: string
  signNumber: string
  organizationId: BusinessRegistrationId
  type: BusinessRegistrationType
  address: string
  legalRepresentative?: BusinessRegistrationId | null
  legalRepresentativeOutside?: string | null
  isUnit: boolean | BusinessRegistrationFlag
  registeredCapital?: number | null
  loginTime?: string | null
  establishmentTime: string
  isForever: BusinessRegistrationFlag
  timeBusiness?: string | null
  remindTime: number
  remindPost?: string | null
  remindPostTree?: string | null
  scopeBusiness?: string | null
  registrationAuthority: string
  shareholdingStructure?: string | null
  director: BusinessRegistrationStaffRef[]
  directorOutside: BusinessRegistrationStaffRef[]
  isDirectorOutside: BusinessRegistrationStaffRef[]
  supervisor: BusinessRegistrationStaffRef[]
  supervisorOutside: BusinessRegistrationStaffRef[]
  isSupervisorOutside: BusinessRegistrationStaffRef[]
  admin: BusinessRegistrationStaffRef[]
  adminOutside: BusinessRegistrationStaffRef[]
  isAdminOutside: BusinessRegistrationStaffRef[]
  pdfUrl: string[]
  pdfName: string[]
}

export type BusinessRegistrationPreparation = {
  draft: BusinessRegistrationForm
  previous?: BusinessRegistrationForm
}

export type BusinessRegistrationFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type BusinessRegistrationChangeEntry = Record<string, unknown> & {
  detailsRegistration: string
  beforeField?: string | number | null
  afterField?: string | number | null
  pdfName?: string | null
  pdfUrl?: string | null
  id?: BusinessRegistrationId
  isDelete?: BusinessRegistrationFlag
  businessRegistrationId: BusinessRegistrationId
}

export type BusinessRegistrationPartialUpdate = Partial<Omit<BusinessRegistrationForm, 'id'>> & Record<string, unknown>

export type BusinessRegistrationChangeDraft = {
  businessRegistrationId: BusinessRegistrationId
  dateRegistration: string
  createReqVO: BusinessRegistrationChangeEntry[]
  update: Record<string, unknown>
}

export type BusinessRegistrationChangeInput = {
  businessRegistrationId: BusinessRegistrationId
  dateRegistration: string
  entries?: Array<Omit<BusinessRegistrationChangeEntry, 'businessRegistrationId'> & { businessRegistrationId?: BusinessRegistrationId }>
  update?: BusinessRegistrationPartialUpdate | null
}

export type BusinessRegistrationChangeRecord = {
  id: BusinessRegistrationId
  businessRegistrationId: BusinessRegistrationId | null
  createTime: string | null
  pdfName: string | null
  pdfUrl: string | null
  detailsRegistration: string | null
  beforeField: string | null
  afterField: string | null
  dateRegistration: string | null
  isUpdata: number | null
}

export type BusinessRegistrationChangeRecordPage = {
  head: string[]
  headValue: BusinessRegistrationRow | null
  body: BusinessRegistrationChangeRecord[]
}

export type BusinessRegistrationShareMember = {
  id: BusinessRegistrationId
  name?: string
  managerType?: number
}

export type BusinessRegistrationShare = {
  organization: BusinessRegistrationShareMember[]
  post: BusinessRegistrationShareMember[]
  duty: BusinessRegistrationShareMember[]
  user: BusinessRegistrationShareMember[]
}

export type BusinessRegistrationShareInput = {
  resourceId: BusinessRegistrationId
  organization?: BusinessRegistrationShareMember[]
  post?: BusinessRegistrationShareMember[]
  duty?: BusinessRegistrationShareMember[]
  user?: BusinessRegistrationShareMember[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function has (value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function idOf (value: unknown, label: string): BusinessRegistrationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): BusinessRegistrationId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function boundedTextOf (value: unknown, label: string, max: number, required = false): string | null {
  const text = textOf(value, label)
  if (required && (text === null || text.trim() === '')) throw new Error(`${label}不能为空或全为空格`)
  if (text !== null && text.length > max) throw new Error(`${label}最多${max}个字符`)
  return text
}

function textOrEmptyOf (value: unknown, label: string): string {
  return textOf(value, label) ?? ''
}

function changeValueOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function finiteNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为有限数字或null`)
  return value
}

function numberOrStringOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value
  throw new Error(`${label}必须为数字、字符串或null`)
}

function flagOf (value: unknown, label: string): BusinessRegistrationFlag {
  if (value === true || value === 1 || value === '1') return 1
  if (value === false || value === 0 || value === '0') return 0
  throw new Error(`${label}只能是0、1、true或false`)
}

function booleanOf (value: unknown, label: string): boolean {
  return flagOf(value, label) === 1
}

function statusOf (value: unknown, label: string): BusinessRegistrationStatus {
  const status = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (status === 1 || status === 2 || status === 3) return status
  throw new Error(`${label}只能是1（存续）、2（注销）或3（吊销）`)
}

function typeOf (value: unknown, label: string): BusinessRegistrationType {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}不能为空`)
}

function dateOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  return result as number
}

function pageTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  return text ?? ''
}

function staffCodeOf (value: unknown, label: string): string | number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空工号或未注册人员姓名`)
}

function staffListOf (value: unknown, label: string): BusinessRegistrationStaffRef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是人员数组`)
  return value.map((item, index) => {
    const row = objectOf(item, `${label}[${index}]`)
    return {
      ...row,
      staffCode: staffCodeOf(row.staffCode, `${label}[${index}].staffCode`),
      ...(row.staffName === undefined ? {} : { staffName: textOf(row.staffName, `${label}[${index}].staffName`) }),
    }
  })
}

function urlListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (value.length > 10) throw new Error(`${label}最多10项`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') throw new Error(`${label}[${index}]必须为非空字符串`)
    return item
  })
}

function csvListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') throw new Error(`${label}必须为逗号字符串`)
  return value.split(',').filter(Boolean)
}

function joinList (value: unknown, label: string): string {
  if (Array.isArray(value)) return urlListOf(value, label).join(',')
  return textOrEmptyOf(value, label)
}

function userIdOf (value: unknown, label: string): BusinessRegistrationId {
  const id = idOf(value, label)
  if (String(id).length > 10) throw new Error(`${label}最多10个字符`)
  return id
}

function externalRepresentativeOf (value: unknown, label: string): string {
  const text = boundedTextOf(value, label, 10, true)!
  if (/^\d+$/.test(text)) throw new Error(`${label}不能为纯数字`)
  return text
}

const STAFF_KEYS = [
  'director', 'directorOutside', 'isDirectorOutside',
  'supervisor', 'supervisorOutside', 'isSupervisorOutside',
  'admin', 'adminOutside', 'isAdminOutside',
] as const

function formOf (value: unknown, label: string, requireId = false): BusinessRegistrationForm {
  const input = objectOf(value, label)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `${label}.id`)
  if (requireId && id === undefined) throw new Error(`${label}.id不能为空`)
  const status = statusOf(input.status, `${label}.status`)
  const name = boundedTextOf(input.name, `${label}.name`, 20, true)!
  const signNumber = boundedTextOf(input.signNumber, `${label}.signNumber`, 30, true)!
  const organizationId = idOf(input.organizationId, `${label}.organizationId`)
  const type = typeOf(input.type, `${label}.type`)
  const address = boundedTextOf(input.address, `${label}.address`, 200, true)!
  const isUnit = booleanOf(input.isUnit, `${label}.isUnit`)
  const legalRepresentative = isUnit ? userIdOf(input.legalRepresentative, `${label}.legalRepresentative`) : null
  const legalRepresentativeOutside = isUnit ? null : externalRepresentativeOf(input.legalRepresentativeOutside, `${label}.legalRepresentativeOutside`)
  const registeredCapital = finiteNumberOf(input.registeredCapital, `${label}.registeredCapital`)
  const loginTime = dateOf(input.loginTime, `${label}.loginTime`)
  const establishmentTime = dateOf(input.establishmentTime, `${label}.establishmentTime`, true)!
  const isForever = flagOf(input.isForever, `${label}.isForever`)
  const timeBusiness = dateOf(input.timeBusiness, `${label}.timeBusiness`)
  if (isForever === 0 && !timeBusiness) throw new Error(`${label}.timeBusiness不能为空；非永久企业必须填写营业期限`)
  const remindTime = input.remindTime
  if (!Number.isSafeInteger(remindTime) || (remindTime as number) < 1) throw new Error(`${label}.remindTime必须为正整数`)
  const registrationAuthority = boundedTextOf(input.registrationAuthority, `${label}.registrationAuthority`, 200, true)!
  const pdfUrl = urlListOf(input.pdfUrl, `${label}.pdfUrl`)
  const pdfName = urlListOf(input.pdfName, `${label}.pdfName`)
  if (pdfUrl.length !== pdfName.length) throw new Error(`${label}.pdfUrl与pdfName数量必须一致`)
  const result: BusinessRegistrationForm = {
    ...(id === undefined ? {} : { id }),
    status,
    name,
    signNumber,
    organizationId,
    type,
    address,
    legalRepresentative,
    legalRepresentativeOutside,
    isUnit,
    registeredCapital,
    loginTime,
    establishmentTime,
    isForever,
    timeBusiness,
    remindTime: remindTime as number,
    remindPost: textOf(input.remindPost, `${label}.remindPost`),
    remindPostTree: textOf(input.remindPostTree, `${label}.remindPostTree`),
    scopeBusiness: boundedTextOf(input.scopeBusiness, `${label}.scopeBusiness`, 1000),
    registrationAuthority,
    shareholdingStructure: boundedTextOf(input.shareholdingStructure, `${label}.shareholdingStructure`, 1000),
    director: staffListOf(input.director, `${label}.director`),
    directorOutside: staffListOf(input.directorOutside, `${label}.directorOutside`),
    isDirectorOutside: staffListOf(input.isDirectorOutside, `${label}.isDirectorOutside`),
    supervisor: staffListOf(input.supervisor, `${label}.supervisor`),
    supervisorOutside: staffListOf(input.supervisorOutside, `${label}.supervisorOutside`),
    isSupervisorOutside: staffListOf(input.isSupervisorOutside, `${label}.isSupervisorOutside`),
    admin: staffListOf(input.admin, `${label}.admin`),
    adminOutside: staffListOf(input.adminOutside, `${label}.adminOutside`),
    isAdminOutside: staffListOf(input.isAdminOutside, `${label}.isAdminOutside`),
    pdfUrl,
    pdfName,
  }
  return result
}

function rowOf (value: unknown, label: string): BusinessRegistrationRow {
  const row = objectOf(value, label)
  const summary = (value: unknown, field: string): string | null => value === undefined || value === null || typeof value === 'string' ? textOf(value, `${label}.${field}`) : Array.isArray(value) ? null : (() => { throw new Error(`${label}.${field}必须为字符串、数组或null`) })()
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: textOf(row.name, `${label}.name`),
    signNumber: textOf(row.signNumber, `${label}.signNumber`),
    organizationId: nullableIdOf(row.organizationId, `${label}.organizationId`),
    type: row.type === undefined || row.type === null || row.type === '' ? null : typeOf(row.type, `${label}.type`),
    status: row.status === undefined || row.status === null ? null : statusOf(row.status, `${label}.status`),
    address: textOf(row.address, `${label}.address`),
    legalRepresentative: textOf(row.legalRepresentative, `${label}.legalRepresentative`),
    legalRepresentativeOutside: textOf(row.legalRepresentativeOutside, `${label}.legalRepresentativeOutside`),
    legalRepresentativeName: textOf(row.legalRepresentativeName, `${label}.legalRepresentativeName`),
    isUnit: row.isUnit === undefined || row.isUnit === null || typeof row.isUnit === 'boolean' || typeof row.isUnit === 'number' ? (row.isUnit as boolean | number | null | undefined) ?? null : (() => { throw new Error(`${label}.isUnit必须为布尔值、数字或null`) })(),
    registeredCapital: numberOrStringOf(row.registeredCapital, `${label}.registeredCapital`),
    establishmentTime: textOf(row.establishmentTime, `${label}.establishmentTime`),
    timeBusiness: textOf(row.timeBusiness, `${label}.timeBusiness`),
    isForever: numberOrStringOf(row.isForever, `${label}.isForever`),
    remindTime: row.remindTime === undefined || row.remindTime === null ? null : finiteNumberOf(row.remindTime, `${label}.remindTime`),
    remindPost: textOf(row.remindPost, `${label}.remindPost`),
    remindPostTree: textOf(row.remindPostTree, `${label}.remindPostTree`),
    scopeBusiness: textOf(row.scopeBusiness, `${label}.scopeBusiness`),
    registrationAuthority: textOf(row.registrationAuthority, `${label}.registrationAuthority`),
    shareholdingStructure: textOf(row.shareholdingStructure, `${label}.shareholdingStructure`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    director: summary(row.director, 'director'),
    supervisor: summary(row.supervisor, 'supervisor'),
    admin: summary(row.admin, 'admin'),
    log: row.log === undefined || row.log === null ? null : finiteNumberOf(row.log, `${label}.log`),
    organizationName: textOf(row.organizationName, `${label}.organizationName`),
    creator: nullableIdOf(row.creator, `${label}.creator`),
    creatorName: textOf(row.creatorName, `${label}.creatorName`),
  }
}

function detailOf (value: unknown, label: string): BusinessRegistrationDetail {
  const row = rowOf(value, label)
  const source = objectOf(value, label)
  return {
    ...row,
    loginTime: textOf(source.loginTime, `${label}.loginTime`),
    director: staffListOf(source.director, `${label}.director`),
    directorOutside: staffListOf(source.directorOutside, `${label}.directorOutside`),
    isDirectorOutside: staffListOf(source.isDirectorOutside, `${label}.isDirectorOutside`),
    supervisor: staffListOf(source.supervisor, `${label}.supervisor`),
    supervisorOutside: staffListOf(source.supervisorOutside, `${label}.supervisorOutside`),
    isSupervisorOutside: staffListOf(source.isSupervisorOutside, `${label}.isSupervisorOutside`),
    admin: staffListOf(source.admin, `${label}.admin`),
    adminOutside: staffListOf(source.adminOutside, `${label}.adminOutside`),
    isAdminOutside: staffListOf(source.isAdminOutside, `${label}.isAdminOutside`),
  }
}

function pageOf (value: unknown): PageResult<BusinessRegistrationRow> {
  const page = objectOf(value, '企业登记分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('企业登记分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `企业登记分页[${index}]`)), total: page.total as number }
}

function formFromDetail (detail: BusinessRegistrationDetail): BusinessRegistrationForm {
  return formOf({
    ...detail,
    isUnit: flagOf(detail.isUnit, 'current.isUnit'),
    isForever: flagOf(detail.isForever, 'current.isForever'),
    organizationId: detail.organizationId === null ? null : String(detail.organizationId),
    type: detail.type === null ? null : String(detail.type),
    registeredCapital: detail.registeredCapital === null || detail.registeredCapital === '' || detail.registeredCapital === 0 ? null : Number(detail.registeredCapital),
    pdfUrl: csvListOf(detail.pdfUrl, 'current.pdfUrl'),
    pdfName: csvListOf(detail.pdfName, 'current.pdfName'),
  }, 'current', true)
}

function fullPayloadOf (value: unknown, label: string, requireId: boolean): JsonObject {
  const source = objectOf(value, label)
  const form = formOf(source, label, requireId)
  const payload: JsonObject = {
    ...(form.id === undefined ? {} : { id: form.id }),
    status: form.status,
    name: form.name,
    signNumber: form.signNumber,
    organizationId: form.organizationId,
    type: form.type,
    address: form.address,
    legalRepresentative: form.isUnit ? form.legalRepresentative : '',
    legalRepresentativeOutside: form.isUnit ? '' : form.legalRepresentativeOutside,
    isUnit: Boolean(form.isUnit),
    registeredCapital: form.registeredCapital || 0,
    establishmentTime: form.establishmentTime,
    isForever: form.isForever,
    timeBusiness: form.isForever ? '' : form.timeBusiness,
    remindTime: form.remindTime,
    remindPost: form.remindPost ?? '',
    remindPostTree: form.remindPostTree ?? '',
    scopeBusiness: form.scopeBusiness ?? '',
    registrationAuthority: form.registrationAuthority,
    shareholdingStructure: form.shareholdingStructure ?? '',
    pdfUrl: form.pdfUrl.join(','),
    pdfName: form.pdfName.join(','),
  }
  if (requireId && has(source, 'loginTime')) payload.loginTime = form.loginTime
  for (const key of STAFF_KEYS) payload[key] = form[key]
  return payload
}

function partialPayloadOf (value: unknown, label: string): JsonObject {
  const input = objectOf(value, label)
  const output: JsonObject = {}
  const putText = (key: string, max: number, required = false) => {
    if (has(input, key)) output[key] = boundedTextOf(input[key], `${label}.${key}`, max, required)
  }
  putText('name', 20, true)
  putText('signNumber', 30, true)
  putText('address', 200, true)
  putText('scopeBusiness', 1000)
  putText('registrationAuthority', 200, true)
  putText('shareholdingStructure', 1000)
  if (has(input, 'organizationId')) output.organizationId = idOf(input.organizationId, `${label}.organizationId`)
  if (has(input, 'type')) output.type = typeOf(input.type, `${label}.type`)
  if (has(input, 'status')) output.status = statusOf(input.status, `${label}.status`)
  if (has(input, 'isUnit')) {
    const isUnit = booleanOf(input.isUnit, `${label}.isUnit`)
    output.isUnit = isUnit
    output.legalRepresentative = isUnit ? userIdOf(input.legalRepresentative, `${label}.legalRepresentative`) : ''
    output.legalRepresentativeOutside = isUnit ? '' : externalRepresentativeOf(input.legalRepresentativeOutside, `${label}.legalRepresentativeOutside`)
  } else {
    if (has(input, 'legalRepresentative')) output.legalRepresentative = userIdOf(input.legalRepresentative, `${label}.legalRepresentative`)
    if (has(input, 'legalRepresentativeOutside')) output.legalRepresentativeOutside = externalRepresentativeOf(input.legalRepresentativeOutside, `${label}.legalRepresentativeOutside`)
  }
  if (has(input, 'registeredCapital')) output.registeredCapital = finiteNumberOf(input.registeredCapital, `${label}.registeredCapital`)
  if (has(input, 'loginTime')) output.loginTime = dateOf(input.loginTime, `${label}.loginTime`)
  if (has(input, 'establishmentTime')) output.establishmentTime = dateOf(input.establishmentTime, `${label}.establishmentTime`, true)
  if (has(input, 'isForever')) {
    const isForever = flagOf(input.isForever, `${label}.isForever`)
    output.isForever = isForever
    if (isForever === 0) output.timeBusiness = dateOf(input.timeBusiness, `${label}.timeBusiness`, true)
  } else if (has(input, 'timeBusiness')) {
    output.timeBusiness = dateOf(input.timeBusiness, `${label}.timeBusiness`)
  }
  if (has(input, 'remindTime')) {
    if (!Number.isSafeInteger(input.remindTime) || (input.remindTime as number) < 1) throw new Error(`${label}.remindTime必须为正整数`)
    output.remindTime = input.remindTime
  }
  for (const key of ['remindPost', 'remindPostTree'] as const) if (has(input, key)) output[key] = textOrEmptyOf(input[key], `${label}.${key}`)
  for (const key of STAFF_KEYS) if (has(input, key)) output[key] = staffListOf(input[key], `${label}.${key}`)
  if (has(input, 'pdfUrl')) output.pdfUrl = joinList(input.pdfUrl, `${label}.pdfUrl`)
  if (has(input, 'pdfName')) output.pdfName = joinList(input.pdfName, `${label}.pdfName`)
  return output
}

const CHANGE_FIELDS = new Set([
  '名称', '注册号/统一社会信用代码', '住所', '法定代表人', '注册资本', '成立日期', '营业期限',
  '经营范围', '登记机关', '董事', '监事', '关联组织', '类型', '高级管理人员', '股权结构', '附件',
])

function changeEntryOf (value: unknown, businessRegistrationId: BusinessRegistrationId, index: number): BusinessRegistrationChangeEntry {
  const input = objectOf(value, `entries[${index}]`)
  const detailsRegistration = textOf(input.detailsRegistration, `entries[${index}].detailsRegistration`)
  if (!detailsRegistration || !CHANGE_FIELDS.has(detailsRegistration)) throw new Error(`entries[${index}].detailsRegistration不是页面支持的变更字段`)
  const id = input.id === undefined || input.id === null || input.id === '' ? undefined : idOf(input.id, `entries[${index}].id`)
  const isDelete = input.isDelete === undefined ? 0 : flagOf(input.isDelete, `entries[${index}].isDelete`)
  if (isDelete === 1 && id === undefined) throw new Error(`entries[${index}].isDelete=1时必须提供id`)
  const result: BusinessRegistrationChangeEntry = {
    ...input,
    businessRegistrationId,
    detailsRegistration,
    ...(id === undefined ? {} : { id }),
    ...(isDelete === 0 ? {} : { isDelete }),
  }
  if (detailsRegistration === '附件') {
    result.pdfUrl = joinList(input.pdfUrl, `entries[${index}].pdfUrl`)
    result.pdfName = joinList(input.pdfName, `entries[${index}].pdfName`)
  } else {
    const beforeField = changeValueOf(input.beforeField, `entries[${index}].beforeField`)
    const afterField = changeValueOf(input.afterField, `entries[${index}].afterField`)
    if (isDelete === 0 && beforeField === afterField) throw new Error(`entries[${index}]变更前后不能相同`)
    result.beforeField = beforeField
    result.afterField = afterField
  }
  return result
}

function changeDraftOf (value: unknown, label: string): BusinessRegistrationChangeDraft {
  const input = objectOf(value, label)
  const businessRegistrationId = idOf(input.businessRegistrationId, `${label}.businessRegistrationId`)
  const dateRegistration = dateOf(input.dateRegistration, `${label}.dateRegistration`, true)!
  if (!Array.isArray(input.createReqVO)) throw new Error(`${label}.createReqVO必须是数组`)
  const createReqVO = input.createReqVO.map((entry, index) => changeEntryOf(entry, businessRegistrationId, index))
  const update = objectOf(input.update ?? {}, `${label}.update`)
  if (createReqVO.length === 0 && Object.keys(update).length === 0) throw new Error('变更草稿至少要有一条变更记录或一个企业字段更新')
  return { businessRegistrationId, dateRegistration, createReqVO, update }
}

function changeRecordOf (value: unknown, label: string): BusinessRegistrationChangeRecord {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    businessRegistrationId: nullableIdOf(row.businessRegistrationId, `${label}.businessRegistrationId`),
    createTime: textOf(row.createTime, `${label}.createTime`),
    pdfName: textOf(row.pdfName, `${label}.pdfName`),
    pdfUrl: textOf(row.pdfUrl, `${label}.pdfUrl`),
    detailsRegistration: textOf(row.detailsRegistration, `${label}.detailsRegistration`),
    beforeField: textOf(row.beforeField, `${label}.beforeField`),
    afterField: textOf(row.afterField, `${label}.afterField`),
    dateRegistration: textOf(row.dateRegistration, `${label}.dateRegistration`),
    isUpdata: row.isUpdata === undefined || row.isUpdata === null ? null : finiteNumberOf(row.isUpdata, `${label}.isUpdata`),
  }
}

function changePageOf (value: unknown): BusinessRegistrationChangeRecordPage {
  const result = objectOf(value, '企业登记变更记录响应')
  if (!Array.isArray(result.head) || result.head.some(item => typeof item !== 'string')) throw new Error('企业登记变更记录响应.head必须是字符串数组')
  const headValue = result.headValue === undefined || result.headValue === null ? null : rowOf(result.headValue, '企业登记变更记录响应.headValue')
  if (!Array.isArray(result.body)) throw new Error('企业登记变更记录响应.body必须是数组')
  return { head: result.head as string[], headValue, body: result.body.map((item, index) => changeRecordOf(item, `企业登记变更记录响应.body[${index}]`)) }
}

function shareMemberOf (value: unknown, label: string): BusinessRegistrationShareMember {
  const row = objectOf(value, label)
  return {
    id: idOf(row.id, `${label}.id`),
    ...(row.name === undefined ? {} : { name: textOf(row.name, `${label}.name`) ?? '' }),
    ...(row.managerType === undefined ? {} : { managerType: finiteNumberOf(row.managerType, `${label}.managerType`) ?? 1 }),
  }
}

function shareOf (value: unknown): BusinessRegistrationShare {
  const row = objectOf(value, '企业登记共享响应')
  const list = (key: string): BusinessRegistrationShareMember[] => Array.isArray(row[key]) ? row[key].map((item, index) => shareMemberOf(item, `${key}[${index}]`)) : []
  return { organization: list('organization'), post: list('post'), duty: list('duty'), user: list('user') }
}

function shareMembersOf (value: unknown, label: string): JsonObject[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => ({ id: shareMemberOf(item, `${label}[${index}]`).id }))
}

function sharePayloadOf (value: unknown): JsonObject {
  const input = objectOf(value, '企业登记共享参数') as BusinessRegistrationShareInput
  return {
    type: SHARE_TYPE,
    resourceId: idOf(input.resourceId, 'resourceId'),
    organizationIds: shareMembersOf(input.organization, 'organization'),
    postIds: shareMembersOf(input.post, 'post'),
    dutyIds: shareMembersOf(input.duty, 'duty'),
    userIds: shareMembersOf(input.user, 'user'),
  }
}

function fileOf (response: AxiosResponse<ArrayBuffer>): BusinessRegistrationFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('企业登记导出响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  // Portal deliberately overrides the Java header (企业登记.xls) with its own
  // download name (企业登记.xlsx); keep the SDK result aligned with the page.
  return { fileName: '企业登记.xlsx', contentType: typeof contentType === 'string' && contentType ? contentType : null, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'), byteLength: bytes.byteLength }
}

function listParamsOf (query: BusinessRegistrationQuery = {}): JsonObject {
  const type = query.type === undefined || query.type === null ? '' : typeOf(query.type, 'type')
  return {
    order: '',
    orderField: '',
    name: pageTextOf(query.name, 'name'),
    type,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
  }
}

function exportParamsOf (query: BusinessRegistrationQuery = {}): JsonObject {
  const type = query.type === undefined || query.type === null ? '' : typeOf(query.type, 'type')
  return { name: pageTextOf(query.name, 'name'), type }
}

/**
 * 「内部人员」候选行（`SysUserDTO` 的裁剪结果）。
 *
 * 本页表格只显示三列：姓名（`realName`）、工号（`username`）、组织路径（`organizationName`），
 * 与班级管理页的同一张表同形。`organizationName` 在这一条**有值** ——
 * `userNotInGrade` 的 SQL 里写了 `hro.full_path as organizationName`，
 * 而 `getUserListPage` 那条走实体查询，没有这一列。
 */
export type BusinessRegistrationPersonCandidateRow = Record<string, unknown> & {
  id?: BusinessRegistrationId
  /** 工号（`hr_sys_user.username`），不是用户 ID */
  username?: string | null
  /** 姓名 */
  realName?: string | null
  mobile?: string | null
  organizationId?: BusinessRegistrationId | null
  /** 组织全路径 */
  organizationName?: string | null
  status?: number | null
}

/**
 * 「外部人员」候选行（`hr_study_student`）。
 *
 * `organizationId` / `organizationName` 在这条响应里**恒为空**（SQL 的 select 列表里没有这两列）。
 * 页面表格只显示姓名与手机号。
 */
export type BusinessRegistrationExternalPersonRow = Record<string, unknown> & {
  id?: BusinessRegistrationId
  /** 外部人员工号 */
  staffCode?: BusinessRegistrationId | null
  name?: string | null
  /** 手机号；服务端 DTO 里是 Long，JSON 里是数字 */
  mobile?: BusinessRegistrationId | null
  isRelatedClass?: number | null
  isRelatedLayer?: number | null
  isCreateManually?: number | null
  createTime?: string | null
}

/**
 * 人员候选的必填关键字。
 *
 * **SDK 侧策略，不是后端要求**：两个端点在无关键字时都会返回 200，但那是一次全量人员拉取
 * （conventions 第 11 条 / D6 / H35）。与 `base-shell.searchUsers()`、`study-grade.ts`
 * 的人员候选同一条规则。
 */
function candidateKeywordOf (value: unknown, label: string): string {
  const keyword = typeof value === 'string' ? value.trim() : ''
  if (keyword === '') {
    throw new Error(
      `${label}属于长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。` +
        '后端在无关键字时不会报错，返回的是全部人员。用户说不出完整名字时，先问他名字里的一两个字。',
    )
  }
  return keyword
}

/** 页码：正整数，默认 1 */
function candidatePageNoOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 1
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label}必须为正整数`)
  }
  return value
}

/** 每页条数：默认 5（页面值），拒绝 ≤0（`-1` 是全量拉取）与超过上限 */
function candidatePageSizeOf (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return PERSON_CANDIDATE_PAGE_SIZE
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  if (value < 1) throw new Error(`${label}必须 ≥ 1；-1 或 0 是"全量拉取"，SDK 不接受（设计 D6）`)
  if (value > MAX_PERSON_PAGE_SIZE) throw new Error(`${label}最多 ${MAX_PERSON_PAGE_SIZE}（本接口单页上限）`)
  return value
}

/** 按页面的键序拼人员候选参数：`name` 在前时与 `add-personnel.vue` 的 params 字面顺序一致 */
function candidateParamsOf (
  order: readonly string[],
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const name of order) {
    if (query[name] !== undefined) params[name] = query[name]
  }
  return params
}

/** 裁掉 `SysUserDTO` 上的口令散列与盐（文件头） */
function withoutCredentials<T extends Record<string, unknown>> (row: T): T {
  const copy = { ...row }
  for (const key of CREDENTIAL_KEYS) delete copy[key]
  return copy
}

function personCandidatePageOf (value: unknown): PageResult<BusinessRegistrationPersonCandidateRow> {
  const page = objectOf(value, '内部人员候选分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total)) {
    throw new Error('内部人员候选分页响应缺少有效 list 或 total')
  }
  return {
    list: page.list.map((row, index) => withoutCredentials(objectOf(row, `内部人员候选[${index}]`)) as BusinessRegistrationPersonCandidateRow),
    total: page.total as number,
  }
}

function externalPersonPageOf (value: unknown): PageResult<BusinessRegistrationExternalPersonRow> {
  const page = objectOf(value, '外部人员候选分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total)) {
    throw new Error('外部人员候选分页响应缺少有效 list 或 total')
  }
  return { list: page.list as BusinessRegistrationExternalPersonRow[], total: page.total as number }
}

export function createBusinessRegistrationCapability (request: PortalRequest) {
  return {
    async list (query: BusinessRegistrationQuery = {}): Promise<PageResult<BusinessRegistrationRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: listParamsOf(query) }))
    },
    async get (input: { id: BusinessRegistrationId }): Promise<BusinessRegistrationDetail> {
      const id = idOf(input?.id, '企业登记ID')
      return detailOf(await request({ url: `${ROOT}/get`, method: 'get', params: { id } }), '企业登记详情')
    },
    async export (query: BusinessRegistrationQuery = {}): Promise<BusinessRegistrationFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/export-excel`, method: 'get', params: exportParamsOf(query), responseType: 'arraybuffer' }))
    },
    prepareCreate (input: BusinessRegistrationForm): BusinessRegistrationPreparation {
      return { draft: formOf(input, 'form') }
    },
    async create (input: { draft: BusinessRegistrationForm }): Promise<BusinessRegistrationId> {
      return idOf(await request({ url: `${ROOT}/create`, method: 'post', data: fullPayloadOf(input?.draft, 'draft', false) }), '新建企业登记响应')
    },
    prepareUpdate (input: { current: BusinessRegistrationDetail; changes?: Partial<BusinessRegistrationForm> | null }): BusinessRegistrationPreparation {
      const current = formFromDetail(input?.current)
      return { draft: formOf({ ...current, ...(input?.changes ?? {}) }, 'draft', true), previous: current }
    },
    async update (input: { draft: BusinessRegistrationForm }): Promise<true> {
      const result = await request({ url: `${ROOT}/updateALL`, method: 'put', data: fullPayloadOf(input?.draft, 'draft', true) })
      if (result !== true) throw new Error('更新企业登记响应不是true')
      return true
    },
    async remove (input: { id: BusinessRegistrationId }): Promise<true> {
      const id = idOf(input?.id, '企业登记ID')
      const result = await request({ url: `${ROOT}/delete`, method: 'delete', params: { id } })
      if (result !== true) throw new Error('删除企业登记响应不是true')
      return true
    },
    prepareChange (input: BusinessRegistrationChangeInput): { draft: BusinessRegistrationChangeDraft } {
      const businessRegistrationId = idOf(input?.businessRegistrationId, 'businessRegistrationId')
      const dateRegistration = dateOf(input?.dateRegistration, 'dateRegistration', true)!
      const entries = (input?.entries ?? []).map((entry, index) => changeEntryOf(entry, businessRegistrationId, index))
      const update = partialPayloadOf(input?.update ?? {}, 'update')
      if (entries.length === 0 && Object.keys(update).length === 0) throw new Error('变更至少要有一条变更记录或一个企业字段更新')
      return { draft: { businessRegistrationId, dateRegistration, createReqVO: entries, update } }
    },
    async submitChange (input: { draft: BusinessRegistrationChangeDraft }): Promise<true> {
      const draft = changeDraftOf(input?.draft, 'draft')
      if (draft.createReqVO.length > 0) await request({ url: `${LOG_ROOT}/createBatch`, method: 'post', data: { dateRegistration: draft.dateRegistration, createReqVO: draft.createReqVO } })
      if (Object.keys(draft.update).length > 0) await request({ url: `${ROOT}/update`, method: 'put', data: { id: draft.businessRegistrationId, ...draft.update } })
      return true
    },
    async getChangeRecord (input: { id: BusinessRegistrationId }): Promise<BusinessRegistrationChangeRecordPage> {
      const id = idOf(input?.id, '企业登记ID')
      return changePageOf(await request({ url: `${LOG_ROOT}/get`, method: 'get', params: { id } }))
    },
    async removeChangeRecord (input: { ids: BusinessRegistrationId[] }): Promise<true> {
      if (!Array.isArray(input?.ids) || input.ids.length === 0) throw new Error('ids必须是非空ID数组')
      const ids = input.ids.map((id, index) => idOf(id, `ids[${index}]`))
      const result = await request({ url: `${LOG_ROOT}/delete`, method: 'delete', data: ids })
      if (result !== null && result !== undefined) throw new Error('删除企业登记变更记录响应不是空回执')
      return true
    },
    async getShare (input: { resourceId: BusinessRegistrationId }): Promise<BusinessRegistrationShare> {
      const resourceId = idOf(input?.resourceId, 'resourceId')
      return shareOf(await request({ url: `${SHARE_ROOT}/getShare`, method: 'get', params: { type: SHARE_TYPE, resourceId } }))
    },
    async saveShare (input: BusinessRegistrationShareInput): Promise<true> {
      const result = await request({ url: `${SHARE_ROOT}/createShare`, method: 'post', data: sharePayloadOf(input) })
      if (result !== true) throw new Error('保存企业登记共享响应不是true')
      return true
    },

    /**
     * 「内部人员」候选。只读。
     *
     * 页面发的是 `{ name, pageNo, pageSize }`（`add-personnel.vue:178`）—— **没有 `gradeId`**，
     * 与班级管理页的同名调用不同。后端把 `name` 当**前缀**匹配（`real_name LIKE 'kw%'`）。
     */
    async searchPersonCandidates (query: {
      keyword: string
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<BusinessRegistrationPersonCandidateRow>> {
      const keyword = candidateKeywordOf(query?.keyword, '内部人员候选')
      const payload = await request<unknown>({
        url: BUSINESS_REGISTRATION_PERSON_CANDIDATE_PATH,
        method: 'get',
        params: candidateParamsOf(['name', 'pageNo', 'pageSize'], {
          name: keyword,
          pageNo: candidatePageNoOf(query?.pageNo, '内部人员候选 pageNo'),
          pageSize: candidatePageSizeOf(query?.pageSize, '内部人员候选 pageSize'),
        }),
      })
      return personCandidatePageOf(payload)
    },

    /**
     * 「外部人员」候选。只读。
     *
     * 与班级管理页发的是**同一形状**的请求（`{ name, pageNo, pageSize }`）；
     * 服务端固定按外部人员过滤，`name` 同时匹配姓名与手机号（都是包含匹配）。
     */
    async listExternalPersons (query: {
      keyword: string
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<BusinessRegistrationExternalPersonRow>> {
      const keyword = candidateKeywordOf(query?.keyword, '外部人员候选')
      const payload = await request<unknown>({
        url: BUSINESS_REGISTRATION_EXTERNAL_PERSON_PATH,
        method: 'get',
        params: candidateParamsOf(['name', 'pageNo', 'pageSize'], {
          name: keyword,
          pageNo: candidatePageNoOf(query?.pageNo, '外部人员候选 pageNo'),
          pageSize: candidatePageSizeOf(query?.pageSize, '外部人员候选 pageSize'),
        }),
      })
      return externalPersonPageOf(payload)
    },
  }
}

export type BusinessRegistrationCapability = ReturnType<typeof createBusinessRegistrationCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const BUSINESS_REGISTRATION_METHODS = {
  'business-registration-list': 'list',
  'business-registration-get': 'get',
  'business-registration-export': 'export',
  'business-registration-prepare-create': 'prepareCreate',
  'business-registration-create': 'create',
  'business-registration-prepare-update': 'prepareUpdate',
  'business-registration-update': 'update',
  'business-registration-remove': 'remove',
  'business-registration-prepare-change': 'prepareChange',
  'business-registration-submit-change': 'submitChange',
  'business-registration-get-change-record': 'getChangeRecord',
  'business-registration-remove-change-record': 'removeChangeRecord',
  'business-registration-get-share': 'getShare',
  'business-registration-save-share': 'saveShare',
  'business-registration-person-candidate': 'searchPersonCandidates',
  'business-registration-external-person-list': 'listExternalPersons',
} as const

const CANDIDATE_KEYWORD_PARAM = p(
  'keyword',
  'text',
  true,
  '人员姓名关键字（内部人员按 `real_name` 前缀匹配、外部人员同时匹配姓名与手机号）。' +
    '**必填**：人员候选是几千条量级，无关键字时后端照样返回 200 但那是全量拉取（conventions 第 11 条 / D6）。' +
    'SDK 侧拒绝无关键字调用；用户说不出完整名字时先问他名字里的一两个字',
)

const CANDIDATE_PAGE_PARAMS: ParamSpec[] = [
  p('pageNo', 'number', false, '页码，从 1 开始；默认 1'),
  p('pageSize', 'number', false, `每页条数；默认 ${PERSON_CANDIDATE_PAGE_SIZE}（与页面一致），上限 ${MAX_PERSON_PAGE_SIZE}`),
]

/** 人员弹窗的两个候选：与班级管理页是同 URL、不同页面语境（见文件头） */
const PERSON_CANDIDATE_META = {
  pagePath: BUSINESS_REGISTRATION_PAGE_PATH,
  permission: BUSINESS_REGISTRATION_PERMISSION,
  moduleType: BUSINESS_REGISTRATION_MODULE_TYPE,
  httpInstance: 'platform',
} as const

export const businessRegistrationCapabilities: CapabilityDefinition[] = [
  { id: 'business-registration-list', title: '查询登记信息列表', write: false, params: [p('name', 'text', false, '企业名称筛选；默认空字符串'), p('type', 'enum', false, '企业类型字典值；按 Portal 原值提交，默认空字符串'), p('pageNo', 'number', false, '页码；默认1'), p('pageSize', 'number', false, `每页条数；默认${DEFAULT_PAGE_SIZE}`)] },
  { id: 'business-registration-get', title: '读取登记信息详情', write: false, params: [p('id', 'number', true, '企业登记ID')] },
  { id: 'business-registration-export', title: '导出登记信息Excel', write: false, params: [p('name', 'text', false, '企业名称筛选'), p('type', 'enum', false, '企业类型字典值；按 Portal 原值提交')] },
  { id: 'business-registration-prepare-create', title: '准备新建登记信息', write: false, params: [p('form', 'text', true, 'Portal 企业登记表单')] },
  { id: 'business-registration-create', title: '新建登记信息', write: true, params: [p('draft', 'text', true, 'prepareCreate 返回的完整草稿')] },
  { id: 'business-registration-prepare-update', title: '准备编辑登记信息', write: false, params: [p('current', 'text', true, 'get 返回的最新详情'), p('changes', 'text', false, '用户明确修改的表单字段')] },
  { id: 'business-registration-update', title: '保存登记信息', write: true, params: [p('draft', 'text', true, 'prepareUpdate 返回的完整草稿')] },
  { id: 'business-registration-remove', title: '删除登记信息', write: true, params: [p('id', 'number', true, '企业登记ID')] },
  { id: 'business-registration-prepare-change', title: '准备登记信息变更', write: false, params: [p('businessRegistrationId', 'number', true, '企业登记ID'), p('dateRegistration', 'date', true, '变更日期'), p('entries', 'text', false, '页面允许的变更记录数组'), p('update', 'text', false, '页面同步更新的企业字段')] },
  { id: 'business-registration-submit-change', title: '提交登记信息变更', write: true, params: [p('draft', 'text', true, 'prepareChange 返回的草稿')] },
  { id: 'business-registration-get-change-record', title: '读取登记信息变更记录', write: false, params: [p('id', 'number', true, '企业登记ID')] },
  { id: 'business-registration-remove-change-record', title: '删除登记信息变更记录', write: true, params: [p('ids', 'text', true, '同一变更批次的记录ID数组')] },
  { id: 'business-registration-get-share', title: '读取登记信息共享设置', write: false, params: [p('resourceId', 'number', true, '企业登记ID')] },
  { id: 'business-registration-save-share', title: '保存登记信息共享设置', write: true, params: [p('resourceId', 'number', true, '企业登记ID'), p('organization', 'text', false, '共享组织成员数组'), p('post', 'text', false, '共享岗位成员数组'), p('duty', 'text', false, '共享职务成员数组'), p('user', 'text', false, '共享人员成员数组')] },
  // 人员弹窗的两个候选。**刻意与班级管理页各建一条能力**（同 URL、不同页面语境）：见文件头
  { id: 'business-registration-person-candidate', title: '查询登记信息的内部人员候选', ...PERSON_CANDIDATE_META, write: false, params: [CANDIDATE_KEYWORD_PARAM, ...CANDIDATE_PAGE_PARAMS] },
  { id: 'business-registration-external-person-list', title: '查询登记信息的外部人员候选', ...PERSON_CANDIDATE_META, write: false, params: [CANDIDATE_KEYWORD_PARAM, ...CANDIDATE_PAGE_PARAMS] },
].map(definition => ({ ...definition, pagePath: BUSINESS_REGISTRATION_PAGE_PATH, permission: BUSINESS_REGISTRATION_PERMISSION, moduleType: BUSINESS_REGISTRATION_MODULE_TYPE, httpInstance: 'platform' }))
