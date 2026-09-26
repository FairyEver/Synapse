import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 通用审批（`hr_general_approval`）—— 流程表单这一类的第二条线，也是
 * `docs/process-forms.md` §2.2 排在第一梯队第 1 位的那个流程。
 *
 * 页面：`/simple/hr/form/035`，入口走「发起流程」：
 *   /dashboard/flow/form/edit?processDefinitionKey=hr_general_approval&bpmMode=edit
 *     &formCustomCreatePath=simple/hr/form/035
 *
 * 撤销入口不在表单页，在**「我的流程」**：`/dashboard/flow/task/my/list`
 * 的行内「取消流程」（`record.status === 1` 时才出现）。
 *
 * ---------------------------------------------------------------------------
 * 一、字段契约从哪来：**接口里没有，只在前端源码与真实页面里**
 * ---------------------------------------------------------------------------
 *
 * 复核过两条路，都拿不到字段（【实测】，2026-09-20 测试环境）：
 *
 * - `GET /bpm/process-definition/get?key=hr_general_approval` → `formFields: null`、
 *   `formCustomCreatePath: null`
 * - `GET /bpm/process-definition/create-list?...` → **只有它**给出
 *   `formCustomCreatePath: "simple/hr/form/035"`（`formFields` 仍是 null）
 *
 * ⇒ 字段只能读 `app/portal/views/simple/hr/form/035/page/pc/edit/index.vue` 的模板
 * 与 `common/index.js` 的 `buildGeneralApprovalSubmitData()`。逐条见
 * `docs/pages/通用审批.md` 的「逐字段基准」。
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
 * | 6 | 「查看审批流程」预览 | —— | 只读按钮 | —— | **不做**（见「尚未覆盖」） |
 *
 * **五类必备控件全部表达到了**——这一条是刻意的：CLAUDE.md 的「完整」指的是
 * 「页面上用户能操作到的功能都要实现」，而不是「挑几个好做的接口包一层」。
 *
 * ---------------------------------------------------------------------------
 * 三、审批人节点：这条线验的是会议室那条线**从没验过**的东西
 * ---------------------------------------------------------------------------
 *
 * `docs/pages/会议室预定.md` 的「尚未覆盖」写着「审批人节点非空时怎么选没验过」——
 * 会议室流程实测返回 **0 个**节点，所以那条路径一直是空的。
 *
 * 通用审批**不一样**【实测，2026-09-20】：
 *
 * ```jsonc
 * POST /hr/general-approval/getTemporaryRequiredStartUserSelectTasks
 * → { "code": 0, "ret": "SUCCESS", "data": [{
 *      "id": "Activity_1o1sabd", "name": "发起人自选2",
 *      "approvalMode": "SEQUENTIAL", "executionMode": "SEQUENTIAL",
 *      "completionRule": "ALL_APPROVED", "minSelectCount": 1,
 *      "maxSelectCount": null, "selectionOrderRequired": true,
 *      "approvalDescription": "所选人员按选择顺序依次审批，全部通过后节点通过" }] }
 * ```
 *
 * 后端**强校验**它（`BpmProcessInstanceServiceImpl.validateStartUserSelectAssignees`）：
 * 每个 `START_USER_SELECT` 节点都必须有非空 assignees，否则报
 * `PROCESS_INSTANCE_START_USER_SELECT_ASSIGNEES_NOT_CONFIG`；还有四条附加规则
 * （不能有 null、不能重复、数量要落在 min/max 内、用户必须真实存在）——
 * `assertAssigneesForTasks()` 逐条复刻了前三条，第四条交给后端。
 *
 * ⚠️ **两条接口名字的坑**（`docs/process-forms.md` §5.3 第 1 条）：
 * 后端 `GeneralApprovalController` **两个都写了**（`/getRequiredStartUserSelectTasks`
 * 与 `/getTemporaryRequiredStartUserSelectTasks`），前端用的是**后者**。
 * SDK 跟前端走，用后者——"后端也有另一个"不代表浏览器发的是它。
 *
 * ---------------------------------------------------------------------------
 * 四、长选项：抄送人 / 审批人候选**必须带关键字**（设计 D6 / H35）
 * ---------------------------------------------------------------------------
 *
 * 页面自己怎么取的【实测，浏览器抓包】：`simple-page?pageNo=1&pageSize=500`，
 * **无关键字、一次 500 条**（该账号全量 4225 人）。**无头下不能照抄**——那会把
 * 500 条记录塞进调用方上下文。SDK 的 `searchUsers()` 强制要关键字，并拒绝
 * `pageSize=-1`，与会议室那条线同一套保护。
 *
 * 顺带记一条与源码不一致的事实：`035` 的 `fetchCopyUserOptions()` 源码写的是
 * `GET /admin-api/system/user/simple-list`（全量），而真实页面上抓到的是
 * `simple-page?pageNo=1&pageSize=500`。**两者都是"无关键字的大批量拉取"**，
 * 结论不变；记录在这里是免得后人拿着源码那句话去争论。
 *
 * ---------------------------------------------------------------------------
 * 五、写链路：prepare → submit → cancel（+ 查）
 * ---------------------------------------------------------------------------
 *
 * ```
 * prepare  POST /hr/general-approval/getTemporaryRequiredStartUserSelectTasks
 * submit   POST /hr/general-approval/create                body = 载荷 + startUserSelectAssignees
 * detail   GET  /hr/general-approval/get?id=
 * 找实例    GET  /bpm/process-instance/my-page               myInstances / findInstanceByBusinessKey
 * cancel   DELETE /bpm/process-instance/cancel-by-start-user body { id: <流程实例 id>, reason }
 * ```
 *
 * **`cancel` 的 id 不是 `submit` 的返回值。** `create` 返回的是**业务单据 id**
 * （`CommonResult<Long>`，`GeneralApprovalDO.id`）；`cancel-by-start-user` 要的是
 * **流程实例 id**（`BpmProcessInstanceCancelReqVO.id`）。而
 * `GET /hr/general-approval/get` 的响应 VO **里没有 `processInstanceId` 字段**
 * （只有 id / 申请事项 / 申请内容 / 附件 / 状态）——所以拿不到。
 *
 * ⇒ 唯一的通路是「我的流程」列表：`GET /bpm/process-instance/my-page` 的每行有
 * `id`（流程实例 id）与 `businessKey`（= 业务单据 id 的字符串），按
 * `businessKey` 对上就是它。`findInstanceByBusinessKey()` 就是这一步。**这不是绕路，
 * 是页面上真实发生的路径**：`flow/task/my/list.vue` 的 `actionCancel(record.id)`
 * 里的 `record.id` 正是 my-page 那一行的 `id`。
 *
 * ---------------------------------------------------------------------------
 * 六、module-type：一个都不发（与浏览器一致）
 * ---------------------------------------------------------------------------
 *
 * `/simple/hr/form/035`、`/dashboard/flow/form/edit`、`/dashboard/flow/task/my/list`
 * 三条路径在 `generated/module-type-rules.json` 的 27 条规则里**一条都匹配不到**，
 * 所以 `resolveModuleType()` 返回 null、SDK 不发这个头。浏览器在表单页上同样不发
 * （抓包实测：`getTemporaryRequiredStartUserSelectTasks` 的请求头里没有 `module-type`）。
 *
 * 这与 conventions 第 2 条一致：算不出就不发，是**忠实**，不是缺陷。
 *
 * ---------------------------------------------------------------------------
 * 七、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **附件上传本身不在这里。** 本能力收的是 `[{url, name}]`，url 要用
 *   `base-upload-file`（目录选 `HR/approval`，与本表单的
 *   `ossFilePathOptions.hr.approval` 同一个）先传上去。上传那一步是基础能力的地盘，
 *   见 `docs/base/上传.md`。
 *   这条链**已经端到端验证过**（2026-09-20 补课）：真传一个 CSV → 当附件提交 →
 *   回读 `detail().attachments` 的 url/name 与提交的逐字段一致 → 撤销 → 签名 DELETE
 *   删掉对象 → 匿名 GET 403。记录见 `docs/pages/通用审批.md` §六.3。
 * - **「查看审批流程」预览**（`portal-hxr-flow-process-preview`，打
 *   `/bpm/process-instance/preview`）没做：它是**只读的展示件**，不影响能不能提交。
 * - **「重新发起」（reapply）没做**：`isReapply` 分支会从原流程实例抄抄送人再提交，
 *   是一条**另起的写链路**，需要单独验证。
 * - **`PUT /hr/general-approval/update` 与 `DELETE /hr/general-approval/delete/{id}` 没做**：
 *   后端限定「只有已驳回状态（status=3）」才能改/删（`GeneralApprovalServiceImpl`
 *   的 `updateApplication` / `deleteApplication` 各有一条状态判断）。页面上的编辑分支
 *   **前端已经注释掉了**（`035` 的 `handleSubmit` 里 `isEditMode` 那三行是注释，
 *   `apiSubmit` 写死成 `/create`），所以**页面上根本走不到这两个入口**。
 *   要造一条"已驳回"的单据得先让真人去驳回——那是第三方的动作，本轮做不到，
 *   所以这两条既没实现也没法验。实现一个页面上不存在、又验证不了的写操作，
 *   不叫"完整"，叫"多做了没验过的东西"。
 */

