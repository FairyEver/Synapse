import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 内部员工」列表及其当前页面可达的表单、导入、历史和敏感删除动作。 */
export const HR_INTERNAL_STAFF_PAGE_PATH = '/dashboard/staff/staff-list/list'
export const HR_INTERNAL_STAFF_PERMISSION = '/dashboard/staff/staff-list'
export const HR_INTERNAL_STAFF_MODULE_TYPE = 11

const ROOT = '/org/staff'
const SENSITIVE_ROOT = '/org/sensitive/info'
const SMS_SEND_ROOT = '/sys/sms/send'
const SMS_CHECK_ROOT = '/sys/sms/checkSms'
const SMS_TEMPLATE_ID = '17709'
const CUSTOM_INFO_TABLE = 'hr_staff'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'

export type HrInternalStaffId = string | number
export type HrInternalStaffDate = string | number | null
export type HrInternalStaffScalar = string | number | null

export type HrInternalStaffQuery = {
  staffName?: string | null
  staffCode?: string | number | null
  postName?: string | null
  status?: string | number | null
  orgId?: HrInternalStaffId | '' | null
  mobile?: string | number | null
  sqlParam?: string | null
  pageNo?: number
  pageSize?: number
}

export type HrInternalStaffListRow = Record<string, unknown> & {
  id: HrInternalStaffId
  name: string | null
  staffCode: HrInternalStaffScalar
  status: number | null
  organization: HrInternalStaffId | null
  organizationName: string | null
  postName: string | null
  mobile: HrInternalStaffScalar
  fullPath: string | null
}

export type HrInternalStaffDetail = Record<string, unknown> & { id: HrInternalStaffId }
export type HrInternalStaffForm = Record<string, unknown>

export type HrInternalStaffFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type HrInternalStaffFilePreview = {
  fileName: string
  contentType: string
  byteLength: number
}

export type HrInternalStaffFile = HrInternalStaffFilePreview & { base64: string }

export type HrInternalStaffHistoryQuery = {
  staffId?: HrInternalStaffId | '' | null
  operatorName?: string | null
  startTime?: string | null
  endTime?: string | null
  pageNo?: number
  pageSize?: number
}

export type HrInternalStaffDeleteInput = {
  ids: HrInternalStaffId[]
  records?: Array<{ id: HrInternalStaffId; status?: number | string | null }>
  smsRequestId?: string
  code?: string
}

export type HrInternalStaffDeletePreparation = {
  ids: HrInternalStaffId[]
  verificationRequired: boolean
  phone: string | null
}

type JsonObject = Record<string, unknown>

const FORM_FIELDS = [
  'name', 'staffCode', 'idType', 'idCard', 'sex', 'birthday', 'age', 'nation', 'householdType',
  'nativePlace', 'communistTime', 'politicalOutlook', 'maritalStatus', 'healthCondition',
  'healthConditionProve', 'organization', 'otherOrganizationList', 'post', 'postTypeName',
  'otherPosts', 'salaryLevel', 'salaryStructure', 'leader', 'employmentType', 'status',
  'downtimePay', 'staffStatus', 'entryTime', 'seniorityBeforeEntry', 'entrySeniority',
  'totalSeniority', 'isReEmploy', 'insurancePaymentAddress', 'cardIssuingBank', 'bankAccount',
  'insuranceCost', 'fundCost', 'salaryCost', 'insureArea', 'isFile', 'havingOnlyChildMoney',
  'mobile', 'email', 'childNumber', 'address', 'residenceAddress', 'emergencyContact',
  'relationship', 'emergencyMobile', 'remark', 'education', 'academicDegree', 'isFullTime',
  'isUnifiedRecruitment', 'enrollmentDate', 'graduationTime', 'university', 'speciality',
  'havingRentalSubsidies', 'rentalFile', 'workList', 'educationalList', 'familyList',
  'professionalList', 'positionalList', 'contractList', 'postTransferList', 'rewardPunishmentList',
  'staffDuties',
] as const

const POST_TRANSFER_SUBMIT_FIELDS = [
  'id', 'staffId', 'transferType', 'transferTime', 'beforeOrganizationId', 'beforeOrganizationName',
  'beforePostId', 'beforePostName', 'beforeSalaryLevelId', 'beforeLeaderUserId', 'beforeLeaderUserName',
  'afterOrganizationId', 'afterOrganizationName', 'afterPostId', 'afterPostName', 'afterSalaryLevelId',
  'afterLeaderUserId', 'afterLeaderUserName', 'sourceType', 'processInstanceId',
] as const

const DEFAULT_FORM: HrInternalStaffForm = {
  name: '', staffCode: '', idType: '', idCard: '', sex: '', birthday: null, age: '', nation: '',
  householdType: '', nativePlace: '', communistTime: null, politicalOutlook: '', maritalStatus: '',
  healthCondition: '', healthConditionProve: '', organization: null, otherOrganizationList: [], post: '',
  postTypeName: '', otherPosts: [], salaryLevel: '', salaryStructure: '', leader: '', employmentType: '',
  status: '', downtimePay: null, staffStatus: '', entryTime: '', seniorityBeforeEntry: '', entrySeniority: '',
  totalSeniority: '', isReEmploy: '', insurancePaymentAddress: '', cardIssuingBank: '', bankAccount: '',
  insuranceCost: '', fundCost: '', salaryCost: '', insureArea: '', isFile: '', havingOnlyChildMoney: '',
  mobile: '', email: '', childNumber: '', address: '', residenceAddress: '', emergencyContact: '',
  relationship: '', emergencyMobile: '', remark: '', education: '', academicDegree: '', isFullTime: '',
  isUnifiedRecruitment: '', enrollmentDate: null, graduationTime: null, university: '', speciality: '',
  havingRentalSubsidies: '', rentalFile: '', workList: [], educationalList: [], familyList: [],
  professionalList: [], positionalList: [], contractList: [], postTransferList: [], rewardPunishmentList: [],
  staffDuties: ['1'],
}

