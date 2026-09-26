#!/usr/bin/env node
/**
 * 逐字段比对 + 判据化裁决。
 *
 * 用法：
 *   node tools/sample/analyze.mjs                 # 读 sample-results.json，写 verdicts.json，并打印结论
 *   node tools/sample/analyze.mjs --verbose       # 连每一页的逐字段明细一起打印
 *   node tools/sample/analyze.mjs --results <f> --out <f>   # 换输入/输出（重跑单页时用）
 *
 * 输入：
 *   tools/sample/sample-results.json   浏览器实测（由 run-sample.mjs 产出）
 *   tools/sample/endpoints.json        生成器的全量契约（`--all` 生成物的 BATCH_ENDPOINTS）
 *   src/context/module-type.ts         **规则表实现**（module-type 一律从这里复核，不抄浏览器抓到的值）
 *   tools/sample/sample-plan.json      分层总量（层的唯一定义在 select-sample.mjs，这里只读它的结论）
 *
 * 产出：
 *   tools/sample/verdicts.json         逐页逐字段的比对结论 + 分类
 *
 * ---- 判据（三分类）----
 *
 * 这三分不是"好/中/差"，是**接线的动作不同**。分两个正交维度看：
 *
 * **形状**（路径 / 参数集合 / 顺序 / 初值）= 请求本身对不对，错了就是发错请求；
 * **描述**（控件形态 / 候选规模）= 契约把参数说清楚没有，错了是 AI 传错值。
 *
 * | 分类 | 含义 | 判据（任一命中即归此类） |
 * | --- | --- | --- |
 * | `不能接` | 接进去会**发错请求**，静默错数据 | 路径不符；找不到列表请求；浏览器发了契约里没有的参数；初值是字面量的没发；值被改过；顺序不是契约顺序的子序列 |
 * | `需要人补` | 形状对，但**契约描述错**，AI 会传错值 | 参数 kind 与页面控件不符；契约里有参数但页面上没有控件（页面定义混进了筛选条件）；长选项未标注；module-type 对不上 |
 * | `可以直接接` | 形状与描述都对得上 | 以上都没命中 |
 *
 * 两条容易被误判成错的**正确行为**，这里刻意不算错：
 * - `null` 初值的参数浏览器**本来就不发**（qs skipNulls）→ 不算"应发未发"；
 * - 实际参数是契约顺序的**子序列**（中间那些 null 被丢掉）→ 不算"顺序不符"。
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
const RESULTS_FILE = argOf('--results') || path.join(HERE, 'sample-results.json')
const ENDPOINTS_FILE = path.join(HERE, 'endpoints.json')
const OUT_FILE = argOf('--out') || path.join(HERE, 'verdicts.json')
const VERBOSE = process.argv.includes('--verbose')

// module-type **一律从规则表实现复核**，不读浏览器抓到的值。
// 直接 import `src/context/module-type.ts`（Node 22 原生剥类型），不走 `dist/`——
// `dist/` 在 .gitignore 里，依赖它会让这套装置在新克隆的机器上根本跑不起来，
// 而且会出现"读的是陈旧构建产物"这种最难查的错。
const { resolveModuleType } = await import(path.join(PKG_ROOT, 'src/context/module-type.ts'))

/** renren 列表接口自带、不来自页面表单的两个参数。 */
const RENREN_PARAMS = ['order', 'orderField']
/** 契约里 kind 的取值只有这几种，它们没有一个能表达"这是个日期"或"这是个下拉"。 */
const TEXTY_KINDS = new Set(['string', 'null', 'undefined'])
/** 候选超过这个数就算"长选项"：调用方不能不带关键字就拉全量（约定 11 / D6 / H35）。 */
const LONG_OPTION_THRESHOLD = 100

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const parseUrl = (raw) => {
  const u = new URL(raw.replace(/&amp;/g, '&'))
  return { pathname: u.pathname, keys: [...u.searchParams.keys()].filter((k) => k !== '_t'), params: u.searchParams }
}

const stripTs = (url) => url.replace(/([?&])_t=[^&]*/g, '$1').replace(/[?&]$/, '')

const camelTokens = (name) => name
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[\s_]+/)
  .map((t) => t.toLowerCase())
  .filter((t) => t.length > 2 && !['id', 'the'].includes(t))

/**
 * 「契约里有、页面上找不到控件」有**三种完全不同的原因**，后果也完全不同，
 * 只报现象会把它们混成一个错。运行时看不出来（DOM 里都没有那个控件），
 * 但源码里分得开，所以这里回去核对源码——这是**静态核对**，不是运行时实测，
 * 结论里必须标清楚是哪一种。
 *
 * | 源码形态 | 判定 | 后果 |
 * | --- | --- | --- |
 * | 没有任何**控件绑定**（`v-model` / `:prop="…formState.<name>"`） | `page-definition` | 页面自己定义的常量或页面状态混进了筛选条件（isArchived / targetType / disabled 都是这一类） |
 * | 有控件绑定，但所在 form-item 带 `v-if` | `conditional` | 控件按账号/条件渲染（tenantName 只对 admin 显示） |
 * | 有控件绑定、没有 `v-if` | `probe-blindspot` | 控件真的在页面上，是**探针抓不到**（自定义组件 / tabs 不走 id 注入） |
 *
 * ⚠️ **只能数"绑定"，不能数 `formState.<name>` 的出现次数**——这条本轮踩过：
 * 赋值与比较（`rrList.formState.disabled = '0'`、`v-if="…disabled === '0'"`）
 * 也是 `formState.<name>`，但它们说明的是"这是页面状态"，恰恰**没有**控件。
 * 按出现次数数会把 image-list 的 `targetType`/`disabled`（切 tab 时程序写进去、
 * 用来决定显示哪个按钮的页面状态）误判成"控件在页面上、只是探针没抓到"——
 * 而它们正是 isArchived 那一类**最危险**的参数（`disabled=1` 会切到回收站列表）。
 */
