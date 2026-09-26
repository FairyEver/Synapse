import { Buffer } from 'node:buffer'

import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from '../session/types.js'
import type { PortalRequestConfig } from '../http/client.js'

/**
 * 绩效管理域「配置」下的六个页面（`moduleType = 13` 绩效管理）。
 *
 * 六页都是**配置类**页面 —— 改的是系统配置本身（公式 / 指标字典树 / 社保基数 / 标准库 /
 * 时间节点 / 扣分规则），不是业务单据。读能力和页面能到达的配置写动作都在这里登记。
 *
 * | 页面（菜单标题） | `pagePath`（= 菜单路径，逐字） | 路由文件 | 形态 | 本文件用的读接口 |
 * | --- | --- | --- | --- | --- |
 * | 公式配置 | `/dashboard/manage/formula-definition/list` | `…/hr/manage/formula-definition/list.vue` | **自定义页**（不用 `useListPageModule`） | `GET /infra/formula/definition/page` |
 * | 指标管理 | `/dashboard/manage/indicator/list` | `…/hr/manage/indicator/list.vue` | `useListPageModule` + `customLoad` | `GET /performance/basedata/kpitarget/page` |
 * | 五险一金 | `/dashboard/manage/insurance/list` | `…/hr/manage/insurance/list.vue` | `useListPageModule` + **声明式** | `GET /performance/basedata/hrinsurancefund/page` |
 * | 标准管理 | `/dashboard/manage/standard/list` | `…/hr/manage/standard/list.vue` | `useListPageModule` + `customLoad` | `GET /performance/kpistandard/treePage`（有关键词时切 `searchPage`）|
 * | 时间节点 | `/dashboard/manage/protocol-configuration/list` | `…/hr/manage/protocol-configuration/list.vue` | **纯表单页，没有列表请求** | `GET /sys/dict/type/page` + 字典 |
 * | 考核规则 | `/dashboard/manage/protocol-deduct-rule/list` | `…/hr/manage/protocol-deduct-rule/list.vue` | **自定义页**（三段只读表格） | `GET /performance/basedata/protocol-deduct-rule/list` |
 *
 * ⚠️ **菜单标题与页面自称的标题不一致**（`page-catalog.json` 的 `title` 以菜单为准，
 * 页面里的卡片标题 / 接口名是另一回事）：菜单叫「五险一金」而字段全是 `hrinsurancefund`；
 * 菜单叫「时间节点」而卡片标题写的是「协议配置」、字典名是 `protocol_config`；
 * 菜单叫「考核规则」而接口是 `protocol-deduct-rule`。**按路径找，别按标题找。**
 *
 * ## ⚠️ 本地 Portal 检出**落后于线上**：标准管理页的接口已经换过了
 *
 * `Projects_Js` 这个检出里的 `standard/list.vue` 还是**旧版**：它 `customLoad` 打
 * `GET /performance/kpistandard/standList` 并把 `templateName` 掐掉做本地过滤。
 * **测试环境上跑的不是这一版** —— 基准（`baseline/perf-manage-config.browser.json`）
 * 抓到的真实请求是：
 *
 * ```
 * GET /admin-api/performance/kpistandard/treePage?parentId=0&keyword=&selection=false&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * 线上那一版在 `2f29dd5f291`（`fix(hr): 适配树数据按层分页与回显`，2026-09-15；
 * 另有一个同内容的 `b118520eb8d`）里，同一个提交还改了薪资结构 / 岗位 / 岗位设置几页。
 * 新版把这些页统一改成**后端按层分页**：`treePage`（无关键词）/ `searchPage`（有关键词），
 * 名称筛选第一次真正下了服务端。
 *
 * **判据一律以基准为准**（本轮就是这么办的）。凡是本地源码与基准冲突的地方，
 * 先怀疑本地检出旧了：`git log --all -S <关键字>` 通常能找到线上那个改动。
 * 其余五页的基准 URL 与本地源码**逐字节吻合**，只有这一页对不上。
 *
 * ## 参数顺序是从源码推出来的，不是抄基准
 *
 * `common/libs/renren/list.js:473-483` 把列表参数拼成：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * // → customLoad(params) 直接拿去拼 URL；或 _http.get(getDataListURL, { params })
 * ```
 *
 * ⇒ 顺序恒为 **`order` → `orderField` → 表单字段 → `pageNo` → `pageSize` → `_t`**。
 * `pageNo`/`pageSize` **只在 `getDataListIsPage: true` 时才加**（`list.js:479`）——
 * 这一条是本节最容易爆的地方，因为六页里有**三页不传分页**（见下）。
 *
 * 然后 platform 实例的请求拦截器（`app/portal/utils/http/platform.js:30-84`）把参数
 * `qs.stringify(params, { allowDots: true, skipNulls: true })` 拼进 URL，并**追加 `_t`**。
 * `skipNulls: true` **同时丢掉 `null` 与 `undefined`**（qs 6.16.0 实测：
 * `{a:undefined,b:null,c:'',d:0,e:false}` → `c=&d=0&e=false`），**空字符串照发**。
 * SDK 侧 `src/http/client.ts` 用的是同一句 qs 配置，所以这一层与浏览器逐字节一致。
 *
 * ## 六页里有四处「同域不同形」（本节最容易照抄错的地方）
 *
 * 1. **`order`/`orderField` 有三页不发**：公式配置页**根本不走 `useListPageModule`**
 *    （自己写的 a-table + a-form + reactive 分页），它的参数是
 *    `{ pageNo, pageSize, ...filters }` —— `pageNo` 打头，没有 `order`。
 *    照抄隔壁五页的 `order=&orderField=` 会多两个键。
 * 2. **`pageNo`/`pageSize` 有两页不发**：`getDataListIsPage` 默认 `false`，
 *    而**指标管理**页（本地那版）的 `customLoad` 没有开它 ⇒ 它收到的参数里**没有分页**。
 *    五险一金页（`getDataListIsPage: true`）与线上版的标准管理页都有。
 *    ⚠️ 于是「两页都叫 `/xxx/page`」但一个传分页、一个不传 —— 别按接口名猜。
 * 3. **空值有两种命运**：五页的表单初值都是 `''`（照发 `name=`）；
 *    **公式配置页的两个筛选器初值是 `undefined`**（`filters = { taskType: undefined,
 *    formulaName: '', enabled: undefined }`）⇒ 首屏 URL 上**没有** `taskType` 与 `enabled`。
 * 4. **发出去的字段 ≠ 页面上看到的字段**：指标管理页的「名称」输入框绑在
 *    `formState.templateName` 上，而它的 `customLoad` 第一句是
 *    `omit(form, ['templateName'])` —— **名称只做本地过滤，从不上 URL**；
 *    表单里那个 `name` 字段**没有任何控件绑它**（恒为 `''`）。
 *    ⚠️ 标准管理页**曾经**也是这个样子，线上版已经改成发 `keyword` 了（见上）。
 *
 * ## 与后端源码核对过的地方（`Mall_Platform_Java_Dev`，2026-09-21 拉最新后读的）
 *
 * 这六页的读接口全在 `erp-module-hr` / `erp-module-infra` 里，对着 Java 源码核了四件事：
 *
 * - **指标管理页发的 `name` / `creatorName` / `type` 三个参数后端根本不认**：
 *   `KpiTargetController.page(TargetListDTO dto)` → `KpiTargetServiceImpl.selectList`
 *   → `KpiTargetDao.xml` 的 `selectAllTarget`，SQL 只用了 `status` / `creator` /
 *   `organizationCode` / `roleIdList` / `superAdmin`。同一个 XML 里确实有一处
 *   `dto.name LIKE`，但那条 select 查的是**模板表** `hr_kpi_tem_protocol` 的 `c.name`，
 *   与指标树无关 —— 指标树这条链路上 `name` 从头到尾没人读。
 *   所以这一页的「按名称筛」只能靠前端本地过滤 —— **页面把 `templateName` 掐掉不发是故意的**
 *   （这是读完后端才明白的一处，不是页面写漏了）。
 *   真正生效的筛选参数只有 `targetType`（`KpiTargetServiceImpl` 里内存过滤：
 *   保留全部文件夹 + 命中该类型的指标）。
 * - **指标管理页的分页是死的**：`page()` 返回 `List<TargetListDTO>` 而不是 `PageData`，
 *   且 `selectList` 里 `new Page<>(dto.getPageNo(), …)` 那段**被整块注释掉了** ——
 *   和后端对上了：这一页确实不该发 `pageNo`/`pageSize`。它返回的是一整棵**树**
 *   （`TreeUtils.build`），不分页。
 * - **标准管理页线上走的是新的树分页接口**：`treePage` / `searchPage`
 *   （`KpiStandardController`，注释写着「旧全树最多 1000 节点，超过时提示升级分页」）。
 *   两者的查询 DTO 是同一个 `HrBoundedTreeQueryDTO`：`parentId`（默认 0）/ `keyword` /
 *   `dataType` / `status` / `selection`（后端默认 **true**，页面显式发 `false`）/
 *   `pageNo` / `pageSize`。后端的 `normalize()` 会校验：
 *   **`pageSize` 必须在 1..100 之间、`pageNo ≥ 1`、`keyword ≤ 100 字`、`dataType ∈ {1,2}`**，
 *   违反直接 500「树查询页码必须大于0，每页数量为1至100」。
 *   线上的页面端自己也钳了一次（`Math.min(Number(form.pageSize) || 20, 100)`）。
 *   旧接口 `standList`（`StandardSelectDTO`）**线上已经不打了、本能力也不做**。
 * - **五险一金页的 `name`/`idcard` 是真筛选**：`HrInsuranceFundServiceImpl.getWrapper`
 *   是 `wrapper.like(...)`（模糊）—— 与指标/标准两页正相反，这一页的输入框是服务端筛。
 *   同页的 `pageNo`/`pageSize` 也真生效（这个仓库把 `Constant.PAGE` 定成了 `pageNo`、
 *   `Constant.LIMIT` 定成了 `pageSize`，`BaseServiceImpl.getPage()` 就按这两个名字取），
 *   `order`/`orderField` 进的是排序分支 —— 但那条分支要求**两个都非空**才 apply
 *   （`isNotBlank(orderField) && isNotBlank(order)`），页面两个都发空串 ⇒ 恒不排序。
 *
 * ## 挂载时页面会拉的东西，本能力**一个都不照抄**
 *
 * - 公式配置页挂载时除了列表还发 `GET /infra/formula/scene/list`（**无任何参数**，
 *   取任务类型候选）。它本身不是"几千条的长选项"，但也不是列表请求 ——
 *   单独给一个 `listFormulaScenes()`，**不并进列表能力**。
 * - 时间节点页挂载时发两条 `GET /sys/dict/type/page?dictType=…`，只为拿**字典类型的 id**
 *   （保存时当 `dictTypeId` 用）。页面上**显示**的那 8 个时间节点值来自全局字典 store
 *   （`fetchAllDicts()` → `GET /system/dict-data/grouped-list`，**不是这一页自己发的**）。
 *   本能力读的是后者（`readProtocolConfig`），前者另给 `getDictTypeId()` 备查。
 * - 五险一金页有导出（`exportURL`，带 token 的下载链接）与导入，都不是 JSON 接口。
 *
 * ## 日期区间：这六页**一处都没有**
 *
 * 没有 `a-range-picker`，也就没有「结束日 +1 天还是闭区间」的问题 ——
 * 本文件因此**不需要** `buildXxxTimeRange()`。时间节点页那 8 个控件是
 * `every-year-date`（`MM-DD` 级联）/ `every-month-date`（`DD` 下拉，含 `'99'` = 每月最后一天），
 * 存进字典的是 `MM-DD 23:59:59` / `DD HH:mm:ss` 这样的**字符串**，是配置值本身，不是查询区间。
 *
 * ## 当前已接入的写操作
 *
 * 当前已接入时间节点字典保存（`PUT /sys/dict/data/updateList` 数组 + `PUT /sys/dict/data` 单对象）、
 * 考核规则更新（`PUT /performance/basedata/protocol-deduct-rule/update`）、指标详情数据保存
 * （`POST /performance/basedata/kpitarget/saveData`）和标准详情数据保存
 * （`POST /performance/kpistandard/saveStandardData`）。其余页面仍有真实写入口：
 * 公式的「保存并发布」（`POST /infra/formula/definition/save-and-publish`，
 * 发布新修订）、指标树的导入/启停用/删除（`PUT …/kpitarget/updateStatus`、
 * `DELETE /performance/basedata/kpitarget` body `{ids}`；「新增」是跳 create 页，不在本页写）、
 * 五险一金的导入/删（`DELETE …/hrinsurancefund`，**批量**）、
 * 标准库的导入/删（`DELETE /performance/kpistandard`，body 是**裸数组**）。
 * 这些改的是**全公司共用的绩效口径**（公式、标准库、扣分规则、协议时间节点），
 * 一次误写的后果不是"多一条单据"，而是**所有人的绩效算法变了** ——
 * 比业务单据那条线更该先问清楚。理由逐条在报告里。
 *
 * ## 没做的读（都在页面上，本轮没实现）
 *
 * - `GET /infra/formula/definition/get?id=`（查看规则的抽屉）、
 *   `GET /performance/temcontent/kpitemprotocol/formula-references?formulaDefinitionId=`
 *   （引用模板明细弹窗）、`GET /infra/formula/revision/list?definitionId=`（发布历史）。
 * - `GET /performance/basedata/kpitarget/{id}`（指标详情，弹窗里用）、
 *   `…/getVariableList?targetType=`（同步公式弹窗里用）。
 * - 标准库的 `nodeDetails`（补取已选节点，是选择器用的；管理页这一版没打它）。
 * 都不难，只是不属于"这一页的列表读"，没往这一轮里塞。
 */

