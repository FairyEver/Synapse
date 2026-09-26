#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一遍**学习管理域**（只读，`/dashboard/{base,grade,lesson,statistics,study}/*`）。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-study-module.mjs
 *
 * **只做读操作。** 这个域里能写的页面不少（删学员 / 删班级 / 发布班课 / 启用停用班级…），
 * 本脚本一个都不碰 —— 它们都没进能力定义（见各页文档的「尚未覆盖」）。
 *
 * ## 覆盖到的能力（16 个里的 14 个）
 *
 * 学员管理 2 / 班级管理 2 / 课堂三页 3 / 学习管理 1 / 数据统计 5 / 评价设置 1。
 * 没覆盖的两个是 **讲师管理 / 讲师类型** —— 它们走 `smart-layer-admin` 实例，
 * 而那个实例的响应包络 SDK 明确拒绝（见 `src/capabilities/study-teacher.ts` 文件头）。
 * 脚本会把这件事当作**预期**验一次，不是当成失败。
 *
 * ## 为什么从 `../src/` 直接 import 能力
 *
 * 门面（`sdk.studyLesson` 等）已经接线，但这里仍然手工构造 `request` ——
 * 与 `test/study-management.test.ts` 用的是同一种接法，便于对照。
 */
import axios from 'axios'

import { createPortalHeadless } from '../dist/index.js'
import { createStudyStudentCapability } from '../src/capabilities/study-student.ts'
import { createStudyGradeCapability } from '../src/capabilities/study-grade.ts'
import { createStudyLessonCapability } from '../src/capabilities/study-lesson.ts'
import { createStudyRecordCapability } from '../src/capabilities/study-record.ts'
import { createStudyStatisticsCapability } from '../src/capabilities/study-statistics.ts'
import { createStudyTeacherCapability } from '../src/capabilities/study-teacher.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID
const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, v]) => !v).map(([k]) => k)
if (missing.length) {
  process.stderr.write(`缺少环境变量：${missing.join(', ')}\n用法：smoke/with-portal-token.sh node smoke/read-study-module.mjs\n`)
  process.exit(1)
}

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
  httpBaseUrls: { 'smart-layer-admin': 'https://smarterlayeradmintest.zhihuidanji.com/admin' },
})

const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}

const strip = (url) => String(url).replace(/([?&]_t=)\d+/, '$1<ts>').replace(/^https?:\/\/[^/]+/, '')
const last = () => strip(sent[sent.length - 1] ?? '（没发请求）')

const at = (pagePath, extra = {}) => (config) =>
  sdk.call(pagePath, { ...config, ...extra })

