import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 出差申请（`hr_business_trip_application`）—— 流程表单这一类的第九条线。
 *
 * 页面：`/simple/hr/form/041`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=hr_business_trip_application&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/041
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）。
 *
 * 模板是**调休申请那条线**（`src/capabilities/rest-leave-application.ts`，第八条）与
 * **加班申请那条线**（`src/capabilities/overtime-application.ts`，第七条）——
 * **只读它们，不改**。能复用的是四条：文件骨架、审批链守卫（§六）、只读联动、
 * 写链路的 prepare → submit → detail → my-instances → cancel。
 * 本能力与它们**不是同构**，形态差异写在 §零。
 *
 * ---------------------------------------------------------------------------
 * 零、为什么是这条流程（选型凭据，**先看这张表**）
 * ---------------------------------------------------------------------------
 *
 * 任务要求：人力域里再挑一条**大众化、普通员工日常会用到**的流程。已经做完的八条
 * （会议室 / 通用审批 / 请假 / 用车 / 差旅费报销 / 产品设计文档审核 / 加班 / 调休）不重复。
 *
 * 【实测 2026-09-21，`GET /bpm/process-definition/create-list` **两个 processType 都拉**】
 *
 * | key | 名称 | processType | formCustomCreatePath |
 * | --- | --- | --- | --- |
 * | `hr_business_trip_application` | 出差申请流程 | **2（审批）** | `simple/hr/form/041` |
 *
 * `processType=1`（审核）那 25 条里**没有**这一条——两型都拉过，不是没查
 * （两型的条数与 `docs/process-forms.md` §1.4 记的 25 / 57 逐条对得上）。
 *
 * ⚠️ 同一张表里 `test_edit_model_name`（QQQ1112，测试遗留数据）也写着 `hr/form/041`——
 * 那是测试环境的脏数据（一个乱改的流程复用了同一张表单页）。本能力只按
 * `hr_business_trip_application` 这个 key 走，不碰那一条。
 *
 * 与已做八条的形态差异：
 *
 * | | 加班（042） | 调休（043） | **出差（041，本能力）** |
 * | --- | --- | --- | --- |
 * | 调用方能填的字段数 | 6 | 3（含明细行数组） | **7** |
 * | 明细行数组 | 没有 | **有** | 没有 |
 * | 附件控件 | 没有 | **有** | **没有**（后端 VO 里根本没有附件字段） |
 * | 人员控件 | 没有 | 没有 | **没有**（「同行人」是 a-textarea 自由文本，**不是选人**） |
 * | 前端算出来的字段 | 加班时长 | 调休时长 | **一个都没有** |
 * | 只读字段的来源 | userStore（= /sys/user/info） | userStore + 打接口取剩余时长 | **只有 /sys/user/info 那一份** |
 * | 两个时间控件之间 | 有联动（早于/等于开始被禁用 + 清空） | ——（日期 + 时长两列） | **PC 页没有联动；移动端有**（开始时间变化后清空不再合法的结束时间，且结束时间「必须晚于开始时间」） |
 * | 谁重算 | 不重算 | 后端重算 | **后端把申请人/部门/岗位/申请时间**全部覆盖 **（§三）** |
 * | 审批链 | 直属上级(23) | 直属上级(23) | **直属上级(23)**（实测同一条路，见 §六） |
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：**接口里没有，只在前端源码与真实页面里**
 * ---------------------------------------------------------------------------
 *
 * 【实测】`GET /bpm/process-definition/get?key=hr_business_trip_application` 返回
 * `formFields: null`、`formCustomCreatePath: null`。所以字段只能读：
 *
 * - `app/portal/views/simple/hr/form/041/page/pc/edit/index.vue`（模板 + 校验 + 提交）
 * - `app/portal/views/simple/hr/form/041/page/mobile/edit/index.vue`（**同样的字段**）
 * - `app/portal/views/simple/hr/form/041/page/common/define.js`（类型选项）
 * - 后端 `BusinessTripApplicationController` / `BusinessTripApplicationSaveReqVO` /
 *   `BusinessTripApplicationServiceImpl`
 *
 * 真实页面抓的载荷见 `baseline/business-trip-application.browser.json`：**14 个字段，一个不多一个不少**。
 *
 * 本表单特有的取基准路子（与 042/043 一样）：页面上那个 `portal-hxr-flow-process-preview`
 * 会把 `resolvePreviewVariables()`（= `buildSubmitData()`）塞进
 * `POST /bpm/process-instance/preview` 的 `variables`。所以**点那个只读按钮**就能抓到一份
 * 逐字节等于提交载荷的东西，**不必真的点「提交」**。
 *
 * ---------------------------------------------------------------------------
 * 二、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面 label | 字段 | 形态 | 谁产生 | SDK 参数？ |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | 申请人 | `applicantId` | `a-input disabled` | `useUserStore().state.id` | ❌ 自动 |
 * | 2 | 申请人 | `applicantName` | 同上（与 1 同一个控件的两半） | `.realName` | ❌ 自动 |
 * | 3 | 申请时间 | `applyDate` | `a-input disabled` | `dayjs().format('YYYY-MM-DD')` = **今天** | ❌ 自动 |
 * | 4 | 申请部门 | `applyDepartmentId` | `a-input disabled` | `.organizationId` | ❌ 自动 |
 * | 5 | 申请部门 | `applyDepartmentName` | 同上 | `.organizationName` | ❌ 自动 |
 * | 6 | 申请岗位 | `applyPostId` | `a-input disabled` | `.postId` | ❌ 自动 |
 * | 7 | 申请岗位 | `applyPostName` | 同上 | `.postName` | ❌ 自动 |
 * | 8 | 类型 | `tripType` | `a-select`，3 个本地常量选项 | 用户填，必填 | **`tripType`** |
 * | 9 | 同行人 | `companions` | `a-textarea`，`:maxlength="500"` `show-count` | 用户填，必填 | **`companions`** |
 * | 10 | 开始时间 | `startTime` | `a-date-picker show-time` | 用户填，必填 | **`startTime`** |
 * | 11 | 结束时间 | `endTime` | `a-date-picker show-time` | 用户填，必填 | **`endTime`** |
 * | 12 | 始发地 | `origin` | `a-textarea`，`:maxlength="200"` | 用户填，必填 | **`origin`** |
 * | 13 | 目的地 | `destination` | `a-textarea`，`:maxlength="200"` | 用户填，必填 | **`destination`** |
 * | 14 | 事由 | `reason` | `a-textarea`，`:maxlength="500"` | 用户填，必填 | **`reason`** |
 * | — | 「查看审批流程」 | —— | 只读按钮 | —— | **做了**（§六，且它是本能力的安全守卫） |
 *
 * ⇒ **14 个字段全部表达**。1–7 是**只读联动**：页面上就是 `disabled` 的输入框，用户改不了，
 * 所以 SDK 也不把它们做成参数（做成参数就等于承认"用户可以填一个页面上改不了的值"）。
 * 调用方真正能给的只有 **7 个**。
 *
 * ⚠️ **本表单没有的东西**（不是漏做，是页面上真的没有）：**没有附件控件**、**没有抄送人控件**、
 * **没有人员/组织选择器**、**没有明细行**、**没有算出来的字段**。所以这条线
 * **没有** `user-search` / `tree` 那类长选项能力——加了就是凭空多一条没人会对上的接口。
 *
 * 类型下拉的三个选项逐条抄自 `041/page/common/define.js`：
 * `TYPE_OPTIONS` = `0 出差 / 1 外出 / 2 海外出差`。
 *
 * ---------------------------------------------------------------------------
 * 三、★ 后端**覆盖**那 7 个只读字段（比前几条线都彻底）
 * ---------------------------------------------------------------------------
 *
 * `BusinessTripApplicationServiceImpl.createApplication()`：
 *
 * ```java
 * validateTime(createReqVO.getStartTime(), createReqVO.getEndTime());   // 见 §四
 * BusinessTripApplicationDO application = BeanUtils.toBean(createReqVO, BusinessTripApplicationDO.class);
 * fillApplicantInfo(application);          // ← 申请人/部门/岗位**全部按登录用户重写**
 * application.setApplyDate(LocalDate.now());  // ← 申请时间也重写成"服务端的今天"
 * applicationMapper.insert(application);
 * startBpmProcess(application, createReqVO.getStartUserSelectAssignees());
 * ```
 *
 * `fillApplicantInfo()` 逐条：
 *
 * ```java
 * application.setApplicantId(loginUser.getId());
 * SysUserDTO userDTO = sysUserApi.get(userId);
 * application.setApplicantName(userDTO.getRealName());
 * application.setApplyDepartmentId(userDTO.getOrganizationId());
 * application.setApplyPostId(userDTO.getPostId());
 * HrOrganizationDTO orgDTO = hrOrganizationService.get(application.getApplyDepartmentId());
 * application.setApplyDepartmentName(orgDTO.getName());
 * application.setApplyPostName(hrPostService.getAllPostMap().get(application.getApplyPostId()));
 * ```
 *
 * ⇒ 这三件事跟着一起来：
 *
 * 1. **SDK 仍然把 7 个只读字段照页面的值发出去**（D20 逐字段一致），
 *    但**不能声称它们决定了入库结果**——后端全都会覆盖。文档里如实标注。
 * 2. **它们是 SDK 现查现算的**：6 个来自 `GET /sys/user/info`，`applyDate` 是
 *    `portalToday()`（门户时区）。**不接受调用方指定**（页面上没有输入口）。
 * 3. `applyPostId` / `applyPostName` 走的是 `HrPostService.getAllPostMap()`——
 *    **岗位不在当前用户的响应里时后端会抛「申请岗位不存在」**。SDK 只能照发，
 *    这个失败留给后端如实报错（本地复刻不了那份岗位表）。
 *
 * ---------------------------------------------------------------------------
 * 四、本地校验：6 条页面/后端一致 + 1 条只在 **PC 页**缺（移动端与后端都有）
 * ---------------------------------------------------------------------------
 *
 * 页面的 `formRules`（`041/page/pc/edit/index.vue`）与后端 `@Valid` 注解**在这条流程上是一致的**：
 *
 * | 字段 | 页面 | 后端 | SDK |
 * | --- | --- | --- | --- |
 * | `tripType` | `required` | `@NotNull` + `@Min(0)` + `@Max(2)` | 必填 + 只能是 0/1/2 |
 * | `companions` | `required` + `max:500` | `@NotBlank` + `@Size(max=500)` | 必填 + ≤500 |
 * | `origin` | `required` + `max:200` | `@NotBlank` + `@Size(max=200)` | 必填 + ≤200 |
 * | `destination` | `required` + `max:200` | `@NotBlank` + `@Size(max=200)` | 必填 + ≤200 |
 * | `reason` | `required` + `max:500` | `@NotBlank` + `@Size(max=500)` | 必填 + ≤500 |
 * | `startTime` / `endTime` | `required` | `@NotNull` | 必填 + 格式 `YYYY-MM-DD HH:mm:ss` |
 * | **开始/结束的先后** | PC 页**没有这条**；**移动端有**（见下） | **`validateTime`：`!endTime.isAfter(startTime)` → 「结束时间必须晚于开始时间」** | **拦** |
 *
 * ★ 这一条是**三处不一致**里最值得记的一处，逐处说清（**不要读成"SDK 比页面严"**）：
 *
 * | 处 | 有没有 | 形态 |
 * | --- | --- | --- |
 * | `041/page/pc/edit/index.vue`（**基准抓的就是它**） | **没有** | 两个 `a-date-picker` 之间没有任何联动，用户选得出一个结束早于开始的时间 |
 * | `041/page/mobile/edit/index.vue` | **有** | `onEndTimeConfirm()` 里 `end.isBefore(start) \|\| end.isSame(start)` → 报「**结束时间必须晚于开始时间**」（**与后端那句话一字不差**）；`onStartTimeConfirm()` 里还会把不再合法的结束时间**清空**并提示「结束时间已清空，请重新选择」；另外结束时间的**日期**选择器有 `:min-date`（不能早于开始那天的 0 点） |
 * | 后端 `validateTime()` | **有** | `!endTime.isAfter(startTime)` → 「结束时间必须晚于开始时间」 |
 *
 * 所以 SDK 这条本地校验的口径**与移动端和后端完全一致**，只有 PC 页缺它。
 * 仍然提前到本地拦的理由：在 PC 页上它是一个**注定 400 的写请求**，
 * 而"本地校验不过 ⇒ 一个请求都不发"是本项目的既有规矩。
 * 判据是 `endTime` **严格晚于** `startTime`（相等也不行：移动端是 `isSame`，后端是 `!isAfter`）。
 *
 * （移动端那两条「开始时间不能早于今天 / 必须晚于当前时间」是**注释掉的死代码**，
 * 不构成规则，SDK 也不实现——如实记下来，免得下次有人按注释去补。）
 *
 * 另外两条（**不是页面规则、也不是后端规则，是格式本身**）：
 * - `startTime` / `endTime` 必须是 `YYYY-MM-DD HH:mm:ss`（页面 `formatSubmitDateTime()`
 *   产出的就是这个形状；发别的形状后端 `@DateTimeFormat` 直接 400）。
 * - 日期部分必须是**真实存在的日期**（回读校验，理由同前几条线：`2026-02-30` 会被
 *   `new Date()` 静默进位成 3 月 2 日）。
 *
 * ---------------------------------------------------------------------------
 * 五、只读联动：本表单**一格都没有"算出来"的字段**
 * ---------------------------------------------------------------------------
 *
 * 这是与 042/043 最不一样的地方：那条线有一条「加班时长 = 结束 − 开始 − 休息」的
 * 前端算法要逐位复刻，本表单**没有**。7 个只读字段全是身份信息：
 *
 * | 表单字段 | 来源 | 实测值 |
 * | --- | --- | --- |
 * | `applicantId` | `/sys/user/info` 的 `id` | `"18243"` |
 * | `applicantName` | `realName` | `"姚淼鑫"` |
 * | `applyDepartmentId` | `organizationId` | `"101"` |
 * | `applyDepartmentName` | `organizationName` | `"设计中心1236"` |
 * | `applyPostId` | `postId` | `"702"` |
 * | `applyPostName` | `postName` | `"高级产品经理"` |
 * | `applyDate` | `dayjs().format('YYYY-MM-DD')` | `"2026-09-21"`（门户时区的今天） |
 *
 * ⚠️ **前 6 个都是字符串**（实测 `"18243"` / `"101"` / `"702"`）。这不是笔误：
 * 页面直接 `formState.applicantId = id`，**原样字符串发出去**，浏览器抓包里就是
 * `"applicantId":"18243"`。SDK 也发字符串（D20 要求逐字段一致）。
 *
 * `applyDate` 的「今天」是**门户时区**的今天。无头进程可能跑在 UTC 上，
 * 所以 `portalToday()` 固定按 `Asia/Shanghai` 算，并留了 `now()` 注入口给测试钉日期。
 *
 * 页面还额外打了一件**本能力一条都不打**的事：表单外壳挂载时**无关键字翻页拉全量人员目录**
 * （实测 9 页 × 500 = 4500+ 人，`GET /system/user/simple-page`）。本表单根本没有人员控件
 * ——它是设计 D6 / H35「长选项必须先要关键字」的现场证据（记在基线文件里）。
 *
 * ---------------------------------------------------------------------------
 * 六、★ 审批链：与前两条线**形态相同**（同一条守卫，照抄）
 * ---------------------------------------------------------------------------
 *
 * 【实测 2026-09-21】`POST /hr/business-trip-application/getRequiredStartUserSelectTasks`
 * 的 body 是**完整载荷**（`@Valid @RequestBody`，`{}` 会被 `@NotBlank` 打回），
 * 返回值是 **`[]`**——本流程**一个「发起人自选」节点都没有**。
 * 所以 `startUserSelectAssignees` 是 `{}`（与基线抓包一致）。
 *
 * `GET /bpm/process-definition/get` 的 `bpmnXml` 里：
 *
 * ```xml
 * <userTask id="Activity_..." name="直属上级审批"
 *           flowable:candidateStrategy="23" flowable:candidateParam="__placeholder__"/>
 * ```
 *
 * `23 = BpmTaskCandidateStrategyEnum.DIRECT_LEADER（直属上级）`——审批人是后端按发起人所在组织
 * **算出来**的，不是发起人选的。实测 `POST /bpm/process-instance/preview` 的返回：
 * `USER_TASK 直属上级审批 [strategy=23] → 乔娜(15012)`，发起人是 18243 ⇒ 不是同一人 ⇒ 放行。
 *
 * ⇒ **照抄前两条线的硬守卫**（理由与边界完全一致）：
 *
 * ```
 * POST /bpm/process-instance/preview   body {processDefinitionKey, variables: <本次载荷>, ...}
 *   → nodes[].type === 'USER_TASK' 的 candidateUsers[] 里逐个比对发起人 id
 *   → 命中 ⇒ **在 create 之前**抛错，一个写请求都不发
 * ```
 *
 * **为什么必须有这条**：后端 `BpmTaskServiceImpl.tryAutoApproveWhenStartUserIsAssignee()` 有一条
 * 「流程发起人与审批人相同，自动审核通过」。命中时节点会被自动批掉；若那条链上再没有别的
 * 待办节点，流程**当场走完**，`cancel-by-start-user` 从此必然报
 * 「流程取消失败，流程不处于运行中」——那条单据**永远撤不掉**
 * （测试环境里已经因此留了 3 条 `status=2` 的记录，本轮一条都没碰）。
 *
 * ⚠️ 这条守卫在本流程上**真的会生效**，不是摆设：同一批候选流程里
 * `lizhi`（离职）的节点就是 `candidateStrategy=30（用户）+ candidateUsers=18243` = 发起人本人，
 * `seal_application`（用章）同样命中——**那两条本能力没有选**，正是因为一提交就会撞上这条。
 *
 * ⚠️ 守卫的**逃生口**：`skipSelfApprovalGuard: true`。只在**预览接口本身不可用**时才该用。
 * 默认关着（守卫开着）。理由同前两条线：宁可让调用方显式承认"我知道自己在冒险"，
 * 也不要静默放过去。
 *
 * ⚠️ **已如实记下的边界**：这条守卫**不能证明**审批人最终一定是预览里那个人。
 * 预览是"按当前数据算一遍"，真实办理时后端会拿当时的组织数据再算一次。
 * SDK 能保证的是：**预览时命中自己就一定拒绝**。
 *
 * ---------------------------------------------------------------------------
 * 七、写链路：prepare → submit → cancel（+ 查）
 * ---------------------------------------------------------------------------
 *
 * ```
 * 当前用户  GET  /sys/user/info                                     （表单的 baseData 'user-basic'）
 * 预览     POST /bpm/process-instance/preview                        （页面上是「查看审批流程」按钮）
 * prepare  POST /hr/business-trip-application/getRequiredStartUserSelectTasks
 * submit   POST /hr/business-trip-application/create                 body = 载荷 + 末尾 startUserSelectAssignees
 * detail   GET  /hr/business-trip-application/get?id=
 * 找实例    GET  /bpm/process-instance/my-page                        findInstanceByBusinessKey
 * cancel   DELETE /bpm/process-instance/cancel-by-start-user          body { id: <流程实例 id>, reason }
 * ```
 *
 * ⚠️ `preview` 的请求体是**四个顶层键**（实测抓包，与 042/043 一致）：
 *
 * ```json
 * {"processDefinitionKey":"hr_business_trip_application","variables":{...14 个字段...},
 *  "startUserSelectAssignees":{},"copyUserIds":[]}
 * ```
 *
 * `cancel` 的 id **不是** `submit` 的返回值：`create` 返回**业务单据 id**；
 * `GET /hr/business-trip-application/get` 的响应 VO 里**没有 `processInstanceId`**
 * （`BusinessTripApplicationRespVO` 只到 status/statusName，虽然 DO 里有）。
 * 唯一的通路是「我的流程」，按 `businessKey` 对上——这正是页面上点「取消流程」时拿的那个 `record.id`。
 *
 * ⚠️ **本流程的业务 status 在提交后仍是 0（待提交）**，这是一个**后端事实**，不是 SDK 的推断：
 * `createApplication()` 没有 setStatus，表 `hr_business_trip_application.status` 的默认值是 `0`；
 * 而监听器 `BusinessTripApplicationWorkflowListener` 只处理 APPROVE / REJECT / CANCEL 三种事件
 * （其余走 `default: 忽略的状态`）。所以**不能靠 detail 的 status 判断"流程在跑"**——
 * 那要看「我的流程」里流程实例的 `status === 1`。撤销之后两边才会同时变成 4。
 *
 * ---------------------------------------------------------------------------
 * 八、当前用户是谁：`GET /sys/user/info`，**必须白名单收敛**
 * ---------------------------------------------------------------------------
 *
 * 【实测】那个响应里**含 `password2`（bcrypt 串）与 `salt`**。
 * ⇒ SDK 的这一条能力**逐字段白名单**，只回表单真正要的那几个，
 * 那两个字段连返回值里都不会出现（有测试钉住）。
 *
 * 来源链路（源码）：`041/index.vue` 的路由 `meta.baseData: ['user-basic', 'dict-platform']`
 * → `utils/router/base-data.js` 的 `'user-basic'` → `fetchSimpleUserBasic()`
 * → `GET /sys/user/info`（`critical: true, onlySimpleForm: true`）。
 *
 * ---------------------------------------------------------------------------
 * 九、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/041`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里一条都匹配不到，
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器同样不发
 * （baseline 里 `process-definition/get` 与 `preview` 两条请求的请求头都没有 `module-type`）。
 *
 * ---------------------------------------------------------------------------
 * 十、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **「重新发起」（reapply）没做**：与前几条线一样，`isReapply` 分支会从原流程实例
 *   抄字段再提交（`fetchDetail()` 里 `formState = {...result, id: null}`），是一条**另起的写链路**。
 * - **`PUT /hr/business-trip-application/update` 与 `DELETE .../delete/{id}` 没做**：
 *   两个接口后端都开着，但**页面上的入口只在「已驳回」状态出现**。本能力做的是
 *   用户日常那条路（新建 → 提交 → 撤销），驳回后改单重提属于**另一条写链路**，没验证过就不写。
 * - **`POST /hr/business-trip-application/page`（分页）没做**：那是**另一个列表页**
 *   （`BusinessTripApplicationPageReqVO` 带 applicantName / tripType / status / createTime 区间），
 *   不是本流程表单的一部分。要按条件找单据，用通用的 `my-instances`。
 * - **打印 / 详情页的展示件没做**：只读的展示壳，不影响能不能提交。
 * - **`dict-platform` 那条 baseData 没做**：本表单的模板里**没有用到任何字典控件**
 *   （类型是本地常量），所以那条依赖对本表单是空跑。不发。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与前几条线同一个壳） */
export const BUSINESS_TRIP_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/** 表单页面本体。**它不在 `page-catalog.json` 里**，所以本能力不会把任何页面判成已完成 */
export const BUSINESS_TRIP_APPLICATION_FORM_PATH = '/simple/hr/form/041'

/**
 * 「我的流程」页。撤销入口在这里（行内「取消流程」），不在表单页。
 * ⚠️ 它同样**不在** `page-catalog.json` 里。
 */
export const BUSINESS_TRIP_APPLICATION_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key */
export const BUSINESS_TRIP_APPLICATION_PROCESS_KEY = 'hr_business_trip_application'

/**
 * 平台字典 `bpm_process_type` 的取值。**实测**（两个 processType 都拉过）本流程是 **2（审批）**，
 * 不是 1（审核）——「审核/审批」这一列在本项目里被记错过两次（先例：产品设计文档审核）。
 */
export const BUSINESS_TRIP_APPLICATION_PROCESS_TYPE = 2

/** 页面 `value-format` 的形状（`applyDate`） */
export const PORTAL_DATE_FORMAT = 'YYYY-MM-DD'

/** 页面 `formatSubmitDateTime()` 产出的形状（`startTime` / `endTime`） */
export const PORTAL_DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/** 「今天」按门户所在时区算 */
export const PORTAL_TIME_ZONE = 'Asia/Shanghai'

/**
 * 出差类型。逐条抄自 `041/page/common/define.js` 的 `TYPE_OPTIONS`
 * —— **不是服务端字典**（这一点与请假 `type` 那条线不同）。
 */
export const TRIP_TYPE_OPTIONS = [
  { value: 0, label: '出差' },
  { value: 1, label: '外出' },
  { value: 2, label: '海外出差' },
] as const

export const TRIP_TYPE_BUSINESS = 0
export const TRIP_TYPE_OUTING = 1
export const TRIP_TYPE_OVERSEAS = 2

/**
 * 三个文本框的上限。**页面 `:maxlength` 与后端 `@Size` 在这条流程上是一致的**
 * （500 / 200 / 200 / 500），所以这里只有一个常量、不需要"页面值 vs 后端值"那一对
 * （与前几条线不同：请假那条线是页面 200、后端 500）。
 */
export const COMPANIONS_MAX = 500
export const ORIGIN_MAX = 200
export const DESTINATION_MAX = 200
export const REASON_MAX = 500

/** 三个接口。前缀是 `hr/business-trip-application`（**不是** workflow-*） */
export const BUSINESS_TRIP_TASKS_URL = '/hr/business-trip-application/getRequiredStartUserSelectTasks'
export const BUSINESS_TRIP_DETAIL_URL = '/hr/business-trip-application/get'
export const BUSINESS_TRIP_CREATE_URL = '/hr/business-trip-application/create'

/** 审批链预览（页面上「查看审批流程」按钮打的那个接口，所有流程共用） */
export const PROCESS_INSTANCE_PREVIEW_URL = '/bpm/process-instance/preview'

/** 取消（撤回）自己发起的流程（所有流程共用） */
export const PROCESS_INSTANCE_CANCEL_URL = '/bpm/process-instance/cancel-by-start-user'

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
  /** ⚠️ 实测多个 key 里**一次都没出现过**，不要以为它有值 */
  startUserSelectTasks?: Array<{ id: string; name: string }> | null
  [key: string]: unknown
}

/**
 * 当前登录用户。**逐字段白名单**——`/sys/user/info` 原响应里含 `password2` 与 `salt`，
 * 那两个字段**不在这个类型里，也不会出现在返回值里**（有测试钉住）。
 *
 * ⚠️ `id` / `organizationId` / `postId` / `username` / `staffId` **都是字符串**，
 * 与接口原样一致 —— 页面把它们**原样**塞进 `applicantId` / `applyDepartmentId` /
 * `applyPostId` 发出去。
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
  /** ★ 字符串（实测 `"702"`）。载荷里 `applyPostId` 发出去的就是它 */
  postId?: string
  /** 岗位名，载荷里 `applyPostName` 发出去的就是它 */
  postName?: string
  username?: string
  staffId?: string
  organizationCode?: string
  tenantId?: string
}

/**
 * 提交 / prepare 的载荷 —— **只有 7 个字段是调用方给的**。
 *
 * 另外 7 个（applicantId / applicantName / applyDate / applyDepartmentId /
 * applyDepartmentName / applyPostId / applyPostName）由 SDK 按 `/sys/user/info`
 * 与门户时区的"今天"算出来，**不接受调用方传**：页面上它们没有输入口。
 */
export type BusinessTripApplicationDraft = {
  /** 类型，必填，只能是 `0 出差 / 1 外出 / 2 海外出差`（本地常量，不是服务端字典） */
  tripType: number
  /** 同行人，必填，≤500 字。⚠️ 页面上是**自由文本**（a-textarea），不是人员选择器 */
  companions: string
  /** 开始时间，必填，`YYYY-MM-DD HH:mm:ss` */
  startTime: string
  /** 结束时间，必填，`YYYY-MM-DD HH:mm:ss`，**必须严格晚于 startTime**（后端 validateTime） */
  endTime: string
  /** 始发地，必填，≤200 字 */
  origin: string
  /** 目的地，必填，≤200 字 */
  destination: string
  /** 事由，必填，≤500 字 */
  reason: string
}

/**
 * 只读联动算出来 / 查出来的 7 个字段。全部来自 `GET /sys/user/info` +
 * 门户时区的"今天"。
 *
 * ⚠️ 后端 `fillApplicantInfo()` 会把这 7 个中的 6 个**按登录用户重写**、
 * `applyDate` 也会被 `setApplyDate(LocalDate.now())` 重写。SDK 照发（D20 逐字段一致），
 * 但不声称它们决定了入库结果——见文件头 §三。
 */
export type BusinessTripApplicationDerived = {
  /** ★ 字符串（实测 `"18243"`），与 `/sys/user/info` 的 `id` 逐字段一致 */
  applicantId: string
  applicantName: string
  /** ★ 字符串 `YYYY-MM-DD`，**是"今天"**（门户时区），不是出差那天 */
  applyDate: string
  /** ★ 字符串（实测 `"101"`） */
  applyDepartmentId: string
  applyDepartmentName: string
  /** ★ 字符串（实测 `"702"`）。后端拿它去岗位表里换名字，换不到会抛「申请岗位不存在」 */
  applyPostId: string
  applyPostName: string
}

/** `resolveDerivedFields()` / `prepare()` 真正产出的那一份：**7 个字段齐全** */
export type ResolvedBusinessTripFields = BusinessTripApplicationDerived

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
 * 批掉那个节点，流程可能当场走完，`cancel` 再也撤不掉。
 */
export type SelfApprovalHit = {
  nodeId: string
  nodeName: string
  candidateStrategy?: number | null
  candidateStrategyName?: string | null
  user: ApprovalChainUser
}

/** `GET /hr/business-trip-application/get` 的响应 */
export type BusinessTripApplicationRecord = {
  id: number
  applicantId?: number | string
  applicantName?: string
  applyDate?: string
  applyDepartmentId?: number | string
  applyDepartmentName?: string
  applyPostId?: number | string
  applyPostName?: string
  /** 0=出差，1=外出，2=海外出差 */
  tripType?: number
  companions?: string
  /** `YYYY-MM-DD HH:mm:ss` */
  startTime?: string
  endTime?: string
  origin?: string
  destination?: string
  reason?: string
  /**
   * 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消。
   *
   * ⚠️ **提交之后它仍然是 0**：后端 `createApplication()` 没有 setStatus（表默认 0），
   * 监听器只处理 APPROVE/REJECT/CANCEL。「流程在不在跑」要看「我的流程」里
   * 流程实例的 `status`（1 = 审批中），不能看这里。
   */
  status?: number
  /** 状态名。后端 `getApplication` 里按枚举 set（实测「已取消」） */
  statusName?: string
  /**
   * ⚠️ **这个字段不存在**。`BusinessTripApplicationRespVO` 里没有 `processInstanceId`
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

export type BusinessTripInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 工具：日期 / 时刻
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/**
 * 「今天」，按门户所在时区（`Asia/Shanghai`）。
 *
 * 页面的 `formState` 初值：`applyDate: dayjs().format('YYYY-MM-DD')` ——
 * **申请时间是"今天"（填表那天），不是出差那一天**（这两件事在页面上是两个字段）。
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

function assertRealCalendarDate (year: number, month: number, day: number, label: string, raw: unknown): void {
  const back = new Date(year, month - 1, day)
  if (back.getFullYear() !== year || back.getMonth() !== month - 1 || back.getDate() !== day) {
    throw new Error(`${label} 不是一个真实存在的日期：${JSON.stringify(raw)}（例如 2 月没有 30 日）`)
  }
}

/**
 * 严格的 `YYYY-MM-DD` 解析，**按本地时区**（与 dayjs 的行为一致 —— 页面用的就是 dayjs）。
 *
 * 为什么要回读校验：`new Date(2026, 1, 30)` 会被静默进位成 3 月 2 日。
 * 静默进位意味着 SDK 会把一个没人填过的日期发出去，还查不出来。
 */
export function parsePortalDate (value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 '${PORTAL_DATE_FORMAT}' 格式的字符串，收到 ${JSON.stringify(value)}`)
  }
  const text = value.trim()
  const match = DATE_RE.exec(text)
  if (match === null) {
    throw new Error(
      `${label} 必须形如 '${PORTAL_DATE_FORMAT}'，收到 ${JSON.stringify(value)}`,
    )
  }
  assertRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]), label, value)
  return text
}

