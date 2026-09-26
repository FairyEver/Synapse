import { Buffer } from 'node:buffer'

import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from '../session/types.js'

/**
 * 绩效管理域（`moduleType = 13`）—— 「模板配置」与「基础配置」两个菜单组下的六页。
 *
 * | 页面 | 菜单路径 | 路由文件 | 形态 | 列表接口 |
 * | --- | --- | --- | --- | --- |
 * | 利润管理 | `/dashboard/manage/profit/list` | `…/hr/manage/profit/list.vue` | 树形列表（`customLoad`） | `GET /performance/basedata/kpiprofit/page` |
 * | 薪资结构 | `/dashboard/manage/salary-structure/list` | `…/hr/manage/salary-structure/list.vue` | 树形列表（`customLoad`，**按层分页**） | `GET /performance/basedata/kpisalarystructure/{treePage\|searchPage}` |
 * | 模板内容 | `/dashboard/manage/template-content/list` | `…/hr/manage/template-content/list.vue` | 树形列表（`customLoad`） | `GET /performance/temcontent/kpitemprotocol/page` |
 * | 模板结构 | `/dashboard/manage/template-structure/list` | `…/hr/manage/template-structure/list.vue` | 树形列表（`customLoad`） | `GET /performance/temstructure/kpitemstructure/page` |
 * | 学习任务配置 | `/dashboard/manage/study-task-config/list` | `…/hr/manage/study-task-config/list.vue` | **自定义页（表单）** | `GET /performance/protocol/kpimonthprotocol/study-task-config` |
 * | 任务类型配置 | `/dashboard/manage/task-type-config/list` | `…/hr/manage/task-type-config/list.vue` | **自定义页（表格）** | `GET /performance/task-type-config/list` |
 *
 * 这六页**不是同一种东西**，是本文件最要紧的一句话：前四页是 `useListPageModule` 的树形列表，
 * 后两页**根本没走列表模块**（没有 `useListPageModule`、没有 `order`/`pageNo`、没有查询表单），
 * `generated/page-catalog.json` 把它们标成「其他/自定义页面」是对的。
 *
 * ## ⚠️ 薪资结构那一页：**本地检出落后于线上部署的版本**
 *
 * 本地 Portal 检出里 `salary-structure/list.vue` 是**旧版**：列表打
 * `GET …/kpisalarystructure/page`、没有分页、名称在本地过滤。
 * 测试环境上跑的**不是**这一版 —— 基准（`baseline/perf-manage-template.browser.json`）里
 * 浏览器实发的是：
 *
 * ```
 * GET /admin-api/performance/basedata/kpisalarystructure/treePage
 *     ?parentId=0&keyword=&selection=false&pageNo=1&pageSize=20&_t=<ts>
 * ```
 *
 * 来源是另一个分支上的 `2f29dd5f291 fix(hr): 适配树数据按层分页与回显`
 * （`test/portal/main` / `develop` 上有，本地 HEAD 没有；后端对应
 * `KpiSalaryStructureController:139/145` 的 `treePage` / `searchPage`）。
 * 那个改动的形态是**树按层分页**：一次只取一层（`parentId`），
 * 点目录名 = 用那个目录的 id 再发一次，面包屑是页面自己的状态。
 *
 * 本地检出的落后**不是一两处**：抓基准那天它停在
 * `fix/portal/4.6.3.22-修改绩效公式配置错误权限声明`（`b8dbcae67b`），
 * 比 `origin/test/portal/main` **少 435 个提交**。所以"从本地源码推"这件事本身没错、
 * 但**本地源码不一定是线上那一版** —— 有基准的一律以基准为准（本组只有这一页撞上；
 * 六页的 `path`/`permission`/`title` 与菜单文件在两边逐字相同）。
 *
 * **冲突一律以基准为准**（本项目 D20 的口径），所以这一页的契约按基准写，
 * 并把旧版差异记在这里：
 *
 * | | 本地旧版（未部署） | 线上 / 基准 |
 * | --- | --- | --- |
 * | 列表接口 | `…/kpisalarystructure/page` | `…/kpisalarystructure/treePage`（有 `keyword` 时是 `searchPage`） |
 * | 分页 | 无（`getDataListIsPage` 默认 false） | **有**：`pageNo=1&pageSize=20`（上限 100） |
 * | `order`/`orderField` | 有（空串） | **没有**（见下） |
 * | 名称 | `omit` 掉、本地过滤 | **服务端** `keyword` |
 * | 删目录 | 客户端收齐子树 id 递归删 | `ids = [record.id]`，只删那一条 |
 *
 * 同一次对照还查出另一处**不影响本文件**的出入（只报告）：利润页 `actionSyncFormula`
 * 的 `fetchData` 里，线上版不再调 `kpiprofit/allList`、改成
 * `record.lineType === undefined ? http.get('/…/kpiprofit/' + record.id) : record`。
 * 那在**弹窗里**，与列表契约无关。其余四页与线上分支逐字节相同（`git diff HEAD
 * origin/test/portal/main` 为 0 行）。
 *
 * ## 参数顺序是从源码推出来的，不是抄基准
 *
 * `common/libs/renren/list.js:473-483` 把参数拼成：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * ```
 *
 * ⇒ 顺序恒为 **`order` → `orderField` → `convertFetchForm` 返回值 → `pageNo` → `pageSize` → `_t`**。
 * 三页（利润 / 模板内容 / 模板结构）**没有 `order`/`orderField` 控件**，两个 ref 初值是 `''`
 * （`list.js:295-296`），钉死成空串、不开放。
 *
 * **薪资结构是例外**：它的 `customLoad` 拿到 `params` 之后**自己拼了一个新的对象**，
 * 压根没用模块给的那份 —— 所以 `order`/`orderField` 不在 URL 上，而 `pageNo`/`pageSize`
 * 是页面从 `form` 里取出来再放进自己的对象里的（`getDataListIsPage: true` 时才存在）。
 * 这一处**不能靠 `list.js` 的通用规则推**，只能读那一页的源码（或看基准）。
 *
 * ## ⚠️ 五处与同域其它页相反 / 容易照抄错的地方
 *
 * 1. **三个树页没有分页，薪资结构有（而且是"按层"分页）。**
 *    利润 / 模板内容 / 模板结构都传了 `customLoad`、都没传 `getDataListIsPage`，
 *    而它**默认 `false`**（`list.js:226`）——于是 `params.pageNo/pageSize` **不会被加**，
 *    `listSet(result)` 也把返回值当**裸数组**用（`list.js:493-500`）。
 *    后端印证：这三个 `page` 端点返回 `CommonResult<List<…DTO>>`（树），不是 `PageData`。
 *    **别把 `study-lesson.ts` 那套 `pageNo/pageSize` 抄过来，也别拿薪资结构那页的分页抄它们。**
 *
 *    最阴的一处是**模板内容**：它同时写了 `getDataListURL` **和** `customLoad`
 *    （`template-content/list.vue:76-77`），看着像普通分页页；但 `list.js:484` 是 `if (customLoad)` 先命中，
 *    `getDataListURL` 那一行是**死配置**（两个 URL 恰好相同，所以没人发现）。分页仍然不加。
 *
 * 2. **`customLoad` 收到的是 `params` 整个对象，不是表单。** 三个树页的第一句都是
 *    `const formSubmit = omit(form, ['templateName'])` —— 作用在
 *    `{order, orderField, …表单}` 上，所以 **`order`/`orderField` 会被发给后端**，
 *    而**只有 `templateName` 被摘掉**。
 *    **薪资结构不是这样**：它自己拼了 `{parentId, keyword, dataType, selection, pageNo, pageSize}`
 *    这个新对象，模块给的那份**一个字段都没用** —— 所以它的 URL 上**没有** `order`/`orderField`。
 *    同一个域里两种写法，别互相推。
 *
 * 3. **「名称」这一栏三页是本地过滤、一页是服务端。**
 *    利润 / 模板内容 / 模板结构的 `templateName` 在请求**之前**就被 `omit` 掉，
 *    过滤发生在**返回的树里**（`reduceTree` + `item.name.includes(...)`）——
 *    所以那三页的能力**没有** `name`/`templateName` 参数，要"按名字找"请用导出的
 *    `filterTreeNodeByName()` 在结果上做。
 *    **薪资结构相反**：它把（trim 过的）关键字当 `keyword` **发给后端**，
 *    非空时还换一个端点（`searchPage`）并自动带 `dataType=2`。
 *    顺带一提：三个树页的后端 DTO（`KpiProfitListDTO` / `KpiTemProtocolPageDTO`…）**有** `name` 字段、
 *    是支持服务端过滤的，是**页面没用**。无头与浏览器保持一致：也不发（本项目 D20 的一贯口径）。
 *
 * 4. **`templateType` 是「这一页在看年度还是月度」，默认值来自 `TEMPLATE_TYPE_OPTIONS[0]` = `0`（年度）。**
 *    模板内容 / 模板结构两页的 `templateType` 用 `common-select-dropdown :allowClear="false"`，
 *    所以它**永远有值、永远发**，调用方也清不掉它（要换就传 `1`）。
 *    另外**模板结构页把「切换下拉即重查」的 `watch` 注释掉了**（`template-structure/list.vue:149`），
 *    两页都只能点「查询」才重查 —— 无头侧本来就无所谓，记一笔是因为它解释了为什么两页看起来一样。
 *
 * 5. **薪资结构的 `selection` 是「这是哪个页面」的标记，不是筛选条件 —— 钉死 `false`、不开放。**
 *    后端 `HrBoundedTreeQueryDTO` 的类注释写着「selection 仅区分薪资已有的选择器与管理页可见范围」，
 *    而它的**默认值是 `true`**（选择器那一档）—— 也就是说这个字段**漏发不是"少一个筛选"，
 *    而是换成了另一个可见范围**。页面写死 `false`（管理页），本能力照抄钉死。
 *    同理 `dataType` 也在 `keyword` 非空时被钉成 `2`（只搜薪资结构、不搜目录），
 *    `keyword` 为空时它是 `undefined`、被 qs 丢掉 —— 都是页面原文，不是本文件的发明。
 *
 * ## 后两页根本不是列表页（读法完全不同）
 *
 * - **学习任务配置**：`onMounted` 打一次 `GET …/study-task-config` 填表单，`保存` 打
 *   `POST` 同一个 URL。**没有任何查询参数**（`http.get(CONFIG_URL)`，连 config 都没传），
 *   所以无头侧的 URL 只有客户端补上的 `_t`。
 * - **任务类型配置**：`onMounted` → `taskTypeConfigApi.list()` →
 *   `GET /performance/task-type-config/list`，`params` 是**显式空对象** `{}`
 *   （`utils/hr/task-type-config/api.js` 的 `list (params = {})`）。后端那个方法
 *   (`KpiTaskConfigController#getConfigList`) **一个参数都不收**。
 *   返回体还要再拆一层：页面自己写的是 `unwrapTaskTypeList(result)`
 *   （`result?.data || result` → 数组或 `.list`/`.records`），本文件把这段**原样复刻**。
 *
 * ## 页面挂载时的全量下拉：本文件没有
 *
 * 四个列表页的查询表单里**没有**需要全量候选的下拉（`templateType` 是页面写死的年度/月度两项，
 * 薪资结构那页的「名称」是纯文本关键字），后两页连查询表单都没有 —— 所以这六页
 * **没有** `pageSize=99999` 那一类请求。
 * 六页里仅有的全量拉取都在**弹窗里、不是挂载时**（利润页的「使用情况」拉
 * `kpitarget/{usedInfo,PeopleYearUsedInfo,PeopleMonthUsedInfo}`），本轮不做，也就没有照抄的风险。
 *
 * 顺带一条**已经过期、别再抄**的记法：本文件的上一版按本地旧源码写过「利润页的『同步公式』
 * 拉 `kpiprofit/allList`」—— 线上版已经不是这样了（见上面那张对照表）。
 *
 * ## 当前已接入的写操作
 *
 * **六页都有真实写入口**（`generated/page-catalog.json` 只在任务类型配置那页标了
 * `write: false`，那是推导漏了，页面的编辑抽屉实际会调用 `PUT /performance/task-type-config/update`）。
 * 当前已接入学习任务配置保存（`POST /performance/protocol/kpimonthprotocol/study-task-config`）。
 * **读取能力与页面可达写动作分别登记**，不沿用页面级写操作标记。
 * 与同域其它页同一个判断：
 * 这些是绩效协议链路上的**真实业务配置**（利润树、薪资结构、模板内容/结构都是月度协议生成时
 * 要引用的主数据），改一条会影响别人正生成的协议，删除不可逆。具体入口见各方法上方的注释，
 * 其余写入口都已查清、随时可以做，但**不在本轮**。
 */

export const PROFIT_PAGE_PATH = '/dashboard/manage/profit/list'
export const SALARY_STRUCTURE_PAGE_PATH = '/dashboard/manage/salary-structure/list'
export const TEMPLATE_CONTENT_PAGE_PATH = '/dashboard/manage/template-content/list'
export const TEMPLATE_STRUCTURE_PAGE_PATH = '/dashboard/manage/template-structure/list'
export const STUDY_TASK_CONFIG_PAGE_PATH = '/dashboard/manage/study-task-config/list'
export const TASK_TYPE_CONFIG_PAGE_PATH = '/dashboard/manage/task-type-config/list'

const VIEWS = 'app/portal/views/dashboard/hr/manage'

/** 路由文件（写进文档与排障时用得上） */
export const PERF_MANAGE_ROUTE_FILES = {
  profit: `${VIEWS}/profit/list.vue`,
  salaryStructure: `${VIEWS}/salary-structure/list.vue`,
  templateContent: `${VIEWS}/template-content/list.vue`,
  templateStructure: `${VIEWS}/template-structure/list.vue`,
  studyTaskConfig: `${VIEWS}/study-task-config/list.vue`,
  taskTypeConfig: `${VIEWS}/task-type-config/list.vue`,
} as const

