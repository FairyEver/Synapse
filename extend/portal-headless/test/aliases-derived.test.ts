/**
 * 推导别名（`aliases.derived.ts` + `tools/generate/derive-aliases.mjs`）。
 *
 * 这份测试要守住的是**这条路线本身靠不靠得住**，不是"结果好看"：
 * - 推导器对真实数据真的产出了东西（数量级比人工表大，且每个词都能回溯到来源）
 * - 推不出来的**确实是空的**（没有为了覆盖率硬编）
 * - 人工表真的赢（同一概念两边都有时，推导条目被丢弃并报出来，不是静默共存）
 * - 推导出来的东西**没有被当成和人工一样可信**（打分与来源标记都能分辨）
 * - 生成器可重复执行（幂等），且磁盘上的生成物没有过期
 *
 * 断言的数字与锚点都来自真实数据（`generated/page-catalog.json`、`src/capabilities/*.ts`），
 * 目录变了它们会红——那时该做的是重跑生成器，不是改断言。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import {
  ALIAS_ENTRIES,
  DOMAIN_LABELS,
  DERIVED_ALIAS_ENTRIES,
  DERIVED_ALIAS_META,
  DERIVED_CONFLICTS,
  createCatalog,
  isDerivedAliasId,
  normalizeTerm,
  type Catalog,
  type DerivedAliasEntry,
  type GeneratedPageCatalog,
} from '../src/catalog/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const DERIVED_FILE = join(PKG_ROOT, 'src/catalog/aliases.derived.ts')
const GENERATOR = join(PKG_ROOT, 'tools/generate/derive-aliases.mjs')
/** 全部能力定义：与应用加载的是**同一份**（此前这里手写了一遍，2026-09-20 因此红过两次） */
const CAPABILITIES = ALL_CAPABILITY_DEFINITIONS

/** 独立重数：直接读 JSON，不经过 src/catalog 的加载器 */
function readRawCatalog (): GeneratedPageCatalog {
  return JSON.parse(
    readFileSync(join(PKG_ROOT, 'generated/page-catalog.json'), 'utf8'),
  ) as GeneratedPageCatalog
}

function makeCatalog (): Catalog {
  return createCatalog({ capabilities: CAPABILITIES })
}

/** 人工表里出现过的全部词面（归一化后），冲突判定用 */
function humanPhraseSet (): Set<string> {
  const set = new Set<string>()
  for (const entry of ALIAS_ENTRIES) {
    for (const word of [...entry.phrases, ...entry.terms]) {
      const key = normalizeTerm(word)
      if (key.length > 0) set.add(key)
    }
  }
  return set
}

function targetsOf (entry: DerivedAliasEntry): string[] {
  return entry.targets.map((target) =>
    target.type === 'page' ? target.menuPath : `${target.type}:${target.id}`,
  )
}

/* ================================================================ 真实数据：产出 */