const formFieldSet = new Set<string>(FORM_FIELDS)

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HrInternalStaffId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): HrInternalStaffId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function scalarOf (value: unknown, label: string): HrInternalStaffScalar {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function dateFormOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return value === '' ? '' : null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD HH:mm:ss`)
  return value
}

function dateOnlyFormOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return value === '' ? '' : null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (value.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return value
}

function requiredNonSpaceTextOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  return value
}

function requiredValueOf (value: unknown, label: string): string | number {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为非空字符串或有限数字`)
}

function optionalTextOf (value: unknown, label: string, maxLength?: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  if (value !== '' && value.trim() === '') throw new Error(`${label}不能全为空格`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return value
}

function requiredChoiceOf (value: unknown, label: string): number | string {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为整数或非空字符串`)
}

function choiceOf (value: unknown, label: string): number | string | null {
  if (value === undefined || value === null || value === '') return value === '' ? '' : null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为整数、字符串或null`)
}

function mobileOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') throw new Error('联系方式不能为空')
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('联系方式必须为字符串或数字')
  if (String(value).trim() === '') throw new Error('联系方式不能全为空格')
  return value
}

function idCardOf (value: unknown): string {
  const result = requiredTextOf(value, '证件号码', 20)
  if (!/^[0-9a-zA-Z]+$/.test(result)) throw new Error('证件号码只能输入数字和字母')
  return result
}

function textListOf (value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || (!allowEmpty && item.trim() === '')) throw new Error(`${label}[${index}]必须是非空字符串`)
    return item
  })
}

function idListOf (value: unknown, label: string): HrInternalStaffId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function otherOrganizationListOf (value: unknown, label: string): JsonObject[] {
  const items = listOf(value, label)
  return items.map((item, index) => ({
    ...item,
    organizationId: nullableIdOf(item.organizationId, `${label}[${index}].organizationId`),
    postIdList: item.postIdList === undefined || item.postIdList === null ? [] : idListOf(item.postIdList, `${label}[${index}].postIdList`),
  }))
}

function listOf (value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((item, index) => objectOf(item, `${label}[${index}]`))
}

function stripUiListKeys (items: unknown, label: string): JsonObject[] {
  return listOf(items, label).map(item => {
    const { _key: _ignored, ...wire } = item
    return wire
  })
}

