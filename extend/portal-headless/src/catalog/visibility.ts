/**
 * 能力目录的可见性过滤（设计 D8 / F18 / F19 / H36 / D34 / Q117）。
 *
 * 解决的问题：目录是全量的（1,019 行），但 AI 只能调得动**当前用户有权限的那些页面**。
 * 全量下发会让 AI 看到"目录里说有、实际 403"的条目，失败原因还很难查。
 * D8 的口径是：下发的应该是"当前用户可见的菜单"。
 *
 * ## 可见性从哪来
 *
 * 后端本来就有这个接口（F18）：`GET /admin-api/sys/menu/nav?project=` 返回**按当前用户
 * 过滤的菜单树**（`SysMenuDTO extends TreeNode`）。本模块只消费它的 `data`，不发请求。
 * 同族的还有 `menuListNotBySystem`、`selectRoleMenuListNotBySystem`、
 * `select-role-menu-by-tenant?useSystem=`——后者是跨系统、跨项目的那一份。
 *
 * ## 实测事实（2026-09-20，测试环境，夹具 baseline/menu-nav.sample.json）
 *
 * 这三条决定了匹配算法该怎么做，都是抓真实响应量出来的，不是从代码推的：
 *
 * 1. **菜单节点的 `url` 恒为 null，页面路径落在 `permissions` 里。**
 *    57 个节点里 `url` 有值的是 0 个。所以"用 url 去对 menuPath"这条路根本走不通。
 * 2. **`permissions` 与目录的 `permission` 字段是同一套路径**，这才是能对上的连接键。
 *    拿目录全量 1,019 行量：
 *      - 985 行的 `permission` 是路径形态
 *      - 与用户菜单树的路径**逐字符相同**的 816 行（82.8%）
 *      - 再叠上 `/dashboard/platform-v2` ↔ `/dashboard/platform` 这一代路径改名后 907 行（92.1%）
 *      - `menuPath` 或 `permission` 命中其一的 912 行（占全部 1,019 行的 89.5%）
 *    只用 `menuPath` 去对，覆盖率只有 648/970（66.8%）——**差的那 20 多个点是白丢的**。
 * 3. **`permissions` 在真实数据里从不是逗号分隔的**（DTO 注释说"多个用逗号分隔"，
 *    但抓到的 2,848 个节点里逗号出现 0 次）。它要么是一条页面路径（`/dashboard/...`），
 *    要么是一个权限码（`hr:module:approval`）。本模块只认路径形态的。
 *
 * 第 3 条里的"权限码"这一支，实测**对本目录完全无用**，所以本模块不提供"按权限码匹配"的入口：
 * 目录 985 个非空 `permission` 里没有一个是不带 `/` 的码；菜单侧 1,265 个码形态节点
 * （这些是按钮级操作，如 `查询` / `分配保存`）与目录的 `permission` 和 `menuPath` 交集都是 0。
 * 那是 H9 说的第二套权限，管的是"能不能点这个按钮"，不是"能不能看到这个页面"。
 *
 * ## H36 说的三种边界，各自怎么处理
 *
 * - **菜单里没有、但确实是能力**（`capability-only`，例如流程表单 `/simple/hr/form/033`）：
 *   **不杀**。D9 已经定过，流程表单不在菜单树里是设计如此，它从「发起流程」页逐级下钻到达。
 *   按菜单过滤会把它整批误杀。默认保留，`keepCapabilityOnly: false` 可关掉。
 * - **菜单里有、但目录里没有实现**：不是过滤问题，是**覆盖缺口**。单独列成 `menuOnlyPaths`，
 *   声明成菜单叶子（不是已命中路径的祖先）的那些才算，否则会被"分组节点"灌满。
 * - **iframe 叶子**：目录里 `menuPath` 为 null（49 行），**只有 `permission` 能匹配**——
 *   凡是用 `menuPath` 当唯一连接键的实现都会把这 49 个整批误判成不可见。
 *   它们留在目录里（用户确实看得到），但 `callable: false`：D3 把外部系统排除在外，
 *   无头只能告诉 AI "这一步需要跳转"。
 *
 * ## F18/F19：两件事不能混
 *
 * - **权限不足**（`reason: 'not-in-menu'`）是过滤的原因：用户在菜单里看不到这个页面。
 * - **算不出 module-type**（`moduleType.resolvable: false`）**不是过滤原因**。F19 已经查证：
 *   42% 的页面在浏览器里本来就算不出值，前端此时的正确行为就是**不发这个头**（D34）。
 *   两者写在同一份结果里，但字段分开，`reason` 永远不会因为 module-type 而置位。
 *
 * 本模块是**纯读**：不发请求、不落盘、不改任何状态；也不改动 `src/catalog/` 的现有 API。
 */

