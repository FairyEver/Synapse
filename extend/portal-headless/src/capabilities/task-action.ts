import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * **办理待办** —— SDK 的审批侧（本包最大的一个横切缺口）。
 *
 * 前面五条流程线（通用审批 / 请假 / 用车 / 差旅费 / 产品设计文档审核）做的都是**发起侧**：
 * 提交一条单据、把待办推给别人。**别人提交给我们的单据，SDK 一条都办不了**——
 * 于是那些线只有半条闭环。本文件补的就是另一半。
 *
 * ---------------------------------------------------------------------------
 * 一、这条能力是「横切」的：它与流程无关，只与**任务**有关
 * ---------------------------------------------------------------------------
 *
 * 会议室那条线以后端 controller 为界分能力；流程表单那条线以表单字段为界分能力。
 * 这一条**两者都不是**：它操作的对象是 Flowable 的 **task**（待办任务），
 * 入口是 `/bpm/task/**` 与 `/bpm/process-instance/**`——**对 82 个流程一视同仁**。
 *
 * 所以这里**一个流程字段都没有**：参数只有 `taskId` / 审批意见 / 附件 / 抄送人 / 接收人。
 * 谁的单子、什么表单、字段长什么样，全都不进这份契约。
 *
 * 【实测，2026-09-21】页面上真正发出这些请求的地方只有两处：
 *
 * | 页面 | 路由文件 | 提供哪些动作 |
 * | --- | --- | --- |
 * | 流程详情（办理）`/dashboard/flow/form/detail` | `flow/form/detail/index.vue:499-539` | 通过 / 不通过 / 转办 / 委派 / 回退 |
 * | 批量办理 `/dashboard/backlog/task-examine/batch-process` | `backlog/task-examine/batch-process/index.vue:219-264` | 批量通过 / 批量不通过 |
 *
 * ---------------------------------------------------------------------------
 * 二、为什么**不**做 `/bpm/hr/task/approve`（待办事项页那个「办理」弹窗）
 * ---------------------------------------------------------------------------
 *
 * 「待办事项」页的办理弹窗（`backlog/components/agreement-examine.vue:44-46`）
 * 打的是 `POST /bpm/hr/task/approve`（或 `/reject`），body `{id, reason, type}`。
 * **那不是一条通用的接口**，理由在后端源码里（`erp-module-hr` 的
 * `BpmHrTaskServiceImpl.approveTask/rejectTask`）：
 *
 * - `type == null` 时它**原样转调**通用的 `bpmTaskApi.approveTask`（即本文件的
 *   `PUT /bpm/task/approve`）——多绕一层，不多做一件事。
 * - `type != null` 时它做的是**KPI 协议族专属**的事：按 1/2/3/4/5/6 把
 *   `kpi_year_protocol` / `kpi_month_protocol` / `kpi_month_protocol_task` 的状态回写、
 *   插薪资基础数据、锁评分流程、给签订人**发消息**。
 *
 * ⇒ 把 `type` 开成参数，等于把「KPI 协议族」这个**具体流程族**的枚举写进一条声称通用的能力里，
 * 正好违反「契约要通用」；而且它动的是真人的 KPI 与薪资数据，误用的代价比通用审批大得多。
 * 所以这里只做通用那一条。**KPI 协议族（category 2..7）的办理没有做**，
 * 这是明确的取舍，不是遗漏——见文件末尾「尚未覆盖」。
 *
 * ---------------------------------------------------------------------------
 * 三、⚠️ 后端只让你办「分配给你的」任务（这是本能力的天然边界，不是 SDK 的限制）
 * ---------------------------------------------------------------------------
 *
 * `BpmTaskServiceImpl.validateTask()`（`BpmTaskServiceImpl.java:876-883`）：
 *
 * ```java
 * if (!Objects.equals(userId, NumberUtils.parseLong(task.getAssignee()))) {
 *     throw exception(ErrorCodeConstants.TASK_OPERATE_FAIL_ASSIGN_NOT_SELF);
 * }
 * ```
 *
 * `/bpm/task/approve|reject|transfer|delegate|return|create-sign` **每一个**都先过它。
 * ⇒ SDK **没有办法**去办别人的待办；能办到的就是「我的待办」，这与页面完全一致。
 *
 * ---------------------------------------------------------------------------
 * 四、⚠️ 自审规则：**自己提交、审批人填自己 = 流程秒完、单据撤不掉**
 * ---------------------------------------------------------------------------
 *
 * `BpmTaskEventListener.taskCreated()`（`:85-94`）的两条分支**都会**走到
 * `tryAutoApproveWhenStartUserIsAssignee()`（`BpmTaskServiceImpl:886-916`）：
 *
 * ```java
 * if (startUserId == null || !startUserId.equals(taskAssigneeId)) return false;
 * autoApproveReqVO.setReason("流程发起人与审批人相同，自动审核通过");
 * ```
 *
 * 也就是说：**任何「发起人 = 审批人」的任务都会被后端当场自动通过**，
 * 留下的流程实例进终态，`cancel-by-start-user` 必然报「流程不处于运行中」——
 * 这条测试单据就永远撤不掉了（2026-09-20 已实测踩过一次）。
 *
 * 唯一的逃生口是流程变量 `BPM_SKIP_AUTO_APPROVE_TASK_DEFINITION_KEY`
 * （`shouldSkipAutoApprove()` 命中一次后自删）。**但客户端注入不了流程变量**：
 * 五个流程的 `startBpmProcess()` 各自 `new HashMap<>()` 或由服务端 builder 构造，
 * 全仓 `.setVariables(` 没有一处吃调用方给的 map。
 *
 * ⇒ **结论（本轮实测 + 源码双向确认）：只用一个测试账号，造不出一条「留给自己办」的待办。**
 * 想端到端验证办理链路，需要**第二个测试账号**来发起（审批人填本账号）。
 * 这条限制不属于 SDK，属于后端的设计；本文件如实记录，不绕。
 *
 * ---------------------------------------------------------------------------
 * 五、防重（设计 D12 / 约定第 14 条）
 * ---------------------------------------------------------------------------
 *
 * **后端的 `/bpm/task/**` 全部零幂等**：重发一次就是第二次 `taskService.complete()`。
 * 更糟的是失败形态——第一次其实成功了、第二次返回 `TASK_NOT_EXISTS`（任务已不再是
 * running），**调用方会把「成功」读成「失败」然后继续重试**。
 * 所以本文件的**每一个写操作**都配一个 `*Idempotent` 变体（`requestId` 参与，
 * `target` 取 `taskId`）——比五条流程线「只包 submit」更宽，因为这里每个动作都是终局判定。
 * 包法与判据见 `src/idempotency/writer.ts`；接线在组装点（本文件只声明形状）。
 *
 * ---------------------------------------------------------------------------
 * 六、页面的三条读：办理页是怎么算出「有哪些任务该我办」的
 * ---------------------------------------------------------------------------
 *
 * `flow/form/detail/index.vue` 挂载时打三个读，`loadRunningTask()`（`:439-461`）
 * 用后两条的结果算出「我的待办任务」，再据此渲染「通过 / 不通过」按钮：
 *
 * ```
 * GET /bpm/process-instance/get?id=                  → 流程实例（流程名 / 发起人 / 表单路径）
 * GET /bpm/process-instance/getWorkflowPath?processInstanceId=  → 审批链路（树）
 * GET /system/user/simple-list                       → 抄送人候选（**全量**，见下）
 * ```
 *
 * `loadRunningTask` 的三条判据（**逐条复刻在 `myRunningTasks()` 里**）：
 * 1. `task.status !== 1 && task.status !== 6` 跳过（1=审批中，6=委派中）；
 * 2. `!task.assigneeUser || String(task.assigneeUser.id) !== String(userId)` 跳过；
 * 3. 递归 `children`（子任务是加签产生的，同样要判）。
 *
 * ⚠️ 第 3 条读在本文件里**没有照抄**：页面用 `GET /system/user/simple-list`
 * **无参数拉全量**（实测该租户 4000+ 人）。无头下禁止照抄（设计 D6 / H35），
 * 转办/委派/抄送的人选一律走 `general-approval-user-search`（`/system/user/simple-page`
 * + 强制关键字）。这是**刻意偏离浏览器的一处**，理由与会议室那条线的 `searchUsers` 相同。
 *
 * ---------------------------------------------------------------------------
 * 七、尚未覆盖（如实列出，不要读成「已完成」）
 * ---------------------------------------------------------------------------
 *
 * - **加签 / 减签（`PUT /bpm/task/create-sign`、`DELETE /bpm/task/delete-sign`）没做。**
 *   后端有（`BpmTaskController:258-269`），但**前端一个调用点都没有**（全仓 grep
 *   `create-sign` / `delete-sign` 命中 0 处），页面上用户到不了这两个入口。
 *   按仓库纪律（不实现页面上不存在、又验证不了的东西），不做。
 * - **KPI 协议族（category 2..7）的办理没做**，理由见第二节。
 * - **`POST /bpm/hr/task/update-assignee` 没做**：同样没有前端调用点，且它要求
 *   `assignee == 我`（`BpmHrTaskServiceImpl.checkTask()`），与 `transfer` 覆盖面重叠。
 * - **写链路没有端到端跑过**（原因见第四节）：本文件里的写请求形状**全部来自前端源码**
 *   （两处行号写在上面），没有一次真实请求佐证。**不要把「形状对」读成「已验证」**。
 */

