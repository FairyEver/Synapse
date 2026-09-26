import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
// ⚠️ **只能 import type**，不能 import 任何**值**。理由不是风格，是会当场炸：
// `smoke/leave-application.mjs` 直接从 `src/` 读这个文件（Node 22 的类型剥离，
// 不用先 `pnpm build`），而 Node 的类型剥离**不会把 `./x.js` 改写成 `./x.ts`**
// ——实测 `ERR_MODULE_NOT_FOUND: .../general-approval.js`。类型导入会被擦掉，
// 所以没事；值导入会真的去文件系统找一个不存在的 .js。
// 代价是 `assertAssigneesForTasks` 在这里有一份复刻（见下），
// `test/leave-application.test.ts` 里有一条**两份实现逐例对照**的测试钉住它们不漂移。
import type {
  ProcessInstanceRow,
  StartUserSelectAssignees,
  StartUserSelectTask,
} from './general-approval.js'

/**
 * 请假申请（`qingjia`）—— 流程表单这一类里**控件最复杂**的那一条。
 *
 * 页面：`/simple/hr/form/005`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=qingjia&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/005
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）——与通用审批同一条路。
 *
 * 模板是 `src/capabilities/general-approval.ts`（同族形态：definition / prepare /
 * submit / detail / my-instances / cancel + 写链路防重）。**能复用的一律 import，
 * 不抄第二份**：`assertAssigneesForTasks` 与 `StartUserSelectTask` 这几个类型就是
 * 从那边直接引过来的。不要去改那个文件。
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：接口里没有，只在前端源码 + 真实页面里
 * ---------------------------------------------------------------------------
 *
 * 与通用审批一样，两条路都拿不到字段【实测，2026-09-20 测试环境】：
 *
 * - `GET /bpm/process-definition/get?key=qingjia` → `formFields: null`、
 *   `formCustomCreatePath: null`（`startUserSelectTasks` 这次倒是给了，是 `[]`）
 * - `GET /bpm/process-definition/create-list?...` → **只有它**给出
 *   `formCustomCreatePath: "simple/hr/form/005"`
 *
 * ⇒ 字段只能读 `app/portal/views/simple/hr/form/005/index.vue` 的模板与
 * `formRules`、同目录的 `utils.js`（`startIsAfterEnd` / `calculateDays`）与
 * `components/picker-group.vue`（复合日期控件）。逐条见 `docs/pages/请假申请.md`。
 *
 * ---------------------------------------------------------------------------
 * 二、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面控件 | 字段 | 形态 | 本地校验 | SDK 参数 |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | 申请人信息（只读块） | `userId`/`userName`/`staffCode`/`fullPath` | 文本块 | —— | **不接受调用方给**，从 `profile()` 取（见 §三） |
 * | 2 | 请假类型 | `type` | 下拉（字典 `absent_type`） | required | `type` |
 * | 3 | 请假事由 | `reason` | `a-textarea` | required，≤200 | `reason` |
 * | 4 | 开始时间 | `startDate` + `startType` | **复合控件**：日期 + 上午/下午 | required；与结束时间有先后合法性 | `startDate` + `startType` |
 * | 5 | 结束时间 | `endDate` + `endType` | 同上 | required | `endDate` + `endType` |
 * | 6 | 附件 | `attachments` | 拖拽上传，≤10 | **类型相关必填**（3/4/7/8/9）；扩展名白名单 | `attachments` |
 * | 7 | 剩余年假（只读联动） | `annualLeaveBalance` | 展示块，`type === 13` 时出现 | **拦住提交** | `yearRest()` + `submit` 里的前置校验 |
 * | 8 | 请假时长（只读联动） | `leaveDuration`/`actualLeaveDuration` | 展示块 | 自动算 | `duration()`；`restDay` 由它来 |
 * | 9 | 查看审批流程 | —— | 只读预览按钮 | —— | **不做**（见「尚未覆盖」） |
 *
 * **九类控件全部表达到了**（其中 7/8 两类是从接口来的只读联动，不是输入框）。
 * 这一条是刻意的：CLAUDE.md 的「完整」指的是「页面上用户能操作到的功能都要实现」。
 *
 * ---------------------------------------------------------------------------
 * 三、`userId` 这四个字段**不给调用方填**（与页面一致，也更安全）
 * ---------------------------------------------------------------------------
 *
 * 页面里这四个值是 `userStore.state` 直接抄下来的，用户**改不了**：
 *
 * ```js
 * userId:   userStore.state.id                 // "18243"（**字符串**）
 * userName: userStore.state.realName           // "姚淼鑫"
 * staffCode:userStore.state.username           // "2021070101"
 * fullPath: userStore.state.organizationName   // "设计中心1236"   ← 注意不是全路径！
 * ```
 *
 * 它们来自 `baseData: [user-basic]` → `GET /sys/user/info`（`base-data.js:58`）。
 * SDK 走同一个接口（`profile()`），**不接受调用方传**，理由有两条：
 *
 * 1. **忠实**：页面上的这四格是只读的，调用方本来就没有入口去改。
 * 2. **安全**：后端 `createAttendanceUserRel` 拿 `createReqVO.getUserId()` 决定
 *    **给谁生成请假记录**，而流程发起人取的是 `getLoginUserId()`（两者不是一个来源，
 *    见 `AttendanceUserRelServiceImpl:295`）。要是允许随便传 `userId`，这个能力就变成
 *    「以我的身份替别人请假」——页面上做不到，SDK 也不该做。
 *
 * ⚠️ **`fullPath` 取的是 `organizationName`（"设计中心1236"），不是
 * `organizationFullPathName`（"沃德辰龙-…-设计中心1236"）。** 后者只用在一个地方：
 * 「查看审批流程」预览的 `creatorOrgFullPath`。
 * 这是 `docs/process-forms.md` §5.3 第 2 条说的那种坑（载荷不是表单字段直传），
 * 也是本流程最容易搞错的一处。
 *
 * ⚠️ `/sys/user/info` 的响应里**带 `password2`（bcrypt 口令散列）与 `salt`**。
 * `profile()` **只投影表单要的四项**，**绝不整份透传**——这是本能力唯一一处
 * 刻意"不原样返回后端响应"的地方。
 *
 * ---------------------------------------------------------------------------
 * 四、复合日期控件：`startDate` + `startType` 必须成对，且有先后合法性
 * ---------------------------------------------------------------------------
 *
 * 页面上「开始时间」是**一个**控件（`components/picker-group.vue`：按钮 → 弹窗 →
 * `a-date-picker` + 「时间段」下拉），但它产**两个**字段：
 *
 * - `startDate`：`YYYY-MM-DD` 字符串（`antDateSave` 里 `dayjs(...).format('YYYY-MM-DD')`）
 * - `startType`：`1 = 上午`、`2 = 下午`（`leaveTimeTypeList`，硬编码在页面里）
 *
 * 结束时间同理。**两个字段各自必填**（`formRules.startDate` / `endDate`），
 * 且有一处**跨字段**校验——`utils.js` 的 `startIsAfterEnd()`：
 *
 * ```js
 * start.isAfter(end) || (start.isSame(end) && startType === 2 && endType === 1)
 * ```
 *
 * 白话：开始日期晚于结束日期 → 非法；**同一天**里「下午 → 上午」也非法。
 * `actionSubmit()` 在 `formRef.validate()` 之后立刻调它，不合法就
 * `message.error('结束时间不能早于开始时间')` 并**直接 return，不发任何请求**。
 * SDK 的 `assertPeriodOrder()` 逐字复刻这条，且**在发请求之前**跑。
 *
 * ---------------------------------------------------------------------------
 * 五、`restDay`：**提交前必须先读一次**（写链路里的"读 → 写"依赖）
 * ---------------------------------------------------------------------------
 *
 * `buildSubmitPayload()` 是 `{ ...formState, restDay: actualLeaveDuration }`，
 * 而 `actualLeaveDuration` **不是用户填的**——它来自
 * `POST /hr/attendance-user-rel/getRestDuration`
 * （页面在「四个日期字段都齐了」时 watch 触发，`index.vue:298-324`）。
 *
 * ```jsonc
 * // 请求（键顺序就是页面上那个 form 对象的顺序，抓包实测）
 * {"startDate":"2026-09-21","startType":1,"endDate":"2026-09-21","endType":2}
 * // 响应
 * {"code":0,"ret":"SUCCESS","data":1}
 * ```
 *
 * ⇒ **`submit()` 会先打一次 `getRestDuration`**，把它的返回值当 `restDay` 发出去。
 * 调用方不用（也不能）自己给这个数：它进的是**流程变量**，直接决定走 BPMN 的哪条分支。
 * 详见 §六。
 *
 * ⚠️ 页面上的 `leaveDuration`（本地算的）与 `actualLeaveDuration`（接口给的）
 * **不是一回事**：本地那个用 `utils.js` 的 `calculateDays()`，**不扣法定节假日**；
 * 接口那个扣（后端 `calculateLeaveDays()` 跳过 `sys_holiday` 里 `is_holiday = 1` 的日子）。
 * 但 **`restDay` 用的是接口那个**——`buildSubmitPayload()` 里写的是
 * `actualLeaveDuration.value`，不是 `getActualLeaveDuration()`。
 * `calculateLeaveDays()` 在本文件里导出了，但**只用于对照/展示，不进载荷**。
 * 实测：2026-09-21 上午 → 2026-09-25 下午，本地算 5、接口给 4（9/25 是中秋节）。
 *
 * ---------------------------------------------------------------------------
 * 六、审批人：**不用人工选**，但"谁收到待办"是固定的三个人
 * ---------------------------------------------------------------------------
 *
 * `POST /hr/attendance-user-rel/getRequiredStartUserSelectTasks` 实测返回
 * **`data: []`**（空数组，2026-09-20 测试环境）——与通用审批那条线**正好相反**。
 * 原因在 BPMN 里：`qingjia` 的 4 个 `userTask` 的
 * `flowable:candidateStrategy` 全是 **`30` = `USER`（指定用户）**
 * （`BpmTaskCandidateStrategyEnum`），即审批人是**写死的用户 id**，不留给发起人选：
 *
 * ```text
 * 开始 → 排他网关 ─┬─ 请假审批(用户 15012「乔娜」) ─┬─(restDay >= 3)→ 领导审核(用户 15170「刘爱巧」) ─┐
 *                  │                              └─(restDay <  3)───────────────────────────────┴→ HR(用户 17063「王威」) → 结束
 *                  └─ 直属上级(用户 15012「乔娜」) → 结束
 * ```
 *
 * 网关条件（BPMN 原文）：
 *
 * | 分支 | 条件 |
 * | --- | --- |
 * | 走「请假审批」还是「直属上级」 | `${creatorOrgFullPath.contains('博创')}` |
 * | 请假审批之后走不走「领导审核」 | `${restDay >= 3 }` |
 *
 * `creatorOrgFullPath` 由**后端**从发起人的部门派生
 * （`AttendanceUserRelProcessInstanceVariableBuilder`），**不是请求体里的字段**——
 * 所以这个分支调用方改不了，SDK 也不该假装能改。
 *
 * ⇒ 因为 `getRequiredStartUserSelectTasks` 返回空，`startUserSelectAssignees` 恒为
 * `{}`。但**接口还是要打**：`prepare()` 存在的意义就是"让后端告诉我们这次要不要人工选人"，
 * 换一个流程（或流程改版）答案就可能不是空的。
 *
 * ---------------------------------------------------------------------------
 * 七、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/005`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里**一条都匹配不到**
 * （那张表全是 `/dashboard/<域>/…` 前缀，没有 `/dashboard/flow/`），
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。
 * 浏览器在表单页上同样不发【实测，2026-09-20 抓包：qingjia 表单页的
 * `process-definition/get` / `getRestDuration` 请求头里都没有 `module-type`】。
 *
 * ---------------------------------------------------------------------------
 * 八、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **「查看审批流程」预览**（`portal-hxr-flow-process-preview`，打
 *   `/bpm/process-instance/preview`）没做。它是**只读的展示件**，不影响能不能提交。
 *   ⚠️ 但它有一个值得记住的性质：为了算出"每个节点会落到谁头上"，它自己
 *   `GET /system/user/simple-page?pageNo=1..9&pageSize=500` **无关键字拉了 4500 人**
 *   【实测，2026-09-20 抓包】。这正是设计 D6 / H35 说的那种长选项拉取——
 *   **本 SDK 一个人员搜索参数都没暴露**，所以也不存在照抄它的机会。
 * - **`/hr/attendance-user-rel/page`（请假记录分页）与 `/export-excel` 没做**：
 *   页面**没有任何地方调它们**（全仓库 grep 只有 `form/005` 那几处调用点），
 *   它们挂在后台管理侧。做它们等于凭空多一个页面外的入口。要"查请假记录"，
 *   本能力给的是 `detail(id)` 与 `myInstances()` 两条**页面上真的走了**的路。
 * - **`PUT /update` 与 `DELETE /delete` 没做**：页面上的编辑入口根本不存在
 *   （`actionGetDetail()` 只读；`isEditMode` 分支在 `form/005` 里压根没写），
 *   所以这两个接口在页面上走不到。实现一个页面上不存在、又验证不了的写操作，
 *   不叫"完整"，叫"多做了没验过的东西"。
 * - **`absences` 之外的请假类型字典没做成枚举常量**：`type` 的候选来自
 *   字典 `absent_type`，本文件把实测的 15 个值写进了参数 `options`，
 *   同时给了 `types()` 现读一次字典的入口。**字典是可运维改的**，两者不一致时
 *   以 `types()` 为准（页面也是每次挂载现读）。
 * - **附件 50MB 上限本地拦不了**：页面 `beforeFileUpload` 拦，SDK 手上只有
 *   `{url, name}`、算不出字节数。如实留给后端。
 * - **`isZhdjApp`（智慧蛋鸡 App 内的上传分支）没做**：那是另一个宿主环境
 *   （`window.FlutterXxx`），无头 SDK 没有这个上下文。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与会议室 / 通用审批同一个壳） */
