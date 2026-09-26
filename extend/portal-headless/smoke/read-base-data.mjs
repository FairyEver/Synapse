#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境读三个**首屏基础数据**接口，记录它们的真实体量与形状。
 *
 *   A. GET /admin-api/system/dept/list-all-simple          部门扁平列表
 *   B. GET /admin-api/system/dict-data/grouped-list        全量字典（按 dictType 分组）
 *   C. GET /admin-api/sys/menu/permissionsNotBySystem      权限码清单
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-base-data.mjs
 *
 * **全程只读**（GET）。这三个接口本身只有 GET，本脚本不碰任何写接口。
 *
 * 为什么不用 `createPortalHeadless`：这三个能力的**接线由派单方统一做**
 * （`src/capabilities/index.ts` 与本文件同批不动），所以这里用 Node 内置 `fetch` 直接打，
 * 存在的意义是「拿到真实的条数 / 字节数 / 耗时 / 抽样」，供 `docs/base/*.md` 引用。
 * 请求头与 `src/http/headers.ts` 的 `generate-http-headers` 形态逐字段一致
 * （tenant-id / token / Accept-Language），否则量出来的东西不是 SDK 将来会看到的那份。
 *
 * 另外做两件**只有真实环境能回答**的事：
 *   1. 三个接口**带不带 `module-type` 头**返回是否不同（缓存键要不要并进 module-type）。
 *      两条都是 GET 读，不写。结论写进 docs/base/*.md。
 *   2. 字典抽样：把 `assignment_type` 的 6 个值与 `src/capabilities/assignment.ts` 里
 *      硬编码的那份快照逐条对一遍——那些快照正是「没有 base-dict-list 能力」的代价。
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
      '用法：smoke/with-portal-token.sh node smoke/read-base-data.mjs\n',
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

const summary = []

try {
  // -------------------------------------------------------------------------
  // A. 部门扁平列表
  // -------------------------------------------------------------------------
  section('A. GET /admin-api/system/dept/list-all-simple （部门，扁平）')

  const dept = await readJson('/admin-api/system/dept/list-all-simple')
  const deptList = Array.isArray(dept.data) ? dept.data : []
  out(`字节 ${dept.bytes} / 条数 ${deptList.length} / 耗时 ${dept.elapsedMs} ms`)
  out(`首条字段：${JSON.stringify(Object.keys(deptList[0] ?? {}))}`)
  out(`抽样：${JSON.stringify(deptList.slice(0, 3))}`)

  // 结构统计：父指针约定、最大直接子节点数（决定「取下级」这个入口要不要限量）
  const byParent = new Map()
  const ids = new Set(deptList.map((n) => n.id))
  for (const node of deptList) {
    const key = String(node.parentId)
    byParent.set(key, (byParent.get(key) ?? 0) + 1)
  }
  const nullParent = deptList.filter((n) => n.parentId === null || n.parentId === undefined).length
  const rank = [...byParent.entries()].sort((a, b) => b[1] - a[1])
  // 悬挂节点 = parentId 既不指向任何存在的 id、也不是根（0）
  const orphan = deptList.filter((n) => !ids.has(n.parentId) && Number(n.parentId) !== 0)
  out(
    `父指针约定：parentId 为 null/undefined 的 ${nullParent} 个；` +
      `根节点（parentId=0）${byParent.get('0') ?? 0} 个；` +
      `按 parentId 计数最多的 3 个 → ${JSON.stringify(rank.slice(0, 3))}`,
  )
  out(
    `悬挂节点（parentId 指向不存在的 id，且不是 0）${orphan.length} 个：` +
      `${JSON.stringify(orphan.slice(0, 3))}`,
  )

  // 浏览器在唯一调用点发的是 `?pageNo=-1&pageSize=-1&isCorporation=1`（"公司"下拉框），
  // 与"全部部门"不是同一份数据 —— 都要量，才能说清能力该不该复刻那三个参数
  for (const [label, query] of [
    ['isCorporation=1', '?isCorporation=1'],
    ['pageNo=-1&pageSize=-1&isCorporation=1（浏览器原样）', '?pageNo=-1&pageSize=-1&isCorporation=1'],
  ]) {
    const variant = await readJson(`/admin-api/system/dept/list-all-simple${query}`)
    const rows = Array.isArray(variant.data) ? variant.data : []
    out(`  ${label} → ${rows.length} 条（与全量 ${deptList.length} 条的差集 ${deptList.length - rows.length} 条）`)
  }

  const deptNames = deptList.map((n) => String(n.name ?? ''))
  for (const keyword of ['财务', '生产']) {
    out(`名称含「${keyword}」的：${deptNames.filter((n) => n.includes(keyword)).length} 条`)
  }

  // module-type 敏感性：带 / 不带这个头，返回是否不同（两条都只是 GET）
  const deptWithModuleType = await readJson('/admin-api/system/dept/list-all-simple', { 'module-type': '11' })
  const deptIdsWithout = new Set(deptList.map((n) => n.id))
  const deptIdsWith = new Set((Array.isArray(deptWithModuleType.data) ? deptWithModuleType.data : []).map((n) => n.id))
  const onlyWithout = [...deptIdsWithout].filter((id) => !deptIdsWith.has(id)).length
  const onlyWith = [...deptIdsWith].filter((id) => !deptIdsWithout.has(id)).length
  out(
    `module-type 敏感性：不带 ${deptIdsWithout.size} 条 / 带 11 → ${deptIdsWith.size} 条；` +
      `只在前者 ${onlyWithout} 条、只在后者 ${onlyWith} 条`,
  )

  summary.push(`部门 list-all-simple：${deptList.length} 条 / ${dept.bytes} B / ${dept.elapsedMs} ms`)

  // -------------------------------------------------------------------------
  // B. 全量字典（grouped-list）
  // -------------------------------------------------------------------------
  section('B. GET /admin-api/system/dict-data/grouped-list （字典，按 dictType 分组）')

  const dict = await readJson('/admin-api/system/dict-data/grouped-list')
  const groups = Array.isArray(dict.data) ? dict.data : []
  const entriesOf = (g) => (Array.isArray(g?.dataList) ? g.dataList : [])
  const totalEntries = groups.reduce((sum, g) => sum + entriesOf(g).length, 0)
  out(`字节 ${dict.bytes} / dictType ${groups.length} 个 / 条目合计 ${totalEntries} 条 / 耗时 ${dict.elapsedMs} ms`)

  const ranked = [...groups].sort((a, b) => entriesOf(b).length - entriesOf(a).length)
  out('条目最多的 5 个 dictType：')
  for (const g of ranked.slice(0, 5)) {
    out(`  ${g.dictType} → ${entriesOf(g).length} 条`)
  }
  out('条目最少的 3 个 dictType：')
  for (const g of ranked.slice(-3)) {
    out(`  ${g.dictType} → ${entriesOf(g).length} 条`)
  }
  const sample = ranked[0]
  out(`样本（${sample?.dictType}）首条：${JSON.stringify(entriesOf(sample)[0])}`)
  out(`字典条目字段：${JSON.stringify(Object.keys(entriesOf(sample)[0] ?? {}))}`)

  // value / id 的 JSON 类型分布（决定 SDK 是原样返回还是做转换 —— 不猜，量出来）
  const allEntries = groups.flatMap((g) => entriesOf(g))
  const countBy = (pick) => {
    const tally = new Map()
    for (const entry of allEntries) {
      const key = entry?.[pick] === null ? 'null' : typeof entry?.[pick]
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    return JSON.stringify(Object.fromEntries([...tally.entries()].sort()))
  }
  out(`value 的 JSON 类型分布：${countBy('value')}`)
  out(`id 的 JSON 类型分布：${countBy('id')}`)
  out(`label 带前导/尾随空格的条目数：${allEntries.filter((e) => String(e?.label ?? '') !== String(e?.label ?? '').trim()).length}`)

  // 与 assignment.ts 里硬编码的那份快照对一遍
  const assignmentType = groups.find((g) => g.dictType === 'assignment_type')
  const snapshot = [
    { label: '文件', value: 1 },
    { label: '图片+文字', value: 2 },
    { label: '图片', value: 3 },
    { label: '文字', value: 4 },
    { label: '视频', value: 5 },
    { label: '视频+文字', value: 6 },
  ]
  if (assignmentType === undefined) {
    out('⚠️ assignment_type 不在返回里')
  } else {
    const live = entriesOf(assignmentType)
      .map((e) => ({ label: e.label, value: Number(e.value) }))
      .sort((a, b) => a.value - b.value)
    const same = JSON.stringify(live) === JSON.stringify(snapshot)
    out(`assignment_type：线上 ${live.length} 条，与 assignment.ts 硬编码快照${same ? '一致' : '**不一致**'}`)
    if (!same) {
      out(`  线上：${JSON.stringify(live)}`)
      out(`  快照：${JSON.stringify(snapshot)}`)
    }
  }

  // 调用方最容易踩的坑：status 是全平台共用的 dictType
  const statusDict = groups.find((g) => g.dictType === 'status')
  if (statusDict !== undefined) {
    out(`status 字典：${entriesOf(statusDict).length} 条，前 3 个值 ${JSON.stringify(entriesOf(statusDict).slice(0, 3).map((e) => e.value))}`)
  }

  const dictWithModuleType = await readJson('/admin-api/system/dict-data/grouped-list', { 'module-type': '11' })
  out(
    `module-type 敏感性：不带 ${groups.length} 个 dictType / 带 11 → ` +
      `${Array.isArray(dictWithModuleType.data) ? dictWithModuleType.data.length : '?'} 个`,
  )

  summary.push(`字典 grouped-list：${groups.length} dictType / ${totalEntries} 条 / ${dict.bytes} B / ${dict.elapsedMs} ms`)

  // -------------------------------------------------------------------------
  // C. 权限码清单
  // -------------------------------------------------------------------------
  section('C. GET /admin-api/sys/menu/permissionsNotBySystem （权限码清单）')

  const permission = await readJson('/admin-api/sys/menu/permissionsNotBySystem')
  const codes = Array.isArray(permission.data) ? permission.data : []
  out(`字节 ${permission.bytes} / 权限码 ${codes.length} 条 / 耗时 ${permission.elapsedMs} ms`)
  out(`元素类型：${typeof codes[0]}；抽样：${JSON.stringify(codes.slice(0, 3))}`)

  const pageCodes = codes.filter((code) => String(code).startsWith('/'))
  const actionCodes = codes.filter((code) => !String(code).startsWith('/'))
  out(`页面路径码（以 / 开头）${pageCodes.length} 条 / 动作码 ${actionCodes.length} 条`)
  out(`页面码抽样：${JSON.stringify(pageCodes.slice(0, 3))}`)
  out(`动作码抽样：${JSON.stringify(actionCodes.slice(0, 3))}`)

  // 「这个用户能不能干这件事」——拿 SDK 能力里真实写着的权限码问它
  const probeCodes = [
    '/dashboard/base/image',
    '/dashboard/attendance/attendance-archive-sheet',
    '/dashboard/attendance/attendance-sheet',
    '/dashboard/assignment/assignment',
    '/dashboard/contract/template',
    'investment:daily:account:export',
    'supply:supplier:admittance:disable',
    '/definitely/not/a/real/permission/code',
  ]
  for (const code of probeCodes) {
    out(`  has(${JSON.stringify(code)}) → ${codes.includes(code)}`)
  }

  // 前缀查询的可行性（SDK 的 base-permission-list.searchPermissions 靠它）
  const prefixes = ['/dashboard/base/', 'investment:', 'supply:supplier:']
  for (const prefix of prefixes) {
    out(`  前缀 ${JSON.stringify(prefix)} → ${codes.filter((code) => String(code).startsWith(prefix)).length} 条`)
  }

  const permissionWithModuleType = await readJson('/admin-api/sys/menu/permissionsNotBySystem', { 'module-type': '11' })
  const withCodes = new Set(Array.isArray(permissionWithModuleType.data) ? permissionWithModuleType.data : [])
  out(
    `module-type 敏感性：不带 ${codes.length} 条 / 带 11 → ${withCodes.size} 条；` +
      `只在前者 ${codes.filter((code) => !withCodes.has(code)).length} 条、只在后者 ${[...withCodes].filter((c) => !codes.includes(c)).length} 条`,
  )

  summary.push(`权限清单 permissionsNotBySystem：${codes.length} 条 / ${permission.bytes} B / ${permission.elapsedMs} ms`)

  section('汇总')
  for (const line of summary) out(`· ${line}`)
  out()
  out(`全程只读：3 个接口共 ${GET_COUNT} 次 GET（含带 module-type 头的对照、部门参数变体、权限码抽样查询）。`)
  out('基线数字请以 docs/base/*.md 里记录的那一次为准——字典/权限的条数与耗时每次会小幅浮动。')
} catch (error) {
  process.stderr.write(`\n冒烟失败：${error?.message ?? String(error)}\n`)
  process.exit(1)
}
