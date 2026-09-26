import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 考勤统计 —— 阶段① 第三条业务线（考勤域）的**第二个页面**，
 * 与考勤档案（`src/capabilities/attendance-archive-sheet.ts`）打的是**同一个接口**。
 *
 * 页面：`/dashboard/attendance/attendance-sheet/list`（菜单名「考勤统计」）
 * 路由文件：`app/portal/views/dashboard/hr/attendance/attendance-sheet/list.vue`
 *
 * 逐字段基准：`baseline/attendance-statistics.browser.json`
 * 四件套记录：`docs/pages/考勤统计.md`
 *
 * ## 与考勤档案页的分界：`isArchived`
 *
 * 两个页面共用 `GET /org/hrAttendanceSheet/page`，**唯一差别**是考勤档案页多一个
 * `isArchived=1`（实测见两个页面的基准文件）。这一页一个字都不发这个参数，与浏览器一致。
 *
 * 实测还说清了另一件事：**这一页不是"未归档列表"**。不传 `isArchived` 时后端返回的是
 * **全部**考勤表（118 条，是档案页那 105 条的**超集**，行里既有 `isArchived=0` 也有 `=1`），
 * 页面把「编辑 / 归档 / 删除」按 `record.isArchived` 置灰也说明它预期两种行都会有。
 *
 * 所以这一页**没有** `isArchived` 参数，而且调用方硬塞会被拒（见下面 `assertNoArchivedFlag`）：
 * 它不是这一页的筛选条件，而是"这两个能力各自是哪一个"的分界 ——
 * 放它进来，这一页就能装成档案页（`isArchived=1` 恰好是档案页的全部数据），
 * 两个能力变成一个；而 `isArchived=0` 那条语义**没有实测过**
 * （后端认不认、指的是"未归档"还是"全部"，都未知）。档案页那边是把值钉死成 1，方向相反、道理相同。
 *
 * ## 同页写操作
 *
 * 保存、归档、取消归档、删除和统计由 attendance-sheet.ts 注册；本模块保留列表职责。
 * 归档接口虽然是 GET，仍按写能力登记；真实写入及清理记录见 docs/pages/考勤表操作.md。
 */

export const ATTENDANCE_STATISTICS_PAGE_PATH = '/dashboard/attendance/attendance-sheet/list'

/** 这一页的权限码（`generated/page-catalog.json` 的 `permission`，与菜单树同源） */
export const ATTENDANCE_STATISTICS_PERMISSION = '/dashboard/attendance/attendance-sheet'

