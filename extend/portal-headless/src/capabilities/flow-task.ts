import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'
import {
  assertDateTime,
  BPM_TASK_WITHDRAW_PATH,
  buildTaskWithdrawPayload,
  type BacklogTaskRow,
  type PageResult,
  TASK_WITHDRAW_PARAMS,
  type TaskWithdrawParams,
} from './backlog-task-examine.js'

/**
 * 审批管理域流程中心的五页 —— 发起流程 / 待办任务 / 已办任务 / 抄送我的 / 我的流程。
 *
 * | 页面 | 菜单路径 | 路由文件 | 形态 |
 * | --- | --- | --- | --- |
 * | 发起流程 | `/dashboard/flow/task/create/list` | `…/hr/flow/task/create/list/index.vue` | **不是列表页**，是流程定义卡片墙 |
 * | 待办任务 | `/dashboard/flow/task/todo/list` | `…/hr/flow/task/todo/list.vue` | 13 行，**复用组件** |
 * | 已办任务 | `/dashboard/flow/task/done/list` | `…/hr/flow/task/done/list.vue` | 13 行，**复用组件** |
 * | 抄送我的 | `/dashboard/flow/task/copy/list` | `…/hr/flow/task/copy/list.vue` | 列表页（`customLoad`） |
 * | 我的流程 | `/dashboard/flow/task/my/list` | `…/hr/flow/task/my/list.vue` | 列表页（`customLoad`） |
 *
 * 这一份与 `src/capabilities/flow-manage.ts`（流程模型 / AI审核配置 / 流程实例 / 流程任务）
 * 的分界是**使用者**：这五页面向「经办人自己的事」，那四页面向「管理员看全局」。
 *
 * ## 基准对照（`baseline/flow-management.browser.json`，2026-09-21 抓）
 *
 * | 页面 | 基准里那条 | 结论 |
 * | --- | --- | --- |
 * | 发起流程 | `?suspensionState=1&processType=1&_t=` | **逐字节一致** |
 * | 待办任务 | `?order=&orderField=&name=&title=&startUserName=&finished=1&selectType=1&pageNo=1&pageSize=20&_t=` | **逐字节一致** |
 * | 已办任务（新会话直开） | 同上，`finished=2` | **逐字节一致**（这一条有过一段分歧史，见下） |
 * | 抄送我的 | `?order=&orderField=&processInstanceName=&title=&pageNo=1&pageSize=20&_t=` | **逐字节一致**（三个选择器确实整个不见） |
 * | 我的流程 | `?order=&orderField=&name=&title=&category=&pageNo=1&pageSize=20&_t=` | **源码 + 离线回归一致**；暂无独立浏览器基准 |
 *
 * 既有基准的 8 条请求头都与契约一致：`{tenant-id, token, Accept-Language, Accept}` ——
 * **没有 `module-type`**。我的流程页也按同一条目录规则推导为 `moduleType: null`，由独立页面上下文接入。
 *
 * ### 「已办任务」那一条的分歧史（已定案，留档以免再踩）
 *
 * **初版基准里，标着 `/dashboard/flow/task/done/list` 的那条发的是 `finished=1`**
 * —— 而且与它前一条「待办任务」**逐字节相同**。当时判定这是**采集侧的状态泄漏**、
 * 不是这一页的契约，证据是源码里的三条（与"`finished` 应当是 2"的推导分开记）：
 *
 * - 两页渲染的是同一个组件，而组件在**非 setup 的 `<script>` 里有一个模块级变量**
 *   `let stateCache = null`（`backlog/task-examine/list.vue:130`），
 *   `onBeforeUnmount` 时把整个 `formState`（**含 `finished`**）存进去，
 *   下一次 setup 时 `Object.assign(rrList.formState, stateCache.formState)` 覆盖回来
 *   （同文件 `:259-274`）。变量是模块级的、**不按路由分**，所以在待办页存下的
 *   `finished=1` 会被已办页读走。初版基准的采集顺序恰好是「待办 → 已办」。
 * - 这一页**自己的**声明是 `:finished="2"`（`done/list.vue`，与 `todo/list.vue` 逐行对称、
 *   只差 title / permission / finished / key 四处）。
 *
 * 所以本能力一直按 **2** 钉死（把 1 写死会**静默地把待办数据当成已办返回**）。
 *
 * **2026-09-21 复核定案**：新会话**直接打开** `#/dashboard/flow/task/done/list`（不经过待办页），
 * 发出的是 `finished=2` —— 泄漏判断成立，契约保持 2 是对的。基准已按新会话重抓修正，
 * 该行现在标注为「已办任务（新会话直开）」，本文件与基准**逐字节一致**。
 *
 * ⚠️ **顺带的方法学结论**（比这一页本身值钱）：`tools/baseline/install-hook.js` 装在 SPA 里、
 * **跨 hash 导航不卸载**，所以先访问的页面会把**模块级状态**漏给后访问的页面。
 * 同域多页抓基准要么**每页一个新会话**，要么**按顺序复核**。
 * 参见 `docs/pages/已办任务.md` 里同一段留档与 `test/flow-management.test.ts` 的用例注释。
 *
 * ## 参数顺序是从源码推出来的，不是抄基准
 *
 * 源码推导的规则有两条，都是本仓库已经实测钉死过的（基准用来复核，见上）：
 *
 * 1. **列表页**（待办 / 已办 / 抄送我的 / 我的流程）走 `common/libs/renren/list.js:473-483`：
 *
 *    ```js
 *    const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 *    const params = { order: orderType.value, orderField: orderField.value, ..._form }
 *    if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 *    ```
 *
 *    ⇒ 顺序恒为 `order → orderField → convertFetchForm 的返回值 → pageNo → pageSize → _t`。
 *    三页都没有 `order`/`orderField` 控件，钉死成空串、不开放。
 *
 * 2. **发起流程**不是列表页、不走 list 模块，参数就是 `index.vue:218-223` 那个对象字面量：
 *    `{ suspensionState: 1, processType }`（**就这两个**，没有 order / 分页）。
 *
 * 「空值发不发」逐页读出来，五页**四种**，是本文件最容易写错的地方：
 *
 * | 页面 | 空值处理 | 无筛选时 URL 的参数 |
 * | --- | --- | --- |
 * | 待办 / 已办 | **照发**（含空串 `order=` `name=`） | `order&orderField&name&title&startUserName&finished&selectType&pageNo&pageSize` |
 * | 抄送我的 | 三个选择器**整个丢掉**，两个输入框照发 | `order&orderField&processInstanceName&title&pageNo&pageSize` |
 * | 我的流程 | `processDefinitionId` / `status` / `createTime` 为空时省略，页面内部 `category` 空串照发 | `order&orderField&name&title&category&pageNo&pageSize` |
 * | 发起流程 | 没有可空的（两个参数都恒有值） | `suspensionState=1&processType=1` |
 *
 * 「抄送我的」的丢空有一个**容易漏的细节**：丢的是 `startUserId` / `creator` / `status`
 * **三个**（`list.vue:159-166` 的 `for` 循环），`processInstanceName` 与 `title` 是空串但**照发**。
 * 一刀切"把空值都丢掉"会让 URL 少两个键。
 *
 * ## 与已建成能力的关系（这一节是重点，避免调用方猜该用哪个）
 *
 * **不重复建的，逐条举证：**
 *
 * - **待办办理（通过 / 驳回 / 转办 / 委派 / 回退 / 批量）** —— 已经有 `src/capabilities/task-action.ts`，
 *   `task-action-approve` / `-reject` / `-transfer` / `-delegate` / `-return` / `-batch-approve` /
 *   `-batch-reject` / `-return-options` / `-workflow-path`。**本文件只做读**，一个写都不碰。
 *   待办列表里点「办理」跳到的是 `/dashboard/backlog/task-examine/...` 那一套，不是新的写接口。
 * - **重新发起流程（`?processInstanceId=` 深链）** —— 页面上这条路径要 `GET /bpm/process-instance/get`，
 *   已经有 `task-action-instance`（同接口、同参数 `{ id }`）。这里**不再建一个同形的**，
 *   调用方用 `taskAction.instance(id)`；要拿到该实例对应的流程定义，用本文件的 `listDefinitions()`
 *   按 `key` 匹配即可（这正是页面 `findProcessDefinitionByKey()` 干的事）。
 * - **人员候选** —— 抄送我的页面上那个 `portal-hxr-select-user` 会**全量翻页拉人**
 *   （基准第 6 条是 `/sys/user/getUserPageInfo?pageNo=1&pageSize=20`；
 *   `copy-creator-List` 那条则是无参全量）。**无头不照抄**（D6 / H35）：
 *   `startUserId` 要的是一个**用户 id**，请先用 `base-user-search`（强制要关键字）
 *   拿到 id 再填。`creator` 同理。
 *   ⚠️ 本地检出里这个组件写的是 `pageSize=200 / maxPages=100`，与基准那条的 `pageSize=20`
 *   对不上（本地检出声称落后于部署版本），**两条路都不该照抄**，所以这条差异不影响结论。
 *
 * **与 `backlog-task-examine-list` 的重叠（写清楚，别让调用方猜）：**
 *
 * 待办任务 / 已办任务这两页**渲染的是同一个组件** `app/portal/views/dashboard/hr/backlog/task-examine/list.vue`
 * （`todo/list.vue` 与 `done/list.vue` 都是 13 行，只传一个 `:finished` prop），
 * 打的是**同一个接口** `/bpm/hr/task/list-by-category-web`，
 * 参数契约与 `backlog-task-examine-list` **逐字段相同**——因此这三个能力在"能取到什么数据"上是重叠的。
 * 仍然分开建，判据与本仓库既有的一条完全一致（`backlog-task-examine.ts` 文件末尾那张表）：
 * **用户能不能在页面上到达那个状态。**
 *
 * | | `/dashboard/backlog/task-examine/list` | `/dashboard/flow/task/{todo,done}/list` |
 * | --- | --- | --- |
 * | 右上角「待办/已办」切换器 | **有**（`showTab && !componentMode`） | **没有**（两页都传了 `componentMode`） |
 * | `finished` | 开放（用户点得到） | **钉死**（1 / 2，用户切不了） |
 *
 * 所以：**要在一条调用里同时看待办和已办，用 `backlogTaskExamine.list({ finished })`；
 * 只要固定的那一边，用本文件的 `listTodo()` / `listDone()`。**
 * 两条能力打同一个后端接口，参数一致，结果可互相印证。
 *
 * ⚠️ 另有一个**同名不同接口**的坑：`base-todo-list`（基础能力）打的是
 * `GET /admin-api/bpm/task/list-by-category`（**没有 `-web` 后缀**），`finished` 是三态
 * （缺席 = 全部 562 条）。它**不是**本文件的接口，别混。
 *
 * ## 写操作边界
 *
 * 五页里的写入口按授权边界分开记录：
 *
 * | 页面 | 写入口 | 接口 |
 * | --- | --- | --- |
 * | 发起流程 | 点卡片 → 走流程表单 | `POST /bpm/process-instance/...`（各流程自己的控制器） |
 * | 待办任务 | 办理 / 批量办理 / 跟进 | `src/capabilities/task-action.ts` 那一组 |
 * | 已办任务 | 撤销审批 | `openTaskWithdrawModal`（`utils/flow/task-withdraw.js`），本文件接入 `flow-task-done-withdraw` |
 * | 抄送我的 | 无（只有「详情」） | —— |
 * | 我的流程 | 取消本人发起且运行中的流程 | `DELETE /bpm/process-instance/cancel-by-start-user`（本文件已接入） |
 *
 * `flow-task-my-cancel` 只允许非空取消原因，并明确要求写后回查；跟进、短信提醒、附件登记和
 * 会议预定取消也在本页上下文中单独建能力，确保页面按钮的权限边界、请求实例和幂等参数不被
 * 其它流程表单混用。
 */

