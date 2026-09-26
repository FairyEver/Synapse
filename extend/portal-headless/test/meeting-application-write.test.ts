import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import {
  assertTimeSlot,
  buildMeetingApplicationPayload,
  type MeetingApplicationDraft,
} from '../src/capabilities/meeting-application.js'

/**
 * 提交链路。载荷形状取自表单的 formState（`buildSubmitData()` 是原样展开），
 * 时间规则取自前端的 disabledTime 与后端的 validateTime。
 *
 * 2026-09-20：写链路已在测试环境端到端验证过一次——提交后该时段出现在会议室
 * 占用查询中，取消后消失。真实调用记录见
 * baseline/meeting-application-write.verified.json。
 */

const draft: MeetingApplicationDraft = {
  meetingName: '周会',
  meetingRoomId: 12,
  startTime: '2026-09-22 14:00:00',
  endTime: '2026-09-22 15:00:00',
  attendeeCount: 6,
}

describe('提交载荷构造', () => {
  it('与表单 formState 同形：id 为 null、attendees 缺省为空串', () => {
    expect(buildMeetingApplicationPayload(draft)).toEqual({
      id: null,
      meetingName: '周会',
      meetingRoomId: 12,
      startTime: '2026-09-22 14:00:00',
      endTime: '2026-09-22 15:00:00',
      attendeeCount: 6,
      attendees: '',
    })
  })

  it('会议名称必填且不超过 30 字', () => {
    expect(() => buildMeetingApplicationPayload({ ...draft, meetingName: '' })).toThrow(/会议名称/)
    expect(() => buildMeetingApplicationPayload({ ...draft, meetingName: 'x'.repeat(31) })).toThrow(/30/)
  })

  it('会议室与参会人数必填', () => {
    expect(() => buildMeetingApplicationPayload({ ...draft, meetingRoomId: undefined as never })).toThrow(/会议室/)
    expect(() => buildMeetingApplicationPayload({ ...draft, attendeeCount: undefined as never })).toThrow(/参会人数/)
  })

  it('参会人不超过 500 字', () => {
    expect(() => buildMeetingApplicationPayload({ ...draft, attendees: 'x'.repeat(501) })).toThrow(/500/)
  })
})

describe('时间段规则（前端 disabledTime + 后端 validateTime）', () => {
  it('分钟只能是 00 或 30', () => {
    expect(() => assertTimeSlot('2026-09-22 14:15:00', '2026-09-22 15:00:00')).toThrow(/分钟/)
    expect(() => assertTimeSlot('2026-09-22 14:00:00', '2026-09-22 15:30:00')).not.toThrow()
  })

  it('秒只能是 00', () => {
    expect(() => assertTimeSlot('2026-09-22 14:00:30', '2026-09-22 15:00:00')).toThrow(/秒/)
  })

  it('结束必须晚于开始', () => {
    expect(() => assertTimeSlot('2026-09-22 15:00:00', '2026-09-22 14:00:00')).toThrow(/晚于/)
    expect(() => assertTimeSlot('2026-09-22 14:00:00', '2026-09-22 14:00:00')).toThrow(/晚于/)
  })

  it('格式不对时报错', () => {
    expect(() => assertTimeSlot('2026/09/22 14:00', '2026/09/22 15:00')).toThrow(/格式/)
  })
})

function captureSdk () {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { sdk, calls }
}

describe('prepare / submit 的请求形状', () => {
  /** axios 在到达 adapter 前已按 transformRequest 把 body 序列化，这里还原 */
  function bodyOf (config: InternalAxiosRequestConfig | undefined): Record<string, unknown> {
    const raw = config?.data
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  }

  it('prepare 只打 getRequiredStartUserSelectTasks，不打 create', async () => {
    const { sdk, calls } = captureSdk()
    const result = await sdk.meetingApplication.prepare(draft)

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.url)).toContain('/admin-api/hr/meeting-application/getRequiredStartUserSelectTasks')
    expect(String(calls[0]?.url)).not.toContain('/create')
    expect(result.tasks).toEqual([])
    expect(result.payload.meetingRoomId).toBe(12)
  })

  it('prepare 的 body 是完整提交载荷', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.prepare(draft)

    expect(bodyOf(calls[0])).toEqual({
      id: null,
      meetingName: '周会',
      meetingRoomId: 12,
      startTime: '2026-09-22 14:00:00',
      endTime: '2026-09-22 15:00:00',
      attendeeCount: 6,
      attendees: '',
    })
  })

  it('submit 打 create，并把审批人合并进载荷', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.submit(draft, { taskA: [7, 8] })

    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.url)).toContain('/admin-api/hr/meeting-application/create')
    const body = bodyOf(calls[0])
    expect(body.id).toBeNull()
    expect(body.startUserSelectAssignees).toEqual({ taskA: [7, 8] })
  })

  it('POST 走 JSON body（与前端默认一致，非 urlencoded）', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.submit(draft, {})

    const headers = calls[0]?.headers as unknown as Record<string, string>
    const contentType = headers['Content-Type'] ?? headers['content-type']
    expect(String(contentType)).toContain('application/json')
  })
})

describe('取消预定', () => {
  it('打到 cancel-reservation/{id}，用 PUT', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.cancelReservation(50)

    expect(String(calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(String(calls[0]?.url)).toBe('/admin-api/hr/meeting-application/cancel-reservation/50')
  })
})

describe('占用查询的响应结构', () => {
  it('是 { organizationId, date, meetingRooms } 而不是数组', async () => {
    const calls: InternalAxiosRequestConfig[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config)
      return {
        data: {
          ret: 'SUCCESS',
          code: 0,
          msg: '',
          data: { organizationId: 1, date: '2026-09-22', meetingRooms: [{ meetingRoomId: 5, meetingRoomName: '博创小会议室', timeSlots: [] }] },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const result = await sdk.meetingApplication.roomUsage('2026-09-22')
    expect(Array.isArray(result)).toBe(false)
    expect(result.meetingRooms).toHaveLength(1)
    expect(result.meetingRooms[0]?.meetingRoomName).toBe('博创小会议室')
  })
})
