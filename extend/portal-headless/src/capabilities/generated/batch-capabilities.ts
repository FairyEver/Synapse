/**
 * 批量生成的能力定义 —— **由 `tools/generate/batch-capabilities.mjs` 生成，勿手改。**
 *
 * 重新生成：`node tools/generate/batch-capabilities.mjs`（抽样 20 页）
 *          `node tools/generate/batch-capabilities.mjs --all`（全部声明式列表页）
 *
 * 来源：Portal 前端 `useListPageModule({ getDataListURL, form, ... })` 的静态抽取。
 * 抽取规则与出处见生成器文件头的表格；判定口径（auto / partial / failed）与
 * 范围口径（in-scope / out-of-scope）见同目录的 `batch-report.json`。
 *
 * ⚠️ 四条会让人抽错的实测事实，改这里之前先读：
 * 1. **列表请求用的 http 实例不是页面自己 import 的那个。** 只有把 http 传进
 *    `useListPageModule({ http, ... })`（或页面用的 preset 替它传）才生效，
 *    否则一律走 main.js 注入的 `platform`。裁决这个值的**唯一**依据是
 *    `src/context/http-instance.ts` 的 `resolveHttpInstance()`——
 *    本文件里的 `httpInstance` / `httpModule` / `baseUrlEnv` / `sizeParam` 都是它的快照。
 *    自己拿"文件 import 了哪个 http"去推会错：preset 包装（调用点看不到 http）、
 *    省略 `.js` 后缀的 import、`as` 别名、局部常量转发，全都会漏。
 * 2. **分页参数名是 `pageSize`，不是 renren 默认的 `limit`** —— main.js 覆写过；
 *    走 `sale` 实例的页又被该实例的拦截器改名回 `limit`；`fieldNamePageSize` 还能单页再覆写。
 *    `sizeParam` 是逐页抽出来的，别当成全局常量。
 * 3. `url` 是**改写之前**的原始路径；补 `/admin-api` 前缀（只有 `platform` 实例有这一步）
 *    由 src/http/client.ts 按同一份实例画像完成，`resolvedPath` 是改写后的结果。
 * 4. `scope` 与 `verdict` **正交**。本项目只做 Portal 主后端（决策 D3），
 *    走别的实例的页面是 `out-of-scope`：它照样有完整契约（浏览器实测核对与审计要用），
 *    **但不可接线**。接线请用 `BATCH_SDK_CAPABILITIES`，它还会排除菜单范围外与 partial 契约。
 */

import type { CapabilityDefinition, ParamKind } from '../types.js'

/** 一个查询参数在请求里的位置与初值。顺序就是 qs 序列化后的顺序（设计 D20 逐字段一致）。 */
export type BatchQueryParam = {
  name: string
  /**
   * 表单初值，原样照抄源码里的字面量。
   * - `null` / `undefined`：qs 的 `skipNulls` 会把它丢掉（浏览器也不发这个参数）
   * - `[]`：日期区间的空初值，qs 序列化后同样不产生参数
   */
  defaultValue: string | number | boolean | null | readonly unknown[]
  kind: string
}

/**
 * 一个能力参数的 kind 是**怎么定下来的**——给人复核用，AI 不读它（AI 读 `params`）。
 *
 * 为什么要有这个字段：kind 的判据是**页面上的控件**，而控件类型在源码里写在模板上。
 * 判得出来的就写死，判不出来的（最典型的是下拉的候选规模——实测同类下拉从 6 条到
 * 922 条都有，而它决定该是 `enum` 还是 `search`）**必须写进 `unresolved`**，
 * 不能拿一个看起来很确定的 kind 蒙过去。
 *
 * | 字段 | 含义 |
 * | --- | --- |
 * | `basis` | `control` = 从带绑定的控件标签判出来的；`default-value` = 控件判不出值形状，退回按表单初值判 |
 * | `controlTag` | 承载绑定的那个标签（`a-input-number` / `portal-hxr-select-user-department` …） |
 * | `controlFamily` | 控件家族，见生成器 §2.4 的 `CONTROL_FAMILIES` |
 * | `unresolved` | 还没判完的那部分（人补清单）；判定了就是 `null` |
 * | `conditional` | 控件在，但所在表单项带 `v-if`（按账号/条件渲染，实测 tenantName 只对 admin 显示） |
 */
export type BatchParamKindEvidence = {
  name: string
  kind: ParamKind
  basis: 'control' | 'default-value'
  controlTag: string | null
  controlFamily: string | null
  /** 日期控件的值格式（`value-format`，如 `YYYY-MM`）；不是日期控件时为 null */
  valueFormat: string | null
  unresolved: string | null
  /** `unresolved` 的一句话版本（逐页 issue 里用，完整理由在 `unresolved`） */
  unresolvedShort: string | null
  conditional: boolean
}

/**
 * 从**能力参数**里剔掉的参数：它是"这一页是哪一页"的定义，不是用户能拨的筛选条件。
 *
 * **它仍然在 `query` 里**——`query` 是 wire 契约，浏览器发什么就记什么。剔掉的只是
 * 给 AI 看的那份：实测 `isArchived=0` 与"不传"完全等价，拨一下不报错、不提示，
 * 静默换一批数据（同接口实测 105 条 vs 118 条）。
 */
export type BatchDroppedParam = {
  name: string
  defaultValue: string | number | boolean | null | readonly unknown[]
  reason: string
}

