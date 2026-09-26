#!/usr/bin/env node
/**
 * 从 Portal 已有数据推导「话术别名」候选，产出 `src/catalog/aliases.derived.ts`。
 *
 * 为什么需要它（设计 H22 / D8）：
 * 人工别名表（`src/catalog/aliases.ts`）是"用户会怎么说 → Portal 里是哪个能力/页面"的
 * 校对过的映射。目录有 1,019 个页面、将来要覆盖几百个，**每加一个页面都让人手写别名
 * 这条路走不远**。但两者其实不是一回事：
 *
 *   - **落点**（这句话对应的页面/域/能力）完全可以从数据里算出来：
 *     页面标题、菜单分组名、能力标题与参数、路由里的英文段、业务域中文名。
 *   - **话术**（用户会怎么开口）算不出来。没有任何数据源写着「调薪」=「工资找齐」，
 *     也没有数据源写着「订个会议室」这种口语。这一层只能人写。
 *
 * 所以本生成器只做前一半，并且**不假装两半一样可信**：每条候选都带
 * `derivedFrom`（来源）与 `confidence`（置信度），`recommend` / `search` 据此打折。
 *
 * 人工表优先：推导出的条目与人工条目「词面完全相同」时，推导条目被丢弃，
 * 并记录进生成物的 `DERIVED_CONFLICTS`（不是静默丢掉——静默丢掉就没人知道
 * 哪些页面其实已经被人手覆盖了）。
 *
 * 用法：
 *   node tools/generate/derive-aliases.mjs [Portal 仓库路径]
 *   node tools/generate/derive-aliases.mjs --stdout [Portal 仓库路径]
 *   默认读取 PORTAL_REPO 环境变量，否则用 DEFAULT_PORTAL_REPO。
 *
 * `--stdout` 只把结果打到标准输出、不落盘——测试用它验幂等与"生成物是否过期"。
 *
 * 只读：本脚本不修改 Portal 仓库，也不修改任何非生成物文件。
 * 幂等：输出只由输入数据决定，重复执行结果逐字节一致（没有时间戳、没有随机序）。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const CATALOG_FILE = path.join(PKG_ROOT, 'generated/page-catalog.json')
const CAPABILITIES_ENTRY = path.join(PKG_ROOT, 'dist/capabilities/index.js')
const ALIASES_FILE = path.join(PKG_ROOT, 'src/catalog/aliases.ts')
const OUT_FILE = path.join(PKG_ROOT, 'src/catalog/aliases.derived.ts')

const DEFAULT_PORTAL_REPO = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const ARGS = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const STDOUT_ONLY = process.argv.includes('--stdout')
const PORTAL_REPO = path.resolve(ARGS[0] || process.env.PORTAL_REPO || DEFAULT_PORTAL_REPO)
const MENUS_DIR = path.join(PORTAL_REPO, 'app/portal/menus')

function die (message) {
  process.stderr.write(`[derive-aliases] ${message}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 通用：归一化（必须与 src/catalog/match.ts 的 normalizeTerm 同口径）
// ---------------------------------------------------------------------------
function normalizeTerm (input) {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[_\-/\\]+/g, '')
}

/**
 * 页面标题 → 概念词干。
 * 「会议室列表」和「会议室管理」指的是同一个概念，落到检索上唯一的差别是那两字后缀；
 * 但「考勤统计」的干是「考勤」而「考勤档案」的干是自己——这不是 bug，
 * 是"树形标题"里只有一个是父节点词。推导器只做机械剥离，歧义交给 confidence。
 */
const TITLE_SUFFIXES = [
  '列表页', '列表', '查询页', '查询', '管理页', '管理', '报表', '明细', '设置',
  '记录', '详情', '首页', '台账', '统计', '维护', '一览', '页',
]

function stemOf (title) {
  const trimmed = String(title).trim()
  for (const suffix of TITLE_SUFFIXES) {
    if (trimmed.length > suffix.length + 1 && trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length)
    }
  }
  return trimmed
}

/** 标题里带这些字眼的行不是业务概念（占位、iframe 壳），不进候选 */
const NOISE_TITLE = /未命名|未知|测试|iframe/i

