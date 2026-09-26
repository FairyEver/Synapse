import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/**
 * 绩效管理域（`moduleType = 13`）—— 双赢协议（KPI 协议）的五个列表页。
 *
 * | 页面（菜单标题） | 菜单路径 | 路由文件 | 接口 | 方法 |
 * | --- | --- | --- | --- | --- |
 * | 状态变更 | `/dashboard/agreement-change/main/list` | `…/hr/agreement-change/main/list.vue` | `/performance/protocol/kpi{month,year}protocol/othersPage` | GET |
 * | 个人月度 | `/dashboard/month-agreement/main/list` | `…/hr/month-agreement/main/list.vue` | `/performance/protocol/kpimonthprotocol/page` | GET |
 * | 所辖月度 | `/dashboard/month-agreement/others/list` | `…/hr/month-agreement/others/list.vue` | `/performance/protocol/kpimonthprotocol/othersPage` | GET |
 * | 个人年度 | `/dashboard/year-agreement/main/list` | `…/hr/year-agreement/main/list.vue` | `/performance/protocol/kpiyearprotocol/page` | GET |
 * | 所辖年度 | `/dashboard/year-agreement/others/list` | `…/hr/year-agreement/others/list.vue` | `/performance/protocol/kpiyearprotocol/othersPage` | GET |
 *
 * 「个人」(main) 与「所辖」(others) 是同一份数据的两个视角：`…/page` 是**我的**协议，
 * `…/othersPage` 是**我管辖范围内**的协议（`others` 两页在路由 meta 里挂的权限码也确实是
 * `/dashboard/other-task/{month,year}`，与菜单路径不同名 —— 见
 * `generated/page-catalog.json` 的 `permission` 字段，本文件照抄它）。
 *
 * ⚠️ 本文件**没有基准文件**（这一波派单只产出能力文件）。下面每一条参数顺序都是**读源码推出来的**，
 * 逐条在注释里给了出处；哪几处是推断、哪几处没测到，见文末「账」一节。
 *
 * ## 一、参数顺序是从源码推出来的，不是抄基准
 *
 * `common/libs/renren/list.js:473-483` 把列表参数拼成：
 *
 * ```js
 * const _form = convertFetchFormTrigger(cloneDeep(formState.value))
 * const params = { order: orderType.value, orderField: orderField.value, ..._form }
 * if (getDataListIsPage) { params.pageNo = …; params.pageSize = … }
 * ```
 *
 * ⇒ 顺序恒为 **`order` → `orderField` → `convertFetchForm` 的返回值 → `pageNo` → `pageSize` → `_t`**。
 * 五页**都没有** `order`/`orderField` 这两个控件（`orderType`/`orderField` 初值是 `''`，
 * 见 `list.js:295-296`），所以这两项一律钉死成空串、不开放。
 * 五页**都写了** `getDataListIsPage: true`，所以分页两项都在。
 *
 * 每个能力的参数表 = 「那一页 `convertFetchForm` 的返回值原样展开」。**没有** `convertFetchForm`
 * 的那几页（change / 两个 main）取的就是 `form` 的字面量 —— `createHook(e => e)` 的默认钩子
 * （`list.js:468` + `common/utils/hook.js:1-3`）是恒等函数，不是「不传」。
 *
 * ## 二、五页之间**不一样**的地方（本文件最容易照抄错的地方）
 *
 * | # | 差异 | 在哪几页 |
 * | --- | --- | --- |
 * | 1 | **`getDataListURL` 可能是个幌子**：写了 `customLoad` 的页**根本不走它** | `agreement-change`、两个 `others` |
 * | 2 | 一个页面**两个端点**，靠页面上的「月度/年度」单选切换 | `agreement-change` |
 * | 3 | **空值照发**（`year=`/`month=`/`status=` 这些空字符串真的在 URL 上，不是被丢掉） | 五页都如此，**只有** #4 那一项例外 |
 * | 4 | **`null` 会被整个丢掉**（不是发成空串） | `month-agreement/others` 的 `organizationCode` |
 * | 5 | 多选的 `status` / `signatory` 由 `convertFetchForm` **join(',')** 成标量 | 两个 `others` |
 * | 6 | `signatory` 初值是**当前登录用户的 id**（页面替用户筛好「我审核的」） | 两个 `others` |
 * | 7 | **没有任何日期区间** —— 全是单选的年 / 月控件（与学习管理域几乎所有页相反） | 五页全是 |
 *
 * ### 1 + 2. `agreement-change` 的 `getDataListURL` 是死的
 *
 * 那一页写的是 `getDataListURL: '/performance/protocol/kpimonthprotocol/page'`，
 * 但同一个 options 对象里也写了 `customLoad`，而 `list.js:485-494` 是
 * `if (customLoad) { result = await customLoad(params) } else { result = await _http.get(getDataListURL, …) }`
 * —— **二选一，`customLoad` 赢**。它实际打的是：
 *
 * ```js
 * const url = agreementType.current === 1
 *   ? '/performance/protocol/kpimonthprotocol/othersPage'
 *   : '/performance/protocol/kpiyearprotocol/othersPage'
 * ```
 *
 * （`agreement-change/main/list.vue:101-108`）。所以那一页**从来不会**打 `/page`，
 * 而且它的**两个**端点都是 `othersPage`（这一页看的是"待我变更的协议"，不是"我的协议"）。
 *
 * 页面上那组单选是 `{ label: '月度', value: 1 } / { label: '年度', value: 2 }`（`:77-83`），
 * 切换时 `handleAgreementTypeChange` 做的是 `initialize()` + `actionFetch()`（`:141-144`）。
 *
 * ### 4. `null` 与 `''` 在 URL 上不是一回事（**实测过**）
 *
 * `month-agreement/others` 的 `form.organizationCode` 初值是 **`null`**（不是 `''`），
 * 且那一项是 `is-disabled` 的（用户改不了，永远是 `null`）。
 * platform 实例的 GET 参数在拦截器里过 `qs.stringify(merged, { allowDots: true, skipNulls: true })`
 * （`platform.js`，`src/http/client.ts` 逐字复刻）—— `skipNulls` 会把 **`null` 和 `undefined`
 * 整个丢掉**，而 `''` 会发成 `key=`。
 *
 * 用仓库里的 qs 与 Portal 用的 axios 1.4.0 各验了一遍（两边结论一致）：
 *
 * ```
 * qs.stringify({ a: undefined, b: null, c: '', d: 0 }, { allowDots: true, skipNulls: true })
 *   → 'c=&d=0'                       // a / b 的键根本不在
 * buildURL('/x', { organizationCode: null, month: '' })
 *   → '/x?month='                    // axios 那条同样把 null 丢掉
 * ```
 *
 * ⇒ `month-agreement/others` 无筛选时的 URL 上**没有** `organizationCode` 这一项。
 * 本文件把它的默认值写成 `undefined`（不是 `''`），就是为了在 qs 那一层落成"键不存在"。
 *
 * ### 5 + 6. `signatory` 的两个坑叠在一起
 *
 * 两个 `others` 页的 `customLoad` 里 `signatory: data.signatory.join(',')`、`status: data.status.join(',')`
 * —— 表单里它们是**多选**（`portal-hxr-select-signatory multiple`、`portal-hxr-dict-select multiple`），
 * 到 URL 上却是一个逗号串。**别把它们当数组传给 axios**：qs 会序列化成 `signatory[0]=…`，
 * 与浏览器不逐字一致（浏览器那条是 `signatory=1,2,3`）。
 *
 * 更要紧的是 `signatory` 的**初值**：
 *
 * ```js
 * signatory: [userStore.state.id]   // 两个 others 页的 form 初值
 * ```
 *
 * 页面替用户把「审核人 = 我」填好了，所以**浏览器发出的第一个请求里 `signatory` 就是当前用户的 id**。
 * 无头这边**不知道调用者是谁**（这是 SDK 的设计前提：凭据只在 `createPortalRequest` 创建时绑定，
 * 能力不读它），所以本能力的 `signatory` **默认是空串 `''`** —— 键在、值是空，
 * 语义从「只看我审核的」变成「不限审核人」。这是**与页面刻意不同的一处**，
 * 不是漏写。要复刻页面的行为，先调 `base-user-info` 拿自己的 `userId` 再
 * `signatory: String(userId)`。
 *
 * ### 7. 这五页没有日期区间
 *
 * 学习管理域的页面几乎都是「`startTime`/`endTime` 两个标量 + 结束日 +1 天」。
 * 这五页**一个都没有**：`agreement-change`/`year-agreement/others` 用的是
 * `a-date-picker picker="year" value-format="YYYY"`（单个年份，发 `'2026'`），
 * `month-agreement/others` 用的是 `picker="month"` 的 **`yearMonth`**，
 * 再由 `convertFetchForm` 拆成 `year` + `month` 两个字段。
 *
 * 所以本文件**不提供** `buildXTimeRange()` 那类 helper —— 没有区间可拼。
 * 取而代之的是 `splitPerfYearMonth('2026-09') → { year: '2026', month: '09' }`：
 * 页面 `format('YYYY')` / `format('MM')` 的结果就是这两位，`month` 是**补零的字符串**。
 *
 * ⚠️ `agreement-change` 的 `month` 是另一回事：它来自 `common-select-dropdown`，
 * 值域由 `monthOptionsMaker()` 生成，是**数字 1~12**（`:165-171`），
 * 所以那一页的 `month` 发出去是 `month=3`，**不是** `month=03`。两页别混。
 *
 * ## 三、页面挂载时会拉全量候选，本 SDK **不照抄**（D6 / H35）
 *
 * 两个 `others` 页的筛选区里各挂了一个组件，一挂载就往回打大请求：
 *
 * | 组件 | 页面发的 | 量级 |
 * | --- | --- | --- |
 * | `portal-hxr-select-signatory`（审核人下拉） | `loopFetch` → `GET /performance/protocol/kpimonthprotocol/signatoryByPage?pageNo=N&pageSize=200`，`maxPages: 100` | 最多 2 万条；**注意打的是 month 端点，年度页也走它** |
 * | `portal-hxr-tree-select-role-org`（所辖年度） | `http.get('/org/organization/getRoleOrganizationTree')`，**无关键字、无分页** | `docs` 里实测 596,663 B（`src/capabilities/base-shell.ts:86`） |
 * | `portal-hxr-tree-select-role-org-new`（所辖月度） | `http.get('/org/organization/getRoleOrganizationTreeNew')` | 同量级（未单独实测） |
 *
 * 组件源码：`app/portal/components/portal/hxr/select/signatory/index.vue:40-69`、
 * `…/tree-select/role-org/index.vue:43-45`、`…/tree-select/role-org-new/index.vue:53`。
 *
 * 本能力**一个都不调**。`organizationCode` / `signatory` 照旧是"要请自己给 id"的参数
 * （人员 id 可以先问用户关键字，再走 `base-user-search` 拿）。
 * 这里**没有** `study-grade-search` 那样的候选入口可用：`signatoryByPage` **不收关键字**
 * （只收 `pageNo`/`pageSize`），本地过滤就意味着得先把整表拉下来 —— 那正是 D6 要避免的事。
 * 这条缺口记在文末的「账」里。
 *
 * ## 四、写操作没有做
 *
 * 五页都有写入口，**本轮只做读**。已经查清、将来要用的时候省一轮侦察：
 *
 * - `agreement-change`：行内「变更」→ `POST /performance/protocol/kpi{month,year}protocol/changeStatus`
 *   （`agreement-change/main/components/change.vue:75-77`，body 是 `{ protocolId, previousStatus, type, … }`）。
 * - `month-agreement/main`：`deleteURL: '/performance/protocol/kpimonthprotocol'`。
 *   ⚠️ 这两页**没设** `deleteIsBatch`（默认 `false`，`list.js:228`）⇒ 实际发的是
 *   `DELETE …/{id}`、**没有 body**，别当成批量删；
 *   行内「撤销」`POST …/kpimonthprotocol/revoke?id=`、「撤销自评」`POST …/revokeSelfScore?protocolId=`
 *   （`month-agreement/hooks/useActionButtons.js:150,158`）；创建/编辑/详情是三个路由页
 *   （`../common/create/new`、`../common/edit/{id}`、`../common/detail/{id}`）。
 * - `year-agreement/main`：`deleteURL: '/performance/protocol/kpiyearprotocol'`（同上，非批量）；
 *   「撤销」`POST …/kpiyearprotocol/cancel?id=`、「作废」`GET …/kpiyearprotocol/nullify?id=`
 *   （`year-agreement/hooks/useActionButtons.js:84,130`）。
 * - `month-agreement/others`：「导出考核结果」→ `GET /admin-api/performance/protocol/kpimonthprotocol/exportProtocol`
 *   （**原生 axios + blob**，绕开了 http 实例，头部来自 `generateHttpHeaders()`；`others/list.vue:191-205`）。
 *
 * 不做它们的理由与学习管理域、课程域那几页同一条：这些是**真实业务单据**
 * （协议、评分、状态流转），`revoke`/`nullify`/`changeStatus` 会改变别人的可见状态与考核结果，
 * 属于"要不要在测试环境里造/改真实数据"的判断，不是"多写一个接口"的成本。
 *
 * ## 五、账：哪些是实测，哪些是推断
 *
 * **实测（读源码原文，逐条给了出处）**：
 *
 * 1. 参数顺序规则本身（`list.js:473-483`）。
 * 2. 五页的 `form` 字面量与 `convertFetchForm` 返回值 —— `list.vue` 行号见各字段表上方。
 * 3. `customLoad` 优先于 `getDataListURL`（`list.js:485-494`）。
 * 4. `month-agreement/others` 的 `organizationCode` 初值是 `null` 且控件 `is-disabled`。
 * 5. `null`/`undefined` 在 `skipNulls` 下**整个键消失**、`''` 发成 `key=` ——
 *    用仓库里的 qs 与 Portal 用的 axios 1.4.0 各跑了一遍（**离线**，没打后端）。
 * 6. `agreement-change` 的月份值域 `1~12` 是数字（`monthOptionsMaker()`）。
 * 7. 三个"页面挂载时全量拉"的组件与它们打的接口（组件源码行号见 §三）。
 *
 * **推断（有依据，但**没有**在真实环境上验过 —— 本波既没有基准也没有冒烟）**：
 *
 * 1. **所有后端响应**：真实返回的字段名、条数、`total` 语义，一条都没测。
 * 2. `status` 到底收不收逗号串、`include` 在后端的语义、`month` 收几月还是补零 —— 没测。
 * 3. `portal-hxr-tree-select-role-org-new` 的响应体量：`getRoleOrganizationTree` 那个
 *    596,663 B 是从 `src/capabilities/base-shell.ts:86` 引的**旧实测**，不是本波测的；
 *    带 `New` 的那个接口**没有任何测量**。
 * 4. 五页的 `module-type = 13` 取自 `generated/page-catalog.json` 的推导结果，不是本波实测。
 * 5. 字典 `month_task_review_status` / `protocol_status` 的**取值域没查**，
 *    所以 `status` 一律是 `kind: 'text'` 透传，**没有编枚举**。
 *
 * **本波没做、留给第二波的**：
 *
 * 1. 逐字段基准回归（要派单方统一抓 `baseline/perf-agreement.browser.json`）与反证。
 * 2. 每页一份 `docs/pages/<页面>.md`（四件套）。
 * 3. **两处接线由派单方做**：`src/capabilities/index.ts` 注册本文件、`pnpm docs` 重建
 *    `generated/` 与 `src/catalog/aliases.derived.ts`。**不重建的话
 *    `test/aliases-derived.test.ts` 的「磁盘上的 aliases.derived.ts 与当前数据一致」会红**
 *    —— 那是生成物过期，不是本文件写错了（同类红在这一波里由多个并行子代理的文件共同造成）。
 *
 * ## 六、基准核对（`baseline/perf-agreement.browser.json`，2026-09-21 抓于测试环境）
 *
 * **五页的列表请求与本文从源码推出来的契约逐字段一致（含键顺序），一处修正都不需要。**
 * 四条最该被卡的预测全部被基准证实：
 *
 * | 预测 | 基准实测 |
 * | --- | --- |
 * | `organizationCode` 在「所辖月度」上**不在** URL 里、「所辖年度」上**是空串** | 基准 `[2]` 无该项、`[10]` 有 `organizationCode=&` ✓ |
 * | `month` 的键位置落在 `organizationCode` **之后** | 基准 `[2]`：`…&signatory=<redacted>&month=&pageNo=…` ✓ |
 * | 两个 `main` 页只有 `order/orderField/pageNo/pageSize` | 基准 `[1]`/`[8]` 逐字 ✓ |
 * | `agreement-change` **从没打过** `/page` | 基准 `[0]` 打的是 `kpimonthprotocol/othersPage` ✓（全 15 条里没有一条 `/page`） |
 *
 * 基准同时证实了两件"页面自己发、本 SDK 不照抄"的事：`signatoryByPage`（`[4][5][6]`
 * **与 `[12][13][14]`** —— **年度页也在翻月度那个端点**，第一波从源码得出的"疑似前端漏改"
 * 得到印证）、以及两棵组织树的全量拉取（`[3]` `getRoleOrganizationTreeNew`、
 * `[11]` `getRoleOrganizationTree`，都只有 `_t`，**无关键字无分页**）。
 *
 * ### ⚠️ 唯一的偏离：`signatory` 的默认值（刻意）
 *
 * 基准 `[2]`/`[10]` 里的 `signatory` 是**当前登录用户的 id**（已脱敏）。
 * 本能力的默认值是**空串**——无头不知道调用者是谁，这是**刻意偏离**，不是漏写。
 * 要复刻页面：先 `base-user-info` 拿 `userId`，再 `signatory: String(userId)`。
 * 测试里对这一点有专门的断言（不是被归一化掩盖过去的那种）。
 *
 * ### ⚠️ 基准里有一条**不属于本页**的写请求
 *
 * 基准 `[9]` 是 `POST /admin-api/homePage/save`（工作台卡片布局的自动保存，body 里是
 * `hr/learning/*`、`finance/*` 那些 widget 的坐标），挂在「所辖年度」名下 ——
 * 那是**抓基准时用"只改 hash"导航**留下的：SPA 同文档导航不卸载首页，首页的自动保存
 * 被同一次捕获收了进来。它**不是**协议页的读路径，本 SDK **不做**（也不该做）。
 *
 * ### ⚠️ 本地源码落后于部署版本的已知风险（本页未受影响）
 *
 * 已确认本地 `Projects_Js` 检出**落后于测试环境部署的版本**（例：薪酬结构/标准两页线上用
 * `treePage`，本地源码里没有）。所以规则是：**源码与基准冲突时一律以基准为准**。
 * 本文件的五页**没有这种冲突**（上表已逐条核对）；若将来基准变了，改的是契约，不是基准。
 */

