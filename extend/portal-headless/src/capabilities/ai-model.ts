import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 人工智能 → 智能交互：**模型 / 用量 / 分析四个页面**。
 *
 * | 页面 | 菜单路径 | 权限码（v2） | 路由文件 |
 * | --- | --- | --- | --- |
 * | 模型列表 | `/dashboard/platform/intelligence/interaction/model/list` | `/dashboard/platform-v2/intelligence/interaction/model` | `.../interaction/model/list.vue` |
 * | 模型选择 | `/dashboard/platform/intelligence/interaction/modelSelect/list` | `/dashboard/platform-v2/intelligence/interaction/modelSelect` | `.../interaction/modelSelect/list.vue` |
 * | 平台用量 | `/dashboard/platform/intelligence/interaction/platform-usage/list` | `/dashboard/platform-v2/intelligence/interaction/platform-usage` | `.../interaction/platform-usage/list.vue` |
 * | 数据分析 | `/dashboard/platform/intelligence/interaction/dataAnalysis/list` | `/dashboard/platform-v2/intelligence/interaction/dataAnalysis` | `.../interaction/dataAnalysis/list.vue` |
 *
 * （路由前缀都是 `app/portal/views/dashboard/platform/intelligence/`）
 *
 * ## 基准：`baseline/ai-model.browser.json`（23 条 / 4 页，2026-09-21）
 *
 * **四页的读请求全部与基准逐字段一致**（含键顺序与 `_t` 的位置），写这一版时逐条比对过
 * （断言在 `test/ai-model.test.ts` 的 J 组）：
 *
 * | 请求 | 基准原文（`_t` 已归一化） |
 * | --- | --- |
 * | 模型列表 | `GET /admin-api/manager/aiModelConfig/getByPage?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>` |
 * | 模型选择 | `GET /admin-api/manager/aiModelSelection/getByPage?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>` |
 * | 平台用量·明细 | `GET /admin-api/ai-token/quota-usage/page?quotaCycle=3&statisticsDimension=3&pageNo=1&pageSize=20&_t=<ts>` |
 * | 平台用量·汇总 | `GET /admin-api/ai-token/quota-usage/summary?quotaCycle=3&statisticsDimension=3&_t=<ts>` |
 * | 模型列表·角标 | `GET /admin-api/ai-token/apply/pending-count?statisticsDimension=3&_t=<ts>` |
 * | 数据分析 | 六条 `GET /admin-api/manage/ai/get*?_t=<ts>`（**只有 `_t`**） |
 *
 * 基准顺带证实了三件原先只是推导的事：`modelName` 初值 `null` **真的被丢掉**；
 * 平台用量那两条**真的没有** `order`/`orderField`；`callTypeList` 空数组**真的不发**。
 *
 * ⚠️ 基准里**没有写请求**（23 条全 GET），所以 D 组那些写形状**至今没有判据**，
 * 只能等一次真机 `prepare → submit → cancel`（清单见
 * `test/ai-model.test.ts` 的 K 组 `it.todo` 与四份 `docs/pages/*.md` 的「待核实」一节）。
 *
 * 本地检出落后线上 435 个提交，但这四页的路由文件与 `app/portal/api` 目录**与线上逐字节一致**
 * （派单方逐文件 diff 过；基准又独立证实了一遍）。
 *
 * ## module-type：**不发**
 *
 * 四个页面路径在 `generated/module-type-rules.json` 里**匹配不到**（写这一版时实测四页全 absent）
 * —— 与浏览器一致，这一族页面同样不发这个头（conventions 第 2 条 / D34）。
 * **不要**给它编一个：不传是"该用户全部模块数据权限的并集"，传错比不传更糟。
 *
 * ## http 实例：`platform`（四页都没声明过别的）
 *
 * 四页的请求最终都打在 `app/portal/utils/http/platform.js` 上，但**声明的位置不一样**，
 * 这一组四种形式都有：
 *
 * | 页面 | 声明在哪 | conventions |
 * | --- | --- | --- |
 * | 模型列表 | `list.vue` / `[mode]/[id].vue` 直接 `import { http } from '…/platform.js'` | §28「声明在调用点上」 |
 * | 模型选择 | 同上（`list.vue` 与 `[mode]/[id].vue` 各一处） | §28 |
 * | 平台用量 | **页面本身一个字都没有**：`useQuotaList.js` / `useUsageAnalytics.js` 从 `common/libs/renren/list.js` 引 `useListPageModule` 且**不传 `http`**，靠 `common/libs/renren/config.js` 的全局默认（`app/portal/main.js:42-48` 注入的正是 platform.js） | **§26 + §28 的"最易漏"那一档** |
 * | 数据分析 | `list.vue` 与 `components/word-cloud.vue` 各直接 import | §28 |
 *
 * 「平台用量」那一行是这一组**唯一**需要专门查的：光看 `platform-usage/list.vue` 只有 12 行、
 * 连 `http` 字样都没有，它把整个页面交给了 `app/portal/views/dashboard/common/model-usage/`
 * 这个**共享目录**（个人用量 / 企业用量两页共用同一批组件）。真正的请求在
 * `common/model-usage/api.js`（**显式** import platform.js）与两个 composable 的 `customLoad` 里。
 * 结论仍是 `platform`，`HTTP_INSTANCE_PAGE_RULES` 里刻意不收它们（与全局默认字节相同）。
 *
 * ## 路径前缀：两种写法**都照抄页面**，不要统一
 *
 * `platform.js:18-20` 只给**以 `/` 开头、且不以 `/admin-api` `/adminmanage-api`
 * `/mall-manage-api` 开头**的 URL 补 `/admin-api`（conventions 第 25 条）。页面里两种写法混着用：
 *
 * - `/manager/aiModelConfig/*`、`/manager/aiModelSelection/*`、`/manage/ai/*` —— **不写**前缀，
 *   由拦截器补成 `/admin-api/manager/…`。本文件照抄这种写法。
 * - `/admin-api/ai-token/*`、`/admin-api/system/tenant/page`、`/admin-api/ops/user/userSearch`
 *   —— 页面**写死**了前缀（`interaction/model/api.js`、`common/model-usage/api.js`），
 *   拦截器对已带的不再补。本文件同样**原样**拼出来。
 *
 * 两种写法最终打到的 URL 是同一族，但"谁补的"不同；统一成一种会让 URL 与页面逐字不一致（D20）。
 *
 * ## ⚠️ `useJsonPost: true` 在 platform 实例上是**空标志**（不要当请求头建模）
 *
 * `interaction/model/api.js`、`model/[mode]/[id].vue`、`modelSelect/[mode]/[id].vue` 里的写请求
 * 都带了 `{ useJsonPost: true }`。**但 `platform.js` 从头到尾不读这个标志** ——
 * 全仓只有 `zhdj-cms.js:46` 与 `zhdj-app-lay.js:38` 消费它（那两处会把 body 手动
 * `JSON.stringify` 并设 `Content-Type: application/json;charset=UTF-8`）。
 *
 * `platform.js` 一侧实际发生的是：不设 `Content-Type`（`generateHttpHeaders()` 不设它），
 * body 是普通对象时走 **axios 自己的默认 JSON 序列化**；只有当 `content-type` 已经是
 * urlencoded 时才 `qs.stringify`（`platform.js:48`）。所以：
 *
 * **这条实例上"body 是对象就是 JSON"，`useJsonPost` 不产生任何额外行为。**
 * 照抄它的价值只在于"读页面时不至于以为漏了一个开关"，SDK 侧不需要对应参数。
 * （SDK 的请求层对 `data` 是对象同样直接交给 axios，行为一致。）
 *
 * ## 写链路（conventions 第 13 条）：`prepare()` → `submit()` → `cancel()`，三个分开
 *
 * 这一组是全项目写操作最密的一处。每个写面都有独立的三件套（见各方法注释），
 * 下面把**后端零幂等**（第 14 条）与"撤不掉"的地方先集中说清楚：
 *
 * | 写面 | 撤销办法 | 站得住吗 |
 * | --- | --- | --- |
 * | 模型 新建 | `cancelCreatedModel(modelName)` —— **`add` 不返回新 id**（后端 `success(null,"新建成功")`），只能按名字回查再删 | 可行，但**同名模型会歧义**，方法会拒绝而不是猜 |
 * | 模型 修改 | `restoreModel(previous)` —— 用 `prepareSaveModel` 读到的旧行再 update 一次 | ⚠️ **apiKey 回不去**：详情接口只回 `apiKeyMasked`（后端 `AiModelConfigDTO.apiKeyMasked`）。改过 apiKey 的更新**不可逆** |
 * | 模型 删除 | 无（`isConfigSelected(id)` 为真时后端直接拒："当前配置已经被选择，请勿删除"） | 撤不掉，**不要拿真模型试删除** |
 * | 额度/流速规则 新建 | `deleteQuotaRule/deleteFlowRule(createdId)` —— `create` **返回新 id**（后端 `CommonResult<Long>`） | 可行 |
 * | 额度/流速规则 修改 | 用 `prepare*` 读到的旧行再 update 一次 | 可行（`get/{id}` 回的是完整 RespVO） |
 * | 额度/流速规则 删除 | **无**（删掉就没了） | 撤不掉 |
 * | 申请处理（忽略 / 一键填写） | `cancelHandledApply({ id, previousStatus })` 用**读到的旧状态**再 handle 一次 | 可行；但"一键填写"顺手**新建了一条规则**，那条要单独 `deleteQuotaRule/deleteFlowRule` 才干净 |
 *
 * ## ⚠️ 申请处理的状态码：前端与后端**对不上**（写这一版时后端 `dev` 上是这样）
 *
 * 前端 `interaction/model/utils.js` 的 `APPLY_STATUS = { pending:0, ignored:1, filled:2, rejected:3 }`
 * —— 忽略发 `status=1`、一键填写发 `status=2`。
 * 后端 `AiTokenQuotaApplyHandleReqVO.status` 带 `@InEnum(AiTokenQuotaApplyStatusEnum.class)`，
 * 而 `AiTokenQuotaApplyStatusEnum` 只有 **`PENDING(0)` / `REJECTED(3)` / `HANDLED(4)`**
 * —— **没有 1 和 2**，反而多一个 4。
 *
 * 本能力**照抄页面的取值**（0/1/2/3 都放行、不做本地白名单），因为判据是页面而不是后端 dev，
 * 而这个冲突**只能在真机上定谁对**（部署到测试环境的可能是另一个分支）。
 * 详见 `docs/pages/模型列表.md` 的「待核实」一节。
 *
 * ## 长选项参数（conventions 第 11 条）：三处，都交回给调用方
 *
 * 1. **租户**（额度/流速规则的「租户配置」）：页面 `fetchTenantPage({name, pageNo:1, pageSize:20})`
 *    是**带关键字**的服务端搜索，还好；但**平台用量的企业筛选**那一侧是
 *    `fetchTenantList()` → `loopFetch(…, { pageSize: 200, maxPages: 100 })`，
 *    **挂载时全量翻页拉租户**（最多 100 页 × 200）。本能力**不照抄**，
 *    `tenantId` 做成 `kind:'search'` + `lookup: base-tenant-list`。
 * 2. **人员**（规则的「个人配置」）：`fetchUserPage({userName, pageNo:1, pageSize:20})`
 *    —— 这是**另一个上游**（`/admin-api/ops/user/userSearch`，代理到智慧蛋鸡 admin 的
 *    `.lay` 接口），与 SDK 已有的 `general-approval-user-search`（打 `/system/user/simple-page`）
 *    **不是同一个端点**，所以本文件单开一条 `ai-model-search-user`，并强制要关键字。
 * 3. **可用模型**（模型选择的模型下拉）：`GET /manager/aiModelConfig/getAvailableList`
 *    **无参数、一次全量**。它是模型选择的必填候选源，单开一条只读能力
 *    `ai-model-available-list`，`modelId` 一类参数用 `lookup` 指过去。
 *
 * ## 「平台用量」的两件事**不在**这里（别照着别的页面的印象补）
 *
 * - **没有"申请提升"**：`QuotaTab.vue` 的 `showApplyAction = statisticsDimension !== STATISTICS_DIMENSION.platform`
 *   —— 平台这一档（=3）**刻意不显示**申请入口。所以 `apply/create` 不属于本页。
 * - **`quota-usage/daily-progress` 不要做**：`common/model-usage/api.js:4` 有
 *   `fetchDailyQuotaProgress()`，但后端 `AiTokenQuotaUsageController:85` 把这个映射
 *   **整行注释掉了**（该控制器现在只有 `/progress` 与 `/open/progress`），
 *   页面调用点还带着 `silenceOnError: true` —— 这是个**已经失效且没人发现**的调用。
 *   conventions 第 28 条的精神：注释掉的东西不算数，本能力一个字都不从它推导。
 */

// ---------------------------------------------------------------------------
// 页面路径
// ---------------------------------------------------------------------------

export const AI_MODEL_LIST_PAGE_PATH = '/dashboard/platform/intelligence/interaction/model/list'
export const AI_MODEL_SELECT_PAGE_PATH = '/dashboard/platform/intelligence/interaction/modelSelect/list'
export const AI_PLATFORM_USAGE_PAGE_PATH = '/dashboard/platform/intelligence/interaction/platform-usage/list'
export const AI_DATA_ANALYSIS_PAGE_PATH = '/dashboard/platform/intelligence/interaction/dataAnalysis/list'

const VIEWS = 'app/portal/views/dashboard/platform/intelligence/interaction'

/** 路由文件，写进文档与排障时用得上 */
export const AI_MODEL_ROUTE_FILES = {
  modelList: `${VIEWS}/model/list.vue`,
  modelForm: `${VIEWS}/model/[mode]/[id].vue`,
  modelApi: `${VIEWS}/model/api.js`,
  modelSelectList: `${VIEWS}/modelSelect/list.vue`,
  modelSelectForm: `${VIEWS}/modelSelect/[mode]/[id].vue`,
  platformUsageList: `${VIEWS}/platform-usage/list.vue`,
  /** 平台用量的真正实现：共享目录，个人/企业/平台三档共用 */
  modelUsageContent: 'app/portal/views/dashboard/common/model-usage/components/ModelUsageContent.vue',
  modelUsageApi: 'app/portal/views/dashboard/common/model-usage/api.js',
  dataAnalysisList: `${VIEWS}/dataAnalysis/list.vue`,
  dataAnalysisWordCloud: `${VIEWS}/dataAnalysis/components/word-cloud.vue`,
} as const

// ---------------------------------------------------------------------------
// 权限码：v1 / v2 两代并存（v1 在 `menus/mall.js`，v2 在 `menus/mall.v2.js`）
// ---------------------------------------------------------------------------

/**
 * 权限码两代并存：`menus/mall.js` 是 v1、`menus/mall.v2.js` 是 v2。**本文件一律取 v2**
 * （线上跑的是 `mall.v2.js`），同时把 v1 也写出来供排障对照。
 *
 * **目录（`generated/page-catalog.json`）与这里逐字一致，四页均为 v2**
 * （2026-09-22 按 `menus/index.js` 的实际 import 校正 `menuSource`）：
 *
 * | 页面 | 目录里的权限码 | 目录的 `menuSource` |
 * | --- | --- | --- |
 * | 模型列表 / 模型选择 / 平台用量 | **v2** | `menus/mall.v2.js` |
 * | 数据分析 | **v2** | `menus/mall.v2.js` |
 *
 * 线上四页都使用 `mall.v2.js` 的权限码；`mall.js` 中的 v1 只作为历史对照存在。
 *
 * 两代对可见性判定**等价** —— `src/catalog/visibility.ts:116` 的 `normalizeVisibilityKey()`
 * 会把 `platform-v2` 折成 `platform`，所以 `test/ai-model.test.ts` 的 A 组是**归一后**再比，
 * 生成器以后先读到哪一份菜单文件，那条断言都锁得住。
 */