const CONTROL_BINDING = (name) =>
  new RegExp(`(?:v-model(?::[\\w-]+)?|:[\\w-]+)\\s*=\\s*"[^"]*formState\\.${name}\\b`)

const classifyNoControl = (source, name) => {
  if (!source) return { kind: 'unknown', why: '读不到页面源码，无法区分这三种原因' }
  const mentions = source.split(`formState.${name}`).length - 1
  const bound = CONTROL_BINDING(name).test(source)
  if (!bound) {
    return {
      kind: 'page-definition',
      why: mentions === 0
        ? `源码里除了 form 初值，没有任何 formState.${name} 绑定——页面上不存在这个控件`
        : `源码里 formState.${name} 出现了 ${mentions} 次，但**没有一次是控件绑定**（都是赋值/条件判断），它由页面逻辑或切 tab 时程序写入，不是用户能填的筛选条件`,
    }
  }

  // 找到声明这个 name 的那个 <a-form-item> 开标签，看它自己带不带 v-if
  const at = source.indexOf(`name="${name}"`)
  if (at > -1) {
    const open = source.lastIndexOf('<a-form-item', at)
    const close = source.indexOf('>', at)
    if (open > -1 && close > open) {
      const tag = source.slice(open, close)
      if (/\bv-if\s*=/.test(tag)) return { kind: 'conditional', why: `控件存在但所在表单项带 v-if（${(tag.match(/v-if\s*=\s*"[^"]*"/) || [''])[0]}），当前账号下没有渲染` }
    }
  }
  return { kind: 'probe-blindspot', why: `源码里有 ${bound} 处 formState.${name} 绑定、所在表单项没有 v-if，控件确实在页面上——是探针没映射到（该控件没有 form_item_* id）` }
}

/** 该页**该发**的参数：初值是字面量（非 null/undefined/空数组）的才算，null 的 qs 会丢。 */
const requiredParams = (endpoint) => endpoint.query
  .filter((q) => q.defaultValue !== null && q.defaultValue !== undefined)
  .map((q) => q.name)
  .filter((n) => !(Array.isArray(n)))

// ---------------------------------------------------------------------------
// 1. 找出「应用外壳」请求：每页都发的那些，不能算这一页的候选来源
// ---------------------------------------------------------------------------

const shellPaths = (results) => {
  const perPage = results.map((r) => new Set(
    [...(r.mount?.cap ?? []), ...(r.query?.cap ?? [])]
      .map((c) => { try { return parseUrl(c.url).pathname } catch { return null } })
      .filter(Boolean),
  ))
  const counts = new Map()
  for (const set of perPage) for (const p of set) counts.set(p, (counts.get(p) ?? 0) + 1)
  // 出现在 >= 60% 页上的路径 = 应用外壳（字典、菜单、租户、待办角标…）
  const threshold = Math.max(2, Math.ceil(results.length * 0.6))
  return { paths: new Set([...counts].filter(([, n]) => n >= threshold).map(([p]) => p)), threshold }
}

// ---------------------------------------------------------------------------
// 2. 逐页比对
// ---------------------------------------------------------------------------