// ---------------------------------------------------------------------------
// 页面路径（**必须与 `generated/page-catalog.json` 的 `menuPath` 逐字相同**）
// ---------------------------------------------------------------------------

export const PERF_AGREEMENT_CHANGE_PAGE_PATH = '/dashboard/agreement-change/main/list'
export const PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH = '/dashboard/month-agreement/main/list'
export const PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH = '/dashboard/month-agreement/others/list'
export const PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH = '/dashboard/year-agreement/main/list'
export const PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH = '/dashboard/year-agreement/others/list'

const VIEWS = 'app/portal/views/dashboard/hr'

/** 路由文件，写进文档与排障时用得上 */
export const PERF_AGREEMENT_ROUTE_FILES = {
  change: `${VIEWS}/agreement-change/main/list.vue`,
  monthMain: `${VIEWS}/month-agreement/main/list.vue`,
  monthOthers: `${VIEWS}/month-agreement/others/list.vue`,
  yearMain: `${VIEWS}/year-agreement/main/list.vue`,
  yearOthers: `${VIEWS}/year-agreement/others/list.vue`,
} as const

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

/** 个人月度协议列表（`month-agreement/main` 的 `getDataListURL`） */
export const PERF_MONTH_PROTOCOL_LIST_PATH = '/performance/protocol/kpimonthprotocol/page'
/** 所辖月度协议列表（`month-agreement/others` 与 `agreement-change` 的月度支） */
export const PERF_MONTH_PROTOCOL_OTHERS_PATH = '/performance/protocol/kpimonthprotocol/othersPage'
/** 个人年度协议列表（`year-agreement/main` 的 `getDataListURL`） */
export const PERF_YEAR_PROTOCOL_LIST_PATH = '/performance/protocol/kpiyearprotocol/page'
/** 所辖年度协议列表（`year-agreement/others` 与 `agreement-change` 的年度支） */
export const PERF_YEAR_PROTOCOL_OTHERS_PATH = '/performance/protocol/kpiyearprotocol/othersPage'

