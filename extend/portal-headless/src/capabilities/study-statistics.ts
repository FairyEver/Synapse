import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 学习管理域「数据统计」下的五个页面。
 *
 * | 页面 | 菜单路径 | 接口 | 方法 |
 * | --- | --- | --- | --- |
 * | 学员统计 | `/dashboard/statistics/student/list` | `/study/statistics/studentList` | GET |
 * | 讲师统计 | `/dashboard/statistics/teacher/list` | `/study/statistics/teacherList` | GET |
 * | 班课统计 | `/dashboard/statistics/lesson/list` | `/study/statistics/lessonStatisticsList` | GET |
 * | 班级统计 | `/dashboard/statistics/grade/list` | `/study/statistics/statisticsGrade{Morning,Weekly,Monthly}Lesson` | **POST** |
 * | 学习统计 | `/dashboard/statistics/learning/list` | `/hr/zhdj-study-statics/*` | **POST** |
 *
 * 逐字段基准：`baseline/study-statistics.browser.json`
 * 四件套记录：`docs/pages/{学员统计,讲师统计,班课统计,班级统计,学习统计}.md`
 *
 * ## 五页长得像，但有三处**不能互相照抄**的差异
 *
 * 1. **班课统计会把空值参数整个丢掉。** 它的 `customLoad` 先过一遍
 *    `Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')`，
 *    再 `http.get(url, { params: newParams })`。实测：无筛选时浏览器只发
 *    `?pageNo=1&pageSize=20&_t=…` —— **连 `order`/`orderField` 都不在**。
 *    这**与同域其它页（空值也照发）正相反**，是本文件里最容易写错的一处。
 * 2. **时间字段名三页三个样**：学员统计没有时间；讲师统计是 `startTime`/`endTime`；
 *    班课统计是 `startTimeCondition`/`endTimeCondition`；学习统计与学习管理页是
 *    `startStudyTime`/`endStudyTime`。
 * 3. **班级统计与学习统计是 POST**，body 是 JSON（键序见各自的方法说明），
 *    不是 query。
 *
 * ## 三个页面挂载时都会拉**全量**候选，本能力都不照抄
 *
 * - 班课统计 / 学习管理页：`GET /study/grade/studygrade/page?pageSize=99999`（全部班级）
 * - 班级统计：`GET /study/base/studymanagementcenter/getAllCenter?roleId=`（全部管理中心）
 *
 * 页面的做法是把全量塞进下拉，无头不能照抄（设计 D6 / H35）。
 * 本能力把班级候选交回给 `study-grade-search`（强制要关键字）。
 *
 * ## 写操作
 *
 * 这五页**全是只读的**（统计页没有写入口）。这一档唯一有写操作的是班级统计页里
 * 「导出」与跳转，都不是 JSON 接口。
 */

export const STUDY_STATISTICS_STUDENT_PAGE_PATH = '/dashboard/statistics/student/list'
export const STUDY_STATISTICS_TEACHER_PAGE_PATH = '/dashboard/statistics/teacher/list'
export const STUDY_STATISTICS_LESSON_PAGE_PATH = '/dashboard/statistics/lesson/list'
export const STUDY_STATISTICS_GRADE_PAGE_PATH = '/dashboard/statistics/grade/list'
export const STUDY_STATISTICS_LEARNING_PAGE_PATH = '/dashboard/statistics/learning/list'

const VIEWS = 'app/portal/views/dashboard/education/statistics'

/** 路由文件，写进文档与排障时用得上 */
export const STUDY_STATISTICS_ROUTE_FILES = {
  student: `${VIEWS}/student/list.vue`,
  teacher: `${VIEWS}/teacher/list.vue`,
  lesson: `${VIEWS}/lesson/list.vue`,
  grade: `${VIEWS}/grade/list.vue`,
  learning: `${VIEWS}/learning/list.vue`,
} as const

export const STUDY_STATISTICS_STUDENT_LIST_PATH = '/study/statistics/studentList'
export const STUDY_STATISTICS_TEACHER_LIST_PATH = '/study/statistics/teacherList'
export const STUDY_STATISTICS_LESSON_LIST_PATH = '/study/statistics/lessonStatisticsList'

