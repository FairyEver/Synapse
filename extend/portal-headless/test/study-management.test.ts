import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import { createStudyStudentCapability } from '../src/capabilities/study-student.js'
import { createStudyGradeCapability, studyGradeCapabilities } from '../src/capabilities/study-grade.js'
import {
  buildStudyLessonTimeRange,
  createStudyLessonCapability,
  STUDY_LESSON_DAILY_PAGE_PATH,
  STUDY_LESSON_MONTHLY_PAGE_PATH,
  STUDY_LESSON_WEEKLY_PAGE_PATH,
  studyLessonCapabilities,
} from '../src/capabilities/study-lesson.js'
import { createStudyRecordCapability } from '../src/capabilities/study-record.js'
import {
  buildStudyStatisticsGradeRange,
  buildStudyStatisticsLessonTimeRange,
  buildStudyStatisticsTeacherScoreTimeRange,
  buildStudyStatisticsTeacherTimeRange,
  createStudyStatisticsCapability,
  dropEmptyParams,
  studyStatisticsCapabilities,
  STUDY_STATISTICS_GRADE_PAGE_PATH,
  STUDY_STATISTICS_LEARNING_PAGE_PATH,
  STUDY_STATISTICS_LESSON_PAGE_PATH,
  STUDY_STATISTICS_STUDENT_PAGE_PATH,
  STUDY_STATISTICS_TEACHER_PAGE_PATH,
} from '../src/capabilities/study-statistics.js'
import {
  createStudyTeacherCapability,
  studyTeacherCapabilities,
  STUDY_APPRAISE_SETTING_PAGE_PATH,
  STUDY_TEACHER_LEVEL_PAGE_PATH,
  STUDY_TEACHER_PAGE_PATH,
} from '../src/capabilities/study-teacher.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string): Baseline => JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

type BaselineRequest = { 页面: string; pagePath: string; method: string; url: string; body?: unknown }
type Baseline = { requests: BaselineRequest[] }

const BASE = load('study-base.browser.json')
const TEACHER = load('study-teacher.browser.json')
const LESSON = load('study-lesson.browser.json')
const STATS = load('study-statistics.browser.json')
const RECORD = load('study-record.browser.json')

/** 按页面取基准里的那一条（同页第一条业务请求就是列表请求） */
function reqOf (baseline: Baseline, pagePath: string, match: RegExp): BaselineRequest {
  const hit = baseline.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
  if (!hit) throw new Error(`基准里找不到 ${pagePath} 的 ${match}`)
  return hit
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（D20） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/**
 * 每个页面一个 `request`（与门面的接法一致）：记录 `call` 收到的配置，
 * 这样既能比 URL，也能看出请求级声明的 `httpInstance`。
 */
function makeSdk () {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
    httpBaseUrls: { 'smart-layer-admin': 'https://smarterlayeradmintest.zhihuidanji.com/admin' },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const at = (pagePath: string, extra: Record<string, unknown> = {}): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object), ...extra } as never)
  return { sdk, calls, at }
}

// ---------------------------------------------------------------------------
// 学员管理 / 班级管理（基础数据）
// ---------------------------------------------------------------------------

