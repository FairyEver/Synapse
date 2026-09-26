import { describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import { createCatalog, type Catalog } from '../src/catalog/index.js'

/**
 * G4 / G5：`recommend` 得回答"这是读还是写"与"到底有没有"。
 *
 * - G4：实测「查一下会议室有哪些」（纯读）与「帮我订个会议室」（读+写）给出
 *   **完全相同的前三名**。`capabilities[]` 里带着 `write`，排序却没用它。
 * - G5：零命中时只有空数组，没有 `ok`、没有 `reason`；回落的 `search` 边连 `args` 都没有。
 */

const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

/** T1 的原话：纯读 */
const READ_UTTERANCE = '查一下会议室有哪些'
/** T2/T3 的原话：读 + 写 */
const WRITE_UTTERANCE = '帮我订个会议室'

describe('G4 · recommend 纳入读写意图', () => {
  it('读意图与写意图不再给出相同的前三名', () => {
    const catalog = makeCatalog()
    const read = catalog.recommend(READ_UTTERANCE)
    const write = catalog.recommend(WRITE_UTTERANCE)

    expect(read.intent.kind).toBe('read')
    expect(write.intent.kind).toBe('write')
    expect(read.intent.signals).toContain('查')

    const readTop3 = read.capabilities.slice(0, 3).map((item) => item.id)
    const writeTop3 = write.capabilities.slice(0, 3).map((item) => item.id)
    expect(readTop3).not.toEqual(writeTop3)

    // 写意图把写能力抬上来、读意图把它压下去（同一句话里 submit 的名次因此不同）
    const rank = (ids: string[]): number => ids.indexOf('meeting-application-submit')
    expect(rank(read.capabilities.map((item) => item.id))).toBeGreaterThan(
      rank(write.capabilities.map((item) => item.id)),
    )
  })

  it('按读写分组下发：两组各自按分数降序，且不会被 limit 把某一组整组挤掉', () => {
    const catalog = makeCatalog()
    const result = catalog.recommend(WRITE_UTTERANCE, { limit: 3 })

    expect(result.capabilityGroups.read.every((item) => !item.write)).toBe(true)
    expect(result.capabilityGroups.write.every((item) => item.write)).toBe(true)
    expect(result.capabilityGroups.write.map((item) => item.id)).toContain(
      'meeting-application-submit',
    )
    expect(result.capabilityGroups.read.map((item) => item.id)).toContain('meeting-room-list')

    for (const group of [result.capabilityGroups.read, result.capabilityGroups.write]) {
      const scores = group.map((item) => item.score)
      expect([...scores].sort((a, b) => b - a)).toEqual(scores)
      expect(group.length).toBeLessThanOrEqual(3)
    }

    // limit=3 时 capabilities 只剩前三名（cancel 被挤掉），但分组里还看得见它：
    // "读候选 / 写候选各有哪些"与"前 N 名"是两件事，前者不该被后者截断。
    expect(result.capabilities.map((item) => item.id)).not.toContain('meeting-application-cancel')
    expect(result.capabilityGroups.write.map((item) => item.id)).toContain(
      'meeting-application-cancel',
    )
  })

  it('写意图不会把"先选会议室"这一步挤掉：list 仍排在 submit 前面', () => {
    const result = makeCatalog().recommend(WRITE_UTTERANCE, { limit: 10 })
    const ids = result.capabilities.map((item) => item.id)
    expect(ids.indexOf('meeting-room-list')).toBeLessThan(ids.indexOf('meeting-application-submit'))
  })

  it('认不出动词时不改分（unknown），行为可预测', () => {
    const result = makeCatalog().recommend('会议室')
    expect(result.intent.kind).toBe('unknown')
    expect(result.intent.signals).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('写意图但没有写能力可用时给出警告（别拿读结果当成办好了）', () => {
    const result = makeCatalog().recommend('报销差旅费')
    expect(result.intent.kind).toBe('write')
    expect(result.capabilities).toEqual([])
    expect(result.warnings.join('\n')).toContain('写意图')
  })
})

describe('G5 · 显式否定与可用的回落', () => {
  it('零命中：ok=false + reason 说清"目录里没有"，不是让调用方从空数组推断', () => {
    const result = makeCatalog().recommend('报销差旅费')

    expect(result.ok).toBe(false)
    expect(result.reason).not.toBeNull()
    expect(String(result.reason)).toContain('目录里没有匹配这句话的能力')
    // 收敛信息：模型实测读到 ok:false 后仍然连搜 5 次才敢确认"没有"——
    // 回执里必须给出"全部可调能力就这些"，否定才能一次判定，不必自己再证一遍。
    expect(String(result.reason)).toContain('全部已登记能力只有')
    for (const capability of CAPABILITIES) {
      expect(String(result.reason), capability.id).toContain(capability.id)
    }
    expect(String(result.reason)).toContain('不在这份清单里的功能就是调不到')

    // 回落边必须带 args（原实现连这个键都没有）
    const searchStep = result.next.find((step) => step.tool === 'search')
    expect(searchStep?.args).toEqual({ keyword: '报销差旅费' })
  })

  it('「认出了页面但页面没有能力」与「一个字都没对上」是两种否定，措辞不同', () => {
    const catalog = makeCatalog()

    // T4：黑话命中「工资找齐」这个页面，但那一页没有登记能力
    const pageMatched = catalog.recommend('帮我调薪')
    expect(pageMatched.ok).toBe(false)
    expect(pageMatched.pages.length).toBeGreaterThan(0)
    expect(String(pageMatched.reason)).toContain('还没有登记能力')
    expect(String(pageMatched.reason)).toContain('全部已登记能力只有')

    // T5：什么都没有
    const nothing = catalog.recommend('报销差旅费')
    expect(nothing.pages).toEqual([])
    expect(String(nothing.reason)).not.toContain('还没有登记能力')
    expect(String(nothing.reason)).toContain('全部已登记能力只有')
  })

  it('有可调用能力时 ok=true 且没有 reason（键永远在，值可为 null）', () => {
    const result = makeCatalog().recommend(WRITE_UTTERANCE)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('search 的零命中回落同样带上原词', () => {
    const result = makeCatalog().search('报销差旅费')
    expect(result.hits).toEqual([])
    expect(result.next.find((step) => step.tool === 'recommend')?.args).toEqual({
      text: '报销差旅费',
    })
  })
})
