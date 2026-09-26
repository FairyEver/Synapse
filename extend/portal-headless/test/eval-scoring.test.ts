/**
 * 评测装置自检 ②：判分逻辑。
 *
 * 判分器必须「坏的时候会红」。所以每个 describe 里同时放正例与反例：
 * 反例都是**真实可能出现的坏作答**（落点选错、编能力、参数缺出处、
 * 时间不合契约、信息不足却硬提交），不是凑数的假数据。
 */

import { describe, expect, it } from 'vitest'
import { getTask, type Task } from '../tools/eval/tasks.mjs'
import { scoreDecision, scoreRun, type Decision } from '../tools/eval/scoring.mjs'

/** 目录里真实存在的 7 个能力，当作判分时的白名单。 */
const REGISTERED = [
  'meeting-room-list',
  'meeting-application-definition',
  'meeting-room-usage',
  'meeting-user-search',
  'meeting-application-prepare',
  'meeting-application-submit',
  'meeting-application-cancel',
]
const CTX = { registeredCapabilityIds: REGISTERED }

function checkNames(result: ReturnType<typeof scoreDecision>, failedOnly = false): string[] {
  return result.checks.filter((c) => !failedOnly || !c.ok).map((c) => c.name)
}

function baseDecision(taskId: string, over: Partial<Decision> = {}): Decision {
  return { taskId, outcome: 'call', ...over }
}

describe('eval · 判分：T1 直答', () => {
  const task = getTask('T1-direct-lookup')

  it('正例：落在 meeting-room-list、参数带出处 → 全过', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-room-list',
      chain: ['meeting-room-list'],
      args: {
        pageNo: { value: 1, from: 'describe 默认值' },
        pageSize: { value: 20, from: 'describe 默认值' },
      },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed, JSON.stringify(result.checks.filter((c) => !c.ok))).toBe(true)
  })

  it('反例：落到 meeting-room-usage（同域、分更高）→ landing 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-room-usage',
      args: { date: { value: '2026-09-21', from: '猜的' } },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('landing')
  })

  it('反例：pageSize 传 -1（全量拉取）→ range 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-room-list',
      args: {
        pageNo: { value: 1, from: 'x' },
        pageSize: { value: -1, from: 'x' },
      },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('range:pageSize')
  })
})

describe('eval · 判分：T2 下钻', () => {
  const task = getTask('T2-drilldown-booking')

  const goodArgs: Decision['args'] = {
    meetingName: { value: '周会', from: '用户原话' },
    meetingRoomId: { value: 5, from: 'roomUsage 返回', deferred: true },
    startTime: { value: '2026-09-21 14:00:00', from: '用户 + 基准日' },
    endTime: { value: '2026-09-21 15:00:00', from: '用户' },
    attendeeCount: { value: 2, from: '用户原话' },
  }

  it('正例：链路走全、参数合契约 → 全过', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare'],
      args: goodArgs,
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed, JSON.stringify(result.checks.filter((c) => !c.ok))).toBe(true)
  })

  it('反例：跳过 prepare 直接 submit → required-chain 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage'],
      args: goodArgs,
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('required-chain')
  })

  it('反例：分钟填 15（Portal 只允许 00/30）→ minuteIn 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare'],
      args: { ...goodArgs, startTime: { value: '2026-09-21 14:15:00', from: 'x' } },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('minuteIn:startTime')
  })

  it('反例：结束早于开始 → before 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare'],
      args: {
        ...goodArgs,
        startTime: { value: '2026-09-21 15:00:00', from: 'x' },
        endTime: { value: '2026-09-21 14:00:00', from: 'x' },
      },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('before:startTime')
  })

  it('反例：参数没交代出处 → arg-provenance 红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-room-list', 'meeting-room-usage', 'meeting-application-prepare'],
      args: { ...goodArgs, meetingRoomId: { value: 5, from: '   ' } },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('arg-provenance')
  })
})

