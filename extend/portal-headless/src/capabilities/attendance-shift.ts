import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 班次管理 —— 考勤域（阶段① 第三条业务线）的**第三个页面**，也是这个域里
 * 第一个**带完整增删改**的页面。
 *
 * 页面：`/dashboard/attendance/attendance-shift/list`
 * 路由文件：`app/portal/views/dashboard/hr/attendance/attendance-shift/list.vue`
 * 表单页：同目录的 `[mode]/[id].vue`
 *
 * 前两个页面（考勤档案 / 考勤统计）打的是同一个只读接口的两面，读能力做完就完了；
 * 这一页是**管理页**：列表 → 新建 / 编辑 / 删除，四个动作各是一个后端接口。
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /org/hrWorkShift/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /org/hrWorkShift/{id}` | 后端 `@GetMapping("{id}")`；前端**没有**调用点（编辑页走 bridge） |
 * | 新建 | `POST /org/hrWorkShift/save` | `[mode]/[id].vue` 的 `customSubmit` |
 * | 修改 | `PUT /org/hrWorkShift`（整单替换） | 同上 |
 * | 删除 | `DELETE /org/hrWorkShift/{id}` | `list.vue` 的 `deleteURL` + renren 通用删除 |
 *
 * 逐字段基准：`baseline/attendance-shift.browser.json`（读 2 条 + 写 3 条，全是实测）
 * 四件套记录：`docs/pages/班次管理.md`
 *
 * ## 没有 `prepare`
 *
 * 与作业管理那条线同理：`prepare` 在会议室那条线上的唯一职责是"提交前问后端这次要人工
 * 指定哪些审批人"，那个答案会改变提交载荷。这一页的后端没有这种接口，硬造一个就是给
 * "读"套上"提交流程"的名字。
 *
 * 真的有一个**只读前置步骤**，但它不叫 `prepare`：`update()` 打的是整单替换的 PUT，
 * 所以调用方**必须先 `get()` 拿当前值再改**，否则没传的字段会按默认值写回去。
 * 它是独立能力 `get`，不在 `update` 内部代劳 —— 自动合并会把表单不认识的服务端字段
 * （`creator` / `createTime` / `updater` 之类）一并回写，那是**没验证过的形状**。
 *
 * ## 写链路里只有 `create` 需要防重（D12 在这里要收窄）
 *
 * `docs/conventions.md` 第 14 条说"后端零幂等，AI 超时重发 = 重复单据"。这句话的**代价**
 * 在这个页面上只有 `create` 会产生：
 *
 * | 写能力 | 重发一次的后果 | 要不要 `requestId` |
 * | --- | --- | --- |
 * | `create` | **多一条班次**（后端零幂等） | **要**（门面上的 `createIdempotent`） |
 * | `update` | 同样的整单替换再写一次，终态相同 | 不要 |
 * | `remove` | 逻辑删除，重复删后端直接返回成功 | 不要 |
 *
 * 后两行的"不要"是**实测**（`smoke/attendance-shift-crud.mjs`：update 原样重发一次仍只有
 * 一条、终态不变；remove 连删两次都返回成功），不是推断。
 *
 * `create` 的幂等身份用 `requestId`，与作业管理那条线同一套（`src/idempotency/`）。
 *
 * ## `remove` 是**逻辑删除**，而且**会被占用挡住**（实测）
 *
 * 删掉之后 `list` 查不到，但 `get(id)` **仍然返回这一整行**，只是 `isDel` 从 0 变成 1。
 * 所以"删干净了没有"**只能看列表**，拿 `get` 复核会得到一个看起来像"没删掉"的假象。
 *
 * 另一条：后端 `HrWorkShiftServiceImpl.deleteWorkShift` 会先查 `hr_attendance_group`
 * 里有没有 `shift_id` 指向它、且 `is_del=0` 的考勤组，有就返回业务错误
 * 「该班次正在使用，无法删除!」。**所以删除可能失败**，SDK 如实透传，不做预检查
 * （预检查要另打一个接口，而且查到"没被用"也不保证删的时候还没被用）。
 *
 * ## `status` 这个表单项**没有进参数契约**（实测）
 *
 * `list.vue` 的 `form: { name: null, status: null }` 里确实声明了 `status`，但页面上
 * **没有任何控件绑定它**（表单区只有一个「班次名称」输入框），浏览器发出的请求里也
 * 从来没有它（初值 null 被 qs 的 skipNulls 丢掉）。后端 `getWrapper` 是支持按 status 过滤的，
 * 可是取值语义没有任何地方消费（`hr_work_shift.status` 在整个后端只被写、从不被读）。
 *
 * ⇒ SDK 不把它放进契约，**而且硬传会被拒**（见下面 `assertNoStatusParam`）：
 * 悄悄忽略会让调用方以为"筛过了"，悄悄转发又是在契约之外开一个来路不明的筛选条件。
 */

export const ATTENDANCE_SHIFT_PAGE_PATH = '/dashboard/attendance/attendance-shift/list'

/** 该页的权限码（`generated/page-catalog.json` 的 `permission`，与菜单树同源） */
export const ATTENDANCE_SHIFT_PERMISSION = '/dashboard/attendance/attendance-shift'

/**
 * 该页的 module-type。
 *
 * `resolveModuleType(ATTENDANCE_SHIFT_PAGE_PATH)` → 11 组织管理，与浏览器在**列表页**上
 * 实测发的一致（基准里的四条列表相关请求都是 11）。
 *
 * ⚠️ 新建页那条 POST **一个 module-type 都没发**（`baseline/attendance-shift.browser.json` 第 3 条）：
 * 这个头读的是 cookie `hr-0.0.0-menuPath`，在 `…/attendance-shift/create/new` 这条路由上取不到值。
 * SDK 的能力全部绑在**列表页路径**上，所以拿到的是 11 —— 与浏览器在列表页上的行为一致，
 * 不去复刻它在另一个路由上的"取不到"。这条头的坑详见 `docs/pages/班次管理.md`。
 */
export const ATTENDANCE_SHIFT_MODULE_TYPE = 11

/**
 * 列表请求的固定参数表。
 *
 * 依据是浏览器真实发出的 URL（`baseline/attendance-shift.browser.json`）：
 *
 * ```text
 * /admin-api/org/hrWorkShift/page?order=&orderField=&pageNo=1&pageSize=20&_t=…
 * /admin-api/org/hrWorkShift/page?order=&orderField=&name=%E7%8F%AD&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * **顺序即 qs 序列化后的顺序**，所以下面这张表是"契约"，不是"默认值表"（D20 逐字段一致）。
 * `name` 的初值是 `null`，被 qs 的 skipNulls 丢掉 —— 浏览器不填名称时也不发它。
 * 少了 `order` / `orderField` 这两个空值就不与浏览器逐字段一致。
 *
 * ⚠️ 表里**故意没有** `status`（页面确实声明了它，但没有任何控件绑定，浏览器从不发）——
 * 见文件头。
 */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 班次名称的长度上限：页面表单规则 `max: 20`（`[mode]/[id].vue` 的 `rules.name`） */
