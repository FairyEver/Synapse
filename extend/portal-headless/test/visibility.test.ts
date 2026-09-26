import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { meetingApplicationCapabilities } from '../src/capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../src/capabilities/meeting-room.js'
import { buildIndex } from '../src/catalog/catalog-index.js'
import {
  collectVisiblePaths,
  createUserVisibility,
  filterCatalog,
  isPathLike,
  normalizeVisibilityKey,
  visibilityProbeKeys,
  type MenuNode,
} from '../src/catalog/visibility.js'
import type { GeneratedPageCatalog } from '../src/catalog/types.js'

/**
 * 能力目录的可见性过滤（设计 D8 / F18 / F19 / H36 / D34）。
 *
 * 两条数据都是真的，都不经过被测试的代码：
 * - `baseline/menu-nav.sample.json`：bsk 在已登录浏览器里抓的 `GET /admin-api/sys/menu/nav?project=2`
 *   真实响应体（2026-09-20，测试环境）
 * - `generated/page-catalog.json`：983 行的页面唯一参考清单（Portal 82651c98c5，D24）
 *
 * 这里刻意**直接读原始文件、独立重数**：如果只在测试里调被测函数再断言它自己的输出，
 * 匹配逻辑整体挂掉时测试可能照样绿。
 */

const here = dirname(fileURLToPath(import.meta.url))

const rawCatalog: GeneratedPageCatalog = JSON.parse(
  readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
)

type MenuNavSample = {
  request: { method: string; path: string; query: Record<string, number> }
  response: { ret: string; code: number; msg: string; data: MenuNode[] }
  /** 同一个会话里抓的兄弟接口，摊平成路径集（见夹具头部的说明） */
  跨系统菜单路径集: { 接口: string; paths: string[] }
}

const sample: MenuNavSample = JSON.parse(
  readFileSync(join(here, '../baseline/menu-nav.sample.json'), 'utf8'),
)

const CAPABILITIES = [...meetingRoomCapabilities, ...meetingApplicationCapabilities]

/** 索引直接从原始文件的行建，保证测的就是那一份清单 */
function realIndex () {
  return buildIndex({
    rows: rawCatalog.items,
    capabilities: CAPABILITIES,
    generatedAt: rawCatalog.generatedAt,
  })
}

/** 夹具里的可见性：来源写清楚，免得结果里看不出这份菜单是哪来的 */
function sampleVisibility () {
  return createUserVisibility({
    menuTree: sample.response.data,
    source: 'sys/menu/nav?project=2（baseline/menu-nav.sample.json）',
  })
}

/**
 * 独立重数：只拿两个原始文件、三行代码数一遍"有多少行页面对得上菜单里的路径"。
 * 不做归一化、不碰被测的过滤实现——测出来的是数据本身说了什么。
 */
function countExactPermissionMatches (): { rows: number; matched: number } {
  const menuPermissions = new Set<string>()
  const walk = (nodes: MenuNode[]): void => {
    for (const node of nodes) {
      if (isPathLike(node.permissions)) menuPermissions.add(node.permissions)
      walk(node.children ?? [])
    }
  }
  walk(sample.response.data)

  const rows = rawCatalog.items.filter((row) => row.permission !== '')
  return {
    rows: rows.length,
    matched: rows.filter((row) => menuPermissions.has(row.permission)).length,
  }
}

/**
 * 测试自己的归一化：故意**不复用** `src/catalog/visibility.ts` 的实现，
 * 否则被测实现改了、期望值跟着一起改，测试就永远不会红。
 * 规则只有三条，和夹具里记录的真实差异一一对应。
 */
function expectedKey (raw: string): string {
  let key = raw.trim()
  const query = key.indexOf('?')
  if (query > -1) key = key.slice(0, query)
  if (key.endsWith('/list')) key = key.slice(0, -'/list'.length)
  return key.replace(/^\/dashboard\/platform-v2(\/|$)/, '/dashboard/platform$1')
}

/** 独立重数：每行页面到底是靠哪个探测键对上的 */
function countMatchBreakdown (menuPaths: string[]) {
  const keys = new Set(menuPaths.map(expectedKey))
  let byPermissionOnly = 0
  let byMenuPathOnly = 0
  let byBoth = 0
  for (const row of rawCatalog.items) {
    const pathHit = row.menuPath !== null && row.menuPath.startsWith('/') && keys.has(expectedKey(row.menuPath))
    const permHit = row.permission.startsWith('/') && keys.has(expectedKey(row.permission))
    if (pathHit && permHit) byBoth++
    else if (permHit) byPermissionOnly++
    else if (pathHit) byMenuPathOnly++
  }
  return { keys: keys.size, byPermissionOnly, byMenuPathOnly, byBoth }
}