/**
 * 严格的 `YYYY-MM-DD HH:mm:ss` 解析，返回**归一后的字符串**。
 *
 * 为什么这么严：页面 `formatSubmitDateTime()` 产出的就是这个形状
 * （`dayjs(value).format('YYYY-MM-DD HH:mm:ss')`），发别的形状后端 `@DateTimeFormat`
 * 直接 400。而且日期与时分秒都要回读校验（理由同 `parsePortalDate`）。
 */
export function parsePortalDateTime (value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 '${PORTAL_DATE_TIME_FORMAT}' 格式的字符串，收到 ${JSON.stringify(value)}`)
  }
  const text = value.trim()
  const match = DATE_TIME_RE.exec(text)
  if (match === null) {
    throw new Error(
      `${label} 必须形如 '${PORTAL_DATE_TIME_FORMAT}'（页面 value-format 就是这么写的），` +
        `收到 ${JSON.stringify(value)}`,
    )
  }
  const [, y, mo, d, h, mi, s] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  assertRealCalendarDate(year, month, day, label, value)
  if (hour > 23) throw new Error(`${label} 的小时超出 0–23：${JSON.stringify(value)}`)
  if (minute > 59) throw new Error(`${label} 的分钟超出 0–59：${JSON.stringify(value)}`)
  if (second > 59) throw new Error(`${label} 的秒超出 0–59：${JSON.stringify(value)}`)
  return text
}

/**
 * `YYYY-MM-DD HH:mm:ss` → 毫秒（本地时区，与 dayjs 一致）。
 * 只用于**比较先后**，不参与载荷构造。
 */
export function dateTimeToMs (value: string): number {
  return new Date(value.replace(' ', 'T')).getTime()
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

/** 三个文本框共用的一条：必填 + 长度上限（策略与页面 `formRules` 逐条对应） */
function assertRequiredText (value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} 必填（页面 formRules 的 required / 后端 @NotBlank），收到 ${JSON.stringify(value)}`)
  }
  if (value.length > max) {
    throw new Error(`${label}最多 ${max} 个字，收到 ${value.length} 个（页面 :maxlength 与后端 @Size 都是 ${max}）`)
  }
  return value.trim()
}