export const AI_MODEL_PERMISSIONS = {
  model: {
    v1: '/dashboard/platform/intelligence/interaction/model',
    v2: '/dashboard/platform-v2/intelligence/interaction/model',
  },
  modelSelect: {
    v1: '/dashboard/platform/intelligence/interaction/modelSelect',
    v2: '/dashboard/platform-v2/intelligence/interaction/modelSelect',
  },
  platformUsage: {
    v1: '/dashboard/platform/intelligence/interaction/platform-usage',
    v2: '/dashboard/platform-v2/intelligence/interaction/platform-usage',
  },
  dataAnalysis: {
    v1: '/dashboard/platform/intelligence/interaction/dataAnalysis',
    v2: '/dashboard/platform-v2/intelligence/interaction/dataAnalysis',
  },
} as const

/** 后端 `@PreAuthorize` 上的按钮级权限码（写链路会真的校验它们） */
export const AI_TOKEN_BUTTON_PERMISSIONS = {
  /** 「查看申请」列表（`AiTokenQuotaApplyController.getQuotaApplyPage`） */
  applyQuery: 'ai-token:apply:query',
  /** 「忽略 / 一键填写」（`AiTokenQuotaApplyController.handleQuotaApply`） */
  applyHandle: 'ai-token:apply:handle',
} as const

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

/**
 * 模型配置（`AiModelConfigController`，`@RequestMapping("/manager/aiModelConfig")`）。
 * **不写 `/admin-api`**：与页面一致，由 `platform.js` 的拦截器补。
 */
export const AI_MODEL_PATHS = {
  /** `GET`，`@RequestParam pageNo/pageSize` + `@RequestParam Map map`（其余筛选项走 map，不校验） */
  page: '/manager/aiModelConfig/getByPage',
  /** `GET /get/{id}` —— `@PathVariable` */
  detail: '/manager/aiModelConfig/get',
  availableList: '/manager/aiModelConfig/getAvailableList',
  add: '/manager/aiModelConfig/add',
  update: '/manager/aiModelConfig/update',
  /** `DELETE /delete/{id}` —— `@PathVariable`，不是 `?id=` */
  remove: '/manager/aiModelConfig/delete',
  test: '/manager/aiModelConfig/test',
} as const

/** 模型选择（`AiModelSelectionController`，`@RequestMapping("/manager/aiModelSelection")`） */
export const AI_MODEL_SELECTION_PATHS = {
  page: '/manager/aiModelSelection/getByPage',
  detail: '/manager/aiModelSelection/get',
  add: '/manager/aiModelSelection/add',
  update: '/manager/aiModelSelection/update',
  remove: '/manager/aiModelSelection/delete',
} as const

/**
 * AI Token 一族（`AiToken*Controller`）。⚠️ **这些路径页面里就带着 `/admin-api`**，
 * 照抄（已带的拦截器不再补）。
 */
export const AI_TOKEN_PATHS = {
  quotaRuleCreate: '/admin-api/ai-token/quota-rule/create',
  /** ⚠️ 额度规则的 update 是 **POST** */
  quotaRuleUpdate: '/admin-api/ai-token/quota-rule/update',
  quotaRuleDelete: '/admin-api/ai-token/quota-rule/delete',
  quotaRuleGet: '/admin-api/ai-token/quota-rule/get',
  quotaRulePage: '/admin-api/ai-token/quota-rule/page',

  flowRuleCreate: '/admin-api/ai-token/flow-rule/create',
  /** ⚠️ 流速规则的 update 是 **PUT**（与额度规则**不同**，后端 `@PutMapping`） */
  flowRuleUpdate: '/admin-api/ai-token/flow-rule/update',
  flowRuleDelete: '/admin-api/ai-token/flow-rule/delete',
  flowRuleGet: '/admin-api/ai-token/flow-rule/get',
  flowRulePage: '/admin-api/ai-token/flow-rule/page',

  /** 调整历史：额度与流速**同一个端点**，靠 `configType` 区分（1 额度 / 2 流速） */
  historyPage: '/admin-api/ai-token/history/page',

  applyCreate: '/admin-api/ai-token/apply/create',
  applyHandle: '/admin-api/ai-token/apply/handle',
  applyPendingCount: '/admin-api/ai-token/apply/pending-count',
  applyPage: '/admin-api/ai-token/apply/page',

  /** 额度用量（平台/企业/个人三档共用的组件，页面写死 `statisticsDimension`） */
  quotaUsagePage: '/admin-api/ai-token/quota-usage/page',
  quotaUsageSummary: '/admin-api/ai-token/quota-usage/summary',

  /** 调用明细一族 */
  usagePage: '/admin-api/ai-token/usage/page',
  usageSummary: '/admin-api/ai-token/usage/summary',
  usageTrend: '/admin-api/ai-token/usage/trend',
  usageModelRatio: '/admin-api/ai-token/usage/model-ratio',
  usageModuleRanking: '/admin-api/ai-token/usage/module-ranking',
  usageDetail: '/admin-api/ai-token/usage/detail',

  /** 技能候选（UsageTab 的筛选下拉）：**无参数、一次全量** */
  functionModuleList: '/admin-api/ai-token/common/function-module-list',

  /** 租户候选：页面有两条路（见文件头的长选项一节），这条是弹窗里那条带关键字的 */
  tenantPage: '/admin-api/system/tenant/page',
  /** 人员候选：**另一个上游**，代理到智慧蛋鸡 admin 的 `.lay` 接口 */
  userSearch: '/admin-api/ops/user/userSearch',
} as const

/**
 * 数据分析那六个统计端点（`AiInfoManageController`，`@RequestMapping("/manage/ai")`）。
 * **不写 `/admin-api`**，与页面一致。
 *
 * 后端签名都是 `(String startTime, String endTime)` —— 两个都是可选的普通 query 参数
 * （不是 `@RequestParam(required=false)` 但 Spring 按名字绑定、缺省即 null），
 * 所以页面不给区间时不发这两个参数是合法的。
 */
export const AI_ANALYSIS_PATHS = {
  /** 交互成功率 */
  answerRightRate: '/manage/ai/getStatsAnsRightRate',
  /** 各时段（按时间）提问统计 */
  statsByTime: '/manage/ai/getStatsByTime',
  /** 知识库文档调用次数排行 */
  knowledgeRecordRank: '/manage/ai/getKnowledgeRecordRank',
  /** AI 工具调用次数排行 */
  aiToolRecordRank: '/manage/ai/getAiToolRecordRank',
  /** AI 工具点击次数排行 */
  aiToolClickRank: '/manage/ai/getAiToolClickRank',
  /** 提问关键词热词 */
  questionKeywordHeat: '/manage/ai/getQuestionKeywordHeat',
} as const

// ---------------------------------------------------------------------------
// 枚举（全部来自页面常量表 / 后端枚举，逐条标出处）
// ---------------------------------------------------------------------------

/** `interaction/model/utils.js` 的 `RULE_SCOPE` */
export const RULE_SCOPE = { general: 1, tenant: 2, personal: 3 } as const

/** `model/utils.js` 的 `MEMBER_LEVEL`；与后端 `AiTokenMemberLevelEnum` 描述一致 */
export const MEMBER_LEVEL = {
  personal: 1,
  enterpriseFree: 2,
  enterpriseJunior: 3,
  enterpriseIntermediate: 4,
  enterpriseSenior: 5,
} as const

/** `model/utils.js` 的 `RESET_CYCLE`（后端 `AiTokenResetCycleEnum`：0-不重置，1-天，2-周，3-月） */
export const RESET_CYCLE = { none: 0, day: 1, week: 2, month: 3 } as const

/** `model/utils.js` 的 `CARRY_OVER_RULE`（后端 `AiTokenCarryOverRuleEnum`） */
export const CARRY_OVER_RULE = { dailyOnly: 1, accumulate: 2 } as const

/** `model/utils.js` 的 `QUOTA_STRATEGY`（后端 `AiTokenQuotaStrategyEnum`：1-禁止使用，2-提醒） */
export const QUOTA_STRATEGY = { forbid: 1, remind: 2 } as const

/** `model/utils.js` 的 `FLOW_STRATEGY`（后端 `AiTokenFlowStrategyEnum`：1-禁止使用，2-降速，3-提醒） */
export const FLOW_STRATEGY = { forbid: 1, slowDown: 2, remind: 3 } as const

/**
 * ⚠️ 申请状态：**页面**的取值（`model/utils.js` 的 `APPLY_STATUS`）。
 * 后端 `AiTokenQuotaApplyStatusEnum` 只有 0/3/4 —— 对不上，见文件头那一节。
 */
export const APPLY_STATUS = { pending: 0, ignored: 1, filled: 2, rejected: 3 } as const

/** 后端 `AiModelSelectionCallTypeEnum`（页面那个下拉走字典 `ai_model_selection_call_type`） */
export const CALL_TYPE = {
  /** APP对话 */
  app: 1,
  /** Web对话 —— ⚠️ 只有这一档要求 `skillIds` 非空（后端 `AiModelSelectionController:86`） */
  web: 2,
  /** 后端调用 */
  backend: 3,
  /** 前端意图识别 */
  client: 4,
} as const

export const CALL_TYPE_OPTIONS = [
  { label: 'APP对话', value: CALL_TYPE.app },
  { label: 'Web对话', value: CALL_TYPE.web },
  { label: '后端调用', value: CALL_TYPE.backend },
  { label: '前端意图识别', value: CALL_TYPE.client },
] as const

/** `common/model-usage/utils.js` 的 `STATISTICS_DIMENSION` */
export const STATISTICS_DIMENSION = { personal: 1, enterprise: 2, platform: 3 } as const

/** `common/model-usage/utils.js` 的 `QUOTA_CYCLE` */
export const QUOTA_CYCLE = { day: 1, week: 2, month: 3 } as const

/** `common/model-usage/utils.js` 的 `USAGE_STATUS_OPTIONS` */
export const USAGE_STATUS = { unallocated: 0, normal: 1, warning: 2, exhausted: 3 } as const

/** `common/model-usage/utils.js` 的 `CALL_STATUS_OPTIONS` */
export const CALL_STATUS = { success: 1, limited: 2, quotaNotEnough: 3, failed: 4 } as const

/** `common/model-usage/utils.js` 的 `TIME_RANGE_OPTIONS` */
export const TIME_RANGE = { today: 1, thisMonth: 2, last7Days: 3, last30Days: 4, custom: 5 } as const

/** `common/model-usage/utils.js` 的 `USER_BELONG_OPTIONS` */
export const USER_BELONG = { personal: 1, enterprise: 2 } as const

/** `common/model-usage/utils.js` 的 `LIMIT_TYPE_OPTIONS` */
export const LIMIT_TYPE = { flow: 'FLOW', quota: 'QUOTA' } as const

/** 调整历史的 `configType`（`model/utils.js` 的 `QUOTA_CONFIG_TYPE` / `FLOW_CONFIG_TYPE`） */
export const HISTORY_CONFIG_TYPE = { quota: 1, flow: 2 } as const

/** 租户候选每条最多取多少（`QuotaRuleModal.vue:143` / `FlowRuleModal.vue:138` 都是 20） */
export const TOKEN_CANDIDATE_PAGE_SIZE = 20

/** useListPageModule 的 `styleV2: true` → 每页 20（`common/libs/renren/list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/**
 * 调用类型那个下拉走的字典类型（`modelSelect/list.vue:6` 的 `portal-hxr-dict-select`）。
 * 取值域以后端 `AiModelSelectionCallTypeEnum` 为准（1..4），字典只是标签来源。
 */
export const CALL_TYPE_DICT_TYPE = 'ai_model_selection_call_type'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type AiModelRow = {
  id?: number | string
  modelName?: string
  description?: string
  apiUrl?: string
  apiKeyMasked?: string
  availableStatus?: number
  supportedFiles?: string
  temperature?: number | null
  timeout?: number | null
  maxToken?: number | null
  [key: string]: unknown
}

export type AiModelSelectionRow = {
  id?: number | string
  callType?: number
  skillIds?: string
  [key: string]: unknown
}

export type AiTokenRow = { id?: number | string; [key: string]: unknown }

export type AiModelPageQuery = {
  /** 模型名称。页面初值是 **`null`** ⇒ 不给就不发（`qs` 的 `skipNulls` 丢掉） */
  modelName?: string | null
  pageNo?: number
  pageSize?: number
}

export type AiModelTestFields = {
  modelName: string
  apiUrl: string
  apiKey?: string
}

/**
 * 新建/修改模型的草稿。
 *
 * ⚠️ 与页面一样，**字段是"扁平的一整行"**：编辑时页面把 `record` 展开进表单，
 * `customSubmit` 再用 `pick` 挑出固定的八个键 —— 所以这里也用同一份字段表。
 */
export type AiModelSaveDraft = {
  /** 有值 = 修改，无值 = 新建 */
  id?: number | string | null
  modelName: string
  description?: string
  apiUrl?: string
  apiKey?: string
  temperature?: number | null
  timeout?: number | null
  maxToken?: number | null
  /**
   * 本次会话里点过"测试"的结果。页面只在 `testResult.status` 为真时才把
   * `availableStatus` / `supportedFiles` 追加进 body（`[mode]/[id].vue:81-84`）。
   */
  testResult?: { status?: number | string | null; supportedFiles?: string | null }
  /**
   * 编辑态且**没有重新输入** apiKey 时置真 —— body 里**整个 `apiKey` 键消失**
   * （`[mode]/[id].vue:78-80` 的 `delete submitData.apiKey`）。
   */
  dropApiKey?: boolean
}

export type ModelSelectionDetailDraft = {
  /** 与后端 `AiModelSelectionDetailDTO.code` 对应 */
  code: string
  modelId: number | string
  /** 1 = 默认模型，0 = 备选 */
  isDefault: number
}

export type ModelSelectionSaveDraft = {
  id?: number | string | null
  callType: number
  details?: ModelSelectionDetailDraft[]
  /** 逗号分隔的字符串（页面 `arrayToIds` = `.join(',')`，空数组 → `''`） */
  skillIds?: string | number[]
}

export type QuotaRuleSaveDraft = {
  id?: number | string | null
  modelId: number | string
  ruleScope: number
  memberLevel?: number
  targetTenantId?: number | string
  targetTenantName?: string
  targetUserPhone?: string
  targetUserName?: string
  targetUserTypeName?: string
  totalQuota: number | string
  quotaCheckEnabled?: boolean
  carryOverRule?: number
  resetCycle: number
  shortageStrategy: number
  startTime: string
  endTime?: string
  reason?: string
}

export type FlowRuleSaveDraft = {
  id?: number | string | null
  modelId: number | string
  ruleScope: number
  memberLevel?: number
  targetTenantId?: number | string
  targetTenantName?: string
  targetUserPhone?: string
  targetUserName?: string
  targetUserTypeName?: string
  flowCheckEnabled?: boolean
  tokenLimitPerMinute: number | string
  maxTokenPerRequest: number | string
  exceedStrategy: number
  startTime: string
  endTime?: string
  reason?: string
}

export type QuotaUsageQuery = {
  modelName?: string
  quotaCycle?: number
  usageStatus?: number
  tenantId?: number | string
  userName?: string
  pageNo?: number
  pageSize?: number
}

export type UsageRecordQuery = {
  quotaCycle?: number
  timeRangeType?: number
  /** 只在 `timeRangeType === 5`（自定义）时有意义；其余档页面会把它清空 */
  startTime?: string
  endTime?: string
  requestId?: string
  modelId?: number | string
  /**
   * ⚠️ 页面在明细的 `form` 里带了这个键（初值 `undefined`），但**平台这一档永远不发**
   * ——「企业用量」才会填它（`useUsageDetailFilter = enterprise && !initialModelId`）。
   * 保留它是为了 `buildUsageQuery` 的键序与页面逐字一致。
   */
  tenantId?: number | string
  tenantName?: string
  userName?: string
  userBelong?: number
  memberLevel?: number
  functionModule?: string
  callStatus?: number
  limitType?: string
  quotaDeducted?: boolean
  pageNo?: number
  pageSize?: number
}

export type AiAnalysisQuery = {
  /** `YYYY-MM-DD`（页面 `range[0].format('YYYY-MM-DD')`）；不给就不发 */
  startTime?: string | null
  /** `YYYY-MM-DD` */
  endTime?: string | null
}

// ---------------------------------------------------------------------------
// 纯函数：参数装配（逐字段复刻各页面的 utils.js）
// ---------------------------------------------------------------------------

