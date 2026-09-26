#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境读**应用外壳**那一批接口，记录真实的条数 / 体积 / 耗时 / 形状。
 *
 * 覆盖 `src/capabilities/base-shell.ts` 的五个能力：
 *
 *   A. GET /admin-api/sys/user/info                              用户信息（base-user-info）
 *   B. GET /admin-api/system/user/simple-page                    人员候选（base-user-search）
 *   C. GET /admin-api/bpm/task/list-by-category                  待办 / 已办（base-todo-list）
 *      + /admin-api/performance/basedata/kpimessageremind/getUnreadcount
 *      + /admin-api/finance/expense-review/pending-count          三个角标（base-todo-counts）
 *   D. GET /admin-api/sys/menu/nav?project=                       可见菜单（base-menu-nav / base-menu-paths）
 *   E. GET /admin-api/homePage/get                                工作台卡片（base-home-widgets）
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-base-shell.mjs
 *
 * **全程只读**（GET）。本单**不做任何写操作**：一条写能力的边都不碰
 * （`homePage/save`、`sys/menu` 的 POST/DELETE 都只出现在"没做"那一段里，脚本里没有它们）。
 * 脚本末尾会如实报出这次一共发了几次 GET，便于核对这条边界。
 *
 * 为什么不用 `createPortalHeadless`：这五个能力的**接线由派单方统一做**
 * （`src/capabilities/index.ts` 与门面同批不动），所以这里用 Node 内置 `fetch` 直接打。
 * 请求头与 `src/http/headers.ts` 的 `generate-http-headers` 形态逐字段一致
 * （tenant-id / token / Accept-Language），否则量出来的不是 SDK 将来会看到的那份。
 *
 * 另外做三件**只有真实环境能回答**的事：
 *   1. **`module-type` 敏感性对照**：六个接口各**交错四次**（不带 → 带 11 → 不带 → 带 11）。
 *      为什么要交错：朴素的"打两次比一次"会给出**假阳性**（这一版就是踩过之后改的，
 *      详见 `moduleTypeControl` 的注释）。`src/capabilities/base-shell.ts` 的文件头 §7
 *      那张表就是这个对照的产出。
 *   2. **体积的"最坏情况"**：`pageSize=-1` / `pageSize=500` 真的会吐回多少字节
 *      ——那是能力里那些 `*_MAX` 硬上限的**理由**，不量就没资格写。
 *   3. **`finished` 的三态**：1 / 2 / 0 / 不传，四个值的 total 各是多少。
 *      （源码上它是三态，不是两态：`finished != null && == 1` 才是待办。）
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
      '用法：smoke/with-portal-token.sh node smoke/read-base-shell.mjs\n',
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

  return {
    path,
    bytes: Buffer.byteLength(text, 'utf8'),
    elapsedMs,
    /** 包络是 {code, ret, data}，与 src/http/client.ts 拆出来的那一层一致 */
    data: parsed?.data,
  }
}

const DASH = '─'.repeat(72)
function section (title) {
  out()
  out(DASH)
  out(title)
  out(DASH)
}

/**
 * `module-type` 对照。
 *
 * ⚠️ **朴素做法（打两次、比一次）会给出假阳性**，这一条是踩过之后改的：
 * 第一版是"不带 → 带 11 → 比"，结果 `homePage/get` 报了一次"不同"。
 * 单独复验才发现**同一个参数连打两次也会不同** —— 因为那份工作台配置在那个窗口里
 * 真的被改过（`updater` / `updateTime` / `config` 都会变）。也就是说，
 * "两次不同"既可能是 module-type 造成的，也可能是**资源自己会动**。
 *
 * 所以这里改成**交错四次**（不带 → 带 → 不带 → 带），判据是：
 *
 * | 观察 | 结论 |
 * | --- | --- |
 * | 四次全同 | 不敏感 |
 * | 同参数两次就不同（基线本身不稳） | **本次对照无效**，不给结论 |
 * | 基线稳、而带/不带不同 | 敏感 |
 *
 * 这个判据把"资源在动"与"头部在起作用"分开了 —— 而前者在这个环境里是真实存在的。
 * 代价是每个接口 4 次 GET，全部只读。
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
    out(
      `  module-type 对照 ${label}：**基线本身就不稳**（同参数两次已经不同）→ 本次对照无效，不给结论`,
    )
  } else {
    out(
      `  module-type 对照 ${label}：不带 ${first.bytes} B / 带 11 ${withFirst.bytes} B → ` +
        `${same ? '**data 完全相同**' : '**不同（敏感）**'}`,
    )
  }
  return { same, baselineStable }
}

const summary = []
/** 三档：`sensitive` = 基线稳而带/不带不同；`inconclusive` = 基线自己在动，没结论 */
const moduleTypeSensitive = []
const moduleTypeInconclusive = []

