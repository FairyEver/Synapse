/**
 * 三个**基础只读数据**能力：部门 / 字典 / 权限清单。
 *
 * 它们与 `src/capabilities/` 下其它能力**不是一类东西**：别的能力都绑在一个页面上，
 * 这三个是**应用外壳**级的——Portal 的路由守卫（`app/portal/utils/router/session.js:35-59`
 * 的 `runLegacyFullInitTasks`）在**任何 dashboard 页面刷新**时都会打它们，与用户落在哪一页无关。
 * 用用户的话说：「它在 Portal 中是一个组件，那么它在这个 SDK 中就应该是一个基础能力」。
 *
 * | 能力 | 接口 | 实测（2026-09-20，测试环境，租户 1） |
 * | --- | --- | --- |
 * | `base-dept-*` | GET `/admin-api/system/dept/list-all-simple` | 1551 条 / 73,754 B / 475 ms |
 * | `base-dict-*` | GET `/admin-api/system/dict-data/grouped-list` | 885 dictType / 5985 条 / 1,063,746 B / 655 ms |
 * | `base-permission-*` | GET `/admin-api/sys/menu/permissionsNotBySystem` | 2159 条 / 87,117 B / 868 ms |
 *
 * 四件套的其它三件：参数契约在本文件的 `CAPABILITIES`；逐条实测与取舍 → `docs/base/部门与组织.md`、
 * `docs/base/字典.md`、`docs/base/权限清单.md`；真实环境只读冒烟 → `smoke/read-base-data.mjs`；
 * 回归测试 → `test/base-dept-dict-permission.test.ts`。
 *
 * ---------------------------------------------------------------------------------------
 * 一、体积：**只有「按需取一片」的入口，没有「全量倒出来」的入口**
 * ---------------------------------------------------------------------------------------
 *
 * 三个载荷加起来 1.2 MB：字典近 1 MB（`grouped-list` 一次首屏实测被打了 4 遍）、权限 87 KB、
 * 部门 73 KB。**任何一条都能冲掉调用方的上下文**——这与 conventions 第 11 条（长选项参数必须先要
 * 关键字）是同一个问题，只是这里"长"的不是候选项而是**整张表**。
 *
 * 所以每一个能力都只暴露**切片入口**，不暴露 `listAll()`：
 *
 * - 字典：`getDict(dictType)` 一次只取**一个** dictType 的选项（实测最大的 `hen_brand` 617 条）；
 *   `searchDictTypes(keyword)` 找名字（885 个 dictType 名是长选项，必须先要关键字）；
 *   `translate(dictType, value)` 只回答"这个码显示成什么"。
 * - 权限：`has(code)` / `check(codes)` 只回答"有没有"；`searchPermissions(keyword)` 按前缀或片段
 *   限量取（实测 `investment:` 前缀 17 条、`/dashboard/base/` 前缀 5 条）。
 * - 部门：`searchDepartments(keyword)`（1551 个节点是长选项，必须先要关键字）、
 *   `getDepartment(id)`（含上级路径）、`listDepartments(parentId)`（直接下级）。
 *
 * 每个入口都有硬上限（`*_MAX` 常量），**不是**可选的 `limit` 提示。
 *
 * 切几刀的理由：**按"一次调用能回答的那个问题"切**，而不是按"表有多大"切。
 * 一个 AI 问「作业类型有哪些」要的是 `assignment_type` 那 6 条，不是 885 个 dictType；
 * 问「我能不能进图库页」要的是一个布尔值，不是 2159 条码。把整表给它，
 * 它还得自己筛，而筛的代价（token）已经付过了。
 *
 * ---------------------------------------------------------------------------------------
 * 二、缓存：**能挂上 `src/session/` 的挂上去了，钩子在这一层留好了**
 * ---------------------------------------------------------------------------------------
 *
 * `src/session/base-data.ts` 的 `PORTAL_BASE_DATA_CAPABILITIES` 里**已经有字典**
 * （`dict-hr` 与 `dict-platform` 两个 key 指向同一个 `grouped-list`）。本文件因此**不新增
 * 字典的基础数据项**——再注册一个 key，只会让同一个 1.06 MB 在一次会话里被打第三遍
 * （Portal 自己已经打了 4 遍）。字典这一侧走的是**读已有的 key**：
 * `BASE_DICT_SESSION_KEYS = ['dict-hr', 'dict-platform']`。
 *
 * 部门与权限清单没有现成的 key，本文件把它们定义出来（`baseDeptPermissionBaseData`），
 * 接线方注册进注册表即可（`createPortalBaseDataRegistry().registerAll(...)`），
 * 两边共用同一份 `load`，不会分叉。
 *
 * 没挂会话时（单用户门面 `createPortalHeadless` 这一条路）：能力实例自己缓存**索引**
 * （`cacheTtlMs`，默认 30 分钟，与 `src/session/store.ts` 的 `DEFAULT_ABSOLUTE_TTL_MS` 同值，
 * 这样"挂不挂会话"行为一致；测试里注入假时钟，不用真实 sleep——conventions 第 22 条）。
 * 缓存作用域天然正确：**一个能力实例 = 一份请求函数 = 一个用户的一个租户**（conventions 第 5 条），
 * 所以不需要再拼 (user, tenant) 缓存键。
 *
 * 并发去重直接用 `src/session/single-flight.ts`：并发调用同一片数据只发一次真实请求
 * （这正是 Portal 打 4 遍的那个浪费，SDK 不照抄）。
 *
 * ---------------------------------------------------------------------------------------
 * 三、module-type：**三个都不发**，但依据各不相同（都实测过，见 docs/base/）
 * ---------------------------------------------------------------------------------------
 *
 * 浏览器侧的事实（源码直读 `app/portal/utils/system.js:825-833`）：这三个请求都走 `platform.js`，
 * 请求头里的 `module-type` 由 `getCurrentModuleType()`（读 cookie `menuPath` = **即将进入的页面**）
 * 兜底决定——**不是无条件加、不是这三条链路自己传**。所以"发不发"取决于落地页，
 * 而无头下没有落地页：`pagePath` 是合成的 `/base-data/*`，规则表里匹配不到任何前缀，解析结果是 `null`。
 *
 * 发不发这个头，三个接口的**实际后果**不同（后端源码直读 + 实测）：
 *
 * - **字典**：`DictDataController#getGroupedList` 不读这个头，Service 里也没有 `@DataPermission`，
 *   范围只由 `tenantId` 决定 → 实测带/不带都是 885 个 dictType，**完全无差别**。
 * - **权限清单**：`HrSysMenuController#permissionsNotBySystem` 不读这个头，范围由
 *   `superAdmin`/`tenantAdmin`/`tenantId`/`roleIdList` 决定 → 实测带/不带都是 2159 条，
 *   **完全无差别**。
 * - **部门**：`DeptController#getSimpleDeptList` 上有 `@DataPermission`，规则链
 *   （`OrganizationDataPermissionRule:108` → `HrPermissionServiceImpl.getOrganizationDataPermission`）
 *   会读 `LoginUser.getModuleType()`（由 `TokenAuthenticationFilter:276-280` 从请求头写进去）。
 *   **不带头 = 不按模块过滤 = 该用户全部模块数据权限的并集**，这正是 conventions 第 1 条说的"放大"。
 *   实测：这个账号带 `module-type: 11` 与不带，都是 **1551 条、id 集合完全一致**
 *   （该账号跨模块的组织范围一致）。但**这是实测结论，不是保证**——别的账号可能不同。
 *   需要收窄时由接线方在建能力时显式给 `moduleType`（见 `BaseDeptDictPermissionOptions.moduleType`），
 *   而不是由 SDK 猜一个。
 *
 * 顺带记一条**查到但没用到**的事实：`HrOrganizationReqVo` 里有一个 `moduleType` 字段，
 * 但它作为 **query 参数**（`?moduleType=11`）是**没用的**——`HrOrganizationMapper.selectList`
 * 完全不引用它。**只有请求头算数。** 所以这个能力不做"传个参数收窄范围"的假动作。
 *
 * ---------------------------------------------------------------------------------------
 * 四、已知坑（写进参数描述，免得调用方再踩）
 * ---------------------------------------------------------------------------------------
 *
 * - **`status` 是全平台共用的 dictType**，装的是交易状态（`WAIT_SELLER_CHECK` 这种），
 *   不是业务状态（`base-image.ts:270-282` 已经踩过）。基础能力**不替调用方猜 dictType 的含义**。
 * - **字典的 `value` 是字符串**（实测：5985 条里 value 全部是 JSON string，如 `"1"`；
 *   `id` 也全部是字符串）。所以要跟数字参数比对时记得 `String()`。
 * - **`label` 可能带前导空格**（实测 `assignment_type` 的「 图片+文字」就带）。
 *   本能力**原样返回、不 trim**——`assignment.ts:127` 那份硬编码快照是 trim 过的，
 *   于是与线上**不一致**（详见 `docs/base/字典.md`）。这是"快照会漂"的直接证据。
 * - **部门的根节点 `parentId` 是 `0`，不是 `null`**（实测 1551 条里没有一个是 null，
 *   也没有一个悬挂节点：每条要么指向存在的 id，要么是 0）。但向上取路径仍然带环检测与
 *   "父不存在就停"——**这是防御，不是实测需要**：组织表是全租户共用的，别的租户未必干净，
 *   而一个死循环比一条不完整的路径贵得多。
 */

