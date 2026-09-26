import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 班级管理 —— 学习管理域「课堂管理 → 班级管理」。
 *
 * 页面：`/dashboard/grade/grade/list`
 * 路由文件：`app/portal/views/dashboard/education/grade/grade/list.vue`
 * 逐字段基准：`baseline/study-base.browser.json`
 * 四件套记录：`docs/pages/班级管理.md`
 *
 * ## 这一页**没有** `convertFetchForm`
 *
 * 它是"纯声明式"那一类：参数顺序就是 `order → orderField → 表单原样 → pageNo → pageSize → _t`
 * （`list.js:473-483`）。实测 URL：
 *
 * ```text
 * /admin-api/study/grade/studygrade/page
 *   ?order=&orderField=&name=&type=&studentNumMin=&studentNumMax=&teacherName=&teachingAssistantName=&orgId=&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * ⚠️ 注意与**同域那几个带 `convertFetchForm` 的页面相反**：这一页的每一个空值也照发，
 * 而且没有 `date` 被拆成两个标量这回事。
 *
 * ## 它同时是**别处的班级候选入口**——但别照抄页面那一套
 *
 * 课堂三页与学员统计页挂载时都会拉 `GET /study/grade/studygrade/page?pageSize=99999&pageNo=1`
 * 把**全部班级**塞进下拉（实测：一次 99999 条）。那是页面的做法，**无头不能照抄**
 * （设计 D6 / H35：长选项参数必须先要关键字）。
 * 所以本能力提供的 `searchByKeyword` 是**按下拉那一套的替代**：强制要关键字、在本地过滤后再限量返回。
 *
 * ## 写操作
 *
 * 班级删除和班级详情里的「移出学员」都按 prepare → submit → cancel 暴露。
 * prepare/cancel 只在本地校验或返回取消标记；submit 才发送真实请求。
 * 页面行尾的「启用/停用」仍未实现：它是先 `PUT /study/grade/studygrade/updateStatus`，
 * 再 `PUT /study/grade/studygrade` 的两步写。
 */

export const STUDY_GRADE_PAGE_PATH = '/dashboard/grade/grade/list'
export const STUDY_GRADE_PERMISSION = '/dashboard/grade/grade'

/** 列表接口。同时也是**班级候选**的来源 */
export const STUDY_GRADE_LIST_PATH = '/study/grade/studygrade/page'
/** 启用/停用的第一步（**本能力没有实现**，列在这里是为了让它可被检索到） */
export const STUDY_GRADE_UPDATE_STATUS_PATH = '/study/grade/studygrade/updateStatus'
/** 班级删除入口（批量，body 是裸 ID 数组） */
export const STUDY_GRADE_DELETE_PATH = '/study/grade/studygrade'
/** 班级详情「移出学员」入口（批量，body 是班级学员关联 ID 的裸数组） */
export const STUDY_GRADE_STUDENT_DELETE_PATH = '/study/grade/student'
export const STUDY_GRADE_STUDENT_PAGE_PATH = STUDY_GRADE_PAGE_PATH
export const STUDY_GRADE_STUDENT_PERMISSION = STUDY_GRADE_PERMISSION
/** 组织结构下的隐藏「管理班级」页复用的班级删除入口 */
export const STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH = '/dashboard/base/management-center/list'
export const STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION = '/dashboard/base/management-center'
export const STUDY_GRADE_MODULE_TYPE = 12

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/**
 * 页面自己给班级下拉用的每页条数（`pageSize=99999`）。
 *
 * ⚠️ **本能力不提供这个用法** —— 列在这里是为了让读代码的人知道
 * 「别处的 99999 是从哪来的」，以及为什么这里不照抄（设计 D6 / H35）。
 * 要候选请用 `searchByKeyword`。
 */
export const PAGE_GRADE_ALL_PAGE_SIZE = 99999

export type PageResult<T> = { list: T[]; total: number }

/** 班级列表行（字段取自页面 `columns`，其余原样透传） */
export type StudyGradeRow = {
  id: string
  /** 编号（页面上那一列叫「编号」） */
  serialNumber?: string
  /** 班级名称 */
  name?: string
  /** 状态。页面行尾的「启用/停用」按 `status === 0` 判断方向 */
  status?: number
  type?: number
  /** 学员数 */
  studentNum?: number
  teacherName?: string
  teachingAssistantName?: string
  /** 归属组织 id */
  orgId?: number
  [key: string]: unknown
}

export type StudyGradeQuery = {
  /** 班级名称（模糊匹配） */
  name?: string
  /** 班级类型。页面上是下拉，**取值域未实测**（基准里是空串）—— 只透传、不给枚举 */
  type?: number | string
  /** 学员数下限 */
  studentNumMin?: number | string
  /** 学员数上限 */
  studentNumMax?: number | string
  /** 讲师姓名（模糊，不是 id） */
  teacherName?: string
  /** 助教姓名（模糊，不是 id） */
  teachingAssistantName?: string
  /**
   * 归属组织 id。候选来源：`base-dept-*`（部门树）或
   * `GET /org/organization/getRoleOrganizationTree`（页面用的那个，按角色变）。
   * **先问用户要关键字**再取候选，不要猜 id。
   */
  orgId?: number
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
  { name: 'type', defaultValue: '' },
  { name: 'studentNumMin', defaultValue: '' },
  { name: 'studentNumMax', defaultValue: '' },
  { name: 'teacherName', defaultValue: '' },
  { name: 'teachingAssistantName', defaultValue: '' },
  { name: 'orgId', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  query: Record<string, unknown>,
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of LIST_ORDER) {
    if (Object.prototype.hasOwnProperty.call(override, item.name)) {
      params[item.name] = override[item.name]
      continue
    }
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

const LIST_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '班级名称（模糊匹配）' },
  {
    name: 'type',
    kind: 'text',
    required: false,
    description: '班级类型。页面是下拉但**取值域没有实测过**，这里只透传、不给枚举',
  },
  { name: 'studentNumMin', kind: 'number', required: false, description: '学员数下限' },
  { name: 'studentNumMax', kind: 'number', required: false, description: '学员数上限' },
  { name: 'teacherName', kind: 'text', required: false, description: '讲师姓名（模糊匹配，不是 id）' },
  { name: 'teachingAssistantName', kind: 'text', required: false, description: '助教姓名（模糊匹配，不是 id）' },
  {
    name: 'orgId',
    kind: 'tree',
    required: false,
    description: '归属组织 id。**先问用户关键字**再取候选（页面用的是按角色变的组织树），不要猜 id',
    lookup: { capabilityId: 'base-dept-search', keywordParam: 'keyword' },
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export type StudyGradeId = number | string

function parseIds (value: unknown, label: string): StudyGradeId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}必须是非空数组`)
  }
  return value.map((id) => {
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id
    if (typeof id === 'string' && /^[1-9]\d*$/.test(id)) return id
    throw new Error(`${label}只能包含正整数 ID`)
  })
}