// ---------------------------------------------------------------------------
// 页面与常量
// ---------------------------------------------------------------------------

/** 流程详情（办理）页。通过 / 不通过 / 转办 / 委派 / 回退都从这一页发出 */
export const TASK_ACTION_DETAIL_PAGE_PATH = '/dashboard/flow/form/detail'

/** 批量办理页。批量通过 / 批量不通过在它上面（`batch-process/index.vue`） */
export const TASK_ACTION_BATCH_PAGE_PATH = '/dashboard/backlog/task-examine/batch-process'

/** 「我的流程」页。`currentUserId()` 借它推身份（页面上是 pinia 的 `userStore.state.id`，没有对应接口） */
export const TASK_ACTION_MY_LIST_PAGE_PATH = '/dashboard/flow/task/my/list'

/**
 * 任务状态（后端 `BpmTaskStatusEnum`，`erp-module-bpm` 的 `enums/task`）。
 *
 * **0 是「待审批」不是「审批中」**——0 只出现在加签产生的、还没轮到它的任务上，
 * 页面判「该我办」时把它排除在外（`status !== 1 && status !== 6` 就跳过）。
 */
export const TASK_STATUS = {
  WAIT: 0,
  RUNNING: 1,
  APPROVE: 2,
  REJECT: 3,
  CANCEL: 4,
  RETURN: 5,
  DELEGATE: 6,
  APPROVING: 7,
} as const

