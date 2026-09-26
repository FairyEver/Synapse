import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 加班申请（`hr_overtime_application`）—— 流程表单这一类的第三条线。
 *
 * 页面：`/simple/hr/form/042`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=hr_overtime_application&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/042
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么是这一条
 * ---------------------------------------------------------------------------
 *
 * `docs/process-forms.md` §2.2 的第一梯队（通用审批 / 请假 / 用车 / 产品文档）在前四条线里
 * 已经做完。人力域里剩下的「普通员工日常会用」的流程，按「人人都发起、字段少、不依赖
 * 财务/生产专业知识」排，下一条就是**加班申请 / 调休申请**这一对（`hr/form/042`、`043`）。
 * 本单做 `042`（加班），它的只读联动比调休更丰富（时长自动计算 + 结束时间不得早于开始）。
 *
 * 实测确认（2026-09-21，`GET /bpm/process-definition/create-list` 两个 processType 都拉）：
 *
 * | key | 名称 | processType | formCustomCreatePath |
 * | --- | --- | --- | --- |
 * | `hr_overtime_application` | 加班审批 | **2（审批）** | `simple/hr/form/042` |
 *
 * 与 `docs/process-forms.md` §1.4 记录的一致（该表把「审核/审批」标错过的先例是产品设计
 * 文档审核那条，本条**复核后无误**）。
 *
 * ---------------------------------------------------------------------------
 * 二、字段契约从哪来：**接口里没有，只在前端源码与真实页面里**
 * ---------------------------------------------------------------------------
 *
 * 【实测】`GET /bpm/process-definition/get?key=hr_overtime_application` 返回
 * `formFields: null`、`formCustomCreatePath: null`；`create-list` 只给后者。
 * 所以字段只能读：
 *
 * - `app/portal/views/simple/hr/form/042/page/pc/edit/index.vue`（模板 + 校验 + 联动）
 * - `app/portal/views/simple/hr/form/042/page/common/define.js`（两个下拉的选项）
 * - 后端 `OvertimeApplicationController` / `OvertimeApplicationSaveReqVO` / `OvertimeApplicationServiceImpl`
 *
 * 真实页面抓的载荷见 `baseline/overtime-application.browser.json`：**12 个字段一个不多一个不少**。
 *
 * ---------------------------------------------------------------------------
 * 三、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面控件 | 字段 | 形态 | 谁产生 | SDK |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | 申请人 | `applicantId` / `applicantName` | **只读文本**（不是输入框） | `initUserInfo()` 从用户 store 填 | 自动（`currentUser()`） |
 * | 2 | 申请时间 | `applyDate` | **只读文本** | `dayjs().format('YYYY-MM-DD')` = **今天** | 自动（`portalToday()`） |
 * | 3 | 申请部门 | `applyDepartmentId` / `applyDepartmentName` | **只读文本** | 同上，取用户的 `organizationId`/`organizationName` | 自动 |
 * | 4 | 加班事由 | `reason` | `a-textarea` | 用户填，必填，≤500 | `reason` |
 * | 5 | 加班类型 | `overtimeType` | `a-select` 0/1/2 | 用户填，必填 | `overtimeType` |
 * | 6 | 补贴类型 | `subsidyType` | `a-select` 0/1/2 | 用户填，必填 | `subsidyType` |
 * | 7 | 开始加班时间 | `startTime` | `a-date-picker show-time` | 用户填，必填 | `startTime` |
 * | 8 | 结束加班时间 | `endTime` | `a-date-picker show-time` | 用户填，必填，**必须晚于开始** | `endTime` |
 * | 9 | 中途休息时长 | `breakHours` | `a-input-number` 0..(结束-开始) | 用户填，必填 | `breakHours` |
 * | 10 | 加班时长 | `overtimeHours` | `a-input-number` **disabled** | **前端算**（见 §四） | 自动（算出来，不收调用方给的值） |
 * | 11 | 审批人 | `startUserSelectAssignees` | —— | **本流程没有这个控件**（见 §五） | 默认 `{}` |
 * | 12 | 「查看审批流程」预览 | —— | 只读按钮 | —— | **做了**（见 §六，且它是本能力的安全守卫） |
 *
 * ⇒ **12 个字段全部表达**。1/2/3/10 是**只读联动**：页面上没有输入口，用户改不了，
 * 所以 SDK 也不把它们做成参数（做成参数就等于承认"用户可以填一个页面上改不了的值"）。
 * 本表单**没有附件控件、没有抄送人控件**（与通用审批那条线不同）——不是漏做，是页面上没有。
 *
 * ---------------------------------------------------------------------------
 * 四、只读联动：加班时长的算法（**逐位复刻，不允许自己发明**）
 * ---------------------------------------------------------------------------
 *
 * 页面 `calculateOvertimeHours()`（`042/page/pc/edit/index.vue:372-393`）：
 *
 * ```js
 * const diffHours = end.diff(start, 'hour', true)          // 浮点小时
 * const breakHours = formState.value.breakHours || 0
 * const overtimeHours = Math.max(0, diffHours - breakHours)
 * formState.value.overtimeHours = parseFloat(overtimeHours.toFixed(1))
 * ```
 *
 * 后端**不重算**：`validateAndFillHours()` 只校验 `endTime.isAfter(startTime)` 与
 * `breakHours >= 0`，`overtimeHours` 原样入库。⇒ **前端算错了就会错着入库**，
 * 所以 SDK 必须按上面那一行一模一样地算（含 `toFixed(1)` + `parseFloat` 的尾数行为）。
 *
 * 另外三条只读联动也在这里实现：
 *
 * - `endTime` **严格晚于** `startTime`（后端 `!endTime.isAfter(startTime)` 直接报错；
 *   页面在同一天时 `disabledHours` 屏蔽 ≤ 开始小时）。
 * - `breakHours <= 结束-开始`（页面 `:max="maxBreakHours"`）；越界会让加班时长算成 0，
 *   被下面那条拦下。
 * - **加班时长不能为 0**：页面 `formSubmit()` 里 `if (!overtimeHours || overtimeHours === 0)`
 *   弹「加班时长不能为0」并 `return`。SDK 照做（这条同时兜住了上面那条 `:max`）。
 *
 * ---------------------------------------------------------------------------
 * 五、★ 审批链：本流程与前四条线**形态不同**，而且这条差异是本能力最有价值的东西
 * ---------------------------------------------------------------------------
 *
 * 【实测 2026-09-21】`POST /hr/overtime-application/getRequiredStartUserSelectTasks`
 * 用一份合法载荷打过去，返回的是 **`[]`**——**本流程一个「发起人自选」节点都没有**。
 * 它**必须收完整载荷**（传 `{}` 会被后端 `@Valid` 打回「结束加班时间不能为空」），
 * 这也和通用审批那条线不同（那条把请求体整个忽略）。
 *
 * 审批人从哪来？`GET /bpm/process-definition/get` 的 `bpmnXml` 里：
 *
 * ```xml
 * <userTask id="Activity_158exxp" name="直属上级审批"
 *           flowable:candidateStrategy="23" flowable:candidateParam="__placeholder__"/>
 * ```
 *
 * `23 = BpmTaskCandidateStrategyEnum.DIRECT_LEADER（直属上级）`——审批人是后端按
 * 发起人所在组织**算出来**的，不是发起人选的。
 *
 * ⇒ 这引出**本能力最重要的一条守卫**（§六）。
 *
 * ---------------------------------------------------------------------------
 * 六、★ 提交前的硬守卫：审批链里不能有发起人本人（比前四条线都强）
 * ---------------------------------------------------------------------------
 *
 * **为什么必须有这条**：后端 `BpmTaskServiceImpl` 有一条规则——「流程发起人与审批人相同，
 * 自动审核通过」。一旦命中，流程**当场走完**，`cancel-by-start-user` 必然报
 * 「流程取消失败，流程不处于运行中」，那条单据就**永远撤不掉**（测试环境里已经因此留了
 * 3 条撤不掉的单据）。
 *
 * 前四条线的做法是：**只对「发起人自选」节点，禁止把审批人选成自己**——因为那些流程的
 * 审批人是调用方自己挑的，SDK 只要在 `assertAssigneesForTasks` 之外再看一眼就能拦。
 *
 * **本流程拦不了那条**：它没有自选节点，审批人由后端按「直属上级」算，调用方**根本不知道
 * 会是谁**（页面上也一样不知道——用户得点「查看审批流程」才看得到）。
 * 所以本能力的守卫改成**基于真实审批链**：
 *
 * ```
 * POST /bpm/process-instance/preview   body {processDefinitionKey, variables, ...}
 *   → nodes[].type === 'USER_TASK' 的 candidateUsers[] 里逐个比对发起人 id
 *   → 命中 ⇒ **在 create 之前**抛错，一个写请求都不发
 * ```
 *
 * 这比前四条线强在哪，逐条写清：
 *
 * | | 前四条线（通用审批 / 请假 / 用车 / 产品设计） | 本能力 |
 * | --- | --- | --- |
 * | 判据来源 | **调用方传进来的 assignees** | **后端算出来的真实审批链** |
 * | 覆盖的节点 | 只有 `candidateStrategy=35`（发起人自选） | **所有** `USER_TASK` 节点（直属上级 / 部门负责人 / 岗位 / 用户组…） |
 * | 能不能防住"猜不到的审批人" | ❌ 防不住（那种流程压根没有自选节点） | ✅ 正是它的目标 |
 * | 什么时候发现 | 提交**前**（但只对自选节点有效） | 提交**前**（`create` 之前） |
 *
 * 预演的实际效果【实测】：`variables` 用真实的表单字段打过去，`Activity_158exxp`
 * 的 `candidateUsers` 返回 `[{id: 15012, nickname: '乔娜'}]`——发起人是 18243，
 * 不是同一个人，守卫放行。这条**在提交前就答出了"会打扰谁"**，报告里能如实写出来。
 *
 * ⚠️ 守卫的**逃生口**：`skipSelfApprovalGuard: true`。只在**预览接口本身不可用**时才该用。
 * 默认关着（守卫开着）。理由与 `assertAssigneesForTasks` 一样：宁可让调用方显式承认
 * "我知道自己在冒险"，也不要静默放过去。
 *
 * ⚠️ **已如实记下的边界**：这条守卫**不能证明**审批人最终一定是预览里那个人。
 * 预览是"按当前数据算一遍"，而真实办理时后端会拿到当时的组织数据再算一次。
 * 两者在组织架构刚变过的时候可能不一致。SDK 能保证的是：**预览时命中自己就一定拒绝**。
 *
 * ---------------------------------------------------------------------------
 * 七、写链路：prepare → submit → cancel（+ 查）
 * ---------------------------------------------------------------------------
 *
 * ```
 * 当前用户  GET  /sys/user/info                                 （表单的 baseData 'user-basic'）
 * 预览     POST /bpm/process-instance/preview                    （页面上是「查看审批流程」按钮）
 * prepare  POST /hr/overtime-application/getRequiredStartUserSelectTasks
 * submit   POST /hr/overtime-application/create                  body = 载荷 + startUserSelectAssignees
 * detail   GET  /hr/overtime-application/get?id=
 * 找实例    GET  /bpm/process-instance/my-page                     findInstanceByBusinessKey
 * cancel   DELETE /bpm/process-instance/cancel-by-start-user      body { id: <流程实例 id>, reason }
 * ```
 *
 * `cancel` 的 id **不是** `submit` 的返回值：`create` 返回**业务单据 id**；
 * `GET /hr/overtime-application/get` 的响应 VO 里**没有 `processInstanceId`**
 * （`OvertimeApplicationRespVO` 只到 status/statusName）。唯一的通路是「我的流程」，
 * 按 `businessKey` 对上——这正是页面上点「取消流程」时拿的那个 `record.id`。
 *
 * ---------------------------------------------------------------------------
 * 八、当前用户是谁：`GET /sys/user/info`，**必须白名单收敛**
 * ---------------------------------------------------------------------------
 *
 * 页面靠路由 meta 的 `baseData: ['user-basic']` 拿用户信息，落到
 * `utils/system.js` 的 `fetchSimpleUserBasic()` → `GET /sys/user/info`。
 * 【实测】那个响应里**含 `password2`（bcrypt 串）与 `salt`**。
 * ⇒ SDK 的这一条能力**逐字段白名单**，只回表单真正要的那几个，
 * 那两个字段连返回值里都不会出现（有测试钉住）。
 *
 * 顺带记一条：`GET /system/user/profile/get` 在这个 token 上报 500（实测），
 * 所以 `/sys/user/info` 是唯一可用的"我是谁"接口。
 *
 * ⚠️ **`id` 与 `organizationId` 是字符串**（实测 `"18243"` / `"101"`）。这不是笔误：
 * 页面直接 `formState.applicantId = userInfo.id`，**原样字符串发出去**，浏览器抓包里
 * 就是 `"applicantId":"18243"`。SDK 也发字符串（D20 要求逐字段一致）。
 *
 * ---------------------------------------------------------------------------
 * 九、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/042`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里一条都匹配不到，
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器同样不发
 * （baseline 里 `process-definition/get` 与 `preview` 的请求头都没有 `module-type`）。
 *
 * ---------------------------------------------------------------------------
 * 十、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **「重新发起」（reapply）没做**：`isReapply` 分支会从原流程实例抄字段再提交，
 *   是一条**另起的写链路**（`fetchDetail()` 里 `formState = {...result, id: null}`），
 *   需要单独验证。
 * - **`PUT /hr/overtime-application/update` 与 `DELETE .../delete/{id}` 没做**：
 *   后端源码里这两个**整个被注释掉了**（`OvertimeApplicationController:55-68`），
 *   页面上也没有入口。后端 `ServiceImpl` 里那两个方法还在（限 status=3 已驳回），
 *   但控制器不暴露 ⇒ **接口根本不存在**，谈不上"没做"。
 * - **打印**（详情页的「打印」按钮 → `/dashboard/flow/...` 的打印壳）没做：它是
 *   **只读的展示件**，不影响能不能提交；且它打的是通用打印页，不是本表单的能力。
 * - **`/hr/overtime-application/record/*`（加班记录分页/详情/剩余时长）没做**：
 *   那是**另一个页面**（考勤管理下的「加班记录」，`/dashboard/hr/attendance/attendance-overtime`），
 *   不是本流程表单的一部分。挂在 `/simple/hr/form/042` 下会张冠李戴。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与前几条线同一个壳） */
