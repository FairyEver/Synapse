#!/usr/bin/env node
/**
 * 抽样选择器：从全量生成器判定为 `auto` 的能力里挑出「浏览器基准」要实测的那一批（设计 D20）。
 *
 * 用法：
 *   node tools/sample/select-sample.mjs                                    # 打印并写入 sample-plan.json
 *   node tools/sample/select-sample.mjs --from-ts <batch-capabilities.ts>  # 先从 --all 生成物抽出契约
 *
 * 重跑全链路（三行，都不写 src/）：
 *   BATCH_OUT_DIR=/tmp/ph-all node tools/generate/batch-capabilities.mjs --all
 *   node tools/sample/select-sample.mjs --from-ts /tmp/ph-all/batch-capabilities.ts
 *   node tools/sample/run-sample.mjs --session <id>   # 再用 analyze.mjs 出结论
 *
 * 为什么要单独一个脚本：**抽样必须是分层的、可复现的，不能是随机抽。**
 * 随机抽会让"错得最多的那一类"大概率抽不到——而这份工作要回答的正是
 * 「生成器在哪些维度上判错了」，抽不到就等于没测。
 *
 * 分层轴 = **可能判错的维度**（每一条都对应 `inferParamKind` 或路径抽取上的一处已知弱点）：
 *
 * | 层 | 轴 | 为什么生成器可能判错 |
 * | --- | --- | --- |
 * | L1 | 参数名带 date/time/month/year/day | `inferParamKind` 只看**初值类型**，日期控件初值常是 `''`/`null` → 一律判成 `text` |
 * | L2 | 参数名以 Id 结尾 | 引用型参数在页面上是下拉；候选**规模在源码里根本不存在**，只能运行时量 |
 * | L3 | 参数个数 >= 8 | 参数越多，顺序/漏项/多一项的概率越高 |
 * | L4 | 路径走 `/mall-manage-api`、`/adminmanage-api` | 前缀透传，不带 `/admin-api`；抽错就是打到错的路由 |
 * | L5 | `sizeParam === null`（不分页） | 生成器对"这接口算不算分页"的判断；错了会多发/少发分页参数 |
 * | L6 | 页面源码里有 `dataFilter`/`formatter` 之类的改写钩子 | 生成器只认 `convertFetchForm` 一个字面量，别的钩子它看不见 |
 * | L7 | 对照组：绝对 `/admin-api` + 参数少 + 无日期无引用 | 这是 136 里最"标准"的一类；它要是也错，说明错在共性上 |
 *
 * 层与层之间**允许重叠**（一页可以既是 L1 又是 L4），但同一页只进一次抽样，
 * 按 L1→L7 的顺序认领，这样高风险层先拿到名额。输出里保留 `layers` 数组供复核。
 *
 * ---- 第二轮加抽（2026-09-20，如实记录）----
 *
 * 第一轮按 L4 配额 4 跑完 21 页后，发现 **L4 是最大的一层（71 页 = 136 的 52%），
 * 却只有 4 个样本**。结论对 L4 的估计直接决定"能不能接"的总数，所以把 L4 配额提到 7、
 * 补跑了 3 页。这是**看着第一轮结果加抽**，属于自适应抽样：不是随机，也不是事先定死。
 * 加抽只新增、没有淘汰任何已有页（选择是确定性的，改动配额只会在池子末尾多取几个），
 * 复跑后已核对过"新增 3 页、丢失 0 页"。读这份结论时要知道 L4 的样本是这么来的。
 *
 * 只读：本脚本读 `src/capabilities/generated/**` 与 `generated/page-catalog.json`，不写任何生成物。
 * 输入里的 136 个契约来自 `node tools/generate/batch-capabilities.mjs --all`（写到临时目录，
 * 不覆盖 `src/` 下的抽样版生成物），见 README 的「怎么重跑」。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')

const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}

/**
 * 从 `--all` 生成物里读全量契约；`tools/sample/endpoints.json` 是那份生成物的 BATCH_ENDPOINTS。
 *
 * 为什么不用 `src/capabilities/generated/` 里的那份：那是**只含 20 个抽样页**的版本
 * （`BATCH_GENERATED_META.endpointCount = 19`），而这里要的是 136 个 auto 的全集。
 * 重新生成（**写去临时目录，不覆盖 src/ 下的生成物**）：
 *   BATCH_OUT_DIR=/tmp/ph-all node tools/generate/batch-capabilities.mjs --all
 *   # 再把 /tmp/ph-all/batch-capabilities.ts 里的 BATCH_ENDPOINTS 抽成 JSON，覆盖本文件
 */
const ENDPOINTS_FILE = path.join(HERE, 'endpoints.json')
/** 页面 → 源码文件 的索引，用来做 L6 的源码扫描 */
const CATALOG_FILE = path.join(PKG_ROOT, 'generated/page-catalog.json')
const OUT_FILE = path.join(HERE, 'sample-plan.json')

