import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「人力 → 员工 → 招聘计划」列表及其页面实际打开的子页面。 */
export const RECRUITMENT_PLAN_PAGE_PATH = '/dashboard/staff/recruitment-plan/list'
export const RECRUITMENT_PLAN_PERMISSION = '/dashboard/staff/recruitment-plan'
export const RECRUITMENT_PLAN_MODULE_TYPE = 11
export const RECRUITMENT_PLAN_FORM_PATH = 'simple/hr/form/026'
export const RECRUITMENT_PLAN_ONBOARDING_FORM_PATH = 'simple/hr/form/001'
export const RECRUITMENT_PLAN_PROCESS_KEY = 'recruitment_plan'
export const RECRUITMENT_PLAN_ONBOARDING_PROCESS_KEY = 'ruzhi'

const ROOT = '/hr/recruitment-plan'
const ORGANIZATION_TREE_URL = '/org/organization/getRoleOrganizationTree'
const POST_OPTIONS_URL = '/org/hrpost/getOrgPostList'
const SALARY_LEVEL_OPTIONS_URL = '/org/hrsalarylevel/getAllSalaryLevel'
const USER_SEARCH_LOOKUP = 'base-user-search'
const PLAN_TEMPLATE_NAME = '招聘计划导入模板.xlsx'
const RESUME_TEMPLATE_NAME = '招聘简历导入模板.xlsx'
const PLAN_PURPOSES = ['业务扩编', '人才储备', '岗位新增'] as const
const URGENCY_VALUES = ['特急', '紧急', '常规', '储备'] as const
const RECRUITMENT_TYPES = [1, 2] as const
const SEX_VALUES = [1, 2] as const
const EDUCATION_VALUES = ['博士研究生', '硕士研究生', '本科', '大专', '高中', '初中', '小学'] as const
const INTERVIEW_ROUNDS = ['初面', '复面', '终面'] as const
const INTERVIEW_CONCLUSIONS = ['优先录用', '考虑备选', '待定复试', '不予录用'] as const

export type RecruitmentPlanId = string | number

export type RecruitmentPlanQuery = {
  organizationId?: RecruitmentPlanId | null
  postId?: RecruitmentPlanId | null
  planYear?: number | null
  recruitmentType?: number | null
  status?: number | null
  createTimeStart?: string | null
  createTimeEnd?: string | null
  pageNo?: number
  pageSize?: number
}

export type RecruitmentPlanRow = Record<string, unknown> & {
  id: RecruitmentPlanId
  title?: string | null
  recruitmentType?: number | null
  recruitmentTypeName?: string | null
  planYear?: number | null
  organizationId?: RecruitmentPlanId | null
  organizationName?: string | null
  organizationFullPath?: string | null
  postId?: RecruitmentPlanId | null
  postName?: string | null
  postTypeName?: string | null
  planNumber?: number | null
  purpose?: string | null
  requirementText?: string | null
  salaryLevelMin?: RecruitmentPlanId | null
  salaryLevelMax?: RecruitmentPlanId | null
  salaryRangeName?: string | null
  urgency?: string | null
  arrivalDate?: string | null
  remark?: string | null
  status?: number | null
  statusName?: string | null
  processInstanceId?: string | null
}

export type RecruitmentPlanDraft = {
  id?: RecruitmentPlanId | null
  recruitmentType: number
  planYear: number
  organizationId: RecruitmentPlanId
  organizationName?: string | null
  postId: RecruitmentPlanId
  postName?: string | null
  planNumber: number
  purpose: string
  requirementText?: string | null
  salaryLevelMin: RecruitmentPlanId
  salaryLevelMax: RecruitmentPlanId
  urgency: string
  arrivalDate: string
  remark?: string | null
}

export type RecruitmentPlanStartUserSelectTask = Record<string, unknown> & {
  id: string
  name?: string | null
  minSelectCount?: number | null
  maxSelectCount?: number | null
  selectionOrderRequired?: boolean
}

export type RecruitmentPlanStartUserSelectAssignees = Record<string, number[]>

export type RecruitmentPlanPreparation = {
  payload: RecruitmentPlanPayload
  tasks: RecruitmentPlanStartUserSelectTask[]
}

export type RecruitmentPlanCreateInput = {
  draft: RecruitmentPlanDraft
  tasks: RecruitmentPlanStartUserSelectTask[]
  startUserSelectAssignees?: RecruitmentPlanStartUserSelectAssignees
  overwrite?: boolean
}

export type RecruitmentPlanUpdateInput = {
  draft: RecruitmentPlanDraft & { id: RecruitmentPlanId }
  tasks: RecruitmentPlanStartUserSelectTask[]
  startUserSelectAssignees?: RecruitmentPlanStartUserSelectAssignees
}

export type RecruitmentPlanFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type RecruitmentPlanFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type RecruitmentPlanOrganizationNode = Record<string, unknown> & {
  id: RecruitmentPlanId
  name?: string | null
  children?: RecruitmentPlanOrganizationNode[]
}

export type RecruitmentPlanPostOption = Record<string, unknown> & {
  id: RecruitmentPlanId
  name?: string | null
  postTypeName?: string | null
}

export type RecruitmentPlanSalaryLevelOption = Record<string, unknown> & {
  id: RecruitmentPlanId
  name?: string | null
}

export type RecruitmentResumeRow = Record<string, unknown> & {
  id: RecruitmentPlanId
  planId?: RecruitmentPlanId | null
  postId?: RecruitmentPlanId | null
  postName?: string | null
  name?: string | null
  age?: number | null
  sex?: number | null
  education?: string | null
  major?: string | null
  workYears?: string | null
  graduateSchool?: string | null
  phone?: string | null
  intendedPost?: string | null
  expectedSalary?: string | null
  attachments?: string | null
  status?: number | null
}

