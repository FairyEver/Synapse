import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 课程管理（学习管理域）—— `/dashboard/course/` 下的三个列表页。
 *
 * | 页面 | 菜单路径 | 路由文件 | 列表的 type |
 * | --- | --- | --- | --- |
 * | 图文课程 | `/dashboard/course/text-course/list` | `…/education/course/text-course/list.vue` | 1 |
 * | 视频课程 | `/dashboard/course/video-course/list` | `…/education/course/video-course/list.vue` | 2 |
 * | 即时通讯课程 | `/dashboard/course/im-course/list` | `…/education/course/im-course/list.vue` | 4 |
 *
 * 逐字段基准：`baseline/study-course.browser.json`
 * 四件套记录：`docs/pages/{图文课程,视频课程,即时通讯课程}.md`
 *
 * ## 三个页面打**同一个**接口，`type` 决定切哪一片
 *
 * 三份 `list.vue` 的 `getDataListURL` 分别是
 * `/study/course/studycourse/courseList?type=1|2|4`，后端只接一个 `SelectCourseDTO`
 * （`StudyCourseController#selectNewsCourseList`），对应的 SQL 第一句就是
 * `WHERE t1.type = #{dto.type}`（`StudyCourseDao.xml` 的 `selectCourseList`）。
 *
 * **所以 `type` 不是筛选条件，是"这一页是哪一页"的定义** —— 它与考勤档案/考勤统计那一对
 * 是同一个形态（共用接口、按固定参数分界），处理方式也一样：每个页面一个能力，
 * `type` 钉死在自己能力里，**不接受调用方传**。
 *
 * `type` 按页面的原样写在 URL 上（`?type=N`），不是放进 params —— 两个理由：
 * ① 浏览器实测就是把它排在 `_t` **之后**（`baseline/study-course.browser.json`），
 *    而 `src/http/client.ts` 现在按 `platform.js:57-62` 的 spread 顺序把它合在最后；
 * ② 与页面源码逐字一致，日后对账不用再做一次换算。
 *
 * ## `type=3`（直播课程）**不进 SDK** —— 那一页的菜单项在源码里是注释掉的
 *
 * `app/portal/menus/hr.js:299` 整行是 `// { path: '/dashboard/course/live-course/list', … }`，
 * 侧边栏「课程管理」下只有图文 / 视频 / 即时通讯三项（浏览器实测确认）。
 * 路由文件还在、按 URL 直接访问也能渲染，但**菜单里没有它 = 用户到不了这一页**。
 *
 * 按项目规则（`docs/conventions.md` 的「注释掉的代码不算代码」）：Portal 里已经注释掉的
 * 东西是没有意义的，不该搬进 SDK。所以这里**没有** `listLive`，`type` 的取值域也只开到 `1 | 2 | 4`。
 *
 * 这条规则是用户 2026-09-21 定的，起因就是这一页：生成器当时逐行正则扫菜单文件、**不看注释**，
 * 把全仓 **44 条被注释掉的菜单项**（38 个页面 + 6 个 iframe，含本页）都收进了
 * `generated/page-catalog.json`。生成器已修（`tools/generate/generate.mjs` 的 `blankComments`）。
 *
 * ## ⚠️ 两条实测出来的「这一页现在用不了」
 *
 * 两条都**不是** SDK 侧的推断，是在测试环境真跑出来的，也都是**用户自己点也照样踩**的：
 *
 * 1. **`keyword` 只要命中就必报错。** 关键字走的是另一条代码路径
 *    （`StudyCourseServiceImpl#selectCourseList` 的 else 分支 → `getCourseByResourceIds`），
 *    那条路径**无条件**调 `hrUserApi.getUserList(null)` 去建手机号→用户映射；
 *    而这个方法在 `HrSysUserServiceImpl:725` 有一条 `MAX_LEGACY_USER_RESULTS = 500` 的兜底，
 *    超过就抛「用户查询结果超过500条，请缩小name条件或调用已有分页接口」。
 *    实测（租户 1）：`keyword=经营`（有命中）→ `code:500`；`keyword=zzz_not_exist_xyz`（无命中）
 *    → 正常返回空列表。**关键字的成败取决于它命中不命中**，这与直觉相反。
 * 2. **即时通讯课程（`type=4`）** 任何查询都返回 `code:500`「用户查询结果超过500条」，
 *    因为它的资源匹配分支（`matchResourceByType` 的 else）同样要拉全量用户。
 *    浏览器实测：页面弹红字提示 + 表格「暂无数据 / 共 0 条记录」—— **用户自己也用不了这一页**。
 *
 * 两条的根因是同一个：这条链上有两处把"全部用户"当映射表用，而那个入口已被后端加了 500 条上限。
 * 见 `docs/pages/图文课程.md` §5。
 *
 * ## 即时通讯课程的可达子页与动作
 *
 * 即时通讯列表行在创建者本人名下时才显示消息、合并语音和禁言/解禁操作；新建按钮
 * 也从这一页进入隐藏表单路由。消息页和合并语音页没有菜单项，但它们是列表行实际
 * push 到的可达路由，因此动作仍属于本页的 SDK 能力范围。
 *
 * 这些动作的服务端实现并不都是本地事务：新建会调用外部内容平台并创建群组，消息
 * 状态更新会调用外部消息平台，语音合并会下载外部音频、调用 FFmpeg 并上传 OSS。
 * SDK 保留页面真实请求形状，同时在文档中标出外部依赖、不可撤销边界和失败判据；
 * `cancel` 只取消本地 prepare 草稿，不假装能回滚已提交的跨系统副作用。
 */

