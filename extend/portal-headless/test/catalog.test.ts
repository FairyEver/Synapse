import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import {
  __setPageCatalogForTest,
  createCatalog,
  defaultCatalog,
  normalizeTerm,
  tokenize,
  type Catalog,
  type GeneratedPageCatalog,
  type GeneratedPageRow,
} from '../src/catalog/index.js'

const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

/** 每个用例独立建目录：索引构建很便宜，避免用例之间通过缓存互相污染 */
function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

/**
 * 独立重数：直接读 `generated/page-catalog.json`，不经过 src/catalog 的加载器。
 * 断言页面数时用它，是为了不拿"被测试的代码"去证明"被测试的代码"。
 */
function readRawCatalog (): GeneratedPageCatalog {
  const here = dirname(fileURLToPath(import.meta.url))
  const raw = readFileSync(join(here, '../generated/page-catalog.json'), 'utf8')
  return JSON.parse(raw) as GeneratedPageCatalog
}

function countBy (rows: GeneratedPageRow[], pick: (row: GeneratedPageRow) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = pick(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

afterEach(() => {
  __setPageCatalogForTest(null)
})

/* ================================================================ 真实数据：第一层 */

describe('listDomains —— 业务域（第一层下钻）', () => {
  it('页面总数与 generated/page-catalog.json 的真实行数一致，清单里的域一个都不少', () => {
    const raw = readRawCatalog()
    const domains = makeCatalog().listDomains()

    // 2026-09-23：Portal 8b9a5554d4，固定分支更新后清单为 993 行。
    // 域数仍为 45；platform 的真实菜单页也从旧锚点 235 校正为 237。
    expect(raw.items.length).toBe(993)
    expect(domains.totalPages).toBe(raw.items.length)

    // 域清单是清单里的域 + 只有能力认识的那些域（/simple/** 流程表单，见 H36）。
    // 断言的是"清单里的域被完整保留"，而不是"数量相等"——后者会把新增的域当成回归。
    const catalogDomains = new Set(raw.items.map((row) => row.domain))
    const listedDomains = new Set(domains.domains.map((summary) => summary.domain))
    for (const domain of catalogDomains) {
      expect(listedDomains.has(domain), `清单里的域 ${domain} 不能丢`).toBe(true)
    }
    expect(listedDomains.size).toBeGreaterThanOrEqual(catalogDomains.size)
    // 46 = 清单里的 45 个域 + 只因能力而存在的 simple（ /simple/<模块>/form/<NNN> ）
    expect(domains.totalDomains).toBe(46)
    expect(domains.totalCapabilityOnlyPages).toBe(2)
  })

  it('每个域的页面数、含写操作页面数都与清单逐域重数的结果一致', () => {
    const raw = readRawCatalog()
    const domains = makeCatalog().listDomains()

    const expectedPages = countBy(raw.items, (row) => row.domain)
    const expectedWrites = countBy(
      raw.items.filter((row) => row.write === true),
      (row) => row.domain,
    )

    // 逐域对照，而不是只对总数——只对总数会漏掉"两个域互相串了"这种错
    for (const summary of domains.domains) {
      expect(summary.pageCount, `${summary.domain} 页面数`).toBe(expectedPages.get(summary.domain) ?? 0)
      expect(summary.writePageCount, `${summary.domain} 含写操作页面数`).toBe(
        expectedWrites.get(summary.domain) ?? 0,
      )
    }
  })

  it('源码清单锚点：finance 163 / platform 237 / product 232 / meeting-room 1（Portal 16c4177c6c）', () => {
    const domains = makeCatalog().listDomains()
    const byName = new Map(domains.domains.map((summary) => [summary.domain, summary]))

    expect(byName.get('finance')?.pageCount).toBe(163)
    expect(byName.get('platform')?.pageCount).toBe(237)
    expect(byName.get('product')?.pageCount).toBe(232)
    expect(byName.get('meeting-room')?.pageCount).toBe(1)
    expect(byName.get('meeting-room')?.label).toBe('会议室')
    // Portal 固定分支更新后，两个自定义结算页不再被识别为列表写页面，写页面锚点为358。
    expect(
      domains.domains.reduce((sum, summary) => sum + summary.writePageCount, 0),
    ).toBe(358)
  })

  it('按页面数降序，且每个域都给出"下一步去哪"', () => {
    const domains = makeCatalog().listDomains()
    for (let i = 1; i < domains.domains.length; i += 1) {
      const previous = domains.domains[i - 1]
      const current = domains.domains[i]
      expect(previous?.pageCount ?? 0).toBeGreaterThanOrEqual(current?.pageCount ?? 0)
    }
    for (const summary of domains.domains) {
      expect(summary.next.length).toBeGreaterThan(0)
      expect(summary.next.some((step) => step.tool === 'listPages')).toBe(true)
    }
  })

  it('真实数据里没有能力 ID 冲突：一个 ID 一份定义，warnings 为空', () => {
    const catalog = makeCatalog()
    const domains = catalog.listDomains()

    expect(catalog.index.duplicateCapabilityIds).toEqual([])
    expect(domains.warnings).toEqual([])
    // 会议室主数据页的读写动作全部进入同一页能力清单，ID 仍必须唯一。
    const ids = catalog.index.capabilities.map((capability) => capability.id)
    expect(ids.length).toBe(new Set(ids).size)
    expect(ids.sort()).toEqual([
      'meeting-application-cancel',
      'meeting-application-definition',
      'meeting-application-prepare',
      'meeting-application-submit',
      'meeting-room-usage',
      'meeting-user-search',
      ...meetingRoomCapabilities.map((capability) => capability.id),
    ].sort())
  })

  it('能力和域对得上：meeting-room 1 个，flow 3 个，simple 只有能力没有菜单页', () => {
    const catalog = makeCatalog()
    const domains = catalog.listDomains()
    const byName = new Map(domains.domains.map((summary) => [summary.domain, summary]))

    expect(byName.get('meeting-room')?.capabilityIds.sort()).toEqual(meetingRoomCapabilities.map((capability) => capability.id).sort())
    expect(byName.get('meeting-room')?.capabilityCount).toBe(meetingRoomCapabilities.length)

    expect(byName.get('flow')?.capabilityOnlyPageCount).toBe(1)
    expect(byName.get('flow')?.capabilityIds.sort()).toEqual([
      'meeting-application-definition',
      'meeting-room-usage',
      'meeting-user-search',
    ])

    // /simple/hr/form/033 不在菜单树里（H36），所以这个域一个菜单页都没有
    const simple = byName.get('simple')
    expect(simple?.pageCount).toBe(0)
    expect(simple?.capabilityOnlyPageCount).toBe(1)
    expect(simple?.label).toBe('流程表单')
    expect(simple?.capabilityIds.sort()).toEqual([
      'meeting-application-cancel',
      'meeting-application-prepare',
      'meeting-application-submit',
    ])

    expect(byName.get('finance')?.capabilityIds).toEqual([])
  })
})

/* ================================================================ 第二层：页面 */

describe('listPages —— 某个域下的页面（第二层下钻）', () => {
  it('meeting-room 域只有 1 个页面，且页面挂载全部读写动作', () => {
    const result = makeCatalog().listPages('meeting-room')

    expect(result.ok).toBe(true)
    expect(result.label).toBe('会议室')
    expect(result.pageCount).toBe(1)
    expect(result.capabilityOnlyPageCount).toBe(0)
    expect(result.capabilityCount).toBe(meetingRoomCapabilities.length)
    expect(result.pages.map((page) => page.menuPath)).toEqual(['/dashboard/meeting-room/list'])
    expect(result.pages[0]?.capabilityIds).toEqual(meetingRoomCapabilities.map((capability) => capability.id))
    expect(result.pages[0]?.write).toBe(true)
  })

  it('flow 域的 9 个菜单页 + 1 个"流程表单页"（不在菜单树里，H36）', () => {
    const result = makeCatalog().listPages('flow')

    expect(result.ok).toBe(true)
    expect(result.pageCount).toBe(9)
    expect(result.capabilityOnlyPageCount).toBe(1)
    const capabilityOnly = result.pages.find((page) => page.source === 'capability-only')
    expect(capabilityOnly?.menuPath).toBe('/dashboard/flow/form/edit')
    expect(capabilityOnly?.kind).toBe('能力页（不在菜单树）')
  })

  it('simple 域只有 /simple/hr/form/033 这一个非菜单页，写能力都挂在它上面（H36 / D9）', () => {
    const catalog = makeCatalog()
    const result = catalog.listPages('simple')

    expect(result.ok).toBe(true)
    expect(result.label).toBe('流程表单')
    expect(result.pageCount).toBe(0)
    expect(result.capabilityOnlyPageCount).toBe(1)
    expect(result.capabilityCount).toBe(3)
    expect(result.pages.map((page) => page.menuPath)).toEqual(['/simple/hr/form/033'])

    // 同一个页面按路径也能被 describePage 找到，且认得它是能力页
    const described = catalog.describePage('/simple/hr/form/033')
    expect(described.ok).toBe(true)
    if (!described.ok) return
    expect(described.page.source).toBe('capability-only')
    expect(described.page.domain).toBe('simple')
    expect(described.pending).toBe(false)
    expect(described.capabilities.map((entry) => entry.capabilityId).sort()).toEqual([
      'meeting-application-cancel',
      'meeting-application-prepare',
      'meeting-application-submit',
    ])
  })

  it('域名可以用中文标签或大小写不同的写法（宽容，H22）', () => {
    const catalog = makeCatalog()
    expect(catalog.listPages('会议室').domain).toBe('meeting-room')
    expect(catalog.listPages('Platform').domain).toBe('platform')
  })

  it('不存在的域返回 ok=false，并指回域清单而不是空手而归', () => {
    const result = makeCatalog().listPages('not-a-domain')
    expect(result.ok).toBe(false)
    expect(result.pages).toEqual([])
    expect(result.next[0]?.tool).toBe('listDomains')
  })
})

/* ================================================================ 第三层：页面能力 */

describe('describePage —— 页面的能力清单（第三层下钻）', () => {
  it('会议室列表页：读写能力全部可描述，不是待推进状态', () => {
    const result = makeCatalog().describePage('/dashboard/meeting-room/list')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.title).toBe('会议室')
    expect(result.page.source).toBe('menu-catalog')
    expect(result.pending).toBe(false)
    expect(result.capabilities.map((entry) => entry.capabilityId)).toEqual(meetingRoomCapabilities.map((capability) => capability.id))
    // -llm 入口就是能力 ID 加后缀（A6 / D14）
    expect(result.capabilities[0]?.llmToolId).toBe('meeting-room-list-llm')
    expect(result.next.map((step) => step.tool)).toContain('describe')
  })

  it('pageId 接受清单里的短哈希 id，也接受带 query 和详情路径的写法', () => {
    const catalog = makeCatalog()
    const listed = catalog.listPages('meeting-room')
    const page = listed.pages[0]
    expect(page).toBeDefined()
    if (page === undefined) return

    const byId = catalog.describePage(page.id)
    expect(byId.ok).toBe(true)
    if (byId.ok) expect(byId.page.menuPath).toBe('/dashboard/meeting-room/list')

    const withQuery = catalog.describePage('/dashboard/meeting-room/list?foo=1')
    expect(withQuery.ok).toBe(true)

    // 详情页归回所属列表页（复刻前端 syncMenuContext）
    const detail = catalog.describePage('/dashboard/meeting-room/detail/12')
    expect(detail.ok).toBe(true)
    if (detail.ok) expect(detail.page.menuPath).toBe('/dashboard/meeting-room/list')
  })

  it('能力定义的 pagePath 不在菜单树里时也能描述（流程表单页，H36 / D9）', () => {
    const result = makeCatalog().describePage('/dashboard/flow/form/edit')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.source).toBe('capability-only')
    expect(result.page.domain).toBe('flow')
    expect(result.capabilities.map((entry) => entry.capabilityId).sort()).toEqual([
      'meeting-application-definition',
      'meeting-room-usage',
      'meeting-user-search',
    ])
  })

  it('找不到时给出相近页面建议，而不是让 AI 猜路径', () => {
    const result = makeCatalog().describePage('/dashboard/meeting-room/lst')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('/dashboard/meeting-room/lst')
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.some((item) => item.menuPath === '/dashboard/meeting-room/list')).toBe(true)
  })
})