const GRADE_IDS_PARAMS: ParamSpec[] = [
  {
    name: 'ids',
    kind: 'array',
    required: true,
    description: '要删除的班级 ID 非空数组；不能传组织 ID 或对象数组',
  },
]

const GRADE_STUDENT_IDS_PARAMS: ParamSpec[] = [
  {
    name: 'ids',
    kind: 'array',
    required: true,
    description: '班级学员关联记录 ID 非空数组；不是学员主表 ID、staffCode 或对象数组',
  },
]

function prepareIds (value: { ids: StudyGradeId[] }, label: string): { ids: StudyGradeId[] } {
  return { ids: parseIds(value?.ids, label) }
}

export const studyGradeCapabilities: CapabilityDefinition[] = [
  {
    id: 'study-grade-list',
    title: '查询班级列表',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'study-grade-search',
    title: '按关键字查班级（长选项参数的候选入口）',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'text',
        required: true,
        description:
          '班级名称的关键字。**必填**：页面为了让下拉能搜，挂载时一次拉 99999 条全部班级，' +
          '无头不能照抄（设计 D6 / H35）。用户说不出完整名字时，先问他名字里的一两个字。',
      },
      { name: 'limit', kind: 'number', required: false, description: '最多返回几条，默认 20' },
    ],
  },
  {
    id: 'study-grade-prepare-remove',
    title: '准备删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-remove',
    title: '删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-cancel-remove',
    title: '取消删除班级',
    pagePath: STUDY_GRADE_PAGE_PATH,
    permission: STUDY_GRADE_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    write: false,
    params: [],
  },
  {
    id: 'study-grade-student-prepare-remove',
    title: '准备从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_STUDENT_IDS_PARAMS,
  },
  {
    id: 'study-grade-student-remove',
    title: '从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_STUDENT_IDS_PARAMS,
  },
  {
    id: 'study-grade-student-cancel-remove',
    title: '取消从班级移出学员',
    pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
    permission: STUDY_GRADE_STUDENT_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },
  {
    id: 'study-grade-management-center-prepare-remove',
    title: '准备从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-management-center-remove',
    title: '从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: true,
    params: GRADE_IDS_PARAMS,
  },
  {
    id: 'study-grade-management-center-cancel-remove',
    title: '取消从组织结构删除班级',
    pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
    moduleType: STUDY_GRADE_MODULE_TYPE,
    httpInstance: 'platform',
    write: false,
    params: [],
  },
]

