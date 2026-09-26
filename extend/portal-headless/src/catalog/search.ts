/**
 * 检索：给一个词，回答"目录里哪些地方跟它有关，以及**为什么有关**"。
 *
 * 设计要求：
 * - H22：菜单 title 大量是内部黑话，检索必须宽容（大小写、空格、部分匹配、同义词、别名翻译）
 * - H22 的 Q57：不能把 850 个页面塞进上下文，所以检索是"先缩小范围"的那一步
 * - 结果必须带**命中字段**，上游才知道为什么命中，而不是把一堆结果当黑盒
 */

import type { CatalogIndex } from './catalog-index.js'
import { buildQueryTerms, scoreMatch, tokenize } from './match.js'
import type { SearchField, SearchHit, SearchMatch, SearchResult } from './types.js'

export type SearchOptions = {
  /** 默认 20，上限 100 */
  limit?: number
  /** 是否补中文片段（默认 true） */
  partial?: boolean
  /** 是否做同义词/别名扩展（默认 true） */
  expand?: boolean
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/** 每条命中最多回传几个"为什么命中"，避免一句话炸出 20 行匹配明细 */
const MAX_MATCHES_PER_HIT = 5

const TYPE_RANK: Record<SearchHit['type'], number> = { page: 0, capability: 1, domain: 2 }

function collect (
  matches: SearchMatch[],
  field: SearchField,
  values: Array<string | null | undefined>,
  terms: ReturnType<typeof buildQueryTerms>,
): void {
  for (const value of values) {
    if (value === null || value === undefined || value.length === 0) continue
    for (const term of terms) {
      const score = scoreMatch(field, term, value)
      if (score === 0) continue
      matches.push({
        field,
        term: term.term,
        value,
        via: term.via,
        ...(term.from === undefined ? {} : { from: term.from }),
        score,
      })
    }
  }
}

function finalize (matches: SearchMatch[]): { score: number; top: SearchMatch[] } {
  const deduped = new Map<string, SearchMatch>()
  for (const match of matches) {
    const key = `${match.field} ${match.term} ${match.value}`
    const existing = deduped.get(key)
    if (existing === undefined || existing.score < match.score) deduped.set(key, match)
  }
  const all = [...deduped.values()].sort(
    (a, b) => b.score - a.score || (a.field < b.field ? -1 : 1),
  )
  const score = all.reduce((sum, match) => sum + match.score, 0)
  return { score, top: all.slice(0, MAX_MATCHES_PER_HIT) }
}

/**
 * 检索入口。
 *
 * 匹配面：页面标题 / 菜单路径 / 路由文件 / 业务域 / 页面形态 / 权限码，
 * 能力标题 / 能力 ID / 参数名。中英文都按"归一化后子串"匹配，
 * 归一化会去掉空白与 `-` `/` `_`（所以 `meeting-room`、`Meeting Room`、`meetingroom` 等价）。
 */
export function search (index: CatalogIndex, keyword: string, options: SearchOptions = {}): SearchResult {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const terms = buildQueryTerms(keyword, {
    ...(options.partial === undefined ? {} : { partial: options.partial }),
    ...(options.expand === undefined ? {} : { expand: options.expand }),
  })
  const tokens = tokenize(keyword)
  const hits: SearchHit[] = []

  for (const bucket of index.domains.values()) {
    const matches: SearchMatch[] = []
    collect(matches, 'domain', [bucket.domain, bucket.label], terms)
    const { score, top } = finalize(matches)
    if (score === 0) continue
    hits.push({
      type: 'domain',
      id: bucket.domain,
      title: bucket.label,
      domain: bucket.domain,
      score,
      matches: top,
    })
  }

  for (const page of index.pages) {
    const matches: SearchMatch[] = []
    collect(matches, 'pageTitle', [page.title], terms)
    collect(matches, 'menuPath', [page.menuPath], terms)
    collect(matches, 'routeFile', [page.routeFile], terms)
    collect(matches, 'domain', [page.domain], terms)
    collect(matches, 'kind', [page.kind], terms)
    collect(matches, 'permission', [page.permission], terms)
    const { score, top } = finalize(matches)
    if (score === 0) continue
    hits.push({
      type: 'page',
      id: page.id,
      title: page.title,
      domain: page.domain,
      pageId: page.id,
      hasCapabilities: page.capabilityIds.length > 0,
      score,
      matches: top,
    })
  }

  for (const capability of index.capabilities) {
    const matches: SearchMatch[] = []
    collect(matches, 'capabilityTitle', [capability.title], terms)
    collect(matches, 'capabilityId', [capability.id], terms)
    collect(matches, 'menuPath', capability.pagePaths, terms)
    collect(matches, 'paramName', capability.params.map((param) => param.name), terms)
    const { score, top } = finalize(matches)
    if (score === 0) continue
    const primaryPage = index.pageByPath.get(capability.primary.pagePath)
    hits.push({
      type: 'capability',
      id: capability.id,
      title: capability.title,
      ...(primaryPage === undefined ? {} : { domain: primaryPage.domain, pageId: primaryPage.id }),
      capabilityId: capability.id,
      score,
      matches: top,
    })
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (TYPE_RANK[a.type] !== TYPE_RANK[b.type]) return TYPE_RANK[a.type] - TYPE_RANK[b.type]
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const next = buildNextSteps(keyword, hits[0])
  return {
    keyword,
    tokens,
    terms,
    total: hits.length,
    truncated: hits.length > limit,
    hits: hits.slice(0, limit),
    warnings: [],
    next,
  }
}

function buildNextSteps (keyword: string, top: SearchHit | undefined): SearchResult['next'] {
  if (top === undefined) {
    return [
      {
        // args 必须带上：一条"告诉你去调某接口但没说调什么"的边，调用方还得自己猜（G5）
        tool: 'recommend' as const,
        args: { text: keyword },
        role: 'next' as const,
        why: '一个字面都没命中。把用户原话整句传给 recommend 走话术别名（H22：菜单里大量是「找齐」「准入」这类黑话，字面检索天然对不上）',
      },
      {
        tool: 'listDomains' as const,
        role: 'detour' as const,
        why: '或者先看业务域清单，用域来缩小范围（Q57：不要一次列 850 个页面）',
      },
    ]
  }

  const next: SearchResult['next'] = []
  if (top.type === 'capability' && top.capabilityId !== undefined) {
    next.push({
      tool: 'describe',
      args: { capabilityId: top.capabilityId },
      role: 'next',
      why: `看「${top.title}」的 -llm：参数契约、返回结构、拿到数据后下一步去哪（D14）`,
    })
  } else if (top.type === 'domain') {
    next.push({
      tool: 'listPages',
      args: { domain: top.domain ?? top.id },
      role: 'next',
      why: `进入「${top.title}」这个业务域看页面清单`,
    })
  } else if (top.pageId !== undefined) {
    next.push({
      tool: 'describePage',
      args: { pageId: top.pageId },
      role: 'next',
      why: `「${top.title}」这个页面已登记的能力清单`,
    })
  }
  next.push({
    tool: 'recommend',
    args: { text: keyword },
    role: 'detour',
    why: '结果不对时改用 recommend（话术 → 能力），它带同义词与黑话别名表',
  })
  return next
}
