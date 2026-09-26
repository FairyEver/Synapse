import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 调休申请（`hr_rest_leave_application`）—— 流程表单这一类的第七条线，
 * **「加班申请」的孪生流程**（同一族 HR 日常单子，`hr/form/042` / `043`）。
 *
 * 页面：`/simple/hr/form/043`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=hr_rest_leave_application&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/043
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）。
 *
 * 模板是**加班申请那条线**（`src/capabilities/overtime-application.ts`，孪生流程）——
 * **只读它，不改**。能复用的是四条：文件骨架、只读联动、审批链守卫（§五）、
 * 写链路的 prepare → submit → detail → my-instances → cancel。
 *
 * 它与加班那条线**不是同构**，四处形态差异写在第 §零 节。
 *
 * ---------------------------------------------------------------------------
 * 零、与「加班申请」那条线的形态差异（**先看这张表**）
 * ---------------------------------------------------------------------------
 *
 * | | 加班（042） | 调休（043，本能力） |
 * | --- | --- | --- |
 * | 必填字段数 | 6 个用户填 | **2 个**（事由 + 明细行） |
 * | 明细行数组 | **没有** | **有**（`leaveDateItems`，可增删，页面上默认 1 行） |
 * | 附件控件 | **没有** | **有**（拖拽上传，≤10 件） |
 * | 只读字段 | 加班时长（**前端算**） | 调休时长（前端算）+ **剩余加班时长（要打接口）** |
 * | 时间粒度 | `YYYY-MM-DD HH:mm:ss`（两个时刻） | `YYYY-MM-DD`（一行一个日期）+ 小时数 |
 * | 后端是否重算 | **不重算**，前端算错就错着入库 | **重算**（见 §三，本流程反过来） |
 * | 提交硬门槛 | 加班时长不能为 0 | **调休时长 ≤ 剩余加班时长**（后端算的，见 §三） |
 * | 审批链 | 直属上级（strategy=23），无自选节点 | **一样**（实测同一条路） |
 *
 * 【实测 2026-09-21，`GET /bpm/process-definition/create-list` 两个 processType 都拉】
 *
 * | key | 名称 | processType | formCustomCreatePath |
 * | --- | --- | --- | --- |
 * | `hr_rest_leave_application` | 调休审批 | **2（审批）** | `simple/hr/form/043` |
 *
 * `processType=1`（审核）的「人力」分类里**没有**这一条——两型都拉过，不是没查。
 * 与 `docs/process-forms.md` §1.4 的记录**一致**（那张表把「审核/审批」列标错过一次，
 * 先例是产品设计文档审核；本条复核后无误）。
 *
 * ⚠️ 两个容易看错的返回值细节（实测）：
 * - `create-list` 的结构是 `[{name, processDefinitionList: [...]}, ...]` —— **不是 `children`**。
 *   按 `children` 取会得到 0 个节点，看起来像"这个流程不存在"。
 * - 单条 `POST /bpm/process-instance/preview` 需要
 *   `{processDefinitionKey, variables, startUserSelectAssignees, copyUserIds}` 五个键（见 §六）。
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：**接口里没有，只在前端源码与真实页面里**
 * ---------------------------------------------------------------------------
 *
 * 【实测】`GET /bpm/process-definition/get?key=hr_rest_leave_application` 返回
 * `formFields: null`、`formCustomCreatePath: null`。所以字段只能读：
 *
 * - `app/portal/views/simple/hr/form/043/page/pc/edit/index.vue`（模板 + 校验 + 联动）
 * - `app/portal/views/simple/hr/form/043/page/mobile/edit/index.vue`（**同样的字段**，控件换成 vant）
 * - `app/portal/views/simple/hr/form/043/page/common/define.js`（请假类型的选项）
 * - 后端 `RestLeaveApplicationController` / `RestLeaveApplicationSaveReqVO` /
 *   `RestLeaveDateItemVO` / `RestLeaveApplicationServiceImpl`
 *
 * 真实页面抓的载荷见 `baseline/rest-leave-application.browser.json`：**12 个字段，一个不多一个不少**。
 *
 * 本表单特有的取基准路子（与加班那条线一样）：页面上那个 `portal-hxr-flow-process-preview`
 * 会把 `resolvePreviewVariables()`（= `buildSubmitData()` = `{ ...formState.value }`）塞进
 * `POST /bpm/process-instance/preview` 的 `variables`。所以**点那个只读按钮**就能抓到一份
 * 逐字节等于提交载荷的东西，**不必真的点「提交」**。
 *
 * ---------------------------------------------------------------------------
 * 二、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面 label | 字段 | 形态 | 谁产生 | SDK |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | （隐藏） | `id` | —— | 新建时恒 `null` | 自动（恒 null） |
 * | 2 | 姓名 | `applicantName` | **只读文本** | `initUserInfo()` 取用户 store | 自动 |
 * | 3 | （隐藏） | `userId` | —— | 同上，取 `userInfo.id` | 自动 |
 * | 4 | 工号 | `staffCode` | **只读文本** | 同上，取 `userInfo.username` | 自动 |
 * | 5 | （隐藏） | `departmentId` | —— | 同上，取 `userInfo.organizationId` | 自动 |
 * | 6 | 部门 | `departmentName` | **只读文本** | 同上，取 `userInfo.organizationName` | 自动 |
 * | 7 | 请假类型 | `leaveType` | **只读文本**（只有「调休」一个选项） | `LEAVE_TYPE_REST = 0`，恒 0 | 自动（恒 0） |
 * | 8 | 剩余加班时长 | `remainingOvertimeHours` | **只读文本** | `tryPrefillRemainingOvertimeHours()` 打接口 | 自动（**打接口取，见 §四**） |
 * | 9 | 请假事由 | `reason` | `a-textarea`，`:maxlength="200"` | 用户填，必填 | **`reason`** |
 * | 10 | 请假时间 | `leaveDateItems` | **明细行数组**（日期 + 时长 + 添加/删除） | 用户填，必备 ≥1 行 | **`leaveDateItems`** |
 * | 11 | （调休时长） | `leaveHours` | **只读文本**（跨行合计） | `watch(totalLeaveHours)` 算出 | 自动（算出来） |
 * | 12 | 附件 | `attachments` | `common-upload-dragger`，≤10 件 | 用户传，可选 | **`attachments`** |
 * | — | 「查看审批流程」 | —— | 只读按钮 | —— | **做了**（§五，且它是本能力的安全守卫） |
 *
 * ⇒ **12 个字段全部表达**。2/3/4/5/6/7/8/11 是**只读联动**：页面上没有输入口，用户改不了，
 * 所以 SDK 也不把它们做成参数（做成参数就等于承认"用户可以填一个页面上改不了的值"）。
 * 调用方真正能给的只有 **3 个**：`reason` / `leaveDateItems` / `attachments`。
 *
 * 请假类型只有一个选项 `0=调休`，且后端 `fillLeaveTypeDefaults()`：
 * `if (leaveType == null) setLeaveType(0); if (leaveType != 0) throw「请假类型必须为调休」`。
 * 页面上它是只读文本，**换不了**，所以 SDK 也不做成参数。
 *
 * ---------------------------------------------------------------------------
 * 三、★ 后端**重算**两个字段，还有一个**硬门槛**（与加班那条线正好相反）
 * ---------------------------------------------------------------------------
 *
 * 加班那条线是"前端算、后端不重算，算错就错着入库"。**本流程是反过来的**：
 *
 * ```java
 * // RestLeaveApplicationServiceImpl.createApplication()
 * LeaveSummary leaveSummary = calculateLeaveSummary(createReqVO);   // ← 按明细行重算
 * createReqVO.setLeaveHours(leaveSummary.getTotalLeaveHours());     // ← 覆盖调用方给的值
 *
 * BigDecimal remainingOvertimeHours = calculateRemainingOvertimeHours(createReqVO.getStaffCode());
 * if (leaveSummary.getTotalLeaveHours().compareTo(remainingOvertimeHours) > 0) {
 *     throw exception("调休时长不能大于剩余加班时长");                  // ★ 硬门槛
 * }
 * createReqVO.setRemainingOvertimeHours(remainingOvertimeHours);    // ← 也覆盖
 * ```
 *
 * 逐条说清这意味着什么：
 *
 * 1. **`leaveHours` 与 `remainingOvertimeHours` 都由后端重算**，调用方给什么都不作数。
 *    SDK 仍然把它们**照页面的值发出去**（D20 逐字段一致），但要如实标注它们是只读的。
 * 2. **`leaveHours` 是明细行的合计**：`sum(各行 setScale(2, HALF_UP))` 再 `setScale(2, HALF_UP)`
 *    —— 与页面那个 `Number(sum.toFixed(1))` 在"每行最多 1 位小数"的输入下**必然相等**
 *    （见 `calculateLeaveHours()` 的注释与测试）。
 * 3. ★ **「调休时长不能大于剩余加班时长」是后端算的，SDK 本地复刻不了**：
 *    后端那个值（`calculateRemainingOvertimeHours(staffCode)`）与页面上显示的那个值
 *    （`GET /hr/overtime-application/record/remaining-hours?userId=`）是**两套不同的算法**：
 *
 *    | | 页面显示的那个 | 后端 create 门槛用的那个 |
 *    | --- | --- | --- |
 *    | 出处 | `OvertimeApplicationServiceImpl.getRemainingOvertimeHours` | `RestLeaveApplicationServiceImpl.calculateRemainingOvertimeHours` |
 *    | 加班侧口径 | `subsidyType=0` 且 `status=已审批`，**不限年份** | `subsidyType=0` 且 `status=已审批`，**限当年** |
 *    | 调休侧口径 | `status in (1 审批中, 2 已审批)`，**不限年份** | `status = 2 已审批`，**限当年** |
 *
 *    ⇒ **两者可以不等**（有跨年单据时就分叉）。所以 SDK **不拿页面那个值当本地门槛**：
 *    那样既可能放过去（页面值 > 门槛值），也可能冤枉拦下（页面值 < 门槛值）。
 *    如实做法是把页面那个值当作**只读展示字段**照发，门槛交给后端如实报错。
 *    失败时的报错原文就是「调休时长不能大于剩余加班时长」（有测试钉住这句）。
 *
 * 另外三条校验（本地做，逐条来自页面或后端）：
 * - `reason` 必填且 ≤200（页面 `:maxlength="200"` + `formRules.reason` 的 `max:200`）。
 *   ⚠️ 后端是 `@Size(max = 500)` —— **页面比后端严**，SDK 按**页面**那个 200 拦。
 * - 明细行**至少一行**、每行 `leaveDate` 非空且是真实存在的 `YYYY-MM-DD`、
 *   每行 `leaveHours` 有限且 **> 0**（页面 `validateLeaveDateItems()` 三条 + 后端
 *   `@NotEmpty` / `@NotNull` / `@DecimalMin("0.01")`）。
 * - 附件的条数与扩展名（页面 `:max="10"` + `accept=".pdf, .jpg, .jpeg, .png"`）。
 *
 * ---------------------------------------------------------------------------
 * 四、只读联动：调休时长怎么算、剩余加班时长从哪来
 * ---------------------------------------------------------------------------
 *
 * **调休时长**（`043/page/pc/edit/index.vue:190-208` 与 mobile 的同名 computed）：
 *
 * ```js
 * const sum = items.reduce((acc, row) => {
 *   const v = Number(row?.leaveHours)
 *   return acc + (Number.isFinite(v) ? v : 0)
 * }, 0)
 * return Number(sum.toFixed(1))
 * // 然后 watch(totalLeaveHours, (val) => { formState.value.leaveHours = val })
 * ```
 *
 * **剩余加班时长**（页面 `tryPrefillRemainingOvertimeHours()`，`onMounted` 里调）：
 *
 * ```
 * GET /hr/overtime-application/record/remaining-hours?userId=<当前用户 id>
 * ```
 *
 * ⚠️ 它挂在 **`overtime-application`** 这个 controller 下（不是 `rest-leave-application`）——
 * 不是笔误，是后端就这么放的（`OvertimeApplicationController:126`）。这条接口**是调休表单
 * 自己要用的**，所以收在本能力里（挂在 `/simple/hr/form/043` 下），**不**另开一个页面能力。
 *
 * ⚠️ 页面在 `userId` 取到之前也会发这个请求（`onMounted` 里 `initUserInfo()` 与它同一批），
 * 实测抓到的那一条是 `userId=18243`。SDK 把它做成一个**独立的只读能力**
 * （`rest-leave-application-remaining-hours`），因为它是一个真实存在、可单独调用的读接口。
 *
 * ---------------------------------------------------------------------------
 * 五、★ 审批链：与加班那条线**形态相同**（同一条守卫，照抄）
 * ---------------------------------------------------------------------------
 *
 * 【实测 2026-09-21】
 *
 * ```
 * POST /hr/rest-leave-application/getRequiredStartUserSelectTasks   body = 完整载荷
 * → { "code": 0, "ret": "SUCCESS", "data": [] }        ← 一个自选节点都没有
 * 同一个接口传 {} → 400「请求参数不正确:请假事由不能为空」  ← 它要收完整载荷（@Valid @RequestBody）
 * ```
 *
 * `GET /bpm/process-definition/get` 的 `bpmnXml` 里：
 *
 * ```xml
 * <userTask id="Activity_1ee4c6r" name="直属上级审批"
 *           flowable:candidateStrategy="23" flowable:candidateParam="__placeholder__"/>
 * ```
 *
 * `23 = BpmTaskCandidateStrategyEnum.DIRECT_LEADER（直属上级）`——审批人是后端按发起人所在组织
 * **算出来**的，不是发起人选的。实测 `POST /bpm/process-instance/preview` 的返回：
 * `USER_TASK 直属上级审批 [strategy=23] → 乔娜(15012)`，发起人是 18243 ⇒ 不是同一人 ⇒ 放行。
 *
 * ⇒ **照抄加班那条线的硬守卫**（§五 的理由与边界与那条线完全一致）：
 *
 * ```
 * POST /bpm/process-instance/preview   body {processDefinitionKey, variables: <本次载荷>, ...}
 *   → nodes[].type === 'USER_TASK' 的 candidateUsers[] 里逐个比对发起人 id
 *   → 命中 ⇒ **在 create 之前**抛错，一个写请求都不发
 * ```
 *
 * **为什么必须有这条**：后端 `BpmTaskServiceImpl` 有一条「流程发起人与审批人相同，自动审核通过」。
 * 一旦命中，流程**当场走完**，`cancel-by-start-user` 必然报「流程取消失败，流程不处于运行中」，
 * 那条单据就**永远撤不掉**（测试环境里已经因此留了 3 条撤不掉的单据，本轮一条都没碰）。
 *
 * ⚠️ 守卫的**逃生口**：`skipSelfApprovalGuard: true`。只在**预览接口本身不可用**时才该用。
 * 默认关着（守卫开着）。理由与加班那条线一样：宁可让调用方显式承认"我知道自己在冒险"，
 * 也不要静默放过去。
 *
 * ⚠️ **已如实记下的边界**：这条守卫**不能证明**审批人最终一定是预览里那个人。
 * 预览是"按当前数据算一遍"，真实办理时后端会拿当时的组织数据再算一次。
 * SDK 能保证的是：**预览时命中自己就一定拒绝**。
 *
 * ---------------------------------------------------------------------------
 * 六、写链路：prepare → submit → cancel（+ 查）
 * ---------------------------------------------------------------------------
 *
 * ```
 * 当前用户  GET  /sys/user/info                                 （表单的 baseData 'user-basic'）
 * 剩余时长  GET  /hr/overtime-application/record/remaining-hours?userId=
 * 预览     POST /bpm/process-instance/preview                    （页面上是「查看审批流程」按钮）
 * prepare  POST /hr/rest-leave-application/getRequiredStartUserSelectTasks
 * submit   POST /hr/rest-leave-application/create                body = 载荷 + startUserSelectAssignees
 * detail   GET  /hr/rest-leave-application/get?id=
 * 找实例    GET  /bpm/process-instance/my-page                     findInstanceByBusinessKey
 * cancel   DELETE /bpm/process-instance/cancel-by-start-user      body { id: <流程实例 id>, reason }
 * ```
 *
 * ⚠️ `preview` 的请求体是**五个键**（实测抓包，`baseline/rest-leave-application.browser.json`）：
 *
 * ```json
 * {"processDefinitionKey":"hr_rest_leave_application","variables":{...12 个字段...},
 *  "startUserSelectAssignees":{},"copyUserIds":[]}
 * ```
 *
 * `cancel` 的 id **不是** `submit` 的返回值：`create` 返回**业务单据 id**；
 * `GET /hr/rest-leave-application/get` 的响应 VO 里**没有 `processInstanceId`**
 * （`RestLeaveApplicationRespVO` 只到 status/statusName，虽然 DO 里有 `processInstanceId`）。
 * 唯一的通路是「我的流程」，按 `businessKey` 对上——这正是页面上点「取消流程」时拿的那个 `record.id`。
 *
 * ---------------------------------------------------------------------------
 * 七、当前用户是谁：`GET /sys/user/info`，**必须白名单收敛**
 * ---------------------------------------------------------------------------
 *
 * 【实测】那个响应里**含 `password2`（bcrypt 串）与 `salt`**。
 * ⇒ SDK 的这一条能力**逐字段白名单**，只回表单真正要的那几个，
 * 那两个字段连返回值里都不会出现（有测试钉住）。
 *
 * ⚠️ **`id` / `organizationId` / `username` / `staffId` 都是字符串**（实测 `"18243"` / `"101"` /
 * `"2021070101"` / `"1163"`）。这不是笔误：页面直接
 * `formState.userId = userInfo.id`，**原样字符串发出去**，浏览器抓包里就是 `"userId":"18243"`。
 * SDK 也发字符串（D20 要求逐字段一致）。这三个与本表单的字段名对应关系是：
 *
 * | 表单字段 | 来源 | 实测值 |
 * | --- | --- | --- |
 * | `applicantName` | `realName` | `"姚淼鑫"` |
 * | `userId` | `id` | `"18243"` |
 * | `staffCode` | `username`（**工号就是 username**） | `"2021070101"` |
 * | `departmentId` | `organizationId` | `"101"` |
 * | `departmentName` | `organizationName` | `"设计中心1236"` |
 *
 * ---------------------------------------------------------------------------
 * 八、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/043`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里一条都匹配不到，
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器同样不发
 * （baseline 里 `process-definition/get`、`record/remaining-hours`、`preview`
 * 三条请求的请求头都没有 `module-type`）。
 *
 * ---------------------------------------------------------------------------
 * 九、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **「重新发起」（reapply）没做**：与加班那条线一样，`isReapply` 分支会从原流程实例
 *   抄字段再提交（`fetchDetail()` 里 `formState = {...result, id: null}`），是一条**另起的写链路**。
 * - **`PUT /hr/rest-leave-application/update` 与 `DELETE .../delete/{id}` 没做**：
 *   与加班那条线**不同**——本流程这两个接口**后端是真的开着的**（控制器里没有注释掉），
 *   但**页面上的入口在编辑/详情分支**（只在「已驳回」时出现，见 §十）。本能力做的是
 *   用户日常那条路（新建 → 提交 → 撤销），驳回后改单重提属于**另一条写链路**，没验证过就不写。
 * - **打印**（详情页的「打印」按钮）没做：只读的展示件，打的是通用打印壳，不影响能不能提交。
 * - **`/hr/rest-leave-application/page`（分页）与 `/hr/overtime-application/record/*`
 *   里其余几个接口没做**：前者是**另一个列表页**，后者属于「加班记录」页面，不是本流程表单的一部分。
 *   （`record/remaining-hours` 是例外，见 §四——**本表单自己要用它**，所以收了。）
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与前几条线同一个壳） */
export const REST_LEAVE_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测】返回 `simple/hr/form/043`。
 */
