/**
 * 目录可见性过滤**接进门面**的回归测试（设计 D8 / F18 / H36，conventions 第 15 条）。
 *
 * 在这条线接上之前，`src/catalog/visibility.ts`（433 行、实现完整）只有 `test/visibility.test.ts`
 * 拿夹具喂它——门面上**一次都没接过**：它要的输入是"这个用户能看到的菜单树"，
 * 而此前没有任何能力拿得到那棵树。`base-menu-nav`（`src/capabilities/base-shell.ts` 的
 * `getMenuNav()`）补上了输入，本文件钉的是**接上之后的那一段**：
 *
 * ```
 * baseShell.getMenuNav()                 ← 网络，per-(用户, 项目)
 *   └─ createUserVisibility()            ← 归一化（visibility.ts，已有 regression）
 *        └─ catalog.withVisibility()     ← 目录的子集视图（本文件）
 *             └─ portal / scoped.visibleCatalog()   ← 门面接线（本文件）
 * ```
 *
 * 三段各自"改坏了会红"的断言（对应报告里的反证）：
 *
 * 1. **视图真的收敛了**，而不是只把 report 换了个说法：同一个关键词在视图里搜不到被收敛的页面。
 * 2. **收敛 ≠ 拦住**：`describe()` 在视图里没命中时，理由必须说清"它在目录里，只是不在
 *    这次的可见面内"，**不能**回 `describe.ts` 那句"目录里没有能力"（那是说假话，
 *    而且会把调用方引向"去注册这个能力"）。
 * 3. **两个门面都接上了，且多用户不串用户**：同一份服务级 `catalog` 上，
 *    两个会话拿到的可见面必须不同（这条只看代码看不出来有没有坏）。
 *
 * 夹具两份，都不经过被测代码：
 * - `baseline/menu-nav.sample.json`：`GET /admin-api/sys/menu/nav?project=2` 的真实响应（2026-09-20）
 * - `generated/page-catalog.json`：1,019 行的页面唯一参考清单（由 `createCatalog` 的默认加载器读）
 */

import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import type { CapabilityDefinition } from '../src/capabilities/types.js'
import {
  createCatalog,
  createUserVisibility,
  type Catalog,
  type MenuNode,
} from '../src/catalog/index.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import {
  createPortalHeadless,
  createPortalServer,
  MenuVisibilityUnavailableError,
} from '../src/index.js'
import type { PortalRequestFactory } from '../src/session/index.js'

const here = dirname(fileURLToPath(import.meta.url))

type MenuNavSample = {
  request: { method: string; path: string; query: Record<string, number> }
  response: { ret: string; code: number; msg: string; data: MenuNode[] }
}

const menuNav: MenuNavSample = JSON.parse(
  readFileSync(join(here, '../baseline/menu-nav.sample.json'), 'utf8'),
)

/**
 * 夹具的可见性。`source` 写清楚，免得结果里看不出这份菜单是哪来的；
 * 用真实夹具树而不是手工编的几条路径，是因为**要一起钉住归一化那三步**
 * （去 query、去结尾 `/list`、`platform-v2` → `platform`）。
 */
function fixtureVisibility () {
  return createUserVisibility({
    menuTree: menuNav.response.data,
    source: 'sys/menu/nav?project=2（baseline/menu-nav.sample.json）',
  })
}

/** 与 `test/catalog.test.ts` 同一个口径：能力集固定成已知的两组，断言不随别人加能力漂移 */
const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

/** 夹具菜单里恰好 32 行页面靠菜单命中（`test/visibility.test.ts` 独立重数过同一个数） */
const MENU_MATCHED_PAGES = 32

