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

// ---------------------------------------------------------------------------
// 隐藏子路由 / 弹窗发出的那一批请求（本轮补齐）
//
// 覆盖判据是「页面只要有**任一**能力指向它就算完成」，于是 `lesson/[staffCode]/item-list.vue`、
// `course/[staffCode]/`、`score/[staffCode]/`、`student/lesson/detail/[lessonId].vue`
// 这些**隐藏子路由**、以及 `grade/components/record.vue`（弹窗）与
// `learning/components/action-details.vue`（弹窗）发出的请求整块漏掉了。
//
// 它们都**没有菜单项**，但都由列表行/按钮实际 push 或 createModal 到达，所以仍属于对应页面的能力范围。
// 每个能力的 `pagePath` 因此绑**可达的父菜单页**（与 `study-course.ts` 处理隐藏 IM 路由同一做法）。
// ---------------------------------------------------------------------------

/** 班级统计「课堂内容」弹窗：`getGradeLessonRecord`。`lessonIds` 是**逗号分隔**的字符串（见下） */
export const STUDY_STATISTICS_GRADE_RECORD_PATH = '/study/statistics/getGradeLessonRecord'
/** 学习统计「个人维度」行上点「是」弹出的明细：`action-details`，路径**自带 `/admin-api`** */
export const STUDY_STATISTICS_ACTION_DETAILS_PATH = '/admin-api/hr/zhdj-study-statics/action-details'
/** 学员统计「实学班课数」下钻列表页：`studentLessonStatisticsList` */
export const STUDY_STATISTICS_STUDENT_LESSON_LIST_PATH = '/study/statistics/studentLessonStatisticsList'
/** 学员班课明细页：`studentLessonDetail`（**不分页**，返回数组） */
export const STUDY_STATISTICS_STUDENT_LESSON_DETAIL_PATH = '/study/statistics/studentLessonDetail'
/** 讲师统计「讲授课程数量」下钻 */
export const STUDY_STATISTICS_TEACHER_COURSE_LIST_PATH = '/study/statistics/teacherCourseList'
/** 讲师统计「讲师班课数量」下钻 */
export const STUDY_STATISTICS_TEACHER_LESSON_LIST_PATH = '/study/statistics/teacherLessonList'
/** 讲师统计「整体评价」下钻（得分明细） */
export const STUDY_STATISTICS_TEACHER_SCORE_LIST_PATH = '/study/statistics/teacherScoreList'

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
// 隐藏子路由 / 弹窗的查询类型
// ---------------------------------------------------------------------------

/**
 * 「课堂内容」弹窗的入参。
 *
 * ⚠️ **只有 `lessonIds` 一个参数**（弹窗里就是 `http.get(url, { params: { lessonIds } })`），
 * **没有** `order`/`orderField`/`pageNo`/`pageSize` —— 它不是列表模块发的请求。
 *
 * ⚠️ `lessonIds` 是**逗号分隔的字符串**（后端 `lessonIds.split(",")`），不是数组，
 * 也不是重复参数。它在页面上来自班级统计行的 `record.lessonIds`（`GradeLessonCountDTO.lessonIds`）。
 */
export type StudyStatisticsGradeRecordQuery = {
  /** 班课 id 列表。数组会被拼成逗号分隔字符串（页面就是这个形状） */
  lessonIds: Array<number | string> | string
}

/**
 * 「学习/转发明细」弹窗的入参。
 *
 * 页面只传三个字段，键序就是下面这个顺序（`handleActionDetailClick` 里现拼的对象）。
 * `startDate`/`endDate` 后端 DTO 有，但**页面从不传**，所以本能力不开放。
 */
export type StudyStatisticsActionDetailsQuery = {
  /** 课程 id（章或节）。来自个人维度行的勾选上下文，**不是**本地班课 id */
  lessonId: number | string
  /** 员工 id（`hr_staff.id`）。来自个人维度行的 `record.staffId` */
  staffId: number | string
  /** 行为类型。页面只会传 1（学习）或 5（转发），见 ACTION_TYPE_OPTIONS */
  actionType: number
}

/**
 * 个人维度那一列「学习 / 转发」到 `actionType` 的映射。
 *
 * **实测自源码**（`learning/list.vue:234-242`）：
 * `hasView → 1`、`hasForward → 5`；页面只有这两列入参。
 * 后端支持的 2/3/4（点赞/收藏/评论）在**这一页上没有入口**，所以本能力按页面只开放 1 与 5。
 */