/**
 * `cleanQuery` —— `interaction/model/utils.js:461` 与 `common/model-usage/utils.js` 里
 * **同名同义**的一份：把 `''` / `null` / `undefined` **整个键丢掉**。
 *
 * ⚠️ 这与 conventions §3.2-② 那条"空值是空字符串、要照发"**不是一档**：
 * 那些页面的表单初值就是 `''` 且不做本地过滤，直接交给 `qs`；
 * 而这一组页面的 `buildXxxQuery()` 系列**自己先过滤一遍**，空串也活不下来。
 * 两种写法并存，照抄各自页面。
 *
 * ⚠️ 顺带一个后果：`cleanQuery` 会**按调用方给的键顺序重建对象**，
 * 所以 `order` / `orderField` 这类"列表默认参数"在平台用量那几条上**根本不出现**
 * （`buildQuotaQuery` / `buildUsageQuery` 的参数表里没有它们）。
 */
export function cleanQuery (source: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== '' && value !== null && value !== undefined),
  )
}

/** 页面 `logicFetch` 的列表默认参数（`common/libs/renren/list.js:474-482` 的键序） */
function buildListParams (
  form: Record<string, unknown>,
  pageNo: number,
  pageSize: number,
): Record<string, unknown> {
  // ⚠️ `order` / `orderField` 先写、表单字段后写：若表单里也有同名字段，
  // **位置留在第一次出现的地方**（对象展开不搬家）。这一组四个页面里没有重名的。
  return {
    order: '',
    orderField: '',
    ...form,
    pageNo,
    pageSize,
  }
}

/** 模型列表的查询参数（`model/list.vue:102-107` 的 `customLoad(form)`） */
export function buildModelListParams (query: AiModelPageQuery = {}): Record<string, unknown> {
  const form: Record<string, unknown> = {
    modelName: query.modelName ?? null,
  }
  const built = buildListParams(form, query.pageNo ?? 1, query.pageSize ?? DEFAULT_PAGE_SIZE)
  // 页面的 form 初值就是 null，qs 的 skipNulls 会丢掉它 —— 这里**不做**额外过滤，
  // 交给请求层同一组 qs 选项（两边一致），这样"调用方给 '' 就发 x=" 的行为也保住。
  return built
}

/** 模型选择的查询参数（`modelSelect/list.vue:59-61`：`callTypeList` 用 `,` 连接） */
export function buildModelSelectionListParams (query: {
  callTypeList?: Array<number | string>
  pageNo?: number
  pageSize?: number
} = {}): Record<string, unknown> {
  const joined = (query.callTypeList ?? []).join(',')
  const form: Record<string, unknown> = {
    // 页面写的是 `form.callTypeList?.join(',') || undefined` ⇒ 空数组得到 `undefined`
    callTypeList: joined === '' ? undefined : joined,
  }
  return buildListParams(form, query.pageNo ?? 1, query.pageSize ?? DEFAULT_PAGE_SIZE)
}