/**
 * 「状态变更」页那一组单选决定打哪个端点。**这不是 URL 上的字段**，
 * 所以它**不进** `params`（与 `study-statistics.ts` 的 `kind` 同一个处理），
 * 只作为方法的首个入参。
 */
export const PERF_AGREEMENT_CHANGE_PATHS = {
  month: PERF_MONTH_PROTOCOL_OTHERS_PATH,
  year: PERF_YEAR_PROTOCOL_OTHERS_PATH,
} as const

export type PerfAgreementChangeKind = keyof typeof PERF_AGREEMENT_CHANGE_PATHS

/**
 * 审核人候选接口。**本 SDK 不提供**——它不收关键字，只能整页翻（见文件头 §三）。
 * 常量留在这里是为了让"页面发了什么"这件事在排障时可查。
 */
export const PERF_MONTH_PROTOCOL_SIGNATORY_PATH =
  '/performance/protocol/kpimonthprotocol/signatoryByPage'

/**
 * 「个人年度」页挂载时读的**时间节点配置**（`year-agreement/main/list.vue:71-74`
 * 的 `useAsyncState(() => http.get('/sys/dict/data/getYearProtocolConfig'), '')`，
 * 渲染成页面上那一行 `{{ state }}`）。基准 `[7]` 实测它真的在那一页的请求里，且**只有 `_t`**。
 *
 * ⚠️ 它**只在这一页**有：`year-agreement/others` 与两页月度都没有这个调用（源码与基准一致）。
 * ⚠️ 它的**响应体没有测到**（基准只抓请求、不抓响应），所以返回值类型是 `Record<string, unknown>`
 * ——不是"已归一化"，调用方自己看字段。
 */
