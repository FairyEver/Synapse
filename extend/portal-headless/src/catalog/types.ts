/**
 * 能力目录与检索的类型契约。
 *
 * 这一层实现的是设计文档 D8 / D11 / D14 / D24：
 * - D8：目录是**服务端下发、实时更新**的数据；本层只负责"把已经拿到的数据组织成可渐进索要的形状"
 * - D11：路由推荐由 SDK 自己提供（不复用 Portal 的 intent）
 * - D14：`-llm` 是"这批数据怎么消费 + 下一步去哪"的协议，整个体系是逐级下钻的抽象域
 * - D24：阶段① 以「页面唯一参考清单」逐行推进，所以目录同时是进度表
 *
 * 三层结构（对应 H13 里说的"总目录 → 模块 → 页面能力"）：
 *   listDomains()  → 业务域
 *   listPages()    → 域下的页面
 *   describePage() → 页面的能力
 *   describe()     → 单个能力的 `-llm` 协议
 */

import type { CapabilityDefinition, ParamKind, ParamSpec } from '../capabilities/types.js'
import type { AiContract, AiField, AiParameter } from './ai-contract.js'

export type { CapabilityDefinition, ParamKind, ParamSpec }

/* ------------------------------------------------------------------ 原始数据 */

/** `generated/page-catalog.json` 的一行。勿手改该文件（由 pnpm generate 产出）。 */
export type GeneratedPageRow = {
  id: string
  /** 菜单路径。49 条 iframe 叶子为 null */
  menuPath: string | null
  title: string
  /** 业务域，取自菜单路径第二段 */
  domain: string
  permission: string
  routeFile: string | null
  kind: string
  /** null 表示清单里算不出（含 iframe） */
  write: boolean | null
  menuSource?: string
  status?: string
  moduleType: number | null
  moduleTypeLabel: string
}

export type GeneratedPageCatalog = {
  generatedAt: string
  portalRepo: string
  total: number
  items: GeneratedPageRow[]
}

/* ------------------------------------------------------------------ 目录实体 */

/**
 * 目录里的一个页面。
 *
 * 两种来源：
 * - `menu-catalog`：来自菜单清单（1,019 行），AI 能在侧边栏看到它
 * - `capability-only`：只被能力定义的 pagePath 引用、不在菜单树里。
 *   典型是流程表单页（H36：112 个 `/simple/<模块>/form/<NNN>` 全都不在菜单树）。
 */
export type CatalogPage = GeneratedPageRow & {
  source: 'menu-catalog' | 'capability-only'
  /** 该页面已注册的能力 ID（可能为空：阶段① 还没推进到它，见 D24） */
  capabilityIds: string[]
}

/**
 * 目录里的一个能力。
 *
 * 同一个 ID 可能出现多份定义（两处页面各自声明了同名的抽象能力），
 * 因此这里保留全部定义，`primary` 指第一条。
 */
export type CatalogCapability = {
  id: string
  title: string
  /** 该能力绑定的全部页面路径 */
  pagePaths: string[]
  /** 该 ID 的全部定义，按注册顺序 */
  definitions: CapabilityDefinition[]
  /** 主定义：第一条 */
  primary: CapabilityDefinition
  write: boolean
  /** 合并后的参数契约（多定义时按"更严的一侧"合并） */
  params: ParamSpec[]
  /** ID 冲突：同一 ID 有 >1 份定义。这属于能力定义的数据问题，应由生成器收敛 */
  conflict: boolean
}

/* ------------------------------------------------------------------ 下钻协议 */

/** D14：每一层都要能回答"下一步可以去哪" */
export type NextTool =
  | 'listDomains'
  | 'listPages'
  | 'describePage'
  | 'describe'
  | 'search'
  | 'recommend'

/**
 * 边的性质（G3）：`next` = 完成当前任务的必经下一步；`detour` = 岔路/可选。
 *
 * 为什么必须有它：评测实测，`meeting-room-usage` 的首选边指到
 * `meeting-application-definition`（一条对订会议室没有贡献的岔路），
 * 沿 `next` 走到 submit 要 3 跳、语义最短只要 2 跳（D15 的预算是 4~6 轮）。
 * 缺这个标记时，"下一步"和"顺便看看"长得一模一样，只能靠人工跨两次 describe 比对。
 */
export type NextStepRole = 'next' | 'detour'

export type NextStep = {
  /** 调哪个接口 */
  tool: NextTool
  /**
   * 调用参数（直接展开传给对应接口）。
   * 有具体值时就写死；只有在"取决于用户原话"这类情况下才省略，由 `why` 说明传什么。
   */
  args?: Record<string, string | number>
  /** 这条边是"下一步"还是"岔路"（见 NextStepRole） */
  role: NextStepRole
  /** 为什么走这一步 —— 给 AI 看的解释 */
  why: string
}