export const REST_LEAVE_APPLICATION_FORM_PATH = '/simple/hr/form/043'

/**
 * 「我的流程」页。**取消流程的入口在这里**，不在表单页。
 *
 * ⚠️ 与表单页一样**不在 `page-catalog.json` 里**，不会把任何页面判成已完成。
 * 反过来，**不要**把任何能力挂到 `/dashboard/flow/task/create/list`（「发起流程」）——
 * 那一条**在**目录里，会把那个页面错误地标成已完成。
 */
export const REST_LEAVE_APPLICATION_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自表单入口 URL、`create-list`、后端 `RestLeaveApplicationProcessInstanceVariableBuilder.PROCESS_DEFINITION_KEY` */
export const REST_LEAVE_APPLICATION_PROCESS_KEY = 'hr_rest_leave_application'

/** 流程类型字典 `bpm_process_type`：**【实测】本流程是 2（审批）** */
export const REST_LEAVE_APPLICATION_PROCESS_TYPE = 2

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 043 的表单规则与后端校验注解）
// ---------------------------------------------------------------------------

/**
 * `a-textarea` 的 `:maxlength="200"` + `formRules.reason` 的 `max: 200`。
 *
 * ⚠️ 后端是 `@Size(max = 500)`（`RestLeaveApplicationSaveReqVO.reason`）——**后端比页面松**。
 * SDK 按**页面**那个 200 拦：页面上打不出第 201 个字，SDK 也不该收。
 */
