import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 学习管理（学习记录列表）—— 学习管理域「数据统计」之外的独立一页。
 *
 * 页面：`/dashboard/study/study/list`（菜单里叫「学习管理」）
 * 路由文件：`app/portal/views/dashboard/education/study/study/list.vue`
 * 逐字段基准：`baseline/study-statistics.browser.json`
 * 四件套记录：`docs/pages/学习管理.md`
 *
 * ## 契约
 *
 * `convertFetchForm` 把 `date` 拆成 `startStudyTime` / `endStudyTime`（结束日 +1 天）：
 *
 * ```text
 * /admin-api/study/statistics/studystudyrecord/studyList
 *   ?order=&orderField=&staffName=&lessonTitle=&status=&lessonType=&gradeId=&startStudyTime=&endStudyTime=&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * 实测与推导逐字一致（`baseline/study-statistics.browser.json`）。
 *
 * ⚠️ 注意这一页的时间字段叫 `startStudyTime` / `endStudyTime`（**学习时间**），
 * 不是 `startTime`；讲师统计那一页才是 `startTime`。同域不同名，别串。
 *
 * ## 页面挂载时还会拉一次**全量班级**
 *
 * `GET /study/grade/studygrade/page?pageSize=99999&pageNo=1` —— 那是页面给「班级」下拉
 * 灌数据的做法。本能力**不复制**它（设计 D6 / H35）；要班级候选请用
 * `study-grade-search`（强制要关键字）。
 *
 * ## 写操作没有做
 *
 * 页面多选后可以「导出」（`fileDownloadByStream`，本能力不覆盖 —— 它不是 JSON 接口）。
 * 见 `docs/pages/学习管理.md` 的「尚未覆盖」。
 */

export const STUDY_RECORD_PAGE_PATH = '/dashboard/study/study/list'
export const STUDY_RECORD_PERMISSION = '/dashboard/study/study'

/** 列表接口 */
export const STUDY_RECORD_LIST_PATH = '/study/statistics/studystudyrecord/studyList'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/** 学习记录行（字段取自页面 `columns`，其余原样透传） */
export type StudyRecordRow = {
  id?: string
  /** 学员姓名 */
  staffName?: string
  /** 班课名称 */
  lessonTitle?: string
  /** 班级名称 */
  gradeName?: string
  /** 课堂类型。页面上是字典标签（`lessonType`，实测形如 1/2/3） */
  lessonType?: number
  status?: number
  /** 学习时间 */
  studyTime?: string
  [key: string]: unknown
}

export type StudyRecordQuery = {
  /** 学员姓名（模糊匹配） */
  staffName?: string
  /** 班课名称（模糊匹配） */
  lessonTitle?: string
  /** 状态。页面是下拉，**取值域未实测**（基准里是空串）—— 只透传、不给枚举 */
  status?: number | string
  /** 课堂类型。同上，取值域未实测 */
  lessonType?: number | string
  /**
   * 班级 id。候选见 `study-grade-search`（长选项参数，设计 D6 / H35）：
   * **先问用户关键字**再取候选，不要猜 id。
   */
  gradeId?: number
  /** 学习时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyRecordTimeRange 生成 */
  startStudyTime?: string
  /** 学习时间止，**开区间**（结束日 +1 天）；同上 */
  endStudyTime?: string
  pageNo?: number
  pageSize?: number
}

/**
 * 这一页的参数顺序 —— **顺序即 qs 序列化后的顺序**，是契约不是默认值表（D20）。
 * 依据是浏览器实测的那条 URL（见文件头）。
 */
const LIST_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'staffName', defaultValue: '' },
  { name: 'lessonTitle', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'lessonType', defaultValue: '' },
  { name: 'gradeId', defaultValue: '' },
  { name: 'startStudyTime', defaultValue: '' },
  { name: 'endStudyTime', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (query: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of LIST_ORDER) {
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 把「学习时间」的日期区间转成接口收的两个参数，**结束日 +1 天**（开区间）。
 * 与页面的 `date[1].add(1,'day')` 一致。
 */
export function buildStudyRecordTimeRange (
  startDate: string,
  endDate: string,
): { startStudyTime: string; endStudyTime: string } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('学习时间区间应为 YYYY-MM-DD（或带时间的同格式字符串）')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('学习时间区间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const format = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  return { startStudyTime: format(start), endStudyTime: format(endExclusive) }
}

const LIST_PARAMS: ParamSpec[] = [
  { name: 'staffName', kind: 'text', required: false, description: '学员姓名（模糊匹配）' },
  { name: 'lessonTitle', kind: 'text', required: false, description: '班课名称（模糊匹配）' },
  { name: 'status', kind: 'text', required: false, description: '状态。页面是下拉但取值域未实测，只透传' },
  { name: 'lessonType', kind: 'text', required: false, description: '课堂类型。同上，只透传' },
  {
    name: 'gradeId',
    kind: 'search',
    required: false,
    description: '班级 id。**先问用户关键字**再调 study-grade-search 取候选，不要猜 id',
    lookup: { capabilityId: 'study-grade-search', keywordParam: 'keyword' },
  },
  { name: 'startStudyTime', kind: 'date', required: false, description: '学习时间起 `YYYY-MM-DD HH:mm:ss`' },
  { name: 'endStudyTime', kind: 'date', required: false, description: '学习时间止，**开区间**（结束日 +1 天）' },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export const studyRecordCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-record-list',
    title: '查询学习记录列表（学习管理）',
    pagePath: STUDY_RECORD_PAGE_PATH,
    permission: STUDY_RECORD_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
]

/**
 * 学习管理页上**由弹窗发出**的请求（本节点新增）。
 *
 * 与 `contracts-study-course.ts` 那一轮同样的分工：这一组单独导出，
 * **还没接进 `src/capabilities/index.ts` / `invoke.ts` / `contracts-business.ts`**，
 * 接线由派单方统一做。理由见 `study-lesson.ts` 里 `studyLessonHiddenCapabilities` 的注释。
 *
 * 漏掉它们的原因是同一类：请求不在列表页上，而在**弹窗组件**里。
 * `list.vue` 的行按钮打开 `components/link-view.vue`（"请选择环节"），
 * link-view 再按环节状态打开 `components/assignment.vue`（"作业详情"/"评分"）。
 * 这两个弹窗文件里各自带着自己的 `http.get` / `http.post`，扫描列表页是看不到的。
 *
 * | 能力 | 发出位置 | 请求 | 会不会写 |
 * | --- | --- | --- | --- |
 * | `study-record-lesson-detail` | `link-view.vue:37` | `GET /study/lesson/studylessonlink/selectStudyDetail` | 不写 |
 * | `study-record-assignment-get` | `assignment.vue:86` | `GET /study/statistics/studyassignmentsubmitrecord/info` | **条件写**（讲师/评分人查看时把 `isRead` 置 1） |
 * | `assignment-check-permission` | `assignment.vue:105` | `GET /study/assignment/studyassignment/checkPermission` | 不写 |
 * | `study-record-assignment-update` | `assignment.vue:184` | `POST /study/statistics/studyassignmentsubmitrecord/update` | **写**（讲师评分） |
 *
 * `assignment-check-permission` 的 ID 前缀是 `assignment-`（它打的是作业控制器的接口），
 * 但**发出它的页面是学习管理页**（权限码 `/dashboard/study/study`），
 * 按派单表的 `ownerFile` 归属放在本文件；`pagePath` 仍是 `/dashboard/study/study/list`。
 */
export const STUDY_RECORD_LESSON_DETAIL_PATH = '/study/lesson/studylessonlink/selectStudyDetail'
export const STUDY_RECORD_ASSIGNMENT_INFO_PATH = '/study/statistics/studyassignmentsubmitrecord/info'
export const STUDY_RECORD_ASSIGNMENT_UPDATE_PATH = '/study/statistics/studyassignmentsubmitrecord/update'
export const STUDY_RECORD_ASSIGNMENT_CHECK_PATH = '/study/assignment/studyassignment/checkPermission'

/**
 * 学员在一个班课里的某个环节（`AppLessonLinkDTO`）。
 *
 * `linkStatusCode` / `linkStatusStr` 是后端**按学员身份**算出来的（不是存库字段）：
 * 课程环节 1 已完成 / 2 待学习 / 3 学习中 / 4 已截止；
 * 作业环节 1 已完成 / 2 待提交 / 3 待自评 / 4 已截止（未提交）/ 5 已截止（已提交）。
 * 页面只在 `type === 2` 且 `linkStatusCode ∈ {1,3,5}` 时把这一行渲染成"可点的按钮"。
 */
export type StudyRecordLessonLinkRow = {
  /** 环节 id（班课环节表主键）；不是课程 id、也不是作业 id */
  id?: string | number | null
  /** 环节名称 */
  title?: string | null
  /** 环节类型 1 课程 / 2 作业 / 3 考试 */
  type?: number | null
  lessonId?: string | number | null
  /** 关联的课程/作业/考试 ID；作业环节的分数提交要用它当 assignmentId */
  resourceId?: string | number | null
  /** 环节状态码（见上） */
  linkStatusCode?: number | null
  /** 环节状态文案 */
  linkStatusStr?: string | null
  /** 作业环节的教师打分（学员身份时为 null） */
  teacherScore?: number | null
  /** 自评分 */
  selfScore?: number | null
  startStudyTime?: string | null
  completeStudyTime?: string | null
  /** 学习时长（后端原值，页面不换算单位） */
  studyTime?: number | null
  /** 互动次数 */
  interactionNum?: number | null
  [key: string]: unknown
}

/** 学员作业提交记录（`StudyAssignmentSubmitRecordDTO` 的页面消费子集） */
export type StudyRecordAssignmentDetail = {
  /** 提交记录 id；`update` 用它当主键，**不是** assignmentId */
  id?: string | number | null
  /** 作业要求 id；`assignment.vue` 用它判断"到底有没有提交过" */
  assignmentId?: string | number | null
  /** 班课环节 id */
  linkId?: string | number | null
  lessonId?: string | number | null
  staffCode?: string | number | null
  /** 学员姓名 */
  studentName?: string | null
  gradeId?: string | number | null
  gradeName?: string | null
  /** 文字答案 */
  textAnswer?: string | null
  /** 图片答案**逗号串**（页面自己 split(',') 后再逐张展示） */
  imageAnswer?: string | null
  /** 文件答案地址 */
  fileAnswer?: string | null
  /** 文件答案文件名 */
  fileAnswerName?: string | null
  /** 视频答案逗号串 */
  videoAnswer?: string | null
  /** 自评分 */
  selfScore?: number | null
  /** 自评说明 */
  selfScoreInfo?: string | null
  /** 讲师评分 */
  teacherScore?: number | null
  /** 讲师给的鲜花数 */
  teacherFlower?: number | null
  /** 提交时间 */
  createTime?: string | null
  /** 是否已读：0 未读 / 1 已读（**本接口会在讲师/评分人查看时把它置 1**） */
  isRead?: number | null
  /** 提交状态文案（后端拼的中文串） */
  submitStatus?: string | null
  /** 提交状态码：0 未提交 / 1 已提交 / 2 晚交 */
  submitType?: number | null
  /** 自评状态：0 正常 / 1 晚自评 */
  scoreSubmitType?: number | null
  [key: string]: unknown
}

export type StudyRecordAssignmentUpdateDraft = {
  /** 提交记录 id，来自 study-record-assignment-get */
  id: string | number
  /** 作业要求 id，来自 study-record-assignment-get（页面原样回传） */
  assignmentId: string | number
  /** 打分：百分制整数。与 teacherFlower **二选一** */
  teacherScore?: number
  /** 鲜花数（字典 `assignment_score` 的 value）。与 teacherScore **二选一** */
  teacherFlower?: number
}

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const ASSIGNMENT_INFO_PARAMS: ParamSpec[] = [
  p('linkId', 'text', true, '班课环节 id（不是作业 id）；来自 study-record-lesson-detail 返回行的 id'),
  p('staffCode', 'text', true, '学员工号；来自学习管理列表行 list[].staffCode，不是用户 ID'),
]

const CHECK_PERMISSION_PARAMS: ParamSpec[] = [
  p('assignmentId', 'text', true, '作业要求 id；来自 study-record-lesson-detail 返回行的 resourceId 或作业完成情况行的 assignmentId'),
  p('lessonId', 'text', true, '班课 id；来自当前环节所在课堂，不是环节 id'),
]

const ASSIGNMENT_UPDATE_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '提交记录 id；来自 study-record-assignment-get 的 id，不是 assignmentId'),
  p('assignmentId', 'text', true, '作业要求 id；来自 study-record-assignment-get 的 assignmentId，原样回传'),
  p('teacherScore', 'number', false, '打分（百分制整数 0-100）；与 teacherFlower 二选一'),
  p('teacherFlower', 'number', false, '鲜花数；字典 assignment_score 的 value，与 teacherScore 二选一'),
]

const LESSON_DETAIL_PARAMS: ParamSpec[] = [
  p('lessonId', 'text', true, '班课 id；来自学习管理列表行 list[].lessonId'),
  p('staffCode', 'text', true, '学员工号；来自学习管理列表行 list[].staffCode'),
]

export const studyRecordHiddenCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-record-lesson-detail',
    title: '查看学员在班课里的环节详情',
    pagePath: STUDY_RECORD_PAGE_PATH,
    permission: STUDY_RECORD_PERMISSION,
    write: false,
    params: LESSON_DETAIL_PARAMS,
  },
  {
    id: 'study-record-assignment-get',
    title: '查看学员作业答案与评分（会标记已读）',
    pagePath: STUDY_RECORD_PAGE_PATH,
    permission: STUDY_RECORD_PERMISSION,
    // 名字是 get，但讲师/评分人查看时后端会 updateById 把 is_read 置 1（写）。
    write: true,
    params: ASSIGNMENT_INFO_PARAMS,
  },
  {
    id: 'assignment-check-permission',
    title: '检查当前用户可以给该学员评分',
    pagePath: STUDY_RECORD_PAGE_PATH,
    permission: STUDY_RECORD_PERMISSION,
    write: false,
    params: CHECK_PERMISSION_PARAMS,
  },
  {
    id: 'study-record-assignment-update',
    title: '讲师给学员作业评分',
    pagePath: STUDY_RECORD_PAGE_PATH,
    permission: STUDY_RECORD_PERMISSION,
    write: true,
    params: ASSIGNMENT_UPDATE_PARAMS,
  },
]

/** 页面方法名与能力 ID 的固定映射；接线由派单方负责（见本节顶部注释）。 */
export const STUDY_RECORD_HIDDEN_METHODS = {
  'study-record-lesson-detail': 'getLessonDetail',
  'study-record-assignment-get': 'getAssignment',
  'assignment-check-permission': 'checkAssignmentPermission',
  'study-record-assignment-update': 'updateAssignmentScore',
} as const

/** 两个 id 字段（用户 id / Long）在页面 props 上就有 String 与 Number 两种形态 */
function positiveIdOf (value: unknown, label: string): string | number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

/** 百分制打分：页面的 a-input-number 是 `:min="0" :max="100" :precision="0"` */
function teacherScoreOf (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error('teacherScore必须是0-100之间的整数（页面输入框 precision=0）')
  }
  return value
}

/** 鲜花数：页面给的是 `assignment_score` 字典里的正向取值 */
function teacherFlowerOf (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('teacherFlower必须是正整数（字典 assignment_score 的 value）')
  }
  return value
}

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/study/study/list` 的推导结果 = 12 学习管理）。
 */
