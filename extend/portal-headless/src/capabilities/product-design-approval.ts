import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 产品设计文档审核（`hr_product_design_approval`）—— 流程表单这一类的第三条线，
 * 也是 `docs/process-forms.md` §2.2 第一梯队里排在第 4 位的那个流程。
 *
 * 页面：`/simple/hr/form/045`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=hr_product_design_approval&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/045
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）。
 *
 * ---------------------------------------------------------------------------
 * 〇、前置核对：key / 名称 / 分类**都与调查文档对不上，以实测为准**
 * ---------------------------------------------------------------------------
 *
 * 派单时说「`docs/process-forms.md` 记它属**审核**类」，并给了一个待核对的 key。
 * 2026-09-21 拉了两遍 `GET /bpm/process-definition/create-list`（`processType` 两个值都拉）
 * 【实测，测试环境，租户 1】：
 *
 * | 项 | 实测值 |
 * | --- | --- |
 * | `key` | `hr_product_design_approval`（**与派单一致**） |
 * | `name` | **产品设计文档审核**（派单里写的「产品设计文档审核」也对得上；`docs/process-forms.md` 表格里另一处写成「产品设计文档审核」，两处其实是同一个） |
 * | `formCustomCreatePath` | **`simple/hr/form/045`**（与调查文档一致） |
 * | `processType` | **2 = 审批**（⚠️ **不是审核**；`processType=1` 那一遍返回的 25 个流程里**根本没有它**，它在 `processType=2` 的 57 个里） |
 * | `category` | `human_process`（「人力」分组） |
 * | `formType` / `baseUrl` | `20` / `portal`（页面 `hasError()` 那四条全满足，不是红色卡片） |
 *
 * ⇒ **key、名称、表单路径三项都核对上了，可以开工**；但「它属审核类」这句**实测不成立**
 * ——它是 `processType=2`（审批）。这条不是文字游戏：SDK 的 `my-instances` 能力把
 * `processType` 当筛选参数，`docs/process-forms.md` 也用它分类，照抄「审核（1）」
 * 会让调用方**筛不到自己的单据**。本能力里所有 `processType` 的地方都写 **2**。
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：**接口里没有，只在前端源码与真实页面里**
 * ---------------------------------------------------------------------------
 *
 * 与通用审批同一条结论（【实测】2026-09-21 复核，key 换成 045 的流程后不变）：
 *
 * - `GET /bpm/process-definition/get?key=hr_product_design_approval` → `formFields: null`、
 *   `formCustomCreatePath: null`
 * - `GET /bpm/process-definition/create-list?...` → **只有它**给出
 *   `formCustomCreatePath: "simple/hr/form/045"`（`formFields` 仍是 null）
 *
 * ⇒ 字段只能读 `app/portal/views/simple/hr/form/045/page/pc/edit/index.vue` 的模板
 * 与它的 `buildSubmitData()`。逐条见 `docs/pages/产品设计文档审核.md` 的「逐字段基准」。
 *
 * ---------------------------------------------------------------------------
 * 二、页面上真实存在的控件（**全部**表达在这份契约里）
 * ---------------------------------------------------------------------------
 *
 * | # | 页面控件 | 字段 | 形态 | 本地校验 | SDK 参数 |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | 申请事项 | `applicationItem` | `a-input` | required，≤200 | `applicationItem` |
 * | 2 | 申请内容 | `applicationContent` | `a-textarea` | required，≤500 | `applicationContent` |
 * | 3 | 抄送人 | `copyUserIds` | 多选人员 | 无（可选） | `copyUserIds` |
 * | 4 | 附件 | `attachments` | 拖拽上传，≤10 | ≤10、扩展名白名单 | `attachments` |
 * | 5 | 审批人 | `startUserSelectAssignees` | **自选审批人**（`{taskId:[userId]}`） | 由 prepare 给出的节点决定 | `startUserSelectAssignees` |
 * | 6 | 「查看审批流程」预览 | —— | 只读按钮 | —— | `product-design-approval-preview`（**做了**，见下） |
 *
 * **六类控件全部表达到了**（比通用审批那条线多一类：预览按钮那条线做了）。
 *
 * ### 2.1 与 `/simple/hr/form/035`（通用审批）的两处**真实差异**
 *
 * 逐行 diff 过两份 `page/pc/edit/index.vue`，**字段部分**只有两处差别：
 *
 * 1. **045 没有 035 那个行内「审批人」`a-form-item`。**
 *    035 在表单主体里直接放了一个 `common-flow-form-pc-start-user-select`；
 *    045 把这一块换成了**只读的「文档审核要求」`a-alert`**（A 文档 1 份 / B 文档最多 10 份
 *    那两段说明，**没有绑定任何字段**）。045 的审批人选择**只在右下角
 *    「查看审批流程」那个弹窗里**（`portal-hxr-flow-process-preview` 收
 *    `:start-user-select-assignees="bpmStartUserSelectAssignees"`）。
 *    ⇒ **控件位置不同、字段相同**：两边最终提交的都是 `startUserSelectAssignees`。
 * 2. **045 没有 `handleApprovalDependencyChange`。**
 *    035 在两个输入框上挂了失焦钩子去刷新审批人节点；045 没有，
 *    所以 045 的 `getTemporaryRequiredStartUserSelectTasks` **只在点「提交」时发**
 *    （这一条是本轮抓基准时实测到的，见 `baseline/product-design-approval.browser.json`）。
 *    SDK 的 `prepare()` 不受影响——它本来就是把那一步单独摘出来给调用方。
 *
 * **`a-alert` 那段「文档审核要求」不产生字段**，所以不表达为参数：它说的是
 * 「A 文档 1 份、B 文档最多 10 份，B 可含 Synapse 链接」——那是**业务约定**，
 * 后端没有对应的字段或校验（045 的 `formRules` 里 `attachments: []` 是空的），
 * 页面上也没有第二个附件槽位。把它编成一个 SDK 参数就等于**凭空造一个后端不认的契约**。
 * 本条如实记为「未表达」，理由写在这里。
 *
 * ### 2.2 字段契约的**两处独立佐证**
 *
 * `baseline/product-design-approval.browser.json` 里有两条真实抓包，各自都含一份
 * `buildSubmitData()` 的产物，且**逐字节相同**：
 *
 * ```jsonc
 * // ① 点「提交」触发的审批人节点查询
 * {"applicationItem":"…","applicationContent":"…","attachments":[],"copyUserIds":[]}
 * // ② 点「查看审批流程」时，preview 请求里嵌的 variables
 * {"processDefinitionKey":"hr_product_design_approval",
 *  "variables":{"applicationItem":"…","applicationContent":"…","attachments":[],"copyUserIds":[]},
 *  "startUserSelectAssignees":{},"copyUserIds":[]}
 * ```
 *
 * 这两条与 035 基准里那条 POST 的 body **逐字节相同**——所以「与通用审批同形」
 * 这句在 045 上是**实测成立的**，不是照抄过来的假设。
 *
 * ---------------------------------------------------------------------------
 * 三、审批人节点：与通用审批**同形**，但节点本身要实测（不照抄 035 的节点 id）
 * ---------------------------------------------------------------------------
 *
 * ⚠️ **这一节是本流程与 035 差别最大的地方，也是「别照抄」最要紧的一处。**
 *
 * 035 实测只有 **1 个**自选节点（`Activity_1o1sabd`「发起人自选2」）；
 * **045 实测有 2 个**【实测 2026-09-21，真实测试环境】：
 *
 * | # | 节点 id | 名称 | minSelectCount | approvalMode | selectionOrderRequired |
 * | --- | --- | --- | --- | --- | --- |
 * | 1 | `Activity_1qdzbtn` | 业务人员审批 | 1 | `SEQUENTIAL`（依次） | **true** |
 * | 2 | `Activity_1bkivtw` | 博创内部审批 | 1 | `OR_SIGN`（或签） | false |
 *
 * ⇒ 两个节点**都必须给非空 assignees**（后端对每个 `START_USER_SELECT` 节点都校）。
 * 只填一个的话 `create` 会被 `PROCESS_INSTANCE_START_USER_SELECT_ASSIGNEES_NOT_CONFIG`
 * 拒掉。**照抄 035 的"只有一个节点"会直接错。**
 *
 * 本能力里**不写死任何节点 id**：节点一律由 `prepare()` 现取，调用方按
 * `tasks[].id` 组装 `startUserSelectAssignees`。
 *
 * 审批链上还实测到一个**不由发起人选**的节点：`Activity_03ebjts`「AI审核」，
 * `candidateStrategy: 30`（固定指派人，`candidateUsers: [管理员]`）。
 * 它**不出现在 `prepare()` 的 tasks 里**（那不是发起人自选），调用方不用管它，
 * 但用 `preview()` 看审批链时会看到。
 *
 * 后端**强校验**它（`BpmProcessInstanceServiceImpl.validateStartUserSelectAssignees`）：
 * 每个 `START_USER_SELECT` 节点都必须有非空 assignees，否则报
 * `PROCESS_INSTANCE_START_USER_SELECT_ASSIGNEES_NOT_CONFIG`；还有四条附加规则
 * （不能有 null、不能重复、数量要落在 min/max 内、用户必须真实存在）——
 * `assertAssigneesForTasks()` 逐条复刻了前三条，第四条交给后端。
 *
 * ⚠️ **接口名字的坑**（同 035）：后端 `ProductDesignApprovalController` 两个变体都写了
 * （`/getRequiredStartUserSelectTasks` 与 `/getTemporaryRequiredStartUserSelectTasks`），
 * 前端用的是**后者**（045 的 `handleSubmit` 里写死的 `apiCheck` 就是它）。
 * SDK 跟前端走，用后者。
 *
 * ---------------------------------------------------------------------------
 * 四、长选项：抄送人 / 审批人候选**必须带关键字**（设计 D6 / H35）
 * ---------------------------------------------------------------------------
 *
 * 页面自己怎么取的【实测，浏览器抓包，2026-09-21】——**本流程比通用审批更极端**：
 *
 * ```
 * GET /admin-api/system/user/simple-page?pageNo=1&pageSize=500
 * GET /admin-api/system/user/simple-page?pageNo=2&pageSize=500
 * … 一直翻到 pageNo=9
 * ```
 *
 * **无关键字、翻满 9 页、约 4500 人**（该账号全量 4200+）。035 的基准里只看到 1 页；
 * 045 是**连翻 9 页**——「页面自己全量拉 4500 人」这句话在 045 上是字面成立的。
 * **无头下绝不能照抄**（设计 D6 / H35）。SDK 的 `searchUsers()` 强制要关键字，
 * 并拒绝 `pageSize=-1`，与会议室 / 通用审批那两条线同一套保护。
 *
 * 与源码之间有一处**不一致**（如实记下）：045 的 `fetchCopyUserOptions()` 源码写的是
 * `GET /admin-api/system/user/simple-list`（全量一次拉完），而真实页面上抓到的是
 * **`simple-page` 翻 9 页**。**两者都是"无关键字的大批量拉取"**，结论不变；
 * 记在这里是免得后人拿着源码那句话去争论。SDK 的 `searchUsers` 走 `simple-page` +
 * `nickname=`（与浏览器同一个接口），只在给了 `deptId` 时才不带关键字。
 *
 * ---------------------------------------------------------------------------
 * 五、写链路：prepare → submit → cancel（+ 查）
 * ---------------------------------------------------------------------------
 *
 * ```
 * prepare  POST /hr/product-design-approval/getTemporaryRequiredStartUserSelectTasks
 * submit   POST /hr/product-design-approval/create   body = 载荷 + startUserSelectAssignees
 * detail   GET  /hr/product-design-approval/get?id=
 * 找实例    GET  /bpm/process-instance/my-page        myInstances / findInstanceByBusinessKey
 * cancel   DELETE /bpm/process-instance/cancel-by-start-user body { id: <流程实例 id>, reason }
 * ```
 *
 * **`cancel` 的 id 不是 `submit` 的返回值**（同 035）：`create` 返回**业务单据 id**；
 * `cancel-by-start-user` 要的是**流程实例 id**；而 `GET /hr/product-design-approval/get`
 * 的响应 VO 里**没有 `processInstanceId` 字段**（只有 id / 申请事项 / 申请内容 / 附件 / 状态）。
 * ⇒ 唯一通路是「我的流程」列表按 `businessKey` 对上（`findInstanceByBusinessKey()`）。
 * **这不是绕路，是页面上真实发生的路径**（`flow/task/my/list.vue` 的 `actionCancel(record.id)`）。
 *
 * ⚠️ **审批人绝对不要选发起人本人**：后端有「流程发起人与审批人相同，自动审核通过」
 * （`BpmTaskServiceImpl:913-916`），流程当场走完，`cancel` 必然报「流程不处于运行中」——
 * **永久留下一条撤不掉的单据**。测试环境里已经有 3 条这样的单据，不要再增加。
 * 这条守卫放在 `smoke/product-design-approval.mjs` 的**提交之前**（用审批链预览判）。
 *
 * ---------------------------------------------------------------------------
 * 六、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/045`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的规则里**一条都匹配不到**，
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器在表单页上同样不发
 * （抓包实测：`getTemporaryRequiredStartUserSelectTasks` 的请求头只有
 * `tenant-id / token / Accept-Language / Accept / Content-Type`，**没有 `module-type`**）。
 * 这与 conventions 第 2 条一致：算不出就不发，是**忠实**，不是缺陷。
 *
 * ---------------------------------------------------------------------------
 * 七、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **附件上传本身不在这里。** 本能力收的是 `[{url, name}]`，url 要用
 *   `base-upload-file`（目录选 `HR/approval`，与本表单的
 *   `ossFilePathOptions.hr.approval` 同一个）先传上去。这条链已端到端验证过
 *   （2026-09-21，真传一个 CSV → 当附件提交 → 回读 url/name 逐字段一致 → 撤销 →
 *   签名 DELETE 删掉对象 → 匿名 GET 打不开）。记录见
 *   `docs/pages/产品设计文档审核.md` §六.3。
 * - **「文档审核要求」（A 文档 1 份 / B 文档最多 10 份、B 可含 Synapse 链接）没有表达。**
 *   它是页面上一段**只读说明**，不绑定任何字段，后端也没有对应校验。理由见 §2.1。
 * - **「重新发起」（reapply）没做**：`isReapply` 分支会从原流程实例抄抄送人再提交，
 *   是一条**另起的写链路**，需要单独验证。
 * - **`PUT /hr/product-design-approval/update` 与 `DELETE …/delete/{id}` 没做**：
 *   045 的 `handleSubmit` 里编辑分支**前端已经注释掉了**（`apiSubmit` 写死成 `/create`），
 *   所以**页面上根本走不到这两个入口**。要造一条「已驳回」的单据得先让真人去驳回
 *   ——那是第三方的动作，本轮做不到，所以这两条既没实现也没法验。
 *   实现一个页面上不存在、又验证不了的写操作，不叫「完整」。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与会议室 / 通用审批同一个壳） */
export const PRODUCT_DESIGN_APPROVAL_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**，所以 prepare / submit / detail
 * 声明在这个页面上下文里。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测 2026-09-21】返回 `simple/hr/form/045`。
 */
export const PRODUCT_DESIGN_APPROVAL_FORM_PATH = '/simple/hr/form/045'

/**
 * 「我的流程」页。**取消流程的入口在这里**，不在表单页。
 *
 * ⚠️ 这一页与表单页一样**不在 `page-catalog.json` 里**，所以它不会把任何页面的完成度
 * 判成已完成。反过来，**不要**把任何能力挂到 `/dashboard/flow/task/create/list`
 * （「发起流程」）——那一条**在**目录里，会把那个页面错误地标成已完成。
 */
export const PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自 `GET /bpm/process-definition/create-list` 与表单入口 URL */
export const PRODUCT_DESIGN_APPROVAL_PROCESS_KEY = 'hr_product_design_approval'

/**
 * 流程类型。⚠️ **实测是 2（审批），不是 1（审核）**——见文件头 §〇。
 * 派单里「它属审核类」那句与实测不符，这里是刻意钉住的地方。
 */
export const PRODUCT_DESIGN_APPROVAL_PROCESS_TYPE = 2

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 045 的表单规则与模板属性）
// ---------------------------------------------------------------------------

/** `a-input` 的 `:maxlength="200"` + `formRules.applicationItem` 的 `max: 200` */
export const APPLICATION_ITEM_MAX = 200
/** `a-textarea` 的 `:maxlength="500"` + `formRules.applicationContent` 的 `max: 500` */
export const APPLICATION_CONTENT_MAX = 500
/** `common-upload-dragger` 的 `:maxCount="10"`（045 与 035 同一个值） */
export const ATTACHMENT_MAX_COUNT = 10
/** `beforeFileUpload` 的 50MB 上限（**本地无法校验**：SDK 手上只有 url 与 name） */
export const ATTACHMENT_MAX_SIZE_MB = 50

/**
 * 附件扩展名白名单，逐条抄自 `045` 模板里 `common-upload-dragger` 的 `accept`
 * 与 `useAppUpload` 的 `accept`（两处一致，且与 035 逐字相同）：
 * `.pdf, .jpg, .jpeg, .png, .doc, .docx, .xls, .xlsx, .csv, .ppt, .pptx`。
 *
 * ⚠️ **比 `base-upload-file` 的 `SAFE_EXTENSIONS` 窄**：两者不是一回事，谁也不要抄谁。
 */
export const ATTACHMENT_ACCEPT_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
] as const

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ProcessDefinition = {
  id: string
  key: string
  name: string
  formType?: number | null
  formCustomCreatePath?: string | null
  baseUrl?: string | null
  category?: string | null
  /** ⚠️ 实测里**一次都没出现过**，不要以为它有值（`docs/process-forms.md` §3.4） */
  startUserSelectTasks?: Array<{ id: string; name: string }> | null
  [key: string]: unknown
}

/** 表单里的一件附件。**形状就是页面 `formState.attachments` 的元素**：只有 url 与 name */
export type ProductDesignApprovalAttachment = {
  url: string
  name: string
  /** 详情接口会带上它；提交时页面只发 url / name，所以是可选的 */
  id?: number | string
  pages?: number | null
  size?: number | null
  [key: string]: unknown
}

/**
 * 提交 / prepare 的载荷。
 *
 * **没有 `id` 字段**——`buildSubmitData()` 里一个 `id` 都不拼
 * （编辑分支在前端是注释掉的）。这与基准抓包逐字节一致。
 */
export type ProductDesignApprovalDraft = {
  /** 申请事项，必填，≤200 字 */
  applicationItem: string
  /** 申请内容，必填，≤500 字 */
  applicationContent: string
  /** 附件，可选，≤10 件。url 要用 base-upload-file 先传（目录 `HR/approval`） */
  attachments?: ProductDesignApprovalAttachment[]
  /**
   * 抄送人用户 id，可选。
   * ⚠️ 这些人会**真的收到抄送通知**——测试时留空数组。
   */
  copyUserIds?: number[]
}

/**
 * 一个「发起人自选」审批人节点。字段逐条对应后端 `UserTaskDTO`。
 *
 * `minSelectCount` / `maxSelectCount` 是后端硬规则的来源：
 * `isSelectionCountValid()` 会按它校验人数。
 */
export type StartUserSelectTask = {
  /** 节点 id（BPMN 里的 activity id）。`startUserSelectAssignees` 的键就是它 */
  id: string
  name: string
  /** `SEQUENTIAL`（依次审批）/ `PARALLEL`（并行）等 */
  approvalMode?: string
  executionMode?: string
  completionRule?: string
  minSelectCount?: number | null
  maxSelectCount?: number | null
  /** true 表示**选择的顺序有意义**（依次审批）——传数组时顺序即审批顺序 */
  selectionOrderRequired?: boolean
  approvalDescription?: string
  [key: string]: unknown
}

/** `{ [节点 id]: [用户 id, ...] }`。与会议室 / 通用审批同一形状 */
export type StartUserSelectAssignees = Record<string, number[]>

/** 本流程单据（`GET /hr/product-design-approval/get` 的响应） */
export type ProductDesignApprovalRecord = {
  id: number
  applicationItem?: string
  applicationContent?: string
  attachments?: ProductDesignApprovalAttachment[]
  /** 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消 */
  status?: number
  statusName?: string
  /**
   * ⚠️ **这个字段不存在**（与 035 的 VO 同一个情况）。要流程实例 id 请走
   * `findInstanceByBusinessKey()`。留在这里是为了让"查不到"这件事有一个显式的落点。
   */
  processInstanceId?: never
  [key: string]: unknown
}

/** 「我的流程」列表里的一行（`GET /bpm/process-instance/my-page`） */
export type ProcessInstanceRow = {
  /** **流程实例 id**，`cancel` 要的就是它 */
  id: string
  name?: string
  title?: string
  /** 1 = 审批中（页面上「取消流程」按钮出现的条件） */
  status?: number
  /** 业务单据 id 的字符串形式 */
  businessKey?: string
  processDefinitionKey?: string
  startTime?: string
  endTime?: string
  /**
   * 发起人。**这是"我是谁"的替代来源**——`GET /system/user/profile/get` 在这个 token 上
   * 报 500（实测），而这一行的 `startUser.id` 是响应里真有的。
   */
  startUser?: { id?: number; nickname?: string; [key: string]: unknown }
  [key: string]: unknown
}

export type ProductDesignApprovalInstanceQuery = {
  name?: string
  title?: string
  status?: number
  category?: string
  processType?: number
  pageNo?: number
  pageSize?: number
}

export type SimpleUser = {
  id: number
  nickname?: string
  code?: string
  deptId?: number
  [key: string]: unknown
}

/**
 * `POST /bpm/process-instance/preview` 响应里的一个审批链节点。
 *
 * 字段逐条来自【实测，2026-09-21，真实测试环境】的响应：
 *
 * ```jsonc
 * { "nodeId": "Activity_03ebjts", "name": "AI审核", "type": "USER_TASK",
 *   "candidateStrategy": 30, "candidateStrategyName": "用户",
 *   "candidateUsers": [{ "id": 1, "nickname": "管理员" }],
 *   "approvalMode": "SINGLE", "state": "CONFIRMED",
 *   "conditionDescription": null, "copyUsers": [] }
 * ```
 *
 * ⚠️ **审批人是 `candidateUsers` 而不是 `assigneeUsers`**，而且节点上区分
 * 「固定指派人（`candidateStrategy: 30`）/ 发起人自选（`35`）」靠的是
 * `candidateStrategyName`。`type` 实测有 `START_EVENT` / `USER_TASK` / `END_EVENT`。
 * 节点 id 的键叫 **`nodeId`**（不是 `id`、也不是 `taskDefinitionKey`）。
 */
export type ProcessInstancePreviewNode = {
  /** 节点 id。**键名是 `nodeId`** —— 与 `prepare()` 返回的 `tasks[].id` 是同一个值 */
  nodeId?: string
  name?: string | null
  /** 实测 `START_EVENT` / `USER_TASK` / `END_EVENT` */
  type?: string
  /** 30 = 用户（固定指派人），35 = 发起人自选 */
  candidateStrategy?: number | null
  candidateStrategyName?: string | null
  candidateUsers?: SimpleUser[]
  approvalMode?: string | null
  state?: string | null
  conditionDescription?: string | null
  copyUsers?: SimpleUser[]
  [key: string]: unknown
}

/**
 * `POST /bpm/process-instance/preview` 的响应。顶层字段是【实测】的完整集合
 * ——`["processDefinitionId","processDefinitionKey","processDefinitionName",
 * "state","nodes","copyUsers"]`。
 *
 * ⚠️ 审批链在 **`nodes`** 里，**不叫 `activities`**（这一条是实测纠正过来的：
 * 先按常见的 BPMN 叫法猜了 `activities`，实测响应里根本没有这个键）。
 */
export type ProcessInstancePreview = {
  processDefinitionId?: string
  processDefinitionKey?: string
  processDefinitionName?: string
  /** 实测 `START_USER_SELECT`（还没选自选审批人时）等 */
  state?: string | null
  /** 审批链上的节点，含开始 / 结束事件 */
  nodes?: ProcessInstancePreviewNode[]
  copyUsers?: SimpleUser[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

function assertText (value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}必填（页面表单规则 required）`)
  }
  if (value.length > max) {
    throw new Error(`${label}最多 ${max} 个字，收到 ${value.length} 个`)
  }
  return value
}

