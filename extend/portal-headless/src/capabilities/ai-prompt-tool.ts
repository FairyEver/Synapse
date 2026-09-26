import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 人工智能 → 提示工程 的**「工具 / 接口绑定」三页**。
 *
 * | 页面 | 菜单路径 | 权限码 | 路由文件 | 接口前缀 |
 * | --- | --- | --- | --- | --- |
 * | 业务事件绑定技能 | `/dashboard/platform/intelligence/prompt/business-event/list` | `/dashboard/platform-v2/intelligence/prompt/business-event` | `…/prompt/business-event/list.vue` | `/admin-api/ai/business-event` |
 * | 开放接口 | `/dashboard/platform/intelligence/prompt/interface/list` | `/dashboard/platform/intelligence/prompt/interface` | `…/prompt/interface/list.vue` | `/admin-api/system/openApiRegistry` |
 * | 工具提示词绑定 | `/dashboard/platform/intelligence/prompt/template/list` | `/dashboard/platform-v2/intelligence/prompt/template` | `…/prompt/template/list.vue` | `/admin-api/sales/ai-template` |
 *
 * 路由文件的前缀都是 `app/portal/views/dashboard/platform/intelligence/`。
 *
 * ## 三处**不能互相照抄**的差异（这一组是三种不同形态）
 *
 * 1. **参数装配的方式三页三个样。**
 *    - 业务事件：`customLoad` **逐个挑字段**（`pageNo/pageSize/eventName/ownerModule/useSystem`），
 *      所以 `useListPageModule` 塞进去的 `order`/`orderField` **进不了 URL**；
 *    - 开放接口：`customLoad` 直接就是 `getOpenApiRegistryPage`，它也是逐个挑字段；
 *    - 工具提示词绑定：`customLoad` 把**整个 params** 原样交给 `http.get(…/page, { params: form })`
 *      —— 于是 `order=`/`orderField=` **真的在 URL 上**，而且排在 `func` 前面。
 * 2. **空值的处理也不一样**：业务事件的 `eventName` 是 `String(x || '').trim() || undefined`
 *    （**空串 → undefined → 整项不发**），而开放接口的 `name` 是原样传（**空串照发成 `name=`**）。
 * 3. **删除的形态三页三个样**：
 *    - 业务事件 / 工具提示词绑定：`DELETE …/delete` + query `id`；
 *    - 开放接口：`DELETE …/delete/{id}` —— **路径里带 id，query 里还重复一个 `id`**。
 *
 * ## http 实例：三页都是 `platform`（推导结论，不是猜的）
 *
 * 三个 `api.js` / 页面文件都显式 `import { http } from 'app/portal/utils/http/platform.js'`，
 * 而 `HTTP_INSTANCE_PAGE_RULES` 里**没有**这三条路径。按 `resolveHttpInstance` 的优先级
 * （请求级声明 → 页面规则 → 全局默认），三条都落到 `global-default = platform`
 * （conventions 24 / 26）。所以能力定义里**不写 `httpInstance`**。
 *
 * ⚠️ 三个前缀**都已经自带 `/admin-api`**，而 `platform.js:18-20` 的前缀拦截器
 * 对已带 `/admin-api` 的**透传不补**（conventions 25）—— 所以路径里必须原样带上，
 * 少写一段不会补回来，只会打到 `/ai/business-event/page` 这种不存在的路径上。
 *
 * ## module-type：三页都**不发**这个头
 *
 * `generated/page-catalog.json` 里这三行的 `moduleType` 全是 `null`，即规则表里匹配不到。
 * 与浏览器一致（conventions 2 / D34）——**不要**给它编一个。
 *
 * ## 候选（长选项）从哪来
 *
 * | 参数 | 候选来源 | SDK 侧 |
 * | --- | --- | --- |
 * | 业务事件的 `ownerModule` | 字典 `ai_business_owner_module`（页面用 `portal-platform-dict-select`） | `base-dict-get`（`dictType=ai_business_owner_module`） |
 * | 业务事件的 `useSystem` | **页面本地常量** `SYSTEM_OPTIONS_ALL`（`app/portal/utils/define.js:144`） | 直接写进 `enum` 的 options（9 项，值 0/1/2/3/4/5/6/7/10） |
 * | 业务事件的 `skillConfigId` | `GET /admin-api/ai/business-event/available-skill/page` | 本文件的 `ai-business-event-available-skill-list` |
 * | 开放接口的 `httpMethod` | 字典 `open_api_http_method_type` | `base-dict-get`（`dictType=open_api_http_method_type`） |
 * | 开放接口的 `status` / `enabled` | **页面本地常量**（`define.js`） | 直接写进 `enum` 的 options |
 * | 工具提示词绑定的 `funcId` | 字典 `Prompt_word_template`（页面用 `portal-common-dict-select`） | `base-dict-get`（`dictType=Prompt_word_template`） |
 * | 工具提示词绑定的 `useType` | `GET /admin-api/system/tip-type/page` —— **就是「提示词类型」页的列表接口** | `ai-prompt-tip-type-list`（另一条线 `ai-prompt.ts` 的能力，`lookup` 指它） |
 * | 工具提示词绑定的 `templateId` | `GET /admin-api/sys/tip-template/page?typeId=` —— **就是「技能列表」页的列表接口** | `ai-prompt-skill-list`（同上） |
 *
 * 最后两行的候选入口**都是另一条线（`ai-prompt.ts`）的页面能力**，本文件只做 `lookup` 引用、
 * **不重复实现**：页面自己那两条候选调用是 `loopFetch` **无关键字全量循环**（每页 100 × 最多 100 页），
 * 正是 conventions 11 说无头不能照抄的形式；而那两个页面能力接受关键字，才是 SDK 侧的入口。
 *
 * ## 写链路：`prepare()` → `submit()` → `cancel()`，三步分开
 *
 * 这三页都**没有审批流**（后端没有"这次要人工指定哪些审批人"那种接口），所以 `prepare` 不是
 * 会议室那条线上的审批人预问，而是**「把要发的东西先算出来、把撤销所需的服务端事实先读出来」**：
 *
 * - `prepareXxx()` —— **只读**：跑一遍页面自己的本地校验，必要时 `GET` 一次当前状态，
 *   返回一个 `WritePlan`（里面同时写着要发的写请求与撤销用的写请求）。
 * - `submitXxx(plan)` —— **真写**：只发 `plan.request` 那一条。
 * - `cancelXxx(plan)` —— **撤销**：只发 `plan.undo` 那条。`undo === null` 时**抛**，
 *   说明这个动作在这一页上撤不回来（不是静默什么都不做）。
 *
 * ### `prepareUpdate` 是「GET → 合并 → 重算」，不是「拿调用方给的字段硬拼」
 *
 * 三页的编辑页都是**先 `GET` 把表单灌满、用户改几项、再把整张表单提交**。
 * 所以 `prepareUpdate` 复刻的是这个顺序：GET 当前值 → 把调用方**显式给了**的字段盖上去
 * → 用与页面**同一个**组装函数重算请求体。漏传的字段**不会被清空**，
 * 这与"先 `get` 再自己拼全"相比少一次出错的机会。
 *
 * 为什么要返回一个 plan 而不是三个独立参数：`update` 是**整单替换**，
 * "提交前先读到的当前值"既是提交体的底稿、又是撤销体 —— 读一次、两处用，
 * 就不会出现"撤销用的快照和提交用的快照不是同一份"这种错。
 *
 * ### 哪些动作**撤不回来**（如实写在 `undo: null` 上）
 *
 * | 动作 | 撤销 | 理由 |
 * | --- | --- | --- |
 * | 新建 | 可以（`remove`） | 但 `create` **不回传新 id**（三页都是 `success(null)`），而撤销要在提交后才知道 id ⇒ `prepareCreate` 的 `undo` 是 `null`，见各自的 `note` |
 * | 修改 | 可以（原值写回） | `prepare` 里已经读到了原值 |
 * | 启停 | 可以（原值写回） | 同上 |
 * | 删除 | **撤不回** | 逻辑删除，**没有**恢复接口 |
 * | 重试一次技能执行 | **撤不回** | 它**真的把技能又跑了一遍**（`BusinessEventExecuteServiceImpl.retry` 同步调 `newSkillExecutor.execute`），副作用在技能里，不是一条可以回滚的记录 |
 *
 * ## 三个写操作**重发一次的后果**不一样（conventions 14 要按动作收窄）
 *
 * | 写能力 | 重发一次的后果 | 要不要防重 |
 * | --- | --- | --- |
 * | `create` | **多一条记录**（后端零幂等） | **要**（门面的 `createIdempotent`，由接线方挂） |
 * | `update` / `set-enabled` | 同样的值再写一次，终态相同 | 不要 |
 * | `remove` | 重复删仍是"删除完成" | 不要 |
 * | `record-retry` | **技能被再执行一次**（真的又跑一遍） | **要**：这不是幂等动作，重发 = 再跑一次 |
 *
 * ## 验证状态（**先说清楚哪些是验过的、哪些不是**）
 *
 * - **浏览器基准证实的（判据，conventions 31）**：`baseline/ai-prompt-tool.browser.json`
 *   （2026-09-21 抓到）里有这三页各自的那一条列表请求，**与源码推导逐字段相符、没有冲突**：
 *
 *   ```
 *   GET /admin-api/ai/business-event/page?pageNo=1&pageSize=20&_t=<ts>
 *   GET /admin-api/system/openApiRegistry/getByPage?pageNo=1&pageSize=20&name=&_t=<ts>
 *   GET /admin-api/sales/ai-template/page?order=&orderField=&func=&pageNo=1&pageSize=20&_t=<ts>
 *   ```
 *
 *   同一份基准还**实测**了请求头里没有 `module-type`（16 页 0 条），与"规则表匹配不到就不发"一致。
 *   ⚠️ 但基准那一轮**全是只读 GET**，所以下面两行才是其余部分的依据。
 * - **源码读出来的**：三个页面的全部请求形状、参数键序、空值发不发、页面自己的校验规则。
 *   前提是"本地检出这一版就是线上那一版"——本组三页的路由文件与 `api.js` 已由派单方与线上逐文件 diff 过。
 * - **后端代码证实的**：端点路径、`@RequestParam` / `@PathVariable` 形态、必填字段、状态枚举、
 *   **匹配语义**（`eventName`/`func` 是包含、开放接口的 `name` 是前缀）
 *   （`erp-module-ai` 的 `BusinessEventController` / `BusinessEventRecordController` +
 *   `AiBusinessEventMapper` / `AiSkillV2ConfigMapper`、`erp-module-system` 的 `OpenApiController` +
 *   `OpenApiMapper.xml` + `OpenApiDetailRespVO`、`erp-module-sales` 的 `SalesAiFuncTemplateController`）。
 * - **仍然只有源码 + 后端代码两份证据的**（基准没覆盖）：**三个写请求体的键序**、
 *   `DELETE` 的形态、`available-skill/page` 带不带 `useSystem`、`get` / `record/*` / `scanByUrl` 的形状。
 * - **真机验证：未做**（本轮没有对测试环境发过任何请求；验证清单在
 *   `docs/pages/{业务事件绑定技能,开放接口,工具提示词绑定}.md` 的最后一节，由派单方统一跑）。
 */

// ---------------------------------------------------------------------------
// 页面与端点常量
// ---------------------------------------------------------------------------

