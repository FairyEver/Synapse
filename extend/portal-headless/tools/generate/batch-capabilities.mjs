#!/usr/bin/env node
/**
 * 批量生成器：把「声明式列表页」一次抽成能力定义（设计 §1d / D24 / D26）。
 *
 * 背景：设计 §1d 实测 691 个列表页里 463 个（67%）是"纯声明式或接近声明式"，
 * 结论是"这部分不该逐页人工做，应该批量生成"。本脚本是那个结论的**实测工具**：
 * 它不只产出能力定义，还产出**每页的判定理由**（完全自动 / 需人补 / 失败），
 * 因为"能批量"这三个字到底覆盖多少页，只有跑一遍才知道（见 `batch-report.json`）。
 *
 * 用法：
 *   node tools/generate/batch-capabilities.mjs            # 只产出 20 个抽样页
 *   node tools/generate/batch-capabilities.mjs --all      # 产出全部声明式列表页
 *   node tools/generate/batch-capabilities.mjs --dry      # 只分析，不写文件
 *   环境变量 PORTAL_REPO / argv[2] 可指定 Portal 仓库路径。
 *
 * 产出（均为生成物，勿手改）：
 *   src/capabilities/generated/batch-capabilities.ts   能力定义 + 请求契约
 *   src/capabilities/generated/index.ts                注册入口（主会话接线用）
 *   src/capabilities/generated/batch-report.json       逐页判定 + 覆盖率统计
 *
 * 只读：本脚本不修改 Portal 仓库的任何文件（CodeReview_Projects_Js @ test/portal/main）。
 *
 * ---- 抽取规则来自的实际代码（改这里之前先回去读这几处）----
 *
 * | 事实 | 出处 |
 * | --- | --- |
 * | `params = { order, orderField, ...formState }` | `common/libs/renren/list.js:471-483` |
 * | 分页参数名取自 `fieldNamePageNo/PageSize`，全局默认 `pageNo`/`limit` | `common/libs/renren/config.js:9-10` |
 * | Portal 把全局每页条数名**覆写成 `pageSize`** | `app/portal/main.js:42-52` |
 * | `styleV2` 决定默认每页条数 20 / 10 | `common/libs/renren/list.js:391` |
 * | 列表请求用的 http 实例：页面传的 `http:` 优先，否则全局默认 | `common/libs/renren/list.js:247` |
 * | 全局默认 = `platform.js`（main.js 注入），**不是页面自己 import 的那个** | `app/portal/main.js:25,42` |
 * | 相对路径补 `/admin-api` 前缀，三个前缀透传 | `app/portal/utils/http/platform.js:19-27` |
 * | GET 会带 `_t` 时间戳，inline query 先合并再被 params 覆盖 | 同上 33-60 行 |
 *
 * 最后两条在 SDK 侧已有一模一样的复刻（`src/http/client.ts`），
 * 所以这里产出的是**补前缀之前的原始 URL**，前缀交给 client 处理。
 *
 * ---- http 实例：本脚本不再自己推导 ----
 *
 * 「这一页的列表请求走哪个 axios 实例」由 `src/context/http-instance.ts` 的
 * `resolveHttpInstance()` 回答，本脚本**只消费**它的结论（载入方式见
 * `http-instance-resolver.mjs`）。原因很简单：实例有 18 个，差异不只是 baseURL——
 * 还有补不补 `/admin-api`、每页条数叫 `pageSize` 还是 `limit`；而这些页面的声明形式有六种，
 * 最刁的一种是「`useListPageModule` 本身从 preset import」，调用点上一个字都看不到 `http`。
 * 早先本脚本用一串正则自己判，实测在 255 页里有 4 页判错（都判成了"走全局默认 platform.js"，
 * 实际是 `sale.js`），而判错的后果不是少一个头，是**静默打到另一个后端**。
 *
 * 本脚本保留的正则只有两处**反向核对**（发现冲突就报，不自己改判）：
 * 调用点上字面写了 `http` 时，看它能不能推出与推导器不同的实例；`useListPageModule`
 * 来自 `presets/<x>/list.js` 时，去读出 preset 里写死的那个实例（product preset 就是这一类）。
 *
 * ---- 范围：只做 Portal 主后端 ----
 *
 * 决策 D3 把本项目范围钉在 Portal 主后端，也就是 `platform` 这一个实例。
 * 因此每个页面除了裁决（auto / partial / failed）还带一个**正交的** `scope`：
 * 走 `platform` 是 `in-scope`，走别的实例是 `out-of-scope`。
 * 范围外的页面**照旧产出契约**（浏览器实测核对与审计要靠它，`batch-report.json` 里也留着），
 * 但会带一条 `范围外：` 的显式 issue；`BATCH_SDK_CAPABILITIES` 与
 * `createBatchListCapability()` 都会拒绝它——**静默产出一个打到错 URL 的能力定义，
 * 比产不出更危险**。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { loadHttpInstanceResolver } from './http-instance-resolver.mjs'

// 实例推导器（`src/context/http-instance.ts`）是**唯一**决定"这页打哪个后端"的地方。
// 顶层 await 载入一次：`extractListEndpoint()` 是同步函数，不能在里面 await。
// 载不出来就直接抛（见 http-instance-resolver.mjs 的失败关闭口径）——
// 宁可这个脚本跑不起来，也不要拿"全局默认"去顶一个可能是 sale.js 的页面。
const {
  resolveHttpInstance,
  applyUrlRewrite,
  DEFAULT_HTTP_INSTANCE_ID,
  HTTP_INSTANCES,
} = await loadHttpInstanceResolver()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '../..')
// 默认写进 src/capabilities/generated；测试用 BATCH_OUT_DIR 指到临时目录，
// 这样"重跑两次结果一致"可以在不碰 src/ 的前提下验。
const OUT_DIR = process.env.BATCH_OUT_DIR
  ? path.resolve(process.env.BATCH_OUT_DIR)
  : path.join(PKG_ROOT, 'src/capabilities/generated')

const DEFAULT_PORTAL_REPO = '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
const CLI_REPO = process.argv.slice(2).find((a) => !a.startsWith('--'))
const PORTAL_REPO = path.resolve(CLI_REPO || process.env.PORTAL_REPO || DEFAULT_PORTAL_REPO)

const CATALOG_FILE = path.join(PKG_ROOT, 'generated/page-catalog.json')
const SCOPE_FILE = path.join(PKG_ROOT, 'generated/portal-scope.json')
const DECLARATIVE_KIND = '列表页(声明式 getDataListURL)'

// ---------------------------------------------------------------------------
// 0. 抽样：20 个页面，按「变量轴」分层挑，不是随机挑
// ---------------------------------------------------------------------------
/**
 * 抽样依据（分层抽样，不是随机）——目的是让失败样本尽早暴露，而不是估一个好看的百分比。
 *
 * 四条分层轴，每条都对应生成器里一处**可能抽错**的判断：
 *
 * | 轴 | 为什么值得单独覆盖 |
 * | --- | --- |
 * | A 接口路径形态 | 源码里有 6 种写法：绝对 `/admin-api/...`、相对 `/org/...`（要补前缀）、
 * |   | `/mall-manage-api/...` 与 `/adminmanage-api/...`（透传）、漏写前导斜杠、带 query string、模板串 |
 * | B http 实例来源 | 决定 base 域名与分页参数名；页面**自己 import 的 http 不等于列表用的 http** |
 * | C form 形态 | 字面量 / 缺省 / `computed(() => ({...}))` / `undefined` 值 / 日期区间 `[]` |
 * | D 隐藏钩子 | `convertFetchForm`（改写真实请求参数）、`fieldNamePageSize` 覆盖、`getDataListIsPage` 缺省或 false |
 *
 * 覆盖 10 个业务域：meeting-room / platform / org / attendance / assignment / sale /
 * course / manage / finance / flow（20 页里 19 页进入了生成物，1 页被判 failed）。
 */
const SAMPLES = [
  { pagePath: '/dashboard/meeting-room/list', stratum: 'A:绝对 /admin-api + 已有浏览器基准（锚点）' },
  { pagePath: '/dashboard/platform/intelligence/prompt/intent/list', stratum: 'A:绝对 /admin-api（平台域，最容易的一类）' },
  { pagePath: '/dashboard/platform/intelligence/prompt/type/list', stratum: 'A:绝对 /admin-api（平台域）' },
  { pagePath: '/dashboard/org/org-propType/list', stratum: 'A:绝对 /admin-api（最"容易"的一类，136 个 auto 的代表）' },
  { pagePath: '/dashboard/attendance/attendance-sheet/list', stratum: 'A:相对 /org/... 需补 /admin-api 前缀' },
  { pagePath: '/dashboard/assignment/assignment/list', stratum: 'A:相对 + D:convertFetchForm + C:日期区间' },
  { pagePath: '/dashboard/platform/activity/monitor/list', stratum: 'A:/mall-manage-api 透传 + C:null 值 + C:运行时三元表达式' },
  { pagePath: '/dashboard/platform/category/classify/sort/list', stratum: 'A:/mall-manage-api 透传 + D:getDataListIsPage 缺省（不分页）' },
  { pagePath: '/dashboard/platform/goods/distribution/list', stratum: 'A:/mall-manage-api + C:computed() 包裹的 form' },
  { pagePath: '/dashboard/sale/customer-service/after-sale/list', stratum: 'A:/admin/... 需补前缀（店务路径）' },
  { pagePath: '/dashboard/sale/goods/classification/list', stratum: 'B:文件 import sale.js（base 不同） + D:getDataListIsPage 缺省' },
  { pagePath: '/dashboard/sale/goods/distribution/list', stratum: 'A:漏写前导斜杠的 admin/...' },
  { pagePath: '/dashboard/sale/trade/logistics-company/list', stratum: 'D:getDataListIsPage: false' },
  { pagePath: '/dashboard/platform/setting/category-dict/list', stratum: 'A:模板串（常量）+ D:getDataListIsPage 缺省' },
  { pagePath: '/dashboard/sale/shop/apply-cat/list', stratum: 'A:模板串（运行时变量 shopInfo.shopId）——预期抽不出' },
  { pagePath: '/dashboard/course/text-course/list', stratum: 'A:URL 自带 query string + D:convertFetchForm' },
  { pagePath: '/dashboard/platform/report/sale/trade/list', stratum: 'A:/mall-manage-api + C:computed() + D:getDataListIsPage 缺省' },
  { pagePath: '/dashboard/manage/insurance/list', stratum: 'C:computed() 包裹的 form' },
  { pagePath: '/dashboard/finance/setting/cat-map/list', stratum: 'D:getDataListIsPage: false + A:绝对 /admin-api' },
  { pagePath: '/dashboard/flow/old/model/list', stratum: 'D:fieldNamePageSize 单页覆盖成 limit（真的改掉了参数名）' },
]

// ---------------------------------------------------------------------------
// 0.5 浏览器实测记录：生成器自证"路径与参数是对的"的唯一凭据
// ---------------------------------------------------------------------------
/**
 * 2026-09-20 用 `bsk` 在测试环境（webtest01.wodecorp.cn / biz-api-test.wodecorp.cn）
 * 打开这几页、注入 `tools/baseline/install-hook.js`、点一次「查询」，抓下来的**真实请求 URL**。
 *
 * 为什么必须放进生成物：静态推导"看起来对"没有意义（设计 H38 说的就是这个）——
 * 只有和浏览器发出的那条逐字段比过，能力定义才敢接。这份表同时也是回归锚点：
 * Portal 发版后重跑生成器，对不上就会在这里显形。
 *
 * 只读、只抓、不写：没有执行任何写操作，token 由钩子在页面内脱敏，`bsk session stop` 已执行。
 * `_t` 是 platform.js 的防缓存时间戳，与契约无关，比对时剔除。
 */
