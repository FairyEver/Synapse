import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
// ⚠️ **只能 import type**，不能 import 任何**值**。理由与 `leave-application.ts` 文件头
// 那段注释完全一样，不再重复：`smoke/travel-expense-application.mjs` 直接从 `src/` 读这个
// 文件（Node 22 的类型剥离，不用先 `pnpm build`），而类型剥离**不会**把 `./x.js`
// 改写成 `./x.ts`。值导入会真的去文件系统找一个不存在的 `.js`。
import type { ProcessInstanceRow } from './general-approval.js'

/**
 * 差旅费支出申请表（`internal_transportation_expense_request_form`）——
 * **流程表单这一类里形态最复杂的一条**：它有**明细行数组**（`travelEntryList`），
 * 每行里还嵌着**省市区三级数组**，提交前要做一次结构改写。
 *
 * 页面：`/simple/finance/form/003`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=internal_transportation_expense_request_form
 *     &bpmMode=edit&formCustomCreatePath=simple/finance/form/003
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」——与通用审批 / 请假同一条路。
 *
 * 模板是同族的两条已完成能力：`src/capabilities/general-approval.ts`（第一个）与
 * `src/capabilities/leave-application.ts`（控件最复杂的那条）。**只读它们，不改**。
 * 能复用的是**形状与流程**（definition / prepare / submit / detail / my-instances /
 * cancel + 写链路防重），不是代码 —— 见上面那条 import 约束。
 *
 * ---------------------------------------------------------------------------
 * 一、前置核对：key 与名称**实测对上了**（这一步必须先做）
 * ---------------------------------------------------------------------------
 *
 * 用户点名时说的是「报销」「发票」。`docs/process-forms.md` §2 已经查清
 * **「发票」在全库不存在**（命中的都是发货单 / 收货单的 `invoiceName` 字段），
 * 所以本能力不去找发票流程。而「报销」对不上任何流程名，最贴近的是
 * 「差旅费支出申请表」——这一条**本次实测确认**：
 *
 * ```jsonc
 * // GET /bpm/process-definition/get?key=internal_transportation_expense_request_form
 * {"name":"差旅费支出申请表","key":"internal_transportation_expense_request_form",
 *  "category":"finance_process","version":16,
 *  "formType":null,"formId":null,"formCustomCreatePath":null,"formFields":null,
 *  "baseUrl":null,"startUserSelectTasks":[]}
 * ```
 *
 * 【实测，2026-09-21 测试环境】名称、key、分类全对得上，**不是硬凑的相近流程**。
 *
 * ⚠️ 一个必须如实说的偏差：**本账号的 `create-list` 里没有这个流程**
 * （`GET /bpm/process-definition/create-list?suspensionState=1` 只回 5 条，
 * 不含 finance 的任何一条）。所以**这一次拿不到 `formCustomCreatePath`** ——
 * 表单路径 `/simple/finance/form/003` 的依据是**前端源码**：
 * `app/portal/views/simple/finance/form/003/page/pc/edit/index.vue:268` 里写死了
 * `bpmProcessDefineKey: 'internal_transportation_expense_request_form'`，
 * 而 `views/simple/<域>/form/<序号>/` 是这套表单的目录约定（`get?key=` 的
 * `get` 里 `formCustomCreatePath` 恒为 `null`，这是调查 §3.1 早就记下的）。
 * **这一条是"源码 + 目录约定"，不是接口实测**，与请假那条线不同。
 *
 * ---------------------------------------------------------------------------
 * 二、字段契约从哪来：接口里没有，只在前端源码 + 后端 VO 里
 * ---------------------------------------------------------------------------
 *
 * 三条路都拿不到字段定义（`formFields: null`、`formConf: null`、`startUserSelectTasks: []`）。
 * 所以字段逐条抄自两处，**两处互相印证**：
 *
 * | 来源 | 用途 |
 * | --- | --- |
 * | `.../finance/form/003/page/pc/edit/index.vue`（715 行）的模板 + `formRules` + `onFinish()` | **页面上真实存在哪些控件**、哪些必填、载荷怎么拼 |
 * | `BpmSpendingApplyTravelSaveReqVO` / `BpmSpendingApplyTravelEntrySaveReqVO`（后端） | 后端**收**哪些字段、哪些是服务端算的 |
 *
 * 后端 VO 这一条是本能力比请假那条线多出来的证据来源：请假的服务端只有一条
 * `AttendanceUserRelSaveReqVO`，而这条流程的 `create` 里**有一整套服务端改写**（见 §五），
 * 不看后端源码就会把"前端算好的数"误当成"后端会照单全收"。
 *
 * ---------------------------------------------------------------------------
 * 三、页面上真实存在的控件（**逐个列全**）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面 label | 载荷字段 | 形态 | 页面必填 | SDK 参数 |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | 组织选择 | `orgId` | 组织树（单选，仅成本中心可选） | ✅ | `orgId` |
 * | 2 | 费用关联的商品类型 | `relatedRevenueSubjectId` + `Name` | 下拉（仅销售费用组织出现） | ❌ | `relatedRevenueSubjectId` / `Name` |
 * | 3 | 是否为项目费用 | `projectExpense` | 单选 否/是（`false`/`true`） | ✅ | `projectExpense` |
 * | 4 | 项目名称 | `financeProjectId` + 5 个快照字段 | 下拉（`projectExpense` 时出现） | 条件 ✅ | `financeProjectId` |
 * | 5 | 出差人 | `travelerIds` + `traveler` | **多选人员** | ✅ | `travelerIds` |
 * | 6 | 出差事由 | `reasons` | `a-textarea`，≤500 | ✅ | `reasons` |
 * | 7 | 金额总计 | `amount` | **只读**，前端算 | 服务端会重算 | 不接受调用方给 |
 * | 8 | 收款方信息 | 15 个 `payee*` / `receiving*` 字段 | **一整块子表单**（4 个分支） | ❌ **页面根本不校验** | `payeeInfo` |
 * | 9 | 预计付款日期 | `paymentDate` | 日期 | ✅ | `paymentDate` |
 * | 10 | 费用选择 | `feeItem` | 下拉（选项来自接口） | ✅ | `feeItem` |
 * | 11 | 费用用途 | `feePurpose` | `a-textarea`，≤500 | ✅ | `feePurpose` |
 * | 12 | 明细行 `travelEntryList[]` | 见 §四 | **数组，每行 13 个控件** | 见 §四 | `travelEntryList` |
 * | 13 | 其他说明 | `remark` | `a-textarea`，**无长度限制** | ❌ | `remark` |
 * | 14 | 附件 | `attachmentList` | 拖拽上传，≤10 件，≤128MB | ❌ | `attachments` |
 * | 15 | 提交 / 取消 | —— | 按钮 | —— | `submit` / （不做，见 §八） |
 *
 * **14 类控件全部表达到了。** 两个刻意的"不表达"：
 * - #7 金额总计是**前端算的**（`totalTravelBudgetAmount`），页面上没有输入框；
 *   SDK 一样算（`calculateAmount()`），**不接受调用方传**。
 * - #5 的 `traveler` 是 `travelerIds[0]` 的镜像，页面上没有独立控件，SDK 一样镜像。
 *
 * ---------------------------------------------------------------------------
 * 四、明细行数组：本流程与另外两条线**最大的形态差别**
 * ---------------------------------------------------------------------------
 *
 * 页面上「差旅信息1 / 差旅信息2 / …」可以加行删行（`handleThingAdd` / `handleThingRemove`），
 * 每行**产一个对象**，提交前在 `onFinish()` 里被**改写过一次**：
 *
 * ```js
 * travelEntryList: formState.value.travelEntryList.map(item => ({
 *   ...item,                          // ← 原样保留 startEndDate / startRegion / endRegion 三个数组
 *   startDate: item.startEndDate[0],  // ← 区间控件拆成两个标量
 *   endDate:   item.startEndDate[1],
 *   startProvince: item.startRegion[0], startCity: item.startRegion[1], startDistrict: item.startRegion[2],
 *   endProvince:   item.endRegion[0],   endCity:   item.endRegion[1],   endDistrict:   item.endRegion[2],
 *   inputTaxAmount: Number(item.inputTaxAmount) || 0,
 *   travelTotalAmount: getTravelTotalAmount(item),
 *   budgetDetailId: item.budgetDetailId, budgetDetailNo: item.budgetDetailNo,
 *   budgetAvailableAmount: item.budgetAvailableAmount,
 *   fundSource: formState.value.projectExpense ? item.fundSource : undefined,
 * }))
 * ```
 *
 * 三个**必须照抄、不能"顺手清理"**的点：
 *
 * 1. **`startEndDate` / `startRegion` / `endRegion` 三个数组留在载荷里**
 *    （`...item` 带过来的）。后端 VO 里没有它们，会在反序列化时被忽略 ——
 *    但**页面确实是这么发的**，D20 要逐字段一致，所以 SDK 也这么发。
 * 2. **`startRegion` / `endRegion` 是三级数组**（省 / 市 / 区），长度按位置展开成
 *    `startProvince` / `startCity` / `startDistrict`。**少于 3 段时那一位是 `undefined`**
 *    （页面的 `validateRequiredAddress` 只查 `length === 0`，不查长度是不是 3）——
 *    SDK 把这条收紧成"必须恰好 3 段"，理由见 §五第 4 条。
 * 3. **`fundSource` 在三元里给的是 `undefined`**，`JSON.stringify` 会把这个键**整个删掉**。
 *    所以非项目费用时载荷里**没有 `fundSource` 这个键**，不是 `null`。SDK 一样处理。
 *
 * ---------------------------------------------------------------------------
 * 五、服务端会改写什么（**这一节是看了后端 `BpmSpendingApplyTravelServiceImpl` 才有的**）
 * ---------------------------------------------------------------------------
 *
 * `POST /finance/bpm-spending-apply-travel/create` 里，**前端给的值有四处在服务端被覆盖或校验**：
 *
 * 1. **`amount` 与每行的 `travelTotalAmount` 由服务端重算**
 *    （`prepareTravelEntryList`：`travelTotalAmount = 交通+餐食+住宿+其他`，
 *    `amount = Σ(travelTotalAmount + inputTaxAmount)`）。前端算的**发过去也没用**，
 *    但页面发了，SDK 也就发 —— 它不是"多余"，它是**载荷的一部分**。
 * 2. **`financeProjectName/Code/Type/Attribute/CompanyId/CompanyName` 由服务端按
 *    `financeProjectId` 重新填**（`fillProjectSnapshot`）。SDK 仍然按页面那样先填一份
 *    快照（页面是选中项目时就填），但**不把它当作可信值**。
 * 3. **`projectExpense = true` 时有三条硬校验**，页面拦不住、只有后端会报 500：
 *    - `financeProjectId` 必填（`FINANCE_PROJECT_REQUIRED`）
 *    - 每一行的 `fundSource` 必填（`FINANCE_PROJECT_FUND_SOURCE_REQUIRED`）
 *    - 组织必须属于**沃德博创**体系（`FINANCE_PROJECT_EXPENSE_NO_WORKFLOW`）
 *      —— 而「组织选择」这个控件**只让选成本中心**（`financeCostCenter === 1`）。
 *      【实测，2026-09-21】全树 1565 个节点里**有 1109 个**是成本中心，depth 2..7，
 *      **其中确实有博创系的**（例如 `orgId=101 设计中心1236`，路径
 *      `沃德辰龙-沃德博创-沃德博创-系统研发-设计中心1236`）。
 *      ⇒ 这条路**走得通**，但选一个**非**博创系的成本中心（绝大多数）会 500。
 *      ⚠️ 这一条 SDK **不在本地拦**：判断"是不是博创系"要拿组织全路径去比，
 *      而 `getTree` 的节点上只有 `fullPath`（组织路径）而没有公司归属，
 *      靠字符串匹配猜一个公司名比让后端报 500 更不可靠。如实留给后端。
 * 4. **附件会被落库**：`ossfileApi.insertBatch(attachmentList)`，`id` 为空时按
 *    `{name,url,pages}` 新建 `oss_resource` 行。所以附件**不需要先建资源**，
 *    传 `{url, name}` 就够了（`url` 用 `base-upload-file` 传到 OSS，目录 `Finance/expense`）。
 *
 * ---------------------------------------------------------------------------
 * 六、审批人：**不是发起人选的，是从 `orgId` 派生的**（与另外两条线都不同）
 * ---------------------------------------------------------------------------
 *
 * BPMN 里 10 个 `userTask` 的 `candidateStrategy` **全是派生型**：
 *
 * | 策略 | 值 | 含义 |
 * | --- | --- | --- |
 * | `EXPRESSION` | 60 | 流程表达式（`org:target\|type:4\|post:572`、`${targetOrgDirectorIds}` 之类） |
 * | `POST` | 22 | 岗位（`candidateParam="648"`） |
 *
 * **没有一个 `START_USER_SELECT`（35）**，`get?key=` 的 `startUserSelectTasks` 也实测为 `[]`。
 * 这与请假那条线（写死的 3 个用户 id）和通用审批（真要人工选）**都不像**：
 * 这里的审批人**随 `targetOrgId` 变**，`targetOrgId` 就是表单里的 `orgId`。
 *
 * ⇒ 于是"**审批人绝对不能是发起人本人**"这条用户红线，在这条流程上的落地方式变了：
 * 不能靠"选人的时候避开自己"（我们压根不选人），只能靠
 * **提交前把审批链问出来、看自己会不会落进去**。这就是 `prepare()` 里
 * `POST /bpm/process-instance/preview` 那一步存在的理由（见 §七）。
 *
 * ⚠️ 本流程**没有** `get*RequiredStartUserSelectTasks` 的调用 —— 调查 §3.3e 说
 * "源码里没找到"，本次**复核确认**（`form/003/` 全目录 grep 无命中），
 * 所以 SDK 也不调它，`submit` 里**没有 `startUserSelectAssignees` 这个参数**。
 *
 * ---------------------------------------------------------------------------
 * 七、`prepare()` 是**只读**的，但它会打一次 `preview`（写链路的读→写依赖）
 * ---------------------------------------------------------------------------
 *
 * `POST /bpm/process-instance/preview` body
 * `{ processDefinitionKey, variables, startUserSelectAssignees: {}, copyUserIds: [] }`
 * 返回 `{ nodes: [{ nodeId, name, type, candidateStrategy, candidateUsers: [{id,nickname}], ... }] }`。
 * 它是页面上「查看审批流程」那个只读预览走的路（`components/portal/hxr/flow/useProcessPreview.js:87`）。
 *
 * SDK 用它做**两件事**，都在发写请求之前：
 * 1. 把"这条单子会打扰谁"如实报给调用方（`prepare()` 的返回值里有 `approvalChain`）；
 * 2. **自审拦截**：任何一个 `USER_TASK` 节点的 `candidateUsers` 里出现当前登录用户
 *    ⇒ **抛错、拒绝构造提交**，理由与通用审批那条线实测到的
 *    「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl:913-916`）是同一条。
 *
 * 项目费用先读 /finance/project/get，按 Java 同源规则将 principalStaffId 转字符串
 * 填入「课题负责人」。成功 prepare 的 previewComplete=true 仅表示变量已补齐，
 * 不保证稍后提交时组织、项目及审批配置不变；本轮此分支只做源码与离线验证。
 *
 * ---------------------------------------------------------------------------
 * 八、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/finance/form/003`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里**一条都匹配不到**
 * （那张表全是 `/dashboard/<域>/…` 前缀）。⇒ `resolveModuleType()` 返回 null、SDK 不发这个头。
 * 【与请假那条线同一结论，理由也一样】
 *
 * ---------------------------------------------------------------------------
 * 九、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **`PUT /update` 没做**：页面上的编辑入口不存在（`actionGetDetail()` 只读，
 *   `form/003` 里没有 edit 分支）。但注意 —— 页面有**「重新发起」**（`isReapply` +
 *   `fetchReapplyDetail()`），它走的是 `GET /get?id=` 回填 + 再 `create` 一次，
 *   **不是 update**。SDK 给 `detail()` 就够了。
 * - **`GET /page` 与 `/export-excel` 没做**：页面**没有任何地方调它们**（挂在后台管理侧）。
 *   要"查我的单子"走 `myInstances()` + `detail()`。
 * - **预算单选择（`budgetDetailId`）只表达、不校验**：页面不强制选预算，
 *   选不选只影响 `hasBudgetOverrun` 那个禁用提交的判据。SDK 照抄这两条
 *   （字段可选 + 超额拦提交），但**没有实现"按组织+月份拉预算候选"那个弹窗**
 *   （`POST /finance/spending-budget-person/list`）——那是一个独立的列表页，
 *   等有了预算这个页面再谈。
 * - **`relatedRevenueSubjectId`（销售费用专属）只有字段、没有候选入口**：
 *   它的候选来自 `GET /finance/ledger-accounts/leaf-list?rootName=主营业务收入`，
 *   但那一格**只在 `isSalesExpense()` 为真时渲染**，而 `isSalesExpense` 由所选组织的
 *   `orgAttribute` 决定。SDK 接受这个参数并原样发，**没有做"按组织判断要不要填"那一步**。
 * - **128MB 附件上限本地拦不了**：SDK 手上只有 `{url,name}`、算不出字节数（与请假同理）。
 * - **`BudgetAllocationReqDTO` 的预算占用没做**：后端只在 `paymentType === 1` 时校验并占用，
 *   而**页面从来不传 `paymentType`**（`formState` 里根本没有这个键）⇒ 走不到那条分支。
 *   SDK 一样不传。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与会议室 / 通用审批 / 请假同一个壳） */