export const FLOW_TASK_CREATE_PAGE_PATH = '/dashboard/flow/task/create/list'
export const FLOW_TASK_TODO_PAGE_PATH = '/dashboard/flow/task/todo/list'
export const FLOW_TASK_DONE_PAGE_PATH = '/dashboard/flow/task/done/list'
export const FLOW_TASK_COPY_PAGE_PATH = '/dashboard/flow/task/copy/list'
export const FLOW_TASK_MY_PAGE_PATH = '/dashboard/flow/task/my/list'
export const FLOW_TASK_MY_PERMISSION = '/dashboard/flow/task/my'

const VIEWS = 'app/portal/views/dashboard/hr/flow'

/** 路由文件（排障与写文档时核对用） */
export const FLOW_TASK_ROUTE_FILES = {
  create: `${VIEWS}/task/create/list/index.vue`,
  todo: `${VIEWS}/task/todo/list.vue`,
  done: `${VIEWS}/task/done/list.vue`,
  copy: `${VIEWS}/task/copy/list.vue`,
  /** 待办 / 已办真正渲染的那个组件（两页共用） */
  sharedComponent: 'app/portal/views/dashboard/hr/backlog/task-examine/list.vue',
} as const

/** 发起流程页：取「当前用户能发起的全部流程定义」（分类数组） */
export const FLOW_TASK_CREATE_LIST_PATH = '/bpm/process-definition/create-list'

/** 待办 / 已办 / 待办事项三页共用的列表接口（注意 `-web` 后缀） */
export const FLOW_TASK_LIST_PATH = '/bpm/hr/task/list-by-category-web'

/** 抄送我的列表接口 */
export const FLOW_TASK_COPY_LIST_PATH = '/bpm/process-instance/copy/page'

/** 我的流程列表接口 */
export const FLOW_TASK_MY_LIST_PATH = '/bpm/process-instance/my-page'

/** 我的流程页的流程跟进接口 */
export const FLOW_PROCESS_FOLLOW_UP_CAPABILITY_PATH = '/bpm/process-follow-up/capability'
export const FLOW_PROCESS_FOLLOW_UP_LIST_PATH = '/bpm/process-follow-up/list'
export const FLOW_PROCESS_FOLLOW_UP_CREATE_PATH = '/bpm/process-follow-up/create'
/** 跟进附件先登记为 OSS 资源，再把返回的 resourceId 放入提交载荷 */
export const FLOW_FOLLOW_UP_OSS_RESOURCE_CREATE_PATH = '/file/oss-resource/create'

/** 我的流程页的短信提醒接口 */
export const FLOW_PROCESS_SMS_REMIND_DETAIL_PATH = '/bpm/process-sms-remind/detail'
export const FLOW_PROCESS_SMS_REMIND_HISTORY_PATH = '/bpm/process-sms-remind/history'
export const FLOW_PROCESS_SMS_REMIND_SEND_PATH = '/bpm/process-sms-remind/send'
/** “我的流程”列表里的会议预定动作；businessKey 是会议审批单据 ID。 */
export const FLOW_MEETING_RESERVATION_CANCEL_PATH = '/hr/meeting-application/cancel-reservation'

/** 默认每页条数。四个列表页模块都是 `useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 待办 / 已办。页面用的是 `props.finished` 的默认值语义（`list.vue:149`） */
export const FLOW_TASK_FINISHED_TODO = 1
export const FLOW_TASK_FINISHED_DONE = 2

/**
 * `bpm_process_type` 字典的两个值。
 *
 * **【实测，来自 `docs/process-forms.md` §1.2】**：字典实测两个值 `1 = 审核`、`2 = 审批`；
 * `processType=1` 25 个流程 + `processType=2` 57 个 = 82 个。**只拉一个会漏掉另一个。**
 * 页面默认值写死 `ref(1)`，所以 SDK 的默认值也是 1。
 *
 * 字典本身走 `GET /adminmanage-api/system/dict-data/list-all-simple`（平台字典 store），
 * SDK 侧的入口是 `base-dict-get`（`dictType='bpm_process_type'`）——
 * **不是** `base-dict-search`（那一个要的是 dictType 的**名字关键字**，不是字典选项）。
 */
