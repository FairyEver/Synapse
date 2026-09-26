#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次「班次管理」（`/dashboard/attendance/attendance-shift/list`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-attendance-shift.mjs
 *
 * **只做读操作。** 这一页的写链路（新建 / 修改 / 删除）在另一个脚本里：
 * `smoke/attendance-shift-crud.mjs` —— 它会真的建记录，所以单独一份、单独跑。
 *
 * ## 为什么这个脚本从 `../src/` 直接 import 能力，而不是从 `dist/index.js` 走门面
 *
 * 门面（`sdk.attendanceShift`）要靠**派单方接线**才有 —— 本页的能力文件
 * （`src/capabilities/attendance-shift.ts`）在本次任务里**刻意没有**注册进
 * `src/capabilities/index.ts` 与 `src/capabilities/invoke.ts`。所以这里手工构造
 * `request`（就是门面内部用的那个 `sdk.call(页面路径, …)`），能力实现仍是同一份。
 * 接线之后可以把这一段换成 `sdk.attendanceShift.list(...)`。
 *
 * Node 22.18+ 默认开启类型擦除（type stripping），所以 `.ts` 能直接在 .mjs 里 import；
 * 本文件只 import 值，`import type` 会被整句擦掉、不参与模块解析。
 * 会看到一句 ExperimentalWarning，属正常。
 *
 * 除了"能查到数据"，还做一件基准回归的活：把 SDK 真正发出去的 URL 打出来，
 * 好和 `baseline/attendance-shift.browser.json` 里浏览器发的那几条逐字段对。
 * 做法是包一层 adapter 记录 `config.url`——`src/http/client.ts` 在发出前已经把
 * params 用 qs 序列化进 url 了，所以这里看到的就是最终形态。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'
import {
  ATTENDANCE_SHIFT_PAGE_PATH,
  createAttendanceShiftCapability,
} from '../src/capabilities/attendance-shift.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-attendance-shift.mjs\n',
  )
  process.exit(1)
}

const PAGE = ATTENDANCE_SHIFT_PAGE_PATH

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
})

/** 手工接线：能力实现与门面用的是同一个 `call`（见文件头） */
const shift = createAttendanceShiftCapability((config) => sdk.call(PAGE, config))

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

// ① 列表（无筛选）—— 与基准第 1 条逐字段对
let firstRow
try {
  const page = await shift.list({ pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `① 列表（无筛选）：共 ${page.total} 条，本页 ${page.list.length} 条\n` +
      `   ${strip(sent[0])}\n`,
  )
  for (const row of page.list.slice(0, 5)) {
    process.stdout.write(
      `   #${row.id} ${row.name ?? '-'} / ${row.morningStartTime ?? '-'}~${row.morningEndTime ?? '-'} / ` +
        `${row.afternoonStartTime ?? '-'}~${row.afternoonEndTime ?? '-'} / isDel=${JSON.stringify(row.isDel ?? null)}\n`,
    )
  }
  firstRow = page.list[0]
} catch (error) {
  process.stderr.write(`\n列表调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}

// ② 按名称模糊查 —— 与基准第 2 条逐字段对（name 落在 orderField 之后、pageNo 之前）
try {
  const keyword = firstRow?.name ? String(firstRow.name).slice(0, 1) : '班'
  const filtered = await shift.list({ name: keyword, pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `\n② 列表（name=${keyword}，模糊）：共 ${filtered.total} 条，本页 ${filtered.list.length} 条\n` +
      `   ${strip(sent[sent.length - 1])}\n`,
  )
  process.stdout.write(
    `   → 名称里都含「${keyword}」：` +
      `${filtered.list.every((row) => String(row.name ?? '').includes(keyword))}\n`,
  )
} catch (error) {
  process.stderr.write(`\n带筛选的列表调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// ③ 详情 —— 这条**没有浏览器基准**（编辑页走 bridge，不按 id 取详情），只验证接口通、字段齐
try {
  const id = firstRow?.id
  const one = await shift.get(id)
  process.stdout.write(
    `\n③ 详情（id=${id}）：${one.name ?? '-'} / ${one.morningStartTime ?? '-'}~${one.morningEndTime ?? '-'} / ` +
      `${one.afternoonStartTime ?? '-'}~${one.afternoonEndTime ?? '-'}\n` +
      `   ${strip(sent[sent.length - 1])}\n` +
      `   字段齐不齐：name=${one.name !== undefined} 四个时间=${[one.morningStartTime, one.morningEndTime, one.afternoonStartTime, one.afternoonEndTime].every((v) => typeof v === 'string')} id 与列表一致=${String(one.id) === String(id)}\n`,
  )
} catch (error) {
  process.stderr.write(`\n详情调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// ④ status 不属于这一页：硬传必须被拒，且不发请求
const before = sent.length
await shift.list({ status: 1, pageNo: 1, pageSize: 1 }).then(
  () => process.stderr.write('\n✗ 硬传 status 竟然通过了（这一页的契约被绕过）\n'),
  (error) =>
    process.stdout.write(
      `\n④ 硬传 status 被拒（未发请求：${sent.length === before}）：${error.message.slice(0, 48)}…\n`,
    ),
)

// ⑤ 时间格式挡在本地：不合法时一个请求都不发（写能力才用得上，这里只证明拦截真的存在）
const beforeTime = sent.length
const bad = await shift
  .create({ name: 'SDK-TEST-不该发出去', morningStartTime: '8:00', morningEndTime: '11:30:00', afternoonStartTime: '13:00:00', afternoonEndTime: '17:00:00' })
  .then(() => 'PASSED', (error) => error.message)
process.stdout.write(
  `\n⑤ 非法时间格式 '8:00' 被本地挡下（未发请求：${sent.length === beforeTime}）：${String(bad).slice(0, 44)}…\n`,
)
if (bad === 'PASSED') {
  process.stderr.write('✗ 非法格式竟然通过了本地校验\n')
  process.exit(1)
}