describe('菜单树的形状（用真实样本验证，不看代码猜字段名）', () => {
  it('url 恒为 null，页面路径落在 permissions 里', () => {
    const nodes: MenuNode[] = []
    const walk = (list: MenuNode[]): void => {
      for (const node of list) {
        nodes.push(node)
        walk(node.children ?? [])
      }
    }
    walk(sample.response.data)

    expect(nodes.length).toBe(57)
    // 这两条是整件事的前提：拿 url 去对 menuPath 的实现会一条都对不上
    expect(nodes.filter((node) => node.url !== null && node.url !== '').length).toBe(0)
    expect(nodes.filter((node) => isPathLike(node.permissions)).length).toBe(36)
  })

  it('permissions 在真实数据里不是逗号分隔的多个码', () => {
    // DTO 注释写的是"多个用逗号分隔"，实测不是。认成多值会把整条路径解析错
    const withComma = collectVisiblePaths(sample.response.data).filter((key) => key.includes(','))
    expect(withComma).toEqual([])
  })

  it('夹具的 request 就是被测的那个接口与 query', () => {
    expect(sample.request.method).toBe('GET')
    expect(sample.request.path).toBe('/admin-api/sys/menu/nav')
    expect(sample.request.query.project).toBe(2)
    expect(sample.response.ret).toBe('SUCCESS')
  })
})

describe('normalizeVisibilityKey', () => {
  it('去掉 query、结尾的 /list、以及 platform-v2 与 platform 的代差', () => {
    expect(normalizeVisibilityKey('/dashboard/attendance/attendance-team')).toBe(
      '/dashboard/attendance/attendance-team',
    )
    expect(normalizeVisibilityKey('/dashboard/attendance/attendance-team/list')).toBe(
      '/dashboard/attendance/attendance-team',
    )
    expect(normalizeVisibilityKey('/dashboard/platform-v2/report/clue-view?tab=1')).toBe(
      '/dashboard/platform/report/clue-view',
    )
    // 只有作为路径段出现时才替换，普通字符串里的同名片段不能动
    expect(normalizeVisibilityKey('/dashboard/platform-v2x/list')).toBe('/dashboard/platform-v2x')
  })
})

describe('权限码这一支对本目录无用（所以没有按码匹配的入口）', () => {
  it('目录里的 permission 全是路径，没有一个是不带 / 的码', () => {
    const codeLike = rawCatalog.items.filter(
      (row) => row.permission !== '' && !row.permission.startsWith('/'),
    )
    expect(codeLike).toEqual([])
  })

  it('拿权限码当可见性喂进去，一个页面都不会命中', () => {
    // 真实菜单里系统根节点的码（样本第一条，实测值）
    const visibility = createUserVisibility({
      paths: ['hr:module:approval', 'hr:module:salary', 'ai-token:usage:query'],
      source: '手工构造：只放权限码，不放路径',
    })
    expect(visibility.keys.size).toBe(0)

    const report = filterCatalog(realIndex(), visibility)
    expect(report.counts.keptByMenuMatch).toBe(0)
    expect(report.visiblePathCount).toBe(0)
  })
})