/**
 * 班级统计的三个**列表**端点，按课堂类型切。
 *
 * 页面会在三选一之前**先打一个 count 接口**（`countGradeMorningLesson` 等），
 * 那是它自己的汇总调用、**不是分页查询**，本能力没做（见文件头）。
 */
export const STUDY_STATISTICS_GRADE_LESSON_PATHS = {
  morning: '/study/statistics/statisticsGradeMorningLesson',
  weekly: '/study/statistics/statisticsGradeWeeklyLesson',
  monthly: '/study/statistics/statisticsGradeMonthlyLesson',
} as const

/** 学习统计的四个端点。注意它们的路径**自带 `/admin-api` 前缀**（见方法说明） */
export const LEARNING_STATICS_PATHS = {
  summary: '/hr/zhdj-study-statics/summary',
  byOrganizationChart: '/hr/zhdj-study-statics/by-organization-chart',
  byOrganization: '/hr/zhdj-study-statics/by-organization',
  byStaff: '/hr/zhdj-study-statics/by-staff',
} as const

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

export type StudyStatisticsRow = {
  id?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 学员统计
// ---------------------------------------------------------------------------

export type StudyStatisticsStudentQuery = {
  /** 学员工号 */
  staffCode?: string
  /** 学员姓名 */
  name?: string
  allLesson?: number | string
  startLesson?: number | string
  completeLessonMin?: number | string
  completeLessonMax?: number | string
  /**
   * 班级名称。页面是从**别的页面带 query 跳过来**的（`route.query.gradeName`），
   * 所以默认是 `undefined`、**不发送**（实测：无 query 时 URL 上没有这一项）。
   */
  gradeName?: string
  pageNo?: number
  pageSize?: number
}

/**
 * 学员统计的参数顺序。⚠️ 注意 `order`/`orderField` 在这一页**表单里也有**，
 * 于是对象展开时后写的覆盖先写的，但**键的位置留在第一次出现的地方** ——
 * 最终仍是 `order` 打头。实测 URL 印证了这一点。
 */
const STUDENT_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'allLesson', defaultValue: '' },
  { name: 'startLesson', defaultValue: '' },
  { name: 'completeLessonMin', defaultValue: '' },
  { name: 'completeLessonMax', defaultValue: '' },
  // ⚠️ 这一项的默认值是 **undefined**（不是空串）：页面从 route.query 取，
  // 取不到就是 undefined，`qs` 的 skipNulls 会把它丢掉。实测 URL 里确实没有它。
  { name: 'gradeName', defaultValue: undefined },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

// ---------------------------------------------------------------------------
// 讲师统计
// ---------------------------------------------------------------------------

export type StudyStatisticsTeacherQuery = {
  staffCode?: string
  name?: string
  /** 区间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStatisticsTeacherTimeRange 生成 */
  startTime?: string
  /** 区间止，**开区间**（结束日 +1 天） */
  endTime?: string
  pageNo?: number
  pageSize?: number
}

const TEACHER_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'startTime', defaultValue: '' },
  { name: 'endTime', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

// ---------------------------------------------------------------------------
// 班课统计
// ---------------------------------------------------------------------------

export type StudyStatisticsLessonQuery = {
  lessonTitle?: string
  /** 班级 id。候选见 `study-grade-search` */
  gradeId?: number
  /** 页面从班级列表跳过来时带的一个标记；平时不传 */
  isGradeListJump?: string | boolean
  /** 课堂类型 */
  type?: number | string
  /** 区间起；用 buildStudyStatisticsLessonTimeRange 生成 */
  startTimeCondition?: string
  /** 区间止，**开区间** */
  endTimeCondition?: string
  pageNo?: number
  pageSize?: number
}

/** 班课统计的参数顺序（空值会被丢掉，见 dropEmptyParams） */
const LESSON_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'lessonTitle', defaultValue: '' },
  { name: 'gradeId', defaultValue: undefined },
  { name: 'isGradeListJump', defaultValue: undefined },
  { name: 'type', defaultValue: '' },
  { name: 'startTimeCondition', defaultValue: '' },
  { name: 'endTimeCondition', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 班课统计那一页在 `customLoad` 里做的事：**把空值参数整个丢掉**。
 *
 * ```js
 * Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ''))
 * ```
 *
 * 实测：无筛选时浏览器只发 `?pageNo=1&pageSize=20&_t=…`。
 * **这一页与同域其它页相反**，别照抄隔壁。
 */
export function dropEmptyParams (
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  )
}

