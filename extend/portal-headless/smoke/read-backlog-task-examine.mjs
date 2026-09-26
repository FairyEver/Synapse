#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一次待办事项列表（只读列表页，`/dashboard/backlog/task-examine/list`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-backlog-task-examine.mjs
 *
 * `createPortalHeadless` 来自构建产物（默认仓库根的 `dist/`，用 `PORTAL_HEADLESS_BUILD=<目录>`
 * 可覆盖）；能力实现来自 `src/capabilities/backlog-task-examine.ts`（原因见下面的 import 处）。
 * 也就是说这份脚本要求 `dist/` 是**当前 src 编出来的**，否则门面与能力可能不是同一版。
 *
 * **只做读操作。** 只调 `capability.list()` 一种能力。行上的动作一概不碰：
 * 「办理 / 详情 / 跟进」跳到别的页面，「撤销审批」是弹窗且**会写**（撤回流程任务），
 * 「批量办理」跳 `/dashboard/backlog/task-examine/batch-process`。
 *
 * 这个脚本除了"能查到数据"，还做一件基准回归的活：把 SDK 真正发出去的 URL 打出来，
 * 并**逐字段与 `baseline/backlog-task-examine.browser.json` 比对**（只把一次性 `_t` 归一化）。
 * 做法是包一层 adapter 记录 `config.url`——`src/http/client.ts` 在发出前已经把 params
 * 用 qs 序列化进 url 了，所以这里看到的就是最终形态。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import axios from 'axios'

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = resolve(here, process.env.PORTAL_HEADLESS_BUILD ?? '../dist')

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-backlog-task-examine.mjs\n',
  )
  process.exit(1)
}

const { createPortalHeadless } = await import(pathToFileURL(join(buildDir, 'index.js')).href)
// 能力实现从**源码** import，不走构建产物：本页的能力文件在本次任务里刻意没有注册进
// `src/capabilities/index.ts`（接线由派单方统一做），所以 dist 里没有它。
// Node 22.18+ 默认开启类型擦除（type stripping），`.ts` 能直接在 .mjs 里 import；
// 本文件只 import 值，能力文件里的 `import type` 会被整句擦掉、不参与模块解析。
// 会看到一句 ExperimentalWarning，属正常。（与 `smoke/read-attendance-statistics.mjs` 同一做法。）
const { createBacklogTaskExamineCapability, BACKLOG_TASK_EXAMINE_PAGE_PATH } = await import(
  pathToFileURL(join(here, '../src/capabilities/backlog-task-examine.ts')).href
)