export const ACTION_DETAILS_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '学习', value: 1 },
  { label: '转发', value: 5 },
]

/** 学员班课明细（下钻列表页 `/dashboard/statistics/student/lesson/item-list`）的查询条件 */
export type StudyStatisticsStudentLessonQuery = {
  /** 学员工号。来自父页 push 过来的 `route.query.staffCode` */
  staffCode?: string | number
  /**
   * 是否已开始。父页「实学班课数」列跳转时传 `1`。
   * 后端注释：由学员统计列表点击「实学班课数」、或班课统计点击「实际学习人数」跳转时传 1，其余时候不传。
   */
  isStarted?: string | number
  /** 学员姓名 */
  staffName?: string
  /** 学员电话 */
  mobile?: string | number
  /** 班课 id。从班课统计跳过来时带 `route.query.lessonId` */
  lessonId?: string | number
  /** 班课名称 */
  lessonTitle?: string
  /** 课堂类型，字典 `lesson_type`（取值域未实测） */
  lessonType?: string | number
  /** 所属班级 id */
  gradeId?: string | number
  /** 班课状态，字典 `lesson_study_status`（取值域未实测） */
  status?: string | number
  /** 开课时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStatisticsLessonTimeRange 生成 */
  startTimeCondition?: string
  /** 开课时间止，**开区间**（结束日 +1 天） */
  endTimeCondition?: string
  order?: string
  orderField?: string
  pageNo?: number
  pageSize?: number
}

/** 学员班课明细页（`detail/[lessonId].vue`）的查询条件。**不分页** */
export type StudyStatisticsStudentLessonDetailQuery = {
  /** 学员工号 */
  staffCode?: string | number
  /** 班课 id。来自路由参数 `[lessonId]` */
  lessonId?: string | number
}

/** 讲师统计三个下钻页共用的分页参数 */
export type StudyStatisticsTeacherCourseQuery = {
  /** 讲师工号。来自路由参数 `[staffCode]` */
  staffCode?: string | number
  /** 课程类型，字典 `course_type`（取值域未实测） */
  type?: string | number
  /** 讲授时间。⚠️ 这一页是 `a-date-picker` **单选**，不是区间，所以只有一个字段、没有 +1 天 */
  startTime?: string
  order?: string
  orderField?: string
  pageNo?: number
  pageSize?: number
}

export type StudyStatisticsTeacherLessonQuery = {
  /** 讲师工号。来自路由参数 `[staffCode]` */
  staffCode?: string | number
  /** 班课名称 */
  title?: string
  /** 评分人数下限 */
  appraiseNumMin?: string | number
  /** 评分人数上限 */
  appraiseNumMax?: string | number
  /** 平均得分下限 */
  avgScoreMin?: string | number
  /** 平均得分上限 */
  avgScoreMax?: string | number
  order?: string
  orderField?: string
  pageNo?: number
  pageSize?: number
}

export type StudyStatisticsTeacherScoreQuery = {
  /** 讲师工号。来自路由参数 `[staffCode]` */
  staffCode?: string | number
  /** 评价总分下限 */
  allScoreMin?: string | number
  /** 评价总分上限 */
  allScoreMax?: string | number
  /** 评分时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStatisticsTeacherScoreTimeRange 生成 */
  startTimeFrom?: string
  /** 评分时间止，**开区间**（结束日 +1 天）。⚠️ 字段名是 `startTimeEnd`，不是 `endTime` */
  startTimeEnd?: string
  order?: string
  orderField?: string
  pageNo?: number
  pageSize?: number
}

/**
 * 学员班课明细列表的参数顺序。
 *
 * 依据是 `student/lesson/item-list.vue` 的 `form` 键序与列表模块的拼装方式
 * （`common/libs/renren/list.js:470-482`：`{ order, orderField, ...formState, pageNo, pageSize }`，
 * 重复键保留**第一次出现的位置**）：
 *
 * ```text
 * order, orderField, staffCode, isStarted, staffName, mobile, lessonId, lessonTitle,
 * lessonType, gradeId, status, startTimeCondition, endTimeCondition, pageNo, pageSize
 * ```
 *
 * ⚠️ `staffCode` / `isStarted` / `lessonId` / `status` 的初值来自 `route.query.*`，
 * 取不到就是 `undefined` —— qs 的 `skipNulls` 会把它们**整个丢掉**（与同页 `gradeId` 的
 * 空串不同）。所以这几项的默认值必须是 `undefined`，不是空串。
 *
 * ⚠️ `startTimeCondition` / `endTimeCondition` 是 `convertFetchForm` **追加**上去的
 * （`omit(data, ['date'])` 之后展开），所以排在 `status` 之后、分页参数之前。
 */
