import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 「人工智能 → 提示工程」里最基础的三页。
 *
 * | 页面 | 菜单路径 | 列表接口 | 实例 |
 * | --- | --- | --- | --- |
 * | 提示词类型 | `/dashboard/platform/intelligence/prompt/type/list` | `GET /admin-api/system/tip-type/page` | platform（默认） |
 * | 技能列表 | `/dashboard/platform/intelligence/prompt/prompt/list` | `GET /admin-api/sys/tip-template/page` | platform |
 * | 意图列表 | `/dashboard/platform/intelligence/prompt/intent/list` | `GET /admin-api/system/intent/page` | platform |
 *
 * 三页都是 `useListPageModule` + `getDataListURL` 的**声明式列表页**（`generated/page-catalog.json`
 * 里 `kind` 就是「列表页(声明式 getDataListURL)」），也是最规矩的一档：
 * 列表请求的参数顺序由 `common/libs/renren/list.js:469-492` 的 `logicFetch` 决定 ——
 * `{ order, orderField, ...表单初值, pageNo, pageSize }`，随后 `platform.js` 追加 `_t`。
 *
 * ## 三页的 URL 前缀**不统一**，这是刻意的
 *
 * 提示词类型与意图打 `/admin-api/system/…`，技能列表打 `/admin-api/sys/…`（少一个 `tem`）。
 * 后端两个 `@RequestMapping` 就是 `/system/tip-type`、`/system/intent`、`/sys/tip-template`
 * （`TipTypeController.java:24`、`IntentController.java:28`、`TipTemplateController.java:36`）。
 * **不要"顺手统一"** —— 那是两套不同的路由。
 *
 * ## module-type：**不发**
 *
 * 三个页面路径在 `generated/module-type-rules.json` 里都匹配不到（实测 `resolveModuleType`
 * 返回 `{ moduleType: null, matchedBy: 'none' }`）⇒ 按 conventions 第 2 条**不发这个头**，
 * 与浏览器一致。**不要给它编一个。**
 *
 * ## 权限码有两代，两个都记着
 *
 * | 页面 | v1（`app/portal/menus/mall.js`） | v2（`app/portal/menus/mall.v2.js` + 路由文件 `<route meta>`） |
 * | --- | --- | --- |
 * | 提示词类型 | `/dashboard/platform/intelligence/prompt/type` | `/dashboard/platform-v2/intelligence/prompt/type` |
 * | 技能列表 | `/dashboard/platform/intelligence/prompt/prompt` | `/dashboard/platform-v2/intelligence/prompt/prompt` |
 * | 意图列表 | `/dashboard/platform/intelligence/prompt/intent` | `/dashboard/platform-v2/intelligence/prompt/intent` |
 *
 * **生效的是 v2**：`app/portal/menus/index.js:62-64` 只 import 了 `./mall.v2.js` 的 `all_menus`，
 * `mall.js` 里那份 `all_menus` **没有任何引用**（死代码）。所以本文件的能力定义取 v2。
 *
 * `generated/page-catalog.json` 按 `menus/index.js` 的实际 import 记录当前生效的 **v2**，
 * 与路由文件的 `<route>` meta 逐字一致；`mall.js` 只作为历史对照，不接入目录。
 * 旧 v1 与 v2 对可见性判定仍然等价：`src/catalog/visibility.ts` 的
 * `normalizeVisibilityKey` 会把 `/dashboard/platform-v2` 归一成 `/dashboard/platform`。
 *
 * ## 写操作在哪
 *
 * 三页的「新建 / 编辑」按钮都只做 `router.push`（`list.js` 的 `actionCreate` / `actionEdit`），
 * 真正的写请求发在**详情路由**上：
 *
 * - 提示词类型：`type/[mode]/[id].vue` → `useFormPageModule({ objectURL: '/admin-api/system/tip-type' })`
 * - 技能列表：`prompt/[mode]/[id].vue` → `prompt/api.js` 的 save / preview / execute
 * - 意图列表：`intent/[mode]/[id].vue` → `useFormPageModule({ objectURL: '/admin-api/system/intent' })`
 *
 * 删除则是列表页自己的 `deleteURL` + renren 通用删除：
 * `DELETE {deleteURL}/{id}`（`list.js:507-524`，`deleteIsBatch` 三页都没开）。
 *
 * ## 逐字段基准
 *
 * **本批没有基准**（`baseline/ai-prompt.browser.json` 不存在 —— 抓基准是另一条线的活）。
 * 所以本文件里的 URL / 参数顺序**全部是源码 + 后端代码读出来的，不是实测**，
 * 唯一的例外是「提示词类型」列表那条：派单方实测浏览器发的是
 * `GET /admin-api/system/tip-type/page?order=&orderField=&label=&name=&pageNo=1&pageSize=20&_t=…`，
 * 与源码推导一致。测试里把「等基准才能写的断言」单列出来了（见 `test/ai-prompt.test.ts` 末尾）。
 *
 * 一个后端的坑值得写在这里：`TipTemplatePageReqVO` 有 `createTime` 字段（还带
 * `@DateTimeFormat`），但 `TipTemplateMapper.selectPage` 的查询条件里**没有它**
 * —— 传了会被静默忽略。
 */

export const AI_PROMPT_TYPE_PAGE_PATH = '/dashboard/platform/intelligence/prompt/type/list'
export const AI_PROMPT_SKILL_PAGE_PATH = '/dashboard/platform/intelligence/prompt/prompt/list'
export const AI_PROMPT_INTENT_PAGE_PATH = '/dashboard/platform/intelligence/prompt/intent/list'

/** 生效的权限码（`menus/mall.v2.js` = `menus/index.js` 真正 import 的那份） */
export const AI_PROMPT_TYPE_PERMISSION = '/dashboard/platform-v2/intelligence/prompt/type'
export const AI_PROMPT_SKILL_PERMISSION = '/dashboard/platform-v2/intelligence/prompt/prompt'
export const AI_PROMPT_INTENT_PERMISSION = '/dashboard/platform-v2/intelligence/prompt/intent'

/**
 * 上一代权限码（`menus/mall.js`，**死代码**）。只用于排障与可见性对照，能力定义里不用它。
 * `generated/page-catalog.json` 记的是这三个值（原因见文件头）。
 */
export const AI_PROMPT_TYPE_PERMISSION_V1 = '/dashboard/platform/intelligence/prompt/type'
export const AI_PROMPT_SKILL_PERMISSION_V1 = '/dashboard/platform/intelligence/prompt/prompt'
export const AI_PROMPT_INTENT_PERMISSION_V1 = '/dashboard/platform/intelligence/prompt/intent'

const VIEWS = 'app/portal/views/dashboard/platform/intelligence/prompt'

/** 路由文件，写进文档与排障时用得上 */
export const AI_PROMPT_ROUTE_FILES = {
  type: `${VIEWS}/type/list.vue`,
  /** 新建 / 编辑表单页（`[mode]` = create|edit，`[id]` = new|<id>） */
  typeForm: `${VIEWS}/type/[mode]/[id].vue`,
  skill: `${VIEWS}/prompt/list.vue`,
  skillForm: `${VIEWS}/prompt/[mode]/[id].vue`,
  intent: `${VIEWS}/intent/list.vue`,
  intentForm: `${VIEWS}/intent/[mode]/[id].vue`,
} as const