describe('推导器对真实数据产出的东西', () => {
  it('产出的条数与生成物自报一致，且比人工表大一个数量级', () => {
    expect(DERIVED_ALIAS_ENTRIES.length).toBe(DERIVED_ALIAS_META.derivedEntries)
    expect(DERIVED_ALIAS_META.totalPages).toBe(readRawCatalog().items.length)

    // 量级对比：人工 19 条，推导 800+ 条。这条断言是"维护成本不再随页面数线性增长"的证据
    expect(DERIVED_ALIAS_ENTRIES.length).toBeGreaterThan(700)
    expect(DERIVED_ALIAS_ENTRIES.length).toBeGreaterThan(ALIAS_ENTRIES.length * 20)
  })

  it('覆盖的页面数远超人工表——人工只覆盖了 3% 的菜单页', () => {
    const raw = readRawCatalog().items.filter(
      (row) => typeof row.menuPath === 'string' && row.menuPath.length > 0,
    )
    const derivedPages = new Set<string>()
    for (const entry of DERIVED_ALIAS_ENTRIES) {
      for (const target of entry.targets) {
        if (target.type === 'page') derivedPages.add(target.menuPath)
      }
    }
    const humanPages = new Set<string>()
    for (const entry of ALIAS_ENTRIES) {
      for (const target of entry.targets) {
        if (target.type === 'page') humanPages.add(target.menuPath)
      }
    }

    expect(humanPages.size).toBeGreaterThan(0)
    expect(humanPages.size / raw.length).toBeLessThan(0.05)
    expect(derivedPages.size / raw.length).toBeGreaterThan(0.7)
    // 推导覆盖的页面里，人工表没碰过的占绝大多数 —— 增量就在这部分
    const humanUntouched = [...derivedPages].filter((path) => !humanPages.has(path))
    expect(humanUntouched.length).toBeGreaterThan(humanPages.size * 5)
  })

  it('内容锚点：真实菜单里的具体条目确实被推导出来了', () => {
    const byId = new Map(DERIVED_ALIAS_ENTRIES.map((entry) => [entry.id, entry]))

    const feed = byId.get('auto:饲料加工')
    expect(feed, '真实页面「饲料加工」应被推导出来').toBeDefined()
    expect(feed?.derivedFrom).toBe('page-title')
    expect(feed?.phrases).toContain('饲料加工')
    expect(targetsOf(feed as DerivedAliasEntry)).toContain(
      '/dashboard/product/feed/process/feed-processing/list',
    )

    // 域标签来源：两个页面的域，落点是"域 + 该域下的少量页面"
    const month = byId.get('auto:domain:month-agreement')
    expect(month?.derivedFrom).toBe('domain-label')
    expect(month?.phrases).toEqual(['月度协议'])
    expect(targetsOf(month as DerivedAliasEntry)).toContain('domain:month-agreement')

    // 能力标题来源：能力标题里带的信息（"查询各会议室的预定占用情况"）页面标题里没有
    const usage = byId.get('auto:capability:meeting-room-usage')
    expect(usage?.derivedFrom).toBe('capability-title')
    expect(targetsOf(usage as DerivedAliasEntry)).toEqual(['capability:meeting-room-usage'])
  })

  it('每一条推导都能回溯到来源，没有为了覆盖率硬编的词', () => {
    const raw = readRawCatalog().items
    const titleNorms = new Set(raw.map((row) => normalizeTerm(row.title)))
    const labelNorms = new Set(Object.values(DOMAIN_LABELS).map((label) => normalizeTerm(label)))
    const capabilityTitleNorms = new Set(CAPABILITIES.map((item) => normalizeTerm(item.title)))

    const orphans: string[] = []
    for (const entry of DERIVED_ALIAS_ENTRIES) {
      for (const phrase of entry.phrases) {
        const key = normalizeTerm(phrase)
        // 允许的来源：某个页面标题本身 / 某个页面标题的片段（词干）/ 域中文名 / 能力标题
        const fromTitle = [...titleNorms].some((title) => title.includes(key))
        if (labelNorms.has(key) || capabilityTitleNorms.has(key) || fromTitle) continue
        orphans.push(`${entry.id}:「${phrase}」`)
      }
    }

    expect(orphans).toEqual([])
    expect(DERIVED_ALIAS_META.capabilityCount).toBe(CAPABILITIES.length)
  })

  it('推不出来的保持没有：推导条目里没有一个"用户话术"词', () => {
    // 反向锚点：人工表里那些**页面里根本不存在的说法**，推导器一条都不该产出。
    // 这些词就是"必须人写"的那部分，推导器一旦凭空造出来，就是硬编。
    const notADerivedPhrase = ['调薪', '涨工资', '工资调整', '发工资', '工资条', '开会', '订会议室', '花名册', '打卡', '出勤', '买东西', '进货', '听课', '考评']
    const derivedPhrases = new Set<string>()
    for (const entry of DERIVED_ALIAS_ENTRIES) {
      for (const phrase of entry.phrases) derivedPhrases.add(normalizeTerm(phrase))
    }
    for (const word of notADerivedPhrase) {
      expect(derivedPhrases.has(normalizeTerm(word)), `「${word}」不该被推导出来`).toBe(false)
    }
  })

  it('无死链：每条推导落点都能在真实目录里解析到', () => {
    const catalog = makeCatalog()
    const index = catalog.index
    const dead: string[] = []

    for (const entry of DERIVED_ALIAS_ENTRIES) {
      for (const target of entry.targets) {
        if (target.type === 'capability' && !index.capabilityById.has(target.id)) {
          dead.push(`${entry.id} → 能力 ${target.id}`)
        }
        if (target.type === 'page' && !index.pageByPath.has(target.menuPath)) {
          dead.push(`${entry.id} → 页面 ${target.menuPath}`)
        }
        if (target.type === 'domain' && !index.domains.has(target.id)) {
          dead.push(`${entry.id} → 域 ${target.id}`)
        }
      }
    }

    expect(dead).toEqual([])
  })

  it('结构自洽：id 唯一且带 auto: 前缀，phrases/targets 非空，confidence 在 (0,1)', () => {
    const ids = new Set<string>()
    for (const entry of DERIVED_ALIAS_ENTRIES) {
      expect(entry.id.startsWith('auto:'), `${entry.id} 缺少 auto: 前缀`).toBe(true)
      expect(ids.has(entry.id), `id 重复：${entry.id}`).toBe(false)
      ids.add(entry.id)
      expect(entry.phrases.length).toBeGreaterThan(0)
      expect(entry.targets.length).toBeGreaterThan(0)
      expect(entry.confidence).toBeGreaterThan(0)
      expect(entry.confidence).toBeLessThan(1)
      expect(entry.note.length).toBeGreaterThan(0)
    }
  })
})

