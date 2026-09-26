import { Buffer } from 'node:buffer'

import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from '../session/types.js'
import type { PortalRequestConfig } from '../http/client.js'
import { assertDateTime, type PageResult } from './backlog-task-examine.js'

/**
 * 审批管理域「流程治理」那四页 —— 流程模型（双赢协议）/ AI审核配置 / 流程实例 / 流程任务。
 *
 * | 页面 | 菜单路径 | 路由文件 | 形态 |
 * | --- | --- | --- | --- |
 * | 流程模型 双赢协议 | `/dashboard/flow/old/model/list` | `…/hr/flow/old/model/list.vue` | **声明式**列表页（`getDataListURL`） |
 * | AI审核配置 | `/dashboard/flow/ai-review-config/list` | `…/hr/flow/ai-review-config/list.vue` | 列表页（`customLoad`） |
 * | 流程实例 | `/dashboard/flow/process-instance/manager/list` | `…/hr/flow/process-instance/manager/list.vue` | 列表页（`customLoad`） |
 * | 流程任务 | `/dashboard/flow/task/manager/list` | `…/hr/flow/task/manager/list.vue` | 列表页（`customLoad`） |
 *
 * 与 `src/capabilities/flow-task.ts`（发起流程 / 待办 / 已办 / 抄送我的）的分界是**使用者**：
 * 这四页是**管理员/流程治理**视角（看所有人的实例与任务、配模型与审核规则），
 * 那四页是**经办人**视角（我发起的、我的待办）。**两者没有一个接口重叠。**
 *
 * ## 基准对照（`baseline/flow-management.browser.json`，2026-09-21 抓）
 *
 * | 页面 | 基准里那条（列表请求） | 结论 |
 * | --- | --- | --- |
 * | 流程模型 | `?order=&orderField=&key=&name=&category=&pageNo=1&limit=20&_t=` | **逐字节一致**（`limit` 得到确认） |
 * | AI审核配置 | `?pageNo=1&pageSize=20&_t=` | **逐字节一致**（`order=`/`orderField=` **确实一个都不在**） |
 * | 流程实例 | `?order=&orderField=&name=&title=&pageNo=1&pageSize=20&_t=` | **逐字节一致** |
 * | 流程任务 | `?order=&orderField=&name=&pageNo=1&pageSize=20&_t=` | **逐字节一致** |
 *
 * 8 条请求的请求头都与契约一致：`{tenant-id, token, Accept-Language, Accept}` ——
 * **没有 `module-type`**（与目录里这 8 条的 `moduleType: null` 吻合，约定第 2 条）。
 *
 * 基准里**没有带时间区间的请求**（四页都是默认区间即空），所以本文件第 4 条那套
 * 「按天归边」的区间语义是**从源码读出来的、基准没有复核到**。
 *
 * ⚠️ 基准里有三条**页面挂载时的候选全量拉**，本 SDK **刻意不照抄**（D6 / H35）：
 * `/bpm/category/simple-list`（无参）、`/sys/tip-template/list`（无参）、
 * `/bpm/process-definition/list?suspensionState=1`（无参）；
 * 流程实例页那九条 `/system/user/simple-page?pageNo=1..9&pageSize=500`（**最多 4500 人**）
 * 更典型。它们都只用于**本地**把 id 换成名称，本文件一律不提供 —— 返回里给 id，
 * 由调用方自己挑候选入口（见下「与已建成能力的关系」）。
 *
 * ⚠️ 另有一处**本地检出与部署版本的漂移**：本地 `process-instance/manager/list.vue:217`
 * 写的是 `/system/user/simple-list`，而基准（部署版本）打的是 `/system/user/simple-page`
 * （分页 9 次 × 500）。两者都是"全量拉人员"，**结论不变**（不照抄），
 * 但引用接口名时**以基准为准**。
 *
 * ## 参数顺序是从源码推出来的，不是抄基准
 *
 * 顺序全部按 `common/libs/renren/list.js:473-483` 推导（基准用来复核，见上）：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * ```
 *
 * ⇒ 顺序恒为 `order → orderField → 表单字段 → pageNo → pageSize → _t`。
 * 四页都没有 `order`/`orderField` 控件，钉死成空串、不开放。
 *
 * ## 本文件四个"同域不同形"，是这一批最容易写错的地方
 *
 * | # | 坑 | 在哪页 | 无筛选时的 URL |
 * | --- | --- | --- | --- |
 * | 1 | **空值照发**（`order=` `key=` 都在） | 流程模型 | `order=&orderField=&key=&name=&category=&pageNo=1&limit=20` |
 * | 2 | **空值整个丢掉** | **AI审核配置** | `pageNo=1&pageSize=20`（**连 `order=` 都没了**） |
 * | 3 | **分页参数名是 `limit` 不是 `pageSize`** | **流程模型** | 见上 |
 * | 4 | **时间区间归到"当日 00:00:00 / 23:59:59"** | 流程实例 / 流程任务 | 与"结束日 +1 天"**不是一回事** |
 *
 * 逐条说清楚：
 *
 * 1. **流程模型**没有任何 `convertFetchForm`，`form` 的三个字段永远是空串，**照发**。
 *
 * 2. **AI审核配置**的 `customLoad` 是 `getAiReviewConfigPage(normalizeSearchParams(params))`，
 *    而 `normalizeSearchParams` = `api.js:101-113` 的 `removeEmptyParams`：把 `''` / `null` /
 *    `undefined` / **空数组**全部滤掉。这里**连 `order` / `orderField` 也一起被滤掉**——
 *    它们恒为空串。所以没填筛选时 URL 上**只剩分页**。
 *    （这与 `study-statistics.ts` 的 `dropEmptyParams` 是同一类页面，与上面第 1 条相反。）
 *
 * 3. **流程模型**显式写了 `fieldNamePageSize: 'limit'`（`list.vue:90`），覆盖掉全局默认的
 *    `pageSize`（`app/portal/main.js:48`）。**接口参数名就是 `limit`，本能力也照实叫 `limit`**，
 *    与 `study-teacher.ts` 对 `.lay` 接口的处理同一个口径（那边是 `page` / `limit`）。
 *
 * 4. **流程实例 / 流程任务**两页的 `customLoad` 都调 `formatCreateTimeRange()`，
 *    实现是 `dayjs(item).startOf('day')` 与 `dayjs(item).endOf('day')`，格式化成
 *    `YYYY-MM-DD HH:mm:ss` —— 也就是**闭区间、按天归边**：
 *    起点当日 `00:00:00`、终点当日 `23:59:59`。
 *    ⚠️ 这与学习管理域那几页的「**结束日 +1 天**开区间」**结果不同**（那边终点是次日零点）。
 *    两者都能"含住结束日"，但**是两套写法、两套 helper**，不要互相照抄。
 *
 * ## 「空值照发」与「空值丢掉」为什么不是随便定的
 *
 * 唯一的判据是**那一页的源码怎么写的**，不是"哪样更好看"：
 * 流程模型的 `form` 里三个字段恒为 `''` 且没有 `convertFetchForm` ⇒ 空串进 qs ⇒ `key=`；
 * AI审核配置的 `customLoad` 明写了 `removeEmptyParams` ⇒ 空串被滤掉 ⇒ 键消失。
 * 少发/多发一个键都会让请求与浏览器不逐字段一致（约定第 4 条）。
 *
 * ## 与已建成能力的关系（避免调用方猜该用哪个）
 *
 * | 这一页做的事 | 已经有谁 | 结论 |
 * | --- | --- | --- |
 * | 我**发起**的流程（`/bpm/process-instance/my-page`） | `general-approval-my-instances` / `leave-application-my-instances` / `overtime-…` / `business-trip-…` / `rest-leave-…` / `vehicle-…` / `product-design-…` / `travel-expense-…` | **不重复建**。那八个是各流程表单线的"我的流程"只读能力，接口同一个；本文件的**流程实例页看的是所有人**、走的是另一个接口 `manager-page`（`…/process-instance/manager/list` 的 `form` 里有"发起人"选择器，页面列里还有"发起部门"），**不冲突** |
 * | 单个流程实例详情 | `task-action-instance`（`GET /bpm/process-instance/get`） | **不重复建**。流程实例页的「详情」跳的是流程表单详情页（`goFlowFormDetailByInstanceId`），不是再打一个接口 |
 * | 抄送 / 待办 / 已办 | `flow-task.ts` 那四个 + `backlog-task-examine-list` | 不重叠（不同接口） |
 * | 流程分类候选（`/bpm/category/simple-list`） | 流程实例页挂载时**无参全量拉** | **不照抄**（D6 / H35）。分类码是平台字典 `bpm_model_category` 的一员，要候选请用 `base-dict-get` 传 `dictType='bpm_model_category'`（**不是 base-dict-search**，那个要的是 dictType 的名字关键字） |
 * | 人员候选（基准里是 `/system/user/simple-page` × 9 页 × 500） | 流程实例页挂载时**全量翻页拉** | **不照抄**（D6 / H35）。`startUserId` 要的是用户 id，用 `base-user-search`（强制要关键字） |
 * | 流程定义候选（`/bpm/process-definition/list`） | AI审核配置页挂载时拉 `suspensionState=1` 的全量 | 这是**小枚举**、不是几千人的长选项，但本文件仍然**不建**它：`flow-task-create-definitions` 已经给出「可发起的流程定义」，而 AI审核配置要的是"全部启用中的定义"，两者严格说不是一回事 —— 见下 |
 * | 审核模板候选（`/sys/tip-template/list`） | 无 | 同上，不建 |
 *
 * **明确记一笔没覆盖的**：AI审核配置页左侧那两个下拉（流程定义 / AI Skill 模板）与
 * 编辑表单里的 AI 模型候选，各自打一个**无参全量**列表接口
 * （`/bpm/process-definition/list`、`/sys/tip-template/list`、`/manager/aiModelConfig/getAvailableList`）。
 * 它们都不是筛选参数、只用于**本地**映射 id → 名称（`list.vue` 的 `tipTemplateNameMap`），
 * 所以本能力**不提供**；表格里返回的是原始 id。SDK 的取舍是：
 * **宁可在返回里给 id，也不为了好看去拉全表**（D6 / H35）。
 * 调用方要 id → 名称的映射，请自己挑一个候选入口（这三条都还没有对应的能力，留待后续）。
 *
 * ⚠️ 另一处**同名不同接口**、容易混的：`flow-task.ts` 打的是
 * `/bpm/hr/task/list-by-category-web`（待办/已办），本文件流程任务页打的是
 * `/bpm/task/manager-page`（**全公司**的任务流水）。两条接口都在 `bpm` 下、名字都像"任务列表"，
 * 别拿一个的结果去对另一个的字段。
 *
 * ## 写操作与权限核对
 *
 * 本模块现在覆盖 Portal 这四页实际可达的写入口。权限边界按页面菜单权限保留：
 * 四个 Java controller 均没有 `@PreAuthorize` 方法注解，Portal 也没有单独的按钮权限
 * 指令；因此 SDK 不虚构接口级权限码，调用上下文仍然绑定到对应页面的 `permission`。
 * 流程实例取消另有 Portal 的 `record.status === 1` 门槛，SDK 的准备阶段要求调用方提供
 * 列表最新状态并校验为 1；服务端仍会再次校验真实流程状态。
 *
 * | 页面 | 写入口 | Portal 请求 | 校验/顺序 |
 * | --- | --- | --- | --- |
 * | 流程模型 | 部署 / 激活停用 / 编辑 / 删除 / 分配规则 | `POST /bpm/hr/model/deploy` body `{id}`；`PUT /bpm/hr/model/update-state` body `{id,state}`；`DELETE /bpm/hr/model/delete/{id}`；规则新增 `POST /bpm/hr/task-assign-rule/create`、更新 `PUT /bpm/hr/task-assign-rule/update` | 状态只允许 1/2，且不能提交当前状态；规则表单走 `prepare → submit → cancel` |
 * | AI审核配置 | 创建 / 更新 / 删除 | `POST /bpm/ai-review-config/create`；`PUT …/update`；`DELETE …/delete?id=` | 必填、Java DTO 的长度限制、`modelConfigId=null` 保留；表单走 `prepare → submit → cancel` |
 * | 流程实例 | 管理员取消流程 | `DELETE /bpm/process-instance/cancel-by-admin` body `{id,reason}` | 仅列表 `status === 1` 可准备；原因 trim 后非空 |
 * | 流程任务 | 历史详情 | 没有写请求 | 不发明能力；页面只有跳转详情的历史入口 |
 *
 * 这里没有真实环境写冒烟：当前任务禁止启动浏览器/服务器，写请求只用 Portal/Java
 * 源码证据和请求契约测试锁定；测试环境的真实权限/业务状态仍由主线程按 `prepare → submit → cancel`
 * 流程另行验证。
 */