/* ------------------------------------------------------------------ 第一层：业务域 */

export type DomainSummary = {
  domain: string
  /** 业务域中文名（人工维护在 aliases.ts，可被服务端下发替换） */
  label: string
  /** 菜单清单里该域的页面数 */
  pageCount: number
  /** 只被能力引用、不在菜单树里的页面数（H36） */
  capabilityOnlyPageCount: number
  /** 该域下已注册的能力数 */
  capabilityCount: number
  /** 清单里标了"含写操作"的页面数 */
  writePageCount: number
  /** 页面形态分布，用来判断能不能批量推进（§1d） */
  kinds: string[]
  /** 该域的能力 ID，便于直接跳到 describe */
  capabilityIds: string[]
  next: NextStep[]
}

export type DomainList = {
  totalDomains: number
  /** 菜单清单里的页面数（1,019） */
  totalPages: number
  /** 只被能力引用、不在菜单树里的页面数（H36） */
  totalCapabilityOnlyPages: number
  /** 按 ID 去重后的能力数 */
  totalCapabilities: number
  domains: DomainSummary[]
  /** 目录层面的数据问题（如能力 ID 冲突） */
  warnings: string[]
  next: NextStep[]
}

/**
 * `listDomains({ detail: false })` 的开关（G9）。
 *
 * `listDomains()` 实测 17.8 KB，比它要引出的每一次 `describe()`（2.4~3.4 KB）都重——
 * 这与分层的初衷是相反的，而且它通常是链上的第一步。
 * `detail: false` 时每个域只回计数与标签，`next` / `kinds` 置空（结构不变，调用方不用改解析）。
 */
export type DomainListOptions = {
  /** 默认 true。false = 减重版：不逐个域给 `next` 与 `kinds` */
  detail?: boolean
}

/* ------------------------------------------------------------------ 第二层：页面 */

export type PageList = {
  /** false = 没有这个业务域 */
  ok: boolean
  domain: string
  label: string
  /** 该域页面总数（含 capability-only） */
  total: number
  /** 其中来自菜单清单的 */
  pageCount: number
  /** 其中只被能力引用的（H36） */
  capabilityOnlyPageCount: number
  /** 该域下已注册的能力数 */
  capabilityCount: number
  pages: CatalogPage[]
  /** 目录层面的数据问题（G11：这个键永远存在，没有问题时是空数组） */
  warnings: string[]
  next: NextStep[]
}

/* ------------------------------------------------------------------ 第三层：页面能力 */

export type PageCapabilityEntry = {
  capabilityId: string
  title: string
  write: boolean
  /** `-llm` 工具 ID：调完拿数据后加它就知道怎么消费（D14 / A6） */
  llmToolId: string
  paramNames: string[]
  purpose: string | null
  whenToUse: string | null
  effect: AiContract['effect'] | null
  boundaries: string[]
}

export type PageDescription =
  | {
      ok: true
      page: CatalogPage
      /** 该页面的能力清单；为空表示阶段① 还没推进到这里（D24） */
      capabilities: PageCapabilityEntry[]
      /** 该页面还没有任何能力定义（阶段① 逐行推进中，D24）；清单里的页面绝大多数是这样 */
      pending: boolean
      /** 目录层面的数据问题（G11：这个键永远存在，没有问题时是空数组） */
      warnings: string[]
      next: NextStep[]
    }
  | {
      ok: false
      reason: string
      /** 找不到时给出相近的页面，避免 AI 猜路径 */
      suggestions: Array<{ id: string; menuPath: string | null; title: string }>
      /** 目录层面的数据问题（G11：这个键永远存在，没有问题时是空数组） */
      warnings: string[]
    }

/* ------------------------------------------------------------------ 检索 */

/** 命中字段。返回它，上游才知道"为什么命中"（H22） */
export type SearchField =
  | 'pageTitle'
  | 'menuPath'
  | 'routeFile'
  | 'domain'
  | 'kind'
  | 'permission'
  | 'capabilityTitle'
  | 'capabilityId'
  | 'paramName'

/** 命中来源：原词 / 别名扩展 / 同义词扩展 / 中文片段 */
export type MatchVia = 'literal' | 'alias' | 'synonym' | 'partial'

export type SearchMatch = {
  field: SearchField
  /** 实际参与匹配的词（可能是扩展出来的） */
  term: string
  /** 命中的原始字段值 */
  value: string
  via: MatchVia
  /** via != 'literal' 时，记录由哪个原词扩展而来 */
  from?: string
  score: number
}