/**
 * 类型：必填 + 只能是 0/1/2。
 *
 * 页面是 `a-select`（**无默认值**，所以不选就是 `null`），后端 `@NotNull @Min(0) @Max(2)`。
 */
export function assertTripType (value: unknown): number {
  if (value === null || value === undefined || value === '') {
    throw new Error(
      `类型 tripType 必填（页面 a-select 的 formRules required；无默认值，不选就是 null）。` +
        `可选值：${TRIP_TYPE_OPTIONS.map((o) => `${o.value}=${o.label}`).join(' / ')}`,
    )
  }
  const type = Number(value)
  if (!Number.isInteger(type) || !TRIP_TYPE_OPTIONS.some((o) => o.value === type)) {
    throw new Error(
      `类型 tripType 只能是 ${TRIP_TYPE_OPTIONS.map((o) => `${o.value}=${o.label}`).join(' / ')}` +
        `（页面是本地常量下拉，后端 @Min(0) @Max(2)），收到 ${JSON.stringify(value)}`,
    )
  }
  return type
}

/**
 * 结束时间必须**严格晚于**开始时间。
 *
 * 这条规则**同时**来自两处（措辞都一模一样）：
 *
 * - 后端 `BusinessTripApplicationServiceImpl.validateTime()`：
 *   `if (!endTime.isAfter(startTime)) { throw exception("结束时间必须晚于开始时间"); }`
 * - **移动端** `041/page/mobile/edit/index.vue` 的 `onEndTimeConfirm()`：
 *   `if (end.isBefore(start) || end.isSame(start)) { message.error('结束时间必须晚于开始时间'); return }`
 *
 * ⚠️ **PC 页（`041/page/pc/edit/index.vue`，也就是基准抓的那一页）没有这条校验**：
 * 两个 `a-date-picker` 之间没有任何联动。所以严格说这不是"SDK 比页面严"，
 * 而是"**PC 页比同一个页面的移动端少一条**"。
 *
 * SDK 提前到本地拦的理由：在 PC 页上它是一个**注定 400 的写请求**，
 * 而"本地校验不过 ⇒ 一个请求都不发"是本项目的既有规矩。
 * 判据用「严格晚于」而不是「不早于」：移动端是 `isSame`、后端是 `!isAfter`，**相等也会被拒**。
 */