// ---------------------------------------------------------------------------
// 页面与流程标识
// ---------------------------------------------------------------------------

/** 流程表单的入口路由（与会议室那条线同一个壳）。流程定义、我的流程列表都挂在这一页的上下文里 */
export const GENERAL_APPROVAL_PAGE_PATH = '/dashboard/flow/form/edit'

/**
 * 表单本身的路径。**字段与校验都属于它**，所以 prepare / submit / detail
 * 声明在这个页面上下文里。
 *
 * 取值来自 `GET /bpm/process-definition/create-list` 的 `formCustomCreatePath`
 * （**只有这个接口给**，`/get` 里是 null）——【实测】返回 `simple/hr/form/035`。
 */
export const GENERAL_APPROVAL_FORM_PATH = '/simple/hr/form/035'

/**
 * 「我的流程」页。**取消流程的入口在这里**，不在表单页。
 *
 * ⚠️ 这一页与表单页一样**不在 `page-catalog.json` 里**（流程类页面走「发起流程」到达，
 * 不进菜单树），所以它不会把任何页面的完成度判成已完成。
 * 反过来，**不要**把任何能力挂到 `/dashboard/flow/task/create/list`（「发起流程」）——
 * 那一条**在**目录里，会把那个页面错误地标成已完成。
 */
