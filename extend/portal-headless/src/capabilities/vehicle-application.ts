import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
// ⚠️ **只能 import type**，不能 import 任何**值**。理由不是风格，是会当场炸：
// `smoke/vehicle-application.mjs` 直接从 `src/` 读这个文件（Node 22 的类型剥离，
// 不用先 `pnpm build`），而 Node 的类型剥离**不会把 `./x.js` 改写成 `./x.ts`**
// ——实测 `ERR_MODULE_NOT_FOUND: .../general-approval.js`。
//
// 代价是 `assertAssigneesForTasks` 在这里有一份复刻（见下），
// `test/vehicle-application.test.ts` 里有一条**三份实现逐例对照**的测试钉住它们不漂移。
import type {
  ProcessInstanceRow,
  StartUserSelectAssignees,
  StartUserSelectTask,
} from './general-approval.js'

/**
 * 用车申请（用车审批，`vehicle_usage_application`）—— 流程表单这一类里
 * **唯一一个「申请人」本身是一个按组织分页查的人员控件**的流程。
 *
 * 页面：`/simple/hr/form/031`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=vehicle_usage_application&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/031
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）——与通用审批 / 请假同一条路。
 *
 * 模板是 `src/capabilities/leave-application.ts` 与 `general-approval.ts`（同族形态：
 * definition / prepare / submit / detail / my-instances / cancel + 写链路防重）。
 * **能复用的一律 import，不抄第二份** —— 但只限**类型**，见上面的导入注释。
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：接口里没有，在前端源码 + 真实页面里
 * ---------------------------------------------------------------------------
 *
 * 与另外两条流程表单线一样，两条路都拿不到字段【实测，2026-09-21 测试环境】：
 *
 * - `GET /bpm/process-definition/get?key=vehicle_usage_application` →
 *   `formFields: null`、`formCustomCreatePath: null`
 *   （⚠️ 但 `startUserSelectTasks` 这次**不是 null** —— 见 §五）
 * - `GET /bpm/process-definition/create-list?...` → **只有它**给出
 *   `formCustomCreatePath: "simple/hr/form/031"`
 *
 * ⇒ 字段只能读 `app/portal/views/simple/hr/form/031/` 的
 * `common/index.js`（`buildVehicleUsageSubmitData`）与
 * `page/pc/edit/index.vue`（模板 + `formRules`）。
 *
 * ⚠️ **一条与 `docs/process-forms.md` 不符、必须记下来的事**：那个文件（2026-09-20 调查）
 * 说 031 的申请人走 `POST /org/staff/getStaffByOrg`（数组入口）。**测试环境上跑的那个
 * 构建已经不是了**——2026-09-21 抓包实测，页面上发的是
 * `POST /org/staff/getStaffByOrgPage`（**分页**入口）。见 §三，那一节是本文件最值钱的部分。
 *
 * ---------------------------------------------------------------------------
 * 二、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面控件 | formState 字段 | 载荷字段 | 形态 | 本地校验 | SDK 参数 |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | 1 | 申请人 | `applicantId` | **`staffId` + `staffName`** | `a-select`（按组织远程分页） | required；选不到人就整体不成立 | `staffId` + `staffName` |
 * | 2 | 用车事由 | `reason` | `reason` | `a-textarea` maxlength 500 | required，≤500 | `reason` |
 * | 3 | 时间段 | `timeRange` | **`startTime` + `endTime`** | `a-range-picker` + showTime | required；**结束必须严格晚于开始** | `startTime` + `endTime` |
 * | 4 | 用车目的地 | `destination` | `destination` | `a-input` maxlength 200 | required，≤200 | `destination` |
 * | 5 | 备注 | `remark` | `remark`（空时是 `''`） | `a-textarea` maxlength 500 | 可选，≤500 | `remark` |
 * | 6 | 审批人 | `bpmStartUserSelectAssignees` | `startUserSelectAssignees` | **3 个「发起人自选」节点** | 每个节点**恰好 1 人** | `startUserSelectAssignees` |
 * | 7 | 「查看审批流程」预览 | —— | —— | 只读按钮 | —— | **不做**（见「尚未覆盖」） |
 *
 * **七类控件全部表达到了**（其中 6 是必填的写链路，7 是只读展示件）。
 *
 * ⚠️ 与另外两条流程表单线相比，本流程有**两处形状不一样**，都是这条线最容易做错的地方：
 *
 * 1. **一个控件产两个字段的地方有两处**（时间段 → `startTime`/`endTime`；
 *    申请人 → `staffId`/`staffName`），而请假的复合日期控件只产一处。
 * 2. **审批人节点是 3 个、每个恰好 1 人**（请假是 0 个、通用审批是 1 个）。
 *
 * ---------------------------------------------------------------------------
 * 三、★ 申请人：页面自己的数组入口**已经被后端关掉了**，SDK 走它的分页继任者
 * ---------------------------------------------------------------------------
 *
 * ### 3.1 实测：旧入口在这个环境上直接报错
 *
 * `docs/process-forms.md` §5.3 第 3 条警告过这件事（「无头不能照抄按组织全量拉人」）。
 * 而 2026-09-21 只读实测发现：**不止是"不该照抄"，是根本抄不动了**。
 * 把页面当初算出来的那 10 个二级组织 id 原样 POST 给数组入口：
 *
 * ```text
 * POST /org/staff/getStaffByOrg   body: ["35","36","37","71","467","3997","4026","4094","4099","4111"]
 * → code 500, msg: 员工超过1000条，请升级客户端并使用分页选择器，不支持全量数组加载
 * ```
 *
 * 后端源码（`HrStaffServiceImpl.getStaffByOrgLegacyHttp` + `requireCompleteStaffPickerLegacy`）
 * 对得上：**数组入口每页只取 1000 条，超过就明确让客户端去用分页入口**。
 *
 * ### 3.2 所以「照抄浏览器」这件事在这里**做不到**，只能跟浏览器**现在**发的那一条
 *
 * 2026-09-21 在真实表单页上抓到的（`baseline/vehicle-application.browser.json`）：
 *
 * ```jsonc
 * POST /admin-api/org/staff/getStaffByOrgPage
 * {"organizationIds":["35","36","37","71","467","3997","4026","4094","4099","4111"],
 *  "includeDescendants":true,"keyword":"","pageNo":1,"pageSize":20,"selectedStaffIds":[1163]}
 * ```
 *
 * 也就是：**页面上跑的那个构建已经换成 `getStaffByOrgPage` 了**，源码在
 * `Projects_Js` 的 `test/portal/main` 分支（`common/hooks/paged-options.js` +
 * `views/simple/hr/form/031/common/use-applicants.js`，commit `f02b84ba9db`
 * 「fix(hr): 适配人员选择分页及权限回显」，2026-09-15）。
 * **本仓库里 checked-out 的那个分支是旧的**，这一点值得单独记住：
 * 遇到「源码与实测不符」，以**实测**为准，并把差额写下来。
 *
 * ### 3.3 SDK 因此暴露的那两条
 *
 * - `applicant-scope` —— 页面 `getVehicleUsageOrganizationRoots(organizationStore.state)`：
 *   把组织树每个顶层节点的 `children` 摊平（没有 `children` 就取自己），去重、去空。
 *   实测就是上面那 10 个 id。页面自己在 `use-applicants.js` 里有一条
 *   「**根组织超过 50 个**就报错」的守卫，SDK 复刻它（`ORG_ROOT_MAX`）。
 * - `applicant-picker` —— 包 `getStaffByOrgPage` 那一条，参数与守卫逐条对齐
 *   `usePagedOptions` / `HrStaffByOrgPageReqDTO`：`pageSize` 默认 20、**上限 100**
 *   （后端 `@Max(100)`，SDK 在本地就拦，免得发一个注定 400 的请求）；
 *   `keyword` 默认 `''`；`selectedStaffIds` 上限 100。
 *
 * ### 3.4 长选项：这里**不是**关键字强制的那一类，理由要写清楚
 *
 * 设计 D6 / H35 说「长选项参数必须先要关键字」。**入口不是关键字的那种不能硬套**：
 * 本控件的第一入口是**组织范围**（页面的搜索只是可选的收窄），而
 * `getStaffByOrgPage` 是**分页**接口 —— 一次最多 100 条、默认 20 条。
 * 「一次拉 4500 人」那件事在这里**从接口形状上就不可能发生**（后端 `@Max(100)`）。
 * ⇒ 所以 `applicant-picker` 不强制 keyword，但**强制分页**。
 * 真正需要关键字强制的**是审批人候选**（§五），那边页面确实在无关键字翻 9 页 × 500。
 *
 * ⚠️ 有一件事 SDK **不**做、也不该做：**替调用方把 `applicant-scope` 的 10 个根组织
 * 当成默认值**去全量翻页。分页的边界由调用方自己按 `total` 决定。
 *
 * ---------------------------------------------------------------------------
 * 四、⚠️ 审批人**绝对不要选发起人本人** —— 本流程比另外两条线更容易踩
 * ---------------------------------------------------------------------------
 *
 * 后端 `BpmTaskServiceImpl`（源码直读）有一条：
 *
 * ```java
 * Long startUserId = NumberUtils.parseLong(instance.getStartUserId());
 * Long taskAssigneeId = NumberUtils.parseLong(task.getAssignee());
 * if (startUserId != null && startUserId.equals(taskAssigneeId)) {
 *     autoApproveReqVO.setReason("流程发起人与审批人相同，自动审核通过");
 *     approveTask(taskAssigneeId, autoApproveReqVO);
 * }
 * ```
 *
 * 两边比的都是 **userId**（不是 `staffId`，见 §六）。
 *
 * **为什么本流程特别危险**：请假的审批人是 BPMN 写死的（选不了），通用审批只有 1 个自选节点，
 * 而**用车有 3 个自选节点**。选错一个 → 那个节点当场通过；**三个都选到发起人本人 →
 * 整条流程在 `create` 返回之前就走完**，`cancel-by-start-user` 必然报
 * 「流程取消失败，流程不处于运行中」，于是**永久留下一条撤不掉的单据**。
 * 用户 2026-09-21 的授权原文里把这一条单列了出来，要求「写成冒烟脚本的提交前拒绝」。
 *
 * ⇒ SDK 把判据做成**纯函数** `findSelfApproverConflicts()` / `assertApproversNotSelf()`，
 * **不在 `submit` 里自动拦**：页面不拦（人自己选得明白），而 `submit` 是「忠实复刻页面」的地方。
 * 拦它的是 `smoke/vehicle-application.mjs` 的提交前拒绝 —— 以及任何愿意调用这个纯函数的调用方。
 *
 * ---------------------------------------------------------------------------
 * 五、审批人节点：3 个「发起人自选」，每个**恰好 1 人**
 * ---------------------------------------------------------------------------
 *
 * `POST /hr/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks`
 * 【实测，2026-09-21，原样记进基准文件】：
 *
 * ```jsonc
 * {"code":0,"ret":"SUCCESS","data":[
 *   {"id":"Activity_0yx86ms","name":"发起人自选","approvalMode":"SINGLE","approvalModeName":"单人审批",
 *    "executionMode":"SINGLE","completionRule":"ALL_APPROVED","minSelectCount":1,"maxSelectCount":1,
 *    "selectionOrderRequired":false,"approvalDescription":"仅可选择一名审核人；该人员通过后节点通过"},
 *   … Activity_0q8l1yc 同上 …
 *   … Activity_0viq4cx 同上 …]}
 * ```
 *
 * BPMN 原文（`process-definition/get` 的 `bpmnXml`）与之完全吻合：
 * `开始 → 发起人自选 → 发起人自选 → 发起人自选 → 结束`，
 * 三个 `userTask` 的 `flowable:candidateStrategy` 都是 **35 = `START_USER_SELECT`**，
 * 而且 **没有网关、没有 `${...}` 条件表达式**（请假有两个网关条件，这里一个都没有）。
 *
 * ⚠️ 三个节点的 `name` **一模一样**（都叫「发起人自选」），**只有 id 不同** ——
 * 所以调用方不能按名字选，必须按 `id` 给 `{ [taskId]: [userId] }`。
 *
 * ⚠️ 两条接口名字的坑（`docs/process-forms.md` §5.3 第 1 条）：后端
 * `VehicleUsageApplicationController` **两个都写了**
 * （`/getRequiredStartUserSelectTasks` 与 `/getTemporaryRequiredStartUserSelectTasks`），
 * **前端用的是后者**。实测两个都返回一样的内容，SDK 跟前端走，用后者。
 * `definition()` 返回的 `startUserSelectTasks` 这次**有值**（那三个 id）—— 但它是
 * **流程定义级的**，与 `prepare` 按当前载荷算出来的节点是两回事，**不要拿它代替 prepare**。
 *
 * ### 5.1 审批人候选的来源（长选项，**必须带关键字**）
 *
 * 页面 `common/libs/flow-form/index.js` 的 `getStartUserSelectTasks()` 是
 * `GET /system/user/simple-list`（**全量**）。实测抓包里它翻成了
 * `/system/user/simple-page?pageNo=1..9&pageSize=500` = **9 页 × 500 = 4500 人**，
 * 与请假那条线的预览组件同一个数量级。
 * **无头下不能照抄** → `approver-search` 复用通用审批那套：
 * `GET /system/user/simple-page`，**必须给 keyword 或 deptId**，拒 `pageSize = -1`。
 *
 * ⚠️ 这里是 **userId**（`/system/user/simple-page` 的 `id`，如 18243），
 * 与申请人的 **staffId**（如 1163）**不是一个 id 空间**。混用会选到错的人。
 *
 * ---------------------------------------------------------------------------
 * 六、`applicantId` → `staffId`/`staffName`：载荷**不是表单字段直传**
 * ---------------------------------------------------------------------------
 *
 * 这是 `docs/process-forms.md` §5.3 第 2 条说的那处映射，
 * 逐字来自 `common/index.js` 的 `buildVehicleUsageSubmitData()`：
 *
 * ```js
 * const selectedUser = userList.find(item => Number(item.value) === Number(formState.applicantId))
 * if (!selectedUser || selectedUser.disabled || !(selectedUser.staffId || selectedUser.id)) return null
 * return {
 *   staffId: selectedUser.staffId || selectedUser.id,   // ← 不是 applicantId
 *   staffName: selectedUser.name || selectedUser.realName,
 *   reason, startTime, endTime, destination,
 *   remark: formState.remark || '',
 * }
 * ```
 *
 * 三个必须记住的性质：
 *
 * 1. **`staffId` 是字符串。** `getStaffByOrgPage` 的 `id`/`staffId` 序列化成 `"1163"`，
 *    页面原样发（浏览器抓包实测 `"staffId":"1163"`）。SDK 也发字符串。
 * 2. **选不到人 ⇒ 整个载荷为 `null`**，于是 `canRefreshVehicleUsageApproval()` 为假、
 *    页面**连审批人节点都不去问**。SDK 的 `assertDataComplete()` 复刻这条。
 * 3. **空备注是 `''`，不是 `undefined`**（`formState.remark || ''`）。
 *
 * ⚠️ `staffName` **后端会用 `staffId` 自己重查一遍并覆盖**
 * （`VehicleUsageApplicationServiceImpl.getStaffNameById()` → `application.setStaffName(...)`），
 * 所以填错不会造成数据错，但**为了 D20 的逐字段一致仍然要发**（浏览器发什么 SDK 发什么）。
 *
 * ### 6.1 时间段的两个字段
 *
 * 页面上「时间段」是**一个** `a-range-picker`（`show-time`，`value-format="YYYY-MM-DD HH:mm:ss"`），
 * `handleTimeRangeChange(dates)` 把它拆成 `startTime`/`endTime` 两个字段。
 * 两条本地校验，页面的与后端的一致：
 *
 * | 位置 | 判据 |
 * | --- | --- |
 * | 页面 `validateTimeRange` | `end.isBefore(start) \|\| end.isSame(start)` → 拒绝 |
 * | 后端 `validateTimeRange` | `!(endTime.isAfter(startTime))` → `exception("结束时间必须大于开始时间")` |
 *
 * ⇒ **结束必须严格晚于开始**，相等也不行。SDK 的 `assertTimeOrder()` 逐字复刻，
 * 且**在发请求之前**跑。
 *
 * ### 6.2 一处刻意的偏离：页面上那一次挂载请求是**注定 400 的**，SDK 不发
 *
 * `getTemporaryRequiredStartUserSelectTasks` 的参数是 `@Valid VehicleUsageApplicationCreateReqVO`，
 * 而它继承的 `VehicleUsageSubmitReqVO` 上写着 `@NotBlank reason` / `@NotNull startTime` /
 * `@NotNull endTime` / `@NotBlank destination`。于是【实测，2026-09-21】：
 *
 * ```text
 * 全空（浏览器基准里那条，逐字节） → 400 请求参数不正确:结束时间不能为空
 * 只缺 reason                    → 400 请求参数不正确:用车事由不能为空
 * 只缺 startTime/endTime         → 400 请求参数不正确:开始时间不能为空
 * 只缺 destination               → 400 请求参数不正确:用车目的地不能为空
 * 全齐                            → 200，3 个节点
 * ```
 *
 * 而页面挂载时的 `refreshApprovalTasks()` 用的闸是 `canRefreshVehicleUsageApproval()`
 * ——**只要选得到人就发**，不要求另外四个字段。抓包证实它确实发了（body 里
 * `reason`/`startTime`/`endTime`/`destination` 全是空串），也确实被拒了；
 * 页面上那三个「审批人」下拉因此落在「获取审批候选人失败 / 点击重试」的状态。
 *
 * ⇒ SDK 把这个闸**抬到后端的实际要求**：`assertApplicantResolvable()`（页面的闸）
 * **加** `assertDataComplete()`（字段齐全），两个都过才发请求。
 * 这与请假的 `assertDraft()` 是同一条理由：**能让它红在第一个字节之前，就红在第一个字节之前**。
 * 代价是「SDK 不会重放基准里那一条 body」—— 那条 body 是**被后端拒绝的**，
 * 重放它不是忠实，是照抄一个错误。
 *
 * 顺带记两条这一轮打出来的边界：**「结束早于开始」这个接口不拦**
 * （那条校验只在 `create` 的 `validateTimeRange` 里），**时间戳写成 ISO 会被拒**
 * （`Text '2026-10-01T09:00:00' could not be parsed at index 10`）——两条都印证了
 * 格式必须严格是 `YYYY-MM-DD HH:mm:ss`。
 *
 * ---------------------------------------------------------------------------
 * 七、撤销：`RespVO` 这次**有** `processInstanceId`，但还是留了按 businessKey 找的兜底
 * ---------------------------------------------------------------------------
 *
 * 通用审批与请假的详情响应里**没有**流程实例 id，所以那两条线的 `cancel` 只能翻
 * 「我的流程」按 `businessKey` 认。**用车不一样**：`VehicleUsageApplicationRespVO`
 * 有 `processInstanceId` 字段，`RespVO` 直接 `BeanUtils.toBean(DO)` 而来，而
 * `startBpmProcess()` 把流程实例 id 写回了 DO（`application.setProcessInstanceId(...)`）。
 *
 * ⇒ `resolveProcessInstanceId()` **先试 `detail().processInstanceId`**，
 * 拿不到再退回 `findInstanceByBusinessKey()`。两条路都保留：
 * 前者少一次翻页，后者是页面上真实发生的那条（`flow/task/my/list.vue` 的
 * `actionCancel(record.id)` 取的就是 my-page 那一行的 `id`）。
 *
 * ⚠️ 用车**没有**自己的 cancel 控制器端点 —— 实测
 * `PUT/DELETE /hr/vehicle-usage-application/cancel/0` 都是 **404**。
 * （源码里 `VehicleUsageApplicationService.cancelApplication` 存在，但**没有映射到 Controller**，
 * 所以它只能被流程监听器用到、页面上走不到。）撤销一律走通用的
 * `DELETE /bpm/process-instance/cancel-by-start-user`，body `{ id: <流程实例 id>, reason }`。
 *
 * ---------------------------------------------------------------------------
 * 八、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/031`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里**一条都匹配不到**
 * （那张表全是 `/dashboard/<域>/…` 前缀，没有 `/dashboard/flow/`），
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器在表单页上同样不发
 * 【实测，2026-09-21 抓包：`getStaffByOrgPage` 与 `getTemporaryRequiredStartUserSelectTasks`
 * 的请求头里都没有 `module-type`】。
 *
 * ---------------------------------------------------------------------------
 * 九、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **「查看审批流程」预览**（`portal-hxr-flow-process-preview`，打
 *   `/bpm/process-instance/preview`）没做。它是**只读的展示件**，不影响能不能提交。
 *   ⚠️ 但它有一个值得记住的性质：它自己 `GET /system/user/simple-list` +
 *   `simple-page?pageNo=1..9&pageSize=500` **无关键字拉了 4500 人**，就为了把
 *   BPMN 里的审批人解析成名字 —— 与请假那条线同一处（设计 D6 / H35）。
 *   本 SDK 的候选一律带关键字，所以也不存在照抄它的机会。
 * - **扫「无权限/已离职但已选」的回显**（`mapMissingOption` →
 *   `已失效或无权限（id）` + `disabled: true`）没做成独立能力：
 *   它落在 `applicant-picker` 的 `selectedItems` 里，调用方拿那一项就能看出
 *   它是不是可用（`status` 不在 `[1,4,5]` 就是不可用）。页面因此在
 *   `getUserListInfo()` 末尾有一条「回显失败就把 applicantId 清空」的逻辑，SDK 不模拟它
 *   （那是控件的状态机，不是接口语义）。
 * - **`PUT /update` 与 `DELETE /delete/{id}` 没做**：后端限定「只有已驳回状态
 *   （`status = 3`）才能改/删」（`VehicleUsageApplicationServiceImpl` 的两条状态判断）。
 *   而页面上的编辑分支**前端是注释掉的**（`handleSubmit` 里 `isEditMode` 那三行是注释，
 *   `apiSubmit` 写死成 `/create`），所以**页面上根本走不到这两个入口**。
 *   要造一条「已驳回」的单据得先让真人去驳回 —— 那是第三方的动作，本轮做不到。
 *   实现一个页面上不存在、又验证不了的写操作，不叫"完整"，叫"多做了没验过的东西"。
 * - **`GET /hr/vehicle-usage-application/page` 分页与导出没做**：页面**没有任何地方调它们**
 *   （全仓库 grep 只有 `form/031` 那几个调用点，且都是 create/get/required-tasks）。
 *   要"查用车记录"，本能力给的是 `detail(id)` 与 `myInstances()` 两条**页面上真的走了**的路。
 * - **手机端表单（`page/mobile/edit`）没单独做**：它是同一套 `common/index.js`
 *   与同一个 `create` 接口，字段与校验与 PC 端一致（`docs/pages/用车申请.md` 记了差异：
 *   移动端把审批人折叠成一段说明文字）。SDK 是页面无关的，所以**不分端**。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与会议室 / 通用审批 / 请假同一个壳） */