const STUDENT_LESSON_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: undefined },
  { name: 'isStarted', defaultValue: undefined },
  { name: 'staffName', defaultValue: '' },
  { name: 'mobile', defaultValue: '' },
  { name: 'lessonId', defaultValue: undefined },
  { name: 'lessonTitle', defaultValue: '' },
  { name: 'lessonType', defaultValue: '' },
  { name: 'gradeId', defaultValue: '' },
  { name: 'status', defaultValue: undefined },
  { name: 'startTimeCondition', defaultValue: '' },
  { name: 'endTimeCondition', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 学员班课明细页（`detail/[lessonId].vue`）的参数顺序。
 *
 * 这一页**没有** `getDataListIsPage`，所以列表模块**不加** `pageNo`/`pageSize`
 * （`list.js:479` 那个 `if`）—— 顺序就是 `order, orderField, staffCode, lessonId`。
 * 少了这一条会多发两个后端不认的参数，而它是一个不分页的数组接口。
 */
const STUDENT_LESSON_DETAIL_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'lessonId', defaultValue: '' },
]

/** 讲师讲授课程明细：`form` 键序 staffCode, type, startTime + 分页 */
const TEACHER_COURSE_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'type', defaultValue: '' },
  { name: 'startTime', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 讲师讲授班课明细：`form` 键序 staffCode, title, appraiseNumMin/Max, avgScoreMin/Max + 分页 */
const TEACHER_LESSON_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'appraiseNumMin', defaultValue: '' },
  { name: 'appraiseNumMax', defaultValue: '' },
  { name: 'avgScoreMin', defaultValue: '' },
  { name: 'avgScoreMax', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 得分明细：`omit(form,'date')` 之后**追加** startTimeFrom/startTimeEnd，再排 pageNo/pageSize */
const TEACHER_SCORE_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'allScoreMin', defaultValue: '' },
  { name: 'allScoreMax', defaultValue: '' },
  { name: 'startTimeFrom', defaultValue: '' },
  { name: 'startTimeEnd', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 把 `lessonIds` 归一成后端认的**逗号分隔字符串**。
 *
 * 依据是后端 `StatisticsServiceImpl.getGradeLessonRecord`：
 * `StringUtils.isBlank(lessonIds) → 返回空列表`；否则 `lessonIds.split(",")`。
 * 空串与空数组都返回空结果，所以本地直接拦住"什么都没选"那次调用。
 *
 * ⚠️ 后端拿到之后会 `Arrays.stream(ids).sorted(Collections.reverseOrder())` ——
 * **按字符串倒序重排**（不是按数值、也不是保持传入顺序），
 * 所以返回数组的顺序与传入顺序**不一致**，调用方不能按下标对齐。
 */
function joinLessonIds (value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error('lessonIds 不能为空数组：后端对空值是直接返回空列表，不是"查全部"')
    return value.map((item, index) => {
      const text = typeof item === 'number' ? String(item) : String(item ?? '').trim()
      if (text === '') throw new Error(`lessonIds[${index}] 不能为空`)
      return text
    }).join(',')
  }
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error('lessonIds 不能为空：传班课 id 数组（或逗号分隔字符串）')
}

/**
 * 得分明细页的时间区间 → `{ startTimeFrom, startTimeEnd }`。
 *
 * 与讲师统计页同一套 `+1 天` 开区间（`convertFetchForm` 里是 `.add(1,'day')`），
 * 只是**字段名不同**（`startTimeFrom`/`startTimeEnd`）。
 */