import { SingleFlight } from '../session/single-flight.js'
import type { BaseDataCapability } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'

// ---------------------------------------------------------------------------
// 合成页面上下文
// ---------------------------------------------------------------------------

/**
 * 这三个能力**没有页面**，但 `CapabilityDefinition.pagePath` 是必填的，而且它有真实作用：
 * 它决定 module-type 与 http 实例的推导。所以给一组**合成路径**，取值只有一条规矩：
 *
 * 1. `resolveModuleType()` 必须返回 `null`（→ 不发 `module-type` 头）。
 *    规则表 27 条的 prefix **全部**以 `/dashboard/` 开头，`/base-data/**` 一条都匹配不到。
 * 2. `resolveHttpInstance()` 必须落到全局默认实例（`platform`）——三条链路在 Portal 里
 *    用的都是 `app/portal/utils/http/platform.js` 的 `http`（`system.js:19`），
 *    且 URL 已经带 `/admin-api`，所以"补前缀"那条拦截器不会介入。
 *
 * 用 `/base-data` 而不是 `/base`：`/dashboard/base/**` 在目录里已经是一个真实业务域
 * （图库管理、组织结构…），合成路径不该混进那个域里。
 */
export const BASE_DATA_CONTEXT_ROOT = '/base-data'

/**
 * ⚠️ 这三行**必须写成单引号字符串字面量**，不能写成模板串（`` `${BASE_DATA_CONTEXT_ROOT}/dept-list` ``）：
 * `tools/generate/derive-aliases.mjs:183` 用正则 `const\s+(\w+)\s*=\s*'([^']*)'` 收集路径常量，
 * **只认单引号**。写成模板串的话这三个路径解析为 null、9 条能力定义被**静默跳过**，
 * 于是「目录扫到的」与「应用真正加载的」就对不上了——那正是
 * `test/aliases-derived.test.ts` 的 `capabilityCount` 断言要卡住的分叉
 * （`src/capabilities/index.ts` 的文件头写着这条）。
 */