export const PERF_YEAR_PROTOCOL_CONFIG_PATH = '/sys/dict/data/getYearProtocolConfig'

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
const DEFAULT_PAGE_SIZE = 20

export type PageResult<T> = { list: T[]; total: number }

/**
 * 协议列表行。五页共用一套行结构（后端同一族接口），只是页面显示的列不同。
 *
 * 字段名取自五份 `list.vue` 的 `columns`。注意**创建人**一列的 `dataIndex` 三页三个名：
 * 月度两页是 `promoterName`、所辖年度是 `creatorName`、个人年度那一页干脆没有这一列。
 * 审核人一列五页统一叫 `signatoryName`（个人年度/月度那两页的列标题写作「签订人」）。
 */
export type PerfProtocolRow = {
  id: string
  /** 协议名称 */
  name?: string
  /** 年份（四位字符串） */
  year?: string
  /** 月份。年度协议没有这一项；月度协议后端给的是数字还是字符串**未实测** */
  month?: number | string
  /** 创建时间（个人月度 / 个人年度那两页有这一列） */
  createTime?: string
  /** 创建人（月度两页） */
  promoterName?: string
  /** 创建人（所辖年度） */
  creatorName?: string
  /** 审核人 / 签订人 */
  signatoryName?: string
  /** 协议状态。字典值：月度用 `month_task_review_status`、年度用 `protocol_status`（仅影响页面渲染） */
  status?: string | number
  /** 页面按这一项决定行内按钮（`record.actionButtons`），无头可以直接忽略 */
  actionButtons?: string[]
  [key: string]: unknown
}