export const GENERAL_APPROVAL_MY_LIST_PATH = '/dashboard/flow/task/my/list'

/** 流程定义 Key。实测自表单入口 URL 与 `GeneralApprovalServiceImpl.PROCESS_KEY` */
export const GENERAL_APPROVAL_PROCESS_KEY = 'hr_general_approval'

/** 「我的流程」列表里认出本流程的那一行：`processDefinitionKey` */
export const GENERAL_APPROVAL_PROCESS_TYPE = 2

// ---------------------------------------------------------------------------
// 字段约束（逐条抄自 035 的表单规则与模板属性）
// ---------------------------------------------------------------------------

/** `a-input` 的 `:maxlength="200"` + `formRules.applicationItem` 的 `max: 200`（后端 `@Size(max = 200)`） */
export const APPLICATION_ITEM_MAX = 200
/** `a-textarea` 的 `:maxlength="500"` + `formRules.applicationContent` 的 `max: 500`（后端 `@Size(max = 500)`） */
export const APPLICATION_CONTENT_MAX = 500
/** `common-upload-dragger` 的 `:maxCount="10"`；后端不限条数，但页面到 10 就禁用 */
export const ATTACHMENT_MAX_COUNT = 10
/** `beforeFileUpload` 的 50MB 上限（**本地无法校验**：SDK 手上只有 url 与 name） */
export const ATTACHMENT_MAX_SIZE_MB = 50

