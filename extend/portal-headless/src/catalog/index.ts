import { CONTRACT_TEMPLATE_CONTENT_SCHEMA } from './contract-template-schema.js'
/**
 * 能力目录与检索（设计 D8 / D11 / D14 / D24）。
 *
 * 这一层解决的问题：**AI 怎么知道该调哪个页面、调完拿到数据之后又该去哪。**
 * 目录有 1,019 个页面（D24 的「页面唯一参考清单」），一次性塞进上下文会撑爆，
 * 所以它是分层的、可以渐进索要的：
 *
 * ```text
 * listDomains()            业务域        ← 总目录
 *   └─ listPages(domain)   页面          ← 模块
 *        └─ describePage(pageId)  页面能力  ← 页面能力
 *             └─ describe(capabilityId)  `-llm` 协议（怎么调 / 参数 / 返回 / 下一步）
 * ```
 *
 * 另外两条入口：
 * - `search(keyword)` —— 按标题/路径/能力名/参数名宽容匹配，结果带"为什么命中"（H22）
 * - `recommend(text)` —— 用户话术 → 能力/页面（D11：推荐由 SDK 提供，不复用 Portal intent）
 *
 * 用法（主会话接线时）：
 * ```ts
 * const catalog = createCatalog({ capabilities: portal.capabilities })
 * catalog.listDomains()          // → 44 个业务域
 * catalog.recommend('帮我订个会议室')
 * ```
 *
 * 所有函数都是**纯读**：不发请求、不落盘、不改任何状态。
 *
 * ## 可见性收敛（D8）——**显式的一层，不是自动行为**
 *
 * `withVisibility(visibility)` 给出这份目录的**子集视图**：那些不在用户可见菜单里的页面
 * （及其能力）从 `listDomains` / `listPages` / `search` / `recommend` / `describe` 上一起消失。
 * 三个关键取向：
 *
 * 1. **不自动生效**。菜单树不是权限裁决（conventions 第 15 条：实测有"不在菜单里但可调"的能力），
 *    把过滤塞进每次 `describe`/`search` 里就等于**把能用的藏起来**。这里只提供入口，
 *    由调用方（门面的 `visibleCatalog()`，或自己拿菜单树的调用方）决定用不用。
 * 2. **单用户 / 多用户都不共享这份视图**。可见性是 per-(用户, 租户, 项目) 的，
 *    而 `Catalog` 在多用户门面里是服务级共享的静态数据；视图是**新建的一份**，
 *    `withVisibility` 不改原索引、也不缓存（同 `getMenuNav` 的缓存键必须带 `project` 那个坑）。
 * 3. **收敛 ≠ 拦住**。视图里没有的能力，在未过滤的目录与 `sdk.capabilities.invoke()` 上照旧可调；
 *    `describe()` 在视图里没命中时给的理由也会**说清这一点**，而不是谎称"目录里没有"。
 *
 * 菜单树从哪来、拿不到怎么办：见 `visibleCatalogFrom()` 与 `src/catalog/README.md`。
 */

import { meetingApplicationCapabilities } from '../capabilities/meeting-application.js'
import { meetingRoomCapabilities } from '../capabilities/meeting-room.js'
import type { CapabilityDefinition } from '../capabilities/types.js'
import { DOMAIN_LABELS } from './aliases.js'
import { buildIndex, type CatalogIndex, type DomainBucket } from './catalog-index.js'
import { describe } from './describe.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from './ai-contracts.js'
import { sdkPathOf } from '../capabilities/invoke.js'
import type { AiContract } from './ai-contract.js'
import { describePage, listDomains, listPages } from './list.js'
import { loadPageCatalog } from './page-catalog.js'
import { recommend, type RecommendOptions } from './recommend.js'
import { search, type SearchOptions } from './search.js'
import {
  createUserVisibility,
  filterCatalog,
  type FilterOptions,
  type MenuNode,
  type UserVisibility,
  type VisibilityReport,
} from './visibility.js'
import {
  validateAliases,
  validateLinks,
  validateLookups,
  type AliasIssue,
  type LinkIssue,
  type LookupIssue,
} from './validate.js'
import type {
  CatalogPage,
  DescribeMiss,
  DescribeResult,
  DomainList,
  DomainListOptions,
  GeneratedPageRow,
  PageDescription,
  PageList,
  Recommendation,
  SearchResult,
} from './types.js'

