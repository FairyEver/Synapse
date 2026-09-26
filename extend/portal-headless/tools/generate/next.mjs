#!/usr/bin/env node
/**
 * 「接下来做哪几个页面」——让「继续实施」有确定性的下一步。
 *
 *   pnpm next                # 下一批（默认 5 个）
 *   pnpm next --count 10
 *   pnpm next --domain finance
 *   pnpm next --why          # 顺带打印队列规则与跳过原因
 *   pnpm next --json         # 机器可读
 *
 * 完成状态是**推导**的：页面只要有任一能力指向它就算完成。
 * 手工维护的只有 docs/plan.json 里的「队列规则」与「跳过」。
 *
 * 输出刻意带够上下文（路由文件、是否写页面、命中了哪条规则），
 * 好让接到这一批的人不用再去查别的地方就能开工。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

const catalogFile = path.join(PKG_ROOT, 'generated/page-catalog.json')
const scopeFile = path.join(PKG_ROOT, 'generated/portal-scope.json')
const planFile = path.join(PKG_ROOT, 'docs/plan.json')
const distEntry = path.join(PKG_ROOT, 'dist/index.js')

for (const [file, hint] of [[catalogFile, 'pnpm generate'], [scopeFile, 'pnpm generate'], [planFile, '(计划文件缺失)'], [distEntry, 'pnpm build']]) {
  if (!fs.existsSync(file)) {
    process.stderr.write(`[next] 缺少 ${path.relative(PKG_ROOT, file)}，先跑 ${hint}\n`)
    process.exit(1)
  }
}

const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'))
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
const portal = (await import(distEntry)).createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token: 'placeholder', tenantId: 1 },
})

const count = Number(value('--count', plan.批次?.['默认取几个'] ?? 5))
const domainFilter = value('--domain', null)

/** 完成状态：页面被任一能力指向即算完成 */
const donePaths = new Set(portal.capabilities.map((c) => c.pagePath).filter(Boolean))
const scopePaths = new Set(
  (scope.items ?? [])
    .filter((item) => item.included === true && item.menuPath !== null)
    .map((item) => item.menuPath),
)
if (scopePaths.size === 0) {
  process.stderr.write('[next] generated/portal-scope.json 没有可调用菜单路径，先检查范围生成物\n')
  process.exit(1)
}

/** 队列规则的匹配：空匹配 = 兜底 */
function matches (rule, item) {
  const m = rule.匹配 ?? {}
  if (m.kind && !m.kind.includes(item.kind)) return false
  if (m.domain && !m.domain.includes(item.domain)) return false
  return true
}

function skipReason (item) {
  for (const s of plan.跳过 ?? []) {
    if (matches(s, item)) return s.原因
  }
  return null
}

function ruleFor (item) {
  for (const rule of plan.队列规则 ?? []) {
    if (matches(rule, item)) return rule
  }
  return { id: '(未匹配任何规则)', 为什么: '兜底：规则表没覆盖到这一类，可能该补一条规则' }
}

const all = catalog.items
const scoped = all.filter((item) => item.menuPath !== null && scopePaths.has(item.menuPath))
const skipped = []
const pendingByRule = new Map()

for (const item of all) {
  if (item.menuPath !== null && !scopePaths.has(item.menuPath)) {
    skipped.push({ item, reason: '不在 generated/portal-scope.json 的保留菜单范围内' })
    continue
  }
  if (item.menuPath === null) continue
  if (item.menuPath && donePaths.has(item.menuPath)) continue
  const reason = skipReason(item)
  if (reason) {
    skipped.push({ item, reason })
    continue
  }
  const rule = ruleFor(item)
  if (!pendingByRule.has(rule.id)) pendingByRule.set(rule.id, { rule, items: [] })
  pendingByRule.get(rule.id).items.push(item)
}

// 按规则顺序展开，规则内按「域 → 路径」排序：先把一个业务域做完，而不是满地图撒
const queue = []
for (const rule of plan.队列规则 ?? []) {
  const bucket = pendingByRule.get(rule.id)
  if (!bucket) continue
  bucket.items.sort((a, b) => (a.domain === b.domain ? a.menuPath.localeCompare(b.menuPath) : a.domain.localeCompare(b.domain)))
  queue.push(...bucket.items.map((item) => ({ item, rule })))
}
for (const [id, bucket] of pendingByRule) {
  if (id.startsWith('(')) queue.push(...bucket.items.map((item) => ({ item, rule: bucket.rule })))
}

const filtered = domainFilter ? queue.filter((x) => x.item.domain === domainFilter) : queue
const batch = filtered.slice(0, count)

if (flag('--json')) {
  process.stdout.write(
    JSON.stringify(
      {
        总数: all.length,
        范围页面总数: scoped.length,
        已完成: scoped.filter((i) => donePaths.has(i.menuPath)).length,
        已跳过: skipped.length,
        队列长度: queue.length,
        本批: batch.map(({ item, rule }) => ({
          menuPath: item.menuPath,
          页面名: item.title,
          业务域: item.domain,
          形态: item.kind,
          写: item.write,
          路由文件: item.routeFile,
          moduleType: item.moduleType,
          命中规则: rule.id,
        })),
      },
      null,
      2,
    ) + '\n',
  )
  process.exit(0)
}

const doneCount = scoped.filter((i) => donePaths.has(i.menuPath)).length
const pct = ((doneCount / scoped.length) * 100).toFixed(1)

const line = (s = '') => process.stdout.write(s + '\n')

line()
line(`范围进度：${doneCount} / ${scoped.length} 页面已完成（${pct}）｜待做 ${queue.length}｜跳过 ${skipped.length}`)
line(`目录总数：${all.length}；范围外目录项已从队列排除`)
if (domainFilter) line(`（已按 --domain ${domainFilter} 过滤）`)
line()

if (!batch.length) {
  line('队列为空。要么都做完了，要么 --domain 过滤之后没有剩的。')
  line('（跑 `pnpm next --why` 看队列规则与跳过清单。）')
  process.exit(0)
}

line(`下一批（${batch.length} 个）：`)
line()
batch.forEach(({ item, rule }, i) => {
  line(`${i + 1}. ${item.title || '(无标题)'}　${item.domain}　${item.kind}${item.write ? '　**含写操作**' : ''}`)
  line(`   页面：${item.menuPath}`)
  line(`   源码：${item.routeFile ?? '(未解析)'}`)
  line(`   规则：${rule.id}`)
  line()
})

if (flag('--why')) {
  line('队列规则（按顺序）：')
  for (const rule of plan.队列规则 ?? []) {
    const n = pendingByRule.get(rule.id)?.items.length ?? 0
    line(`  ${rule.id}（待做 ${n}）—— ${rule.为什么}`)
  }
  line()
  line(`跳过 ${skipped.length} 个：`)
  const byReason = new Map()
  for (const { reason } of skipped) byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
  for (const [reason, n] of byReason) line(`  ${n} 个 —— ${reason}`)
  line()
}

line('做完一个页面之后：')
line('  · 能力定义进 src/capabilities/')
line('  · 四件套记到 docs/pages/')
line('  · 改了能力定义就跑 pnpm generate 重建 generated/ 的运行时资源')
line('  · 页面只要有能力指向它，pnpm next 就会自动把它算作已完成')