/**
 * 附件校验：**只做页面真会拦的那两条的一部分**。
 *
 * - 条数 ≤10：页面的 `:maxCount="10"` 与 `onLeaveFileUploadDone` 里的
 *   `length >= 10` 分支都会拦 → SDK 也拦。
 * - 扩展名：页面的 `accept` 白名单 → SDK 也拦（按 `name` 判；**没有扩展名时放行**）。
 * - **50MB 大小上限不拦**：SDK 手上只有 url 与 name（`buildSubmitData` 会把别的字段
 *   全丢掉），**没有任何办法算出大小**。与其猜，不如把这条如实留给后端。
 */
export function assertAttachments (attachments: unknown): ProductDesignApprovalAttachment[] {
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
            ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' '),
        )
      }
    }
    // 与 buildSubmitData 一致：只保留 url 与 name
    return { url, name }
  })
}

/** 抄送人：可选，必须是用户 id 数组 */
export function assertCopyUserIds (copyUserIds: unknown): number[] {
  if (copyUserIds === undefined || copyUserIds === null) return []
  if (!Array.isArray(copyUserIds)) {
    throw new Error('copyUserIds 必须是用户 id 数组（页面是多选人员控件）')
  }
  return copyUserIds.map((id, index) => {
    const value = Number(id)
    if (!Number.isFinite(value)) {
      throw new Error(
        `copyUserIds[${index}] 不是数字：${JSON.stringify(id)}。用户 id 要用 product-design-approval-user-search 查`,
      )
    }
    return value
  })
}

