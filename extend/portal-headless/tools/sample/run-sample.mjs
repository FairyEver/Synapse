#!/usr/bin/env node
/**
 * 抽样基准跑批：对 `tools/sample/sample-plan.json` 里的每一页，在真实浏览器里打开、
 * 抓下**浏览器实际发出的请求**，连同页面上每个参数的**控件形态**与**候选规模**一起落盘。
 *
 * 用法：
 *   bsk session start --no-focus                       # 先起会话，记下 4 位 id
 *   node tools/sample/run-sample.mjs --session <id>    # 跑全量（约 20 页 × 30s）
 *   node tools/sample/run-sample.mjs --session <id> --only /dashboard/meeting-room/list
 *   node tools/sample/run-sample.mjs --session <id> --resume   # 跳过已有结果的页
 *
 * 产出：`tools/sample/results/<slug>.json`（逐页原始）+ `tools/sample/sample-results.json`（合并）
 *
 * 只读口径：**不点任何提交/删除按钮**。每页只做两件事——等页面自己挂载完（发出列表请求），
 * 以及点一次「查询」。两者都是 GET，页面自己在这两个时机本来就会发。
 *
 * 为什么要 `reload --wait-until commit` 紧跟装钩子：
 * `install-hook.js` 必须在页面自己的 JS 发出请求**之前**进入页面，
 * 否则第一次列表请求（挂载时那一次）抓不到。而 `bsk navigate` 到 hash 路由是**同文档跳转**，
 * 不会重新加载，因此先 `navigate` 把 URL 落到目标路由，再 `reload` 触发真实重载，
 * 并且只等到 `commit`（文档已提交、脚本还没跑）就立刻注入——窗口期就在这里。
 * 这一条是实测出来的：先 navigate 再装钩子，挂载请求会漏掉；本流程能抓到。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')

const PLAN_FILE = path.join(HERE, 'sample-plan.json')
const RESULTS_DIR = path.join(HERE, 'results')
const MERGED_FILE = path.join(HERE, 'sample-results.json')

const ORIGIN = process.env.PORTAL_ORIGIN || 'https://webtest01.wodecorp.cn'
const PORTAL_ENTRY = `${ORIGIN}/portal.html#`
/** 抓取范围：只留打到测试后端的请求，把 webtest01 静态资源与第三方埋点滤掉 */
const BACKEND_HOST = process.env.PORTAL_BACKEND_HOST || 'biz-api-test.wodecorp.cn'

const INSTALL_SCRIPT = fs.readFileSync(path.join(PKG_ROOT, 'tools/baseline/install-hook.js'), 'utf8') +
  '\n' + fs.readFileSync(path.join(HERE, 'probe-hook.js'), 'utf8')
const DOM_PROBE = fs.readFileSync(path.join(HERE, 'dom-probe.js'), 'utf8')

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i > -1 ? argv[i + 1] : null
}
const SESSION = argOf('--session')
const ONLY = argOf('--only')
const RESUME = argv.includes('--resume')
const SETTLE_MS = Number(argOf('--settle-ms') || 9000)
if (!SESSION) {
  console.error('缺少 --session <id>。先 `bsk session start --no-focus` 并把打印出来的 4 位 id 传进来。')
  process.exit(2)
}

