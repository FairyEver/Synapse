/**
 * 评测装置自检 ③：调用方视角。
 *
 * 这台装置的全部价值在于「作答者只看得到真实调用方看得到的东西」。
 * 所以这里最关键的一条是**不泄露**：consumer-view 的输出里不许出现
 * 生成期内部字段。另外还要保证整轮评测能离线跑（不碰网络），
 * 以及本轮的作答确实能过（否则评测装置和作答一起坏掉也没人发现）。
 *
 * **本文件一律用 `makeSourceSdk()`（源码入口），不碰 dist。**
 * dist 是 `.githooks/pre-commit` 每次提交前重建的产物，断言钉在它上面就会
 * 随「刚才谁提交过」时绿时红。默认入口（dist 优先）另有专门的测试钉住，
 * 那测的是**命令行口径**，不是断言对象。
 */

import { describe, expect, it } from 'vitest'
import {
  ENTRY_CANDIDATES,
  INTERNAL_KEYS,
  SOURCE_ENTRY_CANDIDATES,
  consumeViewWith,
  describeCapability,
  describePageRef,
  listRegisteredCapabilityIds,
  loadEntry,
  makeSourceSdk,
  redact,
} from '../tools/eval/consumer-view.mjs'
import { TASKS } from '../tools/eval/tasks.mjs'
import { ANSWERS } from '../tools/eval/answers.mjs'
import { scoreRun } from '../tools/eval/scoring.mjs'
import type { Decision } from '../tools/eval/scoring.mjs'

/** 递归收集对象里出现过的所有键名。 */
function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found)
    return found
  }
  if (value === null || typeof value !== 'object') return found
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    found.add(k)
    collectKeys(v, found)
  }
  return found
}

describe('eval · consumer-view 不泄露内部字段', () => {
  it('denylist 本身有内容（防止被清空后永远绿）', () => {
    expect(INTERNAL_KEYS.length).toBeGreaterThan(0)
    expect(INTERNAL_KEYS).toContain('routeFile')
    expect(INTERNAL_KEYS).toContain('definitions')
  })

  it('redact 真的会剥键（含嵌套与数组内）', () => {
    const dirty = {
      keepMe: 1,
      routeFile: 'app/portal/x.vue',
      nested: { definitions: [1, 2], source: 'menu-catalog', stillHere: true },
      list: [{ conflict: true, id: 'a' }],
    }
    const clean = redact(dirty) as Record<string, unknown>
    expect(clean.keepMe).toBe(1)
    expect(clean.routeFile).toBeUndefined()
    expect((clean.nested as Record<string, unknown>).definitions).toBeUndefined()
    expect((clean.nested as Record<string, unknown>).source).toBeUndefined()
    expect((clean.nested as Record<string, unknown>).stillHere).toBe(true)
    expect((clean.list as Array<Record<string, unknown>>)[0]!.conflict).toBeUndefined()
    expect((clean.list as Array<Record<string, unknown>>)[0]!.id).toBe('a')
  })

  it('每一句话术的消费视图里都没有内部键', async () => {
    const sdk = await makeSourceSdk()
    for (const task of TASKS) {
      const view = consumeViewWith(sdk, task.utterance)
      const keys = collectKeys(view)
      for (const internal of INTERNAL_KEYS) {
        expect(keys.has(internal), `「${task.utterance}」的视图里泄露了 ${internal}`).toBe(false)
      }
    }
  }, 15000)

  it('describe / describePage 的出口同样脱敏', async () => {
    const cap = await describeCapability('meeting-room-usage', SOURCE_ENTRY_CANDIDATES)
    const page = await describePageRef('/dashboard/meeting-room/list', SOURCE_ENTRY_CANDIDATES)
    for (const internal of INTERNAL_KEYS) {
      expect(collectKeys(cap).has(internal), `describe 泄露了 ${internal}`).toBe(false)
      expect(collectKeys(page).has(internal), `describePage 泄露了 ${internal}`).toBe(false)
    }
    // 但仍然保留了「怎么调」的部分，不是把整个对象删空
    expect(cap.capabilityId).toBe('meeting-room-usage')
    expect(cap.howToCall).toBeDefined()
    expect((page.page as Record<string, unknown>).title).toBe('会议室')
  })

  it('不暴露未文档化的原始索引（catalog.index）', async () => {
    const view = consumeViewWith(await makeSourceSdk(), '帮我订个会议室')
    expect(Object.keys(view)).toEqual(['utterance', 'recommend', 'search', 'registeredCapabilityIds'])
    const serialized = JSON.stringify(view)
    for (const leak of ['pageByPath', 'duplicateCapabilityIds', 'generatedAt']) {
      expect(serialized.includes(leak), `视图里出现了原始索引字段 ${leak}`).toBe(false)
    }
  })
})

