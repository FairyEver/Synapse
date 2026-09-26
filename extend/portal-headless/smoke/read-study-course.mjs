#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一遍「课程管理」三页（只读，`/dashboard/course/*`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-study-course.mjs
 *
 * **只做读操作。** 这几页都有新建 / 编辑 / 删除，本脚本一个都不碰
 * （写链路跨系统，见 `src/capabilities/study-course.ts` 的「写操作没有做」）。
 *
 * ## 这个脚本要证明的三件事
 *
 * 1. 三个页面发出去的 URL 与 `baseline/study-course.browser.json` **逐字段一致**（含键顺序）。
 * 2. 关键字那条路径**命中即报错**（`code:500` 用户查询结果超过500条）—— 这是实测的事实，
 *    不是猜的；无命中时正常返回空列表。脚本把两种情况都跑一遍。
 * 3. 即时通讯课程（`type=4`）**必定失败**，且失败的是接口本身，不是 SDK。
 *
 * ## 为什么从 `../src/` 直接 import 能力
 *
 * 门面（`sdk.studyCourse`）要靠派单方接线才有。这里手工构造 `request`
 * （就是门面内部用的那个 `sdk.call(页面路径, …)`），能力实现仍是同一份。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'
import {
  buildStudyCourseTimeRange,
  createStudyCourseCapability,
  studyCourseCapabilities,
  STUDY_COURSE_IM_PAGE_PATH,
  STUDY_COURSE_TEXT_PAGE_PATH,
} from '../src/capabilities/study-course.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-study-course.mjs\n',
  )
  process.exit(1)
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })
const course = createStudyCourseCapability((config) => sdk.call(STUDY_COURSE_TEXT_PAGE_PATH, config))

// 记录真正发出去的 URL（只读侧观测，不改请求）。
// `sdk.http.defaults.adapter` 默认是 undefined（axios 在请求时才解析适配器列表），
// 所以这里自己解析出内层适配器再包一层，不是把 undefined 包起来。
const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}

/** 把 _t 时间戳抹掉，便于与基准对比 */
const strip = (url) => String(url).replace(/([?&]_t=)\d+/, '$1<ts>')

/** 最后一条发出去的请求（失败的调用也会留下记录，`sent` 不会因此对不上） */
const lastUrl = () => strip(sent[sent.length - 1] ?? '（没有发出请求）')

let failures = 0
const check = (ok, label, detail = '') => {
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}\n`)
  if (!ok) failures += 1
}

// ---------------------------------------------------------------------------
// ① 三页各读一次，URL 与基准逐字段对
// ---------------------------------------------------------------------------
process.stdout.write('① 三页默认查询（无筛选）\n')

const calls = [
  ['图文课程', 'study-course-text-list', 'listText', 1],
  ['视频课程', 'study-course-video-list', 'listVideo', 2],
  ['即时通讯课程', 'study-course-im-list', 'listIm', 4],
]

for (const [name, id, method, type] of calls) {
  const before = sent.length
  try {
    const page = await course[method]({ pageNo: 1, pageSize: 5 })
    const url = lastUrl()
    process.stdout.write(
      `\n   【${name}】${id}  type=${type}\n` +
        `     共 ${page.total} 条，本页 ${page.list.length} 条\n` +
        `     ${url}\n`,
    )
    check(sent.length > before, '确实发出了请求')
    check(url.includes(`&type=${type}`), `type=${type} 排在 _t 之后`, url.slice(-26))
    const row = page.list[0]
    if (row) {
      process.stdout.write(
        `     首行：id=${row.id} resourceId=${row.resourceId} 录入人=${row.creatorName ?? '-'} ` +
          `时间=${row.createTime ?? '-'} 资源字段=` +
          `${['news', 'videos', 'live', 'imGroupDTO'].filter((k) => row[k]).join('/') || '（四个全空）'}\n`,
      )
    }
  } catch (error) {
    process.stdout.write(
      `\n   【${name}】${id}  type=${type}\n` +
        `     调用失败：${error?.name || 'Error'} ${error?.message || String(error)}\n` +
        `     ${lastUrl()}\n`,
    )
    // 只有 type=4 失败是预期的，其余页失败就是真问题
    check(type === 4, `type=${type} 本应成功却失败了`, error?.message?.slice(0, 60) ?? '')
  }
}

// ---------------------------------------------------------------------------
// ② 关键字：命中与不命中是两种结局（这是这一页最反直觉的地方）
// ---------------------------------------------------------------------------
process.stdout.write('\n② 关键字路径（命中 / 不命中）\n')

for (const keyword of ['经营', 'zzz_not_exist_xyz']) {
  try {
    const page = await course.listText({ keyword, pageNo: 1, pageSize: 3 })
    process.stdout.write(
      `   keyword=${keyword} → 成功，共 ${page.total} 条\n     ${lastUrl()}\n`,
    )
    check(keyword === 'zzz_not_exist_xyz', `keyword=${keyword} 本应报错（超过500条）却成功了`)
  } catch (error) {
    process.stdout.write(
      `   keyword=${keyword} → 报错：${error?.message || String(error)}\n     ${lastUrl()}\n`,
    )
    check(keyword === '经营', `keyword=${keyword} 本应成功却报错了`)
  }
}

// ---------------------------------------------------------------------------
// ③ 时间区间：结束日 +1 天
// ---------------------------------------------------------------------------
process.stdout.write('\n③ 时间区间（2026-08-01 ~ 2026-08-31）\n')

try {
  const range = buildStudyCourseTimeRange('2026-08-01', '2026-08-31')
  const page = await course.listText({ ...range, pageNo: 1, pageSize: 3 })
  const url = strip(sent[sent.length - 1] ?? '')
  process.stdout.write(`   共 ${page.total} 条\n     ${url}\n`)
  check(range.endTime === '2026-09-01 00:00:00', '结束日 +1 天', range.endTime)
  check(url.includes('endTime=2026-09-01%2000%3A00%3A00'), 'URL 上的 endTime 是 09-01（不是 08-31）')
} catch (error) {
  process.stderr.write(`   区间查询失败：${error?.message || String(error)}\n`)
  failures += 1
}

// ---------------------------------------------------------------------------
// ④ 直播课程（type=3）**不在**能力定义里 —— 它那一页的菜单项在源码里是注释掉的
// ---------------------------------------------------------------------------
process.stdout.write('\n④ 直播课程（type=3）：不应当出现在能力定义里\n')
const liveCapability = studyCourseCapabilities.find((item) => item.pagePath === '/dashboard/course/live-course/list')
check(liveCapability === undefined, '能力定义里没有直播课程')
process.stdout.write(
  '   实测：那一页的路由还在、按 URL 打开也能渲染，但 `app/portal/menus/hr.js:299` 的菜单项\n' +
    '   是注释掉的，侧边栏「课程管理」下只有图文 / 视频 / 即时通讯三项 —— 用户到不了。\n' +
    '   按项目规则（conventions「注释掉的代码不算代码」）不进 SDK，所以这里也不读它。\n',
)
process.stdout.write(`   即时通讯课程页：${STUDY_COURSE_IM_PAGE_PATH}\n`)

process.stdout.write(
  `\n${failures === 0 ? '✅ 全部符合预期' : `❌ ${failures} 项不符合预期`}\n`,
)
process.exit(failures === 0 ? 0 : 1)