/** 批量办理里页面写死的任务类型（`batch-process/index.vue` 的 `buildPayload`：`type: 0`） */
export const BATCH_TASK_TYPE = 0

/**
 * 页面在单个办理里**恒定发满**的五个键的缺省值（`flow/form/detail/index.vue:503-509`）。
 *
 * 页面上的 `auditForms[index]` 初值就是 `{ reason: '', copyUserIds: [], attachmentUrl: '', attachmentName: '' }`，
 * 所以**没传附件时它发的是空串，不是省略这个键**。照抄这一点，请求才与浏览器逐字段一致（D20）。
 */
export const EMPTY_ATTACHMENT_URL = ''
export const EMPTY_ATTACHMENT_NAME = ''

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 「我的流程」里的一行（`GET /bpm/process-instance/my-page`），取本能力用得上的字段 */
export type MyInstanceRow = {
  id: string
  name?: string
  title?: string
  status?: number
  businessKey?: string
  processDefinitionKey?: string
  startUser?: { id?: number; nickname?: string; [key: string]: unknown }
  [key: string]: unknown
}

/** `GET /bpm/process-instance/get` 的响应，只列本能力用得上的字段 */
export type ProcessInstanceDetail = {
  id?: string
  name?: string
  status?: number
  businessKey?: string
  startUser?: { id?: number | string; nickname?: string; [key: string]: unknown }
  processDefinition?: { key?: string; name?: string; formType?: number; [key: string]: unknown }
  /** ⚠️ 恒为 null：流程实例的响应里拿不到表单字段（`formFields: null`，见 `docs/process-forms.md` §3.4） */
  formFields?: never
  [key: string]: unknown
}

/**
 * 审批链路上的一个任务节点（`GET /bpm/process-instance/getWorkflowPath` 的树）。
 *
 * 加签会产生 `children`，页面**递归**处理它们（`loadRunningTask`），所以这里也留着。
 */
export type WorkflowTask = {
  /** **任务 id**。办理类动作的 `taskId` 就是它 */
  id: string
  name?: string
  /** 见 `TASK_STATUS`。1=审批中 6=委派中 才是「该我办」 */
  status?: number
  taskDefinitionKey?: string
  assigneeUser?: { id?: number | string; nickname?: string; [key: string]: unknown } | null
  children?: WorkflowTask[] | null
  [key: string]: unknown
}

/** 可回退的节点（`GET /bpm/task/list-by-return`）：后端只回 `name` 与 `taskDefinitionKey` */
export type ReturnTarget = {
  name?: string
  /** 回退时 `targetTaskDefinitionKey` 要的就是它（后端把 UserTask 的 id 放进这个字段） */
  taskDefinitionKey?: string
  [key: string]: unknown
}

/** 一件附件。**形状与流程表单那条线一致**：只有 url 与 name */
export type TaskAttachment = { url: string; name: string; [key: string]: unknown }

/** 办理（通过 / 不通过）的参数。**五个键与页面一一对应**，一个不多一个不少 */
export type TaskAuditParams = {
  /**
   * **任务 id**（= 请求体里的 `id`）。来自待办列表那一行的 `id`
   * （`backlog-task-examine-list`），或 `myRunningTasks()` 返回的 `id`。
   */
  taskId: string | number
  /** 审批意见。不通过时页面强制非空（前端 `message.error('审批意见不能为空')`） */
  reason?: string
  /** 附件地址。页面没传时发**空串**（不是省略），照抄 */
  attachmentUrl?: string
  /** 附件名称。同上 */
  attachmentName?: string
  /**
   * 抄送人用户 id 数组。**这些人会真的收到抄送**，测试留空。
   * ⚠️ 人选必须先按关键字查（设计 D6 / H35）
   */
  copyUserIds?: Array<number | string>
}

/** 批量办理的参数 */
export type TaskBatchAuditParams = {
  /** 任务 id 数组，**至少一个**（后端 `@NotEmpty`） */
  taskIds: Array<string | number>
  reason?: string
  /** 附件：页面上是多选上传，提交时把 url / name 各自用 `,` 拼成一个字符串 */
  attachments?: TaskAttachment[]
  /** 抄送人。批量页面上限 10 人（`handleCopyUserChange` 截断），SDK 也拦 */
  copyUserIds?: Array<number | string>
}

/** 转办（`PUT /bpm/task/transfer`）：换一个**新的处理人**，我从此不再持有这个任务 */
export type TaskTransferParams = {
  taskId: string | number
  /** 新审批人的用户 id。页面是下拉选人，**必填**（formRules required） */
  assigneeUserId: number | string
  /** 转派理由。**必填**（formRules required） */
  reason: string
}

/** 委派（`PUT /bpm/task/delegate`）：交给别人先看，**看完还会回到我这里**（与转办不同） */
export type TaskDelegateParams = {
  taskId: string | number
  /** 接收人用户 id。必填 */
  delegateUserId: number | string
  /** 委派理由。必填 */
  reason: string
}

