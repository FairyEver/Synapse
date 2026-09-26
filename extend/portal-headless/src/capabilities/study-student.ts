import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 学员管理 —— 学习管理域「基础数据」下的学员列表页。
 *
 * 页面：`/dashboard/base/student/list`
 * 路由文件：`app/portal/views/dashboard/education/base/student/list.vue`
 * 逐字段基准：`baseline/study-base.browser.json`
 * 四件套记录：`docs/pages/学员管理.md`
 *
 * ## 契约从源码推出来（`list.js:473-483`），基准只用来复核
 *
 * 参数顺序恒为 `order → orderField → convertFetchForm(formState) → pageNo → pageSize → _t`。
 * 这一页的 `convertFetchForm` 是：
 *
 * ```js
 * const form = omit(data, ['date'])
 * return { ...form, createTimeStart: …, createTimeEnd: … }   // 结束日 +1 天
 * ```
 *
 * ⇒ 最终的 query 是
 * `order=&orderField=&name=&mobile=&isRelatedClass=&isRelatedLayer=&createTimeStart=&createTimeEnd=&pageNo=1&pageSize=20&_t=…`
 * —— 与浏览器实测逐字一致（`baseline/study-base.browser.json`）。
 *
 * ⚠️ `isRelatedClass` / `isRelatedLayer` 的初值是**空字符串**、不是 null，所以**照样发**。
 * 写成 null 会被 `qs` 的 `skipNulls` 丢掉，URL 就不与浏览器一致了。
 *
 * ## 删除页面上是**带前置检查**的，本能力把那一步单独做成了只读能力
 *
 * `customDelete` 先 `GET /study/base/studystudent/isStudentInGrade?studentIds=…`，
 * 命中就提示「XXX已在「YYY」中」而不发删除请求。这是一个**只读**、且对调用方有用的前置
 * （"这个学员能不能删"），所以单独做成 `checkInGrade`。
 *
 * ## 写操作没有做
 *
 * 删除（`DELETE /study/base/studystudent`，批量，body 是 id **数组**）与新建 / 编辑都没做。
 * 删除是不可逆的，且要先过 `checkInGrade` 那道闸 —— 属于要先问清楚的那一类。
 * 见 `docs/pages/学员管理.md` 的「尚未覆盖」。
 */

export const STUDY_STUDENT_PAGE_PATH = '/dashboard/base/student/list'
export const STUDY_STUDENT_PERMISSION = '/dashboard/base/student'

/** 列表接口 */
export const STUDY_STUDENT_LIST_PATH = '/study/base/studystudent/page'
/** 「该学员是否已在某个班里」——删除前的那道闸，只读 */
export const STUDY_STUDENT_IN_GRADE_PATH = '/study/base/studystudent/isStudentInGrade'
/** 删除入口（**本能力没有实现**，列在这里是为了让它可被检索到） */
export const STUDY_STUDENT_DELETE_PATH = '/study/base/studystudent'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/** 学员列表行（字段取自页面 `columns`，其余原样透传） */
export type StudyStudentRow = {
  id: string
  /** 学员姓名 */
  name?: string
  /** 手机号 */
  mobile?: string
  /** 是否已在班级里（页面上是「是否关联班级」那一列，实测形如 0/1） */
  isRelatedClass?: number
  /** 是否关联层级（同上） */
  isRelatedLayer?: number
  createTime?: string
  [key: string]: unknown
}

/** 「在班里」的检查结果行 */
export type StudentInGradeRow = {
  studentName?: string
  gradeName?: string
  [key: string]: unknown
}