export const VEHICLE_APPLICATION_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**，所以 prepare / submit / detail
 * 声明在这个页面上下文里。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测】返回 `simple/hr/form/031`。
 */
export const VEHICLE_APPLICATION_FORM_PATH = '/simple/hr/form/031'

/** 「我的流程」页。**取消流程的入口在这里**，不在表单页。 */
export const VEHICLE_APPLICATION_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自表单入口 URL、`create-list`、以及后端 `VehicleUsageApplicationProcessInstanceVariableBuilder.PROCESS_DEFINITION_KEY` */
export const VEHICLE_APPLICATION_PROCESS_KEY = 'vehicle_usage_application'

/** 「我的流程」列表里认出本流程的那一行：`processDefinitionKey`（本流程是「审批」类，实测） */
export const VEHICLE_APPLICATION_PROCESS_TYPE = 2

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 form/031 的模板属性、formRules 与后端 VO）
// ---------------------------------------------------------------------------

/** `a-textarea` 的 `:maxlength="500"` + `formRules.reason` 的 `max: 500`（后端 `@Size(max = 500)`） */
export const REASON_MAX = 500
/** `a-input` 的 `:maxlength="200"` + `formRules.destination` 的 `max: 200`（后端 `@Size(max = 200)`） */
export const DESTINATION_MAX = 200
/** `a-textarea` 的 `:maxlength="500"` + `formRules.remark` 的 `max: 500`（后端 `@Size(max = 500)`） */
export const REMARK_MAX = 500