const bsk = (args, { tolerate = false, timeout = 60_000 } = {}) => {
  try {
    return execFileSync('bsk', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (tolerate) return null
    throw error
  }
}

const bskJson = (args, options) => {
  const raw = bsk(args, options)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** `bsk evaluate` 的返回值在 `.value` 里，是个字符串（脚本自己 JSON.stringify 过）。 */
const evaluate = (expression, { tolerate = false } = {}) => {
  const out = bskJson(['evaluate', '--session', SESSION, '--json', '--timeout', '60s', expression], { tolerate })
  if (!out || out.value === undefined || out.value === null) return null
  try {
    return JSON.parse(out.value)
  } catch {
    return out.value
  }
}

const slugOf = (pagePath) => pagePath.replace(/^\/dashboard\//, '').replace(/\//g, '__')

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 页内表达式：把钩子缓冲里打到测试后端的请求取出来。 */
const CAPTURE_EXPR = (phase) => `JSON.stringify({
  phase: ${JSON.stringify(phase)},
  cap: (window.__phCap || []).filter(function (r) { return r.url.indexOf(${JSON.stringify(BACKEND_HOST)}) > -1 }),
  res: (window.__phRes || []).filter(function (r) { return r.url.indexOf(${JSON.stringify(BACKEND_HOST)}) > -1 })
})`

const RESET_EXPR = `(function () { window.__phCap = []; window.__phRes = []; return 'reset' })()`

/** 打标记再点，避免 rc-virtual-list / 重渲染把 @eN ref 弄漂（手册 §2.3-3）。 */
const TAG_QUERY_BUTTON = `(function () {
  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
  document.querySelectorAll('[data-ph-t]').forEach(function (e) { e.removeAttribute('data-ph-t') });
  var hit = btns.filter(function (b) { return /^查\\s*询$|^搜\\s*索$/.test(b.innerText.replace(/\\s+/g, ' ').trim()) })[0];
  if (!hit) return 'NO_QUERY_BUTTON';
  hit.scrollIntoView({ block: 'center', behavior: 'instant' });
  hit.setAttribute('data-ph-t', '1');
  return 'tagged:' + hit.innerText.trim();
})()`

const runPage = (entry) => {
  const url = PORTAL_ENTRY + entry.pagePath
  const record = { pagePath: entry.pagePath, plan: entry, url, startedAt: new Date().toISOString(), 步骤: [] }
  const step = (name, detail) => record.步骤.push({ name, at: new Date().toISOString(), detail })

  // 1. 把 URL 落到目标路由。hash 跳转是同文档跳转，`load` 不会再触发，因此超时是**预期**的。
  bsk(['navigate', url, '--session', SESSION, '--wait-until', 'domcontentloaded', '--timeout', '12s'], { tolerate: true })
  step('navigate', 'ok(或超时，hash 跳转不触发 load 属预期)')

  // 2. 真实重载，只等到 commit —— 脚本还没跑，钩子抢在页面自己的请求之前进去
  const reload = bsk(['reload', '--session', SESSION, '--wait-until', 'commit', '--timeout', '30s'], { tolerate: true })
  step('reload', reload ? 'ok' : 'failed')

  // 3. 注入钩子（install-hook 在前，probe-hook 在后，顺序不能反）
  const installed = evaluate(INSTALL_SCRIPT, { tolerate: true })
  step('install-hooks', installed)
  if (installed !== 'installed' && installed !== 'already') {
    record.抓取失败 = `钩子未装上（返回 ${JSON.stringify(installed)}）`
    return record
  }
  // 防"静默串页"：钩子是装在 document 上的。如果上一步的 reload 没真的重载，
  // 钩子会返回 'already'，而 `window.__phCap` 里留着**上一页**的抓取——
  // 那样这一页会被判成"找不到列表请求 = 不能接"，是**假结论**。
  // 所以装完钩子立刻核对一次当前文档的 URL。
  const here = evaluate('location.href', { tolerate: true })
  record.装钩子时的URL = here
  if (typeof here === 'string' && !here.includes(entry.pagePath)) {
    record.抓取失败 = `装钩子时文档停在 ${here}，不是目标页 ${entry.pagePath}——reload 没生效，本次抓取会串页，作废`
    return record
  }

  // 4. 等 SPA 起来把挂载请求发完
  sleep(SETTLE_MS)
  const mount = evaluate(CAPTURE_EXPR('mount'), { tolerate: true })
  if (!mount || !Array.isArray(mount.cap)) {
    record.抓取失败 = '读不到 window.__phCap（页面可能被跳转走了 / 钩子被覆盖）'
    return record
  }
  record.mount = mount
  step('mount', `cap=${mount.cap.length} res=${mount.res.length}`)

  // 5. 点一次「查询」，验证挂载请求与显式查询发出的请求是否逐字段一致
  evaluate(RESET_EXPR, { tolerate: true })
  const tagged = evaluate(TAG_QUERY_BUTTON, { tolerate: true })
  record.查询按钮 = tagged
  if (typeof tagged === 'string' && tagged.startsWith('tagged:')) {
    bsk(['click', '[data-ph-t="1"]', '--session', SESSION], { tolerate: true })
    sleep(3000)
    record.query = evaluate(CAPTURE_EXPR('query'), { tolerate: true })
    step('query', record.query ? `cap=${record.query.cap.length}` : 'no capture')
  } else {
    record.query = null
    step('query', '页面没有「查 询/搜 索」按钮，跳过')
  }

  // 6. 页面此刻的控件形态 + cookie（module-type 的来源）
  record.dom = evaluate(DOM_PROBE, { tolerate: true })
  step('dom-probe', record.dom ? `formItems=${record.dom.formItems.length}` : 'failed')

  return record
}

// ---------------------------------------------------------------------------

const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'))
fs.mkdirSync(RESULTS_DIR, { recursive: true })

const targets = ONLY ? plan.页.filter((p) => p.pagePath === ONLY) : plan.页
if (!targets.length) {
  console.error(`计划里没有 ${ONLY}`)
  process.exit(2)
}

const results = []
try {
  for (const [i, entry] of targets.entries()) {
    const file = path.join(RESULTS_DIR, slugOf(entry.pagePath) + '.json')
    if (RESUME && fs.existsSync(file)) {
      console.log(`[${i + 1}/${targets.length}] 跳过（已有结果）：${entry.pagePath}`)
      results.push(JSON.parse(fs.readFileSync(file, 'utf8')))
      continue
    }
    console.log(`[${i + 1}/${targets.length}] ${entry.pagePath}`)
    const record = runPage(entry)
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
    const ok = !record.抓取失败
    console.log(`    ${ok ? '✓' : '✗'} mount=${record.mount ? record.mount.cap.length : 0} query=${record.query ? record.query.cap.length : '-'} ${record.抓取失败 || ''}`)
    results.push(record)
  }
} finally {
  // 合并结果**从逐页文件重建**，而不是拿本次内存里的 results：
  // 用 `--only <一页>` 补跑时，内存里只有那一页，直接写会把上一轮的整批结果冲掉。
  // 逐页文件才是真相来源，这也让"补跑一页"和"跑全量"产出同一种合并文件。
  const perPage = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')))
  // 按计划顺序排，方便人工逐页对读
  const order = new Map(plan.页.map((p, i) => [p.pagePath, i]))
  perPage.sort((a, b) => (order.get(a.pagePath) ?? 1e9) - (order.get(b.pagePath) ?? 1e9) || a.pagePath.localeCompare(b.pagePath))
  fs.writeFileSync(MERGED_FILE, JSON.stringify({
    生成时间: new Date().toISOString(),
    会话: SESSION,
    环境: ORIGIN,
    后端: BACKEND_HOST,
    页数: perPage.length,
    成功页数: perPage.filter((r) => !r.抓取失败).length,
    本次跑的页: results.map((r) => r.pagePath),
    结果: perPage,
  }, null, 2) + '\n')
  console.log(`已写入 ${path.relative(PKG_ROOT, MERGED_FILE)}（累计 ${perPage.length} 页，成功 ${perPage.filter((r) => !r.抓取失败).length}；本次跑了 ${results.length} 页）`)
}