/**
 * 构造提交载荷。**逐字段复刻 `045` 的 `buildSubmitData()`**，包括键的书写顺序
 * ——D20 要求与浏览器逐字段一致，键顺序不同也算不一致。
 *
 * 基准（真实浏览器抓包，`baseline/product-design-approval.browser.json`）：
 *
 * ```json
 * {"applicationItem":"SDK-TEST-baseline","applicationContent":"SDK-TEST-baseline content",
 *  "attachments":[],"copyUserIds":[]}
 * ```
 *
 * `startUserSelectAssignees` **不在这里**——它是 `handleSubmit` 最后
 * `{...submitData, startUserSelectAssignees}` 那个展开加上的，所以永远排在最后，
 * 由 `buildProductDesignApprovalCreatePayload()` 补。
 */
export function buildProductDesignApprovalPayload (
  draft: ProductDesignApprovalDraft,
): Record<string, unknown> {
  const applicationItem = assertText(draft?.applicationItem, '申请事项 applicationItem', APPLICATION_ITEM_MAX)
  const applicationContent = assertText(
    draft?.applicationContent,
    '申请内容 applicationContent',
    APPLICATION_CONTENT_MAX,
  )
  return {
    applicationItem,
    applicationContent,
    attachments: assertAttachments(draft?.attachments),
    copyUserIds: assertCopyUserIds(draft?.copyUserIds),
  }
}

