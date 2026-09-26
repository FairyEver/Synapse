import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 人工智能 → 智能交互：**问答类四个页面**。
 *
 * | 页面 | 菜单路径 | 接口 | 方法 |
 * | --- | --- | --- | --- |
 * | 热门问题 | `/dashboard/platform/intelligence/interaction/hotTopics/list` | `/manage/ai/get{Sys,Manual,Mixed}HotQuestion` | GET |
 * | 热门问题（写） | 同上 | `/manage/ai/{add,update}HotQuestion`、`/manage/ai/logicalDelete` | **POST / DELETE** |
 * | 交互历史 | `/dashboard/platform/intelligence/interaction/questionsAndAnswersDetails/list` | `/manage/ai/getChatListByPage` | GET |
 * | 交互历史（写） | 同上 | `/manage/ai/updateChatInfo`、`/manage/ai/convertHotQuestion` | **PUT / POST** |
 * | 敏感词 | `/dashboard/platform/intelligence/interaction/sensitiveWordWhitelist/list` | `/manager/sensitiveWordsWhitelist/getWhitelistByPage` | GET |
 * | 敏感词（写） | 同上 | `/manager/sensitiveWordsWhitelist/{add,delete}`、`/update`、`/checkSensitiveWords` | **POST / PUT / DELETE** |
 * | 意见反馈 | `/dashboard/platform/intelligence/interaction/feedback/list` | `/manager/feedbackContent/getByPage` | GET |
 *
 * 四页都不是 `useListPageModule` 的声明式列表：**每页都写了自己的 `customLoad`**，
 * 所以 `getDataListURL` 一个都用不上，参数形状只能逐页读那个函数。
 *
 * ## 判据的强弱：四条列表请求**有基准**，写链路**没有**
 *
 * `baseline/ai-interaction-qa.browser.json`（2026-09-21 到位，14 条 / 4 页）覆盖到的是
 * **每页挂载时那一条无筛选 GET**，四条都与本文件构造出来的**逐字段一致**
 * （含 `order=` / `orderField=` 两个空值与 `_t` 的位置）：
 *
 * | 页面 | 基准里的那条 |
 * | --- | --- |
 * | 热门问题 | `GET /admin-api/manage/ai/getSysHotQuestion?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>` |
 * | 交互历史 | `GET /admin-api/manage/ai/getChatListByPage?order=&orderField=&pageNo=1&pageSize=20` |
 * | 敏感词 | `GET /admin-api/manager/sensitiveWordsWhitelist/getWhitelistByPage?order=&orderField=&pageNo=1&pageSize=20` |
 * | 意见反馈 | `GET /admin-api/manager/feedbackContent/getByPage?order=&orderField=&pageNo=1&pageSize=20` |
 *
 * **基准的边界（别越过它下结论）**：14 条里 **0 条非 GET**（写链路一条判据都没有），
 * 三种 role 里**只出现 `getSysHotQuestion`**（页面上没人切过那个 `a-segmented`），
 * 也没有任何"带筛选值"的请求。所以下面这些**仍然是源码 + 后端代码推导**：
 * 写链路（method / URL / body）、`user`/`mix` 两个角色、带筛选值的键位。
 * 逐条出处都写在对应方法上，测试里对应的是 B/D 两组（B2 组才是与基准比的）。
 *
 * 本地检出落后线上 435 个提交，但这四页的路由文件与 `app/portal/api` 目录**与线上逐字节一致**
 * （派单方逐文件 diff 过），且四条列表请求现在有基准背书。
 *
 * ## 同域三个前缀族：`/manage/ai/**` 与 `/manager/**`
 *
 * 四个页面同属「智能交互」，但接口分在两个前缀下（都要经 `platform` 补成 `/admin-api`）：
 * 热门问题与交互历史在 **`/manage/ai/**`**，敏感词与意见反馈在 **`/manager/**`**
 * （`/manager/sensitiveWordsWhitelist/**`、`/manager/feedbackContent/**`）。
 * 后端也是两个包内的三个控制器（`AiInfoManageController` 的 `@RequestMapping("/manage/ai")`、
 * `SensitiveWordsWhitelistController` 与 `FeedbackContentManagerController` 各自的 `@RequestMapping("/manager/…")`）。
 * 抄隔壁那页的路径时，这一层是最容易错的地方。
 *
 * ## module-type：**不发**（现在是硬证据）
 *
 * 四个页面路径在 `generated/module-type-rules.json` 里匹配不到，而基准 14 条的 `headers`
 * **一条都没有 `module-type`**（四个键就是 `Accept` / `Accept-Language` / `tenant-id` / `token`）
 * —— conventions 第 2 条 / D34 的"与浏览器一致"现在是实测出来的。**不要**给它编一个：
 * 不传是"该用户全部模块数据权限的并集"，传错比不传更糟。
 *
 * ## http 实例：`platform`（显式声明，不是推导出来的默认值）
 *
 * 四页的列表请求都在 `customLoad` 里直接 `import { http } from 'app/portal/utils/http/platform.js'`
 * 然后调用它。按 conventions 第 28 条，这属于「declaration 在调用点上",
 * 解析结果是 `platform`（`resolveHttpInstance` 的 `global-default` 分支 —— 显式传默认实例与不传
 * 字节完全一样，所以 `HTTP_INSTANCE_PAGE_RULES` 里刻意不收它们，见该文件的说明）。
 * 于是 `/manage/ai/...` 会被补成 `/admin-api/manage/ai/...`（`platform.js:18-20`）。
 * 基准里四条列表请求的路径都带 `/admin-api`，与这条推得的一致。
 *
 * ## ⚠️ `hotTopics/` 下的 `list1.vue` **不算数**
 *
 * 那个目录里同时有 `list.vue` 与 `list1.vue`。菜单（`menus/mall.v2.js:215`）指向的是
 * `/hotTopics/list` ⇒ **`list.vue` 才是线上那一版**。`list1.vue` 打的是
 * `/manage/ai/getHotQuestionListByPage`（一个 `list.vue` 里根本没有的接口），
 * 侧边栏里没有入口、**用户到不了那一页**，所以本能力**一个字都不从它推导**
 * （conventions 第 28 条：能渲染 ≠ 用户能做的事）。
 * 旁证：基准里这一页只有 `getSysHotQuestion` 一条，`getHotQuestionListByPage` **一条都没有**。
 *
 * ## 「热门问题」有三种角色，请求参数相同、**URL 不同**
 *
 * 页面上那个 `a-segmented` 切 `role`：`system`（系统）/ `user`（人工）/ `mix`（预览），
 * 分别打 `getSysHotQuestion` / `getManualHotQuestion` / `getMixedHotQuestion`。
 * `role !== 'mix'` 时才有新建 / 编辑 / 删除 / 分页。
 *
 * ⚠️ **`pageNo`/`pageSize` 三种角色都照发** —— 这是**源码推导**，不是实测：
 * `getDataListIsPage: role.value !== 'mix'` 是在 **setup 时**求值的常量（那时 `role` 还是
 * `'system'`），传进 `useListPageModule` 的是 `true`，`a-segmented` 怎么切都改不了它。
 * **基准没能证伪也没能证实这条**：它只抓到 `getSysHotQuestion`（页面挂载时 role 就是 `system`，
 * 抓基准时没人切过那个控件）。`user`/`mix` 的参数形状**至今没有观察**，
 * 测试里对应 `it.todo` 保留着，别拿 `system` 那条当它们。
 *
 * ## 空值：这一族页面的表单初值是 **`null`，不是空串**（与课程域那批相反）
 *
 * 四页的 `form` 初值全是 `null`（`question: null` / `platform: null` / `word: null` …），
 * 日期区间是 `[]`。`platform.js` 的 GET 拦截器用 `qs.stringify(params, { skipNulls: true })`
 * ⇒ **null 会被整个丢掉**，而**空串会照发**（conventions §3.2-② 那条"空值是空字符串"说的是
 * 表单初值为 `''` 的页面，这里是另一档）。所以能力的默认值是 `null`、不做任何本地过滤：
 * 调用方给 `''` 就发 `x=`，不给就不发。
 *
 * ⚠️ 与「班课统计」那种 `dropEmptyParams` **不是一回事**：那边是页面**自己**把空值全删掉，
 * 这边是 `qs` 按 `null` 丢。SDK 侧 `src/http/client.ts:244` 用的是同一组 `qs` 选项，两边一致。
 *
 * ## 长选项参数：**这一组没有**
 *
 * 四页的筛选控件只有 `a-input` / `a-select`（2~3 个枚举）/ `a-range-picker`，
 * 没有一个"挂载时全量拉候选"的下拉 ⇒ 不需要 `kind: 'search' | 'tree'` 的 `lookup`
 * （conventions 第 11 条在这四页没有落点）。`status` / `isHot` / `platform` 都是 2~3 项枚举，
 * 直接写成 `kind: 'enum'` + `options`。
 *
 * ## 写链路：这里**没有** `getRequiredStartUserSelectTasks` 那一套
 *
 * 会议室 / 各流程表单线的 `prepare()` 之所以存在，是因为"这次要人工指定哪些审批人"这个
 * 答案会**改变提交载荷**。这四个页面全是普通 CRUD，后端没有任何"提交前先问一次"的接口
 * （`AiInfoManageController` / `SensitiveWordsWhitelistController` / `FeedbackContentManagerController`
 * 三个控制器里一个都没有）。所以本文件**不硬造一个假的 `prepare`** ——
 * 理由与 `src/capabilities/assignment.ts` / `attendance-team.ts` 的文件头逐字一致。
 *
 * 真有的**只读前置步骤**照旧显式暴露，**不并进写方法**：
 *
 * - `getChatRow()` / `listHotQuestions()` / `listWhitelist()` —— 写之前先读当前值。
 * - `prepareSetChatDisplay()` / `prepareConvertChatToHot()` —— 这两个是真的会**读一次后端**
 *   的预检（"我要改的这条现在是什么"），返回值里带着 `submit` 会发的那份载荷。
 *   它们是**只读**的，调用方可以只看不写。
 * - 其余写操作没有后端预检可做，只有**页面上那几条本地校验**（`sort` 必须是正整数、
 *   `question`/`word` 必填且 ≤ 50 字）。那几条本地校验写在 `buildXxxPayload()` 里，
 *   `submit` 与"预检"共用同一份构造逻辑，不会分叉。
 *
 * ## 撤销（cancel）办法，逐个写清楚
 *
 * | 写操作 | 撤销办法 | 有没有独立接口 |
 * | --- | --- | --- |
 * | 新增热门问题 | `removeHotQuestions([新行的 id])` | 就是逻辑删除 —— 复用 `DELETE /manage/ai/logicalDelete` |
 * | 修改热门问题 | 用**原值**再 `updateHotQuestion` 一次 | 没有"回滚"接口，先 `listHotQuestions` 拿原值 |
 * | 转为热门 | `cancelConvertedHotQuestion(热门行 id)` | ⭐ 后端 `logicalDelete` **顺带把
 *   `zhdj_ai_question_info.is_hot` 改回 0**（`updateIsHotByQuestionCode`），所以这条撤销是**干净**的 |
 * | 删除热门问题 | 没有（逻辑删除后 `del_flag=1`，无接口可复原） | 无 |
 * | 改问答的显示/不显示 | `setChatDisplay(id, 原值)` —— 收的是**绝对目标值**不是 toggle | 无 |
 * | 新增敏感词 | `removeWhitelistWords([新行的 id])` | ⭐ 白名单的删除是**物理删除**（`delete from ... where id in`），所以这一条是真能删干净的 |
 * | 修改敏感词 | 用**原值**再 `updateWhitelistWord` 一次 | 无 |
 * | 删除敏感词 | 没有（物理删除，不可复原） | 无 |
 *
 * ⚠️ **`convertHotQuestion` 与 `addHotQuestion` 都不回传新 id**（后端 `success(null)` /
 * `success("操作成功")`），所以"撤销"前必须先按问题文本查一次列表拿 id：
 * `listHotQuestions({ role: 'user', question })`。这条**不是推断**，是
 * `AiQuestionHotInfoServiceImpl.saveInfo` / `addAiQuestionHotInfo` 的返回值 + 控制器签名读出来的。
 *
 * ## 敏感词页的 `checkSensitiveWords` 是**试检**，不是列表
 *
 * `POST /manager/sensitiveWordsWhitelist/checkSensitiveWords`，body `{ word }`，
 * 返回 `List<String>`（这段文本里**命中的敏感词**）。它是那个"校验白名单"弹窗的按钮，
 * **只读**（后端只调 `sensitiveWordBs.findAll`），所以它是**独立能力**、`write: false`，
 * **没有**混进列表能力里。
 *
 * ## 能力 id → 实现方法（接线用；`CAPABILITY_BINDINGS` 里照这张表写 `sdkPath`）
 *
 * | 能力 id | 方法 | 写 | 要防重吗 |
 * | --- | --- | --- | --- |
 * | `ai-interaction-hot-topics-list` | `aiInteraction.listHotQuestions` | 否 | — |
 * | `ai-interaction-hot-question-create` | `aiInteraction.createHotQuestion` | **是** | ⭐ **要**（零幂等，重发多一条热门问题） |
 * | `ai-interaction-hot-question-update` | `aiInteraction.updateHotQuestion` | **是** | 不要（同样的值再写一次终态相同） |
 * | `ai-interaction-hot-question-remove` | `aiInteraction.removeHotQuestions` | **是** | 不要（逻辑删除，重发终态相同） |
 * | `ai-interaction-chat-list` | `aiInteraction.listChats` | 否 | — |
 * | `ai-interaction-chat-get` | `aiInteraction.getChatRow` | 否 | — |
 * | `ai-interaction-chat-set-display` | `aiInteraction.setChatDisplay` | **是** | 不要（写的是**绝对值**，不是 toggle） |
 * | `ai-interaction-chat-convert-hot` | `aiInteraction.convertChatToHot` | **是** | ⭐ **要**（零幂等，重发多一条热门问题） |
 * | `ai-interaction-sensitive-word-list` | `aiInteraction.listWhitelist` | 否 | — |
 * | `ai-interaction-sensitive-word-check` | `aiInteraction.checkSensitiveWords` | 否 | — |
 * | `ai-interaction-sensitive-word-create` | `aiInteraction.createWhitelistWord` | **是** | ⭐ **要**（零幂等，重发多一条白名单） |
 * | `ai-interaction-sensitive-word-update` | `aiInteraction.updateWhitelistWord` | **是** | 不要（终态相同） |
 * | `ai-interaction-sensitive-word-remove` | `aiInteraction.removeWhitelistWords` | **是** | 不要（物理删除，重发最多一次业务报错） |
 * | `ai-interaction-feedback-list` | `aiInteraction.listFeedback` | 否 | — |
 *
 * 三个「要防重」的判据与 `src/capabilities/assignment.ts` 的文件头同款：**只有会产生第二条
 * 记录的写操作才包 `requestId`**（conventions 第 14 条：后端零幂等，AI 超时重发 = 重复单据）。
 * 另外五条写操作重发一次的终态都一样，**如实透传、不假装它们被防重保护了**。
 *
 * ⚠️ 三个 `prepareXxx` / 两个 `cancelXxx` **不是** `CAPABILITY_BINDINGS` 的条目 ——
 * 它们是写方法的搭档（只读预检 / 撤销），照 `meeting-application-prepare` 那样单独登记也可以，
 * 但**不要**把 `prepare` 与 `submit` 合进同一条 binding（conventions 第 13 条）。
 *
 * ## 逐页四件套
 *
 * `docs/pages/热门问题.md` / `交互历史.md` / `敏感词.md` / `意见反馈.md`
 */

