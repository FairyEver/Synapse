/**
 * 路由推荐（D11）：**由 SDK 自己提供**，不复用 Portal 的 intent（Q105 作废）。
 *
 * 这是"用户话术 → 能力/页面"的那一步，也是 H22 说整个项目最难的一环：
 * AI 对「薪资审核报表」能对上，对「帮我看看这个月还剩多少工资」对不上任何菜单 title。
 *
 * 实现取舍（明确写下来，避免被当成"已经做好了"）：
 * - **可解释优先，不是效果优先**：每条推荐都带 `interpretations`（命中了哪个别名条目、
 *   哪个同义词组、哪个原词），上游能据此判断"它到底听懂没有"，也能据此调表。
 * - **不引入大模型、不引入运行时依赖**：纯关键词 + 别名表。
 *   局限很直白：表里没有的说法就推不出来，只能落到 `search` 的字面检索上。
 * - 表在 `src/catalog/aliases.ts`，将来由服务端下发替换（D8），接口不变。
 * - **表分两份，可信度不同**：
 *   · `ALIAS_ENTRIES` 人写的，覆盖 19 个概念，表达"用户会怎么说"（「调薪」「订个会议室」）
 *   · `DERIVED_ALIAS_ENTRIES` 从页面清单/菜单分组/能力定义推导（`tools/generate/derive-aliases.mjs`），
 *     覆盖全部有标题的菜单页，表达"Portal 里它叫什么"
 *   推导条目按 `confidence` 打折（见 `DERIVED_ALIAS_BASE`），人工条目永远排在前面；
 *   `interpretations` 里 `id` 带 `auto:` 前缀的就是推导来的，上游能一眼分辨。
 */

import { ALIAS_ENTRIES, DOMAIN_LABELS, SYNONYM_GROUPS, type AliasTarget } from './aliases.js'
import { DERIVED_ALIAS_ENTRIES } from './aliases.derived.js'
import type { CatalogIndex } from './catalog-index.js'
import { buildQueryTerms, normalizeTerm, scoreMatch, tokenize } from './match.js'
import type {
  NextStep,
  Recommendation,
  RecommendationBasis,
  RecommendationIntent,
  RecommendedCapability,
  RecommendedTarget,
} from './types.js'

export type RecommendOptions = {
  /** 每一类最多回传几个落点，默认 5 */
  limit?: number
}

const DEFAULT_LIMIT = 5

/**
 * 话术里的读写信号（G4）。
 *
 * 评测实测：「查一下会议室有哪些」（纯读）与「帮我订个会议室」（读+写）拿到
 * **完全相同的前三名**——`capabilities[]` 里带着 `write`，排序却没用它。
 * 中文没有词形变化，这里用子串命中（与别名表同一套做法）：命中即记录，
 * 让上游能从 `intent.signals` 看出"它凭什么认为这是写意图"。
 */
const WRITE_SIGNALS = [
  '订', '预定', '预约', '提交', '申请', '新建', '创建', '新增', '修改', '编辑',
  '更新', '删除', '移除', '停用', '启用', '取消', '撤销', '审批', '驳回', '发起',
  '上传', '导入', '变更', '调整', '调薪', '报销',
]
const READ_SIGNALS = [
  '查', '看', '有哪些', '哪些', '多少', '列表', '清单', '情况', '详情', '状态',
  '统计', '报表', '记录', '历史', '搜索', '找', '有没有', '空闲',
]
/** 写意图下给写能力的加权；读意图下给写能力的减权 */
const WRITE_INTENT_BOOST = 1.15
const READ_INTENT_DAMP = 0.75

