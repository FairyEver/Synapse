import { Buffer } from 'node:buffer'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

/**
 * 绩效管理域（`moduleType = 13`）—— 菜单 `performance_menus` 下的六个页面。
 *
 * 菜单出处：`app/portal/menus/hr.js:4-36`（`performance_menus`）。
 * 六页**分属三个菜单组**，形态也**三种各不相同**，所以这个文件一层套一层的差异
 * 比同域其它页（比如「课堂三页共用同一个接口」那种）多得多。
 *
 * | 菜单组 | 页面 | 菜单路径 | 标题（逐字取自菜单） | 路由文件 | 形态 |
 * | --- | --- | --- | --- | --- | --- |
 * | （顶层） | 个人分析 | `/dashboard/analysis/person/list` | 个人分析 | `…/hr/analysis/person/list.vue` | **仪表盘**，不是列表 |
 * | （顶层） | 管理分析 | `/dashboard/analysis/department/list` | 管理分析 | `…/hr/analysis/department/list.vue` | **仪表盘** + 一个自查列表 |
 * | 结果管理 | 奖励导入 | `/dashboard/salary/main/list` | 奖励导入 | `…/hr/salary/main/list.vue` | 列表，**POST** |
 * | 结果管理 | 工资找齐 | `/dashboard/salary/adjust/list` | 工资找齐 | `…/hr/salary/adjust/list.vue` | 列表，**POST** |
 * | 结果管理 | 考核导入 | `/dashboard/salary/examine-result/list` | 考核导入 | `…/hr/salary/examine-result/list.vue` | 列表，**POST** |
 * | 基础配置 | 组件管理 | `/dashboard/block/main/list` | 组件管理 | `…/hr/block/main/list.vue` | 列表，**GET** |
 *
 * ⚠️ **标题以菜单文件为准，不是 `generated/page-catalog.json` 的 `title`。**
 * 任务说明里给的三个人类可读标题与仓库里的都对不上（基准 JSON 的 `页面` 字段沿用了
 * 那份说明，同样对不上），实测菜单原文是「奖励导入」「工资找齐」「考核导入」
 * —— 不是"薪酬主表 / 调薪 / 考核结果"。「管理分析」那一页基准里叫"部门分析"，同理。
 * `title` 与 `docs/pages/<页面>.md` 的文件名都按**菜单原文**；
 * `pagePath` 与 `page-catalog.json` 的 `menuPath` 逐字相同。
 *
 * ⚠️ **`page-catalog` 把 `/dashboard/analysis/person/list` 标成「其他/自定义页面」是对的** ——
 * 它既不用 `useListPageModule`，也没有 `order`/`orderField`/`pageNo`/`pageSize`
 * （见下面「参数顺序」第 3 条）。别按列表页的套路套它。
 *
 * ---------------------------------------------------------------------------
 * 参数顺序是从源码推出来的，不是抄基准
 * ---------------------------------------------------------------------------
 *
 * `common/libs/renren/list.js:473-483` 把**列表页**的参数拼成：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * ```
 *
 * ⇒ 列表页的顺序恒为 **`order` → `orderField` → `convertFetchForm` 的返回值 →
 * `pageNo` → `pageSize`**（GET 再补 `_t`）。
 * 四个列表页的 `convertFetchForm` 都用的是 `list.js:466-468` 那个透传默认值
 * (`createHook(e => e)`)，所以 `_form` 就是页面 `form:` 的初值原样展开。
 * 四页都**没有** `order`/`orderField` 控件（`list.js:295-296` 初值空串），钉死成 `''`。
 *
 * 但这一组有**三处不能照抄列表页的地方**：
 *
 * 1. **三个薪酬页是 POST，不是 GET。** `customLoad` 里是
 *    `http.post(url, form)` —— `form` 就是上面那个 `params` 对象**整体当 body**。
 *    于是 **`_t` 不在 body 里**（`platform.js:36-41` 只给 `config.method === 'get'` 加 `_t`），
 *    且 `order`/`orderField` **照样在 body 里**（`order`/`orderField` 由 list.js 无条件加，
 *    与"空值发不发"无关）。只有「组件管理」那一页是 GET。
 * 2. **两个分析页根本不是列表页**：`person` 是 `useAsyncState` 直接 `http.get`，
 *    `department` 是四个 `http.post` 拼出来的仪表盘 + 一个**只在本地有勾选时才会发**的自查列表。
 *    它们的参数里**没有 `order`/`orderField`/`pageNo`/`pageSize`**。
 * 3. **空值一律照发**（四个列表页都是），但**默认值四页不同**：
 *    「奖励导入」的 `year`/`month` 默认是**当前年月**（`dayjs().format('YYYY')` /
 *    `dayjs().month() + 1`），另外三页默认**全空**。别把"默认空"当成全组的规矩。
 *
 * 另外一条贯穿全组的坑：**`year` 是字符串、`month` 是数字**（三页薪酬列表都是
 * `<a-date-picker picker="year" value-format="YYYY">` + 数字 `monthOptionsMaker()`
 * 的 1..12）。而两个分析页的 `year`/`month` 一个是**字符串**（person，`format('M')`
 * 不补零）一个是**数字**（department，`Number(format('MM'))`）。
 * 见 `buildSalaryYearMonth` / `buildPersonYearMonth` / `buildDeptYearMonth` 三个 helper。
 *
 * ---------------------------------------------------------------------------
 * 基准覆盖情况：**六页全部有基准，逐字段核准过**
 * ---------------------------------------------------------------------------
 *
 * 逐字段基准：`baseline/perf-salary.browser.json`（测试环境，六个页面各导航一次抓的，14 条请求）。
 *
 * | 页面 | 基准里有 | 状态 |
 * | --- | --- | --- |
 * | 奖励导入 | POST body **逐字段 + 键序** | ✅ 与本文件契约一致 |
 * | 工资找齐 | POST body **逐字段 + 键序** | ✅ 一致 |
 * | 考核导入 | POST body **逐字段 + 键序** | ✅ 一致 |
 * | 组件管理 | GET query **逐字段 + 键序 + `_t` 位次** | ✅ 一致 |
 * | 管理分析 | **四条**统计 POST 的 body + 组织候选 | ✅ 一致 |
 * | 个人分析 | **两条** GET 的 query（只有 `year`/`month`/`_t`） | ✅ 一致 |
 *
 * 第一版基准只抓到两个分析页的"候选"那一条，因此这两页的契约一度是纯静态推导。
 * **重抓后四条统计 POST 与两条 GET 全在**，这两页也已逐字段对上：
 *
 * - **管理分析**四条统计 POST 的 body 逐字相同：
 *   `{"year":2026,"month":8,"organizationIdList":["34"],"temIdList":[]}` ——
 *   键序 `year → month → organizationIdList → temIdList`、**年月的值是裸数字**、
 *   `organizationIdList` 是**数组**（元素是字符串 id），全部与本文件一致。
 *   ⇒ 上一版里那个"`initialize()` 的 `await getFirstOrg()` 没 try/catch、一抛后面就不执行"
 *   的猜测**已被证伪**：线上就是会发这四条（`deptScoreStatisticsInfo` 那条也发，
 *   哪怕它的卡片在源码里被注释掉了）。
 * - **个人分析**两条 GET：`?year=2026&month=8&_t=…` ——
 *   **只有两个参数**（没有 `order`/`orderField`/`pageNo`/`pageSize`），
 *   `month=8` **不补零**。两页的年月类型相反（dept 数字 / person 字符串）也印证了。
 *
 * 两页的默认值同样被基准印证：抓取时间是 **2026-09-21**，抓到的都是 `month=8`
 * —— 即**上月**，与源码的 `dayjs().subtract(1,'month')` 一致（不是"当前月"）。
 *
 * ⚠️ **本地 Portal 检出落后于部署到测试环境的版本**（已确认：薪酬结构 / 标准两页
 * 线上用的是 `treePage`，本地源码里没有）。**本文件这六页目前没发现与基准冲突的地方** ——
 * 六页逐字段都对上了。但**一旦冲突，一律以基准为准**：基准是线上真实行为，
 * 本地源码只是它的一个可能已经过期的快照。
 *
 * 基准顺带落实了另一件原本只是推断的事：这些请求的**请求头里 `module-type: 13`**
 * （绩效管理），与 `page-catalog.json` 的 `moduleType` 一致。
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 敏感字段：本组页面的响应里有工资与证件信息，**没有写进类型定义**
 * ---------------------------------------------------------------------------
 *
 * 「奖励导入」的列表列、「个人分析」的工资卡片里都有**个人所得税口径的工资项**与
 * **身份证号**。本文件**不把它们作为具名字段列进行类型**（只保留 `[key: string]: unknown`
 * 透传），以免它们被当成"普通业务字段"进入提示词或日志。
 *
 * ⚠️ **不具名 ≠ 不返回。** 这些字段照样在响应里、照样从索引签名透传出去。
 * 调用方需要知道"拿到的行里有敏感数据"，这一条逐页写在
 * `docs/pages/<页面>.md` 的「敏感字段」一节（`docs/pages/奖励导入.md` 那份最全）。
 *
 * ---------------------------------------------------------------------------
 * 写入口的边界
 * ---------------------------------------------------------------------------
 *
 * 本文件同时覆盖页面里能实际到达的导入、导出、调整、考核结果维护与组件启停。
 *
 * 这些写动作拆成 `prepare → submit` 两步：prepare 只做与 Portal 表单相同的本地校验和
 * 请求草稿装配，cancel 由调用方丢弃草稿即可，不会发请求。
 * - 「工资找齐」：「调整 / 批量调整」→ `POST /salary/basedata/hrsalarymanagement/saveAdjust`，
 *   body `{ adjustScore, adjustProfit, adjustRemark, idList }`（`idList` 是**行 id 数组**，
 *   批量调整时是勾选跨页并集）。**它会直接改真实工资数据**，是这组里最重的一条写。
 * - 「考核导入」：`DELETE /performance/examineresult`（`deleteIsBatch: true`，
 *   body 是 **id 数组**；单删时也是数组 `[id]` —— `list.js:517-520`）、
 *   `POST /performance/examineresult/import`（xlsx 导入）、
 *   模板下载；行内的「编辑」与顶部的「新建」是**路由跳转**（`./edit/{id}` / `./create/new`），
 *   不是接口。
 * - 「组件管理」：`PUT /performance/basedata/kpisubassembly`，body `{ id, status }`
 *   （`status === 0 ? 1 : 0`，即**同一个接口做启用与禁用**，形状正好是 prepare → submit）。
 *
 * 详情页的“查看”弹窗只有本地渲染，没有额外 HTTP，因此不虚构一个 SDK 能力。
 */

