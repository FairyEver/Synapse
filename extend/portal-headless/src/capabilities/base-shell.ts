/**
 * **应用外壳（shell）** 的第二批基础能力：用户信息 / 人员候选 / 待办角标 / 可见菜单 / 工作台卡片。
 *
 * 第一批（`base-dept-dict-permission.ts` 的部门·字典·权限清单，`base-upload.ts` 的上传）
 * 已经落地，本文件是**第二批**。选它们的标准与理由写在下面「为什么是这五个」一节。
 *
 * 与第一批同一类：它们**都不是页面**。Portal 的 `runLegacyFullInitTasks`
 * （`app/portal/utils/router/session.js:35-59`）在**任何 dashboard 页面刷新**时都会打这一族，
 * 与用户落在哪一页无关。用户的原话是：
 *
 * > 「整个 Portal 刷新之后它会调好多接口，那些接口都应该优先实现出来。
 * >   公共的字典、人员组织……它在 Portal 中是一个组件，那么它在这个 SDK 中就应该是一个基础能力。」
 *
 * | 能力 | 接口 | 实测（2026-09-20，测试环境，租户 1） |
 * | --- | --- | --- |
 * | `base-user-info` | GET `/admin-api/sys/user/info` | 897 B / 316 ms / 单对象 33 字段 |
 * | `base-user-search` | GET `/admin-api/system/user/simple-page` | 无关键字 total 4225；`pageSize=-1` → **577,845 B** |
 * | `base-todo-list` | GET `/admin-api/bpm/task/list-by-category` | 待办 25 / 已办 415 / 全部 562；`pageSize=500` → **314,395 B** |
 * | `base-todo-counts` | GET `…/kpimessageremind/getUnreadcount` + `/finance/expense-review/pending-count` + 上面那条 | 53 B / 44 B |
 * | `base-menu-nav` | GET `/admin-api/sys/menu/nav?project=` | `project=2` → 57 节点 / 14,851 B / 187 ms |
 * | `base-home-widgets` | GET `/admin-api/homePage/get` | 9,019 B / 203 ms / 61 张卡片 |
 *
 * 四件套的其它三件在 `docs/base/` 下同名文档；真实环境只读冒烟 → `smoke/read-base-shell.mjs`；
 * 回归测试 → `test/base-shell.test.ts`。**接线（注册进 `src/capabilities/index.ts` 与两个门面）
 * 由派单方统一做**，本文件不碰任何索引文件。
 *
 * ---------------------------------------------------------------------------------------
 * 一、为什么是这五个（挑选标准与「没选谁」）
 * ---------------------------------------------------------------------------------------
 *
 * 依据是 `docs/base-capabilities.md` 的「首屏 21 个后端接口，SDK 已有 6 / 部分 3 / 完全没有 12」，
 * 但**那份调查的结论逐条复核过**（它自己被推翻过一次，见它顶部的勘误）。复核结果与选择：
 *
 * 1. **`base-user-info`（用户信息）** —— 复核发现它**不是"已有"，也不是"完全没有"，而是"半有"**：
 *    数据确实已经在会话基础数据里（`user-basic`，`critical: true`），但**没有任何能力入口**——
 *    不在 `ALL_CAPABILITY_DEFINITIONS` 里，AI 调不到。这正是用户点名的「用户信息」。
 *    把已有的一份读出来，成本最低、收益最直接。
 *    ⚠️ 它带一个**必须处理**的问题：原始响应里有 `password2`（bcrypt 哈希）与 `salt`。
 *    本能力**白名单返回**，见下面第三节。
 *
 * 2. **`base-user-search`（人员候选）** —— 用户点名的「人员」。它已是页面级的
 *    `meetingApplication.searchUsers`（挂在会议室申请上），调查也把它判为「部分覆盖」。
 *    这里建的是**公共 id**：所有 `kind: 'search'/'tree'` 的人员参数都该指向它，
 *    而不是让每个页面能力各挂一份。**这不是重复实现**——见下面第二节的取舍说明。
 *
 * 3. **`base-todo-list` + `base-todo-counts`（待办 / 角标）** —— 调查 §2.3 的 #21/#22/#23，
 *    **每次刷新、每次路由变化都打**，是壳里最纯的一层。体量极小（53 B / 44 B / 5 KB），
 *    契约清晰、纯只读，而且直接回答 AI 最常被问的那句话：「我现在有什么要处理的？」
 *    **与 `backlog-task-examine-list` 不是一回事**：那个走 `/bpm/hr/task/list-by-category-web`
 *    （HR 页面，带 `styleV2` 等表单参数），这个走 `/bpm/task/list-by-category`（布局角标）。
 *    两条接口、两个 Controller，已核对不重复。
 *
 * 4. **`base-menu-nav` + `base-menu-paths`（可见菜单）** —— 用户点名的「菜单」。
 *    **它是本批"被依赖"最强的一个，而且是可核实的**：`src/catalog/visibility.ts` 早已实现
 *    「按用户可见性过滤能力目录」（设计 D8 / F18 / H36），但**它是死的**——
 *    `src/catalog/index.ts` 不导出它、`src/index.ts` / `src/server.ts` 一处都不引用它，
 *    只有 `test/visibility.test.ts` 拿夹具喂它。原因很直接：**没有人能拿到那棵菜单树**。
 *    本能力补的就是这个输入（它的类型注释写死了输入来源就是 `sys/menu/nav?project=` 的 `data`）。
 *
 *    ⚠️ **一条必须如实说的事**：`sys/menu/nav` 在 Portal 前端源码里**grep 零命中**
 *    （全仓排除 `node_modules`/`dist` 搜 `sys/menu/nav` 无结果）。它不是"观测到的首屏请求"，
 *    而是 F18 记下的、后来由 bsk **在页面内手工 fetch** 抓到的（夹具 `baseline/menu-nav.sample.json`
 *    自己写着抓法是「bsk evaluate 在页面内 fetch」）。所以**它算不算"每次刷新都打"没有实测证据**，
 *    按"被依赖"这一条入选，不按"是外壳"这一条。别把它当成首屏请求来引用。
 *
 * 5. **`base-home-widgets`（工作台卡片）** —— 调查 §2.4 的 #25，首屏必打（`[源码]` 明确）。
 *    它回答「这个用户的工作台上摆了哪些卡片」——`config` 是 61 个 widget id 的 JSON 串
 *    （`hr/salary/my-payslip` 这种「模块/域/卡片」三段式），等于用户自己声明的关注面。
 *    ⚠️ **它的价值边界要说清楚**：widget id **对不上** `generated/page-catalog.json` 的 `menuPath`
 *    （一个是 `hr/salary/…`，一个是 `/dashboard/…`），本能力**不做这个映射**（见第七节）。
 *
 * **明确没选的**（都是复核过之后的决定，不是漏掉）：
 *
 * - **`{FM}/getUser`、`{CRM}/vue/getUserInfo`、`{SHOP}/admin/*`、`{MALL_ADMIN}/sys/crm/area/list`**
 *   （调查 §2.1 的 #2/#3/#14~#17/#19）：调查把它们卡在「P0-0 跨网关前缀」上，而**那条结论已被推翻**
 *   （见那份调查顶部的勘误：`/admin-shop-api`、`/admin-crm-api` 本来就不该进 platform 的透传白名单）。
 *   无头下它们的正确走法是 conventions 第 27 条——由调用方在 `options.baseUrls` 里显式给实例的 base。
 *   本批不做，理由是**优先级**：它们只服务销售/商城域，且本单的**只读冒烟跑不到**
 *   （要另配 baseUrl，且 `product` / `crm` 是异地 host，按授权范围不该碰）。
 * - **`org/sensitive/info`**（§2.1 的 #7）：206 B 的脱敏配置，独立价值太低，
 *   而且它是否影响 `user/info.mobile` 的呈现**没有验证**。不做一个没有证据的能力。
 * - **`sys/menu/menuListNotBySystem`**（后台菜单维护页的树）：**实测 756,319 B / 59 个根节点**，
 *   是 `nav?project=2` 的 **51 倍**。它是后台 CRUD 页的数据源（`views/dashboard/hr/setting/menu/list.vue`），
 *   不是外壳。要建也得先有切片入口，本批不做——**"菜单的维护"在无头下的正确形态是
 *   「静态目录 × 可见菜单求交」，不是把 756 KB 的树端出来**（调查 §4.2 的结论，复核后同意）。
 * - **`getRoleOrganizationTree`**（§2.1 的 #13，实测 596,663 B）：第一批的
 *   `base-dept-*`（扁平 `{id,name,parentId}`，73 KB）已经把「部门名 ↔ id」这个主用途覆盖了，
 *   而它按 `module-type` 变（调查 §4.5 的陷阱）。再建一条更贵的同义词，是给调用方增加选择困难。
 *
 * ---------------------------------------------------------------------------------------
 * 二、`base-user-search` 与 `meeting-user-search` 的关系（不是重复实现）
 * ---------------------------------------------------------------------------------------
 *
 * 两条能力 id **打同一个接口**、**同一套参数**。这是**刻意**的，不是疏忽：
 *
 * - `meeting-user-search` 的 `pagePath` 是会议室申请页，它的存在理由是「那个页面的参会人选择器」；
 * - `base-user-search` 的 `pagePath` 是合成的 `/base-data/user-search`，它的存在理由是
 *   「所有需要人员候选的能力共用的那一个 lookup id」。
 *
 * 合并任一边都有代价：删前者会让会议室申请的能力定义失去它的候选入口；
 * 让前者改名叫后者要动 `meeting-application.ts`（**本单的可写文件集之外**）。
 * 所以本批的做法是**给出公共 id，并在文档里点名接线方向**：后续 `lookup.capabilityId`
 * 一律指 `base-user-search`；`meeting-user-search` 保留为页面级的兼容入口，
 * 由它的 owner 决定何时收敛。**两者今天行为一致**（同一 URL、同一强制关键字规则）。
 *
 * ---------------------------------------------------------------------------------------
 * 三、凭据与敏感字段：`password2` / `salt` **必须**在出口处丢掉
 * ---------------------------------------------------------------------------------------
 *
 * `GET /admin-api/sys/user/info` 实测返回 33 个字段，里面**混着两个绝不该外流的东西**：
 * `password2`（bcrypt 哈希）与 `salt`。调查 §4.4 把它标成「SDK 归一化时必须显式丢掉这两个字段」。
 * 本文件的做法比"丢掉黑名单"更稳：**白名单**——只挑出下面 `ShellUserInfo` 里声明的那 16 个字段，
 * 其余（含 `password2`/`salt`，也含 `creator`/`updater`/`salt` 之外的任何将来新增字段）一律不进返回值。
 *
 * **为什么白名单而不是黑名单**：黑名单要求"每次后端加字段都记得来加一条"，
 * 而漏一次就是一次凭据泄漏，且**不会有任何测试变红**——那是本仓库最怕的失败形态。
 * 白名单的失败方向相反：后端加了个有用字段，最坏结果是"暂时取不到"，看得见、可修。
 *
 * 这条**在挂会话时同样成立**：会话里的 `user-basic` 存的是**原始响应**（带 `password2`），
 * 本能力读出来之后**同样过一遍白名单**才返回。`test/base-shell.test.ts` 里有一条断言
 * 专门拿带 `password2` 的会话夹具去卡这件事——两个出口各锁一条。
 *
 * ---------------------------------------------------------------------------------------
 * 四、体积：每个入口都有硬上限，长选项一律先要关键字
 * ---------------------------------------------------------------------------------------
 *
 * 复核时重新量了体量（调查的数字对得上，但也发现调查**漏报了两个更大的**）：
 *
 * | 调用 | 实测 | 说明 |
 * | --- | --- | --- |
 * | `simple-page` 无关键字 | total **4225**（全公司的人） | 后端**不强制关键字** |
 * | `simple-page?pageSize=-1` | **577,845 B** / 4225 条 | 调查没测这个；这是 conventions 第 11 条说的那件事 |
 * | `simple-page?pageSize=500` | 68,819 B / 500 条 | 也无关键字 |
 * | `bpm/task/list-by-category?pageSize=500` | **314,395 B** / 500 条 | 调查没测这个 |
 * | `sys/menu/nav?project=2` | 14,851 B / 57 节点 | |
 * | `homePage/get` | 9,019 B / 61 widget | |
 *
 * → 所以：**没有 `listAll()`**，每个入口都有 `*_MAX` 硬上限（**截断，不是提示**），
 * 人员与待办**必须给关键字**（人员是 `nickname`，待办是服务端 `taskNameLike` 的 `name`）。
 *
 * ⚠️ **`simple-page` 的关键字强制是 SDK 侧做的，不是后端做的**：实测无关键字也返回 200
 * 且 total=4225。所以拒绝逻辑写在 `searchUsers()` 里（`keyword` 与 `deptId` 至少给一个），
 * 与 `meetingApplication.searchUsers` 的规则一致。**这条别写成"后端要求关键字"。**
 *
 * `pageSize = -1` 单独拒绝（而不是截断成 50）：那不是一个"稍微大一点的页"，
 * 是一个**全量请求**，静默截断会让调用方以为它拿到了全部。拒绝更好。
 *
 * ---------------------------------------------------------------------------------------
 * 五、`finished` 的真实语义（从后端源码读出来的，不是猜的）
 * ---------------------------------------------------------------------------------------
 *
 * 调查 §8.5 留了「`finished=1` 与 `finished=2` 哪个是待办」没确认。答案在
 * `erp-module-bpm/…/api/vo/task/BpmTaskPageReqVO.java` 的字段注释上：**`1:待办，2:已办`**。
 * Service 实现（`BpmTaskServiceImpl#getTaskListByCategory`）里是一个**三态分支**，不是两态：
 *
 * ```java
 * if (pageVO.getFinished() != null) {
 *     if (pageVO.getFinished() == 1) { taskQuery.unfinished()… } else { taskQuery.finished()… }
 * }
 * ```
 *
 * 也就是说：**`finished` 缺席 = 不加任何状态过滤**（实测 total 562 = 全部），
 * `= 1` → 待办（25），**`= 其它任何值`（含 0）→ 已办**（415）。
 * 所以本能力**不用 `finished` 的裸值当参数**，而是收一个 `scope: 'todo'|'done'|'all'`
 * 并在实现里映射成「1 / 2 / 不发这个参数」——把那个"0 也是已办"的坑关在 SDK 内部。
 *
 * 顺带一条：**562 ≠ 25 + 415**。别把「全部」当成两类之和来理解，它是**不做状态过滤**
 * 的那一份，与两类的口径不同。这是实测数字，不是笔误。
 *
 * ---------------------------------------------------------------------------------------
 * 六、缓存：能挂会话的挂上，挂不上的用实例内 TTL + 单飞
 * ---------------------------------------------------------------------------------------
 *
 * | 数据 | 会话键 | 没挂会话时 |
 * | --- | --- | --- |
 * | 用户信息 | **`user-basic`**（已存在，`critical: true`，本文件不新增） | 实例内缓存，TTL 30 分钟 |
 * | 菜单树 | 无（键随 `project` 变，见下） | 实例内缓存（**按 project 分片**），TTL 30 分钟 |
 * | 工作台卡片 | 无 | 同上 |
 * | 人员候选 / 待办 | **不缓存** | — |
 *
 * 三个决定分别的理由：
 *
 * - **用户信息读已有会话键**，不新增：`user-basic` 已经指向同一个 `sys/user/info`，
 *   再加一个键只会让同一个请求在一次会话里被打第二遍。这与第一批对字典的处理同一条理由。
 * - **菜单树的缓存键必须并进 `project`**：实测 `project=1` 与 `project=2` 返回的树不同
 *   （1 个节点 vs 57 个节点）。**这是本批唯一的"缓存键不是只按用户"的地方** ——
 *   与调查 §4.5 说的 `module-type` 陷阱是同一类问题（同一用户、不同上下文 = 不同数据）。
 *   本文件把切片键写成 `menu-nav:<project>`，`invalidate('menu-nav')` 清掉全部 project。
 * - **人员与待办不缓存**：它们**逐次带参数**（关键字 / 分页 / scope），缓存命中率极低，
 *   而这些数据本质上"问一次就要最新的"。硬缓存它们只会制造"我明明改了名字却搜不到"这类幽灵。
 *
 * TTL 取 `BASE_SHELL_CACHE_TTL_MS`（30 分钟），与 `src/session/store.ts` 的
 * `DEFAULT_ABSOLUTE_TTL_MS` **同值**——挂不挂会话行为一致；测试里断言了这个等式，漂开就红。
 * 并发去重仍走 `src/session/single-flight.ts`。
 *
 * ---------------------------------------------------------------------------------------
 * 七、module-type：**一律不发**（并给出各自的依据强度）
 * ---------------------------------------------------------------------------------------
 *
 * 五个页面路径都是合成的 `/base-data/*`。规则表 88 条 prefix + 186 条 paths **全部**以
 * `/dashboard/` 开头，所以 `resolveModuleType()` 对它们一律返回 `null` → 不发这个头
 * （与 conventions 第 2 条一致：算不出就不发）。测试里钉死了这一点。
 *
 * 本批七个接口都做了带 / 不带 `module-type: 11` 的**交错对照**（`smoke/read-base-shell.mjs`
 * 的 `moduleTypeControl`：不带 → 带 → 不带 → 带，先确认基线自己稳不稳，再比带/不带）：
 *
 * | 接口 | 实测结论 |
 * | --- | --- |
 * | `sys/user/info` | 基线稳，带/不带 data 完全相同 |
 * | `system/user/simple-page` | 基线稳，带/不带 data 完全相同 |
 * | `bpm/task/list-by-category` | 基线稳，带/不带 data 完全相同 |
 * | `kpimessageremind/getUnreadcount` | 基线稳，带/不带 data 完全相同 |
 * | `finance/expense-review/pending-count` | 基线稳，带/不带 data 完全相同 |
 * | `sys/menu/nav?project=2` | 基线稳，带/不带 data 完全相同 |
 * | **`homePage/get`** | **没有结论** —— 见下 |
 *
 * ⚠️ **`homePage/get` 要单独说，别把它读成"不敏感"**：多次跑的结论**不一致**，
 * 其中一次"同一参数连打两次"就已经不同了（`updater` / `updateTime` / `config` 都变），
 * 也就是**基线自己在动** —— 说明那个工作台配置在测试环境里会被别的会话写。
 * 基线不稳时对照方法给不出结论，脚本会如实报"本次对照无效，不给结论"而不是硬判一个。
 * 所以对这条接口，`module-type` 是否被后端读取**本单没有验证**；
 * 这里不发的依据只是"算不出就不发"（conventions 第 2 条），**不是**"实测不敏感"。
 *
 * 另外，这一条**本身就是那次假阳性留下的教训**：第一版对照是朴素的"打两次比一次"，
 * 它把 `homePage/get` 报成了"敏感"——差一点就往文档里写下一个错结论。
 * 凡是"比两次"的对照，都要先问一句"这两次之间，资源自己会不会动"。
 *
 * **整体口径**：以上是"**本账号实测**不敏感"，不是"后端不读这个头"——除了
 * `bpm/task/list-by-category`（后端 `getTaskListByCategory` 里确实没有任何 `@DataPermission`，
 * 查询条件是 `taskAssignee(登录用户)`，源码直读）之外，其余几条**没有核对后端实现**。
 * 一个数据范围不同的账号可能不一样。所以它是"默认不发站得住脚"的证据，
 * 而不是"这个头在这里永远没用"。需要收窄时由接线方通过 `BaseShellOptions.moduleType` 显式给——
 * SDK 不猜。
 *
 * ---------------------------------------------------------------------------------------
 * 八、已知坑（写进参数描述，免得调用方再踩）
 * ---------------------------------------------------------------------------------------
 *
 * - **`simple-page` 的 `deptName` / `realName` / `staffDuties` / `staffCode` 实测都是 `null`**，
 *   只有 `nickname` 与 `deptId` / `code` 有值。别指望它能回答"这个人的真名是什么"。
 * - **`user/info` 的 `deptId` 本账号也是 `null`**，而 `organizationId` / `organizationName` 有值。
 *   要部门树请走 `base-dept-*`（第一批）。
 * - **`homePage/get` 的 `config` 是一个 JSON 字符串**，不是对象。本能力负责解析，
 *   并把它拆成 `{cardId, widget, knownModules, layout}` 的数组。`layout` 原样保留（x/y/w/h）。
 * - **菜单节点的 `url` 恒为 `null`**（实测 57 个节点里 0 个有值），页面路径在 `permissions` 里；
 *   且 `permissions` **从不是逗号分隔**（实测含逗号 0 个）。与 conventions 第 16 条一致。
 * - **`listMenuPaths` 返回的是原始 `permissions` 值，不是归一化后的键**。
 *   `collectVisiblePaths` 会再做三步归一化（去 query、去结尾 `/list`、`platform-v2`→`platform`）。
 *   要做可见性求交请用 `getMenuNav` 的树喂 `createUserVisibility`，别拿这个列表去比。
 */

