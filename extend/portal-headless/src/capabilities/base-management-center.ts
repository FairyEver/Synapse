import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 组织结构（一级组织）—— 教育 `base` 域的**第三个页面**，也是这个域里第二个
 * 带完整增删改的页面（第一个是图库管理）。
 *
 * 页面：`/dashboard/base/management-center/list`（`generated/page-catalog.json` 里 id `e6784f`，
 * domain `base`，权限码 `/dashboard/base/management-center`，moduleType 12 学习管理）
 * 路由文件：`app/portal/views/dashboard/education/base/management-center/list.vue`
 * 表单页：同目录的 `[mode]/[id].vue`
 * 逐字段基准：`baseline/base-management-center.browser.json`（读 4 条 + 写 5 条，全是实测）
 * 四件套记录：`docs/pages/组织结构.md`
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /study/base/studymanagementcenter/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /study/base/studymanagementcenter/{id}` | `[mode]/[id].vue` 的 `customLoad` |
 * | 新建 | `POST /study/base/studymanagementcenter` | 同上 `customSubmit`（`isCreateMode`） |
 * | 修改 | `PUT /study/base/studymanagementcenter` | 同上（非 create 分支） |
 * | 改状态（预检） | `PUT /study/base/studymanagementcenter/updateStatus` | `list.vue` 的 `actionStatus` |
 * | 改状态（真写） | `PUT /study/base/studymanagementcenter`，body `{id, status}` | 同上 `fetch()` |
 * | 删除 | `DELETE /study/base/studymanagementcenter`，body `[id]` | `list.js:517` 的 `deleteIsBatch` 分支 |
 *
 * ## 这一页的名字叫「组织结构」，但它在后端是 `study_management_center`（一级组织）
 *
 * 菜单标题是「组织结构」，路由是 `/dashboard/base/management-center/*`，而后端表叫
 * `hr_study_management_center`、接口路径是 `/study/base/studymanagementcenter`。
 * 三个名字指同一个东西。**它不是 hr 域那棵组织树**（`/org/**` 那套），
 * 而是教育模块自己的一级组织（下面挂「班级」`hr_study_grade`）。
 *
 * ## 没有 `prepare`；但有一个**真的只读预检**，它不叫 `prepare` 也不叫 `submit`
 *
 * `updateStatus` 这个接口名字骗人：它**一个字段都不写**（后端
 * `StudyManagementCenterServiceImpl.updateStatus` 只查了一次 `study_grade`），
 * 它是页面在真正禁用**之前**问后端一句「这个一级组织下面有班级吗」。
 * 所以它在本 SDK 里是 `write: false` 的 `base-management-center-check-status`，
 * 而不是写链路的一步。写链路是：
 *
 * ```text
 * check-status（可选，只读预检）→ get → create/update/set-status → remove
 * ```
 *
 * ## 三条**必须知道**的后端语义（都会以不显眼的方式出事）
 *
 * ### ① 列表是**跨创建人**的
 *
 * `pageInfo` 里有一行 `dto.setCreator(user.getId())`，但自定义 SQL
 * （`StudyManagementCenterDao.xml` 的 `getManagementPage`）**根本没用 creator**，
 * 也没有数据范围条件（`@DataScope` 在 ServiceImpl 里被注释掉了）。
 * 实测：`name=` 空查询返回 19 条，创建人是徐曼 / 王璐 / 管理员 / 姚淼鑫各种都有。
 * ⇒ 想找「我建的」只能靠名字，`creator` 既不是查询条件、也不是过滤条件。
 * ⇒ 反过来：**这一页上新建的任何记录，所有人都会看到**，测试数据必须清理。
 *
 * ### ② `commander` 为 null 的记录会让**整个列表页 500**
 *
 * `pageInfo` 里这一行没有做 null 判断：
 *
 * ```java
 * studyManagementCenterDTO.setCommanderName(
 *     nameMap.get(studyManagementCenterDTO.getCommander().toString()));
 * ```
 *
 * `commander` 是 `Long`，为 null 时 `.toString()` 直接 NPE，而这个 NPE 发生在**遍历结果集**
 * 的时候，所以**只要库里存在一条 commander 为 null 的行，这页面对所有人都打不开**。
 * 后端 `saveInfo` 对 commander 一条校验注解都没有（DTO 上完全没有校验注解），
 * 所以「新建时不给负责人」这条路在后端是**通的**，代价是别人的列表页挂掉。
 *
 * ⇒ 本 SDK 的 `create` **强制要求 `commander`**，理由不是"页面要求"（那是次要的），
 * 而是**不这么拦就会把共享环境的列表页弄挂**。
 * ⚠️ 这一条是**源码级结论，没有实测**：验证它要先制造一条 null commander 的数据，
 * 而那条数据存在期间所有人的列表页都是 500。**没测**，如实记在这里，
 * 所以 SDK 选了失败关闭那一侧（宁可少一个能力，不要制造这种数据）。
 *
 * ### ③ `update` 里改 `commander` 会**给那个员工开账号并授 SUPER_ADMIN**
 *
 * `updateInfo` 里有：
 *
 * ```java
 * if (dto.getCommander() != null) {
 *     hrUserApi.createUser(dto.getCommander(), Global.SUPER_ADMIN);
 * }
 * ```
 *
 * 而 `create` 那条路径上同样的调用是**被注释掉的**（`//sysUserService.createUser(...)`）。
 *
 * ⇒ 本 SDK 的 `update` **不接受 `commander`**（只有 `name`），见 `update` 上的说明。
 * 这一条也不能在测试环境里验：它会去改一个真实员工的账号与角色，越过了
 * 「只碰自己创建的测试数据」这条线。
 *
 * ## `remove` 是**逻辑删除**，而且**会被下属班级挡住**（实测）
 *
 * 删完 `list` 查不到，但 `get(id)` **仍然返回这一整行**，只是 `isDel` 从 0 变成 1。
 * 所以"删干净了没有"**只能看列表**。
 *
 * 另一条（源码级）：`StudyManagementCenterController.delete` 先查
 * `study_grade` 里有没有 `management_center_id` 指向它、且 `status == 1` 的班级，
 * 有就返回业务错误「本组织结构下设有已启用班级，不可删除，请先删除班级」，**一条都不删**。
 * 注意 `selectByManagementId` 的 SQL **没有 `is_del` 条件**，
 * 所以被逻辑删除但 status 还是 1 的班级**同样会挡住删除**。
 */

