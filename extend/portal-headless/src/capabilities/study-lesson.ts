import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 课堂（班课）—— 学习管理域「课堂管理」下的三个列表页。
 *
 * | 页面 | 菜单路径 | 路由文件 | 列表的 type |
 * | --- | --- | --- | --- |
 * | 晨课堂 | `/dashboard/lesson/daily-lesson/list` | `…/education/lesson/daily-lesson/list.vue` | `'1'` |
 * | 周课堂 | `/dashboard/lesson/weekly-lesson/list` | `…/education/lesson/weekly-lesson/list.vue` | `'2'` |
 * | 月课堂 | `/dashboard/lesson/monthly-lesson/list` | `…/education/lesson/monthly-lesson/list.vue` | `'3'` |
 *
 * 三页打**同一个**接口 `GET /study/lesson/studylesson/lessonList`，
 * 靠**表单里的 `type`** 区分（不是 URL 上的 query —— 这一点与课程域那三页相反，
 * 见 `src/capabilities/study-course.ts`）。
 *
 * ## 参数顺序是从源码推出来的，不是抄基准

 * `common/libs/renren/list.js:473-483` 把参数拼成：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * ```
 *
 * ⇒ 顺序恒为 **`order` → `orderField` → `convertFetchForm` 的返回值 → `pageNo` → `pageSize` → `_t`**。
 * 所以每个能力的参数表就是「那三页各自的 `convertFetchForm` 返回值」原样展开，
 * 前面补 `order`/`orderField`（页面没有这两个控件，钉死成空串）、后面补分页。
 *
 * 三页的 `convertFetchForm` **各不相同**（这点也和时间/课程那两组不同）：
 *
 * - **晨课堂**：`type, title, gradeNames, status, createTimeStart/End, startTimeStart/End`
 * - **周课堂**：`title, gradeNames, type, linkNum, teacherName, publishTimeStart/End,
 *   createTimeStart/End, startTimeStart/End, endTimeStart/End`（字段多一倍）
 * - **月课堂**：与晨课堂**同名同序**，只差时间格式（见下）
 *
 * ## 时间格式：三页里有两种，别照抄隔壁
 *
 * | 页面 | 起止两端 | 结束端 |
 * | --- | --- | --- |
 * | 晨课堂 | `YYYY-MM-DD 00:00:00` | `date[1].add(1,'day')` 后同样格式 |
 * | 周课堂 | `YYYY-MM-DD HH:mm:ss` | `date[1].add(1,'day')` |
 * | 月课堂 | `YYYY-MM-DD HH:mm:ss` | `date[1].add(1,'day')` |
 *
 * 晨课堂那一页的格式串**没有 `HH:mm:ss` 占位**，写的是字面量 `00:00:00`
 * （`daily-lesson/list.vue` 的 `.format('YYYY-MM-DD 00:00:00')`）—— 所以它选出来的时间永远是零点。
 * 三页**都是结束日 +1 天的开区间**，与课程域那几个 `convertFetchForm` 一致。
 *
 * ## 可达写操作
 *
 * 列表页的创建、编辑、删除、发布，以及由列表页打开的课堂记录和学生管理页，
 * 都在本文件保留 Portal 的真实请求形状。写操作统一拆成
 * `prepare → submit → cancel`：prepare 只在本地校验并生成草稿，cancel 只取消本地
 * 草稿；Portal 没有对应的回滚接口，所以 cancel 不会假装撤销已经提交的后端副作用。
 *
 * `studyLessonCapabilities` 仍只保留历史三项列表定义，避免在主线接线尚未完成时改变
 * 既有目录数量；新增的动作定义由 `studyLessonActionCapabilities` 单独导出，主线稍后
 * 负责把它们接入目录/调用器。
 */

export const STUDY_LESSON_DAILY_PAGE_PATH = '/dashboard/lesson/daily-lesson/list'
export const STUDY_LESSON_WEEKLY_PAGE_PATH = '/dashboard/lesson/weekly-lesson/list'
export const STUDY_LESSON_MONTHLY_PAGE_PATH = '/dashboard/lesson/monthly-lesson/list'

const VIEWS = 'app/portal/views/dashboard/education/lesson'

/** 路由文件（三份 `list.vue`），写进文档与排障时用得上 */
export const STUDY_LESSON_ROUTE_FILES = {
  daily: `${VIEWS}/daily-lesson/list.vue`,
  weekly: `${VIEWS}/weekly-lesson/list.vue`,
  monthly: `${VIEWS}/monthly-lesson/list.vue`,
} as const

/** 列表按钮实际 push 到的隐藏表单/学生管理路由。能力的 pagePath 仍指向菜单页。 */
export const STUDY_LESSON_HIDDEN_ROUTE_FILES = {
  dailyForm: `${VIEWS}/daily-lesson/[mode]/[id].vue`,
  weeklyMeetingForm: `${VIEWS}/weekly-lesson/meeting/[mode]/[id].vue`,
  weeklyAssignmentForm: `${VIEWS}/weekly-lesson/assignment/[mode]/[id].vue`,
  monthlyVotingForm: `${VIEWS}/monthly-lesson/voting/[mode]/[id].vue`,
  monthlyNonvotingForm: `${VIEWS}/monthly-lesson/nonvoting/[mode]/[id].vue`,
  dailyStudentList: `${VIEWS}/daily-lesson/student/[id]/item-list.vue`,
  weeklyStudentList: `${VIEWS}/weekly-lesson/student/[id]/item-list.vue`,
  monthlyStudentList: `${VIEWS}/monthly-lesson/student/[id]/item-list.vue`,
} as const

/** 三页共用的列表接口 */
export const STUDY_LESSON_LIST_PATH = '/study/lesson/studylesson/lessonList'
export const STUDY_LESSON_DETAIL_PATH = '/study/lesson/studylesson'
export const STUDY_LESSON_SAVE_PATH = '/study/lesson/studylesson/saveLesson'
export const STUDY_LESSON_DELETE_PATH = '/study/lesson/studylesson'
export const STUDY_LESSON_PUBLISH_PATH = '/study/lesson/studylesson/publish'
export const STUDY_LESSON_PUBLISH_NO_PUSH_PATH = '/study/lesson/studylesson/publishAndNoPush'
export const STUDY_LESSON_MONTH_SAVE_PATH = '/study/lesson/studylesson/saveMonthLesson'
export const STUDY_LESSON_MONTH_INFO_PATH = '/study/lesson/studylesson/getMonthLessonInfo'
export const STUDY_LESSON_LAST_MONTH_PATH = '/study/lesson/studylesson/getLastMonthLessonByGradeId'
export const STUDY_LESSON_RECORD_PATH = '/study/lesson/lessonrecord/getLessonRecord'
export const STUDY_LESSON_ATTENDANCE_PATH = '/study/lesson/lessonrecord/selectAttendanceStatus'
export const STUDY_LESSON_STUDENT_MANAGE_PATH = '/study/lesson/lessonrecord/studentManage'
export const STUDY_LESSON_DAILY_RECORD_SAVE_PATH = '/study/lesson/studylesson/saveLessonRecordV1'
export const STUDY_LESSON_WEEKLY_RECORD_SAVE_PATH = '/study/lesson/lessonrecord/saveLessonRecordV1'
export const STUDY_LESSON_MONTHLY_RECORD_SAVE_PATH = '/study/lesson/lessonrecord/saveLessonRecord'
export const STUDY_LESSON_MONTH_RECORD_PATH = '/study/lesson/studylesson/monthLessonRecord'
export const STUDY_LESSON_STUDENT_LIST_PATH = '/study/lesson/studylessonstudentrel/studyStudentList'
export const STUDY_LESSON_STUDENT_MOVE_OUT_PATH = '/study/lesson/studylessonstudentrel/moveOut'
export const STUDY_LESSON_STUDENT_ATTENDANCE_TOGGLE_PATH = '/study/lesson/studylessonstudentrel/updateAttendanceStatus'
export const STUDY_LESSON_GRADE_INFO_PATH = '/study/grade/studygrade/getGradeInfo'
export const STUDY_LESSON_EMCEE_PATH = '/study/lesson/studylesson/getChooseEmcee'
export const STUDY_LESSON_WEEKLY_EXPORT_PATH = '/study/lesson/studylesson/exportWeekLesson'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/**
 * 班课列表行。
 *
 * 三页共用一套行结构（后端同一个接口），只是页面显示的列不同。
 * 字段名取自三份 `list.vue` 的 `columns`（实测：同一行的 `type` 是数字 1/2/3，
 * 而请求里的 `type` 是**字符串** `'1'/'2'/'3'` —— 两个别混）。
 */
export type StudyLessonRow = {
  id: string
  /** 班课名称 */
  title?: string
  /** 所属班级（多个用逗号/顿号连，页面按一列显示） */
  gradeNames?: string
  /** 出勤人数（晨课堂那一列） */
  studentTotal?: number
  /** 课堂类型：1 晨 2 周 3 月 */
  type?: number
  status?: number
  /** 周课堂的关联编号 */
  linkNum?: string
  teacherName?: string
  publishTime?: string
  createTime?: string
  startTime?: string
  endTime?: string
  [key: string]: unknown
}

/** 晨课堂 / 月课堂的查询条件（两页字段同名同序） */
export type StudyLessonDailyQuery = {
  title?: string
  gradeNames?: string
  status?: number | string
  /** 创建时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyLessonTimeRange 生成 */
  createTimeStart?: string
  createTimeEnd?: string
  /** 开课时间起；同上 */
  startTimeStart?: string
  startTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

/** 月课堂与晨课堂同形，单独起个名只为可读性 */
export type StudyLessonMonthlyQuery = StudyLessonDailyQuery

/** 周课堂的查询条件：比另外两页多出 linkNum / teacherName / 两组时间 */
export type StudyLessonWeeklyQuery = {
  title?: string
  gradeNames?: string
  linkNum?: string
  teacherName?: string
  publishTimeStart?: string
  publishTimeEnd?: string
  createTimeStart?: string
  createTimeEnd?: string
  startTimeStart?: string
  startTimeEnd?: string
  endTimeStart?: string
  endTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

export type StudyLessonId = string | number

/** Portal 表单字段原样保留；只有页面明确 omit/转换的字段由 prepare 处理。 */
export type StudyLessonForm = Record<string, unknown>
export type StudyLessonPayload = Record<string, unknown>

export type StudyLessonAttendanceRow = Record<string, unknown> & {
  lessonId?: StudyLessonId
  staffCode?: StudyLessonId
  attendanceStatus?: number
}

export type StudyLessonRecordFile = {
  fileUrl: string
  fileName?: string
}

export type StudyLessonFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

export type StudyLessonWeeklyExportInput = {
  lessonIdList: StudyLessonId[]
  lessonKind: 0 | 1
}

export type StudyLessonRecordForm = {
  lessonId: StudyLessonId
  lessonContentList?: unknown[]
  lessonPlan?: string
  records?: {
    thought?: unknown
    technology?: unknown
    management?: unknown
  }
  recordList?: unknown[]
  imgList?: string[]
  pdfList?: StudyLessonRecordFile[]
  imgUrl?: string
  pdfUrl?: string
  pdfName?: string
}

export type StudyLessonStudentQuery = {
  lessonId: StudyLessonId
  name?: string
  staffCode?: string | number
  status?: string | number
  pageNo?: number
  pageSize?: number
}

export type StudyLessonStudentRow = {
  id: StudyLessonId
  name?: string
  staffCode?: StudyLessonId
  status?: number
  attendanceStatus?: number
  [key: string]: unknown
}

type Draft<T> = { draft: T }
type LessonSaveDraft = StudyLessonPayload
type LessonDeleteDraft = { ids: StudyLessonId[] }
type LessonPublishDraft = { id: StudyLessonId; status: 0 | 1; publishAndNoPush?: boolean }
type StudentMoveOutDraft = {
  lessonId: StudyLessonId
  staffCodeList: StudyLessonId[]
  type: 1 | 2
}
type StudentBatchDeleteDraft = { ids: StudyLessonId[] }
type AttendanceDraft = { lessonId: StudyLessonId; records: StudyLessonAttendanceRow[] }
type RecordDraft = Record<string, unknown> & { lessonId: StudyLessonId }

/**
 * 三页共用的开头两项。页面**没有** `order` / `orderField` 这两个控件，
 * 是列表模块自己加的（`list.js:474-475`），所以钉死成空串、不开放。
 */
const BASE_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
]

/** 晨课堂 / 月课堂的字段顺序 —— 逐字抄 `daily-lesson/list.vue` 的 convertFetchForm 返回值 */
const DAILY_MONTHLY_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'type', defaultValue: '' }, // 由 listOf() 钉成 '1' / '3'
  { name: 'title', defaultValue: '' },
  { name: 'gradeNames', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'createTimeStart', defaultValue: '' },
  { name: 'createTimeEnd', defaultValue: '' },
  { name: 'startTimeStart', defaultValue: '' },
  { name: 'startTimeEnd', defaultValue: '' },
]

/** 周课堂的字段顺序 —— 逐字抄 `weekly-lesson/list.vue` 的 convertFetchForm 返回值 */
const WEEKLY_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'title', defaultValue: '' },
  { name: 'gradeNames', defaultValue: '' },
  { name: 'type', defaultValue: '' }, // 由 listOf() 钉成 '2'
  { name: 'linkNum', defaultValue: '' },
  { name: 'teacherName', defaultValue: '' },
  { name: 'publishTimeStart', defaultValue: '' },
  { name: 'publishTimeEnd', defaultValue: '' },
  { name: 'createTimeStart', defaultValue: '' },
  { name: 'createTimeEnd', defaultValue: '' },
  { name: 'startTimeStart', defaultValue: '' },
  { name: 'startTimeEnd', defaultValue: '' },
  { name: 'endTimeStart', defaultValue: '' },
  { name: 'endTimeEnd', defaultValue: '' },
]

const PAGINATION: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
  /** 页面钉死的字段（如 `type`），覆盖同名的调用方实参 */
  pinned: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    if (Object.prototype.hasOwnProperty.call(pinned, item.name)) {
      params[item.name] = pinned[item.name]
      continue
    }
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 把「日期区间」转成接口收的两个标量，**结束日 +1 天**（开区间），与三页的
 * `date[1].add(1,'day')` 一致。
 *
 * `withTime` 决定格式：
 * - `false` → `YYYY-MM-DD 00:00:00`（**晨课堂**那一页的写法：格式串里没有时间占位，
 *   选出来的时间一律是零点 —— 与它的 `.format('YYYY-MM-DD 00:00:00')` 逐字一致）
 * - `true`  → `YYYY-MM-DD HH:mm:ss`（周课堂 / 月课堂）
 *
 * ⚠️ 这个 +1 天不写出来就会**静默少一天**（选到 9-15 却查不到 9-15 当天的数据）。
 */
export function buildStudyLessonTimeRange (
  startDate: string,
  endDate: string,
  options: { withTime?: boolean } = {},
): { start: string; end: string } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('课堂时间区间应为 YYYY-MM-DD（或带时间的同格式字符串）')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('课堂时间区间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const ymd = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  if (options.withTime === false) {
    // 晨课堂：格式串里没有时间占位，两端都是 00:00:00
    return { start: `${ymd(start)} 00:00:00`, end: `${ymd(endExclusive)} 00:00:00` }
  }
  const full = (date: Date): string =>
    `${ymd(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return { start: full(start), end: full(endExclusive) }
}

const TITLE_PARAM: ParamSpec = {
  name: 'title',
  kind: 'text',
  required: false,
  description: '班课名称（模糊匹配）',
}

const GRADE_NAMES_PARAM: ParamSpec = {
  name: 'gradeNames',
  kind: 'text',
  required: false,
  description:
    '所属班级**名称**（不是 id）—— 这一页筛的是班名，不是班级选择器。' +
    '要按班级 id 找班课请用班级管理页，或先查班级名再填这里',
}

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const DAILY_MONTHLY_PARAMS: ParamSpec[] = [
  TITLE_PARAM,
  GRADE_NAMES_PARAM,
  { name: 'status', kind: 'number', required: false, description: '状态（页面是数字输入/下拉，取值未实测）' },
  { name: 'createTimeStart', kind: 'date', required: false, description: '创建时间起 `YYYY-MM-DD HH:mm:ss`' },
  { name: 'createTimeEnd', kind: 'date', required: false, description: '创建时间止，**开区间**（结束日 +1 天）' },
  { name: 'startTimeStart', kind: 'date', required: false, description: '开课时间起' },
  { name: 'startTimeEnd', kind: 'date', required: false, description: '开课时间止，**开区间**（结束日 +1 天）' },
  ...PAGE_PARAMS,
]

const WEEKLY_PARAMS: ParamSpec[] = [
  TITLE_PARAM,
  GRADE_NAMES_PARAM,
  { name: 'linkNum', kind: 'text', required: false, description: '关联编号（模糊匹配）' },
  { name: 'teacherName', kind: 'text', required: false, description: '讲师姓名（模糊匹配，不是 id）' },
  { name: 'publishTimeStart', kind: 'date', required: false, description: '发布时间起' },
  { name: 'publishTimeEnd', kind: 'date', required: false, description: '发布时间止，**开区间**（结束日 +1 天）' },
  { name: 'createTimeStart', kind: 'date', required: false, description: '创建时间起' },
  { name: 'createTimeEnd', kind: 'date', required: false, description: '创建时间止，**开区间**' },
  { name: 'startTimeStart', kind: 'date', required: false, description: '开课时间起' },
  { name: 'startTimeEnd', kind: 'date', required: false, description: '开课时间止，**开区间**' },
  { name: 'endTimeStart', kind: 'date', required: false, description: '结课时间起' },
  { name: 'endTimeEnd', kind: 'date', required: false, description: '结课时间止，**开区间**' },
  ...PAGE_PARAMS,
]

export const studyLessonCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-lesson-daily-list',
    title: '查询晨课堂列表',
    pagePath: STUDY_LESSON_DAILY_PAGE_PATH,
    permission: '/dashboard/lesson/daily-lesson',
    write: false,
    params: DAILY_MONTHLY_PARAMS,
  },
  {
    id: 'study-lesson-weekly-list',
    title: '查询周课堂列表',
    pagePath: STUDY_LESSON_WEEKLY_PAGE_PATH,
    permission: '/dashboard/lesson/weekly-lesson',
    write: false,
    params: WEEKLY_PARAMS,
  },
  {
    id: 'study-lesson-monthly-list',
    title: '查询月课堂列表',
    pagePath: STUDY_LESSON_MONTHLY_PAGE_PATH,
    permission: '/dashboard/lesson/monthly-lesson',
    write: false,
    params: DAILY_MONTHLY_PARAMS,
  },
]

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const ID_PARAM = p('id', 'text', true, '当前课堂或学生行 ID；来自对应列表返回的 id')
const LESSON_ID_PARAM = p('lessonId', 'text', true, '当前课堂 ID；来自课堂列表或详情')
const DRAFT_PARAM = p('draft', 'text', true, '对应 prepare 能力返回的 Portal 草稿；不要追加页面未提交字段')
const FORM_PARAM = p('form', 'text', true, 'Portal 隐藏表单字段；按该页面的固定 type、状态和校验规则填写')
const STATUS_GATE_PARAM = p('status', 'enum', false, '编辑时的当前状态；Portal 保存按钮在 status truthy 时禁用')
const STUDENT_IDS_PARAM = p('ids', 'array', true, '学生管理表格行 id 数组；批量删除按 Portal 原样发送')