import { SingleFlight } from '../session/single-flight.js'
import type { BaseDataRequest, SessionBaseDataReader } from './base-dept-dict-permission.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

// ---------------------------------------------------------------------------
// 合成页面上下文（与第一批同一个根，理由见 base-dept-dict-permission.ts）
// ---------------------------------------------------------------------------

/**
 * ⚠️ 下面这几个常量**必须写成单引号字符串字面量**，不能拼模板串——
 * `tools/generate/derive-aliases.mjs:183` 的正则 `const\s+(\w+)\s*=\s*'([^']*)'` 只认单引号。
 * 拼出来的话这些路径解析为 null，本文件的能力定义会被**静默跳过**，
 * 于是「目录扫到的」与「应用真正加载的」分叉——那正是 `test/aliases-derived.test.ts` 卡的事。
 * （第一批已经因为同一个坑写过一次警告，这里是第二次，因为踩它的代价是静默的。）
 */
export const BASE_SHELL_CONTEXT_ROOT = '/base-data'
export const BASE_USER_INFO_PATH = '/base-data/user-info'
export const BASE_USER_SEARCH_PATH = '/base-data/user-search'
export const BASE_TODO_PATH = '/base-data/todo'
export const BASE_MENU_NAV_PATH = '/base-data/menu-nav'
export const BASE_HOME_WIDGETS_PATH = '/base-data/home-widgets'

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