/**
 * 表单在数据不全时不让去问审批人节点。
 *
 * 035 里这个前置有名字（`isGeneralApprovalDataComplete`）；**045 的源码里没有这个名字**
 * ——045 把行内审批人控件整块换成了说明性的 `a-alert`，那条 `isXxxDataComplete`
 * 守卫也跟着没了。但 045 的 `handleSubmit` 第一步仍是 `await formRef.value.validate()`
 * （两个字段 required），校验不过就**根本走不到** `getTemporaryRequiredStartUserSelectTasks`。
 *
 * ⇒ 行为是等价的（字段不全 ⇒ 不发那个请求），所以 SDK 保留这条前置。
 * **这里记的是"045 上它由 antd 的表单校验承担，而不是一个具名函数"这个事实**，
 * 免得后人拿着 035 的函数名来 045 里找。
 */
export function assertDataComplete (state: { applicationItem?: unknown; applicationContent?: unknown }): void {
  const complete = (value: unknown): boolean =>
    typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined
  if (!complete(state?.applicationItem) || !complete(state?.applicationContent)) {
    throw new Error(
      '「申请事项」与「申请内容」都填了才能问审批人节点（045 的 handleSubmit 第一步是表单校验）。' +
        '两个字段本身就是必填，先把它们填上。',
    )
  }
}

