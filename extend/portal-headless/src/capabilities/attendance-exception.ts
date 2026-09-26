import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「组织管理 → 考勤管理 → 异常统计」。列表、详情和附件上传。 */
export const ATTENDANCE_EXCEPTION_PAGE_PATH = '/dashboard/attendance/attendance-exception/list'
export const ATTENDANCE_EXCEPTION_PERMISSION = '/dashboard/attendance/attendance-exception'
export const ATTENDANCE_EXCEPTION_MODULE_TYPE = 11

const LIST_URL = '/org/hrWorkSchedule/getAbsentUserList'
const DETAIL_URL = '/org/hrWorkSchedule/getAbsentUserInfo'
const UPLOAD_URL = '/org/hrWorkSchedule/uploadAbsentFile'

export type AttendanceExceptionId = string | number

export type AttendanceExceptionQuery = {
  /** Portal月份选择器值；默认当前月份，不能选择未来月份。 */
  yearMonth?: string
  /** 角色组织树选中的组织ID数组；未筛选时发送空数组。 */
  organizationIdList?: AttendanceExceptionId[]
  name?: string | null
  staffCode?: string | null
  /** 1=已上传附件，0=未上传，null=不筛选。 */
  isUploadFile?: 0 | 1 | null
  pageNo?: number
  pageSize?: number
}

export type AttendanceExceptionAttachment = {
  url: string
  name: string
}

export type AttendanceExceptionRow = Record<string, unknown> & {
  userId: AttendanceExceptionId | null
  name: string | null
  staffCode: AttendanceExceptionId | null
  organizationName: string | null
  leaveTime: string | number | null
  retireTime: string | number | null
  entryTime: string | number | null
  absentId: AttendanceExceptionId | null
  absentResourceId: string | null
  type: string | number | null
  processInstanceId: string | null
}

export type AttendanceExceptionDetail = Record<string, unknown> & {
  id: AttendanceExceptionId | null
  name: string | null
  amPm: number | null
  type: number | null
  typeName: string | null
  startDate: string | number | null
  absentFileList: AttendanceExceptionAttachment[] | null
}

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): AttendanceExceptionId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空字符串或安全整数`)
}

function nullableIdOf (value: unknown, label: string): AttendanceExceptionId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function scalarOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function nullableNumberOf (value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须为有限数字或null`)
  return value
}

function yearMonthOf (value: unknown, fallback = new Date()): string {
  const current = `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`
  const resolved = value === undefined ? current : value
  if (typeof resolved !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(resolved)) throw new Error('yearMonth必须是YYYY-MM格式')
  if (resolved > current) throw new Error('yearMonth不能晚于当前月份；Portal月份选择器禁止未来月份')
  return resolved
}

function organizationIdListOf (value: unknown): AttendanceExceptionId[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('organizationIdList必须是数组')
  return value.map((item, index) => idOf(item, `organizationIdList[${index}]`))
}

function nullableInputTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function uploadFlagOf (value: unknown): 0 | 1 | null {
  if (value === undefined || value === null) return null
  if (value === 0 || value === 1) return value
  throw new Error('isUploadFile只能是0、1或null')
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function formOf (query: AttendanceExceptionQuery = {}): Record<string, unknown> {
  return {
    yearMonth: yearMonthOf(query.yearMonth),
    organizationIdList: organizationIdListOf(query.organizationIdList),
    name: nullableInputTextOf(query.name, 'name'),
    staffCode: nullableInputTextOf(query.staffCode, 'staffCode'),
    isUploadFile: uploadFlagOf(query.isUploadFile),
  }
}

function listParamsOf (query: AttendanceExceptionQuery = {}): Record<string, unknown> {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label: string): AttendanceExceptionRow {
  const row = objectOf(value, label)
  return {
    ...row,
    userId: nullableIdOf(row.userId, `${label}.userId`),
    name: nullableTextOf(row.name, `${label}.name`),
    staffCode: nullableIdOf(row.staffCode, `${label}.staffCode`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    leaveTime: scalarOf(row.leaveTime, `${label}.leaveTime`),
    retireTime: scalarOf(row.retireTime, `${label}.retireTime`),
    entryTime: scalarOf(row.entryTime, `${label}.entryTime`),
    absentId: nullableIdOf(row.absentId, `${label}.absentId`),
    absentResourceId: nullableTextOf(row.absentResourceId, `${label}.absentResourceId`),
    type: scalarOf(row.type, `${label}.type`),
    processInstanceId: nullableTextOf(row.processInstanceId, `${label}.processInstanceId`),
  }
}

function pageOf (value: unknown): PageResult<AttendanceExceptionRow> {
  const page = objectOf(value, '异常统计分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('异常统计分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `异常统计分页响应.list[${index}]`)), total: Number(page.total) }
}