export const USER_INFO_URL = '/admin-api/sys/user/info'
export const USER_SIMPLE_PAGE_URL = '/admin-api/system/user/simple-page'
export const BPM_TASK_URL = '/admin-api/bpm/task/list-by-category'
export const UNREAD_COUNT_URL = '/admin-api/performance/basedata/kpimessageremind/getUnreadcount'
export const EXPENSE_PENDING_URL = '/admin-api/finance/expense-review/pending-count'
export const MENU_NAV_URL = '/admin-api/sys/menu/nav'
export const HOME_PAGE_URL = '/admin-api/homePage/get'

/**
 * 本文件**不新增**会话基础数据键。
 *
 * 用户信息复用 `src/session/base-data.ts` 已有的 `user-basic`（同一个 `sys/user/info`，
 * `critical: true`）。其余四项**没有合适的数据项**，理由是它们要么带参数（菜单树按 `project` 分片、
 * 待办按 scope 分页）、要么没人依赖（工作台卡片）：给它们注册一个"每次会话都全量拉一份"的键，
 * 只会让每个会话多花 4 次请求去拉一份可能一次都用不到的数据。这与第一批不给字典加第三个键同理。
 */
export const BASE_SHELL_SESSION_KEYS = { userInfo: 'user-basic' } as const