export const OVERTIME_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测】返回 `simple/hr/form/042`。
 */
export const OVERTIME_APPLICATION_FORM_PATH = '/simple/hr/form/042'

/**
 * 「我的流程」页。**取消流程的入口在这里**，不在表单页。
 *
 * ⚠️ 与表单页一样**不在 `page-catalog.json` 里**，不会把任何页面判成已完成。
 * 反过来，**不要**把任何能力挂到 `/dashboard/flow/task/create/list`（「发起流程」）——
 * 那一条**在**目录里，会把那个页面错误地标成已完成。
 */
export const OVERTIME_APPLICATION_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自表单入口 URL、`create-list`、以及后端 `OvertimeApplicationProcessInstanceVariableBuilder` */
export const OVERTIME_APPLICATION_PROCESS_KEY = 'hr_overtime_application'

/** 流程类型字典 `bpm_process_type`：**【实测】本流程是 2（审批）** */
export const OVERTIME_APPLICATION_PROCESS_TYPE = 2

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 042 的表单规则与后端校验注解）
// ---------------------------------------------------------------------------

/** `a-textarea` 的 `:maxlength="500"` + `formRules.reason` 的 `max: 500`（后端 `@Size(max = 500)`） */
export const REASON_MAX = 500

/** 时间字段的格式。页面 `value-format="YYYY-MM-DD HH:mm:ss"`，后端 `FORMAT_YEAR_MONTH_TO_SECOND` */
export const PORTAL_DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/**
 * 门户的时区。`applyDate` 是「今天」，而"今天"是**浏览器所在时区**的今天。
 *
 * 无头进程可能跑在 UTC 上（例如 CI），那时 `new Date()` 的日期会比中国早一天。
 * 写死一个常量而不是读进程时区，是为了让结果**可复现**——这也是页面行为本身：
 * 用户在 Portal 上填单，"今天"就是 Portal 那个时区的今天。
 */