function attachmentOf (value: unknown, label: string): AttendanceExceptionAttachment {
  const item = objectOf(value, label)
  if (typeof item.url !== 'string' || item.url.trim() === '') throw new Error(`${label}.url必须是非空字符串；先用base-upload-file上传到HR/risk`)
  if (typeof item.name !== 'string' || item.name.trim() === '') throw new Error(`${label}.name必须是非空字符串`)
  return { url: item.url, name: item.name }
}

function attachmentsOf (value: unknown): AttendanceExceptionAttachment[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('absentFileList必须是至少包含一项的附件数组')
  if (value.length > 10) throw new Error('absentFileList最多10项；Portal上传组件的max为10')
  return value.map((item, index) => attachmentOf(item, `absentFileList[${index}]`))
}

function detailOf (value: unknown): AttendanceExceptionDetail {
  const detail = objectOf(value, '异常统计详情响应')
  const absentFiles = detail.absentFileList
  if (absentFiles !== undefined && absentFiles !== null && !Array.isArray(absentFiles)) throw new Error('异常统计详情响应.absentFileList必须是数组或null')
  return {
    ...detail,
    id: nullableIdOf(detail.id, '异常统计详情响应.id'),
    name: nullableTextOf(detail.name, '异常统计详情响应.name'),
    amPm: nullableNumberOf(detail.amPm, '异常统计详情响应.amPm'),
    type: nullableNumberOf(detail.type, '异常统计详情响应.type'),
    typeName: nullableTextOf(detail.typeName, '异常统计详情响应.typeName'),
    startDate: scalarOf(detail.startDate, '异常统计详情响应.startDate'),
    absentFileList: absentFiles === undefined || absentFiles === null ? null : absentFiles.map((item, index) => attachmentOf(item, `异常统计详情响应.absentFileList[${index}]`)),
  }
}

/** The injected request must use ATTENDANCE_EXCEPTION_PAGE_PATH as its page context. */
export function createAttendanceExceptionCapability (request: PortalRequest) {
  return {
    async list (query: AttendanceExceptionQuery = {}): Promise<PageResult<AttendanceExceptionRow>> {
      return pageOf(await request({ url: LIST_URL, method: 'post', data: listParamsOf(query) }))
    },

    async detail (absentId: AttendanceExceptionId): Promise<AttendanceExceptionDetail> {
      const id = idOf(absentId, 'absentId')
      return detailOf(await request({ url: DETAIL_URL, method: 'get', params: { absentId: id } }))
    },

    async uploadFile (input: { absentId: AttendanceExceptionId; absentFileList: AttendanceExceptionAttachment[] }): Promise<void> {
      const absentId = idOf(input?.absentId, 'absentId')
      const absentFileList = attachmentsOf(input?.absentFileList)
      await request({ url: UPLOAD_URL, method: 'post', data: { absentFileList, absentId } })
    },
  }
}

export type AttendanceExceptionCapability = ReturnType<typeof createAttendanceExceptionCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const listParams: ParamSpec[] = [
  p('yearMonth', 'date', false, '月份，YYYY-MM；页面默认当前月份且禁止未来月份'),
  p('organizationIdList', 'tree', false, '角色组织树选中的组织ID数组；未筛选时发送[]'),
  p('name', 'text', false, '姓名筛选；页面初始值为null'),
  p('staffCode', 'text', false, '工号筛选；页面初始值为null，后端按工号模糊匹配'),
  { ...p('isUploadFile', 'enum', false, '附件状态筛选；null不筛选、0未上传、1已上传'), options: [{ label: '已上传', value: 1 }, { label: '未上传', value: 0 }] },
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20'),
]

export const ATTENDANCE_EXCEPTION_METHODS = {
  'attendance-exception-list': 'list',
  'attendance-exception-detail': 'detail',
  'attendance-exception-upload-file': 'uploadFile',
} as const

export const attendanceExceptionCapabilities: CapabilityDefinition[] = [
  { id: 'attendance-exception-list', title: '查询异常统计列表', write: false, params: listParams },
  { id: 'attendance-exception-detail', title: '查看异常考勤详情', write: false, params: [p('absentId', 'text', true, '缺勤记录ID；来自列表行的absentId')] },
  { id: 'attendance-exception-upload-file', title: '上传异常考勤附件', write: true, params: [p('absentId', 'text', true, '缺勤记录ID；来自列表行的absentId'), p('absentFileList', 'text', true, '已上传到OSS的PDF附件数组；最多10项，每项至少有url和name')] },
].map(definition => ({
  ...definition,
  pagePath: ATTENDANCE_EXCEPTION_PAGE_PATH,
  permission: ATTENDANCE_EXCEPTION_PERMISSION,
  moduleType: ATTENDANCE_EXCEPTION_MODULE_TYPE,
  httpInstance: 'platform',
}))