/** 两个 `main` 页的 `form` 是**空对象**，所以列表接口只有分页两项 */
export type PerfAgreementPagedQuery = {
  pageNo?: number
  pageSize?: number
}

/** 「状态变更」页的查询条件（顺序 = `form` 字面量的顺序） */
export type PerfAgreementChangeQuery = {
  /** 年份，四位字符串（页面是 `picker="year"` + `value-format="YYYY"`） */
  year?: string
  /** 月份，**数字 1~12**（页面是下拉，不是日期控件 —— 别传 `'03'`） */
  month?: number
  /** 协议状态。字典类型随月度/年度切换（`month_task_review_status` / `protocol_status`），取值域未实测 */
  status?: string | number
  /** 创建人（页面是文本输入，模糊匹配） */
  creator?: string
  /** 页面表单初值固定为 `1`（包含自己），**没有对应控件**；默认照抄页面 */
  include?: number
  pageNo?: number
  pageSize?: number
}

/** 「所辖月度」页的查询条件 */
export type PerfMonthAgreementOthersQuery = {
  /** 协议名称（模糊匹配） */
  name?: string
  /** 年份，四位字符串。用 `splitPerfYearMonth()` 从年月拆出来 */
  year?: string
  /**
   * 协议状态。页面是**多选**，`convertFetchForm` 会 `join(',')`；
   * 本能力接受数组或已经是逗号串的标量，两种都行。字典值未实测。
   */
  status?: string | number | Array<string | number>
  /** 创建人（模糊匹配） */
  creator?: string
  /**
   * 审核人 id（多人用逗号连）。⚠️ 页面初值是**当前登录用户的 id**，
   * 本能力默认空串 = 不限审核人；要复刻页面先调 `base-user-info` 拿 `userId`
   */
  signatory?: string | number | Array<string | number>
  /**
   * 组织 id。⚠️ 页面这一项是**禁用**的且初值是 `null` —— 浏览器**从不发**它
   * （`skipNulls` 把 null 丢掉），本能力默认 `undefined` 与之等价
   */
  organizationCode?: string
  /** 月份，**两位补零字符串**如 `'09'`（由年月拆出来，与状态变更页的数字不同） */
  month?: string
  pageNo?: number
  pageSize?: number
}

/** 「所辖年度」页的查询条件 */
export type PerfYearAgreementOthersQuery = {
  /** 协议名称（模糊匹配） */
  name?: string
  /** 年份，四位字符串 */
  year?: string
  /** 协议状态。页面是**单选**（不像月度页是多选），所以只收标量 */
  status?: string | number
  /** 创建人（模糊匹配） */
  creator?: string
  /** 审核人 id（多人用逗号连）。默认空串 = 不限审核人，见 `PerfMonthAgreementOthersQuery.signatory` */
  signatory?: string | number | Array<string | number>
  /** 组织 id。这一页的树选择器**没禁用**，初值是 `''` ⇒ 键在、值为空 */
  organizationCode?: string
  pageNo?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 参数装配
// ---------------------------------------------------------------------------

/**
 * 五页共用的开头两项。页面**没有** `order` / `orderField` 这两个控件，
 * 是列表模块自己加的（`list.js:474-475`、初值见 `:295-296`），所以钉死成空串、不开放。
 */
const BASE_ORDER: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
]

/** 「状态变更」页 —— 逐字抄 `agreement-change/main/list.vue:93-100` 的 `form` 字面量 */
const CHANGE_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'year', defaultValue: '' },
  { name: 'month', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'creator', defaultValue: '' },
  { name: 'include', defaultValue: 1 }, // 页面初值 1 = 包含自己，无控件
]

/**
 * 「所辖月度」页 —— 逐字抄 `convertFetchForm` 的**返回对象**（`others/list.vue:178-189`）。
 *
 * 键序不是抄来的，是 JS 对象展开的规则推出来的：`form = omit(data, ['yearMonth'])`
 * 给的是 `name, year, status, creator, signatory, organizationCode`（`yearMonth` 被删掉），
 * 然后 `{ ...form, year, month, signatory, status }` —— **`year`/`status`/`signatory`
 * 是覆盖赋值，位置留在第一次出现的地方**，只有 `month` 是新的、追加到最后。
 * ⇒ 最终顺序 `…, organizationCode, month`（`month` 在 `organizationCode` **之后**，
 * 这点与"按表单控件顺序"的直觉相反）。
 */