export const REASON_MAX = 200

/** 后端 `@Size(max = 500)`。只用于在报错信息里说明"后端其实更松"，**不作为判据** */
export const REASON_MAX_BACKEND = 500

/** 明细行里每个日期的格式。页面 `value-format="YYYY-MM-DD"`，后端 `LocalDate` */
export const PORTAL_DATE_FORMAT = 'YYYY-MM-DD'

/** 明细行的最少行数（页面默认就有 1 行，删到 0 行时 `validateLeaveDateItems` 报「请填写请假时间」） */
export const LEAVE_DATE_ITEMS_MIN = 1

/**
 * 每行时长的小数位。页面 `a-input-number :precision="1"`，移动端 `van-stepper step="0.1"
 * :decimal-length="1"`——**两端一致，所以这是页面的硬约束**。
 */
export const LEAVE_HOURS_PRECISION = 1

/** 行内时长必须 **> 0**（页面「请在请假时间中填写大于0的时长」；后端 `@DecimalMin("0.01")`） */
export const LEAVE_HOURS_MIN_EXCLUSIVE = 0

/** `common-upload-dragger` 的 `:max="10"` */
export const ATTACHMENT_MAX_COUNT = 10

/** 页面 `beforeFileUpload` 里的 50MB 上限（**本地无法校验**：SDK 手上只有 url 与 name） */
export const ATTACHMENT_MAX_SIZE_MB = 50

