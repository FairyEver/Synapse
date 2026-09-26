#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次「排班管理」（`/dashboard/attendance/attendance-team/list`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-attendance-team.mjs
 *
 * **只做读操作。** 这一页的写链路（建组 / 改组 / 排班 / 删组）在另一个脚本里：
 * `smoke/attendance-team-crud.mjs` —— 它会真的建记录、真排班，所以单独一份、单独跑。
 *
 * ## 为什么这个脚本从 `../src/` 直接 import 能力，而不是从 `dist/index.js` 走门面
 *
 * 门面（`sdk.attendanceTeam`）要靠**派单方接线**才有 —— 本页的能力文件
 * （`src/capabilities/attendance-team.ts`）在本次任务里**刻意没有**注册进
 * `src/capabilities/index.ts` 与 `src/capabilities/invoke.ts`。所以这里手工构造
 * `request`（就是门面内部用的那个 `sdk.call(页面路径, …)`），能力实现仍是同一份。
 * 接线之后可以把这一段换成 `sdk.attendanceTeam.list(...)`。
 *
 * Node 22.18+ 默认开启类型擦除（type stripping），所以 `.ts` 能直接在 .mjs 里 import；
 * 本文件只 import 值，`import type` 会被整句擦掉、不参与模块解析。
 * 会看到一句 ExperimentalWarning，属正常。
 *
 * 除了"能查到数据"，还做一件基准回归的活：把 SDK 真正发出去的 URL 打出来，
 * 好和 `baseline/attendance-team.browser.json` 里浏览器发的那几条逐字段对。
 * 做法是包一层 adapter 记录 `config.url`——`src/http/client.ts` 在发出前已经把
 * params 用 qs 序列化进 url 了，所以这里看到的就是最终形态。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'
import {
  ATTENDANCE_TEAM_PAGE_PATH,
  createAttendanceTeamCapability,
} from '../src/capabilities/attendance-team.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-attendance-team.mjs\n',
  )
  process.exit(1)
}

const PAGE = ATTENDANCE_TEAM_PAGE_PATH

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
})

/** 手工接线：能力实现与门面用的是同一个 `call`（见文件头） */
const team = createAttendanceTeamCapability((config) => sdk.call(PAGE, config))

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
const strip = (url) => url.replace(/([^&]*_t=)\d+/, '$1<ts>')

// ① 列表（无筛选）—— 与基准第 1 条逐字段对
let firstRow
try {
  const page = await team.list({ pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `① 列表（无筛选）：共 ${page.total} 条，本页 ${page.list.length} 条\n` +
      `   ${strip(sent[0])}\n`,
  )
  for (const row of page.list.slice(0, 5)) {
    process.stdout.write(
      `   #${row.id} ${row.name ?? '-'} / type=${row.type ?? '-'} / shiftId=${row.shiftId ?? '-'} / ` +
        `shiftName=${row.shiftName ?? '-'} / isDel=${JSON.stringify(row.isDel ?? null)}\n`,
    )
  }
  firstRow = page.list[0]
} catch (error) {
  process.stderr.write(`\n列表调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}

// ② 按名称 + 类型模糊查 —— 与基准第 2 条逐字段对（name、type 落在 orderField 之后、pageNo 之前）
try {
  const keyword = firstRow?.name ? String(firstRow.name).slice(0, 1) : '考勤'
  const filtered = await team.list({ name: keyword, type: 1, pageNo: 1, pageSize: 5 })
  process.stdout.write(
    `\n② 列表（name=${keyword} & type=1）：共 ${filtered.total} 条，本页 ${filtered.list.length} 条\n` +
      `   ${strip(sent[sent.length - 1])}\n`,
  )
  process.stdout.write(
    `   → 名称里都含「${keyword}」且 type 都是 1：` +
      `${filtered.list.every((row) => String(row.name ?? '').includes(keyword) && row.type === 1)}\n`,
  )
} catch (error) {
  process.stderr.write(`\n带筛选的列表调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// ③ 详情 —— 基准第 4 条（编辑页 customLoad 打的就是它）；比列表多一个 workShift
try {
  const id = firstRow?.id
  const one = await team.get(id)
  process.stdout.write(
    `\n③ 详情（id=${id}）：${one.name ?? '-'} / type=${one.type ?? '-'} / shiftId=${one.shiftId ?? '-'}\n` +
      `   ${strip(sent[sent.length - 1])}\n` +
      `   字段齐不齐：id 与列表一致=${String(one.id) === String(id)} ` +
      `workShift 非空=${one.workShift !== null && one.workShift !== undefined} ` +
      `shiftName=${JSON.stringify(one.shiftName ?? null)}\n`,
  )
} catch (error) {
  process.stderr.write(`\n详情调用失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// ④ 读排班 —— 基准第 7 条。**只读**，不碰任何人的排班
try {
  const id = firstRow?.id
  const schedule = await team.scheduleGet(id)
  const members = schedule.hrGroupUserRelEntityList
  process.stdout.write(
    `\n④ 该组的排班（groupId=${id}）：${strip(sent[sent.length - 1])}\n` +
      `   startDate=${JSON.stringify(schedule.startDate ?? null)} / type=${schedule.type ?? '-'} / ` +
      `成员数=${members === null || members === undefined ? 'null（不是空数组）' : members.length}\n`,
  )
  for (const member of (members ?? []).slice(0, 6)) {
    process.stdout.write(
      `   type=${member.type} ${member.name ?? '-'} paramsId=${member.paramsId ?? '-'} ` +
        `staffCode=${JSON.stringify(member.staffCode ?? null)} endDate=${member.endDate ?? '-'}\n`,
    )
  }
} catch (error) {
  process.stderr.write(`\n排班读取失败：${error?.message || String(error)}\n`)
  process.exit(1)
}

// ⑤ 本地校验真的挡得住：非法日期 / 缺 shiftId 时**一个请求都不发**
const before = sent.length
const badDate = await team
  .scheduleSave({ groupId: firstRow?.id ?? '1', startDate: '2026/09/01' })
  .then(() => 'PASSED', (error) => error.message)
process.stdout.write(
  `\n⑤ 非法日期 '2026/09/01' 被本地挡下（未发请求：${sent.length === before}）：${String(badDate).slice(0, 44)}…\n`,
)
if (badDate === 'PASSED') {
  process.stderr.write('✗ 非法日期竟然通过了本地校验\n')
  process.exit(1)
}

const beforeShift = sent.length
const noShift = await team
  .create({ name: 'SDK-TEST-不该发出去', type: 1 })
  .then(() => 'PASSED', (error) => error.message)
process.stdout.write(
  `\n⑥ 缺班次被本地挡下（未发请求：${sent.length === beforeShift}）：${String(noShift).slice(0, 44)}…\n`,
)
if (noShift === 'PASSED') {
  process.stderr.write('✗ 缺班次竟然通过了本地校验\n')
  process.exit(1)
}

process.stdout.write('\n全部读操作完成（本脚本没有发出任何写请求）\n')
