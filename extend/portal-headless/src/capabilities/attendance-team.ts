import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 排班管理 —— 考勤域的**第四个页面**，也是这个域里第一个**带"子资源"的页面**。
 *
 * 页面：`/dashboard/attendance/attendance-team/list`
 * 路由文件：`app/portal/views/dashboard/hr/attendance/attendance-team/list.vue`
 * 表单页：同目录的 `[mode]/[id].vue`（新建 / 编辑）
 * 弹窗：同目录的 `components/schedual.vue`（行内「排班管理」）
 *
 * ## 页面标题叫「排班管理」，但它管的是**考勤组**
 *
 * 菜单标题是「排班管理」（`app/portal/menus/hr.js:89`），路由目录却是 `attendance-team`，
 * 接口是 `hrAttendanceGroup`，页面上的列表列头写的是「考勤组名称」。四个名字指同一个东西。
 * SDK 的 capabilityId 用**页面路径**的 slug（`attendance-team-*`），与 `attendance-shift-*` 同规矩。
 *
 * ## 这一页有两层实体，不是一张表
 *
 * | 层 | 实体 | 接口 | 能力 |
 * | --- | --- | --- | --- |
 * | 外层 | 考勤组 | `/org/hrAttendanceGroup` | list / get / create / update / remove |
 * | 内层 | 考勤组的**排班**（把组织/岗位/职务/人挂到组上） | `/org/hrWorkSchedule` | schedule-get / schedule-save |
 *
 * 内层的入口是行内那个「排班管理」弹窗（`schedual.vue`），不是独立路由。
 * 两个接口的**资源关系是 `groupId`**：`schedule-save` 的载荷必须带上外层那条记录的 id。
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /org/hrAttendanceGroup/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /org/hrAttendanceGroup/{id}` | `[mode]/[id].vue` 的 `customLoad`（编辑页真的会调，见基准第 8 条） |
 * | 新建 | `POST /org/hrAttendanceGroup` | `[mode]/[id].vue` 的 `customSubmit`（`form.id` 为空） |
 * | 修改 | `PUT /org/hrAttendanceGroup`（整单替换） | 同上（`form.id` 有值）；URL 与新建**是同一个**，只有 method 不同 |
 * | 删除 | `DELETE /org/hrAttendanceGroup/{id}` | `list.vue` 的 `deleteURL` + renren 通用删除 |
 * | 读排班 | `GET /org/hrWorkSchedule/getWorkSchedule?groupId=` | `components/schedual.vue` 的 `init()` |
 * | 存排班 | `POST /org/hrWorkSchedule` | 同上 `onSubmit` |
 *
 * 逐字段基准：`baseline/attendance-team.browser.json`（读 3 条 + 写 4 条，全是实测）
 * 四件套记录：`docs/pages/排班管理.md`
 *
 * ## 没有 `prepare`
 *
 * 与作业管理 / 班次管理同款判断：这一页**没有任何"提交前先问后端一次"的接口**。
 * 会议室那条线的 `prepare` 是因为"这次要人工指定哪些审批人"会改变提交载荷；这里没有对应物。
 *
 * 真的有一个只读前置步骤，但它不叫 `prepare`：`update()` 打的是整单替换的 PUT，
 * 所以调用方**必须先 `get()` 拿当前值再改**。它是独立能力 `get`，**不在 `update` 内部代劳** ——
 * 见下面 `update` 的注释。
 *
 * ## 写链路里只有 `create` 需要防重
 *
 * `docs/conventions.md` 第 14 条：后端零幂等，AI 超时重发 = 重复单据。这个页面上三处写操作
 * 的代价**各不相同**：
 *
 * | 写能力 | 重发一次的后果 | 要不要 `requestId` |
 * | --- | --- | --- |
 * | `create` | **多一个考勤组**（后端零幂等） | **要**（门面上的 `createIdempotent`） |
 * | `update` | 同样的整单替换再写一次，终态相同 | 不要 |
 * | `remove` | 逻辑删除，重复删后端直接返回成功 | 不要 |
 * | `schedule-save` | 先 `is_del=1` 掉旧排班、再插一份新的，终态相同 | 不要（**实测**，见冒烟） |
 *
 * `create` 的幂等身份用 `requestId`，与作业管理 / 班次管理同一条线（`src/idempotency/`）。
 *
 * ## `remove` 是**逻辑删除**，而且**会被排班挡住**（实测 + 代码）
 *
 * 与班次管理同一个形状：删完 `list` 查不到，但 `get(id)` **仍然返回这一整行**（`isDel` 变 1）。
 * 所以"删干净了没有"**只能看列表**。
 *
 * 另一条更常撞上：后端 `HrAttendanceGroupServiceImpl.deleteAttendanceGroup` 先查
 * `hr_group_user_rel` 里有没有 `group_id` 指向它、且 `is_del=0` 的行，有就返回业务错误
 * 「该考勤组正在使用，无法删除!」。**排过班（且没清空）的组删不掉** ——
 * 正确顺序是 `schedule-save` 传空列表把排班清掉，再 `remove`。
 * SDK 不做预检查（预检查要另打一个接口，而且"现在没被用"不保证"删的时候还没被用"），如实透传失败。
 *
 * ## 不放进契约的两样东西
 *
 * 1. **`GET /org/organization/getUserByType`（「查看人员」弹窗拉人的那一个）**——
 *    它的响应里**带 `password` / `password2` / `salt` 三个字段**（实测，见
 *    `docs/pages/排班管理.md`）。把它做成能力等于让 AI 的上下文里出现密码散列。
 *    而且它在页面上的职责只是"把已选的人渲染成一行行"，**不参与任何写载荷**
 *    （写载荷的 `userIdList` 来自 `getWorkSchedule` 的 `staffCode`）。
 *    ⇒ 不暴露，理由与班次管理拒掉 `status` 同类：宁可少一个能力，也不放一个会带出凭据形状的读接口。
 *
 * 2. **`type` 的候选值**——页面上 `a-radio` 只有一个「标准工时」，值恒为 1。
 *    它**是**真参数（`option.typeOptions` 绑定在 `list.vue` 的 `form.type` 上，浏览器真的发它），
 *    与班次管理那个"声明了却没控件绑定"的 `status` **不是**一回事。
 */

export const ATTENDANCE_TEAM_PAGE_PATH = '/dashboard/attendance/attendance-team/list'

/** 该页的权限码（`generated/page-catalog.json` 的 `permission`，与菜单树同源） */
export const ATTENDANCE_TEAM_PERMISSION = '/dashboard/attendance/attendance-team'

/**
 * 该页的 module-type。
 *
 * `resolveModuleType(ATTENDANCE_TEAM_PAGE_PATH)` → 11 组织管理（`matchedBy: 'rule'`），
 * 与浏览器在**列表页**上实测发的一致（基准第 1、2 条都是 `module-type: 11`）。
 *
 * ⚠️ 基准里另外几条写请求抓到的 `module-type` 是 **12 / 15**，那是**并行标签页污染**，
 * 不是这一页的取值：这个头读的是 cookie `hr-0.0.0-menuPath`，而 cookie 是**同一个浏览器
 * profile 全局共享**的、不分标签页。抓完之后复核 cookie，里面躺的是
 * `/dashboard/base/management-center/list` —— 既不是本页、也不是本轮任何一次导航的目标，
 * 是同时开着的另一个标签页留下的。**不要把抓到的那一次当答案抄**，要拿规则表复核。
 * SDK 的能力全部绑在列表页路径上，`resolveModuleType` 确定性地给 11。
 */
export const ATTENDANCE_TEAM_MODULE_TYPE = 11

/**
 * 列表请求的固定参数表。
 *
 * 依据是浏览器真实发出的 URL（`baseline/attendance-team.browser.json`）：
 *
 * ```text
 * /admin-api/org/hrAttendanceGroup/page?order=&orderField=&pageNo=1&pageSize=20&_t=…
 * /admin-api/org/hrAttendanceGroup/page?order=&orderField=&name=%E8%80%83%E5%8B%A4&type=1&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * **顺序即 qs 序列化后的顺序**，所以下面这张表是"契约"，不是"默认值表"（D20 逐字段一致）。
 * `name` / `type` 的初值都是 `null`，被 qs 的 skipNulls 丢掉 —— 浏览器没填时也不发它们。
 * 少了 `order` / `orderField` 这两个空值就不与浏览器逐字段一致。
 *
 * ⚠️ 与班次管理**不同**：这里的 `type` 是**真参数**（页面上有 `common-select-dropdown`
 * 绑着它，浏览器实测会发 `type=1`）；那边声明了却没人绑、所以被 SDK 显式拒绝。
 */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: null },
  { name: 'type', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 考勤组名称的长度上限：页面表单规则 `max: 20`（`[mode]/[id].vue` 的 `rules.name`） */
export const GROUP_NAME_MAX_LENGTH = 20

/** 页面 `a-radio` 上唯一的那个选项。定义成常量而不是散在代码里，是为了让"只有一个值"这件事显式 */
export const STANDARD_WORKING_HOURS = 1

export type AttendanceTeamRow = {
  /** 后端把 Long 序列化成**字符串**（实测：PUT body 里是 `"id":"7"`，删除 URL 是 `/hrAttendanceGroup/7`） */
  id?: string | number
  /** 考勤组名称 */
  name?: string
  /** 考勤类型。页面上只有 1（标准工时） */
  type?: number
  /**
   * 状态。**列表列里不展示、表单里没有控件**，但它在**行数据里真实存在**（实测 `status=1`），
   * 而且浏览器的编辑态 PUT 会把它原样回写。SDK 不把它放进参数契约（没有控件能改它），
   * 但如实留在行类型里。
   */
  status?: number
  /** 逻辑删除标记。`remove` 之后 `get` 仍返回这一行，`isDel` 变成 1 */
  isDel?: number
  /** 班次 id（字符串化）。**列表页的 `dealShift` 会拿它再查一次班次表**，见文件头的坑 */
  shiftId?: string | number
  /** 班次名称。由后端 `dealShift` 拼出来的只读字段，不是数据库列 */
  shiftName?: string
  /** 班次明细。**只有 `get` 返回**（`getInfo` 里单独 set），列表返回的是 `null`（实测） */
  workShift?: Record<string, unknown> | null
  createTime?: string
  creator?: string | number
  updateTime?: string
  updater?: string | number
  [key: string]: unknown
}

export type AttendanceTeamQuery = {
  /**
   * 考勤组名称，**模糊匹配**（后端 `getWrapper` 用的是 `wrapper.like("name", name)`）。
   * ⚠️ 因为是 like，改名后的新名字如果**包含**原名，用原名仍然查得到 ——
   * 判断"改名成没成功"时新名字不能包含原名（这条坑在作业管理那条线上踩过）。
   */
  name?: string
  /** 考勤类型。页面上只有 1（标准工时）；不传则不过滤 */
  type?: number
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * 新建 / 修改的载荷：页面上真的能填的就这三个字段。
 *
 * `type` 的初值是 1（`form: { name: null, type: 1, shiftId: null }`），页面上只有一个选项，
 * 所以它**每次都会被发出去**。声明成可选是为了让调用方少写一个字，**不是**因为它是可选的。
 */
export type AttendanceTeamDraft = {
  /** 考勤组名称，必填，≤20 字（页面规则） */
  name: string
  /** 考勤类型，默认 1（标准工时）。页面上没有第二个选项 */
  type?: number
  /**
   * 班次 id，**必填**。页面 `customSubmit` 的第一句就是
   * `if (!form.shiftId) { message.error('请选择班次'); return Promise.reject() }` ——
   * 它**不是**靠表单规则挡的，是提交前手写的。所以 SDK 也在本地挡。
   * 来源：`attendance-shift-list`（班次管理页）。
   */
  shiftId: string | number
}

/** 修改用的载荷：多一个 `id`。**整单替换**，见 `update` 的注释 */
export type AttendanceTeamUpdateDraft = AttendanceTeamDraft & {
  /** 记录 id，来自 `list()` / `get()`。数字会被转成字符串（后端就是这么给的） */
  id: string | number
}

/** 排班的四种挂载对象。值与后端 `HrGroupUserRelEntity.type` 逐字对应 */
export const SCHEDULE_TYPES = {
  /** 组织 */
  organization: 1,
  /** 岗位 */
  post: 2,
  /** 职务 */
  duty: 3,
  /** 人员 */
  user: 4,
} as const

/**
 * 排班读取的返回。
 *
 * `hrGroupUserRelEntityList` 在**该组还没排过班**时是 `null`（不是 `[]`）——
 * 后端 `getInfo` 只在集合非空时才 `set`，实测过。调用方不要假设它是数组。
 */
export type AttendanceTeamSchedule = {
  groupId?: string | number
  /** 从考勤组上带过来的类型 */
  type?: number
  /**
   * 排班起始日，`YYYY-MM-DD`。
   * ⚠️ 它取的是**第一条排班记录的 `startDate`**（`getInfo` 里 `get(0).getStartDate()`），
   * 不是独立字段；一条都没有时是 `null`。
   */
  startDate?: string | null
  hrGroupUserRelEntityList?: AttendanceTeamScheduleMember[] | null
  [key: string]: unknown
}

export type AttendanceTeamScheduleMember = {
  id?: string | number
  groupId?: string | number
  /** 挂载对象的 id。type=1 是组织 id、2 是岗位 id、3 是职务 id、4 是 **sys_user id** */
  paramsId?: string | number
  type?: number
  /** 后端拼出来的显示名（组织名 / 岗位名 / 职务名 / 真实姓名）。**不是数据库列** */
  name?: string
  /** **只有 type=4 有**：用户的 `username`（工号）。写回时用的就是它，见 `saveSchedule` */
  staffCode?: string | null
  isDel?: number
  startDate?: string
  /** 后端固定写 `2099-12-31`（"长期有效"） */
  endDate?: string
  [key: string]: unknown
}

/**
 * 存排班的载荷。
 *
 * **`userIdList` 里装的是 `username`（工号），不是 `sys_user.id`** —— 这是这一页最容易搞错的地方，
 * 实测有三处互证：
 *
 * 1. 后端 `HrWorkScheduleServiceImpl.saveWorkSchedule` 对 user 那一支调的是
 *    `sysUserService.selectByUserName(userIdList)`（按 username 查）。
 * 2. 后端 `HrOrganizationServiceImpl.getUserByType` 里那句原话注释
 *    「前端传来的是staffCode 需要处理」，然后 `selectByUserName(staffCodeList)`。
 * 3. 前端 `schedual.vue` 的 `getInitData`：`id: item.type === 4 ? Number(item.staffCode) : Number(item.paramsId)`
 *    —— 对 type=4 取的是 `staffCode`；`staff.vue` 的 `onSubmit` 又把 `id` 设成 `item.username`。
 *
 * ⚠️ 所以从 `scheduleGet()` 读回来的 `paramsId`（sys_user id）**不能**直接塞进 `userIdList`，
 * 要用 `staffCode`。两者是不同的数（实测：徐曼曼 `paramsId=197916` / `staffCode=2026050801`）。
 */
export type AttendanceTeamScheduleDraft = {
  /** 考勤组 id。来自 `list()` / `get()` */
  groupId: string | number
  /** 排班起始日，`YYYY-MM-DD`（页面 `value-format="YYYY-MM-DD"`；后端是 `LocalDate`） */
  startDate: string
  /** 组织 id 列表，对应挂载对象的 type=1 */
  organizationIdList?: Array<string | number>
  /** 岗位 id 列表，type=2 */
  postIdList?: Array<string | number>
  /** 职务 id 列表，type=3 */
  dutyIdList?: Array<string | number>
  /** **工号（username）列表**，type=4。不是 sys_user id，见上 */
  userIdList?: Array<string | number>
}

/** `YYYY-MM-DD`，与页面 `a-date-picker` 的 `value-format` 逐字一致 */
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * 日期格式校验。
 *
 * 与 `assertClockTime` / `assertTimeSlot` / `assertYearMonth` 同一个来历：格式由**前端控件**
 * 决定（`value-format="YYYY-MM-DD"`）。后端 DTO 是 `java.time.LocalDate`，
 * 格式不对整条写请求 400，而错误信息是框架的解析异常、看不出是哪个控件 —— 所以挡在本地。
 *
 * 只校验**形状**，不校验"这天存不存在"：`2026-02-31` 有形状、`LocalDate` 会拒它，
 * 但那种错是调用方该看到的明确错误，本函数不替它判。
 */
export function assertIsoDate (label: string, value: unknown): void {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(
      `${label} 必须是 YYYY-MM-DD（例如 2026-09-01），收到的是 ${JSON.stringify(value)}。` +
        '格式来自页面的日期选择器（value-format="YYYY-MM-DD"）；后端字段是 LocalDate，格式不对整条写请求会失败。',
    )
  }
}

/** 把 id 归一成字符串：后端把 Long 序列化成字符串，浏览器回传的也是字符串（实测 `"id":"7"`） */
function normalizeId (value: string | number, label = '考勤组 id'): string {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (text === '') {
    throw new Error(`${label} 不能为空`)
  }
  return text
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: AttendanceTeamQuery): Record<string, unknown> {
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
 * **逐字段复刻页面 `customSubmit` 发出的 body**（它直接发整个 `form`），包括键的书写顺序 ——
 * 实测基准里是 `{"name":"SDK-TEST-组-030131","type":1,"shiftId":"6"}`。
 * `type` 恒定有值（表单初值 1），所以这里总是写出去。
 *
 * 校验边界（有意为之）：只强制页面**无条件**要求的那些 —— 名称必填且 ≤20 字、`shiftId` 必填。
 * 页面上没有别的约束，后端 DTO 里也**一个校验注解都没有**，SDK 不代为发明。
 */
export function buildGroupPayload (draft: AttendanceTeamDraft): Record<string, unknown> {
  if (typeof draft.name !== 'string' || draft.name.trim() === '') {
    throw new Error('考勤组名称必填')
  }
  if (draft.name.length > GROUP_NAME_MAX_LENGTH) {
    throw new Error(`考勤组名称不超过 ${GROUP_NAME_MAX_LENGTH} 字，收到的是 ${draft.name.length} 字`)
  }
  if (draft.shiftId === undefined || draft.shiftId === null || String(draft.shiftId).trim() === '') {
    throw new Error(
      '班次必填：页面的保存按钮在 shiftId 为空时会直接拦住并提示「请选择班次」' +
        '（[mode]/[id].vue 的 customSubmit 第一句），这个约束不在表单规则里、是手写的。' +
        '班次 id 用 attendance-shift-list 查。',
    )
  }

  // 键顺序原样照抄浏览器抓下来的 body；type 缺省补 1（那是表单初值，不是本函数发明的）
  return {
    name: draft.name,
    type: draft.type === undefined ? STANDARD_WORKING_HOURS : draft.type,
    shiftId: normalizeId(draft.shiftId, '班次 id'),
  }
}

/**
 * 构造存排班的请求体。
 *
 * **键顺序照抄浏览器**（实测基准第 7 条）：
 * `groupId, startDate, dutyIdList, organizationIdList, postIdList, userIdList`。
 * 这个顺序看着别扭（duty 排在 organization 前面），来源是 `schedual.vue` 里
 * `reactive({ groupId, startDate, dutyIdList, organizationIdList, postIdList, userIdList })`
 * 的书写顺序 —— 后面那次 `{...formState, 四个列表}` 的展开**不改变已有键的位置**。
 * 照抄而不是"整理成好看的顺序"，是因为 D20 要求与浏览器逐字段一致，键顺序也算。
 *
 * 四个列表**永远发出去**（空的就是 `[]`），不做 skipNulls —— 浏览器发的是 `[]`，
 * 而后端正是靠"四个都空"来判定"清空该组所有排班"这条分支。
 */
export function buildSchedulePayload (draft: AttendanceTeamScheduleDraft): Record<string, unknown> {
  if (draft.startDate === undefined || draft.startDate === null) {
    // 页面的 rules.startDate 是 required，空值连提交按钮都过不去
    throw new Error('排班日期必填（页面 rules.startDate 是 required）')
  }
  assertIsoDate('排班日期', draft.startDate)

  const list = (value: Array<string | number> | undefined): string[] =>
    (value ?? []).map((item) => normalizeId(item, '排班项 id'))

  return {
    groupId: normalizeId(draft.groupId),
    startDate: draft.startDate,
    dutyIdList: list(draft.dutyIdList),
    organizationIdList: list(draft.organizationIdList),
    postIdList: list(draft.postIdList),
    userIdList: list(draft.userIdList),
  }
}

const TYPE_PARAM: ParamSpec = {
  name: 'type',
  kind: 'enum',
  required: false,
  options: [{ label: '标准工时', value: STANDARD_WORKING_HOURS }],
  description:
    '考勤类型。页面上只有一个选项「标准工时」（=1），不传按 1 发 —— 那是表单初值（form.type = 1），' +
    '不是 SDK 发明的默认值',
}

const DRAFT_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: true, description: `考勤组名称，≤${GROUP_NAME_MAX_LENGTH} 字（页面规则）` },
  TYPE_PARAM,
  {
    name: 'shiftId',
    kind: 'search',
    required: true,
    description:
      '班次 id，必填。页面上是「选择班次」弹窗（列出所有班次点一行），' +
      '值为空时保存会被页面直接拦住。候选来自 attendance-shift-list（先要关键字，D6）',
    lookup: { capabilityId: 'attendance-shift-list', keywordParam: 'name' },
  },
]

