import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 外部员工」及其当前页面可达的新建、编辑和敏感删除动作。 */
export const HR_EXTERNAL_STAFF_PAGE_PATH = '/dashboard/staff/external-staff-list/list'
export const HR_EXTERNAL_STAFF_PERMISSION = '/dashboard/staff/external-staff-list'
export const HR_EXTERNAL_STAFF_MODULE_TYPE = 11

const ROOT = '/org/outsideStaff'
const SENSITIVE_ROOT = '/org/sensitive/info'
const SMS_SEND_ROOT = '/sys/sms/send'
const SMS_CHECK_ROOT = '/sys/sms/checkSms'
const SMS_TEMPLATE_ID = '17709'

export type HrExternalStaffId = string | number
export type HrExternalStaffScalar = string | number | null
export type HrExternalStaffDate = string | number | null

export type HrExternalStaffQuery = {
  name?: string | null
  mobile?: string | number | null
  orgId?: HrExternalStaffId | '' | null
  pageNo?: number
  pageSize?: number
}

export type HrExternalStaffRecord = Record<string, unknown> & {
  id: HrExternalStaffId
  organization: HrExternalStaffId | null
  name: string | null
  idType: number | null
  idCard: string | null
  birthday: HrExternalStaffDate
  sex: number | null
  mobile: HrExternalStaffScalar
  nation: string | null
  staffCode: HrExternalStaffScalar
  nativePlace: string | null
  isDel: number | null
  householdType: number | null
  residenceAddress: string | null
  address: string | null
  politicalOutlook: number | null
  communistTime: HrExternalStaffDate
  education: number | null
  academicDegree: number | null
  isFullTime: number | null
  enrollmentDate: HrExternalStaffDate
  graduationTime: HrExternalStaffDate
  university: string | null
  speciality: string | null
  creator: HrExternalStaffScalar
  createTime: HrExternalStaffDate
  updater: HrExternalStaffScalar
  updateTime: HrExternalStaffDate
  educationUniversity: string | null
  educationSpeciality: string | null
  outstandingAchievement: string | null
  expertise: string | null
  awards: string | null
  appointmentFirm: string | null
  appointmentPost: string | null
  appointmentTime: HrExternalStaffDate
  appointmentFirmExecutives: string | null
  appointmentPostExecutives: string | null
  appointmentTimeExecutives: HrExternalStaffDate
  tenantId: HrExternalStaffScalar
  studyPost: string | null
  fullPath: string | null
}

export type HrExternalStaffForm = Record<string, unknown> & {
  organization: HrExternalStaffId | '' | null
  appointmentFirm: string
  appointmentPost: string
  appointmentTime: string | null
  appointmentFirmExecutives: string
  appointmentPostExecutives: string
  appointmentTimeExecutives: string | null
  name: string
  idType: number | string | null
  idCard: string
  birthday: string | null
  sex: number | string | null
  mobile: string | number | null
  nation: string
  nativePlace: string
  householdType: number | string | null
  residenceAddress: string
  address: string
  politicalOutlook: number | string | null
  communistTime: string | null
  university: string
  speciality: string
  educationUniversity: string
  educationSpeciality: string
  education: number | string | null
  academicDegree: number | string | null
  isFullTime: number | string | null
  studyPost: string
  expertise: string
  awards: string
  outstandingAchievement: string
}

export type HrExternalStaffCreateDraft = HrExternalStaffForm
export type HrExternalStaffUpdateChanges = Partial<HrExternalStaffForm>
export type HrExternalStaffUpdateDraft = Record<string, unknown> & HrExternalStaffForm & { id: HrExternalStaffId }
export type HrExternalStaffPreparedWrite = {
  draft: HrExternalStaffCreateDraft | HrExternalStaffUpdateDraft
  previous?: HrExternalStaffUpdateDraft
}