describe('目录视图：Catalog.withVisibility()（纯层，不发请求）', () => {
  it('视图就是 report 说的那个面，不是另算一遍', () => {
    const catalog = makeCatalog()
    const scope = catalog.withVisibility(fixtureVisibility())

    // 32 这个数来自夹具与清单本身（见 test/visibility.test.ts 的独立重数），
    // 不是过滤实现自己报的
    expect(scope.report.counts.keptByMenuMatch).toBe(MENU_MATCHED_PAGES)
    expect(scope.catalog.index.pages.length).toBe(scope.report.counts.visible)
    expect(scope.catalog.index.pages.map((page) => page.id)).toEqual(
      scope.report.visiblePages.map((page) => page.id),
    )

    // 第一层下钻也跟着收敛：菜单清单里的页面数 == 靠菜单命中的那些，
    // 加上能力页才是可见总数（`listDomains` 的两个计数分开给，这里正好交叉核对一次）
    const full = catalog.listDomains()
    const scoped = scope.catalog.listDomains()
    expect(scoped.totalPages).toBe(scope.report.counts.keptByMenuMatch)
    expect(scoped.totalPages + scoped.totalCapabilityOnlyPages).toBe(scope.report.counts.visible)
    expect(scoped.totalDomains).toBeLessThan(full.totalDomains)
    expect(scope.report.counts.visible).toBeLessThan(full.totalPages)
  })

  it('被收敛掉的页面与能力，从 search / describePage / describe 上一起消失', () => {
    const catalog = makeCatalog()
    const scope = catalog.withVisibility(fixtureVisibility())

    // 会议室预定页：能力已注册、冒烟跑得通，但这个账号的菜单里没有它
    // （conventions 第 15 条那个例子的同一页）
    const hiddenPage = catalog.index.pageByPath.get('/dashboard/meeting-room/list')
    expect(hiddenPage).not.toBeUndefined()

    expect(catalog.describePage('/dashboard/meeting-room/list').ok).toBe(true)
    expect(scope.catalog.describePage('/dashboard/meeting-room/list').ok).toBe(false)

    // 搜索里也不再出现这一页（`search` 的 page hit 把页面 id 放在 `pageId` 上）
    const pageIds = (result: ReturnType<Catalog['search']>): Array<string | undefined> =>
      result.hits.map((hit) => hit.pageId)
    expect(pageIds(catalog.search('会议室'))).toContain(hiddenPage?.id)
    expect(pageIds(scope.catalog.search('会议室'))).not.toContain(hiddenPage?.id)

    // 能力这一层：只挂在隐藏页面上的那个跟着消失
    expect(catalog.describe('meeting-room-list').ok).toBe(true)
    expect(scope.catalog.describe('meeting-room-list').ok).toBe(false)
    // 而挂在 capability-only 页面上的能力要留下：那是 H36 边界一 / D9
    // （会议预定表单页不在菜单树里是设计如此，默认保下来）
    expect(scope.catalog.describe('meeting-room-usage').ok).toBe(true)
  })

  it('同一能力挂在多页时：任一 pagePath 可见就留着（宁可多留，不可误杀）', () => {
    // 这条规则单独立一个用例：真实能力表里**没有**同 ID 两处定义的形状，
    // 不合成的话它没有任何覆盖 —— 反证时实测到：把判据改成"只看 primary.pagePath"，
    // 当时的全套 16 例仍然全绿（那个改动会把"还有一条可见入口"的能力整批误杀）。
    // 补上本用例之后同一个改动能让它红。
    const visiblePath = '/dashboard/attendance/attendance-team/list'
    const hiddenPath = '/dashboard/meeting-room/list'
    // 原来用 `/dashboard/finance/revenue/customer/list`，2026-09-21 换成作业管理：
    // 前者在 `menus/finance.js:82` 是注释掉的，已不在页面清单里（conventions 第 28 条）。
    // 换掉的必须是**清单里真实存在**的隐藏页 —— 用一条不存在的路径会让
    // `synthetic-all-hidden` 只剩一条 pagePath，测不到"两条都不可见"这件事。
    const hiddenPath2 = '/dashboard/assignment/assignment/list'
    const merge = (id: string, pagePaths: string[]): CapabilityDefinition[] =>
      pagePaths.map((pagePath) => ({ id, title: `合成能力 ${id}`, pagePath, write: false, params: [] }))

    const catalog = createCatalog({
      capabilities: [
        ...CAPABILITIES,
        // **不可见的那个排在前面**：它是合并后的 `primary`，
        // 只按 primary 判可见的实现会在这里露出来
        ...merge('synthetic-partly-visible', [hiddenPath, visiblePath]),
        ...merge('synthetic-all-hidden', [hiddenPath, hiddenPath2]),
      ],
    })

    // 前提先立住：这两条确实被合并成了"一个 ID、两条 pagePath"的能力
    expect(catalog.index.capabilityById.get('synthetic-partly-visible')?.pagePaths).toEqual([
      hiddenPath,
      visiblePath,
    ])
    expect(catalog.index.duplicateCapabilityIds).toContain('synthetic-partly-visible')

    const scope = catalog.withVisibility(fixtureVisibility())
    expect(scope.report.explain(hiddenPath)?.visible).toBe(false)
    expect(scope.report.explain(visiblePath)?.visible).toBe(true)

    expect(scope.catalog.describe('synthetic-partly-visible').ok).toBe(true)
    expect(scope.catalog.describe('synthetic-all-hidden').ok).toBe(false)
  })

  it('recommend 也收敛：被收敛的页面不会出现在推荐里', () => {
    const catalog = makeCatalog()
    const scope = catalog.withVisibility(fixtureVisibility())
    const hiddenPageId = catalog.index.pageByPath.get('/dashboard/meeting-room/list')?.id

    const pageIds = (result: ReturnType<Catalog['recommend']>): string[] =>
      result.pages.map((page) => page.id)

    expect(pageIds(catalog.recommend('帮我订个会议室'))).toContain(hiddenPageId)
    // 推荐还给出这一页，等于让 AI 去调一个它看不到的页面
    expect(pageIds(scope.catalog.recommend('帮我订个会议室'))).not.toContain(hiddenPageId)
  })

  it('describe 没命中时说的是"不在可见面内"，不是"目录里没有"', () => {
    const catalog = makeCatalog()
    const scope = catalog.withVisibility(fixtureVisibility())

    // 同一份能力：全量目录里调得到，视图里没有（它只挂在会议室预定页上）
    expect(catalog.describe('meeting-room-list').ok).toBe(true)

    const miss = scope.catalog.describe('meeting-room-list')
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    expect(miss.reason).toContain('不在这次的可见菜单口径内')
    // conventions 第 15 条：这条过滤不是权限裁决 —— 理由里必须说清它可能仍然可调
    expect(miss.reason).toContain('不是权限裁决')
    expect(miss.reason).toContain('sdk.capabilities.invoke()')
    expect(miss.reason).not.toContain('目录里没有能力')

    // `-llm` 那种写法（A6/D14 的习惯）走的是同一条路
    const viaLlm = scope.catalog.describe('meeting-room-list-llm')
    expect(viaLlm.ok).toBe(false)
    if (viaLlm.ok) return
    expect(viaLlm.reason).toContain('不在这次的可见菜单口径内')

    // 大小写不同的写法（`describe()` 本身就宽容）也要认出来是"同一个能力、不在可见面内"，
    // 而不是掉回"目录里没有它"
    const viaCase = scope.catalog.describe('MEETING-ROOM-LIST')
    expect(viaCase.ok).toBe(false)
    if (viaCase.ok) return
    expect(viaCase.reason).toContain('不在这次的可见菜单口径内')
  })

  it('真的不在目录里时，理由一个字都不改', () => {
    const scope = makeCatalog().withVisibility(fixtureVisibility())
    const miss = scope.catalog.describe('no-such-capability-at-all')
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    // 这条不能被上面的"可见面"文案盖掉，否则"目录里没有"和"你看不到"就分不开了
    expect(miss.reason).toContain('目录里没有能力')
    expect(miss.reason).not.toContain('不在这次的可见菜单口径内')
  })

  it('自检 validate() 仍打在全量数据上：视图里一个死链都不多报', () => {
    const catalog = makeCatalog()
    // 关掉 capability-only 的保留，让视图真的丢掉一批能力——
    // 自检若打在子集索引上，别名 / 链接里那些指向被丢掉能力的条目会立刻变成"死链"
    const scope = catalog.withVisibility(fixtureVisibility(), { keepCapabilityOnly: false })
    expect(scope.catalog.index.capabilities.length).toBeLessThan(
      catalog.index.capabilities.length,
    )

    expect(scope.catalog.validate().links).toEqual(catalog.validate().links)
    expect(scope.catalog.validate().aliases).toEqual(catalog.validate().aliases)
    expect(scope.catalog.validate().lookups).toEqual(catalog.validate().lookups)
  })

  it('视图不改全量目录，也不与它共享页面对象', () => {
    const catalog = makeCatalog()
    const before = catalog.listDomains()
    const page = catalog.index.pageByPath.get('/dashboard/meeting-room/list')
    expect(page).not.toBeUndefined()
    const capabilityIdsBefore = [...(page?.capabilityIds ?? [])]

    const scope = catalog.withVisibility(fixtureVisibility())

    // 全量目录一个字段都没变
    expect(catalog.listDomains().totalPages).toBe(before.totalPages)
    expect(catalog.describe('meeting-room-usage').ok).toBe(true)
    expect(page?.capabilityIds).toEqual(capabilityIdsBefore)

    // 视图里的页面是**新建**的对象：改它不会污染别人看到的那一份
    const scopedPage = scope.catalog.index.pageByPath.get('/dashboard/attendance/attendance-team/list')
    const sharedPage = catalog.index.pageByPath.get('/dashboard/attendance/attendance-team/list')
    expect(scopedPage).not.toBeUndefined()
    expect(scopedPage).not.toBe(sharedPage)
    if (scopedPage === undefined) return
    scopedPage.capabilityIds.push('故意塞进去的')
    expect(sharedPage?.capabilityIds).not.toContain('故意塞进去的')
  })

  it('视图里的 capabilityIds 与视图里的能力表一致（没有指向被收敛能力的悬空 id）', () => {
    const scope = makeCatalog().withVisibility(fixtureVisibility())
    const ids = new Set(scope.catalog.index.capabilities.map((capability) => capability.id))
    for (const page of scope.catalog.index.pages) {
      for (const capabilityId of page.capabilityIds) {
        expect(ids.has(capabilityId), `${page.id} → ${capabilityId}`).toBe(true)
      }
    }
  })

  it('`keepCapabilityOnly` 的默认值仍是保留能力页（D9：流程表单不在菜单里是设计如此）', () => {
    const catalog = makeCatalog()
    const keep = catalog.withVisibility(fixtureVisibility())
    const drop = catalog.withVisibility(fixtureVisibility(), { keepCapabilityOnly: false })

    // 通用审批那一页（`/dashboard/flow/form/edit`）不在清单里、也不在这份菜单树里，
    // 默认必须保下来，关掉开关才会消失
    expect(keep.catalog.describe('meeting-application-submit').ok).toBe(true)
    expect(drop.catalog.describe('meeting-application-submit').ok).toBe(false)
    // 保下来的那些**不是**靠菜单命中的：报告里能看出来
    expect(keep.report.counts.keptByCapabilityOnly).toBeGreaterThan(0)
    expect(keep.report.counts.visible).toBe(
      keep.report.counts.keptByMenuMatch + keep.report.counts.keptByCapabilityOnly,
    )
  })
})