export const PROCESS_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '审核', value: 1 },
  { label: '审批', value: 2 },
]

/** 「抄送我的」的时间范围只有两个选项，取值未实测（页面是 `portal-finance-dict-select`） */
export const COPY_STATUS_DICT_TYPE = 'bpm_process_instance_status'

/** 流程定义卡片（`create-list` 返回的分类数组里的一项） */
export type ProcessDefinitionItem = {
  /** 形如 `key:version:uuid`，也可能是裸 uuid */
  id: string
  /** 流程定义 Key —— 进流程表单要用它 */
  key: string
  name: string
  /** 实测全是 20（业务表单）。`openFlowForm` 只接受 20，别的会被前端挡下 */
  formType?: number
  /** 实测全是 `'portal'`（智慧蛋鸡门户 PC） */
  baseUrl?: string
  /** 表单路径，形如 `simple/hr/form/033`。**只有 `create-list` 返回这个字段** */
  formCustomCreatePath?: string
  category?: string
  [key: string]: unknown
}

/**
 * `create-list` 返回的**是分类数组**，不是扁平列表。
 *
 * 页面的可用性判定是这四条同时成立（`index.vue:178-185`，不满足的卡片渲染成红色）：
 * `baseUrl === 'portal'`、`formType === 20`、`formCustomCreatePath` 非空、且以 `simple/` 开头。
 * 实测 82 个**全部满足**。SDK 侧用 `isUsableProcessDefinition()` 复刻这四条。
 */
export type ProcessDefinitionCategory = {
  /** 分类码，如 `human_process` */
  code: string
  /** 分类名（页面上的分组标题），如「人力」 */
  name: string
  processDefinitionList: ProcessDefinitionItem[]
  [key: string]: unknown
}

/** 待办 / 已办的行 —— 与「待办事项」页同一个接口同一个结构，直接复用那份定义，别写第二份 */
export type FlowTaskRow = BacklogTaskRow

/** 抄送我的行 */
export type FlowTaskCopyRow = {
  id: number | string
  /** 流程名称 */
  processInstanceName?: string | null
  /** 审批内容。页面经 `getApprovalContent()` 处理后展示 */
  title?: string | null
  /** 流程发起人姓名 */
  startUserName?: string | null
  /** 流程状态，取值见字典 `bpm_process_instance_status` */
  status?: number | string | null
  processInstanceStartTime?: string | null
  /** 抄送任务名 */
  taskName?: string | null
  /** 抄送人姓名 */
  creatorName?: string | null
  /** 抄送时间 */
  createTime?: string | null
  /** 「详情」跳转要用它（页面 `handleAudit(record.processInstanceId)`） */
  processInstanceId?: number | string | null
  [key: string]: unknown
}

/** 「我的流程」返回里的用户摘要；后端会按页面场景补充这些字段。 */
export type FlowTaskMyUser = {
  id?: number | string | null
  nickname?: string | null
  postId?: number | string | null
  postName?: string | null
  deptId?: number | string | null
  deptName?: string | null
  mobile?: string | null
  [key: string]: unknown
}

/** 「我的流程」返回里的当前任务摘要。 */
export type FlowTaskMyTask = {
  id?: string | number | null
  name?: string | null
  assigneeUser?: FlowTaskMyUser | null
  [key: string]: unknown
}

/** 「我的流程」行；详情和取消都使用这里的流程实例 id，不是业务单据 id。 */
export type FlowTaskMyRow = {
  id: string
  name?: string | null
  title?: string | null
  category?: string | null
  categoryName?: string | null
  status?: number | null
  result?: number | null
  startTime?: string | null
  endTime?: string | null
  durationInMillis?: number | null
  formVariables?: Record<string, unknown> | null
  businessKey?: string | null
  processType?: number | null
  supportApp?: number | null
  deleteReason?: string | null
  startUser?: FlowTaskMyUser | null
  processDefinitionId?: string | null
  processDefinition?: {
    id?: string | null
    version?: number | null
    name?: string | null
    key?: string | null
    category?: string | null
    categoryName?: string | null
    formType?: number | null
    formId?: number | string | null
    formName?: string | null
    formConf?: string | null
    formFields?: string[] | null
    baseUrl?: string | null
    formCustomCreatePath?: string | null
    formCustomViewPath?: string | null
    formCustomDetailApiPath?: string | null
    processType?: number | null
    suspensionState?: number | null
    deploymentTime?: string | null
    bpmnXml?: string | null
    startUserSelectTasks?: Array<{ id?: string | null; name?: string | null; [key: string]: unknown }> | null
    [key: string]: unknown
  } | null
  processDefinitionKey?: string | null
  processDefinitionName?: string | null
  tasks?: FlowTaskMyTask[] | null
  copyInfo?: {
    startManualCopyUsers?: FlowTaskMyUser[] | null
    startAutoCopyUsers?: FlowTaskMyUser[] | null
    taskCopyUsers?: Record<string, FlowTaskMyUser[]> | null
    [key: string]: unknown
  } | null
  aiReviewResults?: Array<{
    taskId?: string | null
    taskDefinitionKey?: string | null
    taskName?: string | null
    status?: string | null
    approved?: boolean | null
    content?: string | null
    variables?: Record<string, unknown> | null
    errorMessage?: string | null
    reviewTime?: string | null
    [key: string]: unknown
  }> | null
  canCancelReservation?: number | null
  canSmsRemind?: boolean | null
  remindedToday?: boolean | null
  smsReminderDisabledReason?: string | null
  [key: string]: unknown
}

export type FlowTaskQuery = {
  /** 流程名称，模糊匹配 */
  name?: string
  /** 审批内容，模糊匹配 */
  title?: string
  /**
   * 发起人姓名。**页面这里是纯文本输入框，不是人员选择器**（`startUserName`），直接给名字。
   * 与「抄送我的」那页的 `startUserId`（用户 id）**不是一回事**，别混。
   */
  startUserName?: string
  /**
   * 发起时间区间起点，格式必须是 `YYYY-MM-DD HH:mm:ss`。
   * 必须与 `createTimeEnd` 成对给。**写的就是字面值** —— 本页没有"结束日 +1 天"
   * （组件里没有 `convertFetchForm`），要含 9-10 一整天得自己给 `2026-09-10 23:59:59`。
   */
  createTimeStart?: string
  /** 发起时间区间终点，格式同上，必须与 `createTimeStart` 成对给 */
  createTimeEnd?: string
  /**
   * 1=近30天内 2=全部。**只有已办那一页（`finished=2`）页面上才有这个控件**
   * （`list.vue:11` 的 `v-if`）；待办那一页它恒为 1 且不可改，所以 `listTodo()` 把它钉死。
   */
  selectType?: number
  /**
   * 流程分类。页面上它来自深链 `?taskKey=`，默认是 `null`（**不发这个键**）。
   *
   * ⚠️ **这个参数目前是坏的，而且是后端坏的**：后端拿它去流程模型分类里分组，
   * 取不到就空指针——只要这个键在请求里、值不是某个真实存在的流程分类，**一律 500**
   * （业务 code，HTTP 仍是 200）。消息中心深链那四个 taskKey（`Task_month` /
   * `Protocol_year` / `Protocol_month` / `protocolMonthScore`）与空串**全部 500**。
   * 详见 `src/capabilities/backlog-task-examine.ts` 里同名参数的长注释。
   * 要按分类筛，请给**真实存在的流程分类码**（如 `human_process`）。
   */
  processCategory?: string
  pageNo?: number
  pageSize?: number
}

