#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次考勤档案（只读列表页，`/dashboard/attendance/attendance-archive-sheet/list`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 先构建：pnpm build
 * 再运行：smoke/with-portal-token.sh node smoke/read-attendance-archive-sheet.mjs
 *
 * **只做读操作**。这一页上有一个"取消归档"的入口，它是写（而且走的是 GET），本脚本不碰。
 *
 * 这个脚本除了"能查到数据"，还做一件基准回归的活：把 SDK 真正发出去的 URL 打出来，
 * 好和 `baseline/attendance-archive-sheet.browser.json` 里浏览器发的那条逐字段对。
 * 做法是包一层 adapter 记录 `config.url`——`src/http/client.ts` 在发出前已经把
 * params 用 qs 序列化进 url 了，所以这里看到的就是最终形态。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-attendance-archive-sheet.mjs\n',
  )
  process.exit(1)
}

const PAGE = '/dashboard/attendance/attendance-archive-sheet/list'

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
})

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
  const page = await sdk.attendanceArchive.list({ pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `① 列表（无筛选）：共 ${page.total} 条，本页 ${page.list.length} 条\n` +
      `   ${strip(sent[0])}\n`,
  )
  for (const row of page.list.slice(0, 3)) {
    process.stdout.write(
      `   #${row.id} ${row.departmentName ?? '-'} / ${row.organizationName ?? '-'} / ${row.year}-${row.month} / ${row.userCount ?? '-'} 人\n`,
    )
  }
} catch (error) {
  process.stderr.write(`\n列表调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}

// 带月份：顺带确认 YYYY-MM 这个格式后端认（页面月份选择器发出来的就是这个形状）
try {
  const month = await sdk.attendanceArchive.list({ yearMonth: '2026-08', pageNo: 1, pageSize: 1 })
  process.stdout.write(
    `\n② 列表（yearMonth=2026-08）：共 ${month.total} 条\n` +
      `   ${strip(sent[sent.length - 1])}\n`,
  )
} catch (error) {
  process.stderr.write(`\n按月份查询失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// 候选来源：两个 type 各数一次，看长选项参数到底有多长
for (const [type, label] of [[1, '部门'], [2, '班组']]) {
  try {
    const all = await sdk.attendanceArchive.searchOrganizations({ keyword: '办公室', type, limit: 5 })
    process.stdout.write(
      `\n③ ${label}（type=${type}）：全量 ${all.total} 条，名称含「办公室」的 ${all.matched} 条，返回 ${all.list.length} 条\n` +
        `   ${strip(sent[sent.length - 1])}\n`,
    )
    for (const item of all.list) process.stdout.write(`   #${item.id} ${item.name}\n`)
  } catch (error) {
    process.stderr.write(`\n${label}候选查询失败：${error?.message || String(error)}\n`)
    process.exit(1)
  }
}

// 无关键字必须被拒（长选项参数的规矩，设计 D6）—— 这条不该发请求
const before = sent.length
await sdk.attendanceArchive.searchOrganizations({ type: 2 }).then(
  () => process.stderr.write('\n✗ 无关键字竟然通过了（设计 D6 被绕过）\n'),
  (error) => process.stdout.write(`\n④ 无关键字被拒（未发请求：${sent.length === before}）：${error.message.slice(0, 40)}…\n`),
)