/* ------------------------------------------------------------------ 单用户门面 */

/**
 * 单用户门面的端到端：本地起一个**只回夹具**的 http 服务，让请求真的走一遍
 * `createPortalHttp` 的那套（实例 → 前缀 → 请求头 → 包络解包）。
 *
 * 为什么不用真后端：测试不该打网络（那是冒烟脚本的事）。为什么不用桩函数：
 * `createPortalHeadless` 的请求层没有接缝（凭据在创建时绑定，实例不对外暴露），
 * 所以这里选择"真发一次请求、发给本机"。
 */
describe('单用户门面：createPortalHeadless().visibleCatalog()', () => {
  let server: Server
  let baseUrl: string
  let requested: string[]

  beforeAll(async () => {
    server = createServer((request, response) => {
      requested.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(menuNav.response))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('本地桩服务没起来')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => { resolve() }))
  })

  function makePortal (url = baseUrl) {
    return createPortalHeadless({
      baseUrl: url,
      credential: { token: 'tk-stub', tenantId: 1 },
      userId: 'u-stub',
      // 打不通时的兜底：不该等 180 秒（默认值）
      timeoutMs: 1500,
    })
  }

  it('取菜单 → 收敛目录：真的打了 nav?project=2，拿到的面也对', async () => {
    requested = []
    const portal = makePortal()
    const scope = await portal.visibleCatalog({ project: 2 })

    // 一个请求、打到文档写的那条接口上（`_t=` 是 GET 防缓存参数，与前端一致，见 src/http/client.ts）
    expect(requested).toHaveLength(1)
    expect(requested[0]).toMatch(/^\/admin-api\/sys\/menu\/nav\?project=2(&_t=\d+)?$/)
    expect(scope.applied).toBe(true)
    expect(scope.note).toBeNull()
    expect(scope.report?.counts.keptByMenuMatch).toBe(MENU_MATCHED_PAGES)

    // 收敛真的生效在视图上（不是只换了个 report）
    expect(scope.catalog.describePage('/dashboard/meeting-room/list').ok).toBe(false)
    // 而**没被收敛**的那条路原样存在：收敛不是拦住（conventions 第 15 条）
    // 同一页在全量目录里照旧，能力方法也照旧挂在门面上
    expect(portal.catalog.describePage('/dashboard/meeting-room/list').ok).toBe(true)
    expect(portal.catalog.describe('meeting-room-list').ok).toBe(true)
    expect(typeof portal.meetingRoom.list).toBe('function')
  })

  it('project 缺失时先于网络失败：一个请求都不发', async () => {
    requested = []
    const portal = makePortal()
    await expect(portal.visibleCatalog({} as never)).rejects.toBeInstanceOf(TypeError)
    expect(requested).toEqual([])
  })

  it('取不到菜单树时失败关闭，并指明显式的退路', async () => {
    // 9 是 discard 端口，本机上没有服务在听 → 连接直接失败
    const portal = makePortal('http://127.0.0.1:9')
    await expect(portal.visibleCatalog({ project: 2 })).rejects.toBeInstanceOf(
      MenuVisibilityUnavailableError,
    )
    await expect(portal.visibleCatalog({ project: 2 })).rejects.toThrow(
      /portal\.catalog/,
    )
  })

  it('显式要降级时给的是**未过滤**的那一份，并说清它不是"全部可见"', async () => {
    const portal = makePortal('http://127.0.0.1:9')
    const scope = await portal.visibleCatalog({ project: 2, onUnavailable: 'unfiltered' })

    expect(scope.applied).toBe(false)
    expect(scope.report).toBeNull()
    expect(scope.note).toContain("onUnavailable='unfiltered'")
    expect(scope.note).toContain('不代表')
    // 降级给的就是那一份全量目录本身，不是又抄了一份
    expect(scope.catalog).toBe(portal.catalog)
    expect(scope.catalog.listDomains().totalPages).toBe(portal.catalog.listDomains().totalPages)
  })

  it('树被截断时也失败关闭（截断的树会把"其实可见"判成不可见）', async () => {
    requested = []
    const portal = makePortal()
    await expect(portal.visibleCatalog({ project: 2, maxNodes: 1 })).rejects.toBeInstanceOf(
      MenuVisibilityUnavailableError,
    )
    await expect(portal.visibleCatalog({ project: 2, maxNodes: 1 })).rejects.toThrow(/截断/)

    // 截断是"取到了但不够用"，与取不到一样按失败处理；显式降级时也一样降级
    const degraded = await portal.visibleCatalog({
      project: 2,
      maxNodes: 1,
      onUnavailable: 'unfiltered',
    })
    expect(degraded.applied).toBe(false)
  })
})