/** 未挂会话时，实例内缓存的存活时间。与 `DEFAULT_ABSOLUTE_TTL_MS` 同值，测试里钉死 */
export const BASE_SHELL_CACHE_TTL_MS = 30 * 60 * 1000

// ---- 硬上限。理由见文件头第四节：一次调用不能把整张表倒出来 ----
export const USER_SEARCH_PAGE_SIZE_DEFAULT = 20
export const USER_SEARCH_PAGE_SIZE_MAX = 50
export const TODO_PAGE_SIZE_DEFAULT = 20
export const TODO_PAGE_SIZE_MAX = 50
export const MENU_MAX_NODES_DEFAULT = 200
export const MENU_MAX_NODES_MAX = 500
export const MENU_PATH_LIMIT_DEFAULT = 100
export const MENU_PATH_LIMIT_MAX = 300
export const HOME_WIDGET_LIMIT_DEFAULT = 60
export const HOME_WIDGET_LIMIT_MAX = 100

/** `finished` 的三态。1 = 待办，2 = 已办，缺席 = 不加状态过滤（见文件头第五节） */
export const BPM_FINISHED_TODO = 1
export const BPM_FINISHED_DONE = 2

export type TodoScope = 'todo' | 'done' | 'all'

// ---------------------------------------------------------------------------
// 归一化后的形状
// ---------------------------------------------------------------------------

/**
 * `GET /admin-api/sys/user/info` 的**白名单**视图（见文件头第三节）。
 *
 * 没有出现在这个类型里的字段**一定不会被返回**——包括 `password2` 与 `salt`。
 */
export type ShellUserInfo = {
  id: string
  username: string | null
  realName: string | null
  headUrl: string | null
  gender: number | null
  email: string | null
  mobile: string | null
  status: number | null
  /** 实测是 0/1。这里归一成布尔 —— 它是「这个用户是不是超管」的唯一判据 */
  superAdmin: boolean
  /**
   * 实测是 0/1，这里归一成布尔。**调查 §4.4 只点了 `superAdmin`，漏了这个**——
   * 它是「是不是租户管理员」，而租户管理员在 `permissionsNotBySystem` 的取值路径
   * （`tenantAdmin` 那一支）与普通用户不同，是第二个身份判据。
   */
  tenantAdmin: boolean
  /** 岗位名（如「设计中心1236」那种口径之外的岗位） */
  postName: string | null
  deptId: string | null
  organizationId: string | null
  organizationName: string | null
  /** 形如 `沃德辰龙-沃德博创-…-设计中心1236` */
  organizationFullPathName: string | null
  organizationCode: string | null
  /** 由 `roleIdList` 归一而来；原始值为 null 时这里也是 null */
  roleIds: string[] | null
  createDate: string | null
}

/** 人员候选的一条。字段全部来自 `simple-page` 的 `list[]` */
export type SimpleUser = {
  id: string
  nickname: string | null
  deptId: number | null
  code: string | null
  /** ⚠️ 实测恒为 null（见文件头第八节），保留是为了不改名、不丢字段 */
  deptName: string | null
  staffDuties: string | null
  realName: string | null
  staffCode: string | null
}

/** 待办/已办的一条。由 `bpm/task/list-by-category` 的 `list[]` 摊平而来 */
export type TodoItem = {
  id: string
  /** 任务名（如「通用审批」「用章审批」） */
  name: string | null
  createTime: string | null
  claimTime: string | null
  /** 流程实例 id */
  processInstanceId: string | null
  /** 流程标题 */
  title: string | null
  processDefinitionKey: string | null
  startUserId: number | null
  startUserNickname: string | null
  /** 流程结果码；实测待办侧为 null、已办侧出现过 4（语义未核实） */
  result: number | null
}

/** 菜单节点。**与 `src/catalog/visibility.ts` 的 `MenuNode` 结构兼容**，可直接喂给
 *  `createUserVisibility({ menuTree })` —— 那是本能力的首要用途 */
export type ShellMenuNode = {
  id: string | number | null
  pid: string | number | null
  name: string | null
  /** 实测恒为 null（页面路径在 `permissions` 里），保留是为了不"吃掉"响应字段 */
  url: string | null
  /** 0 = 菜单，1 = 按钮 */
  menuType: number | null
  /** 1 人力 2 财务 3 物 4 产 5 供 6 销 */
  useSystem: number | null
  project: number | null
  /** **页面路径或权限码就存在这里**（实测 41 个非空里 36 个是 `/` 开头的路径） */
  permissions: string | null
  children: ShellMenuNode[]
}

/** 工作台卡片。由 `homePage/get` 的 `config`（一个 JSON **字符串**）解析而来 */
export type HomeWidget = {
  /** 布局项自己的 id（`config[].id`，短随机串），不是业务 id */
  cardId: string | null
  /** 卡片标识，形如 `hr/salary/my-payslip`（模块/域/卡片） */
  widget: string
  /** 该卡片自己声明的依赖模块 */
  knownModules: string[]
  /** 布局，原样保留（实测字段名是 x/y/w/h） */
  layout: { x: number | null; y: number | null; w: number | null; h: number | null }
}

/** 形状不认识时抛它：这是**数据/接线**问题，不是"没有数据" */
export class BaseShellShapeError extends Error {
  override readonly name = 'BaseShellShapeError'
  constructor (message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const TODO_SCOPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '待办（finished=1）', value: 'todo' },
  { label: '已办（finished=2）', value: 'done' },
  { label: '全部（不发 finished）', value: 'all' },
]