const SCHEDULE_LIST_PARAMS: ParamSpec[] = [
  {
    name: 'organizationIdList',
    kind: 'tree',
    required: false,
    description: '组织 id 列表（挂到该组的组织，其下所有人员都算入组）。不传 = 空列表',
  },
  {
    name: 'postIdList',
    kind: 'search',
    required: false,
    description: '岗位 id 列表。不传 = 空列表',
  },
  {
    name: 'dutyIdList',
    kind: 'search',
    required: false,
    description: '职务 id 列表。不传 = 空列表',
  },
  {
    name: 'userIdList',
    kind: 'search',
    required: false,
    description:
      '**工号（username）列表**，不是 sys_user id —— 从 attendance-team-schedule-get 读回来的是 ' +
      'paramsId（sys_user id），要改用同一行的 staffCode。不传 = 空列表',
  },
]

export const attendanceTeamCapabilities: CapabilityDefinition[] = [
  {
    id: 'attendance-team-list',
    title: '查询考勤组列表',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: false,
    params: [
      {
        name: 'name',
        kind: 'text',
        required: false,
        description:
          '考勤组名称，**模糊匹配**（后端是 like）。改名后核对时新名字不能包含原名，否则原名也查得到',
      },
      TYPE_PARAM,
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
    ],
  },
  {
    id: 'attendance-team-get',
    title: '查询单个考勤组详情',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '考勤组 id，来自 attendance-team-list。比列表多返回 `workShift`（班次明细）。' +
          '也会返回**已逻辑删除**的行（isDel=1），判断"还在不在"要用 attendance-team-list',
      },
    ],
  },
  {
    id: 'attendance-team-create',
    title: '新建考勤组',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: true,
    params: DRAFT_PARAMS,
  },
  {
    id: 'attendance-team-update',
    title: '修改考勤组（整单替换）',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '考勤组 id。**先调 attendance-team-get 拿当前值**：这个接口是整单替换，' +
          '没传的字段会被写空（连 name 都会被清掉）',
      },
      ...DRAFT_PARAMS,
    ],
  },
  {
    id: 'attendance-team-remove',
    title: '删除考勤组',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '考勤组 id。**逻辑删除**：删完列表查不到，但 attendance-team-get 仍返回这一行（isDel=1）；' +
          '要确认删掉了请看列表。⚠️ **排过班的组删不掉**：后端会返回业务错误「该考勤组正在使用，无法删除!」，' +
          '要先用 attendance-team-schedule-save 传空列表把排班清掉',
      },
    ],
  },
  {
    id: 'attendance-team-schedule-get',
    title: '查询考勤组的排班',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: false,
    params: [
      {
        name: 'groupId',
        kind: 'number',
        required: true,
        description:
          '考勤组 id，来自 attendance-team-list。还没排过班的组返回的 ' +
          '`hrGroupUserRelEntityList` 是 **null**（不是空数组），`startDate` 也是 null',
      },
    ],
  },
  {
    id: 'attendance-team-schedule-save',
    title: '保存考勤组的排班',
    pagePath: ATTENDANCE_TEAM_PAGE_PATH,
    permission: ATTENDANCE_TEAM_PERMISSION,
    write: true,
    params: [
      {
        name: 'groupId',
        kind: 'number',
        required: true,
        description: '考勤组 id。**整组覆盖**：没传的那几类会被清空，不是增量追加',
      },
      {
        name: 'startDate',
        kind: 'date',
        required: true,
        description:
          '排班起始日 YYYY-MM-DD（页面 value-format）。后端固定把结束日写成 2099-12-31（"长期有效"）',
      },
      ...SCHEDULE_LIST_PARAMS,
    ],
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文（module-type 走
 * `/dashboard/attendance/attendance-team/list` 的推导结果 = 11 组织管理）。
 */
export function createAttendanceTeamCapability (request: PortalRequest) {
  return {
    /** 分页查询考勤组列表。只读 */
    list (query: AttendanceTeamQuery = {}): Promise<PageResult<AttendanceTeamRow>> {
      return request<PageResult<AttendanceTeamRow>>({
        url: '/org/hrAttendanceGroup/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /** 单个考勤组详情。整单替换之前先用它拿当前值。参数错误走 Promise.reject（`async` 保证） */
    async get (id: string | number): Promise<AttendanceTeamRow> {
      return request<AttendanceTeamRow>({
        url: `/org/hrAttendanceGroup/${normalizeId(id)}`,
        method: 'get',
      })
    },

    /**
     * 新建考勤组（**写操作**）。
     *
     * 会真的建出一个考勤组。后端零幂等，重发一次就是两个 —— 所以门面上暴露的
     * `createIdempotent` 才是给 AI 用的那个（D12），这里保留无防重的原函数。
     *
     * ⚠️ 后端**不回传新 id**（`save` 返回空 `Result`），要知道建出来的是哪一条，
     * 只能回 `list({ name })` 按名字查（冒烟就是这么做的）。
     */
    async create (draft: AttendanceTeamDraft): Promise<unknown> {
      return request({
        url: '/org/hrAttendanceGroup',
        method: 'post',
        data: buildGroupPayload(draft),
      })
    },

    /**
     * 修改考勤组（**写操作**）。
     *
     * **整单替换**：body 是 `buildGroupPayload(...)` 加上 `id`。调用方必须先 `get()`
     * 拿当前值 —— 本函数**不代为合并**：自动合并会把表单不认识的服务端字段
     * （`creator` / `createTime` / `updater` / `isDel` / `workShift` …）一并回写，
     * 那形状没被验证过（与班次管理同款判断）。
     *
     * 与浏览器发出的 body 的差别（**如实记下**）：浏览器的编辑页是 `customLoad` 把
     * **整个服务端记录**灌进 form（`{...result, shiftId}`），所以它的 PUT 多带
     * `status` / `isDel` / `creator` / `createTime` / `updater` / `updateTime` /
     * `shiftName` / `workShift` / `sheetUserRelDTOS` 九个字段，其中 `workShift` 还是**嵌套对象**。
     * 这里只发「三个业务键 + id」，是那份 body 的**子集**（基准第 4 条）。
     * 冒烟实测：这样发之后 `get` 读回 `createTime` / `creator` / `updateTime` /
     * `status` / `isDel` 都没被动过，`shiftName` 仍能拼出来 —— 与 MyBatis-Plus 的
     * `updateById` 忽略 null 字段一致（代码是推断，结论是实测）。
     */
    async update (draft: AttendanceTeamUpdateDraft): Promise<unknown> {
      return request({
        url: '/org/hrAttendanceGroup',
        method: 'put',
        data: { ...buildGroupPayload(draft), id: normalizeId(draft.id) },
      })
    },

    /**
     * 删除考勤组（**写操作**）。
     *
     * 页面的行内「删除」有二次确认（"确认删除？"），接口本身是 renren 通用删除的
     * `${deleteURL}/${id}` —— `DELETE /org/hrAttendanceGroup/{id}`，**没有请求体**。
     *
     * ⚠️ **这是逻辑删除**（与班次管理一致）：删完 `list()` 查不到，但 `get(id)` 仍然返回那一行、
     * `isDel` 变成 1。要用独立证据确认删掉了，看列表，不要看 `get`。
     *
     * ⚠️ **可能失败**：组里还有排班（`hr_group_user_rel` 里 `group_id` 指向它且 `is_del=0`）时
     * 后端返回业务错误「该考勤组正在使用，无法删除!」。SDK 不做预检查，如实透传。
     */
    async remove (id: string | number): Promise<unknown> {
      return request({
        url: `/org/hrAttendanceGroup/${normalizeId(id)}`,
        method: 'delete',
      })
    },

    /**
     * 读某个考勤组的排班。只读。
     *
     * 是「排班管理」弹窗打开时打的那一个（`schedual.vue` 的 `init()`），参数只有 `groupId`。
     */
    async scheduleGet (groupId: string | number): Promise<AttendanceTeamSchedule> {
      return request<AttendanceTeamSchedule>({
        url: '/org/hrWorkSchedule/getWorkSchedule',
        method: 'get',
        params: { groupId: normalizeId(groupId) },
      })
    },

    /**
     * 保存某个考勤组的排班（**写操作**）。
     *
     * **整组覆盖，不是增量**：后端 `saveWorkSchedule` 先把该组所有 `hr_work_schedule` 与
     * `hr_group_user_rel` 置 `is_del=1`，再按传入的四类重插一遍。想"加一个人"必须把**现有的全部**
     * 一起传回去 —— 只想追加就先用 `scheduleGet()` 读出当前值（注意 `userIdList` 要用
     * `staffCode` 而不是 `paramsId`，见 `AttendanceTeamScheduleDraft` 的注释）。
     *
     * ⚠️ **四个列表全传空 = 清空该组的所有排班**（后端有专门一条分支，连 `startDate` 都不落库）。
     * 这是清空的**唯一**正确做法，也是删组之前必须先做的一步。
     *
     * ⚠️ **不是幂等的形状，但重发安全**：重复发同一份载荷会先删旧的再插新的，终态相同
     * （冒烟里实测过）。所以不需要 `requestId`。
     *
     * ⚠️ **可能失败**：如果选中的对象解析出的用户里，有人已经在**别的**考勤组里
     * （`hr_group_user_rel` 有 `is_del=0` 且 `group_id` 不同），后端抛
     * 「所选人员在别的考勤组存在,请重新选择」。SDK 如实透传。
     */
    async scheduleSave (draft: AttendanceTeamScheduleDraft): Promise<unknown> {
      return request({
        url: '/org/hrWorkSchedule',
        method: 'post',
        data: buildSchedulePayload(draft),
      })
    },
  }
}

export type AttendanceTeamCapability = ReturnType<typeof createAttendanceTeamCapability>

/**
 * 门面上带防重的那一层。与会议室 / 作业管理 / 班次管理同样的分工：`withIdempotency` 需要**身份**，
 * 那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），不放进能力模块。
 *
 * 这里只声明"多了一个 requestId"的形状。
 */
export type AttendanceTeamCapabilityWithIdempotency = AttendanceTeamCapability & {
  /**
   * 带短窗口防重的建考勤组（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: AttendanceTeamDraft & { requestId: string },
  ) => Promise<unknown>
}