export const STUDY_COURSE_TEXT_PAGE_PATH = '/dashboard/course/text-course/list'
export const STUDY_COURSE_VIDEO_PAGE_PATH = '/dashboard/course/video-course/list'
export const STUDY_COURSE_IM_PAGE_PATH = '/dashboard/course/im-course/list'
export const STUDY_COURSE_IM_FORM_PAGE_PATH = '/dashboard/course/im-course/[mode]/[id]'
export const STUDY_COURSE_IM_MESSAGE_PAGE_PATH = '/dashboard/course/im-course/message/[id]/[roomId]/item-list'
export const STUDY_COURSE_IM_AUDIO_PAGE_PATH = '/dashboard/course/im-course/merge/[roomId]/item-list'
export const STUDY_COURSE_IM_PERMISSION = '/dashboard/course/im-course'

const VIEWS = 'app/portal/views/dashboard/education/course'

/** 路由文件（三份 `list.vue`），写进文档与排障时用得上 */
export const STUDY_COURSE_ROUTE_FILES = {
  text: `${VIEWS}/text-course/list.vue`,
  video: `${VIEWS}/video-course/list.vue`,
  im: `${VIEWS}/im-course/list.vue`,
} as const

/** 菜单未单独登记，但由即时通讯课程列表实际 push 到的隐藏路由。 */
export const STUDY_COURSE_IM_ROUTE_FILES = {
  form: `${VIEWS}/im-course/[mode]/[id].vue`,
  message: `${VIEWS}/im-course/message/[id]/[roomId]/item-list.vue`,
  audio: `${VIEWS}/im-course/merge/[roomId]/item-list.vue`,
} as const

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/**
 * 列表行。
 *
 * 外层是课程行（`hr_study_course` + 两个 real_name 的 JOIN），
 * 资源本体按 type 挂在 `news` / `videos` / `live` / `imGroupDTO` **四个字段里的一个**上，
 * 另外三个是 `null`（实测：`type=2` 的首行 `news/videos/live/imGroupDTO` 全为 `null`，
 * 说明那一行的远端资源已经取不到了 —— 这一列的第三方接口失联时不会报错）。
 */
export type StudyCourseRow = {
  /** 课程行 id（`hr_study_course.id`），**不是**资源 id —— 删除/编辑用的是它 */
  id: string
  /** 资源 id（远端平台的主键）。`news`/`videos`/`live`/`imGroupDTO` 里的 `id` 与它相同 */
  resourceId?: string
  /** 课程类型，与请求的 `type` 相同 */
  type?: number
  /** 是否已软删。`type=1|2|3` 的列表 SQL 带 `and t1.is_del=0`，`type=4` 不带 */
  isDel?: number
  /** 录入人员（JOIN 出来的姓名，不是 id） */
  creatorName?: string
  createTime?: string
  updaterName?: string
  updateTime?: string
  /** 图文课程资源 */
  news?: Record<string, unknown> | null
  /** 视频课程资源 */
  videos?: Record<string, unknown> | null
  /** 直播课程资源 */
  live?: Record<string, unknown> | null
  /** 即时通讯课程资源 */
  imGroupDTO?: Record<string, unknown> | null
  [key: string]: unknown
}

/** 图文 / 视频两页共用的查询条件（它们的表单字段**一字不差**） */
export type StudyCourseListQuery = {
  /**
   * 关键字，**匹配远端资源名**（图文匹配标题、视频匹配…、由后端按 type 决定）。
   *
   * ⚠️ 见文件头第 1 条：在本租户（用户数 >500）下，**只要这个关键字真的命中，请求就报错**
   * （`code:500` 用户查询结果超过500条）；命中不了反而正常返回空列表。
   * 所以调用方拿到这个错时，正确反应是"换个更精确的关键字或改用时间区间"，
   * 而不是重试 —— 重试多少次都是同一个错。
   */
  keyword?: string
  /** 创建时间起 `YYYY-MM-DD HH:mm:ss`；与 `endTime` 成对，用 buildStudyCourseTimeRange 生成 */
  startTime?: string
  /**
   * 创建时间止 `YYYY-MM-DD HH:mm:ss`，**开区间**（结束日 +1 天）。
   * 用 buildStudyCourseTimeRange 生成 —— 自己拼容易少一天。
   */
  endTime?: string
  pageNo?: number
  pageSize?: number
}

