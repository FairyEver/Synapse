import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ATTENDANCE_OVERTIME_METHODS,
  ATTENDANCE_OVERTIME_MODULE_TYPE,
  ATTENDANCE_OVERTIME_PAGE_PATH,
  ATTENDANCE_OVERTIME_PERMISSION,
  attendanceOvertimeCapabilities,
  createAttendanceOvertimeCapability,
} from '../src/capabilities/attendance-overtime.js'
import { ATTENDANCE_OVERTIME_AI_CONTRACTS as contracts } from '../src/catalog/contracts-attendance-overtime.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createAttendanceOvertimeCapability(request), calls }
}

describe('Portal 组织管理 → 考勤管理 → 加班记录', () => {
  it('逐页锁定菜单、路由、列表/详情端点、权限和平台上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-overtime.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-overtime/list.vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-overtime/components/view-overtime-dates.vue'), 'utf8')
    for (const fragment of [ATTENDANCE_OVERTIME_PAGE_PATH, ATTENDANCE_OVERTIME_PERMISSION, '加班记录']) expect(menu).toContain(fragment)
    for (const fragment of [`title: 加班记录`, `permission: ${ATTENDANCE_OVERTIME_PERMISSION}`, 'common-layout-dashboard-crud-container']) expect(route).toContain(fragment)
    for (const fragment of ["http.post('/admin-api/hr/overtime-application/record/page'", 'getDataListIsPage: true', 'applicantName: \'\'', 'organizationIdList: []', 'remainingRestHours', '查看已调休日期']) expect(list).toContain(fragment)
    for (const fragment of ["http.get(`/admin-api/hr/overtime-application/record/detail`", 'year: year', 'userId: userId', 'usedRestHours', 'restDates']) expect(detail).toContain(fragment)
    expect(attendanceOvertimeCapabilities.map(item => item.id)).toEqual(Object.keys(ATTENDANCE_OVERTIME_METHODS))
    expect(attendanceOvertimeCapabilities.every(item => item.pagePath === ATTENDANCE_OVERTIME_PAGE_PATH && item.permission === ATTENDANCE_OVERTIME_PERMISSION && item.moduleType === ATTENDANCE_OVERTIME_MODULE_TYPE && item.httpInstance === 'platform' && item.write === false)).toBe(true)
  })

  it('按 Portal 列表组件实际 body 发送姓名、组织和分页字段，并保留后端汇总值', async () => {
    const f = fixture([{ list: [{ applicantId: '7', applicantName: '张三', staffCode: 'A001', organizationName: '总部', postName: '工程师', overtimeHours: 12, remainingRestHours: 8 }], total: 1 }])
    await expect(f.api.list({ applicantName: '张', organizationIdList: ['18', 19], pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [expect.objectContaining({ applicantId: '7', applicantName: '张三', overtimeHours: 12, remainingRestHours: 8 })],
      total: 1,
    })
    expect(f.calls).toEqual([{ url: '/admin-api/hr/overtime-application/record/page', method: 'post', data: { order: '', orderField: '', applicantName: '张', organizationIdList: ['18', 19], pageNo: 2, pageSize: 50 } }])
  })

  it('按 Portal 详情弹窗发送当前/选择年份和 applicantId，并保留无记录语义', async () => {
    const f = fixture([{ year: 2025, applicantName: '张三', organizationName: '总部', postName: '工程师', usedRestHours: 4.5, restDates: '2025-03-01、2025-03-05', restDateList: ['2025-03-01', '2025-03-05'] }])
    await expect(f.api.detail({ year: 2025, userId: '7' })).resolves.toEqual(expect.objectContaining({ year: 2025, usedRestHours: 4.5, restDates: '2025-03-01、2025-03-05', restDateList: ['2025-03-01', '2025-03-05'] }))
    expect(f.calls).toEqual([{ url: '/admin-api/hr/overtime-application/record/detail', method: 'get', params: { year: '2025', userId: '7' } }])
    await expect(fixture([{ year: 2025, usedRestHours: 0, restDates: '无' }]).api.detail({ year: 2025, userId: '7' })).resolves.toEqual(expect.objectContaining({ year: 2025, applicantName: null, usedRestHours: 0, restDates: '无', restDateList: null }))
  })

  it('反证锁定非法年份、分页、列表响应和详情日期形状，不静默降级', async () => {
    const invalid = fixture([])
    await expect(invalid.api.detail({ year: '25', userId: 7 })).rejects.toThrow('year必须是YYYY格式')
    await expect(invalid.api.list({ pageSize: 30 })).rejects.toThrow('pageSize必须是')
    await expect(invalid.api.list({ organizationIdList: '18' as never })).rejects.toThrow('organizationIdList必须是数组')
    expect(invalid.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ year: 2025, restDateList: [20250301] }]).api.detail({ year: 2025, userId: 7 })).rejects.toThrow('日期字符串数组')
  })

  it('AI说明覆盖列表/详情、组织候选和只读 POST 语义完整', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(ATTENDANCE_OVERTIME_METHODS).sort())
    expect(contracts['attendance-overtime-list']?.effect).toBe('read')
    expect(contracts['attendance-overtime-list']?.inputs.organizationIdList?.lookup).toMatchObject({ capabilityId: 'contract-support-role-organization-search', valueField: 'list[].id' })
    expect(contracts['attendance-overtime-list']?.steps[0]).toMatchObject({ capabilityId: 'attendance-overtime-detail', mapping: { userId: 'result.list[].applicantId' } })
    expect(contracts['attendance-overtime-list']?.boundaries.join(' ')).toContain('没有创建、编辑、删除或审批入口')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
