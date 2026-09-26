import { describe, it, expect, vi, afterEach } from 'vitest'
import { ATTENDANCE_SHEET_ARCHIVE_PERMISSION, ATTENDANCE_SHEET_PERMISSION, attendanceSheetCapabilities, createAttendanceSheetCapability, buildSheetPayload } from '../src/capabilities/attendance-sheet.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import { createPortalHeadless } from '../src/index.js'
import { createPortalServer } from '../src/server.js'
import type { InternalAxiosRequestConfig } from 'axios'
import { readFileSync } from 'node:fs'

const draft = { departmentId: '101', organizationId: '100', yearMonth: '2025-12', userIdList: ['21', '22'] }
const detail = { id: '144', departmentId: '101', organizationId: '100', year: 2025, month: 12, isArchived: 0, userList: [{ id: '21', realName: '甲' }, { id: '22', realName: '乙' }] }
function fixture(handler: (request: Parameters<PortalRequest>[0]) => unknown = () => detail) {
  const calls: Parameters<PortalRequest>[0][] = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => { calls.push(config); return handler(config) as T }
  return { api: createAttendanceSheetCapability(request), calls }
}
afterEach(() => vi.useRealTimers())

describe('考勤表页面动作', () => {
  it('每个能力声明对应的Portal菜单权限，归档动作使用档案页面权限', () => {
    expect(attendanceSheetCapabilities.filter(item => item.pagePath === '/dashboard/attendance/attendance-sheet/list').every(item => item.permission === ATTENDANCE_SHEET_PERMISSION)).toBe(true)
    expect(attendanceSheetCapabilities.filter(item => item.pagePath === '/dashboard/attendance/attendance-archive-sheet/list').every(item => item.permission === ATTENDANCE_SHEET_ARCHIVE_PERMISSION)).toBe(true)
  })

  it('保存年月拆分、成员整组及null班组，不透传requestId和隐藏字段', () => {
    expect(buildSheetPayload(draft)).toEqual({ id: null, departmentId: '101', organizationId: '100', userIdList: ['21', '22'], year: '2025', month: '12' })
    expect(buildSheetPayload({ ...draft, organizationId: null }).organizationId).toBeNull()
    expect(() => buildSheetPayload({ ...draft, userIdList: [] })).toThrow('请添加人员')
    expect(() => buildSheetPayload({ ...draft, yearMonth: '2025-13' })).toThrow('YYYY-MM')
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 22))
    expect(() => buildSheetPayload({ ...draft, yearMonth: '2026-10' })).toThrow('不能晚于')
  })
  it('读取编辑信息只返回页面人员，保留大ID且排除敏感扩展', async () => {
    const f = fixture(() => ({ ...detail, userList: [{ id: '9007199254740993123', realName: '甲', password: 'ignored' }] }))
    expect(await f.api.get({ id: '144' })).toEqual({ id: '144', departmentId: '101', organizationId: '100', yearMonth: '2025-12', isArchived: 0, users: [{ id: '9007199254740993123', name: '甲' }] })
    expect(f.calls[0]).toEqual({ url: '/org/hrAttendanceSheet/info/144', method: 'get' })
  })
  it('当前用户无部门时返回明确空部门，和AI契约一致', async () => {
    expect(await fixture(() => null).api.department()).toEqual({ id: null, fullPath: null })
  })
  it('无班组表归档/删除/统计不额外查会空指针的info接口', async () => {
    const f = fixture(call => {
      if (call.url.includes('/info/')) throw new Error('后端无班组详情空指针')
      return call.url.includes('Statistic') ? [] : undefined
    })
    await f.api.archive({ id: '145', isArchived: 0 })
    await f.api.remove({ id: '145', isArchived: 0 })
    expect(await f.api.statistics({ id: '145', isArchived: 0 })).toEqual([])
    expect(f.calls).toHaveLength(3)
    await expect(f.api.archive({ id: '145', isArchived: undefined as never })).rejects.toThrow('isArchived')
  })
  it('沿用列表归档状态阻止编辑、删除和再次归档，GET写动作不能误标只读', async () => {
    const f = fixture(() => ({ ...detail, isArchived: 1 }))
    for (const run of [() => f.api.save({ ...draft, id: '144', isArchived: 1 }), () => f.api.remove({ id: '144', isArchived: 1 }), () => f.api.archive({ id: '144', isArchived: 1 })]) await expect(run()).rejects.toThrow('已归档')
    expect(f.calls).toHaveLength(0)
    expect(f.calls.every(call => call.url.endsWith('/info/144'))).toBe(true)
  })
  it('归档/取消归档按页面GET接口，删除按DELETE路径且无请求体', async () => {
    const f = fixture()
    await f.api.archive({ id: '144', isArchived: 0 }); await f.api.unarchive({ id: '144' }); await f.api.remove({ id: '144', isArchived: 0 })
    expect(f.calls.filter(call => !call.url.includes('/info/'))).toEqual([
      { url: '/org/hrAttendanceSheet/archiveSheet', method: 'get', params: { id: '144' } },
      { url: '/org/hrAttendanceSheet/unArchiveSheet', method: 'get', params: { id: '144' } },
      { url: '/org/hrAttendanceSheet/delete/144', method: 'delete' },
    ])
  })
  it('取消归档使用档案页面请求上下文', async () => {
    const normal = vi.fn(async () => detail), archive = vi.fn(async () => undefined)
    const api = createAttendanceSheetCapability(normal as PortalRequest, archive as PortalRequest)
    await api.unarchive({ id: '144' })
    expect(normal).not.toHaveBeenCalled(); expect(archive).toHaveBeenCalledOnce()
  })
  it('人员候选拒绝空关键字，以用户ID而非工号填表', async () => {
    const f = fixture(() => ({ list: [{ id: '21', realName: '甲', username: '0012', organizationName: '一部', password: 'ignored' }], total: 1 }))
    await expect(f.api.searchUsers({ keyword: ' ' })).rejects.toThrow('keyword')
    expect(f.calls).toHaveLength(0)
    expect(await f.api.searchUsers({ keyword: ' 甲 ' })).toEqual({ list: [{ id: '21', name: '甲', staffCode: '0012', organizationName: '一部' }], total: 1 })
    expect(f.calls[0]?.params).toEqual({ name: '甲', organizationId: '', pageNo: 1, pageSize: 5 })
  })
  it('班组按当前部门获取，keyword本地筛选后限量，不无条件输出', async () => {
    const f = fixture(() => [{ id: '10', fullPath: '总部-甲组' }, { id: '11', fullPath: '总部-乙组' }])
    await expect(f.api.searchGroups({ departmentId: '101', keyword: '' })).rejects.toThrow('keyword')
    expect(await f.api.searchGroups({ departmentId: '101', keyword: '甲' })).toEqual({ list: [{ id: '10', fullPath: '总部-甲组' }], total: 1 })
    expect(f.calls[0]?.params).toEqual({ departmentId: '101' })
  })
  it.each([0, 1])('统计簿按归档状态%s分流，非分页并只保留可见列', async isArchived => {
    const f = fixture(call => call.url.includes('/info/') ? { ...detail, isArchived } : [{ userName: '甲', dayWork: 2, total: null, funeral: 99 }])
    const rows = await f.api.statistics({ id: '144', isArchived })
    expect(f.calls[0]).toEqual({ url: `/org/hrAttendanceSheet/get${isArchived === 1 ? 'Archive' : 'UnArchive'}StatisticInfo`, method: 'get', params: { order: '', orderField: '', id: '144' } })
    expect(rows[0]).toMatchObject({ userName: '甲', dayWork: 2, total: 0, injury: 0 })
    expect(rows[0]).not.toHaveProperty('funeral')
  })
})