/**
 * 附件扩展名白名单，逐条抄自 `043` 的 `common-upload-dragger accept=".pdf, .jpg, .jpeg, .png"`
 * 与 `beforeFileUpload` 里的 mime 白名单 `['application/pdf','image/jpeg','image/png']`（两处一致）。
 *
 * ⚠️ **比 `base-upload-file` 的 `SAFE_EXTENSIONS` 窄得多**：上传能力收的是"能安全拼进
 * objectKey 的扩展名"，这里收的是"这个表单收哪几种文件"。两者**不是一回事**，谁也不要抄谁。
 */
export const ATTACHMENT_ACCEPT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const

/** 附件的 OSS 目录（`common/utils/oss.js:57` 的 `ossFilePathOptions.hr.approval`） */
export const ATTACHMENT_OSS_FOLDER = 'HR/approval'

/** 请假类型选项，逐条抄自 `043/page/common/define.js` 的 `LEAVE_TYPE_OPTIONS`（**只有一项**） */
export const LEAVE_TYPE_OPTIONS = [{ value: 0, label: '调休' }] as const

/** 请假类型的固定值。后端 `fillLeaveTypeDefaults()`：不是 0 就抛「请假类型必须为调休」 */
export const LEAVE_TYPE_REST = 0

/** 自选审批人节点查询路径（**没有 Temporary 变体**，与加班那条线一样） */
export const REST_LEAVE_TASKS_URL = '/hr/rest-leave-application/getRequiredStartUserSelectTasks'

/** 单条单据的详情路径 */
export const REST_LEAVE_DETAIL_URL = '/hr/rest-leave-application/get'

/** 建单路径 */
export const REST_LEAVE_CREATE_URL = '/hr/rest-leave-application/create'

/**
 * 剩余加班时长（**页面「剩余加班时长」那一格的数据源**）。
 *
 * ⚠️ 它挂在 `overtime-application` 这个 controller 下，**不是** `rest-leave-application` ——
 * 后端就是这么放的（`OvertimeApplicationController:126`）。见文件头 §四。
 */
export const REMAINING_OVERTIME_HOURS_URL = '/hr/overtime-application/record/remaining-hours'

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
 * ⚠️ `id` / `organizationId` / `username` / `staffId` **都是字符串**，与接口原样一致 ——
 * 页面把它们**原样**塞进 `userId` / `departmentId` / `staffCode` 发出去。
 */
export type PortalCurrentUser = {
  /** ★ 字符串（实测 `"18243"`）。载荷里 `userId` 发出去的就是它 */
  id: string
  /** `"18243"` 的数字形式。只用于比较（例如比对审批链里的 `candidateUsers[].id`） */
  numericId: number
  /** 姓名，载荷里 `applicantName` 发出去的就是它 */
  realName: string
  /** ★ 字符串（实测 `"101"`）。载荷里 `departmentId` 发出去的就是它 */
  organizationId: string
  /** 部门名，载荷里 `departmentName` 发出去的就是它 */
  organizationName: string
  /** ★ 工号。载荷里 `staffCode` 发出去的就是它（**工号就是 `username`，不是 `staffId`**） */
  username?: string
  staffId?: string
  organizationCode?: string
  postId?: string
  postName?: string
  tenantId?: string
}

/** 明细行里的**一行**：一个日期 + 这一段的小时数 */
export type RestLeaveDateItemDraft = {
  /** 请假日期，`YYYY-MM-DD`。必填，且必须是真实存在的日期 */
  leaveDate: string
  /** 本条请假时长（小时）。必填，**> 0**，最多 1 位小数 */
  leaveHours: number
}

/**
 * 表单里的一件附件。**形状就是页面 `onFileUploadDone()` 往 `formState.attachments` 里推的那个对象**：
 * `{id: 0, name, url, size, pages}`。
 *
 * ⚠️ 只有 `url` 是**调用方必须给**的；其余四项 SDK 会补默认值（与页面 `file.size || 0` 一致）。
 * `id` 后端**完全不用**（`OssResourceApiImpl.saveFile` 忽略它、一律 insert 新行），
 * 保留它只是为了与页面的键集合逐字段一致。
 */
export type RestLeaveApplicationAttachment = {
  /** OSS 地址。用 `base-upload-file` / `sdk.baseUpload.upload()` 先传（目录 `HR/approval`） */
  url: string
  /** 文件名（含扩展名）。可省；`accept` 白名单按它判 */
  name?: string
  /** 字节数。可省（页面 `file.size || 0`） */
  size?: number
  /** PDF 页数。可省（页面 `file.pages || 0`） */
  pages?: number
  [key: string]: unknown
}

/**
 * 提交 / prepare 的载荷 —— **只有 3 个字段是调用方给的**。
 *
 * 另外 9 个（id / applicantName / userId / staffCode / departmentId / departmentName /
 * leaveType / remainingOvertimeHours / leaveHours）由 SDK 按页面的只读联动算出来或查出来，
 * **不接受调用方传**：页面上它们没有输入口。
 */
export type RestLeaveApplicationDraft = {
  /** 请假事由，必填，≤200 字（页面 `:maxlength` + `formRules.reason`） */
  reason: string
  /** 请假时间明细，**至少一行**；每行 `leaveDate` 非空、`leaveHours` > 0 且最多 1 位小数 */
  leaveDateItems: RestLeaveDateItemDraft[]
  /** 附件，可选，≤10 件。`url` 用 `base-upload-file` / `sdk.baseUpload.upload()` 先传 */
  attachments?: RestLeaveApplicationAttachment[]
}

/**
 * 只读联动算出来 / 查出来的字段。前 6 个来自 `GET /sys/user/info`，`leaveType` 是常量，
 * 后两个（`leaveHours` / `remainingOvertimeHours`）一个算、一个查（见文件头 §四）。
 *
 * ⚠️ `leaveHours` 与 `remainingOvertimeHours` 是**可选**的，但**不是"可以不填"**：
 * 它们表达的是"给了就必须与页面/接口一致，不给就不参与那条一致性检查"。
 * SDK 自己产出时**总会**带上它们（`resolveDerivedFields()` 的返回类型里两个都是必填）。
 */
export type RestLeaveApplicationDerived = {
  applicantName: string
  /** ★ 字符串（实测 `"18243"`），与 `/sys/user/info` 的 `id` 逐字段一致 */
  userId: string
  /** ★ 字符串（实测 `"2021070101"`），来自 `/sys/user/info` 的 `username` */
  staffCode: string
  /** ★ 字符串（实测 `"101"`） */
  departmentId: string
  departmentName: string
  /** 恒 0（调休）。后端 `fillLeaveTypeDefaults()` 只认 0 */
  leaveType: number
  /** 明细行的合计小时数（页面那个只读的「调休时长」） */
  leaveHours?: number
  /** 页面「剩余加班时长」那一格（`GET /hr/overtime-application/record/remaining-hours`） */
  remainingOvertimeHours?: number
}