// ---------------------------------------------------------------------------
// 班级统计
// ---------------------------------------------------------------------------

/** 课堂类型三选一 —— 决定打哪个端点，也决定 body 的形状 */
export type GradeLessonKind = 'morning' | 'weekly' | 'monthly'

export type StudyStatisticsGradeQuery = {
  /**
   * 管理中心 id 列表（页面是多选）。
   * ⚠️ 页面挂载时会拉**全部**管理中心（`getAllCenter?roleId=`）灌进下拉，
   * **本能力不照抄**（设计 D6 / H35）。要用请自己拿 id。
   */
  managementCenterIdList?: Array<number | string>
  /** 班级名称 */
  gradeName?: string
  /** 区间起 `YYYY-MM-DD`；用 buildStudyStatisticsGradeRange 生成 */
  startDate?: string
  /** 区间止 `YYYY-MM-DD`。⚠️ 这一页的区间是**闭区间**、不是 +1 天，见 buildStudyStatisticsGradeRange */
  endDate?: string
  /** 月课堂专用：起始年/月，由 buildStudyStatisticsGradeRange 从区间里算出来 */
  year?: string
  month?: string
  endYear?: string
  endMonth?: string
  pageNo?: number
  pageSize?: number
}

/**
 * 班级统计的 body 键序 —— **不是 qs 顺序，是 JSON 键序**（`JSON.stringify` 保序）。
 *
 * 实测 body：
 * ```json
 * {"order":"","orderField":"","managementCenterIdList":[],"gradeName":"","pageNo":1,"pageSize":20,
 *  "startDate":"2026-09-21","endDate":"2026-09-21"}
 * ```
 *
 * ⚠️ 后四项（时间）在 `customLoad` 里**追加**上去，所以排在最后 —— 不是插进中间。
 */
const GRADE_BODY_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'managementCenterIdList', defaultValue: [] },
  { name: 'gradeName', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 月课堂那一支的三个字段名（页面把它拆成 year/month/endYear/endMonth） */
const GRADE_MONTHLY_KEYS = ['year', 'month', 'endYear', 'endMonth'] as const

// ---------------------------------------------------------------------------
// 学习统计
// ---------------------------------------------------------------------------

export type LearningStaticsPayload = {
  /** 班课 id */
  lessonId?: number | string
  /** 组织 id */
  organizationId?: number | string
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

function buildOrdered (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/** 把「结束日 +1 天」的区间算出来（与页面 `.add(1,'day')` 一致） */
function plusOneDayRange (
  startDate: string,
  endDate: string,
  label: string,
): { start: Date; endExclusive: Date } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`${label}区间应为 YYYY-MM-DD（或带时间的同格式字符串）`)
  }
  if (end.getTime() < start.getTime()) {
    throw new Error(`${label}区间的结束日必须不早于开始日`)
  }
  return { start, endExclusive: new Date(end.getTime() + 24 * 60 * 60 * 1000) }
}