export const AI_BUSINESS_EVENT_PAGE_PATH = '/dashboard/platform/intelligence/prompt/business-event/list'
export const AI_OPEN_API_REGISTRY_PAGE_PATH = '/dashboard/platform/intelligence/prompt/interface/list'
export const AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH = '/dashboard/platform/intelligence/prompt/template/list'

const VIEWS = 'app/portal/views/dashboard/platform/intelligence/prompt'

/** 路由文件，排障时用得上 */
export const AI_PROMPT_TOOL_ROUTE_FILES = {
  businessEvent: `${VIEWS}/business-event/list.vue`,
  businessEventForm: `${VIEWS}/business-event/[mode]/[id].vue`,
  businessEventRecords: `${VIEWS}/business-event/detail/[id].vue`,
  openApiRegistry: `${VIEWS}/interface/list.vue`,
  openApiRegistryForm: `${VIEWS}/interface/[mode]/[id].vue`,
  promptTemplateBinding: `${VIEWS}/template/list.vue`,
  promptTemplateBindingForm: `${VIEWS}/template/[mode]/[id].vue`,
} as const

/**
 * 权限码。
 *
 * - 业务事件 / 工具提示词绑定取**页面 `<route>` 块里的 `meta.permission`**（两页都写了）；
 * - 开放接口的 `<route>` 块**没有 `permission`**，取 `generated/page-catalog.json` 的值
 *   （与菜单 `app/portal/menus/mall.v2.js:232` 逐字相同 —— 那一行**确实没有** `platform-v2` 前缀）。
 *
 * 工具提示词绑定在当前菜单入口、`mall.v2.js:233` 与页面 `<route>` meta 中使用同一条
 * `platform-v2` 权限；`page-catalog.json` 也按该有效来源记录。
 */
export const AI_BUSINESS_EVENT_PERMISSION = '/dashboard/platform-v2/intelligence/prompt/business-event'
export const AI_OPEN_API_REGISTRY_PERMISSION = '/dashboard/platform/intelligence/prompt/interface'
export const AI_PROMPT_TEMPLATE_BINDING_PERMISSION = '/dashboard/platform-v2/intelligence/prompt/template'

/** `business-event/api.js` 的 `BASE_URL` —— 展开成真实的绝对路径 */
export const BUSINESS_EVENT_BASE_URL = '/admin-api/ai/business-event'

export const BUSINESS_EVENT_PATHS = {
  page: `${BUSINESS_EVENT_BASE_URL}/page`,
  get: `${BUSINESS_EVENT_BASE_URL}/get`,
  create: `${BUSINESS_EVENT_BASE_URL}/create`,
  update: `${BUSINESS_EVENT_BASE_URL}/update`,
  updateEnabled: `${BUSINESS_EVENT_BASE_URL}/update-enabled`,
  remove: `${BUSINESS_EVENT_BASE_URL}/delete`,
  availableSkillPage: `${BUSINESS_EVENT_BASE_URL}/available-skill/page`,
  recordPage: `${BUSINESS_EVENT_BASE_URL}/record/page`,
  recordGet: `${BUSINESS_EVENT_BASE_URL}/record/get`,
  recordRetry: `${BUSINESS_EVENT_BASE_URL}/skill-record/retry`,
} as const

/** `interface/api.js` 的六个常量 —— 一个都不少地展开 */
export const OPEN_API_REGISTRY_PATHS = {
  create: '/admin-api/system/openApiRegistry/create',
  update: '/admin-api/system/openApiRegistry/update',
  page: '/admin-api/system/openApiRegistry/getByPage',
  detail: '/admin-api/system/openApiRegistry/get',
  remove: '/admin-api/system/openApiRegistry/delete',
  scan: '/admin-api/system/openApiRegistry/scanByUrl',
} as const

/** 工具提示词绑定页**没有 `api.js`**，路径是页面里写死的字面量 */
export const AI_TEMPLATE_PATHS = {
  page: '/admin-api/sales/ai-template/page',
  get: '/admin-api/sales/ai-template/get',
  create: '/admin-api/sales/ai-template/create',
  update: '/admin-api/sales/ai-template/update',
  remove: '/admin-api/sales/ai-template/delete',
} as const

/** `useListPageModule({ styleV2: true })` → 20（`common/libs/renren/list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 页面 `param-tree.js` 里写死的那个上限（`validateParamTree` / `collectParamValidationErrors`） */
export const OPEN_API_PARAM_VALUE_MAX_LENGTH = 800

// ---------------------------------------------------------------------------
// 页面本地常量（逐字抄页面，不要"顺手整理"）
// ---------------------------------------------------------------------------

/** 页面 `define.js` 的 `SYSTEM_OPTIONS_ALL`（`app/portal/utils/define.js:144-154`） */
export const USE_SYSTEM_OPTIONS = [
  { label: '公共', value: 0 },
  { label: '人力', value: 1 },
  { label: '财务', value: 2 },
  { label: '资产', value: 3 },
  { label: '生产', value: 4 },
  { label: '采购', value: 5 },
  { label: '销售', value: 6 },
  { label: '门户', value: 7 },
  { label: '平台', value: 10 },
] as const

export const OWNER_MODULE_DICT_TYPE = 'ai_business_owner_module'
export const PROMPT_WORD_TEMPLATE_DICT_TYPE = 'Prompt_word_template'
export const OPEN_API_HTTP_METHOD_DICT_TYPE = 'open_api_http_method_type'

/**
 * 工具提示词绑定那两个候选入口 —— **指向同域另一条线（`ai-prompt.ts`）的页面能力**。
 *
 * 为什么是它们而不是页面自己那两条调用：页面拉候选用的是 `loopFetch` **无关键字全量循环**
 * （每页 100 × 最多 100 页），正是 conventions 11 说无头不能照抄的那种做法。
 * SDK 侧的对应入口是**那两个页面自己的列表能力**（它们接受关键字），所以 `lookup` 指它们：
 *
 * | 参数 | 页面自己的调用 | SDK 侧入口 |
 * | --- | --- | --- |
 * | `useType` | `GET /admin-api/system/tip-type/page`（无参全量循环） | `ai-prompt-tip-type-list`（关键字 `name` = 类型值） |
 * | `templateId` | `GET /admin-api/sys/tip-template/page?typeId=`（按类型过滤，无名称关键字） | `ai-prompt-skill-list`（关键字 `name`；再用它自己的 `typeId` 收窄） |
 *
 * ⚠️ 这两个 id 属于**别的文件**，本文件只是引用。它们一旦改名，
 * `test/ai-prompt-tool.test.ts` 里那条"跨文件解析"的用例会**在我这边**先红，
 * 不会等到 `catalog.validate().lookups` 才发现。
 */
export const TIP_TYPE_LIST_LOOKUP = {
  capabilityId: 'ai-prompt-tip-type-list',
  keywordParam: 'name',
} as const

export const TEMPLATE_LIST_LOOKUP = {
  capabilityId: 'ai-prompt-skill-list',
  keywordParam: 'name',
} as const

export const EVENT_NAME_MIN_LENGTH = 2
export const EVENT_NAME_MAX_LENGTH = 50
export const EVENT_DESCRIPTION_MAX_LENGTH = 500
export const BINDING_DESCRIPTION_MAX_LENGTH = 300
export const MAX_SKILL_BINDING_COUNT = 100
export const SKILL_PUBLISH_STATUS_PUBLISHED = 1

/** 界面状态码（页面 `define.js` 的 `INTERFACE_STATUS`） */
export const INTERFACE_STATUS = { pending: 0, normal: 1, error: 2 } as const
/** 是否开放（页面 `define.js` 的 `OPEN_API_ENABLED`） */
export const OPEN_API_ENABLED = { disabled: 0, enabled: 1 } as const

/** 执行记录状态（页面 `define.js` 的 `BUSINESS_EVENT_RECORD_STATUS`） */
export const BUSINESS_EVENT_RECORD_STATUS = {
  pending: 0,
  running: 1,
  success: 2,
  failed: 3,
  skipped: 4,
  timeout: 5,
} as const

/** 可重试的三种状态（页面 `RETRYABLE_RECORD_STATUS`） */
export const RETRYABLE_RECORD_STATUS = [3, 4, 5] as const

/** 参数位置（页面 `define.js` 的 `PARAM_POSITION`） */
export const PARAM_POSITION = {
  query: 'query',
  path: 'path',
  body: 'body',
  header: 'header',
} as const

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type BusinessEventRow = { id?: number | string; [key: string]: unknown }
export type BusinessEventRecordRow = { id?: number | string; [key: string]: unknown }
export type OpenApiRegistryRow = { id?: number | string; [key: string]: unknown }
export type AiTemplateRow = { id?: number | string; [key: string]: unknown }

/** 一个写步骤：`submit` 只发它，`cancel` 只发 `undo` */
export type WriteStep = {
  url: string
  method: 'post' | 'put' | 'delete'
  /** POST/PUT 的提交体 */
  data?: Record<string, unknown>
  /** DELETE 的 query */
  params?: Record<string, unknown>
}

/**
 * 写链路的一步计划。
 *
 * `prepare` **只读**，产出它；`submit` 只发 `request`；`cancel` 只发 `undo`。
 * 三步分开是 conventions 13 / `invoke.ts` 的硬要求（"不能在这里合并"）。
 */
export type WritePlan = {
  request: WriteStep
  /** 撤销它要发的那个请求；`null` = 这一页上撤不回来（见文件头那张表，`cancel` 会**抛**） */
  undo: WriteStep | null
  /** 给调用方看的说明：读了什么、撤销时要注意什么 */
  note: string
}

// ---------------------------------------------------------------------------
// 业务事件：页面 `utils.js` 的逐字搬运
// ---------------------------------------------------------------------------

export type BusinessEventSkillBinding = {
  /** 技能配置 id。候选见 `ai-business-event-available-skill-list` */
  skillConfigId: number | string
  /** 执行说明，可空（空 → `null`） */
  description?: string | null
  /**
   * 发布状态。**不会进请求体**：它只给本地校验用（页面的 `validateSkillBindings`
   * 拿 `bindingByKey` 里那份 `publishStatus` 判"启用事件至少绑定 1 个已发布技能"）。
   * 要给就照实传 `available-skill/page` 返回的那个值；不传则跳过这条校验。
   */
  publishStatus?: number | null
}

/** 业务事件的**表单**字段（页面 `createEmptyBusinessEventForm` / `normalizeBusinessEventDetail`） */
export type BusinessEventDraft = {
  /** 改的时候必填；新建**不要**给（页面只在 `form.id != null` 时才把它放进请求体） */
  id?: number | string
  eventName?: string
  /** 责任模块，候选是字典 `ai_business_owner_module` 的值 */
  ownerModule?: string
  /** 使用系统，新建时必填（页面 `rules.useSystem` 是 `required`，后端 `@NotNull`） */
  useSystem?: number | string | null
  description?: string | null
  enabled?: boolean
  /** 按执行顺序排列；顺序就是执行顺序。**不给就用 GET 回来的那份**（见 `prepareUpdate`） */
  skillBindings?: BusinessEventSkillBinding[]
}

export type BusinessEventQuery = {
  pageNo?: number
  pageSize?: number
  /** 事件名称。后端是**包含匹配**（MyBatis-Plus 的 `likeIfPresent` ⇒ `%x%`），与「开放接口」那页的前缀 like 不同 */
  eventName?: string
  /** 责任模块，候选见字典 `ai_business_owner_module` */
  ownerModule?: string
  /** 使用系统，取值见 `USE_SYSTEM_OPTIONS` */
  useSystem?: number | string
}