/**
 * 附件扩展名白名单，逐条抄自 `035` 模板里 `common-upload-dragger` 的 `accept`
 * 与 `useAppUpload` 的 `accept`（两处一致）：
 * `.pdf, .jpg, .jpeg, .png, .doc, .docx, .xls, .xlsx, .csv, .ppt, .pptx`。
 *
 * ⚠️ **比 `base-upload-file` 的 `SAFE_EXTENSIONS` 窄**：上传能力收的是"能安全拼进
 * objectKey 的扩展名"，这里收的是"这个表单收哪几种文件"。两者**不是一回事**，
 * 谁也不要抄谁。
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
  /** ⚠️ 实测 5 个 key 里**一次都没出现过**，不要以为它有值（`docs/process-forms.md` §3.4） */
  startUserSelectTasks?: Array<{ id: string; name: string }> | null
  [key: string]: unknown
}

/** 表单里的一件附件。**形状就是页面 `formState.attachments` 的元素**：只有 url 与 name */
export type GeneralApprovalAttachment = {
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
 * **没有 `id` 字段**——与会议室那条线不同：`buildGeneralApprovalSubmitData()` 里
 * 一个 `id` 都不拼（编辑分支在前端是注释掉的）。
 */
export type GeneralApprovalDraft = {
  /** 申请事项，必填，≤200 字 */
  applicationItem: string
  /** 申请内容，必填，≤500 字 */
  applicationContent: string
  /** 附件，可选，≤10 件。url 要用 base-upload-file 先传（目录 `HR/approval`） */
  attachments?: GeneralApprovalAttachment[]
  /**
   * 抄送人用户 id，可选。
   * ⚠️ 这些人会**真的收到抄送通知**——测试时留空数组。
   */
  copyUserIds?: number[]
}

/**
 * 一个「发起人自选」审批人节点。字段逐条对应后端 `UserTaskDTO`【实测】。
 *
 * `minSelectCount` / `maxSelectCount` 是本流程唯一一条硬规则的来源：
 * 后端 `isSelectionCountValid()` 会按它校验人数。
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

/** `{ [节点 id]: [用户 id, ...] }`。与会议室那条线同一形状（`common/libs/flow-form/index.js:292`） */
export type StartUserSelectAssignees = Record<string, number[]>

/** 通用审批单据（`GET /hr/general-approval/get` 的响应） */
export type GeneralApprovalRecord = {
  id: number
  applicationItem?: string
  applicationContent?: string
  attachments?: GeneralApprovalAttachment[]
  /** 0=待提交，1=审批中，2=已审批，3=已驳回，4=已取消 */
  status?: number
  statusName?: string
  /**
   * ⚠️ **这个字段不存在**。`GeneralApprovalRespVO` 里没有 `processInstanceId`
   * （虽然 `GeneralApprovalDO` 有）。要流程实例 id 请走 `findInstanceByBusinessKey()`。
   * 留在这里是为了让"查不到"这件事有一个显式的落点，而不是让调用方以为漏读了。
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
  /** 1 = 审批中（页面上「取消流程」按钮出现的条件） */
  status?: number
  /** 业务单据 id 的字符串形式（后端 `setBusinessKey(String.valueOf(application.getId()))`） */
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

export type GeneralApprovalInstanceQuery = {
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

// ---------------------------------------------------------------------------
// 本地校验 / 载荷构造
// ---------------------------------------------------------------------------

function assertText (value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}必填（页面表单规则 required，后端 @NotBlank）`)
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
 * - 扩展名：页面的 `accept` 白名单 → SDK 也拦（按 `name` 判；**没有扩展名时放行**，
 *   因为页面上传的文件未必都带名字）。
 * - **50MB 大小上限不拦**：SDK 手上只有 url 与 name（`buildGeneralApprovalSubmitData`
 *   会把别的字段全丢掉），**没有任何办法算出大小**。与其猜，不如把这条如实留给后端。
 */
export function assertAttachments (attachments: unknown): GeneralApprovalAttachment[] {
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
    // 与 buildGeneralApprovalSubmitData 一致：只保留 url 与 name，别的字段一律丢掉
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
      throw new Error(`copyUserIds[${index}] 不是数字：${JSON.stringify(id)}。用户 id 要用 general-approval-user-search 查`)
    }
    return value
  })
}

/**
 * 构造提交载荷。**逐字段复刻 `buildGeneralApprovalSubmitData()`**，包括键的书写顺序
 * ——D20 要求与浏览器逐字段一致，键顺序不同也算不一致。
 *
 * 基准（真实浏览器抓包，`baseline/general-approval.browser.json`）：
 *
 * ```json
 * {"applicationItem":"SDK-TEST-baseline","applicationContent":"SDK-TEST-baseline content",
 *  "attachments":[],"copyUserIds":[]}
 * ```
 *
 * 键顺序就是 `applicationItem → applicationContent → attachments → copyUserIds`；
 * `startUserSelectAssignees` **不在这里**——它是 `handleSubmit` 最后
 * `{...submitData, startUserSelectAssignees}` 那个展开加上的，所以永远排在最后，
 * 由 `buildGeneralApprovalCreatePayload()` 补。
 */
export function buildGeneralApprovalPayload (draft: GeneralApprovalDraft): Record<string, unknown> {
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
 * 表单的 `isGeneralApprovalDataComplete(formState)`：两个必填字段都非空才允许去问审批人节点。
 *
 * 页面在 `refreshApprovalTasks()` 里用它做前置——不满足就 `bpmResetStartUserSelectTasks()`
 * （**不发请求**）。SDK 的 `prepare()` 复刻这条：与其发一个后端根本不看的请求，
 * 不如按页面的行为直接告诉调用方"先把这两个字段填了"。
 *
 * 顺带说明为什么这个前置在**后端**看是多余的：`getRequiredStartUserSelectTasks`
 * 的实现把请求体整个忽略掉，只按流程 key 算节点（`GeneralApprovalServiceImpl:154-157`）。
 * 所以这条纯粹是**页面的行为**，SDK 跟着页面走。
 */
export function assertDataComplete (state: { applicationItem?: unknown; applicationContent?: unknown }): void {
  const complete = (value: unknown): boolean =>
    typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined
  if (!complete(state?.applicationItem) || !complete(state?.applicationContent)) {
    throw new Error(
      '「申请事项」与「申请内容」都填了才能问审批人节点（页面的 isGeneralApprovalDataComplete）。' +
        '两个字段本身就是必填，先把它们填上。',
    )
  }
}

/**
 * 把 `prepare()` 拿到的节点与调用方给的审批人**按后端那四条规则**先校一遍。
 *
 * 复刻 `BpmProcessInstanceServiceImpl.validateStartUserSelectAssignees`（后端源码直读）：
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
          `请用 general-approval-user-search 查人，再把 { "${task.id}": [userId] } 传给 submit。`,
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
 * `035` 的 `handleSubmit`（`startUserSelectAssignees` **永远在最后**）。
 */
export function buildGeneralApprovalCreatePayload (
  draft: GeneralApprovalDraft,
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
    ...buildGeneralApprovalPayload(draft),
    startUserSelectAssignees: normalized,
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

/** 人员候选：**必须先给关键字**（设计 D6 / H35）。与会议室那条线同一处保护 */
const USER_SEARCH_PARAM: ParamSpec = {
  name: 'keyword',
  kind: 'search',
  required: true,
  description:
    '姓名等关键字。候选是**该租户全量 4225 人**（实测），页面自己用 ' +
    '`simple-page?pageNo=1&pageSize=500` 无关键字拉 —— 无头下禁止照抄（设计 D6 / H35）',
}

const USER_LOOKUP = { capabilityId: 'general-approval-user-search', keywordParam: 'keyword' } as const

const DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'applicationItem',
    kind: 'text',
    required: true,
    description: `申请事项，必填，最多 ${APPLICATION_ITEM_MAX} 字（页面 a-input :maxlength + 后端 @Size）`,
  },
  {
    name: 'applicationContent',
    kind: 'text',
    required: true,
    description: `申请内容，必填，最多 ${APPLICATION_CONTENT_MAX} 字（页面 a-textarea + 后端 @Size）`,
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
      `⚠️ 页面的 ${ATTACHMENT_MAX_SIZE_MB}MB 单件上限 SDK 校验不了（拿不到字节数）`,
  },
]

export const generalApprovalCapabilities: CapabilityDefinition[] = [
  {
    id: 'general-approval-definition',
    title: '查询通用审批的流程定义',
    pagePath: GENERAL_APPROVAL_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'key',
        kind: 'enum',
        required: true,
        description: `流程定义 Key，本流程固定为 ${GENERAL_APPROVAL_PROCESS_KEY}`,
        options: [{ label: '通用审批', value: GENERAL_APPROVAL_PROCESS_KEY }],
      },
    ],
  },
  {
    id: 'general-approval-user-search',
    title: '按关键字搜索抄送人 / 审批人候选',
    pagePath: GENERAL_APPROVAL_FORM_PATH,
    write: false,
    params: [
      USER_SEARCH_PARAM,
      { name: 'deptId', kind: 'tree', required: false, description: '限定部门 id' },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，默认 20；不允许 -1（全量）' },
    ],
  },
  {
    id: 'general-approval-prepare',
    title: '提交前准备：算出这次需要人工指定哪些审批人节点',
    pagePath: GENERAL_APPROVAL_FORM_PATH,
    write: false,
    params: DRAFT_PARAMS,
  },
  {
    id: 'general-approval-submit',
    title: '提交通用审批（会真的发起流程、给审批人推待办）',
    pagePath: GENERAL_APPROVAL_FORM_PATH,
    write: true,
    params: [
      ...DRAFT_PARAMS,
      {
        name: 'startUserSelectAssignees',
        kind: 'search',
        required: true,
        description:
          '{ [节点 id]: [用户 id, ...] }。节点 id 来自 general-approval-prepare；' +
          '人要先按关键字查（候选几千个）。本流程实测有 1 个节点 `发起人自选2`，至少选 1 人，' +
          '且**顺序有意义**（依次审批）。漏了会被后端以「发起人自选审批人不能为空」拒绝',
        lookup: USER_LOOKUP,
      },
    ],
  },
  {
    id: 'general-approval-detail',
    title: '查询单条通用审批单据',
    pagePath: GENERAL_APPROVAL_FORM_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '**业务单据 id**（submit 的返回值）。⚠️ 这个响应里**没有流程实例 id** —— ' +
          '要取消得先 general-approval-my-instances 按 businessKey 找流程实例',
      },
    ],
  },
  {
    id: 'general-approval-my-instances',
    title: '查我发起的流程实例（「我的流程」列表）',
    pagePath: GENERAL_APPROVAL_MY_LIST_PATH,
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
    id: 'general-approval-cancel',
    title: '取消（撤回）我发起的通用审批流程',
    pagePath: GENERAL_APPROVAL_MY_LIST_PATH,
    write: true,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: false,
        description:
          '**流程实例 id**（不是业务单据 id）。二选一：与 businessKey 至少给一个。' +
          '来自 general-approval-my-instances 那一行的 id',
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

export type GeneralApprovalOptions = {
  /** 找流程实例时最多翻几页（每页 `pageSize` 条）。给上限是免得为了一条记录把整个列表翻完 */
  maxScanPages?: number
  /** 找流程实例时每页取多少条 */
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 5
const DEFAULT_SCAN_PAGE_SIZE = 50

export function createGeneralApprovalCapability (
  request: PortalRequest,
  options: GeneralApprovalOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /** 分页查我发起的流程实例。「我的流程」页用的是这个接口 */
  const myInstances = (
    query: GeneralApprovalInstanceQuery = {},
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
   * `GET /hr/general-approval/get` 的响应里**没有** `processInstanceId`（见
   * `GeneralApprovalRecord.processInstanceId` 的说明）。唯一的通路就是翻「我的流程」，
   * 用 `businessKey` 对上——这也正是页面上点「取消流程」时拿的那个 `record.id`。
   *
   * 翻页有上限（默认 5 页 × 50 条）。找不到时**抛错而不是返回 null**：
   * 调用方拿到 null 下一步就会去 cancel 一个 undefined，报出来的错会更难懂。
   *
   * **为什么在客户端按 `processDefinitionKey` 再筛一道**：`businessKey` 是**各业务表
   * 自己的主键**（后端 `setBusinessKey(String.valueOf(application.getId()))`），
   * 所以「通用审批 51」与「会议室预定 51」会撞成同一个字符串。只按 businessKey 匹配
   * 会认错单子。⚠️ 注意**不用 `processType` 过滤**：会议室与通用审批都是 `processType=2`，
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
          // 有的返回行不带 processDefinitionKey，那就只能按 businessKey 认（如实放行，
          // 不去猜一个"肯定不是它"的结论）
          (row.processDefinitionKey === undefined ||
            row.processDefinitionKey === GENERAL_APPROVAL_PROCESS_KEY),
      )
      if (hit) return hit
      if (list.length < scanPageSize) break
    }
    throw new Error(
      `在「我的流程」里翻到第 ${maxScanPages} 页也没找到 businessKey=${wanted} 的通用审批流程实例。` +
        '可能的原因：它不是当前账号发起的、或者已经被删掉了。' +
        '也可以直接调 general-approval-my-instances 自己按条件找。',
    )
  }

  return {
    /** 流程定义（只读）。⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见文件头 */
    definition (key: string = GENERAL_APPROVAL_PROCESS_KEY): Promise<ProcessDefinition> {
      return request<ProcessDefinition>({
        url: '/bpm/process-definition/get',
        method: 'get',
        params: { key },
      })
    },

    /**
     * 按关键字搜索抄送人 / 审批人候选。**只读**。
     *
     * 页面自己无关键字拉 500 条（实测），这里强制要关键字——
     * 与 `meeting-application.searchUsers` 同一套保护（设计 D6 / H35）。
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
     * 与页面 `handleSubmit()` 的第一步一致。**本流程实测返回 1 个节点**
     * （`发起人自选2`，`minSelectCount: 1`、`selectionOrderRequired: true`）——
     * 这是会议室那条线从没走到过的那条路径。
     *
     * 返回的 `payload` 就是 `create` 会发的业务字段（不含 assignees），
     * 便于调用方在真提交之前先看一眼。
     */
    async prepare (draft: GeneralApprovalDraft): Promise<{
      payload: Record<string, unknown>
      tasks: StartUserSelectTask[]
    }> {
      // 页面的 refreshApprovalTasks() 在数据不全时**不发请求**，SDK 照做
      assertDataComplete(draft ?? {})
      const payload = buildGeneralApprovalPayload(draft)
      const tasks = await request<StartUserSelectTask[]>({
        url: '/hr/general-approval/getTemporaryRequiredStartUserSelectTasks',
        method: 'post',
        data: payload,
      })
      return { payload, tasks: Array.isArray(tasks) ? tasks : [] }
    },

    /**
     * 真正提交（**写操作**）：创建单据**并起一条 `hr_general_approval` 审批流**。
     *
     * ⚠️ 它会**给真人推待办、可能发短信**。测试请：
     *   1. 标题/内容带 `SDK-TEST-` 前缀；
     *   2. `copyUserIds` 传 `[]`（抄送会真的通知到人）；
     *   3. 测完立刻用 `cancel()` 撤掉。
     *
     * 调用方必须先走 `prepare()`，把返回的 `tasks` 交给用户选定后以
     * `{ [task.id]: [userId, ...] }` 传进来。**本流程至少要有 1 个人**，
     * 后端 `validateStartUserSelectAssignees` 强校验（缺了报
     * `PROCESS_INSTANCE_START_USER_SELECT_ASSIGNEES_NOT_CONFIG`）。
     *
     * `assertAssigneesForTasks()` 是配套的本地预检——提交前拿 `prepare` 的 tasks
     * 过一遍，能让必然失败的写请求**不发出去**。
     *
     * 返回**业务单据 id**（后端 `CommonResult<Long>`）。⚠️ 这不是流程实例 id，
     * 撤销要先用 `findInstanceByBusinessKey()` 换。
     */
    async submit (
      draft: GeneralApprovalDraft,
      startUserSelectAssignees: StartUserSelectAssignees = {},
    ): Promise<unknown> {
      // async 不是为了 await：本地校验失败要变成 **rejected promise**，
      // 否则调用方 try/catch 包 await 会漏掉同步抛出（与会议室那条线一致）。
      return request({
        url: '/hr/general-approval/create',
        method: 'post',
        data: buildGeneralApprovalCreatePayload(draft, startUserSelectAssignees),
      })
    },

    /** 单条单据详情（**只读**）。⚠️ 响应里没有流程实例 id，见 `GeneralApprovalRecord` */
    async detail (id: number | string): Promise<GeneralApprovalRecord> {
      describeId(id, '通用审批单据 id')
      return request<GeneralApprovalRecord>({
        url: '/hr/general-approval/get',
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
     * `reason` 必填：后端 `@NotEmpty`。页面的弹窗虽然把空串也发出去，但那样后端会
     * 报「取消原因不能为空」——SDK 不照抄那个必然失败的输入。
     *
     * 只有 `status === 1`（审批中）的单据能取消（页面上按钮的出现条件）。
     * 已经走完/已驳回的再取消，后端会如实报错「流程取消失败，流程不处于运行中」，
     * SDK 不做预检查、也不吞错。
     *
     * ⚠️ **一个实测踩到的坑：审批人选成"发起人自己"时，流程会当场走完，于是永远撤不掉。**
     * 后端有一条「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl:913-916`，
     * 理由文案就是这句）。2026-09-20 第一次跑真实提交时选了本人，`create` 返回成功后
     * 流程直接进终态，`cancel` 报的就是上面那句。**这不是 cancel 的缺陷，是它的正确行为**——
     * 但调用方（尤其是做测试的）必须先知道：`submit` 的审批人要选**别人**。
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
                'processInstanceId 来自 general-approval-my-instances，' +
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

export type GeneralApprovalCapability = ReturnType<typeof createGeneralApprovalCapability>

/**
 * 组装点（`src/index.ts` / `src/server.ts`）在能力之上加的那一层。
 *
 * 与会议室那条线同样的分工：`withIdempotency` 需要**身份**（租户 / 用户），
 * 那是会话层的东西，所以包装放在组装点，能力模块只声明形状。
 */
export type GeneralApprovalCapabilityWithIdempotency = GeneralApprovalCapability & {
  /**
   * 带短窗口防重的提交（设计 D12）。参数比 `submit` 多一个 `requestId`。
   *
   * **为什么这条最需要防重**：后端零幂等，重发一次就是**第二条流程实例 + 第二串
   * 真人待办**（不同于建一条脏数据的普通 CRUD）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  submitIdempotent: (
    params: GeneralApprovalDraft & {
      requestId: string
      startUserSelectAssignees?: StartUserSelectAssignees
    },
  ) => Promise<unknown>
}