import { resolveModuleType } from '../context/module-type.js'
import type { CatalogIndex } from './catalog-index.js'
import type { CatalogPage } from './types.js'

/* ------------------------------------------------------------------ 菜单树 */

/**
 * 菜单树的一个节点。
 *
 * 字段全部可空，因为它是**后端响应**的形状，不是 SDK 自己造的类型：真机上
 * `url` / `sort` / `parentName` / `icon` 都出现过 null，`children` 出现过空数组。
 * 只声明本模块真正读的字段；多出来的字段不影响解析。
 */
export type MenuNode = {
  id?: string | number | null
  pid?: string | number | null
  name?: string | null
  /** 实测恒为 null；这里留着是为了不把响应里的字段"吃掉" */
  url?: string | null
  /** 0 = 菜单，1 = 按钮 */
  menuType?: number | null
  /** 1 人力 2 财务 3 物 4 产 5 供 6 销 */
  useSystem?: number | null
  /** 1 学习型组织能力建设，2 人力绩效项目 */
  project?: number | null
  /** **页面路径就存在这里**（见文件头实测事实 1） */
  permissions?: string | null
  children?: MenuNode[] | null
}

/**
 * 用户可见性输入。
 *
 * `menuTree` 与 `paths` 二选一或并用：前者是后端原样返回的树，后者是调用方已经摊平好的
 * 路径集合（例如从别的接口、或从缓存里拿的）。两者都会过同一套归一化。
 */
export type UserVisibilityInput = {
  /** `GET /admin-api/sys/menu/nav?project=` 的 `data`，或同族接口的 `data` */
  menuTree?: MenuNode[] | null
  /** 用户可见的菜单路径（`/` 开头的绝对路径） */
  paths?: Iterable<string>
  /** 这份可见性的来源（例如 `menu-nav?project=2`）。写进结果，便于诊断。 */
  source: string
}

/* ------------------------------------------------------------------ 归一化 */

/**
 * 归一化可见性键。
 *
 * 三步，每一步都对应一条实测差异（见文件头）：
 * 1. 去掉 query——H36 记过 11 条路径靠 query 区分两个菜单项，但那是**同一页面**的两个入口，
 *    可见性判定上不该分开。
 * 2. 去掉结尾的 `/list`——菜单树存的是 `/dashboard/attendance/attendance-team`，
 *    而页面清单的 `menuPath` 是 `/dashboard/attendance/attendance-team/list`。
 * 3. `platform-v2` → `platform`——同一批页面的两代路径，实测差 20 个百分点。
 */
export function normalizeVisibilityKey (raw: string): string {
  let key = raw.trim()
  const query = key.indexOf('?')
  if (query > -1) key = key.slice(0, query)
  if (key.endsWith('/list')) key = key.slice(0, -'/list'.length)
  if (key.endsWith('/')) key = key.slice(0, -1)
  key = key.replace(/^\/dashboard\/platform-v2(\/|$)/, '/dashboard/platform$1')
  return key
}