export type BusinessEventAvailableSkillQuery = {
  pageNo?: number
  pageSize?: number
  /** 技能名称（模糊），空串 → 不发这一项 */
  skillName?: string
  /** 使用系统。⚠️ 后端**当前会把它置空**（`BusinessEventController` 里那行 `reqVO.setUseSystem(null)`，注释写着"UseSystem不作为条件"），页面仍然照发 */
  useSystem: number | string
}

export type BusinessEventRecordQuery = {
  pageNo?: number
  pageSize?: number
  /** 事件编码，来自事件行的 `eventCode`。**空的时候页面根本不发请求** */
  eventCode: string
}

/** 页面 `utils.js` 的 `trimToNull` */
function trimToNull (value: unknown): string | null {
  const result = String(value ?? '').trim()
  return result || null
}

/** 页面 `utils.js` 的 `isPublishedSkill` */
function isPublishedSkill (skill: { publishStatus?: number | null } | undefined): boolean {
  return Number(skill?.publishStatus) === SKILL_PUBLISH_STATUS_PUBLISHED
}

/** 页面 `createEmptyBusinessEventForm` 的键序 */
export function createEmptyBusinessEventForm (): Record<string, unknown> {
  return {
    id: null,
    eventCode: '',
    eventName: '',
    ownerModule: '',
    useSystem: null,
    description: '',
    enabled: true,
  }
}

/**
 * 页面 `utils.js` 的 `normalizeBusinessEventDetail`。
 *
 * 页面写的是 `{...createEmptyBusinessEventForm(), id, eventCode, eventName, ownerModule,
 * useSystem, description, enabled}` —— 键序就是这个（`id` 打头，`enabled` 收尾，`eventCode` 夹在
 * `id` 和 `eventName` 之间）。这里**逐个写出来**而不是展开，因为 `eventCode` 不参与提交体，
 * 摊开只会让"哪些字段真的会发出去"变得不清楚。
 */
export type BusinessEventForm = {
  id: unknown
  eventCode: string
  eventName: string
  ownerModule: string
  useSystem: number | string | null
  description: string
  enabled: boolean
}

export function normalizeBusinessEventDetail (source: Record<string, unknown> = {}): BusinessEventForm {
  return {
    id: source.id ?? null,
    eventCode: (source.eventCode as string) || '',
    eventName: (source.eventName as string) || '',
    ownerModule: (source.ownerModule as string) || '',
    // 页面是 `source.useSystem ?? null`；`buildBusinessEventPayload` 那边再做 `Number(...)`
    useSystem: (source.useSystem ?? null) as number | string | null,
    description: (source.description as string) || '',
    enabled: source.enabled !== false,
  }
}

/**
 * 页面 `utils.js` 的 `boundSkillsToBindingState` 里**与提交有关的那一半**：
 * 按 `sort` 升序、按 `skillConfigId` 去重，留下 `skillConfigId` 与 `description`。
 *
 * （另一半是给编辑器用的 `bindingByKey` 索引，提交时读不到它，这里不搬。）
 */
export function businessEventBindingsFromDetail (
  detail: Record<string, unknown> | null | undefined,
): BusinessEventSkillBinding[] {
  const bound = Array.isArray(detail?.boundSkills) ? (detail?.boundSkills as Array<Record<string, unknown>>) : []
  const sorted = [...bound].sort(
    (left, right) => Number(left?.sort || 0) - Number(right?.sort || 0),
  )
  const seen = new Set<string>()
  const result: BusinessEventSkillBinding[] = []
  for (const skill of sorted) {
    const key = skill?.skillConfigId == null ? '' : String(skill.skillConfigId)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({
      skillConfigId: skill.skillConfigId as number | string,
      description: (skill.description as string) || '',
      publishStatus: (skill.publishStatus as number) ?? null,
    })
  }
  return result
}

/**
 * 逐字复刻页面 `business-event/utils.js` 的 `buildBusinessEventPayload`，
 * **包括键的书写顺序**（D20：键序不同也算不一致）：
 *
 * ```js
 * { eventName, ownerModule, useSystem, description, enabled, skillBindings, [id] }
 * ```
 *
 * 三处与直觉不同的地方，都是页面原样如此：
 * 1. `ownerModule` **不是** `trimToNull`，是 `String(x || '').trim()` —— 空就是**空字符串**（照发）。
 * 2. `description` / 每条绑定的 `description` 是 `trimToNull` —— 空就是 **`null`**。
 * 3. `id` 只在 `!= null` 时出现，而且**追加在最后**（不是打头）。
 */
export function buildBusinessEventPayload (draft: BusinessEventDraft): Record<string, unknown> {
  const useSystem = Number(draft.useSystem)
  if (!Number.isFinite(useSystem)) {
    // 页面这里是 `Number(form.useSystem)`：表单没选时得到 NaN，`JSON.stringify` 把它变成 `null`，
    // 然后后端 `@NotNull` 才报错 —— 那是一个"请求发出去了但必然失败"的坏形状。SDK 提前拦。
    throw new Error('使用系统（useSystem）必填。取值见 USE_SYSTEM_OPTIONS（0 公共 / 1 人力 / … / 10 平台）')
  }
  const bindings = Array.isArray(draft.skillBindings) ? draft.skillBindings : []

  const payload: Record<string, unknown> = {
    eventName: String(draft.eventName ?? '').trim(),
    ownerModule: String(draft.ownerModule ?? '').trim(),
    useSystem,
    description: trimToNull(draft.description),
    enabled: Boolean(draft.enabled),
    skillBindings: bindings.map((binding) => ({
      skillConfigId: binding.skillConfigId,
      description: trimToNull(binding.description),
    })),
  }
  if (draft.id != null) payload.id = draft.id
  return payload
}

/**
 * 逐字复刻页面 `business-event/utils.js` 的 `validateBusinessEvent` / `validateSkillBindings`。
 *
 * 返回**第一条**错误消息（与页面一致：页面也是拿到第一条就 `message.warning` 并 return）；
 * 空串 = 通过。校验不过时**不发请求**。
 *
 * ⚠️ "启用事件至少绑定 1 个已发布技能"这一条，只有在调用方**给了** `publishStatus` 时才判：
 * 发布状态不在提交体里，SDK 自己查要另打 `available-skill/page`。
 * 不给就当调用方自己确认过 —— 文档里这么写，**不假装校验过**。
 */
export function validateBusinessEvent (draft: BusinessEventDraft): string {
  const eventName = String(draft?.eventName ?? '').trim()
  if (eventName.length < EVENT_NAME_MIN_LENGTH || eventName.length > EVENT_NAME_MAX_LENGTH) {
    return `事件名称长度必须为 ${EVENT_NAME_MIN_LENGTH}-${EVENT_NAME_MAX_LENGTH} 个字符`
  }
  if (draft?.useSystem == null || String(draft.useSystem) === '') return '请选择使用系统'
  if (String(draft?.description ?? '').length > EVENT_DESCRIPTION_MAX_LENGTH) {
    return `事件说明不能超过 ${EVENT_DESCRIPTION_MAX_LENGTH} 个字符`
  }

  const bindings = Array.isArray(draft.skillBindings) ? draft.skillBindings : []
  const enabled = Boolean(draft.enabled)
  if (bindings.length > MAX_SKILL_BINDING_COUNT) return `最多绑定 ${MAX_SKILL_BINDING_COUNT} 个技能`
  const keys = bindings.map((binding) => String(binding.skillConfigId))
  if (new Set(keys).size !== keys.length) return '同一个技能不能重复绑定'
  if (enabled && keys.length === 0) return '启用事件至少绑定 1 个已发布技能'
  for (const binding of bindings) {
    if (!(Number(binding.skillConfigId) > 0)) return '技能绑定数据不完整'
    if (binding.publishStatus != null && !isPublishedSkill(binding)) return '请先移除未发布技能再保存'
    if (String(binding.description ?? '').trim().length > BINDING_DESCRIPTION_MAX_LENGTH) {
      return `执行说明不能超过 ${BINDING_DESCRIPTION_MAX_LENGTH} 个字符`
    }
  }
  return ''
}

/**
 * `prepareUpdate` 的合并步骤：页面编辑态的 `formState` 就是
 * `{...GET 回来的值, ...用户改过的项}`。这里逐字复刻那个形状 ——
 * **只有调用方显式给了（`!== undefined`）的字段才覆盖**，其余保持 GET 到的那份。
 */
export function mergeBusinessEventDraft (
  current: Record<string, unknown> | null | undefined,
  draft: BusinessEventDraft,
): BusinessEventDraft {
  const form: BusinessEventForm = normalizeBusinessEventDetail(current ?? {})
  const pick = <T>(given: T | undefined, fallback: T): T => (given === undefined ? fallback : given)
  return {
    id: form.id as number | string,
    eventName: pick(draft?.eventName, form.eventName),
    ownerModule: pick(draft?.ownerModule, form.ownerModule),
    useSystem: pick(draft?.useSystem, form.useSystem),
    description: pick(draft?.description, form.description),
    enabled: pick(draft?.enabled, form.enabled),
    skillBindings: pick(draft?.skillBindings, businessEventBindingsFromDetail(current)),
  }
}

// ---------------------------------------------------------------------------
// 开放接口：页面 `api.js` / `define.js` / `param-tree.js` 的逐字搬运
// ---------------------------------------------------------------------------

export type OpenApiRegistryParamNode = {
  name?: string
  type?: string
  position?: string
  required?: boolean | string | number
  defaultValue?: string
  description?: string
  sort?: number | string
  children?: OpenApiRegistryParamNode[] | null
}

export type OpenApiRegistryDraft = {
  /** 改的时候必填（页面用 `form.id` 决定 POST 哪个端点） */
  id?: number | string
  name?: string
  apiPath?: string
  /** 取值见字典 `open_api_http_method_type`（页面是 `portal-common-dict-select`） */
  httpMethod?: string
  scopeKey?: string
  groupName?: string
  description?: string
  /** 页面字段名就是 `responseExample`（`responseResult` 是它的兜底别名） */
  responseExample?: string
  responseResult?: string
  /** ⚠️ 页面是 `String(form.sort || '')` —— **字符串**。空 → `''`（后端 Integer 会当成 null） */
  sort?: number | string
  status?: number | string
  enabled?: number | string | boolean
  params?: OpenApiRegistryParamNode[]
}

export type OpenApiRegistryQuery = {
  pageNo?: number
  pageSize?: number
  /** 接口名称，后端是**前缀 like**（手写 SQL：`AND name LIKE CONCAT(#{params.name}, '%')`）；⚠️ 空串**照发**成 `name=`（与业务事件那一页相反） */
  name?: string
  status?: number | string
  enabled?: number | string
}

/** 页面 `define.js` 的 `normalizeInterfaceStatus` */
export function normalizeInterfaceStatus (status: unknown): number {
  if (status === 'pending') return INTERFACE_STATUS.pending
  if (status === 'normal') return INTERFACE_STATUS.normal
  if (status === 'error') return INTERFACE_STATUS.error
  const statusNumber = Number(status)
  if ((Object.values(INTERFACE_STATUS) as number[]).includes(statusNumber)) return statusNumber
  return INTERFACE_STATUS.pending
}

