import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
import { assertYearMonth } from './attendance-archive-sheet.js'

export const ATTENDANCE_SHEET_PAGE = '/dashboard/attendance/attendance-sheet/list'
export const ATTENDANCE_SHEET_ARCHIVE_PAGE = '/dashboard/attendance/attendance-archive-sheet/list'
export const ATTENDANCE_SHEET_PERMISSION = '/dashboard/attendance/attendance-sheet'
export const ATTENDANCE_SHEET_ARCHIVE_PERMISSION = '/dashboard/attendance/attendance-archive-sheet'
type Id = string | number
type Row = Record<string, unknown>
export type SheetDraft = { id?: Id; isArchived?: number; departmentId: Id; organizationId?: Id | null; yearMonth: string; userIdList: Id[] }
export const SHEET_STATISTIC_FIELDS = ['dayWork', 'publicLeave', 'saturdaySunday', 'injury', 'leave', 'sick', 'miner', 'yearRest', 'visit', 'wedding', 'maternity', 'late', 'early', 'total'] as const
const idParam: ParamSpec = { name: 'id', kind: 'text', required: true, description: '考勤表ID，来自考勤统计或考勤档案列表；不是用户ID' }
const archivedParam: ParamSpec = { name: 'isArchived', kind: 'enum', required: true, options: [{ value: 0, label: '未归档' }, { value: 1, label: '已归档' }], description: '刚刷新列表的同一行isArchived，不能猜状态；与页面操作保护一致' }
const draftParams: ParamSpec[] = [
  { ...archivedParam, required: false, description: '编辑时必须提供刚刷新列表同一行isArchived；新建省略' },
  { ...idParam, required: false, description: '编辑时传原考勤表ID；省略为新建' },
  { name: 'departmentId', kind: 'text', required: true, description: 'attendance-sheet-department 返回的当前用户部门ID' },
  { name: 'organizationId', kind: 'search', required: false, description: '该部门下班组ID；不选传null', lookup: { capabilityId: 'attendance-sheet-group-search', keywordParam: 'keyword' } },
  { name: 'yearMonth', kind: 'date', required: true, description: '考勤月份YYYY-MM，不能晚于运行环境当前月份' },
  { name: 'userIdList', kind: 'text', required: true, description: '人员管理选定的用户ID数组，至少一人，整体替换；编辑必须保留未移除人员' },
  { name: 'requestId', kind: 'text', required: true, description: '本次保存的防重标识；相同意图重试沿用，变更载荷换新值' },
]
const attendanceSheetCapabilityDefinitions: CapabilityDefinition[] = [
  { id: 'attendance-sheet-get', title: '读取考勤表编辑资料', pagePath: ATTENDANCE_SHEET_PAGE, write: false, params: [idParam] },
  { id: 'attendance-sheet-department', title: '查询考勤表当前用户部门', pagePath: ATTENDANCE_SHEET_PAGE, write: false, params: [] },
  { id: 'attendance-sheet-group-search', title: '搜索当前部门下班组', pagePath: ATTENDANCE_SHEET_PAGE, write: false, params: [
    { name: 'departmentId', kind: 'text', required: true, description: '当前用户部门ID' },
    { name: 'keyword', kind: 'text', required: true, description: '班组路径或名称关键字，不允许空串' },
  ] },
  { id: 'attendance-sheet-user-search', title: '搜索考勤表可选人员', pagePath: ATTENDANCE_SHEET_PAGE, write: false, params: [
    { name: 'keyword', kind: 'text', required: true, description: '人员姓名关键字，传给页面接口name' },
    { name: 'organizationId', kind: 'text', required: false, description: '角色组织树所选组织ID；省略发空串，与人员弹窗一致' },
    { name: 'pageNo', kind: 'number', required: false, description: '页码，默认1' },
    { name: 'pageSize', kind: 'number', required: false, description: '每页人数，默认5，最大100' },
  ] },
  { id: 'attendance-sheet-save', title: '新建或编辑考勤表', pagePath: ATTENDANCE_SHEET_PAGE, write: true, params: draftParams },
  { id: 'attendance-sheet-archive', title: '归档考勤表', pagePath: ATTENDANCE_SHEET_PAGE, write: true, params: [idParam, archivedParam] },
  { id: 'attendance-sheet-unarchive', title: '取消考勤表归档', pagePath: ATTENDANCE_SHEET_ARCHIVE_PAGE, write: true, params: [idParam] },
  { id: 'attendance-sheet-remove', title: '删除未归档考勤表', pagePath: ATTENDANCE_SHEET_PAGE, write: true, params: [idParam, archivedParam] },
  { id: 'attendance-sheet-statistics', title: '预览考勤统计簿', pagePath: ATTENDANCE_SHEET_PAGE, write: false, params: [idParam, archivedParam] },
]

export const attendanceSheetCapabilities: CapabilityDefinition[] = attendanceSheetCapabilityDefinitions.map(capability => ({
  ...capability,
  permission: capability.pagePath === ATTENDANCE_SHEET_ARCHIVE_PAGE
    ? ATTENDANCE_SHEET_ARCHIVE_PERMISSION
    : ATTENDANCE_SHEET_PERMISSION,
}))