export const SHIFT_NAME_MAX_LENGTH = 20

export type AttendanceShiftRow = {
  /** 后端把 Long 序列化成**字符串**（实测：PUT body 里是 `"id":"9"`，删除 URL 是 `/hrWorkShift/9`） */
  id?: string | number
  /** 班次名称 */
  name?: string
  /** 四个时间字段都是 `HH:mm:ss` 字符串（后端 `Time` 类型） */
  morningStartTime?: string
  morningEndTime?: string
  afternoonStartTime?: string
  afternoonEndTime?: string
  /**
   * 状态。**这一页读得到、但没有任何地方消费它**：
   * 列表不展示、表单不绑定、后端 `hr_work_shift.status` 只被写不被读。
   * 如实留在行类型里（服务端确实会返回），但**不是**可传的查询参数。
   */
  status?: number
  /** 逻辑删除标记。`remove` 之后 `get` 仍返回这一行，`isDel` 变成 1 */
  isDel?: number
  createTime?: string
  creator?: string | number
  updateTime?: string
  updater?: string | number
  [key: string]: unknown
}

export type AttendanceShiftQuery = {
  /**
   * 班次名称，**模糊匹配**（后端 `getWrapper` 用的是 `wrapper.like("name", name)`）。
   * ⚠️ 因为是 like，改名后的新名字如果**包含**原名，用原名仍然查得到 ——
   * 判断"改名成没成功"时新名字不能包含原名（这条坑在作业管理那条线上踩过）。
   */
  name?: string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/** 新建 / 修改的载荷：页面上真的能填的就这五个字段 */
export type AttendanceShiftDraft = {
  /** 班次名称，必填，≤20 字（页面规则） */
  name: string
  /** 上午开始考勤时间，`HH:mm:ss`（页面 `value-format="HH:mm:ss"`） */
  morningStartTime: string
  /** 上午结束考勤时间，`HH:mm:ss` */
  morningEndTime: string
  /** 下午开始考勤时间，`HH:mm:ss` */
  afternoonStartTime: string
  /** 下午结束考勤时间，`HH:mm:ss` */
  afternoonEndTime: string
}

/** 修改用的载荷：整单替换，多一个 `id` */
export type AttendanceShiftUpdateDraft = AttendanceShiftDraft & {
  /** 记录 id，来自 `list()` / `get()`。数字会被转成字符串（后端就是这么给的） */
  id: string | number
}

/** `HH:mm:ss`，与页面 `a-time-picker` 的 `value-format` 逐字一致 */
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

/**
 * 时间格式校验。
 *
 * 与 `assertTimeSlot` / `assertYearMonth` 同一个来历：格式由**前端控件**决定
 * （`value-format="HH:mm:ss"`，实测面板上选 8 点 + 确定后输入框就是 `08:00:00`）。
 * 后端 DTO 的字段类型是 `java.sql.Time`：格式不对会 400，但**代价是整条写请求失败**，
 * 而且错误信息是框架给的解析异常、看不出是哪个控件的问题 —— 所以挡在本地。
 *
 * 注意这里**只校验格式**，不校验"开始早于结束"：页面的表单规则只有 `required`，
 * 没有跨字段约束（实测基准里那条 `13:00:00~05:00:00` 的行就是现存数据），
 * 后端也不校验。硬加一条会把后端本来接受的调用挡在门外。
 */
export function assertClockTime (label: string, value: unknown): void {
  if (typeof value !== 'string' || !CLOCK_TIME_PATTERN.test(value)) {
    throw new Error(
      `${label} 必须是 HH:mm:ss（例如 08:30:00），收到的是 ${JSON.stringify(value)}。` +
        '格式来自页面的时间选择器（value-format="HH:mm:ss"）；后端字段是 Time 类型，格式不对整条写请求会失败。',
    )
  }
}

/**
 * `status` 不属于这一页的参数契约。
 *
 * 与档案页把 `isArchived` 钉死、统计页把 `isArchived` 拒掉是同一类判断，但理由不同：
 * 那两页的 `isArchived` 是"这一页是哪一页"的分界；这里的 `status` 是**页面自己声明了、
 * 却没有任何控件绑定**的表单项（浏览器从不发它，取值语义也没有任何地方消费）。
 *
 * 两种"温和"的处理都不诚实：静默忽略 = 调用方以为筛过了；静默转发 = 在契约之外开一个
 * 来路不明的筛选条件（后端 `getWrapper` 确实会 `eq("status", …)`）。所以显式拒绝。
 */
export function assertNoStatusParam (query: unknown): void {
  if (query === null || typeof query !== 'object') return
  if (Object.prototype.hasOwnProperty.call(query, 'status')) {
    throw new Error(
      'status 不是「班次管理」的参数：页面声明了它却没有任何控件绑定，浏览器发出的请求里从来没有它，' +
        '取值语义在后端也没有任何地方消费。传它不会报错、只会让你以为筛过了。' +
        '要按名称筛请用 name（模糊匹配）。',
    )
  }
}

/** 把 id 归一成字符串：后端把 Long 序列化成字符串，浏览器回传的也是字符串（实测 `"id":"9"`） */
function normalizeId (id: string | number): string {
  const value = typeof id === 'number' ? String(id) : id.trim()
  if (value === '') {
    throw new Error('班次 id 不能为空')
  }
  return value
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: AttendanceShiftQuery): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const item of LIST_QUERY) {
    const value = provided[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 构造新建 / 修改的请求体。
 *
 * **逐字段复刻页面 `customSubmit` 发出的 body**，包括键的书写顺序 —— D20 要求与浏览器
 * 发出的请求逐字段一致，键顺序不同也算不一致。基准：`baseline/attendance-shift.browser.json`
 * 第 3 条（实测 `{"name":…,"morningStartTime":…,"morningEndTime":…,"afternoonStartTime":…,"afternoonEndTime":…}`）。
 *
 * 校验边界（有意为之）：只强制页面**无条件**要求的那些 —— 名称必填且 ≤20 字、四个时间
 * 都是 `HH:mm:ss`。页面上还有一条"下午结束要晚于下午开始"式的直觉约束，但**页面自己没写**，
 * 后端也不校验，SDK 不代为发明。
 */
export function buildShiftPayload (draft: AttendanceShiftDraft): Record<string, unknown> {
  if (typeof draft.name !== 'string' || draft.name.trim() === '') {
    throw new Error('班次名称必填')
  }
  if (draft.name.length > SHIFT_NAME_MAX_LENGTH) {
    throw new Error(`班次名称不超过 ${SHIFT_NAME_MAX_LENGTH} 字，收到的是 ${draft.name.length} 字`)
  }
  assertClockTime('上午开始考勤时间', draft.morningStartTime)
  assertClockTime('上午结束考勤时间', draft.morningEndTime)
  assertClockTime('下午开始考勤时间', draft.afternoonStartTime)
  assertClockTime('下午结束考勤时间', draft.afternoonEndTime)

  // 键顺序原样照抄浏览器抓下来的 body
  return {
    name: draft.name,
    morningStartTime: draft.morningStartTime,
    morningEndTime: draft.morningEndTime,
    afternoonStartTime: draft.afternoonStartTime,
    afternoonEndTime: draft.afternoonEndTime,
  }
}

export const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'name',
    kind: 'text',
    required: false,
    description:
      '班次名称，**模糊匹配**（后端是 like）。改名后核对时新名字不能包含原名，否则原名也查得到',
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const DRAFT_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: true, description: `班次名称，≤${SHIFT_NAME_MAX_LENGTH} 字` },
  { name: 'morningStartTime', kind: 'text', required: true, description: '上午开始考勤时间 HH:mm:ss' },
  { name: 'morningEndTime', kind: 'text', required: true, description: '上午结束考勤时间 HH:mm:ss' },
  { name: 'afternoonStartTime', kind: 'text', required: true, description: '下午开始考勤时间 HH:mm:ss' },
  { name: 'afternoonEndTime', kind: 'text', required: true, description: '下午结束考勤时间 HH:mm:ss' },
]