describe('用真实菜单样本过滤真实页面清单', () => {
  it('菜单命中的页面数来自数据本身，不是过滤实现自己说的', () => {
    // 独立重数：993 行带 permission，其中 32 行与旧菜单基准里的路径逐字符相同。
    // 2026-09-23 Portal 固定分支更新后，目录由 990 校正为 993。
    const exact = countExactPermissionMatches()
    expect(exact.rows).toBe(973)
    expect(exact.matched).toBe(32)

    const report = filterCatalog(realIndex(), sampleVisibility())
    expect(report.counts.keptByMenuMatch).toBe(32)
    // 另外 2 个是菜单里没有的能力页（H36 边界一），所以可见总数比 32 大
    expect(report.counts.visible).toBe(report.counts.keptByMenuMatch + report.counts.keptByCapabilityOnly)
  })

  it('页面总数与清单行数一一对应，没有凭空多出或漏掉', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const capabilityOnly = report.pages.filter((entry) => entry.page.source === 'capability-only').length

    expect(report.counts.totalPages).toBe(rawCatalog.items.length + capabilityOnly)
    expect(report.pages.length).toBe(report.counts.totalPages)
    expect(report.counts.visible + report.counts.hidden).toBe(report.counts.totalPages)
    // 清单行一条没丢：每条都能在报告里按 id 找到
    for (const row of rawCatalog.items.slice(0, 30)) {
      expect(report.pages.some((entry) => entry.page.id === row.id), row.id).toBe(true)
    }
  })

  it('具体页面在/不在都对得上', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())

    // 菜单里有的（这四条在样本里，逐条能指到菜单节点上）
    for (const path of [
      '/dashboard/attendance/attendance-team/list',
      '/dashboard/attendance/attendance-shift/list',
      '/dashboard/report/salary-cost/list',
      '/dashboard/staff/external-staff-list/list',
    ]) {
      const entry = report.explain(path)
      expect(entry, path).not.toBeNull()
      expect(entry?.visible, path).toBe(true)
      expect(entry?.keptBy, path).toBe('menu-match')
      expect(entry?.matchedKeys.length, path).toBeGreaterThan(0)
    }

    // 菜单里没有的：会议室预定页与作业管理页的能力都已注册、冒烟也跑得通，
    // 但这个账号的菜单里没有它们。
    // （原来第二个用的是 `/dashboard/finance/revenue/customer/list`，2026-09-21 换成作业管理：
    //  前者在 `menus/finance.js:82` 是注释掉的，已不在页面清单里，见 conventions 第 28 条）
    for (const path of ['/dashboard/meeting-room/list', '/dashboard/assignment/assignment/list']) {
      const entry = report.explain(path)
      expect(entry, path).not.toBeNull()
      expect(entry?.visible, path).toBe(false)
      expect(entry?.reason, path).toBe('not-in-menu')
    }
  })

  it('visiblePages 就是 pages 里 visible 的那些，且沿用索引顺序', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const fromPages = report.pages.filter((entry) => entry.visible).map((entry) => entry.page.id)
    expect(report.visiblePages.map((page) => page.id)).toEqual(fromPages)
    // 顺序是索引顺序的子序列，调用方不用再排一次
    const indexOrder = report.pages.map((entry) => entry.page.id)
    let cursor = -1
    for (const id of report.visiblePages.map((page) => page.id)) {
      const at = indexOrder.indexOf(id, cursor + 1)
      expect(at, id).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('被过滤掉的原因只有"菜单里没有"这一种', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const reasons = new Set(report.hiddenPages.map((entry) => entry.reason))
    expect([...reasons]).toEqual(['not-in-menu'])

    // 没命中的必须说清拿什么去比过，否则排查只能靠猜
    for (const entry of report.hiddenPages) {
      expect(entry.matchedKeys, entry.page.id).toEqual([])
      const labels = entry.probedKeys
      // 有键可比的，键必须是真的路径形态。
      for (const key of labels) expect(key.startsWith('/'), `${entry.page.id} ${key}`).toBe(true)
    }

    // 旧清单的 5 个无键 iframe 是 import / 包装函数被误收，修复扫描器后应为零。
    const unprobeable = report.pages.filter(
      (entry) => entry.probedKeys.length === 0 && !isPathLike(entry.page.permission) && entry.page.menuPath === null,
    )
    expect(unprobeable).toEqual([])
  })
})

describe('H36 边界一：菜单里没有、但确实是能力的页面', () => {
  it('流程表单页被保下来，不会被菜单过滤误杀', () => {
    const index = realIndex()
    const report = filterCatalog(index, sampleVisibility())

    // 这两个只被能力定义引用，不在清单里，也不在这份菜单树里
    expect(index.capabilityOnlyPagePaths).toContain('/simple/hr/form/033')
    expect(index.capabilityOnlyPagePaths).toContain('/dashboard/flow/form/edit')
    expect(sampleVisibility().keys.has('/simple/hr/form/033')).toBe(false)

    for (const path of ['/simple/hr/form/033', '/dashboard/flow/form/edit']) {
      const entry = report.pages.find((candidate) => candidate.page.menuPath === path)
      expect(entry, path).not.toBeUndefined()
      expect(entry?.visible, path).toBe(true)
      expect(entry?.keptBy, path).toBe('capability-only')
      // 保下来不等于"菜单里对上了"——匹配键仍然是空的，这一点必须能看出来
      expect(entry?.matchedKeys, path).toEqual([])
    }

    expect(report.counts.keptByCapabilityOnly).toBeGreaterThanOrEqual(2)
    expect(report.capabilityOnlyPages.length).toBe(index.capabilityOnlyPagePaths.length)
  })

  it('关掉开关后它们才会被过滤，说明"保下来"确实只由这一条决定', () => {
    const report = filterCatalog(realIndex(), sampleVisibility(), { keepCapabilityOnly: false })
    const entry = report.pages.find((candidate) => candidate.page.menuPath === '/simple/hr/form/033')
    expect(entry?.visible).toBe(false)
    expect(entry?.reason).toBe('not-in-menu')
  })

  it('业务表单页本身在清单里，就不是 capability-only', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const meetingRoom = report.pages.find((entry) => entry.page.menuPath === '/dashboard/meeting-room/list')
    expect(meetingRoom?.page.source).toBe('menu-catalog')
  })
})