export function assertTimeOrder (startText: unknown, endText: unknown): { startTime: string; endTime: string } {
  const startTime = parsePortalDateTime(startText, '开始时间 startTime')
  const endTime = parsePortalDateTime(endText, '结束时间 endTime')
  if (!(dateTimeToMs(endTime) > dateTimeToMs(startTime))) {
    throw new Error(
      `结束时间必须**严格晚于**开始时间（后端 validateTime 的「结束时间必须晚于开始时间」；` +
        `⚠️ 页面上没有这条校验——两个时间控件之间没有联动）。收到 startTime=${startTime}、endTime=${endTime}`,
    )
  }
  return { startTime, endTime }
}

/**
 * 调用方填的 7 个字段的**全部本地校验**，一次做完并返回归一后的值。
 *
 * **为什么要单独抽出来**：`submit()` 里在打 `/sys/user/info` **之前**就要把这份草稿校完。
 * 否则一个 `reason` 为空的提交也会先发一次读请求——「本地校验不过 ⇒ 一个请求都不发」
 * 这条规矩就破了。
 *
 * 归一规则（逐条对应页面 `buildSubmitData()`）：
 * - 三个文本框：`trimSubmitText()` → **去掉首尾空白**（页面就是这么做的）
 * - `tripType`：数字
 * - 两个时间：`formatSubmitDateTime()` → `YYYY-MM-DD HH:mm:ss`
 */