/** 回退（`PUT /bpm/task/return`）：把流程退回它前面的某个节点 */
export type TaskReturnParams = {
  taskId: string | number
  /** 回退到的节点 Key。取值来自 `returnOptions()`（后端把 UserTask 的 id 放在 `taskDefinitionKey`） */
  targetTaskDefinitionKey: string
  /** 回退意见。必填 */
  reason: string
}

export type SimpleUser = { id: number; nickname?: string; code?: string; [key: string]: unknown }

/** 批量页面上限：抄送人最多 10 人（`handleCopyUserChange` 把数组截断到 10） */
export const BATCH_MAX_COPY_USERS = 10

// ---------------------------------------------------------------------------
// 本地校验与载荷构造
// ---------------------------------------------------------------------------

/** 把 task id 归一成非空字符串。空 id 发出去只会换回一个难懂的 404 */
export function normalizeTaskId (id: number | string | null | undefined, field = 'taskId'): string {
  const value = typeof id === 'string' ? id.trim() : id === null || id === undefined ? '' : String(id).trim()
  if (value === '') {
    throw new Error(
      `${field} 不能为空。任务 id 来自待办列表（backlog-task-examine-list 那一行的 id）或 myRunningTasks()；` +
        '它是个字符串（Flowable 的任务 id），不是业务单据 id、也不是流程实例 id。',
    )
  }
  return value
}

/** 用户 id 数组归一成数字数组（页面的 select 给的就是数字） */
export function normalizeUserIds (value: unknown, field: string): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error(`${field} 必须是用户 id 数组（页面上是多选人员控件）`)
  }
  return value.map((raw, index) => {
    const id = Number(raw)
    if (!Number.isFinite(id)) {
      throw new Error(`${field}[${index}] 不是数字：${JSON.stringify(raw)}。用户 id 要用 general-approval-user-search 查`)
    }
    return id
  })
}

/**
 * 通过 / 不通过共用的一份载荷：**逐字段、逐顺序复刻 `handleAudit()` 里的 `data`**
 * （`flow/form/detail/index.vue:503-509`），键顺序 `id → reason → attachmentUrl → attachmentName → copyUserIds`。
 *
 * ⚠️ 两个附件键**即便为空也发**：页面的 `auditForms` 初值就是空串。
 * "省掉空值"看起来更干净，但那样请求与浏览器不逐字段一致（D20）。
 */
export function buildAuditPayload (
  params: TaskAuditParams,
  options: { requireReason: boolean; label: string },
): Record<string, unknown> {
  const id = normalizeTaskId(params?.taskId)
  const reason = typeof params?.reason === 'string' ? params.reason : ''
  if (options.requireReason && reason.trim() === '') {
    throw new Error(
      `${options.label}的审批意见不能为空（页面上是 message.error('${options.label}建议不能为空')，` +
        '后端 BpmTaskRejectReqVO.reason 是 @NotNull）。空串会换回一个业务 500，不如在本地就红。',
    )
  }
  return {
    id,
    reason,
    attachmentUrl: typeof params?.attachmentUrl === 'string' ? params.attachmentUrl : EMPTY_ATTACHMENT_URL,
    attachmentName: typeof params?.attachmentName === 'string' ? params.attachmentName : EMPTY_ATTACHMENT_NAME,
    copyUserIds: normalizeUserIds(params?.copyUserIds, 'copyUserIds'),
  }
}

/** `PUT /bpm/task/approve` 的 body。**通过时页面允许空意见**（后端把空串换成「无」） */
export function buildApprovePayload (params: TaskAuditParams): Record<string, unknown> {
  return buildAuditPayload(params, { requireReason: false, label: '通过' })
}

/** `PUT /bpm/task/reject` 的 body。**不通过必须给理由** */
export function buildRejectPayload (params: TaskAuditParams): Record<string, unknown> {
  return buildAuditPayload(params, { requireReason: true, label: '不通过' })
}

/**
 * 批量办理的 body：复刻 `batch-process/index.vue` 的
 * `{...buildPayload(), copyUserIds, variables?}`，其中
 * `buildPayload()` = `{ ids, reason, type: 0, attachmentUrl, attachmentName }`。
 *
 * 附件是**两个逗号拼接的字符串**（不是数组）——这是页面 `attachments.map(...).join(',')`
 * 的行为，别按单个办理那种 `{url,name}` 的形状去传。
 */