export type FlowTaskCopyQuery = {
  /** 流程名称，模糊匹配。空串**照发** */
  processInstanceName?: string
  /** 审批内容，模糊匹配。空串**照发** */
  title?: string
  /**
   * 流程发起人 —— 一个**用户 id**（页面组件的 `value` 是 `/sys/user/getUserPageInfo` 的 `item.id`）。
   * 空值**整个丢掉**、不发这个键。要拿 id 先用 `base-user-search`（强制要关键字）。
   */
  startUserId?: number | string
  /**
   * 抄送发起人 —— 也是**用户 id**（页面选项来自 `/bpm/process-instance/copy/copy-creator-List`
   * 的 `item.id`）。空值**整个丢掉**。
   *
   * ⚠️ 页面自己那个候选接口**不提供**：它是无参全量拉取（D6 / H35），本 SDK 不照抄。
   * 要用请自己给 id —— 用 `base-user-search` 按姓名查。
   */
  creator?: number | string
  /**
   * 流程状态。页面是 `portal-finance-dict-select type="bpm_process_instance_status"`，
   * 空值**整个丢掉**。【推断】具体取值未实测；要候选请用 `base-dict-get`
   * 传 `dictType='bpm_process_instance_status'`。
   */
  status?: number | string
  /** 抄送时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给 */
  createTimeStart?: string
  /**
   * 抄送时间区间终点，格式同上，必须与 `createTimeStart` 成对给。
   *
   * ⚠️ **本页的时间区间是"原样取两端"，没有 +1 天**（`list.vue:122` 只做
   * `.format('YYYY-MM-DD HH:mm:ss')`）。**而且页面上的选择器没有 `show-time`**，
   * 所以它实际发出的是**两个零点**——用户选「9-01 ~ 9-10」时 `createTime[1]` 是
   * `2026-09-10 00:00:00`，**9-10 那一整天其实查不到**。要含结束日请自己给 `23:59:59`。
   * 照抄别的页面的 +1 天会**静默多查一天**，照抄"取当天 00:00:00"会**静默少一天**。
   */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

export type FlowTaskMyQuery = {
  /** 流程名称，模糊匹配 */
  name?: string
  /** 审批内容，模糊匹配 */
  title?: string
  /** 所属流程；页面是文本输入框，按后端 processDefinitionId 原样传递 */
  processDefinitionId?: string | number
  /** 流程状态；取自 bpm_process_instance_status 字典 */
  status?: number | string
  /** 发起时间区间起点，格式必须是 YYYY-MM-DD HH:mm:ss */
  createTimeStart?: string
  /** 发起时间区间终点，格式必须是 YYYY-MM-DD HH:mm:ss */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

export type FlowTaskCancelParams = {
  /** 流程实例 id，来自 listMy() 的 list[].id，不是业务单据 businessKey */
  id: string | number
  /** 取消原因；服务端要求非空 */
  reason: string
}

export type FlowProcessFollowUpCapability = {
  canView?: boolean | null
  canFollowUp?: boolean | null
  disabledReason?: string | null
}

export type FlowProcessFollowUpAttachment = {
  resourceId: number
  name?: string | null
  url?: string | null
  size?: number | null
}

export type FlowProcessFollowUpRow = {
  id: number
  processInstanceId?: string | null
  creatorId?: number | null
  creatorName?: string | null
  creatorRole?: number | null
  creatorRoleName?: string | null
  createTime?: string | null
  content?: string | null
  attachments?: FlowProcessFollowUpAttachment[] | null
}

export type FlowProcessFollowUpCreateParams = {
  /** 流程实例 ID，来自 flow-task-my-list[].id */
  processInstanceId: string | number
  /** 跟进内容；Portal 提交前会 trim，服务端最多 500 个字符 */
  content: string
  /** 已登记的 OSS 资源 ID，最多 3 个 */
  resourceIds?: number[]
  /** 前端生成并在同一提交意图重用的幂等键，最多 64 个字符 */
  clientRequestId: string
}

export type FlowProcessFollowUpAttachmentRegisterParams = {
  name: string
  url: string
  size: number
}

export type FlowProcessSmsRemindRecipient = {
  taskId?: string | null
  userId?: number | null
  name?: string | null
  mobileMasked?: string | null
  smsLogId?: number | null
  status?: number | null
  failureReason?: string | null
}

export type FlowProcessSmsRemindDetail = {
  processInstanceId?: string | null
  processInstanceName?: string | null
  templateName?: string | null
  renderedContent?: string | null
  ruleText?: string | null
  canSend?: boolean | null
  remindedToday?: boolean | null
  disabledReason?: string | null
  recipients?: FlowProcessSmsRemindRecipient[] | null
}

export type FlowProcessSmsRemindRecord = {
  id: number
  processInstanceId?: string | null
  processInstanceName?: string | null
  remindDate?: string | null
  senderUserId?: number | null
  templateCode?: string | null
  templateContentSnapshot?: string | null
  status?: number | null
  recipientCount?: number | null
  acceptedCount?: number | null
  failedCount?: number | null
  sendSuccessCount?: number | null
  sendFailureCount?: number | null
  createTime?: string | null
  recipients?: FlowProcessSmsRemindRecipient[] | null
}

export type FlowProcessSmsRemindSendParams = {
  /** 流程实例 ID，来自 flow-task-my-list[].id */
  processInstanceId: string | number
  /** 发送意图幂等键；同一意图超时重试必须复用 */
  clientRequestId: string
}

/**
 * 待办 / 已办的参数顺序 —— 逐字对 `list.vue` 的 `form` 与 `list.js:473-482`。
 *
 * `finished` 不在调用方参数里（它在下面被 `pinned` 钉死），但**它在表里的位置**就是它在
 * URL 上的位置（第 7 位），所以这张表必须把它列出来。
 */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'createTime', defaultValue: [] },
  { name: 'startUserName', defaultValue: '' },
  { name: 'finished', defaultValue: FLOW_TASK_FINISHED_TODO },
  { name: 'selectType', defaultValue: 1 },
  { name: 'processCategory', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 抄送我的参数顺序 —— 逐字对 `copy/list.vue` 的 `form`。
 *
 * `convertFetchForm`（`copy/list.vue:159-166`）会把 `startUserId` / `creator` / `status`
 * 里的空值**整个删掉**，所以它们在表里的位置是"有值时"的位置，空值时不出现。
 * `createTime` 也在这里被换成格式化后的数组 —— 换的是值，**键的位置不变**。
 */
const COPY_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'processInstanceName', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'startUserId', defaultValue: null },
  { name: 'creator', defaultValue: null },
  { name: 'status', defaultValue: null },
  { name: 'createTime', defaultValue: [] },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 「我的流程」参数顺序 —— 逐字对 `flow/task/my/list.vue` 的 form 与分页模块。
 *
 * `processDefinitionId` / `status` 的初值是 null，`createTime` 的初值是空数组；
 * 客户端的 `skipNulls` 与空数组序列化会把这些空筛选整个省略。`category` 虽然存在
 * 于 formState，但页面没有控件，始终按页面初值空串发送，不对调用方开放。
 */
const MY_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'processDefinitionId', defaultValue: null },
  { name: 'category', defaultValue: '' },
  { name: 'status', defaultValue: null },
  { name: 'createTime', defaultValue: [] },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const MY_PAGE_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
  { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
  {
    name: 'processDefinitionId',
    kind: 'text',
    required: false,
    description: '所属流程筛选值；页面是文本输入框，按后端 processDefinitionId 原样传递，不把流程名称猜成 ID',
  },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description:
      `流程状态，取自字典 ${COPY_STATUS_DICT_TYPE}；页面按审核/审批分别显示状态标签，` +
      '不要把状态数字当作业务单据状态',
    lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
  },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '发起时间区间起点，`YYYY-MM-DD HH:mm:ss`；必须与 createTimeEnd 成对给，页面不做结束日 +1 天',
  },
  {
    name: 'createTimeEnd',
    kind: 'date',
    required: false,
    description: '发起时间区间终点，格式同上；按字面时刻发送，需包含整日时自行给 23:59:59',
  },
  ...PAGE_PARAMS,
]