const analyzePage = (record, endpoint, shell, source) => {
  const out = {
    pagePath: record.pagePath,
    capabilityId: endpoint.capabilityId,
    title: endpoint.title,
    layers: record.plan.layers,
    resolvedPath: endpoint.resolvedPath,
    moduleType: { 契约: endpoint.moduleType },
    比对: {},
    发现: [],
  }
  if (record.抓取失败) {
    out.分类 = '不能接'
    out.发现.push({ 类型: '抓取失败', 严重度: 'blocking', 说明: record.抓取失败 })
    return out
  }
  // 同样的防串页检查：DOM 探针记录的当前 URL 必须就是这一页。
  // 不查的话，一次失败的 reload 会让上一页的请求被算到这一页头上。
  const capturedAt = record.dom?.url
  if (typeof capturedAt === 'string' && !capturedAt.includes(record.pagePath)) {
    out.分类 = '不能接'
    out.发现.push({ 类型: '抓取串页', 严重度: 'blocking', 说明: `这一次抓取的文档 URL 是 ${capturedAt}，不是 ${record.pagePath}——抓下来的请求属于别的页面，结论作废。` })
    return out
  }

  // ---- 2.1 定位列表请求（mount 优先，取最后一次；query 阶段用来做一致性复核）----
  const findList = (phase) => (phase?.cap ?? [])
    .filter((c) => { try { return parseUrl(c.url).pathname === endpoint.resolvedPath } catch { return false } })
  const mountHits = findList(record.mount)
  const queryHits = findList(record.query)

  if (!mountHits.length && !queryHits.length) {
    out.分类 = '不能接'
    out.发现.push({
      类型: '路径不符',
      严重度: 'blocking',
      说明: `契约说 ${endpoint.resolvedPath}，但这页发出的请求里找不到这个路径。实际发出的后端路径：` +
        [...new Set([...(record.mount?.cap ?? []), ...(record.query?.cap ?? [])]
          .map((c) => { try { return parseUrl(c.url).pathname } catch { return null } }).filter(Boolean))].join(' / '),
    })
    return out
  }
  const list = queryHits[queryHits.length - 1] ?? mountHits[mountHits.length - 1]
  out.实际列表请求 = stripTs(list.url)
  out.比对.路径一致 = true

  // 挂载请求 vs 点「查询」请求：形状必须一致，否则契约没法只描述一个形状
  if (mountHits.length && queryHits.length) {
    out.比对.挂载与查询一致 = stripTs(mountHits[mountHits.length - 1].url) === stripTs(queryHits[queryHits.length - 1].url)
  }

  const actual = parseUrl(list.url)
  const actualKeys = actual.keys
  const contractNames = endpoint.query.map((q) => q.name)

  // ---- 2.2 参数集合 ----
  const extra = actualKeys.filter((k) => !contractNames.includes(k))
  const missing = requiredParams(endpoint).filter((n) => !actualKeys.includes(n))
  out.比对.参数 = {
    浏览器实际顺序: actualKeys,
    契约顺序: contractNames,
    多发_契约里没有: extra,
    应发未发: missing,
    null初值未发: endpoint.query.filter((q) => q.defaultValue === null && !actualKeys.includes(q.name)).map((q) => q.name),
  }
  if (extra.length) {
    out.发现.push({ 类型: '契约漏参', 严重度: 'blocking', 说明: `浏览器发了契约里没有的参数：${extra.join(', ')}——调用方无法表达，且 SDK 复刻出来的请求会与浏览器不一致` })
  }
  if (missing.length) {
    out.发现.push({ 类型: '应发未发', 严重度: 'blocking', 说明: `初值是字面量的参数没发：${missing.join(', ')}` })
  }
  // 初值是字面量的参数，浏览器发出去的值必须**就是那个初值**。
  // 这一条抓的是"键都一样、值被改过"的改写钩子——只比对键集合抓不到它。
  const valueMismatch = []
  for (const q of endpoint.query) {
    if (q.defaultValue === null || q.defaultValue === undefined || Array.isArray(q.defaultValue)) continue
    if (!actual.keys.includes(q.name)) continue
    const sentValue = actual.params.get(q.name)
    if (String(q.defaultValue) !== String(sentValue)) {
      valueMismatch.push({ name: q.name, 契约初值: q.defaultValue, 浏览器发出: sentValue })
    }
  }
  out.比对.初值不一致 = valueMismatch
  if (valueMismatch.length) {
    out.发现.push({
      类型: '默认值与浏览器不符',
      严重度: 'blocking',
      说明: `浏览器发出的值与契约初值不同：${valueMismatch.map((v) => `${v.name}=${JSON.stringify(v.浏览器发出)}(契约 ${JSON.stringify(v.契约初值)})`).join('；')}` +
        '——键集合一样但这几个值被改过，SDK 按契约拼出来的请求会与浏览器不一致。',
    })
  }

  // 顺序：实际发的必须是契约顺序的子序列
  let cursor = -1
  let orderOk = true
  for (const k of actualKeys) {
    const at = contractNames.indexOf(k)
    if (at < cursor) { orderOk = false; break }
    cursor = at
  }
  out.比对.顺序一致 = orderOk
  if (!orderOk) {
    // 顺序算**形状**问题：SDK 是按契约顺序拼 query 的，顺序不符意味着 SDK 发出去的
    // 请求与浏览器不是逐字段一致（D20 的字面要求），所以它和"多发一个参数"同级。
    out.发现.push({ 类型: '参数顺序不符', 严重度: 'blocking', 说明: `浏览器实际顺序 ${actualKeys.join(',')} 不是契约顺序 ${contractNames.join(',')} 的子序列——renren 的列表接口靠 order/orderField/form 同序，SDK 按契约拼出来的 query 会与浏览器不一致` })
  }

  // ---- 2.3 控件形态 vs kind ----
  const formItems = record.dom?.formItems ?? []
  const byName = new Map(formItems.map((f) => [f.name, f]))
  out.比对.控件 = {}
  const paramChecks = []
  // order/orderField 是 renren 自带的；pageNo/pageSize 在页面上是**分页器**不是表单控件。
  // 这三类都没有 `form_item_*` 的 id，不排除掉就会每页误报三条"页面上没有控件"。
  const notFormControls = new Set([...RENREN_PARAMS, endpoint.pageParam, endpoint.sizeParam].filter(Boolean))
  for (const q of endpoint.query) {
    if (notFormControls.has(q.name)) continue
    const item = byName.get(q.name)
    const check = { name: q.name, kind: q.kind, defaultValue: q.defaultValue }
    if (!item) {
      check.control = null
      check.verdict = '页面上没有这个控件'
      paramChecks.push(check)
      continue
    }
    check.control = item.control
    check.label = item.label
    if (item.control === 'select') { check.showSearch = item.showSearch; check.multiple = item.multiple }
    if (item.control === 'picker' || item.control === 'range-picker') {
      check.pickerClass = item.pickerClass
      check.verdict = TEXTY_KINDS.has(q.kind) ? `kind 是 ${q.kind}，实际是日期控件` : '一致'
      check.mismatch = TEXTY_KINDS.has(q.kind)
    } else if (item.control === 'select' || item.control === 'cascader' || item.control === 'tree-select') {
      check.verdict = `kind 是 ${q.kind}，实际是「选择型」控件（契约没有任何字段说明它是选项、有候选、要不要关键字）`
      check.mismatch = true
    } else if (item.control === 'text') {
      check.verdict = TEXTY_KINDS.has(q.kind) ? '一致' : `kind 是 ${q.kind}，实际是自由文本`
      check.mismatch = !TEXTY_KINDS.has(q.kind)
    } else if (item.control === 'input-number') {
      check.verdict = q.kind === 'number' ? '一致' : `kind 是 ${q.kind}，实际是数字输入`
      check.mismatch = q.kind !== 'number'
    } else {
      check.verdict = `kind 是 ${q.kind}，实际是 ${item.control}`
      check.mismatch = TEXTY_KINDS.has(q.kind) ? false : true
    }
    paramChecks.push(check)
  }
  out.比对.控件 = paramChecks

  const noControl = paramChecks.filter((p) => !p.control)
  const kindWrong = paramChecks.filter((p) => p.mismatch)
  // 源码核对后才知道"没有控件"到底是哪一种——不核对就报，就会把
  // "探针抓不到的自定义控件"说成"页面定义常量"，那是假结论（本轮真差点这么报）。
  const noControlChecks = []
  for (const p of noControl) {
    const cause = classifyNoControl(source, p.name)
    noControlChecks.push({ name: p.name, kind: p.kind, defaultValue: p.defaultValue, ...cause })
    out.发现.push({
      类型: `契约里有、页面上没有控件（${cause.kind}）`,
      严重度: 'high',
      参数: p.name,
      说明: `参数 ${p.name}（契约 kind=${p.kind}，初值 ${JSON.stringify(p.defaultValue)}）在 DOM 里没有 ` +
        `form_item_${p.name} 这个 id。${cause.why}` +
        (cause.kind === 'page-definition'
          ? (p.defaultValue !== null && p.defaultValue !== undefined && p.defaultValue !== ''
            // 有意义的常量（`isArchived: 1`）：页面用它给列表分档，不是给用户筛的
            ? `→ 它是**页面自己定义的常量**（初值 ${JSON.stringify(p.defaultValue)}，不是空值），用来给列表分档；留在契约里等于给 AI 一个可以拨动的开关，拨了会静默查到另一批数据。`
            // 空初值：页面压根没给它入口
            : '→ 页面上没有任何入口能设置它，浏览器每次发的都是空值——要么这页的筛选区没和列表请求接上线，要么它就是个死参数。')
          : cause.kind === 'conditional'
            ? '→ 它是不是能力参数取决于登录账号，契约里必须有条件地描述它。'
            : '→ 这是**探针的盲区**，不是页面的问题：不要据此断言"契约里有死参数"。'),
    })
  }
  out.比对.无控件参数成因 = noControlChecks
  // 探针盲区这条证据是后加的：早于该字段的抓取里没有它。
  // 缺字段要写 null（=没测），不能写 []（=测了、没有）——这两件事不能混。
  out.比对.探针盲区 = record.dom?.unmappedFormItems === undefined
    ? null
    : record.dom.unmappedFormItems.map((f) => `${f.label}(${f.controlGuess})`)
  // 日期型与选择型分开计数：两者的补法完全不同（一个是改 kind，一个是要值域/搜索接口）
  for (const p of kindWrong) {
    const isChoice = ['select', 'cascader', 'tree-select'].includes(p.control)
    out.发现.push({
      类型: isChoice ? 'kind 判错（选择型）' : (p.control === 'picker' || p.control === 'range-picker' ? 'kind 判错（日期）' : 'kind 判错'),
      严重度: 'high',
      参数: p.name,
      说明: `参数 ${p.name}：${p.verdict}`,
      控件: p.control,
      label: p.label,
    })
  }

  // ---- 2.4 反向：页面有控件、契约没有 ----
  const notInContract = formItems.filter((f) => f.name && !contractNames.includes(f.name) && f.name !== '')
  out.比对.页面控件但契约没有 = notInContract.map((f) => `${f.name}(${f.control})`)

  // 页面的筛选区与契约的**完全不重合**时，这不是"漏了一个参数"，而是这一页的
  // 筛选 UI 与列表请求根本不是同一套字段（实测 `/dashboard/platform/chicken/apply/list`：
  // 页面渲染 userName/phone/product/startTime/endTime，表单初值却是 username/gender/deptId，
  // 五个筛选框写进的 formState 字段**一个都不发**——页面上自己点也是白点）。
  // 这时契约既表达不了页面、页面也验证不了契约，**不能接**。
  const disjointForm = notInContract.length > 0 &&
    paramChecks.length > 0 && paramChecks.every((p) => !p.control)
  out.比对.筛选区与契约完全不重合 = disjointForm
  for (const f of notInContract) {
    out.发现.push({
      类型: disjointForm ? '页面筛选与契约参数完全不重合' : '契约漏参（页面有控件、契约没有）',
      严重度: disjointForm ? 'blocking' : 'high',
      参数: f.name,
      说明: `页面表单有 ${f.name}（${f.control}，label「${f.label}」），契约里没有。` +
        (disjointForm
          ? '而且契约里那些参数**一个控件都没有**——两边是两套不相干的字段名，说明这页的筛选区与列表请求没接上。'
          : '——调用方无法表达这个筛选。'),
    })
  }

  // ---- 2.5 候选规模（长选项）----
  const resByUrl = new Map()
  for (const r of [...(record.mount?.res ?? []), ...(record.query?.res ?? [])]) resByUrl.set(stripTs(r.url), r)
  const listKeys = new Set([list.url, ...mountHits.map((h) => h.url)].map(stripTs))
  const candidateReqs = [...new Set([...(record.mount?.cap ?? []), ...(record.query?.cap ?? [])].map((c) => stripTs(c.url)))]
    .filter((u) => {
      try {
        const p = parseUrl(u).pathname
        return !listKeys.has(u) && p.startsWith('/') && !shell.paths.has(p)
      } catch { return false }
    })
    .map((u) => {
      const r = resByUrl.get(u)
      let q = {}
      try { q = Object.fromEntries(parseUrl(u).params) } catch { /* 保持空 */ }
      return {
        url: u,
        path: (() => { try { return parseUrl(u).pathname } catch { return u } })(),
        候选条数: r?.arrayLen ?? null,
        总数: r?.total ?? null,
        // 页面自己都要靠关键字/分页去收敛候选 → 这个下拉必然开不出来全量
        自带关键字或分页: 'keyword' in q || 'pageSize' in q || 'pageNo' in q,
      }
    })
  out.比对.候选来源请求 = candidateReqs

  // 归因：按参数名 token 与请求路径的匹配打分，**标注为推断**（浏览器不告诉我们哪个下拉发了哪个请求）
  const selects = paramChecks.filter((p) => p.control === 'select')
  const attribution = selects.map((s) => {
    const tokens = camelTokens(s.name)
    const scored = candidateReqs.map((c) => ({
      ...c,
      score: tokens.filter((t) => c.path.toLowerCase().includes(t)).length,
    })).filter((c) => c.score > 0).sort((x, y) => y.score - x.score)
    return { 参数: s.name, label: s.label, showSearch: s.showSearch, 归因方式: '按名字推断（不精确）', 候选来源: scored.slice(0, 2) }
  })
  out.比对.下拉参数归因 = attribution

  const sizeOf = (c) => Math.max(c.候选条数 ?? 0, c.总数 ?? 0)
  const longOptions = attribution.filter((a) => a.候选来源.some((c) => sizeOf(c) >= LONG_OPTION_THRESHOLD))
  for (const a of longOptions) {
    // 取**最大**的那一条报，别按打分顺序取第一条（否则会把 922 条报成 17 条——这个 bug 本轮真的出现过）
    const c = [...a.候选来源].sort((x, y) => sizeOf(y) - sizeOf(x))[0]
    out.发现.push({
      类型: '长选项未标注',
      严重度: 'high',
      参数: a.参数,
      说明: `参数 ${a.参数}（「${a.label}」）是下拉，候选规模达 ${sizeOf(c)} 条（来源 ${c.path}）` +
        (c.自带关键字或分页 ? '，页面自己都要靠 keyword+分页去收敛' : '') +
        '；契约里只有一个 kind，调用方不知道传什么、也不知道要不要关键字。',
    })
  }
  out.比对.长选项个数 = longOptions.length

  // ---- 2.6 module-type：一律拿规则表复核，不抄浏览器 ----
  const rule = resolveModuleType(record.pagePath)
  const sent = list.headers?.['module-type'] ?? null
  const cookie = record.dom?.menuPathCookie ?? null
  out.moduleType = {
    契约: endpoint.moduleType,
    规则表: rule.moduleType,
    规则表命中依据: rule.matchedBy,
    浏览器实际发送: sent,
    抓取时cookie: cookie,
    cookie是否指向本页: cookie === record.pagePath,
    规则表与契约一致: rule.moduleType === endpoint.moduleType,
  }
  if (rule.moduleType !== endpoint.moduleType) {
    out.发现.push({ 类型: 'module-type 与规则表不符', 严重度: 'high', 说明: `契约 ${endpoint.moduleType}，规则表 ${rule.moduleType}（${rule.matchedBy}）` })
  }
  // 浏览器值只在 cookie 指向本页时才可采信；否则按任务要求以规则表为准
  if (!out.moduleType.cookie是否指向本页) {
    out.moduleType.浏览器值是否可采信 = false
    out.moduleType.说明 = '抓取时 cookie `hr-0.0.0-menuPath` 指向别的路由（同一浏览器 profile 的其它标签页改写了它），浏览器发出的 module-type 不能作为本页的基准；结论以规则表为准。'
  } else {
    out.moduleType.浏览器值是否可采信 = true
    // cookie 指向本页 = 这一刻浏览器发的是本页该发的值，可以拿来反向核对规则表
    const sentNum = sent === null || sent === undefined || sent === '' ? null : Number(sent)
    if (sentNum !== rule.moduleType) {
      out.发现.push({
        类型: 'module-type 浏览器值与规则表不符',
        严重度: 'high',
        说明: `cookie 指向本页、浏览器发的是 ${sent}，规则表推的是 ${rule.moduleType}（${rule.matchedBy}）——两者必须一致，不一致说明规则表漏了一条或抓取时被别的标签页污染过。`,
      })
    }
  }

  // ---- 2.7 分类 ----
  // 两个正交的维度，分开报：
  //   形状 = 请求本身对不对（路径 / 参数集合 / 顺序）——错了就是发错请求
  //   描述 = 契约把参数说清楚没有（控件形态 / 候选规模）——错了是 AI 传错值
  // 只报一个"需要人补"会把这两件事混成一件，看不出"路径全对但契约描述不了页面"这个主要矛盾。
  out.形状 = {
    路径: true,
    参数集合: extra.length === 0 && missing.length === 0,
    顺序: orderOk,
  }
  const blocking = out.发现.filter((f) => f.严重度 === 'blocking')
  const descriptive = out.发现.filter((f) => f.严重度 !== 'blocking')
  out.形状全对 = Object.values(out.形状).every((v) => v !== false)
  out.分类 = blocking.length ? '不能接' : (descriptive.length ? '需要人补' : '可以直接接')
  return out
}

