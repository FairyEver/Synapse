#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次考勤统计（只读列表页，`/dashboard/attendance/attendance-sheet/list`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-attendance-statistics.mjs
 *
 * **只做读操作**。这一页的行尾有「归档」（GET 改数据）与「删除」（DELETE）两个写入口，
 * 本脚本一个都不碰。
 *
 * ## 为什么这个脚本从 `../src/` 直接 import 能力，而不是从 `dist/index.js` 走门面
 *
 * 门面（`sdk.attendanceStatistics`）要靠**派单方接线**才有 —— 本页的能力文件
 * （`src/capabilities/attendance-statistics.ts`）在本次任务里**刻意没有**注册进
 * `src/capabilities/index.ts` 与 `src/capabilities/invoke.ts`。所以这里手工构造
 * `request`（就是门面内部用的那个 `sdk.call(页面路径, …)`），能力实现仍是同一份。
 * 接线之后可以把这一段换成 `sdk.attendanceStatistics.list(...)`。
 *
 * Node 22.18+ 默认开启类型擦除（type stripping），所以 `.ts` 能直接在 .mjs 里 import；
 * 本文件只 import 值，`import type` 会被整句擦掉、不参与模块解析。
 * 会看到一句 ExperimentalWarning，属正常。
 *
 * 除了"能查到数据"，还做一件基准回归的活：把 SDK 真正发出去的 URL 打出来，
 * 好和 `baseline/attendance-statistics.browser.json` 里浏览器发的那几条逐字段对。
 * 做法是包一层 adapter 记录 `config.url`——`src/http/client.ts` 在发出前已经把
 * params 用 qs 序列化进 url 了，所以这里看到的就是最终形态。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'
import {
  ATTENDANCE_STATISTICS_PAGE_PATH,
  createAttendanceStatisticsCapability,
} from '../src/capabilities/attendance-statistics.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-attendance-statistics.mjs\n',
  )
  process.exit(1)
}

const PAGE = ATTENDANCE_STATISTICS_PAGE_PATH

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
})

/** 手工接线：能力实现与门面用的是同一个 `call`（见文件头） */
const statistics = createAttendanceStatisticsCapability((config) => sdk.call(PAGE, config))

// 记录真正发出去的 URL（只读侧观测，不改请求）。
// `sdk.http.defaults.adapter` 默认是 undefined（axios 在请求时才解析适配器列表），
// 所以这里自己解析出内层适配器再包一层，不是把 undefined 包起来。
const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType === null ? '（无规则匹配，与浏览器一致：不发这个头）' : `${resolved.moduleType} ${resolved.label}`}\n\n`,
)

/** 把 _t 时间戳抹掉，便于与基准对比 */
const strip = (url) => url.replace(/([?&]_t=)\d+/, '$1<ts>')

try {
  const page = await statistics.list({ pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `① 列表（无筛选）：共 ${page.total} 条，本页 ${page.list.length} 条\n` +
      `   ${strip(sent[0])}\n`,
  )
  for (const row of page.list.slice(0, 5)) {
    process.stdout.write(
      `   #${row.id} ${row.name ?? '-'} / ${row.departmentName ?? '-'} / ${row.organizationName ?? '-'} / ` +
        `${row.userCount ?? '-'} 人 / isArchived=${JSON.stringify(row.isArchived ?? null)}\n`,
    )
  }
  // 这一页到底"筛没筛归档"：行里带 isArchived，直接看数据比看参数可靠
  const archivedRows = page.list.filter((row) => Boolean(row.isArchived)).length
  process.stdout.write(
    `   → 本页 ${page.list.length} 条里有 ${archivedRows} 条 isArchived 为真` +
      `${archivedRows > 0 ? '（说明这一页**不筛**归档状态，不是"未归档列表"）' : '（本页没出现归档行，不足以判定）'}\n`,
  )
} catch (error) {
  process.stderr.write(`\n列表调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}

// 带部门 / 班组：候选先按关键字取真的 id（不猜、也不硬编基准里那两个 id）
try {
  const dept = await sdk.attendanceArchive.searchOrganizations({ keyword: '办公室', type: 1, limit: 1 })
  const team = await sdk.attendanceArchive.searchOrganizations({ keyword: '办公室', type: 2, limit: 1 })
  const departmentId = dept.list[0]?.id
  const organizationId = team.list[0]?.id
  process.stdout.write(
    `\n② 候选（attendance-org-search）：部门「办公室」${dept.matched} 条，班组「办公室」${team.matched} 条\n` +
      `   取 departmentId=${departmentId} organizationId=${organizationId}\n`,
  )

  const filtered = await statistics.list({ departmentId, organizationId, pageNo: 1, pageSize: 2 })
  process.stdout.write(
    `   带两个筛选的列表：共 ${filtered.total} 条，本页 ${filtered.list.length} 条\n` +
      `   ${strip(sent[sent.length - 1])}\n`,
  )
} catch (error) {
  process.stderr.write(`\n带筛选的列表调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// 对照：同一后端接口、档案页那边钉死的 isArchived=1（用已接线的 attendanceArchive 走）
try {
  const archived = await sdk.attendanceArchive.list({ pageNo: 1, pageSize: 1 })
  process.stdout.write(
    `\n③ 对照（attendance-archive-sheet-list，isArchived=1）：共 ${archived.total} 条\n` +
      `   ${strip(sent[sent.length - 1])}\n`,
  )
} catch (error) {
  process.stderr.write(`\n对照调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// isArchived 不属于这一页：硬传必须被拒，且不该发请求
const before = sent.length
await statistics.list({ isArchived: 1, pageNo: 1, pageSize: 1 }).then(
  () => process.stderr.write('\n✗ 硬传 isArchived 竟然通过了（这一页的分界被绕过）\n'),
  (error) =>
    process.stdout.write(
      `\n④ 硬传 isArchived 被拒（未发请求：${sent.length === before}）：${error.message.slice(0, 48)}…\n`,
    ),
)