export const PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH = '/dashboard/manage/formula-definition/list'
export const PERF_MANAGE_INDICATOR_PAGE_PATH = '/dashboard/manage/indicator/list'
export const PERF_MANAGE_INSURANCE_PAGE_PATH = '/dashboard/manage/insurance/list'
export const PERF_MANAGE_STANDARD_PAGE_PATH = '/dashboard/manage/standard/list'
export const PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH =
  '/dashboard/manage/protocol-configuration/list'
export const PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH = '/dashboard/manage/protocol-deduct-rule/list'

const VIEWS = 'app/portal/views/dashboard/hr/manage'

/** 路由文件（六份 `list.vue`），写进文档与排障时用得上 */
export const PERF_MANAGE_CONFIG_ROUTE_FILES = {
  formulaDefinition: `${VIEWS}/formula-definition/list.vue`,
  indicator: `${VIEWS}/indicator/list.vue`,
  insurance: `${VIEWS}/insurance/list.vue`,
  standard: `${VIEWS}/standard/list.vue`,
  protocolConfiguration: `${VIEWS}/protocol-configuration/list.vue`,
  protocolDeductRule: `${VIEWS}/protocol-deduct-rule/list.vue`,
} as const

/**
 * 六个页面**全部走 platform 实例**（`src/context/http-instance.ts` 那张表里没有它们，
 * 因为显式声明 platform 与不声明在线上字节一样，表**刻意**不收）。
 * 所以能力定义里**不写** `httpInstance`。
 *
 * 端点的写法是「页面源码里那个以 `/` 开头的相对路径」——
 * `/admin-api` 前缀由 client.ts 的 platform profile 补（与 `platform.js:18-20` 的三条边界一致）。
 */
export const FORMULA_DEFINITION_PAGE_URL = '/infra/formula/definition/page'
export const FORMULA_SCENE_LIST_URL = '/infra/formula/scene/list'
export const INDICATOR_PAGE_URL = '/performance/basedata/kpitarget/page'
export const INSURANCE_FUND_PAGE_URL = '/performance/basedata/hrinsurancefund/page'
/** 标准库的**按层分页**读接口（线上版页面用的就是这一对，旧的 `standList` 已弃用） */
export const STANDARD_TREE_PAGE_URL = '/performance/kpistandard/treePage'
export const STANDARD_SEARCH_PAGE_URL = '/performance/kpistandard/searchPage'
export const DICT_GROUPED_LIST_URL = '/system/dict-data/grouped-list'
export const DICT_TYPE_PAGE_URL = '/sys/dict/type/page'
export const DICT_DATA_UPDATE_LIST_URL = '/sys/dict/data/updateList'
export const DICT_DATA_UPDATE_URL = '/sys/dict/data'
export const PROTOCOL_DEDUCT_RULE_BASE_URL = '/performance/basedata/protocol-deduct-rule'
export const FORMULA_DEFINITION_SAVE_AND_PUBLISH_URL = '/infra/formula/definition/save-and-publish'
export const INDICATOR_IMPORT_URL = '/performance/basedata/kpitarget/import'
export const INDICATOR_SAVE_DATA_URL = '/performance/basedata/kpitarget/saveData'
export const INDICATOR_UPDATE_STATUS_URL = '/performance/basedata/kpitarget/updateStatus'
export const INDICATOR_DELETE_URL = '/performance/basedata/kpitarget'
export const INSURANCE_IMPORT_URL = '/performance/basedata/hrinsurancefund/upload'
export const INSURANCE_DELETE_URL = '/performance/basedata/hrinsurancefund'
/** 五险一金编辑页的 customSubmit 实际写接口；不是 objectURL 的 REST create/update。 */
export const INSURANCE_FUND_SAVE_URL = '/sys/user'
export const STANDARD_IMPORT_URL = '/performance/kpistandard/import'
export const STANDARD_SAVE_DATA_URL = '/performance/kpistandard/saveStandardData'
export const STANDARD_DELETE_URL = '/performance/kpistandard'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const FORMULA_PUBLISH_REMARK = 'Web 保存公式并发布新修订'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/**
 * 标准库树分页的每页上限（**后端硬校验 1..100**，页面自己也钳了一次）。
 * 线上页面写的是 `Math.min(Number(form.pageSize) || 20, 100)`。
 */
export const STANDARD_MAX_PAGE_SIZE = 100

/** 公式配置页自己的分页对象初值（`pagination = reactive({ current: 1, pageSize: 20, … })`） */
export const FORMULA_DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/**
 * 时间节点页读的两组字典。
 *
 * 页面源码里写死的就是这两个：`dictStore.state['protocol_config']` 与
 * `dictStore.state['template_prompt_content'][0]`（后者取 `[0]`，是**单条**字典）。
 */
export const PROTOCOL_CONFIG_DICT_TYPES = ['protocol_config', 'template_prompt_content'] as const
export type ProtocolConfigDictType = (typeof PROTOCOL_CONFIG_DICT_TYPES)[number]

/**
 * 考核规则的四个枚举 —— **逐字抄 `protocol-deduct-rule/rule-utils.mjs`**，
 * 不是从后端或字典猜的。页面用它们决定显什么文案、以及保存时发什么值。
 */
export const PROTOCOL_PERIOD_TYPE = Object.freeze({ YEAR: 1, MONTH: 2 })
export const PROTOCOL_DEADLINE_TYPE = Object.freeze({
  YEAR_FIXED_DATE: 1,
  MONTH_END: 2,
  NEXT_MONTH_FIXED_DAY: 3,
})
export const PROTOCOL_CALCULATION_MODE = Object.freeze({ FIXED_ONCE: 1, DAILY_ACCUMULATED: 2 })
export const PROTOCOL_DEDUCT_TARGET = Object.freeze({ EMPLOYEE: 1, DIRECT_SUPERVISOR: 2 })

/**
 * 固定六条规则的 `ruleCode`（页面用它们补齐规则名与未完成判定文案）。
 * 后端 `/list` 的接口注释写的就是"查询**固定六条**协议考核扣分规则"。
 */
export const PROTOCOL_RULE_CODES = [
  'YEAR_PROTOCOL_SIGN',
  'YEAR_PROTOCOL_REVIEW',
  'MONTH_PROTOCOL_SIGN',
  'MONTH_PROTOCOL_REVIEW',
  'MONTH_PROTOCOL_SELF_EVALUATION',
  'MONTH_PROTOCOL_SCORE',
] as const

function normalizeDictDataUpdate (entry: ProtocolDictDataUpdate | undefined, field: string): ProtocolDictDataUpdate {
  if (entry === undefined || entry === null || typeof entry !== 'object') {
    throw new Error(`${field} 必须是字典更新对象`)
  }
  if (entry.id === '' || entry.id === null || entry.id === undefined) throw new Error(`${field}.id 不能为空`)
  if (entry.dictTypeId === '' || entry.dictTypeId === null || entry.dictTypeId === undefined) {
    throw new Error(`${field}.dictTypeId 不能为空`)
  }
  if (typeof entry.dictValue !== 'string' || typeof entry.dictLabel !== 'string') {
    throw new Error(`${field}.dictValue 和 ${field}.dictLabel 必须是字符串`)
  }
  return {
    id: entry.id,
    dictValue: entry.dictValue,
    dictLabel: entry.dictLabel,
    dictTypeId: entry.dictTypeId,
  }
}