const MONTH_OTHERS_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'name', defaultValue: '' },
  { name: 'year', defaultValue: '' },
  { name: 'status', defaultValue: '' }, // [].join(',') === ''
  { name: 'creator', defaultValue: '' },
  // ⚠️ 页面初值是 [当前用户 id].join(',')。无头不知道该是谁，默认空串 = 不限审核人
  { name: 'signatory', defaultValue: '' },
  // ⚠️ 页面初值是 null，且控件禁用 ⇒ 键**不在** URL 上（skipNulls）。undefined 与之等价
  { name: 'organizationCode', defaultValue: undefined },
  { name: 'month', defaultValue: '' },
]

/** 「所辖年度」页 —— `{ ...data, signatory: data.signatory.join(',') }`，键序原样保留 */
const YEAR_OTHERS_FIELDS: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'name', defaultValue: '' },
  { name: 'year', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'creator', defaultValue: '' },
  { name: 'signatory', defaultValue: '' }, // 同月度页：页面初值是当前用户 id
  { name: 'organizationCode', defaultValue: '' }, // 这一页没禁用，初值就是 ''
]

const PAGINATION: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: DEFAULT_PAGE_SIZE },
]

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildParams (
  order: ReadonlyArray<{ name: string; defaultValue: unknown }>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const item of order) {
    const value = query[item.name]
    // 默认值 `undefined` 是**有意**的：qs 的 skipNulls 会把这个键整个丢掉，
    // 而这正是页面里 `null` 初值在 URL 上的样子（见文件头 §二·4）
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * 页面在 `convertFetchForm` 里对多选字段做的事：`array.join(',')`。
 *
 * 单独抽出来是因为**它必须发生在序列化之前**：qs 对数组的序列化是
 * `signatory[0]=1&signatory[1]=2`，与浏览器的 `signatory=1,2` 不逐字一致。
 */
function joinCsv (value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(',')
  if (value === undefined || value === null) return ''
  return String(value)
}

/**
 * 把 `month-agreement/others` 页那个「年月」控件的值拆成接口收的两个字段。
 *
 * 页面做的是 `yearMonth.format('YYYY')` / `format('MM')` —— 所以 `month` 是
 * **两位补零的字符串**（`'09'`），**不是**数字，也**不是** `agreement-change` 页那种 1~12 的数字。
 *
 * ⚠️ 这里没有"结束日 +1 天"那种区间语义：这两页取的是**单个年月**，
 * 区间两端由后端按整月理解。别照抄学习管理域那套 `buildXxxTimeRange`。
 */
export function splitPerfYearMonth (yearMonth: string): { year: string; month: string } {
  const match = /^(\d{4})-(\d{2})/.exec(String(yearMonth).trim())
  const year = match?.[1]
  const monthText = match?.[2]
  if (year === undefined || monthText === undefined) {
    throw new Error(`年月应为 YYYY-MM（或同前缀的字符串），收到的是 ${JSON.stringify(yearMonth)}`)
  }
  const month = Number(monthText)
  if (month < 1 || month > 12) {
    throw new Error(`月份超出 1~12：${JSON.stringify(yearMonth)}`)
  }
  return { year, month: monthText }
}

// ---------------------------------------------------------------------------
// 参数规格
// ---------------------------------------------------------------------------

const PAGE_PARAMS: ParamSpec[] = [
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

/** `agreement-change` 页那 12 个选项的**值域是从源码读出来的**（`monthOptionsMaker()`，:165-171） */
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  label: `${index + 1}月`,
  value: index + 1,
}))

const STATUS_PARAM_CHANGE: ParamSpec = {
  name: 'status',
  kind: 'text',
  required: false,
  description:
    '协议状态。字典类型随页面上的月度/年度单选切换（月度 `month_task_review_status` / 年度 `protocol_status`），' +
    '**取值域未实测**，本能力只透传，不编枚举',
}

const STATUS_PARAM_OTHERS_MULTI: ParamSpec = {
  name: 'status',
  kind: 'text',
  required: false,
  description:
    '协议状态，可多选（数组或 `"1,2"` 逗号串都行）。页面是多选下拉、`convertFetchForm` 会 join。' +
    '字典类型 `month_task_review_status`，**取值域未实测**',
}

const SIGNATORY_PARAM: ParamSpec = {
  name: 'signatory',
  kind: 'search',
  required: false,
  description:
    '审核人 id（多人用逗号连）。⚠️ **页面初值是当前登录用户的 id**（页面替用户筛好「我审核的」）；' +
    '本能力默认空串 = **不限审核人**。要复刻页面先调 `base-user-info` 拿 `userId`。' +
    '⚠️ 页面挂载时会整表翻 `/performance/protocol/kpimonthprotocol/signatoryByPage`（最多 2 万条），' +
    '本 SDK **不照抄**（D6 / H35），所以这里没有候选入口 —— 人员 id 请先问关键字再走 `base-user-search`',
}

const ORGANIZATION_CODE_PARAM_MONTH: ParamSpec = {
  name: 'organizationCode',
  kind: 'text',
  required: false,
  description:
    '组织 id（树选择器）。⚠️ 这一页的控件是**禁用**的、初值 `null` —— **浏览器从不发这一项**；' +
    '本能力默认 `undefined`，同样不发。要按组织筛请自己给 id（页面那个组织树是全量拉的，本 SDK 不照抄）',
}

const ORGANIZATION_CODE_PARAM_YEAR: ParamSpec = {
  name: 'organizationCode',
  kind: 'text',
  required: false,
  description:
    '组织 id（树选择器，这一页**没禁用**，初值 `""`）。⚠️ 树数据是页面挂载时全量拉的' +
    '（`/org/organization/getRoleOrganizationTree`，无关键字、无分页），本 SDK 不照抄 —— 要筛请自己给 id',
}