const BROWSER_VERIFIED = [
  {
    pagePath: '/dashboard/meeting-room/list',
    url: 'https://biz-api-test.wodecorp.cn/admin-api/hr/meeting-room/page?order=&orderField=&name=&pageNo=1&pageSize=20',
    note: '仓库已有基准 baseline/meeting-room-page.browser.json',
  },
  {
    pagePath: '/dashboard/org/org-propType/list',
    url: 'https://biz-api-test.wodecorp.cn/admin-api/hr/org/organizationProperty/page?order=&orderField=&name=&pageNo=1&pageSize=20',
    note: '绝对 /admin-api 那一类（auto 里最多的形态）',
  },
  {
    pagePath: '/dashboard/attendance/attendance-sheet/list',
    url: 'https://biz-api-test.wodecorp.cn/admin-api/org/hrAttendanceSheet/page?order=&orderField=&pageNo=1&pageSize=20',
    note: '相对路径补 /admin-api 前缀',
  },
  {
    pagePath: '/dashboard/platform/activity/monitor/list',
    url: 'https://biz-api-test.wodecorp.cn/mall-manage-api/sys/coupon/page?orderField=&pageNo=1&pageSize=20',
    note: '/mall-manage-api 前缀透传；form 里的 null 被 qs 丢掉',
  },
  {
    pagePath: '/dashboard/platform/setting/category-dict/list',
    url: 'https://biz-api-test.wodecorp.cn/adminmanage-api/system/category-dict/tree?order=&orderField=&name=&code=',
    note: '模板串 URL 解出常量；getDataListIsPage 缺省 → 不带分页参数',
  },
  {
    pagePath: '/dashboard/flow/old/model/list',
    url: 'https://biz-api-test.wodecorp.cn/admin-api/bpm/hr/model/page?order=&orderField=&key=&name=&category=&pageNo=1&limit=20',
    note: '单页把 fieldNamePageSize 覆写成 limit',
  },
  {
    pagePath: '/dashboard/sale/customer-service/after-sale/list',
    url: 'https://biz-api-test.wodecorp.cn/admin-shop-api/admin/aftersales/page?order=&orderField=&itemTitle=&tid=&handledFlag=0&pageNo=1&limit=20',
    note: '显式传 sale.js：另一个 base、不补 /admin-api、分页名 limit —— 静态推导最容易错的一页',
  },
]

/** 测试环境各 baseURL 的取值，来自 Portal 的 `build/env/.env.build.test` */
const TEST_ENV_BASE_URL = {
  VITE_ZHDJ_PLATFORM_API: 'https://biz-api-test.wodecorp.cn',
  VITE_SHOP_ADMIN_API: 'https://biz-api-test.wodecorp.cn/admin-shop-api',
  VITE_MALL_ADMIN_API: 'https://biz-api-test.wodecorp.cn/mall-manage-api',
}

/** 用生成出来的契约还原浏览器那条 URL（不含 `_t`），失败时返回 null */
function reproduceBrowserUrl (endpoint) {
  const base = TEST_ENV_BASE_URL[endpoint.baseUrlEnv]
  if (!base) return null
  const pairs = []
  for (const item of [...endpoint.staticQuery, ...endpoint.query]) {
    const v = item.defaultValue
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    pairs.push(`${item.name}=${Array.isArray(v) ? v.join(',') : v}`)
  }
  return `${base}${endpoint.resolvedPath}${pairs.length ? '?' + pairs.join('&') : ''}`
}

// ---------------------------------------------------------------------------
// 1. 源码词法工具（不引依赖，字符串/注释/模板串安全）
// ---------------------------------------------------------------------------

/** 跳过一个字符串字面量（'...' / "..." / `...`），返回结束引号的下标 */
function skipString (src, i) {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === quote) return j
    if (quote === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 1
      j += 2
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      continue
    }
    j++
  }
  return j
}

function skipComment (src, i) {
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i)
    return nl === -1 ? src.length : nl
  }
  if (src[i + 1] === '*') {
    const end = src.indexOf('*/', i)
    return end === -1 ? src.length : end + 2
  }
  return i
}

/** 从 src[start]（应为 '('）找到配对 ')' 的下标，字符串与注释安全 */
function matchPair (src, start) {
  let depth = 0
  for (let j = start; j < src.length; j++) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); continue }
    if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) { j = skipComment(src, j) - 1; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return j }
  }
  return -1
}

/** 把 `{...}` 或 `[...]` 里的顶层元素按逗号切开，返回 { parts, end } */
function splitTopLevel (src, open) {
  let depth = 0
  let start = open + 1
  const parts = []
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); continue }
    if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) { j = skipComment(src, j) - 1; continue }
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') {
      depth--
      if (depth === 0) { parts.push(src.slice(start, j)); return { parts, end: j } }
    } else if (c === ',' && depth === 1) {
      parts.push(src.slice(start, j))
      start = j + 1
    }
  }
  return { parts, end: -1 }
}

/** 解析 `{ key: <raw>, ... }`，只取顶层 key，值保留原文 */
function parseObjectLiteral (raw) {
  const text = raw.trim()
  if (!text.startsWith('{')) return null
  const { parts, end } = splitTopLevel(text, 0)
  if (end === -1) return null
  const out = []
  for (const part of parts) {
    const cleaned = part.replace(/^\s*\/\/.*$/gm, '').trim()
    if (!cleaned || cleaned.startsWith('...')) continue
    const m = cleaned.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/)
    if (!m) continue
    out.push({ key: m[1], raw: m[2].trim() })
  }
  return out
}

// ---------------------------------------------------------------------------
// 2. 从一页源码里抽「列表请求契约」
// ---------------------------------------------------------------------------

/** 全局每页条数参数名。config.js 默认 'limit'，但 main.js 覆写成了 'pageSize'。 */
const GLOBAL_PAGE_SIZE_PARAM = 'pageSize'
const GLOBAL_PAGE_NO_PARAM = 'pageNo'
/**
 * 本项目范围的实例（决策 D3：只做 Portal 主后端）。
 * 它的取值也必须与 `src/context/http-instance.ts` 的 `DEFAULT_HTTP_INSTANCE_ID` 一致——
 * 下面启动时会核一次，不一致就直接抛，免得范围判定悄悄跟着变。
 */
const IN_SCOPE_INSTANCE_ID = 'platform'
const DEFAULT_BASE_URL_ENV = 'VITE_ZHDJ_PLATFORM_API'

/**
 * 实例画像里的 `source` 形如 `app/portal/utils/http/sale.js:8-12`，取文件名。
 *
 * 「一个实例」的单位是**导出的绑定**而不是文件（`zhdj-cms.js` 一个文件出 `http` 与
 * `httpLay` 两个实例），所以实例 id 与文件名是两个维度：`httpInstance` 是 id，
 * `httpModule` 是它来自哪个文件。两者都留着，改名会让既有的浏览器实测锚点对不上。
 */
function httpModuleFileOf (profile) {
  return (profile.source.match(/app\/portal\/utils\/http\/([\w-]+)\.js/) ?? [null, profile.id])[1] + '.js'
}

if (DEFAULT_HTTP_INSTANCE_ID !== IN_SCOPE_INSTANCE_ID) {
  throw new Error(
    `[batch-capabilities] 全局默认实例变成了 ${DEFAULT_HTTP_INSTANCE_ID}，` +
    `而本脚本按 ${IN_SCOPE_INSTANCE_ID} 判范围外的依据（决策 D3）还停在旧值上。` +
    '先确认范围决策，再改这里——不要在没确认的情况下跟着动。',
  )
}

/** 找 `useListPageModule({...})` 的参数体；找不到返回 null */
function findListModuleOptions (src) {
  const callIndex = src.indexOf('useListPageModule(')
  if (callIndex === -1) return null
  const open = src.indexOf('(', callIndex)
  const close = matchPair(src, open)
  if (close === -1) return null
  const body = src.slice(open + 1, close).trim()
  const brace = body.indexOf('{')
  if (brace !== 0) return null
  const { parts, end } = splitTopLevel(body, 0)
  if (end === -1) return null
  const props = new Map()
  for (const part of parts) {
    const cleaned = part.replace(/^\s*\/\/.*$/gm, '').trim()
    const m = cleaned.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/)
    if (m) { props.set(m[1], m[2].trim()); continue }
    // 简写属性：`useListPageModule({ http, ... })` 的 http 是个简写，
    // 早期版本只认 `http:`，因此把 34 个真正传了 http 的页面全漏成了"走全局默认"。
    const shorthand = cleaned.match(/^([A-Za-z_$][\w$]*)$/)
    if (shorthand) props.set(shorthand[1], shorthand[1])
  }
  return props
}

/**
 * 把 `import { http } from '.../http/X.js'`（含 `as` 别名、省略 `.js` 后缀）解析成 X.js。
 *
 * **这不是实例推导**，别把它当判据用：它只认调用点上字面写的那个名字，看不到 preset 包装，
 * 也追不了跨文件转发。它的唯一用途是给推导器的结论做一次**反向核对**——
 * 两边都指向同一个实例时才算"调用点与页面规则表一致"，不一致就报冲突。
 */
function resolveHttpImport (src, expr) {
  const name = expr.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*utils\/http\/([\w-]+?)(?:\.js)?)'/g)) {
    for (const spec of m[1].split(',')) {
      const alias = spec.match(/^\s*(\w+)\s+as\s+(\w+)\s*$/)
      const local = alias ? alias[2] : spec.trim()
      if (local === name) return `${m[3]}.js`
    }
  }
  return null
}

/**
 * `useListPageModule` 来自 `presets/<x>/list.js` 时，把 preset 里写死的那个实例读出来。
 *
 * `common/libs/renren/presets/{product,platform}/list.js` 的写法是
 * `_useListPageModule({ ...params, fieldNamePageSize: 'pageSize', http })`，
 * 而 `http` 来自文件顶部 `import { http } from 'app/portal/utils/http/<x>.js'`。
 * 返回的是**文件名**（`sale.js` 这种），与 `resolveHttpImport` 的口径一致。
 *
 * 为什么必须单独处理：这类页面的调用点上**一个字都看不到 http**，而页面规则表按
 * `pagePath` 建索引、只收"页面形态"的路径（弹窗/子组件/`[id]` 路径明确不收），
 * 于是 `resolveHttpInstance({ pagePath })` 对它们会给出"全局默认"这个**看起来对**的答案。
 * 目前 255 个声明式列表页里一处都没有踩到（那 12 处 preset 声明全在非页面形态的路径上），
 * 但机制要留着：Portal 把某个 preset 页面挪到真实菜单上，这里就是唯一会响的地方。
 */
function resolvePresetInstance (portalRepo, src) {
  const found = []
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*libs\/renren\/presets\/([\w-]+)\/(list)\.js'/g)) {
    const presetName = m[2]
    const usedAsList = m[1].split(',').some((spec) => {
      const alias = spec.match(/^\s*(\w+)\s+as\s+(\w+)\s*$/)
      return (alias ? alias[2] : spec.trim()) === 'useListPageModule'
    })
    if (!usedAsList) continue
    const presetFile = path.join(portalRepo, 'common/libs/renren/presets', presetName, 'list.js')
    if (!fs.existsSync(presetFile)) {
      found.push({ preset: presetName, module: null, source: presetFile })
      continue
    }
    const presetSrc = fs.readFileSync(presetFile, 'utf8')
    const httpImport = presetSrc.match(/utils\/http\/([\w-]+?)(?:\.js)?'/)
    found.push({
      preset: presetName,
      module: httpImport ? `${httpImport[1]}.js` : null,
      source: `common/libs/renren/presets/${presetName}/list.js`,
    })
  }
  return found
}

/** 把模板串里的 `${X}` 用文件内的 `const X = '字面量'` 解掉；解不掉的返回 null */
function resolveTemplateLiteral (src, expr) {
  const inner = expr.slice(1, -1)
  let failed = null
  const resolved = inner.replace(/\$\{([^}]*)\}/g, (_all, name) => {
    const ident = name.trim()
    const decl = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${ident}\\s*=\\s*'([^']*)'`).exec(src)
    if (decl) return decl[1]
    failed = ident
    return ''
  })
  return failed ? { error: failed } : { value: resolved }
}

/** 解析一个字面量表达式：返回 { kind, value } */
function parseDefaultValue (raw) {
  const t = raw.trim()
  if (/^'([^']*)'$/.test(t)) return { kind: 'string', value: t.slice(1, -1) }
  if (/^"([^"]*)"$/.test(t)) return { kind: 'string', value: t.slice(1, -1) }
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'number', value: Number(t) }
  if (t === 'true' || t === 'false') return { kind: 'boolean', value: t === 'true' }
  if (t === 'null') return { kind: 'null', value: null }
  if (t === 'undefined') return { kind: 'undefined', value: null }
  if (t === '[]') return { kind: 'date-range', value: [] }
  if (t === '{}') return { kind: 'object', value: {} }
  return { kind: 'expression', value: null }
}

/**
 * 由默认值 + 参数名推断 ParamKind（保守：推不出就当 text）。
 *
 * **这只是回退判据**：默认值的类型说明不了它渲染成什么控件。真正的判据是
 * `deriveParamKind()`（下面那一节）——它从模板里读出承载绑定的控件标签。
 * 只有「连控件都判不出是什么」时才会走到这里。
 */
function inferParamKind (name, defaultValue) {
  if (defaultValue.kind === 'date-range') return 'date'
  if (defaultValue.kind === 'number') return 'number'
  if (defaultValue.kind === 'boolean') return 'boolean'
  return 'text'
}