function normalizePortalDecimal (value: string | number, field: string): string {
  const text = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${field} 必须是大于 0、最多 8 位整数和 2 位小数的数字`)
  const [integerPart = '0', fractionPart = ''] = text.split('.')
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '')
  if (normalizedInteger.length > 8) throw new Error(`${field} 整数部分不能超过 8 位`)
  const normalizedFraction = fractionPart.replace(/0+$/, '')
  const comparable = BigInt(`${normalizedInteger}${fractionPart.padEnd(2, '0')}`)
  if (comparable <= 0n) throw new Error(`${field} 必须大于 0`)
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger
}

function comparePortalDecimals (left: string, right: string): number {
  const toComparable = (value: string): bigint => {
    const [integerPart, fractionPart = ''] = value.split('.')
    return BigInt(`${integerPart}${fractionPart.padEnd(2, '0')}`)
  }
  const leftValue = toComparable(left)
  const rightValue = toComparable(right)
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

function normalizeProtocolDeductRuleUpdate (update: ProtocolDeductRuleUpdate): ProtocolDeductRuleUpdate {
  if (update === undefined || update === null || typeof update !== 'object') throw new Error('规则更新对象不能为空')
  if (!PROTOCOL_RULE_CODES.includes(update.ruleCode as (typeof PROTOCOL_RULE_CODES)[number])) {
    throw new Error(`ruleCode 必须是固定六条规则之一，收到 ${JSON.stringify(update.ruleCode)}`)
  }
  if (typeof update.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
  if (![1, 2, 3].includes(update.deadlineType)) throw new Error('deadlineType 必须是 1、2 或 3')
  const deadlineMonth = update.deadlineMonth ?? null
  const deadlineDay = update.deadlineDay ?? null
  const isYearRule = update.ruleCode.startsWith('YEAR_')
  if (isYearRule) {
    if (update.deadlineType !== 1) throw new Error('年度规则仅支持 deadlineType=1')
    if (deadlineMonth === null || !Number.isInteger(deadlineMonth) || deadlineMonth < 1 || deadlineMonth > 12) throw new Error('年度固定日期必须提供 1 至 12 的 deadlineMonth')
    const maxDay = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][deadlineMonth] ?? 0
    if (deadlineDay === null || !Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > maxDay) throw new Error('年度固定日期的 deadlineDay 不合法')
  } else if (update.deadlineType === 2) {
    if (deadlineMonth !== null || deadlineDay !== null) throw new Error('每月最后一天必须把 deadlineMonth 和 deadlineDay 都设为 null')
  } else if (update.deadlineType === 3) {
    if (deadlineMonth !== null || deadlineDay === null || !Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > 31) throw new Error('次月固定日必须把 deadlineMonth 设为 null，并提供 1 至 31 的 deadlineDay')
  } else {
    throw new Error('月度规则仅支持 deadlineType=2 或 3')
  }
  if (![1, 2].includes(update.calculationMode)) throw new Error('calculationMode 必须是 1 或 2')
  if ((typeof update.singleScore !== 'string' && typeof update.singleScore !== 'number') || update.singleScore === '') {
    throw new Error('singleScore 必须是数字或数字字符串')
  }
  const singleScore = normalizePortalDecimal(update.singleScore, 'singleScore')
  const maxScore = update.calculationMode === 1
    ? singleScore
    : normalizePortalDecimal(update.maxScore as string | number, 'maxScore')
  if (update.calculationMode === 2 && comparePortalDecimals(maxScore, singleScore) < 0) throw new Error('maxScore 不能小于 singleScore')
  if (!Number.isInteger(update.version) || update.version < 1) throw new Error('version 必须是正整数')
  return {
    ruleCode: update.ruleCode,
    enabled: update.enabled,
    deadlineType: update.deadlineType,
    deadlineMonth,
    deadlineDay,
    calculationMode: update.calculationMode,
    singleScore,
    maxScore,
    version: update.version,
  }
}

// ---------------------------------------------------------------------------
// 行结构
// ---------------------------------------------------------------------------

/**
 * 公式定义行（`GET /infra/formula/definition/page` 的 `list[]`）。
 *
 * 字段名取自 `formula-definition/list.vue` 里 `record.xxx` 的**全部**读法
 * （表格列、抽屉、删除守卫各读一组同义字段，所以这里有三个"引用数"字段）。
 */
export type FormulaDefinitionRow = {
  id: string | number
  formulaName?: string
  description?: string
  /** 任务类型值。⚠️ 取值来自 `listFormulaScenes()`（页面拿它灌下拉），本文件不猜枚举 */
  taskType?: number | string
  taskTypeName?: string
  sceneTaskTypeName?: string
  sceneCode?: string
  sceneRevision?: number
  /** 状态是**布尔**（不是 0/1）：页面判 `record.enabled === false` 才显示「停用」 */
  enabled?: boolean
  /** 结构化公式配置（JSON 字符串）。页面每处都 `JSON.parse` 它，解析失败就显示「规则待加载」 */
  configJson?: string
  /** 引用模板数 —— 页面依次读这三个同义字段 */
  templateReferenceCount?: number
  referenceCount?: number
  bindingCount?: number
  /** 删除守卫用的是这一个（也是三个同义字段） */
  totalReferenceCount?: number
  updaterName?: string
  updateTime?: string
  [key: string]: unknown
}

/** 任务类型 / 场景（`GET /infra/formula/scene/list`，无参数）。页面把最新修订的那条挑出来当选项 */
export type FormulaSceneRow = {
  taskType?: number | string
  /** 页面兼容字段名：`item.taskType ?? item.taskTypeCode` */
  taskTypeCode?: number | string
  taskTypeName?: string
  sceneCode?: string
  sceneName?: string
  sceneRevision?: number
  [key: string]: unknown
}

/**
 * 指标管理页的一行（树节点）。
 *
 * `customLoad` 返回的是**树数组**（`mapTree`/`reduceTree` 的返回值），不是 `{list,total}`。
 * 字段名与后端 `TargetListDTO` 一致（`dataType` 1 文件夹 2 指标 —— 与页面本地那份
 * `options.dataType` 逐字对上）。
 */
export type IndicatorRow = {
  id: string | number
  name?: string
  /** 1 文件夹 2 指标（页面本地常量，非字典） */
  dataType?: number
  /** 指标类型。后端 DTO 注释：1 一线指标 / 2 二线指标 / 3 四线指标；页面用字典 `indicator_type` 渲染 */
  targetType?: number
  status?: number
  unit?: string
  parent?: number
  children?: IndicatorRow[]
  [key: string]: unknown
}

/** 五险一金页的一行（`GET …/hrinsurancefund/page` 的 `list[]`） */
export type InsuranceFundRow = {
  id: string | number
  name?: string
  idcard?: string
  personalInsurance?: number | string
  companyInsurance?: number | string
  personalFund?: number | string
  companyFund?: number | string
  [key: string]: unknown
}

/**
 * 标准管理页的一行（**一层**树节点，线上版是按层分页返回的）。
 *
 * `type` 0 文件夹 / 1 标准、`standardType` 0 品种标准 / 1 指标标准 ——
 * 两组都来自页面本地常量 `options`，也不是字典。
 */
export type StandardRow = {
  id: string | number
  name?: string
  type?: number
  standardType?: number
  createTime?: string
  children?: StandardRow[]
  /** 跨层搜索（`searchPage`）时后端给的「根到父节点」路径；页面用它在名称下面显示面包屑 */
  ancestorPath?: Array<{ id?: string | number; name?: string; available?: boolean }>
  [key: string]: unknown
}

/** 字典分组（`GET /system/dict-data/grouped-list` 的一项） */
export type DictGroup = {
  dictType: string
  dataList?: Array<{ label?: string; value?: string; id?: string | number }>
}

/**
 * 时间节点页读到的字典项。
 *
 * ⚠️ `value` 是**配置项的字段名**（如 `self_score_start_time`），`label` 是**时间值本身**：
 * 页面写出 `dealMonthDate()` 取 `label.substring(0,5).split('-')` → `MM-DD`；
 * `dealDay()` 取 `label.substring(0,2)` → `DD`（`'99'` = 每月最后一天）。
 * 也就是说时间节点的配置值**存在 label 里**，不在 value 里（value 是键）。
 */
export type ProtocolConfigEntry = { label?: string; value?: string; id?: string | number }

/** 字典类型记录（`GET /sys/dict/type/page?dictType=` 的 `list[0]`，页面只用它的 id） */
export type DictTypeRow = { id?: string | number; dictType?: string; [key: string]: unknown }

/** Portal 时间节点页提交给字典接口的最小字段集合。 */
export type ProtocolDictDataUpdate = {
  id: string | number
  dictValue: string
  dictLabel: string
  dictTypeId: string | number
}

/** Portal 保存按钮实际发出的两次字典写请求。 */
export type ProtocolConfigUpdate = {
  /** 8 个日期字典项；body 是数组，顺序沿用页面字典顺序。 */
  dateEntries: ProtocolDictDataUpdate[]
  /** `template_prompt_content[0]`；body 是单个对象。 */
  contentEntry: ProtocolDictDataUpdate
}

/**
 * 考核规则的一条（`GET …/protocol-deduct-rule/list` 的 `rules[]`）。
 *
 * `ruleName` / `unmetDescription` 后端可能不给，页面会拿本地 `RULE_METADATA` 按
 * `ruleCode` 补文案 —— 补的是**展示文案**，本能力原样返回接口给的东西。
 */
export type ProtocolDeductRule = {
  /** 固定六条之一，见 `PROTOCOL_RULE_CODES` */
  ruleCode?: string
  ruleName?: string
  /** 1 年度 / 2 月度，见 `PROTOCOL_PERIOD_TYPE` */
  periodType?: number
  /** 1 员工本人 / 2 直属上级，见 `PROTOCOL_DEDUCT_TARGET` */
  deductTarget?: number
  deductTargetName?: string
  /** 1 固定日期 / 2 每月最后一天 / 3 次月固定日 */
  deadlineType?: number
  deadlineMonth?: number
  deadlineDay?: number
  /** 1 固定扣一次 / 2 每个逾期自然日累计 */
  calculationMode?: number
  singleScore?: number | string
  maxScore?: number | string
  enabled?: boolean
  version?: number
  configVersion?: number
  /** 生效周期：`effectiveYear ?? configEffectiveYear`（页面兼容两种字段名）；1970 表示初始版本 */
  effectiveYear?: number
  configEffectiveYear?: number
  effectiveMonth?: number
  configEffectiveMonth?: number
  createTime?: string
  [key: string]: unknown
}

/** `GET …/protocol-deduct-rule/list` 的整个回包（页面在本地归一成 `{rules, …}`） */
export type ProtocolDeductRuleList = {
  rules?: ProtocolDeductRule[]
  enabledCount?: number
  annualRuleCount?: number
  monthlyRuleCount?: number
  [key: string]: unknown
}

/** Portal 编辑抽屉 `buildUpdatePayload()` 的请求体；不包含页面展示字段。 */
export type ProtocolDeductRuleUpdate = {
  ruleCode: string
  enabled: boolean
  deadlineType: number
  deadlineMonth: number | null
  deadlineDay: number | null
  calculationMode: number
  singleScore: string | number
  maxScore: string | number | null
  version: number
}

// ---------------------------------------------------------------------------
// 配置页写入参数
// ---------------------------------------------------------------------------

export type PerfManageConfigId = string | number

/** 公式页保存按钮送出的最小表单。`publishRemark` 由 Portal 固定生成，不开放覆盖。 */
export type FormulaDefinitionSaveAndPublishInput = {
  id?: PerfManageConfigId | null | ''
  formulaName: string
  taskType: number
  configJson: string
  astJson: string
  description?: string | null
}

export type FormulaDefinitionSaveAndPublishDraft = {
  id?: PerfManageConfigId
  formulaName: string
  taskType: number
  configJson: string
  astJson: string
  description: string
  publishRemark: string
}

export type FormulaDefinitionRevision = {
  id?: PerfManageConfigId
  definitionId?: PerfManageConfigId
  formulaCode?: string
  formulaName?: string
  revisionNo?: number
  revisionCode?: string
  definitionHash?: string
  sceneCode?: string
  sceneRevision?: number
  configJson?: string
  astJson?: string
  publishRemark?: string
  publishedAt?: string
  [key: string]: unknown
}

export type PerfManageConfigExcelFileInput = {
  fileName: string
  base64: string
  contentType?: string | null
}

export type IndicatorImportInput = PerfManageConfigExcelFileInput & {
  /** Portal 下拉：1=预测，2=实际。 */
  type: 1 | 2
  /** 根节点由页面传空字符串；目录节点传它的 id。 */
  parentId?: PerfManageConfigId | null | ''
}

export type StandardImportInput = PerfManageConfigExcelFileInput & {
  /** Portal 下拉：0=品种标准，1=指标标准。 */
  type: 0 | 1
  /** 根节点由页面传空字符串；目录节点传它的 id。 */
  parentId?: PerfManageConfigId | null | ''
}

export type InsuranceImportInput = PerfManageConfigExcelFileInput

/** 五险一金编辑页 `formState` 的完整保存载荷；编辑时由详情回填 `id`。 */
export type InsuranceFundSaveInput = {
  id?: PerfManageConfigId
  name: string
  idcard: string
  personalFund: number
  personalInsurance: number
  companyFund: number
  companyInsurance: number
}

export type InsuranceFundSaveDraft = InsuranceFundSaveInput & { id?: PerfManageConfigId }

export type IndicatorStatusDraft = { id: PerfManageConfigId; status: 0 | 1 }
export type IndicatorStatusInput = {
  id: PerfManageConfigId
  dataType: 1 | 2
  currentStatus: 0 | 1
}

export type IndicatorDeleteInput = {
  ids: PerfManageConfigId[]
  /** 传单个列表行时用于复刻页面的删除禁用条件；批量/树展开时可省略。 */
  dataType?: 1 | 2
  currentStatus?: 0 | 1
}

export type PerfManageConfigDeleteDraft = { ids: PerfManageConfigId[] }

/** 指标详情页 POST /saveData 的实际三段 body；嵌套行字段原样保留。 */
export type IndicatorTargetData = Record<string, unknown> & {
  year: number
  targetDataList: unknown[]
}

export type IndicatorDataSave = {
  actualTarget: IndicatorTargetData
  forecastTarget: IndicatorTargetData
  targetId: PerfManageConfigId
}

/** 标准详情页把整个 formState 作为 POST body；保留Java DTO继承字段及页面回显字段。 */
export type StandardDataRow = Record<string, unknown> & {
  standardKey: PerfManageConfigId
  standardValue: string[]
}

export type StandardDataSave = Record<string, unknown> & {
  id: PerfManageConfigId
  name: string
  standardType: 0 | 1
  unit: string
  organizationList: PerfManageConfigId[]
  header: string[]
  dataList: StandardDataRow[]
  orgPostIdList: PerfManageConfigId[]
  orgTreeIdList: PerfManageConfigId[]
}

// ---------------------------------------------------------------------------
// 查询参数
// ---------------------------------------------------------------------------

/** 公式配置页的查询条件。**没有 `order`/`orderField`** —— 这一页不走 `useListPageModule` */
export type FormulaDefinitionQuery = {
  /** 任务类型。取值先问 `listFormulaScenes()`；不传则**整项不出现**在 URL 上（页面初值是 undefined） */
  taskType?: number | string
  /** 公式名称（模糊）。页面初值是**空串**（照发 `formulaName=`） */
  formulaName?: string
  /** 启用状态。**布尔**；不传则整项不出现（页面初值是 undefined） */
  enabled?: boolean
  pageNo?: number
  pageSize?: number
}

/** 指标管理页的查询条件。⚠️ 前三项后端不认，只有 `targetType` 真的筛（见文件头） */
export type IndicatorQuery = {
  /** ⚠️ **后端不认这个参数**（SQL 里没有 name），传了等于没传 */
  name?: string
  /** ⚠️ **后端不认**（`TargetListDTO` 里没有这个字段） */
  creatorName?: string
  /** **真正生效的筛选**：保留全部文件夹 + 命中该类型的指标 */
  targetType?: number | string
  /** ⚠️ **后端不认**（`TargetListDTO` 里没有这个字段） */
  type?: number | string
}

/** 五险一金页的查询条件（两项都是服务端 LIKE） */
export type InsuranceFundQuery = {
  name?: string
  idcard?: string
  pageNo?: number
  pageSize?: number
}

/**
 * 标准管理页的查询条件（**线上版**：按层分页 + 跨层搜索两个端点）。
 *
 * `keyword` 有没有值**决定打哪个接口**（页面就是这么写的），所以它不是普通筛选：
 * - 空 → `treePage`：按 `parentId` 取**这一层**；
 * - 非空 → `searchPage`：跨层搜索，且会**顺带钉上 `dataType=2`**（只搜标准、不搜文件夹）。
 */
export type StandardQuery = {
  /** 父节点 id，默认 0（根层）。页面上点文件夹名字就是切到它的 id */
  parentId?: number | string
  /** 名称关键字（页面会 `trim()`）。非空即切 `searchPage`，超过 100 字后端会 500 */
  keyword?: string
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

type FieldSpec = { name: string; defaultValue: unknown }

/**
 * 把「日期区间」之类需要现算的东西排除在外 —— 这六页一个区间都没有（见文件头）。
 * 唯一的 helper 就是把字段序展开成参数对象。
 *
 * `defaultValue: undefined` 是**刻意**的：它让这一项在 qs 的 `skipNulls` 下**整个消失**，
 * 用来复刻页面上"筛选项初值是 undefined"的两种字段（公式配置页的 `taskType`/`enabled`）。
 */
function buildParams (
  fields: ReadonlyArray<FieldSpec>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const field of fields) {
    const value = query[field.name]
    params[field.name] = value === undefined ? field.defaultValue : value
  }
  return params
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as JsonObject
}

function textOf (value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  return value
}

function requiredTextOf (value: unknown, label: string): string {
  const text = textOf(value, label)
  if (text.trim() === '') throw new Error(`${label}不能为空`)
  return text
}

function idOf (value: unknown, label: string): PerfManageConfigId {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idsOf (value: unknown, label: string): PerfManageConfigId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function integerOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}必须为安全整数`)
  return value
}