/** 三个树形列表端点 —— **都不分页**，返回的是整棵树（`CommonResult<List<…>>`） */
export const PROFIT_LIST_PATH = '/performance/basedata/kpiprofit/page'
export const TEMPLATE_CONTENT_LIST_PATH = '/performance/temcontent/kpitemprotocol/page'
export const TEMPLATE_STRUCTURE_LIST_PATH = '/performance/temstructure/kpitemstructure/page'

/**
 * 薪资结构的**按层分页**端点，二选一看 `keyword` 是否为空
 * （`salary-structure/list.vue` 的 customLoad 里那句三元）：
 *
 * ```js
 * http.get('/performance/basedata/kpisalarystructure/' + (keyword ? 'searchPage' : 'treePage'), …)
 * ```
 *
 * ⚠️ 本地旧版的 `…/page`（不带分页、整棵树）**线上已经不用了**，别照着本地检出写。
 */
export const SALARY_STRUCTURE_TREE_PATH = '/performance/basedata/kpisalarystructure/treePage'
export const SALARY_STRUCTURE_SEARCH_PATH = '/performance/basedata/kpisalarystructure/searchPage'

/** 每页条数上限：页面 `Math.min(…, 100)`，后端 `HrBoundedTreeQueryDTO#normalize` 也校验 1..100 */
export const SALARY_STRUCTURE_MAX_PAGE_SIZE = 100
/** 页面 `styleV2` 下的默认每页条数 */
export const DEFAULT_PAGE_SIZE = 20

/** 学习任务配置：读与写**同一个 URL**（GET 取、POST 存） */
export const STUDY_TASK_CONFIG_PATH = '/performance/protocol/kpimonthprotocol/study-task-config'

/** 任务类型配置的读端点（写端点是 `PUT /performance/task-type-config/update`） */
export const TASK_TYPE_CONFIG_LIST_PATH = '/performance/task-type-config/list'
export const TASK_TYPE_CONFIG_UPDATE_PATH = '/performance/task-type-config/update'

export const PROFIT_WRITE_PATH = '/performance/basedata/kpiprofit'
export const PROFIT_IMPORT_PATH = `${PROFIT_WRITE_PATH}/import`
export const PROFIT_DATA_PATH = `${PROFIT_WRITE_PATH}/getProfitData`
export const PROFIT_DATA_BY_YEAR_PATH = `${PROFIT_WRITE_PATH}/getProfitDataByYearAndDataType`
export const PROFIT_YEAR_PATH = `${PROFIT_WRITE_PATH}/getProfitYear`
export const PROFIT_LINE_LIST_PATH = `${PROFIT_WRITE_PATH}/getLineList`
export const PROFIT_VARIABLE_LIST_PATH = `${PROFIT_WRITE_PATH}/getVariableList`
export const PROFIT_SAVE_DATA_PATH = `${PROFIT_WRITE_PATH}/saveData`
export const PROFIT_FORMULA_SYNC_PATH = `${PROFIT_WRITE_PATH}/formulaUpdates`
export const SALARY_STRUCTURE_WRITE_PATH = '/performance/basedata/kpisalarystructure'
export const SALARY_STRUCTURE_STATUS_PATH = `${SALARY_STRUCTURE_WRITE_PATH}/updateStatus`
export const SALARY_STRUCTURE_USAGE_PATH = `${SALARY_STRUCTURE_WRITE_PATH}/usedInfo`
export const SALARY_STANDARD_SELECT_PAGE_PATH = '/performance/basedata/hrsalarystandard/selectPage'
export const SALARY_STANDARD_DETAIL_PATH = '/performance/basedata/hrsalarystandard'
export const TEMPLATE_CONTENT_WRITE_PATH = '/performance/temcontent/kpitemprotocol'
export const TEMPLATE_CONTENT_DETAIL_SAVE_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/saveProtocolInfo`
export const TEMPLATE_CONTENT_DETAIL_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/getProtocolInfo`
export const TEMPLATE_CONTENT_PROTOCOL_LIST_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/getProtocolList`
export const TEMPLATE_CONTENT_MONTH_INFO_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/getMonthInfoByYearProtocol`
export const TEMPLATE_CONTENT_USAGE_YEAR_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/YearUsedInfo`
export const TEMPLATE_CONTENT_USAGE_MONTH_PATH = `${TEMPLATE_CONTENT_WRITE_PATH}/MonthUsedInfo`
export const TEMPLATE_STRUCTURE_WRITE_PATH = '/performance/temstructure/kpitemstructure'
export const TEMPLATE_STRUCTURE_DETAIL_PATH = `${TEMPLATE_STRUCTURE_WRITE_PATH}/getStructureInfo`
export const TEMPLATE_STRUCTURE_DETAIL_SAVE_PATH = `${TEMPLATE_STRUCTURE_WRITE_PATH}/saveStructure`
export const TEMPLATE_STRUCTURE_USAGE_PATH = `${TEMPLATE_STRUCTURE_WRITE_PATH}/usedInfo`

/**
 * 模板类型的取值域 —— 逐字抄 `app/portal/utils/hr/agreement-blocks/define.js:24-31`。
 * 这是**页面写死的两组**（不是从字典拉的），所以这里可以照抄。
 */
export const TEMPLATE_TYPE_YEAR = 0
export const TEMPLATE_TYPE_MONTH = 1
export type TemplateType = typeof TEMPLATE_TYPE_YEAR | typeof TEMPLATE_TYPE_MONTH
export const TEMPLATE_TYPE_LABEL: Readonly<Record<TemplateType, string>> = {
  [TEMPLATE_TYPE_YEAR]: '年度',
  [TEMPLATE_TYPE_MONTH]: '月度',
}

/** 树节点上的行类型：0 目录 1 叶子（利润页是 1/2，见各页的目录常量） */
export type PerfTreeRow = {
  id: string | number
  name?: string
  /** 目录标记，各页含义不同：利润 `1`/薪资结构 `1`/模板两页 `0` 是目录 */
  type?: number
  dataType?: number
  parent?: string | number | null
  parentIds?: string
  templateType?: number
  updateTime?: string
  updaterName?: string
  children?: PerfTreeRow[]
  [key: string]: unknown
}

/** 利润树的一行（列取自 `profit/list.vue` 的 `columns`；`lineType` 走 `profit_type` 字典） */
export type KpiProfitRow = PerfTreeRow & {
  /** `1` 文件夹 / `2` 利润 */
  type?: number
  /** 利润类型（字典 `profit_type` 的 value，列里用 `+item.value === record.lineType` 比） */
  lineType?: number
  unit?: string
}

/** 分页接口的返回形状（薪资结构那页唯一一个分页端点） */
export type PageResult<T> = { list: T[]; total: number }

/** 薪资结构树的一行（列取自 `salary-structure/list.vue` 的 `columns`） */
export type SalaryStructureRow = PerfTreeRow & {
  /** `1` 文件夹 / `2` 薪资结构 */
  dataType?: number
  /**
   * 祖先链（线上版列表里那一行小灰字「A / B」读的就是它）。
   * 按层分页之后**行里不再有 `children`**，位置信息靠这个字段带回来。
   */
  ancestorPath?: Array<{ id: string | number; name?: string; available?: boolean }>
  /** `0` 停用 / `1` 启用（启用中的薪资结构页面上禁止删除） */
  status?: number
  baseWageBaseNum?: number | null
  baseWageRangeLow?: number
  baseWageRangeHigh?: number
  assessmentWageBaseNum?: number | null
  assessmentWageRangeLow?: number
  assessmentWageRangeHigh?: number
  profitWageBaseNum?: number | null
  profitWageRangeLow?: number
  profitWageRangeHigh?: number
}

/**
 * 薪资结构的查询条件。
 *
 * ⚠️ 这四个字段**都会变成请求参数**（与同域其它三页把「名称」本地过滤掉相反）。
 * 页面上没有别的筛选控件：`status` / `dataType` / `selection` 都不是调用方能开的
 * （前两个页面不发，`selection` 是页面身份，见文件头 ⑤）。
 */
export type SalaryStructureQuery = {
  /**
   * 父目录 id。`0`（默认）= 根层。
   * 往下一层要拿**上一层的行**里 `dataType === 1` 的那条的 `id`。
   */
  parentId?: number
  /** 名称关键字（**服务端**过滤）。非空时端点换成 `searchPage` 并自动带 `dataType=2` */
  keyword?: string
  pageNo?: number
  /** 每页条数，默认 20、上限 100（超出会被压到 100，与页面一致） */
  pageSize?: number
}

/** 模板内容 / 模板结构树的一行（两页同形，只有「类型」那一列的文案不同） */
export type TemTemplateRow = PerfTreeRow & {
  /** `0` 文件夹 / `1` 模板内容（模板结构页是「模板结构」） */
  type?: number
  /** `0` 年度 / `1` 月度 */
  templateType?: number
}

/** 任务类型配置的一行 —— 字段抄 `KpiTaskTypeConfigDTO`（后端 DTO） */
export type TaskTypeConfigRow = {
  taskType?: number
  taskTypeName?: string
  selfEditable?: boolean
  leaderEditable?: boolean
  progressScoring?: boolean
  /** 为 true 时页面上「按完成进度评分」被禁用（公式计分与它互斥） */
  formulaEnabled?: boolean
  buttonCount?: number
  creator?: number
  createTime?: string
  updater?: number
  updaterName?: string
  updateTime?: string
  [key: string]: unknown
}

/** 学习任务配置 —— 字段抄 `KpiStudyTaskConfigDTO`（后端 DTO） */
export type StudyTaskConfig = {
  /** 周课堂每节进度比例（后端是 Integer） */
  weeklyProgressPercent?: number | null
  /** 晨课堂每节进度比例（后端是 Integer） */
  morningProgressPercent?: number | null
  /** 周课堂基准花朵 */
  weeklyFlowerBaseline?: number
  /** 周课堂自动超额上限 */
  weeklyBonusScoreLimit?: number
  /** `0` 禁用 / `1` 启用 */
  status?: number
  [key: string]: unknown
}

/** Portal 保存学习任务配置时提交的五个字段，顺序与页面初始 formState 一致。 */
export type StudyTaskConfigUpdate = {
  weeklyProgressPercent: number
  morningProgressPercent: number
  weeklyFlowerBaseline: number
  weeklyBonusScoreLimit: number
  status: number
}

export type PerfManageResourceId = string | number

export type PerfManageTemplateFile = {
  fileName: string
  /** Base64 文件内容；不会把本地路径或浏览器 File 对象塞进能力参数。 */
  base64: string
  contentType?: string | null
}

export type ProfitForm = Record<string, unknown> & {
  id?: PerfManageResourceId | null
  name?: string | null
  unit?: string | null
  type?: number | null
  parent?: PerfManageResourceId | null
  lineType?: number | null
  roleIdList?: PerfManageResourceId[] | null
  organizationCodeList?: PerfManageResourceId[] | null
}

export type SalaryStructureForm = Record<string, unknown> & {
  id?: PerfManageResourceId | null
  name?: string | null
  dataType?: number | null
  parent?: PerfManageResourceId | null
  roleIdList?: PerfManageResourceId[] | null
  organizationCodeList?: PerfManageResourceId[] | null
}

export type ProfitImportDraft = {
  file: PerfManageTemplateFile
  type: 1 | 2
  parentId: PerfManageResourceId | ''
}

export type TaskTypeConfigUpdate = {
  id: PerfManageResourceId
  taskType: number
  selfEditable: boolean
  leaderEditable: boolean
  progressScoring: boolean
}

export type TaskTypeConfigUpdatePreparation = {
  draft: TaskTypeConfigUpdate
  /** Portal 只把它用于按钮禁用，不发送到 Java DTO。 */
  formulaEnabled: boolean
}

export type TemplateContentDetail = Record<string, unknown> & {
  id: PerfManageResourceId
  templateType: TemplateType
  temStructureId: PerfManageResourceId
  salaryId: PerfManageResourceId
  orgTreeIdList: unknown[]
  subsectionList: Array<Record<string, unknown> & { assemblyList: unknown[] }>
  yearProtocolId?: PerfManageResourceId | null
  isSpecial?: number | null
  special?: number | null
}

export type ProfitDataSave = Record<string, unknown> & {
  profitId: PerfManageResourceId
  forecastProfit: { year: number; targetDataList: unknown[] }
  actualProfit: { year: number; targetDataList: unknown[] }
}

export type SalaryStructureConfigForm = Record<string, unknown> & {
  id: PerfManageResourceId
  name: string
  baseWageBaseNum: number
  baseWageRangeLow: number
  baseWageRangeHigh: number
  assessmentWageBaseNum: number
  assessmentWageRangeLow: number
  assessmentWageRangeHigh: number
  profitWageBaseNum: number
  profitWageRangeLow: number
  profitWageRangeHigh: number
  isEqual?: boolean
  salaryStandardId?: PerfManageResourceId | null
}

export type TemplateNodeForm = Record<string, unknown> & {
  id?: PerfManageResourceId | null
  name: string
  type: 0 | 1
  templateType: TemplateType
  parent?: PerfManageResourceId | null
  roleIdList?: PerfManageResourceId[] | null
  organizationCodeList?: PerfManageResourceId[] | null
}

export type TemplateStructureDetail = Record<string, unknown> & {
  id: PerfManageResourceId
  title: string
  templateType: TemplateType
  subsectionList: Array<Record<string, unknown> & {
    title?: string
    blocks?: Array<Record<string, unknown> & { type: string | number }>
    subassemblyTypes?: string
  }>
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SPECIAL_TEMPLATE_BLOCK_TYPES = new Set(['6', '7', '8', '9', '14', '15'])
const YEAR_PRIORITY_BLOCK_TYPE = '6'
const TASK_TYPE_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const

function objectOf (value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function resourceIdOf (value: unknown, label: string): PerfManageResourceId {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数ID`)
    return value
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error(`${label}必须是正整数ID`)
}

