import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'

import type { PortalRequest } from '../session/types.js'
import type { PageResult } from './meeting-room.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/** Portal「组织管理 → 考勤管理 → 年假管理」。页面只读列表加Excel导出。 */
export const ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH = '/dashboard/attendance/attendance-annual-leave/list'
export const ATTENDANCE_ANNUAL_LEAVE_PERMISSION = '/dashboard/attendance/attendance-annual-leave'
export const ATTENDANCE_ANNUAL_LEAVE_MODULE_TYPE = 11

const LIST_URL = '/org/holiday/getYearRest'
const EXPORT_URL = '/org/holiday/exportYearRest'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type AttendanceAnnualLeaveId = string | number

export type AttendanceAnnualLeaveQuery = {
  /** 姓名模糊筛选；Portal初始值为null，输入框原样发送。 */
  name?: string | null
  /** Portal角色组织树选择的组织ID数组；未筛选时发送空数组。 */
  organizationIdList?: AttendanceAnnualLeaveId[]
  /** 年份选择器的YYYY字符串；Portal禁止选择未来年份。 */
  year?: string | number
  pageNo?: number
  pageSize?: number
}

export type AttendanceAnnualLeaveAbsent = Record<string, unknown> & {
  startDate: string | null
  amPm: string | number | null
}

export type AttendanceAnnualLeaveRow = Record<string, unknown> & {
  userId: AttendanceAnnualLeaveId | null
  name: string | null
  /** 后端返回的工号；Portal当前“工号”列误用了dataIndex=name，页面实际重复显示姓名。 */
  staffCode: AttendanceAnnualLeaveId | null
  organizationName: string | null
  postName: string | null
  workDate: string | number | null
  entryTime: string | number | null
  year: string | number | null
  startDate: string | number | null
  endDate: string | number | null
  shouldYearRestDays: number | null
  actualYearRestDays: number | null
  /** Portal列表没有从后端读取该字段，而是按应休天数减已休天数本地计算。 */
  remainingAnnualLeaveDays: number | null
  /** 查看已休日期弹窗直接消费列表行中的这份快照，不再发请求。 */
  absentListByYearRest: AttendanceAnnualLeaveAbsent[]
}

export type AttendanceAnnualLeaveFile = {
  fileName: string
  contentType: string
  base64: string
  byteLength: number
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function scalarOf (value: unknown, label: string): string | number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`${label}必须为字符串、数字或null`)
}

function idOf (value: unknown, label: string): AttendanceAnnualLeaveId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(`${label}必须为非空字符串或安全整数`)
}

function nullableIdOf (value: unknown, label: string): AttendanceAnnualLeaveId | null {
  if (value === undefined || value === null || value === '') return null
  return idOf(value, label)
}