/** `buildQuotaQuery`（`common/model-usage/utils.js`）：键序就是参数表顺序 */
export function buildQuotaUsageQuery (
  query: QuotaUsageQuery = {},
  statisticsDimension: number = STATISTICS_DIMENSION.platform,
): Record<string, unknown> {
  return cleanQuery({
    modelName: query.modelName,
    quotaCycle: query.quotaCycle,
    statisticsDimension,
    usageStatus: query.usageStatus,
    tenantId: query.tenantId,
    userName: query.userName,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/** `buildUsageQueryWithSelectedModel` + `buildUsageQuery`：明细列表用 */
export function buildUsageRecordQuery (
  query: UsageRecordQuery = {},
  statisticsDimension: number = STATISTICS_DIMENSION.platform,
): Record<string, unknown> {
  return cleanQuery({
    quotaCycle: query.quotaCycle,
    timeRangeType: query.timeRangeType,
    statisticsDimension,
    startTime: normalizeStartTime(query.startTime),
    endTime: normalizeEndTime(query.endTime),
    requestId: query.requestId,
    modelId: query.modelId,
    tenantId: query.tenantId,
    tenantName: query.tenantName,
    userName: query.userName,
    userBelong: query.userBelong,
    memberLevel: query.memberLevel,
    functionModule: query.functionModule,
    callStatus: query.callStatus,
    limitType: query.limitType,
    quotaDeducted: query.quotaDeducted,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/** 明细列表的**汇总**（`fetchUsageSummary`）—— `buildUsageQuery` 里没有 `pageNo/pageSize` 也一样走 */
export function buildUsageSummaryQuery (
  query: UsageRecordQuery = {},
  statisticsDimension: number = STATISTICS_DIMENSION.platform,
): Record<string, unknown> {
  return cleanQuery({
    quotaCycle: query.quotaCycle,
    timeRangeType: query.timeRangeType,
    statisticsDimension,
    startTime: normalizeStartTime(query.startTime),
    endTime: normalizeEndTime(query.endTime),
    requestId: query.requestId,
    modelId: query.modelId,
    tenantId: query.tenantId,
    tenantName: query.tenantName,
    userName: query.userName,
    userBelong: query.userBelong,
    memberLevel: query.memberLevel,
    functionModule: query.functionModule,
    callStatus: query.callStatus,
    limitType: query.limitType,
    quotaDeducted: query.quotaDeducted,
  })
}

/** `normalizeStartTime`：**只补 10 位日期**的时分秒，带时间的原样过 */
function normalizeStartTime (value: string | undefined): string | undefined {
  if (!value) return value
  return String(value).length === 10 ? `${value} 00:00:00` : value
}

/** `normalizeEndTime`：补 `23:59:59`（**闭区间的那一端**，与学习统计那边的 +1 天不是一回事） */
function normalizeEndTime (value: string | undefined): string | undefined {
  if (!value) return value
  return String(value).length === 10 ? `${value} 23:59:59` : value
}

/** `buildQuotaRuleQuery`（`model/utils.js:203`） */
export function buildQuotaRuleQuery (query: {
  modelId?: number | string
  ruleScope?: number
  pageNo?: number
  pageSize?: number
} = {}): Record<string, unknown> {
  return cleanQuery({
    modelId: query.modelId,
    ruleScope: query.ruleScope,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/**
 * `buildFlowRuleQuery`（`model/utils.js:217`）。
 *
 * ⚠️ 参数表里有 `targetUserId`，但后端 `AiTokenFlowRulePageReqVO` 里**没有**这个字段
 * （只有 `modelId` / `ruleScope` / `targetTenantId` / `targetUserPhone` / `enabled`）。
 * 页面也没传它（`FlowRuleSection.vue:82` 只给 `modelId`/`ruleScope`）。照抄页面，透传。
 */
export function buildFlowRuleQuery (query: {
  modelId?: number | string
  ruleScope?: number
  targetTenantId?: number | string
  targetUserId?: number | string
  enabled?: boolean
  pageNo?: number
  pageSize?: number
} = {}): Record<string, unknown> {
  return cleanQuery({
    modelId: query.modelId,
    ruleScope: query.ruleScope,
    targetTenantId: query.targetTenantId,
    targetUserId: query.targetUserId,
    enabled: query.enabled,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/** `buildQuotaHistoryQuery` / `buildFlowHistoryQuery`（同一个端点，`configType` 区分） */
export function buildRuleHistoryQuery (query: {
  modelId?: number | string
  ruleScope?: number
  targetId?: number | string
  configType: number
  pageNo?: number
  pageSize?: number
}): Record<string, unknown> {
  return cleanQuery({
    modelId: query.modelId,
    ruleScope: query.ruleScope,
    targetId: query.targetId,
    configType: query.configType,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/** `buildApplyQuery`（`model/utils.js:182`）：日期区间补成 `00:00:00` / `23:59:59` */
export function buildApplyQuery (query: {
  modelId?: number | string
  userName?: string
  status?: number
  statisticsDimension?: number
  startDate?: string
  endDate?: string
  pageNo?: number
  pageSize?: number
} = {}): Record<string, unknown> {
  return cleanQuery({
    modelId: query.modelId,
    userName: query.userName,
    status: query.status,
    statisticsDimension: query.statisticsDimension,
    startDate: query.startDate ? `${query.startDate} 00:00:00` : undefined,
    endDate: query.endDate ? `${query.endDate} 23:59:59` : undefined,
    pageNo: query.pageNo,
    pageSize: query.pageSize,
  })
}

/** 数据分析那六条共用的区间参数（页面 `getDateRangeParams()`） */
export function buildAnalysisParams (query: AiAnalysisQuery = {}): Record<string, unknown> {
  return {
    startTime: query.startTime ?? null,
    endTime: query.endTime ?? null,
  }
}

// ---------------------------------------------------------------------------
// 纯函数：写载荷（prepare 与 submit 共用同一份，不会分叉）
// ---------------------------------------------------------------------------

/**
 * 模型新建/修改的 body —— 逐字段复刻 `[mode]/[id].vue:77-89`。
 *
 * 页面是 `pick(form, ['id','modelName','description','apiUrl','apiKey','temperature','timeout','maxToken'])`：
 * `lodash.pick` **按给定的键序输出、且保留 `null`**（实测：`id:null` 会留在 body 里），
 * 所以新建时 body 的第一个键就是 `"id":null`。
 *
 * 之后两处**追加**：
 * - `testResult.status` 为真 → `availableStatus` + `supportedFiles`（`|| ''`）
 * - `dropApiKey` → **`delete` 掉 `apiKey`**（键消失，其余键的相对顺序不变）
 */
export function buildModelSavePayload (draft: AiModelSaveDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: draft.id ?? null,
    modelName: draft.modelName,
    description: draft.description ?? '',
    apiUrl: draft.apiUrl ?? '',
    apiKey: draft.apiKey ?? '',
    temperature: draft.temperature ?? null,
    timeout: draft.timeout ?? null,
    maxToken: draft.maxToken ?? null,
  }
  // `delete` 只让这个键消失，其余键的相对顺序不动 —— 与页面 `delete submitData.apiKey` 一致
  if (draft.dropApiKey) delete payload.apiKey
  if (draft.testResult?.status) {
    payload.availableStatus = Number(draft.testResult.status)
    payload.supportedFiles = draft.testResult.supportedFiles || ''
  }
  return payload
}

/**
 * 连通性测试的 body —— **两个调用点的键序不同**，这是两个不同的方法而不是一个：
 *
 * - `list.vue:155`：`{ id, modelName, apiUrl, apiKey }` —— **id 在最前**
 * - `[mode]/[id].vue:147-149`：`{ modelName, apiUrl, apiKey }`，然后 `if (id) body.id = id`
 *   —— **id 在最后，且 falsy 时整个键不出现**
 *
 * D20 要求与浏览器逐字段一致，键顺序不同也算不一致，所以两张形状都得留着。
 */
export function buildModelTestBodyFromRow (row: {
  id?: number | string
  modelName?: string
  apiUrl?: string
  apiKey?: string
}): Record<string, unknown> {
  return {
    id: row.id,
    modelName: row.modelName,
    apiUrl: row.apiUrl,
    apiKey: row.apiKey,
  }
}

/** 见 `buildModelTestBodyFromRow` */
export function buildModelTestBodyFromForm (form: AiModelTestFields & { id?: number | string | null }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    modelName: form.modelName,
    apiUrl: form.apiUrl,
    apiKey: form.apiKey,
  }
  if (form.id) body.id = form.id
  return body
}

/**
 * 模型选择的 body —— 复刻 `modelSelect/[mode]/[id].vue:273-288`。
 *
 * 键序：`callType` → `details` →（有 id 时）`id` →（callType === 2 时）`skillIds`。
 * `skillIds` 是**逗号分隔的字符串**（页面 `arrayToIds` = `arr.join(',')`，空数组得到 `''`）。
 */
export function buildModelSelectionSavePayload (draft: ModelSelectionSaveDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    callType: draft.callType,
    details: (draft.details ?? []).map((item) => ({
      code: item.code,
      modelId: item.modelId,
      isDefault: item.isDefault,
    })),
  }
  if (draft.id) payload.id = draft.id
  if (Number(draft.callType) === CALL_TYPE.web) {
    payload.skillIds = Array.isArray(draft.skillIds) ? draft.skillIds.join(',') : (draft.skillIds ?? '')
  }
  return payload
}

/**
 * 额度规则 body —— 复刻 `model/utils.js:389` 的 `buildQuotaManagementPayload`
 * （「额度管理」弹窗新增/编辑走的就是它）。
 *
 * ⚠️ `quotaCheckEnabled: form.quotaCheckEnabled !== false` —— **没给就是 true**，
 * 只有显式传 `false` 才关闭。`enabled` 页面写死 `true`。
 */
export function buildQuotaRuleSavePayload (draft: QuotaRuleSaveDraft): Record<string, unknown> {
  const scope = Number(draft.ruleScope)
  return cleanQuery({
    id: draft.id,
    modelId: draft.modelId,
    ruleScope: draft.ruleScope,
    memberLevel: scope === RULE_SCOPE.general ? draft.memberLevel : undefined,
    targetTenantId: scope === RULE_SCOPE.tenant ? draft.targetTenantId : undefined,
    targetTenantName: scope === RULE_SCOPE.tenant ? draft.targetTenantName : undefined,
    targetUserPhone: scope === RULE_SCOPE.personal ? draft.targetUserPhone : undefined,
    targetUserName: scope === RULE_SCOPE.personal ? draft.targetUserName : undefined,
    targetUserTypeName: scope === RULE_SCOPE.personal ? draft.targetUserTypeName : undefined,
    totalQuota: normalizeNumber(draft.totalQuota),
    quotaCheckEnabled: draft.quotaCheckEnabled !== false,
    carryOverRule: draft.carryOverRule,
    resetCycle: draft.resetCycle,
    shortageStrategy: draft.shortageStrategy,
    startTime: draft.startTime,
    endTime: draft.endTime,
    reason: draft.reason,
    enabled: true,
  })
}

/**
 * 流速规则 body —— 复刻 `model/utils.js:417` 的 `buildFlowManagementPayload`。
 *
 * 与额度规则的差别：`flowCheckEnabled`（不是 `quotaCheckEnabled`）、
 * `tokenLimitPerMinute` + `maxTokenPerRequest`（两个都必填、都 `@Positive`）、
 * `exceedStrategy`（三选一）。**没有** `carryOverRule` / `resetCycle` / `shortageStrategy`。
 */
export function buildFlowRuleSavePayload (draft: FlowRuleSaveDraft): Record<string, unknown> {
  const scope = Number(draft.ruleScope)
  return cleanQuery({
    id: draft.id,
    modelId: draft.modelId,
    ruleScope: draft.ruleScope,
    memberLevel: scope === RULE_SCOPE.general ? draft.memberLevel : undefined,
    targetTenantId: scope === RULE_SCOPE.tenant ? draft.targetTenantId : undefined,
    targetTenantName: scope === RULE_SCOPE.tenant ? draft.targetTenantName : undefined,
    targetUserPhone: scope === RULE_SCOPE.personal ? draft.targetUserPhone : undefined,
    targetUserName: scope === RULE_SCOPE.personal ? draft.targetUserName : undefined,
    targetUserTypeName: scope === RULE_SCOPE.personal ? draft.targetUserTypeName : undefined,
    flowCheckEnabled: draft.flowCheckEnabled !== false,
    tokenLimitPerMinute: normalizeNumber(draft.tokenLimitPerMinute),
    maxTokenPerRequest: normalizeNumber(draft.maxTokenPerRequest),
    exceedStrategy: draft.exceedStrategy,
    startTime: draft.startTime,
    endTime: draft.endTime,
    reason: draft.reason,
    enabled: true,
  })
}

/**
 * 「一键填写」申请时的**额度规则** body —— 复刻 `model/utils.js:361` 的 `buildQuotaRulePayload`。
 *
 * 与「额度管理」那份的差别不小：**没有** `id` / `memberLevel` / `quotaCheckEnabled` /
 * `carryOverRule`；个人档用的是 **`targetUserId`**（不是 `targetUserPhone`）、也**不带**
 * `targetUserTypeName`；额度默认取申请的期望值。**它是另一条链路，不要与上面那份合并。**
 *
 * ## ⚠️ 这条链路发出去的 `targetUserId` 后端**不认识**（写这一版时后端 `dev` 上是这样）
 *
 * 后端两个 SaveReqVO（`AiTokenQuotaRuleSaveReqVO` / `AiTokenFlowRuleSaveReqVO`）里
 * **都没有 `targetUserId` 字段**（全 `erp-module-ai` 搜 `targetUserId` **0 命中**）；
 * 个人规则的命中判据是 **`targetUserPhone` + `targetTenantId`**
 * （`AiTokenManagementServiceImpl:1524` 的注释与 `:3024` 的 `Objects.equals(targetUserPhone, loginUser.getMobile())`）。
 *
 * 后果：页面这条"一键填写"落到个人档时，`targetUserId` 会被 Jackson 当未知字段丢掉
 * （Spring Boot 默认不 FAIL_ON_UNKNOWN_PROPERTIES），于是**新建出来的规则认不到人**
 * —— 页面上看起来"填好了"，规则却不生效。
 *
 * 本能力**照抄页面**（D20 优先，且判据是页面不是后端 dev），但把这个坑写在这里，
 * 并让两个 `fillApplyWith*` 在返回里带 `warnings` 提示它。要真的落到人，
 * 正确做法是**走「额度管理」那条链路**（`saveQuotaRule` / `saveFlowRule`，那边用的是
 * `targetUserPhone`），或者在真机上确认后端实际接受哪一个字段。
 */
export function buildQuotaRuleFromApplyPayload (input: {
  modelId: number | string
  apply: {
    tenantId?: number | string
    tenantName?: string
    userId?: number | string
    userName?: string
    expectedMonthlyQuota?: number | string
    reason?: string
  }
  form?: {
    totalQuota?: number | string
    resetCycle?: number
    shortageStrategy?: number
    startTime?: string
    endTime?: string
    reason?: string
  }
}): Record<string, unknown> {
  const { apply, form = {}, modelId } = input
  const target = apply.tenantId
    ? {
        ruleScope: RULE_SCOPE.tenant,
        targetTenantId: apply.tenantId,
        targetTenantName: apply.tenantName,
        targetUserId: undefined,
        targetUserName: undefined,
      }
    : {
        ruleScope: RULE_SCOPE.personal,
        targetTenantId: undefined,
        targetTenantName: undefined,
        targetUserId: apply.userId,
        targetUserName: apply.userName,
      }
  return cleanQuery({
    modelId,
    ...target,
    totalQuota: normalizeNumber(form.totalQuota ?? apply.expectedMonthlyQuota),
    resetCycle: form.resetCycle,
    shortageStrategy: form.shortageStrategy,
    startTime: form.startTime,
    endTime: form.endTime,
    reason: form.reason || apply.reason,
    enabled: true,
  })
}

/** 「一键填写」申请时的**流速规则** body —— 复刻 `buildFlowRulePayload` */
export function buildFlowRuleFromApplyPayload (input: {
  modelId: number | string
  apply: {
    tenantId?: number | string
    tenantName?: string
    userId?: number | string
    userName?: string
    expectedMaxToken?: number | string
    reason?: string
  }
  form?: {
    tokenLimitPerMinute?: number | string
    maxTokenPerRequest?: number | string
    exceedStrategy?: number
    startTime?: string
    endTime?: string
    reason?: string
  }
}): Record<string, unknown> {
  const { apply, form = {}, modelId } = input
  const target = apply.tenantId
    ? {
        ruleScope: RULE_SCOPE.tenant,
        targetTenantId: apply.tenantId,
        targetTenantName: apply.tenantName,
        targetUserId: undefined,
        targetUserName: undefined,
      }
    : {
        ruleScope: RULE_SCOPE.personal,
        targetTenantId: undefined,
        targetTenantName: undefined,
        targetUserId: apply.userId,
        targetUserName: apply.userName,
      }
  return cleanQuery({
    modelId,
    ...target,
    tokenLimitPerMinute: normalizeNumber(form.tokenLimitPerMinute),
    maxTokenPerRequest: normalizeNumber(form.maxTokenPerRequest ?? apply.expectedMaxToken),
    exceedStrategy: form.exceedStrategy,
    startTime: form.startTime,
    endTime: form.endTime,
    reason: form.reason || apply.reason,
    enabled: true,
  })
}

/** 申请的 handle body（`useApplyModals.js:44` / `:101`） */
export function buildApplyHandlePayload (apply: {
  id: number | string
  status: number
  statisticsDimension?: number
  rejectReason?: string
}): Record<string, unknown> {
  return cleanQuery({
    id: apply.id,
    status: apply.status,
    statisticsDimension: apply.statisticsDimension,
    rejectReason: apply.rejectReason,
  })
}

/** `model/utils.js:128` 的 `normalizeNumber`：去千分位、非有限值 → `undefined` */
export function normalizeNumber (value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const numberValue = Number(String(value).replaceAll(',', ''))
  return Number.isFinite(numberValue) ? numberValue : undefined
}

/**
 * 「这次填写要落在哪个范围」—— `getRuleTarget`（`model/utils.js:341`）。
 * 有 `tenantId` 落租户、否则落个人；两条链路的 `buildXxxFromApplyPayload` 都用它。
 */
export function getRuleTarget (apply: {
  tenantId?: number | string
  tenantName?: string
  userId?: number | string
  userName?: string
}): {
  ruleScope: number
  targetTenantId?: number | string
  targetTenantName?: string
  targetUserId?: number | string
  targetUserName?: string
} {
  if (apply.tenantId) {
    return {
      ruleScope: RULE_SCOPE.tenant,
      targetTenantId: apply.tenantId,
      targetTenantName: apply.tenantName,
      targetUserId: undefined,
      targetUserName: undefined,
    }
  }
  return {
    ruleScope: RULE_SCOPE.personal,
    targetTenantId: undefined,
    targetTenantName: undefined,
    targetUserId: apply.userId,
    targetUserName: apply.userName,
  }
}

// ---------------------------------------------------------------------------
// 本地校验（对齐后端与页面的**硬**校验；不发明新规则）
// ---------------------------------------------------------------------------

function requireNonEmptyString (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}必填（后端会对空值返回 400「请求参数缺失:${label}」）`)
  }
  return value
}

function requireId (value: unknown, label: string): number | string {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(`${label}必填（后端 @NotNull）`)
  }
  const asNumber = Number(value)
  if (!Number.isFinite(asNumber)) {
    throw new Error(`${label}必须是数字，收到的是 ${JSON.stringify(value)}`)
  }
  return value as number | string
}

function requirePositiveNumber (value: unknown, label: string): number {
  const normalized = normalizeNumber(value)
  if (normalized === undefined || normalized <= 0) {
    throw new Error(`${label}必填且必须大于 0（后端 @Positive），收到的是 ${JSON.stringify(value)}`)
  }
  return normalized
}

/**
 * 模型草稿的硬校验 —— 对齐 `AiModelConfigController.add` 的四条 `isBlank` 检查
 * （`modelName` / `description` / `apiUrl` / `apiKey`，缺一条就是 400）。
 *
 * ⚠️ 后端 `add` 还有一条 **`apiUrl` 必须以 `/chat/completions` 结尾**（"兼容模式下…"）。
 * 这一条**不在这里硬拦**：它看起来是"兼容模式"的产物、是否对所有模型都成立没有实测，
 * 硬拦会把合法调用挡在门外。它由 `prepareSaveModel` 以 `warnings` 的形式给出。
 */
function assertModelDraft (draft: AiModelSaveDraft): void {
  // ⚠️ 这四个在**新建**时是后端硬校验（`AiModelConfigController.add` 的四条 isBlank）。
  // **修改**时后端不校验它们，但页面总是把整行 `pick` 成这八个键再提交 ⇒ 少给就等于
  // 用空串把它们**清掉**。所以这里对新建/修改一律要求给全，报错文案也照这个说。
  requireNonEmptyString(draft.modelName, '模型名称 modelName')
  requireNonEmptyString(draft.description, '描述 description')
  requireNonEmptyString(draft.apiUrl, 'API apiUrl')
  if (!draft.dropApiKey) requireNonEmptyString(draft.apiKey, 'API Key apiKey')
  if (draft.id !== undefined && draft.id !== null) requireId(draft.id, '模型 id')
}

function assertRuleDraft (draft: QuotaRuleSaveDraft | FlowRuleSaveDraft): void {
  requireId(draft.modelId, '模型 id modelId')
  const scope = Number(requireId(draft.ruleScope, '规则范围 ruleScope'))
  if (scope !== RULE_SCOPE.general && scope !== RULE_SCOPE.tenant && scope !== RULE_SCOPE.personal) {
    throw new Error(`规则范围 ruleScope 只能是 1/2/3（通用/租户/个人），收到的是 ${JSON.stringify(draft.ruleScope)}`)
  }
  requireNonEmptyString(draft.startTime, '生效时间 startTime（后端 @NotNull）')
  if (draft.id !== undefined && draft.id !== null) requireId(draft.id, '规则 id')
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const MODEL_PAGE_SUFFIX: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/** 长的候选统一用 `lookup` 指回查候选的能力（conventions 第 11 条） */
const TENANT_LOOKUP = { capabilityId: 'base-tenant-list', keywordParam: 'keyword' } as const
const USER_LOOKUP = { capabilityId: 'ai-model-search-user', keywordParam: 'keyword' } as const
const MODEL_LOOKUP = { capabilityId: 'ai-model-available-list', keywordParam: 'keyword' } as const

const MODEL_LIST_PARAMS: ParamSpec[] = [
  {
    name: 'modelName',
    kind: 'text',
    required: false,
    description: '模型名称。页面初值是 **null** ⇒ 不传就不发这一项（与"空串照发"的那批页面相反）',
  },
  ...MODEL_PAGE_SUFFIX,
]

const MODEL_SAVE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: false, description: '有值 = 修改，无值 = 新建（body 里仍会出现 `id:null`）' },
  { name: 'modelName', kind: 'text', required: true, description: '模型名称（后端 add 必填）' },
  { name: 'description', kind: 'text', required: true, description: '描述（后端 add 必填，空串会被拒）' },
  { name: 'apiUrl', kind: 'text', required: true, description: 'API 地址（后端 add 必填）' },
  { name: 'apiKey', kind: 'text', required: false, description: 'API Key / Token（新建必填；编辑不重输时整个键不发）' },
  { name: 'temperature', kind: 'number', required: false, description: '温度' },
  { name: 'timeout', kind: 'number', required: false, description: '超时时间（秒），页面校验正整数' },
  { name: 'maxToken', kind: 'number', required: false, description: '最大词元，页面校验正整数' },
  {
    name: 'testResult',
    kind: 'text',
    required: false,
    description:
      '**结构化值**（不是文本）：`{status, supportedFiles}`。本次会话点过"测试"才带 —— ' +
      '带上后 body 会**追加** `availableStatus`（数字）与 `supportedFiles`（`|| ""`）',
  },
]

const MODEL_TEST_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: false, description: '模型 id' },
  { name: 'modelName', kind: 'text', required: true, description: '模型名称（后端 /test 必填）' },
  { name: 'apiUrl', kind: 'text', required: true, description: 'API 地址（后端 /test 必填）' },
  { name: 'apiKey', kind: 'text', required: false, description: 'API Key / Token（后端 /test **不校验**它，但页面照发）' },
]

const SELECTION_LIST_PARAMS: ParamSpec[] = [
  {
    name: 'callTypeList',
    kind: 'enum',
    required: false,
    description: '调用类型（多选，逗号连接后发出；空数组 → 整项不发）',
    options: [...CALL_TYPE_OPTIONS],
  },
  ...MODEL_PAGE_SUFFIX,
]

const SELECTION_SAVE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: false, description: '有值 = 修改，无值 = 新建' },
  {
    name: 'callType',
    kind: 'enum',
    required: true,
    description: '调用类型（后端必填；同一 callType **只能有一条**，新建重复会 500）',
    options: [...CALL_TYPE_OPTIONS],
  },
  {
    name: 'details',
    kind: 'search',
    required: false,
    description:
      '**结构化值**：模型明细数组 `[{code, modelId, isDefault}]`（键序固定就是这三个）。' +
      '`isDefault=1` 是默认模型。里面的 `modelId` 要先查候选，不要猜',
    lookup: MODEL_LOOKUP,
  },
  {
    name: 'skillIds',
    kind: 'search',
    required: false,
    description: '技能（**逗号分隔字符串**）。⚠️ `callType=2`（Web对话）时后端**强制非空**',
    lookup: { capabilityId: 'ai-model-available-list', keywordParam: 'keyword' },
  },
]

const QUOTA_RULE_PARAMS: ParamSpec[] = [
  { name: 'modelId', kind: 'search', required: true, description: '模型 id（必填，候选见 ai-model-list）', lookup: MODEL_LOOKUP },
  {
    name: 'ruleScope',
    kind: 'enum',
    required: true,
    description: '规则范围：1 通用 / 2 租户 / 3 个人',
    options: [
      { label: '通用设置', value: RULE_SCOPE.general },
      { label: '租户配置', value: RULE_SCOPE.tenant },
      { label: '个人配置', value: RULE_SCOPE.personal },
    ],
  },
  {
    name: 'memberLevel',
    kind: 'enum',
    required: false,
    description: '会员等级（**只有 `ruleScope=1` 会发**）',
    options: [
      { label: '个人用户', value: MEMBER_LEVEL.personal },
      { label: '企业用户-免费', value: MEMBER_LEVEL.enterpriseFree },
      { label: '企业用户-初级', value: MEMBER_LEVEL.enterpriseJunior },
      { label: '企业用户-中级', value: MEMBER_LEVEL.enterpriseIntermediate },
      { label: '企业用户-高级', value: MEMBER_LEVEL.enterpriseSenior },
    ],
  },
  {
    name: 'targetTenantId',
    kind: 'search',
    required: false,
    description: '目标租户（**只有 `ruleScope=2` 会发**）。**先要关键字**再查候选，不要猜 id',
    lookup: TENANT_LOOKUP,
  },
  { name: 'targetTenantName', kind: 'text', required: false, description: '目标租户名称（`ruleScope=2`）' },
  {
    name: 'targetUserPhone',
    kind: 'search',
    required: false,
    description: '目标用户手机号（**只有 `ruleScope=3` 会发**）',
    lookup: USER_LOOKUP,
  },
  { name: 'targetUserName', kind: 'text', required: false, description: '目标用户名称（`ruleScope=3`）' },
  { name: 'targetUserTypeName', kind: 'text', required: false, description: '目标用户类型（`ruleScope=3`，HR同步 / 智慧蛋鸡同步）' },
  { name: 'totalQuota', kind: 'number', required: true, description: 'Token 总额度（后端 @NotNull @Positive）' },
  { name: 'quotaCheckEnabled', kind: 'boolean', required: false, description: '额度校验开关。**不给就是 true**，只有显式 false 才关' },
  {
    name: 'carryOverRule',
    kind: 'enum',
    required: false,
    description: '结转规则：1 当天有效（不结转）/ 2 未用结转',
    options: [
      { label: '当天有效（不结转）', value: CARRY_OVER_RULE.dailyOnly },
      { label: '未用结转（累积模式）', value: CARRY_OVER_RULE.accumulate },
    ],
  },
  {
    name: 'resetCycle',
    kind: 'enum',
    required: true,
    description: '重置周期（后端 @NotNull）：0 不重置 / 1 天 / 2 周 / 3 月',
    options: [
      { label: '每日', value: RESET_CYCLE.day },
      { label: '每周', value: RESET_CYCLE.week },
      { label: '每月', value: RESET_CYCLE.month },
      { label: '不重置', value: RESET_CYCLE.none },
    ],
  },
  {
    name: 'shortageStrategy',
    kind: 'enum',
    required: true,
    description: '额度不足处理（后端 @NotNull）：1 禁止使用 / 2 提醒',
    options: [
      { label: '禁止使用', value: QUOTA_STRATEGY.forbid },
      { label: '仅提醒', value: QUOTA_STRATEGY.remind },
    ],
  },
  { name: 'startTime', kind: 'date', required: true, description: '生效时间 `YYYY-MM-DD HH:mm:ss`（后端 @NotNull）' },
  { name: 'endTime', kind: 'date', required: false, description: '到期时间 `YYYY-MM-DD HH:mm:ss`' },
  { name: 'reason', kind: 'text', required: false, description: '调整原因' },
]

const FLOW_RULE_PARAMS: ParamSpec[] = [
  { name: 'modelId', kind: 'search', required: true, description: '模型 id（必填）', lookup: MODEL_LOOKUP },
  {
    name: 'ruleScope',
    kind: 'enum',
    required: true,
    description: '规则范围：1 通用 / 2 租户 / 3 个人',
    options: [
      { label: '通用设置', value: RULE_SCOPE.general },
      { label: '租户配置', value: RULE_SCOPE.tenant },
      { label: '个人配置', value: RULE_SCOPE.personal },
    ],
  },
  { name: 'memberLevel', kind: 'enum', required: false, description: '会员等级（`ruleScope=1`）' },
  { name: 'targetTenantId', kind: 'search', required: false, description: '目标租户（`ruleScope=2`）', lookup: TENANT_LOOKUP },
  { name: 'targetTenantName', kind: 'text', required: false, description: '目标租户名称（`ruleScope=2`）' },
  { name: 'targetUserPhone', kind: 'search', required: false, description: '目标用户手机号（`ruleScope=3`）', lookup: USER_LOOKUP },
  { name: 'targetUserName', kind: 'text', required: false, description: '目标用户名称（`ruleScope=3`）' },
  { name: 'targetUserTypeName', kind: 'text', required: false, description: '目标用户类型（`ruleScope=3`）' },
  { name: 'flowCheckEnabled', kind: 'boolean', required: false, description: '限速校验开关。**不给就是 true**' },
  { name: 'tokenLimitPerMinute', kind: 'number', required: true, description: '每分钟 Token 上限（后端 @NotNull @Positive）' },
  { name: 'maxTokenPerRequest', kind: 'number', required: true, description: '单次最大 Token（后端 @NotNull @Positive）' },
  {
    name: 'exceedStrategy',
    kind: 'enum',
    required: true,
    description: '超限处理（后端 @NotNull）：1 禁止使用 / 2 降速 / 3 提醒',
    options: [
      { label: '禁止使用', value: FLOW_STRATEGY.forbid },
      { label: '降速处理', value: FLOW_STRATEGY.slowDown },
      { label: '仅提醒', value: FLOW_STRATEGY.remind },
    ],
  },
  { name: 'startTime', kind: 'date', required: true, description: '生效时间（后端 @NotNull）' },
  { name: 'endTime', kind: 'date', required: false, description: '到期时间' },
  { name: 'reason', kind: 'text', required: false, description: '调整原因' },
]

const APPLY_PARAMS: ParamSpec[] = [
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description:
      '申请状态。⚠️ **前后端取值对不上**（见文件头）：页面用 0/1/2/3（待处理/已忽略/已填写/已驳回），' +
      '后端枚举只有 0/3/4。本能力放行 0..4 全档',
    options: [
      { label: '待处理', value: APPLY_STATUS.pending },
      { label: '已忽略', value: APPLY_STATUS.ignored },
      { label: '已填写', value: APPLY_STATUS.filled },
      { label: '已驳回', value: APPLY_STATUS.rejected },
    ],
  },
  { name: 'userName', kind: 'text', required: false, description: '申请人名称' },
  { name: 'modelId', kind: 'search', required: false, description: '模型 id', lookup: MODEL_LOOKUP },
  { name: 'startDate', kind: 'date', required: false, description: '申请时间起 `YYYY-MM-DD`（发出时补 `00:00:00`）' },
  { name: 'endDate', kind: 'date', required: false, description: '申请时间止 `YYYY-MM-DD`（发出时补 `23:59:59`）' },
  ...MODEL_PAGE_SUFFIX,
]

const APPLY_HANDLE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: true, description: '申请 id（后端 @NotNull）' },
  {
    name: 'status',
    kind: 'enum',
    required: true,
    description:
      '处理状态（后端 @NotNull @InEnum）。⚠️ 页面发 1（已忽略）/ 2（已填写），后端枚举只有 0/3/4 —— **真机上才能定谁对**',
    options: [
      { label: '待处理（退回）', value: APPLY_STATUS.pending },
      { label: '已忽略', value: APPLY_STATUS.ignored },
      { label: '已填写', value: APPLY_STATUS.filled },
      { label: '已驳回', value: APPLY_STATUS.rejected },
    ],
  },
  { name: 'rejectReason', kind: 'text', required: false, description: '驳回原因（后端只在 `status=3` 时落库）' },
]

const QUOTA_USAGE_PARAMS: ParamSpec[] = [
  { name: 'modelName', kind: 'text', required: false, description: '模型名称' },
  {
    name: 'quotaCycle',
    kind: 'enum',
    required: false,
    description: '额度周期。页面初值 **3（月）**',
    options: [
      { label: '日额度', value: QUOTA_CYCLE.day },
      { label: '周额度', value: QUOTA_CYCLE.week },
      { label: '月额度', value: QUOTA_CYCLE.month },
    ],
  },
  {
    name: 'usageStatus',
    kind: 'enum',
    required: false,
    description: '使用状态（页面走字典 `usage_status`，这里是同一批值）',
    options: [
      { label: '未分配', value: USAGE_STATUS.unallocated },
      { label: '正常', value: USAGE_STATUS.normal },
      { label: '预警', value: USAGE_STATUS.warning },
      { label: '已用尽', value: USAGE_STATUS.exhausted },
    ],
  },
  {
    name: 'tenantId',
    kind: 'search',
    required: false,
    description:
      '企业 id。⚠️ 页面在**平台**这一档挂载时会全量翻页拉租户（`loopFetch` 最多 100×200）；' +
      '**本能力不照抄**，要用请先问关键字',
    lookup: TENANT_LOOKUP,
  },
  { name: 'userName', kind: 'text', required: false, description: '用户名称' },
  ...MODEL_PAGE_SUFFIX,
]

const USAGE_RECORD_PARAMS: ParamSpec[] = [
  {
    name: 'quotaCycle',
    kind: 'enum',
    required: false,
    description: '额度周期。⚠️ 明细 Tab 的初值是 **2（周）**，与额度 Tab 的 3（月）**不同**',
    options: [
      { label: '日额度', value: QUOTA_CYCLE.day },
      { label: '周额度', value: QUOTA_CYCLE.week },
      { label: '月额度', value: QUOTA_CYCLE.month },
    ],
  },
  {
    name: 'timeRangeType',
    kind: 'enum',
    required: false,
    description: '时间范围。初值 2（本月）；选 5（自定义）时才看 `startTime`/`endTime`',
    options: [
      { label: '今日', value: TIME_RANGE.today },
      { label: '本月', value: TIME_RANGE.thisMonth },
      { label: '近7天', value: TIME_RANGE.last7Days },
      { label: '近30天', value: TIME_RANGE.last30Days },
      { label: '自定义', value: TIME_RANGE.custom },
    ],
  },
  { name: 'startTime', kind: 'date', required: false, description: '起：`YYYY-MM-DD` 会自动补 ` 00:00:00`' },
  { name: 'endTime', kind: 'date', required: false, description: '止：`YYYY-MM-DD` 会自动补 ` 23:59:59`（**闭区间**）' },
  { name: 'requestId', kind: 'text', required: false, description: '请求编号' },
  { name: 'modelId', kind: 'search', required: false, description: '模型 id', lookup: MODEL_LOOKUP },
  { name: 'tenantName', kind: 'text', required: false, description: '所属企业名称' },
  { name: 'userName', kind: 'text', required: false, description: '用户名称' },
  {
    name: 'userBelong',
    kind: 'enum',
    required: false,
    description: '用户归属',
    options: [
      { label: '个人用户', value: USER_BELONG.personal },
      { label: '企业用户', value: USER_BELONG.enterprise },
    ],
  },
  {
    name: 'memberLevel',
    kind: 'enum',
    required: false,
    description: '会员等级',
    options: [
      { label: '个人用户', value: MEMBER_LEVEL.personal },
      { label: '企业用户-免费', value: MEMBER_LEVEL.enterpriseFree },
      { label: '企业用户-初级', value: MEMBER_LEVEL.enterpriseJunior },
      { label: '企业用户-中级', value: MEMBER_LEVEL.enterpriseIntermediate },
      { label: '企业用户-高级', value: MEMBER_LEVEL.enterpriseSenior },
    ],
  },
  { name: 'functionModule', kind: 'text', required: false, description: '技能（候选见 platform-usage-function-module-list）' },
  {
    name: 'callStatus',
    kind: 'enum',
    required: false,
    description: '调用状态',
    options: [
      { label: '成功', value: CALL_STATUS.success },
      { label: '限流', value: CALL_STATUS.limited },
      { label: '额度不足', value: CALL_STATUS.quotaNotEnough },
      { label: '失败', value: CALL_STATUS.failed },
    ],
  },
  {
    name: 'limitType',
    kind: 'enum',
    required: false,
    description: '限流类型',
    options: [
      { label: '限流', value: LIMIT_TYPE.flow },
      { label: '额度不足', value: LIMIT_TYPE.quota },
    ],
  },
  { name: 'quotaDeducted', kind: 'boolean', required: false, description: '是否扣减额度' },
  ...MODEL_PAGE_SUFFIX,
]

const ANALYSIS_PARAMS: ParamSpec[] = [
  { name: 'startTime', kind: 'date', required: false, description: '回复时间起 `YYYY-MM-DD`；不给就不发（页面初值 null）' },
  { name: 'endTime', kind: 'date', required: false, description: '回复时间止 `YYYY-MM-DD`；不给就不发' },
]

export const aiModelCapabilities: CapabilityDefinition[] = [
  // ---- 模型列表 -----------------------------------------------------------
  {
    id: 'ai-model-list',
    title: '查询模型列表',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: MODEL_LIST_PARAMS,
  },
  {
    id: 'ai-model-detail',
    title: '查询模型详情',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [{ name: 'id', kind: 'number', required: true, description: '模型 id（`@PathVariable`）' }],
  },
  {
    id: 'ai-model-available-list',
    title: '查询可用模型候选',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'text',
        required: false,
        description:
          '⚠️ **本地过滤用的关键字，不是服务端参数** —— 这个端点无参数、一次全量返回（模型选择页挂载时就这么拉）。' +
          '本能力刻意保留这个"长选项"入口给调用方收窄，不要在每个参数上重拉',
      },
    ],
  },
  {
    id: 'ai-model-save',
    title: '新建 / 修改模型',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: MODEL_SAVE_PARAMS,
  },
  {
    id: 'ai-model-delete',
    title: '删除模型',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: [{ name: 'id', kind: 'number', required: true, description: '模型 id（后端 `@PathVariable`）' }],
  },
  {
    id: 'ai-model-test',
    title: '测试模型连通性',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    /**
     * ⚠️ 名字里带"测试"、用的是 **POST**，但它是**只读**的：后端 `test()` 只去探一次上游、
     * 返回 `{status, message, supportedFiles}`，**不落任何库**（`availableStatus` 要等用户
     * 再点"保存"才会写进模型行）。与 `ai-interaction-sensitive-word-check` 同档。
     */
    write: false,
    params: MODEL_TEST_PARAMS,
  },
  {
    id: 'ai-model-quota-rule-list',
    title: '查询额度规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      { name: 'modelId', kind: 'number', required: true, description: '模型 id（页面必传）' },
      {
        name: 'ruleScope',
        kind: 'enum',
        required: false,
        description: '规则范围（页面三个分区各查一次，1 通用 / 2 租户 / 3 个人）',
        options: [
          { label: '通用设置', value: RULE_SCOPE.general },
          { label: '租户配置', value: RULE_SCOPE.tenant },
          { label: '个人配置', value: RULE_SCOPE.personal },
        ],
      },
      ...MODEL_PAGE_SUFFIX,
    ],
  },
  {
    id: 'ai-model-quota-rule-save',
    title: '新建 / 修改额度规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: QUOTA_RULE_PARAMS,
  },
  {
    id: 'ai-model-quota-rule-delete',
    title: '删除额度规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description: '规则 id。⚠️ 后端是 `DELETE` + **`?id=`**（`@RequestParam`），不是路径变量',
      },
    ],
  },
  {
    id: 'ai-model-flow-rule-list',
    title: '查询流速规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      { name: 'modelId', kind: 'number', required: true, description: '模型 id' },
      {
        name: 'ruleScope',
        kind: 'enum',
        required: false,
        description: '规则范围',
        options: [
          { label: '通用设置', value: RULE_SCOPE.general },
          { label: '租户配置', value: RULE_SCOPE.tenant },
          { label: '个人配置', value: RULE_SCOPE.personal },
        ],
      },
      { name: 'targetTenantId', kind: 'number', required: false, description: '目标租户 id（后端支持，页面没筛）' },
      { name: 'targetUserId', kind: 'number', required: false, description: '⚠️ 页面参数表里有、**后端 VO 里没有**这个字段（照抄透传）' },
      { name: 'enabled', kind: 'boolean', required: false, description: '是否启用（后端支持，页面没筛）' },
      ...MODEL_PAGE_SUFFIX,
    ],
  },
  {
    id: 'ai-model-flow-rule-save',
    title: '新建 / 修改流速规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: FLOW_RULE_PARAMS,
  },
  {
    id: 'ai-model-flow-rule-delete',
    title: '删除流速规则',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '规则 id。⚠️ 同样是 `DELETE` + `?id=`' },
    ],
  },
  {
    id: 'ai-model-rule-history',
    title: '查询额度 / 流速规则调整历史',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      { name: 'modelId', kind: 'number', required: true, description: '模型 id' },
      { name: 'ruleScope', kind: 'number', required: false, description: '规则范围' },
      {
        name: 'targetId',
        kind: 'number',
        required: false,
        description: '目标 id：租户=租户 id、个人=用户 id、通用=**会员等级**（`getQuotaRuleTargetId`）',
      },
      {
        name: 'configType',
        kind: 'enum',
        required: true,
        description: '1 = 额度调整历史、2 = 流速调整历史（**同一个端点靠它区分**）',
        options: [
          { label: '额度', value: HISTORY_CONFIG_TYPE.quota },
          { label: '流速', value: HISTORY_CONFIG_TYPE.flow },
        ],
      },
      ...MODEL_PAGE_SUFFIX,
    ],
  },
  {
    id: 'ai-model-apply-record-list',
    title: '查询额度提升申请记录',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: APPLY_PARAMS,
  },
  {
    id: 'ai-model-apply-pending-count',
    title: '查询待处理额度申请数量',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      {
        name: 'statisticsDimension',
        kind: 'enum',
        required: false,
        description: '统计维度。页面在这一页固定发 **3（平台）**；不传时后端默认 2（企业）',
        options: [
          { label: '个人', value: STATISTICS_DIMENSION.personal },
          { label: '企业', value: STATISTICS_DIMENSION.enterprise },
          { label: '平台', value: STATISTICS_DIMENSION.platform },
        ],
      },
    ],
  },
  {
    id: 'ai-model-apply-handle',
    title: '处理额度提升申请（忽略 / 一键填写 / 驳回）',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: true,
    params: APPLY_HANDLE_PARAMS,
  },
  {
    id: 'ai-model-search-user',
    title: '按关键字搜索用户候选（额度 / 流速的「个人配置」用）',
    pagePath: AI_MODEL_LIST_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.model.v2,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'text',
        required: true,
        description:
          '**必填关键字**（conventions 第 11 条）。页面在 `userName` 这个参数名上发它；' +
          '这个端点会把整个 query string 转发给智慧蛋鸡 admin 的 `manage/userSearch.lay`',
      },
      ...MODEL_PAGE_SUFFIX,
    ],
  },

  // ---- 模型选择 -----------------------------------------------------------
  {
    id: 'ai-model-selection-list',
    title: '查询模型选择列表',
    pagePath: AI_MODEL_SELECT_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.modelSelect.v2,
    write: false,
    params: SELECTION_LIST_PARAMS,
  },
  {
    id: 'ai-model-selection-detail',
    title: '查询模型选择详情',
    pagePath: AI_MODEL_SELECT_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.modelSelect.v2,
    write: false,
    params: [{ name: 'id', kind: 'number', required: true, description: '模型选择 id（`@PathVariable`）' }],
  },
  {
    id: 'ai-model-selection-save',
    title: '新建 / 修改模型选择',
    pagePath: AI_MODEL_SELECT_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.modelSelect.v2,
    write: true,
    params: SELECTION_SAVE_PARAMS,
  },
  {
    id: 'ai-model-selection-delete',
    title: '删除模型选择',
    pagePath: AI_MODEL_SELECT_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.modelSelect.v2,
    write: true,
    params: [{ name: 'id', kind: 'number', required: true, description: '模型选择 id（`@PathVariable`）' }],
  },

  // ---- 平台用量 -----------------------------------------------------------
  {
    id: 'platform-usage-quota-list',
    title: '查询平台额度明细',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: QUOTA_USAGE_PARAMS,
  },
  {
    id: 'platform-usage-quota-summary',
    title: '查询平台额度汇总卡片',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: QUOTA_USAGE_PARAMS.filter((param) => param.name !== 'pageNo' && param.name !== 'pageSize'),
  },
  {
    id: 'platform-usage-usage-list',
    title: '查询平台调用明细',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: USAGE_RECORD_PARAMS,
  },
  {
    id: 'platform-usage-usage-analytics',
    title: '查询平台用量分析（汇总 / 趋势 / 模型占比 / 技能排行）',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: USAGE_RECORD_PARAMS.filter((param) => param.name !== 'pageNo' && param.name !== 'pageSize'),
  },
  {
    id: 'platform-usage-usage-detail',
    title: '查询单条调用明细',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: [{ name: 'id', kind: 'number', required: true, description: '调用明细 id' }],
  },
  {
    id: 'platform-usage-function-module-list',
    title: '查询技能候选（调用明细的技能筛选）',
    pagePath: AI_PLATFORM_USAGE_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.platformUsage.v2,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'text',
        required: false,
        description:
          '⚠️ 同 `ai-model-available-list`：**本地过滤**，端点无参数、一次全量。' +
          '页面挂载时拉一次就缓存，调用方也应缓存而不是每次重拉',
      },
    ],
  },

  // ---- 数据分析 -----------------------------------------------------------
  {
    id: 'data-analysis-overview',
    title: '查询智能交互数据分析（六张图一次取回）',
    pagePath: AI_DATA_ANALYSIS_PAGE_PATH,
    permission: AI_MODEL_PERMISSIONS.dataAnalysis.v2,
    write: false,
    params: ANALYSIS_PARAMS,
  },
]

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 能力实现。四个 `request` 由 SDK 门面按页面注入，已经带好页面上下文
 * （四个页面的 `module-type` 推导结果都是**不发**，见文件头）。
 *
 * 顺序：模型列表 / 模型选择 / 平台用量 / 数据分析。
 */
export function createAiModelCapability (
  /** 模型列表（`/dashboard/platform/intelligence/interaction/model/list`） */
  requestModel: PortalRequest,
  /** 模型选择（`…/modelSelect/list`） */
  requestModelSelect: PortalRequest,
  /** 平台用量（`…/platform-usage/list`） */
  requestPlatformUsage: PortalRequest,
  /** 数据分析（`…/dataAnalysis/list`） */
  requestDataAnalysis: PortalRequest,
) {
  /**
   * 平台用量这一页**写死** `STATISTICS_DIMENSION.platform`（`platform-usage/list.vue:11`），
   * 与 perf-manage-config 里那个"页面写死的 false，调用方改不了"同一档：**不暴露成参数**。
   * 个人 / 企业那两档是别的页面（`/dashboard/model-usage/list` 等），不在本文件范围。
   */
  const PLATFORM_DIMENSION = STATISTICS_DIMENSION.platform

  /** 模型列表页的「查看申请」固定用平台维度（`list.vue:91`） */
  const applyQuery = (query: Parameters<typeof buildApplyQuery>[0] = {}): Record<string, unknown> =>
    buildApplyQuery({ ...query, statisticsDimension: PLATFORM_DIMENSION })

  /** 把响应里那六条 `GET` 全部收敛成"一路失败不拖垮其余"（与学习统计同一套语义） */
  async function settleAll<K extends string> (
    entries: ReadonlyArray<readonly [K, () => Promise<unknown>]>,
  ): Promise<Record<K, unknown> & { errors: Record<string, string> }> {
    const errors: Record<string, string> = {}
    const values = await Promise.all(
      entries.map(async ([key, run]) => {
        try {
          return [key, await run()] as const
        } catch (error) {
          errors[key] = error instanceof Error ? error.message : String(error)
          return [key, null] as const
        }
      }),
    )
    return { ...(Object.fromEntries(values) as Record<K, unknown>), errors }
  }

  // ------------------------------------------------------------------------
  // 内部实现（**刻意不用 `this`**：能力对象被解构后 `this` 就丢了，
  // 同项目其余能力文件也都不写 `this.`。公开方法是这些局部函数的一层薄壳。）
  // ------------------------------------------------------------------------

  const getModelRow = (id: number | string): Promise<AiModelRow> => {
    requireId(id, '模型 id')
    return requestModel<AiModelRow>({ url: `${AI_MODEL_PATHS.detail}/${id}`, method: 'get' })
  }

  const deleteModelRow = (id: number | string): Promise<unknown> => {
    requireId(id, '模型 id')
    return requestModel({ url: `${AI_MODEL_PATHS.remove}/${id}`, method: 'delete' })
  }

  const listModelPage = (query: AiModelPageQuery = {}): Promise<PageResult<AiModelRow>> =>
    requestModel<PageResult<AiModelRow>>({
      url: AI_MODEL_PATHS.page,
      method: 'get',
      params: buildModelListParams(query),
    })

  const getQuotaRuleRow = (id: number | string): Promise<AiTokenRow> => {
    requireId(id, '规则 id')
    return requestModel<AiTokenRow>({ url: AI_TOKEN_PATHS.quotaRuleGet, method: 'get', params: { id } })
  }

  const deleteQuotaRuleRow = (id: number | string): Promise<unknown> => {
    requireId(id, '规则 id')
    return requestModel({ url: AI_TOKEN_PATHS.quotaRuleDelete, method: 'delete', params: { id } })
  }

  const getFlowRuleRow = (id: number | string): Promise<AiTokenRow> => {
    requireId(id, '规则 id')
    return requestModel<AiTokenRow>({ url: AI_TOKEN_PATHS.flowRuleGet, method: 'get', params: { id } })
  }

  const deleteFlowRuleRow = (id: number | string): Promise<unknown> => {
    requireId(id, '规则 id')
    return requestModel({ url: AI_TOKEN_PATHS.flowRuleDelete, method: 'delete', params: { id } })
  }

  const listSelectionPage = (query: {
    callTypeList?: Array<number | string>
    pageNo?: number
    pageSize?: number
  } = {}): Promise<PageResult<AiModelSelectionRow>> =>
    requestModelSelect<PageResult<AiModelSelectionRow>>({
      url: AI_MODEL_SELECTION_PATHS.page,
      method: 'get',
      params: buildModelSelectionListParams(query),
    })

  const getSelectionRow = (id: number | string): Promise<ModelSelectionRowDetail> => {
    requireId(id, '模型选择 id')
    return requestModelSelect<ModelSelectionRowDetail>({
      url: `${AI_MODEL_SELECTION_PATHS.detail}/${id}`,
      method: 'get',
    })
  }

  const deleteSelectionRow = (id: number | string): Promise<unknown> => {
    requireId(id, '模型选择 id')
    return requestModelSelect({ url: `${AI_MODEL_SELECTION_PATHS.remove}/${id}`, method: 'delete' })
  }

  const saveSelection = (draft: ModelSelectionSaveDraft): Promise<unknown> => {
    requireId(draft.callType, '调用类型 callType')
    const isUpdate = draft.id !== undefined && draft.id !== null
    return requestModelSelect({
      url: isUpdate ? AI_MODEL_SELECTION_PATHS.update : AI_MODEL_SELECTION_PATHS.add,
      method: 'post',
      data: buildModelSelectionSavePayload(draft),
    })
  }

  /**
   * 「一键填写」那条链路的共同提醒（见 `buildQuotaRuleFromApplyPayload` 的说明）：
   * 个人档发的是 `targetUserId`，而后端两个 SaveReqVO 里**没有这个字段**。
   * 租户档（`targetTenantId`）没有这个问题，所以只在个人档提示。
   */
  const fillApplyWarnings = (payload: Record<string, unknown>): string[] => {
    if (payload.targetUserId === undefined || payload.targetUserId === null) return []
    return [
      '这条规则的落点发的是 `targetUserId`，而后端 SaveReqVO 里**没有这个字段**' +
        '（个人规则按 `targetUserPhone` + `targetTenantId` 命中，见 AiTokenManagementServiceImpl:1524）。' +
        'Jackson 会把它当未知字段丢掉 ⇒ 规则可能认不到人。要确保落到人，请改用 saveQuotaRule / saveFlowRule ' +
        '（那条链路发的是 `targetUserPhone`）。本条**照抄页面**，不做本地改写。',
    ]
  }

  const handleApplyStatus = (
    apply: { id: number | string },
    status: number,
    options: { rejectReason?: string } = {},
  ): Promise<unknown> => {
    requireId(apply?.id, '申请 id')
    requireId(status, '处理状态 status')
    return requestModel({
      url: AI_TOKEN_PATHS.applyHandle,
      method: 'post',
      data: buildApplyHandlePayload({
        id: apply.id,
        status,
        statisticsDimension: PLATFORM_DIMENSION,
        rejectReason: options.rejectReason,
      }),
    })
  }

  return {
    // ------------------------------------------------------------------
    // 模型列表
    // ------------------------------------------------------------------

    /**
     * 分页查询模型列表。只读。
     *
     * ⚠️ `order` / `orderField` **照发**（页面走的是 `useListPageModule` 的 `logicFetch`，
     * 这两个是它拼上去的默认参数），而 `modelName` 初值是 `null` ⇒ **不给就不发**。
     */
    async listModels (query: AiModelPageQuery = {}): Promise<PageResult<AiModelRow>> {
      return listModelPage(query)
    },

    /** 单条模型详情。只读。`apiKey` 只回 **masked**（`apiKeyMasked`），拿不到明文 */
    async getModel (id: number | string): Promise<AiModelRow> {
      return getModelRow(id)
    },

    /**
     * 可用模型候选（**一次全量**，无服务端参数）。
     *
     * 页面在模型选择页挂载时就整份拉走灌进下拉；无头侧保留 `keyword` 做本地收窄，
     * 但**它不减少请求量** —— 需要"按关键字向服务端收窄"的候选请用 `ai-model-list`。
     */
    async listAvailableModels (query: { keyword?: string } = {}): Promise<AiModelRow[]> {
      const list = await requestModel<AiModelRow[]>({
        url: AI_MODEL_PATHS.availableList,
        method: 'get',
      })
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') return list ?? []
      return (list ?? []).filter((row) =>
        String(row.modelName ?? '').toLowerCase().includes(keyword),
      )
    },

    /**
     * **写链路的只读前置**：读出当前行（修改时）+ 装配 body（conventions 第 13 条）。
     *
     * 页面自己的"前置读"就在这条链上：编辑态先 `GET /manager/aiModelConfig/get/{id}`
     * 把整行灌进表单（`useFormPageModule.customLoad`），保存时再 `pick` 出八个键。
     *
     * 返回里带两样调用方需要的东西：
     * - `mode`：新建还是修改（决定 `saveModel` 打 add 还是 update）
     * - `current`：**修改前**的那一行 —— `cancelSavedModel` 靠它回滚
     *
     * ⚠️ `warnings` 里的第一条是后端 `add` 的硬校验（`apiUrl` 必须以 `/chat/completions`
     * 结尾），**刻意不在这里硬拦**：它带着"兼容模式"的措辞，是否对所有模型成立没有实测。
     */
    async prepareSaveModel (draft: AiModelSaveDraft): Promise<{
      mode: 'create' | 'update'
      payload: Record<string, unknown>
      current: AiModelRow | null
      warnings: string[]
    }> {
      assertModelDraft(draft)
      const isUpdate = draft.id !== undefined && draft.id !== null
      const current = isUpdate ? await getModelRow(draft.id as number | string) : null
      const warnings: string[] = []
      if (!isUpdate && !String(draft.apiUrl ?? '').trim().endsWith('/chat/completions')) {
        warnings.push(
          'apiUrl 不以 "/chat/completions" 结尾 —— 后端 add 会返回 400「兼容模式下，' +
            'apiUrl需以"/chat/completions"结尾」（AiModelConfigController:89）。本能力不硬拦，请自行确认。',
        )
      }
      if (isUpdate && draft.dropApiKey) {
        warnings.push(
          'dropApiKey=true ⇒ body 里**没有** apiKey。这是页面的行为（编辑态不重输就不发），' +
            '后端 update 不做 isBlank 校验，所以合法；但要清楚"这次不会改 apiKey"。',
        )
      }
      return {
        mode: isUpdate ? 'update' : 'create',
        payload: buildModelSavePayload(draft),
        current,
        warnings,
      }
    },

    /**
     * **真写**：新建或修改模型。
     *
     * ⚠️ 后端零幂等（conventions 第 14 条）：重发一次就是两行（新建时；
     * 且 `add` 不返回新 id，`cancelCreatedModel` 得按名字回查）。
     * 撤销见 `cancelCreatedModel` / `restoreModel`。
     */
    async saveModel (draft: AiModelSaveDraft): Promise<unknown> {
      assertModelDraft(draft)
      const isUpdate = draft.id !== undefined && draft.id !== null
      return requestModel({
        url: isUpdate ? AI_MODEL_PATHS.update : AI_MODEL_PATHS.add,
        method: 'post',
        data: buildModelSavePayload(draft),
      })
    },

    /**
     * **撤销"新建模型"**：`add` 只回 `null`（后端 `success(null,"新建成功")`），
     * 所以按**模型名称**回查新行再删。
     *
     * ⚠️ 同名模型有多个时**直接拒绝**（不猜哪一条是刚建的）—— 报错里给出全部候选 id，
     * 由调用方用 `deleteModel(id)` 自己决定。
     */
    async cancelCreatedModel (modelName: string): Promise<unknown> {
      requireNonEmptyString(modelName, '模型名称 modelName')
      const page = await listModelPage({ modelName, pageNo: 1, pageSize: DEFAULT_PAGE_SIZE })
      const hits = (page?.list ?? []).filter((row) => row.modelName === modelName)
      if (hits.length === 0) {
        throw new Error(
          `按名字回查不到刚建的模型「${modelName}」—— 可能已经被别处删掉，或者名称被后端改写过。` +
            '不要盲目再建一个；先 listModels 核对。',
        )
      }
      if (hits.length > 1) {
        throw new Error(
          `有 ${hits.length} 个模型都叫「${modelName}」（id=${hits.map((row) => row.id).join(', ')}）。` +
            '本能力不猜哪一条是刚建的：请自己挑 id 调 deleteModel(id)。',
        )
      }
      return deleteModelRow(hits[0]?.id as number | string)
    },

    /**
     * **撤销"修改模型"**：用 `prepareSaveModel` 读到的旧行再 `update` 一次。
     *
     * ⚠️ **apiKey 回不去** —— 详情接口只回 `apiKeyMasked`（后端 `AiModelConfigDTO.apiKeyMasked`），
     * 明文拿不到。所以：
     * - 若原行的 `apiKey` 你手上还有（比如是你自己刚设的），传 `apiKey` 就能完整回滚；
     * - 否则传 `dropApiKey: true`，**只回滚除 apiKey 以外的字段**，并在返回里告诉你这一点。
     */
    async restoreModel (
      previous: AiModelRow,
      options: { apiKey?: string } = {},
    ): Promise<unknown> {
      const id = requireId(previous.id, '模型 id')
      const hasApiKey = typeof options.apiKey === 'string' && options.apiKey.trim() !== ''
      return requestModel({
        url: AI_MODEL_PATHS.update,
        method: 'post',
        data: buildModelSavePayload({
          id,
          modelName: String(previous.modelName ?? ''),
          description: String(previous.description ?? ''),
          apiUrl: String(previous.apiUrl ?? ''),
          apiKey: hasApiKey ? options.apiKey : '',
          temperature: (previous.temperature as number | null) ?? null,
          timeout: (previous.timeout as number | null) ?? null,
          maxToken: (previous.maxToken as number | null) ?? null,
          dropApiKey: !hasApiKey,
        }),
      })
    },

    /**
     * **真写**：删除模型。⚠️ **撤不掉**（删了就没了），而这是本文件里唯一没有
     * `cancel*` 的写操作 —— 不要拿真模型试。
     *
     * 后端还有一道闸：`isConfigSelected(id)` 为真时直接拒
     * （"当前配置已经被选择，请勿删除"），即**被"模型选择"引用的模型删不掉**。
     */
    async deleteModel (id: number | string): Promise<unknown> {
      return deleteModelRow(id)
    },

    /**
     * **连通性测试**（POST，但**只读**：后端只探上游、不落库）。
     *
     * ⚠️ **两个调用点的键序不同**，所以是两个方法而不是一个带开关的：
     * - 本方法 = 列表页的「测试」按钮：`{id, modelName, apiUrl, apiKey}`（**id 在最前**）
     * - `testModelConnectivityFromForm` = 编辑页的「测试」按钮：`{modelName, apiUrl, apiKey}`，
     *   有 id 时**追加在最后**
     *
     * 返回 `{status, message, supportedFiles}`（后端 `Map<String,Object>`）；
     * `status` 就是 `availableStatus` 的取值（1 正常 / 2 异常）。
     */
    async testModelConnectivity (row: {
      id?: number | string
      modelName: string
      apiUrl: string
      apiKey?: string
    }): Promise<Record<string, unknown>> {
      requireNonEmptyString(row.modelName, '模型名称 modelName')
      requireNonEmptyString(row.apiUrl, 'API apiUrl')
      return requestModel<Record<string, unknown>>({
        url: AI_MODEL_PATHS.test,
        method: 'post',
        data: buildModelTestBodyFromRow(row),
      })
    },

    /** 见 `testModelConnectivity`（编辑页那一支，id 在最后） */
    async testModelConnectivityFromForm (form: {
      id?: number | string | null
      modelName: string
      apiUrl: string
      apiKey?: string
    }): Promise<Record<string, unknown>> {
      requireNonEmptyString(form.modelName, '模型名称 modelName')
      requireNonEmptyString(form.apiUrl, 'API apiUrl')
      return requestModel<Record<string, unknown>>({
        url: AI_MODEL_PATHS.test,
        method: 'post',
        data: buildModelTestBodyFromForm(form),
      })
    },

    /** 分页查询额度规则（三个分区各一次：通用 / 租户 / 个人）。只读 */
    async listQuotaRules (query: {
      modelId: number | string
      ruleScope?: number
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<AiTokenRow>> {
      requireId(query.modelId, '模型 id modelId')
      return requestModel<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.quotaRulePage,
        method: 'get',
        params: buildQuotaRuleQuery({
          ...query,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }),
      })
    },

    /**
     * **额度规则的只读前置**：编辑时页面先 `quota-rule/get?id=` 回显整条
     * （`useQuotaManagementModals.js:21`），再装配 body。
     *
     * 新建时 `current` 为 `null`；修改时它是**改之前**的那条，`cancelSavedQuotaRule` 靠它回滚。
     */
    async prepareSaveQuotaRule (draft: QuotaRuleSaveDraft): Promise<{
      mode: 'create' | 'update'
      payload: Record<string, unknown>
      current: AiTokenRow | null
    }> {
      assertRuleDraft(draft)
      requirePositiveNumber(draft.totalQuota, 'Token 总额度 totalQuota')
      const isUpdate = draft.id !== undefined && draft.id !== null
      const current = isUpdate ? await getQuotaRuleRow(draft.id as number | string) : null
      return {
        mode: isUpdate ? 'update' : 'create',
        payload: buildQuotaRuleSavePayload(draft),
        current,
      }
    },

    /**
     * **真写**：新建 / 修改额度规则。
     *
     * ⚠️ 后端 `AiTokenQuotaRuleController` 的 update 是 **POST**（不是 PUT，与流速规则不同）。
     * `create` 返回**新 id**（后端 `CommonResult<Long>`）⇒ `cancelCreatedQuotaRule(id)` 直接删。
     */
    async saveQuotaRule (draft: QuotaRuleSaveDraft): Promise<unknown> {
      assertRuleDraft(draft)
      requirePositiveNumber(draft.totalQuota, 'Token 总额度 totalQuota')
      const isUpdate = draft.id !== undefined && draft.id !== null
      return requestModel({
        url: isUpdate ? AI_TOKEN_PATHS.quotaRuleUpdate : AI_TOKEN_PATHS.quotaRuleCreate,
        method: 'post',
        data: buildQuotaRuleSavePayload(draft),
      })
    },

    /** 单条额度规则（`?id=`）。只读。**撤销修改**要靠它读到的整条 */
    async getQuotaRule (id: number | string): Promise<AiTokenRow> {
      return getQuotaRuleRow(id)
    },

    /**
     * **撤销"新建额度规则"**：`create` 已经把新 id 给你了（`saveQuotaRule` 的返回值，
     * 包络拆开后就是那个 Long）。直接把 id 传进来删。
     */
    async cancelCreatedQuotaRule (id: number | string): Promise<unknown> {
      return deleteQuotaRuleRow(id)
    },

    /**
     * **撤销"修改额度规则"**：用 `prepareSaveQuotaRule` 读到的旧行再 update 一次。
     *
     * `get/{id}` 回的是完整 `AiTokenQuotaRuleRespVO`，所以这条**可逆**（与模型那条不同）。
     */
    async restoreQuotaRule (previous: AiTokenRow): Promise<unknown> {
      const id = requireId(previous.id, '规则 id')
      return requestModel({
        url: AI_TOKEN_PATHS.quotaRuleUpdate,
        method: 'post',
        data: buildQuotaRuleSavePayload(previous as unknown as QuotaRuleSaveDraft & { id: number | string }),
      })
    },

    /** **真写**：删除额度规则（`DELETE` + **`?id=`**）。⚠️ 撤不掉 */
    async deleteQuotaRule (id: number | string): Promise<unknown> {
      return deleteQuotaRuleRow(id)
    },

    /** 分页查询流速规则。只读 */
    async listFlowRules (query: {
      modelId: number | string
      ruleScope?: number
      targetTenantId?: number | string
      targetUserId?: number | string
      enabled?: boolean
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<AiTokenRow>> {
      requireId(query.modelId, '模型 id modelId')
      return requestModel<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.flowRulePage,
        method: 'get',
        params: buildFlowRuleQuery({
          ...query,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }),
      })
    },

    /** 流速规则的只读前置（同 `prepareSaveQuotaRule`） */
    async prepareSaveFlowRule (draft: FlowRuleSaveDraft): Promise<{
      mode: 'create' | 'update'
      payload: Record<string, unknown>
      current: AiTokenRow | null
    }> {
      assertRuleDraft(draft)
      requirePositiveNumber(draft.tokenLimitPerMinute, '每分钟 Token 上限 tokenLimitPerMinute')
      requirePositiveNumber(draft.maxTokenPerRequest, '单次最大 Token maxTokenPerRequest')
      const isUpdate = draft.id !== undefined && draft.id !== null
      const current = isUpdate ? await getFlowRuleRow(draft.id as number | string) : null
      return {
        mode: isUpdate ? 'update' : 'create',
        payload: buildFlowRuleSavePayload(draft),
        current,
      }
    },

    /**
     * **真写**：新建 / 修改流速规则。
     *
     * ⚠️ 这里的 update 是 **PUT**（后端 `@PutMapping`），与额度规则的 POST **不同** ——
     * 这是前后端都一致的一处非对称，别"顺手统一"。
     */
    async saveFlowRule (draft: FlowRuleSaveDraft): Promise<unknown> {
      assertRuleDraft(draft)
      requirePositiveNumber(draft.tokenLimitPerMinute, '每分钟 Token 上限 tokenLimitPerMinute')
      requirePositiveNumber(draft.maxTokenPerRequest, '单次最大 Token maxTokenPerRequest')
      const isUpdate = draft.id !== undefined && draft.id !== null
      return requestModel({
        url: isUpdate ? AI_TOKEN_PATHS.flowRuleUpdate : AI_TOKEN_PATHS.flowRuleCreate,
        method: isUpdate ? 'put' : 'post',
        data: buildFlowRuleSavePayload(draft),
      })
    },

    /** 单条流速规则（`?id=`）。只读 */
    async getFlowRule (id: number | string): Promise<AiTokenRow> {
      return getFlowRuleRow(id)
    },

    /** **撤销"新建流速规则"**：`create` 回的就是新 id */
    async cancelCreatedFlowRule (id: number | string): Promise<unknown> {
      return deleteFlowRuleRow(id)
    },

    /** **撤销"修改流速规则"**：用旧行再 PUT 一次（`get/{id}` 回完整 RespVO，可逆） */
    async restoreFlowRule (previous: AiTokenRow): Promise<unknown> {
      const id = requireId(previous.id, '规则 id')
      return requestModel({
        url: AI_TOKEN_PATHS.flowRuleUpdate,
        method: 'put',
        data: buildFlowRuleSavePayload(previous as unknown as FlowRuleSaveDraft & { id: number | string }),
      })
    },

    /** **真写**：删除流速规则（`DELETE` + `?id=`）。⚠️ 撤不掉 */
    async deleteFlowRule (id: number | string): Promise<unknown> {
      return deleteFlowRuleRow(id)
    },

    /** 规则调整历史（额度/流速同一个端点，`configType` 区分）。只读 */
    async listRuleHistory (query: {
      modelId: number | string
      ruleScope?: number
      targetId?: number | string
      configType: number
      pageNo?: number
      pageSize?: number
    }): Promise<PageResult<AiTokenRow>> {
      requireId(query.modelId, '模型 id modelId')
      requireId(query.configType, 'configType')
      return requestModel<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.historyPage,
        method: 'get',
        params: buildRuleHistoryQuery({
          ...query,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }),
      })
    },

    /**
     * 额度提升申请记录。只读。
     *
     * `statisticsDimension` **固定 3（平台）** —— 与页面上那个「查看申请」按钮一致
     * （`list.vue:91` 的 `PLATFORM_STATISTICS_DIMENSION`）。
     *
     * ⚠️ 后端这条要 `ai-token:apply:query` 权限，没权限会 403。
     */
    async listApplyRecords (query: {
      status?: number
      userName?: string
      modelId?: number | string
      startDate?: string
      endDate?: string
      pageNo?: number
      pageSize?: number
    } = {}): Promise<PageResult<AiTokenRow>> {
      return requestModel<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.applyPage,
        method: 'get',
        params: applyQuery({
          ...query,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }),
      })
    },

    /** 待处理申请数量（那个角标）。只读。返回一个数字 */
    async getPendingApplyCount (): Promise<number> {
      return requestModel<number>({
        url: AI_TOKEN_PATHS.applyPendingCount,
        method: 'get',
        params: { statisticsDimension: PLATFORM_DIMENSION },
      })
    },

    /**
     * **申请处理的只读前置**：页面不需要额外请求 —— 它手里的 `apply` 行
     * （从 `apply/page` 拿到的，**自带 `status` 字段**）就是"旧状态"。
     *
     * 所以这里是**纯函数式的 prepare**：把"要写什么"摆出来，不额外打后端
     * （与 `ai-interaction-qa` 的 `prepareCreateHotQuestion` 同档，理由一样：
     * 后端没有"提交前先问一次"的只读端点，**不硬造一个假的**）。
     *
     * ⚠️ 撤销要用的 `previousStatus` 必须**由调用方从那一行上取** ——
     * 本方法不替你读，因为它读不到比"你手上那一行"更新的状态。
     */
    prepareHandleApply (
      apply: { id: number | string; status?: number },
      status: number,
      options: { rejectReason?: string } = {},
    ): { payload: Record<string, unknown>; previousStatus: number | undefined } {
      requireId(apply?.id, '申请 id')
      requireId(status, '处理状态 status')
      return {
        payload: buildApplyHandlePayload({
          id: apply.id,
          status,
          statisticsDimension: PLATFORM_DIMENSION,
          rejectReason: options.rejectReason,
        }),
        previousStatus: apply.status,
      }
    },

    /**
     * **真写**：处理额度提升申请（忽略 / 一键填写 / 驳回）。
     *
     * ⚠️ 三处要当心：
     * 1. **状态码前后端对不上**（文件头那一节）—— 页面用 1/2，后端枚举只有 0/3/4。
     * 2. 后端这条要 `ai-token:apply:handle` 权限。
     * 3. **零幂等**：重发一次就是"又处理了一次"，而且**它不会顺手撤销**上一步
     *    由"一键填写"新建出来的那条规则（那条要另外删）。
     */
    async handleApply (
      apply: { id: number | string },
      status: number,
      options: { rejectReason?: string } = {},
    ): Promise<unknown> {
      return handleApplyStatus(apply, status, options)
    },

    /**
     * **撤销"处理申请"**：用 `prepareHandleApply` 给你的 `previousStatus` 再 handle 一次
     * （把申请退回原状态）。
     *
     * ⚠️ 它只回滚**申请行本身**。如果上一步是"一键填写"，那条被新建出来的
     * 额度/流速规则还在 —— 要一起清掉请再调 `deleteQuotaRule` / `deleteFlowRule`。
     */
    async cancelHandledApply (applyId: number | string, previousStatus: number): Promise<unknown> {
      requireId(previousStatus, 'previousStatus')
      return handleApplyStatus({ id: applyId }, previousStatus)
    },

    /**
     * **一键填写**：把申请里"期望值"落成一条规则，再把申请标成已填写。
     *
     * 这是**两步真写**，页面的顺序是 `createQuotaRule(payload)` → `handleApplyStatus({id, status:2})`
     * （`useApplyModals.js:100-101`）。能力保持同样的顺序与语义，并把中间产物一起返回，
     * 好让调用方能一步撤干净。
     */
    async fillApplyWithQuotaRule (input: {
      apply: {
        id: number | string
        status?: number
        modelId: number | string
        tenantId?: number | string
        tenantName?: string
        userId?: number | string
        userName?: string
        expectedMonthlyQuota?: number | string
        reason?: string
      }
      form?: {
        totalQuota?: number | string
        resetCycle?: number
        shortageStrategy?: number
        startTime?: string
        endTime?: string
        reason?: string
      }
      /** 跳过"把申请标成已填写"这一步（只想建规则时用） */
      skipApplyStatus?: boolean
    }): Promise<{ createdRuleId: unknown; applyHandled: unknown; warnings: string[] }> {
      const payload = buildQuotaRuleFromApplyPayload({
        modelId: input.apply.modelId,
        apply: input.apply,
        form: input.form,
      })
      const createdRuleId = await requestModel({
        url: AI_TOKEN_PATHS.quotaRuleCreate,
        method: 'post',
        data: payload,
      })
      const applyHandled = input.skipApplyStatus
        ? null
        : await handleApplyStatus({ id: input.apply.id }, APPLY_STATUS.filled)
      return { createdRuleId, applyHandled, warnings: fillApplyWarnings(payload) }
    },

    /** 同 `fillApplyWithQuotaRule`，落的是**流速**规则（`buildFlowRuleFromApplyPayload`） */
    async fillApplyWithFlowRule (input: {
      apply: {
        id: number | string
        status?: number
        modelId: number | string
        tenantId?: number | string
        tenantName?: string
        userId?: number | string
        userName?: string
        expectedMaxToken?: number | string
        reason?: string
      }
      form?: {
        tokenLimitPerMinute?: number | string
        maxTokenPerRequest?: number | string
        exceedStrategy?: number
        startTime?: string
        endTime?: string
        reason?: string
      }
      skipApplyStatus?: boolean
    }): Promise<{ createdRuleId: unknown; applyHandled: unknown; warnings: string[] }> {
      const payload = buildFlowRuleFromApplyPayload({
        modelId: input.apply.modelId,
        apply: input.apply,
        form: input.form,
      })
      const createdRuleId = await requestModel({
        url: AI_TOKEN_PATHS.flowRuleCreate,
        method: 'post',
        data: payload,
      })
      const applyHandled = input.skipApplyStatus
        ? null
        : await handleApplyStatus({ id: input.apply.id }, APPLY_STATUS.filled)
      return { createdRuleId, applyHandled, warnings: fillApplyWarnings(payload) }
    },

    /**
     * 按关键字搜人员候选（额度/流速的「个人配置」目标人）。
     *
     * ⚠️ **必填关键字**（conventions 第 11 条）：这个端点的上游是一次"跨系统查询"，
     * 无关键字地拉全量会冲掉调用方上下文。参数名是页面的 `userName`。
     */
    async searchUsers (query: { keyword: string; pageNo?: number; pageSize?: number }): Promise<PageResult<AiTokenRow>> {
      const keyword = requireNonEmptyString(query?.keyword, '关键字 keyword')
      return requestModel<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.userSearch,
        method: 'get',
        // 键序照抄页面：`{ userName, pageNo, pageSize }`
        params: {
          userName: keyword,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? TOKEN_CANDIDATE_PAGE_SIZE,
        },
      })
    },

    // ------------------------------------------------------------------
    // 模型选择
    // ------------------------------------------------------------------

    /** 分页查询模型选择列表。只读。`callTypeList` 空数组 ⇒ **整项不发** */
    async listModelSelections (query: {
      callTypeList?: Array<number | string>
      pageNo?: number
      pageSize?: number
    } = {}): Promise<PageResult<AiModelSelectionRow>> {
      return listSelectionPage(query)
    },

    /** 单条模型选择详情。只读。返回里会带 `details` / `skillIdList` / `modelIdList` 等 */
    async getModelSelection (id: number | string): Promise<ModelSelectionRowDetail> {
      return getSelectionRow(id)
    },

    /**
     * **只读前置**：修改时先把详情读回来（页面 `customLoad` 就是这么做的），
     * 并把它折成草稿需要的两组字段。
     *
     * ⚠️ 页面的 `getDetailFieldsFromData()` 有一套不短的折算逻辑（`details` 优先、
     * 空则退到 `modelIdList` 等四个平铺字段、再按 `callType` 过滤、`defaultSingle`
     * 的档还要从备选里剔掉默认模型）。**本能力不照抄那套 UI 折算**：它服务的是
     * "表单里两个多选框互斥显示"，无头侧没有这个约束。这里只把原始行交给调用方，
     * 要不要拆由调用方决定 —— 折算逻辑一旦照抄就会变成"只能按页面的 UI 走"。
     */
    async prepareSaveModelSelection (draft: ModelSelectionSaveDraft): Promise<{
      mode: 'create' | 'update'
      payload: Record<string, unknown>
      current: ModelSelectionRowDetail | null
      warnings: string[]
    }> {
      requireId(draft.callType, '调用类型 callType')
      const isUpdate = draft.id !== undefined && draft.id !== null
      const current = isUpdate ? await getSelectionRow(draft.id as number | string) : null
      const payload = buildModelSelectionSavePayload(draft)
      const warnings: string[] = []
      if (Number(draft.callType) === CALL_TYPE.web && String(payload.skillIds ?? '').trim() === '') {
        warnings.push(
          'callType=2（Web对话）时后端要求 skillIds **非空**（AiModelSelectionController:86），' +
            '空串会被 400 拒。本能力不硬拦，因为页面上这条是可选字段、真机行为未验证。',
        )
      }
      return { mode: isUpdate ? 'update' : 'create', payload, current, warnings }
    },

    /**
     * **真写**：新建 / 修改模型选择。
     *
     * ⚠️ 新建时后端会查重：**同一 `callType` 只能有一条**，重复创建报 500
     * 「已有同调用类型，请勿重复创建」。**修改时不做这个查重**。
     * 成功后会清一次模型选择缓存（后端 `kbChatController.clearModelSelectionCache()`）。
     */
    async saveModelSelection (draft: ModelSelectionSaveDraft): Promise<unknown> {
      return saveSelection(draft)
    },

    /**
     * **撤销"新建模型选择"**：`add` **不返回新 id**（后端 `success(null,"新建成功")`），
     * 所以按 `callType` 回查 —— 好在 `callType` 后端保证唯一，
     * 这比模型那条（按可能重名的 modelName 回查）**可靠得多**。
     */
    async cancelCreatedModelSelection (callType: number): Promise<unknown> {
      requireId(callType, '调用类型 callType')
      const page = await listSelectionPage({ callTypeList: [Number(callType)], pageNo: 1, pageSize: DEFAULT_PAGE_SIZE })
      const hits = (page?.list ?? []).filter((row) => Number(row.callType) === Number(callType))
      if (hits.length !== 1) {
        throw new Error(
          `callType=${callType} 回查到的条数是 ${hits.length}（后端本该保证唯一）——` +
            '不猜哪一条是刚建的，请先 listModelSelections 核对，再用 deleteModelSelection(id) 处理。',
        )
      }
      return deleteSelectionRow(hits[0]?.id as number | string)
    },

    /**
     * **撤销"修改模型选择"**：用 `prepareSaveModelSelection` 读到的旧行再 update 一次。
     *
     * ⚠️ 这里要调用方把旧行**折回草稿形状**（`callType` + `details` + `skillIds`），
     * 因为详情行的 `details`/`skillIdList` 与提交 body 的形状不一样（见
     * `prepareSaveModelSelection` 的说明：本能力刻意不照抄那套 UI 折算）。
     */
    async restoreModelSelection (previous: ModelSelectionSaveDraft): Promise<unknown> {
      requireId(previous.id, '模型选择 id')
      return saveSelection(previous)
    },

    /** **真写**：删除模型选择（`DELETE /delete/{id}`，`@PathVariable`）。⚠️ 撤不掉 */
    async deleteModelSelection (id: number | string): Promise<unknown> {
      return deleteSelectionRow(id)
    },

    // ------------------------------------------------------------------
    // 平台用量
    // ------------------------------------------------------------------

    /** 平台额度明细（额度 Tab 的表格）。只读。`statisticsDimension` 固定 3 */
    async listPlatformQuota (query: QuotaUsageQuery = {}): Promise<PageResult<AiTokenRow>> {
      return requestPlatformUsage<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.quotaUsagePage,
        method: 'get',
        params: buildQuotaUsageQuery({
          ...query,
          // 页面的 form 初值就是 `QUOTA_CYCLE.month`，分页来自列表模块（styleV2 → 20）
          quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.month,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }, PLATFORM_DIMENSION),
      })
    },

    /**
     * 平台额度汇总卡片（周期总额度 / 已用 / 剩余）。只读。
     *
     * ⚠️ 与明细**共用同一份参数构造器**，但**不带分页**（页面就是
     * `buildQuotaQuery({...rrList.formState, statisticsDimension})`，formState 里没有分页键）。
     */
    async getPlatformQuotaSummary (query: QuotaUsageQuery = {}): Promise<Record<string, unknown>> {
      const { pageNo: _pageNo, pageSize: _pageSize, ...rest } = query
      return requestPlatformUsage<Record<string, unknown>>({
        url: AI_TOKEN_PATHS.quotaUsageSummary,
        method: 'get',
        params: buildQuotaUsageQuery({ ...rest, quotaCycle: rest.quotaCycle ?? QUOTA_CYCLE.month }, PLATFORM_DIMENSION),
      })
    },

    /** 平台调用明细（用量 Tab 的表格）。只读 */
    async listPlatformUsageRecords (query: UsageRecordQuery = {}): Promise<PageResult<AiTokenRow>> {
      return requestPlatformUsage<PageResult<AiTokenRow>>({
        url: AI_TOKEN_PATHS.usagePage,
        method: 'get',
        params: buildUsageRecordQuery({
          ...query,
          // ⚠️ 明细 Tab 的初值是 **周（2）**，与额度 Tab 的月（3）**不同**
          quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.week,
          timeRangeType: query.timeRangeType ?? TIME_RANGE.thisMonth,
          pageNo: query.pageNo ?? 1,
          pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
        }, PLATFORM_DIMENSION),
      })
    },

    /**
     * **用量 Tab 的四张图**：汇总、趋势、模型占比、技能排行。
     *
     * 页面的写法是 `Promise.all([…])` 且**每个 fetcher 自己 try/catch 把失败吞成空值**
     * （`useUsageAnalytics.js:171-207`），所以一路挂了不影响其余 —— 本能力保持同样的语义
     * （与 `study-statistics` 的 `learningSummary` 同一套 `errors` 约定），
     * 但**把失败如实报出来**而不是静默吞掉。
     *
     * ⚠️ 页面只在**没有模型上下文**（`hasModelContext === false`）时才发趋势/占比/排行这三条；
     * 从「模型列表 → 用量明细」带着 `modelId` 进来时只发汇总 + 明细。
     * 本能力**不替调用方做这个判断**：给了 `modelId` 就照给（后端接受），
     * 只在自己知道"这一档没有模型上下文"时用 `includeBreakdowns: false` 省掉三条。
     */
    async platformUsageAnalytics (
      query: UsageRecordQuery = {},
      options: { includeBreakdowns?: boolean } = {},
    ): Promise<{
      summary: unknown
      trend: unknown
      modelRatio: unknown
      moduleRanking: unknown
      errors: Record<string, string>
    }> {
      // ⚠️ 四条用的是**同一份参数**（含 `modelId`）：页面的 `fetchUsageSummaryData` /
      // `fetchUsageRankingData` 打的是 `buildUsageQuery({...formState, statisticsDimension})`，
      // 而 `formState` 里就有 `modelId` —— 所以汇总与排行也带它，不要按"只有趋势才要模型"去裁。
      const params = buildUsageSummaryQuery({
        ...query,
        quotaCycle: query.quotaCycle ?? QUOTA_CYCLE.week,
        timeRangeType: query.timeRangeType ?? TIME_RANGE.thisMonth,
      }, PLATFORM_DIMENSION)
      const includeBreakdowns = options.includeBreakdowns !== false
      const entries: Array<readonly [string, () => Promise<unknown>]> = [
        ['summary', () => requestPlatformUsage({ url: AI_TOKEN_PATHS.usageSummary, method: 'get', params })],
      ]
      if (includeBreakdowns) {
        entries.push(
          ['trend', () => requestPlatformUsage({ url: AI_TOKEN_PATHS.usageTrend, method: 'get', params })],
          ['modelRatio', () => requestPlatformUsage({ url: AI_TOKEN_PATHS.usageModelRatio, method: 'get', params })],
          ['moduleRanking', () => requestPlatformUsage({ url: AI_TOKEN_PATHS.usageModuleRanking, method: 'get', params })],
        )
      }
      const settled = await settleAll(entries as ReadonlyArray<readonly [string, () => Promise<unknown>]>)
      return {
        summary: settled.summary ?? null,
        trend: settled.trend ?? null,
        modelRatio: settled.modelRatio ?? null,
        moduleRanking: settled.moduleRanking ?? null,
        errors: settled.errors,
      }
    },

    /** 单条调用明细（「查看详情」弹窗）。只读 */
    async getPlatformUsageDetail (id: number | string): Promise<Record<string, unknown>> {
      requireId(id, '调用明细 id')
      return requestPlatformUsage<Record<string, unknown>>({
        url: AI_TOKEN_PATHS.usageDetail,
        method: 'get',
        params: { id },
      })
    },

    /**
     * 技能候选（调用明细的技能筛选）。只读。
     *
     * ⚠️ 端点**无参数、一次全量**；页面挂载时拉一次就缓存。`keyword` 是**本地过滤**，
     * 只帮调用方收窄结果，不会减少请求量。
     */
    async listFunctionModules (query: { keyword?: string } = {}): Promise<unknown[]> {
      const list = await requestPlatformUsage<unknown[]>({
        url: AI_TOKEN_PATHS.functionModuleList,
        method: 'get',
      })
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') return list ?? []
      return (list ?? []).filter((item) => {
        const label = typeof item === 'string' ? item : String((item as { name?: string })?.name ?? '')
        return label.toLowerCase().includes(keyword)
      })
    },

    // ------------------------------------------------------------------
    // 数据分析
    // ------------------------------------------------------------------

    /**
     * 数据分析页那六张图，**一次并发取回**。
     *
     * ⚠️ 页面的聚合语义**不是** `Promise.allSettled`，而且两种情况还不一样：
     * - **挂载**：五个 `getXxx()` 各自 fire-and-forget 并发跑（`list.vue:161/179/194/210/227`），
     *   第六个（关键词热词）在 `word-cloud.vue` 自己发起 —— 六个互不等待，谁也不 catch，
     *   失败的只会变成一条未处理的 rejection。
     * - **点「搜索」**：`handleSearch()` **顺序 await** 五个，**没有 try/catch**
     *   （`list.vue:124-137`）—— 前面一挂后面就不再发。
     *
     * 本能力**刻意**用"并发 + 各自 settle + `errors`"这一档（与
     * `study-statistics.learningSummary` 同一套约定）：一次统计查询挂掉不应该让 AI 静默地
     * 少给五张图。这是**有意的偏差**，不是照抄，理由写在这里。
     *
     * 返回的六项与页面的对应关系：
     * - `answerRightRate` → 交互成功率（饼图；页面用 `rightRate`/`wrongRate` × 100 画，能力给原始行）
     * - `statsByTime` → 各时段提问次数（折线）
     * - `knowledgeRecordRank` → 知识库文档调用次数排行（列表，页面直接当数组渲染）
     * - `aiToolRecordRank` → AI 工具调用次数排行（柱状）
     * - `aiToolClickRank` → AI 工具点击次数排行（柱状）
     * - `questionKeywordHeat` → 提问关键词热词（词云；`{keyword, heat}[]`）
     */
    async dataAnalysisOverview (query: AiAnalysisQuery = {}): Promise<{
      answerRightRate: unknown
      statsByTime: unknown
      knowledgeRecordRank: unknown
      aiToolRecordRank: unknown
      aiToolClickRank: unknown
      questionKeywordHeat: unknown
      errors: Record<string, string>
    }> {
      const params = buildAnalysisParams(query)
      const get = (path: string): Promise<unknown> =>
        requestDataAnalysis({ url: path, method: 'get', params: { ...params } })
      const settled = await settleAll<string>([
        ['answerRightRate', () => get(AI_ANALYSIS_PATHS.answerRightRate)],
        ['statsByTime', () => get(AI_ANALYSIS_PATHS.statsByTime)],
        ['knowledgeRecordRank', () => get(AI_ANALYSIS_PATHS.knowledgeRecordRank)],
        ['aiToolRecordRank', () => get(AI_ANALYSIS_PATHS.aiToolRecordRank)],
        ['aiToolClickRank', () => get(AI_ANALYSIS_PATHS.aiToolClickRank)],
        ['questionKeywordHeat', () => get(AI_ANALYSIS_PATHS.questionKeywordHeat)],
      ])
      return {
        answerRightRate: settled.answerRightRate ?? null,
        statsByTime: settled.statsByTime ?? null,
        knowledgeRecordRank: settled.knowledgeRecordRank ?? null,
        aiToolRecordRank: settled.aiToolRecordRank ?? null,
        aiToolClickRank: settled.aiToolClickRank ?? null,
        questionKeywordHeat: settled.questionKeywordHeat ?? null,
        errors: settled.errors,
      }
    },
  }
}

/** `AiModelSelectionController.get/{id}` 的返回（只列本文件用到的字段） */
export type ModelSelectionRowDetail = {
  id?: number | string
  callType?: number
  callTypeName?: string
  skillIds?: string
  skillIdList?: Array<number | string>
  modelIdList?: Array<number | string>
  extractParamModelIdList?: Array<number | string>
  multimodalModelIdList?: Array<number | string>
  analysisReportModelIdList?: Array<number | string>
  intentRecognitionModelIdList?: Array<number | string>
  details?: Array<{ id?: number | string; code?: string; modelId?: number | string; isDefault?: number }>
  [key: string]: unknown
}

export type AiModelCapability = ReturnType<typeof createAiModelCapability>