export type RecruitmentResumeQuery = {
  planId: RecruitmentPlanId
  postId?: RecruitmentPlanId | null
  name?: string | null
  phone?: string | null
  status?: number | null
  pageNo?: number
  pageSize?: number
}

export type RecruitmentResumeAttachment = {
  name: string
  url: string
}

export type RecruitmentResumeDraft = {
  id?: RecruitmentPlanId | null
  planId: RecruitmentPlanId
  name: string
  age: number
  sex: number
  education: string
  major: string
  workYears: string
  graduateSchool: string
  phone: string
  intendedPost: string
  expectedSalary: string
  attachments: RecruitmentResumeAttachment[]
  status?: number | null
}

export type RecruitmentResumeWriteInput = {
  draft: RecruitmentResumeDraft
  /** 已从计划详情读取的状态；提供时必须为2，Portal只允许已审批计划管理简历。 */
  planStatus?: number | null
}

export type RecruitmentInterviewRow = Record<string, unknown> & {
  id: RecruitmentPlanId
  resumeId?: RecruitmentPlanId | null
  planId?: RecruitmentPlanId | null
  interviewDate?: string | null
  interviewer?: string | null
  interviewRound?: string | null
  conclusion?: string | null
}

export type RecruitmentInterviewDraft = {
  id?: RecruitmentPlanId | null
  resumeId: RecruitmentPlanId
  interviewDate: string
  interviewer: string
  interviewRound: string
  professionalKnowledgeScore: number
  communicationScore: number
  learningAbilityScore: number
  executionAbilityScore: number
  teamworkScore: number
  stabilityScore: number
  personalAdvantage?: string | null
  personalShortcoming?: string | null
  workExperienceSummary?: string | null
  questionAnswer: string
  conclusion: string
}

export type RecruitmentInterviewWriteInput = {
  resumeId: RecruitmentPlanId
  draft: RecruitmentInterviewDraft
}

export type RecruitmentOnboardingLaunch = {
  path: typeof RECRUITMENT_PLAN_ONBOARDING_FORM_PATH
  processKey: typeof RECRUITMENT_PLAN_ONBOARDING_PROCESS_KEY
  bpmMode: 'edit'
  customQuery: {
    resumeId: RecruitmentPlanId
    planId: RecruitmentPlanId
    employeeName: string
    sex: number | null
    phone: string
    workExperience: string
    organizationId: RecruitmentPlanId | null
    organizationName: string
    postId: RecruitmentPlanId | null
    postName: string
  }
}

type JsonObject = Record<string, unknown>
type RecruitmentPlanPayload = JsonObject & {
  recruitmentType: number
  planYear: number
  organizationId: RecruitmentPlanId
  organizationName: string | null
  postId: RecruitmentPlanId
  postName: string | null
  planNumber: number
  purpose: string
  requirementText: string | null
  salaryLevelMin: RecruitmentPlanId
  salaryLevelMax: RecruitmentPlanId
  urgency: string
  arrivalDate: string
  remark: string | null
}

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): RecruitmentPlanId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function optionalIdOf (value: unknown, label: string): RecruitmentPlanId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function textOf (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  const text = textOf(value, label, maxLength)
  if (text.trim() === '') throw new Error(`${label}不能为空或全为空格`)
  return text
}

function optionalTextOf (value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined) return ''
  if (value === null) return null
  return textOf(value, label, maxLength)
}

function integerOf (value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`)
  return value as number
}

function positiveIntegerOf (value: unknown, label: string): number {
  const result = integerOf(value, label)
  if (result <= 0) throw new Error(`${label}必须为正整数`)
  return result
}

function enumOf<T extends string | number> (value: unknown, label: string, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error(`${label}只能是${values.join('、')}`)
  return value as T
}

function dateOf (value: unknown, label: string): string {
  const date = requiredTextOf(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label}必须为YYYY-MM-DD`)
  return date
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const result = value === undefined ? fallback : positiveIntegerOf(value, label)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(result)) throw new Error('pageSize必须是10、20、50或100')
  return result
}

function planYearOf (value: unknown): number {
  const year = positiveIntegerOf(value, 'planYear')
  const currentYear = new Date().getFullYear()
  if (year < currentYear) throw new Error(`planYear不能早于当前年份${currentYear}`)
  return year
}

function nullableDateOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return dateOf(value, label)
}

function listOf<T> (value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value as T[]
}

function pageOf<T> (value: unknown, label: string): PageResult<T> {
  const page = objectOf(value, label)
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || (page.total as number) < 0) {
    throw new Error(`${label}缺少有效list或total`)
  }
  return { list: page.list as T[], total: page.total as number }
}