/** 页面 `define.js` 的 `normalizeOpenApiEnabled` */
export function normalizeOpenApiEnabled (enabled: unknown): number {
  if (enabled === true || enabled === 'true') return OPEN_API_ENABLED.enabled
  return Number(enabled) === OPEN_API_ENABLED.enabled
    ? OPEN_API_ENABLED.enabled
    : OPEN_API_ENABLED.disabled
}

/** 页面 `param-tree.js` 的 `normalizeRequired`（注意返回的是**字符串**） */
export function normalizeParamRequired (value: unknown): 'true' | 'false' {
  if (value === false || value === 'false' || value === 0 || value === '0') return 'false'
  return 'true'
}

/** 页面 `param-tree.js` 的 `normalizeParamPosition` */
export function normalizeParamPosition (position: unknown): string {
  return (Object.values(PARAM_POSITION) as string[]).includes(position as string)
    ? (position as string)
    : PARAM_POSITION.query
}

/** 页面 `param-tree.js` 的 `hasParamValue` —— 决定一个参数节点**发不发** */
export function hasParamValue (item: OpenApiRegistryParamNode = {}): boolean {
  return Boolean(
    item.name ||
    item.defaultValue ||
    item.description ||
    item.position ||
    (item.type ?? 'string') !== 'string' ||
    normalizeParamRequired(item.required) !== 'true' ||
    (Array.isArray(item.children) && item.children.length),
  )
}

/**
 * 逐字复刻页面 `param-tree.js` 的 `normalizeParamTreeForSubmit`。
 *
 * 两处**看起来像笔误、其实是契约**的地方：
 * 1. `required` 在 wire 上是**字符串** `'true'`/`'false'`（后端 `OpenApiParamVO.required` 是 `Boolean`，
 *    Jackson 会把 `"true"` 转成 `true`）—— 别"顺手"改成布尔。
 * 2. `sort` 是 `String(index + 1)` —— **按同级下标重排**，不是保留调用方给的顺序值；
 *    后端字段是 `Integer`，数字字符串能被 Jackson 收下。
 */
export function buildOpenApiRegistryParamTreeForSubmit (
  list: OpenApiRegistryParamNode[] = [],
  parentPosition = '',
): Array<Record<string, unknown>> {
  return (Array.isArray(list) ? list : [])
    .filter(hasParamValue)
    .map((item, index) => {
      const position = parentPosition === PARAM_POSITION.body
        ? PARAM_POSITION.body
        : normalizeParamPosition(item.position || parentPosition)
      const children = buildOpenApiRegistryParamTreeForSubmit(item.children ?? [], position)
      return {
        name: item.name || '',
        type: item.type || 'string',
        position,
        required: normalizeParamRequired(item.required),
        defaultValue: item.defaultValue || '',
        description: item.description || '',
        sort: String(index + 1),
        children: children.length ? children : null,
      }
    })
}

/**
 * 逐字复刻页面 `interface/api.js` 的 `buildOpenApiRegistryCreatePayload`，
 * **包括键的书写顺序**：
 *
 * ```js
 * { name, apiPath, httpMethod, scopeKey, groupName, description,
 *   responseExample, sort, status, enabled, params }
 * ```
 *
 * 更新时页面用的是 `{ ...这份, id }` —— 所以 `id` **在最后**（见 `buildOpenApiRegistryUpdatePayload`）。
 */
export function buildOpenApiRegistryCreatePayload (
  draft: OpenApiRegistryDraft,
): Record<string, unknown> {
  return {
    name: draft?.name || '',
    apiPath: draft?.apiPath || '',
    httpMethod: draft?.httpMethod || '',
    scopeKey: draft?.scopeKey || '',
    groupName: draft?.groupName || '',
    description: draft?.description || '',
    responseExample: draft?.responseExample || draft?.responseResult || '',
    sort: String(draft?.sort || ''),
    status: normalizeInterfaceStatus(draft?.status),
    enabled: normalizeOpenApiEnabled(draft?.enabled),
    params: buildOpenApiRegistryParamTreeForSubmit(draft?.params ?? []),
  }
}

export function buildOpenApiRegistryUpdatePayload (
  draft: OpenApiRegistryDraft,
): Record<string, unknown> {
  return {
    ...buildOpenApiRegistryCreatePayload(draft),
    id: draft?.id,
  }
}

/** 开放接口草稿的本地校验：只锁后端 `@NotBlank` 的那些（页面还多两条，见参数说明） */
export function assertOpenApiRegistryDraft (draft: OpenApiRegistryDraft, requireId: boolean): void {
  const missing: string[] = []
  const required: Array<[keyof OpenApiRegistryDraft, string]> = [
    ['name', '接口名称'],
    ['apiPath', '接口地址'],
    ['httpMethod', '请求方式'],
    ['scopeKey', '权限标识'],
    ['groupName', '分组名称'],
    ['description', '接口描述'],
  ]
  for (const [key, label] of required) {
    if (String(draft?.[key] ?? '').trim() === '') missing.push(label)
  }
  if (requireId && (draft?.id === undefined || draft?.id === null || String(draft.id).trim() === '')) {
    missing.push('id')
  }
  if (missing.length) {
    throw new Error(`开放接口这些字段是必填的（后端 @NotBlank）：${missing.join(' / ')}`)
  }
}

/**
 * 页面 `param-tree.js` 的 `validateParamTree`（提交前跑的那一道）。
 *
 * ⚠️ 这条**必须**有：`hasParamValue` 把 `position` 也算作"有内容"，而编辑器新建出来的空行
 * 默认就带着 `position: 'query'`、`type: 'string'`、`required: 'true'` ——
 * 也就是说**页面上留着一行没填完的空行是存不下去的**（会报"参数存在未填写完整的参数"）。
 * SDK 不搬这一条，就会发出一个页面上根本发不出去的请求。
 *
 * 两条规则，与页面逐字一致：
 * 1. 只要一个节点"有内容"，`name` / `position` / `description` 都不能空，
 *    而且 `required === 'true'` 的叶子节点 `defaultValue` 也不能空；
 * 2. 任何节点的 `defaultValue` 不能超过 800 字。
 */
export function validateOpenApiRegistryParamTree (list: OpenApiRegistryParamNode[] = [], label = '参数'): void {
  if (findInvalidParamNode(list) !== null) {
    throw new Error(`${label}存在未填写完整的参数`)
  }
  if (findOversizedParamNode(list) !== null) {
    throw new Error(`${label}测试参数值最多 800 个字符`)
  }
}

function isLeafParamNode (item: OpenApiRegistryParamNode): boolean {
  return !(Array.isArray(item.children) && item.children.some(hasParamValue))
}

function findInvalidParamNode (list: OpenApiRegistryParamNode[] = []): OpenApiRegistryParamNode | null {
  for (const item of Array.isArray(list) ? list : []) {
    if (hasParamValue(item) && (
      !item.name ||
      !item.position ||
      (isLeafParamNode(item) && normalizeParamRequired(item.required) === 'true' && isEmptyValue(item.defaultValue)) ||
      !item.description
    )) {
      return item
    }
    const childInvalidNode = findInvalidParamNode(item.children ?? [])
    if (childInvalidNode !== null) return childInvalidNode
  }
  return null
}

function findOversizedParamNode (list: OpenApiRegistryParamNode[] = []): OpenApiRegistryParamNode | null {
  for (const item of Array.isArray(list) ? list : []) {
    if (hasParamValue(item) && String(item.defaultValue ?? '').length > OPEN_API_PARAM_VALUE_MAX_LENGTH) {
      return item
    }
    const childOversizedNode = findOversizedParamNode(item.children ?? [])
    if (childOversizedNode !== null) return childOversizedNode
  }
  return null
}

function isEmptyValue (value: unknown): boolean {
  return value == null || String(value) === ''
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

/** 按契约里的**固定顺序**拼 query：调用方的实参顺序不影响 URL（D20） */
function buildOrdered (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 业务事件分页的键序 —— 页面 `customLoad` 里就是这么写的：
 * `pageNo, pageSize, eventName, ownerModule, useSystem`。
 *
 * ⚠️ 三项的空值全是 **undefined**（`eventName` 走 `String(x || '').trim() || undefined`，
 * `ownerModule` 走 `x || undefined`，`useSystem` 走 `=== '' || == null` 判断），
 * 于是 `qs` 的 `skipNulls` 会把**整项丢掉**（`platform.js:63-67`）。
 */
export const BUSINESS_EVENT_LIST_ORDER = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'eventName', defaultValue: undefined },
  { name: 'ownerModule', defaultValue: undefined },
  { name: 'useSystem', defaultValue: undefined },
] as const

export const BUSINESS_EVENT_AVAILABLE_SKILL_ORDER = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'skillName', defaultValue: undefined },
  { name: 'useSystem', defaultValue: undefined },
] as const

export const BUSINESS_EVENT_RECORD_ORDER = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'eventCode', defaultValue: '' },
] as const

/**
 * 开放接口分页的键序 —— `getOpenApiRegistryPage` 里逐个挑的四个字段。
 *
 * ⚠️ 与业务事件那一页**相反**：`name` 是**原样传**（空串 → `name=`，**照发**），
 * 只有 `status` / `enabled` 走 `=== '' || == null → undefined` 被丢掉。
 * 另外这一页**不会**出现 `order`/`orderField`（`customLoad` 就是那个函数，它不挑这两个）。
 */
export const OPEN_API_REGISTRY_LIST_ORDER = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'name', defaultValue: '' },
  { name: 'status', defaultValue: undefined },
  { name: 'enabled', defaultValue: undefined },
] as const

/**
 * 工具提示词绑定分页的键序 —— ⚠️ **这一页会带上 `order`/`orderField`**。
 *
 * 页面是 `customLoad: async (form) => http.get('…/page', { params: form })`，
 * 而 `useListPageModule` 的 `logicFetch` 拼的是
 * `{ order, orderField, ...formState, pageNo, pageSize }`
 * （`common/libs/renren/list.js:475-481`）—— 整份原样发出去。
 * 所以 URL 上是 `order=&orderField=&func=&pageNo=1&pageSize=20`，
 * **别照抄隔壁两页把这两个省掉**。
 */
export const AI_TEMPLATE_LIST_ORDER = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'func', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
] as const