/**
 * 列表请求的固定参数表。
 *
 * 依据是浏览器真实发出的 URL（`baseline/attendance-statistics.browser.json`）：
 *
 * ```text
 * /admin-api/org/hrAttendanceSheet/page?order=&orderField=&pageNo=1&pageSize=20&_t=…
 * /admin-api/org/hrAttendanceSheet/page?order=&orderField=&departmentId=38&organizationId=46&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * **顺序即 qs 序列化后的顺序**，所以下面这张表是"契约"，不是"默认值表"（D20 逐字段一致）。
 * 少了 `order` / `orderField` 这两个空值就不与浏览器逐字段一致；`departmentId` /
 * `organizationId` 的初值是 `null`，被 qs 的 `skipNulls` 丢掉（浏览器同样不发）。
 *
 * ⚠️ 表里**故意没有** `isArchived` —— 见文件头。
 */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'departmentId', defaultValue: null },
  { name: 'organizationId', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type AttendanceStatisticsRow = {
  id: number
  /** 列「名称」 */
  name?: string
  departmentName?: string
  organizationName?: string
  userCount?: number
  /**
   * 这一行是否已归档。
   *
   * 页面用它来决定「编辑 / 归档 / 删除」三个动作可不可点（`:disabled="!!record.isArchived"`），
   * 所以这一页的列表**能**出现已归档的行 —— 它不是「未归档」的列表，
   * 而是「不按归档状态筛选」的列表（实测见 `docs/pages/考勤统计.md`）。
   */
  isArchived?: number | boolean
  updateName?: string
  updateTime?: string
  [key: string]: unknown
}

export type PageResult<T> = { list: T[]; total: number }

export type AttendanceStatisticsQuery = {
  /** 部门 id。候选见 `attendance-org-search`（长选项参数，设计 D6 / H35） */
  departmentId?: number
  /** 班组 id。候选同上 */
  organizationId?: number
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/** 组织类型。1=部门、2=班组，与档案页共用同一个候选入口 */
export type OrganizationType = 1 | 2

export const ORGANIZATION_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: OrganizationType }> = [
  { label: '部门', value: 1 },
  { label: '班组', value: 2 },
]

/**
 * 候选来源：**故意复用**档案页已经建好的 `attendance-org-search`，本文件不另建一份。
 *
 * 两个页面的部门 / 班组选框是**同一个组件、同一个接口、同一个 type 取值**
 * （`portal-hxr-select-user-department` → `GET /org/organization/getAllOrganizationByType?type=N`），
 * 而且都在 `/dashboard/attendance/` 下、module-type 同为 11 组织管理，
 * 所以那个能力的页面上下文对本页同样成立。再建一个 id 不同、内容一样的候选入口
 * 只会让调用方猜该用哪个。
 */
export const ORGANIZATION_SEARCH_CAPABILITY_ID = 'attendance-org-search'

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: AttendanceStatisticsQuery): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const item of LIST_QUERY) {
    const value = provided[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * `isArchived` 不属于这一页。
 *
 * 与档案页的做法**刻意不同**（那一页是把值钉死成 1、硬塞无效），原因是两边的失败代价不一样：
 * 档案页只有"已归档"这一个值，钉死不会丢掉调用方想要的任何东西；
 * 而这一页的调用方如果真的传了 `isArchived`，说明他想要的是**另一个页面**的结果 ——
 * 这时静默按自己的语义返回另一种数据，正好是仓库里反复出现的那类"不报错但是错的"。
 * 所以这里显式拒绝，并把该用哪个能力告诉他。
 */
export function assertNoArchivedFlag (query: unknown): void {
  if (query === null || typeof query !== 'object') return
  if (Object.prototype.hasOwnProperty.call(query, 'isArchived')) {
    throw new Error(
      'isArchived 不是「考勤统计」的参数：它是本页与「考勤档案」的分界，' +
        '传它不会报错、只会让你以为拿到的是另一种数据。要查已归档的考勤表请用 attendance-archive-sheet-list。',
    )
  }
}

const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'departmentId',
    kind: 'search',
    required: false,
    description:
      '部门 id。候选有十几个，**先问用户关键字**再调 attendance-org-search（type=1）取候选，不要猜 id',
    lookup: { capabilityId: ORGANIZATION_SEARCH_CAPABILITY_ID, keywordParam: 'keyword' },
  },
  {
    name: 'organizationId',
    kind: 'search',
    required: false,
    description:
      '班组 id。候选项近千，**先问用户关键字**再调 attendance-org-search（type=2）取候选，不要猜 id',
    lookup: { capabilityId: ORGANIZATION_SEARCH_CAPABILITY_ID, keywordParam: 'keyword' },
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/**
 * ⚠️ 这里**故意没有** `isArchived`，也**没有** `yearMonth`：
 * 前者是"这一页是哪一页"的定义（见文件头），后者这一页根本没有这个筛选框
 * （实测请求里没有它，档案页才有）。
 */
export const attendanceStatisticsCapabilities: CapabilityDefinition[] = [
  {
    id: 'attendance-statistics-list',
    title: '查询考勤统计（考勤表）列表',
    pagePath: ATTENDANCE_STATISTICS_PAGE_PATH,
    permission: ATTENDANCE_STATISTICS_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文（module-type 走
 * `/dashboard/attendance/attendance-sheet/list` 的推导结果 = 11 组织管理）。
 */
export function createAttendanceStatisticsCapability (request: PortalRequest) {
  return {
    /** 分页查询考勤统计列表。只读 */
    list (query: AttendanceStatisticsQuery = {}): Promise<PageResult<AttendanceStatisticsRow>> {
      try {
        assertNoArchivedFlag(query)
      } catch (error) {
        // 参数错误一律走 Promise.reject，与 list 的其它校验、searchUsers 一致
        return Promise.reject(error)
      }
      return request<PageResult<AttendanceStatisticsRow>>({
        url: '/org/hrAttendanceSheet/page',
        method: 'get',
        params: buildListParams(query),
      })
    },
  }
}

export type AttendanceStatisticsCapability = ReturnType<typeof createAttendanceStatisticsCapability>