function defaultPlanQuery (query: RecruitmentPlanQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    organizationId: optionalIdOf(query.organizationId, 'organizationId'),
    postId: optionalIdOf(query.postId, 'postId'),
    // 列表筛选没有表单的“不能早于当前年份”规则；历史年度仍可查询。
    planYear: query.planYear === undefined || query.planYear === null ? null : positiveIntegerOf(query.planYear, 'planYear'),
    recruitmentType: query.recruitmentType === undefined || query.recruitmentType === null ? null : enumOf(query.recruitmentType, 'recruitmentType', RECRUITMENT_TYPES),
    status: query.status === undefined || query.status === null ? null : integerOf(query.status, 'status'),
    createTimeStart: nullableDateTimeOf(query.createTimeStart, 'createTimeStart'),
    createTimeEnd: nullableDateTimeOf(query.createTimeEnd, 'createTimeEnd'),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function nullableDateTimeOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}必须为日期时间字符串或null`)
  return value
}

function planPayloadOf (value: unknown, requireId: boolean): RecruitmentPlanPayload & (JsonObject & { id?: RecruitmentPlanId }) {
  const input = objectOf(value, requireId ? '招聘计划更新表单' : '招聘计划新建表单')
  const id = optionalIdOf(input.id, 'id')
  if (requireId && id === null) throw new Error('招聘计划更新表单必须包含id')
  if (!requireId && id !== null) throw new Error('招聘计划新建表单不能包含id')
  const recruitmentType = enumOf(input.recruitmentType, 'recruitmentType', RECRUITMENT_TYPES)
  const planYear = planYearOf(input.planYear)
  const organizationId = idOf(input.organizationId, 'organizationId')
  const postId = idOf(input.postId, 'postId')
  const planNumber = positiveIntegerOf(input.planNumber, 'planNumber')
  const purpose = enumOf(requiredTextOf(input.purpose, 'purpose', 50), 'purpose', PLAN_PURPOSES)
  const urgency = enumOf(requiredTextOf(input.urgency, 'urgency', 20), 'urgency', URGENCY_VALUES)
  const salaryLevelMin = idOf(input.salaryLevelMin, 'salaryLevelMin')
  const salaryLevelMax = idOf(input.salaryLevelMax, 'salaryLevelMax')
  const payload: RecruitmentPlanPayload & (JsonObject & { id?: RecruitmentPlanId }) = {
    ...(id === null ? {} : { id }),
    recruitmentType,
    planYear,
    organizationId,
    organizationName: input.organizationName === undefined || input.organizationName === null ? null : textOf(input.organizationName, 'organizationName', 100),
    postId,
    postName: input.postName === undefined || input.postName === null ? null : textOf(input.postName, 'postName', 100),
    planNumber,
    purpose,
    requirementText: optionalTextOf(input.requirementText, 'requirementText', 1000),
    salaryLevelMin,
    salaryLevelMax,
    urgency,
    arrivalDate: dateOf(input.arrivalDate, 'arrivalDate'),
    remark: optionalTextOf(input.remark, 'remark', 1000),
  }
  return payload
}

function tasksOf (value: unknown): RecruitmentPlanStartUserSelectTask[] {
  return listOf<RecruitmentPlanStartUserSelectTask>(value, '招聘计划审批人节点')
    .map((raw, index) => {
      const task = objectOf(raw, `招聘计划审批人节点[${index}]`)
      if (typeof task.id !== 'string' || task.id.trim() === '') throw new Error(`招聘计划审批人节点[${index}].id不能为空`)
      return { ...task, id: task.id }
    })
}

function assigneesOf (value: unknown, tasks: RecruitmentPlanStartUserSelectTask[]): RecruitmentPlanStartUserSelectAssignees {
  const input = value === undefined || value === null ? {} : objectOf(value, 'startUserSelectAssignees')
  const taskIds = new Set(tasks.map(task => task.id))
  for (const key of Object.keys(input)) if (!taskIds.has(key)) throw new Error(`startUserSelectAssignees包含未知节点${key}`)
  const result: RecruitmentPlanStartUserSelectAssignees = {}
  for (const task of tasks) {
    const raw = input[task.id]
    if (raw === undefined) {
      if ((task.minSelectCount ?? 0) > 0) throw new Error(`审批节点${task.name ?? task.id}至少需要选择${task.minSelectCount}人`)
      result[task.id] = []
      continue
    }
    if (!Array.isArray(raw)) throw new Error(`审批节点${task.name ?? task.id}的审批人必须为数组`)
    const ids = raw.map((id, index) => positiveIntegerOf(id, `startUserSelectAssignees.${task.id}[${index}]`))
    if (new Set(ids).size !== ids.length) throw new Error(`审批节点${task.name ?? task.id}不能重复选择同一审批人`)
    if (task.minSelectCount !== null && task.minSelectCount !== undefined && ids.length < task.minSelectCount) throw new Error(`审批节点${task.name ?? task.id}至少需要选择${task.minSelectCount}人`)
    if (task.maxSelectCount !== null && task.maxSelectCount !== undefined && ids.length > task.maxSelectCount) throw new Error(`审批节点${task.name ?? task.id}最多选择${task.maxSelectCount}人`)
    result[task.id] = ids
  }
  return result
}

function fileBytesOf (input: RecruitmentPlanFileInput, extensions: RegExp, label: string): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, label)
  const fileName = requiredTextOf(value.fileName, `${label}.fileName`)
  if (!extensions.test(fileName)) throw new Error(`${label}.fileName扩展名不符合Portal限制`)
  const base64 = requiredTextOf(value.base64, `${label}.base64`).replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(`${label}.base64不是合法的标准Base64`)
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}不能是空文件`)
  const contentType = typeof value.contentType === 'string' && value.contentType
    ? value.contentType
    : fileName.toLowerCase().endsWith('.xls') && !fileName.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: RecruitmentPlanFileInput, extensions: RegExp, label: string) {
  const file = fileBytesOf(input, extensions, label)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function downloadedFileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): RecruitmentPlanFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0) throw new Error('招聘计划模板响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const disposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof disposition === 'string' ? disposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function startTasksPayload (input: unknown, label: string): { payload: RecruitmentPlanPayload & { id?: RecruitmentPlanId }; draft: RecruitmentPlanPayload & { id?: RecruitmentPlanId } } {
  const draft = planPayloadOf(input, label === '更新' )
  return { payload: draft, draft }
}