function detectIntent (text: string): RecommendationIntent {
  const whole = normalizeTerm(text)
  const signals: string[] = []
  let write = false
  let read = false
  for (const signal of WRITE_SIGNALS) {
    if (whole.includes(normalizeTerm(signal))) {
      write = true
      signals.push(signal)
    }
  }
  for (const signal of READ_SIGNALS) {
    if (whole.includes(normalizeTerm(signal))) {
      read = true
      signals.push(signal)
    }
  }
  return {
    kind: write && read ? 'mixed' : write ? 'write' : read ? 'read' : 'unknown',
    // 「预定」命中时把「订」、「有哪些」命中时把「哪些」去掉：信号是给上游看的，
    // 罗列一串互相包含的子串只会让人以为命中了更多东西。
    signals: signals.filter(
      (signal) => !signals.some((other) => other !== signal && other.includes(signal)),
    ),
  }
}

/**
 * 按意图给能力加权（G4）。
 *
 * 只调"写能力"的分：读意图把写能力压下去（用户只是想知道有什么，不该先看到"提交申请"），
 * 写意图把它抬起来。**抬的幅度刻意小于"候选必须先摆出来"这一层语义**——
 * 订会议室的链路里，`meeting-room-list`（读）依然排在 submit（写）前面：
 * 用户总得先挑一间会议室，才能提交。`mixed` / `unknown` 一律不动，保持可预测。
 */
function applyIntent (score: number, write: boolean, intent: RecommendationIntent): number {
  if (intent.kind === 'write') return write ? score * WRITE_INTENT_BOOST : score
  if (intent.kind === 'read') return write ? score * READ_INTENT_DAMP : score
  return score
}
/** 人工别名命中的基础分：短语越长越具体，分数越高 */
const ALIAS_BASE = 40
/**
 * 推导别名的基础分。与 `ALIAS_BASE` 同基准，再乘条目自己的 `confidence`（0.3~0.8），
 * 所以最可信的推导条目（能力标题，0.8）也只有人工条目的八成，
 * 而"多个页面共用同一个名字"的歧义条目（0.35）连一半都不到。
 * 这个折扣就是"不要把推导结果和人工校对过的知识混为一谈"的落地处。
 */
const DERIVED_ALIAS_BASE = 40
/** 推导条目在 `interpretations` 里的 id 前缀，便于上游与人工条目区分 */
const DERIVED_ID_PREFIX = 'auto:'
/** 检索兜底的分量：只做补充，不能盖过显式的别名命中 */
const LITERAL_DISCOUNT = 0.15

type Accumulator = { id: string; score: number; reasons: string[] }

/** 两份别名表（人工 / 推导）结构相同的部分：匹配与落点只认这些字段 */
type AliasEntryShape = {
  id: string
  note: string
  phrases: string[]
  terms: string[]
  targets: AliasTarget[]
}

function addScore (
  map: Map<string, Accumulator>,
  id: string,
  score: number,
  reason: string,
): void {
  const existing = map.get(id)
  if (existing === undefined) {
    map.set(id, { id, score, reasons: [reason] })
    return
  }
  existing.score += score
  if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
}

function toTargets (accumulator: Map<string, Accumulator>, limit: number): Array<Accumulator & { score: number }> {
  return [...accumulator.values()]
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, limit)
}

/**
 * 按用户原话推荐能力 / 页面 / 业务域。
 *
 * 返回的 `capabilities` 可以直接喂给 `describe()`（`llmToolId` 就是 `-llm` 的入口），
 * `interpretations` 是"为什么推荐它"。
 */