export const FLOW_MANAGE_MODEL_PAGE_PATH = '/dashboard/flow/old/model/list'
export const FLOW_MANAGE_AI_REVIEW_PAGE_PATH = '/dashboard/flow/ai-review-config/list'
export const FLOW_MANAGE_INSTANCE_PAGE_PATH = '/dashboard/flow/process-instance/manager/list'
export const FLOW_MANAGE_TASK_PAGE_PATH = '/dashboard/flow/task/manager/list'

export const FLOW_MANAGE_MODEL_PERMISSION = '/dashboard/flow/old/model/list'
export const FLOW_MANAGE_AI_REVIEW_PERMISSION = '/dashboard/flow/ai-review-config'
export const FLOW_MANAGE_INSTANCE_PERMISSION = '/dashboard/frame/bpm/manager/process-instance/manager'
export const FLOW_MANAGE_TASK_PERMISSION = '/dashboard/frame/bpm/manager/process-tasnk'

const VIEWS = 'app/portal/views/dashboard/hr/flow'
const TASK_ASSIGN_RULE_TYPE_VALUES = [10, 20, 30, 40, 50, 60] as const

/** 路由文件（排障与写文档时核对用） */
export const FLOW_MANAGE_ROUTE_FILES = {
  model: `${VIEWS}/old/model/list.vue`,
  aiReview: `${VIEWS}/ai-review-config/list.vue`,
  instance: `${VIEWS}/process-instance/manager/list.vue`,
  task: `${VIEWS}/task/manager/list.vue`,
} as const

/** 流程模型列表。注意这一页的**分页参数名是 `limit`**（见文件头第 3 条） */
export const FLOW_MANAGE_MODEL_LIST_PATH = '/bpm/hr/model/page'
/** 流程模型详情（编辑页加载） */
export const FLOW_MANAGE_MODEL_GET_PATH = '/bpm/hr/model'
/** 流程模型新建页实际使用的 multipart 导入接口。 */
export const FLOW_MANAGE_MODEL_IMPORT_PATH = '/bpm/hr/model/import'
/** 流程模型部署（Portal 使用 JSON body，不是 query） */
export const FLOW_MANAGE_MODEL_DEPLOY_PATH = '/bpm/hr/model/deploy'
/** 流程模型状态修改 */
export const FLOW_MANAGE_MODEL_UPDATE_STATE_PATH = '/bpm/hr/model/update-state'
/** 流程模型删除的 URL 前缀；Portal 列表模块会拼接 `/{id}` */
export const FLOW_MANAGE_MODEL_DELETE_PATH = '/bpm/hr/model/delete'
/** 流程模型编辑 */
export const FLOW_MANAGE_MODEL_UPDATE_PATH = '/bpm/hr/model/update'
/** 流程模型的任务分配规则列表 */
export const FLOW_MANAGE_MODEL_RULE_LIST_PATH = '/bpm/hr/task-assign-rule/list'
/** 流程模型的任务分配规则新增 */
export const FLOW_MANAGE_MODEL_RULE_CREATE_PATH = '/bpm/hr/task-assign-rule/create'
/** 流程模型的任务分配规则更新 */
export const FLOW_MANAGE_MODEL_RULE_UPDATE_PATH = '/bpm/hr/task-assign-rule/update'
/** AI审核配置列表 */
export const FLOW_MANAGE_AI_REVIEW_LIST_PATH = '/bpm/ai-review-config/page'
/** AI审核配置详情（编辑页加载） */
export const FLOW_MANAGE_AI_REVIEW_GET_PATH = '/bpm/ai-review-config/get'
/** AI审核配置创建 */
export const FLOW_MANAGE_AI_REVIEW_CREATE_PATH = '/bpm/ai-review-config/create'
/** AI审核配置更新 */
export const FLOW_MANAGE_AI_REVIEW_UPDATE_PATH = '/bpm/ai-review-config/update'
/** AI审核配置删除 */
export const FLOW_MANAGE_AI_REVIEW_DELETE_PATH = '/bpm/ai-review-config/delete'
/** 流程实例列表（**全公司**，不是"我发起的"） */
export const FLOW_MANAGE_INSTANCE_LIST_PATH = '/bpm/process-instance/manager-page'
/** 管理员取消流程实例 */
export const FLOW_MANAGE_INSTANCE_CANCEL_PATH = '/bpm/process-instance/cancel-by-admin'
/** 流程任务列表（**全公司**的任务流水） */
export const FLOW_MANAGE_TASK_LIST_PATH = '/bpm/task/manager-page'

/**
 * 默认每页条数。四页都是 `useListPageModule({ styleV2: true })` → 20（`list.js:391`）。
 * 流程模型那一页同样默认 20，只是**参数名叫 `limit`**。
 */
export const DEFAULT_PAGE_SIZE = 20

/** 流程模型分类的字典类型（页面第二列用 `portal-hxr-dict-label` 渲染这个字典） */
export const MODEL_CATEGORY_DICT_TYPE = 'bpm_model_category'
/** 流程实例状态字典 */
export const PROCESS_INSTANCE_STATUS_DICT_TYPE = 'bpm_process_instance_status'
/** 流程任务状态字典 */
export const TASK_STATUS_DICT_TYPE = 'bpm_task_status'

/** 用 status 列渲染的字典类型 → 调用方要候选时该查哪个 dictType */
export const STATUS_DICT_TYPES = {
  model: MODEL_CATEGORY_DICT_TYPE,
  instance: PROCESS_INSTANCE_STATUS_DICT_TYPE,
  task: TASK_STATUS_DICT_TYPE,
} as const