/** 抄送我的那页会整个丢掉空值的三个字段（`copy/list.vue:160` 的数组，逐字） */
const COPY_DROP_WHEN_EMPTY = ['startUserId', 'creator', 'status'] as const

function isEmptyValue (value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function requireProcessInstanceId (value: unknown): string {
  const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (normalized === '') {
    throw new Error('processInstanceId 不能为空：请使用 flow-task-my-list 返回的流程实例 id')
  }
  return normalized
}

function requireMeetingReservationBusinessKey (value: unknown): string {
  const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(normalized) || normalized === '0') {
    throw new Error('businessKey 必须是正整数会议审批单据 ID：请使用 flow-task-my-list 返回的 businessKey')
  }
  return normalized
}

function requireClientRequestId (value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('clientRequestId 必填：请为同一写入意图生成并复用客户端幂等键')
  }
  if (value.length > 64) {
    throw new Error('clientRequestId 不能超过 64 个字符')
  }
  return value
}

function normalizeFollowUpResourceIds (value: unknown): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error('resourceIds 必须是数组')
  }
  if (value.length > 3) {
    throw new Error('跟进附件最多 3 个')
  }
  const resourceIds = value.map((item, index) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) {
      throw new Error(`resourceIds[${index}] 必须是正整数资源 ID`)
    }
    return item
  })
  if (new Set(resourceIds).size !== resourceIds.length) {
    throw new Error('resourceIds 不能重复')
  }
  return resourceIds
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
  options: {
    /** 页面钉死的字段（如 `finished`），覆盖同名的调用方实参 */
    pinned?: Record<string, unknown>
    /**
     * 这些字段为空时**整个不发**。
     *
     * 注意 `null` 即使不在这里也会被 qs 的 `skipNulls` 丢掉（`client.ts` 的
     * `qs.stringify(params, { allowDots: true, skipNulls: true })`，与 `platform.js` 逐字一致），
     * 所以这个选项**只对空串与空数组有意义** —— 正是 `copy/list.vue` 的 `convertFetchForm`
     * 会删掉的那三个选择器（它们默认是 `null`，但用户清空后 picker 给的是 `undefined`/`''`）。
     */
    dropWhenEmpty?: ReadonlyArray<string>
  } = {},
): Record<string, unknown> {
  const { pinned = {}, dropWhenEmpty = [] } = options
  const params: Record<string, unknown> = {}
  for (const item of order) {
    if (Object.prototype.hasOwnProperty.call(pinned, item.name)) {
      params[item.name] = pinned[item.name]
      continue
    }
    const value = query[item.name]
    const resolved = value === undefined ? item.defaultValue : value
    if (dropWhenEmpty.includes(item.name) && isEmptyValue(resolved)) {
      continue
    }
    params[item.name] = resolved
  }
  return params
}

/**
 * 待办 / 已办的时间区间 → 接口收的两个标量。
 *
 * **本页没有"结束日 +1 天"**（组件里没有 `convertFetchForm`，两个日期原样进 qs），
 * 所以这里也**不做**任何改写，只做格式校验。要含结束日一整天，
 * 调用方自己给 `YYYY-MM-DD 23:59:59` —— 具体到本页，页面的选择器带 `show-time`，
 * 用户本来就能选到时分秒。
 *
 * ⚠️ 写成 `2026-09-10` 会被拒（格式必须是 `YYYY-MM-DD HH:mm:ss`），
 * 因为后端那层收的是字符串、格式错了**不报错、只会查不到或查错范围**。
 */
export function buildFlowTaskTimeRange (
  startDateTime: string,
  endDateTime: string,
): { createTimeStart: string; createTimeEnd: string } {
  assertDateTime(startDateTime, 'createTimeStart')
  assertDateTime(endDateTime, 'createTimeEnd')
  return { createTimeStart: startDateTime, createTimeEnd: endDateTime }
}

/**
 * 抄送我的 —— 把两个 `YYYY-MM-DD HH:mm:ss` 原样交出去（**不改写、不 +1 天**），
 * 只做格式校验。理由与坑见 `FlowTaskCopyQuery.createTimeEnd` 的注释：
 * 页面上的 picker 没有 `show-time`，所以页面自己发出去的是两个零点。
 * 本 helper **要求显式给时分秒**，就是为了不让调用方在这上面踩空。
 */
export function buildFlowTaskCopyTimeRange (
  startDateTime: string,
  endDateTime: string,
): { createTimeStart: string; createTimeEnd: string } {
  assertDateTime(startDateTime, 'createTimeStart')
  assertDateTime(endDateTime, 'createTimeEnd')
  return { createTimeStart: startDateTime, createTimeEnd: endDateTime }
}

/**
 * 复刻 `create/list/index.vue:178-185` 的 `hasError()`（取反就是"可用"）。
 *
 * 不满足的卡片在页面上渲染成**红色**并带 tooltip；点进去也是坏的。实测 82 个全满足。
 * 放在 SDK 侧是因为调用方拿到 `create-list` 之后必然要做这一步判断——
 * 页面用红色提示人，无头只能靠这个函数。
 */
export function isUsableProcessDefinition (definition: {
  baseUrl?: string
  formType?: number
  formCustomCreatePath?: string
}): boolean {
  return (
    definition.baseUrl === 'portal' &&
    definition.formType === 20 &&
    Boolean(definition.formCustomCreatePath) &&
    String(definition.formCustomCreatePath).startsWith('simple/')
  )
}

/** 页面给红色卡片拼的提示语（`index.vue:187-195`），逐字复刻，便于排障时对照 */
export function describeProcessDefinitionError (definition: {
  baseUrl?: string
  formType?: number
  formCustomCreatePath?: string
}): string | undefined {
  if (isUsableProcessDefinition(definition)) return undefined
  const errors: string[] = []
  if (definition.baseUrl !== 'portal') {
    errors.push('项目错误')
  }
  if (definition.formType !== 20) {
    errors.push('类型错误')
  }
  if (!definition.formCustomCreatePath) {
    errors.push('空地址')
  } else if (!String(definition.formCustomCreatePath).startsWith('simple/')) {
    errors.push('地址错误')
  }
  return errors.join('、')
}

/**
 * 待办 / 已办共用的筛选字段（两页只有 `finished` 与 `selectType` 不同，而它们都按
 * 「用户在这一页上能不能到达那个状态」决定开放还是钉死 —— 见下面两个 ParamSpec 表）。
 */
const TODO_DONE_BASE_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
  { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '发起时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给。' +
      '**本页没有 +1 天**，结束时刻就是字面值——要含 9-10 一整天得自己给 2026-09-10 23:59:59',
  },
  {
    name: 'createTimeEnd',
    kind: 'date',
    required: false,
    description: '发起时间区间终点，格式同上，必须与 `createTimeStart` 成对给',
  },
  {
    name: 'startUserName',
    kind: 'text',
    required: false,
    description:
      '发起人**姓名**，模糊匹配。页面这里是纯文本输入框（不是人员选择器），直接给名字即可',
  },
  {
    name: 'processCategory',
    kind: 'text',
    required: false,
    description:
      '流程分类码（如 human_process）。默认**不发**。⚠️ 这个参数目前是坏的、而且是后端坏的：' +
      '值不是某个真实存在的流程分类时**一律 500**（业务 code，HTTP 仍是 200），空串也 500',
  },
]

const SELECT_TYPE_PARAM: ParamSpec = {
  name: 'selectType',
  kind: 'enum',
  required: false,
  description: '1=近30天内（默认）2=全部。**只有已办那一页有这个控件**（`list.vue:11` 的 `v-if`）',
  options: [
    { label: '近30天内', value: 1 },
    { label: '全部', value: 2 },
  ],
}