/** 即时通讯课程页的查询条件：与上面两页**完全不同**的一组字段 */
export type StudyCourseImListQuery = {
  /** 课程名称（表单 label 也是「课程名称」，不是「关键字」） */
  keyword?: string
  /** 群组人数下限 */
  numberMin?: number | string
  /** 群组人数上限 */
  numberMax?: number | string
  /** 课程状态，字典 `im_course_status`：0 使用 / 1 解散 */
  status?: number | string
  createTimeStart?: string
  createTimeEnd?: string
  deleteTimeStart?: string
  deleteTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

export type StudyCourseId = number | string

/** 隐藏互动消息页的行；外部消息字段按 Portal 原样保留。 */
export type StudyCourseInteractionRow = {
  id?: StudyCourseId
  content?: string
  type?: number
  status?: number
  lessonId?: StudyCourseId
  lessonName?: string
  userName?: string
  staffCode?: string
  createTime?: string
  [key: string]: unknown
}

/** 隐藏合并语音页的行；content 是后续 audioMerge 会下载的外部音频地址。 */
export type StudyCourseAudioRow = {
  id: StudyCourseId
  roomId?: string
  lessonId?: StudyCourseId
  lessonName?: string
  content?: string
  status?: number
  mergeTime?: string
  duration?: number | string
  createTime?: string
  [key: string]: unknown
}

/** 消息页和 voice-merge 弹窗共用 `/study/interaction/page` 的实际请求字段。 */
export type StudyCourseInteractionQuery = {
  id: StudyCourseId
  roomId: string | number
  order?: string
  orderField?: string
  content?: string
  type?: number | string
  status?: number | string
  name?: string
  staffCode?: string | number
  isProhibition?: number | string
  createTimeStart?: string
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

export type StudyCourseAudioListQuery = {
  roomId: string | number
  order?: string
  orderField?: string
  pageNo?: number
  pageSize?: number
}

export type StudyCourseImCreateForm = {
  gradeId: StudyCourseId
  title: string
  staffCode: string | number
}

export type StudyCourseImCreateDraft = {
  type: 4
  gradeId: StudyCourseId
  imGroupDTO: {
    joinmode: 0
    msg: '即时通讯课程'
    title: string
    staffCode: string | number
  }
}

export type StudyCourseMuteDraft = { id: StudyCourseId; muted: boolean }
export type StudyCourseMessageStatusDraft = { id: StudyCourseId; status: 0 | 1 }
export type StudyCourseAudioStatusDraft = {
  id: StudyCourseId
  roomId: string
  status: 0 | 1
  lessonId?: StudyCourseId
}
export type StudyCourseAudioDeleteDraft = { ids: StudyCourseId[] }
export type StudyCourseAudioMergeDraft = {
  lessonId: StudyCourseId
  lessonName: string
  roomId: string
  fileList: string[]
}

/**
 * 图文 / 视频两页共用的参数顺序 —— **顺序即 qs 序列化后的顺序**，所以它是契约，不是默认值表（D20）。
 *
 * 依据是浏览器真实发出的 URL：
 * `/…/courseList?order=&orderField=&keyword=&startTime=&endTime=&pageNo=1&pageSize=20&_t=<ts>&type=1`
 *
 * `order` / `orderField` 是列表模块加的、页面自己没有这两个控件，所以**钉死成空串、不开放**。
 */
const TEXT_VIDEO_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'keyword', defaultValue: '' },
  { name: 'startTime', defaultValue: '' },
  { name: 'endTime', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 即时通讯课程那一页的参数顺序，同样取自浏览器实测：
 * `?order=&orderField=&keyword=&numberMin=&numberMax=&status=&createTimeStart=&createTimeEnd=&deleteTimeStart=&deleteTimeEnd=&pageNo=1&pageSize=20&_t=<ts>&type=4`
 */
const IM_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'keyword', defaultValue: '' },
  { name: 'numberMin', defaultValue: '' },
  { name: 'numberMax', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'createTimeStart', defaultValue: '' },
  { name: 'createTimeEnd', defaultValue: '' },
  { name: 'deleteTimeStart', defaultValue: '' },
  { name: 'deleteTimeEnd', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 隐藏互动消息页：字段顺序来自 `message/.../item-list.vue` 的 form 与列表模块。 */
const INTERACTION_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'id', defaultValue: '' },
  { name: 'roomId', defaultValue: '' },
  { name: 'sessionType', defaultValue: 2 },
  { name: 'content', defaultValue: '' },
  { name: 'type', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'isProhibition', defaultValue: '' },
  { name: 'createTimeStart', defaultValue: '' },
  { name: 'createTimeEnd', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 隐藏合并语音列表页：页面只有 roomId 筛选。 */
const AUDIO_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'roomId', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
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

/**
 * 把「创建时间」的日期区间转成列表接口收的两个参数。
 *
 * 页面的 `convertFetchForm` 对用户选的两天是这么处理的：
 *
 * ```js
 * startTime = date[0].startOf('date').format('YYYY-MM-DD HH:mm:ss')
 * endTime   = date[1].startOf('date').add(1, 'day').format('YYYY-MM-DD HH:mm:ss')
 * ```
 *
 * 也就是 **结束日 +1 天，是开区间**。实测（`baseline/study-course.browser.json`）：
 * 选区选 2026-09-01 ~ 2026-09-15，浏览器发出去的是
 * `startTime=2026-09-01 00:00:00&endTime=2026-09-16 00:00:00`。
 *
 * 这个 +1 天不写出来就会**静默少一天**（选到 9-15 却查不到 9-15 当天的数据），所以单独给函数。
 *
 * ⚠️ 与后端的比较符**不完全对齐**：SQL 写的是 `AND t1.create_time <= #{dto.endTime}`（闭区间），
 * 而这里给的是结束日次日 00:00:00，所以恰好落在 00:00:00 那一秒的记录会被多收进来。
 * 这是页面与后端两边拼出来的效果，SDK 照抄页面、**不"修正"它** —— 改了就不逐字段一致了。
 */
function plusOneDayRange (startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('课程时间区间应为 YYYY-MM-DD（或带时间的同格式字符串）')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('课程时间区间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const format = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  // 结束日 +1 天，与页面的 add(1, 'day') 一致；跨月跨年由 Date 自己进位
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  return { start: format(start), end: format(endExclusive) }
}

/** 图文 / 视频 / 直播页的「创建时间」区间 → `{ startTime, endTime }` */
export function buildStudyCourseTimeRange (
  startDate: string,
  endDate: string,
): { startTime: string; endTime: string } {
  const { start, end } = plusOneDayRange(startDate, endDate)
  return { startTime: start, endTime: end }
}

/** 即时通讯课程页的「创建时间」区间 → `{ createTimeStart, createTimeEnd }` */
export function buildStudyCourseCreateTimeRange (
  startDate: string,
  endDate: string,
): { createTimeStart: string; createTimeEnd: string } {
  const { start, end } = plusOneDayRange(startDate, endDate)
  return { createTimeStart: start, createTimeEnd: end }
}

/** 即时通讯课程页的「解散时间」区间 → `{ deleteTimeStart, deleteTimeEnd }` */
export function buildStudyCourseDeleteTimeRange (
  startDate: string,
  endDate: string,
): { deleteTimeStart: string; deleteTimeEnd: string } {
  const { start, end } = plusOneDayRange(startDate, endDate)
  return { deleteTimeStart: start, deleteTimeEnd: end }
}

/** 字典 `im_course_status` 的实测取值（`baseline` 之外单独取的，见 docs/pages/即时通讯课程.md §3） */
export const IM_COURSE_STATUS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  // 注意：字典里 label 原文是「` 解散`」，**带一个前导空格**，这里沿用原样
  { label: '使用', value: 0 },
  { label: ' 解散', value: 1 },
]

const KEYWORD_PARAM: ParamSpec = {
  name: 'keyword',
  kind: 'text',
  required: false,
  description:
    '关键字，匹配**远端资源名称**。⚠️ 本租户实测：只要关键字真的命中就会 `code:500`' +
    '（后端拉全量用户建映射、撞上 500 条上限），命中不了反而正常返回空列表。' +
    '拿到这个错请改用时间区间或更精确的名字，**重试没有意义**。',
}

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const TEXT_VIDEO_PARAMS: ParamSpec[] = [
  KEYWORD_PARAM,
  {
    name: 'startTime',
    kind: 'date',
    required: false,
    description: '创建时间起 `YYYY-MM-DD HH:mm:ss`；与 endTime 成对，用 buildStudyCourseTimeRange 生成',
  },
  {
    name: 'endTime',
    kind: 'date',
    required: false,
    description: '创建时间止，**开区间**（结束日 +1 天）。用 buildStudyCourseTimeRange 生成，自己拼会少一天',
  },
  ...PAGE_PARAMS,
]

const IM_PARAMS: ParamSpec[] = [
  { ...KEYWORD_PARAM, description: `课程名称。${KEYWORD_PARAM.description}` },
  { name: 'numberMin', kind: 'number', required: false, description: '群组人数下限' },
  { name: 'numberMax', kind: 'number', required: false, description: '群组人数上限' },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description: '课程状态（字典 im_course_status）',
    options: IM_COURSE_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description: '创建时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyCourseCreateTimeRange 生成',
  },
  {
    name: 'createTimeEnd',
    kind: 'date',
    required: false,
    description: '创建时间止，**开区间**（+1 天）；用 buildStudyCourseCreateTimeRange 生成',
  },
  {
    name: 'deleteTimeStart',
    kind: 'date',
    required: false,
    description: '解散时间起；用 buildStudyCourseDeleteTimeRange 生成',
  },
  {
    name: 'deleteTimeEnd',
    kind: 'date',
    required: false,
    description: '解散时间止，**开区间**（+1 天）；用 buildStudyCourseDeleteTimeRange 生成',
  },
  ...PAGE_PARAMS,
]

/**
 * 三个能力共用的列表 URL；`type` 按页面原样拼在 query 上（见文件头）。
 *
 * `type` 的取值域**不含 3**：3 是直播课程，而它的菜单项在源码里是注释掉的
 * （`hr.js:299`），按项目规则不进 SDK。理由见文件头。
 */
export const STUDY_COURSE_LIST_PATH = '/study/course/studycourse/courseList'

export function studyCourseListUrl (type: 1 | 2 | 4): string {
  return `${STUDY_COURSE_LIST_PATH}?type=${type}`
}

const ALL_PARAMS = TEXT_VIDEO_PARAMS
const IM_ALL_PARAMS = IM_PARAMS

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({
  name,
  kind,
  required,
  description,
})

const IM_DRAFT_PARAM = p(
  'draft',
  'text',
  true,
  '对应 prepare 能力返回的草稿；只提交 Portal 页面实际生成的字段，不要自行追加远端 DTO 字段',
)

const INTERACTION_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '当前即时通讯课程的课程行 ID；来自列表行，不是远端群组 ID'),
  p('roomId', 'text', true, '即时通讯群组 ID；来自列表行 imGroupDTO.groupId 或当前隐藏路由'),
  p('order', 'text', false, '排序方向；消息列表页默认空串，语音选择弹窗按页面传 asc'),
  p('orderField', 'text', false, '排序字段；消息列表页默认空串，语音选择弹窗按页面传 createTime'),
  p('content', 'text', false, '消息内容筛选'),
  p('type', 'number', false, '消息类型；语音选择弹窗传 2'),
  p('status', 'enum', false, '消息状态筛选；按后端 LiveMsgApiDTO 传 0/1'),
  p('name', 'text', false, '消息用户名称筛选'),
  p('staffCode', 'text', false, '消息用户工号筛选'),
  p('isProhibition', 'number', false, '禁言标记筛选，按 Portal 原值传递'),
  p('createTimeStart', 'date', false, '创建时间起；由消息页日期区间转换得到'),
  p('createTimeEnd', 'date', false, '创建时间止；页面按结束日 +1 天转换为开区间'),
  p('pageNo', 'number', false, '页码，默认 1'),
  p('pageSize', 'number', false, `每页条数，默认 ${DEFAULT_PAGE_SIZE}`),
]