export function createStudyRecordCapability (request: PortalRequest) {
  return {
    /** 分页查询学习记录。只读 */
    list (query: StudyRecordQuery = {}): Promise<PageResult<StudyRecordRow>> {
      return request<PageResult<StudyRecordRow>>({
        url: STUDY_RECORD_LIST_PATH,
        method: 'get',
        params: buildParams(query as Record<string, unknown>),
      })
    },

    /**
     * "请选择环节"弹窗：`GET /study/lesson/studylessonlink/selectStudyDetail`。
     *
     * 两个参数都必填、顺序与页面 `params` 字面量一致（`lessonId` 在前、`staffCode` 在后）。
     * 返回该学员在这个班课里的**全部环节**，每行带一个后端算出来的环节状态码。
     */
    async getLessonDetail (input: { lessonId: StudyRecordLessonLinkRow['lessonId']; staffCode: string | number }): Promise<StudyRecordLessonLinkRow[]> {
      return request<StudyRecordLessonLinkRow[]>({
        url: STUDY_RECORD_LESSON_DETAIL_PATH,
        method: 'get',
        params: {
          lessonId: positiveIdOf(input?.lessonId, '环节详情lessonId'),
          staffCode: positiveIdOf(input?.staffCode, '环节详情staffCode'),
        },
      })
    },

    /**
     * "作业详情 / 评分"弹窗：`GET /study/statistics/studyassignmentsubmitrecord/info`。
     *
     * 参数顺序照 `assignment.vue:86-91` 的 `params` 字面量：`linkId` 在前、`staffCode` 在后。
     *
     * ⚠️ **这是条件性的写**：后端在
     * `lesson.lecturerCode == 当前登录人工号 || link.rater == 当前登录人工号` 时会
     * `updateById({ id, isRead: 1 })`（`StudyAssignmentSubmitRecordServiceImpl:229-234`）。
     * 即"讲师或评分人打开一次，这条提交记录就被标成已读"。讲师之外的人（例如教务）调用不写。
     * 所以能力按 `write: true` 登记，且**不能当只读轮询用**。
     *
     * 学员没有提交记录时后端返回一个**几乎全空的对象**（只有 `submitStatus/submitType/scoreSubmitType`），
     * 不是 404；判断"有没有提交"要看 `assignmentId` 是否有值。
     */
    async getAssignment (input: { linkId: string | number; staffCode: string | number }): Promise<StudyRecordAssignmentDetail> {
      return request<StudyRecordAssignmentDetail>({
        url: STUDY_RECORD_ASSIGNMENT_INFO_PATH,
        method: 'get',
        params: {
          linkId: positiveIdOf(input?.linkId, '作业详情linkId'),
          staffCode: positiveIdOf(input?.staffCode, '作业详情staffCode'),
        },
      })
    },

    /**
     * 权限预检：`GET /study/assignment/studyassignment/checkPermission`。
     *
     * 页面把它当"提交按钮的禁用条件"：`data === 0` 就禁用（`assignment.vue:122-124`）。
     * 后端认三种人：作业创建人（用户 id 比）、班课讲师（工号比）、班课关联班级的助教（工号比）。
     * 返回 **1 = 允许评分**、**0 = 不允许**（参数缺失/查不到作业或班课也返回 0）。
     *
     * 参数顺序照 `assignment.vue:105-110`：`assignmentId` 在前、`lessonId` 在后（页面把两者
     * 都 `String()` 过，query 上本来就是文本，值不变）。
     */
    async checkAssignmentPermission (input: { assignmentId: string | number; lessonId: string | number }): Promise<number> {
      return request<number>({
        url: STUDY_RECORD_ASSIGNMENT_CHECK_PATH,
        method: 'get',
        params: {
          assignmentId: positiveIdOf(input?.assignmentId, '权限检查assignmentId'),
          lessonId: positiveIdOf(input?.lessonId, '权限检查lessonId'),
        },
      })
    },

    /**
     * 讲师评分：`POST /study/statistics/studyassignmentsubmitrecord/update`。
     *
     * body 的**键序**照 `assignment.vue:174-184` 的 `submitData`：先 `id`、再 `assignmentId`，
     * 最后才是二选一的评分字段。
     *
     * 后端在 `id` 为空时直接抛"未提交作业"；`teacherFlower` 有值时后端会先按
     * `assignment_score` 字典把 flower 换成对应的 `teacherScore` 再落库
     * （`StudyAssignmentSubmitRecordServiceImpl:279-286`），所以两个字段都传时以 flower 为准 ——
     * SDK 因此在提交前就拒绝"两个都给"，与页面只发其一的行为一致。
     * 打分是**绝对值写入**（不是切换），重发不会算两次分。
     */
    async updateAssignmentScore (draft: StudyRecordAssignmentUpdateDraft): Promise<void> {
      const id = positiveIdOf(draft?.id, '作业评分id')
      const assignmentId = positiveIdOf(draft?.assignmentId, '作业评分assignmentId')
      const hasScore = draft?.teacherScore !== undefined && draft?.teacherScore !== null
      const hasFlower = draft?.teacherFlower !== undefined && draft?.teacherFlower !== null
      if (hasScore === hasFlower) {
        throw new Error('作业评分必须且只能给 teacherScore（打分）或 teacherFlower（鲜花）其中一个')
      }
      const body: Record<string, unknown> = { id, assignmentId }
      if (hasScore) body.teacherScore = teacherScoreOf(draft.teacherScore)
      else body.teacherFlower = teacherFlowerOf(draft.teacherFlower)
      await request<unknown>({ url: STUDY_RECORD_ASSIGNMENT_UPDATE_PATH, method: 'post', data: body })
    },
  }
}

export type StudyRecordCapability = ReturnType<typeof createStudyRecordCapability>