export const AI_INTERACTION_HOT_TOPICS_PAGE_PATH =
  '/dashboard/platform/intelligence/interaction/hotTopics/list'
export const AI_INTERACTION_CHAT_PAGE_PATH =
  '/dashboard/platform/intelligence/interaction/questionsAndAnswersDetails/list'
export const AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH =
  '/dashboard/platform/intelligence/interaction/sensitiveWordWhitelist/list'
export const AI_INTERACTION_FEEDBACK_PAGE_PATH =
  '/dashboard/platform/intelligence/interaction/feedback/list'

const VIEWS = 'app/portal/views/dashboard/platform/intelligence/interaction'

/** 路由文件。⚠️ `list1.vue` **不在**这张表里 —— 它到不了，见文件头 */
export const AI_INTERACTION_ROUTE_FILES = {
  hotTopics: `${VIEWS}/hotTopics/list.vue`,
  hotTopicsForm: `${VIEWS}/hotTopics/[mode]/[id].vue`,
  hotTopicsList1Unreachable: `${VIEWS}/hotTopics/list1.vue`,
  chat: `${VIEWS}/questionsAndAnswersDetails/list.vue`,
  chatConvertModal: `${VIEWS}/questionsAndAnswersDetails/components/change-hot-topic.vue`,
  sensitiveWord: `${VIEWS}/sensitiveWordWhitelist/list.vue`,
  sensitiveWordForm: `${VIEWS}/sensitiveWordWhitelist/[mode]/[id].vue`,
  sensitiveWordCheckModal: `${VIEWS}/sensitiveWordWhitelist/components/check.vue`,
  feedback: `${VIEWS}/feedback/list.vue`,
} as const

