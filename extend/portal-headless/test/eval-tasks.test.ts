/**
 * 评测装置自检 ①：任务定义的结构。
 *
 * 目的不是「跑通」，是「定义写歪了要红」。任务定义是这套评测的期望源头，
 * 它一旦退化（比如某类难度没覆盖、oracle 写成空数组），后面全绿也没有意义。
 */

import { describe, expect, it } from 'vitest'
import { EVAL_TODAY, TASKS, getTask, type Task } from '../tools/eval/tasks.mjs'

const KINDS = ['direct', 'drilldown', 'missing', 'slang', 'unsupported']
const OUTCOMES = ['call', 'clarify', 'unsupported']
const RULE_KINDS = ['nonEmpty', 'range', 'maxLength', 'minuteIn', 'secondsZero', 'before']

/** 一个任务的「参照能力」：判分规则里的参数名应当来自它。 */
function referenceCapabilityId(task: Task): string | undefined {
  return task.expect.acceptableCapabilityIds?.[0] ?? task.expect.forbiddenCapabilityIds?.[0]
}

describe('eval · 任务定义', () => {
  it('至少 5 个任务，id 唯一且非空', () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(5)
    const ids = TASKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.trim()).not.toBe('')
  })

  it('五类难度各覆盖到，且 kind 合法', () => {
    for (const task of TASKS) expect(KINDS).toContain(task.kind)
    for (const kind of KINDS) {
      expect(TASKS.some((t) => t.kind === kind), `没有覆盖难度「${kind}」`).toBe(true)
    }
  })

  it('每个任务的用户原话 / 目标 / 理由都不为空', () => {
    for (const task of TASKS) {
      expect(task.utterance.trim(), `${task.id} 缺原话`).not.toBe('')
      expect(task.goal.trim(), `${task.id} 缺目标`).not.toBe('')
      expect(task.why.trim(), `${task.id} 缺理由`).not.toBe('')
    }
  })

  it('expect.outcome 合法，且与 oracle 字段自洽', () => {
    for (const task of TASKS) {
      const { expect: e } = task
      expect(OUTCOMES, `${task.id} 的 outcome 非法`).toContain(e.outcome)

      if (e.outcome === 'call') {
        expect(e.acceptableCapabilityIds?.length, `${task.id} 是 call 却没给可接受落点`).toBeGreaterThan(0)
      } else {
        expect(e.acceptableCapabilityIds, `${task.id} 不是 call 却给了可接受落点`).toBeUndefined()
      }

      if (e.outcome === 'clarify') {
        expect(e.missingAnyOf?.length, `${task.id} 是 clarify 却没说要问什么`).toBeGreaterThan(0)
      }

      if (e.outcome === 'unsupported') {
        expect(e.acceptablePageRefs, `${task.id} 是 unsupported 却没定义页面 oracle`).toBeDefined()
      }
    }
  })

  it('argRules 的规则名合法、参数名非空', () => {
    for (const task of TASKS) {
      for (const rule of task.expect.argRules ?? []) {
        expect(RULE_KINDS, `${task.id} 用了未知规则 ${rule.kind}`).toContain(rule.kind)
        expect(rule.arg.trim()).not.toBe('')
        if (rule.kind === 'before') expect(rule.other.trim()).not.toBe('')
      }
    }
  })

  it('有参照能力的任务：argRules / missingAnyOf 的参数名必须真出自那个能力', async () => {
    // 这条把任务定义钉在真实目录上——重命名参数而不同步定义，这里就会红。
    // 走源码入口：dist 是 pre-commit 会重建的产物，钉在上面就等于钉在「上次构建时的世界」。
    const { makeSourceSdk } = await import('../tools/eval/consumer-view.mjs')
    const sdk = await makeSourceSdk()

    for (const task of TASKS) {
      const refId = referenceCapabilityId(task)
      if (!refId) continue
      const described = sdk.catalog.describe(refId) as {
        ok: boolean
        params?: Array<{ name: string }>
      }
      expect(described.ok, `${task.id} 的参照能力 ${refId} 在目录里不存在`).toBe(true)
      const known = new Set((described.params ?? []).map((p) => p.name))

      const referenced = [
        ...(task.expect.argRules ?? []).flatMap((r) => [r.arg, ...(r.kind === 'before' ? [r.other] : [])]),
        ...(task.expect.missingAnyOf ?? []),
      ]
      for (const name of referenced) {
        expect(known.has(name), `${task.id} 引用了 ${refId} 上不存在的参数「${name}」`).toBe(true)
      }
    }
  }, 15000)

  it('requiredChain 只出现在 drilldown 任务上，装的是「中间步骤」，与落点互不重叠', () => {
    for (const task of TASKS) {
      const chain = task.expect.requiredChain
      if (!chain) continue
      expect(task.kind, `${task.id} 不是 drilldown 却要求了链路`).toBe('drilldown')
      expect(chain.length).toBeGreaterThan(1)
      expect(new Set(chain).size, `${task.id} 的链路里有重复项`).toBe(chain.length)
      // 语义分工：requiredChain 是路上的中间步骤，落点是终点。
      // 两者重叠会让「走了链路」和「落在正确能力」变成同一个断言，判分就虚了。
      for (const acceptable of task.expect.acceptableCapabilityIds ?? []) {
        expect(chain, `${task.id} 的 requiredChain 里不该出现终点 ${acceptable}`).not.toContain(acceptable)
      }
    }
  })

  it('requiredChain / forbiddenCapabilityIds 里的能力必须真的在目录里（防拼错 id 静默失效）', async () => {
    const { makeSourceSdk, listRegisteredCapabilityIds } = await import('../tools/eval/consumer-view.mjs')
    const registered = new Set(listRegisteredCapabilityIds(await makeSourceSdk()))
    expect(registered.size).toBeGreaterThan(0)
    for (const task of TASKS) {
      for (const id of task.expect.requiredChain ?? []) {
        expect(registered.has(id), `${task.id} 的链路引用了不存在的能力 ${id}`).toBe(true)
      }
      for (const id of task.expect.forbiddenCapabilityIds ?? []) {
        expect(registered.has(id), `${task.id} 的禁区引用了不存在的能力 ${id}`).toBe(true)
      }
    }
  })

  it('基准日是可解析的日期（相对时间要靠它算）', () => {
    expect(Number.isNaN(Date.parse(EVAL_TODAY))).toBe(false)
  })

  it('getTask 认得的 id 取得到，不认得就抛', () => {
    expect(getTask(TASKS[0]!.id).id).toBe(TASKS[0]!.id)
    expect(() => getTask('这个 id 不存在')).toThrow(/未知评测任务/)
  })
})