function normalizeId (id: string | number, label: string): string | number {
  if (id === null || id === undefined || String(id).trim() === '') {
    throw new Error(`${label} 不能为空`)
  }
  return id
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

function text (name: string, description: string, required = false): ParamSpec {
  return { name, kind: 'text', required, description }
}

/**
 * `update` 那一份的参数表：把 `create` 的必填项放松成可选，并说明"不给就沿用 GET 到的那份"。
 *
 * 为什么要有这一层：编辑页的表单是**从 `GET` 灌满的**，用户只改几项就把整张表单交上去 ——
 * 所以 `name` 这类字段在"新建"时必填、在"修改"时**不必**由调用方给（`prepareUpdate` 会读回来）。
 * 直接把 create 的表原样抄给 update，会让契约比页面严。
 */
function optionalForUpdate (params: ParamSpec[]): ParamSpec[] {
  return params.map((param) => ({
    ...param,
    required: false,
    description: `${param.description ?? ''}（**修改时不给就沿用 GET 到的那份** —— 编辑页的表单本来就是 GET 灌满的）`,
  }))
}

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

const USE_SYSTEM_DESCRIPTION =
  '使用系统。候选是**页面本地常量** `SYSTEM_OPTIONS_ALL`（`app/portal/utils/define.js:144`），' +
  '不是字典 —— 所以这里直接给全 9 项，不用去查'

const USE_SYSTEM_OPTIONS_PARAM: ParamSpec = {
  name: 'useSystem',
  kind: 'enum',
  required: true,
  description: USE_SYSTEM_DESCRIPTION,
  options: USE_SYSTEM_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
}

const OWNER_MODULE_PARAM: ParamSpec = {
  name: 'ownerModule',
  kind: 'search',
  required: false,
  description:
    `责任模块。候选是字典 \`${OWNER_MODULE_DICT_TYPE}\`（页面用 \`portal-platform-dict-select\`，` +
    '带 `show-search`）。空值**整项不发**',
  lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
}

const BUSINESS_EVENT_LIST_PARAMS: ParamSpec[] = [
  ...PAGE_PARAMS,
  text(
    'eventName',
    '事件名称。后端是**包含匹配**（`AiBusinessEventMapper.selectPage` 用的 `likeIfPresent` ⇒ `%x%`）' +
      '—— ⚠️ 与同组「开放接口」页的**前缀** like（那条是手写 SQL `LIKE CONCAT(?, \'%\')`）不一样；空值整项不发',
  ),
  OWNER_MODULE_PARAM,
  { ...USE_SYSTEM_OPTIONS_PARAM, required: false, description: `${USE_SYSTEM_DESCRIPTION}。列表里可以不传` },
]

const BUSINESS_EVENT_GET_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: true, description: '业务事件 id，来自 ai-business-event-list' },
]

const AVAILABLE_SKILL_PARAMS: ParamSpec[] = [
  ...PAGE_PARAMS,
  text('skillName', '技能名称（模糊）。空值整项不发'),
  {
    ...USE_SYSTEM_OPTIONS_PARAM,
    description:
      `${USE_SYSTEM_DESCRIPTION}。⚠️ 后端**当前把它置空**（BusinessEventController.getAvailableSkillPage ` +
      '里有一行 `reqVO.setUseSystem(null)`，注释写着"UseSystem不作为条件"）—— 也就是这个条件**筛不动**，' +
      '页面仍然照发',
  },
]

const BUSINESS_EVENT_RECORD_PARAMS: ParamSpec[] = [
  ...PAGE_PARAMS,
  text(
    'eventCode',
    '事件编码，来自 ai-business-event-list 行上的 `eventCode`。**必填**：页面拿不到它时直接返回空列表、不发请求',
    true,
  ),
]

const BUSINESS_EVENT_DRAFT_PARAMS: ParamSpec[] = [
  text('eventName', `事件名称，长度 ${EVENT_NAME_MIN_LENGTH}-${EVENT_NAME_MAX_LENGTH}`, true),
  OWNER_MODULE_PARAM,
  USE_SYSTEM_OPTIONS_PARAM,
  text('description', `事件说明，可空（空 → \`null\`），最多 ${EVENT_DESCRIPTION_MAX_LENGTH} 字`),
  {
    name: 'enabled',
    kind: 'boolean',
    required: false,
    description: '启用状态。页面新建页的初值是 `true`；改的时候不给就沿用 GET 到的那份',
  },
  {
    name: 'skillBindings',
    kind: 'text',
    required: false,
    description:
      '按执行顺序排列的技能绑定数组，每项 `{ skillConfigId, description?, publishStatus? }`。' +
      `最多 ${MAX_SKILL_BINDING_COUNT} 个、不能重复、启用时至少 1 个。` +
      '`skillConfigId` 候选见 ai-business-event-available-skill-list；' +
      '`publishStatus` **不会进请求体**，只用于本地校验"未发布技能不能保存"。' +
      '改的时候不给这一项 = 沿用 GET 回来的绑定（不会被清空）',
  },
]

const OPEN_API_REGISTRY_LIST_PARAMS: ParamSpec[] = [
  ...PAGE_PARAMS,
  text(
    'name',
    '接口名称。后端是**前缀匹配**（`OpenApiMapper.xml` 手写 `AND name LIKE CONCAT(?, \'%\')`）——' +
      '与业务事件那页的**包含**匹配相反；⚠️ 空串**照发**（`name=`）',
  ),
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description: '可用状态。空值整项不发',
    options: [
      { label: '未测试', value: INTERFACE_STATUS.pending },
      { label: '正常', value: INTERFACE_STATUS.normal },
      { label: '异常', value: INTERFACE_STATUS.error },
    ],
  },
  {
    name: 'enabled',
    kind: 'enum',
    required: false,
    description: '是否开放。空值整项不发',
    options: [
      { label: '否', value: OPEN_API_ENABLED.disabled },
      { label: '是', value: OPEN_API_ENABLED.enabled },
    ],
  },
]

const OPEN_API_REGISTRY_GET_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: true, description: '接口 id，来自 ai-open-api-registry-list' },
]

const OPEN_API_REGISTRY_SCAN_PARAMS: ParamSpec[] = [
  text(
    'baseUrl',
    '扫描目标的域名。页面表单里是手填的，后端 `@RequestParam` 有 `defaultValue = https://biz-api-test.wodecorp.cn`。' +
      '**顺序在 `url` 之前** —— 页面就是这么写的（与后端方法签名相反）',
    false,
  ),
  text(
    'url',
    'URL 关键词（后端按控制器路径**包含**匹配、忽略大小写）。⚠️ 后端 `@RequestParam String url` 是必填；匹配不到会返回业务错误"未找到匹配的接口"',
    true,
  ),
]

const OPEN_API_REGISTRY_DRAFT_PARAMS: ParamSpec[] = [
  text('name', '接口名称，必填。页面校验：仅中文/英文/数字/下划线、≤50 字（后端只要求非空）', true),
  text('apiPath', '接口地址，必填（页面校验它得是个 http(s) URL；后端只要求非空）', true),
  {
    name: 'httpMethod',
    kind: 'search',
    required: true,
    description:
      `HTTP 方法，必填。候选是字典 \`${OPEN_API_HTTP_METHOD_DICT_TYPE}\`（页面用 \`portal-common-dict-select\`）`,
    lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
  },
  text('scopeKey', '所需权限标识，必填', true),
  text('groupName', '分组名称，必填', true),
  text('description', '接口描述，必填', true),
  text('responseExample', '返回示例 JSON。页面优先取 `responseExample`，为空时才退到 `responseResult`'),
  {
    name: 'sort',
    kind: 'number',
    required: false,
    description:
      '排序号。⚠️ 页面发的是 **`String(form.sort || \'\')`** —— 一个字符串，空就是 `\'\'`' +
      '（后端 Integer 收 `\'\'` 会当成 null）。不给就沿用 GET 到的那份',
  },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description: '可用状态。不给时落成 `0 未测试`（页面 `normalizeInterfaceStatus` 的兜底）',
    options: [
      { label: '未测试', value: INTERFACE_STATUS.pending },
      { label: '正常', value: INTERFACE_STATUS.normal },
      { label: '异常', value: INTERFACE_STATUS.error },
    ],
  },
  {
    name: 'enabled',
    kind: 'enum',
    required: false,
    description: '是否开放。不给时落成 `0 否`',
    options: [
      { label: '否', value: OPEN_API_ENABLED.disabled },
      { label: '是', value: OPEN_API_ENABLED.enabled },
    ],
  },
  {
    name: 'params',
    kind: 'text',
    required: false,
    description:
      '参数树数组，每项 `{ name, type, position, required, defaultValue, description, sort?, children? }`。' +
      '页面 `normalizeParamTreeForSubmit` 会**丢掉空节点**、把 `required` 变成字符串 `\'true\'/\'false\'`、' +
      '把 `sort` **按同级下标重排**成 `\'1\',\'2\',…`。' +
      `\`position\` 取值 ${Object.values(PARAM_POSITION).join(' / ')}；父级是 body 时子级强制 body。` +
      '不给就沿用 GET 到的那份（`get` 返回的就是同一套字段名，可以直接回传）',
  },
]

const AI_TEMPLATE_LIST_PARAMS: ParamSpec[] = [
  ...PAGE_PARAMS,
  text(
    'func',
    '功能名称（后端字段名叫 `func`）。⚠️ 这一页的 URL 上还有 `order=`/`orderField=` —— ' +
      '那是 `useListPageModule` 自己塞的、整份对象原样发出的结果，不用（也不能）传',
  ),
]

const AI_TEMPLATE_GET_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: true, description: '绑定记录 id，来自 ai-prompt-template-binding-list' },
]