export type StudyStudentQuery = {
  /** 学员姓名（模糊匹配） */
  name?: string
  /** 手机号（模糊匹配） */
  mobile?: string
  /**
   * 是否关联班级。页面上是下拉，**取值域未实测**（基准里是空串），
   * 所以本能力只做透传、不给枚举 —— 猜一个枚举比不给更糟。
   */
  isRelatedClass?: string | number
  /** 是否关联层级。同上，取值域未实测 */
  isRelatedLayer?: string | number
  /** 创建时间起 `YYYY-MM-DD HH:mm:ss`；用 buildStudyStudentTimeRange 生成 */
  createTimeStart?: string
  /** 创建时间止，**开区间**（结束日 +1 天）；同上 */
  createTimeEnd?: string
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
  { name: 'name', defaultValue: '' },
  { name: 'mobile', defaultValue: '' },
  { name: 'isRelatedClass', defaultValue: '' },
  { name: 'isRelatedLayer', defaultValue: '' },
  { name: 'createTimeStart', defaultValue: '' },
  { name: 'createTimeEnd', defaultValue: '' },
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
 * 把「创建时间」的日期区间转成接口收的两个参数，**结束日 +1 天**（开区间）。
 *
 * 与页面的 `date[1].add(1,'day')` 一致。这个 +1 天不写出来就会**静默少一天**
 * （选到 9-15 却查不到 9-15 当天的数据），所以单独给函数、不让调用方自己拼。
 */
export function buildStudyStudentTimeRange (
  startDate: string,
  endDate: string,
): { createTimeStart: string; createTimeEnd: string } {
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`)
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('创建时间区间应为 YYYY-MM-DD（或带时间的同格式字符串）')
  }
  if (end.getTime() < start.getTime()) {
    throw new Error('创建时间的结束日必须不早于开始日')
  }
  const pad = (value: number): string => String(value).padStart(2, '0')
  const format = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  return { createTimeStart: format(start), createTimeEnd: format(endExclusive) }
}

const LIST_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '学员姓名（模糊匹配）' },
  { name: 'mobile', kind: 'text', required: false, description: '手机号（模糊匹配）' },
  {
    name: 'isRelatedClass',
    kind: 'text',
    required: false,
    description:
      '是否关联班级。页面上是下拉，但**取值域没有实测过**（基准里是空串），所以这里只透传、不给枚举',
  },
  {
    name: 'isRelatedLayer',
    kind: 'text',
    required: false,
    description: '是否关联层级。同上：透传，不给枚举',
  },
  { name: 'createTimeStart', kind: 'date', required: false, description: '创建时间起 `YYYY-MM-DD HH:mm:ss`' },
  { name: 'createTimeEnd', kind: 'date', required: false, description: '创建时间止，**开区间**（结束日 +1 天）' },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export const studyStudentCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-student-list',
    title: '查询学员列表',
    pagePath: STUDY_STUDENT_PAGE_PATH,
    permission: STUDY_STUDENT_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'study-student-check-in-grade',
    title: '查学员是否已在某个班级里（删除前的前置检查）',
    // 与列表同页：这就是那个页面上的删除前置，页面上也是同一个上下文
    pagePath: STUDY_STUDENT_PAGE_PATH,
    permission: STUDY_STUDENT_PERMISSION,
    write: false,
    params: [
      {
        name: 'studentIds',
        kind: 'text',
        required: true,
        description: '学员 id，**多个用英文逗号连接**（页面就是这么发的：`ids.join(",")`）',
      },
    ],
  },
]

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/base/student/list` 的推导结果 = 12 学习管理）。
 */
export function createStudyStudentCapability (request: PortalRequest) {
  return {
    /** 分页查询学员列表。只读 */
    list (query: StudyStudentQuery = {}): Promise<PageResult<StudyStudentRow>> {
      return request<PageResult<StudyStudentRow>>({
        url: STUDY_STUDENT_LIST_PATH,
        method: 'get',
        params: buildParams(query as Record<string, unknown>),
      })
    },

    /**
     * 查这些学员**是否已经在某个班级里**（只读）。返回命中的行：
     * 空数组 = 都可以删；非空 = 页面据此拒绝删除并提示「XXX已在「YYY」中」。
     *
     * ⚠️ 参数名是 `studentIds`（复数、逗号串），**不是** `ids` —— 与删除接口的 body 不同名。
     * 实测请求：`GET /study/base/studystudent/isStudentInGrade?studentIds=1,2`。
     */
    checkInGrade (studentIds: number | string | Array<number | string>): Promise<StudentInGradeRow[]> {
      const joined = Array.isArray(studentIds) ? studentIds.join(',') : String(studentIds)
      if (joined.trim().length === 0) {
        return Promise.reject(new Error('studentIds 不能为空：这个接口至少要一个学员 id 才有意义'))
      }
      return request<StudentInGradeRow[]>({
        url: STUDY_STUDENT_IN_GRADE_PATH,
        method: 'get',
        params: { studentIds: joined },
      })
    },
  }
}

export type StudyStudentCapability = ReturnType<typeof createStudyStudentCapability>