describe('学员管理 —— 与浏览器基准逐字段一致（D20）', () => {
  function build () {
    const { calls, at } = makeSdk()
    return { calls, cap: createStudyStudentCapability(at('/dashboard/base/student/list')) }
  }

  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { cap, calls } = build()
    await cap.list()
    expect(queryPairs(String(calls[0]?.url))).toEqual(
      queryPairs(reqOf(BASE, '/dashboard/base/student/list', /studystudent\/page/).url),
    )
    expect(normalize(String(calls[0]?.url))).toBe(
      normalize(reqOf(BASE, '/dashboard/base/student/list', /studystudent\/page/).url),
    )
  })

  it('isRelatedClass / isRelatedLayer 的空值是**空串**、照样发（不是省略）', async () => {
    const { cap, calls } = build()
    await cap.list()
    const url = String(calls[0]?.url)
    expect(url).toContain('isRelatedClass=&isRelatedLayer=')
  })

  it('创建时间区间：结束日 +1 天', async () => {
    const { cap, calls } = build()
    const range = (await import('../src/capabilities/study-student.js')).buildStudyStudentTimeRange('2026-09-01', '2026-09-15')
    await cap.list(range)
    const url = String(calls[0]?.url)
    expect(url).toContain('createTimeStart=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('createTimeEnd=2026-09-16%2000%3A00%3A00')
  })

  it('checkInGrade 的参数名是 studentIds（逗号串），数组会被 join', async () => {
    const { cap, calls } = build()
    await cap.checkInGrade([1, 2, 3])
    expect(String(calls[0]?.url)).toContain('/study/base/studystudent/isStudentInGrade?studentIds=1%2C2%2C3')
  })

  it('checkInGrade 空入参直接拒绝，不发请求', async () => {
    const { cap, calls } = build()
    await expect(cap.checkInGrade([])).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('班级管理 —— 与浏览器基准逐字段一致（D20）', () => {
  function build () {
    const { calls, at } = makeSdk()
    return { calls, cap: createStudyGradeCapability(at('/dashboard/grade/grade/list')) }
  }

  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { cap, calls } = build()
    await cap.list()
    const base = reqOf(BASE, '/dashboard/grade/grade/list', /studygrade\/page/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('searchByKeyword 强制要关键字（长选项不许全量拉）', async () => {
    const { cap, calls } = build()
    await expect(cap.searchByKeyword({ keyword: '   ' })).rejects.toThrow(/必须提供 keyword/)
    expect(calls).toHaveLength(0)
  })

  it('searchByKeyword 用 name 查询、在本地过滤、并按 limit 定 pageSize', async () => {
    const { cap, calls } = build()
    await cap.searchByKeyword({ keyword: '一班', limit: 5 })
    const url = String(calls[0]?.url)
    expect(url).toContain('name=' + encodeURIComponent('一班'))
    expect(url).toContain('pageSize=5')
    expect(url).not.toContain('pageSize=99999')
  })
})

// ---------------------------------------------------------------------------
// 课堂三页
// ---------------------------------------------------------------------------

describe('课堂三页 —— 与浏览器基准逐字段一致（D20）', () => {
  const cases: Array<[string, string, keyof ReturnType<typeof createStudyLessonCapability>]> = [
    ['晨课堂', STUDY_LESSON_DAILY_PAGE_PATH, 'listDaily'],
    ['周课堂', STUDY_LESSON_WEEKLY_PAGE_PATH, 'listWeekly'],
    ['月课堂', STUDY_LESSON_MONTHLY_PAGE_PATH, 'listMonthly'],
  ]

  for (const [name, pagePath, method] of cases) {
    it(`${name}：无筛选时的 URL 与基准完全相同（含键顺序）`, async () => {
      const { calls, at } = makeSdk()
      const cap = createStudyLessonCapability(
        at(STUDY_LESSON_DAILY_PAGE_PATH),
        at(STUDY_LESSON_WEEKLY_PAGE_PATH),
        at(STUDY_LESSON_MONTHLY_PAGE_PATH),
      )
      await (cap[method] as () => Promise<unknown>)()
      const base = reqOf(LESSON, pagePath, /studylesson\/lessonList/)
      expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
      expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    })
  }

  it('三页的 type 由能力钉死，调用方改不了', async () => {
    const { calls, at } = makeSdk()
    const cap = createStudyLessonCapability(
      at(STUDY_LESSON_DAILY_PAGE_PATH),
      at(STUDY_LESSON_WEEKLY_PAGE_PATH),
      at(STUDY_LESSON_MONTHLY_PAGE_PATH),
    )
    await cap.listDaily({ type: '9' } as never)
    await cap.listWeekly({ type: '9' } as never)
    expect(String(calls[0]?.url)).toContain('type=1')
    expect(String(calls[1]?.url)).toContain('type=2')
    expect(String(calls[0]?.url)).not.toContain('type=9')
  })

  it('周课堂的字段比另外两页多（有 linkNum / teacherName / 四组时间）', async () => {
    const { calls, at } = makeSdk()
    const cap = createStudyLessonCapability(
      at(STUDY_LESSON_DAILY_PAGE_PATH),
      at(STUDY_LESSON_WEEKLY_PAGE_PATH),
      at(STUDY_LESSON_MONTHLY_PAGE_PATH),
    )
    await cap.listWeekly()
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    for (const k of ['linkNum', 'teacherName', 'publishTimeStart', 'publishTimeEnd', 'endTimeStart', 'endTimeEnd']) {
      expect(keys, `周课堂应当有 ${k}`).toContain(k)
    }
    expect(studyLessonCapabilities).toHaveLength(3)
  })

  it('时间格式三页里有两种：晨课堂是 YYYY-MM-DD 00:00:00，周/月是 HH:mm:ss', () => {
    expect(buildStudyLessonTimeRange('2026-09-01', '2026-09-15', { withTime: false })).toEqual({
      start: '2026-09-01 00:00:00',
      end: '2026-09-16 00:00:00',
    })
    expect(buildStudyLessonTimeRange('2026-09-01', '2026-09-15')).toEqual({
      start: '2026-09-01 00:00:00',
      end: '2026-09-16 00:00:00',
    })
    // ⚠️ 入参带时分也会被**截掉**：三个页面的日期选择器都是 date-only，
    // 选出来的一律是当天零点。helper 只取日期部分，与页面一致。
    expect(buildStudyLessonTimeRange('2026-09-01 13:45:00', '2026-09-15').start).toBe('2026-09-01 00:00:00')
  })

  it('结束日 +1 天（开区间），结束日早于开始日要抛', () => {
    expect(buildStudyLessonTimeRange('2026-02-27', '2026-02-28').end).toBe('2026-03-01 00:00:00')
    expect(() => buildStudyLessonTimeRange('2026-09-15', '2026-09-01')).toThrow(/不早于/)
  })
})

// ---------------------------------------------------------------------------
// 统计五页
// ---------------------------------------------------------------------------

describe('统计五页 —— 与浏览器基准逐字段一致（D20）', () => {
  function build () {
    const { calls, at, sdk } = makeSdk()
    const cap = createStudyStatisticsCapability(
      at(STUDY_STATISTICS_STUDENT_PAGE_PATH),
      at(STUDY_STATISTICS_TEACHER_PAGE_PATH),
      at(STUDY_STATISTICS_LESSON_PAGE_PATH),
      at(STUDY_STATISTICS_GRADE_PAGE_PATH),
      at(STUDY_STATISTICS_LEARNING_PAGE_PATH),
    )
    return { calls, cap, sdk }
  }

  it('学员统计：gradeName 默认**不发**（页面从 route.query 取，取不到就是 undefined）', async () => {
    const { cap, calls } = build()
    await cap.listStudents()
    const url = String(calls[0]?.url)
    expect(url).not.toContain('gradeName=')
    expect(queryPairs(url)).toEqual(
      queryPairs(reqOf(STATS, '/dashboard/statistics/student/list', /studentList/).url),
    )
  })

  it('讲师统计：时间字段是 startTime / endTime，且 +1 天', async () => {
    const { cap, calls } = build()
    await cap.listTeachers(buildStudyStatisticsTeacherTimeRange('2026-09-01', '2026-09-15'))
    const url = String(calls[0]?.url)
    expect(url).toContain('startTime=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('endTime=2026-09-16%2000%3A00%3A00')
  })

  it('班课统计：**空值参数被丢掉** —— 无筛选时 URL 上只剩 pageNo/pageSize', async () => {
    const { cap, calls } = build()
    await cap.listLessons()
    const url = String(calls[0]?.url)
    expect(queryPairs(url).map(([k]) => k)).toEqual(['pageNo', 'pageSize', '_t'])
    expect(normalize(url)).toBe(normalize(reqOf(STATS, '/dashboard/statistics/lesson/list', /lessonStatisticsList/).url))
  })

  it('班课统计：时间字段叫 startTimeCondition / endTimeCondition（不是 startTime）', async () => {
    const { cap, calls } = build()
    await cap.listLessons(buildStudyStatisticsLessonTimeRange('2026-09-01', '2026-09-15'))
    const url = String(calls[0]?.url)
    expect(url).toContain('startTimeCondition=2026-09-01%2000%3A00%3A00')
    expect(url).toContain('endTimeCondition=2026-09-16%2000%3A00%3A00')
  })

  it('dropEmptyParams：只丢 null / undefined / 空串，0 与 false 要留着', () => {
    expect(dropEmptyParams({ a: '', b: null, c: undefined, d: 0, e: false, f: 'x' })).toEqual({ d: 0, e: false, f: 'x' })
  })

  it('班级统计：POST body 的键序与基准一致（时间字段**追加在最后**）', async () => {
    const { cap, calls } = build()
    await cap.listGradeLessons('morning', buildStudyStatisticsGradeRange('2026-09-21', '2026-09-21', 'morning'))
    const sent = JSON.parse(String(calls[0]?.data))
    expect(Object.keys(sent)).toEqual([
      'order',
      'orderField',
      'managementCenterIdList',
      'gradeName',
      'pageNo',
      'pageSize',
      'startDate',
      'endDate',
    ])
    const base = STATS.requests.find((r) => /statisticsGradeMorningLesson/.test(r.url))
    expect(Object.keys(sent)).toEqual(Object.keys(JSON.parse(String(base?.body))))
  })

  it('班级统计：区间是**闭区间**，不是别处那个 +1 天', () => {
    expect(buildStudyStatisticsGradeRange('2026-09-01', '2026-09-15', 'morning')).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-15',
    })
  })

  it('班级统计：月课堂那一支把区间拆成 年/月/结束年/结束月 四个字段', () => {
    const r = buildStudyStatisticsGradeRange('2026-09-01', '2026-10-15', 'monthly')
    expect(r).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-10-15',
      year: '2026',
      month: '09',
      endYear: '2026',
      endMonth: '10',
    })
  })

  it('班级统计：kind 只认三个值，别的不发请求', async () => {
    const { cap, calls } = build()
    await expect(cap.listGradeLessons('yearly' as never)).rejects.toThrow(/只认三个值|morning \/ weekly \/ monthly/)
    expect(calls).toHaveLength(0)
  })

  it('学习统计：四个 POST 打的是 /admin-api/hr/zhdj-study-statics/*（路径自带前缀，不再补）', async () => {
    const { cap, calls } = build()
    await cap.learningSummary({ lessonId: 1, organizationId: 2 })
    const urls = calls.map((c) => String(c.url))
    expect(urls).toHaveLength(4)
    expect(urls.every((u) => u.startsWith('/admin-api/hr/zhdj-study-statics/'))).toBe(true)
    expect(urls.every((u) => !u.startsWith('/admin-api/admin-api'))).toBe(true)
  })

  it('学习统计：一路失败不拖垮其余（页面上是 Promise.allSettled）', async () => {
    const { sdk, at } = makeSdk()
    let n = 0
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      n += 1
      if (n === 1) throw new Error('这一路炸了')
      return { data: { ret: 'SUCCESS', code: 0, msg: '', data: { ok: true } }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const cap = createStudyStatisticsCapability(
      at(STUDY_STATISTICS_STUDENT_PAGE_PATH),
      at(STUDY_STATISTICS_TEACHER_PAGE_PATH),
      at(STUDY_STATISTICS_LESSON_PAGE_PATH),
      at(STUDY_STATISTICS_GRADE_PAGE_PATH),
      at(STUDY_STATISTICS_LEARNING_PAGE_PATH),
    )
    const result = await cap.learningSummary({ lessonId: 1, organizationId: 2 })
    expect(Object.keys(result.errors)).toHaveLength(1)
    expect(result.byOrganizationChart).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// 学习管理（学习记录）
// ---------------------------------------------------------------------------

describe('学习管理（学习记录）—— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同；时间字段是 startStudyTime / endStudyTime', async () => {
    const { calls, at } = makeSdk()
    const cap = createStudyRecordCapability(at('/dashboard/study/study/list'))
    await cap.list()
    expect(queryPairs(String(calls[0]?.url))).toEqual(
      queryPairs(reqOf(RECORD, '/dashboard/study/study/list', /studystudyrecord/).url),
    )
  })
})

// ---------------------------------------------------------------------------
// 讲师三页
// ---------------------------------------------------------------------------

describe('讲师三页 —— 与浏览器基准逐字段一致（D20）', () => {
  /** smart-layer 那两个接口的原始体（实测形状，见 baseline/study-teacher.browser.json 的说明） */
  const pagedBody = (results: unknown[], totalRecord: number) => ({
    ret: 'SUCCESS',
    code: 200,
    page: { pageNo: 1, pageSize: 20, totalRecord, totalPage: 1, results },
  })

  /** 评价设置走 platform，包络是 `{ret, code, data}` —— 与上面那两个 .lay 的原始体不同 */
  const portalBody = (data: unknown) => ({ ret: 'SUCCESS', code: 0, msg: '', data })

  function build (body: unknown = pagedBody([], 0), appraiseBody: unknown = portalBody([])) {
    const calls: CapturedCall[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
      httpBaseUrls: { 'smart-layer-admin': 'https://smarterlayeradmintest.zhihuidanji.com/admin' },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config as CapturedCall)
      const isAppraise = String(config.url).includes('studyappraiseteacher')
      return { data: isAppraise ? appraiseBody : body, status: 200, statusText: 'OK', headers: {}, config }
    }
    const at = (pagePath: string, extra: Record<string, unknown> = {}): PortalRequest =>
      <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object), ...extra } as never)
    const cap = createStudyTeacherCapability(
      at(STUDY_TEACHER_PAGE_PATH, { httpInstance: 'smart-layer-admin', isOriginal: true }),
      at(STUDY_TEACHER_LEVEL_PAGE_PATH, { httpInstance: 'smart-layer-admin', isOriginal: true }),
      at(STUDY_APPRAISE_SETTING_PAGE_PATH),
    )
    return { calls, cap }
  }

  /**
   * ⚠️ 这两个接口是 `axios-default` 序列化，**不是** platform 那种 `qs-in-interceptor`：
   * 参数在 adapter 收到时还是 `config.params` 这个**对象**，URL 上还没有 query。
   * 而且 `urlRewrite: none`，所以 `config.url` 就是页面源码里那条路径（不带 baseURL 的 `/admin`）。
   * ⇒ 这两页要断言的形状是 `{url, params}`，不是拼好的 URL 字符串。
   */
  const smartCall = (call: CapturedCall | undefined) => ({
    url: String(call?.url),
    params: (call?.params ?? {}) as Record<string, unknown>,
  })

  it('讲师管理：路径与参数与基准一致（含键顺序），分页参数名是 page / limit', async () => {
    const { cap, calls } = build()
    await cap.list()
    const { url, params } = smartCall(calls[0])
    expect(url).toBe('/manage/getAllProfessorPage.lay')
    // 基准里的 host+`/admin` 是实例 baseURL；去掉它们再比路径与 query
    const baselinePath = reqOf(TEACHER, '/dashboard/base/teacher/list', /getAllProfessorPage/)
      .url.replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/admin/, '')
      .replace(/([?&]_t=)\d+/, '$1<ts>')
    const built = `${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
      .replace(/([?&]_t=)\d+/, '$1<ts>')
    expect(built).toBe(baselinePath.replace('token=<redacted>', `token=${String(params.token)}`))
    expect(params.page).toBe(1)
    expect(params.limit).toBe(20)
    expect(params).not.toHaveProperty('pageNo')
    expect(params).not.toHaveProperty('pageSize')
  })

  it('讲师管理：`level` 的初值是 undefined、**不发**（与同域其它页"空值也照发"相反）', async () => {
    const { cap, calls } = build()
    await cap.list()
    expect(smartCall(calls[0]).params).not.toHaveProperty('level')
    await cap.list({ level: 'A' })
    expect(smartCall(calls[1]).params.level).toBe('A')
  })

  it('讲师管理：走 smart-layer-admin、带 isOriginal —— 与页面上那一句一致', async () => {
    const { cap, calls } = build()
    await cap.list()
    expect(calls[0]?.httpInstance).toBe('smart-layer-admin')
    expect((calls[0] as { isOriginal?: boolean }).isOriginal).toBe(true)
  })

  it('把 `{page:{results,totalRecord}}` 归一成 `{list,total}`（页面自己也是这么取的）', async () => {
    const { cap } = build(pagedBody([{ id: 150, name: '胡明伟' }], 133))
    expect(await cap.list()).toEqual({ list: [{ id: 150, name: '胡明伟' }], total: 133 })
  })

  it('⚠️ 响应里没有 `page` 时**当场抛**，不静默返回空列表', async () => {
    // 静默返回空列表会让调用方以为"真的没有讲师"，而实际是响应形状变了
    const { cap } = build({ code: 200, data: { something: 'else' } })
    await expect(cap.list()).rejects.toThrow(/没有 page 字段/)
  })

  it('讲师类型：路径与基准一致，业务参数只有 page 一个', async () => {
    const { cap, calls } = build(pagedBody([{ id: 1, name: '智慧讲师' }], 13))
    const page = await cap.listLevels()
    const { url, params } = smartCall(calls[0])
    expect(url).toBe('/manage/study/teacherlevelmanagement.lay')
    expect(params.page).toBe(1)
    // token / _t 是实例与客户端自己加的，不算业务参数
    expect(Object.keys(params).filter((k) => !['token', '_t'].includes(k))).toEqual(['page'])
    expect(page.total).toBe(13)
  })

  it('评价设置：无参数，走 platform（不带 httpInstance、不带 isOriginal）', async () => {
    const { cap, calls } = build(pagedBody([], 0), portalBody([{ id: 1 }]))
    await cap.listAppraiseSettings()
    // 这一页是 platform：qs 拦截器把 `_t` 拼进了 url，所以断言 url 是有意义的
    expect(String(calls[0]?.url)).toContain('/admin-api/study/base/studyappraiseteacher/list')
    expect(calls[0]?.httpInstance).toBeUndefined()
    expect((calls[0] as { isOriginal?: boolean }).isOriginal).toBeUndefined()
  })

  it('没配 baseURL 时失败关闭（conventions 27），不会拿默认 baseURL 去凑', async () => {
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
      // 刻意**不**给 smart-layer-admin 的 baseURL
    })
    const calls: CapturedCall[] = []
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      calls.push(config as CapturedCall)
      return { data: pagedBody([], 0), status: 200, statusText: 'OK', headers: {}, config }
    }
    const at = (pagePath: string, extra: Record<string, unknown> = {}): PortalRequest =>
      <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object), ...extra } as never)
    const cap = createStudyTeacherCapability(
      at(STUDY_TEACHER_PAGE_PATH, { httpInstance: 'smart-layer-admin', isOriginal: true }),
      at(STUDY_TEACHER_LEVEL_PAGE_PATH, { httpInstance: 'smart-layer-admin', isOriginal: true }),
      at(STUDY_APPRAISE_SETTING_PAGE_PATH),
    )
    // 失败关闭：抛的是实例解析错误，消息里点名是哪个实例缺 baseURL
    await expect(cap.list()).rejects.toThrow(/smart-layer-admin/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/**
 * 学习管理域这三份能力文件里**允许是写操作**的能力 ID。
 *
 * 逐条对应：外部讲师学员创建、讲师主体/状态/删除、讲师类型保存/状态/删除、评价设置题目保存。
 * 任何一条新写能力出现时都必须显式加到这里 —— 这是有意的手工闸门。
 */
const WRITE_CAPABILITY_IDS = new Set([
  'study-teacher-save-teacher',
  'study-teacher-save',
  'study-teacher-status',
  'study-teacher-remove',
  'study-teacher-level-save',
  'study-teacher-level-status',
  'study-teacher-level-remove',
  'study-appraise-setting-save',
])

describe('能力定义：页面路径与目录一致，且没有两个能力指向同一页', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string }> }

  it('所有新能力的 pagePath 都在目录里', () => {
    const all = [
      ...studyLessonCapabilities,
      ...studyStatisticsCapabilities,
      ...studyTeacherCapabilities,
    ]
    for (const def of all) {
      expect(catalog.items.some((i) => i.menuPath === def.pagePath), `${def.id} 的 pagePath 不在目录里`).toBe(true)
      // 写能力必须**逐个点名**：这条断言原先写的是 `def.write === (def.id === 'study-teacher-save-teacher')`，
      // 那时这一族只有一条写能力；本轮补了讲师类型保存与评价设置保存，改成显式清单比原来的表达式更紧。
      expect(def.write).toBe(WRITE_CAPABILITY_IDS.has(def.id))
    }
  })

  it('十六个新能力 id 互不重复', () => {
    const ids = [
      'study-student-list', 'study-student-check-in-grade', 'study-grade-list', 'study-grade-search',
      'study-lesson-daily-list', 'study-lesson-weekly-list', 'study-lesson-monthly-list',
      'study-record-list',
      'study-statistics-student-list', 'study-statistics-teacher-list', 'study-statistics-lesson-list',
      'study-statistics-grade-list', 'study-statistics-learning-summary',
      'study-teacher-list', 'study-teacher-level-list', 'study-appraise-setting-list',
    ]
    expect(new Set(ids).size).toBe(16)
  })
})


// ---------------------------------------------------------------------------
// 统计五页的**下钻子路由 / 弹窗**（本轮补齐的七条）
//
// 这七条没有浏览器基准（`baseline/study-statistics.browser.json` 只抓了五页列表），
// 所以参数形状的判据是**两个固定检出的源码**：前端 `list.vue`/`item-list.vue`/弹窗组件，
// 以及后端 controller 的签名。测试里逐条把这两个出处钉住，源码漂移就会红。
//
// 断言的是**请求最终形态**（URL 上的有序 query / JSON 化的 body），不是能力收到的那层对象：
// 请求层会给 platform 实例补 `/admin-api` 与 `_t`，也把 body 序列化成字符串 ——
// 这些都是要一并核对的真实行为。
// ---------------------------------------------------------------------------

describe('统计下钻七条 —— 参数装配与关键语义', () => {
  function build () {
    const { calls, at } = makeSdk()
    const cap = createStudyStatisticsCapability(
      at(STUDY_STATISTICS_STUDENT_PAGE_PATH),
      at(STUDY_STATISTICS_TEACHER_PAGE_PATH),
      at(STUDY_STATISTICS_LESSON_PAGE_PATH),
      at(STUDY_STATISTICS_GRADE_PAGE_PATH),
      at(STUDY_STATISTICS_LEARNING_PAGE_PATH),
    )
    return { calls, cap }
  }

  /** URL 上的 query 键顺序（去掉请求层加的 `_t`） */
  const keysOf = (call?: CapturedCall): string[] =>
    queryPairs(String(call?.url ?? ''))
      .filter(([key]) => key !== '_t')
      .map(([key]) => key)

  const pairsOf = (call?: CapturedCall): Record<string, string> =>
    Object.fromEntries(queryPairs(String(call?.url ?? '')).filter(([key]) => key !== '_t'))

  /** POST 的 body：请求层已经把它序列化成 JSON 字符串 */
  const bodyOf = (call?: CapturedCall): Record<string, unknown> =>
    typeof call?.data === 'string' ? JSON.parse(call.data) as Record<string, unknown> : (call?.data ?? {}) as Record<string, unknown>

  it('学员班课明细列表：route.query 来的四项默认**不发**，键序与列表模块一致', async () => {
    const { cap, calls } = build()
    await cap.listStudentLessons()
    // 4 个 undefined 的项被 qs 的 skipNulls 丢掉：URL 上只剩 11 个键（与页面一致）
    expect(keysOf(calls[0])).toEqual([
      'order', 'orderField', 'staffName', 'mobile', 'lessonTitle', 'lessonType', 'gradeId',
      'startTimeCondition', 'endTimeCondition', 'pageNo', 'pageSize',
    ])
    // route.query 取不到就是 undefined：页面这几个也一样不发（与同页 gradeId 的空串不同）
    const pairs = pairsOf(calls[0])
    for (const key of ['staffCode', 'isStarted', 'lessonId', 'status']) {
      expect(Object.prototype.hasOwnProperty.call(pairs, key), `${key} 不该出现`).toBe(false)
    }
    expect(pairs.gradeId).toBe('')
    expect(pairs.pageNo).toBe('1')
    expect(pairs.pageSize).toBe('20')
  })

  it('学员班课明细列表：给了 route.query 那几项就照发（且不改变位置）', async () => {
    const { cap, calls } = build()
    await cap.listStudentLessons({ staffCode: '2026050801', isStarted: 1, lessonId: 198577, status: 3 })
    expect(pairsOf(calls[0])).toMatchObject({
      staffCode: '2026050801', isStarted: '1', lessonId: '198577', status: '3',
    })
    // 位置不变：staffCode 仍在第 3 位、status 仍在分页参数之前
    const keys = keysOf(calls[0])
    expect(keys.indexOf('staffCode')).toBe(2)
    expect(keys.indexOf('status')).toBeLessThan(keys.indexOf('pageNo'))
  })

  it('学员班课明细页：**不分页**，参数只有 order/orderField/staffCode/lessonId', async () => {
    const { cap, calls } = build()
    await cap.listStudentLessonDetail({ staffCode: '2026050801', lessonId: 198577 })
    expect(String(calls[0]?.url)).toContain('/study/statistics/studentLessonDetail')
    expect(keysOf(calls[0])).toEqual(['order', 'orderField', 'staffCode', 'lessonId'])
  })

  it('讲师讲授课程明细：startTime 是**单值**（不是 +1 天的区间）', async () => {
    const { cap, calls } = build()
    await cap.listTeacherCourses({ staffCode: 'S1', type: 1, startTime: '2026-09-01 00:00:00' })
    expect(keysOf(calls[0])).toEqual([
      'order', 'orderField', 'staffCode', 'type', 'startTime', 'pageNo', 'pageSize',
    ])
    expect(pairsOf(calls[0]).startTime).toBe('2026-09-01%2000%3A00%3A00')
    expect(Object.prototype.hasOwnProperty.call(pairsOf(calls[0]), 'endTime')).toBe(false)
  })

  it('讲师讲授班课明细：六个筛选字段都在分页参数之前', async () => {
    const { cap, calls } = build()
    await cap.listTeacherLessons({ title: '晨课堂', appraiseNumMin: 1, avgScoreMax: 5 })
    expect(keysOf(calls[0])).toEqual([
      'order', 'orderField', 'staffCode', 'title', 'appraiseNumMin', 'appraiseNumMax',
      'avgScoreMin', 'avgScoreMax', 'pageNo', 'pageSize',
    ])
  })

  it('讲师得分明细：字段名是 startTimeFrom/startTimeEnd（不是 endTime），且 +1 天', async () => {
    const { cap, calls } = build()
    await cap.listTeacherScores({
      staffCode: 'S1',
      ...buildStudyStatisticsTeacherScoreTimeRange('2026-09-01', '2026-09-15'),
    })
    expect(keysOf(calls[0])).toEqual([
      'order', 'orderField', 'staffCode', 'allScoreMin', 'allScoreMax',
      'startTimeFrom', 'startTimeEnd', 'pageNo', 'pageSize',
    ])
    const pairs = pairsOf(calls[0])
    expect(decodeURIComponent(pairs.startTimeFrom ?? '')).toBe('2026-09-01 00:00:00')
    // 结束日 +1 天（开区间），不是 2026-09-15 —— 少这一天是静默的
    expect(decodeURIComponent(pairs.startTimeEnd ?? '')).toBe('2026-09-16 00:00:00')
  })

  it('学习/转发明细：POST 到带 /admin-api 的路径，body 键序 lessonId, staffId, actionType', async () => {
    const { cap, calls } = build()
    await cap.listLearningActionDetails({ lessonId: 123, staffId: 456, actionType: 5 })
    const call = calls[0]
    expect(String(call?.url)).toContain('/admin-api/hr/zhdj-study-statics/action-details')
    expect(String(call?.url).startsWith('/admin-api/admin-api')).toBe(false)
    expect(call?.method).toBe('post')
    expect(Object.keys(bodyOf(call))).toEqual(['lessonId', 'staffId', 'actionType'])
    expect(bodyOf(call)).toEqual({ lessonId: 123, staffId: 456, actionType: 5 })
  })

  it('学习/转发明细：actionType 只收 1 与 5（页面只有这两列入口），2/3/4 在发请求前拒绝', async () => {
    const { cap, calls } = build()
    await expect(
      cap.listLearningActionDetails({ lessonId: 1, staffId: 2, actionType: 2 }),
    ).rejects.toThrow(/actionType/)
    await expect(cap.listLearningActionDetails({ lessonId: 1, staffId: 2, actionType: 1 })).resolves.toBeTruthy()
    expect(calls).toHaveLength(1)
  })

  it('学习/转发明细：lessonId 与 staffId 缺一不可', async () => {
    const { cap, calls } = build()
    await expect(cap.listLearningActionDetails({ lessonId: '', staffId: 2, actionType: 1 })).rejects.toThrow(/lessonId/)
    await expect(cap.listLearningActionDetails({ lessonId: 1, staffId: '', actionType: 1 })).rejects.toThrow(/staffId/)
    expect(calls).toHaveLength(0)
  })

  it('课堂内容：数组拼成逗号分隔串，且**没有** order/pageNo 那一套', async () => {
    const { cap, calls } = build()
    await cap.listGradeLessonRecords({ lessonIds: [198577, 198578] })
    expect(String(calls[0]?.url)).toContain('/study/statistics/getGradeLessonRecord')
    expect(keysOf(calls[0])).toEqual(['lessonIds'])
    expect(pairsOf(calls[0]).lessonIds).toBe('198577%2C198578')
  })

  it('课堂内容：空数组 / 空串在发请求前拦住（后端对空值是静默返回空列表）', async () => {
    const { cap, calls } = build()
    await expect(cap.listGradeLessonRecords({ lessonIds: [] })).rejects.toThrow(/不能为空数组/)
    await expect(cap.listGradeLessonRecords({ lessonIds: '  ' })).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('七个能力的元数据：pagePath 绑可达的父菜单页、且全是只读', () => {
    const expected: Record<string, string> = {
      'study-statistics-student-lesson-list': STUDY_STATISTICS_STUDENT_PAGE_PATH,
      'study-statistics-student-lesson-detail': STUDY_STATISTICS_STUDENT_PAGE_PATH,
      'study-statistics-teacher-course-list': STUDY_STATISTICS_TEACHER_PAGE_PATH,
      'study-statistics-teacher-lesson-list': STUDY_STATISTICS_TEACHER_PAGE_PATH,
      'study-statistics-teacher-score-list': STUDY_STATISTICS_TEACHER_PAGE_PATH,
      'study-statistics-learning-action-details': STUDY_STATISTICS_LEARNING_PAGE_PATH,
      'study-statistics-grade-lesson-record': STUDY_STATISTICS_GRADE_PAGE_PATH,
    }
    for (const [id, pagePath] of Object.entries(expected)) {
      const definition = studyStatisticsCapabilities.find(item => item.id === id)
      expect(definition, `${id} 没有能力定义`).toBeDefined()
      expect(definition?.pagePath).toBe(pagePath)
      expect(definition?.write).toBe(false)
    }
  })

  it('能力定义与两个固定检出的源码逐条对上（源码漂移就会红）', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const views = 'app/portal/views/dashboard/education/statistics'
    const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8')

    const studentItemList = read(portalRoot, `${views}/student/lesson/item-list.vue`)
    expect(studentItemList).toContain("getDataListURL: '/study/statistics/studentLessonStatisticsList'")
    expect(studentItemList).toContain('startTimeCondition: data.date')
    expect(read(portalRoot, `${views}/student/lesson/detail/[lessonId].vue`))
      .toContain("getDataListURL: '/study/statistics/studentLessonDetail'")

    expect(read(portalRoot, `${views}/teacher/course/[staffCode]/item-list.vue`))
      .toContain("getDataListURL: '/study/statistics/teacherCourseList'")
    expect(read(portalRoot, `${views}/teacher/lesson/[staffCode]/item-list.vue`))
      .toContain("getDataListURL: '/study/statistics/teacherLessonList'")
    const score = read(portalRoot, `${views}/teacher/score/[staffCode]/item-list.vue`)
    expect(score).toContain("getDataListURL: '/study/statistics/teacherScoreList'")
    expect(score).toContain('startTimeFrom:')
    expect(score).toContain('startTimeEnd:')

    const actionDetails = read(portalRoot, `${views}/learning/components/action-details.vue`)
    expect(actionDetails).toContain("'/admin-api/hr/zhdj-study-statics/action-details'")
    const learningList = read(portalRoot, `${views}/learning/list.vue`)
    expect(learningList).toContain('hasView: 1')
    expect(learningList).toContain('hasForward: 5')

    const record = read(portalRoot, `${views}/grade/components/record.vue`)
    expect(record).toContain('/study/statistics/getGradeLessonRecord')
    expect(record).toContain('params: { lessonIds: props.lessonIds }')

    const controller = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/statistics/controller/StudyStatisticsController.java')
    expect(controller).toContain('studentLessonDetail(Long staffCode, Long lessonId)')
    expect(controller).toContain('getGradeLessonRecord(String lessonIds)')
    const service = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/statistics/service/impl/StatisticsServiceImpl.java')
    expect(service).toContain('StringUtils.isBlank(lessonIds)')
    expect(service).toContain('Collections.reverseOrder()')
  })
})

describe('统计下钻七条的 AI 说明契约', () => {
  const load = async (): Promise<Record<string, import('../src/catalog/ai-contract.js').AiContract>> => {
    const mod = await import('../src/catalog/contracts-study-statistics.js')
    return mod.STUDY_STATISTICS_AI_CONTRACTS
  }

  it('每条都有契约，并通过结构校验（含未登记/重复路径等可验证引用）', async () => {
    const contracts = await load()
    const ids = Object.keys(contracts)
    expect(ids.sort()).toEqual([
      'study-statistics-grade-lesson-record',
      'study-statistics-learning-action-details',
      'study-statistics-student-lesson-detail',
      'study-statistics-student-lesson-list',
      'study-statistics-teacher-course-list',
      'study-statistics-teacher-lesson-list',
      'study-statistics-teacher-score-list',
    ])
    // 逐条校验，而不是 `validateAiContracts`：本文件是**增量**，同批另五条列表契约在
    // contracts-business.ts 里；用后者会报出一堆 missing-contract（那不是在查本文件的问题），
    // 而 references 又要能查到跨域的候选能力（study-grade-search 等），所以 definitions
    // 传的是学习域三份能力文件的并集。
    const definitions = new Map(
      [...studyGradeCapabilities, ...studyStatisticsCapabilities, ...studyTeacherCapabilities]
        .map(item => [item.id, item] as const),
    )
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl) as {
      validateAiContract: (id: string, contract: unknown, options?: unknown) => Array<{ code: string }>
    }
    const issues = ids.flatMap(id => validateAiContract(id, contracts[id], { definitions }))
    expect(issues).toEqual([])
  })

  it('关键语义：数组端点、倒序、题号归属、ID 不能互换、无基准', async () => {
    const contracts = await load()
    // 三个不分页端点的返回值必须是数组，而不是 {list,total}
    for (const id of [
      'study-statistics-student-lesson-detail',
      'study-statistics-learning-action-details',
      'study-statistics-grade-lesson-record',
    ]) {
      expect(contracts[id]?.output.shape, id).toBe('object[]')
    }
    // 课堂内容：后端按字符串倒序处理，返回顺序不代表输入顺序
    expect(contracts['study-statistics-grade-lesson-record']?.consume.join(' ')).toContain('字符串倒序')
    // 得分明细的第二个时间字段名必须写清楚（与讲师统计页不同名）
    expect(contracts['study-statistics-teacher-score-list']?.inputs.startTimeEnd?.meaning).toContain('startTimeEnd')
    // 1~5 题均分的题号含义由评价设置决定，不能自行编造
    expect(contracts['study-statistics-teacher-lesson-list']?.consume.join(' ')).toContain('study-appraise-setting-list')
    // 四类 ID 不能互换这条边界必须在
    expect(contracts['study-statistics-student-lesson-list']?.boundaries.join(' ')).toContain('ID 不能互换')
    // actionType 的取值域：页面只有 1 与 5
    expect(contracts['study-statistics-learning-action-details']?.inputs.actionType?.options?.map(item => item.value)).toEqual([1, 5])
    // 没有浏览器基准这件事必须如实写进 gaps
    expect(contracts['study-statistics-student-lesson-list']?.gaps?.join(' ')).toContain('没有浏览器基准')
  })
})