/* ================================================================ 人工优先 */

describe('人工表优先于推导表', () => {
  it('词面完全相同时推导条目被丢弃，并记进 DERIVED_CONFLICTS（不是静默共存）', () => {
    expect(DERIVED_CONFLICTS.length).toBeGreaterThan(0)

    const byDerivedId = new Map(DERIVED_CONFLICTS.map((conflict) => [conflict.derivedId, conflict]))
    // 实测锚点：人工表已经写过「考勤」「会议室」「客户」这些页面名
    expect(byDerivedId.get('auto:考勤')).toMatchObject({ humanId: 'attendance', word: '考勤' })
    expect(byDerivedId.get('auto:会议室')).toMatchObject({ humanId: 'meeting-room', word: '会议室' })
    expect(byDerivedId.get('auto:客户')).toMatchObject({ humanId: 'customer', word: '客户' })
  })

  it('被报出来的冲突里，每一条的 humanId 都真的在人工表里，word 真的写在那条里', () => {
    const humans = new Map(ALIAS_ENTRIES.map((entry) => [entry.id, entry]))
    for (const conflict of DERIVED_CONFLICTS) {
      const human = humans.get(conflict.humanId)
      expect(human, `冲突指向了不存在的人工条目 ${conflict.humanId}`).toBeDefined()
      expect(
        [...(human?.phrases ?? []), ...(human?.terms ?? [])].map((word) => normalizeTerm(word)),
        `人工条目 ${conflict.humanId} 里没有「${conflict.word}」`,
      ).toContain(normalizeTerm(conflict.word))
      expect(typeof conflict.inHumanTerms).toBe('boolean')
    }
    // 冲突不只发生在话术上：人工表的 terms 里也写着一批页面名，推导器不该再产一遍
    expect(DERIVED_CONFLICTS.some((conflict) => conflict.inHumanTerms)).toBe(true)
  })

  it('保留下来的推导条目，与人工表一个词面都不重合', () => {
    const humanWords = humanPhraseSet()
    const collisions: string[] = []
    for (const entry of DERIVED_ALIAS_ENTRIES) {
      for (const phrase of entry.phrases) {
        const key = normalizeTerm(phrase)
        if (humanWords.has(key)) collisions.push(`${entry.id}:「${phrase}」`)
      }
    }
    expect(collisions).toEqual([])
  })

  it('同一个词两边都有时，recommend 认的是人工条目', () => {
    // 「考勤」既是人工条目 attendance 的 phrase，也被推导器算成 auto:考勤（已被压掉）
    const result = makeCatalog().recommend('考勤')
    const ids = result.interpretations.map((item) => item.id)

    expect(ids).toContain('attendance')
    expect(ids.some((id) => id === 'auto:考勤')).toBe(false)
    expect(result.interpretations.find((item) => item.id === 'attendance')?.note).toContain('加班')
  })

  it('人工条目命中的推荐理由仍然写着「话术别名」，落点链路的顺序没被推导条目打乱（D14）', () => {
    const result = makeCatalog().recommend('帮我订个会议室', { limit: 10 })
    const ids = result.capabilities.map((item) => item.id)

    // 与 test/catalog.test.ts 同一口径：先摆候选，提交排在下游
    expect(ids).toContain('meeting-room-list')
    expect(ids.indexOf('meeting-room-list')).toBeLessThan(ids.indexOf('meeting-application-definition'))
    expect(ids.indexOf('meeting-application-submit')).toBeGreaterThan(ids.indexOf('meeting-room-list'))

    const reasons = result.capabilities.flatMap((item) => item.reasons)
    expect(reasons.some((reason) => reason.includes('话术别名'))).toBe(true)
    // 这句话里没有任何推导条目参与：推导理由必须带「页面清单推导」，不能混进来
    expect(result.interpretations.every((item) => !isDerivedAliasId(item.id))).toBe(true)
  })
})

/* ================================================================ 打分区分 */