const AUDIO_LIST_PARAMS: ParamSpec[] = [
  p('roomId', 'text', true, '即时通讯群组 ID；来自当前隐藏合并语音路由'),
  p('order', 'text', false, '排序方向；合并语音页默认空串'),
  p('orderField', 'text', false, '排序字段；合并语音页默认空串'),
  p('pageNo', 'number', false, '页码，默认 1'),
  p('pageSize', 'number', false, `每页条数，默认 ${DEFAULT_PAGE_SIZE}`),
]

const CREATE_FORM_PARAM = p(
  'form',
  'text',
  true,
  '即时通讯课程新建表单：gradeId、title、staffCode；joinmode 和 msg 由页面固定为 0 与“即时通讯课程”',
)

const MUTE_PREPARE_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '课程行 ID；来自当前即时通讯课程列表行'),
  p('currentMuted', 'boolean', true, '列表行 imGroupDTO.chatRoomMuted；目标 muted 按页面逻辑取反'),
]

const MESSAGE_STATUS_PREPARE_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '互动消息 ID；来自隐藏消息页当前行'),
  {
    name: 'status',
    kind: 'enum',
    required: true,
    options: [
      { label: '无效', value: 0 },
      { label: '有效', value: 1 },
    ],
    description: '要提交的绝对状态值；页面动作传 id/status，不在 SDK 内取反',
  },
]