// ---------------------------------------------------------------------------
// 页面路径（逐字取自 `generated/page-catalog.json` 的 `menuPath`）
// ---------------------------------------------------------------------------

export const PERF_SALARY_MAIN_PAGE_PATH = '/dashboard/salary/main/list'
export const PERF_SALARY_ADJUST_PAGE_PATH = '/dashboard/salary/adjust/list'
export const PERF_SALARY_EXAMINE_RESULT_PAGE_PATH = '/dashboard/salary/examine-result/list'
export const PERF_BLOCK_MAIN_PAGE_PATH = '/dashboard/block/main/list'
export const PERF_ANALYSIS_DEPARTMENT_PAGE_PATH = '/dashboard/analysis/department/list'
export const PERF_ANALYSIS_PERSON_PAGE_PATH = '/dashboard/analysis/person/list'

const VIEWS = 'app/portal/views/dashboard/hr'

/** 六个路由文件，写进文档与排障时用得上 */
export const PERF_SALARY_ROUTE_FILES = {
  salaryMain: `${VIEWS}/salary/main/list.vue`,
  salaryAdjust: `${VIEWS}/salary/adjust/list.vue`,
  salaryExamineResult: `${VIEWS}/salary/examine-result/list.vue`,
  blockMain: `${VIEWS}/block/main/list.vue`,
  analysisDepartment: `${VIEWS}/analysis/department/list.vue`,
  analysisPerson: `${VIEWS}/analysis/person/list.vue`,
} as const

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

/** 「奖励导入」分页查询。**POST**，body 是参数对象（不是 query） */
export const SALARY_MAIN_LIST_URL = '/salary/basedata/hrsalarymanagement/page'
/** 奖励工资 xlsx 导入。Portal 只接受 MIME 为 xlsx 的文件。 */
export const SALARY_MAIN_IMPORT_URL = '/salary/basedata/hrsalarymanagement/import'
/** 奖励工资导出，body 不是分页参数。 */
export const SALARY_MAIN_EXPORT_URL = '/salary/basedata/hrsalarymanagement/export'
/** 奖励工资导入模板。 */
export const SALARY_MAIN_TEMPLATE_URL = '/salary/basedata/hrsalarymanagement/download'
/** 「工资找齐」分页查询。**POST** */
export const SALARY_ADJUST_LIST_URL = '/salary/basedata/hrsalarymanagement/adjustPage'
/** 工资找齐批量调整。 */
export const SALARY_ADJUST_SAVE_URL = '/salary/basedata/hrsalarymanagement/saveAdjust'
/** 「考核导入」分页查询。**POST** */
export const SALARY_EXAMINE_RESULT_LIST_URL = '/performance/examineresult/page'
/** 考核结果详情与 create/update/delete 共用的资源路径。 */
export const SALARY_EXAMINE_RESULT_URL = '/performance/examineresult'
/** 考核结果 xlsx 导入。 */
export const SALARY_EXAMINE_RESULT_IMPORT_URL = '/performance/examineresult/import'
/** 考核结果导入模板。 */
export const SALARY_EXAMINE_RESULT_TEMPLATE_URL = '/performance/basedata/kpitarget/download'
/** 「组件管理」分页查询。**GET** —— 本组唯一走 `getDataListURL` 默认通道的一页 */
export const BLOCK_MAIN_LIST_URL = '/performance/basedata/kpisubassembly/page'
/** 组件启停共用的 PUT。 */
export const BLOCK_MAIN_UPDATE_URL = '/performance/basedata/kpisubassembly'

/** 管理分析页的四个统计端点。四个**同一个 body**，只是返回值不同 */
export const ANALYSIS_DEPARTMENT_URLS = {
  /** → `{ signInfoDTO, scoreInfoDto, monthProtocolInfo }`（表 + 饼图） */
  monthProtocolInfo: '/performance/statistics/homepage/deptMonthProtocolInfo',
  /** → `[{ key, value }]`（签订数量折线图） */
  deptSignStatisticsInfo: '/performance/statistics/homepage/deptSignStatisticsInfo',
  /** → `[{ key, value: { signNumber, totalNumber, signRate } }]`（部门柱状图） */
  branchDeptSignInfo: '/performance/statistics/homepage/branchDeptSignInfo',
  /**
   * → `[{ key, value }]`。⚠️ 页面上对应的卡片**已被注释掉**
   * （`department/list.vue:106-126`），但 `search()` / `initialize()` 里仍然在调它
   * （`department/list.vue:495`）—— 所以**挂载时这条请求真的会发**。
   * 本能力保留它，因为"页面实际发的请求"就是这个。
   */
  deptScoreStatisticsInfo: '/performance/statistics/homepage/deptScoreStatisticsInfo',
} as const

/** 管理分析页「自查分析」表格。**POST**，`getDataListIsPage` 被注释掉 ⇒ 无分页参数 */
export const ANALYSIS_DEPARTMENT_SELF_CHECK_URL = '/performance/statistics/homepage/selfCheck'

/** 个人分析页的两个端点。**GET**，params 只有 `{ year, month }` + `_t` */
export const ANALYSIS_PERSON_URLS = {
  /** → `{ avgProgress, unfinishedNumber, status }`（顶部三块指标） */
  monthProtocolInfo: '/performance/statistics/homepage/monthProtocolInfo',
  /** → `{ cooperateTaskNumberDTO, salaryScoreDetailDTO, scoreTrendDTO }`（两张折线图 + 工资表） */
  personalStatistics: '/performance/statistics/homepage/personalStatistics',
} as const

/**
 * 六个页面共同的组织筛选候选来源（`portal-hxr-tree-select-role-org` 的 `url`）。
 *
 * 这是**页面自己的下拉**在拉的接口（`organizationIdList` / `orgIdList` 的候选）。
 * 本文件**不提供**这个入口：它按角色返回一整棵树（`base-sale.ts:154` 记为 #13，
 * 实测 596,663 B），属于 D6 / H35 说的「长选项参数」那一类 ——
 * 无头照抄会冲掉调用方上下文。要用组织 id 请从别处拿，或由调用方自己传。
 */
export const PERF_ORG_TREE_URL = '/org/organization/getRoleOrganizationTree'

/** 默认每页条数。四页都写了 `useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

// ---------------------------------------------------------------------------
// 行类型
// ---------------------------------------------------------------------------

/**
 * 薪酬列表行。
 *
 * 列表响应仍允许 Portal 后端追加未登记字段，但页面实际消费的字段要具名声明。
 * 其中 `idCard` 是敏感字段；声明它的类型不代表调用方可以默认展示或记录它。
 */
export type SalaryRow = {
  id?: string | number
  /** 姓名 */
  name?: string
  /** 工号 */
  staffCode?: string
  /** 年度（字符串，如 `'2026'`） */
  year?: string
  /** 月份（1..12） */
  month?: number
  [key: string]: unknown
}

/** Portal 薪酬详情中的金额原值；页面直接以工资金额展示，不在 SDK 内换算单位。 */
export type SalaryMoneyValue = number | string | null