export const BASE_MANAGEMENT_CENTER_PAGE_PATH = '/dashboard/base/management-center/list'

/** 该页的权限码（`generated/page-catalog.json` 的 `permission`，与菜单树同源） */
export const BASE_MANAGEMENT_CENTER_PERMISSION = '/dashboard/base/management-center'

/**
 * 该页的 module-type。
 *
 * `resolveModuleType('/dashboard/base/management-center/list')` → 12 学习管理，
 * 命中 `app/portal/menus/index.js:189` 的第一条前缀规则 `/dashboard/base/`。
 * 浏览器在**正常导航进入本页后的第一个请求**上实发 `module-type: 12`，两边闭合。
 *
 * ⚠️ 与作业管理 / 图库管理同一个坑：这个头读的是 cookie `hr-0.0.0-menuPath`，而那个
 * cookie 是**浏览器 profile 全局**的。本轮抓基准时三次抓到三种值——12（正常）、
 * 11（并行会话跳到别处）、完全不发（cookie 被写成 `/`，实测读到 `hr-0.0.0-menuPath=/`）。
 * SDK 按页面路径推导，给出的恰好是「单标签页正常导航」下的值（conventions 第 1 条）。
 */
export const BASE_MANAGEMENT_CENTER_MODULE_TYPE = 12

/**
 * 记录 id 归一成**字符串**。
 *
 * 依据（两侧实测）：`GET /{id}` 的响应体里 `"id":"36"`（后端把 Long 序列化成字符串），
 * 浏览器回传的 PUT body 也是 `"36"`、DELETE body 也是 `["36"]`。
 * 唯一一处是数字的地方是 GET 的 URL 路径（`/studymanagementcenter/36`），
 * 而那是模板串拼出来的，字符串化之后拼出来一模一样。
 */
function normalizeId (id: string | number): string {
  const value = typeof id === 'number' ? String(id) : id.trim()
  if (value === '') {
    throw new Error('组织结构 id 不能为空')
  }
  return value
}