export const LEAVE_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**，所以 prepare / submit / detail
 * 声明在这个页面上下文里。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测】返回 `simple/hr/form/005`。
 */
export const LEAVE_APPLICATION_FORM_PATH = '/simple/hr/form/005'

/** 「我的流程」页。**取消流程的入口在这里**，不在表单页。 */
export const LEAVE_APPLICATION_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自表单入口 URL、`create-list`、以及后端 `AttendanceUserRelProcessInstanceVariableBuilder.PROCESS_DEFINITION_KEY` */
export const LEAVE_APPLICATION_PROCESS_KEY = 'qingjia'

/** 「我的流程」列表里认出本流程的那一行：`processDefinitionKey` */
export const LEAVE_APPLICATION_PROCESS_TYPE = 1

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 form/005 的表单规则、模板属性与后端 VO）
// ---------------------------------------------------------------------------

/** `formRules.reason` 的 `max: 200` 与提示文案「最多输入200个字」（后端 VO 无 @Size，纯前端） */
export const REASON_MAX = 200

/** `common-upload-dragger` 的 `:maxCount="10"`；页面到 10 就禁用 */
export const ATTACHMENT_MAX_COUNT = 10

/** `beforeFileUpload` 的 50MB 上限（**本地无法校验**：SDK 手上只有 url 与 name） */
export const ATTACHMENT_MAX_SIZE_MB = 50

/**
 * 附件扩展名白名单，逐条抄自 `form/005` 模板里 `common-upload-dragger` 的 `accept`
 * 与 `useAppUpload` 的 `accept`（两处一致）：`.pdf, .jpg, .jpeg, .png`。
 *
 * ⚠️ **比通用审批那条线窄**（那边还有 doc/xls/csv/ppt 等）。谁也不要抄谁——
 * 这是每个表单自己的 `accept`。
 */
export const ATTACHMENT_ACCEPT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const