/** 默认值的人话描述，写进 ParamSpec.description 给 AI 看 */
function describeDefault (name, defaultValue, judged) {
  const base = (() => {
    switch (defaultValue.kind) {
      case 'string': return defaultValue.value === '' ? `${name}，默认空` : `${name}，默认 ${defaultValue.value}`
      case 'number': return `${name}，默认 ${defaultValue.value}`
      case 'boolean': return `${name}，默认 ${defaultValue.value}`
      case 'null': return `${name}，默认不传（表单初值为 null）`
      case 'undefined': return `${name}，默认不传（表单初值为 undefined）`
      case 'date-range': return `${name}，日期区间（表单初值为空数组）`
      case 'object': return `${name}，对象参数`
      default: return `${name}，初值由页面运行时表达式算出，需人工确认`
    }
  })()
  // 控件判出来了就在描述里点一句：AI 拿到的是 kind + 描述，光有 kind 不够
  // （`kind=text` 与「页面上是个下拉」是两件事，后者才是决定传什么值的那一条）。
  // 自由文本不加这一句：`text` 的消费方式本来就写着「模糊匹配」，说两遍是噪音。
  const hint = judged?.hint ?? null
  return hint ? `${base}；${hint}` : base
}

// ---------------------------------------------------------------------------
// 2.4 控件判据：从模板判「这个参数在页面上是什么控件」，再由控件定 ParamKind
// ---------------------------------------------------------------------------
/**
 * 为什么必须有这一层（2026-09-20 抽样装置的实测结论）
 * ---------------------------------------------------
 * 上一版 `inferParamKind(name, defaultValue)` 只看**初值的类型**。抽 24 页逐字段比对的结果：
 * **形状 24/24 全对**（路径、参数集合、顺序、初值一个没错），但 **68 个参数里 28 个的 kind
 * 与页面控件不符，另有 12 个页面上根本没有控件**。错法集中在选择型与日期：
 * `select` 22 个 / `radio-group` 2 个被写成 `text`，`picker` 3 个被写成 `text` 或 `null`。
 * 后果不是"少一个字段"，是 AI 拿到 `text` 就会把用户说的"博创"直接当模糊词发出去，
 * 而这些参数实际是 ID 型的下拉（传名字**不报错、静默错数据**）。
 *
 * 控件类型**在源码里**：模板里写的是 `a-input` 还是 `a-select`、是不是
 * `portal-hxr-select-user-department`，静态可读。抽样装置已在 DOM 侧分出
 * `text/select/picker/radio-group/input-number` 五类，本层的家族划分与它对齐
 * （`tools/sample/verdicts.json` 的「参数级统计·按控件类型」就是回归的期望值）。
 *
 * 判不出的部分**如实标注**（`unresolved`），不猜：
 * - **候选规模在源码里根本不存在**（实测：班组 922 条、供应商 494 条），而它决定
 *   这个参数该是 `enum` 还是 `search`/`tree`（D6「长选项必须先要关键字」）。
 *   下拉一律按**失败关闭**取 `search` 这个保守值——多问一句用户，好过静默查错数据
 *   （本项目对"算不出"的既有口径见约定 26）。它**不是实测结论**，是产品规则的默认值。
 * - 承载绑定的标签不是输入控件（`span` / `component-progress` / 查询控制器按钮…）时
 *   不硬套家族，退回初值判据并标出来。
 *
 * ⚠️ **判「有没有控件」只能数绑定，不能数 `formState.<name>` 的出现次数**——
 * 赋值与条件判断也是它，按次数数会把切 tab 时程序写进去的**页面状态**
 * （image-list 的 `targetType`/`disabled`）误判成"控件在页面上"。这条判据与抽样装置
 * （`tools/sample/analyze.mjs` 的 `CONTROL_BINDING`）**同一份写法**，两边必须继续一致。
 */