export function buildStudyStatisticsTeacherScoreTimeRange (
  startDate: string,
  endDate: string,
): { startTimeFrom: string; startTimeEnd: string } {
  const { start, endExclusive } = plusOneDayRange(startDate, endDate, '得分明细评分时间')
  return { startTimeFrom: formatDateTime(start), startTimeEnd: formatDateTime(endExclusive) }
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

const STUDENT_LESSON_PARAMS: ParamSpec[] = [
  {
    name: 'staffCode',
    kind: 'text',
    required: false,
    description:
      '学员工号。父页「实学班课数」列跳转时带过来；**不传就不发这一项**（页面初值是 route.query）',
  },
  {
    name: 'isStarted',
    kind: 'number',
    required: false,
    description:
      '是否已开始。父页跳转时传 1（后端注释：由学员统计「实学班课数」或班课统计「实际学习人数」跳转时传 1）；不传就不发',
  },
  text('staffName', '学员姓名'),
  text('mobile', '学员电话'),
  {
    name: 'lessonId',
    kind: 'search',
    required: false,
    description:
      '班课 id。从班课统计「实际学习人数」跳过来时才带；候选见班课统计的 lessonTitle 检索结果，不要猜 id',
  },
  text('lessonTitle', '班课名称'),
  text('lessonType', '课堂类型（字典 lesson_type，取值域未实测，只透传）'),
  {
    name: 'gradeId',
    kind: 'search',
    required: false,
    description: '所属班级 id。**先问用户关键字**再调 study-grade-search 取候选，不要猜 id',
    lookup: { capabilityId: 'study-grade-search', keywordParam: 'keyword' },
  },
  text('status', '班课状态（字典 lesson_study_status，取值域未实测，只透传）'),
  {
    name: 'startTimeCondition',
    kind: 'date',
    required: false,
    description: '开课时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStatisticsLessonTimeRange 生成（开区间）',
  },
  {
    name: 'endTimeCondition',
    kind: 'date',
    required: false,
    description: '开课时间止，**开区间**（结束日 +1 天）；**必须与 startTimeCondition 成对**',
  },
  ...PAGE_PARAMS,
]

const STUDENT_LESSON_DETAIL_PARAMS: ParamSpec[] = [
  text('staffCode', '学员工号'),
  { name: 'lessonId', kind: 'number', required: false, description: '班课 id（来自下钻列表行）' },
]

const TEACHER_COURSE_PARAMS: ParamSpec[] = [
  text('staffCode', '讲师工号（来自下钻路由的 [staffCode]）'),
  text('type', '课程类型（字典 course_type，取值域未实测，只透传）'),
  {
    name: 'startTime',
    kind: 'date',
    required: false,
    description:
      '讲授时间，`YYYY-MM-DD HH:mm:ss`。⚠️ 这一页是**单选日期**，不是区间 —— 没有"结束日 +1 天"那回事',
  },
  ...PAGE_PARAMS,
]

const TEACHER_LESSON_PARAMS: ParamSpec[] = [
  text('staffCode', '讲师工号（来自下钻路由的 [staffCode]）'),
  text('title', '班课名称'),
  { name: 'appraiseNumMin', kind: 'number', required: false, description: '评分人数下限' },
  { name: 'appraiseNumMax', kind: 'number', required: false, description: '评分人数上限' },
  { name: 'avgScoreMin', kind: 'number', required: false, description: '平均得分下限' },
  { name: 'avgScoreMax', kind: 'number', required: false, description: '平均得分上限' },
  ...PAGE_PARAMS,
]

const TEACHER_SCORE_PARAMS: ParamSpec[] = [
  text('staffCode', '讲师工号（来自下钻路由的 [staffCode]）'),
  { name: 'allScoreMin', kind: 'number', required: false, description: '评价总分下限' },
  { name: 'allScoreMax', kind: 'number', required: false, description: '评价总分上限' },
  {
    name: 'startTimeFrom',
    kind: 'date',
    required: false,
    description: '评分时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStatisticsTeacherScoreTimeRange 生成',
  },
  {
    name: 'startTimeEnd',
    kind: 'date',
    required: false,
    description:
      '评分时间止，**开区间**（结束日 +1 天）。⚠️ 字段名是 `startTimeEnd`（不是 endTime），别照抄讲师统计页',
  },
  ...PAGE_PARAMS,
]

const ACTION_DETAILS_PARAMS: ParamSpec[] = [
  {
    name: 'lessonId',
    kind: 'number',
    required: true,
    description:
      '课程（章或节）id。**不是**本地班课 id：它来自学习统计页课程级联选择器选中的末节点' +
      '（`smart-layer-app` 实例的 `/api/zhdj/studyLessonCatalogue/getChapterTree`）',
  },
  {
    name: 'staffId',
    kind: 'number',
    required: true,
    description: '员工 id（`hr_staff.id`），来自学习统计个人维度行的 `record.staffId`。**不是**工号',
  },
  {
    name: 'actionType',
    kind: 'enum',
    required: true,
    description:
      '行为类型。页面只在个人维度「学习」「转发」两列上开入口，所以本能力只开放 1 与 5；' +
      '后端还支持 2/3/4，但**这一页没有入口**',
    options: ACTION_DETAILS_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
]

const GRADE_RECORD_PARAMS: ParamSpec[] = [
  {
    name: 'lessonIds',
    kind: 'array',
    required: true,
    description:
      '班课 id 数组（会拼成逗号分隔字符串）。来自班级统计行的 `record.lessonIds`；' +
      '后端把它 split(",") 后**按字符串倒序**处理，所以返回顺序与传入顺序不一致',
  },
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
    id: 'study-statistics-student-lesson-list',
    title: '查询学员班课明细列表（学员统计下钻）',
    pagePath: STUDY_STATISTICS_STUDENT_PAGE_PATH,
    permission: '/dashboard/statistics/student',
    write: false,
    params: STUDENT_LESSON_PARAMS,
  },
  {
    id: 'study-statistics-student-lesson-detail',
    title: '查询学员班课的环节明细（学员统计下钻）',
    pagePath: STUDY_STATISTICS_STUDENT_PAGE_PATH,
    permission: '/dashboard/statistics/student',
    write: false,
    params: STUDENT_LESSON_DETAIL_PARAMS,
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
    id: 'study-statistics-teacher-course-list',
    title: '查询讲师讲授课程明细（讲师统计下钻）',
    pagePath: STUDY_STATISTICS_TEACHER_PAGE_PATH,
    permission: '/dashboard/statistics/teacher',
    write: false,
    params: TEACHER_COURSE_PARAMS,
  },
  {
    id: 'study-statistics-teacher-lesson-list',
    title: '查询讲师讲授班课明细（讲师统计下钻）',
    pagePath: STUDY_STATISTICS_TEACHER_PAGE_PATH,
    permission: '/dashboard/statistics/teacher',
    write: false,
    params: TEACHER_LESSON_PARAMS,
  },
  {
    id: 'study-statistics-teacher-score-list',
    title: '查询讲师得分明细（讲师统计下钻）',
    pagePath: STUDY_STATISTICS_TEACHER_PAGE_PATH,
    permission: '/dashboard/statistics/teacher',
    write: false,
    params: TEACHER_SCORE_PARAMS,
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
  {
    id: 'study-statistics-learning-action-details',
    title: '查询学员学习/转发明细（学习统计下钻）',
    pagePath: STUDY_STATISTICS_LEARNING_PAGE_PATH,
    permission: '/dashboard/statistics/learning',
    write: false,
    params: ACTION_DETAILS_PARAMS,
  },
  {
    id: 'study-statistics-grade-lesson-record',
    title: '查询班级课堂内容记录（班级统计下钻）',
    pagePath: STUDY_STATISTICS_GRADE_PAGE_PATH,
    permission: '/dashboard/statistics/grade',
    write: false,
    params: GRADE_RECORD_PARAMS,
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

    /**
     * 学员统计下钻：某个学员的班课明细分页。只读。
     *
     * 参数顺序见 `STUDENT_LESSON_ORDER` 的注释；`staffCode`/`isStarted`/`lessonId`/`status`
     * 这几项**不传就整个不发**（页面初值来自 `route.query`，是 `undefined`）。
     */
    listStudentLessons (
      query: StudyStatisticsStudentLessonQuery = {},
    ): Promise<PageResult<StudyStatisticsRow>> {
      return requestStudent<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_STUDENT_LESSON_LIST_PATH,
        method: 'get',
        params: buildOrdered(STUDENT_LESSON_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 学员统计下钻的下一层：某个学员在某个班课里的**环节**明细。只读。
     *
     * ⚠️ 这个接口**不分页**：页面没写 `getDataListIsPage`，列表模块就不加
     * `pageNo`/`pageSize`（`list.js:479`），后端也返回数组（`CommonResult<List<AppLessonLinkDTO>>`）。
     * SDK 因此返回**数组**而不是 `{list,total}` —— 与同域其它列表能力不同形，这是刻意的。
     */
    listStudentLessonDetail (
      query: StudyStatisticsStudentLessonDetailQuery = {},
    ): Promise<StudyStatisticsRow[]> {
      return requestStudent<StudyStatisticsRow[]>({
        url: STUDY_STATISTICS_STUDENT_LESSON_DETAIL_PATH,
        method: 'get',
        params: buildOrdered(STUDENT_LESSON_DETAIL_ORDER, query as Record<string, unknown>),
      })
    },

    /** 讲师统计下钻：某讲师讲授过的**课程**明细分页。只读 */
    listTeacherCourses (
      query: StudyStatisticsTeacherCourseQuery = {},
    ): Promise<PageResult<StudyStatisticsRow>> {
      return requestTeacher<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_TEACHER_COURSE_LIST_PATH,
        method: 'get',
        params: buildOrdered(TEACHER_COURSE_ORDER, query as Record<string, unknown>),
      })
    },

    /** 讲师统计下钻：某讲师讲授过的**班课**明细分页（含 1~5 题均分与总均分）。只读 */
    listTeacherLessons (
      query: StudyStatisticsTeacherLessonQuery = {},
    ): Promise<PageResult<StudyStatisticsRow>> {
      return requestTeacher<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_TEACHER_LESSON_LIST_PATH,
        method: 'get',
        params: buildOrdered(TEACHER_LESSON_ORDER, query as Record<string, unknown>),
      })
    },

    /** 讲师统计下钻：某讲师收到的**逐条评分**明细分页。只读 */
    listTeacherScores (
      query: StudyStatisticsTeacherScoreQuery = {},
    ): Promise<PageResult<StudyStatisticsRow>> {
      return requestTeacher<PageResult<StudyStatisticsRow>>({
        url: STUDY_STATISTICS_TEACHER_SCORE_LIST_PATH,
        method: 'get',
        params: buildOrdered(TEACHER_SCORE_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 学习统计下钻：「学习 / 转发」列上点「是」弹出的明细。**读**，返回**数组**。
     *
     * 路径按页面原样写成了 `/admin-api/hr/zhdj-study-statics/action-details`
     * （`platform.js` 的前缀拦截器对已带 `/admin-api` 的不再补），与同页那四个 POST 同源。
     *
     * ⚠️ `lessonId` 是**智慧蛋鸡的课程/章节 id**，`staffId` 是 `hr_staff.id` —— 两者都不是
     * 本地班课 id 或工号，不能互相顶替。
     */
    async listLearningActionDetails (
      query: StudyStatisticsActionDetailsQuery,
    ): Promise<StudyStatisticsRow[]> {
      // `async` 是刻意的：参数错误走 Promise.reject，不是同步抛（与其它能力一致）
      const actionType = query?.actionType
      if (!ACTION_DETAILS_TYPE_OPTIONS.some((item) => item.value === actionType)) {
        throw new Error(
          `actionType 只能是 1（学习）或 5（转发）—— 这是学习统计页个人维度上仅有的两个入口，` +
            `收到的是 ${JSON.stringify(actionType)}`,
        )
      }
      if (query?.lessonId === undefined || query.lessonId === null || String(query.lessonId).trim() === '') {
        throw new Error('lessonId（课程/章节 id）必填')
      }
      if (query?.staffId === undefined || query.staffId === null || String(query.staffId).trim() === '') {
        throw new Error('staffId（员工 id）必填')
      }
      // 键序与页面自己拼的对象一致：lessonId, staffId, actionType
      return requestLearning<StudyStatisticsRow[]>({
        url: STUDY_STATISTICS_ACTION_DETAILS_PATH,
        method: 'post',
        data: {
          lessonId: query.lessonId,
          staffId: query.staffId,
          actionType,
        },
      })
    },

    /**
     * 班级统计下钻：「课堂内容」弹窗里那个课堂记录。**读**，返回**数组**。
     *
     * ⚠️ 参数只有 `lessonIds`，**没有** `order`/`pageNo` 那一套 —— 它不是列表模块发的请求。
     * 传数组会按逗号拼成后端认的字符串；空值在本地就拦住（后端对空值是直接返回空列表，
     * 而不是"查全部"，静默返回空会让人以为"这个班没有课堂内容"）。
     *
     * ⚠️ 后端对 id 做**字符串倒序**排序后再逐个取，所以返回数组的顺序**不代表**输入顺序。
     */
    async listGradeLessonRecords (
      query: StudyStatisticsGradeRecordQuery,
    ): Promise<StudyStatisticsRow[]> {
      const lessonIds = joinLessonIds(query?.lessonIds)
      return requestGrade<StudyStatisticsRow[]>({
        url: STUDY_STATISTICS_GRADE_RECORD_PATH,
        method: 'get',
        params: { lessonIds },
      })
    },
  }
}

export type StudyStatisticsCapability = ReturnType<typeof createStudyStatisticsCapability>