/** 流程模型行（`/bpm/hr/model/page`） */
export type FlowModelRow = {
  id: number | string
  /** 流程标识（= 流程定义 key） */
  key?: string
  name?: string
  /** 流程分类，字典 `bpm_model_category` */
  category?: string | null
  /** 创建时间 */
  createTime?: string
  /**
   * 部署信息**挂在 `processDefinition` 下**，不在这层。
   * `showDefinitionItem()` 判的是 `processDefinition.{version,suspensionState,deploymentTime}` 是否为
   * `undefined` —— 为 `undefined` 时页面渲染「未部署」。SDK 原样保留这个嵌套结构。
   */
  processDefinition?: {
    version?: number
    /** 1 = 激活，2 = 挂起（页面 `a-switch` 的 checked/un-checked value 逐字如此） */
    suspensionState?: number
    deploymentTime?: string
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

/** AI审核配置行（`/bpm/ai-review-config/page`） */
export type AiReviewConfigRow = {
  id: number | string
  /** 流程定义 Key */
  processDefinitionKey?: string | null
  /** 任务节点 Key */
  taskDefinitionKey?: string | null
  /**
   * AI Skill 的 id。**页面拿它去 `/sys/tip-template/list` 的本地映射里换名字**
   * （`getSkillName()`），所以这一列页面显示的是名称、返回的是 id。
   * 本 SDK 不拉那张表（见文件头），调用方拿到的就是 id。
   */
  skillId?: number | string | null
  /** AI 模型名，页面直接显示、不做映射 */
  modelConfigName?: string | null
  /** 是否启用。页面 `normalizeEnabledLabel()`：真值 →「启用」、假值 →「停用」 */
  enabled?: boolean | null
  remark?: string | null
  createTime?: string | null
  [key: string]: unknown
}

/** 流程实例行（`/bpm/process-instance/manager-page`） */
export type ProcessInstanceRow = {
  /** 流程编号。页面上是一列 320 宽的省略号列 */
  id: number | string
  /** 流程名称 */
  name?: string | null
  /** 审批内容。页面经 `getApprovalContent()` 处理（trim，空则显示「无」） */
  title?: string | null
  categoryName?: string | null
  /**
   * 发起人**整体挂在 `startUser` 下**（页面列的 `dataIndex` 是 `['startUser','nickname']`
   * 与 `['startUser','deptName']`），不是顶层字段。
   */
  startUser?: { nickname?: string | null; deptName?: string | null; [key: string]: unknown } | null
  /** 流程状态，字典 `bpm_process_instance_status`。页面 `record.status === 1` 时才显示「取消」 */
  status?: number | string | null
  startTime?: string | null
  endTime?: string | null
  /** 耗时（毫秒）。页面 `formatPast2()` 处理，`> 0` 才显示，否则「-」 */
  durationInMillis?: number | null
  /** 当前审批任务，页面用 `a-tag` 逐个渲染 `task.name` */
  tasks?: Array<{ id: number | string; name?: string; [key: string]: unknown }> | null
  [key: string]: unknown
}

/** 流程任务行（`/bpm/task/manager-page`） */
export type FlowTaskManagerRow = {
  id: number | string
  name?: string | null
  createTime?: string | null
  endTime?: string | null
  /** 审批状态，字典 `bpm_task_status` */
  status?: number | string | null
  /** 审批建议 */
  reason?: string | null
  durationInMillis?: number | null
  /** 审批人整体挂在 `assigneeUser` 下（列的 dataIndex 是 `['assigneeUser','nickname']`） */
  assigneeUser?: { nickname?: string | null; [key: string]: unknown } | null
  /** 所属流程整体挂在这里（流程名 / 发起人 / 流程编号都从它取） */
  processInstance?: {
    id?: number | string
    name?: string | null
    startUser?: { nickname?: string | null; [key: string]: unknown } | null
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export type FlowManageId = string | number

/** 编辑页 `/bpm/hr/model/{id}` 返回的表单对象。 */
export type FlowModelForm = {
  id: FlowManageId
  key: string
  name: string
  description?: string | null
  category: string
  bpmnXml: string
  createTime?: string | null
  [key: string]: unknown
}

export type FlowModelCreateInput = {
  key: string
  name: string
  category: string
  description?: string | null
  /** Portal 新建页的 bpmnFile；headless 调用方传文件名和 Base64，不能传本地路径。 */
  fileName: string
  base64: string
  contentType?: string | null
}

export type FlowModelCreateDraft = {
  key: string
  name: string
  category: string
  description: string
  fileName: string
  base64: string
  contentType: string
}

export type FlowModelCreatePreparation = { draft: FlowModelCreateDraft }

/** Portal 编辑流程模型时实际会提交的字段；createTime 是详情回显后可能保留的前端字段。 */
export type FlowModelUpdateDraft = {
  id: string
  key: string
  name: string
  description: string | null
  category: string
  bpmnXml: string
  createTime?: string | null
}

export type FlowModelUpdatePreparation = { draft: FlowModelUpdateDraft }

export type FlowModelStateInput = {
  id: FlowManageId
  /** 列表行的最新 `processDefinition.suspensionState`；Portal 只有存在该字段时才渲染 switch。 */
  currentState: number
  /** Portal switch 的目标值：1=激活，2=挂起。 */
  state: number
}

export type FlowTaskAssignRuleRow = {
  id?: FlowManageId | null
  modelId?: FlowManageId | null
  processDefinitionId?: FlowManageId | null
  taskDefinitionName?: string | null
  taskDefinitionKey?: string | null
  type?: number | null
  options?: Array<FlowManageId> | null
  [key: string]: unknown
}

/** Portal 未配置规则行进入的新增表单。`id` 为空才会走 POST create 分支。 */
export type FlowTaskAssignRuleCreateForm = {
  id?: FlowManageId | null
  modelId: FlowManageId
  /** Portal 表单可能带回该字段，但 Java Create DTO 不接收它；模型规则新增时应省略或为 null。 */
  processDefinitionId?: FlowManageId | null
  taskDefinitionKey: string
  type: number
  options: Array<FlowManageId>
}

/** Portal 新增体；`id` 固定为 null，processDefinitionId 仅在原表单明确带回时保留。 */
export type FlowTaskAssignRuleCreateDraft = {
  id: null
  modelId: string
  options: Array<FlowManageId>
  processDefinitionId?: string | null
  taskDefinitionKey: string
  type: number
}

export type FlowTaskAssignRuleCreatePreparation = { draft: FlowTaskAssignRuleCreateDraft }

export type FlowTaskAssignRuleUpdateDraft = {
  id: FlowManageId
  type: number
  options: Array<FlowManageId>
}

export type FlowTaskAssignRuleUpdatePreparation = { draft: FlowTaskAssignRuleUpdateDraft }

export type AiReviewConfigForm = {
  id?: FlowManageId | null
  processDefinitionKey?: string | null
  taskDefinitionKey?: string | null
  skillId?: FlowManageId | null
  /** null 必须保留：Portal 用它表示“使用 AI 模块默认模型”。 */
  modelConfigId?: FlowManageId | null
  enabled?: boolean | null
  remark?: string | null
}

export type AiReviewConfigDraft = {
  id?: FlowManageId
  processDefinitionKey: string
  taskDefinitionKey: string
  skillId: FlowManageId
  modelConfigId?: FlowManageId | null
  enabled: boolean
  remark?: string
}

export type AiReviewConfigPreparation = { draft: AiReviewConfigDraft }

export type FlowAdminCancelDraft = {
  id: string
  reason: string
}

export type FlowAdminCancelInput = {
  id: FlowManageId
  /** Portal 只在 `record.status === 1` 时显示“取消”。 */
  currentStatus: number
  reason: string
}

export type FlowAdminCancelPreparation = {
  draft: FlowAdminCancelDraft
  currentStatus: 1
}

/** 流程模型查询条件 */
export type FlowModelQuery = {
  /** 流程标识，模糊匹配 */
  key?: string
  /** 流程名称，模糊匹配 */
  name?: string
  /**
   * 流程分类。页面是 `portal-hxr-dict-select type="bpm_model_category"`。
   * 【推断】取值未实测；候选用 `base-dict-get` 传 `dictType='bpm_model_category'`
   */
  category?: string
  pageNo?: number
  /**
   * 每页条数。**参数名就是 `limit`**（页面 `fieldNamePageSize: 'limit'`），
   * 不是 SDK 别处的 `pageSize` —— 写进 URL 的是 `limit=20`。
   */
  limit?: number
}

/** AI审核配置查询条件。**所有空值都会被丢掉**（含 `order` / `orderField`），见文件头第 2 条 */
export type AiReviewConfigQuery = {
  /** 流程定义 Key。页面是下拉（候选走 `/bpm/process-definition/list`，SDK 不拉那张表） */
  processDefinitionKey?: string
  /** 任务节点 Key。页面是文本输入框 */
  taskDefinitionKey?: string
  /**
   * 是否启用。页面是 `a-select`，取值是**布尔** `true` / `false`（`api.js:3-6` 的 `ENABLED_OPTIONS`）。
   * ⚠️ `enabled=false` 是**有效筛选值、会照发**（`false` 不是空值），
   * 而 `enabled=undefined` 会被滤掉 —— 两者语义不同，别用 `false` 当"不筛"。
   */
  enabled?: boolean
  /** 创建时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给 */
  createTimeStart?: string
  /**
   * 创建时间区间终点，格式同上，必须与 `createTimeStart` 成对给。
   *
   * ⚠️ 这一页的区间是**原样取两端**（`value-format="YYYY-MM-DD HH:mm:ss"` + `show-time`，
   * 页面不做任何改写）—— 既不是"结束日 +1 天"，也不是"归到当日 23:59:59"。
   * 要含结束日一整天请自己给 `23:59:59`。
   */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

/** 流程实例查询条件 */
export type ProcessInstanceQuery = {
  /**
   * 发起人 —— 一个**用户 id**（页面下拉的 value 是那个人员接口返回行的 `item.id`；
   * 基准里页面打的是 `/system/user/simple-page`，本地检出写的是 `/system/user/simple-list`，以基准为准）。
   * 默认 `null`（不发这个键）。要 id 先用 `base-user-search`（强制要关键字）。
   */
  startUserId?: number | string
  /** 流程名称，模糊匹配。空串**照发** */
  name?: string
  /** 审批内容，模糊匹配。空串**照发** */
  title?: string
  /** 所属流程 —— 页面是**文本输入框**（流程定义 id / key 的字符串），不是下拉 */
  processDefinitionId?: string
  /**
   * 流程分类。页面是下拉（候选走 `/bpm/category/simple-list` 的无参全量，SDK 不照抄）。
   * 编码与字典 `bpm_model_category` 同源。
   */
  category?: string
  /** 流程状态，字典 `bpm_process_instance_status`。默认 `null`（不发这个键） */
  status?: number | string
  /** 发起时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给 */
  createTimeStart?: string
  /**
   * 发起时间区间终点，格式同上，必须与 `createTimeStart` 成对给。
   *
   * ⚠️ 这一页的时间区间语义是**按天归边的闭区间**：页面 `formatCreateTimeRange()`
   * 把两端分别 `startOf('day')` / `endOf('day')`，也就是
   * 「起点当日 00:00:00 ~ 终点当日 23:59:59」。用 `buildFlowManageDayRange()` 生成。
   */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

/** 流程任务查询条件 */
export type FlowTaskManagerQuery = {
  /** 任务名称，模糊匹配。空串**照发** */
  name?: string
  /** 创建时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给 */
  createTimeStart?: string
  /**
   * 创建时间区间终点，格式同上，必须与 `createTimeStart` 成对给。
   * 语义与流程实例页相同：**按天归边的闭区间**（起点 00:00:00 ~ 终点 23:59:59）
   */
  createTimeEnd?: string
  pageNo?: number
  pageSize?: number
}

/** 流程模型：`form` 三个字段恒为空串、**照发**（没有 convertFetchForm） */
const MODEL_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'key', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'category', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  // ⚠️ 这个键叫 limit —— 页面 `fieldNamePageSize: 'limit'`，不是笔误
  { name: 'limit', defaultValue: DEFAULT_PAGE_SIZE },
]

/** AI审核配置：`removeEmptyParams` 会把**所有**空值滤掉，所以这张表要过一遍筛 */
const AI_REVIEW_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'processDefinitionKey', defaultValue: null },
  { name: 'taskDefinitionKey', defaultValue: '' },
  { name: 'enabled', defaultValue: null },
  { name: 'createTime', defaultValue: [] },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 流程实例：没有 convertFetchForm，空串照发、`null` 交给 qs 的 `skipNulls` 丢掉 */
const INSTANCE_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'startUserId', defaultValue: null },
  { name: 'name', defaultValue: '' },
  { name: 'title', defaultValue: '' },
  { name: 'processDefinitionId', defaultValue: null },
  { name: 'category', defaultValue: null },
  { name: 'status', defaultValue: null },
  { name: 'createTime', defaultValue: [] },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 流程任务：同上 */
const TASK_MANAGER_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'createTime', defaultValue: [] },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 复刻 `ai-review-config/api.js:101-113` 的 `removeEmptyParams`，逐字：
 *
 * ```js
 * if (value === '' || value === null || value === undefined) return false
 * if (Array.isArray(value) && value.length === 0) return false
 * return true
 * ```
 *
 * ⚠️ 注意它**连 `false` 也保留**（`false` 不等于 `''`/`null`/`undefined`），
 * 所以 `enabled=false` 是有效筛选值。这一点最容易在"顺手写个 falsy 判断"时写坏。
 * 也注意它滤掉的是 `''` —— **`order` / `orderField` 那对空串就是这么没的**。
 */
function removeEmptyParams (data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === '' || value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    result[key] = value
  }
  return result
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
  /** 表里没有的字段一律不出现；有 `createTime` 的页要先把数组算好再传进来 */
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged = { ...query, ...extra }
  const params: Record<string, unknown> = {}
  for (const item of order) {
    const value = merged[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 把「区间成对给」这条本地校验抽出来：四页里三页有区间，错误文案要一致。
 *
 * **返回错误而不是抛**：本模块的能力方法一律把参数错误变成 `Promise.reject`
 * （与 `backlog-task-examine.ts` / `searchUsers` 一致），所以这里不能抛 ——
 * 抛出去会让 `listXxx(...).catch()` 拿不到，变成同步异常。
 */
function rangePairError (
  start: string | undefined,
  end: string | undefined,
  who: string,
): Error | null {
  const hasStart = start !== undefined && start !== null
  const hasEnd = end !== undefined && end !== null
  if (hasStart !== hasEnd) {
    return new Error(
      `createTimeStart 与 createTimeEnd 必须成对给（${who}）：页面上是一个 a-range-picker，` +
        '它只会把两个值一起写进 formState，给单边等于造了一个页面上不存在的状态。',
    )
  }
  if (hasStart && hasEnd) {
    try {
      assertDateTime(start as string, 'createTimeStart')
      assertDateTime(end as string, 'createTimeEnd')
    } catch (error) {
      return error as Error
    }
  }
  return null
}

/**
 * 流程实例 / 流程任务的创建时间区间 → 接口收的两个标量。
 *
 * **语义是"按天归边的闭区间"**，逐字复刻页面 `formatCreateTimeRange()`：
 *
 * ```js
 * index === 0 ? dayjs(item).startOf('day').format('YYYY-MM-DD HH:mm:ss')
 *             : dayjs(item).endOf('day').format('YYYY-MM-DD HH:mm:ss')
 * ```
 *
 * ⇒ 起点 `<startDate> 00:00:00`、终点 `<endDate> 23:59:59`（即便传入的时间带时分秒，
 * 也会被归到当日边界——页面就是这么写的）。
 *
 * ⚠️ **不要与 `study-lesson.ts` 的 `buildStudyLessonTimeRange()` 混**：那边是
 * 「结束日 **+1 天**」的**开区间**（终点是次日零点）。两者都能含住结束日，
 * 但相差一天，写串了会**静默多查一天/少一天**。
 */
export function buildFlowManageDayRange (
  startDate: string,
  endDate: string,
): { createTimeStart: string; createTimeEnd: string } {
  const start = parseDay(startDate, '流程实例/流程任务时间')
  const end = parseDay(endDate, '流程实例/流程任务时间')
  if (end.getTime() < start.getTime()) {
    throw new Error('流程实例/流程任务时间区间的结束日必须不早于开始日')
  }
  return {
    createTimeStart: `${ymd(start)} 00:00:00`,
    createTimeEnd: `${ymd(end)} 23:59:59`,
  }
}

/**
 * AI审核配置的创建时间区间 → 接口收的两个标量。
 *
 * 这一页**什么改写都不做**（`value-format="YYYY-MM-DD HH:mm:ss"` + `show-time`，
 * 两个值原样进 qs），所以这里也只做格式校验、原样返回。
 * 要含结束日一整天请自己给 `23:59:59` —— 页面上用户本来就能选到时分秒。
 */
export function buildAiReviewConfigTimeRange (
  startDateTime: string,
  endDateTime: string,
): { createTimeStart: string; createTimeEnd: string } {
  assertDateTime(startDateTime, 'createTimeStart')
  assertDateTime(endDateTime, 'createTimeEnd')
  return { createTimeStart: startDateTime, createTimeEnd: endDateTime }
}

function parseDay (value: string, field: string): Date {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} 的日期应为 YYYY-MM-DD（或带时间的同格式字符串），收到 ${JSON.stringify(value)}`)
  }
  return date
}

function ymd (date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function requiredText (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} 必填`)
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`${label} 不能超过 ${maxLength} 个字符`)
  }
  return value
}

