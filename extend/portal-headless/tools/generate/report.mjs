#!/usr/bin/env node
/**
 * 生成「覆盖与进度」报告：这个 SDK 现在做到哪了、能力分布在哪。
 *
 * 输入全部是既有生成物与能力定义，不新增任何手写数据源：
 *   generated/page-catalog.json   1019 行页面清单（由 Portal 源码推导）
 *   generated/module-type-rules.json
 *   能力定义（来自 dist/index.js，因为写在 TypeScript 里）
 *
 * 产出：
 *   generated/coverage.md    给人读 / 给 AI 读
 *   generated/coverage.html  自包含，双击即开，带横向条形图（无 JS、无依赖）
 *
 * 用法：pnpm build && pnpm report
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const GENERATED = path.join(PKG_ROOT, 'generated')

const catalogFile = path.join(GENERATED, 'page-catalog.json')
const distEntry = path.join(PKG_ROOT, 'dist/index.js')

if (!fs.existsSync(catalogFile)) {
  process.stderr.write('[report] 缺少 generated/page-catalog.json，先跑 `pnpm generate`\n')
  process.exit(1)
}
if (!fs.existsSync(distEntry)) {
  process.stderr.write('[report] 缺少 dist/index.js，先跑 `pnpm build`\n')
  process.exit(1)
}

const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
/**
 * 批量生成器的报告。它是**批量接线范围**的唯一权威来源，所以这里直接读它，
 * 而不是在报告里重算一遍——重算就会有两份数字，迟早对不上。
 * 文件不在时（还没跑过批量生成器）这一节整个跳过，不影响其它节。
 */
const batchReportFile = path.join(PKG_ROOT, 'src/capabilities/generated/batch-report.json')
const batch = fs.existsSync(batchReportFile) ? JSON.parse(fs.readFileSync(batchReportFile, 'utf8')) : null
const batchSplit = batch?.['全量外推·按 http 实例范围拆分'] ?? null
const batchLegacy = batch?.['全量外推（255 个声明式列表页同一条代码路径）'] ?? null
const roadmapFile = path.join(PKG_ROOT, 'docs/roadmap.json')
const roadmap = fs.existsSync(roadmapFile) ? JSON.parse(fs.readFileSync(roadmapFile, 'utf8')) : null
const mod = await import(distEntry)
const portal = mod.createPortalHeadless({
  baseUrl: 'https://biz-api-test.wodecorp.cn',
  credential: { token: 'placeholder', tenantId: 1 },
})
const capabilities = portal.capabilities

// ---------------------------------------------------------------------------
// 把能力挂回页面清单
// ---------------------------------------------------------------------------
const byMenuPath = new Map()
for (const item of catalog.items) {
  if (item.menuPath) byMenuPath.set(item.menuPath, item)
}

const implementedPageIds = new Set()
const capabilityOnlyPaths = []
const capabilityRows = capabilities.map((cap) => {
  const row = cap.pagePath ? byMenuPath.get(cap.pagePath) : undefined
  if (row) implementedPageIds.add(row.id)
  else capabilityOnlyPaths.push(cap.pagePath)
  return {
    id: cap.id,
    title: cap.title,
    pagePath: cap.pagePath ?? '(无)',
    write: cap.write === true,
    params: cap.params.length,
    required: cap.params.filter((p) => p.required).length,
    longOptions: cap.params.filter((p) => p.kind === 'search' || p.kind === 'tree').length,
    inCatalog: Boolean(row),
  }
})

// ---------------------------------------------------------------------------
// 分布
// ---------------------------------------------------------------------------
function tally (items, keyFn) {
  const m = new Map()
  for (const item of items) {
    const k = keyFn(item)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const items = catalog.items
const total = items.length
const implemented = implementedPageIds.size
const writePages = items.filter((i) => i.write === true).length
const withModuleType = items.filter((i) => i.moduleType !== null).length

const byDomain = tally(items, (i) => i.domain)
const byKind = tally(items, (i) => i.kind)
const byModuleType = tally(items.filter((i) => i.moduleType !== null), (i) => i.moduleTypeLabel || `${i.moduleType}`)

/** 每个域里有多少页面已经有能力实现 */
function implementedInDomain (domain) {
  let n = 0
  for (const item of items) {
    if (item.domain === domain && implementedPageIds.has(item.id)) n += 1
  }
  return n
}

// ---------------------------------------------------------------------------
// 环境信息（能让报告自证是哪份产物生成的）
// ---------------------------------------------------------------------------
function gitShort () {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PKG_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return '(非 git 仓库)'
  }
}
function gitDirty () {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: PKG_ROOT, encoding: 'utf8' })
    return out.trim().length > 0
  } catch {
    return false
  }
}