export type CreateCatalogOptions = {
  /**
   * 已注册的能力定义。传 `portal.capabilities`，让目录与真正能调的能力**天然一致**——
   * 目录说得到、调不到的条目比没有目录更糟。
   */
  capabilities: CapabilityDefinition[]
  /** 页面清单。不传则读 `generated/page-catalog.json` */
  rows?: GeneratedPageRow[]
  generatedAt?: string
}

export type Catalog = {
  describeSchema: (id: string) => { ok: true; id: string; schema: typeof CONTRACT_TEMPLATE_CONTENT_SCHEMA } | { ok: false; id: string; reason: string }
  /** Contracts for public business methods which have no capability registration. Pure metadata, never invokes them. */
  describeMethod: (sdkPath: string) => { ok: true; sdkPath: string; ai: AiContract; capabilityId: string | null } | { ok: false; reason: string }
  listMethods: () => Array<{ sdkPath: string; purpose: string; effect: AiContract['effect'] }>
  /** 索引本身，用于诊断（清单生成时间、页面数、能力数、能力 ID 冲突） */
  readonly index: CatalogIndex
  /** `{ detail: false }` = 减重版（G9）：不逐个域给 `next` 与 `kinds` */
  listDomains: (options?: DomainListOptions) => DomainList
  listPages: (domain: string) => PageList
  describePage: (pageId: string) => PageDescription
  search: (keyword: string, options?: SearchOptions) => SearchResult
  recommend: (text: string, options?: RecommendOptions) => Recommendation
  /** `-llm` 协议（D14）。也接受 `xxx-llm` 这种写法 */
  describe: (capabilityId: string) => DescribeResult
  /** 自检人工维护的数据表是否有死链（含能力定义里 `lookup` 声明的候选入口） */
  validate: () => { aliases: AliasIssue[]; links: LinkIssue[]; lookups: LookupIssue[] }
  /**
   * 按用户可见性给出这份目录的**子集视图**（设计 D8 / F18 / H36）。
   *
   * **纯函数**：不发请求、不改原目录、不缓存。菜单树从哪来由调用方负责
   * （门面那条路见 `visibleCatalogFrom()`），所以这一层仍然是"纯读"的。
   *
   * 在**视图**上再调一次 = 在视图的可见面上继续收窄（返回的是新的一份，前面的不受影响）。
   */
  withVisibility: (visibility: UserVisibility, options?: FilterOptions) => VisibilityScopedCatalog
}

/** `Catalog.withVisibility()` 的返回：收敛后的目录 + 它为什么是这样 */
export type VisibilityScopedCatalog = {
  /** 只含可见页面（及其能力）的目录视图，各入口与全量目录签名完全一致 */
  catalog: Catalog
  /** 逐页判定、被收敛掉的那些、以及 `menuOnlyPaths` 等边界（`summary` 可直接贴日志） */
  report: VisibilityReport
}

/** 构造 `Catalog` 的内部骨架：索引由 `index()` 懒给 —— 全量与视图共用这一份实现 */
type CatalogHooks = {
  /** `validate()` 打在哪个索引上。缺省与 `index` 相同；**视图**要指回全量索引（见下） */
  validateOn?: () => CatalogIndex
  /** `describe()` 未命中时的补充解释（视图用它把"不在可见面内"和"目录里没有"分开） */
  describeFallback?: (miss: DescribeMiss, capabilityId: string) => DescribeResult
}

