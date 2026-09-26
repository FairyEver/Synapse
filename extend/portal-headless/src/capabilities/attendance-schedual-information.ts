import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「组织管理 → 考勤管理 → 排班信息」。包含月度/年度列表、考勤日历和异常处理。 */
export const ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH = '/dashboard/attendance/attendance-schedual-information/list'
export const ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION = '/dashboard/attendance/attendance-schedual-information'
export const ATTENDANCE_SCHEDUAL_INFORMATION_MODULE_TYPE = 11

const MONTH_LIST_URL = '/org/hrWorkSchedule/getUserAttendanceListByMonth'
const YEAR_LIST_URL = '/org/hrWorkSchedule/getUserAttendanceListByYear'
const CALENDAR_URL = '/org/hrWorkSchedule/getUserAttendanceList'
const ABSENCE_SAVE_URL = '/org/hrWorkSchedule/absenceUser'

export type AttendanceSchedualInformationId = string | number
export type AttendanceSchedualInformationTimePeriod = 1 | 2

export type AttendanceSchedualInformationListQuery = {
  /** 1=按月度，2=按年度；Portal 默认1。 */
  timePeriod?: AttendanceSchedualInformationTimePeriod
  /** 年份选择器值；默认当前年份，不能晚于当前年份。 */
  year?: string | number
  /** 月份选择器值；按月度时默认当前月份且不能晚于当前月份。 */
  month?: string | number
  organizationIdList?: AttendanceSchedualInformationId[]
  name?: string | null
  staffCode?: string | null
  pageNo?: number
  pageSize?: number
}

export type AttendanceSchedualInformationAttendanceItem = Record<string, unknown> & {
  id: AttendanceSchedualInformationId | null
  userId: AttendanceSchedualInformationId | null
  startDate: string | null
  type: string | number | null
  typeStr: string | null
  amPm: number | null
  isHoliday: number | null
  absentResourceId: string | null
  processInstanceId: string | null
}

export type AttendanceSchedualInformationAbsentGroup = Record<string, unknown> & {
  typeStr: string | null
  count: number | null
  absentUserList: Record<string, unknown>[]
}

export type AttendanceSchedualInformationRow = Record<string, unknown> & {
  userId: AttendanceSchedualInformationId | null
  name: string | null
  staffCode: AttendanceSchedualInformationId | null
  postName: string | null
  organizationName: string | null
  totalSeniority: number | null
  leaveTime: string | number | null
  retireTime: string | number | null
  entryTime: string | number | null
  attendanceGroupStartDate: string | null
  shouldAttendanceDays: number | null
  actualAttendanceDays: number | null
  attendanceDays: number | null
  absentListGroupByType: AttendanceSchedualInformationAbsentGroup[]
  status: number | null
  processInstanceId: string | null
}

export type AttendanceSchedualInformationCalendarQuery = {
  yearMonth?: string
  userId: AttendanceSchedualInformationId
}

export type AttendanceSchedualInformationCalendar = Record<string, unknown> & {
  name: string | null
  postName: string | null
  organizationName: string | null
  finaStartDate: string | null
  finalEndDate: string | null
  attendanceInfoDTOList: AttendanceSchedualInformationAttendanceItem[]
}

export type AttendanceSchedualInformationAttachment = {
  url: string
  name: string
}

export type AttendanceSchedualInformationAbsentPeriod = {
  type: string | number
  absentDate: string
  workShiftType: 1 | 2 | 3
  absentFileList?: AttendanceSchedualInformationAttachment[]
}

export type AttendanceSchedualInformationAbsentUser = {
  userId: AttendanceSchedualInformationId
  name?: string
  absentUserByTypeList: AttendanceSchedualInformationAbsentPeriod[]
}