function statusOf (value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error(`${label}必须为0或1`)
  return value
}

function parentIdOf (value: unknown): PerfManageConfigId | '' {
  if (value === undefined || value === null || value === '') return ''
  return idOf(value, 'parentId')
}

function formulaSavePayloadOf (input: unknown): FormulaDefinitionSaveAndPublishDraft {
  const value = objectOf(input, '公式保存表单')
  const payload: JsonObject = {}
  if (value.id !== undefined && value.id !== null && value.id !== '') payload.id = idOf(value.id, '公式ID')

  const formulaName = requiredTextOf(value.formulaName, 'formulaName').trim()
  if (formulaName.length > 40) throw new Error('formulaName最多40个字符')
  const taskType = integerOf(value.taskType, 'taskType')
  const configJson = requiredTextOf(value.configJson, 'configJson')
  const astJson = requiredTextOf(value.astJson, 'astJson')
  if (configJson.trim() === '') throw new Error('configJson不能为空')
  if (astJson.trim() === '') throw new Error('astJson不能为空')
  const description = value.description === undefined || value.description === null ? '' : textOf(value.description, 'description')
  if (description.length > 500) throw new Error('description最多500个字符')

  // 这一顺序就是 Portal saveEditor() 的对象字面量顺序；不要把固定备注提前或补到 id 前面。
  payload.formulaName = formulaName
  payload.taskType = taskType
  payload.configJson = configJson
  payload.astJson = astJson
  payload.description = description
  payload.publishRemark = FORMULA_PUBLISH_REMARK
  return payload as FormulaDefinitionSaveAndPublishDraft
}

function indicatorTargetDataOf (value: unknown, label: string): IndicatorTargetData {
  const item = objectOf(value, label)
  const year = integerOf(item.year, `${label}.year`)
  if (!Array.isArray(item.targetDataList)) throw new Error(`${label}.targetDataList必须是数组`)
  return { ...item, year, targetDataList: item.targetDataList }
}

function indicatorDataSaveOf (input: unknown): IndicatorDataSave {
  const value = objectOf(input, '指标数据保存')
  const actualTarget = indicatorTargetDataOf(value.actualTarget, 'actualTarget')
  const forecastTarget = indicatorTargetDataOf(value.forecastTarget, 'forecastTarget')
  // Portal 只在预测数据不是恰好一条时检查每条 formula 是否为空。
  if (forecastTarget.targetDataList.length !== 1) {
    forecastTarget.targetDataList.forEach((entry, index) => {
      const row = objectOf(entry, `forecastTarget.targetDataList[${index}]`)
      if (row.formula === '') throw new Error('指标公式不能为空')
    })
  }
  return {
    actualTarget,
    forecastTarget,
    targetId: idOf(value.targetId, '指标ID'),
  }
}

function idListOf (value: unknown, label: string): PerfManageConfigId[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是ID数组`)
  return value.map((item, index) => idOf(item, `${label}[${index}]`))
}

function standardDataTypeOf (value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('standardType必须为0（品种标准）或1（指标标准）')
  return value
}

function standardDataRowOf (value: unknown, index: number): StandardDataRow {
  const row = objectOf(value, `dataList[${index}]`)
  if (!Array.isArray(row.standardValue)) throw new Error(`dataList[${index}].standardValue必须是数组`)
  return {
    ...row,
    standardKey: idOf(row.standardKey, `dataList[${index}].standardKey`),
    standardValue: row.standardValue.map((item, valueIndex) => textOf(item, `dataList[${index}].standardValue[${valueIndex}]`)),
  }
}

function standardDataSaveOf (input: unknown): StandardDataSave {
  const value = objectOf(input, '标准数据保存')
  if (!Array.isArray(value.header)) throw new Error('header必须是数组')
  if (!Array.isArray(value.dataList)) throw new Error('dataList必须是数组')
  const normalized: StandardDataSave = {
    ...value,
    id: idOf(value.id, '标准ID'),
    name: textOf(value.name, 'name'),
    standardType: standardDataTypeOf(value.standardType),
    unit: textOf(value.unit, 'unit'),
    organizationList: idListOf(value.organizationList, 'organizationList'),
    header: value.header.map((item, index) => textOf(item, `header[${index}]`)),
    dataList: value.dataList.map((item, index) => standardDataRowOf(item, index)),
    orgPostIdList: idListOf(value.orgPostIdList, 'orgPostIdList'),
    orgTreeIdList: idListOf(value.orgTreeIdList, 'orgTreeIdList'),
  }
  return normalized
}

function fileBytesOf (
  input: unknown,
  label: string,
  strictXlsxMime: boolean,
  requireXlsxExtension = strictXlsxMime,
): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, label)
  const fileName = requiredTextOf(value.fileName, `${label}.fileName`)
  if (requireXlsxExtension && !/\.xlsx$/i.test(fileName)) throw new Error(`${label}.fileName必须是.xlsx文件`)
  const base64 = requiredTextOf(value.base64, `${label}.base64`).replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error(`${label}.base64不是合法的标准Base64`)
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) throw new Error(`${label}.base64不能为空文件`)
  const contentType = typeof value.contentType === 'string' && value.contentType.trim() !== ''
    ? value.contentType
    : XLSX_CONTENT_TYPE
  if (strictXlsxMime && contentType !== XLSX_CONTENT_TYPE) {
    throw new Error(`${label}.contentType必须是${XLSX_CONTENT_TYPE}`)
  }
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: unknown, label: string, strictXlsxMime: boolean, requireXlsxExtension = strictXlsxMime) {
  const file = fileBytesOf(input, label, strictXlsxMime, requireXlsxExtension)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function formDataWithFile (input: unknown, label: string, strictXlsxMime: boolean, requireXlsxExtension = strictXlsxMime): FormData {
  const file = fileBytesOf(input, label, strictXlsxMime, requireXlsxExtension)
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  return data
}

/** 复用同一个会话请求，把 Portal 的 multipart 配置完整传入。 */
function requestMultipart<T> (request: PortalRequest, config: PortalRequestConfig): Promise<T> {
  return request<T>(config)
}

function appendImportFields (data: FormData, type: number, parentId: PerfManageConfigId | '') {
  data.append('type', String(type))
  data.append('parentId', String(parentId))
}

function indicatorImportTypeOf (value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) throw new Error('指标导入type必须为1（预测）或2（实际）')
  return value
}

function standardImportTypeOf (value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) throw new Error('标准库导入type必须为0（品种标准）或1（指标标准）')
  return value
}

function indicatorImportOf (input: unknown): IndicatorImportInput {
  const value = objectOf(input, '指标导入参数')
  return {
    fileName: requiredTextOf(value.fileName, 'fileName'),
    base64: requiredTextOf(value.base64, 'base64'),
    contentType: value.contentType as string | null | undefined,
    type: indicatorImportTypeOf(value.type),
    parentId: parentIdOf(value.parentId),
  }
}

function standardImportOf (input: unknown): StandardImportInput {
  const value = objectOf(input, '标准库导入参数')
  return {
    fileName: requiredTextOf(value.fileName, 'fileName'),
    base64: requiredTextOf(value.base64, 'base64'),
    contentType: value.contentType as string | null | undefined,
    type: standardImportTypeOf(value.type),
    parentId: parentIdOf(value.parentId),
  }
}

function insuranceImportOf (input: unknown): InsuranceImportInput {
  const value = objectOf(input, '五险一金导入参数')
  return {
    fileName: requiredTextOf(value.fileName, 'fileName'),
    base64: requiredTextOf(value.base64, 'base64'),
    contentType: value.contentType as string | null | undefined,
  }
}

function finiteNumberOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是有限数字`)
  return value
}

function insuranceFundSaveOf (input: unknown, requireId: boolean): InsuranceFundSaveDraft {
  const value = objectOf(input, '五险一金保存参数')
  const draft: InsuranceFundSaveDraft = {
    name: requiredTextOf(value.name, 'name'),
    idcard: requiredTextOf(value.idcard, 'idcard'),
    personalFund: finiteNumberOf(value.personalFund, 'personalFund'),
    personalInsurance: finiteNumberOf(value.personalInsurance, 'personalInsurance'),
    companyFund: finiteNumberOf(value.companyFund, 'companyFund'),
    companyInsurance: finiteNumberOf(value.companyInsurance, 'companyInsurance'),
  }
  if (requireId) draft.id = idOf(value.id, '五险一金记录ID')
  return draft
}

function insuranceFundSaveDraftOf (input: unknown, requireId: boolean): InsuranceFundSaveDraft {
  return insuranceFundSaveOf(input, requireId)
}

function formulaRevisionOf (value: unknown): FormulaDefinitionRevision {
  return objectOf(value, '公式发布响应') as FormulaDefinitionRevision
}

function indicatorStatusDraftOf (value: unknown): IndicatorStatusDraft {
  const draft = objectOf(value, '指标启停草稿')
  return { id: idOf(draft.id, '指标ID'), status: statusOf(draft.status, 'status') }
}

function indicatorStatusPayloadOf (input: unknown): IndicatorStatusDraft {
  const value = objectOf(input, '指标启停参数')
  if (value.dataType !== 2) throw new Error('只有dataType=2的指标行可以启停')
  const currentStatus = statusOf(value.currentStatus, 'currentStatus')
  return { id: idOf(value.id, '指标ID'), status: currentStatus === 1 ? 0 : 1 }
}

function indicatorDeletePayloadOf (input: unknown): PerfManageConfigDeleteDraft {
  const value = objectOf(input, '指标删除参数')
  const ids = idsOf(value.ids, 'ids')
  if (value.dataType !== undefined) {
    if (value.dataType !== 1 && value.dataType !== 2) throw new Error('dataType必须为1（文件夹）或2（指标）')
    if (value.dataType === 2 && statusOf(value.currentStatus, 'currentStatus') === 1) {
      throw new Error('启用中的指标不能删除，Portal按钮处于禁用状态')
    }
    if (value.dataType === 1 && value.currentStatus !== undefined) statusOf(value.currentStatus, 'currentStatus')
  }
  return { ids }
}

function deleteDraftOf (input: unknown, label: string): PerfManageConfigDeleteDraft {
  const value = objectOf(input, label)
  return { ids: idsOf(value.ids, `${label}.ids`) }
}

/** `useListPageModule` 的两项固定开头。页面没有这两个控件，值恒为空串（`list.js:474-475`） */
const ORDER_HEAD: ReadonlyArray<FieldSpec> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
]

/**
 * 公式配置页的字段序 —— 逐字抄它自己的
 * `page({ pageNo: pagination.current, pageSize: pagination.pageSize, ...filters })`。
 *
 * ⚠️ **没有 `ORDER_HEAD`**：这一页不用 `useListPageModule`，`order`/`orderField` 从未存在。
 * ⚠️ `taskType`/`enabled` 默认 `undefined` ⇒ 首屏 URL 是
 * `?pageNo=1&pageSize=20&formulaName=&_t=…` —— 键序里明明排了 5 项，
 * 上 URL 的只有 4 个（两个 `undefined` 被 qs 丢掉了）。
 */