/** `resolveDerivedFields()` / `prepare()` 真正产出的那一份：**9 个字段齐全** */
export type ResolvedRestLeaveFields = RestLeaveApplicationDerived & {
  leaveHours: number
  remainingOvertimeHours: number
}

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

/** `GET /hr/rest-leave-application/get` 的响应 */
export type RestLeaveApplicationRecord = {
  id: number
  applicantName?: string
  staffCode?: string
  departmentId?: number | string
  departmentName?: string
  leaveType?: number
  remainingOvertimeHours?: number | string
  reason?: string
  /** 后端由明细行的最早/最晚日期汇总出来（调用方不用给） */
  startDate?: string
  endDate?: string
  leaveHours?: number | string
  /** 明细行（后端按 `leaveDate` 升序返回） */
  leaveDateItems?: RestLeaveDateItemDraft[]
  /** 附件（后端从 `attachmentIds` 里解出来） */
  attachments?: RestLeaveApplicationAttachment[]
  /** 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消 */
  status?: number
  /**
   * 状态名。⚠️ 与通用审批不同：**本流程这个字段后端真的填了**
   * （`RestLeaveApplicationController.getApplication` 里按枚举 setStatusName）。
   */
  statusName?: string
  /**
   * ⚠️ **这个字段不存在**。`RestLeaveApplicationRespVO` 里没有 `processInstanceId`
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

export type RestLeaveInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 工具：日期
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 严格的 `YYYY-MM-DD` 解析，**按本地时区**（与 dayjs 的行为一致 —— 页面用的就是 dayjs）。
 *
 * 为什么要回读校验：`new Date(2026, 1, 30)` 会被静默进位成 3 月 2 日。
 * 静默进位意味着 SDK 会把一个没人填过的日期发出去，还查不出来。
 */
export function parseRestLeaveDate (value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 '${PORTAL_DATE_FORMAT}' 格式的字符串，收到 ${JSON.stringify(value)}`)
  }
  const text = value.trim()
  const match = DATE_RE.exec(text)
  if (match === null) {
    throw new Error(
      `${label} 必须形如 '${PORTAL_DATE_FORMAT}'（页面 value-format 就是这么写的），收到 ${JSON.stringify(value)}`,
    )
  }
  const [, y, mo, d] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const back = new Date(year, month - 1, day)
  if (back.getFullYear() !== year || back.getMonth() !== month - 1 || back.getDate() !== day) {
    throw new Error(`${label} 不是一个真实存在的日期：${JSON.stringify(value)}（例如 2 月没有 30 日）`)
  }
  return text
}

/**
 * 明细行的合计 —— **逐行复刻** `043/page/pc/edit/index.vue:190-197` 的 `totalLeaveHours`：
 *
 * ```js
 * const sum = items.reduce((acc, row) => {
 *   const v = Number(row?.leaveHours)
 *   return acc + (Number.isFinite(v) ? v : 0)
 * }, 0)
 * return Number(sum.toFixed(1))
 * ```
 *
 * ⚠️ 这个函数**只在每一行都通过校验之后才该被调用**（SDK 就是这么用的：非法行会先抛）。
 * 因为页面那个 `Number.isFinite(v) ? v : 0` 是给**正在输入中**的行兜底的
 * （`a-input-number` 清空时 `leaveHours` 是 `null`），而那种行在 `formSubmit()` 里
 * 会被 `validateLeaveDateItems()` 拦下、根本走不到提交。
 */
export function calculateLeaveHours (items: ReadonlyArray<{ leaveHours?: unknown }>): number {
  const sum = items.reduce((acc, row) => {
    const value = Number(row?.leaveHours)
    return acc + (Number.isFinite(value) ? value : 0)
  }, 0)
  return Number(sum.toFixed(1))
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

function assertReason (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('请假事由 reason 必填（页面 formRules.reason required，后端 @NotBlank）')
  }
  if (value.length > REASON_MAX) {
    throw new Error(
      `请假事由最多 ${REASON_MAX} 个字，收到 ${value.length} 个（页面 :maxlength="${REASON_MAX}" + formRules.reason 的 max:${REASON_MAX}）。` +
        `⚠️ 后端 @Size(max = ${REASON_MAX_BACKEND}) 比页面松，但页面上打不出第 ${REASON_MAX + 1} 个字。`,
    )
  }
  return value
}

function assertLeaveDateItem (raw: unknown, index: number): RestLeaveDateItemDraft {
  const at = `明细行[${index}]`
  const item = raw as { leaveDate?: unknown; leaveHours?: unknown } | null
  if (item === null || typeof item !== 'object') {
    throw new Error(`${at} 必须是 { leaveDate, leaveHours } 对象，收到 ${JSON.stringify(raw)}`)
  }
  const leaveDate = parseRestLeaveDate(item.leaveDate, `${at} 的请假日期 leaveDate`)
  const hours = Number(item.leaveHours)
  if (!Number.isFinite(hours)) {
    throw new Error(
      `${at} 的时长 leaveHours 必填且必须是数字（页面 a-input-number，后端 @NotNull），` +
        `收到 ${JSON.stringify(item.leaveHours)}`,
    )
  }
  if (hours <= LEAVE_HOURS_MIN_EXCLUSIVE) {
    throw new Error(
      `${at} 的时长必须大于 0（页面「请在请假时间中填写大于0的时长」，后端 @DecimalMin("0.01")），收到 ${hours}`,
    )
  }
  // 页面 a-input-number 的 :precision="1"（移动端 van-stepper 的 :decimal-length="1"）——
  // 两端一致，所以这是页面的硬约束，不是 SDK 自己发明的。
  //
  // 判据用「乘 10 之后是不是整数」而不是「字符串点后面有几位」：后者在
  // `1e-7` 这种科学计数法上会算成 0 位而放过去（`String(1e-7)` 里根本没有点号）。
  // 容差 1e-9 是为了让 `0.3`（`0.3*10 === 2.9999999999999996`）正常通过。
  const scaled = hours * 10
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    throw new Error(
      `${at} 的时长最多 ${LEAVE_HOURS_PRECISION} 位小数（页面 a-input-number :precision="1"），收到 ${hours}`,
    )
  }
  return { leaveDate, leaveHours: hours }
}

/**
 * 明细行校验 —— 逐条抄页面的 `validateLeaveDateItems()`（三条）与后端的注解：
 *
 * | 判据 | 页面 | 后端 |
 * | --- | --- | --- |
 * | 数组非空 | `items.length === 0` → 「请填写请假时间」 | `@NotEmpty(message = "请假时间明细不能为空")` |
 * | 每行有日期 | 「请在请假时间中选择日期」 | `@NotNull(message = "请假日期不能为空")` |
 * | 每行时长 > 0 | 「请在请假时间中填写大于0的时长」 | `@DecimalMin("0.01")` + Service 里 `<= 0` 抛「请假时长必须大于0」 |
 */
export function assertLeaveDateItems (items: unknown): RestLeaveDateItemDraft[] {
  if (!Array.isArray(items)) {
    throw new Error('leaveDateItems 必须是数组（页面上一行一个 {leaveDate, leaveHours}）')
  }
  if (items.length < LEAVE_DATE_ITEMS_MIN) {
    throw new Error(
      `请假时间明细至少 ${LEAVE_DATE_ITEMS_MIN} 行（页面「请填写请假时间」，后端 @NotEmpty）。` +
        '页面上默认就有一行，删到 0 行时校验过不去',
    )
  }
  return items.map((raw, index) => assertLeaveDateItem(raw, index))
}

/**
 * 附件校验：**只做页面真会拦的那两条的一部分**。
 *
 * - 条数 ≤10：页面的 `:max="10"` 会拦 → SDK 也拦。
 * - 扩展名：页面的 `accept=".pdf, .jpg, .jpeg, .png"` → SDK 也拦（按 `name` 判；
 *   **没有扩展名时放行**，因为页面上传的文件未必都带名字）。
 * - **50MB 大小上限不拦**：SDK 手上只有 url/name（`size` 是调用方给的、可以随便编），
 *   拿它当判据等于自己骗自己。与其猜，不如把这条如实留给后端。
 *
 * 返回值的**键与键顺序**逐字段复刻页面 `onFileUploadDone()`：
 * `{id: 0, name, url, size, pages}`。
 */
export function assertAttachments (attachments: unknown): Array<Record<string, unknown>> {
  if (attachments === undefined || attachments === null) return []
  if (!Array.isArray(attachments)) {
    throw new Error('attachments 必须是数组（页面上是 [{id, name, url, size, pages}]，最多 10 件）')
  }
  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new Error(`附件最多 ${ATTACHMENT_MAX_COUNT} 件，收到 ${attachments.length} 件（页面 :max="10"）`)
  }
  return attachments.map((raw, index) => {
    const item = raw as { url?: unknown; name?: unknown; size?: unknown; pages?: unknown } | null
    const url = item?.url
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(
        `第 ${index + 1} 件附件缺 url。url 要用 base-upload-file 或 sdk.baseUpload.upload() ` +
          `先传到 OSS（目录 ${ATTACHMENT_OSS_FOLDER}）`,
      )
    }
    const name = typeof item?.name === 'string' ? item.name : ''
    const dot = name.lastIndexOf('.')
    if (dot > -1 && dot < name.length - 1) {
      const ext = name.slice(dot + 1).toLowerCase()
      if (!(ATTACHMENT_ACCEPT_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(
          `第 ${index + 1} 件附件的扩展名 .${ext} 不在本表单的 accept 白名单里：` +
            ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' '),
        )
      }
    }
    // 键与键顺序逐字段复刻 onFileUploadDone() 推出去的那个对象。
    // `id` 后端完全不用（OssResourceApiImpl.saveFile 一律 insert 新行），保留只为逐字段一致。
    const size = Number(item?.size)
    const pages = Number(item?.pages)
    return {
      id: 0,
      name,
      url,
      size: Number.isFinite(size) ? size : 0,
      pages: Number.isFinite(pages) ? pages : 0,
    }
  })
}

/**
 * 调用方填的那 3 个字段的**全部本地校验**，一次做完并返回归一后的值（含算出来的调休时长）。
 *
 * **为什么要单独抽出来**：`submit()` 里在打 `/sys/user/info` **之前**就要把这份草稿校完。
 * 否则一个 `reason` 为空的提交也会先发一次读请求——「本地校验不过 ⇒ 一个请求都不发」
 * 这条规矩就破了。
 */
export function normalizeRestLeaveDraft (draft: RestLeaveApplicationDraft): {
  reason: string
  leaveDateItems: RestLeaveDateItemDraft[]
  attachments: Array<Record<string, unknown>>
  leaveHours: number
} {
  const reason = assertReason(draft?.reason)
  const leaveDateItems = assertLeaveDateItems(draft?.leaveDateItems)
  const attachments = assertAttachments(draft?.attachments)
  return { reason, leaveDateItems, attachments, leaveHours: calculateLeaveHours(leaveDateItems) }
}

/**
 * 构造提交载荷 —— **逐字段复刻 `buildSubmitData()` 的产出**，
 * 键顺序照抄 `baseline/rest-leave-application.browser.json` 的 `variables` 那一层
 * （实测抓包，与 `formState` 的声明顺序一致）。
 *
 * 这里的入参是「只读联动算出来的 9 个」+「调用方填的 3 个」，合起来就是页面
 * `formState` 的 12 个字段。
 */
export function buildRestLeaveApplicationPayload (
  derived: RestLeaveApplicationDerived,
  draft: RestLeaveApplicationDraft,
): Record<string, unknown> {
  if (derived === null || typeof derived !== 'object') {
    throw new Error(
      '缺少只读联动的字段（applicantName / userId / staffCode / departmentId / departmentName / leaveType）。' +
        '用 resolveDerivedFields() 或 prepare() 先算出来 —— 页面上这几项没有输入口，不能由调用方编。',
    )
  }
  for (const key of ['applicantName', 'userId', 'staffCode', 'departmentId', 'departmentName'] as const) {
    const value = derived[key]
    if (value === undefined || value === null || String(value) === '') {
      throw new Error(`只读联动字段 ${key} 缺失。它来自 GET /sys/user/info，不能由调用方编。`)
    }
  }
  if (derived.leaveType !== LEAVE_TYPE_REST) {
    throw new Error(
      `只读字段 leaveType 只能是 ${LEAVE_TYPE_REST}（调休）。页面上它是只读文本，` +
        `后端 fillLeaveTypeDefaults() 也抛「请假类型必须为调休」，收到 ${JSON.stringify(derived.leaveType)}`,
    )
  }

  const normalized = normalizeRestLeaveDraft(draft)

  if (
    derived.leaveHours !== undefined &&
    derived.leaveHours !== null &&
    Number(derived.leaveHours) !== normalized.leaveHours
  ) {
    throw new Error(
      `只读字段 leaveHours 被改过：收到 ${derived.leaveHours}，按页面算法应当是 ${normalized.leaveHours}` +
        `（明细行合计）。页面上它是一个只读文本，**不接受调用方给值**。`,
    )
  }
  if (
    derived.remainingOvertimeHours !== undefined &&
    derived.remainingOvertimeHours !== null &&
    !Number.isFinite(Number(derived.remainingOvertimeHours))
  ) {
    throw new Error(
      `只读字段 remainingOvertimeHours 必须是数字：收到 ${JSON.stringify(derived.remainingOvertimeHours)}。` +
        '它来自 GET /hr/overtime-application/record/remaining-hours，**不接受调用方编**。',
    )
  }

  // 键顺序 = formState 的声明顺序（= 实测抓包里 variables 的键顺序）
  return {
    id: null,
    applicantName: derived.applicantName,
    userId: derived.userId,
    staffCode: derived.staffCode,
    departmentId: derived.departmentId,
    departmentName: derived.departmentName,
    leaveType: derived.leaveType,
    remainingOvertimeHours: derived.remainingOvertimeHours ?? 0,
    reason: normalized.reason,
    leaveDateItems: normalized.leaveDateItems.map((row) => ({
      id: null,
      leaveDate: row.leaveDate,
      leaveHours: row.leaveHours,
    })),
    leaveHours: normalized.leaveHours,
    attachments: normalized.attachments,
  }
}

/**
 * create 的完整请求体：`{...submitData, startUserSelectAssignees}`。
 *
 * 键顺序照抄 `043/page/pc/edit/index.vue:349-352` 的
 * `http.post('/admin-api/hr/rest-leave-application/create', { ...submitData, startUserSelectAssignees: tasksData })`
 * —— `startUserSelectAssignees` **永远在最后**。
 */
export function buildRestLeaveApplicationCreatePayload (
  derived: RestLeaveApplicationDerived,
  draft: RestLeaveApplicationDraft,
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
    ...buildRestLeaveApplicationPayload(derived, draft),
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
 * 黑名单法一旦后端加了新字段就会漏出去。**有测试钉住**。
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
    throw new Error('当前用户信息为空：GET /sys/user/info 没返回对象，无法填姓名/工号/部门')
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
    throw new Error('GET /sys/user/info 的响应里没有 id，无法填 userId')
  }
  if (organizationId === undefined) {
    throw new Error('GET /sys/user/info 的响应里没有 organizationId，无法填 departmentId')
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
// 审批链守卫（**与加班那条线同一份实现**，逐行照抄）
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
 * 本表单**两个都没有**（页面上真的没有：姓名/工号/部门都是只读文本，审批人由后端按「直属上级」算）。
 * 加一个用不到的 `user-search` 能力 = 凭空多一条没人会调、也没法在页面上对上的接口。
 */

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'reason',
    kind: 'text',
    required: true,
    description:
      `请假事由，必填，最多 ${REASON_MAX} 字（页面 a-textarea :maxlength + formRules.reason 的 max）。` +
      `⚠️ 后端 @Size(max = ${REASON_MAX_BACKEND}) 比页面松，但页面上打不出第 ${REASON_MAX + 1} 个字`,
  },
  {
    name: 'leaveDateItems',
    kind: 'text',
    required: true,
    description:
      `请假时间明细数组，**至少 1 行**：\`[{leaveDate: '${PORTAL_DATE_FORMAT}', leaveHours: 数字}, ...]\`。` +
      '页面上可以「添加 / 删除」多行（默认 1 行）。每行：`leaveDate` 必填且必须是真实存在的日期（`2026-02-30` 这种会被拦）；' +
      `\`leaveHours\` 必填、**大于 0**、最多 1 位小数（页面 a-input-number :precision="1"）。` +
      '⚠️ 提交后，每行的 `id` 由 SDK 补成 null（页面的 buildSubmitData 就是这么改写的）',
  },
  {
    name: 'attachments',
    kind: 'text',
    required: false,
    description:
      `附件数组 [{url, name}]，最多 ${ATTACHMENT_MAX_COUNT} 件，扩展名只收 ` +
      ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' ') +
      `。url 要用 base-upload-file 先传到 OSS（目录 ${ATTACHMENT_OSS_FOLDER}）。` +
      `⚠️ 页面的 ${ATTACHMENT_MAX_SIZE_MB}MB 单件上限 SDK 校验不了（size 是调用方给的，拿它当判据等于自己骗自己）`,
  },
]