export function normalizeBusinessTripDraft (draft: BusinessTripApplicationDraft): {
  tripType: number
  companions: string
  startTime: string
  endTime: string
  origin: string
  destination: string
  reason: string
} {
  const tripType = assertTripType(draft?.tripType)
  const companions = assertRequiredText(draft?.companions, '同行人 companions', COMPANIONS_MAX)
  const { startTime, endTime } = assertTimeOrder(draft?.startTime, draft?.endTime)
  const origin = assertRequiredText(draft?.origin, '始发地 origin', ORIGIN_MAX)
  const destination = assertRequiredText(draft?.destination, '目的地 destination', DESTINATION_MAX)
  const reason = assertRequiredText(draft?.reason, '事由 reason', REASON_MAX)
  return { tripType, companions, startTime, endTime, origin, destination, reason }
}

/**
 * 构造提交载荷 —— **逐字段复刻 `buildSubmitData()` 的产出**，
 * 键顺序照抄 `baseline/business-trip-application.browser.json` 里 `variables` 那一层
 * （实测抓包，与 `formState` 的声明顺序一致）。
 *
 * 入参是「只读联动查出来的 7 个」+「调用方填的 7 个」，合起来就是页面 `formState` 的 14 个字段。
 */
export function buildBusinessTripPayload (
  derived: BusinessTripApplicationDerived,
  draft: BusinessTripApplicationDraft,
): Record<string, unknown> {
  if (derived === null || typeof derived !== 'object') {
    throw new Error(
      '缺少只读联动的字段（applicantId / applicantName / applyDate / applyDepartmentId / ' +
        'applyDepartmentName / applyPostId / applyPostName）。用 resolveDerivedFields() 或 prepare() ' +
        '先算出来 —— 页面上这几项是 disabled 的输入框，不能由调用方编。',
    )
  }
  for (const key of [
    'applicantId',
    'applicantName',
    'applyDate',
    'applyDepartmentId',
    'applyDepartmentName',
    'applyPostId',
    'applyPostName',
  ] as const) {
    const value = derived[key]
    if (value === undefined || value === null || String(value) === '') {
      throw new Error(`只读联动字段 ${key} 缺失。它来自 GET /sys/user/info（applyDate 是门户时区的今天），不能由调用方编。`)
    }
  }
  // applyDate 必须是页面那个形状；一个别的形状发出去后端 @DateTimeFormat 直接 400
  parsePortalDate(derived.applyDate, '只读字段 applyDate')

  const normalized = normalizeBusinessTripDraft(draft)

  // 键顺序 = formState 的声明顺序（= 实测抓包里 variables 的键顺序）
  return {
    applicantId: derived.applicantId,
    applicantName: derived.applicantName,
    applyDate: derived.applyDate,
    applyDepartmentId: derived.applyDepartmentId,
    applyDepartmentName: derived.applyDepartmentName,
    applyPostId: derived.applyPostId,
    applyPostName: derived.applyPostName,
    tripType: normalized.tripType,
    companions: normalized.companions,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    origin: normalized.origin,
    destination: normalized.destination,
    reason: normalized.reason,
  }
}