/**
 * 申请人选择器只保留的**在职状态**（`mapVehicleUsageUserOptions` 的
 * `ACTIVE_STAFF_STATUS_LIST = [1, 4, 5]`）。
 *
 * 后端 `HrStaffDTO.status`：`1 在职 / 2 离职 / 3 退休 / 4 返聘 / 5 在编不在岗`。
 * 页面把不在这个集合里的行**整个丢掉**（不是置灰）——SDK 的 `isActiveStaffStatus()`
 * 复刻它，供调用方在 `applicant-picker` 的结果上做同一判断。
 */
export const APPLICANT_ACTIVE_STATUS_LIST = [1, 4, 5] as const

/**
 * 申请人选择器的**根组织个数上限**（页面 `use-applicants.js` 的
 * `if (organizationIds.length > 50) throw new Error('可选根组织超过50个，请联系管理员调整组织入口')`）。
 *
 * 后端 `HrStaffByOrgPageReqDTO.organizationIds` 也有 `@Size(max = 50)`（实测：
 * 给 51 个会 400）。SDK 在本地拦，免得发一个注定失败的请求。
 */
export const ORG_ROOT_MAX = 50

/**
 * 申请人选择器每页条数：默认 20、**上限 100**。
 *
 * 两个数字都来自后端与页面，不是拍的：`HrStaffPickerPageReqDTO` 是
 * `@Min(1) @Max(100)`（实测 pageSize=101 → `400 请求参数不正确:最大不能超过100`），
 * 页面 `usePagedOptions` 的 `MAX_PAGE_SIZE = 100` 正是照着它写的。
 */
export const APPLICANT_PAGE_SIZE_DEFAULT = 20
export const APPLICANT_PAGE_SIZE_MAX = 100

/** `selectedStaffIds`（回显已选）的上限，后端 `@Size(max = 100)` */
export const APPLICANT_SELECTED_MAX = 100

/** 本流程的审批人节点数。**不是硬编码的规则，是实测值**（BPMN 里恰好三个自选节点） */
export const APPROVER_NODE_COUNT_OBSERVED = 3

/** 审批人候选搜索的每页条数上限（与通用审批那条线同一套保护） */
export const APPROVER_PAGE_SIZE_DEFAULT = 20

/**
 * 时间字段的格式。页面 `a-range-picker` 的 `value-format="YYYY-MM-DD HH:mm:ss"`，
 * 后端 `@DateTimeFormat(pattern = DateUtils.FORMAT_YEAR_MONTH_DAY_HOUR_MINUTE_SECOND)`
 * 也是这一个。**两边一模一样**，所以 SDK 只认这一种写法。
 */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/** `GET /org/staff/getStaffByOrgPage` 的入口（页面申请人控件的真实数据源） */
export const APPLICANT_PICKER_URL = '/org/staff/getStaffByOrgPage'

/**
 * 审批人节点接口。**用的是 `getTemporary…` 那个变体** —— 后端的
 * `VehicleUsageApplicationController` 两个都写了，前端用的是这个（见文件头 §五）。
 */
export const REQUIRED_TASKS_URL = '/hr/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * 提交 / prepare 的载荷（调用方给的那部分）。
 *
 * ⚠️ **字段名用的是载荷名（`staffId`/`staffName`），不是页面表单名（`applicantId`）** ——
 * 因为这两项隔着一次映射（`buildVehicleUsageSubmitData`），而 SDK 没有"选择器"这个
 * 中间物，调用方拿到的就是选择器那一行的 `staffId`/`staffName`（见
 * `VehicleStaffOption`）。**没有 `id` 字段**：`handleSubmit` 的编辑分支前端已注释掉。
 */
export type VehicleApplicationDraft = {
  /**
   * 申请人**员工 id（staffId）**，必填。⚠️ **不是 userId** ——
   * 审批人用的是 userId，两者不是一个 id 空间（见文件头 §五）。
   * 取值来自 `applicant-picker` 那一行的 `staffId`。
   * 载荷里它是**字符串**（浏览器发的是 `"1163"`，SDK 原样发）。
   */
  staffId: string | number
  /**
   * 申请人姓名，必填。来自 `applicant-picker` 那一行的 `name || realName`。
   * ⚠️ 后端会用 `staffId` 重查并**覆盖**它，所以填错不会造成数据错；
   * 但为了与浏览器逐字段一致仍然要发。
   */
  staffName: string
  /** 用车事由，必填，≤500 字 */
  reason: string
  /** 开始时间，`YYYY-MM-DD HH:mm:ss`，必填（与 `endTime` 是**同一个控件** `a-range-picker` 的两半） */
  startTime: string
  /** 结束时间，`YYYY-MM-DD HH:mm:ss`，必填。**必须严格晚于 `startTime`** */
  endTime: string
  /** 用车目的地，必填，≤200 字 */
  destination: string
  /** 备注，可选，≤500 字。不给时载荷里是 `''`（页面 `formState.remark || ''`） */
  remark?: string
}

/**
 * `applicant-picker` 返回的一行 —— 就是 `HrStaffPickerOptionDTO` 的字段。
 *
 * ⚠️ `id` 与 `staffId` 实测**同值**（都是员工 id），`staffCode`/`username` 同值（都是工号）。
 * 页面 `mapVehicleUsageUserOptions()` 把它们合成
 * `{ label: `姓名(工号)`, value: Number(id || staffId) }`，
 * 而 `buildVehicleUsageSubmitData()` 取的是 `staffId || id` 与 `name || realName`。
 * SDK 不做这层合成，**原样返回后端给的行**，把映射留给调用方（也留给文档讲清楚）。
 */
export type VehicleStaffOption = {
  /** 员工 id（与 `staffId` 同值）。⚠️ 它是**字符串** */
  id?: string | number
  /** 员工 id。`buildVehicleUsageSubmitData` 优先取的就是它 */
  staffId?: string | number
  /** 工号 */
  staffCode?: string | number
  /** 工号（与 `staffCode` 同值） */
  username?: string | number
  /** 姓名 */
  name?: string
  /** 姓名（与 `name` 同值） */
  realName?: string
  /** 在职状态 1 在职 / 2 离职 / 3 退休 / 4 返聘 / 5 在编不在岗 */
  status?: number
  organizationId?: string | number
  organizationName?: string
  [key: string]: unknown
}