describe('eval · 判分：T3 信息不足', () => {
  const task = getTask('T3-missing-info')

  it('正例：把该问的都问了 → 全过', () => {
    const decision = baseDecision(task.id, {
      outcome: 'clarify',
      missing: ['startTime', 'endTime', 'meetingRoomId', 'meetingName', 'attendeeCount'],
    })
    expect(scoreDecision(task, decision, CTX).passed).toBe(true)
  })

  it('反例：只问了时间，没问哪间会议室 → clarification-covers 红', () => {
    const decision = baseDecision(task.id, { outcome: 'clarify', missing: ['startTime', 'endTime'] })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('clarification-covers')
  })

  it('反例：信息不足却直接提交 → outcome 与 no-forbidden-call 双红', () => {
    const decision = baseDecision(task.id, {
      capabilityId: 'meeting-application-submit',
      chain: ['meeting-application-submit'],
      args: { meetingName: { value: '会议', from: '猜的' } },
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    const failed = checkNames(result, true)
    expect(failed).toContain('outcome')
    expect(failed).toContain('no-forbidden-call')
  })
})

describe('eval · 判分：T4 / T5 说「没有」', () => {
  it('T4 正例：给出命中的页面 + 说不支持 → 全过', () => {
    const task = getTask('T4-slang-pay-adjust')
    const decision = baseDecision(task.id, { outcome: 'unsupported', pageRef: '工资找齐' })
    expect(scoreDecision(task, decision, CTX).passed).toBe(true)
  })

  it('T4 反例：编一个能力出来顶替 → no-fabricated-capability 红', () => {
    const task = getTask('T4-slang-pay-adjust')
    const decision = baseDecision(task.id, {
      capabilityId: 'salary-adjust-submit',
      chain: ['salary-adjust-submit'],
    })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('no-fabricated-capability')
  })

  it('T4 反例：说没有却指不出是哪个页面 → page-identified 红', () => {
    const task = getTask('T4-slang-pay-adjust')
    const decision = baseDecision(task.id, { outcome: 'unsupported' })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('page-identified')
  })

  it('T5 正例：零命中、不给页面、不编能力 → 全过', () => {
    const task = getTask('T5-unsupported')
    const decision = baseDecision(task.id, { outcome: 'unsupported' })
    expect(scoreDecision(task, decision, CTX).passed).toBe(true)
  })

  it('T5 反例：零命中却硬塞一个页面 → no-page-claimed 红', () => {
    const task = getTask('T5-unsupported')
    const decision = baseDecision(task.id, { outcome: 'unsupported', pageRef: '/dashboard/somewhere' })
    const result = scoreDecision(task, decision, CTX)
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('no-page-claimed')
  })
})

describe('eval · 判分：整轮与缺答', () => {
  const tasks: Task[] = [getTask('T1-direct-lookup'), getTask('T5-unsupported')]

  it('缺答的题算未过，不会静默跳过', () => {
    const run = scoreRun(tasks, { 'T5-unsupported': baseDecision('T5-unsupported', { outcome: 'unsupported' }) }, CTX)
    expect(run.total).toBe(2)
    expect(run.passed).toBe(1)
    expect(run.failed).toBe(1)
    const missing = run.results.find((r) => r.taskId === 'T1-direct-lookup')
    expect(missing?.passed).toBe(false)
    expect(missing?.checks.map((c) => c.name)).toContain('answer-present')
  })

  it('全对时 passed 等于总数', () => {
    const run = scoreRun(
      tasks,
      {
        'T1-direct-lookup': baseDecision('T1-direct-lookup', {
          capabilityId: 'meeting-room-list',
          args: { pageNo: { value: 1, from: 'x' }, pageSize: { value: 20, from: 'x' } },
        }),
        'T5-unsupported': baseDecision('T5-unsupported', { outcome: 'unsupported' }),
      },
      CTX,
    )
    expect(run.passed).toBe(run.total)
  })

  it('白名单为空时，任何能力都算编造（防止判分退化成永真）', () => {
    const task = getTask('T1-direct-lookup')
    const decision = baseDecision(task.id, { capabilityId: 'meeting-room-list' })
    const result = scoreDecision(task, decision, { registeredCapabilityIds: [] })
    expect(result.passed).toBe(false)
    expect(checkNames(result, true)).toContain('no-fabricated-capability')
  })
})