function catalogOver (index: () => CatalogIndex, hooks: CatalogHooks = {}): Catalog {
  const validateOn = hooks.validateOn ?? index
  return {
    get index () {
      return index()
    },
    describeSchema: (id: string) => id === 'contract-template-content' ? { ok: true, id, schema: structuredClone(CONTRACT_TEMPLATE_CONTENT_SCHEMA) } : { ok: false, id, reason: '不存在此结构说明' },
    listMethods: () => Object.entries(METHOD_CONTRACTS).map(([sdkPath, ai]) => ({ sdkPath, purpose: ai.purpose, effect: ai.effect })),
    describeMethod: (sdkPath: string) => {
      const path = sdkPath.replace(/^sdk\./, '')
      const direct = METHOD_CONTRACTS[path]
      if (direct !== undefined) return { ok: true, sdkPath: path, ai: direct, capabilityId: null }
      const capability = index().capabilities.find(c => sdkPathOf(c.id) === path)
      const ai = capability === undefined ? undefined : AI_CONTRACTS[capability.id]
      return ai === undefined ? { ok: false, reason: `SDK方法 ${path} 没有描述契约；不能猜测调用签名。` } : { ok: true, sdkPath: path, ai, capabilityId: capability!.id }
    },
    listDomains: (domainOptions?: DomainListOptions) => listDomains(index(), domainOptions),
    listPages: (domain: string) => listPages(index(), domain),
    describePage: (pageId: string) => describePage(index(), pageId),
    search: (keyword: string, searchOptions?: SearchOptions) => search(index(), keyword, searchOptions),
    recommend: (text: string, recommendOptions?: RecommendOptions) =>
      recommend(index(), text, recommendOptions),
    describe: (capabilityId: string) => {
      const result = describe(index(), capabilityId)
      if (result.ok || hooks.describeFallback === undefined) return result
      return hooks.describeFallback(result, capabilityId)
    },
    // 自检针对的是**静态数据表**（别名 / 链接 / lookup 死链），与"某个用户能不能看到某个页面"
    // 无关。所以视图里的 validate() 仍然打在全量索引上——打在子集上会凭空报一堆死链，
    // 把真实的数据问题淹掉。
    validate: () => ({
      aliases: validateAliases(validateOn()),
      links: validateLinks(validateOn()),
      lookups: validateLookups(validateOn()),
    }),
    withVisibility: (visibility: UserVisibility, options?: FilterOptions) =>
      scopeCatalog(index(), visibility, options),
  }
}

export function createCatalog (options: CreateCatalogOptions): Catalog {
  let cachedIndex: CatalogIndex | null = null

  const index = (): CatalogIndex => {
    if (cachedIndex !== null) return cachedIndex
    const catalog = loadPageCatalog()
    cachedIndex = buildIndex({
      rows: options.rows ?? catalog.items,
      capabilities: options.capabilities,
      generatedAt: options.generatedAt ?? catalog.generatedAt,
    })
    return cachedIndex
  }

  return catalogOver(index)
}

/* ------------------------------------------------------------------ 可见性视图 */

/**
 * 在**全量索引**上裁出一份「只含可见页面」的索引。
 *
 * 为什么是"重建索引"而不是"在每次查询上打补丁"：目录的三层下钻、搜索、推荐、`describe`
 * 全是索引驱动的（`list.ts` / `describe.ts` / `search.ts` / `recommend.ts`）。重建一次，
 * 这几条入口**同时**收敛，不必逐个去改它们——本单那四个文件一个字都没动。
 */
function scopeIndex (index: CatalogIndex, report: VisibilityReport): CatalogIndex {
  const pages: CatalogPage[] = []
  for (const entry of report.pages) {
    if (!entry.visible) continue
    // 浅拷贝一层：`capabilityIds` 下面要按视图重算，而它是数组——
    // 直接在全量索引的页面对象上改，会把**别人看到的**那份也改掉。
    pages.push({ ...entry.page, capabilityIds: [] })
  }

  const pageById = new Map<string, CatalogPage>()
  const pageByPath = new Map<string, CatalogPage>()
  for (const page of pages) {
    pageById.set(page.id, page)
    if (page.menuPath !== null && page.menuPath.length > 0) pageByPath.set(page.menuPath, page)
  }

  // 能力跟着页面走：**任一** `pagePath` 可见就留着。
  // 取"任一"而不是"全部"，是因为误杀一个还调得动的能力，比多留一条更糟（conventions 第 15 条）。
  const capabilities = index.capabilities.filter((capability) =>
    capability.pagePaths.some((pagePath) => pageByPath.has(pagePath)),
  )
  const capabilityById = new Map(capabilities.map((capability) => [capability.id, capability] as const))

  const pathToCapabilities = new Map<string, string[]>()
  for (const capability of capabilities) {
    for (const pagePath of capability.pagePaths) {
      if (!pageByPath.has(pagePath)) continue
      const ids = pathToCapabilities.get(pagePath)
      if (ids === undefined) pathToCapabilities.set(pagePath, [capability.id])
      else if (!ids.includes(capability.id)) ids.push(capability.id)
    }
  }
  for (const page of pages) {
    if (page.menuPath === null) continue
    page.capabilityIds = pathToCapabilities.get(page.menuPath) ?? []
  }

  // 域分桶与 `buildIndex` 同一套口径：页面归域，能力跟着它的页面进域
  const domains = new Map<string, DomainBucket>()
  const bucketOf = (domain: string): DomainBucket => {
    const existing = domains.get(domain)
    if (existing !== undefined) return existing
    const created: DomainBucket = {
      domain,
      label: DOMAIN_LABELS[domain] ?? domain,
      pages: [],
      capabilities: [],
    }
    domains.set(domain, created)
    return created
  }
  for (const page of pages) bucketOf(page.domain).pages.push(page)
  for (const capability of capabilities) {
    const seen = new Set<string>()
    for (const pagePath of capability.pagePaths) {
      const page = pageByPath.get(pagePath)
      if (page === undefined || seen.has(page.domain)) continue
      seen.add(page.domain)
      bucketOf(page.domain).capabilities.push(capability)
    }
  }

  return {
    generatedAt: index.generatedAt,
    pages,
    pageById,
    pageByPath,
    capabilities,
    capabilityById,
    domains,
    duplicateCapabilityIds: index.duplicateCapabilityIds.filter((id) => capabilityById.has(id)),
    capabilityOnlyPagePaths: index.capabilityOnlyPagePaths.filter((path) => pageByPath.has(path)),
  }
}