/** `POST /org/staff/getStaffByOrgPage` 的响应 */
export type VehicleApplicantPage = {
  list?: VehicleStaffOption[]
  total?: number | string
  /** 给了 `selectedStaffIds` 时，后端额外回一份"已选中的那些行" */
  selectedItems?: VehicleStaffOption[]
  [key: string]: unknown
}

/**
 * `GET /hr/vehicle-usage-application/get` 的响应（后端直接回 `VehicleUsageApplicationRespVO`）。
 *
 * ⚠️ 与通用审批 / 请假那条线**不一样**：**这个 VO 有 `processInstanceId`**，
 * 所以 `cancel` 可以不翻「我的流程」（见文件头 §七）。
 *
 * ⚠️ **两个实测出来的坑（2026-09-21 真实提交后回读）**：
 *
 * 1. **刚 create 完，`status` 是 `0`** —— `createApplication()` 从头到尾没有
 *    `application.setStatus(...)`，所以 DO 里那一列是数据库默认的 0（`DRAFT 待提交`），
 *    而**流程已经在跑了**。别拿 `detail().status` 判「这条流程还活着吗」，
 *    它刚建出来就是 0。要判活看「我的流程」那一行的 `status`（1 = 审批中）。
 *    （`status` 变成 4 是**流程监听器**干的：`VehicleUsageApplicationWorkflowListener`
 *    在取消/通过/驳回时 `updateStatusByBusinessKey`，不是 `create` 干的。）
 * 2. **`statusName` 恒为 `null`** —— `BeanUtils.toBean(DO, RespVO)` 只能从 DO 拷字段，
 *    而 `VehicleUsageApplicationDO` 里**没有** `statusName` 这一列。
 *    要中文状态名请用 `status` 对 `VehicleUsageStatusEnum` 自己映射。
 */
export type VehicleApplicationRecord = {
  id?: number
  /** 申请人员工 id（注意后端这个字段叫 `staffId`，不是 `applicantId`） */
  staffId?: number | string
  staffName?: string
  reason?: string
  /** 详情里是 `YYYY-MM-DD HH:mm:ss` 字符串（DO 里是 `LocalDateTime`，Jackson 按这个格式序列化） */
  startTime?: string
  endTime?: string
  destination?: string
  remark?: string
  /**
   * 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消（`VehicleUsageStatusEnum`）。
   *
   * ⚠️ **刚 create 完它是 0**（`createApplication` 没 setStatus），**不是 1**。
   * 只有流程监听器在通过/驳回/取消时会改它。
   */
  status?: number
  /** ⚠️ **恒为 `null`**：DO 里没有这一列，`BeanUtils.toBean` 拷不过来。见上 */
  statusName?: string
  /** **流程实例 id**（`cancel` 要的就是它）。与通用审批那条线**不同，这里真有值** */
  processInstanceId?: string
  creator?: number
  createTime?: string
  [key: string]: unknown
}

export type VehicleInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

/** 审批人候选（`GET /system/user/simple-page` 的一行），只列本能力用得到的字段 */
export type VehicleApproverOption = {
  /** **userId** —— `startUserSelectAssignees` 里要的就是它（不是 staffId） */
  id: number
  nickname?: string
  code?: string
  deptId?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

/**
 * 校验时间字段。**只认 `YYYY-MM-DD HH:mm:ss`** —— 页面 `a-range-picker` 的
 * `value-format` 与后端 `@DateTimeFormat` 都是它，别的写法后端不会当时间解析。
 *
 * 除了格式还要**真的是一个存在的时刻**：`2026-02-31` 过得了正则。
 * 与页面一致（dayjs 格式化出来的必然是真实日期），这里只是把不可能的值提前挡住。
 */
export function assertDateTime (value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATETIME_PATTERN.test(value)) {
    throw new Error(
      `${label}必填，且必须是 \`${DATETIME_FORMAT}\` 格式的字符串` +
        `（页面 a-range-picker 的 value-format，后端 @DateTimeFormat 也是它），收到 ${JSON.stringify(value)}`,
    )
  }
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = value.match(DATETIME_PATTERN) as RegExpMatchArray
  const [year, month, day, hour, minute, second] = [yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr].map(Number) as [
    number, number, number, number, number, number,
  ]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label}不是一个真实存在的日期：${value}`)
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label}的时间部分不合法（时分秒要落在 00-23 / 00-59 / 00-59）：${value}`)
  }
  return value
}

/**
 * 「结束必须**严格**晚于开始」—— 页面与后端各有一份**判据相同**的校验：
 *
 * - 页面 `form/031` 的 `validateTimeRange`：`end.isBefore(start) || end.isSame(start)` → 拒绝
 * - 后端 `VehicleUsageApplicationServiceImpl.validateTimeRange`：`!endTime.isAfter(startTime)` → 拒绝
 *
 * 注意「相等」也不合法（页面的 `isSame` 那一支就是为了它）。断言失败时抛错，
 * 文案照抄后端的 `结束时间必须大于开始时间`。
 *
 * 用字符串比较而不是 dayjs：入参已过 `assertDateTime()`，是定宽的
 * `YYYY-MM-DD HH:mm:ss`，这个格式下字典序就是时间序。**零新增依赖**（本包不带 dayjs）。
 */
export function assertTimeOrder (startTime: unknown, endTime: unknown): void {
  const start = assertDateTime(startTime, '开始时间 startTime')
  const end = assertDateTime(endTime, '结束时间 endTime')
  if (end <= start) {
    throw new Error(
      '结束时间必须大于开始时间（页面 validateTimeRange 与后端 validateTimeRange 一致：' +
        '结束早于**或等于**开始都不合法）。这条在**发请求之前**就拦下',
    )
  }
}

/** 页面上 `end.isBefore(start) || end.isSame(start)` 的布尔版本 */
export function isTimeOrderInvalid (startTime: unknown, endTime: unknown): boolean {
  try {
    assertTimeOrder(startTime, endTime)
    return false
  } catch {
    return true
  }
}