/** 状态只接受 0/1（后端那两个值），别的值当场拦住而不是把 400 丢出去 */
function normalizeStatus (status: unknown): 0 | 1 {
  if (status !== 0 && status !== 1) {
    throw new Error(`启用状态只能是 1（启用）或 0（禁用），收到的是 ${JSON.stringify(status)}`)
  }
  return status
}

/**
 * 名称的长度上限：页面表单规则 `max: 10`（`[mode]/[id].vue` 的 `rules.name`）。
 *
 * **实测的代价**：第一次用 `SDK-TEST-BMC-A`（14 字）点保存，页面红字报「最多 10 个字符」，
 * 请求根本没发出去（基准里没有那条 POST）；换成 10 字的 `SDK-TEST-A` 才发出来。
 *
 * ⚠️ 这条**只是页面的规则**，后端 DTO 上一条校验注解都没有（`ValidatorUtils.validateEntity`
 * 拦不住）。SDK 跟着页面走：页面上做不到的事，SDK 也不替后端"放开"。
 * 但要知道它的副作用：**10 字上限让「唯一名字」很紧张**（`SDK-TEST-` 前缀就用掉 9 个字符）。
 */
export const MANAGEMENT_CENTER_NAME_MAX_LENGTH = 10

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: '' },
  { name: 'status', defaultValue: '' },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

export type ManagementCenterRow = {
  /** 记录 id。后端把 Long 序列化成**字符串**（实测 `"id":"36"`） */
  id?: string | number
  /** 名称，≤10 字（页面规则） */
  name?: string
  /**
   * 负责人。**是员工工号形式的 username 字符串**（来自 `/sys/user/getUserListPage`
   * 下拉选项的 `username`），不是数字 id —— 尽管后端 DTO 的字段类型是 `Long`。
   */
  commander?: string | number | null
  /**
   * 负责人姓名。**只有列表接口会填**（`pageInfo` 用 `hrUserApi.getAllLongUserMap()`
   * 补的），`get` 回来的永远是 null。实测。
   */
  commanderName?: string | null
  /** 启用状态 0 禁用 / 1 启用。新建时后端固定写 0 */
  status?: number
  /** hr 组织 code，页面上没有控件，一直是 null */
  code?: number | null
  /** 逻辑删除标记。`remove` 之后 `get` 仍返回这一行，`isDel` 变成 1 */
  isDel?: number
  /** 录入人员 id（字符串形态的 Long） */
  creator?: string | number
  /** 录入人员姓名，**同样只有列表接口会填** */
  creatorName?: string | null
  createTime?: string
  updater?: string | number
  updateTime?: string
  [key: string]: unknown
}