export const TRAVEL_EXPENSE_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**，所以 prepare / submit / detail
 * 声明在这个页面上下文里。
 *
 * ⚠️ 取值**不是**来自 `create-list` 的 `formCustomCreatePath`（本账号的 create-list
 * 里没有这条流程，见文件头 §一），而是来自前端源码目录
 * `app/portal/views/simple/finance/form/003/` + `edit/index.vue:268` 写死的
 * `bpmProcessDefineKey`。**这是源码依据，不是接口实测。**
 */
export const TRAVEL_EXPENSE_FORM_PATH = '/simple/finance/form/003'

/** 「我的流程」页。**取消流程的入口在这里**，不在表单页。 */
export const TRAVEL_EXPENSE_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。**实测自 `GET /bpm/process-definition/get`**（name=差旅费支出申请表） */
export const TRAVEL_EXPENSE_PROCESS_KEY = 'internal_transportation_expense_request_form'

/** 后端 `BpmSpendingApplyTravelServiceImpl.PROCESS_KEY`，与实测值一致 */
export const TRAVEL_EXPENSE_PROCESS_NAME = '差旅费支出申请表'

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 form/003 的表单规则与后端 VO）
// ---------------------------------------------------------------------------

/** `formRules.reasons` 的 `max: 500` 与 `:maxlength="500"` */
export const REASONS_MAX = 500

/** `formRules.feePurpose` 的 `max: 500` 与 `:maxlength="500"` */
export const FEE_PURPOSE_MAX = 500

/** `common-upload-file-plus` 的 `:max="10"` */
export const ATTACHMENT_MAX_COUNT = 10

/** `:max-file-size="1024 * 1024 * 128"`（字节）。**本地校验不了**，见文件头 §九 */
export const ATTACHMENT_MAX_SIZE_MB = 128

/** 附件要传到的 OSS 目录（`common/utils/oss.js:63` 的 `ossFilePathOptions.finance.expense`） */
export const ATTACHMENT_OSS_FOLDER = 'Finance/expense'

/** `portal-finance-amount-input` 的 `:max="1000000000"`（每一格金额的上限） */
export const AMOUNT_MAX = 1_000_000_000

/** `portal-finance-amount-input` 的 `:precision="2"` */
export const AMOUNT_PRECISION = 2

/** 「是否为项目费用」的两个选项（`projectExpenseOptions`，硬编码在页面里） */
export const PROJECT_EXPENSE_OPTIONS = [
  { label: '否', value: false },
  { label: '是', value: true },
] as const

/** 「公司子类型」（收款方子表单，硬编码 `edit.vue:42-43`） */
export const COMPANY_SUB_TYPE_OPTIONS = [
  { label: '内部分公司', value: 1 },
  { label: '外部公司', value: 2 },
] as const

/**
 * 收款方类型。候选来自**平台字典 `payee_type`**
 * （【实测，2026-09-21】`/system/dict-data/grouped-list` → 1 个人 / 2 公司 / 3 银行）。
 *
 * ⚠️ 页面上 `showBank` 默认为 **false**，所以那个下拉**只渲染 1 与 2**，
 * 银行（3）选不到（`edit.vue:443`）。这里把 3 也列出来只是为了让契约完整 ——
 * `payeeTypeOptions()` 会按页面的过滤规则现读一次。
 */
export const PAYEE_TYPE_OPTIONS = [
  { label: '个人', value: 1 },
  { label: '公司', value: 2 },
] as const

/** 收款方子表单里**页面选不到**的那一个（`showBank === false`） */
export const PAYEE_TYPE_BANK = 3

/**
 * 出行方式字典 `trip_mode`【实测，2026-09-21】。
 * **字典是可运维改的**，要"现在这一刻的候选"请调 `travel-expense-dict-options`。
 */
export const TRIP_MODE_OPTIONS = [
  { label: '飞机', value: 1 },
  { label: '高铁', value: 2 },
  { label: '火车', value: 3 },
  { label: '轮船', value: 4 },
  { label: '长途客车', value: 5 },
  { label: '公共交通', value: 6 },
  { label: '出租车/网约车', value: 7 },
  { label: '公车', value: 8 },
  { label: '自驾', value: 9 },
] as const

/** 资金来源字典 `finance_project_fund_source`【实测，2026-09-21】。**仅项目费用时出现且必填** */
export const FUND_SOURCE_OPTIONS = [
  { label: '自筹资金', value: 1 },
  { label: '财政资金', value: 2 },
] as const

/** 项目类型字典 `finance_project_type`【实测，2026-09-21】，只用于**展示快照** */
export const PROJECT_TYPE_OPTIONS = [
  { label: '生物技术类', value: 1 },
  { label: '信息技术类', value: 2 },
  { label: '工程类', value: 3 },
] as const

/** 项目属性字典 `finance_project_attribute`【实测，2026-09-21】，只用于**展示快照** */
export const PROJECT_ATTRIBUTE_OPTIONS = [
  { label: '自主开发项目', value: 1 },
  { label: '外部科研项目', value: 2 },
  { label: '受托开发项目', value: 3 },
] as const

/**
 * 费用选择（`feeItem`）的候选 —— 【实测，2026-09-21】
 * `GET /finance/payment-slip-person/fee-item-options?sourceKey=finance_travel`
 * **只回一条**：`[{value: 1, label: '差旅费'}]`。
 *
 * ⇒ 页面 `ensureFeeItemValid()` 有一条「只有一个候选时自动选中」的逻辑，
 * 所以**这个字段用户其实没得选，恒为 1**。SDK 照抄这条自动填充。
 * 注意别跟字典 `finance_payment_fee_item`（132 条）搞混：那个是**别的**支出单用的。
 */
export const FEE_ITEM_OPTIONS = [{ label: '差旅费', value: 1 }] as const

/** `sourceKey` 参数：本表单固定 `finance_travel`（后端 `PaymentFeeItemEnum.TRAVEL_FEE`） */
export const FEE_ITEM_SOURCE_KEY = 'finance_travel'

/** 费用项目接口（页面 `fetchTravelFeeItemOptions` 打的那条） */
export const FEE_ITEM_API = '/admin-api/finance/payment-slip-person/fee-item-options'

/** 组织树接口（`portal-finance-tree-select-post-tree` 在 `use-all-org` 下打的那条） */
export const ORG_TREE_API = '/admin-api/org/organization/getTree'

/** 地区三级树接口（`portal-finance-region-selecter` 打的那条） */
export const AREA_TREE_API = '/admin-api/finance/area/tree'