/**
 * create 的完整请求体：`{...submitData, startUserSelectAssignees}`。
 *
 * 键顺序照抄 `041/page/pc/edit/index.vue` 的
 * `http.post('/admin-api/hr/business-trip-application/create', { ...submitData, startUserSelectAssignees: tasksData })`
 * —— `startUserSelectAssignees` **永远在最后**。
 */
export function buildBusinessTripCreatePayload (
  derived: BusinessTripApplicationDerived,
  draft: BusinessTripApplicationDraft,
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
    ...buildBusinessTripPayload(derived, draft),
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
  'postId',
  'postName',
  'staffId',
  'tenantId',
] as const

/**
 * 把 `/sys/user/info` 的原响应收敛成 `PortalCurrentUser`。
 *
 * **只保留白名单里的字段**，其余一律丢掉（包括 `password2` / `salt`）。
 * 导出来是为了让这条收敛本身可测 —— 不用真的打接口就能验证"密码哈希不会漏出去"。
 *
 * ⚠️ 本能力**比前几条线多要两个字段**：`postId` / `postName`（申请岗位）。
 * 它们是 `fillApplicantInfo()` 里 `hrPostService.getAllPostMap().get(postId)`
 * 那一跳的入参，缺了后端会抛「申请岗位不存在」。
 */
export function pickCurrentUser (raw: unknown): PortalCurrentUser {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('当前用户信息为空：GET /sys/user/info 没返回对象，无法填申请人/部门/岗位')
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
    throw new Error('GET /sys/user/info 的响应里没有 id，无法填 applicantId')
  }
  if (organizationId === undefined) {
    throw new Error('GET /sys/user/info 的响应里没有 organizationId，无法填 applyDepartmentId')
  }
  const picked: PortalCurrentUser = {
    id,
    numericId: Number(id),
    realName: realName ?? '',
    organizationId,
    organizationName: text('organizationName') ?? '',
  }
  for (const key of CURRENT_USER_ALLOWED_FIELDS) {
    if (
      key === 'id' ||
      key === 'realName' ||
      key === 'organizationId' ||
      key === 'organizationName'
    ) {
      continue
    }
    const value = text(key)
    if (value !== undefined) (picked as Record<string, unknown>)[key] = value
  }
  return picked
}