function assertText (value: unknown, label: string, max: number, required: boolean): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${label}必填（页面表单规则 required，后端 @NotBlank）`)
    return ''
  }
  if (typeof value !== 'string') {
    throw new Error(`${label}必须是字符串，收到 ${JSON.stringify(value)}`)
  }
  if (required && value.trim() === '') {
    throw new Error(`${label}必填（页面表单规则 required，后端 @NotBlank）`)
  }
  if (value.length > max) {
    throw new Error(`${label}最多 ${max} 个字，收到 ${value.length} 个（页面 :maxlength + 后端 @Size）`)
  }
  return value
}

/**
 * `staffId` 归一成**字符串**。
 *
 * 为什么是字符串而不是数字：`getStaffByOrgPage` 返回的 `staffId` 是 `"1163"`，
 * 页面 POST 出去的就是这个字符串（浏览器抓包实测 `"staffId":"1163"`）。
 * 后端 `@NotNull Long staffId` 两边都收，但 **D20 要求与浏览器逐字段一致**，
 * 所以这里归一成字符串、原样发。
 *
 * ⚠️ 显式拒 `null` / `undefined` / 空串 / 非数字：`Number('')` 是 0，
 * 光用 `Number.isFinite(Number(x))` 判会让空串**悄悄变成员工 0**。
 */
export function normalizeStaffId (value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(
      '申请人 staffId 必填（后端 `VehicleUsageApplicationSaveReqVO.staffId` 是 @NotNull，' +
        '错误文案「申请人不能为空」）。用 vehicle-application-applicant-picker 查一个员工，' +
        '取那一行的 staffId',
    )
  }
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    throw new Error(`申请人 staffId 必须是数字（字符串或数字都行），收到 ${JSON.stringify(value)}`)
  }
  return text
}

/** `staffName` 归一：必填、非空字符串（`selectedUser.name || selectedUser.realName` 的结果） */
export function normalizeStaffName (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      '申请人 staffName 必填。它来自 applicant-picker 那一行的 `name || realName`' +
        '（页面 buildVehicleUsageSubmitData 就是这么取的）。⚠️ 后端会用 staffId 重查并覆盖它，' +
        '但为了与浏览器逐字段一致仍然要发',
    )
  }
  return value
}

/** 在职状态判据：`mapVehicleUsageUserOptions` 的 `ACTIVE_STAFF_STATUS_LIST.includes(Number(status))` */
export function isActiveStaffStatus (status: unknown): boolean {
  return (APPLICANT_ACTIVE_STATUS_LIST as readonly number[]).includes(Number(status))
}

/**
 * 构造提交载荷。**逐字段复刻 `buildVehicleUsageSubmitData()`**，包括键的书写顺序
 * —— D20 要求与浏览器逐字段一致，键顺序不同也算不一致。
 *
 * 基准（真实浏览器抓包，`baseline/vehicle-application.browser.json`，
 * 取自「查看审批流程」预览的 `variables`，它就是 `buildVehicleUsageSubmitData()` 的产物）：
 *
 * ```json
 * {"staffId":"1163","staffName":"姚淼鑫","reason":"…","startTime":"2026-09-22 09:00:00",
 *  "endTime":"2026-09-22 15:00:00","destination":"…","remark":""}
 * ```
 *
 * 四个容易被"顺手改掉"的点，都在这里钉死：
 *
 * 1. `staffId` 是**字符串**（`"1163"`，不是 `1163`）。
 * 2. 键名是 `staffId`/`staffName`，**不是** `applicantId`（那次映射的产物）。
 * 3. `remark` **在最后**，且空值是 `''` 不是 `undefined`。
 * 4. `startTime`/`endTime` 是 `YYYY-MM-DD HH:mm:ss`，且**结束严格晚于开始**。
 */
export function buildVehicleApplicationPayload (
  draft: VehicleApplicationDraft,
): Record<string, unknown> {
  const staffId = normalizeStaffId(draft?.staffId)
  const staffName = normalizeStaffName(draft?.staffName)
  const reason = assertText(draft?.reason, '用车事由 reason', REASON_MAX, true)
  assertTimeOrder(draft?.startTime, draft?.endTime)
  const destination = assertText(draft?.destination, '用车目的地 destination', DESTINATION_MAX, true)
  const remark = assertText(draft?.remark, '备注 remark', REMARK_MAX, false)

  return {
    staffId,
    staffName,
    reason,
    startTime: draft.startTime,
    endTime: draft.endTime,
    destination,
    remark: remark ?? '',
  }
}

/** 五个「必填」字段的名单（页面 `APPROVAL_REQUIRED_FIELDS`，`applicantId` 换成载荷名 `staffId`） */
const REQUIRED_DRAFT_FIELDS = ['staffId', 'reason', 'startTime', 'endTime', 'destination'] as const

function isFilled (value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined
}

/**
 * 「申请人选得到人」—— 页面 `canRefreshVehicleUsageApproval()` 的判据
 * （`Boolean(buildVehicleUsageSubmitData(formState, userList))`），
 * **这才是页面上真正的闸**：它为假时 `refreshApprovalTasks()` 直接
 * `bpmInvalidateStartUserSelectTasks()` 并 **return，一个请求都不发**。
 *
 * SDK 的 `draft` 没有"选择器"，"选得到人"就退化成「`staffId` 与 `staffName` 都是有效值」。
 */
export function assertApplicantResolvable (draft: { staffId?: unknown; staffName?: unknown }): void {
  const missing = (['staffId', 'staffName'] as const).filter((field) => !isFilled(draft?.[field]))
  if (missing.length) {
    throw new Error(
      `申请人没选出来（缺 ${missing.join('、')}）。页面 canRefreshVehicleUsageApproval() 为假时` +
        '**连审批人节点都不去问**（bpmInvalidateStartUserSelectTasks 后直接 return）。' +
        '用 vehicle-application-applicant-picker 查一个员工，把那一行的 staffId / name 填进来',
    )
  }
}

/**
 * 页面的 `isVehicleUsageApprovalDataComplete(formState)`：
 * `['applicantId','reason','startTime','endTime','destination']` 五个字段都非空。
 *
 * ⚠️ **页面上这不是闸**，它只在 `refreshApprovalTasks()` 的 **catch 分支**里用
 * （「请求失败时，如果数据本来就不全，就把节点清空」）。页面上真正的闸是
 * `assertApplicantResolvable()`（`canRefresh…`）。
 *
 * ⚠️ **但 SDK 把它当闸用，这是一处刻意的偏离**。理由是一条只读实测：
 * 后端 `getTemporaryRequiredStartUserSelectTasks` 的参数是 `@Valid VehicleUsageApplicationCreateReqVO`，
 * 而它继承的 `VehicleUsageSubmitReqVO` 上有 `@NotBlank reason` / `@NotNull startTime` /
 * `@NotNull endTime` / `@NotBlank destination`。字段不全时后端**直接 400**：
 *
 * ```text
 * 全空（浏览器基准里那条，逐字节） → 400 请求参数不正确:结束时间不能为空
 * 只缺 reason                    → 400 请求参数不正确:用车事由不能为空
 * ```
 *
 * 也就是说：**页面挂载时那一次 `refreshApprovalTasks()` 是一个注定 400 的请求**
 * （实测抓包里它确实发出去了，也确实被拒了），页面上那三个「审批人」下拉因此落在
 * `获取审批候选人失败 / 点击重试` 的状态。
 * SDK **不发注定失败的请求** —— 写操作会惊动真人，读也不该浪费往返。
 * 这个偏离记在 `docs/pages/用车申请.md` 的「与页面的差异」一节。
 */
export function assertDataComplete (draft: {
  staffId?: unknown
  reason?: unknown
  startTime?: unknown
  endTime?: unknown
  destination?: unknown
}): void {
  const missing = REQUIRED_DRAFT_FIELDS.filter((field) => !isFilled(draft?.[field]))
  if (missing.length) {
    throw new Error(
      `「申请人」「用车事由」「时间段」「用车目的地」都齐了才能问审批人节点。缺：${missing.join('、')}。` +
        `⭐ 后端 getTemporaryRequiredStartUserSelectTasks 的参数带 @Valid，字段不全直接 400` +
        `（实测「只缺 reason → 400 请求参数不正确:用车事由不能为空」）——` +
        `页面上那一次挂载时的请求就是这么被拒的，SDK 不照抄一个注定 400 的请求。` +
        `⚠️ 本流程的审批人是 3 个**自选节点**，选不到人时页面连请求都不发`,
    )
  }
}

/**
 * 附件：本表单**没有附件控件**。
 *
 * 单独写出来是为了让「没有」这件事有一个显式的落点 —— 另外两条流程表单线
 * （通用审批 / 请假）都有 `attachments`，很容易顺手抄过来。
 * `form/031` 的模板里没有任何上传组件，`VehicleUsageApplicationSaveReqVO` 里
 * 也没有附件字段。**SDK 的载荷里就没有这个键**，不要为对称加一个。
 */
export const HAS_ATTACHMENT_FIELD = false

/**
 * 自选审批人本地预检 —— **`general-approval.ts` 里同名函数的一份复刻**。
 *
 * 为什么不直接 import 那边那个：见文件头的导入注释（值导入会让
 * `smoke/vehicle-application.mjs` 那条 Node 类型剥离的路子直接 `ERR_MODULE_NOT_FOUND`）。
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
 * ⚠️ 本流程的 `maxSelectCount` 实测是 **1**（通用审批那个节点是 null），
 * 所以「一个节点塞两个人」在这里**会被本地拦下**，而通用审批不会。
 *
 * ⚠️ 这一份**刻意保持与另外两份行为等价**（包括 `Number('') === 0`、
 * `Number([]) === 0` 所以空串与空数组能混过第二条规则这个洞），
 * 为的是让 `test/vehicle-application.test.ts` 里那条「三份实现逐例对照」是一句真话。
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
          `请用 vehicle-application-prepare 拿到节点 id，再把 { "${task.id}": [userId] } 传给 submit。` +
          `⚠️ 本流程的节点名**三个都叫「发起人自选」**，只能按 id 认，不能按名字认`,
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

/**
 * ★ **找出「选到发起人本人」的审批人节点**（后端会因此**当场自动通过**那个节点）。
 *
 * 后端 `BpmTaskServiceImpl`（源码直读）：
 *
 * ```java
 * Long startUserId  = NumberUtils.parseLong(instance.getStartUserId());
 * Long taskAssigneeId = NumberUtils.parseLong(task.getAssignee());
 * if (startUserId != null && startUserId.equals(taskAssigneeId)) {
 *     autoApproveReqVO.setReason("流程发起人与审批人相同，自动审核通过");
 *     approveTask(taskAssigneeId, autoApproveReqVO);
 * }
 * ```
 *
 * 两边比的都是 **userId**（`startUserSelectAssignees` 里放的就是 userId）。
 *
 * **为什么本流程比另外两条线危险**：用车有 **3 个**自选节点，
 * 三个都选到发起人本人时**整条流程在 `create` 返回之前就走完**，
 * `cancel-by-start-user` 必然报「流程取消失败，流程不处于运行中」——
 * 于是**永久留下一条撤不掉的单据**（用户原话点名的就是这个坑）。
 * 只中一个节点时流程还在跑、还能撤，但那个节点已经**越过了真人审批**。
 *
 * ⚠️ **`submit` 不会自动拦这条**：页面不拦（人自己选得明白），而 `submit` 是
 * 「忠实复刻页面」的地方。拦它的是 `smoke/vehicle-application.mjs` 的提交前拒绝。
 */
export function findSelfApproverConflicts (
  tasks: readonly StartUserSelectTask[],
  assignees: StartUserSelectAssignees,
  selfUserId: number | string,
): Array<{ taskId: string; taskName: string }> {
  const self = Number(selfUserId)
  if (!Number.isFinite(self)) {
    throw new Error(`selfUserId 必须是数字（userId，不是 staffId），收到 ${JSON.stringify(selfUserId)}`)
  }
  const conflicts: Array<{ taskId: string; taskName: string }> = []
  for (const task of tasks ?? []) {
    const picked = assignees?.[task.id]
    if (!Array.isArray(picked)) continue
    if (picked.some((id) => Number(id) === self)) {
      conflicts.push({ taskId: task.id, taskName: task.name || task.id })
    }
  }
  return conflicts
}

/**
 * `findSelfApproverConflicts()` 的抛错版本。**提交前（发请求之前）调它**。
 *
 * 触发时给出的文案里写清两件事：会**当场自动通过**那个节点；**三个全中**时整条流程
 * 立刻走完、`cancel` 撤不掉、会永久留下一条撤不掉的单据。
 */
export function assertApproversNotSelf (
  tasks: readonly StartUserSelectTask[],
  assignees: StartUserSelectAssignees,
  selfUserId: number | string,
): void {
  const conflicts = findSelfApproverConflicts(tasks, assignees, selfUserId)
  if (conflicts.length === 0) return
  const all = conflicts.length === (tasks ?? []).length && (tasks ?? []).length > 0
  throw new Error(
    `审批人里有发起人本人（userId=${selfUserId}）：` +
      conflicts.map((c) => `「${c.taskName}」(${c.taskId})`).join('、') +
      '。后端有「流程发起人与审批人相同，自动审核通过」（BpmTaskServiceImpl），' +
      '那个节点会**当场通过**、越过真人审批；' +
      (all
        ? '⚠️ 本次**全部节点**都选到了本人，整条流程会在 create 返回之前走完，' +
          '`cancel-by-start-user` 必然报「流程不处于运行中」——**会永久留下一条撤不掉的单据**。'
        : `本次是 ${conflicts.length}/${(tasks ?? []).length} 个节点中招。`) +
      '换一个不是自己的 userId 再提交（本流程有 3 个自选节点，每个都要换）',
  )
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

/** 人员候选：**必须先给关键字或部门**（设计 D6 / H35）。与通用审批同一处保护 */
const APPROVER_SEARCH_PARAM: ParamSpec = {
  name: 'keyword',
  kind: 'search',
  required: true,
  description:
    '姓名等关键字。候选是该租户全量人员，页面自己用 ' +
    '`simple-page?pageNo=1..9&pageSize=500` 无关键字拉了 4500 人（实测抓包）—— ' +
    '无头下禁止照抄（设计 D6 / H35）',
}

const APPROVER_LOOKUP = { capabilityId: 'vehicle-application-approver-search', keywordParam: 'keyword' } as const

/**
 * `staffId` 的候选入口：**申请人选择器本身**。
 *
 * 页面上「申请人」是一个按组织**远程分页**的人员控件，候选就是从它出来的
 * （`a-select` 的 `@search` → `requestPage(pageNo, pageSize, keyword, …)`）。
 * `keyword` 是它的收窄参数，也是这里的 `keywordParam`。
 *
 * ⚠️ **必须指向 `applicant-picker`，不是 `applicant-scope`。**
 * 后者只能回答「有哪些根组织」，连一个人员候选都给不出来；把它当候选入口
 * 会让「按 lookup 去查候选」这条路走进死胡同。
 * `test/attendance-archive-sheet.test.ts` 里那条一致性断言
 * （`catalog.validate().lookups === []`）就是卡这种指错的。
 *
 * ⚠️ 与 `APPROVER_LOOKUP` **不是同一个入口**：这里查出来的是 **staffId（员工 id）**，
 * 那边查出来的是 **userId**。两个 id 空间不同（见文件头 §五）。
 */
const APPLICANT_LOOKUP = {
  capabilityId: 'vehicle-application-applicant-picker',
  keywordParam: 'keyword',
} as const

/**
 * ⚠️ `organizationIds`（`applicant-picker` 与 `applicant-scope` 上都有可能要填的那个）
 * **刻意不登记 `lookup`**。
 *
 * 曾经登记过一条指向 `vehicle-application-applicant-scope` 的 lookup，被
 * `catalog.validate().lookups` 抓出是错的 —— 而它**确实**是错的，不是断言太严：
 *
 * - 组织 id 的候选来源是 `GET /org/organization/getRoleOrganizationTree`，
 *   那条接口**不接受任何参数**（没有关键字、没有分页），是一次性返回整棵树。
 * - `vehicle-application-applicant-scope` 因此**一个参数都没有**，
 *   它没法充当「候选入口」这个角色（「候选入口」= 给我一个关键字、还你一页候选）。
 *
 * ⇒ 候选关系仍然存在，但它是**「先调 A 拿一组 id，再把它们填进 B」**，
 * 不是「带关键字去 A 查候选」。后者才是 `lookup` 表达的东西，所以这里**留空**，
 * 把引导写进参数描述里（读的人照描述走，一样到得了）。
 * 不为过测试而指一个不合适的入口。
 */

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'staffId',
    kind: 'number',
    required: true,
    description:
      '申请人**员工 id（staffId）**，必填。取 vehicle-application-applicant-picker 那一行的 `staffId`。' +
      '⚠️ **不是 userId** —— 审批人用的是 userId（来自 vehicle-application-approver-search），' +
      '两者不是一个 id 空间。载荷里发出去的是**字符串**（浏览器发 `"1163"`）',
    lookup: APPLICANT_LOOKUP,
  },
  {
    name: 'staffName',
    kind: 'text',
    required: true,
    description:
      '申请人姓名，必填。取 applicant-picker 那一行的 `name || realName`' +
      '（页面 `buildVehicleUsageSubmitData` 就是这么取的）。' +
      '⚠️ 后端会用 staffId 重查并覆盖它，填错不会造成数据错，但为了逐字段一致仍要发',
  },
  {
    name: 'reason',
    kind: 'text',
    required: true,
    description: `用车事由，必填，最多 ${REASON_MAX} 字（页面 a-textarea :maxlength + 后端 @Size）`,
  },
  {
    name: 'startTime',
    kind: 'text',
    required: true,
    description:
      `开始时间 \`${DATETIME_FORMAT}\`。⚠️ 它与 \`endTime\` 是**页面上同一个控件**` +
      '（`a-range-picker` + showTime）的两半，两个都必填，且**结束必须严格晚于开始**',
  },
  {
    name: 'endTime',
    kind: 'text',
    required: true,
    description: `结束时间 \`${DATETIME_FORMAT}\`。早于**或等于**开始都不合法（页面 validateTimeRange 与后端一致）`,
  },
  {
    name: 'destination',
    kind: 'text',
    required: true,
    description: `用车目的地，必填，最多 ${DESTINATION_MAX} 字（页面 a-input :maxlength + 后端 @Size）`,
  },
  {
    name: 'remark',
    kind: 'text',
    required: false,
    description: `备注，可选，最多 ${REMARK_MAX} 字。不给时载荷里是 \`''\`（页面 \`formState.remark || ''\`）`,
  },
]