const AI_TEMPLATE_DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'funcId',
    kind: 'search',
    required: true,
    description:
      `功能名称，必填。候选是字典 \`${PROMPT_WORD_TEMPLATE_DICT_TYPE}\`（页面用 \`portal-common-dict-select\`）`,
    lookup: { capabilityId: 'base-dict-get', keywordParam: 'dictType' },
  },
  {
    name: 'templateId',
    kind: 'search',
    required: true,
    description:
      '绑定模板 id，必填。候选是 `sys/tip-template` 那一行 —— 也就是「技能列表」页的列表数据。' +
      '**先问用户关键字**（名称）再调 ai-prompt-skill-list 取候选；' +
      '要按类型收窄就把它的 `typeId` 一起传（页面就是先选类型再选模板的）',
    lookup: TEMPLATE_LIST_LOOKUP,
  },
  {
    name: 'useType',
    kind: 'search',
    required: false,
    description:
      '使用类型（模板类型）。⚠️ 页面拿提示词类型行的 **`name`（类型值）** 当 `useType`、`id` 当筛选模板用的 `typeId`。' +
      '**先问用户关键字**再调 ai-prompt-tip-type-list 取候选',
    lookup: TIP_TYPE_LIST_LOOKUP,
  },
  {
    name: 'templateContent',
    kind: 'text',
    required: true,
    description:
      '模板内容。⚠️ 页面上它**不是手填的**，而是"所选项的名字"：' +
      '页面把 `templateId` 选中的那一行取出来，写 `templateContent: selectedTemplate?.name`。' +
      'SDK 侧只能由调用方给（候选入口未做，SDK 拿不到那一行）',
  },
]

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const aiPromptToolCapabilities: CapabilityDefinition[] = [
  // ---- 业务事件绑定技能（`/dashboard/…/prompt/business-event/list`）----
  {
    id: 'ai-business-event-list',
    title: '查询业务事件列表（提示工程·业务事件绑定技能）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: false,
    params: BUSINESS_EVENT_LIST_PARAMS,
  },
  {
    id: 'ai-business-event-get',
    title: '查询单条业务事件详情（含已绑定技能）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: false,
    params: BUSINESS_EVENT_GET_PARAMS,
  },
  {
    id: 'ai-business-event-available-skill-list',
    title: '分页查询业务事件可绑定的技能（候选）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: false,
    params: AVAILABLE_SKILL_PARAMS,
  },
  {
    id: 'ai-business-event-record-list',
    title: '分页查询业务事件技能执行记录',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: false,
    params: BUSINESS_EVENT_RECORD_PARAMS,
  },
  {
    id: 'ai-business-event-record-get',
    title: '查询单条业务事件技能执行记录',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: false,
    params: [
      { name: 'id', kind: 'number', required: true, description: '执行记录 id，来自 ai-business-event-record-list' },
    ],
  },
  {
    id: 'ai-business-event-create',
    title: '新建业务事件（写）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: true,
    params: BUSINESS_EVENT_DRAFT_PARAMS,
  },
  {
    id: 'ai-business-event-update',
    title: '修改业务事件（写，整单替换）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '要改的事件 id。⚠️ 这个接口是**整单替换**：直接拼一份请求体发出去，没写的技能绑定会被清掉。' +
          '走本能力的 `prepareUpdate` 就不会 —— 它会先 GET 当前值，把没给的字段沿用回来再重算请求体。' +
          '所以**不要**绕过 `prepare` 自己拼 body',
      },
      ...optionalForUpdate(BUSINESS_EVENT_DRAFT_PARAMS),
    ],
  },
  {
    id: 'ai-business-event-set-enabled',
    title: '启用 / 停用业务事件（写）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '事件 id' },
      {
        name: 'enabled',
        kind: 'boolean',
        required: true,
        description:
          '**目标状态**。页面按钮传的是相反值（`enabled: !record.enabled`），SDK 不做这个取反 —— ' +
          '无头里"当前值"是读出来的，不是从表格行里捡的',
      },
    ],
  },
  {
    id: 'ai-business-event-remove',
    title: '删除业务事件（写，不可撤销）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description: '事件 id。⚠️ 逻辑删除且后端**没有**恢复接口 —— 本能力的 `cancel` 会**抛**，不是静默略过',
      },
    ],
  },
  {
    id: 'ai-business-event-record-retry',
    title: '重试一次业务事件技能执行（写，不可撤销，会真的再跑一遍技能）',
    pagePath: AI_BUSINESS_EVENT_PAGE_PATH,
    permission: AI_BUSINESS_EVENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          `执行记录 id。只有状态 ∈ {${RETRYABLE_RECORD_STATUS.join(', ')}}（失败/跳过/超时）才允许重试` +
          '（页面 `RETRYABLE_RECORD_STATUS`）；否则后端抛业务错误。' +
          '⚠️ **副作用**：后端会**同步把技能再执行一遍**（`retry` → `newSkillExecutor.execute`），' +
          '技能自己的写操作会真的发生，撤不回来',
      },
    ],
  },

  // ---- 开放接口（`/dashboard/…/prompt/interface/list`）----
  {
    id: 'ai-open-api-registry-list',
    title: '分页查询开放接口注册表（提示工程·开放接口）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: false,
    params: OPEN_API_REGISTRY_LIST_PARAMS,
  },
  {
    id: 'ai-open-api-registry-get',
    title: '查询单条开放接口详情（含参数树）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: false,
    params: OPEN_API_REGISTRY_GET_PARAMS,
  },
  {
    id: 'ai-open-api-registry-scan',
    title: '按 URL 关键词扫描后端已注册的接口（候选）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: false,
    params: OPEN_API_REGISTRY_SCAN_PARAMS,
  },
  {
    id: 'ai-open-api-registry-create',
    title: '注册开放接口（写）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: true,
    params: OPEN_API_REGISTRY_DRAFT_PARAMS,
  },
  {
    id: 'ai-open-api-registry-update',
    title: '修改开放接口（写，整单替换）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '要改的接口 id。⚠️ 这个接口是**整单替换**：直接拼一份请求体发出去，没写的字段会被写回默认值。' +
          '走本能力的 `prepareUpdate` 就不会 —— 它会先 GET 当前值、把没给的字段沿用回来再重算请求体。' +
          '所以**不要**绕过 `prepare` 自己拼 body',
      },
      ...optionalForUpdate(OPEN_API_REGISTRY_DRAFT_PARAMS),
    ],
  },
  {
    id: 'ai-open-api-registry-remove',
    title: '删除开放接口（写，不可撤销）',
    pagePath: AI_OPEN_API_REGISTRY_PAGE_PATH,
    permission: AI_OPEN_API_REGISTRY_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '接口 id。⚠️ 页面在 `record.isBound` 为真时**按钮是删不动的**（"该接口已被提示词绑定，无法删除"），' +
          '那是**前端拦的**、后端没有这条校验 —— SDK 如实透传，不做预检查。逻辑删除、无恢复接口',
      },
    ],
  },

  // ---- 工具提示词绑定（`/dashboard/…/prompt/template/list`）----
  {
    id: 'ai-prompt-template-binding-list',
    title: '分页查询工具提示词绑定（提示工程·工具提示词绑定）',
    pagePath: AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    permission: AI_PROMPT_TEMPLATE_BINDING_PERMISSION,
    write: false,
    params: AI_TEMPLATE_LIST_PARAMS,
  },
  {
    id: 'ai-prompt-template-binding-get',
    title: '查询单条工具提示词绑定详情',
    pagePath: AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    permission: AI_PROMPT_TEMPLATE_BINDING_PERMISSION,
    write: false,
    params: AI_TEMPLATE_GET_PARAMS,
  },
  {
    id: 'ai-prompt-template-binding-create',
    title: '新建工具提示词绑定（写）',
    pagePath: AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    permission: AI_PROMPT_TEMPLATE_BINDING_PERMISSION,
    write: true,
    params: AI_TEMPLATE_DRAFT_PARAMS,
  },
  {
    id: 'ai-prompt-template-binding-update',
    title: '修改工具提示词绑定（写）',
    pagePath: AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    permission: AI_PROMPT_TEMPLATE_BINDING_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '要改的绑定 id。⚠️ 这一页的 `update` 请求体是"GET 回来的整行 + `templateContent`"，' +
          '走 `prepareUpdate` 就会自动 GET 并沿用没给的字段；**不要**绕过 `prepare` 自己拼 body',
      },
      ...optionalForUpdate(AI_TEMPLATE_DRAFT_PARAMS),
    ],
  },
  {
    id: 'ai-prompt-template-binding-remove',
    title: '删除工具提示词绑定（写，不可撤销）',
    pagePath: AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    permission: AI_PROMPT_TEMPLATE_BINDING_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '绑定 id。⚠️ 删除**没有恢复接口**，`cancel` 会抛' },
    ],
  },
]

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/** 把 `WriteStep` 发出去。三步里的 `submit` / `cancel` 都只调它 */
function sendStep<T> (request: PortalRequest, step: WriteStep): Promise<T> {
  return request<T>({
    url: step.url,
    method: step.method,
    ...(step.params === undefined ? {} : { params: step.params }),
    ...(step.data === undefined ? {} : { data: step.data }),
  })
}

/** `submit` / `cancel` 的入参防线：必须是 `prepare` 出来的那个 plan */
function assertPlan (plan: WritePlan, action: string): void {
  if (!plan || typeof plan !== 'object' || plan.request === undefined) {
    throw new Error(`${action} 要的是 prepareXxx() 返回的那个 plan（它把"要发什么"和"怎么撤销"写在一起）`)
  }
}

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文。
 *
 * 参数顺序**显式构造**，与三页一一对应：
 * `requestBusinessEvent` / `requestOpenApiRegistry` / `requestTemplateBinding`。
 * 三页的 module-type 都是"算不出 ⇒ 不发这个头"（conventions 2），
 * 实例都是 `platform`（推导结论，见文件头）。
 */