export const BASE_DEPT_LIST_PATH = '/base-data/dept-list'
export const BASE_DICT_LIST_PATH = '/base-data/dict-list'
export const BASE_PERMISSION_LIST_PATH = '/base-data/permission-list'

// ---------------------------------------------------------------------------
// 接口与基础数据键
// ---------------------------------------------------------------------------

export const DEPT_LIST_URL = '/admin-api/system/dept/list-all-simple'
export const DICT_GROUPED_URL = '/admin-api/system/dict-data/grouped-list'
export const PERMISSION_LIST_URL = '/admin-api/sys/menu/permissionsNotBySystem'

/** 本文件提供的基础数据键（接线方注册进注册表；两边共用同一个 load，不会分叉） */
export const BASE_DATA_KEYS = {
  dept: 'dept-list',
  permission: 'permission-list',
} as const

/**
 * 字典**不新增**基础数据键：`PORTAL_BASE_DATA_CAPABILITIES` 里 `dict-hr` 与 `dict-platform`
 * 已经指向同一个 `grouped-list`（`src/session/base-data.ts:132-144`），
 * 再注册一个只会让同一个 1.06 MB 在会话里被打第三遍。
 */
export const BASE_DICT_SESSION_KEYS = ['dict-hr', 'dict-platform'] as const

/** 部门的根：**实测 `parentId` 是 0，不是 null**（1551 条里一个 null 都没有） */
export const DEPT_ROOT_PARENT_ID = 0

/**
 * 未挂会话时，能力实例内索引的存活时间。
 *
 * 取 30 分钟是为了与 `src/session/store.ts` 的 `DEFAULT_ABSOLUTE_TTL_MS` **同值**：
 * 挂不挂会话，行为一致。两边一旦漂开，`test/base-dept-dict-permission.test.ts` 会红。
 */
export const BASE_DATA_CACHE_TTL_MS = 30 * 60 * 1000

// 每个入口的硬上限。上限存在的理由见文件头「体积」一节：一次调用不能把整张表倒出来。
export const DEPT_SEARCH_DEFAULT = 20
export const DEPT_SEARCH_MAX = 50
export const DEPT_CHILDREN_DEFAULT = 50
export const DEPT_CHILDREN_MAX = 200
export const DICT_TYPE_SEARCH_DEFAULT = 20
export const DICT_TYPE_SEARCH_MAX = 50
export const PERMISSION_SEARCH_DEFAULT = 50
export const PERMISSION_SEARCH_MAX = 200

// ---------------------------------------------------------------------------
// 基础数据项（给 src/session 用；接线方注册）
// ---------------------------------------------------------------------------

/**
 * 部门与权限清单的会话级基础数据项。
 *
 * 字典**不在**这里（见 `BASE_DICT_SESSION_KEYS` 的说明）。
 * 两项都是 `critical: false`（对齐 Portal：字典这类数据失败是 `softFetch*` 降级，不是整份会话作废），
 * `onlySimpleForm: true` 与同族项保持一致。
 */