// ---------------------------------------------------------------------------
// 接口路径
// ---------------------------------------------------------------------------

/** 提示词类型：列表 / 候选（无参）/ 新建(POST) 与修改(PUT) 共用 / 详情＋删除带 id */
export const TIP_TYPE_PAGE_URL = '/admin-api/system/tip-type/page'
export const TIP_TYPE_LIST_URL = '/admin-api/system/tip-type/list'
export const TIP_TYPE_OBJECT_URL = '/admin-api/system/tip-type'

/** 技能列表：列表页读的是**提示词模板**表，写的是新版技能配置 */
export const TIP_TEMPLATE_PAGE_URL = '/admin-api/sys/tip-template/page'
export const TIP_TEMPLATE_OBJECT_URL = '/admin-api/sys/tip-template'
export const TIP_TEMPLATE_CONCISE_PAGE_URL = '/admin-api/sys/tip-template/getConciseTipTemplatePage'

/** 意图：列表 / 新建(POST) 与修改(PUT) 共用 / 详情＋删除带 id */
export const INTENT_PAGE_URL = '/admin-api/system/intent/page'
export const INTENT_OBJECT_URL = '/admin-api/system/intent'

/** 新版技能配置（`prompt/api.js`） */
export const SKILL_CONFIG_SAVE_URL = '/admin-api/ai/skill/config/save'
export const SKILL_CONFIG_GET_URL = '/admin-api/ai/skill/config/get'
export const SKILL_CONFIG_PREVIEW_URL = '/admin-api/ai/skill/config/preview'
export const SKILL_CONFIG_EXECUTE_URL = '/admin-api/ai/skill/config/execute'
export const SKILL_CARD_LIST_URL = '/admin-api/ai/skill/card/list'

/** 技能编排用到的另外两条候选入口 */
export const AVAILABLE_MODEL_LIST_URL = '/admin-api/manager/aiModelConfig/getAvailableList'
export const OPEN_API_REGISTRY_PAGE_URL = '/admin-api/system/openApiRegistry/getByPage'

/**
 * `prompt/api.js` 里导出但**没有任何页面调用**的两条：
 *
 * - `deleteSkillConfig(id)` → `DELETE /admin-api/ai/skill/config/delete?id=`
 *   （列表页的删除走 renren 的 `DELETE /admin-api/sys/tip-template/{id}`，不是这条）
 * - `fetchSkillCardDetail(cardNo)` → `GET /admin-api/ai/skill/card/get?cardNo=`
 *
 * 按 conventions 第 28 条的口径（"没被用到的入口不搬进 SDK"）**不做成能力**，只在这里记一笔：
 * 将来如果发现某条链路真的要用它，再补。
 */
export const UNUSED_SKILL_API_PATHS = {
  delete: '/admin-api/ai/skill/config/delete',
  cardGet: '/admin-api/ai/skill/card/get',
} as const

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/** 长选项候选的每页条数。页面 `loopFetch` 用的是 100（`IntentTemplateListSelect.vue:121`、`share.js:151`） */
export const SEARCH_PAGE_SIZE_DEFAULT = 100
/** 候选查询的每页上限，与页面一致（不允许一次把整张表倒出来，conventions 11） */
export const SEARCH_PAGE_SIZE_MAX = 100

export type PageResult<T> = { list: T[]; total: number }