export const restLeaveApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'rest-leave-application-definition',
    title: '查询调休审批的流程定义',
    pagePath: REST_LEAVE_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${REST_LEAVE_APPLICATION_PROCESS_KEY}`,
        options: [{ label: '调休审批', value: REST_LEAVE_APPLICATION_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'rest-leave-application-current-user',
    title: '查当前登录用户（姓名 / 工号 / 部门那几个只读字段的来源）',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [],
  },
  {
    id: 'rest-leave-application-remaining-hours',
    title: '查某人的剩余加班时长（页面上「剩余加班时长」那一格的数据源）',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'userId',
        kind: 'number',
        required: true,
        description:
          '用户 id。⚠️ 这个接口挂在 `overtime-application` 这个 controller 下（不是 `rest-leave-application`），' +
          '后端就是这么放的。⚠️ 它返回的是**页面显示的那个值**，与后端 create 时用的门槛' +
          '（`RestLeaveApplicationServiceImpl.calculateRemainingOvertimeHours`）**是两套算法**，可以不等——见能力文件头 §三',
      },
    ],
  },
  {
    id: 'rest-leave-application-approval-chain',
    title: '★ 提交前预览审批链 —— 看清会打扰谁、以及会不会撞上「发起人=审批人」',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS.map((param) => ({ ...param, required: false })),
  },
  {
    id: 'rest-leave-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点（本流程实测 0 个）',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'rest-leave-application-submit',
    title: '提交调休申请（会真的发起流程、给直属上级推待办）',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
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
    id: 'rest-leave-application-detail',
    title: '查询单条调休申请单据',
    pagePath: REST_LEAVE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有流程实例 id** —— ' +
          '要取消得先 rest-leave-application-my-instances 按 businessKey 找流程实例',
      },
    ],
  },
  {
    id: 'rest-leave-application-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: REST_LEAVE_APPLICATION_MY_LIST_PATH,
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
        description: `流程类型字典 bpm_process_type；本流程是 ${REST_LEAVE_APPLICATION_PROCESS_TYPE}（审批）`,
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'rest-leave-application-cancel',
    title: '取消（撤回）我发起的调休审批流程',
    pagePath: REST_LEAVE_APPLICATION_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 rest-leave-application-my-instances 那一行的 id',
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

export type RestLeaveApplicationOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条） */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

/** 提交时的可选项 */
export type RestLeaveApplicationSubmitOptions = {
  /** `{ [节点 id]: [用户 id, ...] }`。本流程实测没有自选节点，正常留空 */
  startUserSelectAssignees?: StartUserSelectAssignees
  /** ⚠️ 关掉「审批链里不能有发起人本人」的守卫。只在预览接口不可用时才该用 */
  skipSelfApprovalGuard?: boolean
}

export function createRestLeaveApplicationCapability (
  request: PortalRequest,
  options: RestLeaveApplicationOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: RestLeaveInstanceQuery = {},
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
   * 当前登录用户（**只读**）。页面靠它填姓名 / 工号 / 部门那 5 个只读字段。
   *
   * ⚠️ 响应已经过 `pickCurrentUser()` 白名单收敛：原接口里的 `password2` / `salt`
   * **不会**出现在这个方法的返回值里。
   */
  async function currentUser (): Promise<PortalCurrentUser> {
    const raw = await request<Record<string, unknown>>({ url: '/sys/user/info', method: 'get' })
    return pickCurrentUser(raw)
  }

  /**
   * 剩余加班时长（**只读**）。页面上「剩余加班时长」那一格打的就是它。
   *
   * ⚠️ 它挂在 `overtime-application` 这个 controller 下 —— 后端就是这么放的，不是笔误。
   */
  async function remainingOvertimeHours (userId: number | string): Promise<number> {
    const wanted = Number(userId)
    if (!Number.isFinite(wanted)) {
      throw new Error(`userId 必须是数字（页面上传的是用户 id）：${JSON.stringify(userId)}`)
    }
    const result = await request<number | string | null>({
      url: REMAINING_OVERTIME_HOURS_URL,
      method: 'get',
      params: { userId: wanted },
    })
    // 后端返回的是 BigDecimal，实测是 4（数字）；归一成数字让调用方不用管字符串/数字
    return Number(result ?? 0)
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
        processDefinitionKey: REST_LEAVE_APPLICATION_PROCESS_KEY,
        variables,
        startUserSelectAssignees,
        copyUserIds: [],
      },
    })
    // 后端在「流程定义不存在」时可能回 null；归一成空 nodes，免得调用方对 undefined 取 .nodes
    return { ...(result ?? {}), nodes: Array.isArray(result?.nodes) ? result.nodes : [] } as ApprovalChainPreview
  }

  /**
   * 把只读联动的 9 个字段算出来 / 查出来（**只读**，会打两次接口：
   * `/sys/user/info` 与 `/record/remaining-hours`）。
   *
   * 这是 `prepare` / `submit` 的第一步，也单独暴露出去，方便调用方在提交前先看一眼
   * 「调休时长会算成多少、还剩多少加班时长」——那两个值页面上是只读的，用户改不了，但看得见。
   */
  async function resolveDerivedFields (draft: RestLeaveApplicationDraft): Promise<ResolvedRestLeaveFields> {
    // ★ 先把调用方填的 3 个字段校完 —— **在校任何网络请求之前**。
    // 不这么做的话，一个 reason 为空的提交也会先打一次 /sys/user/info。
    const normalized = normalizeRestLeaveDraft(draft)
    const user = await currentUser()
    const remaining = await remainingOvertimeHours(user.id)
    return {
      applicantName: user.realName,
      userId: user.id,
      staffCode: user.username ?? '',
      departmentId: user.organizationId,
      departmentName: user.organizationName,
      leaveType: LEAVE_TYPE_REST,
      leaveHours: normalized.leaveHours,
      remainingOvertimeHours: remaining,
    }
  }

  /**
   * 按 `businessKey` 找它对应的流程实例。
   *
   * **为什么必须存在这个方法**：`cancel-by-start-user` 要流程实例 id，而
   * `GET /hr/rest-leave-application/get` 的响应里**没有** `processInstanceId`。
   * 唯一的通路就是翻「我的流程」，用 `businessKey` 对上——这正是页面上点
   * 「取消流程」时拿的那个 `record.id`。
   *
   * **为什么还要按 `processDefinitionKey` 再筛一道**：`businessKey` 是各业务表**自己的主键**
   * （后端 `setBusinessKey(String.valueOf(application.getId()))`），「调休申请 51」与
   * 「加班申请 51」会撞成同一个字符串。只按 businessKey 匹配会认错单子。
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
            row.processDefinitionKey === REST_LEAVE_APPLICATION_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的调休审批流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 rest-leave-application-my-instances 自己按条件找。',
    )
  }

  /**
   * `prepare()` 的实现体。抽成闭包里的函数而不是对象方法，
   * 是为了让 `submit()` 能调它而**不依赖 `this`**——组装点可能把方法摘下来单独调
   * （`const { prepare } = cap`），那时 `this` 是 undefined。
   */
  async function prepareInternal (
    draft: RestLeaveApplicationDraft,
    derivedOverride?: ResolvedRestLeaveFields,
  ): Promise<{
    payload: Record<string, unknown>
    derived: ResolvedRestLeaveFields
    tasks: StartUserSelectTask[]
  }> {
    // ★ 先把调用方填的 3 个字段校完 —— **在校任何网络请求之前**
    normalizeRestLeaveDraft(draft)
    const derived = derivedOverride ?? (await resolveDerivedFields(draft))
    const payload = buildRestLeaveApplicationPayload(derived, draft)
    const tasks = await request<StartUserSelectTask[]>({
      url: REST_LEAVE_TASKS_URL,
      method: 'post',
      data: payload,
    })
    return { payload, derived, tasks: Array.isArray(tasks) ? tasks : [] }
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 §一 */
    definition (key: string = REST_LEAVE_APPLICATION_PROCESS_KEY): Promise<ProcessDefinition> {
      return request<ProcessDefinition>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    currentUser,

    remainingOvertimeHours,

    approvalChain,

    resolveDerivedFields,

    /** 在审批链里找发起人本人（**纯函数**，不发请求） */
    findSelfInApprovalChain,

    /**
     * 提交前准备（**只读**）：算出这次需要人工指定哪些审批人节点 + 算好载荷。
     *
     * ⚠️ 页面在字段不全时**不发请求**；这里也一样 —— 载荷构造会把 3 个字段连同日期/时长
     * 一次校完，任何一条不过就在发请求之前抛。
     *
     * 与加班那条线的一个**实测共性**：本流程的这个接口**也要收完整载荷**
     * （`@Valid @RequestBody`，传 `{}` 会被打回「请求参数不正确:请假事由不能为空」）。
     */
    prepare: prepareInternal,

    /**
     * 真正提交（**写操作**）：创建单据**并起一条 `hr_rest_leave_application` 审批流**。
     *
     * ⚠️ 它会**给真人（你的直属上级）推待办、可能发短信**。测试请：
     *   1. 事由带 `SDK-TEST-` 前缀；
     *   2. 测完立刻用 `cancel()` 撤掉。
     *
     * 请求顺序（写操作只有最后那一条）：
     *
     * ```
     * ① GET  /sys/user/info                                      只读
     * ② GET  /hr/overtime-application/record/remaining-hours      只读
     * ③ POST /hr/rest-leave-application/getRequiredStartUserSelectTasks  页面 formSubmit() 的第一步
     * ④ POST /bpm/process-instance/preview                       ★ SDK 加的守卫
     * ⑤ POST /hr/rest-leave-application/create                    写
     * ```
     *
     * 守卫放在 ⑤ 之前而不是更早，是为了保持页面上 ①→⑤ 的相对顺序不变；
     * 它只加一次**只读**请求，却能把"单据永远撤不掉"这件事挡在写之前。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）。⚠️ 这不是流程实例 id，
     * 撤销要先用 `findInstanceByBusinessKey()` 换。
     */
    async submit (
      draft: RestLeaveApplicationDraft,
      submitOptions: RestLeaveApplicationSubmitOptions = {},
    ): Promise<unknown> {
      // ① + 本地校验：载荷构造会把 3 个字段与日期/时长一次校完；不过就在发请求之前抛
      const { payload, derived, tasks } = await prepareInternal(draft)
      const assignees = submitOptions?.startUserSelectAssignees ?? {}
      assertTasksCovered(tasks, assignees)

      // ② ★ 守卫：审批链里不能有发起人本人。
      // 发起人的 id 就来自 ① 里那份 derived（userId 是 `/sys/user/info` 的 id 原样），
      // 所以这里**不用再打一次** currentUser()。
      if (submitOptions?.skipSelfApprovalGuard !== true) {
        const preview = await approvalChain(payload)
        assertNotSelfApprover(preview, Number(derived.userId))
      }

      // ③ 写
      return request({
        url: REST_LEAVE_CREATE_URL,
        method: 'post',
        data: { ...buildRestLeaveApplicationCreatePayload(derived, draft, assignees) },
      })
    },

    /** 单条单据详情（**只读**）。⚠️ 响应里没有流程实例 id，见 `RestLeaveApplicationRecord` */
    detail (id: number | string): Promise<RestLeaveApplicationRecord> {
      const wanted = String(id ?? '').trim()
      if (wanted === '') throw new Error('调休申请单据 id 不能为空')
      return request<RestLeaveApplicationRecord>({
        url: REST_LEAVE_DETAIL_URL,
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
                'processInstanceId 来自 rest-leave-application-my-instances，' +
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

export type RestLeaveApplicationCapability = ReturnType<typeof createRestLeaveApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与前面几条线同样的分工：`withIdempotency` 需要**身份**（租户 / 用户），
 * 那是会话层的东西，所以包装放在组装点。
 *
 * **为什么这一条也需要防重**：后端零幂等，重发一次就是**第二条流程实例 + 第二串真人待办**。
 * 而且本流程的审批人是系统算出来的直属上级——发重了，打扰的是同一个人两次。
 */
export type RestLeaveApplicationCapabilityWithIdempotency = RestLeaveApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * `requestId` 由调用方生成并保管，超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: RestLeaveApplicationDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
      skipSelfApprovalGuard?: boolean
    },
  ) => Promise<unknown>
}