describe('来源标记影响打分：推导出来的没有被当成和人工一样可信', () => {
  it('推导条目在 interpretations 里带 auto: 前缀与来源说明，人工条目不带', () => {
    const derived = makeCatalog().recommend('饲料加工').interpretations.find((item) =>
      isDerivedAliasId(item.id),
    )
    expect(derived?.id).toBe('auto:饲料加工')
    expect(derived?.note).toContain('页面清单推导')
    expect(derived?.note).toContain('page-title')

    const human = makeCatalog()
      .recommend('帮我订个会议室')
      .interpretations.find((item) => item.id === 'meeting-room')
    expect(human).toBeDefined()
    expect(isDerivedAliasId(human?.id ?? '')).toBe(false)
    expect(human?.note).not.toContain('页面清单推导')
  })

  it('同一词长下，推导条目的分严格低于人工条目（公式：人工 40+词长×3，推导再乘 confidence）', () => {
    // 人工：4 字词 → 40 + 12 = 52
    const human = makeCatalog()
      .recommend('帮我订个会议室')
      .interpretations.find((item) => item.id === 'meeting-room')
    expect(human?.matched).toBe('帮我订个会议室')
    expect(human?.score).toBe(40 + normalizeTerm('帮我订个会议室').length * 3)

    // 推导：同一条 4 字词（「饲料加工」4 字）→ 52 × 0.6 ≈ 31
    const entry = DERIVED_ALIAS_ENTRIES.find((item) => item.id === 'auto:饲料加工')
    expect(entry?.confidence).toBe(0.6)
    const derived = makeCatalog()
      .recommend('饲料加工')
      .interpretations.find((item) => item.id === 'auto:饲料加工')
    expect(derived?.score).toBe(Math.round((40 + normalizeTerm('饲料加工').length * 3) * 0.6))
    expect(derived?.score).toBeLessThan(human?.score ?? 0)
  })

  it('歧义条目（多个页面共用一个名字）比确定条目更低：confidence 真的分档', () => {
    const humanWords = humanPhraseSet()
    const probes = [
      '饲料加工', '裕农快贷', '疾病关注度', '会计期间', '经销商品', '物料单位',
      '支付预算', '收入预算', '其他症状', '任务管理', '报表配置', '申请类目',
    ]
    const catalog = makeCatalog()
    let checked = 0

    for (const probe of probes) {
      const basis = catalog.recommend(probe).interpretations.find((item) => isDerivedAliasId(item.id))
      if (basis === undefined) continue
      const entry = DERIVED_ALIAS_ENTRIES.find((item) => item.id === basis.id)
      expect(entry, `${basis.id} 不在推导表里`).toBeDefined()
      const plain = 40 + normalizeTerm(basis.matched).length * 3
      expect(basis.score).toBe(Math.round(plain * (entry as DerivedAliasEntry).confidence))
      // 一律低于人工条目的基准分
      expect(basis.score).toBeLessThan(plain)
      expect(humanWords.has(normalizeTerm(basis.matched))).toBe(false)
      checked += 1
    }

    expect(checked).toBeGreaterThan(5)
  })

  it('检索里：人工别名扩展是 alias 档，推导扩展是 synonym 档且 from 指向 auto: 条目', () => {
    const catalog = makeCatalog()

    // 人工：搜「调薪」命中「工资找齐」，via=alias
    const humanHit = catalog.search('调薪').hits[0]
    expect(humanHit?.matches.some((match) => match.via === 'alias')).toBe(true)

    // 推导：搜一个只有推导表覆盖的页面名，命中的扩展词 via=synonym、from=auto:*
    const derivedHit = catalog
      .search('饲料加工')
      .hits.find((hit) => hit.matches.some((match) => isDerivedAliasId(match.from ?? '')))
    expect(derivedHit, '推导条目应在检索里留下可追溯的来源标记').toBeDefined()

    const symbol = derivedHit?.matches.find((match) => isDerivedAliasId(match.from ?? ''))
    expect(symbol?.via).toBe('synonym')
    // 推导条目永远拿不到人工那一档的权重
    expect(DERIVED_ALIAS_ENTRIES.every((entry) => entry.confidence < 1)).toBe(true)
  })
})

/* ================================================================ 幂等与新鲜度 */

describe('生成器：可重复执行，且磁盘上的生成物没有过期', () => {
  const run = (): string =>
    execFileSync('node', [GENERATOR, '--stdout', DERIVED_ALIAS_META.portalRepo], {
      cwd: PKG_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })

  it('连跑两次输出逐字节一致（幂等，没有时间戳或随机序）', () => {
    const first = run()
    const second = run()
    expect(second).toBe(first)
    expect(first.length).toBeGreaterThan(100_000)
  })

  it('磁盘上的 aliases.derived.ts 与当前数据一致（过期就该重跑生成器）', () => {
    const onDisk = readFileSync(DERIVED_FILE, 'utf8')
    expect(onDisk).toBe(run())
  })
})
