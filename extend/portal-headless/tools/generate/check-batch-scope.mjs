#!/usr/bin/env node
/**
 * 批量生成物的**范围自检**：`pnpm test` 之外的那几条断言。
 *
 *   node tools/generate/check-batch-scope.mjs [Portal 仓库路径]
 *
 * 为什么单独一个脚本（而不是加进 `test/batch-capabilities.test.ts`）：
 * 那是本轮改动**不能碰**的文件，而"范围"这个新增维度必须有人钉住——
 * 一个没人验的守卫会安静地烂掉。这个脚本零依赖、不看生成器的内部推理，
 * 只读 `src/capabilities/generated/**` 与 Portal 源码，验的是**产物与出处**。
 *
 * 钉住的性质：
 * A. `scope` 与 `httpInstance` 一致：走 platform 才是 in-scope，别的实例一律 out-of-scope
 * B. 报告里的拆分自洽，且**旧口径（136 / 115 / 4，未计实例）仍然可追溯**
 * C. 每条契约的实例出处可复核：`httpInstanceSource` 的 file:line 在 Portal 里真实存在，
 *    文件与 `httpModule` 对得上，`baseUrlEnv` 与实例画像一致
 * D. 范围外的契约**不可接线**：不在 `BATCH_IN_SCOPE_CAPABILITIES` 里，
 *    且 `createBatchListCapability()` 直接抛错（"宁可拒绝，也不打到错的 URL"）
 * E. 浏览器实测那条范围外的页（sale）与它的观测 URL 吻合：
 *    真的在 `/admin-shop-api` 下、真的不补 `/admin-api`——**范围结论有外部凭据**，
 *    不是静态推理的自说自话
 *
 * 没有 Portal 仓库时 C/E 会跳过（并打印「未执行」），A/B/D 照跑。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadHttpInstanceResolver, loadSourceModule } from './http-instance-resolver.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
const GENERATED = path.join(PKG_ROOT, 'src/capabilities/generated')
const DEFAULT_PORTAL_REPO = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'

const CLI_REPO = process.argv.slice(2).find((a) => !a.startsWith('--'))
const PORTAL_REPO = path.resolve(CLI_REPO || process.env.PORTAL_REPO || DEFAULT_PORTAL_REPO)
const hasPortalRepo = fs.existsSync(path.join(PORTAL_REPO, 'app/portal/utils/http'))

/** 测试环境各 baseURL 的取值，来自 Portal 的 `build/env/.env.build.test`（与生成器同一份口径） */
const TEST_ENV_BASE_URL = {
  VITE_ZHDJ_PLATFORM_API: 'https://biz-api-test.wodecorp.cn',
  VITE_SHOP_ADMIN_API: 'https://biz-api-test.wodecorp.cn/admin-shop-api',
  VITE_MALL_ADMIN_API: 'https://biz-api-test.wodecorp.cn/mall-manage-api',
}

const IN_SCOPE_INSTANCE_ID = 'platform'

let failed = 0
const skipped = []

function check (label, condition, detail) {
  if (condition) return
  failed += 1
  process.stderr.write(`  ✗ ${label}\n${detail ? `      ${detail}\n` : ''}`)
}

function pass (label) {
  process.stdout.write(`  ✓ ${label}\n`)
}

function section (title) {
  process.stdout.write(`\n${title}\n`)
}

// ---------------------------------------------------------------------------
// 输入
// ---------------------------------------------------------------------------

const entryFile = path.join(GENERATED, 'index.ts')
const reportFile = path.join(GENERATED, 'batch-report.json')
for (const file of [entryFile, reportFile]) {
  if (!fs.existsSync(file)) {
    process.stderr.write(`[check-batch-scope] 缺少 ${path.relative(PKG_ROOT, file)}，先跑 node tools/generate/batch-capabilities.mjs\n`)
    process.exit(1)
  }
}
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
const generated = await loadSourceModule(entryFile)
const { BATCH_ENDPOINTS, BATCH_CAPABILITIES, BATCH_IN_SCOPE_CAPABILITIES, BATCH_OUT_OF_SCOPE_CAPABILITIES, createBatchListCapability } = generated
const endpoints = Object.values(BATCH_ENDPOINTS)

const { HTTP_INSTANCES: HTTP_INSTANCE_PROFILES } = await loadHttpInstanceResolver()
const inScopeInstance = HTTP_INSTANCE_PROFILES.find((p) => p.id === IN_SCOPE_INSTANCE_ID)

// ---------------------------------------------------------------------------
// A. scope 与 httpInstance 一致
// ---------------------------------------------------------------------------
section('A. scope 与 httpInstance 一致')