const meta = {
  generatedAt: new Date().toISOString(),
  commit: gitShort(),
  dirty: gitDirty(),
  portalRepo: catalog.portalRepo,
  catalogGeneratedAt: catalog.generatedAt,
}

const pct = (n, d) => (d === 0 ? '0.0%' : `${((n / d) * 100).toFixed(1)}%`)

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
function bar (n, max, width = 24) {
  const filled = max === 0 ? 0 : Math.round((n / max) * width)
  return '█'.repeat(filled) + '·'.repeat(Math.max(0, width - filled))
}

const md = []
md.push('# Portal Headless SDK —— 覆盖与进度')
md.push('')
md.push(`- 生成时间：${meta.generatedAt}　提交：\`${meta.commit}\`${meta.dirty ? '（**工作区有未提交改动**）' : ''}`)
md.push(`- 页面清单来自：\`${meta.portalRepo}\`（生成于 ${meta.catalogGeneratedAt}）`)
md.push('')
md.push('> 本文件由 `tools/generate/report.mjs` 生成，不要手改。数字全部来自生成物与能力定义本身。')
md.push('')

md.push('## 一、总览')
md.push('')
md.push('| 项 | 数 | 占比 |')
md.push('| --- | --- | --- |')
md.push(`| 页面总数（菜单叶子 + iframe） | ${total} | 100% |`)
md.push(`| **已实现能力的页面** | **${implemented}** | **${pct(implemented, total)}** |`)
md.push(`| 待处理页面 | ${total - implemented} | ${pct(total - implemented, total)} |`)
md.push(`| 能力总数 | ${capabilities.length}（其中写能力 ${capabilities.filter((c) => c.write).length} 个） | — |`)
md.push(`| 含写操作的页面（清单口径） | ${writePages} | ${pct(writePages, total)} |`)
md.push(`| 能推出 module-type 的页面 | ${withModuleType} | ${pct(withModuleType, total)} |`)
md.push('')
md.push('另有一批**不在页面清单里**的入口（流程表单类，走「发起流程」到达，见设计 D9）：')
for (const p of [...new Set(capabilityOnlyPaths)]) md.push(`- \`${p}\``)
md.push('')
md.push('> 页面覆盖率低是**符合阶段预期的**：阶段① 的目标是「验证方法 + 跑通一条业务线」，')
md.push('> 不是铺量。真正说明进度的是下一节的路线图，而不是这个百分比。')
md.push('')

if (roadmap) {
  md.push('## 二、方法与进度（路线图，手工维护）')
  md.push('')
  md.push(`> 来源：\`docs/roadmap.json\`。这一节与自动统计的页面覆盖数是两回事——`)
  md.push('> 「有哪些环节已经建成」只有人能判断，所以它是手工维护的，每条都要求留证据。')
  md.push('')
  for (const phase of roadmap.阶段) {
    md.push(`### ${phase.名称}　\`${phase.状态}\``)
    md.push('')
    if (!phase.环节?.length) {
      md.push('（尚未展开）')
      md.push('')
      continue
    }
    md.push('| 项 | 状态 | 证据 / 阻塞原因 |')
    md.push('| --- | --- | --- |')
    for (const item of phase.环节) {
      const mark = item.status === 'done' ? '✅ 已完成' : '⏳ 待做'
      const note = item.status === 'done' ? (item.evidence ?? '—') : (item.阻塞 ?? item.evidence ?? '—')
      md.push(`| ${item.项} | ${mark} | ${note} |`)
    }
    md.push('')
  }
}

md.push('## 三、按业务域分布')
md.push('')
md.push('```text')
const maxDomain = byDomain[0]?.[1] ?? 1
for (const [domain, n] of byDomain) {
  const impl = implementedInDomain(domain)
  md.push(`${domain.padEnd(16)} ${bar(n, maxDomain)} ${String(n).padStart(4)}   已实现 ${impl}`)
}
md.push('```')
md.push('')

md.push('## 四、按页面形态分布')
md.push('')
md.push('```text')
const maxKind = byKind[0]?.[1] ?? 1
for (const [kind, n] of byKind) {
  md.push(`${kind.padEnd(28)} ${bar(n, maxKind)} ${String(n).padStart(4)}`)
}
md.push('```')
md.push('')