/** 项目候选接口（`common/project-expense.js` 的 `fetchProjectOptions`） */
export const PROJECT_OPTIONS_API = '/admin-api/finance/project/options'

/** 出差人候选接口（`select/expense-user/paging.js:39`） */
export const TRAVELER_SEARCH_API = '/admin-api/sys/user/getUserBasicInfoPage'

/** 出差人候选只收这两个在职状态（`paging.js` 的 `statusList: '1,4'`） */
export const TRAVELER_STATUS_LIST = '1,4'

/** 收款方候选接口（`select/external-supplier/index.vue` 的 `api` 默认值） */
export const PAYEE_OPTIONS_API = '/admin-api/finance/party/payee-options'

/** 字典接口（平台字典，`getPlatformDictListByType` 读的就是它） */
export const PLATFORM_DICT_API = '/admin-api/system/dict-data/grouped-list'

/** 创建 / 查询单据的接口。**页面 `onFinish()` / `fetchReapplyDetail()` 打的就是这两条** */
export const CREATE_API = '/admin-api/finance/bpm-spending-apply-travel/create'
export const DETAIL_API = '/admin-api/finance/bpm-spending-apply-travel/get'

/** 审批链预览（「查看审批流程」那个只读预览，`useProcessPreview.js:87`） */
export const PREVIEW_API = '/bpm/process-instance/preview'

/** 「我的流程」列表（与另外两条线同一个接口） */
export const MY_INSTANCES_API = '/bpm/process-instance/my-page'

/** 发起人撤回自己的流程（与另外两条线同一个接口） */
export const CANCEL_API = '/bpm/process-instance/cancel-by-start-user'

/** 当前登录用户（`profile()` 用；**只投影 id 与姓名，不整份透传**） */
export const USER_INFO_API = '/sys/user/info'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 明细行里的金额字段（页面上一格一个 `portal-finance-amount-input`） */
export type TravelEntryAmount = number | string | null

/**
 * 一条差旅明细行（页面上「差旅信息N」那一块）。
 *
 * ⚠️ **三个数组字段的语义**：
 * - `startEndDate`：`[开始日期, 结束日期]`，页面是**一个** `a-range-picker`，
 *   提交时拆成 `startDate` / `endDate` 两个标量（**原数组仍然留在载荷里**，见文件头 §四）。
 * - `startRegion` / `endRegion`：`[省, 市, 区]` **三级数组**，取自
 *   `GET /finance/area/tree`（id 是**字符串**，如 `"110000"`）。提交时按位置展开成
 *   `startProvince` / `startCity` / `startDistrict`。
 *   **本 SDK 要求恰好 3 段**（页面只查"非空"，少于 3 段时后端会收到 `undefined` 的区 ——
 *   那是页面的一个洞，不是 SDK 该复刻的行为）。
 */
export type TravelEntryDraft = {
  /** `[开始日期, 结束日期]`，都是 `YYYY-MM-DD`，两个都必填 */
  startEndDate: [string, string]
  /** `[省, 市, 区]`，三级 id 数组（字符串），必填 */
  startRegion: [string, string, string] | string[]
  /** 出发地详细地址，必填（页面上与 `startRegion` 是**同一个控件块**的两个输入） */
  startAddress: string
  /** `[省, 市, 区]`，必填 */
  endRegion: [string, string, string] | string[]
  /** 到达地详细地址，必填 */
  endAddress: string
  /** 出行方式，字典 `trip_mode`（1..9），**可选** */
  tripMode?: number | null
  /** 交通费用，可选 */
  trafficAmount?: TravelEntryAmount
  /** 餐食补助，可选 */
  foodAmount?: TravelEntryAmount
  /** 住宿补助，可选 */
  housingAmount?: TravelEntryAmount
  /** 其他补助，可选 */
  otherAmount?: TravelEntryAmount
  /** 增值税进项税，可选（缺省 0） */
  inputTaxAmount?: TravelEntryAmount
  /**
   * 这一行的「差旅费合计」。**调用方不用给**（`buildTravelPayload()` 一定会覆盖它）。
   *
   * 之所以在类型里留一格：页面那一行的**运行时对象**里本来就有这个键
   * （`handleThingAdd()` 给的初值是 `0`），而 `onFinish()` 是 `{...item, travelTotalAmount: …}` ——
   * 键**位置**由 `...item` 决定。留着它，调用方才能像页面那样把行的键顺序摆对。
   */
  travelTotalAmount?: TravelEntryAmount
  /** 项目资金来源，字典 `finance_project_fund_source`；**仅 `projectExpense` 时必填** */
  fundSource?: number | null
  /** 预算明细 id，可选（页面上是「预算单选择」那个弹窗） */
  budgetDetailId?: number | string | null
  /** 预算明细单号，可选（跟着 `budgetDetailId` 一起） */
  budgetDetailNo?: string | null
  /** 预算可用金额快照，可选。**只用于 `hasBudgetOverrun` 那条拦提交的判据** */
  budgetAvailableAmount?: number | string | null
}

/**
 * 收款方信息（页面上那一整块 `portal-finance-payee-info-edit`）。
 *
 * ⚠️ **页面**（`form/003/page/pc/edit/index.vue`）**从头到尾没有校验过这块**：
 * 子表单的 `enableValidation` 默认 `false`（`edit.vue:298`），父表单的
 * `formRules` 里也没有任何 `payee*` 键（`index.vue:321-345`），`onFinish()` 直接
 * `...buildPayeeSubmitFields(payeeInfo)` 就发了。⇒ **不填也能提交**，
 * 所以 SDK 里它是**可选的**。两个分支的常用取值：
 *
 * ```jsonc
 * // 内部员工（payeeType=1 + isInternalStaff=true）
 * { "payeeType": 1, "isInternalStaff": true, "payeeStaffId": 14626 }
 * // 外部公司（payeeType=2 + companySubType=2）
 * { "payeeType": 2, "companySubType": 2, "receivingCompanyName": "XX 公司" }
 * // 不填（与页面一致，合法）
 * {}   // → 15 个键全为 null / '' 的默认形态
 * ```
 *
 * ⚠️ `isInternalStaff` 是**布尔**，不是 1/0 —— `payee-payload.js:24` 用的是
 * `isInternalStaff === false`，传 `0` 或 `'false'` **不会被当成外部人员**。
 */
export type TravelPayeeDraft = {
  /** 1 个人 / 2 公司（页面上选不到 3 银行，见 `PAYEE_TYPE_OPTIONS`） */
  payeeType?: number | null
  /** 1 内部分公司 / 2 外部公司（`payeeType === 2` 时用） */
  companySubType?: number | null
  /** **布尔**。`payeeType === 1` 时用：`true` 内部员工 / `false` 外部人员 */
  isInternalStaff?: boolean | null
  /** 收款公司（法人库 id）。`payeeType=2 & companySubType=1` 的新单走这个 */
  receivingCorporationId?: number | string | null
  /** 收款公司（组织 id）。**历史单**才走这个（与 `receivingCorporationId` 二选一） */
  receivingCompanyId?: number | string | null
  /** 收款公司名称。内部分公司时由法人名回填；外部公司时是手输/主数据名 */
  receivingCompanyName?: string | null
  receivingCorporationName?: string | null
  /** 外部客商的主数据 id / 编码 / 来源（`SUPPLIER` / `FINANCE_PARTY` / `CUSTOMER`） */
  payeeId?: number | string | null
  payeeCode?: string | null
  payeeSourceType?: string | null
  /** 收款员工（**用户 id**；`payeeType=1 & isInternalStaff=true` 时用） */
  payeeStaffId?: number | string | null
  /** 收款人工号（后端会按 `payeeStaffId` 回填，一般不用给） */
  payeeStaffNo?: string | null
  /** 收款人姓名（外部人员时是手输/主数据名） */
  payeeName?: string | null
  /** 收款银行 */
  receivingBankName?: string | null
  /** 收款银行字典值（只有走字典下拉那条分支才会有） */
  receivingBankDictValue?: string | null
  /** 收款账号 */
  receivingAccount?: string | null
}

/** 一次差旅费申请的完整草稿（**调用方给的那部分**） */
export type TravelExpenseDraft = {
  /** 组织 id（页面值形如 `"34"`，**字符串**）。必填。见 `orgOptions()` */
  orgId: number | string
  /** 是否为项目费用。必填，默认语义上就是 `false` */
  projectExpense: boolean
  /** 项目 id。`projectExpense === true` 时必填，可选时见 `projects()` */
  financeProjectId?: number | string | null
  /** 出差人（用户 id 数组）。必填，至少一个。见 `travelers()` */
  travelerIds: Array<number | string>
  /** 出差事由。必填，≤500 */
  reasons: string
  /** 费用用途。必填，≤500 */
  feePurpose: string
  /** 预计付款日期，`YYYY-MM-DD`。必填 */
  paymentDate: string
  /** 费用选择。**不给时 SDK 自动填 1（差旅费）**，与页面的 `ensureFeeItemValid()` 一致 */
  feeItem?: number | null
  /** 明细行，至少一行（页面上默认就有一行，且删到 0 行时金额校验过不去） */
  travelEntryList: TravelEntryDraft[]
  /** 其他说明。可选，**无长度限制**（页面上这一格没有 `:maxlength` 也没有规则） */
  remark?: string
  /** 附件，可选，≤10 件。`url` 用 `base-upload-file` 传到 `Finance/expense` */
  attachments?: Array<{ url: string; name?: string; [key: string]: unknown }>
  /** 收款方信息。可选（**页面不校验这块**） */
  payeeInfo?: TravelPayeeDraft
  /** 关联收入科目 id（**仅销售费用组织**的那一格，页面上 `isSalesExpense()` 为真才出现） */
  relatedRevenueSubjectId?: number | string | null
  /** 关联收入科目名称，与 id **成套**传（页面上是 `v-model:name`） */
  relatedRevenueSubjectName?: string | null
}

/** 组织树的一个节点（摊平后） */
export type TravelOrgOption = {
  /** 节点的 `id`（**字符串**，如 `"34"`）—— 它就是载荷里的 `orgId` 该传的值 */
  id: string
  name: string
  /** 层级，0 起 */
  depth: number
  /** `financeCostCenter === 1` 才**在页面上可以选**（`cost-center-only` 那个 prop） */
  selectable: boolean
  financialCostCenter?: number | null
  [key: string]: unknown
}

/** 项目候选的一项（`GET /finance/project/options`） */
export type TravelProjectOption = {
  id: number | string
  projectName?: string
  projectCode?: string
  projectType?: number | null
  projectAttribute?: number | null
  companyId?: number | null
  companyName?: string | null
  [key: string]: unknown
}

/** 出差人候选的一项（`GET /sys/user/getUserBasicInfoPage`） */
export type TravelTravelerOption = {
  id: string
  realName?: string | null
  username?: string | null
  organizationName?: string | null
  postName?: string | null
  [key: string]: unknown
}

/** 审批链预览里的一个节点（`POST /bpm/process-instance/preview` 的 `nodes[]`） */
export type TravelApprovalNode = {
  nodeId?: string
  name?: string | null
  type?: string
  candidateStrategy?: number | null
  candidateStrategyName?: string | null
  candidateUsers?: Array<{ id: number; nickname?: string }>
  approvalMode?: string | null
  conditionDescription?: string | null
  [key: string]: unknown
}

/** `prepare()` 的返回 */
export type TravelPrepareResult = {
  /** `submit()` 会发的业务载荷（**不含** `startUserSelectAssignees`，本流程没有这个键） */
  payload: Record<string, unknown>
  /** 后端会收到的流程变量（客户端能算的那部分） */
  variables: Record<string, unknown>
  /** 按当前项目与组织变量解析的审批链预览节点 */
  approvalChain: TravelApprovalNode[]
  /**
   * 成功 prepare 为 true，表示按当前源码补齐了全部流程变量。
   * 缺项目负责人时抛错；配置可能在预览之后变化，不能当成提交保证。
   */
  previewComplete: boolean
  /** 当前 USER_TASK 候选人；可能跨节点重复，空数组不能证明流程不会通知任何人 */
  approvers: Array<{ node: string; id: number; nickname: string }>
  /** SDK 算出来的金额总计（= 每一行的 交通+餐食+住宿+其他+进项税 之和） */
  amount: number
}