const FORMULA_FIELDS: ReadonlyArray<FieldSpec> = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: FORMULA_DEFAULT_PAGE_SIZE },
  { name: 'taskType', defaultValue: undefined },
  { name: 'formulaName', defaultValue: '' },
  { name: 'enabled', defaultValue: undefined },
]

/**
 * 指标管理页的字段序 —— 逐字抄它 `customLoad` 收到的那个对象，`omit(templateName)` 之后。
 *
 * ⚠️ **没有 `pageNo`/`pageSize`**：`useListPageModule` 的 `getDataListIsPage` 默认 false，
 * 这一页没有开它（`list.js:479` 的 `if` 不成立）⇒ 分页参数压根没进过 params。
 * ⚠️ `templateName` 被 `omit` 掉了（名称只做本地过滤），所以字段序里没有它。
 */
const INDICATOR_FIELDS: ReadonlyArray<FieldSpec> = [
  ...ORDER_HEAD,
  { name: 'name', defaultValue: '' },
  { name: 'creatorName', defaultValue: '' },
  { name: 'targetType', defaultValue: '' },
  { name: 'type', defaultValue: '' },
]

/** 五险一金页的字段序（六页里**唯一**带分页的一页） */
const INSURANCE_FIELDS: ReadonlyArray<FieldSpec> = [
  ...ORDER_HEAD,
  { name: 'name', defaultValue: '' },
  { name: 'idcard', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 标准管理页的字段序 —— 逐字抄**线上版**那个 `customLoad` 自己拼的对象：
 *
 * ```js
 * const keyword = (form.templateName || '').trim()
 * http.get('/performance/kpistandard/' + (keyword ? 'searchPage' : 'treePage'), { params: {
 *   parentId: form.parentId || 0,
 *   keyword,
 *   dataType: keyword ? 2 : undefined,
 *   selection: false,
 *   pageNo: form.pageNo || 1,
 *   pageSize: Math.min(Number(form.pageSize) || 20, 100)
 * }, timeout: 20000 })
 * ```
 *
 * ⇒ 键序是 `parentId → keyword → dataType → selection → pageNo → pageSize`，
 * 与基准逐字吻合（`parentId=0&keyword=&selection=false&pageNo=1&pageSize=20&_t=…`）。
 *
 * ⚠️ 这两个端点的参数**不是** `list.js` 拼的（`order`/`orderField` 一个字都不发），
 * 是 `customLoad` 自己建的 —— 所以照抄隔壁页的 `order=&orderField=` 会多两个键。
 * `selection` 是页面写死的 `false`，**不是**表单字段（后端那个字段默认 true）。
 * 下面的 `defaultValue` 只是把线上的**形状**记全：方法体每次都显式传 `selection`，
 * 所以那个默认值取不到（改它是个**等价变异**，测试不会红 —— 已记在报告里）。
 */
const STANDARD_FIELDS: ReadonlyArray<FieldSpec> = [
  { name: 'parentId', defaultValue: 0 },
  { name: 'keyword', defaultValue: '' },
  { name: 'dataType', defaultValue: undefined },
  { name: 'selection', defaultValue: false },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

// ---------------------------------------------------------------------------
// 参数表（给 AI 看的那一份）
// ---------------------------------------------------------------------------

const PAGE_PARAMS: ParamSpec[] = [
  {
    name: 'pageNo',
    kind: 'number',
    required: false,
    description: '页码，默认 1（后端取的就是 `pageNo` 这个名字：`Constant.PAGE = "pageNo"`）',
  },
  {
    name: 'pageSize',
    kind: 'number',
    required: false,
    description:
      `每页条数，默认 ${DEFAULT_PAGE_SIZE}。⚠️ 这一条路径（CrudServiceImpl → BaseServiceImpl.getPage）` +
      '**没有上限校验**（pageSize 直接 Long.parseLong），别拿它去拉全表（设计 D6 / H35）',
  },
]

const FORMULA_PARAMS: ParamSpec[] = [
  {
    name: 'pageNo',
    kind: 'number',
    required: false,
    description: '页码，默认 1（这一页的页码叫 `current`，序列化出去是 `pageNo`）',
  },
  {
    name: 'pageSize',
    kind: 'number',
    required: false,
    description: `每页条数，默认 ${FORMULA_DEFAULT_PAGE_SIZE}。后端约束 ≤ 500`,
  },
  {
    name: 'taskType',
    kind: 'text',
    required: false,
    description:
      '任务类型。取值先问 `listFormulaScenes()`（页面就是拿它灌下拉的），本文件不猜枚举。' +
      '⚠️ 不传时这一项**不出现在 URL 上**（页面初值是 undefined，qs 的 skipNulls 会丢掉它）',
  },
  { name: 'formulaName', kind: 'text', required: false, description: '公式名称（模糊）；初值是空串，照发' },
  {
    name: 'enabled',
    kind: 'boolean',
    required: false,
    description: '是否启用。**布尔**（`enabled=true`/`enabled=false`），不传则整项不出现',
  },
]

const INDICATOR_PARAMS: ParamSpec[] = [
  {
    name: 'name',
    kind: 'text',
    required: false,
    description:
      '⚠️ **后端不认这个参数**（`KpiTargetDao.xml` 的 `selectAllTarget` 里没有 name 条件），' +
      '传了等于没传。要按名称找指标只能取回整棵树自己过滤 —— 页面也是这么干的',
  },
  { name: 'creatorName', kind: 'text', required: false, description: '⚠️ 后端不认（DTO 里没这个字段）' },
  {
    name: 'targetType',
    kind: 'text',
    required: false,
    description:
      '指标类型。**这一页唯一真生效的筛选**（服务端内存过滤：保留全部文件夹 + 命中该类型的指标）。' +
      '后端 DTO 注释为 1 一线指标 / 2 二线指标 / 3 四线指标；页面用字典 `indicator_type` 渲染，' +
      '两者是否一一对应**未实测**（可调 base-data 的 getDict 现读该字典）',
  },
  { name: 'type', kind: 'text', required: false, description: '⚠️ 后端不认（DTO 里没这个字段）' },
]

const INSURANCE_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '姓名，服务端**模糊**匹配（`wrapper.like`）' },
  { name: 'idcard', kind: 'text', required: false, description: '身份证件号，服务端**模糊**匹配' },
  ...PAGE_PARAMS,
]

const STANDARD_PARAMS: ParamSpec[] = [
  {
    name: 'parentId',
    kind: 'tree',
    required: false,
    description:
      '父节点 id，默认 0（根层）。页面上点文件夹名字就是钻到它的 id 下 —— 这是**按层浏览**，' +
      '不是一次拿整棵树（后端注释：旧全树接口最多 1000 节点，已换成分页）',
  },
  {
    name: 'keyword',
    kind: 'text',
    required: false,
    description:
      '名称关键字（页面会 trim）。⚠️ **它决定打哪个接口**：空 → `treePage`（按层），' +
      '非空 → `searchPage`（跨层搜索，且顺带钉上 `dataType=2` 只搜标准）。超过 100 字后端会 500',
  },
  {
    name: 'pageNo',
    kind: 'number',
    required: false,
    description: '页码，默认 1。⚠️ 后端校验 `pageNo ≥ 1`，违反直接 500',
  },
  {
    name: 'pageSize',
    kind: 'number',
    required: false,
    description:
      `每页条数，默认 ${DEFAULT_PAGE_SIZE}。⚠️ 后端**硬校验 1..100**（违反报「每页数量为1至100」），` +
      '页面端也钳了一次 `Math.min(pageSize || 20, 100)` —— 本能力照做（传 500 会被钳成 100，不会打出水）',
  },
]

const PROTOCOL_CONFIG_PARAMS: ParamSpec[] = [
  {
    name: 'dictType',
    kind: 'enum',
    required: false,
    description:
      '要读哪一组字典，默认两组都返回。取值只有页面用到的那两个 —— ' +
      '`protocol_config`（8 个时间节点）与 `template_prompt_content`（定性指标提示内容）',
    options: [
      { label: '时间节点配置', value: 'protocol_config' },
      { label: '定性指标提示内容', value: 'template_prompt_content' },
    ],
  },
]

const PROTOCOL_CONFIG_UPDATE_PARAMS: ParamSpec[] = [
  {
    name: 'dateEntries',
    kind: 'array',
    required: true,
    description:
      '从 `readProtocolConfig().protocol_config` 保留 id/value 后生成的日期字典更新项数组；每项只发 id、dictValue、dictLabel、dictTypeId，' +
      'Portal 先 PUT 这个数组，再 PUT 提示文案对象；不要把页面展示字段或整个后端 DTO 混入 body',
  },
  {
    name: 'contentEntry',
    kind: 'array',
    required: true,
    description:
      '`template_prompt_content[0]` 对应的单个字典更新对象（对象形状而非数组）；dictLabel 是提示文案，' +
      'dictValue 保留原值，dictTypeId 来自 `getDictTypeId("template_prompt_content")`',
  },
]

const PROTOCOL_DEDUCT_RULE_PARAMS: ParamSpec[] = []

const PROTOCOL_DEDUCT_RULE_UPDATE_PARAMS: ParamSpec[] = [
  { name: 'ruleCode', kind: 'enum', required: true, description: '固定六条规则编码；从列表或详情的 rules[].ruleCode 取得，不要自造。', options: PROTOCOL_RULE_CODES.map((value) => ({ label: value, value })) },
  { name: 'enabled', kind: 'boolean', required: true, description: '是否启用；Portal 开关值为布尔值。启停保存后立即生效。' },
  { name: 'deadlineType', kind: 'number', required: true, description: '截止类型：1=年度固定日期，2=每月最后一天，3=次月固定日；年度规则只能是 1。' },
  { name: 'deadlineMonth', kind: 'number', required: false, description: '年度规则的 1..12 月；月度规则 Portal 明确发送 null。' },
  { name: 'deadlineDay', kind: 'number', required: false, description: '年度或次月固定日的 1..31；每月最后一天 Portal 明确发送 null。' },
  { name: 'calculationMode', kind: 'number', required: true, description: '1=固定扣一次，2=每个逾期自然日累计。' },
  { name: 'singleScore', kind: 'text', required: true, description: '单次扣分；Portal string-mode 归一为最多 8 位整数、2 位小数字符串，必须大于 0。' },
  { name: 'maxScore', kind: 'text', required: false, description: '累计模式的最高扣分；固定扣一次时 Portal 把它改成与 singleScore 相同。' },
  { name: 'version', kind: 'number', required: true, description: '详情返回的乐观锁版本；冲突业务码 `1010002001` 时先重新读取，不能盲目重试。' },
]

const FORMULA_SAVE_FORM_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: false, description: '编辑已有公式时传定义ID；新建时省略。' },
  { name: 'formulaName', kind: 'text', required: true, description: '公式名称；Portal trim 后提交，最多40个字符。' },
  { name: 'taskType', kind: 'number', required: true, description: '任务类型；先从 listFormulaScenes() 取得，不在 SDK 内猜枚举。' },
  { name: 'configJson', kind: 'text', required: true, description: '结构化公式配置 JSON 字符串；必须是非空 JSON 文本。' },
  { name: 'astJson', kind: 'text', required: true, description: '公式 AST JSON 字符串；必须与 configJson 对应，最终由 Java 再校验。' },
  { name: 'description', kind: 'text', required: false, description: '公式说明；缺省发送空字符串，最多500个字符。' },
]
const FORMULA_SAVE_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: 'prepareFormulaDefinitionSave 返回的请求草稿；包含 Portal 固定 publishRemark。' },
]
const INDICATOR_DATA_SAVE_FORM_PARAMS: ParamSpec[] = [
  { name: 'targetId', kind: 'text', required: true, description: '指标详情页当前指标ID。' },
  { name: 'actualTarget', kind: 'text', required: true, description: '实际指标对象：包含 year 和 targetDataList；行内保留Portal实际字段。' },
  { name: 'forecastTarget', kind: 'text', required: true, description: '预测指标对象：包含 year 和 targetDataList；Portal在多行时要求每行formula非空。' },
]
const INDICATOR_DATA_SAVE_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: 'prepareIndicatorDataSave返回的 {actualTarget, forecastTarget, targetId} 草稿。' },
]
const STANDARD_DATA_SAVE_FORM_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '标准详情页当前标准ID。' },
  { name: 'standardType', kind: 'enum', required: true, description: '标准类型：0=品种标准，1=指标标准。', options: [{ label: '品种标准', value: 0 }, { label: '指标标准', value: 1 }] },
  { name: 'name', kind: 'text', required: true, description: '标准名称；随页面整个formState提交。' },
  { name: 'unit', kind: 'text', required: true, description: '标准单位；随页面整个formState提交。' },
  { name: 'organizationList', kind: 'array', required: true, description: '授权组织ID数组，可为空数组。' },
  { name: 'orgTreeIdList', kind: 'array', required: true, description: '页面组织树回显ID数组，可为空数组。' },
  { name: 'orgPostIdList', kind: 'array', required: true, description: '授权组织岗位ID数组，可为空数组。' },
  { name: 'header', kind: 'array', required: true, description: '动态表头字符串数组；页面按列编辑。' },
  { name: 'dataList', kind: 'array', required: true, description: '标准数据行数组；每行包含standardKey和与表头对应的standardValue字符串数组。' },
]
const STANDARD_DATA_SAVE_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: 'prepareStandardDataSave返回的整个formState草稿；提交时不包装、不改成裸数组。' },
]
const EXCEL_FILE_PARAMS: ParamSpec[] = [
  { name: 'fileName', kind: 'text', required: true, description: '原始上传文件名；页面只允许 .xlsx。' },
  { name: 'base64', kind: 'text', required: true, description: '文件内容的标准 Base64。' },
  { name: 'contentType', kind: 'text', required: false, description: `文件 MIME；指标树/标准库页面要求 ${XLSX_CONTENT_TYPE}。` },
]
const INDICATOR_IMPORT_PARAMS: ParamSpec[] = [
  ...EXCEL_FILE_PARAMS,
  { name: 'type', kind: 'enum', required: true, description: '导入类型：1=预测，2=实际。', options: [{ label: '预测', value: 1 }, { label: '实际', value: 2 }] },
  { name: 'parentId', kind: 'tree', required: false, description: '父文件夹ID；根节点必须传空字符串，页面不会传0。' },
]
const STANDARD_IMPORT_PARAMS: ParamSpec[] = [
  ...EXCEL_FILE_PARAMS,
  { name: 'type', kind: 'enum', required: true, description: '导入类型：0=品种标准，1=指标标准。', options: [{ label: '品种标准', value: 0 }, { label: '指标标准', value: 1 }] },
  { name: 'parentId', kind: 'tree', required: false, description: '父文件夹ID；根节点必须传空字符串，页面不会传0。' },
]
const INSURANCE_IMPORT_PARAMS: ParamSpec[] = EXCEL_FILE_PARAMS.map((param) =>
  param.name === 'fileName'
    ? { ...param, description: '原始上传文件名；Portal 五险一金上传控件不设置扩展名或 MIME 限制。' }
    : param,
)
const INSURANCE_FUND_SAVE_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: true, description: '姓名；Portal 表单必填，原样发送。' },
  { name: 'idcard', kind: 'text', required: true, description: '身份证件号；Portal 表单必填，原样发送。' },
  { name: 'personalFund', kind: 'number', required: true, description: '个人公积金；Portal a-input-number 必填，发送有限数字。' },
  { name: 'personalInsurance', kind: 'number', required: true, description: '个人社保；Portal a-input-number 必填，发送有限数字。' },
  { name: 'companyFund', kind: 'number', required: true, description: '公司公积金；Portal a-input-number 必填，发送有限数字。' },
  { name: 'companyInsurance', kind: 'number', required: true, description: '公司社保；Portal a-input-number 必填，发送有限数字。' },
]
const INSURANCE_FUND_UPDATE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '编辑详情回填的五险一金记录 ID；来自当前列表行/详情，不自行猜测。' },
  ...INSURANCE_FUND_SAVE_PARAMS,
]
const INSURANCE_FUND_SAVE_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: '对应 prepare 能力返回的五险一金完整表单草稿。' },
]
const INDICATOR_STATUS_PREPARE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '指标叶子节点ID。' },
  { name: 'dataType', kind: 'enum', required: true, description: '必须为2（指标叶子）；文件夹没有启停按钮。', options: [{ label: '指标', value: 2 }] },
  { name: 'currentStatus', kind: 'enum', required: true, description: '列表行当前状态：0停用、1启用；提交会按页面逻辑取反。', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] },
]
const STATUS_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: 'prepareIndicatorStatus 返回的 {id,status} 草稿。' },
]
const INDICATOR_DELETE_PREPARE_PARAMS: ParamSpec[] = [
  { name: 'ids', kind: 'array', required: true, description: '待删指标/文件夹ID数组；删除文件夹时由调用方按页面规则先展开整棵子树。' },
  { name: 'dataType', kind: 'enum', required: false, description: '传单行时为1文件夹或2指标；批量树删除可省略。', options: [{ label: '文件夹', value: 1 }, { label: '指标', value: 2 }] },
  { name: 'currentStatus', kind: 'enum', required: false, description: '单个指标行的最新状态；启用中（1）时与 Portal 一样拒绝删除。', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] },
]
const DELETE_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'draft', kind: 'text', required: true, description: 'prepare 删除能力返回的非空、无重复ID草稿。' },
]
const ID_ARRAY_PARAMS: ParamSpec[] = [
  { name: 'ids', kind: 'array', required: true, description: '非空、无重复的后端ID数组；请求体按页面真实形状发送。' },
]