export const baseShellCapabilities: CapabilityDefinition[] = [
  // ---- 用户信息 ----
  {
    id: 'base-user-info',
    title: '当前登录用户的信息（基础能力，白名单字段）',
    pagePath: BASE_USER_INFO_PATH,
    write: false,
    params: [],
  },

  // ---- 人员候选 ----
  {
    id: 'base-user-search',
    title: '按关键字 / 部门搜人员候选（基础能力，全公司 4225 人）',
    pagePath: BASE_USER_SEARCH_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: false,
        description:
          '姓名关键字（映射到后端的 `nickname`）。候选是全公司 **4225 人**（实测），属于长选项参数，' +
          '**必须给 keyword 或 deptId 之一**（设计 D6 / H35）——' +
          '⚠️ 后端并不强制这一点（无关键字也返回 200、total=4225），拒绝是 SDK 侧做的',
      },
      {
        name: 'deptId',
        kind: 'tree',
        required: false,
        description: '限定部门。候选走 base-dept-search（第一批的部门能力）',
        lookup: { capabilityId: 'base-dept-search', keywordParam: 'keyword' },
      },
      {
        name: 'pageNo',
        kind: 'number',
        required: false,
        description: '页码，默认 1',
      },
      {
        name: 'pageSize',
        kind: 'number',
        required: false,
        description:
          `每页条数，默认 ${USER_SEARCH_PAGE_SIZE_DEFAULT}，**硬上限 ${USER_SEARCH_PAGE_SIZE_MAX}**。` +
          '⚠️ 不要传 -1：实测 `pageSize=-1` 会一次吐回 577,845 B / 4225 条，本能力直接拒绝这个值',
      },
    ],
  },

  // ---- 待办 / 已办 ----
  {
    id: 'base-todo-list',
    title: '查我的待办 / 已办事项（基础能力，流程任务）',
    pagePath: BASE_TODO_PATH,
    write: false,
    params: [
      {
        name: 'scope',
        kind: 'enum',
        required: false,
        options: TODO_SCOPE_OPTIONS,
        description:
          '看哪一类，默认 `todo`。映射到后端的 `finished`：todo→1、done→2、all→**不发这个参数**。' +
          '⚠️ 后端是**三态**不是两态：`finished` 传 0 也会被当成"已办"（源码实测），所以别绕过这个枚举',
      },
      {
        name: 'name',
        kind: 'text',
        required: false,
        description:
          '任务名关键字，**服务端过滤**（后端 `taskNameLike("%…%")`）。' +
          '已办有 415 条、全部有 562 条（实测），要给一条具体的待办就得用它',
      },
      {
        name: 'pageNo',
        kind: 'number',
        required: false,
        description: '页码，默认 1',
      },
      {
        name: 'pageSize',
        kind: 'number',
        required: false,
        description:
          `每页条数，默认 ${TODO_PAGE_SIZE_DEFAULT}，**硬上限 ${TODO_PAGE_SIZE_MAX}**。` +
          '实测 `pageSize=500` 会吐回 314,395 B，所以上限是截断而不是提示',
      },
    ],
  },
  {
    id: 'base-todo-counts',
    title: '读三个角标数：待办 / 未读消息 / 待审费用（基础能力）',
    pagePath: BASE_TODO_PATH,
    write: false,
    params: [],
  },

  // ---- 可见菜单 ----
  {
    id: 'base-menu-nav',
    title: '取当前用户可见的菜单树（基础能力，喂给可见性过滤）',
    pagePath: BASE_MENU_NAV_PATH,
    write: false,
    params: [
      {
        name: 'project',
        kind: 'number',
        required: true,
        description:
          '项目号，**必填**：实测 `1`（学习型组织）→ 1 个节点、`2`（人力绩效）→ 57 个节点、' +
          '`3` 与 `0` → 0 个节点。不传时后端默认按 1 返回——那不是"全部"，别把它当默认值',
      },
      {
        name: 'keyword',
        kind: 'text',
        required: false,
        description:
          '按节点名或 `permissions` 片段裁剪。**命中节点的祖先会被保留**，否则树断了看不出层级',
      },
      {
        name: 'maxNodes',
        kind: 'number',
        required: false,
        description:
          `返回节点数的硬上限，默认 ${MENU_MAX_NODES_DEFAULT}，上限 ${MENU_MAX_NODES_MAX}。` +
          '超了会**截断并如实置 `truncated: true`**——被截断的树不要拿去算可见性',
      },
    ],
  },
  {
    id: 'base-menu-paths',
    title: '摊平可见菜单里的页面路径（基础能力）',
    pagePath: BASE_MENU_NAV_PATH,
    write: false,
    params: [
      {
        name: 'project',
        kind: 'number',
        required: true,
        description: '项目号，必填。同 base-menu-nav',
      },
      {
        name: 'keyword',
        kind: 'search',
        required: false,
        description:
          '路径片段（如 `/dashboard/finance/`）。不传则返回前 N 条——' +
          '本接口的规模是有界的（实测 project=2 只有 36 条路径码），所以不像人员那样强制关键字',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${MENU_PATH_LIMIT_DEFAULT}，上限 ${MENU_PATH_LIMIT_MAX}`,
      },
    ],
  },

  // ---- 工作台卡片 ----
  {
    id: 'base-home-widgets',
    title: '取当前用户工作台上配置的卡片（基础能力）',
    pagePath: BASE_HOME_WIDGETS_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: false,
        description:
          '按卡片标识或依赖模块过滤（如 `salary`、`hr/`）。不传则返回前 N 条——' +
          '本接口的规模有界（实测 61 张卡片 / 9 KB）',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几张，默认 ${HOME_WIDGET_LIMIT_DEFAULT}，上限 ${HOME_WIDGET_LIMIT_MAX}`,
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type BaseShellOptions = {
  request: BaseDataRequest
  /** 可选：会话。传了就优先读 `user-basic`（同一份用户信息不再打第二遍） */
  session?: SessionBaseDataReader | null
  /**
   * 这个头默认**不发**（见文件头第七节）。需要把外壳请求收窄到某个模块口径时由接线方显式给。
   * 注意第七节那张表：只有 `sys/menu/nav` 是实测不敏感的，另外几条是推断。
   */
  moduleType?: number
  /** 实例内缓存的 TTL。默认 `BASE_SHELL_CACHE_TTL_MS`（30 分钟） */
  cacheTtlMs?: number
  /** 注入时钟，测试用（conventions 第 22 条：TTL 不用真实 sleep 测） */
  now?: () => number
}

function clampLimit (value: number | undefined, fallback: number, max: number): number {
  const raw = value === undefined || value === null ? fallback : Math.trunc(Number(value))
  if (!Number.isFinite(raw)) return fallback
  return Math.min(Math.max(1, raw), max)
}

/** `-1` 单独拒绝：那不是一个"大一点的页"，是一次全量请求（见文件头第四节） */
function assertNotFullPull (pageSize: unknown, label: string): void {
  if (pageSize !== undefined && pageSize !== null && Number(pageSize) === -1) {
    throw new Error(
      `${label} 不允许 pageSize = -1（全量拉取）。实测那个人口子会一次吐回 577,845 B / 4225 条，` +
        '会直接冲掉调用方的上下文；请用关键字 + 分页（设计 D6 / H35）。',
    )
  }
}

const asString = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value)

const asNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 0/1 的通路归一成布尔（实测这两个字段在真机上就是 0/1 的 number）。
 * 只认 1 / true / '1' 三种真值，其余一律 false —— 不做 `Boolean(value)`
 * （那样 `'0'` 与 `'false'` 都会变成 true，是典型的静默反向错误）。
 */
const asFlag = (value: unknown): boolean => value === 1 || value === true || value === '1'

/**
 * 用户信息 → 白名单视图。
 *
 * **这里是 `password2` / `salt` 唯一的出口关卡**：两个出口（会话 / 发请求）都走它。
 * 少走一次就是一次凭据外流，而且不会有任何测试变红——所以 `test/base-shell.test.ts`
 * 里两条出口各有一条断言。
 */
export function normalizeUserInfo (payload: unknown): ShellUserInfo {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BaseShellShapeError(
      `用户信息的形状不认识（收到 ${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}）：` +
        `${USER_INFO_URL} 期望一个对象`,
    )
  }
  const raw = payload as Record<string, unknown>
  if (raw.id === undefined || raw.id === null) {
    throw new BaseShellShapeError(`${USER_INFO_URL} 的返回里没有 id —— 会话里那份可能不是用户信息`)
  }

  return {
    id: String(raw.id),
    username: asString(raw.username),
    realName: asString(raw.realName),
    headUrl: asString(raw.headUrl),
    gender: asNumber(raw.gender),
    email: asString(raw.email),
    mobile: asString(raw.mobile),
    status: asNumber(raw.status),
    superAdmin: asFlag(raw.superAdmin),
    tenantAdmin: asFlag(raw.tenantAdmin),
    postName: asString(raw.postName),
    deptId: asString(raw.deptId),
    organizationId: asString(raw.organizationId),
    organizationName: asString(raw.organizationName),
    organizationFullPathName: asString(raw.organizationFullPathName),
    organizationCode: asString(raw.organizationCode),
    roleIds: Array.isArray(raw.roleIdList) ? raw.roleIdList.map((item) => String(item)) : null,
    createDate: asString(raw.createDate),
  }
}

function normalizeSimpleUsers (payload: unknown): { list: SimpleUser[]; total: number } {
  const data = payload as { list?: unknown; total?: unknown } | null
  const rawList = Array.isArray(data?.list) ? data.list : []
  const list = rawList.map((item) => {
    const row = item as Record<string, unknown> | null
    return {
      id: String(row?.id ?? ''),
      nickname: asString(row?.nickname),
      deptId: asNumber(row?.deptId),
      code: asString(row?.code),
      deptName: asString(row?.deptName),
      staffDuties: asString(row?.staffDuties),
      realName: asString(row?.realName),
      staffCode: asString(row?.staffCode),
    }
  })
  return { list, total: asNumber(data?.total) ?? list.length }
}

function normalizeTodos (payload: unknown): { list: TodoItem[]; total: number } {
  const data = payload as { list?: unknown; total?: unknown } | null
  const rawList = Array.isArray(data?.list) ? data.list : []
  const list = rawList.map((item) => {
    const row = item as Record<string, unknown> | null
    const instance = (row?.processInstance ?? {}) as Record<string, unknown>
    return {
      id: String(row?.id ?? ''),
      name: asString(row?.name),
      createTime: asString(row?.createTime),
      claimTime: asString(row?.claimTime),
      processInstanceId: asString(instance.id),
      title: asString(instance.title),
      processDefinitionKey: asString(instance.processDefinitionKey),
      startUserId: asNumber(instance.startUserId),
      startUserNickname: asString(instance.startUserNickname),
      result: asNumber(instance.result),
    }
  })
  return { list, total: asNumber(data?.total) ?? list.length }
}

function normalizeMenuNode (raw: unknown): ShellMenuNode | null {
  if (raw === null || typeof raw !== 'object') return null
  const node = raw as Record<string, unknown>
  const children = Array.isArray(node.children)
    ? node.children.map(normalizeMenuNode).filter((item): item is ShellMenuNode => item !== null)
    : []
  return {
    id: (node.id as string | number | null) ?? null,
    pid: (node.pid as string | number | null) ?? null,
    name: asString(node.name),
    url: asString(node.url),
    menuType: asNumber(node.menuType),
    useSystem: asNumber(node.useSystem),
    project: asNumber(node.project),
    permissions: asString(node.permissions),
    children,
  }
}

/** 解析 `homePage/get` 的 `config`（一个 JSON **字符串**）。见文件头第八节 */
export function parseHomeWidgets (config: unknown): { widgets: HomeWidget[]; configured: boolean } {
  if (config === null || config === undefined || config === '') {
    return { widgets: [], configured: false }
  }
  if (typeof config !== 'string') {
    throw new BaseShellShapeError(
      `homePage/get 的 config 期望是一个 JSON 字符串，收到 ${typeof config}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(config)
  } catch (error) {
    throw new BaseShellShapeError(
      `homePage/get 的 config 不是合法 JSON（前 80 字符：${config.slice(0, 80)}）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!Array.isArray(parsed)) {
    throw new BaseShellShapeError(`homePage/get 的 config 解析后不是数组，而是 ${typeof parsed}`)
  }
  const widgets = parsed
    .map((item) => {
      const row = item as Record<string, unknown> | null
      const widget = asString(row?.widget)
      if (widget === null || widget === '') return null
      return {
        cardId: asString(row?.id),
        widget,
        knownModules: Array.isArray(row?.knownModules)
          ? row.knownModules.map((m) => String(m))
          : [],
        layout: {
          x: asNumber(row?.x),
          y: asNumber(row?.y),
          w: asNumber(row?.w),
          h: asNumber(row?.h),
        },
      }
    })
    .filter((item): item is HomeWidget => item !== null)
  return { widgets, configured: true }
}

/**
 * 造这批外壳能力的实现。
 *
 * 接线方按门面形态注入请求函数（单用户传 `(config) => call(PATH, config)`，
 * 多用户传这一份会话的 `call`），并可选地把 `session` 传进来读 `user-basic`。
 */
export function createBaseShell (options: BaseShellOptions) {
  const { request, session } = options
  const ttlMs = options.cacheTtlMs ?? BASE_SHELL_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const moduleType = options.moduleType

  const slices = new Map<string, { source: unknown; index: unknown; at: number }>()
  const flight = new SingleFlight<unknown>()
  let cacheGeneration = 0

  /** 统一把 moduleType 注入请求（默认不发；只有接线方显式给了才带） */
  const send = <T>(config: { url: string; method: 'get'; params?: unknown }): Promise<T> =>
    request<T>(moduleType === undefined ? config : { ...config, moduleType })

  const fromSession = (key: string): unknown =>
    session && session.has(key) ? session.get(key) : undefined

  /**
   * 取一份带缓存的载荷。命中未过期缓存时**一次请求都不发**；并发由单飞合并。
   * `source` 引用相同就复用已建好的归一化结果（会话里那份没变时不必重建）。
   */
  async function loadSlice<T> (
    sliceKey: string,
    fetchPayload: () => Promise<unknown>,
    build: (payload: unknown) => T,
  ): Promise<T> {
    const hit = slices.get(sliceKey)
    if (hit && now() - hit.at < ttlMs) {
      return hit.index as T
    }
    const generation = cacheGeneration
    const source = await flight.run(sliceKey, fetchPayload)
    if (hit && hit.source === source) {
      hit.at = now()
      return hit.index as T
    }
    const index = build(source)
    if (generation === cacheGeneration) {
      slices.set(sliceKey, { source, index, at: now() })
    }
    return index
  }

  /** 用户信息：优先读会话里的 `user-basic`（**读出来也要过白名单**，见文件头第三节） */
  const loadUserInfo = (): Promise<ShellUserInfo> =>
    loadSlice(
      'user-info',
      async () => {
        const cached = fromSession(BASE_SHELL_SESSION_KEYS.userInfo)
        return cached === undefined
          ? await send<unknown>({ url: USER_INFO_URL, method: 'get' })
          : cached
      },
      normalizeUserInfo,
    )

  /** 见过哪些 `menu-nav:<project>` 切片键。`SingleFlight` 没有枚举接口，失效时要用 */
  const menuSliceKeys = new Set<string>()

  /** 登记并返回切片键（登记这件事不能忘，否则 `invalidate('menu-nav')` 会漏掉它） */
  function registerMenuSlice (project: number): string {
    const key = `menu-nav:${project}`
    menuSliceKeys.add(key)
    return key
  }

  const loadMenuTree = (project: number): Promise<ShellMenuNode[]> =>
    loadSlice(
      // ⚠️ 切片键必须并进 project：实测 project=1 与 project=2 返回的树不同（文件头第六节）
      registerMenuSlice(project),
      () => send<unknown>({ url: MENU_NAV_URL, method: 'get', params: { project } }),
      (payload) => {
        if (payload === null || payload === undefined) return []
        if (!Array.isArray(payload)) {
          throw new BaseShellShapeError(
            `${MENU_NAV_URL}?project=${project} 期望返回节点数组，收到 ${typeof payload}`,
          )
        }
        return payload
          .map(normalizeMenuNode)
          .filter((node): node is ShellMenuNode => node !== null)
      },
    )

  /**
   * 树 → 保留命中节点 + **它们的祖先**（否则树断了看不出层级）。
   *
   * 与截断**分成两步**是刻意的：合成一步的话，被丢掉的子树也会消耗节点预算，
   * 于是一棵本来放得下的树会被误报成 `truncated` —— 而 `truncated` 是要被调用方
   * 当成"这份树不能用于可见性判断"的硬信号，误报等于让那个信号失去意义。
   */
  function filterTree (nodes: ShellMenuNode[], keyword: string): ShellMenuNode[] {
    const out: ShellMenuNode[] = []
    for (const node of nodes) {
      const children = filterTree(node.children, keyword)
      const selfHit =
        (node.name ?? '').toLowerCase().includes(keyword) ||
        (node.permissions ?? '').toLowerCase().includes(keyword)
      if (selfHit || children.length > 0) {
        out.push({ ...node, children })
      }
    }
    return out
  }

  /** 按节点预算做**前缀式**截断（DFS 序，保留靠前的节点） */
  function truncateTree (
    nodes: ShellMenuNode[],
    budget: { left: number },
  ): { tree: ShellMenuNode[]; truncated: boolean } {
    const out: ShellMenuNode[] = []
    let truncated = false
    for (const node of nodes) {
      if (budget.left <= 0) {
        truncated = true
        break
      }
      budget.left -= 1
      const children = truncateTree(node.children, budget)
      if (children.truncated) truncated = true
      out.push({ ...node, children: children.tree })
    }
    return { tree: out, truncated }
  }

  function countNodes (nodes: ShellMenuNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0)
  }

  function collectPaths (nodes: ShellMenuNode[], into: string[] = []): string[] {
    for (const node of nodes) {
      const permission = node.permissions
      if (permission !== null && permission.startsWith('/')) into.push(permission)
      collectPaths(node.children, into)
    }
    return into
  }

  const resolveProject = (project: unknown, method: string): number => {
    // null / undefined / '' **单独挡掉**：`Number(null)` 与 `Number('')` 都是 0（有限值），
    // 不挡的话"没传 project"会被静默当成 project=0（实测返回空树），
    // 调用方会把"我没传参"读成"这个人一个菜单都没有"。失败要看得见。
    if (project === undefined || project === null || project === '') {
      throw new Error(
        `${method} 的 project 必填（实测：1 = 学习型组织 1 个节点、2 = 人力绩效 57 个节点、3 与 0 = 空）。` +
          '不传时后端按 1 返回，"不传"不等于"全部"',
      )
    }
    const value = Number(project)
    if (!Number.isFinite(value)) {
      throw new Error(
        `${method} 的 project 必须是数字，收到 ${JSON.stringify(project)}。` +
          '实测：1 = 学习型组织 1 个节点、2 = 人力绩效 57 个节点、3 与 0 = 空',
      )
    }
    return Math.trunc(value)
  }

  return {
    /** 丢掉实例内缓存。写操作污染了基础数据、或要强制拿最新时用 */
    invalidate (slice?: 'user-info' | 'menu-nav' | 'home-widgets'): void {
      cacheGeneration += 1
      if (slice === undefined) {
        slices.clear()
        flight.clear()
        return
      }
      if (slice === 'menu-nav') {
        // 菜单的切片键带 project 后缀（键随 project 变，见文件头第六节），
        // 所以要把前缀命中的全部清掉。`SingleFlight` 没有枚举接口，用下面那个集合记。
        for (const key of [...slices.keys()]) {
          if (key.startsWith('menu-nav:')) slices.delete(key)
        }
        for (const key of menuSliceKeys) flight.forget(key)
        menuSliceKeys.clear()
        return
      }
      slices.delete(slice)
      flight.forget(slice)
    },

    /**
     * 当前登录用户的信息。**只读**。
     *
     * 返回的是白名单视图（`ShellUserInfo`）：原始响应里的 `password2` / `salt`
     * **一定不在返回值里**，从会话读也一样（见文件头第三节）。
     */
    getUserInfo: loadUserInfo,

    /**
     * 按关键字 / 部门搜人员候选。**只读**。
     *
     * 全公司 4225 人属于长选项参数（设计 D6 / H35）：**keyword 与 deptId 至少要给一个**，
     * 否则直接拒绝、**不发请求**。注意这不是后端的要求——后端无关键字也会返回 200（实测），
     * 拒绝是 SDK 侧为了不让 4225 条冲掉调用方上下文。
     */
    async searchUsers (query: {
      keyword?: string
      deptId?: number
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: SimpleUser[]; total: number }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim() : ''
      const hasDept = query?.deptId !== undefined && query?.deptId !== null
      if (keyword === '' && !hasDept) {
        return Promise.reject(
          new Error(
            '人员候选属于长选项参数：必须提供 keyword 或 deptId，不允许无条件下全量拉取（设计 D6 / H35）。' +
              '实测无关键字时 total = 4225（全公司），pageSize=-1 会吐回 577,845 B。' +
              '用户说不出完整名字时，先问他名字里的一两个字。',
          ),
        )
      }
      assertNotFullPull(query?.pageSize, '人员候选')
      const pageSize = clampLimit(
        query?.pageSize,
        USER_SEARCH_PAGE_SIZE_DEFAULT,
        USER_SEARCH_PAGE_SIZE_MAX,
      )
      const payload = await send<unknown>({
        url: USER_SIMPLE_PAGE_URL,
        method: 'get',
        params: {
          pageNo: Number.isFinite(Number(query?.pageNo)) && Number(query?.pageNo) > 0
            ? Math.trunc(Number(query?.pageNo))
            : 1,
          pageSize,
          ...(keyword === '' ? {} : { nickname: keyword }),
          ...(hasDept ? { deptId: Math.trunc(Number(query?.deptId)) } : {}),
        },
      })
      return normalizeSimpleUsers(payload)
    },

    /**
     * 查待办 / 已办事项。**只读**。
     *
     * `scope` 映射到后端的 `finished`（三态，见文件头第五节）：todo→1、done→2、all→**不发**。
     * `name` 是**服务端**过滤（后端 `taskNameLike`），不是本地筛。
     */
    async listTodos (query?: {
      scope?: TodoScope
      name?: string
      pageNo?: number
      pageSize?: number
    }): Promise<{ list: TodoItem[]; total: number; scope: TodoScope }> {
      const scope: TodoScope = query?.scope ?? 'todo'
      if (scope !== 'todo' && scope !== 'done' && scope !== 'all') {
        return Promise.reject(
          new Error(`scope 只能是 todo / done / all 之一，收到 ${JSON.stringify(query?.scope ?? null)}`),
        )
      }
      assertNotFullPull(query?.pageSize, '待办列表')
      const pageSize = clampLimit(query?.pageSize, TODO_PAGE_SIZE_DEFAULT, TODO_PAGE_SIZE_MAX)
      const name = typeof query?.name === 'string' ? query.name.trim() : ''

      const payload = await send<unknown>({
        url: BPM_TASK_URL,
        method: 'get',
        params: {
          pageNo: Number.isFinite(Number(query?.pageNo)) && Number(query?.pageNo) > 0
            ? Math.trunc(Number(query?.pageNo))
            : 1,
          pageSize,
          // scope='all' 时**不发** finished —— 发了就会落进"已办"那一支（源码实测）
          ...(scope === 'todo' ? { finished: BPM_FINISHED_TODO } : {}),
          ...(scope === 'done' ? { finished: BPM_FINISHED_DONE } : {}),
          ...(name === '' ? {} : { name }),
        },
      })
      return { ...normalizeTodos(payload), scope }
    },

    /**
     * 三个角标数一次读完。**只读**。
     *
     * 对齐 Portal 布局组件每次路由变化打的那三条（`app/portal/components/portal/layout/index.vue`）：
     * 待办数（`finished=1&pageSize=1` 的 `total`）、未读消息数、待审费用数。
     *
     * **失败不整体抛**：Portal 里待审费用那条是"侧边栏有那个菜单才打"的条件请求，
     * 失败时页面只是不显示角标。所以这里逐条捕获，失败的那项为 `null` 并记进 `failures`——
     * ⚠️ **`null` 不等于 0**，别把"没取到"读成"没有待办"。
     */
    async getTodoCounts (): Promise<{
      todo: number | null
      unreadMessages: number | null
      expensePending: number | null
      failures: Array<{ key: string; message: string }>
    }> {
      const failures: Array<{ key: string; message: string }> = []

      const guard = async <T>(key: string, run: () => Promise<T>): Promise<T | null> => {
        try {
          return await run()
        } catch (error) {
          failures.push({ key, message: error instanceof Error ? error.message : String(error) })
          return null
        }
      }

      const [todoPage, unread, expense] = await Promise.all([
        guard('todo', () =>
          send<unknown>({
            url: BPM_TASK_URL,
            method: 'get',
            params: { pageNo: 1, pageSize: 1, finished: BPM_FINISHED_TODO },
          }),
        ),
        guard('unreadMessages', () =>
          send<unknown>({ url: UNREAD_COUNT_URL, method: 'get' }),
        ),
        guard('expensePending', () =>
          send<unknown>({ url: EXPENSE_PENDING_URL, method: 'get' }),
        ),
      ])

      return {
        todo: todoPage === null ? null : normalizeTodos(todoPage).total,
        unreadMessages: unread === null ? null : asNumber(unread),
        expensePending: expense === null ? null : asNumber(expense),
        failures,
      }
    },

    /**
     * 取当前用户可见的菜单树。**只读**。
     *
     * 返回的树**结构上兼容** `src/catalog/visibility.ts` 的 `MenuNode`，
     * 可以直接 `createUserVisibility({ menuTree, source })` —— 那是本能力存在的首要理由。
     *
     * ⚠️ `truncated: true` 时**不要**拿它去做可见性判断：树被截断 = 会误判"这个页面不可见"。
     */
    async getMenuNav (query: { project: number; keyword?: string; maxNodes?: number }): Promise<{
      project: number
      tree: ShellMenuNode[]
      totalNodes: number
      returnedNodes: number
      truncated: boolean
    }> {
      const project = resolveProject(query?.project, 'getMenuNav')
      const keyword = typeof query?.keyword === 'string' && query.keyword.trim() !== ''
        ? query.keyword.trim().toLowerCase()
        : null
      const maxNodes = clampLimit(query?.maxNodes, MENU_MAX_NODES_DEFAULT, MENU_MAX_NODES_MAX)

      const full = await loadMenuTree(project)
      const totalNodes = countNodes(full)
      const filtered = keyword === null ? full : filterTree(full, keyword)
      // 走 `truncateTree` 而不是"放得下就原样返回"，是为了**永远交出新建的节点对象**：
      // 让调用方拿到缓存里那一份的话，它随手改一个 `node.name` 就把缓存污染了，
      // 而下一个调用方会拿到改过的数据 —— 那种错查起来极其费劲。多拷 57 个对象不贵。
      const result = truncateTree(filtered, { left: maxNodes })
      return {
        project,
        tree: result.tree,
        totalNodes,
        returnedNodes: countNodes(result.tree),
        truncated: result.truncated,
      }
    },

    /**
     * 把菜单树摊平成页面路径集合。**只读**。
     *
     * 返回的是**原始 `permissions` 值**里以 `/` 开头的那些（实测 project=2 有 36 条），
     * **不是** `collectVisiblePaths` 归一化之后的键。要做可见性求交请用 `getMenuNav`。
     */
    async listMenuPaths (query: { project: number; keyword?: string; limit?: number }): Promise<{
      paths: string[]
      total: number
      matched: number
    }> {
      const project = resolveProject(query?.project, 'listMenuPaths')
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim() : ''
      const limit = clampLimit(query?.limit, MENU_PATH_LIMIT_DEFAULT, MENU_PATH_LIMIT_MAX)

      const all = collectPaths(await loadMenuTree(project))
      const hit = keyword === ''
        ? all
        : all.filter((path) => path.includes(keyword))
      return { paths: hit.slice(0, limit), total: all.length, matched: hit.length }
    },

    /**
     * 取当前用户工作台上的卡片。**只读**。
     *
     * 卡片标识是 `hr/salary/my-payslip` 这种三段式，它表达的是"用户自己把什么摆在了首页"。
     * ⚠️ **它映射不到 `generated/page-catalog.json` 的 `menuPath`**（一个是 `hr/…`、
     * 一个是 `/dashboard/…`），本能力不做这个映射——见文件头第五节第 5 条的说明。
     */
    async listHomeWidgets (query?: { keyword?: string; limit?: number }): Promise<{
      widgets: HomeWidget[]
      total: number
      matched: number
      configured: boolean
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      const limit = clampLimit(query?.limit, HOME_WIDGET_LIMIT_DEFAULT, HOME_WIDGET_LIMIT_MAX)

      const parsed = await loadSlice(
        'home-widgets',
        () => send<unknown>({ url: HOME_PAGE_URL, method: 'get' }),
        (payload) => {
          const data = payload as { config?: unknown } | null
          if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            throw new BaseShellShapeError(
              `${HOME_PAGE_URL} 期望返回一个对象（含 config 字段），收到 ` +
                `${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}`,
            )
          }
          return parseHomeWidgets(data.config)
        },
      )

      const hit = keyword === ''
        ? parsed.widgets
        : parsed.widgets.filter(
            (item) =>
              item.widget.toLowerCase().includes(keyword) ||
              item.knownModules.some((module) => module.toLowerCase().includes(keyword)),
          )
      return {
        widgets: hit.slice(0, limit),
        total: parsed.widgets.length,
        matched: hit.length,
        configured: parsed.configured,
      }
    },
  }
}

export type BaseShellCapability = ReturnType<typeof createBaseShell>