function resumePayloadOf (value: unknown, requireId: boolean): JsonObject & { id?: RecruitmentPlanId; planId: RecruitmentPlanId } {
  const input = objectOf(value, requireId ? '招聘简历更新表单' : '招聘简历新建表单')
  const id = optionalIdOf(input.id, 'id')
  if (requireId && id === null) throw new Error('招聘简历更新表单必须包含id')
  if (!requireId && id !== null) throw new Error('招聘简历新建表单不能包含id')
  const attachments = input.attachments
  if (!Array.isArray(attachments) || attachments.length < 1 || attachments.length > 3) throw new Error('attachments必须为1到3件已上传附件')
  const normalizedAttachments = attachments.map((raw, index) => {
    const attachment = objectOf(raw, `attachments[${index}]`)
    return {
      name: requiredTextOf(attachment.name, `attachments[${index}].name`),
      url: requiredTextOf(attachment.url, `attachments[${index}].url`),
    }
  })
  const result: JsonObject & { id?: RecruitmentPlanId; planId: RecruitmentPlanId } = {
    ...(id === null ? {} : { id }),
    planId: idOf(input.planId, 'planId'),
    name: requiredTextOf(input.name, 'name', 10),
    age: (() => { const age = positiveIntegerOf(input.age, 'age'); if (age > 100) throw new Error('age不能大于100'); return age })(),
    sex: enumOf(input.sex, 'sex', SEX_VALUES),
    education: enumOf(requiredTextOf(input.education, 'education', 20), 'education', EDUCATION_VALUES),
    major: requiredTextOf(input.major, 'major', 20),
    workYears: requiredTextOf(input.workYears, 'workYears', 20),
    graduateSchool: requiredTextOf(input.graduateSchool, 'graduateSchool', 20),
    phone: requiredTextOf(input.phone, 'phone', 20),
    intendedPost: requiredTextOf(input.intendedPost, 'intendedPost', 20),
    expectedSalary: requiredTextOf(input.expectedSalary, 'expectedSalary', 20),
    attachments: JSON.stringify(normalizedAttachments),
  }
  if (input.status !== undefined && input.status !== null) result.status = integerOf(input.status, 'status')
  return result
}

function assertApprovedPlan (planStatus: unknown): void {
  if (planStatus !== undefined && planStatus !== null && planStatus !== 2) throw new Error('只有status=2（已审批）的招聘计划可以管理简历')
}

function interviewPayloadOf (value: unknown, requireId: boolean, resumeId: RecruitmentPlanId): JsonObject & { resumeId: RecruitmentPlanId; id?: RecruitmentPlanId } {
  const input = objectOf(value, requireId ? '面试记录更新表单' : '面试记录新建表单')
  const id = optionalIdOf(input.id, 'id')
  if (requireId && id === null) throw new Error('面试记录更新表单必须包含id')
  if (!requireId && id !== null) throw new Error('面试记录新建表单不能包含id')
  const score = (name: string): number => { const value = positiveIntegerOf(input[name], name); if (value > 10) throw new Error(`${name}必须在1到10之间`); return value }
  const result: JsonObject & { resumeId: RecruitmentPlanId; id?: RecruitmentPlanId } = {
    ...(id === null ? {} : { id }),
    resumeId: idOf(resumeId, 'resumeId'),
    interviewDate: dateOf(input.interviewDate, 'interviewDate'),
    interviewer: requiredTextOf(input.interviewer, 'interviewer', 50),
    interviewRound: enumOf(requiredTextOf(input.interviewRound, 'interviewRound', 20), 'interviewRound', INTERVIEW_ROUNDS),
    professionalKnowledgeScore: score('professionalKnowledgeScore'),
    communicationScore: score('communicationScore'),
    learningAbilityScore: score('learningAbilityScore'),
    executionAbilityScore: score('executionAbilityScore'),
    teamworkScore: score('teamworkScore'),
    stabilityScore: score('stabilityScore'),
    personalAdvantage: optionalTextOf(input.personalAdvantage, 'personalAdvantage', 500),
    personalShortcoming: optionalTextOf(input.personalShortcoming, 'personalShortcoming', 500),
    workExperienceSummary: optionalTextOf(input.workExperienceSummary, 'workExperienceSummary', 500),
    questionAnswer: requiredTextOf(input.questionAnswer, 'questionAnswer', 500),
    conclusion: enumOf(requiredTextOf(input.conclusion, 'conclusion', 20), 'conclusion', INTERVIEW_CONCLUSIONS),
  }
  return result
}