/**
 * 把 `prepare()` 拿到的节点与调用方给的审批人**按后端那四条规则**先校一遍。
 *
 * 复刻 `BpmProcessInstanceServiceImpl.validateStartUserSelectAssignees`：
 *
 * | 后端规则 | 错误码 | 这里 |
 * | --- | --- | --- |
 * | 每个节点必须有非空 assignees | `…ASSIGNEES_NOT_CONFIG` | ✅ |
 * | 不能有 null | `…ASSIGNEE_ID_NULL` | ✅ |
 * | 不能重复 | `…ASSIGNEES_DUPLICATE` | ✅ |
 * | 人数要落在 min/max 内 | `…ASSIGNEES_COUNT_INVALID` | ✅ |
 * | 用户必须真实存在 | `…ASSIGNEES_NOT_EXISTS` | ❌ **不查**（要另打接口，且查完也可能变） |
 *
 * 本地先拦的价值：这条链的失败是**在写操作里**发生的，而写操作会惊动真人——
 * 能让它在发出请求之前就红，就红在前面。
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
          `请用 product-design-approval-user-search 查人，再把 { "${task.id}": [userId] } 传给 submit。`,
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
 * create 的完整请求体：`{...submitData, startUserSelectAssignees}` —— 键顺序照抄
 * `045` 的 `handleSubmit`（`startUserSelectAssignees` **永远在最后**）。
 */