export type ManagementCenterQuery = {
  /**
   * 名称，**模糊匹配**（后端自定义 SQL 是 `t1.name like CONCAT('%',#{dto.name},'%')`）。
   * ⚠️ 因为是 like，改名后的新名字如果**包含**原名，用原名仍然查得到 ——
   * 判断"改名成没成功"时新名字不能包含原名（这条坑在作业管理那条线上踩过）。
   */
  name?: string
  /** 启用状态 0/1。见 `MANAGEMENT_CENTER_STATUS_OPTIONS` 关于页面那个坏下拉的说明 */
  status?: 0 | 1 | ''
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * 启用状态。这两个值是后端真正认的（`hr_study_management_center.status` 是 `Integer`）。
 *
 * ⚠️ 与图库管理同一个坑，而且**代价更明确**：页面那个下拉是
 * `portal-education-dict-select type="status"`，而 `status` 是**全平台共用的字典 key**，
 * 装的是**交易状态**。浏览器实测的请求里发出去的是 `status=TRADE_FINISHED`，
 * 而后端的 DTO 字段是 `Integer`，Spring 绑定直接失败，实测报文（**HTTP 200 + ret FAIL**）：
 *
 * ```
 * 请求参数不正确:Failed to convert property value of type 'java.lang.String' to required
 *   type 'java.lang.Integer' for property 'status'; For input string: "TRADE_FINISHED"
 * ```
 *
 * 页面的表现是**列表直接变空**（`logicFetch` 的 catch 走 `listReset()`，连个错误提示都没有）。
 * 本 SDK **不复刻这个错误**：参数收的是后端真正认的 0/1，
 * 页面缺陷如实写在 `docs/pages/组织结构.md` 里。
 */
export const MANAGEMENT_CENTER_STATUS_OPTIONS = [
  { label: '禁用', value: 0 },
  { label: '启用', value: 1 },
] as const

/**
 * 新建载荷。**逐字段复刻 `[mode]/[id].vue` 提交时的 body**（键顺序 name, commander）。
 *
 * 状态 / 创建人 / 创建时间 / 修改人 / 修改时间**都不由客户端给**：
 * 后端 `saveInfo` 里写死（`status` 固定 0，`creator`/`updater` 取登录用户，
 * 时间取 now）。而新建这条路径**不会**碰用户账号
 * （`sysUserService.createUser(...)` 那一行是注释掉的）。
 */
export type ManagementCenterDraft = {
  /** 名称。页面规则：必填、≤10 字、不能全是空格 */
  name: string
  /**
   * 负责人。**必填**，值是员工工号形式的 username（页面下拉的 `value: item.username`）。
   *
   * ⚠️ 必填的理由不是"页面要求"（那是次要的）：后端 `pageInfo` 对
   * `commander` 直接 `.toString()`，**为 null 会 NPE，而那个 NPE 会让所有人打不开列表页**。
   * 详见文件头 ②。
   */
  commander: string | number
}

/**
 * 修改载荷：**只有名称**。
 *
 * 后端 `update(dto)` → `updateById` 是 MyBatis-Plus 的**部分更新**（只写非 null 字段），
 * 所以只发要改的字段是安全的。
 *
 * ⚠️ **`commander` 故意不在契约里**：`updateInfo` 里 `if (dto.getCommander() != null)` 会走
 * `hrUserApi.createUser(dto.getCommander(), Global.SUPER_ADMIN)` —— 给那个员工开账号并授
 * `SUPER_ADMIN`。那不是"改一条组织记录"，而且它动的**不是本 SDK 创建的测试数据**，
 * 所以按「只碰自己创建的数据」这条线，这个字段不做（详见文件头 ③）。
 *
 * ⚠️ **`status` 也不在这里**：改状态走 `set-status`。虽然两者后端是同一条 `updateInfo`，
 * 但页面上的编辑表单里根本没有状态控件，把它塞进 `update` 会让契约比页面宽。
 */
export type ManagementCenterUpdateDraft = {
  /** 记录 id，来自 `list()` / `get()`。数字会被转成字符串（后端就是这么给的） */
  id: string | number
  /** 新的名称；必填（这是本能力唯一能改的业务字段） */
  name: string
}

/** 名称校验：页面 `rules.name` 的三条（required / max 10 / validateOnlySpace） */
function assertName (name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('组织结构名称必填（页面的 validateOnlySpace 规则也不允许全是空格）')
  }
  const trimmed = name.trim()
  if (trimmed.length > MANAGEMENT_CENTER_NAME_MAX_LENGTH) {
    throw new Error(
      `组织结构名称不超过 ${MANAGEMENT_CENTER_NAME_MAX_LENGTH} 字（页面规则），收到的是 ${trimmed.length} 字`,
    )
  }
  return trimmed
}

/**
 * `commander` 必填。
 *
 * 空串、null、undefined 一律拒绝，理由是文件头 ② 那条 NPE —— 它不是"输入不合法"，
 * 是"这条数据一旦存在，所有人的列表页都打不开"。
 */
function assertCommander (commander: unknown): string {
  if (commander === null || commander === undefined || String(commander).trim() === '') {
    throw new Error(
      '负责人（commander）必填：后端 pageInfo 对 commander 直接 .toString()，' +
        '为 null 会 NPE，而那个 NPE 会让**所有人**的列表页 500。' +
        '值取员工工号形式的 username（页面下拉的 value）。',
    )
  }
  return String(commander).trim()
}

/** 构造列表接口的 params，键顺序显式写死（见 `LIST_QUERY`） */
export function buildListParams (query: ManagementCenterQuery = {}): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const item of LIST_QUERY) {
    const value = provided[item.name]
    params[item.name] = value === undefined || value === null ? item.defaultValue : value
  }
  return params
}

/** 构造新建的请求体：`{name, commander}`，键顺序与页面 formState 一致 */
export function buildCreatePayload (draft: ManagementCenterDraft): Record<string, unknown> {
  return {
    name: assertName(draft.name),
    commander: assertCommander(draft.commander),
  }
}