/** 上午 */
export const PERIOD_AM = 1
/** 下午 */
export const PERIOD_PM = 2

/** 「时间段」下拉的两个选项（`leaveTimeTypeList`，硬编码在页面里而不是字典） */
export const LEAVE_PERIOD_OPTIONS = [
  { label: '上午', value: PERIOD_AM },
  { label: '下午', value: PERIOD_PM },
] as const

/**
 * **附件必填**的请假类型：`index.vue:230` 的 `const checkType = [3, 4, 7, 8, 9]`。
 *
 * ```js
 * attachments: checkType.includes(formState.value.type)
 *   ? [{ required: true, message: '请上传附件', trigger: 'change' }] : []
 * ```
 *
 * 即：事假(3) / 病假(4) / 婚假(7) / 丧假(8) / 产假(9) 必须带附件，其余类型不强制。
 * 这是**前端的规则**（后端 VO 对 `attachments` 没有任何约束），但它是页面上真实
 * 拦人的那一条，所以 SDK 一样拦——写操作会惊动真人，能让它在发出请求前红就红在前面。
 */
export const ATTACHMENT_REQUIRED_TYPES = [3, 4, 7, 8, 9] as const

/** 年休假。选它时页面去查年假余额，余额 ≤ 0 或时长 > 余额都**拦住提交** */
export const ANNUAL_LEAVE_TYPE = 13

/** 婚假。页面上它有一个特殊分支：`getActualLeaveDuration()` 对它返回**本地**天数 */
export const MARRIAGE_LEAVE_TYPE = 7

/**
 * `absent_type` 字典的实测取值【实测，2026-09-20：
 * `GET /system/dict-data/grouped-list` → `dictType === 'absent_type'`】。
 *
 * **顺序照抄页面上那个下拉的渲染顺序**（字典数据的 id 顺序，不是数字顺序）：
 * 1, 10, 11, 12, 13, 14, 2, 3, 4, 5, 6, 7, 8, 9, 15。
 *
 * ⚠️ 字典是可运维改的。这里写死只是为了让 AI 不查字典也知道有哪些值；
 * 要"现在这一刻的候选"请调 `types()`。
 */
export const LEAVE_TYPE_OPTIONS = [
  { label: '正常', value: 1 },
  { label: '公差', value: 10 },
  { label: '迟到', value: 11 },
  { label: '早退', value: 12 },
  { label: '年休假', value: 13 },
  { label: '产检假', value: 14 },
  { label: '工伤', value: 2 },
  { label: '事假', value: 3 },
  { label: '病假', value: 4 },
  { label: '旷工', value: 5 },
  { label: '探亲假', value: 6 },
  { label: '婚假', value: 7 },
  { label: '丧假', value: 8 },
  { label: '产假', value: 9 },
  { label: '离岗', value: 15 },
] as const

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 一条请假记录里的附件。**形状就是页面 `formState.attachments` 的元素**：只有 url 与 name */
export type LeaveAttachment = {
  url: string
  name: string
  [key: string]: unknown
}

/**
 * 发起人信息。**这四个值不接受调用方传**，由 `profile()` 从 `GET /sys/user/info` 取。
 *
 * ⚠️ 字段名与来源的对应关系是本流程最容易搞错的一处：
 *
 * | 载荷字段 | 来源字段 | 实测值 |
 * | --- | --- | --- |
 * | `userId` | `id`（**字符串**） | `"18243"` |
 * | `userName` | `realName` | `"姚淼鑫"` |
 * | `staffCode` | `username` | `"2021070101"` |
 * | `fullPath` | **`organizationName`**（不是 `organizationFullPathName`） | `"设计中心1236"` |
 */
export type LeaveProfile = {
  /** `id`。`/sys/user/info` 把它序列化成**字符串**，SDK 原样保留（页面也原样发） */
  id: string
  /** `realName` → 载荷的 `userName` */
  userName: string
  /** `username` → 载荷的 `staffCode` */
  staffCode: string
  /** `organizationName` → 载荷的 `fullPath`（**不是** `organizationFullPathName`） */
  fullPath: string
}

/**
 * 提交 / prepare 的载荷（调用方给的那部分）。
 *
 * **没有 `id` 字段**——`buildSubmitPayload()` 里一个 `id` 都不拼（编辑分支不存在）。
 */
export type LeaveDraft = {
  /** 请假类型，必填。取值见 `LEAVE_TYPE_OPTIONS` / `types()` */
  type: number
  /** 请假事由，必填，≤200 字 */
  reason: string
  /** 开始日期，`YYYY-MM-DD`，必填 */
  startDate: string
  /** 开始时间段，`1 = 上午` / `2 = 下午`，必填（与 `startDate` 是**同一个控件**的两个产物） */
  startType: number
  /** 结束日期，`YYYY-MM-DD`，必填 */
  endDate: string
  /** 结束时间段，`1 = 上午` / `2 = 下午`，必填 */
  endType: number
  /**
   * 附件，可选（但 `type` ∈ `ATTACHMENT_REQUIRED_TYPES` 时**必填**）。
   * url 要用 `base-upload-file` 先传（目录 `HR/approval`）。
   * 本表单的 `accept` 只有 `.pdf .jpg .jpeg .png`。
   */
  attachments?: LeaveAttachment[]
}

/** `GET /hr/attendance-user-rel/getYearRest` 的响应 */
export type UserYearRest = {
  /** 当年应享年假天数（按司龄算，后端 `calculateAnnualLeaveDays`） */
  rest?: number
  /** 剩余年假天数（`rest - 已用`）。**可以是负数或半数** */
  unRest?: number
  [key: string]: unknown
}

/** 请假类型字典的一项 */
export type LeaveTypeOption = { label: string; value: number }

/**
 * `GET /hr/attendance-user-rel/get` 的响应（后端直接回 `AttendanceUserRelSaveReqVO`）。
 *
 * ⚠️ 两个实测出来的坑：
 *
 * 1. **`id` 恒为 `null`**：`getAttendanceUserRel()` 从头到尾没有 `setId(...)`
 *    （它只 set userId / userName / staffCode / fullPath / reason / type /
 *    attachments / startDate / endDate / startType / endType / typeName）。
 *    所以**别指望从详情里读回单据 id**——id 是 `submit` 的返回值。
 * 2. **`restDay` 不在响应里**：`RestDay` 只进不出（VO 有字段，service 没 set）。
 */
export type LeaveRecord = {
  /** ⚠️ 后端没填，恒为 `null`。见上 */
  id?: number | null
  userId?: string | number
  userName?: string
  staffCode?: string
  /** 提交时的 `organizationName`，不是全路径 */
  fullPath?: string
  type?: number
  /** 后端用字典 `absent_type` 现查的标签（与通用审批的 `statusName` 不同，**这个是真有值的**） */
  typeName?: string
  reason?: string
  startDate?: string
  endDate?: string
  startType?: number
  endType?: number
  attachments?: LeaveAttachment[]
  [key: string]: unknown
}