/* ------------------------------------------------------------------ 多用户门面 */

type Sent = { token: string; url: string; params: unknown }

/**
 * 请求层桩：**按凭据 token 给不同的菜单树**。
 *
 * 这一条是刻意设计的对照：如果 `visibleCatalog()` 走的是服务级 `catalog` 或某个共享的
 * 菜单缓存，两个用户拿到的可见面就会一样——那种错在真机上表现为"这个用户看到了别人的菜单"，
 * 只看代码看不出来。
 */
function stubFactory (sent: Sent[]): PortalRequestFactory {
  return ({ credential }) =>
    <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> => {
      sent.push({
        token: String(credential.token),
        url: String(requestConfig.url ?? ''),
        params: requestConfig.params,
      })
      const tree =
        String(credential.token) === 'tk-u2'
          ? [{ id: 1, permissions: '/dashboard/meeting-room', children: [] }]
          : menuNav.response.data
      return Promise.resolve(tree as unknown as T)
    }
}

describe('多用户门面：forSession().visibleCatalog()', () => {
  it('两个会话各拿各的可见面，服务级那份目录一个字段都不变', async () => {
    const sent: Sent[] = []
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: { createRequest: stubFactory(sent) },
    })

    const first = await server.forSession({
      userId: 'u1',
      credential: { token: 'tk-u1', tenantId: 7 },
      capabilities: [],
    })
    const second = await server.forSession({
      userId: 'u2',
      credential: { token: 'tk-u2', tenantId: 7 },
      capabilities: [],
    })

    const wide = await first.visibleCatalog({ project: 2 })
    const narrow = await second.visibleCatalog({ project: 2 })

    // 菜单真的是这两份会话各自取回来的（一个请求都没漏）
    expect(sent.filter((item) => item.url === '/admin-api/sys/menu/nav')).toHaveLength(2)
    expect(sent.map((item) => item.token)).toEqual(['tk-u1', 'tk-u2'])
    expect(sent.map((item) => item.params)).toEqual([{ project: 2 }, { project: 2 }])

    expect(wide.report?.counts.keptByMenuMatch).toBe(MENU_MATCHED_PAGES)
    // u2 的菜单里只有会议室那一条分组路径 → 会议室预定页**可见**，而 u1 看不到它。
    // 两个方向都钉住：只钉一个方向的话，"两个用户都拿到同一份全量"也能让它绿。
    expect(narrow.report?.counts.keptByMenuMatch).toBeGreaterThanOrEqual(1)
    expect(wide.catalog.describe('meeting-room-list').ok).toBe(false)
    expect(narrow.catalog.describe('meeting-room-list').ok).toBe(true)

    // 服务级那份（所有会话共享的静态目录）没被任何一个人的可见性改过
    expect(server.catalog.describe('meeting-room-list').ok).toBe(true)
    expect(server.catalog.listDomains().totalPages).toBeGreaterThan(
      wide.catalog.listDomains().totalPages,
    )
  })

  it('取不到菜单时同样是失败关闭，而不是回落到服务级全量', async () => {
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: {
        createRequest: () =>
          () => Promise.reject(new Error('桩：请求层故障')),
      },
    })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 'tk-u1', tenantId: 7 },
      capabilities: [],
    })

    await expect(scoped.visibleCatalog({ project: 2 })).rejects.toBeInstanceOf(
      MenuVisibilityUnavailableError,
    )
  })
})