export function createAiPromptToolCapability (
  /** 业务事件绑定技能页（`…/prompt/business-event/list`） */
  requestBusinessEvent: PortalRequest,
  /** 开放接口页（`…/prompt/interface/list`） */
  requestOpenApiRegistry: PortalRequest,
  /** 工具提示词绑定页（`…/prompt/template/list`） */
  requestTemplateBinding: PortalRequest,
) {
  // -------------------------------------------------------------------------
  // 业务事件绑定技能
  // -------------------------------------------------------------------------
  const businessEvent = {
    /** 分页查询业务事件。只读 */
    list (query: BusinessEventQuery = {}): Promise<PageResult<BusinessEventRow>> {
      return requestBusinessEvent<PageResult<BusinessEventRow>>({
        url: BUSINESS_EVENT_PATHS.page,
        method: 'get',
        params: buildOrdered(BUSINESS_EVENT_LIST_ORDER, query as Record<string, unknown>),
      })
    },

    /** 单条事件详情（含 `boundSkills`）。只读 */
    get (id: number | string): Promise<BusinessEventRow> {
      return requestBusinessEvent<BusinessEventRow>({
        url: BUSINESS_EVENT_PATHS.get,
        method: 'get',
        params: { id: normalizeId(id, '业务事件 id') },
      })
    },

    /**
     * 可绑定技能分页。只读，是 `skillConfigId` 的候选来源。
     *
     * ⚠️ 页面在 `useSystem` 为空时**根本不发这个请求**（返回空列表），所以 `useSystem` 必填。
     * 但后端当前会把它置空（`reqVO.setUseSystem(null)`，注释写着"UseSystem不作为条件"）
     * —— 也就是说**这个参数今天筛不动**，传了只是与浏览器一致。
     */
    listAvailableSkills (
      query: BusinessEventAvailableSkillQuery,
    ): Promise<PageResult<BusinessEventRow>> {
      const raw = query?.useSystem
      // 页面的判据是 `props.useSystem == null || props.useSystem === ''` —— 空串也算"没给"，
      // 所以这里不能用 `Number(raw)` 一个有限性检查糊过去（`Number('')` 是 0，会被放行）
      if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) {
        return Promise.reject(new Error('useSystem 必填：页面在它为空时不会发这个请求'))
      }
      const useSystem = Number(raw)
      return requestBusinessEvent<PageResult<BusinessEventRow>>({
        url: BUSINESS_EVENT_PATHS.availableSkillPage,
        method: 'get',
        params: buildOrdered(BUSINESS_EVENT_AVAILABLE_SKILL_ORDER, {
          ...(query as Record<string, unknown>),
          useSystem,
        }),
      })
    },

    /** 技能执行记录分页。只读。`eventCode` 必填（页面拿不到时不发请求） */
    listRecords (query: BusinessEventRecordQuery): Promise<PageResult<BusinessEventRecordRow>> {
      const eventCode = String(query?.eventCode ?? '').trim()
      if (eventCode === '') {
        return Promise.reject(
          new Error('eventCode 必填：页面在它为空时直接返回空列表、不发请求（详情页要先 GET 到事件才有它）'),
        )
      }
      return requestBusinessEvent<PageResult<BusinessEventRecordRow>>({
        url: BUSINESS_EVENT_PATHS.recordPage,
        method: 'get',
        params: buildOrdered(BUSINESS_EVENT_RECORD_ORDER, {
          ...(query as Record<string, unknown>),
          eventCode,
        }),
      })
    },

    /** 单条执行记录（弹窗里那份）。只读 */
    getRecord (id: number | string): Promise<BusinessEventRecordRow> {
      return requestBusinessEvent<BusinessEventRecordRow>({
        url: BUSINESS_EVENT_PATHS.recordGet,
        method: 'get',
        params: { id: normalizeId(id, '执行记录 id') },
      })
    },

    /**
     * `prepare`：新建业务事件的**只读**前置步骤 —— 跑页面自己的校验、算出请求体。
     *
     * **不发任何请求**（新建在页面上也没有前置读）。校验不过直接抛。
     * 要挑技能先调 `listAvailableSkills`。
     *
     * 撤销：三页的 `create` 都**不回传新 id**（`BusinessEventController.create` 返回的
     * `CommonResult<Long>` 前端根本没用，页面直接 `actionFetch()` 重拉列表），
     * 所以 `undo` 在这里是 `null` —— 提交完要先 `list({ eventName })` 找到新那条的 id，
     * 再 `prepareRemove` + `submit`。
     */
    prepareCreate (draft: BusinessEventDraft): WritePlan {
      const message = validateBusinessEvent(draft)
      if (message) throw new Error(message)
      return {
        request: { url: BUSINESS_EVENT_PATHS.create, method: 'post', data: buildBusinessEventPayload(draft) },
        undo: null,
        note:
          'create 不回传新 id：提交后请用 list({ eventName }) 找到新记录，再走 remove 的 prepare/submit 撤销。' +
          '（同一轮内撤销是本项目的写验证纪律）',
      }
    },

    /**
     * `prepare`：修改业务事件的**只读**前置步骤 —— `GET` 当前详情（提交体的底稿 + 撤销快照）。
     *
     * 复刻页面编辑页的顺序：`GET` → 用 GET 到的值填满表单 → 用户改几项 → 整张表单提交。
     * 所以调用方**没给**的字段沿用 GET 到的那份（`skillBindings` 也是），不会被清空。
     */
    async prepareUpdate (draft: BusinessEventDraft): Promise<WritePlan> {
      const id = normalizeId(draft?.id as number | string, '业务事件 id')
      const current = await businessEvent.get(id)
      const merged = mergeBusinessEventDraft(current as Record<string, unknown>, draft)
      const message = validateBusinessEvent(merged)
      if (message) throw new Error(message)
      const currentForm = normalizeBusinessEventDetail(current as Record<string, unknown>)
      return {
        request: {
          url: BUSINESS_EVENT_PATHS.update,
          method: 'post',
          data: buildBusinessEventPayload(merged),
        },
        undo: {
          url: BUSINESS_EVENT_PATHS.update,
          method: 'post',
          // 撤销体用**同一个组装函数**从 GET 到的那份重算：
          // `boundSkills` 与 `skillBindings` **不是同一个字段名**，直接回写会把绑定写成空
          data: buildBusinessEventPayload({
            id: currentForm.id as number | string,
            eventName: currentForm.eventName,
            ownerModule: currentForm.ownerModule,
            useSystem: currentForm.useSystem,
            description: currentForm.description,
            enabled: currentForm.enabled,
            skillBindings: businessEventBindingsFromDetail(current as Record<string, unknown>),
          }),
        },
        note: `撤销用的原值来自这次 GET（id=${String(id)}），按同一个组装函数重算，不额外加字段`,
      }
    },

    /**
     * `prepare`：启用 / 停用的**只读**前置步骤 —— `GET` 当前状态。
     *
     * 页面按钮传的是**相反值**（`enabled: !record.enabled`），SDK 不做这个取反：
     * 调用方给的是**目标值**，因为在无头里"当前值"是读出来的、不是从表格行里捡的。
     */
    async prepareSetEnabled (id: number | string, enabled: boolean): Promise<WritePlan> {
      const eventId = normalizeId(id, '业务事件 id')
      if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值（要给的是目标状态，不是相反值）')
      const current = await businessEvent.get(eventId)
      return {
        request: {
          url: BUSINESS_EVENT_PATHS.updateEnabled,
          method: 'post',
          data: { id: eventId, enabled },
        },
        undo: {
          url: BUSINESS_EVENT_PATHS.updateEnabled,
          method: 'post',
          data: { id: eventId, enabled: Boolean(current?.enabled) },
        },
        note: `当前 enabled=${String(current?.enabled)}；撤销把它写回去`,
      }
    },

    /**
     * `prepare`：删除的**只读**前置步骤 —— `GET` 确认它存在（顺带把名字给调用方看）。
     * `undo` 恒为 `null`：后端是逻辑删除，**没有**恢复接口。
     */
    async prepareRemove (id: number | string): Promise<WritePlan> {
      const eventId = normalizeId(id, '业务事件 id')
      const current = await businessEvent.get(eventId)
      return {
        request: { url: BUSINESS_EVENT_PATHS.remove, method: 'delete', params: { id: eventId } },
        undo: null,
        note:
          `将要删除的是「${String(current?.eventName ?? '')}」（eventCode=${String(current?.eventCode ?? '')}）。` +
          '逻辑删除且没有恢复接口，`cancel` 会抛。',
      }
    },

    /**
     * `prepare`：重试一次技能执行的**只读**前置步骤。
     *
     * `GET` 记录、检查状态是否可重试，并且**明确警告副作用**：后端会同步把技能再跑一遍。
     * `undo` 恒为 `null` —— 技能已经执行过了，这不是一条能回滚的记录。
     */
    async prepareRecordRetry (id: number | string): Promise<WritePlan> {
      const recordId = normalizeId(id, '执行记录 id')
      const record = await businessEvent.getRecord(recordId)
      const status = Number(record?.status)
      if (!(RETRYABLE_RECORD_STATUS as readonly number[]).includes(status)) {
        throw new Error(
          `记录 ${String(recordId)} 的状态是 ${status}，只有 ${RETRYABLE_RECORD_STATUS.join('/')}` +
            '（失败/跳过/超时）可以重试（页面 RETRYABLE_RECORD_STATUS）。后端也会拒，' +
            '这里提前拦是为了不发出一次必然失败的写请求',
        )
      }
      return {
        request: { url: BUSINESS_EVENT_PATHS.recordRetry, method: 'post', data: { id: recordId } },
        undo: null,
        note:
          '⚠️ 这一步会**真的把技能再执行一遍**（后端 retry → newSkillExecutor.execute），' +
          '技能自己的写操作会真的发生，撤不回来。测试数据要用一眼看出是测试的载荷。',
      }
    },

    /** `submit`：**真写**。只发 `plan.request` 那一条 */
    submit (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'submit')
      } catch (error) {
        return Promise.reject(error)
      }
      return sendStep(requestBusinessEvent, plan.request)
    },

    /**
     * `cancel`：**撤销**。只发 `plan.undo` 那一条，绝不发 `plan.request`（conventions 13）。
     * `undo === null` 时**抛**，说明这个动作撤不回来 —— 不静默什么都不做。
     */
    cancel (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'cancel')
      } catch (error) {
        return Promise.reject(error)
      }
      if (plan.undo === null) {
        return Promise.reject(new Error(`这一步撤销不了：${plan.note}`))
      }
      return sendStep(requestBusinessEvent, plan.undo)
    },
  }

  // -------------------------------------------------------------------------
  // 开放接口
  // -------------------------------------------------------------------------
  const openApiRegistry = {
    /** 分页查询开放接口。只读 */
    list (query: OpenApiRegistryQuery = {}): Promise<PageResult<OpenApiRegistryRow>> {
      const provided = query as Record<string, unknown>
      return requestOpenApiRegistry<PageResult<OpenApiRegistryRow>>({
        url: OPEN_API_REGISTRY_PATHS.page,
        method: 'get',
        params: buildOrdered(OPEN_API_REGISTRY_LIST_ORDER, {
          ...provided,
          // 两个 `=== '' || == null → undefined` 的归一化，逐字照抄 `api.js`
          status: provided.status === '' || provided.status == null ? undefined : provided.status,
          enabled: provided.enabled === '' || provided.enabled == null ? undefined : provided.enabled,
        }),
      })
    },

    /**
     * 单条接口详情（含 `params` 参数树）。只读。
     *
     * ⚠️ 路径是 `…/get/{id}`（后端只有这一种：`@GetMapping("/get/{id}")` 收 `@PathVariable`），
     * 而删除是 `…/delete/{id}?id={id}`（路径与 query 都有）。两者不一样，别互相照抄。
     */
    get (id: number | string): Promise<OpenApiRegistryRow> {
      return requestOpenApiRegistry<OpenApiRegistryRow>({
        url: `${OPEN_API_REGISTRY_PATHS.detail}/${String(normalizeId(id, '接口 id'))}`,
        method: 'get',
      })
    },

    /**
     * 按 URL 关键词扫描后端已注册的接口。只读，是「扫描导入」那个弹窗的候选来源。
     *
     * ⚠️ 参数顺序是 `baseUrl` → `url`（页面 `scanOpenApiRegistryByUrl` 就是这么写的），
     * 与后端方法签名（`url` 在前）**不一样** —— 对象键序就是 URL 上的顺序。
     */
    scan (query: { baseUrl?: string; url: string }): Promise<OpenApiRegistryRow[]> {
      const url = String(query?.url ?? '').trim()
      if (url === '') {
        return Promise.reject(new Error('url 必填（后端 @RequestParam String url 非空，匹配不到会返回业务错误）'))
      }
      const params: Record<string, unknown> = {}
      if (query?.baseUrl !== undefined) params.baseUrl = query.baseUrl
      params.url = url
      return requestOpenApiRegistry<OpenApiRegistryRow[]>({
        url: OPEN_API_REGISTRY_PATHS.scan,
        method: 'get',
        params,
      })
    },

    /**
     * `prepare`：注册开放接口的**只读**前置步骤 —— 跑本地校验、算出请求体。
     * 不发任何请求（要挑接口先调 `scan`）。`undo` 恒为 `null`（create 不回传新 id）。
     */
    prepareCreate (draft: OpenApiRegistryDraft): WritePlan {
      assertOpenApiRegistryDraft(draft, false)
      validateOpenApiRegistryParamTree(draft?.params ?? [])
      return {
        request: {
          url: OPEN_API_REGISTRY_PATHS.create,
          method: 'post',
          data: buildOpenApiRegistryCreatePayload(draft),
        },
        undo: null,
        note:
          'create 返回的是 `success(null)`（后端 `CommonResult<String>` 里没有新 id），' +
          '所以撤销要先 `list({ name })` 找到新那条，再走 remove 的 prepare/submit。' +
          '⚠️ 页面这里写的是 `http.post(url, body, { useJsonPost: true })` —— ' +
          '`useJsonPost` 只被 `zhdj-app-lay.js` / `zhdj-cms.js` 的拦截器消费，**platform.js 不看它**，' +
          '所以那是个空开关：请求体本来就是 JSON',
      }
    },

    /**
     * `prepare`：修改开放接口的**只读**前置步骤 —— `GET` 当前详情（提交体底稿 + 撤销快照）。
     *
     * 复刻页面编辑页的顺序：`GET` → `normalizeOpenApiRegistryDetail` 填表单 → 用户改几项 →
     * 整张表单提交（payload 只取那 11 个字段）。所以调用方**没给**的字段沿用 GET 到的那份。
     */
    async prepareUpdate (draft: OpenApiRegistryDraft): Promise<WritePlan> {
      const id = normalizeId(draft?.id as number | string, '接口 id')
      const current = (await openApiRegistry.get(id)) as Record<string, unknown>
      const merged: Record<string, unknown> = { ...current }
      for (const key of [
        'name',
        'apiPath',
        'httpMethod',
        'scopeKey',
        'groupName',
        'description',
        'responseExample',
        'responseResult',
        'sort',
        'status',
        'enabled',
        'params',
      ] as const) {
        if (draft?.[key] !== undefined) merged[key] = draft[key]
      }
      merged.id = id
      assertOpenApiRegistryDraft(merged as OpenApiRegistryDraft, true)
      validateOpenApiRegistryParamTree((merged.params as OpenApiRegistryParamNode[]) ?? [])
      return {
        request: {
          url: OPEN_API_REGISTRY_PATHS.update,
          method: 'post',
          data: buildOpenApiRegistryUpdatePayload(merged as OpenApiRegistryDraft),
        },
        undo: {
          url: OPEN_API_REGISTRY_PATHS.update,
          method: 'post',
          // 撤销体从 GET 到的那份重算（payload 只取 11 个字段，服务端多给的字段不会被写回去）
          data: buildOpenApiRegistryUpdatePayload({ ...current, id } as OpenApiRegistryDraft),
        },
        note:
          '撤销用的原值来自这次 GET。⚠️ `params` 会被 `normalizeParamTreeForSubmit` 重排一次' +
          '（`sort` 按同级下标重算、空节点被丢掉）—— 提交与撤销**两边都是**同一条规则，不会互相错位',
      }
    },

    /**
     * `prepare`：删除的**只读**前置步骤 —— `GET` 当前详情（确认存在 + 把名字给调用方看）。
     *
     * ⚠️ 请求形状**照抄页面**：路径带 id，query 里**也**带一个 `id`。
     * 后端 `@DeleteMapping("/delete/{id}")` 只读 `@PathVariable`，query 上那个它不看 ——
     * 但浏览器确实两个都发，SDK 忠实复刻（D20）。`undo` 恒为 `null`。
     */
    async prepareRemove (id: number | string): Promise<WritePlan> {
      const apiId = normalizeId(id, '接口 id')
      const current = await openApiRegistry.get(apiId)
      return {
        request: {
          url: `${OPEN_API_REGISTRY_PATHS.remove}/${String(apiId)}`,
          method: 'delete',
          params: { id: apiId },
        },
        undo: null,
        note:
          `将要删除的是「${String(current?.name ?? '')}」` +
          `（${String(current?.httpMethod ?? '')} ${String(current?.apiPath ?? '')}）。` +
          '逻辑删除、没有恢复接口，`cancel` 会抛。',
      }
    },

    /** `submit`：**真写**。只发 `plan.request` */
    submit (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'submit')
      } catch (error) {
        return Promise.reject(error)
      }
      return sendStep(requestOpenApiRegistry, plan.request)
    },

    /** `cancel`：**撤销**。只发 `plan.undo`；为 `null` 时抛 */
    cancel (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'cancel')
      } catch (error) {
        return Promise.reject(error)
      }
      if (plan.undo === null) {
        return Promise.reject(new Error(`这一步撤销不了：${plan.note}`))
      }
      return sendStep(requestOpenApiRegistry, plan.undo)
    },
  }

  // -------------------------------------------------------------------------
  // 工具提示词绑定
  // -------------------------------------------------------------------------
  const templateBinding = {
    /**
     * 分页查询绑定。只读。
     *
     * ⚠️ 与前面两页**不同**：URL 上会有 `order=`/`orderField=`（页面把这个对象整体交给了 axios）。
     */
    list (query: { func?: string; pageNo?: number; pageSize?: number } = {}): Promise<PageResult<AiTemplateRow>> {
      return requestTemplateBinding<PageResult<AiTemplateRow>>({
        url: AI_TEMPLATE_PATHS.page,
        method: 'get',
        params: buildOrdered(AI_TEMPLATE_LIST_ORDER, query as Record<string, unknown>),
      })
    },

    /** 单条绑定详情。只读 */
    get (id: number | string): Promise<AiTemplateRow> {
      return requestTemplateBinding<AiTemplateRow>({
        url: AI_TEMPLATE_PATHS.get,
        method: 'get',
        params: { id: normalizeId(id, '绑定 id') },
      })
    },

    /**
     * `prepare`：新建绑定的**只读**前置步骤。
     *
     * 组装体的键序**逐字照抄**页面 `customSubmit` 的 `{...form, templateContent}`：
     * `formState` 是 `{ id, templateId, useType, funcId }`，所以 body 是
     * `{ id: null, templateId, useType, funcId, templateContent }` —— `id` **打头且是 `null`**。
     * `undo` 恒为 `null`（create 不回传新 id）。
     */
    prepareCreate (draft: {
      funcId: string
      templateId: number | string
      useType?: string | null
      templateContent: string
    }): WritePlan {
      assertTemplateDraft(draft)
      return {
        request: {
          url: AI_TEMPLATE_PATHS.create,
          method: 'post',
          data: {
            id: null,
            templateId: draft.templateId,
            useType: draft.useType ?? null,
            funcId: draft.funcId,
            templateContent: draft.templateContent,
          },
        },
        undo: null,
        note:
          'create 返回的是 `success(null)`（后端 `CommonResult<Integer>` 里没有新 id），' +
          '撤销要先 `list({ func })` 找到新那条，再走 remove 的 prepare/submit',
      }
    },

    /**
     * `prepare`：修改绑定的**只读**前置步骤 —— `GET` 当前行。
     *
     * ⚠️ 请求体**就是这一行原样加一个 `templateContent`**：页面 `customSubmit` 写的是
     * `{...form, templateContent}`，而编辑态下 `form` 就是 `GET` 回来的那个对象
     * （`form.js` 的 `formLoad` 直接 `formStateSet(await customLoad(id))`，
     * 而 `customLoad` 返回的就是原始响应）。所以这里把它摊开后只覆盖调用方给了的字段，
     * **键序与浏览器一致**，也不会漏掉 `creator`/`updateTime` 之类 SDK 不认识的字段。
     *
     * `undo` = 把 `GET` 到的那一行**原样** PUT 回去。
     */
    async prepareUpdate (
      id: number | string,
      draft: { funcId?: string; templateId?: number | string; useType?: string | null; templateContent: string },
    ): Promise<WritePlan> {
      const bindingId = normalizeId(id, '绑定 id')
      if (String(draft?.templateContent ?? '').trim() === '') {
        throw new Error('templateContent（模板内容）必填：页面取的是所选项的名字')
      }
      const current = (await templateBinding.get(bindingId)) as Record<string, unknown>
      const body: Record<string, unknown> = { ...current }
      for (const key of ['funcId', 'templateId', 'useType'] as const) {
        if (draft?.[key] !== undefined) body[key] = draft[key]
      }
      body.templateContent = draft.templateContent
      // 校验**合并之后**的那一份：`funcId`/`templateId` 不给时沿用 GET 到的，不算缺
      assertTemplateDraft(body)
      return {
        request: { url: AI_TEMPLATE_PATHS.update, method: 'put', data: body },
        undo: {
          url: AI_TEMPLATE_PATHS.update,
          method: 'put',
          data: { ...current },
        },
        note:
          `撤销就是"把 id=${String(bindingId)} 这一行原样写回"（GET 到的那份，一个字段不改）。` +
          '`funcId`/`templateId`/`useType` 不给就用 GET 到的那一份，不会被清空',
      }
    },

    /**
     * `prepare`：删除的**只读**前置步骤 —— `GET` 当前行。
     * ⚠️ 删除是 `DELETE …/delete?id=`（**query 传参**，路径里没有 id），与前面两页的写法都不同。
     */
    async prepareRemove (id: number | string): Promise<WritePlan> {
      const bindingId = normalizeId(id, '绑定 id')
      const current = await templateBinding.get(bindingId)
      return {
        request: {
          url: AI_TEMPLATE_PATHS.remove,
          method: 'delete',
          params: { id: bindingId },
        },
        undo: null,
        note: `将要删除的是「funcId=${String(current?.funcId ?? '')}」这一条绑定。没有恢复接口，\`cancel\` 会抛。`,
      }
    },

    /** `submit`：**真写**。只发 `plan.request` */
    submit (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'submit')
      } catch (error) {
        return Promise.reject(error)
      }
      return sendStep(requestTemplateBinding, plan.request)
    },

    /** `cancel`：**撤销**。只发 `plan.undo`；为 `null` 时抛 */
    cancel (plan: WritePlan): Promise<unknown> {
      try {
        assertPlan(plan, 'cancel')
      } catch (error) {
        return Promise.reject(error)
      }
      if (plan.undo === null) {
        return Promise.reject(new Error(`这一步撤销不了：${plan.note}`))
      }
      return sendStep(requestTemplateBinding, plan.undo)
    },
  }

  return { businessEvent, openApiRegistry, templateBinding }
}