/** 路径形态的 `permissions` 才算页面路径；`hr:module:approval` 这类权限码不算 */
export function isPathLike (value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/')
}

/**
 * 摊平菜单树，收集用户可见的页面路径。
 *
 * 只看 `permissions` 是路径形态的节点（见文件头实测事实 1、3）。
 * `menuType === 1`（按钮）的节点在真实数据里也可能带路径，所以不按它过滤——
 * 多留一条路径只会让判定更宽松，而按 `menuType` 过滤有丢页面的风险。
 */
export function collectVisiblePaths (menuTree: MenuNode[] | null | undefined): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const walk = (nodes: MenuNode[] | null | undefined): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (isPathLike(node.permissions)) {
        const key = normalizeVisibilityKey(node.permissions)
        if (key.length > 0 && !seen.has(key)) {
          seen.add(key)
          keys.push(key)
        }
      }
      walk(node.children)
    }
  }
  walk(menuTree)
  return keys
}

/** 摊平后的用户可见性：归一化后的键集合 + 来源 */
export type UserVisibility = {
  source: string
  /** 归一化后的可见路径 */
  keys: Set<string>
  /** 路径形态的原始值（未归一化），报错时给人看 */
  rawPaths: string[]
}

export function createUserVisibility (input: UserVisibilityInput): UserVisibility {
  const rawPaths: string[] = []
  const keys = new Set<string>()

  const add = (value: string): void => {
    const trimmed = value.trim()
    if (!isPathLike(trimmed)) return
    rawPaths.push(trimmed)
    keys.add(normalizeVisibilityKey(trimmed))
  }

  if (Array.isArray(input.menuTree)) {
    const walk = (nodes: MenuNode[] | null | undefined): void => {
      if (!Array.isArray(nodes)) return
      for (const node of nodes) {
        if (isPathLike(node.permissions)) add(node.permissions)
        walk(node.children)
      }
    }
    walk(input.menuTree)
  }
  if (input.paths !== undefined) {
    for (const path of input.paths) add(path)
  }

  return { source: input.source, keys, rawPaths }
}

/* ------------------------------------------------------------------ 单页判定 */

/**
 * 一条目录页面"拿什么去和菜单比"。
 *
 * 顺序是**实测出来的**，不是拍脑袋：`permission` 先（985 行里 816 行逐字符相同），
 * `menuPath` 后（归一化后补上剩下的）。两个都探，命中任意一个即可见。
 */
export function visibilityProbeKeys (page: CatalogPage): string[] {
  const keys: string[] = []
  const push = (value: string | null | undefined): void => {
    if (!isPathLike(value)) return
    const key = normalizeVisibilityKey(value)
    if (key.length > 0 && !keys.includes(key)) keys.push(key)
  }
  push(page.permission)
  push(page.menuPath)
  return keys
}

/** 判定结果里的模块上下文。与可见性无关（F19），单独给，便于调用方自己决定怎么用。 */
export type ModuleTypeNote = {
  /** 要发给后端的值；null = 浏览器也不发这个头（D34） */
  value: number | null
  label: string | null
  /** false = 规则表里没有这一页（实测全量的 42%），此时正确行为是不发这个头 */
  resolvable: boolean
}

export type PageVisibility = {
  page: CatalogPage
  visible: boolean
  /** `visible` 为 true 的原因 */
  keptBy?: 'menu-match' | 'capability-only'
  /**
   * `visible` 为 false 的原因。
   * **只表达"权限/开通不足"**（F18）；module-type 算不出来在 `moduleType` 里，
   * 不会让它置位（F19）。
   */
  reason?: 'not-in-menu'
  /** 命中了哪些用户可见路径 */
  matchedKeys: string[]
  /** 这次拿哪些键去比过——没命中时给出，避免只能靠猜 */
  probedKeys: string[]
  /** 能不能被无头调用。iframe 叶子为 false（D3） */
  callable: boolean
  /** `callable` 为 false 的原因 */
  notCallableBecause?: 'iframe'
  moduleType: ModuleTypeNote
}

