import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  createMeetingRoomCapability,
  meetingRoomCapabilities,
  MEETING_ROOM_METHODS,
  MEETING_ROOM_PERMISSION,
} from '../src/capabilities/meeting-room.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; capabilityId?: string }

function makeSdk (envelope: Record<string, unknown>) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 7 },
  })
  const http = sdk.http as AxiosInstance
  http.defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return { data: envelope, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { sdk, calls }
}

describe('会议室能力 —— 阶段① 第一条业务线（设计 D32）', () => {
  it('能力声明带有会议室菜单权限', () => {
    expect(meetingRoomCapabilities.every(item => item.permission === MEETING_ROOM_PERMISSION)).toBe(true)
  })

  it('列表能力打到 /admin-api/hr/meeting-room/page 并带上分页参数', async () => {
    const { sdk, calls } = makeSdk({ ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } })

    const result = await sdk.meetingRoom.list({ pageNo: 1, pageSize: 10, name: '301' })

    expect(result).toEqual({ list: [], total: 0 })
    const url = String(calls[0]?.url)
    expect(url).toContain('/admin-api/hr/meeting-room/page')
    expect(url).toContain('name=301')
    expect(url).toContain('pageNo=1')
  })

  it('维护动作与页面权限、路径绑定一致', () => {
    expect(meetingRoomCapabilities.map(item => item.id)).toEqual(Object.keys(MEETING_ROOM_METHODS))
    expect(meetingRoomCapabilities.every(item => item.pagePath === '/dashboard/meeting-room/list' && item.permission === MEETING_ROOM_PERMISSION)).toBe(true)
    expect(meetingRoomCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'meeting-room-create',
      'meeting-room-update',
      'meeting-room-delete',
      'meeting-room-update-status',
    ])
  })

  // 占用查询不在这里：它属于会议预定表单（meeting-application），
  // 用例见 test/meeting-application.test.ts。
})

describe('会议室页当前可达写动作', () => {
  type RequestConfig = Parameters<PortalRequest>[0]

  function setup (...responses: unknown[]) {
    const calls: RequestConfig[] = []
    const request: PortalRequest = async <T>(config: RequestConfig) => {
      calls.push(config)
      const result = responses.shift()
      if (result instanceof Error) throw result
      return result as T
    }
    return { api: createMeetingRoomCapability(request), calls }
  }

  it('新建、编辑严格复刻表单字段、校验和提交前取消', async () => {
    const { api, calls } = setup(901, true)
    const create = api.prepareCreate({ form: { name: '  大会议室  ', authorizedOrgId: 7 } })
    expect(create).toEqual({ draft: { name: '  大会议室  ', authorizedOrgId: 7 } })
    expect(api.cancelCreate()).toEqual({ cancelled: true })
    await expect(api.create(create)).resolves.toBe(901)
    expect(calls[0]).toEqual({ url: '/hr/meeting-room/create', method: 'post', data: { name: '  大会议室  ', authorizedOrgId: 7 } })

    const update = api.prepareUpdate({ form: { id: 901, name: '编辑后会议室', authorizedOrgId: '8' } })
    expect(api.cancelUpdate()).toEqual({ cancelled: true })
    await expect(api.update(update)).resolves.toBe(true)
    expect(calls[1]).toEqual({ url: '/hr/meeting-room/update', method: 'put', data: { name: '编辑后会议室', authorizedOrgId: '8', id: 901 } })
    expect(Object.keys(calls[1]?.data as object)).toEqual(['name', 'authorizedOrgId', 'id'])
  })

  it('删除只允许当前禁用行，提交为路径参数且无 query/body', async () => {
    const { api, calls } = setup(true)
    const prepared = api.prepareDelete({ id: 22, currentStatus: 0 })
    expect(api.cancelDelete()).toEqual({ cancelled: true })
    await expect(api.delete(prepared)).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/hr/meeting-room/delete/22', method: 'delete' })
    expect(() => api.prepareDelete({ id: 22, currentStatus: 1 })).toThrow('禁用')
  })

  it('启停按当前行状态取反，status 在 query 且 body 为 null', async () => {
    const { api, calls } = setup(true, true)
    const disable = api.prepareUpdateStatus({ id: 22, currentStatus: 1 })
    expect(disable).toEqual({ previous: { id: 22, status: 1 }, draft: { id: 22, status: 0 } })
    expect(api.cancelUpdateStatus()).toEqual({ cancelled: true })
    await expect(api.updateStatus({ draft: disable.draft })).resolves.toBe(true)
    const enable = api.prepareUpdateStatus({ id: '22', currentStatus: 0 })
    await expect(api.updateStatus({ draft: enable.draft })).resolves.toBe(true)
    expect(calls).toEqual([
      { url: '/hr/meeting-room/update-status/22', method: 'put', params: { status: 0 }, data: null },
      { url: '/hr/meeting-room/update-status/22', method: 'put', params: { status: 1 }, data: null },
    ])
  })

  it('表单、ID、状态和成功回执错误在写入前后拒绝', async () => {
    const { api, calls } = setup()
    for (const form of [
      { name: '', authorizedOrgId: 7 },
      { name: '  ', authorizedOrgId: 7 },
      { name: '中'.repeat(51), authorizedOrgId: 7 },
      { name: '会议室', authorizedOrgId: null as never },
    ]) {
      expect(() => api.prepareCreate({ form })).toThrow()
    }
    expect(() => api.prepareUpdate({ form: { id: 0, name: '会议室', authorizedOrgId: 7 } })).toThrow('id')
    expect(() => api.prepareDelete({ id: 22, currentStatus: 2 as never })).toThrow('currentStatus')
    expect(() => api.prepareUpdateStatus({ id: 22, currentStatus: 2 as never })).toThrow('currentStatus')
    await expect(api.updateStatus({ draft: { id: 22, status: 2 as never } })).rejects.toThrow('status')
    expect(calls).toHaveLength(0)

    const bad = setup(false)
    await expect(bad.api.delete({ draft: { id: 22 } })).rejects.toThrow('不是true')
    expect(bad.calls).toHaveLength(1)
  })
})

describe('call() —— 以「页面上下文」为单位发请求（设计 H2 / F3b）', () => {
  it('/dashboard/meeting-room/list 在规则表里算不出 module-type，因此不发这个头（设计 D34）', async () => {
    const { sdk, calls } = makeSdk({ ret: 'SUCCESS', code: 0, msg: '', data: {} })

    const resolved = sdk.resolveModuleType('/dashboard/meeting-room/list')
    expect(resolved.moduleType).toBeNull()

    await sdk.call('/dashboard/meeting-room/list', { url: '/hr/meeting-room/page', method: 'get' })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers).not.toHaveProperty('module-type')
  })

  it('页面能推出 module-type 时自动带上', async () => {
    const { sdk, calls } = makeSdk({ ret: 'SUCCESS', code: 0, msg: '', data: {} })

    const resolved = sdk.resolveModuleType('/dashboard/analysis/person/list')
    expect(resolved.moduleType).toBe(13)

    await sdk.call('/dashboard/analysis/person/list', { url: '/some/read', method: 'get' })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers['module-type']).toBe('13')
  })

  it('moduleTypeFallback 指定数字时，算不出也强制带上', async () => {
    const calls: CapturedCall[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 7 },
      moduleTypeFallback: 101,
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config as CapturedCall)
      return { data: { ret: 'SUCCESS', code: 0, msg: '', data: {} }, status: 200, statusText: 'OK', headers: {}, config }
    }

    await sdk.call('/dashboard/meeting-room/list', { url: '/x', method: 'get' })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers['module-type']).toBe('101')
  })
})