/** `奖励导入`详情页通过列表行桥接的工资明细。 */
export type SalaryMainRewardSalaryEntity = {
  weekdayOvertime?: SalaryMoneyValue
  weekendOvertime?: SalaryMoneyValue
  statutoryHolidayOvertime?: SalaryMoneyValue
  laborFee?: SalaryMoneyValue
  benefitBonus?: SalaryMoneyValue
  closureFee?: SalaryMoneyValue
  communicatePerk?: SalaryMoneyValue
  contributionFee?: SalaryMoneyValue
  educationPerk?: SalaryMoneyValue
  fullAttendanceBonus?: SalaryMoneyValue
  goodHealthDeduction?: SalaryMoneyValue
  dutyFee?: SalaryMoneyValue
  heatingFee?: SalaryMoneyValue
  heatstrokePreventionFee?: SalaryMoneyValue
  housePurchaseDeduction?: SalaryMoneyValue
  onlyChildrenPerk?: SalaryMoneyValue
  otherDeduction?: SalaryMoneyValue
  otherPerk?: SalaryMoneyValue
  otherSalary?: SalaryMoneyValue
  projectBonus?: SalaryMoneyValue
  seniorityPerk?: SalaryMoneyValue
  tenancyPerk?: SalaryMoneyValue
  trainBonus?: SalaryMoneyValue
  remark?: string | null
}

/** 「奖励导入」行；字段来自 Portal 列表和 detail.vue 的实际消费。 */
export type SalaryMainRow = SalaryRow & {
  /** 敏感字段：身份证号。仅声明原始字符串契约，不改变其最小披露边界。 */
  idCard?: string | null
  basicSalary?: SalaryMoneyValue
  examineSalary?: SalaryMoneyValue
  profitSalary?: SalaryMoneyValue
  rewardSalary?: SalaryMoneyValue
  totalSalary?: SalaryMoneyValue
  /** 详情页由列表行桥接出的工资明细。 */
  hrRewardSalaryEntity?: SalaryMainRewardSalaryEntity | null
}

/** 「考核导入」的行。`name` 在这一页是**考核名称**（不是人名），人名在 `realName` */
export type SalaryExamineResultRow = {
  id?: string | number
  /** 姓名（页面第一列叫「姓名」，取的是 `realName`） */
  realName?: string
  /** 考核名称 —— 注意与 `realName` 区分 */
  name?: string
  staffCode?: string
  year?: string
  month?: number
  unit?: string
  forecast?: number | string
  actual?: number | string
  score?: number | string
  money?: number | string
  [key: string]: unknown
}

/** 「工资找齐」的行 */
export type SalaryAdjustRow = {
  id?: string | number
  name?: string
  staffCode?: string
  year?: string
  month?: number
  /** 最后修改人 */
  adjusterName?: string
  adjustTime?: string
  /** 调整考核分数（页面对正数补 `+` 前缀显示） */
  adjustScore?: number | string
  /** 调整利润总金额（同上） */
  adjustProfit?: number | string
  adjustRemark?: string
  [key: string]: unknown
}

/** 「组件管理」的行。字段取自页面 `columns` */
export type BlockMainRow = {
  id?: string | number
  /** 组件名称 */
  name?: string
  /** 组件库类型（字典 `agreement_warehouse_type`） */
  warehouseType?: number | string
  /** 组件类型，取值见 BLOCK_TYPE_OPTIONS */
  type?: number
  /** 状态。页面按 `status === 0` 决定行尾按钮是「启用」还是「禁用」 */
  status?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 查询条件
// ---------------------------------------------------------------------------

/** 「奖励导入」查询条件 */
export type SalaryMainQuery = {
  /** 姓名（模糊） */
  name?: string
  /** 年度，`'YYYY'` 字符串。**默认当前年**。用 buildSalaryYearMonth 生成 */
  year?: string
  /** 月份 1..12。**默认当前月** */
  month?: number
  /** 组织 id 数组（`portal-hxr-tree-select-role-org` 的 `value-key="id"` + `multiple`） */
  orgIdList?: Array<string | number>
  pageNo?: number
  pageSize?: number
}

/** 「工资找齐」查询条件 */
export type SalaryAdjustQuery = {
  name?: string
  /** 工号 */
  staffCode?: string
  /** 年度 `'YYYY'`。⚠️ 与「奖励导入」不同，这一页**默认是空串**，不是当前年 */
  year?: string
  /** 月份 1..12。同上，**默认空串**（页面 form 初值是 `''`，不是 `null`） */
  month?: number | string
  orgIdList?: Array<string | number>
  pageNo?: number
  pageSize?: number
}

/**
 * 「考核导入」查询条件。
 *
 * ⚠️ 组织字段名是 **`organizationIdList`**（本组另外两页叫 `orgIdList`）——
 * 页面 `form` 初值里就是这么写的，别互相照抄。
 */
export type SalaryExamineResultQuery = {
  name?: string
  year?: string
  month?: number | string
  organizationIdList?: Array<string | number>
  pageNo?: number
  pageSize?: number
}

/** 「组件管理」查询条件 */
export type BlockMainQuery = {
  name?: string
  /** 组件库类型。字典 `agreement_warehouse_type` 的取值 —— 用 `base-dict-get` 取候选，本能力不给枚举 */
  warehouseType?: number | string
  /** 组件类型，见 BLOCK_TYPE_OPTIONS */
  type?: number | string
  pageNo?: number
  pageSize?: number
}

/** 管理分析页的统计 body（四个端点共用） */
export type AnalysisDepartmentQuery = {
  /** 年，**数字**。默认上月 */
  year?: number | string
  /** 月，**数字**。默认上月 */
  month?: number | string
  /** 组织 id 数组 */
  organizationIdList?: Array<string | number>
  /** 页面表单里有这个字段但没有控件，恒为 `[]` */
  temIdList?: Array<string | number>
}

/** 管理分析页「自查分析」查询条件 */
export type AnalysisDepartmentSelfCheckQuery = {
  /** 工号数组。**为空时页面发的是 `null`（不是 `[]`）** */
  staffCodeList?: Array<string | number> | null
  /** 年，数字；默认取自本地存储的上月 */
  year?: number | string
  /** 月，数字 */
  month?: number | string
}

/** 个人分析页查询条件 */
export type AnalysisPersonQuery = {
  /** 年，**字符串** `'YYYY'`。默认上月所属年 */
  year?: string
  /** 月，**字符串**且**不补零**（`format('M')` → `'9'`） */
  month?: string
}

// ---------------------------------------------------------------------------
// 页面动作输入
// ---------------------------------------------------------------------------

export type PerfSalaryId = string | number

/** 以 base64 传入的 Portal xlsx 文件。SDK 不读取本地路径，也不暴露凭据。 */
export type PerfSalaryFileInput = {
  fileName: string
  base64: string
  contentType?: string
}

export type PerfSalaryFile = {
  fileName: string
  contentType: string | null
  base64: string
  byteLength: number
}

/** 奖励导出使用页面表单的四个字段，不包含列表排序和分页字段。 */
export type SalaryMainExportQuery = {
  name?: string
  year?: string
  month?: number
  orgIdList?: Array<string | number>
}

/** 工资找齐表单；idList 来自调用方已经确认的行主键。 */
export type SalaryAdjustInput = {
  idList: PerfSalaryId[]
  adjustScore: number | string
  adjustProfit?: number | string | null
  adjustRemark?: string | null
}

export type SalaryAdjustDraft = {
  adjustScore: number | string
  adjustProfit: number | string
  adjustRemark: string
  idList: PerfSalaryId[]
}

/** 考核结果表单的键序与 Portal 隐藏路由表单一致。 */
export type SalaryExamineResultForm = {
  userId: PerfSalaryId
  staffCode?: string | number | null
  year: string | number
  month: string | number
  name: string
  unit: string
  forecast: number | string
  actual: number | string
  score: number | string
  money: number | string
}

export type SalaryExamineResultUpdate = SalaryExamineResultForm & { id: PerfSalaryId }

export type BlockStatusInput = { id: PerfSalaryId; currentStatus: 0 | 1 }
export type BlockStatusDraft = { id: PerfSalaryId; status: 0 | 1 }

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

/** 参数契约的固定顺序：调用方的实参顺序不影响序列化结果（设计 D20） */
type OrderedField = { name: string; defaultValue: unknown }

/**
 * 三页薪酬列表共用的开头两项。页面**没有** `order` / `orderField` 控件，
 * 是列表模块自己加的（`list.js:474-475`），所以钉死成空串、不开放。
 *
 * ⚠️ 空值**照发**：`order=`/`orderField=` 会真的出现在 body 里。
 */
const BASE_ORDER: ReadonlyArray<OrderedField> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
]

const PAGINATION: ReadonlyArray<OrderedField> = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 逐字抄各页 `form:` 初值的字段顺序。
 *
 * `convertFetchForm` 四页都是 `list.js` 的透传默认值，所以**表单初值的键序就是
 * 请求里的键序**（对象展开保序）。
 */
const SALARY_ADJUST_FIELDS: ReadonlyArray<OrderedField> = [
  { name: 'year', defaultValue: '' },
  { name: 'month', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'staffCode', defaultValue: '' },
  { name: 'orgIdList', defaultValue: [] as Array<string | number> },
]