function normalizeRewardAmount (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label}必须为数字、数字字符串或null`)
  const result = String(value)
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(result.trim())) throw new Error(`${label}必须是0至99999999.99且最多两位小数`)
  return result
}

function validateNestedText (item: JsonObject, key: string, label: string, maxLength: number, required = false): void {
  if (!Object.prototype.hasOwnProperty.call(item, key)) return
  if (required) requiredTextOf(item[key], `${label}.${key}`, maxLength)
  else optionalTextOf(item[key], `${label}.${key}`, maxLength)
}

function validateNestedLists (raw: JsonObject, label: string): void {
  const workList = raw.workList === undefined ? [] : listOf(raw.workList, `${label}.workList`)
  for (const [index, item] of workList.entries()) {
    const itemLabel = `${label}.workList[${index}]`
    for (const [key, max] of [['companyName', 50], ['department', 50], ['duties', 50], ['salaryRange', 50], ['description', 200], ['leaveReason', 200]] as const) validateNestedText(item, key, itemLabel, max)
  }
  const educationalList = raw.educationalList === undefined ? [] : listOf(raw.educationalList, `${label}.educationalList`)
  for (const [index, item] of educationalList.entries()) {
    const itemLabel = `${label}.educationalList[${index}]`
    for (const [key, max, required] of ([['school', 50, true], ['speciality', 50, true], ['educationalSystem', 50, false], ['learningStyle', 50, false]] as const)) validateNestedText(item, key, itemLabel, max, required)
  }
  const familyList = raw.familyList === undefined ? [] : listOf(raw.familyList, `${label}.familyList`)
  for (const [index, item] of familyList.entries()) {
    const itemLabel = `${label}.familyList[${index}]`
    for (const [key, max] of [['name', 10], ['duties', 50], ['mobile', 15], ['unit', 50], ['education', 50], ['remark', 200]] as const) validateNestedText(item, key, itemLabel, max)
  }
  const professionalList = raw.professionalList === undefined ? [] : listOf(raw.professionalList, `${label}.professionalList`)
  for (const [index, item] of professionalList.entries()) {
    const itemLabel = `${label}.professionalList[${index}]`
    for (const [key, max] of [['type', 50], ['name', 50], ['level', 20], ['code', 20], ['highestLevel', 20], ['unit', 50], ['remark', 200]] as const) validateNestedText(item, key, itemLabel, max)
    if (typeof item.code === 'string' && item.code !== '' && !/^[0-9a-zA-Z]+$/.test(item.code)) throw new Error(`${itemLabel}.code只能输入数字和字母`)
  }
  const positionalList = raw.positionalList === undefined ? [] : listOf(raw.positionalList, `${label}.positionalList`)
  for (const [index, item] of positionalList.entries()) {
    const itemLabel = `${label}.positionalList[${index}]`
    for (const [key, max] of [['name', 50], ['level', 20], ['reviewMethod', 20], ['unit', 50], ['code', 20]] as const) validateNestedText(item, key, itemLabel, max)
    if (typeof item.code === 'string' && item.code !== '' && !/^[0-9a-zA-Z]+$/.test(item.code)) throw new Error(`${itemLabel}.code只能输入数字和字母`)
  }
  const rewardPunishmentList = raw.rewardPunishmentList === undefined ? [] : listOf(raw.rewardPunishmentList, `${label}.rewardPunishmentList`)
  for (const [index, item] of rewardPunishmentList.entries()) {
    const itemLabel = `${label}.rewardPunishmentList[${index}]`
    dateOnlyFormOf(item.occurDate, `${itemLabel}.occurDate`, true)
    validateNestedText(item, 'method', itemLabel, 50, true)
    validateNestedText(item, 'content', itemLabel, 500, true)
    normalizeRewardAmount(item.amount, `${itemLabel}.amount`)
    validateNestedText(item, 'reason', itemLabel, 200)
    validateNestedText(item, 'remark', itemLabel, 200)
  }
}

function normalizePostTransferText (value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, maxLength)
}

function normalizePostTransferItem (value: JsonObject, label: string, fallbackStaffId?: HrInternalStaffId): JsonObject {
  const result: JsonObject = {}
  for (const field of POST_TRANSFER_SUBMIT_FIELDS) if (Object.prototype.hasOwnProperty.call(value, field)) result[field] = value[field]
  for (const field of ['beforeOrganizationName', 'afterOrganizationName'] as const) if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = normalizePostTransferText(result[field], `${label}.${field}`, 255)
  for (const field of ['beforePostName', 'afterPostName', 'beforeLeaderUserName', 'afterLeaderUserName'] as const) if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = normalizePostTransferText(result[field], `${label}.${field}`, 50)
  if (result.staffId === undefined || result.staffId === null || result.staffId === '') result.staffId = fallbackStaffId ?? null
  else result.staffId = idOf(result.staffId, `${label}.staffId`)
  if (result.id !== undefined && result.id !== null && result.id !== '') result.id = idOf(result.id, `${label}.id`)
  return result
}

function normalizeUndefinedToNull (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeUndefinedToNull)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonObject).map(([key, item]) => [key, normalizeUndefinedToNull(item)]))
  return value === undefined ? null : value
}

function dateFields (result: JsonObject, label: string): void {
  for (const field of ['birthday', 'entryTime', 'communistTime', 'enrollmentDate', 'graduationTime'] as const) if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = dateFormOf(result[field], `${label}.${field}`, field === 'birthday' || field === 'entryTime')
}

function formPayloadOf (value: unknown, label: string, mode: 'create' | 'update', includePostTransfer = false): JsonObject {
  const raw = objectOf(value, label)
  const result: JsonObject = mode === 'create'
    ? Object.fromEntries(FORM_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(raw, field)).map(field => [field, raw[field]]))
    : { ...raw }
  if (mode === 'create') for (const [key, value] of Object.entries(DEFAULT_FORM)) if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = value
  if (mode === 'update') result.id = idOf(raw.id, `${label}.id`)

  if (Object.prototype.hasOwnProperty.call(result, 'name')) result.name = requiredTextOf(result.name, `${label}.name`, 10)
  if (Object.prototype.hasOwnProperty.call(result, 'idType')) result.idType = requiredChoiceOf(result.idType, `${label}.idType`)
  if (Object.prototype.hasOwnProperty.call(result, 'idCard')) result.idCard = idCardOf(result.idCard)
  if (Object.prototype.hasOwnProperty.call(result, 'sex')) result.sex = requiredChoiceOf(result.sex, `${label}.sex`)
  if (Object.prototype.hasOwnProperty.call(result, 'birthday')) result.birthday = dateFormOf(result.birthday, `${label}.birthday`, true)
  if (Object.prototype.hasOwnProperty.call(result, 'staffDuties')) {
    const duties = Array.isArray(result.staffDuties) ? textListOf(result.staffDuties, `${label}.staffDuties`, false) : typeof result.staffDuties === 'string' ? result.staffDuties.split(',').filter(Boolean) : (() => { throw new Error(`${label}.staffDuties必须是数组或逗号分隔字符串`) })()
    if (duties.length === 0) throw new Error(`${label}.staffDuties不能为空`)
    result.staffDuties = duties.join(',')
  }
  if (Object.prototype.hasOwnProperty.call(result, 'nation')) result.nation = requiredNonSpaceTextOf(result.nation, `${label}.nation`)
  if (Object.prototype.hasOwnProperty.call(result, 'healthConditionProve')) result.healthConditionProve = optionalTextOf(result.healthConditionProve, `${label}.healthConditionProve`, 100)
  if (Object.prototype.hasOwnProperty.call(result, 'organization')) result.organization = idOf(result.organization, `${label}.organization`)
  if (Object.prototype.hasOwnProperty.call(result, 'otherOrganizationList')) result.otherOrganizationList = otherOrganizationListOf(result.otherOrganizationList, `${label}.otherOrganizationList`)
  if (Object.prototype.hasOwnProperty.call(result, 'post')) result.post = requiredChoiceOf(result.post, `${label}.post`)
  if (Object.prototype.hasOwnProperty.call(result, 'salaryLevel')) result.salaryLevel = requiredChoiceOf(result.salaryLevel, `${label}.salaryLevel`)
  if (Object.prototype.hasOwnProperty.call(result, 'salaryStructure')) result.salaryStructure = requiredChoiceOf(result.salaryStructure, `${label}.salaryStructure`)
  if (Object.prototype.hasOwnProperty.call(result, 'employmentType')) result.employmentType = requiredChoiceOf(result.employmentType, `${label}.employmentType`)
  if (Object.prototype.hasOwnProperty.call(result, 'status')) result.status = requiredChoiceOf(result.status, `${label}.status`)
  if (Object.prototype.hasOwnProperty.call(result, 'downtimePay')) {
    if (Number(result.status) === 2) dateOnlyFormOf(result.downtimePay, `${label}.downtimePay`, true)
    else dateOnlyFormOf(result.downtimePay, `${label}.downtimePay`)
  }
  if (Object.prototype.hasOwnProperty.call(result, 'staffStatus')) result.staffStatus = requiredChoiceOf(result.staffStatus, `${label}.staffStatus`)
  if (Object.prototype.hasOwnProperty.call(result, 'entryTime')) result.entryTime = dateFormOf(result.entryTime, `${label}.entryTime`, true)
  if (Object.prototype.hasOwnProperty.call(result, 'entrySeniority')) result.entrySeniority = requiredValueOf(result.entrySeniority, `${label}.entrySeniority`)
  if (Object.prototype.hasOwnProperty.call(result, 'cardIssuingBank')) result.cardIssuingBank = requiredNonSpaceTextOf(result.cardIssuingBank, `${label}.cardIssuingBank`)
  if (Object.prototype.hasOwnProperty.call(result, 'bankAccount')) result.bankAccount = requiredNonSpaceTextOf(result.bankAccount, `${label}.bankAccount`)
  if (Object.prototype.hasOwnProperty.call(result, 'insureArea')) result.insureArea = requiredChoiceOf(result.insureArea, `${label}.insureArea`)
  if (Object.prototype.hasOwnProperty.call(result, 'mobile')) result.mobile = mobileOf(result.mobile)
  if (Object.prototype.hasOwnProperty.call(result, 'address')) result.address = requiredNonSpaceTextOf(result.address, `${label}.address`)
  if (Object.prototype.hasOwnProperty.call(result, 'residenceAddress')) result.residenceAddress = requiredNonSpaceTextOf(result.residenceAddress, `${label}.residenceAddress`)
  if (Object.prototype.hasOwnProperty.call(result, 'emergencyContact')) result.emergencyContact = requiredNonSpaceTextOf(result.emergencyContact, `${label}.emergencyContact`)
  if (Object.prototype.hasOwnProperty.call(result, 'emergencyMobile')) result.emergencyMobile = requiredNonSpaceTextOf(result.emergencyMobile, `${label}.emergencyMobile`)
  if (Object.prototype.hasOwnProperty.call(result, 'education')) result.education = requiredChoiceOf(result.education, `${label}.education`)
  if (Object.prototype.hasOwnProperty.call(result, 'academicDegree')) result.academicDegree = requiredChoiceOf(result.academicDegree, `${label}.academicDegree`)
  if (Object.prototype.hasOwnProperty.call(result, 'isFullTime')) result.isFullTime = requiredChoiceOf(result.isFullTime, `${label}.isFullTime`)
  if (Object.prototype.hasOwnProperty.call(result, 'university')) result.university = requiredNonSpaceTextOf(result.university, `${label}.university`)
  if (Object.prototype.hasOwnProperty.call(result, 'speciality')) result.speciality = requiredNonSpaceTextOf(result.speciality, `${label}.speciality`)
  dateFields(result, label)

  if (Object.prototype.hasOwnProperty.call(result, 'otherPosts')) {
    const otherPosts = Array.isArray(result.otherPosts) ? textListOf(result.otherPosts, `${label}.otherPosts`) : typeof result.otherPosts === 'string' ? result.otherPosts.split(',').filter(Boolean) : (() => { throw new Error(`${label}.otherPosts必须是数组或逗号分隔字符串`) })()
    result.otherPosts = otherPosts.join(',')
  }
  for (const field of ['workList', 'educationalList', 'familyList', 'professionalList', 'positionalList', 'contractList', 'rewardPunishmentList'] as const) if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = stripUiListKeys(result[field], `${label}.${field}`)
  validateNestedLists({ ...raw, ...result }, label)
  if (Array.isArray(result.rewardPunishmentList)) result.rewardPunishmentList = result.rewardPunishmentList.map((item) => ({ ...item, amount: normalizeRewardAmount(item.amount, `${label}.rewardPunishmentList.amount`) }))
  if (Array.isArray(result.contractList)) result.contractList = result.contractList.map((item) => {
    const contract = { ...item }
    if (Number(contract.termType) === 2) delete contract.endTime
    return contract
  })
  if (!includePostTransfer) delete result.postTransferList
  else result.postTransferList = (result.postTransferList === undefined ? [] : listOf(result.postTransferList, `${label}.postTransferList`)).map((item, index) => normalizePostTransferItem(item, `${label}.postTransferList[${index}]`, result.id as HrInternalStaffId | undefined))
  return normalizeUndefinedToNull(result) as JsonObject
}

function formStateOf (value: JsonObject): JsonObject {
  const result: JsonObject = { ...DEFAULT_FORM, ...value }
  if (typeof result.staffDuties === 'string') result.staffDuties = result.staffDuties.split(',').filter(Boolean)
  if (typeof result.otherPosts === 'string') result.otherPosts = result.otherPosts.split(',').filter(Boolean)
  for (const field of ['workList', 'educationalList', 'familyList', 'professionalList', 'positionalList', 'contractList', 'postTransferList', 'rewardPunishmentList'] as const) if (result[field] === undefined || result[field] === null) result[field] = []
  if (result.otherOrganizationList === undefined || result.otherOrganizationList === null) result.otherOrganizationList = []
  return result
}

function listRowOf (value: unknown, label: string): HrInternalStaffListRow {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    name: nullableTextOf(row.name, `${label}.name`),
    staffCode: scalarOf(row.staffCode, `${label}.staffCode`),
    status: integerOf(row.status, `${label}.status`),
    organization: nullableIdOf(row.organization ?? row.organizationId, `${label}.organization`),
    organizationName: nullableTextOf(row.organizationName ?? row.orgName, `${label}.organizationName`),
    postName: nullableTextOf(row.postName, `${label}.postName`),
    mobile: scalarOf(row.mobile, `${label}.mobile`),
    fullPath: nullableTextOf(row.fullPath, `${label}.fullPath`),
  }
}

function detailOf (value: unknown): HrInternalStaffDetail {
  const row = objectOf(value, '内部员工详情')
  return { ...row, id: idOf(row.id, '内部员工详情.id') }
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function filterTextOf (value: unknown, label: string): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function queryOf (query: HrInternalStaffQuery = {}): JsonObject {
  const orgId = query.orgId === undefined || query.orgId === null || query.orgId === '' ? '' : idOf(query.orgId, 'orgId')
  const staffCode = query.staffCode === undefined || query.staffCode === null ? undefined : typeof query.staffCode === 'number' || typeof query.staffCode === 'string' ? query.staffCode : (() => { throw new Error('staffCode必须为字符串、数字或null') })()
  const mobile = query.mobile === undefined || query.mobile === null ? undefined : typeof query.mobile === 'number' || typeof query.mobile === 'string' ? query.mobile : (() => { throw new Error('mobile必须为字符串、数字或null') })()
  return {
    order: '', orderField: '', staffName: filterTextOf(query.staffName, 'staffName'), staffCode,
    postName: filterTextOf(query.postName, 'postName'), status: query.status ?? '', orgId, mobile,
    sqlParam: filterTextOf(query.sqlParam, 'sqlParam'), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function pageOf (value: unknown): PageResult<HrInternalStaffListRow> {
  const page = objectOf(value, '内部员工分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('内部员工分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => listRowOf(item, `内部员工列表行[${index}]`)), total: page.total as number }
}

function idsOf (value: unknown): HrInternalStaffId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ids必须为非空ID数组')
  return [...new Set(value.map((item, index) => idOf(item, `ids[${index}]`)))]
}

function sensitiveStateOf (value: unknown): { verificationRequired: boolean; phone: string | null } {
  if (value === undefined || value === null) return { verificationRequired: false, phone: null }
  const sensitive = objectOf(value, '敏感操作配置')
  const emptyState = sensitive.mobile === undefined && sensitive.isDel === undefined
  const verificationRequired = !(emptyState || sensitive.isDel === 1)
  const phone = sensitive.mobile === undefined || sensitive.mobile === null || sensitive.mobile === '' ? null : String(sensitive.mobile)
  return { verificationRequired, phone }
}

function binaryOf (value: unknown, label: string): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
  throw new Error(`${label}不是二进制文件`)
}

function headerOf (response: AxiosResponse, name: string): string | undefined {
  const headers = response.headers as unknown as { get?: (key: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' ? value : undefined
}

function fileNameOf (response: AxiosResponse, fallback: string): string {
  const header = headerOf(response, 'content-disposition')
  if (!header) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { return encoded }
  }
  return /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallbackName: string, fallbackType = XLSX_MIME): HrInternalStaffFile {
  const bytes = binaryOf(response.data, '内部员工下载响应')
  if (bytes.byteLength === 0) throw new Error('内部员工下载响应为空')
  return {
    fileName: fileNameOf(response, fallbackName),
    contentType: headerOf(response, 'content-type') || fallbackType,
    byteLength: bytes.byteLength,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
  }
}

function fileInputOf (input: unknown, label: string, extensions: RegExp, mimeTypes: string[]): { preview: HrInternalStaffFilePreview; bytes: Uint8Array } {
  const raw = objectOf(input, label)
  if (typeof raw.fileName !== 'string' || raw.fileName.trim() === '' || !extensions.test(raw.fileName)) throw new Error(`${label}.fileName扩展名不符合Portal上传控件`)
  if (typeof raw.base64 !== 'string' || raw.base64.trim() === '') throw new Error(`${label}.base64不能为空`)
  const base64 = raw.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}.base64不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}文件不能为空`)
  const contentType = raw.contentType === undefined || raw.contentType === '' ? mimeTypes[0]! : raw.contentType
  if (typeof contentType !== 'string' || !mimeTypes.includes(contentType)) throw new Error(`${label}.contentType不符合Portal上传规则`)
  return { preview: { fileName: raw.fileName, contentType, byteLength: bytes.byteLength }, bytes }
}

