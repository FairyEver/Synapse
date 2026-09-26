import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AiContract } from '../src/catalog/ai-contract.js'
import { createMeetingApplicationCapability, type MeetingApplicationDraft } from '../src/capabilities/meeting-application.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
const { validateAiContract } = await import(validatorUrl) as {
  validateAiContract: (id: string, value: unknown, options?: { profile?: 'structural' | 'complete' }) => Array<{ code: string; path: string }>
}
const readExample = (id: string): AiContract => JSON.parse(readFileSync(
  new URL(`../docs/ai-description-examples/${id}.json`, import.meta.url), 'utf8',
)) as AiContract

describe('面向 AI 的配套描述样例', () => {
  it.each(['meeting-room-usage', 'meeting-application-prepare'])('%s 使用权威结构且如实保留证据缺口', id => {
    const example = readExample(id)
    expect(validateAiContract(id, example)).toEqual([])
    expect(example.gaps?.length).toBeGreaterThan(0)
    expect(validateAiContract(id, example, { profile: 'complete' })).toEqual([
      expect.objectContaining({ code: 'incomplete-evidence', path: '$.gaps' }),
    ])
  })

  it('占用样例区分返回根对象、会议室ID、时段及可选显示字段', () => {
    const contract = readExample('meeting-room-usage')
    const fields = new Map(contract.output.fields.map(field => [field.path, field]))
    expect(fields.get('$')?.type).toBe('object')
    expect(fields.get('meetingRooms')?.type).toBe('array')
    expect(fields.get('meetingRooms[].meetingRoomId')?.meaning).toContain('不是申请单ID')
    expect(fields.get('meetingRooms[].timeSlots[].userName')?.optional).toBe(true)
    expect(contract.steps[0]?.mapping).toEqual({ meetingRoomId: 'result.meetingRooms[].meetingRoomId' })
    expect(contract.steps[0]?.instruction).toContain('一个会议室ID')
    expect(contract.completion).toContain('不能作为预定成功')
  })

  it('prepare 样例回包与真实 SDK 载荷构造一致，离线桩不产生业务写入', async () => {
    const contract = readExample('meeting-application-prepare')
    const example = contract.examples![0]!
    const requests: Array<Parameters<PortalRequest>[0]> = []
    const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]): Promise<T> => {
      requests.push(config)
      return [] as T
    }
    const sdk = createMeetingApplicationCapability(request)
    const result = await sdk.prepare(example.args as MeetingApplicationDraft)

    // Expected result is a hand-written documentation fixture, not copied from a formatter.
    expect(result).toEqual(example.result)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/hr/meeting-application/getRequiredStartUserSelectTasks')
    expect(contract.effect).toBe('prepare')
    expect(contract.completion).toContain('不能提前声称已预定')
  })

  it('提交映射是目标参数到来源，明确排除后端载荷专属字段', () => {
    const contract = readExample('meeting-application-prepare')
    const submit = contract.steps.find(step => step.capabilityId === 'meeting-application-submit')!
    expect(submit.mapping).toEqual({
      meetingName: 'result.payload.meetingName', meetingRoomId: 'result.payload.meetingRoomId',
      startTime: 'result.payload.startTime', endTime: 'result.payload.endTime',
      attendeeCount: 'result.payload.attendeeCount', attendees: 'result.payload.attendees',
      startUserSelectAssignees: 'context.assignees', requestId: 'context.requestId',
    })
    expect(submit.mapping).not.toHaveProperty('payload')
    expect(submit.mapping).not.toHaveProperty('id')
    expect(submit.mapping).not.toHaveProperty('tasks')
    expect(submit.when).toContain('所有需要选人的节点已补齐')
    expect(submit.instruction).toContain('{节点ID:[人员ID]}')
    const taskId = contract.output.fields.find(field => field.path === 'tasks[].id')!
    expect(taskId.meaning).toContain('不是人员ID')
    expect(contract.steps.some(step => step.role === 'cancel')).toBe(false)
  })
})