const SALARY_EXAMINE_RESULT_FIELDS: ReadonlyArray<OrderedField> = [
  { name: 'name', defaultValue: '' },
  { name: 'year', defaultValue: '' },
  { name: 'month', defaultValue: '' },
  { name: 'organizationIdList', defaultValue: [] as Array<string | number> },
]

const BLOCK_MAIN_FIELDS: ReadonlyArray<OrderedField> = [
  { name: 'name', defaultValue: '' },
  { name: 'warehouseType', defaultValue: '' },
  { name: 'type', defaultValue: '' },
]

/**
 * 「奖励导入」的字段表。**必须每次现算** —— 它的 `year`/`month` 默认值是
 * `dayjs().format('YYYY')` 与 `dayjs().month() + 1`（`salary/main/list.vue:100-101`），
 * 也就是**当前年月**，不是常量。另外三页的默认值全是空串，所以只有这一页需要这样处理。
 */
function salaryMainOrder (): OrderedField[] {
  const now = new Date()
  return [
    { name: 'name', defaultValue: '' },
    { name: 'year', defaultValue: String(now.getFullYear()) },
    { name: 'month', defaultValue: now.getMonth() + 1 },
    { name: 'orgIdList', defaultValue: [] as Array<string | number> },
  ]
}

/**
 * 按契约里的**固定顺序**拼参数。
 *
 * - `query` 里显式为 `undefined` 的键 → 取该字段的默认值（**不是省略**）；
 * - `pinned` 覆盖同名字段（本文件用于把 `staffCodeList` 在为空时钉成 `null`）。
 */
function buildParams (
  order: ReadonlyArray<OrderedField>,
  query: Record<string, unknown>,
  pinned: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    if (Object.prototype.hasOwnProperty.call(pinned, item.name)) {
      params[item.name] = pinned[item.name]
      continue
    }
    const value = query[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

type JsonObject = Record<string, unknown>

function objectOf (value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value as JsonObject
}

function idOf (value: unknown, label: string): PerfSalaryId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  throw new Error(`${label}必须为正整数ID`)
}

function idsOf (value: unknown, label: string): PerfSalaryId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须为非空ID数组`)
  const ids = value.map((item, index) => idOf(item, `${label}[${index}]`))
  if (new Set(ids.map(String)).size !== ids.length) throw new Error(`${label}不能包含重复ID`)
  return ids
}

function optionalTextOf (value: unknown, label: string, fallback: string): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new Error(`${label}必须为字符串`)
  return value
}

function optionalStaffCodeOf (value: unknown): string | number {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return value
  throw new Error('staffCode必须为工号字符串或非负整数')
}

function requiredTextOf (value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}不能为空`)
  if (value.trim() === '') throw new Error(`${label}不能全为空格`)
  if (maxLength !== undefined && value.length > maxLength) throw new Error(`${label}最多${maxLength}个字符`)
  return value
}

function yearOf (value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value)
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new Error(`${label}必须为YYYY字符串`)
  return value
}

function monthOf (value: unknown, label: string): number {
  const month = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof month !== 'number' || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error(`${label}必须为1..12的整数`)
  }
  return month
}

function numberOf (
  value: unknown,
  label: string,
  maxDecimals: number,
  min = 0,
  max = 999999999,
): number | string {
  if (value === undefined || value === null || value === '') throw new Error(`${label}不能为空`)
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) throw new Error(`${label}必须在${min}..${max}范围内`)
  if (typeof value === 'string') {
    const fraction = value.trim().split('.')[1] ?? ''
    if (fraction.length > maxDecimals) throw new Error(`${label}最多保留${maxDecimals}位小数`)
    return value
  }
  const [, fraction = ''] = String(value).split('.')
  if (fraction.length > maxDecimals) throw new Error(`${label}最多保留${maxDecimals}位小数`)
  return value as number | string
}

function adjustNumberOf (value: unknown, label: string, required: boolean): number | string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label}不能为空`)
    return ''
  }
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(numeric) || numeric < -99999 || numeric > 99999) throw new Error(`${label}必须在-99999..99999范围内`)
  return value as number | string
}

function fileBytesOf (input: PerfSalaryFileInput): { fileName: string; contentType: string; bytes: Uint8Array } {
  const value = objectOf(input, '导入文件')
  const fileName = requiredTextOf(value.fileName, 'fileName')
  if (!/\.xlsx$/i.test(fileName)) throw new Error('fileName扩展名必须是.xlsx')
  const contentType = value.contentType === undefined || value.contentType === ''
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : value.contentType
  if (typeof contentType !== 'string' || contentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    throw new Error('contentType必须是xlsx MIME类型')
  }
  const base64 = requiredTextOf(value.base64, 'base64').replace(/\s+/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('base64不是合法的标准Base64')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.byteLength) throw new Error('导入文件不能为空')
  return { fileName, contentType, bytes: new Uint8Array(bytes) }
}

function filePreviewOf (input: PerfSalaryFileInput): { fileName: string; contentType: string; byteLength: number } {
  const file = fileBytesOf(input)
  return { fileName: file.fileName, contentType: file.contentType, byteLength: file.bytes.byteLength }
}

function fileOf (response: AxiosResponse<ArrayBuffer>, fallback: string): PerfSalaryFile {
  const data: unknown = response?.data
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
  if (!bytes || bytes.byteLength === 0) throw new Error('绩效薪资文件响应为空文件')
  const headers = response.headers as unknown as { get?: (name: string) => unknown; [key: string]: unknown }
  const contentDisposition = typeof headers.get === 'function' ? headers.get('content-disposition') : headers['content-disposition']
  const header = typeof contentDisposition === 'string' ? contentDisposition : ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  let fileName = fallback
  if (encoded) {
    try { fileName = decodeURIComponent(encoded.replace(/^"|"$/g, '')) } catch { fileName = encoded }
  } else fileName = /filename="?([^";]+)"?/i.exec(header)?.[1] || fallback
  const contentType = typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type']
  return {
    fileName,
    contentType: typeof contentType === 'string' && contentType ? contentType : null,
    base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
    byteLength: bytes.byteLength,
  }
}

function formDataOf (input: PerfSalaryFileInput): FormData {
  const file = fileBytesOf(input)
  const data = new FormData()
  const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer
  data.append('file', new Blob([buffer], { type: file.contentType }), file.fileName)
  return data
}

function salaryMainExportParamsOf (input: SalaryMainExportQuery = {}): JsonObject {
  const now = new Date()
  const name = optionalTextOf(input.name, 'name', '')
  const year = input.year === undefined ? String(now.getFullYear()) : yearOf(input.year, 'year')
  const month = input.month === undefined ? now.getMonth() + 1 : monthOf(input.month, 'month')
  const ids = input.orgIdList === undefined || input.orgIdList.length === 0 ? [] : idsOf(input.orgIdList, 'orgIdList')
  return { name, year, month, orgIdList: ids.length ? ids.join(',') : '' }
}

function salaryAdjustPayloadOf (input: SalaryAdjustInput): SalaryAdjustDraft {
  const value = objectOf(input, '工资找齐调整表单')
  const adjustScore = adjustNumberOf(value.adjustScore, 'adjustScore', true)
  const adjustProfit = adjustNumberOf(value.adjustProfit, 'adjustProfit', false)
  const adjustRemark = optionalTextOf(value.adjustRemark, 'adjustRemark', '')
  if (adjustRemark.trim() === '' && adjustRemark.length > 0) throw new Error('adjustRemark不能全为空格')
  if (adjustRemark.length > 500) throw new Error('adjustRemark最多500个字符')
  return { adjustScore, adjustProfit, adjustRemark, idList: idsOf(value.idList, 'idList') }
}

function examineResultPayloadOf (input: SalaryExamineResultForm | SalaryExamineResultUpdate, withId: boolean): JsonObject {
  const value = objectOf(input, '考核结果表单')
  const payload: JsonObject = {
    userId: idOf(value.userId, 'userId'),
    staffCode: optionalStaffCodeOf(value.staffCode),
    year: yearOf(value.year, 'year'),
    month: monthOf(value.month, 'month'),
    name: requiredTextOf(value.name, 'name', 50),
    unit: requiredTextOf(value.unit, 'unit', 10),
    forecast: numberOf(value.forecast, 'forecast', 3),
    actual: numberOf(value.actual, 'actual', 3),
    score: numberOf(value.score, 'score', 2),
    money: numberOf(value.money, 'money', 2),
  }
  if (withId) payload.id = idOf(value.id, 'id')
  return payload
}

function blockStatusPayloadOf (input: BlockStatusInput): BlockStatusDraft {
  const value = objectOf(input, '组件状态表单')
  if (value.currentStatus !== 0 && value.currentStatus !== 1) throw new Error('currentStatus必须为0或1')
  return { id: idOf(value.id, 'id'), status: value.currentStatus === 0 ? 1 : 0 }
}

// ---------------------------------------------------------------------------
// 年月 helper：三个页面族三种格式，别互相照抄
// ---------------------------------------------------------------------------

/**
 * 页面的年月初值：**上月**（三处都是 `dayjs().subtract(1, 'month')` ——
 * `person/list.vue:146`、`department/list.vue:317`、`department/list.vue:349`）。
 */
function defaultYearMonth (): { year: number; month: number } {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return { year: lastMonth.getFullYear(), month: lastMonth.getMonth() + 1 }
}

function assertYearMonth (ym: string, label: string): { year: number; month: number } {
  const matched = /^(\d{4})-(\d{1,2})(?=$|-)/.exec(ym)
  if (!matched) {
    throw new Error(`${label}应为 YYYY-MM（或带日期的同格式字符串）`)
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  if (month < 1 || month > 12) {
    throw new Error(`${label}的月份应在 1..12`)
  }
  return { year, month }
}

/**
 * 三页**薪酬列表**的 `year`/`month`：`year` 是**字符串** `'YYYY'`、`month` 是**数字** 1..12。
 *
 * 出处：`<a-date-picker picker="year" value-format="YYYY">` 给出字符串年，
 * 月份下拉是 `monthOptionsMaker()`（`common.js:19-25`，`value` 是 `Number`）。
 */
export function buildSalaryYearMonth (yearMonth: string): { year: string; month: number } {
  const { year, month } = assertYearMonth(yearMonth, '薪酬查询的年月')
  return { year: String(year), month }
}

/**
 * **个人分析页**的 `year`/`month`：两个都是**字符串**，且 `month` **不补零**。
 *
 * 出处：`analysis/person/list.vue:149-154` 的 `formComputed`
 * （`format('YYYY')` 与 `format('M')`），且**没有** `Number(...)` 包着 ——
 * 所以 9 月发出去的是 `month=9`（字符串），不是数字。
 */
export function buildPersonYearMonth (yearMonth: string): { year: string; month: string } {
  const { year, month } = assertYearMonth(yearMonth, '个人分析的年月')
  return { year: String(year), month: String(month) }
}

/**
 * **管理分析页**的 `year`/`month`：两个都是**数字**。
 *
 * 出处：`analysis/department/list.vue:354-361` 的 `formComputed`
 * （`Number(...format('YYYY'))` 与 `Number(...format('MM'))`）。
 *
 * ⚠️ 与个人分析页**同一组字段名、同一个"上月"默认值、类型却相反** ——
 * 这是本文件里最容易照抄错的一处。
 */
export function buildDeptYearMonth (yearMonth: string): { year: number; month: number } {
  return assertYearMonth(yearMonth, '管理分析的年月')
}

// ---------------------------------------------------------------------------
// 「组件管理」的组件类型取值
// ---------------------------------------------------------------------------

/**
 * 「组件管理」页面上「组件类型」下拉的候选。
 *
 * ⚠️ **不是接口枚举** —— 页面是 `keys(blocks)` 现算的（`block/main/list.vue:102-107`），
 * 而 `blocks` 来自前端**本地 glob**（`app/portal/utils/hr/agreement-blocks/index.js:3-9`
 * 的 `import.meta.glob`，通配 `contents/` 下**每个** `index.js`，按各模块导出的 `type` 建索引）。
 * 下表就是把那 12 个模块的 `type`/`title` 逐个读出来（**实测自源码**，不是猜的）。
 *
 * 它同时用于**列表筛选**（`params.type`）与**行内展示**
 * （`typeOptions.find(item => item.value === record.type)?.label`）——
 * 说明后端的 `kpisubassembly.type` 用的就是这一套值。
 */
export const BLOCK_TYPE_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '输入框', value: 1 },
  { label: '表格', value: 2 },
  { label: '签订', value: 3 },
  { label: '年度员工信息', value: 4 },
  { label: '月度员工信息', value: 5 },
  { label: '年度重点工作', value: 6 },
  { label: '月度重点工作', value: 7 },
  { label: '年度指标', value: 8 },
  { label: '月度指标', value: 9 },
  { label: '年度利润', value: 14 },
  { label: '月度利润', value: 15 },
  { label: '奖励工资', value: 16 },
]

// ---------------------------------------------------------------------------
// 参数契约
// ---------------------------------------------------------------------------

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/** 三页薪酬列表共用的 `year`/`month`/组织三个参数的说明（默认值三页不同，见各自定义） */
const SALARY_YEAR_PARAM = (description: string): ParamSpec => ({
  name: 'year',
  kind: 'date',
  required: false,
  description: `年度，\`'YYYY'\` **字符串**（年选择器 value-format）。${description}。用 buildSalaryYearMonth 生成`,
})