const AUDIO_STATUS_PREPARE_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '合并语音记录 ID；来自隐藏合并语音页当前行'),
  p('roomId', 'text', true, '即时通讯群组 ID；页面 FormData 实际必传，用于发布条数校验'),
  {
    name: 'currentStatus',
    kind: 'enum',
    required: true,
    options: [
      { label: '未发布', value: 0 },
      { label: '已发布', value: 1 },
    ],
    description: '当前记录 status；提交目标按页面 actionStatus 取反',
  },
  p('lessonId', 'text', false, '课程课节 ID；有值时按页面追加到 multipart FormData'),
]

const AUDIO_DELETE_PREPARE_PARAMS: ParamSpec[] = [
  p('ids', 'array', true, '待删除合并语音记录 ID 数组；页面 DELETE body 直接是该数组，不是 { ids }'),
]

const AUDIO_MERGE_PREPARE_PARAMS: ParamSpec[] = [
  p('lessonId', 'text', true, '所选语音记录的课节 ID；来自 voice-merge-status 组件'),
  p('lessonName', 'text', false, '课节名称；页面始终在 MergeDTO 中带此键，缺省为空串'),
  p('roomId', 'text', true, '即时通讯群组 ID；用于成功后落本地合并记录'),
  p('fileList', 'array', true, '至少两个外部音频 URL；服务端会下载并交给 FFmpeg 合并'),
]

/** 页面方法名与能力 ID 的固定映射；共享目录由主线负责接入。 */
export const STUDY_COURSE_METHODS = {
  'study-course-text-list': 'listText',
  'study-course-video-list': 'listVideo',
  'study-course-im-list': 'listIm',
  'study-course-im-message-list': 'listMessages',
  'study-course-im-audio-list': 'listMergedAudio',
  'study-course-im-prepare-create': 'prepareCreateIm',
  'study-course-im-create': 'createIm',
  'study-course-im-cancel-create': 'cancelCreateIm',
  'study-course-im-prepare-mute': 'prepareMute',
  'study-course-im-mute': 'mute',
  'study-course-im-cancel-mute': 'cancelMute',
  'study-course-im-prepare-message-status': 'prepareMessageStatus',
  'study-course-im-message-status': 'updateMessageStatus',
  'study-course-im-cancel-message-status': 'cancelMessageStatus',
  'study-course-im-prepare-audio-status': 'prepareAudioStatus',
  'study-course-im-audio-status': 'updateAudioStatus',
  'study-course-im-cancel-audio-status': 'cancelAudioStatus',
  'study-course-im-prepare-audio-delete': 'prepareAudioDelete',
  'study-course-im-audio-delete': 'deleteAudio',
  'study-course-im-cancel-audio-delete': 'cancelAudioDelete',
  'study-course-im-prepare-audio-merge': 'prepareAudioMerge',
  'study-course-im-audio-merge': 'audioMerge',
  'study-course-im-cancel-audio-merge': 'cancelAudioMerge',
} as const

const IM_CAPABILITY_META = {
  pagePath: STUDY_COURSE_IM_PAGE_PATH,
  permission: STUDY_COURSE_IM_PERMISSION,
} as const