export const attendanceShiftCapabilities: CapabilityDefinition[] = [
  {
    id: 'attendance-shift-list',
    title: '查询班次列表',
    pagePath: ATTENDANCE_SHIFT_PAGE_PATH,
    permission: ATTENDANCE_SHIFT_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'attendance-shift-get',
    title: '查询单条班次详情',
    pagePath: ATTENDANCE_SHIFT_PAGE_PATH,
    permission: ATTENDANCE_SHIFT_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '班次 id，来自 attendance-shift-list。也会返回**已逻辑删除**的行（isDel=1），' +
          '判断"还在不在"要用 attendance-shift-list 而不是这里',
      },
    ],
  },
  {
    id: 'attendance-shift-create',
    title: '新建班次',
    pagePath: ATTENDANCE_SHIFT_PAGE_PATH,
    permission: ATTENDANCE_SHIFT_PERMISSION,
    write: true,
    params: DRAFT_PARAMS,
  },
  {
    id: 'attendance-shift-update',
    title: '修改班次（整单替换）',
    pagePath: ATTENDANCE_SHIFT_PAGE_PATH,
    permission: ATTENDANCE_SHIFT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '班次 id。**先调 attendance-shift-get 拿当前值**：这个接口是整单替换，' +
          '没传的字段会被清空（传上去的就是全部五个业务字段）',
      },
      ...DRAFT_PARAMS,
    ],
  },
  {
    id: 'attendance-shift-remove',
    title: '删除班次',
    pagePath: ATTENDANCE_SHIFT_PAGE_PATH,
    permission: ATTENDANCE_SHIFT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '班次 id。**逻辑删除**：删完列表查不到，但 attendance-shift-get 仍返回这一行（isDel=1）；' +
          '要确认删掉了请看列表。⚠️ 被考勤组占用的班次**删不掉**，后端会返回业务错误"该班次正在使用，无法删除!"',
      },
    ],
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文（module-type 走
 * `/dashboard/attendance/attendance-shift/list` 的推导结果 = 11 组织管理）。
 */