export type AttendanceSchedualInformationAbsenceInput = {
  users: AttendanceSchedualInformationAbsentUser[]
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): AttendanceSchedualInformationId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空字符串或正整数`)
}

function nullableIdOf (value: unknown, label: string): AttendanceSchedualInformationId | null {
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

function yearOf (value: unknown, fallback = new Date().getFullYear()): string {
  const resolved = value === undefined ? String(fallback) : value
  const year = typeof resolved === 'number' ? String(resolved) : resolved
  if (typeof year !== 'string' || !/^\d{4}$/.test(year) || Number(year) < 1) throw new Error('year必须是YYYY格式的年份')
  if (Number(year) > fallback) throw new Error('year不能晚于当前年份；Portal年份选择器禁止未来年份')
  return year
}

function monthOf (value: unknown, fallback = new Date().getMonth() + 1): string {
  const resolved = value === undefined ? fallback : value
  const month = typeof resolved === 'number' ? String(resolved).padStart(2, '0') : resolved
  if (typeof month !== 'string' || !/^(0[1-9]|1[0-2])$/.test(month)) throw new Error('month必须是01至12的两位月份')
  return month
}

function timePeriodOf (value: unknown): AttendanceSchedualInformationTimePeriod {
  if (value === undefined || value === 1) return 1
  if (value === 2) return 2
  throw new Error('timePeriod只能是1（按月度）或2（按年度）')
}

function organizationIdListOf (value: unknown): AttendanceSchedualInformationId[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('organizationIdList必须是数组')
  return value.map((item, index) => idOf(item, `organizationIdList[${index}]`))
}

function nullableInputTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function dateMonthOf (year: string, month: string): string {
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const value = `${year}-${month}`
  if (value > current) throw new Error('month不能晚于当前月份；Portal月份选择器禁止未来月份')
  return value
}

function listParamsOf (query: AttendanceSchedualInformationListQuery = {}): { url: string; data: JsonObject } {
  const timePeriod = timePeriodOf(query.timePeriod)
  const year = yearOf(query.year)
  const month = timePeriod === 1 ? monthOf(query.month) : null
  if (month !== null) dateMonthOf(year, month)
  return {
    url: timePeriod === 1 ? MONTH_LIST_URL : YEAR_LIST_URL,
    data: {
      order: '',
      orderField: '',
      month,
      year,
      organizationIdList: organizationIdListOf(query.organizationIdList),
      name: nullableInputTextOf(query.name, 'name'),
      staffCode: nullableInputTextOf(query.staffCode, 'staffCode'),
      pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
      pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
    },
  }
}

function groupOf (value: unknown, label: string): AttendanceSchedualInformationAbsentGroup {
  const group = objectOf(value, label)
  const absentUserList = group.absentUserList === undefined || group.absentUserList === null ? [] : group.absentUserList
  if (!Array.isArray(absentUserList) || absentUserList.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) throw new Error(`${label}.absentUserList必须是对象数组或null`)
  return {
    ...group,
    typeStr: nullableTextOf(group.typeStr, `${label}.typeStr`),
    count: nullableNumberOf(group.count, `${label}.count`),
    absentUserList: absentUserList as JsonObject[],
  }
}

function rowOf (value: unknown, label: string): AttendanceSchedualInformationRow {
  const row = objectOf(value, label)
  const groups = row.absentListGroupByType === undefined || row.absentListGroupByType === null ? [] : row.absentListGroupByType
  if (!Array.isArray(groups)) throw new Error(`${label}.absentListGroupByType必须是数组或null`)
  return {
    ...row,
    userId: nullableIdOf(row.userId, `${label}.userId`),
    name: nullableTextOf(row.name, `${label}.name`),
    staffCode: nullableIdOf(row.staffCode, `${label}.staffCode`),
    postName: nullableTextOf(row.postName, `${label}.postName`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    totalSeniority: nullableNumberOf(row.totalSeniority, `${label}.totalSeniority`),
    leaveTime: scalarOf(row.leaveTime, `${label}.leaveTime`),
    retireTime: scalarOf(row.retireTime, `${label}.retireTime`),
    entryTime: scalarOf(row.entryTime, `${label}.entryTime`),
    attendanceGroupStartDate: nullableTextOf(row.attendanceGroupStartDate, `${label}.attendanceGroupStartDate`),
    shouldAttendanceDays: nullableNumberOf(row.shouldAttendanceDays, `${label}.shouldAttendanceDays`),
    actualAttendanceDays: nullableNumberOf(row.actualAttendanceDays, `${label}.actualAttendanceDays`),
    attendanceDays: nullableNumberOf(row.attendanceDays, `${label}.attendanceDays`),
    absentListGroupByType: groups.map((item, index) => groupOf(item, `${label}.absentListGroupByType[${index}]`)),
    status: nullableNumberOf(row.status, `${label}.status`),
    processInstanceId: nullableTextOf(row.processInstanceId, `${label}.processInstanceId`),
  }
}

function pageOf (value: unknown): PageResult<AttendanceSchedualInformationRow> {
  const page = objectOf(value, '排班信息分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('排班信息分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `排班信息分页响应.list[${index}]`)), total: Number(page.total) }
}

function attendanceItemOf (value: unknown, label: string): AttendanceSchedualInformationAttendanceItem {
  const item = objectOf(value, label)
  return {
    ...item,
    id: nullableIdOf(item.id, `${label}.id`),
    userId: nullableIdOf(item.userId, `${label}.userId`),
    startDate: nullableTextOf(item.startDate, `${label}.startDate`),
    type: scalarOf(item.type, `${label}.type`),
    typeStr: nullableTextOf(item.typeStr, `${label}.typeStr`),
    amPm: nullableNumberOf(item.amPm, `${label}.amPm`),
    isHoliday: nullableNumberOf(item.isHoliday, `${label}.isHoliday`),
    absentResourceId: nullableTextOf(item.absentResourceId, `${label}.absentResourceId`),
    processInstanceId: nullableTextOf(item.processInstanceId, `${label}.processInstanceId`),
  }
}

function calendarOf (value: unknown): AttendanceSchedualInformationCalendar {
  const calendar = objectOf(value, '排班信息考勤日历响应')
  const items = calendar.attendanceInfoDTOList === undefined || calendar.attendanceInfoDTOList === null ? [] : calendar.attendanceInfoDTOList
  if (!Array.isArray(items)) throw new Error('排班信息考勤日历响应.attendanceInfoDTOList必须是数组或null')
  return {
    ...calendar,
    name: nullableTextOf(calendar.name, '排班信息考勤日历响应.name'),
    postName: nullableTextOf(calendar.postName, '排班信息考勤日历响应.postName'),
    organizationName: nullableTextOf(calendar.organizationName, '排班信息考勤日历响应.organizationName'),
    finaStartDate: nullableTextOf(calendar.finaStartDate, '排班信息考勤日历响应.finaStartDate'),
    finalEndDate: nullableTextOf(calendar.finalEndDate, '排班信息考勤日历响应.finalEndDate'),
    attendanceInfoDTOList: items.map((item, index) => attendanceItemOf(item, `排班信息考勤日历响应.attendanceInfoDTOList[${index}]`)),
  }
}

function yearMonthOf (value: unknown): string {
  const resolved = value === undefined ? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` : value
  if (typeof resolved !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(resolved)) throw new Error('yearMonth必须是YYYY-MM格式')
  dateMonthOf(resolved.slice(0, 4), resolved.slice(5))
  return resolved
}

