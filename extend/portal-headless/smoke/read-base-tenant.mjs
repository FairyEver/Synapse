#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境读**企业与租户上下文**那一族接口
 * （`src/capabilities/base-tenant.ts`），记录真实的条数 / 体积 / 耗时 / 形状。
 *
 *   A. GET /admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=1&pageSize=200   企业列表
 *   B. GET /admin-api/system/tenant/get?id={tenantId}                               企业开通的系统
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-base-tenant.mjs
 *
 * **全程只读**（GET）。脚本末尾会如实报出这次一共发了几次 GET，便于核对这条边界。
 *
 * ## 这个脚本要回答的四件事（都是能力里写了、但只有真机能证实的）
 *
 * 1. **`pageSize=-1` 到底会怎样** —— `src/capabilities/base-tenant.ts` 的文件头写着
 *    "它不省事，还会把 `total` 归零"。这条是从一次探索性探针里看到的，
 *    本脚本把它**固定成一条每次都会跑、每次都会打印的对照**。
 * 2. **`module-type` 敏感性** —— 交错四次（不带 → 带 11 → 不带 → 带 11），
 *    判据与 `read-base-shell.mjs` 的 `moduleTypeControl` 完全相同：先确认基线自己稳不稳，
 *    再比带/不带。**基线不稳时如实报"本次对照无效"，不硬给结论。**
 * 3. **敏感字段真的在原始响应里** —— `identityNumber`（实测 18 位身份证号）、
 *    `identityImg`、`contactMobile` 各出现了几次。**只报"有没有、多长"，不打印值。**
 * 4. **白名单会裁掉多少** —— 原始 21 个字段里，能力只返回 9 个。
 *
 * 为什么不用 `createPortalHeadless`：这两个能力的**接线由派单方统一做**
 * （`src/capabilities/index.ts` 与门面同批不动），所以这里用 Node 内置 `fetch` 直接打。
 * 请求头与 `src/http/headers.ts` 的 `generate-http-headers` 形态逐字段一致
 * （tenant-id / token / Accept-Language），否则量出来的不是 SDK 将来会看到的那份。
 */

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-base-tenant.mjs\n',
  )
  process.exit(1)
}

const out = (line = '') => process.stdout.write(`${line}\n`)

/** 与 src/http/headers.ts 的 generate-http-headers 同形：顺序与"空值不写"都一致 */
function headers (extra = {}) {
  return {
    'tenant-id': String(tenantId),
    token,
    'Accept-Language': 'zh-CN',
    ...extra,
  }
}

/** 真实发出去的只读 GET 次数（末尾如实报出来，便于核对"只读"这条边界） */
let GET_COUNT = 0

/** 打一次只读 GET，回报「原始字节数 / 耗时 / 解析后的 data」 */
async function readJson (path, extraHeaders = {}) {
  const url = `${baseUrl}${path}`
  GET_COUNT += 1
  const startedAt = Date.now()
  const response = await fetch(url, { method: 'GET', headers: headers(extraHeaders) })
  const text = await response.text()
  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    throw new Error(`GET ${path} → HTTP ${response.status}：${text.slice(0, 200)}`)
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`GET ${path} → 响应不是 JSON（前 200 字节：${text.slice(0, 200)}）`)
  }
  if (parsed?.code !== 0 && parsed?.code !== undefined) {
    throw new Error(`GET ${path} → code=${parsed.code} msg=${parsed.msg}`)
  }

  return { path, bytes: Buffer.byteLength(text, 'utf8'), elapsedMs, data: parsed?.data }
}

const DASH = '─'.repeat(72)
function section (title) {
  out()
  out(DASH)
  out(title)
  out(DASH)
}

/**
 * `module-type` 对照：**交错四次**（不带 → 带 11 → 不带 → 带 11）。
 *
 * ⚠️ 判据**不是**"打两次比一次"。见 `read-base-shell.mjs` 里那段教训：
 * 朴素的两次对比会把"资源自己在动"误报成"头部敏感"（`homePage/get` 就这么被骗过一次）。
 * 所以先看同参数两次是否一致；不一致就如实说"本次对照无效"。
 */