/**
 * 把「当前用户」映射成载荷里那 7 个只读字段。
 *
 * 单独抽出来是为了**可测**：`/sys/user/info` → 载荷的这一步映射没有任何网络，
 * 用几个对象就能把「工号不是岗位」「postId 是字符串」这些容易抄错的地方钉住。
 */
export function deriveFieldsFromUser (
  user: PortalCurrentUser,
  today: string,
): BusinessTripApplicationDerived {
  const applyDate = parsePortalDate(today, '只读字段 applyDate（门户时区的今天）')
  return {
    applicantId: user.id,
    applicantName: user.realName,
    applyDate,
    applyDepartmentId: user.organizationId,
    applyDepartmentName: user.organizationName,
    applyPostId: user.postId ?? '',
    applyPostName: user.postName ?? '',
  }
}

// ---------------------------------------------------------------------------
// 审批链守卫（**与前两条线同一份实现**，逐行照抄）
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
 * 命中时的后果是**不可逆**的：后端「流程发起人与审批人相同，自动审核通过」会批掉那个节点，
 * 若链上再没有别的待办节点，流程当场走完，`cancel-by-start-user` 从此永远报
 * 「流程取消失败，流程不处于运行中」，那条单据撤不掉、也删不掉
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
      '节点会被自动批掉、流程可能当场走完，接下来 cancel-by-start-user 必然报' +
      '「流程取消失败，流程不处于运行中」——那条单据就永远撤不掉了。' +
      '处理办法：换一个申请人（本流程的申请人是"当前登录用户"，SDK 从 GET /sys/user/info 取，' +
      '不接受调用方指定），或者换一个账号跑这条流程。',
  )
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/**
 * ★ 这一段**故意没有 `search` / `tree` 类的长选项参数**。
 *
 * 通用审批那条线要 `user-search`，是因为它有「抄送人」与「发起人自选审批人」两个人员控件。
 * 本表单**两个都没有**，而且「同行人」看着像选人、**实际是个自由文本 a-textarea**
 * （源码 `041/page/pc/edit/index.vue` 里就是 `<a-textarea v-model:value="formState.companions">`，
 * 抓包里是 `"companions":"SDK-TEST-同行人张三、李四"` 这样一整串字符串）。
 * 加一个用不到的 `user-search` 能力 = 凭空多一条没人会调、也没法在页面上对上的接口。
 */

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'tripType',
    kind: 'enum',
    required: true,
    description: '类型，必填（页面 a-select，**无默认值**）。选项是**前端本地常量**，不是服务端字典',
    options: TRIP_TYPE_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
  },
  {
    name: 'companions',
    kind: 'text',
    required: true,
    description:
      `同行人，必填，最多 ${COMPANIONS_MAX} 字。⚠️ 页面上是**自由文本 a-textarea**，` +
      '不是一个人员选择器（抓包里就是一整串字符串）——所以这里**没有**人员候选能力可以接',
  },
  {
    name: 'startTime',
    kind: 'date',
    required: true,
    description:
      `开始时间，必填，\`${PORTAL_DATE_TIME_FORMAT}\`。页面就是两个独立的 a-date-picker show-time，` +
      '**彼此之间没有任何联动**（与加班那条线不同）',
  },
  {
    name: 'endTime',
    kind: 'date',
    required: true,
    description:
      `结束时间，必填，\`${PORTAL_DATE_TIME_FORMAT}\`，**必须严格晚于 startTime**（相等也不行）。` +
      '⚠️ 三处不一致，如实记：**PC 页没有这条校验**（两个控件之间无联动），' +
      '**移动端有**（`onEndTimeConfirm` 报「结束时间必须晚于开始时间」，与后端那句一字不差），' +
      '**后端有**（`validateTime`）。SDK 按移动端/后端那个口径在本地拦 —— 见能力文件头 §四',
  },
  {
    name: 'origin',
    kind: 'text',
    required: true,
    description: `始发地，必填，最多 ${ORIGIN_MAX} 字（页面 :maxlength 与后端 @Size 一致）`,
  },
  {
    name: 'destination',
    kind: 'text',
    required: true,
    description: `目的地，必填，最多 ${DESTINATION_MAX} 字（页面 :maxlength 与后端 @Size 一致）`,
  },
  {
    name: 'reason',
    kind: 'text',
    required: true,
    description: `事由，必填，最多 ${REASON_MAX} 字（页面 :maxlength 与后端 @Size 一致）`,
  },
]