// ---------------------------------------------------------------------------
// 3. 主流程
// ---------------------------------------------------------------------------

const merged = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
const endpoints = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'))
const auto = Object.values(endpoints).filter((e) => e.verdict === 'auto')

// 页面源码：**只用来区分「没有控件」的三种原因**（见 classifyNoControl）。
// 读不到就如实记 unknown，不去猜。源码路径来自 page-catalog.json，Portal 仓库路径可用 PORTAL_REPO 覆盖。
const PORTAL_REPO = process.env.PORTAL_REPO || '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const catalog = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'generated/page-catalog.json'), 'utf8'))
const routeFileByPath = new Map(catalog.items.filter((i) => i.menuPath).map((i) => [i.menuPath, i.routeFile]))
const sourceOf = (pagePath) => {
  const routeFile = routeFileByPath.get(pagePath)
  if (!routeFile) return null
  try { return fs.readFileSync(path.join(PORTAL_REPO, routeFile), 'utf8') } catch { return null }
}

const shell = shellPaths(merged.结果)
const pages = merged.结果.map((r) => {
  const endpoint = auto.find((e) => e.pagePath === r.pagePath)
  if (!endpoint) throw new Error(`endpoints.json 里没有 ${r.pagePath}`)
  return analyzePage(r, endpoint, shell, sourceOf(r.pagePath))
})

