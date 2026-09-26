import { afterEach, describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import {
  __setPageCatalogForTest,
  createCatalog,
  CAPABILITY_LINKS,
  type Catalog,
} from '../src/catalog/index.js'

/**
 * G2 / G3 / G7：订会议室这条链在协议里是**通的**。
 *
 * 评测报告实测的三处断裂（全部落在同一条链上）：
 * - G2：`meetingRoomId` 是唯一一个"用户给不出、必须查"的必填参数，
 *   但 `lookup` 全目录零次；prepare/submit 的 `next` 与 `related` 都不指向候选来源
 * - G3：`next` 不标边性，`meeting-room-usage` 的首选边指到一条岔路（3 跳 vs 2 跳）
 * - G7：页面级注释跟着能力走到链路入口，把有解的链路说成无解
 */

const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

afterEach(() => {
  __setPageCatalogForTest(null)
})

describe('G2 · 长选项参数的候选来源真的登记了', () => {
  it('prepare / submit 的 meetingRoomId 指向会议室候选，且说明怎么用它', () => {
    const catalog = makeCatalog()

    for (const id of ['meeting-application-prepare', 'meeting-application-submit']) {
      const result = catalog.describe(id)
      expect(result.ok, id).toBe(true)
      if (!result.ok) continue

      const room = result.params.find((param) => param.name === 'meetingRoomId')
      expect(room?.lookup, id).toMatchObject({ capabilityId: 'meeting-room-list', keywordParam: 'name' })
      expect(room?.lookup?.hint).toContain('name')
      expect(room?.lookup?.hint).toContain('list[].id')
      // 承诺"用 lookup 指定的能力查候选"只在真有 lookup 时才出现
      expect(room?.consumption).toContain('meeting-room-list')
      expect(room?.note).toBeUndefined()
    }
  })

  it('没登记候选入口的长选项参数不会被说成"有入口"（空头承诺的回归）', () => {
    // 会议室组织过滤现已接入真实基础部门候选；使用无契约能力保持空头承诺反证。
    const described = createCatalog({ capabilities: [{ id: 'unmapped-long-option', title: '未接入候选的能力', pagePath: '/base-data/test', write: false, params: [{ name: 'organization', kind: 'tree', required: false }] }] }).describe('unmapped-long-option')
    expect(described.ok).toBe(true)
    if (!described.ok) return
    const org = described.params.find((param) => param.name === 'organization')
    expect(org?.lookup).toBeUndefined()
    expect(org?.consumption).not.toContain('lookup')
    expect(org?.note).toContain('人工确认')
    const room = makeCatalog().describe('meeting-room-list')
    if (!room.ok) throw new Error('missing meeting room')
    expect(room.params.find(param => param.name === 'authorizedOrgId')?.lookup?.capabilityId).toBe('base-dept-search')
  })

  it('候选来源出现在 prepare / submit 的 next 与 related 里', () => {
    const catalog = makeCatalog()

    for (const id of ['meeting-application-prepare', 'meeting-application-submit']) {
      const result = catalog.describe(id)
      expect(result.ok).toBe(true)
      if (!result.ok) continue

      const nextIds = result.next
        .filter((step) => step.tool === 'describe')
        .map((step) => step.args?.capabilityId)
      expect(nextIds, id).toContain('meeting-room-list')

      // 邻接表：候选来源算上游（评测报告实测这两处一条边都没有）
      expect(result.related.upstream, id).toContain('meeting-room-list')
    }

    // 上游那一侧也要指回来：从会议室列表能走到 prepare，并且说清填哪个参数
    const list = catalog.describe('meeting-room-list')
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.related.downstream).toContain('meeting-application-prepare')
    expect(list.consume.keyFields.map((field) => field.next?.args?.capabilityId)).toContain(
      'meeting-application-prepare',
    )
  })

  it('lookup 指向的能力或参数不存在时，自检会红（写错不会有运行时症状）', () => {
    const catalog = makeCatalog()
    expect(catalog.validate().lookups).toEqual([])

    // 构造一个坏 lookup：入口能力不存在 / 关键字参数不是对方有的那个
    const broken = createCatalog({
      capabilities: [
        ...CAPABILITIES,
        {
          id: 'broken',
          title: '坏 lookup',
          pagePath: '/dashboard/meeting-room/list',
          write: false,
          params: [
            { name: 'a', kind: 'search', required: true, lookup: { capabilityId: 'nope', keywordParam: 'x' } },
            {
              name: 'b',
              kind: 'search',
              required: true,
              lookup: { capabilityId: 'meeting-room-list', keywordParam: '不存在的参数' },
            },
          ],
        },
      ],
    })
    const issues = broken.validate().lookups
    expect(issues.map((issue) => issue.reason).join('\n')).toContain('nope')
    expect(issues.map((issue) => issue.reason).join('\n')).toContain('不存在的参数')
    expect(issues.map((issue) => issue.paramName).sort()).toEqual(['a', 'b'])
  })
})