/** 单据详情（`GET /finance/bpm-spending-apply-travel/get` 的响应，只列用到的字段） */
export type TravelExpenseRecord = {
  id?: number | null
  orgId?: number | string | null
  projectExpense?: boolean | null
  financeProjectId?: number | null
  financeProjectName?: string | null
  traveler?: number | null
  travelerIds?: string | null
  travelerName?: string | null
  reasons?: string | null
  amount?: number | null
  paymentDate?: string | null
  remark?: string | null
  feeItem?: number | null
  feePurpose?: string | null
  processInstanceId?: string | null
  attachment?: string | null
  attachmentList?: Array<{ url?: string; name?: string; [key: string]: unknown }>
  travelEntryList?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type TravelInstanceQuery = {
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
    throw new Error(`${label}必填，且必须是 YYYY-MM-DD 格式的字符串（页面 a-range-picker 的 value-format），收到 ${JSON.stringify(value)}`)
  }
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

function assertText (value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}必填（页面 formRules 的 required）`)
  }
  if (value.length > max) {
    throw new Error(`${label}最多 ${max} 个字，收到 ${value.length} 个`)
  }
  return value
}

/**
 * 金额归一。页面每一格是 `portal-finance-amount-input`（`a-input-number`），
 * 产出的是 **number**（清空时是 `null`，失焦后变 `0`）。
 * 空 / `''` / `null` / `undefined` 一律当 **0**（页面 `Number(item.inputTaxAmount) || 0`）。
 */
function toAmount (value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  const num = Number(value)
  if (!Number.isFinite(num)) {
    throw new Error(`${label}必须是数字（页面是 a-input-number），收到 ${JSON.stringify(value)}`)
  }
  if (num < 0 || num > AMOUNT_MAX) {
    throw new Error(`${label}必须落在 0 ~ ${AMOUNT_MAX} 之间（页面 :min=0 :max=1000000000），收到 ${num}`)
  }
  return num
}

/** 页面的 `getTravelTotalAmount(item)`：**不含**进项税 */
export function entryTravelTotal (entry: TravelEntryDraft): number {
  return (
    toAmount(entry?.trafficAmount, '交通费用 trafficAmount') +
    toAmount(entry?.foodAmount, '餐食补助 foodAmount') +
    toAmount(entry?.housingAmount, '住宿补助 housingAmount') +
    toAmount(entry?.otherAmount, '其他补助 otherAmount')
  )
}

/** 页面的 `getTravelBudgetAmount(item)`：**含**进项税。它才是进 `amount` 的那个 */
export function entryBudgetAmount (entry: TravelEntryDraft): number {
  return entryTravelTotal(entry) + toAmount(entry?.inputTaxAmount, '增值税进项税 inputTaxAmount')
}

/**
 * 金额总计 —— 复刻页面的 `totalTravelBudgetAmount` computed。
 *
 * ⚠️ **不接受调用方传**：页面上「金额总计」是只读展示，`onFinish()` 里
 * `amount: totalTravelBudgetAmount.value` 是**覆盖**写的。
 * 注意它是**浮点数**（`0.1+0.2` 那种），页面直接把它发出去；
 * 后端 `BigDecimal` 收。SDK 用 `toFixed(2)` 收一下尾，避免 `0.30000000000000004`
 * 这种值进载荷 —— 这是**本 SDK 唯一一处刻意偏离页面**的地方（见测试里那条）。
 */
export function calculateAmount (entries: readonly TravelEntryDraft[]): number {
  const sum = (entries ?? []).reduce((acc, entry) => acc + entryBudgetAmount(entry), 0)
  return Number(sum.toFixed(2))
}

function assertRegion (value: unknown, label: string): [string, string, string] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(
      `${label}必须是**恰好 3 段**的数组 [省, 市, 区]（页面是三级级联 portal-finance-region-selecter，` +
        `取值来自 GET ${AREA_TREE_API}，id 是字符串）。收到 ${JSON.stringify(value)}`,
    )
  }
  return [String(value[0]), String(value[1]), String(value[2])] as [string, string, string]
}

/**
 * 明细行校验 —— 逐条抄页面的 `ensureTravelEntryRules()` / `validateRequiredAddress()`：
 *
 * | 页面规则 | 这里 |
 * | --- | --- |
 * | `startEndDate` 非空（`validateRequiredArray`） | ✅ 且**两端都要是合法日期** |
 * | `startRegion` 非空 **且** `startAddress` 非空 | ✅ 且 **恰好 3 段** |
 * | `endRegion` 非空 **且** `endAddress` 非空 | ✅ 且 **恰好 3 段** |
 * | `fundSource` 在 `projectExpense` 时必填（`fundSourceRules`） | ✅ |
 * | `tripMode` / 四格金额 / `budgetDetailId` **无规则** | ✅ 不强制 |
 */
function assertEntry (entry: TravelEntryDraft, index: number, projectExpense: boolean): void {
  const at = `明细行[${index}]`
  const range = entry?.startEndDate
  if (!Array.isArray(range) || range.length < 2) {
    throw new Error(`${at}的 startEndDate 必须是 [开始日期, 结束日期]（页面 validateRequiredArray），收到 ${JSON.stringify(range)}`)
  }
  assertDate(range[0], `${at}的开始日期 startEndDate[0]`)
  assertDate(range[1], `${at}的结束日期 startEndDate[1]`)
  if (String(range[0]) > String(range[1])) {
    throw new Error(`${at}的开始日期晚于结束日期（${range[0]} > ${range[1]}）—— a-range-picker 本身不允许这样选`)
  }
  assertRegion(entry?.startRegion, `${at}的出发地点 startRegion`)
  if (typeof entry?.startAddress !== 'string' || entry.startAddress.trim() === '') {
    throw new Error(`${at}的出发详细地址 startAddress 必填（页面 validateRequiredAddress：地点与详细地址是一个控件块里的两个输入）`)
  }
  assertRegion(entry?.endRegion, `${at}的目标地点 endRegion`)
  if (typeof entry?.endAddress !== 'string' || entry.endAddress.trim() === '') {
    throw new Error(`${at}的到达详细地址 endAddress 必填`)
  }
  if (entry?.tripMode !== undefined && entry.tripMode !== null && String(entry.tripMode) !== '') {
    const mode = Number(entry.tripMode)
    if (!Number.isFinite(mode)) {
      throw new Error(`${at}的出行方式 tripMode 必须是数字（字典 trip_mode），收到 ${JSON.stringify(entry.tripMode)}`)
    }
  }
  // 四格金额的边界（页面每格都是 :min=0 :max=1000000000 :precision=2）
  toAmount(entry?.trafficAmount, `${at}的交通费用 trafficAmount`)
  toAmount(entry?.foodAmount, `${at}的餐食补助 foodAmount`)
  toAmount(entry?.housingAmount, `${at}的住宿补助 housingAmount`)
  toAmount(entry?.otherAmount, `${at}的其他补助 otherAmount`)
  toAmount(entry?.inputTaxAmount, `${at}的增值税进项税 inputTaxAmount`)
  if (projectExpense) {
    // 页面 fundSourceRules：required + validator(v != null && v !== '')
    if (entry?.fundSource === undefined || entry?.fundSource === null || String(entry.fundSource) === '') {
      throw new Error(
        `${at}缺「资金来源」fundSource：页面 fundSourceRules 在这一格上挂了 required，` +
          '后端也有 FINANCE_PROJECT_FUND_SOURCE_REQUIRED（项目费用时每一行都要有）',
      )
    }
  }
}

/**
 * 明细行的「预算超额」判据 —— 复刻页面的 `hasBudgetOverrun` computed：
 *
 * ```js
 * formState.value.travelEntryList.some(item => item.budgetDetailId && getItemCoverBudget(item) < 0)
 * ```
 *
 * 它为真时页面的**提交按钮直接 `:disabled`**（`index.vue:223`）。
 * 所以 SDK 在发请求之前就拦 —— 写操作会惊动真人，能让它红在前面就红在前面。
 */
export function hasBudgetOverrun (entries: readonly TravelEntryDraft[]): boolean {
  return (entries ?? []).some((entry) => {
    if (!entry?.budgetDetailId) return false
    const balance = Number(entry?.budgetAvailableAmount)
    if (Number.isNaN(balance)) return false
    return balance - entryBudgetAmount(entry) < 0
  })
}

/**
 * 附件校验：**只做页面真会拦的那一条**（`:max="10"`）。
 *
 * ⚠️ 与请假 / 通用审批那两条线**不一样**：本表单的 `common-upload-file-plus`
 * **没有 `accept`**（默认 `'*'`）⇒ **没有扩展名白名单**，所以 SDK 也不拦扩展名。
 * 128MB 的上限同样拦不了（SDK 手上算不出字节数）。
 *
 * 值的形状照抄 `common-upload-file-plus`（`waiting.js:175-181`）：
 * `{url, name, size, pages, type}` —— 但**只有 `url` 是必须的**，
 * 其余原样透传（后端 `OssResourceDTO` 收 `name` / `pages` / `size`）。
 */
export function assertAttachments (attachments: unknown): Array<Record<string, unknown>> {
  if (attachments === undefined || attachments === null) return []
  if (!Array.isArray(attachments)) {
    throw new Error('attachments 必须是数组（页面上是 [{url, name, size, pages, type}]，最多 10 件）')
  }
  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new Error(`附件最多 ${ATTACHMENT_MAX_COUNT} 件，收到 ${attachments.length} 件（页面 :max=10）`)
  }
  return attachments.map((raw, index) => {
    const item = raw as Record<string, unknown> | null
    const url = item?.url
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(
        `第 ${index + 1} 件附件缺 url。url 要用 base-upload-file 先传到 OSS（目录 ${ATTACHMENT_OSS_FOLDER}）。` +
          '后端 ossfileApi.insertBatch 会按 {name,url,pages} 直接建 oss_resource 行，**不需要先建资源**',
      )
    }
    // 页面 waiting.js 存的就这五个键；原样透传，但把 url 挑出来保证类型
    return { ...item, url } as Record<string, unknown>
  })
}

// ---------------------------------------------------------------------------
// 收款方：`buildPayeeSubmitFields()` 的**逐行复刻**
// ---------------------------------------------------------------------------

function payeeSourceTypeOf (payee: TravelPayeeDraft): string {
  return String(payee?.payeeSourceType ?? '') || ''
}

function isInternalCompanyPayee (payee: TravelPayeeDraft): boolean {
  return Number(payee?.payeeType) === 2 && Number(payee?.companySubType) === 1
}

function isExternalCompanyPayee (payee: TravelPayeeDraft): boolean {
  return Number(payee?.payeeType) === 2 && Number(payee?.companySubType) === 2
}

function isExternalPersonPayee (payee: TravelPayeeDraft): boolean {
  return Number(payee?.payeeType) === 1 && payee?.isInternalStaff === false
}

function isBankPayee (payee: TravelPayeeDraft): boolean {
  return Number(payee?.payeeType) === 3
}

function isExternalPayee (payee: TravelPayeeDraft): boolean {
  return isExternalCompanyPayee(payee) || isExternalPersonPayee(payee) || isBankPayee(payee)
}

/**
 * 把 `payeeInfo` 展开成后端要的那 15 个字段 —— **逐行复刻
 * `app/portal/utils/finance/payee-payload.js` 的 `buildPayeeSubmitFields()``**。
 *
 * 三个必须照抄的细节：
 *
 * 1. **`payeeId` 不给时是 `''`（空串）而不是 `null`** —— 源码是 `payeeInfo.payeeId ?? ''`。
 *    这是这一组字段里唯一一个空串，别"顺手统一成 null"。
 * 2. **`payeeSourceType` 这个键是条件出现的**：只有 `isExternalPayee` **且**它非空时才加。
 *    空串 ⇒ **载荷里根本没有这个键**（与 `fundSource` 那条同一类）。
 * 3. **`receivingCompanyId` 与 `receivingCorporationId` 互斥**：内部分公司走法人库时
 *    （有 `receivingCorporationId`）**`receivingCompanyId` 与 `receivingCompanyName` 强制为 `null`**；
 *    只有历史单（只有组织 id）才传 `receivingCompanyId`。
 *
 * 不传 `payeeInfo`（或传 `{}`）时，返回的 15 个键全在，值分别是 `null` 或 `''` ——
 * **这与页面一致**（页面从不校验这块，空着照样提交）。
 */
export function buildPayeeSubmitFields (payeeInfo: TravelPayeeDraft | undefined): Record<string, unknown> {
  const payee = (payeeInfo ?? {}) as TravelPayeeDraft
  const payeeSourceType = payeeSourceTypeOf(payee)
  const isInternalCompany = isInternalCompanyPayee(payee)
  const external = isExternalPayee(payee)
  const receivingCorporationId = isInternalCompany ? (payee.receivingCorporationId ?? null) : null
  const receivingCompanyId = isInternalCompany && !receivingCorporationId
    ? (payee.receivingCompanyId ?? null)
    : null
  const receivingCorporationName = receivingCorporationId
    ? (payee.receivingCorporationName || payee.receivingCompanyName || null)
    : null
  const receivingCompanyName = receivingCorporationId
    ? null
    : (payee.receivingCompanyName || null)

  const fields: Record<string, unknown> = {
    payeeType: payee.payeeType ?? null,
    companySubType: payee.companySubType ?? null,
    isInternalStaff: payee.isInternalStaff ?? null,
    receivingCompanyId,
    receivingCompanyName,
    receivingCorporationId,
    receivingCorporationName,
    payeeId: payee.payeeId ?? '',
    payeeCode: payee.payeeCode || '',
    payeeStaffId: payee.payeeStaffId ?? null,
    payeeStaffNo: payee.payeeStaffNo || null,
    payeeName: payee.payeeName || null,
    receivingBankName: payee.receivingBankName || null,
    receivingBankDictValue: payee.receivingBankDictValue || null,
    receivingAccount: payee.receivingAccount || null,
  }

  if (external && payeeSourceType) {
    fields.payeeSourceType = payeeSourceType
    if (payeeSourceType === 'CUSTOMER' && payee.payeeCode) {
      fields.payeeCode = payee.payeeCode
    }
  }

  return fields
}

// ---------------------------------------------------------------------------
// 载荷构造
// ---------------------------------------------------------------------------

/** 项目快照 —— 复刻 `common/project-expense.js` 的 `getProjectSummaryFields()` */
export function projectSummaryFields (project: TravelProjectOption | undefined): Record<string, unknown> {
  const p = (project ?? {}) as TravelProjectOption
  return {
    financeProjectName: p.projectName ?? '',
    financeProjectCode: p.projectCode ?? '',
    financeProjectType: p.projectType ?? null,
    financeProjectAttribute: p.projectAttribute ?? null,
    financeProjectCompanyId: p.companyId ?? null,
    financeProjectCompanyName: p.companyName ?? '',
  }
}

/** `orgId` 归一成字符串（页面发的就是字符串，`"34"`） */
function normalizeOrgId (value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (raw === '') throw new Error('组织 orgId 必填（页面 formRules.orgId 的 required）')
  return raw
}

/** 出差人归一：数组、非空、每一项都是有效用户 id */
function normalizeTravelerIds (value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('出差人 travelerIds 必填且不能是空数组（页面 formRules.travelerIds 的 required）')
  }
  const ids = value.map((id, index) => {
    if (id === null || id === undefined || String(id).trim() === '' || !Number.isFinite(Number(id))) {
      throw new Error(`travelerIds[${index}] 不是有效的用户 id：${JSON.stringify(id)}`)
    }
    return Number(id)
  })
  return [...new Set(ids)]
}