export type FilterOptions = {
  /**
   * 保留 `capability-only` 页面（菜单树里没有、只有能力定义引用的那些）。
   * 默认 `true`——H36 + D9：流程表单不在菜单树里是设计如此，按菜单过滤会误杀它们。
   */
  keepCapabilityOnly?: boolean
}

function moduleTypeNoteFor (page: CatalogPage): ModuleTypeNote {
  const path = page.menuPath
  if (path === null || path.length === 0) {
    return { value: null, label: null, resolvable: false }
  }
  const resolution = resolveModuleType(path)
  return {
    value: resolution.moduleType,
    label: resolution.label,
    resolvable: resolution.moduleType !== null,
  }
}

function evaluatePage (
  page: CatalogPage,
  visibility: UserVisibility,
  keepCapabilityOnly: boolean,
): PageVisibility {
  const probedKeys = visibilityProbeKeys(page)
  const matchedKeys = probedKeys.filter((key) => visibility.keys.has(key))
  const isIframe = page.kind === 'iframe 嵌入外部系统'
  const moduleType = moduleTypeNoteFor(page)

  const base = {
    page,
    matchedKeys,
    probedKeys,
    callable: !isIframe,
    ...(isIframe ? { notCallableBecause: 'iframe' as const } : {}),
    moduleType,
  }

  if (matchedKeys.length > 0) return { ...base, visible: true, keptBy: 'menu-match' }

  if (page.source === 'capability-only' && keepCapabilityOnly) {
    return { ...base, visible: true, keptBy: 'capability-only' }
  }

  return { ...base, visible: false, reason: 'not-in-menu' }
}

/* ------------------------------------------------------------------ 报告 */

export type VisibilityCounts = {
  /** 目录里的页面总数（含 capability-only、含 iframe）。比清单行数多出 capability-only 的那些 */
  totalPages: number
  /** = keptByMenuMatch + keptByCapabilityOnly */
  visible: number
  hidden: number
  /** 真正在用户菜单里对上了路径的页面数 */
  keptByMenuMatch: number
  /** 菜单里没有、靠 `capability-only` 保下来的 */
  keptByCapabilityOnly: number
  /** 可见的 iframe 叶子（看得到，但只能跳转） */
  iframeVisible: number
  /** 被过滤掉的 iframe 叶子 */
  iframeHidden: number
  /** 菜单里有、目录里没有实现的页面路径数 */
  menuOnly: number
}

export type VisibilityReport = {
  /** 可见性来源，原样回传 */
  source: string
  /** 归一化后的可见路径数 */
  visiblePathCount: number
  /** 明细里的可见路径（归一化后），便于调用方缓存或做审计 */
  visiblePaths: string[]
  /** 只含可见页面，顺序与 `index.pages` 一致 */
  visiblePages: CatalogPage[]
  /** 被过滤掉的页面及其原因 */
  hiddenPages: PageVisibility[]
  /** 全部页面的判定，未过滤的视图（`pages` 与 `index.pages` 一一对应） */
  pages: PageVisibility[]
  /** H36 边界一：菜单里没有、但确实是能力的页面 */
  capabilityOnlyPages: PageVisibility[]
  /** H36 边界三：菜单里有、但只能跳转的 iframe 叶子 */
  iframePages: PageVisibility[]
  /**
   * H36 边界二：菜单里有、目录里没有实现的路径。
   *
   * 只列**声明成菜单叶子**的那些：已被目录覆盖路径的祖先（分组节点）不算，
   * 否则会被 `/dashboard/report`、`/dashboard/attendance` 这类分组灌满。
   */
  menuOnlyPaths: string[]
  counts: VisibilityCounts
  /** 按页面引用查单条判定：接受 pageId / menuPath / permission 值 */
  explain: (pageRef: string) => PageVisibility | null
  /** 给人看的一句话，直接可以贴进日志 */
  summary: string
}