/**
 * 权限码有**两代**，两个都记下来。
 *
 * - v1：`app/portal/menus/mall.js:434-438`，形如
 *   `/dashboard/platform/intelligence/interaction/hotTopics`。
 * - v2：`app/portal/menus/mall.v2.js:215-219`，形如
 *   `/dashboard/platform-v2/intelligence/interaction/hotTopics`。**线上跑的是这一份** ——
 *   `app/portal/menus/index.js:63` 只 import 了 `mall.v2.js` 的 `all_menus`，
 *   `mall.js` 在整个 `app/` 里**没有 import 点**（只有一份文档提到它）。
 *
 * `generated/page-catalog.json` 按 `menus/index.js` 的实际 import 记录当前生效的 v2，
 * 与能力定义逐字一致；`mall.js` 只作为历史对照保留。旧 v1 与 v2 仍会由
 * `normalizeVisibilityKey` 归一到同一可见性键，但 SDK 暴露当前 Web 端正在使用的 v2。
 */
export const AI_INTERACTION_PERMISSIONS = {
  hotTopics: {
    v1: '/dashboard/platform/intelligence/interaction/hotTopics',
    v2: '/dashboard/platform-v2/intelligence/interaction/hotTopics',
  },
  chat: {
    v1: '/dashboard/platform/intelligence/interaction/questionsAndAnswersDetails',
    v2: '/dashboard/platform-v2/intelligence/interaction/questionsAndAnswersDetails',
  },
  sensitiveWord: {
    v1: '/dashboard/platform/intelligence/interaction/sensitiveWordWhitelist',
    v2: '/dashboard/platform-v2/intelligence/interaction/sensitiveWordWhitelist',
  },
  feedback: {
    v1: '/dashboard/platform/intelligence/interaction/feedback',
    v2: '/dashboard/platform-v2/intelligence/interaction/feedback',
  },
} as const

/** 热门问题的三种角色 → 三个列表端点（页面的 `a-segmented` 切的就是它） */
export const HOT_QUESTION_LIST_PATHS = {
  system: '/manage/ai/getSysHotQuestion',
  user: '/manage/ai/getManualHotQuestion',
  mix: '/manage/ai/getMixedHotQuestion',
} as const

export const AI_INTERACTION_PATHS = {
  hotQuestionAdd: '/manage/ai/addHotQuestion',
  hotQuestionUpdate: '/manage/ai/updateHotQuestion',
  /** 逻辑删除**热门问题**（`DELETE` + JSON 数组体） */
  hotQuestionLogicalDelete: '/manage/ai/logicalDelete',
  chatList: '/manage/ai/getChatListByPage',
  chatUpdate: '/manage/ai/updateChatInfo',
  chatConvertHotQuestion: '/manage/ai/convertHotQuestion',
  whitelistList: '/manager/sensitiveWordsWhitelist/getWhitelistByPage',
  whitelistAdd: '/manager/sensitiveWordsWhitelist/add',
  whitelistUpdate: '/manager/sensitiveWordsWhitelist/update',
  whitelistDelete: '/manager/sensitiveWordsWhitelist/delete',
  whitelistCheck: '/manager/sensitiveWordsWhitelist/checkSensitiveWords',
  feedbackList: '/manager/feedbackContent/getByPage',
} as const

/** `useListPageModule({ styleV2: true })` → 20（`common/libs/renren/list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 页面上 `question` 与 `word` 两条 `max: 50` 规则的同一份门槛（见 buildXxxPayload 的说明） */
export const TEXT_MAX_LENGTH = 50

/** 热门问题的 `sort`：页面的 validator 要求正整数（`Number.isInteger(Number(v)) && Number(v) > 0`） */
export const SORT_MIN = 1

export type HotQuestionRole = keyof typeof HOT_QUESTION_LIST_PATHS

export type AiInteractionRow = {
  id?: string | number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 参数顺序
// ---------------------------------------------------------------------------

/**
 * 四页的 query 键序**都是**从 `useListPageModule.logicFetch()` 那一句来的
 * （`list.js:469-482`）：
 *
 * ```js
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = pageNo.value; params.pageSize = pageSize.value }
 * ```
 *
 * 然后各页在 `customLoad` 里 `omit(form, ['date'])`（只删日期那一个键，**其它键连同位置一起留下**），
 * 再把区间两端**追加**到最后。所以时间字段排在 `pageNo`/`pageSize` **之后** —— 不是插进中间。
 */

/** 热门问题三页共用：`{...omit(form,['date']), startInputTime, endInputTime}` */
const HOT_QUESTION_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'question', defaultValue: null },
  { name: 'createName', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  // 页面写的是 `form.date && form.date.length === 2 ? form.date[0] : null`；
  // 区间没选时是 `[]` ⇒ null ⇒ 被 qs 丢掉
  { name: 'startInputTime', defaultValue: null },
  { name: 'endInputTime', defaultValue: null },
]

/**
 * 交互历史：`{...omit(form,['date']), startDate, endDate}`。
 *
 * ⚠️ 表单的声明顺序是 `platform, isHot, question, nickname, userName, phone, answer, display, date, status`
 * —— `date` 夹在 `display` 与 `status` **之间**，`omit` 掉它之后 `status` 顶上来，**键序不变形**。
 */
const CHAT_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'platform', defaultValue: null },
  { name: 'isHot', defaultValue: null },
  { name: 'question', defaultValue: null },
  { name: 'nickname', defaultValue: null },
  { name: 'userName', defaultValue: null },
  { name: 'phone', defaultValue: null },
  { name: 'answer', defaultValue: null },
  { name: 'display', defaultValue: null },
  { name: 'status', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'startDate', defaultValue: null },
  { name: 'endDate', defaultValue: null },
]