/**
 * **在一次请求都不发的前提下**把必然失败的输入挡住。
 *
 * 与请假那条线同样的理由：写操作会惊动真人，能让它红在第一个字节之前就红在
 * 第一个字节之前。这里覆盖的是**页面上会拦的每一条** + **后端会 500 的那两条**。
 */
export function assertTravelDraft (draft: TravelExpenseDraft): void {
  const orgId = normalizeOrgId(draft?.orgId)
  const travelerIds = normalizeTravelerIds(draft?.travelerIds)
  assertText(draft?.reasons, '出差事由 reasons', REASONS_MAX)
  assertText(draft?.feePurpose, '费用用途 feePurpose', FEE_PURPOSE_MAX)
  assertDate(draft?.paymentDate, '预计付款日期 paymentDate')
  assertAttachments(draft?.attachments)

  const projectExpense = draft?.projectExpense === true
  if (draft?.projectExpense !== undefined && typeof draft.projectExpense !== 'boolean') {
    throw new Error(`projectExpense 必须是布尔（页面是 a-radio-group，两个选项就是 false / true），收到 ${JSON.stringify(draft.projectExpense)}`)
  }
  if (projectExpense) {
    // 页面 formRules.financeProjectId 的 validator + 后端 FINANCE_PROJECT_REQUIRED
    if (draft?.financeProjectId === undefined || draft?.financeProjectId === null || draft?.financeProjectId === '') {
      throw new Error(
        'projectExpense = true 时「项目名称」financeProjectId 必填（页面 formRules.financeProjectId 的 validator，' +
          '后端 FINANCE_PROJECT_REQUIRED）',
      )
    }
  }

  const entries = draft?.travelEntryList
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      'travelEntryList 至少要有一行（页面上默认就有一行 `handleThingAdd()`；' +
        '删到 0 行时「金额总计」为 0，amount 的 validateAmount 会报「请输入金额」）',
    )
  }
  entries.forEach((entry, index) => assertEntry(entry, index, projectExpense))

  const amount = calculateAmount(entries)
  if (!(amount > 0)) {
    throw new Error(
      `金额总计必须大于 0，算出来是 ${amount}（页面 validateAmount：` +
        '`if (value <= 0) callback(new Error(\'请输入金额\'))`）。' +
        '四格补助里至少一格要填正数',
    )
  }

  if (hasBudgetOverrun(entries)) {
    throw new Error(
      '有明细行的「预算可用金额」小于这一行的差旅费合计 ⇒ 页面的提交按钮直接 disabled' +
        '（`hasBudgetOverrun`）。要么把金额降下来，要么换一个预算单',
    )
  }

  if (projectExpense && orgId === '') {
    throw new Error('projectExpense = true 时组织 orgId 必填')
  }
  void travelerIds
}

/**
 * 构造提交载荷 —— **逐字段复刻 `onFinish()`**，包括：
 *
 * - 键的**书写顺序**（D20：键顺序不同也算不一致）。顺序来自 `formState` 的声明顺序，
 *   再叠加 `{...formState, travelerIds, traveler, amount, travelEntryList, ...payee}` ——
 *  JS 里给**已存在**的键重新赋值**不会**改变它的位置，所以 `travelerIds` / `traveler` /
 *  `amount` / `travelEntryList` 都停在原位，**只有 15 个收款字段是追加在最后的**。
 * - `payeeInfo` 与 `budgetAllocations` **被 delete 掉**（源码里那两行）。
 * - 明细行的结构改写 + 三个数组原样保留（见文件头 §四）。
 * - `fundSource` 在非项目费用时是 `undefined` ⇒ **这个键整个消失**。
 *
 * @param draft 调用方给的草稿
 * @param project 选中项目的快照来源（`projects()` 返回里的一项）。不给时不填快照，
 *                与"用户没选过项目"的页面状态一致
 * @param feeItem 费用选择。不给时按页面的 `ensureFeeItemValid()` 自动填 1
 */
export function buildTravelPayload (
  draft: TravelExpenseDraft,
  project?: TravelProjectOption,
  feeItem?: number | null,
): Record<string, unknown> {
  const orgId = normalizeOrgId(draft?.orgId)
  const travelerIds = normalizeTravelerIds(draft?.travelerIds)
  const reasons = assertText(draft?.reasons, '出差事由 reasons', REASONS_MAX)
  const feePurpose = assertText(draft?.feePurpose, '费用用途 feePurpose', FEE_PURPOSE_MAX)
  const paymentDate = assertDate(draft?.paymentDate, '预计付款日期 paymentDate')
  const attachments = assertAttachments(draft?.attachments)
  const projectExpense = draft?.projectExpense === true
  const entries = (draft?.travelEntryList ?? []).map((entry, index) => {
    assertEntry(entry, index, projectExpense)
    return entry
  })
  const amount = calculateAmount(entries)

  const snapshot = projectSummaryFields(project)
  // 页面：`Object.assign(formState, getProjectSummaryFields(option))` —— 选中项目时
  // `financeProjectCompanyId` 会被**新增**到 formState；没选过时这个键不存在。
  const projectFields: Record<string, unknown> = project
    ? { ...snapshot }
    : {
        financeProjectName: '',
        financeProjectCode: '',
        financeProjectType: null,
        financeProjectAttribute: null,
        financeProjectCompanyName: '',
      }

  // 费用选择：页面 ensureFeeItemValid() 在"只有一个候选"时自动选中 ⇒ 恒为 1
  const resolvedFeeItem = feeItem === undefined || feeItem === null || String(feeItem) === ''
    ? (FEE_ITEM_OPTIONS[0]?.value ?? null)
    : Number(feeItem)

  const payload: Record<string, unknown> = {
    // ---- formState 的声明顺序（`index.vue:271-300`）----
    orgId,
    projectExpense,
    financeProjectId: draft?.financeProjectId ?? null,
    ...projectFields,
    traveler: travelerIds[0],
    travelerIds,
    feeItem: resolvedFeeItem,
    feePurpose,
    reasons,
    amount,
    // `payeeInfo` 在这里（源码里随后被 delete）
    paymentDate,
    remark: draft?.remark ?? '',
    travelEntryList: entries.map((entry) => ({
      // `...item`：三个数组（startEndDate / startRegion / endRegion）**留在载荷里**
      ...entry,
      startDate: entry.startEndDate[0],
      endDate: entry.startEndDate[1],
      startProvince: entry.startRegion[0],
      startCity: entry.startRegion[1],
      startDistrict: entry.startRegion[2],
      endProvince: entry.endRegion[0],
      endCity: entry.endRegion[1],
      endDistrict: entry.endRegion[2],
      inputTaxAmount: toAmount(entry.inputTaxAmount, '增值税进项税 inputTaxAmount'),
      travelTotalAmount: entryTravelTotal(entry),
      budgetDetailId: entry.budgetDetailId ?? '',
      budgetDetailNo: entry.budgetDetailNo ?? '',
      budgetAvailableAmount: entry.budgetAvailableAmount ?? null,
      // ⚠️ 非项目费用时是 `undefined` ⇒ JSON 里**没有这个键**
      fundSource: projectExpense ? (entry.fundSource ?? null) : undefined,
    })),
    attachmentList: attachments,
    relatedRevenueSubjectId: draft?.relatedRevenueSubjectId ?? null,
    relatedRevenueSubjectName: draft?.relatedRevenueSubjectName || '',
    // `budgetAllocations` 在这里（源码里随后被 delete）
    // ---- 15 个收款字段：`...buildPayeeSubmitFields(payeeInfo)`，追加在最后 ----
    ...buildPayeeSubmitFields(draft?.payeeInfo),
  }

  return payload
}

/**
 * 流程变量 —— 复刻后端 `buildProcessInstanceVariables()` **客户端能算的那部分**。
 *
 * 后端还会补两个键，**客户端算不出来、也不该假装能算**：
 *
 * | 变量 | 谁加 | 为什么客户端加不了 |
 * | --- | --- | --- |
 * | `targetOrgId` | `ProcessInstanceVariablesHelper.setTargetOrgId` | 就是 `orgId`，**客户端知道** ⇒ SDK 加 |
 * | `费用申请类型` | `buildProcessInstanceVariables` | 就是"项目费用 / 非项目费用"，**客户端知道** ⇒ SDK 加 |
 * | `课题负责人` | 同上，值 = `String(project.principalStaffId)` | `GET /finance/project/options` 的返回里**没有 `principalStaffId`** ⇒ **客户端加不了** |
 */