/** 一页列表接口的请求契约。`CapabilityDefinition` 只够给 AI 看，这个才是能发请求的部分。 */
export type BatchEndpoint = {
  capabilityId: string
  pagePath: string
  title: string
  domain: string
  moduleType: number | null
  method: 'get'
  /** 补前缀之前的原始路径 */
  url: string
  /** 浏览器里真正会发出的路径（已按该实例自己的 urlRewrite 改写） */
  resolvedPath: string
  /** 该请求的 baseURL 环境变量名 */
  baseUrlEnv: string
  /**
   * 列表请求用的 **http 实例 id**（`platform` / `sale` / `crm` …），
   * 由 `src/context/http-instance.ts` 的 `resolveHttpInstance()` 判定，本生成物只是它的快照。
   * 判"在不在范围内"就看它——**不是**看 httpModule。
   */
  httpInstance: string
  /** 实例画像里的 file:line（`app/portal/utils/http/sale.js:8-12`），复核用 */
  httpInstanceSource: string | null
  /**
   * 实例是哪条规则判出来的：
   * `global-default` = 页面没声明，走 main.js 注入的 `platform`；
   * `page-rule` = 页面规则表命中（含简写属性、`as` 别名、省略 `.js` 后缀、局部常量转发）；
   * `declared` = 本次调用显式指定；
   * `preset` = `useListPageModule` 本身从 preset import，实例写死在 preset 文件里。
   */
  httpMatchedBy: 'declared' | 'page-rule' | 'global-default' | 'preset'
  /**
   * 实例所在的**源码文件**（`sale.js`）。与 `httpInstance` 是两个维度：
   * 一个文件可以导出两个实例（`zhdj-cms.js` 的 `http` 与 `httpLay`）。
   */
  httpModule: string
  /**
   * http 实例从哪来。`global-default` = 页面没声明 http，走 main.js 注入的 platform；
   * `explicit` = 页面（或它用的 preset）自己指定了某个 http 实例。
   * 这两者的 baseURL、补前缀规则、分页参数名都可能不同，不能混为一谈。
   */
  httpSource: 'global-default' | 'explicit'
  /** 分页参数名；为 null 表示该接口不分页 */
  pageParam: string | null
  sizeParam: string | null
  /** URL 里写死的 query（不来自 form），在 params 之前合并 */
  staticQuery: BatchQueryParam[]
  /** 完整 query 顺序 */
  query: BatchQueryParam[]
  /**
   * 每个**能力参数**的 kind 判据，按名字与 `params` 一一对应（分页参数不在其中——
   * 它们在页面上是分页器、不是表单控件，没有"控件类型"这一问）。
   */
  paramKindEvidence: BatchParamKindEvidence[]
  /** 判成「页面定义」而没进 `params` 的参数。`query` 里仍然有它们。 */
  paramsDropped: BatchDroppedParam[]
  /**
   * **范围**：走 `platform` 是 `in-scope`（决策 D3 只做 Portal 主后端），走别的实例是
   * `out-of-scope`；`unresolved` = 实例没解出来（此时一律不可接线）。
   *
   * 这个字段与 `verdict` **正交**：一页可以既 `auto` 又 `out-of-scope`，
   * 那时它的问题不是"人补得不够"，是范围决策的结果。接线只看 `scope === 'in-scope'`。
   */
  scope: 'in-scope' | 'out-of-scope' | 'unresolved'
  /**
   * 菜单范围：只有固定范围模型中 included + callable 的菜单页才允许进入 SDK。
   * 它与 http 实例范围正交；平台实例上的范围外菜单也不能因为后端相同而被接入。
   */
  menuScope: 'retained' | 'outside' | 'unknown'
  /** 抽取判定。见生成器里 partialKind 的四档说明。 */
  verdict: 'auto' | 'partial' | 'failed'
  /** verdict 为 partial 时，缺的是哪一层 */
  partialKind?: 'contract' | 'base' | 'path' | 'defaults'
  /** 抽取过程中发现的问题（人补清单）。以 `范围外：` 开头的表示不可接线。 */
  issues: string[]
}

/** 生成这批定义时用的输入快照，用于判断"生成物是不是过期了" */
export const BATCH_GENERATED_META = {
  "portalRepo": "/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js",
  "catalogContentHash": "7ccdb8523a53",
  "pageCatalogTotal": 993,
  "declarativeTotal": 240,
  "endpointCount": 19,
  "inScopeAutoCount": 10,
  "contentHash": "fd4f5a3ca050"
} as const