/** 模板里的标签：`<tag ...>`。属性值里的 `>` 不算标签结束 */
function listTemplateTags (src) {
  // `<script>` 段整段排除：那里 `a < b` 这类写法会被误判成标签
  const scriptRanges = [...src.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)]
    .map((m) => [m.index, m.index + m[0].length])
  const inScript = (i) => scriptRanges.some(([from, to]) => i >= from && i < to)
  const tags = []
  for (const m of src.matchAll(/<([a-zA-Z][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    if (inScript(m.index)) continue
    tags.push({ tag: m[1], attrs: m[2] })
  }
  return tags
}

/**
 * 承载 `formState.<name>` 的那个绑定属性名（`v-model:value` / `:options` …），没有则 null。
 *
 * 只认 `v-model` / `v-model:xxx` / `:xxx` 三种**绑定**形式，写法与抽样装置的
 * `CONTROL_BINDING` 一致。`v-if="…formState.x === '0'"` 不算：那是读页面状态，
 * 不是控件。
 */
function controlBindingOf (attrs, name) {
  const m = attrs.match(
    new RegExp(`(v-model(?::[\\w-]+)?|:[\\w-]+)\\s*=\\s*"[^"]*formState\\.${name}\\b`),
  )
  return m ? m[1] : null
}

/**
 * 控件家族：只判到「它让调用方传什么形状的值」这一层，不追求还原 antd 组件名。
 * **顺序有意义**（`a-input-number` 必须先于 `a-input`，`-range-picker` 先于 `-picker`）。
 */
const CONTROL_FAMILIES = [
  { family: 'number', test: (t) => /(^|-)input-number$/.test(t) },
  { family: 'date-range', test: (t) => /-range-picker$/.test(t) },
  { family: 'date', test: (t) => /-picker$/.test(t) },
  // 树形：控件本身就是按层级取候选的（D6 的 tree 那一类）
  { family: 'tree', test: (t) => /^a-(cascader|tree-select)$/.test(t) || /tree-select/.test(t) || /cascader/.test(t) },
  // 一次把全部选项画在页面上的小集合
  { family: 'inline-options', test: (t) => /^a-(radio-group|checkbox-group|segmented|switch)$/.test(t) || /select-radio$/.test(t) },
  // 单个勾选框/开关：值形状要看页面自己怎么转（实测有 `Number(e.target.checked)`），
  // 所以**刻意不给它 FAMILY_KIND**，落进"判不出值形状"那一支。
  { family: 'toggle', test: (t) => /^a-(checkbox|switch)$/.test(t) },
  // 页签 / 统计条：视图切换，不是筛选输入（`platform` / `sortType` / `status` 这些）
  { family: 'view-switcher', test: (t) => /^a-tabs$/.test(t) || /table-statistic$/.test(t) },
  { family: 'text', test: (t) => /^a-input(-[\w-]+)?$/.test(t) || /^a-textarea$/.test(t) },
  // 下拉类：候选由运行时请求给，源码里没有。
  // **大小写不敏感**：Portal 里两种写法都有（`portal-hxr-select-*` 与 `PortalFinanceSelectAccounting`），
  // 只认小写会把后面那种整类漏掉。
  { family: 'lazy-options', test: (t) => /select|dropdown/i.test(t) },
]

/** 控件标签上的事件处理器里写了 `formState.<name>`（`@change="e => formState.x = …"`） */
function controlWriteTag (tags, name) {
  const re = new RegExp(`(?:@|v-on:)[\\w:.-]+\\s*=\\s*"[^"]*formState\\.${name}\\b`)
  return tags.find((t) => re.test(t.attrs)) ?? null
}

/** 标签 → 控件家族（不匹配任何一条就返回 null：**不硬套**） */
function familyOf (tag) {
  const rule = CONTROL_FAMILIES.find((r) => r.test(tag))
  return rule ? rule.family : null
}

/**
 * 日期控件的**值格式**——就在控件标签上（`value-format="YYYY-MM"`），必须一起读出来。
 *
 * 为什么不能只说"这是日期"：KIND_CONSUMPTION 那句写得很清楚——Portal 里
 * `yyyy-MM-dd` 与 `YYYY-MM-DD HH:mm:ss` 两种都有，**不要猜**。实测这三页分别是
 * `YYYY-MM`（月份）/ `YYYY`（年度），传一个完整日期进去不会报错，只会查不到东西。
 */
function valueFormatOf (attrs) {
  const m = attrs.match(/value-format\s*=\s*"([^"]*)"/)
  return m ? m[1] : null
}

const CONTROL_HINTS = {
  number: '页面上是数字输入',
  date: '页面上是日期控件',
  'date-range': '页面上是日期区间控件',
  tree: '页面上是树形选择',
  'inline-options': '页面上是单选/多选组',
  'view-switcher': '页面上是页签切换（切它会换一批数据）',
  'lazy-options': '页面上是下拉选择',
}

/** 写进 ParamSpec.description 的控件提示（自由文本不加：`text` 的消费方式本来就说清了） */
function controlHint (family, valueFormat) {
  const base = CONTROL_HINTS[family]
  if (!base) return null
  if ((family === 'date' || family === 'date-range') && valueFormat) return `${base}（值格式 ${valueFormat}）`
  return base
}

/**
 * 家族 → ParamKind。`unresolved` 非空表示**这一类还没判完**，人补清单里会出现它。
 *
 * `view-switcher` 给 `enum`：页签把全部选项一次画出来，值域是页面自己的视图集合。
 * 但**页签键没有从源码里提取**（可能是 `v-for` 生成的），所以照样标出来。
 */
const FAMILY_KIND = {
  number: { kind: 'number' },
  date: { kind: 'date' },
  'date-range': {
    kind: 'date',
    short: '日期区间控件的两个值，ParamKind 表达不了',
    unresolved: '页面上是日期区间控件（一个控件对应两个值），ParamKind 只有 `date` 这一个值，表达不了区间——SDK 侧的类型缺口，接线前要定口径',
  },
  tree: { kind: 'tree' },
  'inline-options': {
    kind: 'enum',
    short: '枚举值未提取',
    unresolved: '枚举值没从源码里提取（`:options` 指向脚本变量），接线前要么补 options、要么确认按 description 填',
  },
  'view-switcher': {
    kind: 'enum',
    short: '页签键未提取',
    unresolved: '页签/统计条的键没从源码里提取，接线前要确认它是不是小集合',
  },
  'lazy-options': {
    kind: 'search',
    short: '下拉的候选规模未测',
    unresolved: '页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），' +
      '`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与"算不出就失败关闭"的既有口径取保守值 `search`（先向用户要关键字）',
  },
  text: { kind: 'text' },
}

/**
 * 判一个参数：它是不是这一页的筛选条件、在页面上是什么控件、kind 该取什么。
 *
 * 返回：
 * - `role`：`page-definition` = 源码里**没有任何控件绑定**到它，它是"这一页是哪一页"的定义
 *   （只出现在 form 初值里，或只被 `v-if`/赋值用到），**不是筛选条件** → 调用方必须把它
 *   从能力参数里剔掉（实测后果：`isArchived=0` 与"不传"完全等价，拨一下不报错、不提示，
 *   静默换一批数据——同接口实测 105 条 vs 118 条）；
 * - `basis`：kind 是从控件判出来的（`control`）还是退回初值判据（`default-value`）；
 * - `unresolved`：这一条还缺什么才能接线（null = 判定了）；
 * - `conditional`：控件在、但所在表单项带 `v-if`（按账号/条件渲染，实测 tenantName 只对 admin 显示）。
 */
function deriveParamKind (tags, name, defaultValue) {
  // 表单项带 v-if：控件在，但当前账号下可能没渲染（实测 tenantName 只对 admin 显示）
  const formItem = tags.find((t) => t.tag === 'a-form-item' && new RegExp(`name\\s*=\\s*"${name}"`).test(t.attrs))
  const conditional = Boolean(formItem && /\bv-if\s*=/.test(formItem.attrs))
  const fallback = inferParamKind(name, defaultValue)

  const bound = tags
    .map((t) => ({ ...t, binding: controlBindingOf(t.attrs, name) }))
    .filter((t) => t.binding !== null)

  if (bound.length === 0) {
    // 「没有 v-model 绑定」**不等于**「页面上没有控件」——实证两种漏网形态：
    // - `<a-checkbox @change="e => rrList.formState.isContent = Number(e.target.checked)">`
    //   （控件只走事件处理器，不写 `v-model`；实测 4 个参数是这样，如 sale 的评价页）
    // - `<a-form-item name="catId">` 里绑的是**脚本变量** `v-model:value="catId"`，
    //   再由 `convertFetchForm` 换算进 form（实测 goods/distribution）
    // 这两种都是用户真能拨的筛选条件，剔掉等于把能力砍没了，所以判据要两条都看。
    const writer = controlWriteTag(tags, name)
    if (!writer && !formItem) {
      return {
        role: 'page-definition',
        kind: fallback,
        basis: 'default-value',
        family: null,
        controlTag: null,
        valueFormat: null,
        hint: null,
        unresolved:
          '它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，' +
          '而且没有对应的 `<a-form-item>`。',
        unresolvedShort: '页面定义',
        conditional: false,
        bindingCount: 0,
      }
    }
    const family = writer ? familyOf(writer.tag) : null
    const spec = family ? FAMILY_KIND[family] : null
    return {
      role: 'filter',
      kind: spec ? spec.kind : fallback,
      basis: spec ? 'control' : 'default-value',
      family,
      controlTag: writer ? writer.tag : null,
      valueFormat: null,
      hint: spec ? controlHint(family, null) : null,
      unresolved: spec
        ? spec.unresolved ?? null
        : (writer
          ? `页面上承载它的是 <${writer.tag}>（只走事件处理器，没有 \`v-model\` 绑定），判不出该传什么形状的值——先按初值当 ${fallback}，接线前须人工确认`
          : `页面上有 <a-form-item name="${name}">，但里面的控件不是绑到 \`formState.${name}\` 上的（实测有绑脚本变量再由 convertFetchForm 换算的写法），值形状与默认值都须人工确认`),
      unresolvedShort: spec ? spec.short ?? null : (writer ? `控件 <${writer.tag}> 判不出值形状` : '控件绑在脚本变量上'),
      conditional,
      bindingCount: 0,
    }
  }

  // 有绑定：取第一个**输入控件**承载的那个（`:class="…formState.status === 5"` 这种
  // 装饰性绑定也会命中 `:xxx`，不能拿它当控件）。
  const control = bound.find((t) => CONTROL_FAMILIES.some((r) => r.test(t.tag))) ?? null
  const entry = control ?? bound[0]
  let family = familyOf(entry.tag)

  // 内联字面量选项（`:options="[{ label: '是', value: 0 }]"`）：选项就在源码里，
  // 这种下拉/单选必然是小枚举，不用等运行时测。`options.x` 这种指向脚本变量的不算。
  if (family === 'lazy-options' && /:options\s*=\s*"\s*\[/.test(entry.attrs)) family = 'inline-options'
  // 多选：控件一次能传多个值（`multiple` / `mode="multiple"` / `:max-tag-count`），
  // ParamKind 表达不了"这是一个数组"。**不猜**，落进"判不出值形状"那一支标出来。
  const multiple = /(^|\s)multiple(\s|\/|$)/.test(entry.attrs) ||
    /mode\s*=\s*"multiple"/.test(entry.attrs) ||
    /:?max-tag-count/.test(entry.attrs)

  const spec = family ? FAMILY_KIND[family] : null
  // 日期控件：值格式（`value-format`）就在控件标签上，必须一起读出来——
  // 只说"这是日期"等于把"传什么格式"留给调用方猜，猜错不报错、只是查不到东西。
  const wantsFormat = family === 'date' || family === 'date-range'
  const valueFormat = wantsFormat ? valueFormatOf(entry.attrs) : null
  const formatGap = wantsFormat && !valueFormat
    ? '该控件标签上没有 `value-format`：这个日期该传什么格式（YYYY-MM / YYYY-MM-DD …）源码里没有，接线前必须实测'
    : null
  // 一条参数可能同时缺两样（例：日期区间控件既表达不了区间，标签上也没有值格式），
  // 所以是**并起来**而不是二选一——少了哪条，读的人就会以为那件事已经判过了。
  const multiGap = multiple
    ? `这个控件是**多选**（一次能传多个值），ParamKind 只有单值形态、表达不了数组——接线前要定"多值怎么传"的口径`
    : null
  const unresolved = spec
    ? [spec.unresolved, multiGap, formatGap].filter(Boolean).join('；') || null
    : `页面上承载它的是 <${entry.tag}>，判不出该传什么形状的值——先按初值当 ${fallback}，接线前须人工确认`
  // 一句话版本（逐页 issue 里用）：一条参数可能同时缺两样，两个都要出现在清单里
  const unresolvedShort = spec
    ? [
      spec.short,
      multiGap ? '多选控件，ParamKind 表达不了数组' : null,
      formatGap ? '日期格式未确认' : null,
    ].filter(Boolean).join('；') || null
    : `控件 <${entry.tag}> 判不出值形状`
  return {
    role: 'filter',
    kind: spec ? spec.kind : fallback,
    basis: spec ? 'control' : 'default-value',
    family,
    controlTag: entry.tag,
    valueFormat,
    hint: spec ? controlHint(family, valueFormat) : null,
    unresolved,
    unresolvedShort,
    conditional,
    bindingCount: bound.length,
  }
}

/** 主抽取函数：返回一份判定 + 契约，失败时 issues 里写清原因 */
export function extractListEndpoint (portalRepo, row) {
  const issues = []
  const result = {
    pagePath: row.menuPath,
    title: row.title,
    domain: row.domain,
    permission: row.permission || undefined,
    routeFile: row.routeFile,
    moduleType: row.moduleType ?? null,
    write: row.write === true,
    method: 'get',
    rawUrl: null,
    resolvedPath: null,
    baseUrlEnv: DEFAULT_BASE_URL_ENV,
    /** 实例 id（`platform` / `sale` / …）——判范围就看它 */
    httpInstance: DEFAULT_HTTP_INSTANCE_ID,
    /** 实例画像里的 file:line，复核用 */
    httpInstanceSource: null,
    /** 实例来自哪条规则：请求级声明 / 页面规则 / 全局默认 */
    httpMatchedBy: 'global-default',
    /** 实例所在的源码文件（`sale.js`）。刻意与 httpInstance 分开：一个文件可能导出两个实例 */
    httpModule: 'platform.js',
    httpSource: 'global-default',
    /** 与裁决正交：走 platform 是 in-scope，走别的实例是 out-of-scope */
    scope: 'unresolved',
    menuScope: 'unknown',
    urlShape: null,
    staticQuery: [],
    pageParam: null,
    sizeParam: null,
    pageSizeDefault: 20,
    query: [],
    params: [],
    /** 每个**能力参数**的 kind 判据（与 `params` 按名字一一对应）；判据见 §2.4 */
    paramKindEvidence: [],
    /** 判成「页面定义」而从 `params` 里剔掉的参数（`query` 里仍然有它们） */
    paramsDropped: [],
    verdict: 'failed',
    issues,
  }

  if (!row.routeFile) {
    issues.push('清单里没有 routeFile，无法定位源码')
    return result
  }
  const abs = path.join(portalRepo, row.routeFile)
  if (!fs.existsSync(abs)) {
    issues.push(`源码文件不存在：${row.routeFile}`)
    return result
  }
  const src = fs.readFileSync(abs, 'utf8')

  const props = findListModuleOptions(src)
  if (!props) {
    issues.push('源码里找不到 useListPageModule({...}) 调用')
    return result
  }

  if (props.has('customLoad')) {
    issues.push('列表走了 customLoad，不是声明式加载（清单分类可能已过期）')
    return result
  }

  // ---- 列表用的 http 实例 ----
  // 判据**全部**来自 `src/context/http-instance.ts` 的 `resolveHttpInstance()`：
  // 优先级是 请求级声明 → 页面规则 → 全局默认，页面路径先按 normalizeMenuEntryPath 归并。
  // 本脚本不再自己判实例（上一版的正则漏了 preset 包装与省略后缀的 import，
  // 实测 255 页里 4 页被误判成"走全局默认"，实际是 sale.js）。
  //
  // 实例要在解析 URL **之前**定下来：判 failed 的页面一样要能报出它在哪个范围外，
  // 否则报告是按"能抽出来的页面"统计的，范围结论会少一块。
  const resolution = resolveHttpInstance({ pagePath: result.pagePath })
  const instance = resolution.kind === 'resolved' ? resolution.instance : null
  // 生效的实例画像。preset 那一类会把它换成 preset 里写死的那个（见下面反向核对 b），
  // 后面的补前缀与分页参数名必须跟着它走，否则会拿 platform 的规则去改写别的实例的路径。
  let effectiveProfile = instance
  if (!instance) {
    issues.push(
      `范围外？：解析不出列表请求用的 http 实例（${resolution.reason}）：${resolution.detail}`,
    )
  } else {
    result.httpInstance = instance.id
    result.httpInstanceSource = instance.source
    result.httpMatchedBy = resolution.matchedBy
    result.httpModule = httpModuleFileOf(instance)
    result.httpSource = resolution.matchedBy === 'global-default' ? 'global-default' : 'explicit'
    if (instance.baseUrl.kind === 'env') result.baseUrlEnv = instance.baseUrl.env
    if (instance.id === IN_SCOPE_INSTANCE_ID) {
      result.scope = 'in-scope'
    } else {
      result.scope = 'out-of-scope'
      issues.push(
        `范围外：列表请求走 ${instance.id} 实例（${result.httpModule}，baseURL=${result.baseUrlEnv}），` +
        '不属于 SDK 的 Portal 主后端范围（决策 D3）。接到 SDK 里会打到错的 URL，所以这条定义不可接线。',
      )
    }
  }

  // 反向核对 a：调用点上字面写了 http 时，它推出来的实例与推导器是否一致。
  // 不一致说明页面规则表漏了这一页——**不改判**，把冲突报出来给人看。
  if (props.has('http')) {
    const declaredModule = resolveHttpImport(src, props.get('http'))
    if (declaredModule && declaredModule !== result.httpModule) {
      issues.push(
        `冲突：调用点声明用 ${declaredModule}，但实例推导器判的是 ${result.httpModule}` +
        `（依据 ${result.httpInstanceSource ?? '全局默认'}）。两者不可能同时对，接线前必须查清。`,
      )
    } else if (!declaredModule && result.httpMatchedBy === 'global-default') {
      // 这一条必须阻塞：页面规则表是按 pagePath 建的，而它的推导器遇到"追不动的 http 表达式"
      // 时是把这一页**丢掉**、不是记成 `instance: null`，所以"表里没有"并不等于"没声明"。
      // 猜错的后果是打到错的 URL，与"算不出就不发请求"是同一条口径。
      issues.push(
        `无法确认：调用点传了 http（${props.get('http')}），但这一页不在页面规则表里，` +
        '本脚本追不动这个表达式，按全局默认记等于在猜。接线前必须人工确认它是哪个实例。',
      )
    }
  }

  // 反向核对 b：useListPageModule 本身来自 preset —— 调用点看不到 http，
  // 实例写死在 preset 文件里（presets/product/list.js 就是 product.js，另一个后端）。
  for (const preset of resolvePresetInstance(portalRepo, src)) {
    if (!preset.module) {
      issues.push(`范围外？：列表请求来自 preset ${preset.source}，但读不出它写死的 http 实例`)
      continue
    }
    if (preset.module !== result.httpModule) {
      result.httpInstance = preset.module.replace(/\.js$/, '')
      result.httpModule = preset.module
      result.httpInstanceSource = preset.source
      result.httpMatchedBy = 'preset'
      result.httpSource = 'explicit'
      const presetProfile = HTTP_INSTANCES.find((p) => httpModuleFileOf(p) === preset.module) ?? null
      effectiveProfile = presetProfile
      if (presetProfile && presetProfile.baseUrl.kind === 'env') result.baseUrlEnv = presetProfile.baseUrl.env
      result.scope = preset.module === `${IN_SCOPE_INSTANCE_ID}.js` ? 'in-scope' : 'out-of-scope'
      issues.push(
        `范围外：列表请求来自 preset ${preset.source}，它把 http 写死成 ${preset.module}` +
        `（baseURL=${result.baseUrlEnv}），与全局默认不同。调用点看不到这个声明，` +
        '页面规则表也不收这一页，所以实例由 preset 文件本身定；接到 SDK 会打到错的 URL。',
      )
    }
  }

  // ---- URL ----
  const urlExpr = props.get('getDataListURL')
  if (!urlExpr) {
    issues.push('useListPageModule 没有 getDataListURL（清单分类可能已过期）')
    return result
  }
  if (/^'[^']*'$/.test(urlExpr)) {
    result.rawUrl = urlExpr.slice(1, -1)
    result.urlShape = result.rawUrl.startsWith('/') ? 'absolute' : 'missing-leading-slash'
    if (result.urlShape === 'missing-leading-slash') {
      issues.push(`URL 漏写前导斜杠（${result.rawUrl}）：axios 会按 baseURL 相对解析，需人工确认`)
    }
  } else if (urlExpr.startsWith('`')) {
    const tpl = resolveTemplateLiteral(src, urlExpr)
    if (tpl.error) {
      issues.push(`URL 是模板串，插值 ${tpl.error} 在源码里不是字面常量，静态解不出`)
      result.urlShape = 'template-runtime'
      return result
    }
    result.rawUrl = tpl.value
    result.urlShape = 'template-const'
    issues.push('URL 由模板串拼接，插值常量已在源码内解出，建议人工复核一次')
  } else {
    issues.push(`getDataListURL 不是字符串字面量（${urlExpr.slice(0, 40)}）`)
    result.urlShape = 'expression'
    return result
  }

  // 拆 inline query：platform.js 会先 qs.parse(url 上的 query) 再被 params 覆盖
  const qIndex = result.rawUrl.indexOf('?')
  let urlPath = result.rawUrl
  if (qIndex !== -1) {
    urlPath = result.rawUrl.slice(0, qIndex)
    const qs = result.rawUrl.slice(qIndex + 1)
    for (const pair of qs.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const k = eq === -1 ? pair : pair.slice(0, eq)
      const v = eq === -1 ? '' : pair.slice(eq + 1)
      result.staticQuery.push({ name: decodeURIComponent(k), defaultValue: decodeURIComponent(v), kind: 'string' })
    }
    issues.push(`URL 自带 query（${qs}）：这些参数不来自 form，需人工确认是否算能力参数`)
  }

  result.url = urlPath

  // 诊断：文件 import 了别的 http，但列表请求没用它。
  // 这是最容易抽错的一处，显式记一笔（**不是**阻塞项：推导器的结论才作数）。
  if (!props.has('http') && result.httpMatchedBy === 'global-default') {
    const fileImports = [...src.matchAll(/import\s*\{\s*http\s*\}\s*from\s*'[^']*utils\/http\/([\w-]+?)(?:\.js)?'/g)]
      .map((m) => `${m[1]}.js`)
    if (fileImports.length && !fileImports.includes(result.httpModule)) {
      result.fileHttpImports = fileImports
      issues.push(
        `文件 import 的是 ${fileImports.join(', ')}，但列表请求没传 http，实际走全局默认 ${result.httpModule}` +
        `（baseURL=${result.baseUrlEnv}，分页名 ${GLOBAL_PAGE_SIZE_PARAM}）`,
      )
    }
  }

  // 补前缀，得到浏览器里真正会发出的路径。
  // 改写规则**不再由本脚本复刻**，直接用实例画像里的 `urlRewrite`
  // （`applyUrlRewrite`，与 SDK 发请求时走的是同一个函数）。
  // 实测锚点：`/dashboard/sale/customer-service/after-sale/list` 走 sale.js，
  // 真实请求是 `/admin-shop-api/admin/aftersales/page`，**没有** `/admin-api` 前缀。
  const rewritten = effectiveProfile ? applyUrlRewrite(effectiveProfile.urlRewrite, urlPath) : urlPath
  // 漏写前导斜杠的相对路径：axios 会按 baseURL 相对解析，这里只做可读性归一，
  // 与浏览器不一致这件事由上面那条 `URL 漏写前导斜杠` 的 issue 负责。
  result.resolvedPath = rewritten.startsWith('/') ? rewritten : `/${rewritten.replace(/^\/+/, '')}`
  if (instance && result.scope === 'out-of-scope' && urlPath.startsWith('/')) {
    issues.push(
      `该页走 ${result.httpModule}，它没有 platform.js 的补前缀拦截器：` +
      `真实路径就是 ${urlPath}（${result.baseUrlEnv} 是另一个 base，SDK 现有单 base 客户端调不到）`,
    )
  }

  // ---- 分页 ----
  const isPageRaw = props.get('getDataListIsPage')
  const isPage = isPageRaw === undefined ? false : isPageRaw.trim() === 'true'
  const styleV2 = props.get('styleV2') !== undefined && props.get('styleV2').trim() === 'true'
  result.pageSizeDefault = styleV2 ? 20 : 10
  if (isPage) {
    result.pageParam = (props.get('fieldNamePageNo') || `'${GLOBAL_PAGE_NO_PARAM}'`).replace(/['"]/g, '').trim()
    const sizeOverride = props.get('fieldNamePageSize')
    if (sizeOverride) {
      result.sizeParam = sizeOverride.replace(/['"]/g, '').trim()
      issues.push(`该页单独覆写了 fieldNamePageSize → ${result.sizeParam}，与全局默认不同`)
    } else {
      // 分页参数名不是全局常量：实例的请求拦截器可能改名（截图见实例画像的
      // `pageSizeParamAlias`——实测只有 sale.js 干这件事，app/portal/utils/http/sale.js:38-41）
      const alias = effectiveProfile ? effectiveProfile.pageSizeParamAlias : null
      result.sizeParam = alias || GLOBAL_PAGE_SIZE_PARAM
      if (alias) {
        issues.push(
          `${result.httpInstance} 实例的拦截器把 pageSize 改名成 ${alias}，` +
          `所以这一页的真实分页参数是 ${alias}，不是全局的 ${GLOBAL_PAGE_SIZE_PARAM}`,
        )
      }
    }
    if (isPageRaw === undefined) {
      issues.push('getDataListIsPage 缺省（=false），但清单把它当列表页：不传分页参数')
    }
  } else if (isPageRaw === undefined) {
    issues.push('getDataListIsPage 缺省（=false）：该接口不传分页参数')
  } else {
    issues.push('getDataListIsPage: false：该接口不传分页参数')
  }

  // ---- form ----
  const formRaw = props.get('form')
  let formFields = []
  if (formRaw === undefined) {
    issues.push('没有 form：查询参数只有 order/orderField（复用现有模块，不新增依赖）')
  } else if (formRaw.startsWith('{')) {
    formFields = parseObjectLiteral(formRaw) || []
  } else {
    const computed = formRaw.match(/^computed\s*\(\s*\(\s*\)\s*=>\s*\(\s*(\{[\s\S]*\})\s*\)\s*\)$/)
    if (computed) {
      formFields = parseObjectLiteral(computed[1]) || []
      issues.push('form 由 computed() 包裹：已在源码内解出，等价于字面量对象，建议人工复核')
    } else {
      issues.push(`form 不是静态对象（${formRaw.replace(/\s+/g, ' ').slice(0, 50)}…），字段抽不出`)
    }
  }

  // ---- 隐藏钩子 ----
  if (/convertFetchForm\s*\(/.test(src)) {
    issues.push(
      '该页调用 convertFetchForm 改写请求参数：真实 query 与 form 字段**不一致**，' +
      '必须人读那段函数才能定契约（清单的 customLoad 行数统计抓不到它）',
    )
  }

  // ---- 组装 query（顺序 = list.js 的拼装顺序，逐字段一致要靠它）----
  //
  // 注意这里有**两份**契约，判据不同，不要混：
  // - `query` 是 **wire 契约**：浏览器发什么就记什么，一个字段都不许少（D20 逐字段一致）。
  //   所以 `page-definition` 那一类**照样留在 query 里**（浏览器确实会发它的初值）。
  // - `params` 是**给 AI 看的能力参数**：只有"用户能拨的筛选条件"才进去。
  //   页面定义（`isArchived` 那种）混进去会让 AI 拨到一个没有入口的开关上，
  //   实测后果是静默换一批数据（105 条 vs 118 条）。
  const tags = listTemplateTags(src)
  const seen = new Set(['order', 'orderField'])
  result.query = [
    { name: 'order', defaultValue: '', kind: 'string' },
    { name: 'orderField', defaultValue: '', kind: 'string' },
  ]
  for (const field of formFields) {
    const dv = parseDefaultValue(field.raw)
    const entry = { name: field.key, defaultValue: dv.kind === 'expression' ? null : dv.value, kind: dv.kind }
    if (seen.has(field.key)) {
      const existing = result.query.find((q) => q.name === field.key)
      existing.defaultValue = entry.defaultValue
      existing.kind = entry.kind
    } else {
      seen.add(field.key)
      result.query.push(entry)
    }
    if (dv.kind === 'expression') {
      issues.push(`form.${field.key} 的初值是运行时表达式（${field.raw.slice(0, 40)}），静态只能给个空默认`)
    }

    const judged = deriveParamKind(tags, field.key, dv)
    if (judged.role === 'page-definition') {
      result.paramsDropped.push({
        name: field.key,
        defaultValue: entry.defaultValue,
        reason: `页面定义，不是筛选条件：${judged.unresolved}`,
      })
      continue
    }
    result.params.push({
      name: field.key,
      kind: judged.kind,
      required: false,
      description: describeDefault(field.key, dv, judged),
    })
    result.paramKindEvidence.push({
      name: field.key,
      kind: judged.kind,
      basis: judged.basis,
      controlTag: judged.controlTag,
      controlFamily: judged.family,
      valueFormat: judged.valueFormat ?? null,
      unresolved: judged.unresolved,
      unresolvedShort: judged.unresolvedShort,
      conditional: judged.conditional,
    })
    if (judged.conditional) {
      issues.push(
        `参数 ${field.key} 的控件在源码里存在（<${judged.controlTag}>），但所在表单项带 v-if：` +
        '它按账号/条件渲染，本次抓不到不代表页面上没有，契约里要按"有条件"描述。',
      )
    }
  }
  if (result.paramsDropped.length) {
    issues.push(
      `已从能力参数里剔掉 ${result.paramsDropped.length} 个页面定义（${result.paramsDropped
        .map((p) => p.name)
        .join('、')}）：页面上没有控件绑定到它们，wire 契约照旧按浏览器发。`,
    )
  }
  const unresolved = result.paramKindEvidence.filter((p) => p.unresolved)
  if (unresolved.length) {
    // 这一行只给"要补几处、补哪几个"；每条缺什么写在同页的 paramKindEvidence.unresolved 里
    // （几句话的完整理由塞进 issue 会把逐页明细淹掉）
    issues.push(
      `参数类型留了 ${unresolved.length} 处要人补：` +
      unresolved.map((p) => `${p.name}（${p.unresolvedShort}）`).join('；'),
    )
  }
  if (isPage) {
    result.query.push({ name: result.pageParam, defaultValue: 1, kind: 'number' })
    result.query.push({ name: result.sizeParam, defaultValue: result.pageSizeDefault, kind: 'number' })
    result.params.push({ name: result.pageParam, kind: 'number', required: false, description: '页码，默认 1' })
    result.params.push({
      name: result.sizeParam,
      kind: 'number',
      required: false,
      description: `每页条数，默认 ${result.pageSizeDefault}`,
    })
  }

  // ---- 判定 ----
  // auto        路径与参数契约都静态确定，可以直接用
  // partial-X   路径确定，但有一处要人补；X 标出补的是哪一层（贵的和便宜的不该混为一谈）
  // failed      路径本身抽不出
  //
  // | partialKind | 含义 | 人要做的事 | 代价 |
  // | --- | --- | --- | --- |
  // | contract | 参数**集合**与 form 不一致（convertFetchForm / form 非静态） | 读一段函数，重写 query | 高 |
  // | base | 请求打到了非默认 http 实例 | 决定要不要多 base | 中 |
  // | path | 路径形态可疑（漏前导斜杠） | 去浏览器确认一次 | 中 |
  // | defaults | 只是某个字段的**初值**是运行时算的 | 补一个默认值表达式 | 低 |
  const blockers = issues.filter((i) =>
    i.startsWith('该页调用 convertFetchForm') ||
    i.startsWith('form 不是静态对象') ||
    i.startsWith('URL 漏写前导斜杠') ||
    i.startsWith('范围外：') ||
    i.startsWith('范围外？：') ||
    i.startsWith('冲突：') ||
    i.startsWith('无法确认：') ||
    i.includes('的初值是运行时表达式') ||
    i.startsWith('getDataListURL 不是字符串字面量'),
  )
  result.verdict = blockers.length ? 'partial' : 'auto'
  if (result.verdict === 'partial') {
    result.partialKind = blockers.some((i) => i.startsWith('该页调用 convertFetchForm') || i.startsWith('form 不是静态对象'))
      ? 'contract'
      : blockers.some((i) => i.startsWith('URL 漏写前导斜杠'))
        ? 'path'
        : blockers.some((i) =>
          i.startsWith('范围外：') || i.startsWith('范围外？：') ||
          i.startsWith('冲突：') || i.startsWith('无法确认：'))
          ? 'base'
          : 'defaults'
  }
  return result
}

// ---------------------------------------------------------------------------
// 3. 产出
// ---------------------------------------------------------------------------
function capabilityIdOf (pagePath) {
  return `batch:${pagePath.replace(/^\/dashboard\//, '').replace(/\//g, '-')}`
}

const HEADER = `/**
 * 批量生成的能力定义 —— **由 \`tools/generate/batch-capabilities.mjs\` 生成，勿手改。**
 *
 * 重新生成：\`node tools/generate/batch-capabilities.mjs\`（抽样 20 页）
 *          \`node tools/generate/batch-capabilities.mjs --all\`（全部声明式列表页）
 *
 * 来源：Portal 前端 \`useListPageModule({ getDataListURL, form, ... })\` 的静态抽取。
 * 抽取规则与出处见生成器文件头的表格；判定口径（auto / partial / failed）与
 * 范围口径（in-scope / out-of-scope）见同目录的 \`batch-report.json\`。
 *
 * ⚠️ 四条会让人抽错的实测事实，改这里之前先读：
 * 1. **列表请求用的 http 实例不是页面自己 import 的那个。** 只有把 http 传进
 *    \`useListPageModule({ http, ... })\`（或页面用的 preset 替它传）才生效，
 *    否则一律走 main.js 注入的 \`platform\`。裁决这个值的**唯一**依据是
 *    \`src/context/http-instance.ts\` 的 \`resolveHttpInstance()\`——
 *    本文件里的 \`httpInstance\` / \`httpModule\` / \`baseUrlEnv\` / \`sizeParam\` 都是它的快照。
 *    自己拿"文件 import 了哪个 http"去推会错：preset 包装（调用点看不到 http）、
 *    省略 \`.js\` 后缀的 import、\`as\` 别名、局部常量转发，全都会漏。
 * 2. **分页参数名是 \`pageSize\`，不是 renren 默认的 \`limit\`** —— main.js 覆写过；
 *    走 \`sale\` 实例的页又被该实例的拦截器改名回 \`limit\`；\`fieldNamePageSize\` 还能单页再覆写。
 *    \`sizeParam\` 是逐页抽出来的，别当成全局常量。
 * 3. \`url\` 是**改写之前**的原始路径；补 \`/admin-api\` 前缀（只有 \`platform\` 实例有这一步）
 *    由 src/http/client.ts 按同一份实例画像完成，\`resolvedPath\` 是改写后的结果。
 * 4. \`scope\` 与 \`verdict\` **正交**。本项目只做 Portal 主后端（决策 D3），
 *    走别的实例的页面是 \`out-of-scope\`：它照样有完整契约（浏览器实测核对与审计要用），
 *    **但不可接线**。接线请用 \`BATCH_SDK_CAPABILITIES\`，它还会排除菜单范围外与 partial 契约。
 */

import type { CapabilityDefinition, ParamKind } from '../types.js'

/** 一个查询参数在请求里的位置与初值。顺序就是 qs 序列化后的顺序（设计 D20 逐字段一致）。 */
export type BatchQueryParam = {
  name: string
  /**
   * 表单初值，原样照抄源码里的字面量。
   * - \`null\` / \`undefined\`：qs 的 \`skipNulls\` 会把它丢掉（浏览器也不发这个参数）
   * - \`[]\`：日期区间的空初值，qs 序列化后同样不产生参数
   */
  defaultValue: string | number | boolean | null | readonly unknown[]
  kind: string
}

/**
 * 一个能力参数的 kind 是**怎么定下来的**——给人复核用，AI 不读它（AI 读 \`params\`）。
 *
 * 为什么要有这个字段：kind 的判据是**页面上的控件**，而控件类型在源码里写在模板上。
 * 判得出来的就写死，判不出来的（最典型的是下拉的候选规模——实测同类下拉从 6 条到
 * 922 条都有，而它决定该是 \`enum\` 还是 \`search\`）**必须写进 \`unresolved\`**，
 * 不能拿一个看起来很确定的 kind 蒙过去。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | \`basis\` | \`control\` = 从带绑定的控件标签判出来的；\`default-value\` = 控件判不出值形状，退回按表单初值判 |
 * | \`controlTag\` | 承载绑定的那个标签（\`a-input-number\` / \`portal-hxr-select-user-department\` …） |
 * | \`controlFamily\` | 控件家族，见生成器 §2.4 的 \`CONTROL_FAMILIES\` |
 * | \`unresolved\` | 还没判完的那部分（人补清单）；判定了就是 \`null\` |
 * | \`conditional\` | 控件在，但所在表单项带 \`v-if\`（按账号/条件渲染，实测 tenantName 只对 admin 显示） |
 */
export type BatchParamKindEvidence = {
  name: string
  kind: ParamKind
  basis: 'control' | 'default-value'
  controlTag: string | null
  controlFamily: string | null
  /** 日期控件的值格式（\`value-format\`，如 \`YYYY-MM\`）；不是日期控件时为 null */
  valueFormat: string | null
  unresolved: string | null
  /** \`unresolved\` 的一句话版本（逐页 issue 里用，完整理由在 \`unresolved\`） */
  unresolvedShort: string | null
  conditional: boolean
}

/**
 * 从**能力参数**里剔掉的参数：它是"这一页是哪一页"的定义，不是用户能拨的筛选条件。
 *
 * **它仍然在 \`query\` 里**——\`query\` 是 wire 契约，浏览器发什么就记什么。剔掉的只是
 * 给 AI 看的那份：实测 \`isArchived=0\` 与"不传"完全等价，拨一下不报错、不提示，
 * 静默换一批数据（同接口实测 105 条 vs 118 条）。
 */
export type BatchDroppedParam = {
  name: string
  defaultValue: string | number | boolean | null | readonly unknown[]
  reason: string
}

/** 一页列表接口的请求契约。\`CapabilityDefinition\` 只够给 AI 看，这个才是能发请求的部分。 */
export type BatchEndpoint = {
  capabilityId: string
  pagePath: string
  title: string
  domain: string
  moduleType: number | null
  method: 'get'
  /** 补前缀之前的原始路径 */
  url: string
  /** 浏览器里真正会发出的路径（已按该实例自己的 urlRewrite 改写） */
  resolvedPath: string
  /** 该请求的 baseURL 环境变量名 */
  baseUrlEnv: string
  /**
   * 列表请求用的 **http 实例 id**（\`platform\` / \`sale\` / \`crm\` …），
   * 由 \`src/context/http-instance.ts\` 的 \`resolveHttpInstance()\` 判定，本生成物只是它的快照。
   * 判"在不在范围内"就看它——**不是**看 httpModule。
   */
  httpInstance: string
  /** 实例画像里的 file:line（\`app/portal/utils/http/sale.js:8-12\`），复核用 */
  httpInstanceSource: string | null
  /**
   * 实例是哪条规则判出来的：
   * \`global-default\` = 页面没声明，走 main.js 注入的 \`platform\`；
   * \`page-rule\` = 页面规则表命中（含简写属性、\`as\` 别名、省略 \`.js\` 后缀、局部常量转发）；
   * \`declared\` = 本次调用显式指定；
   * \`preset\` = \`useListPageModule\` 本身从 preset import，实例写死在 preset 文件里。
   */
  httpMatchedBy: 'declared' | 'page-rule' | 'global-default' | 'preset'
  /**
   * 实例所在的**源码文件**（\`sale.js\`）。与 \`httpInstance\` 是两个维度：
   * 一个文件可以导出两个实例（\`zhdj-cms.js\` 的 \`http\` 与 \`httpLay\`）。
   */
  httpModule: string
  /**
   * http 实例从哪来。\`global-default\` = 页面没声明 http，走 main.js 注入的 platform；
   * \`explicit\` = 页面（或它用的 preset）自己指定了某个 http 实例。
   * 这两者的 baseURL、补前缀规则、分页参数名都可能不同，不能混为一谈。
   */
  httpSource: 'global-default' | 'explicit'
  /** 分页参数名；为 null 表示该接口不分页 */
  pageParam: string | null
  sizeParam: string | null
  /** URL 里写死的 query（不来自 form），在 params 之前合并 */
  staticQuery: BatchQueryParam[]
  /** 完整 query 顺序 */
  query: BatchQueryParam[]
  /**
   * 每个**能力参数**的 kind 判据，按名字与 \`params\` 一一对应（分页参数不在其中——
   * 它们在页面上是分页器、不是表单控件，没有"控件类型"这一问）。
   */
  paramKindEvidence: BatchParamKindEvidence[]
  /** 判成「页面定义」而没进 \`params\` 的参数。\`query\` 里仍然有它们。 */
  paramsDropped: BatchDroppedParam[]
  /**
   * **范围**：走 \`platform\` 是 \`in-scope\`（决策 D3 只做 Portal 主后端），走别的实例是
   * \`out-of-scope\`；\`unresolved\` = 实例没解出来（此时一律不可接线）。
   *
   * 这个字段与 \`verdict\` **正交**：一页可以既 \`auto\` 又 \`out-of-scope\`，
   * 那时它的问题不是"人补得不够"，是范围决策的结果。接线只看 \`scope === 'in-scope'\`。
   */
  scope: 'in-scope' | 'out-of-scope' | 'unresolved'
  /**
   * 菜单范围：只有固定范围模型中 included + callable 的菜单页才允许进入 SDK。
   * 它与 http 实例范围正交；平台实例上的范围外菜单也不能因为后端相同而被接入。
   */
  menuScope: 'retained' | 'outside' | 'unknown'
  /** 抽取判定。见生成器里 partialKind 的四档说明。 */
  verdict: 'auto' | 'partial' | 'failed'
  /** verdict 为 partial 时，缺的是哪一层 */
  partialKind?: 'contract' | 'base' | 'path' | 'defaults'
  /** 抽取过程中发现的问题（人补清单）。以 \`范围外：\` 开头的表示不可接线。 */
  issues: string[]
}

/** 生成这批定义时用的输入快照，用于判断"生成物是不是过期了" */
export const BATCH_GENERATED_META = %META% as const
`

function serializeEndpoint (e, indent) {
  const pad = ' '.repeat(indent)
  const q = (list) => list.length === 0
    ? '[]'
    : '[\n' + list.map((p) =>
      `${pad}  { name: ${JSON.stringify(p.name)}, defaultValue: ${JSON.stringify(p.defaultValue)}, kind: ${JSON.stringify(p.kind)} },`,
    ).join('\n') + `\n${pad}]`
  const issues = e.issues.length === 0
    ? '[]'
    : '[\n' + e.issues.map((i) => `${pad}  ${JSON.stringify(i)},`).join('\n') + `\n${pad}]`
  return [
    `${pad}{`,
    `${pad}  capabilityId: ${JSON.stringify(e.capabilityId)},`,
    `${pad}  pagePath: ${JSON.stringify(e.pagePath)},`,
    `${pad}  title: ${JSON.stringify(e.title)},`,
    `${pad}  domain: ${JSON.stringify(e.domain)},`,
    `${pad}  moduleType: ${e.moduleType === null ? 'null' : e.moduleType},`,
    `${pad}  method: 'get',`,
    `${pad}  url: ${JSON.stringify(e.url)},`,
    `${pad}  resolvedPath: ${JSON.stringify(e.resolvedPath)},`,
    `${pad}  baseUrlEnv: ${JSON.stringify(e.baseUrlEnv)},`,
    `${pad}  httpInstance: ${JSON.stringify(e.httpInstance)},`,
    `${pad}  httpInstanceSource: ${JSON.stringify(e.httpInstanceSource)},`,
    `${pad}  httpMatchedBy: ${JSON.stringify(e.httpMatchedBy)},`,
    `${pad}  httpModule: ${JSON.stringify(e.httpModule)},`,
    `${pad}  httpSource: ${JSON.stringify(e.httpSource)},`,
    `${pad}  pageParam: ${e.pageParam === null ? 'null' : JSON.stringify(e.pageParam)},`,
    `${pad}  sizeParam: ${e.sizeParam === null ? 'null' : JSON.stringify(e.sizeParam)},`,
    `${pad}  staticQuery: ${q(e.staticQuery)},`,
    `${pad}  query: ${q(e.query)},`,
    `${pad}  paramKindEvidence: ${kindEvidence(e.paramKindEvidence, pad)},`,
    `${pad}  paramsDropped: ${dropped(e.paramsDropped, pad)},`,
    `${pad}  scope: ${JSON.stringify(e.scope)},`,
    `${pad}  menuScope: ${JSON.stringify(e.menuScope)},`,
    `${pad}  verdict: ${JSON.stringify(e.verdict)},`,
    ...(e.partialKind ? [`${pad}  partialKind: ${JSON.stringify(e.partialKind)},`] : []),
    `${pad}  issues: ${issues},`,
    `${pad}},`,
  ].join('\n')
}

/** `paramKindEvidence` 的序列化（人复核用，逐字段原样写） */
function kindEvidence (list, pad) {
  if (list.length === 0) return '[]'
  return '[\n' + list.map((p) =>
    `${pad}    { name: ${JSON.stringify(p.name)}, kind: ${JSON.stringify(p.kind)}, ` +
    `basis: ${JSON.stringify(p.basis)}, controlTag: ${JSON.stringify(p.controlTag)}, ` +
    `controlFamily: ${JSON.stringify(p.controlFamily)}, valueFormat: ${JSON.stringify(p.valueFormat)}, ` +
    `unresolved: ${JSON.stringify(p.unresolved)}, ` +
    `unresolvedShort: ${JSON.stringify(p.unresolvedShort)}, conditional: ${p.conditional} },`,
  ).join('\n') + `\n${pad}  ]`
}

/** `paramsDropped` 的序列化 */
function dropped (list, pad) {
  if (list.length === 0) return '[]'
  return '[\n' + list.map((p) =>
    `${pad}    { name: ${JSON.stringify(p.name)}, defaultValue: ${JSON.stringify(p.defaultValue)}, ` +
    `reason: ${JSON.stringify(p.reason)} },`,
  ).join('\n') + `\n${pad}  ]`
}

function serializeCapability (e, indent) {
  const pad = ' '.repeat(indent)
  const params = e.params.length === 0
    ? '[]'
    : '[\n' + e.params.map((p) =>
      `${pad}    { name: ${JSON.stringify(p.name)}, kind: ${JSON.stringify(p.kind)}, required: false, description: ${JSON.stringify(p.description)} },`,
    ).join('\n') + `\n${pad}  ]`
  return [
    `${pad}{`,
    `${pad}  id: ${JSON.stringify(e.capabilityId)},`,
    `${pad}  title: ${JSON.stringify(`查询${e.title}`)},`,
    `${pad}  pagePath: ${JSON.stringify(e.pagePath)},`,
    ...(e.permission ? [`${pad}  permission: ${JSON.stringify(e.permission)},`] : []),
    `${pad}  write: ${e.write},`,
    `${pad}  params: ${params},`,
    `${pad}},`,
  ].join('\n')
}

function renderCapabilitiesFile (endpoints, meta) {
  const usable = endpoints.filter((e) => e.verdict !== 'failed')
  const lines = [HEADER.replace('%META%', () => JSON.stringify(meta, null, 2))]
  lines.push('')
  lines.push('/** 按 capabilityId 索引的请求契约。失败的页面不进这里（宁可缺席，不给错路径）。 */')
  lines.push('export const BATCH_ENDPOINTS: Record<string, BatchEndpoint> = {')
  for (const e of usable) {
    lines.push(`  ${JSON.stringify(e.capabilityId)}: {`)
    lines.push(serializeEndpoint(e, 2).split('\n').slice(1, -1).join('\n'))
    lines.push('  },')
  }
  lines.push('}')
  lines.push('')
  lines.push('/** 可直接喂给 createCatalog() / portal.capabilities 的能力定义。 */')
  lines.push('export const BATCH_CAPABILITIES: CapabilityDefinition[] = [')
  for (const e of usable) lines.push(serializeCapability(e, 2))
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

const INDEX_FILE = `/**
 * 批量生成能力的注册入口 —— **由 \`tools/generate/batch-capabilities.mjs\` 生成，勿手改。**
 *
 * 这个文件是"接线点"，故意**不**放进 \`src/index.ts\`：
 * 批量产出需要先验证过（见同目录 \`batch-report.json\` 的正确率），再由主会话决定接不接、
 * 接哪些。
 *
 * ⚠️ **SDK 接线用 \`BATCH_SDK_CAPABILITIES\`，不是 \`BATCH_CAPABILITIES\`。**
 * 后者是**审计清单**：它按"抽不抽得出来"组织，因此也包含打到别的后端（\`scope !== 'in-scope'\`）
 * 的页面——那些页面是别的产品线的接口，接进来会打到错的 URL。
 * 接线时把它们并进 \`portal.capabilities\`，等于静默发错请求。
 * \`BATCH_IN_SCOPE_CAPABILITIES\` 还包含 \`partial\` 契约，只供审计与人工补齐。
 *
 * 用法（主会话接线时）：
 * \`\`\`ts
 * import { BATCH_SDK_CAPABILITIES, createBatchListCapability } from './capabilities/generated/index.js'
 * // ...
 * const capabilities = [...meetingRoomCapabilities, ...meetingApplicationCapabilities, ...BATCH_SDK_CAPABILITIES]
 * \`\`\`
 */

import type { CapabilityDefinition, ParamSpec } from '../types.js'
import type { PortalRequestConfig } from '../../http/client.js'
import type { PortalRequest } from '../meeting-room.js'
import {
  BATCH_CAPABILITIES,
  BATCH_ENDPOINTS,
  BATCH_GENERATED_META,
  type BatchEndpoint,
  type BatchQueryParam,
} from './batch-capabilities.js'

export { BATCH_CAPABILITIES, BATCH_ENDPOINTS, BATCH_GENERATED_META }
export type { BatchEndpoint, BatchQueryParam }

/** 只保留判定为 auto 的页面：partial 的契约里有已知缺口，接线时不该默认开放。 */
export const BATCH_AUTO_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.verdict === 'auto',
)

/**
 * **范围**维度（决策 D3 只做 Portal 主后端）：
 * \`in-scope\` = 列表请求走 \`platform\` 实例，接进来发的是同一个后端；其余一律不可接线。
 */
export const BATCH_IN_SCOPE_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.scope === 'in-scope',
)

/**
 * 真正接入 SDK 的安全子集：固定菜单保留、后端范围内且静态抽取结论为 auto。
 *
 * \`BATCH_IN_SCOPE_CAPABILITIES\` 仍然保留给审计与人工复核，它还包含 partial
 * 契约；把 partial 直接开放成 SDK 能力会让调用方以为表单/路径已经完整对齐。
 * 这里的 \`write: false\` 是刻意的：该入口只提供自动抽取出的 GET 列表请求，
 * 不代表对应 Portal 页面没有新增、编辑或删除动作。
 */
export const BATCH_SDK_CAPABILITIES: CapabilityDefinition[] = BATCH_CAPABILITIES
  .filter((c) => {
    const endpoint = BATCH_ENDPOINTS[c.id]
    return endpoint?.scope === 'in-scope' &&
      endpoint.menuScope === 'retained' &&
      endpoint.verdict === 'auto'
  })
  .map((c) => ({ ...c, write: false }))

/**
 * 范围外的契约，**只用于审计**：留在生成物里是为了让"有哪几页被打到别的后端"这件事
 * 可见、可复核、可回归。它们对应的后端不在本项目范围内，别接。
 */
export const BATCH_OUT_OF_SCOPE_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.scope !== 'in-scope',
)

export type BatchListQuery = Record<string, string | number | boolean | null | undefined>

export type BatchPageRequest = (
  pagePath: string,
  config: PortalRequestConfig,
) => Promise<unknown>

type BatchRequest = (config: Parameters<PortalRequest>[0]) => Promise<unknown>

function createBatchListCapabilityFromRequest (endpoint: BatchEndpoint, request: BatchRequest) {
  if (endpoint.scope !== 'in-scope') {
    throw new Error(
      \`\${endpoint.pagePath} 的列表请求走 \${endpoint.httpInstance} 实例\` +
      \`（\${endpoint.httpModule}，baseURL=\${endpoint.baseUrlEnv}），不在 SDK 的 Portal 主后端范围内\` +
      \`（scope=\${endpoint.scope}，决策 D3）。这条契约只能用于审计，不能发请求。\`,
    )
  }
  return {
    /** 按该页的契约查询列表 */
    list (query: BatchListQuery = {}): Promise<unknown> {
      const params: Record<string, unknown> = {}
      for (const item of endpoint.staticQuery) params[item.name] = item.defaultValue
      for (const item of endpoint.query) {
        const provided = query[item.name]
        params[item.name] = provided === undefined ? item.defaultValue : provided
      }
      return request({ url: endpoint.url, method: 'get', params })
    },
  }
}

/**
 * 把一页的请求契约变成可调用的列表查询。
 *
 * 参数顺序严格按 \`endpoint.query\`：renren 的列表接口要靠 order/orderField/form 同序，
 * 才能和浏览器请求逐字段一致（设计 D20）。
 *
 * **范围外直接拒绝**，与 \`resolveHttpInstance\` 失败时拒发请求是同一条口径：
 * 这条契约的 \`url\` 不是给本项目那个后端用的，静默发出去只会得到一个 404 或者
 * 一个字段对不上的 200，两种都很难查。
 */
export function createBatchListCapability (endpoint: BatchEndpoint, request: PortalRequest) {
  return createBatchListCapabilityFromRequest(endpoint, (config) => request<unknown>(config))
}

/** 与门面的 \`call(pagePath, config)\` 对接，确保 module-type / http 实例规则仍按页面解析。 */
export function createBatchListPageCapability (endpoint: BatchEndpoint, request: BatchPageRequest) {
  return createBatchListCapabilityFromRequest(endpoint, (config) => request(endpoint.pagePath, config))
}

/** capability ID 的稳定方法名：\`batch:foo-bar-list\` → \`fooBarList\`。 */
export function batchMethodName (capabilityId: string): string {
  return capabilityId
    .replace(/^batch:/, '')
    .replace(/[-:]([a-zA-Z])/g, (_match, character: string) => character.toUpperCase())
}

export type BatchCapability = ReturnType<typeof createBatchListCapability>
export type BatchCapabilityHost = Record<string, BatchCapability>

/** 构造 SDK 门面上的批量列表方法组；只暴露安全子集，不绕过页面上下文。 */
export function createBatchCapabilityHost (request: BatchPageRequest): BatchCapabilityHost {
  const host: BatchCapabilityHost = {}
  for (const capability of BATCH_SDK_CAPABILITIES) {
    const endpoint = BATCH_ENDPOINTS[capability.id]
    if (endpoint === undefined) throw new Error(\`批量能力缺少请求契约：\${capability.id}\`)
    host[batchMethodName(capability.id)] = createBatchListPageCapability(endpoint, request)
  }
  return host
}

/** 该页声明的参数契约（给 AI 看的形态） */
export function batchParamSpecs (endpoint: BatchEndpoint): ParamSpec[] {
  return BATCH_CAPABILITIES.find((c) => c.id === endpoint.capabilityId)?.params ?? []
}
`

function main () {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const dry = args.includes('--dry')

  if (!fs.existsSync(CATALOG_FILE)) {
    process.stderr.write(`[batch-capabilities] 找不到 ${path.relative(PKG_ROOT, CATALOG_FILE)}，先跑 pnpm generate\n`)
    process.exit(1)
  }
  if (!fs.existsSync(SCOPE_FILE)) {
    process.stderr.write('[batch-capabilities] 找不到 ' + path.relative(PKG_ROOT, SCOPE_FILE) + '，无法按固定菜单范围接线；先跑 pnpm generate\n')
    process.exit(1)
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
  const portalScope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'))
  const retainedMenuPaths = new Set(
    portalScope.items
      .filter((item) => item.included && item.callable && item.status === 'included' && item.menuPath !== null)
      .map((item) => item.menuPath),
  )
  const declarative = catalog.items.filter((i) => i.kind === DECLARATIVE_KIND)
  const byPath = new Map(declarative.map((i) => [i.menuPath, i]))

  const missing = SAMPLES.filter((s) => !byPath.has(s.pagePath)).map((s) => s.pagePath)
  if (missing.length) {
    process.stderr.write(`[batch-capabilities] 抽样页不在清单的声明式列表页里：${missing.join(', ')}\n`)
    process.exit(1)
  }

  const targets = all ? declarative : SAMPLES.map((s) => byPath.get(s.pagePath))
  const endpoints = targets.map((row) => {
    const e = extractListEndpoint(PORTAL_REPO, row)
    e.capabilityId = capabilityIdOf(e.pagePath)
    e.menuScope = retainedMenuPaths.has(e.pagePath) ? 'retained' : 'outside'
    return e
  })

  // 全量分析（外推用）：无论抽样还是全量，都对 255 页跑一遍同一条代码路径
  const coverage = (all ? endpoints : declarative.map((row) => extractListEndpoint(PORTAL_REPO, row))).map((e) => {
    e.menuScope = retainedMenuPaths.has(e.pagePath) ? 'retained' : 'outside'
    return e
  })

  const tally = (list) => ({
    total: list.length,
    auto: list.filter((e) => e.verdict === 'auto').length,
    partial: list.filter((e) => e.verdict === 'partial').length,
    failed: list.filter((e) => e.verdict === 'failed').length,
    partialKind: {
      contract: list.filter((e) => e.partialKind === 'contract').length,
      base: list.filter((e) => e.partialKind === 'base').length,
      path: list.filter((e) => e.partialKind === 'path').length,
      defaults: list.filter((e) => e.partialKind === 'defaults').length,
    },
    失败原因: list.filter((e) => e.verdict === 'failed').reduce((acc, e) => {
      const key = e.issues[0] ? e.issues[0].slice(0, 40) : '(无 issue)'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
  })

  /**
   * 按参数类型切一刀——**与裁决、范围都正交**的第三个维度。
   *
   * 为什么单独算：裁决（auto/partial/failed）只回答「路径与参数集合抽不抽得出来」。
   * 抽样装置 2026-09-20 的实测摆着另一件事——**形状 24/24 全对，但 68 个参数里 28 个的
   * kind 与页面控件不符、12 个页面上根本没有控件**。一页可以既 `auto` 又有这个毛病，
   * 混在一个数字里就看不见了。
   */
  const kindTally = (list) => {
    const evidence = list.flatMap((e) => e.paramKindEvidence)
    const dropped = list.flatMap((e) => e.paramsDropped.map((d) => ({ ...d, pagePath: e.pagePath })))
    const by = (items, key) => items.reduce((acc, x) => {
      const k = key(x)
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {})
    const pagesWith = (pred) => list.filter(pred).length
    return {
      参数总数: evidence.length,
      按kind: by(evidence, (x) => x.kind),
      按判据: by(evidence, (x) => x.basis),
      按控件家族: by(evidence, (x) => x.controlFamily ?? '(判不出)'),
      待人补: {
        参数数: evidence.filter((x) => x.unresolved).length,
        页数: pagesWith((e) => e.paramKindEvidence.some((x) => x.unresolved)),
        按原因: by(evidence.filter((x) => x.unresolved), (x) => x.unresolvedShort ?? x.unresolved),
      },
      按账号条件渲染: {
        参数数: evidence.filter((x) => x.conditional).length,
        页数: pagesWith((e) => e.paramKindEvidence.some((x) => x.conditional)),
      },
      从能力参数里剔掉的页面定义: {
        参数数: dropped.length,
        页数: pagesWith((e) => e.paramsDropped.length > 0),
        参数名: [...new Set(dropped.map((d) => d.name))].sort(),
        说明: '它们**仍在 query（wire 契约）里**——浏览器确实会发这些初值。剔掉的只是给 AI 看的那份：'
          + '页面定义混进能力参数，等于给 AI 一个页面上没有入口的开关，拨了会静默换一批数据。',
      },
    }
  }

  /**
   * 按 http 实例范围切一刀——**与裁决正交**的第二个维度。
   *
   * 裁决回答"这页抽不抽得出来"，范围回答"抽出来该不该接"。两者必须分开算：
   * 一页可以既抽得出（auto）又在范围外，那时它**不是待办**，是范围决策的结果。
   */
  const scopeTally = (list) => ({
    口径: '计 http 实例与固定菜单范围；走 platform 为后端范围内，included + callable 为菜单保留范围。',
    页数: list.length,
    范围内: list.filter((e) => e.scope === 'in-scope').length,
    范围外: list.filter((e) => e.scope === 'out-of-scope').length,
    实例未解出: list.filter((e) => e.scope === 'unresolved').length,
    按实例: list.reduce((acc, e) => {
      const key = e.httpInstance ?? '(未解出)'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {}),
    裁决内拆分: {
      auto: {
        范围内: list.filter((e) => e.verdict === 'auto' && e.scope === 'in-scope').length,
        范围外: list.filter((e) => e.verdict === 'auto' && e.scope === 'out-of-scope').length,
      },
      partial: {
        范围内: list.filter((e) => e.verdict === 'partial' && e.scope === 'in-scope').length,
        范围外: list.filter((e) => e.verdict === 'partial' && e.scope === 'out-of-scope').length,
      },
      failed: {
        范围内: list.filter((e) => e.verdict === 'failed' && e.scope === 'in-scope').length,
        范围外: list.filter((e) => e.verdict === 'failed' && e.scope === 'out-of-scope').length,
      },
    },
    /** 后端范围内且 auto 的统计；固定菜单范围由 menuScope 与 SDK 子集另行裁决。 */
    可接_范围内且auto: list.filter((e) => e.verdict === 'auto' && e.scope === 'in-scope').length,
    SDK可接_范围内且菜单保留且auto: list.filter((e) =>
      e.verdict === 'auto' && e.scope === 'in-scope' && e.menuScope === 'retained',
    ).length,
    范围外明细: list.filter((e) => e.scope !== 'in-scope').map((e) => ({
      pagePath: e.pagePath,
      verdict: e.verdict,
      httpInstance: e.httpInstance,
      httpModule: e.httpModule,
      baseUrlEnv: e.baseUrlEnv,
      scope: e.scope,
    })),
  })

  const report = {
    生成物: 'src/capabilities/generated/**',
    生成器: 'tools/generate/batch-capabilities.mjs',
    输入: { portalRepo: PORTAL_REPO, pageCatalog: 'generated/page-catalog.json' },
    实例推导器: {
      来源: 'src/context/http-instance.ts 的 resolveHttpInstance()（本脚本只消费结论，不另写一份）',
      实例总数: HTTP_INSTANCES.length,
      范围内实例: IN_SCOPE_INSTANCE_ID,
      范围依据: '决策 D3：只做 Portal 主后端',
    },
    口径说明: {
      '裁决（auto/partial/failed）':
        '只看"这页的路径与参数契约抽不抽得出来"，**不计 http 实例**。' +
        '上一轮报告的 136 / 115 / 4 就是这个口径，原样保留在上面的键里以便追溯。',
      '范围（in-scope / out-of-scope）':
        '走 platform 实例 = 范围内；走别的实例 = 范围外。范围外的页面不是"待补"，' +
        '是范围决策的结果——除非 D3 改了，人补再多也不会变成能接的能力。',
      '参数 kind（控件判据）':
        'kind 的判据是**页面上的控件**（源码模板里写的是 a-input 还是 a-select），' +
        '不是表单初值的类型（判据与出处见生成器 §2.4）。判得出来的写死；判不出来的' +
        '（最典型：下拉的候选规模——实测同类下拉从 6 条到 922 条都有，而它决定该是 enum 还是 search/tree）' +
        '写进 `unresolved`，**不拿一个看起来很确定的 kind 蒙过去**。这一维度与「裁决」「范围」都正交：' +
        '一页可以既 auto 又有要人补的参数。',
    },
    '抽样页数': all ? declarative.length : SAMPLES.length,
    抽样依据: all
      ? '全量：清单里 kind === 列表页(声明式 getDataListURL) 的全部页面'
      : SAMPLES.map((s) => ({ pagePath: s.pagePath, stratum: s.stratum })),
    '抽样判定': tally(endpoints),
    // 页数**算出来**，不写死：清单变了（2026-09-21 去掉被注释的菜单项，1019 → 975），
    // 写死的「255」会当场变成一句假话
    [`全量外推（${coverage.length} 个声明式列表页同一条代码路径）`]: tally(coverage),
    '全量外推·按 http 实例范围拆分': scopeTally(coverage),
    '抽样页·按 http 实例范围拆分': scopeTally(endpoints),
    浏览器实测核对: (() => {
      const byPath = new Map(endpoints.map((e) => [e.pagePath, e]))
      const rows = BROWSER_VERIFIED.map((v) => {
        const e = byPath.get(v.pagePath)
        const reproduced = e ? reproduceBrowserUrl(e) : null
        const browser = new URL(v.url)
        const browserClean = `${browser.origin}${browser.pathname}${browser.search}`
        return {
          pagePath: v.pagePath,
          note: v.note,
          浏览器发出的: browserClean,
          按生成契约还原的: reproduced,
          一致: reproduced === browserClean,
          该页判定: e ? e.verdict : '(不在本次抽样里)',
        }
      })
      return {
        核对页数: rows.length,
        一致页数: rows.filter((r) => r.一致).length,
        说明: '用 bsk 在测试环境实测抓取；只读、无写操作；token 由页面内钩子脱敏。_t 时间戳已剔除。',
        明细: rows,
      }
    })(),
    '参数 kind（控件判据）': {
      口径: 'kind 的判据是页面上的控件，不是表单初值的类型（生成器 §2.4）。'
        + '「待人补」= 控件类型判出来了、但 kind 定不死（`unresolved` 非空）的参数数。',
      抽样: kindTally(endpoints),
      全量: kindTally(coverage),
    },
    非自动样本明细: coverage.filter((e) => e.verdict !== 'auto').map((e) => ({
      pagePath: e.pagePath,
      verdict: e.verdict,
      ...(e.partialKind ? { partialKind: e.partialKind } : {}),
      httpInstance: e.httpInstance,
      httpModule: e.httpModule,
      baseUrlEnv: e.baseUrlEnv,
      scope: e.scope,
      rawUrl: e.rawUrl,
      resolvedPath: e.resolvedPath,
      issues: e.issues,
    })),
  }

  if (dry) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  // 新鲜度判据是**内容哈希，不是时间戳**（conventions 第 23 条）。
  // 这里曾经记的是 `catalog.generatedAt`，后果是：只要有人重跑一次
  // `pnpm generate`（哪怕目录内容一字未变，只是 generatedAt 被刷成新时间），
  // 这份生成物就"过期"了，`test/batch-capabilities.test.ts` 当场变红。
  // 2026-09-20 过夜实测踩到：修好 pre-commit 钩子的 `pnpm docs` 空转之后，
  // 第一次真的重建就把这条引爆了。改成对**除 generatedAt 之外**的目录内容取哈希。
  const { generatedAt: _ignoredCatalogTimestamp, ...catalogContent } = catalog
  const meta = {
    portalRepo: PORTAL_REPO,
    catalogContentHash: crypto
      .createHash('sha256')
      .update(JSON.stringify(catalogContent))
      .digest('hex')
      .slice(0, 12),
    pageCatalogTotal: catalog.total,
    declarativeTotal: declarative.length,
    endpointCount: endpoints.filter((e) => e.verdict !== 'failed').length,
    inScopeAutoCount: endpoints.filter((e) => e.verdict === 'auto' && e.scope === 'in-scope').length,
    // 实例与范围也进哈希：换一个实例等于换一条 URL，生成物必须跟着变。
    // 参数类型（params / 剔掉的那些）同样进哈希：改判一个 kind 也是一次生成物变化，
    // 「新鲜度判据是内容哈希」这条要覆盖得住它。
    contentHash: crypto
      .createHash('sha256')
      .update(JSON.stringify(endpoints.map((e) => [
        e.pagePath, e.url, e.query, e.verdict, e.httpInstance, e.scope, e.menuScope,
        e.params, e.paramsDropped,
      ])))
      .digest('hex')
      .slice(0, 12),
  }

  fs.writeFileSync(path.join(OUT_DIR, 'batch-capabilities.ts'), renderCapabilitiesFile(endpoints, meta))
  fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), INDEX_FILE)
  fs.writeFileSync(path.join(OUT_DIR, 'batch-report.json'), JSON.stringify(report, null, 2) + '\n')

  const t = report['抽样判定']
  const c = report[Object.keys(report).find((k) => k.startsWith('全量外推（'))]
  const cs = report['全量外推·按 http 实例范围拆分']
  const split = cs.裁决内拆分
  process.stdout.write(
    `[batch-capabilities] Portal 仓库：${PORTAL_REPO}｜实例推导器：${report.实例推导器.来源}\n` +
    `[batch-capabilities] 抽样 ${t.total} 页 → auto ${t.auto} / partial ${t.partial} / failed ${t.failed}\n` +
    `[batch-capabilities] 全量 ${c.total} 页 → auto ${c.auto} / partial ${c.partial} / failed ${c.failed}\n` +
    `[batch-capabilities]   ├ auto：范围内 ${split.auto.范围内}／范围外 ${split.auto.范围外}\n` +
    `[batch-capabilities]   ├ partial：范围内 ${split.partial.范围内}／范围外 ${split.partial.范围外}\n` +
    `[batch-capabilities]   └ failed：范围内 ${split.failed.范围内}／范围外 ${split.failed.范围外}\n` +
    `[batch-capabilities] 后端契约可接线（范围内且 auto）：${cs.可接_范围内且auto} 页；固定菜单保留且可接入：${cs.SDK可接_范围内且菜单保留且auto} 页\n` +
    `[batch-capabilities] 已写入 ${path.relative(PKG_ROOT, OUT_DIR)}/{batch-capabilities.ts,index.ts,batch-report.json}\n`,
  )
}

// 只有直接执行才跑 main()；被测试 import 时不要有副作用
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