const CHANGE_PARAMS: ParamSpec[] = [
  {
    name: 'year',
    kind: 'text',
    required: false,
    description: '年份，四位字符串如 `2026`（页面是 `picker="year"` + `value-format="YYYY"`）',
  },
  {
    name: 'month',
    kind: 'enum',
    required: false,
    options: MONTH_OPTIONS,
    description:
      '月份，**数字 1~12**（页面是下拉，取值域读自 `monthOptionsMaker()`）。' +
      '⚠️ 不是 `"03"`、也不是年月控件 —— 与「所辖月度」页的 month 不是一回事',
  },
  STATUS_PARAM_CHANGE,
  { name: 'creator', kind: 'text', required: false, description: '创建人（页面是文本输入，模糊匹配）' },
  {
    name: 'include',
    kind: 'number',
    required: false,
    description: '是否包含自己：页面表单初值固定 `1`，**没有对应控件**。无头照抄默认值即可',
  },
  ...PAGE_PARAMS,
]

const MONTH_OTHERS_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '协议名称（模糊匹配）' },
  {
    name: 'year',
    kind: 'text',
    required: false,
    description: '年份，四位字符串。用 `splitPerfYearMonth()` 从年月拆出来（页面没有单独的年份控件）',
  },
  STATUS_PARAM_OTHERS_MULTI,
  { name: 'creator', kind: 'text', required: false, description: '创建人（模糊匹配）' },
  SIGNATORY_PARAM,
  ORGANIZATION_CODE_PARAM_MONTH,
  {
    name: 'month',
    kind: 'text',
    required: false,
    description:
      '月份，**两位补零字符串**如 `09`。用 `splitPerfYearMonth()` 从年月拆出来。' +
      '⚠️ 与「状态变更」页那个 1~12 的数字 month 不是一回事',
  },
  ...PAGE_PARAMS,
]

const YEAR_OTHERS_PARAMS: ParamSpec[] = [
  { name: 'name', kind: 'text', required: false, description: '协议名称（模糊匹配）' },
  {
    name: 'year',
    kind: 'text',
    required: false,
    description: '年份，四位字符串如 `2026`（页面是 `picker="year"` + `value-format="YYYY"`）',
  },
  {
    name: 'status',
    kind: 'text',
    required: false,
    description:
      '协议状态，**单选**（这一页的下拉没有 `multiple`，与月度页相反）⇒ 只收标量。' +
      '字典类型 `protocol_status`，**取值域未实测**',
  },
  { name: 'creator', kind: 'text', required: false, description: '创建人（模糊匹配）' },
  SIGNATORY_PARAM,
  ORGANIZATION_CODE_PARAM_YEAR,
  ...PAGE_PARAMS,
]

// ---------------------------------------------------------------------------
// 能力定义
//
// ⚠️ `tools/generate/derive-aliases.mjs` 的正则要求 `id` / `title` / `pagePath`
// 三行**紧挨着**（中间只允许注释行与空行）。别在这三行之间插别的东西。
// ---------------------------------------------------------------------------

export const perfAgreementCapabilities: CapabilityDefinition[] = [
  {
    id: 'perf-agreement-change-list',
    title: '查询协议状态变更列表（月度 / 年度两个端点）',
    pagePath: PERF_AGREEMENT_CHANGE_PAGE_PATH,
    permission: '/dashboard/agreement-change/main',
    write: false,
    params: CHANGE_PARAMS,
  },
  {
    id: 'perf-month-agreement-list',
    title: '查询个人月度双赢协议列表',
    pagePath: PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH,
    permission: '/dashboard/month-agreement/main',
    write: false,
    params: PAGE_PARAMS,
  },
  {
    id: 'perf-month-agreement-others-list',
    title: '查询所辖月度双赢协议列表',
    pagePath: PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH,
    permission: '/dashboard/other-task/month',
    write: false,
    params: MONTH_OTHERS_PARAMS,
  },
  {
    id: 'perf-year-agreement-list',
    title: '查询个人年度双赢协议列表',
    pagePath: PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
    permission: '/dashboard/year-agreement/main',
    write: false,
    params: PAGE_PARAMS,
  },
  {
    id: 'perf-year-agreement-others-list',
    title: '查询所辖年度双赢协议列表',
    pagePath: PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH,
    permission: '/dashboard/other-task/year',
    write: false,
    params: YEAR_OTHERS_PARAMS,
  },
  // ⚠️ 这一条与 `perf-year-agreement-list` **共用同一个 pagePath**，这是**有意**的：
  //    它读数不是列表数据，而是那一页挂载时另发的「时间节点配置」。仓库里已有先例
  //    （`generalApprovalCapabilities` 与 `leaveApplicationCapabilities` 共用
  //    `/dashboard/flow/form/edit`）。把两者合成一条会把「列表筛选参数」和「零参数配置读」
  //    混成一个契约，AI 反而更容易填错。
  {
    id: 'perf-year-protocol-config-get',
    title: '查询年度协议的时间节点配置（年度协议页顶部那一行）',
    pagePath: PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
    permission: '/dashboard/year-agreement/main',
    write: false,
    params: [],
  },
]

// ---------------------------------------------------------------------------
// 能力实现
// ---------------------------------------------------------------------------

/**
 * 能力实现。五个 `request` 由 SDK 门面注入，已经带好各自的页面上下文
 * （`module-type` 走 `/dashboard/…` 的推导结果 = 13 绩效管理；http 实例五页都是默认的 `platform`）。
 *
 * 五页**每页一个** `PortalRequest`，不是共用一个 —— 这样 `module-type` 与实例都按
 * 各自的页面解析（即使现在它们推出来一样）。
 */