export function recommend (
  index: CatalogIndex,
  text: string,
  options: RecommendOptions = {},
): Recommendation {
  const limit = options.limit ?? DEFAULT_LIMIT
  const whole = normalizeTerm(text)
  const tokens = tokenize(text)
  const terms = buildQueryTerms(text)
  const interpretations: RecommendationBasis[] = []

  const domainAcc = new Map<string, Accumulator>()
  const pageAcc = new Map<string, Accumulator>()
  const capabilityAcc = new Map<string, Accumulator>()

  /**
   * 两份别名表共用同一套匹配与落点逻辑，只有**分数与措辞**不同：
   * 人工条目按 `ALIAS_BASE` 给分、理由写「话术别名」，推导条目按 `confidence` 打折、
   * 理由写「页面清单推导」。分开写会让人以为它们是两套机制，其实是一套。
   */
  const accumulate = <Entry extends AliasEntryShape>(
    entries: ReadonlyArray<Entry>,
    describeMatch: (entry: Entry, longest: string) => { base: number; note: string; reason: string },
  ): void => {
    for (const entry of entries) {
      const matchedPhrases = entry.phrases.filter((phrase) => {
        const normalized = normalizeTerm(phrase)
        return normalized.length > 0 && whole.includes(normalized)
      })
      if (matchedPhrases.length === 0) continue

      const longest = matchedPhrases.reduce((best, candidate) =>
        normalizeTerm(candidate).length > normalizeTerm(best).length ? candidate : best,
      )
      const { base, note, reason } = describeMatch(entry, longest)
      interpretations.push({
        source: 'alias',
        id: entry.id,
        matched: longest,
        expansions: entry.terms,
        note,
        score: base,
      })

      for (const target of entry.targets) {
        const weight = target.weight ?? 1
        if (target.type === 'capability') addScore(capabilityAcc, target.id, base * weight, reason)
        else if (target.type === 'page') addScore(pageAcc, target.menuPath, base * weight, reason)
        else addScore(domainAcc, target.id, base * weight, reason)
      }
    }
  }

  // ① 人工维护的话术别名：最强信号
  accumulate(ALIAS_ENTRIES, (entry, longest) => ({
    base: ALIAS_BASE + normalizeTerm(longest).length * 3,
    note: entry.note,
    reason: `话术别名「${longest}」命中概念「${entry.id}」：${entry.note}`,
  }))

  // ①b 推导别名：覆盖人工表没写的页面，按 confidence 打折，措辞也必须让人看出是推出来的
  accumulate(DERIVED_ALIAS_ENTRIES, (entry, longest) => ({
    base: Math.round(
      (DERIVED_ALIAS_BASE + normalizeTerm(longest).length * 3) * entry.confidence,
    ),
    note: `${entry.note}（来源：${entry.derivedFrom}，可信度 ${entry.confidence}）`,
    reason: `页面清单推导「${longest}」命中概念「${entry.id}」：${entry.note}`,
  }))

  // ② 同义词组：只解释"听懂了什么"，落点交给字面命中
  for (const group of SYNONYM_GROUPS) {
    const matched = group.terms.filter((term) => {
      const normalized = normalizeTerm(term)
      return normalized.length > 0 && whole.includes(normalized)
    })
    if (matched.length === 0) continue
    interpretations.push({
      source: 'synonym',
      id: group.id,
      matched: matched.join('、'),
      expansions: group.terms.filter((term) => !matched.includes(term)),
      note: `同义词组「${group.id}」：${matched.join('、')} 与 ${group.terms.join('、')} 等价`,
      score: 10,
    })
  }

  // ③ 原词：让上游看见"这句话被切成了什么"
  for (const token of tokens) {
    if (token.length < 2) continue
    interpretations.push({
      source: 'literal',
      id: token,
      matched: token,
      expansions: [],
      note: '话术里的原词',
      score: 5,
    })
  }

  // ④ 字面兜底：把（经同义词/别名扩展后的）词打到域、页面标题、能力名上
  for (const term of terms) {
    if (term.via === 'partial') continue

    for (const bucket of index.domains.values()) {
      const score =
        scoreMatch('domain', term, bucket.label) + scoreMatch('domain', term, bucket.domain)
      if (score > 0) {
        addScore(domainAcc, bucket.domain, score * LITERAL_DISCOUNT, `词「${term.term}」命中业务域「${bucket.label}」`)
      }
    }
    for (const page of index.pages) {
      const score = scoreMatch('pageTitle', term, page.title)
      if (score > 0) {
        addScore(
          pageAcc,
          page.menuPath ?? page.id,
          score * LITERAL_DISCOUNT,
          `词「${term.term}」命中页面标题「${page.title}」`,
        )
      }
    }
    for (const capability of index.capabilities) {
      const score = scoreMatch('capabilityTitle', term, capability.title)
      if (score > 0) {
        addScore(
          capabilityAcc,
          capability.id,
          score * LITERAL_DISCOUNT,
          `词「${term.term}」命中能力名「${capability.title}」`,
        )
      }
    }
  }

  const intent = detectIntent(text)

  // 读写意图进排序（G4）：分数在排序**之前**按能力自己的 `write` 调过一次，
  // 所以 `capabilities` 与 `capabilityGroups` 用的是同一份加权后的分数。
  const weightedCapabilityAcc = new Map<string, Accumulator>()
  for (const [id, entry] of capabilityAcc) {
    const write = index.capabilityById.get(id)?.write ?? false
    weightedCapabilityAcc.set(id, { ...entry, score: applyIntent(entry.score, write, intent) })
  }

  // 落点解析：别名表里写错的路径在这里被丢掉，测试会单独把它抓成红
  const resolveCapabilities = (entries: Accumulator[]): RecommendedCapability[] => {
    const out: RecommendedCapability[] = []
    for (const entry of entries) {
      const capability = index.capabilityById.get(entry.id)
      if (capability === undefined) continue
      out.push({
        id: capability.id,
        title: capability.title,
        score: entry.score,
        reasons: entry.reasons,
        pagePath: capability.primary.pagePath,
        write: capability.write,
        llmToolId: `${capability.id}-llm`,
      })
    }
    return out
  }

  const capabilities = resolveCapabilities(toTargets(weightedCapabilityAcc, limit))
  // 分组下发（G4）：按同一份排序切成读/写两组，消费者可以直接挑一组，
  // 不必自己按 `write` 过滤（也不用担心 limit 把某一组整组挤掉）。
  const allRanked = resolveCapabilities(
    toTargets(weightedCapabilityAcc, weightedCapabilityAcc.size),
  )
  const capabilityGroups = {
    read: allRanked.filter((capability) => !capability.write).slice(0, limit),
    write: allRanked.filter((capability) => capability.write).slice(0, limit),
  }

  const pages: Recommendation['pages'] = []
  for (const entry of toTargets(pageAcc, limit)) {
    const page = index.pageByPath.get(entry.id)
    if (page === undefined) continue
    pages.push({
      id: page.id,
      title: page.title,
      score: entry.score,
      reasons: entry.reasons,
      menuPath: page.menuPath,
      domain: page.domain,
    })
  }

  const domains: Recommendation['domains'] = []
  for (const entry of toTargets(domainAcc, limit)) {
    const bucket = index.domains.get(entry.id)
    if (bucket === undefined) continue
    domains.push({
      id: bucket.domain,
      title: bucket.label,
      label: bucket.label,
      score: entry.score,
      reasons: entry.reasons,
    })
  }

  // 显式否定（G5）：空数组不是"没有"的信号——`ok`/`reason` 才是，
  // 而且要分清"认得页面但页面没有能力"与"一个字都没对上"这两种完全不同的事。
  const ok = capabilities.length > 0
  const warnings: string[] = []
  if (intent.kind === 'write' && !capabilities.some((capability) => capability.write)) {
    warnings.push(
      `这是写意图（信号：${intent.signals.join('、')}），但推出来的能力里没有一个是写能力：` +
        '读结果不能被当成"已经办好"，写操作要落到 write: true 的能力上；都不匹配就如实说不支持。',
    )
  }

  return {
    text,
    interpretations: interpretations.sort((a, b) => b.score - a.score),
    ok,
    reason: ok ? null : buildMissReason(index, { pages, domains }),
    intent,
    domains,
    pages,
    capabilities,
    capabilityGroups,
    warnings,
    next: buildNextSteps({ capabilities, pages, domains }, text),
  }
}