function nullableTextOf (value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串或null`)
  return value
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

function nameOf (value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('name必须为字符串或null')
  return value
}

function organizationIdListOf (value: unknown): AttendanceAnnualLeaveId[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('organizationIdList必须是数组')
  return value.map((item, index) => idOf(item, `organizationIdList[${index}]`))
}

function pageNumberOf (value: unknown, fallback: number, label: 'pageNo' | 'pageSize'): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || Number(resolved) < 1) throw new Error(`${label}必须为正整数`)
  if (label === 'pageSize' && ![10, 20, 50, 100].includes(Number(resolved))) throw new Error('pageSize必须是页面支持的10、20、50或100')
  return Number(resolved)
}

function formOf (query: AttendanceAnnualLeaveQuery = {}): JsonObject {
  return {
    name: nameOf(query.name),
    organizationIdList: organizationIdListOf(query.organizationIdList),
    year: yearOf(query.year),
  }
}

function listParamsOf (query: AttendanceAnnualLeaveQuery = {}): JsonObject {
  return {
    order: '',
    orderField: '',
    ...formOf(query),
    pageNo: pageNumberOf(query.pageNo, 1, 'pageNo'),
    pageSize: pageNumberOf(query.pageSize, 20, 'pageSize'),
  }
}

function absentOf (value: unknown, label: string): AttendanceAnnualLeaveAbsent {
  const row = objectOf(value, label)
  return {
    ...row,
    startDate: nullableTextOf(row.startDate, `${label}.startDate`),
    amPm: scalarOf(row.amPm, `${label}.amPm`),
  }
}

function rowOf (value: unknown, label: string): AttendanceAnnualLeaveRow {
  const row = objectOf(value, label)
  const shouldYearRestDays = nullableNumberOf(row.shouldYearRestDays, `${label}.shouldYearRestDays`)
  const actualYearRestDays = nullableNumberOf(row.actualYearRestDays, `${label}.actualYearRestDays`)
  const absentList = row.absentListByYearRest === undefined || row.absentListByYearRest === null ? [] : row.absentListByYearRest
  if (!Array.isArray(absentList)) throw new Error(`${label}.absentListByYearRest必须是数组或null`)
  const remainingAnnualLeaveDays = shouldYearRestDays === null || actualYearRestDays === null ? null : shouldYearRestDays - actualYearRestDays
  return {
    ...row,
    userId: nullableIdOf(row.userId, `${label}.userId`),
    name: nullableTextOf(row.name, `${label}.name`),
    staffCode: nullableIdOf(row.staffCode, `${label}.staffCode`),
    organizationName: nullableTextOf(row.organizationName, `${label}.organizationName`),
    postName: nullableTextOf(row.postName, `${label}.postName`),
    workDate: scalarOf(row.workDate, `${label}.workDate`),
    entryTime: scalarOf(row.entryTime, `${label}.entryTime`),
    year: scalarOf(row.year, `${label}.year`),
    startDate: scalarOf(row.startDate, `${label}.startDate`),
    endDate: scalarOf(row.endDate, `${label}.endDate`),
    shouldYearRestDays,
    actualYearRestDays,
    remainingAnnualLeaveDays,
    absentListByYearRest: absentList.map((item, index) => absentOf(item, `${label}.absentListByYearRest[${index}]`)),
  }
}

function pageOf (value: unknown): PageResult<AttendanceAnnualLeaveRow> {
  const page = objectOf(value, '年假管理分页响应')
  if (!Array.isArray(page.list) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('年假管理分页响应缺少有效list或total')
  return { list: page.list.map((item, index) => rowOf(item, `年假管理分页响应.list[${index}]`)), total: Number(page.total) }
}

function binaryOf (value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength)
  throw new Error('年假管理导出响应不是二进制文件')
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

function fileOf (response: AxiosResponse<ArrayBuffer>): AttendanceAnnualLeaveFile {
  const bytes = binaryOf(response.data)
  if (bytes.byteLength === 0) throw new Error('年假管理导出响应为空')
  return {
    fileName: fileNameOf(response, '年假管理表.xlsx'),
    contentType: headerOf(response, 'content-type') || XLSX_MIME,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

/** The injected request must use ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH as its page context. */
export function createAttendanceAnnualLeaveCapability (request: PortalRequest) {
  return {
    async list (query: AttendanceAnnualLeaveQuery = {}): Promise<PageResult<AttendanceAnnualLeaveRow>> {
      return pageOf(await request({ url: LIST_URL, method: 'post', data: listParamsOf(query) }))
    },

    async export (query: AttendanceAnnualLeaveQuery = {}): Promise<AttendanceAnnualLeaveFile> {
      return fileOf(await request<AxiosResponse<ArrayBuffer>>({
        url: EXPORT_URL,
        method: 'post',
        data: formOf(query),
        responseType: 'arraybuffer',
      }))
    },
  }
}

export type AttendanceAnnualLeaveCapability = ReturnType<typeof createAttendanceAnnualLeaveCapability>

const p = (name: string, kind: ParamSpec['kind'], required = false, description?: string): ParamSpec => ({ name, kind, required, ...(description === undefined ? {} : { description }) })
const listParams: ParamSpec[] = [
  p('name', 'text', false, '姓名模糊筛选；页面初始值为null，SDK省略时发送null'),
  p('organizationIdList', 'tree', false, '角色组织树选中的组织ID数组；未筛选时发送空数组，不是单个组织ID'),
  p('year', 'date', false, '年份，必须是YYYY格式且不晚于当前年份；页面默认当前年份'),
  p('pageNo', 'number', false, '从1开始的页码；页面默认1'),
  p('pageSize', 'number', false, '页面支持10、20、50、100；页面默认20'),
]

export const ATTENDANCE_ANNUAL_LEAVE_METHODS = {
  'attendance-annual-leave-list': 'list',
  'attendance-annual-leave-export': 'export',
} as const

export const attendanceAnnualLeaveCapabilities: CapabilityDefinition[] = [
  { id: 'attendance-annual-leave-list', title: '查询年假管理列表', write: false, params: listParams },
  { id: 'attendance-annual-leave-export', title: '导出年假管理Excel', write: false, params: listParams.slice(0, 3) },
].map(definition => ({
  ...definition,
  pagePath: ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH,
  permission: ATTENDANCE_ANNUAL_LEAVE_PERMISSION,
  moduleType: ATTENDANCE_ANNUAL_LEAVE_MODULE_TYPE,
  httpInstance: 'platform',
}))