const SALARY_MONTH_PARAM = (description: string): ParamSpec => ({
  name: 'month',
  kind: 'number',
  required: false,
  description: `月份 1..12，**数字**（不是 '09' 这种补零字符串）。${description}`,
})

const SALARY_ORG_PARAM = (name: string): ParamSpec => ({
  name,
  kind: 'tree',
  required: false,
  description:
    '组织 id（**数组**）。页面的控件是 portal-hxr-tree-select-role-org（value-key="id" + multiple）。' +
    `候选来自 ${PERF_ORG_TREE_URL}，那是**按角色**返回的整棵树（约 580 KB），本 SDK 不提供这个入口。` +
    '可用的替代入口是 `base-dept-search`（部门树，走 `/system/dept/list-all-simple`）—— ' +
    '⚠️ 它与页面那个接口**不是同一个**，两边 id 是否同一套**未实测**，传之前先各自确认一次',
})

const SALARY_MAIN_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '姓名（模糊匹配）' },
  SALARY_YEAR_PARAM('⚠️ 这一页**默认当前年**（dayjs().format(\'YYYY\')），不是空'),
  SALARY_MONTH_PARAM('⚠️ 这一页**默认当前月**，不是空'),
  SALARY_ORG_PARAM('orgIdList'),
  ...PAGE_PARAMS,
]

const SALARY_ADJUST_PARAMS: ParamSpec[] = [
  SALARY_YEAR_PARAM('⚠️ 这一页与「奖励导入」不同，**默认空串**'),
  SALARY_MONTH_PARAM('⚠️ 同上，**默认空串**'),
  { name: 'name', kind: 'text', required: false, description: '姓名（模糊匹配）' },
  { name: 'staffCode', kind: 'text', required: false, description: '工号' },
  SALARY_ORG_PARAM('orgIdList'),
  ...PAGE_PARAMS,
]

const SALARY_EXAMINE_RESULT_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '姓名（模糊匹配，对应返回行的 `realName`）' },
  SALARY_YEAR_PARAM('默认空串'),
  SALARY_MONTH_PARAM('默认空串'),
  SALARY_ORG_PARAM('organizationIdList'),
  ...PAGE_PARAMS,
]

const BLOCK_MAIN_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '组件名称（模糊匹配）' },
  {
    name: 'warehouseType',
    kind: 'enum',
    required: false,
    description:
      '组件库类型。控件是 `portal-hxr-dict-select type="agreement_warehouse_type"` —— ' +
      '取值由**平台字典**现读，可运维改，所以这里**不给枚举**（不要猜）。' +
      '要候选请调 `base-dict-get`（`dictType = agreement_warehouse_type`）；该 dictType 本身是否登记过**未实测**，' +
      '先失败就用 `base-dict-search` 找一下名字',
  },
  {
    name: 'type',
    kind: 'enum',
    required: false,
    description:
      '组件类型。取值来自**前端本地**枚举（见 BLOCK_TYPE_OPTIONS，实测自源码：1 输入框 / 2 表格 / 3 签订 / ' +
      '4 年度员工信息 / 5 月度员工信息 / 6 年度重点工作 / 7 月度重点工作 / 8 年度指标 / 9 月度指标 / ' +
      '14 年度利润 / 15 月度利润 / 16 奖励工资）',
    options: BLOCK_TYPE_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  ...PAGE_PARAMS,
]

const ANALYSIS_DEPARTMENT_PARAMS: ParamSpec[] = [
  {
    name: 'year',
    kind: 'number',
    required: false,
    description: '年，**数字**（与个人分析页的字符串不同）。默认上月所属年。用 buildDeptYearMonth 生成',
  },
  {
    name: 'month',
    kind: 'number',
    required: false,
    description: '月，**数字**。默认上月。用 buildDeptYearMonth 生成',
  },
  SALARY_ORG_PARAM('organizationIdList'),
]

const ANALYSIS_DEPARTMENT_SELF_CHECK_PARAMS: ParamSpec[] = [
  {
    name: 'staffCodeList',
    kind: 'search',
    required: true,
    description:
      '自查人员的**工号数组**。这一页**不能空查**：页面只有在本地勾选表非空时才发这条请求 ' +
      '（`selfSearch()` 里的 `if (staffCodeList.length > 0)`），空的时候它连请求都不发。' +
      '⚠️ 为空时页面发的是 `null` 而不是 `[]`（`department/list.vue:409`）—— 本能力照此处理',
  },
  { name: 'year', kind: 'number', required: false, description: '年，**数字**。默认上月。用 buildDeptYearMonth 生成' },
  { name: 'month', kind: 'number', required: false, description: '月，**数字**。默认上月。用 buildDeptYearMonth 生成' },
]