function formDataOf (file: { preview: HrInternalStaffFilePreview; bytes: Uint8Array }): FormData {
  const data = new FormData()
  data.append('file', new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.preview.contentType }), file.preview.fileName)
  return data
}

function textResultOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function stringListResultOf (value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label}必须为字符串数组`)
  return [...value]
}

function historyQueryOf (input: HrInternalStaffHistoryQuery = {}): JsonObject {
  const dateTime = (value: unknown, label: string): string => {
    if (value === undefined || value === null || value === '') return ''
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD HH:mm:ss`)
    return value
  }
  return {
    order: '', orderField: '', staffId: input.staffId === undefined || input.staffId === null || input.staffId === '' ? '' : idOf(input.staffId, 'staffId'),
    operatorName: filterTextOf(input.operatorName, 'operatorName'), startTime: dateTime(input.startTime, 'startTime'), endTime: dateTime(input.endTime, 'endTime'),
    pageNo: pageNumberOf(input.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(input.pageSize, 20, 'pageSize'),
  }
}

function historyRowOf (value: unknown, label = '内部员工变更记录'): JsonObject {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`), staffId: nullableIdOf(row.staffId, `${label}.staffId`), staffName: nullableTextOf(row.staffName, `${label}.staffName`),
    staffCode: scalarOf(row.staffCode, `${label}.staffCode`), changeTypeDesc: nullableTextOf(row.changeTypeDesc, `${label}.changeTypeDesc`),
    changeFieldCount: integerOf(row.changeFieldCount, `${label}.changeFieldCount`), changeTime: nullableTextOf(row.changeTime, `${label}.changeTime`), operatorName: nullableTextOf(row.operatorName, `${label}.operatorName`),
  }
}

function historyPageOf (value: unknown): PageResult<JsonObject> {
  const page = objectOf(value, '内部员工变更记录分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('内部员工变更记录分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => historyRowOf(item, `内部员工变更记录[${index}]`)), total: page.total as number }
}

function historyDetailOf (value: unknown): JsonObject {
  const row = historyRowOf(value, '内部员工变更记录详情')
  const raw = objectOf(value, '内部员工变更记录详情')
  if (!Array.isArray(raw.changeItems)) throw new Error('内部员工变更记录详情缺少changeItems数组')
  return {
    ...row,
    changeItems: raw.changeItems.map((item, index) => {
      const change = objectOf(item, `changeItems[${index}]`)
      return {
        ...change,
        dataType: nullableTextOf(change.dataType, `changeItems[${index}].dataType`), dataTypeLabel: nullableTextOf(change.dataTypeLabel, `changeItems[${index}].dataTypeLabel`),
        changeAction: nullableTextOf(change.changeAction, `changeItems[${index}].changeAction`), changeActionLabel: nullableTextOf(change.changeActionLabel, `changeItems[${index}].changeActionLabel`),
        subRecordId: nullableIdOf(change.subRecordId, `changeItems[${index}].subRecordId`), fieldName: nullableTextOf(change.fieldName, `changeItems[${index}].fieldName`),
        oldValue: nullableTextOf(change.oldValue, `changeItems[${index}].oldValue`), newValue: nullableTextOf(change.newValue, `changeItems[${index}].newValue`), changeDesc: nullableTextOf(change.changeDesc, `changeItems[${index}].changeDesc`),
      }
    }),
  }
}

export function createHrInternalStaffCapability (request: PortalRequest) {
  async function prepareRemove (input: { ids: HrInternalStaffId[]; records?: Array<{ id: HrInternalStaffId; status?: number | string | null }> }): Promise<HrInternalStaffDeletePreparation> {
    const ids = idsOf(input?.ids)
    for (const record of input?.records ?? []) {
      idOf(record.id, '删除记录ID')
      if (record.status !== undefined && record.status !== null && Number(record.status) !== 2) throw new Error('Portal只允许删除status为2的离职员工')
    }
    const sensitive = await request<unknown>({ url: SENSITIVE_ROOT, method: 'get' })
    return { ids, ...sensitiveStateOf(sensitive) }
  }

  async function get (input: { id: HrInternalStaffId }): Promise<HrInternalStaffDetail> {
    const id = idOf(input?.id, '内部员工ID')
    return detailOf(await request({ url: `${ROOT}/${id}`, method: 'get' }))
  }

  return {
    async list (query: HrInternalStaffQuery = {}): Promise<PageResult<HrInternalStaffListRow>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },
    get,
    prepareCreate (input: { form: Partial<HrInternalStaffForm> }): { draft: JsonObject } {
      const raw = objectOf(input?.form, '内部员工新建表单')
      const form = { ...DEFAULT_FORM }
      for (const field of FORM_FIELDS) if (Object.prototype.hasOwnProperty.call(raw, field)) form[field] = raw[field]
      return { draft: formPayloadOf(form, '内部员工新建表单', 'create') }
    },
    async create (input: { draft: HrInternalStaffForm }): Promise<{ id: HrInternalStaffId }> {
      const id = idOf(await request({ url: ROOT, method: 'post', data: formPayloadOf(input?.draft, '内部员工新建草稿', 'create') }), '新建内部员工响应ID')
      return { id }
    },
    prepareUpdate (input: { current: HrInternalStaffDetail | Record<string, unknown>; changes?: Record<string, unknown> | null }): { draft: JsonObject; previous: JsonObject } {
      const current = formStateOf(objectOf(input?.current, '内部员工编辑当前值'))
      const changes = input?.changes === undefined || input.changes === null ? {} : objectOf(input.changes, '内部员工编辑变更')
      for (const key of Object.keys(changes)) if (!formFieldSet.has(key)) throw new Error(`内部员工编辑变更不支持字段${key}`)
      const previous = formPayloadOf(current, '内部员工编辑当前值', 'update', Object.prototype.hasOwnProperty.call(changes, 'postTransferList'))
      const draft = formPayloadOf({ ...current, ...changes }, '内部员工编辑草稿', 'update', Object.prototype.hasOwnProperty.call(changes, 'postTransferList'))
      return { draft, previous }
    },
    async update (input: { draft: HrInternalStaffForm }): Promise<void> {
      await request({ url: ROOT, method: 'put', data: formPayloadOf(input?.draft, '内部员工编辑草稿', 'update', Object.prototype.hasOwnProperty.call(input?.draft ?? {}, 'postTransferList')) })
    },
    prepareRemove,
    async sendDeleteCode (input: { ids: HrInternalStaffId[]; records?: Array<{ id: HrInternalStaffId; status?: number | string | null }> }): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await request<{ requestId?: string | number }>({ url: SMS_SEND_ROOT, method: 'get', params: { phone: prepared.phone, templateId: SMS_TEMPLATE_ID } })
      if (sent?.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) throw new Error('短信响应缺少requestId；发送结果不确定，不自动重发')
      return { smsRequestId: String(sent.requestId) }
    },
    async remove (input: HrInternalStaffDeleteInput): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (!input.smsRequestId?.trim() || !input.code?.trim()) throw new Error('删除需要短信验证：先sendDeleteCode，再提供smsRequestId和用户收到的code')
        await request({ url: SMS_CHECK_ROOT, method: 'get', params: { requestId: input.smsRequestId, code: input.code } })
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
    async customInfo (): Promise<JsonObject> {
      return objectOf(await request({ url: `${ROOT}/getCustomInfo`, method: 'get', params: { tableName: CUSTOM_INFO_TABLE } }), '内部员工自定义列信息')
    },
    async customExport (input: { columnIds: string[]; organizationIds?: HrInternalStaffId[] }): Promise<HrInternalStaffFile> {
      if (!Array.isArray(input?.columnIds) || input.columnIds.length === 0 || input.columnIds.some(item => typeof item !== 'string' || item.trim() === '')) throw new Error('columnIds必须为非空字符串数组')
      const organizationIds = input.organizationIds === undefined ? [] : idListOf(input.organizationIds, 'organizationIds')
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/customExports`, method: 'post', data: { columnIds: [...input.columnIds], organizationIds }, responseType: 'arraybuffer' }), '人员.xlsx')
    },
    prepareImport (input: { file: HrInternalStaffFileInput }): HrInternalStaffFilePreview {
      return fileInputOf(input?.file, '内部员工导入文件', /\.xlsx$/i, [XLSX_MIME]).preview
    },
    async importPrecheck (input: { file: HrInternalStaffFileInput }): Promise<string[]> {
      const file = fileInputOf(input?.file, '内部员工导入文件', /\.xlsx$/i, [XLSX_MIME])
      return stringListResultOf(await request({ url: `${ROOT}/import/precheck`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } }), '内部员工导入预检查响应')
    },
    async importStaff (input: { file: HrInternalStaffFileInput }): Promise<string[]> {
      const file = fileInputOf(input?.file, '内部员工导入文件', /\.xlsx$/i, [XLSX_MIME])
      return stringListResultOf(await request({ url: `${ROOT}/import`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } }), '内部员工导入响应')
    },
    async downloadTemplate (input: { orgId: HrInternalStaffId }): Promise<HrInternalStaffFile> {
      const orgId = idOf(input?.orgId, '模板组织ID')
      const url = textResultOf(await request({ url: `${ROOT}/downloadTemplate`, method: 'get', params: { orgId } }), '内部员工模板地址')
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url, method: 'get', responseType: 'arraybuffer' }), '内部员工导入模板.xlsx')
    },
    async downloadContractTemplate (): Promise<HrInternalStaffFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/downloadContractTemplate`, method: 'get', responseType: 'arraybuffer' }), '合同导入模板.xlsx')
    },
    prepareContractImport (input: { file: HrInternalStaffFileInput; mode?: 1 | 2 }): HrInternalStaffFilePreview {
      if (input?.mode !== undefined && input.mode !== 1 && input.mode !== 2) throw new Error('合同导入mode只能是1（更新）或2（新增）')
      return fileInputOf(input?.file, '合同导入文件', /\.xlsx$/i, [XLSX_MIME]).preview
    },
    async importContract (input: { file: HrInternalStaffFileInput; mode?: 1 | 2 }): Promise<string> {
      const mode = input?.mode ?? 2
      if (mode !== 1 && mode !== 2) throw new Error('合同导入mode只能是1（更新）或2（新增）')
      const file = fileInputOf(input?.file, '合同导入文件', /\.xlsx$/i, [XLSX_MIME])
      const data = formDataOf(file)
      data.append('mode', String(mode))
      return textResultOf(await request({ url: `${ROOT}/importContract`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }), '合同导入响应')
    },
    async downloadPostTransferTemplate (): Promise<HrInternalStaffFile> {
      return downloadedFileOf(await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/post-transfer/import-template`, method: 'get', responseType: 'arraybuffer' }), '员工职务变动批量导入模板.xlsx')
    },
    preparePostTransferImport (input: { staffId: HrInternalStaffId; file: HrInternalStaffFileInput }): HrInternalStaffFilePreview {
      idOf(input?.staffId, '职务变动员工ID')
      return fileInputOf(input?.file, '职务变动导入文件', /\.(xlsx|xls)$/i, [XLSX_MIME, XLS_MIME]).preview
    },
    async importPostTransfer (input: { staffId: HrInternalStaffId; file: HrInternalStaffFileInput }): Promise<string> {
      const staffId = idOf(input?.staffId, '职务变动员工ID')
      const file = fileInputOf(input?.file, '职务变动导入文件', /\.(xlsx|xls)$/i, [XLSX_MIME, XLS_MIME])
      return textResultOf(await request({ url: `${ROOT}/${staffId}/post-transfer/import`, method: 'post', data: formDataOf(file), headers: { 'Content-Type': 'multipart/form-data' } }), '职务变动导入响应')
    },
    async historyList (input: HrInternalStaffHistoryQuery = {}): Promise<PageResult<JsonObject>> {
      return historyPageOf(await request({ url: '/hr/staff/changeLog/page', method: 'get', params: historyQueryOf(input) }))
    },
    async historyDetail (input: { id: HrInternalStaffId }): Promise<JsonObject> {
      const id = idOf(input?.id, '内部员工变更记录ID')
      return historyDetailOf(await request({ url: `/hr/staff/changeLog/${id}`, method: 'get' }))
    },
  }
}