export const PORTAL_TIME_ZONE = 'Asia/Shanghai'

/** 加班类型选项，逐条抄自 `042/page/common/define.js` 的 `OVERTIME_TYPE_OPTIONS` */
export const OVERTIME_TYPE_OPTIONS = [
  { value: 0, label: '工作日加班' },
  { value: 1, label: '法定节假日加班' },
  { value: 2, label: '休息日加班' },
] as const

/** 补贴类型选项，逐条抄自 `042/page/common/define.js` 的 `SUBSIDY_TYPE_OPTIONS` */
export const SUBSIDY_TYPE_OPTIONS = [
  { value: 0, label: '转调休' },
  { value: 1, label: '转补贴' },
  { value: 2, label: '后期自行统计' },
] as const

/** `042/page/pc/detail/index.vue` 的 `getRequiredStartUserSelectTasks` 后端路径（**没有 Temporary 变体**） */
export const OVERTIME_TASKS_URL = '/hr/overtime-application/getRequiredStartUserSelectTasks'

/** 单条单据的详情路径 */
export const OVERTIME_DETAIL_URL = '/hr/overtime-application/get'

/** 建单路径 */
export const OVERTIME_CREATE_URL = '/hr/overtime-application/create'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ProcessDefinition = {
  id: string
  key: string
  name: string
  version?: number
  formType?: number | null
  formCustomCreatePath?: string | null
  category?: string | null
  /** `bpmnXml` 里含真实的审批链（`userTask` 的 `candidateStrategy`），本能力用它核对审批人来源 */
  bpmnXml?: string | null
  /** ⚠️ 实测 5 个 key 里**一次都没出现过**，不要以为它有值 */
  startUserSelectTasks?: Array<{ id: string; name: string }> | null
  [key: string]: unknown
}

/**
 * 当前登录用户。**逐字段白名单**——`/sys/user/info` 原响应里含 `password2` 与 `salt`，
 * 那两个字段**不在这个类型里，也不会出现在返回值里**（有测试钉住）。
 *
 * ⚠️ `id` / `organizationId` / `staffId` / `postId` **都是字符串**，与接口原样一致 ——
 * 页面把它们**原样**塞进 `applicantId` / `applyDepartmentId` 发出去。
 */
export type PortalCurrentUser = {
  /** ★ 字符串（实测 `"18243"`）。载荷里 `applicantId` 发出去的就是它 */
  id: string
  /** `"18243"` 的数字形式。只用于比较（例如比对审批链里的 `candidateUsers[].id`） */
  numericId: number
  /** 姓名，载荷里 `applicantName` 发出去的就是它 */
  realName: string
  /** ★ 字符串（实测 `"101"`）。载荷里 `applyDepartmentId` 发出去的就是它 */
  organizationId: string
  /** 部门名，载荷里 `applyDepartmentName` 发出去的就是它 */
  organizationName: string
  username?: string
  staffId?: string
  organizationCode?: string
  postId?: string
  postName?: string
  tenantId?: string
}

/**
 * 提交 / prepare 的载荷 —— **只有 6 个字段是调用方给的**。
 *
 * 另外 6 个（applicantId / applicantName / applyDate / applyDepartmentId /
 * applyDepartmentName / overtimeHours）由 SDK 按页面的只读联动算出来，
 * **不接受调用方传**：页面上它们没有输入口。
 */
export type OvertimeApplicationDraft = {
  /** 加班事由，必填，≤500 字 */
  reason: string
  /** 加班类型：0=工作日加班，1=法定节假日加班，2=休息日加班。必填 */
  overtimeType: number
  /** 补贴类型：0=转调休，1=转补贴，2=后期自行统计。必填 */
  subsidyType: number
  /** 开始加班时间，`YYYY-MM-DD HH:mm:ss`。必填 */
  startTime: string
  /** 结束加班时间，`YYYY-MM-DD HH:mm:ss`。必填，**必须严格晚于 startTime** */
  endTime: string
  /** 中途休息时长（小时），必填，≥0。越界会让加班时长算成 0，被「不能为 0」那条拦下 */
  breakHours: number
}

/**
 * 只读联动算出来的字段。前 5 个来自 `GET /sys/user/info` + 当天日期，
 * 第 6 个（`overtimeHours`）由 SDK 按页面算法算。
 *
 * ⚠️ `overtimeHours` 是**可选**的，但**不是"可以不填"**：它表达的是
 * "给了就必须与算法一致，不给就不参与那条一致性检查"。SDK 自己产出时**总会**带上它
 * （`resolveDerivedFields()` 的返回类型是 `ResolvedOvertimeFields`，那个类型里它是必填）。
 * 之所以允许不填：页面上它是 `disabled` 的自动计算字段，调用方本来就没有地方能填对它，
 * 让它可选可以避免"我只是想校一下时间关系，却被迫先编一个加班时长"。
 */
export type OvertimeApplicationDerived = {
  applicantId: string
  applicantName: string
  applyDate: string
  applyDepartmentId: string
  applyDepartmentName: string
  overtimeHours?: number
}

/** `resolveDerivedFields()` / `prepare()` 真正产出的那一份：**6 个字段齐全** */
export type ResolvedOvertimeFields = OvertimeApplicationDerived & { overtimeHours: number }

/** 一个「发起人自选」审批人节点。本流程实测**没有**，类型保留是为了 prepare 的返回值可读 */
export type StartUserSelectTask = {
  id: string
  name: string
  approvalMode?: string
  executionMode?: string
  completionRule?: string
  minSelectCount?: number | null
  maxSelectCount?: number | null
  selectionOrderRequired?: boolean
  approvalDescription?: string
  [key: string]: unknown
}

/** `{ [节点 id]: [用户 id, ...] }`。本流程实测是 `{}` */
export type StartUserSelectAssignees = Record<string, number[]>