const PAGE = '/dashboard/backlog/task-examine/list'
if (BACKLOG_TASK_EXAMINE_PAGE_PATH !== PAGE) {
  process.stderr.write(`构建产物里的 pagePath 是 ${BACKLOG_TASK_EXAMINE_PAGE_PATH}，与脚本不一致\n`)
  process.exit(1)
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

// 门面上还没有接线（见能力文件头）：用公开的 sdk.call 组装一次页面上下文的请求函数，
// 这样 module-type 与 http 实例推导都还是走同一条实现，不是绕过去的。
const capability = createBacklogTaskExamineCapability((config) => sdk.call(PAGE, config))

// 记录真正发出去的 URL（只读侧观测，不改请求）
const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType === null ? '（无规则匹配，与浏览器一致：不发这个头）' : `${resolved.moduleType} ${resolved.label}`}\n` +
    `构建产物：${buildDir}\n\n`,
)

/** 去掉记录时加的 "GET " 前缀、host，并把 _t 时间戳归一化，便于与基准对比 */
const strip = (line) =>
  line.replace(/^[A-Z]+ /, '').replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')

const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/backlog-task-examine.browser.json'), 'utf8'),
)

function compareWithBaseline (index) {
  const expected = strip(baseline.requests[index].url)
  const actual = strip(sent[sent.length - 1] ?? '')
  const ok = expected === actual
  process.stdout.write(`   ${ok ? '=' : '≠'} 与基准第 ${index + 1} 条${ok ? '逐字段一致' : '不一致'}\n`)
  if (!ok) {
    process.stdout.write(`     基准：${expected}\n     实际：${actual}\n`)
  }
  return ok
}

let allMatched = true

async function step (run) {
  try {
    return { result: await run(), ok: true }
  } catch (error) {
    return { error, ok: false }
  }
}

try {
  // ① 默认（待办事项，无筛选）
  const a = await step(() => capability.list({ pageNo: 1, pageSize: 20 }))
  if (!a.ok) throw a.error
  process.stdout.write(`① 待办事项（无筛选）：共 ${a.result.total} 条，本页 ${a.result.list.length} 条\n`)
  allMatched = compareWithBaseline(0) && allMatched
  for (const row of a.result.list.slice(0, 3)) {
    process.stdout.write(
      `   #${row.id} ${row.name ?? '-'} / ${row.processInstance?.title ?? '-'} / ` +
        `${row.processInstance?.startUserNickname ?? '-'} / ${row.createTime ?? '-'} / category=${row.processInstance?.category ?? '-'}\n`,
    )
  }
  const first = a.result.list[0]
  if (first) {
    process.stdout.write(
      `   行的字段形状：顶层 [${Object.keys(first).join(', ')}]\n` +
        `                 processInstance [${Object.keys(first.processInstance ?? {}).join(', ')}]\n`,
    )
  }

  // ② 已办事项
  const b = await step(() => capability.list({ finished: 2, pageNo: 1, pageSize: 20 }))
  if (!b.ok) throw b.error
  process.stdout.write(`\n② 已办事项：共 ${b.result.total} 条（finished=2，注意这条仍然发 selectType=1）\n`)
  allMatched = compareWithBaseline(1) && allMatched

  // ③ 已办 + 时间范围=全部
  const c = await step(() => capability.list({ finished: 2, selectType: 2, pageNo: 1, pageSize: 20 }))
  if (!c.ok) throw c.error
  process.stdout.write(`\n③ 已办事项 + 时间范围=全部：共 ${c.result.total} 条\n`)
  allMatched = compareWithBaseline(2) && allMatched

  // ④ 发起时间区间
  const d = await step(() =>
    capability.list({
      finished: 2,
      selectType: 2,
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 00:00:00',
      pageNo: 1,
      pageSize: 20,
    }),
  )
  if (!d.ok) throw d.error
  process.stdout.write(`\n④ 发起时间 2026-09-01 00:00:00 ~ 2026-09-10 00:00:00：共 ${d.result.total} 条\n`)
  allMatched = compareWithBaseline(3) && allMatched

  // ⑤ 流程名称（顺带确认中文编码与基准一致）
  const e = await step(() =>
    capability.list({
      name: '通用',
      finished: 2,
      selectType: 2,
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 00:00:00',
      pageNo: 1,
      pageSize: 20,
    }),
  )
  if (!e.ok) throw e.error
  process.stdout.write(`\n⑤ 流程名称含「通用」：共 ${e.result.total} 条\n`)
  allMatched = compareWithBaseline(4) && allMatched

  // ⑥ 深链 ?taskKey=Task_month 对应的是 processCategory。
  //    这条**后端会报 500**，是后端的空指针（见 docs/pages/待办事项.md），不是 SDK 的问题：
  //    「请求形状对不对」与「这次查询成不成功」是两件事，这里分开判。
  const f = await step(() => capability.list({ processCategory: 'Task_month', pageNo: 1, pageSize: 20 }))
  process.stdout.write('\n⑥ processCategory=Task_month（深链 ?taskKey=Task_month 的那条）\n')
  allMatched = compareWithBaseline(5) && allMatched
  if (f.ok) {
    process.stdout.write(
      `   ⚠️ 后端这次**没有**报错（共 ${f.result.total} 条）——与 2026-09-20 实测的 500 不一致，值得复查\n`,
    )
  } else {
    process.stdout.write(
      `   ✓ 后端如实测那样报错：${f.error?.code} ${String(f.error?.message ?? f.error).slice(0, 58)}…\n` +
        '     根因是后端 `modelMapGroupCategory.get(processCategory).stream()` 的空指针；\n' +
        '     浏览器页面上从消息中心走同一条深链，渲染出来也是「暂无数据 / 共 0 条记录」。\n',
    )
  }

  // ⑦ 同一条链路换一个**真实存在**的流程分类：证明 processCategory 本身是可用的，
  //    上面那条 500 不是「SDK 把这个参数发坏了」。
  const g = await step(() => capability.list({ processCategory: 'human_process', pageNo: 1, pageSize: 5 }))
  if (!g.ok) throw g.error
  process.stdout.write(
    `\n⑦ processCategory=human_process（真实存在的流程分类）：共 ${g.result.total} 条，本页 ${g.result.list.length} 条\n` +
      `   ${strip(sent[sent.length - 1] ?? '')}\n`,
  )

  // ⑧ 非法入参必须被本地挡住，且**不发请求**
  const beforeReject = sent.length
  const rejects = []
  await capability.list({ createTimeStart: '2026-09-01 00:00:00' }).then(
    () => rejects.push('单边区间竟然通过了'),
    (error) => rejects.push(`单边区间被拒（${error.message.slice(0, 18)}…）`),
  )
  await capability.list({ createTimeStart: '2026-9-1 00:00:00', createTimeEnd: '2026-09-10 00:00:00' }).then(
    () => rejects.push('非法格式竟然通过了'),
    (error) => rejects.push(`非法格式被拒（${error.message.slice(0, 18)}…）`),
  )
  process.stdout.write(
    `\n⑧ 本地校验：\n` + rejects.map((line) => `   ${line}\n`).join('') + `   未发请求：${sent.length === beforeReject}\n`,
  )

  process.stdout.write('\n' + (allMatched ? '✓ 六条请求与浏览器基准逐字段一致\n' : '✗ 有请求与基准不一致，见上面的 ≠\n'))
  if (!allMatched) process.exitCode = 1
} catch (error) {
  process.stderr.write(`\n调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  // 失败时把真正发出去的 URL 打出来：后端报错时「它到底收到的是什么」是排障的第一现场
  process.stderr.write(`  已发出的请求（共 ${sent.length} 条）：\n`)
  for (const line of sent) process.stderr.write(`    ${strip(line)}\n`)
  process.exit(1)
}