function formatDateTime (date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** 讲师统计的时间区间 → `{ startTime, endTime }`（开区间） */
export function buildStudyStatisticsTeacherTimeRange (
  startDate: string,
  endDate: string,
): { startTime: string; endTime: string } {
  const { start, endExclusive } = plusOneDayRange(startDate, endDate, '讲师统计时间')
  return { startTime: formatDateTime(start), endTime: formatDateTime(endExclusive) }
}

/** 班课统计的时间区间 → `{ startTimeCondition, endTimeCondition }`（开区间） */
export function buildStudyStatisticsLessonTimeRange (
  startDate: string,
  endDate: string,
): { startTimeCondition: string; endTimeCondition: string } {
  const { start, endExclusive } = plusOneDayRange(startDate, endDate, '班课统计时间')
  return { startTimeCondition: formatDateTime(start), endTimeCondition: formatDateTime(endExclusive) }
}

/**
 * 班级统计的时间区间。
 *
 * ⚠️ **这一页与其他页相反：它不 +1 天，是闭区间。**
 * 页面的写法是 `dayjs(form.date[0]).format('YYYY-MM-DD')` 与
 * `dayjs(form.date[1]).format('YYYY-MM-DD')` —— 原样取两端、不加一天
 * （实测：默认区间「今天~今天」，body 里 `startDate` 与 `endDate` 都是今天）。
 *
 * 月课堂那一支还要按位置拆成四个字段：起始年/月、结束年/月。
 */
export function buildStudyStatisticsGradeRange (
  startDate: string,
  endDate: string,
  kind: GradeLessonKind,
): {
  startDate: string
  endDate: string
  year?: string
  month?: string
  endYear?: string
  endMonth?: string
} {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('班级统计日期区间应为 YYYY-MM-DD')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('班级统计日期区间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const ymd = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const base = { startDate: ymd(start), endDate: ymd(end) }
  if (kind !== 'monthly') return base
  return {
    ...base,
    year: String(start.getFullYear()),
    month: pad(start.getMonth() + 1),
    endYear: String(end.getFullYear()),
    endMonth: pad(end.getMonth() + 1),
  }
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

function text (name: string, description: string): ParamSpec {
  return { name, kind: 'text', required: false, description }
}

const STUDENT_PARAMS: ParamSpec[] = [
  text('staffCode', '学员工号'),
  text('name', '学员姓名'),
  { name: 'allLesson', kind: 'number', required: false, description: '总课次（取值语义未实测）' },
  { name: 'startLesson', kind: 'number', required: false, description: '已开始课次（未实测）' },
  { name: 'completeLessonMin', kind: 'number', required: false, description: '完成课次下限' },
  { name: 'completeLessonMax', kind: 'number', required: false, description: '完成课次上限' },
  text('gradeName', '班级**名称**。页面是从别的页带 query 跳过来的；不传就不发这一项（与其它页不同）'),
  ...PAGE_PARAMS,
]

const TEACHER_PARAMS: ParamSpec[] = [
  text('staffCode', '讲师工号'),
  text('name', '讲师姓名'),
  { name: 'startTime', kind: 'date', required: false, description: '区间起 `YYYY-MM-DD HH:mm:ss`' },
  { name: 'endTime', kind: 'date', required: false, description: '区间止，**开区间**（结束日 +1 天）' },
  ...PAGE_PARAMS,
]

const LESSON_PARAMS: ParamSpec[] = [
  text('lessonTitle', '班课名称'),
  {
    name: 'gradeId',
    kind: 'search',
    required: false,
    description: '班级 id。**先问用户关键字**再调 study-grade-search 取候选，不要猜 id',
    lookup: { capabilityId: 'study-grade-search', keywordParam: 'keyword' },
  },
  text('isGradeListJump', '从班级列表跳过来时的标记；平时不传'),
  text('type', '课堂类型。页面是下拉但取值域未实测，只透传'),
  { name: 'startTimeCondition', kind: 'date', required: false, description: '区间起' },
  { name: 'endTimeCondition', kind: 'date', required: false, description: '区间止，**开区间**' },
  ...PAGE_PARAMS,
]

const GRADE_PARAMS: ParamSpec[] = [
  {
    name: 'managementCenterIdList',
    kind: 'tree',
    required: false,
    description:
      '管理中心 id 列表。⚠️ 页面挂载时拉的是**全部**管理中心（`getAllCenter?roleId=`），' +
      '无头不照抄（设计 D6 / H35）；要用请自己给 id',
  },
  text('gradeName', '班级名称'),
  {
    name: 'startDate',
    kind: 'date',
    required: false,
    description: '区间起 `YYYY-MM-DD`。⚠️ 这一页是**闭区间**，不是别处那个「结束日 +1 天」',
  },
  { name: 'endDate', kind: 'date', required: false, description: '区间止 `YYYY-MM-DD`，**闭区间**' },
  ...PAGE_PARAMS,
]

const LEARNING_PARAMS: ParamSpec[] = [
  {
    name: 'lessonId',
    kind: 'search',
    required: true,
    description: '班课 id。**必填**：这个接口两边的统计都要它。候选请先问用户关键字',
  },
  {
    name: 'organizationId',
    kind: 'tree',
    required: true,
    description: '组织 id。**必填**：页面是两个下拉都选完才发请求',
  },
  ...PAGE_PARAMS,
]

export const studyStatisticsCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-statistics-student-list',
    title: '查询学员统计列表',
    pagePath: STUDY_STATISTICS_STUDENT_PAGE_PATH,
    permission: '/dashboard/statistics/student',
    write: false,
    params: STUDENT_PARAMS,
  },
  {
    id: 'study-statistics-teacher-list',
    title: '查询讲师统计列表',
    pagePath: STUDY_STATISTICS_TEACHER_PAGE_PATH,
    permission: '/dashboard/statistics/teacher',
    write: false,
    params: TEACHER_PARAMS,
  },
  {
    id: 'study-statistics-lesson-list',
    title: '查询班课统计列表',
    pagePath: STUDY_STATISTICS_LESSON_PAGE_PATH,
    permission: '/dashboard/statistics/lesson',
    write: false,
    params: LESSON_PARAMS,
  },
  {
    id: 'study-statistics-grade-list',
    title: '查询班级统计列表',
    pagePath: STUDY_STATISTICS_GRADE_PAGE_PATH,
    permission: '/dashboard/statistics/grade',
    write: false,
    params: GRADE_PARAMS,
  },
  {
    id: 'study-statistics-learning-summary',
    title: '查询学习统计（汇总 / 组织维度 / 个人维度）',
    pagePath: STUDY_STATISTICS_LEARNING_PAGE_PATH,
    permission: '/dashboard/statistics/learning',
    write: false,
    params: LEARNING_PARAMS,
  },
]

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走各页路径的推导结果 = 12 学习管理）。
 */
export function createStudyStatisticsCapability (
  /** 学员统计页 */
  requestStudent: PortalRequest,
  /** 讲师统计页 */
  requestTeacher: PortalRequest,
  /** 班课统计页 */
  requestLesson: PortalRequest,
  /** 班级统计页 */
  requestGrade: PortalRequest,
  /** 学习统计页 */
  requestLearning: PortalRequest,
) {
  /** 学习统计那四条打的是 `/hr/zhdj-study-statics/*`，页面把 `/admin-api` 写在了前面 */
  const learningRequest = <T>(path: string, data: LearningStaticsPayload): Promise<T> =>
    requestLearning<T>({ url: `/admin-api${path}`, method: 'post', data })

  return {
    /** 分页查询学员统计。只读 */
    listStudents (query: StudyStatisticsStudentQuery = {}): Promise<PageResult<StudyStatisticsRow>> {
      return requestStudent<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_STUDENT_LIST_PATH,
        method: 'get',
        params: buildOrdered(STUDENT_ORDER, query as Record<string, unknown>),
      })
    },

    /** 分页查询讲师统计。只读 */
    listTeachers (query: StudyStatisticsTeacherQuery = {}): Promise<PageResult<StudyStatisticsRow>> {
      return requestTeacher<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_TEACHER_LIST_PATH,
        method: 'get',
        params: buildOrdered(TEACHER_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 分页查询班课统计。只读。
     *
     * ⚠️ 这一页的**空值参数会被丢掉**（`dropEmptyParams`），所以无筛选时 URL 上
     * 只有 `pageNo`/`pageSize` —— 这是刻意复刻页面的行为，不是少写了参数。
     */
    listLessons (query: StudyStatisticsLessonQuery = {}): Promise<PageResult<StudyStatisticsRow>> {
      const built = buildOrdered(LESSON_ORDER, query as Record<string, unknown>)
      return requestLesson<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_LESSON_LIST_PATH,
        method: 'get',
        params: dropEmptyParams(built),
      })
    },

    /**
     * 分页查询班级统计。**POST**，body 是 JSON（键序 = 页面实测的那一份）。
     *
     * `kind` 三选一决定打哪个端点；`monthly` 那一支的 body 会多出四个字段
     * （`year`/`month`/`endYear`/`endMonth`），由 `buildStudyStatisticsGradeRange` 从区间里拆。
     */
    async listGradeLessons (
      kind: GradeLessonKind,
      query: StudyStatisticsGradeQuery = {},
    ): Promise<PageResult<StudyStatisticsRow>> {
      // `async` 是**刻意**的：参数错误要走 Promise.reject，不是同步抛
      // ——与其它能力的 list 一致，调用方 `await` 时才能接住
      if (!Object.prototype.hasOwnProperty.call(STUDY_STATISTICS_GRADE_LESSON_PATHS, kind)) {
        throw new Error(`kind 只能是 morning / weekly / monthly，收到的是 ${JSON.stringify(kind)}`)
      }
      const body: Record<string, unknown> = buildOrdered(GRADE_BODY_ORDER, {
        ...query,
        // 月课堂那一支的四个字段不在 GRADE_BODY_ORDER 里（是追加的），单独取
        ...Object.fromEntries(
          GRADE_MONTHLY_KEYS.map((key) => [key, (query as Record<string, unknown>)[key]]),
        ),
      })
      // 页面在 customLoad 里追加时间字段 —— 追加，不是插入，所以排在最后
      if (query.startDate !== undefined) body.startDate = query.startDate
      if (query.endDate !== undefined) body.endDate = query.endDate
      if (kind === 'monthly') {
        for (const key of GRADE_MONTHLY_KEYS) {
          if (query[key] !== undefined) body[key] = query[key]
        }
      }
      return requestGrade<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_GRADE_LESSON_PATHS[kind],
        method: 'post',
        data: body,
      })
    },

    /**
     * 学习统计：汇总 + 组织维度（图表 / 表格）+ 个人维度（分页）。**四个 POST，只读**。
     *
     * 页面上这四条是**并发**发的（`Promise.allSettled`），任一条失败不影响其余 ——
     * 这里保持同样的语义：返回每一路的结果与错误，不因为一条挂了就整体抛。
     *
     * ⚠️ 路径按页面原样写成了 `/admin-api/hr/…`（页面源码里就是这么拼的）。
     * `platform.js` 的前缀拦截器对已带 `/admin-api` 的不再补，所以这是**刻意**的。
     */
    async learningSummary (payload: LearningStaticsPayload): Promise<{
      summary: unknown
      byOrganizationChart: unknown
      byOrganization: unknown
      byStaff: unknown
      errors: Record<string, string>
    }> {
      const errors: Record<string, string> = {}
      const settle = async (key: string, path: string, data: LearningStaticsPayload): Promise<unknown> => {
        try {
          return await learningRequest(path, data)
        } catch (error) {
          errors[key] = error instanceof Error ? error.message : String(error)
          return null
        }
      }
      const [summary, byOrganizationChart, byOrganization, byStaff] = await Promise.all([
        settle('summary', LEARNING_STATICS_PATHS.summary, payload),
        settle('byOrganizationChart', LEARNING_STATICS_PATHS.byOrganizationChart, payload),
        settle('byOrganization', LEARNING_STATICS_PATHS.byOrganization, payload),
        settle('byStaff', LEARNING_STATICS_PATHS.byStaff, {
          ...payload,
          pageNo: payload.pageNo ?? 1,
          pageSize: payload.pageSize ?? DEFAULT_PAGE_SIZE,
        }),
      ])
      return { summary, byOrganizationChart, byOrganization, byStaff, errors }
    },
  }
}

export type StudyStatisticsCapability = ReturnType<typeof createStudyStatisticsCapability>