const tally = (list) => list.reduce((acc, p) => { acc[p.分类] = (acc[p.分类] ?? 0) + 1; return acc }, {})
const summary = tally(pages)

// 按层统计：抽样是分层的，层内通过率就是外推的依据。
// **层内总量不在这里重算**——那会变成"层定义有第二份实现"，两边必然漂移。
// 唯一来源是 select-sample.mjs 写下的 `分层总量`（它同时算参数启发式与源码扫描）。
const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'sample-plan.json'), 'utf8'))
const layerTotals = plan.分层总量
const byLayer = {}
for (const p of pages) {
  for (const l of p.layers) {
    byLayer[l] ??= { 抽样: 0, 可以直接接: 0, 需要人补: 0, 不能接: 0, 层内总量: layerTotals[l] ?? null }
    byLayer[l].抽样++
    byLayer[l][p.分类]++
  }
}
for (const [l, total] of Object.entries(layerTotals)) {
  if (!byLayer[l]) byLayer[l] = { 抽样: 0, 可以直接接: 0, 需要人补: 0, 不能接: 0, 层内总量: total }
}

/**
 * 全量外推。**不用"层内通过率 × 层大小"**——那个乘法依赖"层内同质"这个没人验证过的假设。
 * 这里只用一条**结构上成立**的事实：
 *
 *   契约里除了 renren 的 `order/orderField` 和分页参数之外**没有任何页面级参数**的页面，
 *   不可能有"kind 描述不了页面控件"这个问题——因为它压根没有参数可以描述。
 *
 * 这个集合是**契约的函数**（不需要跑浏览器就能数出来），而"有参数的页面会需要人补"
 * 这条由抽样支持（抽样里每一个有参数的页都命中了 kind 判错）。
 * 两者合起来给出上下界，比乘一个百分比诚实。
 */