/** 按 capabilityId 索引的请求契约。失败的页面不进这里（宁可缺席，不给错路径）。 */
export const BATCH_ENDPOINTS: Record<string, BatchEndpoint> = {
  "batch:meeting-room-list": {
    capabilityId: "batch:meeting-room-list",
    pagePath: "/dashboard/meeting-room/list",
    title: "会议室",
    domain: "meeting-room",
    moduleType: null,
    method: 'get',
    url: "/admin-api/hr/meeting-room/page",
    resolvedPath: "/admin-api/hr/meeting-room/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "authorizedOrgId", defaultValue: null, kind: "undefined" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "authorizedOrgId", kind: "tree", basis: "control", controlTag: "portal-hxr-tree-select-role-organization-tree", controlFamily: "tree", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [],
  },
  "batch:platform-intelligence-prompt-intent-list": {
    capabilityId: "batch:platform-intelligence-prompt-intent-list",
    pagePath: "/dashboard/platform/intelligence/prompt/intent/list",
    title: "意图列表",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/admin-api/system/intent/page",
    resolvedPath: "/admin-api/system/intent/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [],
  },
  "batch:platform-intelligence-prompt-type-list": {
    capabilityId: "batch:platform-intelligence-prompt-type-list",
    pagePath: "/dashboard/platform/intelligence/prompt/type/list",
    title: "提示词类型",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/admin-api/system/tip-type/page",
    resolvedPath: "/admin-api/system/tip-type/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "label", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "label", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [],
  },
  "batch:org-org-propType-list": {
    capabilityId: "batch:org-org-propType-list",
    pagePath: "/dashboard/org/org-propType/list",
    title: "组织属性",
    domain: "org",
    moduleType: 11,
    method: 'get',
    url: "/admin-api/hr/org/organizationProperty/page",
    resolvedPath: "/admin-api/hr/org/organizationProperty/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [],
  },
  "batch:attendance-attendance-sheet-list": {
    capabilityId: "batch:attendance-attendance-sheet-list",
    pagePath: "/dashboard/attendance/attendance-sheet/list",
    title: "考勤统计",
    domain: "attendance",
    moduleType: 11,
    method: 'get',
    url: "/org/hrAttendanceSheet/page",
    resolvedPath: "/admin-api/org/hrAttendanceSheet/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "departmentId", defaultValue: null, kind: "null" },
    { name: "organizationId", defaultValue: null, kind: "null" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "departmentId", kind: "search", basis: "control", controlTag: "portal-hxr-select-user-department", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "organizationId", kind: "search", basis: "control", controlTag: "portal-hxr-select-user-department", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [
    "参数类型留了 2 处要人补：departmentId（下拉的候选规模未测）；organizationId（下拉的候选规模未测）",
  ],
  },
  "batch:assignment-assignment-list": {
    capabilityId: "batch:assignment-assignment-list",
    pagePath: "/dashboard/assignment/assignment/list",
    title: "作业管理",
    domain: "assignment",
    moduleType: 12,
    method: 'get',
    url: "/study/assignment/studyassignment/page",
    resolvedPath: "/admin-api/study/assignment/studyassignment/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "title", defaultValue: "", kind: "string" },
    { name: "status", defaultValue: "", kind: "string" },
    { name: "type", defaultValue: "", kind: "string" },
    { name: "date", defaultValue: [], kind: "date-range" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "title", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "status", kind: "search", basis: "control", controlTag: "portal-education-dict-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "type", kind: "search", basis: "control", controlTag: "portal-education-dict-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "date", kind: "date", basis: "control", controlTag: "a-range-picker", controlFamily: "date-range", valueFormat: null, unresolved: "页面上是日期区间控件（一个控件对应两个值），ParamKind 只有 `date` 这一个值，表达不了区间——SDK 侧的类型缺口，接线前要定口径；该控件标签上没有 `value-format`：这个日期该传什么格式（YYYY-MM / YYYY-MM-DD …）源码里没有，接线前必须实测", unresolvedShort: "日期区间控件的两个值，ParamKind 表达不了；日期格式未确认", conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "partial",
    partialKind: "contract",
    issues: [
    "该页调用 convertFetchForm 改写请求参数：真实 query 与 form 字段**不一致**，必须人读那段函数才能定契约（清单的 customLoad 行数统计抓不到它）",
    "参数类型留了 3 处要人补：status（下拉的候选规模未测）；type（下拉的候选规模未测）；date（日期区间控件的两个值，ParamKind 表达不了；日期格式未确认）",
  ],
  },
  "batch:platform-activity-monitor-list": {
    capabilityId: "batch:platform-activity-monitor-list",
    pagePath: "/dashboard/platform/activity/monitor/list",
    title: "优惠券监控",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/mall-manage-api/sys/coupon/page",
    resolvedPath: "/mall-manage-api/sys/coupon/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: null, kind: "null" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "shopName", defaultValue: null, kind: "null" },
    { name: "placementStatus", defaultValue: null, kind: "null" },
    { name: "shopFilterType", defaultValue: null, kind: "expression" },
    { name: "isOpenToPublic", defaultValue: null, kind: "expression" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "shopName", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "order", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "placementStatus", kind: "search", basis: "control", controlTag: "portal-platform-dict-mall-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
    ],
    paramsDropped: [
      { name: "shopFilterType", defaultValue: null, reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
      { name: "isOpenToPublic", defaultValue: null, reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
    ],
    scope: "in-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "defaults",
    issues: [
    "文件 import 的是 platform-mall-admin.js，但列表请求没传 http，实际走全局默认 platform.js（baseURL=VITE_ZHDJ_PLATFORM_API，分页名 pageSize）",
    "form.shopFilterType 的初值是运行时表达式（isMarketPage.value ? 2 : isPlatformPage.），静态只能给个空默认",
    "form.isOpenToPublic 的初值是运行时表达式（isPlatformPage.value ? 1 : null），静态只能给个空默认",
    "已从能力参数里剔掉 2 个页面定义（shopFilterType、isOpenToPublic）：页面上没有控件绑定到它们，wire 契约照旧按浏览器发。",
    "参数类型留了 2 处要人补：order（下拉的候选规模未测）；placementStatus（下拉的候选规模未测）",
  ],
  },
  "batch:platform-category-classify-sort-list": {
    capabilityId: "batch:platform-category-classify-sort-list",
    pagePath: "/dashboard/platform/category/classify/sort/list",
    title: "品类管理",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/mall-manage-api/sys/categoryCat/getTree",
    resolvedPath: "/mall-manage-api/sys/categoryCat/getTree",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
  ],
    paramKindEvidence: [],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "outside",
    verdict: "auto",
    issues: [
    "文件 import 的是 platform-mall-admin.js，但列表请求没传 http，实际走全局默认 platform.js（baseURL=VITE_ZHDJ_PLATFORM_API，分页名 pageSize）",
    "getDataListIsPage 缺省（=false）：该接口不传分页参数",
    "没有 form：查询参数只有 order/orderField（复用现有模块，不新增依赖）",
  ],
  },
  "batch:platform-goods-distribution-list": {
    capabilityId: "batch:platform-goods-distribution-list",
    pagePath: "/dashboard/platform/goods/distribution/list",
    title: "商品授权",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/mall-manage-api/sys/itemDistribute/list",
    resolvedPath: "/mall-manage-api/sys/itemDistribute/list",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "desc", kind: "string" },
    { name: "orderField", defaultValue: "itemId", kind: "string" },
    { name: "view", defaultValue: 0, kind: "number" },
    { name: "bn", defaultValue: "", kind: "string" },
    { name: "brandName", defaultValue: "", kind: "string" },
    { name: "shopName", defaultValue: "", kind: "string" },
    { name: "title", defaultValue: "", kind: "string" },
    { name: "catId", defaultValue: null, kind: "expression" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "view", kind: "enum", basis: "control", controlTag: "a-tabs", controlFamily: "view-switcher", valueFormat: null, unresolved: "页签/统计条的键没从源码里提取，接线前要确认它是不是小集合", unresolvedShort: "页签键未提取", conditional: false },
      { name: "bn", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "brandName", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "shopName", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "title", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "orderField", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "order", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "catId", kind: "text", basis: "default-value", controlTag: null, controlFamily: null, valueFormat: null, unresolved: "页面上有 <a-form-item name=\"catId\">，但里面的控件不是绑到 `formState.catId` 上的（实测有绑脚本变量再由 convertFetchForm 换算的写法），值形状与默认值都须人工确认", unresolvedShort: "控件绑在脚本变量上", conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "defaults",
    issues: [
    "文件 import 的是 platform-mall-admin.js，但列表请求没传 http，实际走全局默认 platform.js（baseURL=VITE_ZHDJ_PLATFORM_API，分页名 pageSize）",
    "form 由 computed() 包裹：已在源码内解出，等价于字面量对象，建议人工复核",
    "form.catId 的初值是运行时表达式（catId.value ? catId.value[catId.value.le），静态只能给个空默认",
    "参数类型留了 4 处要人补：view（页签键未提取）；orderField（下拉的候选规模未测）；order（下拉的候选规模未测）；catId（控件绑在脚本变量上）",
  ],
  },
  "batch:sale-customer-service-after-sale-list": {
    capabilityId: "batch:sale-customer-service-after-sale-list",
    pagePath: "/dashboard/sale/customer-service/after-sale/list",
    title: "订单售后列表",
    domain: "sale",
    moduleType: 60,
    method: 'get',
    url: "/admin/aftersales/page",
    resolvedPath: "/admin/aftersales/page",
    baseUrlEnv: "VITE_SHOP_ADMIN_API",
    httpInstance: "sale",
    httpInstanceSource: "app/portal/utils/http/sale.js:8-12",
    httpMatchedBy: "page-rule",
    httpModule: "sale.js",
    httpSource: "explicit",
    pageParam: "pageNo",
    sizeParam: "limit",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "itemTitle", defaultValue: "", kind: "string" },
    { name: "tid", defaultValue: "", kind: "string" },
    { name: "handledFlag", defaultValue: 0, kind: "number" },
    { name: "endDate", defaultValue: null, kind: "null" },
    { name: "startDate", defaultValue: null, kind: "null" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "limit", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "itemTitle", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "tid", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "handledFlag", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "endDate", kind: "date", basis: "control", controlTag: "a-date-picker", controlFamily: "date", valueFormat: "YYYY-MM-DD", unresolved: null, unresolvedShort: null, conditional: false },
      { name: "startDate", kind: "date", basis: "control", controlTag: "a-date-picker", controlFamily: "date", valueFormat: "YYYY-MM-DD", unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "out-of-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "base",
    issues: [
    "范围外：列表请求走 sale 实例（sale.js，baseURL=VITE_SHOP_ADMIN_API），不属于 SDK 的 Portal 主后端范围（决策 D3）。接到 SDK 里会打到错的 URL，所以这条定义不可接线。",
    "该页走 sale.js，它没有 platform.js 的补前缀拦截器：真实路径就是 /admin/aftersales/page（VITE_SHOP_ADMIN_API 是另一个 base，SDK 现有单 base 客户端调不到）",
    "sale 实例的拦截器把 pageSize 改名成 limit，所以这一页的真实分页参数是 limit，不是全局的 pageSize",
    "参数类型留了 1 处要人补：handledFlag（下拉的候选规模未测）",
  ],
  },
  "batch:sale-goods-classification-list": {
    capabilityId: "batch:sale-goods-classification-list",
    pagePath: "/dashboard/sale/goods/classification/list",
    title: "店铺商品分类",
    domain: "sale",
    moduleType: 60,
    method: 'get',
    url: "/admin/itemCat/list",
    resolvedPath: "/admin/itemCat/list",
    baseUrlEnv: "VITE_SHOP_ADMIN_API",
    httpInstance: "sale",
    httpInstanceSource: "app/portal/utils/http/sale.js:8-12",
    httpMatchedBy: "page-rule",
    httpModule: "sale.js",
    httpSource: "explicit",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
  ],
    paramKindEvidence: [],
    paramsDropped: [],
    scope: "out-of-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "base",
    issues: [
    "范围外：列表请求走 sale 实例（sale.js，baseURL=VITE_SHOP_ADMIN_API），不属于 SDK 的 Portal 主后端范围（决策 D3）。接到 SDK 里会打到错的 URL，所以这条定义不可接线。",
    "该页走 sale.js，它没有 platform.js 的补前缀拦截器：真实路径就是 /admin/itemCat/list（VITE_SHOP_ADMIN_API 是另一个 base，SDK 现有单 base 客户端调不到）",
    "getDataListIsPage 缺省（=false）：该接口不传分页参数",
  ],
  },
  "batch:sale-goods-distribution-list": {
    capabilityId: "batch:sale-goods-distribution-list",
    pagePath: "/dashboard/sale/goods/distribution/list",
    title: "一键铺货",
    domain: "sale",
    moduleType: 60,
    method: 'get',
    url: "admin/item/itemCopyList",
    resolvedPath: "/admin/item/itemCopyList",
    baseUrlEnv: "VITE_SHOP_ADMIN_API",
    httpInstance: "sale",
    httpInstanceSource: "app/portal/utils/http/sale.js:8-12",
    httpMatchedBy: "page-rule",
    httpModule: "sale.js",
    httpSource: "explicit",
    pageParam: "pageNo",
    sizeParam: "limit",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "catIdList", defaultValue: "", kind: "string" },
    { name: "shopName", defaultValue: "", kind: "string" },
    { name: "title", defaultValue: "", kind: "string" },
    { name: "distributeStatus", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "limit", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "catIdList", kind: "enum", basis: "control", controlTag: "portal-sale-table-statistic", controlFamily: "view-switcher", valueFormat: null, unresolved: "页签/统计条的键没从源码里提取，接线前要确认它是不是小集合", unresolvedShort: "页签键未提取", conditional: false },
      { name: "shopName", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "title", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "distributeStatus", kind: "search", basis: "control", controlTag: "common-select-dropdown", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
    ],
    paramsDropped: [],
    scope: "out-of-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "path",
    issues: [
    "范围外：列表请求走 sale 实例（sale.js，baseURL=VITE_SHOP_ADMIN_API），不属于 SDK 的 Portal 主后端范围（决策 D3）。接到 SDK 里会打到错的 URL，所以这条定义不可接线。",
    "URL 漏写前导斜杠（admin/item/itemCopyList）：axios 会按 baseURL 相对解析，需人工确认",
    "sale 实例的拦截器把 pageSize 改名成 limit，所以这一页的真实分页参数是 limit，不是全局的 pageSize",
    "参数类型留了 2 处要人补：catIdList（页签键未提取）；distributeStatus（下拉的候选规模未测）",
  ],
  },
  "batch:sale-trade-logistics-company-list": {
    capabilityId: "batch:sale-trade-logistics-company-list",
    pagePath: "/dashboard/sale/trade/logistics-company/list",
    title: "物流公司",
    domain: "sale",
    moduleType: 60,
    method: 'get',
    url: "/admin/shopDlyCorp/list",
    resolvedPath: "/admin/shopDlyCorp/list",
    baseUrlEnv: "VITE_SHOP_ADMIN_API",
    httpInstance: "sale",
    httpInstanceSource: "app/portal/utils/http/sale.js:8-12",
    httpMatchedBy: "page-rule",
    httpModule: "sale.js",
    httpSource: "explicit",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "tid", defaultValue: "", kind: "string" },
    { name: "date", defaultValue: [], kind: "date-range" },
    { name: "progress", defaultValue: "", kind: "string" },
  ],
    paramKindEvidence: [],
    paramsDropped: [
      { name: "tid", defaultValue: "", reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
      { name: "date", defaultValue: [], reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
      { name: "progress", defaultValue: "", reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
    ],
    scope: "out-of-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "base",
    issues: [
    "范围外：列表请求走 sale 实例（sale.js，baseURL=VITE_SHOP_ADMIN_API），不属于 SDK 的 Portal 主后端范围（决策 D3）。接到 SDK 里会打到错的 URL，所以这条定义不可接线。",
    "该页走 sale.js，它没有 platform.js 的补前缀拦截器：真实路径就是 /admin/shopDlyCorp/list（VITE_SHOP_ADMIN_API 是另一个 base，SDK 现有单 base 客户端调不到）",
    "getDataListIsPage: false：该接口不传分页参数",
    "已从能力参数里剔掉 3 个页面定义（tid、date、progress）：页面上没有控件绑定到它们，wire 契约照旧按浏览器发。",
  ],
  },
  "batch:platform-setting-category-dict-list": {
    capabilityId: "batch:platform-setting-category-dict-list",
    pagePath: "/dashboard/platform/setting/category-dict/list",
    title: "分类字典",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/adminmanage-api/system/category-dict/tree",
    resolvedPath: "/adminmanage-api/system/category-dict/tree",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "code", defaultValue: "", kind: "string" },
  ],
    paramKindEvidence: [
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "code", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [
    "URL 由模板串拼接，插值常量已在源码内解出，建议人工复核一次",
    "getDataListIsPage 缺省（=false）：该接口不传分页参数",
  ],
  },
  "batch:course-text-course-list": {
    capabilityId: "batch:course-text-course-list",
    pagePath: "/dashboard/course/text-course/list",
    title: "图文课程",
    domain: "course",
    moduleType: 12,
    method: 'get',
    url: "/study/course/studycourse/courseList",
    resolvedPath: "/admin-api/study/course/studycourse/courseList",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [
    { name: "type", defaultValue: "1", kind: "string" },
  ],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "keyword", defaultValue: "", kind: "string" },
    { name: "date", defaultValue: [], kind: "date-range" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "keyword", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "date", kind: "date", basis: "control", controlTag: "a-range-picker", controlFamily: "date-range", valueFormat: null, unresolved: "页面上是日期区间控件（一个控件对应两个值），ParamKind 只有 `date` 这一个值，表达不了区间——SDK 侧的类型缺口，接线前要定口径；该控件标签上没有 `value-format`：这个日期该传什么格式（YYYY-MM / YYYY-MM-DD …）源码里没有，接线前必须实测", unresolvedShort: "日期区间控件的两个值，ParamKind 表达不了；日期格式未确认", conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "partial",
    partialKind: "contract",
    issues: [
    "URL 自带 query（type=1）：这些参数不来自 form，需人工确认是否算能力参数",
    "该页调用 convertFetchForm 改写请求参数：真实 query 与 form 字段**不一致**，必须人读那段函数才能定契约（清单的 customLoad 行数统计抓不到它）",
    "参数类型留了 1 处要人补：date（日期区间控件的两个值，ParamKind 表达不了；日期格式未确认）",
  ],
  },
  "batch:platform-report-sale-trade-list": {
    capabilityId: "batch:platform-report-sale-trade-list",
    pagePath: "/dashboard/platform/report/sale/trade/list",
    title: "交易数据统计",
    domain: "platform",
    moduleType: null,
    method: 'get',
    url: "/mall-manage-api/sys/statement/getTradeStatement",
    resolvedPath: "/mall-manage-api/sys/statement/getTradeStatement",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "startDate", defaultValue: null, kind: "null" },
    { name: "endDate", defaultValue: null, kind: "null" },
    { name: "from", defaultValue: "all", kind: "string" },
    { name: "timeStep", defaultValue: 1, kind: "number" },
    { name: "timePeriod", defaultValue: null, kind: "expression" },
    { name: "shopFilterType", defaultValue: null, kind: "expression" },
    { name: "isOpenToPublic", defaultValue: null, kind: "expression" },
  ],
    paramKindEvidence: [
      { name: "startDate", kind: "date", basis: "control", controlTag: "a-date-picker", controlFamily: "date", valueFormat: "YYYY-MM-DD", unresolved: null, unresolvedShort: null, conditional: false },
      { name: "endDate", kind: "date", basis: "control", controlTag: "a-date-picker", controlFamily: "date", valueFormat: "YYYY-MM-DD", unresolved: null, unresolvedShort: null, conditional: false },
      { name: "from", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "timeStep", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
      { name: "timePeriod", kind: "search", basis: "control", controlTag: "a-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
    ],
    paramsDropped: [
      { name: "shopFilterType", defaultValue: null, reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
      { name: "isOpenToPublic", defaultValue: null, reason: "页面定义，不是筛选条件：它只出现在 form 初值里、或只被 `v-if`/赋值用到——页面上找不到任何控件绑定到它，而且没有对应的 `<a-form-item>`。" },
    ],
    scope: "in-scope",
    menuScope: "outside",
    verdict: "partial",
    partialKind: "defaults",
    issues: [
    "getDataListIsPage 缺省（=false）：该接口不传分页参数",
    "form 由 computed() 包裹：已在源码内解出，等价于字面量对象，建议人工复核",
    "form.timePeriod 的初值是运行时表达式（timePeriodDefault），静态只能给个空默认",
    "form.shopFilterType 的初值是运行时表达式（isMarketPage.value ? 2 : isPlatformPage.），静态只能给个空默认",
    "form.isOpenToPublic 的初值是运行时表达式（isPlatformPage.value ? 1 : null），静态只能给个空默认",
    "已从能力参数里剔掉 2 个页面定义（shopFilterType、isOpenToPublic）：页面上没有控件绑定到它们，wire 契约照旧按浏览器发。",
    "参数类型留了 3 处要人补：from（下拉的候选规模未测）；timeStep（下拉的候选规模未测）；timePeriod（下拉的候选规模未测）",
  ],
  },
  "batch:manage-insurance-list": {
    capabilityId: "batch:manage-insurance-list",
    pagePath: "/dashboard/manage/insurance/list",
    title: "五险一金",
    domain: "manage",
    moduleType: 13,
    method: 'get',
    url: "/performance/basedata/hrinsurancefund/page",
    resolvedPath: "/admin-api/performance/basedata/hrinsurancefund/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "pageSize",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "idcard", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "pageSize", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "idcard", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [
    "form 由 computed() 包裹：已在源码内解出，等价于字面量对象，建议人工复核",
  ],
  },
  "batch:finance-setting-cat-map-list": {
    capabilityId: "batch:finance-setting-cat-map-list",
    pagePath: "/dashboard/finance/setting/cat-map/list",
    title: "类目对照表",
    domain: "finance",
    moduleType: null,
    method: 'get',
    url: "/admin-api/finance/thing-category/page",
    resolvedPath: "/admin-api/finance/thing-category/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: null,
    sizeParam: null,
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
  ],
    paramKindEvidence: [],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [
    "getDataListIsPage: false：该接口不传分页参数",
    "没有 form：查询参数只有 order/orderField（复用现有模块，不新增依赖）",
  ],
  },
  "batch:flow-old-model-list": {
    capabilityId: "batch:flow-old-model-list",
    pagePath: "/dashboard/flow/old/model/list",
    title: "流程模型 双赢协议",
    domain: "flow",
    moduleType: null,
    method: 'get',
    url: "/bpm/hr/model/page",
    resolvedPath: "/admin-api/bpm/hr/model/page",
    baseUrlEnv: "VITE_ZHDJ_PLATFORM_API",
    httpInstance: "platform",
    httpInstanceSource: "app/portal/utils/http/platform.js:8-12",
    httpMatchedBy: "global-default",
    httpModule: "platform.js",
    httpSource: "global-default",
    pageParam: "pageNo",
    sizeParam: "limit",
    staticQuery: [],
    query: [
    { name: "order", defaultValue: "", kind: "string" },
    { name: "orderField", defaultValue: "", kind: "string" },
    { name: "key", defaultValue: "", kind: "string" },
    { name: "name", defaultValue: "", kind: "string" },
    { name: "category", defaultValue: "", kind: "string" },
    { name: "pageNo", defaultValue: 1, kind: "number" },
    { name: "limit", defaultValue: 20, kind: "number" },
  ],
    paramKindEvidence: [
      { name: "key", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "name", kind: "text", basis: "control", controlTag: "a-input", controlFamily: "text", valueFormat: null, unresolved: null, unresolvedShort: null, conditional: false },
      { name: "category", kind: "search", basis: "control", controlTag: "portal-hxr-dict-select", controlFamily: "lazy-options", valueFormat: null, unresolved: "页面上是下拉，但**候选规模在源码里不存在**（实测同类下拉从 6 条到 922 条都有），`enum` / `search` / `tree` 三者择一只能运行时测；这里按 D6 与\"算不出就失败关闭\"的既有口径取保守值 `search`（先向用户要关键字）", unresolvedShort: "下拉的候选规模未测", conditional: false },
    ],
    paramsDropped: [],
    scope: "in-scope",
    menuScope: "retained",
    verdict: "auto",
    issues: [
    "该页单独覆写了 fieldNamePageSize → limit，与全局默认不同",
    "参数类型留了 1 处要人补：category（下拉的候选规模未测）",
  ],
  },
}