export function buildBatchAuditPayload (
  params: TaskBatchAuditParams,
  options: { withVariables: boolean; requireReason: boolean },
): Record<string, unknown> {
  const rawIds = params?.taskIds
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error('taskIds 至少要有一个（后端 BpmTaskBatchApproveReqVO.ids 是 @NotEmpty）')
  }
  const ids = rawIds.map((id, index) => normalizeTaskId(id, `taskIds[${index}]`))
  const reason = typeof params?.reason === 'string' ? params.reason : ''
  if (options.requireReason && reason.trim() === '') {
    throw new Error('批量不通过必须给审批意见（页面 message.error("审批建议不能为空")，后端 reason 是 @NotNull）')
  }
  const attachments = params?.attachments ?? []
  if (!Array.isArray(attachments)) {
    throw new Error('attachments 必须是数组（页面上是多选上传，提交时各自用 , 拼成一个字符串）')
  }
  const copyUserIds = normalizeUserIds(params?.copyUserIds, 'copyUserIds')
  if (copyUserIds.length > BATCH_MAX_COPY_USERS) {
    throw new Error(`抄送人最多 ${BATCH_MAX_COPY_USERS} 人，收到 ${copyUserIds.length} 人（页面 handleCopyUserChange 会截断到 10）`)
  }
  const payload: Record<string, unknown> = {
    ids,
    reason,
    type: BATCH_TASK_TYPE,
    attachmentUrl: attachments.map((item) => String(item?.url ?? '')).join(','),
    attachmentName: attachments.map((item) => String(item?.name ?? '')).join(','),
    copyUserIds,
  }
  // `variables` 只有批量**通过**才发（页面的 `batchApprove` 分支多一个 `variables: {}`）
  if (options.withVariables) payload.variables = {}
  return payload
}