async function moduleTypeControl (label, path) {
  const first = await readJson(path)
  const withFirst = await readJson(path, { 'module-type': '11' })
  const second = await readJson(path)
  const withSecond = await readJson(path, { 'module-type': '11' })

  const a = JSON.stringify(first.data)
  const a2 = JSON.stringify(second.data)
  const b = JSON.stringify(withFirst.data)
  const b2 = JSON.stringify(withSecond.data)

  const baselineStable = a === a2 && b === b2
  const same = baselineStable && a === b

  if (!baselineStable) {
    out(`  module-type 对照 ${label}：**基线本身就不稳**（同参数两次已经不同）→ 本次对照无效，不给结论`)
  } else {
    out(
      `  module-type 对照 ${label}：不带 ${first.bytes} B / 带 11 ${withFirst.bytes} B → ` +
        `${same ? '**data 完全相同**（本账号不敏感）' : '**不同（敏感）**'}`,
    )
  }
  return { same, baselineStable }
}

const TENANT_LIST_PATH = '/admin-api/hr/system-tenant/getUserTenantsByPage'
const TENANT_DETAIL_PATH = '/admin-api/system/tenant/get'

/**
 * 能力白名单里那 9 个字段，以及它们在**原始响应**里的来源键名。
 *
 * ⚠️ 其中两个**改了名**（`useSystem` → `systems`、`createTime` → `createDate`），
 * 所以按原始键名去数只会数到 7 个 —— 那不是漏字段，是脚本这里要如实分开写。
 */
const SUMMARY_WHITELIST = [
  ['id', 'id'],
  ['name', 'name'],
  ['shortName', 'shortName'],
  ['code', 'code'],
  ['status', 'status'],
  ['systems', 'useSystem'],
  ['contactName', 'contactName'],
  ['tenantAdmin', 'tenantAdmin'],
  ['createDate', 'createTime'],
]

const moduleTypeSensitive = []
const moduleTypeInconclusive = []