export function buildProductDesignApprovalCreatePayload (
  draft: ProductDesignApprovalDraft,
  startUserSelectAssignees: StartUserSelectAssignees,
): Record<string, unknown> {
  if (startUserSelectAssignees === null || typeof startUserSelectAssignees !== 'object') {
    throw new Error('startUserSelectAssignees 必须是 { [节点 id]: [用户 id, ...] }（先调 prepare 拿节点 id）')
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
    ...buildProductDesignApprovalPayload(draft),
    startUserSelectAssignees: normalized,
  }
}

/**
 * `POST /bpm/process-instance/preview` 的请求体 —— 逐字段照抄 045 页面的
 * 「查看审批流程」按钮发出的那条【实测，`baseline/product-design-approval.browser.json`】：
 *
 * ```json
 * {"processDefinitionKey":"hr_product_design_approval",
 *  "variables":{"applicationItem":"…","applicationContent":"…","attachments":[],"copyUserIds":[]},
 *  "startUserSelectAssignees":{},"copyUserIds":[]}
 * ```
 *
 * 注意 `variables` 就是 `buildSubmitData()` 的产物，键顺序与 create 的载荷一致；
 * 而 `startUserSelectAssignees` 与 `copyUserIds` **在外层又各出现一次**
 * （页面把这两个也直接摊在顶层）。**照抄，不"顺手合并"**——D20 要求逐字段一致。
 */
export function buildProductDesignApprovalPreviewPayload (
  draft: ProductDesignApprovalDraft,
  startUserSelectAssignees: StartUserSelectAssignees = {},
): Record<string, unknown> {
  const variables = buildProductDesignApprovalPayload(draft)
  const normalized: StartUserSelectAssignees = {}
  for (const [taskId, ids] of Object.entries(startUserSelectAssignees ?? {})) {
    if (!Array.isArray(ids)) {
      throw new Error(`startUserSelectAssignees["${taskId}"] 必须是用户 id 数组`)
    }
    normalized[taskId] = ids.map((id) => {
      const value = Number(id)
      if (!Number.isFinite(value)) {
        throw new Error(`startUserSelectAssignees["${taskId}"] 里有非数字：${JSON.stringify(id)}`)
      }
      return value
    })
  }
  return {
    processDefinitionKey: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY,
    variables,
    startUserSelectAssignees: normalized,
    copyUserIds: variables.copyUserIds,
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

/** 人员候选：**必须先给关键字**（设计 D6 / H35）。与会议室 / 通用审批同一处保护 */
const USER_SEARCH_PARAM: ParamSpec = {
  name: 'keyword',
  kind: 'search',
  required: true,
  description:
    '姓名等关键字。候选是**该租户全量 4200+ 人**（实测），页面自己用 ' +
    '`simple-page?pageNo=1..9&pageSize=500` **无关键字翻 9 页拉完** —— 无头下禁止照抄（设计 D6 / H35）',
}

const USER_LOOKUP = { capabilityId: 'product-design-approval-user-search', keywordParam: 'keyword' } as const

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'applicationItem',
    kind: 'text',
    required: true,
    description: `申请事项，必填，最多 ${APPLICATION_ITEM_MAX} 字（页面 a-input :maxlength）`,
  },
  {
    name: 'applicationContent',
    kind: 'text',
    required: true,
    description: `申请内容，必填，最多 ${APPLICATION_CONTENT_MAX} 字（页面 a-textarea）`,
  },
  {
    name: 'copyUserIds',
    kind: 'search',
    required: false,
    description:
      '抄送人用户 id 数组（页面上的多选人员控件）。⚠️ 这些人会**真的收到抄送通知**。' +
      '用户 id 必须先查：候选几千个，禁止无关键字全量拉取',
    lookup: USER_LOOKUP,
  },
  {
    name: 'attachments',
    kind: 'text',
    required: false,
    description:
      `附件数组 [{url, name}]，最多 ${ATTACHMENT_MAX_COUNT} 件，扩展名只收 ` +
      ATTACHMENT_ACCEPT_EXTENSIONS.map((e) => `.${e}`).join(' ') +
      '。url 要用 base-upload-file 先传到 OSS（目录 HR/approval）。' +
      `⚠️ 页面的 ${ATTACHMENT_MAX_SIZE_MB}MB 单件上限 SDK 校验不了（拿不到字节数）。` +
      '⚠️ 页面上「文档审核要求」那段还写着 A 文档 1 份 / B 文档最多 10 份，' +
      '那是**业务约定、后端不校验**，本参数只按控件的 10 件上限拦',
  },
]