/** 审批链预览里的一个人 */
export type ApprovalChainUser = {
  id: number
  nickname?: string
  [key: string]: unknown
}

/** 审批链预览里的一个节点（`POST /bpm/process-instance/preview` 的 `nodes[]`） */
export type ApprovalChainNode = {
  nodeId: string
  name?: string | null
  /** `START_EVENT` / `USER_TASK` / `END_EVENT` … */
  type: string
  candidateStrategy?: number | null
  candidateStrategyName?: string | null
  candidateUsers?: ApprovalChainUser[]
  approvalMode?: string | null
  state?: string | null
  conditionDescription?: string | null
  copyUsers?: ApprovalChainUser[]
  [key: string]: unknown
}

/** 审批链预览的响应 */
export type ApprovalChainPreview = {
  processDefinitionId?: string | null
  processDefinitionKey?: string | null
  processDefinitionName?: string | null
  state?: string | null
  nodes: ApprovalChainNode[]
  copyUsers?: ApprovalChainUser[]
  [key: string]: unknown
}

/**
 * 「审批链里命中了发起人本人」的一处证据。
 *
 * 拿到它就说明**这次提交绝对不能发**：后端会以「发起人与审批人相同，自动审核通过」
 * 直接结束流程，`cancel` 再也撤不掉。
 */
export type SelfApprovalHit = {
  nodeId: string
  nodeName: string
  candidateStrategy?: number | null
  candidateStrategyName?: string | null
  user: ApprovalChainUser
}

/** `GET /hr/overtime-application/get` 的响应 */
export type OvertimeApplicationRecord = {
  id: number
  applicantId?: number | string
  applicantName?: string
  applyDepartmentId?: number | string
  applyDepartmentName?: string
  applyDate?: string
  reason?: string
  overtimeType?: number
  subsidyType?: number
  startTime?: string
  endTime?: string
  breakHours?: number
  overtimeHours?: number
  /** 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消 */
  status?: number
  /**
   * 状态名。⚠️ 与通用审批不同：**本流程这个字段后端真的填了**
   * （`OvertimeApplicationController.getApplication` 里按枚举 setStatusName）。
   */
  statusName?: string
  /**
   * ⚠️ **这个字段不存在**。`OvertimeApplicationRespVO` 里没有 `processInstanceId`
   * （虽然 DO 里有）。要流程实例 id 请走 `findInstanceByBusinessKey()`。
   */
  processInstanceId?: never
  [key: string]: unknown
}

/** 「我的流程」列表里的一行（`GET /bpm/process-instance/my-page`），只列本能力用得上的字段 */
export type ProcessInstanceRow = {
  /** **流程实例 id**，`cancel` 要的就是它 */
  id: string
  name?: string
  title?: string
  /** 1 = 审批中（页面上「取消流程」按钮出现的条件）；4 = 已取消 */
  status?: number
  /** 业务单据 id 的字符串形式 */
  businessKey?: string
  processDefinitionKey?: string
  startTime?: string
  endTime?: string
  startUser?: { id?: number; nickname?: string; [key: string]: unknown }
  [key: string]: unknown
}

export type OvertimeApplicationInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 工具：时间
// ---------------------------------------------------------------------------

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/**
 * 严格的 `YYYY-MM-DD HH:mm:ss` 解析，**按本地时区**（与 dayjs 的行为一致 —— 页面用的就是 dayjs）。
 *
 * 为什么要回读校验：`new Date(2026, 1, 30)` 会被静默进位成 3 月 2 日。
 * 静默进位意味着 SDK 会把一个没人填过的日期发出去，还查不出来。
 */