export const baseDeptPermissionBaseData: readonly BaseDataCapability[] = [
  {
    key: BASE_DATA_KEYS.dept,
    label: '部门（扁平）',
    onlySimpleForm: true,
    // 浏览器在唯一调用点上发的是 ?pageNo=-1&pageSize=-1&isCorporation=1（那是"公司"下拉框，
    // 不是全部部门）。基础能力要的是**全量表**，所以一个参数都不发 —— 实测把那三个参数发出去
    // 得到的是子集（详见 docs/base/部门与组织.md）。
    load: ({ request }) => request({ url: DEPT_LIST_URL, method: 'get' }),
  },
  {
    key: BASE_DATA_KEYS.permission,
    label: '权限码清单',
    onlySimpleForm: true,
    load: ({ request }) => request({ url: PERMISSION_LIST_URL, method: 'get' }),
  },
]

// ---------------------------------------------------------------------------
// 归一化后的形状
// ---------------------------------------------------------------------------

export type DeptNode = {
  id: number
  name: string
  /** 上级 id；**根是 0**（实测），不是 null */
  parentId: number
}

/** 字典条目。`value` / `id` 的 JSON 类型**原样保留**（实测全部是 string，但不做强制转换） */
export type DictEntry = {
  label: string
  value: string | number
  id: string | number
}

export type DeptPathNode = { id: number; name: string }

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const DEPT_PARAMS: Record<string, ParamSpec> = {
  keyword: {
    name: 'keyword',
    kind: 'search',
    required: true,
    description:
      '部门名称关键字。候选是**全量 1551 个节点**（实测），属于长选项参数，不允许无关键字全量拉取（设计 D6 / H35）',
  },
  limit: {
    name: 'limit',
    kind: 'number',
    required: false,
    description: `最多返回几条，默认 ${DEPT_SEARCH_DEFAULT}，上限 ${DEPT_SEARCH_MAX}`,
  },
}

const DICT_TYPE_LOOKUP = { capabilityId: 'base-dict-search', keywordParam: 'keyword' } as const
const DEPT_LOOKUP = { capabilityId: 'base-dept-search', keywordParam: 'keyword' } as const

