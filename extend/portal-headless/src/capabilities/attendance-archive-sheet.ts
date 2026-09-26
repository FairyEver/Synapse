import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 考勤档案 —— 阶段① 第三条业务线，也是**第一个普通的只读列表页**。
 *
 * 页面：`/dashboard/attendance/attendance-archive-sheet/list`
 * 路由文件：`app/portal/views/dashboard/hr/attendance/attendance-archive-sheet/list.vue`
 *
 * 前两条线（会议室、会议预定表单）是流程类 + 写操作，属于**特殊的一类**；
 * Portal 里 691 个列表页有 463 个是声明式列表页，形态就是这一页这样的。
 * 所以这一页要回答的是「方法能不能泛化」，而不只是"又多了一个能力"。
 *
 * 逐字段基准：`baseline/attendance-archive-sheet.browser.json`
 * 四件套记录：`docs/pages/考勤档案.md`
 */

export const ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH =
  '/dashboard/attendance/attendance-archive-sheet/list'
export const ATTENDANCE_ARCHIVE_SHEET_PERMISSION =
  '/dashboard/attendance/attendance-archive-sheet'

/**
 * 列表请求的固定前缀参数。
 *
 * 依据是浏览器真实发出的 URL
 * `…/org/hrAttendanceSheet/page?order=&orderField=&isArchived=1&pageNo=1&pageSize=20`：
 * renren 的列表页在 `formState` 之前先拼 `order` / `orderField` 两个默认空值，
 * 少发就不满足 D20 的逐字段一致。
 *
 * **顺序即 qs 序列化后的顺序**，所以下面这张表是"契约"，不是"默认值表"。
 */