/**
 * **待办任务**页的参数：**没有 `selectType`**。
 *
 * 那个「时间范围」下拉在页面上是 `v-if="rrList.formState.finished === 2"` —— 待办这一页
 * 根本渲染不出来，用户到不了 `selectType=2`。按与 `finished` **同一条**判据
 * （用户能不能在页面上到达那个状态），它**钉死成 1、不开放**：
 * 请求里恒有 `selectType=1`（那是 `form` 的初值，基准第 2 条也是这么发的），但调用方改不了。
 */
const TODO_PARAMS: ParamSpec[] = [...TODO_DONE_BASE_PARAMS, ...PAGE_PARAMS]

/** **已办任务**页的参数：`selectType` 在这一页上是真实可见、可点的控件，所以开放 */
const DONE_PARAMS: ParamSpec[] = [
  ...TODO_DONE_BASE_PARAMS.slice(0, 4),
  SELECT_TYPE_PARAM,
  ...TODO_DONE_BASE_PARAMS.slice(4),
  ...PAGE_PARAMS,
]

export const flowTaskCapabilities: CapabilityDefinition[] = [
  {
    id: 'flow-task-create-definitions',
    title: '查可发起的流程定义（发起流程页的卡片墙）',
    pagePath: FLOW_TASK_CREATE_PAGE_PATH,
    permission: '/dashboard/flow/task/create',
    write: false,
    params: [
      {
        name: 'processType',
        kind: 'enum',
        required: false,
        description:
          '流程类型，默认 1。**两个值都要试**：实测 1=审核 25 个、2=审批 57 个，' +
          '只拉一个会漏掉另一个。取值来自平台字典 bpm_process_type',
        options: PROCESS_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
    ],
  },
  {
    id: 'flow-task-todo-list',
    title: '查询待办任务（我的待办）',
    pagePath: FLOW_TASK_TODO_PAGE_PATH,
    permission: '/dashboard/flow/task/todo',
    write: false,
    params: TODO_PARAMS,
  },
  {
    id: 'flow-task-done-list',
    title: '查询已办任务（我的已办）',
    pagePath: FLOW_TASK_DONE_PAGE_PATH,
    permission: '/dashboard/flow/task/done',
    write: false,
    params: DONE_PARAMS,
  },
  {
    id: 'flow-task-done-withdraw',
    title: '撤销已通过审批',
    pagePath: FLOW_TASK_DONE_PAGE_PATH,
    permission: '/dashboard/flow/task/done',
    write: true,
    params: TASK_WITHDRAW_PARAMS,
  },
  {
    id: 'flow-task-copy-list',
    title: '查询抄送我的列表',
    pagePath: FLOW_TASK_COPY_PAGE_PATH,
    permission: '/dashboard/flow/task/copy',
    write: false,
    params: [
      { name: 'processInstanceName', kind: 'text', required: false, description: '流程名称，模糊匹配' },
      { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
      {
        name: 'startUserId',
        kind: 'search',
        required: false,
        description:
          '流程发起人的**用户 id**（不是姓名）。空值不发这个键。' +
          '页面那个选择器是全量拉取，SDK 不照抄——要 id 请先用 base-user-search 按姓名查',
        lookup: { capabilityId: 'base-user-search', keywordParam: 'keyword' },
      },
      {
        name: 'creator',
        kind: 'search',
        required: false,
        description:
          '抄送发起人的**用户 id**。空值不发这个键。同上，用 base-user-search 拿 id；' +
          '页面自己那个候选接口是无参全量拉取，SDK 不提供',
        lookup: { capabilityId: 'base-user-search', keywordParam: 'keyword' },
      },
      {
        name: 'status',
        kind: 'enum',
        required: false,
        description:
          `流程状态，取自字典 ${COPY_STATUS_DICT_TYPE}。【推断】具体取值未实测。` +
          `要候选请调 base-dict-get（dictType=${COPY_STATUS_DICT_TYPE}）—— ` +
          '注意是它，不是 base-dict-search：后者要的是 dictType 的**名字关键字**，' +
          '前者才是"按 dictType 取这个字典的全部选项"',
        lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
      },
      {
        name: 'createTimeStart',
        kind: 'date',
        required: false,
        description:
          '抄送时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给。' +
          '用 buildFlowTaskCopyTimeRange() 生成',
      },
      {
        name: 'createTimeEnd',
        kind: 'date',
        required: false,
        description:
          '抄送时间区间终点，格式同上。⚠️ **没有 +1 天，就是字面值**；' +
          '要含结束日一整天请给 23:59:59（页面自己的 picker 没有 show-time，' +
          '它发出去的是 00:00:00，等于把结束日排除在外）',
      },
      ...PAGE_PARAMS,
    ],
  },
  {
    id: 'flow-task-my-list',
    title: '查询我的流程',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: false,
    params: MY_PAGE_PARAMS,
  },
  {
    id: 'flow-task-my-cancel',
    title: '取消我发起的流程',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'text',
        required: true,
        description: '流程实例 id，来自 flow-task-my-list 返回的 list[].id；不是业务单据 businessKey',
      },
      {
        name: 'reason',
        kind: 'text',
        required: true,
        description: '取消原因；必须是去除首尾空白后非空文本，服务端 BpmProcessInstanceCancelReqVO 也要求非空',
      },
    ],
  },
  {
    id: 'flow-task-my-cancel-reservation',
    title: '取消我的会议预定',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: true,
    params: [
      {
        name: 'businessKey',
        kind: 'text',
        required: true,
        description:
          '会议审批单据 ID，来自 flow-task-my-list 返回的 list[].businessKey；仅当该行 canCancelReservation === 1 时提交，不能传流程实例 id',
      },
    ],
  },
  {
    id: 'flow-task-my-follow-up-capability',
    title: '查询流程跟进权限',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: false,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: true,
        description: '流程实例 ID，来自 flow-task-my-list 返回的 list[].id，不是 businessKey',
      },
    ],
  },
  {
    id: 'flow-task-my-follow-up-list',
    title: '查询流程跟进记录',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: false,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: true,
        description: '流程实例 ID，必须是当前用户有权查看的流程实例',
      },
    ],
  },
  {
    id: 'flow-task-my-follow-up-attachment-register',
    title: '登记流程跟进附件',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: true,
    params: [
      { name: 'name', kind: 'text', required: true, description: '已上传文件的文件名' },
      { name: 'url', kind: 'text', required: true, description: '已上传文件的可访问 URL；本能力不上传二进制' },
      { name: 'size', kind: 'number', required: true, description: '文件大小，单位字节；单个跟进附件不能超过 100 MiB' },
    ],
  },
  {
    id: 'flow-task-my-follow-up-create',
    title: '创建流程跟进',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: true,
    params: [
      { name: 'processInstanceId', kind: 'text', required: true, description: '流程实例 ID，不是业务单据 businessKey' },
      { name: 'content', kind: 'text', required: true, description: '跟进内容；去首尾空白后不能为空，最多 500 个字符' },
      { name: 'resourceIds', kind: 'array', required: false, description: '已登记的 OSS 资源 ID，最多 3 个；不传按空数组提交' },
      { name: 'clientRequestId', kind: 'text', required: true, description: '客户端幂等键；同一提交意图失败/超时重试时必须复用，最多 64 个字符' },
    ],
  },
  {
    id: 'flow-task-my-sms-remind-detail',
    title: '查询流程短信提醒详情',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: false,
    params: [
      { name: 'processInstanceId', kind: 'text', required: true, description: '流程实例 ID，必须是当前用户发起的流程' },
    ],
  },
  {
    id: 'flow-task-my-sms-remind-history',
    title: '查询流程短信提醒历史',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: false,
    params: [
      { name: 'processInstanceId', kind: 'text', required: true, description: '流程实例 ID，必须是当前用户发起的流程' },
    ],
  },
  {
    id: 'flow-task-my-sms-remind-send',
    title: '发送流程短信提醒',
    pagePath: FLOW_TASK_MY_PAGE_PATH,
    permission: FLOW_TASK_MY_PERMISSION,
    write: true,
    params: [
      { name: 'processInstanceId', kind: 'text', required: true, description: '流程实例 ID，先用短信提醒详情确认 canSend=true' },
      { name: 'clientRequestId', kind: 'text', required: true, description: '客户端幂等键；同一发送意图重试时必须复用，最多 64 个字符' },
    ],
  },
]