export const perfManageConfigCapabilities: CapabilityDefinition[] = [
  {
    id: 'perf-manage-formula-definition-list',
    title: '查询公式定义列表（公式配置页）',
    pagePath: PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
    permission: '/dashboard/manage/formula-definition',
    write: false,
    params: FORMULA_PARAMS,
  },
  {
    id: 'perf-manage-indicator-list',
    title: '查询指标树（指标管理页）',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: INDICATOR_PARAMS,
  },
  {
    id: 'perf-manage-indicator-prepare-save-data',
    title: '准备保存指标预测实际数据',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: INDICATOR_DATA_SAVE_FORM_PARAMS,
  },
  {
    id: 'perf-manage-indicator-save-data',
    title: '保存指标预测实际数据',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: true,
    params: INDICATOR_DATA_SAVE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-indicator-cancel-save-data',
    title: '取消保存指标预测实际数据',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: [],
  },
  {
    id: 'perf-manage-insurance-list',
    title: '查询五险一金列表',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: INSURANCE_PARAMS,
  },
  {
    id: 'perf-manage-insurance-prepare-create',
    title: '准备新建五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: INSURANCE_FUND_SAVE_PARAMS,
  },
  {
    id: 'perf-manage-insurance-create',
    title: '新建五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: true,
    params: INSURANCE_FUND_SAVE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-insurance-cancel-create',
    title: '取消新建五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: [],
  },
  {
    id: 'perf-manage-insurance-prepare-update',
    title: '准备编辑五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: INSURANCE_FUND_UPDATE_PARAMS,
  },
  {
    id: 'perf-manage-insurance-update',
    title: '编辑五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: true,
    params: INSURANCE_FUND_SAVE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-insurance-cancel-update',
    title: '取消编辑五险一金记录',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: [],
  },
  {
    id: 'perf-manage-standard-list',
    title: '查询标准库树（标准管理页）',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: false,
    params: STANDARD_PARAMS,
  },
  {
    id: 'perf-manage-standard-prepare-save-data',
    title: '准备保存标准数据',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: false,
    params: STANDARD_DATA_SAVE_FORM_PARAMS,
  },
  {
    id: 'perf-manage-standard-save-data',
    title: '保存标准数据',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: true,
    params: STANDARD_DATA_SAVE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-standard-cancel-save-data',
    title: '取消保存标准数据',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: false,
    params: [],
  },
  {
    id: 'perf-manage-protocol-config-read',
    title: '读协议时间节点配置（时间节点页，含定性指标提示内容）',
    pagePath: PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
    permission: '/dashboard/manage/protocol-configuration',
    write: false,
    params: PROTOCOL_CONFIG_PARAMS,
  },
  {
    id: 'perf-manage-protocol-config-update',
    title: '保存协议时间节点配置',
    pagePath: PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
    permission: '/dashboard/manage/protocol-configuration',
    write: true,
    params: PROTOCOL_CONFIG_UPDATE_PARAMS,
  },
  {
    id: 'perf-manage-protocol-deduct-rule-list',
    title: '查询协议考核扣分规则（考核规则页）',
    pagePath: PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH,
    permission: '/dashboard/manage/protocol-deduct-rule',
    write: false,
    params: PROTOCOL_DEDUCT_RULE_PARAMS,
  },
  {
    id: 'perf-manage-protocol-deduct-rule-update',
    title: '更新协议考核扣分规则',
    pagePath: PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH,
    permission: '/dashboard/manage/protocol-deduct-rule',
    write: true,
    params: PROTOCOL_DEDUCT_RULE_UPDATE_PARAMS,
  },
  {
    id: 'perf-manage-formula-definition-prepare-save',
    title: '准备保存并发布公式',
    pagePath: PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
    permission: '/dashboard/manage/formula-definition',
    write: false,
    params: FORMULA_SAVE_FORM_PARAMS,
  },
  {
    id: 'perf-manage-formula-definition-save-and-publish',
    title: '保存并发布公式',
    pagePath: PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
    permission: '/dashboard/manage/formula-definition',
    write: true,
    params: FORMULA_SAVE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-formula-definition-cancel-save',
    title: '取消保存公式草稿',
    pagePath: PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
    permission: '/dashboard/manage/formula-definition',
    write: false,
    params: [],
  },
  {
    id: 'perf-manage-indicator-prepare-import',
    title: '准备导入指标树',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: INDICATOR_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-indicator-import',
    title: '导入指标树',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: true,
    params: INDICATOR_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-indicator-prepare-status',
    title: '准备启用或停用指标',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: INDICATOR_STATUS_PREPARE_PARAMS,
  },
  {
    id: 'perf-manage-indicator-update-status',
    title: '启用或停用指标',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: true,
    params: STATUS_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-indicator-prepare-delete',
    title: '准备批量删除指标树节点',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: false,
    params: INDICATOR_DELETE_PREPARE_PARAMS,
  },
  {
    id: 'perf-manage-indicator-delete',
    title: '批量删除指标树节点',
    pagePath: PERF_MANAGE_INDICATOR_PAGE_PATH,
    permission: '/dashboard/manage/indicator',
    write: true,
    params: DELETE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-insurance-prepare-import',
    title: '准备导入五险一金',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: INSURANCE_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-insurance-import',
    title: '导入五险一金',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: true,
    params: INSURANCE_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-insurance-prepare-delete',
    title: '准备批量删除五险一金',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: false,
    params: ID_ARRAY_PARAMS,
  },
  {
    id: 'perf-manage-insurance-delete',
    title: '批量删除五险一金',
    pagePath: PERF_MANAGE_INSURANCE_PAGE_PATH,
    permission: '/dashboard/manage/insurance',
    write: true,
    params: DELETE_DRAFT_PARAMS,
  },
  {
    id: 'perf-manage-standard-prepare-import',
    title: '准备导入标准库',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: false,
    params: STANDARD_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-standard-import',
    title: '导入标准库',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: true,
    params: STANDARD_IMPORT_PARAMS,
  },
  {
    id: 'perf-manage-standard-prepare-delete',
    title: '准备批量删除标准库节点',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: false,
    params: ID_ARRAY_PARAMS,
  },
  {
    id: 'perf-manage-standard-delete',
    title: '批量删除标准库节点',
    pagePath: PERF_MANAGE_STANDARD_PAGE_PATH,
    permission: '/dashboard/manage/standard',
    write: true,
    params: DELETE_DRAFT_PARAMS,
  },
]