export function parsePortalDateTime (value: unknown, label: string): number {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 '${PORTAL_DATE_TIME_FORMAT}' 格式的字符串，收到 ${JSON.stringify(value)}`)
  }
  const match = DATE_TIME_RE.exec(value.trim())
  if (match === null) {
    throw new Error(
      `${label} 必须形如 '${PORTAL_DATE_TIME_FORMAT}'（页面 value-format 就是这么写的），收到 ${JSON.stringify(value)}`,
    )
  }
  const [, y, mo, d, h, mi, s] = match
  const parts = [y, mo, d, h, mi, s].map((part) => Number(part))
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number]
  const ms = new Date(year, month - 1, day, hour, minute, second).getTime()
  const back = new Date(ms)
  if (
    back.getFullYear() !== year ||
    back.getMonth() !== month - 1 ||
    back.getDate() !== day ||
    back.getHours() !== hour ||
    back.getMinutes() !== minute ||
    back.getSeconds() !== second
  ) {
    throw new Error(`${label} 不是一个真实存在的时刻：${JSON.stringify(value)}（例如 2 月没有 30 日）`)
  }
  return ms
}

/**
 * 「今天」，按门户所在时区（`Asia/Shanghai`）。
 *
 * 页面的 `initUserInfo()`：`const today = dayjs().format('YYYY-MM-DD')` ——
 * **申请时间是"今天"，不是加班那一天**（这两件事在页面上是两个字段）。
 */
export function portalToday (now: Date = new Date(), timeZone: string = PORTAL_TIME_ZONE): string {
  // en-CA 的短日期就是 YYYY-MM-DD，不用自己拼
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * 加班时长 = `max(0, 结束 - 开始 - 休息)`，保留 1 位小数。
 *
 * **逐行复刻** `042/page/pc/edit/index.vue:387-392`——包括 `toFixed(1)` 之后再
 * `parseFloat`（这会把 `3.0` 变成 `3`，与浏览器发出去的 JSON 一致）。
 */
export function calculateOvertimeHours (
  startTimeMs: number,
  endTimeMs: number,
  breakHours: number,
): number {
  const diffHours = (endTimeMs - startTimeMs) / (60 * 60 * 1000)
  const overtimeHours = Math.max(0, diffHours - breakHours)
  return parseFloat(overtimeHours.toFixed(1))
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

function assertEnumValue (value: unknown, options: ReadonlyArray<{ value: number; label: string }>, label: string): number {
  const allowed = options.map((o) => o.value)
  // 页面的 a-select 只可能产出这三个值；后端还有 @Min/@Max 兜一层
  if (typeof value !== 'number' || !Number.isFinite(value) || !allowed.includes(value)) {
    throw new Error(
      `${label} 只能是 ${options.map((o) => `${o.value}=${o.label}`).join('，')}，收到 ${JSON.stringify(value)}`,
    )
  }
  return value
}

function assertReason (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('加班事由 reason 必填（页面 formRules.reason required，后端 @NotBlank）')
  }
  if (value.length > REASON_MAX) {
    throw new Error(`加班事由最多 ${REASON_MAX} 个字，收到 ${value.length} 个`)
  }
  return value
}

function assertBreakHours (value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `中途休息时长 breakHours 必填且必须是数字（页面 a-input-number，后端 @NotNull @DecimalMin("0")），收到 ${JSON.stringify(value)}`,
    )
  }
  if (value < 0) {
    throw new Error(`中途休息时长不能小于 0（页面 :min="0"，后端 @DecimalMin("0")），收到 ${value}`)
  }
  return value
}

/**
 * 调用方填的那 6 个字段的**全部本地校验**，一次做完并返回归一后的值（含算出来的加班时长）。
 *
 * **为什么要单独抽出来**：`submit()` 里在打 `/sys/user/info` **之前**就要把这份草稿校完。
 * 否则一个 `reason` 为空的提交也会先发一次读请求——「本地校验不过 ⇒ 一个请求都不发」
 * 这条规矩就破了。
 */
export function normalizeOvertimeDraft (draft: OvertimeApplicationDraft): {
  reason: string
  overtimeType: number
  subsidyType: number
  startTime: string
  endTime: string
  breakHours: number
  overtimeHours: number
} {
  const reason = assertReason(draft?.reason)
  const overtimeType = assertEnumValue(draft?.overtimeType, OVERTIME_TYPE_OPTIONS, '加班类型 overtimeType')
  const subsidyType = assertEnumValue(draft?.subsidyType, SUBSIDY_TYPE_OPTIONS, '补贴类型 subsidyType')
  const startTime = typeof draft?.startTime === 'string' ? draft.startTime : String(draft?.startTime ?? '')
  const endTime = typeof draft?.endTime === 'string' ? draft.endTime : String(draft?.endTime ?? '')
  const startMs = parsePortalDateTime(startTime, '开始加班时间 startTime')
  const endMs = parsePortalDateTime(endTime, '结束加班时间 endTime')
  const breakHours = assertBreakHours(draft?.breakHours)

  // 后端 OvertimeApplicationServiceImpl.validateAndFillHours：`!endTime.isAfter(startTime)` 直接抛
  if (endMs <= startMs) {
    throw new Error(
      `结束加班时间必须晚于开始加班时间（后端 validateAndFillHours 的 !endTime.isAfter(startTime)）。` +
        `收到 ${startTime} → ${endTime}`,
    )
  }

  const overtimeHours = calculateOvertimeHours(startMs, endMs, breakHours)
  // 页面 formSubmit()：`if (!overtimeHours || overtimeHours === 0) { message.error('加班时长不能为0'); return }`
  // 这一条同时兜住了页面的 `:max="maxBreakHours"`（休息时长 > 总时长 ⇒ 算出来是 0）
  if (overtimeHours === 0) {
    throw new Error(
      '加班时长算出来是 0，页面会弹「加班时长不能为0」并拒绝提交。' +
        `${startTime} → ${endTime} 共 ${(endMs - startMs) / 3600000} 小时，扣掉休息 ${breakHours} 小时就没了` +
        '（休息时长的上限就是这一段的总时长，页面的 :max="maxBreakHours"）。',
    )
  }
  return { reason, overtimeType, subsidyType, startTime, endTime, breakHours, overtimeHours }
}

/**
 * 构造提交载荷 —— **逐字段复刻 `buildSubmitData()` 的产出**，
 * 键顺序照抄 `baseline/overtime-application.browser.json` 的「提交载荷」那一条。
 *
 * 这里的入参是「只读联动算出来的 6 个」+「调用方填的 6 个」，
 * 合起来就是页面 `formState` 的 12 个字段、按 formState 的声明顺序。
 */
export function buildOvertimeApplicationPayload (
  derived: OvertimeApplicationDerived,
  draft: OvertimeApplicationDraft,
): Record<string, unknown> {
  if (derived === null || typeof derived !== 'object') {
    throw new Error(
      '缺少只读联动的字段（applicantId / applicantName / applyDate / applyDepartmentId / applyDepartmentName）。' +
        '用 resolveDerivedFields() 或 prepare() 先算出来 —— 页面上这 5 项没有输入口，不能由调用方编。',
    )
  }
  for (const key of [
    'applicantId',
    'applicantName',
    'applyDate',
    'applyDepartmentId',
    'applyDepartmentName',
  ] as const) {
    const value = derived[key]
    if (value === undefined || value === null || String(value) === '') {
      throw new Error(`只读联动字段 ${key} 缺失。它来自 GET /sys/user/info，不能由调用方编。`)
    }
  }

  const normalized = normalizeOvertimeDraft(draft)
  if (
    derived.overtimeHours !== undefined &&
    derived.overtimeHours !== null &&
    derived.overtimeHours !== normalized.overtimeHours
  ) {
    throw new Error(
      `只读字段 overtimeHours 被改过：收到 ${derived.overtimeHours}，按页面算法应当是 ${normalized.overtimeHours}。` +
        '它是 a-input-number disabled 的自动计算字段，**不接受调用方给值**（后端也不重算，会错着入库）。',
    )
  }

  return {
    applicantId: derived.applicantId,
    applicantName: derived.applicantName,
    applyDate: derived.applyDate,
    applyDepartmentId: derived.applyDepartmentId,
    applyDepartmentName: derived.applyDepartmentName,
    reason: normalized.reason,
    overtimeType: normalized.overtimeType,
    subsidyType: normalized.subsidyType,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    breakHours: normalized.breakHours,
    overtimeHours: normalized.overtimeHours,
  }
}

/**
 * create 的完整请求体：`{...submitData, startUserSelectAssignees}`。
 *
 * 键顺序照抄 `042/page/pc/edit/index.vue:471` 的
 * `http.post('/admin-api/hr/overtime-application/create', { ...submitData, startUserSelectAssignees: tasksData })`
 * —— `startUserSelectAssignees` **永远在最后**。
 */
export function buildOvertimeApplicationCreatePayload (
  derived: OvertimeApplicationDerived,
  draft: OvertimeApplicationDraft,
  startUserSelectAssignees: StartUserSelectAssignees = {},
): Record<string, unknown> {
  if (startUserSelectAssignees === null || typeof startUserSelectAssignees !== 'object') {
    throw new Error('startUserSelectAssignees 必须是 { [节点 id]: [用户 id, ...] }（本流程实测是 {}）')
  }
  const normalized: StartUserSelectAssignees = {}
  for (const [taskId, ids] of Object.entries(startUserSelectAssignees)) {
    if (!Array.isArray(ids)) {
      throw new Error(`startUserSelectAssignees["${taskId}"] 必须是用户 id 数组`)
    }
    normalized[taskId] = ids.map((id, index) => {
      const value = Number(id)
      if (!Number.isFinite(value)) {
        throw new Error(`startUserSelectAssignees["${taskId}"][${index}] 不是数字：${JSON.stringify(id)}`)
      }
      return value
    })
  }
  return {
    ...buildOvertimeApplicationPayload(derived, draft),
    startUserSelectAssignees: normalized,
  }
}

/**
 * `prepare()` 拿到的节点与调用方给的审批人，做一个**覆盖性**检查。
 *
 * ⚠️ 这条分支在本流程上**是死的**：实测 `getRequiredStartUserSelectTasks` 恒返回 `[]`，
 * 也就是永远不会有节点。它存在是为了**将来流程被改成带自选节点时不静默出错**：
 * 那时后端会因为「发起人自选审批人不能为空」拒掉整条提交，本地先红一次更省事。
 *
 * **没有**复刻通用审批那条线的四条规则（min/max/去重/非空）——那条线是实测有节点、
 * 逐条对着后端源码写的；本流程没有节点，写一套没在真实环境跑过的规则就是**没验证的代码**。
 * 这里只做一件事：**节点有没有被覆盖**。人数合法性交给后端如实报错。
 */
export function assertTasksCovered (
  tasks: readonly StartUserSelectTask[],
  assignees: StartUserSelectAssignees,
): void {
  for (const task of tasks ?? []) {
    const picked = assignees?.[task.id]
    if (!Array.isArray(picked) || picked.length === 0) {
      throw new Error(
        `审批人节点「${task.name || task.id}」没有选人。后端会以「发起人自选审批人不能为空」拒绝整条提交。` +
          `本流程实测是 0 个节点（getRequiredStartUserSelectTasks 返回 []），` +
          `现在返回了节点 ⇒ 流程被改过，请先核对 prepare() 的返回再提交。`,
      )
    }
  }
  const taskIds = new Set((tasks ?? []).map((t) => t.id))
  for (const passed of Object.keys(assignees ?? {})) {
    if (!taskIds.has(passed)) {
      throw new Error(
        `startUserSelectAssignees 里的 "${passed}" 不是本次的审批人节点 ` +
          `（本次节点：${taskIds.size === 0 ? '一个都没有' : [...taskIds].join(', ')}）。` +
          '本流程实测没有自选节点，正常情况下应当传 {}。',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 当前用户（白名单）
// ---------------------------------------------------------------------------

/**
 * `/sys/user/info` 里**允许**出现在返回值里的字段。
 *
 * 白名单而不是黑名单：那个响应里含 `password2`（bcrypt 串）与 `salt`，
 * 黑名单法一旦后端加了新字段就会漏出去。**有没有测试钉住**见
 * `test/overtime-application.test.ts` 的「当前用户白名单」一节。
 */
const CURRENT_USER_ALLOWED_FIELDS = [
  'id',
  'username',
  'realName',
  'organizationId',
  'organizationName',
  'organizationCode',
  'staffId',
  'postId',
  'postName',
  'tenantId',
] as const

/**
 * 把 `/sys/user/info` 的原响应收敛成 `PortalCurrentUser`。
 *
 * **只保留白名单里的字段**，其余一律丢掉（包括 `password2` / `salt`）。
 * 导出来是为了让这条收敛本身可测 —— 不用真的打接口就能验证"密码哈希不会漏出去"。
 */
export function pickCurrentUser (raw: unknown): PortalCurrentUser {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('当前用户信息为空：GET /sys/user/info 没返回对象，无法填申请人/申请部门')
  }
  const source = raw as Record<string, unknown>
  const text = (key: string): string | undefined => {
    const value = source[key]
    return value === undefined || value === null ? undefined : String(value)
  }
  const id = text('id')
  const organizationId = text('organizationId')
  const realName = text('realName')
  if (id === undefined) {
    throw new Error('GET /sys/user/info 的响应里没有 id，无法填申请人')
  }
  if (organizationId === undefined) {
    throw new Error('GET /sys/user/info 的响应里没有 organizationId，无法填申请部门')
  }
  const picked: PortalCurrentUser = {
    id,
    numericId: Number(id),
    realName: realName ?? '',
    organizationId,
    organizationName: text('organizationName') ?? '',
  }
  for (const key of CURRENT_USER_ALLOWED_FIELDS) {
    if (key === 'id' || key === 'realName' || key === 'organizationId' || key === 'organizationName') continue
    const value = text(key)
    if (value !== undefined) (picked as Record<string, unknown>)[key] = value
  }
  return picked
}

// ---------------------------------------------------------------------------
// 审批链守卫
// ---------------------------------------------------------------------------

/**
 * 在审批链里找**发起人本人**。返回每一处命中（节点 + 人）。
 *
 * 只看 `type === 'USER_TASK'` 的节点：`START_EVENT` / `END_EVENT` 没有 `candidateUsers`，
 * 拿它们去比是自找噪音。
 */
export function findSelfInApprovalChain (
  preview: ApprovalChainPreview | null | undefined,
  selfUserId: number,
): SelfApprovalHit[] {
  const hits: SelfApprovalHit[] = []
  if (preview === null || preview === undefined) return hits
  for (const node of preview.nodes ?? []) {
    if (node?.type !== 'USER_TASK') continue
    for (const user of node.candidateUsers ?? []) {
      if (Number(user?.id) === Number(selfUserId)) {
        hits.push({
          nodeId: node.nodeId,
          nodeName: node.name ?? node.nodeId,
          candidateStrategy: node.candidateStrategy,
          candidateStrategyName: node.candidateStrategyName,
          user,
        })
      }
    }
  }
  return hits
}

/**
 * ★ 提交前的硬守卫：审批链里**不能有发起人本人**。
 *
 * 命中时的后果是**不可逆**的：后端「流程发起人与审批人相同，自动审核通过」会当场结束流程，
 * `cancel-by-start-user` 从此永远报「流程不处于运行中」，那条单据撤不掉、也删不掉
 * （后端 `deleteApplication` 只允许 status=3 已驳回）。测试环境里已经因此留了 3 条。
 *
 * 所以这里是 **throw**，不是 `console.warn`。
 */
export function assertNotSelfApprover (
  preview: ApprovalChainPreview | null | undefined,
  selfUserId: number,
): void {
  const hits = findSelfInApprovalChain(preview, selfUserId)
  if (hits.length === 0) return
  const detail = hits
    .map(
      (hit) =>
        `节点「${hit.nodeName}」（${hit.nodeId}，candidateStrategy=${hit.candidateStrategy ?? '?'}` +
        `${hit.candidateStrategyName ? `=${hit.candidateStrategyName}` : ''}）的候选人是 ${hit.user?.nickname ?? ''}(${hit.user?.id})`,
    )
    .join('；')
  throw new Error(
    `★ 审批链里出现了发起人本人（userId=${selfUserId}）：${detail}。` +
      '**这次提交绝对不能发**：后端有一条「流程发起人与审批人相同，自动审核通过」，' +
      '流程会当场走完，接下来 cancel-by-start-user 必然报「流程取消失败，流程不处于运行中」——' +
      '那条单据就永远撤不掉了。' +
      '处理办法：换一个申请人（本流程的申请人是"当前登录用户"，SDK 从 GET /sys/user/info 取，' +
      '不接受调用方指定），或者换一个账号跑这条流程。',
  )
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/**
 * ★ 这一段**故意没有 `search` 类的长选项参数**。
 *
 * 通用审批那条线要 `user-search`，是因为它有「抄送人」与「发起人自选审批人」两个人员控件。
 * 本表单**两个都没有**（页面上真的没有），审批人由后端按「直属上级」算。
 * 加一个用不到的 `user-search` 能力 = 凭空多一条没人会调、也没法在页面上对上的接口。
 */

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'reason',
    kind: 'text',
    required: true,
    description: `加班事由，必填，最多 ${REASON_MAX} 字（页面 a-textarea :maxlength + 后端 @Size(max=500)）`,
  },
  {
    name: 'overtimeType',
    kind: 'enum',
    required: true,
    description: '加班类型，必填（页面 a-select，无默认值）',
    options: OVERTIME_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'subsidyType',
    kind: 'enum',
    required: true,
    description: '补贴类型，必填（页面 a-select，无默认值）',
    options: SUBSIDY_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'startTime',
    kind: 'date',
    required: true,
    description:
      `开始加班时间，必填，\`${PORTAL_DATE_TIME_FORMAT}\`。页面 value-format 就是它，` +
      '且**分钟/秒只能是 00**（handleStartTimeChange 里 .minute(0).second(0)）；SDK 不强制这条，' +
      '但发一个非整点的时间是页面上做不出来的输入',
  },
  {
    name: 'endTime',
    kind: 'date',
    required: true,
    description:
      `结束加班时间，必填，\`${PORTAL_DATE_TIME_FORMAT}\`，**必须严格晚于 startTime**` +
      '（后端 validateAndFillHours 的 !endTime.isAfter(startTime)）',
  },
  {
    name: 'breakHours',
    kind: 'number',
    required: true,
    description:
      '中途休息时长（小时），必填，≥0。页面上限是「结束-开始」的总小时数（:max="maxBreakHours"）；' +
      '越界会让加班时长算成 0，被「加班时长不能为0」那条拦下',
  },
]