export function createRecruitmentPlanCapability (request: PortalRequest) {
  const validatePlanPreparation = (tasks: RecruitmentPlanStartUserSelectTask[], assignees?: RecruitmentPlanStartUserSelectAssignees) => assigneesOf(assignees, tasks)
  const fileInput = (input: RecruitmentPlanFileInput, resume = false) => fileBytesOf(input, resume ? /\.(xlsx|xls)$/i : /\.xlsx$/, resume ? '招聘简历导入文件' : '招聘计划导入文件')

  return {
    async list (query: RecruitmentPlanQuery = {}): Promise<PageResult<RecruitmentPlanRow>> {
      return pageOf<RecruitmentPlanRow>(await request({ url: `${ROOT}/page`, method: 'get', params: defaultPlanQuery(query) }), '招聘计划分页响应')
    },

    async get (input: { id: RecruitmentPlanId }): Promise<RecruitmentPlanRow> {
      const id = idOf(input?.id, '招聘计划id')
      return await request<RecruitmentPlanRow>({ url: `${ROOT}/get`, method: 'get', params: { id } })
    },

    async organizationTree (): Promise<RecruitmentPlanOrganizationNode[]> {
      return listOf<RecruitmentPlanOrganizationNode>(await request({ url: ORGANIZATION_TREE_URL, method: 'get' }), '招聘计划组织树')
    },

    async postOptions (input: { organizationId: RecruitmentPlanId; selectedPostId?: RecruitmentPlanId | null }): Promise<RecruitmentPlanPostOption[]> {
      const organizationId = idOf(input?.organizationId, 'organizationId')
      return listOf<RecruitmentPlanPostOption>(await request({ url: POST_OPTIONS_URL, method: 'get', params: { orgId: organizationId, id: optionalIdOf(input?.selectedPostId, 'selectedPostId') } }), '招聘计划岗位候选')
    },

    async salaryLevelOptions (): Promise<RecruitmentPlanSalaryLevelOption[]> {
      return listOf<RecruitmentPlanSalaryLevelOption>(await request({ url: SALARY_LEVEL_OPTIONS_URL, method: 'get' }), '招聘计划薪资等级候选')
    },

    async prepare (draft: RecruitmentPlanDraft): Promise<RecruitmentPlanPreparation> {
      const { payload } = startTasksPayload(draft, '新建')
      const tasks = tasksOf(await request({ url: `${ROOT}/getRequiredStartUserSelectTasks`, method: 'post', data: payload }))
      return { payload, tasks }
    },

    async create (input: RecruitmentPlanCreateInput): Promise<RecruitmentPlanId> {
      const { payload } = startTasksPayload(input?.draft, '新建')
      if (!Array.isArray(input?.tasks)) throw new Error('create必须使用prepare返回的tasks，不能跳过审批人节点准备')
      const startUserSelectAssignees = validatePlanPreparation(input.tasks, input.startUserSelectAssignees)
      const result = await request<unknown>({
        url: `${ROOT}/create`,
        method: 'post',
        data: { ...payload, overwrite: input.overwrite ?? false, startUserSelectAssignees },
      })
      return idOf(result, '创建招聘计划返回ID')
    },

    async prepareUpdate (input: { current: RecruitmentPlanRow; changes?: Partial<RecruitmentPlanDraft> }): Promise<RecruitmentPlanPreparation & { draft: RecruitmentPlanDraft & { id: RecruitmentPlanId } }> {
      const current = objectOf(input?.current, '招聘计划当前详情') as RecruitmentPlanRow
      if (current.status !== 3) throw new Error('只有status=3（已驳回）的招聘计划可以编辑并重新提交')
      const merged = { ...current, ...(input?.changes ?? {}) }
      const { payload } = startTasksPayload(merged, '更新')
      const tasks = tasksOf(await request({ url: `${ROOT}/getRequiredStartUserSelectTasks`, method: 'post', data: payload }))
      return { payload, tasks, draft: payload as RecruitmentPlanDraft & { id: RecruitmentPlanId } }
    },

    async update (input: RecruitmentPlanUpdateInput): Promise<boolean> {
      const { payload } = startTasksPayload(input?.draft, '更新')
      if (!Array.isArray(input?.tasks)) throw new Error('update必须使用prepareUpdate返回的tasks，不能跳过审批人节点准备')
      const startUserSelectAssignees = validatePlanPreparation(input.tasks, input.startUserSelectAssignees)
      const result = await request<unknown>({ url: `${ROOT}/update`, method: 'put', data: { ...payload, startUserSelectAssignees } })
      if (result !== true) throw new Error('更新招聘计划响应不是true')
      return true
    },

    async cancel (input: { id: RecruitmentPlanId; currentStatus: number }): Promise<boolean> {
      const id = idOf(input?.id, '招聘计划id')
      if (input?.currentStatus !== 1) throw new Error('只有status=1（审批中）的招聘计划可以撤销')
      const result = await request<unknown>({ url: `${ROOT}/cancel/${id}`, method: 'post' })
      if (result !== true) throw new Error('撤销招聘计划响应不是true')
      return true
    },

    prepareDelete (input: { id: RecruitmentPlanId; currentStatus: number }): { id: RecruitmentPlanId } {
      const id = idOf(input?.id, '招聘计划id')
      if (input?.currentStatus === 1) throw new Error('status=1（审批中）的招聘计划不能删除')
      return { id }
    },

    async remove (input: { id: RecruitmentPlanId; currentStatus: number }): Promise<boolean> {
      const prepared = this.prepareDelete(input)
      const result = await request<unknown>({ url: `${ROOT}/delete/${prepared.id}`, method: 'delete' })
      if (result !== true) throw new Error('删除招聘计划响应不是true')
      return true
    },

    async downloadTemplate (input: { organizationId: RecruitmentPlanId }): Promise<RecruitmentPlanFile> {
      const organizationId = idOf(input?.organizationId, 'organizationId')
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/import-template`, method: 'get', params: { organizationId }, responseType: 'arraybuffer' })
      return downloadedFileOf(response, PLAN_TEMPLATE_NAME)
    },

    prepareImport (input: RecruitmentPlanFileInput) {
      return filePreviewOf(input, /\.xlsx$/, '招聘计划导入文件')
    },

    async importExcel (input: RecruitmentPlanFileInput & { overwrite?: boolean }): Promise<string> {
      const file = fileInput(input)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      const result = await request<unknown>({ url: `${ROOT}/import?overwrite=${input.overwrite === true ? 'true' : 'false'}`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } })
      return requiredTextOf(result, '招聘计划导入响应')
    },

    async resumeList (query: RecruitmentResumeQuery): Promise<PageResult<RecruitmentResumeRow>> {
      const planId = idOf(query?.planId, 'planId')
      return pageOf<RecruitmentResumeRow>(await request({
        url: `${ROOT}/resume/page`,
        method: 'get',
        params: {
          order: '', orderField: '', name: query.name ?? '', phone: query.phone ?? '', status: query.status ?? null,
          planId, postId: optionalIdOf(query.postId, 'postId'), pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'), pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
        },
      }), '招聘简历分页响应')
    },

    prepareResumeCreate (input: RecruitmentResumeWriteInput): { draft: JsonObject & { planId: RecruitmentPlanId } } {
      assertApprovedPlan(input?.planStatus)
      return { draft: resumePayloadOf(input?.draft, false) }
    },

    async createResume (input: RecruitmentResumeWriteInput): Promise<RecruitmentPlanId> {
      const prepared = this.prepareResumeCreate(input)
      const result = await request<unknown>({ url: `${ROOT}/resume/create`, method: 'post', data: prepared.draft })
      return idOf(result, '创建招聘简历返回ID')
    },

    prepareResumeUpdate (input: RecruitmentResumeWriteInput): { draft: JsonObject & { planId: RecruitmentPlanId; id: RecruitmentPlanId } } {
      assertApprovedPlan(input?.planStatus)
      return { draft: resumePayloadOf(input?.draft, true) as JsonObject & { planId: RecruitmentPlanId; id: RecruitmentPlanId } }
    },

    async updateResume (input: RecruitmentResumeWriteInput): Promise<boolean> {
      const prepared = this.prepareResumeUpdate(input)
      const result = await request<unknown>({ url: `${ROOT}/resume/update`, method: 'put', data: prepared.draft })
      if (result !== true) throw new Error('更新招聘简历响应不是true')
      return true
    },

    prepareResumeDelete (input: { id: RecruitmentPlanId }): { id: RecruitmentPlanId } {
      return { id: idOf(input?.id, '招聘简历id') }
    },

    async removeResume (input: { id: RecruitmentPlanId }): Promise<boolean> {
      const prepared = this.prepareResumeDelete(input)
      const result = await request<unknown>({ url: `${ROOT}/resume/delete/${prepared.id}`, method: 'delete' })
      if (result !== true) throw new Error('删除招聘简历响应不是true')
      return true
    },

    async downloadResumeTemplate (): Promise<RecruitmentPlanFile> {
      const response = await request<AxiosResponse<ArrayBuffer>>({ url: `${ROOT}/resume/import-template`, method: 'get', responseType: 'arraybuffer' })
      return downloadedFileOf(response, RESUME_TEMPLATE_NAME)
    },

    prepareResumeImport (input: RecruitmentPlanFileInput) {
      return filePreviewOf(input, /\.(xlsx|xls)$/i, '招聘简历导入文件')
    },

    async importResumes (input: { planId: RecruitmentPlanId; file: RecruitmentPlanFileInput }): Promise<string> {
      const planId = idOf(input?.planId, 'planId')
      const file = fileInput(input?.file, true)
      const data = new FormData()
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
      data.append('planId', String(planId))
      data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
      return requiredTextOf(await request<unknown>({ url: `${ROOT}/resume/import`, method: 'post', data, headers: { 'Content-Type': 'multipart/form-data' } }), '招聘简历导入响应')
    },

    prepareOnboarding (input: { plan: RecruitmentPlanRow; resume: RecruitmentResumeRow }): RecruitmentOnboardingLaunch {
      const plan = objectOf(input?.plan, '招聘计划') as RecruitmentPlanRow
      const resume = objectOf(input?.resume, '招聘简历') as RecruitmentResumeRow
      if (resume.status !== 1) throw new Error('只有status=1（适合）的招聘简历可以申请入职')
      return {
        path: RECRUITMENT_PLAN_ONBOARDING_FORM_PATH,
        processKey: RECRUITMENT_PLAN_ONBOARDING_PROCESS_KEY,
        bpmMode: 'edit',
        customQuery: {
          resumeId: idOf(resume.id, 'resume.id'),
          planId: idOf(resume.planId ?? plan.id, 'planId'),
          employeeName: textOf(resume.name ?? '', 'resume.name', 10),
          sex: resume.sex === null || resume.sex === undefined ? null : enumOf(resume.sex, 'resume.sex', SEX_VALUES),
          phone: textOf(resume.phone ?? '', 'resume.phone', 20),
          workExperience: textOf(resume.workYears ?? '', 'resume.workYears', 20),
          organizationId: optionalIdOf(plan.organizationId, 'plan.organizationId'),
          organizationName: textOf(plan.organizationName ?? '', 'plan.organizationName', 100),
          postId: optionalIdOf(plan.postId, 'plan.postId'),
          postName: textOf(plan.postName ?? '', 'plan.postName', 100),
        },
      }
    },

    async interviewList (input: { planId: RecruitmentPlanId; resumeId: RecruitmentPlanId }): Promise<PageResult<RecruitmentInterviewRow>> {
      const planId = idOf(input?.planId, 'planId')
      const resumeId = idOf(input?.resumeId, 'resumeId')
      return pageOf<RecruitmentInterviewRow>(await request({ url: `${ROOT}/interview/page`, method: 'get', params: { pageNo: 1, pageSize: 100, planId, resumeId } }), '招聘面试分页响应')
    },

    prepareInterviewCreate (input: RecruitmentInterviewWriteInput): { draft: JsonObject & { resumeId: RecruitmentPlanId } } {
      return { draft: interviewPayloadOf(input?.draft, false, input?.resumeId) }
    },

    async createInterview (input: RecruitmentInterviewWriteInput): Promise<RecruitmentPlanId> {
      const prepared = this.prepareInterviewCreate(input)
      const result = await request<unknown>({ url: `${ROOT}/interview/create`, method: 'post', data: prepared.draft })
      return idOf(result, '创建招聘面试记录返回ID')
    },

    prepareInterviewUpdate (input: RecruitmentInterviewWriteInput): { draft: JsonObject & { resumeId: RecruitmentPlanId; id: RecruitmentPlanId } } {
      return { draft: interviewPayloadOf(input?.draft, true, input?.resumeId) as JsonObject & { resumeId: RecruitmentPlanId; id: RecruitmentPlanId } }
    },

    async updateInterview (input: RecruitmentInterviewWriteInput): Promise<boolean> {
      const prepared = this.prepareInterviewUpdate(input)
      const result = await request<unknown>({ url: `${ROOT}/interview/update`, method: 'put', data: prepared.draft })
      if (result !== true) throw new Error('更新招聘面试记录响应不是true')
      return true
    },

    prepareInterviewDelete (input: { id: RecruitmentPlanId }): { id: RecruitmentPlanId } {
      return { id: idOf(input?.id, '招聘面试记录id') }
    },

    async removeInterview (input: { id: RecruitmentPlanId }): Promise<boolean> {
      const prepared = this.prepareInterviewDelete(input)
      const result = await request<unknown>({ url: `${ROOT}/interview/delete/${prepared.id}`, method: 'delete' })
      if (result !== true) throw new Error('删除招聘面试记录响应不是true')
      return true
    },
  }
}

export type RecruitmentPlanCapability = ReturnType<typeof createRecruitmentPlanCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string, options?: ParamSpec['options']): ParamSpec => ({ name, kind, required, ...(description ? { description } : {}), ...(options ? { options } : {}) })
const planDraftParams: ParamSpec[] = [
  p('draft', 'text', true, '招聘计划表单；prepare会按Portal规则校验并只提交Java DTO字段'),
]
const taskParams: ParamSpec = p('tasks', 'text', true, 'prepare或prepareUpdate返回的审批人节点数组；不能跳过准备请求')
const assigneeParam: ParamSpec = {
  name: 'startUserSelectAssignees',
  kind: 'search',
  required: false,
  description: '按节点id映射审批人ID数组；人员候选复用base-user-search，节点规则以prepare返回为准',
  lookup: { capabilityId: USER_SEARCH_LOOKUP, keywordParam: 'keyword' },
}
const fileParams: ParamSpec[] = [p('fileName', 'text', true, '文件名；计划导入只支持.xlsx，简历导入支持.xlsx/.xls'), p('base64', 'text', true, '文件内容Base64'), p('contentType', 'text', false, '文件MIME类型')]

export const RECRUITMENT_PLAN_METHODS = {
  'recruitment-plan-list': 'list',
  'recruitment-plan-get': 'get',
  'recruitment-plan-organization-tree': 'organizationTree',
  'recruitment-plan-post-options': 'postOptions',
  'recruitment-plan-salary-level-options': 'salaryLevelOptions',
  'recruitment-plan-prepare': 'prepare',
  'recruitment-plan-create': 'create',
  'recruitment-plan-prepare-update': 'prepareUpdate',
  'recruitment-plan-update': 'update',
  'recruitment-plan-cancel': 'cancel',
  'recruitment-plan-prepare-delete': 'prepareDelete',
  'recruitment-plan-remove': 'remove',
  'recruitment-plan-download-template': 'downloadTemplate',
  'recruitment-plan-prepare-import': 'prepareImport',
  'recruitment-plan-import': 'importExcel',
  'recruitment-plan-resume-list': 'resumeList',
  'recruitment-plan-resume-prepare-create': 'prepareResumeCreate',
  'recruitment-plan-resume-create': 'createResume',
  'recruitment-plan-resume-prepare-update': 'prepareResumeUpdate',
  'recruitment-plan-resume-update': 'updateResume',
  'recruitment-plan-resume-prepare-delete': 'prepareResumeDelete',
  'recruitment-plan-resume-remove': 'removeResume',
  'recruitment-plan-resume-download-template': 'downloadResumeTemplate',
  'recruitment-plan-resume-prepare-import': 'prepareResumeImport',
  'recruitment-plan-resume-import': 'importResumes',
  'recruitment-plan-prepare-onboarding': 'prepareOnboarding',
  'recruitment-plan-interview-list': 'interviewList',
  'recruitment-plan-interview-prepare-create': 'prepareInterviewCreate',
  'recruitment-plan-interview-create': 'createInterview',
  'recruitment-plan-interview-prepare-update': 'prepareInterviewUpdate',
  'recruitment-plan-interview-update': 'updateInterview',
  'recruitment-plan-interview-prepare-delete': 'prepareInterviewDelete',
  'recruitment-plan-interview-remove': 'removeInterview',
} as const

export const recruitmentPlanCapabilities: CapabilityDefinition[] = [
  { id: 'recruitment-plan-list', title: '查询招聘计划分页', write: false, params: [p('organizationId', 'tree'), p('postId', 'tree'), p('planYear', 'date'), p('recruitmentType', 'enum', false, '1计划内、2计划外', [{ value: 1, label: '计划内' }, { value: 2, label: '计划外' }]), p('status', 'enum'), p('createTimeStart', 'date'), p('createTimeEnd', 'date'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'recruitment-plan-get', title: '读取招聘计划详情', write: false, params: [p('id', 'number', true, '招聘计划ID')] },
  { id: 'recruitment-plan-organization-tree', title: '读取招聘计划组织候选', write: false, params: [] },
  { id: 'recruitment-plan-post-options', title: '按组织读取招聘岗位候选', write: false, params: [p('organizationId', 'tree', true), p('selectedPostId', 'number')] },
  { id: 'recruitment-plan-salary-level-options', title: '读取招聘薪资等级候选', write: false, params: [] },
  { id: 'recruitment-plan-prepare', title: '准备新建招聘计划并读取审批人节点', write: false, params: planDraftParams },
  { id: 'recruitment-plan-create', title: '提交新建招聘计划', write: true, params: [...planDraftParams, taskParams, assigneeParam, p('overwrite', 'boolean')] },
  { id: 'recruitment-plan-prepare-update', title: '准备被驳回的招聘计划重新提交', write: false, params: [p('current', 'text', true), p('changes', 'text')] },
  { id: 'recruitment-plan-update', title: '重新提交被驳回的招聘计划', write: true, params: [p('draft', 'text', true), taskParams, assigneeParam] },
  { id: 'recruitment-plan-cancel', title: '撤销审批中的招聘计划', write: true, params: [p('id', 'number', true), p('currentStatus', 'enum', true, '必须为1审批中', [{ value: 1, label: '审批中' }])] },
  { id: 'recruitment-plan-prepare-delete', title: '准备删除招聘计划', write: false, params: [p('id', 'number', true), p('currentStatus', 'enum', true, '必须不是1审批中')] },
  { id: 'recruitment-plan-remove', title: '删除招聘计划及其简历和面试记录', write: true, params: [p('id', 'number', true), p('currentStatus', 'enum', true, '必须不是1审批中')] },
  { id: 'recruitment-plan-download-template', title: '下载招聘计划导入模板', write: false, params: [p('organizationId', 'tree', true)] },
  { id: 'recruitment-plan-prepare-import', title: '准备导入招聘计划Excel', write: false, params: fileParams },
  { id: 'recruitment-plan-import', title: '导入招聘计划Excel', write: true, params: [...fileParams, p('overwrite', 'boolean')] },
  { id: 'recruitment-plan-resume-list', title: '查询招聘简历分页', write: false, params: [p('planId', 'number', true), p('postId', 'number'), p('name', 'text'), p('phone', 'text'), p('status', 'number'), p('pageNo', 'number'), p('pageSize', 'number')] },
  { id: 'recruitment-plan-resume-prepare-create', title: '准备新建招聘简历', write: false, params: [p('draft', 'text', true), p('planStatus', 'enum', false, '已知时必须为2已审批', [{ value: 2, label: '已审批' }])] },
  { id: 'recruitment-plan-resume-create', title: '新建招聘简历', write: true, params: [p('draft', 'text', true), p('planStatus', 'enum', false, '已知时必须为2已审批', [{ value: 2, label: '已审批' }])] },
  { id: 'recruitment-plan-resume-prepare-update', title: '准备编辑招聘简历', write: false, params: [p('draft', 'text', true), p('planStatus', 'enum', false, '已知时必须为2已审批', [{ value: 2, label: '已审批' }])] },
  { id: 'recruitment-plan-resume-update', title: '编辑招聘简历', write: true, params: [p('draft', 'text', true), p('planStatus', 'enum', false, '已知时必须为2已审批', [{ value: 2, label: '已审批' }])] },
  { id: 'recruitment-plan-resume-prepare-delete', title: '准备删除招聘简历', write: false, params: [p('id', 'number', true)] },
  { id: 'recruitment-plan-resume-remove', title: '删除招聘简历及其面试记录', write: true, params: [p('id', 'number', true)] },
  { id: 'recruitment-plan-resume-download-template', title: '下载招聘简历导入模板', write: false, params: [] },
  { id: 'recruitment-plan-resume-prepare-import', title: '准备导入招聘简历Excel', write: false, params: fileParams },
  { id: 'recruitment-plan-resume-import', title: '导入招聘简历Excel', write: true, params: [p('planId', 'number', true), ...fileParams] },
  { id: 'recruitment-plan-prepare-onboarding', title: '准备从简历打开入职流程表单', write: false, params: [p('plan', 'text', true), p('resume', 'text', true)] },
  { id: 'recruitment-plan-interview-list', title: '查询招聘简历面试记录', write: false, params: [p('planId', 'number', true), p('resumeId', 'number', true)] },
  { id: 'recruitment-plan-interview-prepare-create', title: '准备新建面试记录', write: false, params: [p('resumeId', 'number', true), p('draft', 'text', true)] },
  { id: 'recruitment-plan-interview-create', title: '新建面试记录', write: true, params: [p('resumeId', 'number', true), p('draft', 'text', true)] },
  { id: 'recruitment-plan-interview-prepare-update', title: '准备编辑面试记录', write: false, params: [p('resumeId', 'number', true), p('draft', 'text', true)] },
  { id: 'recruitment-plan-interview-update', title: '编辑面试记录', write: true, params: [p('resumeId', 'number', true), p('draft', 'text', true)] },
  { id: 'recruitment-plan-interview-prepare-delete', title: '准备删除面试记录', write: false, params: [p('id', 'number', true)] },
  { id: 'recruitment-plan-interview-remove', title: '删除面试记录', write: true, params: [p('id', 'number', true)] },
].map(definition => ({
  ...definition,
  pagePath: RECRUITMENT_PLAN_PAGE_PATH,
  permission: RECRUITMENT_PLAN_PERMISSION,
  moduleType: RECRUITMENT_PLAN_MODULE_TYPE,
  httpInstance: 'platform',
}))