/**
 * 敏感词：`omit(form, ['question', 'answer'])`。
 *
 * ⚠️ 这一页的 `form` 里**留着** `question` / `answer` 两个键，但模板里**没有**对应的表单项
 * （搜索区只有一个「白名单」输入框）——它们永远是初值 `null`，`customLoad` 里被 `omit` 掉。
 * 所以发出去的只有 `order / orderField / word / pageNo / pageSize`，**没有** `question`/`answer`。
 */
const WHITELIST_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'word', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 意见反馈：`{...omit(form,['time']), startTime, endTime}` */
const FEEDBACK_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'nickname', defaultValue: null },
  { name: 'userName', defaultValue: null },
  { name: 'phone', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
  { name: 'startTime', defaultValue: null },
  { name: 'endTime', defaultValue: null },
]

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

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type HotQuestionQuery = {
  /** 系统 / 人工 / 预览三选一，决定打哪个端点，默认 `system` */
  role?: HotQuestionRole
  question?: string
  createName?: string
  /** 录入时间起，`YYYY-MM-DD HH:mm:ss`。页面的区间选择器带 `show-time`，**不做 ±1 天** */
  startInputTime?: string
  /** 录入时间止 */
  endInputTime?: string
  pageNo?: number
  pageSize?: number
}

export type HotQuestionDraft = {
  /** 正整数。页面上这是个 `type="number"` 的 `a-input`，**发出去的是字符串** */
  sort: number | string
  question: string
}

export type HotQuestionUpdateDraft = HotQuestionDraft & {
  /** 热门问题行 id，来自 `listHotQuestions` */
  id: string | number
}

export type ChatQuery = {
  /** `'APP'` / `'PC'`（页面下拉给的就是这两个字符串） */
  platform?: string
  /** 是否热门：`0` 否（含 is_hot 为 null）、`1` 是 */
  isHot?: 0 | 1
  question?: string
  nickname?: string
  userName?: string
  phone?: string
  answer?: string
  /** 是否显示：`1` 显示、`0` 不显示 */
  display?: 0 | 1
  /** 反馈：`1` 赞、`0` 踩、`-1` 无操作 */
  status?: -1 | 0 | 1
  /** 问答时间起 */
  startDate?: string
  /** 问答时间止 */
  endDate?: string
  pageNo?: number
  pageSize?: number
}

export type ConvertChatToHotDraft = {
  /** **问答行**的 id（`zhdj_ai_question_info.id`），不是热门问题行的 id */
  id: string | number
  sort: number | string
}

export type WhitelistQuery = {
  /** 白名单词。⚠️ 后端是**等值**匹配（`z.word = #{params.word}`），不是模糊 */
  word?: string
  pageNo?: number
  pageSize?: number
}

export type WhitelistWordDraft = {
  word: string
}

export type WhitelistWordUpdateDraft = WhitelistWordDraft & {
  id: string | number
}

export type FeedbackQuery = {
  nickname?: string
  userName?: string
  phone?: string
  /** 反馈时间起 */
  startTime?: string
  /** 反馈时间止 */
  endTime?: string
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 校验（页面的本地规则，不是后端规则）
// ---------------------------------------------------------------------------

/**
 * 必填 + 长度校验。**返回值是原样的字符串，不做 trim** ——
 * 页面把输入框里的值直接发出去（`a-input` + `v-model`，没有任何 trim），
 * 这里 trim 一下就会与浏览器不逐字节一致（`src/capabilities/perf-manage-config.ts`
 * 那边的「trim 由能力做」是那一页自己的选择，不是通则）。
 */
function requireText (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}必填，收到的是 ${JSON.stringify(value ?? null)}`)
  }
  if (value.length > TEXT_MAX_LENGTH) {
    // ⚠️ 这是**页面的**规则（`max: 50` 的 form rule），后端不校验长度。
    // 照抄页面的门槛 = 不做页面上做不到的事；放宽它就会发出一条用户点不出来的请求。
    throw new Error(`${label}长度不能超过 ${TEXT_MAX_LENGTH} 个字符（页面上的表单规则），收到 ${value.length} 个`)
  }
  return value
}

/**
 * `sort` 的规范化：页面要求"大于 0 的正整数"。
 *
 * ⚠️ **返回值刻意保留字符串形态**（当调用方给的是字符串时）：页面上那个字段是
 * `a-input type="number"` + `v-model:value`，发出去的 JSON 里 `sort` 是 `"3"` 而不是 `3`
 * （后端 `AiQuestionHotInfo.sort` 是 TINYINT、`HotQuestionConvertReq.sort` 是 Long，
 * Jackson 会把 `"3"` 收下）。SDK 照抄这个形状，不"顺手"转成 number。
 */
function normalizeSort (value: unknown): number | string {
  const asNumber = Number(value)
  const isPositiveInteger =
    value !== null && value !== '' && value !== undefined &&
    Number.isFinite(asNumber) && Number.isInteger(asNumber) && asNumber >= SORT_MIN
  if (!isPositiveInteger) {
    throw new Error(
      `sort 必须是 ≥ ${SORT_MIN} 的正整数（页面的 validator：Number.isInteger(Number(v)) && Number(v) > 0），` +
        `收到的是 ${JSON.stringify(value ?? null)}`,
    )
  }
  return typeof value === 'string' ? value : asNumber
}

function normalizeId (value: unknown, label: string): string | number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} id 必须是有限数字，收到的是 ${JSON.stringify(value)}`)
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error(`${label} id 不能为空，收到的是 ${JSON.stringify(value ?? null)}`)
}

function normalizeIds (value: unknown, label: string): Array<string | number> {
  const raw = Array.isArray(value) ? value : [value]
  if (raw.length === 0) throw new Error(`${label}至少需要一个 id`)
  return raw.map((item) => normalizeId(item, label))
}

function assertDisplay (value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new Error(
      `display 只能是 0（不显示）或 1（显示），收到的是 ${JSON.stringify(value ?? null)}。` +
        '⚠️ 它收的是**目标值**不是"切换"——做成 toggle 就会变成不幂等的（与 base-image-set-status 同理）',
    )
  }
  return value
}