export type AiPromptRow = {
  id?: number | string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 参数顺序（逐个能力显式构造，字段顺序 = 页面实测/推导的键序）
// ---------------------------------------------------------------------------

type OrderedKey = { name: string; defaultValue: unknown }

/**
 * 三个列表页的键序。
 *
 * `logicFetch`（`list.js:472-483`）是 `{ order, orderField, ...convertFetchForm(formState), pageNo, pageSize }`，
 * 三页都没有 `convertFetchForm` 钩子，所以 `...form` 就是**表单初值的声明顺序**：
 *
 * - 提示词类型：`form: { label: '', name: '' }`
 * - 技能列表：`form: { name: '', typeId: '', useSystem: '', useFeature: '', isPublish: '' }`
 * - 意图列表：`form: { name: '' }`
 *
 * ⚠️ 空值**照发**（`qs.stringify` 的 `skipNulls` 只丢 `undefined`/`null`，不丢空串）——
 * 这是 conventions 第 4 条那条 renren 默认空值参数，三页都适用（与班课统计那种 `dropEmptyParams`
 * 的页面正相反）。
 */
const TIP_TYPE_LIST_ORDER: ReadonlyArray<OrderedKey> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'label', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

const SKILL_LIST_ORDER: ReadonlyArray<OrderedKey> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'typeId', defaultValue: '' },
  { name: 'useSystem', defaultValue: '' },
  { name: 'useFeature', defaultValue: '' },
  { name: 'isPublish', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

const INTENT_LIST_ORDER: ReadonlyArray<OrderedKey> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

function buildOrdered (
  order: ReadonlyArray<OrderedKey>,
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
// 提示词类型
// ---------------------------------------------------------------------------

export type TipTypeQuery = {
  /** 类型名称（模糊匹配。同一页里 `label` 是「类型名称」、`name` 是「类型值」，别搞反） */
  label?: string
  /** 类型值 */
  name?: string
  pageNo?: number
  pageSize?: number
}

/** 新建 / 修改的载荷。字段与 `TipTypeSaveReqVO`（id / name / label）一致 */
export type TipTypeDraft = {
  /** 只有修改时给。`PUT` 时后端用 `updateById`，没传的字段不会被清空 */
  id?: number
  /** 类型值，页面必填（`[mode]/[id].vue` 的 `rules.name`） */
  name: string
  /** 类型名称，页面必填（`rules.label`） */
  label: string
}

/**
 * 新建提示词类型。
 *
 * - `POST /admin-api/system/tip-type`，body `{ name, label }`（`TipTypeSaveReqVO`）。
 * - 后端**没有**唯一性校验（`TipTypeServiceImpl.createTipType` 直接 `insert`）
 *   ⇒ 重发一次就多一行，防重要走门面的 `createIdempotent`（conventions 14）。
 */
export function buildTipTypeCreateBody (draft: TipTypeDraft): Record<string, unknown> {
  return { name: draft.name, label: draft.label }
}

/**
 * 修改提示词类型。
 *
 * ⚠️ **这是推断，不是实测**：页面走的是 `useFormPageModule` 的编辑模式 ——
 * 先 `GET /admin-api/system/tip-type/{id}`，把**整个响应**灌进 `formState`（`form.js:176`），
 * 再 `PUT` 回去，所以浏览器发的 body 是
 * `{ id, name, label, deleted, createTime }`（= `TipTypeRespVO` 的全部字段）。
 *
 * SDK 只发 `TipTypeSaveReqVO` 认的三个字段：后端 `updateTipType` 是
 * `tipTypeMapper.updateById(BeanUtils.toBean(VO, DO))`（`TipTypeServiceImpl.java:45-48`），
 * MyBatis-Plus 的 `updateById` **只更新非 null 字段**，所以少发 `deleted` / `createTime`
 * 不会把它们写成空 —— 而多发那两个字段只是把原值回写一遍。
 *
 * 真机验证只能等基准或冒烟（本批没有）。要绝对逐字复刻的话得改成「先 GET 再整包 PUT」，
 * 那一版**故意没做**：它把一次写变成两次请求，而且响应字段顺序一变 body 就跟着变。
 */
export function buildTipTypeUpdateBody (draft: TipTypeDraft & { id: number }): Record<string, unknown> {
  return { id: draft.id, name: draft.name, label: draft.label }
}

function assertTipTypeDraft (draft: Partial<TipTypeDraft>, action: string): void {
  if (!String(draft?.name ?? '').trim()) {
    throw new Error(`${action}提示词类型：name（类型值）不能为空 —— 页面上这一项是 required`)
  }
  if (!String(draft?.label ?? '').trim()) {
    throw new Error(`${action}提示词类型：label（类型名称）不能为空 —— 页面上这一项是 required`)
  }
}

// ---------------------------------------------------------------------------
// 意图
// ---------------------------------------------------------------------------

export type IntentQuery = {
  /** 中文名称（后端 `likeIfPresent` ⇒ `%x%`） */
  name?: string
  pageNo?: number
  pageSize?: number
}

/** ⚠️ 后端硬校验：`templateIdList.size() > 3` 直接抛「意图绑定的提示模板最多只能绑定三个」 */
export const INTENT_TEMPLATE_MAX = 3

export type IntentDraft = {
  /** 只有修改时给 */
  id?: number
  /** 中文名称，页面必填 */
  name: string
  /** 英文名称，页面必填 */
  content: string
  /** 含义，页面必填 */
  meaning: string
  /**
   * 关联的提示词模板 id 列表（顺序即 `sort`）。
   *
   * ⚠️ **修改时它是"整组替换"**：`IntentServiceImpl.updateIntent` 先把该意图下所有
   * `sys_intent_template_rel` 标记 `deleted=1`，再按这份列表重插
   * （`IntentServiceImpl.java:80-105`）。**不传 = 把已有绑定全清掉**，
   * 所以本 SDK 把修改时的 `templateIdList` 做成必填（见 `buildIntentUpdateBody`）。
   */
  templateIdList: number[]
}

function assertIntentDraft (draft: Partial<IntentDraft>, action: string): void {
  for (const [field, label] of [['name', '中文名称'], ['content', '英文名称'], ['meaning', '含义']] as const) {
    if (!String((draft as Record<string, unknown>)[field] ?? '').trim()) {
      throw new Error(`${action}意图：${field}（${label}）不能为空 —— 页面上这一项是 required`)
    }
  }
  const ids = draft.templateIdList
  if (ids !== undefined && ids.length > INTENT_TEMPLATE_MAX) {
    throw new Error(
      `${action}意图：templateIdList 最多 ${INTENT_TEMPLATE_MAX} 个（后端硬校验，` +
        `传多了会拿到业务错误「意图绑定的提示模板最多只能绑定三个」）`,
    )
  }
}

/** 新建意图的 body：`{ name, content, meaning, templateIdList }`（页面 formState 的声明顺序） */
export function buildIntentCreateBody (draft: IntentDraft): Record<string, unknown> {
  return {
    name: draft.name,
    content: draft.content,
    meaning: draft.meaning,
    templateIdList: [...(draft.templateIdList ?? [])],
  }
}

/**
 * 修改意图的 body。多一个 `id` 打头。
 *
 * `templateIdList` 在这里是**必填**（与页面行为一致：页面编辑模式下 formState 由
 * `GET /admin-api/system/intent/{id}` 灌入，后端 `getInfo` 只在**存在绑定**时才回 `templateIdList`
 * —— 没有绑定时这个键根本不出现，PUT 上去也就等于清空，而那时本来就是空的）。
 * SDK 不模仿"键有时在有时不在"，统一要求调用方给出这份列表：
 * 漏传会静默清空绑定，那是这个页面上唯一一个"不报错但是错的"。
 */
export function buildIntentUpdateBody (draft: IntentDraft & { id: number }): Record<string, unknown> {
  if (!Array.isArray(draft.templateIdList)) {
    throw new Error(
      '修改意图时必须显式给 templateIdList（哪怕是空数组）：这个接口是整组替换，' +
        '不传会把已有的关联提示词全部清掉',
    )
  }
  return {
    id: draft.id,
    name: draft.name,
    content: draft.content,
    meaning: draft.meaning,
    templateIdList: [...draft.templateIdList],
  }
}

// ---------------------------------------------------------------------------
// 技能配置载荷（`prompt/utils.js` 的 `buildSkillConfigPayload` 的复刻）
// ---------------------------------------------------------------------------

export const NODE_TYPE_SKILL = 1
export const NODE_TYPE_MODULE = 2

export const CARD_ACTION_ROUTER = 'router'
export const CARD_ACTION_SEND_MESSAGE = 'send_message'
export const CARD_ACTION_SELECT_MODULE = 'select_module'

export type SkillCardButtonPayload = {
  sort: number
  name: string
  actionType: string
  actionValue: string
  pcActionValue: string
}

export type SkillCardConfigPayload = {
  id: number | null
  enabled: boolean
  cardNo: number | null
  cardName: string
  buttonCount: number
  buttons: SkillCardButtonPayload[]
  outputFormatJson: string
}

export type SkillNodePayload = {
  id: number | null
  nodeType: number
  name: string
  enabled: number
  sort: number
  description: string
  triggerWords: string[]
  promptContent: string
  modelConfigId: number | null
  apiIds: number[]
  cardConfig: SkillCardConfigPayload | null
  children: SkillNodePayload[]
}

export type SkillConfigPayload = {
  id: number | null
  name: string
  skillIntroduction: string
  tipPromptText: string
  isPublish: number
  isIntentRecognition: number
  isAppExclusive: number
  useType: string
  typeId: number | null
  useSystem: number | null
  useFeature: number | null
  icon: string
  tipContent: string
  nodes: SkillNodePayload[]
}

/**
 * 调用方给进来的形状：比 `SkillConfigPayload` 宽松得多，缺的按页面初值补。
 *
 * 之所以不直接复用 `SkillConfigPayload`：页面上的表单值**大量是字符串或空串**
 * （`typeId: ''`、`isPublish: ''`、下拉清空后是 `undefined`），
 * 而这些在载荷里必须归一成 `null` / `0` / 空串。所以入参按"原始表单值"收，
 * 出参才严格要求。归一规则见 `buildSkillConfigPayload`。
 */
export type SkillCardButtonInput = {
  sort?: number | string
  name?: string
  actionType?: string
  actionValue?: string
  pcActionValue?: string | null
}

export type SkillCardInput = {
  id?: number | string | null
  enabled?: boolean | number
  cardNo?: number | string | null
  cardName?: string
  buttonCount?: number
  buttons?: SkillCardButtonInput[]
  outputFormatJson?: string
}

export type SkillNodeInput = {
  id?: number | string | null
  nodeType?: number | string
  name?: string
  enabled?: number | string
  sort?: number | string
  description?: string
  /** 数组，或页面那种逗号串（`[,，\n]` 拆开） */
  triggerWords?: string[] | string
  promptContent?: string
  modelConfigId?: number | string | null
  apiIds?: Array<number | string>
  cardConfig?: SkillCardInput | null
  children?: SkillNodeInput[]
}

export type SkillConfigInput = {
  id?: number | string | null
  name?: string
  skillIntroduction?: string
  tipPromptText?: string
  isPublish?: number | string
  isIntentRecognition?: number | string
  isAppExclusive?: number | string
  useType?: string
  typeId?: number | string | null
  useSystem?: number | string | null
  useFeature?: number | string | null
  icon?: string
  tipContent?: string
  nodes?: SkillNodeInput[]
}

/** 页面上「技能提示文案 / 总提示词」的长度上限（`utils.js:172`） */
export const TIP_CONTENT_MAX_LENGTH = 20000

/**
 * 与页面 `utils.js:493-497` 的 `normalizeId` 同义：空串 / null / undefined → `null`，
 * 数字串 → number，非数字原样返回（类型上仍标成 number，和页面一样不额外校验）。
 */
function normalizeId (value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null
  const numberValue = Number(value)
  return Number.isNaN(numberValue) ? (value as number) : numberValue
}

function normalizeIdList (value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeId).filter((item): item is number => Boolean(item))
}

function isModule (node: SkillNodeInput): boolean {
  return Number(node.nodeType) === NODE_TYPE_MODULE
}

function triggerWordsOf (value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  return String(value ?? '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeCardButton (button: SkillCardButtonInput, index: number): SkillCardButtonPayload {
  const actionType = button.actionType || ''
  const actionValue = button.actionValue ?? ''
  return {
    sort: Number(button.sort) || index + 1,
    name: button.name || '',
    actionType,
    actionValue,
    // 页面只有 router 动作才留 pcActionValue，其余一律空串（`utils.js:294-296`）
    pcActionValue: button.pcActionValue != null && button.pcActionValue !== ''
      ? button.pcActionValue
      : actionType === CARD_ACTION_ROUTER
        ? actionValue
        : '',
  }
}

function normalizeCardConfig (cardConfig: SkillCardInput | null | undefined): SkillCardConfigPayload {
  const buttons: SkillCardButtonPayload[] = Array.isArray(cardConfig?.buttons)
    ? cardConfig.buttons.map(normalizeCardButton)
    : []
  const enabled = Boolean(cardConfig?.enabled)
  return {
    id: normalizeId(cardConfig?.id),
    enabled,
    cardNo: normalizeId(cardConfig?.cardNo),
    cardName: cardConfig?.cardName || '',
    buttonCount: cardConfig?.buttonCount ?? buttons.length,
    buttons,
    outputFormatJson: cardConfig?.outputFormatJson || '',
  }
}

/**
 * 一个技能 / 模块节点 → 载荷。键序与 `cleanNodeForPayload`（`utils.js:446-479`）逐字一致。
 *
 * 两处页面特有的行为：
 * - **模块节点**不允许带模型 / 接口 / 卡片：`modelConfigId=null`、`apiIds=[]`、`cardConfig=null`
 *   （后端 `NewSkillConfigValidator` 也会拒）。
 * - 卡片**没启用**时，除 `id`/`enabled` 外的字段一律清空（`utils.js:466-475`）。
 */
function cleanNodeForPayload (node: SkillNodeInput, index: number): SkillNodePayload {
  const module = isModule(node)
  const cardConfig = normalizeCardConfig(node.cardConfig)
  const payload: SkillNodePayload = {
    id: ((): number | null => {
      const rawId = normalizeId(node.id)
      return rawId !== null && Number(rawId) > 0 ? rawId : null
    })(),
    nodeType: module ? NODE_TYPE_MODULE : NODE_TYPE_SKILL,
    name: node.name || '',
    enabled: Number(node.enabled) === 0 ? 0 : 1,
    sort: index + 1,
    description: module ? node.description || '' : '',
    triggerWords: module ? triggerWordsOf(node.triggerWords) : [],
    promptContent: node.promptContent || '',
    modelConfigId: module ? null : normalizeId(node.modelConfigId),
    apiIds: module ? [] : normalizeIdList(node.apiIds),
    cardConfig: module ? null : cardConfig,
    // 模块下面的子节点在页面上被强制当技能（`utils.js:424` 的
    // `normalizeNode({ ...child, nodeType: NODE_TYPE_SKILL })`），这里照做
    children: module
      ? (node.children ?? []).map((child, childIndex) =>
        cleanNodeForPayload({ ...child, nodeType: NODE_TYPE_SKILL }, childIndex),
      )
      : [],
  }
  if (!module && payload.cardConfig && !payload.cardConfig.enabled) {
    payload.cardConfig = {
      ...payload.cardConfig,
      cardNo: null,
      cardName: '',
      buttonCount: 0,
      buttons: [],
      outputFormatJson: '',
    }
  }
  return payload
}

/**
 * 表单 → 保存载荷。**键序与 `buildSkillConfigPayload`（`utils.js:89-107`）逐字一致** ——
 * 这是拿浏览器基准逐字段比 URL/body 时唯一能钉住的东西，别重排。
 *
 * 两处**刻意不复刻**的页面行为，都在这里说清楚：
 *
 * 1. **按钮数不按卡片上限截断。** 页面会拿前端注册表
 *    `app/portal/views/dashboard/common/chat/utils/xiaohuiCardRegistry.js` 里的
 *    `buttonLimit` 把每张卡的按钮裁到上限（101/102/107/108 是 0 个、113 是 1 个、其余 3 个）。
 *    SDK 不搬那张前端表：后端 `NewSkillNodeOutputPolicy` / `NewSkillConfigValidator`
 *    都不校验按钮数，所以超了不会报错，只是页面上看不到多出来的按钮。
 * 2. **`code` 不发。** `NewSkillConfig` 有 `code` 字段（后端 `normalizeAndValidateCode`
 *    要求 `[a-z][a-z0-9_-]{1,63}` 且唯一），但页面的 `buildSkillConfigPayload` 不带它 ⇒ 恒为 null
 *    ⇒ 后端 `updateById` 忽略 null、插入时留空。SDK 保持一致，改编码请走别的入口。
 */
export function buildSkillConfigPayload (input: SkillConfigInput): SkillConfigPayload {
  return {
    id: normalizeId(input.id),
    name: input.name || '',
    skillIntroduction: input.skillIntroduction || '',
    tipPromptText: input.tipPromptText || '',
    isPublish: Number(input.isPublish) || 0,
    isIntentRecognition: Number(input.isIntentRecognition) || 0,
    isAppExclusive: Number(input.isAppExclusive) || 0,
    useType: input.useType || '',
    typeId: normalizeId(input.typeId),
    useSystem: normalizeId(input.useSystem),
    useFeature: normalizeId(input.useFeature),
    icon: input.icon || '',
    tipContent: input.tipContent || '',
    nodes: (input.nodes ?? []).map((node, index) => cleanNodeForPayload(node, index)),
  }
}

/** 技能审核用的技能编码，页面写死（`[mode]/[id].vue:402`） */
export const SKILL_REVIEW_CODE = 'skill_review'

/** `POST /ai/skill/config/execute` 的请求体，键序与页面一致 */
export type SkillExecuteBody = {
  skillCode: string
  modelConfigId: number | null
  /** 审核的上下文就是待保存的那份载荷 */
  context: SkillConfigPayload
}

export function buildSkillReviewBody (payload: SkillConfigPayload): SkillExecuteBody {
  return { skillCode: SKILL_REVIEW_CODE, modelConfigId: null, context: payload }
}

/** `AiSkillExecuteWithContextRespDTO`：`{ approved, content, variables }` */
export type SkillReviewResult = {
  approved?: boolean
  content?: string
  variables?: Record<string, unknown>
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

function text (name: string, description: string): ParamSpec {
  return { name, kind: 'text', required: false, description }
}

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/** 提示词类型 id 的候选来源：同页的 `/list`（无参、一次拿全 —— 类型是一张小字典表） */
export const TIP_TYPE_OPTIONS_LOOKUP = {
  capabilityId: 'ai-prompt-tip-type-options',
  keywordParam: 'name',
} as const

/** 提示词模板 id 的候选来源（意图的「关联提示词」用） */
export const INTENT_TEMPLATE_LOOKUP = {
  capabilityId: 'ai-prompt-intent-template-search',
  keywordParam: 'name',
} as const

export const SYSTEM_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '公共', value: 0 },
  { label: '人力', value: 1 },
  { label: '财务', value: 2 },
  { label: '资产', value: 3 },
  { label: '生产', value: 4 },
  { label: '采购', value: 5 },
  { label: '销售', value: 6 },
  { label: '门户', value: 7 },
  { label: '平台', value: 10 },
]

const TIP_TYPE_LIST_PARAMS: ParamSpec[] = [
  text('label', '类型名称（**模糊匹配**，后端 `likeIfPresent` ⇒ `%x%`）。空串照发（conventions 4）'),
  text('name', '类型值（模糊匹配）。⚠️ 本页 `label` 是「类型名称」、`name` 是「类型值」，别搞反'),
  ...PAGE_PARAMS,
]

const SKILL_LIST_PARAMS: ParamSpec[] = [
  text('name', '名称（模糊匹配）'),
  {
    name: 'typeId',
    kind: 'search',
    required: false,
    description: '类型 id。候选来自 ai-prompt-tip-type-options —— **先问用户关键字**再取候选，不要猜 id',
    lookup: TIP_TYPE_OPTIONS_LOOKUP,
  },
  {
    name: 'useSystem',
    kind: 'enum',
    required: false,
    options: SYSTEM_OPTIONS,
    description: '使用系统。取值来自 `app/portal/utils/define.js:144-154` 的 SYSTEM_OPTIONS_ALL',
  },
  {
    name: 'useFeature',
    kind: 'search',
    required: false,
    description:
      '使用功能。页面是字典下拉 `tip_use_feature`（`portal-hxr-dict-select`），取值域未实测；' +
      '候选走 base-dict-search',
    lookup: { capabilityId: 'base-dict-search', keywordParam: 'keyword' },
  },
  {
    name: 'isPublish',
    kind: 'enum',
    required: false,
    options: [
      { label: '是', value: 1 },
      { label: '否', value: 0 },
    ],
    description:
      '发布状态。页面是字典下拉 `yes_no` 且 `asNumber`（`prompt/list.vue:47-56`），' +
      '1/0 取自 `share.js` 的 PUBLISH_YES / PUBLISH_NO',
  },
  ...PAGE_PARAMS,
]

const INTENT_LIST_PARAMS: ParamSpec[] = [
  text('name', '中文名称（模糊匹配）'),
  ...PAGE_PARAMS,
]

const SKILL_CONFIG_FIELD_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'number', required: false, description: '技能 id；**不传 = 新建**，传了 = 覆盖保存' },
  { name: 'name', kind: 'text', required: true, description: '技能名称（页面 required）' },
  { name: 'skillIntroduction', kind: 'text', required: true, description: '技能简介（页面 required）' },
  { name: 'tipPromptText', kind: 'text', required: true, description: '技能提示文案（页面 required）' },
  {
    name: 'typeId',
    kind: 'search',
    required: true,
    description: '类型 id（页面 required）。候选来自 ai-prompt-tip-type-options',
    lookup: TIP_TYPE_OPTIONS_LOOKUP,
  },
  { name: 'icon', kind: 'text', required: true, description: '图标 URL（页面 required；上传走 base-upload）' },
  { name: 'useSystem', kind: 'enum', required: false, options: SYSTEM_OPTIONS, description: '使用系统' },
  {
    name: 'useFeature',
    kind: 'search',
    required: false,
    description: '使用功能。取值域未实测，候选走 base-dict-search',
    lookup: { capabilityId: 'base-dict-search', keywordParam: 'keyword' },
  },
  { name: 'useType', kind: 'text', required: false, description: '使用类型（字符串，取值域未实测）' },
  {
    name: 'isPublish',
    kind: 'enum',
    required: false,
    options: [
      { label: '是', value: 1 },
      { label: '否', value: 0 },
    ],
    description: '是否发布，默认 0',
  },
  {
    name: 'isIntentRecognition',
    kind: 'enum',
    required: false,
    options: [
      { label: '是', value: 1 },
      { label: '否', value: 0 },
    ],
    description: '是否参与意图识别，默认 0（页面常量 IS_INTENT_RECOGNITION_YES/NO）',
  },
  {
    name: 'isAppExclusive',
    kind: 'enum',
    required: false,
    options: [
      { label: '是', value: 1 },
      { label: '否', value: 0 },
    ],
    description: '是否 App 专属，默认 0（页面常量 APP_EXCLUSIVE_YES/NO，只有「是/否」两档）',
  },
  {
    name: 'tipContent',
    kind: 'text',
    required: false,
    description: `总提示词，参与模块语义路由与子技能执行。≤${TIP_CONTENT_MAX_LENGTH} 字符（页面校验）`,
  },
  {
    name: 'nodes',
    kind: 'text',
    required: false,
    description:
      '技能 / 模块节点树（JSON 数组）。节点键序：' +
      '`id, nodeType, name, enabled, sort, description, triggerWords, promptContent, modelConfigId, apiIds, cardConfig, children`；' +
      '`nodeType`：1=技能、2=模块。模块节点不允许带模型 / 接口 / 卡片，且其子节点一律当技能（nodeType 强制 1）',
  },
]

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const aiPromptCapabilities: CapabilityDefinition[] = [
  // ---- 提示词类型 ----
  {
    id: 'ai-prompt-tip-type-list',
    title: '查询提示词类型列表',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: false,
    params: TIP_TYPE_LIST_PARAMS,
  },
  {
    id: 'ai-prompt-tip-type-get',
    title: '查询单个提示词类型',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: false,
    params: [{ name: 'id', kind: 'number', required: true, description: '提示词类型 id，来自 ai-prompt-tip-type-list' }],
  },
  {
    id: 'ai-prompt-tip-type-options',
    title: '查询提示词类型候选（下拉）',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: false,
    params: [
      {
        name: 'name',
        kind: 'text',
        required: false,
        description:
          '类型值关键字（后端前缀/包含匹配）。**不传就不要发这个参数** —— 页面是不带任何参数调 `/list` 的，' +
          '不传时 URL 上只有 `_t`，与页面逐字一致',
      },
      { name: 'label', kind: 'text', required: false, description: '类型名称关键字，同上' },
    ],
  },
  {
    id: 'ai-prompt-tip-type-create',
    title: '新建提示词类型',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: true,
    params: [
      { name: 'name', kind: 'text', required: true, description: '类型值（例：`chat`）' },
      { name: 'label', kind: 'text', required: true, description: '类型名称（例：`对话`）' },
    ],
  },
  {
    id: 'ai-prompt-tip-type-update',
    title: '修改提示词类型',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '要改的那一行的 id' },
      { name: 'name', kind: 'text', required: true, description: '类型值（整字段替换）' },
      { name: 'label', kind: 'text', required: true, description: '类型名称（整字段替换）' },
    ],
  },
  {
    id: 'ai-prompt-tip-type-remove',
    title: '删除提示词类型',
    pagePath: AI_PROMPT_TYPE_PAGE_PATH,
    permission: AI_PROMPT_TYPE_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '提示词类型 id。⚠️ **被提示词模板引用时删不掉**：后端抛业务错误' +
          '「该类型已绑定提示词模版,无法删除!」（`TipTypeServiceImpl.java:52-58`）。' +
          '要删就得先把引用它的技能改到别的类型',
      },
    ],
  },

  // ---- 技能列表 ----
  {
    id: 'ai-prompt-skill-list',
    title: '查询技能列表',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: SKILL_LIST_PARAMS,
  },
  {
    id: 'ai-prompt-skill-get',
    title: '查询技能详情（含节点树）',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '技能 id。这条走 `/ai/skill/config/get`（**不是** `/sys/tip-template/{id}`）：' +
          '前者才会回 `nodes` 节点树，后者只回模板字段',
      },
    ],
  },
  {
    id: 'ai-prompt-skill-preview',
    title: '预览技能组装结果（只读）',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: SKILL_CONFIG_FIELD_PARAMS,
  },
  {
    id: 'ai-prompt-skill-prepare',
    title: '保存前准备：把待保存的载荷交给「技能审核」',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: SKILL_CONFIG_FIELD_PARAMS,
  },
  {
    id: 'ai-prompt-skill-submit',
    title: '保存技能配置（新建或覆盖）',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: true,
    params: SKILL_CONFIG_FIELD_PARAMS,
  },
  {
    id: 'ai-prompt-skill-remove',
    title: '删除技能',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '技能 id，即 ai-prompt-skill-submit 的返回值。走列表页的 `deleteURL`：' +
          '`DELETE /admin-api/sys/tip-template/{id}`（**不是** `prompt/api.js` 里那条没被任何页面调用的 ' +
          '`/ai/skill/config/delete`）',
      },
    ],
  },
  {
    id: 'ai-prompt-skill-card-list',
    title: '查询输出卡片候选',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: [],
  },
  {
    id: 'ai-prompt-skill-model-options',
    title: '查询可用模型候选（技能节点选模型用）',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: [],
  },
  {
    id: 'ai-prompt-skill-interface-search',
    title: '按关键字搜索可绑定的开放接口',
    pagePath: AI_PROMPT_SKILL_PAGE_PATH,
    permission: AI_PROMPT_SKILL_PERMISSION,
    write: false,
    params: [
      {
        name: 'name',
        kind: 'search',
        required: true,
        description:
          '接口名称关键字。**必填**：页面是 `loopFetch` 全量循环拉（每页 100 × 最多 100 页），' +
          '无头不能照抄（conventions 11）。后端走 `name LIKE \'x%\'`（前缀匹配）',
      },
      { name: 'apiPath', kind: 'text', required: false, description: '接口路径前缀，后端同一套前缀匹配' },
      { name: 'groupName', kind: 'text', required: false, description: '分组名，后端是**等值**匹配' },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      {
        name: 'pageSize',
        kind: 'number',
        required: false,
        description: `每页条数，默认 ${SEARCH_PAGE_SIZE_DEFAULT}，上限 ${SEARCH_PAGE_SIZE_MAX}`,
      },
    ],
  },

  // ---- 意图列表 ----
  {
    id: 'ai-prompt-intent-list',
    title: '查询意图列表',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: false,
    params: INTENT_LIST_PARAMS,
  },
  {
    id: 'ai-prompt-intent-get',
    title: '查询单个意图（含已绑定的提示词 id 列表）',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '意图 id。⚠️ 返回里**没有绑定关系时 `templateIdList` 这个键不出现**（`IntentServiceImpl.getInfo`），' +
          '别把"键不在"读成"绑定为空"以外的东西 —— 它确实就是空',
      },
    ],
  },
  {
    id: 'ai-prompt-intent-template-search',
    title: '按关键字搜索可关联的提示词（意图的「关联提示词」候选）',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: false,
    params: [
      {
        name: 'name',
        kind: 'search',
        required: true,
        description:
          '提示词名称关键字。**必填**：页面是 `loopFetch` 全量循环拉（每页 100 × 最多 100 页），' +
          '无头不能照抄（conventions 11）。后端是 `name LIKE \'x%\'`（前缀匹配）',
      },
      {
        name: 'isIntentRecognition',
        kind: 'enum',
        required: false,
        options: [
          { label: '是', value: 1 },
          { label: '否', value: 0 },
        ],
        description: '是否参与意图识别。页面写死传 1；不传则后端不加这个条件',
      },
      { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
      {
        name: 'pageSize',
        kind: 'number',
        required: false,
        description: `每页条数，默认 ${SEARCH_PAGE_SIZE_DEFAULT}，上限 ${SEARCH_PAGE_SIZE_MAX}`,
      },
    ],
  },
  {
    id: 'ai-prompt-intent-create',
    title: '新建意图',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: true,
    params: [
      { name: 'name', kind: 'text', required: true, description: '中文名称' },
      { name: 'content', kind: 'text', required: true, description: '英文名称' },
      { name: 'meaning', kind: 'text', required: true, description: '含义（列表里点开的那段说明）' },
      {
        name: 'templateIdList',
        kind: 'search',
        required: false,
        description:
          `关联的提示词 id 列表（顺序即 sort），**最多 ${INTENT_TEMPLATE_MAX} 个**（后端硬校验）。` +
          '候选来自 ai-prompt-intent-template-search —— 先问用户关键字',
        lookup: INTENT_TEMPLATE_LOOKUP,
      },
    ],
  },
  {
    id: 'ai-prompt-intent-update',
    title: '修改意图（关联提示词整组替换）',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '意图 id' },
      { name: 'name', kind: 'text', required: true, description: '中文名称' },
      { name: 'content', kind: 'text', required: true, description: '英文名称' },
      { name: 'meaning', kind: 'text', required: true, description: '含义' },
      {
        name: 'templateIdList',
        kind: 'search',
        required: true,
        description:
          `关联的提示词 id 列表，**必填（可以是空数组）**：这是整组替换，不传（null）会把已有的绑定全部清掉。最多 ${INTENT_TEMPLATE_MAX} 个`,
        lookup: INTENT_TEMPLATE_LOOKUP,
      },
    ],
  },
  {
    id: 'ai-prompt-intent-remove',
    title: '删除意图',
    pagePath: AI_PROMPT_INTENT_PAGE_PATH,
    permission: AI_PROMPT_INTENT_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '意图 id。**逻辑删除**（`deleteById`）；绑定关系 `sys_intent_template_rel` **不跟着删**，' +
          '但列表/详情都按 `deleted=0` 过滤，所以看不出来。删完请用 ai-prompt-intent-list 复核',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/**
 * 从「整包参数」里挑出页面会发的那些筛选项。
 *
 * 与列表查询的差别：像 `getConciseTipTemplatePage` / `getOpenApiRegistryPage` 这类
 * **页面原本不带筛选**的入口，只有调用方真的给了值才发那个参数
 * —— 空串也发会让 URL 与页面不一致。
 */
function pickDefined (source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

function clampPageSize (value: unknown, fallback: number, max: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback
  return Math.min(Math.trunc(numberValue), max)
}

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type：三页都算不出 ⇒ **不发这个头**；http 实例：三页都落全局默认 `platform`）。
 */
export function createAiPromptCapability (
  /** 提示词类型页 */
  requestTipType: PortalRequest,
  /** 技能列表页 */
  requestSkill: PortalRequest,
  /** 意图列表页 */
  requestIntent: PortalRequest,
) {
  return {
    // ---------------- 提示词类型 ----------------

    /** 分页查询提示词类型。只读 */
    listTipTypes (query: TipTypeQuery = {}): Promise<PageResult<AiPromptRow>> {
      return requestTipType<PageResult<AiPromptRow>>({
        url: TIP_TYPE_PAGE_URL,
        method: 'get',
        params: buildOrdered(TIP_TYPE_LIST_ORDER, query as Record<string, unknown>),
      })
    },

    /** 单个提示词类型。只读 */
    getTipType (id: number): Promise<AiPromptRow> {
      return requestTipType<AiPromptRow>({
        url: `${TIP_TYPE_OBJECT_URL}/${id}`,
        method: 'get',
      })
    },

    /**
     * 提示词类型候选（技能列表页的「类型」下拉、技能编辑页的类型下拉都用它）。
     * 只读。
     *
     * 页面是 `http.get('/admin-api/system/tip-type/list')` —— **一个参数都不带**，
     * 所以不传筛选时这里也只发 `_t`，与页面逐字一致。
     */
    listTipTypeOptions (query: { name?: string; label?: string } = {}): Promise<AiPromptRow[]> {
      return requestTipType<AiPromptRow[]>({
        url: TIP_TYPE_LIST_URL,
        method: 'get',
        params: pickDefined(query as Record<string, unknown>),
      })
    },

    /** 新建提示词类型。**写**。返回新行的 id */
    createTipType (draft: TipTypeDraft): Promise<number> {
      assertTipTypeDraft(draft, '新建')
      return requestTipType<number>({
        url: TIP_TYPE_OBJECT_URL,
        method: 'post',
        data: buildTipTypeCreateBody(draft),
      })
    },

    /** 修改提示词类型。**写**。body 是 `{ id, name, label }`（见 `buildTipTypeUpdateBody` 的说明） */
    updateTipType (draft: TipTypeDraft & { id: number }): Promise<boolean> {
      assertTipTypeDraft(draft, '修改')
      if (draft.id === undefined || draft.id === null) {
        throw new Error('修改提示词类型：id 必填（PUT 的后端用 id 定位，缺了会抛「查询不到对应数据」）')
      }
      return requestTipType<boolean>({
        url: TIP_TYPE_OBJECT_URL,
        method: 'put',
        data: buildTipTypeUpdateBody(draft),
      })
    },

    /** 删除提示词类型。**写**。被技能引用时后端会拒（业务错误） */
    removeTipType (id: number): Promise<boolean> {
      return requestTipType<boolean>({
        url: `${TIP_TYPE_OBJECT_URL}/${id}`,
        method: 'delete',
      })
    },

    // ---------------- 技能列表 ----------------

    /** 分页查询技能列表。只读 */
    listSkills (query: Record<string, unknown> = {}): Promise<PageResult<AiPromptRow>> {
      return requestSkill<PageResult<AiPromptRow>>({
        url: TIP_TEMPLATE_PAGE_URL,
        method: 'get',
        params: buildOrdered(SKILL_LIST_ORDER, query),
      })
    },

    /** 单个技能的完整配置（含 `nodes` 节点树）。只读 */
    getSkill (id: number): Promise<Record<string, unknown>> {
      return requestSkill<Record<string, unknown>>({
        url: SKILL_CONFIG_GET_URL,
        method: 'get',
        params: { id },
      })
    },

    /**
     * 预览技能组装结果。**只读**（POST 但没有任何写）。
     *
     * 页面在编辑态加载完、以及每次刷新预览时都会打它。
     */
    previewSkill (input: SkillConfigInput): Promise<Record<string, unknown>> {
      return requestSkill<Record<string, unknown>>({
        url: SKILL_CONFIG_PREVIEW_URL,
        method: 'post',
        data: buildSkillConfigPayload(input),
      })
    },

    /**
     * 保存前准备：把待保存的载荷交给「技能审核」，问它这次过不过。
     *
     * **只读**（`POST /ai/skill/config/execute` 会真的跑一次 AI，但不写业务数据）。
     *
     * 这是本页的 `prepare()`：页面的提交链路是
     * `execute(skill_review) → 弹审核结果 → 用户点「继续保存」才 formSubmit`
     * （`prompt/[mode]/[id].vue:399-418`）。审核结果里 `approved=false` 时页面并不阻止保存，
     * 只是让用户看一眼 —— SDK 保持同样的语义：**这一步不替调用方做决定**，把结果原样返回。
     *
     * ⚠️ 返回体是 `{ approved, content, variables }`。页面从 `variables` 里读
     * `summary` / `issues` / `suggestions` / `unverifiableItems`，
     * 并且在 `variables.executionFailed === true` 或 `parseFailed === true` 时**视为无效结果**
     * （`utils.js:109-128`）—— 调用方要判断"审核到底跑成功没有"，必须看这两个标志，
     * 不能只看 `approved` 有没有值。
     */
    prepareSkillReview (input: SkillConfigInput): Promise<SkillReviewResult> {
      return requestSkill<SkillReviewResult>({
        url: SKILL_CONFIG_EXECUTE_URL,
        method: 'post',
        data: buildSkillReviewBody(buildSkillConfigPayload(input)),
      })
    },

    /**
     * 保存技能配置（`id` 为空 = 新建，有值 = 覆盖）。**写**。返回技能 id。
     *
     * 后端会做一整套校验（`NewSkillConfigValidator` + `normalizeAndValidateCode`），
     * 不过会抛业务错误，所以本能力**不重复页面那套客户端校验**。
     * 页面上另有三条 SDK 没管的必填：`name` / `skillIntroduction` / `icon` / `tipPromptText` / `typeId`
     * （表单 `rules`）—— 缺了会由后端直接拒，失败方式是一个 500。
     *
     * ⚠️ 保存是**覆盖**语义：后端 `save()` 在有 id 时会 `nodeMapper.deleteByConfigId(id)`
     * 再按 `nodes` 重插，所以 `nodes` 必须给全，不能只给要改的那几个。
     */
    submitSkillSave (input: SkillConfigInput): Promise<number> {
      return requestSkill<number>({
        url: SKILL_CONFIG_SAVE_URL,
        method: 'post',
        data: buildSkillConfigPayload(input),
      })
    },

    /**
     * 撤销：删除刚建/要撤的技能。**写**。
     *
     * 走的是列表页的通用删除 → `DELETE /admin-api/sys/tip-template/{id}`
     * （`list.js:516-520`，`deleteIsBatch` 这页没开，所以 id 拼在路径上、没有 body）。
     */
    cancelSkillSave (id: number): Promise<boolean> {
      return requestSkill<boolean>({
        url: `${TIP_TEMPLATE_OBJECT_URL}/${id}`,
        method: 'delete',
      })
    },

    /** 输出卡片候选（节点卡片配置用）。只读，零参数 —— 与页面一致 */
    listSkillCards (): Promise<AiPromptRow[]> {
      return requestSkill<AiPromptRow[]>({ url: SKILL_CARD_LIST_URL, method: 'get' })
    },

    /**
     * 可用模型候选（技能节点选模型用）。只读，零参数 —— 与页面一致。
     *
     * 返回里的每一项：`id` 是模型 id，`modelName`/`name` 是展示名，
     * `availableStatus !== 1` 表示**当前不可选**（页面把这类置灰，`[mode]/[id].vue:139-143`）。
     */
    listAvailableModels (): Promise<AiPromptRow[]> {
      return requestSkill<AiPromptRow[]>({ url: AVAILABLE_MODEL_LIST_URL, method: 'get' })
    },

    /**
     * 按关键字搜索可绑定的开放接口。只读。
     *
     * ⚠️ **页面在这里是全量循环拉**（`share.js:150-173`：每页 100、最多 100 页），
     * 无头不照抄（conventions 11），所以这里 `name` 必填。
     *
     * 键序：页面原本只发 `pageNo, pageSize`，SDK 把 `name` 追加在**后面**，
     * 不动页面已有的前两个键。
     */
    searchSkillInterfaces (query: {
      name: string
      apiPath?: string
      groupName?: string
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: AiPromptRow[]; total: number }> {
      if (!String(query?.name ?? '').trim()) {
        throw new Error(
          '搜索开放接口必须给 name 关键字：页面是 loopFetch 全量循环拉（最多 100×100 条），' +
            '无头不能照抄（conventions 11）',
        )
      }
      const params: Record<string, unknown> = {
        pageNo: query.pageNo ?? 1,
        pageSize: clampPageSize(query.pageSize, SEARCH_PAGE_SIZE_DEFAULT, SEARCH_PAGE_SIZE_MAX),
        ...pickDefined({ name: query.name, apiPath: query.apiPath, groupName: query.groupName }),
      }
      return requestSkill<{ list: AiPromptRow[]; total: number }>({
        url: OPEN_API_REGISTRY_PAGE_URL,
        method: 'get',
        params,
      })
    },

    // ---------------- 意图列表 ----------------

    /** 分页查询意图列表。只读 */
    listIntents (query: IntentQuery = {}): Promise<PageResult<AiPromptRow>> {
      return requestIntent<PageResult<AiPromptRow>>({
        url: INTENT_PAGE_URL,
        method: 'get',
        params: buildOrdered(INTENT_LIST_ORDER, query as Record<string, unknown>),
      })
    },

    /** 单个意图。只读。绑定为空时 `templateIdList` 这个键**不出现** */
    getIntent (id: number): Promise<Record<string, unknown>> {
      return requestIntent<Record<string, unknown>>({
        url: `${INTENT_OBJECT_URL}/${id}`,
        method: 'get',
      })
    },

    /**
     * 「关联提示词」候选。只读。**必须给关键字**（页面是全量循环拉，conventions 11）。
     *
     * 键序：页面原本发 `isIntentRecognition, pageNo, pageSize`（`IntentTemplateListSelect.vue:114-119`），
     * SDK 把 `name` 追加在**后面**，不动页面已有的三个键。
     */
    searchIntentTemplates (query: {
      name: string
      isIntentRecognition?: number
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: AiPromptRow[]; total: number }> {
      if (!String(query?.name ?? '').trim()) {
        throw new Error(
          '搜索关联提示词必须给 name 关键字：页面是 loopFetch 全量循环拉（最多 100×100 条），' +
            '无头不能照抄（conventions 11）',
        )
      }
      const params: Record<string, unknown> = {
        ...pickDefined({ isIntentRecognition: query.isIntentRecognition }),
        pageNo: query.pageNo ?? 1,
        pageSize: clampPageSize(query.pageSize, SEARCH_PAGE_SIZE_DEFAULT, SEARCH_PAGE_SIZE_MAX),
        name: query.name,
      }
      return requestIntent<{ list: AiPromptRow[]; total: number }>({
        url: TIP_TEMPLATE_CONCISE_PAGE_URL,
        method: 'get',
        params,
      })
    },

    /** 新建意图。**写**。返回新意图 id */
    createIntent (draft: IntentDraft): Promise<number> {
      assertIntentDraft(draft, '新建')
      return requestIntent<number>({
        url: INTENT_OBJECT_URL,
        method: 'post',
        data: buildIntentCreateBody(draft),
      })
    },

    /** 修改意图。**写**。`templateIdList` 必填（整组替换，见 `buildIntentUpdateBody`） */
    updateIntent (draft: IntentDraft & { id: number }): Promise<boolean> {
      assertIntentDraft(draft, '修改')
      if (draft.id === undefined || draft.id === null) {
        throw new Error('修改意图：id 必填（后端用 id 定位，缺了会抛「查询不到对应数据」）')
      }
      return requestIntent<boolean>({
        url: INTENT_OBJECT_URL,
        method: 'put',
        data: buildIntentUpdateBody(draft),
      })
    },

    /** 删除意图。**写**。逻辑删除；绑定关系不跟着删（但查询都按 deleted=0 过滤） */
    removeIntent (id: number): Promise<boolean> {
      return requestIntent<boolean>({
        url: `${INTENT_OBJECT_URL}/${id}`,
        method: 'delete',
      })
    },
  }
}

export type AiPromptCapability = ReturnType<typeof createAiPromptCapability>