/**
 * 视图里 `describe()` 没命中时，把理由换成**准确的那一条**。
 *
 * 全量索引里明明有这个能力，视图里没有，只是因为它的页面不在这个可见面内。
 * 这时候直接回 `describe.ts` 那句「目录里没有能力「x」」就是**说假话**，
 * 而且会把调用方引向"去注册这个能力"的错误方向。返回 `null` = 真的是目录里没有，原样回。
 */
function outsideVisibilityReason (index: CatalogIndex, capabilityId: string): string | null {
  const raw = capabilityId.trim()
  const stripped = raw.endsWith('-llm') ? raw.slice(0, -'-llm'.length) : raw
  const capability =
    index.capabilityById.get(stripped) ??
    index.capabilityById.get(raw) ??
    [...index.capabilities.values()].find((candidate) => candidate.id.toLowerCase() === stripped.toLowerCase())
  if (capability === undefined) return null

  return (
    `能力「${capability.id}」在目录里，但它所在的页面（${capability.pagePaths.join('、')}）` +
    '不在这次的可见菜单口径内，所以它没有出现在这份视图里。' +
    '**这只是下发面收敛，不是权限裁决**（conventions 第 15 条：实测有"不在菜单里但可调"的能力）：' +
    '该能力可能仍然可调——未过滤的目录在 `portal.catalog`，执行入口在 `sdk.capabilities.invoke()`。'
  )
}

function scopeCatalog (
  index: CatalogIndex,
  visibility: UserVisibility,
  options: FilterOptions | undefined,
): VisibilityScopedCatalog {
  const report = filterCatalog(index, visibility, options ?? {})

  // 视图懒建一次：只要 report 的调用方不必付这份拷贝的钱
  let scoped: CatalogIndex | null = null
  const scopedIndex = (): CatalogIndex => {
    if (scoped === null) scoped = scopeIndex(index, report)
    return scoped
  }

  return {
    catalog: catalogOver(scopedIndex, {
      validateOn: () => index,
      describeFallback: (miss, capabilityId) => {
        const reason = outsideVisibilityReason(index, capabilityId)
        return reason === null ? miss : { ...miss, reason }
      },
    }),
    report,
  }
}

/* ------------------------------------------------------------------ 门面用：取菜单 + 收敛 */

/** `sys/menu/nav` 的返回形状（`baseShell.getMenuNav()` 的返回值，结构上就满足它） */
export type MenuTreeResult = {
  project: number
  /** 后端原样返回的树，结构兼容 `visibility.ts` 的 `MenuNode` */
  tree: MenuNode[]
  /** 完整树的节点数 */
  totalNodes: number
  /** 这次真的给了多少个 */
  returnedNodes: number
  /** true = 树被裁剪过，**不可用于可见性判断** */
  truncated: boolean
}

/**
 * 菜单树的来源。由调用方注入 —— `src/catalog/` 这一层**不发请求**，
 * 门面传进来的是那份会话的 `baseShell.getMenuNav`。
 */
export type MenuTreeSource = (input: { project: number; maxNodes?: number }) => Promise<MenuTreeResult>

export type VisibleCatalogInput = {
  /** 实测：1 = 学习型组织（1 个节点）、2 = 人力绩效（57 个节点）、3 与 0 = 空。必填 */
  project: number
  /** 提上去可以避免大项目被截断（截断 = 失败关闭）。默认 200，硬上限 500 */
  maxNodes?: number
  /** 见 `FilterOptions`。默认 `true`：菜单里没有的能力页（流程表单那类）要保下来 */
  keepCapabilityOnly?: boolean
  /**
   * 菜单树取不到 / 被截断时怎么办。
   *
   * - `'throw'`（默认）：失败关闭，抛 `MenuVisibilityUnavailableError`。
   * - `'unfiltered'`：**显式**降级成未过滤的目录（`applied: false`，`note` 说明原因）。
   */
  onUnavailable?: 'throw' | 'unfiltered'
}