function readJson (file) {
  if (!fs.existsSync(file)) die(`找不到 ${file}，先跑 \`pnpm generate\``)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// ---------------------------------------------------------------------------
// 来源 0：人工表（用于冲突判定与优先级）
// ---------------------------------------------------------------------------
/** 从 TS 数据文件里读 `key: [ '...', ... ]` —— 只做括号配对，不引 TS 解析器 */
function readStringArray (text, key) {
  const at = text.indexOf(`${key}: [`)
  if (at < 0) return []
  let depth = 0
  let end = -1
  for (let i = text.indexOf('[', at); i < text.length; i += 1) {
    if (text[i] === '[') depth += 1
    else if (text[i] === ']') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) return []
  const body = text.slice(text.indexOf('[', at) + 1, end)
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1])
}

function readHumanAliases () {
  const text = fs.readFileSync(ALIASES_FILE, 'utf8')
  const start = text.indexOf('export const ALIAS_ENTRIES')
  const end = text.indexOf('\n]', start)
  const body = text.slice(start, end < 0 ? text.length : end)
  const entries = []
  // 条目以 `  {\n    id: 'xxx',` 开头
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const id = /id:\s*'([^']+)'/.exec(chunk)
    if (id === null) continue
    entries.push({
      id: id[1],
      phrases: readStringArray(chunk, 'phrases'),
      terms: readStringArray(chunk, 'terms'),
    })
  }
  // 域标签表：`'domain': '中文',`
  const labels = {}
  const labelStart = text.indexOf('export const DOMAIN_LABELS')
  const labelEnd = text.indexOf('\n}', labelStart)
  for (const m of text.slice(labelStart, labelEnd < 0 ? text.length : labelEnd).matchAll(/'([^']+)':\s*'([^']*)'/g)) {
    labels[m[1]] = m[2]
  }
  return { entries, labels }
}

// ---------------------------------------------------------------------------
// 来源 1：菜单分组名（app/portal/menus/**/*.js）
// ---------------------------------------------------------------------------
function readMenuGroupTitles () {
  if (!fs.existsSync(MENUS_DIR)) {
    // 不静默降级：菜单读不到时会少一批 terms，生成物会静默变差
    die(`找不到 Portal 菜单源码：${MENUS_DIR}\n请传入正确的仓库路径，或设置 PORTAL_REPO。`)
  }
  const titles = new Set()
  let files = 0
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.js') && !name.endsWith('.json')) continue
      files += 1
      const text = fs.readFileSync(full, 'utf8')
      for (const line of text.split('\n')) {
        // 有 title 没有 path 的才是分组节点；`// { path: ... }` 注释行天然被跳过
        if (/^\s*\/\//.test(line)) continue
        const m = /title:\s*'([^']+)'/.exec(line) || /"title"\s*:\s*"([^"]+)"/.exec(line)
        if (m !== null && !/path\s*:/.test(line)) titles.add(m[1].trim())
      }
    }
  }
  walk(MENUS_DIR)
  return { titles: [...titles], files }
}