function attachmentOf (value: unknown, label: string): AttendanceSchedualInformationAttachment {
  const attachment = objectOf(value, label)
  if (typeof attachment.url !== 'string' || attachment.url.trim() === '') throw new Error(`${label}.url必须是非空字符串；先用base-upload-file上传`)
  if (typeof attachment.name !== 'string' || attachment.name.trim() === '') throw new Error(`${label}.name必须是非空字符串`)
  return { url: attachment.url, name: attachment.name }
}

function attachmentsOf (value: unknown, label: string): AttendanceSchedualInformationAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是附件数组`)
  if (value.length > 10) throw new Error(`${label}最多10项；Portal上传组件的max为10`)
  return value.map((item, index) => attachmentOf(item, `${label}[${index}]`))
}

function absenceTypeOf (value: unknown, label: string): string | number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error(`${label}必须是字典中的非空类型值`)
  return value
}

function absentDateOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须是YYYY-MM-DD格式`)
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label}不是有效日期`)
  return value
}

function workShiftTypeOf (value: unknown, label: string): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value
  throw new Error(`${label}只能是1（上午）、2（下午）或3（全天）`)
}

function absencePeriodsOf (user: AttendanceSchedualInformationAbsentUser, userIndex: number): JsonObject[] {
  if (!Array.isArray(user.absentUserByTypeList) || user.absentUserByTypeList.length === 0) throw new Error(`users[${userIndex}].absentUserByTypeList至少包含一项`)
  const periods = user.absentUserByTypeList.map((period, periodIndex) => {
    const label = `users[${userIndex}].absentUserByTypeList[${periodIndex}]`
    const type = absenceTypeOf(period?.type, `${label}.type`)
    const absentDate = absentDateOf(period?.absentDate, `${label}.absentDate`)
    const workShiftType = workShiftTypeOf(period?.workShiftType, `${label}.workShiftType`)
    const absentFileList = attachmentsOf(period?.absentFileList, `${label}.absentFileList`)
    if (['3', '4', '7', '8', '9'].includes(String(type)) && absentFileList.length === 0) throw new Error(`${label}.absentFileList不能为空；该异常类型必须上传附件`)
    return { type, absentDate, workShiftType, absentFileList }
  })
  const byDate = new Map<string, Array<1 | 2 | 3>>()
  for (const period of periods) byDate.set(period.absentDate, [...(byDate.get(period.absentDate) ?? []), period.workShiftType])
  for (const [date, shifts] of byDate) {
    if (shifts.includes(3) && shifts.length > 1) throw new Error(`users[${userIndex}]的${date}同一天不能同时存在全天和其它班次`)
    if (shifts.filter(item => item === 1).length > 1) throw new Error(`users[${userIndex}]的${date}重复选择上午班次`)
    if (shifts.filter(item => item === 2).length > 1) throw new Error(`users[${userIndex}]的${date}重复选择下午班次`)
  }
  return periods
}

function absencePayloadOf (input: AttendanceSchedualInformationAbsenceInput): JsonObject[] {
  if (!input || !Array.isArray(input.users) || input.users.length === 0) throw new Error('users至少包含一名人员')
  const seen = new Set<string>()
  return input.users.map((user, userIndex) => {
    const userId = idOf(user?.userId, `users[${userIndex}].userId`)
    const key = String(userId)
    if (seen.has(key)) throw new Error(`users[${userIndex}].userId不能重复`)
    seen.add(key)
    if (user?.name !== undefined && typeof user.name !== 'string') throw new Error(`users[${userIndex}].name必须为字符串`)
    return {
      userId,
      ...(user.name === undefined ? {} : { name: user.name }),
      absentUserByTypeList: absencePeriodsOf(user, userIndex),
    }
  })
}

/** The injected requests must use ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH as page context. */
export function createAttendanceSchedualInformationCapability (request: PortalRequest) {
  return {
    async list (query: AttendanceSchedualInformationListQuery = {}): Promise<PageResult<AttendanceSchedualInformationRow>> {
      const { url, data } = listParamsOf(query)
      return pageOf(await request({ url, method: 'post', data }))
    },

    async calendar (query: AttendanceSchedualInformationCalendarQuery): Promise<AttendanceSchedualInformationCalendar> {
      const yearMonth = yearMonthOf(query?.yearMonth)
      const userId = idOf(query?.userId, 'userId')
      return calendarOf(await request({ url: CALENDAR_URL, method: 'get', params: { yearMonth, userId } }))
    },

    async absenceUser (input: AttendanceSchedualInformationAbsenceInput): Promise<void> {
      await request({ url: ABSENCE_SAVE_URL, method: 'post', data: absencePayloadOf(input) })
    },
  }
}

export type AttendanceSchedualInformationCapability = ReturnType<typeof createAttendanceSchedualInformationCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const listParams: ParamSpec[] = [
  { ...p('timePeriod', 'enum', false, '1=按月度，2=按年度；页面默认1'), options: [{ label: '按月度', value: 1 }, { label: '按年度', value: 2 }] },
  p('year', 'date', false, '年份，YYYY格式；默认当前年份且不能晚于当前年份'),
  p('month', 'date', false, '按月度时的月份，MM格式；默认当前月份且不能晚于当前月份'),
  p('organizationIdList', 'tree', false, '角色组织树选中的组织ID数组；未筛选时发送[]'),
  p('name', 'text', false, '姓名筛选；页面初始值为null'),
  p('staffCode', 'text', false, '工号筛选；页面初始值为null'),
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20'),
]

export const ATTENDANCE_SCHEDUAL_INFORMATION_METHODS = {
  'attendance-schedual-information-list': 'list',
  'attendance-schedual-information-calendar': 'calendar',
  'attendance-schedual-information-absence-user': 'absenceUser',
} as const

export const attendanceSchedualInformationCapabilities: CapabilityDefinition[] = [
  { id: 'attendance-schedual-information-list', title: '查询排班信息列表', write: false, params: listParams },
  { id: 'attendance-schedual-information-calendar', title: '查看员工考勤日历', write: false, params: [p('yearMonth', 'date', false, '考勤月份，YYYY-MM；默认当前月份且不能晚于当前月份'), p('userId', 'text', true, '列表行的用户ID')] },
  { id: 'attendance-schedual-information-absence-user', title: '处理考勤异常', write: true, params: [p('users', 'text', true, '人员及缺勤时段数组；每个时段含类型、日期、班次和已上传附件')] },
].map(definition => ({
  ...definition,
  pagePath: ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH,
  permission: ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION,
  moduleType: ATTENDANCE_SCHEDUAL_INFORMATION_MODULE_TYPE,
  httpInstance: 'platform',
}))