const ACTION_PAGE_META = {
  daily: {
    pagePath: STUDY_LESSON_DAILY_PAGE_PATH,
    permission: '/dashboard/lesson/daily-lesson',
  },
  weekly: {
    pagePath: STUDY_LESSON_WEEKLY_PAGE_PATH,
    permission: '/dashboard/lesson/weekly-lesson',
  },
  monthly: {
    pagePath: STUDY_LESSON_MONTHLY_PAGE_PATH,
    permission: '/dashboard/lesson/monthly-lesson',
  },
} as const

function actionDefinition (
  kind: keyof typeof ACTION_PAGE_META,
  id: string,
  title: string,
  write: boolean,
  params: ParamSpec[],
): CapabilityDefinition {
  return { id, title, ...ACTION_PAGE_META[kind], write, params }
}

/**
 * 新增动作先独立导出。`src/capabilities/index.ts`、invoke 和 contracts 由主线统一接线，
 * 本任务不触碰共享目录；定义里的 pagePath/permission 仍保持三张菜单页的上下文。
 */
export const studyLessonActionCapabilities: CapabilityDefinition[] = [
  ...(['daily', 'weekly', 'monthly'] as const).flatMap(kind => [
    actionDefinition(kind, `study-lesson-${kind}-detail`, `读取${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂详情`, false, [ID_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-student-list`, `查询${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生`, false, [LESSON_ID_PARAM, p('name', 'text', false, '学员姓名筛选'), p('staffCode', 'text', false, '学员工号筛选'), p('status', 'enum', false, '学生关联状态筛选'), ...PAGE_PARAMS]),
    actionDefinition(kind, `study-lesson-${kind}-student-prepare-move-out`, `准备${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生移入或移出`, false, [LESSON_ID_PARAM, p('staffCodeList', 'array', true, '学员工号数组；行操作通常只有一个'), p('currentStatus', 'enum', true, '当前学生状态：1 表示未移出，其他页面状态表示已移出')]),
    actionDefinition(kind, `study-lesson-${kind}-student-move-out`, `执行${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生移入或移出`, true, [DRAFT_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-student-cancel-move-out`, `取消${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生操作`, false, []),
    actionDefinition(kind, `study-lesson-${kind}-student-prepare-batch-delete`, `准备批量移出${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生`, false, [STUDENT_IDS_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-student-batch-delete`, `按学生页批量移出${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生`, true, [DRAFT_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-student-cancel-batch-delete`, `取消批量移出${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂学生`, false, []),
    actionDefinition(kind, `study-lesson-${kind}-attendance`, `读取${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂出勤`, false, [LESSON_ID_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-prepare-attendance`, `准备保存${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂出勤`, false, [LESSON_ID_PARAM, p('records', 'array', true, 'Portal 出勤行数组；提交时每行会补当前 lessonId')]),
    actionDefinition(kind, `study-lesson-${kind}-attendance-save`, `保存${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂出勤`, true, [DRAFT_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-cancel-attendance`, `取消保存${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂出勤`, false, []),
    actionDefinition(kind, `study-lesson-${kind}-prepare-delete`, `准备删除${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, false, [p('ids', 'array', true, '课堂 ID 数组；单删也按数组发送'), p('statuses', 'array', false, '已知列表行状态；包含已发布状态 1 时本地拒绝')]),
    actionDefinition(kind, `study-lesson-${kind}-delete`, `删除${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, true, [DRAFT_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-cancel-delete`, `取消删除${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, false, []),
    actionDefinition(kind, `study-lesson-${kind}-prepare-publish`, `准备发布或取消发布${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, false, [ID_PARAM, p('currentStatus', 'enum', true, '列表行当前 status；Portal 按 0/非 0 取反'), p('isRelGrade', 'enum', true, '列表行是否已关联班级；页面按钮仅在值为 1 时显示')]),
    actionDefinition(kind, `study-lesson-${kind}-publish`, `发布或取消发布${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, true, [DRAFT_PARAM]),
    actionDefinition(kind, `study-lesson-${kind}-cancel-publish`, `取消发布操作${kind === 'daily' ? '晨' : kind === 'weekly' ? '周' : '月'}课堂`, false, []),
  ]),
  actionDefinition('daily', 'study-lesson-daily-record', '读取晨课堂记录', false, [ID_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-record', '读取周课堂记录', false, [ID_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-info', '读取月课堂详情与参会信息', false, [LESSON_ID_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-emcee', '读取晨课堂可选主持人', false, [LESSON_ID_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-emcee', '读取周课堂可选主持人', false, [LESSON_ID_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-prepare-save', '准备保存晨课堂', false, [FORM_PARAM, STATUS_GATE_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-save', '保存晨课堂', true, [DRAFT_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-cancel-save', '取消保存晨课堂', false, []),
  actionDefinition('weekly', 'study-lesson-weekly-prepare-save', '准备保存周课堂会议', false, [FORM_PARAM, STATUS_GATE_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-save', '保存周课堂会议', true, [DRAFT_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-cancel-save', '取消保存周课堂会议', false, []),
  actionDefinition('monthly', 'study-lesson-monthly-prepare-save', '准备保存月课堂', false, [FORM_PARAM, STATUS_GATE_PARAM, p('attendanceData', 'array', false, '月课堂页面最终提交的参会 DTO 数组'), p('guestData', 'array', false, '表决类月课堂最终提交的嘉宾 DTO 数组')]),
  actionDefinition('monthly', 'study-lesson-monthly-save', '保存月课堂', true, [DRAFT_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-cancel-save', '取消保存月课堂', false, []),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-prepare-create', '准备新建周课堂作业', false, [FORM_PARAM, STATUS_GATE_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-create', '新建周课堂作业', true, [DRAFT_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-cancel-create', '取消新建周课堂作业', false, []),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-prepare-update', '准备编辑周课堂作业', false, [FORM_PARAM, STATUS_GATE_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-update', '编辑周课堂作业', true, [DRAFT_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-assignment-cancel-update', '取消编辑周课堂作业', false, []),
  actionDefinition('daily', 'study-lesson-daily-record-prepare-save', '准备保存晨课堂记录', false, [p('form', 'text', true, '晨课堂记录表单；含 lessonId、lessonContentList、records、附件和 lessonPlan')]),
  actionDefinition('daily', 'study-lesson-daily-record-save', '保存晨课堂记录', true, [DRAFT_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-record-cancel-save', '取消保存晨课堂记录', false, []),
  actionDefinition('daily', 'study-lesson-daily-course-record-prepare-save', '准备保存晨课堂记录弹窗', false, [p('form', 'text', true, '列表“课堂记录”弹窗表单；含 lessonId、records 和附件')]),
  actionDefinition('daily', 'study-lesson-daily-course-record-save', '保存晨课堂记录弹窗', true, [DRAFT_PARAM]),
  actionDefinition('daily', 'study-lesson-daily-course-record-cancel-save', '取消保存晨课堂记录弹窗', false, []),
  actionDefinition('weekly', 'study-lesson-weekly-record-prepare-save', '准备保存周课堂记录', false, [p('form', 'text', true, '周课堂记录表单；含 lessonId、records 和附件')]),
  actionDefinition('weekly', 'study-lesson-weekly-record-save', '保存周课堂记录', true, [DRAFT_PARAM]),
  actionDefinition('weekly', 'study-lesson-weekly-record-cancel-save', '取消保存周课堂记录', false, []),
  actionDefinition('monthly', 'study-lesson-monthly-record-prepare-save', '准备保存旧月课堂记录', false, [p('form', 'text', true, '旧月课堂记录表单；含 lessonId 与 recordList')]),
  actionDefinition('monthly', 'study-lesson-monthly-record-save', '保存旧月课堂记录', true, [DRAFT_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-record-cancel-save', '取消保存旧月课堂记录', false, []),
  actionDefinition('monthly', 'study-lesson-monthly-generic-prepare-save', '准备保存旧月课堂', false, [FORM_PARAM, STATUS_GATE_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-generic-save', '保存旧月课堂', true, [DRAFT_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-generic-cancel-save', '取消保存旧月课堂', false, []),
  actionDefinition('monthly', 'study-lesson-month-record-prepare-save', '准备保存月课堂会议记录', false, [p('form', 'text', true, '月课堂会议记录表单；含 id、参会人、嘉宾、议案与 studyLessonRecordDTO')]),
  actionDefinition('monthly', 'study-lesson-month-record-save', '保存月课堂会议记录', true, [DRAFT_PARAM]),
  actionDefinition('monthly', 'study-lesson-month-record-cancel-save', '取消保存月课堂会议记录', false, []),
  actionDefinition('monthly', 'study-lesson-monthly-grade-info', '按班级读取月课堂主持人信息', false, [p('gradeIdList', 'array', true, '班级 ID 数组；页面 POST body 直接就是数组')]),
  actionDefinition('monthly', 'study-lesson-monthly-last-lesson', '读取班级上一次月课堂', false, [p('gradeIdList', 'array', true, '班级 ID 数组；页面 POST body 直接就是数组')]),
  actionDefinition('weekly', 'study-lesson-weekly-export', '导出周课堂', false, [p('lessonIdList', 'array', true, '列表勾选的周课堂 ID 数组；至少一项'), p('lessonKind', 'enum', true, '导出模式：0=会议周课堂，1=作业周课堂')]),
  actionDefinition('daily', 'study-lesson-daily-student-attendance-toggle', '切换晨课堂学生出勤状态', true, [ID_PARAM]),
  actionDefinition('monthly', 'study-lesson-monthly-student-attendance-toggle', '切换月课堂学生出勤状态', true, [ID_PARAM]),
]

/** 页面方法名与动作能力 ID 的固定映射；共享目录由主线负责接入。 */
export const STUDY_LESSON_METHODS = {
  'study-lesson-daily-list': 'listDaily',
  'study-lesson-weekly-list': 'listWeekly',
  'study-lesson-monthly-list': 'listMonthly',
  'study-lesson-daily-detail': 'getDaily',
  'study-lesson-weekly-detail': 'getWeekly',
  'study-lesson-monthly-detail': 'getMonthly',
  'study-lesson-monthly-info': 'getMonthlyInfo',
  'study-lesson-daily-emcee': 'getDailyEmcee',
  'study-lesson-weekly-emcee': 'getWeeklyEmcee',
  'study-lesson-daily-student-list': 'listDailyStudents',
  'study-lesson-weekly-student-list': 'listWeeklyStudents',
  'study-lesson-monthly-student-list': 'listMonthlyStudents',
  'study-lesson-daily-student-prepare-move-out': 'prepareDailyMoveOut',
  'study-lesson-daily-student-move-out': 'moveOutDailyStudent',
  'study-lesson-daily-student-cancel-move-out': 'cancelDailyMoveOut',
  'study-lesson-weekly-student-prepare-move-out': 'prepareWeeklyMoveOut',
  'study-lesson-weekly-student-move-out': 'moveOutWeeklyStudent',
  'study-lesson-weekly-student-cancel-move-out': 'cancelWeeklyMoveOut',
  'study-lesson-monthly-student-prepare-move-out': 'prepareMonthlyMoveOut',
  'study-lesson-monthly-student-move-out': 'moveOutMonthlyStudent',
  'study-lesson-monthly-student-cancel-move-out': 'cancelMonthlyMoveOut',
  'study-lesson-daily-student-prepare-batch-delete': 'prepareDailyStudentBatchDelete',
  'study-lesson-daily-student-batch-delete': 'deleteDailyStudentBatch',
  'study-lesson-daily-student-cancel-batch-delete': 'cancelDailyStudentBatchDelete',
  'study-lesson-weekly-student-prepare-batch-delete': 'prepareWeeklyStudentBatchDelete',
  'study-lesson-weekly-student-batch-delete': 'deleteWeeklyStudentBatch',
  'study-lesson-weekly-student-cancel-batch-delete': 'cancelWeeklyStudentBatchDelete',
  'study-lesson-monthly-student-prepare-batch-delete': 'prepareMonthlyStudentBatchDelete',
  'study-lesson-monthly-student-batch-delete': 'deleteMonthlyStudentBatch',
  'study-lesson-monthly-student-cancel-batch-delete': 'cancelMonthlyStudentBatchDelete',
  'study-lesson-daily-attendance': 'getDailyAttendance',
  'study-lesson-weekly-attendance': 'getWeeklyAttendance',
  'study-lesson-monthly-attendance': 'getMonthlyAttendance',
  'study-lesson-daily-prepare-attendance': 'prepareDailyAttendance',
  'study-lesson-daily-attendance-save': 'saveDailyAttendance',
  'study-lesson-daily-cancel-attendance': 'cancelDailyAttendance',
  'study-lesson-weekly-prepare-attendance': 'prepareWeeklyAttendance',
  'study-lesson-weekly-attendance-save': 'saveWeeklyAttendance',
  'study-lesson-weekly-cancel-attendance': 'cancelWeeklyAttendance',
  'study-lesson-monthly-prepare-attendance': 'prepareMonthlyAttendance',
  'study-lesson-monthly-attendance-save': 'saveMonthlyAttendance',
  'study-lesson-monthly-cancel-attendance': 'cancelMonthlyAttendance',
  'study-lesson-daily-prepare-delete': 'prepareDailyDelete',
  'study-lesson-daily-delete': 'deleteDaily',
  'study-lesson-daily-cancel-delete': 'cancelDailyDelete',
  'study-lesson-weekly-prepare-delete': 'prepareWeeklyDelete',
  'study-lesson-weekly-delete': 'deleteWeekly',
  'study-lesson-weekly-cancel-delete': 'cancelWeeklyDelete',
  'study-lesson-monthly-prepare-delete': 'prepareMonthlyDelete',
  'study-lesson-monthly-delete': 'deleteMonthly',
  'study-lesson-monthly-cancel-delete': 'cancelMonthlyDelete',
  'study-lesson-daily-prepare-publish': 'prepareDailyPublish',
  'study-lesson-daily-publish': 'publishDaily',
  'study-lesson-daily-cancel-publish': 'cancelDailyPublish',
  'study-lesson-weekly-prepare-publish': 'prepareWeeklyPublish',
  'study-lesson-weekly-publish': 'publishWeekly',
  'study-lesson-weekly-cancel-publish': 'cancelWeeklyPublish',
  'study-lesson-monthly-prepare-publish': 'prepareMonthlyPublish',
  'study-lesson-monthly-publish': 'publishMonthly',
  'study-lesson-monthly-cancel-publish': 'cancelMonthlyPublish',
  'study-lesson-daily-record': 'getDailyRecord',
  'study-lesson-weekly-record': 'getWeeklyRecord',
  'study-lesson-daily-prepare-save': 'prepareDailySave',
  'study-lesson-daily-save': 'saveDaily',
  'study-lesson-daily-cancel-save': 'cancelDailySave',
  'study-lesson-weekly-prepare-save': 'prepareWeeklySave',
  'study-lesson-weekly-save': 'saveWeekly',
  'study-lesson-weekly-cancel-save': 'cancelWeeklySave',
  'study-lesson-monthly-prepare-save': 'prepareMonthlySave',
  'study-lesson-monthly-save': 'saveMonthly',
  'study-lesson-monthly-cancel-save': 'cancelMonthlySave',
  'study-lesson-weekly-assignment-prepare-create': 'prepareWeeklyAssignmentCreate',
  'study-lesson-weekly-assignment-create': 'createWeeklyAssignment',
  'study-lesson-weekly-assignment-cancel-create': 'cancelWeeklyAssignmentCreate',
  'study-lesson-weekly-assignment-prepare-update': 'prepareWeeklyAssignmentUpdate',
  'study-lesson-weekly-assignment-update': 'updateWeeklyAssignment',
  'study-lesson-weekly-assignment-cancel-update': 'cancelWeeklyAssignmentUpdate',
  'study-lesson-daily-record-prepare-save': 'prepareDailyRecord',
  'study-lesson-daily-record-save': 'saveDailyRecord',
  'study-lesson-daily-record-cancel-save': 'cancelDailyRecord',
  'study-lesson-daily-course-record-prepare-save': 'prepareDailyCourseRecord',
  'study-lesson-daily-course-record-save': 'saveDailyCourseRecord',
  'study-lesson-daily-course-record-cancel-save': 'cancelDailyCourseRecord',
  'study-lesson-weekly-record-prepare-save': 'prepareWeeklyRecord',
  'study-lesson-weekly-record-save': 'saveWeeklyRecord',
  'study-lesson-weekly-record-cancel-save': 'cancelWeeklyRecord',
  'study-lesson-monthly-record-prepare-save': 'prepareMonthlyRecord',
  'study-lesson-monthly-record-save': 'saveMonthlyRecord',
  'study-lesson-monthly-record-cancel-save': 'cancelMonthlyRecord',
  'study-lesson-monthly-generic-prepare-save': 'prepareMonthlyGenericSave',
  'study-lesson-monthly-generic-save': 'saveMonthlyGeneric',
  'study-lesson-monthly-generic-cancel-save': 'cancelMonthlyGenericSave',
  'study-lesson-month-record-prepare-save': 'prepareMonthRecord',
  'study-lesson-month-record-save': 'saveMonthRecord',
  'study-lesson-month-record-cancel-save': 'cancelMonthRecord',
  'study-lesson-monthly-grade-info': 'getGradeInfo',
  'study-lesson-monthly-last-lesson': 'getLastMonthLesson',
  'study-lesson-weekly-export': 'exportWeekly',
  'study-lesson-daily-student-attendance-toggle': 'getDailyStudentAttendanceToggle',
  'study-lesson-monthly-student-attendance-toggle': 'getMonthlyStudentAttendanceToggle',
} as const

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): StudyLessonId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idsOf (value: unknown, label: string): StudyLessonId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function statusOf (value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是0或1`)
  return value
}

function editableFormOf (value: unknown, expectedType: 1 | 2 | 3, label: string): Record<string, unknown> {
  const form = objectOf(value, `${label}表单`)
  if (String(form.type) !== String(expectedType)) throw new Error(`${label}.type必须是${expectedType}`)
  // Portal 的保存按钮直接用 `!!rrForm.formState.status` 门禁，保持同样的 truthy 规则。
  if (form.status) throw new Error(`${label}当前状态不可编辑`)
  return form
}

function timeOf (form: Record<string, unknown>, label: string): [unknown, unknown] {
  if (!Array.isArray(form.time) || form.time.length < 2) throw new Error(`${label}.time必须包含开始和结束时间`)
  return [form.time[0], form.time[1]]
}

function lessonSavePayloadOf (value: unknown, expectedType: 1 | 2 | 3, label: string): LessonSaveDraft {
  const form = editableFormOf(value, expectedType, label)
  const [startTime, endTime] = timeOf(form, label)
  const { time: _time, lessonStudyStudentDTOList: _students, ...rest } = form
  return { ...rest, startTime, endTime }
}

function monthlySavePayloadOf (input: { form: StudyLessonForm; attendanceData?: unknown[]; guestData?: unknown[] }): LessonSaveDraft {
  const form = editableFormOf(input?.form, 3, '月课堂')
  const [startTime, endTime] = timeOf(form, '月课堂')
  if (form.monthKind !== undefined && form.monthKind !== 1 && form.monthKind !== 2) {
    throw new Error('月课堂.monthKind只能是1（表决）或2（非表决）')
  }
  const {
    time: _time,
    attendeeDTOList: _attendeeCodes,
    guestDTOList: _guestCodes,
    studyLessonMotionDTOList,
    ...rest
  } = form
  const payload: LessonSaveDraft = {
    ...rest,
    startTime,
    endTime,
    attendeeDTOList: input?.attendanceData ?? form.attendeeDTOList,
  }
  if (input?.guestData !== undefined || Object.prototype.hasOwnProperty.call(form, 'guestDTOList')) {
    payload.guestDTOList = input?.guestData ?? form.guestDTOList
  }
  if (Array.isArray(studyLessonMotionDTOList)) {
    payload.studyLessonMotionDTOList = studyLessonMotionDTOList.map(item => {
      const motion = objectOf(item, '月课堂议案')
      return {
        ...motion,
        avoidStaffCode: Array.isArray(motion.avoidStaffCode) ? motion.avoidStaffCode.join(',') : motion.avoidStaffCode,
        avoidName: Array.isArray(motion.avoidName) ? motion.avoidName.join(',') : motion.avoidName,
      }
    })
  }
  return payload
}

function assignmentPayloadOf (value: unknown, label: string): LessonSaveDraft {
  const form = editableFormOf(value, 2, label)
  if (form.lessonKind !== undefined && form.lessonKind !== 1) throw new Error(`${label}.lessonKind必须是1`)
  // assignment/[mode]/[id].vue 的 isDisabled：已开始且已发布时不允许再提交。
  if (form.isStart && form.status) throw new Error(`${label}已开始且已发布，不可编辑`)
  if (!Array.isArray(form.linkDTOS)) throw new Error(`${label}.linkDTOS必须是数组`)
  const linkDTOS = form.linkDTOS.map(item => {
    const link = objectOf(item, `${label}.linkDTOS项`)
    const result: Record<string, unknown> = {
      title: link.title,
      type: link.type,
      endTime: link.endTime,
      resourceId: link.resourceId,
      sort: link.sort,
      rater: link.rater || '',
    }
    if (link.id !== undefined) result.id = link.id
    return result
  }).filter(item => item.resourceId)
  return { ...form, year: Number(form.year), linkDTOS }
}

function deleteDraftOf (input: { ids: StudyLessonId[]; statuses?: unknown[] }, label: string): LessonDeleteDraft {
  const ids = idsOf(input?.ids, `${label}.ids`)
  if (input?.statuses?.some(status => Number(status) === 1)) throw new Error(`${label}包含已发布课堂，Portal/Java 不允许删除`)
  return { ids }
}

function publishDraftOf (
  input: { id: StudyLessonId; currentStatus: 0 | 1; isRelGrade: number; action?: 'publish' | 'publishAndNoPush' | 'cancel' },
  label: string,
): LessonPublishDraft {
  const id = idOf(input?.id, `${label}.id`)
  if (input?.isRelGrade !== 1) throw new Error(`${label}仅允许已关联班级（isRelGrade=1）的课堂操作`)
  const currentStatus = statusOf(input?.currentStatus, `${label}.currentStatus`)
  if (label === '周课堂') {
    const action = input?.action
    if (!action) throw new Error('周课堂发布操作必须指定 publish、publishAndNoPush 或 cancel')
    if (action === 'cancel' && currentStatus !== 1) throw new Error('只有已发布周课堂才能取消发布')
    if (action !== 'cancel' && currentStatus !== 0) throw new Error('只有未发布周课堂才能发布')
    return { id, status: action === 'cancel' ? 0 : 1, publishAndNoPush: action === 'publishAndNoPush' }
  }
  return { id, status: currentStatus === 0 ? 1 : 0 }
}

function moveOutDraftOf (input: { lessonId: StudyLessonId; staffCodeList: StudyLessonId[]; currentStatus: number }, label: string): StudentMoveOutDraft {
  const lessonId = idOf(input?.lessonId, `${label}.lessonId`)
  const staffCodeList = idsOf(input?.staffCodeList, `${label}.staffCodeList`)
  return { lessonId, staffCodeList, type: Number(input?.currentStatus) === 1 ? 2 : 1 }
}

function attendanceDraftOf (input: { lessonId: StudyLessonId; records: StudyLessonAttendanceRow[] }, label: string): AttendanceDraft {
  const lessonId = idOf(input?.lessonId, `${label}.lessonId`)
  if (!Array.isArray(input?.records)) throw new Error(`${label}.records必须是数组`)
  return {
    lessonId,
    records: input.records.map(item => ({ ...objectOf(item, `${label}.records项`), lessonId })),
  }
}

function fileStringOf (value: unknown, key: string): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(',')
  return value === undefined || value === null ? '' : String(value)
}

function lessonKindOf (value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('lessonKind只能是0或1')
  return value
}

function weeklyExportBytesOf (response: AxiosResponse<ArrayBuffer>): Uint8Array {
  const data: unknown = response?.data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  throw new Error('周课堂导出响应不是二进制文件')
}

function weeklyExportContentTypeOf (response: AxiosResponse<ArrayBuffer>): string | null {
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const value = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function weeklyExportFileOf (response: AxiosResponse<ArrayBuffer>): StudyLessonFile {
  const bytes = weeklyExportBytesOf(response)
  if (bytes.byteLength === 0) throw new Error('周课堂导出响应为空文件')
  const contentType = weeklyExportContentTypeOf(response)
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType === 'application/json' || mediaType?.endsWith('+json') || mediaType?.startsWith('text/')) {
    throw new Error('周课堂导出响应不是二进制文件')
  }
  return {
    fileName: '周课堂.xlsx',
    contentType,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function recordPayloadOf (value: unknown, withDailyFields: boolean): RecordDraft {
  const form = objectOf(value, '课堂记录表单') as StudyLessonRecordForm
  const lessonId = idOf(form.lessonId, '课堂记录表单.lessonId')
  const records = form.records
  const recordList = Array.isArray(form.recordList)
    ? form.recordList
    : [
        { recordType: 1, recordContent: records?.thought },
        { recordType: 2, recordContent: records?.technology },
        { recordType: 4, recordContent: records?.management },
      ]
  const payload: RecordDraft = {
    lessonId,
    recordList,
    imgUrl: fileStringOf(form.imgList ?? form.imgUrl, 'imgUrl'),
    pdfUrl: Array.isArray(form.pdfList) ? form.pdfList.map(item => item.fileUrl).join(',') : fileStringOf(form.pdfUrl, 'pdfUrl'),
    pdfName: Array.isArray(form.pdfList) ? form.pdfList.map(item => item.fileName ?? '').join(',') : fileStringOf(form.pdfName, 'pdfName'),
  }
  if (withDailyFields) {
    payload.lessonContentList = form.lessonContentList ?? []
    payload.lessonPlan = form.lessonPlan ?? ''
  }
  return payload
}

function monthlyLegacyRecordPayloadOf (value: unknown): RecordDraft {
  const form = objectOf(value, '旧月课堂记录表单')
  const lessonId = idOf(form.lessonId, '旧月课堂记录表单.lessonId')
  if (!Array.isArray(form.recordList)) throw new Error('旧月课堂记录表单.recordList必须是数组')
  return {
    lessonId,
    recordList: form.recordList.map(item => {
      const record = objectOf(item, '旧月课堂记录项')
      const imgList = Array.isArray(record.imgList)
        ? record.imgList.map(file => {
            if (typeof file === 'string') return { fileUrl: file, fileName: file.split('/').pop() ?? '' }
            return file
          })
        : record.imgList
      return { ...record, imgList }
    }),
  }
}

function monthRecordPayloadOf (value: unknown): Record<string, unknown> {
  const form = objectOf(value, '月课堂会议记录表单')
  const id = idOf(form.id, '月课堂会议记录表单.id')
  return { ...form, id }
}

const STUDENT_LIST_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'lessonId', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

function studentParamsOf (query: StudyLessonStudentQuery): Record<string, unknown> {
  return buildParams(STUDENT_LIST_FIELDS, query as unknown as Record<string, unknown>)
}

function cancelDraft (): { cancelled: true } {
  return { cancelled: true }
}

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文；三个 request 分开传入，
 * 因而 module-type/权限仍按各自的菜单页推导（学习管理 = 12）。
 */
export function createStudyLessonCapability (
  requestDaily: PortalRequest,
  requestWeekly: PortalRequest,
  requestMonthly: PortalRequest,
) {
  const listOf = (
    request: PortalRequest,
    type: '1' | '2' | '3',
    fields: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  ) =>
    (query: Record<string, unknown> = {}): Promise<PageResult<StudyLessonRow>> =>
      request<PageResult<StudyLessonRow>>({
        url: STUDY_LESSON_LIST_PATH,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...fields, ...PAGINATION], query, { type }),
      })

  const listStudentsOf = (request: PortalRequest) =>
    (query: StudyLessonStudentQuery): Promise<PageResult<StudyLessonStudentRow>> =>
      request<PageResult<StudyLessonStudentRow>>({
        url: STUDY_LESSON_STUDENT_LIST_PATH,
        method: 'get',
        params: studentParamsOf(query),
      })

  const getLessonOf = (request: PortalRequest) => (id: StudyLessonId): Promise<unknown> =>
    request<unknown>({ url: `${STUDY_LESSON_DETAIL_PATH}/${idOf(id, '课堂id')}`, method: 'get' })

  const getMonthInfo = (id: StudyLessonId): Promise<unknown> =>
    requestMonthly<unknown>({ url: STUDY_LESSON_MONTH_INFO_PATH, method: 'get', params: { lessonId: idOf(id, '月课堂lessonId') } })

  const getRecordOf = (request: PortalRequest) => (id: StudyLessonId): Promise<unknown> =>
    request<unknown>({ url: STUDY_LESSON_RECORD_PATH, method: 'get', params: { id: idOf(id, '课堂记录id') } })

  const getAttendanceOf = (request: PortalRequest) => (lessonId: StudyLessonId): Promise<unknown> =>
    request<unknown>({ url: STUDY_LESSON_ATTENDANCE_PATH, method: 'get', params: { lessonId: idOf(lessonId, '课堂lessonId') } })

  const getEmceeOf = (request: PortalRequest) => (lessonId: StudyLessonId): Promise<unknown> =>
    request<unknown>({ url: STUDY_LESSON_EMCEE_PATH, method: 'get', params: { lessonId: idOf(lessonId, '课堂lessonId') } })

  const exportWeekly = async (input: StudyLessonWeeklyExportInput): Promise<StudyLessonFile> => {
    const lessonIdList = idsOf(input?.lessonIdList, 'lessonIdList')
    if (new Set(lessonIdList.map(String)).size !== lessonIdList.length) throw new Error('lessonIdList不能包含重复课堂ID')
    const lessonKind = lessonKindOf(input?.lessonKind)
    const response = await requestWeekly<AxiosResponse<ArrayBuffer>>({
      url: STUDY_LESSON_WEEKLY_EXPORT_PATH,
      method: 'post',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      data: { lessonIdList, lessonKind },
      responseType: 'arraybuffer',
    } as Parameters<PortalRequest>[0])
    return weeklyExportFileOf(response)
  }

  const prepareLessonSaveOf = (type: 1 | 2 | 3, label: string) =>
    (input: { form: StudyLessonForm }): Draft<LessonSaveDraft> => ({
      draft: lessonSavePayloadOf(input?.form, type, label),
    })

  const submitLessonSaveWithId = async (request: PortalRequest, input: { draft: LessonSaveDraft }): Promise<StudyLessonId> =>
    idOf(await request<unknown>({ url: STUDY_LESSON_SAVE_PATH, method: 'post', data: objectOf(input?.draft, '课堂保存草稿') }), '课堂保存返回的lessonId')

  const submitLessonSaveWithoutResult = async (request: PortalRequest, input: { draft: LessonSaveDraft }): Promise<void> => {
    await request<unknown>({ url: STUDY_LESSON_SAVE_PATH, method: 'post', data: objectOf(input?.draft, '课堂保存草稿') })
  }

  const prepareDeleteOf = (label: string) =>
    (input: { ids: StudyLessonId[]; statuses?: unknown[] }): Draft<LessonDeleteDraft> => ({
      draft: deleteDraftOf(input, label),
    })

  const submitDeleteOf = async (request: PortalRequest, input: { draft: LessonDeleteDraft }): Promise<void> => {
    await request<unknown>({ url: STUDY_LESSON_DELETE_PATH, method: 'delete', data: idsOf(objectOf(input?.draft, '课堂删除草稿').ids, '课堂删除草稿.ids') })
  }

  const preparePublishOf = (label: string) =>
    (input: { id: StudyLessonId; currentStatus: 0 | 1; isRelGrade: number }): Draft<LessonPublishDraft> => ({
      draft: publishDraftOf(input, label),
    })

  const submitPublishOf = async (request: PortalRequest, input: { draft: LessonPublishDraft }): Promise<void> => {
    const draft = objectOf(input?.draft, '课堂发布草稿') as LessonPublishDraft
    const url = draft.publishAndNoPush ? STUDY_LESSON_PUBLISH_NO_PUSH_PATH : STUDY_LESSON_PUBLISH_PATH
    await request<unknown>({ url, method: 'put', data: { id: idOf(draft.id, '课堂发布草稿.id'), status: statusOf(draft.status, '课堂发布草稿.status') } })
  }

  const prepareMoveOutOf = (label: string) =>
    (input: { lessonId: StudyLessonId; staffCodeList: StudyLessonId[]; currentStatus: number }): Draft<StudentMoveOutDraft> => ({
      draft: moveOutDraftOf(input, label),
    })

  const submitMoveOutOf = async (request: PortalRequest, input: { draft: StudentMoveOutDraft }): Promise<void> => {
    const draft = objectOf(input?.draft, '学生移出草稿') as StudentMoveOutDraft
    await request<unknown>({
      url: STUDY_LESSON_STUDENT_MOVE_OUT_PATH,
      method: 'put',
      data: {
        lessonId: idOf(draft.lessonId, '学生移出草稿.lessonId'),
        staffCodeList: idsOf(draft.staffCodeList, '学生移出草稿.staffCodeList'),
        type: draft.type,
      },
    })
  }

  const prepareStudentBatchDelete = (input: { ids: StudyLessonId[] }): Draft<StudentBatchDeleteDraft> => ({
    draft: { ids: idsOf(input?.ids, '学生批量移出ids') },
  })

  const submitStudentBatchDelete = async (request: PortalRequest, input: { draft: StudentBatchDeleteDraft }): Promise<void> => {
    // renren list.js deleteIsBatch=true 的真实调用：DELETE + data:[id,...]，没有 params。
    await request<unknown>({
      url: STUDY_LESSON_STUDENT_MOVE_OUT_PATH,
      method: 'delete',
      data: idsOf(objectOf(input?.draft, '学生批量移出草稿').ids, '学生批量移出草稿.ids'),
    })
  }

  const prepareAttendanceOf = (label: string) =>
    (input: { lessonId: StudyLessonId; records: StudyLessonAttendanceRow[] }): Draft<AttendanceDraft> => ({
      draft: attendanceDraftOf(input, label),
    })

  const submitAttendanceOf = async (request: PortalRequest, input: { draft: AttendanceDraft }): Promise<void> => {
    const draft = objectOf(input?.draft, '出勤草稿') as AttendanceDraft
    await request<unknown>({ url: STUDY_LESSON_STUDENT_MANAGE_PATH, method: 'post', data: draft.records.map(item => ({ ...item, lessonId: draft.lessonId })) })
  }

  const prepareRecordOf = (withDailyFields: boolean) =>
    (input: { form: StudyLessonRecordForm }): Draft<RecordDraft> => ({
      draft: recordPayloadOf(input?.form, withDailyFields),
    })

  const submitRecordOf = async (request: PortalRequest, url: string, input: { draft: RecordDraft }): Promise<void> => {
    await request<unknown>({ url, method: 'post', data: objectOf(input?.draft, '课堂记录草稿') })
  }

  const prepareMonthlyRecord = (input: { form: StudyLessonForm }): Draft<RecordDraft> => ({
    draft: monthlyLegacyRecordPayloadOf(input?.form),
  })

  const prepareMonthRecord = (input: { form: StudyLessonForm }): Draft<Record<string, unknown>> => ({
    draft: monthRecordPayloadOf(input?.form),
  })

  const submitMonthRecord = async (input: { draft: Record<string, unknown> }): Promise<void> => {
    await requestMonthly<unknown>({ url: STUDY_LESSON_MONTH_RECORD_PATH, method: 'post', data: objectOf(input?.draft, '月课堂会议记录草稿') })
  }

  const prepareAssignment = (input: { form: StudyLessonForm }): Draft<LessonSaveDraft> => ({
    draft: assignmentPayloadOf(input?.form, '周课堂作业'),
  })

  const submitAssignment = async (method: 'post' | 'put', input: { draft: LessonSaveDraft }): Promise<void> => {
    await requestWeekly<unknown>({ url: STUDY_LESSON_DETAIL_PATH, method, data: objectOf(input?.draft, '周课堂作业草稿') })
  }

  const getStudentAttendanceToggleOf = (request: PortalRequest) => async (id: StudyLessonId): Promise<void> => {
    await request<unknown>({ url: STUDY_LESSON_STUDENT_ATTENDANCE_TOGGLE_PATH, method: 'get', params: { id: idOf(id, '学生关联id') } })
  }

  const listDaily = listOf(requestDaily, '1', DAILY_MONTHLY_FIELDS) as (
    query?: StudyLessonDailyQuery,
  ) => Promise<PageResult<StudyLessonRow>>
  const listWeekly = listOf(requestWeekly, '2', WEEKLY_FIELDS) as (
    query?: StudyLessonWeeklyQuery,
  ) => Promise<PageResult<StudyLessonRow>>
  const listMonthly = listOf(requestMonthly, '3', DAILY_MONTHLY_FIELDS) as (
    query?: StudyLessonMonthlyQuery,
  ) => Promise<PageResult<StudyLessonRow>>

  return {
    listDaily,
    listWeekly,
    listMonthly,
    getDaily: getLessonOf(requestDaily),
    getWeekly: getLessonOf(requestWeekly),
    getMonthly: getMonthInfo,
    getMonthlyInfo: getMonthInfo,
    getDailyEmcee: getEmceeOf(requestDaily),
    getWeeklyEmcee: getEmceeOf(requestWeekly),
    listDailyStudents: listStudentsOf(requestDaily),
    listWeeklyStudents: listStudentsOf(requestWeekly),
    listMonthlyStudents: listStudentsOf(requestMonthly),
    getDailyAttendance: getAttendanceOf(requestDaily),
    getWeeklyAttendance: getAttendanceOf(requestWeekly),
    getMonthlyAttendance: getAttendanceOf(requestMonthly),
    getDailyRecord: getRecordOf(requestDaily),
    getWeeklyRecord: getRecordOf(requestWeekly),
    exportWeekly,
    getDailyStudentAttendanceToggle: getStudentAttendanceToggleOf(requestDaily),
    getMonthlyStudentAttendanceToggle: getStudentAttendanceToggleOf(requestMonthly),

    prepareDailySave: prepareLessonSaveOf(1, '晨课堂'),
    saveDaily: (input: { draft: LessonSaveDraft }) => submitLessonSaveWithId(requestDaily, input),
    cancelDailySave: cancelDraft,
    prepareWeeklySave: prepareLessonSaveOf(2, '周课堂会议'),
    saveWeekly: (input: { draft: LessonSaveDraft }) => submitLessonSaveWithId(requestWeekly, input),
    cancelWeeklySave: cancelDraft,
    prepareMonthlySave: (input: { form: StudyLessonForm; attendanceData?: unknown[]; guestData?: unknown[] }): Draft<LessonSaveDraft> => ({
      draft: monthlySavePayloadOf(input),
    }),
    saveMonthly: async (input: { draft: LessonSaveDraft }): Promise<void> => {
      await requestMonthly<unknown>({ url: STUDY_LESSON_MONTH_SAVE_PATH, method: 'post', data: objectOf(input?.draft, '月课堂保存草稿') })
    },
    cancelMonthlySave: cancelDraft,
    prepareMonthlyGenericSave: prepareLessonSaveOf(3, '旧月课堂'),
    saveMonthlyGeneric: (input: { draft: LessonSaveDraft }) => submitLessonSaveWithoutResult(requestMonthly, input),
    cancelMonthlyGenericSave: cancelDraft,

    prepareWeeklyAssignmentCreate: prepareAssignment,
    createWeeklyAssignment: (input: { draft: LessonSaveDraft }) => submitAssignment('post', input),
    cancelWeeklyAssignmentCreate: cancelDraft,
    prepareWeeklyAssignmentUpdate: prepareAssignment,
    updateWeeklyAssignment: (input: { draft: LessonSaveDraft }) => submitAssignment('put', input),
    cancelWeeklyAssignmentUpdate: cancelDraft,

    prepareDailyDelete: prepareDeleteOf('晨课堂'),
    deleteDaily: (input: { draft: LessonDeleteDraft }) => submitDeleteOf(requestDaily, input),
    cancelDailyDelete: cancelDraft,
    prepareWeeklyDelete: prepareDeleteOf('周课堂'),
    deleteWeekly: (input: { draft: LessonDeleteDraft }) => submitDeleteOf(requestWeekly, input),
    cancelWeeklyDelete: cancelDraft,
    prepareMonthlyDelete: prepareDeleteOf('月课堂'),
    deleteMonthly: (input: { draft: LessonDeleteDraft }) => submitDeleteOf(requestMonthly, input),
    cancelMonthlyDelete: cancelDraft,

    prepareDailyPublish: preparePublishOf('晨课堂'),
    publishDaily: (input: { draft: LessonPublishDraft }) => submitPublishOf(requestDaily, input),
    cancelDailyPublish: cancelDraft,
    prepareWeeklyPublish: (input: { id: StudyLessonId; currentStatus: 0 | 1; isRelGrade: number; action: 'publish' | 'publishAndNoPush' | 'cancel' }): Draft<LessonPublishDraft> => ({
      draft: publishDraftOf(input, '周课堂'),
    }),
    publishWeekly: (input: { draft: LessonPublishDraft }) => submitPublishOf(requestWeekly, input),
    cancelWeeklyPublish: cancelDraft,
    prepareMonthlyPublish: preparePublishOf('月课堂'),
    publishMonthly: (input: { draft: LessonPublishDraft }) => submitPublishOf(requestMonthly, input),
    cancelMonthlyPublish: cancelDraft,

    prepareDailyAttendance: prepareAttendanceOf('晨课堂出勤'),
    saveDailyAttendance: (input: { draft: AttendanceDraft }) => submitAttendanceOf(requestDaily, input),
    cancelDailyAttendance: cancelDraft,
    prepareWeeklyAttendance: prepareAttendanceOf('周课堂出勤'),
    saveWeeklyAttendance: (input: { draft: AttendanceDraft }) => submitAttendanceOf(requestWeekly, input),
    cancelWeeklyAttendance: cancelDraft,
    prepareMonthlyAttendance: prepareAttendanceOf('月课堂出勤'),
    saveMonthlyAttendance: (input: { draft: AttendanceDraft }) => submitAttendanceOf(requestMonthly, input),
    cancelMonthlyAttendance: cancelDraft,

    prepareDailyMoveOut: prepareMoveOutOf('晨课堂学生'),
    moveOutDailyStudent: (input: { draft: StudentMoveOutDraft }) => submitMoveOutOf(requestDaily, input),
    cancelDailyMoveOut: cancelDraft,
    prepareWeeklyMoveOut: prepareMoveOutOf('周课堂学生'),
    moveOutWeeklyStudent: (input: { draft: StudentMoveOutDraft }) => submitMoveOutOf(requestWeekly, input),
    cancelWeeklyMoveOut: cancelDraft,
    prepareMonthlyMoveOut: prepareMoveOutOf('月课堂学生'),
    moveOutMonthlyStudent: (input: { draft: StudentMoveOutDraft }) => submitMoveOutOf(requestMonthly, input),
    cancelMonthlyMoveOut: cancelDraft,
    prepareDailyStudentBatchDelete: prepareStudentBatchDelete,
    deleteDailyStudentBatch: (input: { draft: StudentBatchDeleteDraft }) => submitStudentBatchDelete(requestDaily, input),
    cancelDailyStudentBatchDelete: cancelDraft,
    prepareWeeklyStudentBatchDelete: prepareStudentBatchDelete,
    deleteWeeklyStudentBatch: (input: { draft: StudentBatchDeleteDraft }) => submitStudentBatchDelete(requestWeekly, input),
    cancelWeeklyStudentBatchDelete: cancelDraft,
    prepareMonthlyStudentBatchDelete: prepareStudentBatchDelete,
    deleteMonthlyStudentBatch: (input: { draft: StudentBatchDeleteDraft }) => submitStudentBatchDelete(requestMonthly, input),
    cancelMonthlyStudentBatchDelete: cancelDraft,

    prepareDailyRecord: prepareRecordOf(true),
    saveDailyRecord: (input: { draft: RecordDraft }) => submitRecordOf(requestDaily, STUDY_LESSON_DAILY_RECORD_SAVE_PATH, input),
    cancelDailyRecord: cancelDraft,
    prepareDailyCourseRecord: prepareRecordOf(false),
    saveDailyCourseRecord: (input: { draft: RecordDraft }) => submitRecordOf(requestDaily, STUDY_LESSON_WEEKLY_RECORD_SAVE_PATH, input),
    cancelDailyCourseRecord: cancelDraft,
    prepareWeeklyRecord: prepareRecordOf(false),
    saveWeeklyRecord: (input: { draft: RecordDraft }) => submitRecordOf(requestWeekly, STUDY_LESSON_WEEKLY_RECORD_SAVE_PATH, input),
    cancelWeeklyRecord: cancelDraft,
    prepareMonthlyRecord,
    saveMonthlyRecord: (input: { draft: RecordDraft }) => submitRecordOf(requestMonthly, STUDY_LESSON_MONTHLY_RECORD_SAVE_PATH, input),
    cancelMonthlyRecord: cancelDraft,
    prepareMonthRecord,
    saveMonthRecord: submitMonthRecord,
    cancelMonthRecord: cancelDraft,

    getGradeInfo: (gradeIdList: StudyLessonId[]): Promise<unknown> => requestMonthly<unknown>({ url: STUDY_LESSON_GRADE_INFO_PATH, method: 'post', data: idsOf(gradeIdList, 'gradeIdList') }),
    getLastMonthLesson: (gradeIdList: StudyLessonId[]): Promise<unknown> => requestMonthly<unknown>({ url: STUDY_LESSON_LAST_MONTH_PATH, method: 'post', data: idsOf(gradeIdList, 'gradeIdList') }),
  }
}

export type StudyLessonCapability = ReturnType<typeof createStudyLessonCapability>