export const studyCourseCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-course-text-list',
    title: '查询图文课程列表',
    pagePath: STUDY_COURSE_TEXT_PAGE_PATH,
    permission: '/dashboard/course/text-course',
    write: false,
    params: ALL_PARAMS,
  },
  {
    id: 'study-course-video-list',
    title: '查询视频课程列表',
    pagePath: STUDY_COURSE_VIDEO_PAGE_PATH,
    permission: '/dashboard/course/video-course',
    write: false,
    params: ALL_PARAMS,
  },
  // ⚠️ 这里**故意没有**直播课程（`type=3` / `/dashboard/course/live-course/list`）：
  // 它的菜单项在 `app/portal/menus/hr.js:299` 是注释掉的，用户到不了这一页。
  // 按项目规则（conventions「注释掉的代码不算代码」）不进 SDK。见文件头。
  {
    id: 'study-course-im-list',
    title: '查询即时通讯课程列表',
    pagePath: STUDY_COURSE_IM_PAGE_PATH,
    permission: '/dashboard/course/im-course',
    write: false,
    params: IM_ALL_PARAMS,
  },
  {
    id: 'study-course-im-message-list',
    title: '查询即时通讯课程互动消息',
    ...IM_CAPABILITY_META,
    write: false,
    params: INTERACTION_PARAMS,
  },
  {
    id: 'study-course-im-audio-list',
    title: '查询即时通讯课程合并语音',
    ...IM_CAPABILITY_META,
    write: false,
    params: AUDIO_LIST_PARAMS,
  },
  {
    id: 'study-course-im-prepare-create',
    title: '准备新建即时通讯课程',
    ...IM_CAPABILITY_META,
    write: false,
    params: [CREATE_FORM_PARAM],
  },
  {
    id: 'study-course-im-create',
    title: '新建即时通讯课程',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-create',
    title: '取消新建即时通讯课程',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
  {
    id: 'study-course-im-prepare-mute',
    title: '准备禁言或解禁即时通讯课程群聊',
    ...IM_CAPABILITY_META,
    write: false,
    params: MUTE_PREPARE_PARAMS,
  },
  {
    id: 'study-course-im-mute',
    title: '禁言或解禁即时通讯课程群聊',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-mute',
    title: '取消禁言或解禁即时通讯课程群聊',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
  {
    id: 'study-course-im-prepare-message-status',
    title: '准备更新互动消息状态',
    ...IM_CAPABILITY_META,
    write: false,
    params: MESSAGE_STATUS_PREPARE_PARAMS,
  },
  {
    id: 'study-course-im-message-status',
    title: '更新互动消息状态',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-message-status',
    title: '取消更新互动消息状态',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
  {
    id: 'study-course-im-prepare-audio-status',
    title: '准备发布或取消发布合并语音',
    ...IM_CAPABILITY_META,
    write: false,
    params: AUDIO_STATUS_PREPARE_PARAMS,
  },
  {
    id: 'study-course-im-audio-status',
    title: '发布或取消发布合并语音',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-audio-status',
    title: '取消发布或取消发布合并语音',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
  {
    id: 'study-course-im-prepare-audio-delete',
    title: '准备删除合并语音记录',
    ...IM_CAPABILITY_META,
    write: false,
    params: AUDIO_DELETE_PREPARE_PARAMS,
  },
  {
    id: 'study-course-im-audio-delete',
    title: '删除合并语音记录',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-audio-delete',
    title: '取消删除合并语音记录',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
  {
    id: 'study-course-im-prepare-audio-merge',
    title: '准备合并即时通讯课程语音',
    ...IM_CAPABILITY_META,
    write: false,
    params: AUDIO_MERGE_PREPARE_PARAMS,
  },
  {
    id: 'study-course-im-audio-merge',
    title: '合并即时通讯课程语音',
    ...IM_CAPABILITY_META,
    write: true,
    params: [IM_DRAFT_PARAM],
  },
  {
    id: 'study-course-im-cancel-audio-merge',
    title: '取消合并即时通讯课程语音',
    ...IM_CAPABILITY_META,
    write: false,
    params: [],
  },
]

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/course/*` 的推导结果 = 12 学习管理）。
 */
function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function idOf (value: unknown, label: string): StudyCourseId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function roomIdOf (value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new Error(`${label}不能为空`)
}

function statusOf (value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${label}只能是0或1`)
  return value
}

function booleanOf (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

function titleOf (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  if (new TextEncoder().encode(value).length > 100) throw new Error(`${label}最多100字节`)
  return value
}

function staffCodeOf (value: unknown, label: string): string | number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new Error(`${label}不能为空`)
  }
  return value
}

function idsOf (value: unknown, label: string): StudyCourseId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须是非空数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function draftOf<T extends object> (value: unknown, label: string): T {
  return objectOf(value, label) as T
}

function createFormOf (value: unknown): StudyCourseImCreateForm {
  const form = objectOf(value, '即时通讯课程新建表单')
  return {
    gradeId: idOf(form.gradeId, '即时通讯课程新建表单.gradeId'),
    title: titleOf(form.title, '即时通讯课程新建表单.title'),
    staffCode: staffCodeOf(form.staffCode, '即时通讯课程新建表单.staffCode'),
  }
}

function createDraftOf (value: unknown): StudyCourseImCreateDraft {
  const draft = objectOf(value, '即时通讯课程新建草稿')
  if (draft.type !== 4) throw new Error('即时通讯课程新建草稿.type必须是4')
  const group = objectOf(draft.imGroupDTO, '即时通讯课程新建草稿.imGroupDTO')
  if (group.joinmode !== 0) throw new Error('即时通讯课程新建草稿.imGroupDTO.joinmode必须是0')
  if (group.msg !== '即时通讯课程') throw new Error('即时通讯课程新建草稿.imGroupDTO.msg不符合页面固定值')
  const form = createFormOf({ gradeId: draft.gradeId, title: group.title, staffCode: group.staffCode })
  return {
    type: 4,
    gradeId: form.gradeId,
    imGroupDTO: {
      joinmode: 0,
      msg: '即时通讯课程',
      title: form.title,
      staffCode: form.staffCode,
    },
  }
}

function interactionQueryOf (value: unknown): StudyCourseInteractionQuery {
  const query = objectOf(value, '互动消息查询')
  return {
    ...query as StudyCourseInteractionQuery,
    id: idOf(query.id, '互动消息查询.id'),
    roomId: roomIdOf(query.roomId, '互动消息查询.roomId'),
  }
}

function audioListQueryOf (value: unknown): StudyCourseAudioListQuery {
  const query = objectOf(value, '合并语音列表查询')
  return {
    ...query as StudyCourseAudioListQuery,
    roomId: roomIdOf(query.roomId, '合并语音列表查询.roomId'),
  }
}

export function createStudyCourseCapability (request: PortalRequest) {
  /** 图文 / 视频两页的公共实现：只有 URL 上那个 type 不同 */
  const listOf = (type: 1 | 2) =>
    (query: StudyCourseListQuery = {}): Promise<PageResult<StudyCourseRow>> =>
      request<PageResult<StudyCourseRow>>({
        url: studyCourseListUrl(type),
        method: 'get',
        params: buildParams(TEXT_VIDEO_ORDER, query as Record<string, unknown>),
      })

  const listMessages = (query: StudyCourseInteractionQuery): Promise<PageResult<StudyCourseInteractionRow>> => {
    const normalized = interactionQueryOf(query)
    return request<PageResult<StudyCourseInteractionRow>>({
      url: '/study/interaction/page',
      method: 'get',
      params: buildParams(INTERACTION_ORDER, normalized as unknown as Record<string, unknown>),
    })
  }

  const listMergedAudio = (query: StudyCourseAudioListQuery): Promise<PageResult<StudyCourseAudioRow>> => {
    const normalized = audioListQueryOf(query)
    return request<PageResult<StudyCourseAudioRow>>({
      url: '/study/audio/page',
      method: 'get',
      params: buildParams(AUDIO_ORDER, normalized as unknown as Record<string, unknown>),
    })
  }

  return {
    /** 分页查询图文课程列表（`type=1`）。只读 */
    listText: listOf(1),
    /** 分页查询视频课程列表（`type=2`）。只读 */
    listVideo: listOf(2),
    /**
     * 分页查询即时通讯课程列表（`type=4`）。只读。
     *
     * ⚠️ **本租户下必定失败**：后端在这一条路径上要拉全量用户建映射，
     * 撞上 `HrSysUserServiceImpl` 的 500 条上限，稳定返回
     * `code:500`「用户查询结果超过500条，请缩小name条件或调用已有分页接口」。
     * 保留这个能力是为了让调用方能发现"这一页存在但坏了"，而不是发现不了。
     */
    listIm (query: StudyCourseImListQuery = {}): Promise<PageResult<StudyCourseRow>> {
      return request<PageResult<StudyCourseRow>>({
        url: studyCourseListUrl(4),
        method: 'get',
        params: buildParams(IM_ORDER, query as Record<string, unknown>),
      })
    },

    listMessages,
    listMergedAudio,

    /** 只校验 Portal 新建表单，不发请求；type/joinmode/msg 是页面固定值。 */
    prepareCreateIm (input: { form: StudyCourseImCreateForm }): { draft: StudyCourseImCreateDraft } {
      const form = createFormOf(input?.form)
      return {
        draft: {
          type: 4,
          gradeId: form.gradeId,
          imGroupDTO: {
            joinmode: 0,
            msg: '即时通讯课程',
            title: form.title,
            staffCode: form.staffCode,
          },
        },
      }
    },

    /** POST /study/course/studycourse；后端会先创建外部群组，再写本地课程行。 */
    async createIm (input: { draft: StudyCourseImCreateDraft }): Promise<void> {
      const draft = createDraftOf(input?.draft)
      await request<unknown>({ url: '/study/course/studycourse', method: 'post', data: draft })
    },

    cancelCreateIm (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 当前行 chatRoomMuted 取反，生成页面的 query muted。 */
    prepareMute (input: { id: StudyCourseId; currentMuted: boolean }): { draft: StudyCourseMuteDraft } {
      return {
        draft: {
          id: idOf(input?.id, '即时通讯课程id'),
          muted: !booleanOf(input?.currentMuted, '即时通讯课程currentMuted'),
        },
      }
    },

    /** PUT /study/course/studycourse/{id}/chatroom/mute；body 必须是 null。 */
    mute (input: { draft: StudyCourseMuteDraft }): Promise<Record<string, unknown> | null | undefined> {
      const draft = draftOf<StudyCourseMuteDraft>(input?.draft, '即时通讯课程禁言草稿')
      const id = idOf(draft.id, '即时通讯课程禁言草稿.id')
      const muted = booleanOf(draft.muted, '即时通讯课程禁言草稿.muted')
      return request<Record<string, unknown> | null | undefined>({
        url: `/study/course/studycourse/${id}/chatroom/mute`,
        method: 'put',
        params: { muted },
        data: null,
      })
    },

    cancelMute (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 页面传绝对目标状态，不对 status 取反。 */
    prepareMessageStatus (input: { id: StudyCourseId; status: 0 | 1 }): { draft: StudyCourseMessageStatusDraft } {
      return {
        draft: {
          id: idOf(input?.id, '互动消息id'),
          status: statusOf(input?.status, '互动消息status'),
        },
      }
    },

    /** PUT /study/interaction/updateStatus；服务端会继续调用外部消息平台。 */
    async updateMessageStatus (input: { draft: StudyCourseMessageStatusDraft }): Promise<void> {
      const draft = draftOf<StudyCourseMessageStatusDraft>(input?.draft, '互动消息状态草稿')
      await request<unknown>({
        url: '/study/interaction/updateStatus',
        method: 'put',
        data: {
          id: idOf(draft.id, '互动消息状态草稿.id'),
          status: statusOf(draft.status, '互动消息状态草稿.status'),
        },
      })
    },

    cancelMessageStatus (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 页面 actionStatus 按当前记录 status 取反，lessonId 有值才进入 FormData。 */
    prepareAudioStatus (input: {
      id: StudyCourseId
      roomId: string | number
      currentStatus: 0 | 1
      lessonId?: StudyCourseId
    }): { draft: StudyCourseAudioStatusDraft } {
      const lessonId = input?.lessonId === undefined ? undefined : idOf(input.lessonId, '合并语音lessonId')
      return {
        draft: {
          id: idOf(input?.id, '合并语音id'),
          roomId: roomIdOf(input?.roomId, '合并语音roomId'),
          status: input?.currentStatus === 0 ? 1 : statusOf(input?.currentStatus, '合并语音currentStatus') === 0 ? 1 : 0,
          ...(lessonId === undefined ? {} : { lessonId }),
        },
      }
    },

    /** PUT /study/audio/updateStatus；multipart 键顺序与页面 actionStatus 一致。 */
    async updateAudioStatus (input: { draft: StudyCourseAudioStatusDraft }): Promise<void> {
      const draft = draftOf<StudyCourseAudioStatusDraft>(input?.draft, '合并语音状态草稿')
      const formData = new FormData()
      formData.append('roomId', roomIdOf(draft.roomId, '合并语音状态草稿.roomId'))
      formData.append('id', String(idOf(draft.id, '合并语音状态草稿.id')))
      formData.append('status', String(statusOf(draft.status, '合并语音状态草稿.status')))
      if (draft.lessonId !== undefined) formData.append('lessonId', String(idOf(draft.lessonId, '合并语音状态草稿.lessonId')))
      await request<unknown>({ url: '/study/audio/updateStatus', method: 'put', data: formData })
    },

    cancelAudioStatus (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 页面 deleteIsBatch=true：单删和多选都直接把 ID 数组作为 JSON body。 */
    prepareAudioDelete (input: { ids: StudyCourseId[] }): { draft: StudyCourseAudioDeleteDraft } {
      return { draft: { ids: idsOf(input?.ids, '合并语音删除ids') } }
    },

    /** DELETE /study/audio，body 是 `[id, ...]`，不是 `{ ids: [...] }`。 */
    async deleteAudio (input: { draft: StudyCourseAudioDeleteDraft }): Promise<void> {
      const draft = draftOf<StudyCourseAudioDeleteDraft>(input?.draft, '合并语音删除草稿')
      await request<unknown>({ url: '/study/audio', method: 'delete', data: idsOf(draft.ids, '合并语音删除草稿.ids') })
    },

    cancelAudioDelete (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 校验 voice-merge-status 组件传入的至少两个外部音频地址。 */
    prepareAudioMerge (input: {
      lessonId: StudyCourseId
      lessonName?: string
      roomId: string | number
      fileList: string[]
    }): { draft: StudyCourseAudioMergeDraft } {
      if (!Array.isArray(input?.fileList) || input.fileList.length < 2) throw new Error('语音合并至少需要两个音频文件')
      if (input.fileList.some((file) => typeof file !== 'string' || file.trim() === '')) throw new Error('语音合并fileList必须是非空音频地址')
      return {
        draft: {
          lessonId: idOf(input?.lessonId, '语音合并lessonId'),
          lessonName: input?.lessonName === undefined ? '' : String(input.lessonName),
          roomId: roomIdOf(input?.roomId, '语音合并roomId'),
          fileList: [...input.fileList],
        },
      }
    },

    /** POST /study/audioMerge；成功返回服务端上传后的合并音频 URL。 */
    async audioMerge (input: { draft: StudyCourseAudioMergeDraft }): Promise<string> {
      const draft = draftOf<StudyCourseAudioMergeDraft>(input?.draft, '语音合并草稿')
      const result = await request<unknown>({
        url: '/study/audioMerge',
        method: 'post',
        data: {
          lessonId: idOf(draft.lessonId, '语音合并草稿.lessonId'),
          lessonName: String(draft.lessonName ?? ''),
          roomId: roomIdOf(draft.roomId, '语音合并草稿.roomId'),
          fileList: [...draft.fileList],
        },
      })
      if (typeof result !== 'string' || result.trim() === '') throw new Error('语音合并响应缺少音频URL')
      return result
    },

    cancelAudioMerge (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type StudyCourseCapability = ReturnType<typeof createStudyCourseCapability>