export const businessTripApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'business-trip-application-definition',
    title: '查询出差申请的流程定义',
    pagePath: BUSINESS_TRIP_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${BUSINESS_TRIP_APPLICATION_PROCESS_KEY}`,
        options: [{ label: '出差申请流程', value: BUSINESS_TRIP_APPLICATION_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'business-trip-application-current-user',
    title: '查当前登录用户（申请人 / 部门 / 岗位那几个只读字段的来源）',
    pagePath: BUSINESS_TRIP_APPLICATION_FORM_PATH,
    write: false,
    params: [],
  },
  {
    id: 'business-trip-application-approval-chain',
    title: '★ 提交前预览审批链 —— 看清会打扰谁、以及会不会撞上「发起人=审批人」',
    pagePath: BUSINESS_TRIP_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS.map((param) => ({ ...param, required: false })),
  },
  {
    id: 'business-trip-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点（本流程实测 0 个）',
    pagePath: BUSINESS_TRIP_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'business-trip-application-submit',
    title: '提交出差申请（会真的发起流程、给直属上级推待办）',
    pagePath: BUSINESS_TRIP_APPLICATION_FORM_PATH,
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
          '命中时的后果不可逆（节点被自动批掉、单据可能永远撤不掉）。默认 false（守卫开着）',
      },
    ],
  },
  {
    id: 'business-trip-application-detail',
    title: '查询单条出差申请单据',
    pagePath: BUSINESS_TRIP_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有流程实例 id**，' +
          '而且提交后 `status` 仍然是 0（待提交）—— 见 `BusinessTripApplicationRecord.status` 的说明。' +
          '要撤销得先 business-trip-application-my-instances 按 businessKey 找流程实例',
      },
    ],
  },
  {
    id: 'business-trip-application-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: BUSINESS_TRIP_APPLICATION_MY_LIST_PATH,
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
        description: `流程类型字典 bpm_process_type；本流程是 ${BUSINESS_TRIP_APPLICATION_PROCESS_TYPE}（审批）`,
        options: [
          { label: '审核', value: 1 },
          { label: '审批', value: 2 },
        ],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'business-trip-application-cancel',
    title: '取消（撤回）我发起的出差申请流程',
    pagePath: BUSINESS_TRIP_APPLICATION_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 business-trip-application-my-instances 那一行的 id',
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

export type BusinessTripApplicationOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条） */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
  /**
   * 「现在」的注入口，**只**影响 `applyDate`（门户时区的今天）。
   * 默认 `() => new Date()`；测试用它把日期钉死，免得跑在 UTC 的 CI 上跨天。
   */
  now?: () => Date
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

/** 提交时的可选项 */
export type BusinessTripApplicationSubmitOptions = {
  /** `{ [节点 id]: [用户 id, ...] }`。本流程实测没有自选节点，正常留空 */
  startUserSelectAssignees?: StartUserSelectAssignees
  /** ⚠️ 关掉「审批链里不能有发起人本人」的守卫。只在预览接口不可用时才该用 */
  skipSelfApprovalGuard?: boolean
}

export function createBusinessTripApplicationCapability (
  request: PortalRequest,
  options: BusinessTripApplicationOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE
  const now = options.now ?? (() => new Date())

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: BusinessTripInstanceQuery = {},
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
   * 当前登录用户（**只读**）。页面靠它填申请人 / 部门 / 岗位那 6 个只读字段。
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
      url: PROCESS_INSTANCE_PREVIEW_URL,
      method: 'post',
      data: {
        processDefinitionKey: BUSINESS_TRIP_APPLICATION_PROCESS_KEY,
        variables,
        startUserSelectAssignees,
        copyUserIds: [],
      },
    })
    // 后端在「流程定义不存在」时可能回 null；归一成空 nodes，免得调用方对 undefined 取 .nodes
    return { ...(result ?? {}), nodes: Array.isArray(result?.nodes) ? result.nodes : [] } as ApprovalChainPreview
  }

  /**
   * 把只读联动的 7 个字段算出来（**只读**，打一次 `/sys/user/info`）。
   *
   * 这是 `prepare` / `submit` 的第一步，也单独暴露出去，方便调用方在提交前先看一眼
   * 「申请人/部门/岗位/申请时间会被填成什么」——那几项页面上是 disabled 的，用户改不了，但看得见。
   */
  async function resolveDerivedFields (
    draft: BusinessTripApplicationDraft,
  ): Promise<ResolvedBusinessTripFields> {
    // ★ 先把调用方填的 7 个字段校完 —— **在校任何网络请求之前**。
    // 不这么做的话，一个 reason 为空的提交也会先打一次 /sys/user/info。
    normalizeBusinessTripDraft(draft)
    const user = await currentUser()
    return deriveFieldsFromUser(user, portalToday(now()))
  }

  /**
   * 按 `businessKey` 找它对应的流程实例。
   *
   * **为什么必须存在这个方法**：`cancel-by-start-user` 要流程实例 id，而
   * `GET /hr/business-trip-application/get` 的响应里**没有** `processInstanceId`。
   * 唯一的通路就是翻「我的流程」，用 `businessKey` 对上——这正是页面上点
   * 「取消流程」时拿的那个 `record.id`。
   *
   * **为什么还要按 `processDefinitionKey` 再筛一道**：`businessKey` 是各业务表**自己的主键**
   * （后端 `setBusinessKey(String.valueOf(application.getId()))`），「出差申请 51」与
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
            row.processDefinitionKey === BUSINESS_TRIP_APPLICATION_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的出差申请流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 business-trip-application-my-instances 自己按条件找。',
    )
  }

  /**
   * `prepare()` 的实现体。抽成闭包里的函数而不是对象方法，
   * 是为了让 `submit()` 能调它而**不依赖 `this`**——组装点可能把方法摘下来单独调
   * （`const { prepare } = cap`），那时 `this` 是 undefined。
   */
  async function prepareInternal (
    draft: BusinessTripApplicationDraft,
    derivedOverride?: ResolvedBusinessTripFields,
  ): Promise<{
    payload: Record<string, unknown>
    derived: ResolvedBusinessTripFields
    tasks: StartUserSelectTask[]
  }> {
    // ★ 先把调用方填的 7 个字段校完 —— **在校任何网络请求之前**
    normalizeBusinessTripDraft(draft)
    const derived = derivedOverride ?? (await resolveDerivedFields(draft))
    const payload = buildBusinessTripPayload(derived, draft)
    const tasks = await request<StartUserSelectTask[]>({
      url: BUSINESS_TRIP_TASKS_URL,
      method: 'post',
      data: payload,
    })
    return { payload, derived, tasks: Array.isArray(tasks) ? tasks : [] }
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 §一 */
    definition (key: string = BUSINESS_TRIP_APPLICATION_PROCESS_KEY): Promise<ProcessDefinition> {
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
     * ⚠️ 页面在字段不全时**不发请求**；这里也一样 —— 载荷构造会把 7 个字段连同两个时间的
     * 先后、格式一次校完，任何一条不过就在发请求之前抛。
     *
     * 与前两条线的一个**实测共性**：本流程的这个接口**也要收完整载荷**
     * （`@Valid @RequestBody`，传 `{}` 会被打回「请求参数不正确:文件名称不能为空」那一类）。
     */
    prepare: prepareInternal,

    /**
     * 真正提交（**写操作**）：创建单据**并起一条 `hr_business_trip_application` 审批流**。
     *
     * ⚠️ 它会**给真人（你的直属上级）推待办、可能发短信**。测试请：
     *   1. 事由带 `SDK-TEST-` 前缀；
     *   2. 测完立刻用 `cancel()` 撤掉。
     *
     * 请求顺序（写操作只有最后那一条）：
     *
     * ```
     * ① GET  /sys/user/info                                          只读
     * ② POST /hr/business-trip-application/getRequiredStartUserSelectTasks   页面 formSubmit() 的第一步
     * ③ POST /bpm/process-instance/preview                           ★ SDK 加的守卫
     * ④ POST /hr/business-trip-application/create                     写
     * ```
     *
     * 守卫放在 ④ 之前而不是更早，是为了保持页面上 ①→④ 的相对顺序不变；
     * 它只加一次**只读**请求，却能把"单据永远撤不掉"这件事挡在写之前。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）。⚠️ 这不是流程实例 id，
     * 撤销要先用 `findInstanceByBusinessKey()` 换。
     */
    async submit (
      draft: BusinessTripApplicationDraft,
      submitOptions: BusinessTripApplicationSubmitOptions = {},
    ): Promise<unknown> {
      // ① + 本地校验：载荷构造会把 7 个字段与两个时间一次校完；不过就在发请求之前抛
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
        url: BUSINESS_TRIP_CREATE_URL,
        method: 'post',
        data: { ...buildBusinessTripCreatePayload(derived, draft, assignees) },
      })
    },

    /** 单条单据详情（**只读**）。⚠️ 响应里没有流程实例 id、status 提交后仍是 0，见类型说明 */
    detail (id: number | string): Promise<BusinessTripApplicationRecord> {
      const wanted = String(id ?? '').trim()
      if (wanted === '') throw new Error('出差申请单据 id 不能为空')
      return request<BusinessTripApplicationRecord>({
        url: BUSINESS_TRIP_DETAIL_URL,
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
                'processInstanceId 来自 business-trip-application-my-instances，' +
                'businessKey 就是 submit 返回的业务单据 id',
            ),
          )
        }
        const instance = await findInstanceByBusinessKey(params.businessKey)
        id = String(instance.id)
      }
      return request({
        url: PROCESS_INSTANCE_CANCEL_URL,
        method: 'delete',
        data: { id, reason },
      })
    },
  }
}

export type BusinessTripApplicationCapability = ReturnType<typeof createBusinessTripApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与前面几条线同样的分工：`withIdempotency` 需要**身份**（租户 / 用户），
 * 那是会话层的东西，所以包装放在组装点。
 *
 * **为什么这一条也需要防重**：后端零幂等，重发一次就是**第二条流程实例 + 第二串真人待办**。
 * 而且本流程的审批人是系统算出来的直属上级——发重了，打扰的是同一个人两次。
 */
export type BusinessTripApplicationCapabilityWithIdempotency = BusinessTripApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * `requestId` 由调用方生成并保管，超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: BusinessTripApplicationDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
      skipSelfApprovalGuard?: boolean
    },
  ) => Promise<unknown>
}
