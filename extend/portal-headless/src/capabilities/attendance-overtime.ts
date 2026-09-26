import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「组织管理 → 考勤管理 → 加班记录」。页面只有列表和已调休日期详情。 */
export const ATTENDANCE_OVERTIME_PAGE_PATH = '/dashboard/attendance/attendance-overtime/list'
export const ATTENDANCE_OVERTIME_PERMISSION = '/dashboard/attendance/attendance-overtime'
export const ATTENDANCE_OVERTIME_MODULE_TYPE = 11

const LIST_URL = '/admin-api/hr/overtime-application/record/page'
const DETAIL_URL = '/admin-api/hr/overtime-application/record/detail'

export type AttendanceOvertimeId = string | number

export type AttendanceOvertimeQuery = {
  /** Portal 初始值为空字符串；姓名按后端模糊匹配。 */
  applicantName?: string
  /** 角色组织树多选结果；未选择时发送空数组。 */
  organizationIdList?: AttendanceOvertimeId[]
  pageNo?: number
  pageSize?: number
}

export type AttendanceOvertimeDetailInput = {
  /** 年份选择器的 YYYY 字符串；Portal 默认当前年份，允许用户切换年份。 */
  year?: string | number
  /** 列表行 applicantId。 */
  userId: AttendanceOvertimeId
}

export type AttendanceOvertimeRow = Record<string, unknown> & {
  applicantId: AttendanceOvertimeId | null
  applicantName: string | null
  staffCode: string | null
  organizationName: string | null
  postName: string | null
  overtimeHours: string | number | null
  remainingRestHours: string | number | null
}

export type AttendanceOvertimeDetail = Record<string, unknown> & {
  year: number | null
  applicantName: string | null
  organizationName: string | null
  postName: string | null
  usedRestHours: string | number | null
  restDates: string | null
  restDateList: string[] | null
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function idOf (value: unknown, label: string): AttendanceOvertimeId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空字符串或安全整数`)
}

function nullableIdOf (value: unknown, label: string): AttendanceOvertimeId | null {
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

function applicantNameOf (value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error('applicantName必须为字符串')
  return value
}

function organizationIdListOf (value: unknown): AttendanceOvertimeId[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('organizationIdList必须是数组')
  return value.map((item, index) => idOf(item, `organizationIdList[${index}]`))
}

function yearOf (value: unknown, fallback = new Date().getFullYear()): string {
  const resolved = value === undefined ? String(fallback) : value
  const year = typeof resolved === 'number' ? String(resolved) : resolved
  if (typeof year !== 'string' || !/^\d{4}$/.test(year) || Number(year) < 1) throw new Error('year必须是YYYY格式的年份')
  return year
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function listParamsOf (query: AttendanceOvertimeQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    applicantName: applicantNameOf(query.applicantName),
    organizationIdList: organizationIdListOf(query.organizationIdList),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function rowOf (value: unknown, label: string): AttendanceOvertimeRow {
  const row = objectOf(value, label)
  return {
    ...row,
    applicantId: nullableIdOf(row.applicantId, `${label}.applicantId`),
    applicantName: nullableTextOf(row.applicantName, `${label}.applicantName`),
    staffCode: nullableTextOf(row.staffCode, `${label}.staffCode`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    postName: nullableTextOf(row.postName, `${label}.postName`),
    overtimeHours: scalarOf(row.overtimeHours, `${label}.overtimeHours`),
    remainingRestHours: scalarOf(row.remainingRestHours, `${label}.remainingRestHours`),
  }
}

function pageOf (value: unknown): PageResult<AttendanceOvertimeRow> {
  const page = objectOf(value, '加班记录分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('加班记录分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `加班记录分页响应.list[${index}]`)), total: Number(page.total) }
}

function dateListOf (value: unknown, label: string): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label}必须是日期字符串数组或null`)
  return value as string[]
}

function detailOf (value: unknown): AttendanceOvertimeDetail {
  const detail = objectOf(value, '加班记录详情响应')
  return {
    ...detail,
    year: nullableNumberOf(detail.year, '加班记录详情响应.year'),
    applicantName: nullableTextOf(detail.applicantName, '加班记录详情响应.applicantName'),
    organizationName: nullableTextOf(detail.organizationName, '加班记录详情响应.organizationName'),
    postName: nullableTextOf(detail.postName, '加班记录详情响应.postName'),
    usedRestHours: scalarOf(detail.usedRestHours, '加班记录详情响应.usedRestHours'),
    restDates: nullableTextOf(detail.restDates, '加班记录详情响应.restDates'),
    restDateList: dateListOf(detail.restDateList, '加班记录详情响应.restDateList'),
  }
}

/** The injected request must use ATTENDANCE_OVERTIME_PAGE_PATH as its page context. */
export function createAttendanceOvertimeCapability (request: PortalRequest) {
  return {
    async list (query: AttendanceOvertimeQuery = {}): Promise<PageResult<AttendanceOvertimeRow>> {
      return pageOf(await request({ url: LIST_URL, method: 'post', data: listParamsOf(query) }))
    },

    async detail (input: AttendanceOvertimeDetailInput): Promise<AttendanceOvertimeDetail> {
      const userId = idOf(input?.userId, 'userId')
      const year = yearOf(input?.year)
      return detailOf(await request({ url: DETAIL_URL, method: 'get', params: { year, userId } }))
    },
  }
}

export type AttendanceOvertimeCapability = ReturnType<typeof createAttendanceOvertimeCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const listParams: ParamSpec[] = [
  p('applicantName', 'text', false, '姓名模糊筛选；页面初始值为空字符串'),
  p('organizationIdList', 'tree', false, '角色组织树选中的组织ID数组；未筛选时发送[]'),
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20'),
]

export const ATTENDANCE_OVERTIME_METHODS = {
  'attendance-overtime-list': 'list',
  'attendance-overtime-detail': 'detail',
} as const

export const attendanceOvertimeCapabilities: CapabilityDefinition[] = [
  { id: 'attendance-overtime-list', title: '查询加班记录列表', write: false, params: listParams },
  { id: 'attendance-overtime-detail', title: '查看已调休日期', write: false, params: [p('year', 'date', false, '年份，YYYY格式；页面默认当前年份'), p('userId', 'text', true, '列表行的申请人ID')] },
].map(definition => ({
  ...definition,
  pagePath: ATTENDANCE_OVERTIME_PAGE_PATH,
  permission: ATTENDANCE_OVERTIME_PERMISSION,
  moduleType: ATTENDANCE_OVERTIME_MODULE_TYPE,
  httpInstance: 'platform',
}))