/* ================================================================ 检索 */

describe('search —— 宽容检索 + 命中原因', () => {
  it('按页面标题命中，并说明命中的是哪个字段、哪个词', () => {
    const result = makeCatalog().search('会议室')
    const page = result.hits.find((hit) => hit.title === '会议室')

    expect(page, '标题「会议室」的页面应被命中').toBeDefined()
    if (page === undefined) return
    expect(page.pageId).toBeDefined()
    const match = page.matches[0]
    expect(match?.field).toBe('pageTitle')
    expect(match?.value).toBe('会议室')
    expect(match?.via).toBe('literal')
  })

  it('按菜单路径命中（连字符与大小写被归一化掉）', () => {
    const result = makeCatalog().search('MEETING-ROOM')
    const byPath = result.hits.find((hit) =>
      hit.matches.some((match) => match.field === 'menuPath' && match.value === '/dashboard/meeting-room/list'),
    )
    expect(byPath).toBeDefined()
  })

  it('按能力标题与参数名命中', () => {
    const catalog = makeCatalog()
    const byCapability = catalog.search('查询各会议室的预定占用情况')
    expect(
      byCapability.hits.some((hit) => hit.type === 'capability' && hit.id === 'meeting-room-usage'),
    ).toBe(true)

    const byParam = catalog.search('authorizedOrgId')
    const paramHit = byParam.hits.find((hit) =>
      hit.matches.some((match) => match.field === 'paramName'),
    )
    expect(paramHit?.capabilityId).toBe('meeting-room-list')
  })

  it('H22 黑话：搜「调薪」能命中菜单里的「工资找齐」，并标出是别名扩展来的', () => {
    const result = makeCatalog().search('调薪')

    const hit = result.hits[0]
    expect(hit?.title).toBe('工资找齐')
    const aliasMatch = hit?.matches.find((match) => match.via === 'alias')
    expect(aliasMatch, '命中原因必须是"别名扩展"，否则上游不知道它为什么对').toBeDefined()
    expect(aliasMatch?.from).toBe('调薪')
    expect(aliasMatch?.term).toBe('工资找齐')
  })

  it('中文长句也能命中（2~3 字片段），不要求用户先学会菜单里的词', () => {
    const result = makeCatalog().search('帮我看看会议室的占用')
    expect(result.hits.some((hit) => hit.id === 'meeting-room-list')).toBe(true)
  })

  it('同义词扩展：搜「员工」会带上「人员」相关的词与页面', () => {
    const result = makeCatalog().search('员工', { limit: 100 })

    expect(result.terms.filter((term) => term.via === 'synonym').map((term) => term.term)).toEqual(
      expect.arrayContaining(['人员', '同事']),
    )
    // 域命中（label 就叫「员工」）与页面命中都要有
    expect(result.hits.some((hit) => hit.type === 'domain' && hit.id === 'staff')).toBe(true)
    expect(
      result.hits.some(
        (hit) => hit.type === 'page' && hit.title === '内部员工' && hit.hasCapabilities === false,
      ),
    ).toBe(true)
  })

  it('一个字面都没命中时：total 为 0，并明确指向 recommend 与域清单', () => {
    const result = makeCatalog().search('zzz-不存在的东西-zzz')
    expect(result.total).toBe(0)
    expect(result.hits).toEqual([])
    expect(result.next[0]?.tool).toBe('recommend')
    expect(result.next.some((step) => step.tool === 'listDomains')).toBe(true)
  })

  it('limit 生效并标记截断', () => {
    const result = makeCatalog().search('会议', { limit: 1 })
    expect(result.hits.length).toBe(1)
    expect(result.total).toBeGreaterThan(1)
    expect(result.truncated).toBe(true)
  })

  it('归一化自身：全角、空格、大小写、连字符都等价', () => {
    expect(normalizeTerm(' Meeting Room ')).toBe('meetingroom')
    expect(normalizeTerm('ＭＥＥＴＩＮＧ')).toBe('meeting')
    expect(normalizeTerm('meeting_room')).toBe('meetingroom')
    // 切词按路径分隔符切开，但每一段自身也做了归一化
    expect(tokenize('meeting-room/list')).toEqual(['meetingroom', 'list'])
  })
})