/** 全量能力清单放进否定回执里，让调用方**一次**就能判定"真的没有"（下面有说明） */
const ROSTER_LIMIT = 20

/**
 * `ok: false` 时把"为什么没有"说清楚（G5）：三种情形要区分开。
 *
 * 每一句末尾都带**收敛信息**（能力清单 + 规模）：模型实测读到 `ok: false` 之后
 * 仍然连搜 5 次、撞满 8 轮预算才敢确认"目录里真的没有"——它没法从"没有匹配"推出
 * "已经试完了"。把全量清单摊在这里，否定就是一句话的事，不必让调用方自己再证一遍。
 */
function buildMissReason (
  index: CatalogIndex,
  picked: Pick<Recommendation, 'pages' | 'domains'>,
): string {
  const ids = index.capabilities.map((capability) => capability.id)
  const roster =
    ids.length === 0
      ? '目录里还没有任何已登记的能力'
      : ids.length <= ROSTER_LIMIT
        ? `全部已登记能力只有 ${ids.length} 个：${ids.join('、')}。不在这份清单里的功能就是调不到，换词再试也只会在同样的范围里找`
        : `已登记能力共 ${ids.length} 个（用 describe 传一个不存在的 ID 可以拿到全量清单）。不在这份清单里的功能就是调不到`

  if (picked.pages.length > 0) {
    return (
      `这句话能对上页面（${picked.pages.map((page) => page.title).join('、')}），` +
      `但这些页面还没有登记能力（阶段① 逐行推进中，D24）：现在调不到，只能如实告诉用户这个功能做不了。${roster}。`
    )
  }
  if (picked.domains.length > 0) {
    return (
      `只推到了业务域（${picked.domains.map((domain) => domain.label).join('、')}），` +
      `没有匹配到能力。${roster}。`
    )
  }
  return `目录里没有匹配这句话的能力（${index.pages.length} 个页面）。${roster}。`
}