const LIST_QUERY: ReadonlyArray<{
  name: string
  defaultValue: unknown
  /** true = 不接受调用方覆盖，永远是 defaultValue */
  fixed?: boolean
}> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  // ⚠️ 这一项**不开放给调用方**：见下面 ARCHIVED_ONLY 的说明。
  { name: 'isArchived', defaultValue: 1, fixed: true },
  { name: 'yearMonth', defaultValue: null },
  { name: 'departmentId', defaultValue: null },
  { name: 'organizationId', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * 这个页面的定义就是「**已归档**的考勤表」。
 *
 * 实测（`baseline/attendance-archive-sheet.browser.json`）：考勤表页
 * `/dashboard/attendance/attendance-sheet/list` 与本页打的是**同一个接口**
 * `/org/hrAttendanceSheet/page`，两者的唯一差别就是本页多一个 `isArchived=1`。
 *
 * 所以 `isArchived` 不是这个页面的筛选条件，而是它和另一个页面的分界。
 * 把它开放出去，调用方就能在"查考勤档案"这个能力上拿到**未归档考勤表**的数据，
 * 而且不会有任何报错——接口、字段、分页全都一样。因此这里钉死 1，不放进参数契约。
 */
const ARCHIVED_ONLY = 1

export type AttendanceArchiveSheetRow = {
  id: number
  departmentName?: string
  organizationName?: string
  /** 列表展示的是 `year + '-' + month`，接口给的是两个整数 */
  year?: number
  month?: number
  userCount?: number
  updateName?: string
  updateTime?: string
  [key: string]: unknown
}

export type PageResult<T> = { list: T[]; total: number }

export type AttendanceArchiveSheetQuery = {
  /**
   * 月份，格式 `YYYY-MM`（页面是 `a-date-picker picker="month" value-format="YYYY-MM"`）。
   * 传别的格式不会报错，只会**静默查不到数据**——所以下面有 `assertYearMonth` 兜底。
   */
  yearMonth?: string
  /** 部门 id。候选见 `attendance-org-search`（长选项参数，设计 D6 / H35） */
  departmentId?: number
  /** 班组 id。候选同上 */
  organizationId?: number
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * 月份格式校验。
 *
 * 与 `assertTimeSlot` 同一个来历：格式是**前端控件**决定的
 * （`picker="month"` + `value-format="YYYY-MM"`，实测面板格子 `title` 就是 `2026-08`），
 * 后端 `HrAttendanceSheetSelectDTO.yearMonth` 是 `String`，传错的格式它照单全收、
 * 查不到就是空列表——**静默失败**，所以挡在本地。
 */
export function assertYearMonth (yearMonth: string): void {
  if (!MONTH_PATTERN.test(yearMonth)) {
    throw new Error(
      `yearMonth 必须是 YYYY-MM（例如 2026-08），收到的是 ${JSON.stringify(yearMonth)}。` +
        '格式来自页面的月份选择器（value-format="YYYY-MM"）；传别的格式后端不会报错，只会查不到数据。',
    )
  }
}

/** 组织类型。1=部门、2=班组，来自页面 `common-action-select` 的 `:type` 实参 */
export type OrganizationType = 1 | 2

export const ORGANIZATION_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: OrganizationType }> = [
  { label: '部门', value: 1 },
  { label: '班组', value: 2 },
]

export type Organization = { id: number; name: string; [key: string]: unknown }

export type OrganizationSearchQuery = {
  /** 名称关键字。**长选项参数必须先要关键字**（设计 D6 / H35） */
  keyword: string
  /** 1=部门（测试环境实测 17 个），2=班组（实测约 697 个） */
  type: OrganizationType
  /** 最多返回几条候选，默认 20，上限 50 */
  limit?: number
}

/** 搜索返回的候选条数上限：防止把几百个班组一次性冲进调用方上下文 */
export const ORGANIZATION_SEARCH_MAX = 50
export const ORGANIZATION_SEARCH_DEFAULT = 20

const ORGANIZATION_URL = '/org/organization/getAllOrganizationByType'

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: AttendanceArchiveSheetQuery): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const item of LIST_QUERY) {
    const value = item.fixed === true ? item.defaultValue : provided[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'yearMonth',
    kind: 'date',
    required: false,
    description: '月份，格式必须是 YYYY-MM（如 2026-08）。页面是月份选择器，格式由它决定；传错格式不会报错、只会查不到',
  },
  {
    name: 'departmentId',
    kind: 'search',
    required: false,
    description:
      '部门 id。候选有十几个，**先问用户关键字**再调 attendance-org-search（type=1）取候选，不要猜 id',
    lookup: { capabilityId: 'attendance-org-search', keywordParam: 'keyword' },
  },
  {
    name: 'organizationId',
    kind: 'search',
    required: false,
    description:
      '班组 id。候选项近千，**先问用户关键字**再调 attendance-org-search（type=2）取候选，不要猜 id',
    lookup: { capabilityId: 'attendance-org-search', keywordParam: 'keyword' },
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/**
 * ⚠️ 这里**故意没有** `isArchived`。
 * 它是"这一页是哪一页"的定义（=1 才是考勤档案，=0 是考勤表页），不是筛选条件。
 * 见上面 `ARCHIVED_ONLY` 的说明。
 */
export const attendanceArchiveSheetCapabilities: CapabilityDefinition[] = [
  {
    id: 'attendance-archive-sheet-list',
    title: '查询考勤档案（已归档的考勤表）列表',
    pagePath: ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH,
    permission: ATTENDANCE_ARCHIVE_SHEET_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'attendance-org-search',
    title: '按关键字搜索部门 / 班组候选',
    pagePath: ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH,
    permission: ATTENDANCE_ARCHIVE_SHEET_PERMISSION,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description: '部门 / 班组名称关键字。候选是**全量列表**（班组近千条），不允许无关键字全量拉取（设计 D6 / H35）',
      },
      {
        name: 'type',
        kind: 'enum',
        required: true,
        description: '组织类型：1=部门，2=班组。必须显式给，两个筛选框的候选来自同一个接口的不同 type',
        options: ORGANIZATION_TYPE_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条候选，默认 ${ORGANIZATION_SEARCH_DEFAULT}，上限 ${ORGANIZATION_SEARCH_MAX}`,
      },
    ],
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文（module-type 走
 * `/dashboard/attendance/attendance-archive-sheet/list` 的推导结果）。
 */
export function createAttendanceArchiveSheetCapability (request: PortalRequest) {
  return {
    /** 分页查询考勤档案。只读 */
    list (query: AttendanceArchiveSheetQuery = {}): Promise<PageResult<AttendanceArchiveSheetRow>> {
      // 参数错误一律走 Promise.reject，与 searchUsers 一致：调用方总能 .catch 到
      if (query.yearMonth !== undefined && query.yearMonth !== null) {
        try {
          assertYearMonth(query.yearMonth)
        } catch (error) {
          return Promise.reject(error)
        }
      }
      return request<PageResult<AttendanceArchiveSheetRow>>({
        url: '/org/hrAttendanceSheet/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /**
     * 按关键字搜部门 / 班组候选（只读）。
     *
     * 页面自己是在挂载时把**全量**组织表拉下来塞进 `a-select`
     * （`portal-hxr-select-user-department/index.vue` → `GET /org/organization/getAllOrganizationByType`，
     * 两个框各拉一次，type=1 与 type=2）。无头不能照抄：
     * 班组那一侧实测近千条，直接返回会冲掉调用方的上下文（设计 D6 / H35）。
     * 所以这里**强制要关键字**，在本地按名称过滤后再限量返回。
     *
     * 过滤在本地做，是因为这个接口只有 `type` 一个参数、没有任何关键字入参
     * （实测的请求就是 `?type=1` 两个字符的参数），服务端不支持按名搜。
     */
    async searchOrganizations (
      query: OrganizationSearchQuery,
    ): Promise<{ list: Organization[]; total: number; matched: number }> {
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
      if (keyword.length === 0) {
        return Promise.reject(
          new Error(
            '部门 / 班组属于长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。' +
              '用户说不出完整名字时，先问他名字里的一两个字。',
          ),
        )
      }
      if (query.type !== 1 && query.type !== 2) {
        return Promise.reject(
          new Error(`type 只能是 1（部门）或 2（班组），收到的是 ${JSON.stringify(query.type)}`),
        )
      }

      const all = await request<Organization[]>({
        url: ORGANIZATION_URL,
        method: 'get',
        params: { type: query.type },
      })
      const list = Array.isArray(all) ? all : []
      const hit = list.filter((item) => String(item?.name ?? '').includes(keyword))
      const limit = Math.min(
        Math.max(1, Math.trunc(query.limit ?? ORGANIZATION_SEARCH_DEFAULT)),
        ORGANIZATION_SEARCH_MAX,
      )
      return { list: hit.slice(0, limit), total: list.length, matched: hit.length }
    },
  }
}

export type AttendanceArchiveSheetCapability = ReturnType<typeof createAttendanceArchiveSheetCapability>