export const vehicleApplicationCapabilities: CapabilityDefinition[] = [
  {
    id: 'vehicle-application-definition',
    title: '查询用车审批流程（vehicle_usage_application）的流程定义',
    pagePath: VEHICLE_APPLICATION_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${VEHICLE_APPLICATION_PROCESS_KEY}`,
        options: [{ label: '用车审批', value: VEHICLE_APPLICATION_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'vehicle-application-applicant-scope',
    title: '申请人选择器的组织范围（页面按组织查人的那 10 个根组织）',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: false,
    params: [],
  },
  {
    id: 'vehicle-application-applicant-picker',
    title: '按组织分页查申请人候选（页面上「申请人」下拉的真实数据源）',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'organizationIds',
        kind: 'tree',
        required: false,
        description:
          `根组织 id 数组，最多 ${ORG_ROOT_MAX} 个（页面与后端都有这条上限）。` +
          '不给时用 vehicle-application-applicant-scope 算出来的那一组' +
          '（页面 getVehicleUsageOrganizationRoots 的结果：顶层节点的 children 摊平）。' +
          '⚠️ 这一项**没有** lookup：组织树的接口不接受任何参数（没有关键字、没有分页），' +
          '所以「先调 applicant-scope 拿 id，再填进来」是唯一的路 —— 那是两步取候选，' +
          '不是「带关键字查候选」，用 lookup 表达不了',
      },
      {
        name: 'keyword',
        kind: 'text',
        required: false,
        description: '姓名/工号关键字，可用来收窄（页面搜索框走的就是它）。不给时是空串',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      {
        name: 'pageSize',
        kind: 'number',
        required: false,
        description: `每页条数，默认 ${APPLICANT_PAGE_SIZE_DEFAULT}，**上限 ${APPLICANT_PAGE_SIZE_MAX}**（后端 @Max(100)）`,
      },
      {
        name: 'selectedStaffIds',
        kind: 'number',
        required: false,
        description:
          `要回显的已选员工 id，最多 ${APPLICANT_SELECTED_MAX} 个。给了它时后端额外回一份 \`selectedItems\``,
      },
    ],
  },
  {
    id: 'vehicle-application-approver-search',
    title: '按关键字搜索审批人候选（3 个自选节点用的人）',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      APPROVER_SEARCH_PARAM,
      { name: 'deptId', kind: 'tree', required: false, description: '限定部门 id（不给关键字时的兜底路径）' },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20；不允许 -1（全量）' },
    ],
  },
  {
    id: 'vehicle-application-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点（本流程恒为 3 个）',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'vehicle-application-submit',
    title: '提交用车申请（会真的发起流程、给审批人推待办）',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: true,
    params: [
      ...DRAFT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: true,
        description:
          '{ [节点 id]: [userId] }。节点 id 来自 vehicle-application-prepare；' +
          `⚠️ 本流程实测有 **3 个**节点（都叫「发起人自选」，**只能按 id 认**），` +
          '每个 **minSelectCount = maxSelectCount = 1**，所以每个节点**恰好一个 userId**；' +
          '⚠️ **userId 不是 staffId**，要用 vehicle-application-approver-search 查；' +
          '⚠️ **绝对不要选发起人本人** —— 后端会当场自动通过那个节点，三个全中时整条流程立刻走完、' +
          '**撤不掉**（见 assertApproversNotSelf）',
        lookup: APPROVER_LOOKUP,
      },
    ],
  },
  {
    id: 'vehicle-application-detail',
    title: '查询单条用车申请单据',
    pagePath: VEHICLE_APPLICATION_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 与通用审批 / 请假那条线**不同**：' +
          '这个响应里**有 `processInstanceId`**，取消可以不翻「我的流程」',
      },
    ],
  },
  {
    id: 'vehicle-application-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: VEHICLE_APPLICATION_MY_LIST_PATH,
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
        description: '流程类型字典 bpm_process_type；本流程是 2（审批）',
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'vehicle-application-cancel',
    title: '取消（撤回）我发起的用车审批流程',
    pagePath: VEHICLE_APPLICATION_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 vehicle-application-detail 的 `processInstanceId`，或 my-instances 那一行的 `id`',
      },
      {
        name: 'businessKey',
        kind: 'number',
        required: false,
        description:
          '业务单据 id（submit 的返回值）。给了它、没给 processInstanceId 时，' +
          'SDK 先试 detail() 的 processInstanceId，再退回「我的流程」按 businessKey 找（findInstanceByBusinessKey）',
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

export type VehicleApplicationOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条）。给上限是免得为了一条记录把整个列表翻完 */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

export function createVehicleApplicationCapability (
  request: PortalRequest,
  options: VehicleApplicationOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /**
   * 页面的 `getVehicleUsageOrganizationRoots(organizationStore.state)`
   * （`common/use-applicants.js`，**逐字复刻**）：
   *
   * ```js
   * organizations.flatMap(item =>
   *   Array.isArray(item.children) && item.children.length > 0 ? item.children : [item]
   * )
   * // 再去重、再 filter(Boolean)
   * ```
   *
   * 白话：**取每个顶层节点的「下一层」**（没有子节点时就取它自己），
   * 去重后作为 `getStaffByOrgPage` 的 `organizationIds`。
   * 实测本环境返回 `["35","36","37","71","467","3997","4026","4094","4099","4111"]`（10 个）。
   *
   * ⚠️ 返回的是**组织树里原本的 id 类型**（页面拿到的 `item.id` 是字符串，页面原样 POST），
   * 所以这里是 `Array<string | number>`、不去做类型归一 —— D20 要的是"发浏览器发的那个"。
   */
  function organizationRoots (organizations: unknown): Array<string | number> {
    const list = Array.isArray(organizations) ? organizations : []
    const roots = list.flatMap((raw) => {
      const item = raw as { id?: unknown; children?: unknown[] } | null
      return Array.isArray(item?.children) && item.children.length > 0 ? item.children : [item]
    })
    const ids = roots
      .map((raw) => (raw as { id?: unknown } | null)?.id)
      .filter((id): id is string | number => id !== undefined && id !== null && id !== '')
    return [...new Set(ids)]
  }

  /**
   * 申请人选择器的组织范围（**只读**）。
   *
   * 页面 `useVehicleUsageApplicants().ensureScope()` 走的就是这两步：
   * `GET /org/organization/getRoleOrganizationTree` → `getVehicleUsageOrganizationRoots()`。
   * 返回的 `organizationIds` 直接可以喂给 `applicantPicker()`。
   *
   * ⚠️ 页面在这里**自己有一条 50 个的上限**，SDK 也一样（超了就抛，不发那个注定 400 的请求）。
   *
   * ⚠️ 写成**独立函数**而不是返回对象上的方法，是为了让 `applicantPicker()` 能直接调它：
   * 返回对象的方法之间用 `this` 互调会让 `const { applicantPicker } = cap` 这种解构用法炸掉，
   * 而另外两条流程表单线都没有 `this`。
   */
  async function applicantScope (): Promise<{
    organizationIds: Array<string | number>
    tree: unknown
  }> {
    const tree = await request<unknown>({
      url: '/org/organization/getRoleOrganizationTree',
      method: 'get',
    })
    const organizationIds = organizationRoots(tree)
    if (organizationIds.length === 0) {
      throw new Error(
        '组织树是空的（页面 use-applicants.js 在这一步抛「暂无可选组织」）。' +
          '没有根组织就没法查申请人，去 /org/organization/getRoleOrganizationTree 看一眼',
      )
    }
    if (organizationIds.length > ORG_ROOT_MAX) {
      throw new Error(
        `可选根组织 ${organizationIds.length} 个，超过 ${ORG_ROOT_MAX} 个上限` +
          '（页面原话：「可选根组织超过50个，请联系管理员调整组织入口」）',
      )
    }
    return { organizationIds, tree }
  }

  /**
   * 单条单据详情（**只读**）。
   *
   * ⚠️ 与通用审批 / 请假那条线**不同**：响应里**有 `processInstanceId`**，
   * 所以 `cancel()` 可以用它，不必翻「我的流程」。
   *
   * ⚠️ **两个坑，都是 2026-09-21 真实提交后回读出来的**（见 `VehicleApplicationRecord`）：
   * 刚 create 完 `status` 是 **0**（不是 1，`createApplication` 没有 setStatus），
   * 而 `statusName` **恒为 null**（DO 里没这一列）。**别拿它判"流程还活着吗"**——
   * 那个判据在 `myInstances()` 那一行的 `status` 上（1 = 审批中）。
   *
   * ⚠️ 传一个不存在的 id 时后端**不报错，回 `null`**
   * （`BeanUtils.toBean(null, ...)` 实测返回 `null`）——调用方要自己判空。
   */
  async function detail (id: number | string): Promise<VehicleApplicationRecord | null> {
    describeId(id, '用车申请单据 id')
    const record = await request<VehicleApplicationRecord | null>({
      url: '/hr/vehicle-usage-application/get',
      method: 'get',
      params: { id },
    })
    return record ?? null
  }

  /**
   * 把业务单据 id 换成**流程实例 id**（`cancel` 要的那个）。
   *
   * 两条路，**先短后长**：
   *   1. `detail(businessKey).processInstanceId` —— 用车这条线**有**这个字段
   *      （通用审批 / 请假没有，所以它们的 `cancel` 只能走第 2 条）；
   *   2. 退回 `findInstanceByBusinessKey()` —— 页面上真实发生的那条
   *      （「我的流程」那一行的 `id`）。
   *
   * ⚠️ **不在这里判 `status`**：能不能撤由后端说了算，SDK 不替它做预检查、也不吞错。
   */
  async function resolveProcessInstanceId (businessKey: number | string): Promise<string> {
    const wanted = describeId(businessKey, 'businessKey')
    const record = await detail(wanted)
    const direct = record?.processInstanceId
    if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
    const instance = await findInstanceByBusinessKey(wanted)
    return String(instance.id)
  }

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: VehicleInstanceQuery = {},
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
   * **本流程其实有更短的路**（`detail().processInstanceId`，见
   * `resolveProcessInstanceId`），这个方法是那条路的**兜底**，也是页面上真实发生的那条
   * （`flow/task/my/list.vue` 的 `actionCancel(record.id)` 取的就是 my-page 那一行的 `id`）。
   *
   * **为什么在客户端按 `processDefinitionKey` 再筛一道**：`businessKey` 是**各业务表
   * 自己的主键**（后端 `setBusinessKey(String.valueOf(application.getId()))`），
   * 所以「用车 51」与「请假 51」会撞成同一个字符串。只按 businessKey 匹配会认错单子。
   * ⚠️ 这里**不能**用 `processType` 区分：它区分不开同类的流程，而在请求里加一个
   * 页面从不发的过滤参数会白白偏离 D20 的逐字段一致。
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
            row.processDefinitionKey === VEHICLE_APPLICATION_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的用车审批流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 vehicle-application-my-instances 自己按条件找。',
    )
  }

  /** 一次"把提交载荷拼齐"的动作。`prepare` 与 `submit` 都走它，所以两边**一定发同一份载荷** */
  function buildPayload (draft: VehicleApplicationDraft): Record<string, unknown> {
    // 两道闸，都在**发任何请求之前**跑（写操作会惊动真人，能红在前面的就红在前面）：
    //   1. 页面真正的闸 canRefreshVehicleUsageApproval()：选不到人就什么都不问
    //   2. 后端 @Valid 的实际要求：字段不全它是 400，见 assertDataComplete 的注释
    assertApplicantResolvable(draft ?? {})
    assertDataComplete(draft ?? {})
    return buildVehicleApplicationPayload(draft)
  }

  /**
   * 问后端"这次提交要人工指定哪些审批人节点" —— 页面 `refreshApprovalTasks()` /
   * `handleSubmit()` 里 `requestVehicleUsageRequiredTasks(submitData)` 那一步。
   *
   * ⚠️ **请求体就是提交载荷本身**（页面两个地方传的都是
   * `buildVehicleUsageSubmitData()` 的产物）——不是"少几个字段的预览版"。
   */
  async function fetchRequiredTasks (payload: Record<string, unknown>): Promise<StartUserSelectTask[]> {
    const tasks = await request<StartUserSelectTask[]>({
      url: REQUIRED_TASKS_URL,
      method: 'post',
      data: payload,
    })
    return Array.isArray(tasks) ? tasks : []
  }

  /**
   * 审批人 map 的数字归一 + 形状校验。
   *
   * **先把整张表校验完再构造**：不能一边 `.map()` 一边 `return Promise.reject()` ——
   * 那样数组里会被塞进一个 Promise 对象，错误也变成异步的，报出来的东西极难懂。
   *
   * ⚠️ 比 `assertAssigneesForTasks()` 严：**显式拒 null / undefined / 空串**
   * （`Number('') === 0`、`Number([]) === 0`，光看 `Number.isFinite` 会悄悄变成用户 0）。
   */
  function normalizeAssignees (assignees: StartUserSelectAssignees): StartUserSelectAssignees {
    if (assignees === null || typeof assignees !== 'object') {
      throw new Error('startUserSelectAssignees 必须是 { [节点 id]: [用户 id, ...] }（先调 vehicle-application-prepare 拿节点 id）')
    }
    for (const [taskId, ids] of Object.entries(assignees)) {
      if (!Array.isArray(ids)) {
        throw new Error(`startUserSelectAssignees["${taskId}"] 必须是用户 id 数组`)
      }
      ids.forEach((id, index) => {
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

  /** 页面的 `validateStaffPickerPage` / SDK 侧的本地守卫，逐条对齐后端注解 */
  function assertPickerQuery (query: {
    organizationIds?: unknown
    pageNo?: unknown
    pageSize?: unknown
    selectedStaffIds?: unknown
  }): void {
    if (!Array.isArray(query?.organizationIds)) {
      throw new Error(
        'organizationIds 必须是数组（后端 HrStaffByOrgPageReqDTO 的 @NotEmpty，空数组会被 400 拒）。' +
          '用 vehicle-application-applicant-scope 拿页面上那一组根组织',
      )
    }
    if (query.organizationIds.length === 0) {
      throw new Error('organizationIds 不能为空数组（后端错误文案就是「根组织不能为空」）')
    }
    if (query.organizationIds.length > ORG_ROOT_MAX) {
      throw new Error(
        `organizationIds 最多 ${ORG_ROOT_MAX} 个，收到 ${query.organizationIds.length} 个` +
          '（页面 use-applicants.js 的「可选根组织超过50个，请联系管理员调整组织入口」，后端也有 @Size(max=50)）',
      )
    }
    const pageSize = query.pageSize === undefined || query.pageSize === null ? APPLICANT_PAGE_SIZE_DEFAULT : Number(query.pageSize)
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > APPLICANT_PAGE_SIZE_MAX) {
      throw new Error(
        `pageSize 必须是 1..${APPLICANT_PAGE_SIZE_MAX} 的整数，收到 ${JSON.stringify(query.pageSize)}` +
          '（后端 @Min(1) @Max(100)；实测 pageSize=101 报「最大不能超过100」，-1 报「最小不能小于1」）',
      )
    }
    if (query.pageNo !== undefined && query.pageNo !== null) {
      const pageNo = Number(query.pageNo)
      if (!Number.isInteger(pageNo) || pageNo < 1) {
        throw new Error(`pageNo 必须是 ≥1 的整数，收到 ${JSON.stringify(query.pageNo)}`)
      }
    }
    if (query.selectedStaffIds !== undefined && query.selectedStaffIds !== null) {
      if (!Array.isArray(query.selectedStaffIds)) {
        throw new Error('selectedStaffIds 必须是数组')
      }
      if (query.selectedStaffIds.length > APPLICANT_SELECTED_MAX) {
        throw new Error(
          `selectedStaffIds 最多 ${APPLICANT_SELECTED_MAX} 个，收到 ${query.selectedStaffIds.length} 个（后端 @Size(max=100)）`,
        )
      }
    }
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 §一 */
    definition (key: string = VEHICLE_APPLICATION_PROCESS_KEY): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    /** 申请人选择器的组织范围（**只读**）。实现与说明见上面的 `applicantScope()` */
    applicantScope,

    /**
     * 申请人候选（**只读**）—— 页面上「申请人」下拉的真实数据源。
     *
     * `POST /org/staff/getStaffByOrgPage`。**这个入口的选择本身就是本流程最重要的一条实测**：
     * 页面**曾经**走 `POST /org/staff/getStaffByOrg`（数组、不分页），而那个入口在测试环境上
     * 对满编账号**直接失败**（`员工超过1000条，请升级客户端并使用分页选择器`）。
     * 现在页面上跑的是分页的这条。见文件头 §三。
     *
     * `organizationIds` 不给时自动取 `applicantScope()` 的结果（页面也是这么做的）。
     *
     * ⚠️ 返回的行**原样来自后端**（`HrStaffPickerOptionDTO`），SDK **不做**页面那层
     * `label/value` 合成。要用 `isActiveStaffStatus(row.status)` 自己判在职
     * （页面把不在 `[1,4,5]` 的行整个丢掉）。
     */
    async applicantPicker (query: {
      organizationIds?: Array<string | number>
      keyword?: string
      pageNo?: number
      pageSize?: number
      selectedStaffIds?: Array<number | string>
    } = {}): Promise<VehicleApplicantPage> {
      let organizationIds = query?.organizationIds
      // 页面 ensureScope() 是**惰性**的：只有真要用的时候才去拉组织树
      if (organizationIds === undefined || organizationIds === null) {
        organizationIds = (await applicantScope()).organizationIds
      }
      assertPickerQuery({ ...query, organizationIds })
      const pageSize = query.pageSize === undefined || query.pageSize === null
        ? APPLICANT_PAGE_SIZE_DEFAULT
        : Number(query.pageSize)
      const page = await request<VehicleApplicantPage>({
        url: APPLICANT_PICKER_URL,
        method: 'post',
        // 键顺序照抄页面 use-applicants.js 的 requestPage()：
        // organizationIds → includeDescendants → keyword → pageNo → pageSize → selectedStaffIds
        data: {
          organizationIds,
          includeDescendants: true,
          keyword: query.keyword ?? '',
          pageNo: query.pageNo ?? 1,
          pageSize,
          selectedStaffIds: query.selectedStaffIds ?? [],
        },
      })
      return page ?? {}
    },

    /**
     * 审批人候选（**只读**）。**必须给 keyword 或 deptId**（设计 D6 / H35）。
     *
     * ⚠️ 返回的 `id` 是 **userId**，`startUserSelectAssignees` 要的就是它 ——
     * **不是**申请人的 `staffId`。两者不是一个 id 空间。
     */
    approverSearch (query: {
      keyword?: string
      deptId?: number
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: VehicleApproverOption[]; total: number }> {
      if (!query?.keyword && query?.deptId === undefined) {
        return Promise.reject(
          new Error(
            '审批人候选属于长选项参数：必须提供 keyword 或 deptId，不允许无条件下全量拉取（设计 D6）。' +
              '页面自己无关键字拉了 4500 人（`simple-page` 翻 9 页 × 500），无头下不照抄',
          ),
        )
      }
      if (query.pageSize === -1) {
        return Promise.reject(
          new Error('不允许 pageSize = -1（全量拉取）；请用关键字 + 分页（设计 D6）'),
        )
      }
      return request<{ list: VehicleApproverOption[]; total: number }>({
        url: '/system/user/simple-page',
        method: 'get',
        params: {
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? APPROVER_PAGE_SIZE_DEFAULT,
          ...(query.keyword ? { nickname: query.keyword } : {}),
          ...(query.deptId === undefined ? {} : { deptId: query.deptId }),
        },
      })
    },

    /**
     * 提交前准备（**只读**）：算出这次提交需要人工指定哪些审批人节点。
     *
     * 与页面 `refreshApprovalTasks()` 一致：**先补齐载荷**（含那次
     * `applicantId → staffId/staffName` 的映射），再把**同一份载荷** POST 给
     * `getTemporaryRequiredStartUserSelectTasks`。
     *
     * ⚠️ 本流程实测**恒返回 3 个节点**（BPMN 里三个 `candidateStrategy = 35`
     * 的「发起人自选」userTask，没有网关、没有条件表达式），
     * 每个 **`minSelectCount = maxSelectCount = 1`**。
     * 三个节点的 `name` **完全一样**，只有 `id` 不同 —— 只能按 id 选人。
     * 详细响应原样记在 `baseline/vehicle-application.browser.json`。
     *
     * 返回的 `payload` 就是 `submit` 会发的业务字段（不含 `startUserSelectAssignees`），
     * 便于调用方在真提交之前先看一眼。
     */
    async prepare (draft: VehicleApplicationDraft): Promise<{
      payload: Record<string, unknown>
      tasks: StartUserSelectTask[]
    }> {
      const payload = buildPayload(draft)
      const tasks = await fetchRequiredTasks(payload)
      return { payload, tasks }
    },

    /**
     * 真正提交（**写操作**）：创建用车申请记录**并起一条 `vehicle_usage_application` 审批流**。
     *
     * ⚠️ 它会**给真人推待办**。本流程的审批人**必须由调用方指定**（3 个自选节点，
     * 每个恰好 1 人），而且**你选谁就是谁**——所以测试请：
     *   1. 事由/目的地里带 `SDK-TEST-` 前缀（本流程**没有标题字段**，
     *      `instanceName` 是后端拼的 `staffName + "-用车审批"`，所以事由是收到的人
     *      唯一能看出这是测试数据的地方）；
     *   2. 用 `assertApproversNotSelf()` 在**发请求之前**确认三个节点都没选到发起人本人；
     *   3. 测完立刻用 `cancel()` 撤掉。
     *
     * 调用方必须先走 `prepare()`：节点 id 只能从它拿。
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）——它不是流程实例 id；
     * ⚠️ 但 `detail()` 的响应里**有** `processInstanceId`，所以 `cancel()` 传
     * `businessKey` 就够了（`resolveProcessInstanceId` 会自己找）。
     */
    async submit (
      draft: VehicleApplicationDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<unknown> {
      // async 不是为了 await：本地校验失败要变成 **rejected promise**，
      // 否则调用方 try/catch 包 await 会漏掉同步抛出（与另外两条流程表单线一致）。
      const payload = buildPayload(draft)
      // 页面 handleSubmit() 在 create **之前**又查了一次节点（bpmFinalizeStartUserSelectTasks）。
      // 跟着页面走：既保证 assignees 的形状能先过一遍本地预检，也让每次提交都拿到**当下**的节点集。
      const tasks = await fetchRequiredTasks(payload)
      assertAssigneesForTasks(tasks, startUserSelectAssignees)
      const normalized = normalizeAssignees(startUserSelectAssignees)

      // 键顺序照抄 handleSubmit 的最后一步：{ ...submitData, startUserSelectAssignees }
      return request({
        url: '/hr/vehicle-usage-application/create',
        method: 'post',
        data: { ...payload, startUserSelectAssignees: normalized },
      })
    },

    /** 单条单据详情（**只读**）。实现与两个坑见上面的 `detail()` */
    detail,

    myInstances,

    findInstanceByBusinessKey,

    resolveProcessInstanceId,

    /**
     * 取消（撤回）自己发起的流程（**写操作**）。
     *
     * `DELETE /bpm/process-instance/cancel-by-start-user`，body `{ id, reason }`。
     * **`id` 是流程实例 id，不是业务单据 id** —— 两个都收，给 `businessKey` 时
     * 自动换（先 `detail().processInstanceId`，再 `findInstanceByBusinessKey`）。
     *
     * `reason` 必填：后端 `@NotEmpty`。页面的弹窗虽然把空串也发出去，但那样后端会
     * 报「取消原因不能为空」——SDK 不照抄那个必然失败的输入。
     *
     * ⚠️ 用车**没有**自己的 cancel 端点（实测 `PUT/DELETE /hr/vehicle-usage-application/cancel/0`
     * 都是 404；service 里的 `cancelApplication` 没映射到 Controller），所以一律走这条通用的。
     *
     * ⚠️ **只有 `status === 1`（审批中）的流程能撤。** 已经走完/已取消的再撤，后端会如实
     * 报「流程取消失败，流程不处于运行中」，SDK 不做预检查、也不吞错。
     *
     * ⚠️ 本流程**最容易踩**的是「审批人里选了发起人本人 ⇒ 那个节点当场自动通过」
     * （三个全中就整条走完、撤不掉）。见 `assertApproversNotSelf()` 与文件头 §四。
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
                'processInstanceId 来自 vehicle-application-detail 的 processInstanceId 或 my-instances 的 id，' +
                'businessKey 就是 submit 返回的业务单据 id',
            ),
          )
        }
        id = await resolveProcessInstanceId(params.businessKey)
      }
      return request({
        url: '/bpm/process-instance/cancel-by-start-user',
        method: 'delete',
        data: { id, reason },
      })
    },
  }
}

export type VehicleApplicationCapability = ReturnType<typeof createVehicleApplicationCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与另外两条流程表单线同样的分工（也因此同名）：`withIdempotency` 需要**身份**
 * （租户 / 用户），那是会话层的东西，所以包装放在组装点，能力模块只声明形状。
 */
export type VehicleApplicationCapabilityWithIdempotency = VehicleApplicationCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **为什么这条最需要防重**：后端零幂等，重发一次就是**第二条流程实例 +
   * 第二串真人待办**（本流程是 3 个节点、3 个真人，比通用审批还多）。
   * 而且用车**没有**请假那种"同一天同一时段已有运行中的请假"之类的天然去重，
   * 后端 `createApplication` 里一条冲突校验都没有 —— 重发必然变成两条。
   * `requestId` 由调用方生成并保管，超时重试时**原样传回上一次那个**
   * （用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: VehicleApplicationDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
    },
  ) => Promise<unknown>
}