function assertRole (value: unknown): HotQuestionRole {
  if (value !== 'system' && value !== 'user' && value !== 'mix') {
    throw new Error(
      `role 只能是 system（系统）/ user（人工）/ mix（预览），收到的是 ${JSON.stringify(value ?? null)}`,
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// 载荷构造（submit 与"预检"共用同一份，不会分叉）
// ---------------------------------------------------------------------------

/**
 * 新建热门问题的 body。
 *
 * 页面的 `[mode]/[id].vue`：`pick(form, ['id', 'sort', 'question'])`，`form` 初值
 * `{ id: null, sort: '', question: '' }`，新建模式下 `id` 仍是 `null`。
 * ⇒ 浏览器发的是 `{"id":null,"sort":"3","question":"…"}`（`pick` 保留 null，JSON 里就是 `null`）。
 * 这里**照抄那个 `id: null`**：少一个键与浏览器就不是逐字节一致，且它没有副作用
 * （MyBatis-Plus 的 insert 见 id 为 null 会走自增）。
 */
export function buildHotQuestionCreatePayload (draft: HotQuestionDraft): Record<string, unknown> {
  return {
    id: null,
    sort: normalizeSort(draft?.sort),
    question: requireText(draft?.question, '热门问题内容'),
  }
}

/** 修改热门问题的 body：`{ id, sort, question }`（编辑器里 id 来自列表行） */
export function buildHotQuestionUpdatePayload (
  draft: HotQuestionUpdateDraft,
): Record<string, unknown> {
  return {
    id: normalizeId(draft?.id, '热门问题'),
    sort: normalizeSort(draft?.sort),
    question: requireText(draft?.question, '热门问题内容'),
  }
}

/**
 * 改问答显示的 body：`{ id, display }`（页面 `actionUpdateDisplay` 的原样）。
 *
 * 页面是 `{ id: record.id, display: record.display === 1 ? 0 : 1 }` —— 即"切成相反的那个"。
 * 无头侧收调用方给的**目标值**，**不做 toggle**：值由调用方算，这样重发一次终态相同。
 */
export function buildSetChatDisplayPayload (id: unknown, display: unknown): Record<string, unknown> {
  return { id: normalizeId(id, '问答'), display: assertDisplay(display) }
}

/** 转为热门的 body：`{ id, sort }`（页面 `pick(formState, ['id','sort'])`，**不含 question**） */
export function buildConvertChatToHotPayload (
  draft: ConvertChatToHotDraft,
): Record<string, unknown> {
  return {
    id: normalizeId(draft?.id, '问答'),
    sort: normalizeSort(draft?.sort),
  }
}

/** 新增白名单的 body：`{ id: null, word }`（`pick(form, ['id','word'])`，新建时 id 是 null） */
export function buildWhitelistCreatePayload (draft: WhitelistWordDraft): Record<string, unknown> {
  return { id: null, word: requireText(draft?.word, '白名单') }
}

/** 修改白名单的 body：`{ id, word }` */
export function buildWhitelistUpdatePayload (
  draft: WhitelistWordUpdateDraft,
): Record<string, unknown> {
  return { id: normalizeId(draft?.id, '白名单'), word: requireText(draft?.word, '白名单') }
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

function text (name: string, description: string): ParamSpec {
  return { name, kind: 'text', required: false, description }
}

function date (name: string, description: string): ParamSpec {
  return { name, kind: 'date', required: false, description }
}

const HOT_QUESTION_LIST_PARAMS: ParamSpec[] = [
  {
    name: 'role',
    kind: 'enum',
    required: false,
    description:
      '角色，决定打哪个端点：`system` 系统（`getSysHotQuestion`）/ `user` 人工（`getManualHotQuestion`）' +
      '/ `mix` 预览（`getMixedHotQuestion`，后端把系统与人工合并成一份）。默认 `system`。' +
      '⚠️ 三种角色**都**会带 `pageNo`/`pageSize`（`getDataListIsPage` 是 setup 时算死的 `true`）',
    options: [
      { label: '系统', value: 'system' },
      { label: '人工', value: 'user' },
      { label: '预览', value: 'mix' },
    ],
  },
  text('question', '热门问题（后端是**前缀**匹配：`like 内容%`）'),
  text('createName', '录入人员（后端按真实姓名前缀匹配；`create_id=0` 的行显示为「系统」）'),
  date('startInputTime', '录入时间起，`YYYY-MM-DD HH:mm:ss`（区间选择器带 `show-time`，**不做 ±1 天**）'),
  date('endInputTime', '录入时间止'),
  ...PAGE_PARAMS,
]

const HOT_QUESTION_DRAFT_PARAMS: ParamSpec[] = [
  {
    name: 'sort',
    kind: 'number',
    required: true,
    description:
      '显示顺序，**≥ 1 的正整数**（页面的 validator）。⚠️ 页面发出去的是**字符串**（`a-input type="number"`），' +
      '这里给数字或字符串都行，传字符串就按字符串发',
  },
  {
    name: 'question',
    kind: 'text',
    required: true,
    description: `问题描述，必填、≤ ${TEXT_MAX_LENGTH} 字（页面的表单规则）`,
  },
]

const CHAT_LIST_PARAMS: ParamSpec[] = [
  {
    name: 'platform',
    kind: 'enum',
    required: false,
    description: '来源',
    options: [
      { label: 'APP', value: 'APP' },
      { label: 'PC', value: 'PC' },
    ],
  },
  {
    name: 'isHot',
    kind: 'enum',
    required: false,
    description: '是否为热门问题。⚠️ 传 `0` 时后端查的是 `is_hot = 0 **or** is_hot is null`',
    options: [
      { label: '否', value: 0 },
      { label: '是', value: 1 },
    ],
  },
  text('question', '问题'),
  text('nickname', '昵称'),
  text('userName', '姓名'),
  text('phone', '手机号'),
  text('answer', '系统回答'),
  {
    name: 'display',
    kind: 'enum',
    required: false,
    description: '是否显示',
    options: [
      { label: '显示', value: 1 },
      { label: '不显示', value: 0 },
    ],
  },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description: '反馈（后端把它翻译成 `useful` 的三个取值）',
    options: [
      { label: '赞', value: 1 },
      { label: '踩', value: 0 },
      { label: '无操作', value: -1 },
    ],
  },
  date('startDate', '问答时间起，`YYYY-MM-DD HH:mm:ss`'),
  date('endDate', '问答时间止'),
  ...PAGE_PARAMS,
]

const WHITELIST_LIST_PARAMS: ParamSpec[] = [
  text('word', '白名单词。⚠️ 后端是**等值**匹配（`z.word = #{params.word}`），不是模糊——要精确给'),
  ...PAGE_PARAMS,
]

const FEEDBACK_LIST_PARAMS: ParamSpec[] = [
  text('nickname', '昵称（后端前缀匹配）'),
  text('userName', '姓名（后端前缀匹配）'),
  text('phone', '手机号（后端前缀匹配）'),
  date('startTime', '反馈时间起，`YYYY-MM-DD HH:mm:ss`'),
  date('endTime', '反馈时间止'),
  ...PAGE_PARAMS,
]

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const aiInteractionQaCapabilities: CapabilityDefinition[] = [
  {
    id: 'ai-interaction-hot-topics-list',
    title: '查询热门问题列表（系统 / 人工 / 预览）',
    pagePath: AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.hotTopics.v2,
    write: false,
    params: HOT_QUESTION_LIST_PARAMS,
  },
  {
    id: 'ai-interaction-hot-question-create',
    title: '新增热门问题',
    pagePath: AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.hotTopics.v2,
    write: true,
    params: HOT_QUESTION_DRAFT_PARAMS,
  },
  {
    id: 'ai-interaction-hot-question-update',
    title: '修改热门问题',
    pagePath: AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.hotTopics.v2,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '热门问题行 id，来自 `ai-interaction-hot-topics-list`。⚠️ 后端**不回传**新建后的 id，' +
          '新增完要拿 id 只能按 `question` 回查列表',
      },
      ...HOT_QUESTION_DRAFT_PARAMS,
    ],
  },
  {
    id: 'ai-interaction-hot-question-remove',
    title: '删除热门问题',
    pagePath: AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.hotTopics.v2,
    write: true,
    params: [
      {
        name: 'ids',
        kind: 'text',
        required: true,
        description:
          '热门问题行 id（一个或一组）。**逻辑删除**（`del_flag=1`，没有接口能复原）；' +
          '⚠️ 它同时会把对应问答行的 `is_hot` 改回 0 —— 所以它也是「转为热门」的撤销',
      },
    ],
  },
  {
    id: 'ai-interaction-chat-list',
    title: '查询交互历史（问答列表）',
    pagePath: AI_INTERACTION_CHAT_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.chat.v2,
    write: false,
    params: CHAT_LIST_PARAMS,
  },
  {
    id: 'ai-interaction-chat-get',
    title: '按 id 查一条交互历史',
    pagePath: AI_INTERACTION_CHAT_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.chat.v2,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '问答行 id，来自 `ai-interaction-chat-list`。⚠️ 这是**页面从不发**的一次查询' +
          '（页面没有详情页），靠后端 mapper 的 `params.id` 分支实现；见方法注释',
      },
    ],
  },
  {
    id: 'ai-interaction-chat-set-display',
    title: '设置问答的显示 / 不显示',
    pagePath: AI_INTERACTION_CHAT_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.chat.v2,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '问答行 id，来自 `ai-interaction-chat-list`' },
      {
        name: 'display',
        kind: 'enum',
        required: true,
        description: '目标值（**不是 toggle**）：`1` 显示、`0` 不显示。撤销 = 用原值再调一次',
        options: [
          { label: '显示', value: 1 },
          { label: '不显示', value: 0 },
        ],
      },
    ],
  },
  {
    id: 'ai-interaction-chat-convert-hot',
    title: '把一条问答转为热门问题',
    pagePath: AI_INTERACTION_CHAT_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.chat.v2,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description: '**问答行**的 id（不是热门问题行 id），来自 `ai-interaction-chat-list`',
      },
      {
        name: 'sort',
        kind: 'number',
        required: true,
        description: '显示顺序，**≥ 1 的正整数**。后端的唯一性检查（`checkSort`）是**注释掉的**，重复的 sort 不会被拦',
      },
    ],
  },
  {
    id: 'ai-interaction-sensitive-word-list',
    title: '查询敏感词白名单列表',
    pagePath: AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
    write: false,
    params: WHITELIST_LIST_PARAMS,
  },
  {
    id: 'ai-interaction-sensitive-word-check',
    title: '试检一段文本里的敏感词',
    pagePath: AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
    // ⚠️ 名字里带 check、方法也是 POST，但它是**只读**的：后端只 `sensitiveWordBs.findAll`。
    write: false,
    params: [
      {
        name: 'word',
        kind: 'text',
        required: true,
        description: '要试检的文本（不是"某个白名单词"）。返回这段文本里**命中的敏感词**列表，空数组=没有命中',
      },
    ],
  },
  {
    id: 'ai-interaction-sensitive-word-create',
    title: '新增敏感词白名单',
    pagePath: AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
    write: true,
    params: [
      {
        name: 'word',
        kind: 'text',
        required: true,
        description:
          `白名单词，必填、≤ ${TEXT_MAX_LENGTH} 字（页面的表单规则）。` +
          '⚠️ 后端**会拦重复**（selectWord 命中就报「敏感词重复」）',
      },
    ],
  },
  {
    id: 'ai-interaction-sensitive-word-update',
    title: '修改敏感词白名单',
    pagePath: AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '白名单行 id，来自 `ai-interaction-sensitive-word-list`' },
      { name: 'word', kind: 'text', required: true, description: '白名单词（改完的形状）' },
    ],
  },
  {
    id: 'ai-interaction-sensitive-word-remove',
    title: '删除敏感词白名单',
    pagePath: AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
    write: true,
    params: [
      {
        name: 'ids',
        kind: 'text',
        required: true,
        description:
          '白名单行 id（一个或一组）。⚠️ 这是**物理删除**（后端 `delete from … where id in (…)`），删完查不回来、也没有复原接口',
      },
    ],
  },
  {
    id: 'ai-interaction-feedback-list',
    title: '查询意见反馈列表',
    pagePath: AI_INTERACTION_FEEDBACK_PAGE_PATH,
    permission: AI_INTERACTION_PERMISSIONS.feedback.v2,
    // 这一页**只有**一个查询接口：模板里没有新建 / 编辑 / 删除 / 导出任何一个动作。
    write: false,
    params: FEEDBACK_LIST_PARAMS,
  },
]

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 能力实现。四个 `request` 由 SDK 门面注入，各自带好一个页面的上下文
 * （这四页都**不发** `module-type`，见文件头）。
 *
 * 顺序与 `aiInteractionQaCapabilities` 里四个页面首次出现的顺序一致：
 * 热门问题 → 交互历史 → 敏感词 → 意见反馈。
 */