/** 可直接喂给 createCatalog() / portal.capabilities 的能力定义。 */
export const BATCH_CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "batch:meeting-room-list",
    title: "查询会议室",
    pagePath: "/dashboard/meeting-room/list",
    permission: "/dashboard/meeting-room",
    write: true,
    params: [
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "authorizedOrgId", kind: "tree", required: false, description: "authorizedOrgId，默认不传（表单初值为 undefined）；页面上是树形选择" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:platform-intelligence-prompt-intent-list",
    title: "查询意图列表",
    pagePath: "/dashboard/platform/intelligence/prompt/intent/list",
    permission: "/dashboard/platform-v2/intelligence/prompt/intent",
    write: false,
    params: [
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:platform-intelligence-prompt-type-list",
    title: "查询提示词类型",
    pagePath: "/dashboard/platform/intelligence/prompt/type/list",
    permission: "/dashboard/platform-v2/intelligence/prompt/type",
    write: false,
    params: [
      { name: "label", kind: "text", required: false, description: "label，默认空" },
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:org-org-propType-list",
    title: "查询组织属性",
    pagePath: "/dashboard/org/org-propType/list",
    permission: "/dashboard/org/org-propType",
    write: true,
    params: [
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:attendance-attendance-sheet-list",
    title: "查询考勤统计",
    pagePath: "/dashboard/attendance/attendance-sheet/list",
    permission: "/dashboard/attendance/attendance-sheet",
    write: false,
    params: [
      { name: "departmentId", kind: "search", required: false, description: "departmentId，默认不传（表单初值为 null）；页面上是下拉选择" },
      { name: "organizationId", kind: "search", required: false, description: "organizationId，默认不传（表单初值为 null）；页面上是下拉选择" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:assignment-assignment-list",
    title: "查询作业管理",
    pagePath: "/dashboard/assignment/assignment/list",
    permission: "/dashboard/assignment/assignment",
    write: true,
    params: [
      { name: "title", kind: "text", required: false, description: "title，默认空" },
      { name: "status", kind: "search", required: false, description: "status，默认空；页面上是下拉选择" },
      { name: "type", kind: "search", required: false, description: "type，默认空；页面上是下拉选择" },
      { name: "date", kind: "date", required: false, description: "date，日期区间（表单初值为空数组）；页面上是日期区间控件" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:platform-activity-monitor-list",
    title: "查询优惠券监控",
    pagePath: "/dashboard/platform/activity/monitor/list",
    permission: "/dashboard/platform/activity/monitor",
    write: false,
    params: [
      { name: "shopName", kind: "text", required: false, description: "shopName，默认不传（表单初值为 null）" },
      { name: "order", kind: "search", required: false, description: "order，默认不传（表单初值为 null）；页面上是下拉选择" },
      { name: "placementStatus", kind: "search", required: false, description: "placementStatus，默认不传（表单初值为 null）；页面上是下拉选择" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:platform-category-classify-sort-list",
    title: "查询品类管理",
    pagePath: "/dashboard/platform/category/classify/sort/list",
    permission: "/dashboard/platform-v2/category/classify/sort",
    write: false,
    params: [],
  },
  {
    id: "batch:platform-goods-distribution-list",
    title: "查询商品授权",
    pagePath: "/dashboard/platform/goods/distribution/list",
    permission: "/dashboard/platform-v2/goods/distribution",
    write: false,
    params: [
      { name: "view", kind: "enum", required: false, description: "view，默认 0；页面上是页签切换（切它会换一批数据）" },
      { name: "bn", kind: "text", required: false, description: "bn，默认空" },
      { name: "brandName", kind: "text", required: false, description: "brandName，默认空" },
      { name: "shopName", kind: "text", required: false, description: "shopName，默认空" },
      { name: "title", kind: "text", required: false, description: "title，默认空" },
      { name: "orderField", kind: "search", required: false, description: "orderField，默认 itemId；页面上是下拉选择" },
      { name: "order", kind: "search", required: false, description: "order，默认 desc；页面上是下拉选择" },
      { name: "catId", kind: "text", required: false, description: "catId，初值由页面运行时表达式算出，需人工确认" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:sale-customer-service-after-sale-list",
    title: "查询订单售后列表",
    pagePath: "/dashboard/sale/customer-service/after-sale/list",
    permission: "/dashboard/sale/customer-service/after-sale",
    write: false,
    params: [
      { name: "itemTitle", kind: "text", required: false, description: "itemTitle，默认空" },
      { name: "tid", kind: "text", required: false, description: "tid，默认空" },
      { name: "handledFlag", kind: "search", required: false, description: "handledFlag，默认 0；页面上是下拉选择" },
      { name: "endDate", kind: "date", required: false, description: "endDate，默认不传（表单初值为 null）；页面上是日期控件（值格式 YYYY-MM-DD）" },
      { name: "startDate", kind: "date", required: false, description: "startDate，默认不传（表单初值为 null）；页面上是日期控件（值格式 YYYY-MM-DD）" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "limit", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:sale-goods-classification-list",
    title: "查询店铺商品分类",
    pagePath: "/dashboard/sale/goods/classification/list",
    permission: "/dashboard/sale/goods/classification",
    write: true,
    params: [],
  },
  {
    id: "batch:sale-goods-distribution-list",
    title: "查询一键铺货",
    pagePath: "/dashboard/sale/goods/distribution/list",
    permission: "/dashboard/sale/goods/distribution",
    write: false,
    params: [
      { name: "catIdList", kind: "enum", required: false, description: "catIdList，默认空；页面上是页签切换（切它会换一批数据）" },
      { name: "shopName", kind: "text", required: false, description: "shopName，默认空" },
      { name: "title", kind: "text", required: false, description: "title，默认空" },
      { name: "distributeStatus", kind: "search", required: false, description: "distributeStatus，默认空；页面上是下拉选择" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "limit", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:sale-trade-logistics-company-list",
    title: "查询物流公司",
    pagePath: "/dashboard/sale/trade/logistics-company/list",
    permission: "/dashboard/sale/trade/logistics-company",
    write: true,
    params: [],
  },
  {
    id: "batch:platform-setting-category-dict-list",
    title: "查询分类字典",
    pagePath: "/dashboard/platform/setting/category-dict/list",
    permission: "/dashboard/platform-v2/setting/category-dict",
    write: true,
    params: [
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "code", kind: "text", required: false, description: "code，默认空" },
    ],
  },
  {
    id: "batch:course-text-course-list",
    title: "查询图文课程",
    pagePath: "/dashboard/course/text-course/list",
    permission: "/dashboard/course/text-course",
    write: true,
    params: [
      { name: "keyword", kind: "text", required: false, description: "keyword，默认空" },
      { name: "date", kind: "date", required: false, description: "date，日期区间（表单初值为空数组）；页面上是日期区间控件" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:platform-report-sale-trade-list",
    title: "查询交易数据统计",
    pagePath: "/dashboard/platform/report/sale/trade/list",
    permission: "/dashboard/platform/report/sale/trade",
    write: false,
    params: [
      { name: "startDate", kind: "date", required: false, description: "startDate，默认不传（表单初值为 null）；页面上是日期控件（值格式 YYYY-MM-DD）" },
      { name: "endDate", kind: "date", required: false, description: "endDate，默认不传（表单初值为 null）；页面上是日期控件（值格式 YYYY-MM-DD）" },
      { name: "from", kind: "search", required: false, description: "from，默认 all；页面上是下拉选择" },
      { name: "timeStep", kind: "search", required: false, description: "timeStep，默认 1；页面上是下拉选择" },
      { name: "timePeriod", kind: "search", required: false, description: "timePeriod，初值由页面运行时表达式算出，需人工确认；页面上是下拉选择" },
    ],
  },
  {
    id: "batch:manage-insurance-list",
    title: "查询五险一金",
    pagePath: "/dashboard/manage/insurance/list",
    permission: "/dashboard/manage/insurance",
    write: false,
    params: [
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "idcard", kind: "text", required: false, description: "idcard，默认空" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "pageSize", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
  {
    id: "batch:finance-setting-cat-map-list",
    title: "查询类目对照表",
    pagePath: "/dashboard/finance/setting/cat-map/list",
    permission: "/dashboard/finance/setting/cat-map",
    write: true,
    params: [],
  },
  {
    id: "batch:flow-old-model-list",
    title: "查询流程模型 双赢协议",
    pagePath: "/dashboard/flow/old/model/list",
    permission: "/dashboard/flow/old/model/list",
    write: true,
    params: [
      { name: "key", kind: "text", required: false, description: "key，默认空" },
      { name: "name", kind: "text", required: false, description: "name，默认空" },
      { name: "category", kind: "search", required: false, description: "category，默认空；页面上是下拉选择" },
      { name: "pageNo", kind: "number", required: false, description: "页码，默认 1" },
      { name: "limit", kind: "number", required: false, description: "每页条数，默认 20" },
    ],
  },
]