describe('G3 · next 的边标了性质，首选边是"下一步"而不是岔路', () => {
  it('meeting-room-usage 的首选边直接进 prepare', () => {
    const result = makeCatalog().describe('meeting-room-usage')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const firstDescribe = result.next.find((step) => step.tool === 'describe')
    expect(firstDescribe?.args?.capabilityId).toBe('meeting-application-prepare')
    expect(firstDescribe?.role).toBe('next')

    // 流程定义那一跳是岔路，且排在所有"下一步"之后
    const definition = result.next.find((step) => step.args?.capabilityId === 'meeting-application-definition')
    expect(definition?.role).toBe('detour')
    const firstDetour = result.next.findIndex((step) => step.role === 'detour')
    const lastNext = result.next.map((step) => step.role).lastIndexOf('next')
    expect(firstDetour).toBeGreaterThan(lastNext)
  })

  it('沿 next 边走到 submit 只要 2 跳（报告实测引导路径 3 跳）', () => {
    const catalog = makeCatalog()
    /** 只沿 `role: 'next'` 的 describe 边走 —— 岔路不参与"引导路径"的长度 */
    const stepsOf = (capabilityId: string): string[] => {
      const described = catalog.describe(capabilityId)
      if (!described.ok) return []
      return described.next
        .filter((step) => step.tool === 'describe' && step.role === 'next')
        .map((step) => String(step.args?.capabilityId))
    }

    // BFS：usage → ? 的最短引导路径
    const queue: Array<{ id: string; hops: number }> = [{ id: 'meeting-room-usage', hops: 0 }]
    const seen = new Set(['meeting-room-usage'])
    let found: number | null = null
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.id === 'meeting-application-submit') {
        found = current.hops
        break
      }
      for (const next of stepsOf(current.id)) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push({ id: next, hops: current.hops + 1 })
      }
    }

    expect(found).toBe(2)
    expect(stepsOf('meeting-application-prepare')).toContain('meeting-application-submit')
  })

  it('每一个 next 边都有 role，取值只有 next / detour', () => {
    const catalog = makeCatalog()
    for (const capability of catalog.index.capabilities) {
      const result = catalog.describe(capability.id)
      if (!result.ok) continue
      expect(result.next.length).toBeGreaterThan(0)
      for (const step of result.next) {
        expect(['next', 'detour'], `${capability.id} 的 ${step.tool} 边`).toContain(step.role)
      }
      // 岔路不许挤掉下一步：截断（MAX_NEXT_STEPS）先截岔路
      const roles = result.next.map((step) => step.role)
      expect(roles.indexOf('detour'), capability.id).toBeGreaterThanOrEqual(
        roles.lastIndexOf('next'),
      )
    }
  })

  it('submit 的边性：必填参数的候选来源是下一步，可选参数与"事后动作"是岔路', () => {
    const result = makeCatalog().describe('meeting-application-submit')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const roleOf = (capabilityId: string): string | undefined =>
      result.next.find((step) => step.args?.capabilityId === capabilityId)?.role

    // meetingRoomId 是必填长选项：拿不到候选，这次提交根本发不出去
    expect(roleOf('meeting-room-list')).toBe('next')
    // startUserSelectAssignees 是**选填**的（实测会议室流程 tasks 为空）：
    // 从 submit 出发看它只是"用得上时再去"，不该排在下一步里（模型为此白花过一轮）
    expect(roleOf('meeting-user-search')).toBe('detour')
    // 取消是事后动作，不是订会链路的下一步
    expect(roleOf('meeting-application-cancel')).toBe('detour')
    // 首选边仍然是"还差哪个参数"的那一条
    expect(result.next[0]?.args?.capabilityId).toBe('meeting-room-list')
    expect(result.next[0]?.role).toBe('next')
  })

  it('prepare 的边性：候选来源与 submit 都是下一步', () => {
    const result = makeCatalog().describe('meeting-application-prepare')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const nextIds = result.next.filter((step) => step.role === 'next').map((step) => step.args?.capabilityId)
    expect(nextIds).toEqual(['meeting-room-list', 'meeting-application-submit'])
  })

  it('链路表里 usage → definition 明确标成岔路', () => {
    const link = CAPABILITY_LINKS.find(
      (candidate) => candidate.from === 'meeting-room-usage' && candidate.to === 'meeting-application-definition',
    )
    expect(link?.role).toBe('detour')
    expect(
      CAPABILITY_LINKS.find(
        (candidate) => candidate.from === 'meeting-room-usage' && candidate.to === 'meeting-application-prepare',
      )?.role,
    ).toBeUndefined() // 缺省就是 next
  })
})