try {
  // -------------------------------------------------------------------------
  // A. 企业列表
  // -------------------------------------------------------------------------
  section('A. GET /admin-api/hr/system-tenant/getUserTenantsByPage （我属于哪些企业）')

  const pageSize200 = await readJson(`${TENANT_LIST_PATH}?pageNo=1&pageSize=200`)
  const list = Array.isArray(pageSize200.data?.list) ? pageSize200.data.list : []
  out(`pageSize=200：字节 ${pageSize200.bytes} / 耗时 ${pageSize200.elapsedMs} ms / list ${list.length} 条 / total ${pageSize200.data?.total}`)

  const allKeys = list.length > 0 ? Object.keys(list[0]) : []
  out(`原始字段 ${allKeys.length} 个：${JSON.stringify(allKeys)}`)

  // ⚠️ 只报"有没有、多长"，**不打印值**（真机上是真实身份证号与手机号）
  const pii = ['identityNumber', 'identityImg', 'contactMobile', 'isChinaResident']
  out('敏感字段在原始响应里的分布：')
  for (const key of pii) {
    const hits = list.filter((item) => key in item)
    const nonEmpty = list.filter((item) => item?.[key] !== null && item?.[key] !== undefined && item?.[key] !== '')
    const sample = nonEmpty[0]?.[key]
    out(
      `  ${key}：出现在 ${hits.length}/${list.length} 条上，非空 ${nonEmpty.length} 条` +
        `${nonEmpty.length > 0 ? `（样例类型 ${typeof sample}，长度 ${String(sample).length} —— **值不打印**）` : ''}`,
    )
  }

  const keptRaw = SUMMARY_WHITELIST.map(([, raw]) => raw).filter((raw) => allKeys.includes(raw))
  out(
    `能力白名单保留 ${SUMMARY_WHITELIST.length}/${allKeys.length} 个输出字段` +
      `（对应原始键名 ${keptRaw.length} 个：${JSON.stringify(keptRaw)}；` +
      '其中 useSystem→systems、createTime→createDate 是改名）',
  )
  out(`被裁掉 ${allKeys.length - keptRaw.length} 个：${JSON.stringify(allKeys.filter((key) => !keptRaw.includes(key)))}`)

  out(`useSystem 原值样例：${JSON.stringify(list[0]?.useSystem)}（能力会拆成 number[]，**不贴中文标签**）`)
  const adminValues = list.map((item) => JSON.stringify(item?.tenantAdmin))
  out(
    `tenantAdmin 原值分布：${JSON.stringify([...new Set(adminValues)])}` +
      '（能力归一成布尔：只有 1/true/"1" 为真，null 与 "0" 都是 false）',
  )

  const firstTenantId = list[0]?.id ?? tenantId
  out(`分页事实：total=${pageSize200.data?.total}、本页 ${list.length} 条、pageSize 200 → 一家企业一页就够`)

  // ---- 固定对照：pageSize=-1 到底会怎样（能力里写了"会把 total 归零"） ----
  out()
  out('  ⚠️ pageSize=-1 对照（能力文件头第三节的结论就来自这里）：')
  const pageSizeMinus1 = await readJson(`${TENANT_LIST_PATH}?pageNo=1&pageSize=-1`)
  const minusList = Array.isArray(pageSizeMinus1.data?.list) ? pageSizeMinus1.data.list : []
  out(
    `    pageSize=200 → list ${list.length} / total ${pageSize200.data?.total}；` +
      `pageSize=-1 → list ${minusList.length} / total ${pageSizeMinus1.data?.total}`,
  )
  out(
    pageSizeMinus1.data?.total === 0 && pageSize200.data?.total !== 0
      ? '    → 证实：`-1` **没有**变成全量，反而把 total 归零了（所以能力不暴露 pageSize）'
      : '    → 与能力文件头写的"total 归零"不一致，**去看一眼**',
  )

  // ---- module-type 对照 ----
  out()
  const controlA = await moduleTypeControl('企业列表', `${TENANT_LIST_PATH}?pageNo=1&pageSize=200`)
  if (!controlA.baselineStable) moduleTypeInconclusive.push('企业列表')
  else if (!controlA.same) moduleTypeSensitive.push('企业列表')

  // -------------------------------------------------------------------------
  // B. 企业详情
  // -------------------------------------------------------------------------
  section(`B. GET /admin-api/system/tenant/get?id=${firstTenantId} （本企业开通了哪些系统）`)

  const detail = await readJson(`${TENANT_DETAIL_PATH}?id=${firstTenantId}`)
  const detailKeys = Object.keys(detail.data ?? {})
  out(`字节 ${detail.bytes} / 耗时 ${detail.elapsedMs} ms / 字段 ${detailKeys.length} 个`)
  out(`字段全集：${JSON.stringify(detailKeys)}`)
  out(`useSystem=${JSON.stringify(detail.data?.useSystem)}`)
  out(`expireTime=${JSON.stringify(detail.data?.expireTime)} / accountCount=${JSON.stringify(detail.data?.accountCount)}`)
  out(`contactMobile 存在？${'contactMobile' in (detail.data ?? {})}（能力裁掉它 —— 只报存在性，不打印值）`)

  out()
  const controlB = await moduleTypeControl('企业详情', `${TENANT_DETAIL_PATH}?id=${firstTenantId}`)
  if (!controlB.baselineStable) moduleTypeInconclusive.push('企业详情')
  else if (!controlB.same) moduleTypeSensitive.push('企业详情')

  // -------------------------------------------------------------------------
  // 汇总
  // -------------------------------------------------------------------------
  section('汇总')
  out(`module-type 敏感（基线稳且带/不带不同）：${moduleTypeSensitive.length ? moduleTypeSensitive.join('、') : '（无）'}`)
  out(`module-type 对照无效（基线自己在动）：${moduleTypeInconclusive.length ? moduleTypeInconclusive.join('、') : '（无）'}`)
  out(`本次共发出 ${GET_COUNT} 次只读 GET，**没有**任何写操作（POST/PUT/DELETE 一个都没有）`)
} catch (error) {
  out()
  out(`**冒烟失败**：${error instanceof Error ? error.message : String(error)}`)
  out(`（失败前已发出 ${GET_COUNT} 次只读 GET）`)
  process.exit(1)
}