function textOf (value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`)
  const text = value.trim()
  if (text === '') throw new Error(`${label}不能为空`)
  if (text.length > maxLength) throw new Error(`${label}不能超过${maxLength}个字符`)
  return text
}

function parentOf (value: unknown): PerfManageResourceId | '0' {
  if (value === undefined || value === null || value === '') return '0'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('parent必须是非负整数ID')
    return value === 0 ? '0' : value
  }
  if (value === '0') return '0'
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) return value.trim()
  throw new Error('parent必须是非负整数ID')
}

function idListOf (value: unknown, label: string): PerfManageResourceId[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map((id) => resourceIdOf(id, `${label}中的ID`))
}

function enumOf (value: unknown, allowed: readonly number[], label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !allowed.includes(value)) {
    throw new Error(`${label}取值必须是${allowed.join('、')}`)
  }
  return value
}

function finiteNumberOf (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  return value
}

function parentIdForImport (value: unknown): PerfManageResourceId | '' {
  if (value === undefined || value === null || value === '') return ''
  return resourceIdOf(value, 'parentId')
}

function fileOf (value: unknown): PerfManageTemplateFile {
  const file = objectOf(value, 'file') as Partial<PerfManageTemplateFile>
  if (typeof file.fileName !== 'string' || file.fileName.trim() === '') throw new Error('fileName不能为空')
  if (!/\.xlsx$/i.test(file.fileName.trim())) throw new Error('fileName必须是.xlsx文件')
  if (typeof file.base64 !== 'string' || file.base64 === '') throw new Error('base64不能为空')
  const contentType = file.contentType ?? XLSX_CONTENT_TYPE
  if (contentType !== XLSX_CONTENT_TYPE) throw new Error('Portal只接受application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  return { fileName: file.fileName, base64: file.base64, contentType }
}

function formDataOf (draft: ProfitImportDraft): FormData {
  const bytes = Buffer.from(draft.file.base64, 'base64')
  if (bytes.byteLength === 0) throw new Error('上传文件内容不能为空')
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(bytes)], { type: draft.file.contentType ?? XLSX_CONTENT_TYPE }), draft.file.fileName)
  // 顺序逐字抄 create-multiple.vue：file → type → parentId。
  formData.append('type', String(draft.type))
  formData.append('parentId', String(draft.parentId))
  return formData
}

function resultListOf (value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}响应必须是数组`)
  return value.map((item) => String(item))
}

function copyFormWithPortalRules (input: unknown, label: string, mode: 'create' | 'update', kind: 'profit' | 'salary'): Record<string, unknown> {
  const value = objectOf(input, label)
  const payload: Record<string, unknown> = { ...value }
  if (mode === 'create') delete payload.id
  else payload.id = resourceIdOf(value.id, `${label}.id`)

  payload.name = textOf(value.name, `${label}.name`, 20)
  payload.parent = parentOf(value.parent)
  payload.roleIdList = idListOf(value.roleIdList, `${label}.roleIdList`)
  if (Object.prototype.hasOwnProperty.call(value, 'organizationCodeList')) {
    payload.organizationCodeList = idListOf(value.organizationCodeList, `${label}.organizationCodeList`)
  }

  if (kind === 'profit') {
    const type = enumOf(value.type, [1, 2], `${label}.type`)
    payload.type = type
    const unit = value.unit === undefined || value.unit === null ? null : textOf(value.unit, `${label}.unit`, 5)
    if (type === 2 && unit === null) throw new Error(`${label}.unit不能为空`)
    payload.unit = unit
    payload.lineType = value.lineType === undefined || value.lineType === null
      ? 1
      : enumOf(value.lineType, [1, 2, 3, 4], `${label}.lineType`)
  } else {
    payload.dataType = enumOf(value.dataType, [1, 2], `${label}.dataType`)
  }
  return payload
}

function idsFromTree (value: unknown, label: string): PerfManageResourceId[] {
  const row = objectOf(value, label) as PerfTreeRow
  const ids: PerfManageResourceId[] = []
  const visit = (node: PerfTreeRow): void => {
    ids.push(resourceIdOf(node.id, `${label}.id`))
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error(`${label}.children必须是数组`)
      for (const child of node.children) visit(objectOf(child, `${label}.children`) as PerfTreeRow)
    }
  }
  visit(row)
  return ids
}

function idsDraftOf (input: unknown, label: string): { ids: PerfManageResourceId[] } {
  const value = objectOf(input, label)
  const ids = idsFromTree(value.record, `${label}.record`)
  if (ids.length === 0) throw new Error(`${label}.record不能为空`)
  return { ids }
}

function normalizedTaskTypeUpdate (input: unknown): TaskTypeConfigUpdatePreparation {
  const value = objectOf(input, '任务类型配置更新')
  const draft: TaskTypeConfigUpdate = {
    id: resourceIdOf(value.id, '任务类型配置更新.id'),
    taskType: enumOf(value.taskType, TASK_TYPE_CODES, 'taskType'),
    selfEditable: value.selfEditable as boolean,
    leaderEditable: value.leaderEditable as boolean,
    progressScoring: value.progressScoring as boolean,
  }
  for (const name of ['selfEditable', 'leaderEditable', 'progressScoring'] as const) {
    if (typeof draft[name] !== 'boolean') throw new Error(`${name}必须是布尔值`)
  }
  const formulaEnabled = value.formulaEnabled === true
  if (draft.selfEditable && !draft.leaderEditable) throw new Error('员工可调整时领导必须可评分')
  if (formulaEnabled && draft.progressScoring) throw new Error('启用公式时不能开启按完成进度评分')
  return { draft, formulaEnabled }
}

function normalizedTemplateContentDetail (input: unknown): TemplateContentDetail {
  const value = objectOf(input, '模板内容详情') as Partial<TemplateContentDetail>
  const payload: Record<string, unknown> = { ...value }
  payload.id = resourceIdOf(value.id, '模板内容详情.id')
  payload.templateType = enumOf(value.templateType, [TEMPLATE_TYPE_YEAR, TEMPLATE_TYPE_MONTH], 'templateType') as TemplateType
  payload.temStructureId = resourceIdOf(value.temStructureId, 'temStructureId')
  payload.salaryId = resourceIdOf(value.salaryId, 'salaryId')
  if (!Array.isArray(value.orgTreeIdList) || value.orgTreeIdList.length === 0) throw new Error('orgTreeIdList不能为空')
  payload.orgTreeIdList = idListOf(value.orgTreeIdList, 'orgTreeIdList')
  for (const name of ['orgPostIdList', 'orgIdList', 'usingScope'] as const) {
    if (value[name] !== undefined && value[name] !== null) payload[name] = idListOf(value[name], name)
  }
  if (!Array.isArray(value.subsectionList)) throw new Error('subsectionList必须是数组')

  const subsectionList = value.subsectionList.map((section, sectionIndex) => {
    const sectionValue = objectOf(section, `subsectionList[${sectionIndex}]`)
    if (!Array.isArray(sectionValue.assemblyList)) throw new Error(`subsectionList[${sectionIndex}].assemblyList必须是数组`)
    const assemblyList = sectionValue.assemblyList.map((assembly, assemblyIndex) => {
      const assemblyValue = objectOf(assembly, `subsectionList[${sectionIndex}].assemblyList[${assemblyIndex}]`)
      const type = String(assemblyValue.type)
      const nextAssembly: Record<string, unknown> = { ...assemblyValue }
      if (SPECIAL_TEMPLATE_BLOCK_TYPES.has(type)) {
        if (!Array.isArray(assemblyValue.value)) throw new Error(`组件${type}.value必须是数组`)
        nextAssembly.value = assemblyValue.value.filter((item) => {
          const row = objectOf(item, `组件${type}.value`)
          return Boolean(row.id || row.title)
        })
      }
      return nextAssembly
    })
    const nextSection: Record<string, unknown> = { ...sectionValue, assemblyList }
    return nextSection as Record<string, unknown> & { assemblyList: unknown[] }
  })

  if (payload.templateType === TEMPLATE_TYPE_YEAR) {
    for (const section of subsectionList) {
      for (const assembly of section.assemblyList as Array<Record<string, unknown>>) {
        if (String(assembly.type) !== YEAR_PRIORITY_BLOCK_TYPE || !Array.isArray(assembly.value)) continue
        assembly.value = (assembly.value as unknown[]).map((yearTask, taskIndex) => {
          const task = objectOf(yearTask, `年度重点工作.value[${taskIndex}]`)
          if (!Array.isArray(task.taskList)) return task
          const nextTask: Record<string, unknown> = { ...task }
          nextTask.taskList = task.taskList.map((item) => {
            const taskItem = objectOf(item, '年度重点工作.taskList')
            const { taskType: _taskType, taskTypeName: _taskTypeName, taskTypeOptions: _taskTypeOptions, ...rest } = taskItem
            return rest
          })
          return nextTask
        })
      }
    }
  }
  payload.subsectionList = subsectionList

  for (const name of ['isExceed', 'isSpecial'] as const) {
    if (value[name] !== undefined && value[name] !== null) enumOf(value[name], [0, 1], name)
  }
  if (value.isSpecial === 0) payload.special = 0
  if (value.isSpecial === 1) finiteNumberOf(value.special, 'special')
  if (payload.templateType === TEMPLATE_TYPE_MONTH && (value.yearProtocolId === undefined || value.yearProtocolId === null || value.yearProtocolId === '')) {
    throw new Error('月度模板必须选择yearProtocolId')
  }
  return payload as TemplateContentDetail
}

function normalizedProfitImport (input: unknown): ProfitImportDraft {
  const value = objectOf(input, '利润导入')
  const type = enumOf(value.type, [1, 2], '利润导入.type') as 1 | 2
  return {
    file: fileOf(value.file),
    type,
    parentId: parentIdForImport(value.parentId),
  }
}

function normalizedSalaryStatus (input: unknown): { draft: { id: PerfManageResourceId; status: 0 | 1 }; previousStatus: 0 | 1 } {
  const value = objectOf(input, '薪资结构启停')
  if (value.dataType !== 2) throw new Error('只有dataType=2的薪资结构可以启停')
  const currentStatus = enumOf(value.currentStatus, [0, 1], 'currentStatus') as 0 | 1
  return {
    draft: {
      id: resourceIdOf(value.id, 'id'),
      status: currentStatus === 1 ? 0 : 1,
    },
    previousStatus: currentStatus,
  }
}

function trueResponseOf (value: unknown, label: string): true {
  if (value !== true) throw new Error(`${label}响应不是true`)
  return true
}