export type SearchHit = {
  type: 'domain' | 'page' | 'capability'
  /** domain 用域名；page 用页面 id；capability 用能力 id */
  id: string
  title: string
  domain?: string
  pageId?: string
  capabilityId?: string
  /** 该页面/能力是否已登记能力定义（false = 阶段① 待推进） */
  hasCapabilities?: boolean
  score: number
  /** 为什么命中 —— 按分数降序 */
  matches: SearchMatch[]
}

export type QueryTerm = {
  term: string
  via: MatchVia
  from?: string
}

export type SearchResult = {
  keyword: string
  /** 切出的原词（归一化后） */
  tokens: string[]
  /** 实际参与匹配的全部词（含扩展） */
  terms: QueryTerm[]
  total: number
  /** 是否被 limit 截断 */
  truncated: boolean
  hits: SearchHit[]
  /** 目录层面的数据问题（G11：这个键永远存在，没有问题时是空数组） */
  warnings: string[]
  next: NextStep[]
}

/* ------------------------------------------------------------------ 路由推荐（D11） */

export type RecommendationBasis = {
  source: 'alias' | 'synonym' | 'literal' | 'domain'
  /** 命中的别名条目 / 同义词组 id；literal 时为原词 */
  id: string
  /** 用户话术里触发它的原词 */
  matched: string
  /** 由它扩展出的检索词 */
  expansions: string[]
  /** 给 AI 的解释：为什么这个词指向这里 */
  note: string
  score: number
}

export type RecommendedTarget = {
  id: string
  title: string
  score: number
  /** 可解释性：为什么推荐它 */
  reasons: string[]
}

export type RecommendedCapability = RecommendedTarget & {
  pagePath: string
  write: boolean
  llmToolId: string
}

/**
 * 从话术里抽出的读写意图（G4）。
 *
 * 评测实测：「查一下会议室有哪些」（纯读）与「帮我订个会议室」（读+写）拿到
 * **完全相同的前三名**——`capabilities[]` 里明明带着 `write`，排序却没用它。
 * `signals` 记的是触发判定的原词，让上游能看出"它凭什么认为这是写意图"。
 */
export type RecommendationIntent = {
  kind: 'read' | 'write' | 'mixed' | 'unknown'
  /** 命中的读写信号词（可解释性） */
  signals: string[]
}

export type Recommendation = {
  text: string
  /** 从话术里识别出的概念（可解释性的核心） */
  interpretations: RecommendationBasis[]
  /**
   * 有没有认出**可调用的能力**（G5）。
   *
   * `false` 不等于"目录里没有这个东西"：`reason` 会区分"认出了页面但页面没有能力"
   * 与"一个字都没对上"。空数组本身不是否定信号——这是 G5 的原话。
   */
  ok: boolean
  /** `ok: false` 时的解释；`ok: true` 时为 null */
  reason: string | null
  /** 话术的读写意图（G4：把 `write` 纳入排序） */
  intent: RecommendationIntent
  domains: Array<RecommendedTarget & { label: string }>
  pages: Array<RecommendedTarget & { menuPath: string | null; domain: string }>
  /** 按分数降序；写意图会加权写能力、读意图会减权（见 intent） */
  capabilities: RecommendedCapability[]
  /**
   * 按读写分组下发（G4）：消费者可以直接挑一组，不必自己按 `write` 过滤。
   * 各自按分数排序，数量上限与 `capabilities` 相同（`limit`）。
   */
  capabilityGroups: { read: RecommendedCapability[]; write: RecommendedCapability[] }
  /**
   * 目录层面 / 意图层面的问题（G11：这个键永远存在，没有问题时是空数组）。
   * 例：判成写意图但目录里没有匹配的写能力。
   */
  warnings: string[]
  /** 拿到推荐后怎么继续（D14 的下钻） */
  next: NextStep[]
}

/* ------------------------------------------------------------------ `-llm` 协议（D14） */

export type ParamContract = {
  name: string
  kind: ParamKind
  required: boolean
  description?: string
  /** 这个参数该怎么填 —— 按 kind 推导（D6 / H35） */
  consumption: string
  /** kind = enum 的候选值 */
  options?: Array<{ label: string; value: string | number }>
  /** 长选项：先调 lookup 给的能力拿候选 */
  lookup?: { capabilityId: string; keywordParam: string; hint: string }
  /** 多份定义对同一参数的必填性不一致时的说明 */
  note?: string
  contract?: AiParameter
}