function idText (value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} 不能为空`)
  }
  const id = String(value).trim()
  if (id === '') throw new Error(`${label} 不能为空`)
  return id
}

function numericId (value: unknown, label: string): FlowManageId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} 必须是整数`)
    return value
  }
  if (typeof value !== 'string' || value.trim() === '' || !/^[-+]?\d+$/.test(value.trim())) {
    throw new Error(`${label} 必须是整数`)
  }
  return value.trim()
}

function ruleOptions (value: unknown): Array<FlowManageId> {
  if (!Array.isArray(value)) throw new Error('options 必须是数组（Portal 表单的规则值数组）')
  if (value.length === 0) throw new Error('options 必须至少包含一项（Portal 表单必填）')
  return value.map((item, index) => numericId(item, `options[${index}]`))
}

function modelUpdateDraftOf (input: FlowModelUpdateDraft): FlowModelUpdateDraft {
  const description = input?.description === undefined ? '' : input.description
  if (description !== null && typeof description !== 'string') {
    throw new Error('流程描述 description 必须是字符串或 null')
  }
  const draft: FlowModelUpdateDraft = {
    id: idText(input?.id, '流程模型 id'),
    key: requiredText(input?.key, '流程标识'),
    name: requiredText(input?.name, '流程名称'),
    description,
    category: requiredText(input?.category, '流程分类'),
    bpmnXml: requiredText(input?.bpmnXml, 'BPMN XML'),
  }
  if (input?.createTime !== undefined) draft.createTime = input.createTime ?? null
  return draft
}