// ---------------------------------------------------------------------------
// 来源 2：SDK 实际注册能力（pnpm build → dist/capabilities/index.js）
// ---------------------------------------------------------------------------
async function readCapabilities () {
  // Source formatting is not a registry: regex scanning misses mapped arrays and compact definitions.
  // Same authoritative registry as the SDK. Build first; never count unregistered source files.
  if (!fs.existsSync(CAPABILITIES_ENTRY)) die('缺少能力构建产物，先运行 pnpm build')
  const { ALL_CAPABILITY_DEFINITIONS } = await import(pathToFileURL(CAPABILITIES_ENTRY).href)
  return ALL_CAPABILITY_DEFINITIONS.map(({ id, title, pagePath }) => ({ id, title, pagePath }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---------------------------------------------------------------------------
// 推导
// ---------------------------------------------------------------------------
const MAX_TARGETS_PER_ENTRY = 12

/** 域级候选的通用词黑名单：这些标签单独成条会污染检索（「管理」几乎命中所有话术） */
const GENERIC_LABELS = new Set([
  '管理', '设置', '统计', '分析', '报表', '工具', '工具箱', '基础数据', '首页',
  '个人中心', '分配', '流程', '合同', '组织机构',
])

function deriveEntries (rows, menuGroupTitles, capabilities, human, labels) {
  const pages = rows.filter((row) => typeof row.menuPath === 'string' && row.menuPath.length > 0)

  // 页面标题 → 干 分组
  const byStem = new Map()
  for (const page of pages) {
    if (page.title === null || page.title === undefined) continue
    if (NOISE_TITLE.test(page.title) || page.title.trim().length < 2) continue
    const stem = stemOf(page.title)
    if (stem.length < 2) continue
    if (!byStem.has(stem)) byStem.set(stem, [])
    byStem.get(stem).push(page)
  }

  const capabilitiesByPage = new Map()
  for (const capability of capabilities) {
    if (!capabilitiesByPage.has(capability.pagePath)) capabilitiesByPage.set(capability.pagePath, [])
    capabilitiesByPage.get(capability.pagePath).push(capability)
  }

  const candidates = []

  /* ---- 来源 page-title / page-title-shared ---- */
  for (const [stem, group] of byStem) {
    const sorted = [...group].sort((a, b) => (a.menuPath < b.menuPath ? -1 : 1))
    const titles = [...new Set(sorted.map((page) => page.title.trim()))].sort()
    const shared = sorted.length > 1

    const phrases = [...new Set([...titles, stem])].sort()
    const terms = new Set()
    for (const title of titles) { terms.add(title); terms.add(stemOf(title)) }
    terms.add(stem)
    for (const page of sorted) {
      const domainLabel = labels[page.domain]
      if (typeof domainLabel === 'string') terms.add(domainLabel)
      const segments = page.menuPath.split('/').filter((segment) => segment.length > 0)
      const last = segments[segments.length - 1]
      if (typeof last === 'string' && last !== 'list') terms.add(last)
      if (typeof segments[1] === 'string') terms.add(segments[1])
    }
    // 菜单分组名只在"包含该概念词"时才算它的说法（否则「组织管理」会变成会议室的别名）
    for (const groupTitle of menuGroupTitles) {
      if (normalizeTerm(groupTitle).includes(normalizeTerm(stem))) terms.add(groupTitle)
    }

    const targets = []
    for (const page of sorted.slice(0, MAX_TARGETS_PER_ENTRY)) {
      targets.push({ type: 'page', menuPath: page.menuPath })
    }
    const domains = [...new Set(sorted.map((page) => page.domain))].sort()
    for (const domain of domains) targets.push({ type: 'domain', id: domain, weight: 0.7 })
    // 已登记能力跟着它所在的页面一起进候选 —— 这一步把"页面 → 能力"这层
    // 目录里本来就有的关系带进了话术层，不需要人再写一遍。
    const capabilityIds = []
    for (const page of sorted) {
      for (const capability of capabilitiesByPage.get(page.menuPath) ?? []) capabilityIds.push(capability.id)
    }
    for (const capabilityId of [...new Set(capabilityIds)].sort()) {
      targets.push({ type: 'capability', id: capabilityId, weight: 0.8 })
    }

    const pagesText = sorted.slice(0, 4).map((page) => page.menuPath).join('、')
    candidates.push({
      id: `auto:${stem}`,
      derivedFrom: shared ? 'page-title-shared' : 'page-title',
      confidence: shared ? 0.35 : 0.6,
      note: shared
        ? `由页面清单推导：${sorted.length} 个页面共用「${stem}」这个名字（${pagesText}${sorted.length > 4 ? ' 等' : ''}），落点有歧义，按 title 判断`
        : `由页面清单推导：菜单里的「${stem}」（${sorted[0].menuPath}）`,
      phrases,
      terms: [...terms].sort(),
      targets,
    })
  }

  /* ---- 来源 domain-label ---- */
  const humanDomainTargets = new Set()
  for (const entry of human.entries) {
    for (const m of entry.terms) humanDomainTargets.add(normalizeTerm(m))
  }
  for (const [domain, label] of Object.entries(labels)) {
    if (GENERIC_LABELS.has(label) || label.length < 2) continue
    const domainPages = pages.filter((page) => page.domain === domain)
    if (domainPages.length === 0) continue
    candidates.push({
      id: `auto:domain:${domain}`,
      derivedFrom: 'domain-label',
      confidence: 0.3,
      note: `由业务域中文名推导：菜单路径第二段 \`${domain}\` 的域叫「${label}」，该域下有 ${domainPages.length} 个页面`,
      phrases: [label],
      terms: [label, domain],
      targets: [
        { type: 'domain', id: domain },
        ...(domainPages.length <= 3
          ? domainPages.map((page) => ({ type: 'page', menuPath: page.menuPath, weight: 0.6 }))
          : []),
      ],
    })
  }

  /* ---- 来源 capability-title ---- */
  const pageTitlesNorm = new Set(pages.map((page) => normalizeTerm(page.title)))
  for (const capability of capabilities) {
    if (pageTitlesNorm.has(normalizeTerm(capability.title))) continue
    candidates.push({
      id: `auto:capability:${capability.id}`,
      derivedFrom: 'capability-title',
      confidence: 0.8,
      note: `由能力标题推导：能力 \`${capability.id}\` 叫「${capability.title}」`,
      phrases: [capability.title],
      terms: [capability.title],
      targets: [{ type: 'capability', id: capability.id }],
    })
  }

  return candidates
}

/**
 * 冲突：推导条目的某个 phrase 与人工条目写过的某个词归一化后完全相同 → 人工赢。
 *
 * 比的是**人工条目的 phrases 与 terms 两侧**：`terms` 里写的也是人已经登记过的知识
 * （「合同创建」「工资找齐」这类页面名），推导器再产一条同名条目就是重复，
 * 不是"两条各自有用"。冲突的推导条目整条丢弃——半条留着更糟，
 * 上游会看到两个来源给出同一批落点，却只有一个是对的。
 */
function splitConflicts (candidates, human) {
  const humanWords = new Map()
  for (const entry of human.entries) {
    for (const word of [...entry.phrases, ...entry.terms]) {
      const key = normalizeTerm(word)
      if (key.length === 0) continue
      if (!humanWords.has(key)) humanWords.set(key, { id: entry.id, inTerms: !entry.phrases.includes(word) })
    }
  }
  const kept = []
  const conflicts = []
  for (const candidate of candidates) {
    let hit = null
    for (const phrase of candidate.phrases) {
      const owner = humanWords.get(normalizeTerm(phrase))
      if (owner !== undefined) { hit = { word: phrase, humanId: owner.id, inTerms: owner.inTerms }; break }
    }
    if (hit === null) kept.push(candidate)
    else {
      conflicts.push({
        derivedId: candidate.id,
        humanId: hit.humanId,
        word: hit.word,
        inHumanTerms: hit.inTerms,
      })
    }
  }
  return { kept, conflicts }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const SOURCE_DOC = `/**
 * 话术别名候选 —— **由 \`tools/generate/derive-aliases.mjs\` 生成，勿手改。**
 *
 * 重新生成：\`node tools/generate/derive-aliases.mjs\`
 *
 * 这份表与人工表（\`aliases.ts\`）的区别，是这份表存在的全部理由：
 *
 * | | 人工表 \`ALIAS_ENTRIES\` | 本表 \`DERIVED_ALIAS_ENTRIES\` |
 * | --- | --- | --- |
 * | 来源 | 人写的，校对过 | 页面清单 / 菜单分组 / 能力定义 / 域标签 |
 * | 覆盖 | 19 个概念、34 个页面 | 全部有标题的菜单页 |
 * | 内容 | **用户会怎么说**（「调薪」「订个会议室」） | **Portal 里它叫什么** + 落点 |
 * | 可信度 | 高（\`via: 'alias'\`，权重 0.85） | 按 \`confidence\` 打折（\`via: 'synonym'\`，权重 0.75） |
 * | 冲突 | 赢，推导条目被丢弃 | 让位，记录进 \`DERIVED_CONFLICTS\` |
 *
 * **话术推不出来**：没有任何数据源写着「调薪」等于菜单里的「工资找齐」，
 * 也没有数据源写着「订个会议室」这种口语。所以本表覆盖的是**落点**，
 * 不是**说法**——它让 900 多个页面不用人手写别名就能被检索到，
 * 但一个页面**能被 AI 听懂几种说法**，仍然取决于人工表。
 *
 * ⚠️ 本文件里 \`phrases\` 的词面来自页面标题，不是"用户说过的话"。
 * 打分必须据此打折，否则「考勤」这种页面自己就叫的名字会盖过人工校对过的黑话翻译。
 */
`

function emit (kept, conflicts, meta) {
  const lines = []
  lines.push(SOURCE_DOC)
  lines.push(`import type { AliasTarget } from './aliases.js'`)
  lines.push('')
  lines.push('/** 推导来源。人工表没有这个概念，因为没有"来源"可标。 */')
  lines.push('export type DerivedAliasSource =')
  lines.push("  | 'page-title'")
  lines.push("  | 'page-title-shared'")
  lines.push("  | 'domain-label'")
  lines.push("  | 'capability-title'")
  lines.push('')
  lines.push('/**')
  lines.push(' * 一条推导出来的别名候选。')
  lines.push(' *')
  lines.push(' * \`confidence\` 是**打分系数**，不是"概率"：人工条目的基准分是')
  lines.push(` * \`ALIAS_BASE + 词长×3\`，推导条目在此基础上乘 \`confidence\`。`)
  lines.push(' * \`recommend\` / \`search\` 用 \`derivedFrom\` 解释来源，用 \`confidence\` 决定分量。')
  lines.push(' */')
  lines.push('export type DerivedAliasEntry = {')
  lines.push('  id: string')
  lines.push('  note: string')
  lines.push('  phrases: string[]')
  lines.push('  terms: string[]')
  lines.push('  targets: AliasTarget[]')
  lines.push('  derivedFrom: DerivedAliasSource')
  lines.push('  /** 0~1，越大越可信。人工条目视为 1（但它不在本表里） */')
  lines.push('  confidence: number')
  lines.push('}')
  lines.push('')
  lines.push('/** 生成这份表的输入快照，用于判断"推导结果是不是过期了" */')
  lines.push('export const DERIVED_ALIAS_META = {')
  lines.push(`  pageCatalogHash: ${JSON.stringify(meta.pageCatalogHash)},`)
  lines.push(`  portalRepo: ${JSON.stringify(meta.portalRepo)},`)
  lines.push(`  totalPages: ${meta.totalPages},`)
  lines.push(`  menuFiles: ${meta.menuFiles},`)
  lines.push(`  menuGroupTitles: ${meta.menuGroupTitles},`)
  lines.push(`  capabilityCount: ${meta.capabilityCount},`)
  lines.push(`  derivedEntries: ${kept.length},`)
  lines.push(`  suppressedByHuman: ${conflicts.length},`)
  lines.push('} as const')
  lines.push('')
  lines.push('/**')
  lines.push(' * 被人工表压掉的候选：同一个词面，人工表已经写过一遍。')
  lines.push(' * 保留这份清单是为了让"人工表其实一直在重复覆盖同一批显然的页面"这件事可见。')
  lines.push(' */')
  lines.push('export const DERIVED_CONFLICTS: ReadonlyArray<{')
  lines.push('  derivedId: string')
  lines.push('  humanId: string')
  lines.push('  word: string')
  lines.push('  /** true 表示人工表是把它当检索扩展词（terms）写的，不是当话术（phrases）写的 */')
  lines.push('  inHumanTerms: boolean')
  lines.push('}> = [')
  for (const conflict of conflicts) {
    lines.push(
      `  { derivedId: ${JSON.stringify(conflict.derivedId)}, humanId: ${JSON.stringify(conflict.humanId)}, word: ${JSON.stringify(conflict.word)}, inHumanTerms: ${conflict.inHumanTerms} },`,
    )
  }
  lines.push(']')
  lines.push('')
  lines.push('/**')
  lines.push(' * 推导条目。**优先级低于** \`ALIAS_ENTRIES\`：')
  lines.push(' * 同一概念两边都有时人工条目赢，对应的推导条目在生成期就被丢弃（见 \`DERIVED_CONFLICTS\`）。')
  lines.push(' */')
  lines.push('export const DERIVED_ALIAS_ENTRIES: DerivedAliasEntry[] = [')
  for (const entry of kept) {
    lines.push('  {')
    lines.push(`    id: ${JSON.stringify(entry.id)},`)
    lines.push(`    derivedFrom: ${JSON.stringify(entry.derivedFrom)},`)
    lines.push(`    confidence: ${entry.confidence},`)
    lines.push(`    note: ${JSON.stringify(entry.note)},`)
    lines.push(`    phrases: ${JSON.stringify(entry.phrases)},`)
    lines.push(`    terms: ${JSON.stringify(entry.terms)},`)
    lines.push(`    targets: [${entry.targets.map((target) => JSON.stringify(target)).join(', ')}],`)
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const catalog = readJson(CATALOG_FILE)
const human = readHumanAliases()
const menus = readMenuGroupTitles()
const capabilities = await readCapabilities()

const candidates = deriveEntries(
  catalog.items ?? [],
  menus.titles,
  capabilities,
  human,
  human.labels,
)
const { kept, conflicts } = splitConflicts(candidates, human)
kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
conflicts.sort((a, b) => (a.derivedId < b.derivedId ? -1 : a.derivedId > b.derivedId ? 1 : 0))

const meta = {
  // 用**内容哈希**而不是 generatedAt 做新鲜度判据。
  // 时间戳每次重新生成都会变，拿它当"过期了没"的信号会导致：
  // 只要有人跑过一次 pnpm generate，这份生成物就被判为过期——哪怕内容一个字没变。
  // （这个缺陷是 `pnpm docs` 串起来之后才暴露的。）
  pageCatalogHash: crypto
    .createHash('sha1')
    .update(JSON.stringify(catalog.items ?? []))
    .digest('hex')
    .slice(0, 12),
  portalRepo: catalog.portalRepo ?? '',
  totalPages: (catalog.items ?? []).length,
  menuFiles: menus.files,
  menuGroupTitles: menus.titles.length,
  capabilityCount: capabilities.length,
}

const source = emit(kept, conflicts, meta)
const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null
const changed = previous !== source

if (STDOUT_ONLY) {
  // 不能在这里 process.exit()：stdout 是管道时进程提前退出会截断未刷出的内容，
  // 调用方（测试）会拿到半份文件，看着像"生成物不一致"。
  process.stdout.write(source)
} else {
  fs.writeFileSync(OUT_FILE, source)
}
// --stdout 的 stdout 专门留给生成物本身，人看的报告走 stderr，两者不混
const report = STDOUT_ONLY ? process.stderr : process.stdout

const bySource = new Map()
for (const entry of kept) bySource.set(entry.derivedFrom, (bySource.get(entry.derivedFrom) ?? 0) + 1)

report.write(
  [
    `[derive-aliases] 页面清单 ${meta.totalPages} 行（内容哈希 ${meta.pageCatalogHash}）`,
    `[derive-aliases] 菜单分组名 ${meta.menuGroupTitles} 个 / 能力定义 ${meta.capabilityCount} 条 / 人工条目 ${human.entries.length} 条`,
    `[derive-aliases] 候选 ${candidates.length} 条 → 保留 ${kept.length} 条，被人工表压掉 ${conflicts.length} 条（其中 ${conflicts.filter((c) => c.inHumanTerms).length} 条是人工表当 terms 写过的）`,
    ...[...bySource.entries()].sort().map(([from, count]) => `[derive-aliases]   ${from}: ${count}`),
    `[derive-aliases] 被压掉的（人工已覆盖）：${
      conflicts.slice(0, 8).map((c) => `${c.derivedId}→${c.humanId}`).join('、') || '(无)'
    }${conflicts.length > 8 ? ` 等 ${conflicts.length} 条` : ''}`,
    STDOUT_ONLY
      ? `[derive-aliases] 只输出不落盘（--stdout）；与磁盘上 ${path.relative(PKG_ROOT, OUT_FILE)} 相比${changed ? '**有差异，生成物已过期**' : '一致'}`
      : `[derive-aliases] 写入 ${path.relative(PKG_ROOT, OUT_FILE)}（${changed ? '内容有变化' : '内容无变化，幂等'}）`,
    '',
  ].join('\n'),
)