/** 主线程接入 invoke/catalog 时使用的能力 ID → capability 方法映射。 */
export const PERF_MANAGE_CONFIG_METHODS = {
  'perf-manage-formula-definition-list': 'listFormulaDefinitions',
  'perf-manage-indicator-list': 'listIndicators',
  'perf-manage-insurance-list': 'listInsuranceFunds',
  'perf-manage-insurance-prepare-create': 'prepareInsuranceFundCreate',
  'perf-manage-insurance-create': 'createInsuranceFund',
  'perf-manage-insurance-cancel-create': 'cancelInsuranceFundCreate',
  'perf-manage-insurance-prepare-update': 'prepareInsuranceFundUpdate',
  'perf-manage-insurance-update': 'updateInsuranceFund',
  'perf-manage-insurance-cancel-update': 'cancelInsuranceFundUpdate',
  'perf-manage-standard-list': 'listStandards',
  'perf-manage-protocol-config-read': 'readProtocolConfig',
  'perf-manage-protocol-config-update': 'updateProtocolConfig',
  'perf-manage-protocol-deduct-rule-list': 'listProtocolDeductRules',
  'perf-manage-protocol-deduct-rule-update': 'updateProtocolDeductRule',
  'perf-manage-formula-definition-prepare-save': 'prepareFormulaDefinitionSave',
  'perf-manage-formula-definition-save-and-publish': 'saveAndPublishFormulaDefinition',
  'perf-manage-formula-definition-cancel-save': 'cancelFormulaDefinitionSave',
  'perf-manage-indicator-prepare-save-data': 'prepareIndicatorDataSave',
  'perf-manage-indicator-save-data': 'submitIndicatorDataSave',
  'perf-manage-indicator-cancel-save-data': 'cancelIndicatorDataSave',
  'perf-manage-indicator-prepare-import': 'prepareIndicatorImport',
  'perf-manage-indicator-import': 'importIndicators',
  'perf-manage-indicator-prepare-status': 'prepareIndicatorStatus',
  'perf-manage-indicator-update-status': 'updateIndicatorStatus',
  'perf-manage-indicator-prepare-delete': 'prepareIndicatorDelete',
  'perf-manage-indicator-delete': 'deleteIndicators',
  'perf-manage-insurance-prepare-import': 'prepareInsuranceImport',
  'perf-manage-insurance-import': 'importInsuranceFunds',
  'perf-manage-insurance-prepare-delete': 'prepareInsuranceDelete',
  'perf-manage-insurance-delete': 'deleteInsuranceFunds',
  'perf-manage-standard-prepare-import': 'prepareStandardImport',
  'perf-manage-standard-import': 'importStandards',
  'perf-manage-standard-prepare-delete': 'prepareStandardDelete',
  'perf-manage-standard-delete': 'deleteStandards',
  'perf-manage-standard-prepare-save-data': 'prepareStandardDataSave',
  'perf-manage-standard-save-data': 'submitStandardDataSave',
  'perf-manage-standard-cancel-save-data': 'cancelStandardDataSave',
} as const

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 能力实现。六个 `request` 由 SDK 门面注入，**每页一个** ——
 * 这样 `module-type` 按各自的页面解析（六页都是 13 绩效管理，但这一点不该由这里假定）。
 *
 * 六页全部走 platform 实例，所以调用方不需要额外配 `httpBaseUrls`。
 */