export function buildProcessVariables (
  draft: TravelExpenseDraft,
  orgIdRaw?: number | string,
): Record<string, unknown> {
  const orgId = normalizeOrgId(orgIdRaw ?? draft?.orgId)
  const projectExpense = draft?.projectExpense === true
  const variables: Record<string, unknown> = {
    费用申请类型: projectExpense ? '项目费用' : '非项目费用',
  }
  const asNumber = Number(orgId)
  // `setTargetOrgId` 里有一句 `if (targetOrgId == null) return;` —— 0 / NaN 就不放
  if (Number.isFinite(asNumber)) {
    variables.targetOrgId = asNumber
  }
  return variables
}

/** 路径参数里的 id 归一（只用于报错信息与 URL 拼接） */
function describeId (id: number | string, what: string): string {
  const value = typeof id === 'number' ? String(id) : String(id ?? '').trim()
  if (value === '') throw new Error(`${what} 不能为空`)
  return value
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/**
 * 本表单用到的**全部**平台字典，以及每个字典对应页面上的哪一格、谁来读它。
 *
 * ⚠️ 这张表存在的理由是**一处真实修过的缺陷**：第一版把每个字典写成了**一个独立的
 * `ParamSpec`**，而每个 `ParamSpec.name` 都是 `'dictType'` ⇒ OpenAPI 里这条操作出现了
 * **5 个同名参数**，被 redocly 的 `operation-parameters-unique` 规则拦下（4 个错误）。
 * 那不只是规格洁癖：**调用方/AI 看到 5 个都叫 `dictType` 的参数，根本不知道该传哪一个**。
 * 而实现那边的签名一直是 `dictOptions(dictType: string)` —— **一个字符串就够**。
 *
 * ⇒ 现在收敛成**一个** `dictType` 枚举参数（见 `DICT_TYPE_PARAM`），
 * 每个字典的"是什么 / 谁在用 / 哪一格"的信息**全部并进它的 `options[].label` 与描述**，
 * **一条都没丢**。测试里有一条正面锁钉住"这条能力的参数名不重复"，并做过反证。
 *
 * 关于**留哪几个**的取舍（不是全留也不是为了过校验而砍）：
 *
 * - `trip_mode` / `finance_project_fund_source` / `payee_type` —— **用户在页面上真的会选**，
 *   分别对应「出行方式」「资金来源」「收款方类型」三格。**必须留**。
 * - `finance_project_type` / `finance_project_attribute` —— 页面上**没有输入控件**，
 *   它们是「项目信息」那块只读描述里的展示值（值随 `financeProjectId` 从
 *   `projects()` 的快照来）。**仍然保留**，理由是它不丢信息、反而补信息：
 *   只读接口 `detail()` / `projects()` 回来的是**数字**（如 `projectType: 3`），
 *   调用方要靠这个字典才能把它渲染成「工程类」。砍掉它等于让调用方自己去找字典名。
 */
export const FORM_DICT_TYPES = [
  {
    value: 'trip_mode',
    label: '出行方式（明细行的 tripMode）',
    control: '明细行「出行方式」下拉',
    fallback: TRIP_MODE_OPTIONS,
  },
  {
    value: 'finance_project_fund_source',
    label: '项目资金来源（明细行的 fundSource，**仅项目费用时出现且必填**）',
    control: '明细行「资金来源」下拉（projectExpense 时）',
    fallback: FUND_SOURCE_OPTIONS,
  },
  {
    value: 'finance_project_type',
    label: '项目类型（**只读**：项目信息那块展示用，值来自 projects() 的快照）',
    control: '「项目信息」只读描述块',
    fallback: PROJECT_TYPE_OPTIONS,
  },
  {
    value: 'finance_project_attribute',
    label: '项目属性（**只读**：项目信息那块展示用，值来自 projects() 的快照）',
    control: '「项目信息」只读描述块',
    fallback: PROJECT_ATTRIBUTE_OPTIONS,
  },
  {
    value: 'payee_type',
    label: '收款方类型（收款方子表单的 payeeType；页面只渲染 1 个人 / 2 公司）',
    control: '收款方子表单「收款方类型」单选',
    fallback: PAYEE_TYPE_OPTIONS,
  },
] as const

/**
 * `travel-expense-dict-options` 的**唯一**参数。
 *
 * 传哪个字典名就返回哪个字典；**不给时按 `trip_mode`**（页面挂载时第一个读的就是它）。
 * `options` 里的每一项就是可传的字典名，label 里写清了它是什么、谁在用、离线兜底值长什么样。
 */
const DICT_TYPE_PARAM: ParamSpec = {
  name: 'dictType',
  kind: 'enum',
  required: false,
  description:
    '要读哪个字典。**传哪个名字就返回哪个字典**（一次一个）。可选值与它们的用途：' +
    FORM_DICT_TYPES.map((d) => `\`${d.value}\` = ${d.label}`).join('；') +
    '。不给时默认 `trip_mode`（页面挂载时第一个读的字典）。' +
    '⚠️ 这几个都是**平台字典**（`GET /system/dict-data/grouped-list`），**可运维改** —— ' +
    '本文件里写死的那几张常量表只是为了让调用方不查字典也知道有哪些值，**要"现在这一刻的候选"以本能力为准**。' +
    '⚠️ 页面每条字典都是**现读**的（`portal-finance-dict-select` 的 `type`），SDK 走的是同一个接口。',
  options: FORM_DICT_TYPES.map((d) => ({ label: d.label, value: d.value })),
}

/** prepare / submit 共用的业务参数（**两边一定完全一样**，页面也是同一个 `buildSubmitPayload`） */
const CONTENT_PARAMS: ParamSpec[] = [
  {
    name: 'orgId',
    kind: 'tree',
    required: true,
    description:
      '组织 id，必填。**页面上只有「成本中心」节点可以选**（`cost-center-only`），' +
      `候选见 travel-expense-org-options（GET ${ORG_TREE_API}）。` +
      '⚠️ 它同时决定 BPMN 里的 `targetOrgId` ⇒ **决定审批人是谁**（见 travel-expense-prepare 的 approvalChain）',
  },
  {
    name: 'projectExpense',
    kind: 'enum',
    required: true,
    description:
      '是否为项目费用，必填。⚠️ 选 `true` 会同时触发三条后端硬校验：项目必填（SDK 本地拦）、' +
      '**每一行都要有 `fundSource`**（SDK 本地拦）、且**组织必须属于沃德博创体系**' +
      '（`FINANCE_PROJECT_EXPENSE_NO_WORKFLOW`，**SDK 不拦**——见能力文件头 §五第 3 条）。' +
      '实测 1109 个可选成本中心里确实有博创系的（如 orgId=101 设计中心1236），但绝大多数不是',
    options: PROJECT_EXPENSE_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) })),
  },
  {
    name: 'financeProjectId',
    kind: 'search',
    required: false,
    description:
      '项目 id。`projectExpense = true` 时必填。候选见 travel-expense-projects（关键字）。' +
      '⚠️ 服务端会按它重填 financeProjectName/Code/Type/Attribute/Company* 六个快照字段，SDK 填的那份**不可信**',
    lookup: { capabilityId: 'travel-expense-projects', keywordParam: 'keyword' },
  },
  {
    name: 'travelerIds',
    kind: 'search',
    required: true,
    description:
      '出差人（用户 id 数组），必填且至少一个。候选见 travel-expense-travelers（**必须先给关键字**）。' +
      '载荷里的 `traveler` 是它的第一个元素（页面上没有独立控件）',
    lookup: { capabilityId: 'travel-expense-travelers', keywordParam: 'keyword' },
  },
  { name: 'reasons', kind: 'text', required: true, description: `出差事由，必填，最多 ${REASONS_MAX} 字` },
  { name: 'feePurpose', kind: 'text', required: true, description: `费用用途，必填，最多 ${FEE_PURPOSE_MAX} 字` },
  { name: 'paymentDate', kind: 'date', required: true, description: '预计付款日期 `YYYY-MM-DD`，必填。⚠️ 它同时是预算弹窗的 `budgetMonth` 来源' },
  {
    name: 'feeItem',
    kind: 'number',
    required: false,
    description:
      `费用选择。候选见 travel-expense-fee-items（**实测只有一条：1 差旅费**）。` +
      '不给时 SDK 按页面的 `ensureFeeItemValid()` 自动填 1 —— 一个候选时页面就是这么自动选中的',
  },
  {
    name: 'travelEntryList',
    kind: 'text',
    required: true,
    description:
      '**明细行数组**，至少一行。**每行**是：' +
      '`startEndDate:[开始日,结束日]`（必填）、' +
      '`startRegion:[省,市,区]`（必填，**恰好 3 段**，见 travel-expense-area-options）、`startAddress`（必填）、' +
      '`endRegion:[省,市,区]`（必填）、`endAddress`（必填）、' +
      '`tripMode`（字典 trip_mode，可选）、`trafficAmount`/`foodAmount`/`housingAmount`/`otherAmount`/`inputTaxAmount`（可选，四格之和要 > 0）、' +
      '`fundSource`（**仅 projectExpense 时必填**）、`budgetDetailId`/`budgetDetailNo`/`budgetAvailableAmount`（可选）',
  },
  { name: 'remark', kind: 'text', required: false, description: '其他说明。可选，**页面上这一格没有长度限制**' },
  {
    name: 'attachments',
    kind: 'text',
    required: false,
    description:
      `附件数组 [{url, name, ...}]，最多 ${ATTACHMENT_MAX_COUNT} 件。` +
      `url 用 base-upload-file 先传到 OSS（目录 ${ATTACHMENT_OSS_FOLDER}）。` +
      `⚠️ 本表单**没有 accept 白名单**（与请假/通用审批不同）；${ATTACHMENT_MAX_SIZE_MB}MB 单件上限 SDK 校验不了。` +
      '后端会按 {name,url,pages} 直接落 oss_resource，**不需要先建资源**',
  },
  {
    name: 'payeeInfo',
    kind: 'text',
    required: false,
    description:
      '收款方信息。⚠️ **页面从头到尾不校验这块**（子表单 enableValidation 默认 false、父表单 rules 里没有 payee* 键），' +
      '所以它是**可选的**，不传就发 15 个全 null/空串的默认值。' +
      '常用形态：内部员工 `{payeeType:1, isInternalStaff:true, payeeStaffId}`；' +
      '外部公司 `{payeeType:2, companySubType:2, receivingCompanyName}`。' +
      '⚠️ `isInternalStaff` 是**布尔**不是 1/0',
  },
  {
    name: 'relatedRevenueSubjectId',
    kind: 'number',
    required: false,
    description: '关联收入科目 id。**仅销售费用组织**会出现这一格（`isSalesExpense()`）；SDK 原样发、不做组织判断',
  },
  { name: 'relatedRevenueSubjectName', kind: 'text', required: false, description: '关联收入科目名称，与 id 成套传' },
]