describe('eval · consumer-view 的可用性', () => {
  it('能拿到已注册能力清单，且非空', async () => {
    const sdk = await makeSourceSdk()
    const view = consumeViewWith(sdk, '帮我订个会议室')
    expect(view.registeredCapabilityIds.length).toBeGreaterThan(0)
    expect(view.registeredCapabilityIds).toContain('meeting-room-list')
  })

  it('入口加载：dist 不在时回落到 src，仍然拿得到公开 API', async () => {
    const mod = (await loadEntry(['../../dist/__不存在的入口__.js', '../../src/index.ts'])) as {
      createPortalHeadless?: unknown
    }
    expect(typeof mod.createPortalHeadless).toBe('function')
  })

  it('入口加载：全都找不到时抛出可操作的错误，而不是静默返回空', async () => {
    await expect(loadEntry(['../../dist/__没有__.js', '../../src/__也没有__.ts'])).rejects.toThrow(/pnpm build/)
  })

  it('默认候选顺序里 dist 在前、src 兜底（这是**命令行**口径，不是断言对象）', () => {
    expect(ENTRY_CANDIDATES[0]).toContain('dist/')
    expect(ENTRY_CANDIDATES[1]).toContain('src/')
  })

  // 下面两条是「测试不许再被 dist 带偏」的钉子。没有它们，
  // 「测试一律用源码入口」就只是一句注释，下一个人照样会写出 makeSdk()。
  it('测试入口只认源码：候选里不含 dist', () => {
    expect(SOURCE_ENTRY_CANDIDATES).toEqual(['../../src/index.ts'])
    for (const candidate of SOURCE_ENTRY_CANDIDATES) {
      expect(candidate).toContain('/src/')
      expect(candidate).not.toContain('dist')
    }
  })

  it('源码入口拿得到公开 API（默认入口坏掉也不影响这一条）', async () => {
    const sdk = await makeSourceSdk()
    expect(typeof sdk.catalog.recommend).toBe('function')
    expect(listRegisteredCapabilityIds(sdk).length).toBeGreaterThan(0)
  })
})

describe('eval · 本轮作答', () => {
  it('answers 覆盖了全部任务，没有漏答', () => {
    for (const task of TASKS) {
      expect(ANSWERS[task.id], `任务 ${task.id} 没有作答`).toBeDefined()
      expect(ANSWERS[task.id]!.decision).toBeDefined()
    }
  })

  it('每条作答都留了过程（trace 非空）', () => {
    for (const task of TASKS) {
      const trace = ANSWERS[task.id]!.trace
      expect(trace.length, `${task.id} 没有过程记录`).toBeGreaterThan(0)
      for (const step of trace) {
        expect(step.call.trim()).not.toBe('')
        expect(step.saw.trim()).not.toBe('')
      }
    }
  })

  it('本轮 5 个任务全部通过（装置与作答一起退化时必须红）', async () => {
    const sdk = await makeSourceSdk()
    const view = consumeViewWith(sdk, TASKS[0]!.utterance)
    const decisions: Record<string, Decision | undefined> = Object.fromEntries(
      TASKS.map((t) => [t.id, ANSWERS[t.id]!.decision]),
    )
    const run = scoreRun(TASKS, decisions, {
      registeredCapabilityIds: view.registeredCapabilityIds,
    })
    const failed = run.results.filter((r) => !r.passed)
    expect(failed, `未过：${failed.map((r) => r.taskId).join('、')}`).toEqual([])
    expect(run.passed).toBe(TASKS.length)
  })
})