export function createAttendanceShiftCapability (request: PortalRequest) {
  return {
    /** 分页查询班次列表。只读 */
    list (query: AttendanceShiftQuery = {}): Promise<PageResult<AttendanceShiftRow>> {
      try {
        assertNoStatusParam(query)
      } catch (error) {
        // 参数错误一律走 Promise.reject，与 list 的其它校验、searchUsers 一致
        return Promise.reject(error)
      }
      return request<PageResult<AttendanceShiftRow>>({
        url: '/org/hrWorkShift/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /** 单条班次详情。整单替换之前先用它拿当前值。参数错误走 Promise.reject（`async` 保证） */
    async get (id: string | number): Promise<AttendanceShiftRow> {
      return request<AttendanceShiftRow>({
        url: `/org/hrWorkShift/${normalizeId(id)}`,
        method: 'get',
      })
    },

    /**
     * 新建班次（**写操作**）。
     *
     * 会真的建出一条班次。后端零幂等，重发一次就是两条 —— 所以门面上暴露的
     * `createIdempotent` 才是给 AI 用的那个（D12），这里保留无防重的原函数。
     *
     * ⚠️ 后端**不回传新 id**（`save` 返回的是空 Result，实测基准里也是），
     * 要知道建出来的是哪一条，只能回 `list({ name })` 按名字查。
     */
    async create (draft: AttendanceShiftDraft): Promise<unknown> {
      return request({
        url: '/org/hrWorkShift/save',
        method: 'post',
        data: buildShiftPayload(draft),
      })
    },

    /**
     * 修改班次（**写操作**）。
     *
     * **整单替换**：body 是 `buildShiftPayload(...)` 加上 `id`。调用方必须先 `get()`
     * 拿当前值 —— 本函数**不代为合并**：自动合并会把表单不认识的服务端字段
     * （`creator` / `createTime` / `updater` / `isDel` …）一并回写，那形状没被验证过。
     *
     * 与浏览器发出的 body 的差别（**如实记下**）：浏览器编辑页是 `{...form, ...bridge 行}`，
     * 所以它的 PUT **多带** `status` / `isDel` / `createTime` / `creator` / `updateTime` / `updater`
     * 六个服务端字段，且 `id` 排在五个业务字段之后（基准第 4 条）。这里只发「五个业务键 + id」，
     * 是那份 body 的**子集**。实测（`smoke/attendance-shift-crud.mjs`）：这样发之后
     * `get` 读回 `status` / `createTime` / `creator` 都没被动过 —— MyBatis-Plus 的
     * `updateById` 默认忽略 null 字段（推断，与实测一致）。
     */
    async update (draft: AttendanceShiftUpdateDraft): Promise<unknown> {
      return request({
        url: '/org/hrWorkShift',
        method: 'put',
        data: { ...buildShiftPayload(draft), id: normalizeId(draft.id) },
      })
    },

    /**
     * 删除班次（**写操作**）。
     *
     * 页面的行内「删除」有二次确认（"确认删除？"），接口本身是
     * renren 通用删除的 `${deleteURL}/${id}` —— `DELETE /org/hrWorkShift/{id}`，**没有请求体**
     * （与作业管理那条线不同：那边是 `DELETE` + body `["1071"]`）。
     *
     * ⚠️ **这是逻辑删除**（与作业管理一致）：删完 `list()` 查不到，但 `get(id)` 仍然返回那一行、
     * `isDel` 变成 1。要用独立证据确认删掉了，看列表，不要看 `get`。
     *
     * ⚠️ **可能失败**：被考勤组占用（`hr_attendance_group.shift_id` 指向它且 `is_del=0`）时
     * 后端返回业务错误「该班次正在使用，无法删除!」。SDK 不做预检查，如实透传这个失败。
     */
    async remove (id: string | number): Promise<unknown> {
      return request({
        url: `/org/hrWorkShift/${normalizeId(id)}`,
        method: 'delete',
      })
    },
  }
}

export type AttendanceShiftCapability = ReturnType<typeof createAttendanceShiftCapability>

/**
 * 门面上带防重的那一层。与会议室 / 作业管理同样的分工：`withIdempotency` 需要**身份**，
 * 那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），
 * 不放进能力模块。
 *
 * 这里只声明"多了一个 requestId"的形状。
 */
export type AttendanceShiftCapabilityWithIdempotency = AttendanceShiftCapability & {
  /**
   * 带短窗口防重的建班次（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: AttendanceShiftDraft & { requestId: string },
  ) => Promise<unknown>
}