export const travelExpenseCapabilities: CapabilityDefinition[] = [
  {
    id: 'travel-expense-definition',
    title: '查询差旅费支出申请流程的流程定义',
    pagePath: TRAVEL_EXPENSE_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${TRAVEL_EXPENSE_PROCESS_KEY}`,
        options: [{ label: TRAVEL_EXPENSE_PROCESS_NAME, value: TRAVEL_EXPENSE_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'travel-expense-org-options',
    title: '读「组织选择」的候选（组织树）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'costCenterOnly',
        kind: 'boolean',
        required: false,
        description:
          '只保留页面上**可以选**的节点（`financeCostCenter === 1`，对应控件上的 `cost-center-only`）。默认 true。' +
          '【实测】全树 1565 个节点里有 **1109 个**是成本中心（depth 2..7）。' +
          '⚠️ 列表很长：**给一个 keyword 再取**（页面是在前端过滤的，不额外发请求）',
      },
      { name: 'keyword', kind: 'text', required: false, description: '按名字模糊过滤（页面是在前端过滤的，不额外发请求）' },
    ],
  },
  {
    id: 'travel-expense-fee-items',
    title: '读「费用选择」的候选（页面下拉的选项）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'sourceKey',
        kind: 'enum',
        required: false,
        description: `来源键，本表单固定 ${FEE_ITEM_SOURCE_KEY}`,
        options: [{ label: '差旅费（finance_travel）', value: FEE_ITEM_SOURCE_KEY }],
      },
    ],
  },
  {
    id: 'travel-expense-dict-options',
    title: '读出行方式 / 资金来源等字典（页面下拉的候选）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    // ⚠️ **只有一个参数**（`dictType`）。它曾经被写成 5 个同名参数，
    //    那是契约缺陷而不只是规格问题 —— 见 `FORM_DICT_TYPES` 的注释
    params: [DICT_TYPE_PARAM],
  },
  {
    id: 'travel-expense-area-options',
    title: '读地区三级树（出发地点 / 目标地点的候选）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'parentId',
        kind: 'text',
        required: false,
        description: '只取某个节点的子树。不给时返回整棵树（实测 34 个省、id 是**字符串**如 "110000"）',
      },
    ],
  },
  {
    id: 'travel-expense-projects',
    title: '读「项目名称」的候选（projectExpense 时用）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      { name: 'keyword', kind: 'text', required: false, description: '项目名关键字。**页面发的是空串**（一次拉全部，实测 7 条），所以这里也不强制' },
    ],
  },
  {
    id: 'travel-expense-project-principal',
    title: '读取项目课题负责人，补齐项目费用预览变量',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [{ name: 'id', kind: 'text', required: true, description: 'travel-expense-projects 返回的项目 id，不是员工或用户 ID' }],
  },
  {
    id: 'travel-expense-travelers',
    title: '搜「出差人」候选（按关键字分页）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '**必填**。⚠️ 页面上这个下拉是**不带关键字**就打开、然后无限翻页的' +
          '（`paging.js` 传 `name: \'\'`，实测全量 4225 人）—— 无头**不能照抄**（设计 D6 / H35：长选项必须先要关键字）',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1（页面每页 20）' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20（页面就是 20）' },
    ],
  },
  {
    id: 'travel-expense-prepare',
    title: '提交前准备（只读）：本地校验 + 拼载荷 + 问审批链 + 自审拦截',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: CONTENT_PARAMS,
  },
  {
    id: 'travel-expense-submit',
    title: '提交差旅费支出申请（会真的发起流程、给审批人推待办）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: true,
    params: CONTENT_PARAMS,
  },
  {
    id: 'travel-expense-detail',
    title: '查询单条差旅费支出申请单据',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值，也是流程的 businessKey）。' +
          '⚠️ 这个响应里**有** `processInstanceId`（后端 create 时回过写），所以取消可以不用翻列表',
      },
    ],
  },
  {
    id: 'travel-expense-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: TRAVEL_EXPENSE_MY_LIST_PATH,
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
        description: '流程类型字典 bpm_process_type',
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'travel-expense-cancel',
    title: '取消（撤回）我发起的差旅费支出申请流程',
    pagePath: TRAVEL_EXPENSE_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '也可以从 travel-expense-detail 的 `processInstanceId` 拿',
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
  {
    id: 'travel-expense-payee-options',
    title: '搜收款方候选（收款方子表单里那三个「选择」框的候选）',
    pagePath: TRAVEL_EXPENSE_FORM_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '**必填**。这是本 SDK **刻意偏离页面**的一处：页面把 500 条候选**一次性拉下来在前端过滤**' +
          '（实测 `payee-options` 返回 500 条、无关键字），无头照抄会冲掉调用方上下文（D6 / H35）',
      },
      { name: 'orgId', kind: 'text', required: false, description: '组织 id（与 companyId 至少给一个，后端要求）' },
      { name: 'companyId', kind: 'text', required: false, description: '法人公司 id（与 orgId 至少给一个）' },
      { name: 'limit', kind: 'number', required: false, description: '最多返回多少条，默认 20' },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type TravelExpenseOptions = {
  /** 找流程实例时最多翻几页（每页 `scanPageSize` 条） */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

/** 字典接口返回的一项 */
type DictGroup = { dictType?: string; dataList?: Array<{ label?: string; value?: string | number }> }

type OrgNode = {
  id?: string | number
  name?: string
  financeCostCenter?: number | null
  children?: OrgNode[]
  [key: string]: unknown
}

type AreaNode = { id?: string | number; name?: string; children?: AreaNode[]; [key: string]: unknown }

export function createTravelExpenseCapability (
  request: PortalRequest,
  options: TravelExpenseOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /**
   * 当前登录用户。**只投影 id / 姓名**。
   *
   * ⚠️ 本流程的载荷里**没有**发起人字段（与请假不同：请假要把 userId/userName/
   * staffCode/fullPath 四个抄进载荷），所以这个函数**只服务于一件事**：
   * 自审拦截（`prepare()` 里拿自己的 id 去比对候选审批人）。
   *
   * 与请假同样的理由**不整份返回**：`/sys/user/info` 的响应带 `password2` 与 `salt`。
   */
  async function profile (): Promise<{ id: string; realName: string; organizationId: string }> {
    const info = await request<Record<string, unknown>>({ url: USER_INFO_API, method: 'get' })
    return {
      id: String(info?.id ?? ''),
      realName: String(info?.realName ?? ''),
      organizationId: String(info?.organizationId ?? ''),
    }
  }

  /** 组织树（摊平）。页面那个控件要 `include-finance-attr` 与 `include-virtual` 两个参数 */
  async function orgOptions (query: { costCenterOnly?: boolean; keyword?: string } = {}): Promise<TravelOrgOption[]> {
    const tree = await request<OrgNode[]>({
      url: ORG_TREE_API,
      method: 'get',
      params: { includeFinanceAttr: 1, includeVirtual: true },
    })
    const costCenterOnly = query.costCenterOnly !== false
    const keyword = String(query.keyword ?? '').trim().toLowerCase()
    const out: TravelOrgOption[] = []
    const walk = (nodes: OrgNode[] | undefined, depth: number): void => {
      for (const node of nodes ?? []) {
        const id = node?.id === undefined || node.id === null ? '' : String(node.id)
        if (id !== '') {
          const selectable = Number(node?.financeCostCenter) === 1
          const name = String(node?.name ?? '')
          if ((!costCenterOnly || selectable) && (keyword === '' || name.toLowerCase().includes(keyword))) {
            out.push({
              ...node,
              id,
              name,
              depth,
              selectable,
              financialCostCenter: node?.financeCostCenter ?? null,
            })
          }
        }
        walk(node?.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }

  /** 地区三级树（页面 `fetchAreaTree()` 打的那条）。id 是**字符串** */
  const areaOptions = (parentId?: string): Promise<AreaNode[]> =>
    request<AreaNode[]>({ url: AREA_TREE_API, method: 'get' }).then((tree) => {
      if (parentId === undefined || String(parentId).trim() === '') return tree ?? []
      const wanted = String(parentId)
      const find = (nodes: AreaNode[] | undefined): AreaNode[] | null => {
        for (const node of nodes ?? []) {
          if (String(node?.id) === wanted) return node.children ?? []
          const hit = find(node?.children)
          if (hit) return hit
        }
        return null
      }
      return find(tree) ?? []
    })

  /** 费用选择候选（页面 `fetchTravelFeeItemOptions()`） */
  async function feeItems (sourceKey = FEE_ITEM_SOURCE_KEY): Promise<Array<{ label: string; value: number }>> {
    const list = await request<Array<{ label?: string; value?: string | number }>>({
      url: FEE_ITEM_API,
      method: 'get',
      params: { sourceKey },
    })
    return (Array.isArray(list) ? list : []).map((item) => ({
      label: String(item?.label ?? ''),
      value: Number(item?.value),
    }))
  }

  /** 平台字典的一项（页面 `getPlatformDictListByType(type, true)` 读的就是它） */
  async function dictOptions (dictType: string): Promise<Array<{ label: string; value: number }>> {
    const groups = await request<DictGroup[]>({ url: PLATFORM_DICT_API, method: 'get' })
    const group = (Array.isArray(groups) ? groups : []).find((g) => g?.dictType === dictType)
    return (group?.dataList ?? []).map((item) => ({
      label: String(item?.label ?? ''),
      value: Number(item?.value),
    }))
  }

  /** 项目候选（页面 `fetchProjectOptions()`） */
  const projects = (keyword = ''): Promise<TravelProjectOption[]> =>
    request<TravelProjectOption[]>({
      url: PROJECT_OPTIONS_API,
      method: 'get',
      params: { keyword },
    })

  /**
   * 出差人候选。
   *
   * ⚠️ **必须给关键字**：页面上这个下拉不带关键字就打开、然后无限翻页
   * （实测全量 4225 人），无头照抄会冲掉调用方上下文（设计 D6 / H35）。
   */
  function travelers (query: { keyword: string; pageNo?: number; pageSize?: number }): Promise<{ list: TravelTravelerOption[]; total: number }> {
    const keyword = String(query?.keyword ?? '').trim()
    if (keyword === '') {
      return Promise.reject(
        new Error(
          '搜出差人必须先给关键字：Portal 页面自己会不带关键字把 4225 人全量拉下来，无头不能照抄（设计 D6 / H35）。' +
            '换一个姓名/工号关键字再试',
        ),
      )
    }
    return request<{ list: TravelTravelerOption[]; total: number }>({
      url: TRAVELER_SEARCH_API,
      method: 'get',
      params: {
        pageNo: query.pageNo ?? 1,
        pageSize: query.pageSize ?? 20,
        name: keyword,
        statusList: TRAVELER_STATUS_LIST,
      },
    })
  }

  /**
   * 收款方候选。⚠️ **SDK 刻意加了一道关键字**（页面是全量 500 条前端过滤），理由见能力描述。
   */
  async function payeeOptions (query: {
    keyword: string
    orgId?: string | number
    companyId?: string | number
    limit?: number
  }): Promise<Array<Record<string, unknown>>> {
    const keyword = String(query?.keyword ?? '').trim()
    if (keyword === '') {
      return Promise.reject(new Error('搜收款方必须先给关键字（页面一次拉 500 条在前端过滤，无头不能照抄，设计 D6 / H35）'))
    }
    if ((query?.orgId === undefined || query.orgId === '') && (query?.companyId === undefined || query.companyId === '')) {
      return Promise.reject(new Error('收款方候选接口要求 orgId 或 companyId 至少给一个（后端「组织或法人公司不能为空」）'))
    }
    const list = await request<Array<Record<string, unknown>>>({
      url: PAYEE_OPTIONS_API,
      method: 'get',
      params: {
        ...(query?.orgId === undefined || query.orgId === '' ? {} : { orgId: query.orgId }),
        ...(query?.companyId === undefined || query.companyId === '' ? {} : { companyId: query.companyId }),
      },
    })
    const wanted = keyword.toLowerCase()
    return (Array.isArray(list) ? list : [])
      .filter((item) => String(item?.name ?? '').toLowerCase().includes(wanted) || String(item?.code ?? '').includes(keyword))
      .slice(0, query?.limit ?? 20)
  }

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: TravelInstanceQuery = {},
  ): Promise<{ list: ProcessInstanceRow[]; total: number }> =>
    request<{ list: ProcessInstanceRow[]; total: number }>({
      url: MY_INSTANCES_API,
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
   * 按业务单据 id 找流程实例。
   *
   * ⚠️ 与请假那条线**不完全一样**：本流程的 `GET /get?id=` 响应里**有**
   * `processInstanceId`（后端 create 的末尾把它回写了），所以 `cancel()` 优先走 detail。
   * 但 detail 也可能因为权限/删除而拿不到，所以这条路仍然保留着 ——
   * 「我的流程」里 `businessKey` 就是业务单据 id（后端 `setBusinessKey(String.valueOf(id))`）。
   *
   * **还要按 `processDefinitionKey` 再筛一道**：`businessKey` 是各业务表自己的主键，
   * 「差旅费 51」与「请假 51」会撞成同一个字符串。
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
            row.processDefinitionKey === TRAVEL_EXPENSE_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的差旅费流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 travel-expense-my-instances 自己按条件找。',
    )
  }

  /** 项目快照：给出 `financeProjectId` 时去候选里把它捞出来（页面 `handleProjectChange` 就是干这个） */
  async function resolveProject (draft: TravelExpenseDraft): Promise<TravelProjectOption | undefined> {
    if (draft?.financeProjectId === undefined || draft?.financeProjectId === null || draft?.financeProjectId === '') {
      return undefined
    }
    const wanted = String(draft.financeProjectId)
    const list = await projects('')
    const hit = (list ?? []).find((item) => String(item?.id) === wanted)
    if (!hit) {
      throw new Error(
        `financeProjectId=${wanted} 不在 ${PROJECT_OPTIONS_API} 的候选里。` +
          '页面也是从这里选的（show-search + 前端过滤），传一个不存在的 id 页面做不到',
      )
    }
    return hit
  }

  /** 一次"把载荷拼齐"的公共动作：**取项目快照 → 拼载荷**。prepare 与 submit 都走它 */
  async function build (draft: TravelExpenseDraft): Promise<{
    payload: Record<string, unknown>
    variables: Record<string, unknown>
    previewComplete: boolean
  }> {
    // 先在本地把"必然失败"的输入挡住，再发任何请求（写操作会惊动真人）
    assertTravelDraft(draft)
    const project = await resolveProject(draft)
    const payload = buildTravelPayload(draft, project, draft?.feeItem)
    const variables = buildProcessVariables(draft)
    return {
      payload,
      variables,
      // 项目费用时后端会补一个客户端拿不到的「课题负责人」变量 ⇒ 预览不完整
      previewComplete: draft?.projectExpense !== true,
    }
  }

  /**
   * 问后端"这条单子会落到谁头上" —— `POST /bpm/process-instance/preview`，
   * 页面上「查看审批流程」那个只读预览走的就是它（`useProcessPreview.js:87`）。
   *
   * ⚠️ 它**不是**审批人选择接口（本流程没有 `START_USER_SELECT` 节点，
   * `startUserSelectAssignees` 恒传 `{}`）。它的唯一用途是**把审批链如实报出来**。
   */
  async function previewApprovalChain (
    variables: Record<string, unknown>,
  ): Promise<TravelApprovalNode[]> {
    const result = await request<{ nodes?: TravelApprovalNode[] }>({
      url: PREVIEW_API,
      method: 'post',
      data: {
        processDefinitionKey: TRAVEL_EXPENSE_PROCESS_KEY,
        variables,
        startUserSelectAssignees: {},
        copyUserIds: [],
      },
    })
    return Array.isArray(result?.nodes) ? result.nodes : []
  }

  /** 项目设置页 /finance/project/get；仅投影预览所需字段。 */
  async function projectPrincipal (id: number | string): Promise<{
    id: number | string; principalStaffId: number | string | null; principalName: string | null; status: number | null
  }> {
    describeId(id, '项目 id')
    const row = await request<{ id?: number | string; principalStaffId?: number | string | null; principalName?: string | null; status?: number | null }>({ url: '/finance/project/get', method: 'get', params: { id } })
    if (!row || String(row.id) !== String(id)) throw new Error('项目详情不存在或 id 不匹配；停止审批预览')
    return { id: row.id!, principalStaffId: row.principalStaffId ?? null, principalName: row.principalName ?? null, status: row.status ?? null }
  }

  /** 从审批链里挑出「会收到待办的人」 */
  function collectApprovers (nodes: readonly TravelApprovalNode[]): Array<{ node: string; id: number; nickname: string }> {
    const out: Array<{ node: string; id: number; nickname: string }> = []
    for (const node of nodes ?? []) {
      if (node?.type !== 'USER_TASK') continue
      for (const user of node?.candidateUsers ?? []) {
        out.push({ node: String(node?.name ?? node?.nodeId ?? ''), id: Number(user?.id), nickname: String(user?.nickname ?? '') })
      }
    }
    return out
  }

  /**
   * **自审拦截** —— 用户 2026-09-20 的原话：「审批人**绝对不要选发起人本人**」。
   *
   * 这条流程上它长得不一样：审批人不是调用方选的，是从 `orgId` 派生的（见文件头 §六）。
   * 所以"避开"只能靠**提交前把审批链问出来、看自己会不会落进去**。
   * 后端那条规则是 `BpmTaskServiceImpl:913-916` 的
   * 「流程发起人与审批人相同，自动审核通过」—— 中了它就是**流程秒完、`cancel` 撤不掉、
   * 永久留下一条撤不掉的单据**（测试环境里已经有 3 条这样的）。
   */
  function assertNotSelfApprover (
    chain: readonly TravelApprovalNode[],
    me: { id: string; realName: string },
  ): void {
    const mine = String(me?.id ?? '').trim()
    if (mine === '') return
    const hits = collectApprovers(chain).filter((a) => String(a.id) === mine)
    if (hits.length > 0) {
      const nodes = [...new Set(hits.map((h) => h.node))].join('、')
      throw new Error(
        `当前登录用户（${me.id} ${me.realName}）出现在审批链的「${nodes}」节点上。` +
          '后端有一条「流程发起人与审批人相同，自动审核通过」的规则，那样流程会当场结束，' +
          '接下来必然撤不掉（cancel 会报「流程不处于运行中」），会永久留下一条撤不掉的单据。' +
          '换一个组织 orgId（审批人随 targetOrgId 派生），换到审批链里没有你的那个组织再提交',
      )
    }
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 */
    definition (key: string = TRAVEL_EXPENSE_PROCESS_KEY): Promise<Record<string, unknown>> {
      return request<Record<string, unknown>>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    profile,
    orgOptions,
    areaOptions,
    feeItems,
    dictOptions,
    projects,
    travelers,
    payeeOptions,
    myInstances,
    findInstanceByBusinessKey,
    previewApprovalChain,
    projectPrincipal,

    /** 纯本地：金额总计（页面的「金额总计」那一格，不接受调用方给） */
    amount: (entries: readonly TravelEntryDraft[]): number => calculateAmount(entries),

    /**
     * 提交前准备（**只读**）：本地校验 → 拼载荷 → 问审批链 → **自审拦截**。
     *
     * 一次网络都不写。返回的 `payload` 就是 `submit()` 会发的东西，
     * 便于调用方在真提交之前先看一眼；`approvers` 是**这条单子会打扰到的真人**。
     *
     * 项目费用先读取项目负责人，按 Java 同源规则补齐变量；读取失败或缺负责人时拒绝预览。
     * previewComplete 仅说明变量完整，不保证预览与稍后提交之间配置不变。
     */
    async prepare (draft: TravelExpenseDraft): Promise<TravelPrepareResult> {
      const { payload, variables } = await build(draft)
      if (draft.projectExpense === true) {
        const project = await projectPrincipal(draft.financeProjectId!)
        if (project.status !== 1) throw new Error('项目未启用或状态缺失；停止审批预览')
        if (project.principalStaffId === null || !/^\d+$/.test(String(project.principalStaffId)) || Number(project.principalStaffId) <= 0) {
          throw new Error('项目未配置有效课题负责人 principalStaffId；停止审批预览')
        }
        // Java buildProcessInstanceVariables 使用员工 ID 的字符串；不能替换为 userId。
        variables['课题负责人'] = String(project.principalStaffId)
      }
      const [chain, me] = await Promise.all([previewApprovalChain(variables), profile()])
      assertNotSelfApprover(chain, me)
      return {
        payload,
        variables,
        approvalChain: chain,
        previewComplete: true,
        approvers: collectApprovers(chain),
        amount: calculateAmount(draft?.travelEntryList ?? []),
      }
    },

    /**
     * 真正提交（**写操作**）：建单据（主表 + 明细行）+ 落附件 + 起一条审批流。
     *
     * ⚠️ 它会**给真人推待办**。本流程的审批人**由 `orgId` 派生**（见文件头 §六），
     * 调用方**选不了**，所以测试请：
     *   1. **先走 `prepare()`** —— 它会做自审拦截，并把"会打扰谁"报出来；
     *   2. `reasons` / `remark` 里带 `SDK-TEST-` 前缀（本流程**没有标题字段**，
     *      `reasons` 是收到的人唯一能看出这是测试数据的地方）；
     *   3. 测完立刻用 `cancel()` 撤掉。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`，主表主键）。
     * 它同时是流程的 `businessKey`，所以 `detail()` 与 `cancel()` 都吃它。
     * ⚠️ 不是流程实例 id —— 流程实例 id 要 `detail()` 的 `processInstanceId` 或翻「我的流程」。
     */
    async submit (draft: TravelExpenseDraft): Promise<unknown> {
      // async 不是为了 await：本地校验失败要变成 **rejected promise**
      const { payload } = await build(draft)
      return request({ url: CREATE_API, method: 'post', data: payload })
    },

    /**
     * 单条单据详情（**只读**）。页面 `fetchReapplyDetail()` 打的就是它
     * （「重新发起」那条路 —— 注意它不是 update，是回填之后再 create 一次）。
     */
    async detail (id: number | string): Promise<TravelExpenseRecord> {
      describeId(id, '差旅费单据 id')
      return request<TravelExpenseRecord>({ url: DETAIL_API, method: 'get', params: { id } })
    },

    /**
     * 取消（撤回）自己发起的流程（**写操作**）。
     *
     * `DELETE /bpm/process-instance/cancel-by-start-user`，body `{ id, reason }`。
     * **`id` 是流程实例 id，不是业务单据 id** —— 两个都收：
     * 给 `businessKey` 时先去 `detail()` 里取 `processInstanceId`，
     * 取不到再翻「我的流程」（`findInstanceByBusinessKey`）。
     *
     * `reason` 必填：后端 `@NotEmpty`。
     *
     * ⚠️ **撤销不掉只有一种原因**（本流程）：发起人本人就是某个节点的审批人 ⇒ 那个节点
     * 当场自动通过；一串全中则整条流程走完，`cancel` 会报「流程不处于运行中」。
     * `prepare()` 的 `assertNotSelfApprover()` 就是在防这个。
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
                'processInstanceId 来自 travel-expense-detail 或 travel-expense-my-instances，' +
                'businessKey 就是 submit 返回的业务单据 id',
            ),
          )
        }
        // 先试 detail（本流程的 detail 响应里**有** processInstanceId，比请假那条线省一次翻页）
        try {
          const record = await request<TravelExpenseRecord>({
            url: DETAIL_API,
            method: 'get',
            params: { id: params.businessKey },
          })
          const fromDetail = String(record?.processInstanceId ?? '').trim()
          if (fromDetail !== '') id = fromDetail
        } catch {
          // detail 拿不到就落到翻列表那条路，不吞错：下面找不到会抛得更明确
        }
        if (id === '') {
          const instance = await findInstanceByBusinessKey(params.businessKey)
          id = String(instance.id)
        }
      }
      return request({
        url: CANCEL_API,
        method: 'delete',
        data: { id, reason },
      })
    },
  }
}

export type TravelExpenseCapability = ReturnType<typeof createTravelExpenseCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与通用审批 / 请假同样的分工（也因此同名）：`withIdempotency` 需要**身份**
 * （租户 / 用户），那是会话层的东西，所以包装放在组装点，能力模块只声明形状。
 */
export type TravelExpenseCapabilityWithIdempotency = TravelExpenseCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **为什么这条同样最需要防重**：后端零幂等，重发一次就是**第二条单据 +
   * 第二串真人待办 + 第二次预算占用**。⚠️ 本流程**没有**请假那条
   * 「同一天已有运行中的请假」的天然防线（后端 `create` 里没有任何去重校验），
   * 所以超时重试时**必须**原样传回同一个 `requestId`。
   */
  submitIdempotent: (params: TravelExpenseDraft & { requestId: string }) => Promise<unknown>
}