export type HrExternalStaffDeleteIds = { ids: HrExternalStaffId[] }
export type HrExternalStaffDeleteInput = HrExternalStaffDeleteIds & {
  smsRequestId?: string
  code?: string
}
export type HrExternalStaffDeletePreparation = {
  ids: HrExternalStaffId[]
  verificationRequired: boolean
  phone: string | null
}

type JsonObject = Record<string, unknown>

const FORM_FIELDS = [
  'organization',
  'appointmentFirm',
  'appointmentPost',
  'appointmentTime',
  'appointmentFirmExecutives',
  'appointmentPostExecutives',
  'appointmentTimeExecutives',
  'name',
  'idType',
  'idCard',
  'birthday',
  'sex',
  'mobile',
  'nation',
  'nativePlace',
  'householdType',
  'residenceAddress',
  'address',
  'politicalOutlook',
  'communistTime',
  'university',
  'speciality',
  'educationUniversity',
  'educationSpeciality',
  'education',
  'academicDegree',
  'isFullTime',
  'studyPost',
  'expertise',
  'awards',
  'outstandingAchievement',
] as const

const DEFAULT_FORM: HrExternalStaffForm = {
  organization: null,
  appointmentFirm: '',
  appointmentPost: '',
  appointmentTime: null,
  appointmentFirmExecutives: '',
  appointmentPostExecutives: '',
  appointmentTimeExecutives: null,
  name: '',
  idType: '',
  idCard: '',
  birthday: '',
  sex: '',
  mobile: '',
  nation: '',
  nativePlace: '',
  householdType: '',
  residenceAddress: '',
  address: '',
  politicalOutlook: '',
  communistTime: null,
  university: '',
  speciality: '',
  educationUniversity: '',
  educationSpeciality: '',
  education: '',
  academicDegree: '',
  isFullTime: '',
  studyPost: '',
  expertise: '',
  awards: '',
  outstandingAchievement: '',
}

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): HrExternalStaffId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function nullableIdOf (value: unknown, label: string): HrExternalStaffId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function scalarOf (value: unknown, label: string): HrExternalStaffScalar {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function textOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function dateOf (value: unknown, label: string): HrExternalStaffDate {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new Error(`${label}必须为字符串、有限数字或null`)
}

function integerOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数或null`)
  return value as number
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || (result as number) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result as number)) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return result as number
}

function queryOf (query: HrExternalStaffQuery = {}): JsonObject {
  const name = query.name === undefined || query.name === null ? '' : query.name
  if (typeof name !== 'string') throw new Error('name必须为字符串或null')
  const mobile = query.mobile === undefined || query.mobile === null ? '' : query.mobile
  if (typeof mobile !== 'string' && typeof mobile !== 'number') throw new Error('mobile必须为字符串、数字或null')
  const orgId = query.orgId === undefined || query.orgId === null || query.orgId === '' ? '' : idOf(query.orgId, 'orgId')
  return {
    order: '',
    orderField: '',
    name,
    mobile,
    orgId,
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function recordOf (value: unknown, label: string): HrExternalStaffRecord {
  const row = objectOf(value, label)
  return {
    ...row,
    id: idOf(row.id, `${label}.id`),
    organization: nullableIdOf(row.organization, `${label}.organization`),
    name: textOf(row.name, `${label}.name`),
    idType: integerOf(row.idType, `${label}.idType`),
    idCard: textOf(row.idCard, `${label}.idCard`),
    birthday: dateOf(row.birthday, `${label}.birthday`),
    sex: integerOf(row.sex, `${label}.sex`),
    mobile: scalarOf(row.mobile, `${label}.mobile`),
    nation: textOf(row.nation, `${label}.nation`),
    staffCode: scalarOf(row.staffCode, `${label}.staffCode`),
    nativePlace: textOf(row.nativePlace, `${label}.nativePlace`),
    isDel: integerOf(row.isDel, `${label}.isDel`),
    householdType: integerOf(row.householdType, `${label}.householdType`),
    residenceAddress: textOf(row.residenceAddress, `${label}.residenceAddress`),
    address: textOf(row.address, `${label}.address`),
    politicalOutlook: integerOf(row.politicalOutlook, `${label}.politicalOutlook`),
    communistTime: dateOf(row.communistTime, `${label}.communistTime`),
    education: integerOf(row.education, `${label}.education`),
    academicDegree: integerOf(row.academicDegree, `${label}.academicDegree`),
    isFullTime: integerOf(row.isFullTime, `${label}.isFullTime`),
    enrollmentDate: dateOf(row.enrollmentDate, `${label}.enrollmentDate`),
    graduationTime: dateOf(row.graduationTime, `${label}.graduationTime`),
    university: textOf(row.university, `${label}.university`),
    speciality: textOf(row.speciality, `${label}.speciality`),
    creator: scalarOf(row.creator, `${label}.creator`),
    createTime: dateOf(row.createTime, `${label}.createTime`),
    updater: scalarOf(row.updater, `${label}.updater`),
    updateTime: dateOf(row.updateTime, `${label}.updateTime`),
    educationUniversity: textOf(row.educationUniversity, `${label}.educationUniversity`),
    educationSpeciality: textOf(row.educationSpeciality, `${label}.educationSpeciality`),
    outstandingAchievement: textOf(row.outstandingAchievement, `${label}.outstandingAchievement`),
    expertise: textOf(row.expertise, `${label}.expertise`),
    awards: textOf(row.awards, `${label}.awards`),
    appointmentFirm: textOf(row.appointmentFirm, `${label}.appointmentFirm`),
    appointmentPost: textOf(row.appointmentPost, `${label}.appointmentPost`),
    appointmentTime: dateOf(row.appointmentTime, `${label}.appointmentTime`),
    appointmentFirmExecutives: textOf(row.appointmentFirmExecutives, `${label}.appointmentFirmExecutives`),
    appointmentPostExecutives: textOf(row.appointmentPostExecutives, `${label}.appointmentPostExecutives`),
    appointmentTimeExecutives: dateOf(row.appointmentTimeExecutives, `${label}.appointmentTimeExecutives`),
    tenantId: scalarOf(row.tenantId, `${label}.tenantId`),
    studyPost: textOf(row.studyPost, `${label}.studyPost`),
    fullPath: textOf(row.fullPath, `${label}.fullPath`),
  }
}

function pageOf (value: unknown): PageResult<HrExternalStaffRecord> {
  const page = objectOf(value, '外部员工分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) throw new Error('外部员工分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => recordOf(item, `外部员工列表行[${index}]`)), total: page.total as number }
}

function requiredTextOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  if (value.length > maxLength) throw new Error(`${label}长度不能超过${maxLength}个字符`)
  return value
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

function dateFormOf (value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return value === '' ? '' : null
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new Error(`${label}必须为YYYY-MM-DD HH:mm:ss`)
  return value
}

function mobileFormOf (value: unknown): string | number {
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

function formPayloadOf (value: unknown, label: string, create = false): JsonObject {
  const raw = objectOf(value, label)
  const result: JsonObject = create ? {} : { ...raw }
  if (create) {
    for (const field of FORM_FIELDS) if (Object.prototype.hasOwnProperty.call(raw, field)) result[field] = raw[field]
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'organization')) result.organization = nullableIdOf(raw.organization, `${label}.organization`)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentFirm')) result.appointmentFirm = requiredTextOf(raw.appointmentFirm, `${label}.appointmentFirm`, 30)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentPost')) result.appointmentPost = requiredTextOf(raw.appointmentPost, `${label}.appointmentPost`, 10)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentTime')) result.appointmentTime = dateFormOf(raw.appointmentTime, `${label}.appointmentTime`, true)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentFirmExecutives')) result.appointmentFirmExecutives = optionalTextOf(raw.appointmentFirmExecutives, `${label}.appointmentFirmExecutives`)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentPostExecutives')) result.appointmentPostExecutives = optionalTextOf(raw.appointmentPostExecutives, `${label}.appointmentPostExecutives`)
  if (Object.prototype.hasOwnProperty.call(raw, 'appointmentTimeExecutives')) result.appointmentTimeExecutives = dateFormOf(raw.appointmentTimeExecutives, `${label}.appointmentTimeExecutives`)
  if (Object.prototype.hasOwnProperty.call(raw, 'name')) result.name = requiredTextOf(raw.name, `${label}.name`, 10)
  if (Object.prototype.hasOwnProperty.call(raw, 'idType')) result.idType = requiredChoiceOf(raw.idType, `${label}.idType`)
  if (Object.prototype.hasOwnProperty.call(raw, 'idCard')) result.idCard = idCardOf(raw.idCard)
  if (Object.prototype.hasOwnProperty.call(raw, 'birthday')) result.birthday = dateFormOf(raw.birthday, `${label}.birthday`, true)
  if (Object.prototype.hasOwnProperty.call(raw, 'sex')) result.sex = requiredChoiceOf(raw.sex, `${label}.sex`)
  if (Object.prototype.hasOwnProperty.call(raw, 'mobile')) result.mobile = mobileFormOf(raw.mobile)
  if (Object.prototype.hasOwnProperty.call(raw, 'nation')) result.nation = optionalTextOf(raw.nation, `${label}.nation`)
  if (Object.prototype.hasOwnProperty.call(raw, 'nativePlace')) result.nativePlace = optionalTextOf(raw.nativePlace, `${label}.nativePlace`)
  if (Object.prototype.hasOwnProperty.call(raw, 'householdType')) result.householdType = choiceOf(raw.householdType, `${label}.householdType`)
  if (Object.prototype.hasOwnProperty.call(raw, 'residenceAddress')) result.residenceAddress = optionalTextOf(raw.residenceAddress, `${label}.residenceAddress`)
  if (Object.prototype.hasOwnProperty.call(raw, 'address')) result.address = optionalTextOf(raw.address, `${label}.address`)
  if (Object.prototype.hasOwnProperty.call(raw, 'politicalOutlook')) result.politicalOutlook = choiceOf(raw.politicalOutlook, `${label}.politicalOutlook`)
  if (Object.prototype.hasOwnProperty.call(raw, 'communistTime')) result.communistTime = dateFormOf(raw.communistTime, `${label}.communistTime`)
  if (Object.prototype.hasOwnProperty.call(raw, 'university')) result.university = optionalTextOf(raw.university, `${label}.university`)
  if (Object.prototype.hasOwnProperty.call(raw, 'speciality')) result.speciality = optionalTextOf(raw.speciality, `${label}.speciality`)
  if (Object.prototype.hasOwnProperty.call(raw, 'educationUniversity')) result.educationUniversity = optionalTextOf(raw.educationUniversity, `${label}.educationUniversity`)
  if (Object.prototype.hasOwnProperty.call(raw, 'educationSpeciality')) result.educationSpeciality = optionalTextOf(raw.educationSpeciality, `${label}.educationSpeciality`)
  if (Object.prototype.hasOwnProperty.call(raw, 'education')) result.education = choiceOf(raw.education, `${label}.education`)
  if (Object.prototype.hasOwnProperty.call(raw, 'academicDegree')) result.academicDegree = choiceOf(raw.academicDegree, `${label}.academicDegree`)
  if (Object.prototype.hasOwnProperty.call(raw, 'isFullTime')) result.isFullTime = choiceOf(raw.isFullTime, `${label}.isFullTime`)
  if (Object.prototype.hasOwnProperty.call(raw, 'studyPost')) result.studyPost = optionalTextOf(raw.studyPost, `${label}.studyPost`)
  if (Object.prototype.hasOwnProperty.call(raw, 'expertise')) result.expertise = optionalTextOf(raw.expertise, `${label}.expertise`)
  if (Object.prototype.hasOwnProperty.call(raw, 'awards')) result.awards = optionalTextOf(raw.awards, `${label}.awards`)
  if (Object.prototype.hasOwnProperty.call(raw, 'outstandingAchievement')) result.outstandingAchievement = optionalTextOf(raw.outstandingAchievement, `${label}.outstandingAchievement`)
  if (!create) result.id = idOf(raw.id, `${label}.id`)
  return result
}

function idsOf (value: unknown): HrExternalStaffId[] {
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

export function createHrExternalStaffCapability (request: PortalRequest) {
  async function prepareRemove (input: HrExternalStaffDeleteIds): Promise<HrExternalStaffDeletePreparation> {
    const ids = idsOf(input?.ids)
    const sensitive = await request<unknown>({ url: SENSITIVE_ROOT, method: 'get' })
    return { ids, ...sensitiveStateOf(sensitive) }
  }

  return {
    async list (query: HrExternalStaffQuery = {}): Promise<PageResult<HrExternalStaffRecord>> {
      return pageOf(await request({ url: `${ROOT}/page`, method: 'get', params: queryOf(query) }))
    },
    async get (input: { id: HrExternalStaffId }): Promise<HrExternalStaffRecord> {
      const id = idOf(input?.id, '外部员工ID')
      return recordOf(await request({ url: `${ROOT}/${id}`, method: 'get' }), '外部员工详情')
    },
    prepareCreate (input: { form: Partial<HrExternalStaffForm> }): { draft: HrExternalStaffCreateDraft } {
      const raw = objectOf(input?.form, '外部员工新建表单')
      const merged = { ...DEFAULT_FORM }
      for (const field of FORM_FIELDS) if (Object.prototype.hasOwnProperty.call(raw, field)) merged[field] = raw[field] as never
      return { draft: formPayloadOf(merged, '外部员工新建表单', true) as HrExternalStaffCreateDraft }
    },
    async create (input: { draft: HrExternalStaffCreateDraft }): Promise<void> {
      await request({ url: ROOT, method: 'post', data: formPayloadOf(input?.draft, '外部员工新建草稿', true) })
    },
    prepareUpdate (input: { current: HrExternalStaffRecord | Record<string, unknown>; changes?: HrExternalStaffUpdateChanges | null }): { draft: HrExternalStaffUpdateDraft; previous: HrExternalStaffUpdateDraft } {
      const current = objectOf(input?.current, '外部员工编辑当前值')
      const changes = input?.changes === undefined || input.changes === null ? {} : objectOf(input.changes, '外部员工编辑变更')
      const allowed = new Set(FORM_FIELDS)
      for (const key of Object.keys(changes)) if (!allowed.has(key as typeof FORM_FIELDS[number])) throw new Error(`外部员工编辑变更不支持字段${key}`)
      const previous = formPayloadOf(current, '外部员工编辑当前值') as HrExternalStaffUpdateDraft
      const draft = formPayloadOf({ ...current, ...changes }, '外部员工编辑草稿') as HrExternalStaffUpdateDraft
      return { draft, previous }
    },
    async update (input: { draft: HrExternalStaffUpdateDraft }): Promise<void> {
      await request({ url: ROOT, method: 'put', data: formPayloadOf(input?.draft, '外部员工编辑草稿') })
    },
    prepareRemove,
    async sendDeleteCode (input: HrExternalStaffDeleteIds): Promise<{ smsRequestId: string }> {
      const prepared = await prepareRemove(input)
      if (!prepared.verificationRequired) throw new Error('当前删除不需要短信验证，请直接remove')
      if (!prepared.phone) throw new Error('敏感操作未配置接收手机号，无法发送验证码')
      const sent = await request<{ requestId?: string | number }>({ url: SMS_SEND_ROOT, method: 'get', params: { phone: prepared.phone, templateId: SMS_TEMPLATE_ID } })
      if (sent?.requestId === undefined || sent.requestId === null || !String(sent.requestId).trim()) throw new Error('短信响应缺少requestId；发送结果不确定，不自动重发')
      return { smsRequestId: String(sent.requestId) }
    },
    async remove (input: HrExternalStaffDeleteInput): Promise<void> {
      const prepared = await prepareRemove(input)
      if (prepared.verificationRequired) {
        if (!input.smsRequestId?.trim() || !input.code?.trim()) throw new Error('删除需要短信验证：先sendDeleteCode，再提供smsRequestId和用户收到的code')
        await request({ url: SMS_CHECK_ROOT, method: 'get', params: { requestId: input.smsRequestId, code: input.code } })
      }
      await request({ url: ROOT, method: 'delete', data: prepared.ids })
    },
  }
}

export type HrExternalStaffCapability = ReturnType<typeof createHrExternalStaffCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const HR_EXTERNAL_STAFF_METHODS = {
  'hr-external-staff-list': 'list',
  'hr-external-staff-get': 'get',
  'hr-external-staff-prepare-create': 'prepareCreate',
  'hr-external-staff-create': 'create',
  'hr-external-staff-prepare-update': 'prepareUpdate',
  'hr-external-staff-update': 'update',
  'hr-external-staff-prepare-remove': 'prepareRemove',
  'hr-external-staff-send-delete-code': 'sendDeleteCode',
  'hr-external-staff-remove': 'remove',
} as const

export const hrExternalStaffCapabilities: CapabilityDefinition[] = [
  { id: 'hr-external-staff-list', title: '查询外部员工分页', write: false, params: [p('name', 'text', false, '姓名筛选；默认空字符串'), p('mobile', 'text', false, '手机号筛选；默认空字符串'), p('orgId', 'text', false, '组织ID；默认空字符串'), p('pageNo', 'number', false, '从1开始；默认1'), p('pageSize', 'number', false, '页面支持10、20、50、100；默认20')] },
  { id: 'hr-external-staff-get', title: '读取外部员工详情', write: false, params: [p('id', 'text', true, '外部员工ID')] },
  { id: 'hr-external-staff-prepare-create', title: '准备新建外部员工', write: false, params: [p('form', 'text', true, '按Portal表单字段填写；准备阶段执行必填、长度、空格和证件号格式校验')] },
  { id: 'hr-external-staff-create', title: '创建外部员工', write: true, params: [p('draft', 'text', true, 'prepareCreate返回的新建草稿')] },
  { id: 'hr-external-staff-prepare-update', title: '准备编辑外部员工', write: false, params: [p('current', 'text', true, 'get返回的完整外部员工对象'), p('changes', 'text', false, '仅覆盖Portal编辑表单字段')] },
  { id: 'hr-external-staff-update', title: '保存外部员工编辑', write: true, params: [p('draft', 'text', true, 'prepareUpdate返回的完整草稿')] },
  { id: 'hr-external-staff-prepare-remove', title: '准备删除外部员工', write: false, params: [p('ids', 'text', true, '要删除的外部员工ID数组；当前页面行删除传单个ID')] },
  { id: 'hr-external-staff-send-delete-code', title: '发送外部员工删除验证码', write: true, params: [p('ids', 'text', true, '要删除的外部员工ID数组')] },
  { id: 'hr-external-staff-remove', title: '删除外部员工', write: true, params: [p('ids', 'text', true, '要删除的外部员工ID数组'), p('smsRequestId', 'text', false, '敏感保护开启时由sendDeleteCode返回'), p('code', 'text', false, '敏感保护开启时由手机号持有人提供')] },
].map(definition => ({
  ...definition,
  pagePath: HR_EXTERNAL_STAFF_PAGE_PATH,
  permission: HR_EXTERNAL_STAFF_PERMISSION,
  moduleType: HR_EXTERNAL_STAFF_MODULE_TYPE,
  httpInstance: 'platform',
}))