const RENREN_SET = new Set(RENREN_PARAMS)
const pageLevelParams = (e) => e.query.filter((q) => !RENREN_SET.has(q.name) && q.name !== e.pageParam && q.name !== e.sizeParam)
const noParamPages = auto.filter((e) => pageLevelParams(e).length === 0)
const withParamPages = auto.filter((e) => pageLevelParams(e).length > 0)
const sampledClean = pages.filter((p) => p.分类 === '可以直接接')
const sampledCleanWithParams = sampledClean.filter((p) => {
  const e = auto.find((x) => x.pagePath === p.pagePath)
  return e && pageLevelParams(e).length > 0
})

const report = {
  全量外推: {
    口径: '只做**结构分组**，不用"层内通过率 × 层大小"外推百分比——那个乘法假设了组内同质，而下面实测已证明它不同质。',
    auto总数: auto.length,
    'A 组·无页面级参数（契约里只有 order/orderField ± 分页）': noParamPages.length,
    'B 组·有页面级参数': withParamPages.length,
    分组依据: '这是**契约本身的函数**，不需要跑浏览器就能数出来：没有页面级参数，就没有"kind 描述不了控件"这个问题。',
    实测: {
      'A 组抽样': noParamPages.filter((e) => pages.some((p) => p.pagePath === e.pagePath)).length,
      'A 组判为可以直接接': pages.filter((p) => p.分类 === '可以直接接' && noParamPages.some((e) => e.pagePath === p.pagePath)).length,
      'B 组抽样': withParamPages.filter((e) => pages.some((p) => p.pagePath === e.pagePath)).length,
      'B 组判为可以直接接': sampledCleanWithParams.length,
      'B 组里判为可以直接接的页': sampledCleanWithParams.map((p) => p.pagePath),
      说明: sampledCleanWithParams.length === 0
        ? 'A 组全通过、B 组全需要人补——两组泾渭分明。'
        : `**B 组不是均质的**：B 组抽样 ${withParamPages.filter((e) => pages.some((p) => p.pagePath === e.pagePath)).length} 页里有 ${sampledCleanWithParams.length} 页可以直接接，`
          + `它们的共同点是**参数全是自由文本输入**（${sampledCleanWithParams.map((p) => p.pagePath.replace('/dashboard/', '')).join('、')}）——kind=string 对文本框本来就是对的。`
          + '所以"有参数 ⇒ 需要人补"这个更强的说法被实测推翻了：**只有参数会渲染成日期/下拉/选项的页才需要人补**，'
          + '而"某个参数会不会渲染成下拉"在源码里判不出来，只能运行时看。',
    },
    外推: {
      能直接说的: `A 组 ${noParamPages.length} 页结构上不会因 kind 出问题（实测抽到的 A 组页全部通过）；`
        + `B 组 ${withParamPages.length} 页里，抽样 ${withParamPages.filter((e) => pages.some((p) => p.pagePath === e.pagePath)).length} 页有 ${withParamPages.filter((e) => pages.some((p) => p.pagePath === e.pagePath)).length - sampledCleanWithParams.length} 页需要人补。`,
      不能说: '不能把抽样比例乘回 B 组——B 组内部差异极大（从"全是文本框"到"6 个参数里 4 个 kind 是错的"都有），乘出来的数字没有依据。'
        + 'B 组要得到逐页结论，只能逐页跑本装置（每页约 30 秒）。',
      本轮的实测比例: `24 页：可以直接接 ${sampledClean.length}（${(sampledClean.length / pages.length * 100).toFixed(0)}%）｜需要人补 ${pages.filter((p) => p.分类 === '需要人补').length}｜不能接 ${pages.filter((p) => p.分类 === '不能接').length}`,
    },
  },
  '待补齐（本轮没做到的）': [
    '长选项的**搜索接口**没有逐个确认：装置量到了"有 922 条候选"（班组）与"494 条候选且页面自己靠 keyword+分页"（供应商），'
      + '但没有回答"无头调用方该传哪个关键字参数、打哪个接口"。这是**真正只能人做**的那部分，也是新增工作量的大头。',
    '"页面定义混进契约"这一类在 136 里的**规模**没有结论：抽样命中 4 页 / 7 个参数，但这个比例既不能乘（B 组不同质），'
      + '也没有别的判据可以先验地找出这类页——只能逐页跑装置。后果最重（静默换数据集），所以它值得逐页过。',
    '响应侧没比对：装置只抓请求，不判断返回的数据对不对（D20 只要求请求逐字段一致）。',
    '值改写只在"初值是字面量"的参数上比对了（`默认值与浏览器不符`）。初值为空/null 的参数被钩子改写值，装置看不出来。',
    '探针的覆盖是**逐例**核对的（4 页命中 probe-blindspot，都回源确认过），不是一个自动的全覆盖检查；'
      + '换言之"装置没报无控件"不等于"这页所有控件都被映射到了"。',
    '多个标签页共用一个浏览器 profile，`hr-0.0.0-menuPath` 这个 module-type 来源的 cookie 是全局的。'
      + '本轮的流程（每次 reload 到目标路由）让 24/24 页的 cookie 都指向本页，因此没能**观察到**被别的标签页污染的情形——'
      + '污染本身是已知事实（见 baseline/attendance-archive-sheet.browser.json 的记录），但本轮的样本里没有复现出来。',
  ],
  口径: {
    抽样: '分层抽样（层定义见 tools/sample/select-sample.mjs），不是随机抽样',
    抽样轮次: 'L4 层（71 页，最大的一层）第一轮只抽了 4 页，看到结果后把配额提到 7 补跑 3 页——是自适应抽样，只新增不淘汰；详见 select-sample.mjs 头部',
    分类判据: '不能接=会发错请求｜需要人补=请求形状对但契约描述错｜可以直接接=形状与描述都对上',
    moduleType: '一律以规则表（dist/context/module-type.js 的 resolveModuleType）为准，浏览器抓到的值只在 cookie 指向本页时作参考',
    应用外壳: `出现在 >= ${shell.threshold}/${merged.结果.length} 页上的请求路径被判定为「应用外壳」（字典/菜单/租户/待办角标），不计入单页的候选来源`,
    moduleTypeCookie: '`hr-0.0.0-menuPath` 是同一浏览器 profile **全局共享**的 cookie（由路由守卫写，见 baseline/attendance-archive-sheet.browser.json）。抓取时它若指向别的路由，浏览器发出的 module-type 就不是本页的值，该页的浏览器值不可采信——以规则表为准。',
  },
  'module-type 统计': {
    可采信页数: pages.filter((p) => p.moduleType?.浏览器值是否可采信).length,
    不可采信页数: pages.filter((p) => p.moduleType && !p.moduleType.浏览器值是否可采信).length,
    契约与规则表不符页数: pages.filter((p) => p.moduleType?.规则表与契约一致 === false).length,
    浏览器与规则表不符页数: pages.filter((p) => p.发现.some((f) => f.类型 === 'module-type 浏览器值与规则表不符')).length,
    按规则表发出头的页数: pages.filter((p) => p.moduleType?.规则表 !== null).length,
    规则表算不出的页数: pages.filter((p) => p.moduleType?.规则表 === null).length,
  },
  抽样总数: pages.length,
  成功抓取: pages.filter((p) => !p.抓取失败).length,
  分类合计: summary,
  形状全对页数: pages.filter((p) => p.形状全对).length,
  形状全对但描述有缺: pages.filter((p) => p.形状全对 && p.分类 === '需要人补').length,
  发现按类型计数: pages.flatMap((p) => p.发现).reduce((acc, f) => { acc[f.类型] = (acc[f.类型] ?? 0) + 1; return acc }, {}),
  // 「需要人补」不是一个动作：补的代价和补法分三档，混在一起会看不出该先修哪个。
  // 三档按"错下去的后果"排，不按发现条数排。
  待补分级: (() => {
    const has = (p, type) => p.发现.some((f) => f.类型 === type)
    const silentWrong = pages.filter((p) => has(p, '契约里有、页面上没有控件（page-definition）'))
    const longOption = pages.filter((p) => has(p, '长选项未标注'))
    const conditional = pages.filter((p) => has(p, '契约里有、页面上没有控件（conditional）'))
    const blindspot = pages.filter((p) => has(p, '契约里有、页面上没有控件（probe-blindspot）'))
    const typing = pages.filter((p) => p.发现.some((f) => f.类型.startsWith('kind 判错')))
    const paramCount = (list, type) => list.reduce((n, p) => n + p.发现.filter((f) => f.类型 === type).length, 0)
    return {
      '第 1 档·会静默返回错数据（页面定义混进了筛选条件）': {
        页数: silentWrong.length,
        参数个数: paramCount(silentWrong, '契约里有、页面上没有控件（page-definition）'),
        页: silentWrong.map((p) => p.pagePath),
      },
      '第 2 档·AI 无法正确调用（长选项：不知道传什么、要不要关键字）': { 页数: longOption.length, 页: longOption.map((p) => p.pagePath) },
      '第 3 档·只能瞎猜值域（日期/选择型的 kind 没有任何说明）': { 页数: typing.length, 页: typing.map((p) => p.pagePath) },
      '附带·按账号/条件渲染的参数（契约里必须有条件地描述）': { 页数: conditional.length, 页: conditional.map((p) => p.pagePath) },
      '附带·探针盲区（控件在，只是没走 id 注入——**不是**页面的问题）': {
        页数: blindspot.length,
        页: blindspot.map((p) => p.pagePath),
        备注: '「没有控件」的三种成因是**源码核对**得出的（静态），不依赖探针盲区字段；后者只是旁证。',
      },
    }
  })(),
  // 参数级统计：页数会掩盖"一页错 6 个参数"和"一页错 1 个参数"的区别
  参数级统计: (() => {
    const checks = pages.flatMap((p) => p.比对.控件 ?? [])
    return {
      检查的参数数: checks.length,
      kind与页面控件不符: checks.filter((c) => c.mismatch).length,
      页面上没有控件: checks.filter((c) => !c.control).length,
      一致: checks.filter((c) => c.control && !c.mismatch).length,
      按控件类型: checks.reduce((acc, c) => { const k = c.control ?? '(无控件)'; acc[k] = (acc[k] ?? 0) + 1; return acc }, {}),
    }
  })(),
  按层: byLayer,
  应用外壳路径: [...shell.paths].sort(),
  逐页: pages,
}

fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n')

const pad = (s, n) => String(s).padEnd(n)
console.log(`\n抽样 ${report.抽样总数} 页（成功抓取 ${report.成功抓取}）`)
console.log(`分类：${JSON.stringify(summary)}\n`)
console.log('逐页：')
for (const p of pages) {
  console.log(`  ${pad(p.分类, 6)} ${pad(p.pagePath, 58)} 发现 ${p.发现.length}`)
  if (VERBOSE) for (const f of p.发现) console.log(`         - [${f.严重度}] ${f.类型}${f.参数 ? '(' + f.参数 + ')' : ''}: ${f.说明}`)
}
console.log('\n按层：')
for (const [l, s] of Object.entries(byLayer)) {
  console.log(`  ${pad(l, 26)} 抽样 ${s.抽样}（层内共 ${s.层内总量}） 可直接接 ${s.可以直接接}｜需人补 ${s.需要人补}｜不能接 ${s.不能接}`)
}
console.log(`\n已写入 ${path.relative(PKG_ROOT, OUT_FILE)}`)