/**
 * 能力实现。`request` 由 SDK 门面注入，**每页一个**——这样 module-type 与 http 实例
 * 都按各自的页面解析（约定第 1 条 / 第 29 条）。
 *
 * 五页的 `module-type` 都**算不出**（`generated/page-catalog.json` 里这五条的
 * `moduleType` 都是 `null`），所以按约定第 2 条**不发这个头**——与浏览器/源码一致；
 * http 实例五页都是页面显式 `import` 的 `platform.js`。
 */
export function createFlowTaskCapability (
  /** 发起流程页的请求上下文 */
  requestCreate: PortalRequest,
  /** 待办任务页的请求上下文 */
  requestTodo: PortalRequest,
  /** 已办任务页的请求上下文 */
  requestDone: PortalRequest,
  /** 抄送我的页的请求上下文 */
  requestCopy: PortalRequest,
  /** 我的流程页的请求上下文 */
  requestMy: PortalRequest,
) {
  /**
   * 待办 / 已办共用一个实现：同一个组件、同一个接口，只有**被钉死的字段**不同。
   *
   * `pinned` 里放的是"用户在这一页上到不了"的字段 —— 见上面 `TODO_PARAMS` / `DONE_PARAMS`
   * 两张表与文件头那条判据。
   */
  const listOf =
    (request: PortalRequest, pinned: Record<string, unknown>) =>
    (query: FlowTaskQuery = {}): Promise<PageResult<FlowTaskRow>> => {
      const hasStart = query.createTimeStart !== undefined && query.createTimeStart !== null
      const hasEnd = query.createTimeEnd !== undefined && query.createTimeEnd !== null
      if (hasStart !== hasEnd) {
        return Promise.reject(
          new Error(
            'createTimeStart 与 createTimeEnd 必须成对给：页面上是一个 a-range-picker，' +
              '它只会把两个值一起写进 formState，给单边等于造了一个页面上不存在的状态。',
          ),
        )
      }
      if (hasStart && hasEnd) {
        try {
          assertDateTime(query.createTimeStart as string, 'createTimeStart')
          assertDateTime(query.createTimeEnd as string, 'createTimeEnd')
        } catch (error) {
          return Promise.reject(error)
        }
      }
      const createTime = hasStart ? [query.createTimeStart, query.createTimeEnd] : []
      return request<PageResult<FlowTaskRow>>({
        url: FLOW_TASK_LIST_PATH,
        method: 'get',
        // `pinned` 里的字段覆盖调用方实参（写 `finished: 9` 也不会进 URL）
        params: buildParams(LIST_QUERY, { ...(query as Record<string, unknown>), createTime }, { pinned }),
      })
    }

  return {
    /**
     * 查「当前用户能发起的全部流程定义」。只读。
     *
     * ⚠️ **两个 `processType` 都要拉**（实测 25 + 57 = 82 个），只拉一个会漏掉一大半。
     * 返回的是**分类数组**，不是扁平列表；每张卡片能否使用用
     * `isUsableProcessDefinition()` 判（实测 82 个全可用）。
     *
     * 这个接口**只有这一处**能拿到 `formCustomCreatePath`（表单路径）——
     * `GET /bpm/process-definition/get` 里那个字段是 `null`（实测，见 `docs/process-forms.md` §3.4）。
     */
    listDefinitions (query: { processType?: number } = {}): Promise<ProcessDefinitionCategory[]> {
      return requestCreate<ProcessDefinitionCategory[]>({
        url: FLOW_TASK_CREATE_LIST_PATH,
        method: 'get',
        params: {
          // 页面把 suspensionState 硬编码成 1（只要启用中的流程），所以钉死、不开放
          suspensionState: 1,
          processType: query.processType ?? 1,
        },
      })
    },

    /**
     * 分页查询**待办任务**。只读。
     *
     * 钉死两项，调用方都改不了：
     * - `finished` = 1 —— 这一页传了 `componentMode: true`，右上角的「待办/已办」切换器
     *   **不渲染**，用户在页面上切不了（判据见文件头那张表）。
     * - `selectType` = 1 —— 「时间范围」下拉的 `v-if` 是 `finished === 2`，这一页也没有它。
     */
    listTodo: listOf(requestTodo, {
      finished: FLOW_TASK_FINISHED_TODO,
      selectType: 1,
    }) as (query?: FlowTaskQuery) => Promise<PageResult<FlowTaskRow>>,

    /**
     * 分页查询**已办任务**。只读。
     *
     * `finished` **钉死为 2**；与待办那一页相反，`selectType` 在这一页上是**可见控件**，
     * 所以它是开放的（1=近30天内 / 2=全部）。
     *
     * `finished=2` 与基准**逐字节一致**（那条基准是「新会话直开」重抓的；
     * 初版基准曾因采集会话的状态泄漏记成 `finished=1`，定案经过见文件头「基准对照」）。
     */
    listDone: listOf(requestDone, {
      finished: FLOW_TASK_FINISHED_DONE,
    }) as (query?: FlowTaskQuery) => Promise<PageResult<FlowTaskRow>>,

    /**
     * 撤销已办列表中后端标记为可撤销的审批。
     *
     * 该方法必须使用已办任务页面上下文：Portal 的共享组件通过 `platform.js` 发送
     * `PUT /bpm/task/withdraw`，按钮条件是 `finished === 2 && canWithdraw === true`。
     * 后端仍会按当前用户和实时流程状态复核；成功后旧历史任务 ID 不复用，调用方需回查。
     */
    async withdrawDone (params: TaskWithdrawParams): Promise<boolean> {
      return requestDone<boolean>({
        url: BPM_TASK_WITHDRAW_PATH,
        method: 'put',
        data: buildTaskWithdrawPayload(params),
      })
    },

    /**
     * 分页查询**抄送我的**。只读。
     *
     * 与待办 / 已办**不是一个接口**（`/bpm/process-instance/copy/page`），
     * 参数里三个可空项（`startUserId` / `creator` / `status`）为空时**整个不发**，
     * 而两个输入框（`processInstanceName` / `title`）为空时**照发空串** —— 见文件头那张表。
     */
    listCopy (query: FlowTaskCopyQuery = {}): Promise<PageResult<FlowTaskCopyRow>> {
      const hasStart = query.createTimeStart !== undefined && query.createTimeStart !== null
      const hasEnd = query.createTimeEnd !== undefined && query.createTimeEnd !== null
      if (hasStart !== hasEnd) {
        return Promise.reject(
          new Error(
            'createTimeStart 与 createTimeEnd 必须成对给：页面上是一个 a-range-picker，' +
              '它只会把两个值一起写进 formState，给单边等于造了一个页面上不存在的状态。',
          ),
        )
      }
      if (hasStart && hasEnd) {
        try {
          assertDateTime(query.createTimeStart as string, 'createTimeStart')
          assertDateTime(query.createTimeEnd as string, 'createTimeEnd')
        } catch (error) {
          return Promise.reject(error)
        }
      }
      const createTime = hasStart ? [query.createTimeStart, query.createTimeEnd] : []
      return requestCopy<PageResult<FlowTaskCopyRow>>({
        url: FLOW_TASK_COPY_LIST_PATH,
        method: 'get',
        params: buildParams(COPY_QUERY, { ...(query as Record<string, unknown>), createTime }, {
          dropWhenEmpty: COPY_DROP_WHEN_EMPTY,
        }),
      })
    },

    /**
     * 分页查询当前用户发起的流程实例。只读。
     *
     * 空筛选时与 Portal 页面一致：`order`、`orderField`、`name`、`title`、`category`、
     * `pageNo`、`pageSize` 保留，空的 `processDefinitionId` / `status` / `createTime`
     * 由客户端序列化规则省略。`category` 是页面内部状态，没有可见控件，固定为空串。
     */
    listMy (query: FlowTaskMyQuery = {}): Promise<PageResult<FlowTaskMyRow>> {
      const hasStart = query.createTimeStart !== undefined && query.createTimeStart !== null
      const hasEnd = query.createTimeEnd !== undefined && query.createTimeEnd !== null
      if (hasStart !== hasEnd) {
        return Promise.reject(
          new Error(
            'createTimeStart 与 createTimeEnd 必须成对给：页面上是一个 a-range-picker，' +
              '只会把两个值一起写进 formState，给单边等于造了一个页面上不存在的状态。',
          ),
        )
      }
      if (hasStart && hasEnd) {
        try {
          assertDateTime(query.createTimeStart as string, 'createTimeStart')
          assertDateTime(query.createTimeEnd as string, 'createTimeEnd')
        } catch (error) {
          return Promise.reject(error)
        }
      }
      const createTime = hasStart ? [query.createTimeStart, query.createTimeEnd] : []
      return requestMy<PageResult<FlowTaskMyRow>>({
        url: FLOW_TASK_MY_LIST_PATH,
        method: 'get',
        params: buildParams(
          MY_QUERY,
          { ...(query as Record<string, unknown>), createTime },
          { pinned: { order: '', orderField: '', category: '' } },
        ),
      })
    },

    /**
     * 取消当前用户发起且仍在运行中的流程。
     *
     * 页面只在 `record.status === 1` 时显示入口；服务端还会校验发起人身份和流程状态，
     * SDK 不用过期列表快照代替服务端校验。取消会改变流程并影响后续审批人，必须由调用方
     * 在用户确认后执行；本方法不自动重试。
     */
    async cancel (params: FlowTaskCancelParams): Promise<boolean> {
      const rawId = params?.id
      const id = typeof rawId === 'string' ? rawId.trim() : rawId === null || rawId === undefined ? '' : String(rawId).trim()
      if (id === '') {
        return Promise.reject(new Error('id 不能为空：请使用 flow-task-my-list 返回的流程实例 id'))
      }
      const reason = typeof params?.reason === 'string' ? params.reason.trim() : ''
      if (reason === '') {
        return Promise.reject(
          new Error('取消原因 reason 必填（后端 BpmProcessInstanceCancelReqVO.reason 是 @NotEmpty）'),
        )
      }
      return requestMy<boolean>({
        url: '/bpm/process-instance/cancel-by-start-user',
        method: 'delete',
        data: { id, reason },
      })
    },

    /**
     * 取消“我的流程”列表中仍可取消的会议预定。
     *
     * Portal 只在 `record.canCancelReservation === 1` 时显示按钮，并把业务单据
     * `businessKey` 传给会议预定接口；它不是流程实例 id。后端没有幂等键，超时后
     * 应先重新查询列表确认 canCancelReservation，再决定是否重试。该接口只校验会议
     * 单据存在和 isUsing，调用方不能把页面 gate 当成通用单据授权。
     */
    async cancelReservation (businessKey: string | number): Promise<boolean> {
      const id = requireMeetingReservationBusinessKey(businessKey)
      return requestMy<boolean>({
        url: `${FLOW_MEETING_RESERVATION_CANCEL_PATH}/${id}`,
        method: 'put',
      })
    },

    /** 查询流程跟进的查看/新增权限。只读；不以列表状态猜权限。 */
    async getFollowUpCapability (processInstanceId: string | number): Promise<FlowProcessFollowUpCapability> {
      return requestMy<FlowProcessFollowUpCapability>({
        url: FLOW_PROCESS_FOLLOW_UP_CAPABILITY_PATH,
        method: 'get',
        params: { processInstanceId: requireProcessInstanceId(processInstanceId) },
      })
    },

    /** 查询流程跟进记录。服务端按当前用户的流程参与权限校验。 */
    async listFollowUps (processInstanceId: string | number): Promise<FlowProcessFollowUpRow[]> {
      return requestMy<FlowProcessFollowUpRow[]>({
        url: FLOW_PROCESS_FOLLOW_UP_LIST_PATH,
        method: 'get',
        params: { processInstanceId: requireProcessInstanceId(processInstanceId) },
      })
    },

    /**
     * 登记一个已经上传到 OSS 的文件资源。它不上传文件字节；返回的资源 ID 才能放入
     * createFollowUp 的 resourceIds。Portal 跟进组件也是先走这一步再提交跟进。
     */
    async registerFollowUpAttachment (
      params: FlowProcessFollowUpAttachmentRegisterParams,
    ): Promise<number> {
      const name = typeof params?.name === 'string' ? params.name.trim() : ''
      const url = typeof params?.url === 'string' ? params.url.trim() : ''
      const size = params?.size
      if (name === '') throw new Error('附件 name 不能为空')
      if (url === '') throw new Error('附件 url 不能为空')
      if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
        throw new Error('附件 size 必须是非负整数，单位为字节')
      }
      if (size > 100 * 1024 * 1024) {
        throw new Error('单个跟进附件不能超过 100 MiB')
      }
      return requestMy<number>({
        url: FLOW_FOLLOW_UP_OSS_RESOURCE_CREATE_PATH,
        method: 'post',
        data: { name, url, size },
      })
    },

    /** 创建流程跟进；content/resourceIds/clientRequestId 的顺序与 Portal 表单一致。 */
    async createFollowUp (params: FlowProcessFollowUpCreateParams): Promise<number> {
      const processInstanceId = requireProcessInstanceId(params?.processInstanceId)
      const content = typeof params?.content === 'string' ? params.content.trim() : ''
      if (content === '') throw new Error('跟进内容 content 必填且不能全为空白')
      if (content.length > 500) throw new Error('跟进内容不能超过 500 个字符')
      const resourceIds = normalizeFollowUpResourceIds(params?.resourceIds)
      const clientRequestId = requireClientRequestId(params?.clientRequestId)
      return requestMy<number>({
        url: FLOW_PROCESS_FOLLOW_UP_CREATE_PATH,
        method: 'post',
        data: { processInstanceId, content, resourceIds, clientRequestId },
      })
    },

    /** 查询短信提醒详情；发送前应依据返回的 canSend 与 disabledReason 做业务确认。 */
    async getSmsRemindDetail (processInstanceId: string | number): Promise<FlowProcessSmsRemindDetail> {
      return requestMy<FlowProcessSmsRemindDetail>({
        url: FLOW_PROCESS_SMS_REMIND_DETAIL_PATH,
        method: 'get',
        params: { processInstanceId: requireProcessInstanceId(processInstanceId) },
      })
    },

    /** 查询短信提醒历史；返回值按服务端记录顺序保留。 */
    async listSmsRemindHistory (processInstanceId: string | number): Promise<FlowProcessSmsRemindRecord[]> {
      return requestMy<FlowProcessSmsRemindRecord[]>({
        url: FLOW_PROCESS_SMS_REMIND_HISTORY_PATH,
        method: 'get',
        params: { processInstanceId: requireProcessInstanceId(processInstanceId) },
      })
    },

    /**
     * 向当前审批人发送短信提醒。会产生真人短信副作用；不自动重试，超时先用历史/详情回查。
     */
    async sendSmsRemind (params: FlowProcessSmsRemindSendParams): Promise<FlowProcessSmsRemindRecord> {
      const processInstanceId = requireProcessInstanceId(params?.processInstanceId)
      const clientRequestId = requireClientRequestId(params?.clientRequestId)
      return requestMy<FlowProcessSmsRemindRecord>({
        url: FLOW_PROCESS_SMS_REMIND_SEND_PATH,
        method: 'post',
        data: { processInstanceId, clientRequestId },
      })
    },
  }
}

export type FlowTaskCapability = ReturnType<typeof createFlowTaskCapability>