describe('G7 · 注释的作用域', () => {
  it('页面级注释带页面标记，不再跟着能力走进别的链路', () => {
    const result = makeCatalog().describe('meeting-room-usage')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 每一句都标了作用域
    for (const note of result.consume.notes) {
      expect(note).toMatch(/^\[(能力|协议|页面 [^\]]+)\]/)
    }
    // 页面级的那句带着它真正描述的那一页
    const pageNotes = result.consume.notes.filter((note) => note.startsWith('[页面 '))
    expect(pageNotes.every((note) => note.includes('/dashboard/flow/form/edit'))).toBe(true)
    // 新契约只投影能力自身消费说明，不把旧页面提示重复灌进所有能力。
    expect(result.consume.notes.join(' ')).toContain('时段交集')
    expect(result.ai?.consume.join(' ')).not.toContain('只读列表')
  })

  it('不再把订会议室这条链说成无解（报告里的一句话差点让人放弃写链路）', () => {
    const catalog = makeCatalog()
    const submitExists = catalog.describe('meeting-application-submit').ok
    expect(submitExists).toBe(true)

    for (const id of ['meeting-room-usage', 'meeting-application-definition', 'meeting-application-submit']) {
      const result = catalog.describe(id)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const text = result.consume.notes.join('\n')
      expect(text, id).not.toContain('不在已登记能力里')
      expect(text, id).not.toContain('提交（创建单据）不在')
    }
  })

  it('页面级注释只挂给入口页面确实是那一页的能力', () => {
    const catalog = makeCatalog()
    const onFormEntry = catalog.describe('meeting-room-usage')
    const onRoomList = catalog.describe('meeting-room-list')
    expect(onFormEntry.ok && onRoomList.ok).toBe(true)
    if (!onFormEntry.ok || !onRoomList.ok) return

    expect(onFormEntry.howToCall.entryPoints.map(point => point.pagePath)).toEqual(['/dashboard/flow/form/edit'])
    expect(onRoomList.howToCall.entryPoints.map(point => point.pagePath)).toEqual(['/dashboard/meeting-room/list'])
    expect(onFormEntry.consume.notes.join(' ')).toContain('时段交集')
    expect(onRoomList.consume.notes.join(' ')).toContain('列表不表示可用时间')
    // 两个页面的注释不许互相串
    expect(onRoomList.consume.notes.join('\n')).not.toContain('/dashboard/flow/form/edit')
    expect(onFormEntry.consume.notes.join('\n')).not.toContain('/dashboard/meeting-room/list')
  })
})