/** 页面能力 ID 与 SDK 方法名的固定映射；供目录和统一调用入口复用。 */
export const STUDY_GRADE_METHODS = {
  'study-grade-list': 'list',
  'study-grade-search': 'searchByKeyword',
  'study-grade-prepare-remove': 'prepareRemove',
  'study-grade-remove': 'remove',
  'study-grade-cancel-remove': 'cancelRemove',
  'study-grade-student-prepare-remove': 'prepareRemoveStudents',
  'study-grade-student-remove': 'removeStudents',
  'study-grade-student-cancel-remove': 'cancelRemoveStudents',
  'study-grade-management-center-prepare-remove': 'prepareRemoveManagementCenterGrades',
  'study-grade-management-center-remove': 'removeManagementCenterGrades',
  'study-grade-management-center-cancel-remove': 'cancelRemoveManagementCenterGrades',
} as const

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走 `/dashboard/grade/grade/list` 的推导结果 = 12 学习管理）。
 */
export function createStudyGradeCapability (request: PortalRequest) {
  return {
    /** 分页查询班级列表。只读 */
    list (query: StudyGradeQuery = {}): Promise<PageResult<StudyGradeRow>> {
      return request<PageResult<StudyGradeRow>>({
        url: STUDY_GRADE_LIST_PATH,
        method: 'get',
        params: buildParams(query as Record<string, unknown>),
      })
    },

    /**
     * 按关键字查班级（只读）。**这是给"班级候选"用的入口**，不是列表页的替代。
     *
     * 为什么要关键字：页面为了让下拉能本地搜，挂载时发的是
     * `pageSize=99999` 一次拉全量；无头照着发会把整个班级表冲进调用方的上下文
     * （设计 D6 / H35）。这里强制要关键字，并且**在本地再过滤一次**（后端的 `name`
     * 是模糊匹配，但本地过滤能保证"关键字真的出现在结果里"这件事可预期），
     * 最后按 `limit` 截断。
     *
     * ⚠️ `matched` 是**过滤后**的条数、`total` 是后端报的总数 —— 两者不同名是有意的：
     * 调用方需要知道"后端一共多少、我拿到多少"，好判断要不要让用户再收窄关键字。
     */
    async searchByKeyword (
      query: { keyword: string; limit?: number },
    ): Promise<{ list: StudyGradeRow[]; total: number; matched: number }> {
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
      if (keyword.length === 0) {
        throw new Error(
          '班级属于长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。' +
            '用户说不出完整名字时，先问他名字里的一两个字。',
        )
      }
      const limit = query.limit === undefined ? 20 : query.limit
      const page = await request<PageResult<StudyGradeRow>>({
        url: STUDY_GRADE_LIST_PATH,
        method: 'get',
        params: buildParams({ name: keyword }, { pageNo: 1, pageSize: limit }),
      })
      const lowered = keyword.toLowerCase()
      const matched = (page.list ?? []).filter((row) =>
        String(row.name ?? '').toLowerCase().includes(lowered),
      )
      return { list: matched, total: page.total, matched: matched.length }
    },

    prepareRemove (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '班级 ID')
    },

    async remove (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '班级 ID')
      await request({ url: STUDY_GRADE_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemove (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareRemoveStudents (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '班级学员关联 ID')
    },

    async removeStudents (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '班级学员关联 ID')
      await request({ url: STUDY_GRADE_STUDENT_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemoveStudents (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareRemoveManagementCenterGrades (input: { ids: StudyGradeId[] }): { ids: StudyGradeId[] } {
      return prepareIds(input, '组织结构中的班级 ID')
    },

    async removeManagementCenterGrades (input: { ids: StudyGradeId[] }): Promise<void> {
      const prepared = prepareIds(input, '组织结构中的班级 ID')
      await request({ url: STUDY_GRADE_DELETE_PATH, method: 'delete', data: prepared.ids })
    },

    cancelRemoveManagementCenterGrades (): { cancelled: true } {
      return { cancelled: true }
    },
  }
}

export type StudyGradeCapability = ReturnType<typeof createStudyGradeCapability>