const ANALYSIS_PERSON_PARAMS: ParamSpec[] = [
  {
    name: 'year',
    kind: 'date',
    required: false,
    description: '年，**字符串** `\'YYYY\'`。默认上月所属年。用 buildPersonYearMonth 生成',
  },
  {
    name: 'month',
    kind: 'date',
    required: false,
    description:
      '月，**字符串且不补零**（`format(\'M\')` → 9 月是 `\'9\'`）。默认上月。用 buildPersonYearMonth 生成',
  },
]

const PERF_FILE_PARAMS: ParamSpec[] = [
  { name: 'fileName', kind: 'text', required: true, description: '只接受.xlsx 文件名' },
  { name: 'base64', kind: 'text', required: true, description: '非空标准 Base64 文件内容' },
  { name: 'contentType', kind: 'text', required: false, description: '必须是 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
]

const SALARY_MAIN_EXPORT_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '姓名（模糊匹配）' },
  { name: 'year', kind: 'date', required: false, description: '年度，YYYY 字符串；默认当前年' },
  { name: 'month', kind: 'number', required: false, description: '月份 1..12 数字；默认当前月' },
  SALARY_ORG_PARAM('orgIdList'),
]

const SALARY_ADJUST_ACTION_PARAMS: ParamSpec[] = [
  { name: 'adjustScore', kind: 'number', required: true, description: '调整考核分数，范围 -99999..99999' },
  { name: 'adjustProfit', kind: 'number', required: false, description: '调整利润总金额，范围 -99999..99999；省略时按 Portal 空串提交' },
  { name: 'adjustRemark', kind: 'text', required: false, description: '备注；不能全为空格，最多500个字符' },
  { name: 'idList', kind: 'array', required: true, description: '类型为 `(string | number)[]` 的已确认行 ID 数组；不能重复；SDK 不替调用方猜测跨页选择' },
]

const SALARY_EXAMINE_FORM_PARAMS: ParamSpec[] = [
  { name: 'userId', kind: 'search', required: true, description: '人员 ID；来自 Portal 人员选择器的候选' },
  { name: 'staffCode', kind: 'text', required: false, description: '人员工号；由 Portal 选择人员时带出，只读' },
  { name: 'year', kind: 'date', required: true, description: '年度，YYYY 字符串' },
  { name: 'month', kind: 'number', required: true, description: '月份 1..12 数字' },
  { name: 'name', kind: 'text', required: true, description: '考核名称；不能全为空格，最多50个字符' },
  { name: 'unit', kind: 'text', required: true, description: '计量单位；不能全为空格，最多10个字符' },
  { name: 'forecast', kind: 'number', required: true, description: '预测值，0..999999999，最多3位小数' },
  { name: 'actual', kind: 'number', required: true, description: '实际值，0..999999999，最多3位小数' },
  { name: 'score', kind: 'number', required: true, description: '分数，0..999999999，最多2位小数' },
  { name: 'money', kind: 'number', required: true, description: '金额，0..999999999，最多2位小数' },
]

const SALARY_EXAMINE_UPDATE_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '考核结果 ID；必须来自详情' },
  ...SALARY_EXAMINE_FORM_PARAMS,
]

const SALARY_EXAMINE_REMOVE_PARAMS: ParamSpec[] = [
  { name: 'ids', kind: 'array', required: true, description: '类型为 `(string | number)[]` 的考核结果 ID 数组；单删也必须传数组' },
]

const BLOCK_STATUS_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '组件记录 ID' },
  { name: 'currentStatus', kind: 'enum', required: true, description: '列表中最新状态；0 将启用，1 将停用', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] },
]

const BLOCK_STATUS_DRAFT_PARAMS: ParamSpec[] = [
  { name: 'id', kind: 'text', required: true, description: '组件记录 ID' },
  { name: 'status', kind: 'enum', required: true, description: '准备阶段根据 currentStatus 计算出的目标状态', options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] },
]

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const perfSalaryCapabilities: CapabilityDefinition[] = [
  {
    id: 'perf-salary-main-list',
    title: '查询奖励导入列表',
    pagePath: PERF_SALARY_MAIN_PAGE_PATH,
    permission: '/dashboard/salary/main',
    write: false,
    params: SALARY_MAIN_PARAMS,
  },
  {
    id: 'perf-salary-main-download-template',
    title: '下载奖励工资导入模板',
    pagePath: PERF_SALARY_MAIN_PAGE_PATH,
    permission: '/dashboard/salary/main',
    write: false,
    params: [],
  },
  {
    id: 'perf-salary-main-export',
    title: '导出奖励工资列表',
    pagePath: PERF_SALARY_MAIN_PAGE_PATH,
    permission: '/dashboard/salary/main',
    write: false,
    params: SALARY_MAIN_EXPORT_PARAMS,
  },
  {
    id: 'perf-salary-main-prepare-import',
    title: '准备导入奖励工资文件',
    pagePath: PERF_SALARY_MAIN_PAGE_PATH,
    permission: '/dashboard/salary/main',
    write: false,
    params: PERF_FILE_PARAMS,
  },
  {
    id: 'perf-salary-main-import',
    title: '导入奖励工资文件',
    pagePath: PERF_SALARY_MAIN_PAGE_PATH,
    permission: '/dashboard/salary/main',
    write: true,
    params: PERF_FILE_PARAMS,
  },
  {
    id: 'perf-salary-adjust-list',
    title: '查询工资找齐列表',
    pagePath: PERF_SALARY_ADJUST_PAGE_PATH,
    permission: '/dashboard/salary/adjust',
    write: false,
    params: SALARY_ADJUST_PARAMS,
  },
  {
    id: 'perf-salary-adjust-prepare-save',
    title: '准备工资找齐调整',
    pagePath: PERF_SALARY_ADJUST_PAGE_PATH,
    permission: '/dashboard/salary/adjust',
    write: false,
    params: SALARY_ADJUST_ACTION_PARAMS,
  },
  {
    id: 'perf-salary-adjust-save',
    title: '保存工资找齐调整',
    pagePath: PERF_SALARY_ADJUST_PAGE_PATH,
    permission: '/dashboard/salary/adjust',
    write: true,
    params: SALARY_ADJUST_ACTION_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-list',
    title: '查询考核导入列表',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: SALARY_EXAMINE_RESULT_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-get',
    title: '读取考核结果详情',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: [{ name: 'id', kind: 'text', required: true, description: '考核结果 ID' }],
  },
  {
    id: 'perf-salary-examine-result-prepare-create',
    title: '准备新建考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: SALARY_EXAMINE_FORM_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-create',
    title: '新建考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: true,
    params: SALARY_EXAMINE_FORM_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-prepare-update',
    title: '准备编辑考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: SALARY_EXAMINE_UPDATE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-update',
    title: '编辑考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: true,
    params: SALARY_EXAMINE_UPDATE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-prepare-remove',
    title: '准备删除考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: SALARY_EXAMINE_REMOVE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-remove',
    title: '删除考核结果',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: true,
    params: SALARY_EXAMINE_REMOVE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-prepare-import',
    title: '准备导入考核结果文件',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: PERF_FILE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-import',
    title: '导入考核结果文件',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: true,
    params: PERF_FILE_PARAMS,
  },
  {
    id: 'perf-salary-examine-result-download-template',
    title: '下载考核结果导入模板',
    pagePath: PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
    permission: '/dashboard/salary/examine-result',
    write: false,
    params: [],
  },
  {
    id: 'perf-block-main-list',
    title: '查询组件管理列表',
    pagePath: PERF_BLOCK_MAIN_PAGE_PATH,
    permission: '/dashboard/block/main',
    write: false,
    params: BLOCK_MAIN_PARAMS,
  },
  {
    id: 'perf-block-main-prepare-status',
    title: '准备切换组件状态',
    pagePath: PERF_BLOCK_MAIN_PAGE_PATH,
    permission: '/dashboard/block/main',
    write: false,
    params: BLOCK_STATUS_PARAMS,
  },
  {
    id: 'perf-block-main-set-status',
    title: '切换组件启停状态',
    pagePath: PERF_BLOCK_MAIN_PAGE_PATH,
    permission: '/dashboard/block/main',
    write: true,
    params: BLOCK_STATUS_DRAFT_PARAMS,
  },
  {
    id: 'perf-analysis-department-summary',
    title: '查询管理分析（部门口径的签订与得分统计）',
    pagePath: PERF_ANALYSIS_DEPARTMENT_PAGE_PATH,
    permission: '/dashboard/analysis/department',
    write: false,
    params: ANALYSIS_DEPARTMENT_PARAMS,
  },
  {
    id: 'perf-analysis-department-self-check',
    title: '查询管理分析的「自查分析」表格',
    pagePath: PERF_ANALYSIS_DEPARTMENT_PAGE_PATH,
    permission: '/dashboard/analysis/department',
    write: false,
    params: ANALYSIS_DEPARTMENT_SELF_CHECK_PARAMS,
  },
  {
    id: 'perf-analysis-person-summary',
    title: '查询个人分析（协议进度、协同任务与得分趋势）',
    pagePath: PERF_ANALYSIS_PERSON_PAGE_PATH,
    permission: '/dashboard/analysis/person',
    write: false,
    params: ANALYSIS_PERSON_PARAMS,
  },
]

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 管理分析页四个统计端点共用的 body 顺序（逐字抄 `formComputed`，`department/list.vue:354-361`）。
 *
 * 默认值**每次现算**：`formState.yearMonth` 的初值是 `dayjs().subtract(1, 'month')`（上月），
 * 与「奖励导入」那一页的"当前年月"不是一回事。
 * ⚠️ 两个都是**数字**（`Number(format('YYYY'|'MM'))`）。
 */