/* ================================================================ 路由推荐（D11） */

describe('recommend —— 话术 → 能力/页面，且可解释', () => {
  it('「帮我订个会议室」推到会议室这条链路，并说清为什么', () => {
    const result = makeCatalog().recommend('帮我订个会议室')

    const ids = result.capabilities.map((item) => item.id)
    expect(ids).toContain('meeting-room-list')
    expect(ids).toContain('meeting-room-usage')
    expect(ids.indexOf('meeting-room-list')).toBeLessThan(ids.indexOf('meeting-application-definition'))
    expect(result.domains.map((item) => item.id)).toContain('meeting-room')

    const alias = result.interpretations.find((basis) => basis.source === 'alias')
    expect(alias?.id).toBe('meeting-room')
    expect(alias?.note).toContain('会议室')

    const top = result.capabilities[0]
    expect(top?.reasons.length).toBeGreaterThan(0)
    expect(top?.reasons[0]).toContain('话术别名')
    expect(top?.llmToolId).toBe(`${top?.id}-llm`)
    expect(result.next[0]?.tool).toBe('describe')
    expect(result.next[0]?.args?.capabilityId).toBe(top?.id)
  })

  it('「帮我订个会议室」的链路一直通到写能力 submit，且排在查询之后（D14 闭环）', () => {
    const result = makeCatalog().recommend('帮我订个会议室', { limit: 10 })
    const ids = result.capabilities.map((item) => item.id)

    expect(ids).toContain('meeting-application-submit')
    expect(ids).toContain('meeting-application-cancel')
    // 顺序有意义：先把候选会议室摆出来，提交排在后面，不能反过来
    expect(ids.indexOf('meeting-application-submit')).toBeGreaterThan(ids.indexOf('meeting-room-list'))
    expect(ids.indexOf('meeting-application-cancel')).toBeGreaterThan(
      ids.indexOf('meeting-application-submit'),
    )
  })

  it('识别同义词：原词进 interpretations，落点由检索兜底', () => {
    const result = makeCatalog().recommend('帮我查一下员工名单')
    expect(result.interpretations.some((basis) => basis.source === 'synonym')).toBe(true)
    expect(result.pages.some((page) => page.menuPath === '/dashboard/staff/staff-list/list')).toBe(true)
  })

  it('认出黑话并翻译：「我要看双赢协议」', () => {
    const result = makeCatalog().recommend('我要看双赢协议')
    const ids = result.pages.map((page) => page.menuPath)
    expect(ids).toContain('/dashboard/flow/old/model/list')
    const basis = result.interpretations.find((item) => item.id === 'jargon-dualwin')
    expect(basis?.matched).toBe('双赢协议')
    expect(basis?.note).toContain('流程模型')
  })

  it('完全认不出时：不编造落点，明确告知要去 search 或域清单', () => {
    const result = makeCatalog().recommend('qwertyuiop asdfghjkl')
    expect(result.capabilities).toEqual([])
    expect(result.pages).toEqual([])
    expect(result.domains).toEqual([])
    expect(result.next.map((step) => step.tool)).toEqual(['search', 'listDomains'])
  })

  it('limit 控制每一类落点的数量', () => {
    const result = makeCatalog().recommend('会议室', { limit: 1 })
    expect(result.capabilities.length).toBeLessThanOrEqual(1)
    expect(result.pages.length).toBeLessThanOrEqual(1)
    expect(result.domains.length).toBeLessThanOrEqual(1)
  })
})

