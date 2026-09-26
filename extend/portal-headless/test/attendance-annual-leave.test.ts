import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ATTENDANCE_ANNUAL_LEAVE_METHODS,
  ATTENDANCE_ANNUAL_LEAVE_MODULE_TYPE,
  ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH,
  ATTENDANCE_ANNUAL_LEAVE_PERMISSION,
  attendanceAnnualLeaveCapabilities,
  createAttendanceAnnualLeaveCapability,
} from '../src/capabilities/attendance-annual-leave.js'
import { ATTENDANCE_ANNUAL_LEAVE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-attendance-annual-leave.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createAttendanceAnnualLeaveCapability(request), calls }
}

function response (data: ArrayBuffer, headers: Record<string, string> = {}): AxiosResponse<ArrayBuffer> {
  return { data, status: 200, statusText: 'OK', headers, config: {} as AxiosResponse['config'] }
}

describe('Portal 组织管理 → 考勤管理 → 年假管理', () => {
  it('逐页锁定菜单、路由、请求端点、权限和平台上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-annual-leave.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-annual-leave/list.vue'), 'utf8')
    const modal = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-annual-leave/components/view-leave.vue'), 'utf8')
    for (const fragment of [`${ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH}`, `${ATTENDANCE_ANNUAL_LEAVE_PERMISSION}`, '年假管理']) expect(menu).toContain(fragment)
    for (const fragment of [`title: 年假管理`, `permission: ${ATTENDANCE_ANNUAL_LEAVE_PERMISSION}`, 'common-layout-dashboard-crud-container']) expect(route).toContain(fragment)
    for (const fragment of ["http.post('/org/holiday/getYearRest'", 'getDataListIsPage: true', 'organizationIdList: []', "year: today.format('YYYY')", 'shouldYearRestDays', 'actualYearRestDays', 'remainingAnnualLeaveDays', "exportYearRest", 'generateHttpHeaders()']) expect(list).toContain(fragment)
    for (const fragment of ['absentListByYearRest', 'amPm === 1', '上午', '下午']) expect(modal).toContain(fragment)
    expect(attendanceAnnualLeaveCapabilities.map(item => item.id)).toEqual(Object.keys(ATTENDANCE_ANNUAL_LEAVE_METHODS))
    expect(attendanceAnnualLeaveCapabilities.every(item => item.pagePath === ATTENDANCE_ANNUAL_LEAVE_PAGE_PATH && item.permission === ATTENDANCE_ANNUAL_LEAVE_PERMISSION && item.moduleType === ATTENDANCE_ANNUAL_LEAVE_MODULE_TYPE && item.httpInstance === 'platform' && item.write === false)).toBe(true)
  })

  it('按 Portal 列表组件实际 body 发送分页、筛选和年份，并保留页面计算字段', async () => {
    const year = String(new Date().getFullYear())
    const f = fixture([{ list: [{
      userId: '7', name: '张三', staffCode: 'A001', organizationName: '总部', postName: '工程师',
      workDate: '2026-01-01', entryTime: '2020-02-03', year, startDate: '2026-01-01', endDate: '2026-12-31',
      shouldYearRestDays: 10, actualYearRestDays: 4.5, absentListByYearRest: [{ startDate: '2026-05-01', amPm: 1 }],
    }], total: 1 }])
    await expect(f.api.list({ name: '张', organizationIdList: ['18', 19], year, pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [expect.objectContaining({ staffCode: 'A001', remainingAnnualLeaveDays: 5.5, absentListByYearRest: [{ startDate: '2026-05-01', amPm: 1 }] })],
      total: 1,
    })
    expect(f.calls).toEqual([{ url: '/org/holiday/getYearRest', method: 'post', data: { order: '', orderField: '', name: '张', organizationIdList: ['18', 19], year, pageNo: 2, pageSize: 50 } }])
  })

  it('导出只提交 Portal 表单筛选字段，不把分页或排序混入文件请求', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]).buffer
    const f = fixture([response(bytes, { 'content-disposition': "attachment; filename*=UTF-8''年假管理表.xlsx", 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })])
    await expect(f.api.export({ name: null, organizationIdList: [], year: '2026', pageNo: 9, pageSize: 100 })).resolves.toMatchObject({ fileName: '年假管理表.xlsx', byteLength: 4, base64: 'UEsDBA==' })
    expect(f.calls).toEqual([{ url: '/org/holiday/exportYearRest', method: 'post', data: { name: null, organizationIdList: [], year: '2026' }, responseType: 'arraybuffer' }])
  })

  it('反证锁定未来年份、分页枚举、错误分页和空导出，不静默降级', async () => {
    const currentYear = new Date().getFullYear()
    const invalid = fixture([])
    await expect(invalid.api.list({ year: String(currentYear + 1) })).rejects.toThrow('不能晚于当前年份')
    await expect(invalid.api.list({ pageSize: 30 })).rejects.toThrow('pageSize必须是')
    expect(invalid.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([response(new ArrayBuffer(0))]).api.export()).rejects.toThrow('响应为空')
  })

  it('AI说明覆盖列表和导出，组织候选、页面计算和只读 POST 语义完整', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(ATTENDANCE_ANNUAL_LEAVE_METHODS).sort())
    expect(contracts['attendance-annual-leave-list']?.effect).toBe('read')
    expect(contracts['attendance-annual-leave-list']?.inputs.organizationIdList?.lookup).toMatchObject({ capabilityId: 'contract-support-role-organization-search', valueField: 'list[].id' })
    expect(contracts['attendance-annual-leave-list']?.output.fields.find(field => field.path === 'list[].remainingAnnualLeaveDays')?.meaning).toContain('shouldYearRestDays - actualYearRestDays')
    expect(contracts['attendance-annual-leave-export']?.boundaries.join(' ')).toContain('没有新建、编辑、删除或审批')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