export function createPerfAgreementCapability (
  /** 「状态变更」页 */
  requestChange: PortalRequest,
  /** 「个人月度」页 */
  requestMonthMain: PortalRequest,
  /** 「所辖月度」页 */
  requestMonthOthers: PortalRequest,
  /** 「个人年度」页 */
  requestYearMain: PortalRequest,
  /** 「所辖年度」页 */
  requestYearOthers: PortalRequest,
) {
  return {
    /**
     * 分页查询**协议状态变更**列表。只读。
     *
     * 页面上的「月度 / 年度」单选决定打哪个端点，**它是端点选择器、不是 URL 上的字段**
     * （所以不在 `params` 里）。默认 `'month'`，与页面初始状态一致
     * （`agreementType.current` 初值 1 = 月度）。
     *
     * ⚠️ 两个端点都收同一套表单字段：**年度那一支也会带上 `month`**
     * （`form` 里一直有这个键，页面**没有** `convertFetchForm` 去删它）。
     * ⚠️ 至于切换时那一项会不会被清空成 `''`：`month` 的 `a-form-item` 带 `v-if`，
     * 控件卸载后 antd 的 `resetFields()` **不一定**会重置它 —— **这一点没实测**，
     * 本能力只保证"键一定在"。
     * 这是页面的真实行为，不是本能力的疏漏。
     */
    async listAgreementChange (
      kind: PerfAgreementChangeKind = 'month',
      query: PerfAgreementChangeQuery = {},
    ): Promise<PageResult<PerfProtocolRow>> {
      // `async` 是**刻意**的：参数错误要走 Promise.reject，不是同步抛
      // ——与其它能力的 list 一致，调用方 `await` 时才能接住
      if (!Object.prototype.hasOwnProperty.call(PERF_AGREEMENT_CHANGE_PATHS, kind)) {
        throw new Error(`kind 只能是 month / year，收到的是 ${JSON.stringify(kind)}`)
      }
      return await requestChange<PageResult<PerfProtocolRow>>({
        url: PERF_AGREEMENT_CHANGE_PATHS[kind],
        method: 'get',
        params: buildParams([...BASE_ORDER, ...CHANGE_FIELDS, ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /**
     * 分页查询**个人月度**双赢协议。只读。
     *
     * 这一页的表单是**空的**（`form: {}`），所以列表接口除分页外没有任何筛选参数 ——
     * URL 上就是 `order=&orderField=&pageNo=…&pageSize=…`。
     * 要按条件筛请用「所辖月度」页那条。
     */
    listMonthAgreements (
      query: PerfAgreementPagedQuery = {},
    ): Promise<PageResult<PerfProtocolRow>> {
      return requestMonthMain<PageResult<PerfProtocolRow>>({
        url: PERF_MONTH_PROTOCOL_LIST_PATH,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /**
     * 分页查询**所辖月度**双赢协议。只读。
     *
     * ⚠️ 三处与「个人月度」不同：`organizationCode` 默认**不发**（页面初值 `null`）、
     * `signatory` 默认**空串而不是当前用户 id**、`status`/`signatory` 是逗号串（多选）。
     * 逐条见 `PerfMonthAgreementOthersQuery` 与文件头 §二。
     */
    listMonthAgreementsOthers (
      query: PerfMonthAgreementOthersQuery = {},
    ): Promise<PageResult<PerfProtocolRow>> {
      const source = query as Record<string, unknown>
      return requestMonthOthers<PageResult<PerfProtocolRow>>({
        url: PERF_MONTH_PROTOCOL_OTHERS_PATH,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...MONTH_OTHERS_FIELDS, ...PAGINATION], {
          ...source,
          // 页面的 `join(',')` 发生在序列化之前，必须在这里落定（见 joinCsv）
          status: joinCsv(source.status),
          signatory: joinCsv(source.signatory),
        }),
      })
    },

    /** 分页查询**个人年度**双赢协议。只读。表单同样是空的，只有分页参数 */
    listYearAgreements (
      query: PerfAgreementPagedQuery = {},
    ): Promise<PageResult<PerfProtocolRow>> {
      return requestYearMain<PageResult<PerfProtocolRow>>({
        url: PERF_YEAR_PROTOCOL_LIST_PATH,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...PAGINATION], query as Record<string, unknown>),
      })
    },

    /**
     * 分页查询**所辖年度**双赢协议。只读。
     *
     * 与「所辖月度」的差别：没有 `month`；`status` 是**单选**（不是多选，所以页面不 join 它）；
     * `organizationCode` 的控件**没禁用**、初值 `''` ⇒ 键在、值为空。
     */
    listYearAgreementsOthers (
      query: PerfYearAgreementOthersQuery = {},
    ): Promise<PageResult<PerfProtocolRow>> {
      const source = query as Record<string, unknown>
      return requestYearOthers<PageResult<PerfProtocolRow>>({
        url: PERF_YEAR_PROTOCOL_OTHERS_PATH,
        method: 'get',
        params: buildParams([...BASE_ORDER, ...YEAR_OTHERS_FIELDS, ...PAGINATION], {
          ...source,
          signatory: joinCsv(source.signatory),
        }),
      })
    },

    /**
     * 读「个人年度」页顶部那一行的**时间节点配置**（页面挂载时自己发的第二个请求）。只读。
     *
     * **零参数**：页面的调用是 `http.get('/sys/dict/data/getYearProtocolConfig')`，
     * 基准 `[7]` 实测 URL 上只有 `_t`。所以这里既不收 query、也不发分页。
     *
     * 后端 SysDictDataController 返回 CommonResult<String>；SDK 解包后为配置文本。
     * 保留原字符串，不把它当作固定字段对象（本轮按后端源码核对，未重跑线上响应）。
     */
    getYearProtocolConfig (): Promise<string> {
      return requestYearMain<string>({
        url: PERF_YEAR_PROTOCOL_CONFIG_PATH,
        method: 'get',
      })
    },
  }
}

export type PerfAgreementCapability = ReturnType<typeof createPerfAgreementCapability>