function modelFileOf (input: unknown, label: string): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = input as Record<string, unknown> | null | undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  if (typeof value.fileName !== 'string' || value.fileName.trim() === '') throw new Error(`${label}.fileName不能为空`)
  if (typeof value.base64 !== 'string' || value.base64.trim() === '') throw new Error(`${label}.base64不能为空`)
  const base64 = value.base64.replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error(`${label}.base64不是合法的标准Base64`)
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}.base64不能为空文件`)
  const contentType = typeof value.contentType === 'string' && value.contentType.trim() !== ''
    ? value.contentType
    : 'application/octet-stream'
  return { fileName: value.fileName, contentType, bytes: new Uint8Array(bytes) }
}

function modelCreateDraftOf (input: FlowModelCreateInput): FlowModelCreateDraft {
  const value = input as unknown as Record<string, unknown> | null | undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('流程模型新建表单必须是对象')
  const file = modelFileOf(value, '流程模型 BPMN 文件')
  const description = value.description === undefined || value.description === null ? '' : value.description
  if (typeof description !== 'string') throw new Error('流程描述 description 必须是字符串或 null')
  return {
    key: requiredText(value.key, '流程标识'),
    name: requiredText(value.name, '流程名称'),
    category: requiredText(value.category, '流程分类'),
    description,
    fileName: file.fileName,
    base64: String(value.base64).replace(/\s+/g, ''),
    contentType: file.contentType,
  }
}

function formDataWithModelFile (draft: FlowModelCreateDraft): FormData {
  const bytes = Buffer.from(draft.base64, 'base64')
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const data = new FormData()
  // 保持 Portal customSubmit 的字段顺序：key → name → bpmnFile → category → description。
  data.append('key', draft.key)
  data.append('name', draft.name)
  data.append('bpmnFile', new Blob([buffer], { type: draft.contentType }), draft.fileName)
  data.append('category', draft.category)
  data.append('description', draft.description)
  return data
}

function requestMultipart<T> (request: PortalRequest, config: PortalRequestConfig): Promise<T> {
  return request<T>(config)
}

function buildModelUpdateDraft (input: FlowModelForm | FlowModelUpdateDraft): FlowModelUpdateDraft {
  return modelUpdateDraftOf({
    id: idText(input.id, '流程模型 id'),
    key: input.key,
    name: input.name,
    description: input.description === undefined ? '' : input.description,
    category: input.category,
    bpmnXml: input.bpmnXml,
    ...(input.createTime === undefined ? {} : { createTime: input.createTime }),
  })
}

function modelStateOf (value: unknown, label: string): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error(`${label} 必须是 1（激活）或 2（挂起）`)
  return value
}

function aiReviewDraftOf (input: AiReviewConfigDraft, mode: 'create' | 'update'): AiReviewConfigDraft {
  const draft: AiReviewConfigDraft = {
    processDefinitionKey: requiredText(input?.processDefinitionKey, '流程定义 Key', 64),
    taskDefinitionKey: requiredText(input?.taskDefinitionKey, '任务节点 Key', 128),
    skillId: numericId(input?.skillId, 'AI Skill 编号'),
    enabled: input.enabled,
  }
  if (typeof input?.enabled !== 'boolean') throw new Error('是否启用 enabled 必须是布尔值')
  if (mode === 'update') draft.id = numericId(input?.id, 'AI审核配置 id')
  if (input?.modelConfigId === null) {
    // api.js 的 normalizeSubmitData 明确保留这个 null。
    draft.modelConfigId = null
  } else if (input?.modelConfigId !== undefined && input.modelConfigId !== '') {
    draft.modelConfigId = numericId(input.modelConfigId, 'AI 模型配置编号')
  }
  if (input?.remark !== undefined && input.remark !== null && input.remark !== '') {
    if (typeof input.remark !== 'string') throw new Error('备注 remark 必须是字符串')
    if (input.remark.length > 255) throw new Error('备注 remark 不能超过 255 个字符')
    draft.remark = input.remark
  }
  return draft
}

function buildAiReviewDraft (input: AiReviewConfigForm, mode: 'create' | 'update'): AiReviewConfigDraft {
  const processDefinitionKey = requiredText(input?.processDefinitionKey, '流程定义 Key', 64)
  const taskDefinitionKey = requiredText(input?.taskDefinitionKey, '任务节点 Key', 128)
  const skillId = numericId(input?.skillId, 'AI Skill 编号')
  if (typeof input?.enabled !== 'boolean') throw new Error('是否启用 enabled 必须是布尔值')

  const draft: AiReviewConfigDraft = {
    processDefinitionKey,
    taskDefinitionKey,
    skillId,
    enabled: input.enabled,
  }
  if (input.id !== undefined && input.id !== null) draft.id = input.id
  if (input.modelConfigId === null) {
    draft.modelConfigId = null
  } else if (input.modelConfigId !== undefined && input.modelConfigId !== '') {
    draft.modelConfigId = numericId(input.modelConfigId, 'AI 模型配置编号')
  }
  if (input.remark !== undefined && input.remark !== null && input.remark !== '') {
    if (typeof input.remark !== 'string') throw new Error('备注 remark 必须是字符串')
    if (input.remark.length > 255) throw new Error('备注 remark 不能超过 255 个字符')
    draft.remark = input.remark
  }
  return aiReviewDraftOf(draft, mode)
}

function taskAssignRuleUpdateDraftOf (input: { id: FlowManageId; type: number; options: unknown }): FlowTaskAssignRuleUpdateDraft {
  const id = numericId(input?.id, '任务分配规则 id')
  if (typeof input?.type !== 'number' || !Number.isInteger(input.type)) {
    throw new Error('规则类型 type 必须是整数')
  }
  if (!TASK_ASSIGN_RULE_TYPE_VALUES.some(value => value === input.type)) {
    throw new Error('规则类型 type 不在 Portal 支持的 10/20/30/40/50/60 范围内')
  }
  return { id, type: input.type, options: ruleOptions(input.options) }
}

function buildTaskAssignRuleUpdateDraft (input: {
  id: FlowManageId
  type: number
  options: unknown
}): FlowTaskAssignRuleUpdateDraft {
  return taskAssignRuleUpdateDraftOf({
    id: numericId(input?.id, '任务分配规则 id'),
    type: input?.type,
    options: input?.options,
  })
}

function buildTaskAssignRuleCreateDraft (input: FlowTaskAssignRuleCreateForm): FlowTaskAssignRuleCreateDraft {
  // Portal 的 customSubmit 用 `if (form.id)` 区分更新/新增；有真实 id 的表单不能误走 create。
  if (input?.id !== undefined && input.id !== null && input.id !== '') {
    throw new Error('新增任务分配规则时 form.id 必须为空')
  }

  const type = input?.type
  if (typeof type !== 'number' || !Number.isInteger(type)) {
    throw new Error('规则类型 type 必须是整数')
  }
  if (!TASK_ASSIGN_RULE_TYPE_VALUES.some(value => value === type)) {
    throw new Error('规则类型 type 不在 Portal 支持的 10/20/30/40/50/60 范围内')
  }

  const modelId = idText(input?.modelId, '流程模型 id')
  const taskDefinitionKey = requiredText(input?.taskDefinitionKey, '任务定义 Key')
  const options = ruleOptions(input?.options)
  const processDefinitionId = input?.processDefinitionId
  const normalizedProcessDefinitionId =
    processDefinitionId === undefined || processDefinitionId === null || processDefinitionId === ''
      ? processDefinitionId
      : idText(processDefinitionId, '流程定义 id')

  return {
    id: null,
    modelId,
    options,
    ...(normalizedProcessDefinitionId === undefined ? {} : { processDefinitionId: normalizedProcessDefinitionId }),
    taskDefinitionKey,
    type,
  }
}

function adminCancelDraftOf (input: { id: FlowManageId; reason: string }): FlowAdminCancelDraft {
  return {
    id: idText(input?.id, '流程实例 id'),
    reason: requiredText(input?.reason, '取消原因 reason').trim(),
  }
}

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const MODEL_PARAMS: ParamSpec[] = [
  { name: 'key', kind: 'text', required: false, description: '流程标识（流程定义 key），模糊匹配' },
  { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
  {
    name: 'category',
    kind: 'enum',
    required: false,
    description:
      `流程分类，取自字典 ${MODEL_CATEGORY_DICT_TYPE}（如 human_process）。` +
      `【推断】取值未实测。要候选请调 base-dict-get（dictType=${MODEL_CATEGORY_DICT_TYPE}）—— ` +
      '注意是它，不是 base-dict-search：后者要的是 dictType 的**名字关键字**，' +
      '前者才是"按 dictType 取这个字典的全部选项"',
    lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  {
    name: 'limit',
    kind: 'number',
    required: false,
    description:
      `每页条数，默认 ${DEFAULT_PAGE_SIZE}。⚠️ **这一页的参数名是 limit，不是 pageSize** —— ` +
      '页面显式写了 fieldNamePageSize: \'limit\'，写进 URL 的就是 limit=N（少见的例外，' +
      '全局默认本来是 pageSize）',
  },
]

const AI_REVIEW_PARAMS: ParamSpec[] = [
  {
    name: 'processDefinitionKey',
    kind: 'text',
    required: false,
    description: '流程定义 Key。页面是下拉（候选走 /bpm/process-definition/list 的全量，SDK 不拉那张表）',
  },
  { name: 'taskDefinitionKey', kind: 'text', required: false, description: '任务节点 Key' },
  {
    name: 'enabled',
    kind: 'boolean',
    required: false,
    description:
      '是否启用。页面取值是**布尔** true / false。⚠️ `enabled=false` 是**有效筛选值、会照发**，' +
      '而"不传"才是"不过滤" —— 别拿 false 当不筛',
  },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '创建时间区间起点，`YYYY-MM-DD HH:mm:ss`。必须与 `createTimeEnd` 成对给。' +
      '用 buildAiReviewConfigTimeRange() 生成（本页**不做任何改写**，原样取两端）',
  },
  {
    name: 'createTimeEnd',
    kind: 'date',
    required: false,
    description: '创建时间区间终点，格式同上。要含结束日一整天请给 23:59:59（本页不 +1 天）',
  },
  ...PAGE_PARAMS,
]

const INSTANCE_PARAMS: ParamSpec[] = [
  {
    name: 'startUserId',
    kind: 'search',
    required: false,
    description:
      '发起人的**用户 id**（不是姓名）。不传 = 不过滤。页面那个下拉是全量拉取，SDK 不照抄——' +
      '要 id 请先用 base-user-search 按姓名查',
    lookup: { capabilityId: 'base-user-search', keywordParam: 'keyword' },
  },
  { name: 'name', kind: 'text', required: false, description: '流程名称，模糊匹配' },
  { name: 'title', kind: 'text', required: false, description: '审批内容，模糊匹配' },
  {
    name: 'processDefinitionId',
    kind: 'text',
    required: false,
    description: '所属流程。⚠️ 页面这里是**文本输入框**（不是下拉），直接给流程定义 id / key 的字符串',
  },
  {
    name: 'category',
    kind: 'text',
    required: false,
    description:
      `流程分类。页面是下拉（候选走 /bpm/category/simple-list 的无参全量，SDK 不照抄），` +
      `编码与字典 ${MODEL_CATEGORY_DICT_TYPE} 同源。不传 = 不过滤`,
  },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description:
      `流程状态，取自字典 ${PROCESS_INSTANCE_STATUS_DICT_TYPE}。不传 = 不过滤。` +
      `【推断】取值未实测。要候选请调 base-dict-get（dictType=${PROCESS_INSTANCE_STATUS_DICT_TYPE}）—— ` +
      '注意是它，不是 base-dict-search：后者要的是 dictType 的**名字关键字**，' +
      '前者才是"按 dictType 取这个字典的全部选项"',
    lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
  },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '发起时间区间起点。必须与 `createTimeEnd` 成对给，用 **buildFlowManageDayRange()** 生成 —— ' +
      '本页语义是**按天归边**：起点当日 00:00:00、终点当日 23:59:59（不是 +1 天）',
  },
  { name: 'createTimeEnd', kind: 'date', required: false, description: '发起时间区间终点，见上' },
  ...PAGE_PARAMS,
]

const TASK_MANAGER_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '任务名称，模糊匹配' },
  {
    name: 'createTimeStart',
    kind: 'date',
    required: false,
    description:
      '创建时间区间起点。必须与 `createTimeEnd` 成对给，用 **buildFlowManageDayRange()** 生成 —— ' +
      '与流程实例页同一套语义：起点当日 00:00:00、终点当日 23:59:59',
  },
  { name: 'createTimeEnd', kind: 'date', required: false, description: '创建时间区间终点，见上' },
  ...PAGE_PARAMS,
]

const p = (
  name: string,
  kind: ParamSpec['kind'],
  required = false,
  description?: string,
  options?: ParamSpec['options'],
): ParamSpec => ({
  name,
  kind,
  required,
  ...(description ? { description } : {}),
  ...(options ? { options } : {}),
})

const MODEL_UPDATE_FORM_PARAM = p(
  'form',
  'text',
  true,
  'Portal 编辑表单对象；key、name、category、bpmnXml 必填，description 可为字符串或 null，不发送请求',
)
const MODEL_CREATE_FORM_PARAMS: ParamSpec[] = [
  p('key', 'text', true, '流程标识；Portal 新建表单必填'),
  p('name', 'text', true, '流程名称；Portal 新建表单必填'),
  p('category', 'text', true, `流程分类；取自字典 ${MODEL_CATEGORY_DICT_TYPE}`),
  p('description', 'text', false, '流程描述；省略时按 Portal 发送空字符串'),
  p('fileName', 'text', true, 'BPMN 文件名；不能传本地路径，Portal 不限制扩展名'),
  p('base64', 'text', true, 'BPMN 文件内容的标准 Base64'),
  p('contentType', 'text', false, 'BPMN 文件 MIME；省略时使用 application/octet-stream'),
]
const MODEL_UPDATE_DRAFT_PARAM = p(
  'draft',
  'text',
  true,
  'prepareModelUpdate 返回的流程模型草稿，必须原样交给 updateModel',
)
const MODEL_ID_PARAM = p('id', 'text', true, '当前流程模型记录 id')
const MODEL_STATE_PARAMS: ParamSpec[] = [
  MODEL_ID_PARAM,
  p('currentState', 'enum', true, '列表行 processDefinition.suspensionState；必须为 1 或 2', [
    { label: '激活', value: 1 },
    { label: '挂起', value: 2 },
  ]),
  p('state', 'enum', true, '目标状态；必须为当前状态的相反值', [
    { label: '激活', value: 1 },
    { label: '挂起', value: 2 },
  ]),
]
const RULE_QUERY_PARAMS: ParamSpec[] = [
  p('modelId', 'text', false, '分配规则页路由 query.modelId'),
  p('processDefinitionId', 'text', false, '分配规则页路由 query.processDefinitionId；Portal 可不传'),
]
const RULE_CREATE_FORM_PARAM = p(
  'form',
  'text',
  true,
  'Portal 未配置规则行的新增表单；modelId、taskDefinitionKey、type、options 必须可用，form.id 必须为空；processDefinitionId 仅为 Portal 可选回显字段',
)
const RULE_CREATE_DRAFT_PARAM = p(
  'draft',
  'text',
  true,
  'prepareTaskAssignRuleCreate 返回的新增草稿；提交时保留 Portal 的 id=null，Java DTO 实际使用 modelId/taskDefinitionKey/type/options',
)
const RULE_UPDATE_FORM_PARAM = p(
  'form',
  'text',
  true,
  'Portal 规则编辑表单；type 必须为 10/20/30/40/50/60，options 为非空 ID 数组',
)
const RULE_UPDATE_DRAFT_PARAM = p(
  'draft',
  'text',
  true,
  'prepareTaskAssignRuleUpdate 返回的 { id, type, options } 草稿',
)
const AI_REVIEW_FORM_PARAM = p(
  'form',
  'text',
  true,
  'Portal AI审核配置表单；流程定义 Key ≤64、任务节点 Key ≤128、skillId/enabled 必填，remark ≤255；modelConfigId=null 表示显式清空',
)
const AI_REVIEW_DRAFT_PARAM = p(
  'draft',
  'text',
  true,
  'prepareCreateAiReviewConfig 或 prepareUpdateAiReviewConfig 返回的清洗后草稿',
)
const AI_REVIEW_ID_PARAM = p('id', 'number', true, 'AI审核配置 id；Java DTO 类型为 Long')
const ADMIN_CANCEL_PARAMS: ParamSpec[] = [
  p('id', 'text', true, '流程实例 id，不是业务单据 id'),
  p('currentStatus', 'enum', true, '列表行最新状态；Portal 只在严格等于 1（运行中）时显示取消按钮', [
    { label: '运行中', value: 1 },
  ]),
  p('reason', 'text', true, '取消原因；Portal trim 后必须非空'),
]
const ADMIN_CANCEL_DRAFT_PARAM = p('draft', 'text', true, 'prepareAdminCancel 返回的 { id, reason } 草稿')

const pageDefinition = (
  pagePath: string,
  permission: string,
  definition: Omit<CapabilityDefinition, 'pagePath' | 'permission'>,
): CapabilityDefinition => ({ ...definition, pagePath, permission })

export const flowManageCapabilities: CapabilityDefinition[] = [
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-list', title: '查询流程模型列表（双赢协议）', write: false, params: MODEL_PARAMS }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-get', title: '读取流程模型编辑详情', write: false, params: [MODEL_ID_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-prepare-create', title: '准备新建流程模型', write: false, params: MODEL_CREATE_FORM_PARAMS }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-create', title: '新建流程模型', write: true, params: [p('draft', 'text', true, 'prepareModelCreate 返回的 BPMN multipart 草稿')] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-cancel-create', title: '取消新建流程模型', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-prepare-update', title: '准备编辑流程模型', write: false, params: [MODEL_UPDATE_FORM_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-update', title: '编辑流程模型', write: true, params: [MODEL_UPDATE_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-cancel-update', title: '取消编辑流程模型', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-deploy', title: '部署流程模型', write: true, params: [MODEL_ID_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-update-state', title: '激活或挂起流程模型', write: true, params: MODEL_STATE_PARAMS }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-delete', title: '删除流程模型', write: true, params: [MODEL_ID_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-list', title: '查询流程模型分配规则', write: false, params: RULE_QUERY_PARAMS }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-prepare-create', title: '准备新增流程分配规则', write: false, params: [RULE_CREATE_FORM_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-create', title: '新增流程分配规则', write: true, params: [RULE_CREATE_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-cancel-create', title: '取消新增流程分配规则', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-prepare-update', title: '准备编辑流程分配规则', write: false, params: [RULE_UPDATE_FORM_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-update', title: '编辑流程分配规则', write: true, params: [RULE_UPDATE_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_MODEL_PAGE_PATH, FLOW_MANAGE_MODEL_PERMISSION, { id: 'flow-manage-model-rule-cancel-update', title: '取消编辑流程分配规则', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-list', title: '查询 AI审核配置列表', write: false, params: AI_REVIEW_PARAMS }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-get', title: '读取 AI审核配置详情', write: false, params: [AI_REVIEW_ID_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-prepare-create', title: '准备创建 AI审核配置', write: false, params: [AI_REVIEW_FORM_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-create', title: '创建 AI审核配置', write: true, params: [AI_REVIEW_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-prepare-update', title: '准备更新 AI审核配置', write: false, params: [AI_REVIEW_FORM_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-update', title: '更新 AI审核配置', write: true, params: [AI_REVIEW_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-delete', title: '删除 AI审核配置', write: true, params: [AI_REVIEW_ID_PARAM] }),
  pageDefinition(FLOW_MANAGE_AI_REVIEW_PAGE_PATH, FLOW_MANAGE_AI_REVIEW_PERMISSION, { id: 'flow-manage-ai-review-config-cancel-save', title: '取消 AI审核配置表单', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_INSTANCE_PAGE_PATH, FLOW_MANAGE_INSTANCE_PERMISSION, { id: 'flow-manage-process-instance-list', title: '查询流程实例列表（全公司，管理员视角）', write: false, params: INSTANCE_PARAMS }),
  pageDefinition(FLOW_MANAGE_INSTANCE_PAGE_PATH, FLOW_MANAGE_INSTANCE_PERMISSION, { id: 'flow-manage-process-instance-prepare-cancel', title: '准备管理员取消流程实例', write: false, params: ADMIN_CANCEL_PARAMS }),
  pageDefinition(FLOW_MANAGE_INSTANCE_PAGE_PATH, FLOW_MANAGE_INSTANCE_PERMISSION, { id: 'flow-manage-process-instance-cancel-by-admin', title: '管理员取消流程实例', write: true, params: [ADMIN_CANCEL_DRAFT_PARAM] }),
  pageDefinition(FLOW_MANAGE_INSTANCE_PAGE_PATH, FLOW_MANAGE_INSTANCE_PERMISSION, { id: 'flow-manage-process-instance-cancel-form', title: '取消管理员取消表单', write: false, params: [] }),
  pageDefinition(FLOW_MANAGE_TASK_PAGE_PATH, FLOW_MANAGE_TASK_PERMISSION, { id: 'flow-manage-task-list', title: '查询流程任务列表（全公司任务流水）', write: false, params: TASK_MANAGER_PARAMS }),
]

/** 主线程接入 invoke/catalog 时使用的能力 ID → capability 方法映射。 */
export const FLOW_MANAGE_METHODS = {
  'flow-manage-model-list': 'listModels',
  'flow-manage-model-get': 'getModel',
  'flow-manage-model-prepare-create': 'prepareModelCreate',
  'flow-manage-model-create': 'createModel',
  'flow-manage-model-cancel-create': 'cancelModelCreate',
  'flow-manage-model-prepare-update': 'prepareModelUpdate',
  'flow-manage-model-update': 'updateModel',
  'flow-manage-model-cancel-update': 'cancelModelUpdate',
  'flow-manage-model-deploy': 'deployModel',
  'flow-manage-model-update-state': 'updateModelState',
  'flow-manage-model-delete': 'deleteModel',
  'flow-manage-model-rule-list': 'listTaskAssignRules',
  'flow-manage-model-rule-prepare-create': 'prepareTaskAssignRuleCreate',
  'flow-manage-model-rule-create': 'createTaskAssignRule',
  'flow-manage-model-rule-cancel-create': 'cancelTaskAssignRuleCreate',
  'flow-manage-model-rule-prepare-update': 'prepareTaskAssignRuleUpdate',
  'flow-manage-model-rule-update': 'updateTaskAssignRule',
  'flow-manage-model-rule-cancel-update': 'cancelTaskAssignRule',
  'flow-manage-ai-review-config-list': 'listAiReviewConfigs',
  'flow-manage-ai-review-config-get': 'getAiReviewConfig',
  'flow-manage-ai-review-config-prepare-create': 'prepareCreateAiReviewConfig',
  'flow-manage-ai-review-config-create': 'createAiReviewConfig',
  'flow-manage-ai-review-config-prepare-update': 'prepareUpdateAiReviewConfig',
  'flow-manage-ai-review-config-update': 'updateAiReviewConfig',
  'flow-manage-ai-review-config-delete': 'deleteAiReviewConfig',
  'flow-manage-ai-review-config-cancel-save': 'cancelAiReviewConfig',
  'flow-manage-process-instance-list': 'listProcessInstances',
  'flow-manage-process-instance-prepare-cancel': 'prepareAdminCancel',
  'flow-manage-process-instance-cancel-by-admin': 'submitAdminCancel',
  'flow-manage-process-instance-cancel-form': 'cancelAdminCancelForm',
  'flow-manage-task-list': 'listFlowTasks',
} as const

/**
 * 能力实现。`request` 由 SDK 门面注入，**每页一个**——module-type 与 http 实例按各自的页面解析
 * （约定第 1 条 / 第 29 条）。
 *
 * 四页的 `module-type` 都**算不出**（`generated/page-catalog.json` 里这四条的 `moduleType`
 * 都是 `null`），所以按约定第 2 条**不发这个头**；http 实例四页都是页面显式 import 的
 * `platform.js`（流程模型页 `list.vue:83`、AI审核配置 `api.js:1`、流程实例页 `list.vue:108`、
 * 流程任务页 `list.vue:67`）。
 */
export function createFlowManageCapability (
  /** 流程模型页的请求上下文 */
  requestModel: PortalRequest,
  /** AI审核配置页的请求上下文 */
  requestAiReview: PortalRequest,
  /** 流程实例页的请求上下文 */
  requestInstance: PortalRequest,
  /** 流程任务页的请求上下文 */
  requestTask: PortalRequest,
) {
  return {
    /**
     * 分页查询**流程模型**。只读。
     *
     * 三个筛选字段永远为空串、**照发**（页面没有 `convertFetchForm`）。
     * ⚠️ 每页条数在 URL 上叫 **`limit`**，本方法也照实收 `limit`。
     */
    listModels (query: FlowModelQuery = {}): Promise<PageResult<FlowModelRow>> {
      return requestModel<PageResult<FlowModelRow>>({
        url: FLOW_MANAGE_MODEL_LIST_PATH,
        method: 'get',
        params: buildParams(MODEL_QUERY, query as Record<string, unknown>),
      })
    },

    /** 编辑页读取模型详情；Portal 直接把结果作为编辑表单状态。 */
    getModel (input: { id: FlowManageId }): Promise<FlowModelForm> {
      const id = idText(input?.id, '流程模型 id')
      return requestModel<FlowModelForm>({
        url: `${FLOW_MANAGE_MODEL_GET_PATH}/${id}`,
        method: 'get',
      })
    },

    /** 新建页只做表单/文件校验，不创建模型。 */
    prepareModelCreate (input: FlowModelCreateInput): FlowModelCreatePreparation {
      return { draft: modelCreateDraftOf(input) }
    },

    /** Portal 新建流程模型实际走 multipart `/import`，不是 JSON `/create`。 */
    async createModel (input: { draft: FlowModelCreateDraft }): Promise<string> {
      const draft = modelCreateDraftOf(input?.draft)
      const result = await requestMultipart<unknown>(requestModel, {
        url: FLOW_MANAGE_MODEL_IMPORT_PATH,
        method: 'post',
        data: formDataWithModelFile(draft),
      })
      if (typeof result !== 'string' || result.trim() === '') throw new Error('新建流程模型响应必须是非空模型ID')
      return result
    },

    /** 新建页取消只丢弃本地文件/表单草稿。 */
    cancelModelCreate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 只整理 Portal 编辑页会提交的表单键，不发请求。 */
    prepareModelUpdate (input: { form: FlowModelForm | FlowModelUpdateDraft }): FlowModelUpdatePreparation {
      return { draft: buildModelUpdateDraft(input?.form) }
    },

    /** PUT /bpm/hr/model/update；draft 应原样来自 prepareModelUpdate。 */
    async updateModel (input: { draft: FlowModelUpdateDraft }): Promise<void> {
      const draft = modelUpdateDraftOf(input?.draft)
      await requestModel<unknown>({
        url: FLOW_MANAGE_MODEL_UPDATE_PATH,
        method: 'put',
        data: draft,
      })
    },

    /** Portal 编辑页的取消按钮只返回上一页，不产生请求。 */
    cancelModelUpdate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** Portal 部署按钮发送 JSON body `{ id }`，不是 query 参数。 */
    async deployModel (input: { id: FlowManageId }): Promise<void> {
      const id = idText(input?.id, '流程模型 id')
      await requestModel<unknown>({
        url: FLOW_MANAGE_MODEL_DEPLOY_PATH,
        method: 'post',
        data: { id },
      })
    },

    /** Portal switch 只在列表行有 suspensionState 时显示，且只提交相反状态。 */
    async updateModelState (input: FlowModelStateInput): Promise<void> {
      const id = idText(input?.id, '流程模型 id')
      const currentState = modelStateOf(input?.currentState, '当前流程模型状态')
      const state = modelStateOf(input?.state, '目标流程模型状态')
      if (currentState === state) throw new Error('目标流程模型状态必须与当前状态相反')
      await requestModel<unknown>({
        url: FLOW_MANAGE_MODEL_UPDATE_STATE_PATH,
        method: 'put',
        data: { id, state },
      })
    },

    /** Portal 列表单删拼接路径参数，DELETE 不带 body/query。 */
    async deleteModel (input: { id: FlowManageId }): Promise<void> {
      const id = idText(input?.id, '流程模型 id')
      await requestModel<unknown>({
        url: `${FLOW_MANAGE_MODEL_DELETE_PATH}/${id}`,
        method: 'delete',
      })
    },

    /** 分配规则页只读列表；modelId / processDefinitionId 按 Portal 路由查询参数透传。 */
    listTaskAssignRules (query: { modelId?: FlowManageId; processDefinitionId?: FlowManageId } = {}): Promise<FlowTaskAssignRuleRow[]> {
      const params: Record<string, string> = {}
      if (query.modelId !== undefined) params.modelId = idText(query.modelId, '流程模型 id')
      if (query.processDefinitionId !== undefined) params.processDefinitionId = idText(query.processDefinitionId, '流程定义 id')
      return requestModel<FlowTaskAssignRuleRow[]>({
        url: FLOW_MANAGE_MODEL_RULE_LIST_PATH,
        method: 'get',
        params,
      })
    },

    /** 规则新增页的保存前整理；只读，不调用 POST。 */
    prepareTaskAssignRuleCreate (input: { form: FlowTaskAssignRuleCreateForm }): FlowTaskAssignRuleCreatePreparation {
      return { draft: buildTaskAssignRuleCreateDraft(input?.form) }
    },

    /** POST /bpm/hr/task-assign-rule/create；Java Create DTO 实际消费 modelId/taskDefinitionKey/type/options。 */
    async createTaskAssignRule (input: { draft: FlowTaskAssignRuleCreateDraft }): Promise<FlowManageId> {
      const draft = buildTaskAssignRuleCreateDraft(input?.draft)
      const result = await requestModel<unknown>({
        url: FLOW_MANAGE_MODEL_RULE_CREATE_PATH,
        method: 'post',
        data: draft,
      })
      return numericId(result, '新增任务分配规则响应 id')
    },

    /** 新增规则取消只丢弃本地草稿；Java 没有规则删除接口，不能撤销已提交的规则。 */
    cancelTaskAssignRuleCreate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 规则编辑页的保存前整理；更新只提交 id/type/options。 */
    prepareTaskAssignRuleUpdate (input: { form: FlowTaskAssignRuleUpdateDraft }): FlowTaskAssignRuleUpdatePreparation {
      return { draft: buildTaskAssignRuleUpdateDraft(input?.form) }
    },

    /** PUT /bpm/hr/task-assign-rule/update；键形严格为 id/type/options。 */
    async updateTaskAssignRule (input: { draft: FlowTaskAssignRuleUpdateDraft }): Promise<void> {
      const draft = taskAssignRuleUpdateDraftOf(input?.draft)
      await requestModel<unknown>({
        url: FLOW_MANAGE_MODEL_RULE_UPDATE_PATH,
        method: 'put',
        data: draft,
      })
    },

    /** 规则编辑页取消不发请求。 */
    cancelTaskAssignRule (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 分页查询 **AI审核配置**。只读。
     *
     * ⚠️ 这一页会把**所有空值整个丢掉**（`removeEmptyParams`），连 `order` / `orderField`
     * 这对恒为空串的键也不放过 —— 所以不填筛选时 URL 上只剩分页参数。
     * `enabled=false` 会照发（`false` 不是空值）。
     */
    listAiReviewConfigs (
      query: AiReviewConfigQuery = {},
    ): Promise<PageResult<AiReviewConfigRow>> {
      const rangeError = rangePairError(query.createTimeStart, query.createTimeEnd, 'AI审核配置')
      if (rangeError) return Promise.reject(rangeError)
      const createTime =
        query.createTimeStart === undefined ? [] : [query.createTimeStart, query.createTimeEnd]
      const params = buildParams(AI_REVIEW_QUERY, query as Record<string, unknown>, { createTime })
      return requestAiReview<PageResult<AiReviewConfigRow>>({
        url: FLOW_MANAGE_AI_REVIEW_LIST_PATH,
        method: 'get',
        params: removeEmptyParams(params),
      })
    },

    /** AI审核配置编辑页通过 query 参数读取单条配置。 */
    getAiReviewConfig (input: { id: FlowManageId }): Promise<AiReviewConfigForm> {
      const id = numericId(input?.id, 'AI审核配置 id')
      return requestAiReview<AiReviewConfigForm>({
        url: FLOW_MANAGE_AI_REVIEW_GET_PATH,
        method: 'get',
        params: { id },
      })
    },

    /** AI审核配置新建页的表单校验与清洗；不发请求。 */
    prepareCreateAiReviewConfig (input: { form: AiReviewConfigForm }): AiReviewConfigPreparation {
      return { draft: buildAiReviewDraft(input?.form, 'create') }
    },

    /** POST /bpm/ai-review-config/create。 */
    async createAiReviewConfig (input: { draft: AiReviewConfigDraft }): Promise<void> {
      const draft = aiReviewDraftOf(input?.draft, 'create')
      await requestAiReview<unknown>({
        url: FLOW_MANAGE_AI_REVIEW_CREATE_PATH,
        method: 'post',
        data: draft,
      })
    },

    /** AI审核配置编辑页的表单校验与清洗；不发请求。 */
    prepareUpdateAiReviewConfig (input: { form: AiReviewConfigForm }): AiReviewConfigPreparation {
      return { draft: buildAiReviewDraft(input?.form, 'update') }
    },

    /** PUT /bpm/ai-review-config/update。 */
    async updateAiReviewConfig (input: { draft: AiReviewConfigDraft }): Promise<void> {
      const draft = aiReviewDraftOf(input?.draft, 'update')
      await requestAiReview<unknown>({
        url: FLOW_MANAGE_AI_REVIEW_UPDATE_PATH,
        method: 'put',
        data: draft,
      })
    },

    /** Portal 删除按钮使用 query `id`，不是 DELETE body。 */
    async deleteAiReviewConfig (input: { id: FlowManageId }): Promise<void> {
      const id = numericId(input?.id, 'AI审核配置 id')
      await requestAiReview<unknown>({
        url: FLOW_MANAGE_AI_REVIEW_DELETE_PATH,
        method: 'delete',
        params: { id },
      })
    },

    /** AI审核配置表单取消不发请求。 */
    cancelAiReviewConfig (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 分页查询**流程实例**（全公司）。列表查询只读；管理员取消见 prepareAdminCancel / submitAdminCancel。
     *
     * 与各流程表单线的 `*-my-instances`（`/bpm/process-instance/my-page`）**不是同一个能力**：
     * 那些看的是"我发起的"，这一个看的是所有人。
     */
    listProcessInstances (
      query: ProcessInstanceQuery = {},
    ): Promise<PageResult<ProcessInstanceRow>> {
      const rangeError = rangePairError(query.createTimeStart, query.createTimeEnd, '流程实例')
      if (rangeError) return Promise.reject(rangeError)
      const createTime =
        query.createTimeStart === undefined ? [] : [query.createTimeStart, query.createTimeEnd]
      return requestInstance<PageResult<ProcessInstanceRow>>({
        url: FLOW_MANAGE_INSTANCE_LIST_PATH,
        method: 'get',
        params: buildParams(INSTANCE_QUERY, query as Record<string, unknown>, { createTime }),
      })
    },

    /** Portal 仅在列表行 status === 1 时显示管理员取消按钮。 */
    prepareAdminCancel (input: FlowAdminCancelInput): FlowAdminCancelPreparation {
      if (input?.currentStatus !== 1) {
        throw new Error('流程实例当前状态必须为 1（运行中）才能取消')
      }
      return { currentStatus: 1, draft: adminCancelDraftOf(input) }
    },

    /** DELETE /bpm/process-instance/cancel-by-admin，body `{ id, reason }`。 */
    async submitAdminCancel (input: { draft: FlowAdminCancelDraft }): Promise<void> {
      const draft = adminCancelDraftOf(input?.draft)
      await requestInstance<unknown>({
        url: FLOW_MANAGE_INSTANCE_CANCEL_PATH,
        method: 'delete',
        data: draft,
      })
    },

    /** 管理员取消弹窗的取消按钮不发请求。 */
    cancelAdminCancelForm (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 分页查询**流程任务**（全公司任务流水）。只读。
     *
     * ⚠️ 与 `flow-task.ts` 的 `listTodo` / `listDone` **不是同一个接口**：
     * 那些是"我的待办/已办"（`/bpm/hr/task/list-by-category-web`），
     * 这一条是"全公司每一件事的每一步"（`/bpm/task/manager-page`），行结构也不同
     * （这一条的流程名/发起人有活干在 `processInstance` 下）。
     */
    listFlowTasks (
      query: FlowTaskManagerQuery = {},
    ): Promise<PageResult<FlowTaskManagerRow>> {
      const rangeError = rangePairError(query.createTimeStart, query.createTimeEnd, '流程任务')
      if (rangeError) return Promise.reject(rangeError)
      const createTime =
        query.createTimeStart === undefined ? [] : [query.createTimeStart, query.createTimeEnd]
      return requestTask<PageResult<FlowTaskManagerRow>>({
        url: FLOW_MANAGE_TASK_LIST_PATH,
        method: 'get',
        params: buildParams(TASK_MANAGER_QUERY, query as Record<string, unknown>, { createTime }),
      })
    },
  }
}

export type FlowManageCapability = ReturnType<typeof createFlowManageCapability>