export type LeaveInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function assertDate (value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(`${label}必填，且必须是 YYYY-MM-DD 格式的字符串（页面的 a-date-picker value-format），收到 ${JSON.stringify(value)}`)
  }
  // 光看格式还不够：2026-02-31 也过正则。这里只做到"格式 + 真实存在"这一步，
  // 与页面一致（页面用 dayjs 格式化出来的一定是真实日期）。
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}不是一个真实存在的日期：${value}`)
  }
  return value
}

function assertPeriod (value: unknown, label: string): number {
  const num = Number(value)
  if (num !== PERIOD_AM && num !== PERIOD_PM) {
    throw new Error(`${label}只能是 1（上午）或 2（下午），收到 ${JSON.stringify(value)}`)
  }
  return num
}

function assertReason (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('请假事由 reason 必填（页面 formRules.reason 的 required）')
  }
  if (value.length > REASON_MAX) {
    throw new Error(`请假事由最多 ${REASON_MAX} 个字，收到 ${value.length} 个（页面 formRules.reason 的 max: 200）`)
  }
  return value
}

function assertType (value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    throw new Error(`请假类型 type 必填且必须是数字，收到 ${JSON.stringify(value)}（候选见 leave-application-types）`)
  }
  return num
}

/**
 * 附件校验：**只做页面真会拦的那三条里能拦的两条**。
 *
 * - **条数 ≤10**：`:maxCount="10"` 与 `onLeaveFileUploadDone` 的 `length >= 10`
 *   都会拦 → SDK 也拦。
 * - **扩展名**：页面的 `accept` 白名单（`.pdf .jpg .jpeg .png`）→ SDK 也拦
 *   （按 `name` 判；**没有扩展名时放行**，与通用审批那条线同一处理）。
 * - **50MB 大小上限不拦**：SDK 手上只有 url 与 name，**没有任何办法算出大小**。
 *   与其猜，不如把这条如实留给后端。
 */
export function assertAttachments (attachments: unknown): LeaveAttachment[] {
  if (attachments === undefined || attachments === null) return []
  if (!Array.isArray(attachments)) {
    throw new Error('attachments 必须是数组（页面上是 [{url, name}]，最多 10 件）')
  }
  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new Error(`附件最多 ${ATTACHMENT_MAX_COUNT} 件，收到 ${attachments.length} 件（页面 :maxCount=10）`)
  }
  return attachments.map((raw, index) => {
    const item = raw as { url?: unknown; name?: unknown } | null
    const url = item?.url
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`第 ${index + 1} 件附件缺 url。url 要用 base-upload-file 先传到 OSS（目录 HR/approval）`)
    }
    const name = typeof item?.name === 'string' ? item.name : ''
    const dot = name.lastIndexOf('.')
    if (dot > -1 && dot < name.length - 1) {
      const ext = name.slice(dot + 1).toLowerCase()
      if (!(ATTACHMENT_ACCEPT_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(
          `第 ${index + 1} 件附件的扩展名 .${ext} 不在本表单的 accept 白名单里：` +
            ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' ') +
            '（⚠️ 这个白名单比通用审批那条线窄，是两张不同的表）',
        )
      }
    }
    // 与页面 onLeaveFileUploadDone 一致：只保留 url 与 name
    return { url, name }
  })
}

/**
 * 附件必填的类型判定：页面 `formRules.attachments` 在
 * `checkType.includes(type)` 时才有 `required` 规则。
 */
export function isAttachmentRequired (type: number): boolean {
  return (ATTACHMENT_REQUIRED_TYPES as readonly number[]).includes(Number(type))
}

/** 附件必填的类型 + 空附件 ⇒ 抛错（页面在 `formRef.validate()` 里拦的就是这一条） */
export function assertAttachmentRequired (type: number, attachments: readonly unknown[]): void {
  if (isAttachmentRequired(type) && attachments.length === 0) {
    const label = LEAVE_TYPE_OPTIONS.find((o) => o.value === Number(type))?.label ?? `type=${type}`
    throw new Error(
      `「${label}」必须上传附件（页面 formRules.attachments：checkType = [3,4,7,8,9] 时 required）。` +
        '附件 url 要用 base-upload-file 先传到 OSS（目录 HR/approval）',
    )
  }
}

/**
 * 复刻 `form/005/utils.js` 的 `startIsAfterEnd()` —— **逐字符对应**：
 *
 * ```js
 * start.isAfter(end) || (start.isSame(end) && startType === 2 && endType === 1)
 * ```
 *
 * 用字符串比较而不是 dayjs：入参已经过 `assertDate()`，是严格的 `YYYY-MM-DD`，
 * 这个格式下字典序就是时间序。**零新增依赖**（本包不带 dayjs）。
 *
 * 断言失败时抛错，错误文案照抄页面的 `message.error('结束时间不能早于开始时间')`。
 */
export function assertPeriodOrder (
  startDate: string,
  startType: number,
  endDate: string,
  endType: number,
): void {
  const start = assertDate(startDate, '开始日期 startDate')
  const end = assertDate(endDate, '结束日期 endDate')
  const typeStart = assertPeriod(startType, '开始时间段 startType')
  const typeEnd = assertPeriod(endType, '结束时间段 endType')
  const after = start > end || (start === end && typeStart === PERIOD_PM && typeEnd === PERIOD_AM)
  if (after) {
    throw new Error(
      '结束时间不能早于开始时间（页面 utils.js 的 startIsAfterEnd：开始日期晚于结束日期，' +
        '或者同一天的「下午 → 上午」，都不合法）。这条在**发请求之前**就拦下',
    )
  }
}

/**
 * `startIsAfterEnd()` 的布尔版本（页面用它决定要不要发 `getRestDuration`）。
 * 已经过 `assertPeriodOrder()` 的输入必然返回 false。
 */
export function startIsAfterEnd (
  startDate: string,
  startType: number,
  endDate: string,
  endType: number,
): boolean {
  try {
    assertPeriodOrder(startDate, startType, endDate, endType)
    return false
  } catch {
    return true
  }
}

/**
 * 复刻 `form/005/utils.js` 的 `calculateDays()` —— 页面上的**本地**请假天数。
 *
 * ⚠️ **它不进载荷。** 载荷里的 `restDay` 用的是
 * `POST /getRestDuration` 的返回值（扣法定节假日），而这个是**不扣**的。
 * 导出的理由有两个：它是页面上真实存在的一处计算（「请假时长」那块显示要用它），
 * 以及「本地算的和接口给的差多少 = 被过滤掉的法定节假日天数」
 * （页面 `legalHolidays = leaveDuration - actualLeaveDuration`）需要一个可复算的来源。
 *
 * 与页面一致：开始晚于结束时返回 `0`（页面 `console.error` 后 `return 0`）。
 */
export function calculateLeaveDays (
  startDate: string,
  startType: number,
  endDate: string,
  endType: number,
): number {
  if (startIsAfterEnd(startDate, startType, endDate, endType)) return 0
  const daysDiff = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  )
  const start = Number(startType)
  const end = Number(endType)
  if (daysDiff === 0) {
    if (start === end) return 0.5
    if (start === PERIOD_AM && end === PERIOD_PM) return 1
    return 0
  }
  switch (`${start}-${end}`) {
    case '1-1':
    case '2-2':
      return daysDiff + 0.5
    case '1-2':
      return daysDiff + 1
    case '2-1':
      return daysDiff
    default:
      return daysDiff
  }
}

/** 把 `profile()` 的四个值并进载荷。**顺序就是页面 `formState` 的声明顺序** */
function assertProfile (profile: unknown): LeaveProfile {
  const p = profile as Partial<LeaveProfile> | null
  const pick = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`发起人信息缺 ${what}。先调 leave-application-profile 拿当前登录用户的这四项`)
    }
    return value
  }
  return {
    id: pick(p?.id, 'id（载荷里的 userId）'),
    userName: pick(p?.userName, 'realName（载荷里的 userName）'),
    staffCode: pick(p?.staffCode, 'username（载荷里的 staffCode）'),
    fullPath: pick(p?.fullPath, 'organizationName（载荷里的 fullPath）'),
  }
}

/**
 * 构造提交载荷。**逐字段复刻 `buildSubmitPayload()`**，包括键的书写顺序
 * ——D20 要求与浏览器逐字段一致，键顺序不同也算不一致。
 *
 * 基准（真实浏览器抓包，`baseline/leave-application.browser.json`，
 * 取自「查看审批流程」预览的 `variables`，它就是 `buildSubmitPayload()` 的产物
 * 加一个 `creatorOrgFullPath`）：
 *
 * ```json
 * {"userId":"18243","userName":"姚淼鑫","staffCode":"2021070101","fullPath":"设计中心1236",
 *  "type":3,"startDate":"2026-09-21","startType":1,"endDate":"2026-09-21","endType":2,
 *  "reason":"…","attachments":[],"restDay":1}
 * ```
 *
 * 三个容易被"顺手改掉"的点，都在这里钉死：
 *
 * 1. `userId` 是**字符串**（`/sys/user/info` 的 `id` 就是字符串，页面原样发）。
 * 2. `fullPath` 是 `organizationName`（"设计中心1236"），**不是全路径**。
 * 3. `restDay` **在最后**（`{...formState, restDay}` 的那个展开），且它是
 *    **接口给的值**、不是本地算的。
 */
export function buildLeavePayload (
  draft: LeaveDraft,
  profile: LeaveProfile,
  restDay: number | string,
): Record<string, unknown> {
  const who = assertProfile(profile)
  const type = assertType(draft?.type)
  const reason = assertReason(draft?.reason)
  const attachments = assertAttachments(draft?.attachments)
  assertAttachmentRequired(type, attachments)
  assertPeriodOrder(draft?.startDate, draft?.startType, draft?.endDate, draft?.endType)

  const rest = Number(restDay)
  if (!Number.isFinite(rest)) {
    throw new Error(
      `restDay 必须是数字，收到 ${JSON.stringify(restDay)}。` +
        '它来自 leave-application-duration（POST /getRestDuration），不要自己造',
    )
  }

  return {
    userId: who.id,
    userName: who.userName,
    staffCode: who.staffCode,
    fullPath: who.fullPath,
    type,
    startDate: draft.startDate,
    startType: Number(draft.startType),
    endDate: draft.endDate,
    endType: Number(draft.endType),
    reason,
    attachments,
    restDay: rest,
  }
}

/**
 * 表单的「四个日期字段都齐了」判据 —— 页面 `isShowLeaveDurationComputed`。
 *
 * 不齐就**不发** `getRestDuration`（页面那个 watch 的 `else` 分支把两个值清 0）。
 * SDK 的 `duration()` 复刻这条：与其发一个后端不看完整性的请求，
 * 不如按页面的行为直接告诉调用方"四个都填了再来"。
 */
export function isPeriodComplete (draft: {
  startDate?: unknown
  startType?: unknown
  endDate?: unknown
  endType?: unknown
}): boolean {
  const filled = (value: unknown): boolean =>
    value !== undefined && value !== null && String(value).trim() !== ''
  return (
    filled(draft?.startDate) &&
    filled(draft?.startType) &&
    filled(draft?.endDate) &&
    filled(draft?.endType)
  )
}

/**
 * 年休假的余额前置 —— 页面 `actionSubmit()` 里那两条 `message.error`：
 *
 * ```js
 * if (formState.value.type === 13) {
 *   if (annualLeaveBalance.value <= 0) return message.error('年假已用完，请切换请假类型')
 *   if (actualLeaveDuration.value > annualLeaveBalance.value) return message.error('年假剩余不足，请重新选择请假时间')
 * }
 * ```
 *
 * 只在 `type === 13` 时拦。`unRest` 可能是负数或半数（后端 `rest - 条数/2`），
 * 所以这里用数值比较、不取整。
 */
export function assertAnnualLeaveEnough (type: number, restDay: number, yearRest: UserYearRest): void {
  if (Number(type) !== ANNUAL_LEAVE_TYPE) return
  const balance = Number(yearRest?.unRest)
  if (!Number.isFinite(balance)) {
    throw new Error('年休假（type = 13）必须能拿到年假余额（leave-application-year-rest 的 unRest），否则无法判断够不够')
  }
  if (balance <= 0) {
    throw new Error(
      `年假已用完（剩余 ${balance} 天），请切换其他请假类型。` +
        '页面在这里就是 message.error 后直接 return，不发任何请求',
    )
  }
  if (Number(restDay) > balance) {
    throw new Error(`年假剩余不足（需要 ${restDay} 天，剩余 ${balance} 天），请重新选择请假时间`)
  }
}

/**
 * 自选审批人本地预检 —— **`general-approval.ts` 里同名函数的一份复刻**。
 *
 * 为什么不直接 import 那边那个：见文件头的导入注释（值导入会让
 * `smoke/leave-application.mjs` 那条 Node 类型剥离的路子直接 `ERR_MODULE_NOT_FOUND`）。
 *
 * 规则表与那边**逐条一致**，来源也一致（后端
 * `BpmProcessInstanceServiceImpl.validateStartUserSelectAssignees`）：
 *
 * | 后端规则 | 错误码 | 这里 |
 * | --- | --- | --- |
 * | 每个节点必须有非空 assignees | `…ASSIGNEES_NOT_CONFIG` | ✅ |
 * | 不能有 null | `…ASSIGNEE_ID_NULL` | ✅ |
 * | 不能重复 | `…ASSIGNEES_DUPLICATE` | ✅ |
 * | 人数要落在 min/max 内 | `…ASSIGNEES_COUNT_INVALID` | ✅ |
 * | 用户必须真实存在 | `…ASSIGNEES_NOT_EXISTS` | ❌ **不查**（要另打接口，且查完也可能变） |
 *
 * ⚠️ 本流程 `prepare` 实测恒返回空数组，所以现在这一步是**空转**；
 * 留着是为了流程改版（真加了 `START_USER_SELECT` 节点）时行为与通用审批那条线一致。
 * `test/leave-application.test.ts` 里有一条「两份实现逐例对照」的测试 ——
 * 谁改了规则忘了改另一份，那条会红。
 *
 * ⚠️ 这一份**刻意保持与通用审批那份行为等价**（包括 `Number('') === 0`、
 * `Number([]) === 0` 所以空串与空数组能混过第二条规则这个洞），
 * 为的是让上面那条对照测试是一句真话。
 * 真正守住 `create` 请求体的是 `normalizeAssignees()` —— 它比这里严
 * （显式拒 null / undefined / 空串），所以那个洞漏不到写请求里去。
 */
export function assertAssigneesForTasks (
  tasks: readonly StartUserSelectTask[],
  assignees: StartUserSelectAssignees,
): void {
  for (const task of tasks ?? []) {
    const picked = assignees?.[task.id]
    if (!Array.isArray(picked) || picked.length === 0) {
      throw new Error(
        `审批人节点「${task.name || task.id}」没有选人。后端会以「发起人自选审批人不能为空」拒绝整条提交` +
          `（PROCESS_INSTANCE_START_USER_SELECT_ASSIGNEES_NOT_CONFIG）。` +
          `请用 leave-application-prepare 拿到节点 id，再把 { "${task.id}": [userId] } 传给 submit。`,
      )
    }
    if (picked.some((id) => id === null || id === undefined || !Number.isFinite(Number(id)))) {
      throw new Error(`审批人节点「${task.name || task.id}」的列表里有空值或非数字（后端 ASSIGNEE_ID_NULL）`)
    }
    if (new Set(picked.map(Number)).size !== picked.length) {
      throw new Error(`审批人节点「${task.name || task.id}」的列表里有重复的人（后端 ASSIGNEES_DUPLICATE）`)
    }
    const min = task.minSelectCount ?? 0
    const max = task.maxSelectCount ?? null
    if (picked.length < min) {
      throw new Error(
        `审批人节点「${task.name || task.id}」至少要选 ${min} 个人，收到 ${picked.length} 个。` +
          `（${task.approvalDescription || '见节点的 approvalDescription'}）`,
      )
    }
    if (max !== null && picked.length > max) {
      throw new Error(`审批人节点「${task.name || task.id}」最多选 ${max} 个人，收到 ${picked.length} 个`)
    }
  }
}

/** 路径参数里的 id 归一（只用于报错信息与 URL 拼接，不改类型） */
function describeId (id: number | string, what: string): string {
  const value = typeof id === 'number' ? String(id) : String(id ?? '').trim()
  if (value === '') throw new Error(`${what} 不能为空`)
  return value
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const CONTENT_PARAMS: ParamSpec[] = [
  {
    name: 'type',
    kind: 'enum',
    required: true,
    description:
      '请假类型，必填。候选来自字典 `absent_type`（`leave-application-types` 可现读）。' +
      `⚠️ 类型 3/4/7/8/9（事假/病假/婚假/丧假/产假）**必须带附件**；` +
      `13（年休假）会先查年假余额，余额不足直接拒绝`,
    options: LEAVE_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'reason',
    kind: 'text',
    required: true,
    description: `请假事由，必填，最多 ${REASON_MAX} 字（页面 formRules.reason）`,
  },
  {
    name: 'startDate',
    kind: 'date',
    required: true,
    description:
      '开始日期 `YYYY-MM-DD`。⚠️ 它与 `startType` 是**页面上同一个控件**的两个产物' +
      '（日期 + 上午/下午），两个都必填，且与结束日期有一处跨字段合法性校验',
  },
  {
    name: 'startType',
    kind: 'enum',
    required: true,
    description: '开始时间段：1 = 上午、2 = 下午（页面的 leaveTimeTypeList，硬编码不是字典）',
    options: LEAVE_PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'endDate',
    kind: 'date',
    required: true,
    description: '结束日期 `YYYY-MM-DD`。开始日期晚于它、或同一天「下午 → 上午」都不合法（页面 utils.js 的 startIsAfterEnd）',
  },
  {
    name: 'endType',
    kind: 'enum',
    required: true,
    description: '结束时间段：1 = 上午、2 = 下午',
    options: LEAVE_PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'attachments',
    kind: 'text',
    required: false,
    description:
      `附件数组 [{url, name}]，最多 ${ATTACHMENT_MAX_COUNT} 件，扩展名只收 ` +
      ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' ') +
      '（**比通用审批那条线窄**）。url 要用 base-upload-file 先传到 OSS（目录 HR/approval）。' +
      `⚠️ type ∈ {${ATTACHMENT_REQUIRED_TYPES.join(',')}} 时**必填**；` +
      `⚠️ 页面的 ${ATTACHMENT_MAX_SIZE_MB}MB 单件上限 SDK 校验不了（拿不到字节数）`,
  },
]

export const leaveApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'leave-application-definition',
    title: '查询请假流程（qingjia）的流程定义',
    pagePath: LEAVE_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${LEAVE_APPLICATION_PROCESS_KEY}`,
        options: [{ label: '请假申请流程', value: LEAVE_APPLICATION_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'leave-application-profile',
    title: '当前登录用户是谁（发起人信息）',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [],
  },
  {
    id: 'leave-application-types',
    title: '读请假类型字典（页面下拉的候选）',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'dictType',
        kind: 'enum',
        required: false,
        description: '字典类型，默认 absent_type（页面 `getDictListByType(\'absent_type\', true)`）',
        options: [{ label: '请假类型', value: 'absent_type' }],
      },
    ],
  },
  {
    id: 'leave-application-year-rest',
    title: '查某人的年假余额（页面「剩余年假」那块）',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'userId',
        kind: 'number',
        required: true,
        description:
          '用户 id。**页面只会查自己**（`formState.userId`，来自只读的申请人信息块）——' +
          '不带参数时 SDK 用 profile() 里那个当前登录用户；传别人是调用方自己的选择',
      },
    ],
  },
  {
    id: 'leave-application-duration',
    title: '算请假时长（页面「请假时长」那块，自动扣法定节假日）',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'startDate',
        kind: 'date',
        required: true,
        description: '开始日期 `YYYY-MM-DD`',
      },
      { name: 'startType', kind: 'enum', required: true, description: '开始时间段 1=上午 / 2=下午', options: LEAVE_PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
      { name: 'endDate', kind: 'date', required: true, description: '结束日期 `YYYY-MM-DD`' },
      { name: 'endType', kind: 'enum', required: true, description: '结束时间段 1=上午 / 2=下午', options: LEAVE_PERIOD_OPTIONS.map((o) => ({ label: o.label, value: o.value })) },
    ],
  },
  {
    id: 'leave-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: CONTENT_PARAMS,
  },
  {
    id: 'leave-application-submit',
    title: '提交请假申请（会真的发起流程、给审批人推待办）',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: true,
    params: [
      ...CONTENT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: true,
        description:
          '{ [节点 id]: [用户 id, ...] }。节点 id 来自 leave-application-prepare。' +
          '⚠️ 本流程实测返回**空数组**（审批人是 BPMN 里写死的 3 个用户 id），' +
          '所以这里传 `{}` 就是正常的 —— 但**仍然要传**：漏了这个键 create 会因为反序列化不上而下发一个没有它的请求',
      },
    ],
  },
  {
    id: 'leave-application-detail',
    title: '查询单条请假单据',
    pagePath: LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有 `id` 也没有 `restDay`**，' +
          '也没有流程实例 id（要取消得先 leave-application-my-instances 按 businessKey 找流程实例）',
      },
    ],
  },
  {
    id: 'leave-application-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: LEAVE_APPLICATION_MY_LIST_PATH,
    write: false,
    params: [
      { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
      { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
      {
        name: 'status',
        kind: 'enum',
        required: false,
        description: '流程状态；1 = 审批中（页面上「取消流程」按钮出现的条件）',
        options: [
          { label: '审批中', value: 1 },
          { label: '已通过', value: 2 },
          { label: '已驳回', value: 3 },
          { label: '已取消', value: 4 },
        ],
      },
      {
        name: 'processType',
        kind: 'enum',
        required: false,
        description: '流程类型字典 bpm_process_type；本流程是 1（审核）',
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'leave-application-cancel',
    title: '取消（撤回）我发起的请假流程',
    pagePath: LEAVE_APPLICATION_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 leave-application-my-instances 那一行的 id',
      },
      {
        name: 'businessKey',
        kind: 'number',
        required: false,
        description:
          '业务单据 id（submit 的返回值）。给了它、没给 processInstanceId 时，' +
          'SDK 会先去「我的流程」里按 businessKey 把它找出来（findInstanceByBusinessKey）',
      },
      {
        name: 'reason',
        kind: 'text',
        required: true,
        description:
          '取消原因。**必填且不能是空串** —— 后端 `BpmProcessInstanceCancelReqVO.reason` 是 ' +
          '`@NotEmpty`（页面虽然允许空提交，但那样后端会报「取消原因不能为空」）',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type LeaveApplicationOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条）。给上限是免得为了一条记录把整个列表翻完 */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

/** 字典接口返回的一项（只列本能力用到的字段） */
type DictGroup = { dictType?: string; dataList?: Array<{ label?: string; value?: string | number }> }

export function createLeaveApplicationCapability (
  request: PortalRequest,
  options: LeaveApplicationOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /**
   * 当前登录用户。
   *
   * 走 `GET /sys/user/info` —— 这是**页面自己走的那条**
   * （`baseData: [user-basic]` → `base-data.js:58` → `fetchSimpleUserBasic`）。
   *
   * ⚠️ **刻意不整份返回**：那个响应里带 `password2`（bcrypt 口令散列）与 `salt`。
   * 只投影表单要的四项。这不是"少返回了几个字段"，是"不要把口令散列交给调用方"。
   */
  async function profile (): Promise<LeaveProfile> {
    const info = await request<Record<string, unknown>>({
      url: '/sys/user/info',
      method: 'get',
    })
    return {
      id: String(info?.id ?? ''),
      userName: String(info?.realName ?? ''),
      staffCode: String(info?.username ?? ''),
      // ⚠️ organizationName，不是 organizationFullPathName —— 见 LeaveProfile 的表
      fullPath: String(info?.organizationName ?? ''),
    }
  }

  /** 请假时长（**只读**）。返回后端算的天数（扣法定节假日）。`submit` 的 `restDay` 就是它 */
  async function duration (query: {
    startDate: string
    startType: number
    endDate: string
    endType: number
  }): Promise<number> {
    if (!isPeriodComplete(query ?? {})) {
      return Promise.reject(
        new Error(
          '算请假时长需要四个字段都齐（页面 isShowLeaveDurationComputed：startDate/startType/endDate/endType），' +
            '不齐时页面根本不发这个请求',
        ),
      )
    }
    assertPeriodOrder(query.startDate, query.startType, query.endDate, query.endType)
    const days = await request<number>({
      url: '/hr/attendance-user-rel/getRestDuration',
      method: 'post',
      // 键顺序照抄页面的 getLeaveDuration(form)：startDate → startType → endDate → endType
      data: {
        startDate: query.startDate,
        startType: Number(query.startType),
        endDate: query.endDate,
        endType: Number(query.endType),
      },
    })
    return Number(days)
  }

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: LeaveInstanceQuery = {},
  ): Promise<{ list: ProcessInstanceRow[]; total: number }> =>
    request<{ list: ProcessInstanceRow[]; total: number }>({
      url: '/bpm/process-instance/my-page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        name: query.name ?? '',
        title: query.title ?? '',
        category: query.category ?? '',
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.processType === undefined ? {} : { processType: query.processType }),
        pageNo: query.pageNo ?? 1,
        pageSize: query.pageSize ?? 20,
      },
    })

  /**
   * 按业务单据 id 找它对应的流程实例。
   *
   * **为什么必须存在这个方法**：`cancel-by-start-user` 要流程实例 id，而
   * `GET /hr/attendance-user-rel/get` 的响应 VO 里**没有 `processInstanceId`**
   * （`AttendanceUserRelDO` 有，但 service 没往 VO 上 set）。唯一的通路就是翻
   * 「我的流程」，用 `businessKey` 对上——这也正是页面上点「取消流程」时拿的
   * `record.id`（`flow/task/my/list.vue` 的 `actionCancel(record.id)`）。
   *
   * **为什么还要按 `processDefinitionKey` 再筛一道**：`businessKey` 是**各业务表
   * 自己的主键**（后端 `setBusinessKey(String.valueOf(resultId))`），所以
   * 「请假 51」与「通用审批 51」会撞成同一个字符串。只按 businessKey 匹配会认错单子。
   * ⚠️ 这里**不能**用 `processType` 区分：通用审批是 2（审批）、请假是 1（审核），
   * 看着能分，但请求里加一个页面从不发的过滤参数会白白偏离 D20 的逐字段一致。
   */
  async function findInstanceByBusinessKey (businessKey: number | string): Promise<ProcessInstanceRow> {
    const wanted = describeId(businessKey, 'businessKey')
    for (let page = 1; page <= maxScanPages; page += 1) {
      const result = await myInstances({ pageNo: page, pageSize: scanPageSize })
      const list = result?.list ?? []
      const hit = list.find(
        (row) =>
          String(row.businessKey) === wanted &&
          (row.processDefinitionKey === undefined ||
            row.processDefinitionKey === LEAVE_APPLICATION_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的请假流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 leave-application-my-instances 自己按条件找。',
    )
  }

  /**
   * 一次"把提交载荷拼齐"的公共动作：**取发起人 → 算时长 → 拼载荷**。
   *
   * `prepare` 与 `submit` 都走它，所以两边**一定发同一份载荷**
   * （页面也是同一个 `buildSubmitPayload()`）。
   *
   * ⚠️ `restDay` 每次都**现算**：它是流程变量，决定 BPMN 走哪条分支
   * （`restDay >= 3` 才多一个「领导审核」节点）。让调用方传一个数进来，
   * 等于允许伪造流程走向；让调用方自己调 `duration()` 再回填，等于把
   * "别传错"这件事外包给调用方。两种都不如这里现算。
   */
  /**
   * **在一次请求都不发的前提下**把必然失败的输入挡住。
   *
   * ⚠️ 这必须是**独立的一步、且排在所有请求之前**。第一版把 `reason` 的校验留在
   * `buildLeavePayload()` 里（它在 duration 之后才跑），结果「事由为空」这种输入
   * 会先打完 `profile` + `getRestDuration` 两个请求才红 —— 被测试抓到。
   * 写操作会惊动真人，能让它红在第一个字节之前就红在第一个字节之前。
   */
  function assertDraft (draft: LeaveDraft): void {
    const type = assertType(draft?.type)
    assertReason(draft?.reason)
    const attachments = assertAttachments(draft?.attachments)
    assertAttachmentRequired(type, attachments)
    assertPeriodOrder(draft?.startDate, draft?.startType, draft?.endDate, draft?.endType)
  }

  async function buildPayload (draft: LeaveDraft): Promise<{
    who: LeaveProfile
    restDay: number
    payload: Record<string, unknown>
  }> {
    // 先在本地把"必然失败"的输入挡住，再发请求（写操作会惊动真人）
    assertDraft(draft)
    const type = assertType(draft?.type)

    const who = await profile()
    const restDay = await duration({
      startDate: draft.startDate,
      startType: Number(draft.startType),
      endDate: draft.endDate,
      endType: Number(draft.endType),
    })

    // 年休假：余额不够就**不往下走**（页面 actionSubmit 里的两条 message.error）
    if (type === ANNUAL_LEAVE_TYPE) {
      const yearRest = await request<UserYearRest>({
        url: '/hr/attendance-user-rel/getYearRest',
        method: 'get',
        params: { userId: who.id },
      })
      assertAnnualLeaveEnough(type, restDay, yearRest)
    }

    return { who, restDay, payload: buildLeavePayload(draft, who, restDay) }
  }

  /**
   * 问后端"这次提交要不要人工指定审批人" —— 页面 `actionSubmit()` 里
   * `bpmGetRequiredStartUserSelectTasks({ fetchMethod: () => httpTenant.post(apiCheck, submitData) })`
   * 那一步。
   *
   * ⚠️ **`prepare` 与 `submit` 都走它**：页面就是这么写的（`actionSubmit` 先查节点、
   * 再 `{...submitData, startUserSelectAssignees}` 建单）。所以 `submit` 会多打一次
   * 只读请求 —— 这不是冗余，是**逐字复刻页面的顺序**，也是
   * `assertAssigneesForTasks()` 能真正拿到节点去预检的前提。
   */
  async function fetchStartUserSelectTasks (payload: Record<string, unknown>): Promise<StartUserSelectTask[]> {
    const tasks = await request<StartUserSelectTask[]>({
      url: '/hr/attendance-user-rel/getRequiredStartUserSelectTasks',
      method: 'post',
      data: payload,
    })
    return Array.isArray(tasks) ? tasks : []
  }

  /**
   * 审批人 map 的数字归一 + 形状校验。
   *
   * **先把整张表校验完再构造**：不能一边 `.map()` 一边 `return Promise.reject()` ——
   * 那样数组里会被塞进一个 Promise 对象，错误也变成异步的，报出来的东西极难懂
   * （这是本文件第一版真写错过的写法，改成两趟：先查后建）。
   */
  function normalizeAssignees (assignees: StartUserSelectAssignees): StartUserSelectAssignees {
    if (assignees === null || typeof assignees !== 'object') {
      throw new Error('startUserSelectAssignees 必须是 { [节点 id]: [用户 id, ...] }（本流程没有自选节点时传 {}）')
    }
    for (const [taskId, ids] of Object.entries(assignees)) {
      if (!Array.isArray(ids)) {
        throw new Error(`startUserSelectAssignees["${taskId}"] 必须是用户 id 数组`)
      }
      ids.forEach((id, index) => {
        // ⚠️ `Number(null) === 0`、`Number('') === 0`、`Number([]) === 0` ——
        // 光用 `Number.isFinite(Number(id))` 判，这三种都会**悄悄变成用户 0**。
        // 后端 `validateStartUserSelectAssignees` 对 null 是有专门的
        // `…ASSIGNEE_ID_NULL` 错误码的，这里必须一样严。
        if (id === null || id === undefined || String(id).trim() === '' || !Number.isFinite(Number(id))) {
          throw new Error(`startUserSelectAssignees["${taskId}"][${index}] 不是有效的用户 id：${JSON.stringify(id)}`)
        }
      })
    }
    const normalized: StartUserSelectAssignees = {}
    for (const [taskId, ids] of Object.entries(assignees)) {
      normalized[taskId] = ids.map((id) => Number(id))
    }
    return normalized
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 */
    definition (key: string = LEAVE_APPLICATION_PROCESS_KEY): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    profile,

    /** 请假类型字典（只读）。页面每次挂载现读，所以**以它为准**，别信写死的那张表 */
    async types (dictType = 'absent_type'): Promise<LeaveTypeOption[]> {
      const groups = await request<DictGroup[]>({
        url: '/system/dict-data/grouped-list',
        method: 'get',
      })
      const group = (Array.isArray(groups) ? groups : []).find((g) => g?.dictType === dictType)
      return (group?.dataList ?? []).map((item) => ({
        label: String(item?.label ?? ''),
        value: Number(item?.value),
      }))
    },

    /** 年假余额（只读）。`userId` 不给时用当前登录用户 —— 页面只会查自己 */
    async yearRest (userId?: number | string): Promise<UserYearRest> {
      const id = userId === undefined || userId === null ? (await profile()).id : userId
      return request<UserYearRest>({
        url: '/hr/attendance-user-rel/getYearRest',
        method: 'get',
        params: { userId: id },
      })
    },

    duration,

    /**
     * 提交前准备（**只读**）：算出这次提交需要人工指定哪些审批人节点。
     *
     * 与页面 `actionSubmit()` 的第一步一致：**先补齐载荷**（含现算的 `restDay`），
     * 再把同一份载荷 POST 给 `getRequiredStartUserSelectTasks`。
     *
     * ⚠️ 本流程实测返回**空数组**（审批人是 BPMN 里写死的 3 个用户 id，
     * `candidateStrategy = 30 = USER`）——与通用审批那条线**正好相反**。
     * 但接口照打：换一个流程或流程改版，答案就可能不是空的。
     *
     * 返回的 `payload` 就是 `submit` 会发的业务字段（不含 `startUserSelectAssignees`），
     * 便于调用方在真提交之前先看一眼。
     */
    async prepare (draft: LeaveDraft): Promise<{
      payload: Record<string, unknown>
      tasks: StartUserSelectTask[]
      restDay: number
    }> {
      const { payload, restDay } = await buildPayload(draft)
      const tasks = await fetchStartUserSelectTasks(payload)
      return { payload, tasks, restDay }
    },

    /**
     * 真正提交（**写操作**）：生成请假记录（**一天一条 `AttendanceUserRelDO`，
     * 上午下午各一条**）并起一条 `qingjia` 审批流。
     *
     * ⚠️ 它会**给真人推待办、可能发站内消息**。本流程的审批人是**写死的三个用户 id**
     * （见文件头 §六），你**选不了**——所以测试请：
     *   1. 事由里带 `SDK-TEST-` 前缀（本流程**没有标题字段**，事由就是那条待办的
     *      `reason`，也是收到的人唯一能看出这是测试数据的地方）；
     *   2. 用 `restDay < 3` 的时长（半天/一天），这样只打扰 2 个人而不是 3 个；
     *   3. 测完立刻用 `cancel()` 撤掉。
     *
     * 调用方必须先走 `prepare()`。本流程实测没有自选审批人节点，`{}` 就是正确答案；
     * 但**仍然要显式传**（页面是 `{...submitData, startUserSelectAssignees}`，
     * 这个键永远在最后）。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）——注意它是**多行里最后插入的那一行的
     * id**（`AttendanceUserRelServiceImpl` 的 `resultId` 在循环里被覆盖），
     * 不是"这条请假的 id"这种东西：一天会插两行。它同时是流程的 `businessKey`，
     * 所以 `detail()` 与 `cancel()` 都吃它。⚠️ 不是流程实例 id。
     */
    async submit (
      draft: LeaveDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<unknown> {
      // async 不是为了 await：本地校验失败要变成 **rejected promise**，
      // 否则调用方 try/catch 包 await 会漏掉同步抛出（与通用审批那条线一致）。
      const { payload } = await buildPayload(draft)
      const tasks = await fetchStartUserSelectTasks(payload)
      // 本流程 tasks 恒为空（审批人是 BPMN 里写死的用户 id），所以这一步现在是空转；
      // 留着是为了流程改版（真加了 START_USER_SELECT 节点）时行为不变 ——
      // 与通用审批那条线共用同一份后端规则复刻。
      assertAssigneesForTasks(tasks, startUserSelectAssignees)
      const normalized = normalizeAssignees(startUserSelectAssignees)

      // 键顺序照抄 actionSubmit 的最后一步：{ ...submitData, startUserSelectAssignees }
      return request({
        url: '/hr/attendance-user-rel/create',
        method: 'post',
        data: { ...payload, startUserSelectAssignees: normalized },
      })
    },

    /**
     * 单条单据详情（**只读**）。
     *
     * ⚠️ 响应里 **`id` 恒为 `null`**（后端 service 没 `setId`），也**没有 `restDay`**、
     * 没有 `processInstanceId`。`typeName` 倒是真有值（后端现查 `absent_type` 字典）。
     * 详见 `LeaveRecord`。
     */
    async detail (id: number | string): Promise<LeaveRecord> {
      describeId(id, '请假单据 id')
      return request<LeaveRecord>({
        url: '/hr/attendance-user-rel/get',
        method: 'get',
        params: { id },
      })
    },

    myInstances,

    findInstanceByBusinessKey,

    /**
     * 取消（撤回）自己发起的流程（**写操作**）。
     *
     * `DELETE /bpm/process-instance/cancel-by-start-user`，body `{ id, reason }`。
     * **`id` 是流程实例 id，不是业务单据 id** —— 两个都收，给 `businessKey` 时
     * 自动去「我的流程」里换（`findInstanceByBusinessKey`）。
     *
     * `reason` 必填：后端 `@NotEmpty`。
     *
     * ⚠️ **本流程踩不到通用审批那个"选自己当审批人 ⇒ 撤销不掉"的坑**：
     * 这里的审批人由 BPMN 写死（15012 / 15170 / 17063），**不是调用方能选的**。
     * 只有当**发起人本人就是这三个 id 之一**时，那一个节点才会自动通过；
     * 三个全中才会整条走完。测试账号（18243）不在其中，所以正常撤销。
     * 相应地：**如果换个账号跑冒烟，先确认那个人不是 15012/15170/17063** ——
     * 这条写在了 `smoke/leave-application.mjs` 的提交前拒绝里。
     */
    async cancel (params: {
      reason: string
      processInstanceId?: string
      businessKey?: number | string
    }): Promise<unknown> {
      const reason = typeof params?.reason === 'string' ? params.reason.trim() : ''
      if (reason === '') {
        return Promise.reject(
          new Error('取消原因 reason 必填（后端 BpmProcessInstanceCancelReqVO.reason 是 @NotEmpty）'),
        )
      }
      let id = params?.processInstanceId === undefined || params.processInstanceId === null
        ? ''
        : String(params.processInstanceId).trim()
      if (id === '') {
        if (params?.businessKey === undefined || params.businessKey === null) {
          return Promise.reject(
            new Error(
              'cancel 需要 processInstanceId 或 businessKey 其中之一：' +
                'processInstanceId 来自 leave-application-my-instances，' +
                'businessKey 就是 submit 返回的业务单据 id',
            ),
          )
        }
        const instance = await findInstanceByBusinessKey(params.businessKey)
        id = String(instance.id)
      }
      return request({
        url: '/bpm/process-instance/cancel-by-start-user',
        method: 'delete',
        data: { id, reason },
      })
    },
  }
}

export type LeaveApplicationCapability = ReturnType<typeof createLeaveApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与通用审批那条线同样的分工（也因此同名）：`withIdempotency` 需要**身份**
 * （租户 / 用户），那是会话层的东西，所以包装放在组装点，能力模块只声明形状。
 */
export type LeaveApplicationCapabilityWithIdempotency = LeaveApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **为什么这条同样最需要防重**：后端零幂等，重发一次就是**第二条流程实例 +
   * 第二串真人待办**。不过本流程还有一道天然防线：
   * `createAttendanceUserRel` 会先查"同一天同一上午/下午是否已有 RUNNING 的请假"，
   * 有就报「已经有相同的请假在流程中了！」——但那**只在日期完全撞上时才拦得住**，
   * 换一组日期照样重发。所以 `requestId` 该带还是要带
   * （用 `createRequestId()` 生成，超时重试时原样传回同一个）。
   */
  submitIdempotent: (
    params: LeaveDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
    },
  ) => Promise<unknown>
}