export function createPerfManageConfigCapability (
  /** 公式配置页 */
  requestFormulaDefinition: PortalRequest,
  /** 指标管理页 */
  requestIndicator: PortalRequest,
  /** 五险一金页 */
  requestInsurance: PortalRequest,
  /** 标准管理页 */
  requestStandard: PortalRequest,
  /** 时间节点页 */
  requestProtocolConfig: PortalRequest,
  /** 考核规则页 */
  requestProtocolDeductRule: PortalRequest,
) {
  /** 字典分组的两种形态收敛到这里：HTTP 原始 `[{dictType, dataList}]` */
  const dictGroups = (payload: unknown): DictGroup[] =>
    Array.isArray(payload) ? (payload as DictGroup[]) : []

  return {
    /**
     * 分页查询**公式定义**。只读。
     *
     * ⚠️ 这一页没有 `order`/`orderField`（它不是 `useListPageModule` 页面），
     * 且不传 `taskType`/`enabled` 时**这两项不会出现在 URL 上** —— 是刻意复刻页面初值。
     *
     * 返回 `{ list, total }`（后端 `/definition/page` 返回的是 `PageResult`）。
     * 行里的 `configJson` 是**结构化公式配置的 JSON 字符串**，页面每处都自己 `JSON.parse`；
     * 本能力**不解析**它（解析器是页面自己的 `structured.js`，无头复刻没有意义）。
     */
    listFormulaDefinitions (query: FormulaDefinitionQuery = {}): Promise<PageResult<FormulaDefinitionRow>> {
      return requestFormulaDefinition<PageResult<FormulaDefinitionRow>>({
        url: FORMULA_DEFINITION_PAGE_URL,
        method: 'get',
        params: buildParams(FORMULA_FIELDS, query as Record<string, unknown>),
      })
    },

    /**
     * 任务类型 / 场景候选（只读）。**页面挂载时自己会发这条**（无任何参数），
     * 本能力把它单独拿出来，因为 `listFormulaDefinitions` 的 `taskType` 取值只能从这里来。
     *
     * 页面会把同一个 `taskType` 的多条取 `sceneRevision` 最大的那条（`activeScenes`）——
     * 这里**原样返回全部行**，归一留给调用方：页面那份"取最新修订"的规则属于页面逻辑，
     * 塞进能力里会让"接口到底返回了什么"变得看不见。
     */
    async listFormulaScenes (): Promise<FormulaSceneRow[]> {
      const payload = await requestFormulaDefinition<unknown>({
        url: FORMULA_SCENE_LIST_URL,
        method: 'get',
      })
      // 页面写的是 `const rows = Array.isArray(data) ? data : data.list || data.records || []`
      // （`dataOf()` 那层 `result.data || result` 在 SDK 侧已经由包络拆解做掉了）
      if (Array.isArray(payload)) return payload as FormulaSceneRow[]
      const holder = (payload ?? {}) as { list?: unknown; records?: unknown }
      const rows = holder.list ?? holder.records
      return Array.isArray(rows) ? (rows as FormulaSceneRow[]) : []
    },

    /**
     * 只在本地校验并冻结公式发布草稿，不发请求。
     * Portal 的编辑器在这里已经把公式配置和 AST 序列化好；Java 仍会做最终一致性校验。
     */
    prepareFormulaDefinitionSave (input: FormulaDefinitionSaveAndPublishInput): { draft: FormulaDefinitionSaveAndPublishDraft } {
      return { draft: formulaSavePayloadOf(input) }
    },

    /**
     * Portal「保存并发布」唯一写入口。请求体顺序是：编辑时 id、formulaName、taskType、
     * configJson、astJson、description、publishRemark；新建时省略 id。
     */
    async saveAndPublishFormulaDefinition (input: { draft: FormulaDefinitionSaveAndPublishDraft }): Promise<FormulaDefinitionRevision> {
      const payload = formulaSavePayloadOf(input?.draft)
      return formulaRevisionOf(await requestFormulaDefinition<unknown>({
        url: FORMULA_DEFINITION_SAVE_AND_PUBLISH_URL,
        method: 'post',
        data: payload,
      }))
    },

    /** 公式草稿没有服务端副作用；取消只返回本地状态，不发送取消请求。 */
    cancelFormulaDefinitionSave (): { cancelled: true } {
      return { cancelled: true }
    },

    /**
     * 查**指标树**。只读。
     *
     * ⚠️ 三处与隔壁页不同，别照抄：
     * 1. **没有 `pageNo`/`pageSize`**（`getDataListIsPage` 默认 false），后端那个 `page` 也是死的
     *    （`selectList` 里分页那段被注释掉了）—— 它返回一整棵**树**，不是分页结果。
     * 2. `name`/`creatorName`/`type` 三个参数后端**不认**，只有 `targetType` 真筛（见文件头）。
     * 3. 页面还会在本地把 `"名称"` 输入框的值过滤一遍（`templateName`，**从不发给后端**）；
     *    本能力不复制这一步，要按名称找请取回树自己过滤。
     *
     * 返回的是**树节点数组**（`children` 保留）。页面会把空 `children` 摘掉再渲染，
     * 那一步是纯展示，这里不做。
     */
    listIndicators (query: IndicatorQuery = {}): Promise<IndicatorRow[]> {
      return requestIndicator<IndicatorRow[]>({
        url: INDICATOR_PAGE_URL,
        method: 'get',
        params: buildParams(INDICATOR_FIELDS, query as Record<string, unknown>),
      })
    },

    /** 只在本地校验并冻结指标详情页的预测/实际数据草稿，不发请求。 */
    prepareIndicatorDataSave (input: IndicatorDataSave): { draft: IndicatorDataSave } {
      return { draft: indicatorDataSaveOf(input) }
    },

    /** 复刻 indicator-data.vue 的 body：actualTarget、forecastTarget，再追加 targetId。 */
    async submitIndicatorDataSave (input: { draft: IndicatorDataSave }): Promise<void> {
      await requestIndicator({
        url: INDICATOR_SAVE_DATA_URL,
        method: 'post',
        data: indicatorDataSaveOf(input?.draft),
      })
    },

    /** 指标详情页取消只返回本地状态，不调用取消接口。 */
    cancelIndicatorDataSave (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 导入弹窗只做本地校验/预览；浏览器在选择文件后还未产生服务端副作用。 */
    prepareIndicatorImport (input: IndicatorImportInput) {
      const normalized = indicatorImportOf(input)
      const preview = filePreviewOf(normalized, '指标导入文件', true)
      return {
        fileName: preview.fileName,
        contentType: preview.contentType,
        byteLength: preview.byteLength,
        type: normalized.type,
        parentId: normalized.parentId ?? '',
      }
    },

    /**
     * 指标树导入：FormData 键顺序严格为 file → type → parentId；根目录 parentId 是空串。
     * Portal 显式声明 multipart/form-data，返回 Java 的失败名称数组。
     */
    async importIndicators (input: IndicatorImportInput): Promise<string[]> {
      const normalized = indicatorImportOf(input)
      const data = formDataWithFile(normalized, '指标导入文件', true)
      appendImportFields(data, normalized.type, parentIdOf(normalized.parentId))
      const result = await requestMultipart<unknown>(requestIndicator, {
        url: INDICATOR_IMPORT_URL,
        method: 'post',
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (!Array.isArray(result) || result.some(item => typeof item !== 'string')) throw new Error('指标导入响应必须是失败名称字符串数组')
      return result
    },

    /** 根据列表行的 dataType/status 复刻 Portal 的启停按钮条件，并计算取反后的状态。 */
    prepareIndicatorStatus (input: IndicatorStatusInput): { draft: IndicatorStatusDraft } {
      return { draft: indicatorStatusPayloadOf(input) }
    },

    async updateIndicatorStatus (input: { draft: IndicatorStatusDraft }): Promise<void> {
      const draft = indicatorStatusDraftOf(input?.draft)
      await requestIndicator({
        url: INDICATOR_UPDATE_STATUS_URL,
        method: 'put',
        data: { id: draft.id, status: draft.status },
      })
    },

    /** 删除单个指标时锁住页面对启用中叶子的 disabled 条件；文件夹场景保留页面展开出的 ids。 */
    prepareIndicatorDelete (input: IndicatorDeleteInput): { draft: PerfManageConfigDeleteDraft } {
      return { draft: indicatorDeletePayloadOf(input) }
    },

    async deleteIndicators (input: { draft: PerfManageConfigDeleteDraft }): Promise<void> {
      const draft = deleteDraftOf(input?.draft, '指标删除草稿')
      await requestIndicator({
        url: INDICATOR_DELETE_URL,
        method: 'delete',
        data: { ids: draft.ids },
      })
    },

    /**
     * 分页查询**五险一金**。只读。六页里唯一有分页的一页。
     *
     * `name`/`idcard` 是真的服务端模糊筛；`order`/`orderField` 是排序参数（照发以对齐浏览器），
     * 但后端要求两个**都非空**才 apply，而页面两个都发空串 ⇒ 默认不排序。
     */
    listInsuranceFunds (query: InsuranceFundQuery = {}): Promise<PageResult<InsuranceFundRow>> {
      return requestInsurance<PageResult<InsuranceFundRow>>({
        url: INSURANCE_FUND_PAGE_URL,
        method: 'get',
        params: buildParams(INSURANCE_FIELDS, query as Record<string, unknown>),
      })
    },

    /** 新建表单只在本地校验；Portal 的 customSubmit 在确认后才发 POST /sys/user。 */
    prepareInsuranceFundCreate (input: InsuranceFundSaveInput): { draft: InsuranceFundSaveDraft } {
      return { draft: insuranceFundSaveDraftOf(input, false) }
    },

    async createInsuranceFund (input: { draft: InsuranceFundSaveDraft }): Promise<void> {
      const draft = insuranceFundSaveDraftOf(input?.draft, false)
      await requestInsurance({ url: INSURANCE_FUND_SAVE_URL, method: 'post', data: draft })
    },

    cancelInsuranceFundCreate (): { cancelled: true } {
      return { cancelled: true }
    },

    /** 编辑表单必须带详情回填的 id；其余六个字段按 Portal 原字段名发送。 */
    prepareInsuranceFundUpdate (input: InsuranceFundSaveInput): { draft: InsuranceFundSaveDraft } {
      return { draft: insuranceFundSaveDraftOf(input, true) }
    },

    async updateInsuranceFund (input: { draft: InsuranceFundSaveDraft }): Promise<void> {
      const draft = insuranceFundSaveDraftOf(input?.draft, true)
      await requestInsurance({ url: INSURANCE_FUND_SAVE_URL, method: 'put', data: draft })
    },

    cancelInsuranceFundUpdate (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareInsuranceImport (input: InsuranceImportInput) {
      const normalized = insuranceImportOf(input)
      // Portal 的 upload-dragger 没有 accept/beforeUpload，保留其“选到文件即提交”的边界。
      const preview = filePreviewOf(normalized, '五险一金导入文件', false, false)
      return preview
    },

    /** 五险一金上传只传一个 multipart 字段 file；Portal 没有手工覆写 headers。 */
    async importInsuranceFunds (input: InsuranceImportInput): Promise<void> {
      const normalized = insuranceImportOf(input)
      await requestInsurance({
        url: INSURANCE_IMPORT_URL,
        method: 'post',
        data: formDataWithFile(normalized, '五险一金导入文件', false, false),
      })
    },

    prepareInsuranceDelete (input: { ids: PerfManageConfigId[] }): { draft: PerfManageConfigDeleteDraft } {
      return { draft: deleteDraftOf(input, '五险一金删除参数') }
    },

    /** Java controller 接收 Long[]；Portal 声明式批量删除发送裸数组而不是 {ids}。 */
    async deleteInsuranceFunds (input: { draft: PerfManageConfigDeleteDraft }): Promise<void> {
      const draft = deleteDraftOf(input?.draft, '五险一金删除草稿')
      await requestInsurance({
        url: INSURANCE_DELETE_URL,
        method: 'delete',
        data: draft.ids,
      })
    },

    /**
     * 分页查**标准库的一层**（线上版的按层分页树）。只读。
     *
     * ⚠️ **接口由 `keyword` 决定**（页面就是这么写的，见 `STANDARD_FIELDS`）：
     * - `keyword` 空 → `GET /performance/kpistandard/treePage`（按 `parentId` 取这一层）
     * - `keyword` 非空 → `GET /performance/kpistandard/searchPage`（跨层搜索，顺带 `dataType=2`）
     *
     * 三条照抄页面的钳制/钉死，调用方改不了：
     * `selection=false` 写死；`pageSize` 钳到 ≤100；`dataType` 只在搜索那一支才出现。
     *
     * 返回 `{ list, total }`。页面还会把每个节点的 `children` 摘掉再渲染
     * （按层浏览时它没用）—— 那一步是纯展示，本能力保留原样。
     */
    listStandards (query: StandardQuery = {}): Promise<PageResult<StandardRow>> {
      const keyword = String(query.keyword ?? '').trim()
      const searching = keyword !== ''
      const params = buildParams(STANDARD_FIELDS, {
        ...query,
        keyword,
        // 页面的写法：`dataType: keyword ? 2 : undefined` —— 不搜索时**整项不出现**
        dataType: searching ? 2 : undefined,
        // 页面写死的，不是表单字段
        selection: false,
        pageNo: Number(query.pageNo) || 1,
        pageSize: Math.min(Number(query.pageSize) || DEFAULT_PAGE_SIZE, STANDARD_MAX_PAGE_SIZE),
      })
      return requestStandard<PageResult<StandardRow>>({
        url: searching ? STANDARD_SEARCH_PAGE_URL : STANDARD_TREE_PAGE_URL,
        method: 'get',
        params,
      })
    },

    /** 只在本地校验标准详情页整个 formState，不发请求。 */
    prepareStandardDataSave (input: StandardDataSave): { draft: StandardDataSave } {
      return { draft: standardDataSaveOf(input) }
    },

    /** Portal 直接把整个 formState 作为 POST body，保留Java DTO和页面回显的额外字段。 */
    async submitStandardDataSave (input: { draft: StandardDataSave }): Promise<void> {
      await requestStandard({
        url: STANDARD_SAVE_DATA_URL,
        method: 'post',
        data: standardDataSaveOf(input?.draft),
      })
    },

    /** 标准详情页取消只返回本地状态，不调用取消接口。 */
    cancelStandardDataSave (): { cancelled: true } {
      return { cancelled: true }
    },

    prepareStandardImport (input: StandardImportInput) {
      const normalized = standardImportOf(input)
      const preview = filePreviewOf(normalized, '标准库导入文件', true)
      return { ...preview, type: normalized.type, parentId: normalized.parentId ?? '' }
    },

    /** 标准库导入：FormData 键顺序严格为 file → type → parentId。 */
    async importStandards (input: StandardImportInput): Promise<void> {
      const normalized = standardImportOf(input)
      const data = formDataWithFile(normalized, '标准库导入文件', true)
      appendImportFields(data, normalized.type, parentIdOf(normalized.parentId))
      await requestMultipart<void>(requestStandard, {
        url: STANDARD_IMPORT_URL,
        method: 'post',
        data,
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },

    prepareStandardDelete (input: { ids: PerfManageConfigId[] }): { draft: PerfManageConfigDeleteDraft } {
      return { draft: deleteDraftOf(input, '标准库删除参数') }
    },

    /** Java controller 接收 Long[]；页面真实请求体是裸数组。 */
    async deleteStandards (input: { draft: PerfManageConfigDeleteDraft }): Promise<void> {
      const draft = deleteDraftOf(input?.draft, '标准库删除草稿')
      await requestStandard({
        url: STANDARD_DELETE_URL,
        method: 'delete',
        data: draft.ids,
      })
    },

    /**
     * 读**时间节点配置**（页面卡片标题是「协议配置」）。只读。
     *
     * 这一页**没有列表请求** —— 它是纯表单页。页面上显示的 8 个时间节点 +
     * 定性指标提示内容，来自**全局字典**（`fetchAllDicts()` → `GET /system/dict-data/grouped-list`），
     * 本能力读的就是它，按 `dictType` 过滤出页面用到的两组：
     *
     * - `protocol_config`：8 条，`value` 是配置项名（`year_submit_review_time` 等），
     *   `label` 是**值本身** —— 「次年 MM-DD」类的取 `label.substring(0,5)`（`MM-DD`），
     *   其余取 `label.substring(0,2)`（`DD`，其中 `'99'` = 每月最后一天）。
     * - `template_prompt_content`：只有一条，`label` 是定性指标的提示文案。
     *
     * ⚠️ 注意取值的**位置反直觉**：键在 `value`、值在 `label`。
     *
     * 不传 `dictType` 时两组一起返回（页面自己两次用到它们）。
     *
     * 返回体按 `dictType` 分组；**某一组整个缺失**表示它没出现在 `grouped-list` 里
     * （字典没配），与"这组是空数组"是两件事。枚举外的 `dictType` **当场抛**，不静默返回空。
     */
    async readProtocolConfig (
      dictType?: ProtocolConfigDictType,
    ): Promise<Record<string, ProtocolConfigEntry[]>> {
      if (dictType !== undefined && !PROTOCOL_CONFIG_DICT_TYPES.includes(dictType)) {
        throw new Error(
          `readProtocolConfig 只认 ${PROTOCOL_CONFIG_DICT_TYPES.join(' / ')}（页面用到的两组），` +
            `收到的是 ${JSON.stringify(dictType)}`,
        )
      }
      const payload = await requestProtocolConfig<unknown>({
        url: DICT_GROUPED_LIST_URL,
        method: 'get',
      })
      const wanted: readonly string[] = dictType === undefined ? PROTOCOL_CONFIG_DICT_TYPES : [dictType]
      const result: Record<string, ProtocolConfigEntry[]> = {}
      for (const group of dictGroups(payload)) {
        if (typeof group.dictType !== 'string' || !wanted.includes(group.dictType)) continue
        result[group.dictType] = Array.isArray(group.dataList) ? group.dataList : []
      }
      return result
    },

    /**
     * 读**字典类型的 id**（只读）。
     *
     * 这是时间节点页**自己发的那两条请求**（`GET /sys/dict/type/page?dictType=…`，挂载时并发），
     * 页面拿到的只是字典类型的 `id`（保存时当 `dictTypeId`）—— **值不在这个接口里**，
     * 要值请用 `readProtocolConfig()`。之所以照做一份，是因为排障时"页面到底发了什么"要能复现。
     */
    getDictTypeId (dictType: ProtocolConfigDictType): Promise<DictTypeRow | null> {
      return requestProtocolConfig<{ list?: DictTypeRow[] }>({
        url: DICT_TYPE_PAGE_URL,
        method: 'get',
        params: { dictType },
      }).then((payload) => payload?.list?.[0] ?? null)
    },

    /**
     * 保存时间节点页的两组字典值。Portal 保存按钮不是一个请求：先 PUT 日期数组，
     * 再 PUT `template_prompt_content[0]`；第二次失败时第一次可能已经成功，调用方不能把
     * 失败当成整组自动回滚，也不能自动重试。请求体严格只保留页面映射出的四个字段。
     */
    async updateProtocolConfig (params: ProtocolConfigUpdate): Promise<void> {
      if (!Array.isArray(params?.dateEntries)) throw new Error('dateEntries 必须是字典更新项数组')
      const dateEntries = params.dateEntries.map((entry, index) => normalizeDictDataUpdate(entry, `dateEntries[${index}]`))
      const contentEntry = normalizeDictDataUpdate(params?.contentEntry, 'contentEntry')
      await requestProtocolConfig({
        url: DICT_DATA_UPDATE_LIST_URL,
        method: 'put',
        data: dateEntries,
      })
      await requestProtocolConfig({
        url: DICT_DATA_UPDATE_URL,
        method: 'put',
        data: contentEntry,
      })
    },

    /**
     * 查**协议考核扣分规则**（固定六条）。只读。
     *
     * ⚠️ 这一条接口**一个参数都没有**（页面就是 `http.get(url)`）——
     * 参数表是空的，**是有意的**。返回 `{ rules, enabledCount, annualRuleCount, monthlyRuleCount }`，
     * 页面在本地按 `periodType` 分成年度/月度两块渲染。
     *
     * ⚠️ 后端这条接口带 `@PreAuthorize("@ss.hasPermission('hr:performance-config:manage')")`
     * —— **403 是可能的**，而菜单可见性（conventions 15）判不出它。别拿菜单预判。
     */
    listProtocolDeductRules (): Promise<ProtocolDeductRuleList> {
      return requestProtocolDeductRule<ProtocolDeductRuleList>({
        url: `${PROTOCOL_DEDUCT_RULE_BASE_URL}/list`,
        method: 'get',
      })
    },

    /**
     * 单条规则详情（只读）。`ruleCode` 取值范围见 `PROTOCOL_RULE_CODES`；后端 `@NotBlank`。
     *
     * `async` 是**刻意**的（与 `studyStatistics.listGradeLessons` 同一条理由）：
     * 参数错误要走 **Promise.reject**，不是同步抛 —— 调用方 `await` 时才接得住。
     */
    async getProtocolDeductRule (ruleCode: string): Promise<ProtocolDeductRule> {
      if (typeof ruleCode !== 'string' || ruleCode.trim() === '') {
        throw new Error(`getProtocolDeductRule 需要 ruleCode（六条固定规则之一），收到 ${JSON.stringify(ruleCode)}`)
      }
      return requestProtocolDeductRule<ProtocolDeductRule>({
        url: `${PROTOCOL_DEDUCT_RULE_BASE_URL}/get`,
        method: 'get',
        params: { ruleCode },
      })
    },

    /** 规则的历史版本（只读）。页面「历史版本」抽屉读的就是它。校验同样是 `Promise.reject` */
    async listProtocolDeductRuleHistory (ruleCode: string): Promise<ProtocolDeductRule[]> {
      if (typeof ruleCode !== 'string' || ruleCode.trim() === '') {
        throw new Error(
          `listProtocolDeductRuleHistory 需要 ruleCode（六条固定规则之一），收到 ${JSON.stringify(ruleCode)}`,
        )
      }
      return requestProtocolDeductRule<ProtocolDeductRule[]>({
        url: `${PROTOCOL_DEDUCT_RULE_BASE_URL}/history`,
        method: 'get',
        params: { ruleCode },
      })
    },

    /**
     * 保存规则编辑抽屉的请求体。页面已经把年度/月度差异归一到
     * `deadlineMonth/deadlineDay=null`，并在固定扣一次模式把 `maxScore` 设成 `singleScore`；
     * 后端再按规则类型、分值、版本做最终校验。没有 requestId，版本冲突或超时都先回查。
     */
    async updateProtocolDeductRule (update: ProtocolDeductRuleUpdate): Promise<ProtocolDeductRule> {
      const payload = normalizeProtocolDeductRuleUpdate(update)
      return requestProtocolDeductRule<ProtocolDeductRule>({
        url: `${PROTOCOL_DEDUCT_RULE_BASE_URL}/update`,
        method: 'put',
        data: payload,
      })
    },
  }
}

export type PerfManageConfigCapability = ReturnType<typeof createPerfManageConfigCapability>