check('生成物里有契约', endpoints.length > 0)
const wrongScope = endpoints.filter((e) =>
  (e.httpInstance === IN_SCOPE_INSTANCE_ID) !== (e.scope === 'in-scope'))
check(
  `scope === in-scope 当且仅当 httpInstance === ${IN_SCOPE_INSTANCE_ID}`,
  wrongScope.length === 0,
  wrongScope.map((e) => `${e.pagePath}: instance=${e.httpInstance} scope=${e.scope}`).join('\n      '),
)
const badUnresolved = endpoints.filter((e) => e.scope === 'unresolved')
check('没有 scope 未解出的契约混进来', badUnresolved.length === 0,
  badUnresolved.map((e) => e.pagePath).join(', '))
pass(`${endpoints.length} 条契约：范围内 ${endpoints.filter((e) => e.scope === 'in-scope').length}／范围外 ${endpoints.filter((e) => e.scope === 'out-of-scope').length}`)

// ---------------------------------------------------------------------------
// B. 拆分自洽 + 旧口径可追溯
// ---------------------------------------------------------------------------
section('B. 拆分自洽 + 旧口径可追溯')

const catalog = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'generated/page-catalog.json'), 'utf8'))
const declarativeTotal = catalog.items.filter((item) => item.kind === '列表页(声明式 getDataListURL)').length
const fullKey = `全量外推（${declarativeTotal} 个声明式列表页同一条代码路径）`
for (const key of [fullKey, '抽样判定']) {
  const legacy = report[key]
  check(`${key}：旧口径的键还在（136 / 115 / 4 那套数字不能说没就没）`, Boolean(legacy), key)
  if (!legacy) continue
  check(`${key}：auto + partial + failed === total`,
    legacy.auto + legacy.partial + legacy.failed === legacy.total,
    `${legacy.auto}+${legacy.partial}+${legacy.failed} vs ${legacy.total}`)
  check(`${key}：没有只标口径没说清的字样`,
    typeof report.口径说明?.['裁决（auto/partial/failed）'] === 'string')
}

for (const [key, label] of [
  ['全量外推·按 http 实例范围拆分', '全量'],
  ['抽样页·按 http 实例范围拆分', '抽样'],
]) {
  const split = report[key]
  check(`${label}：范围拆分在报告里`, Boolean(split), key)
  if (!split) continue
  const { auto, partial, failed: failedPart } = split.裁决内拆分
  check(`${label}：范围内 + 范围外 + 未解出 === 页数`,
    split.范围内 + split.范围外 + split.实例未解出 === split.页数,
    JSON.stringify(split))
  const legacy = label === '全量'
    ? report[fullKey]
    : report['抽样判定']
  if (!legacy) continue // 旧口径的键没了：上面已经报过，这里别再炸一次
  check(`${label}：拆分回加 === 旧口径的 auto`,
    auto.范围内 + auto.范围外 === legacy.auto, `${auto.范围内}+${auto.范围外} vs ${legacy.auto}`)
  check(`${label}：拆分回加 === 旧口径的 partial`,
    partial.范围内 + partial.范围外 === legacy.partial)
  check(`${label}：拆分回加 === 旧口径的 failed`,
    failedPart.范围内 + failedPart.范围外 === legacy.failed)
  check(`${label}：可接_范围内且auto 与拆分一致`,
    split.可接_范围内且auto === auto.范围内)
  check(`${label}：范围外明细的条数 === 范围外 + 未解出`,
    split.范围外明细.length === split.范围外 + split.实例未解出)
}
pass('旧口径（未计实例）与新维度（计实例）两套数字都对得上')

// ---------------------------------------------------------------------------
// C. 实例出处可复核
// ---------------------------------------------------------------------------
section('C. 实例出处可复核')

check('范围内实例的 baseUrlEnv 与画像一致',
  Boolean(inScopeInstance) && endpoints
    .filter((e) => e.scope === 'in-scope' && e.baseUrlEnv !== inScopeInstance.baseUrl.env)
    .length === 0,
  `期望 ${inScopeInstance?.baseUrl.env}`)
const badModule = endpoints.filter((e) =>
  e.httpInstanceSource && !e.httpInstanceSource.includes(`${e.httpModule}:`))
check('httpInstanceSource 里的文件与 httpModule 是同一个', badModule.length === 0,
  badModule.map((e) => `${e.pagePath}: ${e.httpInstanceSource} vs ${e.httpModule}`).join('\n      '))