md.push('## 五、module-type 覆盖')
md.push('')
md.push(`能推出 **${withModuleType}** 行、推不出 **${total - withModuleType}** 行。`)
md.push('推不出的那部分，浏览器也同样不发这个头（设计 D34）——不是缺陷，是刻意与浏览器一致。')
md.push('')
md.push('```text')
const maxMt = byModuleType[0]?.[1] ?? 1
for (const [label, n] of byModuleType) {
  md.push(`${label.padEnd(12)} ${bar(n, maxMt)} ${String(n).padStart(4)}`)
}
md.push('```')
md.push('')

md.push('## 六、已实现的能力')
md.push('')
md.push('| 能力 ID | 名称 | 页面 | 读写 | 参数（必填/长选项） | 在清单里 |')
md.push('| --- | --- | --- | --- | --- | --- |')
for (const c of capabilityRows) {
  md.push(
    `| \`${c.id}\` | ${c.title} | \`${c.pagePath}\` | ${c.write ? '**写**' : '读'} | ${c.params}（${c.required}/${c.longOptions}） | ${c.inCatalog ? '是' : '否'} |`,
  )
}
md.push('')
if (capabilityOnlyPaths.length) {
  md.push('不在页面清单里的入口（流程表单类，走「发起流程」到达，见设计 D9）：')
  for (const p of [...new Set(capabilityOnlyPaths)]) md.push(`- \`${p}\``)
  md.push('')
}

md.push('## 七、批量生成：能接多少页（按 http 实例范围）')
md.push('')
md.push('> 来源：`src/capabilities/generated/batch-report.json`（由 `tools/generate/batch-capabilities.mjs` 生成）。')
md.push('> 这一节的数法与前面几节不同：前面数的是「页面有没有能力实现」，这里数的是')
md.push('> 「批量抽出来的候选里有多少**能接**」。判「哪一页走哪个 http 实例」的唯一依据是')
md.push('> `src/context/http-instance.ts`——**不是**「文件 import 了哪个 http」，那个判断方式实测会错。')
md.push('')
if (!batch || !batchSplit || !batchLegacy) {
  md.push('（还没有 `batch-report.json`，先跑 `node tools/generate/batch-capabilities.mjs`）')
} else {
  const { auto, partial, failed: failedPart } = batchSplit.裁决内拆分
  const all = (x) => x.范围内 + x.范围外
  md.push(`**${batchSplit.页数}** 个声明式列表页，两个维度交叉（裁决 × 实例范围）：`)
  md.push('')
  md.push('| 裁决（抽不抽得出来） | 走 platform（范围内） | 走别的实例（范围外） | 合计 |')
  md.push('| --- | --- | --- | --- |')
  md.push(`| auto（完全自动） | ${auto.范围内} | ${auto.范围外} | ${all(auto)} |`)
  md.push(`| partial（需人补） | ${partial.范围内} | ${partial.范围外} | ${all(partial)} |`)
  md.push(`| failed（产不出） | ${failedPart.范围内} | ${failedPart.范围外} | ${all(failedPart)} |`)
  md.push(`| **合计** | **${batchSplit.范围内}** | **${batchSplit.范围外}** | **${batchSplit.页数}** |`)
  md.push('')
  md.push(`- **能接的：${batchSplit.可接_范围内且auto} 页**（范围内且 auto）。范围外的 ${batchSplit.范围外} 页不是「待补」，`)
  md.push('  是范围决策的结果（决策 D3 只做 Portal 主后端，走的是别的产品线的后端）——人补再多也不会变成能接的能力。')
  md.push(`- 上面这行 \`${batchLegacy.auto} 完全自动 / ${batchLegacy.partial} 需人补 / ${batchLegacy.failed} 产不出\` 是**未计实例口径**`)
  md.push('  （`docs/roadmap.json` 里那条证据记的就是它）：只按裁决切，不看实例。')
  md.push(`  加上实例维度后，那 ${batchLegacy.partial} 页里有 ${partial.范围外} 页落在范围外。`)
  md.push('- 范围外的契约仍然留在生成物里（浏览器实测核对与审计要用），但不进 `BATCH_IN_SCOPE_CAPABILITIES`，')
  md.push('  且 `createBatchListCapability()` 对它们直接抛错——静默产出一个打到错 URL 的能力定义，比产不出更危险。')
  md.push(`- Portal 前端共 ${batch.实例推导器?.实例总数 ?? '?'} 个 http 实例（\`app/portal/utils/http/\` 下 17 个文件，`)
  md.push('  `zhdj-cms.js` 一个文件导出两个绑定）。实例差异不只是打哪个域名：还有补不补 `/admin-api`、')
  md.push('  每页条数叫 `pageSize` 还是 `limit`。')
}
md.push('')