export const overtimeApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'overtime-application-definition',
    title: '查询加班审批的流程定义',
    pagePath: OVERTIME_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${OVERTIME_APPLICATION_PROCESS_KEY}`,
        options: [{ label: '加班审批', value: OVERTIME_APPLICATION_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'overtime-application-current-user',
    title: '查当前登录用户（申请人 / 申请部门那几个只读字段的来源）',
    pagePath: OVERTIME_APPLICATION_FORM_PATH,
    write: false,
    params: [],
  },
  {
    id: 'overtime-application-approval-chain',
    title: '★ 提交前预览审批链 —— 看清会打扰谁、以及会不会撞上「发起人=审批人」',
    pagePath: OVERTIME_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS.map((param) => ({ ...param, required: false })),
  },
  {
    id: 'overtime-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点（本流程实测 0 个）',
    pagePath: OVERTIME_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'overtime-application-submit',
    title: '提交加班申请（会真的发起流程、给直属上级推待办）',
    pagePath: OVERTIME_APPLICATION_FORM_PATH,
    write: true,
    params: [
      ...DRAFT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'text',
        required: false,
        description:
          '{ [节点 id]: [用户 id, ...] }。**本流程实测没有自选审批人节点，正常应当留空（或传 {}）**；' +
          '审批人由后端按 BpmTaskCandidateStrategyEnum.DIRECT_LEADER(23)「直属上级」自动算出来。' +
          '给了非空值而 prepare 又返回 0 个节点 ⇒ 本地直接拒绝（避免发一个语义不明的载荷）',
      },
      {
        name: 'skipSelfApprovalGuard',
        kind: 'boolean',
        required: false,
        description:
          '⚠️ 关掉「审批链里不能有发起人本人」这条硬守卫。**只在预览接口本身不可用时才该用**：' +
          '命中时的后果不可逆（流程当场走完、单据永远撤不掉）。默认 false（守卫开着）',
      },
    ],
  },
  {
    id: 'overtime-application-detail',
    title: '查询单条加班申请单据',
    pagePath: OVERTIME_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有流程实例 id** —— ' +
          '要取消得先 overtime-application-my-instances 按 businessKey 找流程实例',
      },
    ],
  },
  {
    id: 'overtime-application-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: OVERTIME_APPLICATION_MY_LIST_PATH,
    write: false,
    params: [
      { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
      { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
      {
        name: 'status',
        kind: 'enum',
        required: false,
        description: '流程状态；1 = 审批中（页面上「取消流程」按钮出现的条件），4 = 已取消',
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
        description: `流程类型字典 bpm_process_type；本流程是 ${OVERTIME_APPLICATION_PROCESS_TYPE}（审批）`,
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'overtime-application-cancel',
    title: '取消（撤回）我发起的加班审批流程',
    pagePath: OVERTIME_APPLICATION_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 overtime-application-my-instances 那一行的 id',
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
          '取消原因。**必填且不能是空串** —— 后端 `BpmProcessInstanceCancelReqVO.reason` 是 @NotEmpty',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type OvertimeApplicationOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条） */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
  /** 注入"现在"。只影响 `applyDate`（"今天"），测试用来钉住日期 */
  now?: () => Date
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

/** 提交时的可选项 */
export type OvertimeApplicationSubmitOptions = {
  /** `{ [节点 id]: [用户 id, ...] }`。本流程实测没有自选节点，正常留空 */
  startUserSelectAssignees?: StartUserSelectAssignees
  /** ⚠️ 关掉「审批链里不能有发起人本人」的守卫。只在预览接口不可用时才该用 */
  skipSelfApprovalGuard?: boolean
}

export function createOvertimeApplicationCapability (
  request: PortalRequest,
  options: OvertimeApplicationOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE
  const now = options.now ?? (() => new Date())

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: OvertimeApplicationInstanceQuery = {},
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
   * 当前登录用户（**只读**）。页面靠它填申请人 / 申请部门那 5 个只读字段。
   *
   * ⚠️ 响应已经过 `pickCurrentUser()` 白名单收敛：原接口里的 `password2` / `salt`
   * **不会**出现在这个方法的返回值里。
   */
  async function currentUser (): Promise<PortalCurrentUser> {
    const raw = await request<Record<string, unknown>>({ url: '/sys/user/info', method: 'get' })
    return pickCurrentUser(raw)
  }

  /** 审批链预览（**只读**）。页面上的「查看审批流程」按钮打的就是它 */
  async function approvalChain (
    variables: Record<string, unknown> = {},
    startUserSelectAssignees: StartUserSelectAssignees = {},
  ): Promise<ApprovalChainPreview> {
    const result = await request<ApprovalChainPreview>({
      url: '/bpm/process-instance/preview',
      method: 'post',
      data: {
        processDefinitionKey: OVERTIME_APPLICATION_PROCESS_KEY,
        variables,
        startUserSelectAssignees,
        copyUserIds: [],
      },
    })
    // 后端在「流程定义不存在」时可能回 null；归一成空 nodes，免得调用方对 undefined 取 .nodes
    return { ...(result ?? {}), nodes: Array.isArray(result?.nodes) ? result.nodes : [] } as ApprovalChainPreview
  }

  /**
   * 把只读联动的那 6 个字段算出来（**只读**，会打一次 `/sys/user/info`）。
   *
   * 这是 `prepare` / `submit` 的第一步，也单独暴露出去，方便调用方在提交前先看一眼
   * 「加班时长会算成多少」——那个值页面上是 disabled 的，用户改不了，但看得见。
   */
  async function resolveDerivedFields (
    draft: Pick<OvertimeApplicationDraft, 'startTime' | 'endTime' | 'breakHours'>,
  ): Promise<ResolvedOvertimeFields> {
    const user = await currentUser()
    const startMs = parsePortalDateTime(draft?.startTime, '开始加班时间 startTime')
    const endMs = parsePortalDateTime(draft?.endTime, '结束加班时间 endTime')
    const breakHours = assertBreakHours(draft?.breakHours)
    return {
      applicantId: user.id,
      applicantName: user.realName,
      applyDate: portalToday(now()),
      applyDepartmentId: user.organizationId,
      applyDepartmentName: user.organizationName,
      overtimeHours: calculateOvertimeHours(startMs, endMs, breakHours),
    }
  }

  /**
   * 按 `businessKey` 找它对应的流程实例。
   *
   * **为什么必须存在这个方法**：`cancel-by-start-user` 要流程实例 id，而
   * `GET /hr/overtime-application/get` 的响应里**没有** `processInstanceId`。
   * 唯一的通路就是翻「我的流程」，用 `businessKey` 对上——这正是页面上点
   * 「取消流程」时拿的那个 `record.id`。
   *
   * **为什么还要按 `processDefinitionKey` 再筛一道**：`businessKey` 是各业务表**自己的主键**
   * （后端 `setBusinessKey(String.valueOf(application.getId()))`），「加班申请 51」与
   * 「会议室预定 51」会撞成同一个字符串。只按 businessKey 匹配会认错单子。
   * ⚠️ 不用 `processType` 过滤：它区分不开同为 `processType=2` 的那些流程，
   * 而且在请求里加一个页面从不发的过滤参数会白白偏离 D20 的逐字段一致。
   */
  async function findInstanceByBusinessKey (businessKey: number | string): Promise<ProcessInstanceRow> {
    const wanted = String(businessKey ?? '').trim()
    if (wanted === '') throw new Error('businessKey 不能为空')
    for (let page = 1; page <= maxScanPages; page += 1) {
      const result = await myInstances({ pageNo: page, pageSize: scanPageSize })
      const list = result?.list ?? []
      const hit = list.find(
        (row) =>
          String(row.businessKey) === wanted &&
          // 有的返回行不带 processDefinitionKey，那就只能按 businessKey 认（如实放行，
          // 不去猜一个"肯定不是它"的结论）
          (row.processDefinitionKey === undefined ||
            row.processDefinitionKey === OVERTIME_APPLICATION_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的加班审批流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 overtime-application-my-instances 自己按条件找。',
    )
  }

  /**
   * `prepare()` 的实现体。抽成闭包里的函数而不是对象方法，
   * 是为了让 `submit()` 能调它而**不依赖 `this`**——组装点可能把方法摘下来单独调
   * （`const { prepare } = cap`），那时 `this` 是 undefined。
   */
  async function prepareInternal (
    draft: OvertimeApplicationDraft,
    derivedOverride?: ResolvedOvertimeFields,
  ): Promise<{
    payload: Record<string, unknown>
    derived: ResolvedOvertimeFields
    tasks: StartUserSelectTask[]
  }> {
    // ★ 先把调用方填的 6 个字段校完（含加班时长为 0 那条）——**在校任何网络请求之前**。
    // 不这么做的话，一个 reason 为空的提交也会先打一次 /sys/user/info。
    const normalized = normalizeOvertimeDraft(draft)
    const derived =
      derivedOverride ??
      (await resolveDerivedFields({
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        breakHours: normalized.breakHours,
      }))
    const payload = buildOvertimeApplicationPayload(derived, draft)
    const tasks = await request<StartUserSelectTask[]>({
      url: OVERTIME_TASKS_URL,
      method: 'post',
      data: payload,
    })
    return { payload, derived, tasks: Array.isArray(tasks) ? tasks : [] }
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 */
    definition (key: string = OVERTIME_APPLICATION_PROCESS_KEY): Promise<ProcessDefinition> {
      return request<ProcessDefinition>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    currentUser,

    approvalChain,

    resolveDerivedFields,

    /** 在审批链里找发起人本人（**纯函数**，不发请求） */
    findSelfInApprovalChain,

    /**
     * 提交前准备（**只读**）：算出这次需要人工指定哪些审批人节点 + 算好载荷。
     *
     * ⚠️ 页面在字段不全时**不发请求**；这里也一样 —— 载荷构造（`buildOvertimeApplicationPayload`）
     * 会把 6 个字段连同时间关系一次校完，任何一条不过就在发请求之前抛。
     *
     * 与通用审批那条线的一个**实测差异**：本流程的这个接口**要收完整载荷**
     * （`@Valid @RequestBody`，传 `{}` 会被打回「结束加班时间不能为空」），
     * 而那条线的后端把请求体整个忽略。所以这里的 `payload` 不是"顺手带上的"，是**必需的**。
     */
    prepare: prepareInternal,

    /**
     * 真正提交（**写操作**）：创建单据**并起一条 `hr_overtime_application` 审批流**。
     *
     * ⚠️ 它会**给真人（你的直属上级）推待办、可能发短信**。测试请：
     *   1. 事由带 `SDK-TEST-` 前缀；
     *   2. 测完立刻用 `cancel()` 撤掉。
     *
     * 请求顺序（写操作只有最后那一条）：
     *
     * ```
     * ① getRequiredStartUserSelectTasks   页面 formSubmit() 的第一步
     * ② process-instance/preview          ★ SDK 加的守卫（页面上这一步是用户点按钮才发生的）
     * ③ create                            写
     * ```
     *
     * 守卫放在 ③ 之前而不是更早，是为了保持页面上 ①→③ 的相对顺序不变；
     * 它只加一次**只读**请求，却能把"单据永远撤不掉"这件事挡在写之前。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）。⚠️ 这不是流程实例 id，
     * 撤销要先用 `findInstanceByBusinessKey()` 换。
     */
    async submit (
      draft: OvertimeApplicationDraft,
      submitOptions: OvertimeApplicationSubmitOptions = {},
    ): Promise<unknown> {
      // ① + 本地校验：载荷构造会把 6 个字段与时间关系一次校完；不过就在发请求之前抛
      const { payload, derived, tasks } = await prepareInternal(draft)
      const assignees = submitOptions?.startUserSelectAssignees ?? {}
      assertTasksCovered(tasks, assignees)

      // ② ★ 守卫：审批链里不能有发起人本人。
      // 发起人的 id 就来自 ① 里那份 derived（applicantId 是 `/sys/user/info` 的 id 原样），
      // 所以这里**不用再打一次** currentUser()。
      if (submitOptions?.skipSelfApprovalGuard !== true) {
        const preview = await approvalChain(payload)
        assertNotSelfApprover(preview, Number(derived.applicantId))
      }

      // ③ 写
      return request({
        url: OVERTIME_CREATE_URL,
        method: 'post',
        data: { ...buildOvertimeApplicationCreatePayload(derived, draft, assignees) },
      })
    },

    /** 单条单据详情（**只读**）。⚠️ 响应里没有流程实例 id，见 `OvertimeApplicationRecord` */
    detail (id: number | string): Promise<OvertimeApplicationRecord> {
      const wanted = String(id ?? '').trim()
      if (wanted === '') throw new Error('加班申请单据 id 不能为空')
      return request<OvertimeApplicationRecord>({
        url: OVERTIME_DETAIL_URL,
        method: 'get',
        params: { id: wanted },
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
     * 只有 `status === 1`（审批中）的单据能取消。已经走完/已驳回的再取消，后端会如实报错
     * 「流程取消失败，流程不处于运行中」，SDK **不做预检查、也不吞错**——
     * 但**正常路径下不该走到那一步**：`submit` 的守卫已经保证审批人不是发起人本人。
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
      let id =
        params?.processInstanceId === undefined || params.processInstanceId === null
          ? ''
          : String(params.processInstanceId).trim()
      if (id === '') {
        if (params?.businessKey === undefined || params.businessKey === null) {
          return Promise.reject(
            new Error(
              'cancel 需要 processInstanceId 或 businessKey 其中之一：' +
                'processInstanceId 来自 overtime-application-my-instances，' +
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

export type OvertimeApplicationCapability = ReturnType<typeof createOvertimeApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与前面几条线同样的分工：`withIdempotency` 需要**身份**（租户 / 用户），
 * 那是会话层的东西，所以包装放在组装点。
 *
 * **为什么这一条也需要防重**：后端零幂等，重发一次就是**第二条流程实例 + 第二串真人待办**。
 * 而且本流程的审批人是系统算出来的直属上级——发重了，打扰的是同一个人两次。
 */
export type OvertimeApplicationCapabilityWithIdempotency = OvertimeApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * `requestId` 由调用方生成并保管，超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: OvertimeApplicationDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
      skipSelfApprovalGuard?: boolean
    },
  ) => Promise<unknown>
}