export const baseDeptDictPermissionCapabilities: CapabilityDefinition[] = [
  // ---- 部门（扁平，1551 个节点） ----
  {
    id: 'base-dept-search',
    title: '按名称关键字搜部门候选（基础数据，全量 1551 个节点）',
    pagePath: BASE_DEPT_LIST_PATH,
    write: false,
    params: [DEPT_PARAMS.keyword!, DEPT_PARAMS.limit!],
  },
  {
    id: 'base-dept-get',
    title: '按 id 取一个部门（含从根到它的路径）（基础数据）',
    pagePath: BASE_DEPT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'search',
        required: true,
        description:
          '部门 id。候选一千多个，**先问用户关键字**再调 base-dept-search 拿候选，不要猜 id',
        lookup: DEPT_LOOKUP,
      },
    ],
  },
  {
    id: 'base-dept-children',
    title: '取某个部门的直接下级（基础数据）',
    pagePath: BASE_DEPT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'parentId',
        kind: 'search',
        required: true,
        description:
          `上级部门 id。传 ${DEPT_ROOT_PARENT_ID} 取根节点（实测根的 parentId 就是 0，不是 null）。` +
          '候选同样要走 base-dept-search',
        lookup: DEPT_LOOKUP,
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${DEPT_CHILDREN_DEFAULT}，上限 ${DEPT_CHILDREN_MAX}（实测单个父节点最多 18 个下级）`,
      },
    ],
  },

  // ---- 字典（885 个 dictType / 5985 条 / 近 1 MB） ----
  {
    id: 'base-dict-get',
    title: '按 dictType 取一个字典的全部选项（基础数据）',
    pagePath: BASE_DICT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'dictType',
        kind: 'search',
        required: true,
        description:
          '字典类型名（如 `assignment_type`）。共 885 个，**不要猜**：先调 base-dict-search 用关键字找名字。' +
          '⚠️ 有些 dictType 是全平台共用的（`status` 装的是交易状态），本能力不替调用方解释 dictType 的含义',
        lookup: DICT_TYPE_LOOKUP,
      },
    ],
  },
  {
    id: 'base-dict-search',
    title: '按关键字搜 dictType 名（基础数据，885 个候选）',
    pagePath: BASE_DICT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          'dictType 名的一部分（不区分大小写）。候选 885 个，属于长选项参数，必须先给关键字（设计 D6 / H35）',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几个，默认 ${DICT_TYPE_SEARCH_DEFAULT}，上限 ${DICT_TYPE_SEARCH_MAX}`,
      },
    ],
  },
  {
    id: 'base-dict-translate',
    title: '把一个字典值翻成它的显示名（基础数据）',
    pagePath: BASE_DICT_LIST_PATH,
    write: false,
    params: [
      {
        name: 'dictType',
        kind: 'search',
        required: true,
        description: '字典类型名。先用 base-dict-search 找',
        lookup: DICT_TYPE_LOOKUP,
      },
      {
        name: 'value',
        kind: 'text',
        required: true,
        description:
          '字典值。线上返回的 value 是**字符串**（实测 5985 条全部是 string），这里比对时做了 String() 归一，传 1 或 "1" 都能命中',
      },
    ],
  },

  // ---- 权限清单（2159 条 / 87 KB） ----
  {
    id: 'base-permission-has',
    title: '查这个用户有没有某个权限码（基础数据）',
    pagePath: BASE_PERMISSION_LIST_PATH,
    write: false,
    params: [
      {
        name: 'code',
        kind: 'text',
        required: true,
        description:
          '权限码，精确匹配。两种形态：页面路径码（`/dashboard/assignment/assignment`）与动作码' +
          '（`investment:daily:account:export`）。⚠️ **不在清单里不等于会 403**，见 docs/base/权限清单.md',
      },
    ],
  },
  {
    id: 'base-permission-check',
    title: '批量查权限码（基础数据）',
    pagePath: BASE_PERMISSION_LIST_PATH,
    write: false,
    params: [
      {
        name: 'codes',
        kind: 'text',
        required: true,
        description:
          '多个权限码，用英文逗号分隔（也接受数组）。逐条精确匹配，返回 granted / missing 两份',
      },
    ],
  },
  {
    id: 'base-permission-search',
    title: '按关键字或前缀搜权限码（基础数据，2159 条）',
    pagePath: BASE_PERMISSION_LIST_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '要匹配的片段（不区分大小写）。**前缀查询就是传前缀**：`investment:`、`/dashboard/base/`、`supply:supplier:`',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${PERMISSION_SEARCH_DEFAULT}，上限 ${PERMISSION_SEARCH_MAX}`,
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

/** 由接线方注入的请求函数：签名与 `PortalRequest` 对齐，多一个 `moduleType` 覆盖口 */
export type BaseDataRequest = <T>(config: {
  url: string
  method: 'get'
  params?: unknown
  /** 覆盖本能力的 module-type。默认不发（见文件头第三节） */
  moduleType?: number
}) => Promise<T>

/**
 * 会话基础数据的只读视图。`PortalSession` 结构上就满足它（`has` / `get`），
 * 所以接线方直接把 `session` 传进来即可，不需要适配层。
 */
export type SessionBaseDataReader = {
  has: (key: string) => boolean
  get: (key: string) => unknown
}

export type BaseDeptDictPermissionOptions = {
  request: BaseDataRequest
  /** 可选：会话。传了就优先读会话基础数据（同一份 1 MB 不再打第二遍） */
  session?: SessionBaseDataReader | null
  /**
   * 这三个接口在浏览器里带的 `module-type` 来自**当前落地路由**；无头下没有落地页，默认不发。
   * 只有**部门**会因此受影响（后端 `@DataPermission` 会读这个头，不传 = 取全部模块的并集），
   * 字典与权限清单后端根本不读它（实测两个方向结果完全相同）。
   * 需要在某个模块口径下收窄部门范围时，由接线方在这里显式指定 —— SDK 不猜。
   */
  moduleType?: number
  /** 未挂会话时，实例内索引的 TTL。默认 `BASE_DATA_CACHE_TTL_MS`（30 分钟） */
  cacheTtlMs?: number
  /** 注入时钟，测试用（conventions 第 22 条：TTL 不用真实 sleep 测） */
  now?: () => number
}

/** 形状不认识时抛它：这是接线 bug（会话里那份值的形状与约定不符），不是数据问题 */
export class BaseDataShapeError extends Error {
  override readonly name = 'BaseDataShapeError'
  constructor (message: string) {
    super(message)
  }
}

type CachedIndex = { source: unknown; index: unknown; at: number }

function clampLimit (value: number | undefined, fallback: number, max: number): number {
  const raw = value === undefined || value === null ? fallback : Math.trunc(Number(value))
  if (!Number.isFinite(raw)) return fallback
  return Math.min(Math.max(1, raw), max)
}

/** 部门扁平列表 → 索引。`parentId` 缺失/非数字时归到根（0） */
function buildDeptIndex (payload: unknown): DeptNode[] {
  if (!Array.isArray(payload)) {
    throw new BaseDataShapeError(
      `部门数据不是数组（收到 ${payload === null ? 'null' : typeof payload}）：${DEPT_LIST_URL} 期望 [{id,name,parentId}]`,
    )
  }
  const list: DeptNode[] = []
  for (const raw of payload) {
    const node = raw as { id?: unknown; name?: unknown; parentId?: unknown } | null
    const id = Number(node?.id)
    if (!Number.isFinite(id)) continue
    const parentId = Number(node?.parentId)
    list.push({
      id,
      name: String(node?.name ?? ''),
      parentId: Number.isFinite(parentId) ? parentId : DEPT_ROOT_PARENT_ID,
    })
  }
  return list
}

/** 字典载荷 → 索引。两种来源形态都收敛到这里：HTTP 原始 `[{dictType,dataList}]` 与
 *  会话里 `dict-hr`/`dict-platform` 的 `{dictType: [entry]}` */
function buildDictIndex (payload: unknown): Map<string, DictEntry[]> {
  const byType = new Map<string, DictEntry[]>()

  const push = (dictType: unknown, dataList: unknown): void => {
    if (typeof dictType !== 'string' || dictType === '') return
    if (!Array.isArray(dataList)) return
    byType.set(
      dictType,
      dataList.map((raw) => {
        const entry = raw as { label?: unknown; value?: unknown; id?: unknown } | null
        return {
          label: String(entry?.label ?? ''),
          value: entry?.value as string | number,
          id: entry?.id as string | number,
        }
      }),
    )
  }

  if (Array.isArray(payload)) {
    for (const group of payload) {
      const item = group as { dictType?: unknown; dataList?: unknown } | null
      push(item?.dictType, item?.dataList)
    }
    return byType
  }

  if (payload !== null && typeof payload === 'object') {
    for (const [dictType, dataList] of Object.entries(payload as Record<string, unknown>)) {
      push(dictType, dataList)
    }
    return byType
  }

  throw new BaseDataShapeError(
    `字典数据的形状不认识（收到 ${payload === null ? 'null' : typeof payload}）：` +
      `期望 ${DICT_GROUPED_URL} 的 [{dictType,dataList}]，或会话里 dict-hr/dict-platform 的 {dictType:[entry]}`,
  )
}

/** 权限载荷 → 索引。会话里与 HTTP 原始都是纯字符串数组 */
function buildPermissionIndex (payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new BaseDataShapeError(
      `权限清单不是数组（收到 ${payload === null ? 'null' : typeof payload}）：${PERMISSION_LIST_URL} 期望 string[]`,
    )
  }
  return payload.filter((code): code is string => typeof code === 'string')
}

/**
 * 造三个能力的实现。
 *
 * 接线方（`src/index.ts` / `src/server.ts`）按各自的门面形态注入请求函数：
 * 单用户传 `(config) => call(BASE_DEPT_LIST_PATH, config)`，多用户传这一份会话的 `call`。
 */
export function createBaseDeptDictPermission (options: BaseDeptDictPermissionOptions) {
  const { request, session } = options
  const ttlMs = options.cacheTtlMs ?? BASE_DATA_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const moduleType = options.moduleType

  const slices = new Map<string, CachedIndex>()
  const flight = new SingleFlight<unknown>()
  let cacheGeneration = 0

  /** 统一把 moduleType 注入请求（默认不发；只有接线方显式给了才带） */
  const send = <T>(config: { url: string; method: 'get'; params?: unknown }): Promise<T> =>
    request<T>(moduleType === undefined ? config : { ...config, moduleType })

  /** 读会话里的一份基础数据；没有（或没接会话）时返回 undefined */
  function fromSession (keys: readonly string[]): unknown {
    if (!session) return undefined
    for (const key of keys) {
      if (session.has(key)) return session.get(key)
    }
    return undefined
  }

  /**
   * 取一片数据的索引。
   *
   * 命中缓存（且未过期）时**一次请求都不发**；并发时由单飞合并成一次。
   * `source` 引用相同就复用已建好的索引 —— 这样挂了会话时，885 个 dictType 的索引只建一次，
   * 而不是每次 `getDict` 都重扫 5985 条。
   */
  async function loadIndex<T> (
    sliceKey: string,
    sessionKeys: readonly string[],
    fetchPayload: () => Promise<unknown>,
    build: (payload: unknown) => T,
  ): Promise<T> {
    const hit = slices.get(sliceKey)
    if (hit && now() - hit.at < ttlMs) {
      return hit.index as T
    }

    const generation = cacheGeneration
    const source = await flight.run(sliceKey, async () => {
      const cached = fromSession(sessionKeys)
      return cached === undefined ? await fetchPayload() : cached
    })

    if (hit && hit.source === source) {
      // 载荷没变（会话里那份还是同一次加载的结果）：只续期，不重建索引
      hit.at = now()
      return hit.index as T
    }

    const index = build(source)
    if (generation === cacheGeneration) {
      slices.set(sliceKey, { source, index, at: now() })
    }
    return index
  }

  const deptIndex = (): Promise<DeptNode[]> =>
    loadIndex(
      'dept',
      [BASE_DATA_KEYS.dept],
      () => send<unknown>({ url: DEPT_LIST_URL, method: 'get' }),
      buildDeptIndex,
    )

  const dictIndex = (): Promise<Map<string, DictEntry[]>> =>
    loadIndex(
      'dict',
      BASE_DICT_SESSION_KEYS,
      () => send<unknown>({ url: DICT_GROUPED_URL, method: 'get' }),
      buildDictIndex,
    )

  const permissionIndex = (): Promise<string[]> =>
    loadIndex(
      'permission',
      [BASE_DATA_KEYS.permission],
      () => send<unknown>({ url: PERMISSION_LIST_URL, method: 'get' }),
      buildPermissionIndex,
    )

  /**
   * 取一个 dictType 的全部选项。只读。
   *
   * `dictType` 存在但一条都没有时返回空数组；**dictType 写错则报错**——
   * 885 个名字猜不得，静默返回 `[]` 会让"名字写错了"看起来像"这个字典是空的"。
   *
   * （写成命名函数而不是对象方法，是为了让 `translateDict` 直接调它——
   * 用 `this` 的话一解构就废，那是很难查的运行时错误。）
   */
  const getDict = async (dictType: string): Promise<{ dictType: string; entries: DictEntry[] }> => {
    const wanted = typeof dictType === 'string' ? dictType.trim() : ''
    if (wanted === '') {
      throw new Error('dictType 必填。先用 base-dict-search 按关键字找名字')
    }
    const byType = await dictIndex()
    const entries = byType.get(wanted)
    if (entries === undefined) {
      throw new Error(
        `dictType「${wanted}」不存在（共 ${byType.size} 个）。` +
          '先用 base-dict-search 按关键字查名字，不要猜——有些名字是全平台共用的，猜错会拿到别的业务的选项。',
      )
    }
    return { dictType: wanted, entries }
  }

  return {
    /** 丢掉实例内缓存。写操作污染了基础数据、或要强制拿最新时用 */
    invalidate (slice?: 'dept' | 'dict' | 'permission'): void {
      cacheGeneration += 1
      if (slice === undefined) {
        slices.clear()
        flight.clear()
        return
      }
      slices.delete(slice)
      flight.forget(slice)
    },

    /**
     * 按名称关键字搜部门候选。**只读**。
     *
     * 1551 个节点属于长选项参数（设计 D6 / H35）：无关键字直接拒绝，不发请求。
     */
    async searchDepartments (query: { keyword: string; limit?: number }): Promise<{
      list: DeptNode[]
      total: number
      matched: number
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            '部门是长选项参数：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。' +
              '用户说不出完整名字时，先问他名字里的一两个字。',
          ),
        )
      }
      const list = await deptIndex()
      const hit = list.filter((node) => node.name.includes(keyword))
      const limit = clampLimit(query.limit, DEPT_SEARCH_DEFAULT, DEPT_SEARCH_MAX)
      return { list: hit.slice(0, limit), total: list.length, matched: hit.length }
    },

    /**
     * 按 id 取一个部门，并给出**从根到它的路径**。只读。
     *
     * 向上走用 `byId` 做 O(1) 查找，遇到"父不存在"或成环就停下 ——
     * 本租户实测 1551 条是干净的（没有悬挂节点），这两道防御是给别的数据留的（见文件头）。
     */
    async getDepartment (id: number): Promise<{
      id: number
      name: string
      parentId: number
      path: DeptPathNode[]
      pathNames: string
    }> {
      const wanted = Number(id)
      if (!Number.isFinite(wanted)) {
        return Promise.reject(new Error(`部门 id 必须是数字，收到的是 ${JSON.stringify(id ?? null)}`))
      }
      const list = await deptIndex()
      const byId = new Map(list.map((node) => [node.id, node]))
      const node = byId.get(wanted)
      if (node === undefined) {
        return Promise.reject(
          new Error(
            `部门 ${wanted} 不存在（共 ${list.length} 个节点）。` +
              'id 先用 base-dept-search 按名字查，不要猜。',
          ),
        )
      }

      const path: DeptNode[] = []
      const seen = new Set<number>()
      let cursor: DeptNode | undefined = node
      while (cursor !== undefined && !seen.has(cursor.id)) {
        seen.add(cursor.id)
        path.unshift(cursor)
        cursor = cursor.parentId === DEPT_ROOT_PARENT_ID ? undefined : byId.get(cursor.parentId)
      }

      return {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        path: path.map((item) => ({ id: item.id, name: item.name })),
        pathNames: path.map((item) => item.name).join('/'),
      }
    },

    /** 取某个部门的直接下级。`parentId` 传 0 取根节点。只读 */
    async listDepartments (query: { parentId: number; limit?: number }): Promise<{
      list: DeptNode[]
      total: number
    }> {
      const parentId = Number(query?.parentId)
      if (!Number.isFinite(parentId)) {
        return Promise.reject(
          new Error(`parentId 必须是数字（根节点传 ${DEPT_ROOT_PARENT_ID}），收到的是 ${JSON.stringify(query?.parentId ?? null)}`),
        )
      }
      const list = await deptIndex()
      const children = list.filter((node) => node.parentId === parentId)
      const limit = clampLimit(query.limit, DEPT_CHILDREN_DEFAULT, DEPT_CHILDREN_MAX)
      return { list: children.slice(0, limit), total: children.length }
    },

    /** 取一个 dictType 的全部选项。只读。见上面 `getDict` 的说明 */
    getDict,

    /** 按关键字搜 dictType 名（不区分大小写）。885 个候选属于长选项，必须给关键字。只读 */
    async searchDictTypes (query: { keyword: string; limit?: number }): Promise<{
      list: Array<{ dictType: string; entryCount: number }>
      total: number
      matched: number
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            'dictType 候选有 885 个：必须提供 keyword，不允许无条件下全量拉取（设计 D6 / H35）。' +
              '用户说不出完整名字时，先问他名字里的一两个字。',
          ),
        )
      }
      const byType = await dictIndex()
      const hit = [...byType.entries()]
        .filter(([dictType]) => dictType.toLowerCase().includes(keyword))
        .map(([dictType, entries]) => ({ dictType, entryCount: entries.length }))
      const limit = clampLimit(query.limit, DICT_TYPE_SEARCH_DEFAULT, DICT_TYPE_SEARCH_MAX)
      return { list: hit.slice(0, limit), total: byType.size, matched: hit.length }
    },

    /**
     * 把一个字典值翻成显示名。只读。
     *
     * 值比对做 `String()` 归一：线上 value 是字符串，调用方手里可能是数字。
     * 找不到时 `label` 为 null（**不抛错**）：查一个不存在的码是正常情况，
     * 不像 dictType 写错那样一定是调用方错了。
     */
    async translateDict (query: { dictType: string; value: string | number }): Promise<{
      dictType: string
      value: string | number
      label: string | null
      found: boolean
    }> {
      const { entries } = await getDict(query?.dictType)
      const wanted = String(query?.value)
      const hit = entries.find((entry) => String(entry.value) === wanted)
      return {
        dictType: query?.dictType,
        value: query?.value,
        label: hit === undefined ? null : hit.label,
        found: hit !== undefined,
      }
    },

    /** 精确查一个权限码。只读 */
    async hasPermission (code: string): Promise<boolean> {
      const wanted = typeof code === 'string' ? code.trim() : ''
      if (wanted === '') {
        return Promise.reject(new Error('code 必填（权限码，如 /dashboard/assignment/assignment）'))
      }
      const codes = await permissionIndex()
      return codes.includes(wanted)
    },

    /**
     * 批量查权限码：返回 granted / missing 两份。只读。
     *
     * `codes` 接受数组，或英文逗号 / 换行分隔的字符串（`ParamSpec` 里没有数组类型，
     * 所以 `invoke` 那条路上它长得像 text）。
     */
    async checkPermissions (codes: string[] | string): Promise<{
      granted: string[]
      missing: string[]
      checked: number
    }> {
      const wanted = (Array.isArray(codes) ? codes : String(codes ?? '').split(/[,\n]/))
        .map((code) => String(code).trim())
        .filter((code) => code !== '')
      if (wanted.length === 0) {
        return Promise.reject(new Error('codes 必填（权限码数组，或逗号分隔的字符串）'))
      }
      const grantedSet = new Set(await permissionIndex())
      const granted: string[] = []
      const missing: string[] = []
      for (const code of new Set(wanted)) {
        ;(grantedSet.has(code) ? granted : missing).push(code)
      }
      return { granted, missing, checked: granted.length + missing.length }
    },

    /** 按关键字 / 前缀搜权限码（不区分大小写，`includes` 匹配）。只读 */
    async searchPermissions (query: { keyword: string; limit?: number }): Promise<{
      list: string[]
      total: number
      matched: number
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            '权限码有 2159 条：必须提供 keyword（前缀查询就是传前缀，如 investment:），' +
              '不允许无条件下全量拉取（设计 D6 / H35）。',
          ),
        )
      }
      const codes = await permissionIndex()
      const hit = codes.filter((code) => code.toLowerCase().includes(keyword))
      const limit = clampLimit(query.limit, PERMISSION_SEARCH_DEFAULT, PERMISSION_SEARCH_MAX)
      return { list: hit.slice(0, limit), total: codes.length, matched: hit.length }
    },
  }
}

export type BaseDeptDictPermissionCapability = ReturnType<typeof createBaseDeptDictPermission>