export type VisibleCatalog = {
  /** 收敛后的目录。`applied: false` 时**就是**未过滤的那一份（与 `portal.catalog` 同一个对象） */
  catalog: Catalog
  /** 依据与明细。`applied: false`（显式降级）时为 `null` —— 没有菜单树就没法解释 */
  report: VisibilityReport | null
  /** 过滤是否真的生效 */
  applied: boolean
  /** 降级的原因，直接可贴日志；`applied: true` 时为 `null` */
  note: string | null
}

/** 菜单树取不到 / 被截断，收敛无从谈起时抛它 */
export class MenuVisibilityUnavailableError extends Error {
  override readonly name = 'MenuVisibilityUnavailableError'
  constructor (message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/**
 * `project` 的必填与数值校验。
 *
 * 与 `getMenuNav` 自己那道闸（`src/capabilities/base-shell.ts` 的 `resolveProject`）**同一条规则**：
 * `null` / `undefined` / `''` 必须单独挡掉 —— `Number(null)` 与 `Number('')` 都是 0（有限值），
 * 不挡的话"我漏了参数"会被静默当成 `project=0`（实测返回空树），被读成"这个人一个菜单都没有"。
 *
 * 这里再挡一次的理由是**先于网络失败**：`onUnavailable: 'unfiltered'` 只该兜住"取数失败"，
 * 不该把参数错误一起吞掉 —— 那会静默地不做过滤，正是本模块最想避免的那种错。
 */
function assertMenuProject (project: unknown): number {
  if (project === undefined || project === null || project === '') {
    throw new TypeError(
      'visibleCatalog 的 project 必填（实测：1 = 学习型组织 1 个节点、2 = 人力绩效 57 个节点、3 与 0 = 空）。' +
        '不传时后端按 1 返回，"不传"不等于"全部"',
    )
  }
  const value = Number(project)
  if (!Number.isFinite(value)) {
    throw new TypeError(`visibleCatalog 的 project 必须是数字，收到 ${JSON.stringify(project)}`)
  }
  return Math.trunc(value)
}

function errorText (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 「取这个用户能看到的菜单 → 据此收敛目录」的**唯一实现**，两个门面共用。
 *
 * 分给门面而不是直接做进 `createCatalog`：菜单树要打网络，而 `createCatalog` 是同步的纯函数，
 * 构造期也拿不到（凭据可能还没生效、多用户形态下一份目录服务多个用户）。
 * 所以网络那一步由门面注入（`fetchMenu`），这一层只做"取到之后怎么用、取不到怎么办"。
 *
 * 取不到 / 被截断时**默认失败关闭**，理由见下面两处注释。
 */
export async function visibleCatalogFrom (
  catalog: Catalog,
  fetchMenu: MenuTreeSource,
  input: VisibleCatalogInput,
): Promise<VisibleCatalog> {
  const project = assertMenuProject(input?.project)
  const onUnavailable = input?.onUnavailable ?? 'throw'

  /** 显式降级：把**未过滤的**目录原样交出去，并说清它不是"全部可见" */
  const degraded = (reason: string): VisibleCatalog => ({
    catalog,
    report: null,
    applied: false,
    note:
      `${reason}；按 onUnavailable='unfiltered' 降级为**未过滤的**目录 —— ` +
      '这份视图不代表"你看得到全部"，只是"没替你收窄"。',
  })

  let nav: MenuTreeResult
  try {
    nav = await fetchMenu(
      input?.maxNodes === undefined ? { project } : { project, maxNodes: input.maxNodes },
    )
  } catch (error) {
    const reason = `取不到 project=${project} 的可见菜单树（${errorText(error)}）`
    if (onUnavailable === 'unfiltered') return degraded(reason)
    throw new MenuVisibilityUnavailableError(
      `${reason}。菜单树是收敛下发面的唯一来源，取不到就退不回一份可信的可见面 —— ` +
        '降级成全量属于**静默放大**（调用方看不出这份目录没被收窄过），所以这里失败关闭。' +
        '要用未过滤的目录请显式用 `portal.catalog`：那是调用方自己的选择，不是这里的默认。',
      { cause: error },
    )
  }

  if (nav.truncated) {
    const reason = `可见菜单树被截断（只拿到 ${nav.returnedNodes}/${nav.totalNodes} 个节点）`
    if (onUnavailable === 'unfiltered') return degraded(reason)
    throw new MenuVisibilityUnavailableError(
      `${reason}。截断的树 = 缺节点 = 会把"其实可见"的页面判成不可见（方向是**误杀**，比放大更隐蔽），` +
        '所以这里失败关闭：调大 `maxNodes` 重试（硬上限 500），或显式用 `portal.catalog`。',
    )
  }

  const visibility = createUserVisibility({
    menuTree: nav.tree,
    source: `GET /admin-api/sys/menu/nav?project=${project}（${nav.returnedNodes} 个节点）`,
  })
  const scoped = catalog.withVisibility(
    visibility,
    input?.keepCapabilityOnly === undefined ? {} : { keepCapabilityOnly: input.keepCapabilityOnly },
  )
  return { catalog: scoped.catalog, report: scoped.report, applied: true, note: null }
}

/**
 * 用包内**当前已注册的**能力定义构建的目录。
 *
 * 存在的意义是让本层能独立使用（测试、冒烟脚本），不必先起一个 PortalHeadless。
 * 接入方请优先用 `createCatalog({ capabilities: portal.capabilities })`，
 * 否则这份目录会和实际可调的能力两份分叉（H8 说的"两套数据源靠约定对齐"就是这么坏掉的）。
 */
export const defaultCatalog: Catalog = createCatalog({
  capabilities: [...meetingRoomCapabilities, ...meetingApplicationCapabilities],
})

export { buildIndex } from './catalog-index.js'
export type { CatalogIndex, DomainBucket } from './catalog-index.js'
// 可见性收敛（D8）：纯的那一半在这里，取菜单的那一半在 `visibleCatalogFrom()`
export {
  collectVisiblePaths,
  createUserVisibility,
  filterCatalog,
  isPathLike,
  normalizeVisibilityKey,
  visibilityProbeKeys,
} from './visibility.js'
export type {
  FilterOptions,
  MenuNode,
  ModuleTypeNote,
  PageVisibility,
  UserVisibility,
  UserVisibilityInput,
  VisibilityCounts,
  VisibilityReport,
} from './visibility.js'
export { loadPageCatalog, __setPageCatalogForTest, domainOfPath } from './page-catalog.js'
export { normalizeTerm, tokenize, buildQueryTerms, scoreMatch } from './match.js'
export { validateAliases, validateLinks, validateLookups } from './validate.js'
export type { AliasIssue, LinkIssue, LookupIssue } from './validate.js'
export { ALIAS_ENTRIES, SYNONYM_GROUPS, DOMAIN_LABELS } from './aliases.js'
export type { AliasEntry, AliasTarget, SynonymGroup } from './aliases.js'
// 推导别名（生成物，由 tools/generate/derive-aliases.mjs 产出）。
// 它和 ALIAS_ENTRIES 一起被 match/search/recommend 使用，优先级低于人工表。
export { DERIVED_ALIAS_ENTRIES, DERIVED_ALIAS_META, DERIVED_CONFLICTS } from './aliases.derived.js'
export type { DerivedAliasEntry, DerivedAliasSource } from './aliases.derived.js'
export { isDerivedAliasId } from './recommend.js'
export { CAPABILITY_LINKS, CAPABILITY_DOCS, PAGE_CONSUME_NOTES } from './links.js'
export type { CapabilityLink, CapabilityLinkRole } from './links.js'

export type {
  CapabilityDescription,
  CapabilityInvokeBinding,
  CatalogCapability,
  CatalogPage,
  ConsumeKeyField,
  DescribeMiss,
  DescribeResult,
  DomainList,
  DomainListOptions,
  DomainSummary,
  EntryPoint,
  GeneratedPageCatalog,
  GeneratedPageRow,
  MatchVia,
  NextStep,
  NextStepRole,
  NextTool,
  PageCapabilityEntry,
  PageDescription,
  PageList,
  ParamContract,
  QueryTerm,
  Recommendation,
  RecommendationBasis,
  RecommendationIntent,
  RecommendedCapability,
  RecommendedTarget,
  SearchField,
  SearchHit,
  SearchMatch,
  SearchResult,
} from './types.js'

export type { AiContract, AiField, AiParameter } from './ai-contract.js'