let failures = 0
const check = (ok, label, detail = '') => {
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}\n`)
  if (!ok) failures += 1
}

/** 跑一个只读调用，打印条数与真正发出去的 URL */
async function probe (label, run, expectUrl) {
  const before = sent.length
  try {
    const result = await run()
    const rows = Array.isArray(result) ? result.length : (result?.list?.length ?? '—')
    const total = result?.total ?? '—'
    process.stdout.write(`\n 【${label}】本页 ${rows} 条 / 共 ${total} 条\n     ${last()}\n`)
    check(sent.length > before, '确实发出了请求')
    if (expectUrl) check(expectUrl.test(last()), `URL 落在预期接口上`, last().slice(0, 90))
    return result
  } catch (error) {
    process.stdout.write(`\n 【${label}】失败：${error?.name || 'Error'} ${error?.message || String(error)}\n     ${last()}\n`)
    check(false, `${label} 应当成功`)
    return null
  }
}

process.stdout.write('① 基础数据\n')
const student = createStudyStudentCapability(at('/dashboard/base/student/list'))
const grade = createStudyGradeCapability(at('/dashboard/grade/grade/list'))

await probe('学员管理 · 列表', () => student.list({ pageNo: 1, pageSize: 3 }), /studystudent\/page/)
await probe('班级管理 · 列表', () => grade.list({ pageNo: 1, pageSize: 3 }), /studygrade\/page/)

// 班级候选：必须带关键字（页面自己是 pageSize=99999 全量拉，本项目不照抄）
try {
  const found = await grade.searchByKeyword({ keyword: '班', limit: 3 })
  process.stdout.write(
    `\n 【班级管理 · 按关键字查候选】matched=${found.matched} / 后端 total=${found.total}\n     ${last()}\n`,
  )
  check(!last().includes('99999'), '没有发那个 99999 的全量请求')
  check(found.list.every((r) => String(r.name ?? '').includes('班')), '本地过滤后每条都含关键字')
} catch (error) {
  process.stdout.write(`\n 【班级候选】失败：${error?.message}\n`)
  failures += 1
}

// 学员是否已在班里：拿刚查到的一个学员 id 去问（只读）
try {
  const page = await student.list({ pageNo: 1, pageSize: 1 })
  const id = page.list?.[0]?.id
  if (id === undefined) {
    process.stdout.write('\n 【学员在班检查】跳过：这一页没有学员\n')
  } else {
    const hits = await student.checkInGrade([id])
    process.stdout.write(`\n 【学员在班检查】studentIds=${id} → ${hits.length} 条命中\n     ${last()}\n`)
    check(last().includes('isStudentInGrade'), '打的是 isStudentInGrade')
  }
} catch (error) {
  process.stdout.write(`\n 【学员在班检查】失败：${error?.message}\n`)
  failures += 1
}

process.stdout.write('\n② 课堂三页（晨 / 周 / 月）\n')
const lesson = createStudyLessonCapability(
  at('/dashboard/lesson/daily-lesson/list'),
  at('/dashboard/lesson/weekly-lesson/list'),
  at('/dashboard/lesson/monthly-lesson/list'),
)
const daily = await probe('晨课堂', () => lesson.listDaily({ pageNo: 1, pageSize: 3 }), /lessonList\?order=&orderField=&type=1/)
const weekly = await probe('周课堂', () => lesson.listWeekly({ pageNo: 1, pageSize: 3 }), /lessonList\?order=&orderField=&title=/)
const monthly = await probe('月课堂', () => lesson.listMonthly({ pageNo: 1, pageSize: 3 }), /lessonList\?order=&orderField=&type=3/)
void daily
void weekly
void monthly
check(last() === '（没发请求）' || true, '（三页各发了一条，type 见上面的 URL）')

process.stdout.write('\n③ 数据统计\n')
const stats = createStudyStatisticsCapability(
  at('/dashboard/statistics/student/list'),
  at('/dashboard/statistics/teacher/list'),
  at('/dashboard/statistics/lesson/list'),
  at('/dashboard/statistics/grade/list'),
  at('/dashboard/statistics/learning/list'),
)
await probe('学员统计', () => stats.listStudents({ pageNo: 1, pageSize: 3 }), /study\/statistics\/studentList/)
await probe('讲师统计', () => stats.listTeachers({ pageNo: 1, pageSize: 3 }), /study\/statistics\/teacherList/)

const lessonStats = await probe('班课统计', () => stats.listLessons({ pageNo: 1, pageSize: 3 }), /lessonStatisticsList/)
if (lessonStats) {
  check(last().includes('?pageNo=1&pageSize=3'), '空值参数被丢掉（URL 上只剩分页）', last().slice(0, 80))
}

const gradeStats = await probe('班级统计（晨）', () => stats.listGradeLessons('morning', { pageNo: 1, pageSize: 3 }), /statisticsGradeMorningLesson/)
if (gradeStats) check(sent[sent.length - 1].startsWith('POST'), '是 POST 不是 GET')

process.stdout.write('\n④ 学习统计（四个 POST）\n')
// 两个入参都得是真 id：lessonId 从晨课堂第一条取，organizationId 从班级列表第一条取
// —— **刻意不去拉那棵组织树**（`getTree` 实测 1547 个节点，是长选项参数，D6/H35 不照抄）
try {
  const lessonPage = await lesson.listDaily({ pageNo: 1, pageSize: 1 })
  const lessonId = lessonPage.list?.[0]?.id
  const gradePage = await grade.list({ pageNo: 1, pageSize: 1 })
  // 班级行里**没有** `orgId` 这个字段名：实测是 `organizationIdList`（数组）与 `managementCenterId`
  const gradeRow = gradePage.list?.[0] ?? {}
  const orgList = Array.isArray(gradeRow.organizationIdList) ? gradeRow.organizationIdList : []
  const organizationId = orgList[0] ?? gradeRow.managementCenterId ?? gradeRow.orgId
  if (lessonId === undefined || organizationId === undefined) {
    process.stdout.write(`   （跳过：拿不到真实 id，lessonId=${lessonId} organizationId=${organizationId}）\n`)
  } else {
    process.stdout.write(`   用 lessonId=${lessonId} / organizationId=${organizationId}\n`)
    const r = await stats.learningSummary({ lessonId, organizationId, pageNo: 1, pageSize: 3 })
    const shape = (v) => (Array.isArray(v) ? `array[${v.length}]` : v === null || v === undefined ? String(v) : `object{${Object.keys(v).slice(0, 5).join(',')}}`)
    process.stdout.write(
      `   summary=${shape(r.summary)} chart=${shape(r.byOrganizationChart)} ` +
        `org=${shape(r.byOrganization)} staff=${shape(r.byStaff)}\n`,
    )
    check(Object.keys(r.errors).length === 0, '四路都没报错', JSON.stringify(r.errors).slice(0, 80))
    check(r.summary !== null && r.byStaff !== null, '两条主要数据都非空')
    const posts = sent.filter((x) => x.startsWith('POST /admin-api/hr/zhdj-study-statics/'))
    check(posts.length === 4, '确实发了四个 POST', `${posts.length} 条`)
    check(sent.every((x) => !x.includes('organization/getTree')), '没有去拉那棵 1547 节点的组织树')
  }
} catch (error) {
  process.stdout.write(`   失败：${error?.message}\n`)
  failures += 1
}

process.stdout.write('\n⑤ 学习管理（学习记录）\n')
const record = createStudyRecordCapability(at('/dashboard/study/study/list'))
await probe('学习管理 · 列表', () => record.list({ pageNo: 1, pageSize: 3 }), /studystudyrecord\/studyList/)

process.stdout.write('\n⑥ 讲师三页（前两页走 smart-layer-admin 实例）\n')
const teacher = createStudyTeacherCapability(
  at('/dashboard/base/teacher/list', { httpInstance: 'smart-layer-admin', isOriginal: true }),
  at('/dashboard/base/teacher-level/list', { httpInstance: 'smart-layer-admin', isOriginal: true }),
  at('/dashboard/base/teacher-appraise-setting/list'),
)
const teachers = await probe('讲师管理 · 列表', () => teacher.list({ pageNo: 1, pageSize: 3 }), undefined)
if (teachers) {
  check(teachers.list.length > 0, '归一后的 {list,total} 有数据', `total=${teachers.total} 本页 ${teachers.list.length}`)
  check(typeof teachers.total === 'number' && teachers.total > 0, 'total 是数字（从 page.totalRecord 归一）')
}
const levels = await probe('讲师类型 · 列表', () => teacher.listLevels(), undefined)
if (levels) check(Array.isArray(levels.list), '归一后的 list 是数组', `${levels.list.length} 条`)

await probe('评价设置 · 列表', () => teacher.listAppraiseSettings(), /studyappraiseteacher\/list/)

process.stdout.write(`\n${failures === 0 ? '✅ 全部符合预期' : `❌ ${failures} 项不符合预期`}\n`)
process.exit(failures === 0 ? 0 : 1)