export type HrInternalStaffCapability = ReturnType<typeof createHrInternalStaffCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const HR_INTERNAL_STAFF_METHODS = {
  'hr-internal-staff-list': 'list', 'hr-internal-staff-get': 'get', 'hr-internal-staff-prepare-create': 'prepareCreate', 'hr-internal-staff-create': 'create',
  'hr-internal-staff-prepare-update': 'prepareUpdate', 'hr-internal-staff-update': 'update', 'hr-internal-staff-prepare-remove': 'prepareRemove',
  'hr-internal-staff-send-delete-code': 'sendDeleteCode', 'hr-internal-staff-remove': 'remove', 'hr-internal-staff-custom-info': 'customInfo',
  'hr-internal-staff-custom-export': 'customExport', 'hr-internal-staff-prepare-import': 'prepareImport', 'hr-internal-staff-import-precheck': 'importPrecheck',
  'hr-internal-staff-import': 'importStaff', 'hr-internal-staff-download-template': 'downloadTemplate', 'hr-internal-staff-download-contract-template': 'downloadContractTemplate',
  'hr-internal-staff-prepare-contract-import': 'prepareContractImport', 'hr-internal-staff-import-contract': 'importContract',
  'hr-internal-staff-download-post-transfer-template': 'downloadPostTransferTemplate', 'hr-internal-staff-prepare-post-transfer-import': 'preparePostTransferImport',
  'hr-internal-staff-import-post-transfer': 'importPostTransfer', 'hr-internal-staff-history-list': 'historyList', 'hr-internal-staff-history-detail': 'historyDetail',
} as const