function buildNextSteps (
  picked: Pick<Recommendation, 'capabilities' | 'pages' | 'domains'>,
  text: string,
): NextStep[] {
  const next: NextStep[] = []

  const capability = picked.capabilities[0]
  if (capability !== undefined) {
    next.push({
      tool: 'describe',
      args: { capabilityId: capability.id },
      role: 'next',
      why: `先看「${capability.title}」的 -llm：怎么调、参数契约、拿到数据后下一步去哪（D14）`,
    })
  }

  const page = picked.pages[0]
  if (page !== undefined && page.menuPath !== null) {
    next.push({
      tool: 'describePage',
      args: { pageId: page.menuPath },
      // 有可调能力时它是"顺便看看这一页还有什么"；一个能力都没推出来时它是唯一的路
      role: capability === undefined ? 'next' : 'detour',
      why: `「${page.title}」这个页面上还有哪些能力`,
    })
  }

  const domain = picked.domains[0]
  if (domain !== undefined && capability === undefined && page === undefined) {
    next.push({
      tool: 'listPages',
      args: { domain: domain.id },
      role: 'next',
      why: `只推到了业务域「${domain.label}」，进下一层看页面`,
    })
  }

  if (next.length === 0) {
    next.push(
      {
        // args 必须带上原话（G5）：一条"告诉你去调 search 但没说 search 什么"的边，
        // 调用方只能自己猜要传什么——这正是评测里那条失效的回落路径。
        tool: 'search',
        args: { keyword: text },
        role: 'next',
        why: '没有认出这句话对应哪个域（别名表未覆盖）。先用字面检索：把用户话术里的名词直接传进 search（H22）',
      },
      {
        tool: 'listDomains',
        role: 'detour',
        why: '别名表没覆盖的话术只能人工定位。从域清单开始缩小范围',
      },
    )
  }

  return next
}

/** 推荐结果里用到的域标签，便于上游直接展示 */
export function domainLabelOf (domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain
}

/**
 * 这条推荐是不是推导出来的（不是人写的）。
 *
 * 上游可以据此决定要不要二次确认：人工条目命中的是"用户话术"，
 * 推导条目命中的多半是"用户恰好说对了页面名"，后者更容易是巧合。
 */
export function isDerivedAliasId (id: string): boolean {
  return id.startsWith(DERIVED_ID_PREFIX)
}