function deptStatOrder (): OrderedField[] {
  const ym = defaultYearMonth()
  return [
    { name: 'year', defaultValue: ym.year },
    { name: 'month', defaultValue: ym.month },
    { name: 'organizationIdList', defaultValue: [] as Array<string | number> },
    { name: 'temIdList', defaultValue: [] as Array<string | number> },
  ]
}

/**
 * 「自查分析」的 body 顺序。
 *
 * 逐字抄 `department/list.vue:408-414`：
 * `{ ...omit(params, ['yearMonth','staffCodeList','staffNameList']),
 *    staffCodeList: …长度>0 ? 它 : null, year, month }`。
 *
 * `params` 只有 `order`/`orderField`（`getDataListIsPage` 被注释掉 ⇒ 无 pageNo/pageSize），
 * 去掉那三个之后剩下 `order`/`orderField`，再展开 → 键序就是
 * **`order, orderField, staffCodeList, year, month`**。
 * ⚠️ `yearMonth` / `staffNameList` **不在 body 里**（被 omit 掉了）。
 *
 * ⚠️ 这一页的年月默认值来自**本地存储**（`useStorage('rrListSelfFormStateYearMonth',
 * dayjs().subtract(1,'month'))`，`department/list.vue:317`）—— 用户上一次选过的月份会被记住。
 * 无头没有这份存储，取与初值一致的上月。
 */
function deptSelfCheckOrder (): OrderedField[] {
  const ym = defaultYearMonth()
  return [
    { name: 'order', defaultValue: '' },
    { name: 'orderField', defaultValue: '' },
    { name: 'staffCodeList', defaultValue: null },
    { name: 'year', defaultValue: ym.year },
    { name: 'month', defaultValue: ym.month },
  ]
}

/**
 * 个人分析页的参数顺序（`person/list.vue:149-154` 的 `formComputed`）。
 *
 * ⚠️ 两个都是**字符串**，且 `month` **不补零**；默认值是**上月**。
 */
function personOrder (): OrderedField[] {
  const ym = defaultYearMonth()
  return [
    { name: 'year', defaultValue: String(ym.year) },
    { name: 'month', defaultValue: String(ym.month) },
  ]
}

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （六页的 module-type 走 `/dashboard/{salary,block,analysis}/*` 的推导结果 = 13 绩效管理）。
 *
 * **每页一个 request** —— module-type 是按页面推导的，共用一份会把范围算错（conventions 第 1 条）。
 */
