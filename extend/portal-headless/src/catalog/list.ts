import { AI_CONTRACTS } from './ai-contracts.js'
/**
 * 目录的三层下钻：业务域 → 页面 → 页面的能力。
 *
 * 对应 H13 说的"总目录 → 模块 → 页面能力"三层，也是 D8「渐进索要」的最小单位：
 * 任何时候只把当前这一层给 AI，而不是 1,019 行页面。
 */

import { normalizeMenuEntryPath } from '../context/module-type.js'
import type { CatalogIndex, DomainBucket } from './catalog-index.js'
import { buildQueryTerms, scoreMatch } from './match.js'
import type {
  CatalogCapability,
  CatalogPage,
  DomainList,
  DomainListOptions,
  DomainSummary,
  NextStep,
  PageCapabilityEntry,
  PageDescription,
  PageList,
} from './types.js'

const DOMAIN_NEXT_LIMIT = 2
const PAGE_CAPABILITY_NEXT_LIMIT = 3
const SUGGESTION_LIMIT = 5

function unique<T> (items: T[]): T[] {
  return [...new Set(items)]
}

function byPath (a: CatalogPage, b: CatalogPage): number {
  const left = a.menuPath ?? '￿'
  const right = b.menuPath ?? '￿'
  if (left !== right) return left < right ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function capabilityNextSteps (capabilities: CatalogCapability[], limit: number): NextStep[] {
  return capabilities.slice(0, limit).map((capability) => ({
    tool: 'describe' as const,
    args: { capabilityId: capability.id },
    role: 'next' as const,
    why: capability.write
      ? `「${capability.title}」（写操作）的 -llm：参数契约与返回结构`
      : `「${capability.title}」的 -llm：怎么调、拿到数据后怎么消费`,
  }))
}

function summarizeDomain (bucket: DomainBucket, detail: boolean): DomainSummary {
  const catalogPages = bucket.pages.filter((page) => page.source === 'menu-catalog')
  const capabilityOnlyPages = bucket.pages.filter((page) => page.source === 'capability-only')
  const capabilityIds = bucket.capabilities.map((capability) => capability.id)
  const total = bucket.pages.length

  // detail: false（G9）时逐个域的 next 置空：这一层是链上的第一步，
  // 却比它要引出的每一次 describe 都重，减重时先减"每个域各来一条"的部分。
  const next: NextStep[] = detail
    ? [
        {
          tool: 'listPages',
          args: { domain: bucket.domain },
          role: 'next',
          why: `「${bucket.label}」下有 ${total} 个页面，先看页面清单（其中 ${capabilityOnlyPages.length} 个页面不在菜单树里）`,
        },
      ]
    : []
  if (detail) {
    const firstCapability = capabilityIds[0]
    if (firstCapability !== undefined) {
      next.push({
        tool: 'describe',
        args: { capabilityId: firstCapability },
        role: 'next',
        why: `该域已有 ${capabilityIds.length} 个能力定义，可直接看第一个能力的 -llm`,
      })
    } else {
      next.push({
        tool: 'search',
        args: { keyword: bucket.label },
        role: 'next',
        why: '该域还没有能力定义（D24 逐行推进中），只能先按关键词检索定位页面',
      })
    }
  }

  return {
    domain: bucket.domain,
    label: bucket.label,
    pageCount: catalogPages.length,
    capabilityOnlyPageCount: capabilityOnlyPages.length,
    capabilityCount: bucket.capabilities.length,
    writePageCount: catalogPages.filter((page) => page.write === true).length,
    kinds: detail ? unique(catalogPages.map((page) => page.kind)) : [],
    capabilityIds,
    next,
  }
}

/**
 * 第一层：业务域清单。
 *
 * 按页面数降序 —— 页面多的域不一定是用户要的，但它是**阶段① 的推进重点**（D24），
 * 排序要让 AI 知道"这个目录有多长、从哪开始"。
 */
export function listDomains (index: CatalogIndex, options: DomainListOptions = {}): DomainList {
  const detail = options.detail ?? true
  const domains = [...index.domains.values()]
    .map((bucket) => summarizeDomain(bucket, detail))
    .sort((a, b) => {
      if (a.pageCount !== b.pageCount) return b.pageCount - a.pageCount
      return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0
    })

  const warnings: string[] = []
  for (const id of index.duplicateCapabilityIds) {
    warnings.push(
      `能力 ID「${id}」有多份定义（出现在多个页面）：目录按"更严的一侧"合并了参数，` +
        '调用方需要知道它有两个入口。这是能力定义的数据问题，应由生成器收敛成一个 ID 一份定义。',
    )
  }

  const catalogPages = index.pages.filter((page) => page.source === 'menu-catalog')
  const top = domains[0]
  const next: NextStep[] = []
  if (top !== undefined) {
    next.push({
      tool: 'listPages',
      args: { domain: top.domain },
      role: 'next',
      why: `「${top.label}」是页面最多的业务域（${top.pageCount} 个页面）`,
    })
  }
  // 这两条是"换个入口找"的岔路，不是"从这一层往前走"的下一步
  next.push(
    {
      tool: 'recommend',
      role: 'detour',
      why: '不确定落在哪个域时，把用户原话整句传进来走话术推荐（D11：推荐由 SDK 提供）',
    },
    {
      tool: 'search',
      role: 'detour',
      why: '按页面标题/菜单路径/能力标题/参数名做宽容匹配，结果会带上"为什么命中"（H22）',
    },
  )

  return {
    totalDomains: domains.length,
    totalPages: catalogPages.length,
    totalCapabilityOnlyPages: index.capabilityOnlyPagePaths.length,
    totalCapabilities: index.capabilities.length,
    domains,
    warnings,
    next,
  }
}

/** 第二层：某个业务域下的页面。 */
export function listPages (index: CatalogIndex, domain: string): PageList {
  const key = domain.trim()
  let bucket = index.domains.get(key)
  if (bucket === undefined) {
    const lowered = key.toLowerCase()
    bucket = [...index.domains.values()].find(
      (candidate) =>
        candidate.domain.toLowerCase() === lowered || candidate.label === key,
    )
  }

  if (bucket === undefined) {
    return {
      ok: false,
      domain: key,
      label: key,
      total: 0,
      pageCount: 0,
      capabilityOnlyPageCount: 0,
      capabilityCount: 0,
      pages: [],
      warnings: [],
      next: [
        {
          tool: 'listDomains',
          role: 'next',
          why: `没有业务域「${key}」。先看域清单拿一个真实域名，不要猜`,
        },
        {
          tool: 'search',
          args: { keyword: key },
          role: 'detour',
          why: '也可以直接用这个词检索页面标题与路径',
        },
      ],
    }
  }

  const pages = [...bucket.pages].sort(byPath)
  const catalogPages = pages.filter((page) => page.source === 'menu-catalog')
  const capabilityOnlyPages = pages.filter((page) => page.source === 'capability-only')

  const warnings: string[] = []
  const next: NextStep[] = []
  const first = pages[0]
  if (first !== undefined) {
    next.push({
      tool: 'describePage',
      args: { pageId: first.menuPath ?? first.id },
      role: 'next',
      why: '看第一个页面有哪些能力（页面是能力的最小调度单位，H2）',
    })
  }
  const withCapabilities = pages.filter((page) => page.capabilityIds.length > 0)
  if (withCapabilities.length === 0) {
    next.push({
      tool: 'listDomains',
      role: 'next',
      why: '该域还没有任何页面登记能力（阶段① 逐行推进中，D24），回到域清单换一个域',
    })
  }

  return {
    ok: true,
    domain: bucket.domain,
    label: bucket.label,
    total: pages.length,
    pageCount: catalogPages.length,
    capabilityOnlyPageCount: capabilityOnlyPages.length,
    capabilityCount: bucket.capabilities.length,
    pages,
    warnings,
    next,
  }
}

/** 用检索的方式给一个"找不到"的引用猜几个相近页面 */
function suggestPages (index: CatalogIndex, pageRef: string): CatalogPage[] {
  const terms = buildQueryTerms(pageRef)
  const scored: Array<{ page: CatalogPage; score: number }> = []
  for (const page of index.pages) {
    let score = 0
    for (const term of terms) {
      score += scoreMatch('pageTitle', term, page.title)
      score += Math.floor(scoreMatch('menuPath', term, page.menuPath) / 2)
    }
    if (score > 0) scored.push({ page, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || byPath(a.page, b.page))
    .slice(0, SUGGESTION_LIMIT)
    .map((entry) => entry.page)
}

/**
 * 第三层：某个页面有哪些能力。
 *
 * `pageId` 是宽容的：接受页面清单里的短哈希 id、菜单路径、带 query 的路径、
 * 详情/编辑路径（会归回所属列表页）、以及能力 ID（会落到它的主页面）。
 * 无头下 AI 手里最可能有的是路径，不是 id。
 */
export function describePage (index: CatalogIndex, pageId: string): PageDescription {
  const raw = pageId.trim()
  const candidates = [raw, raw.split('?')[0] ?? raw, normalizeMenuEntryPath(raw)]

  let page: CatalogPage | undefined
  for (const candidate of candidates) {
    page = index.pageById.get(candidate) ?? index.pageByPath.get(candidate)
    if (page !== undefined) break
  }

  if (page === undefined) {
    const viaCapability = index.capabilityById.get(raw)
    if (viaCapability !== undefined) {
      page = index.pageByPath.get(viaCapability.primary.pagePath)
    }
  }

  if (page === undefined) {
    return {
      ok: false,
      reason: `目录里没有页面「${raw}」`,
      suggestions: suggestPages(index, raw).map((candidate) => ({
        id: candidate.id,
        menuPath: candidate.menuPath,
        title: candidate.title,
      })),
      warnings: [],
    }
  }

  const capabilities: PageCapabilityEntry[] = []
  for (const capabilityId of page.capabilityIds) {
    const capability = index.capabilityById.get(capabilityId)
    if (capability === undefined) continue
    capabilities.push({
      capabilityId: capability.id,
      title: capability.title,
      write: capability.write,
      llmToolId: `${capability.id}-llm`,
      paramNames: capability.params.map((param) => param.name),
      purpose: AI_CONTRACTS[capability.id]?.purpose ?? null,
      whenToUse: AI_CONTRACTS[capability.id]?.whenToUse ?? null,
      effect: AI_CONTRACTS[capability.id]?.effect ?? null,
      boundaries: AI_CONTRACTS[capability.id]?.boundaries ?? [],
    })
  }

  const next: NextStep[] = []
  for (const entry of capabilities.slice(0, PAGE_CAPABILITY_NEXT_LIMIT)) {
    next.push({
      tool: 'describe',
      args: { capabilityId: entry.capabilityId },
      role: 'next',
      why: `「${entry.title}」的 -llm：参数契约、返回结构、下一步去哪（D14）`,
    })
  }
  next.push({
    tool: 'listPages',
    args: { domain: page.domain },
    role: 'detour',
    why: `同属「${index.domains.get(page.domain)?.label ?? page.domain}」的其他页面`,
  })

  // 清单说这一页含写操作、但一个能力都没登记 —— 阶段① 还没推进到这里（D24）
  const pending = page.capabilityIds.length === 0

  const warnings: string[] = []
  if (pending) {
    // `pending` 是推导出来的状态，不是一个给模型看的措辞（评测 T4）：
    // "做不了"这句话要有人明说，否则模型会顺着 next 继续逛。
    warnings.push(
      '这一页还没有登记任何能力（阶段① 逐行推进中，D24）：现在**调不到**它，' +
        '只能如实告诉用户这个功能当前做不了，不要用同域的其它能力代替它。',
    )
  }

  return {
    ok: true,
    page,
    capabilities,
    pending,
    warnings,
    next,
  }
}