const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'name',
    kind: 'text',
    required: false,
    description:
      '名称，**模糊匹配**（后端是 like）。改名后核对时新名字不能包含原名，否则原名也查得到',
  },
  {
    name: 'status',
    kind: 'enum',
    required: false,
    description:
      '启用状态。⚠️ 页面上那个下拉是坏的（它用的是全平台共用的 status 字典，实测发出去的是 ' +
      'TRADE_FINISHED 这种交易状态，后端 Integer 绑定直接失败、页面列表变空）；' +
      '这里收的是后端真正认的 0/1',
    options: MANAGEMENT_CENTER_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export const baseManagementCenterCapabilities: CapabilityDefinition[] = [
  {
    id: 'base-management-center-list',
    title: '查询组织结构列表',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'base-management-center-get',
    title: '查询单个组织结构详情',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '记录 id，来自 base-management-center-list。⚠️ 它也会返回**已逻辑删除**的行' +
          '（isDel=1），判断"还在不在"要用 list 而不是这里',
      },
    ],
  },
  {
    id: 'base-management-center-check-status',
    title: '禁用前预检（只读）：这个组织的下属班级会不会被连带禁用',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    // 这个接口名字叫 updateStatus，但它**一个字段都不写**（见文件头）
    write: false,
    params: [
      { name: 'id', kind: 'number', required: true, description: '记录 id' },
      {
        name: 'status',
        kind: 'enum',
        required: true,
        description:
          '**将要改成**的状态（1 启用 / 0 禁用）。只有传 0 时后端才会去查下属班级、' +
          '才可能返回提示语；传 1 恒返回空',
        options: MANAGEMENT_CENTER_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
    ],
  },
  {
    id: 'base-management-center-create',
    title: '新建组织结构',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: true,
    params: [
      {
        name: 'name',
        kind: 'text',
        required: true,
        description:
          `名称，≤${MANAGEMENT_CENTER_NAME_MAX_LENGTH} 字（页面规则）。**全局唯一**：` +
          '后端按 name 查重（且**不过滤已逻辑删除的行**，见文档），重名会返回业务错误' +
          '「组织结构名称不能相同」',
      },
      {
        name: 'commander',
        kind: 'text',
        required: true,
        description:
          '负责人，员工工号形式的 username（不是数字 id）。**必填**：后端对 commander ' +
          '直接 .toString()，为 null 会让所有人的列表页 500',
      },
    ],
  },
  {
    id: 'base-management-center-update',
    title: '修改组织结构名称',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description: '记录 id，来自 base-management-center-list',
      },
      {
        name: 'name',
        kind: 'text',
        required: true,
        description: `新的名称，≤${MANAGEMENT_CENTER_NAME_MAX_LENGTH} 字。**这是本能力唯一能改的字段**：` +
          '改负责人会触发后端给那个员工开账号并授 SUPER_ADMIN，改状态请用 base-management-center-set-status',
      },
    ],
  },
  {
    id: 'base-management-center-set-status',
    title: '启用 / 禁用组织结构',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: true,
    params: [
      { name: 'id', kind: 'number', required: true, description: '记录 id' },
      {
        name: 'status',
        kind: 'enum',
        required: true,
        description:
          '**目标状态**（1 启用 / 0 禁用），不是"切换"。写绝对值才可重发。' +
          '⚠️ 传 0 会把它下面**所有班级**一并置为禁用（后端 updateInfo 里的级联）',
        options: MANAGEMENT_CENTER_STATUS_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
      },
    ],
  },
  {
    id: 'base-management-center-remove',
    title: '删除组织结构（逻辑删除）',
    pagePath: BASE_MANAGEMENT_CENTER_PAGE_PATH,
    permission: BASE_MANAGEMENT_CENTER_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '记录 id。**逻辑删除**：删完列表查不到，但 base-management-center-get 仍返回这一行' +
          '（isDel=1）；要确认删掉了请看列表。⚠️ 下属有**已启用班级**时删不掉，' +
          '后端返回业务错误「本组织结构下设有已启用班级，不可删除，请先删除班级」',
      },
    ],
  },
]