export function createPerfSalaryCapability (
  /** 奖励导入页 */
  requestSalaryMain: PortalRequest,
  /** 工资找齐页 */
  requestSalaryAdjust: PortalRequest,
  /** 考核导入页 */
  requestSalaryExamineResult: PortalRequest,
  /** 组件管理页 */
  requestBlockMain: PortalRequest,
  /** 管理分析页 */
  requestAnalysisDepartment: PortalRequest,
  /** 个人分析页 */
  requestAnalysisPerson: PortalRequest,
) {
  return {
    /**
     * 分页查询**奖励导入**。只读。
     *
     * `POST /salary/basedata/hrsalarymanagement/page`，**body 是参数对象**
     * （`customLoad` 里 `http.post(url, form)` 原样传 `params`）。
     * 所以这条请求**没有 `_t`** —— `platform.js:36-41` 只给 GET 加。
     *
     * ⚠️ `year`/`month` 的默认值是**当前年月**（页面写死的 `dayjs()`），不是空串；
     * 要查别的月份请显式传，用 `buildSalaryYearMonth('2026-09')` 生成。
     */
    listSalaryMain (query: SalaryMainQuery = {}): Promise<PageResult<SalaryMainRow>> {
      return requestSalaryMain<PageResult<SalaryMainRow>>({
        url: SALARY_MAIN_LIST_URL,
        method: 'post',
        data: buildParams([...BASE_ORDER, ...salaryMainOrder(), ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /** 下载 Portal 的「奖励工资模板」xlsx。 */
    async downloadSalaryMainTemplate (): Promise<PerfSalaryFile> {
      return fileOf(
        await requestSalaryMain<AxiosResponse<ArrayBuffer>>({
          url: SALARY_MAIN_TEMPLATE_URL,
          method: 'get',
          params: { fileName: '奖励工资模板' },
          responseType: 'arraybuffer',
        }),
        '奖励工资模板.xlsx',
      )
    },

    /** 按 Portal 导出按钮提交四个表单字段，返回 base64 文件。 */
    async exportSalaryMain (query: SalaryMainExportQuery = {}): Promise<PerfSalaryFile> {
      return fileOf(
        await requestSalaryMain<AxiosResponse<ArrayBuffer>>({
          url: SALARY_MAIN_EXPORT_URL,
          method: 'post',
          data: salaryMainExportParamsOf(query),
          responseType: 'arraybuffer',
        }),
        '薪资.xlsx',
      )
    },

    /** 只校验并预览待导入文件；不会发请求。 */
    prepareSalaryMainImport (input: PerfSalaryFileInput): { fileName: string; contentType: string; byteLength: number } {
      return filePreviewOf(input)
    },

    /** 上传奖励工资 xlsx；Portal 成功响应没有被页面消费，因此 SDK 返回 void。 */
    async importSalaryMain (input: PerfSalaryFileInput): Promise<void> {
      await requestSalaryMain({
        url: SALARY_MAIN_IMPORT_URL,
        method: 'post',
        data: formDataOf(input),
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },

    /**
     * 分页查询**工资找齐**。只读。
     *
     * `POST /salary/basedata/hrsalarymanagement/adjustPage`。
     * 页面只把 `data.list` / `data.total` 转出来，其余字段丢弃 —— 本能力直接透传整个包络。
     *
     * ⚠️ 这一页的 `year`/`month` **默认空串**（与「奖励导入」的当前年月相反），
     * 而且 `month` 的页面初值是 `''` 而不是数字 —— 传数字或 `''` 都行，别传 `null`。
     */
    listSalaryAdjust (query: SalaryAdjustQuery = {}): Promise<PageResult<SalaryAdjustRow>> {
      return requestSalaryAdjust<PageResult<SalaryAdjustRow>>({
        url: SALARY_ADJUST_LIST_URL,
        method: 'post',
        data: buildParams([...BASE_ORDER, ...SALARY_ADJUST_FIELDS, ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /** 按 Portal 调整弹窗规则装配草稿；不会发请求。 */
    prepareSalaryAdjust (input: SalaryAdjustInput): { draft: SalaryAdjustDraft } {
      return { draft: salaryAdjustPayloadOf(input) }
    },

    /** 保存工资找齐调整；idList 必须是调用方确认过的行 ID。 */
    async saveSalaryAdjust (draft: SalaryAdjustDraft): Promise<void> {
      await requestSalaryAdjust({
        url: SALARY_ADJUST_SAVE_URL,
        method: 'post',
        data: salaryAdjustPayloadOf(draft),
      })
    },

    /**
     * 分页查询**考核导入**。只读。
     *
     * `POST /performance/examineresult/page`。
     * ⚠️ 组织字段名是 `organizationIdList`（不是 `orgIdList`）；
     * ⚠️ 返回行的 `name` 是**考核名称**，人名在 `realName`。
     */
    listSalaryExamineResult (
      query: SalaryExamineResultQuery = {},
    ): Promise<PageResult<SalaryExamineResultRow>> {
      return requestSalaryExamineResult<PageResult<SalaryExamineResultRow>>({
        url: SALARY_EXAMINE_RESULT_LIST_URL,
        method: 'post',
        data: buildParams(
          [...BASE_ORDER, ...SALARY_EXAMINE_RESULT_FIELDS, ...PAGINATION],
          query as Record<string, unknown>,
        ),
      })
    },

    /** 读取隐藏路由编辑页的考核结果详情。 */
    async getSalaryExamineResult (input: { id: PerfSalaryId }): Promise<SalaryExamineResultRow> {
      const result = objectOf(
        await requestSalaryExamineResult<unknown>({
          url: `${SALARY_EXAMINE_RESULT_URL}/${idOf(input?.id, 'id')}`,
          method: 'get',
        }),
        '考核结果详情响应',
      ) as SalaryExamineResultRow
      // 编辑页 customLoad 明确把后端 year 统一成字符串后再喂给表单。
      return { ...result, year: String(result.year) }
    },

    prepareSalaryExamineResultCreate (form: SalaryExamineResultForm): { draft: JsonObject } {
      return { draft: examineResultPayloadOf(form, false) }
    },

    async createSalaryExamineResult (draft: SalaryExamineResultForm): Promise<void> {
      await requestSalaryExamineResult({
        url: SALARY_EXAMINE_RESULT_URL,
        method: 'post',
        data: examineResultPayloadOf(draft, false),
      })
    },

    prepareSalaryExamineResultUpdate (form: SalaryExamineResultUpdate): { draft: JsonObject } {
      return { draft: examineResultPayloadOf(form, true) }
    },

    async updateSalaryExamineResult (draft: SalaryExamineResultUpdate): Promise<void> {
      await requestSalaryExamineResult({
        url: SALARY_EXAMINE_RESULT_URL,
        method: 'put',
        data: examineResultPayloadOf(draft, true),
      })
    },

    prepareSalaryExamineResultRemove (input: { ids: PerfSalaryId[] }): { ids: PerfSalaryId[] } {
      return { ids: idsOf(input?.ids, 'ids') }
    },

    async removeSalaryExamineResult (input: { ids: PerfSalaryId[] }): Promise<void> {
      await requestSalaryExamineResult({
        url: SALARY_EXAMINE_RESULT_URL,
        method: 'delete',
        data: idsOf(input?.ids, 'ids'),
      })
    },

    prepareSalaryExamineResultImport (input: PerfSalaryFileInput): { fileName: string; contentType: string; byteLength: number } {
      return filePreviewOf(input)
    },

    async importSalaryExamineResult (input: PerfSalaryFileInput): Promise<void> {
      await requestSalaryExamineResult({
        url: SALARY_EXAMINE_RESULT_IMPORT_URL,
        method: 'post',
        data: formDataOf(input),
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },

    async downloadSalaryExamineResultTemplate (): Promise<PerfSalaryFile> {
      return fileOf(
        await requestSalaryExamineResult<AxiosResponse<ArrayBuffer>>({
          url: SALARY_EXAMINE_RESULT_TEMPLATE_URL,
          method: 'get',
          params: { fileName: '考核结果导入模板' },
          responseType: 'arraybuffer',
        }),
        '考核结果导入模板.xlsx',
      )
    },

    /**
     * 分页查询**组件管理**。只读。
     *
     * ⚠️ 本组唯一的 **GET**：这一页用 `getDataListURL` 走默认通道
     * （`list.js:487-489` 的 `_http.get(getDataListURL, { params })`），所以
     * **参数在 query 上、并且会补 `_t`**（平台实例的 GET 拦截器）。
     * 参数顺序：`order → orderField → name → warehouseType → type → pageNo → pageSize → _t`。
     */
    listBlockMain (query: BlockMainQuery = {}): Promise<PageResult<BlockMainRow>> {
      return requestBlockMain<PageResult<BlockMainRow>>({
        url: BLOCK_MAIN_LIST_URL,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...BLOCK_MAIN_FIELDS, ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /** 根据列表中最新状态计算启用/停用目标；不会发请求。 */
    prepareBlockStatus (input: BlockStatusInput): { draft: BlockStatusDraft } {
      return { draft: blockStatusPayloadOf(input) }
    },

    async setBlockStatus (draft: BlockStatusDraft): Promise<void> {
      const value = objectOf(draft, '组件状态草稿')
      if (value.status !== 0 && value.status !== 1) throw new Error('status必须为0或1')
      await requestBlockMain({
        url: BLOCK_MAIN_UPDATE_URL,
        method: 'put',
        data: { id: idOf(value.id, 'id'), status: value.status },
      })
    },

    /**
     * 管理分析页的四个统计端点。只读。
     *
     * 四个**同一个 body**（`formComputed`），返回值分别喂给：表格+饼图、折线图、柱状图、
     * 以及一张**已被注释掉**的卡片。`deptScoreStatisticsInfo` 虽然卡片没了，
     * 但页面 `search()`/`initialize()` 里**仍然在调**，所以本能力保留它。
     *
     * ⚠️ `year`/`month` 是**数字**（`Number(format('YYYY'|'MM'))`），
     * 与个人分析页同名字段是字符串**不同**。
     */
    getAnalysisDepartmentSummary (query: AnalysisDepartmentQuery = {}): Promise<{
      monthProtocolInfo: unknown
      deptSignStatisticsInfo: unknown
      branchDeptSignInfo: unknown
      deptScoreStatisticsInfo: unknown
    }> {
      const data = buildParams(deptStatOrder(), query as Record<string, unknown>)
      const post = <T>(url: string): Promise<T> =>
        requestAnalysisDepartment<T>({ url, method: 'post', data })
      return (async () => ({
        monthProtocolInfo: await post(ANALYSIS_DEPARTMENT_URLS.monthProtocolInfo),
        deptSignStatisticsInfo: await post(ANALYSIS_DEPARTMENT_URLS.deptSignStatisticsInfo),
        branchDeptSignInfo: await post(ANALYSIS_DEPARTMENT_URLS.branchDeptSignInfo),
        deptScoreStatisticsInfo: await post(ANALYSIS_DEPARTMENT_URLS.deptScoreStatisticsInfo),
      }))()
    },

    /**
     * 管理分析页「自查分析」表格。只读。
     *
     * `POST /performance/statistics/homepage/selfCheck`。
     *
     * ⚠️ 这一页**不能空查**：页面只在本地勾选表非空时才发这条请求。所以这里
     * **`staffCodeList` 是必填的**，且为空数组时**照页面原文发 `null`**（不是 `[]`）。
     * ⚠️ body 里**没有 `pageNo`/`pageSize`** —— 页面的 `getDataListIsPage` 被注释掉了。
     * ⚠️ `yearMonth` 与 `staffNameList` **不在 body 里**（被 `omit` 掉了）。
     */
    listAnalysisDepartmentSelfCheck (
      query: AnalysisDepartmentSelfCheckQuery,
    ): Promise<unknown> {
      const staffCodeList =
        Array.isArray(query.staffCodeList) && query.staffCodeList.length > 0
          ? query.staffCodeList
          : null
      if (staffCodeList === null) {
        throw new Error(
          '自查分析必须给 staffCodeList：页面只在勾选表非空时才发这条请求（department/list.vue:612-616）',
        )
      }
      return requestAnalysisDepartment<unknown>({
        url: ANALYSIS_DEPARTMENT_SELF_CHECK_URL,
        method: 'post',
        data: buildParams(deptSelfCheckOrder(), query as Record<string, unknown>, { staffCodeList }),
      })
    },

    /**
     * 个人分析页的两个端点。只读。
     *
     * ⚠️ 这一页**不是列表页**：没有 `order`/`orderField`/`pageNo`/`pageSize`，
     * 参数只有 `{ year, month }` + `_t`（GET）。
     *
     * ⚠️ `year`/`month` 都是**字符串**，且 `month` **不补零**（`format('M')`）。
     * 与管理分析页的同名字段（数字）**类型相反**。
     */
    getAnalysisPersonSummary (query: AnalysisPersonQuery = {}): Promise<{
      monthProtocolInfo: unknown
      personalStatistics: unknown
    }> {
      const params = buildParams(personOrder(), query as Record<string, unknown>)
      const get = <T>(url: string): Promise<T> =>
        requestAnalysisPerson<T>({ url, method: 'get', params })
      return (async () => ({
        monthProtocolInfo: await get(ANALYSIS_PERSON_URLS.monthProtocolInfo),
        personalStatistics: await get(ANALYSIS_PERSON_URLS.personalStatistics),
      }))()
    },
  }
}

export type PerfSalaryCapability = ReturnType<typeof createPerfSalaryCapability>

/**
 * 门面稍后挂载的幂等写方法类型；本文件只声明契约，不实现门面包装。
 */
export type PerfSalaryCapabilityWithIdempotency = PerfSalaryCapability & {
  importSalaryMainIdempotent: (input: PerfSalaryFileInput & { requestId: string }) => Promise<void>
  saveSalaryAdjustIdempotent: (input: SalaryAdjustInput & { requestId: string }) => Promise<void>
  createSalaryExamineResultIdempotent: (input: SalaryExamineResultForm & { requestId: string }) => Promise<void>
  updateSalaryExamineResultIdempotent: (input: SalaryExamineResultUpdate & { requestId: string }) => Promise<void>
  removeSalaryExamineResultIdempotent: (input: { ids: PerfSalaryId[]; requestId: string }) => Promise<void>
  importSalaryExamineResultIdempotent: (input: PerfSalaryFileInput & { requestId: string }) => Promise<void>
  setBlockStatusIdempotent: (input: BlockStatusInput & { requestId: string }) => Promise<void>
}