/** 转办 / 委派 / 回退三个动作的载荷构造。三者形状一样：`{ id, <目标>, reason }`，都是必填 */
export function buildAssigneeChangePayload (
  params: { taskId: string | number; reason: string },
  field: string,
  value: number | string,
): Record<string, unknown> {
  const id = normalizeTaskId(params?.taskId)
  const reason = typeof params?.reason === 'string' ? params.reason.trim() : ''
  if (reason === '') {
    throw new Error('理由必填（页面的 formRules 是 required，后端 BpmTaskTransferReqVO/BpmTaskDelegateReqVO.reason 是 @NotEmpty）')
  }
  const target = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim()
  if (target === '') {
    throw new Error(`${field} 不能为空（页面的 formRules 是 required，后端是 @NotNull / @NotEmpty）`)
  }
  return { id, [field]: field === 'assigneeUserId' || field === 'delegateUserId' ? Number(target) : target, reason }
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

/** 人员候选：**必须先给关键字**（设计 D6 / H35）。与通用审批那条线共用同一个查询能力 */
const USER_LOOKUP = { capabilityId: 'general-approval-user-search', keywordParam: 'keyword' } as const

const TASK_ID_PARAM: ParamSpec = {
  name: 'taskId',
  kind: 'text',
  required: true,
  description:
    '**任务 id**（请求体里的 `id`）。来自待办列表 backlog-task-examine-list 那一行的 `id`，' +
    '或 task-action-workflow-path 里 `assigneeUser.id` 是我的那个任务的 `id`。' +
    '⚠️ 它既不是业务单据 id、也不是流程实例 id——后端按 `task.assignee == 我` 校验，别人的任务一律拒绝',
}

const REASON_PARAM: ParamSpec = {
  name: 'reason',
  kind: 'text',
  required: false,
  description: '审批意见（页面上是必填的文本域，≤500 字）。后端把空串替换成「无」',
}

const COPY_USER_PARAM: ParamSpec = {
  name: 'copyUserIds',
  kind: 'search',
  required: false,
  description:
    '抄送人用户 id 数组。⚠️ 这些人会**真的收到抄送**，测试留空。' +
    '页面自己用 `GET /system/user/simple-list` 无参数拉全量，无头下禁止照抄（D6/H35），必须先按关键字查',
  lookup: USER_LOOKUP,
}

const ATTACHMENT_PARAMS: ParamSpec[] = [
  {
    name: 'attachmentUrl',
    kind: 'text',
    required: false,
    description:
      '附件地址。页面**没传时发空串**（不是省略这个键），SDK 照抄。' +
      'url 要用 base-upload-file 先传到 OSS（本页面的目录是 HR/approval）',
  },
  {
    name: 'attachmentName',
    kind: 'text',
    required: false,
    description: '附件名称，与 attachmentUrl 成对。同上，默认发空串',
  },
]

export const taskActionCapabilities: CapabilityDefinition[] = [
  {
    id: 'task-action-instance',
    title: '读流程实例（办理页的头部信息）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: true,
        description: '**流程实例 id**。待办列表那一行的 `processInstance.id` 就是它',
      },
    ],
  },
  {
    id: 'task-action-workflow-path',
    title: '读审批链路（找出「该我办」的任务 id）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: false,
    params: [
      {
        name: 'processInstanceId',
        kind: 'text',
        required: true,
        description:
          '**流程实例 id**。返回的是一棵任务树（加签会产生 children）；' +
          '`status` 为 1（审批中）或 6（委派中）、且 `assigneeUser.id` 是我的那些节点，才是能办的任务',
      },
    ],
  },
  {
    id: 'task-action-approve',
    title: '审批通过（办理待办）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: true,
    params: [TASK_ID_PARAM, REASON_PARAM, ...ATTACHMENT_PARAMS, COPY_USER_PARAM],
  },
  {
    id: 'task-action-reject',
    title: '审批不通过（驳回待办）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: true,
    params: [
      TASK_ID_PARAM,
      { ...REASON_PARAM, required: true, description: '驳回意见，**必填**（页面与后端都拦空）' },
      ...ATTACHMENT_PARAMS,
      COPY_USER_PARAM,
    ],
  },
  {
    id: 'task-action-transfer',
    title: '转办（换一个处理人，我从此不再持有这个任务）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: true,
    params: [
      TASK_ID_PARAM,
      {
        name: 'assigneeUserId',
        kind: 'search',
        required: true,
        description: '新审批人的用户 id，必填。⚠️ 会**真的**把待办推给这个人',
        lookup: USER_LOOKUP,
      },
      { name: 'reason', kind: 'text', required: true, description: '转派理由，必填（页面与后端都拦空）' },
    ],
  },
  {
    id: 'task-action-delegate',
    title: '委派（交给别人先看，办完还会回到我这里）',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: true,
    params: [
      TASK_ID_PARAM,
      {
        name: 'delegateUserId',
        kind: 'search',
        required: true,
        description: '接收人的用户 id，必填。⚠️ 会**真的**把待办推给这个人',
        lookup: USER_LOOKUP,
      },
      { name: 'reason', kind: 'text', required: true, description: '委派理由，必填' },
    ],
  },
  {
    id: 'task-action-return-options',
    title: '查这个任务能回退到哪些节点',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: false,
    params: [TASK_ID_PARAM],
  },
  {
    id: 'task-action-return',
    title: '回退任务到前面的节点',
    pagePath: TASK_ACTION_DETAIL_PAGE_PATH,
    write: true,
    params: [
      TASK_ID_PARAM,
      {
        name: 'targetTaskDefinitionKey',
        kind: 'enum',
        required: true,
        description:
          '回退到的节点 Key，取值来自 task-action-return-options 返回的 `taskDefinitionKey`' +
          '（后端把 BPMN 里 UserTask 的 id 放在这个字段里）。**没有可回退节点时不要硬给**',
      },
      { name: 'reason', kind: 'text', required: true, description: '回退意见，必填' },
    ],
  },
  {
    id: 'task-action-batch-approve',
    title: '批量审批通过',
    pagePath: TASK_ACTION_BATCH_PAGE_PATH,
    write: true,
    params: [
      {
        name: 'taskIds',
        kind: 'text',
        required: true,
        description: '任务 id 数组，至少一个。批量页面上只有勾选的、且 category 为 null 或 8 的行才允许被勾',
      },
      REASON_PARAM,
      {
        name: 'attachments',
        kind: 'text',
        required: false,
        description: '附件数组 `[{url, name}]`，最多 10 件。⚠️ 提交时会被拼成两个逗号分隔的字符串（页面的 join）',
      },
      { ...COPY_USER_PARAM, description: `${COPY_USER_PARAM.description}；批量页面上限 ${BATCH_MAX_COPY_USERS} 人` },
    ],
  },
  {
    id: 'task-action-batch-reject',
    title: '批量审批不通过',
    pagePath: TASK_ACTION_BATCH_PAGE_PATH,
    write: true,
    params: [
      {
        name: 'taskIds',
        kind: 'text',
        required: true,
        description: '任务 id 数组，至少一个',
      },
      { ...REASON_PARAM, required: true, description: '批量驳回意见，**必填**' },
      {
        name: 'attachments',
        kind: 'text',
        required: false,
        description: '附件数组 `[{url, name}]`，最多 10 件',
      },
      { ...COPY_USER_PARAM, description: `${COPY_USER_PARAM.description}；批量页面上限 ${BATCH_MAX_COPY_USERS} 人` },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type TaskActionOptions = {
  /** 推身份时最多翻几页「我的流程」 */
  maxScanPages?: number
  scanPageSize?: number
}

const DEFAULT_MAX_SCAN_PAGES = 3
const DEFAULT_SCAN_PAGE_SIZE = 20

/** 递归展开 `children`（页面的 `loadRunningTask` 也是递归的：加签产生的子任务同样可能在等我） */
function flattenTasks (tasks: readonly WorkflowTask[] | null | undefined): WorkflowTask[] {
  const out: WorkflowTask[] = []
  for (const task of tasks ?? []) {
    if (!task) continue
    out.push(task)
    if (Array.isArray(task.children) && task.children.length > 0) {
      out.push(...flattenTasks(task.children))
    }
  }
  return out
}

/**
 * `request` 是**办理页**的请求函数，`batchRequest` 是**批量办理页**的。
 * 两页的 module-type 都算不出（27 条规则一条都没命中）、http 实例都落到全局默认的
 * `platform.js`，所以结果一样；但**页面上下文仍然是逐页的输入**（约定第 1 条），
 * 不为"反正一样"就共用一处。
 */
export function createTaskActionCapability (
  request: PortalRequest,
  batchRequest: PortalRequest = request,
  options: TaskActionOptions = {},
) {
  const maxScanPages = options.maxScanPages ?? DEFAULT_MAX_SCAN_PAGES
  const scanPageSize = options.scanPageSize ?? DEFAULT_SCAN_PAGE_SIZE

  /** 只读的审批链路（树 → 展平）。`myRunningTasks` 与对外暴露的 `workflowPath` 共用它 */
  async function fetchWorkflowTasks (processInstanceId: string | number): Promise<WorkflowTask[]> {
    const id = normalizeTaskId(processInstanceId, 'processInstanceId')
    const data = await request<WorkflowTask[]>({
      url: '/bpm/process-instance/getWorkflowPath',
      method: 'get',
      params: { processInstanceId: id },
    })
    // 页面 `getTaskList()` 先丢掉顶层 status === 4（已取消）的节点，再往下递归
    const top = (Array.isArray(data) ? data : []).filter((task) => task?.status !== TASK_STATUS.CANCEL)
    return flattenTasks(top)
  }

  return {
    /**
     * 流程实例（只读）。办理页挂载时打的第一个读。
     * ⚠️ 它**不返回表单字段**（`formFields` 恒为 null），见 `docs/process-forms.md` §3.4。
     */
    instance (processInstanceId: string | number): Promise<ProcessInstanceDetail> {
      const id = normalizeTaskId(processInstanceId, 'processInstanceId')
      return request<ProcessInstanceDetail>({
        url: '/bpm/process-instance/get',
        method: 'get',
        params: { id },
      })
    },

    /**
     * 审批链路（只读）。**办理页就是靠它算出「有哪些任务该我办」的。**
     *
     * 返回的是一棵**任务树**（加签会产生 `children`），本方法把它**原样**给你，
     * 不做过滤——页面的过滤逻辑在 `myRunningTasks()` 里逐条复刻。
     */
    workflowPath: fetchWorkflowTasks,

    /**
     * 调 `workflowPath()`，再按页面的 `loadRunningTask()` 三条判据筛出**该我办**的任务。
     *
     * | 页面判据 | 这里 |
     * | --- | --- |
     * | `task.status !== 1 && task.status !== 6` 跳过 | ✅（1=审批中，6=委派中） |
     * | `!task.assigneeUser \|\| String(task.assigneeUser.id) !== String(userId)` 跳过 | ✅ |
     * | 递归 `children` | ✅（在 `workflowPath()` 里已经展平） |
     *
     * `userId` 必须由调用方给：页面上它来自 pinia 的 `userStore.state.id`，
     * **没有任何接口返回「我是谁」**。SDK 侧的替代来源见 `currentUserId()`。
     */
    async myRunningTasks (
      processInstanceId: string | number,
      userId: number | string,
    ): Promise<WorkflowTask[]> {
      const wanted = String(userId ?? '').trim()
      if (wanted === '') {
        return Promise.reject(new Error('userId 不能为空：页面用它比对 task.assigneeUser.id，给不出就等于不筛'))
      }
      const tasks = await fetchWorkflowTasks(processInstanceId)
      return tasks.filter(
        (task) =>
          (task.status === TASK_STATUS.RUNNING || task.status === TASK_STATUS.DELEGATE) &&
          task.assigneeUser !== null &&
          task.assigneeUser !== undefined &&
          String(task.assigneeUser.id) === wanted,
      )
    },

    /**
     * 当前登录用户 id（**推断，不是接口**）。
     *
     * `GET /system/user/profile/get` 在这个 token 上报 500（实测），而「我的流程」
     * 每一行的 `startUser.id` 是响应里真有的——最近一条的发起人就是我自己。
     * 这与 `smoke/general-approval.mjs` 的 `currentUserId()` 是同一个推法。
     *
     * ⚠️ **它是推断**：账号一条流程都没发起过时返回 `undefined`。
     * 返回 `undefined` 时**不要**拿它去比 `assigneeUser.id`——会一条都筛不出来。
     */
    async currentUserId (): Promise<number | undefined> {
      for (let page = 1; page <= maxScanPages; page += 1) {
        const result = await request<{ list?: MyInstanceRow[] }>({
          url: '/bpm/process-instance/my-page',
          method: 'get',
          params: {
            order: '',
            orderField: '',
            name: '',
            title: '',
            category: '',
            pageNo: page,
            pageSize: scanPageSize,
          },
        })
        // 后端按时间倒序，第一条的发起人就是我
        const id = result?.list?.[0]?.startUser?.id
        if (typeof id === 'number') return id
        if ((result?.list ?? []).length < scanPageSize) break
      }
      return undefined
    },

    /**
     * 按关键字搜人（转办 / 委派 / 抄送人的候选）。**只读**。
     *
     * 与 `general-approval-user-search` 打的是同一个接口、同一套保护
     * （`/system/user/simple-page` + 强制关键字 + 拒绝 `pageSize=-1`）。
     * 页面在**这两处**自己都是无关键字拉全量（`GET /system/user/simple-list`），
     * 无头下不照抄——理由见文件头第六节。
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
            '转办 / 委派 / 抄送人属于长选项参数：必须提供 keyword 或 deptId，不允许无条件下全量拉取（设计 D6）',
          ),
        )
      }
      if (query.pageSize === -1) {
        return Promise.reject(new Error('不允许 pageSize = -1（全量拉取）；请用关键字 + 分页（设计 D6）'))
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
     * **审批通过（写操作）** `PUT /bpm/task/approve`。
     *
     * ⚠️ 后果：任务被 `complete()`，流程往下走，**下一个人真的会收到待办**。
     * 后端只允许办**分配给我**的任务（`validateTask`），别人的一律
     * `TASK_OPERATE_FAIL_ASSIGN_NOT_SELF`。
     *
     * 通过时 `reason` **可以是空串**（页面允许，后端替换成「无」）。
     * 本地校验失败走 rejected promise，**一个请求都不发**。
     */
    async approve (params: TaskAuditParams): Promise<unknown> {
      return request({
        url: '/bpm/task/approve',
        method: 'put',
        data: buildApprovePayload(params),
      })
    },

    /**
     * **审批不通过（写操作）** `PUT /bpm/task/reject`。
     *
     * `reason` **必填**：页面上空意见会被 `message.error` 挡住，后端
     * `BpmTaskRejectReqVO.reason` 是 `@NotNull`（空串能过 @NotNull 但没有意义）。
     * 驳回后流程按 BPMN 的走向结束或退回，单据状态由监听器异步回写。
     */
    async reject (params: TaskAuditParams): Promise<unknown> {
      return request({
        url: '/bpm/task/reject',
        method: 'put',
        data: buildRejectPayload(params),
      })
    },

    /**
     * **转办（写操作）** `PUT /bpm/task/transfer`：换一个新的处理人，**我从此不再持有它**。
     * 与 `delegate` 的区别：委派是"你先看，看完还回来"，转办是"这活儿归你了"。
     */
    async transfer (params: TaskTransferParams): Promise<unknown> {
      return request({
        url: '/bpm/task/transfer',
        method: 'put',
        data: buildAssigneeChangePayload(params, 'assigneeUserId', params?.assigneeUserId),
      })
    },

    /** **委派（写操作）** `PUT /bpm/task/delegate`：交给别人先看，处理完**回到我这里** */
    async delegate (params: TaskDelegateParams): Promise<unknown> {
      return request({
        url: '/bpm/task/delegate',
        method: 'put',
        data: buildAssigneeChangePayload(params, 'delegateUserId', params?.delegateUserId),
      })
    },

    /**
     * 可回退的节点（**只读**）`GET /bpm/task/list-by-return`。
     *
     * 页面上点「回退」时先打它；返回**空数组**时页面提示「当前没有可回退的节点」
     * 并且**不开弹窗**——SDK 不做这个判断，把数组如实给你。
     */
    async returnOptions (taskId: string | number): Promise<ReturnTarget[]> {
      const id = normalizeTaskId(taskId)
      const data = await request<ReturnTarget[]>({
        url: '/bpm/task/list-by-return',
        method: 'get',
        params: { id },
      })
      return Array.isArray(data) ? data : []
    },

    /**
     * **回退（写操作）** `PUT /bpm/task/return`：把流程退回它前面的某个节点。
     *
     * 对应「流程详情」页的「回退」按钮。`targetTaskDefinitionKey` 必须是
     * `returnOptions()` 真返回过的值——页面上它是一个下拉，给不出别的。
     */
    async returnTask (params: TaskReturnParams): Promise<unknown> {
      return request({
        url: '/bpm/task/return',
        method: 'put',
        data: buildAssigneeChangePayload(params, 'targetTaskDefinitionKey', params?.targetTaskDefinitionKey),
      })
    },

    /**
     * **批量通过（写操作）** `PUT /bpm/task/batchApprove`（页面路径在
     * `/dashboard/backlog/task-examine/batch-process`）。
     *
     * body = `{ids, reason, type: 0, attachmentUrl, attachmentName, copyUserIds, variables: {}}`，
     * `type: 0` 与 `variables: {}` 都是**页面写死的**（`batch-process/index.vue:219-249`），照抄。
     */
    async batchApprove (params: TaskBatchAuditParams): Promise<unknown> {
      return batchRequest({
        url: '/bpm/task/batchApprove',
        method: 'put',
        data: buildBatchAuditPayload(params, { withVariables: true, requireReason: false }),
      })
    },

    /** **批量不通过（写操作）** `PUT /bpm/task/batchReject`。比批量通过少一个 `variables` */
    async batchReject (params: TaskBatchAuditParams): Promise<unknown> {
      return batchRequest({
        url: '/bpm/task/batchReject',
        method: 'put',
        data: buildBatchAuditPayload(params, { withVariables: false, requireReason: true }),
      })
    },
  }
}

export type TaskActionCapability = ReturnType<typeof createTaskActionCapability>

/**
 * 组装点在能力之上加的那一层（与五条流程线同样的分工：`withIdempotency` 要身份，
 * 那是会话层的东西，所以包装放在组装点）。
 *
 * **为什么这里七个写操作全都要包**（而五条流程线只包 `submit`）：
 * `/bpm/task/**` 全部零幂等，且失败形态最坏——第一次其实成功了，
 * 超时重发第二次会拿到 `TASK_NOT_EXISTS`（任务已不是 running），
 * 调用方把它读成失败、继续重试。`target` 取 `taskId`（/ `taskIds`），
 * 这样"同一个任务上的同一个动作"才是同一个键。
 */
export type TaskActionCapabilityWithIdempotency = TaskActionCapability & {
  approveIdempotent: (params: TaskAuditParams & { requestId: string }) => Promise<unknown>
  rejectIdempotent: (params: TaskAuditParams & { requestId: string }) => Promise<unknown>
  transferIdempotent: (params: TaskTransferParams & { requestId: string }) => Promise<unknown>
  delegateIdempotent: (params: TaskDelegateParams & { requestId: string }) => Promise<unknown>
  returnIdempotent: (params: TaskReturnParams & { requestId: string }) => Promise<unknown>
  batchApproveIdempotent: (params: TaskBatchAuditParams & { requestId: string }) => Promise<unknown>
  batchRejectIdempotent: (params: TaskBatchAuditParams & { requestId: string }) => Promise<unknown>
}