export const productDesignApprovalCapabilities: CapabilityDefinition[] = [
  {
    id: 'product-design-approval-definition',
    title: '查询产品设计文档审核的流程定义',
    pagePath: PRODUCT_DESIGN_APPROVAL_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${PRODUCT_DESIGN_APPROVAL_PROCESS_KEY}`,
        options: [{ label: '产品设计文档审核', value: PRODUCT_DESIGN_APPROVAL_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'product-design-approval-user-search',
    title: '按关键字搜索抄送人 / 审批人候选',
    pagePath: PRODUCT_DESIGN_APPROVAL_FORM_PATH,
    write: false,
    params: [
      USER_SEARCH_PARAM,
      { name: 'deptId', kind: 'tree', required: false, description: '限定部门 id（页面上的人员弹窗也带部门树）' },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20；不允许 -1（全量）' },
    ],
  },
  {
    id: 'product-design-approval-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点',
    pagePath: PRODUCT_DESIGN_APPROVAL_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'product-design-approval-preview',
    title: '查看审批流程（提交前的只读预览，对应页面右下角那个按钮）',
    pagePath: PRODUCT_DESIGN_APPROVAL_FORM_PATH,
    write: false,
    params: [
      ...DRAFT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: false,
        description:
          '{ [节点 id]: [用户 id, ...] }，可留空——**留空时页面传的就是 `{}`**' +
          '（抓包里那条 preview 的 `startUserSelectAssignees` 就是空对象）。' +
          '填了就能预先看到「按这个选择，审批链会是什么样」',
        lookup: USER_LOOKUP,
      },
    ],
  },
  {
    id: 'product-design-approval-submit',
    title: '提交产品设计文档审核（会真的发起流程、给审批人推待办）',
    pagePath: PRODUCT_DESIGN_APPROVAL_FORM_PATH,
    write: true,
    params: [
      ...DRAFT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: true,
        description:
          '{ [节点 id]: [用户 id, ...] }。节点 id 来自 product-design-approval-prepare；' +
          '人要先按关键字查（候选几千个）。⚠️ **绝对不要选发起人本人**——' +
          '后端有「流程发起人与审批人相同，自动审核通过」，流程会当场走完、之后 cancel 撤不掉。' +
          '漏选会被后端以「发起人自选审批人不能为空」拒绝',
        lookup: USER_LOOKUP,
      },
    ],
  },
  {
    id: 'product-design-approval-detail',
    title: '查询单条产品设计文档审核单据',
    pagePath: PRODUCT_DESIGN_APPROVAL_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有流程实例 id** —— ' +
          '要取消得先 product-design-approval-my-instances 按 businessKey 找流程实例',
      },
    ],
  },
  {
    id: 'product-design-approval-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH,
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
        description:
          '流程类型字典 bpm_process_type；本流程**实测是 2（审批）**，不是 1（审核）',
        options: [{ label: '审核', value: 1 }, { label: '审批', value: 2 }],
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20' },
    ],
  },
  {
    id: 'product-design-approval-cancel',
    title: '取消（撤回）我发起的产品设计文档审核流程',
    pagePath: PRODUCT_DESIGN_APPROVAL_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 product-design-approval-my-instances 那一行的 id',
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

export type ProductDesignApprovalOptions = {
  /** 找流程实例时最多翻几页（每页 `scanPageSize` 条） */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

export function createProductDesignApprovalCapability (
  request: PortalRequest,
  options: ProductDesignApprovalOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: ProductDesignApprovalInstanceQuery = {},
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
   * `GET /hr/product-design-approval/get` 的响应里**没有** `processInstanceId`。
   * 唯一的通路就是翻「我的流程」，用 `businessKey` 对上。
   *
   * 翻页有上限（默认 5 页 × 50 条）。找不到时**抛错而不是返回 null**。
   *
   * **为什么在客户端按 `processDefinitionKey` 再筛一道**：`businessKey` 是**各业务表
   * 自己的主键**，所以「产品设计文档审核 51」与「通用审批 51」「会议室预定 51」
   * 会撞成同一个字符串。只按 businessKey 匹配会认错单子。
   * ⚠️ 注意**不用 `processType` 过滤**：本流程与会议室都是 `processType=2`，
   * 它区分不开；而在请求里加一个页面从不发的过滤参数，会白白偏离 D20 的逐字段一致。
   */
  async function findInstanceByBusinessKey (businessKey: number | string): Promise<ProcessInstanceRow> {
    const wanted = describeId(businessKey, 'businessKey')
    for (let page = 1; page <= maxScanPages; page += 1) {
      const result = await myInstances({ pageNo: page, pageSize: scanPageSize })
      const list = result?.list ?? []
      const hit = list.find(
        (row) =>
          String(row.businessKey) === wanted &&
          // 有的返回行不带 processDefinitionKey，那就只能按 businessKey 认（如实放行）
          (row.processDefinitionKey === undefined ||
            row.processDefinitionKey === PRODUCT_DESIGN_APPROVAL_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的产品设计文档审核流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 product-design-approval-my-instances 自己按条件找。',
    )
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 */
    definition (key: string = PRODUCT_DESIGN_APPROVAL_PROCESS_KEY): Promise<ProcessDefinition> {
      return request<ProcessDefinition>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    /**
     * 按关键字搜索抄送人 / 审批人候选。**只读**。
     *
     * 页面自己**无关键字翻 9 页、约 4500 人**（实测），这里强制要关键字——
     * 与 `meeting-application.searchUsers` / `general-approval.searchUsers` 同一套保护。
     */
    searchUsers (query: {
      keyword?: string
      deptId?: number
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: SimpleUser[]; total: number }> {
      if (!query?.keyword && query?.deptId === undefined) {
        return Promise.reject(
          new Error(
            '抄送人 / 审批人属于长选项参数：必须提供 keyword 或 deptId，不允许无条件下全量拉取（设计 D6）',
          ),
        )
      }
      if (query.pageSize === -1) {
        return Promise.reject(
          new Error('不允许 pageSize = -1（全量拉取）；请用关键字 + 分页（设计 D6）'),
        )
      }
      return request<{ list: SimpleUser[]; total: number }>({
        url: '/system/user/simple-page',
        method: 'get',
        params: {
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? 20,
          ...(query.keyword ? { nickname: query.keyword } : {}),
          ...(query.deptId === undefined ? {} : { deptId: query.deptId }),
        },
      })
    },

    /**
     * 提交前准备（**只读**）：算出这次提交需要人工指定哪些审批人节点。
     *
     * 与页面 `handleSubmit()` 的第一步一致。**节点 id 是每个流程各自的**，
     * 不要照抄别的流程（045 与 035 的节点 id 不同）。
     */
    async prepare (draft: ProductDesignApprovalDraft): Promise<{
      payload: Record<string, unknown>
      tasks: StartUserSelectTask[]
    }> {
      assertDataComplete(draft ?? {})
      const payload = buildProductDesignApprovalPayload(draft)
      const tasks = await request<StartUserSelectTask[]>({
        url: '/hr/product-design-approval/getTemporaryRequiredStartUserSelectTasks',
        method: 'post',
        data: payload,
      })
      return { payload, tasks: Array.isArray(tasks) ? tasks : [] }
    },

    /**
     * 「查看审批流程」的只读预览（**写操作？不是** —— 后端这条只是算审批链，不落库）。
     *
     * 对应页面右下角那个按钮。它**不影响能不能提交**，但如果调用方想在真提交之前
     * 让用户看一眼"这条流程会经过谁"，这条就是页面上的那个入口。
     * 请求体逐字段照抄抓包（见 `buildProductDesignApprovalPreviewPayload`）。
     *
     * ⚠️ `async` 不是为了 await：本地校验失败要变成 **rejected promise**，
     * 否则调用方 `try { await preview() } catch {}` 会漏掉同步抛出。
     * 这与 `submit()` / `cancel()` 的处理方式一致 —— **同一条能力里不能有两种失败风格**
     * （写测试时先写成了非 async，`rejects.toThrow` 当场把它抓出来了）。
     */
    async preview (
      draft: ProductDesignApprovalDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<ProcessInstancePreview> {
      return request<ProcessInstancePreview>({
        url: '/bpm/process-instance/preview',
        method: 'post',
        data: buildProductDesignApprovalPreviewPayload(draft, startUserSelectAssignees),
      })
    },

    /**
     * 真正提交（**写操作**）：创建单据**并起一条 `hr_product_design_approval` 审批流**。
     *
     * ⚠️ 它会**给真人推待办、可能发短信**。测试请：
     *   1. 标题/内容带 `SDK-TEST-` 前缀；
     *   2. `copyUserIds` 传 `[]`（抄送会真的通知到人）；
     *   3. **审批人不要选发起人本人**（否则流程当场走完，撤不掉）；
     *   4. 测完立刻用 `cancel()` 撤掉。
     *
     * 返回**业务单据 id**。⚠️ 这不是流程实例 id，撤销要先用 `findInstanceByBusinessKey()` 换。
     */
    async submit (
      draft: ProductDesignApprovalDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<unknown> {
      // async 不是为了 await：本地校验失败要变成 **rejected promise**
      return request({
        url: '/hr/product-design-approval/create',
        method: 'post',
        data: buildProductDesignApprovalCreatePayload(draft, startUserSelectAssignees),
      })
    },

    /** 单条单据详情（**只读**）。⚠️ 响应里没有流程实例 id */
    async detail (id: number | string): Promise<ProductDesignApprovalRecord> {
      describeId(id, '产品设计文档审核单据 id')
      return request<ProductDesignApprovalRecord>({
        url: '/hr/product-design-approval/get',
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
     * **`id` 是流程实例 id，不是业务单据 id**。
     *
     * `reason` 必填：后端 `@NotEmpty`。
     *
     * 只有 `status === 1`（审批中）的单据能取消（页面上按钮的出现条件）。
     * ⚠️ **审批人选成"发起人自己"时，流程会当场走完，于是永远撤不掉**
     * （后端「流程发起人与审批人相同，自动审核通过」）。`submit` 的审批人要选**别人**。
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
                'processInstanceId 来自 product-design-approval-my-instances，' +
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

export type ProductDesignApprovalCapability = ReturnType<typeof createProductDesignApprovalCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与其它流程线同样的分工：`withIdempotency` 需要**身份**（租户 / 用户），
 * 那是会话层的东西，所以包装放在组装点，能力模块只声明形状。
 */
export type ProductDesignApprovalCapabilityWithIdempotency = ProductDesignApprovalCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **为什么这条最需要防重**：后端零幂等，重发一次就是**第二条流程实例 + 第二串
   * 真人待办**（不同于建一条脏数据的普通 CRUD）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: ProductDesignApprovalDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
    },
  ) => Promise<unknown>
}