if (hasPortalRepo) {
  const missing = endpoints
    .filter((e) => e.httpInstanceSource)
    .map((e) => e.httpInstanceSource.split(':')[0])
    .filter((rel, i, all) => all.indexOf(rel) === i)
    .filter((rel) => !fs.existsSync(path.join(PORTAL_REPO, rel)))
  check('每条 httpInstanceSource 指向的源码文件真实存在', missing.length === 0, missing.join(', '))
  pass(`出处文件在 ${PORTAL_REPO} 下逐个存在`)
} else {
  skipped.push(`C 的"源码文件真实存在"（没找到 Portal 仓库：${PORTAL_REPO}）`)
}

// ---------------------------------------------------------------------------
// D. 范围外的契约不可接线
// ---------------------------------------------------------------------------
section('D. 范围外的契约不可接线')

check('范围外的契约留在生成物里（可审计）', BATCH_OUT_OF_SCOPE_CAPABILITIES.length > 0)
const leaked = BATCH_IN_SCOPE_CAPABILITIES.filter((c) => BATCH_ENDPOINTS[c.id]?.scope !== 'in-scope')
check('BATCH_IN_SCOPE_CAPABILITIES 里没有范围外的条目', leaked.length === 0,
  leaked.map((c) => c.id).join(', '))
check('两个集合加起来 === 全部能力（没漏也没重）',
  BATCH_IN_SCOPE_CAPABILITIES.length + BATCH_OUT_OF_SCOPE_CAPABILITIES.length === BATCH_CAPABILITIES.length,
  `${BATCH_IN_SCOPE_CAPABILITIES.length}+${BATCH_OUT_OF_SCOPE_CAPABILITIES.length} vs ${BATCH_CAPABILITIES.length}`)

const noop = async () => null
const outOfScopeEndpoint = endpoints.find((e) => e.scope !== 'in-scope')
check('样本里有一条范围外的契约可用来验拒绝行为', Boolean(outOfScopeEndpoint))
if (outOfScopeEndpoint) {
  let threw = null
  try { createBatchListCapability(outOfScopeEndpoint, noop) } catch (error) { threw = error }
  check('createBatchListCapability 对范围外的契约抛错（不是静默发出去）', Boolean(threw),
    `${outOfScopeEndpoint.pagePath} 没有抛`)
  check('抛出的错误里说清了是哪个实例、哪个 base',
    Boolean(threw) && threw.message.includes(outOfScopeEndpoint.httpInstance) &&
    threw.message.includes(outOfScopeEndpoint.baseUrlEnv),
    threw?.message)
}
const inScopeEndpoint = endpoints.find((e) => e.scope === 'in-scope')
let inScopeThrew = null
try { createBatchListCapability(inScopeEndpoint, noop) } catch (error) { inScopeThrew = error }
check('范围内的契约照常可用（拒绝不是无差别拒绝）', inScopeThrew === null, inScopeThrew?.message)
pass('范围外的定义只用于审计，接线入口会拒绝')

// ---------------------------------------------------------------------------
// E. 范围结论有浏览器实测背书
// ---------------------------------------------------------------------------
section('E. 范围结论有浏览器实测背书')

const verified = report.浏览器实测核对?.明细 ?? []
check('浏览器实测核对全部一致', verified.length > 0 && verified.every((v) => v.一致),
  verified.filter((v) => !v.一致).map((v) => v.pagePath).join(', '))

const salePage = endpoints.find((e) => e.pagePath === '/dashboard/sale/customer-service/after-sale/list')
check('实测里那条 sale 页被判范围外', salePage?.scope === 'out-of-scope')
if (salePage && hasPortalRepo) {
  const observed = verified.find((v) => v.pagePath === salePage.pagePath)?.浏览器发出的
  const base = TEST_ENV_BASE_URL[salePage.baseUrlEnv]
  check('它观测到的 base 真的是 /admin-shop-api（不是主后端）',
    Boolean(observed) && Boolean(base) && observed.startsWith(base), `${observed} vs ${base}`)
  check('它的 resolvedPath 真的不补 /admin-api（sale 实例没有那个拦截器）',
    !salePage.resolvedPath.startsWith('/admin-api'), salePage.resolvedPath)
  pass(`sale 页：观测 ${observed} ／ 契约 ${base}${salePage.resolvedPath}`)
} else if (!hasPortalRepo) {
  skipped.push(`E（没找到 Portal 仓库：${PORTAL_REPO}）`)
}

// ---------------------------------------------------------------------------

process.stdout.write('\n')
for (const item of skipped) process.stdout.write(`[check-batch-scope] 未执行：${item}\n`)
if (failed) {
  process.stderr.write(`[check-batch-scope] ✗ ${failed} 条断言不成立\n`)
  process.exit(1)
}
process.stdout.write('[check-batch-scope] ✓ 全部通过\n')