export function createBaseManagementCenterCapability (request: PortalRequest) {
  return {
    /**
     * 分页查询组织结构。只读。
     *
     * 基准：`baseline/base-management-center.browser.json` 的前两条读请求。
     *
     * ⚠️ `order` / `orderField` 这两个参数**后端不认**：自定义 SQL 里是写死的
     * `order by t1.create_time desc`，没有 `${order}` 拼接。页面照样发它们，
     * SDK 也照样发（逐字段一致），但别指望能排序。
     *
     * ⚠️ 这条 SQL **没有租户条件、也没有数据范围条件**（`@DataScope` 被注释掉了），
     * `pageInfo` 里那句 `dto.setCreator(user.getId())` 是死代码。所以列表是
     * **跨创建人**的：实测 19 条里创建人有徐曼 / 王璐 / 管理员 / 姚淼鑫各种。
     * "我建的"只能靠名字过滤。
     */
    list (query: ManagementCenterQuery = {}): Promise<PageResult<ManagementCenterRow>> {
      if (query.status !== undefined && query.status !== '' && query.status !== 0 && query.status !== 1) {
        // 与 normalizeStatus 同一个判据，但 list 上的错误要走 Promise.reject（不抛同步异常）
        return Promise.reject(
          new Error(
            `启用状态只能是 1（启用）或 0（禁用），收到的是 ${JSON.stringify(query.status)}。` +
              '页面上那个下拉发的是交易状态字典的值，会被后端拒掉——本 SDK 不复刻那个错误。',
          ),
        )
      }
      return request<PageResult<ManagementCenterRow>>({
        url: '/study/base/studymanagementcenter/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /** 单条详情。页面的编辑态就是先打它（`[mode]/[id].vue` 的 `customLoad`） */
    async get (id: string | number): Promise<ManagementCenterRow | null> {
      return request<ManagementCenterRow | null>({
        url: `/study/base/studymanagementcenter/${normalizeId(id)}`,
        method: 'get',
      })
    },

    /**
     * 禁用前预检（**只读**）。
     *
     * 这个接口在页面上叫 `updateStatus`、在后端也叫 `updateStatus`，
     * 但 `StudyManagementCenterServiceImpl.updateStatus` **只查了一次 `study_grade`**，
     * 一个字段都不写。它的返回值是给页面弹确认框用的**提示语字符串**：
     *
     * - 目标 `status` 传 0 且该组织下有班级 → `"禁用一级组织结构，其下属的班级也会被禁用，是否确认禁用"`
     * - 其余情况 → 空（后端返回的 `data` 是 null，axios 拦截器解包后就是 null）
     *
     * 页面拿到非空字符串就 `Modal.confirm`，用户点「确认」后**照旧**发 `setStatus`。
     * 所以它不是"提交"，也不改变终态 —— SDK 里它是 `write: false`，且**不是写链路的必经一步**。
     *
     * 用途：调用方在真的要禁用一个大组织之前，想知道会不会连带禁掉一批班级。
     */
    async checkStatus (id: string | number, status: 0 | 1): Promise<string | null> {
      return request<string | null>({
        url: '/study/base/studymanagementcenter/updateStatus',
        method: 'put',
        // 键顺序与浏览器一致：{id, status}，且 id 是字符串
        data: { id: normalizeId(id), status: normalizeStatus(status) },
      })
    },

    /**
     * 新建组织结构（**写操作**）。
     *
     * ⚠️ **后端不回传新 id**（`saveInfo` 返回的是空 `Result`，实测基准里也是），
     * 要知道建出来的是哪一条，只能回 `list({ name })` 按名字查（D12：接口返回成功不算验证）。
     *
     * ⚠️ 会**真的建出一条全局可见的记录**（列表跨创建人）。测试数据用 `SDK-TEST-` 前缀，
     * 用完 `remove` 掉。
     */
    async create (draft: ManagementCenterDraft): Promise<unknown> {
      return request({
        url: '/study/base/studymanagementcenter',
        method: 'post',
        data: buildCreatePayload(draft),
      })
    },

    /**
     * 修改名称（**写操作**）。
     *
     * 载荷只有 `{id, name}` 两个键。与浏览器发出的 body 的差别（**如实记下**）：
     * 页面编辑态是把 `GET /{id}` 的**整个响应**铺回表单再整份 PUT，所以它的 body 里
     * 还带着 `commander` / `commanderName` / `status` / `code` / `isDel` / `creator` /
     * `creatorName` / `createTime` / `updater` / `updateTime` 十个字段（基准第 3 条写请求）。
     * SDK 只发 `{id, name}`，是那份 body 的**子集** —— 依据是后端 `update(dto)` 走的是
     * MyBatis-Plus 的 `updateById`（只写非 null 字段）。实测
     * （`smoke/base-management-center-crud.mjs`）：只发 `{id, name}` 之后 `get` 读回
     * `commander` / `creator` / `createTime` / `status` 都没被动过。
     *
     * **两个刻意不开放的字段**（都在 `ManagementCenterUpdateDraft` 上有说明）：
     * `commander`（会触发 `hrUserApi.createUser(..., SUPER_ADMIN)`）与
     * `status`（改状态走 `setStatus`）。
     */
    async update (draft: ManagementCenterUpdateDraft): Promise<unknown> {
      return request({
        url: '/study/base/studymanagementcenter',
        method: 'put',
        // 键顺序与浏览器一致：id 在前（页面是 {...form}，id 是 GET 响应里的第一个键）
        data: { id: normalizeId(draft.id), name: assertName(draft.name) },
      })
    },

    /**
     * 改启用状态（**写操作**）。
     *
     * 页面在客户端算好绝对值再发（`record.status === 0 ? 1 : 0`），所以收的是目标状态
     * 而不是"切换"。载荷只有两个键、顺序与浏览器一致：`{ id, status }`。
     *
     * 时序（页面）：先 `PUT /updateStatus`（`checkStatus`，只读预检），拿到空值就直接发
     * 这条；拿到提示语就先弹确认框，用户点「确认」后**仍然发这条**。
     *
     * ⚠️ `status = 0` 时后端会**级联禁用该组织下的所有班级**
     * （`updateInfo` 里 `if (dto.getStatus() != null && dto.getStatus() == 0)`）。
     * 调用前建议先 `checkStatus(id, 0)` 看一眼会波及什么。
     */
    async setStatus (id: string | number, status: 0 | 1): Promise<unknown> {
      return request({
        url: '/study/base/studymanagementcenter',
        method: 'put',
        data: { id: normalizeId(id), status: normalizeStatus(status) },
      })
    },

    /**
     * 删除（**写操作**，逻辑删除）。
     *
     * 页面的 `logicDelete` 走 `deleteIsBatch: true` 分支：`http.delete(url, { data: [id] })`，
     * 即 **body 是一个字符串 id 数组**（实测 `["36"]`），不是路径参数。
     *
     * ⚠️ 两条必须说清楚的事：
     * 1. **这是逻辑删除**：删完 `list()` 查不到、`get()` 仍返回整行且 `isDel=1`（实测）。
     *    要用独立证据确认，看**列表**，不要看 `get`。
     * 2. **可能失败**：下属有 `status == 1` 的班级时后端返回业务错误
     *    「本组织结构下设有已启用班级，不可删除，请先删除班级」，一条都不删。
     *    SDK 不做预检查（预检查要另打一个接口，而且查到"没被挡"也不保证删的时候还没被挡）。
     */
    async remove (id: string | number | Array<string | number>): Promise<unknown> {
      const ids = (Array.isArray(id) ? id : [id]).map(normalizeId)
      if (ids.length === 0) {
        throw new Error('删除组织结构需要至少一个 id')
      }
      return request({
        url: '/study/base/studymanagementcenter',
        method: 'delete',
        data: ids,
      })
    },
  }
}

export type BaseManagementCenterCapability = ReturnType<typeof createBaseManagementCenterCapability>

/**
 * 门面上带防重的那一层。与作业管理 / 图库管理同样的分工：`withIdempotency` 需要**身份**，
 * 那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），
 * 不放进能力模块。这里只声明"多了一个 requestId"的形状。
 *
 * **只有 `create` 需要包**：它是这一页唯一会产生新记录的能力。
 * `update` / `setStatus` / `remove` 重发一次终态相同（实测依据见 `docs/pages/组织结构.md`
 * 的写链路一节）—— `setStatus` 写的是绝对值、`remove` 是逻辑删除重复删仍返回成功。
 */
export type BaseManagementCenterCapabilityWithIdempotency = BaseManagementCenterCapability & {
  /**
   * 带短窗口防重的建组织（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: ManagementCenterDraft & { requestId: string },
  ) => Promise<unknown>
}