function resolvePageRef (report: { pages: PageVisibility[] }, pageRef: string): PageVisibility | null {
  const raw = pageRef.trim()
  if (raw.length === 0) return null
  const keys = new Set([raw, normalizeVisibilityKey(raw)])
  for (const entry of report.pages) {
    if (entry.page.id === raw) return entry
    if (entry.page.menuPath !== null && keys.has(entry.page.menuPath)) return entry
    if (entry.page.permission !== '' && keys.has(entry.page.permission)) return entry
    for (const key of entry.probedKeys) {
      if (keys.has(key)) return entry
    }
  }
  return null
}

/**
 * 按用户可见性过滤目录。
 *
 * 输入是 `buildIndex()` 的索引与一份 `UserVisibility`，输出是一份可解释的报告——
 * 不修改索引本身，也不缓存，与 `src/catalog/` 的现有 API 完全无耦合（没接线的调用方
 * 行为一个字都不变）。
 */
export function filterCatalog (
  index: CatalogIndex,
  visibility: UserVisibility,
  options: FilterOptions = {},
): VisibilityReport {
  const keepCapabilityOnly = options.keepCapabilityOnly ?? true
  const pages = index.pages.map((page) => evaluatePage(page, visibility, keepCapabilityOnly))

  const visiblePages: CatalogPage[] = []
  const hiddenPages: PageVisibility[] = []
  const capabilityOnlyPages: PageVisibility[] = []
  const iframePages: PageVisibility[] = []
  for (const entry of pages) {
    if (entry.visible) visiblePages.push(entry.page)
    else hiddenPages.push(entry)
    if (entry.page.source === 'capability-only') capabilityOnlyPages.push(entry)
    if (entry.page.kind === 'iframe 嵌入外部系统') iframePages.push(entry)
  }

  // 被目录覆盖的路径：命中的键 + 它们的全部祖先。祖先要一起算进来，
  // 否则菜单里的分组节点会被当成"菜单里有、目录里没有"。
  const covered = new Set<string>()
  for (const entry of pages) {
    for (const key of entry.matchedKeys) {
      covered.add(key)
      const segments = key.split('/')
      for (let i = 2; i < segments.length; i++) {
        covered.add(segments.slice(0, i).join('/'))
      }
    }
  }
  const menuOnlyPaths = [...visibility.keys].filter((key) => !covered.has(key)).sort()

  const counts: VisibilityCounts = {
    totalPages: pages.length,
    visible: visiblePages.length,
    hidden: hiddenPages.length,
    keptByMenuMatch: pages.filter((entry) => entry.keptBy === 'menu-match').length,
    keptByCapabilityOnly: pages.filter((entry) => entry.keptBy === 'capability-only').length,
    iframeVisible: iframePages.filter((entry) => entry.visible).length,
    iframeHidden: iframePages.filter((entry) => !entry.visible).length,
    menuOnly: menuOnlyPaths.length,
  }

  const report: VisibilityReport = {
    source: visibility.source,
    visiblePathCount: visibility.keys.size,
    visiblePaths: [...visibility.keys].sort(),
    visiblePages,
    hiddenPages,
    pages,
    capabilityOnlyPages,
    iframePages,
    menuOnlyPaths,
    counts,
    explain: (pageRef: string) => resolvePageRef({ pages }, pageRef),
    summary:
      `可见性来源「${visibility.source}」：${visibility.keys.size} 条可见路径 → ` +
      `${counts.visible}/${counts.totalPages} 个页面可见` +
      `（${counts.keptByMenuMatch} 个靠菜单命中，${counts.keptByCapabilityOnly} 个是菜单里没有的能力页），` +
      `${counts.hidden} 个被过滤，${counts.iframeVisible} 个 iframe 只可跳转，` +
      `另有 ${counts.menuOnly} 条菜单路径目录里没有实现`,
  }

  return report
}