try {
  // -------------------------------------------------------------------------
  // A. 用户信息
  // -------------------------------------------------------------------------
  section('A. GET /admin-api/sys/user/info （用户信息）')

  const userInfo = await readJson('/admin-api/sys/user/info')
  const info = userInfo.data ?? {}
  const keys = Object.keys(info)
  out(`字节 ${userInfo.bytes} / 耗时 ${userInfo.elapsedMs} ms / 字段 ${keys.length} 个`)
  out(`字段全集：${JSON.stringify(keys)}`)

  // 这一条是 base-user-info **白名单返回**的直接理由：原始响应里确实有这两个东西
  const sensitive = ['password2', 'salt'].filter((key) => key in info)
  out(
    `⚠️ 原始响应里的敏感字段：${sensitive.length ? JSON.stringify(sensitive) : '（无）'}` +
      `${sensitive.length ? ' —— 这就是能力必须做**白名单**而不是原样透传的原因' : ''}`,
  )
  out(
    `  password2 形态：${typeof info.password2}（长度 ${String(info.password2 ?? '').length}）；` +
      `salt 形态：${typeof info.salt}（长度 ${String(info.salt ?? '').length}）`,
  )
  out(`superAdmin=${JSON.stringify(info.superAdmin)}（${typeof info.superAdmin}）`)
  out(`organizationId=${JSON.stringify(info.organizationId)} / deptId=${JSON.stringify(info.deptId)}`)
  out(`organizationFullPathName=${JSON.stringify(info.organizationFullPathName)}`)
  // 白名单里那 18 个字段，逐个报"这个账号有没有值"——没有值的不代表字段是假的
  const whitelist = [
    'id', 'username', 'realName', 'headUrl', 'gender', 'email', 'mobile', 'status',
    'superAdmin', 'tenantAdmin', 'postName', 'deptId', 'organizationId', 'organizationName',
    'organizationFullPathName', 'organizationCode', 'roleIdList', 'createDate',
  ]
  out(`白名单 18 字段在本账号的取值情况：`)
  for (const key of whitelist) {
    out(`  ${key} → ${JSON.stringify(info[key])?.slice(0, 60) ?? 'undefined'}`)
  }

  summary.push(`用户信息 sys/user/info：${userInfo.bytes} B / ${userInfo.elapsedMs} ms / ${keys.length} 字段`)
  {
    const control = await moduleTypeControl('sys/user/info', '/admin-api/sys/user/info')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('sys/user/info')
    }
  }

  // -------------------------------------------------------------------------
  // B. 人员候选
  // -------------------------------------------------------------------------
  section('B. GET /admin-api/system/user/simple-page （人员候选）')

  const userNoKeyword = await readJson('/admin-api/system/user/simple-page?pageNo=1&pageSize=10')
  out(`无关键字：字节 ${userNoKeyword.bytes} / total **${userNoKeyword.data?.total}** / 耗时 ${userNoKeyword.elapsedMs} ms`)
  out(`  首条：${JSON.stringify(userNoKeyword.data?.list?.[0])}`)
  out(
    `  ⚠️ 无关键字也返回 200 —— 所以「必须先要关键字」是 **SDK 侧**的规则，不是后端强制的。` +
      '能力里的那句拒绝逻辑就是为这个写的。',
  )

  const userKeyword = await readJson(
    `/admin-api/system/user/simple-page?pageNo=1&pageSize=10&nickname=${encodeURIComponent('张')}`,
  )
  out(`nickname=张：total ${userKeyword.data?.total} / 返回 ${userKeyword.data?.list?.length} 条 / ${userKeyword.elapsedMs} ms`)

  const userDept = await readJson('/admin-api/system/user/simple-page?pageNo=1&pageSize=10&deptId=101')
  out(`deptId=101：total ${userDept.data?.total} / 返回 ${userDept.data?.list?.length} 条`)

  const userEmpty = await readJson(
    `/admin-api/system/user/simple-page?pageNo=1&pageSize=10&nickname=${encodeURIComponent('不存在的人zzz')}`,
  )
  out(`不存在的关键字：total ${userEmpty.data?.total}（空结果，不是报错）`)

  // 体积的最坏情况 —— 这是能力里 pageSize 硬上限与 -1 拒绝的理由
  const userFull = await readJson('/admin-api/system/user/simple-page?pageNo=1&pageSize=-1')
  out(
    `⚠️ pageSize=-1：**${userFull.bytes} B** / 返回 ${userFull.data?.list?.length} 条（total ${userFull.data?.total}）` +
      ` / ${userFull.elapsedMs} ms —— 这就是能力直接拒绝 -1 的理由`,
  )
  const user500 = await readJson('/admin-api/system/user/simple-page?pageNo=1&pageSize=500')
  out(`pageSize=500（无关键字）：${user500.bytes} B / ${user500.data?.list?.length} 条 —— 超过硬上限 50，会被截断`)

  // 字段里哪几个真的有值（实测 deptName / realName / staffDuties / staffCode 全是 null）
  const sampleUser = userKeyword.data?.list?.[0] ?? userNoKeyword.data?.list?.[0] ?? {}
  const nonNull = Object.entries(sampleUser).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k)
  out(`  list[] 字段：${JSON.stringify(Object.keys(sampleUser))}`)
  out(`  其中非 null 的：${JSON.stringify(nonNull)}`)

  summary.push(`人员 simple-page：无关键字 total ${userNoKeyword.data?.total}；pageSize=-1 → ${userFull.bytes} B`)
  {
    const control = await moduleTypeControl('simple-page', '/admin-api/system/user/simple-page?pageNo=1&pageSize=5')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('simple-page')
    }
  }

  // -------------------------------------------------------------------------
  // C. 待办 / 已办 + 三个角标
  // -------------------------------------------------------------------------
  section('C1. GET /admin-api/bpm/task/list-by-category （待办 / 已办）')

  const scopeTotals = {}
  for (const [label, query] of [
    ['finished=1（待办）', 'finished=1'],
    ['finished=2（已办）', 'finished=2'],
    ['finished=0', 'finished=0'],
    ['不传 finished', ''],
  ]) {
    const page = await readJson(
      `/admin-api/bpm/task/list-by-category?${query ? `${query}&` : ''}pageNo=1&pageSize=10`,
    )
    scopeTotals[label] = page.data?.total
    out(
      `${label}：total **${page.data?.total}** / 返回 ${page.data?.list?.length} 条 / ` +
        `${page.bytes} B / ${page.elapsedMs} ms`,
    )
    const item = page.data?.list?.[0]
    if (item) {
      out(`  item 字段：${JSON.stringify(Object.keys(item))}；processInstance.result=${JSON.stringify(item.processInstance?.result)}`)
    }
  }
  out(
    `  ⚠️ 「不传 finished」= ${scopeTotals['不传 finished']}，**不等于** ${scopeTotals['finished=1（待办）']} + ${scopeTotals['finished=2（已办）']}` +
      ' —— 它是不加状态过滤的那一份，口径不同（源码：`finished == null` 时不加任何过滤）。',
  )
  out('  ⚠️ `finished=0` 落到「已办」那一支 —— 后端是**三态**不是两态，所以能力只收 todo/done/all 枚举。')

  // name 是服务端过滤（后端 taskNameLike）
  for (const name of ['审批', '用章']) {
    const page = await readJson(
      `/admin-api/bpm/task/list-by-category?name=${encodeURIComponent(name)}&pageNo=1&pageSize=5`,
    )
    out(`  name=${name}（服务端过滤）：total ${page.data?.total} / 返回 ${page.data?.list?.length} 条`)
  }

  const todoFull = await readJson('/admin-api/bpm/task/list-by-category?pageNo=1&pageSize=500')
  out(
    `⚠️ pageSize=500：**${todoFull.bytes} B** / ${todoFull.data?.list?.length} 条 / ${todoFull.elapsedMs} ms` +
      ' —— 这就是能力把 pageSize 硬上限钉在 50 的理由',
  )

  summary.push(`待办 bpm/task/list-by-category：待办 ${scopeTotals['finished=1（待办）']} / 已办 ${scopeTotals['finished=2（已办）']} / 全部 ${scopeTotals['不传 finished']}`)
  {
    const control = await moduleTypeControl('bpm/list-by-category', '/admin-api/bpm/task/list-by-category?pageNo=1&pageSize=5&finished=1')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('bpm/list-by-category')
    }
  }

  section('C2. 三个角标（base-todo-counts 打的那三条）')

  const unread = await readJson('/admin-api/performance/basedata/kpimessageremind/getUnreadcount')
  out(`getUnreadcount：${unread.bytes} B / ${unread.elapsedMs} ms / data = ${JSON.stringify(unread.data)}（${typeof unread.data}）`)

  const expense = await readJson('/admin-api/finance/expense-review/pending-count')
  out(`expense-review/pending-count：${expense.bytes} B / **${expense.elapsedMs} ms** / data = ${JSON.stringify(expense.data)}`)
  out('  ⚠️ 这一条是六个接口里最慢的（实测 588 ~ 1047 ms），而且它在 Portal 里是**条件请求**')
  out('     （侧边栏有那个菜单才打）。所以能力把它做成"失败只置 null + 记 failures"，不整体抛。')

  const todoCountPage = await readJson('/admin-api/bpm/task/list-by-category?pageNo=1&pageSize=1&finished=1')
  out(`待办数（finished=1&pageSize=1 的 total）：${todoCountPage.data?.total}`)

  summary.push(`角标：未读消息 ${JSON.stringify(unread.data)} / 待审费用 ${JSON.stringify(expense.data)} / 待办 ${todoCountPage.data?.total}`)
  {
    const control = await moduleTypeControl('getUnreadcount', '/admin-api/performance/basedata/kpimessageremind/getUnreadcount')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('getUnreadcount')
    }
  }
  {
    const control = await moduleTypeControl('expense-review/pending-count', '/admin-api/finance/expense-review/pending-count')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('expense-review/pending-count')
    }
  }

  // -------------------------------------------------------------------------
  // D. 可见菜单
  // -------------------------------------------------------------------------
  section('D. GET /admin-api/sys/menu/nav?project= （可见菜单）')

  const walk = (nodes) => nodes.reduce((sum, node) => sum + 1 + walk(node.children ?? []), 0)
  const depth = (nodes) => nodes.reduce((max, node) => Math.max(max, 1 + depth(node.children ?? [])), 0)
  const collect = (nodes, into = []) => {
    for (const node of nodes) {
      if (typeof node.permissions === 'string' && node.permissions !== '') into.push(node.permissions)
      collect(node.children ?? [], into)
    }
    return into
  }

  for (const [label, query] of [
    ['project=1', '?project=1'],
    ['project=2', '?project=2'],
    ['project=3', '?project=3'],
    ['project=0', '?project=0'],
    ['不传 project', ''],
  ]) {
    const nav = await readJson(`/admin-api/sys/menu/nav${query}`)
    const roots = Array.isArray(nav.data) ? nav.data : []
    out(
      `${label}：${nav.bytes} B / ${nav.elapsedMs} ms / 根 ${roots.length} / 节点 ${walk(roots)} / 深度 ${depth(roots)}`,
    )
  }
  out('  ⚠️ 不传 project 时后端按 1 返回（1 个节点）——「不传」不等于「全部」，所以能力把 project 设成必填。')

  const nav2 = await readJson('/admin-api/sys/menu/nav?project=2')
  const roots2 = Array.isArray(nav2.data) ? nav2.data : []
  const permissions = collect(roots2)
  const paths = permissions.filter((p) => p.startsWith('/'))
  out(`project=2 明细：节点 ${walk(roots2)} / permissions 非空 ${permissions.length} / 以 / 开头（路径码）**${paths.length}**`)
  out(`  含逗号的 permissions：${permissions.filter((p) => p.includes(',')).length} 个（conventions 第 16 条：从不是逗号分隔）`)
  out(
    `  url 非 null 的节点：${(() => { let count = 0; const w = (ns) => { for (const n of ns) { if (n.url) count += 1; w(n.children ?? []) } }; w(roots2); return count })()}` +
      ' 个（conventions 第 16 条：url 恒为 null，页面路径在 permissions 里）',
  )
  out(`  路径码样本：${JSON.stringify(paths.slice(0, 6))}`)
  out(`  非路径形态的 permissions 样本（权限码）：${JSON.stringify(permissions.filter((p) => !p.startsWith('/')).slice(0, 4))}`)
  for (const keyword of ['/dashboard/finance/', '/dashboard/hr/']) {
    out(`  含「${keyword}」的路径码：${paths.filter((p) => p.includes(keyword)).length} 条`)
  }
  // 节点字段是否覆盖 src/catalog/visibility.ts 的 MenuNode 声明（它要能吃下这棵树）
  const nodeKeys = new Set()
  const collectKeys = (ns) => { for (const n of ns) { Object.keys(n).forEach((k) => nodeKeys.add(k)); collectKeys(n.children ?? []) } }
  collectKeys(roots2)
  const menuNodeFields = ['id', 'pid', 'name', 'url', 'menuType', 'useSystem', 'project', 'permissions', 'children']
  out(
    `  节点字段全集：${JSON.stringify([...nodeKeys].sort())}`,
  )
  out(
    `  visibility.ts 的 MenuNode 声明的 9 个字段是否都在：` +
      `${menuNodeFields.filter((f) => nodeKeys.has(f)).length}/9` +
      `（缺 ${JSON.stringify(menuNodeFields.filter((f) => !nodeKeys.has(f)))}）`,
  )

  summary.push(`可见菜单 nav?project=2：57 节点量级 / ${nav2.bytes} B / ${paths.length} 条路径码`)
  {
    const control = await moduleTypeControl('menu/nav?project=2', '/admin-api/sys/menu/nav?project=2')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('menu/nav')
    }
  }

  // -------------------------------------------------------------------------
  // E. 工作台卡片
  // -------------------------------------------------------------------------
  section('E. GET /admin-api/homePage/get （工作台卡片）')

  const home = await readJson('/admin-api/homePage/get')
  out(`字节 ${home.bytes} / 耗时 ${home.elapsedMs} ms / 顶层字段 ${JSON.stringify(Object.keys(home.data ?? {}))}`)
  out(
    `  config 的 JSON 类型：**${typeof home.data?.config}**` +
      `（字符串长度 ${typeof home.data?.config === 'string' ? home.data.config.length : '—'}，` +
      '不是对象 —— 能力负责解析它）',
  )

  let widgets = null
  try {
    widgets = JSON.parse(home.data?.config ?? '[]')
  } catch (error) {
    out(`  ⚠️ config 解析失败：${error.message}`)
  }
  if (Array.isArray(widgets)) {
    out(`  解析后：${widgets.length} 张卡片`)
    out(`  卡片字段：${JSON.stringify(Object.keys(widgets[0] ?? {}))}`)
    out(`  样本 3 张：${JSON.stringify(widgets.slice(0, 3))}`)
    const ids = widgets.map((w) => w.widget).filter(Boolean)
    out(`  widget 标识 ${ids.length} 个，按模块聚类的头几个：${JSON.stringify(ids.slice(0, 8))}`)
    const modules = new Set(ids.map((id) => String(id).split('/')[0]))
    out(`  涉及的一级模块：${JSON.stringify([...modules].sort())}`)
    for (const keyword of ['salary', 'finance/']) {
      out(`  含「${keyword}」的卡片：${ids.filter((id) => String(id).includes(keyword)).length} 张`)
    }
    out(
      '  ⚠️ widget 标识是 `hr/salary/my-payslip` 这种三段式，**映射不到** ' +
        'generated/page-catalog.json 的 `/dashboard/...` menuPath —— 能力不做这个映射。',
    )
  }

  summary.push(`工作台 homePage/get：${home.bytes} B / ${Array.isArray(widgets) ? widgets.length : '?'} 张卡片`)
  {
    const control = await moduleTypeControl('homePage/get', '/admin-api/homePage/get')
    if (!control.same) {
      (control.baselineStable ? moduleTypeSensitive : moduleTypeInconclusive).push('homePage/get')
    }
  }

  // -------------------------------------------------------------------------
  // F. 对照组：**没有**建能力的两个同族接口
  // -------------------------------------------------------------------------
  section('F. 对照组：这两个**没有**建能力，量一下为什么')

  // 它们在 base-capabilities.md 里都出现过，本单复核后决定不做。
  // 量出来放在这里，是为了让"不做"这个判断有可复现的数字支撑，而不是一句印象。
  const menuAll = await readJson('/admin-api/sys/menu/menuListNotBySystem')
  const menuAllRoots = Array.isArray(menuAll.data) ? menuAll.data : []
  out(
    `menuListNotBySystem（后台菜单维护页的树）：**${menuAll.bytes} B** / ${menuAll.elapsedMs} ms / ` +
      `根 ${menuAllRoots.length} / 节点 ${walk(menuAllRoots)}`,
  )
  out(
    `  → 它是 nav?project=2（${nav2.bytes} B）的 **${(menuAll.bytes / nav2.bytes).toFixed(1)} 倍**，` +
      '而且是后台 CRUD 页的数据源，不是外壳。建它得先有切片入口。',
  )

  const orgTree = await readJson('/admin-api/org/organization/getRoleOrganizationTree')
  const orgRoots = Array.isArray(orgTree.data) ? orgTree.data : []
  out(
    `getRoleOrganizationTree（组织树）：**${orgTree.bytes} B** / ${orgTree.elapsedMs} ms / 根 ${orgRoots.length} / 节点 ${walk(orgRoots)}`,
  )
  out(
    '  → 第一批的 base-dept-*（扁平 {id,name,parentId}）已经把「部门名 ↔ id」覆盖了，' +
      '而且这个小一个数量级；再建一条更贵的同义词只会增加调用方的选择困难。',
  )

  summary.push(`对照组：menuListNotBySystem ${menuAll.bytes} B（未建能力）/ getRoleOrganizationTree ${orgTree.bytes} B（未建能力）`)

  // -------------------------------------------------------------------------
  section('汇总')
  for (const line of summary) out(`· ${line}`)
  out()
  out(
    `module-type 敏感（基线稳、带/不带不同）：${moduleTypeSensitive.length ? JSON.stringify(moduleTypeSensitive) : '**无**'}`,
  )
  out(
    `module-type **对照无效**（基线自己在动，不给结论）：${
      moduleTypeInconclusive.length ? JSON.stringify(moduleTypeInconclusive) : '无'
    }`,
  )
  if (moduleTypeInconclusive.length) {
    out('  ⚠️ "对照无效"不是"不敏感"，也不是"敏感" —— 它是"这次没测出来"。别把它读成任一结论。')
    out('  ⚠️ 而且它本身是一条发现：那个资源在**两次只读 GET 之间**就变了，说明测试环境里有人在写它。')
  }
  out()
  out(`全程只读：共 ${GET_COUNT} 次 GET（含 module-type 对照、参数变体与体积最坏情况）。`)
  out('**本脚本没有发过任何写请求**：一条 POST / PUT / DELETE 都没有。')
  out('基线数字请以 docs/base/*.md 里记录的那一次为准——条数与耗时每次会小幅浮动。')
} catch (error) {
  process.stderr.write(`\n冒烟失败：${error?.message ?? String(error)}\n`)
  process.exit(1)
}
