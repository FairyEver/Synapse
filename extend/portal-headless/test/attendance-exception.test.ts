import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ATTENDANCE_EXCEPTION_METHODS,
  ATTENDANCE_EXCEPTION_MODULE_TYPE,
  ATTENDANCE_EXCEPTION_PAGE_PATH,
  ATTENDANCE_EXCEPTION_PERMISSION,
  attendanceExceptionCapabilities,
  createAttendanceExceptionCapability,
} from '../src/capabilities/attendance-exception.js'
import { ATTENDANCE_EXCEPTION_AI_CONTRACTS as contracts } from '../src/catalog/contracts-attendance-exception.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response as T
  }
  return { api: createAttendanceExceptionCapability(request), calls }
}

describe('Portal 组织管理 → 考勤管理 → 异常统计', () => {
  it('逐页锁定菜单、路由、列表、详情弹窗、上传弹窗和后端端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-exception.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-exception/list.vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-exception/components/detail.vue'), 'utf8')
    const upload = readFileSync(join(root, 'app/portal/views/dashboard/hr/attendance/attendance-exception/components/upload-files.vue'), 'utf8')
    for (const fragment of [ATTENDANCE_EXCEPTION_PAGE_PATH, ATTENDANCE_EXCEPTION_PERMISSION, '异常统计']) expect(menu).toContain(fragment)
    for (const fragment of ['title: 异常统计', `permission: ${ATTENDANCE_EXCEPTION_PERMISSION}`, 'common-layout-dashboard-crud-container']) expect(route).toContain(fragment)
    for (const fragment of ["http.post('/org/hrWorkSchedule/getAbsentUserList'", 'yearMonth: today.format(\'YYYY-MM\')', 'organizationIdList: []', 'isUploadFile: null', 'record.processInstanceId', 'record.absentResourceId']) expect(list).toContain(fragment)
    for (const fragment of ["http.get('/org/hrWorkSchedule/getAbsentUserInfo'", 'absentId: props.absentId', 'absentFileList', 'amPm === 1']) expect(detail).toContain(fragment)
    for (const fragment of ["http.post('/org/hrWorkSchedule/uploadAbsentFile'", 'application/pdf', ':max="10"', 'absentFileList', 'absentId: props.absentId']) expect(upload).toContain(fragment)
    expect(attendanceExceptionCapabilities.map(item => item.id)).toEqual(Object.keys(ATTENDANCE_EXCEPTION_METHODS))
    expect(attendanceExceptionCapabilities.find(item => item.id === 'attendance-exception-upload-file')?.write).toBe(true)
    expect(attendanceExceptionCapabilities.filter(item => item.id !== 'attendance-exception-upload-file').every(item => item.write === false && item.pagePath === ATTENDANCE_EXCEPTION_PAGE_PATH && item.permission === ATTENDANCE_EXCEPTION_PERMISSION && item.moduleType === ATTENDANCE_EXCEPTION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('按 Portal customLoad 精确发送月份、组织、人员、附件状态和分页字段', async () => {
    const yearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const f = fixture([{ list: [{ userId: '7', name: '张三', staffCode: 'A001', organizationName: '总部', absentId: 18, absentResourceId: null, type: 3, processInstanceId: 'p-1' }], total: 1 }])
    await expect(f.api.list({ yearMonth, organizationIdList: ['18'], name: '张', staffCode: 'A', isUploadFile: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [expect.objectContaining({ absentId: 18, absentResourceId: null, processInstanceId: 'p-1' })],
      total: 1,
    })
    expect(f.calls).toEqual([{ url: '/org/hrWorkSchedule/getAbsentUserList', method: 'post', data: { order: '', orderField: '', yearMonth, organizationIdList: ['18'], name: '张', staffCode: 'A', isUploadFile: 0, pageNo: 2, pageSize: 50 } }])
  })

  it('详情严格使用 absentId，保留后端字典标签和附件预览字段', async () => {
    const f = fixture([{ name: '张三', amPm: 1, type: 3, typeName: '病假', startDate: '2026-09-20', absentFileList: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }] }])
    await expect(f.api.detail('18')).resolves.toEqual(expect.objectContaining({ name: '张三', amPm: 1, typeName: '病假', absentFileList: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }] }))
    expect(f.calls).toEqual([{ url: '/org/hrWorkSchedule/getAbsentUserInfo', method: 'get', params: { absentId: '18' } }])
  })

  it('上传只投影 Portal 后端实际消费的 url/name，并要求最多10项PDF前置上传', async () => {
    const f = fixture([undefined])
    await expect(f.api.uploadFile({ absentId: 18, absentFileList: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }] })).resolves.toBeUndefined()
    expect(f.calls).toEqual([{ url: '/org/hrWorkSchedule/uploadAbsentFile', method: 'post', data: { absentFileList: [{ url: 'https://oss.test/a.pdf', name: 'a.pdf' }], absentId: 18 } }])
    const invalid = fixture([])
    await expect(invalid.api.uploadFile({ absentId: 18, absentFileList: [] })).rejects.toThrow('至少包含一项')
    await expect(invalid.api.uploadFile({ absentId: 18, absentFileList: Array.from({ length: 11 }, (_, index) => ({ url: `https://oss.test/${index}.pdf`, name: `${index}.pdf` })) })).rejects.toThrow('最多10项')
    await expect(invalid.api.uploadFile({ absentId: 18, absentFileList: [{ url: '', name: 'a.pdf' }] })).rejects.toThrow('url必须')
    expect(invalid.calls).toEqual([])
  })

  it('反证锁定未来月份、附件状态枚举、错误分页和错误响应，不静默降级', async () => {
    const current = new Date()
    const next = new Date(current.getFullYear(), current.getMonth() + 1, 1)
    const future = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    const invalid = fixture([])
    await expect(invalid.api.list({ yearMonth: future })).rejects.toThrow('不能晚于当前月份')
    await expect(invalid.api.list({ isUploadFile: 2 as never })).rejects.toThrow('只能是0、1或null')
    await expect(invalid.api.list({ pageSize: 30 })).rejects.toThrow('pageSize必须是')
    expect(invalid.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{}]).api.detail('18')).resolves.toMatchObject({ name: null, absentFileList: null })
  })

  it('AI说明覆盖列表、详情、上传和流程/字典/OSS后续映射', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(ATTENDANCE_EXCEPTION_METHODS).sort())
    expect(contracts['attendance-exception-list']?.steps.find(step => step.capabilityId === 'task-action-instance')?.mapping).toEqual({ processInstanceId: 'result.list[].processInstanceId' })
    expect(contracts['attendance-exception-upload-file']?.steps.find(step => step.capabilityId === 'base-upload-file')?.mapping).toMatchObject({ folder: 'literal:"HR/risk"', contentType: 'literal:"application/pdf"' })
    expect(contracts['attendance-exception-upload-file']?.idempotency).toContain('覆盖')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