const PORTAL_REPO = process.env.PORTAL_REPO || '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'

/** renren 列表接口自带的两个参数，不属于页面表单。 */
const RENREN_PARAMS = new Set(['order', 'orderField'])

/** L6 扫的改写钩子：生成器只看 `convertFetchForm(`，这些是它看不见的同类。 */
const REWRITE_HOOKS = ['convertFetchForm', 'dataFilter', 'formatter', 'beforeFetch', 'transformForm', 'postData', 'customLoad']

/** 计算一页属于哪些层。返回的是**事实**（页面上有什么），不是判断。 */
function layersOf (endpoint, source) {
  const params = endpoint.query.filter((q) => !RENREN_PARAMS.has(q.name))
  const layers = []

  if (params.some((p) => /date|time|month|year|day/i.test(p.name))) layers.push('L1:参数名像日期/时间')
  if (params.some((p) => /(^|[a-z])[Ii]d$/.test(p.name) || /Id$/.test(p.name))) layers.push('L2:参数名是 Id 引用')
  if (endpoint.query.length >= 8) layers.push('L3:参数个数>=8')
  if (/^\/(mall-manage-api|adminmanage-api)\//.test(endpoint.resolvedPath)) layers.push('L4:非 /admin-api 前缀')
  if (endpoint.sizeParam === null) layers.push('L5:不分页')
  const hooks = source ? REWRITE_HOOKS.filter((h) => new RegExp(`${h}\\s*[:(]`).test(source)) : []
  // 层名必须**稳定**：钩子名放进 rewriteHooks 单独带出，不要拼进层名
  // （拼进去会让 `layers.includes(层名)` 永远不成立——这个 bug 本轮真的踩到过，L6 因此空抽）
  if (hooks.length) layers.push('L6:源码有改写钩子')
  if (!layers.length && endpoint.resolvedPath.startsWith('/admin-api/')) layers.push('L7:对照(绝对 /admin-api、参数少、无日期无引用)')

  return { layers, hooks }
}

/**
 * 从 `batch-capabilities.ts` 里把 `BATCH_ENDPOINTS` 那段对象字面量抠出来。
 * 那段是机器生成的、纯字面量（没有模板串、没有函数），所以直接当 JS 求值即可——
 * 这样就不用为了读一个生成物去给它加一条 `export`（那会碰 `src/**`，越界）。
 */
const extractEndpoints = (tsFile) => {
  const source = fs.readFileSync(tsFile, 'utf8')
  const anchor = source.indexOf('export const BATCH_ENDPOINTS')
  if (anchor < 0) throw new Error(`${tsFile} 里找不到 BATCH_ENDPOINTS`)
  const start = source.indexOf('{', anchor)
  let depth = 0
  let end = -1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error(`${tsFile} 里 BATCH_ENDPOINTS 的对象字面量没有闭合`)
  return new Function(`return ${source.slice(start, end + 1)}`)()
}

const main = () => {
  const fromTs = argOf('--from-ts')
  if (fromTs) {
    fs.writeFileSync(ENDPOINTS_FILE, JSON.stringify(extractEndpoints(fromTs), null, 2) + '\n')
    console.log(`[select-sample] 已从 ${fromTs} 抽出契约 → ${path.relative(PKG_ROOT, ENDPOINTS_FILE)}`)
  }
  const endpoints = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'))
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
  const routeFileByPath = new Map(catalog.items.filter((i) => i.menuPath).map((i) => [i.menuPath, i.routeFile]))

  const auto = Object.values(endpoints).filter((e) => e.verdict === 'auto')
  if (auto.length === 0) {
    throw new Error('全量契约没有 auto 页面——输入可能过期或生成器未产出可直接接入的页面')
  }

  // 逐页算出分层事实（读源码只为 L6，缺文件就记 null，不猜）
  const annotated = auto.map((e) => {
    const routeFile = routeFileByPath.get(e.pagePath) ?? null
    let source = null
    if (routeFile) {
      try { source = fs.readFileSync(path.join(PORTAL_REPO, routeFile), 'utf8') } catch { source = null }
    }
    const { layers, hooks } = layersOf(e, source)
    return { ...e, routeFile, rewriteHooks: hooks, layers }
  })

  const withSource = annotated.filter((a) => a.routeFile).length

  // 每层配额。总数靠"层内去重"压住——同一个域最多先来 1 页，保证横向铺开
  const QUOTA = {
    'L1:参数名像日期/时间': 3,
    'L2:参数名是 Id 引用': 3,
    'L3:参数个数>=8': 2,
    'L4:非 /admin-api 前缀': 7,
    'L5:不分页': 2,
    'L6:源码有改写钩子': 2,
    'L7:对照(绝对 /admin-api、参数少、无日期无引用)': 3,
  }
  const layerKeys = Object.keys(QUOTA)
  const layerTotals = Object.fromEntries(layerKeys.map((k) => [k, annotated.filter((a) => a.layers.includes(k)).length]))

  const picked = new Map() // pagePath -> { endpoint, claimedBy }
  const domainCount = new Map()
  const takeFrom = (layer) => {
    const quota = QUOTA[layer]
    const pool = annotated
      .filter((a) => a.layers.includes(layer) && !picked.has(a.pagePath))
      // 稳定排序 + 域多样性：同一域已有 1 页就往后排，避免 3 个名额全落在 platform 域
      .sort((x, y) => (domainCount.get(x.domain) ?? 0) - (domainCount.get(y.domain) ?? 0) || x.pagePath.localeCompare(y.pagePath))
    let taken = 0
    for (const a of pool) {
      if (taken >= quota) break
      picked.set(a.pagePath, { ...a, claimedBy: layer })
      domainCount.set(a.domain, (domainCount.get(a.domain) ?? 0) + 1)
      taken++
    }
  }

  // L7 最后认领，免得把它自己的"参数少"名额耗在别的层上
  for (const layer of layerKeys.filter((l) => !l.startsWith('L7'))) takeFrom(layer)
  takeFrom('L7:对照(绝对 /admin-api、参数少、无日期无引用)')

  // 显式锚点：这两页的结论已经独立存在，抽进来当**校准**——
  // 装置如果连这两页都测不出已知结论，装置本身就不合格。
  // 第三个锚点是对照组：它和考勤档案**打同一个后端接口**（/org/hrAttendanceSheet/page），
  // 但页面上没有 isArchived。两页的差异就是 isArchived 这个词的全部语义——
  // 如果只抓一页，"isArchived 到底是筛选条件还是页面定义"这件事只能靠读源码，不能靠观测。
  const ANCHORS = [
    '/dashboard/meeting-room/list',
    '/dashboard/attendance/attendance-archive-sheet/list',
    '/dashboard/attendance/attendance-sheet/list',
  ]

  // 锚点如果已经被某一层认领，就从层里去掉，避免同一页在计划里出现两次
  const pages = [...picked.values()]
    .filter((a) => !ANCHORS.includes(a.pagePath))
    .sort((a, b) => a.pagePath.localeCompare(b.pagePath))

  const plan = {
    用途: '设计 D20 的浏览器抽样基准：逐页比对「生成器给的契约」与「浏览器真实发出的请求」',
    选择方式: '分层抽样（不是随机）。层定义、口径与理由见 tools/sample/select-sample.mjs 文件头',
    样本总量: pages.length + ANCHORS.length,
    锚点: ANCHORS.map((p) => ({
      pagePath: p,
      reason: p.includes('meeting-room')
        ? '已有基准 baseline/meeting-room-page.browser.json，装置必须复现出一致的结论'
        : p.includes('archive-sheet')
          ? '已知反例：URL 层全对但 6 个参数里 4 个的 kind 是错的，isArchived 根本不该在契约里'
          : '对照组：与上一条打同一个后端接口（/org/hrAttendanceSheet/page）但没有 isArchived——两页之差就是这个词的全部语义',
    })),
    分层总量: layerTotals,
    层内去重说明: '一页可同时属于多层，但只抽一次；按 L1→L7 顺序认领，高风险层先拿名额',
    '源码可得性': { withRouteFile: withSource, total: annotated.length },
    页: [
      ...ANCHORS.map((p) => {
        const a = annotated.find((x) => x.pagePath === p)
        return { pagePath: p, claimedBy: '锚点', layers: a ? a.layers : [], resolvedPath: a ? a.resolvedPath : null, moduleType: a ? a.moduleType : null }
      }),
      ...pages.map((a) => ({
        pagePath: a.pagePath,
        claimedBy: a.claimedBy,
        layers: a.layers,
        title: a.title,
        domain: a.domain,
        routeFile: a.routeFile,
        resolvedPath: a.resolvedPath,
        sizeParam: a.sizeParam,
        moduleType: a.moduleType,
        paramCount: a.query.length,
        params: a.query.map((q) => `${q.name}:${q.kind}`),
      })),
    ],
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(plan, null, 2) + '\n')
  console.log(`[select-sample] auto 总数 ${auto.length}｜分层总量 ${JSON.stringify(layerTotals)}`)
  console.log(`[select-sample] 抽了 ${plan.样本总量} 页（含 ${ANCHORS.length} 个锚点）→ ${path.relative(PKG_ROOT, OUT_FILE)}`)
  for (const p of plan.页) {
    const mark = p.claimedBy === '锚点' ? '锚点' : p.claimedBy.slice(0, 2)
    console.log(`  ${mark}  ${p.pagePath}  [${p.layers.map((l) => l.slice(0, 2)).join(',')}]`)
  }
}

main()