export const hrInternalStaffCapabilities: CapabilityDefinition[] = [
  { id: 'hr-internal-staff-list', title: '查询内部员工分页', write: false, params: [p('staffName', 'text', false, '姓名筛选；默认空字符串'), p('staffCode', 'text', false, '员工编号筛选；Portal输入框原值'), p('postName', 'text', false, '岗位名称筛选；默认空字符串'), p('status', 'text', false, '员工状态筛选；默认空字符串'), p('orgId', 'text', false, '组织ID；默认空字符串'), p('mobile', 'text', false, '手机号筛选；Portal输入框原值'), p('sqlParam', 'text', false, '自定义查询条件；Portal原样发送，由Java服务端安全处理'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'hr-internal-staff-get', title: '读取内部员工详情', write: false, params: [p('id', 'text', true, '内部员工ID')] },
  { id: 'hr-internal-staff-prepare-create', title: '准备新建内部员工', write: false, params: [p('form', 'text', true, 'Portal内部员工完整表单；准备阶段执行主表、嵌套列表和停薪规则校验')] },
  { id: 'hr-internal-staff-create', title: '创建内部员工', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的新建草稿')] },
  { id: 'hr-internal-staff-prepare-update', title: '准备编辑内部员工', write: false, params: [p('current', 'text', true, 'get返回的完整详情'), p('changes', 'text', false, '仅覆盖Portal编辑字段；postTransferList显式变更才会发送')] },
  { id: 'hr-internal-staff-update', title: '保存内部员工编辑', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整PUT草稿')] },
  { id: 'hr-internal-staff-prepare-remove', title: '准备删除内部员工', write: false, params: [p('ids', 'text', true, '待删除ID数组；Portal行删除为单个ID'), p('records', 'text', false, '可选列表记录，用于复刻Portal仅允许离职状态删除')] },
  { id: 'hr-internal-staff-send-delete-code', title: '发送内部员工删除验证码', write: true, params: [p('ids', 'text', true, '待删除ID数组'), p('records', 'text', false, '可选列表记录，用于状态校验')] },
  { id: 'hr-internal-staff-remove', title: '删除内部员工', write: true, params: [p('ids', 'text', true, '待删除ID数组'), p('records', 'text', false, '可选列表记录'), p('smsRequestId', 'text', false, '敏感保护开启时由sendDeleteCode返回'), p('code', 'text', false, '敏感保护开启时由手机号持有人提供')] },
  { id: 'hr-internal-staff-custom-info', title: '读取内部员工自定义列信息', write: false, params: [] },
  { id: 'hr-internal-staff-custom-export', title: '按页面列和组织导出内部员工', write: false, params: [p('columnIds', 'text', true, '自定义导出的列ID数组'), p('organizationIds', 'text', false, '页面组织选择数组；默认空数组')] },
  { id: 'hr-internal-staff-prepare-import', title: '准备内部员工导入文件', write: false, params: [p('file', 'text', true, 'xlsx文件名、Base64和可选MIME')] },
  { id: 'hr-internal-staff-import-precheck', title: '预检查内部员工导入文件', write: true, params: [p('file', 'text', true, 'xlsx文件名、Base64和可选MIME')] },
  { id: 'hr-internal-staff-import', title: '导入内部员工', write: true, params: [p('file', 'text', true, 'xlsx文件名、Base64和可选MIME')] },
  { id: 'hr-internal-staff-download-template', title: '下载内部员工导入模板', write: false, params: [p('orgId', 'text', true, '模板所属组织ID')] },
  { id: 'hr-internal-staff-download-contract-template', title: '下载合同导入模板', write: false, params: [] },
  { id: 'hr-internal-staff-prepare-contract-import', title: '准备合同导入文件', write: false, params: [p('file', 'text', true, 'xlsx文件'), p('mode', 'number', false, '1更新或2新增；默认2')] },
  { id: 'hr-internal-staff-import-contract', title: '导入员工合同', write: true, params: [p('file', 'text', true, 'xlsx文件'), p('mode', 'number', false, '1更新或2新增；默认2')] },
  { id: 'hr-internal-staff-download-post-transfer-template', title: '下载职务变动导入模板', write: false, params: [] },
  { id: 'hr-internal-staff-prepare-post-transfer-import', title: '准备职务变动导入文件', write: false, params: [p('staffId', 'text', true, '员工ID'), p('file', 'text', true, 'xlsx或xls文件')] },
  { id: 'hr-internal-staff-import-post-transfer', title: '导入员工职务变动', write: true, params: [p('staffId', 'text', true, '员工ID'), p('file', 'text', true, 'xlsx或xls文件')] },
  { id: 'hr-internal-staff-history-list', title: '查询内部员工变更历史', write: false, params: [p('staffId', 'text', false, '员工ID；从当前页面历史入口传入'), p('operatorName', 'text', false, '操作人筛选'), p('startTime', 'date', false, '开始时间'), p('endTime', 'date', false, '结束时间'), p('pageNo', 'number', false, '默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'hr-internal-staff-history-detail', title: '读取内部员工变更历史详情', write: false, params: [p('id', 'text', true, '变更记录ID')] },
].map(definition => ({
  ...definition,
  pagePath: HR_INTERNAL_STAFF_PAGE_PATH,
  permission: HR_INTERNAL_STAFF_PERMISSION,
  moduleType: HR_INTERNAL_STAFF_MODULE_TYPE,
  httpInstance: 'platform',
}))