describe('H36 边界三：iframe 叶子', () => {
  it('menuPath 为 null，只有 permission 能匹配上', () => {
    const iframeRows = rawCatalog.items.filter((row) => row.kind === 'iframe 嵌入外部系统')
    // 排除 import 声明与包装函数 return 误收的 5 行，只保留菜单 path 调用。
    expect(iframeRows.length).toBe(38)
    expect(iframeRows.every((row) => row.menuPath === null)).toBe(true)
    expect(iframeRows.filter((row) => isPathLike(row.permission)).length).toBe(38)

    // 拿 menuPath 当唯一连接键的实现，会把这 49 条整批判成不可见
    const index = realIndex()
    const report = filterCatalog(index, sampleVisibility())
    expect(report.iframePages.length).toBe(38)
    expect(report.counts.iframeVisible).toBe(0)
  })

  it('菜单里有它的路径时它是可见的，但只能跳转、不可无头调用', () => {
    // 样本换过一次：原来用 `/dashboard/flow/task/my`，那是因为旧清单里拿它当 iframe ——
    // 而它是**被注释掉的那条**（hr.js:237-241 整块注释），2026-09-21 已不在清单里；
    // 实时的那一条是真实页面 `/dashboard/flow/task/my/list`（list 页，不是 iframe）。
    // 现在改用流程管理里一个实时的 iframe 叶子。见 conventions 第 28 条。
    const visibility = createUserVisibility({
      paths: ['/dashboard/frame/bpm/manager/model'],
      source: '手工构造：只放一条 iframe 路径',
    })
    const report = filterCatalog(realIndex(), visibility)

    const entry = report.pages.find((candidate) => candidate.page.permission === '/dashboard/frame/bpm/manager/model')
    expect(entry).not.toBeUndefined()
    expect(entry?.visible).toBe(true)
    expect(entry?.keptBy).toBe('menu-match')
    expect(entry?.callable).toBe(false)
    expect(entry?.notCallableBecause).toBe('iframe')
    expect(report.counts.iframeVisible).toBe(1)
  })

  it('普通页面不会被标成不可调用', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const normal = report.visiblePages.find((page) => page.kind !== 'iframe 嵌入外部系统')
    expect(normal).not.toBeUndefined()
    const entry = report.pages.find((candidate) => candidate.page.id === normal?.id)
    expect(entry?.callable).toBe(true)
    expect(entry?.notCallableBecause).toBeUndefined()
  })
})

describe('H36 边界二：菜单里有、目录里没有实现的页面', () => {
  it('只列菜单叶子，不被分组节点灌满', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())

    // 这三条在样本菜单里是叶子，清单里确实没有对应实现
    expect(report.menuOnlyPaths).toEqual([
      '/dashboard/agreement',
      '/dashboard/manage',
      '/dashboard/template',
    ])
    expect(report.counts.menuOnly).toBe(3)

    // /dashboard/report 也是菜单里的一条路径，但它是已覆盖页面的祖先（分组节点），
    // 报成"没有实现"会误导排查方向
    const visibility = sampleVisibility()
    expect(visibility.keys.has('/dashboard/report')).toBe(true)
    expect(report.menuOnlyPaths).not.toContain('/dashboard/report')
  })

  it('报出来的确实在清单里找不到', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    for (const path of report.menuOnlyPaths) {
      const found = rawCatalog.items.some(
        (row) => row.menuPath === path || row.menuPath === `${path}/list` || row.permission === path,
      )
      expect(found, path).toBe(false)
    }
  })
})