/* ================================================================ `-llm` 协议（D14） */

describe('describe —— `-llm`：怎么调 / 参数契约 / 返回 / 下一步去哪', () => {
  it('会议室列表：真实字段契约及执行支持的筛选参数', () => {
    const result = makeCatalog().describe('meeting-room-list')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.llmToolId).toBe('meeting-room-list-llm')
    expect(result.write).toBe(false)

    // ① 怎么调
    expect(result.howToCall.entryPoints[0]?.pagePath).toBe('/dashboard/meeting-room/list')
    expect(result.howToCall.idempotency).toBeNull()

    // ② 参数契约，含参数类型
    expect(result.params.map((param) => param.name)).toEqual([
      'name',
      'authorizedOrgId',
      'pageNo',
      'pageSize',
      'order',
      'orderField',
    ])
    const tree = result.params.find((param) => param.name === 'authorizedOrgId')
    expect(tree?.kind).toBe('tree')
    expect(tree?.lookup?.capabilityId).toBe('base-dept-search')
    expect(tree?.contract?.lookup?.valueField).toBe('list[].id')

    // ③ 返回数据长什么样
    expect(result.returns.confidence).toBe('documented')
    expect(result.returns.fields?.find(field => field.path === 'list[].status')?.values).toEqual({ '0': '禁用', '1': '启用' })
    expect(result.returns.shape).toContain('list')

    // ④ 下一步去哪
    expect(result.next.length).toBeGreaterThan(0)
    expect(result.next.every((step) => step.why.length > 0)).toBe(true)
    expect(result.next.some((step) => step.tool === 'describePage')).toBe(true)
  })

  it('D34：算不出 module-type 的页面如实标注 sent=false，不是沉默', () => {
    const result = makeCatalog().describe('meeting-room-list')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entryPoint = result.howToCall.entryPoints[0]
    expect(entryPoint?.moduleType.sent).toBe(false)
    expect(entryPoint?.moduleType.value).toBeNull()
    expect(result.warnings.join('\n')).toContain('module-type')
  })

  it('D14 的下钻：会议室占用查询的下一步里直接有下游域的能力', () => {
    const result = makeCatalog().describe('meeting-room-usage')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const downstream = result.next.filter((step) => step.tool === 'describe')
    expect(downstream.map((step) => step.args?.capabilityId)).toContain(
      'meeting-application-definition',
    )
    expect(result.consume.keyFields.map((field) => field.field)).toContain('meetingRooms[].meetingRoomId')
    expect(result.consume.keyFields.find(field => field.field === 'meetingRooms[].meetingRoomId')?.next?.args?.capabilityId).toBe('meeting-application-prepare')
  })

  it('写能力 submit：幂等要求、表单域入口、必填字段，并指回 prepare', () => {
    const result = makeCatalog().describe('meeting-application-submit')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.write).toBe(true)
    expect(result.llmToolId).toBe('meeting-application-submit-llm')
    expect(result.howToCall.idempotency).toContain('requestId')
    expect(result.howToCall.entryPoints.map((point) => point.pagePath)).toEqual([
      '/simple/hr/form/033',
    ])
    // 必填字段来自表单（D26 四件套），可选的不该被算成必填
    expect(result.params.filter((param) => param.required).map((param) => param.name)).toEqual([
      'meetingName',
      'meetingRoomId',
      'startTime',
      'endTime',
      'attendeeCount',
      'requestId',
    ])
    expect(result.params.find((param) => param.name === 'attendees')?.required).toBe(false)
    expect(result.next.filter((step) => step.tool === 'describe').map((step) => step.args?.capabilityId))
      .toEqual(expect.arrayContaining(['meeting-application-prepare', 'meeting-application-cancel']))
  })

  it('写能力 cancel：id 参数在，且它就是 submit 的返回值（D14 的下游字段）', () => {
    const catalog = makeCatalog()

    const cancel = catalog.describe('meeting-application-cancel')
    expect(cancel.ok).toBe(true)
    if (!cancel.ok) return
    expect(cancel.write).toBe(true)
    expect(cancel.params.map((param) => `${param.name}:${param.kind}:${param.required}`)).toEqual([
      'id:number:true',
    ])

    const submit = catalog.describe('meeting-application-submit')
    expect(submit.ok).toBe(true)
    if (!submit.ok) return
    const keyField = submit.consume.keyFields.find((field) => field.field === '$')
    expect(keyField?.next?.args?.capabilityId).toBe('meeting-application-cancel')
  })

  it('prepare 是"提交前准备"：读能力，且下一步就是 submit', () => {
    const result = makeCatalog().describe('meeting-application-prepare')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.write).toBe(false)
    expect(result.howToCall.idempotency).toBeNull()
    expect(result.consume.keyFields.map((field) => field.field)).toContain('tasks')
    expect(result.consume.keyFields.find(field => field.field === 'tasks[].id')?.next?.args?.capabilityId).toBe('meeting-application-submit')
    expect(result.next.filter((step) => step.tool === 'describe').map((step) => step.args?.capabilityId))
      .toContain('meeting-application-submit')
  })

  it('写能力带幂等要求（D12），读能力没有', () => {
    const catalog = makeCatalog()
    const read = catalog.describe('meeting-room-list')
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.howToCall.idempotency).toBeNull()

    const write = catalog.describe('meeting-application-submit')
    expect(write.ok).toBe(true)
    if (write.ok) {
      expect(write.howToCall.idempotency).toContain('窗口内')
      expect(write.howToCall.idempotency).toContain('同一意图复用')
    }
  })

  it('接受 A6 的 `xxx-llm` 写法（AI 会直接把工具名当参数传进来）', () => {
    const catalog = makeCatalog()
    const plain = catalog.describe('meeting-room-list')
    const suffixed = catalog.describe('meeting-room-list-llm')

    expect(plain.ok).toBe(true)
    expect(suffixed.ok).toBe(true)
    if (plain.ok && suffixed.ok) expect(suffixed.capabilityId).toBe(plain.capabilityId)
  })

  it('找不到能力时列出实际注册的能力，不让 AI 猜 ID', () => {
    const result = makeCatalog().describe('meeting-rom-list')
    expect(result.ok).toBe(false)
    if (result.ok) return
    // 「不让猜 ID」靠的是 reason 里的全量清单（tools/eval 也按这个格式解析），
    // 不是 suggestions：`suggestions` 现在只放**真的相关**的（G6），
    // 拼错一位的 ID 与任何能力都没有词面重叠，所以它是空的——空不等于"目录里没别的"。
    expect(result.reason).toContain('meeting-rom-list')
    expect(result.reason).toContain('meeting-room-list')
    expect(result.suggestions).toEqual([])
  })

  it('suggestions 按相关度排序，不是注册顺序（G6）', () => {
    const catalog = makeCatalog()
    // 前缀命中：只该推出 meeting-application-* 那一组，而不是"前 5 个注册的"
    const result = catalog.describe('meeting-application')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.every((item) => item.capabilityId.startsWith('meeting-application-'))).toBe(true)
    // 分数单调不增，且都是打分器给出的正分
    const scores = result.suggestions.map((item) => item.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(scores.every((score) => score > 0)).toBe(true)

    // 词面完全不沾边时，宁可为空也不给"看起来像推荐"的注册顺序前 5
    const nothing = catalog.describe('zzzz-nonexistent')
    expect(nothing.ok).toBe(false)
    if (nothing.ok) return
    expect(nothing.suggestions).toEqual([])
  })
})

