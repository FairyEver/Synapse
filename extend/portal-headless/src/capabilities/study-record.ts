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
  }
}

export type StudyRecordCapability = ReturnType<typeof createStudyRecordCapability>
