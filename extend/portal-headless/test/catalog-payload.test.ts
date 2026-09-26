import { describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import { createCatalog, type Catalog } from '../src/catalog/index.js'

/**
 * G9 / G11：协议族内部的"重量"和"键的有无"要一致。
 *
 * - G9：`listDomains()` 实测 17.8 KB，比它要引出的每一次 `describe()`（2.4~3.4 KB）都重，
 *   而它通常是链上的第一步——这与分层的初衷相反。
 * - G11：`warnings` 在 `describe` / `listDomains` 上有、`recommend` 上完全没有，
 *   解析方就得到处写 `?? []`。
 */

const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

const bytes = (value: unknown): number => JSON.stringify(value).length

describe('G9 · listDomains 减重', () => {
  it('detail: false 明显更轻，但计数一个不少', () => {
    const catalog = makeCatalog()
    const full = catalog.listDomains()
    const lite = catalog.listDomains({ detail: false })

    expect(bytes(lite)).toBeLessThan(bytes(full))
    // 减掉的必须真的是"每个域各来一条"的部分，不是把域或计数砍了
    expect(lite.domains.length).toBe(full.domains.length)
    expect(lite.totalDomains).toBe(full.totalDomains)
    expect(lite.totalPages).toBe(full.totalPages)
    expect(lite.totalCapabilities).toBe(full.totalCapabilities)
    for (const [index, summary] of lite.domains.entries()) {
      const original = full.domains[index]!
      expect(summary.domain).toBe(original.domain)
      expect(summary.label).toBe(original.label)
      expect(summary.pageCount).toBe(original.pageCount)
      expect(summary.capabilityCount).toBe(original.capabilityCount)
      expect(summary.capabilityIds).toEqual(original.capabilityIds)
      expect(summary.next).toEqual([])
      expect(summary.kinds).toEqual([])
    }
  })

  it('减重版仍然比它要引出的 describe 重不了多少量级（第一层不该是最重的一次）', () => {
    const catalog = makeCatalog()
    const lite = bytes(catalog.listDomains({ detail: false }))
    const describeRoom = bytes(catalog.describe('meeting-room-list'))

    // 不是"比 describe 轻"的死指标（46 个域本来就比一个能力大），
    // 而是一旦把每个域的 next/kinds 去掉，它就不再是唯一的重量级调用。
    expect(lite).toBeLessThan(describeRoom * 3)
  })

  it('不减重时每个域仍然给"下一步"（默认行为没被动过）', () => {
    const catalog = makeCatalog()
    const full = catalog.listDomains()
    expect(full.domains.every((summary) => summary.next.length > 0)).toBe(true)
  })
})

describe('G11 · warnings 键永远存在', () => {
  it('目录的每一次调用都带 warnings 数组，没有问题时是空数组', () => {
    const catalog = makeCatalog()
    const results: Array<[string, { warnings?: unknown }]> = [
      ['listDomains', catalog.listDomains()],
      ['listDomains(detail:false)', catalog.listDomains({ detail: false })],
      ['listPages', catalog.listPages('meeting-room')],
      ['listPages(不存在)', catalog.listPages('nope')],
      ['describePage', catalog.describePage('/dashboard/meeting-room/list')],
      ['describePage(不存在)', catalog.describePage('/dashboard/nope/list')],
      ['search', catalog.search('会议室')],
      ['recommend', catalog.recommend('帮我订个会议室')],
      ['recommend(零命中)', catalog.recommend('报销差旅费')],
      ['describe', catalog.describe('meeting-room-list')],
    ]

    for (const [name, result] of results) {
      expect(Array.isArray(result.warnings), name).toBe(true)
    }
  })

  it('还没登记能力的页面：warnings 直说"调不到"，不靠 pending 让模型自己解读', () => {
    const catalog = makeCatalog()
    const pending = catalog.describePage('/dashboard/salary/adjust/list')
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(pending.pending).toBe(true)
    expect(pending.warnings.join('\n')).toContain('调不到')

    // 已登记能力的页面不该背这条警告
    const done = catalog.describePage('/dashboard/meeting-room/list')
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.pending).toBe(false)
    expect(done.warnings.join('\n')).not.toContain('调不到')
  })

  it('describe 对"目录里有、执行层没有"的能力如实说调不到', () => {
    const catalog = createCatalog({
      capabilities: [
        ...CAPABILITIES,
        {
          id: 'not-wired',
          title: '没接线的能力',
          pagePath: '/dashboard/meeting-room/list',
          write: false,
          params: [],
        },
      ],
    })

    const result = catalog.describe('not-wired')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.invoke).toBeNull()
    expect(result.warnings.join('\n')).toContain('没有接进 SDK 的执行层')

    // 真接线了的那个相反
    const wired = catalog.describe('meeting-room-list')
    expect(wired.ok).toBe(true)
    if (!wired.ok) return
    expect(wired.invoke).toEqual({ capabilityId: 'meeting-room-list', sdkPath: 'meetingRoom.list' })
    expect(wired.warnings.join('\n')).not.toContain('执行层')
  })
})