md.push('## 八、怎么读这份报告')
md.push('')
md.push('- 第 1、2 节的进度口径是「**页面有没有对应能力实现**」。已经做完的是会议室那一条线（列表 + 预定表单）。')
md.push('- 第 3 节的形态分布决定了推进成本：设计 §1d 的聚类结论是 **463/691 的列表页接近声明式、可批量生成**，')
md.push('  这部分不该逐页人工做。批量生成器已经写出来并跑过（见第 7 节），结论是这批候选里只有一部分能接。')
md.push('- 第 4 节不是进度，是**约束**：推导不出 module-type 的页面会让后端把数据范围放宽到该用户全部模块的并集（设计 F19）。')

fs.writeFileSync(path.join(GENERATED, 'coverage.md'), md.join('\n') + '\n')

// ---------------------------------------------------------------------------
// HTML（自包含、无依赖、无 JS）
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function htmlBars (rows, max, labelWidth = 26) {
  return rows
    .map(([label, n, note]) => {
      const w = max === 0 ? 0 : (n / max) * 100
      return `<div class="row"><span class="lbl" style="min-width:${labelWidth}ch">${esc(label)}</span>` +
        `<span class="track"><span class="fill" style="width:${w.toFixed(2)}%"></span></span>` +
        `<span class="num">${n}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}</div>`
    })
    .join('\n')
}

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Portal Headless SDK —— 覆盖与进度</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
         margin: 0 auto; max-width: 960px; padding: 40px 24px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(128,128,128,.25); }
  .meta { color: #888; font-size: 12px; margin-bottom: 4px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0 8px; }
  .card { border: 1px solid rgba(128,128,128,.25); border-radius: 8px; padding: 14px 16px; }
  .card .v { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .card .k { color: #888; font-size: 12px; margin-top: 2px; }
  .row { display: flex; align-items: center; gap: 10px; margin: 3px 0; }
  .lbl { color: #666; font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { flex: 1; height: 14px; background: rgba(128,128,128,.14); border-radius: 3px; overflow: hidden; }
  .fill { display: block; height: 100%; background: #4a7fd4; border-radius: 3px; }
  .num { font-variant-numeric: tabular-nums; min-width: 4ch; text-align: right; font-size: 12px; }
  .note { color: #888; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid rgba(128,128,128,.2); }
  th { color: #888; font-weight: 500; font-size: 12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .warn { color: #b8860b; }
  h3 { font-size: 14px; margin: 20px 0 8px; }
  .badge { font-size: 11px; font-weight: 400; color: #888; border: 1px solid rgba(128,128,128,.35);
           border-radius: 10px; padding: 1px 8px; vertical-align: 1px; }
  .ok { color: #2e7d32; }
  .todo { color: #b8860b; }
  td.note { color: #777; font-size: 12px; }
</style>
<h1>Portal Headless SDK —— 覆盖与进度</h1>
<div class="meta">生成于 ${esc(meta.generatedAt)}　提交 <code>${esc(meta.commit)}</code>${meta.dirty ? ' <span class="warn">（工作区有未提交改动）</span>' : ''}</div>
<div class="meta">页面清单来自 <code>${esc(meta.portalRepo)}</code></div>

<div class="cards">
  <div class="card"><div class="v">${total}</div><div class="k">页面总数</div></div>
  <div class="card"><div class="v">${implemented}</div><div class="k">已实现能力（${pct(implemented, total)}）</div></div>
  <div class="card"><div class="v">${total - implemented}</div><div class="k">待处理</div></div>
  <div class="card"><div class="v">${capabilities.length}</div><div class="k">能力总数（写 ${capabilities.filter((c) => c.write).length}）</div></div>
  <div class="card"><div class="v">${withModuleType}</div><div class="k">能推出 module-type</div></div>
</div>

${roadmap ? `
<h2>方法与进度（路线图，手工维护）</h2>
<div class="meta">来源 <code>docs/roadmap.json</code>。与上面自动统计的覆盖数是两回事——「有哪些环节已经建成」只有人能判断。</div>
${roadmap.阶段.map((phase) => `
<h3>${esc(phase.名称)} <span class="badge">${esc(phase.状态)}</span></h3>
${phase.环节?.length ? `<table>
<thead><tr><th style="width:34%">项</th><th style="width:10%">状态</th><th>证据 / 阻塞原因</th></tr></thead>
<tbody>
${phase.环节.map((item) => `<tr><td>${esc(item.项)}</td><td>${item.status === 'done' ? '<span class="ok">✅ 已完成</span>' : '<span class="todo">⏳ 待做</span>'}</td><td class="note">${esc(item.status === 'done' ? (item.evidence ?? '—') : (item.阻塞 ?? item.evidence ?? '—'))}</td></tr>`).join('\n')}
</tbody></table>` : '<div class="meta">（尚未展开）</div>'}`).join('\n')}
` : ''}

<h2>按业务域</h2>
${htmlBars(byDomain.map(([d, n]) => [d, n, implementedInDomain(d) ? `已实现 ${implementedInDomain(d)}` : '']), byDomain[0]?.[1] ?? 1)}

<h2>按页面形态</h2>
${htmlBars(byKind, byKind[0]?.[1] ?? 1, 30)}

<h2>按 module-type（能推出的部分）</h2>
${htmlBars(byModuleType, byModuleType[0]?.[1] ?? 1)}

<h2>已实现的能力</h2>
<table>
<thead><tr><th>能力 ID</th><th>名称</th><th>页面</th><th>读写</th><th>参数</th></tr></thead>
<tbody>
${capabilityRows.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.title)}</td><td><code>${esc(c.pagePath)}</code></td><td>${c.write ? '<b>写</b>' : '读'}</td><td>${c.params}（必填 ${c.required} / 长选项 ${c.longOptions}）</td></tr>`).join('\n')}
</tbody>
</table>

<h2>批量生成：能接多少页（按 http 实例范围）</h2>
<div class="meta">来源 <code>src/capabilities/generated/batch-report.json</code>。判「哪一页走哪个 http 实例」的唯一依据是 <code>src/context/http-instance.ts</code>。</div>
${!batch || !batchSplit || !batchLegacy ? '<div class="meta">（还没有 batch-report.json，先跑批量生成器）</div>' : (() => {
  const { auto, partial, failed: failedPart } = batchSplit.裁决内拆分
  const all = (x) => x.范围内 + x.范围外
  return `<table>
<thead><tr><th>裁决（抽不抽得出来）</th><th>走 platform（范围内）</th><th>走别的实例（范围外）</th><th>合计</th></tr></thead>
<tbody>
<tr><td>auto（完全自动）</td><td>${auto.范围内}</td><td>${auto.范围外}</td><td>${all(auto)}</td></tr>
<tr><td>partial（需人补）</td><td>${partial.范围内}</td><td>${partial.范围外}</td><td>${all(partial)}</td></tr>
<tr><td>failed（产不出）</td><td>${failedPart.范围内}</td><td>${failedPart.范围外}</td><td>${all(failedPart)}</td></tr>
<tr><td><b>合计</b></td><td><b>${batchSplit.范围内}</b></td><td><b>${batchSplit.范围外}</b></td><td><b>${batchSplit.页数}</b></td></tr>
</tbody></table>
<div class="meta">能接的：<b>${batchSplit.可接_范围内且auto} 页</b>（范围内且 auto）。范围外的 ${batchSplit.范围外} 页不是「待补」，是范围决策的结果（决策 D3 只做 Portal 主后端）。<code>${batchLegacy.auto} / ${batchLegacy.partial} / ${batchLegacy.failed}</code> 是<b>未计实例口径</b>，只按裁决切。</div>`
})()}

<h2>怎么读这份报告</h2>
<ul>
<li>进度口径是「<b>页面有没有对应能力实现</b>」。已完成的只有会议室那条线。</li>
<li>形态分布决定推进成本：设计 §1d 的聚类结论是 <b>463/691 的列表页接近声明式、可批量生成</b>，
    这部分不该逐页人工做。批量生成器已经写出来并跑过（见上一节），结论是这批候选里只有一部分能接。</li>
<li>module-type 覆盖不是进度，是<b>约束</b>：推不出的页面会让后端把数据范围放宽到该用户全部模块的并集（设计 F19）。</li>
</ul>
</html>
`

fs.writeFileSync(path.join(GENERATED, 'coverage.html'), html)

process.stdout.write(
  `[report] 页面 ${total} 行｜已实现 ${implemented}（${pct(implemented, total)}）｜能力 ${capabilities.length} 个\n` +
    `[report] 已写入 generated/coverage.md 与 generated/coverage.html\n`,
)