export function createAiInteractionQaCapability (
  /** 热门问题页 */
  requestHotTopics: PortalRequest,
  /** 交互历史页 */
  requestChat: PortalRequest,
  /** 敏感词页 */
  requestSensitiveWord: PortalRequest,
  /** 意见反馈页 */
  requestFeedback: PortalRequest,
) {
  /** 读一条问答行的查询载荷：`id` 是后端 mapper 的分支参数，页面自己从不发它 */
  function chatRowQuery (id: unknown): Record<string, unknown> {
    return {
      order: '',
      orderField: '',
      id: normalizeId(id, '问答'),
      pageNo: 1,
      pageSize: 1,
    }
  }

  async function fetchChatRow (id: unknown): Promise<AiInteractionRow> {
    const page = await requestChat<PageResult<AiInteractionRow>>({
      url: AI_INTERACTION_PATHS.chatList,
      method: 'get',
      params: chatRowQuery(id),
    })
    const row = page?.list?.[0]
    if (row === undefined) {
      throw new Error(
        `找不到 id=${JSON.stringify(id)} 的问答行。这个查询按后端 mapper 的 params.id 分支取，` +
          '返回空有两种可能：id 不存在，或这条问答的 create_id 不在当前用户的数据范围里。',
      )
    }
    return row
  }

  /** 三种角色的列表请求，共用一份参数构造 */
  function listHotQuestionsByRole (
    role: HotQuestionRole,
    query: HotQuestionQuery,
  ): Promise<PageResult<AiInteractionRow>> {
    return requestHotTopics<PageResult<AiInteractionRow>>({
      url: HOT_QUESTION_LIST_PATHS[role],
      method: 'get',
      params: buildOrdered(HOT_QUESTION_ORDER, query as Record<string, unknown>),
    })
  }

  /**
   * 删除热门问题（闭包实现）。
   *
   * 为什么是闭包而不是对象方法：调用方会**解构**（`const { removeHotQuestions } = cap`），
   * 那时 `this` 是 undefined —— 这个坑 `src/capabilities/business-trip-application.ts:1454`
   * 已经踩过一次，别再踩。
   */
  function removeHotQuestionsInternal (
    hotQuestionIds: string | number | Array<string | number>,
  ): Promise<unknown> {
    return requestHotTopics({
      url: AI_INTERACTION_PATHS.hotQuestionLogicalDelete,
      method: 'delete',
      data: normalizeIds(hotQuestionIds, '热门问题'),
    })
  }

  function removeWhitelistWordsInternal (
    wordIds: string | number | Array<string | number>,
  ): Promise<unknown> {
    return requestSensitiveWord({
      url: AI_INTERACTION_PATHS.whitelistDelete,
      method: 'delete',
      data: normalizeIds(wordIds, '白名单'),
    })
  }

  return {
    /**
     * 分页查询热门问题。只读。
     *
     * `role` 决定端点（系统 / 人工 / 预览），**参数形状三种角色完全一样** ——
     * 包括 `pageNo`/`pageSize`：页面的 `getDataListIsPage` 是 setup 时算死的 `true`，
     * 不随 `a-segmented` 变（见文件头）。
     */
    listHotQuestions (query: HotQuestionQuery = {}): Promise<PageResult<AiInteractionRow>> {
      let role: HotQuestionRole
      try {
        role = assertRole(query.role ?? 'system')
      } catch (error) {
        // 参数错误走 Promise.reject，与其它能力的 list 一致（调用方 await 时才接得住）
        return Promise.reject(error)
      }
      return listHotQuestionsByRole(role, query)
    },

    /**
     * 「新增热门问题」的**只读**预检。
     *
     * ⚠️ 它**不碰后端**：这一页的后端没有"提交前先问一次"的接口（文件头里说的那件事）。
     * 它做的是**页面上那两条表单规则**（`sort` 正整数、`question` 必填且 ≤ 50 字）+
     * 拼出 `submit` 要发的那份载荷。返回 `payload` 就是可以直接交给 `createHotQuestion` 的东西，
     * 两者共用同一份构造逻辑，不会分叉。
     */
    async prepareCreateHotQuestion (
      draft: HotQuestionDraft,
    ): Promise<{ payload: Record<string, unknown> }> {
      // `async` 是**刻意**的，与各能力 list 的校验同款：参数错误走 `Promise.reject`
      // 而不是同步抛，调用方 `await` 时一定接得住
      return { payload: buildHotQuestionCreatePayload(draft) }
    },

    /**
     * 新增一条热门问题（**写操作**）。
     *
     * 会真的多出一条 `zhdj_ai_question_hot`（`type=1` 人工、`is_hot=1`、`del_flag=0`）。
     * 后端零幂等，重发一次就是两条 —— 门面上暴露的 `createIdempotent` 才是给 AI 用的那个（D12）。
     *
     * ⚠️ **不回传新 id**（后端 `success(null)`）。撤销要按 `question` 回查列表拿 id，
     * 见 `cancelCreatedHotQuestion`。
     */
    async createHotQuestion (draft: HotQuestionDraft): Promise<unknown> {
      return requestHotTopics({
        url: AI_INTERACTION_PATHS.hotQuestionAdd,
        method: 'post',
        data: buildHotQuestionCreatePayload(draft),
      })
    },

    /**
     * 撤销「新增热门问题」= **逻辑删除刚建出来的那一行**。
     *
     * 没有独立的撤销接口，复用 `DELETE /manage/ai/logicalDelete`（就是列表页那个删除按钮）。
     * 逻辑删除**不可复原**，所以"撤销"的前提是你删对了行 —— 先
     * `listHotQuestions({ role: 'user', question })` 按问题文本找到它，再删。
     */
    async cancelCreatedHotQuestion (hotQuestionId: string | number): Promise<unknown> {
      return removeHotQuestionsInternal(hotQuestionId)
    },

    /**
     * 「修改热门问题」的**只读**预检。同样不碰后端（没有可问的接口）。
     *
     * ⚠️ 调用方**必须先用 `listHotQuestions()` 拿当前值**：后端的 `update` 是
     * `<set>` 部分更新（只覆盖非 null 的字段），但 `questionCode` 会被**无条件重算**成
     * `md5(question)`，漏传 `question` 会被 `requireText` 直接拒绝 —— 不会静默写坏，
     * 但也不存在"只改 sort 不动 question"这条路。
     */
    async prepareUpdateHotQuestion (
      draft: HotQuestionUpdateDraft,
    ): Promise<{ payload: Record<string, unknown> }> {
      return { payload: buildHotQuestionUpdatePayload(draft) }
    },

    /**
     * 修改一条热门问题（**写操作**）。
     *
     * 撤销 = 用**原值**再调一次本方法（没有"回滚"接口）。原值从 `listHotQuestions()` 拿。
     */
    async updateHotQuestion (draft: HotQuestionUpdateDraft): Promise<unknown> {
      return requestHotTopics({
        url: AI_INTERACTION_PATHS.hotQuestionUpdate,
        method: 'post',
        data: buildHotQuestionUpdatePayload(draft),
      })
    },

    /**
     * 删除热门问题（**写操作，逻辑删除**）。
     *
     * 收一个 id 或一组 id（页面是多选删除）。⚠️ 两件事一起发生：
     * 1. `zhdj_ai_question_hot` 对应行 `del_flag=1`（**没有复原接口**）；
     * 2. 这些行 `question_code` 对应的**问答行 `is_hot` 被改回 0**
     *    （`AiQuestionHotInfoServiceImpl.logicalDelete` → `updateIsHotByQuestionCode`）。
     *    第 2 条正是「转为热门」的撤销依据。
     *
     * ⚠️ 同样是**页面声明了但点不到**的能力的例外：列表页确实有删除按钮（`role !== 'mix'` 时），
     * 所以这是用户能做的事，正常收进来。
     */
    async removeHotQuestions (
      hotQuestionIds: string | number | Array<string | number>,
    ): Promise<unknown> {
      return removeHotQuestionsInternal(hotQuestionIds)
    },

    /**
     * 分页查询交互历史（问答列表）。只读。
     *
     * 这一页在 `useListPageModule` 里**声明了** `deleteURL` / `selectable` / `deleteIsBatch`，
     * 但模板里**没有任何删除入口**（只有行内「转为热门」「显示/不显示」两个动作）⇒
     * deleteURL 到不了 ⇒ **本能力不做删除**（conventions 第 28 条：能渲染 ≠ 用户能做的事，
     * 声明了但点不到也一样）。
     */
    listChats (query: ChatQuery = {}): Promise<PageResult<AiInteractionRow>> {
      return requestChat<PageResult<AiInteractionRow>>({
        url: AI_INTERACTION_PATHS.chatList,
        method: 'get',
        params: buildOrdered(CHAT_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 按 id 查一条交互历史。只读。
     *
     * ⚠️ **这是页面从不发的一次查询**：这一页没有详情页，`/manage/ai/getChatListByPage`
     * 在浏览器里永远只带列表参数。SDK 用它来实现"写之前先读当前值"，
     * 依据是**后端 mapper 里有 `params.id` 分支**（`AiQuestionInfoMapper.xml`
     * 的 `and z.id = #{params.id}`，`<if test="params.id != null">`）。
     * 这是**后端代码证实**的，但**没有浏览器基准**；`pageSize=1`（id 唯一，够用）。
     */
    getChatRow (id: string | number): Promise<AiInteractionRow> {
      return fetchChatRow(id)
    },

    /**
     * 「设置显示 / 不显示」的**只读**预检：**会读一次后端**（"我要改的这条现在是什么值"）。
     *
     * 返回里带 `currentDisplay`，撤销就用它：`setChatDisplay(id, currentDisplay)`。
     * 这是这四个页面里唯一真正需要读后端的预检（因为要撤销就必须知道原值）。
     */
    async prepareSetChatDisplay (
      id: string | number,
      display: unknown,
    ): Promise<{ payload: Record<string, unknown>; currentDisplay: unknown; currentRow: AiInteractionRow }> {
      const payload = buildSetChatDisplayPayload(id, display)
      const currentRow = await fetchChatRow(id)
      return { payload, currentDisplay: currentRow.display ?? null, currentRow }
    },

    /**
     * 设置一条问答的显示 / 不显示（**写操作**）。
     *
     * `PUT /manage/ai/updateChatInfo`，body `{ id, display }`。页面在行内按钮上直接调它
     * （`actionUpdateDisplay`），有二次确认框。
     *
     * ⚠️ 收的是**目标值**不是 toggle（与 `base-image-set-status` 同理）：重发一次终态相同，
     * 所以不包防重。撤销 = 用 `prepareSetChatDisplay` 给的 `currentDisplay` 再调一次。
     */
    async setChatDisplay (id: string | number, display: unknown): Promise<unknown> {
      return requestChat({
        url: AI_INTERACTION_PATHS.chatUpdate,
        method: 'put',
        data: buildSetChatDisplayPayload(id, display),
      })
    },

    /**
     * 「转为热门」的**只读**预检：**会读一次后端**。
     *
     * 读的是那条问答行（`getChatRow`），用来确认：① 它存在；② 它现在的 `isHot` 是什么
     * （后端 `saveInfo` **没有**去重：已经热门过的再转一次会**再插一条**
     * `zhdj_ai_question_hot`，`checkSort` 那行是注释掉的）。
     * 所以 `alreadyHot: true` 时**行为由调用方决定** —— 本方法只如实报告，不替你拒绝，
     * 也不替你删旧行。
     */
    async prepareConvertChatToHot (draft: ConvertChatToHotDraft): Promise<{
      payload: Record<string, unknown>
      currentRow: AiInteractionRow
      alreadyHot: boolean
      warnings: string[]
    }> {
      const payload = buildConvertChatToHotPayload(draft)
      const currentRow = await fetchChatRow(draft?.id)
      const alreadyHot = Number(currentRow.isHot) === 1
      const warnings: string[] = []
      if (alreadyHot) {
        warnings.push(
          '这条问答的 is_hot 已经是 1。后端 saveInfo **不做去重**，再转一次会多插一条热门问题行。' +
            '要重排位置，先 listHotQuestions({ role: "user", question }) 找到原热门行再 cancelConvertedHotQuestion。',
        )
      }
      return { payload, currentRow, alreadyHot, warnings }
    },

    /**
     * 把一条问答转为热门问题（**写操作**）。
     *
     * `POST /manage/ai/convertHotQuestion`，body `{ id, sort }`（`id` 是**问答行** id）。
     * 后端 `saveInfo` 做两件事：问答行 `is_hot` 置 1、并往 `zhdj_ai_question_hot` 插一条
     * `type=1` 的热门行（`questionCode = md5(question)`，`create_id` = 当前用户）。
     *
     * ⚠️ **不回传新热门行的 id**。撤销要按 `question` 回查 `listHotQuestions({ role: 'user', question })`，
     * 再 `cancelConvertedHotQuestion(hotId)`。后端零幂等，重发一次就是两条热门问题。
     */
    async convertChatToHot (draft: ConvertChatToHotDraft): Promise<unknown> {
      return requestChat({
        url: AI_INTERACTION_PATHS.chatConvertHotQuestion,
        method: 'post',
        data: buildConvertChatToHotPayload(draft),
      })
    },

    /**
     * 撤销「转为热门」= 删掉那条热门问题行。
     *
     * 它打的就是 `DELETE /manage/ai/logicalDelete`（热门问题页那个删除按钮），
     * 但**撤销效果是完整的**：后端 `logicalDelete` 会按 `question_code` 把问答行的
     * `is_hot` 一并改回 0。所以这条撤销之后，那条问答会重新出现在 isHot=0 那一侧。
     */
    async cancelConvertedHotQuestion (hotQuestionId: string | number): Promise<unknown> {
      return removeHotQuestionsInternal(hotQuestionId)
    },

    /** 分页查询敏感词白名单。只读。`word` 是**等值**匹配（后端 `z.word = #{params.word}`） */
    listWhitelist (query: WhitelistQuery = {}): Promise<PageResult<AiInteractionRow>> {
      return requestSensitiveWord<PageResult<AiInteractionRow>>({
        url: AI_INTERACTION_PATHS.whitelistList,
        method: 'get',
        params: buildOrdered(WHITELIST_ORDER, query as Record<string, unknown>),
      })
    },

    /**
     * 试检一段文本里命中了哪些敏感词。**只读**（名字里带 check、方法也是 POST，但不写任何东西）。
     *
     * 后端 `checkSensitiveWords` = `sensitiveWordBs.findAll(checkStr)`，命中多少返回多少。
     * 空数组 = 一个都没命中，**不是**"没查到"。
     */
    async checkSensitiveWords (word: string): Promise<string[]> {
      const text = requireText(word, '待试检的文本')
      const result = await requestSensitiveWord<string[]>({
        url: AI_INTERACTION_PATHS.whitelistCheck,
        method: 'post',
        data: { word: text },
      })
      return Array.isArray(result) ? result : []
    },

    /**
     * 「新增白名单」的**只读**预检。不碰后端（后端没有预检接口）；
     * 做页面那两条表单规则（必填、≤ 50 字）+ 拼载荷。
     *
     * ⚠️ 后端**会拦重复**（`selectWord` 命中就抛"敏感词重复"），那一步只有 `submit` 时才知道。
     */
    prepareCreateWhitelistWord (draft: WhitelistWordDraft): { payload: Record<string, unknown> } {
      return { payload: buildWhitelistCreatePayload(draft) }
    },

    /**
     * 新增一条白名单（**写操作**）。
     *
     * 后端零幂等（除了"重复词"那道业务校验）；不回传新 id，撤销要按 `word` 回查列表。
     */
    async createWhitelistWord (draft: WhitelistWordDraft): Promise<unknown> {
      return requestSensitiveWord({
        url: AI_INTERACTION_PATHS.whitelistAdd,
        method: 'post',
        data: buildWhitelistCreatePayload(draft),
      })
    },

    /**
     * 撤销「新增白名单」= **物理删除**刚建出来的那一行（后端 `delete from … where id in (…)`）。
     *
     * 先 `listWhitelist({ word })` 拿到 id（`word` 是等值匹配，正好用来定位）。
     */
    async cancelCreatedWhitelistWord (wordId: string | number): Promise<unknown> {
      return removeWhitelistWordsInternal(wordId)
    },

    /**
     * 「修改白名单」的**只读**预检。**不碰后端** —— 这一页没有"按 id 查一行"的接口，
     * 列表的 `word` 又是**等值**匹配（只能按词查，不能按 id 查），所以想读当前值请直接用
     * `listWhitelist({ word: <当前那个词> })`。硬凑一次查询只会凑出一个查不到的形状。
     *
     * 这里做的是页面那两条表单规则 + 拼 `submit` 的载荷（两者共用同一份构造逻辑）。
     */
    async prepareUpdateWhitelistWord (
      draft: WhitelistWordUpdateDraft,
    ): Promise<{ payload: Record<string, unknown> }> {
      return { payload: buildWhitelistUpdatePayload(draft) }
    },

    /**
     * 修改一条白名单（**写操作**）。撤销 = 用**原值**（`word`）再调一次。
     *
     * ⚠️ 后端 `checkWord` 会拦重复（`selectWord` 里 `id != #{id}` 排除自己），
     * 改成别人已有的词会报"敏感词重复"。
     */
    async updateWhitelistWord (draft: WhitelistWordUpdateDraft): Promise<unknown> {
      return requestSensitiveWord({
        url: AI_INTERACTION_PATHS.whitelistUpdate,
        method: 'put',
        data: buildWhitelistUpdatePayload(draft),
      })
    },

    /**
     * 删除白名单（**写操作，物理删除**）。
     *
     * ⚠️ 与热门问题那条不同：**这里是真删**（`delete from zhdj_sensitive_words_whitelist where id in (…)`），
     * 删完列表查不到、也没有复原接口。删除之后敏感词库要等那个 5 分钟的定时刷新
     * （`@Scheduled(fixedRate = 300000)`）才会跟着变 —— SDK 不做等待、如实透传。
     */
    async removeWhitelistWords (
      wordIds: string | number | Array<string | number>,
    ): Promise<unknown> {
      return removeWhitelistWordsInternal(wordIds)
    },

    /** 分页查询意见反馈。只读 —— 这一页**没有任何写入口**（模板里只有查询与分页） */
    listFeedback (query: FeedbackQuery = {}): Promise<PageResult<AiInteractionRow>> {
      return requestFeedback<PageResult<AiInteractionRow>>({
        url: AI_INTERACTION_PATHS.feedbackList,
        method: 'get',
        params: buildOrdered(FEEDBACK_ORDER, query as Record<string, unknown>),
      })
    },
  }
}

export type AiInteractionQaCapability = ReturnType<typeof createAiInteractionQaCapability>