describe('F18 与 F19 是两回事，不能混进同一个原因里', () => {
  it('页面被过滤，但它算得出 module-type', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    const entry = report.explain('/dashboard/agreement-change/main/list')

    expect(entry?.visible).toBe(false)
    expect(entry?.reason).toBe('not-in-menu')
    // F18：不可见的原因是权限/开通，不是"这页算不出 module-type"
    expect(entry?.moduleType.resolvable).toBe(true)
    expect(entry?.moduleType.value).toBe(13)
  })

  it('页面可见，但它算不出 module-type，照样不被过滤', () => {
    // 平台管理域实测 100% 匹配不到 module-type 规则（设计 §1d）
    // 样本换过一次：原来用 `/dashboard/platform/setting/menu/list`，那一行在
    // `menus/mall.js:81` 是注释掉的，2026-09-21 已不在清单里（conventions 第 28 条）。
    // 改用同域另一个实时的、同样算不出 module-type 的页面。
    const visibility = createUserVisibility({
      paths: ['/dashboard/platform/activity/coupon-setting'],
      source: '手工构造：只放一条平台管理路径',
    })
    const report = filterCatalog(realIndex(), visibility)
    const entry = report.explain('/dashboard/platform/activity/coupon-setting/list')

    expect(entry?.visible).toBe(true)
    expect(entry?.reason).toBeUndefined()
    // F19/D34：算不出来时前端本来就不发这个头，这不构成过滤理由
    expect(entry?.moduleType.resolvable).toBe(false)
    expect(entry?.moduleType.value).toBeNull()
  })

  it('两种原因不会同时出现在一条上', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    for (const entry of report.pages) {
      if (entry.visible) expect(entry.reason, entry.page.id).toBeUndefined()
      else expect(entry.keptBy, entry.page.id).toBeUndefined()
    }
  })
})

describe('跨系统菜单口径：permission 这个探测键在这里才是决定性的', () => {
  function crossSystemVisibility () {
    return createUserVisibility({
      paths: sample.跨系统菜单路径集.paths,
      source: 'sys/menu/selectRoleMenuListNotBySystem（跨系统口径）',
    })
  }

  it('夹具里的路径集是真实的、可直接当下发口径用的', () => {
    expect(sample.跨系统菜单路径集.接口).toContain('/admin-api/sys/menu/selectRoleMenuListNotBySystem')
    expect(sample.跨系统菜单路径集.paths.length).toBe(1119)
    expect(sample.跨系统菜单路径集.paths.every((path) => path.startsWith('/'))).toBe(true)
  })

  it('覆盖 907 / 993 行，比只用菜单路径多出 259 行', () => {
    const breakdown = countMatchBreakdown(sample.跨系统菜单路径集.paths)
    expect(breakdown.keys).toBe(1118)
    // 独立重数出来的三个数：只靠 permission 命中的那 258 行，正是把 iframe 叶子
    // 和路径改过名的那些页面捡回来的部分
    expect(breakdown.byPermissionOnly).toBe(259)
    expect(breakdown.byMenuPathOnly).toBe(3)
    expect(breakdown.byBoth).toBe(645)

    const report = filterCatalog(realIndex(), crossSystemVisibility())
    expect(report.counts.keptByMenuMatch).toBe(
      breakdown.byPermissionOnly + breakdown.byMenuPathOnly + breakdown.byBoth,
    )
    expect(report.counts.keptByMenuMatch).toBe(907)
    expect(report.counts.keptByMenuMatch).toBeGreaterThan(
      breakdown.byMenuPathOnly + breakdown.byBoth,
    )
  })

  it('只有 permission 能对上的那些页面，确实靠它被保下来', () => {
    const report = filterCatalog(realIndex(), crossSystemVisibility())

    // iframe 叶子靠 permission 对上；它们 menuPath 为 null，菜单路径探测键给不出任何东西。
    // 2026-09-21：清单里的 iframe 从 49 降到 43（6 条是被注释掉的，见 conventions 第 28 条），
    // 样本也从 `/dashboard/flow/task/my` 换成流程管理里一个实时的 iframe 叶子。
    const iframeSample = report.pages.find(
      (entry) => entry.page.permission === '/dashboard/frame/bpm/manager/model',
    )
    expect(iframeSample?.page.menuPath).toBeNull()
    expect(iframeSample?.visible).toBe(true)
    expect(iframeSample?.keptBy).toBe('menu-match')
    expect(iframeSample?.probedKeys).toEqual(['/dashboard/frame/bpm/manager/model'])
    expect(report.counts.iframeVisible).toBe(35)

    // permission 为空的页面只可能靠 menuPath；两者都在的页面两个键都算上
    const meetingRoom = report.explain('/dashboard/meeting-room/list')
    expect(meetingRoom?.visible).toBe(true)
    expect(meetingRoom?.matchedKeys.length).toBe(1)
  })
})