/** 工具提示词绑定草稿的本地校验：页面 `rules` 里只有 funcId / templateId 两条 `required` */
export function assertTemplateDraft (
  draft: { funcId?: unknown; templateId?: unknown; templateContent?: unknown },
): void {
  const missing: string[] = []
  if (String(draft?.funcId ?? '').trim() === '') missing.push('funcId（功能名称）')
  if (draft?.templateId === undefined || draft?.templateId === null || String(draft.templateId).trim() === '') {
    missing.push('templateId（绑定模板）')
  }
  if (String(draft?.templateContent ?? '').trim() === '') {
    // 页面没有这条 rules，但它的值是"所选项的名字"——选了模板就一定有；空值只会写进一个空模板
    missing.push('templateContent（模板内容，页面取的是所选项的名字）')
  }
  if (missing.length) {
    throw new Error(`工具提示词绑定这些字段是必填的：${missing.join(' / ')}`)
  }
}

export type AiPromptToolCapability = ReturnType<typeof createAiPromptToolCapability>

/*
 * ---------------------------------------------------------------------------
 * 已查清、**本轮没做**的入口（将来做的时候省一轮侦察）
 * ---------------------------------------------------------------------------
 *
 * 1. `buildOpenApiRegistryMarkdown()`（`interface/markdown.js`）—— **不进能力**。
 *    它是**纯前端渲染**：把一条接口详情渲染成"写给 LLM 调用"的 Markdown
 *    （基本信息 / 请求 / Headers·Path·Params·Body 四张参数表 / 返回示例 / curl 示例），
 *    页面在「复制 → Markdown」里调它，然后 `navigator.clipboard.writeText`。
 *    **它一个请求都不发**，所以按规则不进能力；要做成能力得先把一个纯函数搬到 SDK 侧，
 *    那是另一件事，不在本轮范围。它在 `docs/design.md` 的 F2 里有记载。
 *
 * 2. 接口的「测试」按钮（`interface/share.js` 的 `testInterface`）—— **不进能力**。
 *    它用的是**裸 axios**（`axios.request`），`url` 就是用户在表单里填的 `apiPath`
 *    （可以是任意地址，不经过 platform 实例、不补 `/admin-api`、不带租户头），
 *    method / params / headers / body 全部由表单的参数树决定。
 *    把它做成能力等于给无头开一个"向任意地址发任意请求"的口子，而且它**不是 Portal 的接口**。
 *    它确实有副作用：`testAndSyncOpenApiRegistry` 会把测试结果（`status` / `responseExample`）
 *    **写回接口详情**（`updateOpenApiRegistry`）—— 也就是"点一下测试"是一次真写。
 *    真要做，应该拆成 `prepareTest`（只测）/ `submitTestResult`（写回）两步，本轮不做。
 *
 * 3. 业务事件编辑页里的 `SkillBindingEditor` 用的是同一个 `available-skill/page`
 *    （已登记成能力，没有遗漏）；`interface/param-tree.js` 与 `interface/define.js`
 *    里的纯函数**都已搬进本文件**（`buildOpenApiRegistryParamTreeForSubmit` 等），没有遗留。
 *
 * 4. 三页的**编辑/新建页**（`…/[mode]/[id].vue`）没有独立菜单项，不进目录；
 *    它们的能力都挂在列表页的 `pagePath` 上（`normalizeMenuEntryPath` 也是这个口径）。
 */