/* ================================================================ 自检：人工维护的表 */

describe('人工维护的数据表不能有死链', () => {
  it('别名表的每个 target 都能在真实目录里解析到', () => {
    const catalog = makeCatalog()
    const aliases = catalog.validate().aliases
    expect(aliases.map((issue) => `${issue.entryId}: ${issue.reason}`)).toEqual([])
  })

  it('能力链路表的两端都是真实能力', () => {
    const catalog = makeCatalog()
    expect(catalog.validate().links).toEqual([])
  })
})

/* ================================================================ 边界：构造数据 */

describe('buildIndex 的边界（构造数据，不依赖清单格式）', () => {
  const fabricated: GeneratedPageCatalog = {
    generatedAt: 'test',
    portalRepo: 'test',
    total: 2,
    items: [
      {
        id: 'p1',
        menuPath: '/dashboard/fake/list',
        title: '假页面',
        domain: 'fake',
        permission: '/dashboard/fake',
        routeFile: 'views/fake/list.vue',
        kind: '列表页(声明式 getDataListURL)',
        write: true,
        moduleType: null,
        moduleTypeLabel: '',
      },
      {
        id: 'p2',
        menuPath: null,
        title: '(未命名 iframe)',
        domain: '(iframe)',
        permission: '',
        routeFile: null,
        kind: 'iframe 嵌入外部系统',
        write: null,
        moduleType: null,
        moduleTypeLabel: '',
      },
    ],
  }

  beforeEach(() => {
    __setPageCatalogForTest(fabricated)
  })

  it('空能力定义也能建目录（阶段① 刚开始时的状态）', () => {
    const catalog = createCatalog({ capabilities: [] })
    const domains = catalog.listDomains()

    expect(domains.totalPages).toBe(2)
    expect(domains.totalCapabilities).toBe(0)
    expect(domains.domains.map((summary) => summary.domain).sort()).toEqual(['(iframe)', 'fake'])
    expect(catalog.describe('anything').ok).toBe(false)
  })

  /**
   * 冲突合并逻辑只能用**构造数据**测：真实目录里一个 ID 一份定义（这是对的），
   * 靠真实数据里"恰好存在一个冲突"来覆盖这段逻辑，冲突一被修掉测试就没人看了。
   */
  it('构造：同一 ID 两处定义时，参数按更严的一侧合并，并把冲突报出来', () => {
    const catalog = createCatalog({
      capabilities: [
        {
          id: 'duplicated',
          title: '两处定义的抽象能力',
          pagePath: '/dashboard/fake/list',
          write: false,
          params: [
            { name: 'date', kind: 'date', required: false, description: '列表页那份是可选的' },
            { name: 'onlyHere', kind: 'text', required: false, description: '只有这一份有' },
          ],
        },
        {
          id: 'duplicated',
          title: '两处定义的抽象能力',
          pagePath: '/simple/fake/form/001',
          write: true,
          params: [
            { name: 'date', kind: 'date', required: true, description: '表单页那份是必填的' },
            { name: 'onlyThere', kind: 'tree', required: true, lookup: { capabilityId: 'duplicated', keywordParam: 'onlyThere' } },
          ],
        },
      ],
    })

    expect(catalog.index.duplicateCapabilityIds).toEqual(['duplicated'])
    expect(catalog.listDomains().warnings.join('\n')).toContain('duplicated')

    const result = catalog.describe('duplicated')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 两个入口都列出来
    expect(result.howToCall.entryPoints.map((point) => point.pagePath).sort()).toEqual([
      '/dashboard/fake/list',
      '/simple/fake/form/001',
    ])
    // 参数按名字合并（顺序按首次出现），required 取更严的一侧，lookup/description 不丢
    expect(result.params.map((param) => param.name)).toEqual([
      'date',
      'onlyHere',
      'onlyThere',
    ])
    expect(result.params.find((param) => param.name === 'date')?.required).toBe(true)
    expect(result.params.find((param) => param.name === 'date')?.note).toContain('必填')
    expect(result.params.find((param) => param.name === 'onlyThere')?.lookup?.capabilityId).toBe('duplicated')
    // 只要有一处是写，整条能力就算写（宁可多要一次确认，也不要漏掉一次写入）
    expect(result.write).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('duplicated'))).toBe(true)

    // 冲突不该影响调用：页面上两个入口都能看到这条能力
    expect(catalog.describePage('/dashboard/fake/list').ok).toBe(true)
    expect(catalog.listPages('simple').pages[0]?.capabilityIds).toEqual(['duplicated'])
  })

  it('menuPath 为 null 的 iframe 行仍留在目录里，但按路径描述不到它', () => {
    const catalog = createCatalog({ capabilities: [] })
    const iframeDomain = catalog.listPages('(iframe)')

    expect(iframeDomain.pageCount).toBe(1)
    expect(iframeDomain.pages[0]?.menuPath).toBeNull()
    expect(catalog.describePage('p2').ok).toBe(true)
  })

  it('能力引用了清单外的路径时，补一个 capability-only 页面而不是丢掉', () => {
    const catalog = createCatalog({
      capabilities: [
        {
          id: 'outside-cap',
          title: '清单外的能力',
          pagePath: '/simple/fake/form/001',
          write: false,
          params: [{ name: 'keyword', kind: 'search', required: true }],
        },
      ],
    })

    const domains = catalog.listDomains()
    expect(domains.totalCapabilityOnlyPages).toBe(1)
    const bucket = domains.domains.find((summary) => summary.domain === 'simple')
    expect(bucket?.capabilityOnlyPageCount).toBe(1)
    expect(bucket?.pageCount).toBe(0)

    const page = catalog.describePage('/simple/fake/form/001')
    expect(page.ok).toBe(true)
    if (page.ok) {
      expect(page.page.source).toBe('capability-only')
      expect(page.capabilities[0]?.capabilityId).toBe('outside-cap')
    }
  })

  it('长选项参数没登记 lookup 时给出明确警告，而不是假装能取候选', () => {
    const catalog = createCatalog({
      capabilities: [
        {
          id: 'no-lookup',
          title: '没登记候选入口的能力',
          pagePath: '/dashboard/fake/list',
          write: false,
          params: [{ name: 'deptId', kind: 'tree', required: false }],
        },
      ],
    })
    const result = catalog.describe('no-lookup')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join('\n')).toContain('lookup')
    expect(result.params[0]?.note).toContain('人工确认')
  })
})

/* ================================================================ 包内默认目录 */

describe('defaultCatalog', () => {
  it('用包内已注册的能力定义构建，结果与显式注入一致', () => {
    const explicit = makeCatalog().listDomains()
    const implicit = defaultCatalog.listDomains()

    expect(implicit.totalPages).toBe(explicit.totalPages)
    expect(implicit.totalCapabilities).toBe(explicit.totalCapabilities)
    expect(implicit.totalCapabilityOnlyPages).toBe(explicit.totalCapabilityOnlyPages)
  })
})