function identifier(value: unknown, name = 'id'): Id {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value)) || Number(value) <= 0 || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new Error(`${name}必须为真实的正整数ID；大ID请用字符串`)
  return value
}
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('考勤接口未返回对象')
  return value as Row
}
function keyword(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('必须提供keyword，不能全量读取人员或班组候选')
  return value.trim()
}
function page(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || result > maximum) throw new Error(`分页值必须为1至${maximum}的整数`)
  return result
}
export function buildSheetPayload(draft: SheetDraft): Row {
  if (draft.id !== undefined && draft.isArchived !== 0) throw new Error('已归档或未核实状态的考勤表不能编辑，请刷新列表并传isArchived=0')
  assertYearMonth(draft.yearMonth)
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (draft.yearMonth > currentMonth) throw new Error('考勤月份不能晚于当前月份')
  if (!Array.isArray(draft.userIdList) || draft.userIdList.length === 0) throw new Error('请添加人员')
  return {
    id: draft.id === undefined ? null : identifier(draft.id),
    departmentId: identifier(draft.departmentId, 'departmentId'),
    organizationId: draft.organizationId == null ? null : identifier(draft.organizationId, 'organizationId'),
    userIdList: draft.userIdList.map(id => identifier(id, 'userIdList')),
    year: draft.yearMonth.slice(0, 4),
    month: draft.yearMonth.slice(5),
  }
}

export function createAttendanceSheetCapability(request: PortalRequest, archiveRequest: PortalRequest = request) {
  async function rawGet(id: Id) {
    return record(await request({ url: `/org/hrAttendanceSheet/info/${identifier(id)}`, method: 'get' }))
  }
  function assertState(isArchived: unknown): asserts isArchived is 0 | 1 {
    if (isArchived !== 0 && isArchived !== 1) throw new Error('请提供刚刷新列表同一行的isArchived（0或1）')
  }
  function assertEditable(isArchived: unknown) {
    assertState(isArchived)
    if (isArchived) throw new Error('已归档考勤表不能编辑、归档或删除，请先取消归档')
  }
  return {
    async get({ id }: { id: Id }) {
      const row = await rawGet(id)
      if (!Array.isArray(row.userList)) throw new Error('考勤表缺少userList，不能据此覆盖人员')
      return {
        id: identifier(row.id), departmentId: identifier(row.departmentId),
        organizationId: row.organizationId == null ? null : identifier(row.organizationId),
        yearMonth: `${row.year}-${String(row.month).padStart(2, '0')}`,
        isArchived: row.isArchived,
        users: row.userList.map(value => { const user = record(value); return { id: identifier(user.id), name: user.realName ?? null } }),
      }
    },
    async department() {
      const result = await request({ url: '/org/organization/getUserDepartment', method: 'get' })
      const row = result == null ? {} : record(result)
      return { id: row.id == null ? null : identifier(row.id), fullPath: row.fullPath ?? null }
    },
    async searchGroups({ departmentId, keyword: term }: { departmentId: Id; keyword: string }) {
      const search = keyword(term).toLowerCase()
      const rows = await request<Row[]>({ url: '/org/organization/getGradeGroupByDepartment', method: 'get', params: { departmentId: identifier(departmentId) } })
      if (!Array.isArray(rows)) throw new Error('班组接口未返回数组')
      const matches = rows.filter(row => String(row.fullPath ?? '').toLowerCase().includes(search))
      return { list: matches.slice(0, 50).map(row => ({ id: identifier(row.id), fullPath: row.fullPath ?? null })), total: matches.length }
    },
    async searchUsers(query: { keyword: string; organizationId?: Id; pageNo?: number; pageSize?: number }) {
      const name = keyword(query.keyword)
      const result = await request<{list: Row[]; total: number}>({ url: '/sys/user/getUserByRole', method: 'get', params: {
        name, organizationId: query.organizationId === undefined ? '' : identifier(query.organizationId),
        pageNo: page(query.pageNo, 1, 1000000), pageSize: page(query.pageSize, 5, 100),
      } })
      return { list: result.list.map(row => ({ id: identifier(row.id), name: row.realName ?? null, staffCode: row.username ?? null, organizationName: row.organizationName ?? null })), total: result.total }
    },
    async save(draft: SheetDraft): Promise<void> {
      const payload = buildSheetPayload(draft)
      if (draft.id !== undefined) assertEditable(draft.isArchived)
      await request({ url: '/org/hrAttendanceSheet/saveSheet', method: 'post', data: payload })
    },
    async archive({ id, isArchived }: { id: Id; isArchived: number }): Promise<void> {
      identifier(id)
      assertEditable(isArchived)
      await request({ url: '/org/hrAttendanceSheet/archiveSheet', method: 'get', params: { id } })
    },
    async unarchive({ id }: { id: Id }): Promise<void> {
      identifier(id)
      await archiveRequest({ url: '/org/hrAttendanceSheet/unArchiveSheet', method: 'get', params: { id } })
    },
    async remove({ id, isArchived }: { id: Id; isArchived: number }): Promise<void> {
      identifier(id)
      assertEditable(isArchived)
      await request({ url: `/org/hrAttendanceSheet/delete/${id}`, method: 'delete' })
    },
    async statistics({ id, isArchived }: { id: Id; isArchived: number }) {
      identifier(id)
      assertState(isArchived)
      const archived = isArchived === 1
      const rows = await request<Row[]>({ url: `/org/hrAttendanceSheet/get${archived ? 'Archive' : 'UnArchive'}StatisticInfo`, method: 'get', params: { order: '', orderField: '', id } })
      if (!Array.isArray(rows)) throw new Error('统计簿未返回数组')
      return rows.map(item => ({ userName: item.userName ?? null, ...Object.fromEntries(SHEET_STATISTIC_FIELDS.map(key => [key, item[key] ?? 0])) }))
    },
  }
}
export type AttendanceSheetCapability = ReturnType<typeof createAttendanceSheetCapability> & {
  saveIdempotent: (draft: SheetDraft & { requestId: string }) => Promise<void>
}