describe('实际SDK接线和AI说明', () => {
  const config = { baseUrl: 'https://example.invalid', userId: 'user-a', credential: { token: 'test', tenantId: 1 } }
  it('invoke保存复用requestId只发一次，后端body不含requestId', async () => {
    const sdk = createPortalHeadless(config)
    const calls: InternalAxiosRequestConfig[] = []
    sdk.http.defaults.adapter = async request => { calls.push(request); return { data: { ret: 'SUCCESS', data: null }, status: 200, statusText: 'OK', headers: {}, config: request } }
    await sdk.capabilities.invoke('attendance-sheet-save', { ...draft, requestId: 'attendance-save-test-1' })
    await sdk.capabilities.invoke('attendance-sheet-save', { ...draft, requestId: 'attendance-save-test-1' })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]!.data as string)).toEqual(buildSheetPayload(draft))
    expect(calls[0]?.headers['module-type']).toBe('11')
  })
  it('多用户门面也挂入invoke，实例与module-type来自页面', async () => {
    const calls: unknown[] = []
    const server = createPortalServer({ baseUrl: config.baseUrl, sessionOptions: { createRequest: () => async <T>(request: unknown) => { calls.push(request); return { id: '101', fullPath: '一部' } as T } } })
    const session = await server.forSession({ userId: 'a', credential: config.credential })
    expect(await session.capabilities.invoke('attendance-sheet-department', {})).toEqual({ id: '101', fullPath: '一部' })
    expect(calls).toHaveLength(1)
  })
  it('describe真实输出解释整组覆盖、用户ID映射、GET写和取消快照', () => {
    const sdk = createPortalHeadless(config)
    const save = sdk.catalog.describe('attendance-sheet-save-llm')
    expect(save.ok).toBe(true); if (!save.ok) return
    expect(save.ai?.inputs.userIdList?.meaning).toContain('替换全部成员')
    expect(save.ai?.inputs['userIdList[]']?.meaning).toContain('不是工号')
    expect(save.ai?.output.shape).toBe('undefined')
    const get = sdk.catalog.describe('attendance-sheet-get'); if (!get.ok) throw new Error('missing get')
    expect(get.ai?.steps[0]?.mapping?.userIdList).toBe('result.users[].id')
    const archive = sdk.catalog.describe('attendance-sheet-archive'); if (!archive.ok) throw new Error('missing archive')
    expect(archive.ai?.effect).toBe('write')
    const undo = sdk.catalog.describe('attendance-sheet-unarchive'); if (!undo.ok) throw new Error('missing unarchive')
    expect(undo.ai?.purpose).toContain('删除该表归档快照')
  })
  it('SDK最终请求与2026-09-22浏览器编辑/候选基准逐字段一致', async () => {
    const baseline = JSON.parse(readFileSync(new URL('../baseline/attendance-sheet-actions.browser.json', import.meta.url), 'utf8')) as { requests: Array<{url:string; method:string; headers:Record<string,string>}> }
    const sdk = createPortalHeadless({ ...config, baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const requests: InternalAxiosRequestConfig[] = []
    sdk.http.defaults.adapter = async req => {
      requests.push(req)
      const data = String(req.url).includes('info/') ? detail : String(req.url).includes('getUserDepartment') ? {id:'101',fullPath:'部门'} : String(req.url).includes('getGradeGroup') ? [] : {list:[],total:0}
      return { data: { ret: 'SUCCESS', data }, status: 200, statusText: 'OK', headers: {}, config: req }
    }
    await sdk.attendanceSheet.get({id:'144'})
    await sdk.attendanceSheet.department()
    await sdk.attendanceSheet.searchGroups({departmentId:'101',keyword:'测试'})
    await sdk.attendanceSheet.searchUsers({keyword:'李'})
    for (const req of requests) {
      const actual = sdk.http.getUri(req).replace(/([?&]_t=)\d+/, '$1<ts>')
      const expected = baseline.requests.find(row => row.url === actual)
      expect(expected, actual).toBeDefined()
      expect(req.method?.toUpperCase()).toBe(expected!.method)
      expect(req.headers['module-type']).toBe(expected!.headers['module-type'])
      expect(String(req.headers['tenant-id'])).toBe(expected!.headers['tenant-id'])
    }
  })
})