function normalizeStudyTaskConfigUpdate (input: StudyTaskConfigUpdate): StudyTaskConfigUpdate {
  if (input === undefined || input === null || typeof input !== 'object') throw new Error('学习任务配置不能为空')
  const values = [
    ['weeklyProgressPercent', input.weeklyProgressPercent],
    ['morningProgressPercent', input.morningProgressPercent],
    ['weeklyFlowerBaseline', input.weeklyFlowerBaseline],
    ['weeklyBonusScoreLimit', input.weeklyBonusScoreLimit],
  ] as const
  for (const [name, value] of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是数字`)
  }
  for (const name of ['weeklyProgressPercent', 'morningProgressPercent'] as const) {
    const value = input[name]
    if (value <= 0 || value > 100) throw new Error(`${name} 必须大于 0 且不超过 100`)
    if (Math.round(value * 100) !== value * 100) throw new Error(`${name} 最多保留 2 位小数`)
  }
  if (!Number.isInteger(input.weeklyFlowerBaseline) || input.weeklyFlowerBaseline < 0) throw new Error('weeklyFlowerBaseline 必须是大于等于 0 的整数')
  if (input.weeklyBonusScoreLimit < 0 || Math.round(input.weeklyBonusScoreLimit * 100) !== input.weeklyBonusScoreLimit * 100) throw new Error('weeklyBonusScoreLimit 必须不小于 0 且最多保留 2 位小数')
  if (!Number.isInteger(input.status) || ![0, 1].includes(input.status)) throw new Error('status 必须是 0 或 1')
  return {
    weeklyProgressPercent: input.weeklyProgressPercent,
    morningProgressPercent: input.morningProgressPercent,
    weeklyFlowerBaseline: input.weeklyFlowerBaseline,
    weeklyBonusScoreLimit: input.weeklyBonusScoreLimit,
    status: input.status,
  }
}

function normalizeProfitDataSave (input: unknown): ProfitDataSave {
  const value = objectOf(input, '利润数据保存') as Partial<ProfitDataSave>
  const profitId = resourceIdOf(value.profitId, '利润数据保存.profitId')
  const normalizePeriod = (period: unknown, label: string): { year: number; targetDataList: unknown[] } => {
    const item = objectOf(period, label)
    const year = finiteNumberOf(item.year, `${label}.year`)
    if (!Number.isInteger(year)) throw new Error(`${label}.year必须是整数`)
    if (!Array.isArray(item.targetDataList)) throw new Error(`${label}.targetDataList必须是数组`)
    return { year, targetDataList: item.targetDataList }
  }
  const forecastProfit = normalizePeriod(value.forecastProfit, 'forecastProfit')
  const actualProfit = normalizePeriod(value.actualProfit, 'actualProfit')
  if (forecastProfit.targetDataList.length !== 1) throw new Error('forecastProfit.targetDataList必须恰好有一条')
  for (const item of forecastProfit.targetDataList) {
    const row = objectOf(item, 'forecastProfit.targetDataList中的数据')
    if (row.formula === '') throw new Error('利润公式不能为空')
  }
  return { ...value, profitId, forecastProfit, actualProfit }
}

function normalizedSalaryStructureConfig (input: unknown): SalaryStructureConfigForm {
  const value = objectOf(input, '薪资结构配置') as Partial<SalaryStructureConfigForm>
  const payload: Record<string, unknown> = { ...value, id: resourceIdOf(value.id, '薪资结构配置.id') }
  payload.name = textOf(value.name, '薪资结构配置.name', 20)
  for (const name of [
    'baseWageBaseNum', 'assessmentWageBaseNum', 'profitWageBaseNum',
  ] as const) {
    const number = finiteNumberOf(value[name], `薪资结构配置.${name}`)
    if (number < 0 || number > 100) throw new Error(`薪资结构配置.${name}必须在0到100之间`)
    payload[name] = number
  }
  for (const prefix of ['baseWage', 'assessmentWage', 'profitWage'] as const) {
    const low = finiteNumberOf(value[`${prefix}RangeLow` as keyof SalaryStructureConfigForm], `薪资结构配置.${prefix}RangeLow`)
    const high = finiteNumberOf(value[`${prefix}RangeHigh` as keyof SalaryStructureConfigForm], `薪资结构配置.${prefix}RangeHigh`)
    if (low < 0 || low > 100) throw new Error(`薪资结构配置.${prefix}RangeLow必须在0到100之间`)
    if (high < 0 || high > 200 || high < low) throw new Error(`薪资结构配置.${prefix}RangeHigh必须不小于下限且不超过200`)
    payload[`${prefix}RangeLow`] = low
    payload[`${prefix}RangeHigh`] = high
  }
  const isEqual = value.isEqual === true
  if (value.isEqual !== undefined && typeof value.isEqual !== 'boolean') throw new Error('薪资结构配置.isEqual必须是布尔值')
  payload.isEqual = isEqual
  payload.salaryStandardId = isEqual
    ? resourceIdOf(value.salaryStandardId, '薪资结构配置.salaryStandardId')
    : null
  return payload as SalaryStructureConfigForm
}

function normalizedTemplateNode (input: unknown, label: string, mode: 'create' | 'update'): Record<string, unknown> {
  const value = objectOf(input, label)
  const payload: Record<string, unknown> = { ...value }
  if (mode === 'create') delete payload.id
  else payload.id = resourceIdOf(value.id, `${label}.id`)
  payload.name = textOf(value.name, `${label}.name`, 20)
  payload.type = enumOf(value.type, [0, 1], `${label}.type`)
  payload.templateType = enumOf(value.templateType, [TEMPLATE_TYPE_YEAR, TEMPLATE_TYPE_MONTH], `${label}.templateType`)
  payload.parent = parentOf(value.parent)
  payload.roleIdList = idListOf(value.roleIdList, `${label}.roleIdList`)
  if (Object.prototype.hasOwnProperty.call(value, 'organizationCodeList')) {
    payload.organizationCodeList = idListOf(value.organizationCodeList, `${label}.organizationCodeList`)
  }
  return payload
}

function normalizedTemplateStructureDetail (input: unknown): Record<string, unknown> {
  const value = objectOf(input, '模板结构详情') as Partial<TemplateStructureDetail>
  const payload: Record<string, unknown> = {
    ...value,
    id: resourceIdOf(value.id, '模板结构详情.id'),
    title: textOf(value.title, '模板结构详情.title', 100),
    templateType: enumOf(value.templateType, [TEMPLATE_TYPE_YEAR, TEMPLATE_TYPE_MONTH], '模板结构详情.templateType'),
  }
  if (!Array.isArray(value.subsectionList)) throw new Error('模板结构详情.subsectionList必须是数组')
  payload.subsectionList = value.subsectionList.map((section, index) => {
    const row = objectOf(section, `模板结构详情.subsectionList[${index}]`)
    const title = row.title === undefined ? '' : String(row.title)
    let subassemblyTypes = row.subassemblyTypes
    if (Array.isArray(row.blocks)) {
      subassemblyTypes = row.blocks.map((block, blockIndex) => {
        const item = objectOf(block, `模板结构详情.subsectionList[${index}].blocks[${blockIndex}]`)
        if (item.type === undefined || item.type === null || String(item.type) === '') throw new Error('模板结构组件type不能为空')
        return String(item.type)
      }).join(',')
    }
    if (typeof subassemblyTypes !== 'string') throw new Error(`模板结构详情.subsectionList[${index}].blocks必须是数组`)
    return { ...row, title, subassemblyTypes }
  })
  return payload
}

function usagePageOf (input: unknown, label: string): Record<string, unknown> {
  const value = objectOf(input, label)
  const pageNo = value.pageNo === undefined ? 1 : finiteNumberOf(value.pageNo, `${label}.pageNo`)
  const pageSize = value.pageSize === undefined ? DEFAULT_PAGE_SIZE : finiteNumberOf(value.pageSize, `${label}.pageSize`)
  if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error(`${label}.pageNo必须是正整数`)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > SALARY_STRUCTURE_MAX_PAGE_SIZE) throw new Error(`${label}.pageSize必须在1到100之间`)
  return { id: resourceIdOf(value.id, `${label}.id`), limit: value.limit, pageNo, pageSize }
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

/**
 * 三个树页共用的开头两项。页面**没有** `order` / `orderField` 这两个控件，
 * 是列表模块自己加的（`list.js:474-475`，两个 ref 初值都是 `''`），
 * 所以钉死成空串、不开放给调用方。
 *
 * ⚠️ 它们**真的会发出去**（`customLoad` 的第一句 `omit(form, ['templateName'])` 只摘名字），
 * 不是"页面有但无头可以省"的那种。薪资结构那页没有这两项（见文件头 ②）。
 */
const BASE_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
]

/**
 * 模板内容 / 模板结构的参数顺序 —— 逐字抄两页 `customLoad` 里
 * `omit(form, ['templateName'])` 的结果：`{ order, orderField, templateType }`。
 *
 * `templateType` 的初值是 `TEMPLATE_TYPE_OPTIONS[0].value` = `0`（年度），
 * 且下拉 `:allowClear="false"` ⇒ **永远有值、永远发**。
 */
const TEMPLATE_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  ...BASE_ORDER,
  { name: 'templateType', defaultValue: TEMPLATE_TYPE_YEAR },
]

/**
 * 薪资结构的参数顺序 —— 逐字抄线上版 `customLoad` 里那个**自己拼的对象字面量**：
 *
 * ```js
 * { parentId: form.parentId || 0, keyword, dataType: keyword ? 2 : undefined,
 *   selection: false, pageNo: form.pageNo || 1,
 *   pageSize: Math.min(Number(form.pageSize) || 20, 100) }
 * ```
 *
 * ⇒ `parentId` → `keyword` → `dataType` → `selection` → `pageNo` → `pageSize`。
 * `dataType` 在 `keyword` 为空时是 `undefined`，被 `qs` 的 `skipNulls` 丢掉 ——
 * 所以**键位留着、值不发**，最终 URL 里它不出现（基准就是这样）。
 *
 * ⚠️ 这里**没有** `order`/`orderField`，也**没有**本地过滤的 `name`：
 * 与同域那三个树页相反，别互相推（见文件头 ②③）。
 */
const SALARY_STRUCTURE_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'parentId', defaultValue: 0 },
  { name: 'keyword', defaultValue: '' },
  // 值由 pinned 覆盖：keyword 非空 → 2；为空 → undefined（qs 丢掉）
  { name: 'dataType', defaultValue: undefined },
  // 值由 pinned 覆盖成 false：页面身份，不是筛选条件（见文件头 ⑤）
  { name: 'selection', defaultValue: false },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/**
 * 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20）。
 *
 * `pinned` 是页面钉死的字段（优先级高于调用方实参 —— 传了也盖不掉），
 * 与 `study-lesson.ts` 里那一份同名同义。
 */
function buildParams (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown> = {},
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

/**
 * 复刻三个树页的**客户端**名字过滤（`reduceTree` + `item.name.includes(keyword)`）。
 *
 * ⚠️ 这是**本地过滤，不是请求参数** —— 页面的「名称」输入框（利润页那一栏的
 * 表单字段其实叫 `templateName`，是从模板两页抄过来的）在发请求前就被 `omit` 掉了，
 * 过滤发生在**返回的树上**。所以这三个能力不提供 `name` 参数，要按名字找就用这个函数。
 * **薪资结构那页不在其列**：它的关键字是**服务端**的 `keyword`（见 `listSalaryStructures`）。
 *
 * 两处与页面**刻意不同**（都是页面会崩、而不是语义不同）：
 * - 页面是 `item.name.includes(...)`，`name` 为 null 时**直接抛**；这里跳过无名节点。
 * - `keyword` 为空串时这里**返回空数组**（页面此时走的是另一条分支、根本不会调这段），
 *   所以调用方传空串会得到 `[]` 而不是"全部"。
 *
 * 遍历顺序是**前序**（父先于子），与 `reduceTree` 一致；命中节点会去掉 `children`。
 */
export function filterTreeNodeByName<T extends PerfTreeRow> (
  nodes: readonly T[] | undefined | null,
  keyword: string,
  /** 什么样的算「叶子」——各页不一样：利润 `type===2`、模板两页 `type===1` */
  isLeaf: (row: T) => boolean,
): Array<Omit<T, 'children'>> {
  const matched: Array<Omit<T, 'children'>> = []
  if (!keyword) return matched
  const walk = (list: readonly T[]): void => {
    for (const node of list) {
      if (typeof node?.name === 'string' && node.name.includes(keyword) && isLeaf(node)) {
        const { children: _children, ...rest } = node
        matched.push(rest)
      }
      if (Array.isArray(node?.children)) walk(node.children as unknown as readonly T[])
    }
  }
  if (Array.isArray(nodes)) walk(nodes)
  return matched
}

/** 利润页的叶子判据（`profit/list.vue:100` 的 `item.type === 2`） */
export const isProfitLeaf = (row: PerfTreeRow): boolean => row.type === 2
/** 模板内容 / 模板结构页的叶子判据（两页都是 `item.type === 1`） */
export const isTemplateLeaf = (row: PerfTreeRow): boolean => row.type === 1

/**
 * 复刻线上版薪资结构 `customLoad` 的最后一句：
 *
 * ```js
 * return { ...result, list: result.list.map(node => omit(node, ['children'])) }
 * ```
 *
 * 按层分页之后每一行都不该再有子树，页面还是**主动剥掉** `children` 再交给表格 ——
 * 本能力照抄（这是**页面的**行为，不是 SDK 的加工）。位置信息在那之前由
 * `ancestorPath` 带回来了（页面渲染成「A / B」那行小灰字）。
 *
 * `list` 不是数组时**当场抛**，不静默返回空列表 —— 静默会让调用方以为"这一层真的没有数据"，
 * 而实际是响应形状变了（与 `study-teacher.ts` 对 `page` 字段的处理同一个理由）。
 */
export function normalizeSalaryStructurePage (
  result: PageResult<SalaryStructureRow> | undefined,
): PageResult<SalaryStructureRow> {
  if (!Array.isArray(result?.list)) {
    throw new Error(
      '薪资结构列表：响应里没有 list 数组（形状变了？页面读的是 result.list）',
    )
  }
  return {
    ...(result as PageResult<SalaryStructureRow>),
    list: result.list.map((node) => {
      const { children: _children, ...rest } = node
      return rest
    }),
  }
}

/**
 * 复刻 `app/portal/utils/hr/task-type-config/api.js` 的 `unwrapTaskTypeList`：
 *
 * ```js
 * const data = result?.data || result || {}
 * return Array.isArray(data) ? data : (data.list || data.records || [])
 * ```
 *
 * 用的是 `||` **不是** `??` —— 差别只在**假值**上（`''` / `0` / `false` 会被跳过），
 * 空数组是真值、走的是前一支。语义照抄，别"顺手改成 `??`"。
 *
 * 这一层的必要性：SDK 的 `request` 已经把包络的 `data` 拆出来一次了，而页面这里又拆一次，
 * 说明**后端那个端点的 `data` 里还套着一层**（数组本身，或 `{list|records}`）。
 * **具体是哪一种没有实测过**（这一页既没有基准、也没有真跑过），所以按页面原样三种都收。
 */
export function unwrapTaskTypeList (result: unknown): TaskTypeConfigRow[] {
  const outer = result as { data?: unknown } | null | undefined
  const data = (outer?.data || result || {}) as unknown
  if (Array.isArray(data)) return data as TaskTypeConfigRow[]
  const holder = data as { list?: unknown; records?: unknown }
  return ((holder.list || holder.records || []) as TaskTypeConfigRow[])
}

// ---------------------------------------------------------------------------
// 参数表
// ---------------------------------------------------------------------------

/** 模板两页唯一开放的业务参数 */
const TEMPLATE_TYPE_PARAM: ParamSpec = {
  name: 'templateType',
  kind: 'enum',
  required: false,
  description:
    '模板类型：0 年度 / 1 月度。默认 0（页面下拉的第一项，且 `:allowClear="false"` —— 与页面一致，**清不掉**）',
  options: [
    { label: TEMPLATE_TYPE_LABEL[TEMPLATE_TYPE_YEAR], value: TEMPLATE_TYPE_YEAR },
    { label: TEMPLATE_TYPE_LABEL[TEMPLATE_TYPE_MONTH], value: TEMPLATE_TYPE_MONTH },
  ],
}

/**
 * 薪资结构四件套。`selection` / `dataType` **刻意不在表里**：它们是页面身份/端点选择，
 * 不是调用方能开的筛选（见文件头 ⑤），钉死在 `SALARY_STRUCTURE_FIELDS` 的装配里。
 */
const SALARY_STRUCTURE_PARAMS: ParamSpec[] = [
  {
    name: 'parentId',
    kind: 'number',
    required: false,
    description:
      '父目录 id，默认 0（根层）。**一次只取一层**：往下一层要先从上一层的行里拿 `dataType === 1` 的那条 id',
  },
  {
    name: 'keyword',
    kind: 'text',
    required: false,
    description:
      '名称关键字，**真的发给后端**（与利润/模板三页的本地过滤相反）。非空时端点换成 `searchPage`' +
      '并自动带上 `dataType=2`（只搜薪资结构、不搜目录）；服务端还会再 trim 一次（最多 100 字）',
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1（**按层**分页：每一层各自算）' },
  {
    name: 'pageSize',
    kind: 'number',
    required: false,
    description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}、上限 ${SALARY_STRUCTURE_MAX_PAGE_SIZE}（超出会被压到上限，与页面 \`Math.min(…,100)\` 一致；后端也校验 1..100）`,
  },
]

const STUDY_TASK_CONFIG_UPDATE_PARAMS: ParamSpec[] = [
  { name: 'weeklyProgressPercent', kind: 'number', required: true, description: '周课堂每节进度比例；页面校验为 0 < x <= 100，Portal 不做整数化。' },
  { name: 'morningProgressPercent', kind: 'number', required: true, description: '晨课堂每节进度比例；页面校验为 0 < x <= 100，Portal 不做整数化。' },
  { name: 'weeklyFlowerBaseline', kind: 'number', required: true, description: '周课堂小红花基线；页面输入为不小于 0 的整数，后端当前要求大于 0。' },
  { name: 'weeklyBonusScoreLimit', kind: 'number', required: true, description: '周课堂奖励分上限；页面允许最多 2 位小数，后端字段为 Integer，SDK 不替 Web 舍入小数。' },
  { name: 'status', kind: 'number', required: true, description: '状态：0=禁用，1=启用；页面 switch 发送数字而不是布尔值。' },
]