export type EntryPoint = {
  pagePath: string
  page: CatalogPage | null
  /** 该页面下请求会带的 module-type；sent = false 即浏览器也不发这个头（D34） */
  moduleType: { value: number | null; label: string | null; sent: boolean }
  /**
   * 该页面的列表请求走哪个 axios 实例（Portal 前端共 18 个，见 `src/context/README.md`）。
   *
   * 与 `moduleType` 的处置**刻意相反**：module-type 算不出就不发这个头是忠实
   * （浏览器同样不发，D34），而实例算不出意味着**打到错的 URL**——失败方式往往只是
   * 一个 404、或一个字段不同的 200，静默且难查。所以这里如实报出来，由调用方决定。
   */
  httpInstance:
    | {
        kind: 'resolved'
        /** 实例 id（`HTTP_INSTANCES` 的表键） */
        id: string
        /** 它是怎么定下来的：页面显式声明 / 页面规则表 / 全局默认 */
        matchedBy: 'declared' | 'page-rule' | 'global-default'
        /** 调用方要在 `httpBaseUrls` 里配的键（就是 env 变量名）；null = 该实例没有 baseURL */
        baseUrlEnv: string | null
      }
    | {
        kind: 'unresolved'
        /** 解析不到的原因（与 `HttpInstanceResolutionError.reason` 同源） */
        reason: string
        /** 给调用方看的说明，含「必须显式指定实例」的指引 */
        detail: string
      }
}

export type ConsumeKeyField = {
  /** 返回数据里的关键字段 */
  field: string
  /** 它是什么 */
  means: string
  /** 它指向的下游能力（能指出来的话） */
  next?: NextStep
}

/** describe() 找不到能力时返回它，并给出相近的能力，避免 AI 猜 ID */
export type DescribeMiss = {
  ok: false
  reason: string
  /**
   * 相近的能力，**按相关度降序**（复用 search 的打分器，G6）。
   * `score` 就是打分器的原始分：0 分不会被列进来——列不出来就说明目录里真的没有相近的。
   */
  suggestions: Array<{ capabilityId: string; title: string; score: number }>
  /** 目录层面的数据问题（G11：这个键永远存在，没有问题时是空数组） */
  warnings: string[]
}

/**
 * 能力的执行绑定（G1）—— 拿到 `capabilityId` 之后，**哪行代码把它发出去**。
 *
 * 两种入口都指向同一份绑定表（`src/capabilities/invoke.ts`）：
 * - `sdkPath`：手写路径，形如 `meetingApplication.roomUsage`
 * - 通用入口：`sdk.capabilities.invoke(capabilityId, args)`，不必知道能力属于哪个分组
 *
 * `null` = 这个能力还没接进 SDK 的执行层（目录里有它，但调不到）。
 */
export type CapabilityInvokeBinding = {
  /** 直接传给 `sdk.capabilities.invoke()` 的第一个参数 */
  capabilityId: string
  /** 手写路径：门面上的方法位置 */
  sdkPath: string
}

export type CapabilityDescription = {
  ok: true
  capabilityId: string
  /** A6 / D14 的 `-llm` 命名：能力 ID 后面加 `-llm` */
  llmToolId: string
  title: string
  write: boolean
  ai: AiContract | null
  /**
   * 执行绑定（G1）：这个能力在 SDK 里怎么调。
   * `null` = 没接进执行层，调用方只能自己拼 `sdk.call(页面路径, {...})`（warnings 里会说）。
   */
  invoke: CapabilityInvokeBinding | null
  /** 怎么调 */
  howToCall: {
    entryPoints: EntryPoint[]
    idempotency: string | null
    notes: string[]
  }
  /** 参数契约（含参数类型） */
  params: ParamContract[]
  /** 返回数据长什么样 */
  returns: {
    shape: string
    confidence: 'derived' | 'unknown' | 'documented'
    notes: string[]
    fields?: AiField[]
  }
  /** 这批数据拿到后该怎么消费 */
  consume: {
    notes: string[]
    keyFields: ConsumeKeyField[]
  }
  /** 拿到数据后下一步去哪 */
  next: NextStep[]
  /**
   * 横向与纵向的邻居。
   *
   * `upstream` / `downstream` 是**链上**的前后（G2）：`CAPABILITY_LINKS` 里人工登记的边，
   * 加上能力自己 `lookup` 声明的候选来源。订会链上的 `meetingRoomId` 是唯一一个
   * "用户给不出、必须查"的必填参数——没有这两个字段时，prepare/submit 的邻接表里
   * 没有任何一条边指向它的候选来源，调用方只能靠别处偶然看到过才知道。
   */
  related: {
    /** 同一页面上的其他能力 */
    samePage: string[]
    /** 同一业务域下的其他能力 */
    sameDomain: string[]
    /** 指过来的能力（下游域的上游 + 长选项参数的候选来源） */
    upstream: string[]
    /** 本能力指向的下游能力 */
    downstream: string[]
  }
  /** 目录层面的数据问题（如 ID 冲突），不影响调用但要让人知道 */
  warnings: string[]
}

export type DescribeResult = CapabilityDescription | DescribeMiss
