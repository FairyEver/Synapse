import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ATTENDANCE_SCHEDUAL_INFORMATION_METHODS,
  ATTENDANCE_SCHEDUAL_INFORMATION_MODULE_TYPE,
  ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH,
  ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION,
  attendanceSchedualInformationCapabilities,
  createAttendanceSchedualInformationCapability,
} from '../src/capabilities/attendance-schedual-information.js'
import { ATTENDANCE_SCHEDUAL_INFORMATION_AI_CONTRACTS as contracts } from '../src/catalog/contracts-attendance-schedual-information.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createAttendanceSchedualInformationCapability(request), calls }
}

function currentYearMonth () {
  const now = new Date()
  return { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0'), yearMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
}

describe('Portal 组织管理 → 考勤管理 → 排班信息', () => {
  it('逐页锁定菜单、路由、月度/年度列表、日历和异常处理源码', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-schedual-information.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-schedual-information/list.vue'), 'utf8')
    const calendar = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-schedual-information/calendar.vue'), 'utf8')
    const issues = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-schedual-information/components/schedual-issues.vue'), 'utf8')
    const upload = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-schedual-information/components/upload-files.vue'), 'utf8')
    for (const fragment of [ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH, ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION, '排班信息']) expect(menu).toContain(fragment)
    for (const fragment of [`title: 排班信息`, `permission: ${ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION}`, 'common-layout-dashboard-crud-container']) expect(route).toContain(fragment)
    for (const fragment of ["'/org/hrWorkSchedule/getUserAttendanceListByMonth'", "'/org/hrWorkSchedule/getUserAttendanceListByYear'", 'month: timePeriod.value === 1 ? form.month : null', 'year: form.year', 'organizationIdList: []', 'actionSchedualIssues()', 'openCalendar(record)']) expect(list).toContain(fragment)
    for (const fragment of ["http.get('/org/hrWorkSchedule/getUserAttendanceList'", 'yearMonth: calendarDate.value.format(\'YYYY-MM\')', 'userId: bridge.record.userId', "getDictLabelByValue('absent_type'"]) expect(calendar).toContain(fragment)
    for (const fragment of ['validateWorkShiftType', '同一天已存在全天班次', "http.post('/org/hrWorkSchedule/absenceUser'", "targetTypes = ['3', '4', '7', '8', '9']", '有附件未上传']) expect(issues).toContain(fragment)
    for (const fragment of [':max="10"', 'ossFilePathOptions.hr.risk', 'application/pdf']) expect(upload).toContain(fragment)
    expect(attendanceSchedualInformationCapabilities.map(item => item.id)).toEqual(Object.keys(ATTENDANCE_SCHEDUAL_INFORMATION_METHODS))
    expect(attendanceSchedualInformationCapabilities.filter(item => item.id !== 'attendance-schedual-information-absence-user').every(item => item.write === false)).toBe(true)
    expect(attendanceSchedualInformationCapabilities.find(item => item.id === 'attendance-schedual-information-absence-user')).toMatchObject({ write: true, pagePath: ATTENDANCE_SCHEDUAL_INFORMATION_PAGE_PATH, permission: ATTENDANCE_SCHEDUAL_INFORMATION_PERMISSION, moduleType: ATTENDANCE_SCHEDUAL_INFORMATION_MODULE_TYPE, httpInstance: 'platform' })
  })

  it('按 Portal 月度模式精确发送排序、月份、年份、组织、人员和分页字段', async () => {
    const { year, month } = currentYearMonth()
    const f = fixture([{ list: [{ userId: 7, name: '张三', staffCode: 'A001', postName: '工程师', organizationName: '总部', shouldAttendanceDays: 20, actualAttendanceDays: 18, attendanceDays: 2, absentListGroupByType: [{ typeStr: '病假', count: 1 }] }], total: 1 }])
    await expect(f.api.list({ timePeriod: 1, year, month, organizationIdList: ['18'], name: '张', staffCode: 'A001', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [expect.objectContaining({ userId: 7, name: '张三', shouldAttendanceDays: 20, absentListGroupByType: [{ typeStr: '病假', count: 1, absentUserList: [] }] })], total: 1 })
    expect(f.calls).toEqual([{ url: '/org/hrWorkSchedule/getUserAttendanceListByMonth', method: 'post', data: { order: '', orderField: '', month, year, organizationIdList: ['18'], name: '张', staffCode: 'A001', pageNo: 2, pageSize: 50 } }])
  })

  it('按 Portal 年度模式把 month 置为null，并按日历 query 读取逐日数据', async () => {
    const { year, yearMonth } = currentYearMonth()
    const f = fixture([{ list: [], total: 0 }])
    await expect(f.api.list({ timePeriod: 2, year })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]).toEqual({ url: '/org/hrWorkSchedule/getUserAttendanceListByYear', method: 'post', data: { order: '', orderField: '', month: null, year, organizationIdList: [], name: null, staffCode: null, pageNo: 1, pageSize: 20 } })
    const calendar = fixture([{ name: '张三', postName: '工程师', organizationName: '总部', finaStartDate: `${year}-01-01`, finalEndDate: `${year}-09-23`, attendanceInfoDTOList: [{ id: 1, userId: 7, startDate: `${year}-09-01`, type: 3, typeStr: '事假', amPm: 1, isHoliday: 0 }] }])
    await expect(calendar.api.calendar({ yearMonth, userId: 7 })).resolves.toEqual(expect.objectContaining({ name: '张三', attendanceInfoDTOList: [expect.objectContaining({ startDate: `${year}-09-01`, type: 3, amPm: 1, isHoliday: 0, absentResourceId: null })] }))
    expect(calendar.calls).toEqual([{ url: '/org/hrWorkSchedule/getUserAttendanceList', method: 'get', params: { yearMonth, userId: 7 } }])
  })

  it('异常处理精确提交 Portal 数组，校验附件、班次冲突和回执边界', async () => {
    const f = fixture([undefined])
    const input = { users: [{ userId: 7, name: '张三', absentUserByTypeList: [{ type: 3, absentDate: '2025-09-01', workShiftType: 1 as const, absentFileList: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }] }] }] }
    await expect(f.api.absenceUser(input)).resolves.toBeUndefined()
    expect(f.calls).toEqual([{ url: '/org/hrWorkSchedule/absenceUser', method: 'post', data: input.users }])
    const invalid = fixture([])
    await expect(invalid.api.absenceUser({ users: [] })).rejects.toThrow('至少包含一名人员')
    await expect(invalid.api.absenceUser({ users: [{ userId: 7, absentUserByTypeList: [{ type: 3, absentDate: '2025-09-01', workShiftType: 1 }] }] })).rejects.toThrow('absentFileList不能为空')
    await expect(invalid.api.absenceUser({ users: [{ userId: 7, absentUserByTypeList: [{ type: 1, absentDate: '2025-09-01', workShiftType: 1 }, { type: 1, absentDate: '2025-09-01', workShiftType: 1 }] }] })).rejects.toThrow('重复选择上午')
    await expect(invalid.api.absenceUser({ users: [{ userId: 7, absentUserByTypeList: [{ type: 1, absentDate: '2025-09-01', workShiftType: 3 }, { type: 1, absentDate: '2025-09-01', workShiftType: 2 }] }] })).rejects.toThrow('全天和其它班次')
    expect(invalid.calls).toEqual([])
  })

  it('反证锁定未来期间、非法分页、错误响应和 AI 说明', async () => {
    const { year, month } = currentYearMonth()
    const invalid = fixture([])
    await expect(invalid.api.list({ year: String(Number(year) + 1) })).rejects.toThrow('不能晚于当前年份')
    const futureMonth = month === '12' ? '01' : String(Number(month) + 1).padStart(2, '0')
    const futureMonthYear = month === '12' ? String(Number(year) + 1) : year
    await expect(invalid.api.list({ year: futureMonthYear, month: futureMonth })).rejects.toThrow('不能晚于当前月份')
    await expect(invalid.api.list({ pageSize: 30 })).rejects.toThrow('pageSize必须是')
    await expect(invalid.api.calendar({ yearMonth: `${Number(year) + 1}-01`, userId: 7 })).rejects.toThrow('不能晚于当前月份')
    expect(invalid.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(ATTENDANCE_SCHEDUAL_INFORMATION_METHODS).sort())
    expect(contracts['attendance-schedual-information-absence-user']?.effect).toBe('write')
    expect(contracts['attendance-schedual-information-absence-user']?.idempotency).toContain('无 requestId')
    expect(contracts['attendance-schedual-information-list']?.inputs.organizationIdList?.lookup).toMatchObject({ capabilityId: 'contract-support-role-organization-search', valueField: 'list[].id' })
    expect(contracts['attendance-schedual-information-absence-user']?.steps).toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'base-upload-file' })]))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