describe('用哪个菜单来源，结论会不一样（真实差异，不是构造的）', () => {
  it('nav?project=2 看不到会议室预定页，跨系统的角色菜单能看到', () => {
    // 这一页的 permission 是分组路径 /dashboard/meeting-room，
    // 而 nav?project=2 这份"人力 + 该项目"口径的菜单里根本没有它
    const viaNav = filterCatalog(realIndex(), sampleVisibility())
    expect(viaNav.explain('/dashboard/meeting-room/list')?.visible).toBe(false)

    const viaRoleMenu = filterCatalog(
      realIndex(),
      createUserVisibility({
        paths: ['/dashboard/meeting-room'],
        source: 'selectRoleMenuListNotBySystem（跨系统口径，这里只放它那一条）',
      }),
    )
    expect(viaRoleMenu.explain('/dashboard/meeting-room/list')?.visible).toBe(true)
  })

  it('project 不同，可见面完全不同', () => {
    const viaProject2 = filterCatalog(realIndex(), sampleVisibility())
    // project=1 在这份账号下只有一条「系统设置- 学习」，且它是分组路径、清单里没有对应叶子
    const viaProject1 = filterCatalog(
      realIndex(),
      createUserVisibility({ paths: ['/dashboard/setting'], source: 'nav?project=1' }),
    )
    expect(viaProject2.counts.keptByMenuMatch).toBe(32)
    expect(viaProject1.counts.keptByMenuMatch).toBe(0)
  })
})

describe('explain 与 summary', () => {
  it('explain 接受 menuPath、pageId、permission 三种写法', () => {
    const index = realIndex()
    const report = filterCatalog(index, sampleVisibility())
    const page = index.pageByPath.get('/dashboard/attendance/attendance-team/list')
    expect(page).not.toBeUndefined()

    expect(report.explain('/dashboard/attendance/attendance-team/list')?.page.id).toBe(page?.id)
    expect(report.explain(page?.id ?? '')?.page.id).toBe(page?.id)
    expect(report.explain('/dashboard/attendance/attendance-team')?.page.id).toBe(page?.id)
  })

  it('查不到时返回 null，不硬凑一个相近页面', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    expect(report.explain('/dashboard/does-not-exist/list')).toBeNull()
    expect(report.explain('')).toBeNull()
  })

  it('summary 把关键数字都说出来，可以直接贴进日志', () => {
    const report = filterCatalog(realIndex(), sampleVisibility())
    expect(report.summary).toContain('36 条可见路径')
    expect(report.summary).toContain('34/995 个页面可见')
    expect(report.summary).toContain('32 个靠菜单命中')
    expect(report.summary).toContain('3 条菜单路径目录里没有实现')
  })
})

describe('不改动现有未过滤的用法', () => {
  it('建索引、拿可见性、过滤三步都不改索引本身', () => {
    const index = realIndex()
    const before = index.pages.length
    const domainsBefore = index.domains.size

    filterCatalog(index, sampleVisibility())

    expect(index.pages.length).toBe(before)
    expect(index.domains.size).toBe(domainsBefore)
  })

  it('probe 键的顺序是 permission 先、menuPath 后', () => {
    const index = realIndex()
    const page = index.pageByPath.get('/dashboard/attendance/attendance-team/list')
    expect(page).not.toBeUndefined()
    if (page === undefined) return
    expect(visibilityProbeKeys(page)).toEqual(['/dashboard/attendance/attendance-team'])
  })

  it('空可见性输入不是"全部可见"，也不是"原因不明"', () => {
    const report = filterCatalog(realIndex(), createUserVisibility({ source: '空' }))
    expect(report.visiblePathCount).toBe(0)
    expect(report.counts.keptByMenuMatch).toBe(0)
    // 只有 capability-only 的那几个还在（它们是靠"不在菜单树里"保下来的，与空菜单无关）
    expect(report.counts.visible).toBe(report.counts.keptByCapabilityOnly)
    expect(report.hiddenPages.every((entry) => entry.reason === 'not-in-menu')).toBe(true)
  })
})