const ID_PARAM: ParamSpec = { name: 'id', kind: 'number', required: true, description: '页面记录 ID' }
const DRAFT_PARAM: ParamSpec = { name: 'draft', kind: 'text', required: true, description: 'prepare 返回的草稿；submit 会再次校验并按 Portal 请求发送' }
const FORM_PARAM: ParamSpec = { name: 'form', kind: 'text', required: true, description: 'Portal页面表单对象；prepare只校验和归一化，不发请求' }
const RECORD_PARAM: ParamSpec = { name: 'record', kind: 'text', required: true, description: 'Portal列表当前行；prepare按页面状态和子树规则生成删除草稿' }
const FILE_PARAM: ParamSpec = { name: 'file', kind: 'text', required: true, description: 'xlsx 文件的名称、base64 内容和 MIME 类型' }

function definition (id: string, title: string, pagePath: string, permission: string, write: boolean, params: ParamSpec[] = []): CapabilityDefinition {
  return { id, title, pagePath, permission, write, params }
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

export const perfManageTemplateCapabilities: CapabilityDefinition[] = [
  definition('perf-manage-profit-list', '查询利润树', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false),
  definition('perf-manage-profit-detail', '读取利润详情', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM]),
  definition('perf-manage-profit-prepare-create', '准备新建利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [FORM_PARAM]),
  definition('perf-manage-profit-create', '新建利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-create', '取消新建利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-prepare-update', '准备编辑利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [FORM_PARAM]),
  definition('perf-manage-profit-update', '编辑利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-update', '取消编辑利润或利润目录', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-prepare-delete', '准备递归删除利润节点', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [RECORD_PARAM]),
  definition('perf-manage-profit-delete', '递归删除利润节点', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-delete', '取消递归删除利润节点', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-prepare-import', '准备导入利润配置', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [FILE_PARAM, { name: 'type', kind: 'enum', required: true, options: [{ label: '目录', value: 1 }, { label: '利润', value: 2 }] }, { name: 'parentId', kind: 'number', required: false }]),
  definition('perf-manage-profit-import', '导入利润配置', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-import', '取消导入利润配置', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-line-list', '查询利润公式行', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [{ name: 'lineType', kind: 'number', required: true }]),
  definition('perf-manage-profit-variable-list', '查询利润公式变量', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [{ name: 'lineType', kind: 'number', required: true }]),
  definition('perf-manage-profit-years', '查询利润可用年份', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM]),
  definition('perf-manage-profit-data', '查询利润预测实际数据', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM]),
  definition('perf-manage-profit-data-by-year', '查询指定年份利润公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM, { name: 'year', kind: 'number', required: true }, { name: 'dataType', kind: 'enum', required: true, options: [{ label: '预测', value: 1 }, { label: '实际', value: 2 }] }]),
  definition('perf-manage-profit-prepare-save-data', '准备保存利润预测实际公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [FORM_PARAM]),
  definition('perf-manage-profit-save-data', '保存利润预测实际公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-save-data', '取消保存利润预测实际公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-prepare-sync-formula', '准备同步利润公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [{ name: 'name', kind: 'text', required: true }, { name: 'year', kind: 'number', required: true }, { name: 'month', kind: 'number', required: true }]),
  definition('perf-manage-profit-sync-formula', '同步利润公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', true, [DRAFT_PARAM]),
  definition('perf-manage-profit-cancel-sync-formula', '取消同步利润公式', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [DRAFT_PARAM]),
  definition('perf-manage-profit-usage-template', '查询利润模板使用情况', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM, TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-profit-usage-people', '查询利润人员使用情况', PROFIT_PAGE_PATH, '/dashboard/manage/profit', false, [ID_PARAM, TEMPLATE_TYPE_PARAM, { name: 'year', kind: 'number', required: false }, { name: 'month', kind: 'number', required: false }, { name: 'realName', kind: 'text', required: false }]),
  definition('perf-manage-salary-structure-list', '查询薪资结构树（按层分页）', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, SALARY_STRUCTURE_PARAMS),
  definition('perf-manage-salary-structure-detail', '读取薪资结构详情', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [ID_PARAM, { name: 'specialProportion', kind: 'number', required: false }]),
  definition('perf-manage-salary-structure-prepare-create', '准备新建薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [FORM_PARAM]),
  definition('perf-manage-salary-structure-create', '新建薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-cancel-create', '取消新建薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-prepare-update', '准备编辑薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [FORM_PARAM]),
  definition('perf-manage-salary-structure-update', '编辑薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-cancel-update', '取消编辑薪资结构或目录', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-prepare-status', '准备启用或停用薪资结构', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [ID_PARAM, { name: 'dataType', kind: 'number', required: true }, { name: 'currentStatus', kind: 'enum', required: true, options: [{ label: '停用', value: 0 }, { label: '启用', value: 1 }] }]),
  definition('perf-manage-salary-structure-status', '启用或停用薪资结构', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-cancel-status', '取消启用或停用薪资结构', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-prepare-delete', '准备删除薪资结构节点', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [RECORD_PARAM]),
  definition('perf-manage-salary-structure-delete', '删除薪资结构节点', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-cancel-delete', '取消删除薪资结构节点', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-usage', '查询薪资结构使用情况', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [ID_PARAM, TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-salary-standard-list', '查询薪资标准候选', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [{ name: 'pageNo', kind: 'number', required: false }, { name: 'pageSize', kind: 'number', required: false }, { name: 'keyword', kind: 'text', required: false }]),
  definition('perf-manage-salary-standard-detail', '读取薪资标准详情', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [ID_PARAM]),
  definition('perf-manage-salary-structure-prepare-config-update', '准备保存薪资结构配置', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [FORM_PARAM]),
  definition('perf-manage-salary-structure-config-update', '保存薪资结构配置', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-salary-structure-cancel-config-update', '取消保存薪资结构配置', SALARY_STRUCTURE_PAGE_PATH, '/dashboard/manage/salary-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-template-content-list', '查询模板内容树', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-template-content-detail', '读取模板内容基础信息', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [ID_PARAM]),
  definition('perf-manage-template-content-prepare-create', '准备新建模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [FORM_PARAM]),
  definition('perf-manage-template-content-create', '新建模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', true, [DRAFT_PARAM]),
  definition('perf-manage-template-content-cancel-create', '取消新建模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [DRAFT_PARAM]),
  definition('perf-manage-template-content-prepare-update', '准备编辑模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [FORM_PARAM]),
  definition('perf-manage-template-content-update', '编辑模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', true, [DRAFT_PARAM]),
  definition('perf-manage-template-content-cancel-update', '取消编辑模板内容或目录', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [DRAFT_PARAM]),
  definition('perf-manage-template-content-prepare-delete', '准备递归删除模板内容节点', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [RECORD_PARAM]),
  definition('perf-manage-template-content-delete', '递归删除模板内容节点', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', true, [DRAFT_PARAM]),
  definition('perf-manage-template-content-cancel-delete', '取消递归删除模板内容节点', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [DRAFT_PARAM]),
  definition('perf-manage-template-content-detail-get', '读取模板内容深层详情', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [ID_PARAM]),
  definition('perf-manage-template-content-prepare-detail-save', '准备保存模板内容深层详情', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [FORM_PARAM]),
  definition('perf-manage-template-content-detail-save', '保存模板内容深层详情', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', true, [DRAFT_PARAM]),
  definition('perf-manage-template-content-cancel-detail-save', '取消保存模板内容深层详情', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [DRAFT_PARAM]),
  definition('perf-manage-template-content-protocol-options', '查询年度模板内容候选', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [{ name: 'salaryId', kind: 'number', required: true }]),
  definition('perf-manage-template-content-month-info', '读取年度模板的月度信息', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [ID_PARAM]),
  definition('perf-manage-template-content-usage', '查询模板内容使用情况', TEMPLATE_CONTENT_PAGE_PATH, '/dashboard/manage/template-content', false, [ID_PARAM, TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-template-structure-list', '查询模板结构树', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-template-structure-detail', '读取模板结构基础信息', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [ID_PARAM]),
  definition('perf-manage-template-structure-prepare-create', '准备新建模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [FORM_PARAM]),
  definition('perf-manage-template-structure-create', '新建模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-cancel-create', '取消新建模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-prepare-update', '准备编辑模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [FORM_PARAM]),
  definition('perf-manage-template-structure-update', '编辑模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-cancel-update', '取消编辑模板结构或目录', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-prepare-delete', '准备递归删除模板结构节点', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [RECORD_PARAM]),
  definition('perf-manage-template-structure-delete', '递归删除模板结构节点', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-cancel-delete', '取消递归删除模板结构节点', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-detail-get', '读取模板结构深层详情', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [ID_PARAM]),
  definition('perf-manage-template-structure-prepare-detail-save', '准备保存模板结构深层详情', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [FORM_PARAM]),
  definition('perf-manage-template-structure-detail-save', '保存模板结构深层详情', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', true, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-cancel-detail-save', '取消保存模板结构深层详情', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [DRAFT_PARAM]),
  definition('perf-manage-template-structure-options', '查询模板结构候选', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-template-structure-usage', '查询模板结构使用情况', TEMPLATE_STRUCTURE_PAGE_PATH, '/dashboard/manage/template-structure', false, [ID_PARAM, TEMPLATE_TYPE_PARAM]),
  definition('perf-manage-study-task-config-get', '读取学习任务配置', STUDY_TASK_CONFIG_PAGE_PATH, '/dashboard/manage/study-task-config', false),
  definition('perf-manage-study-task-config-prepare-save', '准备保存学习任务配置', STUDY_TASK_CONFIG_PAGE_PATH, '/dashboard/manage/study-task-config', false, STUDY_TASK_CONFIG_UPDATE_PARAMS),
  definition('perf-manage-study-task-config-save', '保存学习任务配置', STUDY_TASK_CONFIG_PAGE_PATH, '/dashboard/manage/study-task-config', true, [DRAFT_PARAM]),
  definition('perf-manage-study-task-config-cancel-save', '取消保存学习任务配置', STUDY_TASK_CONFIG_PAGE_PATH, '/dashboard/manage/study-task-config', false, [DRAFT_PARAM]),
  definition('perf-manage-task-type-config-list', '查询任务类型评分配置', TASK_TYPE_CONFIG_PAGE_PATH, '/dashboard/manage/task-type-config', false),
  definition('perf-manage-task-type-config-prepare-update', '准备编辑任务类型评分配置', TASK_TYPE_CONFIG_PAGE_PATH, '/dashboard/manage/task-type-config', false, [ID_PARAM, { name: 'taskType', kind: 'number', required: true }, { name: 'selfEditable', kind: 'boolean', required: true }, { name: 'leaderEditable', kind: 'boolean', required: true }, { name: 'progressScoring', kind: 'boolean', required: true }, { name: 'formulaEnabled', kind: 'boolean', required: false }]),
  definition('perf-manage-task-type-config-update', '编辑任务类型评分配置', TASK_TYPE_CONFIG_PAGE_PATH, '/dashboard/manage/task-type-config', true, [DRAFT_PARAM, { name: 'formulaEnabled', kind: 'boolean', required: false }]),
  definition('perf-manage-task-type-config-cancel-update', '取消编辑任务类型评分配置', TASK_TYPE_CONFIG_PAGE_PATH, '/dashboard/manage/task-type-config', false, [DRAFT_PARAM]),
]

export const PERF_MANAGE_TEMPLATE_METHODS: Readonly<Record<string, string>> = {
  'perf-manage-profit-list': 'listProfits',
  'perf-manage-profit-detail': 'getProfit',
  'perf-manage-profit-prepare-create': 'prepareProfitCreate',
  'perf-manage-profit-create': 'submitProfitCreate',
  'perf-manage-profit-cancel-create': 'cancelProfitSave',
  'perf-manage-profit-prepare-update': 'prepareProfitUpdate',
  'perf-manage-profit-update': 'submitProfitUpdate',
  'perf-manage-profit-cancel-update': 'cancelProfitSave',
  'perf-manage-profit-prepare-delete': 'prepareProfitDelete',
  'perf-manage-profit-delete': 'submitProfitDelete',
  'perf-manage-profit-cancel-delete': 'cancelProfitSave',
  'perf-manage-profit-prepare-import': 'prepareProfitImport',
  'perf-manage-profit-import': 'submitProfitImport',
  'perf-manage-profit-cancel-import': 'cancelProfitImport',
  'perf-manage-profit-line-list': 'getProfitLineList',
  'perf-manage-profit-variable-list': 'getProfitVariables',
  'perf-manage-profit-years': 'getProfitYears',
  'perf-manage-profit-data': 'getProfitData',
  'perf-manage-profit-data-by-year': 'getProfitDataByYearAndDataType',
  'perf-manage-profit-prepare-save-data': 'prepareProfitDataSave',
  'perf-manage-profit-save-data': 'submitProfitDataSave',
  'perf-manage-profit-cancel-save-data': 'cancelProfitDataSave',
  'perf-manage-profit-prepare-sync-formula': 'prepareProfitFormulaSync',
  'perf-manage-profit-sync-formula': 'submitProfitFormulaSync',
  'perf-manage-profit-cancel-sync-formula': 'cancelProfitSave',
  'perf-manage-profit-usage-template': 'listProfitTemplateUsage',
  'perf-manage-profit-usage-people': 'listProfitPeopleUsage',
  'perf-manage-salary-structure-list': 'listSalaryStructures',
  'perf-manage-salary-structure-detail': 'getSalaryStructure',
  'perf-manage-salary-structure-prepare-create': 'prepareSalaryStructureCreate',
  'perf-manage-salary-structure-create': 'submitSalaryStructureCreate',
  'perf-manage-salary-structure-cancel-create': 'cancelSalaryStructureSave',
  'perf-manage-salary-structure-prepare-update': 'prepareSalaryStructureUpdate',
  'perf-manage-salary-structure-update': 'submitSalaryStructureUpdate',
  'perf-manage-salary-structure-cancel-update': 'cancelSalaryStructureSave',
  'perf-manage-salary-structure-prepare-status': 'prepareSalaryStructureStatus',
  'perf-manage-salary-structure-status': 'submitSalaryStructureStatus',
  'perf-manage-salary-structure-cancel-status': 'cancelSalaryStructureSave',
  'perf-manage-salary-structure-prepare-delete': 'prepareSalaryStructureDelete',
  'perf-manage-salary-structure-delete': 'submitSalaryStructureDelete',
  'perf-manage-salary-structure-cancel-delete': 'cancelSalaryStructureSave',
  'perf-manage-salary-structure-usage': 'listSalaryStructureUsage',
  'perf-manage-salary-standard-list': 'listSalaryStandards',
  'perf-manage-salary-standard-detail': 'getSalaryStandard',
  'perf-manage-salary-structure-prepare-config-update': 'prepareSalaryStructureConfigUpdate',
  'perf-manage-salary-structure-config-update': 'submitSalaryStructureConfigUpdate',
  'perf-manage-salary-structure-cancel-config-update': 'cancelSalaryStructureSave',
  'perf-manage-template-content-list': 'listTemplateContents',
  'perf-manage-template-content-detail': 'getTemplateContent',
  'perf-manage-template-content-prepare-create': 'prepareTemplateContentCreate',
  'perf-manage-template-content-create': 'submitTemplateContentCreate',
  'perf-manage-template-content-cancel-create': 'cancelTemplateContentSave',
  'perf-manage-template-content-prepare-update': 'prepareTemplateContentUpdate',
  'perf-manage-template-content-update': 'submitTemplateContentUpdate',
  'perf-manage-template-content-cancel-update': 'cancelTemplateContentSave',
  'perf-manage-template-content-prepare-delete': 'prepareTemplateContentDelete',
  'perf-manage-template-content-delete': 'submitTemplateContentDelete',
  'perf-manage-template-content-cancel-delete': 'cancelTemplateContentSave',
  'perf-manage-template-content-detail-get': 'getTemplateContentDetail',
  'perf-manage-template-content-prepare-detail-save': 'prepareTemplateContentDetailSave',
  'perf-manage-template-content-detail-save': 'submitTemplateContentDetailSave',
  'perf-manage-template-content-cancel-detail-save': 'cancelTemplateContentSave',
  'perf-manage-template-content-protocol-options': 'listTemplateContentProtocolOptions',
  'perf-manage-template-content-month-info': 'getTemplateContentMonthInfo',
  'perf-manage-template-content-usage': 'listTemplateContentUsage',
  'perf-manage-template-structure-list': 'listTemplateStructures',
  'perf-manage-template-structure-detail': 'getTemplateStructure',
  'perf-manage-template-structure-prepare-create': 'prepareTemplateStructureCreate',
  'perf-manage-template-structure-create': 'submitTemplateStructureCreate',
  'perf-manage-template-structure-cancel-create': 'cancelTemplateStructureSave',
  'perf-manage-template-structure-prepare-update': 'prepareTemplateStructureUpdate',
  'perf-manage-template-structure-update': 'submitTemplateStructureUpdate',
  'perf-manage-template-structure-cancel-update': 'cancelTemplateStructureSave',
  'perf-manage-template-structure-prepare-delete': 'prepareTemplateStructureDelete',
  'perf-manage-template-structure-delete': 'submitTemplateStructureDelete',
  'perf-manage-template-structure-cancel-delete': 'cancelTemplateStructureSave',
  'perf-manage-template-structure-detail-get': 'getTemplateStructureDetail',
  'perf-manage-template-structure-prepare-detail-save': 'prepareTemplateStructureDetailSave',
  'perf-manage-template-structure-detail-save': 'submitTemplateStructureDetailSave',
  'perf-manage-template-structure-cancel-detail-save': 'cancelTemplateStructureSave',
  'perf-manage-template-structure-options': 'listTemplateStructureOptions',
  'perf-manage-template-structure-usage': 'listTemplateStructureUsage',
  'perf-manage-study-task-config-get': 'getStudyTaskConfig',
  'perf-manage-study-task-config-prepare-save': 'prepareStudyTaskConfigSave',
  'perf-manage-study-task-config-save': 'submitStudyTaskConfigSave',
  'perf-manage-study-task-config-cancel-save': 'cancelStudyTaskConfigSave',
  'perf-manage-task-type-config-list': 'listTaskTypeConfigs',
  'perf-manage-task-type-config-prepare-update': 'prepareTaskTypeConfigUpdate',
  'perf-manage-task-type-config-update': 'submitTaskTypeConfigUpdate',
  'perf-manage-task-type-config-cancel-update': 'cancelTaskTypeConfigUpdate',
}

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 能力实现。`request` 由 SDK 门面注入，已经带好页面上下文
 * （module-type 走各页 `/dashboard/manage/*` 的推导结果 = 13 绩效管理）。
 *
 * 六页**六个 request**：每页一个，这样 module-type 与 http 实例都按各自的页面解析
 * （六页都走全局默认实例 `platform.js` —— 页面里 `customLoad`/自定义请求 import 的
 * 就是它，`useListPageModule` 那两页则压根没声明实例。两处推导结论一致）。
 */
export function createPerfManageTemplateCapability (
  /** 利润管理页 */
  requestProfit: PortalRequest,
  /** 薪资结构页 */
  requestSalaryStructure: PortalRequest,
  /** 模板内容页 */
  requestTemplateContent: PortalRequest,
  /** 模板结构页 */
  requestTemplateStructure: PortalRequest,
  /** 学习任务配置页 */
  requestStudyTaskConfig: PortalRequest,
  /** 任务类型配置页 */
  requestTaskTypeConfig: PortalRequest,
) {
  return {
    /**
     * 利润树。只读。
     *
     * 返回的是**整棵树**（后端 `CommonResult<List<KpiProfitListDTO>>`，**不分页**），
     * 目录节点带 `children`。要按名字找用
     * `filterTreeNodeByName(rows, keyword, isProfitLeaf)` —— 页面的「名称」是本地过滤。
     *
     * 实际发出的 URL：`GET /admin-api/performance/basedata/kpiprofit/page?order=&orderField=&_t=<ts>`
     */
    listProfits (): Promise<KpiProfitRow[]> {
      return requestProfit<KpiProfitRow[]>({
        url: PROFIT_LIST_PATH,
        method: 'get',
        params: buildParams(BASE_ORDER),
      })
    },

    getProfit (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestProfit<Record<string, unknown>>({ url: `${PROFIT_WRITE_PATH}/${resourceIdOf(id, '利润.id')}`, method: 'get' })
    },

    getProfitLineList (lineType: number): Promise<unknown> {
      return requestProfit({ url: PROFIT_LINE_LIST_PATH, method: 'get', params: { lineType: enumOf(lineType, [1, 2, 3, 4], 'lineType') } })
    },

    getProfitVariables (lineType: number): Promise<unknown> {
      return requestProfit({ url: PROFIT_VARIABLE_LIST_PATH, method: 'get', params: { lineType: enumOf(lineType, [1, 2, 3, 4], 'lineType') } })
    },

    getProfitYears (profitId: PerfManageResourceId): Promise<unknown> {
      return requestProfit({ url: PROFIT_YEAR_PATH, method: 'get', params: { profitId: resourceIdOf(profitId, 'profitId') } })
    },

    getProfitData (profitId: PerfManageResourceId): Promise<unknown> {
      return requestProfit({ url: PROFIT_DATA_PATH, method: 'get', params: { profitId: resourceIdOf(profitId, 'profitId') } })
    },

    getProfitDataByYearAndDataType (input: { profitId: PerfManageResourceId; year: number; dataType: 1 | 2 }): Promise<unknown> {
      const profitId = resourceIdOf(input?.profitId, 'profitId')
      const year = finiteNumberOf(input?.year, 'year')
      if (!Number.isInteger(year)) throw new Error('year必须是整数')
      const dataType = enumOf(input?.dataType, [1, 2], 'dataType')
      return requestProfit({ url: PROFIT_DATA_BY_YEAR_PATH, method: 'get', params: { dataType, year, profitId } })
    },

    prepareProfitDataSave (form: ProfitDataSave): { draft: ProfitDataSave } {
      return { draft: normalizeProfitDataSave(form) }
    },

    async submitProfitDataSave (input: { draft: ProfitDataSave }): Promise<void> {
      await requestProfit({ url: PROFIT_SAVE_DATA_PATH, method: 'post', data: normalizeProfitDataSave(input?.draft) })
    },

    cancelProfitDataSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    async syncProfitFormula (input: { name: string; year: number; month: number }): Promise<true> {
      const name = textOf(input?.name, 'name', 20)
      const year = finiteNumberOf(input?.year, 'year')
      const month = finiteNumberOf(input?.month, 'month')
      if (!Number.isInteger(year) || year < 1) throw new Error('year必须是正整数')
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month必须在1到12之间')
      const result = await requestProfit<unknown>({ url: PROFIT_FORMULA_SYNC_PATH, method: 'get', params: { name, year, month } })
      return trueResponseOf(result, '利润公式同步')
    },

    prepareProfitFormulaSync (input: { name: string; year: number; month: number }): { draft: { name: string; year: number; month: number } } {
      const name = textOf(input?.name, 'name', 20)
      const year = finiteNumberOf(input?.year, 'year')
      const month = finiteNumberOf(input?.month, 'month')
      if (!Number.isInteger(year) || year < 1) throw new Error('year必须是正整数')
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month必须在1到12之间')
      return { draft: { name, year, month } }
    },

    async submitProfitFormulaSync (input: { draft: { name: string; year: number; month: number } }): Promise<true> {
      const draft = objectOf(input?.draft, '利润公式同步草稿') as { name: string; year: number; month: number }
      return this.syncProfitFormula(draft)
    },

    async listProfitTemplateUsage (input: { id: PerfManageResourceId; templateType: TemplateType; name?: string; pageNo?: number; pageSize?: number; limit?: number }): Promise<unknown> {
      const page = usagePageOf(input, '利润模板使用情况')
      const templateType = enumOf(input?.templateType, [0, 1], 'templateType')
      const body = { ...page, subassemblyType: 1, name: input.name ?? '', templateType }
      return requestProfit({ url: `${PROFIT_WRITE_PATH}/usedInfo`, method: 'post', data: body })
    },

    async listProfitPeopleUsage (input: { id: PerfManageResourceId; templateType: TemplateType; year?: number | string; month?: number | string; realName?: string; pageNo?: number; pageSize?: number; limit?: number }): Promise<unknown> {
      const page = usagePageOf(input, '利润人员使用情况')
      const templateType = enumOf(input?.templateType, [0, 1], 'templateType')
      const body: Record<string, unknown> = { ...page, subassemblyType: 1, realName: input.realName ?? '', templateType }
      if (templateType === TEMPLATE_TYPE_YEAR) {
        if (input.year === undefined) throw new Error('年度利润人员使用情况必须提供year')
        body.year = String(input.year)
        return requestProfit({ url: `${PROFIT_WRITE_PATH}/PeopleYearUsedInfo`, method: 'post', data: body })
      }
      if (input.year === undefined || input.month === undefined) throw new Error('月度利润人员使用情况必须提供year和month')
      body.year = String(input.year)
      body.month = String(input.month)
      return requestProfit({ url: `${PROFIT_WRITE_PATH}/PeopleMonthUsedInfo`, method: 'post', data: body })
    },

    /**
     * 利润表单页的新增。页面字段顺序由 `useFormPageModule.form` 决定；这里复制调用方表单
     * 的键顺序，只对 Portal blur/submit 时确实改写的字段做归一化。
     */
    prepareProfitCreate (form: ProfitForm): { draft: Record<string, unknown> } {
      return { draft: copyFormWithPortalRules(form, '利润新建表单', 'create', 'profit') }
    },

    async submitProfitCreate (input: { draft: ProfitForm | Record<string, unknown> }): Promise<PerfManageResourceId> {
      const payload = copyFormWithPortalRules(input?.draft, '利润新建草稿', 'create', 'profit')
      const result = await requestProfit<unknown>({ url: PROFIT_WRITE_PATH, method: 'post', data: payload })
      return resourceIdOf(result, '新建利润返回ID')
    },

    prepareProfitUpdate (form: ProfitForm): { draft: Record<string, unknown> } {
      return { draft: copyFormWithPortalRules(form, '利润编辑表单', 'update', 'profit') }
    },

    async submitProfitUpdate (input: { draft: ProfitForm | Record<string, unknown> }): Promise<void> {
      const payload = copyFormWithPortalRules(input?.draft, '利润编辑草稿', 'update', 'profit')
      await requestProfit({ url: PROFIT_WRITE_PATH, method: 'put', data: payload })
    },

    prepareProfitDelete (input: { record: KpiProfitRow }): { draft: { ids: PerfManageResourceId[] } } {
      return { draft: idsDraftOf(input, '利润删除') }
    },

    async submitProfitDelete (input: { draft: { ids: PerfManageResourceId[] } }): Promise<void> {
      const value = objectOf(input?.draft, '利润删除草稿')
      // `prepareProfitDelete` 已经按页面递归收集 ids；submit 只重新校验列表，不重新遍历行树。
      if (!Array.isArray(value.ids) || value.ids.length === 0) {
        throw new Error('利润删除草稿.ids必须是非空数组')
      }
      const ids = value.ids.map((id) => resourceIdOf(id, '利润删除草稿.ids中的ID'))
      await requestProfit({ url: PROFIT_WRITE_PATH, method: 'delete', data: { ids } })
    },

    prepareProfitImport (input: { file: PerfManageTemplateFile; type: 1 | 2; parentId?: PerfManageResourceId | '' }): { draft: ProfitImportDraft } {
      return { draft: normalizedProfitImport(input) }
    },

    async submitProfitImport (input: { draft: ProfitImportDraft }): Promise<string[]> {
      const draft = normalizedProfitImport(input?.draft)
      const result = await requestProfit<unknown>({
        url: PROFIT_IMPORT_PATH,
        method: 'post',
        data: formDataOf(draft),
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return resultListOf(result, '利润导入')
    },

    cancelProfitSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    cancelProfitImport (): { cancelled: boolean } {
      return { cancelled: true }
    },

    /**
     * 薪资结构**按层分页**查询。只读。
     *
     * ⚠️ 这一页与本地源码不一致（本地旧版是 `…/page` + 无分页），契约以基准为准：
     *
     * | 调用 | 实际请求 |
     * | --- | --- |
     * | `listSalaryStructures()` | `GET /admin-api/performance/basedata/kpisalarystructure/treePage?parentId=0&keyword=&selection=false&pageNo=1&pageSize=20&_t=<ts>` |
     * | `listSalaryStructures({ keyword: '销售' })` | `GET …/searchPage?parentId=0&keyword=销售&dataType=2&selection=false&pageNo=1&pageSize=20&_t=<ts>` |
     *
     * 三条要点：
     * - **一次只取一层。** 根层是 `parentId=0`；点某个目录 = 用它的 id 再查一次
     *   （页面的面包屑就是自己攒的路径）。所以调用方要做"按名字搜"时注意：
     *   `keyword` 非空走 `searchPage`、只返回 `dataType=2` 的**薪资结构**（目录整个不出现）。
     * - `keyword` 会先 `trim()`（页面里是 `(form.templateName || '').trim()`），
     *   空格串等于没传 —— 会走 `treePage`，与页面一致。
     * - `pageSize` 按页面的 `Math.min(Number(…) || 20, 100)` 压到 100 以内，
     *   防止后端那条「每页数量为1至100」的业务错。
     *
     * 行上的 `status`（0 停用 / 1 启用）决定写能力的前置顺序：**启用中的薪资结构禁止删除**，
     * 要先「禁用」才能删（页面把删除按钮禁掉的那一条）。
     */
    listSalaryStructures (
      query: SalaryStructureQuery = {},
    ): Promise<PageResult<SalaryStructureRow>> {
      const keyword = String(query.keyword ?? '').trim()
      const rawPageSize = Number(query.pageSize ?? DEFAULT_PAGE_SIZE)
      const rawPageNo = Number(query.pageNo ?? 1)
      const params = buildParams(
        SALARY_STRUCTURE_FIELDS,
        {
          parentId: query.parentId,
          keyword,
          pageNo: Number.isFinite(rawPageNo) && rawPageNo > 0 ? rawPageNo : 1,
          pageSize: Number.isFinite(rawPageSize) && rawPageSize > 0
            ? Math.min(rawPageSize, SALARY_STRUCTURE_MAX_PAGE_SIZE)
            : DEFAULT_PAGE_SIZE,
        },
        {
          // 页面原文：`dataType: keyword ? 2 : undefined`。
          // 为空时**必须**是 undefined（qs 的 skipNulls 才会丢掉它），不能是 ''。
          dataType: keyword ? 2 : undefined,
          // 页面身份标记，钉死 false（漏发/发 true 都等于换到"选择器"那个可见范围）
          selection: false,
        },
      )
      return requestSalaryStructure<PageResult<SalaryStructureRow>>({
        url: keyword ? SALARY_STRUCTURE_SEARCH_PATH : SALARY_STRUCTURE_TREE_PATH,
        method: 'get',
        params,
      }).then(normalizeSalaryStructurePage)
    },

    getSalaryStructure (input: { id: PerfManageResourceId; specialProportion?: number } | PerfManageResourceId): Promise<Record<string, unknown>> {
      const value = typeof input === 'object' && input !== null ? input : { id: input }
      const id = resourceIdOf(value.id, '薪资结构.id')
      const params = value.specialProportion === undefined
        ? undefined
        : { specialProportion: finiteNumberOf(value.specialProportion, 'specialProportion') }
      return requestSalaryStructure<Record<string, unknown>>({ url: `${SALARY_STRUCTURE_WRITE_PATH}/${id}`, method: 'get', ...(params ? { params } : {}) })
    },

    async listSalaryStructureUsage (input: { id: PerfManageResourceId; templateType: TemplateType; name?: string; pageNo?: number; pageSize?: number; limit?: number }): Promise<unknown> {
      const page = usagePageOf(input, '薪资结构使用情况')
      const templateType = enumOf(input?.templateType, [0, 1], 'templateType')
      return requestSalaryStructure({
        url: SALARY_STRUCTURE_USAGE_PATH,
        method: 'post',
        data: { ...page, subassemblyType: 2, name: input.name ?? '', templateType },
      })
    },

    async listSalaryStandards (input: { pageNo?: number; pageSize?: number; keyword?: string } = {}): Promise<unknown> {
      const pageNo = input.pageNo === undefined ? 1 : finiteNumberOf(input.pageNo, '薪资标准pageNo')
      const pageSize = input.pageSize === undefined ? DEFAULT_PAGE_SIZE : finiteNumberOf(input.pageSize, '薪资标准pageSize')
      if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error('薪资标准pageNo必须是正整数')
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > SALARY_STRUCTURE_MAX_PAGE_SIZE) throw new Error('薪资标准pageSize必须在1到100之间')
      const keyword = input.keyword === undefined ? undefined : String(input.keyword).trim()
      return requestSalaryStructure({
        url: SALARY_STANDARD_SELECT_PAGE_PATH,
        method: 'get',
        params: { pageNo, pageSize, ...(keyword ? { keyword } : {}) },
      })
    },

    getSalaryStandard (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestSalaryStructure<Record<string, unknown>>({ url: `${SALARY_STANDARD_DETAIL_PATH}/${resourceIdOf(id, '薪资标准.id')}`, method: 'get' })
    },

    prepareSalaryStructureCreate (form: SalaryStructureForm): { draft: Record<string, unknown> } {
      return { draft: copyFormWithPortalRules(form, '薪资结构新建表单', 'create', 'salary') }
    },

    async submitSalaryStructureCreate (input: { draft: SalaryStructureForm | Record<string, unknown> }): Promise<PerfManageResourceId> {
      const payload = copyFormWithPortalRules(input?.draft, '薪资结构新建草稿', 'create', 'salary')
      const result = await requestSalaryStructure<unknown>({ url: SALARY_STRUCTURE_WRITE_PATH, method: 'post', data: payload })
      return resourceIdOf(result, '新建薪资结构返回ID')
    },

    prepareSalaryStructureUpdate (form: SalaryStructureForm): { draft: Record<string, unknown> } {
      return { draft: copyFormWithPortalRules(form, '薪资结构编辑表单', 'update', 'salary') }
    },

    async submitSalaryStructureUpdate (input: { draft: SalaryStructureForm | Record<string, unknown> }): Promise<void> {
      const payload = copyFormWithPortalRules(input?.draft, '薪资结构编辑草稿', 'update', 'salary')
      await requestSalaryStructure({ url: SALARY_STRUCTURE_WRITE_PATH, method: 'put', data: payload })
    },

    prepareSalaryStructureStatus (input: { id: PerfManageResourceId; dataType: number; currentStatus: 0 | 1 }): { draft: { id: PerfManageResourceId; status: 0 | 1 }; previousStatus: 0 | 1 } {
      return normalizedSalaryStatus(input)
    },

    async submitSalaryStructureStatus (input: { draft: { id: PerfManageResourceId; status: 0 | 1 } }): Promise<void> {
      const value = objectOf(input?.draft, '薪资结构启停草稿')
      const payload = {
        id: resourceIdOf(value.id, '薪资结构启停草稿.id'),
        status: enumOf(value.status, [0, 1], '薪资结构启停草稿.status'),
      }
      await requestSalaryStructure({ url: SALARY_STRUCTURE_STATUS_PATH, method: 'put', data: payload })
    },

    prepareSalaryStructureDelete (input: { record: SalaryStructureRow }): { draft: { ids: PerfManageResourceId[] } } {
      const value = objectOf(input?.record, '薪资结构删除.record') as SalaryStructureRow
      if (value.dataType === 2 && value.status === 1) throw new Error('Portal不允许删除启用中的薪资结构')
      return { draft: { ids: [resourceIdOf(value.id, '薪资结构删除.record.id')] } }
    },

    async submitSalaryStructureDelete (input: { draft: { ids: PerfManageResourceId[] } }): Promise<void> {
      const value = objectOf(input?.draft, '薪资结构删除草稿')
      if (!Array.isArray(value.ids) || value.ids.length !== 1) throw new Error('薪资结构删除草稿.ids必须恰好包含一条记录')
      const ids = [resourceIdOf(value.ids[0], '薪资结构删除草稿.ids[0]')]
      await requestSalaryStructure({ url: SALARY_STRUCTURE_WRITE_PATH, method: 'delete', data: { ids } })
    },

    prepareSalaryStructureConfigUpdate (form: SalaryStructureConfigForm): { draft: SalaryStructureConfigForm } {
      return { draft: normalizedSalaryStructureConfig(form) }
    },

    async submitSalaryStructureConfigUpdate (input: { draft: SalaryStructureConfigForm }): Promise<true> {
      const result = await requestSalaryStructure<unknown>({ url: SALARY_STRUCTURE_WRITE_PATH, method: 'put', data: normalizedSalaryStructureConfig(input?.draft) })
      return trueResponseOf(result, '薪资结构配置保存')
    },

    cancelSalaryStructureSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    /**
     * 模板内容树。只读。**不分页**。
     *
     * 唯一开放的业务参数是 `templateType`（0 年度 / 1 月度），默认 0 ——
     * 与页面下拉一致（第一项、不可清空）。叶子是 `type === 1`（`0` 是文件夹），
     * 本地过滤用 `filterTreeNodeByName(rows, kw, isTemplateLeaf)`。
     *
     * 实际发出的 URL：`GET /admin-api/performance/temcontent/kpitemprotocol/page?order=&orderField=&templateType=0&_t=<ts>`
     */
    listTemplateContents (query: { templateType?: TemplateType } = {}): Promise<TemTemplateRow[]> {
      return requestTemplateContent<TemTemplateRow[]>({
        url: TEMPLATE_CONTENT_LIST_PATH,
        method: 'get',
        params: buildParams(TEMPLATE_FIELDS, query as Record<string, unknown>),
      })
    },

    /**
     * 模板结构树。只读。**不分页**。与 `listTemplateContents` **同形同顺序**，
     * 只有端点不同（`temstructure/kpitemstructure`）、「类型」那一列文案不同
     * （页面那一列叫「模板结构类型」）。
     *
     * ⚠️ 页面把「切换 `templateType` 即重查」的 `watch` **注释掉了**
     * （`template-structure/list.vue:149`）—— 换类型必须再点「查询」。
     * 无头侧调这个方法就等于重查，所以这条只是记一笔。
     */
    listTemplateStructures (query: { templateType?: TemplateType } = {}): Promise<TemTemplateRow[]> {
      return requestTemplateStructure<TemTemplateRow[]>({
        url: TEMPLATE_STRUCTURE_LIST_PATH,
        method: 'get',
        params: buildParams(TEMPLATE_FIELDS, query as Record<string, unknown>),
      })
    },

    getTemplateContent (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestTemplateContent<Record<string, unknown>>({ url: `${TEMPLATE_CONTENT_WRITE_PATH}/${resourceIdOf(id, '模板内容.id')}`, method: 'get' })
    },

    prepareTemplateContentCreate (form: TemplateNodeForm): { draft: Record<string, unknown> } {
      return { draft: normalizedTemplateNode(form, '模板内容新建表单', 'create') }
    },

    async submitTemplateContentCreate (input: { draft: TemplateNodeForm | Record<string, unknown> }): Promise<PerfManageResourceId> {
      const result = await requestTemplateContent<unknown>({ url: TEMPLATE_CONTENT_WRITE_PATH, method: 'post', data: normalizedTemplateNode(input?.draft, '模板内容新建草稿', 'create') })
      return resourceIdOf(result, '新建模板内容返回ID')
    },

    prepareTemplateContentUpdate (form: TemplateNodeForm): { draft: Record<string, unknown> } {
      return { draft: normalizedTemplateNode(form, '模板内容编辑表单', 'update') }
    },

    async submitTemplateContentUpdate (input: { draft: TemplateNodeForm | Record<string, unknown> }): Promise<true> {
      const result = await requestTemplateContent<unknown>({ url: TEMPLATE_CONTENT_WRITE_PATH, method: 'put', data: normalizedTemplateNode(input?.draft, '模板内容编辑草稿', 'update') })
      return trueResponseOf(result, '模板内容基础信息保存')
    },

    /** 模板内容列表删除：页面按 mapTree 收集整棵子树，再向 Java 发送裸数组。 */
    prepareTemplateContentDelete (input: { record: TemTemplateRow }): { draft: { ids: PerfManageResourceId[] } } {
      return { draft: idsDraftOf(input, '模板内容删除') }
    },

    async submitTemplateContentDelete (input: { draft: { ids: PerfManageResourceId[] } }): Promise<void> {
      const value = objectOf(input?.draft, '模板内容删除草稿')
      if (!Array.isArray(value.ids) || value.ids.length === 0) throw new Error('模板内容删除草稿.ids不能为空')
      const ids = value.ids.map((id) => resourceIdOf(id, '模板内容删除草稿.ids中的ID'))
      await requestTemplateContent({ url: TEMPLATE_CONTENT_WRITE_PATH, method: 'delete', data: ids })
    },

    /**
     * 模板详情页 `template-content/template/[mode]/[id].vue` 的保存。
     * 这不是列表页的基础信息 POST/PUT；只对应该详情页实际调用的
     * `saveProtocolInfo`，并复刻年度任务字段清理和特殊组件空行过滤。
     */
    prepareTemplateContentDetailSave (form: TemplateContentDetail): { draft: TemplateContentDetail } {
      return { draft: normalizedTemplateContentDetail(form) }
    },

    async submitTemplateContentDetailSave (input: { draft: TemplateContentDetail }): Promise<void> {
      const draft = normalizedTemplateContentDetail(input?.draft)
      await requestTemplateContent({ url: TEMPLATE_CONTENT_DETAIL_SAVE_PATH, method: 'post', data: draft })
    },

    getTemplateContentDetail (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestTemplateContent<Record<string, unknown>>({ url: TEMPLATE_CONTENT_DETAIL_PATH, method: 'get', params: { id: resourceIdOf(id, '模板内容深层详情.id') } })
    },

    listTemplateContentProtocolOptions (input: { salaryId: PerfManageResourceId }): Promise<unknown> {
      return requestTemplateContent({ url: TEMPLATE_CONTENT_PROTOCOL_LIST_PATH, method: 'get', params: { templateType: TEMPLATE_TYPE_YEAR, salaryId: resourceIdOf(input?.salaryId, 'salaryId') } })
    },

    getTemplateContentMonthInfo (id: PerfManageResourceId): Promise<unknown> {
      return requestTemplateContent({ url: TEMPLATE_CONTENT_MONTH_INFO_PATH, method: 'get', params: { id: resourceIdOf(id, '模板内容年度ID') } })
    },

    async listTemplateContentUsage (input: { id: PerfManageResourceId; templateType: TemplateType; year?: number | string; month?: number | string; realName?: string; pageNo?: number; pageSize?: number; limit?: number }): Promise<unknown> {
      const page = usagePageOf(input, '模板内容使用情况')
      const templateType = enumOf(input?.templateType, [0, 1], 'templateType')
      const body: Record<string, unknown> = { ...page, templateType, realName: input.realName ?? '' }
      if (templateType === TEMPLATE_TYPE_YEAR) {
        if (input.year === undefined) throw new Error('年度模板内容使用情况必须提供year')
        body.year = String(input.year)
        return requestTemplateContent({ url: TEMPLATE_CONTENT_USAGE_YEAR_PATH, method: 'post', data: body })
      }
      if (input.year === undefined || input.month === undefined) throw new Error('月度模板内容使用情况必须提供year和month')
      body.year = String(input.year)
      body.month = String(input.month)
      return requestTemplateContent({ url: TEMPLATE_CONTENT_USAGE_MONTH_PATH, method: 'post', data: body })
    },

    getTemplateStructure (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestTemplateStructure<Record<string, unknown>>({ url: `${TEMPLATE_STRUCTURE_WRITE_PATH}/${resourceIdOf(id, '模板结构.id')}`, method: 'get' })
    },

    prepareTemplateStructureCreate (form: TemplateNodeForm): { draft: Record<string, unknown> } {
      return { draft: normalizedTemplateNode(form, '模板结构新建表单', 'create') }
    },

    async submitTemplateStructureCreate (input: { draft: TemplateNodeForm | Record<string, unknown> }): Promise<PerfManageResourceId> {
      const result = await requestTemplateStructure<unknown>({ url: TEMPLATE_STRUCTURE_WRITE_PATH, method: 'post', data: normalizedTemplateNode(input?.draft, '模板结构新建草稿', 'create') })
      return resourceIdOf(result, '新建模板结构返回ID')
    },

    prepareTemplateStructureUpdate (form: TemplateNodeForm): { draft: Record<string, unknown> } {
      return { draft: normalizedTemplateNode(form, '模板结构编辑表单', 'update') }
    },

    async submitTemplateStructureUpdate (input: { draft: TemplateNodeForm | Record<string, unknown> }): Promise<true> {
      const result = await requestTemplateStructure<unknown>({ url: TEMPLATE_STRUCTURE_WRITE_PATH, method: 'put', data: normalizedTemplateNode(input?.draft, '模板结构编辑草稿', 'update') })
      return trueResponseOf(result, '模板结构基础信息保存')
    },

    prepareTemplateStructureDelete (input: { record: TemTemplateRow }): { draft: { ids: PerfManageResourceId[] } } {
      return { draft: idsDraftOf(input, '模板结构删除') }
    },

    async submitTemplateStructureDelete (input: { draft: { ids: PerfManageResourceId[] } }): Promise<true> {
      const value = objectOf(input?.draft, '模板结构删除草稿')
      if (!Array.isArray(value.ids) || value.ids.length === 0) throw new Error('模板结构删除草稿.ids不能为空')
      const ids = value.ids.map((id) => resourceIdOf(id, '模板结构删除草稿.ids中的ID'))
      const result = await requestTemplateStructure<unknown>({ url: TEMPLATE_STRUCTURE_WRITE_PATH, method: 'delete', data: ids })
      return trueResponseOf(result, '模板结构删除')
    },

    getTemplateStructureDetail (id: PerfManageResourceId): Promise<Record<string, unknown>> {
      return requestTemplateStructure<Record<string, unknown>>({ url: TEMPLATE_STRUCTURE_DETAIL_PATH, method: 'get', params: { id: resourceIdOf(id, '模板结构深层详情.id') } })
    },

    prepareTemplateStructureDetailSave (form: TemplateStructureDetail): { draft: TemplateStructureDetail } {
      return { draft: normalizedTemplateStructureDetail(form) as TemplateStructureDetail }
    },

    async submitTemplateStructureDetailSave (input: { draft: TemplateStructureDetail }): Promise<true> {
      const result = await requestTemplateStructure<unknown>({ url: TEMPLATE_STRUCTURE_DETAIL_SAVE_PATH, method: 'post', data: normalizedTemplateStructureDetail(input?.draft) })
      return trueResponseOf(result, '模板结构深层详情保存')
    },

    listTemplateStructureOptions (input: { templateType?: TemplateType } = {}): Promise<unknown> {
      const templateType = enumOf(input.templateType ?? TEMPLATE_TYPE_YEAR, [0, 1], 'templateType')
      return requestTemplateStructure({ url: TEMPLATE_STRUCTURE_LIST_PATH, method: 'get', params: { templateType } })
    },

    async listTemplateStructureUsage (input: { id: PerfManageResourceId; templateType: TemplateType; name?: string; pageNo?: number; pageSize?: number; limit?: number }): Promise<unknown> {
      const page = usagePageOf(input, '模板结构使用情况')
      const templateType = enumOf(input?.templateType, [0, 1], 'templateType')
      const result = await requestTemplateStructure({ url: TEMPLATE_STRUCTURE_USAGE_PATH, method: 'post', data: { ...page, subassemblyType: 3, name: input.name ?? '', templateType } })
      return result
    },

    cancelTemplateContentSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    cancelTemplateStructureSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    /**
     * 读取学习任务配置（五个标量）。只读。
     *
     * **没有查询参数** —— 页面是 `http.get(CONFIG_URL)`，连 config 都没传，
     * 所以 URL 上只有客户端补的 `_t`。`params` **刻意不传**（不是传空对象：
     * 页面这里确实没有 `{ params }` 这一层，与任务类型配置页相反）。
     */
    getStudyTaskConfig (): Promise<StudyTaskConfig> {
      return requestStudyTaskConfig<StudyTaskConfig>({
        url: STUDY_TASK_CONFIG_PATH,
        method: 'get',
      })
    },

    /** 保存页面表单的五个字段；Portal 不发送查询参数，也不改写小数。 */
    async saveStudyTaskConfig (input: StudyTaskConfigUpdate): Promise<void> {
      await requestStudyTaskConfig({
        url: STUDY_TASK_CONFIG_PATH,
        method: 'post',
        data: normalizeStudyTaskConfigUpdate(input),
      })
    },

    prepareStudyTaskConfigSave (form: StudyTaskConfigUpdate): { draft: StudyTaskConfigUpdate } {
      return { draft: normalizeStudyTaskConfigUpdate(form) }
    },

    async submitStudyTaskConfigSave (input: { draft: StudyTaskConfigUpdate }): Promise<void> {
      await this.saveStudyTaskConfig(normalizeStudyTaskConfigUpdate(input?.draft))
    },

    cancelStudyTaskConfigSave (): { cancelled: boolean } {
      return { cancelled: true }
    },

    /**
     * 任务类型评分配置列表。只读。
     *
     * 页面调的是 `taskTypeConfigApi.list()` —— `params` 是**显式空对象** `{}`
     * （`api.js` 的 `list (params = {})`），后端那个方法也不收任何参数，
     * 所以 URL 上同样只有 `_t`。返回体按页面自己的 `unwrapTaskTypeList` 拆。
     */
    async listTaskTypeConfigs (): Promise<TaskTypeConfigRow[]> {
      const result = await requestTaskTypeConfig<unknown>({
        url: TASK_TYPE_CONFIG_LIST_PATH,
        method: 'get',
        params: {},
      })
      return unwrapTaskTypeList(result)
    },

    prepareTaskTypeConfigUpdate (input: TaskTypeConfigUpdate & { formulaEnabled?: boolean }): TaskTypeConfigUpdatePreparation {
      return normalizedTaskTypeUpdate(input)
    },

    async submitTaskTypeConfigUpdate (input: TaskTypeConfigUpdatePreparation): Promise<true> {
      const prepared = normalizedTaskTypeUpdate({ ...input?.draft, formulaEnabled: input?.formulaEnabled })
      const result = await requestTaskTypeConfig<unknown>({
        url: TASK_TYPE_CONFIG_UPDATE_PATH,
        method: 'put',
        // Java DTO 没有 id，但 Portal 页面实际把 id 放在请求体中；保留其键顺序。
        data: prepared.draft,
      })
      return trueResponseOf(result, '任务类型配置更新')
    },

    cancelTaskTypeConfigUpdate (): { cancelled: boolean } {
      return { cancelled: true }
    },
  }
}

export type PerfManageTemplateCapability = ReturnType<typeof createPerfManageTemplateCapability>

/*
 * ---------------------------------------------------------------------------
 * 已查清、**本轮没做**的写入口（将来做的时候省一轮侦察）
 * ---------------------------------------------------------------------------
 *
 * 利润管理（页面 `profit/list.vue`，接口见 `KpiProfitController`）
 * - 删：`DELETE /performance/basedata/kpiprofit`，body **`{ ids: [...] }`**
 *   （后端签名是 `Map<String, List<Long>>`，所以**不是**裸数组）。
 *   删目录时页面先 `searchFiles` + `flatTree` 把整棵子树的 id 收齐再删 —— 递归删除。
 * - 建/改：`POST` / `PUT /performance/basedata/kpiprofit`（body `KpiProfitDTO`）。
 * - 导入利润：`POST /performance/basedata/kpiprofit/import`，**multipart**，
 *   字段 `file` / `type` / `parentId`。
 * - 同步公式：`GET /performance/basedata/kpiprofit/formulaUpdates`（注意是 **GET**，
 *   页面经由 `components/formula-sync.vue` 的 `http.get(submitApi)`）。
 *   ⚠️ 它的**前置取数**在线上版已经改了（本地检出还是旧的）：不再拉
 *   `kpiprofit/allList`，而是 `record.lineType` 为空时才
 *   `GET /performance/basedata/kpiprofit/{id}`。做写能力时按线上那版写。
 * - 模板下载：`GET /performance/basedata/kpitarget/download`，走
 *   `newPageWithPlatformAuth(...)` 开新页 —— **浏览器下载，不是 JSON 接口**，
 *   无头不该把它做成能力。
 * - 子页面：`./profit-data?id=<profitId>`（预测/实际利润和公式）。
 *
 * 薪资结构（接口见 `KpiSalaryStructureController`）
 * - 启用/停用：`PUT /performance/basedata/kpisalarystructure/updateStatus`
 *   body `{ id, status }` —— 形状正好是 `prepare → submit` 那两步。
 * - 删：`DELETE /performance/basedata/kpisalarystructure` body `{ ids: [...] }`（同上，Map）。
 *   页面在**启用中**（`status === 1 && dataType === 2`）时把删除按钮禁用 ——
 *   真要做写能力，这个前置检查得自己带上。
 *   ⚠️ **不再递归删子树**：线上版把 `searchFiles` + `flatTree` 那段去掉了，现在是
 *   `const ids = [record.id]`（本地旧版才收整棵子树）。删目录要连带子节点得自己收 id。
 * - 建/改：`POST` / `PUT /performance/basedata/kpisalarystructure`。
 * - 子页面：`./salary-structure-config?id=<id>`。
 *
 * 模板内容 / 模板结构（`KpiTemProtocolController` / `KpiTemStructureController`，两页对称）
 * - 删：`DELETE /performance/temcontent/kpitemprotocol`，body 是**裸数组 `Long[] ids`**
 *   （**与利润/薪资结构相反**：那边是 `{ ids }`，这边是 `[id, ...]`；
 *   页面 `customDelete` 里也是 `http.delete(url, { data: list })`，list 是数组）。
 *   同样是递归删除（`mapTree` 收子节点 id）。
 * - 建/改：`POST` / `PUT /performance/temcontent/kpitemprotocol`（结构页同形）。
 * - 子页面：`./template/edit/<id>`（编辑模板内容 / 模板结构），
 *   里面的 `saveProtocolInfo` / `saveStructure` 才是真正改模板的地方。
 *
 * 学习任务配置
 * - 存：`POST /performance/protocol/kpimonthprotocol/study-task-config`，
 *   body 就是 GET 回来的那五个字段（`KpiStudyTaskConfigDTO`）。
 *   页面校验：两个比例都**必填**且 `0 < x <= 100`（`validatePercent`）。
 *   ⚠️ 顺带记一条**页面与后端可能对不上**的地方（未实测，只读源码）：前端两个比例是
 *   `a-input-number :precision="2"`（允许两位小数），后端 DTO 字段是 **`Integer`** ——
 *   真填 `12.5` 提交时 Jackson 反序列化大概率直接 400。这属于页面/后端之间的事，SDK 不碰，
 *   但做写能力时**必须先试一次小数**再决定参数类型。
 *
 * 任务类型配置
 * - 改：`PUT /performance/task-type-config/update`，
 *   body `{ id, taskType, selfEditable, leaderEditable, progressScoring }`
 *   （后端 `KpiTaskTypeConfigUpdateDTO` 三个布尔都是 `@NotNull`）。
 *   页面自己还有一条互斥规则：`formulaEnabled` 为真时 `progressScoring` 必须为 false。
 * - `api.js` 里另有 `button/list|create|update|status|sort|delete` 六个端点
 *   （`/performance/task-type-config/button/*`），**本页一个都没调** ——
 *   它们是别的页面/组件的，别因为同文件就当成这一页的写入口。
 */
